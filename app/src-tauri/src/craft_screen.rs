//! Craft 맥 앱 전용 레티나 가짜 화면(2026-10-16 사용자 "왜 저렇노" — 1배 화면에 비추면 흐리다).
//! 세션 크롬의 1배 화면(vdisplay, "Chammo agents")은 그대로 두고, 같은 도우미를 `--hidpi` 로 하나 더 띄운다 — 1440×900 점에 2배 픽셀.
//! 제조사 번호를 앱 화면(0x4348)과 다르게(0x5A5A): 같으면 맥이 앞 화면을 빼 버린다(10/16 실측).
//! 생김: scripts/craft open --native 가 띄우기 전에 app.jsonl craft screen 으로 부탁 → 자리는 <데이터>/craft-native/screen.json.
//! 없앰: 만든 지 2분이 지났고 떠 있는 Craft 맥 앱(scripts/craft 상태 파일의 pid)이 두 번 연달아(10초 간격) 없을 때 — 처음 설치처럼
//! 화면 부탁 뒤 pid 를 적기까지 오래 걸려도 그 사이에 지우지 않게. 앱이 꺼질 때도
use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::sync::Mutex;

pub const NAME: &str = "Chammo craft";
const VENDOR: u32 = 0x5A5A;
const SERIAL: u32 = 3;
/// 점 크기 — 가장 큰 칸(따로 창 화면의 85%·스페이스 칸)이 들어가게. 2배라 3840x2400 픽셀(10/16 사용자 "비좁아터졌다")
pub const SIZE: (u32, u32) = (1920, 1200);

struct Running {
    child: Child,
    id: Option<u32>,
    born: std::time::Instant,
    /// 지금 배율(1·2) — Chammo 창이 있는 화면을 따라간다(watch_scale)
    scale: u32,
    /// 꺼질 때 저장 중인 Craft 앱을 넘겼다 — 도우미는 그 앱들이 꺼질 때까지 남는다(기다리지 않는다)
    lingering: bool,
}

/// 만든 뒤 이 시간 동안은 비어 보여도 안 지운다(DMG 설치·첫 띄우기가 길다)
const GRACE_SECS: u64 = 120;

/// 지울 때인가 — 유예가 지났고 두 번 연달아 비었을 때만
pub fn should_stop(age_secs: u64, idle_streak: u32) -> bool {
    age_secs >= GRACE_SECS && idle_streak >= 2
}
static RUN: Mutex<Option<Running>> = Mutex::new(None);

fn file() -> std::path::PathBuf {
    crate::config::data_dir().join("craft-native").join("screen.json")
}

/// 지금 Craft 화면 번호 — 다른 화면 고르기(세션 크롬·개발판 창)에서 뺀다
pub fn id() -> Option<u32> {
    RUN.lock().ok().and_then(|g| g.as_ref().and_then(|r| r.id))
}

/// 도우미에 줄 인자 — 레티나·이름·번호
pub fn helper_args() -> Vec<String> {
    let (w, h) = SIZE;
    vec!["--hidpi".into(), "--width".into(), w.to_string(), "--height".into(), h.to_string(), "--name".into(), NAME.into(), "--vendor".into(), VENDOR.to_string(), "--serial".into(), SERIAL.to_string()]
}

/// 자리 파일 내용
pub fn screen_json(pid: u32, id: u32, r: crate::vdisplay::Rect, scale: u32) -> String {
    serde_json::json!({ "pid": pid, "displayID": id, "bounds": [r.x, r.y, r.w, r.h], "scale": scale }).to_string()
}

/// Chammo 창이 있는 화면 배율 → Craft 화면 배율(1배 외장이면 1, 레티나면 2) — 점 단위 1:1 이라 앱 UI·캔버스가 진짜 앱과 같은 크기로 보인다
pub fn want_scale(monitor_scale: f64) -> u32 {
    if monitor_scale >= 1.5 { 2 } else { 1 }
}

fn write_file(pid: u32, id: u32, r: crate::vdisplay::Rect) {
    let scale = RUN.lock().ok().and_then(|g| g.as_ref().map(|x| x.scale)).unwrap_or(2);
    let p = file();
    if let Some(d) = p.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let tmp = p.with_extension("json.tmp");
    if std::fs::write(&tmp, screen_json(pid, id, r, scale)).is_ok() {
        let _ = std::fs::rename(&tmp, &p);
    }
}

