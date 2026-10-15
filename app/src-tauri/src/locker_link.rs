//! 보관함 폴더 연결(2026-10-12 사용자 "스크린샷을 매번 파인더로 열어서 주는 게 귀찮다") — 맥 폴더를 보관함 안 바로가기 폴더로 잇는다.
//! 집은 그 맥 폴더 하나(복사 안 함), 보관함엔 심볼릭 링크만. 연결 목록은 참모 폴더의 숨김 표식 `.chammo-links`(가리키는 곳 한 줄씩) —
//! 표식에 없는 폴더 링크는 목록에서 따라가지 않는다. 안쪽 파일은 읽기 전용(기존 문지기 inside·sub_dir 가 보관함 밖 경로를 거절한다).
//! 연결 풀기는 링크만 지운다. 설계: docs/plans/locker-v4.md · home-modes.md(집은 하나, 나머지는 바로가기)
use crate::locker_fs::{self, canon, es, exists_any, plain_abs, Ctx, Entry, Owner};
use crate::locker_trash::{Guard, Moved};
use std::path::{Path, PathBuf};

/// 참모 폴더의 연결 표식 — 숨김이라 나무에 안 보인다
pub const LINKS: &str = ".chammo-links";
/// 스크린샷 자동 연결의 링크 이름 · 한 번만 했다는 표시(데이터 폴더)
pub const SHOTS_NAME: &str = "스크린샷";
pub const SHOTS_MARK: &str = "locker-shots.done";
/// 스크린샷 연결 표식(참모 폴더, 숨김) — 그 링크 이름. 이 연결은 스크린샷 파일만 보인다
pub const SHOTS_FILE: &str = ".chammo-shots";
/// 연결 폴더 하나에서 한꺼번에 보여 주는 줄 수·깊이 — 바탕화면 같은 큰 폴더가 나무를 덮지 않게
const LINK_CAP: usize = 500;
const LINK_DEPTH: usize = 3;

// ── 이름 ──

/// 맥 파일 이름은 한글을 풀어 쓴 모양(자모)이라 글자 비교·찾기가 어긋난다 — 한글 자모만 합쳐 쓴 모양으로(다른 글자는 그대로)
pub fn nfc(s: &str) -> String {
    const L: u32 = 0x1100;
    const V: u32 = 0x1161;
    const T: u32 = 0x11A7;
    let cs: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < cs.len() {
        let c = cs[i] as u32;
        if (L..=0x1112).contains(&c) && i + 1 < cs.len() && (V..=0x1175).contains(&(cs[i + 1] as u32)) {
            let (l, v) = (c - L, cs[i + 1] as u32 - V);
            let mut t = 0;
            let mut used = 2;
            if i + 2 < cs.len() && (T + 1..=0x11C2).contains(&(cs[i + 2] as u32)) {
                t = cs[i + 2] as u32 - T;
                used = 3;
            }
            out.push(char::from_u32(0xAC00 + (l * 21 + v) * 28 + t).unwrap_or(cs[i]));
            i += used;
        } else {
            out.push(cs[i]);
            i += 1;
        }
    }
    out
}

// ── 표식 ──

/// 이 참모 폴더가 폴더 연결로 인정한 가리키는 곳들(글자 그대로)
pub fn linked_targets(owner: &Path) -> Vec<String> {
    std::fs::read_to_string(owner.join(LINKS)).map(|t| t.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect()).unwrap_or_default()
}

fn save_targets(owner: &Path, v: &[String]) -> Result<(), String> {
    let at = owner.join(LINKS);
    let part = owner.join(format!("{LINKS}{}", locker_fs::PART));
    let mut seen = Vec::new();
    for t in v {
        if !seen.contains(t) {
            seen.push(t.clone());
        }
    }
    std::fs::write(&part, seen.join("\n") + if seen.is_empty() { "" } else { "\n" }).map_err(es)?;
    std::fs::rename(&part, &at).map_err(es)
}

