//! 브라우저 자동화가 쓸 Node — 시스템에 20 이상이면 그것, 없으면 nodejs.org 공식 배포를 <데이터>/tools/node 에(관리자 암호 없이).
//! 받은 압축은 실행 파일에 박은 sha256 과 맞아야만 쓴다(SHASUMS256.txt — 노드 릴리스 키 서명 확인, 2026-10-05).
//! 맥은 <데이터>/tools/bin/node 링크가 고른 node 를 가리키고 .mcp.json 은 그 링크만 — node 가 바뀌어도 링크 하나만 고친다
use std::path::{Path, PathBuf};

pub const NODE_VERSION: &str = "v24.21.0";

/// (파일 이름, sha256) — 이 앱이 받는 Node 판. 판을 올릴 땐 nodejs.org/dist/<판>/SHASUMS256.txt(서명 확인)에서
pub fn node_pin(win: bool, arch: &str) -> Option<(&'static str, &'static str)> {
    Some(match (win, arch) {
        (false, "aarch64") => ("node-v24.21.0-darwin-arm64.tar.gz", "bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057"),
        (false, "x86_64") => ("node-v24.21.0-darwin-x64.tar.gz", "1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097"),
        (true, "aarch64") => ("node-v24.21.0-win-arm64.zip", "8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921"),
        (true, "x86_64") => ("node-v24.21.0-win-x64.zip", "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541"),
        _ => return None,
    })
}

pub fn node_url(file: &str) -> String {
    format!("https://nodejs.org/dist/{NODE_VERSION}/{file}")
}

/// 앱이 받은 node 실행 파일
pub fn our_node(data: &Path, win: bool) -> PathBuf {
    if win {
        data.join("tools").join("node").join("node.exe")
    } else {
        data.join("tools/node/bin/node")
    }
}

#[derive(Debug, PartialEq)]
pub enum NodeChoice {
    /// 시스템 node(버전 없는 경로)
    System(String),
    /// 앱이 받아 둔 node
    Ours,
    /// 받아야 한다
    Download,
}

/// 시스템에 20 이상이 있고 옆에 npm 이 있으면 그것(사용자가 깐 걸 존중), 아니면 받아 둔 것, 그것도 없으면 받기.
/// system = (경로, 큰 판, npm-cli.js 를 찾았나)
pub fn choose(system: Option<(String, u32, bool)>, ours_ok: bool) -> NodeChoice {
    match system {
        Some((p, major, true)) if major >= crate::browser::MIN_NODE => NodeChoice::System(p),
        _ if ours_ok => NodeChoice::Ours,
        _ => NodeChoice::Download,
    }
}

/// Homebrew Cellar 버전 폴더 → 같은 formula 의 opt 링크(있을 때만) — tools/chammo-browser/src/setup.js stableNode 와 같은 규칙.
/// brew upgrade 가 옛 버전 폴더를 지우면 거기를 가리키던 .mcp.json 이 다 죽었다(2026-10-03 아이맥)
pub fn stable_node(real: &str, exists: impl Fn(&str) -> bool) -> String {
    let Some(i) = real.find("/Cellar/") else { return real.to_string() };
    let rest: Vec<&str> = real[i + 8..].split('/').collect();
    if rest.len() != 4 || rest[2] != "bin" || rest[3] != "node" {
        return real.to_string();
    }
    let opt = format!("{}/opt/{}/bin/node", &real[..i], rest[0]);
    if exists(&opt) {
        opt
    } else {
        real.to_string()
    }
}

/// fnm·volta 같은 셸마다 임시로 만드는 경로 — 셸이 끝나면 사라져 링크 대상으로 못 쓴다
pub fn ephemeral(p: &str) -> bool {
    p.contains("fnm_multishells") || p.contains("/.volta/tmp/")
}

