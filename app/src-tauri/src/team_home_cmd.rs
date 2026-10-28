//! 팀 홈 판 화면 명령(ADR 0018) — 메인 창·메신저 창(team-*)만. 네트워크라 전부 async + spawn_blocking(team_post_cmd 와 같은 모양)
use crate::team_home::{Content, Home};
use crate::team_home_store::{self as store, Board};

fn ui_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if crate::team_ui::ui_window(w.label()) { Ok(()) } else { Err("messenger windows only".into()) }
}

async fn job<T: Send + 'static>(f: impl FnOnce(&std::path::Path, &dyn crate::accounts_store::Store, &dyn crate::team_relay::Http) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(crate::config::data_dir(), &crate::team_relay_keys::store(), &crate::team_relay::Curl)).await.map_err(|e| e.to_string())?
}

/// 팀 하나의 홈 판 + 블록 내용 + 커버
#[tauri::command]
pub async fn team_home(window: tauri::WebviewWindow, team: String) -> Result<Board, String> {
    ui_only(&window)?;
    let (b, share) = job(move |d, kc, h| store::board(d, kc, h, &team)).await?;
    share.spawn();
    Ok(b)
}

/// 꾸미기 완료 — 판 한 장(팀장만)
#[tauri::command]
pub async fn team_home_save(window: tauri::WebviewWindow, team: String, home: Home) -> Result<(), String> {
    ui_only(&window)?;
    job(move |d, kc, h| store::save_home(d, kc, h, &team, home)).await?.spawn();
    Ok(())
}

/// 블록 안 내용 — 팀원 누구나
#[tauri::command]
pub async fn team_home_content(window: tauri::WebviewWindow, team: String, block: String, content: Content) -> Result<(), String> {
    ui_only(&window)?;
    job(move |d, kc, h| store::save_content(d, kc, h, &team, &block, content)).await?.spawn();
    Ok(())
}

/// 커버 사진 올리기(팀장만) — 파일 id. 판의 cover 로 넣고 완료해야 팀에 보인다
#[tauri::command]
pub async fn team_home_cover(window: tauri::WebviewWindow, team: String, image: String) -> Result<String, String> {
    ui_only(&window)?;
    let b = crate::team_profile_cmd::image(&image)?;
    job(move |d, kc, h| store::upload_cover(d, kc, h, &team, &b)).await
}
