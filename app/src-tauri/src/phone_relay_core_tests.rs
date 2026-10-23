use super::*;
use crate::mobile_http::tests::Fake;
use std::sync::Arc;
use p256::SecretKey;

const WEB: &str = "https://phone.chammo.test";

fn sk(b: u8) -> SecretKey {
    tun::secret_from_seed(&[b; 32]).unwrap()
}

struct L {
    mac: SecretKey,
    lines: Vec<(String, String, Vec<u8>)>,
}

impl Lines for L {
    fn line_of(&self, relay: &str) -> Option<(String, Vec<u8>)> {
        self.lines.iter().find(|(r, _, _)| r == relay).map(|(_, id, x)| (id.clone(), x.clone()))
    }
    fn agree(&self, their: &[u8]) -> Option<[u8; 32]> {
        tun::agree(&self.mac, their).ok()
    }
}

struct World {
    gate: Gate,
    lines: L,
    phone: SecretKey,
    token: String,
    line: String,
    t: Tunnels,
}

fn world() -> World {
    let devices = Arc::new(Devices::memory());
    let mac = sk(7);
    let phone = sk(9);
    let px = tun::public_of(&phone);
    let now = SystemTime::now();
    let c = devices.new_code(now).unwrap();
    let token = devices.pair_relay(&c, &Pairing { name: "iPhone", home: false, prev: None, peer: false }, Relay { device: "r1".into(), x: tun::b64(&px) }, now).unwrap();
    let line = devices.check(&token, now).unwrap();
    let gate = Gate { devices, hosts: vec![RELAY_HOST.into()], origins: vec![WEB.into()], stops: Default::default(), sends: Default::default(), tickets: Default::default(), owner: None, team_says: Default::default() };
    World { gate, lines: L { mac, lines: vec![("r1".into(), line.clone(), px)] }, phone, token, line, t: Tunnels::default() }
}

/// 폰 쪽 세션 열기 — hello 를 보내고 답을 확인
fn connect(w: &mut World, c: &str) -> Session {
    let px = tun::public_of(&w.phone);
    let n = [3u8; tun::NONCE_LEN];
    let hello = [vec![HELLO], json!({ "v": 1, "pk": tun::b64(&px), "n": tun::b64(&n) }).to_string().into_bytes()].concat();
    let ev = w.t.on_frame(&w.lines, "r1", c, &hello);
    let Ev::Send(reply) = &ev[0] else { panic!("{ev:?}") };
    let shared = tun::agree(&w.phone, &tun::public_of(&w.lines.mac)).unwrap();
    Session::connect(&shared, &n, reply).unwrap()
}

fn req_frames(s: &mut Session, id: u64, m: &str, p: &str, h: Value, body: &[u8]) -> Vec<Vec<u8>> {
    let parts: Vec<&[u8]> = if body.is_empty() { vec![&[][..]] } else { body.chunks(CHUNK).collect() };
    let n = parts.len();
    parts.iter().enumerate().map(|(i, b)| {
        let mut v = json!({ "id": id, "i": i, "n": n, "b": tun::b64(b) });
        if i == 0 {
            v["m"] = json!(m);
            v["p"] = json!(p);
            v["h"] = h.clone();
        }
        s.seal(v.to_string().as_bytes())
    }).collect()
}

fn run(w: &mut World, s: &mut Session, c: &str, m: &str, p: &str, h: Value, body: &[u8]) -> (Resp, Fake) {
    let mut evs = vec![];
    for f in req_frames(s, 1, m, p, h, body) {
        evs.extend(w.t.on_frame(&w.lines, "r1", c, &f));
    }
    let Some(Ev::Run(t)) = evs.pop() else { panic!("{evs:?}") };
    let line = w.t.line(c).unwrap().to_string();
    let be = Fake::default();
    (serve(&t, &line, &w.gate, &be), be)
}

fn auth(w: &World) -> Value {
    json!({ "authorization": format!("Bearer {}", w.token), "content-type": "application/json" })
}

