//! 팀 홈 판(ADR 0018) — 블록 배치·머리(팀장이 꾸미기 완료 때 한 장)와 블록 안 내용(팀원 누구나, 블록마다 한 장).
//! 팀 홈 글·팀 참모와 같은 팀 보관함 봉투 길 kind post 안쪽 t = home | homeblk — 서버는 내용을 못 보고 바뀜 0.
//! 옛 앱 team_post::decode 는 모르는 t 를 빈 글로 접어 무시한다
use crate::team_locker_app::Item;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const BLOCKS_MAX: usize = 24;
pub const LINKS_MAX: usize = 12;
pub const GOALS_MAX: usize = 8;
pub const BLURB_MAX: usize = 80;
pub const NOTE_MAX: usize = 2_000;
pub const COLORS: u8 = 8;
/// 블록 종류(ADR 0018 8) — 모르는 k 는 버린다(옛 앱은 새 블록을 그냥 안 그린다)
pub const KINDS: &[&str] = &["pin", "posts", "members", "agents", "files", "links", "note", "goals", "mode"];
const NAME_MAX: usize = 40;
const TITLE_MAX: usize = 60;
const URL_MAX: usize = 500;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Block {
    pub id: String,
    pub k: String,
    /// half | full
    pub w: String,
    /// 모드 블록만 — 보는 기기에 깔린 모드 이름
    #[serde(skip_serializing_if = "String::is_empty")]
    pub mode: String,
}

