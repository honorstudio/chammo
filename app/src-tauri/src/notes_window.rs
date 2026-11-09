//! 내 메모 따로 창(notes.html?n=<메모>) — 메모 한 장 = 창 하나(시안 v2 W, 맥 스티커 메모처럼). 라벨은 notes-<이름 해시>.
//! 창 자리·크기는 메타(notes/.meta.json frame)에 기억하고, 모니터가 바뀌어 화면 밖이면 메인 창 옆으로 옮긴다.
//! 빨간 신호등 = 그 메모를 내린다(shown=false). 패널로 되돌리기 = win=false. 메인 창엔 __notesClosed({dock, left})로 알린다
use crate::team_window::Screen;
use tauri::{Manager, Runtime};

pub const PREFIX: &str = "notes-";
const DEFAULT_W: f64 = 340.0;
const DEFAULT_H: f64 = 380.0;

pub fn is_notes(label: &str) -> bool {
    label.starts_with(PREFIX)
}

/// 메모 이름 → 창 라벨(라벨엔 한글·점을 못 쓴다) — FNV-1a 64
pub fn label_of(name: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in name.bytes() {
        h = (h ^ b as u64).wrapping_mul(0x100000001b3);
    }
    format!("{PREFIX}{h:016x}")
}

/// 띄울 자리(논리 x, y, 폭, 높이) — 기억한 자리의 왼쪽 위가 어느 화면 안이면 그대로, 아니면 메인 창 옆에 i 번째만큼 비켜서
pub fn place(frame: Option<[f64; 4]>, screens: &[Screen], main_at: (f64, f64), i: usize) -> [f64; 4] {
    let holds = |x: f64, y: f64| screens.iter().any(|s| x >= s.x as f64 && y >= s.y as f64 && x < (s.x + s.w as i32) as f64 - 40.0 && y < (s.y + s.h as i32) as f64 - 40.0);
    if let Some([x, y, w, h]) = frame.filter(|f| holds(f[0], f[1])) {
        return [x, y, w.max(240.0), h.max(200.0)];
    }
    let step = 28.0 * i as f64;
    [main_at.0 + 60.0 + step, main_at.1 + 80.0 + step, DEFAULT_W, DEFAULT_H]
}

fn name_of(label: &str) -> Option<String> {
    let dir = crate::notes::dir();
    crate::notes::list_in(&dir, crate::notes::now_ms()).ok()?.into_iter().map(|r| r.name).find(|n| label_of(n) == label)
}

fn left<R: Runtime>(app: &tauri::AppHandle<R>, except: &str) -> usize {
    app.webview_windows().keys().filter(|l| is_notes(l) && l.as_str() != except).count()
}

fn tell_main<R: Runtime>(app: &tauri::AppHandle<R>, dock: bool, except: &str) {
    crate::craft_window::to_main(app, "__notesClosed", serde_json::json!({ "dock": dock, "left": left(app, except) }));
}

