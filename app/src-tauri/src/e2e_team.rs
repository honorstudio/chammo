//! 팀 명부 고리 쓰기 — chammo-relay ADR 0007 결정 6, 계획 2026-10-24 e2e-multiteam §2.6.
//! 팀 만들기·초대·들어오기 뒤에 고리를 올리고, 역할·빼기·나가기 요청엔 고리를 같이 싣는다(서버가 한 batch 로 저장).
//! 암호 전용(ADR 0007 R8) — 이 기기가 사슬에 든 뒤에만 팀을 만들고 들어온다(ready). 명부 없는 팀은 쓸 수 없다.
use crate::accounts_store::Store;
use crate::e2e_roster::{invite_seed, team_hash, TLink};
use crate::team_relay::{self as relay, Http, TeamState};
use crate::team_relay_keys::DeviceKeys;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use std::path::Path;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 고리 하나 — 이 기기 열쇠로 서명
fn tlink(k: &DeviceKeys, st: &TeamState, team: &str, seq: u64, prev: &str, f: Value) -> TLink {
    let mut b = json!({ "v": 1, "team": team, "seq": seq, "prev": prev, "by": st.device_id, "at": now_ms() });
    b.as_object_mut().expect("객체").extend(f.as_object().cloned().unwrap_or_default());
    let body = b.to_string();
    TLink { seq, sig: k.sign(&format!("chammo-team/1\n{body}")), body, sig2: None }
}

/// 명부 머리(다음 seq, prev). 명부가 없는 팀은 None
fn head(st: &TeamState, k: &DeviceKeys, http: &dyn Http, team: &str) -> Result<Option<(u64, String)>, String> {
    Ok(fetch_log(st, k, http, team)?.last().map(|l| (l.seq + 1, team_hash(l))))
}

fn fetch_log(st: &TeamState, k: &DeviceKeys, http: &dyn Http, team: &str) -> Result<Vec<TLink>, String> {
    let (code, v) = relay::call(http, &st.server, k, Some(&st.device_id), "GET", &format!("/v0/teams/{team}/log"), None)?;
    if code != 200 {
        return Err(relay::why(code, &v));
    }
    serde_json::from_value(v["links"].clone()).map_err(|e| e.to_string())
}

// ── 기억한 명부 끝 이어 가기(10-31) — 확인해 둔 명부(디스크) 끝으로 쓰니, 내가 쓴 고리가 받아들여지면 그 끝에 붙인다(안 붙이면 다음 쓰기가 늘 409).
//    새로 받은 명부는 기억한 명부를 그대로 앞에 둔 것만 받아 둔다(앞을 바꾼 명부는 안 받는다 — 쓸 때 roster_with 가 다시 검증한다) ──

/// 서버가 받아들인 내 고리(link_for 가 만든 값) — 기억한 명부 끝 바로 다음이면 붙인다
pub fn remember(dir: &Path, team: &str, link: &Value) {
    let Ok(l) = serde_json::from_value::<TLink>(link.clone()) else { return };
    let prev = serde_json::from_str::<Value>(&l.body).ok().and_then(|b| b["prev"].as_str().map(String::from)).unwrap_or_default();
    let _ = crate::e2e_state::mutate(dir, |s| {
        if let Some(c) = s.rosters.get_mut(team) {
            if c.last().is_some_and(|t| t.seq + 1 == l.seq && team_hash(t) == prev) {
                c.push(l);
            }
        }
    });
}

/// 새로 받은 명부가 기억한 명부를 앞에 그대로 두고 늘었으면 받아 둔다
fn extend_cached(dir: &Path, team: &str, links: &[TLink]) {
    let _ = crate::e2e_state::mutate(dir, |s| {
        if let Some(c) = s.rosters.get_mut(team) {
            if links.len() > c.len() && links[..c.len()].iter().zip(c.iter()).all(|(a, b)| a.seq == b.seq && team_hash(a) == team_hash(b)) {
                *c = links.to_vec();
            }
        }
    });
}

