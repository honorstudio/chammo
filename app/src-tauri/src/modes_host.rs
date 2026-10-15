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
/// host.log 에 한 줄(modes::host_log_line) — 켬·pid·붙기 실패·끝난 코드·끈 까닭
fn host_note(log: &Path, what: &str) {
    if std::fs::metadata(log).is_ok_and(|m| m.len() > modes::HOST_LOG_MAX) {
        let _ = std::fs::rename(log, log.with_extension("log.1"));
    }
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log) {
        let _ = writeln!(f, "{}", modes::host_log_line(ms, what));
    }
}

fn start(info: &ModeInfo, plugin_dir: &Path, run: &Path, notify: Notify) -> Arc<Host> {
    let _ = std::fs::create_dir_all(run);
    let log = run.join("host.log");
    host_note(&log, &format!("start {} — {}", info.name, plugin_dir.display()));
    // 이어 쓴다(예전엔 File::create 로 켤 때마다 비워 늘 0바이트였다) — claude 가 stderr 에 쓰는 것도 같은 파일 뒤에
    let err = std::fs::OpenOptions::new().create(true).append(true).open(&log).map(Stdio::from).unwrap_or_else(|_| Stdio::null());
    let spawned = crate::platform::command(crate::claude::claude_bin())
        .args(modes::host_args(plugin_dir))
        .envs(modes::host_env(crate::config::data_dir()))
        .current_dir(run)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(err)
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => {
            host_note(&log, &format!("spawn failed: {e}"));
            // 프로세스가 없다(claude 없음 등) — 죽은 호스트로 남겨 화면이 '멈췄어 · 다시 켜기'를 보이게
            let st = HostState { error: Some(e.to_string()), log: log.to_string_lossy().into_owned(), ..Default::default() };
            return Arc::new(Host { child: Mutex::new(None), stdin: Mutex::new(None), pending: Default::default(), st: Mutex::new(st), seq: AtomicU64::new(0) });
        }
    };
    let out = child.stdout.take();
    let pid = child.id();
    host_note(&log, &format!("pid {pid}"));
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
    let log2 = log.clone();
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
        host_note(&log2, &format!("exit {} — stdout closed", code.map(|c| c.to_string()).unwrap_or_else(|| "signal".into())));
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
    let why = if st.unsupported { "unsupported (claude too old)".to_string() } else { st.error.clone().unwrap_or_default() };
    drop(st);
    if ok {
        host_note(&log, "ready");
    } else {
        stop_host(&host, &format!("attach failed: {why}"));
    }
    host
}

/// why = 끈 까닭(host.log) — 재움·끄기·붙기 실패·켜는 사이 꺼짐
fn stop_host(h: &Host, why: &str) {
    let log = h.st.lock().unwrap().log.clone();
    if !log.is_empty() {
        host_note(Path::new(&log), &format!("stop: {why}"));
    }
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
    saved_at(&crate::config::data_file("modes.json"))
}

fn saved_at(f: &Path) -> BTreeMap<String, Saved> {
    modes::load_saved(&std::fs::read_to_string(f).unwrap_or_default())
}

/// 기억 고치기 — 읽고·고치고·쓰기를 한 잠금 안에서. 켜기·끄기는 명령마다 다른 스레드라, 잠금이 없으면
/// '셋 다 켜 보기'처럼 한꺼번에 올 때 서로 덮어써 마지막 하나만 켜진 채 남는다(2026-10-12)
fn edit_saved<T>(by: &str, edit: impl FnOnce(&mut BTreeMap<String, Saved>) -> T) -> T {
    edit_saved_at(&crate::config::data_file("modes.json"), by, edit)
}

/// by = 누가 바꿨나(desktop·phone·appctl·menu·window·boot·restore…) — 값이 실제로 바뀐 모드만 actions.log 에 한 줄(10/13: 자리가 바뀌었는데 누가 바꿨는지 몰랐다)
fn edit_saved_at<T>(f: &Path, by: &str, edit: impl FnOnce(&mut BTreeMap<String, Saved>) -> T) -> T {
    static LOCK: Mutex<()> = Mutex::new(());
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut m = saved_at(f);
    let before = m.clone();
    let r = edit(&mut m);
    let tmp = f.with_extension("json.tmp");
    if std::fs::write(&tmp, modes::dump_saved(&m)).is_ok() {
        let _ = std::fs::rename(&tmp, f);
    }
    let names: std::collections::BTreeSet<&String> = before.keys().chain(m.keys()).collect();
    for n in names {
        if let Some(c) = modes::saved_change(before.get(n), m.get(n)) {
            crate::claude::log_action("mode", n, &format!("{c} · by {by}"));
        }
    }
    r
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
    /// 숨긴 기본 모드(modes-hidden.json) — 고르기·메뉴엔 안 내고 관리 화면 '숨긴 기본 모드'에만
    pub hidden: bool,
}