/// 링크가 표식에 있는 연결 폴더인가 — 있으면 가리키는 곳 글자
fn connected_target(owner: &Path, at: &Path) -> Option<String> {
    if !std::fs::symlink_metadata(at).is_ok_and(|m| m.file_type().is_symlink()) {
        return None;
    }
    let t = std::fs::read_link(at).ok()?.to_string_lossy().into_owned();
    linked_targets(owner).contains(&t).then_some(t)
}

/// 이 참모 폴더 안 자리가 연결 폴더 링크인가(폰이 못 풀게 거를 때도 쓴다)
pub fn is_connected(owner: &Path, rel: &str) -> bool {
    locker_fs::inside(owner, rel).ok().and_then(|p| connected_target(owner, &p)).is_some()
}

// ── 안전 ──

/// 연결해도 되는 폴더인가 — 절대 경로·링크를 풀어도 홈 안 폴더(홈 자체 아님). 점 폴더(.ssh·.config…)·Library·앱 데이터·보관함은 거절.
/// 보관함 뿌리나 데이터 폴더를 품은 위쪽 폴더도 거절(보관함이 자기 자신을 비춘다)
pub fn check_folder(p: &Path, ctx: &Ctx) -> Result<PathBuf, String> {
    if !plain_abs(p) {
        return Err(format!("절대 경로만 연결할 수 있어: {}", p.display()));
    }
    let real = std::fs::canonicalize(p).map_err(|_| format!("없는 폴더: {}", p.display()))?;
    safe_real(ctx, &real)?;
    Ok(real)
}

/// 이미 풀어낸 진짜 경로 검사
fn safe_real(ctx: &Ctx, real: &Path) -> Result<(), String> {
    safe_home_dir(ctx.home, real)?;
    let (data, root) = (canon(ctx.data), canon(ctx.root));
    if real.starts_with(&data) || data.starts_with(real) || real.starts_with(&root) || root.starts_with(real) {
        return Err(format!("앱 데이터·보관함은 못 연결해: {}", real.display()));
    }
    Ok(())
}

/// 홈 안 폴더(홈 자체 아님)이고 점 폴더·Library 가 아닌가 — 목록이 연결을 따라가기 전에도 다시 본다
pub(crate) fn safe_home_dir(home: &Path, real: &Path) -> Result<(), String> {
    let home = canon(home);
    if !real.starts_with(&home) || real == home {
        return Err(format!("홈 폴더 밖이거나 홈 자체는 못 연결해: {}", real.display()));
    }
    if !real.is_dir() {
        return Err(format!("폴더만 연결해: {}", real.display()));
    }
    let rel = real.strip_prefix(&home).unwrap_or(real);
    let mut parts = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned());
    if parts.next().as_deref() == Some("Library") || rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.')) {
        return Err(format!("민감한 폴더라 못 연결해(점 폴더·Library): {}", real.display()));
    }
    Ok(())
}

// ── 만들기·풀기·다시 찾기 ──

#[cfg(unix)]
fn link_dir(target: &Path, at: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(target, at).map_err(es)
}
#[cfg(windows)]
fn link_dir(target: &Path, at: &Path) -> Result<(), String> {
    std::os::windows::fs::symlink_dir(target, at).map_err(|e| format!("폴더 바로가기를 못 만들었어(윈도우 개발자 모드 필요): {e}"))
}

