//! 진짜 크롬(헤드리스)으로 JS 대화상자 굳음(QA B6)을 끝에서 끝까지 — 평소엔 안 돈다.
//! `CHAMMO_HOME=<빈 시험 폴더> cargo test agent_dialog_e2e -- --ignored --nocapture --test-threads=1`
//! 플레이라이트처럼 Page 를 켜 둔 '주인' 세션이 따로 붙어 있고(그래야 대화상자가 떠서 기다린다), 앱 일꾼은 그 옆에서 붙었다 떨어진다
use super::*;

const CHROME: &str = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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

/// 크롬을 띄우고 live 파일을 시험 데이터 폴더에 적는다 — 진짜 데이터 폴더면 멈춘다(진짜 앱이 그 파일을 본다)
fn start(profile: &str) -> (Chrome, Live) {
    let home = std::env::var("HOME").unwrap_or_default();
    assert!(!crate::config::is_real_data(&home, crate::config::data_dir()), "CHAMMO_HOME 을 시험 폴더로 줘");
    let dir = std::env::temp_dir().join(format!("chammo-dlg-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let child = crate::platform::command(CHROME)
        // 가짜 키체인 — 빠지면 사람 화면에 맥 키체인 암호 창이 뜬다(10-27)
        .args(["--headless=new", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "--window-size=800,600", "about:blank"])
        .arg(format!("--user-data-dir={}", dir.display()))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("크롬");
    let pid = child.id() as i32;
    let c = Chrome { child, dir: dir.clone() };
    let (port, ws) = wait_for("DevToolsActivePort", 15, || {
        let t = std::fs::read_to_string(dir.join("DevToolsActivePort")).ok()?;
        let mut l = t.lines();
        Some((l.next()?.trim().parse::<u16>().ok()?, l.next()?.trim().to_string()))
    });
    let live = Live { profile: profile.into(), pid, session_pid: 1, port, ws_path: ws, url: String::new(), title: String::new(), tabs: vec![], tool: String::new(), tool_at: 0, busy: false, ts: 0, ask: None, gate: false, held: 0, takeover: None, scripts: 0, popup: false, popup_kind: String::new(), wake: None, signable: false };
    std::fs::create_dir_all(live_dir()).unwrap();
    std::fs::write(live_dir().join(format!("{profile}.json")), serde_json::to_string(&live).unwrap()).unwrap();
    (c, live)
}

/// 플레이라이트 몫 — 탭에 붙어 Page 를 켜 둔 세션(대화상자를 받는 다른 손님)
struct Owner {
    cdp: Cdp,
}
impl Owner {
    fn new(live: &Live) -> Owner {
        Owner { cdp: Cdp { ws: wait_for("주인 연결", 10, || connect(live).ok()), next: 0 } }
    }
    fn tab(&mut self, url: &str) -> (String, String) {
        let t = self.cdp.call("Target.createTarget", serde_json::json!({ "url": url }), None, |_| {}).unwrap();
        let id = t["targetId"].as_str().unwrap().to_string();
        let s = self.cdp.call("Target.attachToTarget", serde_json::json!({ "targetId": id, "flatten": true }), None, |_| {}).unwrap();
        let s = s["sessionId"].as_str().unwrap().to_string();
        self.cdp.call("Page.enable", serde_json::json!({}), Some(&s), |_| {}).unwrap();
        (id, s)
    }
    fn eval(&mut self, s: &str, expr: &str) -> Result<serde_json::Value, String> {
        self.cdp.call("Runtime.evaluate", serde_json::json!({ "expression": expr, "returnByValue": true }), Some(s), |_| {}).map(|r| r["result"]["value"].clone())
    }
    /// 대화상자를 띄운다(평가는 바로 돌아오게 setTimeout 으로)
    fn confirm(&mut self, s: &str, msg: &str) {
        self.eval(s, &format!("window.r = undefined; setTimeout(() => {{ window.r = confirm('{msg}'); }}, 50); 1")).unwrap();
    }
}

/// 다른 연결·새 세션으로 그 탭이 살아 있나(대화상자가 떠 있으면 평가가 안 돌아온다)
fn answer_of(live: &Live, target: &str) -> Result<serde_json::Value, String> {
    let mut c = Cdp { ws: connect(live)?, next: 0 };
    let s = c.call("Target.attachToTarget", serde_json::json!({ "targetId": target, "flatten": true }), None, |_| {})?;
    let s = s["sessionId"].as_str().unwrap_or_default().to_string();
    let r = c.call("Runtime.evaluate", serde_json::json!({ "expression": "window.r", "returnByValue": true }), Some(&s), |_| {});
    let _ = c.ws.close(None);
    r.map(|r| r["result"]["value"].clone())
}

/// 칸이 보고 있다 — frame_bytes 를 계속 물어 일꾼을 살려 둔다(보는 칸 흉내)
struct Watch(Arc<AtomicBool>);
impl Watch {
    fn on(profile: &str) -> Watch {
        let on = Arc::new(AtomicBool::new(true));
        let (o, p) = (on.clone(), profile.to_string());
        std::thread::spawn(move || {
            while o.load(Ordering::Relaxed) {
                let _ = frame_bytes(&p, 0);
                std::thread::sleep(Duration::from_millis(300));
            }
        });
        Watch(on)
    }
}
impl Drop for Watch {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Relaxed);
    }
}

fn show(profile: &str, target: &str) {
    agent_pin(profile.into(), Some(target.into()));
    wait_for("그 탭으로", 10, || (agent_tabs(profile.into()).current.as_deref() == Some(target)).then_some(()));
}

