//! 팀 프로필 — 내 이름·사진·상태(대화 가능·자리 비움·방해 금지)·상태 글, 그리고 팀 아이콘.
//! 서버에 평문으로 안 남긴다(ADR 0007): 팀 보관함 길(team_locker_app, 파일마다 열쇠를 팀원 기기마다 봉투)로
//! kind profile = 작은 JSON, kind avatar = 그림(photo.* · 팀 아이콘은 team-icon.*). 서버는 누가 언제 올렸는지·크기만 안다.
//! 바꾸면 새로 올리고 내 옛 것은 바로 지운다(purge). 팀원 화면은 보관함 바뀜 알림(소켓 {t:"locker"})으로 다시 읽는다
use crate::accounts_store::Store;
use crate::team_locker_app::{self as locker, Item};
use crate::team_relay::{self, Http};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const NAME_MAX: usize = 30;
pub const NOTE_MAX: usize = 40;
/// 잘라서 올리는 그림(256px webp) 넉넉히
pub const IMAGE_MAX: usize = 512 * 1024;
const TEAM_ICON: &str = "team-icon";
/// 팀 홈 커버 사진(ADR 0018) — 팀 아이콘처럼 팀장만, 판(home.json)의 cover 가 가리킨다
const TEAM_COVER: &str = "team-cover";
const PHOTO: &str = "photo";

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    /// 바꾼 이름(빈 글 = 명부 이름 그대로)
    pub name: String,
    /// free | away | dnd
    pub status: String,
    pub note: String,
    /// 사진 파일 id(kind avatar) — 빈 글 = 사진 없음
    pub photo: String,
    /// 올린 기기 시각 ms
    pub at: u64,
}

fn one_line(s: &str, max: usize) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

fn file_id_ok(id: &str) -> bool {
    (16..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// 받은 프로필은 남의 글이다 — 모양을 고르고 길이를 자른다
pub fn clean(p: Profile) -> Profile {
    Profile {
        name: one_line(&p.name, NAME_MAX),
        status: if matches!(p.status.as_str(), "free" | "away" | "dnd") { p.status } else { "free".into() },
        note: one_line(&p.note, NOTE_MAX),
        photo: if file_id_ok(&p.photo) { p.photo } else { String::new() },
        at: p.at,
    }
}

pub fn decode(bytes: &[u8]) -> Result<Profile, String> {
    serde_json::from_slice::<Profile>(bytes).map(clean).map_err(|e| format!("프로필을 못 읽었어: {e}"))
}

fn usable(i: &Item) -> bool {
    i.why.is_empty() && i.deleted_at.is_none() && i.state != "trash" && i.state != "uploading"
}

fn stem(name: &str) -> &str {
    name.rsplit_once('.').map_or(name, |(s, _)| s)
}

/// 사람(멤버 id)마다 가장 새로 올린 프로필
pub fn latest_profiles(items: &[Item]) -> BTreeMap<String, &Item> {
    let mut out: BTreeMap<String, &Item> = BTreeMap::new();
    for i in items.iter().filter(|i| i.kind == "profile" && usable(i)) {
        if out.get(&i.by_member).is_none_or(|o| i.at > o.at) {
            out.insert(i.by_member.clone(), i);
        }
    }
    out
}

/// 사람마다 프로필 이름(멤버 id → 이름) — read 는 파일 id 로 푼 프로필 글. 빈 이름(명부 이름 그대로)·못 읽은 건 뺀다
pub fn names_from(items: &[Item], read: impl Fn(&str) -> Option<Vec<u8>>) -> BTreeMap<String, String> {
    latest_profiles(items).into_iter().filter_map(|(m, i)| read(&i.id).and_then(|b| decode(&b).ok()).filter(|p| !p.name.is_empty()).map(|p| (m, p.name))).collect()
}

/// 팀 아이콘 — 팀장이 올린 team-icon.* 중 가장 새 것(팀원이 올린 같은 이름은 무시)
pub fn team_icon<'a>(items: &'a [Item], owners: &[String]) -> Option<&'a Item> {
    items.iter().filter(|i| i.kind == "avatar" && usable(i) && stem(&i.name) == TEAM_ICON && owners.contains(&i.by_member)).max_by_key(|i| i.at)
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Slot {
    Profile,
    Photo,
    TeamIcon,
    TeamCover,
}

/// 바꾼 뒤 치울 옛 파일 — 그 자리(slot)의 내 파일 중 keep 이 아닌 것. 팀 아이콘은 팀장 누구 것이든(팀장은 남의 파일도 지울 수 있다)
pub fn stale<'a>(items: &'a [Item], me: &str, slot: Slot, keep: &[&str]) -> Vec<&'a str> {
    items
        .iter()
        .filter(|i| i.deleted_at.is_none() && !keep.contains(&i.id.as_str()))
        .filter(|i| match slot {
            Slot::Profile => i.kind == "profile" && i.by_member == me,
            Slot::Photo => i.kind == "avatar" && i.by_member == me && stem(&i.name) != TEAM_ICON && stem(&i.name) != TEAM_COVER,
            Slot::TeamIcon => i.kind == "avatar" && stem(&i.name) == TEAM_ICON,
            Slot::TeamCover => i.kind == "avatar" && stem(&i.name) == TEAM_COVER,
        })
        .map(|i| i.id.as_str())
        .collect()
}

