//! Craft 맥 앱 칸(2026-10-16 사용자) — 가짜 화면에 띄운 Craft 맥 앱을 Chammo 안에 비춘다. 기본 자리는 메인 창 스페이스 탭(space:<앱>),
//! 머리줄 아이콘으로 따로 창(craft-<앱>: craft.html, 머리줄 ①·아래 줄은 웹)과 오간다 — 비추기는 한 곳만(craft_mirror, CALayer).
//! 참모 쪽: scripts/craft open <앱> --native 가 앱을 띄운 뒤 app.jsonl {"action":"craft","arg":{"verb":"open","app":…}} 로 알린다.
//! 사람 입력은 잠금이 기본 — 머리줄 개입이면 조작 채널로 넘기고(craft_input), 돌려주면 바뀐 것 한 줄을 참모 입력칸에.
//! 창의 빨간 단추는 비추기만 떼고(앱은 그대로), 머리줄의 닫기·꺼내기는 scripts/craft close|eject(닫기 = 묻지 않고 저장 후 닫기).
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::{Manager, Runtime};

/// 저장소 이름 → 보이는 이름(scripts/craft APPS 와 같은 13개)
pub const APPS: [(&str, &str); 13] = [
    ("photocraft", "PhotoCraft"), ("lightcraft", "LightCraft"), ("filmcraft", "FilmCraft"), ("effectcraft", "EffectCraft"),
    ("vectorcraft", "VectorCraft"), ("designcraft", "DesignCraft"), ("pdfcraft", "PdfCraft"), ("wordcraft", "WordCraft"),
    ("gridcraft", "GridCraft"), ("deckcraft", "DeckCraft"), ("figcraft", "FigCraft"), ("cadcraft", "CADCraft"), ("soundcraft", "SoundCraft"),
];
const PREFIX: &str = "craft-";
/// 머리줄 ①·아래 줄 높이(craft.css 와 같게) — 비추기는 그 사이
pub const TOP: f64 = 40.0;
pub const BOTTOM: f64 = 28.0;

pub fn display_name(app: &str) -> Option<&'static str> {
    let a = base(app)?;
    APPS.iter().find(|(k, _)| *k == a).map(|(_, n)| *n)
}

/// 한 앱에 띄우는 수(scripts/craft MAX_INSTANCES 와 같게) — 세션마다 따로(2026-10-20 사용자)
pub const MAX_INSTANCES: u32 = 3;

/// 인스턴스 키 → 앱. 첫 번째는 앱 이름 그대로('photocraft'), 2·3번째는 '<앱>-2'·'<앱>-3'. 그 밖은 None
pub fn base(key: &str) -> Option<&'static str> {
    if let Some((k, _)) = APPS.iter().find(|(k, _)| *k == key) {
        return Some(k);
    }
    let (a, n) = key.rsplit_once('-')?;
    let no: u32 = n.parse().ok()?;
    ((2..=MAX_INSTANCES).contains(&no) && no.to_string() == n).then(|| APPS.iter().find(|(k, _)| *k == a).map(|(k, _)| *k)).flatten()
}

/// 앱마다 모든 인스턴스 키 — 떠 있는 것 찾기(상태 파일 <키>.json)
pub fn keys() -> Vec<String> {
    APPS.iter().flat_map(|(k, _)| (1..=MAX_INSTANCES).map(move |n| if n == 1 { k.to_string() } else { format!("{k}-{n}") })).collect()
}

/// scripts/craft 에 넘길 이름 — 그 인스턴스만(첫 번째는 '<앱>-1': 이름만 주면 스크립트가 '부른 세션 것'을 고른다)
pub fn arg(key: &str) -> String {
    if APPS.iter().any(|(k, _)| *k == key) { format!("{key}-1") } else { key.to_string() }
}

pub fn label(app: &str) -> String {
    format!("{PREFIX}{app}")
}

pub fn is_craft_window(label: &str) -> bool {
    label.strip_prefix(PREFIX).is_some_and(|a| display_name(a).is_some())
}

#[derive(Debug, PartialEq, Eq)]
pub struct Req {
    pub id: String,
    pub verb: String,
    pub app: String,
    /// point — 참모 손이 갈 자리(앱 손쉬운 사용 이름, "@canvas" = 캔버스)와 짧은 글
    pub names: Vec<String>,
    pub label: String,
    /// point — 손이 머무는 초(긴 명령: 내보내기·렌더). 0 이면 보통 손(1.6초 뒤 사라짐), 900 까지
    pub hold: u32,
    /// 띄운 세션 id(scripts/craft 가 CLAUDE_JOB_DIR 끝에서) — 그 세션을 맡긴 참모 탭에 칸을 둔다. 모르면 빈 글
    pub by: String,
}

