//! 맥에 깔린 `claude` 를 찾아 부른다. 앱은 로그인하지 않는다 — 사용자의 claude 로그인을 그대로 쓴다(ADR 0003).

use serde::Serialize;

/// 공식 설치본(`~/.local/bin/claude`)이 있으면 그것. `exists` 를 밖에서 받는 건 테스트 때문.
pub fn resolve_claude_bin(home: &str, exists: impl Fn(&str) -> bool) -> Option<String> {
    let native = format!("{home}/.local/bin/claude");
    exists(&native).then_some(native)
}

/// 비대화형 로그인 셸(`zsh -lc`)은 brew 의 옛 claude 를 먼저 잡는다(spike 실측: 2.1.27 vs 2.1.282).
/// 그래서 PATH 검색은 마지막 수단이고, 그때도 사용자가 터미널에서 쓰는 것과 같은 대화형 셸(`-lic`)로 찾는다.
fn shell_lookup() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = crate::platform::command(shell).args(["-lic", "command -v claude"]).output().ok()?;
    let text = String::from_utf8(out.stdout).ok()?;
    text.lines().last().map(|l| l.trim().to_string()).filter(|l| !l.is_empty())
}

pub fn claude_bin() -> String {
    let home = crate::platform::home();
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
    let Ok(out) = crate::platform::command(shell).args(["-lic", &format!("printf '\\n{PATH_MARK}%s' \"$PATH\"")]).stdin(std::process::Stdio::null()).output() else { return };
    let current = std::env::var("PATH").unwrap_or_default();
    if let Some(p) = user_path(&String::from_utf8_lossy(&out.stdout), &current) {
        std::env::set_var("PATH", p);
    }
}

fn run(args: &[&str]) -> Result<String, String> {
    let out = crate::platform::command(claude_bin()).args(args).output().map_err(|e| e.to_string())?;
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
    tauri::async_runtime::spawn_blocking(move || spawn_blocking(&cwd, &name, &prompt)).await.map_err(|e| e.to_string())?
}

/// spawn_session 의 몸통 — 폰 서버(mobile.rs)도 같은 길로 띄운다
pub fn spawn_blocking(cwd: &str, name: &str, prompt: &str) -> Result<String, String> {
    crate::trust::before_spawn(cwd);
    crate::computer_use::sweep_logged();
    crate::browser_attach::reassert_for(cwd);
    let out = crate::platform::command(claude_bin())
        .current_dir(cwd)
        .args(["--bg", "--dangerously-skip-permissions", "-n", name, prompt])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(crate::access::explain_spawn_error(String::from_utf8_lossy(&out.stderr).trim(), cwd));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn alive(pid: i32) -> bool {
    crate::platform::pid_alive(pid)
}

/// `agents --json` 에 이 대화가 아직 돌고 있다고 나오나. 프로세스가 끝나도 목록에서 빠지는 데 시차가 있어서,
/// 그 사이에 이어붙이면 CLI 가 "아직 돈다"며 복사본을 만든다(실측 2026-09-26)
fn still_listed(session_id: &str) -> bool {
    run(&["agents", "--json"]).map(|j| j.contains(session_id)).unwrap_or(false)
}

/// 그 짧은 번호의 세션이 목록에 있나(직접 답하기 카드 — 꺼진 세션엔 안 친다). state done(일 끝남 판단)이어도 살아 있어
/// 입력을 받는다 — 카드를 올리고 턴을 끝낸 세션을 Claude 가 done 으로 표시해 카드가 '꺼짐'으로 막혔다(2026-10-03 QA)
pub(crate) fn listed_alive(short_id: &str) -> bool {
    if short_id.is_empty() {
        return false;
    }
    let Ok(j) = run(&["agents", "--json"]) else { return false };
    let v: serde_json::Value = serde_json::from_str(&j).unwrap_or_default();
    v.as_array().is_some_and(|a| a.iter().any(|x| x["id"] == short_id))
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
            crate::platform::terminate(pid);
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
        crate::trust::before_spawn(&cwd);
        let out = crate::platform::command(claude_bin())
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
        crate::browser_attach::reassert_for(&cwd);
        let mut args: Vec<String> = vec!["--bg".into(), "--dangerously-skip-permissions".into(), "-n".into(), name];
        if let Some(w) = worktree.filter(|w| !w.trim().is_empty()) {
            args.push("-w".into());
            args.push(w.trim().to_string());
        }
        crate::trust::before_spawn(&cwd);
        crate::computer_use::sweep_logged();
        let out = crate::platform::command(claude_bin()).current_dir(&cwd).args(&args).output().map_err(|e| e.to_string())?;
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        if !out.status.success() {
            return Err(crate::access::explain_spawn_error(text.trim(), &cwd));
        }
        Ok(text.trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 끄기·지우기 한 줄: `ms\t동작\t대상\t이유`. 이유 = 누른 길(cmd-w·pane-button·menu·card·quit-all·phone…) + 이름
pub(crate) fn action_line(ts_ms: u128, act: &str, target: &str, why: &str) -> String {
    let why = why.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("{ts_ms}\t{act}\t{target}\t{}", if why.is_empty() { "?" } else { &why })
}

/// <데이터 폴더>/actions.log — 누가(어느 버튼·폰·종료 창) 세션을 껐는지. 2026-09-28 참모-2 가 꺼졌는데 길을 몰라 추정만 했다.
/// 끄기 전에 남긴다(끄다 멈춰도 줄은 있게). 1MB 넘으면 actions.log.1 로 한 번 밀어 둔다
pub(crate) fn log_action(act: &str, target: &str, why: &str) {
    if cfg!(test) {
        return; // cargo test 는 진짜 데이터 폴더에 쓴다
    }
    use std::io::Write;
    let path = crate::config::data_file("actions.log");
    if std::fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = std::fs::rename(&path, crate::config::data_file("actions.log.1"));
    }
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{}", action_line(ts, act, target, why));
    }
}

/// 백그라운드 세션을 끈다. 대화는 남아서 `claude --resume` 으로 다시 이을 수 있다. why = 누른 길(actions.log)
#[tauri::command]
pub async fn stop_session(id: String, why: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || stop_blocking(&id, why.as_deref().unwrap_or("app")))
        .await
        .map_err(|e| e.to_string())?
}

/// stop_session 의 몸통 — 폰 서버(참모 재우기)도 같은 길로
pub fn stop_blocking(id: &str, why: &str) -> Result<String, String> {
    log_action("stop", id, why);
    run(&["stop", id]).map(|s| s.trim().to_string())
}

/// remove_session 의 몸통 — 폰 서버(참모 제거)도 같은 길로. 꺼진 세션이면 stop 은 실패해도 넘어간다
pub fn remove_blocking(id: &str, why: &str) -> Result<String, String> {
    log_action("rm", id, why);
    let _ = run(&["stop", id]);
    run(&["rm", id]).map(|s| s.trim().to_string())
}

/// 세션을 끄고 목록에서도 지운다(`claude stop` + `claude rm`) — 꺼진 참모가 "꺼진 세션"에 계속 남지 않게(2026-09-30 사용자).
/// 대화 기록 파일(~/.claude/projects)은 남는다
#[tauri::command]
pub async fn remove_session(id: String, why: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || remove_blocking(&id, why.as_deref().unwrap_or("app")))
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
    tauri::async_runtime::spawn_blocking(move || transcript_tails(&session_ids, 256 * 1024)).await.unwrap_or_default()
}

/// 대화 기록 꼬리 tail 바이트씩 — 폰 서버는 더 짧게 읽는다(꺼진 참모가 하던 일 한 줄이면 된다)
pub fn transcript_tails(session_ids: &[String], tail: u64) -> std::collections::HashMap<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let home = crate::platform::home();
    let dirs: Vec<_> = std::fs::read_dir(format!("{home}/.claude/projects"))
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    let mut out = std::collections::HashMap::new();
    for sid in session_ids {
        let Some(path) = dirs.iter().map(|d| d.join(format!("{sid}.jsonl"))).find(|p| p.exists()) else { continue };
        let Ok(mut f) = std::fs::File::open(&path) else { continue };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        let _ = f.seek(SeekFrom::Start(len.saturating_sub(tail)));
        let mut buf = Vec::new();
        if f.read_to_end(&mut buf).is_ok() {
            out.insert(sid.clone(), String::from_utf8_lossy(&buf).into_owned());
        }
    }
    out
}

/// 채팅 보기(스페이스 모드)가 대화 기록을 이어 읽은 결과. next = 다음에 넘길 자리, reset = 처음부터 다시 그려야 함
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptChunk {
    pub text: String,
    pub next: u64,
    pub reset: bool,
    /// text 의 첫 줄이 파일에서 시작하는 자리 — 폰이 그 앞을 거슬러 읽는다(read_before)
    pub start: u64,
}

/// 폰 처음 읽기 — 끝 256KB 부터, 줄 60개가 될 때까지 넓히되 2MB 까지(앞은 위로 올리면 read_before 로).
/// 참모-2 기록(174MB)은 끝 1MB 에 줄이 123개라 4MB 를 한 번에 보내 LTE 에서 늦거나 끊겨 목록이 비었다(2026-10-03)
pub const PHONE_HEAD: u64 = 256 * 1024;
pub const PHONE_MIN_LINES: usize = 60;
pub const PHONE_MAX: u64 = 2 * 1024 * 1024;
/// 위로 올렸을 때 한 번에 거슬러 읽는 양
pub const PHONE_BEFORE: u64 = 512 * 1024;

/// 거슬러 읽은 앞 대화 — start 부터 before 까지의 온전한 줄들
#[derive(Serialize, Debug, PartialEq)]
pub struct Earlier {
    pub text: String,
    pub start: u64,
}

/// before(줄 처음 자리) 앞 size 바이트 안의 온전한 줄들. 창 안에 온전한 줄이 없으면(줄 하나가 창보다 큼) 창을 넓혀 그 줄을 통째로
pub fn read_before(path: &std::path::Path, before: u64, size: u64) -> std::io::Result<Earlier> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path)?;
    let before = before.min(f.metadata()?.len());
    let mut win = size.max(1);
    loop {
        let from = before.saturating_sub(win);
        if from == 0 {
            f.seek(SeekFrom::Start(0))?;
            let mut buf = vec![0u8; before as usize];
            f.read_exact(&mut buf)?;
            return Ok(Earlier { text: String::from_utf8_lossy(&buf).into_owned(), start: 0 });
        }
        // 창 바로 앞 한 바이트까지 — 그게 줄바꿈이면 창이 줄 처음에서 시작한다
        let pre = from - 1;
        f.seek(SeekFrom::Start(pre))?;
        let mut buf = vec![0u8; (before - pre) as usize];
        f.read_exact(&mut buf)?;
        if let Some(i) = buf.iter().position(|&b| b == b'\n').filter(|&i| i + 1 < buf.len()) {
            return Ok(Earlier { text: String::from_utf8_lossy(&buf[i + 1..]).into_owned(), start: pre + i as u64 + 1 });
        }
        win = win.saturating_mul(2);
    }
}

/// 처음(또는 파일이 줄어 자리가 안 맞으면) 끝 1MB 부터 — 긴 대화 전체를 매번 그리지 않게
const CHAT_HEAD: u64 = 1024 * 1024;
/// 처음 읽을 때 적어도 이만큼 줄은 보이게, 창은 최대 이만큼까지 넓힌다
const CHAT_MIN_LINES: usize = 200;
const CHAT_MAX: u64 = 32 * 1024 * 1024;

