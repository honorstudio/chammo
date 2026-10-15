//! 토큰 주소가 막혔을 때(429) 한 곳에서 쉬기 — 계정 바꾸기·쉬는 칸 데우기·지금 로그인 미리 갱신, 세 길이 따로 쉬며 또 두드리면 막힘이 길어진다.
//! 막힘이 '최근 요청 수'로 늘어나는 창이면 우리 요청이 막힘을 늘린다. 그래서 세 길이 이 파일 하나(<데이터>/token-rate.json, 토큰 없음)를 같이 보고,
//! 어디서든 rate 를 받으면 until = now + max(Retry-After, 1시간 — 이어지면 2배씩 6시간까지). until 전엔 셋 다 토큰 주소를 안 부른다.
//! 예외는 login_keep 의 '만료 20분 안 마지막 한 번'뿐(force) — 그건 부르는 쪽이 정한다.
//!
//! 판단은 hit·clear(순수), 파일은 call. 부르는 쪽(accounts_cmd)이 세 길을 같은 줄(LOCK)에 세워서 읽고 쓰기가 엇갈리지 않는다
use crate::accounts_refresh::Refresher;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

const MIN: i64 = 60_000;
/// 처음 막혔을 때 쉬는 시간
pub const BASE_MS: i64 = 60 * MIN;
/// 이어지면 2배씩 — 여기까지
pub const CAP_MS: i64 = 6 * 60 * MIN;
/// 풀린 뒤 이만큼 안에 또 막히면 이어진 것(2배). 그보다 뒤면 처음부터
pub const CHAIN_MS: i64 = 6 * 60 * MIN;
/// 서버가 준 Retry-After 를 믿는 끝 — 이상하게 큰 값에 하루 넘게 서 있지 않게
const RETRY_MAX_MS: i64 = 24 * 60 * MIN;
pub const FILE: &str = "token-rate.json";

/// <데이터>/token-rate.json — 토큰 없음
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Rate {
    /// 이때까지 토큰 주소를 안 부른다
    pub until: i64,
    /// 마지막으로 막힌 때
    pub at: i64,
    /// 마지막 Retry-After(초) — 안 왔으면 없음
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<i64>,
    /// 이어서 막힌 횟수 — 받으면 0
    pub count: u32,
    /// 마지막으로 막힌 길 — switch·warm·keep
    pub by: String,
}

/// 계정 목록(accounts.json) 옆 — 세 길이 다 그 경로를 받는다
pub fn path_for(list: &Path) -> PathBuf {
    list.with_file_name(FILE)
}

