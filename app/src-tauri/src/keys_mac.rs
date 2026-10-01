//! 앱 전체 키 감시(NSEvent 로컬 모니터) — Ctrl+Tab·Ctrl+Shift+Tab 을 리더 탭 넘기기로.
//! 메뉴 단축키로 걸면 맥이 Ctrl+Tab 을 포커스 이동으로 먼저 가져가고, 문서 프레임(HTML·PDF) 안에 포커스가 있으면
//! 웹뷰 키 입력으로도 못 받는다(2026-09-28 사용자 "컨트롤 탭 안 먹는다"). 여기선 창·프레임과 상관없이 먼저 본다

use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use tauri::{AppHandle, Runtime};

const TAB: u16 = 48;

pub fn install<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    let block = RcBlock::new(move |ev: NonNull<NSEvent>| -> *mut NSEvent {
        let e = unsafe { ev.as_ref() };
        let m = e.modifierFlags();
        let ctrl_only = m.contains(NSEventModifierFlags::Control) && !m.contains(NSEventModifierFlags::Command) && !m.contains(NSEventModifierFlags::Option);
        if ctrl_only && e.keyCode() == TAB {
            crate::route_menu(&app, if m.contains(NSEventModifierFlags::Shift) { "reader_prev" } else { "reader_next" });
            return std::ptr::null_mut(); // 삼킨다 — 터미널로 안 간다
        }
        ev.as_ptr()
    });
    // 모니터는 앱이 끝날 때까지 산다 — 돌려받은 핸들은 버린다(해제하면 감시가 멈춘다)
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &block) };
    std::mem::forget(monitor);
    std::mem::forget(block);
}

/// 지구본(fn) 키 — keyCode 63. 오른쪽 ⌥ — 61. 눌림·뗌은 flagsChanged 로만 온다
const FN_KEY: u16 = 63;
const RIGHT_OPTION: u16 = 61;
/// 말하기 키 — 0 끔 · 1 지구본 · 2 오른쪽 ⌥ (설정 talkKey). 앱 밖에서도 볼지(talkAnywhere)
static TALK: AtomicU8 = AtomicU8::new(0);
static ANYWHERE: AtomicBool = AtomicBool::new(false);
static GLOBAL_ON: AtomicBool = AtomicBool::new(false);

fn on_flags(e: &NSEvent, outside: bool) {
    if outside && !ANYWHERE.load(Ordering::Relaxed) {
        return;
    }
    let m = e.modifierFlags();
    match (TALK.load(Ordering::Relaxed), e.keyCode()) {
        (1, FN_KEY) => crate::ptt::fn_key(m.contains(NSEventModifierFlags::Function)),
        (2, RIGHT_OPTION) => crate::ptt::fn_key(m.contains(NSEventModifierFlags::Option)),
        _ => {}
    }
}
/// 말하기 키를 누른 채 다른 키 — fn+화살표·fn+E 같은 조합이지 말하려던 게 아니다(0.2.0 검증) → 취소
fn on_key(outside: bool) {
    if TALK.load(Ordering::Relaxed) == 0 || (outside && !ANYWHERE.load(Ordering::Relaxed)) {
        return;
    }
    crate::ptt::other_key();
}

/// 말하기 키 감시 — 앱 안(로컬 모니터)은 늘 깔아 둔다(권한 필요 없음). 삼키지 않는다.
/// 앱 밖은 apply_talk 가 "어디서든"을 켤 때만 깐다 — 그때 처음 손쉬운 사용 권한을 묻는다
pub fn install_talk_watch() {
    let flags = RcBlock::new(|ev: NonNull<NSEvent>| -> *mut NSEvent {
        on_flags(unsafe { ev.as_ref() }, false);
        ev.as_ptr()
    });
    let keys = RcBlock::new(|ev: NonNull<NSEvent>| -> *mut NSEvent {
        on_key(false);
        ev.as_ptr()
    });
    let f = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::FlagsChanged, &flags) };
    let k = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &keys) };
    std::mem::forget((f, k, flags, keys));
}

/// 설정을 적용한다 — 메인 스레드에서 부를 것(앱 밖 모니터를 까는 게 메인 스레드 일이다)
pub fn apply_talk(key: &str, anywhere: bool) {
    let k = match key { "fn" => 1, "right-option" => 2, _ => 0 };
    TALK.store(k, Ordering::Relaxed);
    let outside = anywhere && k != 0;
    ANYWHERE.store(outside, Ordering::Relaxed);
    if outside && !GLOBAL_ON.swap(true, Ordering::Relaxed) {
        ask_accessibility();
        let flags = RcBlock::new(|ev: NonNull<NSEvent>| on_flags(unsafe { ev.as_ref() }, true));
        let keys = RcBlock::new(|_ev: NonNull<NSEvent>| on_key(true));
        let f = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(NSEventMask::FlagsChanged, &flags);
        let g = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &keys);
        std::mem::forget((f, g, flags, keys));
    }
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
}

/// 손쉬운 사용 권한이 없으면 시스템이 한 번 묻게 한다(이미 있으면 조용히 넘어간다)
fn ask_accessibility() {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;
    unsafe {
        let key = NSString::from_str("AXTrustedCheckOptionPrompt");
        let yes: *mut AnyObject = msg_send![class!(NSNumber), numberWithBool: true];
        let dict: *mut AnyObject = msg_send![class!(NSDictionary), dictionaryWithObject: yes, forKey: &*key];
        AXIsProcessTrustedWithOptions(dict as *const std::ffi::c_void);
    }
}
