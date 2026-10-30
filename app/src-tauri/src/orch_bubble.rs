// 떠 있는 참모 배지(시안 .shots/orch-bubble v1 A, 2026-10-28 사용자) — 배지는 늘 이 바탕 배지 창 하나(앱 창 안엔 안 그린다, 사용자 "별도로 둥둥 … 하나만").
// 앱 창이 보이든 내려가든(최소화·⌘H·창 닫기) 그대로 떠 있는 포커스 안 뺏는 항상-위 작은 창(맥 = 비활성 패널), 누르면 그 자리 작은 대화창 —
// 본창을 앞으로 안 끌어온다('앱에서 열기'만 메인 창을 부른다). 자리 계산(모니터별 화면 + 비율)은 화면(domain/orchBubble screenSave·screenPlace)이, 여기선 창 조작·보내기만
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

/// 바탕 배지 창 이름
pub const LABEL: &str = "bubble";
/// 대화창(팝업)일 때만 글을 칠 수 있게(키 창) — 배지만 떠 있을 땐 키 창이 안 돼 다른 앱 입력을 안 뺏는다
static KEYABLE: AtomicBool = AtomicBool::new(false);
/// 바탕 배지를 띄워야 하는 때 — 창이 막 만들어져 화면 JS 가 아직 안 붙었으면 화면이 켜지자마자 물어본다(bubble_wanted)
static WANTED: AtomicBool = AtomicBool::new(false);
/// 그릴 얼굴이 있나(화면이 알린다, bubble_face) — 없으면(터미널 뷰·다른 기기 보는 중) 빈 투명 창이 클릭을 먹지 않게 내린다
static HAS_FACE: AtomicBool = AtomicBool::new(true);
/// 마우스를 받는 자리(창 기준 논리 px [x, y, w, h], 화면이 알린다 — bubble_hot). 밖이면 클릭이 바탕으로 지나간다(10-28 사용자 "투명 여백이 클릭을 먹음"). 비면 창 전체
static HOT: Mutex<Vec<[f64; 4]>> = Mutex::new(Vec::new());
/// 올리면 부채가 펴지는 자리 — 비활성 패널은 앱이 안 깨어 있으면 웹뷰에 마우스 올림 사건이 안 와서(그래서 누를 때 부채가 떴다) 전역 마우스 자리로 본다
static HOVER: Mutex<Vec<[f64; 4]>> = Mutex::new(Vec::new());

/// 참모 세션 id 모양 — 메인 창에 eval 로 넘기기 전에 거른다(이름·경로·따옴표가 끼면 버린다)
pub fn orch_id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// 바탕 배지를 띄울까 — 배지(bubble)가 켜져 있으면 앱 창이 보이는 동안은 늘, 앱을 내린 뒤(최소화·⌘H·창 닫기)는 '앱을 내려도'(bubble_desk)가 켜졌을 때
pub fn desk_shown(bubble: bool, desk: bool, main_seen: bool) -> bool {
    bubble && (main_seen || desk)
}

/// 부를 수 있는 창 — 메인·메신저 따로 창·바탕 배지
fn caller_ok(label: &str) -> bool {
    crate::team_ui::ui_window(label) || label == LABEL
}

/// 메인 창을 앞으로 + 그 참모 화면(팀 모드·홈을 떠남). 따로 창 배지는 대화창을 안 열고 메인 창을 부른다(시안 W2), 바탕 배지 '참모 화면으로'도 이 길
#[tauri::command]
pub fn orch_bubble_main(app_handle: tauri::AppHandle, window: tauri::WebviewWindow, orch: String) -> Result<(), String> {
    if !caller_ok(window.label()) {
        return Err("ui windows only".into());
    }
    if !orch_id_ok(&orch) {
        return Err("bad assistant id".into());
    }
    if let Some(w) = app_handle.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    crate::craft_window::to_main(&app_handle, "__orchGo", serde_json::json!({ "orch": orch }));
    Ok(())
}

/// 모니터 하나의 작업 영역(논리 px) — 화면의 domain/orchBubble Screen 과 같은 모양
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct Screen {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(serde::Serialize)]
pub struct Screens {
    pub screens: Vec<Screen>,
    /// 메인 창이 있는 모니터(모니터를 빼면 배지를 여기로)
    pub app: Option<String>,
    /// 바탕 배지 창 자리
    pub win: Option<Screen>,
}

