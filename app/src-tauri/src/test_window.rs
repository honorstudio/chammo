//! 시험판 창 숨기기 — 시험 데이터 폴더(CHAMMO_HOME=~/.chammo-perf 등)로 뜬 개발·시험 빌드는 창을 화면 밖에 두고
//! Dock·⌘Tab·포커스를 안 가져간다(2026-11-16 사용자 "참모앱 테스트 하는 거 자꾸 안 띄우고 가능?" — 시험 창이 쓰던 화면을 가리고 포커스를 뺏었다).
//! - 사람이 보려면 CHAMMO_TEST_SHOW=1(또는 CHAMMO_DEV_WINDOW=main) — 예전처럼 옆 화면·가짜 화면
//! - 자리를 직접 주려면 CHAMMO_DEV_WINDOW=x,y(논리 좌표 — 가짜 화면 등). 그래도 Dock·포커스는 안 가져간다
//! - 릴리스(debug_assertions 꺼짐)·진짜 데이터 폴더는 안 숨는다 — 공개판 사용자가 CHAMMO_HOME 을 바꿔도 창은 그대로
//! 화면 밖 창은 가림 감지를 꺼서(debug::keep_visible) 웹뷰가 rAF·타이머를 계속 돌린다. 가짜 화면은 새로 만들지 않는다
use std::sync::OnceLock;

/// 화면 밖 자리(논리 좌표) — 가짜 화면(Chammo agents)은 주 화면 왼쪽·아래 모서리라 음수 쪽을 피해 오른쪽 아래 멀리
pub const OFF: (i32, i32) = (20000, 20000);

/// 숨김이면 창 자리, 아니면 None. 값 = (빌드가 디버그인가, 진짜 데이터 폴더인가, CHAMMO_TEST_SHOW, CHAMMO_DEV_WINDOW)
pub fn decide(debug: bool, real_data: bool, show: Option<&str>, dev_window: Option<&str>) -> Option<(i32, i32)> {
    if !debug || real_data {
        return None;
    }
    if show.map(str::trim).is_some_and(|v| !v.is_empty() && v != "0") {
        return None;
    }
    match dev_window.map(str::trim) {
        Some("main") => None,
        Some(v) => Some(crate::debug::dev_spot(v).unwrap_or(OFF)),
        None => Some(OFF),
    }
}

/// 시험판은 OS 알림을 안 낸다 — 디버그 빌드 + 시험 데이터 폴더면 저절로(창을 보이게 해도), CHAMMO_TEST_NOTIFY=1 일 때만 낸다.
/// 11-17 시험 참모 send 로 뜬 '참모 답이 필요해' 가 사용자 맥 알림에 떴다 — 끄는 스위치(CHAMMO_NO_OS_NOTIFY)를 손으로 띄울 때 안 걸었다. 폰 푸시는 원래 진짜 데이터 폴더만(mobile::push_allowed)
pub fn quiet_decide(debug: bool, real_data: bool, test_notify: Option<&str>) -> bool {
    debug && !real_data && test_notify.map(str::trim) != Some("1")
}

/// 이 앱이 시험판이라 알림을 안 내나 — 떠 있는 동안 안 바뀐다
pub fn quiet() -> bool {
    static Q: OnceLock<bool> = OnceLock::new();
    *Q.get_or_init(|| {
        let real = crate::config::is_real_data(&crate::config::home(), crate::config::data_dir());
        quiet_decide(cfg!(debug_assertions), real, std::env::var("CHAMMO_TEST_NOTIFY").ok().as_deref())
    })
}

/// 이 앱이 시험판 숨김으로 떴나 — 떠 있는 동안 안 바뀐다(맥만)
pub fn spot() -> Option<(i32, i32)> {
    static S: OnceLock<Option<(i32, i32)>> = OnceLock::new();
    *S.get_or_init(|| {
        if !cfg!(target_os = "macos") {
            return None;
        }
        let real = crate::config::is_real_data(&crate::config::home(), crate::config::data_dir());
        decide(cfg!(debug_assertions), real, std::env::var("CHAMMO_TEST_SHOW").ok().as_deref(), std::env::var("CHAMMO_DEV_WINDOW").ok().as_deref())
    })
}

/// 설정 파일의 창(main)을 처음부터 그 자리에, 포커스 없이 — setup 에서 옮기면 켜지는 순간 기본 자리(사람 화면 가운데)에 한 번 보였다
pub fn prepare(ctx: &mut tauri::Context<tauri::Wry>) {
    let Some((x, y)) = spot() else { return };
    for w in ctx.config_mut().app.windows.iter_mut() {
        w.x = Some(x as f64);
        w.y = Some(y as f64);
        w.center = false;
        w.focus = false;
        // 보이는 채로 만들면 맥이 창을 화면 안으로 끌어온다(제목줄 있는 창을 띄울 때 constrainFrameRect) — 숨겨 만들고 떠서 보인다(show_after_launch)
        w.visible = false;
    }
}

