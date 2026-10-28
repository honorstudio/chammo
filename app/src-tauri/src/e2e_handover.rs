//! 지난 대화 건네주기 — chammo-relay ADR 0007 R10. 이 기기(내 사슬 기기)가 연 지난 말의 내용 열쇠를 봉투 목록에 없는 **내 새 사슬 기기** 몫으로 다시 봉해 올린다.
//! - 사람 확인 없이 저절로(사용자 10-28 "내 기기면 지난 말까지 당연히 보여야") — 받는 기기는 숫자 확인(로그인 허용 카드)으로 내 사슬에 든 기기만
//! - 받는 기기는 서버 기기 목록이 아니라 **내가 검증한 내 사슬**에서 고른다(서버가 끼운 기기에 안 건넨다). 내 사슬이 바뀜·갈림·확인 전이면 안 한다
//! - 건네는 말은 이 기기가 보낸 사람 서명을 다시 확인해 연 것만(받는 기기도 원래 서명·kh 를 다시 본다). 서버가 고르는 건 '무엇이 빠졌나'뿐 — 숨기기만 할 수 있다
//! - 한 기기를 다 훑으면 e2e.json handed 에 적고 다시 안 한다. 옛 중계(404)·망 실패는 안 적어 다음에 다시(이미 건넨 말은 서버가 history 에서 뺀다)
use crate::accounts_store::Store;
use crate::e2e_envelope::{self, Recipient};
use crate::e2e_state::{self, Trust};
use crate::team_relay::{self as relay, Http};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;