pub fn is_team_cover(name: &str) -> bool {
    stem(name) == TEAM_COVER
}

/// 같은 팀 다른 사람 이름으로는 못 바꾼다 — 남인 척 막기(대소문자·앞뒤 빈칸 무시)
pub fn name_ok(name: &str, others: &[String]) -> Result<(), String> {
    let n = one_line(name, NAME_MAX).to_lowercase();
    if n.is_empty() {
        return Err("이름이 비었어".into());
    }
    if others.iter().any(|o| one_line(o, NAME_MAX).to_lowercase() == n) {
        return Err("같은 팀에 이미 있는 이름이야 — 다른 이름으로".into());
    }
    Ok(())
}

/// 받는 그림 — webp·png·jpeg 만(svg 는 스크립트를 품을 수 있다)
pub fn image_mime(b: &[u8]) -> Option<&'static str> {
    if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if b.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else {
        None
    }
}

pub fn data_url(b: &[u8]) -> Option<String> {
    image_mime(b).map(|m| format!("data:{m};base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
}

pub(crate) fn ext(mime: &str) -> &'static str {
    match mime {
        "image/webp" => "webp",
        "image/png" => "png",
        _ => "jpg",
    }
}

// ── 네트워크 ──

/// 화면에 줄 한 사람
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shown {
    pub name: String,
    pub status: String,
    pub note: String,
    /// data URL(그림) — 빈 글 = 사진 없음
    pub photo: String,
    pub at: u64,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub team: String,
    pub rev: u64,
    /// 멤버 id → 프로필
    pub people: BTreeMap<String, Shown>,
    pub team_icon: String,
}

fn cache_dir(dir: &Path) -> PathBuf {
    dir.join("team-profile-cache")
}

/// 파일 id 는 바뀌지 않는다 — 한 번 푼 그림·프로필은 데이터 폴더에 두고 다시 안 받는다
pub(crate) fn bytes_of(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str) -> Result<Vec<u8>, String> {
    if !file_id_ok(id) {
        return Err("파일 id 모양이 아니야".into());
    }
    let p = cache_dir(dir).join(id);
    if let Ok(b) = std::fs::read(&p) {
        return Ok(b);
    }
    let b = locker::get_bytes(dir, kc, http, team, id)?;
    if std::fs::create_dir_all(cache_dir(dir)).is_ok() {
        let _ = std::fs::write(&p, &b);
    }
    Ok(b)
}

/// 팀 하나의 프로필 이름 — 봉해 둔 마지막 보관함 목록과 이미 푼 프로필만 읽는다(scripts/team 이 망을 기다리지 않게).
/// 앱이 팀 화면을 그릴 때마다 채운다 — 아직 못 푼 사람은 명부 이름만 쓴다
pub fn cached_names(dir: &Path, kc: &dyn Store, team: &str) -> BTreeMap<String, String> {
    let Some(v) = locker::cached(dir, kc, team) else { return BTreeMap::new() };
    names_from(&v.items, |id| file_id_ok(id).then(|| std::fs::read(cache_dir(dir).join(id)).ok()).flatten())
}

fn team_entry(dir: &Path, team: &str) -> Result<team_relay::TeamEntry, String> {
    team_relay::load_state(dir).team(team).cloned()
}

/// 팀 하나의 프로필판 — 사람마다 최신 프로필 + 그 사진, 팀 아이콘
pub fn board(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<Board, String> {
    let t = team_entry(dir, team)?;
    let (v, _) = locker::list_split(dir, kc, http, &t.id)?;
    let mut people = BTreeMap::new();
    for (member, i) in latest_profiles(&v.items) {
        let Ok(p) = bytes_of(dir, kc, http, &t.id, &i.id).and_then(|b| decode(&b)) else { continue };
        let photo = if p.photo.is_empty() { String::new() } else { bytes_of(dir, kc, http, &t.id, &p.photo).ok().and_then(|b| data_url(&b)).unwrap_or_default() };
        people.insert(member, Shown { name: p.name, status: p.status, note: p.note, photo, at: p.at });
    }
    let owners: Vec<String> = t.members.iter().filter(|m| m.role == "owner").map(|m| m.id.clone()).collect();
    let team_icon = team_icon(&v.items, &owners).and_then(|i| bytes_of(dir, kc, http, &t.id, &i.id).ok()).and_then(|b| data_url(&b)).unwrap_or_default();
    Ok(Board { team: t.id, rev: v.rev, people, team_icon })
}

/// 바꿀 것 — None 은 그대로. photo: Some(None) = 사진 지우기
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Change {
    pub name: Option<String>,
    pub status: Option<String>,
    pub note: Option<String>,
    pub photo: Option<Option<Vec<u8>>>,
}

fn tmp_file(name: &str, bytes: &[u8]) -> Result<(PathBuf, PathBuf), String> {
    let d = std::env::temp_dir().join(format!("chammo-profile-{}", crate::tools::tmp_tag()));
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let p = d.join(name);
    std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
    Ok((d, p))
}

pub(crate) fn put(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, kind: &str, name: &str, bytes: &[u8]) -> Result<String, String> {
    let (d, p) = tmp_file(name, bytes)?;
    let r = locker::put_file(dir, kc, http, team, "", kind, &p).map(|f| f.id);
    let _ = std::fs::remove_dir_all(d);
    r
}

pub(crate) fn checked_image(b: &[u8]) -> Result<&'static str, String> {
    if b.len() > IMAGE_MAX {
        return Err("그림이 너무 커(512KB 까지)".into());
    }
    image_mime(b).ok_or_else(|| "그림은 webp·png·jpeg 만".into())
}

/// 내 프로필 바꾸기 — 내가 든 팀마다(팀마다 열쇠가 따로라 팀마다 올린다). 실패한 팀은 이유를 모아 돌려준다
pub fn set(dir: &Path, kc: &dyn Store, http: &dyn Http, c: &Change) -> Result<Vec<String>, String> {
    if let Some(Some(b)) = &c.photo {
        checked_image(b)?;
    }
    let st = team_relay::load_state(dir);
    if st.teams.is_empty() {
        return Err("든 팀이 없어".into());
    }
    let mut failed = vec![];
    for t in &st.teams {
        if let Err(e) = set_one(dir, kc, http, &t.id, c) {
            failed.push(format!("{}: {e}", t.name));
        }
    }
    if failed.len() == st.teams.len() {
        return Err(failed.join(" / "));
    }
    if let Some(s) = &c.status {
        remember_status(dir, &clean(Profile { status: s.clone(), ..Default::default() }).status);
    }
    Ok(failed)
}

fn set_one(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, c: &Change) -> Result<(), String> {
    let t = team_entry(dir, team)?;
    let (v, _) = locker::list_split(dir, kc, http, &t.id)?;
    let mine = latest_profiles(&v.items).get(&t.member_id).and_then(|i| bytes_of(dir, kc, http, &t.id, &i.id).ok()).and_then(|b| decode(&b).ok()).unwrap_or_default();
    let mut p = mine.clone();
    if let Some(n) = &c.name {
        let n = one_line(n, NAME_MAX);
        if n != one_line(&t.display_name, NAME_MAX) && !n.is_empty() {
            let shown = latest_profiles(&v.items);
            let others: Vec<String> = t
                .members
                .iter()
                .filter(|m| m.id != t.member_id)
                .flat_map(|m| {
                    let alias = shown.get(&m.id).and_then(|i| bytes_of(dir, kc, http, &t.id, &i.id).ok()).and_then(|b| decode(&b).ok()).map(|p| p.name).unwrap_or_default();
                    [m.display_name.clone(), alias]
                })
                .filter(|s| !s.is_empty())
                .collect();
            name_ok(&n, &others)?;
        }
        p.name = if n == one_line(&t.display_name, NAME_MAX) { String::new() } else { n };
    }
    if let Some(s) = &c.status {
        p.status = s.clone();
    }
    if let Some(n) = &c.note {
        p.note = n.clone();
    }
    match &c.photo {
        Some(Some(b)) => p.photo = put(dir, kc, http, &t.id, "avatar", &format!("{PHOTO}.{}", ext(checked_image(b)?)), b)?,
        Some(None) => p.photo = String::new(),
        None => {}
    }
    p.at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    let p = clean(p);
    let id = put(dir, kc, http, &t.id, "profile", "profile.json", &serde_json::to_vec(&p).map_err(|e| e.to_string())?)?;
    for old in stale(&v.items, &t.member_id, Slot::Profile, &[&id]) {
        let _ = locker::act(dir, kc, http, &t.id, old, "purge");
    }
    if c.photo.is_some() {
        for old in stale(&v.items, &t.member_id, Slot::Photo, &[&p.photo]) {
            let _ = locker::act(dir, kc, http, &t.id, old, "purge");
        }
    }
    Ok(())
}

/// 팀 아이콘 바꾸기·지우기 — 팀장만
pub fn set_team_icon(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, image: Option<&[u8]>) -> Result<(), String> {
    let t = team_entry(dir, team)?;
    if t.role != "owner" {
        return Err("팀 아이콘은 팀장만 바꿔".into());
    }
    let (v, _) = locker::list_split(dir, kc, http, &t.id)?;
    let keep = match image {
        Some(b) => put(dir, kc, http, &t.id, "avatar", &format!("{TEAM_ICON}.{}", ext(checked_image(b)?)), b)?,
        None => String::new(),
    };
    for old in stale(&v.items, &t.member_id, Slot::TeamIcon, &[&keep]) {
        let _ = locker::act(dir, kc, http, &t.id, old, "purge");
    }
    Ok(())
}

// ── 방해 금지 — 이 기기 팀 알림·소리를 끈다(받는 기기가 정한다, 서버는 상태를 모른다) ──

const ME_FILE: &str = "team-profile-me.json";

pub fn remember_status(dir: &Path, status: &str) {
    let _ = std::fs::write(dir.join(ME_FILE), serde_json::json!({ "status": status }).to_string());
}

pub fn dnd(dir: &Path) -> bool {
    std::fs::read(dir.join(ME_FILE)).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()).is_some_and(|v| v["status"] == "dnd")
}

