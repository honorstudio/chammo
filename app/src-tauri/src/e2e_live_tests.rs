//! 로컬 종단 시험 — 진짜 중계(wrangler dev, 평문 거절 켬) + 가짜 구글로 앱 코드가 서버와 끝까지 맞는지.
//! 준비(chammo-relay 저장소, 창 둘):
//!   npx wrangler dev --port 8787 --var PUBLIC_ORIGIN:http://localhost:8787 --var DEV_MOCK_GOOGLE:1 --var E2E_REQUIRED:1 \
//!     --var GOOGLE_AUTH_URL:http://127.0.0.1:8790/auth --var GOOGLE_TOKEN_URL:http://127.0.0.1:8790/token \
//!     --var GOOGLE_CLIENT_ID:test-client.apps.googleusercontent.com --var GOOGLE_CLIENT_SECRET:test-secret
//!   node scripts/mock-google.mjs
//! 돌리기: CHAMMO_E2E_LIVE=http://localhost:8787 cargo test e2e_flow::live -- --ignored --nocapture
//! 계정 둘(사용자: 맥·폰 / 철수: 맥) — 사슬 시작 → 확인 숫자로 폰 허용 → 4자리로 폰이 내 사슬 확인 → 내 기기끼리 봉투 왕복 → 팀·초대·명부 → DM 봉투 왕복 → 평문은 서버가 거절
use crate::accounts_store::fake::Fake;
use crate::e2e_flow::{self, Status};
use crate::e2e_state::{self, Unwrapped};
use crate::team_account::{self, Opener};
use crate::team_relay::{self as relay, Curl};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{Duration, Instant};

pub(crate) fn base() -> Option<String> {
    std::env::var("CHAMMO_E2E_LIVE").ok().filter(|s| !s.is_empty())
}

pub(crate) fn dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-live-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 가짜 구글 주소 — 다른 세션이 8790 을 쓰면 CHAMMO_MOCK_GOOGLE=http://127.0.0.1:<포트>(scripts/mock-google.mjs 는 MOCK_GOOGLE_PORT)
fn mock_google() -> String {
    std::env::var("CHAMMO_MOCK_GOOGLE").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "http://127.0.0.1:8790".into())
}

fn next_user(sub: &str, name: &str) {
    let ok = crate::platform::command("curl").args(["-s", "-o", "/dev/null", "-w", "%{http_code}", "-X", "POST", &format!("{}/next-user", mock_google()), "--data"])
        .arg(json!({ "sub": sub, "email": format!("{sub}@example.com"), "name": name }).to_string())
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&ok.stdout), "204", "가짜 구글(scripts/mock-google.mjs)이 떠 있어야");
}

/// 머리만 받는 GET — (Location, Set-Cookie 첫 값)
fn hop(url: &str, cookie: Option<&str>) -> (String, Option<String>) {
    let mut c = crate::platform::command("curl");
    c.args(["-s", "-D", "-", "-o", "/dev/null", url]);
    if let Some(k) = cookie {
        c.args(["-H", &format!("Cookie: {k}")]);
    }
    let out = String::from_utf8_lossy(&c.output().unwrap().stdout).to_string();
    let head = |name: &str| out.lines().find(|l| l.to_lowercase().starts_with(name)).map(|l| l[name.len()..].trim().to_string());
    (head("location:").unwrap_or_default(), head("set-cookie:").map(|v| v.split(';').next().unwrap_or("").to_string()))
}

/// 사람 브라우저 대신 — start → 가짜 구글 → callback(쿠키) → 앱 루프백. 로그인이 루프백을 기다리는 동안 따라가야 해서 따로 실이
struct Browser;
impl Opener for Browser {
    fn open(&self, url: &str) -> Result<(), String> {
        let url = url.to_string();
        std::thread::spawn(move || {
            let (to_google, cookie) = hop(&url, None);
            let (to_callback, _) = hop(&to_google, None);
            let (to_app, _) = hop(&to_callback, cookie.as_deref());
            let _ = crate::platform::command("curl").args(["-s", "-o", "/dev/null", &to_app]).status();
        });
        Ok(())
    }
}

