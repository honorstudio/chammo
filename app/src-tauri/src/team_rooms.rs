//! 팀 단톡방(여럿) — 만들기·이름·사람 넣고 빼기·나가기 (chammo-relay 계획 2026-10-26 team-rooms, 시안 docs/design-drafts/msg-rooms).
//! 방 사람·이름은 명부 room 고리로만 바뀐다(서버가 같은 batch 에 저장) — 봉투를 받을 사람도 명부에서 센다(e2e_state::wrap).
//! 바꿀 땐 지금 명부의 방 사람에서 시작한다(서버 목록이 아니라) — 서버가 끼운 사람을 내 서명으로 굳히지 않게
use crate::accounts_store::Store;
use crate::team_relay::{self as relay, Http, Room, TeamEntry, TeamState};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

/// 한 방 사람 상한 — 서버 MAX_MEMBERS 와 같다
pub const MAX_PEOPLE: usize = 50;

/// '전체' 팀챗 이름 — 어느 언어로 만들었든(화면 domain/teamAllRoom ALL_NAMES 와 같다)
pub const ALL_NAMES: [&str; 2] = ["전체", "Everyone"];
/// 서버가 이미 있는 방 id 라고 거절함(409 room_exists) — 다른 기기가 먼저 만들었다
const ROOM_EXISTS: &str = "room_exists";

/// 팀마다 정해진 '전체' 팀챗 id — 팀장 기기 둘이 같이 만들어도 서버가 둘째를 409 로 막는다(10-26 '전체' 셋 사고)
pub fn all_room_id(team: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut b: [u8; 16] = Sha256::digest(format!("chammo-all-room/1\n{team}")).as_slice()[..16].try_into().expect("16");
    b[6] = (b[6] & 0x0f) | 0x80;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

fn uuid4() -> Result<String, String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).map_err(|e| format!("난수 실패 {e}"))?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32]))
}

/// 그 팀 사람 하나 — 멤버 id 그대로, 아니면 계정 이름이나 프로필 이름(aka, 대소문자 무시, 하나만 맞을 때)
pub fn pick(t: &TeamEntry, who: &str, aka: &BTreeMap<String, String>) -> Result<String, String> {
    let q = who.trim();
    if t.member_id == q || t.members.iter().any(|m| m.id == q) {
        return Ok(q.to_string());
    }
    let low = q.to_lowercase();
    let named = |m: &relay::Member| m.display_name.trim().to_lowercase() == low || aka.get(&m.id).is_some_and(|a| a.trim().to_lowercase() == low);
    let hits: Vec<&relay::Member> = t.members.iter().filter(|m| named(m)).collect();
    match hits.as_slice() {
        [m] => Ok(m.id.clone()),
        [] => Err(format!("{} 팀에 그런 사람이 없어: {q}", t.name)),
        _ => Err(format!("{} 팀에 '{q}' 이름이 여럿이야 — 멤버 id 로", t.name)),
    }
}

/// 방에 넣을 사람 — 서명된 명부에서 지금 팀 사람이어야, 이름으로 골랐으면 명부의 이름도 서버 목록 이름과 같아야(서버가 이름 ↔ 멤버 id 를 바꿔 엉뚱한 사람을 넣지 못하게,
/// 이미 빠진 사람을 넣어 내 서명 고리가 명부 틀림이 되지 않게 — 공격 리뷰 6). 프로필 이름으로 골라도 같은 대조(프로필 이름 ↔ 멤버 id 는 그 사람 기기 서명으로 연 보관함 파일에서 온다)
fn pick_signed(roster: &crate::e2e_roster::Roster, t: &TeamEntry, who: &str, aka: &BTreeMap<String, String>) -> Result<String, String> {
    signed_ok(roster, t, who, pick(t, who, aka)?)
}