/// 맥 폴더 연결 — rel 폴더(빈 글 = 보관함 맨 위) 안에 바로가기 폴더를 만든다. 이미 같은 곳을 이은 게 있으면 그걸 돌려준다. 이름은 name > 폴더 이름(한글은 합쳐 쓴 모양), 겹치면 번호
pub fn connect(ctx: &Ctx, owner: &Path, rel: &str, src: &Path, name: Option<&str>) -> Result<PathBuf, String> {
    let real = check_folder(src, ctx)?;
    let dir = locker_fs::sub_dir(owner, rel)?;
    let key = real.to_string_lossy().into_owned();
    if let Some(e) = locker_fs::tree(owner).into_iter().find(|e| e.linked && e.link.as_deref() == Some(key.as_str())) {
        return Ok(owner.join(e.rel));
    }
    let base = name.map(str::to_string).unwrap_or_else(|| real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    let at = locker_fs::unique(&dir, &nfc(&locker_fs::safe_name(&base, "폴더")), false);
    // 기록을 먼저 — 링크를 만든 뒤 기록하다 멈추면 표식 없는 링크가 남아 안 열린다
    let mut v = linked_targets(owner);
    v.push(key);
    save_targets(owner, &v)?;
    link_dir(&real, &at)?;
    Ok(at)
}

/// 연결 풀기 — 링크만 지운다(원본 폴더·파일은 안 건드림). 연결이 아닌 것(진짜 폴더·파일 별칭)은 거절
pub fn disconnect(owner: &Path, rel: &str) -> Result<(), String> {
    let at = locker_fs::inside(owner, rel)?;
    let target = connected_target(owner, &at).ok_or_else(|| format!("연결 폴더가 아니야: {rel}"))?;
    #[cfg(unix)]
    std::fs::remove_file(&at).map_err(es)?;
    #[cfg(windows)]
    std::fs::remove_dir(&at).map_err(es)?;
    prune(owner, &target)
}

/// 아무 링크도 그 곳을 안 가리키면 표식에서 뺀다
fn prune(owner: &Path, target: &str) -> Result<(), String> {
    if locker_fs::tree(owner).iter().any(|e| e.linked && e.link.as_deref() == Some(target)) {
        return Ok(());
    }
    let v: Vec<String> = linked_targets(owner).into_iter().filter(|t| t != target).collect();
    save_targets(owner, &v)
}

/// 끊긴(또는 옮긴) 연결 폴더를 새 폴더로 — 새 링크를 옆에 만든 뒤 한 번에 바꿔 끼운다
pub fn reconnect(ctx: &Ctx, owner: &Path, rel: &str, src: &Path) -> Result<(), String> {
    let at = locker_fs::inside(owner, rel)?;
    let old = connected_target(owner, &at).ok_or_else(|| format!("연결 폴더가 아니야: {rel}"))?;
    let real = check_folder(src, ctx)?;
    let mut v = linked_targets(owner);
    v.push(real.to_string_lossy().into_owned());
    save_targets(owner, &v)?;
    let name = at.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = at.with_file_name(format!(".{name}{}", locker_fs::PART));
    let _ = std::fs::remove_file(&tmp);
    link_dir(&real, &tmp)?;
    std::fs::rename(&tmp, &at).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })?;
    prune(owner, &old)
}

/// 폰에 안 보이는 넓은 연결인가 — 홈 바로 아래 바탕화면·다운로드·문서 폴더 자체를 이으면 그 안의 모든 파일이 비친다(스크린샷 폴더 설정이 없을 때 자동 연결이 바탕화면으로 떨어진다).
/// 맥 화면엔 보여도 폰 허용 목록·보관함 목록엔 안 넣는다 — 폰이 읽는 건 사람이 고른 좁은 폴더만
pub fn broad_target(home: &Path, target: &Path) -> bool {
    let h = canon(home);
    let t = canon(target);
    ["Desktop", "Downloads", "Documents"].iter().any(|d| t == h.join(d) || t == canon(&home.join(d)))
}

