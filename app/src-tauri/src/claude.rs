//! 맥에 깔린 `claude` 를 찾아 부른다. 앱은 로그인하지 않는다 — 사용자의 claude 로그인을 그대로 쓴다(ADR 0003).

use serde::Serialize;
use std::process::Command;

/// 공식 설치본(`~/.local/bin/claude`)이 있으면 그것. `exists` 를 밖에서 받는 건 테스트 때문.
pub fn resolve_claude_bin(home: &str, exists: impl Fn(&str) -> bool) -> Option<String> {
    let native = format!("{home}/.local/bin/claude");
    exists(&native).then_some(native)
}

/// 비대화형 로그인 셸(`zsh -lc`)은 brew 의 옛 claude 를 먼저 잡는다(spike 실측: 2.1.27 vs 2.1.282).
/// 그래서 PATH 검색은 마지막 수단이고, 그때도 사용자가 터미널에서 쓰는 것과 같은 대화형 셸(`-lic`)로 찾는다.
fn shell_lookup() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = Command::new(shell).args(["-lic", "command -v claude"]).output().ok()?;
    let text = String::from_utf8(out.stdout).ok()?;
    text.lines().last().map(|l| l.trim().to_string()).filter(|l| !l.is_empty())
}

pub fn claude_bin() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    resolve_claude_bin(&home, |p| std::path::Path::new(p).exists())
        .or_else(|| crate::setup::find("claude"))
        .or_else(shell_lookup)
        .unwrap_or_else(|| "claude".into())
}

const PATH_MARK: &str = "__HONOR_PATH__";

/// 대화형 셸 출력(잡소리 + 표시 + PATH) → 셸 PATH 를 앞에, 원래 PATH 중 없는 것을 뒤에 붙인 것. 셸이 실패하면 None
pub fn user_path(shell_out: &str, current: &str) -> Option<String> {
    let shell = shell_out.rsplit_once(PATH_MARK)?.1.trim();
    if shell.is_empty() {
        return None;
    }
    let mut parts: Vec<&str> = shell.split(':').filter(|p| !p.is_empty()).collect();
    for p in current.split(':') {
        if !p.is_empty() && !parts.contains(&p) {
            parts.push(p);
        }
    }
    Some(parts.join(":"))
}

/// Finder·open 으로 뜬 앱은 .zshrc 를 안 거쳐서 `~/bin` 같은 게 PATH 에 없다. 그 PATH 가 앱 → `claude --bg` →
/// daemon → 모든 세션으로 물려 내려가, 세션의 MCP(`local-browser-mcp` = ~/bin)가 못 떴다(2026-09-28).
/// 그래서 앱이 뜰 때 한 번, 터미널과 같은 대화형 셸의 PATH 를 받아 자기 PATH 로 삼는다 — 이후 띄우는 건 전부 이걸 물려받는다
pub fn adopt_user_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let Ok(out) = Command::new(shell).args(["-lic", &format!("printf '\\n{PATH_MARK}%s' \"$PATH\"")]).stdin(std::process::Stdio::null()).output() else { return };
    let current = std::env::var("PATH").unwrap_or_default();
    if let Some(p) = user_path(&String::from_utf8_lossy(&out.stdout), &current) {
        std::env::set_var("PATH", p);
    }
}

