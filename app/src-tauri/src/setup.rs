//! 환경 점검 — 처음 켠 맥에 Claude Code·로그인·git(Xcode 명령줄 도구)·gh 가 있는지.
//! 판단(글자 → 결과)은 순수 함수로 두고 테스트한다. 명령은 몇 초 안에 안 끝나면 없는 것으로 친다(설정 화면이 멈추지 않게)
use serde::Serialize;
use std::process::{Command, Output, Stdio};
use std::time::Duration;

/// claude 를 찾는 순서: 공식 설치본(~/.local/bin) → 앱이 받아 둔 대화형 셸 PATH → brew(Apple 칩·인텔) 자리.
/// 공식 설치본이 먼저인 건 PATH 앞쪽에 옛 brew claude 가 있을 수 있어서(claude.rs resolve_claude_bin)
pub fn pick_bin(name: &str, home: &str, path_env: &str, exists: impl Fn(&str) -> bool) -> Option<String> {
    let mut cands: Vec<String> = Vec::new();
    if name == "claude" {
        cands.push(format!("{home}/.local/bin/claude"));
    }
    cands.extend(path_env.split(':').filter(|d| !d.is_empty()).map(|d| format!("{}/{name}", d.trim_end_matches('/'))));
    cands.push(format!("/opt/homebrew/bin/{name}"));
    cands.push(format!("/usr/local/bin/{name}"));
    cands.into_iter().find(|c| exists(c))
}

/// `claude auth status` 출력 → 로그인했나. JSON(`"loggedIn": true`)이 기본, 옛 글자 출력도 받는다
pub fn parse_auth_status(out: &str) -> bool {
    if let Some(v) = out.find('{').and_then(|i| serde_json::from_str::<serde_json::Value>(&out[i..]).ok()) {
        return v.get("loggedIn").and_then(|b| b.as_bool()).unwrap_or(false);
    }
    let t = out.to_lowercase();
    !t.contains("not logged in") && (t.contains("logged in") || t.contains("login method"))
}

/// `gh auth status` 출력(stdout+stderr) → 로그인한 아이디. 없으면 None
pub fn parse_gh_user(out: &str) -> Option<String> {
    for line in out.lines() {
        // 새 gh: "✓ Logged in to github.com account honorstudio (keyring)", 옛 gh: "Logged in to github.com as honorstudio (...)"
        let Some(i) = line.find("Logged in to") else { continue };
        let rest = &line[i..];
        let after = rest.split_once(" account ").or_else(|| rest.split_once(" as ")).map(|(_, a)| a)?;
        let user = after.split_whitespace().next()?.trim_matches(|c: char| !c.is_alphanumeric() && c != '-');
        if !user.is_empty() {
            return Some(user.to_string());
        }
    }
    None
}

/// 명령을 돌리되 secs 안에 안 끝나면 None(프로세스는 버린다)
fn run_for(bin: &str, args: &[&str], secs: u64) -> Option<Output> {
    let child = Command::new(bin).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().ok()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    rx.recv_timeout(Duration::from_secs(secs)).ok()?.ok()
}

fn text(o: &Output) -> String {
    format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr))
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvCheck {
    /// 찾은 claude 경로. 없으면 None
    pub claude_path: Option<String>,
    /// `claude --version` 첫 줄(예: "2.1.283 (Claude Code)"). 판정은 프론트 domain/setup.ts
    pub claude_version: String,
    pub logged_in: bool,
    /// Xcode 명령줄 도구 — 없으면 /usr/bin/git 이 설치 안내 창만 띄우는 빈 껍데기다
    pub clt: bool,
    pub gh_path: Option<String>,
    /// gh 로그인 아이디(로그인 안 했으면 None)
    pub gh_user: Option<String>,
}

pub fn find(name: &str) -> Option<String> {
    let path = std::env::var("PATH").unwrap_or_default();
    pick_bin(name, &crate::config::home(), &path, |p| std::path::Path::new(p).is_file())
}

pub fn check() -> EnvCheck {
    let mut c = EnvCheck { claude_path: find("claude"), gh_path: find("gh"), ..Default::default() };
    if let Some(bin) = c.claude_path.clone() {
        if let Some(o) = run_for(&bin, &["--version"], 10) {
            c.claude_version = String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").trim().to_string();
        }
        c.logged_in = run_for(&bin, &["auth", "status"], 10).map(|o| parse_auth_status(&text(&o))).unwrap_or(false);
    }
    c.clt = crate::claude::clt_ready();
    if let Some(gh) = c.gh_path.clone() {
        c.gh_user = run_for(&gh, &["auth", "status"], 8).and_then(|o| parse_gh_user(&text(&o)));
    }
    c
}

/// 설정 화면의 환경 점검(다시 확인할 때마다)
#[tauri::command]
pub async fn check_env() -> EnvCheck {
    tauri::async_runtime::spawn_blocking(check).await.unwrap_or_default()
}