/// from 부터 끝까지 읽되 마지막 줄바꿈까지만(쓰는 중인 줄은 다음에). 처음 읽을 땐 끝 1MB, 잘린 첫 줄은 버린다
pub fn read_chunk(path: &std::path::Path, from: Option<u64>) -> std::io::Result<TranscriptChunk> {
    read_chunk_with(path, from, CHAT_HEAD, CHAT_MIN_LINES, CHAT_MAX)
}

/// 처음 창(head)·적어도 줄 수(min_lines)·최대 창(max)을 정해 읽는다 — 데스크톱은 1MB·200줄·32MB, 폰은 가볍게(PHONE_*)
pub fn read_chunk_with(path: &std::path::Path, from: Option<u64>, head: u64, min_lines: usize, max: u64) -> std::io::Result<TranscriptChunk> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    let reset = !matches!(from, Some(n) if n <= len);
    let mut window = head;
    let (start, buf) = loop {
        let start = if reset { len.saturating_sub(window) } else { from.unwrap_or(0) };
        f.seek(SeekFrom::Start(start))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)?;
        // 끝에 큰 줄(그림 읽은 도구 결과 등)이 있으면 줄 몇 개 안 남는다 — 줄이 충분할 때까지 넓힌다
        let lines = buf.iter().filter(|&&b| b == b'\n').count();
        if !reset || start == 0 || lines >= min_lines || window >= max { break (start, buf) }
        window *= 4;
    };
    let end = buf.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
    let mut body = &buf[..end];
    let mut first = start;
    if reset && start > 0 {
        let cut = body.iter().position(|&b| b == b'\n').map_or(body.len(), |i| i + 1);
        body = &body[cut..];
        first = start + cut as u64;
    }
    Ok(TranscriptChunk { text: String::from_utf8_lossy(body).into_owned(), next: start + end as u64, reset, start: first })
}

/// 채팅 보기용 대화 기록 이어 읽기. 파일이 없으면(아직 첫 지시 전) 빈 조각
#[tauri::command]
pub async fn read_transcript(session_id: String, from: Option<u64>) -> TranscriptChunk {
    tauri::async_runtime::spawn_blocking(move || {
        let empty = TranscriptChunk { text: String::new(), next: 0, reset: from.is_some(), start: 0 };
        let Some(path) = transcript_path(&session_id) else { return empty };
        read_chunk(&path, from).unwrap_or(empty)
    })
    .await
    .unwrap_or(TranscriptChunk { text: String::new(), next: 0, reset: false, start: 0 })
}

/// 그 대화의 기록 파일(~/.claude/projects/<폴더>/<sessionId>.jsonl)
pub(crate) fn transcript_path(session_id: &str) -> Option<std::path::PathBuf> {
    let home = crate::platform::home();
    let rd = std::fs::read_dir(format!("{home}/.claude/projects")).ok()?;
    rd.flatten().map(|e| e.path().join(format!("{session_id}.jsonl"))).find(|p| p.exists())
}

/// 폰 대화 이어 읽기 — 처음은 가볍게(PHONE_*)
pub fn read_transcript_phone(session_id: &str, from: Option<u64>) -> TranscriptChunk {
    let empty = TranscriptChunk { text: String::new(), next: 0, reset: from.is_some(), start: 0 };
    let Some(path) = transcript_path(session_id) else { return empty };
    read_chunk_with(&path, from, PHONE_HEAD, PHONE_MIN_LINES, PHONE_MAX).unwrap_or(empty)
}

/// 폰 앞 대화 — before 앞 512KB 의 온전한 줄들(위로 올렸을 때)
pub fn read_transcript_before(session_id: &str, before: u64) -> Earlier {
    transcript_path(session_id).and_then(|p| read_before(&p, before, PHONE_BEFORE).ok()).unwrap_or(Earlier { text: String::new(), start: 0 })
}

/// 세션 할 일 목록 한 줄(Claude Code TaskCreate — ~/.claude/tasks/session-<대화 id 앞 8자리>/<n>.json)
#[derive(Serialize, serde::Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionTask {
    pub id: String,
    pub subject: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_form: Option<String>,
}

/// 파일 내용들 → 번호 순 목록. 깨진 파일은 건너뛴다(쓰는 중일 수 있다)
pub fn parse_tasks(files: &[String]) -> Vec<SessionTask> {
    let mut v: Vec<SessionTask> = files.iter().filter_map(|t| serde_json::from_str(t).ok()).collect();
    v.sort_by_key(|t| t.id.parse::<u64>().unwrap_or(u64::MAX));
    v
}

/// 채팅 판 위 '할 일' 칸 — 터미널에서 "N tasks (…)" 로 보이던 것. 다 끝나면 Claude 가 파일을 지워 빈 목록
#[tauri::command]
pub async fn read_session_tasks(session_id: String) -> Vec<SessionTask> {
    tauri::async_runtime::spawn_blocking(move || {
        let short: String = session_id.chars().take(8).collect();
        let home = crate::platform::home();
        let dir = format!("{home}/.claude/tasks/session-{short}");
        let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
        let files: Vec<String> = rd
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .collect();
        parse_tasks(&files)
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod task_tests {
    use super::*;
    #[test]
    fn 번호_순으로_깨진_파일은_건너뛴다() {
        let files = vec![
            r#"{"id":"10","subject":"열","status":"pending","blocks":[],"blockedBy":[]}"#.to_string(),
            r#"{"id":"2","subject":"둘","status":"in_progress","activeForm":"둘 하는 중"}"#.to_string(),
            "{ 깨짐".to_string(),
        ];
        let v = parse_tasks(&files);
        assert_eq!(v.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["2", "10"]);
        assert_eq!(v[0].active_form.as_deref(), Some("둘 하는 중"));
    }
}

#[cfg(test)]
mod typed_tests {
    #[test]
    fn 줄바꿈은_esc_cr_한_조각_탭은_띄어쓰기() {
        let s = super::typed_segs("가\t나\n다");
        assert_eq!(s, vec!["가  나".as_bytes().to_vec(), b"\x1b\r".to_vec(), "다".as_bytes().to_vec()]);
    }
}

#[cfg(test)]
mod reply_tests {
    #[test]
    fn 답장은_감싸지_않고_치는_글_탭은_띄어쓰기_enter_는_안_붙인다() {
        // 붙여넣기로 감싸면 긴 글이 '붙여넣은 글'로 간다(2026-09-30 실험). Enter 는 attach_type 이 쉬었다가 따로 넣는다
        assert_eq!(super::reply_text("응\t그걸로"), b"\xec\x9d\x91  \xea\xb7\xb8\xea\xb1\xb8\xeb\xa1\x9c".to_vec());
        assert!(!super::reply_text("a").contains(&b'\r'));
    }
}

#[cfg(test)]
mod chat_tests {
    use super::*;
    use std::io::Write;

    fn file(tag: &str, body: &[u8]) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("chammo-chat-test-{tag}-{}", std::process::id()));
        std::fs::File::create(&p).unwrap().write_all(body).unwrap();
        p
    }

    #[test]
    fn 처음엔_처음부터_마지막_줄바꿈까지() {
        let p = file("first", b"{\"a\":1}\n{\"b\":2}\n{\"c\":");
        let c = read_chunk(&p, None).unwrap();
        assert_eq!(c, TranscriptChunk { text: "{\"a\":1}\n{\"b\":2}\n".into(), next: 16, reset: true, start: 0 });
    }

    #[test]
    fn 이어_읽기는_새로_붙은_것만() {
        let p = file("next", b"{\"a\":1}\n{\"b\":2}\n");
        let c = read_chunk(&p, Some(8)).unwrap();
        assert_eq!(c, TranscriptChunk { text: "{\"b\":2}\n".into(), next: 16, reset: false, start: 8 });
        assert_eq!(read_chunk(&p, Some(16)).unwrap().text, "");
    }

    #[test]
    fn 파일이_줄었으면_다시_처음부터() {
        let p = file("shrunk", b"{\"a\":1}\n");
        let c = read_chunk(&p, Some(999)).unwrap();
        assert!(c.reset);
        assert_eq!(c.text, "{\"a\":1}\n");
    }

    #[test]
    fn 큰_파일은_끝_1mb_부터_잘린_첫_줄은_버린다() {
        let line = format!("{{\"x\":\"{}\"}}\n", "a".repeat(1000));
        let body = line.repeat(1100); // 약 1.1MB
        let p = file("big", body.as_bytes());
        let c = read_chunk(&p, None).unwrap();
        assert!(c.reset);
        assert!(c.text.starts_with("{\"x\""));
        assert_eq!(c.next, body.len() as u64);
        assert!((c.text.len() as u64) <= CHAT_HEAD);
    }

    #[test]
    fn 끝에_큰_줄이_있어도_앞_대화가_남는다() {
        // 화면 캡처를 읽은 줄 하나가 1MB 를 넘어 끝 1MB 가 그 줄 조각뿐 → 대화가 통째로 사라졌다(2026-09-30 사용자)
        let small = "{\"a\":1}\n".repeat(50);
        let big = format!("{{\"img\":\"{}\"}}\n", "b".repeat(1_500_000));
        let p = file("bigtail", format!("{small}{big}").as_bytes());
        let c = read_chunk(&p, None).unwrap();
        assert!(c.text.starts_with("{\"a\":1}\n"));
        assert!(c.text.ends_with(&big));
    }

    #[test]
    fn 처음_읽기는_첫_줄의_자리를_같이_준다() {
        // 폰이 그 앞을 거슬러 읽는다(read_before) — 잘린 첫 줄을 버린 뒤의 자리
        let line = format!("{{\"x\":\"{}\"}}\n", "a".repeat(1000));
        let body = line.repeat(1100);
        let p = file("start", body.as_bytes());
        let c = read_chunk(&p, None).unwrap();
        assert_eq!(c.start + c.text.len() as u64, c.next);
        assert_eq!(c.start % line.len() as u64, 0, "줄 처음");
    }

    #[test]
    fn 폰_처음_읽기는_가볍게() {
        // 참모-2 기록은 174MB — 끝 1MB 에 줄이 123개라 4MB 까지 넓혀 한 번에 보냈다(LTE 에서 늦거나 끊겨 빈 목록, 2026-10-03)
        let line = format!("{{\"x\":\"{}\"}}\n", "a".repeat(1000));
        let p = file("lite", line.repeat(3000).as_bytes());
        let c = read_chunk_with(&p, None, PHONE_HEAD, PHONE_MIN_LINES, PHONE_MAX).unwrap();
        assert!(c.text.len() as u64 <= PHONE_HEAD, "{}", c.text.len());
        assert!(c.text.lines().count() >= PHONE_MIN_LINES);
    }

    #[test]
    fn 앞_대화는_줄_단위로_거슬러_읽는다() {
        let p = file("before", b"{\"a\":1}\n{\"b\":2}\n{\"c\":3}\n{\"d\":4}\n");
        // 끝(32)에서 16바이트 앞 — 줄 둘
        let e = read_before(&p, 32, 16).unwrap();
        assert_eq!((e.text.as_str(), e.start), ("{\"c\":3}\n{\"d\":4}\n", 16));
        // 12바이트만 — 잘린 줄은 버리고 온전한 줄 하나
        let e = read_before(&p, 32, 12).unwrap();
        assert_eq!((e.text.as_str(), e.start), ("{\"d\":4}\n", 24));
        // 맨 앞까지
        let e = read_before(&p, 16, 999).unwrap();
        assert_eq!((e.text.as_str(), e.start), ("{\"a\":1}\n{\"b\":2}\n", 0));
        assert_eq!(read_before(&p, 0, 999).unwrap().text, "");
        // 한 줄이 창보다 크면 그 줄은 통째로(안 그러면 영영 못 넘어간다)
        let e = read_before(&p, 8, 3).unwrap();
        assert_eq!((e.text.as_str(), e.start), ("{\"a\":1}\n", 0));
    }
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
    let ok = crate::platform::git_ready();
    if ok {
        OK.store(true, Ordering::Relaxed);
    }
    ok
}

/// 여럿을 workers 개씩 같이 돌리고 결과는 들어온 순서 그대로. 저장소마다 git log 를 줄 세우면 37곳 0.5초(2026-10-09 실측)
pub(crate) fn par_map<T: Sync, R: Send>(items: &[T], workers: usize, f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let next = std::sync::atomic::AtomicUsize::new(0);
    let mut out: Vec<(usize, R)> = std::thread::scope(|sc| {
        let hs: Vec<_> = (0..workers.max(1).min(items.len()))
            .map(|_| {
                sc.spawn(|| {
                    let mut got = vec![];
                    loop {
                        let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Some(x) = items.get(i) else { break };
                        got.push((i, f(x)));
                    }
                    got
                })
            })
            .collect();
        hs.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    });
    out.sort_by_key(|(i, _)| *i);
    out.into_iter().map(|(_, r)| r).collect()
}

/// git 을 같이 몇 개 돌리나 — 코어 수만큼, 많아도 8(맥이 다른 일도 한다)
fn git_workers() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8)
}

