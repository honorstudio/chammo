//! 칸에서 크롬 자체 풍선의 X 누르기(2026-11-09 사용자 번역 풍선) — 칸 그림(SCK)엔 브라우저 창에 붙은 풍선까지 비치는데 칸 누름은 CDP 로 페이지에만 가서
//! 'Google 번역 · 영어/한국어 · ⋮ · X' 같은 크롬 자체 풍선을 못 닫았다(누르면 밑의 페이지가 눌렸다).
//! 흔한 풍선(번역·저장 제안·다운로드)은 프로필 설정으로 아예 안 뜨게 하고(tools/chammo-browser/src/features.js), 이건 그 밖의 풍선을 위한 일반 길.
//! 실측(크롬 베타 158, 가짜 화면 위 Dock 숨김 크롬): 맥 마우스 이벤트를 크롬에 보내면(CGEventPostToPid, 창 번호를 넣어도) 안 먹고,
//! 맥 Esc 는 포커스를 받은 풍선(번역·다운로드)만 닫는다 — 카드·비밀번호 저장 풍선은 그대로. 접근성(AX)은 된다 — 누른 자리 요소가
//! '닫기' 단추면 AXPress 로 셋 다 닫혔다. 그래서 칸 누름이 풍선 위면 페이지로 안 보내고, 그 자리가 닫기 단추면 AX 로 누른다.
//! 닫기 말고 다른 단추(⋮ 메뉴·저장)는 누르지 않는다 — 맥 메뉴는 칸에 안 비치고 크롬이 메뉴를 쥔 채 멈춘다. 맥 손쉬운 사용 허용이 없으면 못 누른다(페이지로도 안 감)
use crate::agent_input::InputEv;
use crate::browser_pane::Geom;
use crate::chrome_popup::Win;
use crate::vdisplay::Rect;

/// 풍선으로 볼 최소 크기 — 링크 위에서 왼쪽 아래에 뜨는 주소 띠(147x22)·1x1 창은 뺀다. 번역 풍선 237x87·다운로드 320x88(11-09 실측)
const MIN_W: f64 = 60.0;
const MIN_H: f64 = 40.0;

/// 칸 비율(페이지 그림 안 0~1) → 전역 화면 점. 칸 그림 = 창에서 툴바 밑(browser.swift pageRect 와 같은 셈)
pub fn screen_point(g: &Geom, rx: f64, ry: f64) -> (f64, f64) {
    let top = g.top.clamp(0.0, (g.win[3] - 2.0).max(0.0));
    (g.win[0] + rx * g.win[2], g.win[1] + top + ry * (g.win[3] - top))
}

/// 그 점에 크롬 자체 풍선이 떠 있나 — 그 크롬의 화면에 그려진 보통 층 창 중 브라우저 창이 아니고 그 안에 든 것
pub fn bubble_at(wins: &[Win], pid: i32, browser: Rect, x: f64, y: f64) -> bool {
    wins.iter().any(|w| {
        let r = w.rect;
        w.pid == pid
            && w.layer == 0
            && w.onscreen
            && r.w >= MIN_W
            && r.h >= MIN_H
            && !crate::chrome_popup::same_rect(r, browser)
            && crate::chrome_popup::within(r, browser)
            && x >= r.x
            && x <= r.x + r.w
            && y >= r.y
            && y <= r.y + r.h
    })
}

/// 맥 메뉴 층(kCGPopUpMenuWindowLevel) — 펼침 목록(<select>)은 크롬이 맥 메뉴로 띄운다(200x82, 11-10 실측)
const MENU_LAYER: i64 = 101;

/// 칸 그림 위에 크롬 자체 창이 떠 있나 — 풍선(보통 층)·펼침 목록·메뉴(메뉴 층). 칸에서 못 다루는 것이라 칸이 '크롬에서 보기'를 띄운다.
/// 브라우저 창 안에 화면에 그려진 것만, 주소 띠(147x22) 같은 작은 건 뺀다
pub fn open_in(wins: &[Win], pid: i32, browser: Rect) -> bool {
    wins.iter().any(|w| {
        w.pid == pid
            && (w.layer == 0 || w.layer == MENU_LAYER)
            && w.onscreen
            && w.rect.w >= MIN_W
            && w.rect.h >= MIN_H
            && !crate::chrome_popup::same_rect(w.rect, browser)
            && crate::chrome_popup::within(w.rect, browser)
    })
}

