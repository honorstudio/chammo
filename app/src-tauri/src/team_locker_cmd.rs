//! 팀 보관함·대화 파일 화면 명령 — 메인 창·메신저 창(team-*)만. 사용자 폴더(끌어 넣은 파일·~/Documents/Chammo)를 건드려서
//! 전부 async + spawn_blocking(메인 스레드에서 열면 맥 권한 창이 앱을 세운다 — offmain)
use crate::team_locker::FileRef;
use crate::team_locker_app::{self as app, View};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn ui_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if crate::team_ui::ui_window(w.label()) { Ok(()) } else { Err("messenger windows only".into()) }
}

async fn job<T: Send + 'static>(f: impl FnOnce(&Path, &dyn crate::accounts_store::Store, &dyn crate::team_relay::Http) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(crate::config::data_dir(), &crate::team_relay_keys::store(), &crate::team_relay::Curl)).await.map_err(|e| e.to_string())?
}

/// 끌어 넣은 경로 — 절대 경로 파일만, 한 번에 50개까지
fn files(paths: Vec<String>) -> Result<Vec<PathBuf>, String> {
    if paths.is_empty() || paths.len() > 50 {
        return Err("파일은 한 번에 1~50개".into());
    }
    Ok(paths.into_iter().map(PathBuf::from).filter(|p| p.is_absolute()).collect())
}

/// 팀 보관함 목록 — 보여 줄 줄만 먼저 돌려주고, 나중에 든 사람 몫 봉투 더하기는 뒤 스레드로(방마다 중계를 또 부른다)
#[tauri::command]
pub async fn team_locker_list(window: tauri::WebviewWindow, team: String) -> Result<View, String> {
    ui_only(&window)?;
    let (v, share) = job(move |d, kc, h| app::list_split(d, kc, h, &team)).await?;
    std::thread::spawn(move || share.run(crate::config::data_dir(), &crate::team_relay_keys::store(), &crate::team_relay::Curl));
    Ok(v)
}

/// 열자마자 — 기기에 봉해 둔 마지막 목록(망 안 씀). 없으면 null
#[tauri::command]
pub async fn team_locker_cached(window: tauri::WebviewWindow, team: String) -> Result<Option<View>, String> {
    ui_only(&window)?;
    job(move |d, kc, _| Ok(app::cached(d, kc, &team))).await
}

/// 끌어 넣기 — 뒤에서 하나씩 올리고 바로 돌아간다(진행은 team_locker_poll)
#[tauri::command]
pub async fn team_locker_put(window: tauri::WebviewWindow, team: String, paths: Vec<String>, folder: Option<String>) -> Result<(), String> {
    ui_only(&window)?;
    let paths = files(paths)?;
    let folder = folder.unwrap_or_default();
    std::thread::spawn(move || {
        let (d, kc, h) = (crate::config::data_dir(), crate::team_relay_keys::store(), crate::team_relay::Curl);
        for p in paths {
            let _ = app::put_file_in(d, &kc, &h, &team, "", "file", &folder, &p);
        }
    });
    Ok(())
}

/// 화면이 2초마다 — 올리는 중 줄 + 소켓이 새 판을 알렸나(데이터 폴더·메모리만, 사용자 폴더 안 건드림)
#[tauri::command]
pub fn team_locker_poll(window: tauri::WebviewWindow, team: String) -> Result<Value, String> {
    ui_only(&window)?;
    Ok(json!({ "uploads": app::uploads(&team), "changed": app::changed(&team) }))
}

#[tauri::command]
pub fn team_locker_dismiss(window: tauri::WebviewWindow, local: String) -> Result<(), String> {
    ui_only(&window)?;
    app::dismiss(&local);
    Ok(())
}

/// 열기 — 데이터 폴더 자리(team-locker-peek)에 풀고 그 경로. 화면이 스페이스(show 길)로 연다.
/// external = 스페이스가 못 그리는 형식·'다른 앱으로 열기' — 그때만 맥 기본 앱으로도 연다(10-26 사용자)
#[tauri::command]
pub async fn team_locker_open(window: tauri::WebviewWindow, team: String, id: String, external: Option<bool>) -> Result<String, String> {
    ui_only(&window)?;
    job(move |d, kc, h| {
        let p = app::view(d, kc, h, &team, &id)?;
        if external.unwrap_or(false) {
            crate::platform::open_path(&p.to_string_lossy()).map_err(|e| format!("못 열었어: {e}"))?;
        }
        Ok(p.to_string_lossy().into_owned())
    })
    .await
}