pub(crate) fn git(dir: &std::path::Path, args: &[&str]) -> String {
    if !clt_ready() {
        return String::new();
    }
    crate::platform::command("git")
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
    // 폰 푸시도 같이 — 이 알림은 이미 domain/notify 정책·'참모 창 보고 있으면 안 보냄'을 거쳤다(ui/notifier)
    crate::push::send_all(&title, &body, target.as_deref().unwrap_or(""));
    if crate::notify_mac::send(&title, &body, target.as_deref().unwrap_or("")) { // 윈도우는 토스트(notify_other)
        return;
    }
    let _ = target;
    #[cfg(target_os = "macos")] // 윈도우 알림은 아직 없다(notify_other)
    let _ = crate::platform::spawn_reaped(crate::platform::command("osascript")
        .args(["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", &title, &body]));
}

/// '보고 있나' — 메인 창이 보이고·최소화 안 됐고·앞에 있을 때만
pub fn watched(focused: bool, minimized: bool, visible: bool) -> bool {
    focused && !minimized && visible
}

/// 메인 창을 보고 있나 — WebView2 는 최소화·다른 창 앞이어도 document.hasFocus()=true 라 웹 값으로 못 가린다(윈도우 QA 2026-10-05). 못 읽으면 안 보는 것으로
#[tauri::command]
pub fn main_watched<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> bool {
    use tauri::Manager;
    app.get_webview_window("main").is_some_and(|w| watched(w.is_focused().unwrap_or(false), w.is_minimized().unwrap_or(true), w.is_visible().unwrap_or(false)))
}

#[cfg(test)]
mod watched_tests {
    use super::watched;
    #[test]
    fn 보이고_최소화_안_됐고_앞에_있을_때만_보고_있다() {
        assert!(watched(true, false, true));
        // 윈도우 QA 2026-10-05: 최소화·다른 창 앞이어도 WebView2 는 hasFocus=true 였다 — Rust 창 상태로는 갈린다
        assert!(!watched(true, true, true), "최소화");
        assert!(!watched(false, false, true), "다른 창이 앞");
        assert!(!watched(true, false, false), "숨김(트레이)");
        assert!(!watched(false, true, false));
    }
}

/// 음성 모드 — 설정의 ttsCommand(기본 macOS say)로 읽는다. 여러 개가 겹쳐도 차례로(한 번에 하나만 말하게 잠근다)
static SPEAKING: std::sync::Mutex<()> = std::sync::Mutex::new(());
/// 멈출 때마다 1 씩 — 그 전에 줄 선 말은 차례가 와도 안 읽는다
static SPEAK_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// 지금 읽는 프로세스 그룹(pgid = 띄운 프로세스 pid). 읽기 명령이 파이썬·afplay 를 또 띄워서 그룹째 끈다
static SPEAKING_PID: std::sync::Mutex<Option<u32>> = std::sync::Mutex::new(None);
#[cfg(test)]
pub(crate) static SPEAK_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn speak_gen() -> u64 {
    SPEAK_GEN.load(std::sync::atomic::Ordering::SeqCst)
}

/// 차례가 오면 읽는다 — 그사이 멈췄으면(gen 이 바뀌면) 안 읽는다. started 는 시작한 pid 를 받는다(테스트용)
/// who = 읽는 말의 주인(참모 세션 짧은 id) — 화면이 그 참모 탭·프사를 소리 크기대로 빛낸다(speak_now, 2026-10-03 사용자)
pub(crate) fn run_speech(argv: Vec<String>, gen: u64, who: Option<String>, mut started: impl FnMut(u32)) {
    let _turn = SPEAKING.lock().unwrap_or_else(|e| e.into_inner());
    if speak_gen() != gen || argv.is_empty() {
        return;
    }
    // Supertonic 은 wav 를 만든 뒤 PLAYING 을 찍고 튼다 — 그 전엔 '기다림'(빛 없음). 다른 명령은 곧바로 소리
    let prepared = is_supertonic_runner(&argv[0]);
    let id = say_begin(who, prepared);
    let mut cmd = crate::platform::command(&argv[0]);
    cmd.args(&argv[1..]).stdout(std::process::Stdio::piped());
    let Ok(mut child) = crate::platform::spawn_group(&mut cmd) else { say_end(id); return };
    *SPEAKING_PID.lock().unwrap_or_else(|e| e.into_inner()) = Some(child.id());
    started(child.id());
    // 빛의 시작 = 소리가 귀에 닿는 때 — PLAYING(afplay 를 띄운 때) 뒤 장치가 돌기까지 + 장치 출력 지연(audio_out, 2026-10-10 사용자 QA)
    let mut heard: Option<(u64, Option<usize>, Option<crate::audio_out::OutProbe>)> = None;
    if let Some(out) = child.stdout.take() {
        use std::io::BufRead;
        for line in std::io::BufReader::new(out).lines().map_while(Result::ok) {
            if let Some(path) = parse_playing(&line) {
                let at = now_ms();
                #[cfg(test)]
                PLAYING_AT.store(at, std::sync::atomic::Ordering::SeqCst); // 실측 시험이 고치기 전 시작(= PLAYING 을 읽은 때)과 견준다
                let probe = crate::audio_out::probe(); // 이미 돌고 있었나는 afplay 가 장치를 깨우기 전에 본다
                // afplay 가 틀기 전에 곡선을 뽑는다 — 파일은 실행기가 끝나며 지운다(복사·보관 안 함)
                let env = path.and_then(|p| std::fs::read(p).ok()).and_then(|b| wav_envelope(&b, HOP_MS));
                let n = env.as_ref().map(Vec::len);
                // 장치가 돌 때까지 '재생 중'을 미룬다 — 잠든 블루투스는 몇 분 쉰 뒤 깨는 데 2~4초 걸렸다(실측 2,124·3,835ms). 그래도 시작은 지금보다 출력 지연만큼 뒤라 화면이 먼저 안다
                let io = probe.and_then(|p| crate::audio_out::wait_io_start(p, 6000, now_ms, || speak_gen() == gen));
                let started = crate::audio_out::sound_at(at, probe, io);
                say_playing(id, env, started);
                heard = Some((started, n, probe));
            }
        }
    }
    let _ = child.wait();
    *SPEAKING_PID.lock().unwrap_or_else(|e| e.into_inner()) = None;
    // afplay 는 마지막 조각을 장치에 넘기면 끝난다 — 출력 지연만큼 소리가 더 나니 빛도 그만큼 더(다음 말이 시작되거나 멈추면 say_end 는 그냥 지나간다)
    let linger = heard.map_or(0, |(started, n, probe)| crate::audio_out::linger_ms(now_ms(), started, n, HOP_MS, probe));
    if linger == 0 {
        say_end(id);
    } else {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(linger));
            say_end(id);
        });
    }
}

#[cfg(test)]
static PLAYING_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 소리 크기 곡선 한 칸 = 25ms
const HOP_MS: u32 = 25;

/// 지금 읽는 말 — 기다림(만드는 중) · 재생 중 · 끝 · 멈춤
#[derive(Clone, Copy, PartialEq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SayPhase { Waiting, Playing, Done, Stopped }

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SayNow {
    /// 읽기마다 늘 커지는 번호(시각에서) — 늦게 온 옛 상태가 빛을 다시 켜지 않게 화면이 이걸로 거른다
    pub id: u64,
    pub from: Option<String>,
    pub phase: SayPhase,
    /// 소리가 귀에 닿는 시각(유닉스 ms, 지금보다 뒤일 수 있다) — 화면이 지금 시각 - 이것으로 곡선 칸을 찾는다
    pub started_ms: u64,
    pub hop_ms: u32,
    /// 0~255. 이미 받은 번호(known)면 None — 묻기마다 곡선을 다시 보내지 않는다. 파일이 없는 명령도 None(화면은 숨쉬기 빛)
    pub env: Option<Vec<u8>>,
}

struct SayState { id: u64, from: Option<String>, phase: SayPhase, started_ms: u64, env: Option<std::sync::Arc<Vec<u8>>> }
static SAY_NOW: std::sync::Mutex<SayState> = std::sync::Mutex::new(SayState { id: 0, from: None, phase: SayPhase::Done, started_ms: 0, env: None });

fn say_state() -> std::sync::MutexGuard<'static, SayState> {
    SAY_NOW.lock().unwrap_or_else(|e| e.into_inner())
}
fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn say_begin(from: Option<String>, prepared: bool) -> u64 {
    let mut s = say_state();
    let id = (s.id + 1).max(now_ms());
    *s = SayState { id, from, phase: if prepared { SayPhase::Waiting } else { SayPhase::Playing }, started_ms: if prepared { 0 } else { now_ms() }, env: None };
    id
}
/// started_ms = 소리가 귀에 닿을 때(audio_out::sound_at) — 지금보다 뒤일 수 있다, 화면은 그때까지 빛을 안 켠다
fn say_playing(id: u64, env: Option<Vec<u8>>, started_ms: u64) {
    let mut s = say_state();
    if s.id == id && s.phase == SayPhase::Waiting {
        s.phase = SayPhase::Playing;
        s.started_ms = started_ms;
        s.env = env.map(std::sync::Arc::new);
    }
}
/// 끝 — 이미 멈춤이면 그대로 둔다(끊긴 프로세스가 늦게 끝나며 '끝'으로 덮지 않게)
fn say_end(id: u64) {
    let mut s = say_state();
    if s.id == id && matches!(s.phase, SayPhase::Waiting | SayPhase::Playing) {
        s.phase = SayPhase::Done;
    }
}

/// 화면이 묻는다 — known = 곡선을 이미 받은 번호
pub(crate) fn speak_now(known: u64) -> SayNow {
    let s = say_state();
    let env = if s.id != known && s.phase == SayPhase::Playing { s.env.as_ref().map(|e| e.to_vec()) } else { None };
    SayNow { id: s.id, from: s.from.clone(), phase: s.phase, started_ms: s.started_ms, hop_ms: HOP_MS, env }
}

#[tauri::command]
pub fn speak_now_state(known: Option<u64>) -> SayNow {
    speak_now(known.unwrap_or(0))
}

