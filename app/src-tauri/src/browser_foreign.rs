//! 앱 밖 크롬 감지(2026-10-10 사용자 "브라우저는 참모 브라우저만") — 프로젝트 세션이 참모 브라우저 대신 크롬을 직접 띄우거나
//! (확인 스크립트의 chromium.launch(channel:'chrome')) 크롬 확장 중계(@playwright/mcp --extension)로 사용자 크롬을 쓰면, 그 세션을 맡긴 참모에게 [앱] 한 줄.
//! 판단은 프로세스 표만 — 헛잡음 없게 셋 다 맞을 때만 센다:
//! ① 자동화로 띄운 크롬(--remote-debugging-port·--remote-debugging-pipe, 도우미 --type= 아님) ② 화면에 보인다(--headless 아님 — 헤드리스 시험·하네스는 안 보여 사람을 안 헷갈린다)
//! ③ 우리 브라우저 폴더(<데이터>/browser — 래퍼·chammo-browser launch 가 쓰는 프로필) 밖. 그리고 그 크롬의 조상이 팀 세션 프로세스일 때만
use serde::Serialize;

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Foreign {
    /// 그걸 띄운 세션 프로세스(Session.procPid)
    pub session_pid: i32,
    /// 크롬(또는 중계) 프로세스
    pub pid: i32,
    /// "chrome" = 크롬을 직접 띄움 · "extension" = 크롬 확장 중계로 사용자 크롬을 씀
    pub kind: &'static str,
}

/// `ps -axo pid=,ppid=,args=` → (번호, 부모, 명령줄)
pub fn parse_ps(out: &str) -> Vec<(i32, i32, String)> {
    out.lines()
        .filter_map(|l| {
            let mut it = l.trim_start().splitn(2, char::is_whitespace);
            let pid = it.next()?.parse().ok()?;
            let rest = it.next()?.trim_start();
            let mut it = rest.splitn(2, char::is_whitespace);
            let ppid = it.next()?.parse().ok()?;
            Some((pid, ppid, it.next().unwrap_or("").trim_start().to_string()))
        })
        .collect()
}

fn arg_value<'a>(cmd: &'a str, key: &str) -> Option<&'a str> {
    let i = cmd.find(key)? + key.len();
    let rest = &cmd[i..];
    let rest = rest.strip_prefix('=').or_else(|| rest.strip_prefix(' '))?;
    // 다음 ' --' 까지 — 경로에 빈칸이 있을 수 있다(Application Support)
    Some(rest.split(" --").next().unwrap_or(rest).trim().trim_matches('"'))
}

/// 이 명령줄이 앱 밖 크롬·중계면 그 종류
pub fn kind_of(cmd: &str, ours: &str) -> Option<&'static str> {
    let exe = cmd.split(" --").next().unwrap_or(cmd).to_lowercase();
    if exe.contains("chrom") && !cmd.contains(" --type=") {
        let automated = cmd.contains("--remote-debugging-port") || cmd.contains("--remote-debugging-pipe");
        let headless = cmd.contains("--headless");
        let dir = arg_value(cmd, "--user-data-dir").map(|d| d.replace('\\', "/"));
        let mine = dir.as_deref().is_some_and(|d| !ours.is_empty() && d.starts_with(ours));
        let raw_exe = cmd.split(" --").next().unwrap_or(cmd).replace('\\', "/");
        return (automated && !headless && !mine && !dir.as_deref().is_some_and(|d| other_home(&raw_exe, d))).then_some("chrome");
    }
    // 크롬 확장 중계 — 사용자의 평소 크롬을 쓴다. 우리 래퍼(chammo-browser)는 --extension 을 안 쓴다
    (cmd.contains("@playwright/mcp") && cmd.split_whitespace().any(|a| a == "--extension") && !cmd.contains("chammo-browser")).then_some("extension")
}

