//! 세션 브라우저 '개입'(2026-10-06 사용자 설계) — 평소엔 앱에서 세션 브라우저를 보기만 하고, 사람이 '개입'을 누르면 그때부터 조작한다.
//! 그동안 래퍼(tools/chammo-browser/src/takeover.js)는 세션의 다음 브라우저 도구를 붙잡고, '돌려주기'를 누르면 사람이 한 일 꼬리표를 받는다.
//!
//! - 개입 = <live>/<프로필>.takeover {pid, at, by}(600). 앱이 살아 있는 동안 agent_lives 가 몇 초마다 시각을 고친다(래퍼는 3분 넘게 안 고쳐지면 푼다)
//! - 돌려주기 = <live>/<프로필>.handback {pid, startedAt, endedAt, by, events, chromeShown} 을 **먼저** 쓰고 .takeover 를 지운다
//!   (지운 뒤 쓰다 실패하면 래퍼가 꼬리표 없이 이어 간다 — 기록 먼저)
//! - 세션이 사람을 부른 동안(browser_ask_human)도 같은 기록을 모아 '다 했어' 때 .handback 을 쓴다
//! - 기록엔 값이 없다: 간 주소는 출처+경로, 누른 곳은 요소 종류와 페이지가 붙인 이름, 글자는 '어느 칸에'만(비밀번호 칸은 이름도 안 씀)
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

/// 사람이 쥔 동안의 기록
#[derive(Debug, Clone, PartialEq)]
pub struct Take {
    pub pid: i32,
    pub at: u64,
    /// desktop · phone · ask(세션이 부름)
    pub by: String,
    pub events: Vec<Value>,
    /// 크롬 창을 꺼내 직접 만졌다 — 그 클릭·입력은 앱이 못 본다
    pub chrome_shown: bool,
    /// 마지막 사람 조작(모달 입력·기록) 시각 — 오래 없으면 앱이 돌려준다(idle_pid)
    pub touched: u64,
    /// 패스키 꺼내기(agent_peek)가 저절로 켠 개입 — 다시 숨길 때 돌려준다(release_auto)
    pub auto: bool,
}

impl Take {
    fn new(pid: i32, at: u64, by: &str) -> Take {
        Take { pid, at, by: by.into(), events: vec![], chrome_shown: false, touched: now_ms(), auto: false }
    }
}

/// 사람 조작 없이 이만큼 지나면 앱이 개입을 돌려준다 — 꺼내기 오탐·아무것도 안 한 개입이 세션 도구를 붙잡고 있었다(2026-10-10·11)
pub const IDLE_MS: u64 = 3 * 60_000;
/// 크롬 창을 꺼내 둔 동안 — 사람이 크롬을 직접 만지면 앱이 못 봐서(Touch ID·긴 양식) 더 기다린다
pub const IDLE_SHOWN_MS: u64 = 10 * 60_000;

const MAX_EVENTS: usize = 300;

static TAKES: Mutex<Option<HashMap<String, Take>>> = Mutex::new(None);

fn with<T>(f: impl FnOnce(&mut HashMap<String, Take>) -> T) -> T {
    let mut g = TAKES.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashMap::new))
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub(crate) fn write_secure(f: &Path, body: &[u8]) -> Result<(), String> {
    let tmp = f.with_extension("tmp-takeover");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, f).map_err(|e| e.to_string())
}

fn take_file(dir: &Path, profile: &str) -> std::path::PathBuf {
    dir.join(format!("{profile}.takeover"))
}

/// 개입 파일 {pid, at, by} — 모양이 이상하면 None
pub fn read_file(dir: &Path, profile: &str) -> Option<(i32, u64, String)> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(take_file(dir, profile)).ok()?).ok()?;
    let pid = v["pid"].as_i64().filter(|p| *p > 0 && *p <= i64::from(i32::MAX))? as i32;
    let by = v["by"].as_str().filter(|b| ["desktop", "phone"].contains(b)).unwrap_or("desktop").to_string();
    Some((pid, v["at"].as_u64().unwrap_or(0), by))
}

