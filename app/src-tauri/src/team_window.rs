//! 메신저 따로 창(시안 v2 C) — 메인 창 팀 모드와 같은 화면(team-all, 참모만 없이)을 떼어 낸다.
//! 대화 하나만 떼어도 그 창에서 그 대화를 고른다(10-26 사용자 — 대화 하나만 뜬 창은 없앴다, 옛 열쇠 team-<방> 도 team-all 로)
//! - 붙이기 = 창 머리 붙이기 아이콘(웹이 team_window_close) 또는 창 닫기 → 메인 창에 __teamDock 로 알린다
//! - 자리는 하나만 기억(<데이터>/team-window.json: 열린 창 + 마지막 자리와 그 모니터 이름). 다음에 앱을 켜면 그 모니터가 있을 때만 다시 연다
//! - 처음 떼면 메인 창이 없는 쪽 모니터 가운데, 모니터가 하나면 메인 창 위(웹은 모니터 하나면 떼기 아이콘을 숨긴다)
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{Manager, Runtime};

pub const STATE_FILE: &str = "team-window.json";

/// 마지막 자리 — 논리 좌표, 그 모니터 이름
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Spot {
    pub monitor: String,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct State {
    /// 떼어 둔 창 열쇠("all" 또는 방 id)
    pub open: Vec<String>,
    pub spot: Option<Spot>,
}

/// 모니터 하나(논리 좌표)
#[derive(Clone, Debug, PartialEq)]
pub struct Screen {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

impl Screen {
    fn holds(&self, x: i32, y: i32) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.w as i32 && y < self.y + self.h as i32
    }
}

pub const DEFAULT_W: u32 = 960;
pub const DEFAULT_H: u32 = 680;

/// 창 열쇠 — "all" 또는 방 id(영문·숫자·-_ 64자)
pub fn key_ok(k: &str) -> bool {
    k == "all" || (!k.is_empty() && k.len() <= 64 && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
}

/// 열 창과 고를 방 — 늘 팀 모드 창 하나("all"), 방 열쇠면 그 창에서 그 방을 고른다
pub fn target(key: &str) -> (String, Option<String>) {
    ("all".to_string(), (key != "all").then(|| key.to_string()))
}

/// 팀 모드 창 주소 — 방은 key_ok 를 지난 글자만이라 그대로 붙인다
pub fn url_of(room: Option<&str>) -> String {
    match room {
        Some(r) => format!("messenger.html?c=all&r={r}"),
        None => "messenger.html?c=all".to_string(),
    }
}

/// 이미 떠 있는 창에 고를 방을 넘긴다(웹 useTeamMode 의 __teamPick)
pub fn pick_js(room: &str) -> String {
    format!("window.__teamPick && window.__teamPick({})", serde_json::Value::String(room.to_string()))
}

pub fn label(key: &str) -> String {
    format!("{}{key}", crate::team_ui::WIN_PREFIX)
}

pub fn load(dir: &Path) -> State {
    std::fs::read_to_string(dir.join(STATE_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(dir: &Path, st: &State) {
    if let Ok(t) = serde_json::to_string_pretty(st) {
        let _ = crate::accounts::write_atomic(&dir.join(STATE_FILE), &(t + "\n"));
    }
}

/// 기억한 자리가 아직 있는 모니터 위인가 — 그 이름의 모니터가 있고 창 왼쪽 위가 그 안
pub fn spot_alive(spot: &Spot, screens: &[Screen]) -> bool {
    screens.iter().any(|s| s.name == spot.monitor && s.holds(spot.x, spot.y))
}

/// 띄울 자리(x, y, w, h) — 기억한 자리가 살아 있으면 그대로, 아니면 메인 창이 없는 모니터 가운데, 그것도 없으면 메인 창 모니터 가운데
pub fn place(saved: Option<&Spot>, screens: &[Screen], main_at: (i32, i32)) -> (i32, i32, u32, u32) {
    if let Some(s) = saved.filter(|s| spot_alive(s, screens)) {
        return (s.x, s.y, s.w.max(480), s.h.max(360));
    }
    let main = screens.iter().find(|s| s.holds(main_at.0, main_at.1));
    let target = screens.iter().find(|s| Some(*s) != main).or(main).or(screens.first());
    match target {
        Some(s) => {
            let (w, h) = (DEFAULT_W.min(s.w.saturating_sub(40)), DEFAULT_H.min(s.h.saturating_sub(80)));
            (s.x + (s.w as i32 - w as i32) / 2, s.y + (s.h as i32 - h as i32) / 2, w, h)
        }
        None => (120, 120, DEFAULT_W, DEFAULT_H),
    }
}

fn screens_of<R: Runtime>(app: &tauri::AppHandle<R>) -> Vec<Screen> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let s = m.scale_factor();
            Screen { name: m.name().cloned().unwrap_or_default(), x: (m.position().x as f64 / s) as i32, y: (m.position().y as f64 / s) as i32, w: (m.size().width as f64 / s) as u32, h: (m.size().height as f64 / s) as u32 }
        })
        .collect()
}

/// 창이 지금 있는 자리 — 왼쪽 위 점이 든 모니터 이름과 함께
fn spot_of<R: Runtime>(w: &tauri::Window<R>) -> Option<Spot> {
    let sf = w.scale_factor().ok()?;
    let p = w.outer_position().ok()?.to_logical::<f64>(sf);
    let z = w.inner_size().ok()?.to_logical::<f64>(sf);
    let (x, y) = (p.x as i32, p.y as i32);
    let monitor = screens_of(w.app_handle()).into_iter().find(|s| s.holds(x, y)).map(|s| s.name).unwrap_or_default();
    Some(Spot { monitor, x, y, w: z.width as u32, h: z.height as u32 })
}

/// 메인 창 웹에 붙음 소식 — 이 앱은 capabilities 가 없어 이벤트 대신 eval(craft_window::to_main 과 같은 길)
fn tell_main<R: Runtime>(app: &tauri::AppHandle<R>, key: &str, place: &str) {
    crate::craft_window::to_main(app, "__teamDock", serde_json::json!({ "key": key, "place": place }));
}

/// 떼기 — 창을 띄우고(이미 있으면 앞으로) 열린 창 목록에 적는다. async: 윈도우는 동기 명령 안에서 웹뷰 창을 만들면 교착된다(craft_move 와 같은 이유)
#[tauri::command]
pub async fn team_window_open<R: Runtime>(app: tauri::AppHandle<R>, window: tauri::WebviewWindow<R>, key: String, title: String) -> Result<String, String> {
    if !crate::team_ui::ui_window(window.label()) || !key_ok(&key) {
        return Err("bad".into());
    }
    let (key, room) = target(&key);
    let lb = label(&key);
    if let Some(w) = app.get_webview_window(&lb) {
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(r) = room.as_deref() {
            let _ = w.eval(pick_js(r));
        }
        return Ok("shown".into());
    }
    let dir = crate::config::data_dir();
    let mut st = load(dir);
    let main_at = app.get_webview_window("main").and_then(|m| Some(m.outer_position().ok()?.to_logical::<f64>(m.scale_factor().ok()?))).map(|p| (p.x as i32 + 40, p.y as i32 + 40)).unwrap_or((0, 0));
    let (x, y, w, h) = place(st.spot.as_ref(), &screens_of(&app), main_at);
    let title: String = title.chars().filter(|c| !c.is_control()).take(60).collect();
    let win = tauri::WebviewWindowBuilder::new(&app, &lb, tauri::WebviewUrl::App(url_of(room.as_deref()).into()))
        .title(if title.is_empty() { crate::i18n::tr("메신저", "Messenger").to_string() } else { title })
        .inner_size(w as f64, h as f64)
        .position(x as f64, y as f64)
        .min_inner_size(420.0, 360.0)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    // 개발판은 기억한 자리가 없을 때 메인 창 옆 화면(가짜 화면)으로 — 숨긴 채 옮긴 뒤 보인다(시험 창이 사람 화면에 번쩍이지 않게)
    if st.spot.is_none() {
        crate::debug::place_near_main(&app, &win);
    }
    let _ = win.show();
    let _ = win.set_focus();
    // 옛 판이 적어 둔 방 창 열쇠는 지운다 — 이제 창은 team-all 하나
    st.open.retain(|k| k == "all");
    if !st.open.contains(&key) {
        st.open.push(key.clone());
    }
    save(dir, &st);
    tell_main(&app, &key, "window");
    Ok("opened".into())
}

/// 붙이기 — 창을 닫는다(닫힘 처리는 closed 가)
#[tauri::command]
pub fn team_window_close<R: Runtime>(app: tauri::AppHandle<R>, window: tauri::WebviewWindow<R>, key: String) -> Result<(), String> {
    if !crate::team_ui::ui_window(window.label()) || !key_ok(&key) {
        return Err("bad key".into());
    }
    match app.get_webview_window(&label(&key)) {
        Some(w) => w.close().map_err(|e| e.to_string()),
        None => {
            closed_key(&app, &key, None);
            Ok(())
        }
    }
}

/// 떼어 둔 창·모니터 수·기억한 자리가 살아 있나 — 메인 창이 켤 때 다시 열지 정한다. screens 가 1 이면 떼기 아이콘을 숨긴다
#[tauri::command]
pub fn team_window_state<R: Runtime>(app: tauri::AppHandle<R>, window: tauri::WebviewWindow<R>) -> Result<serde_json::Value, String> {
    if !crate::team_ui::ui_window(window.label()) {
        return Err("messenger windows only".into());
    }
    let st = load(crate::config::data_dir());
    let screens = screens_of(&app);
    let alive = st.spot.as_ref().is_some_and(|s| spot_alive(s, &screens));
    let shown: Vec<&String> = st.open.iter().filter(|k| app.get_webview_window(&label(k)).is_some()).collect();
    Ok(serde_json::json!({ "open": st.open, "shown": shown, "screens": screens.len(), "spotAlive": alive }))
}

fn closed_key<R: Runtime>(app: &tauri::AppHandle<R>, key: &str, spot: Option<Spot>) {
    let dir = crate::config::data_dir();
    let mut st = load(dir);
    st.open.retain(|k| k != key);
    if spot.is_some() {
        st.spot = spot;
    }
    save(dir, &st);
    crate::team_alert::set_view(&label(key), "");
    tell_main(app, key, "app");
}

pub fn is_team_window(label: &str) -> bool {
    label.starts_with(crate::team_ui::WIN_PREFIX)
}

/// 창 닫기(빨간 단추·붙이기 아이콘) — 마지막 자리를 기억하고 메인 창에 붙었다고 알린다
pub fn closed<R: Runtime>(w: &tauri::Window<R>) {
    let Some(key) = w.label().strip_prefix(crate::team_ui::WIN_PREFIX).map(str::to_string) else { return };
    closed_key(w.app_handle(), &key, spot_of(w));
}

/// 움직이거나 크기를 바꾸면 자리만 기억(0.5초에 한 번 넘게 쓰지 않는다 — 닫을 때 마지막 자리를 한 번 더 쓴다)
pub fn moved<R: Runtime>(w: &tauri::Window<R>) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static LAST: AtomicU64 = AtomicU64::new(0);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    if now.saturating_sub(LAST.load(Ordering::Relaxed)) < 500 {
        return;
    }
    LAST.store(now, Ordering::Relaxed);
    let Some(spot) = spot_of(w) else { return };
    let dir = crate::config::data_dir();
    let mut st = load(dir);
    st.spot = Some(spot);
    save(dir, &st);
}

#[cfg(test)]
#[path = "team_window_tests.rs"]
mod tests;