#[test]
fn hello_needs_a_known_phone_with_the_same_key() {
    let mut w = world();
    let px = tun::public_of(&w.phone);
    let hello = |pk: &[u8]| [vec![HELLO], json!({ "v": 1, "pk": tun::b64(pk), "n": tun::b64(&[1u8; 16]) }).to_string().into_bytes()].concat();
    assert_eq!(w.t.on_frame(&w.lines, "r2", "c1", &hello(&px)), vec![Ev::Drop("unknown phone".into())]);
    let other = tun::public_of(&sk(4));
    assert_eq!(w.t.on_frame(&w.lines, "r1", "c1", &hello(&other)), vec![Ev::Drop("key mismatch".into())]);
    assert!(matches!(w.t.on_frame(&w.lines, "r1", "c1", &hello(&px))[0], Ev::Send(_)));
    assert_eq!(w.t.line("c1"), Some(w.line.as_str()));
}

#[test]
fn data_from_another_device_or_unknown_connection_is_dropped() {
    let mut w = world();
    let mut s = connect(&mut w, "c1");
    let f = s.seal(b"{}");
    assert_eq!(w.t.on_frame(&w.lines, "r9", "c1", &f), vec![Ev::Drop("no session".into())]);
    assert_eq!(w.t.on_frame(&w.lines, "r1", "c2", &f), vec![Ev::Drop("no session".into())]);
    // 틀린 틀 하나면 그 세션을 버린다
    let mut bad = s.seal(b"{}");
    *bad.last_mut().unwrap() ^= 1;
    assert!(matches!(w.t.on_frame(&w.lines, "r1", "c1", &bad)[0], Ev::Drop(_)));
    assert_eq!(w.t.line("c1"), None);
}

#[test]
fn request_runs_through_the_phone_server_door() {
    let mut w = world();
    let mut s = connect(&mut w, "c1");
    let h = auth(&w);
    let (r, _) = run(&mut w, &mut s, "c1", "GET", "/api/env", h, b"");
    assert_eq!(r.status, 200);
    assert!(String::from_utf8_lossy(&r.body).contains("assistantName"));
}

