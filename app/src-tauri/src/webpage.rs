//! 주소 미리보기 — scripts/show http(s) 주소를 앱 칸 자리에 붙은 자식 창(웹뷰)으로 띄운다(2026-10-02 사용자 "인앱에서 띄워 주고 '크롬에서 보기'").
//! iframe 은 X-Frame-Options 로 막히는 사이트가 많고, 다른 출처라 지금 주소·뒤로를 못 읽어서 진짜 웹뷰.
//! 메인 창 안에 자식 웹뷰(add_child)로 붙이면 Tauri 가 그 창을 더는 get_webview_window("main") 로 못 찾아(앱 20곳이 조용히 깨진다,
//! 2026-10-03 실측) — 테두리 없는 자식 창(parent)을 그 칸 자리에 띄운다. 맥은 자식 창이 부모를 따라 움직이고, 윈도우는 follow 가 맞춘다.
//! 화면 자리는 프론트가 그 칸의 네모(창 내용 기준 CSS px)를 재서 넘긴다
//!
//! 보안 — 바깥 페이지가 앱을 못 건드리게: ① Tauri 가 원격 출처의 앱 명령을 ACL 로 막는다(capability 가 없으니 다 거절)
//! ② 그래도 개발판 주소(localhost:1420)는 '로컬'로 쳐지니 main.rs 가 이 웹뷰 이름이면 명령을 통째로 거절(blocked)
//! ③ hodoc://·harnitor://(홈 폴더 파일을 내주는 프로토콜)도 모든 웹뷰에 붙어 있어 이 웹뷰 이름이면 거절
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Manager, Runtime, Url};

/// 미리보기 웹뷰 이름 — 하나만 둔다(모달·리더 중 지금 보이는 한 곳)
pub const LABEL: &str = "webpage";

/// 앱 명령·파일 프로토콜을 거절할 웹뷰인가
pub fn blocked(label: &str) -> bool {
    label == LABEL
}

/// http(s) 주소만 — 스킴·호스트가 있어야 하고 빈칸·제어 글자는 거절(file:·javascript:·data:·hodoc: 등은 못 연다)
pub fn parse_web_url(s: &str) -> Option<Url> {
    if s.len() > 8192 || s.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    // "https:///a"·"http:\\a" 도 url 은 고쳐서 받아 주지만 scripts/show 와 같게 거절 — 스킴 뒤엔 바로 호스트
    if !s.split_once("://").is_some_and(|(_, rest)| !rest.starts_with(['/', '\\'])) {
        return None;
    }
    let u = Url::parse(s).ok()?;
    (matches!(u.scheme(), "http" | "https") && u.host_str().is_some_and(|h| !h.is_empty())).then_some(u)
}

#[derive(Serialize, Clone, Default, Debug, PartialEq)]
pub struct WebState {
    /// 지금 주소(페이지 안에서 옮겨 가도 따라간다)
    pub url: String,
    pub loading: bool,
    /// 웹뷰가 떠 있나
    pub open: bool,
}

/// 지금 웹뷰를 쥔 칸(owner) + 상태. 칸이 바뀐 뒤 옛 칸이 닫기·자리 옮기기를 보내도 무시하려고
struct Slot {
    owner: String,
    state: WebState,
    /// 붙은 창(main·reader-…)과 그 창 내용 기준 칸 네모 — 부모가 움직이면 다시 맞춘다
    parent: String,
    rect: (f64, f64, f64, f64),
    /// 부모 창 웹뷰의 높이(CSS innerHeight) — 맥 제목줄 높이 = 창 높이 − 이것
    vh: f64,
    /// 가려 둠(확인 창이 떴거나 칸이 안 보임) — 화면 밖에 둔다
    away: bool,
    /// 닫을 때마다 하나씩 — 늦게 부수기(reap_later)가 그 사이 다시 열렸는지 본다
    gen: u64,
    /// 지금 미리보기 창을 만들 때 붙인 창(Tauri 엔 붙은 창을 묻는 길이 없다)
    built_for: String,
}
static SLOT: Mutex<Slot> = Mutex::new(Slot { owner: String::new(), state: WebState { url: String::new(), loading: false, open: false }, parent: String::new(), rect: (0.0, 0.0, 0.0, 0.0), vh: 0.0, away: false, gen: 0, built_for: String::new() });

