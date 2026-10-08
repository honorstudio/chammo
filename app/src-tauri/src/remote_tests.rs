use super::*;
use crate::accounts_store::fake::Fake;
use crate::remote_net::{NetErr, Response};
use std::cell::RefCell;

const STATUS: &str = r#"{
  "BackendState": "Running",
  "Self": { "ID": "nSELF", "HostName": "mac-studio", "OS": "macOS", "UserID": 7, "TailscaleIPs": ["100.64.0.10"] },
  "User": { "7": { "LoginName": "me@example.com" }, "9": { "LoginName": "other@example.com" } },
  "Peer": {
    "k1": { "ID": "nBOX", "HostName": "BOX-PC", "OS": "windows", "UserID": 7, "Online": true, "TailscaleIPs": ["100.64.0.11", "fd7a::1"] },
    "k2": { "ID": "nPC", "HostName": "DESK-PC", "OS": "windows", "UserID": 7, "Online": true, "TailscaleIPs": ["100.64.0.12"] },
    "k3": { "ID": "nSHARED", "HostName": "friend-pc", "OS": "linux", "UserID": 9, "Online": true, "TailscaleIPs": ["100.64.0.5"] },
    "k4": { "ID": "nTAG", "HostName": "server", "OS": "linux", "UserID": 7, "Online": true, "Tags": ["tag:server"], "TailscaleIPs": ["100.64.0.6"] },
    "k5": { "ID": "nPHONE", "HostName": "localhost", "OS": "iOS", "UserID": 7, "Online": false, "TailscaleIPs": ["100.64.0.13"] }
  }
}"#;