fn run(args: &[&str]) -> Result<String, String> {
    let out = Command::new(claude_bin()).args(args).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEnv {
    pub home: String,
    /// 프로젝트들이 사는 곳. 사이드바의 프로젝트/작업공간 판별 기준
    pub dev_root: String,
    /// devRoot 밖에 따로 추가한 프로젝트 폴더들(푼 경로). 세션 판별·"내 세션" 범위에 같이 쓴다
    pub extra_projects: Vec<String>,
    /// 비서(오케스트레이터) 세션이 도는 폴더 = 설정의 hqDir
    pub orchestrator_cwd: String,
    pub claude_bin: String,
    pub claude_version: String,
    /// 다마고치 CI 배틀용 GitHub 아이디(설정)
    pub github_user: String,
    /// 내 커밋을 가리는 작성자 이메일(`git config --global user.email`)
    pub git_email: String,
    /// 기록이 쌓이는 데이터 폴더(~/.chammo 등)
    pub data_dir: String,
}

#[tauri::command]
pub fn app_env() -> AppEnv {
    let home = crate::config::home();
    let c = crate::config::current();
    AppEnv {
        // CHAMMO_HQ(옛 HONOR_ORCH_CWD): dev 앱을 검증할 때 진짜 비서와 안 섞이게 비서 폴더를 바꾼다
        orchestrator_cwd: crate::config::hq_dir(&home, &c, |k| std::env::var(k).ok()),
        dev_root: crate::config::expand(&home, &c.dev_root),
        extra_projects: c.extra_projects.iter().map(|p| crate::config::expand(&home, p).trim_end_matches('/').to_string()).collect(),
        claude_bin: claude_bin(),
        claude_version: run(&["--version"]).unwrap_or_default().trim().to_string(),
        github_user: c.github_user,
        git_email: git(std::path::Path::new(&home), &["config", "--global", "user.email"]),
        data_dir: crate::config::data_dir().to_string_lossy().into_owned(),
        home,
    }
}

/// `claude agents --json` 원문 그대로. 파싱은 프론트 domain/session.ts — 테스트가 거기 있다
#[tauri::command]
pub async fn list_sessions() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        run(&["agents", "--json"])
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 그 폴더에서 백그라운드 세션을 띄운다 — 프로젝트 CLAUDE.md·MCP·스킬이 전부 로드된 진짜 세션.
/// 돌려주는 건 `backgrounded · <id> · <이름>` 한 줄
#[tauri::command]
pub async fn spawn_session(cwd: String, name: String, prompt: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let out = Command::new(claude_bin())
            .current_dir(&cwd)
            .args(["--bg", "--dangerously-skip-permissions", "-n", &name, &prompt])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn alive(pid: i32) -> bool {
    // 신호 0 = 보내지 않고 존재만 확인
    unsafe { libc::kill(pid, 0) == 0 }
}

/// `agents --json` 에 이 대화가 아직 돌고 있다고 나오나. 프로세스가 끝나도 목록에서 빠지는 데 시차가 있어서,
/// 그 사이에 이어붙이면 CLI 가 "아직 돈다"며 복사본을 만든다(실측 2026-09-26)
fn still_listed(session_id: &str) -> bool {
    run(&["agents", "--json"]).map(|j| j.contains(session_id)).unwrap_or(false)
}

fn wait_until(mut done: impl FnMut() -> bool, secs: u64) -> bool {
    let until = std::time::Instant::now() + std::time::Duration::from_secs(secs);
    while std::time::Instant::now() < until {
        if done() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
    done()
}

/// 터미널에서 연 대화형 세션을 앱으로 옮긴다.
/// ① 그 프로세스에 SIGTERM ② 끝나고 목록에서도 빠질 때까지 기다림 ③ 같은 대화를 `--bg --resume` 으로 이어감.
/// 대화 기록은 디스크(`~/.claude/projects`)에 있어서 끊겨도 잃지 않는다. 작업 중인 세션은 프론트가 막는다(domain/adopt.ts)
#[tauri::command]
pub async fn adopt_session(pid: i32, session_id: String, cwd: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if alive(pid) {
            unsafe { libc::kill(pid, libc::SIGTERM) };
            if !wait_until(|| !alive(pid), 10) {
                return Err(if crate::i18n::is_en() {
                    format!("The terminal session (pid {pid}) did not exit within 10 seconds — please close it in that terminal")
                } else {
                    format!("터미널 세션(pid {pid})이 10초 안에 안 끝났어 — 그 터미널에서 직접 닫아줘")
                });
            }
        }
        if !wait_until(|| !still_listed(&session_id), 10) {
            return Err(crate::i18n::tr("세션이 아직 목록에 남아 있어 — 잠깐 뒤에 다시 눌러줘", "The session is still listed — please try again in a moment").into());
        }
        let out = Command::new(claude_bin())
            .current_dir(&cwd)
            .args(["--bg", "--dangerously-skip-permissions", "-n", &name, "--resume", &session_id])
            .output()
            .map_err(|e| e.to_string())?;
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        if !out.status.success() {
            return Err(text.trim().to_string());
        }
        Ok(text.trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// worktree 이름을 주면 `-w <이름>` 으로 새 worktree 에서 띄운다
#[tauri::command]
pub async fn new_session(cwd: String, name: String, worktree: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let mut args: Vec<String> = vec!["--bg".into(), "--dangerously-skip-permissions".into(), "-n".into(), name];
        if let Some(w) = worktree.filter(|w| !w.trim().is_empty()) {
            args.push("-w".into());
            args.push(w.trim().to_string());
        }
        let out = Command::new(claude_bin()).current_dir(&cwd).args(&args).output().map_err(|e| e.to_string())?;
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        if !out.status.success() {
            return Err(text.trim().to_string());
        }
        Ok(text.trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 백그라운드 세션을 끈다. 대화는 남아서 `claude --resume` 으로 다시 이을 수 있다
#[tauri::command]
pub async fn stop_session(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        run(&["stop", &id]).map(|s| s.trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 참모가 `scripts/task` 로 쌓는 작업 기록. 없으면 빈 문자열. 파싱은 프론트 domain/tasks.ts
#[tauri::command]
pub fn read_tasks() -> String {
    std::fs::read_to_string(crate::config::data_file("tasks.jsonl")).unwrap_or_default()
}

/// 세션 대화 기록의 꼬리(마지막 256KB). 기록은 `~/.claude/projects/<폴더>/<sessionId>.jsonl`.
/// 파싱은 프론트 domain/activity.ts. 없는 세션은 결과에서 빠진다
#[tauri::command]
pub async fn read_transcript_tails(session_ids: Vec<String>) -> std::collections::HashMap<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    const TAIL: u64 = 256 * 1024;
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var("HOME").unwrap_or_default();
        let dirs: Vec<_> = std::fs::read_dir(format!("{home}/.claude/projects"))
            .map(|rd| rd.flatten().map(|e| e.path()).collect())
            .unwrap_or_default();
        let mut out = std::collections::HashMap::new();
        for sid in session_ids {
            let Some(path) = dirs.iter().map(|d| d.join(format!("{sid}.jsonl"))).find(|p| p.exists()) else { continue };
            let Ok(mut f) = std::fs::File::open(&path) else { continue };
            let len = f.metadata().map(|m| m.len()).unwrap_or(0);
            let _ = f.seek(SeekFrom::Start(len.saturating_sub(TAIL)));
            let mut buf = Vec::new();
            if f.read_to_end(&mut buf).is_ok() {
                out.insert(sid, String::from_utf8_lossy(&buf).into_owned());
            }
        }
        out
    })
    .await
    .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDoc {
    pub name: String,
    pub has_claude: bool,
    pub starter_chars: Option<usize>,
    pub commits_since_starter: u32,
    pub last_commit: String,
}

/// 명령줄 도구(git)가 있나. 없으면 /usr/bin/git 은 설치 안내 창만 띄우는 껍데기라, 부르는 순간 macOS 창이 뜬다 —
/// 설정 화면이 안내하기 전에 앱이 뜨자마자 그 창이 튀어나오지 않게 막는다. 한 번 있으면 기억(설치 중엔 매번 본다)
pub(crate) fn clt_ready() -> bool {
    use std::sync::atomic::{AtomicBool, Ordering};
    static OK: AtomicBool = AtomicBool::new(false);
    if OK.load(Ordering::Relaxed) {
        return true;
    }
    let ok = Command::new("/usr/bin/xcode-select").arg("-p").output().is_ok_and(|o| o.status.success());
    if ok {
        OK.store(true, Ordering::Relaxed);
    }
    ok
}

pub(crate) fn git(dir: &std::path::Path, args: &[&str]) -> String {
    if !clt_ready() {
        return String::new();
    }
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// dev 아래 git 저장소마다 CLAUDE.md·starter 상태. 판정(배지)은 프론트 domain/status.ts
#[tauri::command]
pub async fn project_scan(dev_root: String) -> Vec<ProjectDoc> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        // 직접 추가한 폴더는 git 이 아니어도 프로젝트로 보인다(사용자가 골랐으니까). devRoot 아래는 git 저장소만
        let extra = crate::project::dirs(&crate::config::home(), "", &crate::config::current().extra_projects);
        for (name, dir) in crate::project::dirs_now(&dev_root) {
            let picked = extra.iter().any(|(_, p)| p == &dir);
            let last_commit = if dir.join(".git").exists() { git(&dir, &["log", "-1", "--format=%cs"]) } else { String::new() };
            if last_commit.is_empty() && !picked {
                continue;
            }
            let starter = dir.join("docs/starter.md");
            let starter_chars = std::fs::read_to_string(&starter).ok().map(|s| s.chars().count());
            let commits_since_starter = if starter_chars.is_some() {
                let c = git(&dir, &["log", "-1", "--format=%H", "--", "docs/starter.md"]);
                if c.is_empty() { 0 } else { git(&dir, &["rev-list", "--count", &format!("{c}..HEAD")]).parse().unwrap_or(0) }
            } else {
                0
            };
            out.push(ProjectDoc {
                name,
                has_claude: dir.join("CLAUDE.md").exists() || dir.join(".claude/CLAUDE.md").exists(),
                starter_chars,
                commits_since_starter,
                last_commit,
            });
        }
        out.sort_by(|a, b| b.last_commit.cmp(&a.last_commit));
        out
    })
    .await
    .unwrap_or_default()
}

/// 보낸 알림·읽은 음성을 한 줄씩 남긴다(<데이터 폴더>/notify.log) — "두 번 나왔다"·"이상한 알림"을 나중에 기록으로 가리려고.
/// 1MB 를 넘으면 비우고 새로 쓴다
pub(crate) fn log_out(kind: &str, text: &str) {
    use std::io::Write;
    let path = crate::config::data_file("notify.log");
    if std::fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{ts}\t{kind}\t{}", text.replace('\n', " "));
    }
}

/// macOS 알림. .app 으로 돌면 앱 이름·아이콘으로(notify_mac, 누르면 target 으로 이동),
/// `tauri dev` 맨 실행 파일이면 osascript 로 대신한다(글자는 argv 로 넘겨 따옴표 이스케이프 문제를 피한다)
#[tauri::command]
pub fn notify(title: String, body: String, target: Option<String>) {
    log_out("notify", &format!("{title} — {body}"));
    #[cfg(target_os = "macos")]
    if crate::notify_mac::send(&title, &body, target.as_deref().unwrap_or("")) {
        return;
    }
    let _ = target;
    let _ = Command::new("osascript")
        .args(["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", &title, &body])
        .spawn();
}

/// 음성 모드 — 설정의 ttsCommand(기본 macOS say)로 읽는다. 여러 개가 겹쳐도 차례로(한 번에 하나만 말하게 잠근다)
static SPEAKING: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tauri::command]
pub fn speak(text: String) {
    if text.trim().is_empty() {
        return;
    }
    log_out("speak", &text);
    std::thread::spawn(move || {
        let _turn = SPEAKING.lock();
        let argv = crate::config::tts_argv(&crate::config::home(), &crate::config::current().tts_command, &text, |p| std::path::Path::new(p).is_file());
        let _ = Command::new(&argv[0]).args(&argv[1..]).status();
    });
}

/// 꺼진 세션까지 포함한 목록. 파싱은 프론트 domain/stopped.ts
#[tauri::command]
pub async fn list_sessions_all() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        run(&["agents", "--json", "--all"])
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 꺼진 세션을 같은 대화 그대로 백그라운드에서 다시 띄운다.
/// 옵션(-n·권한 모드)을 붙이면 CLI 가 "저장된 옵션과 다르다"며 **복사본**을 만든다(실측 2026-09-27).
/// 꺼진 백그라운드 세션을 이어서 켠다. 옵션을 기억할 거라 믿고 `--bg --resume` 만 줬다가 권한 모드가 풀렸다 → 권한 옵션을 다시 준다
#[tauri::command]
pub async fn resume_session(cwd: String, session_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let out = Command::new(claude_bin())
            .current_dir(&cwd)
            // 이어서 켤 때도 권한 확인 없이 — 안 붙이면 daemon 재시작 뒤 되살린 세션이 auto 모드로 떠서
            // Bash 마다 사용자 승인을 기다렸다(2026-09-28, 사용자 요청 "항상 바이패스로 켜지게"). CLAUDE.md 원칙 3
            .args(["--bg", "--dangerously-skip-permissions", "--resume", &session_id])
            .output()
            .map_err(|e| e.to_string())?;
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        if !out.status.success() {
            return Err(text.trim().to_string());
        }
        Ok(text.trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 상태줄 스크립트가 남긴 최신 입력(사용 한도 포함). 없으면 빈 문자열. 파싱은 domain/usage.ts
#[tauri::command]
pub fn read_usage() -> String {
    std::fs::read_to_string(crate::config::data_file("statusline.json")).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoToday {
    pub name: String,
    pub commits: u32,
    pub added: u32,
    pub deleted: u32,
}

/// 오늘(since 부터 — 프론트가 새벽 5시 기준으로 준다) 내가 한 커밋 — dev 아래 저장소마다, 모든 브랜치, 머지 커밋 제외, 작성자 이메일로 거른다
#[tauri::command]
pub async fn today_commits(dev_root: String, author: String, since: String) -> Vec<RepoToday> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        for (name, dir) in crate::project::dirs_now(&dev_root) {
            // .git 이 파일이면 다른 저장소의 worktree(형제 폴더) — 본체에서 이미 --all 로 센다
            if !dir.join(".git").is_dir() {
                continue;
            }
            let log = git(&dir, &["log", "--all", "--no-merges", &format!("--since={since}"), &format!("--author={author}"), "--shortstat", "--format=format:@@C"]);
            let commits = log.matches("@@C").count() as u32;
            if commits == 0 {
                continue;
            }
            let (mut added, mut deleted) = (0, 0);
            for line in log.lines().filter(|l| l.contains("changed")) {
                for part in line.split(',') {
                    let n: u32 = part.trim().split(' ').next().and_then(|x| x.parse().ok()).unwrap_or(0);
                    if part.contains("insertion") { added += n } else if part.contains("deletion") { deleted += n }
                }
            }
            out.push(RepoToday { name, commits, added, deleted });
        }
        out.sort_by(|a, b| b.commits.cmp(&a.commits));
        out
    })
    .await
    .unwrap_or_default()
}

/// 다마고치 먹이·하루 리플레이: since(~until) 내 커밋 원문 — 저장소마다 모든 브랜치, 머지 커밋 포함(부모 수로 PR 머지를 가린다).
/// 저장소마다 `@@R\t이름` 한 줄, 커밋마다 `@@C\t해시\t시각\t부모들\t제목` + --numstat. 파싱은 domain/tama/sources.ts·domain/replay.ts
#[tauri::command]
pub async fn commit_log(dev_root: String, author: String, since: String, until: Option<String>) -> String {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = String::new();
        for (name, dir) in crate::project::dirs_now(&dev_root) {
            if !dir.join(".git").is_dir() {
                continue;
            }
            let mut args = vec!["log".to_string(), "--all".into(), format!("--since={since}"), format!("--author={author}"), "--numstat".into(), "--format=format:@@C%x09%H%x09%ct%x09%P%x09%s".into()];
            if let Some(u) = &until {
                args.push(format!("--until={u}"));
            }
            let args: Vec<&str> = args.iter().map(String::as_str).collect();
            out.push_str(&format!("@@R\t{name}\n"));
            out.push_str(&git(&dir, &args));
            out.push('\n');
        }
        out
    })
    .await
    .unwrap_or_default()
}

/// gh — 앱이 받아 둔 셸 PATH, 없으면 brew 자리(setup::pick_bin)
pub(crate) fn gh_bin() -> String {
    crate::setup::find("gh").unwrap_or_else(|| "gh".into())
}

/// 다마고치 배틀: GitHub Actions 실행 기록. dev 아래 GitHub 저장소 중 워크플로가 있는 것만, 내가 띄운 실행만.
/// 저장소마다 `이름\t<gh run list JSON>` 한 줄. 저장소가 많아 스레드로 동시에 부른다. 파싱은 domain/tama/sources.ts
#[tauri::command]
pub async fn ci_runs(dev_root: String, user: String, since: String) -> String {
    tauri::async_runtime::spawn_blocking(move || {
        let gh = gh_bin();
        let handles: Vec<_> = crate::project::dirs_now(&dev_root)
            .into_iter()
            .filter(|(_, d)| d.join(".git").is_dir() && d.join(".github/workflows").is_dir())
            .filter_map(|(name, d)| {
                let url = git(&d, &["remote", "get-url", "origin"]);
                let repo = url.split("github.com").nth(1)?.trim_start_matches([':', '/']).trim_end_matches(".git").to_string();
                let (gh, user, since) = (gh.clone(), user.clone(), since.clone());
                Some(std::thread::spawn(move || {
                    let out = Command::new(&gh)
                        .args(["run", "list", "-R", &repo, "--user", &user, "--created", &format!(">={since}"), "--limit", "300", "--json", "conclusion,status,createdAt"])
                        .output();
                    let json = out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
                    format!("{name}\t{json}")
                }))
            })
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect::<Vec<_>>().join("\n")
    })
    .await
    .unwrap_or_default()
}

/// 세션별 컨텍스트 사용량 — 상태줄 스크립트가 남긴 <데이터 폴더>/ctx/<session_id>.json 들의 원문. 파싱은 domain/ctx.ts
#[tauri::command]
pub fn read_ctx() -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(crate::config::data_file("ctx")) else { return Vec::new() };
    rd.flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .collect()
}

