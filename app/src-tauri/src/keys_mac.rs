//! 앱 전체 키 감시(NSEvent 로컬 모니터) — Ctrl+Tab·Ctrl+Shift+Tab 을 리더 탭 넘기기로.
//! 메뉴 단축키로 걸면 맥이 Ctrl+Tab 을 포커스 이동으로 먼저 가져가고, 문서 프레임(HTML·PDF) 안에 포커스가 있으면
//! 웹뷰 키 입력으로도 못 받는다(2026-09-28 사용자 "컨트롤 탭 안 먹는다"). 여기선 창·프레임과 상관없이 먼저 본다

use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};
use std::ptr::NonNull;
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
