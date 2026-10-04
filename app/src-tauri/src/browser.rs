//! 브라우저 자동화(chammo-browser) — 프로젝트마다 로그인 유지·락 보호되는 크로미움 프로필을 준다.
//! 여러 세션이 한 브라우저를 같이 쓰다 부딪히지 않게(사용자 2026-09-28: "그래야 사용자들이 에이전트를 다중으로 쓸 수 있다").
//! 도구 코드(tools/chammo-browser)는 실행 파일에 넣어 두고, 설정 > 브라우저 자동화의 '설치'가 <데이터>/tools/chammo-browser 에 풀어
//! 의존성(@playwright/mcp)까지 받는다 — Node·크롬 베타까지 없는 것만 차례로(browser_setup.rs, 2026-10-05 '딸깍')
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
    ("src/focus.js", include_str!("../../../tools/chammo-browser/src/focus.js")),
    ("src/window.js", include_str!("../../../tools/chammo-browser/src/window.js")),
    ("src/live.js", include_str!("../../../tools/chammo-browser/src/live.js")),
    ("src/minimize.js", include_str!("../../../tools/chammo-browser/src/minimize.js")),
    ("src/guard.js", include_str!("../../../tools/chammo-browser/src/guard.js")),
    ("src/check.js", include_str!("../../../tools/chammo-browser/src/check.js")),
    ("src/features.js", include_str!("../../../tools/chammo-browser/src/features.js")),
];

pub const MIN_NODE: u32 = 20;

/// "v22.3.0" → 22. 모양이 다르면 None
pub fn node_major(version: &str) -> Option<u32> {
    version.trim().trim_start_matches('v').split('.').next()?.parse().ok()
}

pub fn tool_dir(data: &Path) -> PathBuf {
    data.join("tools/chammo-browser")
}

/// 앱이 원하는 @playwright/mcp 버전(실행 파일에 넣은 package.json 의 dependencies)
pub fn wanted_mcp_version() -> Option<String> {
    let pkg: serde_json::Value = serde_json::from_str(FILES[0].1).ok()?;
    pkg.pointer("/dependencies/@playwright~1mcp")?.as_str().map(str::to_string)
}

/// 깔렸나 = 앱이 원하는 버전의 의존성까지 받아졌나. 앱 업데이트로 버전이 올라가면 '안 깔림' → 설정 화면에 설치 버튼이 다시 뜬다
pub fn installed(data: &Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(tool_dir(data).join("node_modules/@playwright/mcp/package.json")) else { return false };
    let have = serde_json::from_str::<serde_json::Value>(&raw).ok().and_then(|v| v.get("version")?.as_str().map(str::to_string));
    have.is_some() && have == wanted_mcp_version()
}

/// 앱을 켤 때 — 이미 깐 사용자의 도구 코드를 앱 것으로 간다(설치 버튼 때만 풀면 앱을 올려도 옛 래퍼가 계속 돈다, 2026-10-03).
/// 한 번도 안 깐 사용자에겐 아무것도 안 만든다. 같은 내용은 다시 안 쓴다
pub fn refresh(data: &Path) -> std::io::Result<()> {
    let dir = tool_dir(data);
    if !dir.join("bin").is_dir() {
        return Ok(());
    }
    if FILES.iter().any(|(p, body)| std::fs::read_to_string(dir.join(p)).ok().as_deref() != Some(*body)) {
        export(data)?;
    }
    Ok(())
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
    /// 쓸 node 실행 파일(없으면 None) — 시스템 20 이상 또는 앱이 받은 것
    pub node: Option<String>,
    pub node_version: String,
    /// node 가 MIN_NODE 이상
    pub node_ok: bool,
    /// "system" | "ours" | ""
    pub node_source: String,
    /// 도구 부품(@playwright/mcp)이 앱이 원하는 판으로 받아졌나
    pub installed: bool,
    /// 구글 크롬(일반이든 베타든) — 하나도 없으면 세션 브라우저가 안 뜬다
    pub chrome: bool,
    /// 크롬 베타 — 세션 크롬을 사용자 크롬과 Dock·⌘Tab 에서 안 섞이게
    pub chrome_beta: bool,
    /// 설치 끝에 시험으로 한 번 열어 봤나
    pub checked: bool,
    /// 다 됨 — 설정 줄이 '준비됐어요'
    pub ready: bool,
}

