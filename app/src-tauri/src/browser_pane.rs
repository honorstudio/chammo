//! 세션 브라우저 스페이스 칸(2026-10-27 인앱 브라우저 A) — 가짜 화면 위 세션 크롬 창을 SCK 로 칸에 그대로 비춘다(tools/craft-mirror/browser.swift).
//! - 칸 크기 = 크롬 페이지 크기: 일꾼(agent_browser run)이 지금 탭 창 자리·툴바 높이를 재고, 세션 도구가 안 돌 때만 창 크기를 칸에 맞춘다(spike A2 — 좌표 도구가 빗나감)
//! - 그림은 screencast 가 아니라 SCK — 이 칸만 보는 동안 일꾼은 탭·대화상자만 맡고 화면은 안 받는다(agent_frame 을 안 부른다)
//! - 칸을 숨기면(탭 X·다른 탭) 받기만 멈춘다. 크롬·세션은 그대로(끄는 건 참모·세션)
use serde::Serialize;

/// 칸이 원하는 페이지 크기(CSS 점)와 그 크기를 처음 알린 때 — 끌어서 바꾸는 동안은 기다렸다 한 번
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Want {
    pub w: f64,
    pub h: f64,
    pub at: std::time::Instant,
}

/// 지금 탭 창의 모양 — 창 자리(전역 점, 왼쪽 위 원점 = CG 좌표), 툴바 높이, 페이지 크기, 창 번호(CDP windowId)
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Default)]
pub struct Geom {
    pub id: i64,
    pub win: [f64; 4],
    pub top: f64,
    pub inner: [f64; 2],
}

impl Geom {
    /// 페이지 밖 테두리(좌우 합, 툴바) — 창 크기 = 페이지 + 이것
    pub fn extra(&self) -> (f64, f64) {
        ((self.win[2] - self.inner[0]).max(0.0), self.top.max(0.0))
    }
}

/// 크기를 바꾼 뒤 이만큼 손 뗀 채여야 바꾼다 — 끄는 동안 매번 바꾸면 크롬이 다시 그리느라 칸이 깜빡인다
pub const SETTLE: std::time::Duration = std::time::Duration::from_millis(300);

/// 창 크기를 칸에 맞출 때인가 — 2점 넘게 다르고, 손을 뗐고, 세션 도구가 안 돌고, 사람이 '크롬에서 보기'로 꺼내지 않았을 때
pub fn resize_due(want: Want, g: &Geom, busy: bool, shown: bool, now: std::time::Instant) -> bool {
    let off = (want.w - g.inner[0]).abs() > 2.0 || (want.h - g.inner[1]).abs() > 2.0;
    off && !busy && !shown && now.saturating_duration_since(want.at) >= SETTLE && want.w >= 200.0 && want.h >= 150.0
}

/// 새 창 자리 — 가짜 화면 왼쪽 위에 붙여 페이지가 칸 크기가 되게, 가짜 화면보다 크게는 안(넘치면 칸이 비율대로 줄여 보인다)
pub fn fit_bounds(want: Want, g: &Geom, vd: crate::vdisplay::Rect) -> [f64; 4] {
    let (dw, top) = g.extra();
    [vd.x, vd.y, (want.w + dw).min(vd.w).round(), (want.h + top).min(vd.h).round()]
}

/// 칸 상태 글 — 웹이 안내를 고른다(craft_window mirror_word 와 같은 말 + 브라우저 없음)
pub fn status_word(n: Option<i32>) -> &'static str {
    match n {
        None => "no-browser",
        Some(0) => "waiting",
        Some(1) => "live",
        Some(2) => "no-permission",
        Some(3) => "no-window",
        Some(_) => "stopped",
    }
}

/// 칸 입력 한 묶음을 어떻게 — 개입 중이면 보낸다(Go), 아니면 누름·휠·키·글·이동이 섞였을 때만 개입을 저절로 켜고 보낸다(Start).
/// 그냥 지나가는 마우스(이동만)는 버린다(Drop) — 칸 위로 마우스만 지나가도 세션 도구가 멈추면 안 된다(시안 A '사람은 평소에도 바로 만짐')
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Step {
    Go,
    Start,
    Drop,
}