pub fn load(p: &Path) -> Rate {
    std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub(crate) fn save(p: &Path, r: &Rate) {
    if let Ok(t) = serde_json::to_string(r) {
        let _ = crate::accounts::write_atomic(p, &(t + "\n"));
    }
}

/// 쉬는 중이면 남은 ms
pub fn resting(r: &Rate, now: i64) -> Option<i64> {
    (now < r.until).then(|| r.until - now)
}

/// 'rate' 나 'rate:<초>' 인가
pub fn is_rate(code: &str) -> bool {
    code == "rate" || code.starts_with("rate:")
}

/// 쉬는 중이라 안 부른 오류 — 'wait:<남은 초>'(올림). 화면은 refresh:wait:<초>로 받는다
pub fn wait_code(left_ms: i64) -> String {
    format!("wait:{}", (left_ms + 999) / 1000)
}

/// rate 를 받았다 — 새 상태
pub fn hit(r: &Rate, code: &str, now: i64, by: &str) -> Rate {
    let retry = code.strip_prefix("rate:").and_then(|s| s.parse::<i64>().ok()).filter(|s| *s >= 0);
    let chained = r.count > 0 && now < r.until + CHAIN_MS;
    let count = if chained { r.count + 1 } else { 1 };
    let backoff = BASE_MS.saturating_mul(1 << (count - 1).min(10)).min(CAP_MS);
    let given = retry.map(|s| s.saturating_mul(1000).min(RETRY_MAX_MS)).unwrap_or(0);
    Rate { until: now + given.max(backoff), at: now, retry_after: retry, count, by: by.into() }
}

/// 토큰을 받았다 — 막힘이 풀렸다
pub fn clear(r: &Rate) -> Rate {
    Rate { until: 0, count: 0, ..r.clone() }
}

/// 토큰 주소를 부르는 길 — 쉬는 중이면(force 가 아니면) 부르지 않고 Err('wait:<초>'). 부른 결과로 파일을 고친다.
/// force = login_keep 의 마지막 한 번(만료 20분 안). by 는 기록용 이름
pub fn call(list: &Path, now: i64, refresh: Refresher, o: &Value, by: &str, force: bool) -> Result<Value, String> {
    let p = path_for(list);
    let r = load(&p);
    if let Some(left) = resting(&r, now).filter(|_| !force) {
        return Err(wait_code(left));
    }
    let got = refresh(o);
    match &got {
        Err(code) if is_rate(code) => {
            let n = hit(&r, code, now, by);
            note(&format!("rate · by {by} · rest {}m · #{}{}", (n.until - now) / MIN, n.count, n.retry_after.map(|s| format!(" · retry-after {s}s")).unwrap_or_default()));
            save(&p, &n);
        }
        Ok(_) if r.until != 0 || r.count != 0 => {
            note(&format!("clear · by {by}"));
            save(&p, &clear(&r));
        }
        _ => {}
    }
    got
}

/// 기록 한 줄(토큰 없음) — 시험에선 진짜 notify.log 대신 스레드 목록에
#[cfg(not(test))]
fn note(line: &str) {
    crate::claude::log_out("token-rate", line);
}

#[cfg(test)]
thread_local! {
    pub static NOTES: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
fn note(line: &str) {
    NOTES.with(|n| n.borrow_mut().push(line.to_string()));
}

#[cfg(test)]
pub fn notes() -> Vec<String> {
    NOTES.with(|n| n.borrow().clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;

    const H: i64 = 60 * MIN;
    const T0: i64 = 4_000_000_000_000;

    thread_local! {
        static N: Cell<u32> = const { Cell::new(0) };
    }
    fn limited(_: &Value) -> Result<Value, String> {
        N.with(|n| n.set(n.get() + 1));
        Err("rate".into())
    }
    fn limited_10m(_: &Value) -> Result<Value, String> {
        N.with(|n| n.set(n.get() + 1));
        Err("rate:600".into())
    }
    fn limited_3h(_: &Value) -> Result<Value, String> {
        N.with(|n| n.set(n.get() + 1));
        Err("rate:10800".into())
    }
    fn ok(o: &Value) -> Result<Value, String> {
        N.with(|n| n.set(n.get() + 1));
        Ok(o.clone())
    }
    fn net(_: &Value) -> Result<Value, String> {
        N.with(|n| n.set(n.get() + 1));
        Err("network".into())
    }
    fn calls() -> u32 {
        N.with(|n| n.get())
    }

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-rate-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.join("accounts.json")
    }

    #[test]
    fn 처음은_1시간_retry_after_가_더_길면_그만큼() {
        let r = hit(&Rate::default(), "rate", T0, "warm");
        assert_eq!((r.until, r.count, r.retry_after), (T0 + H, 1, None));
        let r = hit(&Rate::default(), "rate:600", T0, "switch");
        assert_eq!((r.until, r.retry_after), (T0 + H, Some(600)), "Retry-After 10분이어도 1시간 아래로는 안 줄인다");
        let r = hit(&Rate::default(), "rate:10800", T0, "keep");
        assert_eq!(r.until, T0 + 3 * H);
        let r = hit(&Rate::default(), "rate:99999999", T0, "keep");
        assert_eq!(r.until, T0 + 24 * H, "이상하게 큰 값은 하루까지만");
    }

    #[test]
    fn 이어지면_2배씩_6시간까지_한참_뒤면_처음부터() {
        let mut r = Rate::default();
        let mut now = T0;
        let mut rests = Vec::new();
        for _ in 0..5 {
            r = hit(&r, "rate", now, "warm");
            rests.push((r.until - now) / H);
            now = r.until; // 풀리자마자 또 막힘
        }
        assert_eq!(rests, vec![1, 2, 4, 6, 6]);
        // 풀린 뒤 6시간 안이면 아직 이어진 것
        let r2 = hit(&r, "rate", r.until + CHAIN_MS - 1, "keep");
        assert_eq!(r2.count, 6);
        // 그보다 뒤면 처음부터
        let r3 = hit(&r, "rate", r.until + CHAIN_MS, "keep");
        assert_eq!((r3.count, r3.until - (r.until + CHAIN_MS)), (1, H));
        // 받으면 풀리고 다음 막힘은 처음부터
        let c = clear(&r);
        assert_eq!((c.until, c.count), (0, 0));
        assert_eq!(hit(&c, "rate", now, "warm").count, 1);
    }

    #[test]
    fn 쉬는_동안은_안_부르고_남은_초를_준다() {
        let list = tmp("gate");
        let o = json!({ "refreshToken": "r-가짜" });
        assert_eq!(call(&list, T0, limited, &o, "warm", false), Err("rate".into()));
        assert_eq!(calls(), 1);
        // 1시간 동안은 어느 길이든 안 부른다
        assert_eq!(call(&list, T0 + 1, ok, &o, "switch", false), Err(format!("wait:{}", 3600)));
        assert_eq!(call(&list, T0 + H - 1, ok, &o, "keep", false), Err("wait:1".into()));
        assert_eq!(calls(), 1);
        // force(마지막 한 번)는 부른다 — 또 막히면 이어진 것(2시간)
        assert_eq!(call(&list, T0 + 30 * MIN, limited, &o, "keep", true), Err("rate".into()));
        let r = load(&path_for(&list));
        assert_eq!((r.until, r.count, r.by.as_str()), (T0 + 30 * MIN + 2 * H, 2, "keep"));
        // 풀린 뒤 받으면 파일도 풀린다
        assert!(call(&list, r.until, ok, &o, "warm", false).is_ok());
        assert_eq!((load(&path_for(&list)).until, load(&path_for(&list)).count), (0, 0));
        // 막힘이 아닌 실패는 쉬지 않는다
        assert_eq!(call(&list, r.until + 1, net, &o, "warm", false), Err("network".into()));
        assert_eq!(resting(&load(&path_for(&list)), r.until + 2), None);
        let _ = std::fs::remove_dir_all(list.parent().unwrap());
    }

    #[test]
    fn retry_after_를_기록하고_기록_줄엔_토큰이_없다() {
        let list = tmp("note");
        let o = json!({ "accessToken": "at-비밀", "refreshToken": "rt-비밀" });
        let _ = call(&list, T0, limited_10m, &o, "switch", false);
        let _ = call(&list, T0 + H, limited_3h, &o, "warm", false);
        let _ = call(&list, T0 + 5 * H, ok, &o, "keep", false);
        let r = load(&path_for(&list));
        assert_eq!(r.retry_after, Some(10800));
        let file = std::fs::read_to_string(path_for(&list)).unwrap();
        assert_eq!(notes(), vec!["rate · by switch · rest 60m · #1 · retry-after 600s", "rate · by warm · rest 180m · #2 · retry-after 10800s", "clear · by keep"]);
        for l in notes().iter().chain([&file]) {
            assert!(!l.contains("비밀"), "토큰이 새면 안 된다: {l}");
        }
        let _ = std::fs::remove_dir_all(list.parent().unwrap());
    }
}
