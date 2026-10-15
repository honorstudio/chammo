//! 크롬이 페이지 밖에 띄운 창 알아보기 — 패스키·Touch ID·폰 QR·USB 키 같은 크롬 자체 창(2026-10-06 고객사D project-h 슬랙 패스키).
//! 세션 크롬은 가짜 화면 위에 가려져 있고 앱 모달은 페이지 그림(CDP screencast)만 받아서, 크롬 자체 창은 사람 눈에 안 보였다 —
//! 실측: 가린 채면 패스키 창도 가려진 채 뜨고 크롬은 스스로 안 보인다, 페이지는 '기다리는 중'. 크롬 인자(mock-keychain 등)와는 무관(맨 크롬도 같은 창).
//! 맥 창 목록(CGWindowList — 화면 기록 권한 없이 pid·층·자리, 권한이 있으면 이름까지)에서 그 크롬의 창 중 브라우저 창 안쪽에 든 대화상자 크기 창을 찾는다.
//! 다 패스키는 아니다(2026-10-11 사용자 — 비밀번호 저장 풍선을 '패스키 창'으로 불렀다) — 패스키라고 확신할 때만 패스키, 주소창 풍선은 무시, 나머지는 '크롬 창'
//! 찾으면 모달이 '크롬에서 보기' 줄을 띄운다(agent_focus — 브라우저 창을 보이는 화면으로 꺼내면 대화상자도 따라온다, 실측)
use crate::vdisplay::Rect;

/// 맥 창 하나 — 주인 pid, 층(0 = 보통 창), 자리(크롬 창 좌표와 같은 전역 좌표)
#[derive(Clone, Debug)]
pub struct Win {
    pub pid: i32,
    /// 맥 창 번호(kCGWindowNumber) — 창이 살아 있는 동안 안 바뀐다
    pub num: u32,
    pub layer: i64,
    pub rect: Rect,
    /// 창 이름(kCGWindowName) — 화면 기록 권한이 있어야 읽힌다. None = 못 읽음
    pub name: Option<String>,
}

/// 사람을 부를 크롬 자체 창의 종류 — 패스키라고 확신할 때만 Passkey, 모르면 Window(중립 '크롬 창')
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Passkey,
    Window,
}

/// 그 크롬에 사람을 부를 창이 떴다면 그 종류 — 하나라도 패스키면 Passkey. 주소창 풍선(비밀번호 저장·다운로드)만 떠 있으면 None
pub fn popup_kind(wins: &[Win], pid: i32, browsers: &[Rect]) -> Option<Kind> {
    let ks: Vec<Kind> = found(wins, pid, browsers).into_iter().map(|f| f.1).collect();
    ks.iter().find(|k| **k == Kind::Passkey).or(ks.first()).copied()
}

/// 대화상자로 볼 최소 크기 — 번역 풍선(237x87)·주소창 목록(1038x138) 같은 건 빼고 패스키 창(448x387·486x321)은 잡는다
const MIN_W: f64 = 300.0;
const MIN_H: f64 = 200.0;
/// 같은 창·안쪽 판단 여유(px)
const SLACK: f64 = 2.0;

/// 그 크롬(pid)이 브라우저 창 말고 사람을 부를 창을 브라우저 창 안쪽에 띄워 두었나. browsers = CDP 로 읽은 브라우저 창 자리들
pub fn popup_open(wins: &[Win], pid: i32, browsers: &[Rect]) -> bool {
    !popup_hosts(wins, pid, browsers).is_empty()
}

/// 사람을 부를 창을 품은 브라우저 창들 — 그 창이 뜨면 이 창만 작게 꺼낸다(agent_peek). 같은 자리 창이 둘이면 둘 다
pub fn popup_hosts(wins: &[Win], pid: i32, browsers: &[Rect]) -> Vec<Rect> {
    found(wins, pid, browsers).into_iter().map(|f| f.0).collect()
}

