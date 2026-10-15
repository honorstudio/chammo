//! 옛 파일 보관함(v1, 2026-10-11) — 이름표 기록 <데이터>/locker.jsonl 접기와 카드 첫 줄(peek)만 남았다.
//! v4 부터 보관함은 참모마다 진짜 폴더(locker_fs) — 옛 기록은 locker_fs::migrate 가 이 접기(fold)로 한 번 옮긴다.
//! is_locker_copy 는 옛 복사본(<데이터>/locker/files) 꼴 — 옮기기와 폰 거름이 쓴다
use std::path::{Path, PathBuf};

/// <데이터>/locker/files/<숫자>-<이름> 꼴, 글자 그대로 정규형(./ · // 없음)일 때만 — 폰 거름(shareable)의 데이터 폴더 예외
pub fn is_locker_copy(p: &Path, data_dir: &Path) -> bool {
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let Some((ms, rest)) = name.split_once('-') else { return false };
    p.as_os_str() == p.components().collect::<PathBuf>().as_os_str()
        && p.parent() == Some(data_dir.join("locker").join("files").as_path())
        && !ms.is_empty()
        && ms.bytes().all(|b| b.is_ascii_digit())
        && !rest.is_empty()
        && !rest.starts_with('.')
}

#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub owner: String,
    pub path: String,
    pub copy: bool,
    pub by: String,
    pub ts: String,
    /// 내 폴더 이름 — 없으면 저절로(프로젝트 폴더 등, 화면이 정한다)
    pub folder: Option<String>,
    /// 보관함 안 이름(원본 파일 이름은 그대로)
    pub name: Option<String>,
}

#[derive(Debug, Default, PartialEq)]
pub struct State {
    pub items: Vec<Item>,
    /// (참모, 경로) — show 로 들어온 것까지 가린다
    pub hidden: Vec<(String, String)>,
    /// (참모, 폴더 이름) — 만든 순서
    pub folders: Vec<(String, String)>,
}

/// 기록 줄을 차례로 접는다 — 깨진 줄은 건너뛴다
pub fn fold(log: &str) -> State {
    let mut s = State::default();
    for line in log.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let st = |k: &str| v[k].as_str().unwrap_or("").to_string();
        let (owner, path) = (st("owner"), st("path"));
        let key = |i: &Item| i.owner == owner && i.path == path;
        match v["op"].as_str().unwrap_or("") {
            "add" if !owner.is_empty() && !path.is_empty() => {
                s.hidden.retain(|h| !(h.0 == owner && h.1 == path));
                let folder = v["folder"].as_str().filter(|f| !f.is_empty()).map(str::to_string);
                if let Some(i) = s.items.iter_mut().find(|i| key(i)) {
                    if folder.is_some() {
                        i.folder = folder;
                    }
                } else {
                    s.items.push(Item { owner, path, copy: v["copy"].as_bool().unwrap_or(false), by: st("by"), ts: st("ts"), folder, name: None });
                }
            }
            "move" => {
                if let Some(i) = s.items.iter_mut().find(|i| key(i)) {
                    i.folder = v["folder"].as_str().filter(|f| !f.is_empty()).map(str::to_string);
                }
            }
            "rename" => {
                if let Some(i) = s.items.iter_mut().find(|i| key(i)) {
                    i.name = v["name"].as_str().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string);
                }
            }
            "hide" if !owner.is_empty() && !path.is_empty() => {
                s.items.retain(|i| !key(i));
                if !s.hidden.iter().any(|h| h.0 == owner && h.1 == path) {
                    s.hidden.push((owner, path));
                }
            }
            "folder" => {
                let name = st("name").trim().to_string();
                if !owner.is_empty() && !name.is_empty() && !s.folders.iter().any(|f| f.0 == owner && f.1 == name) {
                    s.folders.push((owner, name));
                }
            }
            "unfolder" => {
                let name = st("name");
                s.folders.retain(|f| !(f.0 == owner && f.1 == name));
                for i in s.items.iter_mut().filter(|i| i.owner == owner && i.folder.as_deref() == Some(name.as_str())) {
                    i.folder = None;
                }
            }
            _ => {}
        }
    }
    s
}

