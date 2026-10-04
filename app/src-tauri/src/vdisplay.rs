//! 가상 모니터(2026-10-03 사용자 "가상 모니터 개지린다") — 세션 크롬을 눈에 안 보이는 가짜 화면에 띄운다.
//! 도우미 tools/chammo-vdisplay(Swift, CGVirtualDisplay 비공개 API)를 build.rs 가 빌드해 실행 파일에 넣고, 앱이 뜰 때 데이터 폴더에 풀어 띄운다.
//! 도우미가 살아 있는 동안만 화면이 있고(입력이 닫히면 = 앱이 꺼지면 사라짐), 커서 막이·배치가 바뀔 때 모서리 자리 다시 잡기도 도우미가 한다.
//! 자리는 <데이터>/browser/vdisplay.json(600) {pid, displayID, bounds} — 참모 브라우저 래퍼가 읽어 크롬 창을 거기 띄운다.
//! 안 되는 macOS·기능 꺼짐·도우미 빌드 실패면 아무것도 안 하고, 세션 크롬은 앱 가리기(agent_browser watch_hidden)만으로 숨는다
use serde::Deserialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Stdio};
use std::sync::Mutex;

/// 네모 — CoreGraphics 전역 좌표(주 화면 왼쪽 위 원점, y 아래로), 크롬 창 좌표와 같다
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn contains(&self, px: f64, py: f64) -> bool {
        px >= self.x && px < self.x + self.w && py >= self.y && py < self.y + self.h
    }
}

#[cfg(target_os = "macos")]
const HELPER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/chammo-vdisplay"));
#[cfg(not(target_os = "macos"))]
const HELPER: &[u8] = &[];

/// 도우미가 찍는 한 줄 {"displayID":…,"bounds":[x,y,w,h]} → (id, 네모)
pub fn parse_line(line: &str) -> Option<(u32, Rect)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let id = v["displayID"].as_u64()? as u32;
    let b: Vec<f64> = v["bounds"].as_array()?.iter().filter_map(|x| x.as_f64()).collect();
    (b.len() == 4 && b[2] > 0.0 && b[3] > 0.0).then_some((id, Rect { x: b[0], y: b[1], w: b[2], h: b[3] }))
}

/// 창이 보이는 화면에 걸쳐 있나 — 창 가운데가 어느 보이는(가짜 아닌) 화면 안이면. 가짜 화면이 지워진 뒤 창은 어느 화면도 아닌 좌표에 남는다(2026-10-03 실측)
pub fn on_visible(win: Rect, visible: &[Rect]) -> bool {
    let (cx, cy) = (win.x + win.w / 2.0, win.y + win.h / 2.0);
    visible.iter().any(|d| d.contains(cx, cy))
}

/// 도우미가 만드는 가짜 화면 이름(tools/chammo-vdisplay main.swift desc.name) — 개발판 창 자리 고를 때 알아본다
pub const NAME: &str = "Chammo agents";

/// 창이 가상 모니터 안에 다 들어 있나 — 아니면 세션 크롬을 그리로 옮긴다(agent_browser::rehome_all)
pub fn inside(win: Rect, vd: Rect) -> bool {
    win.x >= vd.x && win.y >= vd.y && win.x + win.w <= vd.x + vd.w && win.y + win.h <= vd.y + vd.h
}

/// 보여 줄 화면 — 맥북 내장 화면, 없으면 첫 화면. (네모, 내장인가)
pub fn show_display(displays: &[(Rect, bool)]) -> Option<Rect> {
    displays.iter().find(|d| d.1).or(displays.first()).map(|d| d.0)
}

/// 그 화면 안에 창을 놓을 자리 — 왼쪽 위에서 조금 비켜, 오른쪽·아래 16px 남기고 최대 1400x880(래퍼 windowSize 와 같은 규칙)
pub fn place_in(d: Rect) -> Rect {
    let (x, y) = (d.x + 24.0, d.y + 48.0);
    Rect { x, y, w: (d.x + d.w - x - 16.0).min(1400.0).max(400.0), h: (d.y + d.h - y - 16.0).min(880.0).max(300.0) }
}

struct Running {
    child: Child,
    bounds: Option<(u32, Rect)>,
}
static RUN: Mutex<Option<Running>> = Mutex::new(None);

fn json_path() -> std::path::PathBuf {
    crate::config::data_file("browser").join("vdisplay.json")
}

