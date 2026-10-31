//! 파일 보관함 v4 — 진짜 폴더(2026-10-11 사용자 "보이는 게 맞지"). 파일마다 집은 하나, 나머지는 바로가기(심볼릭 링크).
//! 뿌리 ~/Documents/Chammo/<참모>/ — 폴더 안 .chammo 에 참모 id(열쇠). 이름이 바뀌면 폴더 이름도 따라 바꾼다. 새 파일은 참모 폴더 맨 위(보관함 자체), 새 참모 폴더엔 '자료' 하나.
//! 넣기: 머무는 곳(다운로드·데스크톱·스크린샷·채팅 첨부)에서 온 건 복사해 보관함이 집, 자리 잡은 곳(dev 폴더·문서 등)·500MB 넘는 건 별칭.
//! 파일을 옮기는 길은 늘 복사 → 확인 → 지우기(중간에 실패하면 원본이 남는다). 옛 기록(locker.jsonl·locker/files)은 migrate 가 한 번만 옮긴다.
//! 설계: docs/design-drafts/file-locker/flow-path-v2.html, 계획 docs/plans/locker-v4.md
use std::path::{Component, Path, PathBuf};

/// 기본 자리 — 저절로 쌓이는 곳(받은편지함)
/// 옛 기본 자리 — 홈·모드 ④(사용자 10/11)부터 안 만든다. 새 파일은 참모 폴더 맨 위(보관함 자체)에, 옛 안 파일은 한 번 맨 위로(migrate_inbox)
pub const OLD_INBOX: &str = "받은 것";
/// 새 참모 폴더에 처음 한 번 깔아 두는 폴더 — 보통 폴더라 바꾸거나 지워도 다시 안 생긴다
pub const BASE_FOLDER: &str = "자료";
/// 옛 '받은 것'을 맨 위로 옮겼다는 표시(데이터 폴더) — 한 번만
pub const INBOX_MARK: &str = "locker-inbox.done";
/// 옛 '내 페이지'(<데이터>/pages)가 들어가는 첫 참모 보관함 폴더(홈·모드 ⑧) · 옮겼다는 표시
pub const PAGES_FOLDER: &str = "페이지";
pub const PAGES_MARK: &str = "locker-pages.done";
/// 원본과 같은 첫 판을 한 번 휴지통으로 옮겼다는 표시
pub const VERS_CLEAN_MARK: &str = "locker-vers-clean.done";
/// 참모 폴더의 열쇠 파일(첫 줄 = 참모 id)
pub const ID_FILE: &str = ".chammo";
/// 이전 판 보관 폴더(파일 옆)
pub const VERS: &str = ".판";
/// 복사 중 조각의 꼬리 — 숨김(앞 점) + 이 꼬리. 다 쓰고 크기를 확인한 뒤에 진짜 이름으로 바꾼다
pub const PART: &str = ".chammo-part";
/// 이보다 크면 어디서 왔든 별칭(영상 원본 등)
pub const BIG: u64 = 500 * 1024 * 1024;
/// 옛 기록을 옮긴 뒤 남기는 이름 / 옮김 끝 표시
pub const OLD_LOG: &str = "locker.v1.jsonl";
pub const DONE_MARK: &str = "locker-v2.done";
/// 보관함을 한 번 열었다 — 그 전엔 문서 폴더(~/Documents/Chammo)·스크린샷 폴더를 안 건드린다(맥 권한 창이 설명 없이 뜨지 않게, 0.3.0)
pub const OPENED_MARK: &str = "locker-opened.done";

/// 판단에 쓰는 자리들 — 시험은 가짜 홈으로 만든다
pub struct Ctx<'a> {
    pub home: &'a Path,
    pub data: &'a Path,
    pub root: &'a Path,
    /// 자리 잡은 곳(데스크톱 안이어도 별칭) — devRoot·프로젝트 뿌리
    pub settled: &'a [PathBuf],
}

pub(crate) fn es(e: std::io::Error) -> String {
    e.to_string()
}

/// 보관함 뿌리 — $CHAMMO_LOCKER_ROOT > 시험 데이터 폴더면 그 안(진짜 문서 폴더를 안 건드림) > ~/Documents/Chammo
pub fn root_of(home: &Path, data: &Path, env: Option<&str>, real_data: bool) -> PathBuf {
    if let Some(e) = env.map(str::trim).filter(|e| !e.is_empty()) {
        return PathBuf::from(e);
    }
    if !real_data {
        return data.join("Documents-Chammo");
    }
    home.join("Documents").join("Chammo")
}

/// 폴더·파일 이름으로 써도 되는 글 — 경로 글자(/ \ :)는 -, 제어 글자·앞 점은 뺀다. 비면 fallback
pub fn safe_name(name: &str, fallback: &str) -> String {
    let s: String = name.chars().filter(|c| !c.is_control()).map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c }).collect();
    let s: String = s.trim().trim_start_matches('.').trim().chars().take(120).collect();
    if s.is_empty() {
        fallback.to_string()
    } else {
        s
    }
}

/// 깨진 링크까지 '있음'
pub(crate) fn exists_any(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok()
}

/// 겹치지 않는 자리 — '이름 2.확장자', 3 … (폴더는 확장자를 안 가른다)
pub fn unique(dir: &Path, name: &str, split_ext: bool) -> PathBuf {
    let first = dir.join(name);
    if !exists_any(&first) {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if split_ext && !s.is_empty() && !e.is_empty() && e.len() <= 10 => (s, format!(".{e}")),
        _ => (name, String::new()),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} {n}{ext}")))
        .find(|p| !exists_any(p))
        .expect("끝없는 번호")
}

fn id_of(dir: &Path) -> Option<String> {
    let t = std::fs::read_to_string(dir.join(ID_FILE)).ok()?;
    t.lines().next().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// 참모 폴더 — .chammo 에 이 id 가 적힌 폴더를 찾고, 이름이 바뀌었으면 폴더 이름도 바꾼다(그 자리에 다른 폴더가 있으면 그대로).
/// 없으면 만들고 '자료' 하나(새로 만들 때만)
pub fn owner_dir(root: &Path, id: &str, name: &str) -> Result<PathBuf, String> {
    if id.trim().is_empty() || id.contains(['/', '\\']) || id.starts_with('.') {
        return Err(format!("참모 id 가 이상해: {id}"));
    }
    std::fs::create_dir_all(root).map_err(es)?;
    let want = safe_name(name, id);
    let found = std::fs::read_dir(root).map_err(es)?.flatten().map(|e| e.path()).find(|p| {
        std::fs::symlink_metadata(p).is_ok_and(|m| m.is_dir()) && !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) && id_of(p).as_deref() == Some(id)
    });
    let dir = match found {
        Some(d) => {
            let target = root.join(&want);
            if d.file_name().is_some_and(|n| n.to_string_lossy() != want) && !exists_any(&target) && std::fs::rename(&d, &target).is_ok() {
                target
            } else {
                d
            }
        }
        None => {
            let d = unique(root, &want, false);
            std::fs::create_dir(&d).map_err(es)?;
            std::fs::write(d.join(ID_FILE), format!("{id}\n")).map_err(es)?;
            std::fs::create_dir_all(d.join(BASE_FOLDER)).map_err(es)?;
            d
        }
    };
    Ok(dir)
}

/// 글자 그대로 정규형인 절대 경로인가(../ ./ // 없음 — components() 는 중간 ./ 를 접어 버린다)
pub(crate) fn plain_abs(p: &Path) -> bool {
    p.is_absolute() && !p.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) && p.as_os_str() == p.components().collect::<PathBuf>().as_os_str()
}

