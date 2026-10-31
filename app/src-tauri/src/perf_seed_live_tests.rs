//! perf-bench 시드(fix/team-perf) — 로컬 중계에 '실사용 같은' 팀을 만든다. 앱(시험 CHAMMO_HOME)은 초대 링크로 들어와 그 팀을 연다.
//! 규모 PERF_SCALE=S|M|L — 사람(앱 포함) 6/30/100 · 파일 100/1000/5000 · 단톡방 5/20/50 · 글 30/60/120 · 일정 50/500/2000.
//! 사람 하나는 기기 둘(사슬 허용 — 두 번째 기기는 팀 칸을 따로 안 받아 올리기는 첫 기기가), 하나는 파일 둘을 올리고 나간다. 옆팀(T2)은 셋 — 팀 바꾸기 실측용.
//! 순서: 도우미 계정·팀 → PERF_OUT/invite-t1.txt·invite-t2.txt → 앱이 둘 다 들어올 때까지 기다림(이름 PERF_ME) → 방·DM·글·일정·파일·프로필 → seed-done.json
//! 돌리기(가짜 구글·중계는 scripts/perf-bench 가 띄운다):
//!   CHAMMO_E2E_LIVE=http://localhost:8827 CHAMMO_MOCK_GOOGLE=http://127.0.0.1:8828 PERF_OUT=<폴더> PERF_ME=성능 PERF_SCALE=S \
//!     cargo test --release perf_seed -- --ignored --nocapture --test-threads 1
use crate::accounts_store::fake::Fake;
use crate::e2e_flow::live::{base, login, now};
use crate::e2e_flow::{self, Status};
use crate::team_relay::{self as relay, Curl};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

struct Scale {
    people: usize,
    files: usize,
    rooms: usize,
    posts: usize,
    events: usize,
}

fn scale() -> (String, Scale) {
    let s = std::env::var("PERF_SCALE").unwrap_or_else(|_| "S".into());
    let sc = match s.as_str() {
        "M" => Scale { people: 30, files: 1000, rooms: 20, posts: 60, events: 500 },
        "L" => Scale { people: 100, files: 5000, rooms: 50, posts: 120, events: 2000 },
        _ => Scale { people: 6, files: 100, rooms: 5, posts: 30, events: 50 },
    };
    (s, sc)
}

const NAMES: &[&str] = &["하늘", "민아", "준호", "서연", "도윤", "지우", "현우", "수아", "예준", "하린"];

fn name(i: usize) -> String {
    if i < NAMES.len() { NAMES[i].to_string() } else { format!("{}{}", NAMES[i % NAMES.len()], i / NAMES.len()) }
}

struct H {
    d: PathBuf,
    k: Fake,
    name: String,
}

/// 중계 nonce 창(열쇠마다 10분 300개)에 걸리면 물러섰다 다시 — 시드는 서버 한도를 바꾸지 않는다
fn retry<T>(what: &str, mut f: impl FnMut() -> Result<T, String>) -> T {
    for i in 0..12 {
        match f() {
            Ok(v) => return v,
            Err(e) if e.contains("429") || e.contains("쉬") || e.contains("slow") => {
                eprintln!("  {what}: 429 — {}초 쉼({i})", 30);
                std::thread::sleep(Duration::from_secs(30));
            }
            Err(e) => panic!("{what}: {e}"),
        }
    }
    panic!("{what}: 계속 429")
}

/// 끝부분(옆팀 파일·프로필)은 못 해도 시드가 죽지 않게 — 429 가 길면 건너뛰고 적어 둔다
fn soft<T>(what: &str, mut f: impl FnMut() -> Result<T, String>) -> Option<T> {
    for i in 0..20 {
        match f() {
            Ok(v) => return Some(v),
            Err(e) if e.contains("429") || e.contains("쉬") || e.contains("slow") => {
                eprintln!("  {what}: 429 — 30초 쉼({i})");
                std::thread::sleep(Duration::from_secs(30));
            }
            Err(e) => {
                eprintln!("  {what}: 건너뜀 — {e}");
                return None;
            }
        }
    }
    eprintln!("  {what}: 계속 429 — 건너뜀");
    None
}

