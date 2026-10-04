//! 지금 돌고 있는 Claude Code 세션.
//!
//! 하네스는 **정적인 구조**이고 세션은 **그 구조가 실제로 쓰이는 순간**이다.
//! 둘을 한 화면에서 보면 "이 설정이 지금 누구에게 적용되고 있나"에 답할 수 있다.
//!
//! ## 무엇을 활성으로 볼 것인가 (2026-08-28 실측으로 정함)
//!
//! 후보가 셋이었고 하나씩 재봤다:
//!
//! | 방법 | 결과 |
//! |---|---|
//! | `~/.claude/ide` 락 | **비어 있다.** IDE 확장을 안 쓰면 아무것도 안 남는다 |
//! | jsonl mtime | 프로젝트는 알지만 **끝난 세션과 도는 세션을 구분 못 한다** |
//! | `claude` 프로세스 | 4개 모두 정확. cwd 로 프로젝트까지 안다 |
//!
//! 그래서 **프로세스가 진실의 원천**이고, jsonl mtime 은 거기에 "마지막으로 움직인 때"를
//! 붙이는 보조 자료로 쓴다. 실측에서 프로세스 4개와 최근 1시간 jsonl 4개가 정확히 맞았다.
//!
//! ## 도구 선택에서 실제로 틀렸던 것
//!
//! - **`pgrep`은 쓰지 않는다.** `pgrep -x claude` 가 세션 4개 중 3개만 잡았다 —
//!   Harnitor 를 띄운 그 세션 자신이 빠졌다. 자기 자신을 못 세는 모니터는 쓸 수 없다.
//!   `ps -Ao pid=,comm=` 를 직접 걸러 쓴다.
//! - **`lsof` 는 `-a` 가 없으면 필터가 무시된다.** `lsof -c claude -d cwd` 는 claude 와
//!   무관한 프로세스를 전부 뱉는다. `-a`(AND) 를 반드시 붙인다.
//! - pid 를 한 번에 넘기면 **25ms** 에 끝난다. 프로세스마다 부르면 그만큼 곱해진다.

use crate::model::Session;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

/// 절대경로로 부른다. **앱은 터미널이 아니다** — GUI 로 띄우면 `PATH` 가 최소한이라
/// 이름만으로는 못 찾는 일이 생긴다. 특히 `lsof` 는 `/usr/sbin` 에 있어서
/// 로그인 셸의 `PATH` 를 물려받지 못하면 조용히 실패하고, 세션이 0개로 보인다.
const PS: &str = "/bin/ps";
const LSOF: &str = "/usr/sbin/lsof";

/// `ps -Ao pid=,comm=,args=` 출력에서 claude 세션만 고른다.
///
/// `comm` 이 정확히 `claude` 인 것만 센다. 부분 일치로 하면
/// `claude-ville`, `claudecode-something` 같은 것이 섞인다.
pub fn parse_ps(out: &str) -> Vec<u32> {
    out.lines()
        .filter_map(|line| {
            let mut it = line.split_whitespace();
            let pid: u32 = it.next()?.parse().ok()?;
            let comm = it.next()?;
            // comm 은 경로가 붙어 나올 수 있다 (`/usr/local/bin/claude`)
            let base = comm.rsplit('/').next().unwrap_or(comm);
            (base == "claude").then_some(pid)
        })
        .collect()
}

/// `ps -o etime=` 의 경과 시간을 초로. 형식이 셋이다:
/// `MM:SS` / `HH:MM:SS` / `DD-HH:MM:SS`
pub fn parse_etime(s: &str) -> u64 {
    let s = s.trim();
    let (days, rest) = match s.split_once('-') {
        Some((d, r)) => (d.parse::<u64>().unwrap_or(0), r),
        None => (0, s),
    };
    let parts: Vec<u64> = rest.split(':').map(|p| p.parse().unwrap_or(0)).collect();
    let hms = match parts.len() {
        3 => parts[0] * 3600 + parts[1] * 60 + parts[2],
        2 => parts[0] * 60 + parts[1],
        1 => parts[0],
        _ => 0,
    };
    days * 86_400 + hms
}

