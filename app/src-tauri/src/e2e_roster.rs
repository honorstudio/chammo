//! 팀 명부 검증 — chammo-relay ADR 0007 결정 6, 계획 2026-10-24 e2e-multiteam §2.6.
//! 멤버 id ↔ 계정 ↔ 표시 이름 ↔ 역할은 서버 members 응답이 아니라 여기서 검증한 명부로만 읽는다(서버가 같은 이름의 가짜 사람을 끼우지 못하게).
//! - 고리 = {seq, body, sig, sig2?}. 서명할 글 = "chammo-team/1\n" ‖ body. 해시 = SHA256("chammo-team-link/1\n" ‖ body ‖ "\n" ‖ sig ‖ "\n" ‖ sig2)
//! - 서명 기기(ADR 0007 R3): 내가 명부를 핀한 머리까지(이미 믿은 고리)는 그 계정 사슬에 한 번이라도 든 기기(ever) — 빠진 기기의 옛 고리가 명부를 깨지 않게.
//!   핀 뒤에 새로 붙은 고리는 지금 사슬에 든 기기만 — 뺀 훔친 기기가 털린 서버와 함께 그 사람 이름 고리를 계속 쓰지 못하게
//! - join 의 sig2 = 초대 코드에서 끌어낸 Ed25519(씨앗 = HKDF-SHA256(code, 소금 없음, "chammo-invite/1")) — 서버는 코드 해시만 가진다
//! - 두 겹(계획 2026-10-26-e2e-recover §9): 구조는 느슨한 사슬(바뀐 계정의 지금 사슬 — 받아들였다면 될 모양)로 셈해 기기마다 같게,
//!   믿음은 믿는 사슬(핀 머리까지)로 고리마다 따로 — 멤버·방·팀장 일에 확인됨 표시. 한 사람 신원이 바뀌었다고 명부 전체를 버리지 않는다(ADR 0007 결정 5).
//!   받는 사람은 확인된 것만, 줄어드는 쪽(빼기·나가기)은 누가 서명했든 반영
use crate::e2e_chain::{sha_b64, verify_sig, Chain};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct TLink {
    pub seq: u64,
    pub body: String,
    pub sig: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sig2: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RosterMember {
    pub account: String,
    pub display_name: String,
    /// owner | member
    pub role: String,
    pub active: bool,
    /// 믿는 사슬로 확인한 들어옴(과 확인된 초대) — 아니면 받아들이기 전까지 받는 사람에서 뺀다
    pub confirmed: bool,
    /// 팀장·매니저 자리가 확인된 고리로 생겼나 — 아니면 그 사람 권한 일(초대·올림·빼기)은 확인 전
    pub owner_ok: bool,
    /// 매니저 권한(relay ADR 0014) — 비면 팀원(팀장은 role owner). 정렬·중복 없음, all 은 혼자
    pub perms: Vec<String>,
}

/// 매니저 권한 항목(relay src/perms.ts ITEMS 와 같은 차례)
pub const ITEMS: &[&str] = &["agents", "files", "invite", "kick", "look", "posts"];

/// 순위 — 팀장 3 > 전체 권한 매니저 2 > 매니저 1 > 팀원 0 (relay perms.ts rank)
pub fn rank(m: &RosterMember) -> u8 {
    if m.role == "owner" {
        3
    } else if m.perms.iter().any(|p| p == "all") {
        2
    } else {
        u8::from(!m.perms.is_empty())
    }
}

/// 그 항목을 할 수 있나 — 팀장·전체 권한은 다
pub fn has(m: &RosterMember, item: &str) -> bool {
    rank(m) >= 2 || m.perms.iter().any(|p| p == item)
}

/// 고리의 권한 배열 — 한 가지 모양(비지 않음·정렬·중복 없음·아는 항목, all 은 혼자)일 때만
fn canon_perms(v: &Value) -> Option<Vec<String>> {
    let a: Vec<String> = v.as_array()?.iter().map(|x| x.as_str().map(String::from)).collect::<Option<_>>()?;
    if a.is_empty() {
        return None;
    }
    if a.iter().any(|x| x == "all") {
        return (a.len() == 1).then_some(a);
    }
    let ok = a.iter().all(|x| ITEMS.contains(&x.as_str())) && a.windows(2).all(|w| w[0] < w[1]);
    ok.then_some(a)
}

/// 단톡방 하나 — 이름과 방 사람(멤버 id). 팀에서 빠진 사람은 받는 기기를 셀 때 active 로 거른다
#[derive(Clone, Debug, PartialEq, Default)]
pub struct RosterRoom {
    pub name: String,
    pub members: Vec<String>,
    /// 만들고 고친 고리가 다 확인된 사람의 믿는 서명 — 한 번이라도 확인 전 사람이 고쳤으면 받아들이기 전까지 못 쓴다
    pub confirmed: bool,
    /// 마지막으로 확인됐을 때의 방 사람 — 확인된 사람이 이 안에서만 다시 서명하면 되살아난다(더하기는 그다음, 공격 리뷰 4)
    pub trusted_members: Vec<String>,
    /// 만든 사람 — 그 방 첫 고리에 서명한 멤버(지우기는 만든 사람·팀장만, 10-26)
    pub by: String,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Roster {
    pub team: String,
    pub name: String,
    pub members: BTreeMap<String, RosterMember>,
    /// 단톡방 id → 방(room 고리, 계획 2026-10-26 team-rooms) — 서버가 방 사람을 몰래 끼우지 못하게 받는 기기는 여기서만 센다
    pub rooms: BTreeMap<String, RosterRoom>,
    pub hashes: Vec<String>,
    /// 확인 전 서명으로 빠진 멤버 — 빠짐은 반영(기밀이 먼저)하되 화면이 경보를 띄울 수 있게(공격 리뷰 4)
    pub doubts: Vec<String>,
}

impl Roster {
    pub fn head(&self) -> String {
        self.hashes.last().cloned().unwrap_or_default()
    }
    pub fn active(&self) -> impl Iterator<Item = (&String, &RosterMember)> {
        self.members.iter().filter(|(_, m)| m.active)
    }

    /// 지금 팀장 — 팀장 자리가 확인된 고리로 생겼고(owner_ok) 그 사람 자리도 확인된(confirmed) 활성 멤버 id.
    /// 팀장만 올릴 수 있는 것(고정·아이콘·홈 판·참모 정의)을 남이 올린 것으로 받아들일 때와 내가 팀장 일을 할 수 있나 볼 때는
    /// 서버 members 응답의 role 이 아니라 이걸로만 센다(relay ADR 0014 R14 — team_owners)
    pub fn owner_ids(&self) -> Vec<String> {
        self.active().filter(|(_, m)| m.role == "owner" && m.owner_ok && m.confirmed).map(|(id, _)| id.clone()).collect()
    }

    /// 그 항목을 할 수 있는 확인된 사람(팀장·전체 권한·그 항목 매니저) — 받는 거름은 이걸로(relay ADR 0014 R14)
    pub fn holders(&self, item: &str) -> Vec<String> {
        self.active().filter(|(_, m)| has(m, item) && m.owner_ok && m.confirmed).map(|(id, _)| id.clone()).collect()
    }
}

#[derive(Debug, PartialEq)]
pub enum RosterErr {
    Bad(u64, &'static str),
    /// 이 계정 사슬이 있어야 검증할 수 있다(받아 와서 다시)
    NeedChain(String),
}

pub fn team_hash(l: &TLink) -> String {
    sha_b64(&[format!("chammo-team-link/1\n{}\n{}\n{}", l.body, l.sig, l.sig2.as_deref().unwrap_or("")).as_bytes()])
}

/// 검증에 필요한 계정들(명부에 나오는 모든 계정) — 이 계정들의 사슬을 먼저 받아 온다
pub fn accounts_needed(links: &[TLink]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for l in links {
        let Ok(b) = serde_json::from_str::<Value>(&l.body) else { continue };
        if let Some(a) = b["account"].as_str() {
            out.insert(a.to_string());
        }
    }
    out
}

/// 서명 기기 by 가 그 계정 사슬에 들었고(now 면 지금, 아니면 한 번이라도) 그 열쇠로 서명했나
fn signed_by(chains: &BTreeMap<String, Chain>, account: &str, by: &str, text: &str, sig: &str, now: bool) -> Result<bool, RosterErr> {
    let c = chains.get(account).ok_or_else(|| RosterErr::NeedChain(account.into()))?;
    let ed = if now { c.devices.get(by).map(|d| &d.ed) } else { c.ever.get(by) };
    Ok(ed.is_some_and(|ed| verify_sig(ed, text, sig)))
}

/// 믿는 사슬로만 — 없는 계정(바뀌어 믿을 앞부분도 없음)은 그냥 아님
fn trusted_by(chains: &BTreeMap<String, Chain>, account: &str, by: &str, text: &str, sig: &str, now: bool) -> bool {
    signed_by(chains, account, by, text, sig, now).unwrap_or(false)
}

pub fn verify(team: &str, links: &[TLink], chains: &BTreeMap<String, Chain>) -> Result<Roster, RosterErr> {
    verify_two(team, links, chains, chains, None)
}

/// pinned = 내가 전에 핀한 명부 머리 seq — 그 뒤 고리는 지금 사슬 기기 서명만(R3)
pub fn verify_from(team: &str, links: &[TLink], chains: &BTreeMap<String, Chain>, pinned: Option<u64>) -> Result<Roster, RosterErr> {
    verify_two(team, links, chains, chains, pinned)
}

/// 두 겹 검증 — loose(바뀐 계정은 지금 사슬)로 구조와 '틀림'을, trusted(바뀐 계정은 핀 머리까지)로 확인됨 표시를.
/// loose 에 없는 서명이면 지금처럼 Bad(경보). loose 는 trusted 의 모든 계정을 갖고 있어야 한다(같은 계정은 trusted 가 앞부분)
pub fn verify_two(team: &str, links: &[TLink], trusted: &BTreeMap<String, Chain>, loose: &BTreeMap<String, Chain>, pinned: Option<u64>) -> Result<Roster, RosterErr> {
    let mut r = Roster { team: team.into(), ..Default::default() };
    let mut invites: BTreeMap<String, (bool, bool)> = BTreeMap::new(); // 초대 열쇠 → (이미 썼나, 확인된 팀장이 냈나)
    for (i, l) in links.iter().enumerate() {
        let n = i as u64;
        let bad = |why| Err(RosterErr::Bad(n, why));
        let b: Value = serde_json::from_str(&l.body).map_err(|_| RosterErr::Bad(n, "json"))?;
        let s = |k: &str| b[k].as_str().unwrap_or("").to_string();
        if l.seq != n || b["v"] != 1 || b["seq"].as_u64() != Some(n) || s("team") != team || s("prev") != r.head() {
            return bad("shape");
        }
        let (kind, by) = (s("kind"), s("by"));
        let now = pinned.is_some_and(|p| n > p);
        let text = format!("chammo-team/1\n{}", l.body);
        // 구조는 한 번이라도 든 기기(ever)로 — 핀 뒤에 정상으로 다시 시작한 사람의 옛 기기 고리에서 기기마다 판정이 갈려 팀 전체가 멈추지 않게(공격 리뷰 2).
        // R3(핀 뒤는 지금 기기만)는 믿음 쪽(trusted_by)에만 — 뺀 기기가 쓴 고리는 확인 전이 될 뿐
        let signed_by = |a: &str| signed_by(loose, a, &by, &text, &l.sig, false);
        let trusted_by = |a: &str| trusted_by(trusted, a, &by, &text, &l.sig, now);
        // 서명한 멤버(그 기기를 가진 계정의 지금 자리) — 팀장은 사슬이 꼭 있어야(없으면 받아 오라고), 그 밖은 사슬이 없으면 서명자 아님
        let signer = |r: &Roster| -> Result<Option<String>, RosterErr> {
            for (id, m) in r.active() {
                let yes = if m.role == "owner" { signed_by(&m.account)? } else { signed_by(&m.account).unwrap_or(false) };
                if yes {
                    return Ok(Some(id.clone()));
                }
            }
            Ok(None)
        };
        // 그 서명자의 권한이 확인됐나(owner_trusted 의 일반화)
        let auth_trusted = |m: &RosterMember| m.owner_ok && m.confirmed && trusted_by(&m.account);
        match kind.as_str() {
            "team" => {
                if n != 0 || !signed_by(&s("account"))? {
                    return bad("team");
                }
                r.name = s("name");
                // 자리는 그 계정 사슬 기기가 직접 서명한 고리에서만(ADR 0007 R1) — 만든 사람 자리만(옮기기 목록 없음, R8)
                let ok = trusted_by(&s("account"));
                r.members.insert(s("member"), RosterMember { account: s("account"), display_name: s("displayName"), role: "owner".into(), active: true, confirmed: ok, owner_ok: ok, perms: vec![] });
            }
            "invite" => {
                // 같은 초대 열쇠를 다시 올려 '안 씀'으로 되돌리지 못하게(공격 리뷰 7)
                // 팀장 또는 invite 매니저(relay ADR 0014)
                let who = signer(&r)?.and_then(|id| r.members.get(&id).cloned());
                if n == 0 || !who.as_ref().is_some_and(|m| has(m, "invite")) || s("invPub").is_empty() || invites.contains_key(&s("invPub")) {
                    return bad("invite");
                }
                invites.insert(s("invPub"), (false, who.as_ref().is_some_and(|m| auth_trusted(m))));
            }
            "join" => {
                let inv = s("invPub");
                let fresh = invites.get(&inv).map(|x| !x.0) == Some(true);
                let by_code = l.sig2.as_deref().is_some_and(|s2| verify_sig(&inv, &text, s2));
                if !fresh || !by_code || !signed_by(&s("account"))? || r.members.contains_key(&s("member")) {
                    return bad("join");
                }
                // 확인 전 초대(확인 전 팀장이 냄)로 들어온 사람도 확인 전 — 서버가 지어낸 팀장 초대로 가짜 사람을 믿게 하지 못하게
                let ok = trusted_by(&s("account")) && invites[&inv].1;
                invites.insert(inv, (true, false));
                r.members.insert(s("member"), RosterMember { account: s("account"), display_name: s("displayName"), role: "member".into(), active: true, confirmed: ok, owner_ok: false, perms: vec![] });
            }
            "role" | "remove" => {
                let target = s("member");
                let Some(tm) = r.members.get(&target).filter(|m| m.active).cloned() else { return bad("owner-op") };
                let Some(sid) = signer(&r)? else { return bad("owner-op") };
                let sm = r.members[&sid].clone();
                let owners = r.active().filter(|(_, m)| m.role == "owner").count();
                let co_owner = sm.role == "owner" && tm.role == "owner" && sid != target && owners > 1;
                let ok = auth_trusted(&sm);
                if kind == "remove" {
                    // kick + 나보다 낮은 사람(P3) — 옛 팀은 팀장이 다른 팀장도
                    if sid == target || !has(&sm, "kick") || !(co_owner || rank(&sm) > rank(&tm)) {
                        return bad("owner-op");
                    }
                    // 빼기는 반영 — 받는 사람이 줄어드는 쪽(기밀이 가용성보다 먼저). 확인 전 서명이면 의심으로 남긴다
                    r.members.get_mut(&target).expect("있다").active = false;
                    if !ok {
                        r.doubts.push(target.clone());
                    }
                } else if s("role") == "owner" {
                    let from = s("from");
                    if !from.is_empty() {
                        // 팀장 넘기기(relay ADR 0014 결정 4) — 넘기는 팀장 본인이 서명, 받는 사람 = 팀장, 넘긴 사람 = 전체 권한
                        if from != sid || sm.role != "owner" || tm.role == "owner" {
                            return bad("owner-op");
                        }
                        let m = r.members.get_mut(&target).expect("있다");
                        m.role = "owner".into();
                        m.perms = vec![];
                        m.owner_ok = ok && m.confirmed;
                        let f = r.members.get_mut(&sid).expect("있다");
                        f.role = "member".into();
                        f.perms = vec!["all".into()];
                    } else {
                        // 옛 고리(팀장 여럿이던 때의 올림) — 팀장이 서명했으면 그대로
                        if sm.role != "owner" {
                            return bad("owner-op");
                        }
                        let m = r.members.get_mut(&target).expect("있다");
                        m.role = "owner".into();
                        m.perms = vec![];
                        // 올림은 확인된 팀장이 확인된 사람을 올렸을 때만 팀장 일이 확인됨(확인 전 사람 세탁 막기, 공격 리뷰 1)
                        m.owner_ok = ok && m.confirmed;
                    }
                } else {
                    let next = match s("role").as_str() {
                        "manager" => match canon_perms(&b["perms"]) {
                            Some(p) => p,
                            None => return bad("role"),
                        },
                        "member" if b.get("perms").is_none() => vec![],
                        _ => return bad("role"),
                    };
                    let nm = RosterMember { role: "member".into(), perms: next.clone(), ..tm.clone() };
                    let allowed = if sid == target {
                        // 자기는 낮추기만(P4) — 옛 팀의 팀장 자기 내림은 다른 팀장이 있을 때
                        if tm.role == "owner" {
                            owners > 1
                        } else {
                            rank(&nm) < rank(&tm) || (rank(&nm) == rank(&tm) && next.iter().all(|p| tm.perms.contains(p)))
                        }
                    } else {
                        // 사람을 바꾸는 건 전체 권한 이상(P2), 나보다 낮은 사람만(P1), 전체 권한 깃발은 팀장만
                        rank(&sm) >= 2 && (co_owner || rank(&sm) > rank(&tm)) && (sm.role == "owner" || rank(&nm) < 2)
                    };
                    if !allowed {
                        return bad("owner-op");
                    }
                    let up = rank(&nm) > rank(&tm) || next.iter().any(|p| !tm.perms.contains(p));
                    let m = r.members.get_mut(&target).expect("있다");
                    m.role = "member".into();
                    m.perms = next;
                    // 올림은 확인된 권한자가 확인된 사람에게 줬을 때만 확인됨, 내림은 늘 반영(그 사람 확인 상태 그대로)
                    if up {
                        m.owner_ok = ok && m.confirmed;
                    }
                    if m.perms.is_empty() {
                        m.owner_ok = false;
                    }
                }
            }
            "leave" => {
                let target = s("member");
                let Some(m) = r.members.get(&target).filter(|m| m.active).cloned() else { return bad("leave") };
                if !signed_by(&m.account)? {
                    return bad("leave");
                }
                r.members.get_mut(&target).expect("있다").active = false;
                if !trusted_by(&m.account) {
                    r.doubts.push(target);
                }
            }
            // 단톡방 만들기·바꾸기 — 서명한 사람(그 계정 사슬 기기)이 지금 팀 사람이고, 새 방이면 목록에 자기가, 있던 방이면 지금 방 사람이어야.
            // 방 사람은 다 지금 팀 사람, 중복 없음. 나를 빼면 나가기
            "room" => {
                let (id, me) = (s("room"), s("member"));
                let list: Vec<String> = b["members"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                let me_ok = r.members.get(&me).is_some_and(|m| m.active && m.account == s("account"));
                let all_in = list.iter().all(|m| r.members.get(m).is_some_and(|x| x.active)) && list.iter().collect::<BTreeSet<_>>().len() == list.len();
                // 팀장·전체 권한은 안 든 방도 지운다(사람 0명 고리, relay ADR 0014 P5)
                let admin = list.is_empty() && r.members.get(&me).is_some_and(|m| rank(m) >= 2);
                let may = match r.rooms.get(&id) {
                    Some(old) => old.members.contains(&me) || admin,
                    None => list.contains(&me),
                };
                if id.is_empty() || s("name").trim().is_empty() || !me_ok || !all_in || !may || !signed_by(&s("account"))? {
                    return bad("room");
                }
                // 확인된 사람이 믿는 기기로, 고친 방이면 그 방도 확인돼 있어야 — 확인 전 사람이 한 번 고친 방은 받아들이기 전까지 못 쓴다(몰래 끼우기).
                // 되살리기: 확인된 사람이 마지막 확인된 방 사람 안에서만 다시 서명하면 다시 확인됨(공격 리뷰 4 — 끼운 사람은 이어받지 못한다)
                let signer_ok = r.members.get(&me).is_some_and(|m| m.confirmed) && trusted_by(&s("account"));
                let ok = signer_ok
                    && match r.rooms.get(&id) {
                        None => true,
                        Some(o) => o.confirmed || (!o.trusted_members.is_empty() && list.iter().all(|m| o.trusted_members.contains(m))),
                    };
                let trusted_members = if ok { list.clone() } else { r.rooms.get(&id).map(|o| o.trusted_members.clone()).unwrap_or_default() };
                let by = r.rooms.get(&id).map_or_else(|| me.clone(), |o| o.by.clone());
                r.rooms.insert(id, RosterRoom { name: s("name"), members: list, confirmed: ok, trusted_members, by });
            }
            _ => return bad("kind"),
        }
        r.hashes.push(team_hash(l));
    }
    if r.hashes.is_empty() {
        return Err(RosterErr::Bad(0, "empty"));
    }
    Ok(r)
}

/// 초대 코드에서 끌어낸 Ed25519 열쇠(씨앗) — 서버 시험 roster-helpers inviteKey 와 같은 식
pub fn invite_seed(code: &str) -> [u8; 32] {
    let mut seed = [0u8; 32];
    hkdf::Hkdf::<sha2::Sha256>::new(None, code.as_bytes()).expand(b"chammo-invite/1", &mut seed).expect("32");
    seed
}

#[cfg(test)]
#[path = "e2e_roster_tests.rs"]
mod tests;