pub fn rows() -> Vec<ModeRow> {
    let s = saved();
    let hidden = modes::hidden_at(crate::config::data_dir());
    list_all()
        .into_iter()
        .map(|info| {
            let sv = s.get(&info.name);
            let place = modes::pick_where(None, sv, &info.where_default).to_string();
            let (alive, pid) = host(&info.name).map(|h| { let st = h.st.lock().unwrap(); (st.alive, if st.alive { st.pid } else { 0 }) }).unwrap_or((false, 0));
            let dash = if place == "dash" { sv.and_then(|x| x.dash.clone()) } else { None };
            ModeRow { on: sv.is_some_and(|x| x.on), place, alive, pid, dash, top: sv.is_some_and(|x| x.top), hidden: hidden.contains(&info.name), info }
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

/// 대시보드 대상 → 저장할 이름(modes::resolve_dash) — 살아 있는 참모는 live.json(앱이 적는다)에서
fn dash_name(asked: &str) -> Result<String, String> {
    let c = crate::config::current();
    let hq = crate::config::hq_dir(&crate::config::home(), &c, |k| std::env::var(k).ok());
    let assistant = crate::config::assistant_name();
    let looks = |b: &str| crate::messenger::is_orch_name(b, &assistant);
    let live = std::fs::read_to_string(crate::config::data_file("live.json")).unwrap_or_default();
    modes::resolve_dash(asked, &modes::dash_orchs(&live, &hq, looks), looks)
}

/// 켠다(이미 켜졌으면 자리만 옮긴다) — 자리 기억, 따로 창이면 창, 그 밖(패널·대시보드 칸·모달·꽉 채우기)은 메인 창 스페이스에. 호스트는 뒤에서 띄운다
pub fn open<R: Runtime>(app: &tauri::AppHandle<R>, name: &str, asked: Option<&str>, dash: Option<&str>, by: &str) -> Result<String, String> {
    if let Some(e) = too_old() {
        return Err(e);
    }
    // 참모는 짧은 이름·id 무엇을 받든 전체 이름으로 — 화면은 전체 이름으로 칸을 찾는다(10/13 '--where dash 참모-7' 이 칸에 안 떴다)
    let dash = match dash {
        Some(d) => Some(dash_name(d)?),
        None => None,
    };
    let dash = dash.as_deref();
    let info = list_all().into_iter().find(|m| m.name == name).ok_or_else(|| format!("{}: {name}", tr("그런 모드가 없어", "No such mode")))?;
    // 숨긴 기본 모드를 이름으로 켜면(참모 mode open) 다시 보이게 — 켠 것이 목록에 없으면 끌 길이 없다
    let _ = modes::set_hidden_at(crate::config::data_dir(), name, false);
    let (place, target, top) = edit_saved(by, |s| {
        let place = modes::pick_where(asked, s.get(name), &info.where_default);
        let target = dash_target(place, dash, s.get(name));
        if place == "dash" && target.is_none() {
            return Err(tr("어느 대시보드에 둘지 알려 줘 — --where dash <참모·프로젝트 이름>", "Which dashboard? — --where dash <assistant or project name>").to_string());
        }
        let top = s.get(name).is_some_and(|x| x.top);
        s.insert(name.to_string(), Saved { on: true, place: place.into(), dash: target.clone(), top });
        Ok((place, target, top))
    })?;
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
    let place = edit_saved("top", |s| {
        let place = modes::pick_where(None, s.get(name), &info.where_default);
        s.entry(name.to_string()).or_insert_with(|| Saved { place: place.into(), ..Default::default() }).top = on;
        place
    });
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
            // 띄우는 사이에 껐으면 남기지 않는다
            if !saved().get(&n).is_some_and(|x| x.on) {
                starting().lock().unwrap().remove(&n);
                stop_host(&h, "turned off while starting");
                return;
            }
            // 호스트를 넣은 뒤에 '띄우는 중'을 뺀다 — 거꾸로면 그 사이 mode_state 가 '호스트 없음(멈춤)'으로 본다
            hosts().lock().unwrap().insert(n.clone(), h);
            starting().lock().unwrap().remove(&n);
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
        let e = m.entry(name.clone()).or_insert(Seen { viewers: 0, since: std::time::Instant::now(), keep_alive: false });
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
            stop_host(&h, "asleep (not shown for 5 min, keepAlive false)");
        }
        push_to(app, &n, json!({"subtype": "asleep"}));
    }
}

// ── 폰 홈 모드 카드(폰 서버 mobile_http 가 부른다) ──

/// 폰에 넘길 상태 — 로그 자리·pid 는 뺀다
pub fn phone_state(st: &HostState) -> Value {
    let panes: Vec<Value> = st.panes.iter().map(|p| json!({"id": p.get("id"), "title": p.get("title")})).collect();
    json!({"alive": st.alive, "ready": st.ready, "unsupported": st.unsupported, "status": st.status, "error": st.error, "shown": st.shown, "panes": panes})
}

/// 폰 목록 — 이름·제목·출처(내가 만든 것/참모 모드 나누기)·켜짐·자리·대시보드·살았나만(폴더 경로는 안 낸다)
pub fn phone_rows() -> Value {
    Value::Array(rows().into_iter().map(|r| json!({"name": r.info.name, "title": r.info.title, "source": r.info.source, "on": r.on, "where": r.place, "dash": r.dash, "alive": r.alive, "hidden": r.hidden})).collect())
}

/// 폰이 보는 동안 — 재운 모드면 깨우고, 데스크톱에서 보는 칸이 없으면 시계를 지금으로(폰이 마지막으로 본 뒤 5분이면 다시 잔다)
fn phone_touch<R: Runtime>(app: &tauri::AppHandle<R>, name: &str) {
    if let Some(e) = seen().lock().unwrap().get_mut(name) {
        if e.viewers == 0 {
            e.since = std::time::Instant::now();
        }
    }
    if asleep().lock().unwrap().remove(name) && saved().get(name).is_some_and(|x| x.on) {
        if let Some(info) = list_all().into_iter().find(|m| m.name == name) {
            ensure_host(app, info);
        }
    }
}

/// 폰 한 칸 — 상태 + 보이는 칸(Pane) 트리. 띠(AbovePrompt)는 폰에 안 그린다
pub fn phone_view<R: Runtime>(app: &tauri::AppHandle<R>, name: &str, columns: u32, lines: u32) -> Result<Value, String> {
    phone_touch(app, name);
    let Some(h) = host(name) else { return Ok(json!({"state": phone_state(&HostState::default())})) };
    let st = h.st.lock().unwrap().clone();
    let mut out = json!({"state": phone_state(&st)});
    let id = st.shown.clone().or_else(|| st.panes.first().and_then(|p| p.get("id")).and_then(Value::as_str).map(str::to_string));
    if let (true, Some(id)) = (st.ready, id) {
        let r = h.call(modes::render_req("Pane", &id, columns, lines), Duration::from_secs(10))?;
        remember_card(name, &r);
        out["tree"] = r.get("tree").cloned().unwrap_or(Value::Null);
    }
    Ok(out)
}

pub fn phone_act(name: &str, act: &Value) -> Result<Value, String> {
    let h = host(name).ok_or("not running")?;
    h.call(modes::act_req(act)?, Duration::from_secs(10))
}

/// 폰 고르기 — 등록된 모드(내가 만든 것·참모 모드)를 그 참모 홈(대시보드 칸)에 켠다. 다른 자리에 켜져 있었으면 이리로 옮긴다(데스크톱 고르기와 같다)
pub fn phone_open<R: Runtime>(app: &tauri::AppHandle<R>, name: &str, dash: &str) -> Result<(), String> {
    open(app, name, Some("dash"), Some(dash), "phone").map(|_| ())
}

/// 폰 '이 홈에서 끄기'가 끌 수 있나 — 그 홈에 켜진 모드만(따로 창·다른 참모 홈에 켠 건 폰이 못 끈다)
pub fn phone_close_ok(saved: Option<&Saved>, dash: &str) -> bool {
    saved.is_some_and(|s| s.on && s.place == "dash" && s.dash.as_deref() == Some(dash))
}

pub fn phone_close<R: Runtime>(app: &tauri::AppHandle<R>, name: &str, dash: &str) -> Result<(), String> {
    if !phone_close_ok(saved().get(name), dash) {
        return Err(format!("{}: {name}", tr("이 홈에 켜진 모드가 아니야", "Not open on this home")));
    }
    close(app, name, "phone")
}

fn info_size(info: &ModeInfo) -> (f64, f64) {
    let hint = modes::hint(Path::new(&info.dir), &info.name, info.source);
    let n = |k: &str, d: f64| hint["size"][k].as_f64().filter(|v| (160.0..=2000.0).contains(v)).unwrap_or(d);
    (n("w", 440.0), n("h", 360.0))
}

/// 끈다 — 기억(꺼짐), 창 닫기, 호스트 끄기(뒤에서)
pub fn close<R: Runtime>(app: &tauri::AppHandle<R>, name: &str, by: &str) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&format!("{WIN_PREFIX}{name}")) {
        let _ = w.destroy();
    }
    turn_off(app, name, by);
    Ok(())
}

