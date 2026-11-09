//! 로컬 종단 시험 — 진짜 중계(wrangler dev, R2·D1 로컬) + 가짜 구글로 팀 보관함·대화 파일이 두 계정 사이에 끝까지 도는지.
//! 준비는 e2e_live_tests.rs 머리와 같다(chammo-relay 에서 wrangler dev + scripts/mock-google.mjs, 마이그 0012 까지 --local 로).
//! 돌리기: CHAMMO_E2E_LIVE=http://localhost:8787 cargo test team_locker_app::live -- --ignored --nocapture
use super::*;
use crate::e2e_flow::live::{base, dir, login, now, read, sock};
use crate::e2e_flow::{self, Status};
use crate::team_relay::Curl;

fn start(d: &Path, kc: &crate::accounts_store::fake::Fake) {
    assert_eq!(e2e_flow::ensure(d, kc, &Curl).unwrap(), Status::NeedStart);
    e2e_flow::start_chain(d, kc, &Curl).unwrap();
    assert_eq!(e2e_flow::ensure(d, kc, &Curl).unwrap(), Status::InChain);
}

fn bytes(n: usize, seed: usize) -> Vec<u8> {
    (0..n).map(|i| ((i * 131 + seed) % 251) as u8).collect()
}

#[test]
#[ignore]
fn 로컬_중계_팀_보관함_끝까지() {
    let Some(server) = base() else { return eprintln!("CHAMMO_E2E_LIVE 없음 — 건너뜀") };
    let run = now();
    let (da, ka) = login("lk-y", &server, &format!("lk-y-{run}"), "사용자");
    start(&da, &ka);
    let (dc, kc) = login("lk-c", &server, &format!("lk-c-{run}"), "철수");
    start(&dc, &kc);
    relay::create(&da, &ka, &Curl, "", &format!("ACME {run}"), "사용자", "mac").unwrap();
    let team = relay::load_state(&da).team_id.clone();
    let inv = relay::invite(&da, &ka, &Curl, "").unwrap();
    relay::join(&dc, &kc, &Curl, "", &inv.link, "철수", "chulsoo").unwrap();

    // 철수 앱은 내 기기끼리 방 소켓으로 바뀜을 듣는다
    let selfc = relay::self_room(&dc, &kc, &Curl).unwrap();
    let mut wc = sock(&dc, &kc, &selfc);

    // ① 사용자가 8MiB 넘는 파일을 팀 보관함에 — 조각 둘
    let work = dir("lk-work");
    let big = bytes(crate::team_locker::CHUNK + 4321, 1);
    std::fs::write(work.join("견적서 최종.pdf"), &big).unwrap();
    let r = put_file(&da, &ka, &Curl, &team, "", "file", &work.join("견적서 최종.pdf")).unwrap();
    assert_eq!((r.name.as_str(), r.size), ("견적서 최종.pdf", big.len() as u64));
    let ev = read(&mut wc);
    assert_eq!((ev["t"].as_str(), ev["team"].as_str()), (Some("locker"), Some(team.as_str())), "철수 소켓에 바뀜 알림");

    // ② 철수 목록에 이름까지 보이고, 받으면 같은 바이트
    let v = list(&dc, &kc, &Curl, &team).unwrap();
    let it = v.items.iter().find(|i| i.id == r.id).expect("철수 목록에");
    assert_eq!((it.name.as_str(), it.size, it.by.as_str(), it.why.as_str()), ("견적서 최종.pdf", big.len() as u64, "사용자", ""));
    assert_eq!(it.cipher, big.len() as u64 + 32);
    let got = fetch_to(&dc, &kc, &Curl, &team, &r.id, &dir("lk-c-down")).unwrap();
    assert_eq!(std::fs::read(&got).unwrap(), big);

    // ③ 대화 파일 — DM 에 붙이면 그 방 사람만, '대화 파일' 폴더로
    let dm = relay::open_dm(&da, &ka, &Curl, "", "철수").unwrap();
    relay::sync_rooms(&dc, &kc, &Curl).unwrap();
    std::fs::write(work.join("사진.png"), bytes(3000, 2)).unwrap();
    let f = put_file(&da, &ka, &Curl, &team, &dm.id, "file", &work.join("사진.png")).unwrap();
    let got = fetch_to(&dc, &kc, &Curl, &team, &f.id, &dir("lk-c-down2")).unwrap();
    assert!(got.parent().unwrap().ends_with("대화 파일"));
    assert_eq!(std::fs::read(&got).unwrap(), bytes(3000, 2));

    // ④ 철수가 이름 바꾸고 휴지통 → 사용자 목록에 반영, 사용량 = 암호문 합
    rename(&dc, &kc, &Curl, &team, &r.id, Some("견적서 확정.pdf"), None).unwrap();
    act(&dc, &kc, &Curl, &team, &f.id, "trash").unwrap();
    let va = list(&da, &ka, &Curl, &team).unwrap();
    assert_eq!(va.items.iter().find(|i| i.id == r.id).unwrap().name, "견적서 확정.pdf");
    assert_eq!(va.items.iter().find(|i| i.id == f.id).unwrap().state, "trash");
    assert_eq!(va.usage.used, va.items.iter().map(|i| i.cipher).sum::<u64>());
    assert_eq!(va.usage.seats, 2);

    // ⑤ 나중에 든 영희 — 처음엔 열쇠 없음, 사용자 앱이 목록을 받으면 봉투를 더해 열린다
    let (de, ke) = login("lk-e", &server, &format!("lk-e-{run}"), "영희");
    start(&de, &ke);
    let inv = relay::invite(&da, &ka, &Curl, "").unwrap();
    relay::join(&de, &ke, &Curl, "", &inv.link, "영희", "younghee").unwrap();
    let ve = list(&de, &ke, &Curl, &team).unwrap();
    assert!(!ve.items.iter().find(|i| i.id == r.id).unwrap().why.is_empty(), "아직 영희 몫 열쇠 없음");
    assert!(ve.items.iter().all(|i| i.id != f.id), "DM 파일은 방 밖 사람에게 안 보인다");
    assert!(list(&da, &ka, &Curl, &team).unwrap().shared >= 1, "사용자 앱이 영희 몫 봉투를 더함");
    let ve = list(&de, &ke, &Curl, &team).unwrap();
    assert_eq!(ve.items.iter().find(|i| i.id == r.id).unwrap().name, "견적서 확정.pdf");
    eprintln!("끝 — 팀 {team}, 파일 {}·{}", r.id, f.id);
}