/// 스크린샷 연결인가 — 참모 폴더 맨 위 링크이고, 표식(.chammo-shots)에 그 이름이 있거나 고침 전 자동 연결(이름 '스크린샷' + 바탕화면).
/// 사람이 고른 폴더는 이름이 '스크린샷'이어도 아니다
pub(crate) fn shots_link(owner: &Path, at: &Path, target: &str) -> bool {
    if at.parent() != Some(owner) {
        return false;
    }
    let name = nfc(&at.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    let marked = std::fs::read_to_string(owner.join(SHOTS_FILE)).is_ok_and(|t| t.lines().any(|l| nfc(l.trim()) == name));
    marked || (name == SHOTS_NAME && Path::new(target).file_name().is_some_and(|n| n == "Desktop"))
}

fn mark_shots(owner: &Path, name: &str) -> Result<(), String> {
    std::fs::write(owner.join(SHOTS_FILE), format!("{name}\n")).map_err(es)
}

/// 읽기만 하는 길(파인더로 보기·iCloud 내려받기)이 열어도 되는 경로 — 보관함 안에서 시작해 링크를 지나 홈 안 안전한 폴더 안에 닿은 것.
/// 고치는 길은 이걸 쓰지 않는다(안쪽은 늘 읽기 전용)
pub fn read_path_ok(ctx: &Ctx, p: &Path) -> bool {
    if !plain_abs(p) || !p.starts_with(ctx.root) {
        return false;
    }
    let Ok(real) = std::fs::canonicalize(p) else { return false };
    real.parent().is_some_and(|d| safe_home_dir(ctx.home, d).is_ok()) && !real.starts_with(canon(ctx.data))
}

// ── 연결 폴더 안 휴지통(2026-10-12 사용자 "스크린샷 골라서 지우려는데 못 지운다") ──
// 안쪽은 여전히 읽기 전용(이름 바꾸기·옮기기·덮어쓰기·넣기 거절) — 맥 휴지통으로 보내기만 연다(되살릴 수 있다). 폰엔 이 길이 없다

/// rel 을 조각으로 — 빈 조각·점 조각·역슬래시는 None(앞뒤 / 도 안 받는다)
fn parts_of(rel: &str) -> Option<Vec<&str>> {
    let v: Vec<&str> = rel.split('/').collect();
    (!rel.is_empty() && v.iter().all(|s| !s.trim().is_empty() && !s.starts_with('.') && !s.contains('\\'))).then_some(v)
}

/// rel 앞쪽에서 연결 폴더 링크를 찾는다 — (링크 자리, 링크 아래 조각 수). 링크 자체(아래 조각 0)는 None
fn connection_of(owner: &Path, rel: &str) -> Option<(PathBuf, usize)> {
    let v = parts_of(rel)?;
    (1..v.len()).find_map(|k| {
        let at = locker_fs::inside(owner, &v[..k].join("/")).ok()?;
        connected_target(owner, &at).map(|_| (at, v.len() - k))
    })
}

/// 연결 폴더 안쪽 자리인가(연결 자체는 아니다)
pub fn in_connection(owner: &Path, rel: &str) -> bool {
    connection_of(owner, rel).is_some()
}

/// 연결 폴더 안 파일·폴더를 맥 휴지통으로 — 보내기 직전에 경로를 처음부터 다시 본다: 링크가 아직 표식에 있고 홈 안 안전한 폴더를 가리키나,
/// 링크 아래 조각마다 링크가 아닌가(안쪽 링크는 밖으로 샌다), 진짜 경로가 그 폴더 안이고 앱 데이터·보관함이 아닌가
pub fn trash_linked(ctx: &Ctx, owner: &Path, rel: &str, bin: &Path, g: &Guard) -> Result<Moved, String> {
    let p = linked_checked(ctx, owner, rel, g)?;
    let is_dir = p.is_dir();
    let name = p.file_name().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default();
    let to = locker_fs::unique(bin, &name, !is_dir);
    std::fs::rename(&p, &to).map_err(es)?;
    Ok(Moved { from: p, to, kind: Default::default() })
}

/// 연결 폴더 안 rel 의 진짜 경로 — 휴지통으로 보내도 되는지 끝까지 본 뒤(화면을 믿지 않는다)
fn linked_checked(ctx: &Ctx, owner: &Path, rel: &str, g: &Guard) -> Result<PathBuf, String> {
    let (at, n) = connection_of(owner, rel).ok_or_else(|| format!("연결 폴더 안이 아니야: {rel}"))?;
    let base = std::fs::canonicalize(&at).map_err(|_| format!("원본 폴더가 없어: {rel}"))?;
    safe_real(ctx, &base)?;
    let v = parts_of(rel).unwrap_or_default();
    let mut p = base.clone();
    for s in &v[v.len() - n..] {
        p.push(s);
        let m = std::fs::symlink_metadata(&p).map_err(|_| format!("없는 것: {rel}"))?;
        if m.file_type().is_symlink() {
            return Err(format!("연결 폴더 안 바로가기는 못 지워: {rel}"));
        }
    }
    let parent = p.parent().unwrap_or(&base);
    if canon(&p) != p || !p.starts_with(&base) || safe_home_dir(ctx.home, parent).is_err() || p.starts_with(canon(ctx.data)) || p.starts_with(canon(ctx.root)) {
        return Err(format!("못 지우는 자리: {rel}"));
    }
    // 스크린샷 연결은 맨 위 스크린샷 파일만 — 바탕화면을 가리켜도 폴더·다른 파일은 못 지운다
    let target = std::fs::read_link(&at).map(|t| t.to_string_lossy().into_owned()).unwrap_or_default();
    if shots_link(owner, &at, &target) && !(n == 1 && p.is_file() && is_shot_file(&p.file_name().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default())) {
        return Err(format!("스크린샷 연결에선 스크린샷 파일만 지울 수 있어: {rel}"));
    }
    crate::locker_trash::check(ctx, g, &p).map_err(|e| format!("{e}: {rel}"))?;
    Ok(p)
}

/// 화면 휴지통 — 연결 폴더 안쪽이면 위 길, 연결 자체는 '연결 풀기'로 돌려보내고, 나머지는 보관함 휴지통 길(locker_fs::remove) 그대로
pub fn trash_any(ctx: &Ctx, owner: &Path, rel: &str, bin: &Path, g: &Guard) -> Result<Vec<Moved>, String> {
    if is_connected(owner, rel) {
        return Err(format!("연결 폴더는 휴지통 말고 '연결 풀기'로: {rel}"));
    }
    if in_connection(owner, rel) {
        return trash_linked(ctx, owner, rel, bin, g).map(|m| vec![m]);
    }
    checked(ctx, owner, rel, g)?;
    locker_fs::remove(owner, rel, bin)
}

/// 휴지통으로 보내도 되는 자리인가(보내지는 않는다) — 진짜 경로. 보관함 바로가기는 바로가기 자리 그대로(가리키는 곳은 안 건드린다)
pub fn checked(ctx: &Ctx, owner: &Path, rel: &str, g: &Guard) -> Result<PathBuf, String> {
    if is_connected(owner, rel) {
        return Err(format!("연결 폴더는 휴지통 말고 '연결 풀기'로: {rel}"));
    }
    if in_connection(owner, rel) {
        return linked_checked(ctx, owner, rel, g);
    }
    let p = locker_fs::inside(owner, rel)?;
    let m = std::fs::symlink_metadata(&p).map_err(|_| format!("없는 것: {rel}"))?;
    if !m.file_type().is_symlink() {
        crate::locker_trash::check(ctx, g, &p).map_err(|e| format!("{e}: {rel}"))?;
    }
    Ok(p)
}

// ── 목록(locker_fs::walk 가 부른다) ──

/// 연결 폴더 한 줄 + 안쪽 — 안쪽은 최신이 맨 앞(폴더 먼저), 점 파일·안쪽 링크는 뺀다. home 이 있으면 지금 가리키는 곳이 아직 안전한지 다시 본다
pub(crate) fn push_linked(owner: &Path, at: &Path, target: String, home: Option<&Path>, out: &mut Vec<Entry>) {
    let md = std::fs::metadata(at).ok();
    let live = md.as_ref().is_some_and(|m| m.is_dir()) && home.is_none_or(|h| safe_home_dir(h, &canon(at)).is_ok());
    let shots = shots_link(owner, at, &target);
    out.push(Entry {
        rel: locker_fs::rel_of(owner, at),
        name: at.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        dir: true,
        link: Some(target),
        gone: !live,
        size: None,
        mtime: md.as_ref().and_then(|m| m.modified().ok()).and_then(locker_fs::ms),
        vers: 0,
        linked: true,
        ro: false,
    });
    if live {
        let mut budget = LINK_CAP;
        if shots {
            shots_only(owner, at, &mut budget, out);
        } else {
            walk_ro(owner, at, 0, &mut budget, out);
        }
    }
}

/// 스크린샷 연결 안쪽 — 맨 위 스크린샷·화면 기록 파일만(최신 먼저). 폴더·다른 파일은 목록에 없다 → ⌘A 로도 못 고른다
fn shots_only(owner: &Path, dir: &Path, budget: &mut usize, out: &mut Vec<Entry>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut items: Vec<(String, PathBuf, Option<u64>, u64)> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let lm = std::fs::symlink_metadata(e.path()).ok()?;
            (lm.is_file() && is_shot_file(&name)).then(|| (name, e.path(), lm.modified().ok().and_then(locker_fs::ms), lm.len()))
        })
        .collect();
    items.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    for (name, p, mtime, size) in items.into_iter().take(*budget) {
        *budget -= 1;
        out.push(Entry { rel: locker_fs::rel_of(owner, &p), name, dir: false, link: None, gone: false, size: Some(size), mtime, vers: 0, linked: false, ro: true });
    }
}