fn open_one<R: Runtime>(app: &tauri::AppHandle<R>, name: &str, i: usize) -> Result<(), String> {
    let lb = label_of(name);
    if let Some(w) = app.get_webview_window(&lb) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let frame = crate::notes::frame_in(&crate::notes::dir(), name);
    let main_at = app.get_webview_window("main").and_then(|m| Some(m.outer_position().ok()?.to_logical::<f64>(m.scale_factor().ok()?))).map(|p| (p.x, p.y)).unwrap_or((80.0, 80.0));
    let [x, y, w, h] = place(frame, &crate::team_window::screens_of(app), main_at, i);
    let url = format!("notes.html?n={}", percent_encoding::utf8_percent_encode(name, percent_encoding::NON_ALPHANUMERIC));
    let b = tauri::WebviewWindowBuilder::new(app, &lb, tauri::WebviewUrl::App(url.into()))
        .title(crate::i18n::tr("내 메모", "My notes"))
        .inner_size(w, h)
        .position(x, y)
        .min_inner_size(240.0, 200.0)
        .accept_first_mouse(true) // 다른 창을 쓰다가 머리를 바로 잡아 끌 수 있게 — 끄면 첫 누름이 창 활성화에 먹힌다
        .visible(false);
    // 맥은 머리줄을 웹 안으로 — 스킨 머리가 창 머리가 된다(신호등만 위에)
    #[cfg(target_os = "macos")]
    let b = b.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    let win = b.build().map_err(|e| e.to_string())?;
    if frame.is_none() {
        crate::debug::place_near_main(app, &win); // 개발판은 메인 창 옆 화면으로 — 시험 창이 사람 화면에 번쩍이지 않게
    }
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/// 띄운다 — name 이면 그 메모, 없으면 띄운 메모를 다(없으면 맨 위 메모, 그것도 없으면 새로). 연 메모는 win=true(패널엔 안 쌓는다).
/// async: 윈도우는 동기 명령 안에서 웹뷰 창을 만들면 교착된다(team_window_open 과 같은 이유)
#[tauri::command]
pub async fn notes_window_open<R: Runtime>(app: tauri::AppHandle<R>, name: Option<String>) -> Result<(), String> {
    let names = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
        let dir = crate::notes::dir();
        let now = crate::notes::now_ms();
        let names = match name {
            Some(n) => vec![n],
            None => {
                let rows = crate::notes::list_in(&dir, now)?;
                let shown: Vec<String> = rows.iter().filter(|r| r.shown).map(|r| r.name.clone()).collect();
                if !shown.is_empty() { shown } else { vec![rows.first().map(|r| r.name.clone()).map_or_else(|| crate::notes::create_in(&dir, now).map(|r| r.name), Ok)?] }
            }
        };
        for n in &names {
            crate::notes::meta_in(&dir, n, &crate::notes::MetaPatch { shown: Some(true), win: Some(true), ..Default::default() })?;
        }
        Ok(names)
    })
    .await
    .map_err(|e| e.to_string())??;
    for (i, n) in names.iter().enumerate() {
        open_one(&app, n, i)?;
    }
    Ok(())
}

/// 창 머리 '패널로 되돌리기'(dock) · 없는 메모라 그냥 닫기 — 부른 창만. destroy 라 아래 closed(내리기)가 안 돈다
/// async: 메모 읽기·쓰기는 메인 스레드 밖에서(offmain_scan). 메인 창에 알리는 건 쓴 뒤라 패널이 새 값을 읽는다
#[tauri::command]
pub async fn notes_window_close<R: Runtime>(app: tauri::AppHandle<R>, window: tauri::WebviewWindow<R>, dock: bool) {
    let lb = window.label().to_string();
    if !is_notes(&lb) {
        return;
    }
    if dock {
        if let Some(n) = name_of(&lb) {
            let _ = tauri::async_runtime::spawn_blocking(move || {
                crate::notes::meta_in(&crate::notes::dir(), &n, &crate::notes::MetaPatch { win: Some(false), ..Default::default() })
            })
            .await;
        }
    }
    tell_main(&app, dock, &lb);
    let _ = window.destroy();
}

/// ⌘⇧M 을 따로 창에서 — 창을 다 접는다(띄움은 그대로, 다음 ⌘⇧M 에 다시 뜬다)
pub fn close_all<R: Runtime>(app: &tauri::AppHandle<R>) {
    let ws: Vec<_> = app.webview_windows().into_iter().filter(|(l, _)| is_notes(l)).map(|(_, w)| w).collect();
    crate::craft_window::to_main(app, "__notesClosed", serde_json::json!({ "dock": false, "left": 0 }));
    for w in ws {
        let _ = w.destroy();
    }
}

/// 빨간 신호등 — 그 메모를 내린다(shown=false, 메모는 그대로)
pub fn closed<R: Runtime>(w: &tauri::Window<R>) {
    let lb = w.label().to_string();
    save_frame(w);
    if let Some(n) = name_of(&lb) {
        let _ = crate::notes::meta_in(&crate::notes::dir(), &n, &crate::notes::MetaPatch { shown: Some(false), win: Some(false), ..Default::default() });
    }
    tell_main(w.app_handle(), false, &lb);
}

