//! 홈 밖 파일 — 공개 이슈 #19(윈도우 사용자는 일 파일을 D:\Desktop 에 둔다).
//! 참모 도구(show·locker·sheet)와 앱 미리보기가 여는 곳은 그대로 좁게(홈 + 프로젝트 폴더 + 사람이 설정에서 연 폴더 + 사람이 붙인 사본),
//! 사람이 직접 끌어 놓은·고른·붙여 넣은 파일은 그 밖이면 <데이터>/attach 로 사본을 떠서 그 사본을 쓴다(원본은 그대로).
use std::path::{Path, PathBuf};

/// 사본으로 붙이는 파일 크기 끝 — 보관함이 별칭으로 돌리는 크기(locker_fs::BIG)와 같다. 넘으면 그 폴더를 설정에서 열어 달라고 한다
pub const COPY_MAX: u64 = crate::locker_fs::BIG;

fn real(p: &Path) -> Option<PathBuf> {
    p.canonicalize().ok().map(crate::platform::clean_path)
}

/// 사람이 설정에서 연 폴더들 → 실제로 있는 폴더(링크를 푼 자리). 홈을 품은 폴더(/·/Users·C:\·C:\Users)는 디스크 통째라 안 받는다 —
/// D:\ 같은 다른 드라이브 맨 위는 받는다(사람이 드라이브째 열어 달라는 것). 홈 안 폴더는 이미 열려 있어 뺀다
pub fn open_roots(home: &Path, open: &[String], home_str: &str) -> Vec<PathBuf> {
    let h = real(home).unwrap_or_else(|| home.to_path_buf());
    let mut out: Vec<PathBuf> = Vec::new();
    for c in open {
        if c.trim().is_empty() {
            continue;
        }
        let Some(r) = real(Path::new(&crate::config::expand(home_str, c.trim()))) else { continue };
        if r.is_dir() && !h.starts_with(&r) && !r.starts_with(&h) && !out.contains(&r) {
            out.push(r);
        }
    }
    out
}

/// 사람이 준 파일 하나를 참모·앱이 열 수 있는 경로로 — 이미 열 수 있는 곳(roots)이면 그대로, 밖이면 attach 에 사본.
/// 폴더는 사본을 안 뜬다(그대로 넘긴다 — 참모는 경로로 읽는다). 돌려주는 값 = (쓸 경로, 사본인가)
pub fn give(src: &Path, roots: &[PathBuf], attach: &Path, ms: u128) -> Result<(PathBuf, bool), String> {
    use crate::i18n::tr;
    if !src.is_absolute() {
        return Err(format!("{}: {}", tr("전체 경로가 아니에요", "Not a full path"), src.display()));
    }
    let Some(r) = real(src) else { return Err(format!("{}: {}", tr("파일을 찾지 못했어요", "File not found"), src.display())) };
    if r.is_dir() || openable(&r, roots) {
        return Ok((src.to_path_buf(), false));
    }
    let len = std::fs::metadata(&r).map_err(|e| e.to_string())?.len();
    if len > COPY_MAX {
        return Err(format!(
            "{}: {}",
            tr("500MB 넘는 홈 밖 파일은 사본으로 붙일 수 없어요. 설정 › 참모 › 열어도 되는 폴더에서 그 폴더를 열어 주세요", "Files over 500 MB outside your home folder can't be attached as a copy. Open that folder in Settings › Assistant › Folders it may open"),
            src.display()
        ));
    }
    std::fs::create_dir_all(attach).map_err(|e| e.to_string())?;
    let name = crate::reader::asset_name(&src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), ms);
    let mut dest = attach.join(&name);
    let mut n = 1;
    while std::fs::symlink_metadata(&dest).is_ok() {
        dest = attach.join(format!("{n}-{name}"));
        n += 1;
    }
    crate::locker_fs::copy_verified(&r, &dest).map_err(|e| format!("{}: {e}", tr("사본을 만들지 못했어요", "Couldn't make a copy")))?;
    Ok((dest, true))
}

/// 열 수 있는 곳 안인가 — roots 도 링크를 풀어 비교한다(가짜 HOME 이 /var/… 고 진짜 자리는 /private/var/… 면 홈 안 파일도 사본이 됐다, 리뷰)
fn openable(r: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|x| r.starts_with(x) || real(x).is_some_and(|c| r.starts_with(c)))
}

/// 같은 파일을 또 붙이면 앞 사본을 다시 쓴다(원본 크기·고친 시각이 그대로이고 사본이 남아 있을 때) — 붙일 때마다 사본이 쌓이고 #file 번호가 새로 붙었다
fn give_cached(src: &Path, roots: &[PathBuf], attach: &Path) -> Result<(PathBuf, bool), String> {
    type Seen = std::sync::Mutex<std::collections::HashMap<PathBuf, (u64, Option<std::time::SystemTime>, PathBuf)>>;
    static SEEN: std::sync::OnceLock<Seen> = std::sync::OnceLock::new();
    // 지금 열 수 있는 곳이면(그새 설정에서 폴더를 열었으면) 사본 기억보다 먼저 — 원래 경로 그대로
    if real(src).is_some_and(|r| r.is_dir() || openable(&r, roots)) {
        return give(src, roots, attach, 0);
    }
    let key = std::fs::metadata(src).ok().map(|m| (m.len(), m.modified().ok()));
    let mut map = SEEN.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    if let (Some(k), Some((len, at, copy))) = (key, map.get(src)) {
        if (*len, *at) == k && std::fs::metadata(copy).is_ok_and(|c| c.len() == *len) {
            return Ok((copy.clone(), true));
        }
    }
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let (p, copied) = give(src, roots, attach, ms)?;
    if let (true, Some(k)) = (copied, key) {
        map.insert(src.to_path_buf(), (k.0, k.1, p.clone()));
    }
    Ok((p, copied))
}

/// 채팅·터미널에 끌어 놓은·붙여 넣은 파일 → 쓸 경로들. 한 줄마다 {from, path, copied} 또는 {from, error} — 화면이 실패 이유를 채팅에 보여 준다
#[tauri::command]
pub async fn attach_given(paths: Vec<String>) -> Vec<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let attach = crate::config::data_file("attach");
        let roots = crate::reader::user_roots();
        paths
            .into_iter()
            .map(|p| match give_cached(Path::new(&p), &roots, &attach) {
                Ok((q, copied)) => serde_json::json!({ "from": p, "path": if copied { q.to_string_lossy().into_owned() } else { p.clone() }, "copied": copied }),
                Err(e) => serde_json::json!({ "from": p, "error": e }),
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
#[path = "outside_tests.rs"]
mod tests;
