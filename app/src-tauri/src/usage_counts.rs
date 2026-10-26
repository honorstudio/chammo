//! 익명 사용 신호 v2 카운터 — 지난번 보낸 뒤 몇 번 썼나만 센다(usage_ping.rs 가 하루 한 번 실어 보내고 보낸 만큼 뺀다)
//! - `<데이터>/usage.json`(600). 개수와 정해 둔 이름만 — 내용·경로·세션 이름·오류 문구는 절대 안 담는다
//! - 이름은 아래 목록 밖이면 버린다. 칸마다 상한(use 999·sess 999/99·crash·upd 99)에서 멈춘다
//! - 설정 '익명 사용 통계'를 끄면 세지도 않는다(record_*)
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

pub const FILE: &str = "usage.json";
/// 기능별 쓰임 — 사무실 열기·메신저 열기·Craft 앱 열기·음성 쓰기·폰 연결·모드 켜기
pub const USE_KEYS: [&str; 6] = ["office", "messenger", "craft", "voice", "phone", "mode"];
/// 앱이 죽은/오류 종류 — 이 넷만
pub const CRASH_KINDS: [&str; 4] = ["panic", "webview", "pty", "updater"];
/// 업데이트 실패 단계
pub const UPD_STAGES: [&str; 3] = ["download", "unpack", "restart"];
/// 켜 둔 기능 스위치 — 설정 이름(camelCase) 그대로, usagePing 은 넣지 않는다
pub const ON_KEYS: [&str; 9] = ["office", "tama", "gacha", "review", "voice", "autoRevive", "autoTidy", "agentView", "computerUse"];
const USE_MAX: u32 = 999;
const STARTED_MAX: u32 = 999;
const PEAK_MAX: u32 = 99;
const SMALL_MAX: u32 = 99;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Counts {
    pub uses: BTreeMap<String, u32>,
    pub started: u32,
    pub peak: u32,
    pub crash: BTreeMap<String, u32>,
    pub upd_ok: u32,
    pub upd_fail: u32,
    pub upd_at: String,
    pub up_secs: u64,
    /// 마지막으로 본 Claude Code 판(숫자·점만) — 보낸 뒤에도 남긴다
    pub cc: String,
}

static LOCK: Mutex<()> = Mutex::new(());