#[test]
#[ignore]
fn agent_dialog_e2e() {
    let profile = format!("e2e-dlg-{}", std::process::id());
    let (_chrome, live) = start(&profile);
    let mut owner = Owner::new(&live);
    let (a, sa) = owner.tab("data:text/html,<title>A</title><p>A");
    let (b, _sb) = owner.tab("data:text/html,<title>B</title><p>B");
    // 대화상자 답은 사람 조작 — 개입 중에만 받는다(2026-10-06 98bd15ce). 안 켜면 agent_dialog 가 조용히 버려 '① 풀림'이 늘 시간 초과였다
    agent_takeover(profile.clone(), live.pid, None).unwrap();

    // ① 탭을 바꿨다 돌아와 취소 — 그 대화상자를 받은 세션으로 답해야 풀린다. 다른 탭을 보는 동안엔 모달에 안 뜬다
    let w = Watch::on(&profile);
    show(&profile, &a);
    owner.confirm(&sa, "q1");
    wait_for("대화상자 ①", 10, || agent_tabs(profile.clone()).dialog);
    show(&profile, &b);
    std::thread::sleep(Duration::from_millis(700));
    assert!(agent_tabs(profile.clone()).dialog.is_none(), "B 탭을 보는데 A 탭 대화상자가 떠 있다");
    show(&profile, &a);
    wait_for("돌아오면 대화상자 다시", 5, || agent_tabs(profile.clone()).dialog);
    agent_dialog(profile.clone(), live.pid, Some(a.clone()), false, None);
    let r = wait_for("① 풀림", 15, || answer_of(&live, &a).ok());
    assert_eq!(r, serde_json::json!(false), "취소가 그 대화상자에 가야 한다");

    // ② 대화상자가 뜬 채 칸이 3초 넘게 안 봄(모달 닫음) → 다시 보면 그 대화상자가 그대로 보이고 풀린다
    owner.confirm(&sa, "q2");
    wait_for("대화상자 ②", 10, || agent_tabs(profile.clone()).dialog);
    drop(w);
    std::thread::sleep(IDLE + Duration::from_secs(2));
    let w = Watch::on(&profile);
    let d = wait_for("다시 보면 대화상자 ②", 5, || agent_tabs(profile.clone()).dialog);
    assert_eq!(d["message"], "q2");
    agent_dialog(profile.clone(), live.pid, None, true, None);
    let r = wait_for("② 풀림", 15, || answer_of(&live, &a).ok());
    assert_eq!(r, serde_json::json!(true));
    drop(w);

    // ③ 앱이 안 보는 동안 뜬 대화상자(세션이 띄움) — 새로 붙은 세션도 Page 를 켜면 그 대화상자를 받고 답할 수 있다(실측)
    std::thread::sleep(IDLE + Duration::from_secs(2)); // 대화상자 없으면 일꾼은 3초 뒤 끝난다
    owner.confirm(&sa, "q3");
    std::thread::sleep(Duration::from_millis(300));
    let w = Watch::on(&profile);
    show(&profile, &a);
    let d = wait_for("나중에 붙어도 대화상자 ③", 5, || agent_tabs(profile.clone()).dialog);
    assert_eq!(d["message"], "q3");
    agent_dialog(profile.clone(), live.pid, Some(a.clone()), true, None);
    assert_eq!(wait_for("③ 풀림", 15, || answer_of(&live, &a).ok()), serde_json::json!(true));

    // ④ 대화상자를 받은 일꾼이 끊김(앱 재시작 흉내) — 크롬은 새 세션 답을 거절한다. 앱은 오류를 버리지 않고 '멈춤'으로 알린다
    owner.confirm(&sa, "q4");
    wait_for("대화상자 ④", 10, || agent_tabs(profile.clone()).dialog);
    drop(w);
    with_workers(|ws| if let Some(old) = ws.remove(&profile) { old.stop.store(true, Ordering::Relaxed); });
    std::thread::sleep(Duration::from_secs(1));
    let w = Watch::on(&profile);
    show(&profile, &a);
    let t0 = Instant::now();
    loop {
        let t = agent_tabs(profile.clone());
        if t.stuck { break; }
        if t.dialog.is_some() { agent_dialog(profile.clone(), live.pid, Some(a.clone()), false, None); }
        assert!(t0.elapsed() < Duration::from_secs(10), "④ 멈춤 표시가 안 뜸 dialog={:?}", t.dialog);
        std::thread::sleep(Duration::from_millis(200));
    }
    // 사람이 크롬에서 눌러 풀면(여기선 주인이 답) 늦게 온 '살아 있나' 답이 멈춤 표시를 지운다
    owner.cdp.call("Page.handleJavaScriptDialog", serde_json::json!({ "accept": false }), Some(&sa), |_| {}).unwrap();
    wait_for("멈춤 풀림 ④", 8, || (!agent_tabs(profile.clone()).stuck).then_some(()));
    assert_eq!(answer_of(&live, &a).unwrap(), serde_json::json!(false));
    drop(w);

    let _ = owner.eval(&sa, "1");
    let _ = agent_handback(profile.clone(), live.pid);
    let _ = std::fs::remove_file(live_dir().join(format!("{profile}.json")));
}

/// 2026-10-05 사용자 실사용 — 세션 브라우저가 닫혔는데 모달엔 마지막 화면이 '사진'처럼 남고 머리엔 '주소 확인 중'만 계속.
/// 일꾼이 그 두 상태를 모달이 가를 수 있게 알려 주는지 진짜 크롬으로 — ① 크롬은 살았는데 탭이 0개 ② 다시 열면 이어짐 ③ 크롬이 죽음.
/// `CHAMMO_HOME=<빈 시험 폴더> cargo test agent_closed_e2e -- --ignored --nocapture --test-threads=1`
#[test]
#[ignore]
fn agent_closed_e2e() {
    let profile = format!("e2e-closed-{}", std::process::id());
    let (chrome, live) = start(&profile);
    let mut owner = Owner::new(&live);
    let (a, _sa) = owner.tab("data:text/html,<title>A</title><p>A");
    let w = Watch::on(&profile);
    show(&profile, &a);
    wait_for("첫 화면", 10, || (frame_bytes(&profile, 0).len() > 8).then_some(()));
    agent_pin(profile.clone(), None);

    // ① 탭을 다 닫는다(맥에서 마지막 창을 닫은 것과 같다 — 크롬 프로세스·디버깅 포트는 산다)
    let got = owner.cdp.call("Target.getTargets", serde_json::json!({}), None, |_| {}).unwrap();
    for t in got["targetInfos"].as_array().unwrap().iter().filter_map(page_of) {
        let _ = owner.cdp.call("Target.closeTarget", serde_json::json!({ "targetId": t.id }), None, |_| {});
    }
    let t = wait_for("탭 0개", 10, || {
        let t = agent_tabs(profile.clone());
        (t.pages.is_empty() && t.current.is_none()).then_some(t)
    });
    assert!(port_open(live.port), "크롬이 살아 있어야 이 경우다");
    assert!(t.attached, "붙은 채 탭이 0개 — 모달이 '붙는 중'과 갈라 '닫혔어'를 그릴 수 있어야 한다");
    assert_eq!(t.error, "", "오류가 없다 — 그래서 예전 모달은 '주소 확인 중'만 띄웠다");
    // 덮개의 다시 시도 — 도는 일꾼도 끊고 새로 붙는다(탭 0개 그대로라도 다시 읽는다)
    let old = with_workers(|ws| ws.get(&profile).map(|w| Arc::as_ptr(&w.view) as usize));
    agent_retry(profile.clone());
    wait_for("다시 시도로 새 일꾼", 10, || {
        let t = agent_tabs(profile.clone());
        let now = with_workers(|ws| ws.get(&profile).map(|w| Arc::as_ptr(&w.view) as usize));
        (now != old && t.attached && t.pages.is_empty()).then_some(())
    });

    // ② 세션이 다시 열면 이어진다
    let (b, _sb) = owner.tab("data:text/html,<title>B</title><p>B");
    wait_for("다시 열면 그 탭", 10, || (agent_tabs(profile.clone()).current.as_deref() == Some(b.as_str())).then_some(()));

    // ③ 크롬이 죽는다 — 화면 받기 이유가 '꺼짐' 쪽으로(모달은 화면이 있어도 덮개를 그려야 한다)
    drop(owner);
    drop(chrome);
    let t = wait_for("죽은 크롬 이유", 15, || {
        let t = agent_tabs(profile.clone());
        (!t.error.is_empty()).then_some(t)
    });
    assert!(!t.attached);
    let off = ["no live", "refused", "reset", "closed", "broken pipe", "os error 32", "os error 54", "os error 61"];
    assert!(off.iter().any(|k| t.error.to_lowercase().contains(k)), "꺼짐으로 읽혀야 한다: {}", t.error);
    drop(w);
    let _ = std::fs::remove_file(live_dir().join(format!("{profile}.json")));
}

