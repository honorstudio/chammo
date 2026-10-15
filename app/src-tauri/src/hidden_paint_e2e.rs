//! 가린 세션 크롬을 옮기면 그림이 멈추던 것(2026-10-10 프로젝트P 세션) — 진짜 정품 크롬으로 끝에서 끝까지. 평소엔 안 돈다(맥 화면·가짜 화면이 있어야 한다).
//! 먼저 래퍼를 시험 홈으로 띄워 정품 크롬을 연다(세션 크롬과 같은 조건 — 플레이라이트가 붙어 있어야 한다):
//! `CHAMMO_HOME=<시험 홈> CHAMMO_BROWSER_HOME=<시험 홈>/browser CHAMMO_BROWSER_CHANNEL=chrome node tools/chammo-browser/bin/chammo-browser-mcp.js <시험 프로필>` + 아무 페이지 navigate
//! `CHAMMO_HOME=<빈 시험 폴더> CHAMMO_TEST_PROFILE_DIR=<시험 홈>/browser/profiles/<시험 프로필> cargo test hidden_paint_e2e -- --ignored --nocapture --test-threads=1`
//! CHAMMO_TEST_VD=x,y,w,h(가짜 화면, 크롬 좌표 — 기본 -2910,956,1440,900) · CHAMMO_TEST_REAL_POS=x,y(가린 채 잠깐 옮길 진짜 화면 자리 — 기본 맥북 -1300,100).
//! 진짜 화면 자리는 **가린 뒤에만** 옮긴다 — 사람 눈엔 안 보인다. 실측(정품 154): 가린 채 옮기면 rAF 1.5초 0~4번·screencast 0장, 되돌려도 그대로일 때가 있고,
//! 가짜 화면에서 잠깐 보였다 다시 가리면 rAF 180번·screencast 2초 120장(베타 156 은 안 멈춘다)
use super::*;

