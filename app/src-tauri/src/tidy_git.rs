//! 세션 자동 정리(domain/autoTidy)가 끄기 전에 보는 세션 폴더 git — 커밋 안 한 변경, 기본 가지(main)에 안 들어간 커밋.
//! 둘 중 하나라도 있으면 그 세션은 정리 대상에서 빠진다. git 이 아닌 폴더는 둘 다 false(지킬 게 없다)
//! 가지·짧은 해시·커밋 안 한 변경 수는 [앱] 줄의 '어디까지 했나'(domain/progressHint) — git 이 아니면 빈 글·0

use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TidyGit {
    pub dir: String,
    pub dirty: bool,
    pub unmerged: bool,
    pub branch: String,
    pub sha: String,
    pub changed: u32,
}

/// 기본 가지 — 로컬 main → master → origin/HEAD 가 가리키는 것. 못 찾으면 None(그럼 '안 들어간 커밋'을 못 잰다 → unmerged 로 본다)
fn base_branch(dir: &Path) -> Option<String> {
    let git = crate::claude::git;
    for b in ["main", "master"] {
        if !git(dir, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{b}")]).is_empty() {
            return Some(b.to_string());
        }
    }
    let r = git(dir, &["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    (!r.is_empty()).then_some(r)
}

pub fn check(dir: &Path) -> TidyGit {
    let git = crate::claude::git;
    let d = dir.to_string_lossy().to_string();
    // 워크트리는 .git 이 파일이라 exists 로 본다 — 안쪽 하위 폴더도 git 저장소면 rev-parse 가 답한다
    if git(dir, &["rev-parse", "--is-inside-work-tree"]) != "true" {
        return TidyGit { dir: d, dirty: false, unmerged: false, branch: String::new(), sha: String::new(), changed: 0 };
    }
    let porcelain = git(dir, &["status", "--porcelain", "--untracked-files=normal"]);
    let changed = porcelain.lines().filter(|l| !l.trim().is_empty()).count() as u32;
    let dirty = changed > 0;
    let head = git(dir, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let unmerged = match base_branch(dir) {
        Some(b) if head == b || head == b.trim_start_matches("origin/") => false,
        // 로컬 main 이 뒤처져 있어도 origin 쪽에 들어갔으면 머지된 것 — 둘 중 하나라도 HEAD 를 품으면 된다(스쿼시 머지는 못 잡는다, roadmap 부채)
        Some(b) => {
            let ahead = |r: &str| git(dir, &["rev-list", "--count", &format!("{r}..HEAD")]).parse::<u32>().map(|n| n > 0).unwrap_or(true);
            let remote = format!("origin/{}", b.trim_start_matches("origin/"));
            ahead(&b) && (git(dir, &["rev-parse", "--verify", "--quiet", &remote]).is_empty() || ahead(&remote))
        }
        None => true,
    };
    let sha = git(dir, &["rev-parse", "--short", "HEAD"]);
    TidyGit { dir: d, dirty, unmerged, branch: head, sha, changed }
}

#[tauri::command]
pub async fn tidy_git(dirs: Vec<String>) -> Vec<TidyGit> {
    tauri::async_runtime::spawn_blocking(move || crate::claude::par_map(&dirs, 4, |d| check(Path::new(d))))
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sh(dir: &Path, args: &[&str]) {
        let ok = crate::platform::command("git").arg("-C").arg(dir).args(args).env("GIT_AUTHOR_NAME", "t").env("GIT_AUTHOR_EMAIL", "t@t").env("GIT_COMMITTER_NAME", "t").env("GIT_COMMITTER_EMAIL", "t@t").output().unwrap();
        assert!(ok.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&ok.stderr));
    }

    #[test]
    fn 변경_가지_판정() {
        let root = std::env::temp_dir().join(format!("chammo-tidy-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        // git 이 아닌 폴더 — 지킬 게 없다
        assert_eq!(check(&root), TidyGit { dir: root.to_string_lossy().into(), dirty: false, unmerged: false, branch: String::new(), sha: String::new(), changed: 0 });
        sh(&root, &["init", "-q", "-b", "main"]);
        std::fs::write(root.join("a.txt"), "a").unwrap();
        sh(&root, &["add", "."]);
        sh(&root, &["commit", "-qm", "a"]);
        let c = check(&root);
        assert!(!c.dirty && !c.unmerged, "main 깨끗함: {c:?}");
        assert_eq!((c.branch.as_str(), c.sha.len() >= 7, c.changed), ("main", true, 0), "가지@짧은 해시: {c:?}");
        std::fs::write(root.join("b.txt"), "b").unwrap();
        std::fs::write(root.join("c.txt"), "c").unwrap();
        let c = check(&root);
        assert!(c.dirty && c.changed == 2, "새 파일 둘 = 커밋 안 한 변경 2: {c:?}");
        std::fs::remove_file(root.join("c.txt")).unwrap();
        sh(&root, &["checkout", "-qb", "feature/x"]);
        sh(&root, &["add", "."]);
        sh(&root, &["commit", "-qm", "b"]);
        let c = check(&root);
        assert!(!c.dirty && c.unmerged, "main 에 안 들어간 커밋: {c:?}");
        sh(&root, &["checkout", "-q", "main"]);
        sh(&root, &["merge", "-q", "feature/x"]);
        sh(&root, &["checkout", "-q", "feature/x"]);
        assert!(!check(&root).unmerged, "머지한 뒤엔 안 걸린다");
        let _ = std::fs::remove_dir_all(&root);
    }
}
