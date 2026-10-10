//! 크롬 자체 창(패스키) 알아보기를 진짜 크롬 베타로 끝에서 끝까지 — 평소엔 안 돈다(창이 뜨는 맥 화면이 있어야 한다).
//! `CHAMMO_HOME=<빈 시험 폴더> cargo test chrome_popup_e2e -- --ignored --nocapture --test-threads=1`
//! 창 자리는 CHAMMO_TEST_WIN_POS=x,y(기본 -2850,1000 = 이 맥의 가짜 화면 'Chammo agents') — 사용자 화면에 안 띄운다.
//! 세션 크롬처럼 앱을 가린(⌘H) 채로 localhost 페이지가 패스키를 부르면 → 앱 감시(watch_popups)가 popup 을 내고, 요청을 끊으면 내린다
use super::*;
use std::io::{Read, Write};

const BETA: &str = "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta";
const PAGE: &str = "<!doctype html><title>pk</title><button id=b style='position:fixed;left:0;top:0;width:200px;height:100px'>get</button>\
<script>b.onclick=()=>{window.r='pending';navigator.credentials.get({publicKey:{challenge:new Uint8Array(32),rpId:'localhost',userVerification:'preferred',timeout:120000}})\
.then(()=>{window.r='ok'},e=>{window.r='err:'+e.name})}</script>";

struct Chrome {
    child: std::process::Child,
    dir: PathBuf,
}
impl Drop for Chrome {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

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

/// localhost 안전한 출처(패스키는 https 나 localhost 에서만) — 같은 페이지를 계속 준다
fn serve() -> u16 {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut s in l.incoming().flatten() {
            let mut buf = [0u8; 2048];
            let _ = s.read(&mut buf);
            let _ = write!(s, "HTTP/1.1 200 OK\r\ncontent-type: text/html\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{PAGE}", PAGE.len());
        }
    });
    port
}

#[test]
#[ignore]
fn chrome_popup_e2e() {
    let home = std::env::var("HOME").unwrap_or_default();
    assert!(!crate::config::is_real_data(&home, crate::config::data_dir()), "CHAMMO_HOME 을 시험 폴더로 줘");
    let profile = format!("e2e-pk-{}", std::process::id());
    let dir = std::env::temp_dir().join(format!("chammo-pk-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let pos = std::env::var("CHAMMO_TEST_WIN_POS").unwrap_or_else(|_| "-2850,1000".into());
    // 세션 크롬과 같은 키체인 인자 — 패스키 창은 이 인자와 무관하다(실측)지만 같은 조건으로
    let child = crate::platform::command(BETA)
        .args(["--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "--test-type", "--window-size=1200,800", "about:blank"])
        .arg(format!("--window-position={pos}"))
        .arg(format!("--user-data-dir={}", dir.display()))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("크롬 베타");
    let chrome = Chrome { child, dir: dir.clone() };
    let (port, ws) = wait_for("DevToolsActivePort", 20, || {
        let t = std::fs::read_to_string(dir.join("DevToolsActivePort")).ok()?;
        let mut l = t.lines();
        Some((l.next()?.trim().parse::<u16>().ok()?, l.next()?.trim().to_string()))
    });
    let live = Live { profile: profile.clone(), pid: chrome.child.id() as i32, session_pid: 1, port, ws_path: ws, url: String::new(), title: String::new(), tabs: vec![], tool: String::new(), tool_at: 0, busy: false, ts: 0, ask: None, gate: false, held: 0, takeover: None, scripts: 0, popup: false };
    std::fs::create_dir_all(live_dir()).unwrap();
    std::fs::write(live_dir().join(format!("{profile}.json")), serde_json::to_string(&live).unwrap()).unwrap();
    let pid = wait_for("크롬 pid", 10, || chrome_pid(port));

    let web = serve();
    let mut owner = Cdp { ws: wait_for("주인 연결", 10, || connect(&live).ok()), next: 0 };
    let t = owner.call("Target.createTarget", serde_json::json!({ "url": format!("http://localhost:{web}/") }), None, |_| {}).unwrap();
    let target = t["targetId"].as_str().unwrap().to_string();
    let s = owner.call("Target.attachToTarget", serde_json::json!({ "targetId": target, "flatten": true }), None, |_| {}).unwrap();
    let s = s["sessionId"].as_str().unwrap().to_string();
    let eval = |c: &mut Cdp, e: &str| c.call("Runtime.evaluate", serde_json::json!({ "expression": e, "returnByValue": true }), Some(&s), |_| {}).map(|r| r["result"]["value"].clone());
    wait_for("페이지", 10, || (eval(&mut owner, "!!document.getElementById('b')").ok()? == serde_json::json!(true)).then_some(()));

    // 아무 칸도 안 보고 있다(일꾼 없음) — 2026-10-10 네이버 때처럼. 앱의 1초 감시만으로 알아야 한다
    watch_popups();
    let popup = |p: &str| agent_lives().iter().any(|l| l.profile == p && l.popup);
    std::thread::sleep(Duration::from_millis(2500));
    assert!(!popup(&profile), "패스키 부르기 전엔 popup 이 없어야(평소 창으로 헛 알림 금지)");

    // 앱처럼 가린다(창이 다 뜬 뒤에 — 띄우자마자 가리면 안 먹을 때가 있다) — 가린 크롬은 패스키 창도 가린 채 띄우고 스스로 안 보인다(실측)
    app_window::hide(pid);
    wait_for("가려짐", 5, || (app_window::hidden(pid) == Some(true)).then_some(()));
    // 사람 누름처럼(user gesture) 버튼을 누른다
    for ty in ["mousePressed", "mouseReleased"] {
        owner.call("Input.dispatchMouseEvent", serde_json::json!({ "type": ty, "x": 50, "y": 40, "button": "left", "clickCount": 1 }), Some(&s), |_| {}).unwrap();
    }
    wait_for("패스키 요청이 걸림", 10, || (eval(&mut owner, "window.r").ok()? == serde_json::json!("pending")).then_some(()));
    let t0 = Instant::now();
    wait_for("앱이 크롬 자체 창을 알아봄", 15, || popup(&profile).then_some(()));
    println!("popup 알아봄 {:?}", t0.elapsed());
    assert_eq!(app_window::hidden(pid), Some(true), "크롬은 여전히 가려져 있다 — 사람 눈엔 안 보이는 상태(그래서 줄이 필요)");

    // 요청을 끊으면(다른 데로 가면) 창이 닫히고 popup 도 내린다 — 가려진 크롬은 닫힌 창을 목록에서 늦게 뺀다(실측 0.8~21초).
    // 그동안 줄이 남는 건 받아들인다(누르면 크롬이 보일 뿐)
    let t1 = Instant::now();
    owner.call("Page.navigate", serde_json::json!({ "url": "about:blank" }), Some(&s), |_| {}).unwrap();
    let gone = wait_for("창이 목록에서 빠짐", 40, || (!crate::chrome_popup::windows(pid).iter().any(|w| w.rect.w == 448.0 && w.rect.h == 387.0)).then(|| t1.elapsed()));
    println!("닫힌 창이 목록에서 빠지기까지 {gone:?}");
    wait_for("창이 닫히면 popup 도 내림", 10, || (!popup(&profile)).then_some(()));
    println!("popup 내림 {:?}", t1.elapsed());
    let _ = std::fs::remove_file(live_dir().join(format!("{profile}.json")));
}