/// 화면이 있으면 그 자리, 없으면 띄우고 자리를 적는다
pub fn ensure() -> Result<crate::vdisplay::Rect, String> {
    // 세션 크롬 가짜 화면과 같은 규칙 — 개발판 시험처럼 화면을 더 만들면 안 될 때(scripts/craft 는 1배 화면이나 보통 창으로 간다)
    if std::env::var("CHAMMO_VDISPLAY").is_ok_and(|v| v == "0") {
        return Err("virtual displays are off (CHAMMO_VDISPLAY=0)".into());
    }
    if let Some(r) = id().and_then(crate::vdisplay::display_rect) {
        return Ok(r);
    }
    stop();
    let exe = crate::vdisplay::helper_exe().ok_or("no virtual display on this Mac")?;
    let mut child = crate::platform::command(&exe).args(helper_args()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let out = child.stdout.take().ok_or("no output")?;
    let mut lines = BufReader::new(out).lines();
    let first = lines.next().and_then(Result::ok).ok_or("helper did not answer")?;
    let (id, _) = crate::vdisplay::parse_line(&first).ok_or_else(|| format!("helper: {first}"))?;
    *RUN.lock().unwrap() = Some(Running { child, id: Some(id), born: std::time::Instant::now(), scale: 2, lingering: false });
    // 도우미 첫 줄은 맥이 자리를 잡기 전 값일 수 있다 — 잠깐 뒤 진짜 자리
    std::thread::sleep(std::time::Duration::from_millis(800));
    let r = crate::vdisplay::display_rect(id).ok_or("craft screen has no place yet")?;
    write_file(pid, id, r);
    // 배치가 바뀌면(외장 모니터 등) 도우미가 다시 찍는다 — 자리 파일을 따라 고친다
    std::thread::spawn(move || {
        for line in lines.map_while(Result::ok) {
            if let Some((id, _)) = crate::vdisplay::parse_line(&line) {
                if let Some(r) = crate::vdisplay::display_rect(id) {
                    write_file(pid, id, r);
                }
            }
        }
    });
    Ok(r)
}

/// 도우미를 끈다(입력을 닫으면 화면을 지우고 끝난다) + 자리 파일 지우기
pub fn stop() {
    let run = RUN.lock().ok().and_then(|mut g| g.take());
    if let Some(mut r) = run {
        drop(r.child.stdin.take());
        if !r.lingering {
            let _ = r.child.wait();
        }
    }
    let _ = std::fs::remove_file(file());
}

/// 지금 떠 있는 Craft 맥 앱이 있나 — scripts/craft 상태 파일(<데이터>/craft-native/<앱>.json)의 pid 로
pub fn any_running(data_dir: &std::path::Path, alive: impl Fn(i32) -> bool) -> bool {
    !running(data_dir, alive).is_empty()
}

/// 떠 있는 인스턴스 키 — 같은 앱이 세션마다 따로 떠 있으면 다 ('photocraft', 'photocraft-2' …)
pub fn running(data_dir: &std::path::Path, alive: impl Fn(i32) -> bool) -> Vec<String> {
    crate::craft_window::keys().into_iter().filter(|k| crate::craft_window::read_info(data_dir, k).pid.is_some_and(&alive)).collect()
}

/// 그 pid 가 아직 그 앱인가 — 상태 파일의 exe(<앱>.app/Contents/MacOS)로 시작하는 실행 파일만. 옛 상태 파일(exe 없음)은 맥 앱 모양이면
pub fn same_app(comm: &str, exe: Option<&str>) -> bool {
    match exe {
        Some(e) if !e.is_empty() => comm.starts_with(e) || comm.to_lowercase().starts_with(&e.to_lowercase()), // 윈도우 경로는 대소문자가 섞여 온다
        _ => comm.contains(".app/Contents/MacOS/"),
    }
}

/// 앱이 꺼질 때 할 일 — 가짜 화면 앱은 "close"(바뀐 게 있으면 저장 후 끄기), 사람 화면에 꺼내 둔 앱(here)은 "save"(끄지 않고 저장만).
/// pid 가 다른 프로그램으로 바뀌었으면 손대지 않는다(None)
pub fn exit_verb(state: &serde_json::Value, comm: &str) -> Option<&'static str> {
    if !same_app(comm, state["exe"].as_str()) {
        return None;
    }
    Some(if state["here"].as_bool() == Some(true) { "save" } else { "close" })
}

