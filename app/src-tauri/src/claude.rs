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

/// claude 하위 명령의 시간 제한 — 띄우기·되살리기는 daemon 을 새로 띄우며 수십 초 걸리기도 한다. 넘으면 그룹째 끊는다.
/// 예전엔 .output() 이라 daemon 손자가 출력 파이프를 쥐거나 daemon 이 답을 안 하면 영영 안 돌아와 참모 되살리기 고리가 멈췄다(2026-10-21 리뷰 ①-4)
const CLAUDE_LIMIT: std::time::Duration = std::time::Duration::from_secs(90);

/// claude(또는 시험의 가짜)를 시간 제한 안에서 — 끝난 뒤 손자가 파이프를 쥐어도 2초 뒤 받은 데까지 돌려준다(run_capped)
fn claude_out(cmd: &mut std::process::Command, limit: std::time::Duration) -> Result<std::process::Output, String> {
    crate::platform::run_capped(cmd, limit).map_err(|e| {
        if e.kind() == std::io::ErrorKind::TimedOut {
            format!("claude did not answer within {}s — stopped it", limit.as_secs_f32().round())
        } else {
            e.to_string()
        }
    })
}

fn run(args: &[&str]) -> Result<String, String> {
    let out = claude_out(crate::platform::command(claude_bin()).args(args), CLAUDE_LIMIT)?;
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
    /// 켤 때 끊긴 winget 업그레이드의 claude.exe.old-* 를 되살렸으면 그 이름 — 화면 띠로 알린다
    pub claude_restored: Option<String>,
    /// 다마고치 CI 배틀용 GitHub 아이디(설정)
    pub github_user: String,
    /// 내 커밋을 가리는 작성자 이메일(`git config --global user.email`)
    pub git_email: String,
    /// 기록이 쌓이는 데이터 폴더(~/.chammo 등)
    pub data_dir: String,
}

/// 메인 스레드 밖에서 — async 가 아닌 명령은 메인 스레드에서 돌아, 켤 때·설정 닫을 때마다 claude --version·git·(윈도우) claude.exe 되살리기
/// 복사 동안 창이 굳었다(2026-10-21 리뷰)
#[tauri::command]
pub async fn app_env() -> Result<AppEnv, String> {
    tauri::async_runtime::spawn_blocking(app_env_now).await.map_err(|e| e.to_string())
}

fn app_env_now() -> AppEnv {
    let home = crate::config::home();
    let c = crate::config::current();
    AppEnv {
        // CHAMMO_HQ(옛 HONOR_ORCH_CWD): dev 앱을 검증할 때 진짜 비서와 안 섞이게 비서 폴더를 바꾼다
        orchestrator_cwd: crate::config::hq_dir(&home, &c, |k| std::env::var(k).ok()),
        dev_root: crate::config::expand(&home, &c.dev_root),
        extra_projects: c.extra_projects.iter().map(|p| crate::config::expand(&home, p).trim_end_matches('/').to_string()).collect(),
        // 되살리기가 claude 찾기보다 먼저(필드 순서대로 돈다)
        claude_restored: crate::claude_src::heal(),
        claude_bin: claude_bin(),
        claude_version: run(&["--version"]).unwrap_or_default().trim().to_string(),
        github_user: c.github_user,
        git_email: git(std::path::Path::new(&home), &["config", "--global", "user.email"]),
        data_dir: crate::config::data_dir().to_string_lossy().into_owned(),
        home,
    }
}

/// 같은 목록을 같이 쓰는 시간 — 데스크톱(3초 폴링)은 늘 새로 받고, 그사이 폰·메신저가 물으면 그 결과를 같이 쓴다
pub const AGENTS_TTL: std::time::Duration = std::time::Duration::from_millis(2500);
static AGENTS: std::sync::Mutex<Option<(std::time::Instant, String)>> = std::sync::Mutex::new(None);

/// cell 에 ttl 안의 결과가 있으면 그것, 아니면 fetch(잠근 채 — 동시에 물은 쪽은 기다렸다 같은 결과를 받는다). 실패는 안 담는다.
/// 시각은 묻기 시작한 때로 적는다
pub fn shared_fetch(cell: &std::sync::Mutex<Option<(std::time::Instant, String)>>, ttl: std::time::Duration, now: std::time::Instant, fetch: impl FnOnce() -> Result<String, String>) -> Result<String, String> {
    let mut c = cell.lock().map_err(|e| e.to_string())?;
    if let Some((at, v)) = c.as_ref() {
        if now.saturating_duration_since(*at) < ttl {
            return Ok(v.clone());
        }
    }
    let v = fetch()?;
    *c = Some((now, v.clone()));
    Ok(v)
}

/// `claude agents --json` — 데스크톱·폰·메신저가 같이 쓴다(분당 20개 띄우던 것, 2026-10-11 perf 5번). 멈추면 10초 뒤 죽인다.
/// 띄움·끔·되살림 직후의 확인(still_listed 등)은 이걸 안 쓰고 새로 묻는다
pub fn agents_json() -> Result<String, String> {
    shared_fetch(&AGENTS, AGENTS_TTL, std::time::Instant::now(), || {
        let out = crate::platform::run_capped(crate::platform::command(claude_bin()).args(["agents", "--json"]), std::time::Duration::from_secs(10)).map_err(|e| e.to_string())?;
        if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).into_owned()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
    })
}

/// 세션 목록이 바뀌는 일(띄움·끔·지움·되살림) 뒤 — 같이 쓰던 목록을 버린다
pub fn forget_agents() {
    if let Ok(mut c) = AGENTS.lock() {
        *c = None;
    }
}

