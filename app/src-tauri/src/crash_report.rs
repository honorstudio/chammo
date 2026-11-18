//! 오류 보고(ADR 0033 1단계) — Rust panic·화면 오류가 **어디서** 났는지를 정해 둔 칸만으로 relay.chammo.app/v0/crash 에 보낸다.
//! - 오류 글·경로·이름·설치 번호는 안 싣는다. 칸마다 모양 검사(`valid`)를 하고, 하나라도 어긋난 보고는 버린다
//! - 스위치는 '익명 사용 통계'(features.usage_ping) 그대로, 관문도 ping 과 같다(공개판·첫 안내 뒤·디버그/시험 폴더 아님) + 시행일 `START`
//! - 먼저 `<데이터>/crash-outbox.json`(600)에 쓰고 뒤 스레드가 보낸다 — 못 보내면 남겨 두고 다음에(상한 `MAX_ENTRIES`), 같은 오류는 개수만 올린다
//! - 사용자가 다른 중계(team.json server)를 쓰면 보내지 않는다 — 남의 서버로 가면 안 된다
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// 처리방침 '오류 난 자리' 시행일(UTC, 게시 30일 뒤 — ADR 0033, 11-17 결정). 중계도 같은 날짜 전엔 버린다
pub const START: &str = "2026-12-18";
pub const URL: &str = "https://relay.chammo.app/v0/crash";
pub const OUTBOX: &str = "crash-outbox.json";
/// 서로 다른 오류는 50개까지만 쌓는다 — 넘으면 새 오류는 버린다(같은 오류는 개수만)
pub const MAX_ENTRIES: usize = 50;
pub const MAX_N: u32 = 999;
/// 한 번에 보내는 보고 수 — 중계와 같은 값
pub const BATCH: usize = 20;
pub const MAX_FRAMES: usize = 5;

pub const KINDS: [&str; 2] = ["panic", "webview"];
/// panic 글 꼴 — 글은 안 보내고 이 이름만
pub const FORMS: [&str; 7] = ["index-oob", "unwrap-none", "unwrap-err", "overflow", "borrow", "str-index", "other"];
pub const NAMES: [&str; 6] = ["TypeError", "RangeError", "ReferenceError", "SyntaxError", "Error", "other"];
/// 창 이름 앞부분 → 화면 자리. 실제 창 이름엔 모드 이름·팀 키·세션 번호가 들어 있어 앞부분만 본다
pub const WHERES: [&str; 8] = ["main", "team", "mode", "reader", "craft", "notes", "bubble", "other"];
/// 보고 한 건의 칸 — 서버와의 약속(chammo-relay src/crash.ts). 늘리려면 처리방침부터
pub const REPORT_KEYS: [&str; 7] = ["kind", "loc", "form", "name", "at", "frames", "n"];
/// 몸통 칸
pub const BODY_KEYS: [&str; 5] = ["v", "os", "arch", "ch", "r"];
/// 우리 화면 번들 주소 앞머리(맥 WebKit · 윈도우 WebView2)
const BUNDLE: [&str; 3] = ["tauri://localhost/assets/", "http://tauri.localhost/assets/", "https://tauri.localhost/assets/"];

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Report {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub form: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub frames: Vec<String>,
    pub n: u32,
}

impl Report {
    /// 같은 오류 묶음 열쇠(이 기기 안에서만 쓴다)
    pub fn key(&self) -> String {
        format!("{}|{}|{}|{}|{}|{}", self.kind, self.loc.as_deref().unwrap_or(""), self.form.as_deref().unwrap_or(""), self.name.as_deref().unwrap_or(""), self.at.as_deref().unwrap_or(""), self.frames.join(","))
    }
}

// ── 모양 검사 — 문자열 전체를 본다(끝 줄바꿈·뒤에 붙은 글도 실패) ──

fn digits(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_digit())
}

/// `<줄>:<칸>` 꼴
fn line_col(s: &str) -> bool {
    matches!(s.split_once(':'), Some((l, c)) if digits(l, 7) && digits(c, 7))
}

