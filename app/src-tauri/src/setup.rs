//! 환경 점검 — 처음 켠 맥에 Claude Code·로그인·git(Xcode 명령줄 도구)·gh 가 있는지.
//! 판단(글자 → 결과)은 순수 함수로 두고 테스트한다. 명령은 몇 초 안에 안 끝나면 없는 것으로 친다(설정 화면이 멈추지 않게)
use serde::Serialize;
use std::process::{Output, Stdio};
use std::time::Duration;

/// claude 를 찾는 순서: 공식 설치본(~/.local/bin) → 앱이 받아 둔 대화형 셸 PATH → brew(Apple 칩·인텔) 자리.
/// 공식 설치본이 먼저인 건 PATH 앞쪽에 옛 brew claude 가 있을 수 있어서(claude.rs resolve_claude_bin)
pub fn pick_bin(name: &str, home: &str, path_env: &str, exists: impl Fn(&str) -> bool) -> Option<String> {
    pick_bin_for(name, home, path_env, cfg!(windows), exists)
}

/// 실행 파일 찾기 — 윈도우는 PATH 를 ; 로 가르고 .exe·.cmd 를 붙여 본다(C:\… 의 : 에서 잘못 쪼개졌다, 윈도우판 3단계)
pub fn pick_bin_for(name: &str, home: &str, path_env: &str, win: bool, exists: impl Fn(&str) -> bool) -> Option<String> {
    let mut cands: Vec<String> = Vec::new();
    if win {
        let names = [format!("{name}.exe"), format!("{name}.cmd"), name.to_string()];
        if name == "claude" {
            cands.push(format!("{home}\\.local\\bin\\claude.exe"));
        }
        for d in path_env.split(';').filter(|d| !d.trim().is_empty()) {
            for n in &names {
                cands.push(format!("{}\\{n}", d.trim_end_matches(['\\', '/'])));
            }
        }
        return cands.into_iter().find(|c| exists(c));
    }
    if name == "claude" {
        cands.push(format!("{home}/.local/bin/claude"));
    }
    cands.extend(path_env.split(':').filter(|d| !d.is_empty()).map(|d| format!("{}/{name}", d.trim_end_matches('/'))));
    cands.push(format!("/opt/homebrew/bin/{name}"));
    cands.push(format!("/usr/local/bin/{name}"));
    cands.into_iter().find(|c| exists(c))
}

pub fn parse_auth_status(out: &str) -> bool {
    if let Some(v) = out.find('{').and_then(|i| serde_json::from_str::<serde_json::Value>(&out[i..]).ok()) {
        return v.get("loggedIn").and_then(|b| b.as_bool()).unwrap_or(false);
    }
    let t = out.to_lowercase();
    !t.contains("not logged in") && (t.contains("logged in") || t.contains("login method"))
}

/// `gh auth status` 출력(stdout+stderr) → gh 로그인 상태 — user = gh 가 실제로 쓰는(활성) 계정이 멀쩡할 때만, stale = 그 계정 토큰이 깨짐(다시 로그인 필요)
#[derive(Debug, Default, PartialEq)]
pub struct GhAuth {
    pub user: Option<String>,
    pub stale: bool,
}

/// 계정 머리줄 하나 아래 '- …' 줄들이 한 덩어리. 새 gh: "✓ Logged in to github.com account X (keyring)" / "X Failed to log in to github.com account X (default)" + "- The token in default is invalid.",
/// 옛 gh: "Logged in to github.com as X (...)". 활성 계정("Active account: true")을 보고, 그런 줄이 없으면(옛 gh) 첫 덩어리
pub fn parse_gh(out: &str) -> GhAuth {
    struct Block { ok: bool, failed: bool, user: Option<String>, active: Option<bool> }
    let mut blocks: Vec<Block> = Vec::new();
    for line in out.lines() {
        // 계정 줄: 됨 · 실패(토큰 무효) · 시간 초과(망 문제 — 깨진 게 아니라 계정은 보여 준다) · 옛 gh 의 'github.com: authentication failed'
        let ok = line.find("Logged in to").or_else(|| line.find("Timeout trying to log in to"));
        let failed = line.find("Failed to log in to").or_else(|| line.find(": authentication failed").map(|_| 0));
        if let Some(i) = ok.or(failed) {
            let rest = &line[i..];
            let user = rest.split_once(" account ").or_else(|| rest.split_once(" as ")).and_then(|(_, a)| a.split_whitespace().next())
                .map(|u| u.trim_matches(|c: char| !c.is_alphanumeric() && c != '-').to_string()).filter(|u| !u.is_empty());
            blocks.push(Block { ok: ok.is_some(), failed: failed.is_some(), user, active: None });
            continue;
        }
        let Some(b) = blocks.last_mut() else { continue };
        let l = line.to_lowercase();
        if let Some(v) = l.split_once("active account:").map(|(_, v)| v.trim()) {
            b.active = Some(v.starts_with("true"));
        } else if l.contains("is invalid") || l.contains("no longer valid") {
            b.failed = true;
        }
    }
    let Some(b) = blocks.iter().find(|b| b.active == Some(true)).or_else(|| blocks.iter().find(|b| b.active.is_none())) else { return GhAuth::default() };
    if b.failed {
        GhAuth { user: None, stale: true }
    } else {
        GhAuth { user: b.ok.then(|| b.user.clone()).flatten(), stale: false }
    }
}

