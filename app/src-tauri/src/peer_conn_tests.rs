use super::*;
use crate::mobile_http::Resp;
use crate::phone_relay_core::{reply_chunks, Ev, Lines, Tunnels};
use crate::phone_tunnel as tun;
use p256::SecretKey;
use serde_json::{json, Value};
use std::net::TcpListener;
use tungstenite::Message;

// 진짜 중계 없이 — 이 시험 안에 가짜 허브(로컬 ws)를 띄우고, 받는 컴퓨터는 지금 폰 길 코드(Tunnels·reply_chunks)를 그대로 쓴다

fn sk(b: u8) -> SecretKey {
    tun::secret_from_seed(&[b; 32]).unwrap()
}

struct Owner {
    me: SecretKey,
    guest: Vec<u8>,
}

impl Lines for Owner {
    fn line_of(&self, relay: &str) -> Option<(String, Vec<u8>)> {
        (relay == "dev-b").then(|| ("peer-line".into(), self.guest.clone()))
    }
    fn agree(&self, their: &[u8]) -> Option<[u8; 32]> {
        tun::agree(&self.me, their).ok()
    }
}

/// 가짜 허브 + 주인 — on = 주인이 붙어 있나. 받은 요청 경로를 답 몸통으로 돌려준다
fn hub(on: bool) -> (String, std::thread::JoinHandle<()>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("ws://{}/v0/hubs/dev-a/ws", l.local_addr().unwrap());
    let h = std::thread::spawn(move || {
        let (tcp, _) = l.accept().unwrap();
        let mut ws = tungstenite::accept(tcp).unwrap();
        ws.send(Message::text(json!({ "t": "owner", "on": on }).to_string())).unwrap();
        if !on {
            return;
        }
        let o = Owner { me: sk(7), guest: tun::public_of(&sk(9)) };
        let mut t = Tunnels::default();
        while let Ok(m) = ws.read() {
            let Message::Text(txt) = m else { continue };
            let v: Value = serde_json::from_str(txt.as_str()).unwrap();
            let frame = tun::unb64(v["d"].as_str().unwrap()).unwrap();
            for ev in t.on_frame(&o, "dev-b", "c1", &frame) {
                let out: Vec<Vec<u8>> = match ev {
                    Ev::Send(f) => vec![f],
                    Ev::Run(req) => reply_chunks(&req, &Resp { status: 200, headers: vec![("Content-Type", "text/plain".into())], body: format!("{} {}", req.method, req.path).into_bytes() }).into_iter().map(|pt| t.seal("c1", &pt).unwrap()).collect(),
                    Ev::Drop(_) => return,
                };
                for f in out {
                    ws.send(Message::text(json!({ "t": "f", "d": tun::b64(&f) }).to_string())).unwrap();
                }
            }
        }
    });
    (url, h)
}

fn shared() -> ([u8; 32], Vec<u8>) {
    (tun::agree(&sk(9), &tun::public_of(&sk(7))).unwrap(), tun::public_of(&sk(9)))
}

#[test]
fn 허브에_손님으로_붙어_요청을_두_번_주고받는다() {
    let (url, _h) = hub(true);
    let (s, pk) = shared();
    let mut c = PeerConn::open(&url, s, pk, Duration::from_secs(5)).expect("열림");
    let d = c.call("GET", "/api/sessions", &[], b"", Duration::from_secs(5)).unwrap();
    assert_eq!((d.status, d.body.as_slice()), (200, &b"GET /api/sessions"[..]));
    let d = c.call("POST", "/api/peer-say", &[("content-type".into(), "application/json".into())], b"{}", Duration::from_secs(5)).unwrap();
    assert_eq!(d.body, b"POST /api/peer-say");
}

#[test]
fn 주인이_없으면_꺼져_있음으로_끝난다() {
    let (url, _h) = hub(false);
    let (s, pk) = shared();
    let e = PeerConn::open(&url, s, pk, Duration::from_secs(5)).err().expect("못 엶");
    assert_eq!(e, OFFLINE);
}

#[test]
fn 주인_열쇠가_다르면_열지_않는다() {
    let (url, _h) = hub(true);
    // 손님이 아는 A 열쇠가 다르다(중계가 바꿔 끼움과 같음)
    let wrong = tun::agree(&sk(9), &tun::public_of(&sk(8))).unwrap();
    assert!(PeerConn::open(&url, wrong, tun::public_of(&sk(9)), Duration::from_secs(5)).is_err());
}

// ── 원격 보기 한 시간 — 허브로 들어오는 틀 수(계획 2026-11-01-peer-relay '폴링 vs 바뀔 때만', 참모-2 11-01 perf 항목) ──
// 실제 묻는 주기(app/src/ui/far/useFarRead.ts: 세션 5초·일 꼬리 15초(두 갈래)·보관함 30초, RemoteChat 3초, remote.rs cards_now 4초에 두 갈래)대로
// 한 번씩 보내 요청 하나가 몇 틀인지 세고 한 시간 횟수를 곱한다. 예산은 docs/perf-budgets.json peer
const FAR_HOUR: &[(&str, usize, usize)] = &[("/api/sessions", 720, 4_000), ("/api/tasks", 240, 2_000), ("/api/tails", 240, 6_000), ("/api/peer-locker", 120, 3_000), ("/api/transcript", 1200, 20_000)];
const CARDS_HOUR: &[(&str, usize, usize)] = &[("/api/direct", 900, 8_000), ("/api/sessions", 900, 4_000)];