pub fn pane_step(allowed: bool, events: &[crate::agent_input::InputEv]) -> Step {
    if allowed {
        return Step::Go;
    }
    if hands_on(events) { Step::Start } else { Step::Drop }
}

/// 사람이 칸에 손을 댔나 — 누름·키·글·휠(마우스만 지나간 건 아니다). 칸이 켠 개입의 돌려주기 시계(takeover::acted)
pub fn hands_on(events: &[crate::agent_input::InputEv]) -> bool {
    use crate::agent_input::InputEv;
    crate::agent_input::acts(events) || events.iter().any(|e| matches!(e, InputEv::Mouse { ty, .. } if ty == "mouseWheel"))
}

/// 헤드리스 크롬인가(Browser.getVersion) — 옛 헤드리스는 제품 이름이 "HeadlessChrome/…", 새 헤드리스(--headless=new, 157 실측)는 제품은 "Chrome/…"이고
/// 기본 UA 에만 "HeadlessChrome" 이 남는다(플레이라이트가 바꾸는 건 페이지 UA 라 이건 그대로)
pub fn is_headless(product: &str, user_agent: &str) -> bool {
    product.starts_with("HeadlessChrome/") || user_agent.contains(" HeadlessChrome/")
}

/// 페이지의 진짜 누름(pointerdown isTrusted)이 참모 것인가 — 사람이 칸에서 막 입력했으면(앱이 보낸 것) 사람 것
pub const HUMAN_ECHO: std::time::Duration = std::time::Duration::from_millis(400);
pub fn agent_press(human_at: Option<std::time::Instant>, now: std::time::Instant) -> bool {
    human_at.is_none_or(|t| now.saturating_duration_since(t) > HUMAN_ECHO)
}

/// 참모 커서 자리 — 페이지 좌표(CSS)를 페이지 크기 비율로(비추기 층이 칸 크기에 맞춰 그린다). 모르면 None
pub fn cursor_ratio(x: f64, y: f64, page: crate::agent_input::Meta) -> Option<(f64, f64)> {
    (page.w > 0.0 && page.h > 0.0 && x.is_finite() && y.is_finite()).then(|| ((x / page.w).clamp(0.0, 1.0), (y / page.h).clamp(0.0, 1.0)))
}

/// 그림이 놓일 자리 — 칸(box) 안에 비율 유지 가운데, 2점 안쪽 차이면 칸 전체(Swift BrowserMirror.fit·fills 와 같은 규칙). 윈도우 그림 칸이 쓴다
#[cfg_attr(not(windows), allow(dead_code))]
pub fn fit(page: (f64, f64), b: (f64, f64)) -> [f64; 4] {
    let fills = (b.0 - page.0).abs() <= 2.0 && (b.1 - page.1).abs() <= 2.0;
    if page.0 <= 0.0 || page.1 <= 0.0 || b.0 <= 0.0 || b.1 <= 0.0 || fills {
        return [0.0, 0.0, b.0.max(0.0), b.1.max(0.0)];
    }
    let s = (b.0 / page.0).min(b.1 / page.1);
    let (w, h) = (page.0 * s, page.1 * s);
    [((b.0 - w) / 2.0).round(), ((b.1 - h) / 2.0).round(), w.round(), h.round()]
}

/// 칸 안 점 → 페이지 비율(0~1) — 그림 밖이면 None(Swift BrowserMirror.ratio, 위 원점)
#[cfg_attr(not(windows), allow(dead_code))]
pub fn ratio_in(x: f64, y: f64, r: [f64; 4]) -> Option<(f64, f64)> {
    if r[2] <= 0.0 || r[3] <= 0.0 {
        return None;
    }
    let (rx, ry) = ((x - r[0]) / r[2], (y - r[1]) / r[3]);
    ((0.0..=1.0).contains(&rx) && (0.0..=1.0).contains(&ry)).then_some((rx, ry))
}

/// CDP 보조 키 — Alt 1 · Ctrl 2 · Meta(윈도우 키) 4 · Shift 8
#[cfg_attr(not(windows), allow(dead_code))]
pub fn cdp_mods(alt: bool, ctrl: bool, meta: bool, shift: bool) -> u32 {
    (alt as u32) | (ctrl as u32) << 1 | (meta as u32) << 2 | (shift as u32) << 3
}