fn screen_of(m: &tauri::Monitor, i: usize) -> Screen {
    // 이름이 없는 모니터(가짜 화면 등)는 순서로 — 이름이 같은 두 모니터는 자리까지 붙여 가른다
    let name = m.name().cloned().unwrap_or_else(|| format!("screen-{i}"));
    let (p, w) = (m.position(), m.work_area());
    screen_rect(name, (p.x, p.y), (w.position.x, w.position.y, w.size.width, w.size.height), m.scale_factor())
}

/// 모니터 하나의 배지 자리(논리 px) — 이름은 모니터 자리로(작업 영역은 독을 옮기면 바뀐다), 크기는 독·메뉴줄을 뺀 작업 영역(배지가 그 밑에 깔리지 않게)
fn screen_rect(name: String, mon: (i32, i32), work: (i32, i32, u32, u32), k: f64) -> Screen {
    Screen { id: format!("{name}@{},{}", mon.0, mon.1), x: work.0 as f64 / k, y: work.1 as f64 / k, w: work.2 as f64 / k, h: work.3 as f64 / k }
}

fn rect_of(w: &tauri::WebviewWindow) -> Option<Screen> {
    let k = w.scale_factor().ok()?;
    let (p, s) = (w.outer_position().ok()?, w.outer_size().ok()?);
    Some(Screen { id: String::new(), x: p.x as f64 / k, y: p.y as f64 / k, w: s.width as f64 / k, h: s.height as f64 / k })
}

/// 모니터 목록 + 앱 창 모니터 + 배지 창 자리 — 화면이 자리를 계산한다
#[tauri::command]
pub fn bubble_screens(app_handle: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Screens, String> {
    if window.label() != LABEL {
        return Err("bubble window only".into());
    }
    let mons = window.available_monitors().map_err(|e| e.to_string())?;
    let screens: Vec<Screen> = mons.iter().enumerate().map(|(i, m)| screen_of(m, i)).collect();
    let app = app_handle.get_webview_window("main").and_then(|m| m.current_monitor().ok().flatten()).and_then(|cur| {
        mons.iter().enumerate().find(|(_, m)| m.position() == cur.position() && m.size() == cur.size()).map(|(i, m)| screen_of(m, i).id)
    });
    let out = Screens { screens, app, win: rect_of(&window) };
    if cfg!(debug_assertions) {
        crate::claude::log_out("bubble", &format!("screens {:?} app {:?} win {:?}", out.screens, out.app, out.win));
    }
    Ok(out)
}

/// 배지 창 자리·크기(논리 px) — key = 대화창(글을 칠 수 있게), radius = 둥근 모서리(배지 = 동그라미)
#[tauri::command]
pub fn bubble_place(window: tauri::WebviewWindow, x: f64, y: f64, w: f64, h: f64, key: bool, radius: f64) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("bubble window only".into());
    }
    if ![x, y, w, h, radius].iter().all(|v| v.is_finite()) || !(32.0..=1200.0).contains(&w) || !(32.0..=1600.0).contains(&h) {
        return Err("bad size".into());
    }
    if cfg!(debug_assertions) {
        crate::claude::log_out("bubble", &format!("place {x},{y} {w}x{h} key={key}"));
    }
    KEYABLE.store(key, Ordering::SeqCst);
    let _ = window.set_size(tauri::LogicalSize::new(w, h));
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    round(&window, radius);
    #[cfg(target_os = "macos")]
    keyable(&window, key);
    #[cfg(not(target_os = "macos"))]
    {
        // 윈도우: 배지일 땐 눌러도 활성화 안 됨(WS_EX_NOACTIVATE), 대화창일 땐 글 칠 수 있게
        let _ = window.set_focusable(key);
        if key {
            let _ = window.set_focus();
        }
    }
    Ok(())
}

/// 배지 창을 보이기(포커스 안 뺏음) — 화면이 자리를 잡은 뒤에 부른다
#[tauri::command]
pub fn bubble_reveal(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("bubble window only".into());
    }
    if WANTED.load(Ordering::SeqCst) && HAS_FACE.load(Ordering::SeqCst) {
        reveal(&window);
    }
    Ok(())
}