/// 틀을 세는 가짜 허브 — (손님 → 허브, 주인 → 허브) 둘 다 DO 로 들어오는 틀. 답 몸통 크기는 경로마다
fn counting_hub(sizes: Vec<(&'static str, usize)>) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let n = std::sync::Arc::new(AtomicUsize::new(0));
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("ws://{}/v0/hubs/dev-a/ws", l.local_addr().unwrap());
    let count = n.clone();
    std::thread::spawn(move || {
        let (tcp, _) = l.accept().unwrap();
        let mut ws = tungstenite::accept(tcp).unwrap();
        ws.send(Message::text(json!({ "t": "owner", "on": true }).to_string())).unwrap();
        let o = Owner { me: sk(7), guest: tun::public_of(&sk(9)) };
        let mut t = Tunnels::default();
        while let Ok(m) = ws.read() {
            let Message::Text(txt) = m else { continue };
            count.fetch_add(1, Ordering::SeqCst);
            let v: Value = serde_json::from_str(txt.as_str()).unwrap();
            for ev in t.on_frame(&o, "dev-b", "c1", &tun::unb64(v["d"].as_str().unwrap()).unwrap()) {
                let out: Vec<Vec<u8>> = match ev {
                    Ev::Send(f) => vec![f],
                    Ev::Run(req) => {
                        let size = sizes.iter().find(|(p, _)| *p == req.path).map_or(100, |(_, s)| *s);
                        // 글 답(JSON) — 압축이 되는 모양 그대로(같은 글자 반복은 너무 잘 줄어서 섞는다)
                        let body: Vec<u8> = (0..size).map(|i| b"{\"a\":\"x1y2\",}"[i % 13] ^ (i as u8 & 1)).collect();
                        reply_chunks(&req, &Resp { status: 200, headers: vec![("Content-Type", "application/json".into())], body }).into_iter().map(|pt| t.seal("c1", &pt).unwrap()).collect()
                    }
                    Ev::Drop(_) => return,
                };
                for f in out {
                    count.fetch_add(1, Ordering::SeqCst);
                    ws.send(Message::text(json!({ "t": "f", "d": tun::b64(&f) }).to_string())).unwrap();
                }
            }
        }
    });
    (url, n)
}

fn hour_frames(plan: &[(&'static str, usize, usize)]) -> usize {
    use std::sync::atomic::Ordering;
    let (url, n) = counting_hub(plan.iter().map(|(p, _, s)| (*p, *s)).collect());
    let (s, pk) = shared();
    let mut c = PeerConn::open(&url, s, pk, Duration::from_secs(5)).unwrap();
    let mut total = n.load(Ordering::SeqCst); // hello 오가기(연결 한 번)
    for (path, per_hour, _) in plan {
        let before = n.load(Ordering::SeqCst);
        c.call("GET", path, &[], b"", Duration::from_secs(5)).unwrap();
        // 주인이 마지막 조각을 보내고 세는 사이를 기다린다
        std::thread::sleep(Duration::from_millis(20));
        total += (n.load(Ordering::SeqCst) - before) * per_hour;
    }
    total
}

#[test]
fn 원격_보기_한_시간_허브_틀이_예산_안() {
    // 예산 파일은 원본 저장소 docs/ 에만 있다 — 공개본(docs/ 를 안 담음)에선 건너뛴다(include_str! 면 공개본 cargo test 가 컴파일부터 깨졌다, 0.4.8 1차)
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/perf-budgets.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        eprintln!("perf-budgets.json 없음 — 건너뜀");
        return;
    };
    let budget: Value = serde_json::from_str(&text).unwrap();
    let (view, cards) = (hour_frames(FAR_HOUR), hour_frames(CARDS_HOUR));
    eprintln!("peer.view_hour_frames={view} peer.cards_hour_frames={cards}");
    assert!(view as u64 <= budget["peer"]["view_hour_frames"].as_u64().unwrap(), "원격 보기 {view}");
    assert!(cards as u64 <= budget["peer"]["cards_hour_frames"].as_u64().unwrap(), "카드 {cards}");
}

// C-5 실측 ④ — 요청마다 걸린 ms 를 모아 p50·p95(정밀 지연은 앱 안에서만 잴 수 있다 — scripts/peer 는 3초 간격으로 답을 본다)
#[test]
fn 요청_시간을_모아_p95_를_낸다() {
    let mut s = Lat::default();
    for ms in 1..=100u32 {
        s.push(ms);
    }
    assert_eq!(s.pct(50), Some(50));
    assert_eq!(s.pct(95), Some(95));
    assert_eq!(Lat::default().pct(95), None);
    // 최근 것만(오래된 건 밀려난다)
    for _ in 0..LAT_KEEP {
        s.push(1000);
    }
    assert_eq!(s.pct(50), Some(1000));
    assert_eq!(s.len(), LAT_KEEP);
}

// C-6 ③ — p95 1.7초 원인부터: 단계별(연결·hello·요청·쉬었다 온 요청·주인 처리·다시 시도) ms 를 따로 모아 한 줄로(고치기 전에 잰다)
#[test]
fn 단계별_지연을_한_줄로() {
    let mut m: std::collections::BTreeMap<&'static str, Lat> = Default::default();
    for ms in 1..=100u32 {
        m.entry("call").or_default().push(ms);
    }
    m.entry("connect").or_default().push(300);
    m.entry("hello").or_default().push(120);
    m.entry("retry").or_default().push(0);
    let s = stage_line(&m);
    assert!(s.contains("call p50 50·p95 95ms(100)"), "{s}");
    assert!(s.contains("connect p50 300·p95 300ms(1)") && s.contains("hello p50 120·p95 120ms(1)") && s.contains("retry 1번"), "{s}");
}
