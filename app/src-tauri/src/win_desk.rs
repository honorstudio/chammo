//! 윈도우 세션 크롬 = 숨은 데스크톱(2026-10-28 인앱 브라우저 윈도우판, 래퍼 tools/chammo-browser/src/windesk.js).
//! - 비출 창이 없다 → 칸은 헤드리스와 같은 '그림 칸' 길(CDP screencast 를 네이티브 층에, 제자리 크기 맞춤)
//! - 사람 차례 OS 창(패스키·Windows Hello·OS 파일 창)은 사람이 못 본다 → 앱이 <live>/<프로필>.show 를 쓰면 래퍼가 같은 프로필을
//!   보이는 데스크톱에 다시 띄운다(src/winshow.js). 되돌릴 땐 '다 했어' 표(done)를 같이 넘겨 래퍼가 다 띄운 뒤에 남기게 한다
//! - 꺼냄 표시 <프로필>.shown {pid} 은 래퍼가 쓴다 — 맥 '크롬 창 꺼냄'(SHOWN)과 같은 자리
use std::path::Path;

/// 이 기계 세션 크롬이 그림 칸 길인가 — 헤드리스(맥 가짜 화면 없음)거나 윈도우(숨은 데스크톱·보이는 창 둘 다 CDP 그림)
pub fn frames_pane(headless: bool) -> bool {
    headless || cfg!(target_os = "windows")
}

/// 숨은 데스크톱 크롬인가(칸 더보기 문구) — 윈도우이고 헤드리스가 아니고 꺼내지 않았을 때
pub fn on_hidden_desk(headless: bool, shown: bool) -> bool {
    cfg!(target_os = "windows") && !headless && !shown
}

/// 보이는 창 요청 본문 — 래퍼는 자기 pid·60초 안 요청만 받는다
pub fn show_body(pid: i32, at_ms: u64, on: bool, done: Option<&str>) -> String {
    let mut v = serde_json::json!({ "pid": pid, "at": at_ms, "on": on });
    if let Some(d) = done {
        v["done"] = serde_json::Value::from(d);
    }
    v.to_string()
}

/// 래퍼가 그 크롬을 보이는 데스크톱에 꺼내 뒀나(그 래퍼 pid 의 표시일 때만)
pub fn shown(live_dir: &Path, profile: &str, pid: i32) -> bool {
    mark_of(live_dir, profile, "shown", pid)
}

/// 요청 쓰기 — on = 보이는 창으로, done = 되돌린 뒤 래퍼가 남길 '다 했어' 표
pub fn ask(live_dir: &Path, profile: &str, pid: i32, on: bool, done: Option<&str>) -> Result<(), String> {
    ask_to(live_dir, profile, "show", pid, on, done)
}

/// 맥 패스키 탈출구(2026-10-28) — ad-hoc 사본엔 맥 플랫폼 패스키가 없어 사람이 '이번만 구글 크롬으로 열기'를 누르면 래퍼가 같은 프로필을
/// 구글 서명 원본으로 다시 띄운다(같은 틀, 이름만 <프로필>.signed · .signed-on — tools/chammo-browser src/winshow.js SIGNED). 되돌리면 ad-hoc
pub fn signed_on(live_dir: &Path, profile: &str, pid: i32) -> bool {
    mark_of(live_dir, profile, "signed-on", pid)
}

/// 래퍼가 패스키를 보고 스스로 바꿔 둔 표인가(2026-10-29 패스키 자동, tools/chammo-browser src/passkey-auto.js) — 칸이 까닭 한 줄과 돌아오기
pub fn signed_auto(live_dir: &Path, profile: &str, pid: i32) -> bool {
    std::fs::read_to_string(live_dir.join(format!("{profile}.signed-on")))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .is_some_and(|v| v["pid"].as_i64() == Some(pid as i64) && v["auto"] == true)
}

pub fn ask_signed(live_dir: &Path, profile: &str, pid: i32, on: bool, done: Option<&str>) -> Result<(), String> {
    ask_to(live_dir, profile, "signed", pid, on, done)
}

fn mark_of(live_dir: &Path, profile: &str, tail: &str, pid: i32) -> bool {
    std::fs::read_to_string(live_dir.join(format!("{profile}.{tail}")))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .is_some_and(|v| v["pid"].as_i64() == Some(pid as i64))
}

fn ask_to(live_dir: &Path, profile: &str, tail: &str, pid: i32, on: bool, done: Option<&str>) -> Result<(), String> {
    ASKED.store(crate::takeover::now_ms(), std::sync::atomic::Ordering::Relaxed);
    crate::takeover::write_secure(&live_dir.join(format!("{profile}.{tail}")), show_body(pid, crate::takeover::now_ms(), on, done).as_bytes())
}

/// 마지막으로 창 바꾸기를 부탁한 때(ms) — 래퍼가 닫고 다시 여는 탭을 사람이 닫고 연 탭으로 적지 않게(10-28 윈도우 시험 PC: 세션이 '닫은 탭'을 사람 일로 받았다)
static ASKED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
const SWITCH_MS: u64 = 20_000;