fn turn_off<R: Runtime>(app: &tauri::AppHandle<R>, name: &str, by: &str) {
    turn_off_with(app, name, false, by)
}

/// wait = 호스트가 내려갈 때까지 기다린다(제거 — 실행 데이터를 옮기기 전에)
fn turn_off_with<R: Runtime>(app: &tauri::AppHandle<R>, name: &str, wait: bool, by: &str) {
    edit_saved(by, |s| {
        if let Some(x) = s.get_mut(name) {
            x.on = false;
        }
    });
    let h = hosts().lock().unwrap().remove(name);
    asleep().lock().unwrap().remove(name);
    push_to(app, name, json!({"subtype": "closed"}));
    match h {
        Some(h) if wait => stop_host(&h, &format!("turned off by {by}")),
        Some(h) => {
            let why = format!("turned off by {by}");
            drop(std::thread::spawn(move || stop_host(&h, &why)))
        }
        None => {}
    }
    crate::refresh_menu(app);
}

/// 따로 창을 빨간 버튼으로 닫았다 = 끄기(창은 저절로 닫힌다)
pub fn window_closed<R: Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    if let Some(name) = label.strip_prefix(WIN_PREFIX) {
        turn_off(app, name, "window close button");
    }
}

/// 멈춘 모드 다시 켜기 — 죽은 호스트를 치우고 같은 자리로
pub fn restart<R: Runtime>(app: &tauri::AppHandle<R>, name: &str) -> Result<String, String> {
    hosts().lock().unwrap().remove(name);
    open(app, name, None, None, "restart")
}

// ── 지우기(10/12 사용자) — 기본 모드·플러그인 = 숨기기, 내가 등록한 것·데이터 폴더 모드 = 제거. 원본 폴더는 고른 때만 맥 휴지통 ──

/// 되돌리기 기억(앱이 켜진 동안만) — 원본을 휴지통에 안 보낸 제거만 된다(등록·자리·치워 둔 실행 데이터를 되살린다)
struct Undo {
    dir: std::path::PathBuf,
    store: std::path::PathBuf,
    saved: Option<Saved>,
}

fn undos() -> &'static Mutex<HashMap<String, Undo>> {
    static U: OnceLock<Mutex<HashMap<String, Undo>>> = OnceLock::new();
    U.get_or_init(Default::default)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Removed {
    /// hidden | removed
    pub kind: &'static str,
    /// 원본을 보낸 휴지통 자리
    pub trashed: Option<String>,
    /// 되돌리기가 되나(숨기기·원본 안 보낸 제거)
    pub undo: bool,
}

fn changed<R: Runtime>(app: &tauri::AppHandle<R>, name: &str) {
    push_to(app, name, json!({"subtype": "list"}));
    crate::refresh_menu(app);
}

fn find(name: &str) -> Result<ModeInfo, String> {
    list_all().into_iter().find(|m| m.name == name).ok_or_else(|| format!("{}: {name}", tr("그런 모드가 없어", "No such mode")))
}

