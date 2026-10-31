//! 이 기기 claude 가 어디서 왔나(winget·brew·공식 설치) — 새 버전 띠는 그 길로 실제로 받을 수 있는 판과 비교한다.
//! winget 은 npm 최신보다 늦게 올라온다(2026-10-20 윈도우 시험 PC: npm 2.1.304, winget 2.1.302 — 띠가 안 꺼지고, 누르면 재설치 길을 탔다).
//! 또 winget 업그레이드가 중간에 죽으면 claude.exe 가 claude.exe.old-<시각> 으로만 남아 'Claude 설치 안 됨'이 된다(10/16·10/20 같은 PC) —
//! 점검·앱 켤 때 되살린다
use serde::Serialize;
use std::path::Path;

pub const WINGET_ID: &str = "Anthropic.ClaudeCode";

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSource {
    /// winget · brew · npm(공식 설치·npm — 최신은 프론트가 npm 레지스트리에서 읽는다)
    pub kind: &'static str,
    /// 그 길로 받을 수 있는 최신 판. npm 이거나 못 읽었으면 None
    pub latest: Option<String>,
}

/// 경로(앱이 찾은 것) + 링크를 푼 실제 자리 → 설치 길
pub fn kind_of(path: &str, resolved: &str) -> &'static str {
    let both = format!("{path}\n{resolved}");
    if both.to_lowercase().contains("\\winget\\") {
        "winget"
    } else if both.contains("/Caskroom/") {
        "brew"
    } else {
        "npm"
    }
}

/// "2.1.302"·"v2.1.302" 같은 낱말이면 번호만
pub(crate) fn ver_token(t: &str) -> Option<String> {
    let t = t.trim_start_matches('v');
    let p: Vec<&str> = t.split('.').collect();
    (p.len() == 3 && p.iter().all(|x| !x.is_empty() && x.bytes().all(|b| b.is_ascii_digit()))).then(|| t.to_string())
}

/// `winget search -e --id Anthropic.ClaudeCode` 표 → 원본에 있는 판. 머리줄은 언어마다 달라서(이름/장치 ID/버전) id 줄의 id 다음 번호를 읽는다
pub fn parse_winget_search(out: &str) -> Option<String> {
    out.lines().find_map(|l| {
        let mut it = l.split_whitespace();
        it.position(|t| t.eq_ignore_ascii_case(WINGET_ID))?;
        it.find_map(ver_token)
    })
}

/// `brew info --cask --json=v2 claude-code` → cask 판
pub fn parse_brew_info(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get("casks")?.get(0)?.get("version")?.as_str()?.split(',').next().and_then(ver_token)
}

/// 패키지 폴더 안 이름들 → 되살릴 .old(claude.exe 가 없고 .old 가 있을 때만, 가장 새 것 — 이름 끝이 yyyyMMddHHmmss)
pub fn heal_pick(names: &[String]) -> Option<String> {
    if names.iter().any(|n| n.eq_ignore_ascii_case("claude.exe")) {
        return None;
    }
    names.iter().filter(|n| n.to_lowercase().starts_with("claude.exe.old-")).max_by_key(|n| n.to_lowercase()).cloned()
}

/// WinGet\Packages 아래 Anthropic.ClaudeCode_* 폴더에서 .old 만 남았으면 claude.exe 로 복사(.old 는 남긴다). 되살린 .old 이름
pub fn heal_in(packages: &Path) -> Option<String> {
    let dirs = std::fs::read_dir(packages).ok()?;
    for d in dirs.flatten() {
        if !d.file_name().to_string_lossy().starts_with("Anthropic.ClaudeCode_") || !d.path().is_dir() {
            continue;
        }
        let names: Vec<String> = std::fs::read_dir(d.path()).ok()?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        if let Some(old) = heal_pick(&names) {
            if std::fs::copy(d.path().join(&old), d.path().join("claude.exe")).is_ok() {
                return Some(old);
            }
        }
    }
    None
}

/// 이 기기(윈도우 winget)에서 되살리기. 맥·winget 아닌 설치는 LOCALAPPDATA 가 없거나 폴더가 없어 None
pub fn heal() -> Option<String> {
    let local = std::env::var("LOCALAPPDATA").ok()?;
    heal_in(&Path::new(&local).join("Microsoft").join("WinGet").join("Packages"))
}