/// 다른 데이터 폴더(시험 CHAMMO_HOME)의 chammo-browser 가 띄운 크롬인가 — 그 폴더 browser/app 의 사본 실행 파일로 같은 폴더 browser/profiles 를 연다.
/// 시험 폴더로 `chammo-browser launch` 한 E2E 크롬을 '앱 밖 크롬'으로 잡아 참모 입력칸에 헛경고를 냈다(2026-11-09). 스크립트가 직접 띄운 정품 크롬은 이 모양이 아니다
fn other_home(exe: &str, dir: &str) -> bool {
    let Some(i) = dir.find("/browser/profiles/") else { return false };
    let app = format!("{}/browser/app/", &dir[..i]);
    exe.starts_with(&app) && exe.contains("Chammo Browser.app/")
}

/// 앱 밖 크롬·중계 중 조상이 팀 세션인 것. ours = 우리 브라우저 폴더(끝 '/' 포함, 경로 구분은 '/')
pub fn classify(procs: &[(i32, i32, String)], ours: &str, sessions: &[i32]) -> Vec<Foreign> {
    let parent: std::collections::HashMap<i32, i32> = procs.iter().map(|p| (p.0, p.1)).collect();
    let session_of = |mut pid: i32| {
        for _ in 0..40 {
            if sessions.contains(&pid) {
                return Some(pid);
            }
            pid = *parent.get(&pid)?;
            if pid <= 1 {
                return None;
            }
        }
        None
    };
    procs.iter().filter_map(|(pid, ppid, cmd)| Some(Foreign { kind: kind_of(cmd, ours)?, session_pid: session_of(*ppid)?, pid: *pid })).collect()
}