/// 고리 올리기 — 올렸으면 true, 이 기기가 사슬 밖이라 고리 없이 갔으면 false
fn post(st: &TeamState, k: &DeviceKeys, http: &dyn Http, team: &str, l: &TLink) -> Result<bool, String> {
    let (code, v) = relay::call(http, &st.server, k, Some(&st.device_id), "POST", &format!("/v0/teams/{team}/log"), Some(&json!({ "link": l })))?;
    posted(code, &v)
}

fn posted(code: u16, v: &Value) -> Result<bool, String> {
    match code {
        201 => Ok(true),
        // 이 기기가 아직 사슬 밖 — 고리 없이(전환기)
        403 if v["error"] == "not_in_chain" => Ok(false),
        _ => Err(relay::why(code, v)),
    }
}

/// 이 기기가 내 계정 사슬에 든 게 저장돼 있나(ensure 가 5분마다 받아 둔다) — 아니면 고리를 안 쓴다(쓸데없는 요청 없이)
pub fn in_chain(dir: &Path, st: &TeamState) -> bool {
    let Some(acc) = st.account.as_ref().map(|a| a.id.clone()) else { return false };
    let store = crate::e2e_state::load(dir);
    // 핀이 ok(내가 믿은 신원 그대로)일 때만 — 바뀐·갈린 내 사슬로는 고리를 안 쓴다(리뷰 B 치명 2)
    let pinned_ok = store.pins.get(&acc).is_some_and(|p| p.state == "ok");
    pinned_ok && store.chains.get(&acc).and_then(|l| crate::e2e_chain::verify(&acc, l).ok()).is_some_and(|c| store.pins[&acc].identity == c.identity && c.devices.contains_key(&st.device_id))
}

/// 팀 만들기·들어오기 전에 — 이 기기가 내 계정 사슬에 들었나(R8 암호 전용)
/// 계정 없는 옛 초대 기기도 막는다 — 봉투를 못 만들어 어차피 못 쓴다(R8, 5차 리뷰)
pub fn ready(dir: &Path) -> Result<(), String> {
    if in_chain(dir, &relay::load_state(dir)) { Ok(()) } else { Err(crate::e2e_state::NOT_READY.into()) }
}

fn ctx(dir: &Path, kc: &dyn Store) -> Result<Option<(TeamState, DeviceKeys)>, String> {
    let st = relay::load_state(dir);
    if !in_chain(dir, &st) {
        return Ok(None); // 옛 초대 기기·아직 사슬 밖 — 고리 없이(전환기)
    }
    let k = relay::device_keys(kc, &st)?;
    Ok(Some((st, k)))
}

/// 팀을 만든 뒤 — 명부 첫 고리(나 = 팀장)
pub fn after_create(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, member: &str, display: &str, name: &str) -> Result<(), String> {
    let Some((st, k)) = ctx(dir, kc)? else { return Ok(()) };
    let acc = st.account.as_ref().map(|a| a.id.clone()).unwrap_or_default();
    post(&st, &k, http, team, &tlink(&k, &st, team, 0, "", json!({ "kind": "team", "name": name, "member": member, "account": acc, "displayName": display }))).map(|_| ())
}


/// 초대를 만든 뒤 — 초대 코드에서 끌어낸 공개 열쇠를 팀장이 서명(서버는 코드 해시만 가진다)
pub fn after_invite(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, code: &str, expires: u64) -> Result<(), String> {
    let inv = B64.encode(SigningKey::from_bytes(&invite_seed(code)).verifying_key().as_bytes());
    let f = json!({ "kind": "invite", "invPub": inv, "role": "member", "expires": expires });
    // 확인해 둔 명부 끝으로 먼저, 서버가 그새 늘었다(409 stale_head)면 새로 받아 한 번 더 — link_for 와 같은 길
    let send = |l: Option<Value>| -> Result<Option<(u16, Value)>, String> {
        let (Some(l), Some((st, k))) = (l, ctx(dir, kc)?) else { return Ok(None) };
        relay::call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{team}/log"), Some(&json!({ "link": l }))).map(Some)
    };
    let mut l = link_for(dir, kc, http, team, f.clone())?;
    let mut r = send(l.clone())?;
    if r.as_ref().is_some_and(|(c, v)| *c == 409 && v["error"] == "stale_head") {
        l = link_fresh(dir, kc, http, team, f)?;
        r = send(l.clone())?;
    }
    match r {
        Some((c, v)) => {
            let ok = posted(c, &v)?;
            if ok {
                if let Some(l) = &l {
                    remember(dir, team, l);
                }
            }
            Ok(())
        }
        None => Ok(()),
    }
}