/// `lsof -a -p <pids> -d cwd -Fpn` 출력을 pid → cwd 로.
///
/// 필드 형식은 한 줄에 하나씩이고 `p<pid>` 다음에 그 프로세스의 `n<경로>`가 온다.
pub fn parse_lsof(out: &str) -> BTreeMap<u32, PathBuf> {
    let mut map = BTreeMap::new();
    let mut cur: Option<u32> = None;
    for line in out.lines() {
        let (tag, val) = match line.split_at_checked(1) {
            Some(x) => x,
            None => continue,
        };
        match tag {
            "p" => cur = val.parse().ok(),
            "n" => {
                if let Some(pid) = cur {
                    // 한 프로세스에 cwd 는 하나뿐이다. 먼저 온 것을 쓴다.
                    map.entry(pid).or_insert_with(|| PathBuf::from(val));
                }
            }
            _ => {}
        }
    }
    map
}

/// 프로젝트 경로 → `~/.claude/projects/` 아래 폴더 이름.
///
/// Claude Code 는 `/` 와 `.` 를 모두 `-` 로 바꾼다. 그래서
/// `…/project-a/.claude/worktrees/oms` 가 `…-project-a--claude-worktrees-oms` 가 된다
/// (`/.` 가 `--` 로 겹치는 것이지 규칙이 둘인 게 아니다).
pub fn encode_project_dir(path: &Path) -> String {
    path.to_string_lossy()
        .chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect()
}

/// 이 시간 안에 세션 기록이 쓰였으면 **지금 뭔가 하는 중**으로 본다.
///
/// 5분은 "사람이 읽고 생각하는 사이"까지 활동으로 쳐 주는 길이다. 더 짧게 잡으면
/// 답을 기다리는 세션이 죽은 것처럼 보이고, 더 길게 잡으면 어제 켜둔 창까지 살아 있다고 한다.
pub const ACTIVE_WINDOW_SECS: u64 = 300;

/// 지금 움직이고 있나. 활동 기록이 아예 없으면 판단하지 않고 `false` 다 —
/// **모르는 것을 활동으로 세지 않는다.**
pub fn is_active(s: &Session) -> bool {
    s.idle_secs.is_some_and(|d| d < ACTIVE_WINDOW_SECS)
}

/// 메뉴바에 얹을 짧은 글. macOS 메뉴바는 좁아서 숫자 말고는 들어갈 자리가 없다.
///
/// - 세션이 없으면 빈 문자열 — 아이콘만 남긴다. "0"을 띄우는 것과 아무것도 안 띄우는 것은
///   다른 말이고, 안 돌 때 굳이 자리를 차지할 이유가 없다.
/// - 전부 활동 중이면 총 개수만. 굳이 `4/4` 라고 쓰면 읽는 사람이 분수의 뜻을 한 번 더 생각한다.
/// - 일부만 활동 중이면 `활동/전체`.
pub fn tray_title(list: &[Session]) -> String {
    let total = list.len();
    if total == 0 {
        return String::new();
    }
    let hot = list.iter().filter(|s| is_active(s)).count();
    if hot == total {
        total.to_string()
    } else {
        format!("{hot}/{total}")
    }
}

/// 초를 사람이 읽는 길이로. **큰 단위 하나만** 쓴다 —
/// "1시간 12분 5초"는 정확하지만, 목록에서 훑을 때는 자릿수가 맞는 편이 낫다.
pub fn human_secs(secs: u64, lang: crate::i18n::Lang) -> String {
    let ko = lang.is_ko();
    match secs {
        s if s < 60 => {
            if ko {
                format!("{s}초")
            } else {
                format!("{s}s")
            }
        }
        s if s < 3600 => {
            let v = s / 60;
            if ko {
                format!("{v}분")
            } else {
                format!("{v}m")
            }
        }
        s if s < 86_400 => {
            let v = s / 3600;
            if ko {
                format!("{v}시간")
            } else {
                format!("{v}h")
            }
        }
        s => {
            let v = s / 86_400;
            if ko {
                format!("{v}일")
            } else {
                format!("{v}d")
            }
        }
    }
}

