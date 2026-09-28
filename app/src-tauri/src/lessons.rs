//! 프로젝트 교훈 — <데이터 폴더>/lessons/<프로젝트>.md (scripts/task lesson 이 쓰는 곳). 형식·편집은 프론트 domain/lessons.ts.
//! 여기선 파일 읽고 쓰기와, 지운 교훈을 프로젝트 CLAUDE.local.md 의 복사본에서도 빼는 것만

use std::collections::HashMap;
use std::path::PathBuf;

fn lessons_dir() -> PathBuf {
    crate::config::data_dir().join("lessons")
}

fn lesson_path(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains('/') || name.contains("..") {
        return Err(if crate::i18n::is_en() { format!("Invalid project name: {name}") } else { format!("프로젝트 이름이 이상해: {name}") });
    }
    Ok(lessons_dir().join(format!("{name}.md")))
}

/// 여러 이름을 한 번에(_common 포함). 없는 파일은 빈 문자열
#[tauri::command]
pub fn read_lessons(names: Vec<String>) -> HashMap<String, String> {
    names
        .into_iter()
        .filter_map(|n| {
            let p = lesson_path(&n).ok()?;
            Some((n, std::fs::read_to_string(p).unwrap_or_default()))
        })
        .collect()
}

/// 통째로 다시 쓴다 — 임시 파일에 쓰고 옮겨서 task send 가 반쯤 쓴 파일을 읽지 않게
#[tauri::command]
pub fn write_lessons(name: String, content: String) -> Result<(), String> {
    let path = lesson_path(&name)?;
    std::fs::create_dir_all(lessons_dir()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("md.tmp");
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// `## 교훈`(또는 `## Lessons`) 칸 안의 `- <교훈>` 줄 하나를 뺀 글. 없으면 None.
/// 칸 밖(계정·키·미룬 할 일)은 같은 줄이 있어도 건드리지 않는다 — 이 파일은 gitignore 라 되돌릴 길이 없다
fn without_line(body: &str, lesson: &str) -> Option<String> {
    let target = format!("- {lesson}");
    let lines: Vec<&str> = body.split('\n').collect();
    let start = lines.iter().position(|l| l.starts_with("## 교훈") || l.starts_with("## Lessons"))?;
    let end = lines.iter().skip(start + 1).position(|l| l.starts_with("## ")).map_or(lines.len(), |k| start + 1 + k);
    let i = (start + 1..end).find(|&k| lines[k].trim_end() == target)?;
    let mut out = lines;
    out.remove(i);
    Some(out.join("\n"))
}

/// 교훈을 지우면 task lesson 이 복사해 둔 <devRoot>/<프로젝트>/CLAUDE.local.md 의 같은 줄도 뺀다(정확히 같은 줄만).
/// 못 찾으면 조용히 넘어간다 — 사람이 고쳐 쓴 줄은 건드리지 않는다
#[tauri::command]
pub fn unmirror_lesson(project: String, lesson: String) -> Result<bool, String> {
    lesson_path(&project)?;
    let cfg = crate::config::current();
    let root = PathBuf::from(crate::config::expand(&crate::config::home(), &cfg.dev_root)).join(&project);
    let path = root.join("CLAUDE.local.md");
    let Ok(body) = std::fs::read_to_string(&path) else { return Ok(false) };
    match without_line(&body, &lesson) {
        Some(next) => std::fs::write(&path, next).map(|_| true).map_err(|e| e.to_string()),
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 같은_줄만_뺀다() {
        let body = "# 계정\n- a\n\n## 교훈\n- 하나\n- 둘\n";
        assert_eq!(without_line(body, "하나").as_deref(), Some("# 계정\n- a\n\n## 교훈\n- 둘\n"));
        assert_eq!(without_line(body, "하"), None);
    }

    #[test]
    fn 교훈_칸_밖의_같은_줄은_안_건드린다() {
        // 계정 칸에 우연히 같은 줄이 먼저 있어도 그건 남기고 교훈 칸 것만 뺀다(2026-09-29 검증 에이전트)
        let body = "# 계정\n- 하나\n\n## 교훈 (확인된 것)\n- 하나\n\n## 미룬 할 일\n- 하나\n";
        assert_eq!(without_line(body, "하나").as_deref(), Some("# 계정\n- 하나\n\n## 교훈 (확인된 것)\n\n## 미룬 할 일\n- 하나\n"));
        assert_eq!(without_line("# 계정\n- 하나\n", "하나"), None);
        assert_eq!(without_line("## Lessons\n- one\n", "one").as_deref(), Some("## Lessons\n"));
    }

    #[test]
    fn 이상한_이름은_막는다() {
        assert!(lesson_path("../x").is_err());
        assert!(lesson_path("a/b").is_err());
        assert!(lesson_path("_common").is_ok());
    }
}
