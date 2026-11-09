//! 내 메모 — 어느 참모·프로젝트·팀에도 안 속하는 메모(<데이터 폴더>/notes/*.md, 시안 docs/design-drafts/memo-panel C).
//! 파일 하나가 메모 한 장이고 제목은 첫 줄에서 읽는다. 세션과 무관해서 세션을 꺼도·앱을 다시 켜도 그대로고, 참모에게 저절로 안 읽힌다 —
//! 고친 기록(space-log)에도 안 남긴다(is_note_log). 지우기는 notes/휴지통 으로 옮기고 30일 뒤 정리.
//! 맥 화면은 문서 페이지(read_doc_text·write_doc_text)로 읽고 쓰고, 폰은 /api/note* 가 여기 함수로 읽고 쓴다.
//! 메모마다 스킨·띄움·따로 창·창 자리는 notes/.meta.json 하나에(시안 v2) — 맥·폰이 같은 목록을 본다
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const TRASH: &str = "휴지통";
/// 휴지통에 두는 기간
const KEEP_MS: u64 = 30 * 24 * 3600 * 1000;

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteRow {
    pub name: String,
    pub path: String,
    /// 첫 줄(빈 메모면 빈 글 — 화면이 '새 메모'로)
    pub title: String,
    /// 둘째 줄
    pub preview: String,
    /// 마지막으로 고친 시각(ms)
    pub at: u64,
    /// 스킨 — paper(메모지)·lined(줄 노트)·dark(어두운 종이)·term(터미널)
    pub skin: String,
    /// 띄워 둔 메모인가(패널에 쌓이거나 따로 창에 뜬다)
    pub shown: bool,
    /// 띄운 자리가 따로 창인가 — 패널엔 안 쌓는다(같은 메모가 두 곳에 안 뜨게)
    pub win: bool,
}

pub const META: &str = ".meta.json";
pub const SKINS: [&str; 4] = ["paper", "lined", "dark", "term"];

#[derive(serde::Serialize, serde::Deserialize, Default, Clone, Debug)]
#[serde(default)]
struct NoteMeta {
    skin: String,
    shown: bool,
    win: bool,
    /// 따로 창 자리 [x, y, 폭, 높이](논리 픽셀)
    #[serde(skip_serializing_if = "Option::is_none")]
    frame: Option<[f64; 4]>,
}

#[derive(serde::Serialize, serde::Deserialize, Default, Debug)]
#[serde(default, rename_all = "camelCase")]
struct MetaFile {
    notes: BTreeMap<String, NoteMeta>,
    /// 마지막으로 고른 스킨 — 새 메모가 따른다
    last_skin: String,
}

/// 바꿀 것만 — 화면·폰이 보낸다
#[derive(serde::Deserialize, Default, Debug)]
#[serde(default)]
pub struct MetaPatch {
    pub skin: Option<String>,
    pub shown: Option<bool>,
    pub win: Option<bool>,
    pub frame: Option<[f64; 4]>,
}

/// 메타는 여러 창·폰이 같이 고친다 — 읽고 고쳐 쓰는 동안 잠근다
static META_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 없거나 망가졌으면 None — 처음처럼(최근 메모 하나만 띄움)
fn read_meta(dir: &Path) -> Option<MetaFile> {
    serde_json::from_str(&std::fs::read_to_string(dir.join(META)).ok()?).ok()
}

