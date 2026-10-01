//! 대화형 세션이 어디서 떴나 — 사람이 터미널에서 연 것인지, 예약 작업(크론·launchd)이 아무도 안 보는 곳에서 띄운 것인지.
//! 예약 작업이 프로젝트 폴더에서 띄운 Claude 가 그 프로젝트의 "앱으로 옮기기" 카드로 떠서, 열리지도 않는 정체불명 세션이 됐다
//! (2026-09-28 아이맥 project-x — 5분마다 도는 자동 실행). 이런 건 루틴 칸에 "외부 예약"으로 따로 보인다
use serde::Serialize;
use std::collections::HashMap;

/// 사람이 보는 터미널 앱(실행 파일 이름). 여기까지 거슬러 올라가면 사람이 연 세션
const TERMINALS: &[&str] = &[
    "Terminal", "iTerm2", "ghostty", "wezterm-gui", "kitty", "alacritty", "Warp", "Hyper", "Tabby",
    "Code Helper", "Code Helper (Plugin)", "Electron", "Cursor Helper", "Cursor Helper (Plugin)", "idea", "pycharm", "webstorm",
    "goland", "clion", "rider", "rubymine", "phpstorm", "studio", "Zed", "zed", "Windsurf", "Windsurf Helper", "stable",
    // 앱 자신(폴더 믿기 창)·SSH 접속·다른 멀티플렉서 — 사람이 보는 자리
    "Chammo", "honor-orchestrator", "sshd", "sshd-session", "screen", "zellij",
];

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Origin {
    /// 아무도 안 보는 곳에서 뜸(예약 작업·붙은 사람 없는 tmux)
    pub unattended: bool,
    /// 어디서 — "tmux 세션 claude" · "iTerm2" · "launchd" 같은 한 줄
    pub via: String,
}

/// pid → (부모 pid, 실행 파일 이름). panes = tmux 창마다 (창 첫 프로세스 pid, 세션 이름, 붙은 사람 수)
pub fn classify(pid: u32, procs: &HashMap<u32, (u32, String)>, panes: &[(u32, String, u32)]) -> Origin {
    let mut chain = vec![];
    let mut cur = pid;
    for _ in 0..64 {
        let Some((ppid, comm)) = procs.get(&cur) else { break };
        chain.push((cur, comm.rsplit('/').next().unwrap_or(comm).to_string()));
        if *ppid <= 1 || *ppid == cur { break }
        cur = *ppid;
    }
    if chain.is_empty() {
        return Origin { unattended: false, via: String::new() }; // 못 읽었으면 평소처럼(숨기지 않는다)
    }
    if let Some((_, t)) = chain.iter().find(|(_, c)| TERMINALS.contains(&c.as_str())) {
        return Origin { unattended: false, via: t.clone() };
    }
    // tmux: 이 세션이 든 창을 찾아 붙은 사람이 있나 본다(사람이 iTerm 에서 tmux 를 붙여 보고 있을 수도 있다)
    if let Some((_, name, attached)) = panes.iter().find(|(p, _, _)| chain.iter().any(|(c, _)| c == p)) {
        return Origin { unattended: *attached == 0, via: format!("tmux {name}") };
    }
    // tmux 아래인데 창 정보를 못 읽었으면(다른 경로·다른 소켓) 모른다 — 모를 땐 숨기지 않는다
    if chain.iter().any(|(_, c)| c == "tmux") {
        return Origin { unattended: false, via: "tmux".into() };
    }
    let top = chain.last().map(|(_, c)| c.clone()).unwrap_or_default();
    Origin { unattended: true, via: if top.is_empty() { "launchd".into() } else { top } }
}