static OPENING: Mutex<()> = Mutex::new(());
/// 가려 둘 때 미리보기 창을 둘 화면 밖 자리
const AWAY: f64 = -30000.0;

fn with_slot<T>(f: impl FnOnce(&mut Slot) -> T) -> T {
    f(&mut SLOT.lock().unwrap_or_else(|e| e.into_inner()))
}

fn owns(owner: &str) -> bool {
    with_slot(|s| s.owner == owner)
}

fn set_url(url: &Url, loading: Option<bool>) {
    with_slot(|s| {
        s.state.url = url.to_string();
        if let Some(l) = loading {
            s.state.loading = l;
        }
    });
}

fn bad_url() -> String {
    crate::i18n::tr("http(s) 주소만 열 수 있어요", "Only http(s) addresses can be opened").into()
}

/// 칸 네모(부모 창 내용 기준 논리 좌표) → 화면 좌표. 부모 창 내용 영역의 왼쪽 위에 더한다
fn place<R: Runtime>(parent: &tauri::WebviewWindow<R>, (x, y, w, h): (f64, f64, f64, f64), vh: f64) -> Option<(tauri::LogicalPosition<f64>, tauri::LogicalSize<f64>)> {
    let scale = parent.scale_factor().ok()?;
    let at = content_origin(parent, vh, scale)?;
    Some((tauri::LogicalPosition::new(at.x + x.max(0.0), at.y + y.max(0.0)), tauri::LogicalSize::new(w.max(1.0), h.max(1.0))))
}

/// 창 웹뷰의 왼쪽 위 화면 좌표(논리). 맥은 tao 의 inner_position·inner_size 가 제목줄까지 쳐서(창 맨 위·창 높이) 32pt 위로 떴다
/// (2026-10-03 실측) — 창 위 + (창 높이 − 웹뷰가 아는 제 높이 innerHeight). 윈도우는 테두리가 사방에 있어 그 계산이 틀리고 inner_position 이 맞다
#[cfg(target_os = "macos")]
fn content_origin<R: Runtime>(w: &tauri::WebviewWindow<R>, vh: f64, scale: f64) -> Option<tauri::LogicalPosition<f64>> {
    let pos = w.outer_position().ok()?.to_logical::<f64>(scale);
    let outer = w.outer_size().ok()?.to_logical::<f64>(scale);
    let bar = if vh > 0.0 { (outer.height - vh).clamp(0.0, 100.0) } else { 0.0 };
    Some(tauri::LogicalPosition::new(pos.x, pos.y + bar))
}
#[cfg(not(target_os = "macos"))]
fn content_origin<R: Runtime>(w: &tauri::WebviewWindow<R>, _vh: f64, scale: f64) -> Option<tauri::LogicalPosition<f64>> {
    w.inner_position().ok().map(|p| p.to_logical::<f64>(scale))
}

/// 지금 기록된 부모·네모로 미리보기 창 자리를 맞춘다 — 칸이 바뀌거나(web_bounds) 부모 창이 움직이면(main.rs 창 이벤트)
pub fn follow<R: Runtime>(app: &tauri::AppHandle<R>) {
    let (parent, r, vh, away) = with_slot(|s| (s.parent.clone(), s.rect, s.vh, s.away));
    let (Some(p), Some(wv)) = (app.get_webview_window(&parent), app.get_webview_window(LABEL)) else { return };
    if away {
        let _ = wv.set_position(tauri::LogicalPosition::new(AWAY, AWAY));
        return;
    }
    if let Some((pos, size)) = place(&p, r, vh) {
        let _ = wv.set_position(pos);
        let _ = wv.set_size(size);
    }
}

