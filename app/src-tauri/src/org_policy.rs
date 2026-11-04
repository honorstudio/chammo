//! 회사 정책(Claude Code 관리 설정) 감지 — ADR 0023 세 겹 중 ①정책 파일 ②`claude doctor` 줄. ③세션 첫 권한 모드는 startup_mode(앱이 세션마다 읽는다).
//! 맥 자리: /Library/Application Support/ClaudeCode/managed-settings.json + managed-settings.d/*.json, MDM /Library/Managed Preferences/(<사용자>/)com.anthropic.claudecode.plist,
//! 서버 관리 캐시 ~/.claude/remote-settings.json(형식 미확인 — 맨 위 또는 settings 안). 우선순위 서버 관리 > MDM > 파일(first-wins: 정책 키가 하나라도 있는 첫 곳만).
//! 바이패스·auto 막힘은 어느 관리 자리든 하나만 막아도 '막힘'으로 본다 — 틀려도 사람 카드 쪽으로(정책 우회보다 낫다)
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub struct Sources {
    pub file_dir: PathBuf,
    pub plists: Vec<PathBuf>,
    pub remote: PathBuf,
}

pub fn sources_default() -> Sources {
    let home = crate::platform::home();
    let config = std::env::var("CLAUDE_CONFIG_DIR").ok().filter(|s| !s.is_empty()).map(PathBuf::from).unwrap_or_else(|| Path::new(&home).join(".claude"));
    let user = std::env::var("USER").unwrap_or_default();
    let (file_dir, plists) = if cfg!(target_os = "macos") {
        let mp = Path::new("/Library/Managed Preferences");
        (PathBuf::from("/Library/Application Support/ClaudeCode"), vec![mp.join("com.anthropic.claudecode.plist"), mp.join(&user).join("com.anthropic.claudecode.plist")])
    } else if cfg!(windows) {
        (PathBuf::from(r"C:\Program Files\ClaudeCode"), vec![]) // HKLM/HKCU 는 아직 안 읽는다(roadmap 부채)
    } else {
        (PathBuf::from("/etc/claude-code"), vec![])
    };
    Sources { file_dir, plists, remote: config.join("remote-settings.json") }
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str::<Value>(&std::fs::read_to_string(p).ok()?).ok().filter(Value::is_object)
}

/// 한 자리를 이어 붙이기(drop-in 은 이름 순으로 뒤가 이김 — 값 하나 단위, 이 판정엔 충분)
fn merge(into: &mut Value, add: &Value) {
    match (into, add) {
        (Value::Object(a), Value::Object(b)) => {
            for (k, v) in b {
                merge(a.entry(k.clone()).or_insert(Value::Null), v);
            }
        }
        (slot, v) => *slot = v.clone(),
    }
}

/// 관리 자리들을 우선순위대로(서버 관리·MDM·파일) — 없는 자리는 빠진다. plist 는 바꾸는 함수가 json 으로(맥 plutil)
pub fn read_sources(s: &Sources, plist: impl Fn(&Path) -> Option<Value>) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    if let Some(r) = read_json(&s.remote) {
        let v = r.get("settings").filter(|x| x.is_object()).cloned().unwrap_or(r);
        out.push(("remote".to_string(), v));
    }
    for p in s.plists.iter().filter(|p| p.is_file()) {
        if let Some(v) = plist(p).filter(Value::is_object) {
            out.push(("plist".to_string(), v));
            break;
        }
    }
    let mut file = read_json(&s.file_dir.join("managed-settings.json"));
    let mut drops: Vec<PathBuf> = std::fs::read_dir(s.file_dir.join("managed-settings.d")).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    drops.retain(|p| p.extension().is_some_and(|x| x == "json") && !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')));
    drops.sort();
    for d in drops {
        if let Some(v) = read_json(&d) {
            merge(file.get_or_insert_with(|| json!({})), &v);
        }
    }
    if let Some(f) = file {
        out.push(("file".to_string(), f));
    }
    out
}

fn policy_keys(v: &Value) -> bool {
    v.as_object().is_some_and(|o| o.iter().any(|(k, x)| k != "wslInheritsWindowsSettings" && k != "managedSourcesBehavior" && !x.is_null()))
}

/// `claude doctor` 의 "Managed settings (remote): …" 줄 뒤
pub fn doctor_remote(text: &str) -> Option<String> {
    text.lines().find_map(|l| l.trim().strip_prefix("Managed settings (remote):").map(|r| r.trim().to_string()))
}

