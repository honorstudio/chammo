//! 브라우저 자동화(chammo-browser) — 프로젝트마다 로그인 유지·락 보호되는 크로미움 프로필을 준다.
//! 여러 세션이 한 브라우저를 같이 쓰다 부딪히지 않게(사용자 2026-09-28: "그래야 사용자들이 에이전트를 다중으로 쓸 수 있다").
//! 도구 코드(tools/chammo-browser)는 실행 파일에 넣어 두고, 설정 마법사에서 <데이터>/tools/chammo-browser 에 풀어
//! `npm ci` 로 의존성(@playwright/mcp)을 받는다. Node.js 20 이상이 있어야 한다 — 없으면 안내만 한다(선택 기능)
use serde::Serialize;
use std::path::{Path, PathBuf};

/// 돌 때 필요한 파일만(테스트·검증 스크립트·문서 제외). 도구 폴더에 실행 파일을 더하면 여기에도 — 테스트가 잡는다
pub const FILES: &[(&str, &str)] = &[
    ("package.json", include_str!("../../../tools/chammo-browser/package.json")),
    ("package-lock.json", include_str!("../../../tools/chammo-browser/package-lock.json")),
    ("bin/chammo-browser.js", include_str!("../../../tools/chammo-browser/bin/chammo-browser.js")),
    ("bin/chammo-browser-mcp.js", include_str!("../../../tools/chammo-browser/bin/chammo-browser-mcp.js")),
    ("src/paths.js", include_str!("../../../tools/chammo-browser/src/paths.js")),
    ("src/lock.js", include_str!("../../../tools/chammo-browser/src/lock.js")),
    ("src/relay.js", include_str!("../../../tools/chammo-browser/src/relay.js")),
    ("src/setup.js", include_str!("../../../tools/chammo-browser/src/setup.js")),
];

pub const MIN_NODE: u32 = 20;

/// "v22.3.0" → 22. 모양이 다르면 None
pub fn node_major(version: &str) -> Option<u32> {
    version.trim().trim_start_matches('v').split('.').next()?.parse().ok()
}

pub fn tool_dir(data: &Path) -> PathBuf {
    data.join("tools/chammo-browser")
}

/// 깔렸나 = 의존성까지 받아졌나
pub fn installed(data: &Path) -> bool {
    tool_dir(data).join("node_modules/@playwright/mcp/package.json").is_file()
}

/// 도구 코드를 데이터 폴더에 푼다(앱 것이라 덮어씀). 프로필은 <데이터>/browser 에 따로 있어 안 건드린다
pub fn export(data: &Path) -> std::io::Result<PathBuf> {
    let dir = tool_dir(data);
    for (path, body) in FILES {
        let dest = dir.join(path);
        if let Some(p) = dest.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(dest, body)?;
    }
    Ok(dir)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    /// node 실행 파일(없으면 None)
    pub node: Option<String>,
    pub node_version: String,
    /// node 가 MIN_NODE 이상
    pub node_ok: bool,
    pub installed: bool,
    /// 구글 크롬 — @playwright/mcp 기본 채널. 없으면 첫 브라우저 도구 호출에서 안내가 뜬다
    pub chrome: bool,
}

fn node_bin() -> Option<String> {
    let home = crate::config::home();
    crate::setup::pick_bin("node", &home, &std::env::var("PATH").unwrap_or_default(), |p| Path::new(p).is_file())
}

/// 설정 마법사 "브라우저 자동화" 줄
#[tauri::command]
pub fn browser_status() -> BrowserStatus {
    let node = node_bin();
    let node_version = node
        .as_ref()
        .and_then(|n| crate::platform::command(n).arg("--version").output().ok())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    BrowserStatus {
        node_ok: node_major(&node_version).is_some_and(|m| m >= MIN_NODE),
        node,
        node_version,
        installed: installed(crate::config::data_dir()),
        chrome: Path::new("/Applications/Google Chrome.app").is_dir(),
    }
}

/// 설치 — 도구 코드를 풀고, 설정 화면 터미널에서 돌릴 명령을 돌려준다(npm ci 는 인터넷이 필요해 사람이 보는 앞에서)
#[tauri::command]
pub fn browser_install_command() -> Result<String, String> {
    let dir = export(crate::config::data_dir()).map_err(|e| e.to_string())?;
    let node = node_bin().ok_or(crate::i18n::tr("Node.js 가 없어요", "Node.js is not installed"))?;
    let npm = Path::new(&node).with_file_name("npm");
    let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    Ok(format!(
        "cd {} && {} ci --omit=dev --no-audit --no-fund && echo && echo {}",
        q(&dir.to_string_lossy()),
        q(&npm.to_string_lossy()),
        q(crate::i18n::tr("브라우저 자동화 준비 끝. 이 창은 닫아도 돼요.", "Browser automation is ready. You can close this."))
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_버전_읽기() {
        assert_eq!(node_major("v22.3.0\n"), Some(22));
        assert_eq!(node_major("20.0.1"), Some(20));
        assert_eq!(node_major(""), None);
        assert_eq!(node_major("abc"), None);
    }

    #[test]
    fn 도구_코드를_풀고_깔렸는지는_의존성으로_본다() {
        let d = std::env::temp_dir().join(format!("chammo-browser-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let dir = export(&d).unwrap();
        assert!(dir.join("bin/chammo-browser-mcp.js").is_file());
        assert!(dir.join("package-lock.json").is_file());
        assert!(!installed(&d)); // npm ci 전
        std::fs::create_dir_all(dir.join("node_modules/@playwright/mcp")).unwrap();
        std::fs::write(dir.join("node_modules/@playwright/mcp/package.json"), "{}").unwrap();
        assert!(installed(&d));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 실행에_필요한_파일이_다_들어있다() {
        // 도구의 bin·src 에 파일을 더했는데 여기 목록에 안 넣으면 설치본이 깨진다
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/chammo-browser");
        for sub in ["bin", "src"] {
            for e in std::fs::read_dir(root.join(sub)).unwrap() {
                let name = format!("{sub}/{}", e.unwrap().file_name().to_string_lossy());
                assert!(FILES.iter().any(|(p, _)| *p == name), "목록에 없음: {name}");
            }
        }
    }
}
