//! 저장소가 안 바뀌었으면 git 을 다시 안 띄운다 — 오늘 커밋(저장소마다 git log --all)·문서 스캔(저장소마다 3개)이 5분마다 124개를 한꺼번에 띄웠다(11-07, 저장소 31곳).
//! 이 명령들의 답은 refs 에만 달렸다 — 지문 = HEAD·packed-refs·FETCH_HEAD·refs 아래 파일·워크트리 HEAD 의 시각과 크기(프로세스 없이 stat 만).
//! 지문을 못 재면(.git 이 파일인 워크트리 등) 그냥 git 을 부른다. 새 커밋·브랜치·pull·fetch·워크트리 커밋은 다 ref 를 고쳐서 지문이 바뀐다.
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

fn stamp(p: &Path, h: &mut DefaultHasher) {
    if let Ok(m) = std::fs::symlink_metadata(p) {
        m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos()).hash(h);
        m.len().hash(h);
    } else {
        0u8.hash(h);
    }
}

fn walk(dir: &Path, h: &mut DefaultHasher, left: &mut usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut names: Vec<_> = rd.flatten().collect();
    names.sort_by_key(|e| e.file_name());
    for e in names {
        if *left == 0 {
            return;
        }
        *left -= 1;
        let p = e.path();
        p.file_name().hash(h);
        stamp(&p, h);
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            walk(&p, h, left);
        }
    }
}

/// refs 파일을 이만큼 넘게 보면 그만 센다(가지 수천 개) — 그 저장소는 지문이 뒤쪽 변화를 놓칠 수 있어 캐시를 안 쓴다
const MAX_REFS: usize = 5000;

/// 저장소 지문 — `.git` 이 폴더가 아니면 None
pub fn fingerprint(repo: &Path) -> Option<u64> {
    let git = repo.join(".git");
    if !git.is_dir() {
        return None;
    }
    let mut h = DefaultHasher::new();
    for f in ["HEAD", "packed-refs", "FETCH_HEAD", "ORIG_HEAD"] {
        stamp(&git.join(f), &mut h);
    }
    let mut left = MAX_REFS;
    walk(&git.join("refs"), &mut h, &mut left);
    if left == 0 {
        return None;
    }
    // 워크트리 — HEAD 가 detached 면 커밋이 refs 를 안 고친다. 워크트리가 생기거나 없어져도 --all 답이 달라진다
    if let Ok(rd) = std::fs::read_dir(git.join("worktrees")) {
        let mut names: Vec<_> = rd.flatten().map(|e| e.path()).collect();
        names.sort();
        for p in names {
            p.file_name().hash(&mut h);
            stamp(&p.join("HEAD"), &mut h);
        }
    }
    Some(h.finish())
}

/// 저장소들 지문 하나로 — 이게 그대로면 commit_log 답도 그대로다. 하나라도 지문을 못 재면 None
pub fn tag_of(repos: &[(String, PathBuf)]) -> Option<String> {
    let mut h = DefaultHasher::new();
    for (name, dir) in repos {
        name.hash(&mut h);
        fingerprint(dir)?.hash(&mut h);
    }
    Some(format!("{:016x}", h.finish()))
}

/// (저장소, 인자들) → (지문, 답). 오늘 커밋은 하루에 인자 하나, 리플레이는 날짜마다 — 넘치면 비운다(저장소 37곳 × 명령 넷이면 150줄 안팎)
const MAX_ENTRIES: usize = 1000;
type Key = (PathBuf, Vec<String>);
static CACHE: Mutex<Option<HashMap<Key, (u64, String)>>> = Mutex::new(None);

/// 지문이 같으면 지난 답, 아니면 run. 지문은 부르기 전에 잰다 — 부르는 사이 커밋이 들어오면 다음 번에 달라져 다시 부른다.
/// git 을 못 쓰는 동안(명령줄 도구 설치 전)의 빈 답은 남기지 않는다 — 남기면 설치 뒤에도 ref 가 바뀔 때까지 프로젝트가 빈 채로 보인다
pub fn cached(repo: &Path, args: &[&str], run: impl FnOnce() -> String) -> String {
    let tag = if crate::claude::clt_ready() { fingerprint(repo) } else { None };
    cached_in(&CACHE, repo, args, tag, run)
}

/// `.git/config` 지문 — origin 주소는 ref 가 아니라 설정에 달렸다. `.git` 이 폴더가 아니면 None
fn config_tag(repo: &Path) -> Option<u64> {
    let git = repo.join(".git");
    if !git.is_dir() {
        return None;
    }
    let mut h = DefaultHasher::new();
    stamp(&git.join("config"), &mut h);
    Some(h.finish())
}

/// 설정에만 달린 답 — 저장소마다 `git remote get-url` 을 10분에 두 번 띄웠다(11-07 진짜 앱, 묶음 하나에 124개)
pub fn cached_config(repo: &Path, args: &[&str], run: impl FnOnce() -> String) -> String {
    let tag = if crate::claude::clt_ready() { config_tag(repo) } else { None };
    cached_in(&CACHE, repo, args, tag, run)
}

