//! 부모 잠금·하루 시간 시험 — 우회 경계부터(잠금 없이 나가기·틀린 숫자 연타·쉬는 동안·빈틈 시간·날 바뀜)
use super::*;
use std::path::PathBuf;

fn data(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-kguard-{tag}-{}-{}", std::process::id(), crate::mobile_pair::random_hex(4).unwrap()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn pin_is_four_digits_and_stored_hashed() {
    let d = data("pin");
    assert!(!lock_set_in(&d));
    for bad in ["123", "12345", "12a4", " 1234", "１２３４"] {
        assert!(set_pin_in(&d, bad).is_err(), "{bad:?}");
    }
    set_pin_in(&d, "2580").unwrap();
    assert!(lock_set_in(&d));
    let raw = std::fs::read_to_string(d.join("kids/lock.json")).unwrap();
    assert!(!raw.contains("2580"), "숫자 원문은 안 남는다");
}

#[test]
fn wrong_pins_back_off_longer_and_right_pin_resets() {
    let d = data("back");
    set_pin_in(&d, "2580").unwrap();
    let t = 1_000_000u64;
    assert_eq!(check_pin_in(&d, "1111", t), Err(PinErr::Wrong { wait_ms: 0 }));
    assert_eq!(check_pin_in(&d, "1111", t + 1), Err(PinErr::Wrong { wait_ms: 0 }));
    // 세 번째부터 쉬기 — 쉬는 동안엔 맞는 숫자도 안 받는다
    assert_eq!(check_pin_in(&d, "1111", t + 2), Err(PinErr::Wrong { wait_ms: 30_000 }));
    assert_eq!(check_pin_in(&d, "2580", t + 1000), Err(PinErr::Wait { wait_ms: 29_002 }));
    assert_eq!(check_pin_in(&d, "1111", t + 31_000), Err(PinErr::Wrong { wait_ms: 60_000 }));
    assert_eq!(check_pin_in(&d, "1111", t + 92_000), Err(PinErr::Wrong { wait_ms: 120_000 }));
    assert_eq!(check_pin_in(&d, "1111", t + 213_000), Err(PinErr::Wrong { wait_ms: 600_000 }));
    assert_eq!(check_pin_in(&d, "2580", t + 814_000), Ok(()));
    // 맞추면 처음부터
    assert_eq!(check_pin_in(&d, "1111", t + 815_000), Err(PinErr::Wrong { wait_ms: 0 }));
}

#[test]
fn no_pin_set_means_no_way_out_and_mac_reset_clears_waits() {
    let d = data("none");
    assert_eq!(check_pin_in(&d, "0000", 1), Err(PinErr::NoLock), "잠금을 안 정했으면 어떤 숫자로도 못 나간다");
    set_pin_in(&d, "2580").unwrap();
    for i in 0..4 {
        let _ = check_pin_in(&d, "1111", 10 + i);
    }
    assert!(matches!(check_pin_in(&d, "2580", 20), Err(PinErr::Wait { .. })));
    // 잊었을 때 맥에서 다시 정하면 쉬기도 풀린다
    set_pin_in(&d, "1357").unwrap();
    assert_eq!(check_pin_in(&d, "1357", 21), Ok(()));
    assert_eq!(check_pin_in(&d, "2580", 22), Err(PinErr::Wrong { wait_ms: 0 }), "옛 숫자는 이제 틀림");
}

#[test]
fn time_counts_only_visible_ticks_without_gaps() {
    let d = data("time");
    let day0 = 1_794_960_000_000u64; // 아무 날 0시 근처 — 날 바뀜은 아래에서
    let off = 0i64;
    let u = tick_in(&d, "참모-2", day0, off);
    assert_eq!(u.used_ms, 0, "첫 tick 은 시작점만");
    let u = tick_in(&d, "참모-2", day0 + 30_000, off);
    assert_eq!(u.used_ms, 30_000);
    // 화면을 안 보던 빈틈(35초 넘음)은 안 센다 — 그다음 tick 부터 다시
    let u = tick_in(&d, "참모-2", day0 + 30_000 + 600_000, off);
    assert_eq!(u.used_ms, 30_000);
    let u = tick_in(&d, "참모-2", day0 + 30_000 + 630_000, off);
    assert_eq!(u.used_ms, 60_000);
    assert_eq!(u.limit_ms, 20 * 60_000, "기본 하루 20분");
}

#[test]
fn day_rolls_over_in_local_time_and_parent_can_add() {
    let d = data("day");
    let off = 9 * 3_600_000i64; // 한국
    // 한국 밤 23:59:30 → 다음 날 00:00:00 — 그 30초는 앞날, 새 날은 0 부터
    let local_midnight = 1_794_960_000_000u64 - (1_794_960_000_000u64 + off as u64) % 86_400_000 + 86_400_000;
    let t0 = local_midnight - 60_000;
    tick_in(&d, "k", t0, off);
    let u = tick_in(&d, "k", t0 + 30_000, off);
    assert_eq!(u.used_ms, 30_000);
    let u = tick_in(&d, "k", local_midnight + 1_000, off);
    assert_eq!(u.used_ms, 0, "새 날");
    // 부모가 오늘 10분 더 · 하루 시간을 30분으로
    add_today_in(&d, "k", 10, local_midnight + 2_000, off).unwrap();
    set_daily_in(&d, 30).unwrap();
    let u = usage_in(&d, "k", local_midnight + 3_000, off);
    assert_eq!(u.limit_ms, 40 * 60_000);
    assert!(set_daily_in(&d, 0).is_err() && set_daily_in(&d, 300).is_err(), "5~180분만");
}
