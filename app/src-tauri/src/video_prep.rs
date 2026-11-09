//! 영상 검토 준비물 — 폰으로 보낼 저용량(low.mp4)과 끄는 동안 보여 줄 그림 묶음(sprite-N.jpg). 기획 docs/plans/2026-11-04-video-curation.md
//! 도우미 tools/chammo-videoprep(Swift)를 build.rs 가 빌드해 실행 파일에 넣는다. 윈도우·빌드 실패면 도우미가 없어 state "none" — 폰은 원본 + LTE 확인.
//! 자리: <데이터>/curation/preview/<지문>/ — 같은 파일이면 다시 안 만든다. 폰은 경로를 안 주고 표(원본)로만 닿는다(mobile_http media_page).
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufRead, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 이보다 작으면 저용량을 안 만들고 원본을 그대로 보낸다 — 폰 LTE 확인 기준(domain/phoneFile askBeforePlay)과 같은 값
pub const LOW_OVER: u64 = 20 * 1024 * 1024;
/// 준비물 전체 상한 — 넘으면 오래된 것부터 지운다
const KEEP_BYTES: u64 = 5 * 1024 * 1024 * 1024;
/// 지문에 넣는 앞뒤 크기
const EDGE: u64 = 1024 * 1024;

#[cfg(target_os = "macos")]
const HELPER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/chammo-videoprep"));
#[cfg(not(target_os = "macos"))]
const HELPER: &[u8] = &[];

/// 판 지문 — 크기 + 고친 시각 + 앞뒤 1MB. 30GB 도 바로 끝난다. 같은 경로에 덮어써도 달라져서 새 판이 된다
pub fn fingerprint(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let meta = f.metadata()?;
    let size = meta.len();
    let mtime = meta.modified().ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
    let mut h = Sha256::new();
    h.update(size.to_le_bytes());
    h.update(mtime.to_le_bytes());
    let mut buf = vec![0u8; EDGE.min(size) as usize];
    f.read_exact(&mut buf)?;
    h.update(&buf);
    if size > EDGE {
        let n = EDGE.min(size - EDGE);
        f.seek(SeekFrom::Start(size - n))?;
        let mut tail = vec![0u8; n as usize];
        f.read_exact(&mut tail)?;
        h.update(&tail);
    }
    Ok(h.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect())
}

/// 지문 캐시 — 폰이 조각마다 부르므로(256KB) 같은 파일(경로·크기·고친 시각)이면 다시 안 읽는다
fn fp_cached(path: &Path) -> std::io::Result<String> {
    static CACHE: Mutex<Option<HashMap<(PathBuf, u64, u128), String>>> = Mutex::new(None);
    let meta = std::fs::metadata(path)?;
    let mtime = meta.modified().ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
    let key = (path.to_path_buf(), meta.len(), mtime);
    let mut g = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let map = g.get_or_insert_with(HashMap::new);
    if let Some(v) = map.get(&key) {
        return Ok(v.clone());
    }
    let v = fingerprint(path)?;
    if map.len() > 200 {
        map.clear();
    }
    map.insert(key, v.clone());
    Ok(v)
}

fn root(data: &Path) -> PathBuf {
    data.join("curation").join("preview")
}
pub fn dir_of(data: &Path, fp: &str) -> PathBuf {
    root(data).join(fp)
}

/// 도는 중인 일: 지문 → 진행(0~1)
static JOBS: Mutex<Option<HashMap<String, f64>>> = Mutex::new(None);
fn job_pct(fp: &str) -> Option<f64> {
    JOBS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(fp).copied())
}
fn set_job(fp: &str, v: Option<f64>) {
    let mut g = JOBS.lock().unwrap_or_else(|e| e.into_inner());
    let m = g.get_or_insert_with(HashMap::new);
    match v {
        Some(p) => { m.insert(fp.to_string(), p); }
        None => { m.remove(fp); }
    }
}