/// 화면이 그릴 얼굴이 있나 알린다 — 없으면 창을 내리고, 생기면 띄울 때면 다시 보인다
#[tauri::command]
pub fn bubble_face(window: tauri::WebviewWindow, has: bool) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("bubble window only".into());
    }
    let was = HAS_FACE.swap(has, Ordering::SeqCst);
    if !has && was {
        KEYABLE.store(false, Ordering::SeqCst);
        let _ = window.hide();
    }
    Ok(())
}

/// 지금 바탕 배지를 띄울 때인가 — 창이 막 만들어져 eval 을 놓친 화면이 켜지며 묻는다
#[tauri::command]
pub fn bubble_wanted(window: tauri::WebviewWindow) -> bool {
    window.label() == LABEL && WANTED.load(Ordering::SeqCst)
}

/// 배지 끌기 — 테두리 없는 창이라 맥·윈도우 창 끌기를 그대로(놓으면 Moved 사건 → 화면이 자리를 기억)
#[tauri::command]
pub fn bubble_drag(window: tauri::WebviewWindow) {
    if window.label() == LABEL {
        let _ = window.start_dragging();
    }
}

/// 받는 자리·올림 자리를 바꾼다(창 기준 논리 px) — 화면이 배치를 바꿀 때마다
#[tauri::command]
pub fn bubble_hot(window: tauri::WebviewWindow, hot: Vec<[f64; 4]>, hover: Vec<[f64; 4]>) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("bubble window only".into());
    }
    if hot.len() > 32 || hover.len() > 32 || hot.iter().chain(hover.iter()).flatten().any(|v| !v.is_finite()) {
        return Err("bad rects".into());
    }
    *HOT.lock().unwrap_or_else(|e| e.into_inner()) = hot;
    *HOVER.lock().unwrap_or_else(|e| e.into_inner()) = hover;
    Ok(())
}

/// 전역 마우스 점 → 창 안 점(창 밖이면 None)
pub fn local(m: (f64, f64), w: &Screen) -> Option<(f64, f64)> {
    let (x, y) = (m.0 - w.x, m.1 - w.y);
    (x >= 0.0 && y >= 0.0 && x < w.w && y < w.h).then_some((x, y))
}

/// 그 점이 자리 중 하나 안인가
pub fn hit(p: (f64, f64), rects: &[[f64; 4]]) -> bool {
    rects.iter().any(|r| p.0 >= r[0] && p.1 >= r[1] && p.0 < r[0] + r[2] && p.1 < r[1] + r[3])
}

/// 마우스 따라가기(40ms) — 받는 자리 밖이면 클릭을 바탕으로 넘기고, 올림 자리에 들고 나면 화면에 __bubbleHover
fn track(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let (mut through, mut over, mut at) = (false, false, None::<(i32, i32)>);
        loop {
            std::thread::sleep(Duration::from_millis(40));
            let Some(w) = app.get_webview_window(LABEL) else { continue };
            if !w.is_visible().unwrap_or(false) {
                std::thread::sleep(Duration::from_millis(300));
                continue;
            }
            let (Some(win), Ok(k)) = (rect_of(&w), w.scale_factor()) else { continue };
            let Some(m) = mouse(k) else { continue };
            let p = local(m, &win);
            let hot = HOT.lock().unwrap_or_else(|e| e.into_inner()).clone();
            let pass = !p.is_some_and(|p| hot.is_empty() || hit(p, &hot));
            if pass != through {
                through = pass;
                let _ = w.set_ignore_cursor_events(pass);
            }
            // 창 안 마우스 자리 — 화면이 그 자리 요소에 hot(별명 툴팁)을 붙인다(비활성 패널은 :hover 가 안 올 수 있다). 밖이면 -1
            let now = p.map(|p| (p.0 as i32, p.1 as i32));
            if now != at {
                at = now;
                let (x, y) = now.unwrap_or((-1, -1));
                let _ = w.eval(format!("window.__bubbleMouse && window.__bubbleMouse({x}, {y})"));
            }
            let on = p.is_some_and(|p| hit(p, &HOVER.lock().unwrap_or_else(|e| e.into_inner())));
            if on != over {
                over = on;
                let _ = w.eval(format!("window.__bubbleHover && window.__bubbleHover({on})"));
            }
        }
    });
}

