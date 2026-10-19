//! 독 '종료'(·앱 전환기 ⌘Q·quit 애플 이벤트)를 한 번에, 기다림은 눈에 보이게 — tao 는 applicationShouldTerminate 가 없어 곧장 Exit 로 가서,
//! Craft 저장을 주 스레드를 막은 채 기다렸다(옛 판 15초 '대답 없음', 2026-10-19 사용자 "독에서 종료할 때 어려움").
//! 델리게이트에 applicationShouldTerminate: 를 달아 Craft 가 떠 있으면 NSTerminateLater — 종료 창이 '저장 중 · N초'(+건너뛰기)를 보이고
//! 끝나면 replyToApplicationShouldTerminate:YES 로 마저 끈다. Craft 가 없거나 이미 끄는 중이면 바로(NSTerminateNow)
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

/// NSApplicationTerminateReply
pub const TERMINATE_NOW: usize = 1;
pub const TERMINATE_LATER: usize = 2;

/// 웹이 종료 창(저장 중)을 이 안에 못 띄우면 그냥 끈다(웹 굳음) — quit::SHOWN_WAIT 와 같은 생각
pub const SHOWN_WAIT: Duration = Duration::from_secs(4);
/// 건너뛰기를 안 눌러도 이만큼 지나면 끈다 — 저장은 Craft 가 마저 한다(가짜 화면 도우미 linger)
pub const MAX_WAIT: Duration = Duration::from_secs(120);

/// 끄기를 미뤄 둔 중(종료 창이 저장을 보이는 중) — app_exit 가 오면 reply 로 마저 끈다
pub static PENDING: AtomicBool = AtomicBool::new(false);
/// 앱이 스스로 끄는 중(app.exit·SIGTERM) — 그 길에서 다시 묻지 않는다
pub static EXITING: AtomicBool = AtomicBool::new(false);
static ROUND: AtomicU64 = AtomicU64::new(0);

/// 지금 끌까 미룰까 — 이미 끄는 중이거나 저장할 Craft 가 없으면 바로.
/// 미뤄 둔 동안 독 종료를 또 눌러도 맥이 이 질문을 다시 안 한다(앞 대답을 기다림, 10/19 실측) — 바로 끄는 길은 종료 창의 건너뛰기
pub fn reply_for(exiting: bool, craft_running: bool) -> usize {
    if exiting || !craft_running { TERMINATE_NOW } else { TERMINATE_LATER }
}

#[cfg(target_os = "macos")]
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// 앱이 뜬 뒤 한 번 — tao 델리게이트 클래스에 applicationShouldTerminate: 를 더한다(메인 스레드)
#[cfg(target_os = "macos")]
pub fn install(app: &tauri::AppHandle) {
    use objc2::runtime::{AnyClass, AnyObject, Imp};
    use objc2::{class, msg_send, sel};
    let _ = APP.set(app.clone());
    let _ = app.run_on_main_thread(|| unsafe {
        let ns: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let del: *mut AnyObject = msg_send![ns, delegate];
        if del.is_null() {
            return;
        }
        let cls = objc2::ffi::object_getClass(del) as *mut AnyClass;
        let imp: Imp = std::mem::transmute(should_terminate as extern "C" fn(*mut AnyObject, objc2::runtime::Sel, *mut AnyObject) -> usize);
        objc2::ffi::class_addMethod(cls, sel!(applicationShouldTerminate:), imp, c"Q@:@".as_ptr());
    });
}

#[cfg(not(target_os = "macos"))]
pub fn install(_: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
extern "C" fn should_terminate(_: *mut objc2::runtime::AnyObject, _: objc2::runtime::Sel, _: *mut objc2::runtime::AnyObject) -> usize {
    let craft = crate::craft_screen::any_running(crate::config::data_dir(), crate::platform::pid_alive);
    let r = reply_for(EXITING.load(Ordering::SeqCst), craft);
    crate::claude::log_out("quit", if r == TERMINATE_NOW { "dock quit — now" } else { "dock quit — later (craft saving)" });
    if r == TERMINATE_LATER {
        PENDING.store(true, Ordering::SeqCst);
        let n = ROUND.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some(app) = APP.get() {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            crate::craft_window::to_main(app, "__dockQuit", serde_json::json!({}));
            let ask = crate::quit::ask();
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(SHOWN_WAIT);
                if crate::quit::unanswered(ask) {
                    finish(&app, n, "dock quit — dialog not shown (web stuck)");
                    return;
                }
                std::thread::sleep(MAX_WAIT - SHOWN_WAIT);
                finish(&app, n, "dock quit — waited long enough, craft keeps saving");
            });
        }
    }
    r
}

/// 미뤄 둔 끄기를 마저 — 종료 창이 저장을 다 봤거나 건너뛰었을 때(app_exit), 또는 시간이 다 됐을 때. 이 회차만
pub fn finish<R: tauri::Runtime>(app: &tauri::AppHandle<R>, round: u64, why: &str) -> bool {
    if !PENDING.load(Ordering::SeqCst) || (round != 0 && round != ROUND.load(Ordering::SeqCst)) {
        return false;
    }
    PENDING.store(false, Ordering::SeqCst);
    EXITING.store(true, Ordering::SeqCst);
    crate::claude::log_out("quit", why);
    // ⌥⌘Q 와 같은 감시 — 정리가 걸려도 정해 둔 시간 뒤엔 프로세스를 끝낸다
    std::thread::spawn(|| {
        std::thread::sleep(crate::quit::EXIT_WAIT);
        std::process::exit(0);
    });
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(|| unsafe {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        let ns: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![ns, replyToApplicationShouldTerminate: true];
    });
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn craft_가_떠_있을_때만_끄기를_미룬다() {
        assert_eq!(reply_for(false, true), TERMINATE_LATER, "저장할 Craft — 종료 창이 저장 중을 보인다");
        assert_eq!(reply_for(false, false), TERMINATE_NOW, "Craft 없으면 바로");
        assert_eq!(reply_for(true, true), TERMINATE_NOW, "앱이 스스로 끄는 중(⌥⌘Q·SIGTERM)이면 다시 안 묻는다");
    }

    #[test]
    fn 기다림은_짧게_묻고_길게는_안_붙잡는다() {
        assert!(SHOWN_WAIT <= Duration::from_secs(5));
        assert!(MAX_WAIT <= Duration::from_secs(180));
    }
}
