//! 키를 누르고 있으면 반복되게 한다 — macOS '길게 눌러 악센트 고르기'(ApplePressAndHoldEnabled, 기본 켬)를 이 앱만 끈다.
//! 켜져 있으면 WKWebView 가 진짜 키보드의 반복 입력을 삼켜서, Claude Code 음성 입력(스페이스 길게 누르기)이
//! 시작되지 않는다. Claude 는 120ms 안쪽 간격으로 스페이스가 5개 이어져야 '누르고 있음'으로 본다.
//! iTerm2 도 같은 이유로 자기 설정에 이 값을 false 로 써 둔다. 앱 안에서 만든 NSEvent 는 이 기능을 안 타서
//! 합성 키로는 재현되지 않는다(2026-09-27 실측, fix/space-push-to-talk)

use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::NSString;

const KEY: &str = "ApplePressAndHoldEnabled";

/// 기본값 모음(NSUserDefaults)에 끔을 써 둔다. 이미 꺼져 있으면 쓰지 않는다
fn disable_in(defaults: &AnyObject) {
    let key = NSString::from_str(KEY);
    unsafe {
        let cur: *mut AnyObject = msg_send![defaults, objectForKey: &*key];
        let on: bool = !cur.is_null() && msg_send![defaults, boolForKey: &*key];
        if cur.is_null() || on {
            let _: () = msg_send![defaults, setBool: false, forKey: &*key];
        }
    }
}

/// 앱 시작할 때 한 번 — 창이 키를 받기 전에
pub fn disable_press_and_hold() {
    unsafe {
        let d: *mut AnyObject = msg_send![class!(NSUserDefaults), standardUserDefaults];
        if let Some(d) = d.as_ref() {
            disable_in(d);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::rc::Retained;

    // 테스트마다 따로 — 병렬로 돌 때 서로 안 밟게
    fn suite(tag: &str) -> Retained<AnyObject> {
        let name = NSString::from_str(&format!("app.chammo.keyrepeat-test.{tag}"));
        unsafe {
            let d: *mut AnyObject = msg_send![class!(NSUserDefaults), alloc];
            let d: *mut AnyObject = msg_send![d, initWithSuiteName: &*name];
            Retained::from_raw(d).expect("suite")
        }
    }

    fn read(d: &AnyObject) -> Option<bool> {
        let key = NSString::from_str(KEY);
        unsafe {
            let cur: *mut AnyObject = msg_send![d, objectForKey: &*key];
            if cur.is_null() { None } else { Some(msg_send![d, boolForKey: &*key]) }
        }
    }

    fn write(d: &AnyObject, v: bool) {
        let key = NSString::from_str(KEY);
        unsafe { let _: () = msg_send![d, setBool: v, forKey: &*key]; }
    }

    // 도메인을 비워도 ~/Library/Preferences 에 빈 plist 가 남는다 — 파일까지 지운다
    fn clear(d: &AnyObject, tag: &str) {
        let domain = format!("app.chammo.keyrepeat-test.{tag}");
        let name = NSString::from_str(&domain);
        unsafe { let _: () = msg_send![d, removePersistentDomainForName: &*name]; }
        let home = crate::platform::home();
        let _ = std::fs::remove_file(format!("{home}/Library/Preferences/{domain}.plist"));
    }

    #[test]
    fn 값이_없으면_끔을_써_둔다() {
        let d = suite("empty");
        clear(&d, "empty");
        disable_in(&d);
        assert_eq!(read(&d), Some(false));
        clear(&d, "empty");
    }

    #[test]
    fn 켜져_있어도_끈다() {
        let d = suite("on");
        write(&d, true);
        disable_in(&d);
        assert_eq!(read(&d), Some(false));
        clear(&d, "on");
    }
}