fn process_table() -> HashMap<u32, (u32, String)> {
    let out = crate::platform::command("/bin/ps").args(["-axo", "pid=,ppid=,comm="]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    out.lines().filter_map(parse_ps_line).collect()
}

/// "  123     1 /usr/libexec/foo bar" → (123, (1, "/usr/libexec/foo bar"))
fn parse_ps_line(l: &str) -> Option<(u32, (u32, String))> {
    let parts: Vec<&str> = l.split_whitespace().collect();
    if parts.len() < 3 { return None }
    Some((parts[0].parse().ok()?, (parts[1].parse().ok()?, parts[2..].join(" "))))
}

fn tmux_panes() -> Vec<(u32, String, u32)> {
    let bin = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/opt/local/bin/tmux", "/usr/bin/tmux"].into_iter().find(|p| std::path::Path::new(p).exists());
    let Some(bin) = bin else { return vec![] };
    let out = crate::platform::command(bin).args(["list-panes", "-a", "-F", "#{pane_pid}\t#{session_name}\t#{session_attached}"]).output();
    let Ok(out) = out else { return vec![] };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let mut it = l.split('\t');
            Some((it.next()?.parse().ok()?, it.next()?.to_string(), it.next()?.parse().ok()?))
        })
        .collect()
}

/// 대화형 세션 pid 들이 어디서 떴나 — 프론트가 세션 목록을 읽을 때 대화형이 있으면 부른다
#[tauri::command]
pub async fn session_origins(pids: Vec<u32>) -> HashMap<u32, Origin> {
    tauri::async_runtime::spawn_blocking(move || {
        let procs = process_table();
        let panes = tmux_panes();
        pids.into_iter().map(|p| (p, classify(p, &procs, &panes))).collect()
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(rows: &[(u32, u32, &str)]) -> HashMap<u32, (u32, String)> {
        rows.iter().map(|(p, pp, c)| (*p, (*pp, c.to_string()))).collect()
    }

    #[test]
    fn 아무도_안_붙은_tmux_는_외부_예약() {
        // 2026-09-28 맥북 재현: claude → tmux 서버 → launchd, 창 crontest 붙은 사람 0
        let procs = table(&[(14075, 14074, "claude"), (14074, 1, "tmux")]);
        assert_eq!(classify(14075, &procs, &[(14075, "crontest".into(), 0)]), Origin { unattended: true, via: "tmux crontest".into() });
    }

    #[test]
    fn 사람이_붙어_보는_tmux_는_사람_것() {
        let procs = table(&[(20, 10, "claude"), (10, 1, "tmux")]);
        assert_eq!(classify(20, &procs, &[(20, "work".into(), 1)]), Origin { unattended: false, via: "tmux work".into() });
    }

    #[test]
    fn 터미널_앱까지_올라가면_사람이_연_것() {
        let procs = table(&[(30, 29, "claude"), (29, 28, "-zsh"), (28, 27, "login"), (27, 1, "/Applications/iTerm.app/Contents/MacOS/iTerm2")]);
        assert_eq!(classify(30, &procs, &[]), Origin { unattended: false, via: "iTerm2".into() });
    }

    #[test]
    fn 터미널도_tmux_도_없이_예약_작업에서_뜨면_외부_예약() {
        let procs = table(&[(40, 39, "claude"), (39, 1, "/bin/bash")]);
        assert_eq!(classify(40, &procs, &[]), Origin { unattended: true, via: "bash".into() });
    }

    // 0.1.2 공개 2차 검증: 판별을 못 하면 사용자 세션이 '외부 예약'으로 사라져 보인다 — 모를 땐 숨기지 않는다
    #[test]
    fn tmux_창_정보를_못_읽으면_숨기지_않는다() {
        let procs = table(&[(50, 49, "claude"), (49, 1, "tmux")]);
        assert!(!classify(50, &procs, &[]).unattended);
    }

    #[test]
    fn 앱_자신_ssh_screen_zellij_에디터는_사람_것() {
        for app in ["Chammo", "honor-orchestrator", "sshd-session", "sshd", "screen", "zellij", "Zed", "Windsurf", "goland", "studio", "stable"] {
            let procs = table(&[(60, 59, "claude"), (59, 1, app)]);
            assert!(!classify(60, &procs, &[]).unattended, "{app}");
        }
    }

    #[test]
    fn 못_읽은_pid_는_숨기지_않는다() {
        assert_eq!(classify(99, &HashMap::new(), &[]), Origin { unattended: false, via: String::new() });
    }

    #[test]
    fn ps_줄_읽기_빈칸이_여러_개여도() {
        assert_eq!(parse_ps_line("  123     1 /Applications/Code Helper (Plugin)"), Some((123, (1, "/Applications/Code Helper (Plugin)".into()))));
        assert_eq!(parse_ps_line("garbage"), None);
    }
}