fn chained(tag: &str, server: &str, sub: &str, n: &str) -> H {
    let (d, k) = login(tag, server, sub, n);
    assert_eq!(e2e_flow::ensure(&d, &k, &Curl).unwrap(), Status::NeedStart);
    e2e_flow::start_chain(&d, &k, &Curl).unwrap();
    H { d, k, name: n.into() }
}

/// 같은 계정 두 번째 기기 — 확인 숫자로 허용받아 사슬에 든다(그 사람 사슬 고리가 늘어 받는 쪽 검증·봉투가 는다)
fn second_device(first: &H, server: &str, sub: &str) -> H {
    let (d, k) = login(&format!("{}-2", first.name), server, sub, &first.name);
    let target = relay::load_state(&d).device_id;
    crate::team_account::refresh_me(&first.d, &first.k, &Curl).unwrap();
    e2e_flow::card_open(&first.d, &first.k, &Curl, &target).unwrap();
    e2e_flow::my_number(&d, &k, &Curl).unwrap().expect("새 기기 숫자");
    let n = e2e_flow::card_number(&first.d, &first.k, &Curl, &target).unwrap().expect("카드 숫자");
    let code = e2e_flow::approve_with_number(&first.d, &first.k, &Curl, &target, &format!("{n:06}")).unwrap();
    crate::team_account::refresh_me(&d, &k, &Curl).unwrap();
    e2e_flow::confirm_code(&d, &k, &Curl, &code).unwrap();
    H { d, k, name: first.name.clone() }
}

fn team_id(h: &H, name: &str) -> String {
    let st = relay::load_state(&h.d);
    st.teams.iter().find(|t| t.name == name).map(|t| t.id.clone()).unwrap_or_else(|| panic!("{} 에 팀 {name} 없음", h.name))
}

fn names_in(h: &H, team: &str) -> Vec<String> {
    let st = retry("명부", || relay::refresh_members(&h.d, &h.k, &Curl, team));
    st.team(team).map(|t| t.members.iter().map(|m| m.display_name.clone()).collect()).unwrap_or_default()
}

fn small_file(dir: &Path, i: usize) -> PathBuf {
    let ext = ["txt", "md", "csv", "json", "png"][i % 5];
    let p = dir.join(format!("자료-{i:04}.{ext}"));
    let n = 1_000 + (i * 7919) % 19_000; // 1~20KB
    std::fs::write(&p, (0..n).map(|j| (j as u8).wrapping_mul(31).wrapping_add(i as u8)).collect::<Vec<u8>>()).unwrap();
    p
}