/// 윈도우 휠 한 번(WHEEL_DELTA 120 단위, 앞으로 굴리면 +) → CDP (deltaX, deltaY) — CDP 는 아래로 굴리면 +y, 오른쪽 +x
#[cfg_attr(not(windows), allow(dead_code))]
pub fn wheel_delta(raw: i16, horizontal: bool) -> (f64, f64) {
    if horizontal { (raw as f64, 0.0) } else { (0.0, -(raw as f64)) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn 그림_자리는_비율_유지_가운데() {
        assert_eq!(fit((1280.0, 720.0), (1280.0, 720.0)), [0.0, 0.0, 1280.0, 720.0], "칸 = 페이지면 칸 전체");
        assert_eq!(fit((1280.0, 720.0), (640.0, 720.0)), [0.0, 180.0, 640.0, 360.0]);
        assert_eq!(fit((800.0, 800.0), (1000.0, 500.0)), [250.0, 0.0, 500.0, 500.0]);
        assert_eq!(fit((0.0, 0.0), (300.0, 200.0)), [0.0, 0.0, 300.0, 200.0], "그림 크기를 모르면 칸 전체");
        // 2점 안쪽 차이는 꽉 채운다 — 비율 맞춤 여백이 칸 끝 1px 어두운 줄로 보였다(10-28 사용자, Swift BrowserMirror.fills 와 같은 규칙)
        assert_eq!(fit((780.0, 694.0), (781.5, 694.0)), [0.0, 0.0, 781.5, 694.0]);
        assert_eq!(fit((780.0, 694.0), (778.5, 695.5)), [0.0, 0.0, 778.5, 695.5]);
    }

    #[test]
    fn 칸_점은_그림_안에서만_비율로() {
        let r = [0.0, 180.0, 640.0, 360.0];
        assert_eq!(ratio_in(320.0, 360.0, r), Some((0.5, 0.5)));
        assert_eq!(ratio_in(320.0, 100.0, r), None, "위 검은 띠");
        assert_eq!(ratio_in(640.0, 540.0, r), Some((1.0, 1.0)));
        assert_eq!(ratio_in(1.0, 1.0, [0.0, 0.0, 0.0, 0.0]), None);
    }

    #[test]
    fn 보조키와_휠() {
        assert_eq!(cdp_mods(false, false, false, false), 0);
        assert_eq!(cdp_mods(true, true, true, true), 15);
        assert_eq!(cdp_mods(false, true, false, true), 10);
        assert_eq!(wheel_delta(120, false), (0.0, -120.0), "앞으로 굴림 = 위로");
        assert_eq!(wheel_delta(-240, false), (0.0, 240.0));
        assert_eq!(wheel_delta(120, true), (120.0, 0.0));
    }

    fn g() -> Geom {
        // 실측 모양 — 크롬 베타 창 1400x968, 툴바 88, 페이지 1400x880
        Geom { id: 7, win: [-2886.0, 1004.0, 1400.0, 968.0], top: 88.0, inner: [1400.0, 880.0] }
    }

    #[test]
    fn 칸이_달라도_도구가_돌거나_손을_안_뗐으면_안_바꾼다() {
        let now = Instant::now();
        let w = Want { w: 1100.0, h: 700.0, at: now - Duration::from_secs(1) };
        assert!(resize_due(w, &g(), false, false, now));
        assert!(!resize_due(w, &g(), true, false, now), "세션 도구가 도는 중");
        assert!(!resize_due(w, &g(), false, true, now), "사람이 크롬 창으로 꺼내 봄");
        assert!(!resize_due(Want { at: now, ..w }, &g(), false, false, now), "끄는 중(손 안 뗌)");
        assert!(!resize_due(Want { w: 1401.5, h: 879.0, ..w }, &g(), false, false, now), "2점 안쪽은 같다");
        assert!(!resize_due(Want { w: 120.0, h: 90.0, ..w }, &g(), false, false, now), "접힌 칸 크기로 줄이지 않는다");
    }

    #[test]
    fn 새_창_자리는_가짜_화면_왼쪽_위에서_페이지가_칸_크기() {
        let vd = crate::vdisplay::Rect { x: -3870.0, y: 980.0, w: 1920.0, h: 1200.0 };
        let w = Want { w: 1100.0, h: 700.0, at: Instant::now() };
        assert_eq!(fit_bounds(w, &g(), vd), [-3870.0, 980.0, 1100.0, 788.0]);
        // 화면보다 크면 화면까지만
        let big = Want { w: 2600.0, h: 1500.0, ..w };
        assert_eq!(fit_bounds(big, &g(), vd), [-3870.0, 980.0, 1920.0, 1200.0]);
        // 창 테두리(좌우)도 더한다
        let framed = Geom { win: [0.0, 0.0, 1404.0, 968.0], ..g() };
        assert_eq!(fit_bounds(w, &framed, vd)[2], 1104.0);
    }

    #[test]
    fn 사람_첫_입력에_저절로_개입_지나가는_마우스는_버림() {
        use crate::agent_input::InputEv;
        let m = |ty: &str| InputEv::Mouse { ty: ty.into(), x: 0.5, y: 0.5, button: None, click_count: None, delta_x: None, delta_y: Some(120.0), modifiers: 0 };
        let (mv, down, wheel) = (m("mouseMoved"), m("mousePressed"), m("mouseWheel"));
        let text = InputEv::Text { text: "가".into() };
        assert_eq!(pane_step(false, &[mv.clone()]), Step::Drop);
        assert_eq!(pane_step(false, &[mv.clone(), down]), Step::Start);
        assert_eq!(pane_step(false, &[wheel]), Step::Start, "스크롤도 사람 손 — 세션과 섞이면 안 된다");
        assert_eq!(pane_step(false, &[text]), Step::Start);
        assert_eq!(pane_step(true, &[mv]), Step::Go, "개입 중이면 이동도 보낸다(마우스 올림 효과)");
    }

    #[test]
    fn 참모_누름은_사람_입력_직후가_아닐_때() {
        let now = Instant::now();
        assert!(agent_press(None, now));
        assert!(!agent_press(Some(now - Duration::from_millis(100)), now), "앱이 보낸 사람 누름이 되돌아온 것");
        assert!(agent_press(Some(now - Duration::from_secs(2)), now));
    }

    #[test]
    fn 커서_자리는_페이지_비율() {
        let m = crate::agent_input::Meta { w: 800.0, h: 600.0 };
        assert_eq!(cursor_ratio(400.0, 150.0, m), Some((0.5, 0.25)));
        assert_eq!(cursor_ratio(900.0, -5.0, m), Some((1.0, 0.0)));
        assert_eq!(cursor_ratio(1.0, 1.0, crate::agent_input::Meta::default()), None);
    }

    #[test]
    fn 헤드리스는_제품_이름으로() {
        assert!(is_headless("HeadlessChrome/120.0.6099.0", ""));
        // 10-27 실측 크롬 베타 157 --headless=new
        assert!(is_headless("Chrome/157.0.8103.15", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36"));
        assert!(!is_headless("Chrome/157.0.8103.15", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36"));
        assert!(!is_headless("", ""));
    }

    #[test]
    fn 받기가_멈추거나_0장이면_그림_길로() {
        assert!(sck_failed(4, false, true), "받기 멈춤 — 옛 그림이 남은 채 어긋난다");
        assert!(sck_failed(1, true, true), "2초째 0장");
        assert!(!sck_failed(1, false, true));
        assert!(!sck_failed(4, true, false), "이미 그림 길(창 자리 없음)");
        assert!(!sck_failed(2, false, true), "권한 없음은 안내로");
    }

    #[test]
    fn 칸_길이_바뀌면_손잡이를_새로() {
        assert!(same_handle((42, false), 42, false));
        assert!(!same_handle((42, false), 43, false), "크롬이 다시 떴다");
        assert!(!same_handle((42, false), 42, true), "SCK 손잡이에 그림을 밀지 않는다");
    }

    #[test]
    fn 그림_칸을_새로_붙이면_다시_민다() {
        assert!(fresh_handle(None, 42, true), "처음·떨어졌다 다시(채팅 탭 오가기)");
        assert!(!fresh_handle(Some((42, true)), 42, true), "0.5초마다 같은 손잡이");
        assert!(fresh_handle(Some((41, true)), 42, true), "크롬이 다시 떴다");
        assert!(fresh_handle(Some((42, false)), 42, true), "SCK → 그림 길");
        assert!(!fresh_handle(None, 42, false), "SCK 칸은 SCK 가 첫 장을 준다");
    }

    #[test]
    fn 상태_글() {
        assert_eq!(status_word(None), "no-browser");
        assert_eq!(status_word(Some(1)), "live");
        assert_eq!(status_word(Some(2)), "no-permission");
        assert_eq!(status_word(Some(3)), "no-window");
        assert_eq!(status_word(Some(9)), "stopped");
    }
}

// ── 칸 ↔ Swift 비추기 ──────────────────────────────────────────────
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, Runtime};

#[cfg(craft_mirror)]
extern "C" {
    fn browser_mirror_attach(win: *mut std::ffi::c_void, pid: i32) -> *mut std::ffi::c_void;
    #[allow(clippy::too_many_arguments)]
    fn browser_mirror_place(h: *mut std::ffi::c_void, x: f64, y: f64, w: f64, hh: f64, vh: f64, visible: i32, wx: f64, wy: f64, ww: f64, wh: f64, top: f64);
    fn browser_mirror_status(h: *mut std::ffi::c_void) -> i32;
    fn browser_mirror_blind(h: *mut std::ffi::c_void) -> i32;
    fn browser_mirror_still(h: *mut std::ffi::c_void, path: *const std::ffi::c_char) -> i32;
    fn browser_mirror_detach(h: *mut std::ffi::c_void);
    fn browser_mirror_set_input(h: *mut std::ffi::c_void, cb: extern "C" fn(*mut std::ffi::c_void, *const std::ffi::c_char), ctx: *mut std::ffi::c_void);
    fn browser_mirror_cursor(h: *mut std::ffi::c_void, rx: f64, ry: f64);
    fn browser_mirror_frame(h: *mut std::ffi::c_void, data: *const u8, len: usize, css_w: f64, css_h: f64);
}

/// 앱 손잡이 — Swift 콜백(칸 입력)·일꾼(참모 커서)이 메인 스레드로 넘어갈 때. 칸을 처음 놓을 때 적는다
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Swift 비추기 뷰가 넘긴 사람 입력 {events, focus} — ctx = 그 칸 프로필(붙일 때 넘긴 것). 메인 스레드라 일은 따로 돌린다
#[cfg(craft_mirror)]
extern "C" fn on_input(ctx: *mut std::ffi::c_void, json: *const std::ffi::c_char) {
    if ctx.is_null() || json.is_null() {
        return;
    }
    let profile = unsafe { &*(ctx as *const String) }.clone();
    let Ok(text) = unsafe { std::ffi::CStr::from_ptr(json) }.to_str().map(str::to_string) else { return };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return };
    if let Ok(evs) = serde_json::from_value::<Vec<crate::agent_input::InputEv>>(v["events"].clone()) {
        handle_input(profile, evs, v["focus"] == true);
    }
}

/// 네이티브 칸(맥 Swift 뷰·윈도우 자식 창)이 받은 사람 입력 — 메인 스레드에서 오니 일은 따로 돌린다
#[cfg_attr(not(any(craft_mirror, windows)), allow(dead_code))]
pub(crate) fn handle_input(profile: String, evs: Vec<crate::agent_input::InputEv>, focus: bool) {
    std::thread::spawn(move || {
        // 칸을 누르면 키·한글은 웹 숨은 글칸이 받는다(모달과 같은 길) — 그 글칸에 포커스
        if focus {
            if let Some(w) = APP.get().and_then(|a| a.get_webview_window("main")) {
                let _ = w.eval(format!("window.__bpFocus && window.__bpFocus({})", serde_json::Value::from(profile.as_str())));
            }
        }
        let _ = crate::agent_browser::pane_input(&profile, evs);
    });
}

/// 칸에 넘긴 그림 수(프로필별) — 시험이 '칸이 그림을 받나'를 센다
static PUSHED: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);
pub fn pushed(profile: &str) -> u64 {
    PUSHED.lock().ok().and_then(|g| g.as_ref().and_then(|m| m.get(profile).copied())).unwrap_or(0)
}

/// 그림 칸 한 장(JPEG) — 비출 창이 없어(헤드리스·가린 크롬) screencast 그림을 같은 칸에 그린다(6단계). 메인 스레드에서 풀어 그린다.
/// page = 그 그림의 페이지 점 크기(모르면 0) — 그림 배율은 창이 놓인 화면 따라 1배·2배라 칸이 2배로 짐작하면 안 된다(10-28)
pub fn push_frame(profile: &str, jpeg: Vec<u8>, page: crate::agent_input::Meta) {
    *PUSHED.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).entry(profile.to_string()).or_default() += 1;
    let Some(app) = APP.get() else { return };
    let Some((h, ..)) = handles(|m| m.get(profile).copied()) else { return };
    #[cfg(craft_mirror)]
    let _ = app.run_on_main_thread(move || unsafe { browser_mirror_frame(h as *mut _, jpeg.as_ptr(), jpeg.len(), page.w, page.h) });
    // 윈도우 — 풀기는 따로 실에서(최신 한 장만), 그리기는 메인 스레드(browser_pane_win)
    #[cfg(windows)]
    crate::browser_pane_win::frame(app.clone(), h, jpeg);
    #[cfg(not(craft_mirror))]
    let _ = page;
    #[cfg(not(any(craft_mirror, windows)))]
    let _ = (app, h, jpeg);
}

/// 그림 칸 손잡이를 새로 붙였나 — 처음이거나, 크롬·칸 길이 바뀌어 새로 붙였을 때(SCK 칸은 SCK 가 첫 장을 바로 준다)
pub fn fresh_handle(prior: Option<(i32, bool)>, pid: i32, cast: bool) -> bool {
    cast && !prior.is_some_and(|o| same_handle(o, pid, cast))
}

/// 그림 칸 손잡이를 새로 붙였다(채팅 탭을 오가 칸이 떨어졌다 다시 붙음) — 마지막 그림을 바로 밀고 일꾼에게 새로 한 장 찍게 한다.
/// 안 그러면 안 바뀌는 페이지(지메일)는 크롬 screencast 가 프레임을 안 보내 새 칸이 '브라우저 화면 받는 중…'에 멈췄다(10-28 사용자, pane_reattach_e2e)
pub fn reattached(profile: &str) {
    if let Some((jpeg, meta)) = crate::agent_browser::pane_reattached(profile) {
        push_frame(profile, jpeg, meta);
    }
}

/// 참모 커서 — 참모가 누른 자리(페이지 비율)로 비추기 층의 커서가 옮겨 간다(spike A4)
pub fn show_cursor(profile: &str, rx: f64, ry: f64) {
    let Some(app) = APP.get() else { return };
    let Some((h, ..)) = handles(|m| m.get(profile).copied()) else { return };
    #[cfg(craft_mirror)]
    let _ = app.run_on_main_thread(move || unsafe { browser_mirror_cursor(h as *mut _, rx, ry) });
    #[cfg(windows)]
    let _ = app.run_on_main_thread(move || crate::browser_pane_win::cursor(h, rx, ry));
    #[cfg(not(any(craft_mirror, windows)))]
    let _ = (app, h, rx, ry);
}

/// 프로필 → (Swift 손잡이, 그 크롬 pid, 그림 받는 칸인가) — 크롬이 다시 뜨거나(pid 바뀜) 칸 길이 바뀌면(SCK ↔ 그림) 떼고 새로 붙인다
/// (SCK 받기가 남은 손잡이에 그림을 밀면 가린 창의 빈 장과 번갈아 그려진다)
static HANDLES: Mutex<Option<HashMap<String, (usize, i32, bool)>>> = Mutex::new(None);

fn handles<T>(f: impl FnOnce(&mut HashMap<String, (usize, i32, bool)>) -> T) -> T {
    let mut g = HANDLES.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashMap::new))
}

