//! 부하 모니터 재료 — ps·sysctl 원문만 준다. 세션별로 가르는 건 프론트 domain/load.ts(테스트가 거기 있다).
//! ps 한 번이 30ms 안팎이라 상단 바 10초·부하 화면 3초 주기로 불러도 가볍다(2026-09-28 실측)
use serde::Serialize;

fn out(cmd: &str, args: &[&str]) -> String {
    crate::platform::command(cmd).args(args).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
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
    tauri::async_runtime::spawn_blocking(sample)
    .await
    .unwrap_or(LoadRaw { ps: String::new(), sys: String::new() })
}

#[cfg(not(windows))]
fn sample() -> LoadRaw {
    LoadRaw {
        ps: out("/bin/ps", &["-axo", "pid=,ppid=,pcpu=,rss=,etime=,args="]),
        sys: out("/usr/sbin/sysctl", &["-n", "hw.ncpu", "vm.loadavg", "vm.swapusage", "hw.memsize"]),
    }
}

/// 윈도우엔 ps·sysctl 이 없다 — sysinfo 로 읽어 맥과 같은 모양 글로(프론트 해석·테스트를 그대로 쓴다).
/// CPU % 는 앞 번 측정과의 차이라 System 을 붙들고 있는다(첫 번은 0). 1분 부하는 없어서 "전체 CPU % × 코어 수" 로 갈음
#[cfg(windows)]
fn sample() -> LoadRaw {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    static SYS: std::sync::Mutex<Option<System>> = std::sync::Mutex::new(None);
    let mut guard = SYS.lock().unwrap_or_else(|e| e.into_inner());
    let sys = guard.get_or_insert_with(System::new);
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_memory().with_cpu().with_cmd(UpdateKind::OnlyIfNotSet).with_exe(UpdateKind::OnlyIfNotSet),
    );
    let mut ps = String::new();
    for (pid, p) in sys.processes() {
        let cmd = p.cmd().iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" ");
        let cmd = if cmd.trim().is_empty() { p.exe().map(|e| e.to_string_lossy().into_owned()).unwrap_or_else(|| p.name().to_string_lossy().into_owned()) } else { cmd };
        ps.push_str(&ps_line(pid.as_u32(), p.parent().map(|x| x.as_u32()).unwrap_or(0), p.cpu_usage(), p.memory() / 1024, p.run_time(), &cmd));
        ps.push('\n');
    }
    let cores = sys.cpus().len().max(1);
    let sys_text = sys_lines(cores, sys.global_cpu_usage(), sys.used_swap(), sys.total_swap(), sys.total_memory());
    LoadRaw { ps, sys: sys_text }
}

/// 맥 `ps -axo pid=,ppid=,pcpu=,rss=,etime=,args=` 한 줄 모양
#[cfg_attr(not(windows), allow(dead_code))]
pub fn ps_line(pid: u32, ppid: u32, cpu: f32, rss_kb: u64, secs: u64, cmd: &str) -> String {
    let (d, h, m, s) = (secs / 86400, secs % 86400 / 3600, secs % 3600 / 60, secs % 60);
    let etime = if d > 0 { format!("{d}-{h:02}:{m:02}:{s:02}") } else if h > 0 { format!("{h:02}:{m:02}:{s:02}") } else { format!("{m:02}:{s:02}") };
    format!("{pid} {ppid} {cpu:.1} {rss_kb} {etime} {}", cmd.replace('\n', " "))
}