#[test]
#[ignore]
fn perf_seed() {
    let Some(server) = base() else { return eprintln!("CHAMMO_E2E_LIVE 없음 — 건너뜀") };
    let out = PathBuf::from(std::env::var("PERF_OUT").expect("PERF_OUT"));
    std::fs::create_dir_all(&out).unwrap();
    let me = std::env::var("PERF_ME").unwrap_or_else(|_| "성능".into());
    let (sname, sc) = scale();
    let run = now();
    let t0 = Instant::now();
    let (t1n, t2n) = (format!("성능팀 {sname}"), format!("옆팀 {sname}"));

    // ① 도우미(앱 빼고 people-1) + 기기 둘인 사람 + 나갈 사람
    let mut hs: Vec<H> = (0..sc.people - 1).map(|i| chained(&format!("ps{i}"), &server, &format!("ps{i}-{run}"), &name(i))).collect();
    let twin = second_device(&hs[1], &server, &format!("ps1-{run}"));
    let leaver = chained("ps-leave", &server, &format!("psl-{run}"), "떠난이");
    eprintln!("① 계정 {}개 {}ms", hs.len() + 2, t0.elapsed().as_millis());

    // ② 팀 둘 — 하늘(0)이 팀장. T1 은 모두, T2 는 하늘·민아·준호
    relay::create(&hs[0].d, &hs[0].k, &Curl, "", &t1n, &hs[0].name, "mac").unwrap();
    let t1 = team_id(&hs[0], &t1n);
    for h in hs.iter().skip(1).chain([&leaver]) {
        let inv = retry("초대", || relay::invite(&hs[0].d, &hs[0].k, &Curl, &t1));
        relay::join(&h.d, &h.k, &Curl, "", &inv.link, &h.name, "mac").unwrap();
    }
    relay::create(&hs[0].d, &hs[0].k, &Curl, "", &t2n, &hs[0].name, "mac").unwrap();
    let t2 = team_id(&hs[0], &t2n);
    for h in hs.iter().skip(1).take(2) {
        let inv = retry("초대", || relay::invite(&hs[0].d, &hs[0].k, &Curl, &t2));
        relay::join(&h.d, &h.k, &Curl, "", &inv.link, &h.name, "mac").unwrap();
    }
    for (t, f) in [(&t1, "invite-t1.txt"), (&t2, "invite-t2.txt")] {
        let inv = retry("앱 초대", || relay::invite(&hs[0].d, &hs[0].k, &Curl, t));
        std::fs::write(out.join(f), &inv.link).unwrap();
    }
    std::fs::write(out.join("seed-teams.json"), json!({ "t1": t1, "t2": t2, "t1Name": t1n, "t2Name": t2n, "server": server }).to_string()).unwrap();
    eprintln!("② 팀 둘·초대 {}ms — 앱({me})이 들어오길 기다림", t0.elapsed().as_millis());

    // ③ 앱이 두 팀 다 들어올 때까지(20분)
    let until = Instant::now() + Duration::from_secs(1200);
    while !(names_in(&hs[0], &t1).contains(&me) && names_in(&hs[0], &t2).contains(&me)) {
        assert!(Instant::now() < until, "앱이 20분 안에 안 들어옴");
        std::thread::sleep(Duration::from_secs(5));
    }
    for h in hs.iter().chain([&twin, &leaver]) {
        for t in [&t1, &t2] {
            let _ = relay::refresh_members(&h.d, &h.k, &Curl, t);
        }
    }
    // 앱 사람을 T1 팀장으로도(사용자 팀처럼 — 권한 칩·초대 링크 만들기는 팀장 화면에만)
    // 팀 권한(TEAM_ROLES) 켠 중계는 팀장을 '넘기기'로만 바꾼다 — 그땐 하늘이 앱에 넘긴다
    if relay::set_role(&hs[0].d, &hs[0].k, &Curl, &t1, &me, "owner").is_err() {
        retry("팀장 넘기기", || relay::transfer_owner(&hs[0].d, &hs[0].k, &Curl, &t1, &me));
    }
    eprintln!("③ 앱 들어옴·팀장 {}ms", t0.elapsed().as_millis());

    // ④ 나갈 사람 — 파일 둘 올리고 나감
    let tmp = out.join("seed-files");
    std::fs::create_dir_all(&tmp).unwrap();
    for i in 0..2 {
        let p = small_file(&tmp, 90_000 + i);
        retry("나간이 파일", || crate::team_locker_app::put_file_in(&leaver.d, &leaver.k, &Curl, &t1, "", "file", "", &p));
    }
    relay::leave(&leaver.d, &leaver.k, &Curl, &t1).unwrap();
    for h in &hs {
        let _ = relay::refresh_members(&h.d, &h.k, &Curl, &t1);
    }

    // ⑤ 단톡방(앱 포함, 사람 섞어) + DM
    let n = hs.len();
    for r in 0..sc.rooms {
        let owner = &hs[r % n];
        let mut people: Vec<String> = vec![me.clone()];
        people.extend((1..=(2 + r % 4)).map(|j| hs[(r + j) % n].name.clone()).filter(|p| p != &owner.name));
        people.dedup();
        retry("단톡방", || crate::team_rooms::create_room(&owner.d, &owner.k, &Curl, &t1, &format!("방 {r}"), &people));
    }
    for h in hs.iter().take(3) {
        retry("DM", || relay::open_dm(&h.d, &h.k, &Curl, &t1, &me));
    }
    eprintln!("⑤ 방 {}·DM 3 {}ms", sc.rooms, t0.elapsed().as_millis());

    // ⑥ 글 — 팀장이 공지 하나 고정, 나머지는 돌아가며
    let mut first_post = String::new();
    for i in 0..sc.posts {
        let h = &hs[i % n];
        let (id, job) = retry("글", || crate::team_post::write(&h.d, &h.k, &Curl, &t1, &format!("소식 {i}"), &"이번 주 할 일과 메모를 적어 둔다. ".repeat(6 + i % 20), None));
        job.run(&h.d, &h.k, &Curl);
        if first_post.is_empty() {
            first_post = id;
        }
    }
    let job = retry("고정", || crate::team_post::pin(&hs[0].d, &hs[0].k, &Curl, &t1, &first_post));
    job.run(&hs[0].d, &hs[0].k, &Curl);
    eprintln!("⑥ 글 {} {}ms", sc.posts, t0.elapsed().as_millis());

    // ⑦ 일정 — 이번 달·다음 달에 흩어서
    for i in 0..sc.events {
        let h = &hs[i % n];
        let day = 1 + (i * 7) % 28;
        let mon = 11 + (i / 28) % 2;
        let ev = json!({ "v": 1, "title": format!("일정 {i}"), "allDay": i % 3 == 0, "start": format!("2026-{mon:02}-{day:02}"), "end": format!("2026-{mon:02}-{day:02}"), "note": "", "place": if i % 4 == 0 { "회의실" } else { "" } });
        retry("일정", || crate::team_app_store::write(&h.d, &h.k, &Curl, &t1, crate::team_app::APP_CAL, &format!("e{i}"), 0, None, Some(ev.clone()), false));
    }
    eprintln!("⑦ 일정 {} {}ms", sc.events, t0.elapsed().as_millis());

    // ⑧ 파일 — 사람마다 돌아가며, 폴더 넷
    let folders = ["", "문서", "사진", "회의록"];
    for i in 0..sc.files {
        let h = &hs[i % n];
        let p = small_file(&tmp, i);
        retry("파일", || crate::team_locker_app::put_file_in(&h.d, &h.k, &Curl, &t1, "", "file", folders[i % 4], &p));
        if i % 25 == 24 {
            eprintln!("  파일 {}/{} {}ms", i + 1, sc.files, t0.elapsed().as_millis());
        }
    }
    // T2 에도 조금
    // 옆팀 파일은 덜 쓴 열쇠(민아·준호)로 — 하늘 열쇠는 위에서 nonce 창을 거의 다 썼다
    for i in 0..10 {
        let h = &hs[1 + i % 2];
        let p = small_file(&tmp, 50_000 + i);
        soft("T2 파일", || crate::team_locker_app::put_file_in(&h.d, &h.k, &Curl, &t2, "", "file", "", &p));
    }

    // ⑨ 프로필 — 상태·메모, 셋은 사진
    for (i, h) in hs.iter().enumerate() {
        let _ = relay::use_team(&h.d, &t1);
        let photo = (i < 3).then(|| {
            let mut b = b"RIFF\0\0\0\0WEBP".to_vec();
            b.extend((0..14_000u32).map(|j| (j as u8).wrapping_mul(17).wrapping_add(i as u8)));
            Some(b)
        });
        soft("프로필", || crate::team_profile::set(&h.d, &h.k, &Curl, &crate::team_profile::Change { status: Some(["free", "away", "busy"][i % 3].into()), note: Some(format!("{} 메모", h.name)), photo: photo.clone(), ..Default::default() }));
    }

    let done: Value = json!({ "scale": sname, "people": sc.people, "files": sc.files + 2, "rooms": sc.rooms, "dms": 3, "posts": sc.posts, "events": sc.events, "t1": t1, "t2": t2, "ms": t0.elapsed().as_millis() as u64 });
    std::fs::write(out.join("seed-done.json"), done.to_string()).unwrap();
    eprintln!("끝 {done}");
    let _ = std::fs::remove_dir_all(&tmp);
}