pub(crate) fn canon(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// 넣어도 되는 파일인가 — 절대 경로·링크를 풀어도 홈 안 보통 파일. 데이터 폴더 안은 채팅 첨부(attach/)만. 이미 보관함 안이면 '옮기기'
pub fn check_add(p: &Path, ctx: &Ctx) -> Result<PathBuf, String> {
    if !plain_abs(p) {
        return Err(format!("절대 경로만 넣을 수 있어: {}", p.display()));
    }
    let real = std::fs::canonicalize(p).map_err(|_| format!("없는 파일: {}", p.display()))?;
    let home = canon(ctx.home);
    if !real.starts_with(&home) || real == home {
        return Err(format!("홈 폴더 밖 파일은 못 넣어: {}", p.display()));
    }
    if !real.is_file() {
        return Err(format!("폴더는 못 넣어 — 파일만: {}", p.display()));
    }
    let data = canon(ctx.data);
    if real.starts_with(&data) && real.parent() != Some(data.join("attach").as_path()) {
        return Err(format!("앱 데이터 폴더 안 파일은 못 넣어: {}", p.display()));
    }
    if real.starts_with(canon(ctx.root)) {
        return Err(format!("이미 보관함 안이야 — 끌어서 옮겨: {}", p.display()));
    }
    Ok(real)
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Home {
    /// 보관함으로 복사 — 보관함이 집(원본은 그대로)
    Copy,
    /// 별칭만 — 집은 제자리
    Link,
}

/// 어디서 왔나로 정한다 — 사람은 고르지 않는다(flow-path v2 C1)
pub fn decide(real: &Path, len: u64, ctx: &Ctx) -> Home {
    if real.parent() == Some(canon(ctx.data).join("attach").as_path()) || real.parent() == Some(ctx.data.join("attach").as_path()) {
        return Home::Copy;
    }
    if len > BIG {
        return Home::Link;
    }
    if ctx.settled.iter().any(|s| real.starts_with(s) || real.starts_with(canon(s))) {
        return Home::Link;
    }
    let h = canon(ctx.home);
    let transient = ["Downloads", "Desktop", "Pictures/Screenshots"].iter().any(|d| real.starts_with(join_rel(&h, d)) || real.starts_with(join_rel(ctx.home, d)));
    if transient {
        Home::Copy
    } else {
        Home::Link
    }
}

/// 참모 폴더 안 하위 폴더 — '' 는 참모 폴더 맨 위(보관함 자체). 조각마다 빈 것·점으로 시작·..·\ 거절, 링크를 풀어도 참모 폴더 안이어야
pub fn sub_dir(owner: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim_matches('/');
    if rel.is_empty() {
        let link = std::fs::symlink_metadata(owner).is_ok_and(|m| m.file_type().is_symlink());
        if link || !owner.is_dir() {
            return Err(format!("보관함 폴더가 이상해(링크·없음): {}", owner.display()));
        }
        return Ok(owner.to_path_buf());
    }
    if rel.split('/').any(|s| s.trim().is_empty() || s.starts_with('.') || s.contains('\\')) {
        return Err(format!("이상한 폴더 이름: {rel}"));
    }
    let p = owner.join(rel);
    if !p.is_dir() {
        return Err(format!("없는 폴더: {rel}"));
    }
    if !canon(&p).starts_with(canon(owner)) {
        return Err(format!("보관함 밖을 가리키는 폴더: {rel}"));
    }
    Ok(p)
}

/// 이사하며 원본을 잠깐 치워 두는 이름 — copy_verified 조각(.<이름><PART>)과 달라야 한다. 같으면 윈도우에서 바로가기 대신 복사하는 길(link)이
/// 그 조각 자리를 비우며 치워 둔 원본을 지우고, give 가 되돌리며 놓인 사본·프로젝트 사본까지 지워 파일이 통째로 사라졌다(2026-10-21 리뷰)
fn held(file: &Path) -> PathBuf {
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    file.with_file_name(format!(".{name}.held{PART}"))
}

/// copy_verified 가 dest 옆에 쓰는 조각
fn part_of(dest: &Path) -> PathBuf {
    let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    dest.with_file_name(format!(".{name}{PART}"))
}

/// 복사 → 크기 확인 → 진짜 이름으로. 실패하면 조각을 치우고 원본은 그대로.
/// 조각은 새로 만들 때만 연다(create_new = O_EXCL — 그 자리에 심어 둔 링크를 따라가지 않는다), 놓을 땐 덮어쓰지 않는다(place_new)
pub fn copy_verified(src: &Path, dest: &Path) -> Result<(), String> {
    let part = part_of(dest);
    if std::fs::symlink_metadata(&part).is_ok() {
        std::fs::remove_file(&part).map_err(es)?;
    }
    let done = (|| -> Result<(), String> {
        let md = std::fs::metadata(src).map_err(es)?;
        let mut from = std::fs::File::open(src).map_err(es)?;
        let mut to = std::fs::OpenOptions::new().write(true).create_new(true).open(&part).map_err(es)?;
        std::io::copy(&mut from, &mut to).map_err(es)?;
        drop(to);
        let _ = std::fs::set_permissions(&part, md.permissions());
        let got = std::fs::metadata(&part).map_err(es)?.len();
        if got != md.len() {
            return Err(format!("복사한 크기가 달라({got} ≠ {}): {}", md.len(), src.display()));
        }
        place_new(&part, dest)
    })();
    if done.is_err() {
        let _ = std::fs::remove_file(&part);
    }
    done
}

/// 덮어쓰지 않고 놓기 — 하드 링크는 그 자리에 무엇이 있으면 실패한다(rename 은 덮어쓴다). 하드 링크가 안 되는 디스크면 확인 뒤 이름 바꾸기
fn place_new(part: &Path, dest: &Path) -> Result<(), String> {
    match std::fs::hard_link(part, dest) {
        Ok(()) => {
            let _ = std::fs::remove_file(part);
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(format!("그 자리에 이미 있어: {}", dest.display())),
        Err(_) => {
            if exists_any(dest) {
                return Err(format!("그 자리에 이미 있어: {}", dest.display()));
            }
            std::fs::rename(part, dest).map_err(es)
        }
    }
}

/// 두 파일 내용이 같은가(크기 + 바이트)
pub fn same_content(a: &Path, b: &Path) -> bool {
    use std::io::Read;
    let (Ok(ma), Ok(mb)) = (std::fs::metadata(a), std::fs::metadata(b)) else { return false };
    if !ma.is_file() || !mb.is_file() || ma.len() != mb.len() {
        return false;
    }
    let (Ok(mut fa), Ok(mut fb)) = (std::fs::File::open(a), std::fs::File::open(b)) else { return false };
    let (mut ba, mut bb) = (vec![0u8; 64 * 1024], vec![0u8; 64 * 1024]);
    loop {
        let (Ok(na), Ok(nb)) = (fa.read(&mut ba), fb.read(&mut bb)) else { return false };
        if na != nb || ba[..na] != bb[..nb] {
            return false;
        }
        if na == 0 {
            return true;
        }
    }
}

/// 별칭(심볼릭 링크) — 윈도우는 권한이 없으면 복사로 떨어진다(부채)
pub fn link(target: &Path, at: &Path) -> Result<bool, String> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, at).map_err(es)?;
        Ok(true)
    }
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_file(target, at).is_ok() {
            return Ok(true);
        }
        copy_verified(target, at).map(|_| false)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Added {
    pub path: PathBuf,
    pub link: bool,
}

/// 한 파일 넣기 — rel 폴더(빈 글 = 보관함 맨 위)에, 이름이 겹치면 번호. 복사면 첫 판도 남긴다
pub fn add(ctx: &Ctx, owner: &Path, rel: &str, src: &Path) -> Result<Added, String> {
    let real = check_add(src, ctx)?;
    let folder = sub_dir(owner, rel)?;
    let shown = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    // 채팅 첨부·폰 사진은 <밀리초>-<원래 이름> — 앞 숫자는 뗀다
    let shown = match shown.split_once('-') {
        Some((ms, rest)) if real.parent() == Some(canon(ctx.data).join("attach").as_path()) && !ms.is_empty() && ms.bytes().all(|b| b.is_ascii_digit()) && !rest.is_empty() => rest.to_string(),
        _ => shown,
    };
    let name = safe_name(&shown, "파일");
    let len = std::fs::metadata(&real).map_err(es)?.len();
    let dest = unique(&folder, &name, true);
    match decide(&real, len, ctx) {
        Home::Copy => {
            copy_verified(&real, &dest)?; // 들여올 땐 판을 안 남긴다 — 판은 고치기 직전에만(두 벌이 된다, 2026-10-11)
            Ok(Added { path: dest, link: false })
        }
        Home::Link => {
            let l = link(&real, &dest)?;
            Ok(Added { path: dest, link: l })
        }
    }
}

// ── 옛 기록 옮기기 ──

/// 옛 기록의 주인 열쇠(참모 이름) → 지금 참모 id·이름
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Owner {
    pub key: String,
    pub id: String,
    pub name: String,
}

#[derive(Debug, Default, serde::Serialize)]
pub struct Migrated {
    pub moved: usize,
    /// 옛 '받은 것'에서 맨 위로 옮긴 수(migrate_inbox)
    pub inbox: usize,
    /// 옛 '내 페이지'에서 보관함 '페이지'로 옮긴 수(migrate_pages)
    pub pages: usize,
    /// 스크린샷 폴더를 보관함에 '스크린샷' 연결 폴더로 처음 붙였나(locker_link::auto_connect_shots, 한 번만)
    pub shots: bool,
    pub gone: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

/// 같은 이름·같은 크기가 이미 그 자리에 있나(앞선 시도가 놓고 멈춘 것) — 링크면 같은 곳을 가리키나
fn already_there(dest: &Path, real: &Path) -> bool {
    match std::fs::read_link(dest) {
        Ok(t) => t == real,
        Err(_) => std::fs::symlink_metadata(dest).is_ok_and(|m| m.is_file()) && same_content(dest, real),
    }
}

/// 옛 보관함(locker.jsonl 이름표 + <데이터>/locker/files 복사본)을 진짜 폴더로 한 번만 옮긴다.
/// 복사본은 복사 → 확인 → 지우기, 맥 파일은 넣기 규칙대로(머무는 곳이면 복사·아니면 별칭), 원본이 없으면 센다.
/// 끝나면 옛 기록을 locker.v1.jsonl 로 남기고 표시 파일을 둔다 — 중간에 멈추면 다음에 이어서(이미 놓인 건 건너뜀)
pub fn migrate(ctx: &Ctx, owners: &[Owner]) -> Result<Migrated, String> {
    let mark = ctx.data.join(DONE_MARK);
    let mut r = Migrated::default();
    if mark.exists() {
        return Ok(r);
    }
    let logp = ctx.data.join("locker.jsonl");
    let log = std::fs::read_to_string(&logp).unwrap_or_default();
    let s = crate::locker::fold(&log);
    let dir_of = |key: &str| -> Result<PathBuf, String> {
        match owners.iter().find(|o| o.key == key || o.id == key) {
            Some(o) => owner_dir(ctx.root, &o.id, &o.name),
            None => owner_dir(ctx.root, &format!("old-{}", safe_name(key, "x").replace(' ', "-")), key),
        }
    };
    for (key, name) in &s.folders {
        let d = dir_of(key)?;
        std::fs::create_dir_all(d.join(safe_name(name, "폴더"))).map_err(es)?;
    }
    let data_c = canon(ctx.data);
    for it in &s.items {
        let d = dir_of(&it.owner)?;
        let folder = match &it.folder {
            Some(f) => d.join(safe_name(f, "폴더")),
            None => d.clone(),
        };
        std::fs::create_dir_all(&folder).map_err(es)?;
        let src = Path::new(&it.path);
        let base = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let old_copy = it.copy && crate::locker::is_locker_copy(src, &data_c);
        let base = if old_copy { base.split_once('-').map(|(_, b)| b.to_string()).unwrap_or(base) } else { base };
        let name = safe_name(it.name.as_deref().unwrap_or(&base), "파일");
        if old_copy {
            if !src.is_file() {
                r.gone += 1;
                continue;
            }
            let at = folder.join(&name);
            if !already_there(&at, src) {
                copy_verified(src, &unique(&folder, &name, true))?;
            }
            std::fs::remove_file(src).map_err(es)?;
            r.moved += 1;
            continue;
        }
        let real = match check_add(src, ctx) {
            Ok(p) => p,
            Err(e) => {
                if exists_any(src) {
                    r.skipped += 1;
                    r.errors.push(e);
                } else {
                    r.gone += 1;
                }
                continue;
            }
        };
        if already_there(&folder.join(&name), &real) {
            r.moved += 1;
            continue;
        }
        let dest = unique(&folder, &name, true);
        let len = std::fs::metadata(&real).map_err(es)?.len();
        match decide(&real, len, ctx) {
            Home::Copy => copy_verified(&real, &dest)?,
            Home::Link => {
                link(&real, &dest)?;
            }
        }
        r.moved += 1;
    }
    if logp.exists() {
        std::fs::rename(&logp, ctx.data.join(OLD_LOG)).map_err(es)?;
    }
    std::fs::write(&mark, serde_json::json!({ "moved": r.moved, "gone": r.gone, "skipped": r.skipped }).to_string()).map_err(es)?;
    Ok(r)
}

/// 옛 '받은 것' 안 것(파일·별칭·하위 폴더)을 참모 폴더 맨 위로 한 번 옮긴다(홈·모드 ④). 같은 참모 폴더 안 이름 바꾸기(rename)라
/// 복사 없이 한 번에 넘어가 중간에 멈춰도 원본이 둘로 갈리거나 사라지지 않는다. 이름이 겹치면 ' 2', .판 도 같이, 비면 '받은 것'을 치운다.
/// '받은 것'이 링크면 안 따라간다. 있던 참모에도 '자료'를 한 번 깐다. 끝나면 표시 파일 — 두 번째부턴 아무것도 안 한다
pub fn migrate_inbox(data: &Path, root: &Path) -> Result<Migrated, String> {
    let mark = data.join(INBOX_MARK);
    let mut r = Migrated::default();
    if mark.exists() {
        return Ok(r);
    }
    for (_, owner) in owners(root) {
        if !exists_any(&owner.join(BASE_FOLDER)) {
            let _ = std::fs::create_dir(owner.join(BASE_FOLDER));
        }
        let inbox = owner.join(OLD_INBOX);
        if !std::fs::symlink_metadata(&inbox).is_ok_and(|m| m.is_dir()) {
            continue;
        }
        let Ok(rd) = std::fs::read_dir(&inbox) else { continue };
        let mut kids: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))).collect();
        kids.sort();
        for from in kids {
            let name = from.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let is_dir = std::fs::symlink_metadata(&from).is_ok_and(|m| m.is_dir());
            let to = unique(&owner, &name, !is_dir);
            match std::fs::rename(&from, &to) {
                Ok(()) => {
                    move_vers(&from, &to);
                    r.moved += 1;
                }
                Err(e) => {
                    r.skipped += 1;
                    r.errors.push(format!("{}: {e}", from.display()));
                }
            }
        }
        // 빈 .판 → 빈 '받은 것' 차례로(남은 게 있으면 그대로 둔다)
        let vers = inbox.join(VERS);
        if vers.is_dir() {
            if let Ok(rd) = std::fs::read_dir(&vers) {
                for d in rd.flatten() {
                    let _ = std::fs::remove_dir(d.path());
                }
            }
            let _ = std::fs::remove_dir(&vers);
        }
        let _ = std::fs::remove_dir(&inbox);
    }
    std::fs::create_dir_all(data).map_err(es)?;
    std::fs::write(&mark, serde_json::json!({ "moved": r.moved, "skipped": r.skipped }).to_string()).map_err(es)?;
    Ok(r)
}

