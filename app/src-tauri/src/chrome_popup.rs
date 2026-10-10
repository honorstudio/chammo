//! 크롬이 페이지 밖에 띄운 창 알아보기 — 패스키·Touch ID·폰 QR·USB 키 같은 크롬 자체 창(2026-10-06 고객사D project-h 슬랙 패스키).
//! 세션 크롬은 가짜 화면 위에 가려져 있고 앱 모달은 페이지 그림(CDP screencast)만 받아서, 크롬 자체 창은 사람 눈에 안 보였다 —
//! 실측: 가린 채면 패스키 창도 가려진 채 뜨고 크롬은 스스로 안 보인다, 페이지는 '기다리는 중'. 크롬 인자(mock-keychain 등)와는 무관(맨 크롬도 같은 창).
//! 맥 창 목록(CGWindowList — 화면 기록 권한 없이 pid·층·자리만 읽는다)에서 그 크롬의 창 중 브라우저 창 안쪽에 든 대화상자 크기 창을 찾는다.
//! 찾으면 모달이 '크롬에서 보기' 줄을 띄운다(agent_focus — 브라우저 창을 보이는 화면으로 꺼내면 대화상자도 따라온다, 실측)
use crate::vdisplay::Rect;

/// 맥 창 하나 — 주인 pid, 층(0 = 보통 창), 자리(크롬 창 좌표와 같은 전역 좌표)
#[derive(Clone, Copy, Debug)]
pub struct Win {
    pub pid: i32,
    pub layer: i64,
    pub rect: Rect,
}

/// 대화상자로 볼 최소 크기 — 번역 풍선(237x87)·주소창 목록(1038x138) 같은 건 빼고 패스키 창(448x387·486x321)은 잡는다
const MIN_W: f64 = 300.0;
const MIN_H: f64 = 200.0;
/// 같은 창·안쪽 판단 여유(px)
const SLACK: f64 = 2.0;

/// 그 크롬(pid)이 브라우저 창 말고 대화상자 크기 창을 브라우저 창 안쪽에 띄워 두었나. browsers = CDP 로 읽은 브라우저 창 자리들
pub fn popup_open(wins: &[Win], pid: i32, browsers: &[Rect]) -> bool {
    !popup_hosts(wins, pid, browsers).is_empty()
}

/// 대화상자를 품은 브라우저 창들 — 패스키 창이 뜨면 이 창만 작게 꺼낸다(agent_peek). 같은 자리 창이 둘이면 둘 다
pub fn popup_hosts(wins: &[Win], pid: i32, browsers: &[Rect]) -> Vec<Rect> {
    let dialogs: Vec<Rect> = wins
        .iter()
        .filter(|w| w.pid == pid && w.layer == 0 && w.rect.w >= MIN_W && w.rect.h >= MIN_H && !browsers.iter().any(|b| same(*b, w.rect)))
        .map(|w| w.rect)
        .collect();
    browsers.iter().filter(|b| dialogs.iter().any(|d| within(*d, **b) && !omnibox_list(*d, **b))).copied().collect()
}

/// 주소창 목록 창인가 — 브라우저 창 위 가장자리(탭·주소창 줄 안)에 붙고 폭이 브라우저의 70% 넘는 창. 치는 동안 1238x458 까지 펼쳐져
/// 대화상자 크기를 넘는다(2026-10-10 크롬 154, 프로젝트P 세션 '패스키 창' 오탐). 패스키·QR 창은 폭이 브라우저의 절반도 안 된다(448·486 / 1200)
fn omnibox_list(d: Rect, b: Rect) -> bool {
    d.y - b.y <= 60.0 && d.w >= b.w * 0.7
}

/// 같은 창 자리인가(여유 2px)
pub fn same_rect(a: Rect, b: Rect) -> bool {
    same(a, b)
}

/// 브라우저 창을 물어볼 만한가 — 큰 창 안에 또 다른 큰 창이 들어 있을 때만(대화상자는 브라우저 창 안쪽에 뜬다).
/// 평소엔 CDP 를 안 부른다 — 크롬은 브라우저 창 밖에 숨은 큰 창(500x500)을 늘 하나 두어 '큰 창 둘'로는 못 가른다(실측)
pub fn worth_asking(wins: &[Win]) -> bool {
    let big: Vec<Rect> = wins.iter().filter(|w| w.layer == 0 && w.rect.w >= MIN_W && w.rect.h >= MIN_H).map(|w| w.rect).collect();
    big.iter().any(|a| big.iter().any(|b| !same(*a, *b) && within(*a, *b)))
}

fn same(a: Rect, b: Rect) -> bool {
    (a.x - b.x).abs() <= SLACK && (a.y - b.y).abs() <= SLACK && (a.w - b.w).abs() <= SLACK && (a.h - b.h).abs() <= SLACK
}

fn within(inner: Rect, outer: Rect) -> bool {
    inner.x >= outer.x - SLACK && inner.y >= outer.y - SLACK && inner.x + inner.w <= outer.x + outer.w + SLACK && inner.y + inner.h <= outer.y + outer.h + SLACK
}

