//! 프로젝트 폴더 믿음 — Claude Code 는 믿은 적 없는 폴더에서 `claude --bg` 를 'Workspace not trusted' 로 거부한다.
//! 사용자가 마법사·설정에서 프로젝트 폴더(devRoot)를 한 번 믿으면 그걸 동의로 남기고(<데이터>/trust-consent.json),
//! 그 아래 폴더(clone·직접 만든 것)는 앱이 세션을 띄우기 직전·주기 점검 때 믿음을 다시 적는다.
//! 떠 있던 claude 가 ~/.claude.json 을 제 메모리 값으로 덮어 믿음을 지울 수 있어서(2026-10-05) 한 번 적고 끝이 아니다(2026-10-06 이슈 #1).
//! 믿음은 아래 폴더로 물려 내려간다(2.1.290 실측: 부모만 믿어도, 자식 칸이 false 여도 뜬다) — 그래도 띄울 땐 그 폴더도 같이 적는다
use serde_json::{json, Value};

/// dir 가 root 이거나 그 아래인가(경로는 / 모양으로 맞춰 본다)
pub fn covers(root: &str, dir: &str) -> bool {
    let r = crate::tools::project_key(root);
    let d = crate::tools::project_key(dir);
    !r.is_empty() && (d == r || d.starts_with(&format!("{r}/")))
}

/// keys 칸마다 hasTrustDialogAccepted = true. 없는 칸은 Claude 기본 모양으로 만든다(반쪽 칸이면 Claude 가 기본값을 안 섞는다).
/// 다 이미 믿으면 None
pub fn grant(text: &str, keys: &[String]) -> Result<Option<String>, String> {
    let mut v: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let projects = v.as_object_mut().ok_or("not an object")?.entry("projects").or_insert_with(|| json!({}));
    let projects = projects.as_object_mut().ok_or("projects")?;
    let mut changed = false;
    for k in keys {
        let p = projects.entry(k.clone()).or_insert_with(crate::computer_use::new_project);
        let Some(p) = p.as_object_mut() else { continue };
        if p.get("hasTrustDialogAccepted") != Some(&json!(true)) {
            p.insert("hasTrustDialogAccepted".into(), json!(true));
            changed = true;
        }
    }
    Ok(if changed { Some(serde_json::to_string_pretty(&v).map_err(|e| e.to_string())? + "\n") } else { None })
}

/// Claude 는 진짜 경로로 적는다(/tmp → /private/tmp). 윈도우 canonicalize 는 \\?\ 를 붙이니 그대로
fn real(p: &str) -> String {
    #[cfg(unix)]
    if let Ok(r) = std::fs::canonicalize(p) {
        return crate::tools::project_key(&r.to_string_lossy());
    }
    crate::tools::project_key(p)
}

fn consent_file() -> std::path::PathBuf {
    crate::config::data_file("trust-consent.json")
}

/// 사용자가 믿은 프로젝트 폴더(진짜 경로). 동의 전이면 None
pub fn consent_root() -> Option<String> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(consent_file()).ok()?).ok()?;
    v["root"].as_str().filter(|s| !s.is_empty()).map(String::from)
}

fn save_consent(root: &str) {
    let f = consent_file();
    let tmp = f.with_extension("json.tmp");
    if std::fs::write(&tmp, json!({ "root": root }).to_string()).is_ok() {
        let _ = std::fs::rename(&tmp, &f);
    }
}

fn claude_json() -> String {
    std::fs::read_to_string(crate::tools::cfg().json).unwrap_or_default()
}

/// 이 폴더를 띄우기 전에 믿음을 챙길 칸들 — 동의한 폴더 아래면 [동의 폴더, 그 폴더] 중 그 칸 자체가 아직 안 믿는 것.
/// 물려받은 믿음은 안 친다 — 윈도우 claude(2.1.286)는 부모만 믿으면 'Workspace not trusted' 였다(2026-10-09 윈도우 실기기)
pub fn needed(text: &str, consent: Option<&str>, dir_real: &str) -> Vec<String> {
    let Some(root) = consent else { return Vec::new() };
    if !covers(root, dir_real) {
        return Vec::new();
    }
    let mut keys = vec![root.to_string()];
    if dir_real != root {
        keys.push(dir_real.to_string());
    }
    keys.retain(|k| !crate::setup::trusted_exact(text, k));
    keys
}

