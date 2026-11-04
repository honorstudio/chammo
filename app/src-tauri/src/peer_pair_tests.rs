use super::*;
use crate::device_link::Links;
use crate::phone_tunnel as tun;
use p256::SecretKey;
use serde_json::{json, Value};
use std::net::TcpListener;
use std::time::Instant;
use tungstenite::Message;

// 가짜 허브 + 받는 컴퓨터(A) — A 쪽은 지금 숫자 확인 상태 기계(device_link::Links)를 그대로 돌린다. 허브는 두드리기 틀만 넘긴다

fn sk(b: u8) -> SecretKey {
    tun::secret_from_seed(&[b; 32]).unwrap()
}
const SIGN: &str = "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM";
const DEV: &str = "dev-b";

/// how = 허브가 처음에 보내는 말("unsupported"·"offline" 이면 그것만), 아니면 정상 · yes = A 사람이 허용하나
fn hub(how: &'static str, yes: bool) -> (String, std::thread::JoinHandle<()>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("ws://{}/v0/hubs/dev-a/knock", l.local_addr().unwrap());
    let h = std::thread::spawn(move || {
        let (tcp, _) = l.accept().unwrap();
        let mut ws = tungstenite::accept(tcp).unwrap();
        if how != "ok" {
            ws.send(Message::text(json!({ "t": how }).to_string())).unwrap();
            return;
        }
        let a = sk(7);
        let mt = tun::public_of(&a);
        let links = Links::default();
        let t0 = Instant::now();
        let mut bx = vec![];
        while let Ok(m) = ws.read() {
            let Message::Text(txt) = m else { continue };
            let v: Value = serde_json::from_str(txt.as_str()).unwrap();
            let pt = tun::open(&mt, |e| tun::agree(&a, e).ok(), &tun::unb64(v["box"].as_str().unwrap()).unwrap()).unwrap();
            let body: Value = serde_json::from_slice(&pt).unwrap();
            let reply = match body["step"].as_str() {
                Some("link1") => {
                    bx = tun::pubkey(body["x"].as_str().unwrap()).unwrap();
                    let cm = links.first_kind("k1", &body, SIGN, DEV, &mt, true, t0).unwrap();
                    json!({ "step": "link2", "cM": tun::b64(&cm) })
                }
                Some("link3") => {
                    let np = tun::unb64(body["nP"].as_str().unwrap()).unwrap();
                    let (_, _, nm) = links.reveal("k1", &np, &mt, t0).unwrap();
                    let r4 = json!({ "step": "link4", "nM": tun::b64(&nm) });
                    let b4 = tun::b64(&tun::seal(&bx, r4.to_string().as_bytes()).unwrap());
                    ws.send(Message::text(json!({ "t": "reply", "box": b4 }).to_string())).unwrap();
                    if yes { json!({ "step": "link5", "ok": true, "token": "ab".repeat(32), "device": DEV, "mac": { "id": "dev-a", "name": "사무실 아이맥" } }) } else { json!({ "step": "link5", "ok": false, "error": "declined" }) }
                }
                _ => return,
            };
            let b = tun::b64(&tun::seal(&bx, reply.to_string().as_bytes()).unwrap());
            ws.send(Message::text(json!({ "t": "reply", "box": b }).to_string())).unwrap();
        }
    });
    (url, h)
}

fn me() -> Me {
    let b = sk(9);
    Me { pt: tun::public_of(&b), sign: tun::unb64(SIGN).unwrap(), dev: DEV.into(), name: "집 맥북".into(), agree: Box::new(move |e| tun::agree(&b, e).ok()) }
}

#[test]
fn 숫자_확인을_돌고_허용되면_열쇠를_받는다() {
    let (url, _h) = hub("ok", true);
    let mut shown = vec![];
    let out = run_knock(&url, &me(), &tun::public_of(&sk(7)), |s| shown.push(s.to_string()), Duration::from_secs(5)).unwrap();
    assert_eq!(out.token, "ab".repeat(32));
    assert_eq!(out.name, "사무실 아이맥");
    assert_eq!(shown.len(), 1, "숫자는 한 번 띄운다");
    assert_eq!(shown[0].len(), 7, "'123 456' 모양: {shown:?}");
}

#[test]
fn 거절_옛_판_꺼짐은_각자_이유로_끝난다() {
    let (url, _h) = hub("ok", false);
    assert_eq!(run_knock(&url, &me(), &tun::public_of(&sk(7)), |_| {}, Duration::from_secs(5)).err().as_deref(), Some("declined"));
    let (url, _h) = hub("unsupported", true);
    assert_eq!(run_knock(&url, &me(), &tun::public_of(&sk(7)), |_| {}, Duration::from_secs(5)).err().as_deref(), Some("old"));
    let (url, _h) = hub("offline", true);
    assert_eq!(run_knock(&url, &me(), &tun::public_of(&sk(7)), |_| {}, Duration::from_secs(5)).err().as_deref(), Some(crate::peer_conn::OFFLINE));
}

#[test]
fn 그_컴퓨터_열쇠가_다르면_상자를_못_열어_멈춘다() {
    let (url, _h) = hub("ok", true);
    // B 가 아는 A 열쇠가 sk(8) — 중계가 바꿔 끼운 것과 같음: A 는 B 의 link1 상자를 못 연다(가짜 허브 스레드가 끝남) → 시간 안에 끝
    let r = run_knock(&url, &me(), &tun::public_of(&sk(8)), |_| {}, Duration::from_secs(2));
    assert!(r.is_err());
}
