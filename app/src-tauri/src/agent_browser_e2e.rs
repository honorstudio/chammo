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
        .args(["--headless=new", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--window-size=800,600", "about:blank"])
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
    let live = Live { profile: profile.into(), pid, session_pid: 1, port, ws_path: ws, url: String::new(), title: String::new(), tabs: vec![], tool: String::new(), tool_at: 0, busy: false, ts: 0, ask: None, gate: false, held: 0, takeover: None, scripts: 0, popup: false };
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
