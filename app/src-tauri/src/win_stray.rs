//! 윈도우 안전망 — 보이는 데스크톱에 올라온 우리 세션 크롬 창을 작업표시줄·Alt+Tab·화면에서 뺀다(2026-11-16 fix/browser-hide).
//! 세션 크롬은 뜰 때 숨은 데스크톱으로 간다(래퍼 src/windesk.js) — 그런데 업데이트 전에 뜬 옛 판 지킴이 크롬(윈도우 시험 PC 에서 0.4.12 지킴이 크롬이 사흘),
//! 지킴이가 죽고 남은 크롬처럼 뜰 때 정해진 자리를 못 바꾸는 크롬이 작업표시줄에 며칠씩 남았다. 앱이 1초마다 보이는 데스크톱 창을 보고
//! 우리 데이터 폴더 프로필(<데이터>/browser/profiles/<이름>)로 뜬 크롬의 창만 숨김 → WS_EX_TOOLWINDOW(APPWINDOW 끔) → 화면 밖으로 옮긴다
//! (spike toolwin: 작업표시줄·Alt+Tab 둘 다 빠지고 rAF 60 그대로, docs/plans/inapp-spike-windows.md). 끄지 않는다 — 그 크롬을 스크립트가 쓰는 중일 수 있다.
//! 비키는 것: 사람 차례 보이는 창(<live>/<프로필>.visible·.shown, src/winshow.js) · 앱에서 보기 끔(그땐 보이는 창이 설계) · 처음 본 지 1.5초 안(바꾸는 사이)
//! 실측(11-16 윈도우 시험 PC, 이 파일을 묶은 프로브 .shots/browser-hide): 옛 판 모양 크롬(node → 크롬 베타 0,0)을 띄우자 작업표시줄 단추 +1 →
//! 1.6초 뒤 빠짐(x 5920 으로), window.open 새 창(0,0 1296×873)도 1.55초 뒤 빠짐, 그동안 rAF 60·visible 그대로, 다른 데이터 폴더 크롬·사람 크롬은 안 고름
#![cfg_attr(not(windows), allow(dead_code))]
use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, Instant};

pub const WS_EX_TOOLWINDOW: u32 = 0x80;
pub const WS_EX_APPWINDOW: u32 = 0x4_0000;
/// 처음 본 뒤 이만큼 지나도 그대로면 뺀다 — 래퍼가 보이는 창으로 바꾸는 사이(.visible 을 지우고 .shown 을 쓰기 전)를 건드리지 않게
const SETTLE: Duration = Duration::from_millis(1500);
/// 래퍼가 보이는 창으로 다시 띄우는 동안 두는 표(.visible)의 유효 시간 — 래퍼가 죽어 남은 표는 이 뒤로 안 믿는다
const VISIBLE_FRESH_MS: u64 = 60_000;

/// 그 프로세스가 우리 세션 크롬(브라우저 프로세스)이면 프로필 이름. 명령줄의 --user-data-dir 가 profiles_dir 바로 아래 폴더일 때만 —
/// 다른 데이터 폴더(시험판·진짜 앱이 같은 PC)·사용자 크롬·node 래퍼(같은 인자를 든다)·렌더러(--type=)는 None
pub fn our_profile(cmd: &[String], profiles_dir: &str) -> Option<String> {
    let exe = cmd.first()?.trim_matches('"').replace('/', "\\").to_lowercase();
    if !exe.ends_with("\\chrome.exe") && exe != "chrome.exe" {
        return None;
    }
    if cmd.iter().any(|a| a.starts_with("--type=")) {
        return None;
    }
    let mut dir = None;
    for (i, a) in cmd.iter().enumerate() {
        if let Some(v) = a.strip_prefix("--user-data-dir=") {
            dir = Some(v.to_string());
        } else if a == "--user-data-dir" {
            dir = cmd.get(i + 1).cloned();
        }
    }
    let clean = |p: &str| p.trim().trim_matches('"').trim_end_matches(['\\', '/']).to_string();
    let norm = |p: &str| clean(p).replace('/', "\\").to_lowercase();
    let dir = clean(&dir?);
    let (got, root) = (norm(&dir), norm(profiles_dir));
    let name = got.strip_prefix(&root)?.strip_prefix('\\')?;
    if name.is_empty() || name.contains('\\') {
        return None;
    }
    // 이름은 원래 명령줄 대소문자로(프로필 폴더·live 표 이름과 같게) — 마지막 경로 조각
    dir.rsplit(['\\', '/']).next().map(str::to_string)
}