/// 지금 가짜 화면(있으면)
pub fn bounds() -> Option<(u32, Rect)> {
    RUN.lock().ok()?.as_ref()?.bounds
}

fn write_json(pid: u32, id: u32, r: Rect) {
    let p = json_path();
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let body = serde_json::json!({ "pid": pid, "displayID": id, "bounds": [r.x, r.y, r.w, r.h] }).to_string();
    let tmp = p.with_extension("json.tmp");
    if std::fs::write(&tmp, body).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        }
        let _ = std::fs::rename(&tmp, &p);
    }
}

/// 앱이 뜰 때 — 기능이 켜져 있고 이 macOS 에서 되면 가짜 화면을 띄운다(백그라운드 스레드, 실패하면 조용히 안 함)
pub fn start() {
    // CHAMMO_VDISPLAY=0 — 개발판 시험처럼 가짜 화면을 하나 더 만들면 안 될 때(사용자 화면 배치를 건드린다)
    if HELPER.is_empty() || !crate::config::current().features.agent_view || std::env::var("CHAMMO_VDISPLAY").is_ok_and(|v| v == "0") {
        return;
    }
    std::thread::spawn(|| {
        let _ = std::fs::remove_file(json_path());
        let exe = crate::config::data_file("tools").join("chammo-vdisplay");
        if std::fs::read(&exe).map(|b| b != HELPER).unwrap_or(true) {
            let _ = std::fs::create_dir_all(exe.parent().unwrap_or(std::path::Path::new(".")));
            if std::fs::write(&exe, HELPER).is_err() {
                return;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755));
            }
        }
        // 이 macOS 에 비공개 API 가 있나 — 없으면(3) 조용히 앱 가리기만
        if !crate::platform::command(&exe).arg("--probe").status().is_ok_and(|s| s.success()) {
            return;
        }
        let Ok(mut child) = crate::platform::command(&exe).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else { return };
        let pid = child.id();
        let Some(out) = child.stdout.take() else { return };
        if let Ok(mut g) = RUN.lock() {
            *g = Some(Running { child, bounds: None });
        }
        // 도우미는 처음 한 줄 + 배치가 바뀔 때마다 한 줄씩 자리를 찍는다
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if let Some((id, r)) = parse_line(&line) {
                if let Ok(mut g) = RUN.lock() {
                    if let Some(run) = g.as_mut() {
                        run.bounds = Some((id, r));
                    }
                }
                write_json(pid, id, r);
                // 가짜 화면이 새로 생기거나 자리가 바뀌었다 — 옛 좌표에 남은 세션 크롬을 그리로(안 그러면 새 탭이 뜰 때 사용자 화면에 잠깐 보였다)
                std::thread::spawn(crate::agent_browser::rehome_all);
            }
        }
        // 도우미가 끝났다 — 자리 파일을 지워 래퍼가 보이는 자리로 돌아가게
        let _ = std::fs::remove_file(json_path());
        // 끝난 도우미를 거둔다 — 그냥 버리면 좀비(<defunct>)로 남았다
        let ended = RUN.lock().ok().and_then(|mut g| g.take());
        if let Some(mut run) = ended {
            let _ = run.child.wait();
        }
    });
}

/// 앱이 꺼질 때 — 가짜 화면 위 크롬은 화면이 사라지면 어느 화면도 아닌 좌표에 남는다(실측). 먼저 가린 뒤(agent_browser) 도우미를 끈다
pub fn stop() {
    let run = RUN.lock().ok().and_then(|mut g| g.take());
    if let Some(mut run) = run {
        if let Some(mut stdin) = run.child.stdin.take() {
            let _ = stdin.flush();
        }
        let _ = run.child.kill();
        let _ = run.child.wait();
    }
    let _ = std::fs::remove_file(json_path());
}

// ── 화면 목록(CoreGraphics) ────────────────────────────────────────
#[cfg(target_os = "macos")]
mod cg {
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        w: f64,
        h: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        o: CGPoint,
        s: CGSize,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
        fn CGDisplayBounds(display: u32) -> CGRect;
        fn CGDisplayIsBuiltin(display: u32) -> u32;
    }
    /// (화면 번호, 네모, 내장인가)
    pub fn displays() -> Vec<(u32, super::Rect, bool)> {
        let mut ids = [0u32; 16];
        let mut n = 0u32;
        if unsafe { CGGetActiveDisplayList(16, ids.as_mut_ptr(), &mut n) } != 0 {
            return vec![];
        }
        ids[..n as usize]
            .iter()
            .map(|&d| {
                let r = unsafe { CGDisplayBounds(d) };
                (d, super::Rect { x: r.o.x, y: r.o.y, w: r.s.w, h: r.s.h }, unsafe { CGDisplayIsBuiltin(d) } != 0)
            })
            .collect()
    }
}
#[cfg(not(target_os = "macos"))]
mod cg {
    pub fn displays() -> Vec<(u32, super::Rect, bool)> {
        vec![]
    }
}