// ── 기록에서 내 폴더로(홈·모드 ⑤)·새 문서(⑦) ──

/// 기록에서 내 폴더로 끌면 바로가기만 — 집(보관함 맨 위 파일·프로젝트 파일)은 그대로라 기록도 그대로 남는다.
/// 별칭을 넘겨도 진짜 파일을 가리킨다. 같은 곳을 가리키는 바로가기가 그 폴더에 이미 있으면 그걸 돌려준다
pub fn alias(ctx: &Ctx, owner: &Path, rel: &str, src: &Path) -> Result<PathBuf, String> {
    if rel.trim_matches('/').is_empty() {
        return Err("바로가기는 폴더 안에만 만들어".into());
    }
    if !plain_abs(src) {
        return Err(format!("절대 경로만: {}", src.display()));
    }
    let real = std::fs::canonicalize(src).map_err(|_| format!("없는 파일: {}", src.display()))?;
    let home = canon(ctx.home);
    if !real.starts_with(&home) || real == home {
        return Err(format!("홈 폴더 밖 파일: {}", src.display()));
    }
    if !real.is_file() {
        return Err(format!("파일만: {}", src.display()));
    }
    let data = canon(ctx.data);
    if real.starts_with(&data) && real.parent() != Some(data.join("attach").as_path()) {
        return Err(format!("앱 데이터 폴더 안 파일: {}", src.display()));
    }
    let dir = sub_dir(owner, rel)?;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            if std::fs::read_link(e.path()).is_ok_and(|t| canon(&t) == real || t == real) {
                return Ok(e.path());
            }
        }
    }
    let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let at = unique(&dir, &safe_name(&name, "파일"), true);
    link(&real, &at)?;
    Ok(at)
}

/// 새 문서 — md 는 '# 제목' 한 줄, xlsx 는 시트 하나짜리 빈 통합 문서. rel 폴더(빈 글 = 보관함 맨 위)에, 겹치면 번호
pub fn new_doc(owner: &Path, rel: &str, kind: &str, title: &str) -> Result<PathBuf, String> {
    let (ext, fallback) = match kind {
        "md" => ("md", "새 문서"),
        "xlsx" => ("xlsx", "새 엑셀"),
        _ => return Err(format!("문서(md)·엑셀(xlsx)만: {kind}")),
    };
    let dir = sub_dir(owner, rel)?;
    let base = safe_name(title.trim(), fallback);
    let at = unique(&dir, &format!("{base}.{ext}"), true);
    let body = if ext == "md" { format!("# {}\n\n", if title.trim().is_empty() { fallback } else { title.trim() }).into_bytes() } else { crate::sheet::blank_xlsx("시트1")? };
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&at).map_err(es)?;
    std::io::Write::write_all(&mut f, &body).map_err(es)?;
    Ok(at)
}

/// 폴더 아래 보통 파일들(자리 rel) — 점 파일·링크는 뺀다
fn files_under(dir: &Path) -> Vec<PathBuf> {
    fn walk(base: &Path, d: &Path, out: &mut Vec<PathBuf>) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) {
                continue;
            }
            match std::fs::symlink_metadata(&p) {
                Ok(m) if m.is_dir() => walk(base, &p, out),
                Ok(m) if m.is_file() => out.push(p.strip_prefix(base).map(Path::to_path_buf).unwrap_or_default()),
                _ => {}
            }
        }
    }
    let mut v = Vec::new();
    walk(dir, dir, &mut v);
    v.sort();
    v
}

/// 옛 '내 페이지'(<데이터>/pages)를 첫 참모 보관함 '페이지' 폴더로 한 번(홈·모드 ⑧) — 복사 → 내용 확인 → 옛 자리는 pages.bak 로 이름만 바꿔 남긴다.
/// 하위 페이지(같은 이름 폴더)·그림은 그대로. 이미 '페이지'가 있으면 ' 2'(섞지 않음). 하나라도 실패하면 이번 복사본을 치우고 원본·표시는 그대로 —
/// 다음에 다시. 참모가 아직 없으면 기다린다(표시 안 함)
pub fn migrate_pages(ctx: &Ctx, first: Option<&Owner>) -> Result<Migrated, String> {
    let mark = ctx.data.join(PAGES_MARK);
    let mut r = Migrated::default();
    if mark.exists() {
        return Ok(r);
    }
    let Some(o) = first else { return Ok(r) };
    let src = ctx.data.join("pages");
    let link = std::fs::symlink_metadata(&src).is_ok_and(|m| m.file_type().is_symlink());
    let files = if src.is_dir() && !link { files_under(&src) } else { Vec::new() };
    if files.is_empty() {
        std::fs::write(&mark, "{\"moved\":0}").map_err(es)?;
        return Ok(r);
    }
    let owner = owner_dir(ctx.root, &o.id, &o.name)?;
    let dest = unique(&owner, PAGES_FOLDER, false);
    std::fs::create_dir(&dest).map_err(es)?;
    for rel in &files {
        let (from, to) = (src.join(rel), dest.join(rel));
        let step = std::fs::create_dir_all(to.parent().unwrap_or(&dest)).map_err(es).and_then(|_| copy_verified(&from, &to));
        if let Err(e) = step.and_then(|_| if same_content(&from, &to) { Ok(()) } else { Err(format!("내용이 달라: {}", rel.display())) }) {
            r.errors.push(format!("{}: {e}", from.display()));
            break;
        }
        r.moved += 1;
    }
    if !r.errors.is_empty() {
        let _ = std::fs::remove_dir_all(&dest); // 이번에 만든 복사본만 — 원본은 그대로
        r.moved = 0;
        return Ok(r);
    }
    std::fs::rename(&src, unique(ctx.data, "pages.bak", false)).map_err(es)?;
    std::fs::write(&mark, serde_json::json!({ "moved": r.moved, "to": dest.to_string_lossy() }).to_string()).map_err(es)?;
    Ok(r)
}

