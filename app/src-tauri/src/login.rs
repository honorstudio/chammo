//! 로그인 풀림 — 맥 로그인 상태 재기(probe)와 폰에서 하는 로그인(docs/plans/2026-10-06-login-expired.md).
//! 판단은 화면 쪽 domain/login.ts. 여기선 재료만: `claude auth status`(앱 GUI 문맥 — SSH 문맥은 키체인을 못 읽어 늘 false)와
//! 계정 로그인이 바뀐 시각(맥 키체인 mdat·윈도우·리눅스 .credentials.json 고친 시각 — 고친 시각이 바뀔 때만 값을 읽어 MCP 로그인만 바뀐 건 거른다).
//!
//! 폰 로그인: 맥이 pty 로 `claude auth login` 을 띄우고(BROWSER 를 막아 맥에 브라우저를 안 띄운다) 출력에서 수동 로그인 주소를 뽑아 폰에 준다.
//! 폰에서 그 주소로 로그인하면 페이지가 코드를 보여 준다 → 폰 입력칸 → pty 로 한 줄. 비밀번호·2FA 는 사람이 폰 브라우저에서.
//! 코드·출력은 기록·로그·폰 어디에도 남기지 않는다 — 폰에 가는 건 주소·상태·짧은 이유 이름뿐
use portable_pty::{Child, MasterPty};
use serde::Serialize;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// 폰 로그인 하나가 이만큼 넘게 걸리면 접는다(사람이 그만둔 것)
pub const FLOW_TTL: Duration = Duration::from_secs(10 * 60);
/// 성공 글을 본 뒤 claude 가 스스로 끝나길 기다리는 시간 — 키체인 뒤에 ~/.claude.json oauthAccount 를 쓰는 중에 죽이면 둘이 어긋난다
pub const OK_GRACE: Duration = Duration::from_secs(10);
const LIVE_SERVICE: &str = "Claude Code-credentials";

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// 모르면 None(claude 를 못 찾음·시간 초과)
    pub logged_in: Option<bool>,
    /// 계정 로그인이 마지막으로 바뀐 시각(ms) — 로그인·토큰 갱신·계정 바꾸기. 같은 칸의 MCP 로그인만 바뀐 건 안 친다(login_at). 모르면 None
    pub cred_at: Option<i64>,
}

/// `security find-generic-password -s …`(값 없이 속성만) 출력의 mdat → ms. 예: `"mdat"<timedate>=0x3230… "20261005204344Z\000"`
pub fn parse_mdat(attrs: &str) -> Option<i64> {
    let line = attrs.lines().find(|l| l.trim_start().starts_with("\"mdat\""))?;
    let q = line.rfind("\"")?;
    let open = line[..q].rfind('"')?;
    let s = line[open + 1..q].trim_end_matches("\\000");
    let d = |a: usize, b: usize| s.get(a..b)?.parse::<i64>().ok();
    if s.len() < 15 || !s[..14].bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (y, mo, da, h, mi, se) = (d(0, 4)?, d(4, 6)?, d(6, 8)?, d(8, 10)?, d(10, 12)?, d(12, 14)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&da) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    Some((days_from_civil(y, mo, da) * 86_400 + h * 3600 + mi * 60 + se) * 1000)
}

/// 그레고리력 날짜 → 1970-01-01 부터 날 수(UTC)
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|s| !s.is_empty())
}

/// 로그인 칸 고친 시각. 맥 = 키체인 속성만(값·허용 창 없음). CLAUDE_CONFIG_DIR 를 쓰면 칸 이름이 달라 모른다(시험은 CHAMMO_ACCOUNT_LIVE_SERVICE)
pub fn cred_at() -> Option<i64> {
    if cfg!(target_os = "macos") {
        let service = match (env("CHAMMO_ACCOUNT_LIVE_SERVICE"), env("CLAUDE_CONFIG_DIR")) {
            (Some(s), _) => s,
            (None, Some(_)) => return None,
            (None, None) => LIVE_SERVICE.to_string(),
        };
        let mut cmd = crate::platform::command("/usr/bin/security");
        cmd.args(["find-generic-password", "-s", &service]);
        if let Some(kc) = env("CHAMMO_ACCOUNT_KEYCHAIN") {
            cmd.arg(kc);
        }
        let out = cmd.stdin(std::process::Stdio::null()).output().ok()?;
        return out.status.success().then(|| parse_mdat(&String::from_utf8_lossy(&out.stdout))).flatten();
    }
    let dir = env("CLAUDE_CONFIG_DIR").map(std::path::PathBuf::from).unwrap_or_else(|| std::path::Path::new(&crate::config::home()).join(".claude"));
    let t = std::fs::metadata(dir.join(".credentials.json")).ok()?.modified().ok()?;
    Some(t.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64)
}