/// 브라우저 창마다 그 안에 뜬 창의 종류(패스키가 하나라도 있으면 Passkey) — 주소창 목록·주소창 풍선은 뺀다
fn found(wins: &[Win], pid: i32, browsers: &[Rect]) -> Vec<(Rect, Kind)> {
    browsers
        .iter()
        .filter_map(|b| {
            let ks: Vec<Kind> = inside(wins, pid, *b, browsers).into_iter().map(|d| d.1).collect();
            let k = if ks.contains(&Kind::Passkey) { Kind::Passkey } else { *ks.first()? };
            Some((*b, k))
        })
        .collect()
}

/// 브라우저 창 하나(b) 안에 뜬 사람을 부를 창들과 그 종류 — 브라우저 창(window.open 팝업도)은 빼고
fn inside<'a>(wins: &'a [Win], pid: i32, b: Rect, browsers: &[Rect]) -> Vec<(&'a Win, Kind)> {
    wins.iter()
        .filter(|w| w.pid == pid && w.layer == 0 && w.rect.w >= MIN_W && w.rect.h >= MIN_H && !browsers.iter().any(|x| same(*x, w.rect)))
        .filter(|d| within(d.rect, b) && !omnibox_list(d.rect, b))
        .filter_map(|d| Some((d, kind_of(d, b)?)))
        .collect()
}

/// 사람을 부를 창들의 맥 창 번호 — 꺼낼 때 붙들어 둔다. 크롬 창을 다른 모니터로 옮기면 대화상자가 한 박자 늦게 따라와
/// 자리로는 잠깐 '없음'이 되어서(2026-10-11 실측), 꺼낸 동안은 이 번호의 창이 살아 있나로 본다
pub fn popup_nums(wins: &[Win], pid: i32, browsers: &[Rect]) -> Vec<u32> {
    let mut out: Vec<u32> = vec![];
    for b in browsers {
        for (d, _) in inside(wins, pid, *b, browsers) {
            // 0 = 번호를 못 읽음 — 붙들지 않는다(다른 창과 헷갈리지 않게)
            if d.num != 0 && !out.contains(&d.num) {
                out.push(d.num);
            }
        }
    }
    out
}

/// 그 번호의 창이 아직 떠 있나(보통 층) — 닫히면 목록에서 빠진다
pub fn still_open(wins: &[Win], nums: &[u32]) -> bool {
    wins.iter().any(|w| w.layer == 0 && nums.contains(&w.num))
}

/// 창 하나의 종류 — None = 사람을 안 불러도 되는 주소창 풍선(2026-10-11 실측, 크롬 베타 156).
/// 크기로는 못 가른다(비밀번호 저장 448x374 ≈ 패스키 448x387) — 이름(화면 기록 권한이 있을 때)과 자리로 가른다.
/// 크롬 대화상자(패스키·alert·기본 인증·외부 앱 열기)는 다 가로 가운데·위에서 83 이라 이름 없이는 패스키라고 못 한다 → Window
fn kind_of(d: &Win, b: Rect) -> Option<Kind> {
    if d.name.as_deref().is_some_and(passkey_name) {
        return Some(Kind::Passkey);
    }
    if omnibox_bubble(d.rect, b) {
        return None;
    }
    // 패스키 저장 맥 시트(Touch ID·암호 앱, 486x312) — 이름이 비어 있고 가로·세로 다 가운데. 크롬 대화상자는 위에서 83 에 붙는다
    if d.name.as_deref().is_none_or(str::is_empty) && sheet(d.rect, b) {
        return Some(Kind::Passkey);
    }
    Some(Kind::Window)
}

/// 패스키 창 이름인가 — 크롬 한글·영어 UI('패스키 및 보안 키'·'Use a saved passkey…')
fn passkey_name(n: &str) -> bool {
    let n = n.to_lowercase();
    ["패스키", "보안 키", "passkey", "security key"].iter().any(|k| n.contains(k))
}

/// 가로 가운데에서 얼마나 비켜났나(px, 오른쪽이 +)
fn off_center(d: Rect, b: Rect) -> f64 {
    (d.x + d.w / 2.0) - (b.x + b.w / 2.0)
}