/// 지우기 — 켜져 있으면 끄고(호스트가 내려갈 때까지) 숨기거나 제거한다. trash_source = 원본 폴더도 맥 휴지통으로(데스크톱·참모만)
pub fn remove<R: Runtime>(app: &tauri::AppHandle<R>, name: &str, trash_source: bool) -> Result<Removed, String> {
    let info = find(name)?;
    let data = crate::config::data_dir();
    if modes::remove_way(info.source) == "hide" {
        if trash_source {
            return Err(tr("기본 모드·Claude 플러그인은 숨기기만 돼 — 휴지통으로 보낼 원본이 없어", "Built-in modes and Claude plugins can only be hidden — there's no source folder to trash").into());
        }
        close(app, name, "remove (hide)")?;
        modes::set_hidden_at(data, name, true)?;
        changed(app, name);
        return Ok(Removed { kind: "hidden", trashed: None, undo: true });
    }
    let dir = std::path::PathBuf::from(&info.dir);
    if info.source == "folder" && !trash_source {
        return Err(tr("데이터 폴더 안 모드는 그 폴더가 원본이야 — '원본 폴더도 휴지통으로'를 같이 골라 줘(--trash-source)", "This mode lives in the data folder, so its folder is the source — also choose 'move the source folder to the Trash' (--trash-source)").into());
    }
    if trash_source {
        modes::trash_ok(&dir, Path::new(&crate::config::home()))?;
    }
    let store = modes::store_dir(&crate::tools::cfg().dir, &dir).unwrap_or_default();
    if let Some(w) = app.get_webview_window(&format!("{WIN_PREFIX}{name}")) {
        let _ = w.destroy();
    }
    turn_off_with(app, name, true, "remove");
    // 원본부터 — 휴지통으로 못 보내면 끈 채로 멈추고 등록·데이터는 그대로 둔다
    let trashed = if trash_source { Some(modes::to_trash(&dir, &Path::new(&crate::config::home()).join(".Trash"))?) } else { None };
    let saved = edit_saved("remove", |s| s.remove(name));
    if info.source == "added" {
        modes::unregister_at(data, &dir)?;
    }
    if trashed.is_some() {
        // 되돌리기 없음 — 앱 쪽 실행 데이터·모드 저장은 지운다(원본은 휴지통에서 되살린다)
        let _ = std::fs::remove_dir_all(data.join("modes").join(name));
        let _ = std::fs::remove_dir_all(&store);
    } else {
        modes::stash(data, name, &store)?;
        undos().lock().unwrap().insert(name.to_string(), Undo { dir, store, saved });
    }
    asleep().lock().unwrap().remove(name);
    changed(app, name);
    Ok(Removed { kind: "removed", trashed: trashed.map(|p| p.to_string_lossy().into_owned()), undo: !trash_source })
}

/// 되돌리기 — 숨긴 것은 다시 보이게, 방금 제거한 것은 등록·자리·실행 데이터를 되살린다(켜져 있었으면 그 자리로 다시 켠다)
pub fn restore<R: Runtime>(app: &tauri::AppHandle<R>, name: &str) -> Result<&'static str, String> {
    let data = crate::config::data_dir();
    if modes::set_hidden_at(data, name, false)? {
        changed(app, name);
        return Ok("shown");
    }
    let u = undos().lock().unwrap().remove(name).ok_or_else(|| {
        format!("{}: {name}", tr("되돌릴 게 없어 — 앱을 다시 켰으면 scripts/app mode add <폴더> 로 다시 등록해", "Nothing to undo — after a restart, add it again with scripts/app mode add <folder>"))
    })?;
    modes::unstash(data, name, &u.store)?;
    modes::register_at(data, &u.dir)?; // 되돌리기는 원본을 안 보낸 제거(= 내가 등록한 것)만
    let reopen = u.saved.as_ref().is_some_and(|s| s.on);
    if let Some(s) = u.saved {
        edit_saved("restore", |m| m.insert(name.to_string(), Saved { on: false, ..s }));
    }
    changed(app, name);
    if reopen {
        open(app, name, None, None, "restore")?;
    }
    Ok("restored")
}

/// 숨긴 기본 모드 다시 보이기 — 이름을 안 주면 다 → 다시 보이게 된 이름들
pub fn restore_builtin<R: Runtime>(app: &tauri::AppHandle<R>, name: Option<&str>) -> Result<Vec<String>, String> {
    let data = crate::config::data_dir();
    let all = modes::hidden_at(data);
    let pick: Vec<String> = all.into_iter().filter(|n| name.is_none_or(|x| x == n)).collect();
    if let (Some(n), true) = (name, pick.is_empty()) {
        return Err(format!("{}: {n}", tr("숨긴 기본 모드가 아니야", "Not a hidden built-in mode")));
    }
    for n in &pick {
        modes::set_hidden_at(data, n, false)?;
        changed(app, n);
    }
    Ok(pick)
}

/// 관리 화면 한 줄 — 출처·지금 자리·데이터 크기·호스트·지우기 방식(hide|remove). 원본 경로는 내가 등록한 것만
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ManageRow {
    #[serde(flatten)]
    pub row: ModeRow,
    pub way: &'static str,
    pub size: u64,
    /// 안 보여서 재웠다(보이면 깨어난다)
    pub asleep: bool,
    /// 깨어 있는 호스트 메모리(KB) — 못 읽으면 0
    pub mem_kb: u64,
}

/// `ps -o pid=,rss=` 답 → pid 별 KB
pub fn parse_rss(text: &str) -> HashMap<u32, u64> {
    text.lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
        })
        .collect()
}

