//! 팀챗·DM 참모 부름 실측(verify/team-call). 10-28 사용자 "호출을 남이 하면 안 될 듯" 뒤로는 기대가 뒤집혔다 —
//! 어떤 부름 모양이든 남의 말은 내 참모 입력칸에 0건(기록·알림만), 내 참모 답은 그대로 상대에게 '남의 참모' 말로 간다.
//! 로컬 중계 + 가짜 구글, 계정 둘: 사용자 = 받는 쪽(앱의 진짜 받기 루프 team_relay_ws::Loop + 시험 키체인 파일), 지수 = 부르는 쪽.
//! 지수가 DM·팀챗에 부르는 모양마다 사람 말로 보냄 → 사용자 Loop 가 기록만 하고 참모에게 안 넘기나(sink 0건)
//! → 사용자 참모 답(Loop 보내기, 참모 말) → 지수가 '남의 참모' 말로 받나.
//! 준비는 e2e_live_tests.rs 머리와 같다. 돌리기:
//!   CHAMMO_E2E_LIVE=http://localhost:8817 CHAMMO_MOCK_GOOGLE=http://127.0.0.1:8811 \
//!     cargo test team_relay_inbox::call_live -- --ignored --nocapture --test-threads 1
use crate::accounts_store::Keychain;
use crate::e2e_flow::live::{base, dir, login, next_user, now, read, sock, Browser};
use crate::e2e_flow::{self, Status};
use crate::e2e_state::{self, Unwrapped};
use crate::team_relay::{self as relay, Curl};
use crate::team_relay_inbox::{self as inbox, Action};
use crate::team_relay_ws::{Cmd, Loop, Ws};
use serde_json::{json, Value};
use std::path::Path;
use std::time::{Duration, Instant};

const HQ: &str = "/tmp/chammo-call-hq";

/// 사용자 HQ 참모들 — 설정 참모 이름은 참모
fn sessions() -> String {
    json!([
        { "id": "a1", "name": "참모", "cwd": HQ, "state": "idle" },
        { "id": "a2", "name": "참모-2 · 참모 업데이트", "cwd": HQ, "state": "idle" },
        { "id": "a3", "name": "참모-2 · 디자인 담당", "cwd": HQ, "state": "idle" },
        { "id": "h1", "name": "sns-post", "cwd": HQ, "state": "idle" },
    ])
    .to_string()
}

fn send_as(ws: &mut Ws, cid: &str, env: &str, origin: &str) -> u64 {
    ws.send(tungstenite::Message::text(json!({ "t": "send", "cid": cid, "body": env, "origin": origin }).to_string())).unwrap();
    loop {
        let v = read(ws);
        if v["cid"] == cid {
            assert_eq!(v["t"], "sent", "{v}");
            return v["seq"].as_u64().unwrap();
        }
    }
}