/// `src/a/b.rs:12:5`(우리 크레이트) · `크레이트@1.2.3` · `std` · `other`
pub fn valid_loc(s: &str) -> bool {
    if s == "std" || s == "other" {
        return true;
    }
    if let Some((name, ver)) = s.split_once('@') {
        let parts: Vec<&str> = ver.split('.').collect();
        return (1..=64).contains(&name.len())
            && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
            && parts.len() == 3
            && parts.iter().all(|p| digits(p, 4));
    }
    let Some(rest) = s.strip_prefix("src/") else { return false };
    let Some(i) = rest.find(".rs:") else { return false };
    let (path, pos) = (&rest[..i], &rest[i + 4..]);
    path.len() <= 120
        && path.split('/').all(|seg| !seg.is_empty() && seg.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'))
        && line_col(pos)
}

/// `index-AbC_1.js:12:345` — 우리 번들 파일 이름과 줄·칸만
pub fn valid_frame(s: &str) -> bool {
    let Some(i) = s.find(".js:") else { return false };
    let (file, pos) = (&s[..i], &s[i + 4..]);
    (1..=80).contains(&file.len())
        && !file.contains("..")
        && !file.starts_with('.')
        && file.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
        && line_col(pos)
}

/// 보고 한 건이 약속한 모양인가 — 종류마다 칸이 다르다(panic: loc·form, webview: name·at·frames)
pub fn valid(r: &Report) -> bool {
    if !(1..=MAX_N).contains(&r.n) {
        return false;
    }
    match r.kind.as_str() {
        "panic" => {
            r.loc.as_deref().is_some_and(valid_loc)
                && r.form.as_deref().is_some_and(|f| FORMS.contains(&f))
                && r.name.is_none()
                && r.at.is_none()
                && r.frames.is_empty()
        }
        "webview" => {
            r.name.as_deref().is_some_and(|n| NAMES.contains(&n))
                && r.at.as_deref().is_some_and(|a| WHERES.contains(&a))
                && r.frames.len() <= MAX_FRAMES
                && r.frames.iter().all(|f| valid_frame(f))
                && r.loc.is_none()
                && r.form.is_none()
        }
        _ => false,
    }
}

// ── 날 것 → 칸 ──

/// panic 위치 → 칸. 우리 크레이트(remap 뒤 `src/…`)는 그대로, 남의 크레이트는 `이름@판`, 표준 라이브러리는 `std`, 그 밖(절대 경로 등)은 `other`
pub fn loc_of(file: &str, line: u32, col: u32) -> String {
    let f = file.replace('\\', "/");
    let ours = format!("{f}:{line}:{col}");
    if valid_loc(&ours) {
        return ours;
    }
    if let Some(i) = f.find("/registry/src/") {
        // …/registry/src/<색인 폴더>/<이름>-<판>/src/…
        if let Some(dir) = f[i + 14..].split('/').nth(1) {
            if let Some((name, ver)) = dir.rsplit_once('-') {
                let c = format!("{name}@{ver}");
                if valid_loc(&c) {
                    return c;
                }
            }
        }
    }
    if f.starts_with("/rustc/") || f.contains("/library/core/") || f.contains("/library/std/") || f.contains("/library/alloc/") {
        return "std".into();
    }
    "other".into()
}

/// panic 글 → 꼴 이름(글은 버린다)
pub fn form_of(msg: &str) -> &'static str {
    let m = msg.trim_start();
    if m.starts_with("index out of bounds") {
        "index-oob"
    } else if m.starts_with("called `Option::unwrap()` on a `None` value") {
        "unwrap-none"
    } else if m.starts_with("called `Result::unwrap()` on an `Err` value") {
        "unwrap-err"
    } else if m.starts_with("attempt to") && m.contains("overflow") {
        "overflow"
    } else if m.starts_with("already borrowed") || m.starts_with("already mutably borrowed") {
        "borrow"
    } else if m.starts_with("byte index") || m.contains("is not a char boundary") {
        "str-index"
    } else {
        "other"
    }
}

