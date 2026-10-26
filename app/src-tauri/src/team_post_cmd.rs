//! 팀 홈 글 화면 명령 — 메인 창·메신저 창(team-*)만. 네트워크·데이터 폴더만 건드리지만 느려서 전부 async + spawn_blocking(team_profile_cmd 와 같은 모양)
use crate::team_post::{self as post, Board};

fn ui_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if crate::team_ui::ui_window(w.label()) { Ok(()) } else { Err("messenger windows only".into()) }
}

async fn job<T: Send + 'static>(f: impl FnOnce(&std::path::Path, &dyn crate::accounts_store::Store, &dyn crate::team_relay::Http) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(crate::config::data_dir(), &crate::team_relay_keys::store(), &crate::team_relay::Curl)).await.map_err(|e| e.to_string())?
}

/// 팀 하나(빈 글 = 지금 팀)의 글판
#[tauri::command]
pub async fn team_posts(window: tauri::WebviewWindow, team: String) -> Result<Board, String> {
    ui_only(&window)?;
    job(move |d, kc, h| post::board(d, kc, h, &team)).await
}

/// 글 쓰기·고치기(origin = 고칠 글 id) — 글 id
#[tauri::command]
pub async fn team_post_write(window: tauri::WebviewWindow, team: String, title: String, body: String, origin: Option<String>) -> Result<String, String> {
    ui_only(&window)?;
    job(move |d, kc, h| post::write(d, kc, h, &team, &title, &body, origin.as_deref())).await
}

/// 고정·풀기(post 빈 글) — 팀장만
#[tauri::command]
pub async fn team_post_pin(window: tauri::WebviewWindow, team: String, post: String) -> Result<(), String> {
    ui_only(&window)?;
    job(move |d, kc, h| post::pin(d, kc, h, &team, &post)).await
}

/// 글 지우기(휴지통) — 글쓴이·팀장만
#[tauri::command]
pub async fn team_post_remove(window: tauri::WebviewWindow, team: String, post: String) -> Result<(), String> {
    ui_only(&window)?;
    job(move |d, kc, h| post::remove(d, kc, h, &team, &post)).await
}
