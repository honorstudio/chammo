//! 세션이 앱과 같은 데이터 폴더를 쓰게 — claude 세션은 부른 쪽이 아니라 claude 데몬의 환경을 물려받는다.
//! 데몬은 처음 claude 를 부른 프로세스의 env 로 떠서, 시험(CHAMMO_HOME=~/.chammo-soak)이 데몬을 띄우면 그 뒤 진짜 예약 세션까지
//! 시험 폴더를 썼다(2026-10-23 아이맥 soak — 브라우저 래퍼가 시험 폴더 프로필로 크롬을 띄워 '앱 밖 크롬')
//! ① 진짜 앱은 Claude Code 사용자 설정 env.CHAMMO_HOME 에 제 폴더를 적는다 — 설정 env 는 데몬 env 를 이기고, 프로젝트 설정(시험 HQ)은 이걸 이긴다(실측)
//! ② 앱이 떠 있다는 표식(app-alive.json) — 래퍼·scripts 가 물려받은 CHAMMO_HOME 의 앱이 살아 있나 본다
//! ③ 데몬 env 의 CHAMMO_HOME 이 앱 폴더와 다르면 참모에게 한 줄(ui/useDaemonEnv) — 설정 고정이 막아도 데몬은 다시 띄우는 게 맞다
use std::path::Path;

const MARK: &str = "app-alive.json";

/// 사용자 설정 글에 env.CHAMMO_HOME 을 넣은 새 글 — 이미 같으면 None. 깨졌거나 객체가 아니면 Err(사람 설정을 갈아 쓰지 않는다)
pub fn pinned(text: &str, data: &str) -> Result<Option<String>, String> {
    let mut v: serde_json::Value = if text.trim().is_empty() { serde_json::json!({}) } else { serde_json::from_str(text).map_err(|e| format!("settings.json is not valid JSON: {e}"))? };
    let obj = v.as_object_mut().ok_or("settings.json is not a JSON object")?;
    let want = serde_json::Value::String(data.replace('\\', "/"));
    let env = obj.entry("env").or_insert_with(|| serde_json::json!({}));
    if !env.is_object() {
        return Err("settings.json env is not an object".into());
    }
    if env.get("CHAMMO_HOME") == Some(&want) {
        return Ok(None);
    }
    env.as_object_mut().expect("방금 객체인 걸 봤다").insert("CHAMMO_HOME".into(), want);
    Ok(Some(serde_json::to_string_pretty(&v).map_err(|e| e.to_string())? + "\n"))
}

/// 앱이 켤 때 한 번 — 진짜 데이터 폴더일 때만 사용자 설정에 적는다. 시험 앱이 적으면 진짜 세션이 시험 폴더로 간다
pub fn pin_user_settings() {
    let home = crate::config::home();
    let data = crate::config::data_dir();
    if !crate::config::is_real_data(&home, data) {
        return;
    }
    let p = crate::claude_defaults::settings_path(Path::new(&home), std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref());
    let text = match std::fs::read_to_string(&p) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return crate::claude::log_out("daemon-env", &format!("pin skipped: {e}")),
    };
    match pinned(&text, &data.to_string_lossy()) {
        Ok(Some(t)) => match crate::accounts::write_atomic(&p, &t) {
            Ok(()) => crate::claude::log_out("daemon-env", "pinned CHAMMO_HOME in user settings"),
            Err(e) => crate::claude::log_out("daemon-env", &format!("pin failed: {e:?}")),
        },
        Ok(None) => {}
        Err(e) => crate::claude::log_out("daemon-env", &format!("pin skipped: {e}")),
    }
}

/// 표식 글 — 래퍼·scripts 는 pid 가 살아 있고 그 프로세스가 at 보다 먼저 시작했을 때만 산 앱으로 본다(번호 재사용 거름)
pub fn mark_text(pid: u32, at: u64) -> String {
    serde_json::json!({ "pid": pid, "at": at }).to_string()
}

/// 앱이 켤 때 데이터 폴더에 표식 — 시험 폴더에도 남긴다(시험 앱이 산 동안은 시험 세션이 제 폴더를 그대로 쓰게)
pub fn write_mark(data: &Path) {
    let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let _ = crate::accounts::write_atomic(&data.join(MARK), &mark_text(std::process::id(), at));
}

