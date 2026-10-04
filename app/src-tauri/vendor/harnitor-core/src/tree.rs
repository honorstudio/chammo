//! 프로젝트의 폴더 구조 — **하네스가 코드의 어디에 닿아 있는지** 보기 위한 것.
//!
//! 파일 탐색기를 하나 더 만들려는 게 아니다. Finder 는 이미 있다.
//! 여기서 답하려는 질문은 이것이다 — **"이 하네스는 이 코드의 어느 자리에 붙어 있나."**
//! `.claude` 가 어디에 있고, 지침이 어느 층에 놓였고, 스킬이 어느 폴더를 다루는지.
//!
//! ## 폴더만 담는다
//!
//! 실측: 깊이 3까지 파일을 다 세면 project-a 가 1,408개, project-b 가 793개다. 그걸 그리면
//! 구조가 아니라 목록이 된다. **폴더 수는 같은 깊이에서 150~180개** — 그건 읽을 만하고,
//! 아키텍처라고 부를 수 있는 것도 그쪽이다. 파일은 개수만 세어 폴더에 붙인다.
//!
//! ## 안 들어가는 곳
//!
//! `node_modules` 같은 자리는 남의 코드라 아키텍처가 아니고, 무엇보다 크다
//! (project-b 는 그걸 포함하면 10,029개가 된다).

use serde::{Deserialize, Serialize};
use std::path::Path;

/// 들어가지 않는 폴더. **남의 코드거나 만들어진 것**이다 — 둘 다 이 프로젝트의 구조가 아니다.
const SKIP: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "venv",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    "vendor",
    "Pods",
    "coverage",
    ".turbo",
    ".cache",
    ".gradle",
    "DerivedData",
    ".shots",
    ".playwright-mcp",
];

/// 폴더 하나. **파일은 세기만 하고 담지 않는다**(모듈 주석 참조).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderNode {
    pub name: String,
    /// 프로젝트 루트 기준 상대경로. 루트는 빈 문자열이다.
    pub rel: String,
    pub dirs: Vec<FolderNode>,
    /// 이 폴더에 직접 놓인 파일 수(하위 폴더는 안 센다).
    pub files: usize,
    /// 이 폴더에서 하네스가 만져지는 자리. 화면이 여기에 표시를 붙인다.
    pub marks: Vec<Mark>,
    /// 깊이 제한에 걸려 더 안 내려간 폴더가 있나. **잘랐으면 잘랐다고 말한다** —
    /// 조용히 멈추면 그게 전부인 줄 안다.
    pub truncated: bool,
}

/// 이 폴더가 하네스와 만나는 방식.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mark {
    /// `.claude/` — 하네스가 사는 자리
    ClaudeDir,
    /// `CLAUDE.md` 가 있다 (지침)
    Guide,
    /// `CLAUDE.local.md` 가 있다 — **내용은 읽지 않는다**(절대원칙 2)
    LocalGuide,
    /// `.mcp.json` 이 있다
    Mcp,
    /// 스킬 폴더 (`SKILL.md` 가 있다)
    Skill,
    /// 훅 스크립트가 놓인 자리
    Hooks,
}

/// 폴더 구조를 읽는다. `depth` 는 루트 아래로 몇 겹까지 내려갈지.
///
/// **부분 실패로 죽지 않는다**(절대원칙 9) — 못 읽는 폴더는 건너뛰고 나머지를 담는다.
pub fn scan_tree(root: &Path, depth: usize) -> FolderNode {
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned());
    walk(root, &name, "", depth)
}

fn walk(dir: &Path, name: &str, rel: &str, left: usize) -> FolderNode {
    let mut node = FolderNode {
        name: name.to_string(),
        rel: rel.to_string(),
        dirs: vec![],
        files: 0,
        marks: marks_of(dir),
        truncated: false,
    };
    let Ok(rd) = std::fs::read_dir(dir) else {
        return node;
    };
    let mut kids: Vec<(String, std::path::PathBuf)> = vec![];
    for e in rd.flatten() {
        let n = e.file_name().to_string_lossy().into_owned();
        // `file_type` 은 심링크를 따라가지 않는다. 링크가 가리키는 곳까지 파고들면
        // 같은 트리를 두 번 그리거나 밖으로 빠져나간다.
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            if SKIP.contains(&n.as_str()) {
                continue;
            }
            kids.push((n, e.path()));
        } else {
            node.files += 1;
        }
    }
    if left == 0 {
        node.truncated = !kids.is_empty();
        return node;
    }
    kids.sort_by(|a, b| a.0.cmp(&b.0));
    for (n, p) in kids {
        let child_rel = if rel.is_empty() {
            n.clone()
        } else {
            format!("{rel}/{n}")
        };
        node.dirs.push(walk(&p, &n, &child_rel, left - 1));
    }
    node
}

