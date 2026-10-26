//! 보안 번호 받아들이기(chammo-relay ADR 0007 결정 2·5, 시안 docs/design-drafts/e2e-safety v1) — 사람마다 상태(확인됨·바뀜·갈림·막아 둠)와 멈춘 말.
//! 받아들이기·막아 두기는 결정 대기함 카드 답(e2e_cards::decide — 데스크톱 메인 창·짝지은 폰)에서만, '같아요'(확인됨)·카드 다시 띄우기는 메인 창 명령에서만.
//! scripts/team·참모 길엔 없다(시험으로 고정)
use crate::e2e_chain;
use crate::e2e_state::{self, E2eStore, Held};
use crate::team_relay::TeamState;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

/// 멤버 화면·카드에 보이는 한 사람
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub account: String,
    pub team: String,
    pub member: String,
    pub name: String,
    /// ok(아직 안 견줌) · verified(확인됨) · changed(바뀜) · forked(갈림)
    pub state: String,
    pub verified_at: u64,
    pub blocked: bool,
    /// 나와 그 사람의 보안 번호(5자리 여섯 묶음) — 그 사람 지금(캐시) 사슬 신원으로
    pub number: String,
    /// 번호를 셈한 그 사람 사슬(신원·머리) — 카드에 싣고, 받아들일 때 그대로여야 핀을 박는다(6차 리뷰)
    pub identity: String,
    pub head: String,
    /// 갈림 — 이 사슬을 '다시 받기'로 받았나(받은 뒤에만 받아들이기)
    pub refetched: bool,
}

/// 멈춘 말 기한 — 평문이 오래 남지 않게
const HELD_KEEP_MS: u64 = 7 * 24 * 3600_000;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 그 사람 지금 캐시 사슬 (신원, 머리)
fn chain_id(s: &E2eStore, acc: &str) -> Option<(String, String)> {
    s.chains.get(acc).and_then(|l| e2e_chain::verify(acc, l).ok()).map(|c| (c.identity.clone(), c.head()))
}

/// 검증해 둔 명부 캐시에서 그 계정의 자리 — (팀, 멤버 id, 이름). 만든 사람·join 고리만(ADR 0007 R1)
fn place(s: &E2eStore, acc: &str) -> Option<(String, String, String)> {
    s.rosters.iter().find_map(|(team, links)| {
        links.iter().find_map(|l| {
            let b: Value = serde_json::from_str(&l.body).ok()?;
            let kind = b["kind"].as_str()?;
            (matches!(kind, "team" | "join") && b["account"] == acc).then(|| (team.clone(), b["member"].as_str().unwrap_or("").to_string(), b["displayName"].as_str().unwrap_or("").to_string()))
        })
    })
}

fn person_in(s: &E2eStore, my_acc: &str, acc: &str) -> Option<Person> {
    let pin = s.pins.get(acc)?;
    let (team, member, name) = place(s, acc)?;
    let (identity, head) = chain_id(s, acc).unwrap_or_default();
    let number = match s.pins.get(my_acc) {
        Some(me) if !identity.is_empty() => e2e_chain::safety_number(&me.identity, &identity),
        _ => String::new(),
    };
    let refetched = s.refetched.get(acc).is_some_and(|(i, h)| (i, h) == (&identity, &head));
    let verified_at = s.verified.get(acc).copied().unwrap_or(0);
    let state = match pin.state.as_str() {
        "ok" if verified_at > 0 => "verified",
        "ok" => "ok",
        other => other,
    };
    Some(Person { account: acc.into(), team, member, name, state: state.into(), verified_at, blocked: s.blocked.contains(acc), number, identity, head, refetched })
}

/// 내 계정 말고 핀이 있는(명부에서 만난) 사람들
pub fn people(dir: &Path, my_acc: &str) -> Vec<Person> {
    let s = e2e_state::load(dir);
    s.pins.keys().filter(|a| a.as_str() != my_acc).filter_map(|a| person_in(&s, my_acc, a)).collect()
}

pub fn person(dir: &Path, my_acc: &str, acc: &str) -> Option<Person> {
    person_in(&e2e_state::load(dir), my_acc, acc)
}

/// '같아요' — 번호를 견줬다(핀이 ok 일 때만 — 바뀜·갈림은 카드의 받아들이기로)
pub fn verify(dir: &Path, my_acc: &str, acc: &str) -> Result<(), String> {
    let p = person(dir, my_acc, acc).ok_or("그 사람을 명부에서 못 찾았어")?;
    if !matches!(p.state.as_str(), "ok" | "verified") {
        return Err("보안 번호가 바뀐 사람은 결정 대기함 카드에서 받아들여 줘".into());
    }
    e2e_state::mutate(dir, |s| {
        s.verified.insert(acc.into(), now_ms());
    })
}

pub(crate) const NEW_CARD: &str = "번호를 견주는 사이 그 사람 기기 사슬이 또 바뀌었어 — 새 카드로 다시 견줘 줘";

