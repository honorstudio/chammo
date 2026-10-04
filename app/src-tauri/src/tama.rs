//! 다마고치 위젯 창과 저장 파일. 계산은 전부 프론트(domain/tama) — 여기선 파일 읽기/쓰기와 창 조작만
use tauri::Manager;

fn tama_path() -> std::path::PathBuf {
    crate::config::data_file("tama.json")
}

/// 다마고치 저장 파일. 없으면 빈 문자열(프론트가 빈 상태로 시작). 파싱은 domain/tama/store.ts
#[tauri::command]
pub fn read_tama() -> String {
    std::fs::read_to_string(tama_path()).unwrap_or_default()
}

/// 쓰는 도중에 위젯 창이 읽어도 안 깨지게 임시 파일에 쓰고 옮긴다
#[tauri::command]
pub fn write_tama(json: String) -> Result<(), String> {
    let path = tama_path();
    let tmp = path.with_extension("json.tmp");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 테두리 없는 창이라 끌어 옮기기를 직접 시작한다(권한 파일 없이 되게 커스텀 명령으로)
#[tauri::command]
pub fn tama_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

/// 위젯 보이기/숨기기. visible 을 안 주면 지금 상태만 알려준다 — 숨기면 상단 바에 작게 뜬다
#[tauri::command]
pub fn tama_widget(app: tauri::AppHandle, visible: Option<bool>) -> bool {
    let Some(w) = app.get_webview_window("tama") else { return false };
    match visible {
        Some(true) => { let _ = w.show(); }
        Some(false) => { let _ = w.hide(); }
        None => {}
    }
    w.is_visible().unwrap_or(false)
}

/// 위젯 → 메인 창 부탁("dex" = 다마고치 페이지 열어줘). 창끼리 이벤트는 권한 파일이 필요해서 한 칸짜리 우편함으로 대신한다.
/// kind 를 주면 넣고 메인 창을 앞으로, 안 주면(메인 창이 0.3초마다) 꺼내 간다
static REQUEST: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[tauri::command]
pub fn tama_request(app: tauri::AppHandle, kind: Option<String>) -> Option<String> {
    let mut slot = REQUEST.lock().unwrap();
    match kind {
        Some(k) => {
            *slot = Some(k);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            None
        }
        None => slot.take(),
    }
}

/// Dock 아이콘 뱃지 — 결정 대기 개수(0 이면 지움). 패널을 닫아 놔도, 다른 앱을 보고 있어도 보이게
#[tauri::command]
pub fn set_badge(app: tauri::AppHandle, count: u32) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(if count > 0 { Some(count as i64) } else { None });
    }
}

/// 처음 켤 때 위젯을 주 화면 오른쪽 위에
pub fn place(app: &tauri::App) {
    let Some(w) = app.get_webview_window("tama") else { return };
    let (Ok(Some(m)), Ok(size)) = (w.primary_monitor(), w.outer_size()) else { return };
    let x = m.position().x + m.size().width as i32 - size.width as i32 - (24.0 * m.scale_factor()) as i32;
    let y = m.position().y + (64.0 * m.scale_factor()) as i32;
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
}

fn gacha_path() -> std::path::PathBuf {
    crate::config::data_file("gacha.json")
}

/// 머지 가챠 저장 파일(코인·가진 것·천장). 없으면 빈 문자열. 파싱은 domain/gacha.ts
#[tauri::command]
pub fn read_gacha() -> String {
    std::fs::read_to_string(gacha_path()).unwrap_or_default()
}

/// 임시 파일에 쓰고 옮긴다(뽑는 순간 앱이 꺼져도 반쯤 쓴 파일이 안 남게)
#[tauri::command]
pub fn write_gacha(json: String) -> Result<(), String> {
    let path = gacha_path();
    let tmp = path.with_extension("json.tmp");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 다마고치 '대화' 먹이 — 대화 기록 한 줄이 사람이 직접 건 말이면 그 시각(ISO). 도구 결과·메타·슬래시 명령·앱이 넣은 [앱] 알림·
/// 다른 세션이 보낸 말(peer)·작업 끝 알림은 빼고, origin.kind 가 human 인 user 줄만
fn human_turn_ts(line: &str) -> Option<String> {
    if !line.contains("\"human\"") || !line.contains("\"user\"") {
        return None; // 대부분의 줄을 JSON 파싱 없이 거른다
    }
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "user" || v.get("isMeta").and_then(|m| m.as_bool()).unwrap_or(false) {
        return None;
    }
    if v.pointer("/origin/kind").and_then(|k| k.as_str()) != Some("human") {
        return None;
    }
    let content = v.pointer("/message/content")?;
    let text = match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(a) => {
            if a.iter().any(|x| x.get("type").and_then(|t| t.as_str()) == Some("tool_result")) {
                return None;
            }
            a.iter().find_map(|x| x.get("text").and_then(|t| t.as_str())).unwrap_or("").to_string()
        }
        _ => return None,
    };
    let t = text.trim_start();
    if t.is_empty() || t.starts_with("[앱]") || t.starts_with("<command-") || t.starts_with("<local-command") {
        return None;
    }
    v.get("timestamp")?.as_str().map(str::to_string)
}

