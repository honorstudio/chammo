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

/// 기본값 칸만 뜬다 — 없던 칸은 안 담는다(되돌릴 때 지운다). 글이 있는데 JSON 이 아니면 null — 모르는 걸 '없음'으로 떠 두면
/// 되돌릴 때 사람이 정한 기본 모델을 지웠다(2026-10-21 리뷰). null 이면 되돌리기가 아무것도 안 한다
pub fn snapshot(text: &str) -> serde_json::Value {
    let v: serde_json::Value = if text.trim().is_empty() {
        serde_json::json!({})
    } else {
        match serde_json::from_str::<serde_json::Value>(text) {
            Ok(v) if v.is_object() => v,
            _ => return serde_json::Value::Null,
        }
    };
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
    snap.as_object()?; // 떠 두지 못했다(null) — 모르니 안 건드린다
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
    match std::fs::read_to_string(path()) {
        Ok(t) => snapshot(&t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => snapshot(""),
        Err(_) => serde_json::Value::Null, // 못 읽음 — '칸 없음'으로 떠 두면 되돌릴 때 지운다
    }
    .to_string()
}

/// 되돌렸으면 true
#[tauri::command]
pub fn claude_defaults_restore(snap: String) -> Result<bool, String> {
    let snap: serde_json::Value = serde_json::from_str(&snap).map_err(|e| e.to_string())?;
    let p = path();
    let text = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    match restored(&text, &snap) {
        // 옆에 다 쓴 뒤 바꿔 끼운다 — Claude Code 가 같은 때 읽으면 빈 파일을 봤다
        Some(t) => crate::accounts::write_atomic(&p, &t).map(|_| true).map_err(|e| format!("{e:?}")),
        None => Ok(false),
    }
}

/// Claude Code 의 bypass(확인 없이 실행) 경고에 동의한 기록 — 없으면 `claude --bg --dangerously-skip-permissions` 가
/// "requires accepting the disclaimer first" 로 안 뜬다(2026-10-21 새 윈도우 PC, 2.1.306 — 첫 설정을 끝내도 참모가 안 떴다)
const CONSENT: &str = "skipDangerousModePermissionPrompt";

pub fn consented(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).ok().and_then(|v| v.get(CONSENT).and_then(|x| x.as_bool())) == Some(true)
}

/// 동의 칸을 더한 새 글 — 빈 글이면 새로. JSON 이 깨졌거나 객체가 아니면 안 덮는다(사람 설정이 날아간다)
pub fn with_consent(text: &str) -> Result<String, String> {
    let mut v: serde_json::Value = if text.trim().is_empty() { serde_json::json!({}) } else { serde_json::from_str(text).map_err(|e| format!("settings.json is not valid JSON: {e}"))? };
    v.as_object_mut().ok_or("settings.json is not a JSON object")?.insert(CONSENT.into(), true.into());
    Ok(serde_json::to_string_pretty(&v).map_err(|e| e.to_string())? + "\n")
}

fn consent_at(p: &Path) -> bool {
    consented(&std::fs::read_to_string(p).unwrap_or_default())
}

/// 사람이 카드에서 [동의] 를 누른 뒤에만 부른다 — 자동으로 쓰지 않는다. 폴더가 없으면 만들고, 임시 파일에 쓴 뒤 바꿔 끼운다
fn accept_at(p: &Path) -> Result<(), String> {
    let text = match std::fs::read_to_string(p) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.to_string()),
    };
    let next = with_consent(&text)?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("json.chammo-tmp");
    std::fs::write(&tmp, &next).map_err(|e| e.to_string())?;
    if std::fs::rename(&tmp, p).is_ok() {
        return Ok(());
    }
    // 윈도우는 다른 프로세스가 열어 둔 파일을 못 바꿔 끼운다(WinError 5) — 그땐 그 자리에 쓴다
    let _ = std::fs::remove_file(&tmp);
    std::fs::write(p, next).map_err(|e| e.to_string())
}