fn write(keys: &[String]) -> Result<bool, String> {
    if keys.is_empty() {
        return Ok(false);
    }
    crate::computer_use::edit(|t| grant(t, keys), |v| keys.iter().all(|k| v["projects"][k]["hasTrustDialogAccepted"] == json!(true)))
}

/// 세션 띄우기 직전 — 동의한 폴더 아래면 믿음을 다시 적는다. 못 적어도 띄워는 본다(실패하면 claude 가 이유를 낸다)
pub fn before_spawn(cwd: &str) {
    let dir = real(&crate::config::expand(&crate::config::home(), cwd));
    match write(&needed(&claude_json(), consent_root().as_deref(), &dir)) {
        Ok(true) => crate::claude::log_out("trust", &format!("re-trusted before spawn: {dir}")),
        Ok(false) => {}
        Err(e) => crate::claude::log_out("trust", &format!("could not trust {dir}: {e}")),
    }
}

/// 주기 점검(프로젝트 폴더가 잘 읽힐 때) — 사용자가 프로젝트 폴더를 믿은 걸 보면 동의로 남기고,
/// 동의한 폴더의 믿음이 지워졌으면 다시 적는다. 그 아래 새 폴더(clone 등)는 물려받아 믿는다
pub fn sweep(dev_root: &str) {
    let dev = real(dev_root);
    let text = claude_json();
    let consent = consent_root();
    if consent.as_deref() != Some(dev.as_str()) && crate::setup::trusted_in(&text, &dev) {
        save_consent(&dev);
        return;
    }
    if consent.as_deref() == Some(dev.as_str()) {
        let keys = needed(&text, Some(&dev), &dev);
        // 떠 있는 claude 가 계속 덮어쓰면 1분마다 다시 적으며 백업(20개)을 밀어낸다 — 주기 점검 쓰기는 10분에 한 번. 띄우기 직전 쓰기는 늘 한다
        if keys.is_empty() || !sweep_due(std::time::Instant::now()) {
            return;
        }
        match write(&keys) {
            Ok(true) => crate::claude::log_out("trust", &format!("projects folder trust was reset — re-trusted {dev}")),
            Ok(false) => {}
            Err(e) => crate::claude::log_out("trust", &format!("could not re-trust {dev}: {e}")),
        }
    }
}

static LAST_SWEEP_WRITE: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);