#[test]
fn card_answer_goes_the_same_way_as_the_phone() {
    let mut w = world();
    let mut s = connect(&mut w, "c1");
    let h = auth(&w);
    let (r, be) = run(&mut w, &mut s, "c1", "POST", "/api/direct-answer", h, br#"{"id":"ab12cd34","pick":{"pick":"yes"}}"#);
    assert_eq!(r.status, 200);
    assert_eq!(be.calls(), vec!["direct_answer ab12cd34 Yes".to_string()]);
}

#[test]
fn no_token_or_another_lines_token_is_401() {
    let mut w = world();
    let now = SystemTime::now();
    let c = w.gate.devices.new_code(now).unwrap();
    let other = w.gate.devices.pair(&c, "iPad", now).unwrap();
    let mut s = connect(&mut w, "c1");
    let (r, _) = run(&mut w, &mut s, "c1", "GET", "/api/env", json!({}), b"");
    assert_eq!(r.status, 401);
    let (r, be) = run(&mut w, &mut s, "c1", "POST", "/api/direct-answer", json!({ "authorization": format!("Bearer {other}"), "content-type": "application/json" }), br#"{"id":"ab12cd34","pick":{"pick":"yes"}}"#);
    assert_eq!(r.status, 401);
    assert!(be.calls().is_empty());
}

#[test]
fn pairing_link_and_peer_paths_are_not_in_the_tunnel() {
    let mut w = world();
    let mut s = connect(&mut w, "c1");
    for p in ["/api/pair", "/api/hello", "/api/link-request", "/api/peer-say", "/api/peer-human", "/api/peer-direct-answer", "/api/peer-locker"] {
        let h = auth(&w);
        let (r, be) = run(&mut w, &mut s, "c1", "POST", p, h, b"{}");
        assert_eq!(r.status, 404, "{p}");
        assert!(be.calls().is_empty());
    }
}

#[test]
fn host_and_origin_come_from_the_computer_not_the_phone() {
    let w = world();
    let t = TReq { id: 1, method: "POST".into(), path: "/api/direct-answer".into(), headers: vec![("authorization".into(), format!("Bearer {}", w.token)), ("content-type".into(), "application/json".into())], body: b"{}".to_vec() };
    let req = gate_req(&t, &w.line, &w.gate).unwrap();
    assert_eq!(req.header("host"), Some(RELAY_HOST));
    assert_eq!(req.header("origin"), Some(WEB));
}

#[test]
fn chunks_must_come_in_order_and_big_bodies_assemble() {
    let mut w = world();
    let mut s = connect(&mut w, "c1");
    let body = vec![b'a'; CHUNK * 2 + 10];
    let frames = req_frames(&mut s, 7, "POST", "/api/x", json!({}), &body);
    assert_eq!(frames.len(), 3);
    assert!(w.t.on_frame(&w.lines, "r1", "c1", &frames[0]).is_empty());
    assert!(w.t.on_frame(&w.lines, "r1", "c1", &frames[1]).is_empty());
    let Ev::Run(t) = &w.t.on_frame(&w.lines, "r1", "c1", &frames[2])[0] else { panic!() };
    assert_eq!(t.body.len(), body.len());
    // 조각 번호가 차례가 아니면 세션을 버린다
    let mut s2 = connect(&mut w, "c2");
    let bad = s2.seal(json!({ "id": 1, "i": 1, "n": 2, "b": "" }).to_string().as_bytes());
    assert!(matches!(w.t.on_frame(&w.lines, "r1", "c2", &bad)[0], Ev::Drop(_)));
}

#[test]
fn response_chunks_carry_status_headers_and_the_phone_csp() {
    let r = Resp { status: 200, headers: vec![("Content-Type", "text/plain".into())], body: vec![b'x'; CHUNK + 1] };
    let ch = resp_chunks(5, &r, false);
    assert_eq!(ch.len(), 2);
    let first: Value = serde_json::from_slice(&ch[0]).unwrap();
    assert_eq!((first["id"].as_u64(), first["n"].as_u64(), first["s"].as_u64()), (Some(5), Some(2), Some(200)));
    assert_eq!(first["h"]["Content-Security-Policy"].as_str(), Some(http::PHONE_CSP));
    assert_eq!(first["h"]["Cache-Control"].as_str(), Some("no-store"));
    let second: Value = serde_json::from_slice(&ch[1]).unwrap();
    assert!(second.get("s").is_none());
    assert_eq!(resp_chunks(1, &r, true).len(), 1);
}

#[test]
fn knock_box_pairs_once_and_adds_the_phone_to_the_relay() {
    let w = world();
    let mac_pub = tun::public_of(&w.lines.mac);
    let px = tun::public_of(&sk(21));
    let code = w.gate.devices.new_code(SystemTime::now()).unwrap();
    let sign = tun::b64(&[5u8; 32]);
    let pt = json!({ "code": code, "sign": sign, "x": tun::b64(&px), "ua": "Mozilla (iPhone)", "home": false });
    let boxed = tun::b64(&tun::seal(&mac_pub, pt.to_string().as_bytes()).unwrap());
    let k = open_knock(&mac_pub, |e| w.lines.agree(e), &boxed).unwrap();
    assert_eq!((k.name.as_str(), k.x.clone()), ("iPhone", px.clone()));
    let mut added = vec![];
    let v = answer_knock(&k, &sign, &w.gate.devices, |s, n| { added.push((s.to_string(), n.to_string())); Ok("r7".into()) }, &json!({ "name": "맥북" }));
    assert_eq!(v["ok"], true);
    assert_eq!(added, vec![(sign.clone(), "iPhone".to_string())]);
    let tok = v["token"].as_str().unwrap();
    let line = w.gate.devices.check(tok, SystemTime::now()).unwrap();
    assert_eq!(w.gate.devices.relay_line("r7"), Some((line, tun::b64(&px))));
    // 같은 코드 두 번째는 안 된다 · 틀린 코드는 중계에 들이지도 않는다
    let again = answer_knock(&k, &sign, &w.gate.devices, |_, _| panic!("들이면 안 됨"), &json!({}));
    assert_eq!(again["error"], "code");
}

#[test]
fn knock_box_shape_and_wrong_key() {
    let w = world();
    let mac_pub = tun::public_of(&w.lines.mac);
    let seal = |v: Value| tun::b64(&tun::seal(&mac_pub, v.to_string().as_bytes()).unwrap());
    let good = json!({ "code": "a".repeat(32), "sign": tun::b64(&[5u8; 32]), "x": tun::b64(&tun::public_of(&sk(6))) });
    assert!(open_knock(&mac_pub, |e| w.lines.agree(e), &seal(good.clone())).is_ok());
    for (k, bad) in [("code", json!("zz")), ("sign", json!("abc")), ("x", json!(null))] {
        let mut v = good.clone();
        v[k] = bad;
        assert!(open_knock(&mac_pub, |e| w.lines.agree(e), &seal(v)).is_err(), "{k}");
    }
    let other = sk(8);
    assert!(open_knock(&mac_pub, |e| tun::agree(&other, e).ok(), &seal(good)).is_err());
    assert!(open_knock(&mac_pub, |e| w.lines.agree(e), "!!").is_err());
}

// ── 보안 검토 E·F·C ──

fn knock_for(w: &World, sign: &str) -> Knock {
    let mac_pub = tun::public_of(&w.lines.mac);
    let code = w.gate.devices.new_code(SystemTime::now()).unwrap();
    let pt = json!({ "code": code, "sign": sign, "x": tun::b64(&tun::public_of(&sk(22))), "ua": "iPhone" });
    let boxed = tun::b64(&tun::seal(&mac_pub, pt.to_string().as_bytes()).unwrap());
    open_knock(&mac_pub, |e| w.lines.agree(e), &boxed).unwrap()
}

#[test]
fn knock_sign_must_match_the_key_the_hub_verified() {
    let w = world();
    let sign = tun::b64(&[5u8; 32]);
    let k = knock_for(&w, &sign);
    // 허브가 확인한 두드리기 열쇠가 상자 속 sign 과 다르면(남의 상자를 옮겨 실음) 들이지 않는다
    let v = answer_knock(&k, &tun::b64(&[6u8; 32]), &w.gate.devices, |_, _| panic!("들이면 안 됨"), &json!({}));
    assert_eq!(v["error"], "key");
    assert!(w.gate.devices.code_alive(&k.code, SystemTime::now()), "코드는 안 닳는다");
}

#[test]
fn relay_device_added_but_not_paired_is_queued_for_revoke() {
    let w = world();
    let sign = tun::b64(&[5u8; 32]);
    let k = knock_for(&w, &sign);
    let devices = w.gate.devices.clone();
    // 들이는 사이 코드가 죽었다(새 QR) — 방금 넣은 중계 기기는 고아라 끊을 대기열에
    let v = answer_knock(&k, &sign, &w.gate.devices, |_, _| { devices.new_code(SystemTime::now()).unwrap(); Ok("orphan1".into()) }, &json!({}));
    assert_eq!(v["error"], "code");
    assert_eq!(w.gate.devices.pending_revokes(), vec!["orphan1".to_string()]);
}

#[test]
fn drain_revokes_keeps_failures_for_retry() {
    let w = world();
    for id in ["a", "b", "c", "d"] {
        w.gate.devices.queue_revoke(id).unwrap();
    }
    let (done, left) = drain_revokes(&w.gate.devices, |id| match id {
        "a" => Ok(200),
        "b" => Ok(404),
        "c" => Ok(500),
        _ => Err("망".into()),
    });
    assert_eq!((done, left), (2, 2));
    assert_eq!(w.gate.devices.pending_revokes(), vec!["c".to_string(), "d".to_string()]);
}

// ── 참모가 만든 코드(hold, scripts/app phone pair)와 중계 두드리기 ──

#[test]
fn held_code_cannot_pair_by_knock_until_a_human_allows() {
    let w = world();
    let mac_pub = tun::public_of(&w.lines.mac);
    let code = w.gate.devices.new_code_held("card1", SystemTime::now()).unwrap();
    let sign = tun::b64(&[5u8; 32]);
    let pt = json!({ "code": code, "sign": sign, "x": tun::b64(&tun::public_of(&sk(23))), "ua": "iPhone" });
    let boxed = tun::b64(&tun::seal(&mac_pub, pt.to_string().as_bytes()).unwrap());
    let k = open_knock(&mac_pub, |e| w.lines.agree(e), &boxed).unwrap();
    // 허용 전 — 중계에 들이지도 않고 '허용 기다림'
    let v = answer_knock(&k, &sign, &w.gate.devices, |_, _| panic!("허용 전엔 들이면 안 됨"), &json!({}));
    assert_eq!(v["error"], "held");
    // 사람이 카드에서 허용하면 같은 QR 로 짝지어진다
    w.gate.devices.decide_hold("card1", true).unwrap();
    let v = answer_knock(&k, &sign, &w.gate.devices, |_, _| Ok("r8".into()), &json!({}));
    assert_eq!(v["ok"], true);
}

#[test]
fn held_code_refused_by_human_is_dead_for_knock() {
    let w = world();
    let code = w.gate.devices.new_code_held("card2", SystemTime::now()).unwrap();
    w.gate.devices.decide_hold("card2", false).unwrap();
    assert!(!w.gate.devices.code_alive(&code, SystemTime::now()));
}