fn signed_ok(roster: &crate::e2e_roster::Roster, t: &TeamEntry, who: &str, m: String) -> Result<String, String> {
    let p = roster.members.get(&m).filter(|p| p.active).ok_or_else(|| format!("{} 은(는) 서명된 팀 명부에 없거나 빠졌어 — 방에 안 넣었어", who.trim()))?;
    let listed = t.members.iter().find(|x| x.id == m).map(|x| x.display_name.trim().to_lowercase()).unwrap_or_default();
    if m != who.trim() && p.display_name.trim().to_lowercase() != listed {
        return Err(format!("'{}' 이름이 서버 목록과 서명된 명부에서 달라 — 멤버 id 로 골라 줘", who.trim()));
    }
    Ok(m)
}

/// 단톡방 고르기 — 방 id 그대로, 아니면 이름(하나만 맞을 때)
pub fn find_room<'a>(st: &'a TeamState, sel: &str) -> Result<&'a Room, String> {
    let q = sel.trim();
    let groups = || st.rooms.iter().filter(|r| r.kind == "group");
    if let Some(r) = groups().find(|r| r.id == q) {
        return Ok(r);
    }
    let low = q.to_lowercase();
    let hits: Vec<&Room> = groups().filter(|r| r.name.trim().to_lowercase() == low).collect();
    match hits.as_slice() {
        [r] => Ok(r),
        [] => Err(format!("그런 팀챗이 없어: {q} — scripts/team teamchat list")),
        _ => Err(format!("'{q}' 이름 팀챗이 여럿이야 — 팀챗 id 로")),
    }
}

/// 단톡방 만들기 — 나 + 고른 사람. 방 id 는 여기서 정한다(고리에 먼저 넣어 서명해야 해서)
pub fn create_room(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, name: &str, people: &[String]) -> Result<Room, String> {
    create_room_id(dir, kc, http, team, name, people, None)
}

/// '전체' 팀챗 — 없을 때만 만든다. 서버 방 목록을 새로 받아 보고(화면 목록이 낡았을 수 있다), 명부에 예전에 지운 '전체'가 있으면
/// 다시 안 만든다(팀장이 지웠다). 만들었으면 방 id
pub fn ensure_all_room(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, name: &str, people: &[String]) -> Result<Option<String>, String> {
    let st = relay::sync_rooms(dir, kc, http)?;
    let t = st.team(team)?.clone();
    let id = all_room_id(&t.id);
    let named = |n: &str| ALL_NAMES.contains(&n.trim());
    if st.rooms.iter().any(|r| r.kind == "group" && r.team == t.id && (r.id == id || named(&r.name))) {
        return Ok(None);
    }
    let roster = crate::e2e_state::roster_of(dir, kc, http, &st, &t.id)?;
    if roster.rooms.iter().any(|(rid, r)| *rid == id || named(&r.name)) {
        return Ok(None);
    }
    match create_room_id(dir, kc, http, &t.id, name, people, Some(id)) {
        Ok(r) => Ok(Some(r.id)),
        Err(e) if e == ROOM_EXISTS => Ok(None),
        Err(e) => Err(e),
    }
}

