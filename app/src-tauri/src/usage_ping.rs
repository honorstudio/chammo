//! 익명 사용 신호 — 몇 대가 어느 나라·어떤 기기에서 Chammo 를 켜나(처리방침 chammo.app/privacy '익명 사용 통계', 서버는 chammo-relay /v0/ping).
//! - 하루 한 번(켤 때, 켜 둔 채 날이 바뀌면 그때) `POST <중계>/v0/ping`. 날은 UTC — 서버가 하루 한 줄로 묶는 날과 같게
//! - 몸통은 처리방침에 적은 여섯 칸(id·v·os·arch·lang·ch) + 시행일(START_V2)부터 v2 칸(개수와 정해 둔 이름만, usage_counts.rs).
//!   데이터 폴더 경로·이름·세션·대화는 절대 안 넣는다 — 시험이 키 목록을 고정
//! - 설치 번호는 32 hex 무작위, `<데이터>/ping.json`(600). 기록을 먼저 쓰고 보낸다 — 실패는 조용히, 다시 시도는 다음 날
//! - 안 보냄: 설정 끔 · 개인판(식별자·이름이 공개판이 아님) · 디버그 빌드 · 시험 데이터 폴더(CHAMMO_HOME) · 첫 안내 전
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

pub const STATE_FILE: &str = "ping.json";
/// 공개판(tauri.conf.json) — 개인판(tauri.private.json, Chammo Dev)은 식별자·이름이 달라서 안 보낸다
pub const PUBLIC_ID: &str = "app.chammo.desktop";
pub const PUBLIC_NAME: &str = "Chammo";
/// 몸통 칸 — 서버와의 약속. 늘리려면 chammo-relay 와 먼저 맞춘다
pub const KEYS: [&str; 6] = ["id", "v", "os", "arch", "lang", "ch"];
/// v2 칸 — 처리방침 '익명 사용 통계' 더한 항목(chammo.app/privacy). 서버가 정해 둔 칸만 받는다
pub const V2_KEYS: [&str; 7] = ["on", "use", "sess", "crash", "cc", "upd", "up"];
/// v2 칸 시행일(처리방침 게시 7일 뒤, UTC) — 이 날 전엔 여섯 칸만
pub const START_V2: &str = "2026-11-01";

pub fn v2_on(today: &str) -> bool {
    today >= START_V2
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PingState {
    /// 설치 번호(32 hex)
    pub id: String,
    /// 마지막으로 보낸(보내려 한) 날, UTC YYYY-MM-DD
    pub last_day: String,
}

/// 보낼지 가르는 것들
#[derive(Clone, Debug)]
pub struct Gate {
    /// 설정 > 기능 '익명 사용 통계'
    pub on: bool,
    pub identifier: String,
    pub product: String,
    pub debug: bool,
    /// 진짜 데이터 폴더(~/.chammo·~/.honor-orchestrator)인가
    pub real_data: bool,
    /// 첫 실행 안내를 끝냈나 — 안내의 '익명 사용 통계' 한 줄을 보기 전엔 안 보낸다
    pub setup_done: bool,
    /// 개발판 실측(CHAMMO_PING_TEST) — 디버그·시험 폴더 관문만 넘는다. 릴리스 빌드에선 늘 false
    pub test: bool,
}

/// 안 보내는 까닭(보내면 None)
pub fn blocked(g: &Gate) -> Option<&'static str> {
    if !g.on {
        return Some("off");
    }
    if g.identifier != PUBLIC_ID || g.product != PUBLIC_NAME {
        return Some("private");
    }
    if !g.setup_done {
        return Some("setup");
    }
    if g.test {
        return None;
    }
    if g.debug {
        return Some("debug");
    }
    if !g.real_data {
        return Some("test-data");
    }
    None
}

pub fn valid_id(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn new_id() -> Result<String, String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).map_err(|e| e.to_string())?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