/// "PLAYING" 또는 "PLAYING <wav 경로>" — 경로가 있으면 곡선을 뽑는다(옛 실행기는 경로 없이 찍는다)
pub(crate) fn parse_playing(line: &str) -> Option<Option<String>> {
    let t = line.trim();
    if t == "PLAYING" {
        return Some(None);
    }
    t.strip_prefix("PLAYING ").map(|p| Some(p.trim().to_string()).filter(|p| !p.is_empty()))
}

/// 16bit PCM wav → hop_ms 마다 크기(RMS) 0~255. 가장 큰 칸을 255 로(말 안에서 크고 작음이 보이게). 그 밖의 형식은 None
pub(crate) fn wav_envelope(b: &[u8], hop_ms: u32) -> Option<Vec<u8>> {
    if b.len() < 12 || &b[0..4] != b"RIFF" || &b[8..12] != b"WAVE" {
        return None;
    }
    let (mut fmt, mut data) = (None, None);
    let mut i = 12;
    while i + 8 <= b.len() {
        let size = u32::from_le_bytes(b[i + 4..i + 8].try_into().ok()?) as usize;
        let body = &b[i + 8..(i + 8 + size).min(b.len())];
        match &b[i..i + 4] {
            b"fmt " if body.len() >= 16 => fmt = Some(body),
            b"data" => data = Some(body),
            _ => {}
        }
        i += 8 + size + (size & 1);
    }
    let (fmt, data) = (fmt?, data?);
    let u16at = |o: usize| u16::from_le_bytes([fmt[o], fmt[o + 1]]);
    let (format, channels, rate, bits) = (u16at(0), u16at(2).max(1) as usize, u32::from_le_bytes(fmt[4..8].try_into().ok()?), u16at(14));
    if format != 1 || bits != 16 || rate == 0 {
        return None;
    }
    let frame = 2 * channels;
    let per = ((rate as u64 * hop_ms as u64 / 1000) as usize).max(1) * frame;
    let rms: Vec<f64> = data
        .chunks(per)
        .map(|c| {
            let n = c.len() / 2;
            let sum: f64 = c.chunks_exact(2).map(|s| { let v = i16::from_le_bytes([s[0], s[1]]) as f64 / 32768.0; v * v }).sum();
            if n == 0 { 0.0 } else { (sum / n as f64).sqrt() }
        })
        .collect();
    let peak = rms.iter().cloned().fold(0.0, f64::max);
    Some(rms.iter().map(|&r| if peak < 1e-4 { 0 } else { (r / peak * 255.0).round() as u8 }).collect())
}

/// 지금 말하는 것과 줄 선 것까지 멈춘다 — 음성 모드를 끌 때·앱을 끌 때
/// (2026-09-28 6,500자 음성이 8분째 돌았는데 멈출 방법이 없었다. 앱을 바꿔 넣어도 옛 앱이 띄운 음성은 계속 돌았다)
pub fn stop_speaking() {
    { // 화면 빛은 프로세스가 죽기 전에 먼저 끈다(2026-10-03 사용자 "끊으면 즉시")
        let mut s = say_state();
        if matches!(s.phase, SayPhase::Waiting | SayPhase::Playing) { s.phase = SayPhase::Stopped; }
    }
    SPEAK_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if let Some(pid) = *SPEAKING_PID.lock().unwrap_or_else(|e| e.into_inner()) {
        crate::platform::stop_group(pid);
    }
}

/// voice = 그 참모 목소리(M1~F5) — Supertonic 실행기 설정일 때만 바뀌고, 아니면 설정 그대로(tts::with_voice)
#[tauri::command]
pub fn speak(text: String, voice: Option<String>, from: Option<String>) {
    if text.trim().is_empty() {
        return;
    }
    log_out("speak", &text);
    let gen = speak_gen();
    std::thread::spawn(move || {
        let home = crate::config::home();
        let base = crate::config::current().tts_command;
        let cmd = voice.as_deref().and_then(|v| crate::tts::with_voice(&home, &base, v)).unwrap_or(base);
        let argv = crate::config::tts_argv(&home, &cmd, &text, |p| std::path::Path::new(p).is_file());
        if argv.first().is_some_and(|p| is_supertonic_runner(p)) { crate::tts::refresh_installed(); } // 깔린 옛 실행기면 wav 경로를 찍는 새것으로
        run_speech(argv, gen, from, |_| {});
    });
}

/// 들어 보기(프사 창 목소리 다이얼) 상태 — 준비 중(Supertonic 이 wav 를 만드는 1~2초) · 재생 중 · 끝 · 멈춤(2026-10-02 사용자)
/// 이벤트 대신 프론트가 재생하는 몇 초만 짧게 묻는다(앱 다른 곳도 묻는 방식)
#[derive(Clone, Copy, PartialEq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase { Preparing, Playing, Done, Stopped }

#[derive(serde::Serialize)]
pub struct PreviewState { pub id: u64, pub phase: Phase }

struct Preview { id: u64, phase: Phase, pid: Option<u32>, stopping: bool }
static PREVIEW: std::sync::Mutex<Preview> = std::sync::Mutex::new(Preview { id: 0, phase: Phase::Done, pid: None, stopping: false });

fn preview() -> std::sync::MutexGuard<'static, Preview> {
    PREVIEW.lock().unwrap_or_else(|e| e.into_inner())
}

/// Supertonic 실행기는 afplay 직전에 이 한 줄을 찍는다(tts/speak) — 그때부터 소리
pub(crate) fn is_playing_line(line: &str) -> bool {
    parse_playing(line).is_some()
}

/// 만들기(준비) 단계가 따로 있는 실행기 — 앱의 Supertonic 실행기. say·직접 명령은 곧바로 재생으로 본다
pub(crate) fn is_supertonic_runner(prog: &str) -> bool {
    let p = prog.replace('\\', "/");
    p.ends_with("/tts/supertonic/speak") || p.ends_with("/tts/supertonic/speak.cmd")
}

pub(crate) fn preview_state() -> PreviewState {
    let p = preview();
    PreviewState { id: p.id, phase: p.phase }
}

/// 새 들어 보기 차례 — 앞 들어 보기가 아직 돌면 멈춘다(빨리 넘기면 마지막 것만). 같은 번호면 그대로(이미 멈춤을 눌렀으면 false)
fn begin_preview(id: u64) -> bool {
    let mut p = preview();
    if p.id == id {
        return !p.stopping;
    }
    if let Some(pid) = p.pid.take() {
        crate::platform::stop_group(pid);
    }
    *p = Preview { id, phase: Phase::Preparing, pid: None, stopping: false };
    true
}

/// 들어 보기 한 번 — 참모 답 읽기와는 같은 차례 잠금을 쓴다
pub(crate) fn run_preview(argv: Vec<String>, id: u64, prepared: bool) {
    if !begin_preview(id) {
        return;
    }
    let _turn = SPEAKING.lock().unwrap_or_else(|e| e.into_inner());
    let gen = speak_gen();
    if preview().id != id || argv.is_empty() {
        return;
    }
    let mut cmd = crate::platform::command(&argv[0]);
    cmd.args(&argv[1..]).stdout(std::process::Stdio::piped());
    let Ok(mut child) = crate::platform::spawn_group(&mut cmd) else {
        let mut p = preview();
        if p.id == id { p.phase = Phase::Done; }
        return;
    };
    *SPEAKING_PID.lock().unwrap_or_else(|e| e.into_inner()) = Some(child.id());
    {
        let mut p = preview();
        if p.id == id {
            p.pid = Some(child.id());
            if !prepared { p.phase = Phase::Playing; }
        }
    }
    if let Some(out) = child.stdout.take() {
        use std::io::BufRead;
        for line in std::io::BufReader::new(out).lines().map_while(Result::ok) {
            if is_playing_line(&line) {
                let mut p = preview();
                if p.id == id && p.phase == Phase::Preparing { p.phase = Phase::Playing; }
            }
        }
    }
    let _ = child.wait();
    *SPEAKING_PID.lock().unwrap_or_else(|e| e.into_inner()) = None;
    let mut p = preview();
    if p.id == id {
        p.pid = None;
        p.phase = if p.stopping || speak_gen() != gen { Phase::Stopped } else { Phase::Done };
    }
}

/// 프사 창 목소리 들어 보기 — id 는 프론트가 매기는 번호(가장 큰 것이 지금 것)
#[tauri::command]
pub fn speak_preview(id: u64, text: String, voice: Option<String>) {
    if text.trim().is_empty() {
        return;
    }
    begin_preview(id); // 바로 묻는 첫 번에도 '준비 중', 앞 들어 보기는 여기서 멈춘다
    std::thread::spawn(move || {
        let home = crate::config::home();
        let base = crate::config::current().tts_command;
        let cmd = voice.as_deref().and_then(|v| crate::tts::with_voice(&home, &base, v)).unwrap_or(base);
        let argv = crate::config::tts_argv(&home, &cmd, &text, |p| std::path::Path::new(p).is_file());
        let prepared = argv.first().is_some_and(|p| is_supertonic_runner(p));
        if prepared { crate::tts::refresh_installed(); }
        run_preview(argv, id, prepared);
    });
}

#[tauri::command]
pub fn speak_preview_state() -> PreviewState {
    preview_state()
}