/// 지금 상태 — 폰·데스크톱이 같이 읽는다. state: ready(저용량까지 준비됨) · making(만드는 중) · failed · none(이 기기엔 도우미 없음).
/// low: 저용량 크기(없으면 원본을 그대로 쓰는 영상), sprite·fps·duration 은 준비된 만큼
pub fn view(data: &Path, path: &Path) -> Value {
    let Ok(fp) = fp_cached(path) else { return json!({ "state": "failed" }) };
    let dir = dir_of(data, &fp);
    let info: Value = std::fs::read_to_string(dir.join("meta.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    let low = std::fs::metadata(dir.join("low.mp4")).ok().map(|m| m.len());
    let done = dir.join("done").exists();
    let state = if done { "ready" } else if dir.join("failed").exists() { "failed" } else if job_pct(&fp).is_some() { "making" } else if HELPER.is_empty() { "none" } else { "idle" };
    let big = std::fs::metadata(path).map_or(true, |m| needs_low(path, m.len()));
    json!({ "state": state, "pct": job_pct(&fp).unwrap_or(if done { 1.0 } else { 0.0 }), "low": low, "needsLow": big, "fps": info["fps"], "duration": info["duration"], "sprite": info["sprite"] })
}

/// 준비된 저용량 자리 — 만드는 중·반쪽이면 None(이름이 low.mp4 가 된 뒤에만 있다)
pub fn low_path(data: &Path, path: &Path) -> Option<PathBuf> {
    let p = dir_of(data, &fp_cached(path).ok()?).join("low.mp4");
    p.is_file().then_some(p)
}

/// 그림 묶음 한 장 — 번호만 받으니 폴더 밖으로 못 나간다
pub fn sprite_path(data: &Path, path: &Path, i: u32) -> Option<PathBuf> {
    let p = dir_of(data, &fp_cached(path).ok()?).join(format!("sprite-{i}.jpg"));
    p.is_file().then_some(p)
}

/// 줄 하나 읽기 — 도우미 표준 출력(JSON 한 줄). 진행·정보·끝·오류
#[derive(Debug, PartialEq)]
pub enum Line {
    Pct(f64),
    Info(Value),
    Done,
    Error(String),
    Other,
}
pub fn parse_line(s: &str) -> Line {
    let Ok(v) = serde_json::from_str::<Value>(s) else { return Line::Other };
    if let Some(p) = v["p"].as_f64() {
        return Line::Pct(p.clamp(0.0, 1.0));
    }
    if v["info"].is_object() {
        return Line::Info(v["info"].clone());
    }
    if v["done"].as_bool() == Some(true) {
        return Line::Done;
    }
    v["error"].as_str().map_or(Line::Other, |e| Line::Error(e.to_string()))
}

/// 원본을 그대로 보낼 만한 영상인가 — 작고 폰이 트는 그릇. .mov 는 코덱이 여러 가지라 늘 줄인다
pub fn needs_low(path: &Path, size: u64) -> bool {
    size > LOW_OVER || !path.extension().and_then(|e| e.to_str()).is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "mp4" | "m4v"))
}

/// 만들기 시작 — 벌써 있거나 도는 중이면 그대로. 한 번에 하나만(저우선이어도 무겁다), 나머지는 뒤에서 기다린다
pub fn start(data: &Path, path: &Path) {
    if HELPER.is_empty() || cfg!(test) {
        return;
    }
    let Ok(fp) = fp_cached(path) else { return };
    let dir = dir_of(data, &fp);
    if dir.join("done").exists() || dir.join("failed").exists() || job_pct(&fp).is_some() {
        return;
    }
    set_job(&fp, Some(0.0));
    let (data, path) = (data.to_path_buf(), path.to_path_buf());
    std::thread::spawn(move || {
        static ONE: Mutex<()> = Mutex::new(());
        let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
        let r = run(&data, &path, &fp);
        set_job(&fp, None);
        if let Err(e) = r {
            let _ = std::fs::write(dir_of(&data, &fp).join("failed"), &e);
            crate::claude::log_out("video-prep", &format!("실패 {fp}: {e}"));
        }
        prune(&root(&data), KEEP_BYTES);
    });
}