/// 작업표시줄·Alt+Tab 에 단추가 생기는 창 — APPWINDOW 거나, 소유자 없고 TOOLWINDOW 가 아님(윈도우 셸 규칙)
pub fn on_taskbar(ex: u32, owned: bool) -> bool {
    ex & WS_EX_APPWINDOW != 0 || (!owned && ex & WS_EX_TOOLWINDOW == 0)
}

/// 뺄 창인가 — 보이고, 소유자 없는 최상위 창이고, 작업표시줄에 뜨거나 화면(가상 화면 전체) 안에 걸쳐 있다.
/// 소유된 창(크롬 풍선·자동완성)은 주인 창을 따라간다. rect·screen = [왼쪽, 위, 오른쪽, 아래]
pub fn stray(visible: bool, owned: bool, ex: u32, rect: [i32; 4], screen: [i32; 4]) -> bool {
    if !visible || owned {
        return false;
    }
    let inside = rect[0] < screen[2] && rect[2] > screen[0] && rect[1] < screen[3] && rect[3] > screen[1];
    on_taskbar(ex, owned) || inside
}

/// 뺀 뒤 확장 스타일 — 도구 창으로, 앱 창 표시는 끔
pub fn hidden_style(ex: u32) -> u32 {
    (ex | WS_EX_TOOLWINDOW) & !WS_EX_APPWINDOW
}

/// 옮길 자리 x — 가상 화면 오른쪽 끝에서 한참 밖(맥 화면 밖 자리와 같은 꼴)
pub fn off_x(screen: [i32; 4]) -> i32 {
    screen[2] + 4000
}

/// 사람 차례라 보이게 둔 프로필인가 — 래퍼가 보이는 창으로 다시 띄우는 중(.visible, 60초 안) 또는 꺼냄 표(.shown)의 래퍼가 살아 있다
pub fn exempt(live_dir: &Path, profile: &str, now_ms: u64, alive: impl Fn(i32) -> bool) -> bool {
    let read = |tail: &str| -> Option<serde_json::Value> {
        std::fs::read_to_string(live_dir.join(format!("{profile}.{tail}"))).ok().and_then(|t| serde_json::from_str(&t).ok())
    };
    if read("visible").and_then(|v| v["at"].as_u64()).is_some_and(|at| now_ms.saturating_sub(at) < VISIBLE_FRESH_MS) {
        return true;
    }
    read("shown").and_then(|v| v["pid"].as_i64()).is_some_and(|p| p > 0 && alive(p as i32))
}