/// 물리 px 점 → 창 배율(k)로 나눈 논리 점 — rect_of 와 같은 단위(창 물리 자리 / k)라 local 에 그대로 넣는다
#[cfg_attr(not(windows), allow(dead_code))]
pub fn phys_to_logical(p: (i32, i32), k: f64) -> (f64, f64) {
    (p.0 as f64 / k, p.1 as f64 / k)
}

/// 전역 마우스 점(rect_of 와 같은 단위, k = 배지 창 배율) — 디버그 빌드는 CHAMMO_BUBBLE_FAKE_MOUSE 파일("x,y")로 대신(시험이 사람 커서를 안 움직이게)
fn mouse(k: f64) -> Option<(f64, f64)> {
    if cfg!(debug_assertions) {
        if let Ok(f) = std::env::var("CHAMMO_BUBBLE_FAKE_MOUSE") {
            let t = std::fs::read_to_string(f).ok()?;
            let (x, y) = t.trim().split_once(',')?;
            return Some((x.trim().parse().ok()?, y.trim().parse().ok()?));
        }
    }
    // 맥: CGEvent 자리가 이미 논리 점
    #[cfg(target_os = "macos")]
    {
        let _ = k;
        crate::vdisplay::cursor()
    }
    // 윈도우: GetCursorPos 는 물리 px(앱이 모니터별 DPI 인식) — 창 배율로 나눈다
    #[cfg(windows)]
    {
        let mut pt = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
        (unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut pt) } != 0).then(|| phys_to_logical((pt.x, pt.y), k))
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = k;
        None
    }
}

/// 바탕 대화창에서 보내기 — 폰 보내기(/api/send)와 같은 길·같은 범위: 참모(HQ 폴더 세션)에게만, 제어 문자 빼고, 8,000자까지
#[tauri::command]
pub async fn bubble_send(window: tauri::WebviewWindow, id: String, text: String) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("bubble window only".into());
    }
    let text = clean_text(&text).ok_or_else(|| crate::i18n::tr("보낼 글이 비었거나 너무 길어", "Empty or too long").to_string())?;
    if !orch_id_ok(&id) {
        return Err("bad assistant id".into());
    }
    hq_only(&id).await?;
    crate::claude::send_text_to_session(id, text).await
}

/// 그 세션이 참모(HQ 폴더 세션)인가 — 바탕 대화창이 글·키·화면을 다루는 범위(폰과 같다)
async fn hq_only(id: &str) -> Result<(), String> {
    if !orch_id_ok(id) {
        return Err("bad assistant id".into());
    }
    let sessions = tauri::async_runtime::spawn_blocking(crate::claude::agents_json).await.map_err(|e| e.to_string())??;
    let hq = crate::config::hq_dir(&crate::config::home(), &crate::config::current(), |k| std::env::var(k).ok());
    if !is_hq_session(&sessions, id, &hq) {
        return Err(crate::i18n::tr("참모에게만 보낼 수 있어", "Only to an assistant").into());
    }
    Ok(())
}

/// 대화창이 넣는 키 — 짧은 것(Esc·화살표·Enter·Ctrl+V) 12개까지
pub fn keys_ok(keys: &[String]) -> bool {
    !keys.is_empty() && keys.len() <= 12 && keys.iter().all(|k| !k.is_empty() && k.len() <= 16)
}

/// 바탕 대화창 키 — 메인 참모 채팅 칸이 터미널에 넣는 것과 같은 키를 그 세션에 잠깐 붙어 넣는다(Esc = 멈춤, Ctrl+V = 클립보드 그림, 화살표·Enter = 선택지). 참모에게만
#[tauri::command]
pub async fn bubble_keys(window: tauri::WebviewWindow, id: String, keys: Vec<String>) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("bubble window only".into());
    }
    if !keys_ok(&keys) {
        return Err("bad keys".into());
    }
    hq_only(&id).await?;
    if keys.len() == 1 && keys[0] == "\u{1b}" {
        // 멈춤은 글 치기와 같은 잠금을 잡는 길로(치던 글 사이에 Esc 가 끼지 않게)
        return tauri::async_runtime::spawn_blocking(move || crate::claude::interrupt_session(&id)).await.map_err(|e| e.to_string())?;
    }
    for (i, k) in keys.into_iter().enumerate() {
        if i > 0 {
            tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(120))).await.map_err(|e| e.to_string())?;
        }
        crate::claude::send_keys(id.clone(), k).await?;
    }
    Ok(())
}