/// app.jsonl 한 줄 → 창 열기·닫기 요청. 앱 이름은 13개 중 하나만
pub fn request(line: &str) -> Option<Req> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("action")?.as_str()? != "craft" {
        return None;
    }
    let id = v.get("id").and_then(|i| i.as_str()).unwrap_or("");
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') || id.len() > 64 {
        return None;
    }
    let verb = v["arg"]["verb"].as_str()?;
    let app = v["arg"]["app"].as_str()?;
    if !matches!(verb, "open" | "window" | "close" | "screen" | "point") || display_name(app).is_none() {
        return None;
    }
    // 손 자리 이름은 8개·각 80자까지, 글은 60자까지(앱 화면에 그리는 글 — 제어 문자 없이)
    let clean = |t: &str, n: usize| -> Option<String> { (t.chars().count() <= n && !t.chars().any(char::is_control)).then(|| t.to_string()) };
    let names: Vec<String> = match v["arg"]["names"].as_array() {
        Some(a) if a.len() <= 8 => a.iter().map(|x| x.as_str().and_then(|t| clean(t, 80))).collect::<Option<_>>()?,
        Some(_) => return None,
        None => vec![],
    };
    let label = clean(v["arg"]["label"].as_str().unwrap_or(""), 60)?;
    if verb == "point" && names.is_empty() {
        return None;
    }
    let by = v["arg"]["by"].as_str().filter(|b| b.len() <= 64 && b.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).unwrap_or("");
    let hold = v["arg"]["hold"].as_u64().map_or(0, |h| h.min(900) as u32);
    Some(Req { id: id.into(), verb: verb.into(), app: app.into(), names, label, hold, by: by.into() })
}

/// 머리줄이 보이는 것 — scripts/craft 가 남긴 상태(<데이터>/craft-native/<앱>.json)와 마지막 일(<앱>.status.json)
#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub name: String,
    pub version: String,
    pub pid: Option<i32>,
    /// 마지막으로 참모가 한 일(사람 말) — 아래 줄
    pub last: String,
    /// 저장 안 한 바뀐 게 있나 — 머리줄 '저장 안 됨', 닫을 때 묻기
    pub dirty: bool,
    /// 비추기 상태: waiting|live|no-permission|no-window|stopped|not-built
    pub mirror: String,
    /// 사람이 조작 중(개입) — 머리줄 '돌려주기', 아래 줄 파란색
    pub takeover: bool,
    /// 지금 비추는 자리 — "window"(따로 창)·"space"(스페이스 탭)·""(없음). 비추기는 한 곳만
    pub place: String,
    /// 이 인스턴스를 띄운 세션 id(scripts/craft 상태 by) — 칸 이름에 그 세션 별명, 돌려받음 [앱] 줄도 그 세션에. 사람이 연 것은 빈 글
    pub by: String,
}

pub fn read_info(data_dir: &Path, app: &str) -> Info {
    let read = |name: String| std::fs::read_to_string(data_dir.join("craft-native").join(name)).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    let st = read(format!("{app}.json")).unwrap_or_default();
    let ss = read(format!("{app}.status.json")).unwrap_or_default();
    Info {
        // 앱 이름은 scripts/craft 표(NATIVE)가 상태 파일에 적은 것 — 우리가 빌드한 판으로 갈아끼워도 여긴 안 바뀐다
        name: st["name"].as_str().or(display_name(app)).unwrap_or(app).to_string(),
        version: st["version"].as_str().unwrap_or("").to_string(),
        pid: st["pid"].as_i64().map(|p| p as i32),
        last: ss["last"].as_str().unwrap_or("").to_string(),
        dirty: ss["dirty"].as_bool().unwrap_or(false),
        mirror: String::new(),
        place: String::new(),
        takeover: read(format!("{app}.takeover.json")).is_some_and(|t| t["on"].as_bool() == Some(true)),
        by: st["by"].as_str().unwrap_or("").to_string(),
    }
}

/// 머리줄 단추 → scripts/craft 의 명령. 아는 것만
pub fn act_args(app: &str, act: &str) -> Option<Vec<String>> {
    display_name(app)?;
    matches!(act, "close" | "eject").then(|| vec![act.to_string(), arg(app)])
}

fn mirror_name(s: crate::craft_mirror::Status) -> &'static str {
    use crate::craft_mirror::Status::*;
    match s {
        Waiting => "waiting",
        Live => "live",
        NoPermission => "no-permission",
        NoWindow => "no-window",
        Stopped => "stopped",
    }
}

/// 따로 창 기본 크기(논리 점) — 그 화면의 85%, 최소 1280x800, 화면보다 크게는 안(10/16 사용자 "비좁아터졌다": 보는 칸 = 앱 창 크기)
pub fn default_size(screen_w: f64, screen_h: f64) -> (f64, f64) {
    let w = (screen_w * 0.85).max(1280.0).min(screen_w);
    let h = (screen_h * 0.85).max(800.0).min(screen_h);
    (w.round(), h.round())
}

