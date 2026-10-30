//! 팀 프로필 화면 명령 — 메인 창·메신저 창(team-*)만. 네트워크·데이터 폴더만 건드리지만 느려서 전부 async + spawn_blocking
use crate::team_relay::{human_job, bg_job};
use crate::team_profile::{self as profile, Board, Change};
use base64::Engine;

fn ui_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if crate::team_ui::ui_window(w.label()) { Ok(()) } else { Err("messenger windows only".into()) }
}

/// 화면이 보내는 그림 — data URL 또는 base64(잘라서 만든 webp)
pub(crate) fn image(b64: &str) -> Result<Vec<u8>, String> {
    let raw = b64.split_once(";base64,").map_or(b64, |(_, b)| b);
    base64::engine::general_purpose::STANDARD.decode(raw.trim()).map_err(|_| "그림을 못 읽었어".to_string())
}

/// 팀 하나(빈 글 = 지금 팀)의 프로필판
#[tauri::command]
pub async fn team_profiles(window: tauri::WebviewWindow, team: String) -> Result<Board, String> {
    ui_only(&window)?;
    bg_job(move |d, kc, h| profile::board(d, kc, h, &team)).await
}

/// 다시 읽어야 하나(메모리만) — 화면이 몇 초마다
#[tauri::command]
pub fn team_profile_changed(window: tauri::WebviewWindow, team: String, rev: u64) -> Result<bool, String> {
    ui_only(&window)?;
    Ok(profile::changed(&team, rev))
}

/// 내 프로필 바꾸기 — name·status·note 는 있으면 바꾸고, photo: 그림(base64) · "" = 사진 지우기 · 없음 = 그대로. 실패한 팀 이유들
#[tauri::command]
pub async fn team_profile_set(window: tauri::WebviewWindow, name: Option<String>, status: Option<String>, note: Option<String>, photo: Option<String>) -> Result<Vec<String>, String> {
    ui_only(&window)?;
    let photo = match photo {
        None => None,
        Some(p) if p.is_empty() => Some(None),
        Some(p) => Some(Some(image(&p)?)),
    };
    let c = Change { name, status, note, photo };
    human_job(move |d, kc, h| profile::set(d, kc, h, &c)).await
}

/// 팀 아이콘 — image 가 빈 글이면 지우기. 팀장만
#[tauri::command]
pub async fn team_icon_set(window: tauri::WebviewWindow, team: String, image: String) -> Result<(), String> {
    ui_only(&window)?;
    let b = if image.is_empty() { None } else { Some(self::image(&image)?) };
    human_job(move |d, kc, h| profile::set_team_icon(d, kc, h, &team, b.as_deref())).await
}
