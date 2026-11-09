use super::*;

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-base-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d.canonicalize().unwrap()
}

fn sh(p: &Path, body: &str) {
    std::fs::write(p, format!("#!/bin/sh\n{body}\n")).unwrap();
    crate::platform::make_executable(p);
}

fn arch() -> &'static str {
    if cfg!(target_arch = "aarch64") { "arm64" } else { "x86_64" }
}

/// tools 폴더 + 가짜 curl(압축을 복사) + 가짜 도구 압축 — 도구 이름 폴더 하나가 맨 위(파이썬 모양)이면 wrapped
struct Kit {
    root: PathBuf,
    tools: PathBuf,
}

fn kit(name: &str, tool: &str, wrapped: bool, runs: bool, curl_fail: bool, bad_sha: bool) -> Kit {
    let root = tmp(name);
    let tools = root.join("tools");
    std::fs::create_dir_all(tools.join("bin")).unwrap();
    let inner = if wrapped { root.join(format!("src/{tool}/bin")) } else { root.join("src/bin") };
    std::fs::create_dir_all(&inner).unwrap();
    let exe = if tool == "python" { "python3" } else { "git" };
    let run = format!("echo \"real {exe}: $*\"");
    sh(&inner.join(exe), if runs { &run } else { "exit 9" });
    let a = root.join("a.tgz");
    assert!(crate::platform::command("/usr/bin/tar").args(["-czf"]).arg(&a).arg("-C").arg(root.join("src")).arg(".").status().unwrap().success());
    let sum = crate::browser_node::sha256_file(&a).unwrap();
    let curl = root.join("curl");
    let n = root.join("calls");
    if curl_fail {
        sh(&curl, "exit 7");
    } else {
        // -o 다음 칸이 받는 자리
        sh(&curl, &format!("echo x >> '{}'\nwhile [ $# -gt 0 ]; do [ \"$1\" = -o ] && out=$2; shift; done\n/bin/sleep 0.2\n/bin/cp '{}' \"$out\"", n.display(), a.display()));
    }
    let pin: Pin = (Box::leak(tool.to_string().into_boxed_str()), arch(), "https://example.test/a", Box::leak(if bad_sha { "00".repeat(32) } else { sum }.into_boxed_str()));
    let t = tools.to_string_lossy().into_owned();
    let get = tools.join("bin").join(GET);
    std::fs::write(&get, get_script(&t, &curl.to_string_lossy(), &[pin])).unwrap();
    crate::platform::make_executable(&get);
    let git = tools.join("bin/git");
    std::fs::write(&git, git_wrapper(&t, "/usr/bin/false")).unwrap();
    crate::platform::make_executable(&git);
    Kit { root, tools }
}

fn get(k: &Kit, tool: &str) -> i32 {
    crate::platform::command(k.tools.join("bin").join(GET)).arg(tool).output().unwrap().status.code().unwrap()
}

#[test]
fn 받기_풀기_제자리_파이썬은_맨위_폴더를_벗긴다() {
    let k = kit("py", "python", true, true, false, false);
    assert_eq!(get(&k, "python"), 0);
    let out = crate::platform::command(k.tools.join("python/bin/python3")).arg("hi").output().unwrap();
    assert!(String::from_utf8_lossy(&out.stdout).contains("real python3: hi"));
    // 찌꺼기 없음
    let left: Vec<String> = std::fs::read_dir(&k.tools).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with(".get-")).collect();
    assert!(left.is_empty(), "{left:?}");
    // 두 번째는 안 받는다
    assert_eq!(get(&k, "python"), 0);
    assert_eq!(std::fs::read_to_string(k.root.join("calls")).unwrap().lines().count(), 1);
}

#[test]
fn 체크섬이_다르면_안_깐다() {
    let k = kit("sha", "git", false, true, false, true);
    assert_eq!(get(&k, "git"), 4);
    assert!(!k.tools.join("git").exists());
    assert!(!k.tools.join(".get-git.lock").exists(), "자물쇠를 풀어야 다시 시도된다");
}

#[test]
fn 받기_실패는_3_다시_하면_된다() {
    let k = kit("off", "git", false, true, true, false);
    assert_eq!(get(&k, "git"), 3);
    assert!(!k.tools.join("git").exists());
    assert_eq!(get(&k, "git"), 3, "자물쇠가 안 남아 또 시도한다");
}

#[test]
fn 안_도는_파일이면_안_깐다() {
    let k = kit("dead", "git", false, false, false, false);
    assert_eq!(get(&k, "git"), 5);
    assert!(!k.tools.join("git").exists());
}

#[test]
fn 동시에_불러도_한_번만_받는다() {
    let k = kit("race", "git", false, true, false, false);
    let hs: Vec<_> = (0..5).map(|_| {
        let p = k.tools.join("bin").join(GET);
        std::thread::spawn(move || crate::platform::command(p).arg("git").status().unwrap().code())
    }).collect();
    for h in hs {
        assert_eq!(h.join().unwrap(), Some(0));
    }
    assert_eq!(std::fs::read_to_string(k.root.join("calls")).unwrap().lines().count(), 1);
}