/// 닫기 단추 이름인가 — 크롬 한글·영어 UI
pub fn close_name(n: &str) -> bool {
    let n = n.trim().to_lowercase();
    n == "닫기" || n == "close"
}

/// 칸 입력 하나를 어디로 — 페이지(CDP)·풍선(그 점을 AX 로)·버림(풍선 위에서 시작한 누름의 나머지)
#[derive(Debug, PartialEq)]
pub enum Route {
    Page,
    Bubble(f64, f64),
    Swallow,
}

/// held = 이 칸의 앞 누름이 풍선 위였다(뗄 때까지 그 누름의 이동·떼기는 페이지로 안 보낸다). hit = 그 점이 풍선 위인가
pub fn route(ev: &InputEv, g: &Geom, held: bool, hit: &mut dyn FnMut(f64, f64) -> bool) -> Route {
    let InputEv::Mouse { ty, x, y, .. } = ev else { return Route::Page };
    match ty.as_str() {
        "mousePressed" => {
            let (sx, sy) = screen_point(g, *x, *y);
            if hit(sx, sy) {
                Route::Bubble(sx, sy)
            } else {
                Route::Page
            }
        }
        "mouseMoved" | "mouseReleased" if held => Route::Swallow,
        _ => Route::Page,
    }
}

/// 풍선 위에서 시작한 누름이 있는 칸(프로필)
static HELD: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// 칸 입력 중 풍선 몫을 맡고 페이지로 보낼 것만 돌려준다. 창 목록은 누름이 있을 때만 읽는다(이동은 초당 60번이라)
/// pid = 크롬 프로세스(래퍼 아님), 0 = 모름(풍선을 안 찾는다 — 앞 누름의 떼기 삼키기만)
pub fn take(profile: &str, pid: i32, g: Option<Geom>, events: Vec<InputEv>) -> Vec<InputEv> {
    take_with(profile, pid, g, events, || crate::chrome_popup::windows(pid), |x, y| ax::press_close_at(pid, x, y))
}

/// take 의 몸통 — 창 목록 읽기·AX 누르기를 바꿔 끼울 수 있게(시험)
fn take_with(profile: &str, pid: i32, g: Option<Geom>, events: Vec<InputEv>, list: impl Fn() -> Vec<Win>, press_close: impl Fn(f64, f64) -> bool) -> Vec<InputEv> {
    let Some(g) = g.filter(|g| g.win[2] > 0.0 && g.win[3] > 0.0) else { return events };
    let browser = Rect { x: g.win[0], y: g.win[1], w: g.win[2], h: g.win[3] };
    let mut wins: Option<Vec<Win>> = None;
    let mut out = Vec::with_capacity(events.len());
    for ev in events {
        let held = HELD.lock().map(|h| h.iter().any(|p| p == profile)).unwrap_or(false);
        let mut hit = |x: f64, y: f64| pid > 0 && bubble_at(wins.get_or_insert_with(&list), pid, browser, x, y);
        let r = route(&ev, &g, held, &mut hit);
        // 누름·떼기는 칸에서 따로따로(스레드도 따로) 온다 — 표시는 AX 누르기 전에 세우고, 페이지 누름이 오면 지운다(남은 표시가 다음 떼기를 삼키지 않게)
        let press = matches!(&ev, InputEv::Mouse { ty, .. } if ty == "mousePressed");
        let release = matches!(&ev, InputEv::Mouse { ty, .. } if ty == "mouseReleased");
        if let Ok(mut h) = HELD.lock() {
            h.retain(|p| p != profile);
            if matches!(r, Route::Bubble(..)) || (held && !press && !release) {
                h.push(profile.to_string());
            }
        }
        match r {
            Route::Page => out.push(ev),
            Route::Bubble(x, y) => {
                // 왼쪽 누름만 닫기를 누른다 — 오른쪽·가운데 누름은 버리기만
                let left = matches!(&ev, InputEv::Mouse { button, .. } if button.as_deref().unwrap_or("left") == "left");
                let pressed = left && press_close(x, y);
                #[cfg(not(test))]
                crate::claude::log_out("browser", &format!("칸 누름이 크롬 자체 풍선 위 — {} ({profile})", if pressed { "닫기 단추를 눌렀어" } else { "닫기 단추가 아니라 버림" }));
                let _ = pressed;
            }
            Route::Swallow => {}
        }
    }
    out
}