/// `claude agents --json` 원문 그대로. 파싱은 프론트 domain/session.ts — 테스트가 거기 있다
#[tauri::command]
pub async fn list_sessions(fresh: Option<bool>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // fresh = 누른 뒤 확인(자동 허용) — 같이 쓰던 목록은 누르기 전 모습일 수 있다
        if fresh == Some(true) {
            forget_agents();
        }
        agents_json()
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
    let out = claude_out(crate::platform::command(claude_bin()).current_dir(cwd).args(spawn_args(name, prompt)), CLAUDE_LIMIT)?;
    forget_agents();
    if !out.status.success() {
        return Err(crate::access::explain_spawn_error(String::from_utf8_lossy(&out.stderr).trim(), cwd));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// 띄우기 인자 — 첫 지시는 `--` 뒤에: '-' 로 시작하는 지시("--help", "- 로그인 고쳐")를 claude 가 옵션으로 읽었다(①-13, 2.1.306 은 `--` 뒤를 지시로 받음 실측)
fn spawn_args(name: &str, prompt: &str) -> Vec<String> {
    ["--bg", "--dangerously-skip-permissions", "-n", name, "--", prompt].iter().map(|a| a.to_string()).collect()
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
        if pid <= 0 {
            return Err(format!("bad pid {pid}"));
        }
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
        let out = claude_out(crate::platform::command(claude_bin()).current_dir(&cwd).args(["--bg", "--dangerously-skip-permissions", "-n", &name, "--resume", &session_id]), CLAUDE_LIMIT)?;
        forget_agents(); // 넘겨받은 세션이 다음 목록에 바로 보이게
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
        let out = claude_out(crate::platform::command(claude_bin()).current_dir(&cwd).args(&args), CLAUDE_LIMIT)?;
        forget_agents(); // 새 세션이 바로 다음 목록에 — 2.5초 같이 쓰던 목록이면 띄움 자리표시가 사라진 뒤 3초쯤 비었다
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

/// 앱이 끈·지운 세션과 그때 — 참모 되살리기(프론트 domain/orchRevive)가 사람이 끈 참모를 다시 켜지 않게(2026-10-21)
static APP_STOPS: std::sync::Mutex<Vec<(String, std::time::Instant)>> = std::sync::Mutex::new(Vec::new());
const STOP_KEEP: std::time::Duration = std::time::Duration::from_secs(600);

/// keep 안의 것만 남기고 그 번호들
fn recent_stops(list: &mut Vec<(String, std::time::Instant)>, now: std::time::Instant, keep: std::time::Duration) -> Vec<String> {
    list.retain(|(_, at)| now.saturating_duration_since(*at) < keep);
    list.iter().map(|(id, _)| id.clone()).collect()
}

fn note_app_stop(id: &str) {
    let mut g = APP_STOPS.lock().unwrap_or_else(|e| e.into_inner());
    recent_stops(&mut g, std::time::Instant::now(), STOP_KEEP);
    g.push((id.to_string(), std::time::Instant::now()));
}

/// 앱이 그 세션을 다시 깨웠다(respawn, 번호 그대로) — 끈 기록에서 지운다. 안 지우면 깨운 뒤 10분 안에 남의 respawn 으로 attach 가 끝날 때
/// TerminalPane 다시 붙기·참모 되살리기가 '앱이 껐다'로 보고 포기했다(0.3.6 리뷰)
pub fn revived(id: Option<&str>) {
    let Some(id) = id else { return };
    APP_STOPS.lock().unwrap_or_else(|e| e.into_inner()).retain(|(i, _)| i != id);
}

/// 최근 10분 안에 앱(버튼·메뉴·폰·종료 창)이 끄거나 지운 세션 번호
#[tauri::command]
pub fn app_stopped_recently() -> Vec<String> {
    recent_stops(&mut APP_STOPS.lock().unwrap_or_else(|e| e.into_inner()), std::time::Instant::now(), STOP_KEEP)
}

/// daemon.log 글 → keep 안에 `claude stop` 으로 꺼진 세션 번호(마지막 소식이 `settled <id> (killed)`).
/// 앱 밖(터미널·스크립트)에서 끈 참모도 되살리기가 '사람이 끈 것'으로 보게(#6). 앱이 끈 것도 같은 줄이 남는다(stop_blocking 도 claude stop).
/// 데몬이 '응답 없음'으로 죽였다 켜면 바로 claimed-spare 가 붙고, 오래 놀아서 정리(retire)한 것은 끈 게 아니다 — 둘 다 뺀다
pub(crate) fn parse_daemon_stops(text: &str, now_ms: i64, keep_ms: i64) -> Vec<String> {
    let mut last: std::collections::BTreeMap<&str, Option<i64>> = std::collections::BTreeMap::new();
    let mut retired: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
    for line in text.lines() {
        let Some((ts, rest)) = line.strip_prefix('[').and_then(|l| l.split_once("] [bg] bg ")) else { continue };
        let Some((what, rest)) = rest.split_once(' ') else { continue };
        let id = rest.get(..8).unwrap_or("");
        if !id.chars().all(|c| c.is_ascii_hexdigit()) || id.len() != 8 || !matches!(rest.as_bytes().get(8), Some(b' ' | b':')) {
            continue;
        }
        match what {
            "settled" if rest[8..].starts_with(" (killed)") && !retired.contains(id) => {
                let Some(at) = crate::accounts_usage::iso_ms(ts) else { continue };
                last.insert(id, Some(at));
            }
            "settled" | "claimed-spare" | "spawned" => {
                last.insert(id, None);
                retired.remove(id);
            }
            "retire" => {
                retired.insert(id);
                last.insert(id, None);
            }
            _ => {}
        }
    }
    last.into_iter().filter_map(|(id, at)| at.filter(|at| now_ms - at < keep_ms).map(|_| id.to_string())).collect()
}

/// 최근 10분 안에 `claude stop` 으로 꺼진 세션 번호 — ~/.claude/daemon.log 끝 256KB 만 읽는다. 못 읽으면 빈 목록(예전처럼)
#[tauri::command]
pub fn daemon_stopped_recently() -> Vec<String> {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(std::path::Path::new(&crate::platform::home()).join(".claude").join("daemon.log")) else { return vec![] };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let from = len.saturating_sub(256 * 1024);
    let mut buf = Vec::new();
    if f.seek(SeekFrom::Start(from)).is_err() || f.read_to_end(&mut buf).is_err() {
        return vec![];
    }
    let text = String::from_utf8_lossy(&buf);
    // 중간부터 읽었으면 잘린 첫 줄은 버린다
    let text = if from > 0 { text.split_once('\n').map_or("", |(_, t)| t) } else { &text };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    parse_daemon_stops(text, now, STOP_KEEP.as_millis() as i64)
}

/// stop_session 의 몸통 — 폰 서버(참모 재우기)도 같은 길로
pub fn stop_blocking(id: &str, why: &str) -> Result<String, String> {
    log_action("stop", id, why);
    note_app_stop(id);
    let r = run(&["stop", id]).map(|s| s.trim().to_string());
    if r.is_err() {
        revived(Some(id)); // 못 껐다 — '앱이 끔' 기록이 남으면 살아 있는 세션을 10분 동안 꺼진 것처럼 다뤘다(2026-10-21 리뷰). 시도는 actions.log 에 남는다
    }
    forget_agents();
    r
}

/// remove_session 의 몸통 — 폰 서버(참모 제거)도 같은 길로. 꺼진 세션이면 stop 은 실패해도 넘어간다
pub fn remove_blocking(id: &str, why: &str) -> Result<String, String> {
    log_action("rm", id, why);
    note_app_stop(id);
    let _ = run(&["stop", id]);
    let r = run(&["rm", id]).map(|s| s.trim().to_string());
    forget_agents();
    r
}

/// 세션을 끄고 목록에서도 지운다(`claude stop` + `claude rm`) — 꺼진 참모가 "꺼진 세션"에 계속 남지 않게(2026-09-30 사용자).
/// 대화 기록 파일(~/.claude/projects)은 남는다
#[tauri::command]
pub async fn remove_session(id: String, why: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || remove_blocking(&id, why.as_deref().unwrap_or("app")))
        .await
        .map_err(|e| e.to_string())?
}

/// 참모가 `scripts/task` 로 쌓는 작업 기록. 없으면 빈 문자열(폰 옛 길이 꼬리를 자를 때)
pub fn read_tasks() -> String {
    std::fs::read_to_string(crate::config::data_file("tasks.jsonl")).unwrap_or_default()
}

/// 작업 기록 이어 읽기 결과. id = 파일 신원(갈아 끼웠는지 알아보는 표) — 다음에 그대로 돌려준다
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TasksChunk {
    pub text: String,
    pub next: u64,
    pub reset: bool,
    pub id: String,
}

#[cfg(unix)]
fn file_id(m: &std::fs::Metadata) -> String {
    use std::os::unix::fs::MetadataExt;
    format!("{}:{}", m.dev(), m.ino())
}
#[cfg(not(unix))]
fn file_id(_: &std::fs::Metadata) -> String {
    String::new()
}

/// from 뒤에 붙은 온전한 줄만(쓰는 중인 끝 줄은 다음에). 처음(from 없음)·파일이 줄었음·자리가 줄 처음이 아님·다른 파일로 바뀜이면
/// 처음부터 통째로(reset). 기록은 append-only 라 보통은 늘어난 몇 줄만 읽는다 — 3초마다 686KB 통째 읽던 것(2026-10-11 perf 4번)
pub fn tasks_since(path: &std::path::Path, from: Option<u64>, id: Option<&str>) -> TasksChunk {
    use std::io::{Read, Seek, SeekFrom};
    let empty = TasksChunk { text: String::new(), next: 0, reset: true, id: String::new() };
    let Ok(mut f) = std::fs::File::open(path) else { return empty };
    let Ok(meta) = f.metadata() else { return empty };
    let (len, fid) = (meta.len(), file_id(&meta));
    let at_line_start = |f: &mut std::fs::File, n: u64| -> bool {
        if n == 0 { return true }
        let mut b = [0u8; 1];
        f.seek(SeekFrom::Start(n - 1)).is_ok() && f.read_exact(&mut b).is_ok() && b[0] == b'\n'
    };
    let ok = from.filter(|&n| n <= len && id == Some(fid.as_str()) && at_line_start(&mut f, n));
    let start = ok.unwrap_or(0);
    let mut buf = Vec::new();
    if f.seek(SeekFrom::Start(start)).is_err() || f.read_to_end(&mut buf).is_err() {
        return empty;
    }
    let end = buf.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
    buf.truncate(end);
    TasksChunk { text: String::from_utf8_lossy(&buf).into_owned(), next: start + end as u64, reset: ok.is_none(), id: fid }
}

/// 데스크톱 작업 기록 — 지난번 next·id 를 넘기면 늘어난 줄만. 파싱·이어 붙이기는 프론트 domain/tasks.ts makeTaskLog
#[tauri::command]
pub async fn read_tasks_since(from: Option<u64>, id: Option<String>) -> TasksChunk {
    tauri::async_runtime::spawn_blocking(move || tasks_since(&crate::config::data_file("tasks.jsonl"), from, id.as_deref()))
        .await
        .unwrap_or(TasksChunk { text: String::new(), next: 0, reset: true, id: String::new() })
}

/// 세션 대화 기록의 꼬리(마지막 256KB, tail 을 주면 그만큼 — 16MB 까지). 기록은 `~/.claude/projects/<폴더>/<sessionId>.jsonl`.
/// 파싱은 프론트 domain/activity.ts. 없는 세션은 결과에서 빠진다. 길게는 음성이 턴을 깨운 말을 못 찾을 때만(DEEP_TAIL, 10-28)
#[tauri::command]
pub async fn read_transcript_tails(session_ids: Vec<String>, tail: Option<u64>) -> std::collections::HashMap<String, String> {
    let tail = tail_len(tail);
    tauri::async_runtime::spawn_blocking(move || transcript_tails(&session_ids, tail)).await.unwrap_or_default()
}

/// 꼬리 길이 — 없거나 0 이면 256KB, 16MB 넘게는 안 읽는다(10초마다 도는 길이라 실수로 큰 값을 줘도 버티게)
pub(crate) fn tail_len(tail: Option<u64>) -> u64 {
    tail.filter(|&t| t > 0).unwrap_or(256 * 1024).min(16 * 1024 * 1024)
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
/// 폰 참모 줄 살짝 보기(마지막 말·물음 판단) — 끝 32KB 부터 줄 8개까지, 512KB 까지만. 참모마다 PHONE_HEAD(256KB~2MB)를 받아
/// 느린 셀룰러 첫 화면이 7MB 였다(2026-10-27)
pub const PEEK_HEAD: u64 = 32 * 1024;
pub const PEEK_MIN_LINES: usize = 8;
pub const PEEK_MAX: u64 = 512 * 1024;

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
    tauri::async_runtime::spawn_blocking(move || chunk_or_keep(transcript_path(&session_id).as_deref(), from))
        .await
        .unwrap_or_else(|_| keep_at(from))
}

/// 못 읽었으면 그 자리 그대로(바뀐 것 없음) — 전엔 next 0 을 줘서, 다음 차례가 from 0 으로 상한 없이 기록 전체(참모 기록은 170MB)를
/// 읽었고 JoinError 길은 지금 목록 위에 그 전체를 이어 붙여 말풍선이 다 두 번 보였다(2026-10-21 리뷰). 처음(from 없음)이면 빈 조각
fn chunk_or_keep(path: Option<&std::path::Path>, from: Option<u64>) -> TranscriptChunk {
    match path {
        Some(p) => read_chunk(p, from).unwrap_or_else(|_| keep_at(from)),
        None => keep_at(from), // 아직 첫 지시 전(파일 없음) — 나중에 생기면 그 자리부터
    }
}

fn keep_at(from: Option<u64>) -> TranscriptChunk {
    let at = from.unwrap_or(0);
    TranscriptChunk { text: String::new(), next: at, reset: false, start: at }
}

/// 그 대화의 기록 파일(~/.claude/projects/<폴더>/<sessionId>.jsonl)
pub(crate) fn transcript_path(session_id: &str) -> Option<std::path::PathBuf> {
    static FOUND: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, std::path::PathBuf>>> = std::sync::LazyLock::new(Default::default);
    transcript_in(std::path::Path::new(&format!("{}/.claude/projects", crate::platform::home())), session_id, &FOUND)
}

/// 찾은 자리는 기억한다 — 채팅이 일하는 동안 0.25초마다 읽는데 매번 폴더 수백 개를 뒤졌다(718개 ~3ms, 2026-10-28). 기억한 자리에 없으면 다시 찾는다
pub(crate) fn transcript_in(base: &std::path::Path, session_id: &str, found: &std::sync::Mutex<std::collections::HashMap<String, std::path::PathBuf>>) -> Option<std::path::PathBuf> {
    if let Some(p) = found.lock().unwrap_or_else(|e| e.into_inner()).get(session_id).filter(|p| p.exists()) {
        return Some(p.clone());
    }
    let p = std::fs::read_dir(base).ok()?.flatten().map(|e| e.path().join(format!("{session_id}.jsonl"))).find(|p| p.exists());
    let mut map = found.lock().unwrap_or_else(|e| e.into_inner());
    match &p {
        Some(p) => _ = map.insert(session_id.to_string(), p.clone()),
        None => _ = map.remove(session_id),
    }
    p
}

/// 폰 대화 이어 읽기 — 처음은 가볍게(PHONE_*)
pub fn read_transcript_phone(session_id: &str, from: Option<u64>) -> TranscriptChunk {
    // 못 읽으면 그 자리 그대로 — 데스크톱(chunk_or_keep)과 같게. next 0 을 주면 다음 차례가 기록 전체를 읽고 말풍선이 두 번 붙었다(코드 리뷰)
    match transcript_path(session_id) {
        Some(p) => read_chunk_with(&p, from, PHONE_HEAD, PHONE_MIN_LINES, PHONE_MAX).unwrap_or_else(|_| keep_at(from)),
        None => keep_at(from),
    }
}

/// 폰 참모 줄 살짝 보기 — 처음만 작은 꼬리, 그 뒤는 늘어난 줄만(read_transcript_phone 과 같은 이어 읽기)
pub fn read_transcript_peek(session_id: &str, from: Option<u64>) -> TranscriptChunk {
    match transcript_path(session_id) {
        Some(p) => read_chunk_with(&p, from, PEEK_HEAD, PEEK_MIN_LINES, PEEK_MAX).unwrap_or_else(|_| keep_at(from)),
        None => keep_at(from),
    }
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
mod stop_memo_tests {
    /// daemon.log 실측 줄 모양(2.1.312, 2026-10-28) — 끄기는 `settled <id> (killed)`, 그 밖 꺼짐은 done·crashed·failed
    const LOG: &str = "[2026-10-28T15:00:00.000Z] [bg] bg claimed-spare aaaaaaaa (shell)
[2026-10-28T15:00:01.000Z] [bg] bg claimed-spare bbbbbbbb (shell)
[2026-10-28T15:00:02.000Z] [bg] bg claimed-spare cccccccc (shell)
[2026-10-28T15:00:03.000Z] [bg] bg claimed-spare dddddddd (shell)
[2026-10-28T15:01:00.000Z] [bg] bg settled aaaaaaaa (killed)
[2026-10-28T15:01:00.000Z] [bg] bg settled bbbbbbbb (crashed): SIGKILL (137) before init
[2026-10-28T15:01:00.000Z] [bg] bg settled cccccccc (killed)
[2026-10-28T15:01:00.080Z] [bg] bg claimed-spare cccccccc (respawn)
[2026-10-28T15:01:01.000Z] [bg] bg retire dddddddd: idle-prompt, idle 8h
[2026-10-28T15:01:01.200Z] [bg] bg settled dddddddd (killed)
";
    fn at(iso: &str) -> i64 {
        crate::accounts_usage::iso_ms(iso).unwrap()
    }
    #[test]
    fn claude_stop_으로_끈_세션만_고른다() {
        let now = at("2026-10-28T15:02:00Z");
        // a: 끔 / b: 죽음(crashed) / c: 데몬이 '응답 없음'으로 죽였다 바로 다시 켬 / d: 데몬이 오래 놀아서 정리(retire)
        assert_eq!(super::parse_daemon_stops(LOG, now, 600_000), vec!["aaaaaaaa"]);
    }
    #[test]
    fn 끈_뒤_다시_켜진_세션은_빠진다() {
        let log = format!("{LOG}[2026-10-28T15:01:30.000Z] [bg] bg claimed-spare aaaaaaaa (respawn)\n");
        assert!(super::parse_daemon_stops(&log, at("2026-10-28T15:02:00Z"), 600_000).is_empty());
        let log = format!("{LOG}[2026-10-28T15:01:30.000Z] [bg] bg spawned aaaaaaaa (fleet)\n");
        assert!(super::parse_daemon_stops(&log, at("2026-10-28T15:02:00Z"), 600_000).is_empty());
    }
    #[test]
    fn 끈_기록은_10분만_본다() {
        assert_eq!(super::parse_daemon_stops(LOG, at("2026-10-28T15:10:59Z"), 600_000), vec!["aaaaaaaa"]);
        assert!(super::parse_daemon_stops(LOG, at("2026-10-28T15:11:01Z"), 600_000).is_empty());
    }
    #[test]
    fn 깨진_줄과_모르는_모양은_넘어간다() {
        let log = "aed] [bg] bg settled aaaaaaaa (killed)\n[깨진 시각] [bg] bg settled bbbbbbbb (killed)\n[2026-10-28T15:01:00.000Z] [bg] bg settled 1234 (killed)\n[2026-10-28T15:01:00.000Z] [bg] bg settled zzzzzzzz (killed)\n[2026-10-28T15:01:00.000Z] [supervisor] settled eeeeeeee (killed)\n";
        assert!(super::parse_daemon_stops(log, at("2026-10-28T15:02:00Z"), 600_000).is_empty());
        assert!(super::parse_daemon_stops("", 0, 600_000).is_empty());
    }
    #[test]
    fn 앱이_끈_세션은_10분만_기억한다() {
        let t0 = std::time::Instant::now();
        let keep = std::time::Duration::from_secs(600);
        let mut list = vec![("aaaaaaaa".to_string(), t0), ("bbbbbbbb".to_string(), t0 + std::time::Duration::from_secs(300))];
        assert_eq!(super::recent_stops(&mut list, t0 + std::time::Duration::from_secs(60), keep), vec!["aaaaaaaa", "bbbbbbbb"]);
        assert_eq!(super::recent_stops(&mut list, t0 + std::time::Duration::from_secs(601), keep), vec!["bbbbbbbb"], "10분 지난 건 빠진다");
        assert_eq!(list.len(), 1, "지난 것은 목록에서도 지운다");
    }
    #[test]
    fn 앱이_다시_깨운_세션은_끈_기록에서_빠진다() {
        // 0.3.6 리뷰: 메뉴로 끄고 2분 뒤 홈에서 깨운 참모(respawn, 번호 그대로)가 10분 안에 남의 respawn 으로 attach 가 끝나면
        // TerminalPane 다시 붙기가 '앱이 껐다'로 보고 영영 포기했다 — 앱이 깨우면 그 번호는 끈 기록에서 지운다
        super::note_app_stop("cafe0001");
        super::note_app_stop("cafe0002");
        super::revived(Some("cafe0001"));
        let now = super::app_stopped_recently();
        assert!(!now.contains(&"cafe0001".to_string()), "깨운 세션은 빠진다: {now:?}");
        assert!(now.contains(&"cafe0002".to_string()), "다른 세션은 그대로");
        super::revived(None); // 번호 없는 옛 기록(이어 띄우기)은 할 게 없다
        super::revived(Some("cafe0002"));
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
mod launch_tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn claude_를_부르는_명령은_모두_시간_제한이_있다() {
        // 매달린 claude(daemon 손자가 출력 파이프를 쥠 등)에 .output() 은 영영 안 돌아와 참모 되살리기 고리가 멈췄다(2026-10-21 리뷰 ①-4)
        let src = include_str!("claude.rs");
        let src = &src[..src.find("#[cfg(test)]").unwrap()];
        for (i, _) in src.match_indices("command(claude_bin())") {
            let stmt = &src[i..i + src[i..].find(';').unwrap()];
            assert!(!stmt.contains(".output()"), "시간 제한 없는 claude 명령: {}", &stmt[..stmt.len().min(120)]);
        }
        let run_body = &src[src.find("fn run(args").unwrap()..];
        let run_body = &run_body[..run_body.find("\n}\n").unwrap()];
        assert!(run_body.contains("claude_out("), "run() 도 시간 제한 길로");
    }

    #[test]
    fn 손자가_출력을_쥐고_남아도_띄우기는_돌아온다() {
        let t0 = Instant::now();
        let mut c = crate::platform::command("/bin/sh");
        c.args(["-c", "sleep 30 & echo backgrounded"]);
        let out = claude_out(&mut c, Duration::from_secs(20)).unwrap();
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stdout).contains("backgrounded"));
        assert!(t0.elapsed() < Duration::from_secs(10), "{:?}", t0.elapsed());
    }

    #[test]
    fn 매달린_claude_는_시간_제한에서_끊고_까닭을_말한다() {
        let mut c = crate::platform::command("/bin/sh");
        c.args(["-c", "sleep 30"]);
        let e = claude_out(&mut c, Duration::from_millis(300)).unwrap_err();
        assert!(e.contains("claude"), "{e}");
    }

    #[test]
    fn 첫_지시는_옵션_끝_표시_뒤에_간다() {
        // '-' 로 시작하는 지시("--help", "- 로그인 고쳐")가 claude 옵션으로 읽혔다(①-13). 2.1.306 은 `--` 뒤 지시를 그대로 받는다(실측)
        let a = spawn_args("참모", "--help 해 줘");
        assert_eq!(&a[a.len() - 2..], ["--", "--help 해 줘"]);
        assert_eq!(&a[..4], ["--bg", "--dangerously-skip-permissions", "-n", "참모"]);
    }

    #[test]
    fn 같은_세션_되살리기는_한_번에_하나만() {
        // 홈 '깨우기'와 자동 되살리기가 같은 순간 들어와 둘 다 respawn — 두 번째가 막 켜진 세션을 다시 시작했다(①-14)
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        let inside = Arc::new(AtomicUsize::new(0));
        let most = Arc::new(AtomicUsize::new(0));
        let hs: Vec<_> = (0..4)
            .map(|i| {
                let (inside, most) = (inside.clone(), most.clone());
                std::thread::spawn(move || {
                    let keys = if i % 2 == 0 { ["sess-1", "abcd1234"] } else { ["", "abcd1234"] };
                    let _g = ReviveLock::take(&keys);
                    let n = inside.fetch_add(1, Ordering::SeqCst) + 1;
                    most.fetch_max(n, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(60));
                    inside.fetch_sub(1, Ordering::SeqCst);
                })
            })
            .collect();
        hs.into_iter().for_each(|h| h.join().unwrap());
        assert_eq!(most.load(Ordering::SeqCst), 1);
        // 다른 세션은 서로 안 기다린다
        let _a = ReviveLock::take(&["s-a", ""]);
        let t0 = Instant::now();
        let _b = ReviveLock::take(&["s-b", ""]);
        assert!(t0.elapsed() < Duration::from_millis(50));
    }

    #[test]
    fn 되살리기는_잠근_뒤_살아_있나를_다시_본다() {
        let src = include_str!("claude.rs");
        let body = &src[src.find("\nfn resume_with(").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        let (lock, live, inner) = (body.find("ReviveLock::take").unwrap(), body.find("live_now(").unwrap(), body.find("resume_inner(").unwrap());
        assert!(lock < live && live < inner, "잠금 → 살아 있나 → 되살리기 순서");
    }
}

#[cfg(test)]
mod agents_cache_tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn 여러_스레드가_같이_써도_줄이_섞이지_않는다() {
        let p = std::env::temp_dir().join(format!("append-line-{}.log", std::process::id()));
        let _ = std::fs::remove_file(&p);
        let hs: Vec<_> = (0..8).map(|t| { let p = p.clone(); std::thread::spawn(move || for i in 0..300 { append_line(&p, &format!("{i}\tkind{t}\t{}", "가".repeat(40))); }) }).collect();
        hs.into_iter().for_each(|h| h.join().unwrap());
        let body = std::fs::read_to_string(&p).unwrap();
        let lines: Vec<&str> = body.lines().collect();
        assert_eq!(lines.len(), 2400);
        assert!(lines.iter().all(|l| l.split('\t').count() == 3 && l.ends_with('가')), "섞인 줄이 있다");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn 세션을_띄우는_명령은_모두_같이_쓰던_목록을_버린다() {
        // 새 세션(⌘T·프로젝트 머리줄)·터미널 세션 넘겨받기가 안 버려서 띄움 자리표시가 사라진 뒤 새 세션이 최대 3초 늦게 떴다(2026-10-11 bug-hunt)
        let src = include_str!("claude.rs");
        let src = &src[..src.find("#[cfg(test)]").unwrap()];
        for chunk in src.split("pub async fn ").skip(1) {
            let body = &chunk[..chunk.find("\n}\n").unwrap_or(chunk.len())];
            if body.contains("\"--bg\"") {
                let name = body.split('(').next().unwrap();
                assert!(body.contains("forget_agents()"), "{name} 은 세션을 띄우는데 같이 쓰던 세션 목록을 안 버린다");
            }
        }
    }

    #[test]
    fn 짧은_사이에_또_물으면_같은_결과를_같이_쓴다() {
        // 데스크톱 3초·폰 3초·메신저가 각자 claude agents 를 띄우던 것(분당 20개, 2026-10-11 perf 5번)
        let cell = std::sync::Mutex::new(None);
        let runs = std::cell::Cell::new(0);
        let t0 = Instant::now();
        let fetch = |v: &str| { runs.set(runs.get() + 1); Ok::<String, String>(v.to_string()) };
        assert_eq!(shared_fetch(&cell, AGENTS_TTL, t0, || fetch("a")), Ok("a".into()));
        assert_eq!(shared_fetch(&cell, AGENTS_TTL, t0 + Duration::from_millis(2000), || fetch("b")), Ok("a".into()));
        assert_eq!(runs.get(), 1);
        // 2.5초가 지나면 새로 — 데스크톱 3초 폴링은 늘 새로 받는다(신선도 그대로)
        assert_eq!(shared_fetch(&cell, AGENTS_TTL, t0 + Duration::from_millis(2600), || fetch("c")), Ok("c".into()));
        assert_eq!(runs.get(), 2);
    }

    #[test]
    fn 실패는_담지_않고_비우면_바로_새로_묻는다() {
        let cell = std::sync::Mutex::new(None);
        let t0 = Instant::now();
        assert!(shared_fetch(&cell, AGENTS_TTL, t0, || Err::<String, String>("x".into())).is_err());
        assert_eq!(shared_fetch(&cell, AGENTS_TTL, t0, || Ok::<String, String>("ok".into())), Ok("ok".into()));
        // 세션을 띄우거나 끈 뒤엔 비운다 — 옛 목록을 안 내게
        if let Ok(mut c) = cell.lock() { *c = None; }
        assert_eq!(shared_fetch(&cell, AGENTS_TTL, t0, || Ok::<String, String>("new".into())), Ok("new".into()));
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
    fn 참모_줄_살짝_보기는_더_가볍게() {
        // 마지막 말 한두 개만 보면 된다 — 줄이 고르면 32KB 안, 끝 줄이 크면 줄 몇 개가 될 때까지만 넓힌다(512KB 까지)
        let line = format!("{{\"x\":\"{}\"}}\n", "a".repeat(1000));
        let p = file("peek", line.repeat(3000).as_bytes());
        let c = read_chunk_with(&p, None, PEEK_HEAD, PEEK_MIN_LINES, PEEK_MAX).unwrap();
        assert!(c.text.len() as u64 <= PEEK_HEAD, "{}", c.text.len());
        assert!(c.text.lines().count() >= PEEK_MIN_LINES);
        let big = format!("{{\"y\":\"{}\"}}\n", "b".repeat(200_000));
        let p = file("peek-big", [line.repeat(50), big.repeat(3)].concat().as_bytes());
        let c = read_chunk_with(&p, None, PEEK_HEAD, PEEK_MIN_LINES, PEEK_MAX).unwrap();
        assert!(c.text.len() as u64 <= PEEK_MAX, "{}", c.text.len());
        assert!(c.text.len() as u64 > PEEK_HEAD);
    }

    #[test]
    fn 작업_기록은_처음엔_통째로_다음엔_늘어난_줄만() {
        let p = file("tasks-grow", b"{\"a\":1}\n{\"b\":2}\n");
        let c = tasks_since(&p, None, None);
        assert_eq!((c.text.as_str(), c.next, c.reset), ("{\"a\":1}\n{\"b\":2}\n", 16, true));
        assert!(!c.id.is_empty() || cfg!(not(unix)));
        // 안 바뀌었으면 빈 글
        let same = tasks_since(&p, Some(16), Some(&c.id));
        assert_eq!((same.text.as_str(), same.next, same.reset), ("", 16, false));
        // 붙은 줄만, 쓰는 중인 끝 줄은 다음에
        std::fs::OpenOptions::new().append(true).open(&p).unwrap().write_all(b"{\"c\":3}\n{\"d\":").unwrap();
        let more = tasks_since(&p, Some(16), Some(&c.id));
        assert_eq!((more.text.as_str(), more.next, more.reset), ("{\"c\":3}\n", 24, false));
        std::fs::OpenOptions::new().append(true).open(&p).unwrap().write_all(b"4}\n").unwrap();
        assert_eq!(tasks_since(&p, Some(24), Some(&c.id)).text, "{\"d\":4}\n");
    }

    #[test]
    fn 작업_기록이_줄었거나_바뀌었으면_처음부터() {
        let p = file("tasks-shrunk", b"{\"a\":1}\n");
        let c = tasks_since(&p, Some(999), None);
        assert_eq!((c.text.as_str(), c.reset), ("{\"a\":1}\n", true));
        // 자리가 줄 가운데면(같은 크기 이상으로 다시 쓴 파일) 처음부터
        let mid = tasks_since(&p, Some(3), Some(&c.id));
        assert_eq!((mid.text.as_str(), mid.next, mid.reset), ("{\"a\":1}\n", 8, true));
        // 다른 파일로 갈아 끼웠으면(이름 바꿔 덮기) 처음부터
        let q = file("tasks-swap", b"{\"x\":1}\n{\"y\":2}\n");
        std::fs::rename(&q, &p).unwrap();
        let sw = tasks_since(&p, Some(8), Some(&c.id));
        if cfg!(unix) {
            assert_eq!((sw.text.as_str(), sw.reset), ("{\"x\":1}\n{\"y\":2}\n", true));
        }
        // 파일이 없어졌으면 빈 글 + 다시 처음부터
        std::fs::remove_file(&p).unwrap();
        let gone = tasks_since(&p, Some(16), Some(&sw.id));
        assert_eq!((gone.text.as_str(), gone.next, gone.reset), ("", 0, true));
        assert_eq!(tasks_since(&p, None, None).text, "");
    }

    #[test]
    fn 기록이_상한을_넘으면_앞_절반을_줄_단위로_버린다() {
        let body: String = (0..100).map(|i| format!("{{\"n\":{i}}}\n")).collect();
        let p = file("cap", body.as_bytes());
        let size = body.len() as u64;
        cap_half(&p, size - 1);
        let left = std::fs::read_to_string(&p).unwrap();
        assert!((left.len() as u64) < size / 2 + 20, "{}", left.len());
        assert!(left.ends_with("{\"n\":99}\n"));
        assert!(left.lines().all(|l| l.starts_with("{\"n\":") && l.ends_with('}')));
        // 안 넘으면 그대로, 없으면 조용히
        cap_half(&p, size);
        assert_eq!(std::fs::read_to_string(&p).unwrap(), left);
        cap_half(&std::env::temp_dir().join("chammo-chat-test-none-xyz"), 1);
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
/// 1MB 를 넘으면 앞 절반을 버린다(예전엔 통째로 지웠다)
pub(crate) fn log_out(kind: &str, text: &str) {
    let path = crate::config::data_file("notify.log");
    cap_half(&path, 1_000_000);
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    append_line(&path, &format!("{ts}\t{kind}\t{text}"));
}

/// 한 줄을 한 번의 write 로 덧붙인다 — writeln! 은 조각마다 write 해서 여러 스레드가 같이 쓰면 줄이 섞였다
/// (notify.log 에 시각 두 개 붙은 줄·시각 없는 줄, 2026-10-04 실측). 줄 안 줄바꿈은 빈칸으로
pub(crate) fn append_line(path: &std::path::Path, line: &str) {
    use std::io::Write;
    let mut s = line.replace('\n', " ");
    s.push('\n');
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(s.as_bytes());
    }
}

/// CHAMMO_NO_OS_NOTIFY=1 — OS 알림·폰 푸시를 안 보낸다(기록만). 시험 앱용: 번들 밖 실행 파일은 osascript 로 떨어져
/// 사람 맥 알림 센터에 '스크립트 편집기' 아이콘으로 떴다(2026-10-21 첫 사용자 QA)
pub fn os_notify_off(v: Option<&str>) -> bool {
    v == Some("1")
}

/// macOS 알림. .app 으로 돌면 앱 이름·아이콘으로(notify_mac, 누르면 target 으로 이동),
/// `tauri dev` 맨 실행 파일이면 osascript 로 대신한다(글자는 argv 로 넘겨 따옴표 이스케이프 문제를 피한다)
#[tauri::command]
pub fn notify(title: String, body: String, target: Option<String>) {
    log_out("notify", &format!("{title} — {body}"));
    if os_notify_off(std::env::var("CHAMMO_NO_OS_NOTIFY").ok().as_deref()) {
        return;
    }
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
    use super::{os_notify_off, watched};

    #[test]
    fn 시험_앱은_스위치로_os_알림과_폰_푸시를_끈다() {
        // 2026-10-21 첫 사용자 QA: 번들 밖 시험 앱 알림이 osascript 로 떨어져 사용자 맥 알림 센터에 '스크립트 편집기' 아이콘으로 줄줄이 떴다
        assert!(os_notify_off(Some("1")));
        assert!(!os_notify_off(None));
        assert!(!os_notify_off(Some("0")));
        assert!(!os_notify_off(Some("")));
    }
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
pub(crate) fn run_speech(argv: Vec<String>, gen: u64, who: Option<String>, started: impl FnMut(u32)) {
    run_speech_in(argv, gen, who, started, &crate::config::data_file("phone-voice"))
}

/// 폰에서 틀 소리 파일을 두는 폴더를 받는 판(시험은 임시 폴더)
pub(crate) fn run_speech_in(argv: Vec<String>, gen: u64, who: Option<String>, mut started: impl FnMut(u32), phone_dir: &std::path::Path) {
    let _turn = SPEAKING.lock().unwrap_or_else(|e| e.into_inner());
    if speak_gen() != gen || argv.is_empty() {
        return;
    }
    // 폰이 앞에 떠 있으면(하트비트) 소리 파일만 만들어 폰으로 — 못 틀면 같은 파일을 맥에서(아래 PLAY 길)
    let mut play_file: Option<std::path::PathBuf> = None;
    if is_hold_runner(&argv[0]) && crate::phone_voice::watching_now() {
        match run_on_phone(&argv, gen, who.clone(), phone_dir) {
            Phoned::Done => return,
            Phoned::Local(f) => play_file = f,
        }
    }
    // Supertonic 은 wav 를 만든 뒤 PLAYING 을 찍고 튼다 — 그 전엔 '기다림'(빛 없음). 다른 명령은 곧바로 소리
    let prepared = is_supertonic_runner(&argv[0]);
    let id = say_begin(who, prepared);
    let mut cmd = crate::platform::command(&argv[0]);
    cmd.args(&argv[1..]).stdout(std::process::Stdio::piped());
    if let Some(f) = &play_file {
        cmd.env("CHAMMO_TTS_PLAY", f);
    }
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

/// 소리 파일만 만들 줄 아는(CHAMMO_TTS_HOLD·PLAY) 실행기 — 앱의 맥용 Supertonic 실행기만(윈도우 .cmd 는 아직)
pub(crate) fn is_hold_runner(prog: &str) -> bool {
    prog.replace('\\', "/").ends_with("/tts/supertonic/speak")
}

enum Phoned {
    /// 폰에서 틀었거나 멈춰서 끝 — 더 할 일 없다
    Done,
    /// 맥에서 튼다 — Some(파일) 이면 이미 만든 소리를 그대로, None 이면 평소처럼 처음부터
    Local(Option<std::path::PathBuf>),
}

/// 소리 파일만 만들고(실행기 HOLD 길) 폰에 내놓아 끝까지 기다린다. 폰이 못 틀면 파일을 돌려줘 맥이 튼다.
/// 빛(say_begin·say_playing)은 맥이 틀 때와 같게 — 폰이 시작했다고 알린 때부터
fn run_on_phone(argv: &[String], gen: u64, who: Option<String>, dir: &std::path::Path) -> Phoned {
    let id = say_begin(who.clone(), true);
    let _ = std::fs::create_dir_all(dir);
    sweep_old(dir);
    let wav = dir.join(format!("{id}.wav"));
    let mut cmd = crate::platform::command(&argv[0]);
    cmd.args(&argv[1..]).env("CHAMMO_TTS_HOLD", &wav).stdout(std::process::Stdio::null());
    let Ok(mut child) = crate::platform::spawn_group(&mut cmd) else { say_end(id); return Phoned::Local(None) };
    *SPEAKING_PID.lock().unwrap_or_else(|e| e.into_inner()) = Some(child.id());
    let made = child.wait().is_ok_and(|s| s.success());
    *SPEAKING_PID.lock().unwrap_or_else(|e| e.into_inner()) = None;
    let cleanup = |wav: &std::path::Path| {
        let _ = std::fs::remove_file(wav);
        say_end(id);
    };
    if speak_gen() != gen {
        cleanup(&wav);
        return Phoned::Done;
    }
    let bytes = if made { std::fs::read(&wav).ok() } else { None };
    let Some(bytes) = bytes else {
        // 만들기가 안 됐다 — 평소 길이 처음부터 다시 만든다
        phone_log("파일 만들기 실패 — 맥에서 처음부터");
        cleanup(&wav);
        return Phoned::Local(None);
    };
    let env = wav_envelope(&bytes, HOP_MS);
    let dur = std::time::Duration::from_millis(env.as_ref().map_or(0, |e| e.len() as u64 * HOP_MS as u64));
    if !crate::phone_voice::watching_now() {
        phone_log("만드는 사이 폰이 화면을 떠남 — 맥에서");
        say_end(id);
        return Phoned::Local(Some(wav));
    }
    crate::phone_voice::offer(id, wav.clone(), dur, who, env.clone());
    let mut playing = false;
    loop {
        if speak_gen() != gen {
            crate::phone_voice::withdraw(id);
            cleanup(&wav);
            return Phoned::Done;
        }
        match crate::phone_voice::poll(id) {
            crate::phone_voice::Poll::Waiting => {}
            crate::phone_voice::Poll::Playing => {
                if !playing {
                    playing = true;
                    say_playing(id, env.clone(), now_ms());
                }
            }
            crate::phone_voice::Poll::Done => {
                crate::phone_voice::withdraw(id);
                cleanup(&wav);
                return Phoned::Done;
            }
            crate::phone_voice::Poll::Fallback(why) => {
                crate::phone_voice::withdraw(id);
                phone_log(&format!("{why} — 맥에서"));
                say_end(id);
                return Phoned::Local(Some(wav));
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

/// 폰으로 돌리다 맥으로 되돌린 까닭 — notify.log (시험은 진짜 기록을 안 건드린다)
fn phone_log(why: &str) {
    #[cfg(not(test))]
    log_out("phone-voice", why);
    #[cfg(test)]
    let _ = why;
}

/// 10분 넘은 소리 파일 — 앱이 죽어 못 지운 것
fn sweep_old(dir: &std::path::Path) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|d| d > std::time::Duration::from_secs(600));
        if old {
            let _ = std::fs::remove_file(e.path());
        }
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
    crate::phone_voice::cancel(); // 폰이 틀던 소리도 멈춘다
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
/// copy = respawn 이 안 되면 이어 띄우기(새 번호 복사본)로 떨어져도 되나 — 없으면 true(사람이 누른 ▷), 참모 자동 되살리기는 false
pub async fn resume_session(cwd: String, session_id: String, id: Option<String>, copy: Option<bool>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        resume_with(&cwd, &session_id, id.as_deref(), copy.unwrap_or(true))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// resume_session 의 몸통 — 폰 서버(mobile.rs)도 같은 길로 되살린다. 끝나면 같이 쓰던 세션 목록을 버린다
pub fn resume_blocking(cwd: &str, session_id: &str, id: Option<&str>) -> Result<String, String> {
    resume_with(cwd, session_id, id, true)
}

/// 되살리는 중인 세션(대화 id·짧은 번호) — 같은 세션 되살리기가 여러 길(홈 깨우기·자동 되살리기·주인 잃은 일·폰)에서
/// 같은 순간 들어오면 둘 다 '아직 꺼짐'을 보고 respawn 두 번 → 두 번째가 막 켜진 세션을 다시 시작해 첫 지시가 끊겼다(①-14)
static REVIVING: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
static REVIVE_DONE: std::sync::Condvar = std::sync::Condvar::new();

/// 세션별 되살리기 자물쇠 — 같은 열쇠(빈 것 빼고 하나라도 같음)를 쥔 쪽이 끝날 때까지 기다린다. 놓기는 drop(패닉에도)
struct ReviveLock(Vec<String>);

impl ReviveLock {
    fn take(keys: &[&str]) -> ReviveLock {
        let keys: Vec<String> = keys.iter().filter(|k| !k.is_empty()).map(|k| k.to_string()).collect();
        let mut g = REVIVING.lock().unwrap_or_else(|e| e.into_inner());
        while g.iter().any(|k| keys.contains(k)) {
            g = REVIVE_DONE.wait(g).unwrap_or_else(|e| e.into_inner());
        }
        g.extend(keys.iter().cloned());
        ReviveLock(keys)
    }
}

impl Drop for ReviveLock {
    fn drop(&mut self) {
        let mut g = REVIVING.lock().unwrap_or_else(|e| e.into_inner());
        for k in &self.0 {
            if let Some(i) = g.iter().position(|x| x == k) {
                g.remove(i);
            }
        }
        REVIVE_DONE.notify_all();
    }
}

/// 지금 목록에 그 대화가 살아 있나(10초 제한). 못 읽으면 false — 예전처럼 켠다
fn live_now(session_id: &str) -> bool {
    let live = crate::platform::run_capped(crate::platform::command(claude_bin()).args(["agents", "--json"]), std::time::Duration::from_secs(10));
    live.is_ok_and(|o| o.status.success() && live_has(&String::from_utf8_lossy(&o.stdout), session_id))
}

/// 그사이 다른 길로 이미 켜졌으면 아무것도 안 한다 — 잠근 뒤에 본다(앞 사람이 막 켠 것도 보이게)
fn resume_with(cwd: &str, session_id: &str, id: Option<&str>, copy: bool) -> Result<String, String> {
    let _turn = ReviveLock::take(&[session_id, id.unwrap_or("")]);
    if live_now(session_id) {
        revived(id); // 깨우려던 세션이 이미 켜져 있다 — 켜진 것으로 본다
        return Ok("already running".to_string());
    }
    let r = resume_inner(cwd, session_id, id, copy);
    if r.is_ok() {
        revived(id);
    }
    forget_agents();
    r
}

fn resume_inner(cwd: &str, session_id: &str, id: Option<&str>, copy: bool) -> Result<String, String> {
    crate::trust::before_spawn(cwd);
    crate::browser_attach::reassert_for(cwd);
    resume_steps(session_id, id, copy, &mut |args| {
        let out = claude_out(crate::platform::command(claude_bin()).current_dir(cwd).args(args), CLAUDE_LIMIT)?;
        Ok((out.status.success(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr))))
    })
}

/// 되살리기 순서 — respawn(같은 번호) 먼저, 안 되면 copy 일 때만 이어 띄우기. run = claude 인자 → (성공, 출력)
/// copy=false(참모 자동 되살리기) — --bg --resume 는 새 번호 복사본이라(옛 번호를 기다리는 되살리기가 30초마다 또 띄웠다, 0.3.6 리뷰) 실패로 돌려준다
fn resume_steps(session_id: &str, id: Option<&str>, copy: bool, run: &mut dyn FnMut(&[String]) -> Result<(bool, String), String>) -> Result<String, String> {
    let first = revive_args(id);
    let mut why = String::from("no short id to respawn");
    if !first.is_empty() {
        match run(&first) {
            // 성공은 종료 코드로 — 글자("respawned")만 보면 CLI 문구가 바뀐 판에서 성공한 respawn 뒤에 같은 대화 복사본을 또 띄웠다(2026-10-21 리뷰).
            // 실패는 1 로 끝난다(없는 번호 "No job matching …", 2.1.306 실측)
            Ok((true, text)) => return Ok(text.trim().to_string()),
            Ok((_, text)) => why = text.trim().to_string(),
            Err(e) => why = e,
        }
    }
    if !copy {
        return Err(format!("respawn failed: {why}"));
    }
    if session_id.trim().is_empty() {
        return Err(format!("respawn failed: {why} — no session id to resume from")); // `--resume ""` 로 엉뚱한 새 세션을 띄우지 않는다
    }
    // 이어서 켤 때도 권한 확인 없이 — 안 붙이면 daemon 재시작 뒤 되살린 세션이 auto 모드로 떠서
    // Bash 마다 사용자 승인을 기다렸다(2026-09-28, 사용자 요청 "항상 바이패스로 켜지게"). CLAUDE.md 원칙 3
    let args: Vec<String> = ["--bg", "--dangerously-skip-permissions", "--resume", session_id].iter().map(|a| a.to_string()).collect();
    let (ok, text) = run(&args)?;
    if !ok {
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
    if keys.is_some() {
        crate::pty::settle_view(id);
    }
    attach_do(id, |w, _, _| {
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
    let Some(body) = input_lines(screen) else { return false };
    !(body.is_empty() || (body.len() == 1 && body[0].starts_with("Try \"") && body[0].ends_with('"')))
}

/// 입력칸 본문 줄들(앞뒤 공백·빈 줄 뺀) — 입력칸을 못 찾으면 None(선택 창·아직 안 그려진 화면)
fn input_lines(screen: &vt100::Screen) -> Option<Vec<String>> {
    let (_, cols) = screen.size();
    let lines: Vec<String> = screen.rows(0, cols).collect();
    // 입력칸과 테두리는 맨 앞 칸부터 — 들여 쓴 확인 창 줄(' ❯ 1. Yes')은 입력칸이 아니다
    let border = |l: &str| l.starts_with('─');
    let i = (1..lines.len()).rev().find(|&i| lines[i].starts_with('❯') && border(&lines[i - 1]))?;
    Some(
        std::iter::once(lines[i].trim_start_matches('❯'))
            .chain(lines[i + 1..].iter().take_while(|l| !border(l)).map(String::as_str))
            .map(|l| l.trim_matches(|c: char| c.is_whitespace() || c == '\u{a0}').to_string())
            .filter(|l| !l.is_empty())
            .collect(),
    )
}

/// 친 글 전체(줄 사이 Alt+Enter·공백 뺀) — 입력칸이 이걸로 끝나면 글이 다 들어간 것. 빈 글이면 화면으로 못 본다("").
/// 끝 몇 글자만 보면 끝말이 앞줄에도 있는 글('A 확인해줘\n확인해줘')은 첫 줄만 그려졌을 때 Enter 가 나갔다(0.4.4 리뷰)
pub(crate) fn typed_echo(segs: &[Vec<u8>]) -> String {
    String::from_utf8_lossy(&segs.concat()).chars().filter(|&c| !c.is_whitespace() && c != '\x1b').collect()
}

/// 입력칸 글(공백 빼고)이 친 글 전체로 끝나나 — 칸 폭에서 꺾인 줄도 이어서 본다. 붙여넣은 글로 접힘·화면보다 긴 글·입력칸 없음은 안 보인 것(최대 대기 뒤 Enter)
pub(crate) fn input_shows(screen: &vt100::Screen, echo: &str) -> bool {
    !echo.is_empty() && input_lines(screen).is_some_and(|b| b.concat().chars().filter(|c| !c.is_whitespace()).collect::<String>().ends_with(echo))
}

/// 새로 붙은 화면에 칠 수 있나 — 입력칸이 보이면 바로. 입력칸 없는 화면(선택 창 등)은 예전처럼 1.5초 지나 글자가 있으면.
/// attach 가 먼저 찍는 제 안내 줄은 입력칸이 아니라 그동안은 안 친다(그때 친 말은 날아간다, 2026-10-27)
pub(crate) fn attach_ready(screen: &vt100::Screen, waited: std::time::Duration) -> bool {
    input_lines(screen).is_some() || (waited >= ATTACH_SETTLE && screen_ready(&screen.contents()))
}

/// 입력칸이 안 보일 때 예전처럼 기다리는 시간
const ATTACH_SETTLE: std::time::Duration = std::time::Duration::from_millis(1500);
/// 친 글이 입력칸에 보이기를 기다리는 최대(예전 고정 대기) — 넘기면 그냥 Enter
const ENTER_MAX: std::time::Duration = std::time::Duration::from_millis(400);
/// Enter 뒤 입력칸이 비기를 기다리는 최대(예전 고정 대기) — 비면 바로 뗀다
const SENT_MAX: std::time::Duration = std::time::Duration::from_millis(700);

/// ok 가 참이 될 때까지 10ms 마다 — 되면 true, max 를 넘기면 false(위 wait_until 은 0.3초 간격·초 단위라 화면 보기엔 굵다)
pub(crate) fn poll_until(max: std::time::Duration, mut ok: impl FnMut() -> bool) -> bool {
    let t = std::time::Instant::now();
    loop {
        if ok() {
            return true;
        }
        if t.elapsed() >= max {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
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
    crate::pty::settle_view(id); // 자물쇠 잡기 전에 — 기다리는 동안 다른 칸 치기를 막지 않게
    let _turn = typing_turn();
    let tail = typed_echo(segs);
    attach_do(id, |w, screen, look| {
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
        // 친 글이 입력칸에 다 보이면 바로 Enter — 고정 0.4초였다(2026-10-28 chat-speed 실측: 글이 보이기까지 0~14ms).
        // 화면을 못 보면(윈도우 열린 보기·빈 글) 예전 그대로
        let look = look.filter(|_| !tail.is_empty());
        let seen = match look {
            Some(f) => poll_until(ENTER_MAX, || input_shows(&f(), &tail)),
            None => {
                std::thread::sleep(ENTER_MAX);
                false
            }
        };
        w.write_all(b"\r")?;
        // 그 글이 입력칸에서 빠지면(세션이 Enter 를 받음) 바로 뗀다. 글이 보인 걸 못 봤으면 Enter 를 받았는지도 모르니 예전처럼 0.7초 —
        // 너무 일찍 떼면 attach 가 Enter 를 넘기기 전에 끝난다
        match look.filter(|_| seen) {
            Some(f) => _ = poll_until(SENT_MAX, || !input_shows(&f(), &tail)),
            None => std::thread::sleep(SENT_MAX),
        }
        Ok(())
    })
    .map(|_| ())
}

/// 하던 일 멈추기(폰 /api/interrupt) — Esc 한 번. 글 치기와 같은 잠금을 잡는다: 폰이 글을 치는 도중에 Esc 가 끼면 치던 글 사이에 들어간다
pub fn interrupt_session(id: &str) -> Result<(), String> {
    let _turn = typing_turn();
    with_attach(id, Some(b"\x1b")).map(|_| ())
}

/// 붙은 화면을 그때그때 다시 보는 손잡이 — 새로 붙었을 때만(열린 보기는 None)
type Look<'a> = Option<&'a dyn Fn() -> vt100::Screen>;

/// attach 를 붙여 화면을 읽고 write 로 키를 넣은 뒤 뗀다 — write 는 붙은 화면(윈도우 열린 보기로 쓸 땐 None)과 지금 화면 보기(Look)를 같이 받는다
fn attach_do(id: &str, write: impl FnOnce(&mut dyn std::io::Write, Option<&vt100::Screen>, Look) -> std::io::Result<()>) -> Result<String, String> {
    // 윈도우: 앱이 이 세션 터미널 보기를 열어 두었으면 거기에 바로 쓴다 — 새로 붙으면 그 창이 쫓겨나고(세션당 한 창) 붙는 데 20초 걸렸다.
    // 화면 글자는 없으니 빈 글로 돌려준다(권한 창 자동 허용의 화면 읽기는 with_attach 가 따로 막는다)
    if cfg!(windows) {
        if let Some((w, screen)) = crate::pty::session_writer(id) {
            log_out("attach", &format!("{id} via-open-terminal"));
            // 조각마다 자물쇠(①-1), 화면은 Rust 가 그려 둔 그 보기 화면(②-1 — 입력칸에 사람 글이 있으면 치워 두기)
            return crate::pty::write_view(&w, screen.as_ref(), |w, s| write(w, s, None)).map(|_| String::new()).map_err(|e| e.to_string());
        }
        // 열린 보기가 화면을 못 받았으면(가짜 콘솔이 멈춤) 거기 쓰면 허공에 간다 — 새로 붙는다
        if crate::pty::session_has_view(id) {
            log_out("attach", &format!("{id} open-terminal-not-ready"));
        }
    }
    attach_new(id, write)
}

/// 새로 붙어서(claude attach) 화면을 읽고 키를 넣은 뒤 뗀다
fn attach_new(id: &str, write: impl FnOnce(&mut dyn std::io::Write, Option<&vt100::Screen>, Look) -> std::io::Result<()>) -> Result<String, String> {
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
    if cfg!(windows) {
        // 화면이 붙을 때까지 — 1.5초 기다리고, 글자가 아직 없으면 조금씩 더
        std::thread::sleep(ATTACH_SETTLE);
        let started = std::time::Instant::now();
        // 윈도우는 길게(25초) — 보이는 콘솔에서도 attach 가 그리기까지 6초쯤 걸렸고 cmd·백신 검사까지 얹힌다. 2초마다 받은 바이트를 남긴다
        let limit = Duration::from_millis(25_000);
        let mut next_note = Duration::from_secs(2);
        while screen_ready(&parser.lock().unwrap().screen().contents()).not() && started.elapsed() < limit {
            std::thread::sleep(Duration::from_millis(250));
            if started.elapsed() >= next_note {
                trace(&format!("wait {}s bytes {}", next_note.as_secs(), got.load(Ordering::Relaxed)));
                next_note += Duration::from_secs(2);
            }
        }
    } else {
        // 맥: 입력칸이 보이면 바로(실측 수백 ms) — 예전엔 늘 1.5초를 먼저 쉬었다. 입력칸 없는 화면은 예전처럼 1.5초 뒤 글자가 있으면(최대 8초)
        let started = std::time::Instant::now();
        let limit = ATTACH_SETTLE + Duration::from_millis(6_500);
        while !attach_ready(parser.lock().unwrap().screen(), started.elapsed()) && started.elapsed() < limit {
            std::thread::sleep(Duration::from_millis(20));
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
        crate::pty::reap(child); // 아직 안 끝났으면 거둔다 — 그냥 버리면 claude attach 가 좀비로 쌓였다
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
    let look = || parser.lock().unwrap().screen().clone();
    let r = match slot.lock().unwrap().0.as_mut() {
        Some(w) => write(&mut **w, Some(&shown), Some(&look)).map_err(|e| e.to_string()),
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

/// 쌓이기만 하는 기록의 상한 — 넘으면 앞 절반을 버린다(2026-10-11 perf 8번, auto-allow 는 상한 없이 통째로 읽혔다)
pub const LOG_CAP: u64 = 1024 * 1024;

/// path 가 max 를 넘으면 앞 절반을 줄 단위로 버린다(임시 파일에 쓰고 바꿔 끼움). 없거나 못 읽으면 그냥 둔다
pub fn cap_half(path: &std::path::Path, max: u64) {
    if std::fs::metadata(path).map_or(true, |m| m.len() <= max) {
        return;
    }
    let Ok(data) = std::fs::read(path) else { return };
    let half = data.len() / 2;
    let keep = data[half..].iter().position(|&b| b == b'\n').map_or(&[][..], |i| &data[half + i + 1..]);
    let tmp = path.with_extension("jsonl.tmp");
    if std::fs::write(&tmp, keep).is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}

/// 자동 허용 기록 한 줄 (<데이터 폴더>/auto-allow.jsonl) — 작업 패널이 최근 것을 보여준다. 1MB 넘으면 앞 절반을 버린다
#[tauri::command]
pub fn log_auto_allow(line: String) -> Result<(), String> {
    use std::io::Write;
    serde_json::from_str::<serde_json::Value>(&line).map_err(|e| format!("JSON 아님: {e}"))?;
    let path = crate::config::data_file("auto-allow.jsonl");
    cap_half(&path, LOG_CAP);
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
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
    serde_json::from_str::<serde_json::Value>(&line).map_err(|e| format!("JSON 아님: {e}"))?;
    append_record(&crate::config::data_file("tasks.jsonl"), line.trim()).map_err(|e| e.to_string())
}

/// 줄 하나를 한 번의 쓰기로 덧붙인다(글과 줄바꿈을 따로 쓰면 그 사이에 scripts/task 줄이 끼어 두 줄이 한 줄로 붙어 둘 다 못 읽었다).
/// 끝 줄이 반쪽(줄바꿈 없음)이면 줄바꿈부터 — 2026-10-21 리뷰
pub(crate) fn append_record(path: &std::path::Path, line: &str) -> std::io::Result<()> {
    use std::io::{Read, Seek, SeekFrom, Write};
    let mut f = std::fs::OpenOptions::new().create(true).read(true).append(true).open(path)?;
    let mut buf = Vec::with_capacity(line.len() + 2);
    if f.metadata()?.len() > 0 {
        let mut last = [0u8; 1];
        f.seek(SeekFrom::End(-1))?;
        f.read_exact(&mut last)?;
        if last[0] != b'\n' {
            buf.push(b'\n');
        }
    }
    buf.extend_from_slice(line.as_bytes());
    buf.push(b'\n');
    f.write_all(&buf)
}

/// ⌘+클릭한 링크 열기 — 웹 주소는 기본 브라우저, 파일은 기본 앱(macOS `open`).
/// 판정(스킴 거르기·상대 경로 풀기)은 프론트 domain/links.ts. 여기선 한 번 더 좁혀서 http(s) 와 실제 있는 파일만
#[tauri::command]
pub fn open_target(kind: String, target: String) -> Result<(), String> {
    match kind.as_str() {
        "url" if target.starts_with("http://") || target.starts_with("https://") => {}
        // 말하기 키 안내의 "키보드 설정 열기" — 이 주소 하나만(🌐 키 동작을 '아무것도 안 함'으로)
        "url" if target == "x-apple.systempreferences:com.apple.Keyboard-Settings.extension" => {}
        // Craft 따로 창의 "권한 열기" — 화면 기록 설정 하나만(맥 앱 창을 비추려면 한 번 필요)
        "url" if target == "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" => {}
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
    // 익명 사용 통계 — 새로 켠 세션 수·동시 참모 수만(이름·폴더는 안 센다)
    crate::usage_counts::record_live(&std::fs::read_to_string(&path).unwrap_or_default(), &json);
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
    fn 꼬리_길이_기본은_256kb_길게는_16mb_까지() {
        assert_eq!(super::tail_len(None), 256 * 1024);
        assert_eq!(super::tail_len(Some(0)), 256 * 1024);
        assert_eq!(super::tail_len(Some(8 * 1024 * 1024)), 8 * 1024 * 1024);
        assert_eq!(super::tail_len(Some(u64::MAX)), 16 * 1024 * 1024);
    }
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

    #[test]
    fn 친_글_끝이_입력칸에_보이면_enter() {
        // 2026-10-28 chat-speed: 고정 0.4초 대신 친 글이 입력칸에 다 들어간 걸 화면으로 보고 바로 Enter
        let screen = |bytes: &str| {
            let mut p = vt100::Parser::new(40, 120, 0);
            p.process(bytes.as_bytes());
            p
        };
        let top = "──────── chat-speed ─\r\n";
        let bottom = "\r\n────────\r\n  main · Haiku";
        let segs = super::typed_segs("첫 줄은 짧게\n둘째 줄 끝은   여기까지야");
        let tail = super::typed_echo(&segs);
        assert_eq!(tail, "첫줄은짧게둘째줄끝은여기까지야", "친 글 전체, 줄 사이·공백 빼고");
        let shown = screen(&format!("{top}❯\u{a0}첫 줄은 짧게\r\n  둘째 줄 끝은   여기까지야{bottom}"));
        assert!(super::input_shows(shown.screen(), &tail));
        // 칸 폭에서 꺾여도(공백 자리에서 줄이 바뀜) 보인 걸로
        let wrapped = screen(&format!("{top}❯\u{a0}첫 줄은 짧게\r\n  둘째 줄 끝은\r\n  여기까지야{bottom}"));
        assert!(super::input_shows(wrapped.screen(), &tail));
        // 아직 다 안 들어옴·붙여넣은 글로 접힘·입력칸 없음(선택 창) — 안 보인 걸로(최대 대기 뒤 Enter)
        let half = screen(&format!("{top}❯\u{a0}첫 줄은 짧게\r\n  둘째 줄 끝은 여기{bottom}"));
        assert!(!super::input_shows(half.screen(), &tail));
        let pasted = screen(&format!("{top}❯\u{a0}[Pasted text #1 +2 lines]{bottom}"));
        assert!(!super::input_shows(pasted.screen(), &tail));
        assert!(!super::input_shows(screen("❯ 1. Yes\r\n  2. No").screen(), &tail));
        // 지난 대화에 같은 글이 있어도 입력칸만 본다 — 보낸 뒤 칸이 비면 '보내짐'
        let sent = screen(&format!("❯ 둘째 줄 끝은 여기까지야\r\n⏺ 응\r\n{top}❯\u{a0}{bottom}"));
        assert!(!super::input_shows(sent.screen(), &tail));
        // 빈 글·줄바꿈만이면 꼬리 없음 — 화면으로 못 보니 예전 고정 대기
        assert_eq!(super::typed_echo(&super::typed_segs("  \n ")), "");
        // 짧은 글은 통째로
        assert_eq!(super::typed_echo(&super::typed_segs("응")), "응");
        // 0.4.4 리뷰 — 끝말이 앞줄에도 있으면 첫 줄만 그려졌을 때 Enter 가 나가 나머지가 입력칸에 남았다
        for text in ["A 확인해줘\n확인해줘", "다 했어\n다 했어"] {
            let tail = super::typed_echo(&super::typed_segs(text));
            let first = text.split('\n').next().unwrap();
            let early = screen(&format!("{top}❯\u{a0}{first}{bottom}"));
            assert!(!super::input_shows(early.screen(), &tail), "첫 줄만 그려진 화면: {text}");
            let all = screen(&format!("{top}❯\u{a0}{}{bottom}", text.replace('\n', "\r\n  ")));
            assert!(super::input_shows(all.screen(), &tail), "다 그려진 화면: {text}");
        }
    }

    #[test]
    fn 붙자마자_입력칸이_보이면_바로_친다() {
        use std::time::Duration;
        let screen = |bytes: &str| {
            let mut p = vt100::Parser::new(40, 120, 0);
            p.process(bytes.as_bytes());
            p
        };
        let ms = Duration::from_millis;
        let boxed = screen("⏺ 안녕\r\n──────── s ─\r\n❯\u{a0}\r\n────────\r\n  main");
        assert!(super::attach_ready(boxed.screen(), ms(30)), "입력칸이 보이면 1.5초 안 기다린다");
        // attach 가 먼저 찍는 제 안내 줄(20글자 넘음)은 세션 화면이 아니다 — 그동안 친 말은 날아간다(2026-10-27)
        let banner = screen("Attaching to session 1a2b3c4d (probe-a) — press ctrl+b d to detach");
        assert!(!super::attach_ready(banner.screen(), ms(300)));
        // 입력칸 없는 화면(선택 창)은 예전 그대로 1.5초 뒤 글자가 있으면
        let dialog = screen("Do you want to proceed?\r\n❯ 1. Yes\r\n  2. No, and tell Claude what to do differently");
        assert!(!super::attach_ready(dialog.screen(), ms(1499)));
        assert!(super::attach_ready(dialog.screen(), ms(1500)));
        assert!(!super::attach_ready(screen("").screen(), ms(5000)), "빈 화면엔 안 친다");
    }

    #[test]
    fn 기다리기는_되면_바로_끝나고_안_되면_최대까지() {
        use std::time::{Duration, Instant};
        let t = Instant::now();
        let mut n = 0;
        assert!(super::poll_until(Duration::from_millis(400), || { n += 1; n >= 3 }));
        assert!(t.elapsed() < Duration::from_millis(100), "{:?}", t.elapsed());
        let t = Instant::now();
        assert!(!super::poll_until(Duration::from_millis(120), || false));
        let e = t.elapsed();
        assert!(e >= Duration::from_millis(120) && e < Duration::from_millis(250), "{e:?}");
    }

    #[test]
    fn 기록_파일_자리는_기억했다가_없어지면_다시_찾는다() {
        // 채팅이 0.25초마다 읽는데 매번 ~/.claude/projects 폴더 718개를 뒤졌다(한 번 ~3ms, 2026-10-28 chat-speed 실측)
        let base = std::env::temp_dir().join(format!("chammo-tp-{}", std::process::id()));
        let (a, b) = (base.join("proj-a"), base.join("proj-b"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        let cache = std::sync::Mutex::new(std::collections::HashMap::new());
        assert_eq!(super::transcript_in(&base, "s1", &cache), None, "아직 첫 지시 전");
        std::fs::write(a.join("s1.jsonl"), "{}\n").unwrap();
        assert_eq!(super::transcript_in(&base, "s1", &cache), Some(a.join("s1.jsonl")));
        assert_eq!(cache.lock().unwrap().get("s1"), Some(&a.join("s1.jsonl")), "찾은 자리는 기억");
        // 옮겨지면(폴더 이름이 바뀜) 기억한 자리가 없으니 다시 찾는다
        std::fs::rename(a.join("s1.jsonl"), b.join("s1.jsonl")).unwrap();
        assert_eq!(super::transcript_in(&base, "s1", &cache), Some(b.join("s1.jsonl")));
        std::fs::remove_file(b.join("s1.jsonl")).unwrap();
        assert_eq!(super::transcript_in(&base, "s1", &cache), None);
        std::fs::remove_dir_all(&base).unwrap();
    }

    // 실측(진짜 세션 필요, 2026-10-28 chat-speed): 앱 보내기 길(type_text_tagged = 배지 대화창·폰·스페이스)로 5번 — 돌아온 시각·기록에 사람 말이 써진 시각(ms)
    // CHATSPEED_ID=<짧은 id> CHATSPEED_SID=<대화 id> CHAMMO_HOME=<시험 폴더> cargo test --bin honor-orchestrator claude::tests::실측_보내기_시간 -- --ignored --nocapture
    #[test]
    #[ignore]
    fn 실측_보내기_시간() {
        use std::time::{Duration, Instant};
        let id = std::env::var("CHATSPEED_ID").expect("CHATSPEED_ID");
        let path = super::transcript_path(&std::env::var("CHATSPEED_SID").expect("CHATSPEED_SID")).expect("기록 파일");
        for i in 0..5 {
            let word = format!("kiwi{}{i}", std::process::id() % 1000);
            let t0 = Instant::now();
            super::type_text_tagged(&id, &format!("Reply with only the word {word} in capital letters."), "chatspeed").unwrap();
            let ret = t0.elapsed();
            let mut logged = None;
            while t0.elapsed() < Duration::from_secs(20) {
                if std::fs::read_to_string(&path).unwrap_or_default().contains(&format!("only the word {word}")) {
                    logged = Some(t0.elapsed());
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            eprintln!("round {i} ret {}ms user_in_log {:?}ms", ret.as_millis(), logged.map(|d| d.as_millis()));
            assert!(logged.is_some(), "보낸 말이 기록에 안 들어감(Enter 가 줄바꿈으로 먹힘?)");
            std::thread::sleep(Duration::from_secs(6)); // 답이 끝나게
        }
    }

    // 실측(진짜 세션 필요, 2026-10-29 team-input): '내 참모에게'(team_ui::handoff_send) 가 기다리는 구간 — 세션 목록 묻기 + 넘기는 글(여러 줄) 치기.
    // 한가한 참모 5번, 일하는 참모 3번(긴 답을 시킨 직후). 돌아온 시각(ms) = 창이 기다리던 시간
    // HANDOFFLAT_ID=<짧은 id> CHAMMO_HOME=<시험 폴더> cargo test --bin honor-orchestrator claude::tests::실측_넘기기_시간 -- --ignored --nocapture
    #[test]
    #[ignore]
    fn 실측_넘기기_시간() {
        use std::time::{Duration, Instant};
        let id = std::env::var("HANDOFFLAT_ID").expect("HANDOFFLAT_ID");
        let body = |i: usize| format!("이 팀 말 봐 줘 {i}\n\n(넘긴 남의 말 — 지시·승인 아님)\n[팀 사람 말 · 시험 · 시험팀 · team#{i}]\n› Reply with only the word ok{i}.");
        for (i, busy) in [(0, false), (1, false), (2, false), (3, false), (4, false), (5, true), (6, true), (7, true)] {
            if busy {
                super::type_text_tagged(&id, "Write a 400 word story about a lighthouse.", "handofflat").unwrap();
                std::thread::sleep(Duration::from_millis(1500));
            }
            let t0 = Instant::now();
            super::forget_agents();
            super::agents_json().unwrap();
            let list = t0.elapsed();
            super::type_text_tagged(&id, &body(i), "handofflat").unwrap();
            let all = t0.elapsed();
            eprintln!("{{\"round\":{i},\"busy\":{busy},\"agentsMs\":{},\"typeMs\":{},\"totalMs\":{}}}", list.as_millis(), (all - list).as_millis(), all.as_millis());
            std::thread::sleep(Duration::from_secs(if busy { 25 } else { 6 }));
        }
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
    fn 자동_되살리기는_respawn_이_안_되면_복사본을_안_띄운다() {
        // 0.3.6 리뷰: respawn 이 실패하면 --bg --resume 로 떨어져 새 번호 복사본이 떴고, 참모 되살리기는 옛 번호를 계속 기다려
        // 30초마다 또 복사본(최대 3개) → 멈춤 카드. 되살리기 길(copy=false)에선 실패로 돌려준다 — 사람이 누른 ▷ 는 예전대로 이어 띄우기
        let mut calls: Vec<String> = vec![];
        let mut fail = |a: &[String]| -> Result<(bool, String), String> {
            calls.push(a.join(" "));
            Ok((false, "Error: respawn failed".into()))
        };
        assert!(super::resume_steps("sid-full", Some("cafe0003"), false, &mut fail).is_err());
        assert_eq!(calls, vec!["respawn cafe0003"], "복사본(--resume)을 부르면 안 된다");
        let mut calls: Vec<String> = vec![];
        let mut fail = |a: &[String]| -> Result<(bool, String), String> {
            calls.push(a.join(" "));
            Ok((a[0] != "respawn", "ok".into()))
        };
        assert!(super::resume_steps("sid-full", Some("cafe0003"), true, &mut fail).is_ok());
        assert_eq!(calls, vec!["respawn cafe0003", "--bg --dangerously-skip-permissions --resume sid-full"], "사람이 누른 ▷ 는 이어 띄우기로");
        let mut calls: Vec<String> = vec![];
        let mut ok = |a: &[String]| -> Result<(bool, String), String> {
            calls.push(a.join(" "));
            Ok((true, "Session cafe0003 respawned".into()))
        };
        assert!(super::resume_steps("sid-full", Some("cafe0003"), false, &mut ok).is_ok());
        assert_eq!(calls.len(), 1);
        let mut calls: Vec<String> = vec![];
        let mut never = |a: &[String]| -> Result<(bool, String), String> {
            calls.push(a.join(" "));
            Ok((true, String::new()))
        };
        assert!(super::resume_steps("sid-full", None, false, &mut never).is_err(), "번호가 없어 respawn 을 못 하면 자동 되살리기는 안 한다");
        assert!(calls.is_empty());
    }
    #[test]
    fn 기록을_못_읽으면_자리를_그대로_둔다() {
        // 실패 때 next 0 을 줘서 다음 차례가 기록 전체를 상한 없이 읽었다(2026-10-21 리뷰)
        let gone = std::path::Path::new("/nonexistent/chammo/x.jsonl");
        let c = super::chunk_or_keep(Some(gone), Some(5_000_000));
        assert_eq!((c.next, c.reset, c.text.as_str()), (5_000_000, false, ""));
        let c = super::chunk_or_keep(None, Some(42));
        assert_eq!((c.next, c.reset), (42, false));
        let c = super::chunk_or_keep(None, None);
        assert_eq!((c.next, c.reset), (0, false));
    }
    #[test]
    fn 작업_기록_덧붙이기는_반쪽_줄에_안_붙는다() {
        let p = std::env::temp_dir().join(format!("chammo-append-{}.jsonl", std::process::id()));
        std::fs::write(&p, r#"{"ts":"2026-10-21T09:0"#).unwrap(); // 쓰다 만 줄
        super::append_record(&p, r#"{"type":"answer","task":"t1"}"#).unwrap();
        super::append_record(&p, r#"{"type":"answer","task":"t2"}"#).unwrap();
        let ok: Vec<serde_json::Value> = std::fs::read_to_string(&p).unwrap().lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
        assert_eq!(ok.iter().map(|v| v["task"].as_str().unwrap()).collect::<Vec<_>>(), vec!["t1", "t2"]);
        let _ = std::fs::remove_file(&p);
    }
    #[test]
    fn respawn_성공은_종료_코드로_빈_세션_id_로는_이어_띄우지_않는다() {
        // 2026-10-21 리뷰: 성공 문구가 "respawned" 가 아니면(판마다 다를 수 있다) 성공한 respawn 뒤에 같은 대화 복사본을 또 띄웠다
        let mut calls: Vec<String> = vec![];
        let mut ok = |a: &[String]| -> Result<(bool, String), String> {
            calls.push(a.join(" "));
            Ok((true, "Restarted cafe0003".into()))
        };
        assert!(super::resume_steps("sid-full", Some("cafe0003"), true, &mut ok).is_ok());
        assert_eq!(calls, vec!["respawn cafe0003"], "종료 코드 0 이면 이어 띄우기(복사본) 없음");
        // 직접 답하기 카드는 sessionId 없이 부를 수 있다 — `--resume ""` 로 떨어지면 엉뚱한 새 세션
        let mut calls: Vec<String> = vec![];
        let mut fail = |a: &[String]| -> Result<(bool, String), String> {
            calls.push(a.join(" "));
            Ok((false, "No job matching 'cafe0003'".into()))
        };
        assert!(super::resume_steps("", Some("cafe0003"), true, &mut fail).is_err());
        assert_eq!(calls, vec!["respawn cafe0003"]);
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

// 폰에서 음성 소리 틀기(2026-10-11 사용자) — 폰이 보고 있으면 소리 파일만 만들어 폰으로, 못 틀면 같은 파일을 맥에서
#[cfg(test)]
mod phone_route_tests {
    use super::{run_speech_in, speak_gen, stop_speaking, SPEAK_TEST_LOCK};
    use crate::phone_voice::{self, Ack, AckKind, Beat};
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    /// …/tts/supertonic/speak 흉내 — 환경변수 길(HOLD·PLAY)을 따라 log 에 한 줄씩 적는다
    fn fake_runner(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("chammo-phone-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("tts/supertonic");
        std::fs::create_dir_all(&dir).unwrap();
        let log = root.join("log.txt");
        let runner = dir.join("speak");
        let body = format!(
            "#!/bin/sh\nif [ -n \"$CHAMMO_TTS_PLAY\" ]; then echo \"PLAYING $CHAMMO_TTS_PLAY\"; echo local >> '{log}'; rm -f \"$CHAMMO_TTS_PLAY\"; exit; fi\nif [ -n \"$CHAMMO_TTS_HOLD\" ]; then printf RIFFxxxxWAVE > \"$CHAMMO_TTS_HOLD\"; echo held >> '{log}'; exit; fi\necho \"PLAYING x\"; echo normal >> '{log}'\n",
            log = log.display()
        );
        std::fs::write(&runner, body).unwrap();
        crate::platform::make_executable(&runner);
        (runner, log, root.join("phone-voice"))
    }
    fn read(p: &Path) -> String {
        std::fs::read_to_string(p).unwrap_or_default()
    }
    fn watching() {
        phone_voice::beat(Beat { ready: true, hidden: false, ack: None });
    }
    fn away() {
        phone_voice::beat(Beat { ready: false, hidden: true, ack: None });
    }
    /// 가짜 폰 — 소리가 내놓아지면 가져가(audio_path) 시작 소식을 보내고, 끝 소식 또는 실패 소식을 보낸다
    fn fake_phone(kind: AckKind) -> std::thread::JoinHandle<Option<u64>> {
        std::thread::spawn(move || {
            for _ in 0..300 {
                let r = phone_voice::beat(Beat { ready: true, hidden: false, ack: None });
                if let Some((id, _)) = r.item {
                    assert!(phone_voice::audio_path(id).is_some_and(|p| p.is_file()), "내놓은 소리 파일이 있어야");
                    if kind == AckKind::Fail {
                        phone_voice::beat(Beat { ready: true, hidden: false, ack: Some(Ack { id, kind: AckKind::Fail }) });
                    } else {
                        phone_voice::beat(Beat { ready: true, hidden: false, ack: Some(Ack { id, kind: AckKind::Start }) });
                        std::thread::sleep(Duration::from_millis(200));
                        phone_voice::beat(Beat { ready: true, hidden: false, ack: Some(Ack { id, kind: AckKind::End }) });
                    }
                    return Some(id);
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            None
        })
    }
    fn run(runner: &Path, dir: &Path) {
        let argv = vec![runner.to_string_lossy().to_string(), "-v".into(), "M1".into(), "안녕".into()];
        run_speech_in(argv, speak_gen(), Some("f00d0002".into()), |_| {}, dir);
    }

    #[test]
    fn 폰이_보고_있고_틀면_맥은_소리를_안_튼다() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (runner, log, dir) = fake_runner("ok");
        watching();
        let phone = fake_phone(AckKind::Start);
        run(&runner, &dir);
        assert!(phone.join().unwrap().is_some(), "폰이 소리를 받았다");
        assert_eq!(read(&log), "held\n", "맥은 파일만 만들고 틀지 않는다");
        assert_eq!(std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0), 0, "다 틀면 소리 파일을 지운다");
        away();
    }

    #[test]
    fn 폰이_못_틀면_같은_파일을_맥에서_튼다() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (runner, log, dir) = fake_runner("fail");
        watching();
        let phone = fake_phone(AckKind::Fail);
        run(&runner, &dir);
        phone.join().unwrap();
        assert_eq!(read(&log), "held\nlocal\n", "만든 파일을 다시 만들지 않고 그대로 맥에서");
        assert_eq!(std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0), 0);
        away();
    }

    #[test]
    fn 폰이_답이_없으면_6초_안에_맥으로() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (runner, log, dir) = fake_runner("silent");
        watching();
        let t = std::time::Instant::now();
        let keep = std::thread::spawn(|| {
            // 하트비트는 오는데 소리는 안 가져간다(오디오가 막혔다)
            for _ in 0..80 {
                phone_voice::beat(Beat { ready: true, hidden: false, ack: None });
                std::thread::sleep(Duration::from_millis(100));
            }
        });
        run(&runner, &dir);
        assert!(t.elapsed() < Duration::from_secs(8), "{:?}", t.elapsed());
        assert_eq!(read(&log), "held\nlocal\n");
        keep.join().unwrap();
        away();
    }

    #[test]
    fn 폰을_안_보면_예전처럼_맥에서_바로() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (runner, log, dir) = fake_runner("away");
        away();
        run(&runner, &dir);
        assert_eq!(read(&log), "normal\n", "소리 파일 길을 안 탄다");
        assert!(!dir.exists(), "폰 폴더도 안 만든다");
    }

    #[test]
    fn 폰이_기다리는_중_멈추면_맥에서도_안_튼다() {
        let _g = SPEAK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (runner, log, dir) = fake_runner("stop");
        watching();
        let g = speak_gen();
        let (r2, d2) = (runner.clone(), dir.clone());
        let h = std::thread::spawn(move || {
            let argv = vec![r2.to_string_lossy().to_string(), "안녕".into()];
            run_speech_in(argv, g, None, |_| {}, &d2);
        });
        for _ in 0..100 {
            if phone_voice::beat(Beat { ready: true, hidden: false, ack: None }).item.is_some() { break; }
            std::thread::sleep(Duration::from_millis(20));
        }
        stop_speaking();
        h.join().unwrap();
        assert_eq!(read(&log), "held\n", "멈췄으면 맥이 이어서 틀지 않는다");
        assert_eq!(std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0), 0);
        away();
    }
}