#[test]
fn md3_같은_계정_피어만_태그·공유_노드는_뺀다() {
    let (me, peers) = same_user_peers(STATUS).unwrap();
    assert_eq!(me, "mac-studio");
    let ids: Vec<&str> = peers.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids, ["nBOX", "nPC", "nPHONE"]);
    let bx = &peers[0];
    assert_eq!((bx.name.as_str(), bx.os.as_str(), bx.ip, bx.online), ("BOX-PC", "windows", "100.64.0.11".parse().unwrap(), true));
    assert!(same_user_peers(r#"{"BackendState":"Stopped"}"#).is_none());
}

fn ok(status: u16, body: &str) -> Result<Response, NetErr> {
    Ok(Response { status, ctype: "application/json".into(), body: body.as_bytes().to_vec() })
}

#[test]
fn md3_hello_답으로_참모가_있나_가른다() {
    assert_eq!(presence(&ok(200, r#"{"app":"chammo","proto":1,"version":"0.2.6","os":"windows"}"#)), Presence::Chammo { proto: 1, version: "0.2.6".into() });
    assert_eq!(presence(&ok(401, "no key")), Presence::Old, "hello 없는 옛판은 열쇠 없음으로 답한다");
    assert_eq!(presence(&ok(200, r#"{"app":"other"}"#)), Presence::Absent);
    assert_eq!(presence(&ok(404, "nope")), Presence::Absent);
    assert_eq!(presence(&Err(NetErr::Refused)), Presence::Absent);
    assert_eq!(presence(&Err(NetErr::Timeout)), Presence::Absent);
    // 이상한 버전 글은 거른다(화면에 그대로 찍히지 않게)
    assert_eq!(presence(&ok(200, r#"{"app":"chammo","proto":1,"version":"<img src=x>"}"#)), Presence::Chammo { proto: 1, version: String::new() });
}

fn peer(id: &str, online: bool) -> TsPeer {
    TsPeer { id: id.into(), name: format!("{id}-host"), os: "windows".into(), ip: "100.64.0.9".parse().unwrap(), online }
}

#[test]
fn md3_기기_칸_상태_합치기() {
    let saved = vec![
        Saved { id: "nA".into(), name: "A".into(), ip: "100.64.0.1".parse().unwrap(), port: 47123, paired_at: 1, last_ok: Some(5) },
        Saved { id: "nGONE".into(), name: "옛 PC".into(), ip: "100.64.0.2".parse().unwrap(), port: 47123, paired_at: 1, last_ok: Some(3) },
        Saved { id: "nB".into(), name: "B".into(), ip: "100.64.0.3".parse().unwrap(), port: 47123, paired_at: 1, last_ok: None },
    ];
    let peers = vec![peer("nA", true), peer("nB", true), peer("nNEW", true), peer("nOLD", true), peer("nNONE", true)];
    let probe = |id: &str| match id {
        "nA" => Probe { hello: Presence::Chammo { proto: 1, version: "0.2.6".into() }, auth: Some(true) },
        "nB" => Probe { hello: Presence::Old, auth: Some(false) },
        "nNEW" => Probe { hello: Presence::Chammo { proto: 1, version: "0.2.6".into() }, auth: None },
        "nOLD" => Probe { hello: Presence::Old, auth: None },
        _ => Probe { hello: Presence::Absent, auth: None },
    };
    let v = merge(&peers, &saved, probe);
    let st: Vec<(&str, &str)> = v.iter().map(|d| (d.id.as_str(), d.status)).collect();
    assert_eq!(st, [("nA", "connected"), ("nB", "pair"), ("nNEW", "pair"), ("nOLD", "pair"), ("nGONE", "offline")]);
    assert_eq!(v[0].version.as_deref(), Some("0.2.6"));
    assert!(v[3].old, "hello 없는 옛판 — 짝짓기는 되지만 업데이트 권함");
    assert_eq!(v[4].last_ok, Some(3), "끊긴 기기는 마지막으로 본 때");
    assert!(v[1].paired && !v[2].paired);
}

#[test]
fn md3_기기가_꺼지면_offline_짝지은_적_없으면_안_보인다() {
    let saved = vec![Saved { id: "nA".into(), name: "A".into(), ip: "100.64.0.1".parse().unwrap(), port: 47123, paired_at: 1, last_ok: None }];
    let v = merge(&[peer("nA", false), peer("nX", false)], &saved, |_| Probe { hello: Presence::Absent, auth: None });
    assert_eq!(v.iter().map(|d| (d.id.as_str(), d.status)).collect::<Vec<_>>(), [("nA", "offline")]);
}

#[test]
fn md3_허용한_길만_대신_보낸다() {
    for (m, p) in [("GET", "/api/sessions"), ("GET", "/api/transcript?id=f00d&from=3"), ("GET", "/api/tails?ids=a,b"), ("POST", "/api/send"), ("POST", "/api/direct-answer"), ("GET", "/api/browser-frame?profile=p1&since=0")] {
        assert!(allowed(m, p), "{m} {p}");
    }
    for (m, p) in [
        ("GET", "/api/file?path=/etc/passwd"),
        ("POST", "/api/spawn"),
        ("POST", "/api/remove"),
        ("POST", "/api/pair-code"),
        ("POST", "/api/account-switch"),
        ("GET", "/api/sessionsX"),
        ("GET", "/api/sessions/../file"),
        ("DELETE", "/api/sessions"),
        ("GET", "/api/sessions?x=1\r\nHost: evil"),
        ("GET", "/api/sessions?x=a b"),
        ("GET", "http://evil/api/sessions"),
    ] {
        assert!(!allowed(m, p), "{m} {p:?}");
    }
}

#[test]
fn md3_짝짓기_코드는_16진_32자만() {
    assert_eq!(norm_code(" 0123456789ABCDEF0123456789abcdef \n").as_deref(), Some("0123456789abcdef0123456789abcdef"));
    assert_eq!(norm_code("0123 4567 89ab cdef 0123 4567 89ab cdef").as_deref(), Some("0123456789abcdef0123456789abcdef"));
    assert!(norm_code("xyz").is_none());
    assert!(norm_code(&"0".repeat(33)).is_none());
    // 폰 QR 주소를 통째로 붙여도 코드만
    assert_eq!(norm_code("http://100.64.0.1:47123/?pair=0123456789abcdef0123456789abcdef").as_deref(), Some("0123456789abcdef0123456789abcdef"));
}

const TOK: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

fn tmp(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-remote-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn md3_짝짓기는_열쇠를_키체인에_목록엔_열쇠_없이() {
    let dir = tmp("pair");
    let kc = Fake::default();
    let sent = RefCell::new(Vec::new());
    let send = |_: &Target, r: &Request, _: Duration, _: usize| {
        sent.borrow_mut().push((r.method.to_string(), r.path.to_string(), String::from_utf8_lossy(r.body.unwrap_or(&[])).into_owned(), r.token.is_some()));
        ok(200, &format!(r#"{{"token":"{TOK}"}}"#))
    };
    pair(&kc, &dir, &peer("nBOX", true), "0123456789abcdef0123456789abcdef", "my-mac", &send).unwrap();
    let (m, p, body, tok) = sent.borrow()[0].clone();
    assert_eq!((m.as_str(), p.as_str(), tok), ("POST", "/api/pair", false));
    let b: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(b["peer"], true);
    assert_eq!(b["name"], "참모 · my-mac");
    assert_eq!(kc.val(SERVICE, "nBOX").as_deref(), Some(TOK));
    let file = std::fs::read_to_string(dir.join(FILE)).unwrap();
    assert!(file.contains("nBOX") && !file.contains(TOK), "목록 파일엔 열쇠가 없다");
    // 다시 짝지으면 줄이 안 는다
    pair(&kc, &dir, &peer("nBOX", true), "0123456789abcdef0123456789abcdef", "my-mac", &send).unwrap();
    assert_eq!(load(&dir).len(), 1);
}

#[test]
fn md3_옛판이_모르는_칸을_400으로_거절하면_코드만_다시() {
    let dir = tmp("pairold");
    let kc = Fake::default();
    let bodies = RefCell::new(Vec::new());
    pair(&kc, &dir, &peer("nIMAC", true), "0123456789abcdef0123456789abcdef", "m", &|_: &Target, r: &Request, _: Duration, _: usize| {
        let b: serde_json::Value = serde_json::from_slice(r.body.unwrap()).unwrap();
        bodies.borrow_mut().push(b.clone());
        if b.get("peer").is_some() { ok(400, "bad json") } else { ok(200, &format!(r#"{{"token":"{TOK}"}}"#)) }
    })
    .unwrap();
    assert_eq!(bodies.borrow().len(), 2);
    assert_eq!(bodies.borrow()[1], serde_json::json!({ "code": "0123456789abcdef0123456789abcdef" }));
    assert_eq!(kc.val(SERVICE, "nIMAC").as_deref(), Some(TOK));
}

#[test]
fn md3_짝짓기_실패는_이유만_열쇠는_안_남긴다() {
    let dir = tmp("pairfail");
    let kc = Fake::default();
    let e = pair(&kc, &dir, &peer("nBOX", true), "0123456789abcdef0123456789abcdef", "m", &|_: &Target, _: &Request, _: Duration, _: usize| ok(401, "nope")).unwrap_err();
    assert!(e.contains("코드"), "{e}");
    assert!(load(&dir).is_empty());
    // 원격이 이상한 토큰을 주면 안 받는다
    let e = pair(&kc, &dir, &peer("nBOX", true), "0123456789abcdef0123456789abcdef", "m", &|_: &Target, _: &Request, _: Duration, _: usize| ok(200, r#"{"token":"short"}"#)).unwrap_err();
    assert!(!e.is_empty());
    assert!(kc.val(SERVICE, "nBOX").is_none());
    // 키체인 쓰기 실패면 목록에도 안 남긴다
    *kc.fail_set.borrow_mut() = Some(SERVICE.into());
    let e = pair(&kc, &dir, &peer("nBOX", true), "0123456789abcdef0123456789abcdef", "m", &|_: &Target, _: &Request, _: Duration, _: usize| ok(200, &format!(r#"{{"token":"{TOK}"}}"#))).unwrap_err();
    assert!(!e.contains(TOK), "{e}");
    assert!(load(&dir).is_empty());
}

#[test]
fn md3_대신_보내기는_열쇠를_붙이고_401이면_짝짓기_필요() {
    let dir = tmp("call");
    let kc = Fake::default();
    kc.put(SERVICE, "nBOX", TOK);
    save(&dir, &[Saved { id: "nBOX".into(), name: "B".into(), ip: "100.64.0.9".parse().unwrap(), port: 47123, paired_at: 1, last_ok: None }]).unwrap();
    let saw = RefCell::new(None);
    let here = Some("100.64.0.9".parse().unwrap());
    let out = call(&kc, &dir, "nBOX", here, "GET", "/api/sessions", None, &|t: &Target, r: &Request, _: Duration, _: usize| {
        *saw.borrow_mut() = Some((t.ip, r.token.map(str::to_string)));
        ok(200, "[]")
    })
    .unwrap();
    assert_eq!((out.status, out.text.as_deref()), (200, Some("[]")));
    assert_eq!(saw.borrow().clone(), Some(("100.64.0.9".parse().unwrap(), Some(TOK.to_string()))));
    assert!(load(&dir)[0].last_ok.is_some(), "닿으면 마지막으로 본 때를 적는다");
    // 허용 안 한 길·모르는 기기·깨진 JSON 몸통은 보내지도 않는다
    let never = |_: &Target, _: &Request, _: Duration, _: usize| -> Result<Response, NetErr> { panic!("보내면 안 된다") };
    assert!(call(&kc, &dir, "nBOX", here, "GET", "/api/file?path=/x", None, &never).is_err());
    assert!(call(&kc, &dir, "nNOPE", here, "GET", "/api/sessions", None, &never).is_err());
    assert!(call(&kc, &dir, "nBOX", here, "POST", "/api/send", Some("{not json"), &never).is_err());
    // 원격이 열쇠를 끊었으면
    let e = call(&kc, &dir, "nBOX", here, "GET", "/api/sessions", None, &|_: &Target, _: &Request, _: Duration, _: usize| ok(401, "no key")).unwrap_err();
    assert_eq!(e, "pair");
    // 그림(브라우저 화면)은 base64 로
    let out = call(&kc, &dir, "nBOX", here, "GET", "/api/browser-frame?profile=p&since=0", None, &|_: &Target, _: &Request, _: Duration, _: usize| {
        Ok(Response { status: 200, ctype: "application/octet-stream".into(), body: vec![0, 1, 2, 255] })
    })
    .unwrap();
    assert_eq!((out.text, out.b64.as_deref()), (None, Some("AAEC/w==")));
}

#[test]
fn md3_끊기는_키체인과_목록에서_둘_다() {
    let dir = tmp("unpair");
    let kc = Fake::default();
    kc.put(SERVICE, "nBOX", TOK);
    save(&dir, &[Saved { id: "nBOX".into(), name: "B".into(), ip: "100.64.0.9".parse().unwrap(), port: 47123, paired_at: 1, last_ok: None }]).unwrap();
    unpair(&kc, &dir, "nBOX").unwrap();
    assert!(kc.val(SERVICE, "nBOX").is_none());
    assert!(load(&dir).is_empty());
}

#[test]
fn md3_열쇠는_지금_테일넷에서_그_노드의_주소로만() {
    // 짝지을 때 적은 주소를 믿지 않는다 — 그 노드가 지워지고 주소가 남에게 가면 열쇠가 샌다
    let dir = tmp("ip");
    let kc = Fake::default();
    kc.put(SERVICE, "nBOX", TOK);
    save(&dir, &[Saved { id: "nBOX".into(), name: "B".into(), ip: "100.64.0.9".parse().unwrap(), port: 47123, paired_at: 1, last_ok: None }]).unwrap();
    let never = |_: &Target, _: &Request, _: Duration, _: usize| -> Result<Response, NetErr> { panic!("보내면 안 된다") };
    let e = call(&kc, &dir, "nBOX", None, "GET", "/api/sessions", None, &never).unwrap_err();
    assert!(e.contains("테일넷"), "{e}");
    // 주소가 바뀌었으면 지금 주소로
    let saw = RefCell::new(None);
    call(&kc, &dir, "nBOX", Some("100.64.0.77".parse().unwrap()), "GET", "/api/sessions", None, &|t: &Target, _: &Request, _: Duration, _: usize| {
        *saw.borrow_mut() = Some(t.ip);
        ok(200, "[]")
    })
    .unwrap();
    assert_eq!(*saw.borrow(), Some("100.64.0.77".parse().unwrap()));
}

/// 실측 — CHAMMO_REMOTE_LIVE=1 로 켠다(기본 꺼짐). 읽기만: 이 맥 테일넷 기기마다 hello, 짝지은 기기가 없으니 열쇠는 안 읽는다
#[test]
#[ignore]
fn md3_실측_기기_찾기() {
    if std::env::var("CHAMMO_REMOTE_LIVE").is_err() {
        return;
    }
    let t0 = std::time::Instant::now();
    let out = devices_now().unwrap();
    eprintln!("me={} ({:?})", out.me, t0.elapsed());
    for d in &out.devices {
        eprintln!("{} {} {} old={} ver={:?}", d.name, d.os, d.status, d.old, d.version);
    }
}

/// 메모리 저장소 — 실측 짝짓기에서 이 맥 키체인을 안 건드리게
#[derive(Default)]
struct Mem(std::sync::Mutex<std::collections::HashMap<(String, String), Secret>>);
impl Store for Mem {
    fn get(&self, s: &str, a: &str) -> Result<Option<Secret>, crate::accounts_store::StoreError> {
        Ok(self.0.lock().unwrap().get(&(s.into(), a.into())).cloned())
    }
    fn set(&self, s: &str, a: &str, v: &Secret) -> Result<(), crate::accounts_store::StoreError> {
        self.0.lock().unwrap().insert((s.into(), a.into()), v.clone());
        Ok(())
    }
    fn remove(&self, s: &str, a: &str) -> Result<(), crate::accounts_store::StoreError> {
        self.0.lock().unwrap().remove(&(s.into(), a.into()));
        Ok(())
    }
}

/// 실측 짝짓기 한 바퀴 — CHAMMO_PAIR_FILE(코드가 든 임시 파일, 읽자마자 지운다)·CHAMMO_PEER_NAME(테일넷 호스트 이름)로 켠다.
/// 열쇠는 메모리에만, 목록은 임시 폴더. 채팅은 그 기기 참모 하나에 시험 글 한 줄, 대기함 답하기는 없는 카드 번호로 길만
#[test]
#[ignore]
fn md3_실측_짝짓기_한_바퀴() {
    let (Ok(file), Ok(name)) = (std::env::var("CHAMMO_PAIR_FILE"), std::env::var("CHAMMO_PEER_NAME")) else { return };
    let code = std::fs::read_to_string(&file).unwrap();
    std::fs::remove_file(&file).unwrap();
    let (route, json) = tailnet().unwrap();
    let (me, peers) = same_user_peers(&json).unwrap();
    let peer = peers.iter().find(|p| p.name.eq_ignore_ascii_case(&name)).expect("테일넷에 그 기기").clone();
    let dir = tmp("live");
    let kc = Mem::default();
    let send = real_send(route.clone());
    let t0 = std::time::Instant::now();
    pair(&kc, &dir, &peer, &code, &me, &send).unwrap();
    eprintln!("① 짝짓기 됨 {:?} ({route:?})", t0.elapsed());
    let here = Some(peer.ip);
    let get = |p: &str| {
        let t = std::time::Instant::now();
        let o = call(&kc, &dir, &peer.id, here, "GET", p, None, &send).unwrap();
        (o, t.elapsed())
    };
    let (env, el) = get("/api/env");
    let env: serde_json::Value = serde_json::from_str(env.text.as_deref().unwrap()).unwrap();
    eprintln!("② env {:?} 비서={} hq 있음={}", el, env["assistantName"], env["hqDir"].as_str().is_some_and(|s| !s.is_empty()));
    let hq = crate::config::fwd(env["hqDir"].as_str().unwrap_or("")).to_lowercase();
    let (ss, el) = get("/api/sessions");
    let list: Vec<serde_json::Value> = serde_json::from_str(ss.text.as_deref().unwrap()).unwrap();
    let orchs: Vec<&serde_json::Value> = list.iter().filter(|s| crate::config::fwd(s["cwd"].as_str().unwrap_or("")).to_lowercase() == hq).collect();
    eprintln!("③ 세션 {}개 {:?} — 참모 {:?}", list.len(), el, orchs.iter().map(|s| format!("{} {}/{}", s["name"], s["state"], s["status"])).collect::<Vec<_>>());
    for p in ["/api/direct", "/api/tasks", "/api/stopped", "/api/browsers"] {
        let (o, el) = get(p);
        eprintln!("④ {p} {} {}바이트 {:?}", o.status, o.text.as_deref().map(str::len).unwrap_or(0), el);
    }
    // 대기함 답하기 — 없는 카드 번호로 길만(진짜 카드를 누르지 않는다)
    let o = call(&kc, &dir, &peer.id, here, "POST", "/api/direct-answer", Some(r#"{"id":"md-live-none","pick":{"kind":"choice","index":0}}"#), &send).unwrap();
    eprintln!("⑤ direct-answer(없는 카드) {} {:?}", o.status, o.text.as_deref().map(|t| t.chars().take(80).collect::<String>()));
    // 채팅 — 쉬는 참모 하나에 시험 글 한 줄, 답을 90초까지 기다린다
    let Some(o) = orchs.iter().find(|s| s["status"] == "idle").or(orchs.first()) else {
        eprintln!("⑥ 켜진 참모 없음 — 채팅 시험 건너뜀");
        return;
    };
    let (sid, id) = (o["sessionId"].as_str().unwrap_or(""), o["id"].as_str().unwrap_or(""));
    let (tr0, _) = get(&format!("/api/transcript?id={sid}"));
    let next = serde_json::from_str::<serde_json::Value>(tr0.text.as_deref().unwrap()).unwrap()["next"].as_u64().unwrap_or(0);
    let cid = format!("md-live-{}", std::process::id());
    let body = serde_json::json!({ "id": id, "text": "[시험] 맥북 참모에서 테일넷으로 보낸 연결 시험 글이야. 아무것도 하지 말고 '받았어' 한 줄만 답해 줘.", "cid": cid }).to_string();
    let sent = call(&kc, &dir, &peer.id, here, "POST", "/api/send", Some(&body), &send).unwrap();
    eprintln!("⑥ send {} → {}", sent.status, o["name"]);
    let t = std::time::Instant::now();
    let mut said = String::new();
    while t.elapsed() < Duration::from_secs(90) {
        std::thread::sleep(Duration::from_secs(3));
        let (st, _) = get(&format!("/api/send-status?cid={cid}"));
        let (tr, _) = get(&format!("/api/transcript?id={sid}&from={next}"));
        let txt = serde_json::from_str::<serde_json::Value>(tr.text.as_deref().unwrap()).unwrap()["text"].as_str().unwrap_or("").to_string();
        if txt.contains("받았어") && txt.matches("받았어").count() >= 2 {
            said = txt;
            eprintln!("   send-status {} · 답 {:?}", st.text.unwrap_or_default(), t.elapsed());
            break;
        }
    }
    eprintln!("⑦ 답 받음={} (끝 200자: {:?})", !said.is_empty(), said.chars().rev().take(200).collect::<String>().chars().rev().collect::<String>());
}