/// 시험 — 그 칸에 풍선 누름 표시가 서 있나
#[cfg(test)]
fn held(profile: &str) -> bool {
    HELD.lock().map(|h| h.iter().any(|p| p == profile)).unwrap_or(false)
}

#[cfg(target_os = "macos")]
pub(crate) mod ax {
    use std::ffi::{c_void, CString};

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> *const c_void;
        fn AXUIElementCopyElementAtPosition(app: *const c_void, x: f32, y: f32, out: *mut *const c_void) -> i32;
        fn AXUIElementCopyAttributeValue(e: *const c_void, attr: *const c_void, out: *mut *const c_void) -> i32;
        fn AXUIElementPerformAction(e: *const c_void, action: *const c_void) -> i32;
        fn AXValueGetValue(v: *const c_void, ty: u32, out: *mut c_void) -> bool;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(alloc: *const c_void, s: *const std::ffi::c_char, enc: u32) -> *const c_void;
        fn CFRelease(cf: *const c_void);
        fn CFGetTypeID(cf: *const c_void) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFStringGetCString(s: *const c_void, buf: *mut u8, size: isize, enc: u32) -> u8;
        fn CFArrayGetCount(a: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(a: *const c_void, i: isize) -> *const c_void;
        fn CFRetain(cf: *const c_void) -> *const c_void;
    }
    const UTF8: u32 = 0x0800_0100;