/// 주기 점검이 지금 써도 되나(마지막으로 쓴 지 10분 넘음) — 되면 지금으로 적는다
fn sweep_due(now: std::time::Instant) -> bool {
    let mut g = LAST_SWEEP_WRITE.lock().unwrap_or_else(|e| e.into_inner());
    if g.is_some_and(|t| now.duration_since(t) < std::time::Duration::from_secs(600)) {
        return false;
    }
    *g = Some(now);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 주기_점검_쓰기는_10분에_한_번() {
        let t = std::time::Instant::now();
        assert!(sweep_due(t));
        assert!(!sweep_due(t + std::time::Duration::from_secs(60)));
        assert!(sweep_due(t + std::time::Duration::from_secs(601)));
        *LAST_SWEEP_WRITE.lock().unwrap() = None;
    }

    #[test]
    fn 동의한_폴더_아래만() {
        assert!(covers("/u/dev", "/u/dev"));
        assert!(covers("/u/dev", "/u/dev/shop"));
        assert!(covers("/u/dev/", "/u/dev/shop/"));
        assert!(!covers("/u/dev", "/u/devtools"));
        assert!(!covers("/u/dev", "/u"));
        assert!(!covers("", "/u/dev"));
        assert!(covers(r"C:\Users\me\dev", "C:/Users/me/dev/shop"));
    }

    #[test]
    fn 믿음_적기는_그_칸만_바꾸고_나머지는_그대로() {
        let base = r#"{"numStartups":3,"projects":{"/u/dev":{"allowedTools":["Bash"],"hasTrustDialogAccepted":false}},"zzz":1}"#;
        let out = grant(base, &["/u/dev".into(), "/u/dev/shop".into()]).unwrap().unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["projects"]["/u/dev"]["hasTrustDialogAccepted"], json!(true));
        assert_eq!(v["projects"]["/u/dev"]["allowedTools"], json!(["Bash"]));
        // 새 칸은 Claude 기본 모양 + 믿음
        assert_eq!(v["projects"]["/u/dev/shop"]["hasTrustDialogAccepted"], json!(true));
        assert_eq!(v["projects"]["/u/dev/shop"]["mcpServers"], json!({}));
        assert_eq!(v["numStartups"], json!(3));
        assert_eq!(v["zzz"], json!(1));
        // 이미 다 믿으면 안 쓴다
        assert!(grant(&out, &["/u/dev".into()]).unwrap().is_none());
        assert!(grant("{깨짐", &["/u/dev".into()]).is_err());
        // projects 칸이 없던 파일
        let fresh = grant(r#"{"userID":"x"}"#, &["/u/dev".into()]).unwrap().unwrap();
        assert!(crate::setup::trusted_in(&fresh, "/u/dev/any"));
    }

    #[test]
    fn 띄우기_전에_챙길_칸() {
        let none = r#"{"projects":{}}"#;
        // 동의 전 — 아무것도 안 적는다(사용자가 안 믿은 폴더를 앱이 몰래 믿지 않는다)
        assert!(needed(none, None, "/u/dev/shop").is_empty());
        // 동의한 폴더 밖 — 안 적는다
        assert!(needed(none, Some("/u/dev"), "/u/other/shop").is_empty());
        // 동의한 폴더 아래 clone — 동의 폴더와 그 폴더
        assert_eq!(needed(none, Some("/u/dev"), "/u/dev/shop"), vec!["/u/dev".to_string(), "/u/dev/shop".to_string()]);
        // 동의 폴더 자체
        assert_eq!(needed(none, Some("/u/dev"), "/u/dev"), vec!["/u/dev".to_string()]);
        // 둘 다 이미 믿으면 안 적는다
        let both = r#"{"projects":{"/u/dev":{"hasTrustDialogAccepted":true},"/u/dev/shop":{"hasTrustDialogAccepted":true}}}"#;
        assert!(needed(both, Some("/u/dev"), "/u/dev/shop").is_empty());
        // 부모만 믿으면 그 폴더 칸만 — 윈도우 claude(2.1.286)는 부모 믿음을 안 물려줘 'Workspace not trusted' 였다(2026-10-09 윈도우 실기기)
        let ok = r#"{"projects":{"/u/dev":{"hasTrustDialogAccepted":true}}}"#;
        assert_eq!(needed(ok, Some("/u/dev"), "/u/dev/shop"), vec!["/u/dev/shop".to_string()]);
        // 윈도우 칸은 구분자·대소문자가 달라도 같은 칸
        let win = r#"{"projects":{"C:/Users/Me/Desktop/dev":{"hasTrustDialogAccepted":true},"C:\\Users\\Me\\Desktop\\dev\\Shop":{"hasTrustDialogAccepted":true}}}"#;
        assert!(needed(win, Some("C:/Users/Me/Desktop/dev"), "C:/Users/Me/Desktop/dev/shop").is_empty());
        // claude 가 덮어 false 가 된 경우 — 다시 적는다
        let reset = r#"{"projects":{"/u/dev":{"hasTrustDialogAccepted":false}}}"#;
        assert_eq!(needed(reset, Some("/u/dev"), "/u/dev/shop").len(), 2);
    }

    /// 끝까지(앱 띄우기 길 그대로) — 가짜 claude 는 믿음이 없으면 진짜처럼 'Workspace not trusted' 로 죽는다.
    /// HOME·CHAMMO_HOME 을 바꾸니 혼자 돌린다: cargo test -- --ignored trust_e2e --test-threads=1
    #[cfg(unix)]
    #[test]
    #[ignore]
    fn trust_e2e_clone_폴더도_띄우기_직전에_믿고_뜬다() {
        use std::os::unix::fs::PermissionsExt;
        let t = std::env::temp_dir().join(format!("chammo-trust-e2e-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&t);
        let home = t.join("home");
        let data = t.join("data");
        let dev = home.join("dev");
        std::fs::create_dir_all(home.join(".local/bin")).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(dev.join("cloned/.git")).unwrap(); // gh repo clone 흉내 — 아무도 믿은 적 없는 새 폴더
        std::fs::write(home.join(".claude.json"), r#"{"numStartups":1,"projects":{}}"#).unwrap();
        let fake = home.join(".local/bin/claude");
        std::fs::write(&fake, r#"#!/usr/bin/python3
import json, os, sys
if os.environ.get('FAKE_UNEXPECTED'):
    print('error: An unknown error occurred (Unexpected)', file=sys.stderr); sys.exit(1)
d = json.load(open(os.path.join(os.environ['HOME'], '.claude.json'))).get('projects', {})
cur = os.getcwd()
while True:
    if d.get(cur, {}).get('hasTrustDialogAccepted') is True:
        print('backgrounded · deadbeef · ' + sys.argv[sys.argv.index('-n') + 1]); sys.exit(0)
    if cur == '/': break
    cur = os.path.dirname(cur)
print(f'Workspace not trusted. Run `claude` in {os.getcwd()} once and accept the trust prompt, then retry.', file=sys.stderr); sys.exit(1)
"#).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::env::set_var("HOME", &home);
        std::env::set_var("CHAMMO_HOME", &data);
        std::env::remove_var("CLAUDE_CONFIG_DIR");
        let cloned = dev.join("cloned").to_string_lossy().into_owned();

        // ① 동의 전 — 앱이 몰래 믿지 않는다: 진짜처럼 not trusted
        let e = crate::claude::spawn_blocking(&cloned, "cloned", "hi").unwrap_err();
        assert!(e.contains("Workspace not trusted"), "{e}");
        // ② 사용자가 마법사에서 프로젝트 폴더를 믿음 → 주기 점검이 동의로 남긴다
        let real_dev = real(&dev.to_string_lossy());
        std::fs::write(home.join(".claude.json"), format!(r#"{{"projects":{{"{real_dev}":{{"hasTrustDialogAccepted":true}}}}}}"#)).unwrap();
        sweep(&dev.to_string_lossy());
        assert_eq!(consent_root().as_deref(), Some(real_dev.as_str()));
        // ③ 떠 있던 claude 가 ~/.claude.json 을 덮어 믿음이 지워짐(2026-10-05 실측 모양) → 띄우기 직전에 다시 적고 뜬다
        std::fs::write(home.join(".claude.json"), format!(r#"{{"projects":{{"{real_dev}":{{"hasTrustDialogAccepted":false,"allowedTools":[]}}}}}}"#)).unwrap();
        let ok = crate::claude::spawn_blocking(&cloned, "cloned", "hi").unwrap();
        assert!(ok.contains("backgrounded"), "{ok}");
        let cj = std::fs::read_to_string(home.join(".claude.json")).unwrap();
        assert!(crate::setup::trusted_in(&cj, &real(&cloned)));
        // ④ 주기 점검도 지워진 믿음을 되살린다(새로 clone 한 폴더는 물려받음)
        std::fs::write(home.join(".claude.json"), r#"{"projects":{}}"#).unwrap();
        sweep(&dev.to_string_lossy());
        let cj = std::fs::read_to_string(home.join(".claude.json")).unwrap();
        std::fs::create_dir_all(dev.join("another")).unwrap();
        assert!(crate::setup::trusted_in(&cj, &real(&dev.join("another").to_string_lossy())));
        // ⑤ 이유 없는 'Unexpected' — 폴더를 못 읽으면 이유를 붙인다(맥 TCC 는 시험에서 못 만드니 파일 권한으로 같은 길을 탄다)
        let locked = dev.join("locked");
        std::fs::create_dir_all(&locked).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o311)).unwrap(); // 들어갈 수는 있고 목록은 못 읽음
        std::env::set_var("FAKE_UNEXPECTED", "1");
        let e = crate::claude::spawn_blocking(&locked.to_string_lossy(), "locked", "hi").unwrap_err();
        std::env::remove_var("FAKE_UNEXPECTED");
        assert!(e.contains("Unexpected") && (e.contains("권한") || e.contains("permission")), "{e}");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        let _ = std::fs::remove_dir_all(&t);
    }
}