// ── 폴더 여러 층·끌기 정리 ──

/// 참모 폴더 안 자리(빈 글 = 참모 폴더 자체) — 조각 검사 + 링크를 풀어도 안이어야(끝 조각이 링크면 그 링크 자체는 허용)
pub fn inside(owner: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim_matches('/');
    if rel.is_empty() {
        return Ok(owner.to_path_buf());
    }
    if rel.split('/').any(|s| s.trim().is_empty() || s.starts_with('.') || s.contains('\\')) {
        return Err(format!("이상한 경로: {rel}"));
    }
    let p = owner.join(rel);
    let parent = p.parent().unwrap_or(owner);
    if !canon(parent).starts_with(canon(owner)) {
        return Err(format!("보관함 밖: {rel}"));
    }
    Ok(p)
}

pub(crate) fn rel_of(owner: &Path, p: &Path) -> String {
    p.strip_prefix(owner).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default()
}

/// 새 폴더 — parent 안에(빈 글 = 참모 폴더 맨 위). 겹치면 번호. 만든 자리(rel)
pub fn mkdir(owner: &Path, parent: &str, name: &str) -> Result<String, String> {
    let dir = inside(owner, parent)?;
    if !dir.is_dir() || !canon(&dir).starts_with(canon(owner)) {
        return Err(format!("없는 폴더: {parent}"));
    }
    let p = unique(&dir, &safe_name(name, "새 폴더"), false);
    std::fs::create_dir(&p).map_err(es)?;
    Ok(rel_of(owner, &p))
}

/// 이전 판 폴더 — 파일 옆 .판/<파일 이름>
pub fn vers_dir(file: &Path) -> PathBuf {
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    file.parent().unwrap_or(Path::new("")).join(VERS).join(name)
}

/// 파일을 옮기거나 이름을 바꿀 때 .판 도 따라간다
fn move_vers(from: &Path, to: &Path) {
    let (a, b) = (vers_dir(from), vers_dir(to));
    if a.is_dir() && !exists_any(&b) {
        let _ = std::fs::create_dir_all(b.parent().unwrap_or(Path::new("")));
        let _ = std::fs::rename(a, b);
    }
}

/// 같은 파일인가(장치·inode) — 링크는 안 따라감
fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (std::fs::symlink_metadata(a), std::fs::symlink_metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase() && exists_any(a)
    }
}

/// 이름 바꾸기 — 같은 이름이 있으면 거절(덮어쓰지 않는다). 보관함 자체는 못 바꾼다(아래 p == owner)
pub fn rename_entry(owner: &Path, rel: &str, name: &str) -> Result<String, String> {
    let p = inside(owner, rel)?;
    if !exists_any(&p) || p == owner {
        return Err(format!("없는 것: {rel}"));
    }
    let to = p.with_file_name(safe_name(name, "이름"));
    if exists_any(&to) && !same_file(&p, &to) {
        return Err(format!("같은 이름이 있어: {}", to.file_name().unwrap_or_default().to_string_lossy()));
    }
    if same_file(&p, &to) {
        // 대소문자만 바꿈(맥은 a.txt 와 A.txt 를 같게 본다) — 옆 이름을 한 번 거친다
        let mid = p.with_file_name(format!(".{}{PART}.case", p.file_name().unwrap_or_default().to_string_lossy()));
        std::fs::rename(&p, &mid).map_err(es)?;
        std::fs::rename(&mid, &to).map_err(es)?;
    } else {
        std::fs::rename(&p, &to).map_err(es)?;
    }
    move_vers(&p, &to);
    Ok(rel_of(owner, &to))
}

/// 끌어 옮기기 — 집 파일은 진짜 이동(.판 도), 별칭은 별칭만(링크 자체를 옮긴다). 겹치면 번호
pub fn move_entry(owner: &Path, rel: &str, to_dir: &str) -> Result<String, String> {
    let p = inside(owner, rel)?;
    let dir = inside(owner, to_dir)?;
    if !exists_any(&p) || p == owner {
        return Err(format!("없는 것: {rel}"));
    }
    if !dir.is_dir() || !canon(&dir).starts_with(canon(owner)) {
        return Err(format!("없는 폴더: {to_dir}"));
    }
    let is_dir = std::fs::symlink_metadata(&p).is_ok_and(|m| m.is_dir());
    if is_dir && (dir == p || dir.starts_with(&p)) {
        return Err("폴더를 자기 안으로는 못 옮겨".into());
    }
    if p.parent() == Some(dir.as_path()) {
        return Ok(rel_of(owner, &p));
    }
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let to = unique(&dir, &name, !is_dir);
    std::fs::rename(&p, &to).map_err(es)?;
    move_vers(&p, &to);
    Ok(rel_of(owner, &to))
}

/// 휴지통으로 — 별칭이면 별칭만, 파일이면 .판 도. 보관함 자체는 안 됨
pub fn remove(owner: &Path, rel: &str, bin: &Path) -> Result<Vec<crate::locker_trash::Moved>, String> {
    let p = inside(owner, rel)?;
    if !exists_any(&p) || p == owner {
        return Err(format!("없는 것: {rel}"));
    }
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let v = vers_dir(&p);
    let to = send_to_bin(&p, bin, &name, true)?;
    let mut out = vec![crate::locker_trash::Moved { from: p, to, kind: Default::default() }];
    if v.is_dir() {
        if let Ok(vt) = send_to_bin(&v, bin, &format!("{name} 이전 판"), false) {
            out.push(crate::locker_trash::Moved { from: v, to: vt, kind: crate::locker_trash::Kind::Extra });
        }
    }
    Ok(out)
}

/// 휴지통으로 — 맥은 bin(~/.Trash)에 겹치지 않는 이름으로 옮긴다(되돌리기는 다시 옮김). 윈도우는 시스템 휴지통(Recycle Bin)으로 보내고
/// 기록엔 표시(win_recycle::MARK)만 — 되돌리기는 휴지통 기록에서 원래 경로로 찾는다(2026-10-21 리뷰 ⑦-18)
pub fn send_to_bin(p: &Path, bin: &Path, name: &str, file: bool) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let _ = (bin, name, file);
        crate::win_recycle::recycle(p)?;
        Ok(PathBuf::from(crate::win_recycle::MARK))
    }
    #[cfg(not(windows))]
    {
        let to = unique(bin, name, file);
        std::fs::rename(p, &to).map_err(es)?;
        Ok(to)
    }
}

/// 화면이 받는 한 줄 — 폴더·파일·별칭(가리키는 곳, 끊겼으면 gone)
#[derive(Debug, Clone, serde::Serialize)]
pub struct Entry {
    pub rel: String,
    pub name: String,
    pub dir: bool,
    pub link: Option<String>,
    pub gone: bool,
    pub size: Option<u64>,
    pub mtime: Option<u64>,
    pub vers: usize,
    /// 맥 폴더 연결(locker_link) — 바로가기 폴더 자체. dir 이기도 하고 link 는 가리키는 곳, 끊기면 gone
    pub linked: bool,
    /// 연결 폴더 안쪽 — 읽기만(고치기·옮기기·지우기·넣기 거절, 폰도 읽기 전용)
    pub ro: bool,
}

const MAX_DEPTH: usize = 8;
const MAX_ENTRIES: usize = 5000;

pub(crate) fn ms(t: std::time::SystemTime) -> Option<u64> {
    t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

/// 참모 폴더 전체 — 폴더 먼저·이름 순, 점으로 시작하는 것(.chammo·.판·복사 조각)은 안 보인다. 별칭은 따라가지 않는다
pub fn tree(owner: &Path) -> Vec<Entry> {
    tree_in(owner, None)
}

/// 연결 폴더가 아직 홈 안 안전한 곳을 가리키는지 home 으로 다시 본다(앱 명령은 늘 home 을 준다)
pub fn tree_in(owner: &Path, home: Option<&Path>) -> Vec<Entry> {
    let links = crate::locker_link::linked_targets(owner);
    let mut out = Vec::new();
    walk(owner, owner, 0, &links, home, &mut out);
    out
}

fn walk(owner: &Path, dir: &Path, depth: usize, links: &[String], home: Option<&Path>, out: &mut Vec<Entry>) {
    if depth > MAX_DEPTH || out.len() >= MAX_ENTRIES {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut items: Vec<(bool, String, PathBuf, Option<String>)> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            let lm = std::fs::symlink_metadata(e.path()).ok()?;
            // 맥 폴더 연결 — 표식에 있는 폴더 링크만 폴더로 따라간다
            let linked = if lm.file_type().is_symlink() && !links.is_empty() { std::fs::read_link(e.path()).ok().map(|t| t.to_string_lossy().into_owned()).filter(|t| links.contains(t)) } else { None };
            Some((lm.is_dir() || linked.is_some(), name, e.path(), linked))
        })
        .collect();
    items.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    for (is_dir, name, p, linked) in items {
        if out.len() >= MAX_ENTRIES {
            return;
        }
        if let Some(t) = linked {
            crate::locker_link::push_linked(owner, &p, t, home, out);
            continue;
        }
        let link = std::fs::read_link(&p).ok().map(|t| t.to_string_lossy().into_owned());
        let md = std::fs::metadata(&p).ok();
        let vers = if link.is_none() && !is_dir { std::fs::read_dir(vers_dir(&p)).map(|r| r.count()).unwrap_or(0) } else { 0 };
        out.push(Entry {
            rel: rel_of(owner, &p),
            name,
            dir: is_dir,
            gone: md.is_none(),
            size: md.as_ref().filter(|m| m.is_file()).map(|m| m.len()),
            mtime: md.as_ref().and_then(|m| m.modified().ok()).and_then(ms),
            link,
            vers,
            linked: false,
            ro: false,
        });
        if is_dir {
            walk(owner, &p, depth + 1, links, home, out);
        }
    }
}

