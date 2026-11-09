//! 앱 낮잠(App Nap) 끄기 — 이 앱은 사람이 안 보는 동안에도 폰 요청·허브 소켓·세션 지켜보기를 맡는 서버다.
//! 맥이 잠기거나 창이 가려지면 맥이 앱 스레드 54개를 전부 우선순위 4 로 묶었다(11-07 잠긴 맥 실측 — 보통 31~46). 다른 일이 조금만 있어도 CPU 를 못 받아
//! CPU 는 4% 인데 평균 12개 스레드가 '돌 준비'로 줄 서 부하 평균을 올렸고(켠 뒤 대기 39,655초), 폰 첫 요청이 10초 제한을 넘겨 '대화를 못 받아 왔어요'가 됐다.
//! 시스템 잠자기는 그대로 둔다(AllowingIdleSystemSleep) — 맥이 자는 건 막지 않는다. 안 보일 때 폴링을 늦추는 건 화면 쪽이 따로 한다(ui/poll)
#[cfg(target_os = "macos")]
mod mac {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;

    /// NSActivityUserInitiatedAllowingIdleSystemSleep = (0x00FFFFFF | 1<<20) & !(1<<20)
    pub const OPTIONS: u64 = super::user_initiated_allowing_sleep();

    pub fn begin() -> bool {
        let Some(cls) = AnyClass::get(c"NSProcessInfo") else { return false };
        unsafe {
            let info: *mut AnyObject = msg_send![cls, processInfo];
            if info.is_null() {
                return false;
            }
            let reason = NSString::from_str("Chammo serves the phone and watches sessions while the window is hidden");
            let token: Option<Retained<AnyObject>> = msg_send![info, beginActivityWithOptions: OPTIONS, reason: &*reason];
            match token {
                // 앱이 끝날 때까지 쥔다 — 놓으면 다시 낮잠이 든다
                Some(t) => {
                    std::mem::forget(t);
                    true
                }
                None => false,
            }
        }
    }
}

/// NSActivityOptions 값 — 헤더의 정의 그대로(값이 바뀌면 낮잠이 안 꺼지거나 잠자기를 막는다)
pub const fn user_initiated_allowing_sleep() -> u64 {
    const IDLE_SYSTEM_SLEEP_DISABLED: u64 = 1 << 20;
    (0x00FF_FFFF | IDLE_SYSTEM_SLEEP_DISABLED) & !IDLE_SYSTEM_SLEEP_DISABLED
}

/// 앱이 뜰 때 한 번. 맥 밖은 낮잠이 없다
pub fn start() {
    #[cfg(target_os = "macos")]
    if !mac::begin() {
        crate::claude::log_out("no-nap", "beginActivity failed");
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn 시스템_잠자기는_막지_않는_값이다() {
        let v = super::user_initiated_allowing_sleep();
        assert_eq!(v, 0x00EF_FFFF);
        assert_eq!(v & (1 << 20), 0, "맥이 자는 건 그대로 둔다");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn 맥에서_활동을_시작할_수_있다() {
        assert!(super::mac::begin());
    }
}
