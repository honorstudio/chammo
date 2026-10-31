//! 디버그 빌드 전용 실측 도구 — 화면 캡처 없이 dev 앱을 확인하려고(computer-use 안 씀).
//! HONOR_ORCH_DEBUG_JS=<js 파일> 로 띄우면 12초 뒤 메인 창에서 그 JS 를 돌리고, JS 는 debug_dump 로 글자를
//! HONOR_ORCH_DEBUG_OUT(없으면 <데이터 폴더>/debug) 에 남긴다. 릴리스 빌드에선 아무것도 안 한다
use tauri::{Manager, Runtime};

pub fn eval_from_env<R: Runtime>(app: &tauri::AppHandle<R>) {
    if !cfg!(debug_assertions) {
        return;
    }
    let Ok(path) = std::env::var("HONOR_ORCH_DEBUG_JS") else { return };
    let app = app.clone();
    // 12초 뒤 한 번, 그 뒤로 3초마다 다시 — 개발판은 화면이 다시 읽히면(vite) 심은 JS 가 사라진다. JS 쪽이 window 표시로 두 번 안 돌게 막는다
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(12));
        loop {
            // perf-bench — 창이 가려져도 웹뷰를 '보이는 중'으로(가림 감지 끄기). 가려지면 타이머가 16ms → 1초 단위로 묶여 실측이 부푼다(10-31)
            if std::env::var("CHAMMO_PERF_VISIBLE").is_ok() {
                for (_, w) in app.webview_windows() {
                    keep_visible(&w);
                }
            }
            if let Ok(js) = std::fs::read_to_string(&path) {
                // 메인 창 + (CHAMMO_DEBUG_ALL_WINDOWS 면) 모든 창 — 팀 창·따로 창 실측(perf-bench). JS 가 window.__TAURI_INTERNALS__.metadata 로 창을 가린다
                let all = std::env::var("CHAMMO_DEBUG_ALL_WINDOWS").is_ok();
                for (label, w) in app.webview_windows() {
                    if all || label == "main" {
                        let _ = w.eval(js.clone());
                    }
                }
            }
            if std::env::var("HONOR_ORCH_DEBUG_REPEAT").is_err() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
    });
}

/// perf-bench 메인 스레드 맥박 — 아무것도 안 하는 동기 명령. 화면이 자주 불러 답이 늦게 오면 그동안 메인 스레드가 막힌 것
#[tauri::command]
pub fn perf_ping() -> u8 {
    0
}

/// 웹뷰 가림 감지 끄기(WebKit 사설 API — 디버그 빌드의 실측에서만 부른다). 없으면 그냥 지나간다
#[cfg(target_os = "macos")]
fn keep_visible<R: Runtime>(w: &tauri::WebviewWindow<R>) {
    let _ = w.with_webview(|wv| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let v = wv.inner() as *mut AnyObject;
        if v.is_null() {
            return;
        }
        let sel = objc2::sel!(_setWindowOcclusionDetectionEnabled:);
        let ok: bool = msg_send![v, respondsToSelector: sel];
        if ok {
            let _: () = msg_send![v, _setWindowOcclusionDetectionEnabled: false];
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn keep_visible<R: Runtime>(_: &tauri::WebviewWindow<R>) {}

/// 팀 성능 예산 넘침 알림(메모리만 — team_relay::take_alerts) — 앱 화면이 1분마다 가져가 참모 입력칸에 [앱] 한 줄로. 릴리스에서도 돈다.
/// 개인판(데이터 폴더 .honor-orchestrator)에서만 넘긴다 — 알림 줄이 개발자 스킬(perf-budget)을 시켜서 공개판 사용자 참모에겐 버린다(0.4.6 2차 검증)
#[tauri::command]
pub fn perf_alerts() -> Vec<serde_json::Value> {
    alerts_for(&crate::config::data_dir(), crate::team_relay::take_alerts())
}

fn alerts_for(data: &std::path::Path, list: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    if crate::hq::personal_data(data) { list } else { Vec::new() }
}

#[tauri::command]
pub fn debug_dump(name: String, text: String) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err(crate::i18n::tr("디버그 빌드에서만", "Debug builds only").into());
    }
    let dir = std::env::var("HONOR_ORCH_DEBUG_OUT").unwrap_or_else(|_| crate::config::data_file("debug").to_string_lossy().into_owned());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name.chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' }).collect();
    std::fs::write(format!("{dir}/{safe}.txt"), text).map_err(|e| e.to_string())
}

/// 모델 칩이 실패했을 때 그때 터미널 화면을 <데이터 폴더>/pick-debug.log 에 덧붙인다(로컬 파일, 200KB 넘으면 앞을 버린다) — 실제 앱에서 왜 못 읽었는지 보려고
#[tauri::command]
pub fn pick_log(text: String) -> Result<(), String> {
    append_capped(&crate::config::data_file("pick-debug.log"), &text, 200 * 1024).map_err(|e| e.to_string())
}

/// 채팅 뷰 스페이스가 바뀐 한 줄(종류만 — 화면 종류·이유, 경로·세션 번호 없음)을 <데이터 폴더>/space-trace.log 에(100KB 넘으면 앞을 버린다).
/// 스페이스가 저절로 튀면(2026-10-06 사용자) 어느 길로 바뀌었는지 남기려고 — 늘 켜져 있다
#[tauri::command]
pub fn space_trace(line: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&line).map_err(|e| format!("JSON 아님: {e}"))?;
    append_capped(&crate::config::data_file("space-trace.log"), line.trim(), 100 * 1024).map_err(|e| e.to_string())
}