pub(crate) fn login(tag: &str, server: &str, sub: &str, name: &str) -> (PathBuf, Fake) {
    next_user(sub, name);
    let d = dir(tag);
    let kc = Fake::default();
    team_account::login_with(&d, &kc, &Curl, &Browser, server, tag, Duration::from_secs(20)).unwrap();
    (d, kc)
}

/// 방 소켓 하나 — 붙어서 ready 까지 읽고 돌려준다
pub(crate) fn sock(d: &PathBuf, kc: &Fake, room: &str) -> crate::team_relay_ws::Ws {
    let st = relay::load_state(d);
    let k = relay::device_keys(kc, &st).unwrap();
    let url = relay::ws_url(&st, &k, room, now(), &crate::team_relay_keys::new_nonce().unwrap()).unwrap();
    let mut ws = crate::team_relay_ws::connect_url(&url).unwrap();
    while read(&mut ws)["t"] != "ready" {}
    ws
}

pub(crate) fn read(ws: &mut crate::team_relay_ws::Ws) -> Value {
    let until = Instant::now() + Duration::from_secs(10);
    loop {
        assert!(Instant::now() < until, "10초 동안 아무것도 안 옴");
        if let Ok(tungstenite::Message::Text(t)) = ws.read() {
            return serde_json::from_str(t.as_str()).unwrap();
        }
    }
}

fn send(ws: &mut crate::team_relay_ws::Ws, cid: &str, body: &str) -> Value {
    ws.send(tungstenite::Message::text(json!({ "t": "send", "cid": cid, "body": body, "origin": "agent" }).to_string())).unwrap();
    loop {
        let v = read(ws);
        if v["cid"] == cid {
            return v;
        }
    }
}

pub(crate) fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
}