pub fn load(dir: &Path) -> Counts {
    std::fs::read_to_string(dir.join(FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(dir: &Path, c: &Counts) -> Result<(), String> {
    let file = dir.join(FILE);
    let text = serde_json::to_string(c).map_err(|e| e.to_string())? + "\n";
    crate::accounts::write_atomic(&file, &text).map_err(|e| format!("{e:?}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 읽고 고치고 쓰기를 한 번에(스레드 여럿이 세도 안 잃게)
pub fn bump(dir: &Path, f: impl FnOnce(&mut Counts)) {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut c = load(dir);
    f(&mut c);
    let _ = save(dir, &c);
}

fn add(m: &mut BTreeMap<String, u32>, k: &str, max: u32) {
    let v = m.entry(k.to_string()).or_insert(0);
    *v = (*v + 1).min(max);
}

pub fn used(dir: &Path, key: &str) {
    if USE_KEYS.contains(&key) {
        bump(dir, |c| add(&mut c.uses, key, USE_MAX));
    }
}
pub fn session_started(dir: &Path, n: usize) {
    if n > 0 {
        bump(dir, |c| c.started = (c.started + n as u32).min(STARTED_MAX));
    }
}
pub fn agents_now(dir: &Path, n: usize) {
    let n = (n as u32).min(PEAK_MAX);
    if n > load(dir).peak {
        bump(dir, |c| c.peak = c.peak.max(n));
    }
}
pub fn crashed(dir: &Path, kind: &str) {
    if CRASH_KINDS.contains(&kind) {
        bump(dir, |c| add(&mut c.crash, kind, SMALL_MAX));
    }
}
pub fn update_ok(dir: &Path) {
    bump(dir, |c| c.upd_ok = (c.upd_ok + 1).min(SMALL_MAX));
}
pub fn update_failed(dir: &Path, stage: &str) {
    if UPD_STAGES.contains(&stage) {
        bump(dir, |c| {
            c.upd_fail = (c.upd_fail + 1).min(SMALL_MAX);
            c.upd_at = stage.to_string();
        });
    }
}
pub fn uptime(dir: &Path, secs: u64) {
    bump(dir, |c| c.up_secs = c.up_secs.saturating_add(secs).min(30 * 86400));
}

/// `claude --version` 첫 줄("2.1.310 (Claude Code)")에서 판 번호만. 모양이 아니면 None
pub fn cc_of(raw: &str) -> Option<String> {
    let v = raw.split_whitespace().next()?;
    let parts: Vec<&str> = v.split('.').collect();
    let ok = parts.len() == 3 && parts.iter().zip([3, 3, 4]).all(|(p, max)| !p.is_empty() && p.len() <= max && p.bytes().all(|b| b.is_ascii_digit()));
    ok.then(|| v.to_string())
}
pub fn note_cc(dir: &Path, raw: &str) {
    if let Some(v) = cc_of(raw) {
        if load(dir).cc != v {
            bump(dir, |c| c.cc = v);
        }
    }
}

/// 켜 둔 시간 구간
pub fn up_band(secs: u64) -> &'static str {
    match secs {
        s if s < 3600 => "<1h",
        s if s < 4 * 3600 => "1-4h",
        s if s < 8 * 3600 => "4-8h",
        _ => "8h+",
    }
}

/// 켜 둔 기능 스위치 이름 — 설정 순서 그대로, 켜진 것만
pub fn on_list(f: &crate::config::Features) -> Vec<&'static str> {
    let flags = [f.office, f.tama, f.gacha, f.review, f.voice, f.auto_revive, f.auto_tidy, f.agent_view, f.computer_use];
    ON_KEYS.iter().zip(flags).filter(|(_, on)| *on).map(|(k, _)| *k).collect()
}

/// v2 칸 — 0 인 칸은 뺀다
pub fn fields(c: &Counts, on: &[&str]) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("on".into(), json!(on.iter().filter(|k| ON_KEYS.contains(k)).collect::<Vec<_>>()));
    let uses: Map<String, Value> = USE_KEYS.iter().filter_map(|k| c.uses.get(*k).filter(|n| **n > 0).map(|n| (k.to_string(), json!(n.min(&USE_MAX))))).collect();
    m.insert("use".into(), Value::Object(uses));
    m.insert("sess".into(), json!({ "started": c.started.min(STARTED_MAX), "peak": c.peak.min(PEAK_MAX) }));
    let kinds: Map<String, Value> = CRASH_KINDS.iter().filter_map(|k| c.crash.get(*k).filter(|n| **n > 0).map(|n| (k.to_string(), json!(n.min(&SMALL_MAX))))).collect();
    let n: u32 = kinds.values().filter_map(Value::as_u64).map(|v| v as u32).sum();
    m.insert("crash".into(), json!({ "n": n, "kind": kinds }));
    if cc_of(&c.cc).is_some() {
        m.insert("cc".into(), json!(c.cc));
    }
    let mut upd = json!({ "ok": c.upd_ok.min(SMALL_MAX), "fail": c.upd_fail.min(SMALL_MAX) });
    if c.upd_fail > 0 && UPD_STAGES.contains(&c.upd_at.as_str()) {
        upd["at"] = json!(c.upd_at);
    }
    m.insert("upd".into(), upd);
    m.insert("up".into(), json!(up_band(c.up_secs)));
    m
}

/// 보내기 성공 뒤 — 보낸 만큼만 뺀다(그사이 센 것은 남는다). 동시 참모 최대는 새로 잰다, Claude Code 판은 남긴다
pub fn sent(dir: &Path, was: &Counts) {
    bump(dir, |c| {
        for (k, v) in &was.uses {
            if let Some(n) = c.uses.get_mut(k) {
                *n = n.saturating_sub(*v);
            }
        }
        c.uses.retain(|_, n| *n > 0);
        for (k, v) in &was.crash {
            if let Some(n) = c.crash.get_mut(k) {
                *n = n.saturating_sub(*v);
            }
        }
        c.crash.retain(|_, n| *n > 0);
        c.started = c.started.saturating_sub(was.started);
        c.peak = 0;
        c.upd_ok = c.upd_ok.saturating_sub(was.upd_ok);
        c.upd_fail = c.upd_fail.saturating_sub(was.upd_fail);
        if c.upd_fail == 0 {
            c.upd_at.clear();
        }
        c.up_secs = c.up_secs.saturating_sub(was.up_secs);
    });
}

/// 앱 곳곳에서 부르는 길 — 설정에서 끄면 세지 않는다
fn here() -> Option<&'static Path> {
    crate::config::current().features.usage_ping.then(crate::config::data_dir)
}
pub fn record_use(key: &str) {
    if let Some(d) = here() {
        used(d, key);
    }
}
/// live.json 을 새로 쓸 때 — Chammo 팀 세션(team_roots 아래)만: 새로 보인 세션 수와 지금 살아 있는 참모 수
pub fn record_live(prev: &str, next: &str) {
    if let Some(d) = here() {
        let roots = team_roots(&crate::config::home(), &crate::config::current());
        let keep = |cwd: &str| under_any(cwd, &roots);
        session_started(d, new_sessions(prev, next, &keep));
        agents_now(d, live_agents(next, &keep));
    }
}

/// Chammo 팀 세션 뿌리 — devRoot 아래 · 설정에서 추가한 프로젝트(project::dirs, 있는 폴더만) · HQ(config::hq_dir)
pub fn team_roots(home: &str, c: &crate::config::Config) -> Vec<std::path::PathBuf> {
    let mut roots = vec![std::path::PathBuf::from(crate::config::expand(home, &c.dev_root))];
    roots.extend(crate::project::dirs(home, &c.dev_root, &c.extra_projects).into_iter().map(|(_, p)| p));
    roots.push(std::path::PathBuf::from(crate::config::hq_dir(home, c, |k| std::env::var(k).ok())));
    roots
}

/// 그 폴더가 뿌리 중 하나이거나 그 아래인가 — 폴더 단위로 본다(/dev 와 /devil 은 다르다)
pub fn under_any(cwd: &str, roots: &[std::path::PathBuf]) -> bool {
    let p = std::path::Path::new(cwd.trim_end_matches('/'));
    !cwd.is_empty() && roots.iter().any(|r| !r.as_os_str().is_empty() && p.starts_with(r))
}
pub fn record_crash(kind: &str) {
    if let Some(d) = here() {
        crashed(d, kind);
    }
}
pub fn record_update(ok: Option<&str>) {
    if let Some(d) = here() {
        match ok {
            None => update_ok(d),
            Some(stage) => update_failed(d, stage),
        }
    }
}
pub fn record_cc(raw: &str) {
    if let Some(d) = here() {
        note_cc(d, raw);
    }
}

/// 화면에서 센다 — 사무실·메신저·Craft 앱 열기, 화면 오류(webview). 목록 밖 이름은 버린다
#[tauri::command]
pub fn usage_bump(kind: String) {
    if CRASH_KINDS.contains(&kind.as_str()) {
        record_crash(&kind);
    } else {
        record_use(&kind);
    }
}

fn live_ids(live_json: &str, keep: &dyn Fn(&str) -> bool) -> Vec<String> {
    serde_json::from_str::<Value>(live_json)
        .ok()
        .and_then(|v| v["sessions"].as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter(|s| s["state"].as_str() != Some("done") && s["goneAt"].is_null())
        .filter(|s| keep(s["cwd"].as_str().unwrap_or("")))
        .filter_map(|s| s["sessionId"].as_str().map(String::from))
        .collect()
}

/// live.json 의 살아 있는 세션 수(끝난 것·keep 밖 폴더 빼고)
pub fn live_agents(live_json: &str, keep: &dyn Fn(&str) -> bool) -> usize {
    live_ids(live_json, keep).len()
}

/// 앞 기록에 없던 살아 있는 세션 수 — keep(팀 폴더) 안의 세션만
pub fn new_sessions(prev: &str, next: &str, keep: &dyn Fn(&str) -> bool) -> usize {
    let before = live_ids(prev, keep);
    live_ids(next, keep).iter().filter(|id| !before.contains(id)).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-usage-{name}-{}", crate::tools::tmp_tag()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn 정해_둔_이름만_세고_상한에서_멈춘다() {
        let d = tmp("names");
        used(&d, "office");
        used(&d, "office");
        used(&d, "/Users/someone/secret"); // 목록 밖 — 버림
        crashed(&d, "panic");
        crashed(&d, "thread 'main' panicked at src/x.rs"); // 문구 — 버림
        update_failed(&d, "download");
        update_failed(&d, "elsewhere");
        let c = load(&d);
        assert_eq!(c.uses.get("office"), Some(&2));
        assert_eq!(c.uses.len(), 1);
        assert_eq!(c.crash.keys().collect::<Vec<_>>(), vec!["panic"]);
        assert_eq!((c.upd_fail, c.upd_at.as_str()), (1, "download"));
        for _ in 0..1005 {
            used(&d, "messenger");
        }
        assert_eq!(load(&d).uses["messenger"], 999);
        agents_now(&d, 3);
        agents_now(&d, 2);
        agents_now(&d, 500);
        assert_eq!(load(&d).peak, 99);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(d.join(FILE)).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn claude_code_판은_숫자_점만() {
        assert_eq!(cc_of("2.1.310 (Claude Code)").as_deref(), Some("2.1.310"));
        assert_eq!(cc_of("2.1.3101").as_deref(), Some("2.1.3101"));
        assert_eq!(cc_of("2.1"), None);
        assert_eq!(cc_of("2.1.x"), None);
        assert_eq!(cc_of("/usr/local/bin/claude 2.1.3"), None);
        assert_eq!(cc_of(""), None);
        assert_eq!(cc_of("1234.1.1"), None);
    }

    #[test]
    fn 켜_둔_시간_구간() {
        assert_eq!(up_band(0), "<1h");
        assert_eq!(up_band(3599), "<1h");
        assert_eq!(up_band(3600), "1-4h");
        assert_eq!(up_band(4 * 3600), "4-8h");
        assert_eq!(up_band(8 * 3600), "8h+");
    }

    #[test]
    fn 켜_둔_기능은_스위치_이름만_usage_ping_빼고() {
        let f = crate::config::Features { office: true, voice: true, usage_ping: true, tama: false, gacha: false, review: false, auto_revive: false, auto_tidy: false, agent_view: true, computer_use: false, animation: "auto".into() };
        assert_eq!(on_list(&f), vec!["office", "voice", "agentView"]);
    }

    #[test]
    fn 칸_모양() {
        let mut c = Counts { started: 14, peak: 4, upd_ok: 1, up_secs: 2 * 3600, cc: "2.1.310".into(), ..Default::default() };
        c.uses.insert("office".into(), 3);
        c.uses.insert("voice".into(), 0);
        c.crash.insert("panic".into(), 1);
        let m = fields(&c, &["office", "voice", "nope"]);
        let keys: Vec<&str> = m.keys().map(String::as_str).collect();
        // setup 은 싣지 않는다 — 첫 안내(통계 알림) 전엔 보내지도 않아서 늘 done 이었다(2026-10-24 사용자)
        assert_eq!(keys, ["on", "use", "sess", "crash", "cc", "upd", "up"]);
        assert_eq!(Value::Object(m.clone()), json!({
            "on": ["office", "voice"], "use": { "office": 3 }, "sess": { "started": 14, "peak": 4 },
            "crash": { "n": 1, "kind": { "panic": 1 } }, "cc": "2.1.310",
            "upd": { "ok": 1, "fail": 0 }, "up": "1-4h"
        }));
        // 판 모양이 아니면 cc 칸을 뺀다, 실패가 있으면 at
        let c2 = Counts { cc: "beta".into(), upd_fail: 2, upd_at: "unpack".into(), ..Default::default() };
        let m2 = fields(&c2, &[]);
        assert!(!m2.contains_key("cc") && !m2.contains_key("setup"));
        assert_eq!(m2["upd"], json!({ "ok": 0, "fail": 2, "at": "unpack" }));
    }

    #[test]
    fn 보낸_만큼만_빼고_그사이_센_것은_남는다() {
        let d = tmp("sent");
        used(&d, "office");
        used(&d, "office");
        session_started(&d, 1);
        agents_now(&d, 4);
        uptime(&d, 100);
        note_cc(&d, "2.1.310 (Claude Code)");
        let snap = load(&d);
        used(&d, "office"); // 보내는 사이에 하나 더
        sent(&d, &snap);
        let c = load(&d);
        assert_eq!(c.uses.get("office"), Some(&1));
        assert_eq!((c.started, c.peak, c.up_secs), (0, 0, 0));
        assert_eq!(c.cc, "2.1.310", "판은 남긴다");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 팀_세션만_센다_밖_폴더는_안_센다() {
        let roots = vec![std::path::PathBuf::from("/h/dev"), std::path::PathBuf::from("/h/extra/app"), std::path::PathBuf::from("/h/hq")];
        let keep = |cwd: &str| under_any(cwd, &roots);
        assert!(keep("/h/dev/chammo-relay"));
        assert!(keep("/h/dev/chammo-relay/.claude/worktrees/x"));
        assert!(keep("/h/dev"));
        assert!(keep("/h/extra/app"));
        assert!(keep("/h/hq/"));
        assert!(!keep("/h/devil/x"), "앞 글자만 같은 폴더는 밖");
        assert!(!keep("/tmp/x"));
        assert!(!keep(""));
        let a = r#"{"sessions":[{"sessionId":"a","cwd":"/h/dev/p","state":"idle"},{"sessionId":"b","cwd":"/h/dev/q","state":"busy"},{"sessionId":"c","cwd":"/h/dev/p","state":"done"},{"sessionId":"d","cwd":"/h/dev/p","state":"idle","goneAt":1},{"sessionId":"o","cwd":"/Users/x/Downloads","state":"busy"}]}"#;
        assert_eq!(live_agents(a, &keep), 2, "밖 폴더 o 는 동시 수에도 안 든다");
        assert_eq!(live_agents("", &keep), 0);
        let b = r#"{"sessions":[{"sessionId":"a","cwd":"/h/dev/p","state":"idle"},{"sessionId":"e","cwd":"/h/hq","state":"busy"},{"sessionId":"c","cwd":"/h/dev/p","state":"busy"},{"sessionId":"z","cwd":"/tmp/z","state":"busy"}]}"#;
        assert_eq!(new_sessions(a, b, &keep), 2, "e(HQ) 는 새로, c 는 끝났다가 다시, z(밖) 는 안 셈");
        assert_eq!(new_sessions(b, b, &keep), 0);
        assert_eq!(new_sessions("", a, &keep), 2);
    }

    #[test]
    fn 팀_뿌리는_devroot_추가한_프로젝트_hq() {
        let home = std::env::temp_dir().join(format!("chammo-roots-{}", crate::tools::tmp_tag()));
        let extra = home.join("work/side");
        std::fs::create_dir_all(&extra).unwrap();
        let mut c = crate::config::default_config(home.to_str().unwrap(), &home.join(".chammo"), "ko", |_| false);
        c.dev_root = "~/dev".into();
        c.extra_projects = vec![extra.to_string_lossy().into_owned(), home.join("없는 폴더").to_string_lossy().into_owned()];
        let roots = team_roots(home.to_str().unwrap(), &c);
        let h = home.to_str().unwrap();
        assert!(under_any(&format!("{h}/dev/a"), &roots));
        assert!(under_any(&format!("{h}/work/side/sub"), &roots));
        let hq = crate::config::hq_dir(h, &c, |_| None);
        assert!(under_any(&hq, &roots));
        assert!(!under_any(&format!("{h}/work/other"), &roots));
        assert!(!under_any(&format!("{h}/없는 폴더"), &roots), "없는 추가 폴더는 뿌리가 아니다");
        let _ = std::fs::remove_dir_all(&home);
    }
}
