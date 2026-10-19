//! 완전히 종료(⌥⌘Q)가 늘 끝까지 가게 — 종료 창은 웹 화면이 그려서, 웹이 굳으면(2026-10-13 사용자 "제대로 안 꺼진다") 아무 일도 안 일어났다.
//! 물을 때마다 번호를 올리고, 웹이 종료 창을 띄웠다고 알리면(app_quit_shown) 그 번호를 적는다. 시간 안에 못 들었으면 세션은 두고 앱만 끈다.
//! 끄는 길(정리·세션 끄기)이 걸려도 정해 둔 시간 뒤엔 프로세스를 끝낸다
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// 종료 창이 이 안에 안 뜨면 웹이 굳었다고 본다
pub const SHOWN_WAIT: Duration = Duration::from_secs(4);
/// app.exit 뒤 정리(가상 화면·모드 호스트·폰 서버)가 이 안에 안 끝나면 강제로
pub const EXIT_WAIT: Duration = Duration::from_secs(8);

static ASKED: AtomicU64 = AtomicU64::new(0);
static SHOWN: AtomicU64 = AtomicU64::new(0);

/// 물었다 → 이 물음 번호
pub fn ask() -> u64 {
    ASKED.fetch_add(1, Ordering::SeqCst) + 1
}

/// 웹이 종료 창을 띄웠다 — 지금까지 물은 것 다 들었다
pub fn shown() {
    SHOWN.store(ASKED.load(Ordering::SeqCst), Ordering::SeqCst);
}

/// 이 물음을 웹이 못 들었나(종료 창을 안 띄웠나)
pub fn unanswered(n: u64) -> bool {
    SHOWN.load(Ordering::SeqCst) < n
}

/// 앱만 끈다(세션은 계속) — 막혀도 EXIT_WAIT 뒤엔 프로세스를 끝낸다
pub fn exit_now<R: tauri::Runtime>(app: &tauri::AppHandle<R>, why: &str) {
    crate::dock_quit::EXITING.store(true, Ordering::SeqCst);
    crate::claude::log_out("quit", why);
    std::thread::spawn(|| {
        std::thread::sleep(EXIT_WAIT);
        crate::claude::log_out("quit", "cleanup over time — process::exit");
        std::process::exit(0);
    });
    app.exit(0);
}

/// ⌥⌘Q — 웹에 종료 창을 부탁하고, SHOWN_WAIT 안에 못 들으면 앱만 끈다
pub fn ask_or_exit<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let n = ask();
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SHOWN_WAIT);
        if unanswered(n) {
            exit_now(&app, "quit dialog not shown (web stuck) — app only, sessions keep running");
        }
    });
}

/// SIGTERM(kill·install-personal-app 이 30초 뒤 보내는 것)도 같은 끄기 길로 — 예전엔 즉사해서 Craft 앱이 저장 없이 고아로 남았다(2026-10-19 끄기 QA).
/// 신호 처리기에선 표시만 하고, 지켜보는 스레드가 exit_now 를 부른다
#[cfg(unix)]
static TERM: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(unix)]
extern "C" fn on_term(_: libc::c_int) {
    TERM.store(true, Ordering::SeqCst);
}

pub fn watch_sigterm<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    #[cfg(unix)]
    {
        unsafe { libc::signal(libc::SIGTERM, on_term as *const () as libc::sighandler_t) };
        let app = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(200));
            if TERM.load(Ordering::SeqCst) {
                crate::craft_screen::SIGTERM.store(true, Ordering::SeqCst);
                exit_now(&app, "SIGTERM");
                return;
            }
        });
    }
    #[cfg(not(unix))]
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 종료_창을_못_띄운_물음만_시간_뒤에_앱을_끈다() {
        // 10/13 사용자: 웹이 굳으면 ⌥⌘Q 종료 창이 안 떠 앱이 안 꺼졌다
        let a = ask();
        assert!(unanswered(a), "아직 창이 안 떴다");
        shown();
        assert!(!unanswered(a), "창이 떴으면 사람이 고른다(취소해도 안 끈다)");
        let b = ask();
        assert!(unanswered(b), "다음 물음은 다시 들어야 한다");
        shown();
        assert!(!unanswered(b));
    }

    #[test]
    fn 기다림은_짧게_정리는_조금_더() {
        assert!(SHOWN_WAIT <= Duration::from_secs(5));
        assert!(EXIT_WAIT > SHOWN_WAIT && EXIT_WAIT <= Duration::from_secs(10));
    }
}
