//! 팀 메신저 새 말 알림 — OS 알림 + 알림음, 지금 그 대화를 보고 있으면(그 창이 앞) 안 울린다.
//! - 판단은 여기 한 곳(Rust) — 메인 창·메신저 따로 창이 둘 다 떠도 한 번만, 창이 숨어도 울린다
//! - 창마다 지금 보는 방은 team_viewing 으로 받고, 앞에 있나는 그 순간 창에 묻는다
//! - 기록(notify.log)엔 누가·어느 방·몇 번째만 — 남의 말 본문은 안 남긴다(team_relay_inbox::deliver 와 같은 선)
//! - 소리 설정은 <데이터>/team-alert.json(켜기·소리 이름) — 설정 화면이 고친다
use crate::team_relay_inbox::Record;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

pub const SETTINGS_FILE: &str = "team-alert.json";

/// 고를 수 있는 소리 — 맥 시스템 소리 이름(그대로 /System/Library/Sounds/<이름>.aiff). 바깥 글을 경로에 넣지 않게 이 목록만
pub const SOUNDS: &[&str] = &["Glass", "Ping", "Pop", "Tink", "Purr", "Bottle", "Hero", "Submarine", "Funk", "Morse"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub sound: bool,
    pub name: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { sound: true, name: "Glass".into() }
    }
}