/// 보이는 화면들(가짜 화면 빼고) — (네모, 내장인가)
pub fn visible_displays() -> Vec<(Rect, bool)> {
    let fake = bounds().map(|b| b.0);
    cg::displays().into_iter().filter(|d| Some(d.0) != fake).map(|d| (d.1, d.2)).collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn 창이_가상_모니터_안에_다_있어야_그대로() {
        let vd = Rect { x: -1440.0, y: 956.0, w: 1440.0, h: 900.0 };
        assert!(inside(place_in(vd), vd), "가상 모니터에 놓은 자리는 안");
        assert!(!inside(Rect { x: -2886.0, y: 986.0, w: 1394.0, h: 852.0 }, vd), "가상 모니터가 다른 자리로 다시 생기면 옛 좌표는 밖(2026-10-03 앱 재시작)");
        assert!(!inside(Rect { x: 24.0, y: 48.0, w: 1394.0, h: 852.0 }, vd), "맥북 화면 위");
        assert!(!inside(Rect { x: -100.0, y: 1000.0, w: 400.0, h: 300.0 }, vd), "걸쳐 있으면 밖");
    }

    use super::*;
    const BOOK: Rect = Rect { x: -1470.0, y: 0.0, w: 1470.0, h: 956.0 };
    const MAIN: Rect = Rect { x: 0.0, y: 0.0, w: 1920.0, h: 1080.0 };

    #[test]
    fn 도우미_자리_계산_자체_테스트() {
        // 도우미의 순수 함수(모서리 자리·커서 막이) 테스트 — Swift 쪽 --test 를 여기서 돌린다. 도우미가 안 빌드된 기계면 건너뜀
        if HELPER.is_empty() {
            return;
        }
        let exe = std::env::temp_dir().join(format!("chammo-vdisplay-test-{}", std::process::id()));
        std::fs::write(&exe, HELPER).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let out = crate::platform::command(&exe).arg("--test").output().unwrap();
        let _ = std::fs::remove_file(&exe);
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
    }

    #[test]
    fn 도우미_한_줄() {
        assert_eq!(parse_line(r#"{"displayID":4,"bounds":[1920,1080,1440,900],"othersMoved":[]}"#), Some((4, Rect { x: 1920.0, y: 1080.0, w: 1440.0, h: 900.0 })));
        assert_eq!(parse_line(r#"{"available":true}"#), None);
        assert_eq!(parse_line(r#"{"displayID":4,"bounds":[0,0,0,0]}"#), None);
        assert_eq!(parse_line("깨짐"), None);
    }

    #[test]
    fn 어느_화면도_아닌_창은_보이는_화면_밖() {
        // 가짜 화면이 지워진 뒤 크롬 창이 남은 자리(실측 1944,1110)
        let lost = Rect { x: 1944.0, y: 1110.0, w: 1392.0, h: 852.0 };
        assert!(!on_visible(lost, &[MAIN, BOOK]));
        assert!(on_visible(Rect { x: -1446.0, y: 48.0, w: 1394.0, h: 856.0 }, &[MAIN, BOOK]));
    }

    #[test]
    fn 크롬에서_보기는_맥북_화면_안으로() {
        let d = show_display(&[(MAIN, false), (BOOK, true)]).unwrap();
        assert_eq!(d, BOOK);
        let p = place_in(d);
        assert_eq!(p, Rect { x: -1446.0, y: 48.0, w: 1400.0, h: 880.0 });
        assert!(on_visible(p, &[BOOK]));
        // 내장 화면이 없으면(데스크톱) 첫 화면
        assert_eq!(show_display(&[(MAIN, false)]), Some(MAIN));
        assert_eq!(show_display(&[]), None);
        // 작은 화면이면 그 안에 맞춘다
        let small = Rect { x: 0.0, y: 0.0, w: 1280.0, h: 800.0 };
        let q = place_in(small);
        assert!(q.x + q.w <= small.w - 16.0 && q.y + q.h <= small.h - 16.0);
    }
}