/// node 옆의 npm-cli.js — 맥은 <node 폴더>/npm 링크의 실제 파일(brew 는 /opt/homebrew/lib/…), 공식 배포는 ../lib/node_modules,
/// 윈도우는 node.exe 옆 node_modules. npm 을 셸 스크립트로 안 돌리고 `node npm-cli.js` 로 — PATH 에 기대지 않는다
pub fn npm_cli(node: &Path, win: bool, real: impl Fn(&Path) -> Option<PathBuf>) -> Option<PathBuf> {
    let dir = node.parent()?;
    if win {
        let p = dir.join("node_modules/npm/bin/npm-cli.js");
        return real(&p).map(|_| p);
    }
    let mut cands = vec![dir.join("npm")];
    if let Some(r) = real(node) {
        if let Some(d) = r.parent() {
            cands.push(d.join("npm"));
        }
    }
    cands.push(dir.join("../lib/node_modules/npm/bin/npm-cli.js"));
    cands.into_iter().filter_map(|c| real(&c)).find(|r| r.extension().is_some_and(|e| e == "js"))
}

pub fn sha256_file(p: &Path) -> std::io::Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// 받아 둔 압축 파일을 검증하고 <tools>/node 로 바꿔 끼운다. 검증 실패면 아무것도 안 바꾼다.
/// 풀기는 시스템 tar(맥 bsdtar, 윈도우 10+ tar.exe — zip 도 푼다). 옛 node 는 새 것이 제자리에 간 뒤에 지운다
pub fn install_archive(archive: &Path, sha256: &str, tools: &Path, win: bool) -> Result<PathBuf, String> {
    let got = sha256_file(archive).map_err(|e| e.to_string())?;
    if !got.eq_ignore_ascii_case(sha256) {
        return Err(crate::i18n::tr("받은 Node 파일이 공식 파일과 달라요(체크섬). 다시 시도해 주세요.", "The downloaded Node file does not match the official one (checksum). Please try again.").into());
    }
    let tag = std::process::id();
    // 지난번에 풀다 꺼져 남은 .node-new-<pid>·.node-old-<pid>(각 100MB 넘음) — 그 pid 가 죽었으면 치운다
    if let Ok(rd) = std::fs::read_dir(tools) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            let pid = n.strip_prefix(".node-new-").or_else(|| n.strip_prefix(".node-old-")).and_then(|p| p.parse::<i32>().ok());
            if pid.is_some_and(|p| !crate::platform::pid_alive(p)) {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    let stage = tools.join(format!(".node-new-{tag}"));
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    // 윈도우는 System32 tar(bsdtar — zip 도 푼다). PATH 에 Git 의 GNU tar 가 먼저 있으면 zip 을 못 푼다
    let tar = if win { crate::browser_get::sys_tool("tar") } else { PathBuf::from("/usr/bin/tar") };
    let out = crate::platform::command(tar)
        .arg(if win { "-xf" } else { "-xzf" })
        .arg(archive)
        .arg("-C")
        .arg(&stage)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let _ = std::fs::remove_dir_all(&stage);
        return Err(format!("tar: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    // 압축 안 맨 위 폴더 하나(node-v24…-darwin-arm64)
    let inner = std::fs::read_dir(&stage).ok().and_then(|rd| rd.flatten().map(|e| e.path()).find(|p| p.is_dir()));
    let Some(inner) = inner else {
        let _ = std::fs::remove_dir_all(&stage);
        return Err("node archive is empty".into());
    };
    let dest = tools.join("node");
    let old = tools.join(format!(".node-old-{tag}"));
    if dest.exists() {
        std::fs::rename(&dest, &old).map_err(|e| e.to_string())?;
    }
    // 윈도우는 방금 푼 파일을 백신이 잡고 있어 이름 바꾸기가 잠깐 거절될 수 있다 — 몇 번 다시
    let mut moved = std::fs::rename(&inner, &dest);
    for _ in 0..10 {
        if moved.is_ok() || !cfg!(windows) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
        moved = std::fs::rename(&inner, &dest);
    }
    if let Err(e) = moved {
        let _ = std::fs::rename(&old, &dest); // 되돌린다
        let _ = std::fs::remove_dir_all(&stage);
        return Err(e.to_string());
    }
    let _ = std::fs::remove_dir_all(&old);
    let _ = std::fs::remove_dir_all(&stage);
    Ok(dest)
}

/// node --version 의 큰 판 — 실행이 안 되거나 모양이 다르면 None
pub fn version_of(node: &Path) -> Option<(String, u32)> {
    // 대리 실행 node 가 첫 실행에 물어보거나 깨져 멈춰도 설치·설정 화면이 같이 굳지 않게 10초
    let out = crate::platform::run_capped(crate::platform::command(node).arg("--version"), std::time::Duration::from_secs(10)).ok()?;
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let m = crate::browser::node_major(&v)?;
    out.status.success().then_some((v, m))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-node-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn 판_고정_맥_윈도우_두_아키텍처() {
        assert_eq!(node_pin(true, "x86_64").unwrap().0, "node-v24.21.0-win-x64.zip");
        assert!(node_pin(false, "riscv64").is_none());
        for (w, a) in [(false, "aarch64"), (false, "x86_64"), (true, "aarch64"), (true, "x86_64")] {
            let (f, sha) = node_pin(w, a).unwrap();
            assert!(f.contains(NODE_VERSION), "{f}");
            assert_eq!(sha.len(), 64);
        }
        assert_eq!(node_url("node-v24.21.0-win-x64.zip"), "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip");
    }

    #[test]
    fn 고르기_시스템_20이상_먼저_18이면_받은_것_없으면_받기() {
        assert_eq!(choose(Some(("/opt/homebrew/bin/node".into(), 20, true)), true), NodeChoice::System("/opt/homebrew/bin/node".into()));
        // Volta·asdf 같은 대리 실행 node — 옆에서 npm-cli.js 를 못 찾으면 안 쓴다(안 그러면 부품 단계가 영영 실패, 리뷰 2026-10-05)
        assert_eq!(choose(Some(("/Users/a/.volta/bin/node".into(), 22, false)), false), NodeChoice::Download);
        // Node 18 — 낮아서 안 쓴다
        assert_eq!(choose(Some(("/usr/local/bin/node".into(), 18, true)), true), NodeChoice::Ours);
        assert_eq!(choose(Some(("/usr/local/bin/node".into(), 18, true)), false), NodeChoice::Download);
        assert_eq!(choose(None, false), NodeChoice::Download);
    }

    #[test]
    fn 셀러_버전_경로는_opt_로() {
        let has = |set: &'static [&'static str]| move |p: &str| set.contains(&p);
        assert_eq!(stable_node("/opt/homebrew/Cellar/node/26.8.1/bin/node", has(&["/opt/homebrew/opt/node/bin/node"])), "/opt/homebrew/opt/node/bin/node");
        assert_eq!(stable_node("/opt/homebrew/Cellar/node/26.8.1/bin/node", has(&[])), "/opt/homebrew/Cellar/node/26.8.1/bin/node");
        assert_eq!(stable_node("/usr/local/bin/node", has(&["/usr/local/opt/node/bin/node"])), "/usr/local/bin/node");
        assert!(ephemeral("/Users/a/.local/state/fnm_multishells/123_456/bin/node"));
        assert!(!ephemeral("/Users/a/.nvm/versions/node/v22.1.0/bin/node"));
    }

    #[test]
    fn npm_cli_찾기_brew_공식_윈도우() {
        let map = |pairs: &'static [(&'static str, &'static str)]| move |p: &Path| pairs.iter().find(|(k, _)| Path::new(k) == p).map(|(_, v)| PathBuf::from(v));
        // brew: /opt/homebrew/bin/npm → /opt/homebrew/lib/node_modules/npm/bin/npm-cli.js
        let brew = map(&[("/opt/homebrew/bin/npm", "/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js"), ("/opt/homebrew/bin/node", "/opt/homebrew/Cellar/node/26/bin/node")]);
        assert_eq!(npm_cli(Path::new("/opt/homebrew/bin/node"), false, brew), Some(PathBuf::from("/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js")));
        // 공식 배포(우리 node) — bin/npm 이 ../lib/node_modules/npm/bin/npm-cli.js 링크
        let ours = map(&[("/d/tools/node/bin/npm", "/d/tools/node/lib/node_modules/npm/bin/npm-cli.js")]);
        assert_eq!(npm_cli(Path::new("/d/tools/node/bin/node"), false, ours), Some(PathBuf::from("/d/tools/node/lib/node_modules/npm/bin/npm-cli.js")));
        assert_eq!(npm_cli(Path::new("/x/bin/node"), false, map(&[("/x/bin/npm", "/x/bin/npm")])), None); // 셸 스크립트 npm 은 안 고른다
        let win = map(&[(r"C:\n/node_modules/npm/bin/npm-cli.js", "x")]);
        assert_eq!(npm_cli(Path::new(r"C:\n/node.exe"), true, win), Some(PathBuf::from(r"C:\n/node_modules/npm/bin/npm-cli.js")));
    }

    /// 가짜 node 배포판(tar.gz) — 맨 위 폴더 하나 + bin/node(판을 찍는 셸 스크립트)
    #[cfg(unix)]
    fn fake_archive(dir: &Path, version: &str) -> PathBuf {
        let src = dir.join("src/node-v24.21.0-darwin-arm64/bin");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("node"), format!("#!/bin/sh\necho {version}\n")).unwrap();
        crate::platform::make_executable(&src.join("node"));
        let out = dir.join("node.tar.gz");
        let st = crate::platform::command("/usr/bin/tar").arg("-czf").arg(&out).arg("-C").arg(dir.join("src")).arg("node-v24.21.0-darwin-arm64").status().unwrap();
        assert!(st.success());
        out
    }

    #[cfg(unix)]
    #[test]
    fn 체크섬이_맞으면_풀어서_바꿔_끼우고_틀리면_아무것도_안_바꾼다() {
        let d = tmp("archive");
        let tools = d.join("tools");
        std::fs::create_dir_all(tools.join("node/bin")).unwrap();
        std::fs::write(tools.join("node/bin/node"), "old").unwrap();
        let a = fake_archive(&d, "v24.21.0");
        // 체크섬이 틀리면(받다 끊겨 잘린 파일·바뀐 파일) 옛 node 그대로
        let err = install_archive(&a, &"0".repeat(64), &tools, false).unwrap_err();
        assert!(err.contains("checksum") || err.contains("체크섬"), "{err}");
        assert_eq!(std::fs::read_to_string(tools.join("node/bin/node")).unwrap(), "old");
        // 맞으면 새 것으로, 남는 임시 폴더 없음 — 지난번 꺼져 남은 것(죽은 pid)도 치운다
        std::fs::create_dir_all(tools.join(".node-old-999999")).unwrap();
        let sha = sha256_file(&a).unwrap();
        let dest = install_archive(&a, &sha, &tools, false).unwrap();
        assert_eq!(version_of(&dest.join("bin/node")).unwrap(), ("v24.21.0".to_string(), 24));
        let left: Vec<_> = std::fs::read_dir(&tools).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(left, vec!["node".to_string()]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn 깨진_압축은_오류로_옛_것_유지() {
        let d = tmp("broken");
        let tools = d.join("tools");
        std::fs::create_dir_all(tools.join("node")).unwrap();
        let a = d.join("bad.tar.gz");
        std::fs::write(&a, b"not a tarball").unwrap();
        let sha = sha256_file(&a).unwrap();
        assert!(install_archive(&a, &sha, &tools, false).is_err());
        assert!(tools.join("node").is_dir());
        assert!(!std::fs::read_dir(&tools).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with(".node-")));
        let _ = std::fs::remove_dir_all(&d);
    }

    /// 진짜 nodejs.org 에서 받아 체크섬·실행까지 — 손으로: cargo test node_진짜로_받기 -- --ignored
    #[test]
    #[ignore]
    fn node_진짜로_받기() {
        let d = tmp("real");
        let (file, sha) = node_pin(cfg!(windows), std::env::consts::ARCH).unwrap();
        let a = d.join(file);
        crate::browser_get::download(&node_url(file), &a, &|_, _| {}).unwrap();
        let dest = install_archive(&a, sha, &d.join("tools"), cfg!(windows)).unwrap();
        assert_eq!(version_of(&our_node(&d, cfg!(windows))).unwrap().0, NODE_VERSION);
        assert!(npm_cli(&our_node(&d, cfg!(windows)), cfg!(windows), |p| std::fs::canonicalize(p).ok()).is_some(), "{dest:?}");
        let _ = std::fs::remove_dir_all(&d);
    }
}