/// ps eww 출력에서 KEY= 값 — 다음 ' NAME=' 앞까지(경로에 빈칸이 있어도). tools/chammo-browser/src/apphome.js envFromPs 와 같다
pub fn env_value(ps_out: &str, key: &str) -> Option<String> {
    let s = ps_out.trim();
    let needle = format!("{key}=");
    let mut from = 0;
    let start = loop {
        let i = from + s[from..].find(&needle)?;
        if i == 0 || s.as_bytes()[i - 1].is_ascii_whitespace() {
            break i + needle.len();
        }
        from = i + 1;
    };
    let rest = &s[start..];
    let bytes = rest.as_bytes();
    // 다음 ' NAME=' 앞까지
    let mut end = rest.len();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_whitespace() {
            let w = &rest[i + 1..];
            let name_len = w.bytes().take_while(|b| b.is_ascii_alphanumeric() || *b == b'_').count();
            if name_len > 0 && !w.as_bytes()[0].is_ascii_digit() && w.as_bytes().get(name_len) == Some(&b'=') {
                end = i;
                break;
            }
        }
        i += 1;
    }
    Some(rest[..end].to_string())
}

/// 데몬이 앱과 다른 데이터 폴더로 떠 있나 — 다르면 그 값. 데몬에 CHAMMO_HOME 이 없으면 기본 폴더(=진짜 앱 폴더)라 같다고 본다
pub fn mismatch(daemon_home: Option<&str>, ours: &Path, home: &str) -> Option<String> {
    let v = daemon_home.map(str::trim).filter(|v| !v.is_empty())?;
    let norm = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()).to_string_lossy().trim_end_matches('/').to_string();
    let theirs = std::path::PathBuf::from(crate::config::expand(home, v));
    (norm(&theirs) != norm(ours)).then(|| v.to_string())
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct DaemonEnv {
    pub pid: u32,
    pub home: String,
}