/// 대화 기록마다 어디까지 읽었나 + 찾은 시각들 — 1분마다 불려도 새로 붙은 줄만 읽는다(기록이 수십 MB 라)
static TURNS: std::sync::Mutex<Option<std::collections::HashMap<std::path::PathBuf, (u64, Vec<String>)>>> = std::sync::Mutex::new(None);
const TURNS_KEEP: usize = 400;

/// 세션들(대화 기록 id)에 사람이 건 말의 시각 — `대화 기록 id\t시각` 줄. 파싱은 domain/tama/signals.talkFeed
#[tauri::command]
pub async fn human_turns(session_ids: Vec<String>) -> String {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{Read, Seek, SeekFrom};
        let home = crate::platform::home();
        let dirs: Vec<_> = std::fs::read_dir(format!("{home}/.claude/projects")).map(|rd| rd.flatten().map(|e| e.path()).collect()).unwrap_or_default();
        let mut guard = TURNS.lock().unwrap();
        let cache = guard.get_or_insert_with(Default::default);
        let mut out = String::new();
        for sid in session_ids {
            let Some(path) = dirs.iter().map(|d| d.join(format!("{sid}.jsonl"))).find(|p| p.exists()) else { continue };
            let entry = cache.entry(path.clone()).or_insert((0, Vec::new()));
            let len = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            if len < entry.0 {
                *entry = (0, Vec::new()); // 기록이 새로 쓰였다
            }
            if len > entry.0 {
                if let Ok(mut f) = std::fs::File::open(&path) {
                    let _ = f.seek(SeekFrom::Start(entry.0));
                    let mut buf = Vec::new();
                    let _ = f.read_to_end(&mut buf);
                    // 끝까지 안 쓰인 줄은 다음에 — 마지막 줄바꿈까지만
                    let upto = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
                    for line in String::from_utf8_lossy(&buf[..upto]).lines() {
                        if let Some(ts) = human_turn_ts(line) {
                            entry.1.push(ts);
                        }
                    }
                    let n = entry.1.len();
                    if n > TURNS_KEEP {
                        entry.1.drain(..n - TURNS_KEEP);
                    }
                    entry.0 += upto as u64;
                }
            }
            for ts in &entry.1 {
                out.push_str(&format!("{sid}\t{ts}\n"));
            }
        }
        out
    })
    .await
    .unwrap_or_default()
}

/// 스페이스 고친 기록 꼬리(64KB) — 다마고치 목욕·놀아주기·대화(domain/tama/signals.spaceFeed)
#[tauri::command]
pub fn read_space_log() -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(crate::config::data_file("space-log.jsonl")) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(64 * 1024)));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

#[cfg(test)]
mod tests {
    use super::human_turn_ts;

    #[test]
    fn human_turn_only_people() {
        let typed = r#"{"type":"user","message":{"role":"user","content":"ㄱㄱ"},"timestamp":"2026-10-02T14:57:53.339Z","origin":{"kind":"human"},"promptSource":"typed"}"#;
        assert_eq!(human_turn_ts(typed).as_deref(), Some("2026-10-02T14:57:53.339Z"));
        let arr = r#"{"type":"user","message":{"content":[{"type":"text","text":"사진 봐"}]},"timestamp":"T","origin":{"kind":"human"}}"#;
        assert_eq!(human_turn_ts(arr).as_deref(), Some("T"));
        for no in [
            r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"x"}]},"timestamp":"T","origin":{"kind":"human"}}"#,
            r#"{"type":"user","isMeta":true,"message":{"content":"x"},"timestamp":"T","origin":{"kind":"human"}}"#,
            r#"{"type":"user","message":{"content":"[앱] project-b / 멈춤"},"timestamp":"T","origin":{"kind":"human"}}"#,
            r#"{"type":"user","message":{"content":"<command-name>/clear</command-name>"},"timestamp":"T","origin":{"kind":"human"}}"#,
            r#"{"type":"user","message":{"content":"<task-notification>"},"timestamp":"T","origin":{"kind":"task-notification"}}"#,
            r#"{"type":"user","message":{"content":"from peer"},"timestamp":"T","turnOrigin":"peer"}"#,
            r#"{"type":"assistant","message":{"content":"human"},"timestamp":"T","origin":{"kind":"human"}}"#,
        ] {
            assert_eq!(human_turn_ts(no), None, "{no}");
        }
    }
}
