//! 입력칸 쓰던 글 — 대화마다(팀챗·DM·참모 채팅) <데이터>/drafts.json(0600). 화면을 나갔다 오거나 앱을 다시 켜도 남는다(10-28 팀원 —
//! 대화하다 나가면 쓰던 글이 지워졌다). 비밀(키·비밀번호)을 붙였다 지우기 전에 나갈 수도 있어 웹뷰 localStorage 대신 여기, 나만 읽게.
//! 화면은 켤 때 한 번 통째로 읽고(drafts_read), 바뀐 대화만 모아 쓴다(drafts_write) — 창이 둘이어도 서로의 대화를 덮지 않는다
use std::collections::HashMap;
use std::path::Path;

pub(crate) const FILE: &str = "drafts.json";
static WRITE: std::sync::Mutex<()> = std::sync::Mutex::new(());
/// 대화 수 — 넘치면 오래 안 쓴 것부터
pub(crate) const MAX_KEYS: usize = 300;
pub(crate) const MAX_KEY: usize = 200;
/// 한 대화 글(JSON 째) — 입력칸에 붙인 긴 글까지, 그 이상은 거절(화면은 메모리에 그대로 둔다)
pub(crate) const MAX_VALUE: usize = 200_000;

#[derive(serde::Serialize, serde::Deserialize)]
struct Entry {
    v: String,
    at: u64,
}

fn load(dir: &Path) -> Result<HashMap<String, Entry>, String> {
    match std::fs::read_to_string(dir.join(FILE)) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| format!("{FILE} 을 못 읽어요: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// 대화 열쇠 → 저장한 글(화면이 정한 JSON 글 그대로). 없거나 못 읽으면 빈 목록
pub fn read(dir: &Path) -> HashMap<String, String> {
    load(dir).map(|m| m.into_iter().map(|(k, e)| (k, e.v)).collect()).unwrap_or_default()
}

/// 바뀐 대화만 — None 이면 지운다. 하나라도 틀리면(열쇠·길이) 통째로 거절, 못 읽는 파일은 덮지 않는다
pub fn write(dir: &Path, changes: HashMap<String, Option<String>>, now: u64) -> Result<(), String> {
    for (k, v) in &changes {
        if k.is_empty() || k.chars().count() > MAX_KEY || k.chars().any(char::is_control) {
            return Err("bad draft key".into());
        }
        if v.as_ref().is_some_and(|v| v.len() > MAX_VALUE) {
            return Err("draft too long".into());
        }
    }
    let _g = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let mut m = load(dir)?;
    for (k, v) in changes {
        match v {
            Some(v) => {
                m.insert(k, Entry { v, at: now });
            }
            None => {
                m.remove(&k);
            }
        }
    }
    while m.len() > MAX_KEYS {
        let Some(old) = m.iter().min_by_key(|(_, e)| e.at).map(|(k, _)| k.clone()) else { break };
        m.remove(&old);
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".drafts.{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    crate::mobile_files::write_private_tmp(&tmp, serde_json::to_string(&m).unwrap_or_default().as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(FILE)).map_err(|e| e.to_string())
}

/// 화면이 켤 때 한 번 — 데이터 폴더만 만져서 메인 스레드 그대로(offmain)
#[tauri::command]
pub fn drafts_read() -> HashMap<String, String> {
    read(crate::config::data_dir())
}

#[tauri::command]
pub fn drafts_write(changes: HashMap<String, Option<String>>) -> Result<(), String> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    write(crate::config::data_dir(), changes, now)
}

#[cfg(test)]
#[path = "drafts_tests.rs"]
mod tests;
