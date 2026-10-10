//! 참모 모드 호스트 — 모드 하나당 claude 프로세스 하나(≈240MB). 켜기·끄기·죽음 알림, 화면에 밀기(eval), 따로 창·메뉴·참모 명령.
//! 규약·찾기·기억은 modes.rs. 앱 전체(홈) 소속이라 어느 참모·프로젝트에도 안 딸린다
use crate::i18n::tr;
use crate::modes::{self, Line, ModeInfo, Saved};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{Manager, Runtime};

/// 화면이 그릴 것 — 살아 있나·판이 규약을 아나·상태줄·칸 목록·멈춘 까닭·로그 자리
#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HostState {
    pub alive: bool,
    pub ready: bool,
    pub unsupported: bool,
    pub status: Option<String>,
    pub panes: Vec<Value>,
    pub shown: Option<String>,
    pub error: Option<String>,
    pub log: String,
    pub pid: u32,
}

struct Host {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>,
    st: Mutex<HostState>,
    seq: AtomicU64,
}

type Notify = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// 띄우는 중인 이름 — 켜기를 두 번 눌러도 프로세스는 하나
fn starting() -> &'static Mutex<std::collections::HashSet<String>> {
    static S: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    S.get_or_init(Default::default)
}

fn hosts() -> &'static Mutex<HashMap<String, Arc<Host>>> {
    static H: OnceLock<Mutex<HashMap<String, Arc<Host>>>> = OnceLock::new();
    H.get_or_init(Default::default)
}

impl Host {
    fn call(&self, req: Value, wait: Duration) -> Result<Value, String> {
        let id = format!("c{}", self.seq.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        let sent = match self.stdin.lock().unwrap().as_mut() {
            Some(w) => writeln!(w, "{}", modes::control(&id, req)).and_then(|_| w.flush()).map_err(|e| e.to_string()),
            None => Err("stopped".into()),
        };
        if let Err(e) = sent {
            self.pending.lock().unwrap().remove(&id);
            return Err(e);
        }
        let r = rx.recv_timeout(wait).unwrap_or_else(|_| Err("timeout".into()));
        self.pending.lock().unwrap().remove(&id);
        r
    }

    /// 밀림을 상태에 담는다 — 상태줄·칸 목록은 창이 늦게 떠도 다시 읽게 여기 남긴다
    fn absorb(&self, push: &Value) {
        let mut st = self.st.lock().unwrap();
        match push.get("subtype").and_then(|s| s.as_str()) {
            Some("ui_status") => st.status = push.get("text").and_then(|t| t.as_str()).map(str::to_owned),
            Some("ui_panes") => {
                st.panes = push.get("panes").and_then(|p| p.as_array()).cloned().unwrap_or_default();
                st.shown = push.get("shown_id").and_then(|s| s.as_str()).map(str::to_owned);
            }
            _ => {}
        }
    }
}

/// 띄운다 — 프로세스 → initialize → ui_attach. 판이 규약을 모르면 unsupported, 그 밖의 실패는 error 에 남기고 끈다
fn start(info: &ModeInfo, plugin_dir: &Path, run: &Path, notify: Notify) -> Arc<Host> {
    let _ = std::fs::create_dir_all(run);
    let log = run.join("host.log");
    let err = std::fs::File::create(&log).map(Stdio::from).unwrap_or_else(|_| Stdio::null());
    let spawned = crate::platform::command(crate::claude::claude_bin())
        .args(modes::host_args(plugin_dir))
        .current_dir(run)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(err)
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => {
            // 프로세스가 없다(claude 없음 등) — 죽은 호스트로 남겨 화면이 '멈췄어 · 다시 켜기'를 보이게
            let st = HostState { error: Some(e.to_string()), log: log.to_string_lossy().into_owned(), ..Default::default() };
            return Arc::new(Host { child: Mutex::new(None), stdin: Mutex::new(None), pending: Default::default(), st: Mutex::new(st), seq: AtomicU64::new(0) });
        }
    };
    let out = child.stdout.take();
    let pid = child.id();
    let host = Arc::new(Host {
        stdin: Mutex::new(child.stdin.take()),
        child: Mutex::new(Some(child)),
        pending: Default::default(),
        st: Mutex::new(HostState { alive: true, log: log.to_string_lossy().into_owned(), pid, ..Default::default() }),
        seq: AtomicU64::new(1),
    });
    let name = info.name.clone();
    let h = host.clone();
    let n2 = notify.clone();
    std::thread::spawn(move || {
        if let Some(out) = out {
            for line in std::io::BufReader::new(out).lines().map_while(Result::ok) {
                match modes::route(&line) {
                    Line::Reply(id, r) => {
                        if let Some(tx) = h.pending.lock().unwrap().remove(&id) {
                            let _ = tx.send(r);
                        }
                    }
                    Line::Push(v) => {
                        h.absorb(&v);
                        n2(&name, v);
                    }
                    Line::Other => {}
                }
            }
        }
        // 끝났다 — 기다리던 요청을 풀고 화면에 '멈췄어'
        for (_, tx) in h.pending.lock().unwrap().drain() {
            let _ = tx.send(Err("exited".into()));
        }
        let code = h.child.lock().unwrap().as_mut().and_then(|c| c.wait().ok()).and_then(|s| s.code());
        {
            let mut st = h.st.lock().unwrap();
            st.alive = false;
            st.ready = false;
            if st.error.is_none() && !st.unsupported {
                st.error = Some(format!("exit {}", code.map(|c| c.to_string()).unwrap_or_else(|| "signal".into())));
            }
        }
        n2(&name, json!({"subtype": "exit"}));
    });
    // 붙기 — 첫 켬은 1초 안팎(실측 0.6~0.8초), 넉넉히
    let init = host.call(json!({"subtype": "initialize"}), Duration::from_secs(30));
    let attach = init.and_then(|_| Ok(host.call(modes::attach_req(100, 30), Duration::from_secs(15))));
    let mut st = host.st.lock().unwrap();
    match attach {
        Ok(a) if modes::unsupported(&a) => st.unsupported = true,
        Ok(Ok(_)) => st.ready = true,
        Ok(Err(e)) | Err(e) => st.error = Some(e),
    }
    let ok = st.ready;
    drop(st);
    if !ok {
        stop_host(&host);
    }
    host
}