/// 종료 창(⌥⌘Q)이 저장을 이미 시작했나 — 그러면 꺼질 때 다시 안 돌리고 안 기다린다
static QUIT_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// SIGTERM 으로 꺼지는 중 — 2초 뒤 KILL 이 올 수 있어(install-personal-app) 기다리지 않는다
pub static SIGTERM: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 도우미에 넘길 줄 — 이 pid 들이 꺼질 때까지 Chammo 가 꺼져도 화면을 살려 둔다
pub fn linger_line(pids: &[i32]) -> String {
    std::iter::once("linger".to_string()).chain(pids.iter().map(|p| p.to_string())).collect::<Vec<_>>().join(" ")
}

/// 꺼질 때 저장을 얼마나 기다리나 — 종료 창이 이미 기다렸거나(건너뛰기 포함) SIGTERM 이면 0, 그 밖(독 종료·업데이트·설치 스크립트)은 3초.
/// 나머지는 도우미가 화면을 살려 둔 채 Craft 가 마저 저장하고 스스로 꺼진다
pub fn exit_wait(dialog: bool, sigterm: bool) -> std::time::Duration {
    if dialog || sigterm { std::time::Duration::ZERO } else { std::time::Duration::from_secs(3) }
}

/// 그 pid 의 실행 파일 — 맥은 ps comm, 윈도우는 ps 가 없어 sysinfo(상태 파일 exe 와 대조 — same_app)
fn proc_exe(pid: i64) -> String {
    #[cfg(windows)]
    {
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
        let p = Pid::from_u32(pid as u32);
        let mut s = System::new();
        s.refresh_processes_specifics(ProcessesToUpdate::Some(&[p]), true, ProcessRefreshKind::nothing().with_exe(UpdateKind::Always));
        s.process(p).and_then(|x| x.exe()).map(|e| e.to_string_lossy().into_owned()).unwrap_or_default()
    }
    #[cfg(not(windows))]
    crate::platform::command("ps").args(["-o", "comm=", "-p", &pid.to_string()]).output().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()
}

/// 떠 있는 Craft 앱마다 scripts/craft close|save 를 뒤에서 — 저장을 맡긴 앱 이름들(pid 가 다른 프로그램이면 뺀다)
fn start_closing() -> Vec<(String, i32)> {
    let d = crate::config::data_dir();
    let mut out = vec![];
    for a in running(d, crate::platform::pid_alive) {
        let st: serde_json::Value = std::fs::read_to_string(d.join("craft-native").join(format!("{a}.json"))).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let Some(pid) = st["pid"].as_i64() else { continue };
        let comm = proc_exe(pid);
        if let Some(verb) = exit_verb(&st, &comm) {
            if crate::craft_window::craft_cmd().args([verb.to_string(), crate::craft_window::arg(&a)]).spawn().is_ok() {
                out.push((a, pid as i32));
            }
        }
    }
    out
}

/// 종료 창(⌥⌘Q) — 저장을 시작하고 그 앱 이름(사람이 읽는)을 돌려준다. 빈 목록이면 바로 꺼도 된다
#[tauri::command]
pub fn craft_quit_start() -> Vec<String> {
    QUIT_STARTED.store(true, std::sync::atomic::Ordering::SeqCst);
    let d = crate::config::data_dir();
    start_closing().iter().map(|(a, _)| crate::craft_window::read_info(d, a).name).collect()
}

/// 종료 창 — 아직 저장하며 떠 있는 Craft 앱 이름
#[tauri::command]
pub fn craft_quit_left() -> Vec<String> {
    let d = crate::config::data_dir();
    running(d, crate::platform::pid_alive).iter().map(|a| crate::craft_window::read_info(d, a).name).collect()
}

