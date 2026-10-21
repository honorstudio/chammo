//! 지금 로그인 미리 갱신(ADR 0008) — Claude Code 는 지금 로그인을 만료 5분 전쯤 한 번만 갱신한다. 그 순간 토큰 주소가 이 맥 IP 를 429 로 막고 있으면
//! 세션들이 멈춘다(2026-10-15 17시~ 몇 시간). 그래서 앱이 남은 시간이 60분 아래가 되면 Claude Code 와 같은 갱신 잠금을 쥐고 대신 갱신하고,
//! 막히면(rate) 바꾸기·데우기와 같이 보는 token_rate 쉬기가 풀릴 때까지 안 부른다 — 10분마다 다시 두드리면 막힘이 늘었다(2026-10-15).
//! 예외는 하나: 만료 20분 안이면 쉬는 중이어도 딱 한 번(세션이 멈추기 직전 마지막 기회), 그것도 막히면 바로 카드.
//! 막힘이 아닌 실패(인터넷·잠금 등)는 10분 뒤 다시. 만료 15분 전까지 못 받았거나 갱신 토큰이 죽었으면 그때만 '로그인' 카드(need).
//!
//! - 잠금 없이는 절대 안 한다 — 설정 폴더(잠금 자리)를 모르면 안 돈다. 잠금을 잡은 뒤 키체인을 다시 읽어 세션이 먼저 갱신했으면 서버를 안 부른다
//! - 키체인 지금 칸은 계정 로그인(claudeAiOauth)만 바꾼다 — MCP 로그인·.claude.json 계정 표시·다른 칸은 그대로.
//!   같은 갱신 토큰을 든 보관 칸과 지금 칸(같은 계정일 때)엔 같은 새 값 — 안 그러면 다음 바꾸기 때 죽은 토큰을 끼운다
//! - 계정 풀과 상관없는 기본 기능 — 자동 전환을 꺼도·칸이 없어도 돈다. 만료 시각·갱신 토큰이 없는 로그인(API 키 등)은 안 돈다
//! - 기록은 남은 분·결과 낱말만(토큰·이메일 없음). 판단은 need(순수), 키체인·파일은 tick — 부르는 쪽(accounts_cmd)이 바꿔 끼우기와 같은 줄에 선다
use crate::accounts::{self, Error, Live, SLOT_SERVICE};
use crate::accounts_refresh::{hold, LockError, Refresher};
use crate::accounts_store::Store;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

const MIN: i64 = 60_000;
/// 이만큼 안 남으면 대신 갱신한다
pub const AHEAD_MS: i64 = 60 * MIN;
/// 실패하면(막힘 말고) 이만큼 뒤 다시
pub const RETRY_MS: i64 = 10 * MIN;
/// 이만큼 안 남았으면 막혀 쉬는 중이어도 딱 한 번 부른다
pub const LAST_MS: i64 = 20 * MIN;
/// 이만큼 안 남았는데 못 받았으면 카드
pub const LATE_MS: i64 = 15 * MIN;
/// 넉넉해도 이만큼마다 한 번은 본다 — 계정 바꾸기·다시 로그인으로 만료 시각이 앞당겨질 수 있다
pub const LOOK_MAX_MS: i64 = 15 * MIN;
/// 카드 판단은 이만큼 안에 본 것만 — 앱이 꺼져 있던 동안의 옛 기록으로 카드를 띄우지 않게
pub const FRESH_MS: i64 = 5 * MIN;

/// 상태 — <데이터>/login-keep.json(토큰 없음)
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Keep {
    /// 다음에 서버를 부를 수 있는 때(넉넉하면 다음에 키체인을 볼 때)
    pub next_at: i64,
    /// 마지막으로 본 만료 시각과 본 때
    pub exp: Option<i64>,
    pub seen_at: i64,
    /// 마지막 결과 낱말 — ok·session(세션이 먼저 갱신)·busy·rate·network·dead·notKept 등
    pub last: String,
    /// 연달아 실패한 횟수
    pub fails: u32,
    /// 갱신 토큰이 죽었을 때(또는 새 값을 못 담았을 때) 그 만료 시각 — 로그인이 바뀌면(시각이 달라지면) 풀린다
    pub dead_exp: Option<i64>,
    /// 쉬는 중 마지막 한 번(만료 20분 안)을 쓴 로그인의 만료 시각 — 로그인마다 한 번
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chance: Option<i64>,
}

/// 카드가 필요한가 — "dead"(갱신 토큰이 죽음) · "late"(만료 15분 안인데 못 받음, 또는 마지막 한 번도 막힘). 최근에 본 것만
pub fn need(k: &Keep, now: i64) -> Option<&'static str> {
    if k.seen_at == 0 || now - k.seen_at > FRESH_MS {
        return None;
    }
    if k.dead_exp.is_some() {
        return Some("dead");
    }
    k.exp.filter(|e| e - now < LATE_MS || (k.chance == Some(*e) && crate::token_rate::is_rate(&k.last))).map(|_| "late")
}