    /// CF 글자 하나(다 쓰면 놓는다)
    struct Cf(*const c_void);
    impl Drop for Cf {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }
    fn cfstr(s: &str) -> Cf {
        let c = CString::new(s).unwrap_or_default();
        Cf(unsafe { CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), UTF8) })
    }
    /// 요소의 글자 속성 — 없거나 글자가 아니면 빈 것
    fn text(e: *const c_void, attr: &str) -> String {
        let a = cfstr(attr);
        let mut v: *const c_void = std::ptr::null();
        if unsafe { AXUIElementCopyAttributeValue(e, a.0, &mut v) } != 0 || v.is_null() {
            return String::new();
        }
        let v = Cf(v);
        if unsafe { CFGetTypeID(v.0) != CFStringGetTypeID() } {
            return String::new();
        }
        let mut buf = [0u8; 512];
        if unsafe { CFStringGetCString(v.0, buf.as_mut_ptr(), buf.len() as isize, UTF8) } == 0 {
            return String::new();
        }
        let end = buf.iter().position(|b| *b == 0).unwrap_or(buf.len());
        String::from_utf8_lossy(&buf[..end]).into_owned()
    }

    /// 시험 — 그 점 요소부터 위로 역할·이름(못 누를 때 무엇이 잡혔나 보려고)
    #[cfg(test)]
    pub fn describe_at(pid: i32, x: f64, y: f64) -> Vec<String> {
        let app = Cf(unsafe { AXUIElementCreateApplication(pid) });
        let mut el: *const c_void = std::ptr::null();
        let r = unsafe { AXUIElementCopyElementAtPosition(app.0, x as f32, y as f32, &mut el) };
        if r != 0 || el.is_null() {
            return vec![format!("at 실패 {r}")];
        }
        let mut out = vec![];
        let mut cur = Cf(el);
        for _ in 0..8 {
            out.push(format!("{}|{}|{}", text(cur.0, "AXRole"), text(cur.0, "AXDescription"), text(cur.0, "AXTitle")));
            let p = cfstr("AXParent");
            let mut parent: *const c_void = std::ptr::null();
            if unsafe { AXUIElementCopyAttributeValue(cur.0, p.0, &mut parent) } != 0 || parent.is_null() {
                break;
            }
            cur = Cf(parent);
        }
        out
    }

    /// 요소의 자리(전역 점) — 못 읽으면 None
    fn frame(e: *const c_void) -> Option<(f64, f64, f64, f64)> {
        #[repr(C)]
        #[derive(Default)]
        struct Pt {
            x: f64,
            y: f64,
        }
        let (pa, sa) = (cfstr("AXPosition"), cfstr("AXSize"));
        let (mut pv, mut sv): (*const c_void, *const c_void) = (std::ptr::null(), std::ptr::null());
        if unsafe { AXUIElementCopyAttributeValue(e, pa.0, &mut pv) } != 0 || pv.is_null() {
            return None;
        }
        let pv = Cf(pv);
        if unsafe { AXUIElementCopyAttributeValue(e, sa.0, &mut sv) } != 0 || sv.is_null() {
            return None;
        }
        let sv = Cf(sv);
        let (mut p, mut z) = (Pt::default(), Pt::default());
        // kAXValueCGPointType 1 · kAXValueCGSizeType 2
        let ok = unsafe { AXValueGetValue(pv.0, 1, &mut p as *mut Pt as *mut c_void) && AXValueGetValue(sv.0, 2, &mut z as *mut Pt as *mut c_void) };
        ok.then_some((p.x, p.y, z.x, z.y))
    }

    /// 자식들(가진 것만) — 다 쓰면 놓는다
    fn children(e: *const c_void) -> Vec<Cf> {
        let a = cfstr("AXChildren");
        let mut v: *const c_void = std::ptr::null();
        if unsafe { AXUIElementCopyAttributeValue(e, a.0, &mut v) } != 0 || v.is_null() {
            return vec![];
        }
        let arr = Cf(v);
        let n = unsafe { CFArrayGetCount(arr.0) };
        (0..n).map(|i| unsafe { CFArrayGetValueAtIndex(arr.0, i) }).filter(|c| !c.is_null()).map(|c| Cf(unsafe { CFRetain(c) })).collect()
    }

    fn is_close(e: *const c_void) -> bool {
        text(e, "AXRole") == "AXButton" && (super::close_name(&text(e, "AXDescription")) || super::close_name(&text(e, "AXTitle")))
    }

    fn press(e: *const c_void) -> bool {
        let act = cfstr("AXPress");
        unsafe { AXUIElementPerformAction(e, act.0) == 0 }
    }

    fn contains(f: (f64, f64, f64, f64), x: f64, y: f64) -> bool {
        x >= f.0 && x <= f.0 + f.2 && y >= f.1 && y <= f.1 + f.3
    }

    /// 그 점을 품은 닫기 단추를 아래로 찾아 누른다(깊이 12까지)
    fn press_in(e: *const c_void, x: f64, y: f64, depth: u32) -> bool {
        if depth > 12 {
            return false;
        }
        if is_close(e) {
            return frame(e).is_some_and(|f| contains(f, x, y)) && press(e);
        }
        children(e).iter().any(|c| press_in(c.0, x, y, depth + 1))
    }

    /// 그 점(전역 화면 점)이 닫기 단추면 누르고 true. 손쉬운 사용 허용이 없으면 false.
    /// 먼저 그 점 요소(AXUIElementCopyElementAtPosition)부터 위로 — 크롬은 접근성 트리를 처음 물을 때 만들어서 그때는 앱(AXApplication)만 돌려준다(11-10 E2E 실측).
    /// 그러면 창 목록(AXWindows — 물으면 트리가 생긴다)에서 그 점을 품은 창의 닫기 단추를 훑는다
    pub fn press_close_at(pid: i32, x: f64, y: f64) -> bool {
        let app = Cf(unsafe { AXUIElementCreateApplication(pid) });
        if app.0.is_null() {
            return false;
        }
        let mut el: *const c_void = std::ptr::null();
        if unsafe { AXUIElementCopyElementAtPosition(app.0, x as f32, y as f32, &mut el) } == 0 && !el.is_null() {
            let mut cur = Cf(el);
            for _ in 0..4 {
                let role = text(cur.0, "AXRole");
                if role == "AXWindow" || role == "AXApplication" {
                    break;
                }
                if is_close(cur.0) {
                    return press(cur.0);
                }
                let p = cfstr("AXParent");
                let mut parent: *const c_void = std::ptr::null();
                if unsafe { AXUIElementCopyAttributeValue(cur.0, p.0, &mut parent) } != 0 || parent.is_null() {
                    break;
                }
                cur = Cf(parent);
            }
        }
        let a = cfstr("AXWindows");
        let mut v: *const c_void = std::ptr::null();
        if unsafe { AXUIElementCopyAttributeValue(app.0, a.0, &mut v) } != 0 || v.is_null() {
            return false;
        }
        let arr = Cf(v);
        let n = unsafe { CFArrayGetCount(arr.0) };
        // 그 점을 품은 창 중 작은 것부터(브라우저 창보다 풍선이 먼저)
        let mut wins: Vec<(f64, *const c_void)> = (0..n)
            .map(|i| unsafe { CFArrayGetValueAtIndex(arr.0, i) })
            .filter_map(|w| frame(w).filter(|f| contains(*f, x, y)).map(|f| (f.2 * f.3, w)))
            .collect();
        wins.sort_by(|a, b| a.0.total_cmp(&b.0));
        wins.iter().any(|(_, w)| press_in(*w, x, y, 0))
    }
}
#[cfg(not(target_os = "macos"))]
mod ax {
    pub fn press_close_at(_pid: i32, _x: f64, _y: f64) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const P: i32 = 729;
    // 11-09 실측 — 가짜 화면 위 시험 크롬 1400x880 (-3366,986), 툴바 87
    fn geom() -> Geom {
        Geom { id: 1, win: [-3366.0, 986.0, 1400.0, 880.0], top: 87.0, inner: [1400.0, 793.0] }
    }
    const MAIN: Rect = Rect { x: -3366.0, y: 986.0, w: 1400.0, h: 880.0 };
    fn w(x: f64, y: f64, ww: f64, h: f64, on: bool) -> Win {
        Win { pid: P, num: 1, layer: 0, rect: Rect { x, y, w: ww, h }, name: None, onscreen: on }
    }
    fn wins() -> Vec<Win> {
        vec![
            w(-3366.0, 986.0, 1400.0, 880.0, true), // 브라우저 창
            w(-2288.0, 1066.0, 237.0, 87.0, true),  // 번역 풍선 — 닫기 단추 (-2095,1073) 28x32
            w(-3367.0, 1845.0, 147.0, 22.0, true),  // 링크 주소 띠
            w(0.0, 580.0, 500.0, 500.0, false),     // 창 밖 숨은 창
            w(0.0, 0.0, 1.0, 1.0, false),
        ]
    }
    fn mouse(ty: &str, x: f64, y: f64) -> InputEv {
        InputEv::Mouse { ty: ty.into(), x, y, button: Some("left".into()), click_count: Some(1), delta_x: None, delta_y: None, modifiers: 0 }
    }
    /// 화면 점 → 칸 비율(screen_point 의 거꾸로)
    fn ratio(x: f64, y: f64) -> (f64, f64) {
        let g = geom();
        ((x - g.win[0]) / g.win[2], (y - g.win[1] - g.top) / (g.win[3] - g.top))
    }

