//! 팀 참모 정의 저장·불러오기(팀 홈 글과 같은 팀 보관함 길 — kind post 안쪽 t=agent, ADR 0017) + 이 기기 파일(받은 목록 캐시·확인한 판·토큰 기록)
use crate::accounts_store::Store;
use crate::team_agent::{self as agent, Confirmed, Def, Seen, Shown};
use crate::team_locker_app::{self as locker, Item};
use crate::team_relay::{self, Http};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;

pub const CACHE_DIR: &str = "team-agents";
pub const SEEN_FILE: &str = "team-agents-seen.json";
pub const USAGE_FILE: &str = "team-agent-usage.jsonl";

fn safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn write(file: &Path, text: &str) -> Result<(), String> {
    crate::accounts::write_atomic(file, text).map_err(|e| format!("{e:?}"))
}

/// on_sent 가 망 없이 읽는 팀별 마지막 목록
pub fn save_cache(dir: &Path, team: &str, list: &[Shown]) {
    if !safe_id(team) {
        return;
    }
    if let Ok(t) = serde_json::to_string(list) {
        let _ = write(&dir.join(CACHE_DIR).join(format!("{team}.json")), &t);
    }
}

pub fn cached(dir: &Path, team: &str) -> Vec<Shown> {
    if !safe_id(team) {
        return Vec::new();
    }
    let Ok(t) = std::fs::read_to_string(dir.join(CACHE_DIR).join(format!("{team}.json"))) else { return Vec::new() };
    // 캐시도 다시 고른다(손으로 고친 파일에 모르는 칸·긴 지침이 있어도)
    serde_json::from_str::<Vec<serde_json::Value>>(&t)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| {
            let def = agent::clean(serde_json::from_value::<Def>(v["def"].clone()).ok()?);
            Some(Shown { id: v["id"].as_str()?.into(), ver: v["ver"].as_str()?.into(), def, by: v["by"].as_str().unwrap_or("").into(), clash: v["clash"] == true, ..Default::default() })
        })
        .collect()
}