pub fn name_of(name: &str) -> &'static str {
    NAMES.iter().find(|n| **n == name && **n != "other").copied().unwrap_or("other")
}

/// 창 이름 → 화면 자리. `team-<팀 키>`·`mode-<모드 이름>` 처럼 뒤는 버리고 앞부분만
pub fn at_of(label: &str) -> &'static str {
    let head = label.split('-').next().unwrap_or("");
    WHERES.iter().find(|w| **w == head && **w != "other").copied().unwrap_or("other")
}

/// 오류 스택 글 → 우리 번들 프레임만(위에서 5개). 함수 이름·남의 주소·blob·모드 칸 주소는 버린다
pub fn frames_of(stack: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in stack.lines() {
        for pre in BUNDLE {
            let Some(i) = line.find(pre) else { continue };
            // 앞이 주소의 일부(blob:tauri://…)면 남의 것
            if line[..i].ends_with(':') {
                continue;
            }
            let rest = &line[i + pre.len()..];
            let end = rest.find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':'))).unwrap_or(rest.len());
            let f = rest[..end].to_string();
            if valid_frame(&f) {
                out.push(f);
            }
            break;
        }
        if out.len() >= MAX_FRAMES {
            break;
        }
    }
    out
}

pub fn panic_report(file: &str, line: u32, col: u32, msg: &str) -> Report {
    Report { kind: "panic".into(), loc: Some(loc_of(file, line, col)), form: Some(form_of(msg).into()), n: 1, ..Default::default() }
}

pub fn webview_report(label: &str, name: &str, stack: &str) -> Report {
    Report { kind: "webview".into(), name: Some(name_of(name).into()), at: Some(at_of(label).into()), frames: frames_of(stack), n: 1, ..Default::default() }
}

// ── 쌓기 ──

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Outbox {
    pub r: BTreeMap<String, Report>,
}

static LOCK: Mutex<()> = Mutex::new(());

pub fn load(dir: &Path) -> Outbox {
    std::fs::read_to_string(dir.join(OUTBOX)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(dir: &Path, o: &Outbox) {
    let file = dir.join(OUTBOX);
    if o.r.is_empty() {
        let _ = std::fs::remove_file(&file);
        return;
    }
    let Ok(text) = serde_json::to_string(o) else { return };
    if crate::accounts::write_atomic(&file, &(text + "\n")).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
        }
    }
}

/// 한 건 쌓기 — 모양이 틀리면 버린다. 같은 오류면 개수만, 서로 다른 오류가 상한이면 버린다.
/// wait=false(panic 훅)면 잠금을 기다리지 않는다 — 같은 스레드가 쥔 채 panic 했으면 멈추지 않고 그냥 놓친다
pub fn push(dir: &Path, r: Report, wait: bool) -> bool {
    if !valid(&r) {
        return false;
    }
    let _g = if wait {
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    } else {
        match LOCK.try_lock() {
            Ok(g) => g,
            Err(std::sync::TryLockError::Poisoned(e)) => e.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => return false,
        }
    };
    let mut o = load(dir);
    let k = r.key();
    if let Some(cur) = o.r.get_mut(&k) {
        cur.n = (cur.n + r.n).min(MAX_N);
    } else if o.r.len() < MAX_ENTRIES {
        o.r.insert(k, r);
    } else {
        return false;
    }
    save(dir, &o);
    true
}

pub fn clear(dir: &Path) {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _ = std::fs::remove_file(dir.join(OUTBOX));
}

/// 쌓인 오류 개수 — 시험용
#[cfg(test)]
pub fn count_in(o: &Outbox) -> u32 {
    o.r.values().map(|r| r.n).sum()
}

// ── 관문 ──

/// 앱 이름표 — 켤 때 한 번(main). 그 전에 난 panic 은 안 센다
static APP: OnceLock<(String, String, String)> = OnceLock::new();

pub fn init(identifier: String, product: String, version: String) {
    let _ = APP.set((identifier, product, version));
}

pub fn before_start(today: &str) -> bool {
    today < START
}