/// SCK 길을 버릴까 — 창을 비추는 중인데(창 자리를 줬다) 받기가 멈췄거나(4) 2초째 0장이면
pub fn sck_failed(status: i32, blind: bool, mirroring: bool) -> bool {
    mirroring && (blind || status == 4)
}

/// 그 손잡이를 그대로 쓸까 — 같은 크롬이고 같은 길(SCK·그림)이면
pub fn same_handle(old: (i32, bool), pid: i32, cast: bool) -> bool {
    old == (pid, cast)
}

/// 메인 스레드에서 — 그 프로필 손잡이(없거나 pid·칸 길이 바뀌었으면 새로)
#[cfg(craft_mirror)]
fn handle_for(ns: usize, profile: &str, pid: i32, cast: bool) -> Option<usize> {
    if let Some((h, p, c)) = handles(|m| m.get(profile).copied()) {
        if same_handle((p, c), pid, cast) {
            return Some(h);
        }
        handles(|m| m.remove(profile));
        unsafe { browser_mirror_detach(h as *mut _) };
    }
    let h = unsafe { browser_mirror_attach(ns as *mut _, pid) };
    if h.is_null() {
        return None;
    }
    // 프로필 이름은 손잡이가 떨어질 때까지 쓰인다 — 작아서 그냥 둔다(붙일 때 한 번)
    let ctx = Box::into_raw(Box::new(profile.to_string())) as *mut std::ffi::c_void;
    unsafe { browser_mirror_set_input(h, on_input, ctx) };
    handles(|m| m.insert(profile.to_string(), (h as usize, pid, cast)));
    Some(h as usize)
}