#[test]
#[ignore]
fn 로컬_중계_종단_암호_끝까지() {
    let Some(server) = base() else { return eprintln!("CHAMMO_E2E_LIVE 없음 — 건너뜀") };
    let run = now();
    let (sub1, sub2) = (format!("live-y-{run}"), format!("live-c-{run}"));
    // ① 사용자 맥 — 첫 기기, 사슬 시작
    let (da, ka) = login("mac", &server, &sub1, "사용자");
    // R8 — 사슬 없는 계정은 사람이 '첫 기기'를 눌러야 시작한다. 그 전엔 평문 없이 보내기가 막힌다
    assert_eq!(e2e_flow::ensure(&da, &ka, &Curl).unwrap(), Status::NeedStart);
    e2e_flow::start_chain(&da, &ka, &Curl).unwrap();
    assert_eq!(e2e_flow::ensure(&da, &ka, &Curl).unwrap(), Status::InChain);
    // ② 사용자 폰 — 대기, 확인 숫자로 허용
    let (db, kb) = login("phone", &server, &sub1, "사용자");
    assert!(relay::load_state(&db).pending, "두 번째 기기는 대기");
    let target = relay::load_state(&db).device_id;
    e2e_flow::card_open(&da, &ka, &Curl, &target).unwrap();
    let sas_b = e2e_flow::my_number(&db, &kb, &Curl).unwrap().expect("새 기기 숫자");
    let sas_a = e2e_flow::card_number(&da, &ka, &Curl, &target).unwrap().expect("카드 숫자");
    eprintln!("확인 숫자: 새 기기 {sas_b:06} · 카드 {sas_a:06}");
    assert_eq!(sas_a, sas_b, "두 화면 숫자가 같다");
    assert!(e2e_flow::approve_with_number(&da, &ka, &Curl, &target, "000000").is_err() || sas_a == 0);
    let code = e2e_flow::approve_with_number(&da, &ka, &Curl, &target, &format!("{sas_a:06}")).unwrap();
    team_account::refresh_me(&db, &kb, &Curl).unwrap();
    assert!(!relay::load_state(&db).pending);
    // R7 — 4자리 넣기 전엔 내 사슬을 안 믿는다
    assert_eq!(e2e_flow::ensure(&db, &kb, &Curl).unwrap(), Status::NeedCode);
    eprintln!("4자리: {code}");
    e2e_flow::confirm_code(&db, &kb, &Curl, &code).unwrap();
    assert_eq!(e2e_flow::ensure(&db, &kb, &Curl).unwrap(), Status::InChain);
    // ③ 내 기기끼리 방 봉투 왕복 — 서버는 평문을 거절(E2E_REQUIRED)
    let room = relay::self_room(&da, &ka, &Curl).unwrap();
    relay::sync_rooms(&db, &kb, &Curl).unwrap();
    let mut wa = sock(&da, &ka, &room);
    let mut wb = sock(&db, &kb, &room);
    assert_eq!(send(&mut wa, "plain-1", "평문 안녕")["code"], "e2e_required", "평문은 서버가 거절");
    let secret = format!("내 기기끼리 비밀 {run}");
    let env = e2e_state::wrap(&da, &ka, &Curl, &room, "e-1", &secret, false, now()).expect("봉투");
    assert_eq!(send(&mut wa, "e-1", &env)["t"], "sent");
    let got = read(&mut wb);
    let stb = relay::load_state(&db);
    match e2e_state::unwrap(&db, &kb, &Curl, &stb, &got) {
        Unwrapped::Opened { text, note, .. } => assert_eq!((text.as_str(), note.as_str()), (secret.as_str(), "")),
        other => panic!("못 풀었다: {other:?}"),
    }
    // ④ 철수 — 다른 계정, 팀·초대·명부·DM
    let (dc, kc_) = login("chulsoo", &server, &sub2, "철수");
    assert_eq!(e2e_flow::ensure(&dc, &kc_, &Curl).unwrap(), Status::NeedStart);
    e2e_flow::start_chain(&dc, &kc_, &Curl).unwrap();
    assert_eq!(e2e_flow::ensure(&dc, &kc_, &Curl).unwrap(), Status::InChain);
    relay::create(&da, &ka, &Curl, "", &format!("라이브 {run}"), "사용자", "mac").unwrap();
    let inv = relay::invite(&da, &ka, &Curl, "").unwrap();
    relay::join(&dc, &kc_, &Curl, "", &inv.link, "철수", "chulsoo").unwrap();
    let dm = relay::open_dm(&da, &ka, &Curl, "", "철수").unwrap();
    relay::sync_rooms(&dc, &kc_, &Curl).unwrap();
    let mut wa2 = sock(&da, &ka, &dm.id);
    let mut wc = sock(&dc, &kc_, &dm.id);
    let hi = format!("철수야 DM 비밀 {run}");
    let env = e2e_state::wrap(&da, &ka, &Curl, &dm.id, "d-1", &hi, false, now()).expect("DM 봉투(명부·사슬 다 있음)");
    let v: Value = serde_json::from_str(&env).unwrap();
    assert!(v["env"].as_array().unwrap().len() >= 3, "받는 기기 = 내 맥·폰 + 철수 맥");
    assert_eq!(send(&mut wa2, "d-1", &env)["t"], "sent");
    let got = read(&mut wc);
    let stc = relay::load_state(&dc);
    match e2e_state::unwrap(&dc, &kc_, &Curl, &stc, &got) {
        Unwrapped::Opened { text, note, .. } => assert_eq!((text.as_str(), note.as_str()), (hi.as_str(), "")),
        other => panic!("철수가 못 풀었다: {other:?}"),
    }
    eprintln!("끝 — 계정 {sub1}·{sub2}, 방 {room}·{}", dm.id);
}

/// 계정 하나 + 사슬 시작(첫 기기)
fn chained(tag: &str, server: &str, sub: &str, name: &str) -> (PathBuf, Fake) {
    let (d, k) = login(tag, server, sub, name);
    e2e_flow::start_chain(&d, &k, &Curl).unwrap();
    assert_eq!(e2e_flow::ensure(&d, &k, &Curl).unwrap(), Status::InChain);
    (d, k)
}