fn save_frame<R: Runtime>(w: &tauri::Window<R>) {
    let (Ok(sf), Ok(p), Ok(z)) = (w.scale_factor(), w.outer_position(), w.inner_size()) else { return };
    let (p, z) = (p.to_logical::<f64>(sf), z.to_logical::<f64>(sf));
    if let Some(n) = name_of(w.label()) {
        let _ = crate::notes::meta_in(&crate::notes::dir(), &n, &crate::notes::MetaPatch { frame: Some([p.x, p.y, z.width, z.height]), ..Default::default() });
    }
}

/// 움직이거나 크기를 바꾸면 자리를 기억 — 끄는 동안 쏟아지는 이벤트는 0.4초 조용해진 뒤 한 번만 쓴다
pub fn moved<R: Runtime>(w: &tauri::Window<R>) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static GEN: AtomicU64 = AtomicU64::new(0);
    let g = GEN.fetch_add(1, Ordering::Relaxed) + 1;
    let w = w.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        if GEN.load(Ordering::Relaxed) == g {
            save_frame(&w);
        }
    });
}

/// 지금 앞에 있는 창이 메모 창인가 — ⌘⇧M 을 그 창에서 누르면 메인 창을 끌어오지 않고 접는다
pub fn focused<R: Runtime>(app: &tauri::AppHandle<R>) -> bool {
    app.webview_windows().iter().any(|(l, w)| is_notes(l) && w.is_focused().unwrap_or(false))
}

#[tauri::command]
pub fn notes_window_pin<R: Runtime>(window: tauri::WebviewWindow<R>, on: bool) -> Result<(), String> {
    if !is_notes(window.label()) {
        return Err("notes window only".into());
    }
    window.set_always_on_top(on).map_err(|e| e.to_string())
}

/// 머리 끌기 — 맥은 머리가 웹뷰라(Overlay) 웹이 직접 시작한다. 권한 파일 없이 되게 앱 명령으로(tama_drag 와 같은 길)
#[tauri::command]
pub fn notes_window_drag<R: Runtime>(window: tauri::WebviewWindow<R>) {
    if is_notes(window.label()) {
        let _ = window.start_dragging();
    }
}

#[derive(Debug, PartialEq)]
pub enum DoubleClick {
    Zoom,
    Minimize,
    Nothing,
}

/// 맥 '제목 막대를 이중 클릭하면'(시스템 설정 > 데스크탑 및 Dock) — AppleActionOnDoubleClick: 없음·Maximize·Fill = 확대, Minimize, None.
/// 그 키가 없으면 옛 키 AppleMiniaturizeOnDoubleClick(참 = 최소화)
pub fn double_click_of(action: Option<&str>, legacy_mini: Option<bool>) -> DoubleClick {
    match action {
        Some("Minimize") => DoubleClick::Minimize,
        Some("None") => DoubleClick::Nothing,
        Some(_) => DoubleClick::Zoom,
        None if legacy_mini == Some(true) => DoubleClick::Minimize,
        None => DoubleClick::Zoom,
    }
}

/// 맥 설정을 누를 때마다 읽는다(앱을 켠 채 설정을 바꿔도 따른다). 윈도우는 제목줄 더블클릭 = 최대화
fn double_click() -> DoubleClick {
    #[cfg(target_os = "macos")]
    {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        use objc2_foundation::NSString;
        unsafe {
            let d: *mut AnyObject = msg_send![class!(NSUserDefaults), standardUserDefaults];
            let Some(d) = d.as_ref() else { return DoubleClick::Zoom };
            let s: *mut NSString = msg_send![d, stringForKey: &*NSString::from_str("AppleActionOnDoubleClick")];
            let action = s.as_ref().map(|s| s.to_string());
            let mini = NSString::from_str("AppleMiniaturizeOnDoubleClick");
            let has: *mut AnyObject = msg_send![d, objectForKey: &*mini];
            let legacy = if has.is_null() { None } else { Some(msg_send![d, boolForKey: &*mini]) };
            double_click_of(action.as_deref(), legacy)
        }
    }
    #[cfg(not(target_os = "macos"))]
    DoubleClick::Zoom
}