/// 팀 세션들이 띄운 앱 밖 크롬 — 앱이 30초마다(useForeignBrowsers). 세션 번호가 없으면 ps 도 안 부른다
#[tauri::command]
pub async fn foreign_browsers(session_pids: Vec<i32>) -> Vec<Foreign> {
    if session_pids.is_empty() || !cfg!(unix) {
        return vec![];
    }
    tauri::async_runtime::spawn_blocking(move || {
        let out = crate::platform::command("/bin/ps").args(["-axo", "pid=,ppid=,args="]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
        let ours = format!("{}/", crate::config::data_dir().join("browser").to_string_lossy().replace('\\', "/").trim_end_matches('/'));
        classify(&parse_ps(&out), &ours, &session_pids)
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const OURS: &str = "/Users/u/.chammo/browser/";

    fn ps() -> Vec<(i32, i32, String)> {
        let rows = [
            // 세션 100 → zsh → node 확인 스크립트 → 정품 크롬(창 보임) — 2026-10-10 project-b 그대로
            (100, 1, "claude --bg"),
            (110, 100, "/bin/zsh -c node scripts/check.mjs"),
            (111, 110, "node scripts/check.mjs"),
            (112, 111, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --remote-debugging-pipe --user-data-dir=/var/folders/x/T/playwright_chromiumdev_profile-AbC --window-position=-1450,40 about:blank"),
            (113, 112, "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer --remote-debugging-pipe"),
            // 세션 200 → 우리 래퍼 → 참모 브라우저 크롬(우리 프로필) · chammo-browser launch 로 받은 스크립트 크롬도 같은 폴더
            (200, 1, "claude --bg"),
            (210, 200, "node /Users/u/.chammo/tools/chammo-browser/bin/chammo-browser-mcp.js shop"),
            (211, 210, "/Users/u/.chammo/browser/app/Chammo Browser.app/Contents/MacOS/Google Chrome Beta --remote-debugging-port=0 --user-data-dir=/Users/u/.chammo/browser/profiles/shop"),
            // 세션 200 의 헤드리스 시험 크롬 — 안 보여서 안 센다
            (220, 200, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --remote-debugging-port=0 --user-data-dir=/tmp/e2e"),
            // 세션 300 → 크롬 확장 중계(사용자 크롬)
            (300, 1, "claude --bg"),
            (310, 300, "node /Users/u/.npm/_npx/9/node_modules/@playwright/mcp/cli.js --extension"),
            // 사용자가 직접 연 크롬(조상이 세션 아님)·자동화 아닌 크롬
            (400, 1, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            (401, 1, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/dbg"),
            (500, 1, "claude"),
            (510, 500, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/plain"),
        ];
        rows.iter().map(|(a, b, c)| (*a, *b, c.to_string())).collect()
    }

    #[test]
    fn 팀_세션이_직접_띄운_보이는_크롬과_확장_중계만() {
        let got = classify(&ps(), OURS, &[100, 200, 300, 500]);
        assert_eq!(got, vec![Foreign { session_pid: 100, pid: 112, kind: "chrome" }, Foreign { session_pid: 300, pid: 310, kind: "extension" }]);
    }

    #[test]
    fn 팀_세션이_아니면_안_센다() {
        // 사용자가 따로 연 터미널의 claude(팀 아님) — 세션 목록에 없으면 조상이 claude 여도 모른다
        assert!(classify(&ps(), OURS, &[200, 500]).is_empty());
    }

    #[test]
    fn 우리_폴더_가름은_빈칸_있는_경로와_따옴표도() {
        let ours = "/Users/u/Library/Application Support/Chammo/browser/";
        let c = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=0 --user-data-dir=/Users/u/Library/Application Support/Chammo/browser/profiles/shop --no-first-run";
        assert_eq!(kind_of(c, ours), None);
        assert_eq!(kind_of(&c.replace("/Chammo/", "/Other/"), ours), Some("chrome"));
        assert_eq!(kind_of("chrome.exe --remote-debugging-port=0 --user-data-dir \"C:/Users/u/.chammo/browser/profiles/a\"", "C:/Users/u/.chammo/browser/"), None);
        // 우리 래퍼가 받는 --extension 아닌 인자·남의 중계
        assert_eq!(kind_of("node /Users/u/.chammo/tools/chammo-browser/node_modules/@playwright/mcp/cli.js --user-data-dir /x", OURS), None);
        assert_eq!(kind_of("npx @playwright/mcp@latest --extension", OURS), Some("extension"));
        assert_eq!(kind_of("npx @playwright/mcp@latest --extensions-dir /x", OURS), None);
    }

    #[test]
    fn 시험_데이터_폴더의_chammo_browser_크롬은_앱_밖이_아니다() {
        // 2026-11-09 — 시험 CHAMMO_HOME 으로 chammo-browser launch 한 E2E 크롬이 '앱 밖 크롬' 헛경고
        let t = "/Users/u/.claude/jobs/d5/tmp/home2";
        let c = format!("{t}/browser/app/com.google.Chrome.beta-158.0.8127.18/Chammo Browser.app/Contents/MacOS/Google Chrome Beta --disable-field-trial-config --remote-debugging-port=0 --user-data-dir={t}/browser/profiles/nb-test --remote-debugging-pipe about:blank");
        assert_eq!(kind_of(&c, OURS), None);
        // 정품 크롬으로 그 프로필 모양을 흉내 낸 것·다른 폴더 사본으로 연 것·사본 실행 파일로 임시 프로필을 연 것은 그대로 잡는다
        assert_eq!(kind_of(&format!("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-pipe --user-data-dir={t}/browser/profiles/x"), OURS), Some("chrome"));
        assert_eq!(kind_of(&c.replace("--user-data-dir=/Users/u/.claude/jobs/d5/tmp/home2/", "--user-data-dir=/tmp/other/"), OURS), Some("chrome"));
        assert_eq!(kind_of(&format!("{t}/browser/app/x/Chammo Browser.app/Contents/MacOS/Google Chrome Beta --remote-debugging-pipe --user-data-dir=/var/folders/T/playwright_profile-1"), OURS), Some("chrome"));
    }

    #[test]
    fn ps_줄_읽기() {
        assert_eq!(parse_ps("  12   1 /bin/zsh -l\n  13 12 node a.js --x\nbad line\n"), vec![(12, 1, "/bin/zsh -l".to_string()), (13, 12, "node a.js --x".to_string())]);
    }
}
