//! 보관함 휴지통 지킴(2026-10-12 사고 — 스크린샷 연결이 바탕화면을 가리킨 채 ⌘A → 휴지통으로 폴더 93개가 1초 만에 갔다).
//! 화면을 믿지 않고 Rust 가 마지막에 본다: 저장소(.git)·devRoot 와 그 위·홈 표준 폴더 자체·돌고 있는 세션 작업 폴더와 그 위·앱 데이터 폴더는 거절,
//! 안에 든 것이 있는 폴더는 화면이 '폴더 포함'을 따로 확인받았을 때만(folders_ok). 옮긴 목록은 데이터 폴더에 남겨 마지막 묶음을 되돌린다
use crate::locker_fs::{self, canon, es, exists_any, Ctx};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 마지막 휴지통 묶음 기록(데이터 폴더) — 앱을 다시 켜도 되돌릴 수 있게
pub const LAST: &str = "locker-trash-last.json";
/// 홈 바로 아래 표준 폴더 — 그 자체는 못 지운다(안쪽은 된다)
const STANDARD: [&str; 9] = ["Desktop", "Documents", "Downloads", "Pictures", "Movies", "Music", "Public", "Applications", "Library"];
/// 폴더 안을 셀 때 보는 최대 항목 수 — 넘는 큰 폴더는 앱에서 안 지운다(파인더로)
const SCAN_CAP: usize = 20_000;

/// 휴지통 지킴 — keep = 돌고 있는 세션 작업 폴더 등(ctx.settled = devRoot·HQ·따로 더한 프로젝트도 늘 지킨다)
pub struct Guard<'a> {
    pub keep: &'a [PathBuf],
    /// 안에 든 것이 있는 폴더 — 화면이 '폴더 n개 포함(안에 k개)'을 따로 확인받았나
    pub folders_ok: bool,
}

/// 옮긴 것 하나 — trash = 휴지통으로 간 것, move = 꺼내거나 옮긴 안의 것, extra = 따라간 이전 판(.판)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    #[default]
    Trash,
    Move,
    Extra,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Moved {
    pub from: PathBuf,
    pub to: PathBuf,
    #[serde(default)]
    pub kind: Kind,
}

#[derive(Debug, Clone, Serialize)]
pub struct Blocked {
    pub rel: String,
    pub why: String,
}

