//! 세션 메모 — 설정의 memoDir(기본 <데이터 폴더>/memo)의 <프로젝트>.md 를 읽고 쓴다(iTerm HOLO MEMO 와 같은 형식).
//! 형식 파싱·항목 만들기는 프론트 domain/memo.ts. 여기선 파일만
use std::collections::HashMap;
use std::io::Write;

fn memo_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(crate::config::expand(&crate::config::home(), &crate::config::current().memo_dir))
}

fn memo_path(name: &str) -> Result<std::path::PathBuf, String> {
    if name.is_empty() || name.contains('/') || name.contains("..") {
        return Err(if crate::i18n::is_en() { format!("Invalid note name: {name}") } else { format!("메모 이름이 이상해: {name}") });
    }
    Ok(memo_dir().join(format!("{name}.md")))
}

/// 여러 프로젝트 메모를 한 번에. 없는 파일은 빈 문자열
#[tauri::command]
pub fn read_memos(names: Vec<String>) -> HashMap<String, String> {
    names
        .into_iter()
        .filter_map(|n| {
            let p = memo_path(&n).ok()?;
            Some((n, std::fs::read_to_string(p).unwrap_or_default()))
        })
        .collect()
}

/// 항목 하나를 파일 끝에 붙인다(파일이 없으면 memo.py 처럼 제목부터). 통째로 다시 쓰지 않아 iTerm memo 가 쓴 줄을 안 지운다
#[tauri::command]
pub fn append_memo(name: String, entry: String) -> Result<(), String> {
    let path = memo_path(&name)?;
    std::fs::create_dir_all(memo_dir()).map_err(|e| e.to_string())?;
    let fresh = !path.exists();
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    if fresh {
        f.write_all(b"# HOLO MEMO\n\n").map_err(|e| e.to_string())?;
    }
    f.write_all(entry.as_bytes()).map_err(|e| e.to_string())
}

/// 파일을 통째로 다시 쓴다(항목 지우기). 쓰는 도중에 읽혀도 안 깨지게 임시 파일에 쓰고 옮긴다
#[tauri::command]
pub fn write_memo(name: String, content: String) -> Result<(), String> {
    let path = memo_path(&name)?;
    let tmp = path.with_extension("md.tmp");
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}