/// 로그인 시각 기억 — 칸 고친 시각(mdat)·그때 계정 로그인 지문·계정 로그인이 마지막으로 바뀐 시각
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CredSeen {
    pub mdat: i64,
    pub fp: Option<u64>,
    pub login_at: i64,
}

/// 칸 값에서 계정 로그인(claudeAiOauth)만의 지문 — 같은 칸의 MCP 로그인(mcpOAuth)은 안 본다. 기억은 앱 메모리에만(파일에 안 남긴다)
pub fn oauth_fp(secret_json: &str) -> Option<u64> {
    use std::hash::{Hash, Hasher};
    let v: serde_json::Value = serde_json::from_str(secret_json).ok()?;
    let p = v.get("claudeAiOauth").filter(|p| p.is_object())?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    p.to_string().hash(&mut h);
    Some(h.finish())
}

/// 로그인 시각 한 걸음. 칸 고친 시각이 그대로면 값을 안 읽는다. 바뀌었으면 값을 읽어 계정 로그인이 바뀌었을 때만 그 시각을 로그인으로 —
/// MCP 로그인도 같은 칸에 써서 고친 시각만 보면 '고쳐짐'으로 이어서가 헛나갔다(roadmap login-expired ①).
/// 처음 보거나 값을 못 읽으면 예전처럼 고친 시각 그대로(놓치는 것보다 한 번 헛나가는 게 낫다)
pub fn login_at_step(prev: Option<CredSeen>, mdat: Option<i64>, read: impl FnOnce() -> Option<u64>) -> (Option<CredSeen>, Option<i64>) {
    let Some(mdat) = mdat else { return (prev, None) };
    if let Some(p) = prev.filter(|p| p.mdat == mdat) {
        return (Some(p), Some(p.login_at));
    }
    let fp = read();
    let login_at = match (prev, fp) {
        (Some(p), Some(f)) if p.fp == Some(f) => p.login_at,
        _ => mdat,
    };
    (Some(CredSeen { mdat, fp, login_at }), Some(login_at))
}

/// 지금 로그인 칸 값의 계정 로그인 지문. 맥 = 계정 풀과 같은 길(security 명령·창 없이), 윈도우·리눅스 = .credentials.json
fn live_fp() -> Option<u64> {
    if cfg!(target_os = "macos") {
        return crate::accounts_cmd::live_secret_quiet().and_then(|s| oauth_fp(s.expose()));
    }
    let dir = env("CLAUDE_CONFIG_DIR").map(std::path::PathBuf::from).unwrap_or_else(|| std::path::Path::new(&crate::config::home()).join(".claude"));
    oauth_fp(&std::fs::read_to_string(dir.join(".credentials.json")).ok()?)
}

static SEEN: Mutex<Option<CredSeen>> = Mutex::new(None);

/// 계정 로그인이 마지막으로 바뀐 시각(로그인·토큰 갱신·계정 바꾸기). MCP 로그인만 바뀐 건 안 친다. 모르면 None
pub fn login_at() -> Option<i64> {
    let mut g = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    let (seen, at) = login_at_step(*g, cred_at(), live_fp);
    *g = seen;
    at
}

/// 맥 로그인 상태 — 화면이 로그인 오류로 멈춘 세션을 볼 때 15초마다, 아니면 드물게 부른다
#[tauri::command]
pub async fn login_probe() -> Probe {
    tauri::async_runtime::spawn_blocking(|| Probe { logged_in: crate::setup::auth_status(&crate::claude::claude_bin()), cred_at: login_at() })
        .await
        .unwrap_or_default()
}

/// 화면이 판단한 '로그인 필요'(domain/login) — 폰 /api/login 이 읽는다. <데이터>/login.json
#[tauri::command]
pub fn login_save(json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    let path = crate::config::data_file("login.json");
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).and_then(|_| std::fs::rename(&tmp, &path)).map_err(|e| e.to_string())
}

// ---- 폰 로그인 흐름 ----