#[test]
fn 죽은_자물쇠는_10분_뒤_버린다() {
    let k = kit("stale", "git", false, true, false, false);
    let lock = k.tools.join(".get-git.lock");
    std::fs::create_dir(&lock).unwrap();
    assert!(crate::platform::command("/usr/bin/touch").args(["-t", "202001010000"]).arg(&lock).status().unwrap().success());
    assert_eq!(get(&k, "git"), 0);
}

fn git(k: &Kit, cwd: &Path, args: &[&str]) -> (i32, String, String) {
    let o = crate::platform::command(k.tools.join("bin/git")).args(args).current_dir(cwd).output().unwrap();
    (o.status.code().unwrap(), String::from_utf8_lossy(&o.stdout).into_owned(), String::from_utf8_lossy(&o.stderr).into_owned())
}

#[test]
fn 저장소_밖_읽기는_받지_않고_저장소_아님() {
    let k = kit("plain", "git", false, true, false, false);
    // Claude Code 가 세션을 켤 때 부르는 꼴 그대로(11-05 실측)
    for a in [
        vec!["-C", "/", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        vec!["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=", "--no-optional-locks", "status", "--short"],
        vec!["--no-optional-locks", "log", "--oneline", "-n", "5"],
        vec!["remote", "get-url", "origin"],
        vec!["ls-files", "--error-unmatch", "--", ":(icase).claude/settings.local.json"],
    ] {
        let (code, _, err) = git(&k, &k.root, &a);
        assert_eq!(code, 128, "{a:?}");
        assert!(err.contains("not a git repository"));
    }
    assert_eq!(git(&k, &k.root, &["config", "user.name"]).0, 1);
    assert_eq!(git(&k, &k.root, &["--version"]).0, 0);
    assert!(!k.root.join("calls").exists(), "아무것도 받지 않았다");
}

#[test]
fn 만드는_명령과_저장소_안은_받아서_잇는다() {
    let k = kit("init", "git", false, true, false, false);
    let (code, out, _) = git(&k, &k.root, &["init", "-q", "새 폴더"]);
    assert_eq!(code, 0);
    assert!(out.contains("real git: init -q 새 폴더"), "{out}");
    let k = kit("inrepo", "git", false, true, false, false);
    let sub = k.root.join("repo/a/b");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::create_dir(k.root.join("repo/.git")).unwrap();
    let (code, out, _) = git(&k, &sub, &["status", "--short"]);
    assert_eq!(code, 0);
    assert!(out.contains("real git: status --short"), "{out}");
    // 전역 설정 쓰기도 받아야 한다
    let k = kit("cfg", "git", false, true, false, false);
    assert!(git(&k, &k.root, &["config", "--global", "user.name", "한글 이름"]).1.contains("한글 이름"));
}

#[test]
fn 받기가_실패하면_이유를_말하고_1() {
    let k = kit("nofetch", "git", false, true, true, false);
    let (code, _, err) = git(&k, &k.root, &["init"]);
    assert_eq!(code, 1);
    assert!(err.contains("could not be downloaded"));
}

#[test]
fn 경로에_한글_띄어쓰기_따옴표가_있어도_돈다() {
    let root = tmp("quote");
    let tools = root.join("내 도구's");
    std::fs::create_dir_all(tools.join("bin")).unwrap();
    let w = tools.join("bin/git");
    std::fs::write(&w, git_wrapper(&tools.to_string_lossy(), "/usr/bin/false")).unwrap();
    crate::platform::make_executable(&w);
    let o = crate::platform::command(&w).args(["status"]).current_dir(&root).output().unwrap();
    assert_eq!(o.status.code(), Some(128));
}

#[test]
fn 쉘_문법이_맞다() {
    for t in [get_script("/x", "/usr/bin/curl", &PINS), git_wrapper("/x", "/usr/bin/xcode-select")] {
        let d = tmp("syntax");
        let f = d.join("s");
        std::fs::write(&f, t).unwrap();
        assert!(crate::platform::command("/bin/sh").arg("-n").arg(&f).status().unwrap().success());
    }
}

#[test]
fn path_맨_앞으로() {
    assert_eq!(path_first("/a:/b", "/t").unwrap(), "/t:/a:/b");
    assert_eq!(path_first("/a:/t:/b", "/t").unwrap(), "/t:/a:/b");
    assert_eq!(path_first("/t:/a", "/t"), None);
    assert_eq!(path_first("", "/t").unwrap(), "/t");
}

#[test]
fn 고정판은_두_도구_두_아키텍처_https_해시_64자() {
    for (n, a) in [("python", "arm64"), ("python", "x86_64"), ("git", "arm64"), ("git", "x86_64")] {
        let p = PINS.iter().find(|p| p.0 == n && p.1 == a).unwrap();
        assert!(p.2.starts_with("https://github.com/"));
        assert_eq!(p.3.len(), 64);
    }
}
