//! 윈도우 세션 브라우저 칸의 네이티브 층(2026-10-28 인앱 브라우저 윈도우판) — 맥 Swift 비추기 뷰(tools/craft-mirror/browser.swift)의 그림 칸 길과 같은 일.
//! 숨은 데스크톱 크롬(win_desk)은 비출 창이 없어서 일꾼이 받은 CDP screencast JPEG 를 앱 창이 소유한 떠 있는 창(칸 자리)에 그린다.
//! 자식 창이 아닌 까닭(10-28 윈도우 시험 PC 실측): 웹뷰(WebView2)는 DirectComposition 으로 그려서 같은 창 안 GDI 자식 창은 z 순서가 위여도
//! 웹뷰 밑에 깔려 안 보였다 — 소유된 창(WS_POPUP, 작업 표시줄·활성화 없음)은 따로 합성돼 앱 창 바로 위에 뜨고, 앱 창이 움직이면 follow 로 따라간다
//! - 풀기: GDI+(win_jpeg) — 따로 실에서 최신 한 장만(밀리면 옛 장은 버림), 그리기: 메인 스레드 WM_PAINT 에서 StretchDIBits(두 겹 버퍼)
//! - 입력: 마우스·휠을 페이지 비율로 바꿔 browser_pane::handle_input(맥 뷰와 같은 길), 키·한글은 웹 숨은 글칸이 받는다
//! - 참모 커서: 그 층 위 화살(참모 색), 1.8초 뒤 사라짐 · 덮개 때 깔 마지막 그림 = 마지막 JPEG 그대로
//! 웹 칸은 비워 두고 이 창이 그 위에 얹힌다 — 웹 카드·메뉴는 웹이 덮개로 알리고(visible=false) 마지막 그림을 깐다
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Instant;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, ReleaseCapture, SetCapture, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT};
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use crate::agent_input::InputEv;
use crate::win_jpeg::{decode, Img};

struct Pane {
    profile: String,
    img: Option<Img>,
    jpeg: Vec<u8>,
    status: i32,
    visible: bool,
    cursor: Option<(f64, f64)>,
    /// 앱 창(소유자)과 칸 자리(앱 창 안쪽 물리 픽셀) — 앱 창이 움직이면 이 자리로 다시 놓는다
    owner: usize,
    rect: [f64; 4],
    last_move: Option<Instant>,
    clicks: u32,
}

/// 자식 창(hwnd) → 칸 상태. 창 프로시저·그리기는 메인 스레드, 풀기 실은 손잡이만 들고 메인 스레드로 넘긴다
static PANES: Mutex<Option<HashMap<usize, Pane>>> = Mutex::new(None);

fn panes<T>(f: impl FnOnce(&mut HashMap<usize, Pane>) -> T) -> T {
    let mut g = PANES.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashMap::new))
}

const CLASS: &str = "ChammoBrowserPane";
const DARK: u32 = 0x001f1f1f; // COLORREF 0x00BBGGRR — 맥 칸 바탕(흰 0.12)과 같은 회색
const CURSOR_TIMER: usize = 1;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn class() -> bool {
    static OK: OnceLock<bool> = OnceLock::new();
    *OK.get_or_init(|| unsafe {
        let name = wide(CLASS);
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_DBLCLKS,
            lpfnWndProc: Some(proc_),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: GetModuleHandleW(std::ptr::null()),
            hIcon: std::ptr::null_mut(),
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: name.as_ptr(),
            hIconSm: std::ptr::null_mut(),
        };
        // 이름 버퍼는 등록하는 동안만 있으면 된다(시스템이 복사)
        RegisterClassExW(&wc) != 0
    })
}

/// 메인 스레드에서 — 앱 창(parent)이 소유한 칸 창을 만든다. 첫 그림 전엔 숨겨 둔다(그동안 웹 칸 안내가 보인다)
pub fn attach(parent: usize, profile: &str) -> Option<usize> {
    if !class() {
        return None;
    }
    let name = wide(CLASS);
    let h = unsafe {
        CreateWindowExW(
            // 도구 창(작업 표시줄·Alt+Tab 없음) + 활성화 없음(눌러도 앱 창이 앞 창 그대로, 키는 웹 숨은 글칸이 받는다)
            WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            name.as_ptr(),
            std::ptr::null(),
            WS_POPUP | WS_CLIPSIBLINGS,
            0,
            0,
            1,
            1,
            parent as HWND,
            std::ptr::null_mut(),
            GetModuleHandleW(std::ptr::null()),
            std::ptr::null(),
        )
    };
    if h.is_null() {
        return None;
    }
    panes(|m| m.insert(h as usize, Pane { profile: profile.to_string(), img: None, jpeg: vec![], status: 0, visible: false, cursor: None, owner: parent, rect: [0.0; 4], last_move: None, clicks: 1 }));
    Some(h as usize)
}