/// 바탕 대화창 화면 글자 — 선택지 창을 읽으려고(세션이 물을 때만 부른다). 참모에게만
#[tauri::command]
pub async fn bubble_screen(window: tauri::WebviewWindow, id: String) -> Result<String, String> {
    if window.label() != LABEL {
        return Err("bubble window only".into());
    }
    hq_only(&id).await?;
    crate::claude::session_screen(id).await
}

/// 앱 조작 중 바탕 대화창이 쓰는 것 — 음성 모드 켜고 끄기·모델 바꾸기(메인 창 __appctl, 폰과 같은 길)
pub fn appctl_ok(action: &str, arg: &serde_json::Value) -> bool {
    match action {
        "voice" => matches!(arg.as_str(), Some("on" | "off")),
        "model-pick" => arg["id"].as_str().is_some_and(orch_id_ok),
        _ => false,
    }
}

#[tauri::command]
pub fn bubble_appctl(app_handle: tauri::AppHandle, window: tauri::WebviewWindow, action: String, arg: serde_json::Value) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("bubble window only".into());
    }
    if !appctl_ok(&action, &arg) {
        return Err("bad action".into());
    }
    let w = app_handle.get_webview_window("main").ok_or("no main window")?;
    let line = serde_json::json!({ "action": action, "arg": arg });
    w.eval(format!("window.__appctl && window.__appctl({line})")).map_err(|e| e.to_string())
}

/// 보낼 글 — 키처럼 쳐지니 ESC·Ctrl+C 같은 제어 문자는 빼고 줄바꿈·탭만(폰 /api/send 와 같다). 비었거나 8,000자 넘으면 None
pub fn clean_text(t: &str) -> Option<String> {
    let s: String = t.chars().filter(|c| !c.is_control() || *c == '\n' || *c == '\t').collect();
    (!s.trim().is_empty() && s.chars().count() <= 8_000).then_some(s)
}

/// 그 세션이 HQ 폴더에서 도는 참모인가
pub fn is_hq_session(sessions_json: &str, id: &str, hq: &str) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(sessions_json) else { return false };
    v.as_array().and_then(|l| l.iter().find(|a| a["id"] == id)).and_then(|a| a["cwd"].as_str()).is_some_and(|cwd| crate::platform::same_dir(cwd, hq))
}

/// 설정·메인 창을 지켜보다 띄울 때면 바탕 배지를, 아니면 거둔다(0.7초마다 — 창 사건만으론 ⌘H·창 닫기·최소화를 다 못 잡는다)
pub fn watch(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut was = false;
        loop {
            std::thread::sleep(Duration::from_millis(700));
            let f = crate::config::current().features;
            let Some(main) = app.get_webview_window("main") else { continue };
            let seen = main.is_visible().unwrap_or(true) && !main.is_minimized().unwrap_or(false);
            let want = desk_shown(f.bubble, f.bubble_desk, seen);
            if want == was {
                continue;
            }
            was = want;
            WANTED.store(want, Ordering::SeqCst);
            if want {
                show(&app);
            } else if let Some(w) = app.get_webview_window(LABEL) {
                KEYABLE.store(false, Ordering::SeqCst);
                let _ = w.hide();
            }
        }
    });
}

/// 바탕 배지를 끌어 옮겼다 — 화면이 모니터·비율로 기억한다(domain/orchBubble screenSave)
pub fn moved(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.eval("window.__bubbleMoved && window.__bubbleMoved()");
    }
}