/// t 가 올 때까지 읽는다 — 걸린 시간(ms)
fn wait_for(ws: &mut crate::team_relay_ws::Ws, t: &str, since: Instant) -> u128 {
    loop {
        if read(ws)["t"] == t {
            return since.elapsed().as_millis();
        }
    }
}

/// 단톡방(chammo-relay team-rooms) + 바로 알림 — 세 계정: 합류 알림·새 방 알림 지연을 재고, 방 사람만 봉투를 받고, 뺀 사람은 4003·다음 말부터 빠진다
/// 돌리기: CHAMMO_E2E_LIVE=http://localhost:8797 CHAMMO_MOCK_GOOGLE=http://127.0.0.1:8791 cargo test e2e_flow::live::단톡방 -- --ignored --nocapture
#[test]
#[ignore]
fn 단톡방_종단_암호와_바로_알림() {
    let Some(server) = base() else { return eprintln!("CHAMMO_E2E_LIVE 없음 — 건너뜀") };
    let run = now();
    let (da, ka) = chained("ra", &server, &format!("room-y-{run}"), "사용자");
    let (dc, kc) = chained("rc", &server, &format!("room-c-{run}"), "철수");
    let (dm, km) = chained("rm", &server, &format!("room-m-{run}"), "민수");
    relay::create(&da, &ka, &Curl, "", &format!("방 {run}"), "사용자", "mac").unwrap();
    let inv = relay::invite(&da, &ka, &Curl, "").unwrap();
    relay::join(&dc, &kc, &Curl, "", &inv.link, "철수", "c").unwrap();
    // ① 합류 알림 — 팀장 내 기기끼리 방 소켓에 team_changed 가 오기까지
    let mut self_a = sock(&da, &ka, &relay::self_room(&da, &ka, &Curl).unwrap());
    let inv = relay::invite(&da, &ka, &Curl, "").unwrap();
    while read(&mut self_a)["t"] != "team_changed" {} // 초대 고리 알림은 흘려보낸다
    let t0 = Instant::now();
    relay::join(&dm, &km, &Curl, "", &inv.link, "민수", "m").unwrap();
    let join_ms = wait_for(&mut self_a, "team_changed", t0);
    let t1 = Instant::now();
    relay::refresh_members(&da, &ka, &Curl, "").unwrap();
    let names_ms = t1.elapsed().as_millis();
    assert!(relay::load_state(&da).members.iter().any(|m| m.display_name == "민수"), "팀장 목록에 새 사람");
    eprintln!("합류 → 팀장 알림 {join_ms}ms(join 호출 포함) · 사람 목록 다시 받기 {names_ms}ms");
    // ② 단톡방 [사용자·철수] — 철수 알림 지연, 민수는 못 붙고 봉투에도 없다
    for (d, k) in [(&dc, &kc), (&dm, &km)] {
        relay::refresh_members(d, k, &Curl, "").unwrap();
    }
    let mut self_c = sock(&dc, &kc, &relay::self_room(&dc, &kc, &Curl).unwrap());
    let t2 = Instant::now();
    let room = crate::team_rooms::create_room(&da, &ka, &Curl, "", "디자인", &["철수".into()]).unwrap();
    let room_ms = wait_for(&mut self_c, "team_changed", t2);
    eprintln!("새 방 → 철수 알림 {room_ms}ms(만들기 호출 포함)");
    relay::sync_rooms(&dc, &kc, &Curl).unwrap();
    assert!(relay::load_state(&dc).rooms.iter().any(|r| r.id == room.id && r.kind == "group" && r.name == "디자인"));
    let st = relay::load_state(&dm);
    let k = relay::device_keys(&km, &st).unwrap();
    let url = relay::ws_url(&st, &k, &room.id, now(), &crate::team_relay_keys::new_nonce().unwrap()).unwrap();
    assert!(crate::team_relay_ws::connect_url(&url).is_err(), "방 밖 민수는 못 붙는다");
    let mut wa = sock(&da, &ka, &room.id);
    let mut wc = sock(&dc, &kc, &room.id);
    let hi = format!("디자인 방 비밀 {run}");
    let env = e2e_state::wrap(&da, &ka, &Curl, &room.id, "g-1", &hi, false, now()).expect("단톡방 봉투");
    let devs: Vec<String> = serde_json::from_str::<Value>(&env).unwrap()["env"].as_array().unwrap().iter().map(|e| e["d"].as_str().unwrap().to_string()).collect();
    assert!(!devs.contains(&relay::load_state(&dm).device_id), "민수 기기엔 봉투 없음");
    assert_eq!(send(&mut wa, "g-1", &env)["t"], "sent");
    let got = read(&mut wc);
    match e2e_state::unwrap(&dc, &kc, &Curl, &relay::load_state(&dc), &got) {
        Unwrapped::Opened { text, note, .. } => assert_eq!((text.as_str(), note.as_str()), (hi.as_str(), "")),
        other => panic!("철수가 못 풀었다: {other:?}"),
    }
    // ②-1 반응·파일 참조 — 봉투 안쪽에 실려 사용자가 그대로 받는다(v2)
    let extra = crate::e2e_envelope::Extra { react: Some(crate::e2e_envelope::React { seq: 1, mark: "check".into(), on: true }), files: vec![json!({ "id": "f1", "name": "시안.pdf", "size": 1200 })] };
    let env = e2e_state::wrap_with(&dc, &kc, &Curl, &room.id, "g-r", "", true, now(), extra.clone()).expect("반응 봉투");
    assert_eq!(send(&mut wc, "g-r", &env)["t"], "sent");
    let got = read(&mut wa);
    match e2e_state::unwrap(&da, &ka, &Curl, &relay::load_state(&da), &got) {
        Unwrapped::Opened { extra: e, .. } => assert_eq!(e, extra),
        other => panic!("사용자가 반응을 못 풀었다: {other:?}"),
    }
    // ③ 첫 DM(새 방) — 민수 알림 지연
    let mut self_m = sock(&dm, &km, &relay::self_room(&dm, &km, &Curl).unwrap());
    let t3 = Instant::now();
    relay::open_dm(&da, &ka, &Curl, "", "민수").unwrap();
    let dm_ms = wait_for(&mut self_m, "team_changed", t3);
    eprintln!("첫 DM → 민수 알림 {dm_ms}ms(DM 열기 호출 포함)");
    // ④ 철수 빼기 — 철수 소켓 4003, 다음 봉투엔 철수 기기 없음
    crate::team_rooms::update_room(&da, &ka, &Curl, &room.id, None, &[], &["철수".into()]).unwrap();
    let until = Instant::now() + Duration::from_secs(10);
    let code = loop {
        assert!(Instant::now() < until, "철수 소켓이 안 닫힘");
        match wc.read() {
            Ok(tungstenite::Message::Close(f)) => break f.map(|f| u16::from(f.code)),
            Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => break None,
            _ => {}
        }
    };
    assert_eq!(code, Some(4003));
    let env = e2e_state::wrap(&da, &ka, &Curl, &room.id, "g-2", "철수 빠진 뒤", false, now()).expect("나만 남은 방도 봉투(내 기기)");
    let devs: Vec<String> = serde_json::from_str::<Value>(&env).unwrap()["env"].as_array().unwrap().iter().map(|e| e["d"].as_str().unwrap().to_string()).collect();
    assert!(!devs.contains(&relay::load_state(&dc).device_id), "뺀 철수 기기는 다음 말부터 빠진다");
    eprintln!("끝 — 방 {} · 지연 합류 {join_ms}ms · 새 방 {room_ms}ms · 첫 DM {dm_ms}ms", room.id);
}