fn stop_host(h: &Host) {
    let _ = h.call(modes::detach_req(), Duration::from_secs(2));
    h.stdin.lock().unwrap().take(); // stdin 을 닫으면 -p 가 끝난다
    for _ in 0..30 {
        if h.child.lock().unwrap().as_mut().is_none_or(|c| c.try_wait().ok().flatten().is_some()) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if let Some(c) = h.child.lock().unwrap().as_mut() {
        let _ = c.kill();
    }
}

fn host(name: &str) -> Option<Arc<Host>> {
    hosts().lock().unwrap().get(name).cloned()
}

// ── 기억 ──

fn saved() -> BTreeMap<String, Saved> {
    modes::load_saved(&std::fs::read_to_string(crate::config::data_file("modes.json")).unwrap_or_default())
}

fn save(m: &BTreeMap<String, Saved>) {
    let f = crate::config::data_file("modes.json");
    let tmp = f.with_extension("json.tmp");
    if std::fs::write(&tmp, modes::dump_saved(m)).is_ok() {
        let _ = std::fs::rename(&tmp, &f);
    }
}

fn added() -> Vec<std::path::PathBuf> {
    modes::load_added(&std::fs::read_to_string(crate::config::data_file("modes-added.json")).unwrap_or_default())
}

fn list_all() -> Vec<ModeInfo> {
    let installed = crate::tools::read_json(&crate::tools::cfg().dir.join("plugins/installed_plugins.json"));
    modes::discover_with(crate::config::data_dir(), &installed, &added())
}

/// 사용자가 만든 모드 폴더를 등록(scripts/app mode add) → 이름. 기억은 <데이터>/modes-added.json
pub fn add<R: Runtime>(app: &tauri::AppHandle<R>, dir: &str) -> Result<String, String> {
    let dir = std::path::PathBuf::from(dir);
    let name = modes::add_check(&dir, &list_all())?;
    let mut l = added();
    if !l.contains(&dir) {
        l.push(dir);
        let f = crate::config::data_file("modes-added.json");
        let tmp = f.with_extension("json.tmp");
        std::fs::write(&tmp, modes::dump_added(&l)).and_then(|_| std::fs::rename(&tmp, &f)).map_err(|e| e.to_string())?;
    }
    crate::refresh_menu(app);
    Ok(name)
}

// ── 판 — 켤 때 뒤에서 한 번 `claude --version`(0.5초쯤). 모르는 동안은 숨기지 않는다 ──

fn claude_ok() -> &'static Mutex<Option<bool>> {
    static V: OnceLock<Mutex<Option<bool>>> = OnceLock::new();
    V.get_or_init(Default::default)
}

fn check_version<R: Runtime>(app: &tauri::AppHandle<R>) {
    let out = crate::platform::run_capped(crate::platform::command(crate::claude::claude_bin()).arg("--version"), Duration::from_secs(10)).ok();
    let v = out.map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    let ok = modes::supported(&v);
    let changed = *claude_ok().lock().unwrap() != ok;
    *claude_ok().lock().unwrap() = ok;
    if changed {
        crate::refresh_menu(app);
    }
}

fn too_old() -> Option<String> {
    (*claude_ok().lock().unwrap() == Some(false)).then(|| {
        let (a, b, c) = modes::MIN_CLAUDE;
        format!("{} {a}.{b}.{c}+ (claude update)", tr("이 Claude Code 판은 모드를 못 그려요 — 업데이트해 줘:", "This Claude Code version can't draw modes — update to"))
    })
}

/// 화면·메뉴·참모가 보는 한 줄
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModeRow {
    #[serde(flatten)]
    pub info: ModeInfo,
    pub on: bool,
    #[serde(rename = "where")]
    pub place: String,
    pub alive: bool,
    /// 호스트 프로세스 번호(꺼졌으면 0) — 부하 화면이 센다
    pub pid: u32,
    /// 대시보드 칸이면 어느 대시보드
    pub dash: Option<String>,
    /// 따로 창 '항상 위'(기억) — 창이 아닌 자리에선 안 쓴다
    pub top: bool,
}