pub fn load(dir: &Path) -> Settings {
    let s: Settings = std::fs::read_to_string(dir.join(SETTINGS_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    // 손으로 고친 파일의 모르는 이름은 기본 소리로
    if SOUNDS.contains(&s.name.as_str()) { s } else { Settings { name: "Glass".into(), ..s } }
}

pub fn save(dir: &Path, s: &Settings) -> Result<(), String> {
    if !SOUNDS.contains(&s.name.as_str()) {
        return Err("모르는 소리".into());
    }
    crate::accounts::write_atomic(&dir.join(SETTINGS_FILE), &(serde_json::to_string_pretty(s).map_err(|e| e.to_string())? + "\n")).map_err(|e| format!("{e:?}"))
}

/// 알림 하나
#[derive(Debug, PartialEq)]
pub struct Alert {
    pub title: String,
    pub body: String,
    /// 누르면 갈 곳 — team:<방>
    pub target: String,
    pub sound: Option<String>,
}

/// 알림 본문 미리보기 — 한 줄, 80자
pub fn preview(body: &str) -> String {
    let one: String = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() > 80 { format!("{}…", one.chars().take(79).collect::<String>()) } else { one }
}

/// 이 말에 알릴까 — 남이 보낸 새 말(참모에게 넘긴 것 = delivered)만. 내 다른 기기가 보낸 것·막은 말·옛 말·내 기기끼리 방은 아니다.
/// views = 창마다 (보고 있는 방, 그 창이 앞인가). 그 방을 앞에 띄운 창이 있으면 안 울린다
pub fn decide(rec: &Record, views: &[(String, bool)], set: &Settings) -> Option<Alert> {
    if rec.note != "delivered" || rec.kind == "self" {
        return None;
    }
    if views.iter().any(|(room, front)| *front && room == &rec.room) {
        return None;
    }
    let who = if rec.person.is_empty() { "?".to_string() } else { rec.person.clone() };
    let title = if rec.origin == "human" { who } else { crate::i18n::tr(&format!("{who}의 참모"), &format!("{who}'s assistant")).to_string() };
    Some(Alert { title, body: preview(&rec.body), target: format!("team:{}", rec.room), sound: set.sound.then(|| set.name.clone()) })
}

// ── 앱에 붙이는 길 ─────────────────────────────────────────────

/// 창 라벨 → 보고 있는 방(빈 글 = 대화를 안 보는 중)
static VIEWS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
type Hook = Box<dyn Fn(&Record) + Send + Sync>;
static HOOK: OnceLock<Hook> = OnceLock::new();

pub fn set_view(label: &str, room: &str) {
    let mut g = VIEWS.lock().unwrap_or_else(|e| e.into_inner());
    let m = g.get_or_insert_with(HashMap::new);
    if room.is_empty() {
        m.remove(label);
    } else {
        m.insert(label.to_string(), room.to_string());
    }
}

fn views() -> Vec<(String, String)> {
    VIEWS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default()
}

/// 받은 말·보낸 말이 기록될 때마다(team_relay_ws) — 시험엔 고리가 없어 아무것도 안 한다
pub fn on_record(rec: &Record) {
    if let Some(f) = HOOK.get() {
        f(rec);
    }
}

/// 앱이 뜰 때 한 번 — 창에 새 말을 알리고(다시 읽게), 알릴 말이면 알림·소리
pub fn init<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    let app = app.clone();
    let _ = HOOK.set(Box::new(move |rec: &Record| {
        let poke = serde_json::json!({ "room": rec.room, "seq": rec.seq, "note": rec.note });
        let wins: Vec<_> = app.webview_windows().into_iter().filter(|(l, _)| crate::team_ui::ui_window(l)).collect();
        for (_, w) in &wins {
            let _ = w.eval(format!("window.__teamMsg && window.__teamMsg({poke})"));
        }
        let vs: Vec<(String, bool)> = views().into_iter().map(|(l, room)| (room, wins.iter().find(|(x, _)| *x == l).is_some_and(|(_, w)| w.is_focused().unwrap_or(false) && w.is_visible().unwrap_or(false)))).collect();
        match decide(rec, &vs, &load(crate::config::data_dir())) {
            Some(a) => fire(&a, rec),
            // 보고 있는 대화라 안 울림 — 기록에 한 줄(왜 안 울렸는지 나중에 볼 수 있게, 본문 없이)
            None if rec.note == "delivered" && rec.kind != "self" => crate::claude::log_out("notify", &format!("팀 새 말 {} #{} — 보는 중이라 안 울림", rec.room.chars().take(8).collect::<String>(), rec.seq)),
            None => {}
        }
    }));
}

/// 알림 보내기 — 기록엔 본문 없이. 시험 앱(CHAMMO_NO_OS_NOTIFY=1)은 기록만
fn fire(a: &Alert, rec: &Record) {
    let off = crate::claude::os_notify_off(std::env::var("CHAMMO_NO_OS_NOTIFY").ok().as_deref());
    crate::claude::log_out("notify", &format!("{} — 팀 새 말 {} #{} 소리 {}", a.title, rec.room.chars().take(8).collect::<String>(), rec.seq, a.sound.as_deref().unwrap_or("끔")));
    if off {
        return;
    }
    crate::push::send_all(&a.title, &a.body, &a.target);
    if !crate::notify_mac::send(&a.title, &a.body, &a.target) {
        #[cfg(target_os = "macos")]
        let _ = crate::platform::spawn_reaped(crate::platform::command("osascript").args(["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", &a.title, &a.body]));
    }
    if let Some(s) = &a.sound {
        play(s);
    }
}

/// 소리 한 번 — 맥은 afplay(목록 안 이름만), 다른 OS 는 아직 없다(roadmap)
pub fn play(name: &str) {
    if !SOUNDS.contains(&name) {
        return;
    }
    #[cfg(target_os = "macos")]
    let _ = crate::platform::spawn_reaped(crate::platform::command("/usr/bin/afplay").arg(format!("/System/Library/Sounds/{name}.aiff")));
}

/// 창이 지금 보는 대화(빈 글 = 안 봄) — 메인 창·메신저 창
#[tauri::command]
pub fn team_viewing(window: tauri::WebviewWindow, room: String) -> Result<(), String> {
    if !crate::team_ui::ui_window(window.label()) || room.len() > 80 {
        return Err("bad".into());
    }
    set_view(window.label(), &room);
    Ok(())
}

#[tauri::command]
pub fn team_alert_get(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    if !crate::team_ui::ui_window(window.label()) {
        return Err("messenger windows only".into());
    }
    Ok(serde_json::json!({ "settings": load(crate::config::data_dir()), "sounds": SOUNDS }))
}

/// 설정 > 알림음 — 메인 창만
#[tauri::command]
pub fn team_alert_set(window: tauri::WebviewWindow, sound: bool, name: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("main window only".into());
    }
    save(crate::config::data_dir(), &Settings { sound, name })
}

/// 미리 듣기 — 시험 앱(CHAMMO_NO_OS_NOTIFY=1)은 기록만
#[tauri::command]
pub fn team_sound_try(window: tauri::WebviewWindow, name: String) {
    if !crate::team_ui::ui_window(window.label()) {
        return;
    }
    crate::claude::log_out("notify", &format!("팀 알림음 미리 듣기 {}", if SOUNDS.contains(&name.as_str()) { name.as_str() } else { "?" }));
    if !crate::claude::os_notify_off(std::env::var("CHAMMO_NO_OS_NOTIFY").ok().as_deref()) {
        play(&name);
    }
}

#[cfg(test)]
#[path = "team_alert_tests.rs"]
mod tests;
