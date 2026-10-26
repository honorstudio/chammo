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