fn walk_ro(owner: &Path, dir: &Path, depth: usize, budget: &mut usize, out: &mut Vec<Entry>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut items: Vec<(bool, String, PathBuf, Option<u64>, Option<u64>)> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            let lm = std::fs::symlink_metadata(e.path()).ok()?;
            if lm.file_type().is_symlink() {
                return None; // 안쪽 링크는 밖으로 샐 수 있어 안 보인다
            }
            Some((lm.is_dir(), name, e.path(), lm.modified().ok().and_then(locker_fs::ms), lm.is_file().then(|| lm.len())))
        })
        .collect();
    items.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.3.cmp(&a.3)).then_with(|| a.1.cmp(&b.1)));
    let mut dirs = Vec::new();
    for (is_dir, name, p, mtime, size) in items {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        out.push(Entry { rel: locker_fs::rel_of(owner, &p), name, dir: is_dir, link: None, gone: false, size, mtime, vers: 0, linked: false, ro: true });
        if is_dir {
            dirs.push(p);
        }
    }
    if depth + 1 < LINK_DEPTH {
        for d in dirs {
            walk_ro(owner, &d, depth + 1, budget, out);
        }
    }
}

// ── 스크린샷 ──

/// 맥 스크린샷 저장 위치 설정(defaults) — 없거나 못 읽으면 None
pub fn configured_location() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let o = crate::platform::command("defaults").args(["read", "com.apple.screencapture", "location"]).output().ok()?;
        let t = String::from_utf8_lossy(&o.stdout).trim().to_string();
        (o.status.success() && !t.is_empty()).then_some(t)
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// 설정을 1분 동안 기억 — 보관함 나무를 2초마다 읽을 때마다 defaults 를 띄우지 않게
pub fn configured_cached() -> Option<String> {
    use std::sync::Mutex;
    static C: Mutex<Option<(std::time::Instant, Option<String>)>> = Mutex::new(None);
    let mut c = C.lock().ok()?;
    if let Some((t, v)) = c.as_ref() {
        if t.elapsed() < std::time::Duration::from_secs(60) {
            return v.clone();
        }
    }
    let v = configured_location();
    *c = Some((std::time::Instant::now(), v.clone()));
    v
}

