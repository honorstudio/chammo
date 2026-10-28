//! 팀 지연 실측(fix/team-latency3) — 사용자 말 "프로필 바꿀 때·팀 홈 로드·공지 저장·메시지 보낼 때 다 딜레이".
//! 로컬 중계(wrangler dev) + 가짜 구글, 세 계정 한 팀. 동작마다 중계 요청을 하나하나(CHAMMO_NET_TRACE) 남기고 전체 시간과 맞대 본다.
//! 망이 0 인 로컬이라 여기서 나온 건 '요청 수·차례·이 기기 시간'이고, 운영 시간은 요청 수 × 운영에서 잰 요청당 시간으로 계산한다.
//! 준비는 e2e_live_tests.rs 머리와 같다. 돌리기:
//!   CHAMMO_E2E_LIVE=http://localhost:8797 CHAMMO_MOCK_GOOGLE=http://127.0.0.1:8791 CHAMMO_LAT_OUT=<폴더> \
//!     cargo test team_post::latency_live -- --ignored --nocapture --test-threads 1
use crate::e2e_flow::live::{base, login, now, read, sock};
use crate::e2e_flow::{self, Status};
use crate::team_post as post;
use crate::team_profile::{self as profile, Change};
use crate::team_relay::{self as relay, Curl};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Instant;

const N: usize = 5;

fn chained(tag: &str, server: &str, sub: &str, name: &str) -> (PathBuf, crate::accounts_store::fake::Fake) {
    let (d, k) = login(tag, server, sub, name);
    assert_eq!(e2e_flow::ensure(&d, &k, &Curl).unwrap(), Status::NeedStart);
    e2e_flow::start_chain(&d, &k, &Curl).unwrap();
    (d, k)
}

fn out_dir() -> PathBuf {
    let d = std::env::var("CHAMMO_LAT_OUT").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir().join("chammo-latency3"));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 한 동작 — 그동안 나간 중계 요청을 따로 받아 요약 한 줄(summary.jsonl)에 붙인다. f 가 돌려준 칸(ws_ms 등)도 같이
fn step<T>(out: &Path, name: &str, i: usize, f: impl FnOnce() -> (T, Value)) -> T {
    let file = out.join(format!("{name}-{i}.jsonl"));
    let _ = std::fs::remove_file(&file);
    std::env::set_var("CHAMMO_NET_TRACE", &file);
    let t = Instant::now();
    let (r, extra) = f();
    let total = t.elapsed().as_millis() as u64;
    std::env::remove_var("CHAMMO_NET_TRACE");
    let reqs: Vec<Value> = std::fs::read_to_string(&file).unwrap_or_default().lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    let net: u64 = reqs.iter().map(|r| r["ms"].as_u64().unwrap_or(0)).sum();
    let seq: Vec<String> = reqs.iter().map(|r| format!("{} {} {} {}ms", r["method"].as_str().unwrap_or(""), r["path"].as_str().unwrap_or(""), r["code"], r["ms"])).collect();
    let line = json!({ "step": name, "i": i, "total": total, "n": reqs.len(), "net": net, "local": total.saturating_sub(net), "extra": extra, "seq": seq });
    eprintln!("{name}#{i} 전체 {total}ms · 요청 {}개(망 {net}ms)", reqs.len());
    use std::io::Write;
    let mut s = std::fs::OpenOptions::new().create(true).append(true).open(out.join("summary.jsonl")).unwrap();
    writeln!(s, "{line}").unwrap();
    r
}

/// 256px webp 크기쯤(머리만 webp) — 서버는 내용을 모르고 앱은 머리만 본다
fn photo(seed: u8) -> Vec<u8> {
    let mut b = b"RIFF\0\0\0\0WEBP".to_vec();
    b.extend((0..14_000u32).map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed)));
    b
}

fn ws_send(ws: &mut crate::team_relay_ws::Ws, cid: &str, wire: &str) -> Value {
    ws.send(tungstenite::Message::text(json!({ "t": "send", "cid": cid, "body": wire, "origin": "human" }).to_string())).unwrap();
    loop {
        let v = read(ws);
        if v["cid"] == cid {
            return v;
        }
    }
}