// ── 이전 판(.판) ──

/// 판을 남기는 최대 수·크기 — 넘으면 오래된 것부터 버리고, 큰 파일은 안 남긴다
pub const MAX_VERS: usize = 20;
const VERS_MAX_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Clone, serde::Serialize)]
pub struct Ver {
    pub n: usize,
    pub path: String,
    pub size: u64,
    pub mtime: Option<u64>,
}

/// 남은 판 — 번호 순
pub fn versions(file: &Path) -> Vec<Ver> {
    let Ok(rd) = std::fs::read_dir(vers_dir(file)) else { return Vec::new() };
    let mut v: Vec<Ver> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let n: usize = name.split('.').next()?.parse().ok()?;
            let m = e.metadata().ok()?;
            Some(Ver { n, path: e.path().to_string_lossy().into_owned(), size: m.len(), mtime: m.modified().ok().and_then(ms) })
        })
        .collect();
    v.sort_by_key(|x| x.n);
    v
}

fn ext_of(file: &Path) -> String {
    file.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default()
}

/// 지금 모양이 마지막 판과 다르면(크기·바뀐 시각) 새 판으로 남긴다 — 앱이 고치기 직전·되돌리기 직전에만(keep_before_write·restore).
/// 들여오기·옮기기·처음 보기 땐 안 부른다(같은 내용이 두 벌이 된다, 2026-10-11 실데이터). 별칭·큰 파일은 안 함
pub fn track_file(file: &Path) {
    track_file_max(file, VERS_MAX_BYTES);
}

/// track_file 의 한도를 정해 부르는 것(시험은 작은 한도로 '큰 파일'을 만든다)
pub fn track_file_max(file: &Path, max: u64) {
    let Ok(lm) = std::fs::symlink_metadata(file) else { return };
    if !lm.is_file() || lm.len() > max {
        return;
    }
    let vs = versions(file);
    let same = vs.last().is_some_and(|l| {
        let m = std::fs::metadata(&l.path).ok();
        m.as_ref().map(|m| m.len()) == Some(lm.len()) && m.and_then(|m| m.modified().ok()) == lm.modified().ok()
    });
    if same {
        return;
    }
    let dir = vers_dir(file);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let n = vs.last().map(|l| l.n + 1).unwrap_or(1);
    let to = dir.join(format!("{n}{}", ext_of(file)));
    if copy_verified(file, &to).is_err() {
        return;
    }
    if let (Ok(t), Ok(f)) = (lm.modified(), std::fs::File::options().write(true).open(&to)) {
        let _ = f.set_modified(t);
    }
    for old in vs.iter().take((vs.len() + 1).saturating_sub(MAX_VERS)) {
        let _ = std::fs::remove_file(&old.path);
    }
}

/// 앱이 파일을 고치기 직전(스페이스 md 저장·엑셀 칸 저장) — 보관함 안 집 파일이면 지금 모양을 판으로. 보관함 밖·별칭은 그대로
/// (md·엑셀은 저장 직전 자기 history 를 따로 남긴다)
pub fn keep_before_write_in(root: &Path, file: &Path) {
    let link = std::fs::symlink_metadata(file).is_ok_and(|m| m.file_type().is_symlink());
    if !link && canon(file).starts_with(canon(root)) {
        track_file(file);
    }
}

pub fn keep_before_write(file: &Path) {
    keep_before_write_in(&app_ctx().root, file);
}

/// 이미 생긴 '원본과 같은 첫 판'(예전 훑기·들여오기가 남긴 두 벌)을 한 번 휴지통으로 — 판이 하나뿐이고 1번이며 크기·수정 시각이 지금 파일과
/// 같을 때만. 빈 판 폴더도 치운다. 표시 파일 locker-vers-clean.done 이 있으면 아무것도 안 한다
pub fn clean_first_versions(data: &Path, root: &Path, bin: &Path) -> Result<Migrated, String> {
    let mark = data.join(VERS_CLEAN_MARK);
    let mut r = Migrated::default();
    if mark.exists() {
        return Ok(r);
    }
    for (_, owner) in owners(root) {
        for e in tree(&owner).iter().filter(|e| !e.dir && e.link.is_none()) {
            let file = owner.join(&e.rel);
            let vs = versions(&file);
            let [v] = vs.as_slice() else { continue };
            let (a, b) = (std::fs::metadata(&v.path).ok(), std::fs::metadata(&file).ok());
            let same = v.n == 1
                && a.as_ref().map(|m| m.len()) == b.as_ref().map(|m| m.len())
                && a.and_then(|m| m.modified().ok()).is_some_and(|t| b.and_then(|m| m.modified().ok()) == Some(t));
            if !same {
                continue;
            }
            std::fs::create_dir_all(bin).map_err(es)?;
            let name = format!("{} 첫 판{}", e.name.trim_end_matches(&ext_of(&file)), ext_of(&file));
            match std::fs::rename(&v.path, unique(bin, &name, true)) {
                Ok(()) => {
                    r.moved += 1;
                    let dir = vers_dir(&file);
                    let _ = std::fs::remove_dir(&dir);
                    if let Some(p) = dir.parent() {
                        let _ = std::fs::remove_dir(p);
                    }
                }
                Err(e) => r.errors.push(format!("{}: {e}", v.path)),
            }
        }
    }
    std::fs::create_dir_all(data).map_err(es)?;
    std::fs::write(&mark, serde_json::json!({ "moved": r.moved }).to_string()).map_err(es)?;
    Ok(r)
}

/// 복사 → 확인 → 그 자리를 바꿔 끼움(rename 은 한 번에 바뀐다)
fn replace_verified(src: &Path, dest: &Path) -> Result<(), String> {
    let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let part = dest.with_file_name(format!(".{name}{PART}"));
    let _ = std::fs::remove_file(&part);
    copy_verified(src, &part)?;
    std::fs::rename(&part, dest).map_err(|e| {
        let _ = std::fs::remove_file(&part);
        e.to_string()
    })
}

/// n 번째 판으로 되돌리기 — 지금 판은 이미 남아 있다(넣을 때·훑을 때). 되돌린 모양도 새 판이 된다
pub fn restore(file: &Path, n: usize) -> Result<(), String> {
    restore_max(file, n, VERS_MAX_BYTES)
}

pub fn restore_max(file: &Path, n: usize, max: u64) -> Result<(), String> {
    if std::fs::read_link(file).is_ok() {
        return Err("바로가기는 집(프로젝트)에서 되돌려".into());
    }
    track_file_max(file, max);
    // 지금 모양이 마지막 판으로 남았나(크기·바뀐 시각) — 못 남겼으면(큰 파일·디스크 꽉 참) 덮지 않는다
    let saved = versions(file).last().is_some_and(|l| {
        let (a, b) = (std::fs::metadata(&l.path).ok(), std::fs::metadata(file).ok());
        a.as_ref().map(|m| m.len()) == b.as_ref().map(|m| m.len()) && a.and_then(|m| m.modified().ok()) == b.and_then(|m| m.modified().ok())
    });
    if !saved {
        return Err("지금 판을 남기지 못해서 되돌리지 않았어(파일이 크거나 디스크가 꽉 찼어)".into());
    }
    let v = versions(file).into_iter().find(|v| v.n == n).ok_or_else(|| format!("{n}번째 판이 없어"))?;
    replace_verified(Path::new(&v.path), file)?;
    track_file(file);
    Ok(())
}

// ── 이사(프로젝트에 넘기기) ──

/// 이사 간 자리 — <프로젝트>/assets/보관함/
pub const GIVE_DIR: &str = "assets/보관함";

/// "a/b" 를 조각마다 붙인다 — 윈도우 canonicalize 가 준 \\?\ 경로에선 '/' 가 구분자가 아니라서 join("assets/보관함") 이
/// 이름이 'assets/보관함' 인 폴더 하나가 돼 만들기가 실패했다(2026-10-21 리뷰)
pub(crate) fn join_rel(base: &Path, rel: &str) -> PathBuf {
    rel.split('/').filter(|s| !s.is_empty()).fold(base.to_path_buf(), |p, s| p.join(s))
}

fn project_ok(ctx: &Ctx, project: &Path) -> Result<PathBuf, String> {
    if !plain_abs(project) || !project.is_dir() {
        return Err(format!("없는 프로젝트 폴더: {}", project.display()));
    }
    let p = canon(project);
    let home = canon(ctx.home);
    if p.starts_with(&home) && p.starts_with(canon(ctx.data)) {
        return Err(format!("데이터 폴더 안 프로젝트라 못 넘겨 — devRoot 를 데이터 폴더 밖으로: {}", project.display()));
    }
    if !p.starts_with(&home) || p == home || p.starts_with(canon(ctx.root)) {
        return Err(format!("프로젝트로 못 쓰는 자리: {}", project.display()));
    }
    Ok(p)
}

