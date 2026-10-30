//! 미리보기·채팅 파일 카드에 띄운 파일을 남에게 건네기(2026-10-30 사용자 "파인더에서 열거나, 이 상태에서 드래그해서 전달하고 싶어").
//! 파인더에서 보기 = locker_reveal 이 보관함 밖이면 여기 거름을 지난 것만 연다 · 바깥 앱으로 끌기 = drag_native(맥 끌기 세션).
//! 받는 경로는 폰 문지기와 같은 거름(mobile_files::pick_local — 형식만 안 가림) — 보여 준 기록·보관함 집 파일 안, 링크·../·점 폴더·데이터 폴더·비밀 이름은 거절
use crate::mobile_files::{self, Pick, Rules};
use std::path::PathBuf;

/// 보여 준 파일인가(순수) — show 기록(풀린 것)·보관함 집 파일 목록 안이고 pick_local 이 Ok(형식은 안 가림)
pub(crate) fn shown_ok(path: &str, show_log: &str, locker: &[String], rules: &Rules) -> bool {
    let mut allowed = mobile_files::allowed_files(show_log, "", &rules.data_dir, "");
    allowed.extend_from_slice(locker);
    matches!(mobile_files::pick_local(path, &allowed, rules), Pick::Ok(_))
}

/// 지금 기록으로 본 shown_ok
pub(crate) fn shown_now(path: &str) -> bool {
    let a = crate::locker_fs::app_ctx();
    let locker = crate::locker_fs::phone_paths(&a.root, &a.home);
    let rules = Rules { data_dir: a.data.clone(), hq_dir: String::new(), home: a.home.clone() };
    shown_ok(path, &crate::reader::read_show_log(), &locker, &rules)
}

/// 끌 파일 묶음 — 1~50개, 전부 거름을 지나야 한다(하나라도 아니면 통째로 거절)
pub(crate) fn drag_list(paths: &[String], ok: impl Fn(&str) -> bool) -> Result<Vec<PathBuf>, String> {
    if paths.is_empty() || paths.len() > 50 {
        return Err("파일은 한 번에 1~50개".into());
    }
    paths.iter().map(|p| if ok(p) { Ok(PathBuf::from(p)) } else { Err(format!("보여 준 파일만 끌 수 있어: {p}")) }).collect()
}

/// 창 밖으로 끌고 나간 파일 — 맥 끌기 세션으로 넘겨 파인더·카톡·메일이 받게 한다. 버튼을 누른 채일 때 불러야 한다(웹은 창을 벗어나는 순간 부른다).
/// 넘겼으면 true(맥 밖 판은 false — 웹이 하던 창 사이 끌기로 이어 간다)
#[tauri::command]
pub fn drag_native(app: tauri::AppHandle, window: tauri::WebviewWindow, paths: Vec<String>) -> Result<bool, String> {
    if !crate::team_ui::ui_window(window.label()) {
        return Err("ui only".into());
    }
    let files = drag_list(&paths, |p| crate::locker_fs::locker_path_ok(p) || shown_now(p))?;
    begin(&app, &window, files)
}

#[cfg(target_os = "macos")]
fn begin(app: &tauri::AppHandle, window: &tauri::WebviewWindow, files: Vec<PathBuf>) -> Result<bool, String> {
    let win = window.ns_window().map_err(|e| e.to_string())? as usize;
    app.run_on_main_thread(move || unsafe { mac::begin(win, &files) }).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(not(target_os = "macos"))]
fn begin(_: &tauri::AppHandle, _: &tauri::WebviewWindow, _: Vec<PathBuf>) -> Result<bool, String> {
    Ok(false)
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
    use objc2::{class, sel};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
    use std::path::PathBuf;

    /// NSDraggingSource — 받는 앱이 복사로 받게(NSDragOperationCopy). 하나 만들어 앱 끝까지 둔다
    fn source() -> *mut AnyObject {
        static SRC: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
        extern "C" fn copy_only(_: *mut AnyObject, _: Sel, _: *mut AnyObject, _: isize) -> usize {
            1
        }
        *SRC.get_or_init(|| unsafe {
            let mut b = ClassBuilder::new(c"ChammoDragSource", class!(NSObject)).expect("drag source class");
            b.add_method(sel!(draggingSession:sourceOperationMaskForDraggingContext:), copy_only as extern "C" fn(_, _, _, _) -> _);
            if let Some(p) = objc2::runtime::AnyProtocol::get(c"NSDraggingSource") {
                b.add_protocol(p);
            }
            let cls: &AnyClass = b.register();
            let o: *mut AnyObject = msg_send![cls, new];
            o as usize
        }) as *mut AnyObject
    }

    /// 지금 마우스 자리에서 끌기 세션 — 끄는 중 사건(LeftMouseDragged)을 그 자리로 새로 만들어 준다(웹뷰가 받은 사건은 이미 지나갔다)
    pub unsafe fn begin(win: usize, files: &[PathBuf]) {
        let win = win as *mut AnyObject;
        let view: *mut AnyObject = msg_send![win, contentView];
        if view.is_null() {
            return;
        }
        let at_win: NSPoint = msg_send![win, mouseLocationOutsideOfEventStream];
        let at: NSPoint = msg_send![view, convertPoint: at_win, fromView: std::ptr::null_mut::<AnyObject>()];
        let ws: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        let items: *mut AnyObject = msg_send![class!(NSMutableArray), array];
        for (i, f) in files.iter().enumerate() {
            let s = NSString::from_str(&f.to_string_lossy());
            let url: *mut AnyObject = msg_send![class!(NSURL), fileURLWithPath: &*s];
            let item: *mut AnyObject = msg_send![class!(NSDraggingItem), alloc];
            let item: *mut AnyObject = msg_send![item, initWithPasteboardWriter: url];
            let icon: *mut AnyObject = msg_send![ws, iconForFile: &*s];
            let off = (i.min(4) * 6) as f64; // 여럿이면 조금씩 비켜 쌓는다
            let frame = NSRect::new(NSPoint::new(at.x - 24.0 + off, at.y - 24.0 - off), NSSize::new(48.0, 48.0));
            let _: () = msg_send![item, setDraggingFrame: frame, contents: icon];
            let _: () = msg_send![items, addObject: item];
            let _: () = msg_send![item, release];
        }
        let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
        let uptime: f64 = msg_send![info, systemUptime];
        let num: isize = msg_send![win, windowNumber];
        let ev: *mut AnyObject = msg_send![class!(NSEvent), mouseEventWithType: 6usize, location: at_win, modifierFlags: 0usize, timestamp: uptime,
            windowNumber: num, context: std::ptr::null_mut::<AnyObject>(), eventNumber: 0isize, clickCount: 1isize, pressure: 1.0f32];
        if ev.is_null() {
            return;
        }
        let _: *mut AnyObject = msg_send![view, beginDraggingSessionWithItems: items, event: ev, source: source()];
    }
}

#[cfg(test)]
#[path = "shown_share_tests.rs"]
mod tests;