fn run(data: &Path, path: &Path, fp: &str) -> Result<(), String> {
    let exe = data.join("tools").join("chammo-videoprep");
    crate::vdisplay::install_exe(&exe, HELPER).map_err(|e| e.to_string())?;
    let dir = dir_of(data, fp);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    let mut c = crate::platform::command(&exe);
    c.arg(path).arg(&dir).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
    if !needs_low(path, size) {
        c.arg("--no-low");
    }
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    let out = child.stdout.take().ok_or("no stdout")?;
    let mut ended = false;
    let mut why = String::new();
    for line in std::io::BufReader::new(out).lines().map_while(Result::ok) {
        match parse_line(&line) {
            Line::Pct(p) => set_job(fp, Some(p)),
            Line::Info(v) => {
                let tmp = dir.join("meta.part");
                std::fs::write(&tmp, v.to_string()).map_err(|e| e.to_string())?;
                std::fs::rename(&tmp, dir.join("meta.json")).map_err(|e| e.to_string())?;
            }
            Line::Done => ended = true,
            Line::Error(e) => why = e,
            Line::Other => {}
        }
    }
    let st = child.wait().map_err(|e| e.to_string())?;
    if !st.success() || !ended {
        return Err(if why.is_empty() { format!("exit {:?}", st.code()) } else { why });
    }
    std::fs::write(dir.join("done"), "").map_err(|e| e.to_string())
}

/// 상한을 넘으면 가장 오래 안 고친 폴더부터 지운다 — 도는 일 폴더는 건드리지 않는다
pub fn prune(root: &Path, keep: u64) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    let mut dirs: Vec<(std::time::SystemTime, u64, PathBuf)> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter(|e| job_pct(&e.file_name().to_string_lossy()).is_none())
        .map(|e| {
            let size: u64 = std::fs::read_dir(e.path()).map(|r| r.flatten().filter_map(|f| f.metadata().ok()).map(|m| m.len()).sum()).unwrap_or(0);
            let at = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
            (at, size, e.path())
        })
        .collect();
    let mut total: u64 = dirs.iter().map(|d| d.1).sum();
    dirs.sort_by_key(|d| d.0);
    for (_, size, p) in dirs {
        if total <= keep {
            break;
        }
        if std::fs::remove_dir_all(&p).is_ok() {
            total -= size;
        }
    }
}