fn write_meta(dir: &Path, m: &MetaFile) -> Result<(), String> {
    let tmp = dir.join(".meta.json.chammo-tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(META)).map_err(|e| e.to_string())
}

fn skin_of(s: &str) -> String {
    if SKINS.contains(&s) { s.into() } else { "paper".into() }
}

/// 메타를 목록에 입힌다. 메타 파일이 없으면 맨 위(최근) 메모만 띄운 것으로
fn dress(rows: &mut [NoteRow], meta: Option<&MetaFile>) {
    for (i, r) in rows.iter_mut().enumerate() {
        match meta {
            Some(m) => {
                let n = m.notes.get(&r.name).cloned().unwrap_or_default();
                (r.skin, r.shown, r.win) = (skin_of(&n.skin), n.shown, n.shown && n.win);
            }
            None => (r.skin, r.shown, r.win) = ("paper".into(), i == 0, false),
        }
    }
}

/// 처음 메타를 쓸 때 — 지금 보이는 대로(최근 하나 띄움)를 먼저 적어 둔다
fn meta_now(dir: &Path, now: u64) -> MetaFile {
    read_meta(dir).unwrap_or_else(|| {
        let mut m = MetaFile::default();
        if let Some(top) = list_files(dir, now).ok().and_then(|v| v.into_iter().next()) {
            m.notes.insert(top.name, NoteMeta { shown: true, ..Default::default() });
        }
        m
    })
}

/// 메모 하나의 스킨·띄움·창 자리를 바꾼다 — 있는 메모만, 아는 스킨만, 자리는 유한한 값만
pub fn meta_in(dir: &Path, name: &str, p: &MetaPatch) -> Result<NoteRow, String> {
    note_file(dir, name)?;
    if p.skin.as_deref().is_some_and(|s| !SKINS.contains(&s)) {
        return Err(format!("bad skin: {:?}", p.skin));
    }
    if p.frame.is_some_and(|f| f.iter().any(|v| !v.is_finite()) || f[2] < 1.0 || f[3] < 1.0) {
        return Err("bad frame".into());
    }
    let _g = META_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut m = meta_now(dir, now_ms());
    let n = m.notes.entry(name.into()).or_default();
    if let Some(s) = &p.skin {
        n.skin = s.clone();
        m.last_skin = s.clone();
    }
    let n = m.notes.get_mut(name).expect("방금 넣음");
    if let Some(v) = p.shown { n.shown = v; }
    if let Some(v) = p.win { n.win = v; }
    if p.frame.is_some() { n.frame = p.frame; }
    write_meta(dir, &m)?;
    let mut r = vec![row(dir, name)?];
    dress(&mut r, Some(&m));
    Ok(r.remove(0))
}

/// 따로 창 자리 — 기억한 게 없으면 None
pub fn frame_in(dir: &Path, name: &str) -> Option<[f64; 4]> {
    read_meta(dir)?.notes.get(name)?.frame
}

pub fn dir() -> PathBuf {
    crate::config::data_file("notes")
}

/// 메모 파일 이름 — 폴더를 못 넘고, 숨김·임시 파일이 아니고, md 만
pub fn name_ok(n: &str) -> bool {
    n.ends_with(".md") && n.len() > 3 && n.len() <= 128 && !n.starts_with('.') && !n.contains(['/', '\\', '\0']) && !n.contains("..")
}

/// 있는 메모 파일 — 링크는 안 따라간다(notes 밖 파일을 읽거나 쓰지 않게)
pub fn note_file(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !name_ok(name) {
        return Err(format!("bad note name: {name}"));
    }
    let p = dir.join(name);
    let m = std::fs::symlink_metadata(&p).map_err(|_| format!("no note: {name}"))?;
    if !m.is_file() {
        return Err(format!("not a note: {name}"));
    }
    Ok(p)
}

/// md → (첫 줄, 둘째 줄) — 제목·목록 기호를 뗀다. 목록 칸이 넘치지 않게 80자까지
pub fn title_preview(md: &str) -> (String, String) {
    let clean = |l: &str| -> String {
        let t = l.trim().trim_start_matches('#').trim_start();
        let t = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")).unwrap_or(t);
        t.trim().chars().take(80).collect()
    };
    let mut it = md.lines().map(clean).filter(|l| !l.is_empty());
    let title = it.next().unwrap_or_default();
    (title, it.next().unwrap_or_default())
}

fn modified_ms(m: &std::fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn row(dir: &Path, name: &str) -> Result<NoteRow, String> {
    let p = note_file(dir, name)?;
    let text = std::fs::read_to_string(&p).unwrap_or_default();
    let (title, preview) = title_preview(&text);
    let at = std::fs::metadata(&p).map(|m| modified_ms(&m)).unwrap_or(0);
    Ok(NoteRow { name: name.into(), path: p.to_string_lossy().into_owned(), title, preview, at, skin: "paper".into(), shown: false, win: false })
}

/// 메모 목록 — 최근에 고친 것부터, 스킨·띄움을 입혀서. 지난 휴지통은 이때 정리
pub fn list_in(dir: &Path, now: u64) -> Result<Vec<NoteRow>, String> {
    let mut rows = list_files(dir, now)?;
    dress(&mut rows, read_meta(dir).as_ref());
    Ok(rows)
}

/// 바로 아래 md 만(휴지통·그림 폴더·메타 빼고). 폴더가 없으면 빈 목록
fn list_files(dir: &Path, now: u64) -> Result<Vec<NoteRow>, String> {
    purge_in(dir, now);
    let rd = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut out: Vec<NoteRow> = rd.flatten().filter_map(|e| row(dir, &e.file_name().to_string_lossy()).ok()).collect();
    out.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| b.name.cmp(&a.name)));
    Ok(out)
}

