//! 참모 자동 정리(domain/chiefCompact) — 인계 파일 <데이터>/memory/orch/<참모 기본 이름>/handoff.md 의 자리·고친 시각, 정리 기록 줄(<데이터>/chief-compact.jsonl).
//! 데이터 폴더만 만지지만 메인 스레드에서 파일을 안 건드리게 둘 다 spawn_blocking
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, PartialEq)]
pub struct Handoff {
    pub path: String,
    /// 고친 시각(ms), 없으면 0
    pub mtime: u64,
}

/// 참모 기본 이름이 폴더 이름으로 안전한가 — 경로를 벗어나는 글자는 막는다
fn safe_base(base: &str) -> bool {
    let b = base.trim();
    !b.is_empty() && b == base && !b.contains('/') && !b.contains('\\') && b != "." && b != ".." && !b.contains('\0')
}

pub(crate) fn handoff_in(data: &Path, base: &str) -> Result<Handoff, String> {
    if !safe_base(base) {
        return Err(format!("bad name: {base}"));
    }
    let p: PathBuf = data.join("memory").join("orch").join(base).join("handoff.md");
    let mtime = std::fs::metadata(&p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir); // 참모가 바로 쓸 수 있게
    }
    Ok(Handoff { path: p.to_string_lossy().into_owned(), mtime })
}

/// 프로젝트 세션 정리(domain/projectCompact) — 인계 자리는 그 프로젝트 docs/starter.md. git = 폴더에 .git 이 있나(인계 때 '커밋하지 마')
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHandoff {
    pub path: String,
    pub mtime: u64,
    pub git: bool,
    /// 예비 인계 자리 <데이터>/compact/<세션 id>.md — 백그라운드 세션 격리 가드(worktree.bgIsolation)가 본 폴더 고치기를 막으면 여기에(11-17 실측)
    pub alt: String,
    pub alt_mtime: u64,
}

fn mtime_ms(p: &Path) -> u64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub(crate) fn project_handoff_in(data: &Path, cwd: &Path, id: &str) -> Result<ProjectHandoff, String> {
    if !safe_base(id) {
        return Err(format!("bad id: {id}"));
    }
    if !cwd.is_absolute() || !cwd.is_dir() || cwd.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(format!("bad folder: {}", cwd.display()));
    }
    let p = cwd.join("docs").join("starter.md");
    let alt_dir = data.join("compact");
    let _ = std::fs::create_dir_all(&alt_dir);
    let alt = alt_dir.join(format!("{id}.md"));
    Ok(ProjectHandoff { path: p.to_string_lossy().into_owned(), mtime: mtime_ms(&p), git: cwd.join(".git").exists(), alt: alt.to_string_lossy().into_owned(), alt_mtime: mtime_ms(&alt) })
}

#[tauri::command]
pub async fn project_handoff(cwd: String, id: String) -> Result<ProjectHandoff, String> {
    tauri::async_runtime::spawn_blocking(move || project_handoff_in(crate::config::data_dir(), Path::new(&cwd), &id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn chief_handoff(base: String) -> Result<Handoff, String> {
    tauri::async_runtime::spawn_blocking(move || handoff_in(crate::config::data_dir(), &base)).await.map_err(|e| e.to_string())?
}

pub(crate) fn log_in(data: &Path, line: &str) -> Result<(), String> {
    use std::io::Write;
    let one = line.replace(['\n', '\r'], " ");
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(data.join("chief-compact.jsonl")).map_err(|e| e.to_string())?;
    writeln!(f, "{one}").map_err(|e| e.to_string())
}

/// 정리 한 번의 결과(시작·인계·전후 %) — 한 줄 JSON
#[tauri::command]
pub async fn chief_compact_log(line: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || log_in(crate::config::data_dir(), &line)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-chief-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn handoff_path_and_mtime() {
        let d = tmp("h");
        let h = handoff_in(&d, "참모-2").unwrap();
        assert!(h.path.ends_with("memory/orch/참모-2/handoff.md"));
        assert_eq!(h.mtime, 0);
        std::fs::write(&h.path, "x").unwrap();
        assert!(handoff_in(&d, "참모-2").unwrap().mtime > 0);
    }

    #[test]
    fn refuses_escaping_names() {
        let d = tmp("b");
        for bad in ["", "..", "a/b", "../x", " 참모", "a\\b"] {
            assert!(handoff_in(&d, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn project_starter_path_git_mtime() {
        let d = tmp("p");
        let data = tmp("pd");
        let h = project_handoff_in(&data, &d, "ab12").unwrap();
        assert!(h.path.ends_with("docs/starter.md"));
        assert!(h.alt.ends_with("compact/ab12.md"));
        assert_eq!((h.mtime, h.git, h.alt_mtime), (0, false, 0));
        std::fs::write(&h.alt, "y").unwrap();
        assert!(project_handoff_in(&data, &d, "ab12").unwrap().alt_mtime > 0);
        assert!(project_handoff_in(&data, &d, "../x").is_err());
        std::fs::create_dir_all(d.join("docs")).unwrap();
        std::fs::write(d.join("docs/starter.md"), "x").unwrap();
        std::fs::create_dir_all(d.join(".git")).unwrap();
        let h = project_handoff_in(&data, &d, "ab12").unwrap();
        assert!(h.mtime > 0 && h.git);
        assert!(project_handoff_in(&data, Path::new("rel/dir"), "ab12").is_err());
        assert!(project_handoff_in(&data, &d.join("없음"), "ab12").is_err());
        assert!(project_handoff_in(&data, &d.join("docs/../docs"), "ab12").is_err());
    }

    #[test]
    fn log_one_line() {
        let d = tmp("l");
        log_in(&d, "{\"a\":1}\n").unwrap();
        log_in(&d, "{\"b\":2}").unwrap();
        assert_eq!(std::fs::read_to_string(d.join("chief-compact.jsonl")).unwrap(), "{\"a\":1} \n{\"b\":2}\n");
    }
}