/// 바탕 배지 창 — 없으면 만들고, 화면에게 자리를 잡으라고(__bubbleShow). 화면이 자리를 잡고 bubble_reveal 로 보인다
fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.eval("window.__bubbleShow && window.__bubbleShow()");
        return;
    }
    let b = tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::App("bubble.html".into()))
        .title("Chammo")
        .inner_size(72.0, 72.0)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        .accept_first_mouse(true)
        .visible(false);
    // 윈도우: 창(DWM)·WebView2 바탕을 투명하게 — 맥은 panelize 가 끈다. 안 끄면 배지 둘레가 창 크기만큼 흰·검은 네모로 보였다(10-30 사용자)
    #[cfg(not(target_os = "macos"))]
    let b = b.focusable(false).transparent(true);
    match b.build() {
        Ok(w) => {
            panelize(app, &w);
            track(app.clone());
        }
        Err(e) => crate::claude::log_out("bubble", &format!("window: {e}")),
    }
}

/// 보이기 — 맥은 orderFrontRegardless(키 창도 안 되고 앱도 안 깨움), 그 밖은 show
fn reveal(w: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let Ok(p) = w.ns_window() else { return };
        let p = p as usize;
        let _ = w.run_on_main_thread(move || unsafe {
            let _: () = objc2::msg_send![p as *mut objc2::runtime::AnyObject, orderFrontRegardless];
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = w.show();
    }
}

/// 맥: 대화창이면 키 창으로(글을 칠 수 있게) — 비활성 패널이라 앱은 안 깨고 키 입력만 받는다. becomesKeyOnlyIfNeeded 인 채로는
/// 웹뷰 글칸을 눌러도 키 창이 안 된다(WKWebView 가 needsPanelToBecomeKey 를 안 켬). 배지로 돌아가면 키를 내려놓아 하던 앱이 다시 받는다
#[cfg(target_os = "macos")]
fn keyable(w: &tauri::WebviewWindow, key: bool) {
    let Ok(p) = w.ns_window() else { return };
    let p = p as usize;
    let _ = w.run_on_main_thread(move || unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyObject, Bool};
        let win = p as *mut AnyObject;
        let _: () = msg_send![win, setBecomesKeyOnlyIfNeeded: !key];
        let is_key: Bool = msg_send![win, isKeyWindow];
        if key {
            let _: () = msg_send![win, makeKeyWindow];
        } else if is_key.as_bool() {
            let _: () = msg_send![win, resignKeyWindow];
        }
        if cfg!(debug_assertions) {
            let now: Bool = msg_send![win, isKeyWindow];
            crate::claude::log_out("bubble", &format!("key want={key} was={} now={}", is_key.as_bool(), now.as_bool()));
        }
    });
}