/// 세션에 잠깐 `claude attach` 를 붙여 화면을 읽고(vt100 으로 글자 화면 복원) 키를 넣은 뒤 뗀다.
/// attach 를 떼도 세션은 안 죽는다. keys 가 None 이면 화면만 읽는다
fn with_attach(id: &str, keys: Option<&[u8]>) -> Result<String, String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Write;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    let (rows, cols) = (40u16, 120u16);
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(claude_bin());
    cmd.args(["attach", id]);
    cmd.env("TERM", "xterm-256color");
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let parser = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, 0)));
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let p2 = parser.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n) = std::io::Read::read(&mut reader, &mut buf) {
            if n == 0 { break; }
            p2.lock().unwrap().process(&buf[..n]);
        }
    });
    let mut w = pair.master.take_writer().map_err(|e| e.to_string())?;
    std::thread::sleep(Duration::from_millis(1500)); // 화면이 붙을 때까지
    let screen = parser.lock().unwrap().screen().contents();
    if let Some(k) = keys {
        // 화살표·글자는 하나씩 조금 쉬어 가며 — 한꺼번에 넣으면 TUI 가 놓칠 수 있다
        for chunk in k.split_inclusive(|&b| b == b'\r' || b == b'~' || b == b'A' || b == b'B') {
            w.write_all(chunk).map_err(|e| e.to_string())?;
            std::thread::sleep(Duration::from_millis(150));
        }
        std::thread::sleep(Duration::from_millis(700));
    }
    let _ = child.kill();
    Ok(screen)
}