/// Playwright 의 chrome 채널이 찾는 자리(맥 1곳, 윈도우 LOCALAPPDATA·ProgramFiles·ProgramFiles(x86)).
/// 예전엔 맥 경로만 봐서 윈도우에선 크롬이 있어도 늘 "크롬이 있어야" 안내가 떴다
pub fn chrome_paths(win: bool, env: impl Fn(&str) -> Option<String>) -> Vec<String> {
    if !win {
        return vec!["/Applications/Google Chrome.app".to_string()];
    }
    ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|k| env(k))
        .map(|root| format!(r"{}\Google\Chrome\Application\chrome.exe", root.trim_end_matches(['\\', '/'])))
        .collect()
}

/// 설정 "브라우저 자동화" 줄 — 확인 목록(Node · 크롬 베타 · 도구 부품 · 시험 열기)
#[tauri::command]
pub fn browser_status() -> BrowserStatus {
    let data = crate::config::data_dir();
    let node = crate::browser_setup::chosen_node(data);
    let h = crate::browser_setup::have(data);
    let home = crate::config::home();
    let user_chrome = std::path::Path::new(&home).join("Applications/Google Chrome.app");
    let chrome = h.chrome_beta || user_chrome.exists() || chrome_paths(cfg!(windows), |k| std::env::var(k).ok()).iter().any(|p| Path::new(p).exists());
    BrowserStatus {
        node_ok: node.is_some(),
        node_version: node.as_ref().map(|n| n.1.clone()).unwrap_or_else(|| crate::browser_setup::system_node(data).map(|s| s.1).unwrap_or_default()),
        node_source: node.as_ref().map(|n| n.2.to_string()).unwrap_or_default(),
        node: node.map(|n| n.0.to_string_lossy().into_owned()),
        installed: h.parts,
        chrome,
        chrome_beta: h.chrome_beta,
        checked: h.checked,
        ready: crate::browser_setup::plan(h).is_empty(),
    }
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
        std::fs::write(dir.join("node_modules/@playwright/mcp/package.json"), format!(r#"{{"version":"{}"}}"#, wanted_mcp_version().unwrap())).unwrap();
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
    #[test]
    fn 크롬_자리_맥은_응용프로그램_윈도우는_세_곳() {
        assert_eq!(chrome_paths(false, |_| None), vec!["/Applications/Google Chrome.app".to_string()]);
        let env = |k: &str| match k {
            "LOCALAPPDATA" => Some(r"C:\Users\a\AppData\Local".to_string()),
            "ProgramFiles" => Some(r"C:\Program Files".to_string()),
            _ => None,
        };
        assert_eq!(
            chrome_paths(true, env),
            vec![r"C:\Users\a\AppData\Local\Google\Chrome\Application\chrome.exe".to_string(), r"C:\Program Files\Google\Chrome\Application\chrome.exe".to_string()]
        );
    }

    #[test]
    fn 앱이_새_버전이면_깔린_도구_코드를_갈고_의존성_버전이_다르면_다시_설치로() {
        let d = std::env::temp_dir().join(format!("chammo-browser-refresh-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        // 한 번도 안 깐 사용자에겐 아무것도 안 푼다
        refresh(&d).unwrap();
        assert!(!tool_dir(&d).exists());
        // 옛 버전 코드가 깔려 있으면 앱 것으로 간다
        let dir = export(&d).unwrap();
        std::fs::write(dir.join("src/relay.js"), "// old").unwrap();
        refresh(&d).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("src/relay.js")).unwrap(), include_str!("../../../tools/chammo-browser/src/relay.js"));
        // 받아 둔 @playwright/mcp 가 앱이 원하는 버전이 아니면 '안 깔림' → 설정 화면에 설치 버튼이 다시 뜬다
        let pkg = dir.join("node_modules/@playwright/mcp");
        std::fs::create_dir_all(&pkg).unwrap();
        std::fs::write(pkg.join("package.json"), r#"{"version":"0.0.1"}"#).unwrap();
        assert!(!installed(&d));
        std::fs::write(pkg.join("package.json"), format!(r#"{{"version":"{}"}}"#, wanted_mcp_version().unwrap())).unwrap();
        assert!(installed(&d));
        let _ = std::fs::remove_dir_all(&d);
    }

}
