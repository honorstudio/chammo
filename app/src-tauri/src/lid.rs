//! 맥북 덮개가 닫혔나 — 닫으면 앱 창이 가짜 화면(Chammo agents)에 '보이는 채로' 남아 document.hidden 이 안 걸리고,
//! 입력 2분을 기다려야 프사·말하는 빛·오피스가 멈췄다(2026-10-04 교훈). 덮개 상태를 3초마다 읽어 바뀔 때만
//! 메인·다마고치 웹뷰의 window.__lidClosed(ui/attention)로 알린다 → 닫는 순간(3초 안) html.oa-paused.
//! 읽기는 IORegistry 의 IOPMrootDomain 'AppleClamshellState' 하나 — ioreg 를 부르지 않고 IOKit 을 직접(서비스 핸들은 한 번 잡아 둔다).
//! 덮개 없는 맥(아이맥·맥 미니)은 값이 없어 '열림'. 덮개를 닫고 외장 모니터로 쓰는 중(클램셸)이면 사람이 보고 있으니 '열림' —
//! 가짜 화면 말고 켜진 화면이 하나라도 있으면(vdisplay::visible_displays) 멈추지 않는다. 윈도우·리눅스는 해당 없음
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// 읽는 주기 — 한 번에 수 마이크로초라 3초마다 돌려도 티가 안 난다(tests::이_맥에서_읽힌다_비용 — 디버그 빌드 7.8µs)
pub const EVERY: Duration = Duration::from_secs(3);

/// 마지막으로 읽은 덮개 상태 — 웹뷰가 새로 뜨면(페이지 로드) 이걸 다시 알린다
static CLOSED: AtomicBool = AtomicBool::new(false);

/// 멈출 덮개 닫힘인가 — 덮개가 닫혔고(None = 덮개 없는 맥) 가짜 화면 말고 켜진 화면이 없을 때만.
/// 화면 세기는 닫혔을 때만 부른다(열린 동안은 덮개 값 하나만 읽는다)
pub fn closed(lid: Option<bool>, real_screens: impl FnOnce() -> usize) -> bool {
    lid == Some(true) && real_screens() == 0
}

/// 앞과 같으면 안 알린다
pub fn next(last: bool, now: bool) -> Option<bool> {
    (now != last).then_some(now)
}

/// 웹뷰에 넣는 JS — 아직 ui/attention 이 안 붙었으면 __lidClosedNow 에 남겨 붙을 때 읽게 한다
pub fn push_js(closed: bool) -> String {
    format!("window.__lidClosedNow={closed};window.__lidClosed&&window.__lidClosed({closed})")
}

fn push<R: tauri::Runtime>(app: &tauri::AppHandle<R>, closed: bool) {
    use tauri::Manager;
    for label in ["main", "tama"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.eval(push_js(closed));
        }
    }
}

/// 메인·다마고치 페이지가 (다시) 뜰 때 — 앞서 알린 값이 새 페이지엔 없다
pub fn on_page_load<R: tauri::Runtime>(wv: &tauri::Webview<R>) {
    if matches!(wv.label(), "main" | "tama") {
        let _ = wv.eval(push_js(CLOSED.load(Ordering::Relaxed)));
    }
}

#[cfg(target_os = "macos")]
pub fn start<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(r) = mac::Reader::new() else { return };
        loop {
            let now = closed(r.read(), || crate::vdisplay::visible_displays().len());
            if let Some(v) = next(CLOSED.load(Ordering::Relaxed), now) {
                CLOSED.store(v, Ordering::Relaxed); // 알리기 전에 — 그 사이 뜬 페이지가 새 값을 받게
                push(&app, v);
            }
            std::thread::sleep(EVERY);
        }
    });
}
#[cfg(not(target_os = "macos"))]
pub fn start<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) {}