pub fn append_capped(path: &std::path::Path, text: &str, cap: usize) -> std::io::Result<()> {
    let mut cur = std::fs::read_to_string(path).unwrap_or_default();
    cur.push_str(text);
    if !text.ends_with('\n') { cur.push('\n'); }
    if cur.len() > cap {
        let mut cut = cur.len() - cap;
        while !cur.is_char_boundary(cut) { cut += 1; }
        cur = cur[cut..].to_string();
    }
    if let Some(d) = path.parent() { std::fs::create_dir_all(d)?; }
    std::fs::write(path, cur)
}

/// 개발판 창은 사용자 눈앞(주 화면) 말고 — 시험 앱이 작업 화면을 자꾸 가렸다(2026-10-02 사용자). 외장 모니터가 있으면 주 화면 아닌 진짜 화면,
/// 맥북 하나면 가짜 화면(Chammo agents — 행사장처럼 화면이 하나면 내장 화면이 곧 사용자 눈앞, 2026-10-03), 그것도 없으면 화면 밖.
/// 화면 = (x, y, 폭, 높이, 가짜인가) 물리 픽셀, 주 화면은 (0,0) 에서 시작. 돌려주는 값 = (자리, 고른 화면 번호 — 화면 밖이면 None)
pub fn aside_spot(monitors: &[(i32, i32, u32, u32, bool)], scale: f64) -> ((i32, i32), Option<usize>) {
    let pick = monitors.iter().position(|m| (m.0, m.1) != (0, 0) && !m.4).or_else(|| monitors.iter().position(|m| m.4));
    match pick {
        Some(i) => ((monitors[i].0 + (20.0 * scale) as i32, monitors[i].1 + (40.0 * scale) as i32), Some(i)),
        None => ((monitors.iter().map(|m| m.0 + m.2 as i32).max().unwrap_or(0) + (4000.0 * scale) as i32, 0), None),
    }
}

/// 개발판에서 새로 여는 앱 창(모드 따로 창 등)도 메인 창이 가는 옆 화면에 — 사용자 눈앞에 시험 창이 튀지 않게.
/// 메인 창 자리를 읽지 않는다: 앱을 켤 때 다시 여는 모드 창은 메인 창 옮기기가 반영되기 전이라 옛 자리(주 화면)가 나왔다(2026-10-10)
pub fn place_near_main<R: Runtime>(_app: &tauri::AppHandle<R>, w: &tauri::WebviewWindow<R>) {
    if !cfg!(debug_assertions) || std::env::var("CHAMMO_DEV_WINDOW").as_deref() == Ok("main") {
        return;
    }
    if let Some(((x, y), _)) = aside_of(w) {
        let _ = w.set_position(tauri::LogicalPosition::new(x + 60, y + 60));
    }
}

/// 옆 화면 자리(논리 좌표)와 그 화면 크기 — 화면 밖이면 크기 None
fn aside_of<R: Runtime>(w: &tauri::WebviewWindow<R>) -> Option<((i32, i32), Option<(u32, u32)>)> {
    let ms = w.available_monitors().ok()?;
    // 화면마다 배율이 달라(맥북 2배·가짜 화면 1배) 물리 픽셀을 섞으면 자리·크기가 반쪽이 됐다(2026-10-03 실측) — 논리 좌표로 고른다
    let lg = |m: &tauri::Monitor| {
        let s = m.scale_factor();
        ((m.position().x as f64 / s) as i32, (m.position().y as f64 / s) as i32, (m.size().width as f64 / s) as u32, (m.size().height as f64 / s) as u32)
    };
    let list: Vec<_> = ms.iter().map(|m| { let (x, y, w, h) = lg(m); (x, y, w, h, m.name().is_some_and(|n| n == crate::vdisplay::NAME || n == crate::craft_screen::NAME)) }).collect();
    // CHAMMO_DEV_WINDOW=x,y — 그 자리(논리 점)에. 외장 모니터가 있으면 옆 화면이 사람이 쓰는 맥북 화면이라 가짜 화면 좌표를 직접 준다
    // (잠긴 화면에선 가짜 화면 이름을 못 읽고 AX 로도 못 옮긴다, 2026-10-21)
    if let Some((x, y)) = std::env::var("CHAMMO_DEV_WINDOW").ok().and_then(|v| dev_spot(&v)) {
        return Some(((x, y), None));
    }
    let (spot, at) = aside_spot(&list, 1.0);
    Some((spot, at.map(|i| (list[i].2, list[i].3))))
}

