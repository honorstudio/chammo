//! Craft 맥 앱 비추기 — tools/craft-mirror(Swift, build.rs 가 정적 링크)의 C 함수 셋을 감싼다.
//! 맥에서 링크됐을 때만(`craft_mirror` cfg) 진짜, 아니면(윈도우·swiftc 실패) 아무것도 안 하고 None
#![cfg_attr(not(craft_mirror), allow(dead_code))]

/// 비추기 손잡이 — Swift 쪽 Mirror 객체(뗄 때 돌려준다)
pub struct Handle(pub usize);

/// 비추는 상태 — Swift craft_mirror_status 와 같은 번호
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Status {
    Waiting,
    Live,
    NoPermission,
    NoWindow,
    Stopped,
}

pub fn status_of(n: i32) -> Status {
    match n {
        0 => Status::Waiting,
        1 => Status::Live,
        2 => Status::NoPermission,
        3 => Status::NoWindow,
        _ => Status::Stopped,
    }
}

/// 이 빌드에 비추기가 들어 있나 — 릴리스 점검·창 안내 글이 본다
pub const LINKED: bool = cfg!(craft_mirror);

#[cfg(craft_mirror)]
extern "C" {
    fn craft_mirror_attach(win: *mut std::ffi::c_void, pid: i32, top: f64, bottom: f64) -> *mut std::ffi::c_void;
    fn craft_mirror_status(h: *mut std::ffi::c_void) -> i32;
    fn craft_mirror_detach(h: *mut std::ffi::c_void);
    fn craft_mirror_point(h: *mut std::ffi::c_void, names: *const std::ffi::c_char, label: *const std::ffi::c_char, hold: f64);
    fn craft_mirror_input(h: *mut std::ffi::c_void, on: i32);
    fn craft_mirror_debug_event(win: *mut std::ffi::c_void, gx: f64, gy: f64, kind: i32, chars: *const std::ffi::c_char);
    fn craft_mirror_place(h: *mut std::ffi::c_void, x: f64, y: f64, w: f64, hh: f64, vh: f64, visible: i32);
    fn craft_mirror_still(h: *mut std::ffi::c_void, path: *const std::ffi::c_char) -> i32;
    fn craft_mirror_set_input(h: *mut std::ffi::c_void, cb: extern "C" fn(*mut std::ffi::c_void, *const std::ffi::c_char), ctx: *mut std::ffi::c_void);
}

/// 창(NSWindow 포인터) 안에 pid 앱의 창을 비춘다 — 위·아래 여백(머리줄·아래 줄)만큼 비우고. 메인 스레드에서만
pub fn attach(ns_window: usize, pid: i32, top: f64, bottom: f64) -> Option<Handle> {
    #[cfg(craft_mirror)]
    {
        let h = unsafe { craft_mirror_attach(ns_window as *mut _, pid, top, bottom) };
        return (!h.is_null()).then(|| Handle(h as usize));
    }
    #[cfg(not(craft_mirror))]
    {
        let _ = (ns_window, pid, top, bottom);
        None
    }
}

pub fn status(h: &Handle) -> Status {
    #[cfg(craft_mirror)]
    {
        return status_of(unsafe { craft_mirror_status(h.0 as *mut _) });
    }
    #[cfg(not(craft_mirror))]
    {
        let _ = h;
        Status::Stopped
    }
}

/// 참모 손 — 이름들(JSON 배열)의 자리로 손이 옮겨 가 누르고 글. hold 초 동안은 안 사라지고 머문다(긴 명령). 메인 스레드에서만(AX 훑기는 Swift 가 뒤에서)
pub fn point(h: &Handle, names_json: &str, label: &str, hold: u32) {
    #[cfg(craft_mirror)]
    {
        let (Ok(n), Ok(l)) = (std::ffi::CString::new(names_json), std::ffi::CString::new(label)) else { return };
        unsafe { craft_mirror_point(h.0 as *mut _, n.as_ptr(), l.as_ptr(), hold as f64) }
    }
    #[cfg(not(craft_mirror))]
    let _ = (h, names_json, label, hold);
}

/// 스페이스 탭 칸에 얹기 — [x, y, w, h] 는 웹뷰 왼쪽 위 기준 CSS 점, vh = 웹 innerHeight(제목줄 밑 깔림 재기), 안 보이면 숨기고 받기를 멈춘다. 메인 스레드에서만
pub fn place(h: &Handle, r: [f64; 4], vh: f64, visible: bool) {
    #[cfg(craft_mirror)]
    unsafe {
        craft_mirror_place(h.0 as *mut _, r[0], r[1], r[2], r[3], vh, visible as i32)
    }
    #[cfg(not(craft_mirror))]
    let _ = (h, r, vh, visible);
}