/// 창을 바꾸는 중인가(부탁한 뒤 20초) — 그동안 탭 열고 닫힘은 개입 기록에 안 넣는다
pub fn switching() -> bool {
    in_switch(ASKED.load(std::sync::atomic::Ordering::Relaxed), crate::takeover::now_ms())
}

pub fn in_switch(asked: u64, now: u64) -> bool {
    asked > 0 && now.saturating_sub(asked) < SWITCH_MS
}

/// 사람이 '보이는 창에서 열기'를 누른 지금(앱이 앞 창) — 곧 다시 뜰 크롬이 앞 창이 될 수 있게 넘겨 둔다.
/// 안 하면 윈도우 앞 창 잠금 때문에 크롬이 앱 창 뒤에 떠서 패스키 창을 사람이 못 찾았다(10-28 윈도우 시험 PC 실측)
pub fn let_front() {
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(windows_sys::Win32::UI::WindowsAndMessaging::ASFW_ANY);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 요청_본문은_래퍼가_읽는_모양() {
        let v: serde_json::Value = serde_json::from_str(&show_body(42, 7, true, None)).unwrap();
        assert_eq!(v, serde_json::json!({ "pid": 42, "at": 7, "on": true }));
        let v: serde_json::Value = serde_json::from_str(&show_body(42, 7, false, Some("42:1700"))).unwrap();
        assert_eq!(v["done"], "42:1700");
        assert_eq!(v["on"], false);
    }

    #[test]
    fn 꺼냄_표시는_그_래퍼_것만() {
        let d = std::env::temp_dir().join(format!("chammo-windesk-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        assert!(!shown(&d, "shop", 42));
        std::fs::write(d.join("shop.shown"), r#"{"pid":42,"at":1}"#).unwrap();
        assert!(shown(&d, "shop", 42));
        assert!(!shown(&d, "shop", 7), "다른 래퍼(세션이 바뀜)");
        std::fs::write(d.join("shop.shown"), "깨짐").unwrap();
        assert!(!shown(&d, "shop", 42));
        ask(&d, "shop", 42, true, None).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join("shop.show")).unwrap()).unwrap();
        assert_eq!(v["pid"], 42);
        assert!(v["at"].as_u64().unwrap() > 1_600_000_000_000);
        let _ = std::fs::remove_dir_all(&d);
    }

    // 2026-10-28 맥 패스키 탈출구 — 같은 틀을 다른 이름(<프로필>.signed 요청·.signed-on 표)으로. 윈도우 꺼냄 표(.shown)와 안 섞인다
    #[test]
    fn 구글_크롬_요청과_표는_따로_이름() {
        let d = std::env::temp_dir().join(format!("chammo-signed-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        assert!(!signed_on(&d, "shop", 42));
        std::fs::write(d.join("shop.signed-on"), r#"{"pid":42,"at":1}"#).unwrap();
        assert!(signed_on(&d, "shop", 42));
        assert!(!signed_on(&d, "shop", 7), "다른 래퍼");
        assert!(!shown(&d, "shop", 42), "윈도우 꺼냄 표가 아니다");
        ask_signed(&d, "shop", 42, true, None).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join("shop.signed")).unwrap()).unwrap();
        assert_eq!((v["pid"].as_i64(), v["on"].as_bool()), (Some(42), Some(true)));
        assert!(!d.join("shop.show").exists());
        assert!(switching(), "다시 띄우며 닫고 여는 탭은 사람 일로 안 적는다");
        let _ = std::fs::remove_dir_all(&d);
    }

    // 2026-10-29 패스키 자동 — 래퍼가 패스키를 보고 스스로 바꿨으면 표에 auto:true(칸이 '패스키 때문에 크롬 창에서 열었어')
    #[test]
    fn 스스로_바꾼_표는_auto() {
        let d = std::env::temp_dir().join(format!("chammo-signed-auto-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        assert!(!signed_auto(&d, "shop", 42));
        std::fs::write(d.join("shop.signed-on"), r#"{"pid":42,"at":1}"#).unwrap();
        assert!(!signed_auto(&d, "shop", 42), "사람이 고른 것");
        std::fs::write(d.join("shop.signed-on"), r#"{"pid":42,"at":1,"auto":true}"#).unwrap();
        assert!(signed_auto(&d, "shop", 42));
        assert!(!signed_auto(&d, "shop", 7), "다른 래퍼");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 창을_바꾸는_20초는_탭_기록을_뺀다() {
        assert!(!in_switch(0, 5_000), "부탁한 적 없음");
        assert!(in_switch(1_000, 1_500));
        assert!(in_switch(1_000, 20_999));
        assert!(!in_switch(1_000, 21_000));
    }

    #[test]
    fn 그림_칸은_헤드리스거나_윈도우() {
        assert!(frames_pane(true));
        assert_eq!(frames_pane(false), cfg!(target_os = "windows"), "맥 창 있는 크롬은 SCK 비추기");
        assert!(!on_hidden_desk(true, false));
        assert!(!on_hidden_desk(false, true), "꺼냈으면 숨은 데스크톱 아님");
        assert_eq!(on_hidden_desk(false, false), cfg!(target_os = "windows"));
    }
}