pub fn rows() -> Vec<ModeRow> {
    let s = saved();
    list_all()
        .into_iter()
        .map(|info| {
            let sv = s.get(&info.name);
            let place = modes::pick_where(None, sv, &info.where_default).to_string();
            let (alive, pid) = host(&info.name).map(|h| { let st = h.st.lock().unwrap(); (st.alive, if st.alive { st.pid } else { 0 }) }).unwrap_or((false, 0));
            let dash = if place == "dash" { sv.and_then(|x| x.dash.clone()) } else { None };
            ModeRow { on: sv.is_some_and(|x| x.on), place, alive, pid, dash, top: sv.is_some_and(|x| x.top), info }
        })
        .collect()
}

/// 지금 켜진 모드 호스트 (이름, pid) — 부하 화면이 센다
pub fn running() -> Vec<(String, u32)> {
    hosts().lock().unwrap().iter().filter_map(|(n, h)| { let st = h.st.lock().unwrap(); st.alive.then(|| (n.clone(), st.pid)) }).collect()
}

// ── 화면에 밀기 ──

const WIN_PREFIX: &str = "mode-";

pub fn is_mode_window(label: &str) -> bool {
    label.starts_with(WIN_PREFIX)
}

fn push_to<R: Runtime>(app: &tauri::AppHandle<R>, name: &str, ev: Value) {
    let msg = json!({"name": name, "ev": ev}).to_string();
    for label in ["main".to_string(), format!("{WIN_PREFIX}{name}")] {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.eval(format!("window.__mode && window.__mode({msg})"));
        }
    }
}

fn notifier<R: Runtime>(app: &tauri::AppHandle<R>) -> Notify {
    let app = app.clone();
    Arc::new(move |name: &str, ev: Value| push_to(&app, name, ev))
}

// ── 켜기·끄기 ──

/// 대시보드 칸 대상 — 말한 것 > 지난번 것. 대시보드 칸인데 대상이 없으면 None
pub fn dash_target(place: &str, asked: Option<&str>, saved: Option<&Saved>) -> Option<String> {
    if place != "dash" {
        return None;
    }
    asked.and_then(modes::safe_dash).or_else(|| saved.and_then(|s| s.dash.clone()))
}

/// 켠다(이미 켜졌으면 자리만 옮긴다) — 자리 기억, 따로 창이면 창, 그 밖(패널·대시보드 칸·모달·꽉 채우기)은 메인 창 스페이스에. 호스트는 뒤에서 띄운다
pub fn open<R: Runtime>(app: &tauri::AppHandle<R>, name: &str, asked: Option<&str>, dash: Option<&str>) -> Result<String, String> {
    if let Some(e) = too_old() {
        return Err(e);
    }
    let info = list_all().into_iter().find(|m| m.name == name).ok_or_else(|| format!("{}: {name}", tr("그런 모드가 없어", "No such mode")))?;
    let mut s = saved();
    let place = modes::pick_where(asked, s.get(name), &info.where_default);
    let target = dash_target(place, dash, s.get(name));
    if place == "dash" && target.is_none() {
        return Err(tr("어느 대시보드에 둘지 알려 줘 — --where dash <참모·프로젝트 이름>", "Which dashboard? — --where dash <assistant or project name>").into());
    }
    let top = s.get(name).is_some_and(|x| x.top);
    s.insert(name.to_string(), Saved { on: true, place: place.into(), dash: target.clone(), top });
    save(&s);
    let label = format!("{WIN_PREFIX}{name}");
    if place == "window" {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.set_always_on_top(top);
            let _ = w.show();
            let _ = w.set_focus();
        } else {
            let size = info_size(&info);
            let w = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App(format!("mode.html?m={name}").into()))
                .title(&info.title)
                .inner_size(size.0, size.1)
                .min_inner_size(260.0, 160.0)
                .always_on_top(top)
                .build()
                .map_err(|e| e.to_string())?;
            crate::debug::place_near_main(app, &w);
        }
    } else {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.destroy();
        }
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
        }
    }
    push_to(app, name, json!({"subtype": "place", "where": place, "dash": target}));
    asleep().lock().unwrap().remove(name);
    seen_set(name, info.keep_alive);
    ensure_host(app, info);
    crate::refresh_menu(app);
    Ok(place.to_string())
}

/// 따로 창 '항상 위' 켜고 끄기 → 지금 자리. 기억하고, 창이 떠 있으면 바로 — 창이 아닌 자리면 기억만(다음에 창으로 켤 때 쓴다)
pub fn set_top<R: Runtime>(app: &tauri::AppHandle<R>, name: &str, on: bool) -> Result<String, String> {
    let info = list_all().into_iter().find(|m| m.name == name).ok_or_else(|| format!("{}: {name}", tr("그런 모드가 없어", "No such mode")))?;
    let mut s = saved();
    let place = modes::pick_where(None, s.get(name), &info.where_default);
    s.entry(name.to_string()).or_insert_with(|| Saved { place: place.into(), ..Default::default() }).top = on;
    save(&s);
    if let Some(w) = app.get_webview_window(&format!("{WIN_PREFIX}{name}")) {
        let _ = w.set_always_on_top(on);
    }
    push_to(app, name, json!({"subtype": "top", "on": on}));
    crate::refresh_menu(app);
    Ok(place.to_string())
}