/// 주소창 오른쪽 아이콘(열쇠·다운로드)에 붙은 풍선 — 위 가장자리(위에서 80)·오른쪽 끝(틈 78~85)에 붙고 가운데가 아니다.
/// 비밀번호·주소·카드 저장, 다운로드 기록 — 세션 일을 막지 않아 사람을 안 부른다(그냥 두면 된다).
/// 왼쪽(사이트 정보) 권한 풍선은 페이지가 답을 기다려서 사람 몫 — 여기 안 넣는다
fn omnibox_bubble(d: Rect, b: Rect) -> bool {
    let right_gap = (b.x + b.w) - (d.x + d.w);
    d.y - b.y <= 120.0 && (-SLACK..=200.0).contains(&right_gap) && off_center(d, b) >= 40.0
}

/// 맥 시트 자리 — 브라우저 창 가로·세로 가운데(위에 붙는 크롬 대화상자와 다르다)
fn sheet(d: Rect, b: Rect) -> bool {
    off_center(d, b).abs() <= 4.0 && ((d.y - b.y) - (b.h - d.h) / 2.0).abs() <= 12.0 && d.y - b.y > 120.0
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
/// 평소엔 CDP 를 안 부른다 — 크롬은 브라우저 창 밖에 숨은 큰 창(500x500)을 늘 하나 두어 '큰 창 둘'로는 못 가른다(실측).
/// 안쪽 창이 주소창 목록·주소창 풍선뿐이어도 안 묻는다 — 비밀번호 저장 풍선은 사람이 닫을 때까지 떠 있어 그동안 1초마다 CDP 에 붙었다(바깥 큰 창 = 브라우저 창, 자리가 CDP 와 같다)
pub fn worth_asking(wins: &[Win]) -> bool {
    let big: Vec<&Win> = wins.iter().filter(|w| w.layer == 0 && w.rect.w >= MIN_W && w.rect.h >= MIN_H).collect();
    big.iter().any(|a| big.iter().any(|b| !same(a.rect, b.rect) && within(a.rect, b.rect) && !omnibox_list(a.rect, b.rect) && kind_of(a, b.rect).is_some()))
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
        static kCGWindowName: *const c_void;
        static kCGWindowNumber: *const c_void;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(a: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(a: *const c_void, i: isize) -> *const c_void;
        fn CFDictionaryGetValue(d: *const c_void, k: *const c_void) -> *const c_void;
        fn CFNumberGetValue(n: *const c_void, ty: isize, out: *mut c_void) -> u8;
        fn CFRelease(cf: *const c_void);
        fn CFGetTypeID(cf: *const c_void) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFStringGetCString(s: *const c_void, buf: *mut u8, size: isize, encoding: u32) -> u8;
    }
    /// kCGWindowListOptionAll — 가려진(⌘H) 앱 창도 같이. 화면에 있는 것만 보면 가린 크롬의 패스키 창을 못 본다
    const ALL: u32 = 0;
    const SINT64: isize = 4; // kCFNumberSInt64Type
    const UTF8: u32 = 0x0800_0100; // kCFStringEncodingUTF8

    unsafe fn int(d: *const c_void, k: *const c_void) -> Option<i64> {
        let n = CFDictionaryGetValue(d, k);
        let mut v: i64 = 0;
        (!n.is_null() && CFNumberGetValue(n, SINT64, &mut v as *mut i64 as *mut c_void) != 0).then_some(v)
    }

    /// 창 이름 — 화면 기록 권한이 없으면 칸 자체가 없다(None). 이름은 판단에만 쓰고 기록에 안 남긴다(페이지 제목도 들어 있다)
    unsafe fn name(d: *const c_void) -> Option<String> {
        let s = CFDictionaryGetValue(d, kCGWindowName);
        if s.is_null() || CFGetTypeID(s) != CFStringGetTypeID() {
            return None;
        }
        let mut buf = [0u8; 1024];
        if CFStringGetCString(s, buf.as_mut_ptr(), buf.len() as isize, UTF8) == 0 {
            return Some(String::new());
        }
        let end = buf.iter().position(|b| *b == 0).unwrap_or(buf.len());
        Some(String::from_utf8_lossy(&buf[..end]).into_owned())
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
                let num = int(d, kCGWindowNumber).and_then(|n| u32::try_from(n).ok()).unwrap_or(0);
                out.push(Win { pid, num, layer: int(d, kCGWindowLayer).unwrap_or(-1), rect: Rect { x: r.x, y: r.y, w: r.w, h: r.h }, name: name(d) });
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
        Win { pid: P, num: 0, layer: 0, rect: Rect { x, y, w: ww, h }, name: None }
    }
    fn named(x: f64, y: f64, ww: f64, h: f64, name: &str) -> Win {
        Win { name: Some(name.into()), ..w(x, y, ww, h) }
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
        assert!(!popup_open(&[menu], P, &[MAIN]), "메뉴·툴팁 층(색 고르기 234x252 도 101)");
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

    // 2026-10-11 실측(.shots/popup-kind/table.md, 크롬 베타 156) — 시험 크롬 브라우저 창 1200x800 (-2850,1000)
    // 크기로는 못 가른다(비밀번호 저장 448x374 ≈ 패스키 448x387). 크롬 대화상자는 가로 가운데·위에서 83, 주소창 풍선은 위 가장자리 오른쪽·왼쪽에 붙는다

    #[test]
    fn 비밀번호_저장_풍선은_사람을_안_부른다() {
        // 사용자 2026-10-11 hello-notes 로그인 — '비밀번호를 저장하시겠습니까?' 풍선을 '패스키 창이 떴어요' 카드로 띄우고 개입으로 세션을 묶었다
        let main = Rect { x: -2886.0, y: 1004.0, w: 1400.0, h: 836.0 };
        let ws = vec![w(-2886.0, 1004.0, 1400.0, 836.0), w(-2787.0, 1029.0, 1238.0, 139.0), w(0.0, 580.0, 500.0, 500.0), named(-2019.0, 1084.0, 448.0, 374.0, "비밀번호를 저장하시겠습니까?")];
        assert!(!popup_open(&ws, P, &[main]));
        assert_eq!(popup_kind(&ws, P, &[main]), None);
        let mut blind = ws.clone();
        blind[3].name = None;
        assert!(!popup_open(&blind, P, &[main]), "이름을 못 읽어도(화면 기록 권한 없음) 자리로 — 주소창 열쇠 밑 오른쪽에 붙은 풍선");
        // 시험 크롬(1200 폭)에서도 같은 자리 — 오른쪽 틈 85·위에서 80
        let ws = vec![w(-2850.0, 1000.0, 1200.0, 800.0), w(-2183.0, 1080.0, 448.0, 374.0)];
        assert!(!popup_open(&ws, P, &[MAIN]));
        assert!(!worth_asking(&ws), "풍선은 사람이 닫을 때까지 떠 있다 — 그동안 1초마다 CDP 에 붙지 않는다");
        assert!(!worth_asking(&blind));
    }

    #[test]
    fn 패스키는_이름이나_맥_시트로만_패스키라고_한다() {
        let mut ws = idle();
        ws.push(named(-2474.0, 1083.0, 448.0, 545.0, "패스키 및 보안 키"));
        assert_eq!(popup_kind(&ws, P, &[MAIN]), Some(Kind::Passkey));
        let mut ws = idle();
        ws.push(named(-2474.0, 1083.0, 448.0, 387.0, "Use a saved passkey for localhost"));
        assert_eq!(popup_kind(&ws, P, &[MAIN]), Some(Kind::Passkey), "영어 크롬");
        // 패스키 저장 맥 시트 — 이름이 비어 있다. 가로·세로 다 가운데인 시트는 이것뿐
        for name in [None, Some("")] {
            let mut ws = idle();
            ws.push(Win { name: name.map(String::from), ..w(-2493.0, 1244.0, 486.0, 312.0) });
            assert_eq!(popup_kind(&ws, P, &[MAIN]), Some(Kind::Passkey), "{name:?}");
        }
        let mut ws = idle();
        ws.push(w(-2493.0, 1239.0, 486.0, 321.0));
        assert_eq!(popup_kind(&ws, P, &[MAIN]), Some(Kind::Passkey), "10-06 실측 시트");
    }

    #[test]
    fn 패스키라고_확신_못_하면_크롬_창() {
        // 가운데 대화상자인데 이름을 못 읽음 — 패스키·alert·기본 인증·외부 앱 열기가 다 같은 자리다
        let mut ws = idle();
        ws.push(w(-2474.0, 1083.0, 448.0, 387.0));
        assert_eq!(popup_kind(&ws, P, &[MAIN]), Some(Kind::Window));
        for (x, y, ww, h, name) in [
            (-2410.0, 1083.0, 320.0, 252.0, "로그인"),                                       // HTTP 기본 인증
            (-2506.0, 1083.0, 512.0, 202.0, "Zoom을(를) 여시겠습니까?"),                     // 외부 앱 열기
            (-2724.0, 1075.0, 320.0, 266.0, "http://localhost:50205에서 다음 권한을 요청합니다."), // 위치 권한(왼쪽 풍선)
            (-2724.0, 1075.0, 320.0, 504.0, "http://localhost:50205에서 다음 권한을 요청합니다."), // 카메라 권한
            (-2474.0, 1083.0, 448.0, 260.0, "localhost:50205 내용:"),                        // 긴 alert
        ] {
            let mut ws = idle();
            ws.push(named(x, y, ww, h, name));
            assert_eq!(popup_kind(&ws, P, &[MAIN]), Some(Kind::Window), "{name}");
        }
    }

    #[test]
    fn 풍선과_패스키가_같이_떠도_패스키() {
        let mut ws = idle();
        ws.push(named(-2183.0, 1080.0, 448.0, 374.0, "비밀번호를 저장하시겠습니까?"));
        ws.push(named(-2474.0, 1083.0, 448.0, 545.0, "패스키 및 보안 키"));
        assert_eq!(popup_kind(&ws, P, &[MAIN]), Some(Kind::Passkey));
        assert_eq!(popup_hosts(&ws, P, &[MAIN]), vec![MAIN]);
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
    fn 다른_화면으로_옮긴_뒤_엇나간_패스키_창도_살아_있으면_안다() {
        // 2026-10-11 실측(.shots/passkey-flash, 크롬 베타 156) — 가린 크롬 창을 다른 모니터로 옮기면 패스키 창은 한 박자 늦게 따라와
        // 엉뚱한 자리(-1918,1447)에 남는다. 자리로는 '창 없음'이라 꺼낸 크롬을 바로 다시 숨겼다(사용자 네이버 패스키 깜빡임)
        let peeked = Rect { x: 700.0, y: 220.0, w: 520.0, h: 640.0 };
        let mut dlg = named(-1918.0, 1447.0, 448.0, 545.0, "패스키 및 보안 키");
        dlg.num = 7001;
        let ws = vec![Win { num: 7000, ..w(700.0, 220.0, 520.0, 640.0) }, dlg, w(0.0, 580.0, 500.0, 500.0)];
        assert_eq!(popup_kind(&ws, P, &[peeked]), None, "자리로는 못 찾는다(그래서 번호로 붙든다)");
        assert!(still_open(&ws, &[7001]), "꺼낼 때 본 창 번호가 아직 있으면 떠 있는 것");
        assert!(!still_open(&ws, &[7002]), "닫힌 창");
        let mut menu = ws.clone();
        menu[1].layer = 101;
        assert!(!still_open(&menu, &[7001]), "보통 층 창만");
    }

    #[test]
    fn 꺼낼_때_본_창_번호를_준다() {
        let mut ws = idle();
        ws.push(Win { num: 42, ..named(-2183.0, 1080.0, 448.0, 374.0, "비밀번호를 저장하시겠습니까?") });
        ws.push(Win { num: 43, ..named(-2474.0, 1083.0, 448.0, 545.0, "패스키 및 보안 키") });
        assert_eq!(popup_nums(&ws, P, &[MAIN]), vec![43], "주소창 풍선은 빼고 사람을 부를 창만");
        assert!(popup_nums(&idle(), P, &[MAIN]).is_empty());
        let mut blind = idle();
        blind.push(named(-2474.0, 1083.0, 448.0, 545.0, "패스키 및 보안 키"));
        assert!(popup_nums(&blind, P, &[MAIN]).is_empty(), "번호를 못 읽은 창(0)은 안 붙든다");
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
            println!("{} {} {:?} {:?}", w.pid, w.layer, w.rect, w.name);
        }
        assert!(ws.iter().any(|w| w.layer == 0 && w.rect.w >= 800.0), "브라우저 창이 하나는 보여야");
    }
}