/// 머리 더블클릭 — 맥 설정대로 확대(다시 누르면 되돌림)·최소화·안 함
#[tauri::command]
pub fn notes_window_double<R: Runtime>(window: tauri::WebviewWindow<R>) {
    if !is_notes(window.label()) {
        return;
    }
    match double_click() {
        DoubleClick::Zoom => {
            let _ = if window.is_maximized().unwrap_or(false) { window.unmaximize() } else { window.maximize() };
        }
        DoubleClick::Minimize => {
            let _ = window.minimize();
        }
        DoubleClick::Nothing => {}
    }
}

/// 따로 창의 '보여 주기' — 메인 창 지금 칸 입력칸에 파일 참조. 사람이 ⋯ 를 눌렀을 때만 온다(창 화면 → 여기 → 메인 __notesShare → notes_share_done)
#[tauri::command]
pub async fn notes_share<R: Runtime>(app: tauri::AppHandle<R>, name: String) -> Result<(), String> {
    let p = tauri::async_runtime::spawn_blocking(move || crate::notes::note_file(&crate::notes::dir(), &name)).await.map_err(|e| e.to_string())??;
    crate::craft_window::to_main(&app, "__notesShare", serde_json::json!(p.to_string_lossy()));
    Ok(())
}

/// 따로 창의 보내기 아이콘 — 메인 창 지금 칸 입력칸에 메모 글 통째(메인 __notesPaste → notes_share_done). 사람이 아이콘을 눌렀을 때만 온다
#[tauri::command]
pub fn notes_paste<R: Runtime>(app: tauri::AppHandle<R>, text: String) {
    crate::craft_window::to_main(&app, "__notesPaste", serde_json::json!(text));
}

/// 답은 기다리는 창만 받는다(__notesShareDone 이 있는 창) — 창이 여럿이라 다 부른다
#[tauri::command]
pub fn notes_share_done<R: Runtime>(app: tauri::AppHandle<R>, ok: bool) {
    for (l, w) in app.webview_windows() {
        if is_notes(&l) {
            let _ = w.eval(format!("window.__notesShareDone && window.__notesShareDone({ok})"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scr(x: i32, y: i32, w: u32, h: u32) -> Screen {
        Screen { name: "s".into(), x, y, w, h }
    }

    #[test]
    fn 라벨은_메모마다_다르고_라벨에_쓸_수_있는_글자만() {
        let (a, b) = (label_of("note-1.md"), label_of("장 볼 것.md"));
        assert_ne!(a, b);
        assert_eq!(a, label_of("note-1.md"));
        assert!(is_notes(&a) && b.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    }

    #[test]
    fn 머리_더블클릭은_맥_설정대로() {
        assert_eq!(double_click_of(None, None), DoubleClick::Zoom); // 설정을 안 건드린 맥 = 확대
        assert_eq!(double_click_of(Some("Maximize"), None), DoubleClick::Zoom);
        assert_eq!(double_click_of(Some("Fill"), None), DoubleClick::Zoom);
        assert_eq!(double_click_of(Some("Minimize"), None), DoubleClick::Minimize);
        assert_eq!(double_click_of(Some("None"), Some(true)), DoubleClick::Nothing);
        assert_eq!(double_click_of(None, Some(true)), DoubleClick::Minimize); // 옛 키 AppleMiniaturizeOnDoubleClick
        assert_eq!(double_click_of(None, Some(false)), DoubleClick::Zoom);
    }

    #[test]
    fn 기억한_자리가_화면_안이면_그대로_밖이면_메인_창_옆으로() {
        let screens = [scr(0, 0, 1512, 982)];
        assert_eq!(place(Some([900.0, 100.0, 360.0, 420.0]), &screens, (0.0, 0.0), 0), [900.0, 100.0, 360.0, 420.0]);
        // 외장 모니터를 뺐다 — 그 자리는 이제 화면 밖
        assert_eq!(place(Some([2200.0, 100.0, 360.0, 420.0]), &screens, (40.0, 30.0), 0), [100.0, 110.0, DEFAULT_W, DEFAULT_H]);
        // 처음 여는 창 여럿은 비켜서 겹치지 않게
        assert_eq!(place(None, &screens, (40.0, 30.0), 2)[0], 156.0);
        // 너무 작게 기억된 크기는 최소로
        assert_eq!(place(Some([10.0, 10.0, 50.0, 50.0]), &screens, (0.0, 0.0), 0)[2..], [240.0, 200.0]);
    }
}
