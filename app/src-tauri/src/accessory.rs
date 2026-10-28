//! 세션 크롬을 Dock·⌘Tab 에서 빼는 dylib(2026-10-27 인앱 브라우저 A) — tools/chammo-browser/native/accessory.m 을 build.rs 가 clang 으로 빌드해 실행 파일에 넣고,
//! 앱이 켜질 때 데이터 폴더 tools/chammo-accessory.dylib 로 푼다. 참모 브라우저 래퍼(src/appcopy.js)가 그 파일이 있으면 Chammo Browser 사본을 ad-hoc 재서명하고
//! 띄울 때 DYLD_INSERT_LIBRARIES 로 넣는다 — 없으면 사본은 구글 서명 그대로(Dock 에 보이지만 맥 '암호' 패스키가 된다).
//! '크롬에서 보기' 동안은 다윈 알림 chammo.<pid>.regular 로 보통 앱으로(Dock 아이콘·⌘Tab), 숨기면 .accessory 로 돌린다
#[cfg(target_os = "macos")]
pub const DYLIB: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/chammo-accessory.dylib"));
#[cfg(not(target_os = "macos"))]
pub const DYLIB: &[u8] = &[];

pub const FILE: &str = "chammo-accessory.dylib";

/// 데이터 폴더 tools/ 에 푼다(바뀌었을 때만) — 빌드에 없으면(clang 실패·윈도우) 옛 파일도 지워 래퍼가 재서명하지 않게
pub fn install() {
    let f = crate::config::data_file("tools").join(FILE);
    if DYLIB.is_empty() {
        let _ = std::fs::remove_file(&f);
        return;
    }
    if let Err(e) = crate::vdisplay::install_exe(&f, DYLIB) {
        #[cfg(not(test))]
        crate::claude::log_out("browser", &format!("Dock 숨기기 dylib 를 못 풀었어: {e}"));
        #[cfg(test)]
        let _ = e;
    }
}

/// 다윈 알림 이름 — dylib 가 브라우저 프로세스 pid 로 듣는다
pub fn note_name(pid: i32, regular: bool) -> String {
    format!("chammo.{pid}.{}", if regular { "regular" } else { "accessory" })
}

/// 그 크롬을 보통 앱(Dock·⌘Tab 보임)으로 또는 accessory 로 — dylib 가 없는 크롬은 아무도 안 들어 그냥 지나간다
pub fn set_regular(pid: i32, regular: bool) {
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn notify_post(name: *const std::ffi::c_char) -> u32;
        }
        if let Ok(n) = std::ffi::CString::new(note_name(pid, regular)) {
            unsafe { notify_post(n.as_ptr()) };
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (pid, regular);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 알림_이름은_dylib_와_같은_모양() {
        // native/accessory.m 의 snprintf "chammo.%d.regular" / "chammo.%d.accessory"
        assert_eq!(note_name(4321, true), "chammo.4321.regular");
        assert_eq!(note_name(4321, false), "chammo.4321.accessory");
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../tools/chammo-browser/native/accessory.m")).unwrap();
        assert!(src.contains("\"chammo.%d.regular\"") && src.contains("\"chammo.%d.accessory\""));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn dylib_는_옛_macOS_에서도_실리는_dylib() {
        assert!(!DYLIB.is_empty(), "맥 빌드엔 dylib 가 들어 있어야 — clang 이 실패했나");
        let ft = u32::from_le_bytes(DYLIB[12..16].try_into().unwrap());
        assert_eq!(ft, 6, "MH_DYLIB 여야");
        let (minos, _) = crate::vdisplay::tests::macho(DYLIB);
        assert!(minos <= 11 << 16, "최소 macOS 가 {}.{} — 앱(11.0)보다 높으면 옛 맥 크롬에 못 싣는다", minos >> 16, (minos >> 8) & 0xff);
    }
}