/// 홈 판 — t = home
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Home {
    pub t: String,
    /// 팀 색 번호(화면 팔레트, 0..COLORS)
    pub color: u8,
    pub blurb: String,
    /// 커버 사진 파일 id(kind avatar team-cover.*) — 빈 글 = 팀 색 면
    pub cover: String,
    pub blocks: Vec<Block>,
    pub at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Link {
    pub name: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Note {
    pub title: String,
    pub body: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Goal {
    pub name: String,
    pub done: u32,
    pub total: u32,
}

/// 블록 안 내용 — t = homeblk, origin = 블록 id
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Content {
    pub t: String,
    pub origin: String,
    pub links: Vec<Link>,
    pub note: Note,
    pub goals: Vec<Goal>,
    pub at: u64,
}

fn one_line(s: &str, max: usize) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

fn file_id_ok(id: &str) -> bool {
    (16..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn block_id_ok(id: &str) -> bool {
    (1..=24).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// 폭을 안 적었거나 모르는 값이면 — 공지·글 목록·모드는 전체, 나머지는 반
fn width_of(k: &str, w: &str) -> String {
    match w {
        "half" | "full" => w.into(),
        _ if matches!(k, "pin" | "posts" | "mode") => "full".into(),
        _ => "half".into(),
    }
}

/// 받은 판은 남이 쓴 것 — 모양을 고르고 자른다
pub fn clean_home(h: Home) -> Home {
    let mut seen = std::collections::BTreeSet::new();
    let blocks = h
        .blocks
        .into_iter()
        .filter(|b| KINDS.contains(&b.k.as_str()) && block_id_ok(&b.id) && seen.insert(b.id.clone()))
        .take(BLOCKS_MAX)
        .map(|b| Block {
            w: width_of(&b.k, &b.w),
            mode: if b.k == "mode" && crate::modes::safe_name(&b.mode) { b.mode } else { String::new() },
            id: b.id,
            k: b.k,
        })
        .collect();
    Home {
        t: if h.t == "home" { h.t } else { String::new() },
        color: if h.color < COLORS { h.color } else { 0 },
        blurb: one_line(&h.blurb, BLURB_MAX),
        cover: if file_id_ok(&h.cover) { h.cover } else { String::new() },
        blocks,
        at: h.at,
    }
}

/// 링크는 http·https 만 — javascript:·file: 같은 주소는 누르는 사람 기기에서 돈다
fn clean_link(l: Link) -> Option<Link> {
    let url = l.url.trim();
    let name = one_line(&l.name, NAME_MAX);
    let ok = (url.starts_with("https://") || url.starts_with("http://")) && url.len() <= URL_MAX && !url.chars().any(char::is_whitespace);
    (ok && !name.is_empty()).then(|| Link { name, url: url.into() })
}

pub fn clean_content(c: Content) -> Content {
    Content {
        t: if c.t == "homeblk" { c.t } else { String::new() },
        origin: if block_id_ok(&c.origin) { c.origin } else { String::new() },
        links: c.links.into_iter().filter_map(clean_link).take(LINKS_MAX).collect(),
        note: Note { title: one_line(&c.note.title, TITLE_MAX), body: c.note.body.chars().take(NOTE_MAX).collect() },
        goals: c
            .goals
            .into_iter()
            .map(|g| Goal { name: one_line(&g.name, NAME_MAX), done: g.done.min(g.total), total: g.total.min(99) })
            .filter(|g| !g.name.is_empty() && g.total > 0)
            .take(GOALS_MAX)
            .collect(),
        at: c.at,
    }
}

pub fn decode_home(bytes: &[u8]) -> Result<Home, String> {
    serde_json::from_slice::<Home>(bytes).map(clean_home).map_err(|e| format!("홈 판을 못 읽었어: {e}"))
}

pub fn decode_content(bytes: &[u8]) -> Result<Content, String> {
    serde_json::from_slice::<Content>(bytes).map(clean_content).map_err(|e| format!("블록 내용을 못 읽었어: {e}"))
}

pub(crate) fn usable(i: &Item) -> bool {
    i.why.is_empty() && i.deleted_at.is_none() && i.state != "trash" && i.state != "uploading"
}

/// 지금 판 — 팀장이 올린 판 중 가장 새 at(같으면 파일 id 큰 쪽, 기기마다 같은 판). (판, 올린 멤버, 파일 id)
pub fn fold_home(es: &[(&Item, Home)], owners: &[String]) -> Option<(Home, String, String)> {
    es.iter()
        .filter(|(i, h)| usable(i) && h.t == "home" && owners.contains(&i.by_member))
        .max_by(|(a, x), (b, y)| x.at.cmp(&y.at).then_with(|| a.id.cmp(&b.id)))
        .map(|(i, h)| (h.clone(), i.by_member.clone(), i.id.clone()))
}

/// 화면에 줄 블록 내용 하나
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shown {
    pub links: Vec<Link>,
    pub note: Note,
    pub goals: Vec<Goal>,
    /// 마지막으로 고친 멤버 id
    pub by: String,
    pub at: u64,
}

/// 블록마다 가장 새 내용 — 누구나 쓴다. 판에 없는 블록 내용은 버린다
pub fn fold_content(es: &[(&Item, Content)], blocks: &[String]) -> BTreeMap<String, Shown> {
    let mut best: BTreeMap<String, (&Item, &Content)> = BTreeMap::new();
    for (i, c) in es.iter().filter(|(i, c)| usable(i) && c.t == "homeblk" && blocks.contains(&c.origin)) {
        if best.get(&c.origin).is_none_or(|(oi, o)| (c.at, &i.id) > (o.at, &oi.id)) {
            best.insert(c.origin.clone(), (i, c));
        }
    }
    best.into_iter().map(|(k, (i, c))| (k, Shown { links: c.links.clone(), note: c.note.clone(), goals: c.goals.clone(), by: i.by_member.clone(), at: c.at })).collect()
}

/// 새 판을 올린 뒤 치울 내 옛 홈 판
pub fn old_homes<'a>(es: &'a [(&Item, Home)], me: &str, keep: &str) -> Vec<&'a str> {
    es.iter().filter(|(i, h)| h.t == "home" && i.by_member == me && i.id != keep).map(|(i, _)| i.id.as_str()).collect()
}

/// 그 블록 내용의 내 옛 판
pub fn old_contents<'a>(es: &'a [(&Item, Content)], me: &str, block: &str, keep: &str) -> Vec<&'a str> {
    es.iter().filter(|(i, c)| c.t == "homeblk" && c.origin == block && i.by_member == me && i.id != keep).map(|(i, _)| i.id.as_str()).collect()
}

/// 내용을 받는 블록 — 지금 판에 있고 글을 담는 종류(링크·글 한 칸·진행 중)만
pub fn content_block(home: Option<&Home>, block: &str) -> Result<(), String> {
    let h = home.ok_or("아직 팀 홈 판이 없어")?;
    let b = h.blocks.iter().find(|b| b.id == block).ok_or("판에 없는 블록이야 — 홈을 다시 불러 줘")?;
    if matches!(b.k.as_str(), "links" | "note" | "goals") { Ok(()) } else { Err("이 블록은 내용을 따로 안 받아".into()) }
}

/// 커버로 쓸 수 있는 파일 — 팀장이 올린 kind avatar team-cover.*
pub fn cover_ok(items: &[Item], owners: &[String], id: &str) -> bool {
    items.iter().any(|i| i.id == id && usable(i) && i.kind == "avatar" && crate::team_profile::is_team_cover(&i.name) && owners.contains(&i.by_member))
}

#[cfg(test)]
#[path = "team_home_tests.rs"]
mod tests;