/// 스크린샷이 쌓이는 폴더 — 이 기계 기준(shot_dir_on). 없으면 None
pub fn shot_dir(home: &Path, configured: Option<&str>) -> Option<PathBuf> {
    shot_dir_on(home, configured, cfg!(windows))
}

/// 맥 = 설정(~ 는 홈)이 가리키는 폴더가 있으면 그것, 아니면 ~/Desktop.
/// 윈도우 = 사진\스크린샷(Win+PrtScn 기본 자리, OneDrive 로 옮겨진 사진도) — 없으면 None. 바탕화면은 윈도우 스크린샷 자리가 아니다(0.3.0 2차 검증)
pub fn shot_dir_on(home: &Path, configured: Option<&str>, windows: bool) -> Option<PathBuf> {
    if windows {
        return ["Pictures/Screenshots", "OneDrive/Pictures/Screenshots"].iter().map(|r| home.join(r)).find(|p| p.is_dir());
    }
    let desk = home.join("Desktop");
    let Some(c) = configured.map(str::trim).filter(|c| !c.is_empty()) else { return Some(desk) };
    let p = match c.strip_prefix("~/") {
        Some(r) => home.join(r),
        None if c == "~" => home.to_path_buf(),
        None => PathBuf::from(c),
    };
    // 설정(풀어 쓴 한글)과 폴더 이름(합쳐 쓴 한글)이 달라도 맥 APFS 는 같은 폴더로 찾는다(시험 shot_dir_matches_nfc_and_nfd_folder_names)
    Some(if p.is_dir() { p } else { desk })
}

