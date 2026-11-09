//! 짝지은 다른 기기의 카드 기록 + 세션 목록 모으기(remote::cards_now) — 폰·데스크톱 결정 대기함이 4초마다 묻는다.
//! 묻는 쪽은 망을 기다리지 않는다: 늘 마지막 값을 바로 주고, 3초 넘게 묵었으면 뒤에서 기기들을 한꺼번에(병렬로) 다시 묻는다.
//! 안 닿는 기기는 짧게 쉬었다(5→10→20→30초) 다시 묻는다 — 그동안 줄을 빼지 않고 off(연결 안 됨)로 두고, 마지막으로 받은 카드는 10분까지 같이.
//! (11-08: 꺼진 기기 하나의 테일넷 SOCKS 5초 실패를 폰 요청이 매번 물어 /api/peer-cards 2.2~5.3초)
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 이만큼 안 묵었으면 다시 묻지 않는다 — 폰·데스크톱 주기(4초)보다 조금 짧게(주기가 살짝 당겨져도 바퀴를 건너뛰지 않게)
pub const FRESH: Duration = Duration::from_secs(3);
/// 카드 모으기의 요청 하나 마감 — 대신 보내기 10초보다 짧게(꺼진 기기는 어차피 실패, 원격 세션 목록은 claude agents 를 돌려도 이 안)
pub const WAIT: Duration = Duration::from_secs(4);
/// 안 닿게 된 기기의 마지막 카드를 같이 보여 주는 동안 — 잠깐 끊긴 사이 카드가 깜빡 사라지지 않게. 넘으면 줄만(off) 남는다
pub const KEEP_OFF: Duration = Duration::from_secs(600);

/// 연달아 실패한 수 → 다음에 묻기까지 쉬는 시간
pub fn backoff(fails: u32) -> Duration {
    Duration::from_secs(match fails {
        0 => 0,
        1 => 5,
        2 => 10,
        3 => 20,
        _ => 30,
    })
}

/// 한 기기에서 받은 것 — sessions 가 None 이면 세션 목록만 못 받았다(전에 받은 목록을 그대로 쓴다)
#[derive(Debug, Clone, PartialEq)]
pub struct Got {
    pub log: String,
    pub sessions: Option<String>,
}

/// 기기 하나 묻기 — (기기 id) → 카드 기록·세션 목록. 시험은 가짜를 넣는다
pub type Fetch<'a> = dyn Fn(&str) -> Result<Got, String> + Sync + 'a;

#[derive(Debug)]
struct Dev {
    id: String,
    /// 마지막으로 받은 (카드 기록, 세션 목록)
    last: Option<(String, String)>,
    ok_at: Option<Instant>,
    fails: u32,
    /// 이때가 지나야 다시 묻는다(실패 뒤 쉬기)
    next: Instant,
}

/// 모은 값과 기기별 상태 — 앱엔 하나(remote::cards_now), 시험은 따로 만든다
pub struct Hub {
    devs: Mutex<Vec<Dev>>,
    /// 마지막으로 한 바퀴 다 돈 때
    at: Mutex<Option<Instant>>,
    busy: AtomicBool,
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

impl Hub {
    pub const fn new() -> Self {
        Hub { devs: Mutex::new(Vec::new()), at: Mutex::new(None), busy: AtomicBool::new(false) }
    }

    /// 지금 값(망을 안 부른다) + 뒤에서 한 바퀴 돌려야 하나. true 면 부른 쪽이 refresh 를 다른 스레드로 넘긴다 — 한 번에 한 바퀴만
    pub fn look(&self, paired: &[(String, String)], now: Instant) -> (serde_json::Value, bool) {
        let v = self.snapshot(paired, now);
        let stale = self.at.lock().unwrap_or_else(|e| e.into_inner()).is_none_or(|at| now.saturating_duration_since(at) >= FRESH);
        let go = stale && !self.busy.swap(true, Ordering::AcqRel);
        (v, go)
    }

    /// 짝지은 기기 순서대로 — 받은 적 없는 기기는 아직 줄이 없다. 안 닿는 기기는 off(마지막 카드는 KEEP_OFF 까지)
    pub fn snapshot(&self, paired: &[(String, String)], now: Instant) -> serde_json::Value {
        let devs = self.devs.lock().unwrap_or_else(|e| e.into_inner());
        let rows = paired
            .iter()
            .filter_map(|(id, name)| {
                let d = devs.iter().find(|d| &d.id == id)?;
                let off = d.fails > 0;
                let keep = !off || d.ok_at.is_some_and(|t| now.saturating_duration_since(t) < KEEP_OFF);
                let (log, sessions) = match (&d.last, keep) {
                    (Some((l, s)), true) => (l.clone(), s.clone()),
                    _ if off => (String::new(), "[]".to_string()),
                    _ => return None,
                };
                let mut row = serde_json::json!({ "dev": id, "name": name, "log": log, "sessions": sessions });
                if off {
                    row["off"] = true.into();
                }
                Some(row)
            })
            .collect();
        serde_json::Value::Array(rows)
    }

    /// 한 바퀴 — 쉴 때가 지난 기기만 병렬로 묻고, 답이 오는 대로 적는다(느린 기기가 빠른 기기 카드를 붙잡지 않게).
    /// look 이 true 를 준 뒤에만 부른다. 끝나면(패닉이어도) 다음 바퀴를 연다
    pub fn refresh(&self, paired: &[(String, String)], fetch: &Fetch, clock: &(dyn Fn() -> Instant + Sync)) {
        struct Open<'a>(&'a AtomicBool);
        impl Drop for Open<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _open = Open(&self.busy);
        let now = clock();
        let due: Vec<&String> = {
            let mut devs = self.devs.lock().unwrap_or_else(|e| e.into_inner());
            devs.retain(|d| paired.iter().any(|(id, _)| id == &d.id)); // 끊은 기기는 잊는다
            paired.iter().map(|(id, _)| id).filter(|id| devs.iter().find(|d| &d.id == *id).is_none_or(|d| d.next <= now)).collect()
        };
        std::thread::scope(|s| {
            for id in due {
                s.spawn(move || {
                    let r = fetch(id);
                    self.record(id, r, clock());
                });
            }
        });
        *self.at.lock().unwrap_or_else(|e| e.into_inner()) = Some(clock());
    }

    fn record(&self, id: &str, r: Result<Got, String>, now: Instant) {
        let mut devs = self.devs.lock().unwrap_or_else(|e| e.into_inner());
        let i = match devs.iter().position(|d| d.id == id) {
            Some(i) => i,
            None => {
                devs.push(Dev { id: id.to_string(), last: None, ok_at: None, fails: 0, next: now });
                devs.len() - 1
            }
        };
        let d = &mut devs[i];
        match r {
            Ok(g) => {
                // 세션 목록만 못 받았으면 전 목록 — "[]" 로 비우면 그 기기 카드가 '세션 꺼짐'으로 사라진다
                let sessions = g.sessions.or_else(|| d.last.as_ref().map(|(_, s)| s.clone())).unwrap_or_else(|| "[]".into());
                d.last = Some((g.log, sessions));
                d.ok_at = Some(now);
                d.fails = 0;
                d.next = now;
            }
            Err(_) => {
                d.fails = d.fails.saturating_add(1);
                d.next = now + backoff(d.fails);
            }
        }
    }
}

#[cfg(test)]
#[path = "peer_cards_tests.rs"]
mod tests;