/// 호스트가 없으면 뒤에서 띄운다(켜기·깨우기). 두 번 불러도 프로세스는 하나
fn ensure_host<R: Runtime>(app: &tauri::AppHandle<R>, info: ModeInfo) {
    let name = info.name.clone();
    let alive = host(&name).is_some_and(|h| h.st.lock().unwrap().alive);
    if !alive && starting().lock().unwrap().insert(name.clone()) {
        let app2 = app.clone();
        let n = name;
        std::thread::spawn(move || {
            let dir = if info.source == "example" { modes::write_example(crate::config::data_dir(), &info.name).unwrap_or_else(|_| info.dir.clone().into()) } else { info.dir.clone().into() };
            let h = start(&info, &dir, &modes::run_dir(crate::config::data_dir(), &n), notifier(&app2));
            starting().lock().unwrap().remove(&n);
            // 띄우는 사이에 껐으면 남기지 않는다
            if !saved().get(&n).is_some_and(|x| x.on) {
                stop_host(&h);
                return;
            }
            hosts().lock().unwrap().insert(n.clone(), h);
            push_to(&app2, &n, json!({"subtype": "ready"}));
            crate::refresh_menu(&app2);
        });
    }
}

// ── 재우기(chammo.json keepAlive:false) — 칸이 보이면 화면이 mode_seen(true), 가려지거나 닫히면 false ──

struct Seen {
    viewers: usize,
    /// 마지막으로 보는 칸이 0 이 된 때(켠 때)
    since: std::time::Instant,
    keep_alive: bool,
}

fn seen() -> &'static Mutex<HashMap<String, Seen>> {
    static S: OnceLock<Mutex<HashMap<String, Seen>>> = OnceLock::new();
    S.get_or_init(Default::default)
}

/// 재운 모드 — 보이면 깨운다(멈춘 모드는 저절로 안 켠다: '다시 켜기'는 사람이)
fn asleep() -> &'static Mutex<std::collections::HashSet<String>> {
    static A: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    A.get_or_init(Default::default)
}

/// 켤 때 — 보는 칸 수는 그대로, 시계·keepAlive 만 새로
fn seen_set(name: &str, keep_alive: bool) {
    let mut m = seen().lock().unwrap();
    let e = m.entry(name.to_string()).or_insert(Seen { viewers: 0, since: std::time::Instant::now(), keep_alive });
    e.keep_alive = keep_alive;
    if e.viewers == 0 {
        e.since = std::time::Instant::now();
    }
}

#[tauri::command]
pub fn mode_seen(app: tauri::AppHandle, name: String, on: bool) {
    let wake = {
        let mut m = seen().lock().unwrap();
        let e = m.entry(name.clone()).or_insert(Seen { viewers: 0, since: std::time::Instant::now(), keep_alive: true });
        if on {
            e.viewers += 1;
        } else {
            e.viewers = e.viewers.saturating_sub(1);
            if e.viewers == 0 {
                e.since = std::time::Instant::now();
            }
        }
        on && asleep().lock().unwrap().remove(&name)
    };
    if wake && saved().get(&name).is_some_and(|x| x.on) {
        if let Some(info) = list_all().into_iter().find(|m| m.name == name) {
            ensure_host(&app, info);
        }
    }
}

/// 30초마다 — 재워도 되는 모드 중 안 보인 지 오래된 것의 호스트를 끈다(켜짐 기억은 그대로)
fn sweep<R: Runtime>(app: &tauri::AppHandle<R>) {
    let now = std::time::Instant::now();
    let names: Vec<String> = {
        let m = seen().lock().unwrap();
        running().into_iter().map(|(n, _)| n).filter(|n| m.get(n).is_some_and(|e| modes::should_sleep(e.keep_alive, true, e.viewers, now - e.since))).collect()
    };
    for n in names {
        let h = hosts().lock().unwrap().remove(&n);
        asleep().lock().unwrap().insert(n.clone());
        if let Some(h) = h {
            stop_host(&h);
        }
        push_to(app, &n, json!({"subtype": "asleep"}));
    }
}

fn info_size(info: &ModeInfo) -> (f64, f64) {
    let hint = modes::hint(Path::new(&info.dir), &info.name, info.source);
    let n = |k: &str, d: f64| hint["size"][k].as_f64().filter(|v| (160.0..=2000.0).contains(v)).unwrap_or(d);
    (n("w", 440.0), n("h", 360.0))
}

/// 끈다 — 기억(꺼짐), 창 닫기, 호스트 끄기(뒤에서)
pub fn close<R: Runtime>(app: &tauri::AppHandle<R>, name: &str) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&format!("{WIN_PREFIX}{name}")) {
        let _ = w.destroy();
    }
    turn_off(app, name);
    Ok(())
}

fn turn_off<R: Runtime>(app: &tauri::AppHandle<R>, name: &str) {
    let mut s = saved();
    if let Some(x) = s.get_mut(name) {
        x.on = false;
        save(&s);
    }
    let h = hosts().lock().unwrap().remove(name);
    asleep().lock().unwrap().remove(name);
    push_to(app, name, json!({"subtype": "closed"}));
    if let Some(h) = h {
        std::thread::spawn(move || stop_host(&h));
    }
    crate::refresh_menu(app);
}

/// 따로 창을 빨간 버튼으로 닫았다 = 끄기(창은 저절로 닫힌다)
pub fn window_closed<R: Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    if let Some(name) = label.strip_prefix(WIN_PREFIX) {
        turn_off(app, name);
    }
}

/// 멈춘 모드 다시 켜기 — 죽은 호스트를 치우고 같은 자리로
pub fn restart<R: Runtime>(app: &tauri::AppHandle<R>, name: &str) -> Result<String, String> {
    hosts().lock().unwrap().remove(name);
    open(app, name, None, None)
}