/// 지금 쌓아도 되나 — 끔·개인판·첫 안내 전·디버그·시험 폴더·시행일 전이면 안 쌓는다(동의 전 오류는 버린다)
pub fn open(gate: &crate::usage_ping::Gate, today: &str) -> bool {
    crate::usage_ping::blocked(gate).is_none() && (gate.test || !before_start(today))
}

fn now_day() -> String {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    crate::usage_ping::utc_day(ms)
}

fn test_mode() -> bool {
    cfg!(debug_assertions) && std::env::var("CHAMMO_CRASH_TEST").is_ok_and(|v| v == "1")
}

fn gate_of(c: &crate::config::Config, app: &(String, String, String)) -> crate::usage_ping::Gate {
    crate::usage_ping::Gate {
        on: c.features.usage_ping,
        identifier: app.0.clone(),
        product: app.1.clone(),
        debug: cfg!(debug_assertions),
        real_data: crate::config::is_real_data(&crate::config::home(), crate::config::data_dir()),
        setup_done: c.setup_done,
        test: test_mode(),
    }
}

/// panic 훅에서 — 설정 잠금도 기다리지 않는다(try_current). 이 함수 안에선 panic 하지 않게 unwrap 을 안 쓴다
pub fn on_panic(info: &std::panic::PanicHookInfo) {
    let Some(app) = APP.get() else { return };
    let Some(c) = crate::config::try_current() else { return };
    if !open(&gate_of(&c, app), &now_day()) {
        return;
    }
    let msg = info.payload().downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| info.payload().downcast_ref::<String>().cloned()).unwrap_or_default();
    let (file, line, col) = info.location().map(|l| (l.file(), l.line(), l.column())).unwrap_or(("", 0, 0));
    push(crate::config::data_dir(), panic_report(file, line, col, &msg), false);
}

/// 화면이 ErrorBoundary 로 멈췄을 때(debug::ui_crash)
pub fn on_webview(label: &str, name: &str, stack: &str) {
    let Some(app) = APP.get() else { return };
    if !open(&gate_of(&crate::config::current(), app), &now_day()) {
        return;
    }
    push(crate::config::data_dir(), webview_report(label, name, stack), true);
}

// ── 보내기 ──

/// 보낼 몸통 — 판·OS·CPU·배포 구분 + 보고 묶음(언어는 안 싣는다 — 쓸 데가 없다)
pub fn body(version: &str, ch: &str, reports: &[Report]) -> Value {
    json!({ "v": version, "os": crate::usage_ping::os_name(), "arch": std::env::consts::ARCH, "ch": ch, "r": reports })
}

/// 몸통 전체가 약속한 칸만인가 — 보내기 직전 마지막 검사
pub fn valid_body(b: &Value) -> bool {
    let Some(o) = b.as_object() else { return false };
    let keys: Vec<&str> = o.keys().map(String::as_str).collect();
    let mut want = BODY_KEYS.to_vec();
    want.sort_unstable();
    let mut got = keys.clone();
    got.sort_unstable();
    if got != want {
        return false;
    }
    let s = |k: &str| o.get(k).and_then(Value::as_str).unwrap_or("");
    let ver = s("v").split('.').collect::<Vec<_>>();
    let ver_ok = ver.len() == 3 && ver.iter().all(|p| digits(p, 4));
    let Some(list) = o.get("r").and_then(Value::as_array) else { return false };
    ver_ok
        && ["mac", "win"].contains(&s("os"))
        && ["aarch64", "x86_64"].contains(&s("arch"))
        && ["release", "internal"].contains(&s("ch"))
        && (1..=BATCH).contains(&list.len())
        && list.iter().all(|r| {
            r.as_object().is_some_and(|m| m.keys().all(|k| REPORT_KEYS.contains(&k.as_str())))
                && serde_json::from_value::<Report>(r.clone()).is_ok_and(|x| valid(&x) && serde_json::to_value(&x).ok().as_ref() == Some(r))
        })
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Blocked,
    Empty,
    /// 다른 중계를 쓴다 — 안 보낸다
    OtherServer,
    Sent(u16, usize),
    /// 못 보냄 — 남겨 두고 다음에
    Kept(String),
}