/// 비추는 자리 → 비추기 손잡이(Swift Mirror 포인터). 자리 = 따로 창 label(craft-<앱>) 또는 스페이스 탭(space:<앱>)
static HANDLES: Mutex<Option<HashMap<String, usize>>> = Mutex::new(None);

fn handles<T>(f: impl FnOnce(&mut HashMap<String, usize>) -> T) -> T {
    let mut g = HANDLES.lock().unwrap();
    f(g.get_or_insert_with(HashMap::new))
}

pub fn space_key(app: &str) -> String {
    format!("space:{app}")
}

/// 그 앱을 지금 비추는 손잡이와 자리 — 따로 창이 먼저(둘이 같이 있을 일은 없다: 옮길 때 앞 것을 뗀다)
fn mirror_of(app: &str) -> Option<(usize, &'static str)> {
    handles(|m| m.get(&label(app)).map(|h| (*h, "window")).or_else(|| m.get(&space_key(app)).map(|h| (*h, "space"))))
}

/// 스페이스 탭 칸 자리(웹뷰 왼쪽 위 기준 CSS 점)와 보이는지 — 웹이 탭을 띄울 때·크기·스크롤·모달마다 알려 준다.
/// 따로 창에 떠 있으면 여기엔 안 얹고 "window" 를 돌려준다(탭은 '따로 창에 있어' 안내)
#[tauri::command]
pub fn craft_space_place<R: Runtime>(handle: tauri::AppHandle<R>, app: String, rect: [f64; 4], vh: f64, visible: bool) -> Result<String, String> {
    display_name(&app).ok_or("unknown app")?;
    if handle.get_webview_window(&label(&app)).is_some() {
        return Ok("window".into());
    }
    let pid = read_info(crate::config::data_dir(), &app).pid.ok_or("not open")?;
    let main = handle.get_webview_window("main").ok_or("no main window")?;
    #[cfg(not(target_os = "macos"))]
    let _ = (main, pid, rect, vh, visible);
    #[cfg(target_os = "macos")]
    let key = space_key(&app);
    #[cfg(target_os = "macos")]
    let m2 = main.clone();
    #[cfg(target_os = "macos")]
    let _ = main.run_on_main_thread(move || {
        let found = handles(|m| m.get(&key).copied());
        let h = match found {
            Some(h) => h,
            None => {
                let Ok(ns) = m2.ns_window() else { return };
                let Some(h) = crate::craft_mirror::attach(ns as usize, pid, 0.0, 0.0) else { return };
                handles(|m| m.insert(key.clone(), h.0));
                h.0
            }
        };
        crate::craft_mirror::place(&crate::craft_mirror::Handle(h), rect, vh, visible);
    });
    Ok("space".into())
}