/// 보관함이 집인 파일을 프로젝트로 이사 — 복사 → 확인 → 옛 자리에 별칭(실패하면 원래대로). 새 경로를 돌려준다.
/// 별칭이면(이미 다른 데가 집) 그 프로젝트 안이면 그대로, 아니면 둘째 프로젝트라 복사만
pub fn give(ctx: &Ctx, file: &Path, project: &Path) -> Result<PathBuf, String> {
    let proj = project_ok(ctx, project)?;
    let lm = std::fs::symlink_metadata(file).map_err(|_| format!("없는 파일: {}", file.display()))?;
    let parent = file.parent().ok_or("이상한 경로")?;
    if !plain_abs(file) || !canon(parent).starts_with(canon(ctx.root)) {
        return Err(format!("보관함 안 파일만 이사해: {}", file.display()));
    }
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = join_rel(&proj, GIVE_DIR);
    // 프로젝트 안 assets·보관함 자리가 링크면(받아 온 저장소) 그 링크를 따라 밖에 쓰게 된다 — 거절
    for p in [proj.join("assets"), dir.clone()] {
        if std::fs::symlink_metadata(&p).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(format!("프로젝트의 {} 가 바로가기라 이사 못 해", p.display()));
        }
    }
    let ensure = || -> Result<(), String> {
        std::fs::create_dir_all(&dir).map_err(es)?;
        if canon(&dir).starts_with(&proj) {
            Ok(())
        } else {
            Err(format!("프로젝트 밖으로 이어진 자리: {}", dir.display()))
        }
    };
    if lm.file_type().is_symlink() {
        let target = canon(file);
        if !target.is_file() {
            return Err(format!("끊긴 별칭이야: {}", file.display()));
        }
        if target.starts_with(&proj) {
            return Ok(target);
        }
        ensure()?;
        let to = unique(&dir, &name, true);
        copy_verified(&target, &to)?;
        return Ok(to);
    }
    if !lm.is_file() {
        return Err("파일만 이사해".into());
    }
    ensure()?;
    let to = unique(&dir, &name, true);
    copy_verified(file, &to)?;
    // 옛 자리를 잠깐 숨겨 두고 별칭을 놓는다 — 별칭이 안 되면 되돌린다
    let hold = held(file);
    std::fs::rename(file, &hold).map_err(es)?;
    // 바로가기를 못 만들면(윈도우 권한 — link 가 복사로 떨어짐) 집이 둘이 되니 되돌린다
    match link(&to, file) {
        Ok(true) => {}
        Ok(false) | Err(_) => {
            let _ = std::fs::remove_file(file);
            let _ = std::fs::rename(&hold, file);
            let _ = std::fs::remove_file(&to);
            return Err("이 컴퓨터에선 바로가기를 못 만들어 이사하지 않았어".into());
        }
    }
    let _ = std::fs::remove_file(&hold);
    Ok(to)
}

/// '보관함으로 되돌리기' — 이사 간 파일(<프로젝트>/assets/보관함/…)을 다시 별칭 자리로. 프로젝트 원래 파일은 안 데려온다
/// 바로가기가 가리키는 곳 — 상대 링크는 링크가 있는 폴더 기준으로 푼다(앱 현재 폴더 기준이 아니다)
pub fn link_target(at: &Path) -> Option<PathBuf> {
    let t = std::fs::read_link(at).ok()?;
    let t = if t.is_absolute() { t } else { at.parent()?.join(t) };
    Some(canon(&t))
}

/// '보관함으로 되돌리기' — 이사 간 파일(<프로젝트>/assets/보관함/, 홈 안·보관함 밖)만. 복사 → 확인 → 바로가기 자리에 바꿔 끼움,
/// 다른 보관함 바로가기가 아직 그 파일을 가리키면 프로젝트 쪽은 지우지 않는다
pub fn take_back_in(root: &Path, home: &Path, link_at: &Path) -> Result<(), String> {
    let target = link_target(link_at).ok_or_else(|| "이사 간 파일의 바로가기가 아니야".to_string())?;
    let given = target.parent().is_some_and(|p| p.ends_with(GIVE_DIR));
    if !given || !target.is_file() || !target.starts_with(canon(home)) || target.starts_with(canon(root)) {
        return Err("이사 간 파일만 되돌려(프로젝트 원래 파일은 그대로 둬)".into());
    }
    let name = link_at.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let part = link_at.with_file_name(format!(".{name}.back{PART}"));
    if std::fs::symlink_metadata(&part).is_ok() {
        std::fs::remove_file(&part).map_err(es)?;
    }
    copy_verified(&target, &part)?;
    std::fs::rename(&part, link_at).map_err(es)?;
    let others = owners(root).iter().any(|(_, d)| tree(d).iter().any(|e| e.link.is_some() && link_target(&d.join(&e.rel)).as_deref() == Some(target.as_path())));
    if !others {
        std::fs::remove_file(&target).map_err(es)?;
    }
    Ok(())
}

// ── 폰 ──

/// 참모 폴더들(.chammo 가 있는 것) — (이름, 폴더)
fn owners(root: &Path) -> Vec<(String, PathBuf)> {
    let Ok(rd) = std::fs::read_dir(root) else { return Vec::new() };
    let mut v: Vec<(String, PathBuf)> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| std::fs::symlink_metadata(p).is_ok_and(|m| m.is_dir()) && id_of(p).is_some())
        .filter_map(|p| Some((p.file_name()?.to_string_lossy().into_owned(), p)))
        .collect();
    v.sort();
    v
}

fn iso(ms: Option<u64>) -> String {
    ms.map(crate::direct::iso_of_ms).unwrap_or_default()
}

/// 폰이 보는 줄 — 넓은 맥 폴더 연결(바탕화면·다운로드·문서 자체, locker_link::broad_target)과 그 안쪽은 뺀다
fn phone_entries(dir: &Path, home: &Path) -> Vec<Entry> {
    let es = tree(dir);
    let broad: Vec<String> = es.iter().filter(|e| e.linked && e.link.as_deref().is_some_and(|t| crate::locker_link::broad_target(home, Path::new(t)))).map(|e| e.rel.clone()).collect();
    es.into_iter().filter(|e| !broad.iter().any(|r| e.rel == *r || e.rel.starts_with(&format!("{r}/")))).collect()
}

/// 폰 보관함 — 폰 화면이 받던 모양({items, hidden, folders}) 그대로, 진짜 폴더에서 만든다. 주인 = 참모 폴더 이름, 폴더 = 참모 폴더 안 자리(맨 위면 없음),
/// 별칭 줄의 path 는 가리키는 진짜 파일
/// 폰에 내보내는 경로 — 윈도우는 / 로(fwd). 폰은 dirs[주인] + '/' + rel 로 여는 경로를 만들어 허용 집합과 글자로 맞춘다(공개 이슈 #15)
pub fn phone_path(p: &Path) -> String {
    crate::config::fwd(&p.to_string_lossy())
}

pub fn phone_view(root: &Path, home: &Path) -> serde_json::Value {
    let (mut items, mut folders, mut dirs, mut ids) = (Vec::new(), Vec::new(), serde_json::Map::new(), serde_json::Map::new());
    for (name, dir) in owners(root) {
        dirs.insert(name.clone(), serde_json::Value::String(phone_path(&dir)));
        // 주인 id(.chammo) — 폰 팀 탭이 팀 폴더를 이름이 아니라 id(team-<팀>)로 고른다
        if let Some(id) = id_of(&dir) {
            ids.insert(name.clone(), serde_json::Value::String(id));
        }
        for e in phone_entries(&dir, home) {
            if e.dir {
                // 맥 폴더 연결이면 linked·ro 를 더한다(아니면 옛 모양 그대로)
                let mut f = serde_json::json!({ "owner": name, "name": e.rel });
                if e.linked {
                    f["linked"] = true.into();
                }
                if e.ro {
                    f["ro"] = true.into();
                }
                folders.push(f);
                continue;
            }
            let parent = e.rel.rsplit_once('/').map(|(p, _)| p.to_string()).unwrap_or_default();
            let folder = if parent.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(parent) };
            // 별칭은 가리키는 진짜 파일로 — 폰 문지기(mobile_files::pick)는 링크 경로를 아예 안 연다
            let at = dir.join(&e.rel);
            let path = if (e.link.is_some() && !e.gone) || e.ro { canon(&at) } else { at };
            items.push(serde_json::json!({
                "owner": name, "path": phone_path(&path), "rel": e.rel, "copy": e.link.is_none(), "by": "me", "ts": iso(e.mtime),
                "folder": folder, "name": null, "gone": e.gone, "mtime": e.mtime, "size": e.size,
            }));
            if e.ro {
                if let Some(it) = items.last_mut() {
                    it["ro"] = true.into();
                }
            }
        }
    }
    serde_json::json!({ "items": items, "hidden": [], "folders": folders, "dirs": dirs, "ids": ids })
}

/// 폰이 부르는 참모 보관함(이름 = 참모 폴더 이름) — 있는 폴더만. 폰 쓰기 길은 새 참모 폴더를 만들지 않는다
pub fn phone_owner(root: &Path, name: &str) -> Option<PathBuf> {
    if name.trim().is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return None;
    }
    owners(root).into_iter().find(|(n, _)| n == name).map(|(_, d)| d)
}

/// 폰 '되돌리기' — 방금 넣은 바로가기를 뺀다. 링크만(진짜 파일·폴더는 안 지운다), 참모 폴더 안 자리만
pub fn unalias(owner: &Path, rel: &str) -> Result<(), String> {
    let at = inside(owner, rel)?;
    if rel.trim_matches('/').is_empty() || !std::fs::symlink_metadata(&at).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(format!("바로가기만 뺄 수 있어: {rel}"));
    }
    if crate::locker_link::is_connected(owner, rel) {
        return Err(format!("연결 폴더는 맥에서만 풀 수 있어: {rel}"));
    }
    std::fs::remove_file(&at).map_err(es)
}

/// 폰 md 글 칸 한 번에 쓸 수 있는 크기
pub const MAX_PHONE_MD: usize = 512 * 1024;