/// 그 들어 보기만 멈춘다 — 참모 답 읽기 줄은 건드리지 않는다
#[tauri::command]
pub fn speak_preview_stop(id: u64) {
    let mut p = preview();
    if p.id != id { return; }
    p.stopping = true;
    match p.pid { Some(pid) => crate::platform::stop_group(pid), None => p.phase = Phase::Stopped }
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
/// 되살리기 1순위 — `claude respawn <짧은 번호>`. 같은 세션 번호·이름·권한 모드 그대로 다시 켠다.
/// `--bg --resume` 은 언제나 새 번호 **복사본**을 만들고, 압축한 세션이면 새 기록이 마지막 압축 지점부터라
/// 채팅 뷰에서 그 앞 대화·주고받은 파일이 사라져 보였고 이름도 새로 붙었다(2026-10-01 사용자, 참모-2 가 새 번호로 갈렸다).
/// 짧은 번호(16진수 8자)가 아니면 빈 목록 — 예전처럼 이어 띄운다
fn revive_args(id: Option<&str>) -> Vec<String> {
    match id {
        Some(i) if i.len() == 8 && i.chars().all(|c| c.is_ascii_hexdigit()) => vec!["respawn".into(), i.into()],
        _ => vec![],
    }
}

/// `agents --json` 원문에 그 대화가 살아 있나 — state 가 done 이어도 목록에 있으면 산 것(턴을 끝내고 기다리는 중)
fn live_has(live_json: &str, session_id: &str) -> bool {
    !session_id.is_empty()
        && serde_json::from_str::<serde_json::Value>(live_json)
            .ok()
            .and_then(|v| v.as_array().cloned())
            .is_some_and(|a| a.iter().any(|x| x["sessionId"].as_str() == Some(session_id)))
}

/// 꺼진 세션 이어서 켜기(데스크톱 ▷·주인 잃은 일). 그사이 다른 길로 이미 켜졌으면 아무것도 안 한다 —
/// respawn 은 '재시작'이라 살아 있는 세션에 부르면 하던 턴이 끊긴다(낡은 꺼진 목록에서 누름, 2026-10-05). 목록을 못 읽으면 예전처럼 켠다
#[tauri::command]
pub async fn resume_session(cwd: String, session_id: String, id: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let live = crate::platform::run_capped(crate::platform::command(claude_bin()).args(["agents", "--json"]), std::time::Duration::from_secs(10));
        if live.is_ok_and(|o| o.status.success() && live_has(&String::from_utf8_lossy(&o.stdout), &session_id)) {
            return Ok("already running".to_string());
        }
        resume_blocking(&cwd, &session_id, id.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// resume_session 의 몸통 — 폰 서버(mobile.rs)도 같은 길로 되살린다
pub fn resume_blocking(cwd: &str, session_id: &str, id: Option<&str>) -> Result<String, String> {
    crate::trust::before_spawn(cwd);
    crate::browser_attach::reassert_for(cwd);
    let first = revive_args(id);
    if !first.is_empty() {
        if let Ok(out) = crate::platform::command(claude_bin()).current_dir(cwd).args(&first).output() {
            let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
            if out.status.success() && text.contains("respawned") {
                return Ok(text.trim().to_string());
            }
        }
    }
    let out = crate::platform::command(claude_bin())
        .current_dir(cwd)
        // 이어서 켤 때도 권한 확인 없이 — 안 붙이면 daemon 재시작 뒤 되살린 세션이 auto 모드로 떠서
        // Bash 마다 사용자 승인을 기다렸다(2026-09-28, 사용자 요청 "항상 바이패스로 켜지게"). CLAUDE.md 원칙 3
        .args(["--bg", "--dangerously-skip-permissions", "--resume", session_id])
        .output()
        .map_err(|e| e.to_string())?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    if !out.status.success() {
        return Err(text.trim().to_string());
    }
    Ok(text.trim().to_string())
}

/// 상태줄 스크립트가 남긴 최신 입력(사용 한도 포함). 없으면 빈 문자열. 파싱은 domain/usage.ts
#[tauri::command]
pub fn read_usage() -> String {
    std::fs::read_to_string(crate::config::data_file("statusline.json")).unwrap_or_default()
}

#[derive(Serialize)]
pub struct UsageAt {
    pub json: String,
    /// 파일 고친 시각(ms) — 계정을 바꾼 뒤 새 값인지 가리는 데 쓴다. 없으면 0
    pub at: u64,
}

/// 사용량 + 언제 쓰였나. 계정 자동 전환이 '바꾼 뒤에 쓰인 값'만 새 계정 것으로 본다(domain/accountAuto.ts)
#[tauri::command]
pub fn read_usage_at() -> UsageAt {
    let p = crate::config::data_file("statusline.json");
    let at = std::fs::metadata(&p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
    UsageAt { json: std::fs::read_to_string(&p).unwrap_or_default(), at }
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
        // .git 이 파일이면 다른 저장소의 worktree(형제 폴더) — 본체에서 이미 --all 로 센다
        let repos: Vec<_> = crate::project::dirs_now(&dev_root).into_iter().filter(|(_, dir)| dir.join(".git").is_dir()).collect();
        let logs = par_map(&repos, git_workers(), |(_, dir)| git(dir, &["log", "--all", "--no-merges", &format!("--since={since}"), &format!("--author={author}"), "--shortstat", "--format=format:@@C"]));
        for ((name, _), log) in repos.into_iter().zip(logs) {
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
        let mut args = vec!["log".to_string(), "--all".into(), format!("--since={since}"), format!("--author={author}"), "--numstat".into(), "--format=format:@@C%x09%H%x09%ct%x09%P%x09%s".into()];
        if let Some(u) = &until {
            args.push(format!("--until={u}"));
        }
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        let repos: Vec<_> = crate::project::dirs_now(&dev_root).into_iter().filter(|(_, dir)| dir.join(".git").is_dir()).collect();
        let logs = par_map(&repos, git_workers(), |(_, dir)| git(dir, &args));
        let mut out = String::new();
        for ((name, _), log) in repos.iter().zip(logs) {
            out.push_str(&format!("@@R\t{name}\n"));
            out.push_str(&log);
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
                    let out = crate::platform::command(&gh)
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
    use std::time::Duration;
    // 윈도우: 화면만 읽으려고 새로 붙으면 열린 터미널 보기가 쫓겨난다 — 열려 있으면 읽지 않는다
    if cfg!(windows) && keys.is_none() && crate::pty::session_has_view(id) {
        return Err(crate::i18n::tr("터미널 보기가 붙어 있어 화면을 따로 못 읽어", "A terminal view is attached — can't read the screen separately").into());
    }
    attach_do(id, |w, _| {
        if let Some(k) = keys {
            // 화살표·글자는 하나씩 조금 쉬어 가며 — 한꺼번에 넣으면 TUI 가 놓칠 수 있다
            for chunk in k.split_inclusive(|&b| b == b'\r' || b == b'~' || b == b'A' || b == b'B') {
                w.write_all(chunk)?;
                std::thread::sleep(Duration::from_millis(150));
            }
            std::thread::sleep(Duration::from_millis(700));
        }
        Ok(())
    })
}

/// 선택지 답(화살표·Enter)을 누른다 — 윈도우 scripts/choice 가 app.jsonl 로 부탁한다(appctl)
pub(crate) fn press_keys(id: &str, keys: &str) -> Result<(), String> {
    with_attach(id, Some(keys.as_bytes())).map(|_| ())
}

/// 글을 사람이 치듯 넣고 0.4초 쉬었다가 Enter(따로). 결정 대기함 답장·참모 입력칸 전달
fn attach_type(id: &str, text: &[u8]) -> Result<(), String> {
    attach_type_segs(id, &text.chunks(256).map(<[u8]>::to_vec).collect::<Vec<_>>())
}

/// 여러 줄 글을 치는 조각들 — 줄마다 글(256 바이트씩) + 줄바꿈 Option+Enter(ESC CR 는 한 조각으로: 따로 가면 Esc 로 먹혀 멈춘다)
pub(crate) fn typed_segs(text: &str) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    for (i, line) in text.replace('\t', "  ").split('\n').enumerate() {
        if i > 0 {
            out.push(b"\x1b\r".to_vec());
        }
        out.extend(line.as_bytes().chunks(256).map(<[u8]>::to_vec));
    }
    out
}

/// 여러 줄 글 보내기(스페이스 → 참모). 결정 대기함 답장과 같이 치고 0.4초 뒤 Enter
#[tauri::command]
pub async fn send_text_to_session(id: String, text: String) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err(crate::i18n::tr("빈 글", "Empty text").into());
    }
    let segs = typed_segs(&text);
    let who = id.clone();
    let short: String = text.chars().take(80).collect();
    let r = tauri::async_runtime::spawn_blocking(move || attach_type_segs(&id, &segs)).await.map_err(|e| e.to_string()).and_then(|r| r);
    log_out("space-send", &format!("{who} {} {short}", if r.is_ok() { "ok" } else { "fail" }));
    r
}

/// 직접 답하기 카드 답 치기 — send_text_to_session 과 같은 길인데 친 글을 로그에 안 남긴다(사람이 카드에 쓴 글, 2026-10-03 QA)
pub(crate) fn type_text_quiet(id: &str, text: &str) -> Result<(), String> {
    type_text_tagged(id, text, "direct-send")
}

/// 글 없이 꼬리표만 남기고 세션에 친다 — 자리표 알림(appctl slot-notice) 등
pub(crate) fn type_text_tagged(id: &str, text: &str, tag: &str) -> Result<(), String> {
    let r = attach_type_segs(id, &typed_segs(text));
    log_out(tag, &format!("{id} {}", if r.is_ok() { "ok" } else { "fail" }));
    r
}

/// 입력칸('─' 줄 바로 아래 '❯' 줄부터 다음 '─' 줄 앞까지)에 사람이 친 글이 있나 — 빈 칸 안내 글(Try "…")은 없는 것으로.
/// 입력칸을 못 찾아도 없는 것으로: 치워 두기(Ctrl+S)는 빈 칸이면 치워 둔 글을 꺼내 와서 오히려 섞인다
pub(crate) fn input_has_text(screen: &vt100::Screen) -> bool {
    let (_, cols) = screen.size();
    let lines: Vec<String> = screen.rows(0, cols).collect();
    // 입력칸과 테두리는 맨 앞 칸부터 — 들여 쓴 확인 창 줄(' ❯ 1. Yes')은 입력칸이 아니다
    let border = |l: &str| l.starts_with('─');
    let Some(i) = (1..lines.len()).rev().find(|&i| lines[i].starts_with('❯') && border(&lines[i - 1])) else { return false };
    let body: Vec<&str> = std::iter::once(lines[i].trim_start_matches('❯'))
        .chain(lines[i + 1..].iter().take_while(|l| !border(l)).map(String::as_str))
        .map(|l| l.trim_matches(|c: char| c.is_whitespace() || c == '\u{a0}'))
        .filter(|l| !l.is_empty())
        .collect();
    !(body.is_empty() || (body.len() == 1 && body[0].starts_with("Try \"") && body[0].ends_with('"')))
}

/// 세션에 글을 치는 일은 한 번에 하나 — 둘이 겹치면 한 입력칸에 섞여 들어간다
/// (2026-10-02: /rename 뒤에 다른 글이 붙어 이름이 '참모-3 · 쇼핑몰 문의 좀 모였나? 답한 거?'가 됐다)
static TYPE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 세션에 글을 칠 차례 — 잡고 있는 동안 다른 길은 기다린다(채팅 창 치기 pty::type_keys 도 이걸 잡는다)
pub(crate) fn typing_turn() -> std::sync::MutexGuard<'static, ()> {
    TYPE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

fn attach_type_segs(id: &str, segs: &[Vec<u8>]) -> Result<(), String> {
    use std::time::Duration;
    let _turn = typing_turn();
    attach_do(id, |w, screen| {
        // 사람이 입력칸에 반쯤 친 글이 있으면 치워 두고(Ctrl+S) 친다 — 보내면 Claude Code 가 그 글을 되돌려 놓는다(일하는 중 줄 서기여도).
        // 안 그러면 그 글 뒤에 붙어 Enter 로 같이 나갔다(2026-09-28 부채, 2026-10-09 실측)
        if screen.is_some_and(input_has_text) {
            log_out("type-stash", id);
            w.write_all(b"\x13")?;
            std::thread::sleep(Duration::from_millis(300));
        }
        for chunk in segs {
            w.write_all(chunk)?;
            std::thread::sleep(Duration::from_millis(5));
        }
        std::thread::sleep(Duration::from_millis(400));
        w.write_all(b"\r")?;
        std::thread::sleep(Duration::from_millis(700));
        Ok(())
    })
    .map(|_| ())
}

/// 하던 일 멈추기(폰 /api/interrupt) — Esc 한 번. 글 치기와 같은 잠금을 잡는다: 폰이 글을 치는 도중에 Esc 가 끼면 치던 글 사이에 들어간다
pub fn interrupt_session(id: &str) -> Result<(), String> {
    let _turn = typing_turn();
    with_attach(id, Some(b"\x1b")).map(|_| ())
}

/// attach 를 붙여 화면을 읽고 write 로 키를 넣은 뒤 뗀다 — write 는 붙은 화면을 같이 받는다(윈도우 열린 보기로 쓸 땐 None)
fn attach_do(id: &str, write: impl FnOnce(&mut dyn std::io::Write, Option<&vt100::Screen>) -> std::io::Result<()>) -> Result<String, String> {
    // 윈도우: 앱이 이 세션 터미널 보기를 열어 두었으면 거기에 바로 쓴다 — 새로 붙으면 그 창이 쫓겨나고(세션당 한 창) 붙는 데 20초 걸렸다.
    // 화면 글자는 없으니 빈 글로 돌려준다(권한 창 자동 허용의 화면 읽기는 with_attach 가 따로 막는다)
    if cfg!(windows) {
        if let Some(w) = crate::pty::session_writer(id) {
            log_out("attach", &format!("{id} via-open-terminal"));
            let mut g = w.lock().unwrap();
            return write(&mut **g, None).map(|_| String::new()).map_err(|e| e.to_string());
        }
        // 열린 보기가 화면을 못 받았으면(가짜 콘솔이 멈춤) 거기 쓰면 허공에 간다 — 새로 붙는다
        if crate::pty::session_has_view(id) {
            log_out("attach", &format!("{id} open-terminal-not-ready"));
        }
    }
    attach_new(id, write)
}

/// 새로 붙어서(claude attach) 화면을 읽고 키를 넣은 뒤 뗀다
fn attach_new(id: &str, write: impl FnOnce(&mut dyn std::io::Write, Option<&vt100::Screen>) -> std::io::Result<()>) -> Result<String, String> {
    use std::io::Write;
    use std::ops::Not;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    let (rows, cols) = (40u16, 120u16);
    // 윈도우 진단: 어느 단계에서 멈추는지·몇 바이트 받았는지 notify.log 에 남긴다(맥은 안 남김)
    let trace = |step: &str| if cfg!(windows) { log_out("attach", &format!("{id} {step}")) };
    let parser = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, 0)));
    let got = Arc::new(AtomicUsize::new(0));
    // 쓰기는 띄운 뒤에 생긴다 — 읽기 스레드가 "커서 어디?"에 답하려고 같은 자리를 나눠 쓴다
    // 질문이 쓰기보다 먼저 오면(띄우자마자 온다) 기억해 뒀다가 쓰기가 생기는 순간 답한다 — 둘 다 같은 잠금 안에서(윈도우는 매번 469바이트에서 멈췄다)
    let slot: Arc<Mutex<(Option<Box<dyn std::io::Write + Send>>, bool)>> = Arc::new(Mutex::new((None, false)));
    // 받은 앞부분(진단용, 윈도우만 기록) + 조각 경계에 걸린 질문도 잡게 앞 조각 끝 몇 바이트
    let head = Arc::new(Mutex::new(Vec::<u8>::new()));
    let (p2, g2, s2, h2) = (parser.clone(), got.clone(), slot.clone(), head.clone());
    let mut tail: Vec<u8> = Vec::new();
    let idc = id.to_string();
    trace("open");
    // 터미널 보기와 같은 길(pty::spawn_pty, 셸로 감싸 홈에서) — 따로 짠 길은 윈도우에서 화면이 0바이트였다
    let (master, writer, mut child) = crate::pty::spawn_pty(&crate::pty::attach_line(&claude_bin(), id, cfg!(windows)), None, cols, rows, move |b| {
        g2.fetch_add(b.len(), Ordering::Relaxed);
        {
            let mut h = h2.lock().unwrap();
            if h.len() < 600 { let n = (600 - h.len()).min(b.len()); h.extend_from_slice(&b[..n]); }
        }
        // 윈도우 가짜 콘솔(ConPTY)은 먼저 "커서 어디?"(ESC[6n)를 묻고 답이 올 때까지 안 그린다 — 터미널 보기는 xterm.js 가 답한다
        let mut joined = std::mem::take(&mut tail);
        joined.extend_from_slice(b);
        if asks_cursor(&joined) {
            let mut g = s2.lock().unwrap();
            match g.0.as_mut() {
                Some(w) => {
                    let _ = w.write_all(b"\x1b[1;1R");
                    if cfg!(windows) { log_out("attach", &format!("{idc} cursor-answered")); }
                }
                None => g.1 = true,
            }
        }
        tail = joined[joined.len().saturating_sub(3)..].to_vec();
        p2.lock().unwrap().process(b);
        true
    })?;
    {
        let mut g = slot.lock().unwrap();
        let mut writer = writer;
        if g.1 {
            let _ = writer.write_all(b"\x1b[1;1R");
            trace("cursor-answered-late");
        }
        g.0 = Some(writer);
    }
    trace("spawned");
    // 윈도우: claude attach 가 크기 바뀜을 한 번 받기 전엔 화면을 안 그렸다(cmd 지우기 두 번 뒤 0글자) — 터미널 보기는
    // 창에 맞출 때 크기를 바꿔 줘서 그려졌다. 한 칸 줄였다 되돌린다(맥은 바로 그려서 안 건드린다)
    if cfg!(windows) {
        std::thread::sleep(Duration::from_millis(800));
        let _ = master.resize(portable_pty::PtySize { rows, cols: cols - 1, pixel_width: 0, pixel_height: 0 });
        std::thread::sleep(Duration::from_millis(200));
        let _ = master.resize(portable_pty::PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
        trace("resized");
    }
    // 화면이 붙을 때까지 — 1.5초 기다리고, 글자가 아직 없으면 조금씩 더(최대 8초)
    std::thread::sleep(Duration::from_millis(1500));
    let started = std::time::Instant::now();
    // 윈도우는 더 길게(25초) — 보이는 콘솔에서도 attach 가 그리기까지 6초쯤 걸렸고 cmd·백신 검사까지 얹힌다. 2초마다 받은 바이트를 남긴다
    let limit = Duration::from_millis(if cfg!(windows) { 25_000 } else { 6_500 });
    let mut next_note = Duration::from_secs(2);
    while screen_ready(&parser.lock().unwrap().screen().contents()).not() && started.elapsed() < limit {
        std::thread::sleep(Duration::from_millis(250));
        if started.elapsed() >= next_note {
            trace(&format!("wait {}s bytes {}", next_note.as_secs(), got.load(Ordering::Relaxed)));
            next_note += Duration::from_secs(2);
        }
    }
    let screen = parser.lock().unwrap().screen().contents();
    trace(&format!("bytes {} head {}", got.load(Ordering::Relaxed), String::from_utf8_lossy(&head.lock().unwrap()).escape_debug()));
    let close = |master: Box<dyn portable_pty::MasterPty + Send>| {
        // 윈도우: 가짜 콘솔 닫기가 영영 안 돌아왔다 — 딴 스레드에 맡긴다
        if cfg!(windows) { std::thread::spawn(move || drop(master)); } else { drop(master); }
    };
    // attach 가 벌써 끝났거나(없는 세션 — 오류 글만 찍고 나간다) 그 오류 글이 떴으면 누를 곳이 없다
    if matches!(child.try_wait(), Ok(Some(_))) || screen.contains("No job matching") {
        trace("exited");
        close(master);
        return Err(crate::i18n::tr("세션에 붙지 못했어(없는 세션?)", "Couldn't attach (no such session?)").into());
    }
    if !screen_ready(&screen) {
        // 붙지 못했는데 누르면 허공에 간다 — 실패로 알린다
        trace("no-screen");
        crate::pty::reap(child);
        close(master);
        return Err(crate::i18n::tr("세션 화면이 안 떴어", "The session screen didn't come up").into());
    }
    trace("write");
    let shown = parser.lock().unwrap().screen().clone();
    let r = match slot.lock().unwrap().0.as_mut() {
        Some(w) => write(&mut **w, Some(&shown)).map_err(|e| e.to_string()),
        None => Err("no writer".into()),
    };
    trace("kill");
    crate::pty::reap(child);
    slot.lock().unwrap().0.take();
    close(master);
    trace("done");
    r.map(|_| screen)
}

/// 가짜 콘솔이 "커서 어디?"(ESC[6n)를 물었나 — 답(ESC[1;1R)을 해야 그리기 시작한다
fn asks_cursor(out: &[u8]) -> bool {
    out.windows(4).any(|x| x == b"\x1b[6n")
}

/// attach 화면에 글자가 떴나(빈칸 말고 몇 글자라도) — 붙기 전에 누른 키는 버려진다
fn screen_ready(screen: &str) -> bool {
    screen.chars().filter(|c| !c.is_whitespace()).count() >= 20
}

/// 답장 글(한 줄): 사람이 치듯 그대로, 탭은 띄어쓰기(탭은 자동완성). Enter 는 attach_type 이 쉬었다가 따로 넣는다.
/// 2026-09-30: 빠르게 친 글 + 바로 Enter → Claude 가 Enter 를 줄바꿈으로 넣어 안 보내졌다(참모 입력칸에 쌓임·알림 답장 유실).
/// 붙여넣기 표시로 감싸면 보내지긴 하지만 긴 글이 '붙여넣은 글'이 된다 — 시험 세션 실측으로 둘 다 피하는 게 이 방식
pub(crate) fn reply_text(line: &str) -> Vec<u8> {
    line.replace('\t', "  ").into_bytes()
}

/// 결정 대기함 답장: 그 세션 입력칸에 사람이 치는 것과 똑같이 글자 + Enter.
/// SendMessage 는 선택지·입력칸에 답으로 안 들어간다(메모리 read-subsession-pending-choice). 확인창·선택지엔 쓰지 않는다(프론트가 막음)
#[tauri::command]
pub async fn send_to_session(id: String, text: String) -> Result<(), String> {
    let line = text.replace(['\r', '\n'], " ");
    if line.trim().is_empty() {
        return Err(crate::i18n::tr("빈 답장", "Empty reply").into());
    }
    let short: String = line.chars().take(80).collect();
    let keys = reply_text(&line);
    // 답장이 어디로 갔는지 남긴다 — "알림에 답했는데 안 갔다"(2026-09-30)를 기록으로 가리려고
    let who = id.clone();
    let r = tauri::async_runtime::spawn_blocking(move || attach_type(&id, &keys))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    log_out("reply", &format!("{who} {} {short}", if r.is_ok() { "ok" } else { "fail" }));
    r
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
        // 말하기 키 안내의 "키보드 설정 열기" — 이 주소 하나만(🌐 키 동작을 '아무것도 안 함'으로)
        "url" if target == "x-apple.systempreferences:com.apple.Keyboard-Settings.extension" => {}
        "file" if std::path::Path::new(&target).exists() => {}
        "file" => return Err(format!("{}: {target}", crate::i18n::tr("파일이 없어", "File not found"))),
        _ => return Err(crate::i18n::tr("열 수 없는 링크", "This link cannot be opened").into()),
    }
    crate::platform::open_path(&target).map_err(|e| e.to_string())
}

