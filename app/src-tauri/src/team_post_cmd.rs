//! 팀 홈 글 화면 명령 — 메인 창·메신저 창(team-*)만. 네트워크·데이터 폴더만 건드리지만 느려서 전부 async + spawn_blocking(team_profile_cmd 와 같은 모양)
use crate::team_relay::{human_job, bg_job};
use crate::team_post::{self as post, Board};

fn ui_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if crate::team_ui::ui_window(w.label()) { Ok(()) } else { Err("messenger windows only".into()) }
}

/// 팀 하나(빈 글 = 지금 팀)의 글판
#[tauri::command]
pub async fn team_posts(window: tauri::WebviewWindow, team: String) -> Result<Board, String> {
    ui_only(&window)?;
    let (b, share) = bg_job(move |d, kc, h| post::board_split(d, kc, h, &team)).await?;
    share.spawn();
    Ok(b)
}

/// 글 쓰기·고치기(origin = 고칠 글 id) — 글 id
#[tauri::command]
pub async fn team_post_write(window: tauri::WebviewWindow, team: String, title: String, body: String, origin: Option<String>) -> Result<String, String> {
    ui_only(&window)?;
    let (id, share) = human_job(move |d, kc, h| post::write(d, kc, h, &team, &title, &body, origin.as_deref())).await?;
    share.spawn();
    Ok(id)
}

/// 고정·풀기(post 빈 글) — 팀장만
#[tauri::command]
pub async fn team_post_pin(window: tauri::WebviewWindow, team: String, post: String) -> Result<(), String> {
    ui_only(&window)?;
    human_job(move |d, kc, h| post::pin(d, kc, h, &team, &post)).await?.spawn();
    Ok(())
}

/// 글 지우기(휴지통) — 글쓴이·팀장만
#[tauri::command]
pub async fn team_post_remove(window: tauri::WebviewWindow, team: String, post: String) -> Result<(), String> {
    ui_only(&window)?;
    human_job(move |d, kc, h| post::remove(d, kc, h, &team, &post)).await?.spawn();
    Ok(())
}