/// 앱을 켜면 켜져 있던 모드만 다시
pub fn boot<R: Runtime>(app: &tauri::AppHandle<R>) {
    let app = app.clone();
    let app2 = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));
        sweep(&app2);
    });
    std::thread::spawn(move || {
        check_version(&app);
        for (n, s) in saved() {
            if s.on {
                let _ = open(&app, &n, None, None);
            }
        }
    });
}

/// 앱이 꺼질 때 — 호스트를 남기지 않는다
pub fn shutdown() {
    let all: Vec<Arc<Host>> = hosts().lock().unwrap().drain().map(|(_, h)| h).collect();
    for h in all {
        h.stdin.lock().unwrap().take();
        if let Some(c) = h.child.lock().unwrap().as_mut() {
            let _ = c.kill();
        }
    }
}

// ── 화면이 부르는 명령 ──

#[tauri::command]
pub fn mode_list() -> Vec<ModeRow> {
    rows()
}

// 창을 만드는 명령은 async — 동기 명령은 메인 스레드에서 돌아 윈도우에서 창 만들기가 멈출 수 있다
#[tauri::command]
pub async fn mode_open(app: tauri::AppHandle, name: String, place: Option<String>, dash: Option<String>) -> Result<String, String> {
    open(&app, &name, place.as_deref(), dash.as_deref())
}

#[tauri::command]
pub async fn mode_close(app: tauri::AppHandle, name: String) -> Result<(), String> {
    close(&app, &name)
}

#[tauri::command]
pub async fn mode_restart(app: tauri::AppHandle, name: String) -> Result<String, String> {
    restart(&app, &name)
}

#[tauri::command]
pub async fn mode_top(app: tauri::AppHandle, name: String, on: bool) -> Result<String, String> {
    set_top(&app, &name, on)
}

#[tauri::command]
pub fn mode_state(name: String) -> HostState {
    host(&name).map(|h| h.st.lock().unwrap().clone()).unwrap_or_default()
}

/// 한 칸 그리기 → {tree, …}. 칸 크기는 글자 칸 단위(화면이 잰다)
#[tauri::command]
pub async fn mode_render(name: String, component: String, instance: String, columns: u32, rows: u32) -> Result<Value, String> {
    let h = host(&name).ok_or("not running")?;
    if !matches!(component.as_str(), "Pane" | "AbovePrompt") {
        return Err("component".into());
    }
    tauri::async_runtime::spawn_blocking(move || h.call(modes::render_req(&component, &instance, columns, rows), Duration::from_secs(10)))
        .await
        .map_err(|e| e.to_string())?
}

/// 누름·입력·고르기 — {kind: press|input|select, plugin, handle, key, value?, href?, submit?}
#[tauri::command]
pub async fn mode_act(name: String, act: Value) -> Result<Value, String> {
    let h = host(&name).ok_or("not running")?;
    let req = modes::act_req(&act)?;
    tauri::async_runtime::spawn_blocking(move || h.call(req, Duration::from_secs(10))).await.map_err(|e| e.to_string())?
}

// ── Client 칸 — 화면 모듈은 별도 주소 방(modeframe://)에서 돌고, 앱은 규약 다리만 놓는다 ──

/// 그 모드 플러그인의 화면 모듈들(런타임·파일·입구) — 방에 넣을 것
#[tauri::command]
pub async fn mode_client_module(name: String, plugin: String) -> Result<Value, String> {
    let h = host(&name).ok_or("not running")?;
    let req = modes::client_module_req(&plugin)?;
    tauri::async_runtime::spawn_blocking(move || h.call(req, Duration::from_secs(10))).await.map_err(|e| e.to_string())?
}

/// Client 안 누름 → {handled, reached} — reached 를 방에 돌려주면 방이 그 닫힌 함수를 돌린다
#[tauri::command]
pub async fn mode_client_act(name: String, at: Value, act: Value) -> Result<Value, String> {
    let h = host(&name).ok_or("not running")?;
    let req = modes::client_press_req(&at, &act)?;
    tauri::async_runtime::spawn_blocking(move || h.call(req, Duration::from_secs(10))).await.map_err(|e| e.to_string())?
}

/// Client 가 보낸 글 → 모드 ui.message (답에 props 가 오면 방에 다시 넣는다)
#[tauri::command]
pub async fn mode_client_message(name: String, at: Value, data: Value) -> Result<Value, String> {
    let h = host(&name).ok_or("not running")?;
    let req = modes::client_message_req(&at, &data)?;
    tauri::async_runtime::spawn_blocking(move || h.call(req, Duration::from_secs(10))).await.map_err(|e| e.to_string())?
}

/// Client 가 멈췄다 → 모드 ui.fault
#[tauri::command]
pub async fn mode_client_fault(name: String, at: Value, phase: String, reason: String) -> Result<Value, String> {
    let h = host(&name).ok_or("not running")?;
    let req = modes::client_fault_req(&at, &phase, &reason)?;
    tauri::async_runtime::spawn_blocking(move || h.call(req, Duration::from_secs(5))).await.map_err(|e| e.to_string())?
}

// ── 메뉴바 '모드' (리더 뒤·윈도우 앞) ──