/// JPEG 바이트 → data URL(빈 바이트면 빈 글 — 웹은 그림 없이 둔다)
pub fn jpeg_url(bytes: &[u8]) -> String {
    use base64::Engine;
    if bytes.is_empty() {
        return String::new();
    }
    format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// 스페이스 탭 칸의 마지막 프레임 — 팝오버가 칸을 덮어 비추기가 숨을 때 웹이 그 자리에 그림으로 깐다(검은 칸 대신, 2026-10-19 실사용)
#[tauri::command]
pub fn craft_space_still<R: Runtime>(handle: tauri::AppHandle<R>, app: String) -> Result<String, String> {
    display_name(&app).ok_or("unknown app")?;
    let Some(h) = handles(|m| m.get(&space_key(&app)).copied()) else { return Ok(String::new()) };
    let path = crate::config::data_file("craft-native").join(format!("{app}-still.jpg"));
    let _ = std::fs::remove_file(&path);
    let (tx, rx) = std::sync::mpsc::channel();
    let p2 = path.clone();
    handle
        .run_on_main_thread(move || {
            let _ = tx.send(crate::craft_mirror::still(&crate::craft_mirror::Handle(h), &p2));
        })
        .map_err(|e| e.to_string())?;
    if !rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap_or(false) {
        return Ok(String::new());
    }
    Ok(jpeg_url(&std::fs::read(&path).unwrap_or_default()))
}

/// 스페이스 탭이 닫혔다·내려갔다 — 비추기를 뗀다(앱은 그대로, 다시 열면 다시 붙는다)
#[tauri::command]
pub fn craft_space_detach<R: Runtime>(handle: tauri::AppHandle<R>, app: String) {
    space_detach(&handle, &app);
}

fn space_detach<R: Runtime>(handle: &tauri::AppHandle<R>, app: &str) {
    if let Some(h) = handles(|m| m.remove(&space_key(app))) {
        let _ = handle.run_on_main_thread(move || crate::craft_mirror::detach(crate::craft_mirror::Handle(h)));
        // 탭이 내려가거나 사라지면(참모 바꾸기·스페이스 닫기) 개입은 자동으로 돌려준다 — 입력을 받을 칸이 없다
        if taking_over(crate::config::data_dir(), app) {
            handback(handle, app);
        }
    }
}

/// 자리 옮기기(머리줄 아이콘 하나) — "window": 스페이스에서 떼고 따로 창으로 / "space": 따로 창을 닫고 메인 창 스페이스 탭으로.
/// 비추기는 한 곳만 — 옮기기 전에 앞 자리를 뗀다
#[tauri::command]
pub fn craft_move<R: Runtime>(handle: tauri::AppHandle<R>, app: String, to: String) -> Result<String, String> {
    display_name(&app).ok_or("unknown app")?;
    match to.as_str() {
        "window" => {
            space_detach(&handle, &app);
            let r = open(&handle, &app)?;
            to_main(&handle, "__craftSpace", serde_json::json!({ "app": app, "place": "window" }));
            Ok(r)
        }
        "space" => {
            close(&handle, &app)?;
            show_in_space(&handle, &app, "")
        }
        _ => Err("unknown place".into()),
    }
}

/// 기본 자리 = 스페이스 탭 — 메인 창에 그 앱 탭을 열라고 알린다(탭이 칸 자리를 알려 주면 craft_space_place 가 붙인다)
/// 메인 창 웹에 알리기 — 이 앱은 capabilities 가 없어 웹의 이벤트 listen 이 막혀 있다. appctl 처럼 window.<이름>(json) 을 eval 로
pub(crate) fn to_main<R: Runtime>(handle: &tauri::AppHandle<R>, func: &str, payload: serde_json::Value) {
    if let Some(w) = handle.get_webview_window("main") {
        let _ = w.eval(format!("window.{func} && window.{func}({payload})"));
    }
}

/// 메인 창 스페이스에 그 앱 탭 소식 — "space"(열기)·"hidden"(탭만 닫기, 독 아이콘은 남김)·"closed"(앱 꺼짐)
pub fn tell_space<R: Runtime>(handle: &tauri::AppHandle<R>, app: &str, place: &str) {
    to_main(handle, "__craftSpace", serde_json::json!({ "app": app, "place": place }));
}

pub fn show_in_space<R: Runtime>(handle: &tauri::AppHandle<R>, app: &str, by: &str) -> Result<String, String> {
    crate::craft_dock::unhide(app);
    // 스페이스가 없으면(터미널 뷰) 따로 창으로 — 스페이스는 채팅 뷰에서만 뜬다
    if !crate::reader::chat_view() {
        return open(handle, app);
    }
    let name = read_info(crate::config::data_dir(), app).name;
    to_main(handle, "__craftSpace", serde_json::json!({ "app": app, "name": name, "place": "space", "by": by }));
    Ok("space".into())
}

/// 창을 띄우고(이미 있으면 앞으로) 비추기를 붙인다
pub fn open<R: Runtime>(app: &tauri::AppHandle<R>, key: &str) -> Result<String, String> {
    display_name(key).ok_or("unknown app")?;
    let info = read_info(crate::config::data_dir(), key);
    let name = info.name.clone();
    let pid = info.pid.ok_or_else(|| format!("{name}: {}", crate::i18n::tr("안 띄움 — scripts/craft open <앱> --native 먼저", "not open — run scripts/craft open <app> --native first")))?;
    let lb = label(key);
    if let Some(w) = app.get_webview_window(&lb) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok("shown".into());
    }
    let (sw, sh) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| (m.size().width as f64 / m.scale_factor(), m.size().height as f64 / m.scale_factor()))
        .unwrap_or((1600.0, 1000.0));
    let (ww, wh) = default_size(sw, sh);
    let w = tauri::WebviewWindowBuilder::new(app, &lb, tauri::WebviewUrl::App(format!("craft.html?app={key}").into()))
        .title(format!("{name} — Chammo"))
        .inner_size(ww, wh)
        .min_inner_size(560.0, 360.0 + TOP + BOTTOM)
        .build()
        .map_err(|e| e.to_string())?;
    crate::debug::place_near_main(app, &w);
    attach_later(w, pid);
    Ok("opened".into())
}