/// 확인 문구 재료 — files = 파일·바로가기, dirs = 안에 든 것이 있는 폴더(inside = 그 안 항목, 카드 숫자와 같은 기준), empties = 빈 폴더(숨은 파일만 있어도)
#[derive(Debug, Clone, Serialize, Default)]
pub struct Plan {
    pub files: usize,
    pub dirs: usize,
    pub empties: usize,
    pub inside: usize,
    /// 너무 커서 다 못 셌다
    pub more: bool,
    pub blocked: Vec<Blocked>,
    pub file_rels: Vec<String>,
    pub dir_rels: Vec<String>,
    pub empty_rels: Vec<String>,
    /// 안에 든 것이 있는 폴더가 모두 보관함 폴더(연결 안쪽 아님) — 꺼내기·옮기기가 된다
    pub lift_ok: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Done {
    pub moved: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Last {
    pub count: usize,
    pub at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Undone {
    pub restored: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Record {
    at: u64,
    moves: Vec<Moved>,
}

// ── 세기 ──

/// 폴더 안 — items = 하위 폴더까지 보이는 파일·바로가기(숨은 것·폴더 자체는 안 센다 = 보관함 카드 숫자), git = 안 어딘가에 저장소
pub struct Scan {
    pub items: usize,
    pub git: bool,
    pub more: bool,
}

pub fn scan(dir: &Path) -> Scan {
    let mut s = Scan { items: 0, git: false, more: false };
    let mut stack = vec![dir.to_path_buf()];
    let mut seen = 0;
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            seen += 1;
            if seen > SCAN_CAP {
                s.more = true;
                return s;
            }
            let name = e.file_name().to_string_lossy().into_owned();
            if name == ".git" {
                s.git = true;
                return s;
            }
            if name.starts_with('.') {
                continue;
            }
            match std::fs::symlink_metadata(e.path()) {
                Ok(m) if m.is_dir() => stack.push(e.path()),
                Ok(_) => s.items += 1,
                Err(_) => {}
            }
        }
    }
    s
}

fn real_dir(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.is_dir())
}

// ── 거절 ──

/// 휴지통으로 보내면 안 되는 자리인가 — p 는 링크를 푼 진짜 경로(보관함 바로가기는 부르는 쪽이 건너뛴다)
pub fn refuse(ctx: &Ctx, keep: &[PathBuf], p: &Path) -> Result<(), String> {
    let p = canon(p);
    let home = canon(ctx.home);
    if home.starts_with(&p) {
        return Err("홈 폴더와 그 위는 못 지워".into());
    }
    if STANDARD.iter().any(|d| p == home.join(d)) {
        return Err("홈 표준 폴더(바탕화면·문서·다운로드 등) 자체는 못 지워".into());
    }
    let (data, root) = (canon(ctx.data), canon(ctx.root));
    if data.starts_with(&p) || root.starts_with(&p) || (p.starts_with(&data) && !p.starts_with(&root)) {
        return Err("앱 데이터·보관함 자리는 못 지워".into());
    }
    if ctx.settled.iter().chain(keep).any(|k| canon(k).starts_with(&p)) {
        return Err("프로젝트 폴더(devRoot)·돌고 있는 세션 작업 폴더와 그 위는 못 지워".into());
    }
    if real_dir(&p) {
        let s = scan(&p);
        if s.git {
            return Err("저장소(.git)가 든 폴더는 못 지워".into());
        }
        if s.more {
            return Err(format!("항목이 {SCAN_CAP}개 넘는 큰 폴더는 앱에서 안 지워 — 파인더에서"));
        }
    }
    Ok(())
}

/// refuse + 안에 든 것이 있는 폴더는 확인 플래그가 있어야
pub fn check(ctx: &Ctx, g: &Guard, p: &Path) -> Result<(), String> {
    refuse(ctx, g.keep, p)?;
    if !g.folders_ok && real_dir(p) && scan(p).items > 0 {
        return Err("안에 든 것이 있는 폴더는 '폴더 포함' 확인을 받아야 지워".into());
    }
    Ok(())
}

// ── 묶음 ──

/// 확인 문구 재료 — 보내지 않고 센다. 못 지우는 것은 blocked 로
pub fn plan(ctx: &Ctx, owner: &Path, rels: &[String], keep: &[PathBuf]) -> Plan {
    let g = Guard { keep, folders_ok: true };
    let mut p = Plan { lift_ok: true, ..Plan::default() };
    for rel in rels {
        let at = match crate::locker_link::checked(ctx, owner, rel, &g) {
            Ok(at) => at,
            Err(why) => {
                p.blocked.push(Blocked { rel: rel.clone(), why });
                continue;
            }
        };
        if !real_dir(&at) {
            p.files += 1;
            p.file_rels.push(rel.clone());
            continue;
        }
        let s = scan(&at);
        if s.items == 0 {
            p.empties += 1;
            p.empty_rels.push(rel.clone());
            continue;
        }
        p.dirs += 1;
        p.inside += s.items;
        p.more |= s.more;
        p.dir_rels.push(rel.clone());
        p.lift_ok &= !crate::locker_link::in_connection(owner, rel);
    }
    p.lift_ok &= p.dirs > 0;
    p
}

/// 고른 묶음을 휴지통으로 — 안에 든 것이 있는 폴더가 섞였는데 확인 플래그가 없으면 하나도 안 보낸다(통째로 거절).
/// 못 지우는 것은 빼고 나머지만, 옮긴 것은 하나씩 기록(되돌리기)
pub fn trash_batch(ctx: &Ctx, owner: &Path, rels: &[String], bin: &Path, g: &Guard) -> Result<Done, String> {
    if !g.folders_ok {
        let full = plan(ctx, owner, rels, g.keep);
        if full.dirs > 0 {
            return Err(format!("폴더 {}개(안에 든 항목 {}개)가 섞여 있어 — '폴더 포함' 확인을 받아야 해", full.dirs, full.inside));
        }
    }
    let mut rec = Record { at: now_ms(), moves: Vec::new() };
    let mut d = Done { moved: 0, errors: Vec::new() };
    for rel in rels {
        match crate::locker_link::trash_any(ctx, owner, rel, bin, g) {
            Ok(ms) => {
                d.moved += 1;
                rec.moves.extend(ms.into_iter().enumerate().map(|(i, m)| Moved { kind: if i == 0 { Kind::Trash } else { Kind::Extra }, ..m }));
                save(ctx.data, &rec)?; // 하나 보낼 때마다 — 중간에 멈춰도 보낸 것까지는 되돌린다
            }
            Err(e) => d.errors.push(e),
        }
    }
    Ok(d)
}

/// 안에 든 것은 꺼내고(to = None 이면 그 폴더의 위 폴더, 아니면 보관함 안 그 폴더로) 폴더만 휴지통으로 — 보관함 폴더만(연결 안쪽은 읽기 전용).
/// 이름이 겹치면 ' 2'. 옮기기 전에 갈 곳을 다 보고 하나라도 안 되면 아무것도 안 옮긴다
pub fn empty_out_batch(ctx: &Ctx, owner: &Path, rels: &[String], to: Option<&str>, bin: &Path, g: &Guard) -> Result<Done, String> {
    let mut jobs = Vec::new();
    let mut loose = Vec::new(); // 같이 고른 파일·바로가기·빈 폴더 — 그냥 휴지통
    for rel in rels {
        if crate::locker_link::checked(ctx, owner, rel, g).is_ok_and(|p| !real_dir(&p) || scan(&p).items == 0) {
            loose.push(rel.clone());
            continue;
        }
        if crate::locker_link::in_connection(owner, rel) || crate::locker_link::is_connected(owner, rel) {
            return Err(format!("연결 폴더 안은 꺼내거나 옮길 수 없어 — 같이 휴지통으로만: {rel}"));
        }
        let dir = crate::locker_link::checked(ctx, owner, rel, &Guard { keep: g.keep, folders_ok: true })?;
        if !real_dir(&dir) {
            return Err(format!("폴더가 아니야: {rel}"));
        }
        let parent = rel.rsplit_once('/').map(|(a, _)| a.to_string()).unwrap_or_default();
        let dest = to.map(str::to_string).unwrap_or(parent);
        let dp = locker_fs::inside(owner, &dest)?;
        if !real_dir(&dp) || !canon(&dp).starts_with(canon(owner)) || crate::locker_link::in_connection(owner, &dest) || crate::locker_link::is_connected(owner, &dest) {
            return Err(format!("옮길 수 없는 폴더: {}", if dest.is_empty() { "보관함(맨 위)" } else { dest.as_str() }));
        }
        if dp == dir || dp.starts_with(&dir) {
            return Err("폴더를 자기 안으로는 못 옮겨".into());
        }
        jobs.push((rel.clone(), dir, dest));
    }
    let mut rec = Record { at: now_ms(), moves: Vec::new() };
    let mut d = Done { moved: 0, errors: Vec::new() };
    for rel in loose {
        match crate::locker_link::trash_any(ctx, owner, &rel, bin, g) {
            Ok(ms) => {
                d.moved += 1;
                rec.moves.extend(ms.into_iter().enumerate().map(|(i, m)| Moved { kind: if i == 0 { Kind::Trash } else { Kind::Extra }, ..m }));
                save(ctx.data, &rec)?;
            }
            Err(e) => d.errors.push(e),
        }
    }
    for (rel, dir, dest) in jobs {
        let kids: Vec<String> = std::fs::read_dir(&dir).map_err(es)?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| !n.starts_with('.')).collect();
        let mut failed = false;
        for k in kids {
            let from = dir.join(&k);
            match locker_fs::move_entry(owner, &format!("{rel}/{k}"), &dest) {
                Ok(new) => {
                    let to = owner.join(&new);
                    let (vf, vt) = (locker_fs::vers_dir(&from), locker_fs::vers_dir(&to));
                    rec.moves.push(Moved { from, to, kind: Kind::Move });
                    if vt.is_dir() && !exists_any(&vf) {
                        rec.moves.push(Moved { from: vf, to: vt, kind: Kind::Extra });
                    }
                    save(ctx.data, &rec)?;
                }
                Err(e) => {
                    d.errors.push(format!("{rel}/{k}: {e}"));
                    failed = true;
                }
            }
        }
        if failed {
            continue; // 다 못 꺼냈으면 폴더는 남긴다
        }
        match crate::locker_link::trash_any(ctx, owner, &rel, bin, &Guard { keep: g.keep, folders_ok: false }) {
            Ok(ms) => {
                d.moved += 1;
                rec.moves.extend(ms.into_iter().enumerate().map(|(i, m)| Moved { kind: if i == 0 { Kind::Trash } else { Kind::Extra }, ..m }));
                save(ctx.data, &rec)?;
            }
            Err(e) => d.errors.push(e),
        }
    }
    Ok(d)
}

