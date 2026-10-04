//! 모델 칩이 `/model sonnet`·`/effort high` 를 치면 Claude Code 가 그 값을 "새 세션 기본값"으로 ~/.claude/settings.json 에도 적는다(2026-10-01 실측).
//! 칩은 "이 세션만" 바꾸는 거라 — 치기 전에 기본값 칸(model·effortLevel·modelSettings)을 떠 두고, 결과가 뜨면 그 칸만 되돌린다.
//! 돌고 있는 세션은 파일을 되돌려도 바꾼 값을 그대로 쓴다(실측). 나머지 칸은 안 건드리고, 칸 순서도 그대로 둔다
use std::path::{Path, PathBuf};

const KEYS: &[&str] = &["model", "effortLevel", "modelSettings"];

/// Claude Code 사용자 설정 파일 — CLAUDE_CONFIG_DIR 가 있으면 그 밑
pub fn settings_path(home: &Path, config_dir: Option<&str>) -> PathBuf {
    match config_dir {
        Some(d) if !d.is_empty() => PathBuf::from(d).join("settings.json"),
        _ => home.join(".claude").join("settings.json"),
    }
}

/// 기본값 칸만 뜬다 — 없던 칸은 안 담는다(되돌릴 때 지운다)
pub fn snapshot(text: &str) -> serde_json::Value {
    let v: serde_json::Value = serde_json::from_str(text).unwrap_or_else(|_| serde_json::json!({}));
    let mut out = serde_json::Map::new();
    for k in KEYS {
        if let Some(x) = v.get(*k) {
            out.insert((*k).into(), x.clone());
        }
    }
    serde_json::Value::Object(out)
}

/// 지금 파일 글에 떠 둔 칸을 되돌린 새 글 — 바꿀 게 없으면 None(파일을 안 쓴다). 글이 JSON 이 아니면 안 건드린다
pub fn restored(text: &str, snap: &serde_json::Value) -> Option<String> {
    let mut v: serde_json::Value = serde_json::from_str(text).ok()?;
    let obj = v.as_object_mut()?;
    let before = obj.clone();
    for k in KEYS {
        match snap.get(*k) {
            Some(x) => { obj.insert((*k).into(), x.clone()); }
            None => { obj.remove(*k); }
        }
    }
    if *obj == before {
        return None;
    }
    Some(serde_json::to_string_pretty(&v).ok()? + "\n")
}

fn path() -> PathBuf {
    settings_path(Path::new(&crate::config::home()), std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref())
}

#[tauri::command]
pub fn claude_defaults_snapshot() -> String {
    snapshot(&std::fs::read_to_string(path()).unwrap_or_default()).to_string()
}

/// 되돌렸으면 true
#[tauri::command]
pub fn claude_defaults_restore(snap: String) -> Result<bool, String> {
    let snap: serde_json::Value = serde_json::from_str(&snap).map_err(|e| e.to_string())?;
    let p = path();
    let text = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    match restored(&text, &snap) {
        Some(t) => std::fs::write(&p, t).map(|_| true).map_err(|e| e.to_string()),
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BEFORE: &str = r#"{
  "env": { "A": "1" },
  "model": "claude-opus-5-5",
  "zeta": true,
  "effortLevel": "xhigh",
  "modelSettings": { "claude-sonnet-5-5": { "effortLevel": "xhigh" } },
  "alpha": 1
}"#;

    #[test]
    fn 기본값_칸만_떠_두고_되돌린다() {
        let snap = snapshot(BEFORE);
        assert_eq!(snap["model"], "claude-opus-5-5");
        assert!(snap.get("env").is_none());
        // /model sonnet·/effort high 가 적은 뒤
        let after = BEFORE.replace("\"claude-opus-5-5\"", "\"sonnet\"").replace("\"effortLevel\": \"xhigh\" }", "\"effortLevel\": \"high\" }");
        let back = restored(&after, &snap).expect("바뀌었으니 되돌린다");
        let v: serde_json::Value = serde_json::from_str(&back).unwrap();
        let orig: serde_json::Value = serde_json::from_str(BEFORE).unwrap();
        assert_eq!(v, orig);
        // 칸 순서도 그대로(사용자 파일이 통째로 정렬돼 바뀌지 않게)
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(keys, vec!["env", "model", "zeta", "effortLevel", "modelSettings", "alpha"]);
    }

    #[test]
    fn 없던_칸은_지우고_같으면_안_쓴다() {
        let snap = snapshot(r#"{"a":1}"#);
        assert_eq!(restored(r#"{"a":1,"model":"sonnet"}"#, &snap).as_deref(), Some("{\n  \"a\": 1\n}\n"));
        assert_eq!(restored(r#"{"a":1}"#, &snap), None);
    }

    #[test]
    fn json_이_아니면_안_건드린다() {
        assert_eq!(restored("깨진 글", &snapshot("{}")), None);
    }

    #[test]
    fn 설정_파일_자리() {
        assert_eq!(settings_path(Path::new("/Users/me"), None), PathBuf::from("/Users/me/.claude/settings.json"));
        assert_eq!(settings_path(Path::new("/Users/me"), Some("/tmp/cc")), PathBuf::from("/tmp/cc/settings.json"));
    }
}