/// 데스크톱 화면이 부른다 — 준비 시작 + 지금 상태. 기록 파일 자리도 같이(참모에게 보내는 글에 적는다)
#[tauri::command]
pub fn video_review_prep(path: String) -> Value {
    let data = crate::config::data_dir();
    let p = Path::new(&path);
    start(&data, p);
    let mut v = view(&data, p);
    v["record"] = json!(crate::reader::curation_state_path(&path).to_string_lossy());
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("vprep-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn fingerprint_changes_with_content_size_and_stays_same_otherwise() {
        let d = tmp("fp");
        let a = d.join("a.mp4");
        std::fs::write(&a, vec![1u8; 3000]).unwrap();
        let f1 = fingerprint(&a).unwrap();
        assert_eq!(f1, fingerprint(&a).unwrap());
        assert_eq!(f1.len(), 16);
        std::fs::write(&a, vec![2u8; 3000]).unwrap();
        assert_ne!(f1, fingerprint(&a).unwrap(), "덮어쓰면 새 판");
        assert!(fingerprint(&d.join("없음.mp4")).is_err());
    }

    #[test]
    fn fingerprint_reads_both_ends_of_big_file() {
        let d = tmp("edge");
        let a = d.join("big.mp4");
        std::fs::write(&a, vec![0u8; (EDGE * 3) as usize]).unwrap();
        let t = std::fs::metadata(&a).unwrap().modified().unwrap();
        let f1 = fingerprint(&a).unwrap();
        let mut body = vec![0u8; (EDGE * 3) as usize];
        *body.last_mut().unwrap() = 9;
        std::fs::write(&a, body).unwrap();
        std::fs::File::options().write(true).open(&a).unwrap().set_modified(t).unwrap();
        assert_ne!(f1, fingerprint(&a).unwrap(), "크기·시각이 같아도 끝이 다르면 다른 판");
    }

    #[test]
    fn view_reports_prepared_state_and_only_finished_low() {
        let d = tmp("view");
        let a = d.join("a.mp4");
        std::fs::write(&a, vec![1u8; 3000]).unwrap();
        let data = d.join("data");
        assert!(low_path(&data, &a).is_none());
        let dir = dir_of(&data, &fingerprint(&a).unwrap());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("low.part.mp4"), b"half").unwrap();
        assert!(low_path(&data, &a).is_none(), "반쪽 파일은 안 낸다");
        std::fs::write(dir.join("meta.json"), r#"{"fps":30,"duration":180,"sprite":{"interval":2}}"#).unwrap();
        std::fs::write(dir.join("low.mp4"), b"lowlow").unwrap();
        std::fs::write(dir.join("done"), "").unwrap();
        let v = view(&data, &a);
        assert_eq!(v["state"], "ready");
        assert_eq!(v["low"], 6);
        assert_eq!(v["fps"], 30);
        assert_eq!(v["sprite"]["interval"], 2);
        assert!(low_path(&data, &a).is_some());
    }

    #[test]
    fn failed_mark_stops_retry_state() {
        let d = tmp("fail");
        let a = d.join("a.mp4");
        std::fs::write(&a, vec![1u8; 10]).unwrap();
        let data = d.join("data");
        let dir = dir_of(&data, &fingerprint(&a).unwrap());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("failed"), "no video track").unwrap();
        assert_eq!(view(&data, &a)["state"], "failed");
    }

    #[test]
    fn sprite_path_is_only_inside_its_folder() {
        let d = tmp("sprite");
        let a = d.join("a.mp4");
        std::fs::write(&a, vec![1u8; 10]).unwrap();
        let data = d.join("data");
        let dir = dir_of(&data, &fingerprint(&a).unwrap());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("sprite-0.jpg"), b"j").unwrap();
        assert_eq!(sprite_path(&data, &a, 0).unwrap(), dir.join("sprite-0.jpg"));
        assert!(sprite_path(&data, &a, 1).is_none());
    }

    #[test]
    fn parses_helper_lines() {
        assert_eq!(parse_line(r#"{"p":0.4}"#), Line::Pct(0.4));
        assert_eq!(parse_line(r#"{"p":7}"#), Line::Pct(1.0));
        assert_eq!(parse_line(r#"{"done":true}"#), Line::Done);
        assert_eq!(parse_line(r#"{"error":"no video track"}"#), Line::Error("no video track".into()));
        assert!(matches!(parse_line(r#"{"info":{"fps":30}}"#), Line::Info(_)));
        assert_eq!(parse_line("글자"), Line::Other);
        assert_eq!(parse_line(r#"{"x":1}"#), Line::Other);
    }

    #[test]
    fn small_mp4_goes_as_is_big_or_mov_gets_low() {
        assert!(!needs_low(Path::new("/a/v.mp4"), LOW_OVER));
        assert!(needs_low(Path::new("/a/v.mp4"), LOW_OVER + 1));
        assert!(needs_low(Path::new("/a/v.mov"), 100));
        assert!(!needs_low(Path::new("/a/V.M4V"), 100));
    }

    #[test]
    fn prune_removes_oldest_until_under_limit() {
        let d = tmp("prune");
        for (i, n) in ["old", "mid", "new"].iter().enumerate() {
            let p = d.join(n);
            std::fs::create_dir_all(&p).unwrap();
            std::fs::write(p.join("low.mp4"), vec![0u8; 100]).unwrap();
            let t = std::time::SystemTime::now() - std::time::Duration::from_secs(1000 - i as u64 * 100);
            std::fs::File::open(&p).unwrap().set_modified(t).unwrap();
        }
        prune(&d, 150);
        assert!(!d.join("old").exists());
        assert!(!d.join("mid").exists());
        assert!(d.join("new").exists());
    }
}