/// 받아들이기(카드 답에서만) — 카드에 띄운 그 사슬(신원·머리)이 지금 캐시와 같을 때만 새 핀으로(6차 리뷰: 견주는 사이 바꿔치기),
/// 갈림은 '다시 받기'한 그 사슬일 때만. 확인됨으로 적고, 그 사람 때문에 멈춘 말을 돌려준다(부르는 쪽이 보낸다)
pub(crate) fn accept(dir: &Path, acc: &str, identity: &str, head: &str) -> Result<Vec<Held>, String> {
    let s = e2e_state::load(dir);
    if chain_id(&s, acc).as_ref().map(|(i, h)| (i.as_str(), h.as_str())) != Some((identity, head)) {
        return Err(NEW_CARD.into());
    }
    if s.pins.get(acc).is_some_and(|p| p.state == "forked") && s.refetched.get(acc).map(|(i, h)| (i.as_str(), h.as_str())) != Some((identity, head)) {
        return Err("갈린 사람은 '다시 받기'로 사슬을 새로 받은 뒤 그 번호를 견줘야 받아들일 수 있어".into());
    }
    e2e_state::accept(dir, acc)?;
    // 받아들였으니 보관함 사람 목록·실패 물러서기를 지운다 — 바로 다시 읽게
    crate::team_locker_app::forget_people("");
    e2e_state::mutate(dir, |s| {
        s.verified.insert(acc.into(), now_ms());
        s.blocked.remove(acc);
        s.refetched.remove(acc);
        let (mine, rest): (Vec<Held>, Vec<Held>) = std::mem::take(&mut s.held).into_iter().partition(|h| h.account == acc);
        s.held = rest;
        mine
    })
}

/// 막아 두기(카드 답에서만) — 카드를 다시 안 띄운다. 보내기는 원래 막혀 있다(핀이 바뀜·갈림)
pub(crate) fn block(dir: &Path, acc: &str) -> Result<(), String> {
    e2e_state::mutate(dir, |s| {
        s.blocked.insert(acc.into());
    })
}

/// 멤버 화면 '카드 다시 띄우기' — 막아 둔 걸 풀어 결정 대기함에 카드가 다시 뜨게
pub fn unblock(dir: &Path, acc: &str) -> Result<(), String> {
    e2e_state::mutate(dir, |s| {
        s.blocked.remove(acc);
    })
}

/// 이 방의 상대가 보안 번호가 바뀌었거나 갈렸으면 그 계정 — 보내기가 막힌 까닭이 그것일 때만 말을 멈춰 둔다
pub fn stopped_peer(dir: &Path, st: &TeamState, room: &str) -> Option<String> {
    let r = st.rooms.iter().find(|r| r.id == room)?;
    let s = e2e_state::load(dir);
    let links = s.rosters.get(&r.team)?;
    let acc = links.iter().find_map(|l| {
        let b: Value = serde_json::from_str(&l.body).ok()?;
        (matches!(b["kind"].as_str(), Some("team" | "join")) && b["member"] == r.peer.as_str()).then(|| b["account"].as_str().unwrap_or("").to_string())
    })?;
    s.pins.get(&acc).filter(|p| matches!(p.state.as_str(), "changed" | "forked")).map(|_| acc)
}

/// 화면 줄 — 사람들 + 그 사람의 열린 보안 번호 카드 id(대화 '확인'이 같은 카드 답 문으로 가게)
pub fn view(dir: &Path) -> Value {
    let st = crate::team_relay::load_state(dir);
    let Some(me) = st.account.as_ref().map(|a| a.id.clone()) else { return Value::Array(vec![]) };
    let log = crate::direct::direct_log();
    Value::Array(
        people(dir, &me)
            .into_iter()
            .map(|p| {
                let card = crate::e2e_cards::card_of(&log, &p.account).unwrap_or_default();
                let mut v = serde_json::to_value(&p).unwrap_or_default();
                v["card"] = Value::from(card);
                v
            })
            .collect(),
    )
}

/// 갈린 사람을 '다시 받기'했다 — 지금 캐시 사슬을 받은 사슬로 적는다(부르는 쪽이 먼저 서버에서 새로 받는다)
pub(crate) fn mark_refetched(dir: &Path, acc: &str) -> Result<(), String> {
    let id = chain_id(&e2e_state::load(dir), acc).ok_or("그 사람 사슬을 못 받았어")?;
    e2e_state::mutate(dir, |s| {
        s.refetched.insert(acc.into(), id);
    })
}

fn fresh(h: &Held, now: u64) -> bool {
    h.at.saturating_add(HELD_KEEP_MS) >= now
}

pub fn hold(dir: &Path, h: Held) -> Result<(), String> {
    let now = now_ms();
    e2e_state::mutate(dir, |s| {
        s.held.retain(|x| fresh(x, now));
        if fresh(&h, now) && !s.held.iter().any(|x| x.cid == h.cid) {
            s.held.push(h);
        }
    })
}

/// 다시 보내기에 실패한 멈춘 말 — 목록으로 되돌린다(6차 리뷰)
pub(crate) fn put_back(dir: &Path, back: Vec<Held>) -> Result<(), String> {
    for h in back {
        hold(dir, h)?;
    }
    Ok(())
}

/// 멈춘 말(7일 안 것만)
pub fn held(dir: &Path) -> Vec<Held> {
    let now = now_ms();
    e2e_state::load(dir).held.into_iter().filter(|h| fresh(h, now)).collect()
}

#[cfg(test)]
#[path = "e2e_safety_tests.rs"]
mod tests;