pub struct Base<'a> {
    pub version: &'a str,
    pub ch: &'a str,
    /// team.json server 가 기본 중계인가
    pub default_server: bool,
}

/// 한 바퀴 — 관문이 닫혔으면(끔 포함) 쌓인 걸 비운다. 모양이 틀린 건 버리고 나머지를 묶어 보낸다.
/// 2xx 면 보낸 개수만큼 빼고, 400·413·422(중계가 안 받는 모양)면 그 묶음을 버린다. 그 밖(끊김·429·5xx)은 남긴다
pub fn tick(dir: &Path, open_now: bool, b: &Base, send: impl FnOnce(&str, &str) -> Result<u16, String>) -> Outcome {
    if !open_now {
        clear(dir);
        return Outcome::Blocked;
    }
    if !b.default_server {
        return Outcome::OtherServer;
    }
    let batch: Vec<(String, Report)> = {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut o = load(dir);
        let before = o.r.len();
        o.r.retain(|_, r| valid(r));
        if o.r.len() != before {
            save(dir, &o);
        }
        o.r.into_iter().take(BATCH).collect()
    };
    if batch.is_empty() {
        return Outcome::Empty;
    }
    let reports: Vec<Report> = batch.iter().map(|(_, r)| r.clone()).collect();
    let body = body(b.version, b.ch, &reports);
    if !valid_body(&body) {
        // 판·언어 같은 바깥 칸이 틀렸다 — 보고는 그대로 두고 안 보낸다
        return Outcome::Kept("body".into());
    }
    match send(URL, &body.to_string()) {
        Ok(code) if (200..300).contains(&code) || matches!(code, 400 | 413 | 422) => {
            let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let mut o = load(dir);
            for (k, sent) in &batch {
                // 보내는 사이 같은 오류가 또 났으면 그만큼만 남긴다
                let left = o.r.get(k).map(|cur| cur.n.saturating_sub(sent.n)).unwrap_or(0);
                if left == 0 {
                    o.r.remove(k);
                } else if let Some(cur) = o.r.get_mut(k) {
                    cur.n = left;
                }
            }
            save(dir, &o);
            Outcome::Sent(code, batch.len())
        }
        Ok(code) => Outcome::Kept(code.to_string()),
        Err(e) => Outcome::Kept(e),
    }
}

/// 뒤 스레드 — 켤 때 1분 뒤 한 번, 그 뒤 10분마다. 설정은 매번 다시 읽어 끄면 바로 비운다
pub fn start() {
    std::thread::spawn(|| {
        let test = test_mode();
        let every = std::time::Duration::from_secs(if test { 5 } else { 600 });
        std::thread::sleep(std::time::Duration::from_secs(if test { 2 } else { 60 }));
        loop {
            if let Some(app) = APP.get() {
                let c = crate::config::current();
                let dir = crate::config::data_dir();
                let server = crate::team_relay::load_state(dir).server;
                let b = Base {
                    version: &app.2,
                    ch: crate::usage_ping::channel_of(&c.ping_channel),
                    default_server: crate::team_relay::server_or_default(&server).trim_end_matches('/') == crate::team_relay::DEFAULT_SERVER,
                };
                let url = std::env::var("CHAMMO_CRASH_URL").ok().filter(|_| test);
                let send = |u: &str, body: &str| crate::usage_ping::post(url.as_deref().unwrap_or(u), body);
                match tick(dir, open(&gate_of(&c, app), &now_day()), &b, send) {
                    Outcome::Sent(code, n) => crate::claude::log_out("crash", &format!("sent {code} n={n}")),
                    Outcome::Kept(why) => crate::claude::log_out("crash", &format!("kept {why}")),
                    _ => {}
                }
            }
            std::thread::sleep(every);
        }
    });
}

#[cfg(test)]
#[path = "crash_report_tests.rs"]
mod tests;
