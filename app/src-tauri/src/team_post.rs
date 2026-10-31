//! 팀 홈 글·고정 공지(Chammo docs/plans/2026-10-26-team-space.md) — 서버에 평문으로 안 남긴다(relay ADR 0007·0009):
//! 팀 보관함 길(team_locker_app, 파일마다 열쇠를 팀원 기기마다 봉투)로 kind post = 작은 JSON. 나중에 든 사람도 봉투 더하기로 예전 글을 읽는다.
//! - 글: 첫 판의 id 가 글 id. 고치면 origin = 글 id 로 새 판을 올리고 첫 판·새 판 말고 내 옛 판은 치운다(첫 판은 남겨 글쓴이 = 첫 판 올린 사람)
//! - 고정: 팀장이 올린 pin 기록(origin = 글 id, 빈 글 = 풀기) 중 가장 새 것 하나 — 남의 글을 고쳐 올리지 않는다
use crate::accounts_store::Store;
use crate::team_locker_app::{self as locker, Item};
use crate::team_owners;
use crate::team_profile;
use crate::team_relay::{self, Http};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

pub const TITLE_MAX: usize = 120;
pub const BODY_MAX: usize = 20_000;

/// 봉한 JSON 하나 — t = post | pin
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Doc {
    pub t: String,
    pub title: String,
    pub body: String,
    /// post: 첫 판 id(빈 글 = 이게 첫 판) · pin: 고정할 글 id(빈 글 = 풀기)
    pub origin: String,
    /// 글을 처음 쓴 시각 ms(고친 판도 첫 판 값)
    pub created: u64,
    /// 이 판을 올린 시각 ms
    pub at: u64,
}

fn one_line(s: &str, max: usize) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

fn id_ok(id: &str) -> bool {
    (16..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// 받은 글은 남의 글이다 — 모양을 고르고 길이를 자른다
pub fn clean(d: Doc) -> Doc {
    Doc {
        t: if matches!(d.t.as_str(), "post" | "pin") { d.t } else { String::new() },
        title: one_line(&d.title, TITLE_MAX),
        body: d.body.chars().take(BODY_MAX).collect(),
        origin: if id_ok(&d.origin) { d.origin } else { String::new() },
        created: d.created,
        at: d.at,
    }
}

pub fn decode(bytes: &[u8]) -> Result<Doc, String> {
    serde_json::from_slice::<Doc>(bytes).map(clean).map_err(|e| format!("글을 못 읽었어: {e}"))
}

fn usable(i: &Item) -> bool {
    i.why.is_empty() && i.deleted_at.is_none() && i.state != "trash" && i.state != "uploading"
}

/// 화면에 줄 글 하나
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shown {
    /// 글 id(첫 판)
    pub id: String,
    /// 지금 판 파일 id
    pub file: String,
    pub title: String,
    pub body: String,
    /// 글쓴이 멤버 id
    pub by: String,
    pub created: u64,
    /// 고친 시각(안 고쳤으면 0)
    pub edited: u64,
    pub mine: bool,
}

fn key_of(i: &Item, d: &Doc) -> String {
    if d.origin.is_empty() { i.id.clone() } else { d.origin.clone() }
}

/// 글마다 가장 새 판(글쓴이 = 첫 판 올린 사람만), 새로 쓴 글이 위 · 고정된 글 id(팀장이 올린 가장 새 고정, 없는 글이면 빈 글)
pub fn fold(es: &[(&Item, Doc)], owners: &[String], me: &str) -> (Vec<Shown>, String) {
    let live: Vec<&(&Item, Doc)> = es.iter().filter(|(i, _)| usable(i)).collect();
    let author: BTreeMap<&str, &str> = live.iter().filter(|(_, d)| d.t == "post" && d.origin.is_empty()).map(|(i, _)| (i.id.as_str(), i.by_member.as_str())).collect();
    let mut best: BTreeMap<String, (&Item, &Doc)> = BTreeMap::new();
    for (i, d) in live.iter().filter(|(_, d)| d.t == "post").map(|x| (x.0, &x.1)) {
        let k = key_of(i, d);
        if author.get(k.as_str()) != Some(&i.by_member.as_str()) {
            continue;
        }
        if best.get(&k).is_none_or(|(_, o)| d.at > o.at) {
            best.insert(k, (i, d));
        }
    }
    let mut out: Vec<Shown> = best
        .into_iter()
        .map(|(k, (i, d))| {
            let by = author.get(k.as_str()).copied().unwrap_or_default().to_string();
            Shown { file: i.id.clone(), title: d.title.clone(), body: d.body.clone(), created: d.created, edited: if d.origin.is_empty() { 0 } else { d.at }, mine: by == me, by, id: k }
        })
        .collect();
    out.sort_by(|a, b| b.created.cmp(&a.created).then_with(|| b.id.cmp(&a.id)));
    let pin = live.iter().filter(|(i, d)| d.t == "pin" && owners.contains(&i.by_member)).max_by_key(|(_, d)| d.at).map(|(_, d)| d.origin.clone()).unwrap_or_default();
    let pinned = if out.iter().any(|p| p.id == pin) { pin } else { String::new() };
    (out, pinned)
}

/// 고친 뒤 치울 내 옛 판 — 그 글의 첫 판·새 판 말고
pub fn old_versions<'a>(es: &'a [(&Item, Doc)], me: &str, key: &str, keep: &str) -> Vec<&'a str> {
    es.iter().filter(|(i, d)| d.t == "post" && d.origin == key && i.by_member == me && i.id != keep).map(|(i, _)| i.id.as_str()).collect()
}

