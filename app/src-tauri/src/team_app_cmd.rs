//! 팀 캘린더 화면 명령(chammo-relay ADR 0011) — 메인 창·메신저 창(team-*)만. 첫 그림은 망 없이(cached), 따라잡기는 저절로(bg_job), 쓰기는 사람이 누름(human_job)
use crate::team_app::APP_CAL;
use crate::team_app_store::{self as store, Snap, WriteOut};
use crate::team_relay::{bg_job, human_job};
use serde_json::{json, Value};

fn ui_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if crate::team_ui::ui_window(w.label()) { Ok(()) } else { Err("messenger windows only".into()) }
}

/// 열자마자 — 메모리·기기 봉한 캐시(망 안 씀). 처음이면 null. 키체인·풀기는 뒤 스레드(bg_job)에서 — 1초 poll 마다 불려 메인 스레드를 안 막게
#[tauri::command]
pub async fn team_cal_cached(window: tauri::WebviewWindow, team: String) -> Result<Option<Snap>, String> {
    ui_only(&window)?;
    bg_job(move |d, kc, _| Ok(store::load(d, kc, &team, APP_CAL))).await
}

/// 따라잡기 — 본 판 뒤 기록만(처음은 통째). 나중에 든 사람 몫 열쇠 봉투는 뒤에서.
/// 이 기기에 그릴 게 아무것도 없으면(처음 여는 것) 사람이 화면을 연 것으로 친다 — 배경 몫에 막혀 빈 화면에 '잠시 쉬래요'만 뜨지 않게(10-30 사용자 캡처)
#[tauri::command]
pub async fn team_cal(window: tauri::WebviewWindow, team: String) -> Result<Snap, String> {
    ui_only(&window)?;
    let t = team.clone();
    let first = bg_job(move |d, kc, _| Ok(store::load(d, kc, &t, APP_CAL).is_none())).await?;
    let go = move |d: &std::path::Path, kc: &dyn crate::accounts_store::Store, h: &dyn crate::team_relay::Http| store::sync(d, kc, h, &team, APP_CAL);
    let (s, share) = if first { human_job(go).await? } else { bg_job(go).await? };
    share.spawn();
    Ok(s)
}

/// 화면이 1초마다(team = 팀 id) — 바뀐 번호와 '다시 받아야 함'(소켓이 기록째를 못 실었음). 망 안 씀
#[tauri::command]
pub fn team_cal_poll(window: tauri::WebviewWindow, team: String) -> Result<Value, String> {
    ui_only(&window)?;
    let d = crate::config::data_dir();
    Ok(json!({ "ver": store::ver(d, &team, APP_CAL), "stale": store::stale(d, &team, APP_CAL) }))
}

/// 만들기·고치기·지우기 — base = 고치기 시작한 판(0 = 새로), before = 그때 내용, data null = 지우기, restore = 지운 일정 다시 살리기
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn team_cal_put(window: tauri::WebviewWindow, team: String, id: String, base: u64, before: Option<Value>, data: Option<Value>, restore: Option<bool>) -> Result<WriteOut, String> {
    ui_only(&window)?;
    human_job(move |d, kc, h| store::write(d, kc, h, &team, APP_CAL, &id, base, before, data, restore.unwrap_or(false))).await
}