fn wait_for<T>(what: &str, secs: u64, mut f: impl FnMut() -> Option<T>) -> T {
    let until = Instant::now() + Duration::from_secs(secs);
    loop {
        if let Some(v) = f() {
            return v;
        }
        assert!(Instant::now() < until, "시간 안에 안 됨: {what}");
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn nums(key: &str, default: &str) -> Vec<f64> {
    std::env::var(key).unwrap_or_else(|_| default.into()).split(',').filter_map(|s| s.trim().parse().ok()).collect()
}

#[test]
#[ignore]
fn hidden_paint_e2e() {
    let home = std::env::var("HOME").unwrap_or_default();
    assert!(!crate::config::is_real_data(&home, crate::config::data_dir()), "CHAMMO_HOME 을 시험 폴더로 줘");
    let v = nums("CHAMMO_TEST_VD", "-2910,956,1440,900");
    let vd = crate::vdisplay::Rect { x: v[0], y: v[1], w: v[2], h: v[3] };
    let real = nums("CHAMMO_TEST_REAL_POS", "-1300,100");
    // 래퍼(chammo-browser-mcp)가 시험 홈에 띄운 크롬에 붙는다 — 플레이라이트가 붙은 세션 크롬과 맨 크롬은 가림에 달리 군다(맨 크롬은 가짜 화면에서 가리기만 해도 멈춤, 실측)
    let dir = PathBuf::from(std::env::var("CHAMMO_TEST_PROFILE_DIR").expect("CHAMMO_TEST_PROFILE_DIR = 래퍼가 띄운 시험 프로필 폴더"));
    let profile = dir.file_name().unwrap().to_string_lossy().to_string();
    let place = crate::vdisplay::place_in(vd);
    let (port, ws) = wait_for("DevToolsActivePort", 20, || {
        let t = std::fs::read_to_string(dir.join("DevToolsActivePort")).ok()?;
        let mut l = t.lines();
        Some((l.next()?.trim().parse::<u16>().ok()?, l.next()?.trim().to_string()))
    });
    let live = Live { profile: profile.clone(), pid: 1, session_pid: 1, port, ws_path: ws, url: String::new(), title: String::new(), tabs: vec![], tool: String::new(), tool_at: 0, busy: false, ts: 0, ask: None, gate: false, held: 0, takeover: None, scripts: 0, popup: false, popup_kind: String::new() };
    let pid = wait_for("크롬 pid", 10, || chrome_pid(port));

    let mut owner = Cdp { ws: wait_for("주인 연결", 10, || connect(&live).ok()), next: 0 };
    let got = owner.call("Target.getTargets", serde_json::json!({}), None, |_| {}).unwrap();
    let target = got["targetInfos"].as_array().unwrap().iter().find(|t| t["type"] == "page").unwrap()["targetId"].as_str().unwrap().to_string();
    let s = owner.call("Target.attachToTarget", serde_json::json!({ "targetId": target, "flatten": true }), None, |_| {}).unwrap();
    let s = s["sessionId"].as_str().unwrap().to_string();
    let eval = |c: &mut Cdp, e: &str| c.call("Runtime.evaluate", serde_json::json!({ "expression": e, "returnByValue": true }), Some(&s), |_| {}).map(|r| r["result"]["value"].clone());
    eval(&mut owner, "window.__f=0;(function f(){window.__f++;requestAnimationFrame(f)})();1").unwrap();
    // 1.5초 동안 rAF 몇 번 — 그리면 90(60Hz) 안팎, 멈추면 한 자리
    let frames = |c: &mut Cdp| {
        let a = eval(c, "window.__f").unwrap().as_f64().unwrap_or(0.0);
        std::thread::sleep(Duration::from_millis(1500));
        eval(c, "window.__f").unwrap().as_f64().unwrap_or(0.0) - a
    };
    let win = owner.call("Browser.getWindowForTarget", serde_json::json!({ "targetId": target }), None, |_| {}).unwrap()["windowId"].as_i64().unwrap();
    std::thread::sleep(Duration::from_millis(1500));
    println!("가짜 화면·보임: rAF {}", frames(&mut owner));

    // 앱처럼 가린다 — 가려진 걸 본 뒤에만 진짜 화면 자리로(사람 눈엔 안 보인다)
    app_window::hide(pid);
    wait_for("가려짐", 5, || (app_window::hidden(pid) == Some(true)).then_some(()));
    std::thread::sleep(Duration::from_millis(500));
    println!("가짜 화면·가림: rAF {}", frames(&mut owner));
    let to_real = |c: &mut Cdp| {
        assert_eq!(app_window::hidden(pid), Some(true), "안 가려진 채로 진짜 화면에 옮기지 않는다");
        set_bounds(c, win, crate::vdisplay::Rect { x: real[0], y: real[1], w: 800.0, h: 600.0 });
        std::thread::sleep(Duration::from_millis(800));
    };
    // 고치기 전 모양 — 창만 가짜 화면으로 되돌리면 멈춘 채일 때가 있다(Page.reload 도 소용없었다). 기록만
    to_real(&mut owner);
    let first = frames(&mut owner);
    set_bounds(&mut owner, win, place);
    std::thread::sleep(Duration::from_millis(800));
    println!("가린 채 진짜 화면 rAF {first} → 창만 되돌림 rAF {}", frames(&mut owner));

    // 앱 길 — 지킴이·rehome_all 처럼 가린 크롬을 rehome 으로 가짜 화면에. 멈춤은 들쭉날쭉(몇 번째 옮김에 걸린다)이라 걸릴 때까지 몇 번
    let mut stuck = f64::MAX;
    for n in 1..=5 {
        to_real(&mut owner);
        stuck = frames(&mut owner);
        rehome_into(&live, vd).unwrap();
        std::thread::sleep(Duration::from_millis(800));
        let fixed = frames(&mut owner);
        println!("{n}번째: 가린 채 진짜 화면 rAF {stuck} → rehome 뒤 rAF {fixed}");
        assert!(fixed > 45.0, "가린 채 옮긴 크롬을 rehome 이 깨워야 한다 (멈춤 {stuck} · rehome 뒤 {fixed})");
        let wins = chrome_windows(&mut owner).unwrap();
        assert!(wins.iter().all(|w| crate::vdisplay::inside(w.1, vd)), "창은 다 가짜 화면 안: {wins:?}");
        assert_eq!(app_window::hidden(pid), Some(true), "깨운 뒤에도 가려져 있다");
        if stuck < 30.0 {
            break;
        }
    }
    if stuck >= 30.0 {
        println!("이번엔 가린 채 옮겨도 안 멈췄다 — 멈춤 재현 없음(깨우기는 확인 못 함)");
    }
    let _ = owner.ws.close(None);
}