/// 명령을 돌리되 secs 안에 안 끝나면 None(프로세스는 버린다)
fn run_for(bin: &str, args: &[&str], secs: u64) -> Option<Output> {
    let child = crate::platform::command(bin).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().ok()?;
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
    /// gh 는 있는데 쓰는 계정 토큰이 깨짐(만료·취소) — 다시 로그인 필요
    pub gh_stale: bool,
}

pub fn find(name: &str) -> Option<String> {
    let path = std::env::var("PATH").unwrap_or_default();
    pick_bin(name, &crate::config::home(), &path, |p| std::path::Path::new(p).is_file())
}

/// `claude auth status` — 모르면 None(못 돌림·10초 넘음). 로그인 풀림 감시(login.rs)가 부른다
pub fn auth_status(bin: &str) -> Option<bool> {
    run_for(bin, &["auth", "status"], 10).map(|o| parse_auth_status(&text(&o)))
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
        let gh = run_for(&gh, &["auth", "status", "--hostname", "github.com"], 8).map(|o| parse_gh(&text(&o))).unwrap_or_default();
        (c.gh_user, c.gh_stale) = (gh.user, gh.stale);
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
        let status = crate::platform::command(&argv[0]).args(&argv[1..]).status().map_err(|e| format!("{}: {e}", argv[0]))?;
        if status.success() { Ok(()) } else { Err(format!("{}: {status}", argv[0])) }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Claude Code 가 이 폴더(또는 그 위 폴더)를 믿는다고 기록했나 — `~/.claude.json` 의 projects[경로].hasTrustDialogAccepted.
/// 새 폴더에서 `claude --bg` 는 "Workspace not trusted" 로 멈춘다(2026-09-28 새 사용자 실측). 믿음은 아래 폴더로 물려 내려간다
pub fn trusted_in(claude_json: &str, dir: &str) -> bool {
    let accepted = accepted_keys(claude_json);
    let mut cur = trust_key(dir);
    loop {
        if !cur.is_empty() && accepted.iter().any(|k| *k == cur) {
            return true;
        }
        match cur.rfind('/') {
            Some(i) if i > 0 => cur.truncate(i),
            _ => return false,
        }
    }
}

/// 이 폴더 칸 자체를 믿나(위 폴더에서 물려받은 건 안 친다) — 윈도우 claude(2.1.286)는 부모 믿음을 안 물려줬다(2026-10-09 윈도우 실기기)
pub fn trusted_exact(claude_json: &str, dir: &str) -> bool {
    let k = trust_key(dir);
    !k.is_empty() && accepted_keys(claude_json).contains(&k)
}

/// 윈도우는 키가 C:/… 나 C:\… 로 적히고 대소문자를 안 가린다 → 슬래시·소문자로 맞춰 비교
fn trust_key(s: &str) -> String {
    let t = s.replace('\\', "/");
    let t = t.trim_end_matches('/').to_string();
    if t.as_bytes().get(1) == Some(&b':') { t.to_lowercase() } else { t }
}

/// 믿음을 받은 칸들(trust_key 모양)
fn accepted_keys(claude_json: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(claude_json) else { return Vec::new() };
    let Some(projects) = v.get("projects").and_then(|p| p.as_object()) else { return Vec::new() };
    projects
        .iter()
        .filter(|(_, e)| e.get("hasTrustDialogAccepted").and_then(|t| t.as_bool()) == Some(true))
        .map(|(k, _)| trust_key(k))
        .collect()
}

#[tauri::command]
pub fn claude_trusted(dir: String) -> bool {
    let home = crate::platform::home();
    let text = std::fs::read_to_string(format!("{home}/.claude.json")).unwrap_or_default();
    trusted_at(&text, &crate::config::expand(&home, &dir))
}

/// 그대로 못 찾으면 진짜 경로로 한 번 더 — claude 는 링크를 풀어 적는다(/tmp → /private/tmp, 링크 건 프로젝트 폴더)
fn trusted_at(claude_json: &str, dir: &str) -> bool {
    trusted_in(claude_json, dir)
        || std::fs::canonicalize(dir).is_ok_and(|real| real.to_str().is_some_and(|r| r != dir && trusted_in(claude_json, r)))
}

/** AppleScript 글자 안에 넣을 수 있게 — 역슬래시·큰따옴표만 막으면 된다 */
fn as_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// 폴더 고르기(macOS 기본 창) — 경로를 손으로 치게 하지 않는다. 취소면 None.
/// async 라 창이 떠 있는 동안 앱이 멈추지 않는다. start 가 있는 폴더면 거기서 연다
#[tauri::command]
pub async fn pick_folder(prompt: String, start: Option<String>) -> Result<Option<String>, String> {
    let home = crate::platform::home();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let start = start.map(|d| crate::config::expand(&home, &d)).filter(|d| std::path::Path::new(d).is_dir());
        let script = crate::platform::folder_dialog_script(&prompt, start.as_deref());
        let out = crate::platform::command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", &crate::platform::encode_ps(&script)])
            .creation_flags(0x0800_0000)
            .output()
            .map_err(|e| e.to_string())?;
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok((!path.is_empty()).then_some(path))
    }
    #[cfg(not(windows))]
    {
        let mut script = format!("POSIX path of (choose folder with prompt {}", as_quote(&prompt));
        if let Some(dir) = start.map(|d| crate::config::expand(&home, &d)).filter(|d| std::path::Path::new(d).is_dir()) {
            script += &format!(" default location (POSIX file {})", as_quote(&dir));
        }
        script += ")";
        let out = crate::platform::command("/usr/bin/osascript").args(["-e", &script]).output().map_err(|e| e.to_string())?;
        if out.status.success() {
            return Ok(Some(String::from_utf8_lossy(&out.stdout).trim().to_string()));
        }
        let err = String::from_utf8_lossy(&out.stderr);
        if err.contains("-128") { Ok(None) } else { Err(err.trim().to_string()) } // -128 = 사용자가 취소
    }
}

