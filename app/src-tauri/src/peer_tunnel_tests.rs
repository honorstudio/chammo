use super::*;
use crate::mobile_http::Resp;
use crate::phone_relay_core::{reply_chunks, Ev, Lines, Tunnels};
use crate::phone_tunnel as tun;
use p256::SecretKey;

// 손님(이 모듈) ↔ 주인(지금 폰 길이 쓰는 phone_relay_core::Tunnels)을 허브 없이 맞물려 본다 — 두 쪽이 같은 틀 모양을 쓰는지가 이 시험의 몫

fn sk(b: u8) -> SecretKey {
    tun::secret_from_seed(&[b; 32]).unwrap()
}

struct Owner {
    me: SecretKey,
    guest_pub: Vec<u8>,
}

impl Lines for Owner {
    fn line_of(&self, relay: &str) -> Option<(String, Vec<u8>)> {
        (relay == "dev-b").then(|| ("peer-line".to_string(), self.guest_pub.clone()))
    }
    fn agree(&self, their: &[u8]) -> Option<[u8; 32]> {
        tun::agree(&self.me, their).ok()
    }
}

/// 손님 B 가 주인 A 에 붙는다 — (손님, 주인 터널, 주인 열쇠 묶음)
fn pair(owner_key_for_guest: &SecretKey) -> (Guest, Tunnels, Owner) {
    let (a, b) = (sk(7), sk(9));
    let shared = tun::agree(&b, &tun::public_of(owner_key_for_guest)).unwrap();
    let g = Guest::with_nonce(shared, tun::public_of(&b), [5u8; tun::NONCE_LEN].to_vec());
    (g, Tunnels::default(), Owner { me: a, guest_pub: tun::public_of(&b) })
}

/// hello 를 오가게 해 세션을 연다
fn open(g: &mut Guest, t: &mut Tunnels, o: &Owner) {
    let ev = t.on_frame(o, "dev-b", "c1", &g.hello());
    let Ev::Send(reply) = &ev[0] else { panic!("{ev:?}") };
    assert!(g.on_frame(reply).unwrap().is_empty());
    assert!(g.ready());
}

/// 손님 요청 틀을 주인에게 넣고, 주인이 resp 로 답한 조각을 손님에게 돌려 완성된 응답을 받는다
fn round(g: &mut Guest, t: &mut Tunnels, o: &Owner, method: &str, path: &str, body: &[u8], gz: bool, resp: impl Fn(&crate::phone_relay_core::TReq) -> Resp) -> (crate::phone_relay_core::TReq, Done) {
    let (id, frames) = g.request(method, path, &[("authorization".into(), "Bearer t".into())], body, gz).unwrap();
    let mut got = None;
    for f in frames {
        for ev in t.on_frame(o, "dev-b", "c1", &f) {
            if let Ev::Run(r) = ev {
                got = Some(r);
            }
        }
    }
    let req = got.expect("주인이 요청을 다 모았다");
    assert_eq!(req.id, id);
    let mut done = vec![];
    for pt in reply_chunks(&req, &resp(&req)) {
        let f = t.seal("c1", &pt).unwrap();
        done.extend(g.on_frame(&f).unwrap());
    }
    assert_eq!(done.len(), 1, "응답 하나로 끝난다");
    (req, done.pop().unwrap())
}

#[test]
fn 손님이_주인_폰서버에_get_하고_답을_받는다() {
    let a = sk(7);
    let (mut g, mut t, o) = pair(&a);
    open(&mut g, &mut t, &o);
    let (req, d) = round(&mut g, &mut t, &o, "GET", "/api/sessions", b"", false, |_| Resp { status: 200, headers: vec![("Content-Type", "application/json".into())], body: b"[1,2]".to_vec() });
    assert_eq!((req.method.as_str(), req.path.as_str()), ("GET", "/api/sessions"));
    assert!(req.headers.contains(&("authorization".into(), "Bearer t".into())), "열쇠 머리가 넘어간다: {:?}", req.headers);
    assert_eq!((d.status, d.body.as_slice()), (200, &b"[1,2]"[..]));
    assert!(d.headers.iter().any(|(k, v)| k.eq_ignore_ascii_case("content-type") && v == "application/json"));
}

#[test]
fn 큰_요청_몸통과_큰_응답은_조각으로_오가고_gzip_은_풀려서_온다() {
    let a = sk(7);
    let (mut g, mut t, o) = pair(&a);
    open(&mut g, &mut t, &o);
    let body = vec![b'q'; tun_chunk() * 2 + 10];
    let big = "{\"a\":\"".to_string() + &"z".repeat(tun_chunk() * 3) + "\"}";
    let (req, d) = round(&mut g, &mut t, &o, "POST", "/api/peer-say", &body, true, |_| Resp { status: 200, headers: vec![("Content-Type", "application/json".into())], body: big.clone().into_bytes() });
    assert_eq!(req.body, body, "요청 몸통이 그대로 모였다");
    assert_eq!(d.body, big.into_bytes(), "압축한 답을 풀어서 준다");
    assert!(!d.headers.iter().any(|(k, _)| k == crate::phone_relay_core::GZ), "압축 표시는 안 넘긴다");
}

#[test]
fn 주인_열쇠가_다르면_확인에서_막힌다() {
    // 손님은 sk(8) 을 주인 열쇠로 알고 있다 — 진짜 주인(sk(7))이 답하면 확인 글이 안 풀린다(중계가 열쇠를 바꿔 끼운 것과 같다)
    let (mut g, mut t, o) = pair(&sk(8));
    let ev = t.on_frame(&o, "dev-b", "c1", &g.hello());
    let Ev::Send(reply) = &ev[0] else { panic!() };
    assert!(g.on_frame(reply).is_err());
    assert!(!g.ready());
    assert!(g.request("GET", "/api/env", &[], b"", false).is_err(), "세션 없이는 못 보낸다");
}

#[test]
fn 번호를_건너뛴_틀은_버린다() {
    let a = sk(7);
    let (mut g, mut t, o) = pair(&a);
    open(&mut g, &mut t, &o);
    let (_, frames) = g.request("GET", "/api/env", &[], b"", false).unwrap();
    let req = t.on_frame(&o, "dev-b", "c1", &frames[0]).into_iter().find_map(|e| if let Ev::Run(r) = e { Some(r) } else { None }).unwrap();
    let pts = reply_chunks(&req, &Resp { status: 200, headers: vec![], body: b"ok".to_vec() });
    let _skipped = t.seal("c1", &pts[0]).unwrap();
    let again = t.seal("c1", &pts[0]).unwrap();
    assert!(g.on_frame(&again).is_err(), "1 다음에 2 가 와야 한다");
}

fn tun_chunk() -> usize {
    crate::phone_relay_core::CHUNK
}

// 리뷰 ② — 열린 뒤 HELLO 가 또 오면(중계가 옛 답을 되넣음) 같은 열쇠로 번호가 처음부터라 nonce 를 다시 쓴다 → 연결을 버린다
#[test]
fn 열린_뒤_다시_온_hello_는_버린다() {
    let a = sk(7);
    let (mut g, mut t, o) = pair(&a);
    let ev = t.on_frame(&o, "dev-b", "c1", &g.hello());
    let Ev::Send(reply) = &ev[0] else { panic!() };
    g.on_frame(reply).unwrap();
    assert!(g.on_frame(reply).is_err(), "되넣은 hello");
    assert!(!g.ready(), "버린 연결은 더 못 보낸다(새 Guest 로 다시)");
    assert!(g.request("GET", "/api/env", &[], b"", false).is_err());
}