/// 메인 스레드에서 — 칸 자리(앱 창 안쪽 물리 픽셀)·보임
pub fn place(h: usize, r: [f64; 4], visible: bool) {
    let show = visible && r[2] >= 40.0 && r[3] >= 40.0;
    let got = panes(|m| {
        m.get_mut(&h).map(|p| {
            p.visible = show;
            p.rect = r;
            (p.img.is_some(), p.owner)
        })
    });
    let Some((ready, owner)) = got else { return };
    put_at(h, owner, r);
    unsafe {
        ShowWindow(h as HWND, if show && ready { SW_SHOWNA } else { SW_HIDE });
    }
}

/// 앱 창 안쪽 자리 → 화면 자리로 옮긴다. z 순서는 안 건드린다 — 소유된 창은 늘 앱 창 바로 위라, 맨 위로 올리면 다른 앱 창까지 덮는다
fn put_at(h: usize, owner: usize, r: [f64; 4]) {
    let mut o = POINT { x: 0, y: 0 };
    unsafe {
        ClientToScreen(owner as HWND, &mut o);
        SetWindowPos(h as HWND, std::ptr::null_mut(), o.x + r[0].round() as i32, o.y + r[1].round() as i32, r[2].round().max(1.0) as i32, r[3].round().max(1.0) as i32, SWP_NOACTIVATE | SWP_NOZORDER);
    }
}

/// 메인 스레드에서 — 앱 창이 움직이거나 크기가 바뀌었다(on_window_event) — 칸 창들을 같은 자리로
pub fn follow() {
    let all: Vec<(usize, usize, [f64; 4])> = panes(|m| m.iter().map(|(h, p)| (*h, p.owner, p.rect)).collect());
    for (h, owner, r) in all {
        put_at(h, owner, r);
    }
}

/// 칸 상태 — craft_mirror_status 와 같은 번호: 0 기다림(첫 그림 전) · 1 그리는 중
pub fn status(h: usize) -> i32 {
    panes(|m| m.get(&h).map(|p| p.status)).unwrap_or(4)
}

/// 덮개 때 웹이 깔 마지막 그림
pub fn still(h: usize) -> Option<Vec<u8>> {
    panes(|m| m.get(&h).map(|p| p.jpeg.clone())).filter(|j| !j.is_empty())
}

/// 메인 스레드에서 — 칸 창을 없앤다(크롬·세션은 그대로)
pub fn detach(h: usize) {
    panes(|m| m.remove(&h));
    unsafe {
        DestroyWindow(h as HWND);
    }
}

/// 메인 스레드에서 — 참모가 누른 자리(페이지 비율)로 커서, 1.8초 뒤 사라짐
pub fn cursor(h: usize, rx: f64, ry: f64) {
    if panes(|m| m.get_mut(&h).map(|p| p.cursor = Some((rx, ry)))).is_none() {
        return;
    }
    unsafe {
        SetTimer(h as HWND, CURSOR_TIMER, 1800, None);
        InvalidateRect(h as HWND, std::ptr::null(), 0);
    }
}

// ── 풀기 실 — 최신 한 장만 ──────────────────────────────────────────

static SLOT: Mutex<Option<(usize, Vec<u8>)>> = Mutex::new(None);
static WAKE: Condvar = Condvar::new();

/// 일꾼 실에서 — 그림 한 장(JPEG). 풀기 실이 받아 풀고 메인 스레드에서 칸에 놓는다
pub fn frame(app: tauri::AppHandle, h: usize, jpeg: Vec<u8>) {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        std::thread::Builder::new()
            .name("browser-pane-decode".into())
            .spawn(move || decode_loop(app))
            .map(|_| ())
            .unwrap_or(())
    });
    *SLOT.lock().unwrap_or_else(|e| e.into_inner()) = Some((h, jpeg));
    WAKE.notify_one();
}

fn decode_loop(app: tauri::AppHandle) {
    loop {
        let (h, jpeg) = {
            let mut g = SLOT.lock().unwrap_or_else(|e| e.into_inner());
            loop {
                if let Some(x) = g.take() {
                    break x;
                }
                g = WAKE.wait(g).unwrap_or_else(|e| e.into_inner());
            }
        };
        let Some(img) = decode(&jpeg) else { continue };
        let _ = app.run_on_main_thread(move || put(h, img, jpeg));
    }
}

