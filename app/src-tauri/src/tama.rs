//! 코인 재료(일한 시간 칸)·뽑기·사무실 저장 파일. 계산은 전부 프론트 — 여기선 파일 읽기/쓰기만
use tauri::Manager;

fn tama_path() -> std::path::PathBuf {
    crate::config::data_file("tama.json")
}

/// 일한 시간 칸 저장 파일. 없으면 빈 문자열(프론트가 빈 상태로 시작). 파싱은 domain/tama/store.ts
#[tauri::command]
pub fn read_tama() -> String {
    std::fs::read_to_string(tama_path()).unwrap_or_default()
}

/// 쓰는 도중에 끊겨도 안 깨지게 임시 파일에 쓰고 옮긴다
#[tauri::command]
pub fn write_tama(json: String) -> Result<(), String> {
    let path = tama_path();
    let tmp = path.with_extension("json.tmp");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 켤 때 — 없앤 대화 세기가 남긴 칸(0.4.9 까지). 없으면 그만
pub fn drop_old_files() {
    let _ = std::fs::remove_file(crate::config::data_file("tama-turns.json"));
}

/// Dock 아이콘 뱃지 — 결정 대기 개수(0 이면 지움). 패널을 닫아 놔도, 다른 앱을 보고 있어도 보이게
#[tauri::command]
pub fn set_badge(app: tauri::AppHandle, count: u32) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(if count > 0 { Some(count as i64) } else { None });
    }
}

/// 사무실 v2 옮기기 전 원본 — 옛 모양(marker 가 없는 파일)을 처음 덮어쓰기 직전에 `<이름>.json.bak` 로 한 번 남긴다. 이미 있으면 안 덮는다.
/// 옮기기는 사용자 데이터를 한 번에 바꾸는 일이라, 못 남기면 Err — 되돌릴 길 없이 덮어쓰지 않는다
fn keep_old_once(path: &std::path::Path, marker: &str) -> Result<(), String> {
    let bak = path.with_extension("json.bak");
    if bak.exists() {
        return Ok(());
    }
    let old = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()), // 처음 쓰는 파일 — 남길 게 없다
        Err(e) => return Err(format!("원본 못 읽음: {e}")),
    };
    if old.windows(marker.len()).any(|w| w == marker.as_bytes()) {
        return Ok(()); // 이미 새 모양
    }
    let tmp = path.with_extension("json.bak.tmp");
    std::fs::write(&tmp, &old).map_err(|e| format!("원본 못 남김: {e}"))?;
    std::fs::rename(&tmp, &bak).map_err(|e| format!("원본 못 남김: {e}"))
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
    keep_old_once(&path, "\"tamaMoved\"")?;
    let tmp = path.with_extension("json.tmp");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 폰 사무실 모양(자리표·반장·스킨·가구·장식 — domain/phoneOffice officeShape). 폰 서버 /api/office 가 읽기만 한다
#[tauri::command]
pub fn write_office(json: String) -> Result<(), String> {
    let path = crate::config::data_file("office.json");
    keep_old_once(&path, "\"offices\"")?;
    let tmp = path.with_extension("json.tmp");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 스페이스 고친 기록 꼬리(64KB) — 코인 재료(domain/tama/signals.spaceFeed)
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
    use super::keep_old_once;

    fn dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-keep-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn 옛_모양을_처음_덮기_전에_한_번만_남긴다() {
        let d = dir("once");
        let p = d.join("gacha.json");
        std::fs::write(&p, r#"{"coins":1255}"#).unwrap();
        keep_old_once(&p, "\"tamaMoved\"").unwrap();
        assert_eq!(std::fs::read_to_string(d.join("gacha.json.bak")).unwrap(), r#"{"coins":1255}"#);
        // 다음 차례(이미 .bak 있음·파일은 바뀜) — 원본이 안 덮인다
        std::fs::write(&p, r#"{"coins":9999}"#).unwrap();
        keep_old_once(&p, "\"tamaMoved\"").unwrap();
        assert_eq!(std::fs::read_to_string(d.join("gacha.json.bak")).unwrap(), r#"{"coins":1255}"#);
    }

    #[test]
    fn 새_모양이거나_파일이_없으면_안_남긴다() {
        let d = dir("skip");
        let p = d.join("gacha.json");
        keep_old_once(&p, "\"tamaMoved\"").unwrap();
        assert!(!d.join("gacha.json.bak").exists(), "처음 쓰는 파일");
        std::fs::write(&p, r#"{"coins":1,"tamaMoved":{"at":1}}"#).unwrap();
        keep_old_once(&p, "\"tamaMoved\"").unwrap();
        assert!(!d.join("gacha.json.bak").exists(), "이미 옮긴 파일");
    }

    #[test]
    fn 못_남기면_오류_덮어쓰지_않게() {
        let d = dir("fail");
        let p = d.join("gacha.json");
        std::fs::write(&p, r#"{"coins":1}"#).unwrap();
        std::fs::create_dir_all(d.join("gacha.json.bak.tmp")).unwrap(); // 임시 파일 자리를 폴더로 막는다
        assert!(keep_old_once(&p, "\"tamaMoved\"").is_err());
    }
}