/// 스페이스 탭 내려받기 — 풀어 둔 팀 파일을 다운로드 폴더로 복사하고 파인더에서 보인다. 복사한 경로
#[tauri::command]
pub async fn team_locker_download(window: tauri::WebviewWindow, path: String) -> Result<String, String> {
    ui_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let home = crate::platform::home();
        if home.is_empty() {
            return Err("다운로드 폴더를 못 찾았어".to_string());
        }
        let out = PathBuf::from(home).join("Downloads");
        let p = app::copy_out(crate::config::data_dir(), Path::new(&path), &out)?;
        #[cfg(target_os = "macos")]
        let _ = crate::platform::command("open").arg("-R").arg(&p).status();
        #[cfg(windows)]
        let _ = crate::platform::command("explorer").arg(format!("/select,{}", p.display())).status();
        Ok(p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 새 폴더(빈 폴더 표시 줄)
#[tauri::command]
pub async fn team_locker_mkdir(window: tauri::WebviewWindow, team: String, folder: String) -> Result<(), String> {
    ui_only(&window)?;
    job(move |d, kc, h| app::mkdir(d, kc, h, &team, &folder)).await
}

/// 폴더 이름 바꾸기(to) · 지우기(to 없음 — 안의 파일은 휴지통으로). 옮긴 수
#[tauri::command]
pub async fn team_locker_folder(window: tauri::WebviewWindow, team: String, from: String, to: Option<String>) -> Result<usize, String> {
    ui_only(&window)?;
    job(move |d, kc, h| app::folder(d, kc, h, &team, &from, to.as_deref())).await
}

/// 미리보기·썸네일용으로 받기(데이터 폴더) — 받은 경로
#[tauri::command]
pub async fn team_locker_peek(window: tauri::WebviewWindow, team: String, id: String) -> Result<String, String> {
    ui_only(&window)?;
    job(move |d, kc, h| app::peek(d, kc, h, &team, &id).map(|p| p.to_string_lossy().into_owned())).await
}

/// + 단추 — 파일 창(앱 창에 붙는 시트)으로 골라 올린다. 고른 개수
#[tauri::command]
pub async fn team_locker_pick(app_handle: tauri::AppHandle, window: tauri::WebviewWindow, team: String, folder: Option<String>) -> Result<usize, String> {
    ui_only(&window)?;
    let files = tauri::async_runtime::spawn_blocking(move || crate::agent_browser::choose_files(&app_handle, true, crate::i18n::tr("팀 보관함에 넣을 파일", "Files to put in the team locker")))
        .await
        .map_err(|e| e.to_string())??;
    let n = files.len();
    if n > 0 {
        team_locker_put(window, team, files, folder).await?;
    }
    Ok(n)
}

/// 내려받기만(파인더에서 보이게) — 받은 경로
#[tauri::command]
pub async fn team_locker_save(window: tauri::WebviewWindow, team: String, id: String) -> Result<String, String> {
    ui_only(&window)?;
    job(move |d, kc, h| app::fetch(d, kc, h, &team, &id).map(|p| p.to_string_lossy().into_owned())).await
}

/// 이름 바꾸기·폴더 옮기기(안 준 칸은 그대로)
#[tauri::command]
pub async fn team_locker_rename(window: tauri::WebviewWindow, team: String, id: String, name: Option<String>, folder: Option<String>) -> Result<(), String> {
    ui_only(&window)?;
    job(move |d, kc, h| app::rename(d, kc, h, &team, &id, name.as_deref(), folder.as_deref())).await
}

/// trash | restore | purge
#[tauri::command]
pub async fn team_locker_act(window: tauri::WebviewWindow, team: String, id: String, verb: String) -> Result<(), String> {
    ui_only(&window)?;
    job(move |d, kc, h| app::act(d, kc, h, &team, &id, &verb)).await
}

/// 채팅 붙이기 — 그 방 사람 기기마다 봉투로 올리고 참조를 돌려준다(메시지 봉투 안쪽 files 에 싣는다)
#[tauri::command]
pub async fn team_file_attach(window: tauri::WebviewWindow, team: String, room: String, paths: Vec<String>) -> Result<Vec<FileRef>, String> {
    ui_only(&window)?;
    if room.is_empty() {
        return Err("방이 비었어".into());
    }
    let paths = files(paths)?;
    job(move |d, kc, h| paths.iter().map(|p| app::put_file(d, kc, h, &team, &room, "file", p)).collect()).await
}

/// 받은 파일 열기(대화 파일 풍선) — 보관함 열기와 같은 길
#[tauri::command]
pub async fn team_file_open(window: tauri::WebviewWindow, team: String, id: String, external: Option<bool>) -> Result<String, String> {
    team_locker_open(window, team, id, external).await
}

#[tauri::command]
pub async fn team_file_save(window: tauri::WebviewWindow, team: String, id: String) -> Result<String, String> {
    team_locker_save(window, team, id).await
}
