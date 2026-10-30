//! 팀 홈 판 읽기·저장(ADR 0018) — 팀 홈 글·팀 참모와 같은 팀 보관함 길(kind post 안쪽 t=home·homeblk, 커버는 kind avatar team-cover.*).
//! 목록만 받고 봉투 더하기(ShareJob)는 기다리지 않는다 — 부르는 쪽이 spawn(team_post 와 같은 길)
use crate::accounts_store::Store;
use crate::team_home::{self as home, Content, Home};
use crate::team_locker_app::{self as locker, Item};
use crate::team_owners;
use crate::team_profile::{self, Slot};
use crate::team_relay::{self, Http};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

const HOME_FILE: &str = "home.json";
const CONTENT_FILE: &str = "homeblk.json";

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub team: String,
    pub rev: u64,
    /// 지금 판 — 없으면 아직 안 꾸민 팀(팀장 = 템플릿 화면, 팀원 = 글 목록 그대로)
    pub home: Option<Home>,
    /// 판을 마지막으로 바꾼 멤버 id
    pub by: String,
    /// 블록 id → 내용
    pub content: BTreeMap<String, home::Shown>,
    /// 커버 사진 data URL(빈 글 = 팀 색 면)
    pub cover: String,
    /// 나는 팀장인가(꾸미기 아이콘)
    pub owner: bool,
    pub me: String,
}

struct Read {
    t: team_relay::TeamEntry,
    /// 서명된 명부가 말하는 팀장(relay ADR 0014 R14) — 서버 members 의 role 이 아니다
    owners: Vec<String>,
    v: locker::View,
    homes: Vec<(Item, Home)>,
    contents: Vec<(Item, Content)>,
}

fn read(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<(Read, locker::ShareJob), String> {
    let t = team_relay::load_state(dir).team(team).cloned()?;
    let owners = team_owners::holders(dir, kc, http, &t.id, "look");
    let (v, job) = locker::list_split(dir, kc, http, &t.id)?;
    let bytes = |i: &Item| team_profile::bytes_of(dir, kc, http, &t.id, &i.id).ok();
    let posts = || v.items.iter().filter(|i| i.kind == "post" && home::usable(i));
    let homes = posts().filter(|i| i.name == HOME_FILE).filter_map(|i| bytes(i).and_then(|b| home::decode_home(&b).ok()).map(|h| (i.clone(), h))).collect();
    let contents = posts().filter(|i| i.name == CONTENT_FILE).filter_map(|i| bytes(i).and_then(|b| home::decode_content(&b).ok()).map(|c| (i.clone(), c))).collect();
    Ok((Read { t, owners, v, homes, contents }, job))
}

fn current(r: &Read) -> Option<(Home, String, String)> {
    let pairs: Vec<(&Item, Home)> = r.homes.iter().map(|(i, h)| (i, h.clone())).collect();
    home::fold_home(&pairs, &r.owners)
}

/// 팀 홈 판 + 봉투 더하기 일
pub fn board(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<(Board, locker::ShareJob), String> {
    let (r, job) = read(dir, kc, http, team)?;
    let cur = current(&r);
    let content = match &cur {
        Some((h, _, _)) => {
            let ids: Vec<String> = h.blocks.iter().map(|b| b.id.clone()).collect();
            let pairs: Vec<(&Item, Content)> = r.contents.iter().map(|(i, c)| (i, c.clone())).collect();
            home::fold_content(&pairs, &ids)
        }
        None => BTreeMap::new(),
    };
    let cover = cur
        .as_ref()
        .filter(|(h, _, _)| !h.cover.is_empty() && home::cover_ok(&r.v.items, &r.owners, &h.cover))
        .and_then(|(h, _, _)| team_profile::bytes_of(dir, kc, http, &r.t.id, &h.cover).ok())
        .and_then(|b| team_profile::data_url(&b))
        .unwrap_or_default();
    let (home, by) = cur.map_or((None, String::new()), |(h, by, _)| (Some(h), by));
    Ok((Board { team: r.t.id.clone(), rev: r.v.rev, home, by, content, cover, owner: team_owners::has(&r.owners, &r.t.member_id), me: r.t.member_id.clone() }, job))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn put(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, name: &str, bytes: &[u8]) -> Result<String, String> {
    team_profile::put(dir, kc, http, team, "post", name, bytes)
}

/// 꾸미기 완료 — 판 한 장을 통째로(팀장만). 내 옛 판·이 판이 안 쓰는 커버는 치운다
pub fn save_home(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, draft: Home) -> Result<locker::ShareJob, String> {
    let (r, job) = read(dir, kc, http, team)?;
    if !team_owners::has(&r.owners, &r.t.member_id) {
        return Err("팀 홈 꾸미기는 팀장이나 꾸미기 권한 매니저만".into());
    }
    let h = home::clean_home(Home { t: "home".into(), at: now_ms(), ..draft });
    if !h.cover.is_empty() && !home::cover_ok(&r.v.items, &r.owners, &h.cover) {
        return Err("커버 사진을 못 찾았어 — 다시 올려 줘".into());
    }
    let id = put(dir, kc, http, &r.t.id, HOME_FILE, &serde_json::to_vec(&h).map_err(|e| e.to_string())?)?;
    let pairs: Vec<(&Item, Home)> = r.homes.iter().map(|(i, h)| (i, h.clone())).collect();
    for old in home::old_homes(&pairs, &r.t.member_id, &id) {
        let _ = locker::act(dir, kc, http, &r.t.id, old, "purge");
    }
    for old in team_profile::stale(&r.v.items, &r.t.member_id, Slot::TeamCover, &[&h.cover]) {
        let _ = locker::act(dir, kc, http, &r.t.id, old, "purge");
    }
    Ok(job)
}

/// 블록 안 내용(링크·글 한 칸·진행 중) — 팀원 누구나. 그 블록의 내 옛 판은 치운다
pub fn save_content(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, block: &str, draft: Content) -> Result<locker::ShareJob, String> {
    let (r, job) = read(dir, kc, http, team)?;
    home::content_block(current(&r).as_ref().map(|(h, _, _)| h), block)?;
    let c = home::clean_content(Content { t: "homeblk".into(), origin: block.into(), at: now_ms(), ..draft });
    let id = put(dir, kc, http, &r.t.id, CONTENT_FILE, &serde_json::to_vec(&c).map_err(|e| e.to_string())?)?;
    let pairs: Vec<(&Item, Content)> = r.contents.iter().map(|(i, c)| (i, c.clone())).collect();
    for old in home::old_contents(&pairs, &r.t.member_id, block, &id) {
        let _ = locker::act(dir, kc, http, &r.t.id, old, "purge");
    }
    Ok(job)
}

/// 커버 사진 올리기(팀장만) — 파일 id. 판은 완료 때 바뀌어서 옛 커버는 그때 치운다(꾸미다 그만두면 다음 완료 때)
pub fn upload_cover(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, image: &[u8]) -> Result<String, String> {
    let t = team_relay::load_state(dir).team(team).cloned()?;
    if !team_owners::has(&team_owners::holders(dir, kc, http, &t.id, "look"), &t.member_id) {
        return Err("커버 사진은 팀장이나 꾸미기 권한 매니저만".into());
    }
    let mime = team_profile::checked_image(image)?;
    team_profile::put(dir, kc, http, &t.id, "avatar", &format!("team-cover.{}", team_profile::ext(mime)), image)
}