/// 초대로 들어온 뒤 — 내 사슬 기기 서명 + 초대 코드 열쇠 서명(sig2)
pub fn after_join(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, code: &str, member: &str, display: &str) -> Result<(), String> {
    let Some((st, k)) = ctx(dir, kc)? else { return Ok(()) };
    let Some((seq, prev)) = head(&st, &k, http, team)? else { return Ok(()) };
    let code_key = SigningKey::from_bytes(&invite_seed(code));
    let acc = st.account.as_ref().map(|a| a.id.clone()).unwrap_or_default();
    let inv = B64.encode(code_key.verifying_key().as_bytes());
    let mut l = tlink(&k, &st, team, seq, &prev, json!({ "kind": "join", "invPub": inv, "member": member, "account": acc, "displayName": display }));
    l.sig2 = Some(B64.encode(code_key.sign(format!("chammo-team/1\n{}", l.body).as_bytes()).to_bytes()));
    post(&st, &k, http, team, &l).map(|_| ())
}

/// 역할·빼기·나가기 요청에 실을 고리 — 명부가 없는 팀은 None(예전처럼 고리 없이)
pub fn link_for(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, f: Value) -> Result<Option<Value>, String> {
    link_at(dir, kc, http, team, f, false)
}

/// link_for 인데 명부 끝을 서버에서 새로 — 서버가 409 stale_head(그새 명부가 늘었다)라 한 뒤 한 번 더 보낼 때
pub fn link_fresh(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, f: Value) -> Result<Option<Value>, String> {
    link_at(dir, kc, http, team, f, true)
}

/// 명부 끝 — 확인해 둔 명부(디스크, roster_with 가 검증해 적은 것)가 있으면 망 없이 그 끝으로. 틀렸으면 서버가 409 stale_head 로 거절한다
/// (10-31 실측: 권한 칩·초대마다 쓰기 전에 GET log 로 명부 전체를 받았다)
fn link_at(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, f: Value, fresh: bool) -> Result<Option<Value>, String> {
    let Some((st, k)) = ctx(dir, kc)? else { return Ok(None) };
    let tip = if fresh { None } else { crate::e2e_state::load(dir).rosters.get(team).and_then(|c| c.last().map(|l| (l.seq + 1, team_hash(l)))) };
    let Some((seq, prev)) = (match tip {
        Some(t) => Some(t),
        None => {
            let links = fetch_log(&st, &k, http, team)?;
            extend_cached(dir, team, &links);
            links.last().map(|l| (l.seq + 1, team_hash(l)))
        }
    }) else {
        return Ok(None);
    };
    Ok(Some(serde_json::to_value(tlink(&k, &st, team, seq, &prev, f)).map_err(|e| e.to_string())?))
}

/// 단톡방 만들기·바꾸기 고리(계획 2026-10-26 team-rooms) — 서버가 방 바꾸기와 한 batch 로 저장한다. 사슬 밖·명부 없는 팀은 못 쓴다(R8)
pub fn room_link(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, room: &str, name: &str, members: &[String]) -> Result<Value, String> {
    let Some((st, k)) = ctx(dir, kc)? else { return Err(crate::e2e_state::NOT_READY.into()) };
    let Some((seq, prev)) = head(&st, &k, http, team)? else { return Err(crate::e2e_state::NO_ROSTER.into()) };
    let member = st.team(team)?.member_id.clone();
    let acc = st.account.as_ref().map(|a| a.id.clone()).unwrap_or_default();
    let l = tlink(&k, &st, team, seq, &prev, json!({ "kind": "room", "room": room, "name": name, "members": members, "member": member, "account": acc }));
    serde_json::to_value(l).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "e2e_team_tests.rs"]
mod tests;
