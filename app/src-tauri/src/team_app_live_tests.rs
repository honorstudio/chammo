//! 로컬 종단 시험 — 진짜 중계(wrangler dev, D1·R2 로컬, 마이그 0017 까지 --local) + 가짜 구글로 팀 캘린더가 계정 셋 사이에 끝까지 도는지.
//! 준비는 e2e_live_tests.rs 머리와 같다. 돌리기:
//!   CHAMMO_E2E_LIVE=http://localhost:8798 CHAMMO_MOCK_GOOGLE=http://127.0.0.1:8792 cargo test team_app_store::live -- --ignored --nocapture --exact team_app_store::live::로컬_중계_팀_캘린더_끝까지
use super::*;
use crate::accounts_store::fake::Fake;
use crate::e2e_flow::live::{base, login, now, read, sock};
use crate::e2e_flow::{self, Status};
use crate::team_app::APP_CAL;
use crate::team_relay::Curl;
use serde_json::json;
use std::time::Instant;

fn start(d: &Path, kc: &Fake) {
    e2e_flow::start_chain(d, kc, &Curl).unwrap();
    assert_eq!(e2e_flow::ensure(d, kc, &Curl).unwrap(), Status::InChain);
}

fn ev(title: &str) -> Value {
    json!({ "v": 1, "title": title, "allDay": true, "start": "2026-11-02", "end": "2026-11-03", "note": "", "place": "" })
}

fn item(s: &Snap, id: &str) -> Shown {
    s.items.iter().find(|i| i.id == id).cloned().unwrap_or_else(|| panic!("{id} 없음: {:?}", s.items.iter().map(|i| (&i.id, &i.why)).collect::<Vec<_>>()))
}

fn sync_now(d: &Path, k: &Fake, team: &str) -> Snap {
    let (s, job) = sync(d, k, &Curl, team, APP_CAL).unwrap();
    job.run(d, k, &Curl);
    s
}