/// 메인 스레드에서 — 풀린 그림을 칸에. 첫 그림이면 (보일 자리일 때) 창을 보인다
fn put(h: usize, img: Img, jpeg: Vec<u8>) {
    let Some(show) = panes(|m| {
        m.get_mut(&h).map(|p| {
            p.img = Some(img);
            p.jpeg = jpeg;
            p.status = 1;
            p.visible
        })
    }) else {
        return;
    };
    unsafe {
        if show {
            ShowWindow(h as HWND, SW_SHOWNA);
        }
        InvalidateRect(h as HWND, std::ptr::null(), 0);
    }
}

// ── 창 프로시저 ────────────────────────────────────────────────────

fn client(h: HWND) -> (f64, f64) {
    let mut rc: RECT = unsafe { std::mem::zeroed() };
    unsafe { GetClientRect(h, &mut rc) };
    ((rc.right - rc.left) as f64, (rc.bottom - rc.top) as f64)
}

/// 그림이 놓인 자리(칸 안, 비율 유지 가운데)
fn content(h: HWND, img: Option<(i32, i32)>) -> [f64; 4] {
    let b = client(h);
    match img {
        Some((w, hh)) => crate::browser_pane::fit((w as f64, hh as f64), b),
        None => [0.0, 0.0, b.0, b.1],
    }
}

fn mods() -> u32 {
    let down = |k: u16| unsafe { GetKeyState(k as i32) } < 0;
    crate::browser_pane::cdp_mods(down(VK_MENU), down(VK_CONTROL), down(VK_LWIN) || down(VK_RWIN), down(VK_SHIFT))
}

fn lxy(l: LPARAM) -> (f64, f64) {
    ((l & 0xffff) as i16 as f64, ((l >> 16) & 0xffff) as i16 as f64)
}

/// 마우스 하나를 페이지 비율로 — 그림 밖이거나 첫 그림 전이면 버린다. 지나가는 이동은 초당 60번까지
fn mouse(h: HWND, ty: &str, x: f64, y: f64, button: &str, count: Option<u32>, delta: Option<(f64, f64)>, focus: bool) {
    let hit = panes(|m| {
        let p = m.get_mut(&(h as usize))?;
        if p.status != 1 {
            return None;
        }
        if ty == "mouseMoved" {
            let now = Instant::now();
            if p.last_move.is_some_and(|t| now.duration_since(t).as_secs_f64() < 1.0 / 60.0) {
                return None;
            }
            p.last_move = Some(now);
        }
        Some((p.profile.clone(), p.img.as_ref().map(|i| (i.w, i.h))))
    });
    let Some((profile, img)) = hit else { return };
    let Some((rx, ry)) = crate::browser_pane::ratio_in(x, y, content(h, img)) else { return };
    let ev = InputEv::Mouse { ty: ty.into(), x: rx, y: ry, button: Some(button.into()), click_count: count, delta_x: delta.map(|d| d.0), delta_y: delta.map(|d| d.1), modifiers: mods() };
    crate::browser_pane::handle_input(profile, vec![ev], focus);
}

fn press(h: HWND, l: LPARAM, button: &str, count: u32, down: bool) {
    let (x, y) = lxy(l);
    let n = panes(|m| {
        m.get_mut(&(h as usize)).map(|p| {
            if down {
                p.clicks = count;
            }
            p.clicks
        })
    })
    .unwrap_or(1);
    unsafe {
        if down {
            SetCapture(h);
        } else {
            ReleaseCapture();
        }
    }
    mouse(h, if down { "mousePressed" } else { "mouseReleased" }, x, y, button, Some(n), None, down);
}

