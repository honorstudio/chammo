//! 프로젝트 교훈 — <데이터 폴더>/lessons/<프로젝트>.md (scripts/task lesson 이 쓰는 곳). 형식·편집은 프론트 domain/lessons.ts.
//! 여기선 파일 읽고 쓰기와, 지운 교훈을 프로젝트 CLAUDE.local.md 의 복사본에서도 빼는 것만.
//! 참모 창은 프로젝트 교훈 대신 그 참모 기억 칸(<데이터>/memory/orch/<기본 이름>/MEMORY.md)을 같은 길로 읽고 쓴다 — 이름 `orch:<기본 이름>`

use std::collections::HashMap;
use std::path::PathBuf;

fn lessons_dir() -> PathBuf {
    crate::config::data_dir().join("lessons")
}

/// 참모 기억 칸 이름의 머리 — `orch:참모-2`
pub const ORCH: &str = "orch:";

fn lesson_path(name: &str) -> Result<PathBuf, String> {
    let base = name.strip_prefix(ORCH);
    let bare = base.unwrap_or(name);
    if bare.is_empty() || bare.contains('/') || bare.contains('\\') || bare.contains("..") || bare.contains(':') {
        return Err(if crate::i18n::is_en() { format!("Invalid project name: {name}") } else { format!("프로젝트 이름이 이상해: {name}") });
    }
    Ok(match base {
        Some(b) => crate::config::data_dir().join("memory").join("orch").join(b).join("MEMORY.md"),
        None => lessons_dir().join(format!("{name}.md")),
    })
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
/// base = 화면이 고치기 전에 읽은 글 — 그 뒤 task lesson·reply 가 덧붙인 줄은 지우지 않고 뒤에 붙여 둔다. 잠금은 scripts 의 lesson_skill.lessons_lock 과
/// 같은 <데이터>/lessons.lock: 메모 창 지우기·공통으로 올리기가 통째로 쓰는 사이 덧붙인 새 교훈이 사라졌다(2026-10-21 리뷰 ⑥-3)
pub fn write_lessons(name: String, content: String, base: Option<String>) -> Result<(), String> {
    let path = lesson_path(&name)?;
    std::fs::create_dir_all(lessons_dir()).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let _held = crate::mobile_pair::FileLock::take(&lessons_dir().with_extension("lock")).map_err(|e| e.to_string())?;
    let content = match base {
        Some(b) => with_added(&content, &b, &std::fs::read_to_string(&path).unwrap_or_default()),
        None => content,
    };
    let tmp = path.with_extension(format!("md.{}.tmp", std::process::id()));
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 화면이 쓰려는 글(next)을 지금 파일(now)에 맞춘다 — base 를 읽은 뒤 now 에 새로 생긴 교훈 줄은 뒤에 붙이고,
/// 그사이 다른 쪽(lesson-group·drop)이 뺀 줄은 next 에서도 뺀다(안 빼면 스킬로 옮긴 교훈이 되살아나 지시에 두 번 붙었다, 2026-10-22 코드 리뷰)
fn with_added(next: &str, base: &str, now: &str) -> String {
    let has = |t: &str, l: &str| t.split('\n').any(|x| x == l);
    let gone = |l: &str| l.starts_with("- ") && has(base, l) && !has(now, l);
    let added: Vec<&str> = now.split('\n').filter(|l| l.starts_with("- ") && !has(base, l) && !has(next, l)).collect();
    if added.is_empty() && !next.split('\n').any(gone) {
        return next.to_string();
    }
    let mut out = next.split('\n').filter(|l| !gone(l)).collect::<Vec<_>>().join("\n");
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    for l in added {
        out.push_str(l);
        out.push('\n');
    }
    out
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

/// 프로젝트 교훈 거울 자리 — scripts 의 lesson_skill.local_md 와 같은 규칙. HQ 가 곧 그 프로젝트면(앱 저장소에서 참모를 돌리는 맥)
/// 맨 위 CLAUDE.local.md 는 모든 참모 턴에 실리니 .claude/worktrees/ 아래(워크트리 세션은 부모 폴더 것으로 읽는다)
fn local_md(root: &std::path::Path, hq: &str) -> PathBuf {
    let same = !hq.is_empty() && match (std::fs::canonicalize(root), std::fs::canonicalize(hq)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    };
    if same { root.join(".claude").join("worktrees").join("CLAUDE.local.md") } else { root.join("CLAUDE.local.md") }
}

/// 교훈을 지우면 task lesson 이 복사해 둔 <devRoot>/<프로젝트>/CLAUDE.local.md 의 같은 줄도 뺀다(정확히 같은 줄만).
/// 못 찾으면 조용히 넘어간다 — 사람이 고쳐 쓴 줄은 건드리지 않는다
#[tauri::command]
pub fn unmirror_lesson(project: String, lesson: String) -> Result<bool, String> {
    lesson_path(&project)?;
    if project.starts_with(ORCH) {
        return Ok(false);
    }
    let cfg = crate::config::current();
    let home = crate::config::home();
    let root = PathBuf::from(crate::config::expand(&home, &cfg.dev_root)).join(&project);
    let path = local_md(&root, &crate::config::hq_dir(&home, &cfg, |k| std::env::var(k).ok()));
    std::fs::create_dir_all(lessons_dir()).map_err(|e| e.to_string())?;
    // scripts 의 덧붙이기(mirror_lesson)와 같은 잠금 — 읽고 쓰는 사이 덧붙은 교훈이 사라지지 않게(2026-10-22 코드 리뷰)
    let _held = crate::mobile_pair::FileLock::take(&lessons_dir().with_extension("lock")).map_err(|e| e.to_string())?;
    let Ok(body) = std::fs::read_to_string(&path) else { return Ok(false) };
    match without_line(&body, &lesson) {
        Some(next) => std::fs::write(&path, next).map(|_| true).map_err(|e| e.to_string()),
        None => Ok(false),
    }
}

/// 참모 기억 줄 끝의 `<!-- r-xxxx -->` — 알아서 기억(scripts/memory)이 넣은 규칙이면 그 id
pub fn rule_id(line: &str) -> Option<&str> {
    let id = line.trim_end().strip_suffix("-->")?.trim_end().rsplit_once("<!--")?.1.trim();
    (id.len() > 2 && id.starts_with("r-") && id[2..].bytes().all(|b| b.is_ascii_hexdigit())).then_some(id)
}

/// 알아서 기억이 넣은 규칙 줄 지우기 — 줄만 빼면 장부(rules.json)가 살아 있다고 믿으니 `scripts/memory undo <id>` 길로(줄도 거기서 빠진다)
#[tauri::command]
pub async fn undo_memory_rule(id: String) -> Result<(), String> {
    if rule_id(&format!("<!-- {id} -->")) != Some(id.as_str()) {
        return Err(format!("bad rule id: {id}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let hq = crate::config::hq_dir(&crate::config::home(), &crate::config::current(), |k| std::env::var(k).ok());
        let script = std::path::Path::new(&hq).join("scripts").join("memory");
        #[cfg(windows)]
        let mut c = {
            let mut c = crate::platform::python();
            c.arg(&script);
            c
        };
        #[cfg(not(windows))]
        let mut c = crate::platform::command(&script);
        let o = c.arg("undo").arg(&id).output().map_err(|e| e.to_string())?;
        if o.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&o.stderr).trim().to_string()) }
    })
    .await
    .map_err(|e| e.to_string())?
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
    fn 화면이_읽은_뒤_덧붙은_교훈은_남긴다() {
        // 메모 창이 읽고 한 줄을 지워 통째로 쓰는 사이 task reply 가 덧붙인 줄이 사라졌다(2026-10-21 리뷰 ⑥-3)
        let base = "- a\n- b\n";
        let next = "- a\n"; // b 를 지움
        assert_eq!(with_added(next, base, "- a\n- b\n- 새것\n"), "- a\n- 새것\n");
        assert_eq!(with_added(next, base, base), next, "그사이 바뀐 게 없으면 그대로");
        assert_eq!(with_added("- a", base, "- a\n- b\n- c\n"), "- a\n- c\n");
        // 그사이 스크립트가 뺀 줄(b·c 를 스킬로)은 화면이 통째로 써도 안 되살린다
        assert_eq!(with_added("- b\n- c\n", "- a\n- b\n- c\n", "- a\n"), "");
    }

    #[test]
    fn 참모_기억_칸() {
        let p = lesson_path("orch:참모-2").unwrap();
        assert!(p.ends_with("memory/orch/참모-2/MEMORY.md"), "{p:?}");
        assert!(lesson_path("orch:").is_err());
        assert!(lesson_path("orch:../x").is_err());
        assert!(lesson_path("orch:a/b").is_err());
        assert!(lesson_path("orch:orch:x").is_err());
    }

    #[test]
    fn 규칙_id_읽기() {
        assert_eq!(rule_id("한글로 답한다 <!-- r-a41b -->"), Some("r-a41b"));
        assert_eq!(rule_id("[제목](a.md) — 설명"), None);
        assert_eq!(rule_id("x <!-- r-zz -->"), None);
        assert_eq!(rule_id("x <!-- r-12; rm -->"), None);
    }

    #[test]
    fn HQ_가_곧_프로젝트면_워크트리_칸() {
        let d = std::env::temp_dir().join(format!("lessons-hq-{}", std::process::id()));
        let hq = d.join("hq");
        std::fs::create_dir_all(&hq).unwrap();
        assert_eq!(local_md(&hq, hq.to_str().unwrap()), hq.join(".claude/worktrees/CLAUDE.local.md"));
        assert_eq!(local_md(&hq, d.join("other").to_str().unwrap()), hq.join("CLAUDE.local.md"), "공개판 — HQ 따로면 그대로");
        assert_eq!(local_md(&hq, ""), hq.join("CLAUDE.local.md"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 이상한_이름은_막는다() {
        assert!(lesson_path("../x").is_err());
        assert!(lesson_path("a/b").is_err());
        assert!(lesson_path("_common").is_ok());
    }
}