    #[test]
    fn 칸_비율을_화면_점으로() {
        let g = geom();
        assert_eq!(screen_point(&g, 0.0, 0.0), (-3366.0, 1073.0), "칸 왼쪽 위 = 툴바 밑");
        assert_eq!(screen_point(&g, 1.0, 1.0), (-1966.0, 1866.0));
        let (rx, ry) = ratio(-2081.0, 1089.0);
        let (x, y) = screen_point(&g, rx, ry);
        assert!((x + 2081.0).abs() < 1e-6 && (y - 1089.0).abs() < 1e-6);
        let odd = Geom { top: 5000.0, ..g };
        assert_eq!(screen_point(&odd, 0.0, 0.0).1, 986.0 + 878.0, "툴바 높이가 엉터리면 창 안으로 자른다(Swift 와 같이)");
    }

    #[test]
    fn 풍선_위만_풍선이다() {
        let ws = wins();
        assert!(bubble_at(&ws, P, MAIN, -2081.0, 1089.0), "번역 풍선 X");
        assert!(bubble_at(&ws, P, MAIN, -2250.0, 1140.0), "풍선 바탕도 풍선(밑 페이지로 안 보낸다)");
        assert!(!bubble_at(&ws, P, MAIN, -2600.0, 1400.0), "페이지");
        assert!(!bubble_at(&ws, P, MAIN, -3300.0, 1855.0), "링크 주소 띠(147x22)는 풍선이 아니다 — 그 자리 페이지는 눌린다");
        assert!(!bubble_at(&ws, P + 1, MAIN, -2081.0, 1089.0), "다른 크롬");
        let mut hidden = wins();
        hidden[1].onscreen = false;
        assert!(!bubble_at(&hidden, P, MAIN, -2081.0, 1089.0), "닫혀 화면에서 빠진 풍선(크롬은 창을 목록에 남긴다)");
        let mut menu = wins();
        menu[1].layer = 101;
        assert!(!bubble_at(&menu, P, MAIN, -2081.0, 1089.0), "메뉴·툴팁 층");
        let out = vec![w(-3366.0, 986.0, 1400.0, 880.0, true), w(-1900.0, 1066.0, 237.0, 87.0, true)];
        assert!(!bubble_at(&out, P, MAIN, -1800.0, 1089.0), "브라우저 창 밖 창");
    }