/// 그 pid 의 창들(가려진 창 포함). 맥이 아니거나 못 읽으면 빈 것
pub fn windows(pid: i32) -> Vec<Win> {
    cg::windows(pid)
}

#[cfg(target_os = "macos")]
mod cg {
    use super::{Rect, Win};
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Default)]
    struct CGRect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *const c_void;
        fn CGRectMakeWithDictionaryRepresentation(dict: *const c_void, rect: *mut CGRect) -> bool;
        static kCGWindowOwnerPID: *const c_void;
        static kCGWindowLayer: *const c_void;
        static kCGWindowBounds: *const c_void;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(a: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(a: *const c_void, i: isize) -> *const c_void;
        fn CFDictionaryGetValue(d: *const c_void, k: *const c_void) -> *const c_void;
        fn CFNumberGetValue(n: *const c_void, ty: isize, out: *mut c_void) -> u8;
        fn CFRelease(cf: *const c_void);
    }
    /// kCGWindowListOptionAll — 가려진(⌘H) 앱 창도 같이. 화면에 있는 것만 보면 가린 크롬의 패스키 창을 못 본다
    const ALL: u32 = 0;
    const SINT64: isize = 4; // kCFNumberSInt64Type

    unsafe fn int(d: *const c_void, k: *const c_void) -> Option<i64> {
        let n = CFDictionaryGetValue(d, k);
        let mut v: i64 = 0;
        (!n.is_null() && CFNumberGetValue(n, SINT64, &mut v as *mut i64 as *mut c_void) != 0).then_some(v)
    }

    pub fn windows(pid: i32) -> Vec<Win> {
        let mut out = vec![];
        unsafe {
            let list = CGWindowListCopyWindowInfo(ALL, 0);
            if list.is_null() {
                return out;
            }
            for i in 0..CFArrayGetCount(list) {
                let d = CFArrayGetValueAtIndex(list, i);
                if d.is_null() || int(d, kCGWindowOwnerPID) != Some(i64::from(pid)) {
                    continue;
                }
                let b = CFDictionaryGetValue(d, kCGWindowBounds);
                let mut r = CGRect::default();
                if b.is_null() || !CGRectMakeWithDictionaryRepresentation(b, &mut r) {
                    continue;
                }
                out.push(Win { pid, layer: int(d, kCGWindowLayer).unwrap_or(-1), rect: Rect { x: r.x, y: r.y, w: r.w, h: r.h } });
            }
            CFRelease(list);
        }
        out
    }
}
#[cfg(not(target_os = "macos"))]
mod cg {
    pub fn windows(_pid: i32) -> Vec<super::Win> {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const P: i32 = 45085;
    fn w(x: f64, y: f64, ww: f64, h: f64) -> Win {
        Win { pid: P, layer: 0, rect: Rect { x, y, w: ww, h } }
    }
    // 2026-10-06 실측 — 가짜 화면 위 세션 크롬(1200x800)과 그 크롬의 창들
    const MAIN: Rect = Rect { x: -2850.0, y: 1000.0, w: 1200.0, h: 800.0 };
    fn idle() -> Vec<Win> {
        vec![
            w(-2850.0, 1000.0, 1200.0, 800.0),   // 브라우저 창
            w(-2751.0, 1025.0, 1038.0, 139.0),   // 주소창 목록(가려진 채 늘 있음)
            w(-1972.0, 1080.0, 237.0, 87.0),     // 번역 풍선
            w(0.0, 580.0, 500.0, 500.0),         // 브라우저 창 밖 숨은 창
            w(-2910.0, 956.0, 1440.0, 30.0),     // 화면마다 메뉴 막대 자리
        ]
    }

    #[test]
    fn 평소엔_안_뜬다() {
        assert!(!popup_open(&idle(), P, &[MAIN]), "브라우저 창·작은 풍선·창 밖 숨은 창은 대화상자가 아니다");
    }

    #[test]
    fn 패스키_창은_잡는다() {
        let mut ws = idle();
        ws.push(w(-2474.0, 1083.0, 448.0, 387.0)); // 'webauthn.io에 저장된 패스키 사용'(폰 QR·USB 키) — 가려진 채 on=false 로 떴다
        assert!(popup_open(&ws, P, &[MAIN]));
        let mut ws = idle();
        ws.push(w(-2493.0, 1239.0, 486.0, 321.0)); // 패스키 저장(Touch ID·암호 앱) 시트
        assert!(popup_open(&ws, P, &[MAIN]));
    }

    #[test]
    fn 남의_창_다른_층_브라우저_창은_아니다() {
        let mut other = w(-2474.0, 1083.0, 448.0, 387.0);
        other.pid = 586;
        assert!(!popup_open(&[other], P, &[MAIN]), "다른 프로그램(사용자 크롬 등) 창");
        let mut menu = w(-2474.0, 1083.0, 448.0, 387.0);
        menu.layer = 101;
        assert!(!popup_open(&[menu], P, &[MAIN]), "메뉴·툴팁 층");
        let popup_win = Rect { x: -2700.0, y: 1100.0, w: 500.0, h: 600.0 };
        let ws = vec![w(-2850.0, 1000.0, 1200.0, 800.0), w(popup_win.x, popup_win.y, popup_win.w, popup_win.h + 1.0)];
        assert!(!popup_open(&ws, P, &[MAIN, popup_win]), "window.open 팝업(이것도 브라우저 창 — CDP 가 안다, 1px 차이는 같은 창)");
    }

    #[test]
    fn 대화상자를_품은_브라우저_창만_고른다() {
        // 패스키 창이 뜨면 그 창을 품은 브라우저 창만 작게 꺼낸다(2026-10-10 참모-2) — 로그인 팝업과 본 창이 같은 자리면 둘 다
        let mut ws = idle();
        ws.push(w(-2474.0, 1083.0, 448.0, 387.0));
        let other = Rect { x: 500.0, y: 500.0, w: 1200.0, h: 800.0 };
        assert_eq!(popup_hosts(&ws, P, &[MAIN, other]), vec![MAIN]);
        assert_eq!(popup_hosts(&ws, P, &[MAIN, MAIN]), vec![MAIN, MAIN], "같은 자리 창 둘이면 둘 다");
        assert!(popup_hosts(&idle(), P, &[MAIN]).is_empty());
        assert!(same_rect(MAIN, Rect { x: MAIN.x + 1.0, ..MAIN }), "1px 차이는 같은 창");
    }

    #[test]
    fn 주소창_목록이_길게_펼쳐져도_패스키가_아니다() {
        // 2026-10-10 실측(크롬 154, 프로젝트P 세션) — 주소창에 치면 목록 창이 1238x458 로 펼쳐져 '패스키 창이 떴어요' 카드가 잘못 떴다.
        // 브라우저 창(1400x880) 위 가장자리에 붙고 폭이 거의 같은 창 = 주소창 목록. 패스키 창은 폭이 브라우저의 절반도 안 된다
        let main = Rect { x: -1446.0, y: 48.0, w: 1400.0, h: 880.0 };
        let ws = vec![w(-1446.0, 48.0, 1400.0, 880.0), w(-1347.0, 73.0, 1238.0, 458.0), w(-1347.0, 73.0, 1238.0, 139.0), w(0.0, 580.0, 500.0, 500.0)];
        assert!(!popup_open(&ws, P, &[main]));
        let mut ws = ws;
        ws.push(w(-972.0, 200.0, 448.0, 387.0));
        assert!(popup_open(&ws, P, &[main]), "같이 떠 있어도 진짜 패스키 창은 잡는다");
    }

    #[test]
    fn 큰_창이_하나뿐이면_묻지도_않는다() {
        assert!(!worth_asking(&idle()), "평소(브라우저 창 하나)엔 CDP 를 안 부른다");
        let mut ws = idle();
        ws.push(w(-2474.0, 1083.0, 448.0, 387.0));
        assert!(worth_asking(&ws));
    }

    #[test]
    fn 브라우저_창을_모르면_안_뜬다() {
        let mut ws = idle();
        ws.push(w(-2474.0, 1083.0, 448.0, 387.0));
        assert!(!popup_open(&ws, P, &[]), "CDP 로 창 자리를 못 읽었으면 모른다고 본다(헛 알림보다 낫다)");
    }

    #[test]
    fn 창을_꺼내면_대화상자도_따라온다() {
        // '크롬에서 보기'로 맥북 화면으로 옮긴 뒤 — 같은 판단이 그대로 맞아야 꺼낸 뒤에도 줄 판단이 흔들리지 않는다
        let moved = Rect { x: -1440.0, y: 60.0, w: 1200.0, h: 800.0 };
        let ws = vec![w(-1440.0, 60.0, 1200.0, 800.0), w(-1064.0, 143.0, 448.0, 387.0)];
        assert!(popup_open(&ws, P, &[moved]));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn 이_맥의_창_목록을_읽는다() {
        // 우리 테스트 프로세스는 창이 없다 — 읽기가 죽지 않고 빈 것을 주는지만
        assert!(windows(std::process::id() as i32).is_empty());
        assert!(windows(-1).is_empty());
    }

    /// 떠 있는 크롬 하나를 읽어 본다(읽기만) — CHAMMO_TEST_CHROME_PID=<pid> cargo test chrome_popup -- --ignored --nocapture
    #[test]
    #[ignore]
    #[cfg(target_os = "macos")]
    fn 진짜_크롬_창을_읽는다() {
        let pid: i32 = std::env::var("CHAMMO_TEST_CHROME_PID").expect("CHAMMO_TEST_CHROME_PID").parse().unwrap();
        let ws = windows(pid);
        for w in &ws {
            println!("{} {} {:?}", w.pid, w.layer, w.rect);
        }
        assert!(ws.iter().any(|w| w.layer == 0 && w.rect.w >= 800.0), "브라우저 창이 하나는 보여야");
    }
}
