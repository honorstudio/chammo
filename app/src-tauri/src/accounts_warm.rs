//! 쉬는 계정 칸 미리 데우기 — 2026-10-15 17:0x 계정 바꾸기가 통째로 막혔다. 끼울 칸 토큰이 만료라 바꾸는 순간 토큰 주소에 갱신을 보냈는데
//! 이 맥 IP 단위로 429 가 왔다(가짜 갱신 토큰으로도 429 — 계정 문제가 아니다). 보관 칸 토큰은 쉬는 동안 몇 시간이면 만료된다(실측 39·95시간 지난 칸).
//! 그래서 앱이 쉬는 칸 토큰을 만료 전에 하나씩, 칸 사이 간격을 두고 새로 받아 둔다 — 바꾸는 순간엔 서버를 안 부르게(accounts_refresh::needs 가 false).
//!
//! - 지금 계정(키체인 로그인 칸)은 여기서 안 건드린다 — 그건 login_keep 이 Claude Code 갱신 잠금을 쥐고 따로 한다(ADR 0008, 엇갈리면 세션이 끊긴다).
//!   지금 칸·로그인 표시와 같은 계정 칸·로그인 칸과 같은 토큰을 가진 칸은 다 뺀다
//! - 막히면(rate) 모든 칸을 길게 쉰다(이 맥 IP 단위라 칸 하나만 쉬어선 소용없다) — 바꾸기·지금 로그인 미리와 같이 보는 token_rate 한 곳에서.
//!   갱신 토큰이 죽은 칸은 칸 값이 바뀔 때까지 다시 안 보낸다
//! - 자동 전환을 꺼 둔 사람·칸이 하나뿐인 사람은 안 돈다
//! - 보낼 때마다 기록 한 줄(토큰 값은 안 남긴다). 판단은 pick(순수), 키체인·파일은 run — 부르는 쪽(accounts_cmd)이 바꿔 끼우기와 같은 줄에 선다
use crate::accounts::{self, Error, Live, Pool, SLOT_SERVICE};
use crate::accounts_refresh::Refresher;
use crate::accounts_store::Store;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

/// 이만큼 안 남으면 데운다 — 토큰은 8시간짜리라 칸마다 하루 서너 번
pub const AHEAD_MS: i64 = 2 * 3600_000;
/// 아무 칸이든 보낸 뒤 다음 칸까지 — 한 번에 몰아 보내지 않게
pub const GAP_MS: i64 = 20 * 60_000;
/// 칸 하나가 실패하면(서버 오류·인터넷) 그 칸만 이만큼 쉰다. 막힘(rate)은 token_rate
pub const REST_MS: i64 = 3600_000;
const DAY_MS: i64 = 24 * 3600_000;