/// 첫 실행 때 한 번 — 스크린샷 폴더를 첫 참모 보관함 맨 위에 '스크린샷' 연결 폴더로. 참모가 아직 없으면 기다리고(표식 안 함),
/// 한 번 시도하면 표식(성공이든 거절이든) — 사람이 풀면 다시 안 붙는다. 이번에 붙였나
pub fn auto_connect_shots(ctx: &Ctx, first: Option<&Owner>, configured: Option<&str>) -> Result<bool, String> {
    connect_shots_at(ctx, first, shot_dir(ctx.home, configured))
}

/// 스크린샷 폴더가 없으면(윈도우에서 아직 한 장도 안 찍음) 아무것도 안 하고 표식도 안 남긴다 — 생기면 다음에 잇는다
pub fn connect_shots_at(ctx: &Ctx, first: Option<&Owner>, dir: Option<PathBuf>) -> Result<bool, String> {
    let mark = ctx.data.join(SHOTS_MARK);
    if mark.exists() {
        return Ok(false);
    }
    let (Some(o), Some(dir)) = (first, dir) else { return Ok(false) };
    let owner = locker_fs::owner_dir(ctx.root, &o.id, &o.name)?;
    std::fs::write(&mark, "1").map_err(es)?; // 기록을 먼저
    let at = connect(ctx, &owner, "", &dir, Some(SHOTS_NAME))?;
    mark_shots(&owner, &at.file_name().map(|n| nfc(&n.to_string_lossy())).unwrap_or_default())?;
    Ok(true)
}

/// 최근 스크린샷 한 장
#[derive(Debug, Clone, serde::Serialize)]
pub struct Shot {
    pub path: String,
    pub name: String,
    pub mtime: Option<u64>,
}

const IMG_EXT: [&str; 6] = ["png", "jpg", "jpeg", "heic", "gif", "webp"];

/// 맥이 붙이는 스크린샷 이름 머리(바탕화면에 섞일 때 걸러 낸다)
fn is_shot_name(name: &str) -> bool {
    ["스크린샷", "Screenshot", "Screen Shot", "화면 기록", "Screen Recording"].iter().any(|p| name.starts_with(p))
}

/// 맥 스크린샷·화면 기록 파일 이름인가 — 이름 머리(풀어 쓴 한글도) + 그림·PDF·영상 확장자. 숨은 파일은 아니다
pub fn is_shot_file(name: &str) -> bool {
    const EXT: [&str; 11] = ["png", "jpg", "jpeg", "heic", "gif", "webp", "tiff", "tif", "pdf", "mov", "mp4"];
    let n = nfc(name);
    let ext = Path::new(&n).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    !n.starts_with('.') && is_shot_name(&n) && EXT.contains(&ext.as_str())
}

/// 폴더의 최신 그림 n장(입력칸 # 고르기·채팅 첨부 단추 맨 위에 띄울 목록) — 안전한 홈 안 폴더만. 바탕화면이면 스크린샷 이름만
pub fn recent_shots(ctx: &Ctx, dir: &Path, n: usize) -> Vec<Shot> {
    let Ok(real) = check_folder(dir, ctx) else { return Vec::new() };
    let Ok(rd) = std::fs::read_dir(&real) else { return Vec::new() };
    let desk = real == canon(&ctx.home.join("Desktop"));
    let mut v: Vec<Shot> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let lm = std::fs::symlink_metadata(e.path()).ok()?;
            let ext = Path::new(&name).extension()?.to_string_lossy().to_ascii_lowercase();
            let shown = nfc(&name);
            (!name.starts_with('.') && lm.is_file() && IMG_EXT.contains(&ext.as_str()) && (!desk || is_shot_name(&shown)))
                .then(|| Shot { path: e.path().to_string_lossy().into_owned(), name: shown, mtime: lm.modified().ok().and_then(locker_fs::ms) })
        })
        .collect();
    v.sort_by(|a, b| b.mtime.cmp(&a.mtime).then_with(|| a.name.cmp(&b.name)));
    v.truncate(n);
    v
}