pub fn os_name() -> &'static str {
    if cfg!(windows) { "win" } else { "mac" }
}

/// 설정 언어 → ko | en
pub fn lang_of(language: &str) -> &'static str {
    if language.trim() == "ko" { "ko" } else { "en" }
}

/// 숨은 설정 pingChannel — "internal" 만 내부 시험 기기, 나머지는 release
pub fn channel_of(ping_channel: &str) -> &'static str {
    if ping_channel.trim() == "internal" { "internal" } else { "release" }
}

/// 보낼 몸통 — 처리방침에 적은 여섯 칸만
pub fn body(id: &str, version: &str, os: &str, arch: &str, lang: &str, ch: &str) -> Value {
    json!({ "id": id, "v": version, "os": os, "arch": arch, "lang": lang, "ch": ch })
}

/// 날짜(UTC YYYY-MM-DD)
pub fn utc_day(ms: u64) -> String {
    crate::direct::iso_of_ms(ms)[..10].to_string()
}

pub fn load(dir: &Path) -> PingState {
    std::fs::read_to_string(dir.join(STATE_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(dir: &Path, st: &PingState) -> Result<(), String> {
    let file = dir.join(STATE_FILE);
    let text = serde_json::to_string_pretty(st).map_err(|e| e.to_string())? + "\n";
    crate::accounts::write_atomic(&file, &text).map_err(|e| format!("{e:?}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 한 번 볼 때의 결과
#[derive(Debug, PartialEq)]
pub enum Outcome {
    Blocked(&'static str),
    /// 오늘 이미 보냈다
    NotDue,
    /// 기록을 못 써서 안 보냄 — 쓰지 못한 채 보내면 10분마다 보내게 된다
    NoState(String),
    Sent(u16),
    Failed(String),
}

/// 보낼 것 — (주소, 몸통). 설치 번호는 tick 이 채운다
pub struct Payload<'a> {
    pub url: &'a str,
    pub version: &'a str,
    pub os: &'a str,
    pub arch: &'a str,
    pub lang: &'a str,
    pub ch: &'a str,
    /// 켜 둔 기능 스위치 이름(usage_counts::on_list)
    pub on: &'a [&'a str],
}

/// 관문 → 기록(설치 번호·오늘) 먼저 쓰기 → 보내기. send 는 (주소, 몸통 글) → 응답 코드
pub fn tick(dir: &Path, gate: &Gate, today: &str, p: &Payload, send: impl FnOnce(&str, &str) -> Result<u16, String>) -> Outcome {
    if let Some(why) = blocked(gate) {
        return Outcome::Blocked(why);
    }
    let mut st = load(dir);
    if valid_id(&st.id) && st.last_day == today {
        return Outcome::NotDue;
    }
    if !valid_id(&st.id) {
        match new_id() {
            Ok(id) => st.id = id,
            Err(e) => return Outcome::NoState(e),
        }
    }
    st.last_day = today.to_string();
    if let Err(e) = save(dir, &st) {
        return Outcome::NoState(e);
    }
    let mut b = body(&st.id, p.version, p.os, p.arch, p.lang, p.ch);
    // 시행일부터 v2 칸 — 실은 카운터는 서버가 받으면(2xx) 보낸 만큼 뺀다. 못 보내면 다음 날 같이
    let counts = v2_on(today).then(|| crate::usage_counts::load(dir));
    if let (Some(c), Some(o)) = (&counts, b.as_object_mut()) {
        o.extend(crate::usage_counts::fields(c, p.on));
    }
    match send(p.url, &b.to_string()) {
        Ok(code) => {
            if let (Some(c), true) = (&counts, (200..300).contains(&code)) {
                crate::usage_counts::sent(dir, c);
            }
            Outcome::Sent(code)
        }
        Err(e) => Outcome::Failed(e),
    }
}

/// 중계 주소 — team.json server(설정·`scripts/team --server` 와 같은 자리), 없으면 기본 relay.chammo.app. 이상한 주소면 None
pub fn url_for(dir: &Path) -> Option<String> {
    let st = crate::team_relay::load_state(dir);
    crate::team_relay::server_ok(crate::team_relay::server_or_default(&st.server)).map(|s| format!("{s}/v0/ping"))
}

/// curl 한 번, 짧게(5초). 몸통은 stdin 으로, 응답 끝 줄이 코드
fn post(url: &str, body: &str) -> Result<u16, String> {
    use std::io::Write;
    let prog = if cfg!(target_os = "macos") { "/usr/bin/curl" } else { "curl" };
    let mut c = crate::platform::command(prog);
    c.args(["-sS", "--max-time", "5", "--proto", "=https,http", "-X", "POST", "-H", "Content-Type: application/json", "--data-binary", "@-", "-w", "\n%{http_code}", url]);
    c.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    child.stdin.take().ok_or("no stdin")?.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    match text.rsplit('\n').next().unwrap_or("").trim().parse::<u16>() {
        Ok(0) | Err(_) => Err("no answer".into()),
        Ok(code) => Ok(code),
    }
}

/// 처리방침 '익명 사용 통계' 항목 시행일(chammo.app/privacy, 7일 전 알림) — 이 날 전(UTC)엔 공개판도 보내지 않는다
pub const START_DAY: &str = "2026-10-31";

pub fn before_start(today: &str) -> bool {
    today < START_DAY
}

/// 개발판 실측 표시 — 디버그 빌드에서만 읽는다
fn test_mode() -> bool {
    cfg!(debug_assertions) && std::env::var("CHAMMO_PING_TEST").is_ok_and(|v| v == "1")
}

/// 뒤 스레드 — 켤 때 한 번, 그 뒤 10분마다 날이 바뀌었나 본다. 설정은 매번 다시 읽어 끄면 바로 멈춘다
pub fn start(identifier: String, product: String, version: String) {
    std::thread::spawn(move || {
        let test = test_mode();
        let every = std::time::Duration::from_secs(if test { 5 } else { 600 });
        loop {
            let c = crate::config::current();
            let dir = crate::config::data_dir();
            let gate = Gate {
                on: c.features.usage_ping,
                identifier: identifier.clone(),
                product: product.clone(),
                debug: cfg!(debug_assertions),
                real_data: crate::config::is_real_data(&crate::config::home(), dir),
                setup_done: c.setup_done,
                test,
            };
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
            // 켜 둔 시간 — 바퀴마다(10분) 더한다. 끄면 세지 않는다
            if gate.on {
                crate::usage_counts::uptime(dir, every.as_secs());
            }
            if before_start(&utc_day(now)) && !test {
                std::thread::sleep(every);
                continue;
            }
            if let Some(url) = url_for(dir) {
                let on = crate::usage_counts::on_list(&c.features);
                let p = Payload {
                    url: &url,
                    version: &version,
                    os: os_name(),
                    arch: std::env::consts::ARCH,
                    lang: lang_of(&c.language),
                    ch: channel_of(&c.ping_channel),
                    on: &on,
                };
                match tick(dir, &gate, &utc_day(now), &p, post) {
                    Outcome::Sent(code) => crate::claude::log_out("ping", &format!("sent {code}")),
                    Outcome::Failed(_) => crate::claude::log_out("ping", "failed — next day"),
                    Outcome::NoState(e) => crate::claude::log_out("ping", &format!("no state: {e}")),
                    Outcome::Blocked(_) | Outcome::NotDue => {}
                }
            }
            std::thread::sleep(every);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 처리방침_시행일_전엔_안_보낸다() {
        assert!(before_start("2026-10-24"));
        assert!(before_start("2026-10-30"));
        assert!(!before_start("2026-10-31"));
        assert!(!before_start("2026-11-01"));
    }

    fn gate() -> Gate {
        Gate { on: true, identifier: PUBLIC_ID.into(), product: PUBLIC_NAME.into(), debug: false, real_data: true, setup_done: true, test: false }
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-ping-{name}-{}", crate::tools::tmp_tag()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn payload() -> Payload<'static> {
        Payload { url: "https://relay.chammo.app/v0/ping", version: "0.4.1", os: "mac", arch: "aarch64", lang: "ko", ch: "release", on: &["office", "voice"] }
    }

    // ── v2 칸(처리방침 시행일 START_V2 부터) ──

    #[test]
    fn v2_칸_목록에_setup_은_없다() {
        assert_eq!(V2_KEYS, ["on", "use", "sess", "crash", "cc", "upd", "up"]);
    }

    #[test]
    fn v2_칸은_시행일부터() {
        assert!(!v2_on("2026-10-31"));
        assert!(v2_on(START_V2));
        assert!(v2_on("2026-12-01"));
    }

    fn sent_body(d: &std::path::Path, day: &str, code: u16) -> (Outcome, Value) {
        let mut seen = String::new();
        let r = tick(d, &gate(), day, &payload(), |_, b| {
            seen = b.to_string();
            Ok(code)
        });
        (r, serde_json::from_str(&seen).unwrap_or(Value::Null))
    }

    #[test]
    fn 시행일_전엔_여섯_칸_그대로_카운터도_그대로() {
        let d = tmp("v2-before");
        crate::usage_counts::used(&d, "office");
        let (r, b) = sent_body(&d, "2026-10-31", 204);
        assert_eq!(r, Outcome::Sent(204));
        let keys: Vec<&str> = b.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, KEYS);
        assert_eq!(crate::usage_counts::load(&d).uses.get("office"), Some(&1), "안 실었으니 안 뺀다");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 시행일부터_v2_칸을_싣고_성공하면_보낸_만큼_뺀다() {
        let d = tmp("v2-after");
        crate::usage_counts::used(&d, "office");
        crate::usage_counts::used(&d, "mode");
        crate::usage_counts::session_started(&d, 1);
        crate::usage_counts::note_cc(&d, "2.1.310 (Claude Code)");
        let (r, b) = sent_body(&d, START_V2, 204);
        assert_eq!(r, Outcome::Sent(204));
        let keys: Vec<&str> = b.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, [&KEYS[..], &V2_KEYS[..]].concat());
        assert_eq!(b["use"], json!({ "office": 1, "mode": 1 }));
        assert_eq!(b["on"], json!(["office", "voice"]));
        assert_eq!(b["cc"], json!("2.1.310"));
        assert!(b.get("setup").is_none(), "setup 은 안 싣는다");
        assert!(!b.to_string().contains('/'), "{b}");
        let c = crate::usage_counts::load(&d);
        assert!(c.uses.is_empty() && c.started == 0, "{c:?}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 못_보내거나_서버가_거절하면_카운터를_남긴다() {
        let d = tmp("v2-fail");
        crate::usage_counts::used(&d, "phone");
        let r = tick(&d, &gate(), START_V2, &payload(), |_, _| Err("timeout".into()));
        assert_eq!(r, Outcome::Failed("timeout".into()));
        assert_eq!(crate::usage_counts::load(&d).uses.get("phone"), Some(&1));
        let (r, _) = sent_body(&d, "2026-11-02", 400);
        assert_eq!(r, Outcome::Sent(400));
        assert_eq!(crate::usage_counts::load(&d).uses.get("phone"), Some(&1), "400 이면 안 뺀다");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 끄면_새_칸도_안_나가고_카운터도_안_건드린다() {
        let d = tmp("v2-off");
        crate::usage_counts::used(&d, "craft");
        let r = tick(&d, &Gate { on: false, ..gate() }, START_V2, &payload(), |_, _| panic!("보내면 안 됨"));
        assert_eq!(r, Outcome::Blocked("off"));
        assert_eq!(crate::usage_counts::load(&d).uses.get("craft"), Some(&1));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 칸이_다_차도_1kb_안() {
        let d = tmp("v2-full");
        for k in crate::usage_counts::USE_KEYS {
            for _ in 0..1000 {
                crate::usage_counts::used(&d, k);
            }
        }
        for k in crate::usage_counts::CRASH_KINDS {
            for _ in 0..100 {
                crate::usage_counts::crashed(&d, k);
            }
        }
        crate::usage_counts::agents_now(&d, 99);
        crate::usage_counts::update_failed(&d, "restart");
        crate::usage_counts::uptime(&d, 99 * 3600);
        crate::usage_counts::note_cc(&d, "999.999.9999");
        let all = crate::usage_counts::ON_KEYS;
        let p = Payload { on: &all, ..payload() };
        let mut seen = String::new();
        tick(&d, &gate(), START_V2, &p, |_, b| {
            seen = b.to_string();
            Ok(204)
        });
        assert!(seen.len() < 1024, "{} 바이트", seen.len());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 몸통은_약속의_여섯_칸만() {
        let b = body("0123456789abcdef0123456789abcdef", "0.4.1", "mac", "aarch64", "ko", "release");
        let keys: Vec<&str> = b.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, KEYS);
        assert!(b.to_string().len() < 1024, "서버 몸통 제한 1KB");
    }

    #[test]
    fn 보낸_몸통에_경로나_이름이_안_들어간다() {
        let d = tmp("body");
        let mut seen = String::new();
        let r = tick(&d, &gate(), "2026-10-24", &payload(), |_, b| {
            seen = b.to_string();
            Ok(204)
        });
        assert_eq!(r, Outcome::Sent(204));
        let v: Value = serde_json::from_str(&seen).unwrap();
        let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, KEYS);
        assert!(!seen.contains('/') && !seen.contains(&crate::config::home()), "{seen}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 관문() {
        assert_eq!(blocked(&gate()), None);
        assert_eq!(blocked(&Gate { on: false, ..gate() }), Some("off"));
        // 개인판(tauri.private.json) — 식별자 com.honorstudio.honor-orchestrator, 이름 Chammo Dev
        assert_eq!(blocked(&Gate { identifier: "com.honorstudio.honor-orchestrator".into(), ..gate() }), Some("private"));
        assert_eq!(blocked(&Gate { product: "Chammo Dev".into(), ..gate() }), Some("private"));
        assert_eq!(blocked(&Gate { debug: true, ..gate() }), Some("debug"));
        assert_eq!(blocked(&Gate { real_data: false, ..gate() }), Some("test-data"));
        assert_eq!(blocked(&Gate { setup_done: false, ..gate() }), Some("setup"));
        // 개발판 실측은 디버그·시험 폴더만 넘는다 — 끔·개인판·첫 안내 전은 그대로 막힘
        let t = Gate { test: true, debug: true, real_data: false, ..gate() };
        assert_eq!(blocked(&t), None);
        assert_eq!(blocked(&Gate { on: false, ..t.clone() }), Some("off"));
        assert_eq!(blocked(&Gate { product: "Chammo Dev".into(), ..t.clone() }), Some("private"));
        assert_eq!(blocked(&Gate { setup_done: false, ..t }), Some("setup"));
    }

    #[test]
    fn 막히면_보내지도_기록하지도_않는다() {
        let d = tmp("blocked");
        for g in [Gate { on: false, ..gate() }, Gate { debug: true, ..gate() }, Gate { real_data: false, ..gate() }, Gate { product: "Chammo Dev".into(), ..gate() }] {
            let r = tick(&d, &g, "2026-10-24", &payload(), |_, _| panic!("보내면 안 됨"));
            assert!(matches!(r, Outcome::Blocked(_)), "{r:?}");
        }
        assert!(!d.join(STATE_FILE).exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 하루_한_번_날이_바뀌면_다시() {
        let d = tmp("daily");
        let mut n = 0;
        let mut go = |day: &str| tick(&d, &gate(), day, &payload(), |_, _| { n += 1; Ok(204) });
        assert_eq!(go("2026-10-24"), Outcome::Sent(204));
        assert_eq!(go("2026-10-24"), Outcome::NotDue);
        assert_eq!(go("2026-10-25"), Outcome::Sent(204));
        assert_eq!(n, 2);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 실패해도_그날은_다시_안_보낸다() {
        let d = tmp("fail");
        let r = tick(&d, &gate(), "2026-10-24", &payload(), |_, _| Err("timeout".into()));
        assert_eq!(r, Outcome::Failed("timeout".into()));
        assert_eq!(tick(&d, &gate(), "2026-10-24", &payload(), |_, _| panic!("또 보냄")), Outcome::NotDue);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 설치_번호는_한_번_만들고_계속_쓴다_600() {
        let d = tmp("id");
        let mut ids = vec![];
        for day in ["2026-10-24", "2026-10-25"] {
            tick(&d, &gate(), day, &payload(), |_, b| {
                ids.push(serde_json::from_str::<Value>(b).unwrap()["id"].as_str().unwrap().to_string());
                Ok(204)
            });
        }
        assert!(valid_id(&ids[0]), "{}", ids[0]);
        assert_eq!(ids[0], ids[1]);
        assert_eq!(load(&d), PingState { id: ids[0].clone(), last_day: "2026-10-25".into() });
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(d.join(STATE_FILE)).unwrap().permissions().mode() & 0o777, 0o600);
        }
        // 깨진 번호는 새로
        std::fs::write(d.join(STATE_FILE), r#"{"id":"../../x","lastDay":"2026-10-25"}"#).unwrap();
        let r = tick(&d, &gate(), "2026-10-25", &payload(), |_, _| Ok(204));
        assert_eq!(r, Outcome::Sent(204));
        assert!(valid_id(&load(&d).id));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 기록을_못_쓰면_안_보낸다() {
        let d = tmp("ro").join("없는 폴더 아래 파일이 아니라 파일 자리");
        std::fs::write(&d, "x").unwrap(); // 폴더 자리에 파일 — 그 아래 ping.json 을 못 쓴다
        let r = tick(&d, &gate(), "2026-10-24", &payload(), |_, _| panic!("보내면 안 됨"));
        assert!(matches!(r, Outcome::NoState(_)), "{r:?}");
        let _ = std::fs::remove_file(&d);
    }

    #[test]
    fn 칸_값() {
        assert_eq!(channel_of("internal"), "internal");
        assert_eq!(channel_of(""), "release");
        assert_eq!(channel_of("beta"), "release");
        assert_eq!(lang_of("ko"), "ko");
        assert_eq!(lang_of("en"), "en");
        assert_eq!(lang_of(""), "en");
        assert_eq!(utc_day(0), "1970-01-01");
        assert_eq!(utc_day(1_792_800_000_000), "2026-10-24");
        assert!(valid_id(&new_id().unwrap()));
        assert!(!valid_id("0123456789ABCDEF0123456789ABCDEF"));
    }

    #[test]
    fn 주소는_team_json_server_없으면_기본_중계() {
        let d = tmp("url");
        assert_eq!(url_for(&d).as_deref(), Some("https://relay.chammo.app/v0/ping"));
        std::fs::write(d.join(crate::team_relay::STATE_FILE), r#"{"server":"https://relay.example.org/"}"#).unwrap();
        assert_eq!(url_for(&d).as_deref(), Some("https://relay.example.org/v0/ping"));
        std::fs::write(d.join(crate::team_relay::STATE_FILE), r#"{"server":"http://evil.example.org"}"#).unwrap();
        assert_eq!(url_for(&d), None);
        let _ = std::fs::remove_dir_all(&d);
    }
}