fn source(path: &str) -> ClaudeSource {
    let resolved = std::fs::canonicalize(path).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let kind = kind_of(path, &resolved);
    let out = |bin: Option<String>, args: &[&str], secs| {
        let bin = bin?;
        crate::setup::run_for(&bin, args, secs).map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
    };
    let latest = match kind {
        // 원본 목록을 새로 받느라 처음엔 몇십 초 걸릴 수 있다
        "winget" => out(crate::setup::find("winget").or(Some("winget".into())), &["search", "-e", "--id", WINGET_ID, "--accept-source-agreements", "--disable-interactivity"], 60)
            .as_deref()
            .and_then(parse_winget_search),
        "brew" => out(crate::setup::find("brew"), &["info", "--cask", "--json=v2", "claude-code"], 30).as_deref().and_then(parse_brew_info),
        _ => None,
    };
    ClaudeSource { kind, latest }
}

/// 새 버전 띠가 부른다(켤 때·6시간마다)
#[tauri::command]
pub async fn claude_source(path: String) -> ClaudeSource {
    tauri::async_runtime::spawn_blocking(move || source(&path)).await.unwrap_or(ClaudeSource { kind: "npm", latest: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 설치_길_가르기() {
        assert_eq!(kind_of(r"C:\Users\a\AppData\Local\Microsoft\WinGet\Links\claude.exe", ""), "winget");
        assert_eq!(kind_of("/opt/homebrew/bin/claude", "/opt/homebrew/Caskroom/claude-code/2.1.300/claude"), "brew");
        assert_eq!(kind_of("/Users/a/.local/bin/claude", "/Users/a/.local/share/claude/versions/2.1.304"), "npm");
        assert_eq!(kind_of(r"C:\Users\a\.local\bin\claude.exe", ""), "npm");
    }

    #[test]
    fn winget_표에서_판_읽기_한글_영어() {
        // 윈도우 시험 PC(ko-KR) 실측 그대로
        let ko = "이름        장치 ID              버전    원본\n------------------------------------------------\nClaude Code Anthropic.ClaudeCode 2.1.302 winget\n";
        assert_eq!(parse_winget_search(ko).as_deref(), Some("2.1.302"));
        let en = "Name        Id                   Version Source\n-----\nClaude Code Anthropic.ClaudeCode 2.1.302 winget\n";
        assert_eq!(parse_winget_search(en).as_deref(), Some("2.1.302"));
        assert_eq!(parse_winget_search("입력 조건과 일치하는 패키지를 찾을 수 없습니다.\n"), None);
        assert_eq!(parse_winget_search(""), None);
    }

    #[test]
    fn brew_정보에서_판_읽기() {
        assert_eq!(parse_brew_info(r#"{"formulae":[],"casks":[{"token":"claude-code","version":"2.1.300"}]}"#).as_deref(), Some("2.1.300"));
        assert_eq!(parse_brew_info(r#"{"casks":[]}"#), None);
        assert_eq!(parse_brew_info("Error: No available cask"), None);
    }

    #[test]
    fn 되살릴_old_고르기() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        // .old 만 남음 → 가장 새 것
        assert_eq!(heal_pick(&s(&["claude.exe.old-20261016123344", "claude.exe.old-20261020231935"])).as_deref(), Some("claude.exe.old-20261020231935"));
        // claude.exe 가 있으면 손대지 않는다
        assert_eq!(heal_pick(&s(&["claude.exe", "claude.exe.old-20261020231935"])), None);
        assert_eq!(heal_pick(&s(&["Claude.EXE", "claude.exe.old-1"])), None);
        // 아무것도 없으면 없음(설치 안 됨)
        assert_eq!(heal_pick(&s(&[])), None);
    }

    #[test]
    fn 가짜_패키지_폴더에서_되살리기() {
        let root = std::env::temp_dir().join(format!("chammo-heal-{}", std::process::id()));
        let pkg = root.join("Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe");
        std::fs::create_dir_all(&pkg).unwrap();
        std::fs::create_dir_all(root.join("Other.Tool_x")).unwrap();
        std::fs::write(pkg.join("claude.exe.old-20261016000000"), b"old").unwrap();
        std::fs::write(pkg.join("claude.exe.old-20261020231935"), b"newer").unwrap();
        assert_eq!(heal_in(&root).as_deref(), Some("claude.exe.old-20261020231935"));
        assert_eq!(std::fs::read(pkg.join("claude.exe")).unwrap(), b"newer");
        // .old 는 남기고, 두 번째엔 할 일 없음
        assert!(pkg.join("claude.exe.old-20261020231935").exists());
        assert_eq!(heal_in(&root), None);
        assert_eq!(heal_in(&root.join("없는 폴더")), None);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