pub fn seen(dir: &Path) -> Seen {
    std::fs::read_to_string(dir.join(SEEN_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// 이 판을 확인했다 — 정의째 남긴다(다음 판에서 무엇이 바뀌었나 보여 주려고)
pub fn confirm(dir: &Path, a: &Shown) -> Result<(), String> {
    let mut s = seen(dir);
    s.insert(a.id.clone(), Confirmed { ver: a.ver.clone(), def: a.def.clone() });
    write(&dir.join(SEEN_FILE), &serde_json::to_string(&s).map_err(|e| e.to_string())?)
}

pub fn usage_add(dir: &Path, room: &str, seq: u64, model: &str, tokens: u64) {
    let line = serde_json::json!({ "room": room, "seq": seq, "model": model, "tokens": tokens }).to_string();
    let mut o = std::fs::OpenOptions::new();
    o.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    if let Ok(mut f) = o.open(dir.join(USAGE_FILE)) {
        let _ = writeln!(f, "{line}");
    }
}

/// 그 방 팀 참모 답의 토큰(부른 사람 기기에만 있다)
pub fn usage(dir: &Path, room: &str) -> BTreeMap<u64, (String, u64)> {
    std::fs::read_to_string(dir.join(USAGE_FILE))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|v| v["room"] == room)
        .filter_map(|v| Some((v["seq"].as_u64()?, (v["model"].as_str().unwrap_or("").to_string(), v["tokens"].as_u64().unwrap_or(0)))))
        .collect()
}

pub enum Target {
    /// 앱에 박힌 @팀참모
    Base(String),
    Agent(Shown, String),
}

/// 보낸 말에서 부를 대상 — 팀 참모 멘션(이름 겹침 빼고)이 먼저, 없으면 @팀참모
pub fn resolve(body: &str, list: &[Shown]) -> Option<Target> {
    let names: Vec<&str> = list.iter().filter(|a| !a.clash).map(|a| a.def.name.as_str()).collect();
    if let Some((name, ask)) = agent::mention(body, &names) {
        let a = list.iter().find(|a| !a.clash && a.def.name.eq_ignore_ascii_case(&name))?;
        return Some(Target::Agent(a.clone(), ask));
    }
    crate::team_helper::ask_of(body).map(Target::Base)
}

// ── 네트워크 ──

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct List {
    pub team: String,
    pub agents: Vec<Shown>,
    /// 이 기기가 확인한 판(참모 id → 판·정의)
    pub seen: Seen,
    pub owner: bool,
    pub me: String,
}

fn usable(i: &Item) -> bool {
    i.why.is_empty() && i.deleted_at.is_none() && i.state != "trash" && i.state != "uploading"
}

fn owners(t: &team_relay::TeamEntry) -> Vec<String> {
    t.members.iter().filter(|m| m.role == "owner").map(|m| m.id.clone()).collect()
}

type Read = (team_relay::TeamEntry, Vec<(Item, Def)>, locker::ShareJob);

fn read(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<Read, String> {
    let t = team_relay::load_state(dir).team(team).cloned()?;
    let (v, job) = locker::list_split(dir, kc, http, &t.id)?;
    let docs = v
        .items
        .iter()
        .filter(|i| i.kind == "post" && i.name == "agent.json" && usable(i))
        .filter_map(|i| crate::team_profile::bytes_of(dir, kc, http, &t.id, &i.id).ok().and_then(|b| agent::decode(&b).ok()).filter(|d| d.t == "agent").map(|d| (i.clone(), d)))
        .collect();
    Ok((t, docs, job))
}

fn folded(t: &team_relay::TeamEntry, docs: &[(Item, Def)]) -> Vec<Shown> {
    let pairs: Vec<(&Item, Def)> = docs.iter().map(|(i, d)| (i, d.clone())).collect();
    agent::fold(&pairs, &owners(t), &t.member_id)
}

/// 팀 참모 목록 — 받은 김에 캐시도 갈아 둔다
pub fn list(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<(List, locker::ShareJob), String> {
    let (t, docs, job) = read(dir, kc, http, team)?;
    let agents = folded(&t, &docs);
    save_cache(dir, &t.id, &agents);
    Ok((List { team: t.id.clone(), agents, seen: seen(dir), owner: t.role == "owner", me: t.member_id.clone() }, job))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// 만들기·고치기(origin = 참모 id) — 이름 규칙·겹침, 고치기는 만든 사람(editors both)·팀장만. 돌려주는 건 참모 id
pub fn save(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, draft: Def, origin: Option<&str>) -> Result<(String, locker::ShareJob), String> {
    let (t, docs, job) = read(dir, kc, http, team)?;
    let agents = folded(&t, &docs);
    let mut d = agent::clean(Def { t: "agent".into(), ..draft });
    let people: Vec<String> = t.members.iter().map(|m| m.display_name.clone()).collect();
    agent::name_free(&d.name, origin.unwrap_or(""), &people, &agents)?;
    d.at = now_ms();
    match origin {
        Some(o) => {
            let cur = agents.iter().find(|a| a.id == o).ok_or("고칠 팀 참모가 없어")?;
            if !cur.can_edit {
                return Err("이 팀 참모는 만든 사람·팀장만 고쳐".into());
            }
            d.origin = o.into();
            d.created = cur.def.created;
        }
        None => {
            d.origin = String::new();
            d.created = d.at;
        }
    }
    put(dir, kc, http, &t, &docs, d, origin).map(|id| (id, job))
}

/// 판 올리기 + 내 옛 판 치우기(첫 판·새 판은 남긴다 — 첫 판이 만든 사람 표시)
fn put(dir: &Path, kc: &dyn Store, http: &dyn Http, t: &team_relay::TeamEntry, docs: &[(Item, Def)], d: Def, origin: Option<&str>) -> Result<String, String> {
    let bytes = serde_json::to_vec(&d).map_err(|e| e.to_string())?;
    let id = crate::team_profile::put(dir, kc, http, &t.id, "post", "agent.json", &bytes)?;
    if let Some(o) = origin {
        for (i, _) in docs.iter().filter(|(i, x)| x.origin == o && i.by_member == t.member_id && i.id != id) {
            let _ = locker::act(dir, kc, http, &t.id, &i.id, "purge");
        }
    }
    // 캐시는 화면이 저장 뒤 목록을 다시 받을 때 간다(team_agents)
    Ok(origin.map_or(id, str::to_string))
}

/// 지우기 — gone 판을 같은 권한 규칙으로 올린다(받는 기기마다 목록에서 뺀다)
pub fn remove(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str) -> Result<locker::ShareJob, String> {
    let (t, docs, job) = read(dir, kc, http, team)?;
    let agents = folded(&t, &docs);
    let cur = agents.iter().find(|a| a.id == id).ok_or("지울 팀 참모가 없어")?;
    if !cur.can_edit {
        return Err("이 팀 참모는 만든 사람·팀장만 지워".into());
    }
    let d = Def { gone: true, origin: id.into(), at: now_ms(), ..cur.def.clone() };
    put(dir, kc, http, &t, &docs, d, Some(id))?;
    Ok(job)
}

#[cfg(test)]
#[path = "team_agent_store_tests.rs"]
mod tests;