/// 한 번 훑을 때 중계 요청 상한 — 기기당 10분 300개 nonce 창(429)을 건네주기가 먹지 않게(10-28 사용자 맥 429 사고). 다 못 훑으면 물러섰다 이어서
pub(crate) const MAX_CALLS: usize = 8;
/// 서버 한 번에 받는 방·항목 수(chammo-relay late.ts LATE_MAX_ROOMS·LATE_MAX_ITEMS)
const ROOMS: usize = 50;
const BATCH: usize = 60;
/// 실패(망·429·옛 중계) 뒤 다시 훑기까지 — 실패가 이어질수록 길게
const BACKOFF_MS: [u64; 4] = [10 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
/// 상한에 걸렸지만 나아간 바퀴 — 자리를 적었으니 조금 쉬고 이어서(요청 창을 안 먹게, 실패로 안 센다)
const MORE_MS: u64 = 2 * 60_000;

static LOCK: Mutex<()> = Mutex::new(());

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 건넬 새 기기가 있나(망 없이 — 캐시한 내 사슬로). 바깥 루프가 자주 불러도 싸다
pub fn pending(dir: &Path) -> bool {
    let st = relay::load_state(dir);
    let Some(acc) = st.account.as_ref().map(|a| a.id.clone()) else { return false };
    let s = e2e_state::load(dir);
    if s.handover_after > now_ms() {
        return false;
    }
    let Some(c) = e2e_state::trusted_chain(dir, &acc) else { return false };
    c.devices.contains_key(&st.device_id) && c.devices.keys().any(|d| d != &st.device_id && !s.handed.contains_key(d))
}

static RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 건넬 기기가 있으면 뒤에서 한 번 훑는다(한 번에 하나) — 방 찾기(1~5분마다·팀/기기 바뀜 때 바로)가 부른다
pub fn kick(dir: &Path) {
    use std::sync::atomic::Ordering;
    if !pending(dir) || RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let dir = dir.to_path_buf();
    std::thread::spawn(move || {
        match sweep(&dir, &crate::team_relay_keys::store(), &relay::Curl) {
            Ok(n) if n > 0 => eprintln!("[건네주기] 내 새 기기에 지난 말 열쇠 {n}개"),
            Ok(_) => {}
            Err(e) => eprintln!("[건네주기] 다음에 다시: {e}"),
        }
        RUNNING.store(false, Ordering::SeqCst);
    });
}

/// 훑기 — 건넨 열쇠 수. 내 사슬이 준비 안 됐으면 Err(아무 요청도 안 보냄). 실패하면 물러서기를 적고 Err
pub fn sweep(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<usize, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let out = sweep_inner(dir, kc, http);
    e2e_state::mutate(dir, |s| {
        if matches!(out, Ok((_, Done::All))) {
            s.handover_fails = 0;
            s.handover_after = 0;
        } else if matches!(out, Ok((_, Done::More))) {
            s.handover_fails = 0;
            s.handover_after = now_ms() + MORE_MS;
        } else if !matches!(out, Err(Why::NotReady)) {
            s.handover_after = now_ms() + BACKOFF_MS[(s.handover_fails as usize).min(BACKOFF_MS.len() - 1)];
            s.handover_fails = s.handover_fails.saturating_add(1);
        }
    })?;
    match out {
        Ok((n, _)) => Ok(n),
        Err(Why::NotReady) => Err(e2e_state::NOT_READY.into()),
        Err(Why::Other(e)) => Err(e),
    }
}

enum Why {
    NotReady,
    Other(String),
}

impl From<String> for Why {
    fn from(e: String) -> Why {
        Why::Other(e)
    }
}

/// 바퀴가 어디까지 갔나
enum Done {
    /// 건넬 기기를 다 훑었다
    All,
    /// 요청 상한 — 싼 것은 보내고 자리를 적었다(다음 바퀴가 이어서)
    More,
    /// 옛 중계(404) — 건네주기 길이 없다
    Old,
}

/// (건넨 수, 어디까지)
fn sweep_inner(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<(usize, Done), Why> {
    let st = relay::load_state(dir);
    let acc = st.account.as_ref().map(|a| a.id.clone()).ok_or(Why::NotReady)?;
    // 방 찾기가 바로 앞에서 ensure 로 내 사슬을 새로 받았다 — 캐시로(요청 없음). 핀 견주기는 그대로
    let mine = match e2e_state::chain_of(dir, kc, http, &st, &acc, false).map_err(Why::Other)? {
        Trust::Ok(c) if c.devices.contains_key(&st.device_id) => c,
        _ => return Err(Why::NotReady),
    };
    let handed = e2e_state::load(dir).handed;
    let targets: Vec<Recipient> = mine.devices.iter().filter(|(d, _)| *d != &st.device_id && !handed.contains_key(*d)).map(|(d, x)| Recipient { device: d.clone(), e2e: x.e2e.clone() }).collect();
    if targets.is_empty() {
        return Ok((0, Done::All));
    }
    let keys = relay::device_keys(kc, &st)?;
    let calls = std::cell::Cell::new(0);
    let call = |path: &str, body: &Value| -> Result<(u16, Value), Why> {
        calls.set(calls.get() + 1);
        if calls.get() > MAX_CALLS {
            return Err(Why::Other("이번 바퀴 요청 상한 — 물러섰다 이어서".into()));
        }
        Ok(relay::call(http, &st.server, &keys, Some(&st.device_id), "POST", path, Some(body))?)
    };
    // 다 찬 묶음만(all 이면 남은 것까지) 보낸다 — 보낸 수
    let flush = |items: &mut Vec<Value>, to: &str, all: bool| -> Result<usize, Why> {
        let mut n = 0;
        while items.len() >= BATCH || (all && !items.is_empty()) {
            let chunk: Vec<Value> = items.drain(..items.len().min(BATCH)).collect();
            let (code, v) = call("/v0/me/late/keys", &json!({ "for": to, "items": chunk }))?;
            if code != 200 {
                return Err(Why::Other(relay::why(code, &v)));
            }
            n += chunk.len();
        }
        Ok(n)
    };
    let saved = e2e_state::load(dir).handover_at;
    let mut senders = Senders::default();
    let mut total = 0;
    for t in &targets {
        // 방 → 이어 받을 자리(앞 바퀴가 적은 데부터). 서버가 next 로 준 방만 남는다
        let from = saved.get(&t.device);
        let mut left: Vec<(String, u64)> = st.rooms.iter().map(|r| (r.id.clone(), from.and_then(|f| f.get(&r.id)).copied().unwrap_or(0))).collect();
        // 방마다 본 자리 — 싼 말은 보낸 뒤에, 못 싼 말(나간 사람·사슬 없음)은 건너뛴 채로 적힌다
        let mut pos: std::collections::BTreeMap<String, u64> = left.iter().cloned().collect();
        let mut items: Vec<Value> = vec![];
        while !left.is_empty() {
            // history 하나 + 열쇠 묶음 둘(다 찬 것·남은 것)이 안 남으면 여기까지 — 싼 것은 보내고 자리를 적어 다음 바퀴에
            if calls.get() + 3 > MAX_CALLS {
                total += flush(&mut items, &t.device, true)?;
                e2e_state::mutate(dir, |s| s.handover_at.insert(t.device.clone(), pos.clone()))?;
                return Ok((total, Done::More));
            }
            let take: Vec<(String, u64)> = left.drain(..left.len().min(ROOMS)).collect();
            let (code, v) = call("/v0/me/late/history", &json!({ "for": t.device, "rooms": take.iter().map(|(r, a)| json!({ "room": r, "after": a })).collect::<Vec<_>>() }))?;
            match code {
                200 => {}
                // 옛 중계 — 건네주기 길이 없다. 끝난 게 아니라 물러섰다 다음 판에서
                404 => return Ok((total, Done::Old)),
                _ => return Err(Why::Other(relay::why(code, &v))),
            }
            let mut saw = |room: &str, seq: u64| {
                let p = pos.entry(room.to_string()).or_default();
                *p = (*p).max(seq);
            };
            for m in v["msgs"].as_array().into_iter().flatten() {
                let (Some(seq), Some(room)) = (m["seq"].as_u64(), m["room"].as_str()) else { continue };
                saw(room, seq);
                if let Some(l) = senders.rewrap(dir, kc, http, &st, &keys, m, t) {
                    items.push(json!({ "room": room, "seq": seq, "enc": l.enc, "w": l.w }));
                }
            }
            if let Some(next) = v["next"].as_object() {
                for (r, a) in next.iter().filter_map(|(r, a)| Some((r, a.as_u64()?))) {
                    saw(r, a);
                    left.push((r.clone(), a));
                }
            }
            // 다 찬 묶음만 먼저 — 남은 건 끝에 한 번에
            total += flush(&mut items, &t.device, left.is_empty())?;
        }
        // 모든 방을 끝까지 훑었다(중간 실패는 위에서 Err 로 나가 안 적힌다)
        e2e_state::mutate(dir, |s| {
            s.handed.insert(t.device.clone(), now_ms());
            s.handover_at.remove(&t.device);
        })?;
    }
    Ok((total, Done::All))
}

/// 보낸 사람 사슬 — 이 바퀴에서 계정마다 한 번만 새로 받는다(모르는 기기가 말마다 사슬을 다시 받게 하지 않게)
#[derive(Default)]
struct Senders {
    refreshed: std::collections::BTreeSet<String>,
}

impl Senders {
    /// 그 말을 받는 기기 몫으로 다시 봉한다 — 보낸 사람 사슬(지금 든 기기)로 서명을 확인한 것만. 못 하면 None(건너뜀)
    #[allow(clippy::too_many_arguments)]
    fn rewrap(&mut self, dir: &Path, kc: &dyn Store, http: &dyn Http, st: &relay::TeamState, keys: &crate::team_relay_keys::DeviceKeys, m: &Value, to: &Recipient) -> Option<e2e_envelope::Late> {
        let (account, device, body) = (m["from"]["account"].as_str()?, m["from"]["device"].as_str()?, m["body"].as_str()?);
        // 팀을 나간 사람 — 사슬을 새로 받지도 핀을 견주지도 않는다(캐시해 둔 믿은 사슬로만, 10-29). 다시 들어오면 그때 처음 믿기
        let mine = st.account.as_ref().is_some_and(|a| a.id == account);
        let member = m["from"]["member"].as_str().unwrap_or("");
        if !mine && !st.teams.iter().any(|t| t.members.iter().any(|x| x.id == member)) {
            let ed = e2e_state::trusted_chain(dir, account)?.devices.get(device)?.ed.clone();
            return e2e_envelope::rewrap(keys, &st.device_id, body, Some(&ed), to).ok();
        }
        let ed = |refresh| match e2e_state::chain_of(dir, kc, http, st, account, refresh) {
            Ok(Trust::Ok(c) | Trust::Changed(c)) => c.devices.get(device).map(|d| d.ed.clone()),
            _ => None,
        };
        let ed = match ed(false) {
            Some(e) => e,
            None if self.refreshed.insert(account.to_string()) => ed(true)?,
            None => return None,
        };
        e2e_envelope::rewrap(keys, &st.device_id, body, Some(&ed), to).ok()
    }
}

#[cfg(test)]
#[path = "e2e_handover_tests.rs"]
mod tests;
