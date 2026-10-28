//! 읽음 실측(chammo-relay ADR 0012) — 진짜 로컬 중계 + 사용자 앱의 진짜 받기 루프(team_relay_ws::Loop).
//! 사용자(맥 Loop + 같은 멤버 연결 하나 더 = '아이맥') · 지수(소켓). 지수가 DM 에 사람 말 → 아이맥에서 읽음 →
//! 사용자 맥 Loop 가 받아 team-reads.json 의 내 자리가 오르나(배지 사라짐) · 지수 화면에 사용자 읽음이 오나 ·
//! 맥 화면이 읽음(Cmd::Read) → 지수·아이맥에 퍼지나 · 다시 붙으면 ready.reads 로 받나. 준비는 e2e_live_tests.rs 머리와 같다:
//!   CHAMMO_E2E_LIVE=http://localhost:8827 CHAMMO_MOCK_GOOGLE=http://127.0.0.1:8821 \
//!     cargo test team_reads::live -- --ignored --nocapture --test-threads 1
use crate::e2e_flow::live::{base, login, now, read, sock};
use crate::e2e_flow::{self, Status};
use crate::team_relay::{self as relay, Curl};
use crate::team_relay_ws::{Cmd, Loop, Ws};
use serde_json::{json, Value};
use std::path::Path;
use std::time::{Duration, Instant};

/// 붙고 ready 를 돌려준다(밀린 말은 넘김)
fn ready_of(d: &std::path::PathBuf, kc: &crate::accounts_store::fake::Fake, room: &str) -> (Ws, Value) {
    let st = relay::load_state(d);
    let k = relay::device_keys(kc, &st).unwrap();
    let url = relay::ws_url(&st, &k, room, now(), &crate::team_relay_keys::new_nonce().unwrap()).unwrap();
    let mut ws = crate::team_relay_ws::connect_url(&url).unwrap();
    loop {
        let v = read(&mut ws);
        if v["t"] == "ready" {
            return (ws, v);
        }
    }
}

fn until_read(ws: &mut Ws, member: &str, seq: u64) -> Duration {
    let t0 = Instant::now();
    loop {
        let v = read(ws);
        if v["t"] == "read" && v["member"] == member && v["seq"] == seq {
            return t0.elapsed();
        }
    }
}

fn until_file(d: &Path, room: &str, member: &str, seq: u64) -> Duration {
    let t0 = Instant::now();
    loop {
        assert!(t0.elapsed() < Duration::from_secs(10), "맥 Loop 가 {member} 읽음 {seq} 를 10초 안에 안 적음: {:?}", crate::team_reads::load(d));
        if crate::team_reads::load(d).get(room).and_then(|m| m.get(member)).copied() == Some(seq) {
            return t0.elapsed();
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn send(ws: &mut Ws, d: &Path, kc: &crate::accounts_store::fake::Fake, room: &str, cid: &str, body: &str) -> u64 {
    let env = crate::e2e_state::wrap(d, kc, &Curl, room, cid, body, true, now()).expect("사람 말 봉투");
    ws.send(tungstenite::Message::text(json!({ "t": "send", "cid": cid, "body": env, "origin": "human" }).to_string())).unwrap();
    loop {
        let v = read(ws);
        if v["cid"] == cid {
            assert_eq!(v["t"], "sent", "{v}");
            return v["seq"].as_u64().unwrap();
        }
    }
}

#[test]
#[ignore]
fn 읽음_같은_계정_기기끼리_상대_화면까지() {
    let Some(server) = base() else { return eprintln!("CHAMMO_E2E_LIVE 없음 — 건너뜀") };
    let run = now();
    let (da, ka) = login("rd-a", &server, &format!("rd-y-{run}"), "사용자");
    let (db, kb) = login("rd-b", &server, &format!("rd-j-{run}"), "지수");
    for (d, k) in [(&da, &ka), (&db, &kb)] {
        e2e_flow::start_chain(d, k, &Curl).unwrap();
        assert_eq!(e2e_flow::ensure(d, k, &Curl).unwrap(), Status::InChain);
    }
    relay::create(&da, &ka, &Curl, "", &format!("읽음 {run}"), "사용자", "mac").unwrap();
    let inv = relay::invite(&da, &ka, &Curl, "").unwrap();
    relay::join(&db, &kb, &Curl, "", &inv.link, "지수", "b").unwrap();
    for (d, k) in [(&da, &ka), (&db, &kb)] {
        relay::refresh_members(d, k, &Curl, "").unwrap();
        crate::team_account::refresh_me(d, k, &Curl).unwrap();
    }
    let dm = relay::open_dm(&db, &kb, &Curl, "", "사용자").unwrap();
    for (d, k) in [(&da, &ka), (&db, &kb)] {
        relay::sync_rooms(d, k, &Curl).unwrap();
        relay::refresh_members(d, k, &Curl, "").unwrap();
    }
    let (ya, jb) = (relay::load_state(&da).member_id, relay::load_state(&db).member_id);
    // 사용자 맥 — 진짜 받기 루프
    let (tx, rx) = std::sync::mpsc::channel();
    let keys = relay::device_keys(&ka, &relay::load_state(&da)).unwrap();
    let d2 = da.clone();
    std::thread::spawn(move || Loop::new(d2, keys, Box::new(|_| {}), rx).run());
    let mut jisu = sock(&db, &kb, &dm.id);
    let mut imac = sock(&da, &ka, &dm.id); // 같은 멤버의 다른 연결 = 아이맥 화면
    std::thread::sleep(Duration::from_millis(800)); // 맥 Loop 가 붙을 틈

    let s1 = send(&mut jisu, &db, &kb, &dm.id, &format!("c1-{run}"), "회의 몇 시?");
    // 지수는 사람 말을 보냈으니 거기까지 읽은 것 — 맥 Loop 는 붙을 때 ready.reads 나 그 뒤 read 로 안다(말만 받고 읽음 틀은 없다)
    // 아이맥에서 사용자가 읽음
    imac.send(tungstenite::Message::text(json!({ "t": "read", "seq": s1 }).to_string())).unwrap();
    let to_mac = until_file(&da, &dm.id, &ya, s1);
    let to_jisu = until_read(&mut jisu, &ya, s1);
    eprintln!("아이맥 읽음 → 맥 기록 {to_mac:?} · 지수 화면 {to_jisu:?}");

    let s2 = send(&mut jisu, &db, &kb, &dm.id, &format!("c2-{run}"), "답 줘요");
    // 맥 화면이 보고 있다 — 연달아 넘겨도 한 번만
    let t0 = Instant::now();
    tx.send(Cmd::Read { room: dm.id.clone(), seq: s2 }).unwrap();
    tx.send(Cmd::Read { room: dm.id.clone(), seq: s2 }).unwrap();
    let j = until_read(&mut jisu, &ya, s2);
    let i = until_read(&mut imac, &ya, s2);
    eprintln!("맥 읽음 → 지수 {j:?} · 아이맥 {i:?} (보낸 뒤 {:?})", t0.elapsed());
    std::thread::sleep(Duration::from_millis(1500));
    drop(jisu);
    let (_j2, ready) = ready_of(&db, &kb, &dm.id);
    eprintln!("다시 붙은 ready.reads = {}", ready["reads"]);
    assert_eq!(ready["reads"][&ya], s2);
    assert_eq!(ready["reads"][&jb], s2, "사람 말을 보낸 지수는 자기 말까지 읽음");
    assert_eq!(crate::team_reads::load(&da)[&dm.id][&ya], s2);
    tx.send(Cmd::Stop).unwrap();
}