// ── 되돌리기 ──

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn save(data: &Path, r: &Record) -> Result<(), String> {
    let at = data.join(LAST);
    if r.moves.is_empty() {
        let _ = std::fs::remove_file(&at);
        return Ok(());
    }
    let part = data.join(format!("{LAST}{}", locker_fs::PART));
    std::fs::write(&part, serde_json::to_string(r).map_err(|e| e.to_string())?).map_err(es)?;
    std::fs::rename(&part, &at).map_err(es)
}

fn load(data: &Path) -> Option<Record> {
    let r: Record = serde_json::from_str(&std::fs::read_to_string(data.join(LAST)).ok()?).ok()?;
    (!r.moves.is_empty()).then_some(r)
}

/// 마지막 묶음 — 휴지통으로 간 수·때. 없으면 None
pub fn last(data: &Path) -> Option<Last> {
    load(data).map(|r| Last { count: r.moves.iter().filter(|m| m.kind == Kind::Trash).count(), at: r.at }).filter(|l| l.count > 0)
}

/// 마지막 묶음을 원래 자리로 — 거꾸로(폴더를 먼저 살리고 꺼낸 것을 그 안으로). 원래 자리에 뭔가 있거나 휴지통에 없으면 덮어쓰지 않고 남긴다
pub fn undo_last(data: &Path) -> Result<Undone, String> {
    let r = load(data).ok_or("되돌릴 휴지통 묶음이 없어")?;
    let mut left = Vec::new();
    let mut u = Undone { restored: 0, errors: Vec::new() };
    for m in r.moves.iter().rev() {
        let back = exists_any(&m.to) && !exists_any(&m.from) && m.from.parent().is_some_and(|p| p.is_dir());
        if back && std::fs::rename(&m.to, &m.from).is_ok() {
            if m.kind == Kind::Trash {
                u.restored += 1;
            }
            continue;
        }
        if m.kind != Kind::Extra {
            let name = m.from.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            u.errors.push(if exists_any(&m.from) { format!("원래 자리에 이미 있어: {name}") } else { format!("휴지통에 없어: {name}") });
        }
        left.push(m.clone());
    }
    left.reverse();
    save(data, &Record { at: r.at, moves: left.into_iter().filter(|m| m.kind != Kind::Extra || exists_any(&m.to)).collect() })?;
    Ok(u)
}