#[test]
#[ignore]
fn 팀_네_동작_지연_실측() {
    let Some(server) = base() else { return eprintln!("CHAMMO_E2E_LIVE 없음 — 건너뜀") };
    let out = out_dir();
    let _ = std::fs::remove_file(out.join("summary.jsonl"));
    let run = now();
    let (da, ka) = chained("lat-y", &server, &format!("lat-y-{run}"), "사용자");
    let (dc, kc) = chained("lat-c", &server, &format!("lat-c-{run}"), "철수");
    let (dm, km) = chained("lat-m", &server, &format!("lat-m-{run}"), "민수");
    relay::create(&da, &ka, &Curl, "", &format!("지연 {run}"), "사용자", "mac").unwrap();
    for (d, k, n) in [(&dc, &kc, "철수"), (&dm, &km, "민수")] {
        let inv = relay::invite(&da, &ka, &Curl, "").unwrap();
        relay::join(d, k, &Curl, "", &inv.link, n, n).unwrap();
    }
    for (d, k) in [(&da, &ka), (&dc, &kc), (&dm, &km)] {
        relay::refresh_members(d, k, &Curl, "").unwrap();
    }
    let team = relay::load_state(&da).team_id.clone();
    let group = crate::team_rooms::create_room(&da, &ka, &Curl, "", "전체", &["철수".into(), "민수".into()]).unwrap();
    let dm_room = relay::open_dm(&da, &ka, &Curl, "", "철수").unwrap();
    for (d, k) in [(&dc, &kc), (&dm, &km)] {
        relay::sync_rooms(d, k, &Curl).unwrap();
    }

    // 0) 바닥 — 서명 요청 하나(GET /v0/me), 서명 만들기
    let st = relay::load_state(&da);
    let keys = relay::device_keys(&ka, &st).unwrap();
    for i in 0..N {
        step(&out, "base_me", i, || (relay::call(&Curl, &st.server, &keys, Some(&st.device_id), "GET", "/v0/me", None).unwrap(), json!({})));
    }
    let t = Instant::now();
    for _ in 0..200 {
        let _ = keys.sign_request("GET", "/v0/me", b"", now(), &crate::team_relay_keys::new_nonce().unwrap());
    }
    eprintln!("서명 하나 {}µs", t.elapsed().as_micros() / 200);

    // 1) 프로필 — 상태 바꾸기(카드에서 누르면 바로 저장) → 화면이 판 다시 읽기(onSaved)
    for i in 0..N {
        let st = if i % 2 == 0 { "away" } else { "free" };
        step(&out, "profile_status_set", i, || (profile::set(&da, &ka, &Curl, &Change { status: Some(st.into()), note: Some(format!("메모 {i}")), ..Default::default() }).unwrap(), json!({})));
        step(&out, "profile_board", i, || (profile::board(&da, &ka, &Curl, "").unwrap(), json!({})));
    }
    // 철수·민수도 프로필이 있어야 이름 확인이 남의 프로필을 읽는다
    for (d, k) in [(&dc, &kc), (&dm, &km)] {
        profile::set(d, k, &Curl, &Change { status: Some("free".into()), photo: Some(Some(photo(7))), ..Default::default() }).unwrap();
    }
    for i in 0..3 {
        step(&out, "profile_name_set", i, || (profile::set(&da, &ka, &Curl, &Change { name: Some(format!("사용자{i}")), ..Default::default() }).unwrap(), json!({})));
    }
    for i in 0..3 {
        step(&out, "profile_photo_set", i, || (profile::set(&da, &ka, &Curl, &Change { photo: Some(Some(photo(i as u8))), ..Default::default() }).unwrap(), json!({})));
        step(&out, "profile_board_after_photo", i, || (profile::board(&da, &ka, &Curl, "").unwrap(), json!({})));
    }

    // 2) 공지 저장 — 화면 save(): 글 쓰기 → (고정 바꾸면) 고정 → load()
    let mut ids = vec![];
    for i in 0..4 {
        let id = step(&out, "post_write", i, || (post::write(&da, &ka, &Curl, &team, &format!("공지 {i}"), &"본문 ".repeat(40), None).unwrap().0, json!({})));
        step(&out, "post_pin", i, || (drop(post::pin(&da, &ka, &Curl, &team, &id).unwrap()), json!({})));
        step(&out, "post_board_after_save", i, || (post::board_split(&da, &ka, &Curl, &team).unwrap().0, json!({})));
        ids.push(id);
    }

    // 3) 팀 홈 열기 — 데워진(풀린 글 기억 있음)·처음(기억 없음: 다른 기기·새로 깐 앱) · 팀원(철수) 쪽도
    for i in 0..N {
        step(&out, "home_board_warm", i, || (post::board_split(&da, &ka, &Curl, &team).unwrap().0, json!({})));
    }
    for i in 0..3 {
        let _ = std::fs::remove_dir_all(dc.join("team-profile-cache"));
        // 앱을 막 켠 것처럼 — 사람 목록 캐시(메모리, 팀 키라 이 시험의 세 계정이 같이 쓴다)도 비운다
        crate::team_locker_app::forget_people(&team);
        let b = step(&out, "home_board_cold_member", i, || {
            let b = post::board_split(&dc, &kc, &Curl, &team).unwrap().0;
            let n = b.posts.len();
            (b, json!({ "posts": n }))
        });
        assert_eq!(b.posts.len(), ids.len(), "철수에게 글 넷");
    }
    for i in 0..3 {
        // 10분 넘게 쉰 뒤 — 풀린 글 기억은 있고 사람 목록만 묵었다
        crate::team_locker_app::forget_people(&team);
        step(&out, "home_board_people_stale", i, || (post::board_split(&dc, &kc, &Curl, &team).unwrap().0, json!({})));
    }
    for i in 0..N {
        step(&out, "home_board_warm_member", i, || (post::board_split(&dc, &kc, &Curl, &team).unwrap().0, json!({})));
    }

    // 3-1) 나중에 든 사람(영희) — 사용자 앱의 다음 목록이 파일마다 영희 몫 봉투를 더한다. 팀 홈 글판(post::board)은 list() 라 그걸 기다린다
    let (de, ke) = chained("lat-e", &server, &format!("lat-e-{run}"), "영희");
    let inv = relay::invite(&da, &ka, &Curl, "").unwrap();
    relay::join(&de, &ke, &Curl, "", &inv.link, "영희", "영희").unwrap();
    relay::refresh_members(&da, &ka, &Curl, "").unwrap();
    relay::refresh_members(&dc, &kc, &Curl, "").unwrap();
    // 여기부터는 철수 기기로 — 사용자 열쇠는 위 단계들로 중계 nonce 창(10분 300개)이 거의 찼다
    let files = crate::team_locker_app::list_split(&dc, &kc, &Curl, &team).unwrap().0.items.len();
    // 사람 목록 캐시(10분)가 영희를 모르면 봉투가 모자란 걸 못 본다 — 앱에선 명부 바뀜 알림·10분 뒤에 맞는다. 여기선 바로 새로
    crate::team_locker_app::forget_people(&team);
    // 화면 명령(team_posts)처럼 — 글판을 먼저 돌려주고, 봉투 더하기는 뒤 일(따로 잰다)
    let job = step(&out, "home_board_after_join", 0, || {
        let (_, job) = post::board_split(&dc, &kc, &Curl, &team).unwrap();
        (job, json!({ "files": files }))
    });
    step(&out, "home_share_background", 0, || (job.run(&dc, &kc, &Curl), json!({ "files": files })));
    step(&out, "home_board_after_join", 1, || (post::board_split(&dc, &kc, &Curl, &team).unwrap().0, json!({ "files": files })));
    step(&out, "home_board_cold_newcomer", 0, || {
        let b = post::board_split(&de, &ke, &Curl, &team).unwrap().0;
        let n = b.posts.len();
        (b, json!({ "posts": n }))
    });

    // 3-2) 팀 보관함 사진 — 사용자가 올린 사진 셋(2MB)을 철수가 연다: 화면 목록 → 카드 썸네일(peek) → 누르면 열기(view)
    let work = crate::e2e_flow::live::dir("lat-photos");
    let mut photos = vec![];
    for i in 0..3u8 {
        let p = work.join(format!("현장 {i}.jpg"));
        let mut b = b"\xff\xd8\xff\xe0".to_vec();
        b.extend((0..2_000_000u32).map(|x| (x as u8).wrapping_mul(17).wrapping_add(i)));
        std::fs::write(&p, &b).unwrap();
        let f = step(&out, "locker_photo_put", i as usize, || (crate::team_locker_app::put_file(&da, &ka, &Curl, &team, "", "file", &p).unwrap(), json!({ "bytes": b.len() })));
        photos.push(f.id);
    }
    step(&out, "locker_list_member", 0, || (crate::team_locker_app::list_split(&dc, &kc, &Curl, &team).unwrap().0, json!({})));
    for (i, id) in photos.iter().enumerate() {
        step(&out, "locker_photo_thumb", i, || (crate::team_locker_app::peek(&dc, &kc, &Curl, &team, id).unwrap(), json!({})));
    }
    // 앱을 막 켠 뒤 보관함 — 봉해 둔 마지막 목록이 바로 떠서 카드 썸네일이 목록 기억(메모리) 없이 먼저 불린다
    let _ = std::fs::remove_dir_all(dc.join(crate::team_locker_app::VIEW_DIR));
    let _ = std::fs::remove_file(dc.join("team-locker-cache.json"));
    crate::team_locker_app::forget(&team);
    crate::team_locker_app::forget_people(&team);
    step(&out, "locker_thumbs_cold3", 0, || {
        let ps: Vec<_> = photos.iter().map(|id| crate::team_locker_app::peek(&dc, &kc, &Curl, &team, id).unwrap()).collect();
        (ps, json!({ "thumbs": photos.len() }))
    });
    let _ = std::fs::remove_dir_all(dc.join(crate::team_locker_app::VIEW_DIR));
    let _ = std::fs::remove_file(dc.join("team-locker-cache.json"));
    step(&out, "locker_photo_open_first", 0, || (crate::team_locker_app::view(&dc, &kc, &Curl, &team, &photos[0]).unwrap(), json!({})));
    step(&out, "locker_photo_open_again", 0, || (crate::team_locker_app::view(&dc, &kc, &Curl, &team, &photos[0]).unwrap(), json!({})));
    // 앱을 막 켠 뒤(목록 기억·사람 목록 없음) — 화면이 목록을 받기 전에 누른 셈
    crate::team_locker_app::forget(&team);
    crate::team_locker_app::forget_people(&team);
    step(&out, "locker_photo_open_cold", 0, || (crate::team_locker_app::view(&dc, &kc, &Curl, &team, &photos[1]).unwrap(), json!({})));
    crate::team_locker_app::forget(&team);
    crate::team_locker_app::forget_people(&team);
    step(&out, "locker_photo_open_cold_cached", 0, || (crate::team_locker_app::view(&dc, &kc, &Curl, &team, &photos[1]).unwrap(), json!({})));

    // 4) 메시지 — 봉투 만들기(받는 사람 셈·사슬) → 방 소켓 send → sent 답(소켓은 미리 붙어 있다 — 앱의 팀 연결 스레드처럼)
    // 보내는 쪽은 철수 — 사용자 열쇠는 위에서 요청을 많이 써서 중계 nonce 창(열쇠마다 10분에 300개)에 걸린다
    let mut wg = sock(&dc, &kc, &group.id);
    let mut wd = sock(&dc, &kc, &dm_room.id);
    for (name, room, ws) in [("msg_group", &group.id, &mut wg), ("msg_dm", &dm_room.id, &mut wd)] {
        for i in 0..N {
            let cid = format!("lat-{name}-{i}-{run}");
            step(&out, name, i, || {
                let t = Instant::now();
                let wire = crate::e2e_state::wrap_with(&dc, &kc, &Curl, room, &cid, &format!("지연 측정 {i}"), true, now(), Default::default()).unwrap();
                let wrap_ms = t.elapsed().as_millis() as u64;
                let t = Instant::now();
                let v = ws_send(ws, &cid, &wire);
                assert_eq!(v["t"], "sent", "{v}");
                (v, json!({ "wrap_ms": wrap_ms, "ws_ms": t.elapsed().as_millis() as u64, "wire_bytes": wire.len() }))
            });
        }
    }
}

