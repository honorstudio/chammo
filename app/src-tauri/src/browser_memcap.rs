//! 참모 브라우저 메모리 상한(2026-11-16 맥 멈춤 사고) — 설정 값과 래퍼가 남긴 기록.
//! 상한은 <데이터>/tools/chammo-browser/memcap.json(래퍼 src/memcap.js readCaps 와 같은 규칙), 기록은 <데이터>/browser/run/memcap.jsonl.
//! 명령은 파일을 만지니 메인 스레드 밖(async)에서 돈다(offmain_scan). 앱 화면이 기록을 가져가 그 세션(스크립트 길)과 맡긴 참모에게 [앱] 한 줄을 보낸다(ui/useBrowserMemcap)
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Caps {
    pub profile_gb: f64,
    pub total_gb: f64,
}

impl Default for Caps {
    fn default() -> Self {
        Caps { profile_gb: 6.0, total_gb: 12.0 }
    }
}

fn ok(v: f64) -> bool {
    v.is_finite() && (0.5..=256.0).contains(&v)
}

pub fn caps_file(data: &Path) -> PathBuf {
    crate::browser::tool_dir(data).join("memcap.json")
}

fn events_file(data: &Path) -> PathBuf {
    data.join("browser").join("run").join("memcap.jsonl")
}

/// 읽기 — 없거나 이상한 값은 기본, 전체는 프로필보다 작지 않게(래퍼와 같다)
pub fn read_caps(data: &Path) -> Caps {
    let raw: serde_json::Value = std::fs::read_to_string(caps_file(data)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let get = |k: &str, d: f64| raw.get(k).and_then(|v| v.as_f64()).filter(|v| ok(*v)).unwrap_or(d);
    let d = Caps::default();
    let profile_gb = get("profileGb", d.profile_gb);
    Caps { profile_gb, total_gb: get("totalGb", d.total_gb).max(profile_gb) }
}

pub fn write_caps(data: &Path, c: Caps) -> Result<Caps, String> {
    if !ok(c.profile_gb) || !ok(c.total_gb) {
        return Err(crate::i18n::tr("상한은 0.5~256GB", "Limits must be 0.5–256 GB").into());
    }
    let c = Caps { total_gb: c.total_gb.max(c.profile_gb), ..c };
    let f = caps_file(data);
    std::fs::create_dir_all(f.parent().unwrap_or(data)).map_err(|e| e.to_string())?;
    std::fs::write(&f, serde_json::to_string(&c).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(c)
}

/// since(ISO 시각) 뒤 기록 — 최근 20개. 깨진 줄은 버린다
pub fn events_after(data: &Path, since: &str) -> Vec<serde_json::Value> {
    let text = std::fs::read_to_string(events_file(data)).unwrap_or_default();
    let mut out: Vec<serde_json::Value> = text
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|v| v.get("at").and_then(|a| a.as_str()).is_some_and(|a| a > since))
        .collect();
    let n = out.len();
    out.drain(..n.saturating_sub(20));
    out
}

#[tauri::command(async)]
pub fn browser_memcap_get() -> Caps {
    read_caps(&crate::config::data_dir())
}

#[tauri::command(async)]
pub fn browser_memcap_set(caps: Caps) -> Result<Caps, String> {
    write_caps(&crate::config::data_dir(), caps)
}

#[tauri::command(async)]
pub fn browser_memcap_events(since: String) -> Vec<serde_json::Value> {
    events_after(&crate::config::data_dir(), &since)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("memcap-{}-{}", std::process::id(), rand_tag()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn rand_tag() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    #[test]
    fn caps_default_and_rules() {
        let d = tmp();
        assert_eq!(read_caps(&d), Caps::default());
        assert!(caps_file(&d).ends_with("tools/chammo-browser/memcap.json"), "래퍼 memcap.js capsFile 과 같은 자리");
        assert_eq!(write_caps(&d, Caps { profile_gb: 8.0, total_gb: 4.0 }).unwrap(), Caps { profile_gb: 8.0, total_gb: 8.0 });
        assert_eq!(read_caps(&d), Caps { profile_gb: 8.0, total_gb: 8.0 });
        assert!(write_caps(&d, Caps { profile_gb: 0.1, total_gb: 4.0 }).is_err());
        std::fs::write(caps_file(&d), r#"{"profileGb":"x","totalGb":-1}"#).unwrap();
        assert_eq!(read_caps(&d), Caps::default());
    }

    #[test]
    fn events_after_since() {
        let d = tmp();
        assert!(events_after(&d, "").is_empty());
        let f = events_file(&d);
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(&f, "{\"at\":\"2026-11-16T13:00:00Z\",\"profile\":\"a\"}\n깨진 줄\n{\"at\":\"2026-11-16T13:05:00Z\",\"profile\":\"b\"}\n").unwrap();
        let all = events_after(&d, "");
        assert_eq!(all.len(), 2);
        let later = events_after(&d, "2026-11-16T13:00:00Z");
        assert_eq!(later.len(), 1);
        assert_eq!(later[0]["profile"], "b");
    }
}