/// 세션 목록을 읽는다.
///
/// **부분 실패로 죽지 않는다**(절대원칙 9). `ps` 가 없거나 `lsof` 가 막히면
/// 아는 만큼만 채운 결과를 낸다 — 세션을 못 읽는 것이 스캔 전체를 무너뜨릴 이유는 없다.
pub fn scan_sessions(home: &Path) -> Vec<Session> {
    let ps_out = match Command::new(PS).args(["-Ao", "pid=,comm=,args="]).output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).into_owned(),
        Err(_) => return Vec::new(),
    };
    let pids = parse_ps(&ps_out);
    if pids.is_empty() {
        return Vec::new();
    }

    // cwd 는 한 번에 묻는다 (실측 25ms). 실패해도 pid 목록은 살린다.
    let joined = pids
        .iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let cwds = Command::new(LSOF)
        .args(["-a", "-p", &joined, "-d", "cwd", "-Fpn"])
        .output()
        .map(|o| parse_lsof(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default();

    let uptimes = read_uptimes(&pids);
    let now = now_secs();

    let mut out: Vec<Session> = pids
        .into_iter()
        .map(|pid| {
            let cwd = cwds.get(&pid).cloned();
            let (last_active, session_id) = cwd
                .as_deref()
                .map(|c| latest_session_file(home, c))
                .unwrap_or((None, None));
            Session {
                pid,
                cwd: cwd.clone(),
                project: cwd.as_deref().and_then(project_name_of),
                uptime_secs: uptimes.get(&pid).copied().unwrap_or(0),
                idle_secs: last_active.map(|t| now.saturating_sub(t)),
                last_active,
                session_id,
            }
        })
        .collect();
    // 방금 움직인 것이 위로. 활동 기록이 없는 것은 뒤로 민다.
    out.sort_by_key(|s| (s.idle_secs.unwrap_or(u64::MAX), s.pid));
    out
}

fn read_uptimes(pids: &[u32]) -> BTreeMap<u32, u64> {
    let joined = pids
        .iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let Ok(o) = Command::new("ps")
        .args(["-o", "pid=,etime=", "-p", &joined])
        .output()
    else {
        return BTreeMap::new();
    };
    String::from_utf8_lossy(&o.stdout)
        .lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let pid: u32 = it.next()?.parse().ok()?;
            Some((pid, parse_etime(it.next()?)))
        })
        .collect()
}

/// 그 폴더에서 가장 최근에 쓰인 세션 파일의 (수정시각, 세션 id).
///
/// ⚠️ **한계를 알고 쓴다.** 프로세스는 세션 파일을 열어두지 않아서(append 후 닫는다)
/// pid 와 세션 파일을 정확히 이을 방법이 없다. 같은 폴더에서 두 세션이 동시에 돌면
/// 둘 다 같은 파일을 가리키게 된다. 그래서 이 값은 "이 프로젝트가 마지막으로 움직인 때"이지
/// "이 프로세스가 마지막으로 움직인 때"가 아니다.
fn latest_session_file(home: &Path, cwd: &Path) -> (Option<u64>, Option<String>) {
    let dir = home.join(".claude/projects").join(encode_project_dir(cwd));
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return (None, None);
    };
    let mut best: Option<(u64, String)> = None;
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(m) = e.metadata() else { continue };
        let Ok(t) = m.modified() else { continue };
        let secs = t
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let id = p
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        if best.as_ref().is_none_or(|(bt, _)| secs > *bt) {
            best = Some((secs, id));
        }
    }
    match best {
        Some((t, id)) => (Some(t), Some(id)),
        None => (None, None),
    }
}