/// 폰 md 글 칸 저장 — 그 참모 보관함 안 집 파일(.md, 이미 있는 것)만. 고치기 직전 모양은 판으로, 쓰기는 옆 조각 → 바꿔 끼우기
#[cfg(test)]
pub fn write_md(owner: &Path, file: &Path, text: &str) -> Result<(), String> {
    write_md_from(owner, file, text, None)
}

/// base = 폰이 열 때(또는 지난번 저장 때) 받은 글 — 지금 파일이 그것과 다르면 CHANGED_OUTSIDE 로 안 쓴다(데스크톱 편집기 write_doc_text 의 expected 와 같게).
/// 폰이 연 뒤 맥에서 더한 줄을 폰 저장이 통째로 덮어 말없이 지웠다(2026-10-21 리뷰 ⑦-5). None = 옛 폰 화면(비교 없음)
pub fn write_md_from(owner: &Path, file: &Path, text: &str, base: Option<&str>) -> Result<(), String> {
    if text.len() >= MAX_PHONE_MD {
        return Err("너무 길어".into());
    }
    if !plain_abs(file) || file.extension().and_then(|e| e.to_str()) != Some("md") {
        return Err(format!("보관함 md 만: {}", file.display()));
    }
    let meta = std::fs::symlink_metadata(file).map_err(|_| format!("없는 파일: {}", file.display()))?;
    let hidden = file.strip_prefix(owner).map(|r| r.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.'))).unwrap_or(true);
    if !meta.is_file() || hidden || !canon(file).starts_with(canon(owner)) {
        return Err(format!("이 참모 보관함 밖: {}", file.display()));
    }
    if base.is_some_and(|b| std::fs::read_to_string(file).ok().as_deref() != Some(b)) {
        return Err(crate::reader::CHANGED_OUTSIDE.into());
    }
    track_file(file);
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let part = file.with_file_name(format!(".{name}{PART}"));
    std::fs::write(&part, text).map_err(es)?;
    std::fs::rename(&part, file).map_err(|e| {
        let _ = std::fs::remove_file(&part);
        e.to_string()
    })
}

/// 폰이 열어도 되는 경로 — 보관함 집 파일 + 별칭이 가리키는 진짜 파일(링크 경로는 문지기가 어차피 막는다). 끊긴 건 뺀다. 거름(mobile_files::pick)은 그대로 지난다
pub fn phone_paths(root: &Path, home: &Path) -> Vec<String> {
    let mut v = Vec::new();
    for (_, dir) in owners(root) {
        for e in phone_entries(&dir, home).into_iter().filter(|e| !e.dir && !e.gone) {
            let p = dir.join(&e.rel);
            v.push(phone_path(&if e.link.is_some() || e.ro { canon(&p) } else { p }));
        }
    }
    v
}

/// 폰이 올린 첨부를 그 참모 보관함 맨 위에 — 폰은 참모 이름으로 부른다(같은 이름 폴더, 없으면 그 이름으로 새로)
pub fn add_for_name(ctx: &Ctx, owner_name: &str, path: &Path) -> Result<Added, String> {
    let want = safe_name(owner_name, "참모");
    let dir = match owners(ctx.root).into_iter().find(|(n, _)| *n == want) {
        Some((_, d)) => d,
        None => owner_dir(ctx.root, &format!("name-{}", want.replace(' ', "-")), owner_name)?,
    };
    add(ctx, &dir, "", path)
}

// ── 끊긴 바로가기 다시 잇기·iCloud 로 빠진 파일 내려받기 ──

/// '다시 찾기' 후보 — 같은 이름만, 보관함·라이브러리·점 폴더 안은 뺀다(맥 검색 결과를 거른다). 10개까지
pub fn rank_candidates(hits: &[String], name: &str, home: &Path, root: &Path) -> Vec<PathBuf> {
    hits.iter()
        .map(PathBuf::from)
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy() == name))
        .filter(|p| p.starts_with(home) && !p.starts_with(root) && !p.starts_with(home.join("Library")))
        .filter(|p| !p.strip_prefix(home).map(|r| r.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.'))).unwrap_or(true))
        .take(10)
        .collect()
}

/// 끊긴(또는 다른 곳을 가리키는) 바로가기를 새 자리로 — 바로가기만, 새 자리는 홈 안 보통 파일. 새 링크를 옆에 만든 뒤 한 번에 바꿔 끼운다
pub fn relink(ctx: &Ctx, at: &Path, target: &Path) -> Result<(), String> {
    if std::fs::read_link(at).is_err() || std::fs::metadata(at).is_ok_and(|m| m.is_dir()) {
        return Err("파일 바로가기만 다시 이어(연결 폴더는 '다시 연결')".into());
    }
    let real = check_add(target, ctx)?;
    let name = at.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = at.with_file_name(format!(".{name}{PART}"));
    let _ = std::fs::remove_file(&tmp);
    link(&real, &tmp)?;
    std::fs::rename(&tmp, at).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// iCloud '최적화 저장'으로 내용이 클라우드에만 있는 파일인가(APFS dataless) — 맥만
#[cfg(target_os = "macos")]
pub fn dataless(p: &Path) -> bool {
    use std::os::macos::fs::MetadataExt;
    const SF_DATALESS: u32 = 0x4000_0000;
    std::fs::metadata(p).is_ok_and(|m| m.st_flags() & SF_DATALESS != 0)
}
#[cfg(not(target_os = "macos"))]
pub fn dataless(_p: &Path) -> bool {
    false
}

// ── 앱 명령 ──

/// 앱이 쓰는 자리들 — 홈·데이터 폴더·보관함 뿌리·자리 잡은 곳(devRoot·HQ·따로 더한 프로젝트)
pub struct AppCtx {
    pub home: PathBuf,
    pub data: PathBuf,
    pub root: PathBuf,
    pub settled: Vec<PathBuf>,
}

impl AppCtx {
    pub fn ctx(&self) -> Ctx<'_> {
        Ctx { home: &self.home, data: &self.data, root: &self.root, settled: &self.settled }
    }
}

/// 자리 잡은 곳 목록 — 빈 칸·홈 자체는 뺀다(빈 경로는 모든 경로의 앞이라 전부 별칭이 돼 버린다)
pub fn settled_of(home: &Path, dirs: &[String]) -> Vec<PathBuf> {
    let h = home.to_string_lossy();
    dirs.iter()
        .map(|d| crate::config::expand(&h, d.trim()))
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_absolute() && p != home)
        .collect()
}

pub fn app_ctx() -> AppCtx {
    let home = PathBuf::from(crate::platform::home());
    let data = crate::config::data_dir().to_path_buf();
    let real = crate::config::is_real_data(&home.to_string_lossy(), &data);
    let root = root_of(&home, &data, std::env::var("CHAMMO_LOCKER_ROOT").ok().as_deref(), real);
    let c = crate::config::current();
    let mut dirs = vec![c.dev_root.clone(), c.hq_dir.clone()];
    dirs.extend(c.extra_projects.iter().cloned());
    let settled = settled_of(&home, &dirs);
    AppCtx { home, data, root, settled }
}

/// 보관함을 시작했나 — 한 번 열었거나(OPENED_MARK), 이 판 전부터 쓰던 사람(스크린샷 연결·옛 보관함 옮기기 표식). 데이터 폴더만 본다
pub fn started(data: &Path) -> bool {
    [OPENED_MARK, crate::locker_link::SHOTS_MARK, DONE_MARK].iter().any(|m| data.join(m).exists())
}

/// 옛 보관함 옮기기 — 화면이 참모 목록(옛 열쇠 = 참모 이름 → id)을 알게 된 뒤 한 번 부른다
#[tauri::command]
pub fn locker_migrate(owners: Vec<Owner>) -> Result<Migrated, String> {
    let a = app_ctx();
    migrate_all(&a.ctx(), &owners, crate::locker_link::configured_location().as_deref())
}

/// 보관함을 시작하기 전(처음 열기 전)엔 아무것도 안 한다 — 옛 보관함·페이지 옮기기와 스크린샷 연결은 처음 열 때
pub fn migrate_all(ctx: &Ctx, owners: &[Owner], configured: Option<&str>) -> Result<Migrated, String> {
    if !started(ctx.data) {
        return Ok(Migrated::default());
    }
    let mut r = migrate(ctx, owners)?;
    let b = migrate_inbox(ctx.data, ctx.root)?;
    r.inbox = b.moved;
    r.errors.extend(b.errors);
    let p = migrate_pages(ctx, owners.first())?;
    r.pages = p.moved;
    r.errors.extend(p.errors);
    match crate::locker_link::auto_connect_shots(ctx, owners.first(), configured) {
        Ok(on) => r.shots = on,
        Err(e) => r.errors.push(format!("스크린샷 폴더 연결: {e}")),
    }
    let v = clean_first_versions(ctx.data, ctx.root, &ctx.home.join(".Trash"))?;
    r.errors.extend(v.errors);
    Ok(r)
}

/// 보관함 안 경로인가(화면이 넘긴 절대 경로) — 판·되돌리기·이사는 이 안에서만
/// 화면이 만든 경로를 OS 모양으로 — 윈도우 화면은 Rust 가 준 dir(`C:\…\참모`) 뒤에 rel 을 `/` 로 붙여 넘긴다. Path 는 그걸 구분자로 읽지만
/// 다시 모으면 `\` 라 plain_abs 가 달라 보여 이전 판·되돌리기·이사·파인더로 보기·다시 찾기가 모두 '보관함 밖'으로 막혔다(2026-10-21 리뷰 ⑦-8)
pub(crate) fn os_sep(p: &str, win: bool) -> String {
    if win { p.replace('/', "\\") } else { p.to_string() }
}