/// 앱 화면이 몇 분마다 부른다 — 진짜 데이터 폴더 앱만(시험 앱에겐 진짜 데몬이 '다른 폴더'인 게 정상). 윈도우는 ps eww 가 없어 안 본다
#[tauri::command]
pub fn daemon_env_check() -> Option<DaemonEnv> {
    if !cfg!(unix) {
        return None;
    }
    let home = crate::config::home();
    let data = crate::config::data_dir();
    if !crate::config::is_real_data(&home, data) {
        return None;
    }
    let cfg = std::env::var("CLAUDE_CONFIG_DIR").ok().filter(|d| !d.trim().is_empty()).map(std::path::PathBuf::from).unwrap_or_else(|| Path::new(&home).join(".claude"));
    let lock: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(cfg.join("daemon.lock")).ok()?).ok()?;
    let pid = u32::try_from(lock.get("pid")?.as_u64()?).ok()?;
    let out = crate::platform::run_capped(crate::platform::command("ps").args(["eww", "-o", "command=", "-p", &pid.to_string()]), std::time::Duration::from_secs(3)).ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    if text.trim().is_empty() {
        return None; // 데몬이 없다(기록만 남음)
    }
    mismatch(env_value(&text, "CHAMMO_HOME").as_deref(), data, &home).map(|home| DaemonEnv { pid, home })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 사용자_설정에_데이터_폴더를_적고_다른_칸은_그대로() {
        let t = pinned(r#"{"model":"opus","env":{"A":"1"},"z":true}"#, "/Users/me/.chammo").unwrap().unwrap();
        let v: serde_json::Value = serde_json::from_str(&t).unwrap();
        assert_eq!(v["env"]["CHAMMO_HOME"], "/Users/me/.chammo");
        assert_eq!(v["env"]["A"], "1");
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(keys, vec!["model", "env", "z"], "칸 순서 그대로");
    }

    #[test]
    fn 같으면_안_쓰고_없거나_다르면_쓴다() {
        assert_eq!(pinned(r#"{"env":{"CHAMMO_HOME":"/d"}}"#, "/d").unwrap(), None);
        assert!(pinned(r#"{"env":{"CHAMMO_HOME":"/Users/me/.chammo-soak"}}"#, "/d").unwrap().unwrap().contains("\"/d\""), "시험 값이 박혀 있으면 고친다");
        assert!(pinned("", "/d").unwrap().unwrap().contains("\"CHAMMO_HOME\": \"/d\""), "파일 없음 → 새로");
        assert!(pinned("{}", r"C:\Users\me\.chammo").unwrap().unwrap().contains("C:/Users/me/.chammo"), "윈도우는 / 로");
    }

    #[test]
    fn 깨진_설정은_안_건드린다() {
        assert!(pinned("{ \"model\": ", "/d").is_err());
        assert!(pinned("[1]", "/d").is_err());
        assert!(pinned(r#"{"env":"x"}"#, "/d").is_err());
    }

    #[test]
    fn 표식은_pid_와_시각() {
        let v: serde_json::Value = serde_json::from_str(&mark_text(42, 1700000000)).unwrap();
        assert_eq!((v["pid"].as_u64(), v["at"].as_u64()), (Some(42), Some(1700000000)));
        let d = std::env::temp_dir().join(format!("chammo-mark-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        write_mark(&d);
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join(MARK)).unwrap()).unwrap();
        assert_eq!(v["pid"], std::process::id());
        assert!(v["at"].as_u64().unwrap() > 1_700_000_000);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn ps_줄에서_env_값() {
        let out = "/x/claude daemon run --origin transient HOME=/Users/me CHAMMO_HOME=/Users/me/My Data/.chammo PATH=/usr/bin";
        assert_eq!(env_value(out, "CHAMMO_HOME").as_deref(), Some("/Users/me/My Data/.chammo"), "빈칸 든 경로도 다음 NAME= 앞까지");
        assert_eq!(env_value(out, "PATH").as_deref(), Some("/usr/bin"));
        assert_eq!(env_value(out, "NOPE"), None);
        assert_eq!(env_value("/x X_CHAMMO_HOME=/a", "CHAMMO_HOME"), None, "이름 일부만 같은 건 아니다");
        assert_eq!(env_value("/x X_CHAMMO_HOME=/a CHAMMO_HOME=/b", "CHAMMO_HOME").as_deref(), Some("/b"));
        assert_eq!(env_value("/x CHAMMO_HOME=/a 2x=1", "CHAMMO_HOME").as_deref(), Some("/a 2x=1"), "숫자로 시작하면 이름이 아니다");
    }

    #[test]
    fn 데몬이_다른_폴더면_그_값() {
        let ours = Path::new("/Users/me/.chammo");
        assert_eq!(mismatch(Some("/Users/me/.chammo-soak"), ours, "/Users/me").as_deref(), Some("/Users/me/.chammo-soak"));
        assert_eq!(mismatch(Some("~/.chammo-soak"), ours, "/Users/me").as_deref(), Some("~/.chammo-soak"), "~ 그대로 보여 준다");
        assert_eq!(mismatch(Some("~/.chammo"), ours, "/Users/me"), None, "~ 를 풀면 같다");
        assert_eq!(mismatch(Some("/Users/me/.chammo/"), ours, "/Users/me"), None, "끝 / 차이");
        assert_eq!(mismatch(None, ours, "/Users/me"), None, "데몬에 값 없음 = 기본 폴더");
        assert_eq!(mismatch(Some("  "), ours, "/Users/me"), None);
    }

    /// 시험 데몬 실측: CLAUDE_CONFIG_DIR=<빈 폴더> CHAMMO_HOME=<시험 폴더> claude daemon run 을 띄우고
    /// DAEMON_PID=<그 pid> WANT=<시험 폴더> cargo test --bin honor-orchestrator daemon_env::tests::실측 -- --ignored
    #[test]
    #[ignore]
    fn 실측_시험_데몬_env() {
        let pid = std::env::var("DAEMON_PID").expect("DAEMON_PID");
        let want = std::env::var("WANT").expect("WANT");
        let out = crate::platform::command("ps").args(["eww", "-o", "command=", "-p", &pid]).output().unwrap();
        let got = env_value(&String::from_utf8_lossy(&out.stdout), "CHAMMO_HOME");
        assert_eq!(got.as_deref(), Some(want.as_str()));
        assert_eq!(mismatch(got.as_deref(), Path::new("/Users/nobody/.chammo"), "/Users/nobody").as_deref(), Some(want.as_str()));
    }
}