#[test]
#[ignore]
fn 로컬_중계_팀_캘린더_끝까지() {
    let Some(server) = base() else { return eprintln!("CHAMMO_E2E_LIVE 없음 — 건너뜀") };
    let run = now();
    let (dy, ky) = login("cal-y", &server, &format!("cal-y-{run}"), "하늘");
    start(&dy, &ky);
    let (dd, kd) = login("cal-d", &server, &format!("cal-d-{run}"), "민아");
    start(&dd, &kd);
    relay::create(&dy, &ky, &Curl, "", &format!("캘린더팀 {run}"), "하늘", "mac").unwrap();
    let team = relay::load_state(&dy).team_id.clone();
    let inv = relay::invite(&dy, &ky, &Curl, "").unwrap();
    relay::join(&dd, &kd, &Curl, "", &inv.link, "민아", "mac").unwrap();
    for (d, k) in [(&dy, &ky), (&dd, &kd)] {
        relay::refresh_members(d, k, &Curl, "").unwrap();
    }

    // ① 첫 쓰기 — 열쇠 줄(appkey)이 없으니 하늘 앱이 만든다. 민아는 since 로 받아 같은 내용을 연다
    let t = Instant::now();
    let w = write(&dy, &ky, &Curl, &team, APP_CAL, "e1", 0, None, Some(ev("주간회의")), false).unwrap();
    eprintln!("① 첫 쓰기(열쇠 줄 만들기 포함) {}ms rev={}", t.elapsed().as_millis(), w.rev);
    let s = sync_now(&dd, &kd, &team);
    assert_eq!(item(&s, "e1").data["title"], "주간회의", "민아가 하늘 일정을 연다");
    assert_eq!(item(&s, "e1").data["made"]["by"], relay::load_state(&dy).team(&team).unwrap().member_id.as_str());

    // ② 남이 고친 게 소켓으로 바로 — 하늘이 고치면 민아 내 기기끼리 방에 기록째, 기록장에 반영
    let mut wd = sock(&dd, &kd, &relay::self_room(&dd, &kd, &Curl).unwrap());
    let r1 = w.rev;
    let t = Instant::now();
    let w2 = write(&dy, &ky, &Curl, &team, APP_CAL, "e1", r1, Some(item(&s, "e1").data), Some(json!({ "title": "주간회의", "allDay": true, "start": "2026-11-02", "end": "2026-11-03", "note": "자료 준비", "place": "" })), false).unwrap();
    let wrote = t.elapsed().as_millis();
    let m = loop {
        let m = read(&mut wd);
        if m["t"] == "app" {
            break m;
        }
    };
    let got = t.elapsed().as_millis();
    push(&dd, &m);
    assert_eq!(load(&dd, &kd, &team, APP_CAL).map(|s| item(&s, "e1").data["note"].clone()), Some(json!("자료 준비")));
    eprintln!("② 고치기 {wrote}ms · 민아 소켓 도착 {got}ms(쓰기 시작부터) · 기록장 반영 확인");

    // ③ 동시에 — 둘 다 r2 에서 시작: 하늘은 장소, 민아는 제목. 나중 쪽이 409 → 칸마다 합쳐 둘 다 남는다
    let base_data = item(&load(&dd, &kd, &team, APP_CAL).unwrap(), "e1").data;
    let mut a = base_data.clone();
    a["place"] = json!("사무실");
    let mut b = base_data.clone();
    b["title"] = json!("[주간회의] 11시");
    write(&dy, &ky, &Curl, &team, APP_CAL, "e1", w2.rev, Some(base_data.clone()), Some(a), false).unwrap();
    let wb = write(&dd, &kd, &Curl, &team, APP_CAL, "e1", w2.rev, Some(base_data.clone()), Some(b), false).unwrap();
    let e = item(&wb.snap, "e1").data;
    assert_eq!((e["place"].clone(), e["title"].clone()), (json!("사무실"), json!("[주간회의] 11시")), "다른 칸은 둘 다");
    assert!(wb.lost.is_empty());
    eprintln!("③ 다른 칸 동시 고침 → 둘 다 남음(장소·제목)");

    // ④ 같은 칸 — 둘 다 메모를 고치면 나중 쪽이 이기고 lost 에 'note'
    let now_e = item(&sync_now(&dy, &ky, &team), "e1");
    let mut a = now_e.data.clone();
    a["note"] = json!("하늘 메모");
    let mut b = now_e.data.clone();
    b["note"] = json!("민아 메모");
    write(&dy, &ky, &Curl, &team, APP_CAL, "e1", now_e.rev, Some(now_e.data.clone()), Some(a), false).unwrap();
    let wb = write(&dd, &kd, &Curl, &team, APP_CAL, "e1", now_e.rev, Some(now_e.data.clone()), Some(b), false).unwrap();
    assert_eq!(wb.lost, vec!["note".to_string()]);
    assert_eq!(item(&wb.snap, "e1").data["note"], "민아 메모");
    eprintln!("④ 같은 칸 → 나중(민아) 이김 · lost={:?} by={}", wb.lost, wb.by);

    // ⑤ 민아가 지운 걸 하늘이 옛 판으로 고치면 멈춘다(gone) — 다시 살리기는 된다
    let cur = item(&sync_now(&dd, &kd, &team), "e1");
    write(&dd, &kd, &Curl, &team, APP_CAL, "e1", cur.rev, Some(cur.data.clone()), None, false).unwrap();
    let mut mine = cur.data.clone();
    mine["title"] = json!("하늘이 고침");
    let g = write(&dy, &ky, &Curl, &team, APP_CAL, "e1", cur.rev, Some(cur.data.clone()), Some(mine.clone()), false).unwrap();
    assert!(g.gone, "지운 일정이 몰래 되살아나지 않는다");
    let back = write(&dy, &ky, &Curl, &team, APP_CAL, "e1", cur.rev, Some(cur.data.clone()), Some(mine), true).unwrap();
    assert!(!item(&back.snap, "e1").del);
    eprintln!("⑤ 지운 일정 고침 → gone · 다시 살리기 됨");

    // ⑥ 나중에 든 철수 — 하늘 앱 목록(봉투 더하기)이 돈 뒤 예전 일정까지 연다
    let (dc, kc) = login("cal-c", &server, &format!("cal-c-{run}"), "철수");
    start(&dc, &kc);
    let inv = relay::invite(&dy, &ky, &Curl, "").unwrap();
    relay::join(&dc, &kc, &Curl, "", &inv.link, "철수", "mac").unwrap();
    for (d, k) in [(&dy, &ky), (&dd, &kd), (&dc, &kc)] {
        relay::refresh_members(d, k, &Curl, "").unwrap();
    }
    crate::team_locker_app::forget_people(&team);
    let before = sync_now(&dc, &kc, &team);
    eprintln!("⑥ 철수 첫 sync(봉투 전) — e1 why={:?}", before.items.iter().find(|i| i.id == "e1").map(|i| i.why.clone()));
    sync_now(&dy, &ky, &team); // 하늘 앱이 철수 몫 봉투를 더한다
    let after = sync_now(&dc, &kc, &team);
    assert_eq!(item(&after, "e1").data["title"], "하늘이 고침", "나중에 든 사람도 예전 일정을 연다");
    eprintln!("⑥ 하늘 앱 봉투 더하기 뒤 철수 → e1 열림");

    // ⑦ 철수를 빼면 — 다음 쓰기는 새 열쇠(빠진 기기가 든 열쇠로는 안 쓴다), 철수는 못 읽는다
    relay::remove_member(&dy, &ky, &Curl, "", "철수").unwrap();
    crate::team_locker_app::forget_people(&team);
    let w7 = write(&dy, &ky, &Curl, &team, APP_CAL, "e2", 0, None, Some(ev("철수 빠진 뒤")), false).unwrap();
    let rows = sync_now(&dd, &kd, &team);
    assert_eq!(item(&rows, "e2").data["title"], "철수 빠진 뒤", "민아는 새 열쇠로도 연다");
    let key_of = |id: &str| LIVE.lock().unwrap().get(&key(&dd, &team, APP_CAL)).unwrap().book.items[id].0.key.clone();
    assert_ne!(key_of("e2"), key_of("e1"), "빠진 기기가 든 열쇠로는 안 쓴다 — 새 appkey 줄");
    eprintln!("⑦ 철수 빠진 뒤 e2 rev={} · 새 열쇠 {} (e1 옛 열쇠 {})", w7.rev, key_of("e2"), key_of("e1"));
    assert!(sync(&dc, &kc, &Curl, &team, APP_CAL).is_err(), "빠진 사람은 못 읽는다");
}