// ── 앱 명령 ──

/// 지금 돌고 있는 세션 작업 폴더(claude agents --json 의 cwd) — 못 읽으면 None(그땐 안에 든 것이 있는 폴더는 안 지운다)
fn session_dirs() -> Option<Vec<PathBuf>> {
    let j = crate::claude::agents_json().ok()?;
    let v: serde_json::Value = serde_json::from_str(&j).ok()?;
    Some(v.as_array()?.iter().filter_map(|a| a["cwd"].as_str()).filter(|c| !c.trim().is_empty()).map(PathBuf::from).collect())
}

fn bin_of(a: &locker_fs::AppCtx) -> Result<PathBuf, String> {
    let bin = a.home.join(".Trash");
    std::fs::create_dir_all(&bin).map_err(es)?;
    Ok(bin)
}

const NO_SESSIONS: &str = "세션 목록을 못 읽어서 폴더는 안 지웠어 — 잠깐 뒤 다시";

/// 세션 목록(claude agents)을 읽을 수 있어 화면 줄(메인 스레드)을 막지 않게 따로
async fn off_main<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// 휴지통으로(맥 휴지통 — 되살릴 수 있다). 연결 폴더 안쪽도 이 길만은 열린다. 안에 든 것이 있는 폴더는 묶음 확인(locker_trash_many)으로
#[tauri::command]
pub async fn locker_trash(id: String, name: String, rel: String) -> Result<Done, String> {
    off_main(move || trash_many_now(id, name, vec![rel], false)).await
}