/// 터미널에서 복사한 글자를 클립보드에 넣는다(맥 pbcopy·윈도우 clip.exe — platform::clipboard_write).
/// 웹뷰의 navigator.clipboard 는 사용자 입력 도중이 아니면 막히는데, OSC 52 는 pty 출력으로 늦게 도착한다.
/// GUI 앱은 LANG 이 비어 있어서 그대로 두면 pbcopy 가 한글을 깨뜨린다 — UTF-8 로 못 박는다
#[tauri::command]
pub fn clipboard_write(text: String) -> Result<(), String> {
    crate::platform::clipboard_write(&text)
}

/// 관리 프로그램 lock 파일 글자 → 시작 시각(ms). 모양이 다르거나 없으면 None
pub(crate) fn parse_daemon_started_at(text: &str) -> Option<i64> {
    serde_json::from_str::<serde_json::Value>(text).ok()?.get("startedAt")?.as_i64()
}

/// 관리 프로그램(claude daemon) 시작 시각 — `~/.claude/daemon.lock` 의 startedAt.
/// 바뀌면 재시작된 것 → 직전에 살아 있던 세션이 꺼졌다(domain/revive.ts)
#[tauri::command]
pub fn daemon_started_at() -> Option<i64> {
    let home = crate::platform::home();
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

/// 지금 사용자가 보는 화면 한 줄(domain/viewNow) — 참모 훅(scripts/voice-hint)이 지시마다 붙인다(2026-10-02 사용자 "내가 보는 화면을 니가 감지하느냐").
/// 첫 줄은 앱 pid — 훅이 앱이 살아 있을 때만 붙이게(꺼진 앱의 옛 화면을 지금 화면처럼 말하지 않게)
pub fn view_body(pid: u32, text: &str) -> String {
    let one: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("{pid}\n{}\n", one.chars().take(600).collect::<String>())
}

#[tauri::command]
pub fn write_view(text: String) -> Result<(), String> {
    let path = orch_file("view.txt");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("txt.tmp");
    std::fs::write(&tmp, view_body(std::process::id(), &text)).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod view_tests {
    #[test]
    fn 화면_줄은_pid_다음_한_줄로() {
        assert_eq!(super::view_body(42, "채팅 뷰 · 채팅 탭 참모\n하니터"), "42\n채팅 뷰 · 채팅 탭 참모 하니터\n");
        assert_eq!(super::view_body(1, &"가".repeat(900)).chars().count(), 2 + 600 + 1, "너무 길면 자른다(지시마다 붙는다)");
    }
}

/// 음성 모드 켜짐/꺼짐을 파일로 — 참모 쪽 훅(scripts/voice-hint)이 읽고 "음성용 말을 따로 써라"를 알려 준다
#[tauri::command]
pub fn write_voice_mode(on: bool) -> Result<(), String> {
    if !on {
        stop_speaking(); // 끄면 말하던 것도 바로 멈춘다
    }
    let path = orch_file("voice.json");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(path, format!("{{\"on\":{on}}}")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod speak_tests {
    use super::{run_speech, stop_speaking, SPEAK_TEST_LOCK};
    use std::time::{Duration, Instant};

    fn alive(pid: u32) -> bool {
        crate::platform::command("/bin/kill").args(["-0", &pid.to_string()]).status().map(|s| s.success()).unwrap_or(false)
    }

    // 2026-09-28: 6,500자 음성이 8분째 돌았는데 멈출 방법이 없었다 — 음성 모드를 끄면 지금 말하는 것부터 멈춘다
    #[test]
    fn 멈추면_지금_읽는_것과_그_아래_프로세스까지_꺼진다() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (tx, rx) = std::sync::mpsc::channel();
        let argv = vec!["/bin/sh".to_string(), "-c".into(), "sleep 30 & echo $! > /tmp/chammo-speak-test.pid; wait".into()];
        let h = std::thread::spawn(move || { run_speech(argv, super::speak_gen(), None, |pid| { let _ = tx.send(pid); }); });
        let pid = rx.recv_timeout(Duration::from_secs(3)).expect("시작");
        std::thread::sleep(Duration::from_millis(300));
        let child: u32 = std::fs::read_to_string("/tmp/chammo-speak-test.pid").unwrap().trim().parse().unwrap();
        let t = Instant::now();
        stop_speaking();
        h.join().unwrap();
        assert!(t.elapsed() < Duration::from_secs(2));
        std::thread::sleep(Duration::from_millis(200));
        assert!(!alive(pid) && !alive(child), "셸과 그 아래 sleep 까지 꺼져야 한다");
    }

    #[test]
    fn 멈춘_뒤엔_줄_서_있던_것도_안_읽는다() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let queued = super::speak_gen();
        stop_speaking();
        let mut started = false;
        run_speech(vec!["/usr/bin/true".into()], queued, None, |_| started = true);
        assert!(!started);
    }
}

#[cfg(test)]
mod tests {
    use super::{action_line, input_has_text, live_has, parse_daemon_started_at, resolve_claude_bin, revive_args, user_path};
    #[test]
    fn 입력칸에_사람이_친_글이_있나() {
        // 2026-10-09 실측(2.1.295): 입력칸은 '─' 줄 바로 아래 '❯\u{a0}' 줄. 빈 칸의 안내 글(Try "…")은 흐림(ESC[2m)인데 vt100 은 흐림을 안 읽어 글 모양으로 가른다
        let screen = |bytes: &str| {
            let mut p = vt100::Parser::new(40, 120, 0);
            p.process(bytes.as_bytes());
            p
        };
        let top = "\x1b[38;2;136;136;136m──────── stash-lab ─\r\n\x1b[39m";
        let bottom = "\r\n\x1b[38;2;136;136;136m────────\r\n  main · Haiku";
        let history = "❯ 안녕이라고만 답해\r\n⏺ 안녕\r\n"; // 지난 대화의 ❯ 줄은 입력칸이 아니다
        assert!(input_has_text(screen(&format!("{history}{top}❯\u{a0}두번째글{bottom}")).screen()));
        assert!(!input_has_text(screen(&format!("{history}{top}❯\u{a0}{bottom}")).screen()));
        assert!(!input_has_text(screen(&format!("{top}❯\u{a0}\x1b[2mTry \"how does <filepath> work?\"\x1b[22m{bottom}")).screen()));
        assert!(!input_has_text(screen(history).screen()), "입력칸을 못 찾으면 없는 것으로(치워 두기 Ctrl+S 는 빈 칸이면 치워 둔 글을 꺼낸다)");
        // 여러 줄 글 — 둘째 줄에만 글이 있어도
        assert!(input_has_text(screen(&format!("{top}❯\u{a0}\r\n  둘째 줄{bottom}")).screen()));
        assert!(!input_has_text(screen(&format!("{top} ❯ 1. Yes\r\n   2. No{bottom}")).screen()), "들여 쓴 확인 창 줄");
    }

    // 실측(손으로, 진짜 세션 필요): 입력칸에 글을 반쯤 쳐 둔 세션에 앱 길(type_text_tagged)로 한 줄 — 그 줄만 보내지고 반쯤 친 글은 입력칸에 돌아오나.
    // STASHTEST_ID=<세션 id> CHAMMO_HOME=<시험 폴더> cargo test --bin honor-orchestrator claude::tests::실측_반쯤_친_글 -- --ignored --exact
    #[test]
    #[ignore]
    fn 실측_반쯤_친_글은_치워_두고_친다() {
        let id = std::env::var("STASHTEST_ID").expect("STASHTEST_ID");
        super::type_text_tagged(&id, "앱이 넣은 한 줄 — 반쯤 친 글과 섞이면 안 됨", "stashtest").unwrap();
        std::thread::sleep(std::time::Duration::from_secs(2));
        let shown = super::with_attach(&id, None).unwrap();
        eprintln!("{shown}");
    }

    #[test]
    fn 세션_끄기는_어느_길인지_한_줄로() {
        // 2026-09-28 참모-2 가 18:44 에 꺼졌는데 ⌘W·창 버튼·다른 앱 중 무엇인지 몰라 추정만 했다
        assert_eq!(action_line(1700000000000, "stop", "f00d0001", "cmd-w 참모-2"), "1700000000000\tstop\tf00d0001\tcmd-w 참모-2");
        // 이유에 줄바꿈·탭이 섞여도 한 줄 네 칸
        assert_eq!(action_line(1, "rm", "f00d0001", "menu\n참모\t3"), "1\trm\tf00d0001\tmenu 참모 3");
        assert_eq!(action_line(1, "stop", "f00d0001", " "), "1\tstop\tf00d0001\t?");
    }
    #[test]
    fn 살아_있는_세션은_되살리기_대상이_아니다() {
        // claude respawn 은 '재시작'이라 살아 있는 세션에 부르면 하던 턴이 끊긴다 — 낡은 꺼진 목록에서 ▷ 를 눌러도(2026-10-05)
        let live = r#"[{"id":"aaaa0001","sessionId":"11111111-1111-4111-8111-111111111111","state":"done","status":"idle"}]"#;
        assert!(live_has(live, "11111111-1111-4111-8111-111111111111"));
        assert!(!live_has(live, "22222222-2222-4222-8222-222222222222"));
        assert!(!live_has("not json", "11111111-1111-4111-8111-111111111111"));
        assert!(!live_has(live, ""));
    }
    #[test]
    fn 꺼진_세션은_respawn_으로_같은_번호_그대로_되살린다() {
        // --bg --resume 은 언제나 새 번호 복사본을 만들고, 압축한 세션이면 마지막 압축 앞 대화가 새 기록에 없다(2026-10-01 실측)
        assert_eq!(revive_args(Some("f00d0001")), vec!["respawn".to_string(), "f00d0001".to_string()]);
        // 짧은 번호가 아니면(목록에 없던 옛 기록) respawn 을 못 쓴다 — 예전처럼 이어 띄우기
        assert!(revive_args(None).is_empty());
        assert!(revive_args(Some("f00d0001-0000-4000-8000-004027383809")).is_empty());
        assert!(revive_args(Some("x; rm")).is_empty());
    }

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

#[cfg(test)]
mod attach_tests {
    use super::{asks_cursor, screen_ready};

    #[test]
    fn 가짜_콘솔의_커서_질문을_알아본다() {
        assert!(asks_cursor(b"\x1b[?9001h\x1b[?1004h\x1b[6n"));
        assert!(!asks_cursor(b"\x1b[6"));
        assert!(!asks_cursor("사과와 배".as_bytes()));
    }

    #[test]
    fn 화면에_글자가_떠야_키를_누른다() {
        assert!(!screen_ready(""));
        assert!(!screen_ready("   \n\n  "));
        assert!(screen_ready("☐ 과일\n사과와 배 중 뭘 고를래?\n› 1. 사과 — 사과를 고른다\n  2. 배 — 배를 고른다"));
    }
}

#[cfg(test)]
mod preview_tests {
    use super::{is_playing_line, is_supertonic_runner, preview_state, run_preview, speak_preview_stop, Phase, SPEAK_TEST_LOCK};
    use std::time::Duration;

    fn sh(script: &str) -> Vec<String> {
        vec!["/bin/sh".to_string(), "-c".into(), script.into()]
    }
    fn wait_for(id: u64, want: Phase, ms: u64) -> bool {
        for _ in 0..(ms / 20) {
            let s = preview_state();
            if s.id == id && s.phase == want { return true; }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    // 2026-10-02 사용자 "목소리가 바로 안 나와서 준비할 때·재생 중일 때 표시" — Supertonic 은 wav 를 만든 뒤(준비) afplay 직전에 PLAYING 을 찍는다
    #[test]
    fn 준비하다가_playing_줄에서_재생_끝나면_done() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let h = std::thread::spawn(|| run_preview(sh("sleep 0.3; echo PLAYING; sleep 0.3"), 101, true));
        assert!(wait_for(101, Phase::Preparing, 200));
        assert!(wait_for(101, Phase::Playing, 1500));
        h.join().unwrap();
        assert_eq!(preview_state().phase, Phase::Done);
    }

    #[test]
    fn 만들기_단계가_없는_명령은_바로_재생_중() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let h = std::thread::spawn(|| run_preview(sh("sleep 0.4"), 102, false));
        assert!(wait_for(102, Phase::Playing, 300));
        h.join().unwrap();
        assert_eq!(preview_state().phase, Phase::Done);
    }

    #[test]
    fn 새_들어보기가_오면_앞_소리는_멈추고_마지막_것만() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let a = std::thread::spawn(|| run_preview(sh("echo PLAYING; sleep 30"), 103, true));
        assert!(wait_for(103, Phase::Playing, 1500));
        let t = std::time::Instant::now();
        let b = std::thread::spawn(|| run_preview(sh("echo PLAYING; sleep 0.2"), 104, true));
        a.join().unwrap();
        assert!(t.elapsed() < Duration::from_secs(3), "앞 소리가 멈춰야 한다");
        b.join().unwrap();
        let s = preview_state();
        assert_eq!((s.id, s.phase), (104, Phase::Done));
    }

    #[test]
    fn 멈춤을_누르면_stopped() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let h = std::thread::spawn(|| run_preview(sh("echo PLAYING; sleep 30"), 105, true));
        assert!(wait_for(105, Phase::Playing, 1500));
        speak_preview_stop(105);
        h.join().unwrap();
        assert_eq!(preview_state().phase, Phase::Stopped);
    }

    #[test]
    fn playing_줄은_그_한_단어만() {
        assert!(is_playing_line("PLAYING"));
        assert!(is_playing_line(" PLAYING\r\n"));
        assert!(is_playing_line("PLAYING /tmp/x.wav"), "wav 경로를 달고 와도 재생(2026-10-03 빛)");
        assert!(!is_playing_line("PLAYINGX"));
        assert!(!is_playing_line("loading model"));
    }

    #[test]
    fn supertonic_실행기만_준비_단계가_있다() {
        assert!(is_supertonic_runner("/Users/a/.honor-orchestrator/tts/supertonic/speak"));
        assert!(is_supertonic_runner("C:\\Users\\a\\.chammo\\tts\\supertonic\\speak.cmd"));
        assert!(!is_supertonic_runner("say"));
        assert!(!is_supertonic_runner("/Users/a/bin/local-say"));
    }
}

#[cfg(test)]
mod glow_tests {
    use super::{parse_playing, run_speech, speak_gen, speak_now, stop_speaking, wav_envelope, SayPhase, SPEAK_TEST_LOCK};
    use std::time::Duration;

    fn sh(script: &str) -> Vec<String> {
        vec!["/bin/sh".to_string(), "-c".into(), script.into()]
    }
    /// 16bit 모노 wav — 구간마다 크기(0~1) 사인파
    fn wav(rate: u32, parts: &[(f32, f32)]) -> Vec<u8> {
        let mut pcm: Vec<u8> = vec![];
        for &(secs, amp) in parts {
            for i in 0..(rate as f32 * secs) as usize {
                let v = (amp * (i as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 32767.0) as i16;
                pcm.extend_from_slice(&v.to_le_bytes());
            }
        }
        let mut b = b"RIFF".to_vec();
        b.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
        b.extend_from_slice(b"WAVEfmt ");
        b.extend_from_slice(&16u32.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes()); // PCM
        b.extend_from_slice(&1u16.to_le_bytes()); // 모노
        b.extend_from_slice(&rate.to_le_bytes());
        b.extend_from_slice(&(rate * 2).to_le_bytes());
        b.extend_from_slice(&2u16.to_le_bytes());
        b.extend_from_slice(&16u16.to_le_bytes());
        b.extend_from_slice(b"data");
        b.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
        b.extend(pcm);
        b
    }
    fn wait_phase(want: SayPhase, ms: u64) -> bool {
        for _ in 0..(ms / 10) {
            if speak_now(0).phase == want { return true; }
            std::thread::sleep(Duration::from_millis(10));
        }
        false
    }

    // 2026-10-03 사용자 "소리 크기에 따라 글로우가 움직이면" — wav 에서 25ms 마다 크기(RMS)를 뽑는다
    #[test]
    fn wav_에서_25ms_마다_크기_곡선() {
        let w = wav(24_000, &[(0.1, 0.0), (0.1, 0.8), (0.1, 0.4)]);
        let e = wav_envelope(&w, 25).expect("곡선");
        assert_eq!(e.len(), 12);
        assert!(e[..4].iter().all(|&v| v == 0), "조용한 앞부분은 0: {e:?}");
        assert!(e[4..8].iter().all(|&v| v >= 240), "가장 큰 구간이 꽉 참: {e:?}");
        assert!(e[8..].iter().all(|&v| (110..=145).contains(&v)), "절반 크기면 절반쯤: {e:?}");
    }

    #[test]
    fn wav_가_아니거나_16bit_가_아니면_곡선_없음() {
        assert!(wav_envelope(b"not a wav", 25).is_none());
        let mut w = wav(24_000, &[(0.05, 0.5)]);
        w[34] = 8; // 8bit 라고 속이면
        assert!(wav_envelope(&w, 25).is_none());
    }

    #[test]
    fn playing_줄은_파일_경로를_달고_올_수_있다() {
        assert_eq!(parse_playing("PLAYING"), Some(None));
        assert_eq!(parse_playing("PLAYING /tmp/a b.wav\n"), Some(Some("/tmp/a b.wav".to_string())));
        assert_eq!(parse_playing("PLAYINGX"), None);
        assert_eq!(parse_playing("loading"), None);
    }

    #[test]
    fn 누가_말하는지와_곡선이_재생_시작에_실린다() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let p = std::env::temp_dir().join(format!("chammo-glow-{}.wav", std::process::id()));
        std::fs::write(&p, wav(24_000, &[(0.2, 0.5)])).unwrap();
        // 실제처럼 …/tts/supertonic/speak 경로의 실행기 — 만들기(0.2초) 뒤 PLAYING <wav>
        let dir = std::env::temp_dir().join(format!("chammo-glow-{}/tts/supertonic", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let runner = dir.join("speak");
        std::fs::write(&runner, format!("#!/bin/sh\nsleep 0.2; echo \"PLAYING {}\"; sleep 0.4\n", p.display())).unwrap();
        crate::platform::make_executable(&runner);
        let argv = vec![runner.to_string_lossy().to_string()];
        let h = std::thread::spawn(move || run_speech(argv, speak_gen(), Some("f00d0002".into()), |_| {}));
        assert!(wait_phase(SayPhase::Waiting, 150), "만드는 동안은 기다림(빛 없음)");
        assert!(wait_phase(SayPhase::Playing, 1500));
        let s = speak_now(0);
        assert_eq!(s.from.as_deref(), Some("f00d0002"));
        assert_eq!(s.hop_ms, 25);
        assert_eq!(s.env.as_ref().map(Vec::len), Some(8));
        assert!(s.started_ms > 0);
        assert!(speak_now(s.id).env.is_none(), "이미 받은 번호면 곡선은 다시 안 보낸다");
        h.join().unwrap();
        assert_eq!(speak_now(0).phase, SayPhase::Done, "자연히 끝나면 끝");
        let _ = std::fs::remove_file(&p);
    }

    // 2026-10-10 사용자 QA "가끔 소리와 박자가 안 맞는다" — 실제 afplay(무음 wav)로 빛 시작 시각과 소리가 귀에 닿는 시각을 잰다.
    // 소리가 닿는 시각 = 따로 지켜본 장치가 돌기 시작한 때 + 장치가 알리는 출력 지연. 귀엔 안 들린다(무음)
    // CHAMMO_AUDIO_PROBE=1 cargo test 소리_닿는_시각_실측 -- --ignored --nocapture
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn 소리_닿는_시각_실측() {
        use super::now_ms;
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let p = std::env::temp_dir().join(format!("chammo-sync-{}.wav", std::process::id()));
        std::fs::write(&p, wav(44_100, &[(1.5, 0.0)])).unwrap();
        let dir = std::env::temp_dir().join(format!("chammo-sync-{}/tts/supertonic", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let runner = dir.join("speak");
        std::fs::write(&runner, format!("#!/bin/sh\necho \"PLAYING {0}\" && afplay \"{0}\"\n", p.display())).unwrap();
        crate::platform::make_executable(&runner);
        let mut done = 0;
        for i in 0..30 {
            if done == 8 { break; }
            let probe = crate::audio_out::probe().expect("CHAMMO_AUDIO_PROBE=1 로 돌려");
            for _ in 0..400 { if !crate::audio_out::running(probe.dev) { break; } std::thread::sleep(Duration::from_millis(50)); }
            let probe = crate::audio_out::probe().unwrap();
            if probe.was_running { println!("{i}: 장치가 다른 소리로 도는 중 — 건너뜀"); continue; }
            done += 1;
            let watch = std::thread::spawn(move || {
                for _ in 0..5000 { if crate::audio_out::running(probe.dev) { return Some(now_ms()); } std::thread::sleep(Duration::from_micros(500)); }
                None
            });
            let argv = vec![runner.to_string_lossy().to_string()];
            let h = std::thread::spawn(move || run_speech(argv, speak_gen(), Some("f00d0009".into()), |_| {}));
            assert!(wait_phase(SayPhase::Playing, 7000), "잠든 블루투스는 깨는 데 몇 초");
            h.join().unwrap();
            let fin = speak_now(0).started_ms;
            let io = watch.join().unwrap().expect("장치가 돌기 시작");
            let heard = io + probe.out_ms;
            let old = super::PLAYING_AT.load(std::sync::atomic::Ordering::SeqCst); // 고치기 전 빛 시작 = PLAYING 을 읽은 때
            println!("{{\"trial\":{i},\"outMs\":{},\"ioAfterPlayingMs\":{},\"beforeMs\":{},\"afterMs\":{}}}", probe.out_ms, io as i64 - old as i64, old as i64 - heard as i64, fin as i64 - heard as i64);
            std::thread::sleep(Duration::from_millis(if done % 4 == 0 { 30_000 } else { 2500 })); // 가끔 오래 쉬어 잠든 장치도 잰다
        }
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_dir_all(std::env::temp_dir().join(format!("chammo-sync-{}", std::process::id())));
    }

    #[test]
    fn 파일_없는_명령은_곧바로_재생_곡선_없음() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let h = std::thread::spawn(|| run_speech(sh("sleep 0.3"), speak_gen(), Some("f00d0003".into()), |_| {}));
        assert!(wait_phase(SayPhase::Playing, 200));
        assert!(speak_now(0).env.is_none(), "곡선이 없으면 화면이 숨쉬기 빛");
        h.join().unwrap();
    }

    // 사용자가 끊으면 그 순간 빛 0 — 프로세스가 죽기 전에 상태부터 멈춤, 늦게 끝난 프로세스가 '끝'으로 덮지 않는다
    #[test]
    fn 끊으면_프로세스보다_먼저_멈춤이고_그대로_남는다() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let h = std::thread::spawn(|| run_speech(sh("echo PLAYING; sleep 30"), speak_gen(), Some("f00d0001".into()), |_| {}));
        assert!(wait_phase(SayPhase::Playing, 1500));
        stop_speaking();
        assert_eq!(speak_now(0).phase, SayPhase::Stopped, "stop_speaking 이 돌아온 순간 이미 멈춤");
        h.join().unwrap();
        assert_eq!(speak_now(0).phase, SayPhase::Stopped);
    }
}

#[cfg(test)]
mod par_tests {
    use super::par_map;
    use std::time::{Duration, Instant};

    #[test]
    fn par_map_keeps_order_and_runs_side_by_side() {
        // 저장소 37곳 git log 를 줄 세우면 0.5초 — 여럿을 같이 돌리되 결과는 저장소 순서 그대로
        let items: Vec<u64> = (0..12).collect();
        let t = Instant::now();
        let out = par_map(&items, 6, |n| {
            std::thread::sleep(Duration::from_millis(60));
            n * 10
        });
        assert_eq!(out, (0..12).map(|n| n * 10).collect::<Vec<_>>());
        assert!(t.elapsed() < Duration::from_millis(400), "12개 × 60ms 를 6개씩 — 줄 세우면 720ms, 걸린 시간 {:?}", t.elapsed());
    }

    #[test]
    fn par_map_empty_and_one_worker() {
        assert!(par_map(&Vec::<u8>::new(), 4, |x| *x).is_empty());
        assert_eq!(par_map(&[1, 2, 3], 1, |x| x + 1), vec![2, 3, 4]);
    }
}