fn marks_of(dir: &Path) -> Vec<Mark> {
    let mut m = vec![];
    let has = |n: &str| dir.join(n).exists();
    if dir.file_name().map(|n| n == ".claude").unwrap_or(false) {
        m.push(Mark::ClaudeDir);
    }
    if dir.file_name().map(|n| n == "hooks").unwrap_or(false)
        && dir
            .parent()
            .map(|p| p.ends_with(".claude"))
            .unwrap_or(false)
    {
        m.push(Mark::Hooks);
    }
    if has("SKILL.md") {
        m.push(Mark::Skill);
    }
    if has("CLAUDE.md") {
        m.push(Mark::Guide);
    }
    // 있다는 것만 본다. 여는 일은 없다 — 계정과 키를 담으라고 만든 자리다.
    if has("CLAUDE.local.md") {
        m.push(Mark::LocalGuide);
    }
    if has(".mcp.json") {
        m.push(Mark::Mcp);
    }
    m
}

/// 폴더 개수. 화면이 "너무 큰가"를 먼저 물어볼 수 있게 한다.
pub fn count_dirs(n: &FolderNode) -> usize {
    1 + n.dirs.iter().map(count_dirs).sum::<usize>()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find<'a>(n: &'a FolderNode, rel: &str) -> Option<&'a FolderNode> {
        if n.rel == rel {
            return Some(n);
        }
        n.dirs.iter().find_map(|d| find(d, rel))
    }

    #[test]
    fn 남의_코드와_만들어진_것은_들어가지_않는다() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        for d in ["src", "node_modules", "target", ".git", "dist"] {
            std::fs::create_dir_all(r.join(d)).unwrap();
        }
        let tree = scan_tree(r, 3);
        let names: Vec<&str> = tree.dirs.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, vec!["src"], "걸러야 할 폴더가 들어왔다: {names:?}");
    }

    #[test]
    fn 파일은_담지_않고_세기만_한다() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        std::fs::create_dir_all(r.join("src")).unwrap();
        for f in ["a.rs", "b.rs", "c.rs"] {
            std::fs::write(r.join("src").join(f), "").unwrap();
        }
        let tree = scan_tree(r, 3);
        let src = find(&tree, "src").unwrap();
        assert_eq!(src.files, 3);
        assert!(src.dirs.is_empty());
    }

    #[test]
    fn 하네스가_닿은_자리를_표시한다() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        std::fs::create_dir_all(r.join(".claude/skills/alpha")).unwrap();
        std::fs::create_dir_all(r.join(".claude/hooks")).unwrap();
        std::fs::write(r.join("CLAUDE.md"), "# guide").unwrap();
        std::fs::write(r.join("CLAUDE.local.md"), "SECRET=sk-FAKE-nope").unwrap();
        std::fs::write(r.join(".mcp.json"), "{}").unwrap();
        std::fs::write(
            r.join(".claude/skills/alpha/SKILL.md"),
            "---\nname: alpha\n---\n",
        )
        .unwrap();

        let tree = scan_tree(r, 4);
        assert!(tree.marks.contains(&Mark::Guide), "지침을 못 봤다");
        assert!(
            tree.marks.contains(&Mark::LocalGuide),
            "로컬 지침을 못 봤다"
        );
        assert!(tree.marks.contains(&Mark::Mcp), "MCP 선언을 못 봤다");
        assert!(find(&tree, ".claude")
            .unwrap()
            .marks
            .contains(&Mark::ClaudeDir));
        assert!(find(&tree, ".claude/hooks")
            .unwrap()
            .marks
            .contains(&Mark::Hooks));
        assert!(find(&tree, ".claude/skills/alpha")
            .unwrap()
            .marks
            .contains(&Mark::Skill));
    }

    /// 깊이에서 멈출 때 **멈췄다고 말한다.** 조용히 자르면 그게 전부인 줄 안다.
    #[test]
    fn 깊이에서_자르면_잘랐다고_말한다() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        std::fs::create_dir_all(r.join("a/b/c/d")).unwrap();
        let tree = scan_tree(r, 2);
        let b = find(&tree, "a/b").unwrap();
        assert!(b.truncated, "더 있는데 잘랐다는 표시가 없다");
        assert!(b.dirs.is_empty());
        // 끝까지 담기면 자른 게 아니다
        let full = scan_tree(r, 9);
        assert!(!find(&full, "a/b").unwrap().truncated);
        assert!(find(&full, "a/b/c/d").is_some());
    }

    #[test]
    fn 못_읽는_폴더가_있어도_나머지를_담는다() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        std::fs::create_dir_all(r.join("ok")).unwrap();
        let tree = scan_tree(&r.join("nope-not-here"), 3);
        assert!(tree.dirs.is_empty(), "없는 폴더인데 뭔가 담겼다");
        // 진짜 트리는 멀쩡하다
        assert_eq!(scan_tree(r, 3).dirs.len(), 1);
    }
}