/// 숨기지 않을 프로필 목록 — <데이터>/browser/keep-visible.json(["이름", "앞자리*"]). 24시간 운영 수집처럼 사람이 창을 직접 봐야 하는 크롬은
/// 숨기면 결과가 조용히 비어도 안 보인다(2026-11-17 운영 수집 PC). 래퍼 src/keepvisible.js(숨은 데스크톱 길)와 같은 파일·같은 규칙. 없거나 깨졌으면 빈 목록
pub fn keep_list(browser: &Path) -> Vec<String> {
    std::fs::read_to_string(browser.join("keep-visible.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<serde_json::Value>>(&t).ok())
        .map(|v| v.into_iter().filter_map(|x| x.as_str().filter(|s| !s.is_empty()).map(str::to_lowercase)).collect())
        .unwrap_or_default()
}

/// 목록에 있나 — 이름 그대로, 또는 '앞자리*'. 대소문자 안 가림(keep 은 keep_list 가 이미 소문자로)
pub fn kept(profile: &str, keep: &[String]) -> bool {
    let n = profile.to_lowercase();
    keep.iter().any(|k| match k.strip_suffix('*') {
        Some(pre) => n.starts_with(pre),
        None => n == *k,
    })
}

/// 창마다 처음 본 때 — 이번 바퀴에 안 보인 창은 잊는다(창 손잡이가 다시 쓰여도 새로 센다)
#[derive(Default)]
pub struct Sightings {
    first: HashMap<isize, Instant>,
}

impl Sightings {
    /// 이번 바퀴에 본 뺄 창들 → 지금 뺄 창(처음 본 지 SETTLE 이 지난 것)
    pub fn due(&mut self, seen: &[isize], now: Instant) -> Vec<isize> {
        self.first.retain(|h, _| seen.contains(h));
        seen.iter().filter(|h| now.duration_since(*self.first.entry(**h).or_insert(now)) >= SETTLE).copied().collect()
    }
}

/// 감시 실(agent_browser::watch_hidden)이 들고 다니는 상태 — 창 처음 본 때, pid → 우리 프로필(명령줄은 처음 한 번만 읽는다), 기록 남긴 창
#[cfg(windows)]
#[derive(Default)]
pub struct State {
    seen: Sightings,
    cache: HashMap<u32, Option<String>>,
    logged: std::collections::HashSet<isize>,
    last: Option<Instant>,
}

/// 한 바퀴(1초에 한 번만) — 보이는 데스크톱(이 실의 데스크톱 = 사람 화면)의 크롬 최상위 창만 본다. 숨은 데스크톱 창은 EnumWindows 에 안 나온다
#[cfg(windows)]
pub fn tick(st: &mut State) {
    let now = Instant::now();
    if st.last.is_some_and(|t| now.duration_since(t) < Duration::from_secs(1)) {
        return;
    }
    st.last = Some(now);
    if !crate::config::current().features.agent_view {
        return;
    }
    let browser = crate::config::data_file("browser");
    let screen = ffi::virtual_screen();
    for (h, pid, p) in scan(st, &browser, now) {
        if ffi::tuck(h, screen) && st.logged.insert(h) {
            crate::claude::log_out("browser", &format!("작업표시줄에서 뺀 세션 크롬 창: {p} (크롬 pid {pid})"));
        }
    }
}

/// 지금 뺄 창 [(창, 크롬 pid, 프로필)] — browser = <데이터>/browser(그 아래 profiles·live). 빼지는 않는다(윈도우 실측 프로브가 먼저 목록만 본다)
#[cfg(windows)]
pub fn scan(st: &mut State, browser: &Path, now: Instant) -> Vec<(isize, u32, String)> {
    let (profiles, live) = (browser.join("profiles").to_string_lossy().into_owned(), browser.join("live"));
    let screen = ffi::virtual_screen();
    let wins = ffi::chrome_windows();
    st.cache.retain(|pid, _| wins.iter().any(|w| w.pid == *pid));
    let now_ms = crate::takeover::now_ms();
    let keep = keep_list(browser);
    let mut due: Vec<(isize, u32, String)> = vec![];
    for w in &wins {
        if !stray(true, w.owned, w.ex, w.rect, screen) {
            continue;
        }
        let prof = st.cache.entry(w.pid).or_insert_with(|| ffi::cmd_of(w.pid).and_then(|c| our_profile(&c, &profiles))).clone();
        if let Some(p) = prof.filter(|p| !kept(p, &keep) && !exempt(&live, p, now_ms, crate::platform::pid_alive)) {
            due.push((w.hwnd, w.pid, p));
        }
    }
    let ready = st.seen.due(&due.iter().map(|d| d.0).collect::<Vec<_>>(), now);
    due.retain(|d| ready.contains(&d.0));
    due
}

/// 윈도우 실측 프로브(이 파일을 #[path] 로 묶는 작은 crate)가 부른다 — 앱 안에선 tick 만 쓴다
#[cfg(windows)]
#[allow(unused_imports)]
pub use ffi::{chrome_windows, tuck, virtual_screen};

#[cfg(windows)]
mod ffi {
    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    pub struct Win {
        pub hwnd: isize,
        pub pid: u32,
        pub ex: u32,
        pub owned: bool,
        pub rect: [i32; 4],
    }

    /// 가상 화면 전체 [왼, 위, 오른, 아래]
    pub fn virtual_screen() -> [i32; 4] {
        unsafe {
            let (x, y) = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
            [x, y, x + GetSystemMetrics(SM_CXVIRTUALSCREEN), y + GetSystemMetrics(SM_CYVIRTUALSCREEN)]
        }
    }

    /// 보이는 크롬 최상위 창(Chrome_WidgetWin_1) — 크롬·엣지·일렉트론이 다 이 이름이라 누구 것인지는 명령줄로 가른다
    pub fn chrome_windows() -> Vec<Win> {
        unsafe extern "system" fn each(h: HWND, l: LPARAM) -> BOOL {
            let out = &mut *(l as *mut Vec<Win>);
            if IsWindowVisible(h) == 0 {
                return 1;
            }
            let mut cls = [0u16; 64];
            let n = GetClassNameW(h, cls.as_mut_ptr(), cls.len() as i32);
            if String::from_utf16_lossy(&cls[..n.max(0) as usize]) != "Chrome_WidgetWin_1" {
                return 1;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, &mut pid);
            let mut r: RECT = std::mem::zeroed();
            GetWindowRect(h, &mut r);
            out.push(Win { hwnd: h as isize, pid, ex: GetWindowLongPtrW(h, GWL_EXSTYLE) as u32, owned: !GetWindow(h, GW_OWNER).is_null(), rect: [r.left, r.top, r.right, r.bottom] });
            1
        }
        let mut out: Vec<Win> = vec![];
        unsafe { EnumWindows(Some(each), &mut out as *mut Vec<Win> as LPARAM) };
        out
    }

    /// 명령줄(첫 칸 = 실행 파일 경로) — 못 읽으면 None
    pub fn cmd_of(pid: u32) -> Option<Vec<String>> {
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
        let p = Pid::from_u32(pid);
        let mut s = System::new();
        s.refresh_processes_specifics(ProcessesToUpdate::Some(&[p]), true, ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always).with_exe(UpdateKind::Always));
        let x = s.process(p)?;
        let mut v: Vec<String> = x.cmd().iter().map(|a| a.to_string_lossy().into_owned()).collect();
        let exe = x.exe()?.to_string_lossy().into_owned();
        if v.is_empty() {
            return None;
        }
        v[0] = exe;
        Some(v)
    }

    /// 숨김 → 도구 창 스타일 → 화면 밖 자리로 다시 보이기(활성화 없이). 숨겼다 보여야 작업표시줄이 스타일을 다시 읽는다(spike win32.ps1 toolwin).
    /// 남의 창이라 ShowWindow 가 그 크롬 UI 실의 답을 기다린다 — 응답 없음 창은 건너뛴다(감시 실이 같이 멈추지 않게, 다음 바퀴에 다시)
    pub fn tuck(h: isize, screen: [i32; 4]) -> bool {
        let h = h as HWND;
        unsafe {
            if IsHungAppWindow(h) != 0 {
                return false;
            }
            ShowWindow(h, SW_HIDE);
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            SetWindowLongPtrW(h, GWL_EXSTYLE, super::hidden_style(ex) as isize);
            let mut wp: WINDOWPLACEMENT = std::mem::zeroed();
            wp.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
            if GetWindowPlacement(h, &mut wp) != 0 {
                let r = wp.rcNormalPosition;
                let x = super::off_x(screen);
                wp.rcNormalPosition = RECT { left: x, top: r.top, right: x + (r.right - r.left), bottom: r.bottom };
                wp.showCmd = SW_SHOWNOACTIVATE as u32;
                wp.flags = 0;
                SetWindowPlacement(h, &wp);
            } else {
                ShowWindow(h, SW_SHOWNOACTIVATE);
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &str = r"C:\Users\Me\.chammo\browser\profiles";
    fn cmd(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }
    const CHROME: &str = r"C:\Users\Me\AppData\Local\Google\Chrome Beta\Application\chrome.exe";

    #[test]
    fn 우리_프로필_크롬만_알아본다() {
        // 윈도우 시험 PC 11-16 실측 명령줄 모양(플레이라이트 지킴이)
        assert_eq!(our_profile(&cmd(&[CHROME, "--no-first-run", r"--user-data-dir=C:\Users\Me\.chammo\browser\profiles\tax-site", "--remote-debugging-pipe", "about:blank"]), ROOT).as_deref(), Some("tax-site"));
        assert_eq!(our_profile(&cmd(&[CHROME, "--user-data-dir=c:/users/me/.chammo/browser/profiles/Tax-Site/"]), ROOT).as_deref(), Some("Tax-Site"), "빗금·대소문자·끝 빗금");
        assert_eq!(our_profile(&cmd(&[&format!("\"{CHROME}\""), r#"--user-data-dir="C:\Users\Me\.chammo\browser\profiles\a b""#]), ROOT).as_deref(), Some("a b"), "따옴표");
        assert_eq!(our_profile(&cmd(&[CHROME, "--user-data-dir", r"C:\Users\Me\.chammo\browser\profiles\shop"]), ROOT).as_deref(), Some("shop"), "값이 따로");
    }

    #[test]
    fn 남의_크롬과_다른_데이터_폴더는_안_건드린다() {
        assert_eq!(our_profile(&cmd(&[CHROME]), ROOT), None, "사람 크롬(기본 프로필)");
        assert_eq!(our_profile(&cmd(&[CHROME, r"--user-data-dir=C:\qa\data\browser\profiles\tax-site"]), ROOT), None, "같은 PC 시험판·진짜 앱");
        assert_eq!(our_profile(&cmd(&[CHROME, r"--user-data-dir=C:\Users\Me\.chammo\browser\profiles"]), ROOT), None, "profiles 자체");
        assert_eq!(our_profile(&cmd(&[CHROME, r"--user-data-dir=C:\Users\Me\.chammo\browser\profiles\a\b"]), ROOT), None, "한 단계 더 아래");
        assert_eq!(our_profile(&cmd(&[CHROME, r"--user-data-dir=C:\Users\Me\.chammo\browser\profiles-old\a"]), ROOT), None, "이름만 앞이 같은 폴더");
        assert_eq!(our_profile(&cmd(&[CHROME, "--type=renderer", r"--user-data-dir=C:\Users\Me\.chammo\browser\profiles\a"]), ROOT), None, "렌더러");
        assert_eq!(our_profile(&cmd(&[r"C:\Program Files\nodejs\node.exe", "cli.js", "--user-data-dir", r"C:\Users\Me\.chammo\browser\profiles\a"]), ROOT), None, "같은 인자를 든 node 래퍼(10-29 교훈)");
        assert_eq!(our_profile(&cmd(&[r"C:\Program Files\Microsoft\Edge\Application\msedge.exe", r"--user-data-dir=C:\Users\Me\.chammo\browser\profiles\a"]), ROOT), None);
        assert_eq!(our_profile(&[], ROOT), None);
    }

    #[test]
    fn 작업표시줄_규칙() {
        assert!(on_taskbar(0, false), "보통 최상위 창");
        assert!(!on_taskbar(WS_EX_TOOLWINDOW, false), "도구 창");
        assert!(!on_taskbar(0, true), "소유된 창");
        assert!(on_taskbar(WS_EX_APPWINDOW | WS_EX_TOOLWINDOW, true), "APPWINDOW 가 이긴다");
        assert_eq!(hidden_style(WS_EX_APPWINDOW | 0x100), WS_EX_TOOLWINDOW | 0x100);
    }

    #[test]
    fn 뺄_창은_보이고_소유자_없고_작업표시줄이나_화면_안() {
        let screen = [0, 0, 1920, 1080];
        assert!(stray(true, false, 0, [0, 0, 1280, 800], screen), "옛 판 지킴이 창 0,0 1280×800");
        assert!(stray(true, false, WS_EX_TOOLWINDOW, [100, 100, 900, 700], screen), "도구 창이어도 화면 안이면(크롬이 끌어옴)");
        assert!(stray(true, false, 0, [off_x(screen), 0, off_x(screen) + 1280, 800], screen), "화면 밖이어도 작업표시줄 단추");
        assert!(!stray(true, false, WS_EX_TOOLWINDOW, [off_x(screen), 0, off_x(screen) + 1280, 800], screen), "이미 뺀 창");
        assert!(!stray(false, false, 0, [0, 0, 1280, 800], screen), "안 보이는 창");
        assert!(!stray(true, true, 0, [0, 0, 300, 200], screen), "소유된 창(크롬 풍선)");
        assert!(stray(true, false, WS_EX_TOOLWINDOW, [-1900, 0, -100, 800], [-1920, 0, 1920, 1080]), "왼쪽 보조 모니터 안");
    }

    #[test]
    fn 사람_차례_보이는_창은_비킨다() {
        let d = std::env::temp_dir().join(format!("chammo-stray-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let now = 1_800_000_000_000u64;
        assert!(!exempt(&d, "shop", now, |_| true));
        std::fs::write(d.join("shop.visible"), format!(r#"{{"pid":42,"at":{}}}"#, now - 5_000)).unwrap();
        assert!(exempt(&d, "shop", now, |_| false), "래퍼가 보이는 창으로 다시 띄우는 중");
        std::fs::write(d.join("shop.visible"), format!(r#"{{"pid":42,"at":{}}}"#, now - 120_000)).unwrap();
        assert!(!exempt(&d, "shop", now, |_| true), "죽은 래퍼가 남긴 옛 표");
        std::fs::write(d.join("shop.shown"), r#"{"pid":42,"at":1}"#).unwrap();
        assert!(exempt(&d, "shop", now, |p| p == 42), "꺼냄 표 — 래퍼가 살아 있다");
        assert!(!exempt(&d, "shop", now, |_| false), "꺼냄 표 주인이 죽음");
        assert!(!exempt(&d, "other", now, |_| true), "다른 프로필");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 두_번_연속_본_창만_뺀다() {
        let mut s = Sightings::default();
        let t = Instant::now();
        assert!(s.due(&[7, 8], t).is_empty(), "처음 본 바퀴");
        assert!(s.due(&[7, 8], t + Duration::from_millis(1000)).is_empty(), "1초 — 바꾸는 사이일 수 있다");
        assert_eq!(s.due(&[7], t + Duration::from_millis(1600)), vec![7]);
        assert!(s.due(&[8], t + Duration::from_millis(1700)).is_empty(), "8 은 한 바퀴 안 보여 처음부터");
        assert_eq!(s.due(&[8], t + Duration::from_millis(3300)), vec![8]);
    }

    #[test]
    fn 숨기지_않을_목록에_있는_프로필은_안_뺀다() {
        // <데이터>/browser/keep-visible.json — 래퍼 src/keepvisible.js 와 같은 규칙(이름 그대로·앞자리*, 대소문자 안 가림)
        let d = std::env::temp_dir().join(format!("win-stray-keep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        assert!(keep_list(&d).is_empty(), "파일이 없으면 아무것도 안 뺀다");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("keep-visible.json"), "{깨짐").unwrap();
        assert!(keep_list(&d).is_empty(), "깨졌으면 아무것도 안 뺀다");
        std::fs::write(d.join("keep-visible.json"), r#"["shop-scraper*", "tax-site", "", 3]"#).unwrap();
        let keep = keep_list(&d);
        assert!(kept("shop-scraper", &keep) && kept("Shop-Scraper-B", &keep) && kept("tax-site", &keep));
        assert!(!kept("shop", &keep) && !kept("tax-site-2", &keep) && !kept("news", &keep));
        let _ = std::fs::remove_dir_all(&d);
    }
}