    #[test]
    fn 풍선_누름은_페이지로_안_보내고_뗄_때까지_삼킨다() {
        let g = geom();
        let (bx, by) = ratio(-2081.0, 1089.0);
        let mut on = |x: f64, y: f64| bubble_at(&wins(), P, MAIN, x, y);
        match route(&mouse("mousePressed", bx, by), &g, false, &mut on) {
            Route::Bubble(x, y) => assert!((x + 2081.0).abs() < 1e-6 && (y - 1089.0).abs() < 1e-6),
            r => panic!("{r:?}"),
        }
        assert_eq!(route(&mouse("mouseMoved", 0.5, 0.5), &g, true, &mut on), Route::Swallow, "누른 채 끌기");
        assert_eq!(route(&mouse("mouseReleased", 0.5, 0.5), &g, true, &mut on), Route::Swallow, "떼기 — 밖에서 떼도");
        assert_eq!(route(&mouse("mouseReleased", 0.5, 0.5), &g, false, &mut on), Route::Page);
        assert_eq!(route(&mouse("mousePressed", 0.5, 0.5), &g, false, &mut on), Route::Page, "페이지 누름은 그대로");
        assert_eq!(route(&mouse("mouseMoved", bx, by), &g, false, &mut on), Route::Page, "풍선 위 지나가기는 그대로(창 목록을 안 읽는다)");
        let key = InputEv::Key { ty: "keyDown".into(), key: "Escape".into(), code: "Escape".into(), key_code: 27, text: None, modifiers: 0, commands: vec![] };
        assert_eq!(route(&key, &g, true, &mut on), Route::Page, "키는 페이지로");
    }

    #[test]
    fn 이동만_오면_창_목록을_안_읽는다() {
        let g = geom();
        let mut asked = 0;
        let mut count = |_: f64, _: f64| {
            asked += 1;
            false
        };
        for ty in ["mouseMoved", "mouseReleased", "mouseWheel"] {
            assert_eq!(route(&mouse(ty, 0.3, 0.3), &g, false, &mut count), Route::Page);
        }
        assert_eq!(asked, 0);
    }