/// 스크립트가 `chammo-browser launch` 로 띄운 크롬(2026-10-06 아이맥 project-x) — 앱이 세션 브라우저 목록에 그 세션 것(CLAUDE_PID)으로 넣고
/// 화면을 받고, 주인 스크립트가 끝나면 목록에서 빠진다. node 와 tools/chammo-browser 의존성(npm ci)이 있어야 한다.
/// `CHAMMO_HOME=<빈 시험 폴더> cargo test agent_script_e2e -- --ignored --nocapture`
#[test]
#[ignore]
fn agent_script_e2e() {
    let home = std::env::var("HOME").unwrap_or_default();
    assert!(!crate::config::is_real_data(&home, crate::config::data_dir()), "CHAMMO_HOME 을 시험 폴더로 줘");
    let profile = format!("e2e-script-{}", std::process::id());
    let tool = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/chammo-browser/bin/chammo-browser.js");
    // 주인 스크립트 흉내 — 죽이면 지킴이가 크롬을 닫는다
    let mut owner = crate::platform::command("sleep").arg("120").spawn().expect("sleep");
    let out = crate::platform::command("node")
        .arg(&tool)
        .args(["launch", &profile, "--headless", "--owner", &owner.id().to_string()])
        .env("CLAUDE_PID", "4242")
        .output()
        .expect("node");
    let r: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("launch 출력: {}", String::from_utf8_lossy(&out.stdout)));
    assert_eq!(r["ok"], true, "{r}");
    let holder = r["holder"].as_i64().unwrap() as i32;

    // ① 앱 목록에 — 그 세션(CLAUDE_PID) 것으로, 주인 = 지킴이
    let live = wait_for("앱 세션 브라우저 목록", 15, || agent_lives().into_iter().find(|l| l.profile == profile));
    assert_eq!(live.session_pid, 4242);
    assert_eq!(live.pid, holder);
    assert!(r["wsEndpoint"].as_str().unwrap().ends_with(&live.ws_path), "launch 가 준 주소 = 앱이 붙는 주소");

    // ② 스크립트가 탭을 열면 상태 파일 주소가 따라오고, 앱 일꾼이 그 화면을 받는다
    let mut cdp = Owner::new(&live);
    let (tab, _s) = cdp.tab("data:text/html,<title>script-tab</title><h1 style='font-size:80px'>script</h1>");
    let w = Watch::on(&profile);
    wait_for("상태 파일에 지금 주소", 15, || read_live(&profile).filter(|l| l.url.starts_with("data:text/html")).map(|_| ()));
    show(&profile, &tab);
    wait_for("첫 화면", 15, || (frame_bytes(&profile, 0).len() > 8).then_some(()));

    // ③ 주인 스크립트가 끝나면 지킴이가 닫는다 — 목록에서 빠지고 락도 없다
    drop(cdp);
    let _ = owner.kill();
    let _ = owner.wait();
    wait_for("주인이 끝나면 목록에서 빠짐", 15, || (!agent_lives().iter().any(|l| l.profile == profile) && !crate::platform::pid_alive(holder)).then_some(()));
    assert!(!crate::config::data_file("browser").join("locks").join(format!("{profile}.lock")).exists(), "락 반납");
    drop(w);
}

/// 숨긴 크롬의 위치·알림 말풍선 대신 모달에서 허용·거부(roadmap 부채 agent-browser-modal ②) — 진짜 크롬(헤드리스)·작은 http 서버로.
/// 일꾼이 붙을 때 넣은 감시 스크립트가 '물어봄'을 알리고, 모달 답(Browser.setPermission)으로 페이지가 이어 가는지.
/// `CHAMMO_HOME=<빈 시험 폴더> cargo test agent_perm_e2e -- --ignored --nocapture --test-threads=1`
#[test]
#[ignore]
fn agent_perm_e2e() {
    let profile = format!("e2e-perm-{}", std::process::id());
    let (_chrome, live) = start(&profile);
    // 보안 출처(127.0.0.1)여야 위치·알림 권한을 묻는다 — data: 는 안 된다
    let srv = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = srv.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for s in srv.incoming().flatten() {
            let mut s = s;
            let mut buf = [0u8; 2048];
            let _ = std::io::Read::read(&mut s, &mut buf);
            let body = "<title>perm</title><script>window.log=[]</script>";
            let _ = std::io::Write::write_all(&mut s, format!("HTTP/1.1 200 OK\r\ncontent-type: text/html\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len()).as_bytes());
        }
    });
    let mut owner = Owner::new(&live);
    let (a, sa) = owner.tab(&format!("http://127.0.0.1:{port}/"));
    owner.cdp.call("Emulation.setGeolocationOverride", serde_json::json!({ "latitude": 37.5, "longitude": 127.0, "accuracy": 10 }), Some(&sa), |_| {}).unwrap();
    let w = Watch::on(&profile);
    show(&profile, &a);
    std::thread::sleep(Duration::from_millis(500)); // 감시 스크립트가 지금 문서에 들어갈 틈
    agent_takeover(profile.clone(), live.pid, None).unwrap(); // 권한 답은 사람 조작 — 개입 중에만

    // ① 위치 — 모달에 뜨고, 허용하면 페이지가 위치를 받는다
    owner.eval(&sa, "navigator.geolocation.getCurrentPosition(p => log.push('geo-ok ' + p.coords.latitude), e => log.push('geo-err ' + e.code)); 1").unwrap();
    let p = wait_for("위치 요청이 모달에", 10, || agent_tabs(profile.clone()).permission);
    assert_eq!(p, serde_json::json!({ "kind": "geolocation", "origin": format!("http://127.0.0.1:{port}") }));
    agent_permission(profile.clone(), live.pid, Some(a.clone()), true);
    let log = wait_for("위치 허용 뒤 페이지", 10, || owner.eval(&sa, "log.join(',')").ok().filter(|v| v.as_str().is_some_and(|s| !s.is_empty())));
    assert_eq!(log, "geo-ok 37.5");
    assert!(agent_tabs(profile.clone()).permission.is_none());

    // ② 알림 — 거부하면 페이지가 denied 를 받는다
    owner.eval(&sa, "Notification.requestPermission().then(r => log.push('notif ' + r)); 1").unwrap();
    let p = wait_for("알림 요청이 모달에", 10, || agent_tabs(profile.clone()).permission);
    assert_eq!(p["kind"], "notifications");
    agent_permission(profile.clone(), live.pid, None, false);
    let log = wait_for("알림 거부 뒤 페이지", 10, || owner.eval(&sa, "log.join(',')").ok().filter(|v| v.as_str().is_some_and(|s| s.contains("notif"))));
    assert_eq!(log, "geo-ok 37.5,notif denied");

    // ③ 이미 정해진 권한은 다시 안 묻는다(감시 스크립트가 바로 원래대로)
    owner.eval(&sa, "navigator.geolocation.getCurrentPosition(p => log.push('again'), e => log.push('again-err')); 1").unwrap();
    wait_for("다시 물으면 바로", 10, || owner.eval(&sa, "log.join(',')").ok().filter(|v| v.as_str().is_some_and(|s| s.contains("again"))));
    assert!(agent_tabs(profile.clone()).permission.is_none());
    drop(w);
    let _ = agent_handback(profile.clone(), live.pid);
    let _ = std::fs::remove_file(live_dir().join(format!("{profile}.json")));
}