/// 이 앱 버전(Cargo.toml) — 새 버전 알림이 GitHub 최신 릴리스와 견준다(2026-10-01 사용자)
#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").into()
}

#[cfg(test)]
mod tests {
    // claude 는 믿은 폴더를 진짜 경로(/private/tmp/…)로 적는다 — 링크 경로(/tmp/…)를 고르면 믿기를 마쳐도 마법사가 못 넘어갔다(2026-10-05 개발판 실측)
    #[cfg(unix)]
    #[test]
    fn 링크_경로로_골라도_믿음을_찾는다() {
        let d = std::env::temp_dir().join(format!("chammo-trustlink-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("real")).unwrap();
        std::os::unix::fs::symlink(d.join("real"), d.join("link")).unwrap();
        let real = std::fs::canonicalize(d.join("real")).unwrap();
        let json = format!(r#"{{"projects":{{"{}":{{"hasTrustDialogAccepted":true}}}}}}"#, real.display());
        assert!(super::trusted_at(&json, &d.join("link").to_string_lossy()));
        assert!(!super::trusted_at(&json, &d.to_string_lossy()));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 앱_버전은_세_자리() {
        let v = super::app_version();
        assert_eq!(v.split('.').count(), 3, "{v}");
        assert!(v.split('.').all(|p| p.parse::<u32>().is_ok()), "{v}");
    }
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
        assert_eq!(parse_gh(new).user.as_deref(), Some("octo-cat"));
        let old = "github.com\n  ✓ Logged in to github.com as octocat (oauth_token)";
        assert_eq!(parse_gh(old).user.as_deref(), Some("octocat"));
        assert_eq!(parse_gh("You are not logged into any GitHub hosts. To log in, run: gh auth login").user, None);
    }

    #[test]
    fn gh_깨진_토큰은_로그인이_아니라_다시_로그인() {
        // 윈도우 QA 2026-10-05: 토큰이 깨졌는데 점검이 'octocat 로 로그인돼 있어요' 라고 했다
        let broken = "github.com\n  X Failed to log in to github.com account octocat (default)\n  - Active account: true\n  - The token in default is invalid.\n  - To re-authenticate, run: gh auth login -h github.com\n  - To forget about this account, run: gh auth logout -h github.com -u octocat";
        assert_eq!(parse_gh(broken), GhAuth { user: None, stale: true });
        // 활성 계정은 깨졌고 안 쓰는 계정만 멀쩡 — gh 는 활성 계정을 쓰니 다시 로그인
        let mixed = "github.com\n  X Failed to log in to github.com account octocat (default)\n  - Active account: true\n  - The token in default is invalid.\n\n  ✓ Logged in to github.com account other (keyring)\n  - Active account: false";
        assert_eq!(parse_gh(mixed), GhAuth { user: None, stale: true });
        // 활성 계정이 멀쩡하면 안 쓰는 계정이 깨져 있어도 로그인
        let ok2 = "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Active account: true\n  - Token: gho_****\n\n  X Failed to log in to github.com account old (default)\n  - Active account: false\n  - The token in default is invalid.";
        assert_eq!(parse_gh(ok2), GhAuth { user: Some("octocat".into()), stale: false });
        // '로그인됨' 줄 아래에 무효 표시가 붙은 옛 모양도 깨진 것
        let old_bad = "github.com\n  ✓ Logged in to github.com as octocat (oauth_token)\n  X The token in /home/u/.config/gh/hosts.yml is no longer valid.";
        assert_eq!(parse_gh(old_bad), GhAuth { user: None, stale: true });
        // 로그인 안 함 = 다시 로그인이 아니라 그냥 로그인 전
        assert_eq!(parse_gh("You are not logged into any GitHub hosts. To log in, run: gh auth login"), GhAuth { user: None, stale: false });
        assert_eq!(parse_gh(""), GhAuth { user: None, stale: false });
        // 멀쩡한 것들은 그대로
        let new = "github.com\n  ✓ Logged in to github.com account octo-cat (keyring)\n  - Active account: true";
        assert_eq!(parse_gh(new), GhAuth { user: Some("octo-cat".into()), stale: false });
        // 안 쓰는 계정이 timeout 이어도 그 줄이 새 계정 시작 — 'Active account: false' 가 앞 계정에 붙으면 안 된다
        let to = "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Active account: true\n\n  X Timeout trying to log in to github.com account old (default)\n  - Active account: false";
        assert_eq!(parse_gh(to), GhAuth { user: Some("octocat".into()), stale: false });
        // 쓰는 계정이 timeout(망 문제) = 토큰이 깨진 게 아니다 — 계정은 그대로 보여 준다
        let to1 = "github.com\n  X Timeout trying to log in to github.com account octocat (keyring)\n  - Active account: true";
        assert_eq!(parse_gh(to1), GhAuth { user: Some("octocat".into()), stale: false });
        // 옛 gh 의 인증 실패 줄
        let old_fail = "github.com\n  X github.com: authentication failed\n  - The github.com token in GH_TOKEN is no longer valid.";
        assert_eq!(parse_gh(old_fail), GhAuth { user: None, stale: true });
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
    #[test]
    fn 윈도우_믿음은_슬래시와_대소문자_무관() {
        let j = r#"{"projects":{"C:/Users/me/dev":{"hasTrustDialogAccepted":true}}}"#;
        assert!(trusted_in(j, r"C:\Users\me/dev"));
        assert!(trusted_in(j, r"c:\users\me\dev\shop\"));
        assert!(!trusted_in(j, r"C:\Users\me"));
        let j2 = r#"{"projects":{"C:\\Users\\me\\dev":{"hasTrustDialogAccepted":true}}}"#;
        assert!(trusted_in(j2, "C:/Users/me/dev/hq"));
    }
    #[test]
    fn 윈도우_path_는_세미콜론과_exe() {
        let path = r"C:\Windows\system32;C:\Users\a\AppData\Local\Microsoft\WinGet\Links;";
        let found = pick_bin_for("claude", r"C:\Users\a", path, true, |p| p == r"C:\Users\a\AppData\Local\Microsoft\WinGet\Links\claude.exe");
        assert_eq!(found.as_deref(), Some(r"C:\Users\a\AppData\Local\Microsoft\WinGet\Links\claude.exe"));
        let local = pick_bin_for("claude", r"C:\Users\a", path, true, |p| p == r"C:\Users\a\.local\bin\claude.exe");
        assert_eq!(local.as_deref(), Some(r"C:\Users\a\.local\bin\claude.exe"));
        let npm = pick_bin_for("gh", r"C:\Users\a", r"C:\x\npm", true, |p| p == r"C:\x\npm\gh.cmd");
        assert_eq!(npm.as_deref(), Some(r"C:\x\npm\gh.cmd"));
    }

}