/// 둥근 창 — 맥은 내용 층을 깎는다(사설 API 없이 투명하게). 윈도우는 네모 그대로(다음에 DWM 둥근 모서리)
fn round(w: &tauri::WebviewWindow, radius: f64) {
    #[cfg(target_os = "macos")]
    {
        let Ok(p) = w.ns_window() else { return };
        let p = p as usize;
        let _ = w.run_on_main_thread(move || unsafe {
            use objc2::msg_send;
            use objc2::runtime::AnyObject;
            let win = p as *mut AnyObject;
            let view: *mut AnyObject = msg_send![win, contentView];
            if view.is_null() {
                return;
            }
            let _: () = msg_send![view, setWantsLayer: true];
            let layer: *mut AnyObject = msg_send![view, layer];
            if !layer.is_null() {
                let _: () = msg_send![layer, setCornerRadius: radius];
                let _: () = msg_send![layer, setMasksToBounds: radius > 0.0]; // 0 = 깎지 않음(배지·부채는 투명 창 위에 그린다)
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (w, radius);
}

/// 맥: tao 창을 비활성 패널로 — 눌러도 앱이 안 깨고(⌘H 로 숨긴 본창이 안 따라 나옴), ⌘H 에도 안 숨고, 전체 화면 앱 위엔 안 뜬다
/// (모든 데스크톱에 있되 FullScreenAuxiliary 는 안 줌). 키 창은 대화창일 때만(KEYABLE)
#[cfg(target_os = "macos")]
fn panelize(app: &tauri::AppHandle, w: &tauri::WebviewWindow) {
    let Ok(p) = w.ns_window() else { return };
    let p = p as usize;
    let _ = app.run_on_main_thread(move || unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
        use objc2::{class, sel};
        static CLS: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
        extern "C" fn can_key(_: *mut AnyObject, _: Sel) -> Bool {
            Bool::new(KEYABLE.load(Ordering::SeqCst))
        }
        extern "C" fn no(_: *mut AnyObject, _: Sel) -> Bool {
            Bool::NO
        }
        let cls = *CLS.get_or_init(|| {
            let mut b = ClassBuilder::new(c"ChammoBubblePanel", class!(NSPanel)).expect("panel class");
            b.add_method(sel!(canBecomeKeyWindow), can_key as extern "C" fn(_, _) -> _);
            b.add_method(sel!(canBecomeMainWindow), no as extern "C" fn(_, _) -> _);
            b.register() as *const AnyClass as usize
        });
        let win = p as *mut AnyObject;
        objc2::ffi::object_setClass(win as *mut _, cls as *const AnyClass);
        let mask: usize = msg_send![win, styleMask];
        let _: () = msg_send![win, setStyleMask: mask | (1 << 7)]; // NSWindowStyleMaskNonactivatingPanel
        let _: () = msg_send![win, setFloatingPanel: true];
        let _: () = msg_send![win, setBecomesKeyOnlyIfNeeded: true];
        let _: () = msg_send![win, setHidesOnDeactivate: false];
        let _: () = msg_send![win, setCanHide: false];
        // CanJoinAllSpaces(1) | IgnoresCycle(1<<6) — FullScreenAuxiliary(1<<8) 는 안 준다: 전체 화면 앱 위엔 안 뜬다
        let _: () = msg_send![win, setCollectionBehavior: (1usize) | (1 << 6)];
        let _: () = msg_send![win, setOpaque: false];
        let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![win, setBackgroundColor: clear];
    });
    // 이 창 웹뷰만 흰 바탕을 끈다(wry 투명 기능과 같은 drawsBackground — 앱 전체 macOS 사설 API 설정은 안 켠다). 배지·부채 밖은 바탕 화면이 보인다
    let _ = w.with_webview(|wv| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let v = wv.inner() as *mut AnyObject;
        if v.is_null() {
            return;
        }
        let no: *mut AnyObject = msg_send![objc2::class!(NSNumber), numberWithBool: false];
        let key = objc2_foundation::NSString::from_str("drawsBackground");
        let _: () = msg_send![v, setValue: no, forKey: &*key];
    });
}

#[cfg(not(target_os = "macos"))]
fn panelize(_: &tauri::AppHandle, _: &tauri::WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 마우스_자리는_창_안_점으로_바꾸고_밖이면_none() {
        let w = Screen { id: String::new(), x: 100.0, y: 200.0, w: 108.0, h: 108.0 };
        assert_eq!(local((110.0, 250.0), &w), Some((10.0, 50.0)));
        assert_eq!(local((99.0, 250.0), &w), None);
        assert_eq!(local((150.0, 308.5), &w), None);
    }

    #[test]
    fn 윈도우_물리_커서는_창_배율로_나눠_창_안_점과_맞춘다() {
        // 150% 화면 — 창 물리 (1500,750) 108x108 = 논리 (1000,500) 72x72. 물리 커서 (1530,780) 은 창 안 (20,20)
        let k = 1.5;
        let w = Screen { id: String::new(), x: 1500.0 / k, y: 750.0 / k, w: 108.0 / k, h: 108.0 / k };
        assert_eq!(local(phys_to_logical((1530, 780), k), &w), Some((20.0, 20.0)));
        assert_eq!(local(phys_to_logical((1499, 780), k), &w), None);
        assert_eq!(phys_to_logical((-300, 40), 1.0), (-300.0, 40.0)); // 왼쪽 모니터는 음수
    }

    #[test]
    fn 받는_자리_안이면_클릭을_받고_아니면_아래로_지나간다() {
        let hot = [[28.0, 20.0, 52.0, 52.0], [0.0, 0.0, 10.0, 10.0]];
        assert!(hit((30.0, 30.0), &hot));
        assert!(hit((5.0, 5.0), &hot));
        assert!(!hit((15.0, 15.0), &hot)); // 배지 원 밖 투명 여백
        assert!(!hit((30.0, 30.0), &[]));
    }

    #[test]
    fn 대화창_키는_짧은_것_몇_개만() {
        assert!(keys_ok(&["\u{1b}".into()]));
        assert!(keys_ok(&["\u{1b}[B".into(), "\r".into()]));
        assert!(!keys_ok(&[]));
        assert!(!keys_ok(&["a".repeat(17)]));
        assert!(!keys_ok(&vec!["\r".to_string(); 13]));
    }

    #[test]
    fn 앱_조작은_음성_모드와_모델_바꾸기만() {
        assert!(appctl_ok("voice", &serde_json::json!("on")));
        assert!(appctl_ok("voice", &serde_json::json!("off")));
        assert!(!appctl_ok("voice", &serde_json::json!("loud")));
        assert!(appctl_ok("model-pick", &serde_json::json!({ "id": "aaaa1111", "model": "sonnet" })));
        assert!(!appctl_ok("model-pick", &serde_json::json!({ "id": "a'); x('" })));
        assert!(!appctl_ok("stop", &serde_json::json!({})));
    }

    #[test]
    fn 참모_id_는_영숫자_빼기_밑줄만() {
        assert!(orch_id_ok("aaaa1111"));
        assert!(orch_id_ok("5c2e-9_x"));
        assert!(!orch_id_ok(""));
        assert!(!orch_id_ok("a'); alert(1); ('"));
        assert!(!orch_id_ok("참모"));
        assert!(!orch_id_ok(&"a".repeat(65)));
    }

    #[test]
    fn 배지는_늘_바탕_배지_창_하나_앱_창이_보여도() {
        // 앱 안 배지는 없다 — 앱 창이 보이든 내려가든 같은 바탕 배지 하나(10-28 사용자 "별도로 둥둥 … 하나만")
        assert!(desk_shown(true, true, true));
        assert!(desk_shown(true, true, false));
        assert!(desk_shown(true, false, true)); // '앱을 내려도' 를 꺼도 앱 창이 보이는 동안은 떠 있다
        assert!(!desk_shown(true, false, false)); // 끈 채 앱을 내리면 같이 내려간다
        assert!(!desk_shown(false, true, true)); // 배지를 끄면 어디에도 없음
        assert!(!desk_shown(false, true, false));
    }

    #[test]
    fn 화면_자리는_작업_영역_이름은_모니터_자리() {
        // 맥북(2배): 모니터 (0,0) 3024x1964, 작업 영역은 메뉴줄 25점·독 70점을 뺀 것 — 배지가 독·메뉴줄 밑에 깔리지 않게
        let s = screen_rect("Built-in".into(), (0, 0), (0, 50, 3024, 1774), 2.0);
        assert_eq!(s, Screen { id: "Built-in@0,0".into(), x: 0.0, y: 25.0, w: 1512.0, h: 887.0 });
    }

    #[test]
    fn 부를_수_있는_창은_메인_메신저_바탕_배지() {
        assert!(caller_ok("main"));
        assert!(caller_ok(LABEL));
        assert!(!caller_ok("tama"));
        assert!(!caller_ok("reader"));
    }

    #[test]
    fn 보낼_글은_제어_문자_빼고_8000자까지() {
        assert_eq!(clean_text("안녕\u{1b}[A\n다음").as_deref(), Some("안녕[A\n다음"));
        assert_eq!(clean_text("  \n"), None);
        assert!(clean_text(&"가".repeat(8_000)).is_some());
        assert!(clean_text(&"가".repeat(8_001)).is_none());
    }

    #[test]
    fn hq_폴더_세션에게만_보낸다() {
        let s = r#"[{"id":"aaaa1111","cwd":"/H/hq"},{"id":"bbbb2222","cwd":"/H/dev/shop-app"}]"#;
        assert!(is_hq_session(s, "aaaa1111", "/H/hq"));
        assert!(is_hq_session(s, "aaaa1111", "/H/hq/"));
        assert!(!is_hq_session(s, "bbbb2222", "/H/hq"));
        assert!(!is_hq_session(s, "cccc3333", "/H/hq"));
        assert!(!is_hq_session("깨짐", "aaaa1111", "/H/hq"));
    }
}