/// 깨어 있는 호스트 메모리 — ps 한 번(윈도우엔 ps 가 없어 빈 표 = 0 으로 보인다)
fn host_rss(pids: &[u32]) -> HashMap<u32, u64> {
    if pids.is_empty() {
        return HashMap::new();
    }
    let list = pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    let out = crate::platform::run_capped(crate::platform::command("/bin/ps").args(["-o", "pid=,rss=", "-p", &list]), Duration::from_secs(3)).ok();
    out.map(|o| parse_rss(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default()
}

pub fn manage_rows() -> Vec<ManageRow> {
    let data = crate::config::data_dir();
    let claude = &crate::tools::cfg().dir;
    let rows = rows();
    let rss = host_rss(&rows.iter().filter(|r| r.alive && r.pid > 0).map(|r| r.pid).collect::<Vec<_>>());
    let zz = asleep().lock().unwrap().clone();
    rows.into_iter()
        .map(|row| {
            let size = modes::dir_size(&data.join("modes").join(&row.info.name)) + modes::store_dir(claude, Path::new(&row.info.dir)).map(|p| modes::dir_size(&p)).unwrap_or(0);
            let mem_kb = if row.alive { rss.get(&row.pid).copied().unwrap_or(0) } else { 0 };
            ManageRow { way: modes::remove_way(row.info.source), size, asleep: !row.alive && zz.contains(&row.info.name), mem_kb, row }
        })
        .collect()
}

// ── 고르기 카드 그림(10/12 사용자) — 모드가 정한 그림(chammo.json card) 또는 마지막으로 그려진 칸 ──

/// 칸이 그려질 때마다 쓰지 않게 — 모드마다 30초에 한 번
pub const CARD_EVERY: Duration = Duration::from_secs(30);

fn remember_card(name: &str, r: &Value) {
    let Some(tree) = r.get("tree") else { return };
    if !modes::safe_name(name) {
        return;
    }
    // 모드마다 30초에 한 번 쓰되, 막힌 그림은 버리지 않고 막이가 풀릴 때 마지막 것을 쓴다(10/13: 첫 '불러오는 중'만 남고 진짜 그림이 버려졌다)
    struct Slot {
        last: Option<std::time::Instant>,
        pending: Option<Value>,
    }
    static SLOTS: OnceLock<Mutex<HashMap<String, Slot>>> = OnceLock::new();
    let slots = SLOTS.get_or_init(Default::default);
    let now = std::time::Instant::now();
    let write = |t: &Value| modes::save_card_tree(&modes::run_dir(crate::config::data_dir(), name), t);
    let wait = {
        let mut m = slots.lock().unwrap();
        let e = m.entry(name.to_string()).or_insert(Slot { last: None, pending: None });
        match modes::card_wait(e.last, now, CARD_EVERY) {
            None => {
                e.last = Some(now);
                e.pending = None;
                None
            }
            Some(d) => {
                let first = e.pending.is_none();
                e.pending = Some(tree.clone());
                first.then_some(d) // 이미 기다리는 중이면 마지막 그림만 바꿔 둔다
            }
        }
    };
    match wait {
        None => {
            write(tree);
        }
        Some(d) => {
            let name = name.to_string();
            std::thread::spawn(move || {
                std::thread::sleep(d);
                let t = {
                    let mut m = slots.lock().unwrap();
                    let Some(e) = m.get_mut(&name) else { return };
                    e.last = Some(std::time::Instant::now());
                    e.pending.take()
                };
                if let Some(t) = t {
                    modes::save_card_tree(&modes::run_dir(crate::config::data_dir(), &name), &t);
                }
            });
        }
    }
}

pub fn card(name: &str) -> Value {
    let Ok(info) = find(name) else { return Value::Null };
    let dir = Path::new(&info.dir);
    if let Some(c) = modes::card_of(dir, &modes::hint(dir, &info.name, info.source)) {
        return c;
    }
    modes::load_card_tree(&modes::run_dir(crate::config::data_dir(), name)).map(|t| json!({"kind": "tree", "tree": t})).unwrap_or(Value::Null)
}

/// 앱을 켜면 켜져 있던 모드만 다시
pub fn boot<R: Runtime>(app: &tauri::AppHandle<R>) {
    modes::purge_removed(crate::config::data_dir()); // 지난번에 제거하고 안 되돌린 실행 데이터
    // 그만둔 예시(카운터) — 사본·실행 데이터를 치우고, 그 이름의 모드가 이제 없으면 자리 기억도 뺀다
    let gone = modes::retire_examples(crate::config::data_dir());
    let live = list_all();
    edit_saved("boot (retired example)", |s| s.retain(|n, _| !modes::RETIRED.contains(&n.as_str()) || live.iter().any(|m| &m.name == n)));
    if !gone.is_empty() {
        crate::claude::log_out("modes", &format!("retired examples: {}", gone.join(", ")));
    }
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
                let _ = open(&app, &n, None, None, "boot");
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

/// 관리 화면 — 크기를 재느라 폴더를 도니 뒤 스레드에서
#[tauri::command]
pub async fn mode_manage() -> Vec<ManageRow> {
    tauri::async_runtime::spawn_blocking(manage_rows).await.unwrap_or_default()
}

/// 호스트가 내려갈 때까지(몇 초) 기다리니 뒤 스레드에서 — 비동기 일꾼을 안 붙잡게
#[tauri::command]
pub async fn mode_remove(app: tauri::AppHandle, name: String, trash_source: Option<bool>) -> Result<Removed, String> {
    tauri::async_runtime::spawn_blocking(move || remove(&app, &name, trash_source.unwrap_or(false))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mode_restore(app: tauri::AppHandle, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || restore(&app, &name).map(str::to_string)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mode_restore_builtin(app: tauri::AppHandle, name: Option<String>) -> Result<Vec<String>, String> {
    restore_builtin(&app, name.as_deref())
}

// 창을 만드는 명령은 async — 동기 명령은 메인 스레드에서 돌아 윈도우에서 창 만들기가 멈출 수 있다
#[tauri::command]
pub async fn mode_open(app: tauri::AppHandle, name: String, place: Option<String>, dash: Option<String>) -> Result<String, String> {
    open(&app, &name, place.as_deref(), dash.as_deref(), "desktop")
}

#[tauri::command]
pub async fn mode_close(app: tauri::AppHandle, name: String) -> Result<(), String> {
    close(&app, &name, "desktop")
}

#[tauri::command]
pub async fn mode_restart(app: tauri::AppHandle, name: String) -> Result<String, String> {
    restart(&app, &name)
}

#[tauri::command]
pub async fn mode_top(app: tauri::AppHandle, name: String, on: bool) -> Result<String, String> {
    set_top(&app, &name, on)
}

/// 호스트가 없으면 — 띄우는 중이면 기다림, 재웠으면 깨움, 그 밖엔 까닭 한 줄로 '멈췄어 · 다시 켜기'(modes::missing).
/// 예전엔 까닭 없이 기본값을 줘 화면이 '켜는 중'으로 영원히 돌았다(10/13)
#[tauri::command]
pub fn mode_state(app: tauri::AppHandle, name: String) -> HostState {
    if let Some(h) = host(&name) {
        return h.st.lock().unwrap().clone();
    }
    let on = saved().get(&name).is_some_and(|x| x.on);
    let is_starting = starting().lock().unwrap().contains(&name);
    let is_asleep = asleep().lock().unwrap().contains(&name);
    match modes::missing(is_starting, is_asleep, on) {
        modes::Missing::Starting => HostState::default(),
        modes::Missing::Wake => {
            asleep().lock().unwrap().remove(&name);
            if let Some(info) = list_all().into_iter().find(|m| m.name == name) {
                ensure_host(&app, info);
            }
            HostState::default()
        }
        modes::Missing::Stopped(why) => {
            let error = if why == "off" { tr("모드가 꺼져 있어", "The mode is off") } else { tr("호스트가 없어 — 다시 켜 줘", "No host — restart it") };
            HostState { error: Some(error.to_string()), log: modes::run_dir(crate::config::data_dir(), &name).join("host.log").to_string_lossy().into_owned(), ..Default::default() }
        }
    }
}

/// 한 칸 그리기 → {tree, …}. 칸 크기는 글자 칸 단위(화면이 잰다). 큰 칸(Pane)이면 고르기 카드 그림으로 남긴다(30초에 한 번)
#[tauri::command]
pub async fn mode_render(name: String, component: String, instance: String, columns: u32, rows: u32) -> Result<Value, String> {
    let h = host(&name).ok_or("not running")?;
    if !matches!(component.as_str(), "Pane" | "AbovePrompt") {
        return Err("component".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let r = h.call(modes::render_req(&component, &instance, columns, rows), Duration::from_secs(10))?;
        if component == "Pane" {
            remember_card(&name, &r);
        }
        Ok(r)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 고르기 카드 그림 — chammo.json card 가 먼저, 없으면 마지막으로 그려진 칸, 없으면 null(자리표시)
#[tauri::command]
pub async fn mode_card(name: String) -> Value {
    tauri::async_runtime::spawn_blocking(move || card(&name)).await.unwrap_or(Value::Null)
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

/// 메뉴 묶음 — (내가 만든 것: folder·added·plugin, 참모 모드: 앱이 주는 예시). 순서는 목록 그대로, 숨긴 것은 뺀다
pub fn menu_groups(rows: Vec<ModeRow>) -> (Vec<ModeRow>, Vec<ModeRow>) {
    rows.into_iter().filter(|r| !r.hidden).partition(|r| r.info.source != "example")
}

/// 메뉴바 '모드' — 판이 모드를 못 그리면 None(메뉴를 뺀다)
pub fn menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Option<tauri::menu::Submenu<R>>> {
    if too_old().is_some() {
        return Ok(None);
    }
    use tauri::menu::{CheckMenuItem, MenuItem, SubmenuBuilder};
    let mut m = SubmenuBuilder::new(app, tr("모드", "Modes"));
    let item = |r: &ModeRow| -> tauri::Result<tauri::menu::Submenu<R>> {
        let title = if r.on { format!("{} ✓ {}", r.info.title, place_word(&r.place)) } else { r.info.title.clone() };
        let n = &r.info.name;
        let mut sub = SubmenuBuilder::new(app, title);
        for p in modes::PLACES {
            sub = sub.item(&CheckMenuItem::with_id(app, format!("mode_open:{p}:{n}"), place_menu(p), true, r.on && r.place == *p, None::<&str>)?);
        }
        let (top, can) = top_item(r);
        sub.separator()
            .item(&CheckMenuItem::with_id(app, format!("mode_top:{n}"), tr("항상 위", "Always on Top"), can, top, None::<&str>)?)
            .item(&MenuItem::with_id(app, format!("mode_close:{n}"), tr("끄기", "Turn off"), r.on, None::<&str>)?)
            .build()
    };
    // 내가 만든 모드가 위, 앱이 주는 모드(예시)는 '참모 모드' 묶음 하나로 — 섞이지 않게 구분선(10/12 사용자)
    let (own, ours) = menu_groups(rows());
    for r in &own {
        m = m.item(&item(r)?);
    }
    if !ours.is_empty() {
        if !own.is_empty() {
            m = m.separator();
        }
        let mut g = SubmenuBuilder::new(app, tr("참모 모드", "Chammo Modes"));
        for r in &ours {
            g = g.item(&item(r)?);
        }
        m = m.item(&g.build()?);
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
                if let Err(e) = open(&app, &name, Some(&place), None, "menu") {
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
        let _ = close(app, name, "menu");
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

/// 참모 scripts/app mode list|open|close|add|top|remove|restore-builtin → 답 글
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
                    format!("{}\t{}\t{}\t{}{}", r.info.name, r.info.title, r.info.source, st, if r.hidden { " · hidden (restore-builtin)" } else { "" })
                })
                .collect();
            let n = running().len();
            out.push(format!("running hosts: {n} (≈240MB each)"));
            out.join("\n")
        }
        "open" => match open(app, name, place, req.dash.as_deref(), "appctl") {
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
        "remove" => match remove(app, name, req.trash) {
            Ok(r) if r.kind == "hidden" => format!("ok: {name} hidden — scripts/app mode restore-builtin {name} shows it again"),
            Ok(r) => match r.trashed {
                Some(t) => format!("ok: {name} removed — registration and app data gone, source folder in the Trash: {t}"),
                None => format!("ok: {name} removed — registration and app data gone, source folder left as is (scripts/app mode add <folder> brings it back)"),
            },
            Err(e) => format!("error: {e}"),
        },
        "restore-builtin" => match restore_builtin(app, (!name.is_empty()).then_some(name)) {
            Ok(v) if v.is_empty() => "ok: no hidden built-in modes".into(),
            Ok(v) => format!("ok: shown again — {}", v.join(", ")),
            Err(e) => format!("error: {e}"),
        },
        "close" => match close(app, name, "appctl") {
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
    fn 셋을_동시에_켜도_기억이_서로_안_덮인다() {
        // '셋 다 켜 보기'가 mode_open 셋을 한꺼번에 쏜다 — 읽고·고치고·쓰기가 겹치면 마지막 하나만 남았다(2026-10-12)
        let dir = std::env::temp_dir().join(format!("modes-race-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = Arc::new(dir.join("modes.json"));
        let names = ["mode-a", "mode-b", "mode-c"];
        for round in 0..60 {
            let _ = std::fs::remove_file(&*f);
            let gate = Arc::new(std::sync::Barrier::new(names.len()));
            let ts: Vec<_> = names
                .iter()
                .map(|n| {
                    let (f, gate, n) = (f.clone(), gate.clone(), n.to_string());
                    std::thread::spawn(move || {
                        gate.wait();
                        edit_saved_at(&f, "test", |s| {
                            s.insert(n, Saved { on: true, place: "dash".into(), dash: Some("demo".into()), top: false });
                        });
                    })
                })
                .collect();
            ts.into_iter().for_each(|t| t.join().unwrap());
            let s = saved_at(&f);
            let on: Vec<_> = names.iter().filter(|n| s.get(**n).is_some_and(|x| x.on)).collect();
            assert_eq!(on.len(), names.len(), "{round}번째에 켜진 것: {on:?}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 카드_그림은_모드마다_30초에_한_번_막힌_건_뒤늦게() {
        let t0 = std::time::Instant::now();
        assert_eq!(modes::card_wait(None, t0, CARD_EVERY), None, "처음은 바로");
        assert_eq!(modes::card_wait(Some(t0), t0 + Duration::from_secs(29), CARD_EVERY), Some(Duration::from_secs(1)), "막힌 건 버리지 않고 1초 뒤");
        assert_eq!(modes::card_wait(Some(t0), t0 + CARD_EVERY, CARD_EVERY), None);
    }

    #[test]
    fn 호스트_메모리는_ps_답에서_pid_별_kb() {
        let m = parse_rss("  4242 246000\n 77  1024\nbad line\n 9 x\n");
        assert_eq!(m.get(&4242), Some(&246000));
        assert_eq!(m.get(&77), Some(&1024));
        assert_eq!(m.len(), 2);
        assert!(parse_rss("").is_empty());
    }

    #[test]
    fn 폰_상태엔_로그_자리_pid_가_없다() {
        let st = HostState { alive: true, ready: true, log: "/Users/me/.chammo/modes/x.log".into(), pid: 4242, panes: vec![json!({"id": "main", "title": "달력", "extra": 1})], ..Default::default() };
        let v = phone_state(&st);
        let s = v.to_string();
        assert!(!s.contains("x.log") && !s.contains("4242"), "{s}");
        assert_eq!(v["panes"], json!([{"id": "main", "title": "달력"}]));
        assert_eq!(v["ready"], true);
    }

    #[test]
    fn 메뉴는_내가_만든_것과_참모_모드를_나눈다() {
        let row = |name: &str, source: &'static str| ModeRow { info: ModeInfo { name: name.into(), title: name.into(), source, dir: "/x".into(), where_default: "window".into(), keep_alive: true }, on: false, place: "window".into(), alive: false, pid: 0, dash: None, top: false, hidden: false };
        let gone = |name: &str, source: &'static str| ModeRow { hidden: true, ..row(name, source) };
        let (own, ours) = menu_groups(vec![row("home-calendar", "example"), row("sales", "added"), row("home-todo", "example"), row("memo", "folder"), row("plug", "plugin"), gone("home-board", "example"), gone("plug2", "plugin")]);
        assert_eq!(own.iter().map(|r| r.info.name.as_str()).collect::<Vec<_>>(), ["sales", "memo", "plug"]);
        assert_eq!(ours.iter().map(|r| r.info.name.as_str()).collect::<Vec<_>>(), ["home-calendar", "home-todo"]);
    }

    #[test]
    fn 폰_이_홈에서_끄기는_그_홈에_켜진_모드만() {
        let on = |place: &str, dash: Option<&str>| Saved { on: true, place: place.into(), dash: dash.map(str::to_string), top: false };
        assert!(phone_close_ok(Some(&on("dash", Some("오렌지"))), "오렌지"));
        assert!(!phone_close_ok(Some(&on("dash", Some("레몬"))), "오렌지"), "다른 참모 홈");
        assert!(!phone_close_ok(Some(&on("window", None)), "오렌지"), "따로 창");
        assert!(!phone_close_ok(Some(&Saved { on: false, ..on("dash", Some("오렌지")) }), "오렌지"), "이미 꺼짐");
        assert!(!phone_close_ok(None, "오렌지"));
    }

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
        let row = |on: bool, place: &str, top: bool| ModeRow { info: info.clone(), on, place: place.into(), alive: on, pid: 0, dash: None, top, hidden: false };
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

    // 판마다 돌리는 실측 — 진짜 claude 로 맛보기 달력을 띄워 붙고·칸을 열고·그린다(규약이 @internal 이라 판이 바뀌면 여기서 먼저 깨진다).
    // 누르기는 안 한다 — 맛보기 저장($.store)은 진짜 Claude 설정 폴더라 시험이 사용자 데이터를 바꾸면 안 된다(누르기는 키트 실측이 본다)
    // cargo test --bin honor-orchestrator modes_host::tests::진짜_claude -- --ignored --exact 로
    #[test]
    #[ignore]
    fn 진짜_claude_로_맛보기_달력을_띄우면_칸이_열리고_그려진다() {
        let d = std::env::temp_dir().join(format!("chammo-modehost-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let dir = modes::write_example(&d, "home-calendar").unwrap();
        let info = modes::discover(&d, &Value::Null).into_iter().find(|m| m.name == "home-calendar").unwrap();
        let h = start(&info, &dir, &modes::run_dir(&d, "home-calendar"), Arc::new(|_: &str, _: Value| {}));
        let st = h.st.lock().unwrap().clone();
        assert!(st.ready && !st.unsupported, "{st:?}");
        assert_eq!(st.panes[0]["id"], "calendar");
        let r = h.call(modes::render_req("Pane", "calendar", 60, 20), Duration::from_secs(10)).unwrap();
        assert_eq!(r["tree"]["type"], "Box", "{r}");
        stop_host(&h, "test");
        std::thread::sleep(Duration::from_millis(500));
        assert!(!h.st.lock().unwrap().alive, "끄면 프로세스가 끝난다");
        let _ = std::fs::remove_dir_all(&d);
    }

    // 디자인 키트 실측(10/12) — 호스트는 모르는 속성이 하나라도 있으면 트리를 통째로 버리고(engine), 모르는 값은 그 속성만 뺀다.
    // 키트(hq-mode-kit kit.tsx)는 받는 속성만 조합하고 렌더러가 그 조합으로 앱 모양을 고른다 — 판이 바뀌어 받는 목록이 달라지면 여기서 먼저 깨지게.
    // cargo test --bin honor-orchestrator modes_host::tests::진짜_claude_로_키트_속성이_그대로_온다 -- --ignored --exact
    #[test]
    #[ignore]
    fn 진짜_claude_로_키트_속성이_그대로_온다() {
        let d = std::env::temp_dir().join(format!("chammo-modekit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let dir = d.join("kitp");
        let ok = "<Box flexDirection=\"column\"><Text backgroundColor=\"success\" color=\"inverseText\" bold> 3 </Text><Box borderStyle=\"round\" borderDimColor paddingX={1}><Text dimColor wrap=\"truncate\">{'─'.repeat(10)}</Text></Box><Box flexDirection=\"row\" flexWrap=\"wrap\"><Box width=\"14%\" /></Box></Box>";
        let bad = "<Box variant=\"chip\"><Text>x</Text></Box>";
        for (rel, body) in [
            (".claude-plugin/plugin.json", r#"{ "name": "kitp", "version": "0.1.0" }"#.to_string()),
            ("hooks/hooks.json", r#"{ "modules": ["./register.tsx"] }"#.to_string()),
            ("hooks/register.tsx", format!("import type {{ Register }} from 'claude-code'\nexport const register: Register = on => {{\n  on('session.start', async ($, e, next) => {{ void $.ui.open({{ id: 'ok', title: 'K' }}); void $.ui.open({{ id: 'bad', title: 'B' }}); return next(e) }})\n  on('ui.render', {{ component: 'Pane', requestId: 'ok' }}, async ($, e) => {{ const {{ Box, Text }} = $.ui.resolve(e); return {ok} }})\n  on('ui.render', {{ component: 'Pane', requestId: 'bad' }}, async ($, e) => {{ const {{ Box, Text }} = $.ui.resolve(e); return {bad} }})\n}}\n")),
        ] {
            let p = dir.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        let info = ModeInfo { name: "kitp".into(), title: "K".into(), source: "folder", dir: dir.to_string_lossy().into_owned(), where_default: "window".into(), keep_alive: true };
        let h = start(&info, &dir, &modes::run_dir(&d, "kitp"), Arc::new(|_: &str, _: Value| {}));
        assert!(h.st.lock().unwrap().ready, "{:?}", h.st.lock().unwrap());
        let r = h.call(modes::render_req("Pane", "ok", 80, 20), Duration::from_secs(10)).unwrap();
        let kids = &r["tree"]["children"];
        assert_eq!(kids[0]["props"]["backgroundColor"], "success", "{r}");
        assert_eq!((kids[1]["props"]["borderStyle"].as_str(), kids[1]["props"]["borderDimColor"].as_bool()), (Some("round"), Some(true)), "{r}");
        assert_eq!(kids[2]["children"][0]["props"]["width"], "14%", "{r}");
        let r = h.call(modes::render_req("Pane", "bad", 80, 20), Duration::from_secs(10)).unwrap();
        assert_eq!(r["tree"]["type"], "engine", "모르는 속성(variant)은 트리째 거절 — 이게 바뀌면 키트 방식을 다시 볼 것: {r}");
        stop_host(&h, "test");
        let _ = std::fs::remove_dir_all(&d);
    }

    // 키트 속성 가르기(손으로) — CHAMMO_KIT_PROBE 파일의 줄마다 JSX 하나를 Pane 으로 그려 트리를 찍는다
    #[test]
    #[ignore]
    fn 키트_속성_가르기() {
        let Ok(list) = std::env::var("CHAMMO_KIT_PROBE") else { return };
        let jsxs: Vec<String> = std::fs::read_to_string(list).unwrap().lines().filter(|l| !l.trim().is_empty()).map(str::to_string).collect();
        let d = std::env::temp_dir().join(format!("chammo-kitprobe-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let dir = d.join("kprobe");
        let mut reg = String::from("import type { Register } from 'claude-code'\nexport const register: Register = on => {\n  on('session.start', async ($, e, next) => {\n");
        for i in 0..jsxs.len() { reg.push_str(&format!("    void $.ui.open({{ id: 'p{i}', title: 'P' }})\n")); }
        reg.push_str("    return next(e)\n  })\n");
        for (i, j) in jsxs.iter().enumerate() {
            reg.push_str(&format!("  on('ui.render', {{ component: 'Pane', requestId: 'p{i}' }}, async ($, e) => {{\n    const {{ Box, Text }} = $.ui.resolve(e)\n    return {j}\n  }})\n"));
        }
        reg.push_str("}\n");
        for (rel, body) in [(".claude-plugin/plugin.json", r#"{ "name": "kprobe", "version": "0.1.0" }"#.to_string()), ("hooks/hooks.json", r#"{ "modules": ["./register.tsx"] }"#.to_string()), ("hooks/register.tsx", reg)] {
            let p = dir.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        let info = ModeInfo { name: "kprobe".into(), title: "P".into(), source: "folder", dir: dir.to_string_lossy().into_owned(), where_default: "window".into(), keep_alive: true };
        let h = start(&info, &dir, &modes::run_dir(&d, "kprobe"), Arc::new(|_: &str, _: Value| {}));
        for (i, j) in jsxs.iter().enumerate() {
            let r = h.call(modes::render_req("Pane", &format!("p{i}"), 80, 20), Duration::from_secs(10));
            println!("PROBE {j}\n  => {}", r.map(|v| v["tree"].to_string()).unwrap_or_else(|e| format!("ERR {e}")));
        }
        println!("LOG {}", h.st.lock().unwrap().log);
        stop_host(&h, "test");
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
        stop_host(&h, "test");
        let _ = std::fs::remove_dir_all(&d);
    }
}