/// 사용자 기록(team-inbox.jsonl)에 그 방·seq 줄이 생길 때까지
fn note_of(d: &Path, room: &str, seq: u64) -> String {
    let until = Instant::now() + Duration::from_secs(15);
    loop {
        assert!(Instant::now() < until, "사용자 Loop 가 {room}#{seq} 를 15초 안에 기록 안 함");
        let t = std::fs::read_to_string(d.join(inbox::INBOX_FILE)).unwrap_or_default();
        if let Some(v) = t.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).find(|v| v["room"] == room && v["seq"] == seq) {
            return v["note"].as_str().unwrap_or("").to_string();
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[test]
#[ignore]
fn 팀챗_DM_참모_부름_끝까지() {
    let Some(server) = base() else { return eprintln!("CHAMMO_E2E_LIVE 없음 — 건너뜀") };
    let run = now();
    // 사용자 — 시험 키체인 파일(Loop 가 team_relay_keys::store() 로 같은 파일을 읽는다)
    use security_framework::os::macos::keychain::{CreateOptions, KeychainSettings};
    let kpath = std::env::temp_dir().join(format!("chammo-call-{}.keychain-db", std::process::id()));
    let _ = std::fs::remove_file(&kpath);
    CreateOptions::new().password("test").create(&kpath).unwrap().set_settings(&KeychainSettings::new()).unwrap();
    std::env::set_var("CHAMMO_TEAM_KEYCHAIN", &kpath);
    std::env::set_var("CHAMMO_TEAM_KEYCHAIN_PASSWORD", "test");
    let ka: Keychain = crate::team_relay_keys::store();
    next_user(&format!("call-y-{run}"), "사용자");
    let da = dir("call-a");
    crate::team_account::login_with(&da, &ka, &Curl, &Browser, &server, "call-a", Duration::from_secs(20)).unwrap();
    e2e_flow::start_chain(&da, &ka, &Curl).unwrap();
    assert_eq!(e2e_flow::ensure(&da, &ka, &Curl).unwrap(), Status::InChain);
    // 지수 — 부르는 쪽(가짜 키체인, 이 실에서만)
    let (db, kb) = login("call-b", &server, &format!("call-j-{run}"), "지수");
    e2e_flow::start_chain(&db, &kb, &Curl).unwrap();
    assert_eq!(e2e_flow::ensure(&db, &kb, &Curl).unwrap(), Status::InChain);
    relay::create(&da, &ka, &Curl, "", &format!("부름 {run}"), "사용자", "mac").unwrap();
    let inv = relay::invite(&da, &ka, &Curl, "").unwrap();
    relay::join(&db, &kb, &Curl, "", &inv.link, "지수", "b").unwrap();
    for (d, k) in [(&da, &ka as &dyn crate::accounts_store::Store), (&db, &kb)] {
        relay::refresh_members(d, k, &Curl, "").unwrap();
        crate::team_account::refresh_me(d, k, &Curl).unwrap();
    }
    let dm = relay::open_dm(&db, &kb, &Curl, "", "사용자").unwrap();
    let room = crate::team_rooms::create_room(&da, &ka, &Curl, "", "회의", &["지수".into()]).unwrap();
    for (d, k) in [(&da, &ka as &dyn crate::accounts_store::Store), (&db, &kb)] {
        relay::sync_rooms(d, k, &Curl).unwrap();
        relay::refresh_members(d, k, &Curl, "").unwrap();
    }
    assert!(relay::load_state(&da).device_created_at > 0, "만든 때를 알아야 넘긴다");
    // 사용자 앱 — 진짜 받기 루프
    let (tx, rx) = std::sync::mpsc::channel();
    let (stx, srx) = std::sync::mpsc::channel::<String>();
    let keys = relay::device_keys(&ka, &relay::load_state(&da)).unwrap();
    let d2 = da.clone();
    std::thread::spawn(move || {
        Loop::new(d2, keys, Box::new(move |t| {
            let _ = stx.send(t);
        }), rx)
        .run()
    });
    let mut wdm = sock(&db, &kb, &dm.id);
    let mut wroom = sock(&db, &kb, &room.id);
    // (방, 부르는 글, 넘겨야 하나)
    let cases: Vec<(&str, &str, bool)> = vec![
        ("DM", "@참모 내일 일정 알려줘", false),
        ("DM", "@Chammo what's up", false),
        ("DM", "@참모 이거 봐줘", false),
        ("DM", "@참모-2 이거 봐줘", false),
        ("DM", "@사용자의참모 회의록 부탁", false),
        ("DM", "@사용자의 참모 회의록 부탁", false),
        ("DM", "@사용자 의참모 회의록 부탁", false),
        ("DM", "@디자인 담당 시안 봐줘", false),
        ("DM", "@사용자의참모 @디자인 담당 시안 봐줘", false),
        ("DM", "사용자님 내일 봬요", false),
        ("DM", "메일은 jisu@참모.com 으로", false),
        ("팀챗", "@사용자의참모 회의록 정리해줘", false),
        ("팀챗", "@사용자 @참모 회의록 정리해줘", false),
        ("팀챗", "@사용자의참모 @참모-2 정리해줘", false),
        ("팀챗", "@사용자 의참모 정리해줘", false),
        ("팀챗", "@참모 정리해줘", false),
        ("팀챗", "@참모-2 정리해줘", false),
        ("팀챗", "@사용자 내일 봬요", false),
        ("팀챗", "@팀참모 요약해줘", false),
    ];
    let sess = sessions();
    let mut table = Vec::new();
    let mut given: Vec<Instant> = Vec::new();
    for (i, (where_, body, want)) in cases.iter().enumerate() {
        // 사람마다 1분 6개 상한(peer PER_MIN) — 시험이 상한에 걸리지 않게 쉰다
        given.retain(|t| t.elapsed() < Duration::from_secs(61));
        if *want && given.len() >= crate::peer_link::PER_MIN {
            let wait = Duration::from_secs(62).saturating_sub(given[0].elapsed());
            eprintln!("…1분 6개 상한 — {}초 쉼", wait.as_secs());
            std::thread::sleep(wait);
            given.clear();
        }
        let (rid, ws) = if *where_ == "DM" { (dm.id.as_str(), &mut wdm) } else { (room.id.as_str(), &mut wroom) };
        let cid = format!("c{i}-{run}");
        let env = e2e_state::wrap(&db, &kb, &Curl, rid, &cid, body, true, now()).expect("지수 사람 말 봉투");
        let seq = send_as(ws, &cid, &env, "human");
        let note = note_of(&da, rid, seq);
        let got = srx.recv_timeout(Duration::from_secs(if note == "delivered" { 5 } else { 1 })).ok();
        if got.is_some() {
            given.push(Instant::now());
        }
        let to = got.as_deref().and_then(|t| inbox::called(&sess, HQ, "참모", t).or_else(|| inbox::assistant(&relay::load_state(&da), &sess, HQ, "참모")));
        let head = got.as_deref().and_then(|t| t.lines().next()).unwrap_or("").to_string();
        eprintln!("{where_:4} | {body:32} | note={note:10} | 넘김={} | 참모={} | {head}", got.is_some(), to.as_deref().unwrap_or("-"));
        table.push((where_.to_string(), body.to_string(), *want, got.is_some(), to, note));
    }
    // 사용자 참모 답 — 앱 Loop 의 보내기(scripts/team say → team_cmd → send_with 와 같은 Cmd::Send, 사람 표 없음 = 참모 말)
    let say = |rid: &str, cid: &str, text: &str| -> u64 {
        let extra = crate::e2e_envelope::Extra { by: "참모".into(), ..Default::default() };
        let wire = e2e_state::wrap_with(&da, &ka, &Curl, rid, cid, text, false, now(), extra.clone()).expect("사용자 참모 봉투");
        let (rtx, rrx) = std::sync::mpsc::channel();
        tx.send(Cmd::Send { room: rid.into(), cid: cid.into(), body: text.into(), wire, human: None, extra, reply: rtx }).unwrap();
        rrx.recv_timeout(Duration::from_secs(15)).unwrap().unwrap()
    };
    let replies = [(dm.id.clone(), "내일 10시 회의 하나 있어요"), (room.id.clone(), "@지수 회의록 정리했어요"), (room.id.clone(), "회의록 정리했어요")];
    let stb = relay::load_state(&db);
    for (i, (rid, text)) in replies.iter().enumerate() {
        let seq = say(rid, &format!("r{i}-{run}"), text);
        let ws = if *rid == dm.id { &mut wdm } else { &mut wroom };
        let v = loop {
            let v = read(ws);
            if v["t"] == "msg" && v["seq"] == seq {
                break v;
            }
        };
        let opened = e2e_state::unwrap(&db, &kb, &Curl, &stb, &v);
        assert!(matches!(opened, Unwrapped::Opened { human: false, .. }), "지수가 참모 말로 열어야: {opened:?}");
        let (act, rec) = inbox::with_e2e(&stb, 0, &v, &opened);
        let head = match &act {
            Action::Deliver(t) => t.lines().next().unwrap_or("").to_string(),
            _ => String::new(),
        };
        eprintln!("답 → 지수 | {text:24} | origin={} by={} note={} | 지수 참모에게 넘김={} {head}", rec.origin, rec.extra.by, rec.note, matches!(act, Action::Deliver(_)));
        assert_eq!(rec.origin, "agent");
        assert_eq!(rec.body, *text);
        assert!(!matches!(act, Action::Deliver(_)), "지수 참모 입력칸에도 저절로 안 간다");
    }
    tx.send(Cmd::Stop).unwrap();
    let _ = std::fs::remove_file(&kpath);
    let wrong: Vec<_> = table.iter().filter(|r| r.2 != r.3).collect();
    assert!(wrong.is_empty(), "기대와 다른 부름: {wrong:?}");
}