    #[test]
    fn 풍선_누름과_떼기가_따로_와도_떼기만_삼키고_남은_표시는_다음_페이지_누름이_지운다() {
        let g = Some(geom());
        let (bx, by) = ratio(-2081.0, 1089.0);
        let pressed = std::cell::Cell::new(vec![]);
        let push = |x: f64, y: f64| {
            let mut v = pressed.take();
            v.push((x, y));
            pressed.set(v);
            true
        };
        let p = "nb-held";
        // 칸은 누름·떼기를 따로 보낸다
        assert!(take_with(p, P, g, vec![mouse("mouseMoved", bx, by), mouse("mousePressed", bx, by)], wins, push).len() == 1, "지나가기만 페이지로");
        assert_eq!(pressed.take().len(), 1, "닫기를 한 번 눌렀다");
        assert!(held(p));
        assert!(take_with(p, P, g, vec![mouse("mouseMoved", 0.5, 0.5)], wins, push).is_empty(), "누른 채 끌기는 버림");
        assert!(take_with(p, P, g, vec![mouse("mouseReleased", 0.5, 0.5)], wins, push).is_empty(), "떼기도 버림");
        assert!(!held(p));
        let page = vec![mouse("mousePressed", 0.5, 0.5), mouse("mouseReleased", 0.5, 0.5)];
        assert_eq!(take_with(p, P, g, page.clone(), wins, push), page, "다음 페이지 누름은 그대로");
        // 떼기가 누름보다 먼저 닿아 표시가 남은 경우 — 다음 페이지 누름이 지워 그 떼기를 안 삼킨다
        assert_eq!(take_with(p, P, g, vec![mouse("mouseReleased", bx, by)], wins, push).len(), 1);
        assert!(take_with(p, P, g, vec![mouse("mousePressed", bx, by)], wins, push).is_empty());
        assert!(held(p));
        assert_eq!(take_with(p, P, g, page.clone(), wins, push), page);
        assert!(!held(p));
        // 오른쪽 누름은 닫기를 안 누르고 버리기만
        let mut right = mouse("mousePressed", bx, by);
        if let InputEv::Mouse { button, .. } = &mut right {
            *button = Some("right".into());
        }
        let _ = pressed.take();
        assert!(take_with(p, P, g, vec![right], wins, push).is_empty());
        assert!(pressed.take().is_empty());
        let _ = take_with(p, P, g, vec![mouse("mouseReleased", bx, by)], wins, push);
        // 다른 칸(프로필)의 표시와 섞이지 않는다
        let _ = take_with(p, P, g, vec![mouse("mousePressed", bx, by)], wins, push);
        assert_eq!(take_with("nb-other", P, g, vec![mouse("mouseReleased", 0.5, 0.5)], wins, push).len(), 1);
        let _ = take_with(p, P, g, vec![mouse("mouseReleased", bx, by)], wins, push);
    }

    #[test]
    fn 크롬_pid_를_모르면_풍선을_안_찾는다() {
        let (bx, by) = ratio(-2081.0, 1089.0);
        let evs = vec![mouse("mousePressed", bx, by)];
        assert_eq!(take_with("nb-nopid", 0, Some(geom()), evs.clone(), wins, |_, _| true), evs);
    }

    #[test]
    fn 칸_모양을_모르면_그대로() {
        let evs = vec![mouse("mousePressed", 0.5, 0.01)];
        assert_eq!(take("nb-test", P, None, evs.clone()), evs);
        assert_eq!(take("nb-test", P, Some(Geom::default()), evs.clone()), evs, "창 크기 0");
    }

    #[test]
    fn 칸_위에_뜬_크롬_자체_창() {
        assert!(open_in(&wins(), P, MAIN), "번역 풍선");
        let mut quiet = wins();
        quiet.remove(1);
        assert!(!open_in(&quiet, P, MAIN), "브라우저 창·주소 띠·숨은 창뿐");
        let mut select = quiet.clone();
        select.push(Win { layer: 101, ..w(-3358.0, 1088.0, 200.0, 82.0, true) });
        assert!(open_in(&select, P, MAIN), "펼침 목록(맥 메뉴 층) — 11-10 실측");
        let mut other = quiet.clone();
        other.push(Win { layer: 3, ..w(-3358.0, 1088.0, 200.0, 82.0, true) });
        assert!(!open_in(&other, P, MAIN), "다른 층");
        let mut gone = wins();
        gone[1].onscreen = false;
        assert!(!open_in(&gone, P, MAIN), "닫혀 화면에서 빠진 풍선");
        assert!(!open_in(&wins(), P + 1, MAIN), "다른 크롬");
    }

    #[test]
    fn 닫기_단추_이름() {
        for n in ["닫기", "Close", " close "] {
            assert!(close_name(n), "{n}");
        }
        for n in ["번역 옵션", "저장", "", "닫기 탭"] {
            assert!(!close_name(n), "{n}");
        }
    }
}
