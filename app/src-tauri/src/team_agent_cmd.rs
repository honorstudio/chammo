//! 팀 참모 화면 명령 — 메인 창·메신저 창(team-*)만. 네트워크·데이터 폴더·claude -p 라 전부 async + spawn_blocking(team_post_cmd 와 같은 모양)
use crate::team_agent::Def;
use crate::team_agent_store::{self as store, List};

fn ui_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if crate::team_ui::ui_window(w.label()) { Ok(()) } else { Err("messenger windows only".into()) }
}

async fn job<T: Send + 'static>(f: impl FnOnce(&std::path::Path, &dyn crate::accounts_store::Store, &dyn crate::team_relay::Http) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(crate::config::data_dir(), &crate::team_relay_keys::store(), &crate::team_relay::Curl)).await.map_err(|e| e.to_string())?
}

/// 팀 하나(빈 글 = 지금 팀)의 팀 참모 목록 + 이 기기가 확인한 판
#[tauri::command]
pub async fn team_agents(window: tauri::WebviewWindow, team: String) -> Result<List, String> {
    ui_only(&window)?;
    let (l, share) = job(move |d, kc, h| store::list(d, kc, h, &team)).await?;
    share.spawn();
    Ok(l)
}

/// 망 없이 마지막 목록(부르기 메뉴·말풍선 얼굴) — 팀 id
#[tauri::command]
pub async fn team_agents_cached(window: tauri::WebviewWindow, team: String) -> Result<List, String> {
    ui_only(&window)?;
    job(move |d, _, _| Ok(List { team: team.clone(), agents: store::cached(d, &team), seen: store::seen(d), ..Default::default() })).await
}

/// 만들기·고치기(origin = 참모 id) — 참모 id
#[tauri::command]
pub async fn team_agent_save(window: tauri::WebviewWindow, team: String, def: Def, origin: Option<String>) -> Result<String, String> {
    ui_only(&window)?;
    let (id, share) = job(move |d, kc, h| store::save(d, kc, h, &team, def, origin.as_deref())).await?;
    share.spawn();
    Ok(id)
}

/// 지우기 — 만든 사람·팀장만
#[tauri::command]
pub async fn team_agent_remove(window: tauri::WebviewWindow, team: String, id: String) -> Result<(), String> {
    ui_only(&window)?;
    job(move |d, kc, h| store::remove(d, kc, h, &team, &id)).await?.spawn();
    Ok(())
}

/// 지금 판을 확인했다(보내기 직전 확인 장) — 캐시의 판으로만(화면이 보낸 정의는 안 믿는다)
#[tauri::command]
pub async fn team_agent_confirm(window: tauri::WebviewWindow, team: String, id: String) -> Result<(), String> {
    ui_only(&window)?;
    job(move |d, _, _| {
        let a = store::cached(d, &team).into_iter().find(|a| a.id == id).ok_or("그 팀 참모를 못 찾았어 — 목록을 다시 받아 줘")?;
        store::confirm(d, &a)
    })
    .await
}

/// 그 방 팀 참모 답의 토큰(이 기기에서 부른 것만) — seq → [모델, 토큰]
#[tauri::command]
pub async fn team_agent_usage(window: tauri::WebviewWindow, room: String) -> Result<std::collections::BTreeMap<u64, (String, u64)>, String> {
    ui_only(&window)?;
    job(move |d, _, _| Ok(store::usage(d, &room))).await
}

/// 시험으로 불러 보기 — 방엔 안 올린다
#[tauri::command]
pub async fn team_agent_try(window: tauri::WebviewWindow, team: String, room: String, def: Def, ask: String, prev: Vec<(String, String)>) -> Result<crate::team_helper::Tried, String> {
    ui_only(&window)?;
    job(move |d, _, _| crate::team_helper::try_agent(d, &team, &room, def, &ask, prev)).await
}