/// 부모 창 이벤트 — 그 창이 미리보기를 쥐고 있으면 자리를 다시 맞춘다
pub fn parent_moved<R: Runtime>(window: &tauri::Window<R>) {
    if with_slot(|s| s.state.open && s.parent == window.label()) {
        follow(window.app_handle());
    }
}

/// 앱을 통째로 숨길 때(⌘Q → to_background) 직접 숨길 창인가 — 미리보기(자식 창)는 아니다. 맥 자식 창을 직접 hide(orderOut)하면
/// 부모에서 떨어져 다시 열기(메인만 show) 뒤에도 숨은 채 남는다. 부모가 숨으면 같이 숨고 부모가 보이면 붙은 채 돌아온다(2026-10-09 실측)
pub fn hide_on_background(label: &str) -> bool {
    label != LABEL
}

/// 미리보기 창이 닫혔다(⌘W 등) — 상태를 비운다
pub fn forget() {
    with_slot(|s| {
        s.owner.clear();
        s.state = WebState::default();
    });
}

/// 연다 — 이미 떠 있으면 주소만 바꾸고 자리를 옮긴다. 부른 웹뷰의 창(main·리더 창) 위 그 칸 자리에.
/// async 여야 한다 — 동기 명령(메인 스레드)에서 창을 만들면 윈도우에서 멈춘다
#[tauri::command]
pub async fn web_open<R: Runtime>(webview: tauri::Webview<R>, url: String, owner: String, x: f64, y: f64, w: f64, h: f64, vh: f64) -> Result<(), String> {
    let u = parse_web_url(&url).ok_or_else(bad_url)?;
    // 한 번에 하나만 — 화면이 두 번 그려지며(StrictMode) 열기가 동시에 오면 창이 둘 생겼다(2026-10-03). 안에 await 가 없어 std 잠금으로 된다
    let _one = OPENING.lock().unwrap_or_else(|e| e.into_inner());
    let app = webview.app_handle().clone();
    let parent = webview.window();
    let owner_now = owner.clone();
    let built_for = with_slot(|s| s.built_for.clone());
    with_slot(|s| {
        s.owner = owner;
        s.state = WebState { url: u.to_string(), loading: true, open: true };
        s.parent = parent.label().to_string();
        s.rect = (x, y, w, h);
        s.vh = vh;
        s.away = w <= 0.0 || h <= 0.0;
    });
    if let Some(wv) = app.get_webview_window(LABEL) {
        // 붙은 창이 같으면 그대로 쓴다. 다르면(리더 창 → 메인) 엉뚱한 창을 따라다니지 않게 부수고 새로
        if built_for == parent.label() {
            follow(&app);
            return wv.navigate(u).map_err(|e| e.to_string());
        }
        let _ = wv.destroy();
        std::thread::sleep(std::time::Duration::from_millis(300)); // 이름이 풀릴 때까지(reap_later 와 같은 이유)
    }
    let parent_ww = app.get_webview_window(parent.label()).ok_or("no parent window")?;
    let (pos, size) = place(&parent_ww, (x, y, w, h), vh).ok_or("no parent position")?;
    let nav_app = app.clone();
    let wv = tauri::WebviewWindowBuilder::new(&app, LABEL, tauri::WebviewUrl::External(u))
        .parent(&parent_ww)
        .map_err(|e| e.to_string())?
        .title("Chammo preview")
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .skip_taskbar(true)
        .focused(false)
        .position(pos.x, pos.y)
        .inner_size(size.width, size.height)
        // 페이지 안 이동도 http(s) 만 — 그 밖(file:·hodoc: 등)은 막는다. 주소 줄이 따라가게 기록
        .on_navigation(|u| {
            let ok = matches!(u.scheme(), "http" | "https" | "about" | "blob");
            if ok && matches!(u.scheme(), "http" | "https") {
                set_url(u, Some(true));
            }
            ok
        })
        .on_page_load(|wv, p| {
            let done = matches!(p.event(), tauri::webview::PageLoadEvent::Finished);
            set_url(&wv.url().unwrap_or_else(|_| p.url().clone()), Some(!done));
        })
        // 내려받기는 막는다 — 바깥 페이지가 몰래 파일을 떨구지 않게. 받을 건 '크롬에서 열기'로
        .on_download(|_, _| false)
        // 새 창(target=_blank·window.open)은 같은 칸에서 연다 — 앱 창이 늘어나지 않게
        .on_new_window(move |u, _| {
            if parse_web_url(u.as_str()).is_some() {
                if let Some(wv) = nav_app.get_webview_window(LABEL) {
                    let _ = wv.navigate(u);
                }
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()
        .map_err(|e| e.to_string())?;
    with_slot(|s| s.built_for = parent.label().to_string());
    // 만드는 사이 칸이 닫혔으면(web_close 가 먼저 왔다) 화면 밖으로 — 부수기는 web_close 가 건 늦게 부수기가 한다
    if !owns(&owner_now) {
        drop(wv);
        follow(&app);
    }
    Ok(())
}

/// 칸 자리가 바뀌었다(모달 크기 조절·창 크기). 다른 칸이 쥐고 있으면 무시
#[tauri::command]
pub fn web_bounds<R: Runtime>(app: tauri::AppHandle<R>, owner: String, x: f64, y: f64, w: f64, h: f64, vh: f64) {
    if !owns(&owner) {
        return;
    }
    with_slot(|s| {
        s.rect = (x, y, w, h);
        s.vh = vh;
    });
    follow(&app);
}

/// 주소 줄에 친 주소로
#[tauri::command]
pub fn web_go<R: Runtime>(app: tauri::AppHandle<R>, owner: String, url: String) -> Result<(), String> {
    let u = parse_web_url(&url).ok_or_else(bad_url)?;
    if !owns(&owner) {
        return Ok(());
    }
    let wv = app.get_webview_window(LABEL).ok_or("no webview")?;
    set_url(&u, Some(true));
    wv.navigate(u).map_err(|e| e.to_string())
}

/// 뒤로·앞으로·새로고침
#[tauri::command]
pub fn web_nav<R: Runtime>(app: tauri::AppHandle<R>, owner: String, action: String) -> Result<(), String> {
    if !owns(&owner) {
        return Ok(());
    }
    let wv = app.get_webview_window(LABEL).ok_or("no webview")?;
    match action.as_str() {
        "back" => wv.eval("history.back()"),
        "forward" => wv.eval("history.forward()"),
        "reload" => wv.reload(),
        _ => return Err(format!("unknown action: {action}")),
    }
    .map_err(|e| e.to_string())
}

/// 지금 주소·불러오는 중 — 프론트가 0.5초마다 읽어 주소 줄을 맞춘다(앱엔 이벤트 권한이 없어서 묻는 쪽)
#[tauri::command]
pub fn web_state(owner: String) -> WebState {
    with_slot(|s| if s.owner == owner { s.state.clone() } else { WebState::default() })
}

/// 숨기기·보이기 — 그 칸 위에 앱 창(확인 창 등)이 떠야 할 때. 미리보기 창이 앱 화면 위에 떠서 가린다.
/// hide() 는 안 쓴다 — 맥에서 부모에 붙은 자식 창은 한 번 숨기면 show() 로 다시 안 나왔다(2026-10-03 실측, 모달이 빈 칸으로 떴다). 화면 밖으로 옮긴다
#[tauri::command]
pub fn web_visible<R: Runtime>(app: tauri::AppHandle<R>, owner: String, visible: bool) {
    if !owns(&owner) {
        return;
    }
    with_slot(|s| s.away = !visible);
    follow(&app);
}

/// 닫기 — 칸이 사라질 때. 다른 칸이 이미 쥐었으면 그대로 둔다.
/// 바로 부수지 않는다 — 화면이 두 번 그려지며(StrictMode) '열기→닫기→열기'가 연달아 오면 다음 열기가 부서지는 중인 창을 집어
/// 빈 칸이 됐다(2026-10-03 실측). 화면 밖으로 치우고 빈 페이지로 바꾼 뒤, 3초 안에 다시 안 열리면 부순다
#[tauri::command]
pub fn web_close<R: Runtime>(app: tauri::AppHandle<R>, owner: String) {
    if !owns(&owner) {
        return;
    }
    let gen = with_slot(|s| {
        s.owner.clear();
        s.state = WebState::default();
        s.away = true;
        s.gen += 1;
        s.gen
    });
    follow(&app);
    if let Some(wv) = app.get_webview_window(LABEL) {
        if let Ok(blank) = Url::parse("about:blank") {
            let _ = wv.navigate(blank); // 소리·영상·새로고침 연결이 화면 밖에서 돌지 않게
        }
    }
    reap_later(app, gen);
}

/// 닫은 뒤 다시 안 열렸으면 부순다 — 여는 중(OPENING)과 겹치지 않게 같은 잠금 안에서
fn reap_later<R: Runtime>(app: tauri::AppHandle<R>, gen: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let _one = OPENING.lock().unwrap_or_else(|e| e.into_inner());
        if !with_slot(|s| s.gen == gen && !s.state.open) {
            return;
        }
        if let Some(wv) = app.get_webview_window(LABEL) {
            let _ = wv.destroy(); // close 는 맥 창 닫기 규칙(main.rs)에 걸려 숨기기만 된다
            std::thread::sleep(std::time::Duration::from_millis(300)); // 이름이 풀릴 때까지 — 바로 다음 열기가 부서진 창을 안 집게
        }
    });
}

/// 크롬에서 열기 — 기본 브라우저 말고 깔린 구글 크롬(없으면 기본 브라우저). 무엇으로 열었는지 돌려준다
#[tauri::command]
pub fn open_in_chrome(url: String) -> Result<String, String> {
    let u = parse_web_url(&url).ok_or_else(bad_url)?;
    crate::platform::open_in_chrome(u.as_str()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 앱_통째로_숨길_때_미리보기는_직접_숨기지_않는다() {
        // 맥 자식 창을 직접 orderOut 하면 부모에서 떨어져, 다시 열기(메인만 show) 뒤에도 숨은 채 남았다(2026-10-09 AppKit 실측,
        // .shots/fix-debt-h/6-child-window.txt). 부모가 숨으면 자식도 같이 숨고, 부모가 다시 보이면 붙은 채 돌아온다
        assert!(!hide_on_background(LABEL));
        assert!(hide_on_background("main"));
        assert!(hide_on_background("reader-1"));
    }

    #[test]
    fn http_https_주소만_연다() {
        assert_eq!(parse_web_url("http://localhost:3000").unwrap().as_str(), "http://localhost:3000/");
        assert_eq!(parse_web_url("https://example.com/a?b=1#c").unwrap().as_str(), "https://example.com/a?b=1#c");
        assert!(parse_web_url("HTTPS://Example.com").is_some());
        for bad in [
            "localhost:3000", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "hodoc://localhost/Users/a/.ssh/id_rsa",
            "harnitor://localhost/", "tauri://localhost/", "ipc://localhost/pty_write", "http://", "https:///nohost", "http://a b.com",
            "http://a.com/\nx", "http://[::1", "about:blank", "http:\\\\evil.com", "",
        ] {
            assert!(parse_web_url(bad).is_none(), "{bad}");
        }
        assert!(parse_web_url(&format!("https://a.com/{}", "x".repeat(9000))).is_none());
    }

    #[test]
    fn 미리보기_웹뷰만_막는다() {
        assert!(blocked(LABEL));
        for ok in ["main", "tama", "reader", "webpage2", ""] {
            assert!(!blocked(ok), "{ok}");
        }
    }

    #[test]
    fn 다른_칸은_상태를_못_본다() {
        with_slot(|s| {
            s.owner = "a".into();
            s.state = WebState { url: "http://x/".into(), loading: false, open: true };
        });
        assert_eq!(web_state("a".into()).url, "http://x/");
        assert_eq!(web_state("b".into()), WebState::default());
        with_slot(|s| {
            s.owner.clear();
            s.state = WebState::default();
        });
    }
}
