//! 기본 참모 앱 미리 받기(2026-10-26 사용자 "표·PDF·슬라이드·문서·벡터 같은 기본은 미리 설치해 줘야") — 첫 설정을 끝낸 뒤,
//! 쓰던 사람은 다음 켤 때 scripts/craft prefetch 를 뒤에서 한 번 돌린다(없는 것만 차례로, 체크섬·번들 id·공증은 open --native 와 같은 길).
//! 디스크 5GB 아래·설정 > 기능에서 끔이면 스크립트가 건너뛴다. 나머지 8개(포토·필름…)는 쓸 때 설치
use std::time::Duration;

/// 켤 때 이만큼 기다렸다가 — 앱이 뜨는 동안 내려받기·디스크가 겹치지 않게
const FIRST_WAIT: Duration = Duration::from_secs(20);
/// 첫 설정 전이면 이 주기로 다시 본다(마법사를 끝내면 그 판에서 바로)
const EVERY: Duration = Duration::from_secs(60);

/// 지금 돌릴까 — 첫 설정을 끝냈고 켜 둠. 개발판은 시험 앱 자리(CHAMMO_CRAFT_APPS_DIR)를 줬을 때만(이 맥 /Applications 에 깔지 않게)
pub fn due(setup_done: bool, on: bool, debug: bool, test_apps_dir: bool) -> bool {
    setup_done && on && (!debug || test_apps_dir)
}

/// 설정 저장에서 껐던 스위치를 다시 켰나 — 그러면 사람이 지운 기본 앱 기록을 비우고 지금 다시 받는다
pub fn turned_on(was: bool, now: bool) -> bool {
    !was && now
}

fn ready() -> bool {
    let c = crate::config::current();
    let test_dir = std::env::var("CHAMMO_CRAFT_APPS_DIR").is_ok_and(|v| !v.trim().is_empty());
    due(c.setup_done, c.features.craft_basics, cfg!(debug_assertions), test_dir) && crate::platform::need_python().is_ok()
}

fn run(reset: bool) {
    let mut cmd = crate::craft_window::craft_cmd();
    cmd.arg("prefetch");
    if reset {
        cmd.arg("--reset");
    }
    match cmd.output() {
        Ok(o) => crate::claude::log_out("craft-basics", String::from_utf8_lossy(&o.stdout).trim()),
        Err(e) => crate::claude::log_out("craft-basics", &e.to_string()),
    }
}

pub fn start() {
    std::thread::spawn(|| {
        std::thread::sleep(FIRST_WAIT);
        loop {
            if ready() {
                run(false);
                return; // 한 판에 한 번 — 모자란 디스크·실패는 다음 켤 때 다시
            }
            std::thread::sleep(EVERY);
        }
    });
}

/// 설정 > 기능에서 다시 켰다(write_config) — 지운 기록을 비우고 뒤에서 바로(받는 중이면 스크립트가 busy 로 넘긴다)
pub fn reset_now() {
    std::thread::spawn(|| {
        if ready() {
            run(true);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 첫_설정을_끝내고_켜_둬야_돈다() {
        assert!(due(true, true, false, false));
        assert!(!due(false, true, false, false));
        assert!(!due(true, false, false, false));
    }

    #[test]
    fn 개발판은_시험_앱_자리를_줬을_때만() {
        assert!(!due(true, true, true, false));
        assert!(due(true, true, true, true));
    }

    #[test]
    fn 껐다_켤_때만_다시_받는다() {
        assert!(turned_on(false, true));
        assert!(!turned_on(true, true));
        assert!(!turned_on(true, false));
        assert!(!turned_on(false, false));
    }

    #[test]
    fn 기본값은_켬() {
        assert!(crate::config::Features::default().craft_basics);
        let f: crate::config::Features = serde_json::from_str("{}").unwrap();
        assert!(f.craft_basics, "옛 설정 파일(칸 없음)도 켬");
    }
}