/// 고른 묶음 — folders_ok = 화면이 '폴더 n개 포함(안에 k개)'을 따로 확인받았다
#[tauri::command]
pub async fn locker_trash_many(id: String, name: String, rels: Vec<String>, folders_ok: bool) -> Result<Done, String> {
    off_main(move || trash_many_now(id, name, rels, folders_ok)).await
}

fn trash_many_now(id: String, name: String, rels: Vec<String>, folders_ok: bool) -> Result<Done, String> {
    let a = locker_fs::app_ctx();
    let owner = locker_fs::owner_dir(&a.root, &id, &name)?;
    let keep = session_dirs();
    if folders_ok && keep.is_none() {
        return Err(NO_SESSIONS.into());
    }
    let keep = keep.unwrap_or_default();
    trash_batch(&a.ctx(), &owner, &rels, &bin_of(&a)?, &Guard { keep: &keep, folders_ok })
}

/// 안에 든 것은 꺼내고(to 없음 = 위 폴더) 또는 to 폴더로 옮기고 폴더만 휴지통으로
#[tauri::command]
pub async fn locker_trash_empty_out(id: String, name: String, rels: Vec<String>, to: Option<String>) -> Result<Done, String> {
    off_main(move || {
        let a = locker_fs::app_ctx();
        let owner = locker_fs::owner_dir(&a.root, &id, &name)?;
        let keep = session_dirs().ok_or(NO_SESSIONS)?;
        empty_out_batch(&a.ctx(), &owner, &rels, to.as_deref(), &bin_of(&a)?, &Guard { keep: &keep, folders_ok: false })
    })
    .await
}

/// 확인 문구 재료(보내지 않고 센다)
#[tauri::command]
pub async fn locker_trash_plan(id: String, name: String, rels: Vec<String>) -> Result<Plan, String> {
    off_main(move || {
        let a = locker_fs::app_ctx();
        let owner = locker_fs::owner_dir(&a.root, &id, &name)?;
        Ok(plan(&a.ctx(), &owner, &rels, &session_dirs().unwrap_or_default()))
    })
    .await
}

/// 마지막 휴지통 묶음 — 메뉴 '휴지통 되돌리기'가 뜰지
#[tauri::command]
pub fn locker_trash_last() -> Option<Last> {
    last(&locker_fs::app_ctx().data)
}

#[tauri::command]
pub fn locker_trash_undo() -> Result<Undone, String> {
    undo_last(&locker_fs::app_ctx().data)
}

#[cfg(test)]
#[path = "locker_trash_tests.rs"]
mod tests;