#[cfg(target_os = "macos")]
fn attach_later<R: Runtime>(w: tauri::WebviewWindow<R>, pid: i32) {
    let w2 = w.clone();
    let _ = w.run_on_main_thread(move || {
        let Ok(ns) = w2.ns_window() else { return };
        if let Some(h) = crate::craft_mirror::attach(ns as usize, pid, TOP, BOTTOM) {
            handles(|m| m.insert(w2.label().to_string(), h.0));
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn attach_later<R: Runtime>(_w: tauri::WebviewWindow<R>, _pid: i32) {}

/// 창이 닫힌다(빨간 단추·닫기) — 비추기만 뗀다. 앱은 scripts/craft close 가 끈다
pub fn window_closed<R: Runtime>(w: &tauri::Window<R>) {
    let Some(h) = handles(|m| m.remove(w.label())) else { return };
    let _ = w.run_on_main_thread(move || crate::craft_mirror::detach(crate::craft_mirror::Handle(h)));
    // 창만 닫혔고 앱은 살아 있으면 — 개입은 돌려주고 스페이스 탭으로 되돌린다(볼 데가 없어지지 않게). 앱을 끄는 닫기면 2초 뒤엔 상태가 없다
    let Some(app) = w.label().strip_prefix(PREFIX).map(str::to_string) else { return };
    let handle = w.app_handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let d = crate::config::data_dir();
        if read_info(d, &app).pid.is_some_and(crate::platform::pid_alive) && mirror_of(&app).is_none() {
            if taking_over(d, &app) {
                handback(&handle, &app);
            }
            // 독에서 숨긴 거면(탭 X·머리줄 닫기) 그대로 두고, 빨간 단추로 창만 닫은 거면 스페이스 탭으로
            if !crate::craft_dock::is_hidden(&app) {
                let _ = show_in_space(&handle, &app, "");
            }
        }
    });
}

pub fn close<R: Runtime>(app: &tauri::AppHandle<R>, key: &str) -> Result<String, String> {
    match app.get_webview_window(&label(key)) {
        Some(w) => {
            let _ = w.close();
            Ok("closed".into())
        }
        None => Ok("not open".into()),
    }
}

/// 참모 손 — 그 앱 창이 비추는 중이면 그 자리로(안 보는 중이면 Swift 가 그냥 넘긴다)
pub fn point<R: Runtime>(app: &tauri::AppHandle<R>, key: &str, names: &[String], text: &str, hold: u32) -> Result<String, String> {
    let Some((h, _)) = mirror_of(key) else { return Ok("not mirroring".into()) };
    let names = serde_json::to_string(names).map_err(|e| e.to_string())?;
    let text = text.to_string();
    let _ = app.run_on_main_thread(move || crate::craft_mirror::point(&crate::craft_mirror::Handle(h), &names, &text, hold));
    Ok("pointed".into())
}

pub fn answer<R: Runtime>(app: &tauri::AppHandle<R>, req: &Req) -> String {
    let r = match req.verb.as_str() {
        "point" => point(app, &req.app, &req.names, &req.label, req.hold),
        // 기본 자리는 스페이스 탭, "window" 는 따로 창(머리줄 옮기기와 같은 길)
        "open" => show_in_space(app, &req.app, &req.by),
        "window" => open(app, &req.app),
        // 띄우기 전에 레티나 화면부터 — 답은 자리(scripts/craft 는 screen.json 을 본다)
        "screen" => crate::craft_screen::ensure().map(|r| format!("screen {} {} {} {}", r.x, r.y, r.w, r.h)),
        _ => {
            // 끄기 — 어디에 비추든 떼고 탭도 닫게
            space_detach(app, &req.app);
            to_main(app, "__craftSpace", serde_json::json!({ "app": req.app, "place": "closed" }));
            close(app, &req.app)
        }
    };
    r.unwrap_or_else(|e| format!("error: {e}"))
}

#[tauri::command]
pub fn craft_win_info(app: String) -> Result<Info, String> {
    display_name(&app).ok_or("unknown app")?;
    let mut info = read_info(crate::config::data_dir(), &app);
    info.mirror = if !crate::craft_mirror::LINKED {
        "not-built".into()
    } else {
        match mirror_of(&app) {
            Some((h, _)) => mirror_name(crate::craft_mirror::status(&crate::craft_mirror::Handle(h))).into(),
            None => "stopped".into(),
        }
    };
    info.place = mirror_of(&app).map(|(_, p)| p.to_string()).unwrap_or_default();
    Ok(info)
}

/// 앱을 띄운 쪽(터미널의 Claude 세션·설치 스크립트)의 세션 표시 — 앱이 물려받으면 사람이 서랍에서 연 Craft 도 scripts/craft 가 그 세션 것(by)으로 적어
/// 돌려받음 [앱] 줄이 엉뚱한 세션에 갔다(2026-10-20, 설치 스크립트는 feaccfe1). 다른 길로 켜도 안전하게 앱이 켜질 때 지운다.
/// 메시지 소켓·토큰까지 — 물려받으면 앱이 띄운 것이 그 세션 이름으로 말할 수 있다(10/21 QA)
pub const SESSION_ENV: [&str; 7] = [
    "CLAUDE_JOB_DIR",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_BRIDGE_SESSION_ID",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDECODE",
];

/// 스레드가 생기기 전에(main 맨 앞) 부른다
pub fn drop_session_env() {
    for k in SESSION_ENV {
        std::env::remove_var(k);
    }
}

pub fn script() -> std::path::PathBuf {
    let hq = crate::config::hq_dir(&crate::config::home(), &crate::config::current(), |k| std::env::var(k).ok());
    Path::new(&hq).join("scripts").join("craft")
}

/// 개입(사람이 직접)·돌려주기 — 비추기 칸 입력을 그 앱에 넘기거나 막고, scripts/craft takeover 가 문서 상태를 떠 둔다.
/// 돌려주면 바뀐 것 한 줄을 메인 창에 'craft-handback' 으로 알린다(참모 입력칸에 [앱] 줄 — 화면엔 안 띄움)
#[tauri::command]
pub fn craft_win_takeover<R: Runtime>(handle: tauri::AppHandle<R>, app: String, on: bool) -> Result<(), String> {
    display_name(&app).ok_or("unknown app")?;
    if let Some((h, _)) = mirror_of(&app) {
        let key = app.clone();
        let _ = handle.run_on_main_thread(move || crate::craft_mirror::set_input(&crate::craft_mirror::Handle(h), on, &key));
    }
    if on {
        let script = script();
        std::thread::spawn(move || {
            let _ = crate::platform::command(&script).args(["takeover", &arg(&app), "on"]).output();
        });
    } else {
        handback(&handle, &app);
    }
    Ok(())
}

/// 개입 중인가 — scripts/craft 의 잠금 파일
pub fn taking_over(data_dir: &Path, app: &str) -> bool {
    read_info(data_dir, app).takeover
}

/// 돌려주는 중인 앱 — takeover off 가 도는 동안엔 잠금이 남아 다른 길(탭 내려감·창 닫힘)도 '개입 중'으로 보고 또 돌려줬다(10/19 알림 두 번)
static HANDING_BACK: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// 이 앱 돌려주기를 시작해도 되나 — 이미 도는 중이면 false
fn begin_handback(app: &str) -> bool {
    let Ok(mut g) = HANDING_BACK.lock() else { return true };
    if g.iter().any(|a| a == app) {
        return false;
    }
    g.push(app.to_string());
    true
}

fn end_handback(app: &str) {
    if let Ok(mut g) = HANDING_BACK.lock() {
        g.retain(|a| a != app);
    }
}

/// 돌려주기 — scripts/craft takeover off(문서 차이 한 줄) → 참모 입력칸 [앱] 줄. 탭이 사라지는 길(참모 바꾸기·스페이스 닫기·창 닫기·재시작)에서도
/// 개입 중이면 이걸로 자동으로 돌려준다 — 안 하면 잠금이 남아 참모 명령이 계속 막힌다(10/16 실사용)
fn handback<R: Runtime>(handle: &tauri::AppHandle<R>, app: &str) {
    if !begin_handback(app) {
        return;
    }
    let (handle, app) = (handle.clone(), app.to_string());
    let name = read_info(crate::config::data_dir(), &app).name;
    // 이 인스턴스를 띄운 세션(scripts/craft 가 상태 파일 by 에 적는다) — 없으면 웹이 대표 참모에게
    let by = read_info(crate::config::data_dir(), &app).by;
    let script = script();
    std::thread::spawn(move || {
        let out = crate::platform::command(&script).args(["takeover", &arg(&app), "off"]).output();
        let text = out.ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
        end_handback(&app);
        to_main(&handle, "__craftHandback", serde_json::json!({ "app": app, "name": name, "text": text, "by": by }));
    });
}

/// 앱을 켤 때 — 떠 있는 Craft 앱(가짜 화면에 띄운 것)을 스페이스 탭에 다시 붙이고, 남은 개입 잠금은 돌려준다(탭은 메모리에만 있어 재시작하면 사라진다)
pub fn restore_on_start<R: Runtime>(handle: &tauri::AppHandle<R>) {
    let handle = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(8)); // 메인 창 웹이 뜰 때까지
        let d = crate::config::data_dir();
        for app in crate::craft_screen::running(d, crate::platform::pid_alive) {
            let app = app.as_str();
            if taking_over(d, app) {
                handback(&handle, app);
            }
            let here = std::fs::read_to_string(d.join("craft-native").join(format!("{app}.json"))).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()).is_some_and(|v| v["here"].as_bool() == Some(true));
            if !here {
                let _ = show_in_space(&handle, app, "");
            }
        }
    });
}