// ── 올리기 잇기(11-04 18:18 와이파이가 바뀌자 파일 통째 실패) — 진짜 중계·진짜 망 길. 돌리는 쪽이 중계를 끄고 켠다 ──

/// 팀 하나 + 조각 n 개짜리 파일
fn one_team(tag: &str, parts: usize) -> (PathBuf, crate::accounts_store::fake::Fake, String, PathBuf, Vec<u8>) {
    let server = base().unwrap();
    let run = now();
    let (d, k) = login(tag, &server, &format!("{tag}-{run}"), "사용자");
    start(&d, &k);
    relay::create(&d, &k, &Curl, "", &format!("잇기 {run}"), "사용자", "mac").unwrap();
    let team = relay::load_state(&d).team_id.clone();
    let body = bytes(crate::team_locker::CHUNK * parts - 100, 3);
    let src = dir(&format!("{tag}-work")).join("큰 영상.mp4");
    std::fs::write(&src, &body).unwrap();
    (d, k, team, src, body)
}

/// 올리는 줄을 지켜보며 본 까닭(note)을 모은다. cut 이 있으면 30% 를 넘을 때 그 파일을 만들어 돌리는 쪽에 알린다
fn watch(team: &str, cut: Option<String>) -> (std::sync::Arc<std::sync::atomic::AtomicBool>, std::thread::JoinHandle<Vec<String>>) {
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (s2, team) = (stop.clone(), team.to_string());
    let h = std::thread::spawn(move || {
        let (mut seen, mut told) = (Vec::new(), false);
        while !s2.load(std::sync::atomic::Ordering::Relaxed) {
            for u in uploads(&team) {
                if !u.note.is_empty() && seen.last() != Some(&u.note) {
                    eprintln!("[{}] {} — {}/{}", crate::team_relay::now_ms(), u.note, u.done, u.total);
                    seen.push(u.note.clone());
                }
                if let Some(c) = cut.as_ref().filter(|_| !told && u.total > 0 && u.done * 10 >= u.total * 3) {
                    std::fs::write(c, b"cut").unwrap();
                    told = true;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        seen
    });
    (stop, h)
}

#[test]
#[ignore]
fn 로컬_중계_올리는_중에_중계가_끊겨도_같은_조각부터_이어_올린다() {
    // 돌리는 쪽: CHAMMO_LIVE_CUT 파일이 생기면 wrangler 를 끄고 몇 초 뒤 같은 데이터로 다시 켠다
    let Some(_) = base() else { return eprintln!("CHAMMO_E2E_LIVE 없음 — 건너뜀") };
    let (d, k, team, src, body) = one_team("lk-cut", 40);
    let (stop, h) = watch(&team, std::env::var("CHAMMO_LIVE_CUT").ok());
    let began = std::time::Instant::now();
    let r = relay::as_human(|| put_file_in(&d, &k, &Curl, &team, "", "file", "영상", &src));
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    let seen = h.join().unwrap();
    eprintln!("올리기 {:?} · 까닭 {seen:?} · {:?}", began.elapsed(), r.as_ref().map(|f| f.size));
    let r = r.unwrap();
    assert!(seen.iter().any(|n| n == "net"), "끊긴 걸 봤어야 한다 {seen:?}");
    assert!(uploads(&team).is_empty(), "끝나면 줄이 사라진다");
    let got = relay::as_human(|| fetch_to(&d, &k, &Curl, &team, &r.id, &dir("lk-cut-down"))).unwrap();
    assert_eq!(std::fs::read(&got).unwrap(), body, "이어 올린 파일이 같은 바이트");
}

#[test]
#[ignore]
fn 로컬_중계_칸이_차면_칸이_넘어갈_때까지_기다렸다_끝까지_올린다() {
    // 최대 10분 남짓 걸린다. 칸(300)을 사람 요청으로 다 채운 뒤 올린다
    let Some(server) = base() else { return eprintln!("CHAMMO_E2E_LIVE 없음 — 건너뜀") };
    let (d, k, team, src, body) = one_team("lk-busy", 2);
    let st = relay::load_state(&d);
    let keys = relay::device_keys(&k, &st).unwrap();
    let mut n = 0;
    let filled = relay::as_human(|| loop {
        let (c, _) = relay::call(&Curl, &server, &keys, Some(&st.device_id), "GET", "/v0/me", None).unwrap();
        n += 1;
        if c == 429 || n > 400 {
            break c;
        }
    });
    eprintln!("칸 채움: {n}번째에 {filled}");
    assert_eq!(filled, 429);
    let (stop, h) = watch(&team, None);
    let began = std::time::Instant::now();
    let r = relay::as_human(|| put_file_in(&d, &k, &Curl, &team, "", "file", "", &src));
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    let seen = h.join().unwrap();
    eprintln!("올리기 {:?} · 까닭 {seen:?}", began.elapsed());
    let r = r.unwrap();
    assert!(seen.iter().any(|n| n == "busy"), "{seen:?}");
    let got = relay::as_human(|| fetch_to(&d, &k, &Curl, &team, &r.id, &dir("lk-busy-down"))).unwrap();
    assert_eq!(std::fs::read(&got).unwrap(), body);
}