/// CHAMMO_DEV_WINDOW 의 "x,y" — 아니면 None
pub fn dev_spot(v: &str) -> Option<(i32, i32)> {
    let (x, y) = v.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

pub fn place_dev_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if !cfg!(debug_assertions) || std::env::var("CHAMMO_DEV_WINDOW").as_deref() == Ok("main") {
        return;
    }
    let Some(w) = app.get_webview_window("main") else { return };
    let Some(((x, y), screen)) = aside_of(&w) else { return };
    let _ = w.set_position(tauri::LogicalPosition::new(x, y));
    if let Some((mw, mh)) = screen {
        // 그 화면에 들어가게 — 화면보다 크면 줄인다(논리 크기)
        if let (Ok(sz), Ok(s)) = (w.outer_size(), w.scale_factor()) {
            let (cw, ch) = ((sz.width as f64 / s) as u32, (sz.height as f64 / s) as u32);
            let (fw, fh) = (cw.min(mw.saturating_sub(40)), ch.min(mh.saturating_sub(80)));
            if (fw, fh) != (cw, ch) {
                let _ = w.set_size(tauri::LogicalSize::new(fw, fh));
            }
        }
    }
}

#[cfg(test)]
mod pick_log_tests {
    #[test]
    fn 덧붙이고_크기를_넘으면_앞을_버린다() {
        let p = std::env::temp_dir().join(format!("chammo-picklog-{}.log", std::process::id()));
        let _ = std::fs::remove_file(&p);
        super::append_capped(&p, "하나", 100).unwrap();
        super::append_capped(&p, "둘", 100).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "하나\n둘\n");
        super::append_capped(&p, &"가".repeat(60), 100).unwrap(); // 180 바이트 → 100 이하로 앞을 자른다(글자 경계 지킴)
        let t = std::fs::read_to_string(&p).unwrap();
        assert!(t.len() <= 100 && t.ends_with("가\n"), "{}", t.len());
        let _ = std::fs::remove_file(&p);
    }
}

#[cfg(test)]
mod perf_alert_tests {
    use super::alerts_for;
    #[test]
    fn 성능_알림은_개인판_데이터_폴더에서만_넘긴다() {
        let a = vec![serde_json::json!({"kind": "bg-cap"})];
        assert_eq!(alerts_for(std::path::Path::new("/h/.honor-orchestrator"), a.clone()).len(), 1);
        // 공개판 사용자 참모에겐 없는 개발자 스킬을 시키는 줄이라 버린다(0.4.6 2차 검증)
        assert!(alerts_for(std::path::Path::new("/h/.chammo"), a.clone()).is_empty());
        assert!(alerts_for(std::path::Path::new("C:\\chammo-qa\\data"), a).is_empty());
    }
}

#[cfg(test)]
mod aside_tests {
    use super::aside_spot;
    #[test]
    fn 개발판_창_자리는_x_y_로_줄_수_있다() {
        assert_eq!(super::dev_spot("-2890,1440"), Some((-2890, 1440)));
        assert_eq!(super::dev_spot("main"), None);
        assert_eq!(super::dev_spot("1,x"), None);
    }
    #[test]
    fn 외장_모니터가_있으면_주_화면_아닌_진짜_화면() {
        // 주 화면(0,0 1920x1080) + 왼쪽 맥북 + 가짜 화면
        let ms = [(0, 0, 1920, 1080, false), (-2880, 2000, 2880, 1800, true), (-2940, 248, 2940, 1912, false)];
        assert_eq!(aside_spot(&ms, 2.0), ((-2940 + 40, 248 + 80), Some(2)));
    }
    #[test]
    fn 맥북_하나면_가짜_화면에_사용자_눈앞에_안_뜨게() {
        let ms = [(0, 0, 2940, 1912, false), (-2880, 1912, 2880, 1800, true)];
        assert_eq!(aside_spot(&ms, 2.0), ((-2880 + 40, 1912 + 80), Some(1)));
    }
    #[test]
    fn 둘_다_없으면_화면_밖() {
        let ((x, _), at) = aside_spot(&[(0, 0, 2940, 1912, false)], 2.0);
        assert!(x > 2940 && at.is_none());
    }
}

#[cfg(test)]
#[path = "perf_seed_live_tests.rs"]
mod perf_seed;