/// 자리 이름(메뉴 ✓ 옆)
pub fn place_word(p: &str) -> &'static str {
    match p {
        "panel" => tr("스페이스 패널", "Space panel"),
        "dash" => tr("대시보드 칸", "Dashboard"),
        "modal" => tr("미리보기", "Preview"),
        "full" => tr("꽉 채우기", "Full"),
        _ => tr("따로 창", "Window"),
    }
}

fn place_menu(p: &str) -> &'static str {
    match p {
        "panel" => tr("스페이스 패널로 켜기", "Open in the space panel"),
        "dash" => tr("지금 대시보드 칸으로 켜기", "Open in this dashboard"),
        "modal" => tr("미리보기로 켜기", "Open as a preview"),
        "full" => tr("꽉 채워 켜기", "Open full"),
        _ => tr("따로 창으로 켜기", "Open in a window"),
    }
}

/// 메뉴 '항상 위' (체크, 누를 수 있나) — 꺼져 있어도 자리가 따로 창이면 누를 수 있다(다음에 켤 때 쓴다)
fn top_item(r: &ModeRow) -> (bool, bool) {
    (r.top, r.place == "window")
}

/// 메뉴바 '모드' — 판이 모드를 못 그리면 None(메뉴를 뺀다)
pub fn menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Option<tauri::menu::Submenu<R>>> {
    if too_old().is_some() {
        return Ok(None);
    }
    use tauri::menu::{CheckMenuItem, MenuItem, SubmenuBuilder};
    let mut m = SubmenuBuilder::new(app, tr("모드", "Modes"));
    for r in rows() {
        let title = if r.on { format!("{} ✓ {}", r.info.title, place_word(&r.place)) } else { r.info.title.clone() };
        let n = &r.info.name;
        let mut sub = SubmenuBuilder::new(app, title);
        for p in modes::PLACES {
            sub = sub.item(&CheckMenuItem::with_id(app, format!("mode_open:{p}:{n}"), place_menu(p), true, r.on && r.place == *p, None::<&str>)?);
        }
        let (top, can) = top_item(&r);
        let sub = sub
            .separator()
            .item(&CheckMenuItem::with_id(app, format!("mode_top:{n}"), tr("항상 위", "Always on Top"), can, top, None::<&str>)?)
            .item(&MenuItem::with_id(app, format!("mode_close:{n}"), tr("끄기", "Turn off"), r.on, None::<&str>)?)
            .build()?;
        m = m.item(&sub);
    }
    m.separator()
        .item(&MenuItem::with_id(app, "mode_new", tr("새 모드 만들기…", "New Mode…"), true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "mode_folder", tr("모드 폴더 열기", "Open Modes Folder"), true, None::<&str>)?)
        .build()
        .map(Some)
}

/// 메뉴 누름 — mode_open:<자리>:<이름> · mode_close:<이름> · mode_folder. 우리 것이면 true
pub fn on_menu<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) -> bool {
    // 새 모드 만들기 — 지금 채팅 탭 참모 입력칸에 지시 한 줄을 넣는다(보내기는 사람이, ui/mode/modeBus)
    if id == "mode_new" {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.eval("window.__modeNew && window.__modeNew()");
        }
        return true;
    }
    if id == "mode_folder" {
        let d = crate::config::data_dir().join("modes");
        let _ = std::fs::create_dir_all(&d);
        let _ = crate::platform::open_path(&d.to_string_lossy());
        return true;
    }
    if let Some(rest) = id.strip_prefix("mode_open:") {
        if let Some((place, name)) = rest.split_once(':') {
            // 대시보드 칸은 '지금 보는 대시보드'를 화면만 안다 — 화면이 대상을 붙여 mode_open 을 다시 부른다(ui/mode/modeBus)
            if place == "dash" {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.eval(format!("window.__modeDash && window.__modeDash({})", json!(name)));
                }
                return true;
            }
            let (app, place, name) = (app.clone(), place.to_string(), name.to_string());
            std::thread::spawn(move || {
                if let Err(e) = open(&app, &name, Some(&place), None) {
                    crate::claude::log_out("mode", &e);
                }
            });
        }
        return true;
    }
    if let Some(name) = id.strip_prefix("mode_top:") {
        let on = !saved().get(name).is_some_and(|x| x.top);
        if let Err(e) = set_top(app, name, on) {
            crate::claude::log_out("mode", &e);
        }
        return true;
    }
    if let Some(name) = id.strip_prefix("mode_close:") {
        let _ = close(app, name);
        return true;
    }
    false
}

/// 답 글의 자리 — 참모가 사용자에게 그대로 옮길 수 있게
pub fn place_en(p: &str) -> &'static str {
    match p {
        "panel" => "the space panel",
        "dash" => "the dashboard",
        "modal" => "a preview",
        "full" => "the full space",
        _ => "a window",
    }
}