pub fn load_keep(p: &Path) -> Keep {
    std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save_keep(p: &Path, k: &Keep) -> Result<(), Error> {
    accounts::write_atomic(p, &(serde_json::to_string(k).map_err(|e| Error::Io(e.to_string()))? + "\n"))
}

fn exp_of(o: &Value) -> Option<i64> {
    o.get("expiresAt").and_then(Value::as_i64)
}

fn refresh_token(o: &Value) -> Option<&str> {
    o.get("refreshToken").and_then(Value::as_str).filter(|r| !r.is_empty())
}

/// 갱신할 수 있는 계정 로그인 — 만료 시각과 갱신 토큰이 둘 다 있어야(API 키·옛 로그인은 없다)
fn live_part(store: &dyn Store, live: &Live) -> Result<(Option<crate::accounts_store::Secret>, Option<Value>), Error> {
    let s = store.get(&live.service, &live.account)?;
    let p = s.as_ref().and_then(accounts::part).filter(|p| exp_of(p).is_some() && refresh_token(p).is_some());
    Ok((s, p))
}

/// 막혀 쉬는 동안 다음에 볼 때 — 쉬기가 풀릴 때, 아직 마지막 한 번을 안 썼으면 그보다 먼저 만료 20분 전
fn rest_next(until: i64, exp: i64, k: &Keep) -> i64 {
    if k.chance == Some(exp) {
        until
    } else {
        until.min(exp - LAST_MS)
    }
}

fn mins(ms: i64) -> i64 {
    ms.div_euclid(MIN)
}

/// 넉넉할 때 다음에 볼 때 — 만료 60분 전, 늦어도 15분 뒤
fn next_look(exp: i64, now: i64) -> i64 {
    (exp - AHEAD_MS).min(now + LOOK_MAX_MS)
}

/// 새 토큰을 받은 뒤 — 넉넉하면 next_look, 받은 것도 60분이 안 되면(서버가 짧게 줌) 10분 뒤. 매분 서버를 부르지 않게
fn after_new(exp: i64, now: i64) -> i64 {
    if exp - now >= AHEAD_MS {
        next_look(exp, now)
    } else {
        now + RETRY_MS
    }
}

/// 한 차례 — 앱이 1분마다 부른다. 볼 때가 아니면 키체인도 안 읽는다(만료 15분 안·죽은 동안은 매 차례 본다 — 세션·사람이 고쳤으면 카드를 내리게)
pub fn tick(store: &dyn Store, live: &Live, list: &Path, state: &Path, now: i64, refresh: Refresher, log: &mut dyn FnMut(&str)) -> Result<(), Error> {
    let Some(dir) = &live.claude_dir else { return Ok(()) };
    let before = load_keep(state);
    // 카드가 떠 있을 수 있는 동안(죽음·15분 안·마지막 한 번도 막힘)은 매 차례 본다 — 안 보면 5분 뒤 카드가 꺼진다(FRESH_MS)
    let watch = before.dead_exp.is_some() || before.exp.is_some_and(|e| e - now < LATE_MS || (before.chance == Some(e) && crate::token_rate::is_rate(&before.last)));
    if now < before.next_at && !watch {
        return Ok(());
    }
    let mut k = before.clone();
    let r = step(store, live, list, dir, &mut k, now, refresh, log);
    let (was, is) = (need(&before, now), need(&k, now));
    if was != is {
        log(&format!("card {}", is.unwrap_or("off")));
    }
    save_keep(state, &k)?;
    r
}

#[allow(clippy::too_many_arguments)]
fn step(store: &dyn Store, live: &Live, list: &Path, dir: &Path, k: &mut Keep, now: i64, refresh: Refresher, log: &mut dyn FnMut(&str)) -> Result<(), Error> {
    let (_, Some(o)) = live_part(store, live)? else {
        // 로그아웃·API 키 — 할 게 없다. 카드도 없음(로그아웃은 login 쪽이 따로 본다)
        *k = Keep { next_at: now + LOOK_MAX_MS, ..Keep::default() };
        return Ok(());
    };
    let exp = exp_of(&o).unwrap_or(0);
    k.exp = Some(exp);
    k.seen_at = now;
    if k.dead_exp.is_some_and(|d| d != exp) {
        k.dead_exp = None; // 다시 로그인했다
        k.fails = 0;
    }
    if k.dead_exp.is_some() {
        return Ok(());
    }
    if exp - now >= AHEAD_MS {
        k.next_at = next_look(exp, now);
        k.fails = 0;
        return Ok(());
    }
    if now < k.next_at {
        return Ok(()); // 막혀서 쉬는 중 — 보기만
    }
    let left = mins(exp - now);
    // 토큰 주소가 막혀 쉬는 중(세 길이 같이 보는 token_rate) — 만료 20분 안 마지막 한 번만 예외
    let rp = crate::token_rate::path_for(list);
    let rate = crate::token_rate::load(&rp);
    let last_chance = crate::token_rate::resting(&rate, now).is_some() && exp - now <= LAST_MS && k.chance != Some(exp);
    if let Some(rest) = crate::token_rate::resting(&rate, now).filter(|_| !last_chance) {
        if k.last != "wait" {
            log(&format!("wait · left {left}m · rest {}m", mins(rest)));
        }
        k.last = "wait".into();
        k.next_at = rest_next(rate.until, exp, k);
        return Ok(());
    }
    // 여기서부터 키체인 쓰기까지 Claude Code 갱신 잠금을 쥔다 — 그동안 세션은 갱신을 못 한다
    let _held = match hold(dir) {
        Ok(h) => h,
        Err(LockError::Busy) => {
            k.last = "busy".into();
            k.next_at = now; // 세션이 갱신하는 중 — 다음 차례에 다시 본다
            log(&format!("busy · left {left}m"));
            return Ok(());
        }
        Err(LockError::Io(_)) => {
            k.last = "lockIo".into();
            k.next_at = now + RETRY_MS;
            log(&format!("lockIo · left {left}m"));
            return Ok(());
        }
    };
    // 잠금 안에서 다시 읽는다 — 기다리는 사이 세션이 먼저 갱신했으면 그 값이 맞다(옛 갱신 토큰은 이미 죽었다)
    let (now_secret, again) = live_part(store, live)?;
    let Some(cur) = again else {
        *k = Keep { next_at: now + LOOK_MAX_MS, ..Keep::default() };
        return Ok(());
    };
    if refresh_token(&cur) != refresh_token(&o) || exp_of(&cur) != Some(exp) {
        let e2 = exp_of(&cur).unwrap_or(0);
        k.exp = Some(e2);
        k.last = "session".into();
        k.fails = 0;
        k.next_at = after_new(e2, now);
        log(&format!("session · left {}m", mins(e2 - now)));
        return Ok(());
    }
    if last_chance {
        k.chance = Some(exp);
        log(&format!("lastChance · left {left}m"));
    }
    match crate::token_rate::call(list, now, refresh, &cur, "keep", last_chance) {
        Ok(new) => {
            // 옛 갱신 토큰은 방금 죽었다 — 새 값을 지금 칸에 바로. 못 담으면 그 로그인은 다시 해야 한다(카드)
            if let Err(e) = store.set(&live.service, &live.account, &accounts::with_part(now_secret.as_ref(), &new)) {
                k.last = "notKept".into();
                k.dead_exp = Some(exp);
                k.fails += 1;
                log(&format!("notKept:{} · left {left}m", Error::from(e).code()));
                return Ok(());
            }
            let slots = keep_slots(store, live, list, &cur, &new);
            let e2 = exp_of(&new).unwrap_or(0);
            k.exp = Some(e2);
            k.last = "ok".into();
            k.fails = 0;
            k.next_at = after_new(e2, now);
            log(&format!("ok · left {left}m → {}m{slots}", mins(e2 - now)));
        }
        Err(code) => {
            k.fails += 1;
            k.next_at = if crate::token_rate::is_rate(&code) || code.starts_with("wait:") {
                rest_next(crate::token_rate::load(&rp).until, exp, k)
            } else {
                now + RETRY_MS
            };
            if code == "dead" {
                k.dead_exp = Some(exp);
            }
            log(&format!("{code} · left {left}m · try #{}", k.fails));
            k.last = code;
        }
    }
    Ok(())
}

/// 보관 칸 맞추기 — 옛 갱신 토큰을 든 칸, 그리고 지금 칸(계정 표시와 같은 계정일 때)에 새 값. 다른 칸은 안 건드린다. 기록 꼬리를 준다(실패만)
fn keep_slots(store: &dyn Store, live: &Live, list: &Path, old: &Value, new: &Value) -> String {
    let Ok(pool) = accounts::load(list) else { return " · slots ?".into() };
    let live_key = accounts::read_oauth(&live.claude_json).as_ref().and_then(accounts::key);
    let old_rt = refresh_token(old);
    let mut bad = 0;
    for a in &pool.accounts {
        let current = pool.current.as_deref() == Some(a.id.as_str()) && live_key.is_some() && accounts::key(&a.oauth) == live_key;
        let held = match accounts::slot_part(store, &a.id) {
            Ok(p) => p.as_ref().and_then(refresh_token).is_some_and(|r| Some(r) == old_rt),
            Err(_) => false,
        };
        // 지금 칸이어도 그 토큰이 남의 계정 것이면 안 쓴다(되쓴 옛 계정 토큰, ⑤-2) — 옛 갱신 토큰을 든 칸(held)은 계보가 확실하다
        let current = current && !accounts::foreign(live, new, &a.oauth);
        if (current || held) && store.set(SLOT_SERVICE, &a.id, &accounts::slot_secret(new)).is_err() {
            bad += 1;
        }
    }
    if bad > 0 {
        format!(" · slotNotKept {bad}")
    } else {
        String::new()
    }
}

#[cfg(test)]
#[path = "login_keep_tests.rs"]
mod tests;