// ── 바뀜 — 화면이 자기가 본 판(Board.rev)을 들고 묻는다. 창이 여럿(메인·메신저 창)이라 판을 여기 두면 서로 알림을 먹는다 ──

/// 프로필판을 다시 읽어야 하나 — 소켓이 알린 판이 화면이 본 판보다 새로우면
pub fn changed(team: &str, seen: u64) -> bool {
    changed_at(team, seen, std::time::Instant::now())
}

/// 폰(/api/team-profiles·team-posts ?rev=)에 '그대로'로 답해도 되나 — 본 판이 있고, 소켓이 알린 판을 알고(맥을 다시 켜면 0 이라 모름), 그보다 새 판이 없을 때만.
/// 물러서기(changed_at)는 안 본다 — 물러서는 동안 폰이 옛 판이면 '그대로'가 아니라 다시 읽어 실패 이유를 받는다(목록이 물러서는 중엔 중계를 안 부른다)
pub fn phone_same(team: &str, seen: u64) -> bool {
    let told = locker::told(team);
    seen > 0 && told != 0 && told <= seen
}

/// 목록이 실패해 물러서는 중이면 false — 실패하면 본 판이 0 에 머물러 3초마다 영영 다시 읽었다(10-26 사고)
pub(crate) fn changed_at(team: &str, seen: u64, now: std::time::Instant) -> bool {
    locker::told(team) > seen && !locker::backing_off(team, now)
}

#[cfg(test)]
#[path = "team_profile_tests.rs"]
mod tests;