/// 마지막 프레임을 JPEG 파일로 — 덮개가 칸을 덮을 때 웹이 그 자리에 깐다. 메인 스레드에서만
pub fn still(h: &Handle, path: &std::path::Path) -> bool {
    #[cfg(craft_mirror)]
    {
        let Ok(p) = std::ffi::CString::new(path.to_string_lossy().as_bytes()) else { return false };
        return unsafe { craft_mirror_still(h.0 as *mut _, p.as_ptr()) } == 1;
    }
    #[cfg(not(craft_mirror))]
    {
        let _ = (h, path);
        false
    }
}

/// 개입 — 켜면 비추기 칸의 마우스·키를 그 앱에 넘기고(앱 이름 ctx 로 craft_input::on_input), 끄면 막는다(잠금). 메인 스레드에서만
pub fn set_input(h: &Handle, on: bool, app: &str) {
    #[cfg(craft_mirror)]
    unsafe {
        if on {
            // 앱 이름은 창이 닫힐 때까지 쓰인다 — 작아서 그냥 둔다(창 하나에 한 번)
            let ctx = Box::into_raw(Box::new(app.to_string())) as *mut std::ffi::c_void;
            craft_mirror_set_input(h.0 as *mut _, crate::craft_input::on_input, ctx);
        }
        craft_mirror_input(h.0 as *mut _, on as i32);
    }
    #[cfg(not(craft_mirror))]
    let _ = (h, on, app);
}

/// 받기를 멈추고 뷰를 뗀다 — 메인 스레드에서만
pub fn detach(h: Handle) {
    #[cfg(craft_mirror)]
    unsafe {
        craft_mirror_detach(h.0 as *mut _)
    }
    #[cfg(not(craft_mirror))]
    let _ = h;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 상태_번호는_swift_와_같다() {
        assert_eq!(status_of(0), Status::Waiting);
        assert_eq!(status_of(1), Status::Live);
        assert_eq!(status_of(2), Status::NoPermission);
        assert_eq!(status_of(3), Status::NoWindow);
        assert_eq!(status_of(9), Status::Stopped);
    }

    #[test]
    fn 윈도우_빌드는_swift_를_안_건드린다() {
        // build.rs 의 craft_mirror 는 맥이 아니면 swiftc 를 부르기 전에 돌아간다 — 윈도우(win-build)에서 링크 줄이 안 나온다
        let b = include_str!("../build.rs");
        let f = &b[b.find("fn craft_mirror()").unwrap()..];
        let guard = f.find(r#"!= Ok("macos")"#).expect("맥 검사");
        assert!(guard < f.find("swiftc").unwrap(), "맥 검사가 swiftc 보다 먼저");
        assert!(guard < f.find("rustc-link-lib=static=craftmirror").unwrap());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn 맥_빌드엔_비추기가_링크된다() {
        // swiftc 가 있는 맥에서 빌드했으면 들어 있어야 한다(빠지면 release-check 도 잡는다)
        if crate::platform::command("swiftc").arg("--version").output().is_ok_and(|o| o.status.success()) {
            assert!(LINKED);
        }
    }
}

/// 개발판 시험 전용 — <데이터>/debug/craft-event.json({"window":"main","x","y","kind":"down|up|drag|move|key","chars"})을 0.3초마다 보고
/// 그 창에 앱 안에서 이벤트를 흘린다(실제 클릭과 같은 hitTest 길). 사람 화면·커서를 안 건드리고 개입 입력을 시험하려고. 릴리스 빌드엔 없다
pub fn debug_event_watch<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if !cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(300));
        let p = crate::config::data_dir().join("debug").join("craft-event.json");
        let Ok(t) = std::fs::read_to_string(&p) else { continue };
        let _ = std::fs::remove_file(&p);
        let evs: Vec<serde_json::Value> = serde_json::from_str::<serde_json::Value>(&t).ok().map(|v| if v.is_array() { v.as_array().cloned().unwrap_or_default() } else { vec![v] }).unwrap_or_default();
        for v in evs {
            use tauri::Manager;
            let Some(w) = app.get_webview_window(v["window"].as_str().unwrap_or("main")) else { continue };
            let kind = match v["kind"].as_str().unwrap_or("") { "down" => 0, "up" => 1, "drag" => 2, "move" => 3, "key" => 4, _ => continue };
            let (x, y) = (v["x"].as_f64().unwrap_or(0.0), v["y"].as_f64().unwrap_or(0.0));
            let chars = std::ffi::CString::new(v["chars"].as_str().unwrap_or("")).unwrap_or_default();
            let w2 = w.clone();
            let _ = w.run_on_main_thread(move || {
                #[cfg(all(craft_mirror, target_os = "macos"))]
                if let Ok(ns) = w2.ns_window() {
                    unsafe { craft_mirror_debug_event(ns as *mut _, x, y, kind, chars.as_ptr()) }
                }
                #[cfg(not(all(craft_mirror, target_os = "macos")))]
                let _ = (&w2, x, y, kind, &chars);
            });
            std::thread::sleep(std::time::Duration::from_millis(v["wait"].as_u64().unwrap_or(60)));
        }
    });
}