/// 개입 시작 — 그 래퍼(pid)에. 이미 개입 중이면 그대로(먼저 누른 쪽 기록을 지우지 않는다). 세션이 부르는 중이면 그 기록을 이어 쓴다
pub fn start(dir: &Path, profile: &str, pid: i32, by: &str) -> Result<(), String> {
    let by = if by == "phone" { "phone" } else { "desktop" };
    if read_file(dir, profile).is_some_and(|(p, _, _)| p == pid) {
        return Ok(());
    }
    let at = now_ms();
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    write_secure(&take_file(dir, profile), json!({ "pid": pid, "at": at, "by": by }).to_string().as_bytes())?;
    with(|m| {
        let keep = m.get(profile).filter(|t| t.pid == pid).cloned();
        m.insert(profile.to_string(), keep.map(|t| Take { by: by.into(), touched: now_ms(), ..t }).unwrap_or(Take::new(pid, at, by)));
    });
    Ok(())
}

/// 앱이 붙기 전에 뜬 대화상자 — 앱 CDP 는 못 답해서('No dialog is showing') 래퍼에 답을 부탁한다(<프로필>.dialog {pid, accept, at}).
/// 래퍼(tools/chammo-browser src/dialogs.js)가 처음부터 붙은 playwright 로 답하고 <프로필>.dialog-done 에 결과를 남긴다. 지난 결과는 지운다
pub fn ask_dialog(dir: &Path, profile: &str, pid: i32, accept: bool) -> Result<u64, String> {
    let at = now_ms();
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(dir.join(format!("{profile}.dialog-done")));
    write_secure(&dir.join(format!("{profile}.dialog")), json!({ "pid": pid, "accept": accept, "at": at }).to_string().as_bytes())?;
    Ok(at)
}

/// 래퍼가 남긴 대화상자 답 결과 {at, ok, error} — 그 래퍼(pid) 것만
pub fn dialog_done(dir: &Path, profile: &str, pid: i32) -> Option<Value> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(format!("{profile}.dialog-done"))).ok()?).ok()?;
    (v["pid"].as_i64() == Some(i64::from(pid))).then(|| json!({ "at": v["at"].as_u64().unwrap_or(0), "ok": v["ok"] == true, "error": v["error"].as_str().unwrap_or_default() }))
}

/// 세션이 사람을 부르는 동안 기록 시작(파일 없음 — 래퍼가 이미 askHuman 에서 기다린다)
pub fn start_ask(profile: &str, pid: i32, at: u64) {
    with(|m| {
        if m.get(profile).is_none_or(|t| t.pid != pid) {
            m.insert(profile.to_string(), Take::new(pid, at, "ask"));
        }
    });
}

/// 부름이 사라졌다(시간 다 됨·브라우저 닫힘) — 개입 파일이 없는 부름 기록만 버린다
pub fn drop_ask(dir: &Path, profile: &str) {
    if read_file(dir, profile).is_none() {
        with(|m| {
            if m.get(profile).is_some_and(|t| t.by == "ask") {
                m.remove(profile);
            }
        });
    }
}

/// 사람이 조작해도 되나 — 그 래퍼에 개입 중이거나 그 래퍼가 사람을 부르는 중
pub fn allows(dir: &Path, profile: &str, pid: i32, asking: bool) -> bool {
    asking || read_file(dir, profile).is_some_and(|(p, _, _)| p == pid)
}

/// 지금 개입 중인 래퍼 pid·누가·언제(앱 화면에) — 앱이 다시 켜져 기억이 없으면 파일로 기록을 다시 연다
pub fn current(dir: &Path, profile: &str) -> Option<(i32, u64, String)> {
    let f = read_file(dir, profile)?;
    with(|m| {
        if m.get(profile).is_none_or(|t| t.pid != f.0) {
            m.insert(profile.to_string(), Take::new(f.0, f.1, &f.2));
        }
    });
    Some(f)
}

/// 앱이 살아 있다는 표시 — 개입 파일 시각을 지금으로(래퍼는 3분 넘게 안 고쳐지면 앱이 꺼진 걸로 보고 푼다)
pub fn heartbeat(dir: &Path, profile: &str) {
    if let Ok(f) = std::fs::File::options().write(true).open(take_file(dir, profile)) {
        let _ = f.set_modified(std::time::SystemTime::now());
    }
}