/// 데우기 기록 — accounts.json 의 warm(토큰 없음)
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Warm {
    /// 마지막으로 보낸 때(성공·실패 모두)
    pub last_at: i64,
    /// 보낸 횟수를 세는 날(UTC 날 번호)과 그날 보낸 횟수 — 기록 줄에 '몇 번째'로
    pub day: i64,
    pub sent: u32,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub slots: BTreeMap<String, WarmSlot>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WarmSlot {
    /// 이 칸은 이때까지 안 보낸다(인터넷·서버 오류)
    pub rest_until: i64,
    /// 갱신 토큰이 죽었을 때 그 칸의 만료 시각 — 칸 값이 바뀌면(다시 담음·쓰다 돌아옴) 다시 후보. 토큰 대신 시각으로 알아본다
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dead_exp: Option<i64>,
}

impl Warm {
    pub fn is_empty(&self) -> bool {
        *self == Warm::default()
    }
}

/// 후보 칸 — 만료 시각과 갱신 토큰이 있나만(토큰 값은 안 든다)
pub struct Cand {
    pub id: String,
    pub exp: Option<i64>,
    pub refreshable: bool,
}

/// 이번에 데울 칸(cands 의 번호) — 간격 안이면 없음. 곧 만료되는 칸부터(막혀 쉬는 중인지는 run 이 token_rate 로 먼저 본다)
pub fn pick(w: &Warm, cands: &[Cand], now: i64) -> Option<usize> {
    if now - w.last_at < GAP_MS {
        return None;
    }
    cands
        .iter()
        .enumerate()
        .filter(|(_, c)| c.refreshable)
        .filter_map(|(i, c)| c.exp.filter(|e| e - now < AHEAD_MS).map(|e| (i, c, e)))
        .filter(|(_, c, e)| w.slots.get(&c.id).is_none_or(|s| now >= s.rest_until && s.dead_exp != Some(*e)))
        .min_by_key(|(_, _, e)| *e)
        .map(|(i, _, _)| i)
}

/// 갱신 토큰이 죽어 다시 로그인해야 하는 칸들
pub fn dead_ids(pool: &Pool) -> Vec<String> {
    pool.warm.slots.iter().filter(|(_, s)| s.dead_exp.is_some()).map(|(id, _)| id.clone()).collect()
}

fn exp_of(p: &Value) -> Option<i64> {
    p.get("expiresAt").and_then(Value::as_i64)
}

fn refresh_token(p: &Value) -> Option<&str> {
    p.get("refreshToken").and_then(Value::as_str).filter(|r| !r.is_empty())
}

/// 한 차례 — 데웠으면(성공·실패) 그 칸 id. 키체인을 못 읽으면 오류(부르는 쪽이 다음 차례에 다시)
pub fn run(store: &dyn Store, live: &Live, list: &Path, now: i64, refresh: Refresher, log: &mut dyn FnMut(&str)) -> Result<Option<String>, Error> {
    let mut pool = accounts::load(list)?;
    let on = pool.auto.get("on") != Some(&Value::Bool(false)); // 화면 readAuto 와 같다 — 없으면 켜짐
    if !on || pool.accounts.len() < 2 || pool.switching.is_some() {
        return Ok(None);
    }
    let w = &pool.warm;
    if now - w.last_at < GAP_MS || crate::token_rate::resting(&crate::token_rate::load(&crate::token_rate::path_for(list)), now).is_some() {
        return Ok(None); // 키체인도 안 읽는다
    }
    // 지금 계정 — 지금 칸, 로그인 표시와 같은 계정 칸, 로그인 칸과 같은 갱신 토큰을 가진 칸(어긋난 중이어도 — 이건 고른 뒤에 본다)
    let live_key = accounts::read_oauth(&live.claude_json).as_ref().and_then(accounts::key);
    let mut cands = Vec::new();
    let mut parts = Vec::new();
    for a in &pool.accounts {
        if pool.current.as_deref() == Some(a.id.as_str()) || (live_key.is_some() && accounts::key(&a.oauth) == live_key) {
            continue;
        }
        let Some(p) = accounts::slot_part(store, &a.id)? else { continue };
        cands.push(Cand { id: a.id.clone(), exp: exp_of(&p), refreshable: refresh_token(&p).is_some() });
        parts.push(p);
    }
    // 죽은 칸 표시는 칸 값이 바뀌었으면 푼다
    let before = pool.warm.clone();
    for c in &cands {
        if let Some(s) = pool.warm.slots.get_mut(&c.id) {
            if s.dead_exp.is_some() && s.dead_exp != c.exp {
                s.dead_exp = None;
            }
        }
    }
    let ids: Vec<&str> = pool.accounts.iter().map(|a| a.id.as_str()).collect();
    pool.warm.slots.retain(|id, s| ids.contains(&id.as_str()) && *s != WarmSlot::default());
    // 고른 칸이 로그인 칸과 같은 갱신 토큰이면 빼고 다시 고른다 — 로그인 칸(security 명령)은 고를 게 있을 때만 읽는다
    let mut picked = pick(&pool.warm, &cands, now);
    if picked.is_some() {
        let live_rt = store.get(&live.service, &live.account)?.as_ref().and_then(accounts::part).as_ref().and_then(refresh_token).map(str::to_string);
        while let Some(i) = picked.filter(|i| live_rt.is_some() && refresh_token(&parts[*i]).map(str::to_string) == live_rt) {
            cands.remove(i);
            parts.remove(i);
            picked = pick(&pool.warm, &cands, now);
        }
    }
    let Some(i) = picked else {
        if pool.warm != before {
            accounts::save(list, &pool)?;
        }
        return Ok(None);
    };
    let (id, old) = (cands[i].id.clone(), &parts[i]);
    let left = exp_of(old).map(|e| (e - now) / 60_000).unwrap_or(0);
    let got = crate::token_rate::call(list, now, refresh, old, "warm", false);
    let w = &mut pool.warm;
    w.last_at = now;
    if w.day != now / DAY_MS {
        w.day = now / DAY_MS;
        w.sent = 0;
    }
    w.sent += 1;
    let n = w.sent;
    let dead_exp = exp_of(old).or(Some(0));
    let mut kept = Ok(());
    let what = match got {
        Ok(new) => {
            w.slots.remove(&id);
            // 옛 갱신 토큰은 방금 써 버렸다 — 새 것을 못 담으면 그 칸은 다시 담아야 한다(죽은 칸으로)
            kept = store.set(SLOT_SERVICE, &id, &accounts::slot_secret(&new)).map_err(Error::from);
            match &kept {
                Ok(()) => "ok".to_string(),
                Err(e) => {
                    w.slots.entry(id.clone()).or_default().dead_exp = dead_exp;
                    format!("notKept:{}", e.code())
                }
            }
        }
        Err(code) => {
            let s = w.slots.entry(id.clone()).or_default();
            if code == "dead" {
                s.dead_exp = dead_exp;
            } else if crate::token_rate::is_rate(&code) || code.starts_with("wait:") {
                // 막힘 — token_rate 가 세 길 모두 쉬게 적었다
            } else {
                s.rest_until = now + REST_MS;
            }
            code
        }
    };
    log(&format!("{id} {what} · left {left}m · today #{n}"));
    accounts::save(list, &pool)?;
    kept.map(|_| Some(id))
}

#[cfg(test)]
#[path = "accounts_warm_tests.rs"]
mod tests;