/// 앱이 꺼질 때 — 떠 있는 Craft 앱마다 저장 후 끄기를 맡기고(종료 창이 이미 맡겼으면 그대로), 잠깐(exit_wait) 기다린 뒤
/// 아직 저장 중인 앱 pid 를 도우미에 넘긴다(linger). 도우미가 그 앱들이 꺼질 때까지 화면을 살려 둬서 Chammo 는 바로 꺼져도
/// 창이 사람 화면으로 튀지 않고 저장도 끝까지 간다(2026-10-19 끄기 QA — 예전엔 15초를 붙잡고, 넘으면 화면을 지워 고아가 됐다)
pub fn close_apps_on_exit() {
    use std::sync::atomic::Ordering;
    let dialog = QUIT_STARTED.load(Ordering::SeqCst);
    if !dialog {
        start_closing();
    }
    let d = crate::config::data_dir();
    let end = std::time::Instant::now() + exit_wait(dialog, SIGTERM.load(Ordering::SeqCst));
    while std::time::Instant::now() < end && any_running(d, crate::platform::pid_alive) {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let left: Vec<i32> = crate::craft_window::keys().iter().filter_map(|k| crate::craft_window::read_info(d, k).pid.filter(|p| crate::platform::pid_alive(*p))).collect();
    if !left.is_empty() {
        linger(&left);
    }
}

/// 도우미에 linger 줄 — 넘긴 뒤 stop() 은 도우미를 기다리지 않는다
fn linger(pids: &[i32]) {
    use std::io::Write;
    let Ok(mut g) = RUN.lock() else { return };
    let Some(r) = g.as_mut() else { return };
    if let Some(stdin) = r.child.stdin.as_mut() {
        if writeln!(stdin, "{}", linger_line(pids)).is_ok() {
            r.lingering = true;
        }
    }
}

/// 배율 바꾸기 — 도우미에 'scale N' 한 줄(같은 화면·같은 점 크기, 창은 그 자리). 바뀌었으면 자리 파일도
pub fn set_scale(want: u32) -> bool {
    use std::io::Write;
    let mut g = match RUN.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let Some(r) = g.as_mut() else { return false };
    if r.scale == want {
        return false;
    }
    let Some(stdin) = r.child.stdin.as_mut() else { return false };
    if writeln!(stdin, "scale {want}").is_err() {
        return false;
    }
    r.scale = want;
    let (pid, id) = (r.child.id(), r.id);
    drop(g);
    std::thread::sleep(std::time::Duration::from_millis(600));
    if let Some(id) = id {
        if let Some(rect) = crate::vdisplay::display_rect(id) {
            write_file(pid, id, rect);
        }
    }
    true
}

/// 2초마다 — Craft 화면이 있으면 Chammo 창(Craft 따로 창이 있으면 그 창, 없으면 메인 창)이 있는 화면 배율을 따라간다.
/// 1배 외장 모니터로 옮기면 1배, 맥북 화면이면 2배(10/16 사용자 '진짜 앱과 같은 크기·선명도')
pub fn watch_scale<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        if id().is_none() {
            continue;
        }
        let wins = app.webview_windows();
        let host = wins.iter().find(|(l, _)| crate::craft_window::is_craft_window(l)).map(|(_, w)| w.clone()).or_else(|| wins.get("main").cloned());
        let Some(sf) = host.and_then(|w| w.current_monitor().ok().flatten()).map(|m| m.scale_factor()) else { continue };
        set_scale(want_scale(sf));
    });
}