fn in_root(a: &AppCtx, p: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(os_sep(p, cfg!(windows)));
    let parent = p.parent().map(canon).unwrap_or_default();
    if !plain_abs(&p) || !parent.starts_with(canon(&a.root)) {
        return Err(format!("보관함 밖 경로: {}", p.display()));
    }
    Ok(p)
}

/// 읽기만 하는 길 — 보관함 안이거나, 연결 폴더를 지나 홈 안 안전한 곳에 닿은 경로
fn in_root_ro(a: &AppCtx, p: &str) -> Result<PathBuf, String> {
    let q = os_sep(p, cfg!(windows));
    in_root(a, p).or_else(|e| if crate::locker_link::read_path_ok(&a.ctx(), Path::new(&q)) { Ok(PathBuf::from(q)) } else { Err(e) })
}

#[derive(serde::Serialize)]
pub struct TreeView {
    /// 참모 폴더 절대 경로(시작 전이면 빈 글)
    pub dir: String,
    pub entries: Vec<Entry>,
    /// 보관함을 시작했나(started) — 화면은 이게 켜진 뒤에 옮기기·스크린샷 연결을 부른다
    pub started: bool,
}

/// 참모 보관함 — 폴더를 찾거나 만들고(이름 따라감) 목록. 읽기만 한다(판은 고치기 직전에만).
/// open = 사람이 보관함을 연 것(홈 화면이 미리 읽는 건 false) — 시작 전엔 open 일 때만 만든다
#[tauri::command]
pub fn locker_tree(id: String, name: String, open: Option<bool>) -> Result<TreeView, String> {
    let a = app_ctx();
    tree_at(&a.ctx(), &id, &name, open.unwrap_or(false), crate::locker_link::configured_cached().as_deref())
}

pub fn tree_at(ctx: &Ctx, id: &str, name: &str, open: bool, configured: Option<&str>) -> Result<TreeView, String> {
    if !started(ctx.data) {
        if !open {
            return Ok(TreeView { dir: String::new(), entries: Vec::new(), started: false });
        }
        std::fs::write(ctx.data.join(OPENED_MARK), "1").map_err(es)?;
    }
    let d = owner_dir(ctx.root, id, name)?;
    // 스크린샷 연결은 지금 스크린샷 폴더를 따라간다(설정 폴더가 나중에 생기면 바탕화면에서 그리로)
    let _ = crate::locker_link::follow_shots(ctx, &d, configured);
    Ok(TreeView { dir: d.to_string_lossy().into_owned(), entries: tree_in(&d, Some(ctx.home)), started: true })
}

/// 끌어놓기·열기 버튼·채팅 첨부·폰 — folder(빈 글 = 보관함 맨 위)에 넣는다
#[tauri::command]
pub fn locker_put(id: String, name: String, paths: Vec<String>, folder: Option<String>) -> serde_json::Value {
    let a = app_ctx();
    let d = match owner_dir(&a.root, &id, &name) {
        Ok(d) => d,
        Err(e) => return serde_json::json!({ "added": [], "errors": [e] }),
    };
    let (mut ok, mut errs) = (Vec::new(), Vec::new());
    for p in paths {
        match add(&a.ctx(), &d, folder.as_deref().unwrap_or(""), Path::new(&p)) {
            Ok(x) => ok.push(x),
            Err(e) => errs.push(e),
        }
    }
    serde_json::json!({ "added": ok, "errors": errs })
}

#[tauri::command]
pub fn locker_mkdir(id: String, name: String, parent: String, folder: String) -> Result<String, String> {
    let a = app_ctx();
    mkdir(&owner_dir(&a.root, &id, &name)?, &parent, &folder)
}

#[tauri::command]
pub fn locker_rename_at(id: String, name: String, rel: String, to: String) -> Result<String, String> {
    let a = app_ctx();
    rename_entry(&owner_dir(&a.root, &id, &name)?, &rel, &to)
}

#[tauri::command]
pub fn locker_move_to(id: String, name: String, rel: String, to: String) -> Result<String, String> {
    let a = app_ctx();
    move_entry(&owner_dir(&a.root, &id, &name)?, &rel, &to)
}

/// 기록 카드를 내 폴더에 끌어 놓았다 — 바로가기만(홈·모드 ⑤). 만든(또는 있던) 바로가기 경로
#[tauri::command]
pub fn locker_alias(id: String, name: String, path: String, folder: String) -> Result<String, String> {
    let a = app_ctx();
    let owner = owner_dir(&a.root, &id, &name)?;
    alias(&a.ctx(), &owner, &folder, Path::new(&path)).map(|p| p.to_string_lossy().into_owned())
}

/// 보관함 머리 + → 새 문서·새 엑셀(홈·모드 ⑦). 만든 파일 경로 — 화면이 바로 탭으로 연다
#[tauri::command]
pub fn locker_new_doc(id: String, name: String, folder: String, kind: String, title: String) -> Result<String, String> {
    let a = app_ctx();
    let owner = owner_dir(&a.root, &id, &name)?;
    new_doc(&owner, &folder, &kind, &title).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn locker_versions(path: String) -> Result<Vec<Ver>, String> {
    let a = app_ctx();
    Ok(versions(&in_root(&a, &path)?))
}

#[tauri::command]
pub fn locker_restore(path: String, n: usize) -> Result<(), String> {
    let a = app_ctx();
    restore(&in_root(&a, &path)?, n)
}

/// 프로젝트로 이사 — 새 경로(scripts/locker give 와 같은 규칙)
#[tauri::command]
pub fn locker_give(path: String, project: String) -> Result<String, String> {
    let a = app_ctx();
    let f = in_root(&a, &path)?;
    give(&a.ctx(), &f, Path::new(&project)).map(|p| p.to_string_lossy().into_owned())
}

/// 보관함으로 되돌리기
#[tauri::command]
pub fn locker_back(path: String) -> Result<(), String> {
    let a = app_ctx();
    take_back_in(&a.root, &a.home, &in_root(&a, &path)?)
}

/// '다시 찾기' — 맥 검색(Spotlight)으로 같은 이름 파일 후보
#[tauri::command]
pub fn locker_find(path: String) -> Result<Vec<String>, String> {
    let a = app_ctx();
    let p = in_root(&a, &path)?;
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if name.is_empty() {
        return Ok(Vec::new());
    }
    #[cfg(target_os = "macos")]
    let out = crate::platform::command("mdfind").arg("-onlyin").arg(&a.home).arg("-name").arg(&name).output().map_err(es)?;
    #[cfg(not(target_os = "macos"))]
    let out = std::process::Output { status: Default::default(), stdout: Vec::new(), stderr: Vec::new() };
    let hits: Vec<String> = String::from_utf8_lossy(&out.stdout).lines().map(str::to_string).collect();
    Ok(rank_candidates(&hits, &name, &a.home, &a.root).into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

#[tauri::command]
pub fn locker_relink(path: String, target: String) -> Result<(), String> {
    let a = app_ctx();
    relink(&a.ctx(), &in_root(&a, &path)?, Path::new(&target))
}

/// 열거나 참모에게 붙이기 직전 — iCloud 로 빠진 파일이면 내려받는다(최대 60초 기다림). 아니면 바로 끝
#[tauri::command]
pub async fn locker_fetch(path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let a = app_ctx();
        let p = in_root_ro(&a, &path)?;
        let real = canon(&p);
        if !dataless(&real) {
            return Ok(false);
        }
        #[cfg(target_os = "macos")]
        {
            let _ = crate::platform::command("brctl").arg("download").arg(&real).status();
            for _ in 0..120 {
                if !dataless(&real) {
                    return Ok(true);
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        }
        Err(format!("iCloud 에서 아직 못 받았어: {}", real.display()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 보관함 안 자리(읽기만 되는 별칭 포함)인가 — 끌어 내보내기(shown_share::drag_native)가 본다
pub(crate) fn locker_path_ok(path: &str) -> bool {
    in_root_ro(&app_ctx(), path).is_ok()
}

/// 파인더로 꺼내기 — 보관함 안 자리(별칭이면 가리키는 진짜 파일)를 파인더에서 골라 보여 준다.
/// 보관함 밖이면 미리보기·채팅 파일 카드에 띄운 파일(shown_share 거름)만(2026-10-30)
#[tauri::command]
pub fn locker_reveal(path: String) -> Result<(), String> {
    let a = app_ctx();
    let p = match in_root_ro(&a, &path) {
        Ok(p) => p,
        Err(_) if crate::shown_share::shown_now(&path) => PathBuf::from(&path),
        Err(e) => return Err(e),
    };
    let at = if std::fs::read_link(&p).is_ok() && p.exists() { canon(&p) } else { p };
    #[cfg(target_os = "macos")]
    let r = crate::platform::command("open").arg("-R").arg(&at).status();
    #[cfg(windows)]
    let r = crate::platform::command("explorer").arg(format!("/select,{}", at.display())).status();
    #[cfg(not(any(target_os = "macos", windows)))]
    let r = crate::platform::command("xdg-open").arg(at.parent().unwrap_or(&at)).status();
    r.map(|_| ()).map_err(es)
}

/// 열기 버튼 — 맥 파일 창(여러 개)으로 고른 것을 넣는다. 취소면 빈 결과
#[tauri::command]
pub async fn locker_choose(app: tauri::AppHandle, id: String, name: String, folder: Option<String>) -> Result<serde_json::Value, String> {
    let files = tauri::async_runtime::spawn_blocking(move || crate::agent_browser::choose_files(&app, true, crate::i18n::tr("보관함에 넣을 파일", "Files to keep in the locker")))
        .await
        .map_err(|e| e.to_string())??;
    Ok(locker_put(id, name, files, folder))
}

#[cfg(test)]
#[path = "locker_fs_tests.rs"]
mod tests;