/// 새 메모 — 띄우고, 마지막에 고른 스킨으로. 맨 위 메모가 비어 있으면 그걸 띄워 돌려준다(+ 를 눌렀다 안 쓰고 또 눌러도 빈 메모가 쌓이지 않게)
pub fn create_in(dir: &Path, now: u64) -> Result<NoteRow, String> {
    let name = make_file(dir, now)?;
    let _g = META_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut m = meta_now(dir, now);
    let skin = skin_of(&m.last_skin);
    let n = m.notes.entry(name.clone()).or_insert_with(|| NoteMeta { skin, ..Default::default() });
    n.shown = true;
    write_meta(dir, &m)?;
    let mut r = vec![row(dir, &name)?];
    dress(&mut r, Some(&m));
    Ok(r.remove(0))
}

fn make_file(dir: &Path, now: u64) -> Result<String, String> {
    if let Some(top) = list_files(dir, now)?.into_iter().next().filter(|r| r.title.is_empty()) {
        return Ok(top.name);
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    for i in 0..1000 {
        let name = format!("note-{}.md", now + i);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(dir.join(&name)) {
            Ok(_) => return Ok(name),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("no free note name".into())
}

pub fn read_in(dir: &Path, name: &str) -> Result<String, String> {
    std::fs::read_to_string(note_file(dir, name)?).map_err(|e| e.to_string())
}

/// 저장 — base(알던 글)가 지금 파일과 다르면 CHANGED_OUTSIDE 로 안 쓴다(맥에서 고친 줄을 폰이 덮지 않게). keep = 고치기 전 판 남기기
pub fn write_in(dir: &Path, name: &str, text: &str, base: Option<&str>, keep: impl Fn(&Path)) -> Result<NoteRow, String> {
    if text.len() >= crate::locker_fs::MAX_PHONE_MD {
        return Err("too long".into());
    }
    crate::reader::write_checked(&note_file(dir, name)?, text, base, keep)?;
    row(dir, name)
}

/// 휴지통으로 — 이름 앞에 옮긴 시각을 붙인다(수정 시각으로 세면 오래된 메모가 옮기자마자 정리된다)
pub fn trash_in(dir: &Path, name: &str, now: u64) -> Result<(), String> {
    let p = note_file(dir, name)?;
    let bin = dir.join(TRASH);
    std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
    std::fs::rename(p, bin.join(format!("{now}--{name}"))).map_err(|e| e.to_string())
}

/// 30일 지난 휴지통 파일을 지운다. 시각을 못 읽는 이름(사람이 넣은 파일)은 안 건드린다
pub fn purge_in(dir: &Path, now: u64) {
    let Ok(rd) = std::fs::read_dir(dir.join(TRASH)) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(at) = name.split_once("--").and_then(|(t, _)| t.parse::<u64>().ok()) else { continue };
        if now.saturating_sub(at) > KEEP_MS {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// space-log 줄이 내 메모를 고친 기록인가 — 화면이 빼먹어도 여기서 한 번 더 막는다(참모에게 저절로 안 읽힌다, 11-05 사용자)
pub fn is_note_log(line: &str, dir: &Path) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { return false };
    let Some(p) = v["path"].as_str() else { return false };
    let p = Path::new(p);
    let canon = |x: &Path| x.canonicalize().unwrap_or_else(|_| x.to_path_buf());
    p.starts_with(dir) || p.parent().is_some_and(|d| canon(d).starts_with(canon(dir)))
}

/// 메모 폴더 도장(수정 시각 ns) — 폰이 3초마다 받는 세션 목록 머리줄에 실린다(mobile_http /api/sessions). 파일을 훑지 않고 stat 한 번.
/// 메모·메타 저장은 다 바꿔 끼우기(임시 파일 → rename)라 폴더 시각이 바뀐다. 제자리 덮어쓰기(다른 앱이 바로 씀)는 못 본다 — 폰은 다시 열 때 받는다
pub fn stamp_in(dir: &Path) -> Option<String> {
    let t = std::fs::metadata(dir).ok()?.modified().ok()?;
    Some(t.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos().to_string())
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

async fn off_main<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn notes_list() -> Result<Vec<NoteRow>, String> {
    off_main(|| list_in(&dir(), now_ms())).await
}

#[tauri::command]
pub async fn notes_new() -> Result<NoteRow, String> {
    off_main(|| create_in(&dir(), now_ms())).await
}

#[tauri::command]
pub async fn notes_meta(name: String, patch: MetaPatch) -> Result<NoteRow, String> {
    off_main(move || meta_in(&dir(), &name, &patch)).await
}

#[tauri::command]
pub async fn notes_trash(name: String) -> Result<(), String> {
    off_main(move || trash_in(&dir(), &name, now_ms())).await
}

/// 파인더에서 보기
#[tauri::command]
pub async fn notes_reveal(name: String) -> Result<(), String> {
    off_main(move || crate::platform::reveal(&note_file(&dir(), &name)?).map_err(|e| e.to_string())).await
}

#[cfg(test)]
#[path = "notes_tests.rs"]
mod tests;