/// 결정 대기함 답장: 그 세션 입력칸에 사람이 치는 것과 똑같이 글자 + Enter.
/// SendMessage 는 선택지·입력칸에 답으로 안 들어간다(메모리 read-subsession-pending-choice). 확인창·선택지엔 쓰지 않는다(프론트가 막음)
#[tauri::command]
pub async fn send_to_session(id: String, text: String) -> Result<(), String> {
    let line = text.replace(['\r', '\n'], " ");
    if line.trim().is_empty() {
        return Err(crate::i18n::tr("빈 답장", "Empty reply").into());
    }
    let mut keys = line.into_bytes();
    keys.push(b'\r');
    tauri::async_runtime::spawn_blocking(move || with_attach(&id, Some(&keys)).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

/// 권한 창 자동 허용 1단계: 지금 화면 글자. 판단은 domain/autoAllow.ts
#[tauri::command]
pub async fn session_screen(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || with_attach(&id, None)).await.map_err(|e| e.to_string())?
}

/// 권한 창 자동 허용 2단계: 판단한 키(화살표 + Enter)를 넣는다
#[tauri::command]
pub async fn send_keys(id: String, keys: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || with_attach(&id, Some(keys.as_bytes())).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

/// 자동 허용 기록 한 줄 (<데이터 폴더>/auto-allow.jsonl) — 작업 패널이 최근 것을 보여준다
#[tauri::command]
pub fn log_auto_allow(line: String) -> Result<(), String> {
    use std::io::Write;
    serde_json::from_str::<serde_json::Value>(&line).map_err(|e| format!("JSON 아님: {e}"))?;
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(crate::config::data_file("auto-allow.jsonl")).map_err(|e| e.to_string())?;
    writeln!(f, "{}", line.trim()).map_err(|e| e.to_string())
}

/// 한글 입력 진단: <데이터 폴더>/ime-debug.on 이 있을 때만 켜진다(프론트가 시작할 때 한 번 묻는다).
/// None = 꺼짐, Some(파일 내용) = 켜짐 — 내용에 "noswallow" 가 있으면 조합 이벤트를 막지 않고 본다
#[tauri::command]
pub fn ime_debug_mode() -> Option<String> {
    std::fs::read_to_string(crate::config::data_file("ime-debug.on")).ok()
}

/// 한글 입력 진단 한 묶음 — <데이터 폴더>/ime-debug.jsonl
#[tauri::command]
pub fn ime_log(lines: String) -> Result<(), String> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(crate::config::data_file("ime-debug.jsonl")).map_err(|e| e.to_string())?;
    f.write_all(lines.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_auto_allow() -> String {
    std::fs::read_to_string(crate::config::data_file("auto-allow.jsonl")).unwrap_or_default()
}

/// 작업 기록(tasks.jsonl)에 한 줄 — 결정 대기함의 '처리함·답함'(type answer). 프론트가 만든 JSON 한 줄이 맞는지만 보고 붙인다
#[tauri::command]
pub fn append_task_event(line: String) -> Result<(), String> {
    use std::io::Write;
    serde_json::from_str::<serde_json::Value>(&line).map_err(|e| format!("JSON 아님: {e}"))?;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(crate::config::data_file("tasks.jsonl"))
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}", line.trim()).map_err(|e| e.to_string())
}

/// ⌘+클릭한 링크 열기 — 웹 주소는 기본 브라우저, 파일은 기본 앱(macOS `open`).
/// 판정(스킴 거르기·상대 경로 풀기)은 프론트 domain/links.ts. 여기선 한 번 더 좁혀서 http(s) 와 실제 있는 파일만
#[tauri::command]
pub fn open_target(kind: String, target: String) -> Result<(), String> {
    match kind.as_str() {
        "url" if target.starts_with("http://") || target.starts_with("https://") => {}
        "file" if std::path::Path::new(&target).exists() => {}
        "file" => return Err(format!("{}: {target}", crate::i18n::tr("파일이 없어", "File not found"))),
        _ => return Err(crate::i18n::tr("열 수 없는 링크", "This link cannot be opened").into()),
    }
    Command::new("open").arg(&target).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// 터미널에서 복사한 글자를 macOS 클립보드에 넣는다(`pbcopy`).
/// 웹뷰의 navigator.clipboard 는 사용자 입력 도중이 아니면 막히는데, OSC 52 는 pty 출력으로 늦게 도착한다.
/// GUI 앱은 LANG 이 비어 있어서 그대로 두면 pbcopy 가 한글을 깨뜨린다 — UTF-8 로 못 박는다
#[tauri::command]
pub fn clipboard_write(text: String) -> Result<(), String> {
    use std::io::Write;
    let mut child = Command::new("pbcopy")
        .env("LANG", "en_US.UTF-8")
        .env("LC_CTYPE", "UTF-8")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child.stdin.take().ok_or("pbcopy 입력 없음")?.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err(format!("pbcopy 실패: {status}")) }
}

/// 관리 프로그램 lock 파일 글자 → 시작 시각(ms). 모양이 다르거나 없으면 None
pub(crate) fn parse_daemon_started_at(text: &str) -> Option<i64> {
    serde_json::from_str::<serde_json::Value>(text).ok()?.get("startedAt")?.as_i64()
}

/// 관리 프로그램(claude daemon) 시작 시각 — `~/.claude/daemon.lock` 의 startedAt.
/// 바뀌면 재시작된 것 → 직전에 살아 있던 세션이 꺼졌다(domain/revive.ts)
#[tauri::command]
pub fn daemon_started_at() -> Option<i64> {
    let home = std::env::var("HOME").unwrap_or_default();
    parse_daemon_started_at(&std::fs::read_to_string(format!("{home}/.claude/daemon.lock")).ok()?)
}

fn live_snap_path() -> std::path::PathBuf {
    crate::config::data_file("live.json")
}

/// 살아 있는 세션 기록 (없으면 '')
#[tauri::command]
pub fn read_live_snap() -> String {
    std::fs::read_to_string(live_snap_path()).unwrap_or_default()
}

/// 앱이 꺼지는 순간 반쯤 쓴 파일이 남지 않게 임시 파일에 쓰고 옮긴다
#[tauri::command]
pub fn write_live_snap(json: String) -> Result<(), String> {
    let path = live_snap_path();
    let tmp = path.with_extension("json.tmp");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn orch_file(name: &str) -> std::path::PathBuf {
    crate::config::data_file(name)
}

/// 참모가 scripts/say 로 넘긴 음성용 말 — 뒤쪽 100줄만(오래된 건 쓸 일이 없다)
#[tauri::command]
pub fn read_say() -> String {
    let all = std::fs::read_to_string(orch_file("say.jsonl")).unwrap_or_default();
    let lines: Vec<&str> = all.lines().collect();
    lines[lines.len().saturating_sub(100)..].join("\n")
}

/// 음성 모드 켜짐/꺼짐을 파일로 — 참모 쪽 훅(scripts/voice-hint)이 읽고 "음성용 말을 따로 써라"를 알려 준다
#[tauri::command]
pub fn write_voice_mode(on: bool) -> Result<(), String> {
    let path = orch_file("voice.json");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(path, format!("{{\"on\":{on}}}")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{parse_daemon_started_at, resolve_claude_bin, user_path};

    #[test]
    fn user_path_takes_interactive_shell_first() {
        // .zshrc 가 찍는 잡소리 뒤에 표시를 붙여 받는다. 셸 쪽이 앞, 원래 것 중 없는 건 뒤에
        let out = "exec zsh\n__HONOR_PATH__/Users/h/bin:/opt/homebrew/bin:/usr/bin";
        assert_eq!(user_path(out, "/usr/bin:/bin").as_deref(), Some("/Users/h/bin:/opt/homebrew/bin:/usr/bin:/bin"));
    }

    #[test]
    fn user_path_none_when_shell_failed() {
        assert_eq!(user_path("", "/usr/bin"), None);
        assert_eq!(user_path("__HONOR_PATH__", "/usr/bin"), None);
    }

    #[test]
    fn daemon_lock_started_at() {
        let lock = r#"{"pid":11302,"version":"2.1.283","startedAt":1790509037875,"origin":"transient"}"#;
        assert_eq!(parse_daemon_started_at(lock), Some(1790509037875));
        assert_eq!(parse_daemon_started_at("{}"), None);
        assert_eq!(parse_daemon_started_at("깨짐"), None);
    }

    #[test]
    fn native_install_wins() {
        let found = resolve_claude_bin("/h", |p| p == "/h/.local/bin/claude");
        assert_eq!(found.as_deref(), Some("/h/.local/bin/claude"));
    }

    #[test]
    fn falls_back_when_missing() {
        assert_eq!(resolve_claude_bin("/h", |_| false), None);
    }
}