/// 이 컴퓨터의 Claude Code 가 bypass 경고에 동의했나 — 참모·세션은 그 모드로 돈다(CLAUDE.md 원칙 3)
#[tauri::command]
pub fn bypass_consent() -> bool {
    consent_at(&path())
}

/// 동의 기록 — 앱 카드의 [동의] 단추만 부른다
#[tauri::command]
pub fn bypass_consent_accept() -> Result<(), String> {
    accept_at(&path())
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
    fn 떠_둘_때_못_읽었으면_되돌릴_때_안_지운다() {
        // 떠 두는 순간 다른 쓰기 도중이라 깨져 보이면 {} 로 떠 두고, 되돌릴 때 사람이 정한 기본 모델을 지웠다(2026-10-21 리뷰)
        let snap = snapshot("{ \"model\": \"opu");
        assert!(snap.is_null());
        assert_eq!(restored(r#"{"model":"opus","x":1}"#, &snap), None);
        assert_eq!(snapshot("  "), serde_json::json!({}), "파일이 없으면(빈 글) 칸 없음 그대로");
    }

    #[test]
    fn bypass_동의는_그_키가_true_일_때만() {
        // 2.1.306 실측(빈 CLAUDE_CONFIG_DIR): 키가 없으면 --bg 가 'requires accepting the disclaimer first', 넣으면 그 관문을 넘는다
        assert!(!consented(""), "파일 없음");
        assert!(!consented(r#"{"model":"opus"}"#));
        assert!(!consented(r#"{"skipDangerousModePermissionPrompt":false}"#));
        assert!(!consented("깨진 글"));
        assert!(consented(r#"{"skipDangerousModePermissionPrompt":true}"#));
    }

    #[test]
    fn 동의를_적으면_다른_칸과_순서는_그대로() {
        let t = with_consent(BEFORE).unwrap();
        let v: serde_json::Value = serde_json::from_str(&t).unwrap();
        assert_eq!(v["skipDangerousModePermissionPrompt"], true);
        assert_eq!(v["env"]["A"], "1");
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(keys, vec!["env", "model", "zeta", "effortLevel", "modelSettings", "alpha", "skipDangerousModePermissionPrompt"]);
        assert_eq!(with_consent("").unwrap(), "{\n  \"skipDangerousModePermissionPrompt\": true\n}\n", "파일이 없으면 새로");
        assert_eq!(with_consent("  \n").unwrap(), "{\n  \"skipDangerousModePermissionPrompt\": true\n}\n");
        assert!(with_consent("{ 깨짐").is_err(), "JSON 이 깨졌으면 덮어쓰지 않는다 — 사람 설정이 날아간다");
        assert!(with_consent("[1,2]").is_err(), "객체가 아니면 안 건드린다");
        assert!(consented(&with_consent(r#"{"skipDangerousModePermissionPrompt":false}"#).unwrap()));
    }

    #[test]
    fn 동의_기록은_폴더가_없어도_만들고_누르기_전엔_안_쓴다() {
        let d = std::env::temp_dir().join(format!("consent-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let p = d.join(".claude").join("settings.json");
        assert!(!consent_at(&p), "없음 = 동의 안 함");
        assert!(!p.exists(), "묻기만으론 파일을 안 만든다");
        accept_at(&p).unwrap();
        assert!(consent_at(&p));
        std::fs::write(&p, r#"{"permissions":{"allow":["Bash(ls)"]}}"#).unwrap();
        accept_at(&p).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["permissions"]["allow"][0], "Bash(ls)", "있던 칸은 그대로");
        std::fs::write(&p, "{ 깨짐").unwrap();
        assert!(accept_at(&p).is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{ 깨짐", "깨진 파일은 그대로 둔다");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 설정_파일_자리() {
        assert_eq!(settings_path(Path::new("/Users/me"), None), PathBuf::from("/Users/me/.claude/settings.json"));
        assert_eq!(settings_path(Path::new("/Users/me"), Some("/tmp/cc")), PathBuf::from("/tmp/cc/settings.json"));
    }
}