/// 맥 `sysctl -n hw.ncpu vm.loadavg vm.swapusage hw.memsize` 네 줄 모양. 부하 = 전체 CPU % × 코어 수 / 100
#[cfg_attr(not(windows), allow(dead_code))]
pub fn sys_lines(cores: usize, cpu_pct: f32, swap_used: u64, swap_total: u64, mem_total: u64) -> String {
    let load = cpu_pct as f64 * cores as f64 / 100.0;
    let mb = |b: u64| b as f64 / 1024.0 / 1024.0;
    format!(
        "{cores}\n{{ {load:.2} {load:.2} {load:.2} }}\ntotal = {:.2}M  used = {:.2}M  free = {:.2}M\n{mem_total}",
        mb(swap_total),
        mb(swap_used),
        mb(swap_total.saturating_sub(swap_used))
    )
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
    if cfg!(windows) {
        let _ = pid;
        return Err(crate::i18n::tr("윈도우에선 누가 띄운 프로세스인지 확인할 수 없어 끄지 않아요", "On Windows the owner can't be checked — left alone").into());
    }
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
            let _ = crate::platform::command("/bin/kill").args(["-TERM", &p.to_string()]).status();
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

/// scripts/slot 의 자리와 TTL(초) — 넘으면 다음 사람이 넘겨받는다. 바꾸면 scripts/slot TTL 도
pub const SLOT_TTL: [(&str, u64); 3] = [("build", 45 * 60), ("ios", 60 * 60), ("galaxy", 30 * 60)];

/// 폰 /api/load — 앱이 적는 load.json 그대로 + 자리 파일(<데이터>/slots/<자리>.json)의 주인·시각·처음 잡은 때 + 쥔 세션 이름·바쁜지(live.json). 읽기만(폰은 보기만, 끄기는 데스크톱).
/// 나이는 폰 시계 말고 맥 시각(now)으로 잰다. 없거나 깨진 파일·너무 큰 파일은 null
pub fn phone_load(dir: &std::path::Path, now: u64) -> serde_json::Value {
    use serde_json::{json, Value};
    let read = |p: std::path::PathBuf| -> Option<Value> {
        if std::fs::metadata(&p).ok()?.len() > 512 * 1024 {
            return None;
        }
        serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
    };
    // 쥔 세션이 바쁜지 — 앱이 적는 live.json(sessionId·name·busy). 이 함수는 앱 안에서 도니 앱은 떠 있다
    let live = read(dir.join("live.json")).and_then(|v| v["sessions"].as_array().cloned());
    let slot = |name: &str| {
        read(dir.join("slots").join(format!("{name}.json")))
            .filter(|h| h["owner"].is_string() && h["ts"].is_number())
            .map(|h| {
                let mut o = json!({ "owner": h["owner"], "ts": h["ts"] });
                if h["since"].is_number() {
                    o["since"] = h["since"].clone();
                }
                if let (Some(sid), Some(live)) = (h["session"].as_str().filter(|s| !s.is_empty()), &live) {
                    match live.iter().find(|s| s["sessionId"].as_str() == Some(sid)) {
                        Some(s) => {
                            o["state"] = json!(if s["busy"].as_bool() == Some(true) { "busy" } else { "idle" });
                            if s["name"].is_string() {
                                o["who"] = s["name"].clone();
                            }
                        }
                        None => o["state"] = json!("gone"),
                    }
                }
                o
            })
            .unwrap_or(Value::Null)
    };
    json!({
        "now": now,
        "load": read(dir.join("load.json")).unwrap_or(Value::Null),
        "slots": SLOT_TTL.iter().map(|(n, _)| (n.to_string(), slot(n))).collect::<serde_json::Map<_, _>>(),
        "ttl": SLOT_TTL.iter().map(|(n, t)| (n.to_string(), json!(t))).collect::<serde_json::Map<_, _>>(),
    })
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
    fn 윈도우_값을_맥_ps_모양으로() {
        assert_eq!(ps_line(42, 7, 12.34, 2048, 65, "C:\\x\\claude.exe attach a"), "42 7 12.3 2048 01:05 C:\\x\\claude.exe attach a");
        assert_eq!(ps_line(1, 0, 0.0, 1, 90061, "a\nb"), "1 0 0.0 1 1-01:01:01 a b");
        assert_eq!(ps_line(1, 0, 0.0, 1, 3700, "x"), "1 0 0.0 1 01:01:40 x");
        let t = sys_lines(8, 50.0, 1024 * 1024 * 1024, 4 * 1024 * 1024 * 1024, 16 * 1024 * 1024 * 1024);
        assert_eq!(t, "8\n{ 4.00 4.00 4.00 }\ntotal = 4096.00M  used = 1024.00M  free = 3072.00M\n17179869184");
    }

    #[test]
    fn 자리_ttl_은_scripts_slot_과_같다() {
        // 공개본엔 scripts/slot 이 없을 수 있다 — 있을 때만 대조
        let Ok(py) = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripts/slot")) else { return };
        assert!(py.contains("TTL = {'build': 45 * 60, 'ios': 60 * 60, 'galaxy': 30 * 60}"), "scripts/slot TTL 이 바뀌면 SLOT_TTL 도");
        assert_eq!(SLOT_TTL.map(|(n, t)| (n, t)), [("build", 2700), ("ios", 3600), ("galaxy", 1800)]);
    }

    #[test]
    fn 자리는_쥔_세션_이름과_바쁜지까지() {
        // 2026-10-05 — 폰에서 '누가 자리를 쥐고 멈춰 있나'가 안 보였다. 세션은 앱이 적는 live.json 으로
        let d = std::env::temp_dir().join(format!("slot-load-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("slots")).unwrap();
        std::fs::write(d.join("slots/build.json"), r#"{"owner":"hello-docs","ts":2000.5,"since":1000,"session":"aaaa1111-x","pid":42,"child":43}"#).unwrap();
        std::fs::write(d.join("slots/ios.json"), r#"{"owner":"project-x-app","ts":1500,"session":"bbbb2222-x"}"#).unwrap();
        std::fs::write(d.join("slots/galaxy.json"), r#"{"owner":"project-b-platform","ts":1500}"#).unwrap();
        std::fs::write(d.join("live.json"), r#"{"daemon":1,"sessions":[{"sessionId":"aaaa1111-x","name":"앱 기기 점검","busy":true}],"lost":[]}"#).unwrap();
        let v = phone_load(&d, 3000);
        assert_eq!(v["slots"]["build"], serde_json::json!({ "owner": "hello-docs", "ts": 2000.5, "since": 1000, "state": "busy", "who": "앱 기기 점검" }));
        assert_eq!(v["slots"]["ios"]["state"], "gone", "목록에 없는 세션");
        assert_eq!(v["slots"]["galaxy"], serde_json::json!({ "owner": "project-b-platform", "ts": 1500 }), "세션을 모르면 주인·시각만(예전 자리 파일)");
        // live.json 이 없으면 상태를 모른다 — 없음으로 단정하지 않는다
        std::fs::remove_file(d.join("live.json")).unwrap();
        assert_eq!(phone_load(&d, 3000)["slots"]["build"].get("state"), None);
        let _ = std::fs::remove_dir_all(&d);
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