/// 10초마다 — 화면이 있는데 떠 있는 Craft 앱이 없으면 지운다(앱을 끄기 전에 지우면 그 창이 사람 화면으로 끌려온다). 유예·두 번 연달아는 should_stop
pub fn watch_idle() {
    std::thread::spawn(|| {
        let mut streak = 0u32;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(10));
            let age = RUN.lock().ok().and_then(|g| g.as_ref().map(|r| r.born.elapsed().as_secs()));
            let Some(age) = age else {
                streak = 0;
                continue;
            };
            streak = if any_running(crate::config::data_dir(), crate::platform::pid_alive) { 0 } else { streak + 1 };
            if should_stop(age, streak) {
                stop();
                streak = 0;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 윈도우는_exe_전체_경로로_대조_대소문자_무관() {
        let e = r"C:\Users\Me\AppData\Local\Programs\Chammo\Grid\gridcraft.exe";
        assert!(same_app(e, Some(e)));
        assert!(same_app(&e.to_lowercase(), Some(e)), "sysinfo 경로와 상태 파일 경로의 대소문자가 달라도");
        assert!(!same_app(r"C:\Windows\notepad.exe", Some(e)));
    }

    #[test]
    fn 꺼질_때_저장_중인_앱은_도우미가_화면을_살려_둔다() {
        assert_eq!(linger_line(&[101, 202]), "linger 101 202");
        assert_eq!(linger_line(&[]), "linger", "비우기");
    }

    #[test]
    fn 꺼질_때_기다림은_종료_창에서_이미_기다렸거나_SIGTERM_이면_0() {
        assert_eq!(exit_wait(false, false), std::time::Duration::from_secs(3), "독 종료·업데이트·설치 스크립트");
        assert_eq!(exit_wait(true, false), std::time::Duration::ZERO, "종료 창이 저장을 기다렸거나 건너뛰었다");
        assert_eq!(exit_wait(false, true), std::time::Duration::ZERO, "SIGTERM — 2초 뒤 KILL 이 온다(install-personal-app)");
    }

    #[test]
    fn 배율은_Chammo_창이_있는_화면을_따라간다() {
        assert_eq!(want_scale(1.0), 1, "1배 외장 모니터");
        assert_eq!(want_scale(2.0), 2, "맥북 레티나");
        assert_eq!(want_scale(1.25), 1);
    }

    #[test]
    fn 화면은_유예가_지나고_두_번_연달아_비었을_때만_지운다() {
        assert!(!should_stop(30, 5), "만든 지 얼마 안 됨(설치 중일 수 있다)");
        assert!(!should_stop(300, 1), "한 번 빈 걸로는 안 지움");
        assert!(should_stop(300, 2));
    }

    #[test]
    fn 끌_때는_그_앱인지_보고_꺼낸_앱은_저장만() {
        let st = serde_json::json!({"pid": 4242, "exe": "/Applications/Example.app/Contents/MacOS", "here": false});
        assert_eq!(exit_verb(&st, "/Applications/Example.app/Contents/MacOS/Example"), Some("close"));
        assert_eq!(exit_verb(&st, "/usr/bin/some-other"), None, "pid 가 다른 프로그램으로 재사용됨");
        let here = serde_json::json!({"pid": 4242, "exe": "/Applications/Example.app/Contents/MacOS", "here": true});
        assert_eq!(exit_verb(&here, "/Applications/Example.app/Contents/MacOS/Example"), Some("save"));
        let old = serde_json::json!({"pid": 4242});
        assert_eq!(exit_verb(&old, "/Applications/X.app/Contents/MacOS/X"), Some("close"), "옛 상태 파일은 맥 앱 모양이면");
        assert_eq!(exit_verb(&old, "/bin/zsh"), None);
    }

    #[test]
    fn 떠_있는_앱만_골라_끈다() {
        let d = std::env::temp_dir().join(format!("craft-run-{}", std::process::id()));
        let n = d.join("craft-native");
        std::fs::create_dir_all(&n).unwrap();
        std::fs::write(n.join("photocraft.json"), r#"{"pid":4242}"#).unwrap();
        std::fs::write(n.join("gridcraft.json"), r#"{"pid":4343}"#).unwrap();
        assert_eq!(running(&d, |p| p == 4242), vec!["photocraft"]);
        assert!(running(&d, |_| false).is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 도우미_인자는_레티나_이름_다른_제조사_번호() {
        let a = helper_args();
        assert!(a.contains(&"--hidpi".to_string()));
        assert_eq!(a[a.iter().position(|x| x == "--name").unwrap() + 1], NAME);
        let v: u32 = a[a.iter().position(|x| x == "--vendor").unwrap() + 1].parse().unwrap();
        assert_ne!(v, 0x4348, "앱 화면과 같은 번호면 맥이 앞 화면을 뺀다");
    }

    #[test]
    fn 자리_파일은_pid_번호_자리_배율() {
        let j: serde_json::Value = serde_json::from_str(&screen_json(7, 18, crate::vdisplay::Rect { x: -4350.0, y: 2317.0, w: 1440.0, h: 900.0 }, 2)).unwrap();
        assert_eq!((j["pid"].as_u64(), j["displayID"].as_u64(), j["scale"].as_u64()), (Some(7), Some(18), Some(2)));
        assert_eq!(j["bounds"][0].as_f64(), Some(-4350.0));
    }

    #[test]
    fn 떠_있는_앱이_있어야_화면을_둔다() {
        let d = std::env::temp_dir().join(format!("craft-screen-{}", std::process::id()));
        let n = d.join("craft-native");
        std::fs::create_dir_all(&n).unwrap();
        assert!(!any_running(&d, |_| true), "상태 파일 없음");
        std::fs::write(n.join("photocraft.json"), r#"{"pid":4242}"#).unwrap();
        assert!(any_running(&d, |p| p == 4242));
        assert!(!any_running(&d, |_| false), "pid 가 죽었으면 없는 것");
        let _ = std::fs::remove_dir_all(&d);
    }
}