/// 설정 화면의 "들어보기" — 저장 전의 음성 명령으로 한 번 읽는다. 다 읽을 때까지 기다린다(버튼이 "읽는 중…")
#[tauri::command]
pub async fn tts_test(command: String, text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let argv = crate::config::tts_argv(&crate::config::home(), &command, &text, |p| std::path::Path::new(p).is_file());
        let status = Command::new(&argv[0]).args(&argv[1..]).status().map_err(|e| format!("{}: {e}", argv[0]))?;
        if status.success() { Ok(()) } else { Err(format!("{}: {status}", argv[0])) }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Claude Code 가 이 폴더(또는 그 위 폴더)를 믿는다고 기록했나 — `~/.claude.json` 의 projects[경로].hasTrustDialogAccepted.
/// 새 폴더에서 `claude --bg` 는 "Workspace not trusted" 로 멈춘다(2026-09-28 새 사용자 실측). 믿음은 아래 폴더로 물려 내려간다
pub fn trusted_in(claude_json: &str, dir: &str) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(claude_json) else { return false };
    let Some(projects) = v.get("projects").and_then(|p| p.as_object()) else { return false };
    let mut cur = Some(std::path::Path::new(dir.trim_end_matches('/')));
    while let Some(p) = cur {
        let key = p.to_string_lossy();
        if projects.get(key.as_ref()).and_then(|e| e.get("hasTrustDialogAccepted")).and_then(|t| t.as_bool()) == Some(true) {
            return true;
        }
        cur = p.parent().filter(|q| !q.as_os_str().is_empty());
    }
    false
}

#[tauri::command]
pub fn claude_trusted(dir: String) -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    let text = std::fs::read_to_string(format!("{home}/.claude.json")).unwrap_or_default();
    trusted_in(&text, &crate::config::expand(&home, &dir))
}

/** AppleScript 글자 안에 넣을 수 있게 — 역슬래시·큰따옴표만 막으면 된다 */
fn as_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// 폴더 고르기(macOS 기본 창) — 경로를 손으로 치게 하지 않는다. 취소면 None.
/// async 라 창이 떠 있는 동안 앱이 멈추지 않는다. start 가 있는 폴더면 거기서 연다
#[tauri::command]
pub async fn pick_folder(prompt: String, start: Option<String>) -> Result<Option<String>, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut script = format!("POSIX path of (choose folder with prompt {}", as_quote(&prompt));
    if let Some(dir) = start.map(|d| crate::config::expand(&home, &d)).filter(|d| std::path::Path::new(d).is_dir()) {
        script += &format!(" default location (POSIX file {})", as_quote(&dir));
    }
    script += ")";
    let out = std::process::Command::new("/usr/bin/osascript").args(["-e", &script]).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        return Ok(Some(String::from_utf8_lossy(&out.stdout).trim().to_string()));
    }
    let err = String::from_utf8_lossy(&out.stderr);
    if err.contains("-128") { Ok(None) } else { Err(err.trim().to_string()) } // -128 = 사용자가 취소
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 애플스크립트_글자_막기() {
        assert_eq!(as_quote(r#"a"b\c"#), r#""a\"b\\c""#);
    }

    #[test]
    fn claude_는_공식_설치본이_먼저() {
        let all = |_: &str| true;
        assert_eq!(pick_bin("claude", "/h", "/opt/homebrew/bin:/usr/bin", all).as_deref(), Some("/h/.local/bin/claude"));
    }

    #[test]
    fn 그다음_path_그다음_brew_자리() {
        let only = |want: &'static str| move |p: &str| p == want;
        assert_eq!(pick_bin("claude", "/h", "/x/bin:/usr/bin", only("/x/bin/claude")).as_deref(), Some("/x/bin/claude"));
        assert_eq!(pick_bin("claude", "/h", "", only("/usr/local/bin/claude")).as_deref(), Some("/usr/local/bin/claude"));
        assert_eq!(pick_bin("gh", "/h", "/usr/bin/", only("/usr/bin/gh")).as_deref(), Some("/usr/bin/gh"));
        assert_eq!(pick_bin("gh", "/h", "", |p| p == "/h/.local/bin/gh"), None); // ~/.local/bin 은 claude 만
        assert_eq!(pick_bin("claude", "/h", "/usr/bin", |_| false), None);
    }

    #[test]
    fn 로그인_상태_json() {
        assert!(parse_auth_status(r#"{ "loggedIn": true, "authMethod": "claude.ai" }"#));
        assert!(!parse_auth_status(r#"{ "loggedIn": false }"#));
        assert!(!parse_auth_status("{}"));
    }

    #[test]
    fn 로그인_상태_글자() {
        assert!(!parse_auth_status("Not logged in. Run claude auth login"));
        assert!(parse_auth_status("Login method: Claude Max account"));
        assert!(!parse_auth_status(""));
    }

    #[test]
    fn gh_아이디() {
        let new = "github.com\n  ✓ Logged in to github.com account octo-cat (keyring)\n  - Active account: true";
        assert_eq!(parse_gh_user(new).as_deref(), Some("octo-cat"));
        let old = "github.com\n  ✓ Logged in to github.com as octocat (oauth_token)";
        assert_eq!(parse_gh_user(old).as_deref(), Some("octocat"));
        assert_eq!(parse_gh_user("You are not logged into any GitHub hosts. To log in, run: gh auth login"), None);
    }

    #[test]
    fn trust_is_inherited_from_parents() {
        let j = r#"{"projects":{"/u/dev":{"hasTrustDialogAccepted":true},"/u":{"hasTrustDialogAccepted":false},"/u/hq":{"allowedTools":[]}}}"#;
        assert!(trusted_in(j, "/u/dev"));
        assert!(trusted_in(j, "/u/dev/shop/"));
        assert!(!trusted_in(j, "/u/hq"));
        assert!(!trusted_in(j, "/u/other"));
        assert!(!trusted_in("깨짐", "/u/dev"));
    }
}
