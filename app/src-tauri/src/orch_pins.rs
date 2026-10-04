//! 참모 고정 — <데이터>/orch-pins.json(0600)에 대화 id(재웠다 깨워도 같다)를 고정한 순서대로.
//! 폰(참모 바꾸기 시트)과 데스크톱(사이드바 오케스트레이터 목록·채팅 탭·오케스트레이터 홈)이 같은 파일을 쓴다(2026-10-03 사용자 "PC 에도")
use std::path::Path;

static PIN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
const MAX_PINS: usize = 50;

pub fn read_pins(dir: &Path) -> Result<Vec<String>, String> {
    match std::fs::read_to_string(dir.join("orch-pins.json")) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| format!("orch-pins.json 을 못 읽어요: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn set_pin(dir: &Path, sid: &str, on: bool) -> Result<Vec<String>, String> {
    let _g = PIN_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut v = read_pins(dir)?; // 못 읽으면 덮어쓰지 않는다
    let had = v.iter().any(|x| x == sid);
    if on && !had {
        v.push(sid.to_string());
        if v.len() > MAX_PINS {
            v.remove(0);
        }
    } else if !on && had {
        v.retain(|x| x != sid);
    } else {
        return Ok(v);
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".orch-pins.{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    crate::mobile_files::write_private_tmp(&tmp, serde_json::to_string(&v).unwrap_or_default().as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join("orch-pins.json")).map_err(|e| e.to_string())?;
    Ok(v)
}


/// 데스크톱 — 고정 목록(대화 id, 고정한 순서). 없거나 못 읽으면 빈 목록
#[tauri::command]
pub fn read_orch_pins() -> Vec<String> {
    read_pins(crate::config::data_dir()).unwrap_or_default()
}

/// 데스크톱 — 고정·풀기. 돌려주는 건 바뀐 목록
#[tauri::command]
pub fn set_orch_pin(session_id: String, on: bool) -> Result<Vec<String>, String> {
    if !crate::mobile_http::is_session_uuid(&session_id) {
        return Err("bad session id".into());
    }
    set_pin(crate::config::data_dir(), &session_id, on)
}