#[cfg(target_os = "macos")]
pub mod mac {
    use std::ffi::{c_char, c_void};

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOServiceMatching(name: *const c_char) -> *mut c_void;
        fn IOServiceGetMatchingService(main_port: u32, matching: *mut c_void) -> u32;
        fn IORegistryEntryCreateCFProperty(entry: u32, key: *const c_void, alloc: *const c_void, options: u32) -> *const c_void;
        fn IOObjectRelease(obj: u32) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(alloc: *const c_void, s: *const c_char, encoding: u32) -> *const c_void;
        fn CFGetTypeID(cf: *const c_void) -> usize;
        fn CFBooleanGetTypeID() -> usize;
        fn CFBooleanGetValue(b: *const c_void) -> u8;
        fn CFRelease(cf: *const c_void);
    }
    const UTF8: u32 = 0x0800_0100;

    /// IOPMrootDomain 핸들과 키 글을 한 번 만들어 두고 읽기마다 쓴다
    pub struct Reader {
        root: u32,
        key: *const c_void,
    }
    // 스레드 하나가 쥐고 쓴다 — 핸들(mach port 번호)·불변 CFString 이라 넘겨도 된다
    unsafe impl Send for Reader {}

    impl Reader {
        pub fn new() -> Option<Self> {
            unsafe {
                // 넘긴 matching 사전은 IOServiceGetMatchingService 가 가져간다(따로 안 놓는다). 0 = 기본 main port
                let root = IOServiceGetMatchingService(0, IOServiceMatching(c"IOPMrootDomain".as_ptr()));
                if root == 0 {
                    return None;
                }
                let key = CFStringCreateWithCString(std::ptr::null(), c"AppleClamshellState".as_ptr(), UTF8);
                if key.is_null() {
                    IOObjectRelease(root);
                    return None;
                }
                Some(Reader { root, key })
            }
        }

        /// Some(true) = 닫힘, Some(false) = 열림, None = 이 맥엔 덮개 값이 없음
        pub fn read(&self) -> Option<bool> {
            unsafe {
                let v = IORegistryEntryCreateCFProperty(self.root, self.key, std::ptr::null(), 0);
                if v.is_null() {
                    return None;
                }
                let out = (CFGetTypeID(v) == CFBooleanGetTypeID()).then(|| CFBooleanGetValue(v) != 0);
                CFRelease(v);
                out
            }
        }
    }

    impl Drop for Reader {
        fn drop(&mut self) {
            unsafe {
                CFRelease(self.key);
                IOObjectRelease(self.root);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 바뀔_때만_알린다() {
        assert_eq!(next(false, true), Some(true)); // 닫음
        assert_eq!(next(true, true), None); // 닫힌 채
        assert_eq!(next(true, false), Some(false)); // 엶
        assert_eq!(next(false, false), None);
    }

    #[test]
    fn 닫혔고_진짜_화면이_없을_때만_멈춤() {
        assert!(closed(Some(true), || 0)); // 맥북만 쓰다 덮개 닫음 — 가짜 화면만 남는다
        assert!(!closed(Some(true), || 1)); // 클램셸(외장 모니터로 계속 씀)
        assert!(!closed(Some(false), || 0));
        assert!(!closed(None, || 0)); // 덮개 없는 맥
    }

    #[test]
    fn 열린_동안은_화면을_안_센다() {
        assert!(!closed(Some(false), || panic!("열렸는데 화면을 셌다")));
        assert!(!closed(None, || panic!("덮개 없는데 화면을 셌다")));
    }

    #[test]
    fn 붙기_전이어도_남겨_둔다() {
        assert_eq!(push_js(true), "window.__lidClosedNow=true;window.__lidClosed&&window.__lidClosed(true)");
        assert!(push_js(false).contains("__lidClosed(false)"));
    }

    // 이 맥에서 진짜로 읽는다 — 덮개가 있는 맥이면 Some, 아이맥·맥 미니면 None. 핸들 하나로 여러 번 읽어도 같은 값
    #[cfg(target_os = "macos")]
    #[test]
    fn 이_맥에서_읽힌다_비용() {
        let r = mac::Reader::new().expect("IOPMrootDomain");
        let first = r.read();
        let n = 1_000;
        let t = std::time::Instant::now();
        for _ in 0..n {
            assert_eq!(r.read(), first);
        }
        let per = t.elapsed() / n;
        eprintln!("AppleClamshellState = {first:?}, 한 번 읽기 {per:?}");
        assert!(per < Duration::from_millis(1), "읽기가 너무 느림: {per:?}");
    }
}