/// 참모 scripts/app mode list|open|close|add|top → 답 글
pub fn answer<R: Runtime>(app: &tauri::AppHandle<R>, req: &crate::appctl::ModeReq) -> String {
    let (name, place) = (req.name.as_str(), req.place.as_deref());
    match req.verb.as_str() {
        "list" => {
            let rows = rows();
            let mut out: Vec<String> = rows
                .iter()
                .map(|r| {
                    let at = r.dash.as_deref().map(|d| format!(" {d}")).unwrap_or_default();
                    let zz = asleep().lock().unwrap().contains(&r.info.name);
                    let st = if r.on { format!("on · {}{at}{}{}", r.place, if r.top && r.place == "window" { " · on top" } else { "" }, if r.alive { "" } else if zz { " · asleep (wakes when shown)" } else { " · not running" }) } else { "off".into() };
                    format!("{}\t{}\t{}\t{}", r.info.name, r.info.title, r.info.source, st)
                })
                .collect();
            let n = running().len();
            out.push(format!("running hosts: {n} (≈240MB each)"));
            out.join("\n")
        }
        "open" => match open(app, name, place, req.dash.as_deref()) {
            Ok(p) => format!("ok: {name} opened in {}", place_en(&p)),
            Err(e) => format!("error: {e}"),
        },
        "add" => match add(app, req.dir.as_deref().unwrap_or("")) {
            Ok(n) => format!("ok: added {n} — scripts/app mode open {n}"),
            Err(e) => format!("error: {e}"),
        },
        "top" => {
            let on = req.on.unwrap_or(false);
            match set_top(app, name, on) {
                Ok(p) if p == "window" => format!("ok: {name} always on top {}", if on { "on" } else { "off" }),
                Ok(p) => format!("ok: {name} always on top {} — saved; it's in {} now, so it applies when it opens in a window", if on { "on" } else { "off" }, place_en(&p)),
                Err(e) => format!("error: {e}"),
            }
        }
        "close" => match close(app, name) {
            Ok(()) => format!("ok: {name} turned off"),
            Err(e) => format!("error: {e}"),
        },
        _ => "error: verb".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 대시보드_칸_대상은_말한_것_지난번_순이고_다른_자리엔_없다() {
        let s = Saved { on: true, place: "dash".into(), dash: Some("shop".into()), top: false };
        assert_eq!(dash_target("dash", Some("notes"), Some(&s)).as_deref(), Some("notes"));
        assert_eq!(dash_target("dash", None, Some(&s)).as_deref(), Some("shop"));
        assert_eq!(dash_target("dash", Some("\n"), None), None, "못 쓰는 대상은 없는 것");
        assert_eq!(dash_target("panel", Some("notes"), Some(&s)), None);
    }

    #[test]
    fn 항상_위_메뉴는_따로_창_자리에서만_누를_수_있고_기억대로_체크된다() {
        let info = ModeInfo { name: "clock".into(), title: "Clock".into(), source: "folder", dir: "/x".into(), where_default: "window".into(), keep_alive: true };
        let row = |on: bool, place: &str, top: bool| ModeRow { info: info.clone(), on, place: place.into(), alive: on, pid: 0, dash: None, top };
        assert_eq!(top_item(&row(true, "window", true)), (true, true));
        assert_eq!(top_item(&row(true, "window", false)), (false, true));
        assert_eq!(top_item(&row(false, "window", true)), (true, true), "꺼져 있어도 다음에 창으로 켤 때 쓴다");
        assert_eq!(top_item(&row(true, "panel", true)), (true, false), "창이 아닌 자리에선 기억만 남고 못 누른다");
    }

    #[test]
    fn 자리마다_메뉴_이름과_답_글이_있다() {
        for p in modes::PLACES {
            assert!(!place_menu(p).is_empty() && !place_word(p).is_empty());
        }
        assert_eq!(place_en("dash"), "the dashboard");
        assert_eq!(place_en("window"), "a window");
    }

    // 판마다 돌리는 실측 — 진짜 claude 로 예시 카운터를 띄워 붙고·그리고·누르고·다시 그린다(규약이 @internal 이라 판이 바뀌면 여기서 먼저 깨진다).
    // cargo test --bin honor-orchestrator modes_host::tests::진짜_claude -- --ignored --exact 로
    #[test]
    #[ignore]
    fn 진짜_claude_로_카운터를_띄워_누르면_숫자가_오른다() {
        let d = std::env::temp_dir().join(format!("chammo-modehost-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let dir = modes::write_example(&d, "counter").unwrap();
        let info = modes::discover(&d, &Value::Null).into_iter().find(|m| m.name == "counter").unwrap();
        let pushes = Arc::new(Mutex::new(Vec::<Value>::new()));
        let p2 = pushes.clone();
        let h = start(&info, &dir, &modes::run_dir(&d, "counter"), Arc::new(move |_: &str, v: Value| p2.lock().unwrap().push(v)));
        let st = h.st.lock().unwrap().clone();
        assert!(st.ready && !st.unsupported, "{st:?}");
        let band = |h: &Host| h.call(modes::render_req("AbovePrompt", "above-prompt", 80, 20), Duration::from_secs(10)).unwrap();
        let t = band(&h);
        let text = |t: &Value| t["tree"]["children"][0]["children"].as_array().unwrap().iter().filter_map(|x| x.as_str()).collect::<String>();
        assert_eq!(text(&t), "Pressed 0");
        let btn = &t["tree"]["children"][1];
        let act = json!({"kind": "press", "plugin": btn["press"]["plugin"], "handle": btn["press"]["handle"], "key": btn["props"]["key"]});
        let r = h.call(modes::act_req(&act).unwrap(), Duration::from_secs(10)).unwrap();
        assert_eq!(r["handled"], true);
        assert_eq!(text(&band(&h)), "Pressed 1");
        std::thread::sleep(Duration::from_millis(300));
        let kinds: Vec<String> = pushes.lock().unwrap().iter().filter_map(|v| v["subtype"].as_str().map(str::to_owned)).collect();
        assert!(kinds.contains(&"ui_invalidate".into()) && kinds.contains(&"ui_toast".into()), "{kinds:?}");
        assert_eq!(h.st.lock().unwrap().status.as_deref(), Some("Counter 1"));
        assert_eq!(h.st.lock().unwrap().panes[0]["id"], "board");
        stop_host(&h);
        std::thread::sleep(Duration::from_millis(500));
        assert!(!h.st.lock().unwrap().alive, "끄면 프로세스가 끝난다");
        let _ = std::fs::remove_dir_all(&d);
    }

    // Client(화면 모듈) 규약 실측 — 시험용 tick 모드(Pane 안 Client 하나)를 띄워 모듈 받기·누르기·글 보내기·고장 알림까지.
    // cargo test --bin honor-orchestrator modes_host::tests::진짜_claude_로_client -- --ignored --exact 로
    #[test]
    #[ignore]
    fn 진짜_claude_로_client_모듈을_받고_누르고_글을_보낸다() {
        let d = std::env::temp_dir().join(format!("chammo-modeclient-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let dir = d.join("tick");
        for (rel, body) in [
            (".claude-plugin/plugin.json", r#"{ "name": "tick", "version": "0.1.0" }"#),
            ("hooks/hooks.json", r#"{ "modules": ["./register.tsx"] }"#),
            ("hooks/register.tsx", "import type { Register } from 'claude-code'\nexport const register: Register = on => {\n  on('session.start', async ($, e, next) => { void $.ui.open({ id: 'board', title: 'Tick' }); return next(e) })\n  on('ui.render', { component: 'Pane', requestId: 'board' }, async ($, e) => {\n    const { Box, Client } = $.ui.resolve(e)\n    return <Box><Client module=\"./board.tsx\" key=\"b1\" props={{ start: 5 }} /></Box>\n  })\n  on('ui.message', async ($, e) => { $.ui.toast(`got ${JSON.stringify(e.data)}`) })\n}\n"),
            ("hooks/board.tsx", "export default function Board(props: { start: number }, surface: any) {\n  const { Box, Text, Button } = surface.elements\n  const n = surface.state ?? props.start\n  return <Box><Text>count {String(n)}</Text><Button key=\"up\" label=\"Up\" onPress={() => surface.setState(n + 1)} /></Box>\n}\n"),
        ] {
            let p = dir.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        let info = ModeInfo { name: "tick".into(), title: "Tick".into(), source: "folder", dir: dir.to_string_lossy().into_owned(), where_default: "window".into(), keep_alive: true };
        let pushes = Arc::new(Mutex::new(Vec::<Value>::new()));
        let p2 = pushes.clone();
        let h = start(&info, &dir, &modes::run_dir(&d, "tick"), Arc::new(move |_: &str, v: Value| p2.lock().unwrap().push(v)));
        assert!(h.st.lock().unwrap().ready, "{:?}", h.st.lock().unwrap());
        let r = h.call(modes::render_req("Pane", "board", 80, 20), Duration::from_secs(10)).unwrap();
        let node = &r["tree"]["children"][0];
        assert_eq!((node["type"].as_str(), node["props"]["module"].as_str(), node["client"]["plugin"].as_str()), (Some("Client"), Some("hooks/board.tsx"), Some("tick")));
        assert!(r["client_modules"]["tick"].as_str().is_some_and(|x| x.len() == 64), "{r}");
        let m = h.call(modes::client_module_req("tick").unwrap(), Duration::from_secs(10)).unwrap();
        assert_eq!(m["runtime"], "claude:surface-runtime");
        assert_eq!(m["modules"][0], json!({"module": "hooks/board.tsx", "entry": "surface:///hooks/board.tsx", "component": "default"}));
        let keys: Vec<&str> = m["files"].as_array().unwrap().iter().filter_map(|f| f["key"].as_str()).collect();
        assert!(keys.contains(&"claude:surface-runtime") && keys.contains(&"surface:///hooks/board.tsx"), "{keys:?}");
        let rt = m["files"].as_array().unwrap().iter().find(|f| f["key"] == "claude:surface-runtime").unwrap()["source"].as_str().unwrap();
        assert!(rt.contains("export const install") && rt.contains("export const h"), "방이 쓰는 런타임 모양(install·h)");
        let at = json!({"plugin": "tick", "instance_id": "board", "client": "b1", "module": "hooks/board.tsx", "component": "Pane"});
        let press = h.call(modes::client_press_req(&at, &json!({"kind": "press", "element": "up"})).unwrap(), Duration::from_secs(10)).unwrap();
        assert_eq!(press["handled"], true, "{press}");
        assert_eq!(press["reached"]["element"], "up");
        let msg = h.call(modes::client_message_req(&at, &json!({"n": 6})).unwrap(), Duration::from_secs(10)).unwrap();
        assert_eq!(msg["handled"], true);
        let fault = h.call(modes::client_fault_req(&at, "run", "test").unwrap(), Duration::from_secs(10)).unwrap();
        assert_eq!(fault["handled"], true);
        std::thread::sleep(Duration::from_millis(300));
        assert!(pushes.lock().unwrap().iter().any(|v| v["subtype"] == "ui_toast" && v["text"] == r#"got {"n":6}"#));
        stop_host(&h);
        let _ = std::fs::remove_dir_all(&d);
    }
}