/// 출력에서 터미널 꾸밈(색·OSC 8 링크)을 지운다 — OSC 8 은 `ESC ]8;;주소 ESC \ 글 ESC ]8;; ESC \` 라 주소가 두 번 나온다
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\x1b' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('[') => {
                // CSI — 끝 글자(@~) 까지
                for c in it.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            Some(']') => {
                // OSC — BEL 또는 ESC \ 까지
                while let Some(c) = it.next() {
                    if c == '\x07' {
                        break;
                    }
                    if c == '\x1b' && it.peek() == Some(&'\\') {
                        it.next();
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// 수동 로그인 주소 — "visit:" 뒤 첫 https 주소. 알려진 로그인 호스트만(엉뚱한 주소를 폰에 열게 하지 않는다)
pub fn parse_url(out: &str) -> Option<String> {
    let after_raw = &out[out.find("visit:")? + "visit:".len()..];
    // OSC 8 링크 대상이 먼저 — 보이는 글은 터미널 폭에서 줄바꿈될 수 있지만 대상은 통째다(실측 465자, 폭 80·200 둘 다)
    let url: String = match after_raw.trim_start().strip_prefix("\x1b]8;;") {
        Some(t) => t.chars().take_while(|c| *c != '\x07' && *c != '\x1b' && !c.is_whitespace()).collect(),
        None => strip_ansi(after_raw).trim_start().chars().take_while(|c| !c.is_whitespace()).collect(),
    };
    let rest = url.strip_prefix("https://")?;
    let host = rest.split(['/', '?']).next()?;
    const HOSTS: [&str; 4] = ["claude.com", "claude.ai", "platform.claude.com", "console.anthropic.com"];
    (HOSTS.contains(&host) && url.len() <= 4096).then_some(url)
}

/// 붙여 넣는 코드 — 글자·숫자와 코드에 쓰이는 기호만, 줄바꿈 없음(한 줄 넘게 넣어 다른 명령을 치지 못하게)
pub fn code_ok(code: &str) -> bool {
    (1..=512).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_alphanumeric() || b"#_-.~+/=".contains(&b))
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlowStatus {
    /// idle · starting(주소 기다림) · waiting(코드 기다림) · checking(코드 넣음) · done · failed
    pub state: &'static str,
    pub url: Option<String>,
    /// failed 이유 이름 — code(코드가 틀림) · exit · timeout · spawn · nourl
    pub error: Option<&'static str>,
}

#[derive(Default)]
struct Shared {
    /// 꾸밈 지운 출력 꼬리(주소·끝 판정용) — 밖으로 안 나간다
    tail: String,
    url: Option<String>,
    ok: bool,
}

struct Running {
    _master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn Child + Send + Sync>,
    shared: Arc<Mutex<Shared>>,
    started: Instant,
    /// 성공 글을 처음 본 때
    ok_at: Option<Instant>,
    code_sent: bool,
    end: Option<FlowStatus>,
}

static FLOW: Mutex<Option<Running>> = Mutex::new(None);

/// 출력 꼬리에서 끝을 본다 — Claude Code 는 성공하면 "Login successful" 을 찍는다
fn saw_ok(tail: &str) -> bool {
    tail.contains("Login successful") || tail.contains("Successfully logged in")
}

/// 지금 상태 — 끝났으면 끝난 그대로(다음 start 전까지)
fn status_of(r: &mut Running) -> FlowStatus {
    if let Some(e) = &r.end {
        return e.clone();
    }
    let (url, ok) = {
        let s = r.shared.lock().unwrap_or_else(|e| e.into_inner());
        (s.url.clone(), s.ok)
    };
    let exited = r.child.try_wait().ok().flatten();
    let fin = |r: &mut Running, st: FlowStatus| {
        stop_child(&mut r.child);
        r.end = Some(st.clone());
        st
    };
    if ok && r.ok_at.is_none() {
        r.ok_at = Some(Instant::now());
    }
    if let Some(x) = exited {
        let st = if ok || (x.success() && r.code_sent) { FlowStatus { state: "done", url: None, error: None } } else { FlowStatus { state: "failed", url: None, error: Some(if r.code_sent { "code" } else { "exit" }) } };
        return fin(r, st);
    }
    // 성공 글을 봤는데 아직 안 끝났다 — 스스로 끝나길 잠깐 기다리고, 넘으면 끈다(성공은 성공)
    if let Some(t) = r.ok_at {
        if t.elapsed() < OK_GRACE {
            return FlowStatus { state: "checking", url: None, error: None };
        }
        return fin(r, FlowStatus { state: "done", url: None, error: None });
    }
    if r.started.elapsed() > FLOW_TTL {
        return fin(r, FlowStatus { state: "failed", url: None, error: Some("timeout") });
    }
    if url.is_none() && r.started.elapsed() > Duration::from_secs(30) {
        return fin(r, FlowStatus { state: "failed", url: None, error: Some("nourl") });
    }
    let state = if r.code_sent { "checking" } else if url.is_some() { "waiting" } else { "starting" };
    FlowStatus { state, url: if r.code_sent { None } else { url }, error: None }
}

/// 끄고 거둔다(좀비 안 남게). 윈도우는 pty 자식이 cmd 라 그 밑 claude 까지 트리째
fn stop_child(child: &mut Box<dyn Child + Send + Sync>) {
    if child.try_wait().ok().flatten().is_some() {
        return;
    }
    #[cfg(windows)]
    if let Some(pid) = child.process_id() {
        let _ = crate::platform::command("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub fn flow_status() -> FlowStatus {
    match FLOW.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        Some(r) => status_of(r),
        None => FlowStatus { state: "idle", url: None, error: None },
    }
}

/// `claude auth login` 한 줄 — 맥은 BROWSER 를 막아 맥 화면에 브라우저를 안 띄운다(폰에서 연다). 윈도우는 BROWSER 를 안 따를 수 있어 그대로
pub fn login_line(bin: &str, win: bool) -> String {
    if win {
        format!("\"{bin}\" auth login")
    } else {
        format!("BROWSER=/usr/bin/true exec '{}' auth login", bin.replace('\'', "'\\''"))
    }
}

/// 시작 — 돌고 있으면 그것 그대로(폰 두 대·두 번 누름). 끝난 것은 새로
pub fn flow_start(command: &str) -> FlowStatus {
    let mut g = FLOW.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(r) = g.as_mut() {
        let st = status_of(r);
        if st.state != "done" && st.state != "failed" {
            return st;
        }
    }
    let shared = Arc::new(Mutex::new(Shared::default()));
    let sh = shared.clone();
    let writer_slot: Arc<Mutex<Option<Arc<Mutex<Box<dyn Write + Send>>>>>> = Arc::new(Mutex::new(None));
    let ws = writer_slot.clone();
    let mut raw = Vec::<u8>::new();
    let spawned = crate::pty::spawn_pty(command, None, 200, 50, move |b| {
        // 윈도우 ConPTY 는 커서 위치 물음(ESC[6n)에 답이 없으면 자식을 안 띄운다 — 답해 준다
        if b.windows(4).any(|w| w == b"\x1b[6n") {
            if let Some(w) = ws.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
                let _ = w.lock().map(|mut w| w.write_all(b"\x1b[1;1R").and_then(|_| w.flush()));
            }
        }
        raw.extend_from_slice(b);
        if raw.len() > 64 * 1024 {
            raw.drain(..raw.len() - 32 * 1024);
        }
        let text = strip_ansi(&String::from_utf8_lossy(&raw));
        let mut s = sh.lock().unwrap_or_else(|e| e.into_inner());
        if s.url.is_none() {
            s.url = parse_url(&String::from_utf8_lossy(&raw));
        }
        s.ok = s.ok || saw_ok(&text);
        s.tail = text.chars().rev().take(4096).collect::<Vec<_>>().into_iter().rev().collect();
        true
    });
    let (master, writer, child) = match spawned {
        Ok(x) => x,
        Err(_) => {
            *g = None;
            return FlowStatus { state: "failed", url: None, error: Some("spawn") };
        }
    };
    let writer = Arc::new(Mutex::new(writer));
    *writer_slot.lock().unwrap_or_else(|e| e.into_inner()) = Some(writer.clone());
    let mut r = Running { _master: master, writer, child, shared, started: Instant::now(), ok_at: None, code_sent: false, end: None };
    // 폰이 시트를 닫고 안 돌아와도 10분 뒤엔 접는다 — 상태를 한 번 물으면 status_of 가 시간 넘은 흐름을 끈다(새 흐름이면 그쪽 시계로 판단)
    std::thread::spawn(|| {
        std::thread::sleep(FLOW_TTL + Duration::from_secs(1));
        flow_status();
    });
    let st = status_of(&mut r);
    *g = Some(r);
    st
}

/// 코드 한 줄 넣기 — 주소가 나온 뒤(waiting)에만, 한 번만. 값은 어디에도 안 남긴다
pub fn flow_code(code: &str) -> Result<FlowStatus, &'static str> {
    if !code_ok(code) {
        return Err("bad code");
    }
    let mut g = FLOW.lock().unwrap_or_else(|e| e.into_inner());
    let r = g.as_mut().ok_or("no flow")?;
    if status_of(r).state != "waiting" {
        return Err("not waiting");
    }
    let mut w = r.writer.lock().unwrap_or_else(|e| e.into_inner());
    w.write_all(code.as_bytes()).and_then(|_| w.write_all(b"\r")).and_then(|_| w.flush()).map_err(|_| "write")?;
    drop(w);
    r.code_sent = true;
    Ok(status_of(r))
}

pub fn flow_cancel() {
    if let Some(mut r) = FLOW.lock().unwrap_or_else(|e| e.into_inner()).take() {
        stop_child(&mut r.child);
    }
}

/// 폰 /api/login — 화면이 적은 판단(login.json) + 폰 로그인 흐름 상태. 너무 크거나 깨진 파일은 null
pub fn phone_view(dir: &std::path::Path) -> serde_json::Value {
    let p = dir.join("login.json");
    let need = std::fs::metadata(&p)
        .ok()
        .filter(|m| m.len() <= 64 * 1024)
        .and_then(|_| std::fs::read_to_string(&p).ok())
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .unwrap_or(serde_json::Value::Null);
    serde_json::json!({ "need": need, "flow": flow_status() })
}

#[cfg(test)]
#[path = "login_tests.rs"]
mod tests;
