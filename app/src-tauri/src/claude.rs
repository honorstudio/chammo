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
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let out = crate::platform::command(claude_bin())
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
    crate::platform::pid_alive(pid)
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
        let mut args: Vec<String> = vec!["--bg".into(), "--dangerously-skip-permissions".into(), "-n".into(), name];
        if let Some(w) = worktree.filter(|w| !w.trim().is_empty()) {
            args.push("-w".into());
            args.push(w.trim().to_string());
        }
        let out = crate::platform::command(claude_bin()).current_dir(&cwd).args(&args).output().map_err(|e| e.to_string())?;
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

/// 세션을 끄고 목록에서도 지운다(`claude stop` + `claude rm`) — 꺼진 참모가 "꺼진 세션"에 계속 남지 않게(2026-09-30 사용자).
/// 대화 기록 파일(~/.claude/projects)은 남는다
#[tauri::command]
pub async fn remove_session(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let _ = run(&["stop", &id]);
        run(&["rm", &id]).map(|s| s.trim().to_string())
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
        let home = crate::platform::home();
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

/// 채팅 보기(스페이스 모드)가 대화 기록을 이어 읽은 결과. next = 다음에 넘길 자리, reset = 처음부터 다시 그려야 함
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptChunk {
    pub text: String,
    pub next: u64,
    pub reset: bool,
}

/// 처음(또는 파일이 줄어 자리가 안 맞으면) 끝 1MB 부터 — 긴 대화 전체를 매번 그리지 않게
const CHAT_HEAD: u64 = 1024 * 1024;
/// 처음 읽을 때 적어도 이만큼 줄은 보이게, 창은 최대 이만큼까지 넓힌다
const CHAT_MIN_LINES: usize = 200;
const CHAT_MAX: u64 = 32 * 1024 * 1024;

/// from 부터 끝까지 읽되 마지막 줄바꿈까지만(쓰는 중인 줄은 다음에). 처음 읽을 땐 끝 1MB, 잘린 첫 줄은 버린다
pub fn read_chunk(path: &std::path::Path, from: Option<u64>) -> std::io::Result<TranscriptChunk> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    let reset = !matches!(from, Some(n) if n <= len);
    let mut window = CHAT_HEAD;
    let (start, buf) = loop {
        let start = if reset { len.saturating_sub(window) } else { from.unwrap_or(0) };
        f.seek(SeekFrom::Start(start))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)?;
        // 끝에 큰 줄(그림 읽은 도구 결과 등)이 있으면 줄 몇 개 안 남는다 — 줄이 충분할 때까지 넓힌다
        let lines = buf.iter().filter(|&&b| b == b'\n').count();
        if !reset || start == 0 || lines >= CHAT_MIN_LINES || window >= CHAT_MAX { break (start, buf) }
        window *= 4;
    };
    let end = buf.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
    let mut body = &buf[..end];
    if reset && start > 0 {
        let cut = body.iter().position(|&b| b == b'\n').map_or(body.len(), |i| i + 1);
        body = &body[cut..];
    }
    Ok(TranscriptChunk { text: String::from_utf8_lossy(body).into_owned(), next: start + end as u64, reset })
}

/// 채팅 보기용 대화 기록 이어 읽기. 파일이 없으면(아직 첫 지시 전) 빈 조각
#[tauri::command]
pub async fn read_transcript(session_id: String, from: Option<u64>) -> TranscriptChunk {
    tauri::async_runtime::spawn_blocking(move || {
        let empty = TranscriptChunk { text: String::new(), next: 0, reset: from.is_some() };
        let home = crate::platform::home();
        let Ok(rd) = std::fs::read_dir(format!("{home}/.claude/projects")) else { return empty };
        let Some(path) = rd.flatten().map(|e| e.path().join(format!("{session_id}.jsonl"))).find(|p| p.exists()) else { return empty };
        read_chunk(&path, from).unwrap_or(empty)
    })
    .await
    .unwrap_or(TranscriptChunk { text: String::new(), next: 0, reset: false })
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
        assert_eq!(c, TranscriptChunk { text: "{\"a\":1}\n{\"b\":2}\n".into(), next: 16, reset: true });
    }

    #[test]
    fn 이어_읽기는_새로_붙은_것만() {
        let p = file("next", b"{\"a\":1}\n{\"b\":2}\n");
        let c = read_chunk(&p, Some(8)).unwrap();
        assert_eq!(c, TranscriptChunk { text: "{\"b\":2}\n".into(), next: 16, reset: false });
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
    if crate::notify_mac::send(&title, &body, target.as_deref().unwrap_or("")) { // 윈도우는 토스트(notify_other)
        return;
    }
    let _ = target;
    #[cfg(target_os = "macos")] // 윈도우 알림은 아직 없다(notify_other)
    let _ = crate::platform::command("osascript")
        .args(["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", &title, &body])
        .spawn();
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
pub(crate) fn run_speech(argv: Vec<String>, gen: u64, mut started: impl FnMut(u32)) {
    let _turn = SPEAKING.lock().unwrap_or_else(|e| e.into_inner());
    if speak_gen() != gen || argv.is_empty() {
        return;
    }
    let Ok(mut child) = crate::platform::spawn_group(crate::platform::command(&argv[0]).args(&argv[1..])) else { return };
    *SPEAKING_PID.lock().unwrap_or_else(|e| e.into_inner()) = Some(child.id());
    started(child.id());
    let _ = child.wait();
    *SPEAKING_PID.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// 지금 말하는 것과 줄 선 것까지 멈춘다 — 음성 모드를 끌 때·앱을 끌 때
/// (2026-09-28 6,500자 음성이 8분째 돌았는데 멈출 방법이 없었다. 앱을 바꿔 넣어도 옛 앱이 띄운 음성은 계속 돌았다)
pub fn stop_speaking() {
    SPEAK_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if let Some(pid) = *SPEAKING_PID.lock().unwrap_or_else(|e| e.into_inner()) {
        crate::platform::stop_group(pid);
    }
}

#[tauri::command]
pub fn speak(text: String) {
    if text.trim().is_empty() {
        return;
    }
    log_out("speak", &text);
    let gen = speak_gen();
    std::thread::spawn(move || {
        let argv = crate::config::tts_argv(&crate::config::home(), &crate::config::current().tts_command, &text, |p| std::path::Path::new(p).is_file());
        run_speech(argv, gen, |_| {});
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
        let out = crate::platform::command(claude_bin())
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
    attach_do(id, |w| {
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

fn attach_type_segs(id: &str, segs: &[Vec<u8>]) -> Result<(), String> {
    use std::time::Duration;
    attach_do(id, |w| {
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

/// attach 를 붙여 화면을 읽고 write 로 키를 넣은 뒤 뗀다
fn attach_do(id: &str, write: impl FnOnce(&mut dyn std::io::Write) -> std::io::Result<()>) -> Result<String, String> {
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
        let _ = child.kill();
        close(master);
        return Err(crate::i18n::tr("세션 화면이 안 떴어", "The session screen didn't come up").into());
    }
    trace("write");
    let r = match slot.lock().unwrap().0.as_mut() {
        Some(w) => write(&mut **w).map_err(|e| e.to_string()),
        None => Err("no writer".into()),
    };
    trace("kill");
    let _ = child.kill();
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
        let h = std::thread::spawn(move || { run_speech(argv, super::speak_gen(), |pid| { let _ = tx.send(pid); }); });
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
        run_speech(vec!["/usr/bin/true".into()], queued, |_| started = true);
        assert!(!started);
    }
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