fn cached_in(cache: &Mutex<Option<HashMap<Key, (u64, String)>>>, repo: &Path, args: &[&str], tag: Option<u64>, run: impl FnOnce() -> String) -> String {
    let Some(tag) = tag else { return run() };
    let key: Key = (repo.to_path_buf(), args.iter().map(|a| a.to_string()).collect());
    if let Some((t, v)) = cache.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(&key)) {
        if *t == tag {
            return v.clone();
        }
    }
    let v = run();
    let mut g = cache.lock().unwrap_or_else(|e| e.into_inner());
    let m = g.get_or_insert_with(HashMap::new);
    if m.len() >= MAX_ENTRIES {
        m.clear();
    }
    m.insert(key, (tag, v.clone()));
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-gitcache-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".git/refs/heads")).unwrap();
        std::fs::write(d.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(d.join(".git/refs/heads/main"), "aaaa\n").unwrap();
        d
    }

    fn bump(p: &Path, body: &str) {
        let t = std::fs::metadata(p).map(|m| m.modified().unwrap()).unwrap_or(std::time::SystemTime::now()) + std::time::Duration::from_secs(5);
        std::fs::write(p, body).unwrap();
        std::fs::File::options().write(true).open(p).unwrap().set_modified(t).unwrap();
    }

    #[test]
    fn 저장소들_지문은_어느_하나가_바뀌면_바뀌고_못_재면_없다() {
        let (a, b) = (temp("tag-a"), temp("tag-b"));
        let one = vec![("a".to_string(), a.clone())];
        let two = vec![("a".to_string(), a.clone()), ("b".to_string(), b.clone())];
        let t = tag_of(&two).unwrap();
        assert_eq!(tag_of(&two).unwrap(), t);
        assert_ne!(tag_of(&one).unwrap(), t, "저장소가 늘거나 줄면 다르다");
        bump(&b.join(".git/refs/heads/main"), "bbbb\n");
        assert_ne!(tag_of(&two).unwrap(), t, "하나라도 커밋하면 다르다");
        let w = temp("tag-w");
        std::fs::remove_dir_all(w.join(".git")).unwrap();
        std::fs::write(w.join(".git"), "gitdir: /x\n").unwrap();
        assert_eq!(tag_of(&[("w".to_string(), w)]), None);
    }

    #[test]
    fn 설정_지문은_config_가_바뀔_때만_바뀐다() {
        let d = temp("cfg");
        std::fs::write(d.join(".git/config"), "[remote \"origin\"]\n\turl = a\n").unwrap();
        let a = config_tag(&d).unwrap();
        bump(&d.join(".git/refs/heads/main"), "bbbb\n");
        assert_eq!(config_tag(&d).unwrap(), a, "커밋은 origin 주소와 상관없다");
        bump(&d.join(".git/config"), "[remote \"origin\"]\n\turl = bb\n");
        assert_ne!(config_tag(&d).unwrap(), a, "주소를 바꾸면 다시 부른다");
        let w = temp("cfg-wt");
        std::fs::remove_dir_all(w.join(".git")).unwrap();
        std::fs::write(w.join(".git"), "gitdir: /x\n").unwrap();
        assert_eq!(config_tag(&w), None, "워크트리는 늘 git 을 부른다");
    }

    #[test]
    fn 지문은_ref_가_바뀌면_바뀌고_일_폴더_파일은_상관없다() {
        let d = temp("fp");
        let a = fingerprint(&d).unwrap();
        assert_eq!(fingerprint(&d).unwrap(), a);
        std::fs::write(d.join("code.rs"), "x").unwrap();
        std::fs::write(d.join(".git/index"), "x").unwrap();
        assert_eq!(fingerprint(&d).unwrap(), a, "일 폴더·index 만 바뀌면 답이 그대로라 지문도 그대로");
        bump(&d.join(".git/refs/heads/main"), "bbbb\n");
        let b = fingerprint(&d).unwrap();
        assert_ne!(b, a, "새 커밋");
        std::fs::write(d.join(".git/refs/heads/other"), "cccc\n").unwrap();
        let c = fingerprint(&d).unwrap();
        assert_ne!(c, b, "새 가지");
        std::fs::create_dir_all(d.join(".git/worktrees/wt")).unwrap();
        std::fs::write(d.join(".git/worktrees/wt/HEAD"), "dddd\n").unwrap();
        let e = fingerprint(&d).unwrap();
        assert_ne!(e, c, "새 워크트리");
        bump(&d.join(".git/worktrees/wt/HEAD"), "eeee\n");
        assert_ne!(fingerprint(&d).unwrap(), e, "워크트리 detached 커밋");
        bump(&d.join(".git/packed-refs"), "ffff\n");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn git_폴더가_아니면_지문이_없다() {
        assert_eq!(fingerprint(Path::new("/없는/곳")), None);
    }

    #[test]
    fn 지문이_같으면_다시_안_부르고_바뀌면_부른다() {
        let cache = Mutex::new(None);
        let runs = Cell::new(0);
        let call = |tag: Option<u64>, args: &[&str]| cached_in(&cache, Path::new("/r"), args, tag, || { runs.set(runs.get() + 1); format!("답{}", runs.get()) });
        assert_eq!(call(Some(1), &["log"]), "답1");
        assert_eq!(call(Some(1), &["log"]), "답1");
        assert_eq!(runs.get(), 1, "5분마다 불러도 저장소가 그대로면 git 은 한 번");
        assert_eq!(call(Some(2), &["log"]), "답2", "저장소가 바뀌면 다시");
        assert_eq!(call(Some(2), &["status"]), "답3", "인자가 다르면 따로");
        assert_eq!(call(None, &["log"]), "답4", "지문을 못 재면 늘 부른다");
        assert_eq!(call(None, &["log"]), "답5");
    }
}