fn project_name_of(cwd: &Path) -> Option<String> {
    cwd.file_name().map(|n| n.to_string_lossy().into_owned())
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sess(pid: u32, idle: Option<u64>) -> Session {
        Session {
            pid,
            cwd: Some(PathBuf::from("/tmp/x")),
            project: Some("x".into()),
            uptime_secs: 10,
            last_active: idle.map(|_| 0),
            idle_secs: idle,
            session_id: None,
        }
    }

    #[test]
    fn 시간은_큰_단위_하나로만_적는다() {
        use crate::i18n::Lang::{En, Ko};
        assert_eq!(human_secs(45, Ko), "45초");
        assert_eq!(human_secs(45, En), "45s");
        assert_eq!(human_secs(59, Ko), "59초");
        assert_eq!(human_secs(60, Ko), "1분");
        assert_eq!(human_secs(3599, Ko), "59분");
        assert_eq!(human_secs(3600, En), "1h");
        assert_eq!(human_secs(86_399, En), "23h");
        assert_eq!(human_secs(86_400, Ko), "1일");
    }

    #[test]
    fn 활동_기준은_5분이고_경계는_미만이다() {
        assert!(is_active(&sess(1, Some(0))));
        assert!(is_active(&sess(1, Some(299))));
        assert!(!is_active(&sess(1, Some(300))));
    }

    #[test]
    fn 활동_기록이_없으면_활동으로_세지_않는다() {
        assert!(!is_active(&sess(1, None)));
    }

    #[test]
    fn 메뉴바_글은_없으면_비고_전부_활동이면_총계다() {
        assert_eq!(tray_title(&[]), "");
        assert_eq!(tray_title(&[sess(1, Some(3)), sess(2, Some(9))]), "2");
    }

    #[test]
    fn 일부만_활동이면_활동_분의_전체다() {
        let list = [sess(1, Some(3)), sess(2, Some(9000)), sess(3, None)];
        assert_eq!(tray_title(&list), "1/3");
    }

    #[test]
    fn ps_는_claude_만_고른다() {
        // 실제 출력을 옮긴 것이다. tmux·Chrome 처럼 이름에 claude 가 스치는 줄이 섞인다.
        let out = "\
 1591 tmux            tmux -CC new-session -s claude-team
 1822 claude          claude --dangerously-skip-permissions
 3696 claude          claude --dangerously-skip-permissions
  340 Google          /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
 9001 claude-ville    node claude-ville/server.js
";
        assert_eq!(parse_ps(out), vec![1822, 3696]);
    }

    #[test]
    fn ps_는_경로가_붙은_comm_도_읽는다() {
        assert_eq!(
            parse_ps(" 42 /usr/local/bin/claude claude --resume\n"),
            vec![42]
        );
    }

    #[test]
    fn etime_세_형식을_모두_읽는다() {
        assert_eq!(parse_etime("03:44"), 224);
        assert_eq!(parse_etime("07:12:05"), 25_925);
        assert_eq!(parse_etime("01-04:29:11"), 102_551);
        assert_eq!(parse_etime("  02:00  "), 120);
    }

    #[test]
    fn etime_이_깨져도_0_이지_패닉이_아니다() {
        assert_eq!(parse_etime(""), 0);
        assert_eq!(parse_etime("nonsense"), 0);
        assert_eq!(parse_etime("--:--"), 0);
    }

    #[test]
    fn lsof_출력을_pid별_cwd로_묶는다() {
        let out = "p1822\nfcwd\nn/Users/me/dev/project-a\np3696\nfcwd\nn/Users/me/dev/Harnitor\n";
        let m = parse_lsof(out);
        assert_eq!(m.get(&1822).unwrap(), Path::new("/Users/me/dev/project-a"));
        assert_eq!(m.get(&3696).unwrap(), Path::new("/Users/me/dev/Harnitor"));
    }

    #[test]
    fn lsof_에_경로가_여럿이면_첫_것만_쓴다() {
        // cwd 는 하나뿐이지만 출력이 늘어나도 뒤엣것이 앞을 덮지 않아야 한다
        let out = "p7\nfcwd\nn/first\nn/second\n";
        assert_eq!(parse_lsof(out).get(&7).unwrap(), Path::new("/first"));
    }

    #[test]
    fn lsof_가_비어도_빈_맵이다() {
        assert!(parse_lsof("").is_empty());
        assert!(parse_lsof("garbage\n\n").is_empty());
    }

    #[test]
    fn 프로젝트_폴더_이름은_슬래시와_점을_모두_바꾼다() {
        assert_eq!(
            encode_project_dir(Path::new("/Users/me/Desktop/dev/Harnitor")),
            "-Users-me-Desktop-dev-Harnitor"
        );
        // 워크트리처럼 숨김 폴더가 끼면 `/.` 가 `--` 로 겹친다 (실측)
        assert_eq!(
            encode_project_dir(Path::new("/Users/me/dev/project-a/.claude/worktrees/oms")),
            "-Users-me-dev-project-a--claude-worktrees-oms"
        );
    }
}