/// 앱이 뜬 뒤(RunEvent::Ready — tao 가 켤 때 창을 한 번 더 앞으로 꺼낸 다음) 화면 밖 자리에서 보인다. 가림 감지를 꺼서 웹뷰가 계속 그린다
pub fn show_after_launch<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    let Some((x, y)) = spot() else { return };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_position(tauri::LogicalPosition::new(x, y));
        crate::debug::keep_visible(&w);
        let _ = w.show();
    }
}

/// 이 앱의 창(TaoWindow 클래스)을 맥이 화면 안으로 끌어오지 않게 — constrainFrameRect:toScreen: 이 받은 자리를 그대로 돌려준다.
/// 시험판에서만, 메인 스레드(setup)에서 한 번. 그 클래스 창(모드·팀 창 등)이 모두 따른다
#[cfg(target_os = "macos")]
fn keep_offscreen<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2_foundation::NSRect;
    use tauri::Manager;
    extern "C" fn same(_: *mut AnyObject, _: Sel, frame: NSRect, _: *mut AnyObject) -> NSRect {
        frame
    }
    let Some(w) = app.get_webview_window("main") else { return };
    let Ok(ns) = w.ns_window() else { return };
    unsafe {
        let cls = objc2::ffi::object_getClass(ns as *mut AnyObject) as *mut AnyClass;
        let imp: Imp = std::mem::transmute(same as extern "C" fn(*mut AnyObject, Sel, NSRect, *mut AnyObject) -> NSRect);
        objc2::ffi::class_addMethod(cls, objc2::sel!(constrainFrameRect:toScreen:), imp, c"{CGRect={CGPoint=dd}{CGSize=dd}}@:{CGRect={CGPoint=dd}{CGSize=dd}}@".as_ptr());
    }
}

/// main() 맨 처음 — NSApplication 이 생기는 순간부터 Prohibited(메인 스레드)
pub fn early() {
    #[cfg(target_os = "macos")]
    if spot().is_some() {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        unsafe {
            let ns: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: bool = msg_send![ns, setActivationPolicy: 2isize]; // NSApplicationActivationPolicyProhibited
        }
    }
}

/// setup 첫머리 — Dock·⌘Tab 에서 빼고 켜질 때 앞으로 안 나오게(Prohibited 면 tao 의 activateIgnoringOtherApps 가 아무것도 안 한다)
pub fn on_setup(app: &mut tauri::App) {
    if spot().is_none() {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        app.set_activation_policy(tauri::ActivationPolicy::Prohibited);
        keep_offscreen(app.handle());
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    crate::claude::log_out("test-window", "test build: windows off-screen, no Dock/focus (CHAMMO_TEST_SHOW=1 to show)");
}

#[cfg(test)]
mod tests {
    use super::{decide, quiet_decide, OFF};
    #[test]
    fn 시험판은_알림을_저절로_끈다() {
        assert!(quiet_decide(true, false, None), "디버그 + 시험 폴더");
        assert!(quiet_decide(true, false, Some("0")));
        assert!(!quiet_decide(true, false, Some("1")), "사람이 알림까지 보겠다고 할 때만");
        assert!(!quiet_decide(true, true, None), "진짜 데이터 폴더의 개발판은 그대로");
        assert!(!quiet_decide(false, false, None), "공개판이 CHAMMO_HOME 을 바꿔도 그대로");
    }
    #[test]
    fn 시험_폴더로_뜬_개발판은_화면_밖() {
        assert_eq!(decide(true, false, None, None), Some(OFF));
    }
    #[test]
    fn 릴리스나_진짜_폴더는_안_숨는다() {
        assert_eq!(decide(false, false, None, None), None, "공개판 사용자가 CHAMMO_HOME 을 바꿔도 창은 그대로");
        assert_eq!(decide(true, true, None, None), None, "사용자 개발판(진짜 폴더)");
    }
    #[test]
    fn 보이기는_사람이_켤_때만() {
        assert_eq!(decide(true, false, Some("1"), None), None);
        assert_eq!(decide(true, false, Some("0"), None), Some(OFF));
        assert_eq!(decide(true, false, Some(""), None), Some(OFF));
        assert_eq!(decide(true, false, None, Some("main")), None);
    }
    #[test]
    fn 자리를_주면_그_자리_못_읽으면_화면_밖() {
        assert_eq!(decide(true, false, None, Some("-2890,1440")), Some((-2890, 1440)));
        assert_eq!(decide(true, false, None, Some("x")), Some(OFF));
    }
}