/// 머리줄 닫기·꺼내기 — scripts/craft 를 뒤에서 부르고, 닫기면 창도 닫는다
#[tauri::command]
pub fn craft_win_act<R: Runtime>(handle: tauri::AppHandle<R>, app: String, act: String) -> Result<(), String> {
    let args = act_args(&app, &act).ok_or("unknown action")?;
    crate::platform::command(&script()).args(&args).spawn().map_err(|e| e.to_string())?;
    if act == "close" {
        close(&handle, &app)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 돌려주기는_한_회차에_한_번만() {
        // 10/19 실사용: '[앱] 참모 포토 돌려받음' 이 연달아 두 번 — takeover off 가 도는 동안 잠금이 남아 다른 길도 돌려줬다
        assert!(begin_handback("examplecraft"), "첫 돌려주기");
        assert!(!begin_handback("examplecraft"), "도는 중 두 번째는 건너뜀");
        assert!(begin_handback("othercraft"), "다른 앱은 따로");
        end_handback("examplecraft");
        end_handback("othercraft");
        assert!(begin_handback("examplecraft"), "끝났으면 다음 회차는 된다");
        end_handback("examplecraft");
    }

    #[test]
    fn 마지막_프레임은_jpeg_data_url_로() {
        assert_eq!(jpeg_url(b"JPG"), "data:image/jpeg;base64,SlBH");
        assert_eq!(jpeg_url(b""), "", "못 찍었으면 빈 글 — 웹은 그림 없이");
    }

    #[test]
    fn 개입_중인지는_잠금_파일로() {
        let d = std::env::temp_dir().join(format!("craft-take-{}", std::process::id()));
        let n = d.join("craft-native");
        std::fs::create_dir_all(&n).unwrap();
        assert!(!taking_over(&d, "photocraft"));
        std::fs::write(n.join("photocraft.takeover.json"), r#"{"on":true}"#).unwrap();
        assert!(taking_over(&d, "photocraft"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 띄운_세션은_이름_글자만() {
        // 프로젝트 세션이 띄운 칸을 그 세션을 맡긴 참모 탭에 — 세션 id 글자(영숫자·-·_ 64자)가 아니면 버린다
        let ok = request(r#"{"action":"craft","arg":{"verb":"open","app":"photocraft","by":"ab12cd34"}}"#).unwrap();
        assert_eq!(ok.by, "ab12cd34");
        let bad = request(r#"{"action":"craft","arg":{"verb":"open","app":"photocraft","by":"a\"b<x>"}}"#).unwrap();
        assert_eq!(bad.by, "", "이상한 글자면 주인 모름(지금 화면)");
    }

    #[test]
    fn 요청은_craft_줄에서_아는_앱만() {
        let r = request(r#"{"action":"craft","id":"a1-b2","arg":{"verb":"open","app":"photocraft"}}"#).unwrap();
        assert_eq!(r, Req { id: "a1-b2".into(), verb: "open".into(), app: "photocraft".into(), names: vec![], label: String::new(), hold: 0, by: String::new() });
        assert!(request(r#"{"action":"craft","arg":{"verb":"close","app":"gridcraft"}}"#).is_some(), "id 없어도 된다");
        assert!(request(r#"{"action":"craft","arg":{"verb":"open","app":"photoshop"}}"#).is_none(), "모르는 앱");
        assert!(request(r#"{"action":"craft","arg":{"verb":"open","app":"../x"}}"#).is_none());
        assert!(request(r#"{"action":"craft","arg":{"verb":"delete","app":"photocraft"}}"#).is_none(), "모르는 동작");
        assert!(request(r#"{"action":"craft","arg":{"verb":"screen","app":"photocraft"}}"#).is_some(), "레티나 화면 부탁");
        assert!(request(r#"{"action":"craft","id":"a;b","arg":{"verb":"open","app":"photocraft"}}"#).is_none(), "id 는 글자·숫자·- 만");
        assert!(request(r#"{"action":"mode","arg":{"verb":"open","app":"photocraft"}}"#).is_none());
    }

    #[test]
    fn 참모_손_요청은_자리_이름과_짧은_글() {
        let r = request(r#"{"action":"craft","arg":{"verb":"point","app":"photocraft","names":["새 칠 또는 조정 레이어 만들기","@canvas"],"label":"채도 +40"}}"#).unwrap();
        assert_eq!((r.names.len(), r.label.as_str(), r.hold), (2, "채도 +40", 0));
        let r = request(r#"{"action":"craft","arg":{"verb":"point","app":"filmcraft","names":["@title"],"label":"내보내는 중…","hold":30}}"#).unwrap();
        assert_eq!(r.hold, 30, "긴 명령 — 손이 머문다");
        let r = request(r#"{"action":"craft","arg":{"verb":"point","app":"filmcraft","names":["@title"],"hold":99999}}"#).unwrap();
        assert_eq!(r.hold, 900, "너무 길면 15분까지만");
        assert!(request(r#"{"action":"craft","arg":{"verb":"point","app":"photocraft","names":[]}}"#).is_none(), "자리 없음");
        assert!(request(r#"{"action":"craft","arg":{"verb":"point","app":"photocraft","names":["a","b","c","d","e","f","g","h","i"]}}"#).is_none(), "너무 많음");
        assert!(request(r#"{"action":"craft","arg":{"verb":"point","app":"photocraft","names":["x"],"label":"a\nb"}}"#).is_none(), "제어 문자");
        assert!(request(r#"{"action":"craft","arg":{"verb":"point","app":"photocraft","names":[1]}}"#).is_none(), "글이 아닌 이름");
    }

    #[test]
    fn 따로_창_기본_크기는_화면의_85퍼센트_최소_1280x800() {
        assert_eq!(default_size(1920.0, 1080.0), (1632.0, 918.0));
        assert_eq!(default_size(1470.0, 956.0), (1280.0, 813.0), "작은 화면은 최소 크기");
        assert_eq!(default_size(1100.0, 700.0), (1100.0, 700.0), "화면보다 크게는 안");
    }

    #[test]
    fn 창_이름은_craft_앞붙이_뒤가_아는_앱일_때만() {
        assert_eq!(label("photocraft"), "craft-photocraft");
        assert!(is_craft_window("craft-photocraft"));
        assert!(!is_craft_window("craft-x"));
        assert!(!is_craft_window("reader-1"));
    }

    #[test]
    fn 머리줄_정보는_scripts_craft_가_남긴_파일에서() {
        let d = std::env::temp_dir().join(format!("craft-win-{}", std::process::id()));
        let n = d.join("craft-native");
        std::fs::create_dir_all(&n).unwrap();
        std::fs::write(n.join("photocraft.json"), r#"{"app":"photocraft","pid":4242,"port":45001,"version":"0.9.0"}"#).unwrap();
        std::fs::write(n.join("photocraft.status.json"), r#"{"last":"채도 +40","dirty":true}"#).unwrap();
        let i = read_info(&d, "photocraft");
        assert_eq!((i.name.as_str(), i.version.as_str(), i.pid, i.last.as_str(), i.dirty), ("PhotoCraft", "0.9.0", Some(4242), "채도 +40", true));
        // 갈아끼운 판 — 상태 파일의 이름이 이긴다
        std::fs::write(n.join("photocraft.json"), r#"{"app":"photocraft","name":"Example Photo","pid":4242}"#).unwrap();
        assert_eq!(read_info(&d, "photocraft").name, "Example Photo");
        let none = read_info(&d, "gridcraft");
        assert_eq!((none.pid, none.dirty, none.last.as_str()), (None, false, ""), "안 띄운 앱");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 머리줄_단추는_닫기_꺼내기만() {
        assert_eq!(act_args("photocraft", "close"), Some(vec!["close".into(), "photocraft-1".into()]), "첫 번째 인스턴스만 — 이름만이면 스크립트가 '부른 쪽 것'을 고른다");
        assert_eq!(act_args("photocraft-2", "eject"), Some(vec!["eject".into(), "photocraft-2".into()]));
        assert_eq!(act_args("photocraft", "remove"), None);
        assert_eq!(act_args("../x", "close"), None);
    }

    #[test]
    fn 인스턴스_키는_앱_이름_또는_뒤에_2_3() {
        assert_eq!(base("photocraft"), Some("photocraft"));
        assert_eq!(base("vectorcraft-3"), Some("vectorcraft"));
        for bad in ["photocraft-1", "photocraft-4", "photocraft-02", "photoshop-2", "../x-2", "photocraft-"] {
            assert_eq!(base(bad), None, "{bad}");
        }
        assert_eq!(display_name("photocraft-2"), Some("PhotoCraft"));
        assert!(is_craft_window("craft-photocraft-2"));
        assert_eq!(keys().len(), 13 * MAX_INSTANCES as usize);
        assert_eq!((arg("photocraft"), arg("photocraft-3")), ("photocraft-1".into(), "photocraft-3".into()));
        let r = request(r#"{"action":"craft","arg":{"verb":"point","app":"photocraft-2","names":["@canvas"]}}"#).unwrap();
        assert_eq!(r.app, "photocraft-2", "손 줄은 그 인스턴스로");
    }

    #[test]
    fn 머리줄_정보는_인스턴스마다_따로_띄운_세션까지() {
        let d = std::env::temp_dir().join(format!("craft-inst-{}", std::process::id()));
        let n = d.join("craft-native");
        std::fs::create_dir_all(&n).unwrap();
        std::fs::write(n.join("photocraft.json"), r#"{"pid":4242,"by":"aaaa"}"#).unwrap();
        std::fs::write(n.join("photocraft-2.json"), r#"{"pid":4343,"by":"bbbb","name":"PhotoCraft 2"}"#).unwrap();
        std::fs::write(n.join("photocraft-2.takeover.json"), r#"{"on":true}"#).unwrap();
        let (a, b) = (read_info(&d, "photocraft"), read_info(&d, "photocraft-2"));
        assert_eq!((a.pid, a.by.as_str(), a.takeover), (Some(4242), "aaaa", false));
        assert_eq!((b.pid, b.by.as_str(), b.takeover, b.name.as_str()), (Some(4343), "bbbb", true, "PhotoCraft 2"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 앱_목록은_scripts_craft_와_같다() {
        let py = include_str!("../../hq-template/scripts/craft");
        for (k, n) in APPS {
            assert!(py.contains(&format!("'{k}': ('{n}',")), "{k}");
        }
        assert!(py.contains(&format!("MAX_INSTANCES = {MAX_INSTANCES}")), "인스턴스 수도 같게");
    }
}