/// 그 래퍼가 아닌 개입 파일(세션이 바뀜)을 치운다 — 남겨 두면 새 래퍼는 안 붙잡는데 앱만 '조작 중'으로 보였다
pub fn drop_foreign(dir: &Path, profile: &str, live_pid: i32) {
    if read_file(dir, profile).is_some_and(|(p, _, _)| p != live_pid) {
        let _ = std::fs::remove_file(take_file(dir, profile));
        with(|m| m.remove(profile));
    }
}

/// 돌려주기 기록을 쓰고(먼저) 개입 파일을 지운다. 기록은 그 래퍼(pid) 것만
pub fn hand_back(dir: &Path, profile: &str, pid: i32) -> Result<(), String> {
    hand_back_why(dir, profile, pid, None)
}

/// 앱이 저절로 돌려줄 때 왜(idle · hidden)를 같이 적는다 — 래퍼 꼬리표가 '사람이 돌려줌'과 갈라 말한다
pub fn hand_back_why(dir: &Path, profile: &str, pid: i32, why: Option<&str>) -> Result<(), String> {
    let t = take_mine(profile, pid);
    let file = read_file(dir, profile);
    if t.is_none() && file.as_ref().is_none_or(|(p, _, _)| *p != pid) {
        return Err("not taken".into());
    }
    let t = t.unwrap_or_else(|| {
        let (p, at, by) = file.clone().unwrap_or((pid, now_ms(), "desktop".into()));
        Take::new(p, at, &by)
    });
    write_handback(dir, profile, &t, why)?;
    if file.as_ref().is_some_and(|(p, _, _)| *p == pid) {
        std::fs::remove_file(take_file(dir, profile)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 세션이 부른 일을 '다 했어' — 모은 기록이 있으면 .handback(래퍼가 .done 을 보고 읽는다)
pub fn ask_done(dir: &Path, profile: &str, pid: i32) -> Result<(), String> {
    if let Some(t) = take_mine(profile, pid) {
        write_handback(dir, profile, &t, None)?;
        // 사람이 부름 중에 '개입'까지 눌렀으면 그것도 같이 끝낸다
        if read_file(dir, profile).is_some_and(|(p, _, _)| p == pid) {
            let _ = std::fs::remove_file(take_file(dir, profile));
        }
    }
    Ok(())
}

/// 그 래퍼 기록만 꺼낸다 — 남의 pid 로 부르면 기록을 그대로 둔다
fn take_mine(profile: &str, pid: i32) -> Option<Take> {
    with(|m| if m.get(profile).is_some_and(|t| t.pid == pid) { m.remove(profile) } else { None })
}

fn write_handback(dir: &Path, profile: &str, t: &Take, why: Option<&str>) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut body = json!({ "pid": t.pid, "startedAt": t.at, "endedAt": now_ms(), "by": t.by, "events": t.events, "chromeShown": t.chrome_shown });
    if let Some(w) = why {
        body["why"] = json!(w);
    }
    write_secure(&dir.join(format!("{profile}.handback")), body.to_string().as_bytes())
}

/// 패스키 꺼내기가 켜는 개입 — 이미 개입 중이 아니었을 때만 '저절로'로 표시(사람이 켠 개입은 사람 것 그대로)
pub fn start_auto(dir: &Path, profile: &str, pid: i32) -> Result<(), String> {
    let fresh = read_file(dir, profile).is_none_or(|(p, _, _)| p != pid);
    start(dir, profile, pid, "desktop")?;
    if fresh {
        with(|m| {
            if let Some(t) = m.get_mut(profile).filter(|t| t.pid == pid) {
                t.auto = true;
            }
        });
    }
    Ok(())
}

/// 사람이 그 개입을 이어 받았다('크롬에서 보기' 등) — 숨겨도 안 푼다
pub fn set_manual(profile: &str) {
    with(|m| {
        if let Some(t) = m.get_mut(profile) {
            t.auto = false;
        }
    });
}

/// 꺼냈던 창을 다시 숨길 때 — 꺼내기가 저절로 켠 개입이면 돌려준다. 돌려줬으면 true
pub fn release_auto(dir: &Path, profile: &str, pid: i32) -> bool {
    let auto = with(|m| m.get(profile).is_some_and(|t| t.pid == pid && t.auto));
    auto && read_file(dir, profile).is_some_and(|(p, _, _)| p == pid) && hand_back_why(dir, profile, pid, Some("hidden")).is_ok()
}

/// 사람이 모달에서 조작했다(입력 한 묶음) — 돌려주기 시계를 다시
pub fn touched(profile: &str) {
    with(|m| {
        if let Some(t) = m.get_mut(profile) {
            t.touched = now_ms();
        }
    });
}

/// 사람 조작이 오래 없는 개입이면 그 래퍼 pid — 세션이 부른 동안(asking·ask 기록)은 안 푼다(래퍼가 부름 시간을 따로 잰다).
/// 부름 중에 사람이 '개입'까지 누르면 기록의 by 가 desktop 으로 바뀌어서 지금 부르는 중인지(asking)를 따로 받는다
pub fn idle_pid(profile: &str, now: u64, shown: bool, asking: bool) -> Option<i32> {
    let limit = if shown { IDLE_SHOWN_MS } else { IDLE_MS };
    with(|m| m.get(profile).filter(|t| !asking && t.by != "ask" && now.saturating_sub(t.touched) >= limit).map(|t| t.pid))
}

/// 크롬 창을 꺼냈다(개입 중일 때만 표시)
pub fn mark_chrome(profile: &str) {
    with(|m| {
        if let Some(t) = m.get_mut(profile) {
            t.chrome_shown = true;
        }
    });
}

/// 쥐고 있나 — 일꾼을 계속 붙여 둔다(사람이 안 보고 있어도 주소·탭 바뀜을 기록하게)
pub fn holding(profile: &str) -> bool {
    with(|m| m.contains_key(profile))
}

/// 기록 하나 — 쥔 동안만. 바로 앞과 같으면 안 늘린다(한 칸에 글자를 여러 번 넣어도 한 번)
pub fn record(profile: &str, ev: Value) {
    with(|m| {
        if let Some(t) = m.get_mut(profile) {
            t.touched = now_ms();
            if t.events.last() != Some(&ev) && t.events.len() < MAX_EVENTS {
                t.events.push(ev);
            }
        }
    });
}

#[cfg(test)]
pub fn events(profile: &str) -> Vec<Value> {
    with(|m| m.get(profile).map(|t| t.events.clone()).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::takeover_note::{key, nav};

    fn dir() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("takeover-{}-{}", std::process::id(), now_ms() ^ rand_u64()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn rand_u64() -> u64 {
        use std::hash::{BuildHasher, Hasher};
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u8(1);
        h.finish()
    }

    #[test]
    fn 개입하고_돌려주면_기록을_먼저_쓰고_개입_파일을_지운다() {
        let d = dir();
        let p = "t-hand";
        start(&d, p, 77, "desktop").unwrap();
        assert_eq!(read_file(&d, p).map(|f| f.0), Some(77));
        assert!(allows(&d, p, 77, false));
        assert!(!allows(&d, p, 78, false), "다른 래퍼엔 안 된다");
        record(p, nav("https://a.com/x?token=1").unwrap());
        record(p, json!({ "k": "type", "what": "칸 'A'" }));
        record(p, json!({ "k": "type", "what": "칸 'A'" }));
        assert_eq!(events(p).len(), 2, "같은 기록 연속은 한 번");
        assert!(hand_back(&d, p, 78).is_err(), "남의 pid 로는 못 돌려준다");
        hand_back(&d, p, 77).unwrap();
        assert!(read_file(&d, p).is_none());
        let h: Value = serde_json::from_str(&std::fs::read_to_string(d.join(format!("{p}.handback"))).unwrap()).unwrap();
        assert_eq!(h["pid"], 77);
        assert_eq!(h["events"][0]["url"], "https://a.com/x");
        assert!(!h.to_string().contains("token"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(d.join(format!("{p}.handback"))).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert!(!holding(p));
    }

    #[test]
    fn 붙기_전에_뜬_대화상자는_래퍼에_답을_부탁하고_그_래퍼_결과만_읽는다() {
        let d = dir();
        let p = "dlg";
        std::fs::write(d.join(format!("{p}.dialog-done")), r#"{"pid":77,"at":1,"ok":false}"#).unwrap();
        let at = ask_dialog(&d, p, 77, false).unwrap();
        assert!(dialog_done(&d, p, 77).is_none(), "지난 결과는 지운다");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(d.join(format!("{p}.dialog"))).unwrap()).unwrap();
        assert_eq!(v, json!({ "pid": 77, "accept": false, "at": at }));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(d.join(format!("{p}.dialog"))).unwrap().permissions().mode() & 0o777, 0o600);
        }
        std::fs::write(d.join(format!("{p}.dialog-done")), r#"{"pid":77,"at":9,"ok":false,"error":"No dialog visible"}"#).unwrap();
        assert_eq!(dialog_done(&d, p, 77), Some(json!({ "at": 9, "ok": false, "error": "No dialog visible" })));
        assert!(dialog_done(&d, p, 78).is_none(), "남의 래퍼 결과는 안 읽는다");
    }

    #[test]
    fn 이미_개입_중이면_두_번째_누름이_기록을_지우지_않는다() {
        let d = dir();
        let p = "t-twice";
        start(&d, p, 5, "desktop").unwrap();
        record(p, key("Enter"));
        start(&d, p, 5, "phone").unwrap();
        assert_eq!(events(p).len(), 1);
        hand_back(&d, p, 5).unwrap();
    }

    #[test]
    fn 앱이_다시_켜져_기억이_없어도_파일로_이어서_돌려준다() {
        let d = dir();
        let p = "t-restart";
        start(&d, p, 9, "phone").unwrap();
        with(|m| m.remove(p));
        assert_eq!(current(&d, p).map(|c| c.2), Some("phone".to_string()));
        assert!(holding(p));
        hand_back(&d, p, 9).unwrap();
        let h: Value = serde_json::from_str(&std::fs::read_to_string(d.join(format!("{p}.handback"))).unwrap()).unwrap();
        assert_eq!(h["by"], "phone");
    }

    #[test]
    fn 세션이_바뀐_개입_파일은_치운다() {
        let d = dir();
        let p = "t-foreign";
        start(&d, p, 3, "desktop").unwrap();
        drop_foreign(&d, p, 3);
        assert!(read_file(&d, p).is_some());
        drop_foreign(&d, p, 4);
        assert!(read_file(&d, p).is_none());
        assert!(!holding(p));
    }

    #[test]
    fn 부름_기록은_다_했어에_handback_으로() {
        let d = dir();
        let p = "t-ask";
        start_ask(p, 11, 1000);
        assert!(allows(&d, p, 11, true));
        record(p, json!({ "k": "click", "what": "버튼 '로그인'" }));
        ask_done(&d, p, 11).unwrap();
        let h: Value = serde_json::from_str(&std::fs::read_to_string(d.join(format!("{p}.handback"))).unwrap()).unwrap();
        assert_eq!(h["by"], "ask");
        assert_eq!(h["events"][0]["what"], "버튼 '로그인'");
        // 부름이 그냥 사라지면 기록만 버린다
        start_ask(p, 12, 1);
        drop_ask(&d, p);
        assert!(!holding(p));
    }

    #[test]
    fn 기록_수는_한도까지() {
        let p = "t-cap";
        start_ask(p, 1, 0);
        for i in 0..400 {
            record(p, json!({ "k": "click", "what": i }));
        }
        assert_eq!(events(p).len(), MAX_EVENTS);
        with(|m| m.remove(p));
    }

    fn handback(d: &Path, p: &str) -> Value {
        serde_json::from_str(&std::fs::read_to_string(d.join(format!("{p}.handback"))).unwrap()).unwrap()
    }

    #[test]
    fn 패스키_꺼내기가_켠_개입은_다시_숨길_때_돌려준다() {
        // 2026-10-10·11 — 꺼내기(agent_peek)가 개입을 켜고 숨기기(agent_hide)는 안 풀어서, 오탐·아무것도 안 한 날 세션 도구가 계속 묶였다
        let d = dir();
        let p = "t-auto";
        start_auto(&d, p, 21).unwrap();
        assert!(allows(&d, p, 21, false));
        assert!(!release_auto(&d, p, 22), "남의 래퍼는 안 푼다");
        assert!(release_auto(&d, p, 21));
        assert!(read_file(&d, p).is_none());
        assert_eq!(handback(&d, p)["why"], "hidden");
        assert!(!holding(p));
        assert!(!release_auto(&d, p, 21), "이미 풀렸으면 아무 일 없음");
    }

    #[test]
    fn 사람이_직접_켠_개입은_숨겨도_안_풀린다() {
        let d = dir();
        let p = "t-manual";
        start(&d, p, 31, "desktop").unwrap();
        assert!(!release_auto(&d, p, 31));
        assert!(read_file(&d, p).is_some());
        // 꺼내기가 켠 뒤 사람이 '크롬에서 보기'를 누르면 사람 것이 된다
        let q = "t-manual2";
        start_auto(&d, q, 32).unwrap();
        set_manual(q);
        assert!(!release_auto(&d, q, 32));
        // 이미 사람이 개입 중인데 꺼내기가 오면 사람 것 그대로
        start_auto(&d, p, 31).unwrap();
        assert!(!release_auto(&d, p, 31));
        hand_back(&d, p, 31).unwrap();
        hand_back(&d, q, 32).unwrap();
    }

    #[test]
    fn 사람_조작이_없으면_정한_시간_뒤_돌려줄_차례다() {
        let d = dir();
        let p = "t-idle";
        start(&d, p, 41, "desktop").unwrap();
        let t0 = with(|m| m[p].touched);
        assert_eq!(idle_pid(p, t0 + IDLE_MS - 1, false, false), None);
        assert_eq!(idle_pid(p, t0 + IDLE_MS, false, false), Some(41));
        assert_eq!(idle_pid(p, t0 + IDLE_MS, true, false), None, "크롬을 꺼내 둔 동안은 사람이 크롬을 직접 만질 수 있어 더 기다린다");
        assert_eq!(idle_pid(p, t0 + IDLE_SHOWN_MS, true, false), Some(41));
        // 조작하면 시계가 다시 간다 — 모달 입력(touched)·기록(record) 둘 다
        with(|m| m.get_mut(p).unwrap().touched = 0);
        touched(p);
        assert!(idle_pid(p, now_ms() + IDLE_MS - 1000, false, false).is_none());
        with(|m| m.get_mut(p).unwrap().touched = 0);
        record(p, key("Tab"));
        assert!(idle_pid(p, now_ms() + IDLE_MS - 1000, false, false).is_none());
        hand_back_why(&d, p, 41, Some("idle")).unwrap();
        assert_eq!(handback(&d, p)["why"], "idle");
        assert_eq!(handback(&d, p)["events"][0]["key"], "Tab");
        assert!(read_file(&d, p).is_none());
    }

    #[test]
    fn 세션이_부른_동안은_시간으로_안_푼다() {
        // 부름(browser_ask_human)은 래퍼가 10분 기다린다 — 사람이 로그인할 시간을 앱이 줄이지 않는다
        let p = "t-idle-ask";
        start_ask(p, 51, 0);
        with(|m| m.get_mut(p).unwrap().touched = 0);
        assert_eq!(idle_pid(p, now_ms() + IDLE_SHOWN_MS * 10, false, false), None);
        with(|m| m.remove(p));
    }

    #[test]
    fn 부름_중에_사람이_개입을_눌러도_부름이_끝날_때까지_시간으로_안_푼다() {
        // 부름 중 '개입'을 누르면 start 가 by 를 desktop 으로 바꿔서 SMS·앱 승인 기다리는 3분 사이 풀리고 모은 기록이 사라졌다(2026-10-11 bug-hunt)
        let d = dir();
        let p = "t-idle-ask-take";
        start_ask(p, 52, 0);
        record(p, key("Enter"));
        start(&d, p, 52, "desktop").unwrap();
        with(|m| m.get_mut(p).unwrap().touched = 0);
        assert_eq!(idle_pid(p, now_ms() + IDLE_MS * 2, false, true), None);
        assert_eq!(events(p).len(), 1);
        // 부름이 끝나고 개입만 남으면 평소처럼 3분
        assert_eq!(idle_pid(p, now_ms() + IDLE_MS * 2, false, false), Some(52));
        with(|m| m.remove(p));
    }

    #[test]
    fn 쥐지_않은_때는_기록하지_않는다() {
        record("t-none", key("Enter"));
        assert!(events("t-none").is_empty());
    }
}