/// 가짜 FedCM 신원 제공자 + 로그인 페이지 — 한 서버가 둘 다(RP = localhost, IdP = 127.0.0.1, 출처가 다르다)
fn fedcm_server() -> u16 {
    let srv = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = srv.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for s in srv.incoming().flatten() {
            let mut s = s;
            let mut buf = vec![0u8; 16 * 1024];
            let n = std::io::Read::read(&mut s, &mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let path = req.split_whitespace().nth(1).unwrap_or("/").split('?').next().unwrap_or("/").to_string();
            let origin = req.lines().find_map(|l| l.strip_prefix("Origin: ").or_else(|| l.strip_prefix("origin: "))).unwrap_or("").trim().to_string();
            let idp = format!("http://127.0.0.1:{port}");
            let (ctype, body, extra) = match path.as_str() {
                "/rp" => ("text/html", "<title>rp</title><button id=b>Continue with IdP</button>".to_string(), String::new()),
                "/.well-known/web-identity" => ("application/json", format!(r#"{{"provider_urls":["{idp}/config.json"]}}"#), String::new()),
                "/config.json" => ("application/json", r#"{"accounts_endpoint":"/accounts","client_metadata_endpoint":"/meta","id_assertion_endpoint":"/assert","login_url":"/login"}"#.to_string(), String::new()),
                "/accounts" => ("application/json", r#"{"accounts":[{"id":"1","email":"tester@idp.test","name":"Tester","given_name":"T"},{"id":"2","email":"other@idp.test","name":"Other","given_name":"O"}]}"#.to_string(), String::new()),
                "/meta" => ("application/json", "{}".to_string(), String::new()),
                "/assert" => {
                    let id = req.split("account_id=").nth(1).and_then(|r| r.split('&').next()).unwrap_or("?").to_string();
                    ("application/json", format!(r#"{{"token":"tok-{id}"}}"#), format!("access-control-allow-origin: {origin}\r\naccess-control-allow-credentials: true\r\n"))
                }
                _ => ("text/html", "<title>login</title>".to_string(), String::new()),
            };
            let _ = std::io::Write::write_all(&mut s, format!("HTTP/1.1 200 OK\r\ncontent-type: {ctype}\r\n{extra}content-length: {}\r\nconnection: close\r\n\r\n{body}", body.len()).as_bytes());
        }
    });
    port
}

/// 구글 '…로 계속'(FedCM) — 크롬 자체 계정 고르기 창은 그림에 안 찍힌다. 일꾼이 FedCm 을 켜 두고 계정 목록을 모달로 넘기고, 고른 계정으로 로그인이 끝나나(2026-10-10)
#[test]
#[ignore]
fn agent_fedcm_e2e() {
    let profile = format!("e2e-fedcm-{}", std::process::id());
    let (_chrome, live) = start(&profile);
    let port = fedcm_server();
    let mut owner = Owner::new(&live);
    let (a, sa) = owner.tab(&format!("http://localhost:{port}/rp"));
    wait_for("RP 페이지", 10, || owner.eval(&sa, "document.title").ok().filter(|t| t == "rp"));
    let w = Watch::on(&profile);
    show(&profile, &a);
    agent_takeover(profile.clone(), live.pid, None).unwrap(); // 계정 고르기는 사람 조작 — 개입 중에만
    let get = format!("window.tok = undefined; window.err = undefined; navigator.credentials.get({{ identity: {{ providers: [{{ configURL: 'http://127.0.0.1:{port}/config.json', clientId: 'c1' }}] }} }}).then(c => window.tok = c.token, e => window.err = String(e)); 1");

    // ① 계정 목록이 모달로 오고, 고른 계정(두 번째)으로 토큰이 나온다
    owner.eval(&sa, &get).unwrap();
    let f = wait_for("FedCM 창이 모달에", 15, || agent_tabs(profile.clone()).fedcm);
    eprintln!("fedcm = {f}");
    assert_eq!(f["type"], "AccountChooser");
    assert_eq!(f["accounts"], serde_json::json!([{ "email": "tester@idp.test", "name": "Tester" }, { "email": "other@idp.test", "name": "Other" }]));
    agent_fedcm(profile.clone(), live.pid, f["dialogId"].as_str().unwrap().to_string(), Some(1));
    let tok = wait_for("고른 계정으로 토큰", 15, || owner.eval(&sa, "window.tok || window.err || ''").ok().filter(|v| v.as_str().is_some_and(|s| !s.is_empty())));
    assert_eq!(tok, "tok-2");
    assert!(agent_tabs(profile.clone()).fedcm.is_none());

    // ② 닫기 — 페이지는 거절(에러)을 받는다. 한 번 고른 뒤라 크롬이 저절로 다시 로그인하지 않게 mediation: 'required'
    owner.eval(&sa, &get.replace("identity:", "mediation: 'required', identity:")).unwrap();
    let f = wait_for("두 번째 FedCM 창", 15, || agent_tabs(profile.clone()).fedcm);
    agent_fedcm(profile.clone(), live.pid, f["dialogId"].as_str().unwrap().to_string(), None);
    let err = wait_for("닫으면 거절", 15, || owner.eval(&sa, "window.err || window.tok || ''").ok().filter(|v| v.as_str().is_some_and(|s| !s.is_empty())));
    assert!(err.as_str().unwrap().contains("Error"), "{err}");
    drop(w);
    let _ = agent_handback(profile.clone(), live.pid);
    let _ = std::fs::remove_file(live_dir().join(format!("{profile}.json")));
}

/// 그 크롬의 창들 — (창 번호, 자리, 상태)
fn windows_of(live: &Live) -> Vec<Win> {
    let mut c = Cdp { ws: connect(live).unwrap(), next: 0 };
    let out = chrome_windows(&mut c).unwrap();
    let _ = c.ws.close(None);
    out
}

/// '크롬에서 보기'가 창을 안 꺼냈다(2026-10-10 네이버 로그인 팝업) — 로그인 팝업처럼 창이 둘이면 둘 다, 그리고 크롬이 활성화되며
/// 스스로 보이는 순간 지킴이(watch_hidden → rehome_pid)가 '꺼낸 크롬'(SHOWN)인 줄 모르고 가짜 화면으로 되돌리지 않아야 한다
#[test]
#[ignore]
fn agent_focus_e2e() {
    let profile = format!("e2e-focus-{}", std::process::id());
    let (_chrome, live) = start(&profile);
    let mut owner = Owner::new(&live);
    let _ = owner.tab("data:text/html,<title>Main</title><p>main");
    owner.cdp.call("Target.createTarget", serde_json::json!({ "url": "data:text/html,<title>Popup</title><p>popup", "newWindow": true }), None, |_| {}).unwrap();
    let pid = wait_for("크롬 pid", 10, || chrome_pid(live.port));
    // 가짜 화면 대신 어느 화면도 아닌 먼 자리 — 세션 크롬은 평소 거기 숨어 있다
    let vd = crate::vdisplay::Rect { x: -30000.0, y: -30000.0, w: 1440.0, h: 900.0 };
    rehome_into(&live, vd).unwrap();
    let before = windows_of(&live);
    assert!(before.len() >= 2, "창이 둘(본 창 + 팝업): {before:?}");
    assert!(before.iter().all(|w| crate::vdisplay::inside(w.1, vd)), "{before:?}");
    // 지킴이 흉내 — 크롬이 보이면(활성화) 꺼낸 크롬이 아닌 한 가짜 화면으로 되돌린다
    let stop = Arc::new(AtomicBool::new(false));
    let watcher = {
        let (stop, live) = (stop.clone(), live.clone());
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                if should_hide(true, &shown(), pid) {
                    let _ = rehome_into(&live, vd);
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        })
    };
    let r = tauri::async_runtime::block_on(agent_focus(profile.clone()));
    std::thread::sleep(Duration::from_millis(1000));
    stop.store(true, Ordering::Relaxed);
    watcher.join().unwrap();
    assert_eq!(r, Ok(()));
    let rects: Vec<crate::vdisplay::Rect> = crate::vdisplay::visible_displays().iter().map(|d| d.0).collect();
    let after = windows_of(&live);
    eprintln!("after = {after:?}");
    for w in &after {
        assert!(crate::vdisplay::on_visible(w.1, &rects), "창 {} 이 보이는 화면에 없다: {:?}", w.0, w.1);
    }
    // 꺼낸 창을 사람이 다 닫아도(창 X) 세션 브라우저는 산다 — 지킴이(keep_loop)가 빈 탭을 다시 연다
    let mut c = Cdp { ws: connect(&live).unwrap(), next: 0 };
    let got = c.call("Target.getTargets", serde_json::json!({}), None, |_| {}).unwrap();
    for t in got["targetInfos"].as_array().unwrap().iter().filter(|t| t["type"] == "page") {
        let _ = c.call("Target.closeTarget", serde_json::json!({ "targetId": t["targetId"] }), None, |_| {});
    }
    let _ = c.ws.close(None);
    wait_for("빈 탭 다시 열림", 10, || (!windows_of(&live).is_empty()).then_some(()));
    let _ = agent_handback(profile.clone(), live.pid);
    if let Ok(mut v) = SHOWN.lock() {
        v.retain(|p| *p != pid);
    }
    let _ = std::fs::remove_file(live_dir().join(format!("{profile}.json")));
}

/// 인앱 브라우저 시안 A 해피패스(2026-10-27) — 스페이스 칸이 보는 동안: 헤드리스를 알아보고, 세션 도구가 안 돌 때 창을 칸 크기로 맞추고,
/// 지나가는 마우스는 개입을 안 켜고, 칸에서 누르면 저절로 개입이 켜지며 그 누름이 페이지에 닿는다
/// `CHAMMO_HOME=<빈 시험 폴더> cargo test inapp_pane_e2e -- --ignored --nocapture --test-threads=1`
#[test]
#[ignore]
fn inapp_pane_e2e() {
    use crate::agent_input::InputEv;
    let profile = format!("e2e-pane-{}", std::process::id());
    let (_chrome, live) = start(&profile);
    let mut owner = Owner::new(&live);
    let page = "data:text/html,<body style=margin:0><button id=b style=position:fixed;left:100px;top:100px;width:200px;height:100px onclick=this.textContent='pressed'>go</button>";
    let (t, s) = owner.tab(page);
    wait_for("시험 페이지", 10, || owner.eval(&s, "document.getElementById('b') ? 1 : null").ok().filter(|v| v == 1));
    // 칸이 0.5초마다 자리를 알리는 흉내 — 640x480 칸
    let on = Arc::new(AtomicBool::new(true));
    let (o, p) = (on.clone(), profile.clone());
    std::thread::spawn(move || {
        while o.load(Ordering::Relaxed) {
            let _ = pane_geom(&p, 640.0, 480.0, true);
            std::thread::sleep(Duration::from_millis(300));
        }
    });
    show(&profile, &t);
    // ① 헤드리스를 알아본다(칸은 창 대신 그림을 받는다)
    wait_for("헤드리스 판별", 10, || pane_geom(&profile, 640.0, 480.0, true).filter(|g| g.2).map(|_| ()));
    // ② 세션 도구가 안 돌면(busy false) 창을 칸 크기로 — 페이지가 640x480
    let size = wait_for("칸 크기로 맞춤", 15, || owner.eval(&s, "innerWidth + 'x' + innerHeight").ok().filter(|v| v == "640x480"));
    eprintln!("page = {size}");
    let m = |ty: &str, x: f64, y: f64| InputEv::Mouse { ty: ty.into(), x, y, button: Some(if ty == "mouseMoved" { "none" } else { "left" }.into()), click_count: Some(1), delta_x: None, delta_y: None, modifiers: 0 };
    // ③ 지나가는 마우스 — 개입 안 켜짐(세션 도구가 안 멈춘다)
    pane_input(&profile, vec![m("mouseMoved", 0.1, 0.1)]).unwrap();
    assert!(crate::takeover::current(&live_dir(), &profile).is_none(), "마우스만 지나가도 개입이 켜졌다");
    // ④ 단추 가운데(200,150 → 비율) 누름 — 저절로 개입 + 페이지에 닿음
    let (x, y) = (200.0 / 640.0, 150.0 / 480.0);
    pane_input(&profile, vec![m("mouseMoved", x, y), m("mousePressed", x, y), m("mouseReleased", x, y)]).unwrap();
    assert!(crate::takeover::current(&live_dir(), &profile).is_some_and(|c| c.2 == "desktop"), "누름에 개입이 안 켜졌다");
    wait_for("누름이 페이지에", 10, || owner.eval(&s, "document.getElementById('b').textContent").ok().filter(|v| v == "pressed"));
    on.store(false, Ordering::Relaxed);
    let _ = agent_handback(profile.clone(), live.pid);
    let _ = std::fs::remove_file(live_dir().join(format!("{profile}.json")));
}

/// 칸 글 입력 실측(10-28 사용자 "한글 칠 때 딜레이·유튜브브") — 칸 숨은 글칸(TypeMirror)이 보내는 모양 그대로 넣고 페이지 글과 숫자로 맞춘다.
/// 칸이 SCK 로 비출 때처럼 그림(screencast)을 안 받는 일꾼 — 사건이 없어 예전엔 키마다 사건 기다림(0.25초)만큼 늦었다. 키마다 넣은 때 → 페이지에 보인 때를 잰다
/// `CHAMMO_HOME=<빈 시험 폴더> cargo test inapp_type_e2e -- --ignored --nocapture --test-threads=1`
#[test]
#[ignore]
fn inapp_type_e2e() {
    use crate::agent_input::InputEv;
    let profile = format!("e2e-type-{}", std::process::id());
    let (_chrome, live) = start(&profile);
    let mut owner = Owner::new(&live);
    let (t, s) = owner.tab("data:text/html,<input id=q style=width:600px><script>window.enters=0;q.addEventListener('keydown',e=>{if(e.key==='Enter')enters++})</script>");
    wait_for("시험 페이지", 10, || owner.eval(&s, "document.getElementById('q') ? 1 : null").ok().filter(|v| v == 1));
    owner.eval(&s, "q.focus(); 1").unwrap();
    show(&profile, &t);
    let val = |o: &mut Owner| o.eval(&s, "q.value").ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
    // 보일 때까지 촘촘히(2ms) — wait_for 는 0.1초 눈금이라 지연을 못 잰다
    let until = |o: &mut Owner, n: usize| {
        let end = Instant::now() + Duration::from_secs(5);
        while Instant::now() < end {
            if val(o).chars().count() == n {
                return;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        panic!("5초 안에 {n}자가 안 보임");
    };
    let key = |k: &str, code: u32| -> Vec<InputEv> {
        let e = |ty: &str| InputEv::Key { ty: ty.into(), key: k.into(), code: k.into(), key_code: code, text: (k == "Enter" && ty == "char").then(|| "\r".to_string()), modifiers: 0, commands: vec![] };
        if k == "Enter" { vec![e("rawKeyDown"), e("char"), e("keyUp")] } else { vec![e("rawKeyDown"), e("keyUp")] }
    };
    let comp = |x: &str| InputEv::Compose { text: x.into() };
    let text = |x: &str| InputEv::Text { text: x.into() };
    // ① 조합 미리보기 — 조합 중 글자가 페이지 칸에 바로 보인다
    pane_input(&profile, vec![comp("ㅇ"), comp("유")]).unwrap();
    wait_for("조합 미리보기", 5, || (val(&mut owner) == "유").then_some(()));
    // ② '유튜브' + 조합을 끝내는 Enter(TypeMirror.enter — 마지막 글자 insertText 가 조합을 바꿔 넣고 Enter) — 한 번만
    pane_input(&profile, vec![text("유"), comp("ㅌ"), comp("튜"), text("튜"), comp("ㅂ"), comp("브")]).unwrap();
    pane_input(&profile, [vec![text("브")], key("Enter", 13)].concat()).unwrap();
    wait_for("유튜브 + Enter", 5, || (val(&mut owner) == "유튜브" && owner.eval(&s, "enters").ok() == Some(serde_json::json!(1))).then_some(()));
    // ③ 섞어 치기·지우기(macOS 26 바꿔치기 = 지우기 + 넣기)
    pane_input(&profile, vec![text("abc "), text("ㅎ")]).unwrap();
    pane_input(&profile, [key("Backspace", 8), vec![text("하"), text("이123")]].concat()).unwrap();
    wait_for("섞어 치기", 5, || (val(&mut owner) == "유튜브abc 하이123").then_some(()));
    // ④ 빠르게 치기 — 30자를 글자마다 따로 넣고 키마다 보이기까지 잰다
    owner.eval(&s, "q.value=''; 1").unwrap();
    let typed = "빠르게치기테스트quickTYPE한글English123가나다라마";
    let mut ms = vec![];
    for (i, c) in typed.chars().enumerate() {
        let at = Instant::now();
        pane_input(&profile, vec![text(&c.to_string())]).unwrap();
        until(&mut owner, i + 1);
        ms.push(at.elapsed().as_secs_f64() * 1000.0);
    }
    assert_eq!(val(&mut owner), typed, "친 글 = 페이지 글");
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    eprintln!("치는 중 키마다 ms: 중간 {:.1} · 90% {:.1} · 최대 {:.1} ({}자)", ms[ms.len() / 2], ms[ms.len() * 9 / 10], ms[ms.len() - 1], ms.len());
    // ⑤ 한참 안 만진 뒤 첫 키(일꾼이 길게 기다리는 중) — 예전엔 모든 키가 이랬다
    let mut first = vec![];
    for i in 0..3 {
        std::thread::sleep(Duration::from_millis(10_500));
        let n = val(&mut owner).chars().count();
        let at = Instant::now();
        pane_input(&profile, vec![text("x")]).unwrap();
        until(&mut owner, n + 1);
        first.push(at.elapsed().as_secs_f64() * 1000.0);
        eprintln!("쉰 뒤 첫 키 {i}: {:.1}ms", first[i]);
    }
    assert!(ms[ms.len() * 9 / 10] < 60.0, "치는 중 키가 느리다: {ms:?}");
    let _ = agent_handback(profile.clone(), live.pid);
    let _ = std::fs::remove_file(live_dir().join(format!("{profile}.json")));
}

/// ps 의 누적 CPU 시간(초) — 프로세스 명령 줄에 needle 이 든 것 전부, 또는 pid 하나
fn cpu_secs(pick: impl Fn(i32, &str) -> bool) -> f64 {
    let out = crate::platform::command("/bin/ps").args(["-A", "-o", "pid=,time=,command="]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    out.lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let pid: i32 = it.next()?.parse().ok()?;
            let t = it.next()?;
            let cmd: String = it.collect::<Vec<_>>().join(" ");
            pick(pid, &cmd).then(|| {
                // [[hh:]mm:ss.cc]
                t.split(':').fold(0.0, |a, x| a * 60.0 + x.parse::<f64>().unwrap_or(0.0))
            })
        })
        .sum()
}

/// 안 볼 때 자원(10-28 사용자 ⑥) — 참모가 브라우저를 계속 만지는 동안(페이지가 늘 바뀜 + 0.5초마다 누름) 칸 보임 / 칸 덮임·앱 숨김 / 칸 닫음
/// 셋의 CPU(크롬 전부 · 앱 쪽 일꾼 = 이 시험 프로세스)와 칸에 넘긴 그림 수. 헤드리스 = 그림 길(screencast). SCK 수치는 'Chammo agents' 가 있을 때 따로
/// `CHAMMO_HOME=<빈 시험 폴더> cargo test inapp_idle_cost_e2e -- --ignored --nocapture --test-threads=1`
#[test]
#[ignore]
fn inapp_idle_cost_e2e() {
    let profile = format!("e2e-cost-{}", std::process::id());
    let (chrome, live) = start(&profile);
    let dir = chrome.dir.to_string_lossy().into_owned();
    let mut owner = Owner::new(&live);
    let (t, s) = owner.tab("data:text/html,<body style=margin:0><h1 id=h style=font-size:80px>0</h1><button id=b style=width:200px;height:80px>go</button><script>let n=0;setInterval(()=>h.textContent=++n,33)</script>");
    wait_for("시험 페이지", 10, || owner.eval(&s, "document.getElementById('b') ? 1 : null").ok().filter(|v| v == 1));
    show(&profile, &t);
    let me = std::process::id() as i32;
    let phase = |name: &str, visible: Option<bool>, owner: &mut Owner| {
        let stop = Arc::new(AtomicBool::new(false));
        let (st, p) = (stop.clone(), profile.clone());
        let pane = std::thread::spawn(move || {
            while !st.load(Ordering::Relaxed) {
                if let Some(v) = visible {
                    let _ = pane_geom(&p, 800.0, 600.0, v);
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        });
        std::thread::sleep(Duration::from_secs(4)); // 바뀐 상태가 자리 잡게(일꾼은 3초 뒤 멈춘다)
        let (c0, a0, f0) = (cpu_secs(|_, c| c.contains(&dir)), cpu_secs(|p, _| p == me), crate::browser_pane::pushed(&profile));
        let t0 = Instant::now();
        while t0.elapsed() < Duration::from_secs(15) {
            // 참모 손 — 0.5초마다 단추 누름(세션 도구 흉내)
            let _ = owner.eval(&s, "b.click(); 1");
            std::thread::sleep(Duration::from_millis(500));
        }
        let secs = t0.elapsed().as_secs_f64();
        let (c1, a1, f1) = (cpu_secs(|_, c| c.contains(&dir)), cpu_secs(|p, _| p == me), crate::browser_pane::pushed(&profile));
        stop.store(true, Ordering::Relaxed);
        let _ = pane.join();
        let row = (100.0 * (c1 - c0) / secs, 100.0 * (a1 - a0) / secs, (f1 - f0) as f64 / secs);
        eprintln!("| {name} | 크롬 {:.1}% | 앱(일꾼) {:.1}% | 칸 그림 {:.1}장/초 |", row.0, row.1, row.2);
        row
    };
    let shown = phase("칸 보임", Some(true), &mut owner);
    let covered = phase("칸 덮임·앱 숨김(자리는 계속 알림)", Some(false), &mut owner);
    let closed = phase("칸 닫음(다른 탭)", None, &mut owner);
    assert!(shown.2 > 5.0, "보이는 칸이 그림을 못 받는다: {shown:?}");
    assert!(covered.2 < 0.5 && closed.2 < 0.5, "안 보는데 그림을 받는다: {covered:?} {closed:?}");
    let _ = std::fs::remove_file(live_dir().join(format!("{profile}.json")));
}

/// 창 있는 크롬(가짜 화면 위·accessory 아님) — `open -g` 로 띄워 사람 화면 앞으로 안 나온다. 끝나면 끈다
struct Windowed {
    pid: i32,
    dir: PathBuf,
}
impl Drop for Windowed {
    fn drop(&mut self) {
        unsafe { libc::kill(self.pid, libc::SIGTERM) };
        std::thread::sleep(Duration::from_millis(800));
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// 가짜 화면 위 accessory 아닌(구글 서명 그대로) 세션 크롬을 가리면 칸(SCK)이 한 장도 못 받아 까만 칸이던 것(10-28 naver-demo) —
/// 칸은 screencast 그림으로 내려가야 한다. 시험 가짜 화면을 먼저 끝없이 띄우고 그 줄·pid 를 넘긴다:
/// `tail -f /dev/null | <데이터 폴더>/tools/chammo-vdisplay --width 1440 --height 900 --vendor 21329 --name chammo-test > vd.json &`
/// `CHAMMO_HOME=<빈 시험 폴더> CHAMMO_TEST_VD_JSON="$(head -1 vd.json)" CHAMMO_TEST_VD_PID=<chammo-vdisplay pid> cargo test inapp_hidden_cast_e2e -- --ignored --nocapture --test-threads=1`
/// CHAMMO_TEST_CHROME_APP 로 다른 크롬(기본 /Applications/Google Chrome Beta.app)
#[test]
#[ignore]
fn inapp_hidden_cast_e2e() {
    let home = std::env::var("HOME").unwrap_or_default();
    assert!(!crate::config::is_real_data(&home, crate::config::data_dir()), "CHAMMO_HOME 을 시험 폴더로 줘");
    let (id, _) = crate::vdisplay::parse_line(&std::env::var("CHAMMO_TEST_VD_JSON").expect("CHAMMO_TEST_VD_JSON")).expect("가짜 화면 줄");
    let vpid: u32 = std::env::var("CHAMMO_TEST_VD_PID").expect("CHAMMO_TEST_VD_PID").parse().unwrap();
    let vfile = crate::config::data_file("browser").join("vdisplay.json");
    std::fs::create_dir_all(vfile.parent().unwrap()).unwrap();
    std::fs::write(&vfile, serde_json::json!({ "pid": vpid, "displayID": id }).to_string()).unwrap();
    // 크롬 띄우기 직전 — 가짜 화면이 정말 있어야 하고, 자리는 지금 화면 목록에서(맥이 다른 화면이 빠지면 가짜 화면을 옮긴다 — 도우미가 찍은 첫 줄 자리로 띄웠다가 주 화면에 떴다)
    let vd = crate::vdisplay::bounds().expect("가짜 화면이 없다 — 크롬을 안 띄운다").1;
    let app = std::env::var("CHAMMO_TEST_CHROME_APP").unwrap_or_else(|_| "/Applications/Google Chrome Beta.app".into());
    let profile = format!("e2e-cast-{}", std::process::id());
    let dir = std::env::temp_dir().join(format!("chammo-cast-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let page = "data:text/html,<body style=margin:0;background:%23e33><h1 id=h>cast</h1><script>setInterval(()=>h.textContent=Date.now(),100)</script>";
    let st = crate::platform::command("/usr/bin/open")
        // -j = 가린 채 띄운다(창이 어디 생기든 사람 눈에 안 보인다) · -g = 앞으로 안 나온다
        .args(["-g", "-j", "-n", "-a", &app, "--args", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic"])
        // 플레이라이트가 켜는 가림 막이(세션 크롬과 같은 조건)
        .args(["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"])
        .arg(format!("--user-data-dir={}", dir.display()))
        .arg(format!("--window-position={},{}", vd.x + 40.0, vd.y + 40.0))
        .args(["--window-size=1000,700", page])
        .status()
        .expect("open");
    assert!(st.success());
    let pid = wait_for("크롬 pid", 20, || std::fs::read_link(dir.join("SingletonLock")).ok().and_then(|l| parse_lock_pid(&l.to_string_lossy())));
    let _chrome = Windowed { pid, dir: dir.clone() };
    let (port, ws) = wait_for("DevToolsActivePort", 20, || {
        let t = std::fs::read_to_string(dir.join("DevToolsActivePort")).ok()?;
        let mut l = t.lines();
        Some((l.next()?.trim().parse::<u16>().ok()?, l.next()?.trim().to_string()))
    });
    // 지킴이가 하듯 바로 가린다(accessory 아닌 크롬) — 창 자리를 보기 전에 먼저, 혹시 밖이어도 사람 눈에 안 남게
    let wins = wait_for("크롬 창", 10, || {
        app_window::hide(pid);
        // 크롬은 화면마다 메뉴줄 창(1920x30, CG 목록에선 층 0 일 때도)이 있다 — 높이로도 거른다
        Some(crate::chrome_popup::windows(pid).into_iter().filter(|w| w.layer == 0 && w.rect.w > 100.0 && w.rect.h > 100.0).collect::<Vec<_>>()).filter(|w| !w.is_empty())
    });
    wait_for("가림", 5, || (app_window::hidden(pid) == Some(true)).then_some(()).or_else(|| { app_window::hide(pid); None }));
    assert_eq!(crate::vdisplay::bounds().map(|b| b.1), Some(vd), "도는 사이 가짜 화면이 바뀌었다 — 끈다");
    for w in &wins {
        let r = &w.rect;
        assert!(crate::vdisplay::inside(crate::vdisplay::Rect { x: r.x, y: r.y, w: r.w, h: r.h }, vd), "크롬 창이 가짜 화면 밖({r:?}) — 끈다");
    }
    assert_eq!(app_window::accessory(pid), Some(false), "accessory 아닌 크롬이어야 재현");
    let live = Live { profile: profile.clone(), pid: 1, session_pid: 1, port, ws_path: ws, url: String::new(), title: String::new(), tabs: vec![], tool: String::new(), tool_at: 0, busy: true, ts: 0, ask: None, gate: false, held: 0, takeover: None, scripts: 0, popup: false, popup_kind: String::new(), wake: None, signable: false };
    std::fs::create_dir_all(live_dir()).unwrap();
    std::fs::write(live_dir().join(format!("{profile}.json")), serde_json::to_string(&live).unwrap()).unwrap();
    // 칸이 0.5초마다 자리를 알리는 흉내
    let on = Arc::new(AtomicBool::new(true));
    let (o, p) = (on.clone(), profile.clone());
    std::thread::spawn(move || {
        while o.load(Ordering::Relaxed) {
            let _ = pane_geom(&p, 1000.0, 600.0, true);
            std::thread::sleep(Duration::from_millis(300));
        }
    });
    // 칸은 비출 수 없는 창이라고 알아보고(창 자리를 비워 SCK 를 안 켠다) screencast 그림을 받는다
    let cast = wait_for("칸 길 판별", 10, || pane_geom(&profile, 1000.0, 600.0, true).map(|g| g.2));
    // 페이지가 그리나(rAF) — 가린 크롬이 그림을 멈추면 칸도 멈춘다
    let mut owner = Owner::new(&live);
    let t = owner.cdp.call("Target.getTargets", serde_json::json!({}), None, |_| {}).unwrap()["targetInfos"].as_array().unwrap().iter().find(|t| t["type"] == "page").unwrap()["targetId"].as_str().unwrap().to_string();
    let s = owner.cdp.call("Target.attachToTarget", serde_json::json!({ "targetId": t, "flatten": true }), None, |_| {}).unwrap()["sessionId"].as_str().unwrap().to_string();
    owner.eval(&s, "window.__f=0;(function f(){window.__f++;requestAnimationFrame(f)})();1").unwrap();
    let before = crate::browser_pane::pushed(&profile);
    std::thread::sleep(Duration::from_secs(3));
    let got = crate::browser_pane::pushed(&profile) - before;
    let raf = owner.eval(&s, "window.__f").unwrap();
    eprintln!("cast={cast} 3초 그림 {got}장 · rAF {raf} · 가림 {:?}", app_window::hidden(pid));
    on.store(false, Ordering::Relaxed);
    let _ = std::fs::remove_file(live_dir().join(format!("{profile}.json")));
    let _ = std::fs::remove_file(&vfile);
    assert!(cast, "가린 accessory 아닌 크롬인데 칸이 SCK 길(까만 칸)");
    assert!(got >= 5, "칸에 그림이 안 온다: {got}장");
    assert_eq!(app_window::hidden(pid), Some(true), "시험 중 크롬이 보였다");
}

/// 칸이 떨어졌다 3초 안에 다시 붙으면(참모 채팅 탭 오가기 — 10-28 사용자 지메일 칸 '브라우저 화면 받는 중…'에서 멈춤) 안 바뀌는 페이지도 새 칸에 바로 그림이 와야 한다.
/// 칸 손잡이는 떨어질 때 떼고(browser_pane_detach) 다시 그릴 때 새로 붙는데, 그림 길은 새 손잡이에 그림을 다시 안 밀었다 — 일꾼은 '그림 있음'이라 다시 안 찍고
/// 크롬 screencast 는 화면이 안 바뀌면 프레임을 안 보낸다. 크롬은 chammo-browser launch(헤드리스 = 그림 길, 시험 데이터 폴더)로 받는다
/// `CHAMMO_HOME=<빈 시험 폴더> cargo test pane_reattach_e2e -- --ignored --nocapture --test-threads=1`
#[test]
#[ignore]
fn pane_reattach_e2e() {
    let home = std::env::var("HOME").unwrap_or_default();
    assert!(!crate::config::is_real_data(&home, crate::config::data_dir()), "CHAMMO_HOME 을 시험 폴더로 줘");
    let profile = format!("e2e-reattach-{}", std::process::id());
    let bin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tools/chammo-browser/bin/chammo-browser.js");
    let me = std::process::id().to_string();
    let out = crate::platform::command("node").arg(&bin).args(["launch", &profile, "--headless", "--owner", &me]).output().expect("chammo-browser launch");
    let first = String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or_default().to_string();
    assert!(first.contains("\"ok\":true"), "launch 실패: {first} {}", String::from_utf8_lossy(&out.stderr));
    let live = wait_for("상태 파일", 15, || read_live(&profile));
    let mut owner = Owner::new(&live);
    let (t, _) = owner.tab("data:text/html,<h1 style=font-size:80px>still</h1>");
    show(&profile, &t);
    // 칸이 0.5초마다 자리를 알리는 흉내 — on 이 꺼진 동안은 칸이 없다(다른 채팅 탭)
    let on = Arc::new(AtomicBool::new(true));
    let (o, p) = (on.clone(), profile.clone());
    std::thread::spawn(move || loop {
        if o.load(Ordering::Relaxed) {
            let _ = pane_geom(&p, 800.0, 600.0, true);
        }
        std::thread::sleep(Duration::from_millis(500));
    });
    wait_for("첫 그림", 10, || (crate::browser_pane::pushed(&profile) > 0).then_some(()));
    std::thread::sleep(Duration::from_secs(2)); // 화면이 멎어 프레임이 그친다
    on.store(false, Ordering::Relaxed);
    std::thread::sleep(Duration::from_secs(1)); // 다른 탭 1초
    let before = crate::browser_pane::pushed(&profile);
    crate::browser_pane::reattached(&profile); // 새 손잡이(browser_pane_place 가 새로 붙일 때 부른다)
    on.store(true, Ordering::Relaxed);
    std::thread::sleep(Duration::from_secs(2));
    let got = crate::browser_pane::pushed(&profile) - before;
    eprintln!("다시 붙은 뒤 2초 그림 {got}장");
    let _ = crate::platform::command("node").arg(&bin).args(["release", &profile, "--owner", &me]).output();
    assert!(got >= 1, "다시 붙은 칸에 그림이 안 온다 — '브라우저 화면 받는 중…'에 멈춘다");
}

/// 새 창(10-29 fix/passkey-auto) — 사이트가 띄운 창(window.open·target=_blank, openerId 있음)은 열려 있는 동안 칸에 보이고, 닫히면 원래 탭으로.
/// 칸을 열기 전에 이미 떠 있던 창(세션이 혼자 로그인 팝업을 띄운 뒤 사람을 부름)도 같은 규칙이어야 한다
/// `CHAMMO_HOME=<빈 시험 폴더> cargo test inapp_newwin_e2e -- --ignored --nocapture --test-threads=1`
#[test]
#[ignore]
fn inapp_newwin_e2e() {
    for before in [false, true] {
        let profile = format!("e2e-newwin-{}-{}", std::process::id(), before as u8);
        let (_chrome, mut live) = start(&profile);
        let mut owner = Owner::new(&live);
        let page = "data:text/html,<title>Home</title><p>home";
        let (a, s) = owner.tab(page);
        // 세션(MCP)이 보는 탭 = 원래 탭
        live.url = page.into();
        std::fs::write(live_dir().join(format!("{profile}.json")), serde_json::to_string(&live).unwrap()).unwrap();
        let open = |o: &mut Owner| {
            o.cdp.call("Runtime.evaluate", serde_json::json!({ "expression": "window.p = window.open('about:blank', 'pop', 'width=400,height=300'); 1", "userGesture": true }), Some(&s), |_| {}).unwrap();
            wait_for("새 창", 10, || {
                let t = o.cdp.call("Target.getTargets", serde_json::json!({}), None, |_| {}).ok()?;
                t["targetInfos"].as_array()?.iter().find(|x| x["type"] == "page" && x["openerId"] == a.as_str()).and_then(|x| x["targetId"].as_str().map(str::to_string))
            })
        };
        let pop = if before { Some(open(&mut owner)) } else { None };
        let _w = Watch::on(&profile);
        let pop = match pop {
            Some(p) => p,
            None => {
                wait_for("원래 탭", 10, || (agent_tabs(profile.clone()).current.as_deref() == Some(a.as_str())).then_some(()));
                open(&mut owner)
            }
        };
        wait_for(&format!("새 창을 칸에(before={before})"), 10, || (agent_tabs(profile.clone()).current.as_deref() == Some(pop.as_str())).then_some(()));
        owner.eval(&s, "window.p.close(); 1").unwrap();
        wait_for(&format!("닫으면 원래 탭(before={before})"), 10, || (agent_tabs(profile.clone()).current.as_deref() == Some(a.as_str())).then_some(()));
        eprintln!("before={before}: 새 창 보임 → 닫으면 원래 탭");
        let _ = std::fs::remove_file(live_dir().join(format!("{profile}.json")));
    }
}