fn create_room_id(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, name: &str, people: &[String], fixed: Option<String>) -> Result<Room, String> {
    let st = relay::load_state(dir);
    let t = st.team(team)?.clone();
    let name = crate::team_ui::name_ok(name).ok_or("방 이름은 1~40자")?;
    // 이름 고르기(망 없이)를 먼저 — 모르는 사람은 서버에 가기 전에 막는다. 그다음 서명된 명부로 한 번 더(공격 리뷰 6)
    let aka = crate::team_profile::cached_names(dir, kc, &t.id);
    let picked: Vec<(String, String)> = people.iter().map(|p| pick(&t, p, &aka).map(|m| (p.clone(), m))).collect::<Result<_, _>>()?;
    let roster = crate::e2e_state::roster_of(dir, kc, http, &st, &t.id)?;
    let mut members = vec![t.member_id.clone()];
    for (who, m) in picked {
        let m = signed_ok(&roster, &t, &who, m)?;
        if !members.contains(&m) {
            members.push(m);
        }
    }
    if members.len() > MAX_PEOPLE {
        return Err(format!("한 방은 {MAX_PEOPLE}명까지야"));
    }
    let id = match fixed {
        Some(id) => id,
        None => uuid4()?,
    };
    let link = crate::e2e_team::room_link(dir, kc, http, &t.id, &id, &name, &members)?;
    let k = relay::device_keys(kc, &st)?;
    let (code, v) = relay::call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/rooms", t.id), Some(&json!({ "roomId": id, "link": link })))?;
    if code == 409 && v["error"] == ROOM_EXISTS {
        return Err(ROOM_EXISTS.into());
    }
    if code != 201 {
        return Err(relay::why(code, &v));
    }
    let room = Room { id, kind: "group".into(), team: t.id.clone(), name, members, ..Default::default() };
    let r = room.clone();
    relay::mutate_if(dir, &st.device_id, move |s| {
        if !s.rooms.iter().any(|x| x.id == r.id) {
            s.rooms.push(r);
        }
    })?;
    Ok(room)
}

/// 이름·사람 바꾸기 — 지금 명부의 방 사람(팀에서 빠진 사람은 뺀)에서 add·remove. 나를 빼면 나가기(이 기기 목록에서도 지운다)
pub fn update_room(dir: &Path, kc: &dyn Store, http: &dyn Http, sel: &str, name: Option<&str>, add: &[String], remove: &[String]) -> Result<TeamState, String> {
    let st = relay::load_state(dir);
    let r = find_room(&st, sel)?.clone();
    let t = st.team(&r.team)?.clone();
    let roster = crate::e2e_state::roster_of(dir, kc, http, &st, &r.team)?;
    let cur = roster.rooms.get(&r.id).ok_or("이 팀챗은 서명된 팀 명부에 없어 — 바꾸지 않았어")?;
    // 확인 전 사람이 고친 방을 지금 목록으로 이어 서명하면 끼운 사람이 확인됨이 된다(계획 e2e-recover §9 S5) —
    // 그런 방은 마지막 확인된 사람들에서 시작해 되살리기만(더하기는 되살린 뒤 한 번 더, 공격 리뷰 4)
    let base = if cur.confirmed {
        &cur.members
    } else if cur.trusted_members.is_empty() {
        return Err("이 팀챗은 확인된 적이 없어(보안 번호가 바뀐 사람이 만듦) 바꾸지 않아 — 그 사람을 받아들이거나 새 팀챗을 만들어 줘".into());
    } else if !add.is_empty() {
        return Err("이 팀챗은 보안 번호가 바뀐 사람이 고쳐서 — 먼저 사람 더하기 없이 되살린 뒤(마지막 확인된 사람들로) 더해 줘".into());
    } else {
        &cur.trusted_members
    };
    let mut members: Vec<String> = base.iter().filter(|m| roster.members.get(*m).is_some_and(|p| p.active)).cloned().collect();
    let aka = crate::team_profile::cached_names(dir, kc, &t.id);
    for p in remove {
        let m = pick(&t, p, &aka)?;
        members.retain(|x| *x != m);
    }
    for p in add {
        let m = pick_signed(&roster, &t, p, &aka)?;
        if !members.contains(&m) {
            members.push(m);
        }
    }
    if members.len() > MAX_PEOPLE {
        return Err(format!("한 방은 {MAX_PEOPLE}명까지야"));
    }
    let name = match name {
        Some(n) => crate::team_ui::name_ok(n).ok_or("방 이름은 1~40자")?,
        None => cur.name.clone(),
    };
    let link = crate::e2e_team::room_link(dir, kc, http, &t.id, &r.id, &name, &members)?;
    let k = relay::device_keys(kc, &st)?;
    let (code, v) = relay::call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/rooms/{}", t.id, r.id), Some(&json!({ "link": link })))?;
    if code != 200 {
        return Err(relay::why(code, &v));
    }
    let (id, gone) = (r.id.clone(), !members.contains(&t.member_id));
    relay::mutate_if(dir, &st.device_id, move |s| {
        if gone {
            s.rooms.retain(|x| x.id != id);
        } else if let Some(x) = s.rooms.iter_mut().find(|x| x.id == id) {
            x.name = name;
            x.members = members;
        }
    })
}