fn paint(h: HWND) {
    unsafe {
        let mut ps: PAINTSTRUCT = std::mem::zeroed();
        let dc = BeginPaint(h, &mut ps);
        let (w, hh) = client(h);
        let (w, hh) = (w as i32, hh as i32);
        let mem = CreateCompatibleDC(dc);
        let bmp = CreateCompatibleBitmap(dc, w.max(1), hh.max(1));
        let old = SelectObject(mem, bmp as HGDIOBJ);
        let rc = RECT { left: 0, top: 0, right: w, bottom: hh };
        let bg = CreateSolidBrush(DARK);
        FillRect(mem, &rc, bg);
        DeleteObject(bg as HGDIOBJ);
        panes(|m| {
            let Some(p) = m.get(&(h as usize)) else { return };
            if let Some(img) = &p.img {
                let r = content(h, Some((img.w, img.h)));
                let scaled = r[2] as i32 != img.w || r[3] as i32 != img.h;
                SetStretchBltMode(mem, if scaled { HALFTONE } else { COLORONCOLOR });
                SetBrushOrgEx(mem, 0, 0, std::ptr::null_mut());
                let mut bi: BITMAPINFO = std::mem::zeroed();
                bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
                bi.bmiHeader.biWidth = img.w;
                bi.bmiHeader.biHeight = -img.h; // 위에서 아래로
                bi.bmiHeader.biPlanes = 1;
                bi.bmiHeader.biBitCount = 32;
                bi.bmiHeader.biCompression = BI_RGB;
                StretchDIBits(mem, r[0] as i32, r[1] as i32, r[2] as i32, r[3] as i32, 0, 0, img.w, img.h, img.px.as_ptr() as *const c_void, &bi, DIB_RGB_COLORS, SRCCOPY);
                if let Some((cx, cy)) = p.cursor {
                    draw_cursor(mem, r[0] + cx * r[2], r[1] + cy * r[3]);
                }
            }
        });
        BitBlt(dc, 0, 0, w, hh, mem, 0, 0, SRCCOPY);
        SelectObject(mem, old);
        DeleteObject(bmp as HGDIOBJ);
        DeleteDC(mem);
        EndPaint(h, &ps);
    }
}

/// 참모 화살(Swift showCursor 와 같은 모양) — 참모 색 채움·흰 테두리
unsafe fn draw_cursor(dc: HDC, x: f64, y: f64) {
    const P: [(f64, f64); 7] = [(0.0, 0.0), (0.0, 17.0), (4.5, 12.5), (8.0, 19.5), (10.5, 18.3), (7.2, 11.5), (13.0, 11.5)];
    let pts: Vec<POINT> = P.iter().map(|(dx, dy)| POINT { x: (x + dx).round() as i32, y: (y + dy).round() as i32 }).collect();
    let brush = CreateSolidBrush(0x00ff8c4d); // RGB(77,140,255)
    let pen = CreatePen(PS_SOLID, 1, 0x00ffffff);
    let ob = SelectObject(dc, brush as HGDIOBJ);
    let op = SelectObject(dc, pen as HGDIOBJ);
    Polygon(dc, pts.as_ptr(), pts.len() as i32);
    SelectObject(dc, ob);
    SelectObject(dc, op);
    DeleteObject(brush as HGDIOBJ);
    DeleteObject(pen as HGDIOBJ);
}

unsafe extern "system" fn proc_(h: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        WM_ERASEBKGND => 1,
        // 눌러도 활성화하지 않는다 — 앱 창이 앞 창 그대로(키는 웹 숨은 글칸)
        WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
        WM_PAINT => {
            paint(h);
            0
        }
        WM_TIMER if w == CURSOR_TIMER => {
            KillTimer(h, CURSOR_TIMER);
            panes(|m| m.get_mut(&(h as usize)).map(|p| p.cursor = None));
            InvalidateRect(h, std::ptr::null(), 0);
            0
        }
        WM_MOUSEMOVE => {
            let (x, y) = lxy(l);
            let left = w & 0x0001 != 0; // MK_LBUTTON
            mouse(h, "mouseMoved", x, y, if left { "left" } else { "none" }, None, None, false);
            0
        }
        WM_LBUTTONDOWN => { press(h, l, "left", 1, true); 0 }
        WM_LBUTTONDBLCLK => { press(h, l, "left", 2, true); 0 }
        WM_LBUTTONUP => { press(h, l, "left", 1, false); 0 }
        WM_RBUTTONDOWN | WM_RBUTTONDBLCLK => { press(h, l, "right", 1, true); 0 }
        WM_RBUTTONUP => { press(h, l, "right", 1, false); 0 }
        WM_MBUTTONDOWN | WM_MBUTTONDBLCLK => { press(h, l, "middle", 1, true); 0 }
        WM_MBUTTONUP => { press(h, l, "middle", 1, false); 0 }
        WM_MOUSEWHEEL | WM_MOUSEHWHEEL => {
            // 휠 좌표는 화면 기준
            let (sx, sy) = lxy(l);
            let mut pt = POINT { x: sx as i32, y: sy as i32 };
            ScreenToClient(h, &mut pt);
            let raw = ((w >> 16) & 0xffff) as u16 as i16;
            let d = crate::browser_pane::wheel_delta(raw, msg == WM_MOUSEHWHEEL);
            mouse(h, "mouseWheel", pt.x as f64, pt.y as f64, "none", None, Some(d), false);
            0
        }
        _ => DefWindowProcW(h, msg, w, l),
    }
}