/// 카드에 쓸 첫 줄 — md·글·csv 는 첫 글 줄, xlsx 는 첫 행 칸들, docx·hwpx 는 첫 문단. 못 읽으면 None
pub fn peek(p: &Path) -> Option<String> {
    let ext = p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    let line = match ext.as_str() {
        "xlsx" => peek_xlsx(p),
        "docx" => peek_zip_text(p, |n| n == "word/document.xml", "p"),
        "hwpx" => peek_zip_text(p, |n| n.starts_with("Contents/section") && n.ends_with(".xml"), "p"),
        _ => {
            let mut buf = vec![0u8; 16 * 1024];
            let n = std::io::Read::read(&mut std::fs::File::open(p).ok()?, &mut buf).ok()?;
            let text = String::from_utf8_lossy(&buf[..n]).into_owned();
            let body = if text.starts_with("---") { text.splitn(3, "---").nth(2).unwrap_or("").to_string() } else { text };
            let first = body.lines().map(str::trim).find(|l| !l.is_empty())?.trim_start_matches(['#', '>', '-', '*', ' ']).to_string();
            Some(if ext == "csv" || ext == "tsv" { first.split([',', '\t']).map(str::trim).filter(|c| !c.is_empty()).collect::<Vec<_>>().join(" · ") } else { first })
        }
    }?;
    let line = line.trim();
    (!line.is_empty()).then(|| line.chars().take(80).collect())
}

fn peek_xlsx(p: &Path) -> Option<String> {
    let parts = crate::sheet::unzip(&std::fs::read(p).ok()?).ok()?;
    let first = crate::sheet::sheet_list(&parts).ok()?.into_iter().find(|s| !s.hidden)?;
    let sst = crate::sheet::shared_strings(&parts);
    let cells = crate::sheet::read_cells(crate::sheet::part_str(&parts, &first.part)?, &sst).ok()?;
    let row = cells.iter().filter(|c| c.v.is_some()).map(|c| c.r).min()?;
    let mut cs: Vec<_> = cells.iter().filter(|c| c.r == row).collect();
    cs.sort_by_key(|c| c.c);
    let words: Vec<String> = cs.iter().filter_map(|c| c.v.as_ref()).map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).filter(|s| !s.trim().is_empty()).take(6).collect();
    Some(words.join(" · "))
}

/// zip 안 xml 의 첫 문단 글(<…:p> 안 글자를 모아 비지 않은 첫 것)
fn peek_zip_text(p: &Path, want: impl Fn(&str) -> bool, para: &str) -> Option<String> {
    use quick_xml::events::Event;
    let mut z = zip::ZipArchive::new(std::fs::File::open(p).ok()?).ok()?;
    let mut names: Vec<String> = z.file_names().filter(|n| want(n)).map(str::to_string).collect();
    names.sort();
    let mut xml = String::new();
    std::io::Read::read_to_string(&mut z.by_name(names.first()?).ok()?, &mut xml).ok()?;
    let mut r = quick_xml::reader::Reader::from_str(&xml);
    let mut buf = String::new();
    loop {
        match r.read_event().ok()? {
            Event::End(e) if e.local_name().as_ref() == para => {
                if !buf.trim().is_empty() {
                    return Some(buf.trim().to_string());
                }
                buf.clear();
            }
            Event::Eof => return None,
            ev => crate::sheet::push_text(&mut buf, &ev),
        }
    }
}

// ── 앱 명령 ──

#[tauri::command]
pub fn locker_peek(path: String) -> Option<String> {
    peek(Path::new(&path))
}

#[cfg(test)]
#[path = "locker_tests.rs"]
mod tests;