/// 나가기 — 나만 뺀 목록으로 바꾸기
pub fn leave_room(dir: &Path, kc: &dyn Store, http: &dyn Http, sel: &str) -> Result<TeamState, String> {
    let st = relay::load_state(dir);
    let r = find_room(&st, sel)?;
    let me = st.team(&r.team)?.member_id.clone();
    update_room(dir, kc, http, sel, None, &[], &[me])
}

/// 만든 사람·지울 수 있나 — 우클릭 메뉴가 '지우기'를 보일지(명부를 받아야 해서 메뉴를 열 때 따로)
pub fn room_info(dir: &Path, kc: &dyn Store, http: &dyn Http, sel: &str) -> Result<Value, String> {
    let st = relay::load_state(dir);
    let r = find_room(&st, sel)?;
    let t = st.team(&r.team)?;
    let roster = crate::e2e_state::roster_of(dir, kc, http, &st, &r.team)?;
    let by = roster.rooms.get(&r.id).map(|x| x.by.clone()).unwrap_or_default();
    Ok(json!({ "by": by, "canDelete": t.role == "owner" || by == t.member_id }))
}

/// 지우기 — 사람 0명 고리(서버가 방 말까지 지운다, chammo-relay rooms.ts). 만든 사람·팀장만(서버도 본다). 모두의 목록에서 사라진다
pub fn delete_room(dir: &Path, kc: &dyn Store, http: &dyn Http, sel: &str) -> Result<TeamState, String> {
    let st = relay::load_state(dir);
    let r = find_room(&st, sel)?.clone();
    let t = st.team(&r.team)?.clone();
    let roster = crate::e2e_state::roster_of(dir, kc, http, &st, &r.team)?;
    let cur = roster.rooms.get(&r.id).ok_or("이 팀챗은 서명된 팀 명부에 없어 — 지우지 않았어")?;
    if t.role != "owner" && cur.by != t.member_id {
        return Err("팀챗은 만든 사람이나 팀장만 지울 수 있어".into());
    }
    let link = crate::e2e_team::room_link(dir, kc, http, &t.id, &r.id, &cur.name, &[])?;
    let k = relay::device_keys(kc, &st)?;
    let (code, v) = relay::call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/rooms/{}", t.id, r.id), Some(&json!({ "link": link })))?;
    if code != 200 {
        return Err(relay::why(code, &v));
    }
    let id = r.id;
    relay::mutate_if(dir, &st.device_id, move |s| s.rooms.retain(|x| x.id != id))
}

/// 화면·참모용 단톡방 목록 — 이름·사람 이름표(남의 글이라 이름표 거름, 프로필 이름이 있으면 '프로필 이름(계정 이름)')
pub fn view(st: &TeamState, aka: &BTreeMap<String, String>) -> Value {
    use crate::team_relay_inbox::safe_name as clean;
    let rooms: Vec<Value> = st
        .rooms
        .iter()
        .filter(|r| r.kind == "group")
        .map(|r| {
            let team = st.teams.iter().find(|t| t.id == r.team);
            let people: Vec<String> = r.members.iter().map(|m| st.member_name(m).map(|n| relay::label(&clean(n), aka.get(m).map(|p| clean(p)).as_deref())).unwrap_or_else(|| "?".into())).collect();
            json!({ "id": r.id, "name": clean(&r.name), "team": r.team, "teamName": team.map(|t| clean(&t.name)).unwrap_or_default(), "people": people, "members": r.members })
        })
        .collect();
    json!({ "rooms": rooms })
}

#[cfg(test)]
#[path = "team_rooms_tests.rs"]
mod tests;