/// 메인 스레드에서 — 윈도우 그림 칸 손잡이(자식 창, 없거나 래퍼가 바뀌었으면 새로)
#[cfg(windows)]
fn win_handle_for(parent: usize, profile: &str, pid: i32) -> Option<usize> {
    if let Some((h, p, c)) = handles(|m| m.get(profile).copied()) {
        if same_handle((p, c), pid, true) {
            return Some(h);
        }
        handles(|m| m.remove(profile));
        crate::browser_pane_win::detach(h);
    }
    let h = crate::browser_pane_win::attach(parent, profile)?;
    handles(|m| m.insert(profile.to_string(), (h, pid, true)));
    Some(h)
}

/// 칸 자리(웹뷰 왼쪽 위 기준 CSS 점)·보임 — 웹이 바뀔 때·0.5초마다. 답 = 칸 상태 글(status_word)
/// lsof(크롬 pid)·일꾼 자물쇠를 쥐니 메인 스레드 밖에서, Swift 는 메인 스레드에서
#[tauri::command]
pub async fn browser_pane_place(handle: tauri::AppHandle, profile: String, rect: [f64; 4], vh: f64, visible: bool) -> Result<String, String> {
    let _ = APP.set(handle.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let Some((pid, geom, cast)) = crate::agent_browser::pane_geom(&profile, rect[2], rect[3], visible) else { return Ok(status_word(None).to_string()) };
        let prior = handles(|m| m.get(&profile).map(|&(_, p, c)| (p, c)));
        // 헤드리스(비출 창 없음)·가린 크롬(SCK 가 못 받음) — 창 자리를 비워 SCK 를 안 켜고 그림은 일꾼이 넘긴다(push_frame)
        let geom = if cast { None } else { geom };
        let main = handle.get_webview_window("main").ok_or("no main window")?;
        let (tx, rx) = std::sync::mpsc::channel();
        let g = geom.unwrap_or_default();
        #[cfg(not(any(craft_mirror, windows)))]
        let _ = (main.clone(), pid, g, vh, visible, tx, cast);
        // 윈도우 — 비출 창이 없어(숨은 데스크톱) 늘 그림 칸. 칸 자리는 물리 픽셀로(웹뷰 = 창 안쪽 전체)
        #[cfg(windows)]
        {
            let _ = (g, vh, cast);
            let (m2, profile) = (main.clone(), profile.clone());
            let scale = main.scale_factor().unwrap_or(1.0);
            main.run_on_main_thread(move || {
                let Ok(parent) = m2.hwnd() else { return };
                let Some(h) = win_handle_for(parent.0 as usize, &profile, pid) else { return };
                crate::browser_pane_win::place(h, rect.map(|v| v * scale), visible);
                let _ = tx.send((crate::browser_pane_win::status(h), false));
            })
            .map_err(|e| e.to_string())?;
        }
        #[cfg(craft_mirror)]
        {
            let (m2, profile) = (main.clone(), profile.clone());
            main.run_on_main_thread(move || {
                let Ok(ns) = m2.ns_window() else { return };
                let Some(h) = handle_for(ns as usize, &profile, pid, cast) else { return };
                unsafe {
                    browser_mirror_place(h as *mut _, rect[0], rect[1], rect[2], rect[3], vh, visible as i32, g.win[0], g.win[1], g.win[2], g.win[3], g.top);
                    let _ = tx.send((browser_mirror_status(h as *mut _), browser_mirror_blind(h as *mut _) == 1));
                }
            })
            .map_err(|e| e.to_string())?;
        }
        let got = rx.recv_timeout(std::time::Duration::from_secs(2)).ok();
        if got.is_some() && fresh_handle(prior, pid, cast) {
            reattached(&profile);
        }
        // SCK 가 2초째 한 장도 못 받거나 받기가 멈췄으면(가린 창은 SCK 가 아예 못 찍는다 — 실측 -3811) 그 크롬은 그림 길로.
        // 멈춘 받기는 옛 그림을 남긴 채 창 크기만 바뀌어 주소창·까만 띠가 비쳤다(10-28 세션 칸). 다음 자리 알림부터 — 손잡이를 새로 붙인다
        if got.is_some_and(|g| sck_failed(g.0, g.1, geom.is_some())) {
            crate::agent_browser::pane_blind(&profile, pid);
        }
        Ok(status_word(got.map(|g| g.0)).replace("no-browser", "stopped"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 마지막 그림 — 덮개(팝오버·카드)가 칸을 덮어 비추기를 숨길 때 웹이 그 자리에 깐다(Craft 칸과 같은 길)
#[tauri::command]
pub async fn browser_pane_still<R: Runtime>(handle: tauri::AppHandle<R>, profile: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some((h, ..)) = handles(|m| m.get(&profile).copied()) else { return Ok(String::new()) };
        // 윈도우 — 마지막으로 받은 JPEG 그대로(다시 찍을 것 없음)
        #[cfg(windows)]
        {
            let _ = &handle;
            return Ok(crate::browser_pane_win::still(h).map(|j| crate::craft_window::jpeg_url(&j)).unwrap_or_default());
        }
        #[allow(unreachable_code)]
        let path = crate::config::data_file("browser").join("live").join(format!(".{profile}-still.jpg"));
        let _ = std::fs::remove_file(&path);
        let (tx, rx) = std::sync::mpsc::channel();
        let p2 = path.clone();
        #[cfg(not(craft_mirror))]
        let _ = (h, p2, tx, &handle);
        #[cfg(craft_mirror)]
        handle
            .run_on_main_thread(move || {
                let Ok(c) = std::ffi::CString::new(p2.to_string_lossy().as_bytes()) else { return };
                let _ = tx.send(unsafe { browser_mirror_still(h as *mut _, c.as_ptr()) } == 1);
            })
            .map_err(|e| e.to_string())?;
        if !rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap_or(false) {
            return Ok(String::new());
        }
        let url = crate::craft_window::jpeg_url(&std::fs::read(&path).unwrap_or_default());
        let _ = std::fs::remove_file(&path); // 화면 그림이 데이터 폴더에 남지 않게
        Ok(url)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 칸 머리줄·숨은 글칸의 입력(키·글·뒤로·앞으로·새로고침) — 마우스는 Swift 뷰가 바로 넘긴다
#[tauri::command(async)]
pub fn browser_pane_input(profile: String, events: Vec<crate::agent_input::InputEv>) -> Result<(), String> {
    crate::agent_browser::pane_input(&profile, events)
}

/// 칸이 사라졌다(탭 X = 숨김·다른 탭·참모 바꾸기) — 비추기만 뗀다. 크롬·세션은 그대로, 다시 열면 0.06초 안에 첫 그림(spike A5)
#[tauri::command]
pub fn browser_pane_detach<R: Runtime>(handle: tauri::AppHandle<R>, profile: String) {
    if let Some((h, ..)) = handles(|m| m.remove(&profile)) {
        #[cfg(craft_mirror)]
        let _ = handle.run_on_main_thread(move || unsafe { browser_mirror_detach(h as *mut _) });
        #[cfg(windows)]
        let _ = handle.run_on_main_thread(move || crate::browser_pane_win::detach(h));
        #[cfg(not(any(craft_mirror, windows)))]
        let _ = (h, &handle);
    }
}