/// 글 하나의 모든 판(첫 판 + 고친 판) — 지울 때
pub fn versions_of<'a>(es: &'a [(&Item, Doc)], key: &str) -> Vec<&'a str> {
    es.iter().filter(|(i, d)| d.t == "post" && (i.id == key || d.origin == key)).map(|(i, _)| i.id.as_str()).collect()
}

// ── 네트워크 ──

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub team: String,
    pub rev: u64,
    pub posts: Vec<Shown>,
    pub pinned: String,
    /// 나는 팀장인가(고정 단추)
    pub owner: bool,
    /// 아직 받는 중인 글 수 — 받아 둔 글부터 먼저 그렸다(화면은 곧 다시 읽는다)
    pub loading: usize,
}

struct Ctx {
    t: team_relay::TeamEntry,
    /// 서명된 명부가 말하는 팀장(relay ADR 0014 R14) — 서버 members 의 role 이 아니다
    owners: Vec<String>,
    v: locker::View,
}

/// 목록만 — 나중에 든 사람 몫 봉투 더하기(ShareJob)는 기다리지 않는다(10-26 실측: 누가 든 뒤 첫 팀 홈이 요청 23개·약 10.7초를 기다렸다)
fn read(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<(Ctx, Vec<(Item, Doc)>, locker::ShareJob), String> {
    read_first(dir, kc, http, team, false).map(|(c, d, j, _)| (c, d, j))
}

/// first = 받아 둔 글부터 먼저 그려도 되나(팀 홈 글판) — 그러면 못 받은 글은 뒤에서 같이 받고 그 수를 돌려준다.
/// 글 본문은 한 번에 같이 받는다(team_profile::bytes_many — 10-31: 글 30개를 하나씩 차례로 받아 운영 ≈ 8초)
fn read_first(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, first: bool) -> Result<(Ctx, Vec<(Item, Doc)>, locker::ShareJob, usize), String> {
    let t = team_relay::load_state(dir).team(team).cloned()?;
    let owners = team_owners::holders(dir, kc, http, &t.id, "posts");
    let (v, job) = locker::list_split(dir, kc, http, &t.id)?;
    let (docs, loading) = {
        let posts: Vec<&Item> = v.items.iter().filter(|i| i.kind == "post" && usable(i)).collect();
        let (have, need): (Vec<&Item>, Vec<&Item>) = posts.iter().partition(|i| team_profile::cached(dir, &i.id));
        let later = first && first_paint(have.len(), need.len()) && http.fork().is_some();
        let take = if later { have } else { posts };
        if later {
            let (d, team, ids) = (dir.to_path_buf(), t.id.clone(), need.iter().map(|i| i.id.clone()).collect::<Vec<_>>());
            if let Some(h) = http.fork() {
                std::thread::spawn(move || {
                    let _ = team_profile::bytes_many(&d, &crate::team_relay_keys::store(), h.as_ref(), &team, &ids);
                });
            }
        }
        let ids: Vec<String> = take.iter().map(|i| i.id.clone()).collect();
        let docs: Vec<(Item, Doc)> = take.iter().zip(team_profile::bytes_many(dir, kc, http, &t.id, &ids)).filter_map(|(i, b)| b.ok().and_then(|b| decode(&b).ok()).map(|d| ((*i).clone(), d))).collect();
        (docs, if later { need.len() } else { 0 })
    };
    Ok((Ctx { t, owners, v }, docs, job, loading))
}

/// 받아 둔 글부터 먼저 그릴까 — 그릴 게 있고, 못 받은 게 같이 받기 한 번(PAR)보다 많을 때
pub(crate) fn first_paint(cached: usize, missing: usize) -> bool {
    cached > 0 && missing > team_relay::PAR
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// 팀 홈 글판 + 봉투 더하기 일 — 부르는 쪽(화면·폰 명령)은 글판을 먼저 돌려주고 일은 job.spawn() 으로(팀 보관함 화면과 같은 길)
pub fn board_split(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<(Board, locker::ShareJob), String> {
    let (c, docs, job, loading) = read_first(dir, kc, http, team, true)?;
    let pairs: Vec<(&Item, Doc)> = docs.iter().map(|(i, d)| (i, d.clone())).collect();
    let (posts, pinned) = fold(&pairs, &c.owners, &c.t.member_id);
    Ok((Board { team: c.t.id.clone(), rev: c.v.rev, posts, pinned, owner: team_owners::has(&c.owners, &c.t.member_id), loading }, job))
}

/// 글 쓰기·고치기(origin = 고칠 글 id) — 고치기는 글쓴이만. 돌려주는 건 글 id + 봉투 더하기 일(쓰기·고정·지우기 모두 — 부르는 쪽이 spawn)
pub fn write(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, title: &str, body: &str, origin: Option<&str>) -> Result<(String, locker::ShareJob), String> {
    let title = one_line(title, TITLE_MAX);
    if title.is_empty() {
        return Err("제목이 비었어".into());
    }
    let (c, docs, job) = read(dir, kc, http, team)?;
    let pairs: Vec<(&Item, Doc)> = docs.iter().map(|(i, d)| (i, d.clone())).collect();
    let (posts, _) = fold(&pairs, &c.owners, &c.t.member_id);
    let created = match origin {
        Some(o) => {
            let p = posts.iter().find(|p| p.id == o).ok_or("고칠 글이 없어")?;
            if !p.mine {
                return Err("남의 글은 못 고쳐".into());
            }
            p.created
        }
        None => now_ms(),
    };
    let d = Doc { t: "post".into(), title, body: body.chars().take(BODY_MAX).collect(), origin: origin.unwrap_or_default().into(), created, at: now_ms() };
    let id = team_profile::put(dir, kc, http, &c.t.id, "post", "post.json", &serde_json::to_vec(&d).map_err(|e| e.to_string())?)?;
    if let Some(o) = origin {
        for old in old_versions(&pairs, &c.t.member_id, o, &id) {
            let _ = locker::act(dir, kc, http, &c.t.id, old, "purge");
        }
    }
    Ok((origin.map_or(id, str::to_string), job))
}

/// 고정·풀기(post 빈 글) — 팀장만. 내 옛 고정 기록은 치운다
pub fn pin(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, post: &str) -> Result<locker::ShareJob, String> {
    let (c, docs, job) = read(dir, kc, http, team)?;
    if !team_owners::has(&c.owners, &c.t.member_id) {
        return Err("고정 공지는 팀장이나 글 고정 권한 매니저만".into());
    }
    if !post.is_empty() && !id_ok(post) {
        return Err("글 id 모양이 아니야".into());
    }
    let d = Doc { t: "pin".into(), origin: post.into(), at: now_ms(), ..Default::default() };
    let id = team_profile::put(dir, kc, http, &c.t.id, "post", "pin.json", &serde_json::to_vec(&d).map_err(|e| e.to_string())?)?;
    for (i, _) in docs.iter().filter(|(i, d)| d.t == "pin" && i.by_member == c.t.member_id && i.id != id) {
        let _ = locker::act(dir, kc, http, &c.t.id, &i.id, "purge");
    }
    Ok(job)
}

/// 글 지우기(휴지통 30일) — 글쓴이·팀장만
pub fn remove(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, post: &str) -> Result<locker::ShareJob, String> {
    let (c, docs, job) = read(dir, kc, http, team)?;
    let pairs: Vec<(&Item, Doc)> = docs.iter().map(|(i, d)| (i, d.clone())).collect();
    let (posts, _) = fold(&pairs, &c.owners, &c.t.member_id);
    let p = posts.iter().find(|p| p.id == post).ok_or("지울 글이 없어")?;
    if !p.mine && !team_owners::has(&c.owners, &c.t.member_id) {
        return Err("남의 글은 팀장이나 글 고정 권한 매니저만 지워".into());
    }
    for id in versions_of(&pairs, post) {
        locker::act(dir, kc, http, &c.t.id, id, "trash")?;
    }
    Ok(job)
}

#[cfg(test)]
#[path = "team_post_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "team_latency_live_tests.rs"]
mod latency_live;
