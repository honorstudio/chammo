//! 부하 모니터 재료 — ps·sysctl 원문만 준다. 세션별로 가르는 건 프론트 domain/load.ts(테스트가 거기 있다).
//! ps 한 번이 30ms 안팎이라 상단 바 10초·부하 화면 3초 주기로 불러도 가볍다(2026-09-28 실측)
use serde::Serialize;
use std::process::Command;

fn out(cmd: &str, args: &[&str]) -> String {
    Command::new(cmd).args(args).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}

#[derive(Serialize)]
pub struct LoadRaw {
    /// `ps -axo pid=,ppid=,pcpu=,rss=,etime=,args=`
    pub ps: String,
    /// `sysctl -n hw.ncpu vm.loadavg vm.swapusage hw.memsize` 네 줄
    pub sys: String,
}

#[tauri::command]
pub async fn load_sample() -> LoadRaw {
    tauri::async_runtime::spawn_blocking(|| LoadRaw {
        ps: out("/bin/ps", &["-axo", "pid=,ppid=,pcpu=,rss=,etime=,args="]),
        sys: out("/usr/sbin/sysctl", &["-n", "hw.ncpu", "vm.loadavg", "vm.swapusage", "hw.memsize"]),
    })
    .await
    .unwrap_or(LoadRaw { ps: String::new(), sys: String::new() })
}

/// ps -E 줄에서 CLAUDE_PID 만 — 환경변수 전체(경로·토큰이 섞인다)는 프론트로 넘기지 않는다
pub fn claude_pids(ps_env: &str) -> String {
    let mut lines = Vec::new();
    for line in ps_env.lines() {
        let mut it = line.split_whitespace();
        let Some(pid) = it.next().filter(|p| p.chars().all(|c| c.is_ascii_digit())) else { continue };
        if let Some(owner) = it.find_map(|w| w.strip_prefix("CLAUDE_PID=")).filter(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit())) {
            lines.push(format!("{pid} CLAUDE_PID={owner}"));
        }
    }
    lines.join("\n")
}

/// 이 프로세스들을 띄운 Claude 세션 pid(`pid CLAUDE_PID=n` 줄들). 프론트가 세션 나무 밖·무거운 것만 추려 준다
#[tauri::command]
pub async fn load_env(pids: Vec<u32>) -> String {
    if pids.is_empty() {
        return String::new();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let list = pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        claude_pids(&out("/bin/ps", &["-E", "-ww", "-o", "pid=,command=", "-p", &list]))
    })
    .await
    .unwrap_or_default()
}

/// Claude Code 자신(daemon·세션·pty 호스트)인가 — 이건 절대 안 끈다(세션이 죽는다)
pub fn is_claude(args: &str) -> bool {
    let bin = args.split_whitespace().next().unwrap_or("");
    bin == "claude" || bin.ends_with("/claude") || bin.contains("/claude/versions/")
}

/// pid 와 그 밑 전부(ps 원문에서). 자식부터 끄려고 깊은 것 먼저
pub fn descendants(ps: &str, root: u32) -> Vec<u32> {
    let pairs: Vec<(u32, u32)> = ps
        .lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
        })
        .collect();
    let mut order = vec![root];
    let mut i = 0;
    while i < order.len() {
        let p = order[i];
        order.extend(pairs.iter().filter(|(_, pp)| *pp == p).map(|(c, _)| *c).filter(|c| *c != root));
        i += 1;
    }
    order.reverse();
    order
}

/// 주인 없는 프로세스 끄기(사용자가 부하 화면에서 누를 때만). Claude 가 띄운 것(CLAUDE_PID 가 있는 것)만 — 다른 앱은 못 끈다.
/// 나무째 SIGTERM
#[tauri::command]
pub async fn load_kill(pid: u32) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if claude_pids(&out("/bin/ps", &["-E", "-ww", "-o", "pid=,command=", "-p", &pid.to_string()])).is_empty() {
            return Err(crate::i18n::tr("Claude 가 띄운 프로세스가 아니라 끄지 않아요", "Not started by Claude — left alone").into());
        }
        let args = |p: u32| out("/bin/ps", &["-o", "args=", "-p", &p.to_string()]);
        let tree = descendants(&out("/bin/ps", &["-axo", "pid=,ppid="]), pid);
        if tree.iter().any(|p| is_claude(args(*p).trim())) {
            return Err(crate::i18n::tr("안에 Claude 세션이 있어서 끄지 않아요", "A Claude session runs inside it — left alone").into());
        }
        for p in &tree {
            let _ = Command::new("/bin/kill").args(["-TERM", &p.to_string()]).status();
        }
        Ok(tree.len() as u32)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 참모가 읽을 요약(<데이터 폴더>/load.json) — scripts/app load 가 이걸 보여 준다
#[tauri::command]
pub fn load_save(json: String) -> Result<(), String> {
    let path = crate::config::data_file("load.json");
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).and_then(|_| std::fs::rename(&tmp, &path)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 환경변수에선_claude_pid_만_남긴다() {
        let raw = "  400 node next dev HOME=/u TOKEN=secret CLAUDE_PID=999 PATH=/bin\n  500 Safari HOME=/u\n  x bad CLAUDE_PID=1\n  600 a CLAUDE_PID=";
        assert_eq!(claude_pids(raw), "400 CLAUDE_PID=999");
    }

    #[test]
    fn claude_자신은_알아본다() {
        assert!(is_claude("/Users/me/.local/bin/claude bg-spare"));
        assert!(is_claude("claude daemon run"));
        assert!(is_claude("/Users/me/.local/share/claude/versions/2.1.283 --bg-spare x"));
        assert!(!is_claude("node /x/node_modules/.bin/vite"));
        assert!(!is_claude("/bin/zsh -c claude-thing"));
    }

    #[test]
    fn 자식부터_끈다() {
        let ps = "  1 0\n 10 1\n 11 10\n 12 11\n 13 10\n 20 1";
        let got = descendants(ps, 10);
        assert_eq!(got.last(), Some(&10));
        assert_eq!(got.len(), 4);
        assert!(got.iter().position(|p| *p == 12) < got.iter().position(|p| *p == 11));
        assert!(!got.contains(&20));
    }
}