/// 운영 중계에 인증 없는 GET(401, 읽기만) — 앱의 Http(Curl) 그대로 다시 쓰는 연결 ↔ 예전 길(CHAMMO_HTTP_CURL=1) 견주기
/// 돌리기: CHAMMO_LAT_PROD=https://relay.chammo.app cargo test team_post::latency_live::운영 -- --ignored --nocapture
#[test]
#[ignore]
fn 운영_연결_다시_쓰기_견주기() {
    let Some(server) = std::env::var("CHAMMO_LAT_PROD").ok().filter(|s| !s.is_empty()) else { return eprintln!("CHAMMO_LAT_PROD 없음 — 건너뜀") };
    let url = format!("{server}/v0/team");
    let run = |label: &str| {
        let mut ms: Vec<u128> = (0..20)
            .map(|_| {
                let t = Instant::now();
                let (code, _) = crate::team_relay::Http::send(&Curl, "GET", &url, &[], b"").unwrap();
                assert_eq!(code, 401);
                t.elapsed().as_millis()
            })
            .collect();
        ms.sort();
        eprintln!("{label}: p50 {}ms p90 {}ms 최악 {}ms", ms[10], ms[18], ms[19]);
    };
    run("다시 쓰는 연결");
    std::env::set_var("CHAMMO_HTTP_CURL", "1");
    run("curl 새로 띄우기");
    std::env::remove_var("CHAMMO_HTTP_CURL");
    run("다시 쓰는 연결(2)");
}
