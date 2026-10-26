//! 자리 비움(2026-10-24 사용자가 밖에서 놓침) — 맥 마지막 입력(키보드·마우스) 뒤 초와 화면 잠김.
//! 맥 창을 앞에 둔 채 자리를 비우면 '보고 있음'으로 쳐서 사람 필요 알림이 폰 푸시까지 안 나갔다 → 판단은 domain/notify awayStep.
//! 맥 밖은 모름(idle: None) — 지금처럼 앱 안만
use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Idle {
    /// 마지막 입력 뒤 초 — 모르면 None
    pub idle: Option<f64>,
    /// 화면 잠김
    pub locked: bool,
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::c_void;

    /// kCGEventSourceStateHIDSystemState — 하드웨어 입력 기준(앱이 만든 가짜 사건은 안 셈)
    const HID_SYSTEM_STATE: i32 = 1;
    /// kCGAnyInputEventType
    const ANY_INPUT: u32 = u32::MAX;
    /// kCFStringEncodingUTF8
    const UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, kind: u32) -> f64;
        fn CGSessionCopyCurrentDictionary() -> *const c_void;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFBooleanTrue: *const c_void;
        fn CFStringCreateWithCString(alloc: *const c_void, s: *const std::ffi::c_char, enc: u32) -> *const c_void;
        fn CFDictionaryGetValue(d: *const c_void, key: *const c_void) -> *const c_void;
        fn CFRelease(p: *const c_void);
    }

    pub fn idle_secs() -> Option<f64> {
        let s = unsafe { CGEventSourceSecondsSinceLastEventType(HID_SYSTEM_STATE, ANY_INPUT) };
        (s.is_finite() && s >= 0.0).then_some(s)
    }

    /// 로그인 창 세션 사전의 CGSSessionScreenIsLocked — 잠기지 않았으면 키가 아예 없다
    pub fn locked() -> bool {
        unsafe {
            let d = CGSessionCopyCurrentDictionary();
            if d.is_null() {
                return false;
            }
            let key = CFStringCreateWithCString(std::ptr::null(), c"CGSSessionScreenIsLocked".as_ptr(), UTF8);
            let v = if key.is_null() { std::ptr::null() } else { CFDictionaryGetValue(d, key) };
            let on = !v.is_null() && v == kCFBooleanTrue;
            if !key.is_null() {
                CFRelease(key);
            }
            CFRelease(d);
            on
        }
    }
}

pub fn now() -> Idle {
    #[cfg(target_os = "macos")]
    return Idle { idle: mac::idle_secs(), locked: mac::locked() };
    #[cfg(not(target_os = "macos"))]
    Idle { idle: None, locked: false }
}

/// 프론트 notifier 가 보고 있어 건너뛴 사람 필요 알림을 붙든 동안 묻는다(가벼운 시스템 호출 둘)
#[tauri::command]
pub fn user_idle() -> Idle {
    now()
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(target_os = "macos")]
    fn 맥은_마지막_입력_뒤_초를_읽는다() {
        // 진짜 시스템 호출 — 시험 기계에선 잠겨 있지 않고 입력 시간이 0 이상으로 나와야 한다
        let s = super::now();
        assert!(s.idle.is_some_and(|x| x >= 0.0), "{s:?}");
    }
}