/// 스크린샷 연결을 지금 스크린샷 폴더로 — 옮겨 붙였나
/// (설정 폴더가 나중에 생기면 바탕화면에서 그 폴더로, 없어지면 바탕화면으로). 스크린샷 연결이 없거나 이미 맞으면 false
pub fn follow_shots(ctx: &Ctx, owner: &Path, configured: Option<&str>) -> Result<bool, String> {
    let Ok(rd) = std::fs::read_dir(owner) else { return Ok(false) };
    let Some((at, now)) = rd.flatten().map(|e| e.path()).find_map(|at| connected_target(owner, &at).filter(|t| shots_link(owner, &at, t)).map(|t| (at, t))) else {
        return Ok(false);
    };
    let Some(want) = shot_dir(ctx.home, configured) else { return Ok(false) };
    let want = canon(&want);
    if canon(Path::new(&now)) == want {
        return Ok(false);
    }
    let name = at.file_name().map(|n| nfc(&n.to_string_lossy())).unwrap_or_default();
    mark_shots(owner, &name)?; // 기록을 먼저 — 바탕화면이 아닌 곳으로 옮겨 붙어도 스크린샷 연결로 남는다
    reconnect(ctx, owner, &locker_fs::rel_of(owner, &at), &want)?;
    Ok(true)
}

// ── 앱 명령 ──

/// 맥 폴더 연결 — 고른 경로로. folder = 보관함 안 자리(빈 글 = 맨 위). 만든 링크 경로
#[tauri::command]
pub fn locker_connect(id: String, name: String, folder: Option<String>, path: String) -> Result<String, String> {
    let a = locker_fs::app_ctx();
    let owner = locker_fs::owner_dir(&a.root, &id, &name)?;
    connect(&a.ctx(), &owner, folder.as_deref().unwrap_or(""), Path::new(&path), None).map(|p| p.to_string_lossy().into_owned())
}

/// '맥 폴더 연결…' — 앱 맥 파일 창(폴더 고르기)으로 골라 잇는다. 취소면 None
#[tauri::command]
pub async fn locker_connect_choose(app: tauri::AppHandle, id: String, name: String, folder: Option<String>) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || crate::agent_browser::choose_dir(&app, crate::i18n::tr("보관함에 연결할 폴더", "Folder to link into the locker")))
        .await
        .map_err(|e| e.to_string())??;
    let Some(p) = picked.into_iter().next() else { return Ok(None) };
    locker_connect(id, name, folder, p).map(Some)
}

/// 연결 풀기 — 링크만
#[tauri::command]
pub fn locker_disconnect(id: String, name: String, rel: String) -> Result<(), String> {
    let a = locker_fs::app_ctx();
    disconnect(&locker_fs::owner_dir(&a.root, &id, &name)?, &rel)
}

/// 끊긴 연결 폴더를 파일 창으로 새로 골라 다시 잇는다. 취소면 false
#[tauri::command]
pub async fn locker_reconnect_choose(app: tauri::AppHandle, id: String, name: String, rel: String) -> Result<bool, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || crate::agent_browser::choose_dir(&app, crate::i18n::tr("다시 연결할 폴더", "Folder to relink")))
        .await
        .map_err(|e| e.to_string())??;
    let Some(p) = picked.into_iter().next() else { return Ok(false) };
    let a = locker_fs::app_ctx();
    reconnect(&a.ctx(), &locker_fs::owner_dir(&a.root, &id, &name)?, &rel, Path::new(&p)).map(|_| true)
}

/// 최근 스크린샷 n장 — 맥 스크린샷 저장 위치(없으면 바탕화면)의 최신 그림
#[tauri::command]
pub fn locker_recent_shots(n: usize) -> Vec<Shot> {
    let a = locker_fs::app_ctx();
    shot_dir(&a.home, configured_location().as_deref()).map(|d| recent_shots(&a.ctx(), &d, n.min(50))).unwrap_or_default()
}

#[cfg(test)]
#[path = "locker_link_tests.rs"]
mod tests;