/// 서버 관리 설정이 실제로 먹고 있나 — 안 먹는 문구(Max: "not fetched …")가 아니고 받아 왔다는 말이 있을 때
pub fn remote_active(line: Option<&str>) -> bool {
    line.is_some_and(|l| {
        let l = l.to_lowercase();
        !l.starts_with("not ") && !l.starts_with("no ") && (l.contains("loaded") || l.contains("applied") || l.contains("in effect") || l.contains("cached"))
    })
}

/// 판정 → 앱이 쓸 모양. bypass·auto: allowed|blocked|unknown, hooks: ours|managedOnly
pub fn judge(srcs: &[(String, Value)], doctor: Option<&str>) -> Value {
    let remote_line = doctor.and_then(doctor_remote);
    let winner = srcs.iter().find(|(_, v)| policy_keys(v));
    let any_disable = |key: &str| srcs.iter().any(|(_, v)| v["permissions"][key] == "disable" || (key == "disableAutoMode" && v[key] == "disable"));
    let unknown = winner.is_none() && remote_active(remote_line.as_deref()); // 서버 정책은 먹는데 캐시를 못 읽음
    let state = |key: &str| if any_disable(key) { "blocked" } else if unknown { "unknown" } else { "allowed" };
    let w = winner.map(|(_, v)| v.clone()).unwrap_or(Value::Null);
    json!({
        "source": winner.map(|(s, _)| s.as_str()).unwrap_or(if unknown { "remote" } else { "none" }),
        "bypass": state("disableBypassPermissionsMode"),
        "auto": state("disableAutoMode"),
        "hooks": if w["allowManagedHooksOnly"] == true { "managedOnly" } else { "ours" },
        "permRules": if w["allowManagedPermissionRulesOnly"] == true { "managedOnly" } else { "ours" },
        "agentView": if w["disableAgentView"] == true { "off" } else { "on" },
        "remote": remote_line,
    })
}

/// 세션 기록 앞부분에서 첫 권한 모드 — 띄울 때 바이패스를 달랐는데 이게 다르면 정책이 낮춘 것(③)
pub fn startup_mode(head: &str) -> Option<String> {
    head.lines().filter(|l| l.contains("\"permission-mode\"")).find_map(|l| serde_json::from_str::<Value>(l).ok().filter(|v| v["type"] == "permission-mode").and_then(|v| v["permissionMode"].as_str().map(String::from)))
}

fn plist_json(p: &Path) -> Option<Value> {
    let o = crate::platform::run_capped(crate::platform::command("/usr/bin/plutil").args(["-convert", "json", "-o", "-"]).arg(p), std::time::Duration::from_secs(5)).ok()?;
    serde_json::from_slice(&o.stdout).ok()
}

/// doctor 는 몇 초 걸린다 — 앱이 켜진 동안 6시간에 한 번만
fn doctor_text() -> Option<String> {
    static CACHE: std::sync::Mutex<Option<(std::time::Instant, String)>> = std::sync::Mutex::new(None);
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, t)) = c.as_ref().filter(|(at, _)| at.elapsed() < std::time::Duration::from_secs(6 * 3600)) {
        return Some(t.clone());
    }
    let mut cmd = crate::platform::command(crate::claude::claude_bin());
    cmd.arg("doctor").stdin(std::process::Stdio::null());
    let o = crate::platform::run_capped(&mut cmd, std::time::Duration::from_secs(20)).ok()?;
    let t = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
    *c = Some((std::time::Instant::now(), t.clone()));
    Some(t)
}

#[tauri::command]
pub async fn org_policy() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let srcs = read_sources(&sources_default(), plist_json);
        judge(&srcs, doctor_text().as_deref())
    })
    .await
    .map_err(|e| e.to_string())
}

/// 세션들(전체 sessionId)의 첫 권한 모드 — 기록 앞 64KB 만 읽는다. 못 찾으면 빠진다
#[tauri::command]
pub async fn startup_modes(ids: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        ids.into_iter()
            .filter_map(|id| {
                let mut buf = Vec::new();
                std::fs::File::open(crate::claude::transcript_path(&id)?).ok()?.take(64 * 1024).read_to_end(&mut buf).ok()?;
                Some((id, startup_mode(&String::from_utf8_lossy(&buf))?))
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "org_policy_tests.rs"]
mod tests;
