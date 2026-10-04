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
    let live = Live { profile: profile.into(), pid, session_pid: 1, port, ws_path: ws, url: String::new(), title: String::new(), tabs: vec![], tool: String::new(), tool_at: 0, busy: false, ts: 0, ask: None };
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
    let _ = std::fs::remove_file(live_dir().join(format!("{profile}.json")));
}
