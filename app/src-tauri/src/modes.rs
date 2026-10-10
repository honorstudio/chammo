//! 참모 모드 — 사용자가 만든 Claude 모드(function hooks 플러그인)의 UI 를 앱이 그린다(docs/research/2026-10-05-chammo-mod.md).
//! 모드마다 헤드리스 호스트(`claude -p --input-format stream-json --plugin-dir <모드>`)를 하나 띄워 'desktop 표면'으로 붙고
//! (`ui_attach`), 트리를 받아(`ui_render`) 그리고, 누름을 되돌린다(`ui_press`·`ui_input`·`ui_select`). 모델 턴은 안 돈다.
//! 이 파일 = 찾기·기억(modes.json)·규약 줄. 프로세스는 modes_host.rs
//! 대가: `ui_*` 규약은 Claude Code 안에서 @internal·early access 다 — 판이 바뀌면 깨질 수 있어, 깨지면 조용히 죽지 않고 '이 판에선 못 그림'을 알린다
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// 앱 안 예시 모드(시험·처음 써 보기용) — 쓸 때 <데이터>/modes/.examples/<이름> 에 풀어 둔다
pub const EXAMPLES: &[(&str, &[(&str, &str)])] = &[(
    "counter",
    &[
        (".claude-plugin/plugin.json", include_str!("../../mode-examples/counter/.claude-plugin/plugin.json")),
        (".claude-plugin/chammo.json", include_str!("../../mode-examples/counter/.claude-plugin/chammo.json")),
        ("hooks/hooks.json", include_str!("../../mode-examples/counter/hooks/hooks.json")),
        ("hooks/register.tsx", include_str!("../../mode-examples/counter/hooks/register.tsx")),
    ],
)];

/// 우리가 붙는 표면 이름·손님 이름 — 규약이 1~64자 글자·숫자·. _ - 만 받는다
pub const SURFACE: &str = "desktop";
pub const CLIENT_ID: &str = "chammo";

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModeInfo {
    /// 메뉴·명령에 쓰는 이름(폴더 이름 또는 플러그인 이름)
    pub name: String,
    pub title: String,
    /// folder = <데이터>/modes/ 아래, added = 사용자가 더한 폴더(scripts/app mode add), plugin = 설치된 Claude 플러그인, example = 앱 안 예시
    pub source: &'static str,
    pub dir: String,
    /// 모드가 권하는 자리(chammo.json where) — 사용자가 고른 게 이긴다
    pub where_default: String,
    /// false 면 안 보인 지 오래되면 재운다(호스트를 끄고 다시 보이면 띄운다 — 모드 안 메모리 상태는 잃는다). 기본 true
    pub keep_alive: bool,
}

/// 메뉴·명령·창 이름에 그대로 쓰니 글자·숫자·. _ - 만, 점으로 시작하지 않게
pub fn safe_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= 64 && !n.starts_with('.') && n.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

/// 자리 — 따로 창(기본)·스페이스 패널·대시보드 칸·모달(미리보기)·꽉 채우기(스페이스 전체)
pub const PLACES: &[&str] = &["window", "panel", "dash", "modal", "full"];

pub fn safe_where(w: &str) -> Option<&'static str> {
    PLACES.iter().find(|p| **p == w).copied()
}

/// 대시보드 칸 대상 — 참모 이름·세션 id·프로젝트 이름·폴더. 화면이 이름 맞추기에만 쓰고(경로로 안 연다) 길이·제어 글자만 거른다
pub fn safe_dash(t: &str) -> Option<String> {
    let t = t.trim();
    (!t.is_empty() && t.chars().count() <= 200 && !t.chars().any(char::is_control)).then(|| t.to_string())
}

fn read(p: &Path) -> Value {
    std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

/// 모드 폴더인가 — 매니페스트가 있고 hooks/hooks.json 에 modules 가 하나 이상(= function hooks)
pub fn is_mode_dir(dir: &Path) -> bool {
    dir.join(".claude-plugin/plugin.json").is_file()
        && read(&dir.join("hooks/hooks.json")).get("modules").and_then(|m| m.as_array()).is_some_and(|m| !m.is_empty())
}

/// 참모 힌트(.claude-plugin/chammo.json) — 예시는 풀기 전에도 앱 안 사본에서
pub fn hint(dir: &Path, name: &str, source: &str) -> Value {
    if source == "example" {
        let embedded = EXAMPLES.iter().find(|(n, _)| *n == name).and_then(|(_, f)| f.iter().find(|(p, _)| *p == ".claude-plugin/chammo.json")).map(|(_, b)| *b);
        return embedded.and_then(|b| serde_json::from_str(b).ok()).unwrap_or(Value::Null);
    }
    read(&dir.join(".claude-plugin/chammo.json"))
}

fn info(name: &str, dir: &Path, source: &'static str) -> ModeInfo {
    let hint = hint(dir, name, source);
    let title = hint.get("title").and_then(|t| t.as_str()).map(str::trim).filter(|t| !t.is_empty()).unwrap_or(name);
    let w = hint.get("where").and_then(|w| w.as_str()).and_then(safe_where).unwrap_or("window");
    let keep_alive = hint.get("keepAlive").and_then(|k| k.as_bool()).unwrap_or(true);
    ModeInfo { name: name.into(), title: title.chars().take(60).collect(), source, dir: dir.to_string_lossy().into_owned(), where_default: w.into(), keep_alive }
}

/// 모드 목록 — <데이터>/modes/* 폴더 → 설치된 플러그인(사용자 범위) 중 function hooks 가진 것 → 앱 예시. 같은 이름은 앞의 것(앱은 더한 폴더까지 discover_with)
#[cfg(test)]
pub fn discover(data: &Path, installed: &Value) -> Vec<ModeInfo> {
    discover_with(data, installed, &[])
}

/// discover + 사용자가 더한 폴더(<데이터>/modes 다음, 플러그인 앞). 모드가 아니게 된 폴더·없는 폴더는 조용히 건너뛴다
pub fn discover_with(data: &Path, installed: &Value, added: &[PathBuf]) -> Vec<ModeInfo> {
    let mut out: Vec<ModeInfo> = Vec::new();
    let mut names: Vec<String> = std::fs::read_dir(data.join("modes")).into_iter().flatten().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    for n in names {
        let d = data.join("modes").join(&n);
        if safe_name(&n) && is_mode_dir(&d) {
            out.push(info(&n, &d, "folder"));
        }
    }
    for d in added {
        let n = d.file_name().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default();
        if safe_name(&n) && !out.iter().any(|m| m.name == n) && is_mode_dir(d) {
            out.push(info(&n, d, "added"));
        }
    }
    if let Some(map) = installed.get("plugins").and_then(|p| p.as_object()) {
        let mut ids: Vec<&String> = map.keys().collect();
        ids.sort();
        for id in ids {
            let name = id.split('@').next().unwrap_or(id);
            let user = map[id].as_array().into_iter().flatten().find(|i| i.get("scope").and_then(|s| s.as_str()).unwrap_or("user") == "user");
            let Some(p) = user.and_then(|i| i.get("installPath")).and_then(|p| p.as_str()) else { continue };
            if safe_name(name) && !out.iter().any(|m| m.name == name) && is_mode_dir(Path::new(p)) {
                out.push(info(name, Path::new(p), "plugin"));
            }
        }
    }
    for (name, _) in EXAMPLES {
        if !out.iter().any(|m| &m.name == name) {
            out.push(info(name, &example_dir(data, name), "example"));
        }
    }
    out
}

pub fn example_dir(data: &Path, name: &str) -> PathBuf {
    data.join("modes/.examples").join(name)
}

/// 예시 모드를 풀어 둔다(늘 덮는다 — 앱이 바뀌면 예시도 따라오게)
pub fn write_example(data: &Path, name: &str) -> std::io::Result<PathBuf> {
    let dir = example_dir(data, name);
    let files = EXAMPLES.iter().find(|(n, _)| *n == name).map(|(_, f)| *f).unwrap_or(&[]);
    for (rel, body) in files {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap_or(&dir))?;
        std::fs::write(p, body)?;
    }
    Ok(dir)
}

/// 호스트가 도는 빈 작업 폴더 — 홈(앱 전체) 소속, 모드 폴더 밖 기록·로그도 여기
pub fn run_dir(data: &Path, name: &str) -> PathBuf {
    data.join("modes").join(name).join("run")
}

/// 호스트 실행 인자 — 사용자 settings 훅·MCP 를 빼고(533MB → 241MB, 2026-10-10 실측) 세션 기록도 안 남긴다
pub fn host_args(plugin_dir: &Path) -> Vec<String> {
    let mut a: Vec<String> = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", "haiku"].iter().map(|s| s.to_string()).collect();
    a.extend(["--plugin-dir".into(), plugin_dir.to_string_lossy().into_owned()]);
    a.extend(["--setting-sources", "project", "--strict-mcp-config", "--no-session-persistence"].iter().map(|s| s.to_string()));
    a
}

// ── 더한 폴더: <데이터>/modes-added.json = ["/절대/경로", …] ──

pub fn load_added(text: &str) -> Vec<PathBuf> {
    let v: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    let mut out: Vec<PathBuf> = Vec::new();
    for p in v.as_array().into_iter().flatten().filter_map(|x| x.as_str()) {
        let p = PathBuf::from(p);
        if p.is_absolute() && !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

pub fn dump_added(l: &[PathBuf]) -> String {
    serde_json::to_string_pretty(&l.iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".into())
}

/// 더해도 되는 모드 폴더인가 → 이름(폴더 이름). 막히면 한 줄 까닭(참모가 그대로 옮긴다)
pub fn add_check(dir: &Path, existing: &[ModeInfo]) -> Result<String, String> {
    if !dir.is_absolute() {
        return Err("give the full path of the mode folder".into());
    }
    if !dir.is_dir() {
        return Err(format!("no such folder: {}", dir.display()));
    }
    if !is_mode_dir(dir) {
        return Err("not a mode: it needs .claude-plugin/plugin.json and hooks/hooks.json with \"modules\" (function hooks — make it with /plugin-authoring)".into());
    }
    let name = dir.file_name().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default();
    if !safe_name(&name) {
        return Err("rename the folder to letters, digits, . _ - (it becomes the mode name)".into());
    }
    match existing.iter().find(|m| m.name == name) {
        Some(m) if Path::new(&m.dir) != dir => Err(format!("a mode named {name} already exists ({}) — rename the folder", m.dir)),
        _ => Ok(name),
    }
}

// ── 재우기: chammo.json keepAlive:false 인 모드만, 아무 칸에도 안 보인 지 SLEEP_AFTER 가 지나면 ──

pub const SLEEP_AFTER: std::time::Duration = std::time::Duration::from_secs(300);

/// 재울까 — 살아 있고, 재워도 된다고 했고, 보는 칸이 없고, 안 보인 지 오래
pub fn should_sleep(keep_alive: bool, alive: bool, viewers: usize, unseen_for: std::time::Duration) -> bool {
    !keep_alive && alive && viewers == 0 && unseen_for >= sleep_after()
}

/// 개발판 시험용으로만 짧게(CHAMMO_MODE_SLEEP_SECS) — 배포판은 늘 5분
fn sleep_after() -> std::time::Duration {
    #[cfg(debug_assertions)]
    if let Some(s) = std::env::var("CHAMMO_MODE_SLEEP_SECS").ok().and_then(|v| v.parse::<u64>().ok()) {
        return std::time::Duration::from_secs(s);
    }
    SLEEP_AFTER
}

// ── 판: function hooks 는 2.1.287 부터(early access) ──

pub const MIN_CLAUDE: (u32, u32, u32) = (2, 1, 287);

/// `claude --version` 첫 낱말 → 모드를 그릴 수 있나. 못 읽으면 None(모른다 — 숨기지 않는다)
pub fn supported(version: &str) -> Option<bool> {
    let first = version.split_whitespace().next()?;
    let mut it = first.split('.').map(|x| x.parse::<u32>());
    let v = (it.next()?.ok()?, it.next()?.ok()?, it.next()?.ok()?);
    Some(v >= MIN_CLAUDE)
}

// ── 기억: <데이터>/modes.json = {"<이름>": {"on": bool, "where": "window"|"panel"|"dash"|"modal"|"full", "dash"?: "<대상>", "top"?: true}} ──

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
pub struct Saved {
    pub on: bool,
    #[serde(rename = "where")]
    pub place: String,
    /// 대시보드 칸이면 어느 대시보드(참모·프로젝트 이름)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dash: Option<String>,
    /// 따로 창 '항상 위' — 창이 아닌 자리에선 기억만 하고 안 쓴다
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub top: bool,
}

pub fn load_saved(text: &str) -> std::collections::BTreeMap<String, Saved> {
    let v: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    let mut out = std::collections::BTreeMap::new();
    for (k, x) in v.as_object().into_iter().flatten() {
        if !safe_name(k) {
            continue;
        }
        let place = x.get("where").and_then(|w| w.as_str()).and_then(safe_where).unwrap_or("window");
        let dash = x.get("dash").and_then(|d| d.as_str()).and_then(safe_dash);
        let top = x.get("top").and_then(|t| t.as_bool()).unwrap_or(false);
        out.insert(k.clone(), Saved { on: x.get("on").and_then(|o| o.as_bool()).unwrap_or(false), place: place.into(), dash, top });
    }
    out
}

pub fn dump_saved(m: &std::collections::BTreeMap<String, Saved>) -> String {
    serde_json::to_string_pretty(m).unwrap_or_else(|_| "{}".into())
}

/// 이번에 띄울 자리 — 말한 것 > 지난번 고른 것 > 모드가 권한 것
pub fn pick_where(asked: Option<&str>, saved: Option<&Saved>, default: &str) -> &'static str {
    asked.and_then(safe_where).or_else(|| saved.and_then(|s| safe_where(&s.place))).or_else(|| safe_where(default)).unwrap_or("window")
}

// ── 규약 줄 (stdin 에 한 줄씩) ──

pub fn control(id: &str, request: Value) -> String {
    json!({"type": "control_request", "request_id": id, "request": request}).to_string()
}

pub fn attach_req(columns: u32, rows: u32) -> Value {
    json!({"subtype": "ui_attach", "surface": SURFACE, "client_id": CLIENT_ID, "viewport": {"columns": columns.max(1), "rows": rows.max(1), "isFullscreen": true}})
}

/// 2.1.296 부터 surface·client_id 를 같이 보내야 한다(없으면 오류)
pub fn render_req(component: &str, instance: &str, columns: u32, rows: u32) -> Value {
    json!({"subtype": "ui_render", "surface": SURFACE, "client_id": CLIENT_ID, "component": component, "instance_id": instance, "props": {},
        "viewport": {"columns": columns.max(1), "rows": rows.max(1), "isFullscreen": true}})
}

pub fn detach_req() -> Value {
    json!({"subtype": "ui_detach", "client_id": CLIENT_ID})
}

/// 화면이 보낸 누름·입력·고르기 → 규약 요청. 받는 칸만 골라 담는다(화면이 아무 요청이나 보내지 못하게)
pub fn act_req(act: &Value) -> Result<Value, String> {
    let plugin = act.get("plugin").and_then(|p| p.as_str()).ok_or("plugin")?;
    let handle = act.get("handle").and_then(|h| h.as_i64()).ok_or("handle")?;
    let mut r = json!({"plugin": plugin, "handle": handle, "surface": SURFACE});
    if let Some(k) = act.get("key").and_then(|k| k.as_str()) {
        r["key"] = k.into();
    }
    let s = |k: &str| act.get(k).and_then(|v| v.as_str()).map(|v| v.chars().take(16384).collect::<String>());
    match act.get("kind").and_then(|k| k.as_str()) {
        Some("press") => {
            r["subtype"] = "ui_press".into();
            if let Some(h) = s("href") {
                r["href"] = h.chars().take(2048).collect::<String>().into();
            }
        }
        Some("input") => {
            r["subtype"] = "ui_input".into();
            r["kind"] = if act.get("submit").and_then(|v| v.as_bool()).unwrap_or(true) { "submit" } else { "change" }.into();
            r["value"] = s("value").unwrap_or_default().into();
        }
        Some("select") => {
            r["subtype"] = "ui_select".into();
            r["value"] = s("value").ok_or("value")?.into();
        }
        _ => return Err("kind".into()),
    }
    Ok(r)
}

// ── Client 칸(모드의 화면 모듈) — 별도 주소의 빈 방에서만 돈다 ──

/// Client 방 — 모드 코드는 하나도 안 든 고정 페이지(mode_frame.html). 모듈은 화면이 ui_client_module 답을 받아 넣는다
pub const FRAME_HTML: &str = include_str!("mode_frame.html");

/// 방 머리글 — 불투명 출처(sandbox, allow-same-origin 없음)에 스크립트만. 바깥 보내기(connect)·그림·글꼴·하위 칸·폼은 다 막는다.
/// 앱 출처(IPC)·hodoc 홈 파일·네트워크에 못 닿고, 할 수 있는 건 부모에 postMessage 뿐(앱이 거른다). 시안 칸(reader DOC_CSP)보다 더 좁다
pub const FRAME_CSP: &str = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' blob:; connect-src 'none'; img-src 'none'; style-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";

/// modeframe:// 응답 — 방 하나뿐(/). 그 밖 주소는 404
pub fn frame_response(path: &str) -> tauri::http::Response<Vec<u8>> {
    let b = tauri::http::Response::builder();
    if path != "/" && !path.is_empty() {
        return b.status(404).body(Vec::new()).unwrap_or_default();
    }
    b.header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", FRAME_CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(FRAME_HTML.as_bytes().to_vec())
        .unwrap_or_default()
}

pub fn client_module_req(plugin: &str) -> Result<Value, String> {
    let plugin = short(plugin, 256).ok_or("plugin")?;
    Ok(json!({"subtype": "ui_client_module", "plugin": plugin}))
}

/// 1~n 자, 제어 글자 없음
fn short(v: &str, n: usize) -> Option<String> {
    (!v.is_empty() && v.chars().count() <= n && !v.chars().any(char::is_control)).then(|| v.to_string())
}

/// Client 자리(화면이 보낸 것) → 규약 다섯 칸. 받는 칸만 골라 담는다
fn client_at(at: &Value) -> Result<serde_json::Map<String, Value>, String> {
    let mut m = serde_json::Map::new();
    for k in ["plugin", "instance_id", "client", "module"] {
        let v = at.get(k).and_then(|v| v.as_str()).and_then(|v| short(v, 256)).ok_or(k)?;
        m.insert(k.into(), v.into());
    }
    let c = at.get("component").and_then(|v| v.as_str()).filter(|c| matches!(*c, "Pane" | "AbovePrompt")).ok_or("component")?;
    m.insert("component".into(), c.into());
    Ok(m)
}

/// Client 안 누름·입력·고르기 → ui_client_press. act = {kind: press|input|select, element, value?, submit?}
pub fn client_press_req(at: &Value, act: &Value) -> Result<Value, String> {
    let mut m = client_at(at)?;
    m.insert("subtype".into(), "ui_client_press".into());
    let element = act.get("element").and_then(|v| v.as_str()).and_then(|v| short(v, 256)).ok_or("element")?;
    m.insert("element".into(), element.into());
    let value = || act.get("value").and_then(|v| v.as_str()).map(|v| v.chars().take(16384).collect::<String>());
    let event = match act.get("kind").and_then(|k| k.as_str()) {
        Some("press") => json!({"type": "press"}),
        Some("input") => json!({"type": "input", "kind": if act.get("submit").and_then(|v| v.as_bool()).unwrap_or(true) { "submit" } else { "change" }, "value": value().unwrap_or_default()}),
        Some("select") => json!({"type": "select", "value": value().ok_or("value")?}),
        _ => return Err("kind".into()),
    };
    m.insert("event".into(), event);
    Ok(Value::Object(m))
}

/// Client 가 보낸 글(surface.post) → ui_message. 규약 한도(10만 자)를 넘으면 안 보낸다
pub const CLIENT_POST_MAX: usize = 100_000;

pub fn client_message_req(at: &Value, data: &Value) -> Result<Value, String> {
    let mut m = client_at(at)?;
    if data.is_null() || data.to_string().chars().count() > CLIENT_POST_MAX {
        return Err("data".into());
    }
    m.insert("subtype".into(), "ui_message".into());
    m.insert("data".into(), data.clone());
    Ok(Value::Object(m))
}

/// Client 가 멈췄다 → ui_client_fault(모드가 다른 그림을 그릴 수 있게). 까닭은 믿지 않는 글 — 200자·제어 글자는 빈칸
pub fn client_fault_req(at: &Value, phase: &str, reason: &str) -> Result<Value, String> {
    let mut m = client_at(at)?;
    let phase = matches!(phase, "load" | "render" | "run").then_some(phase).ok_or("phase")?;
    let reason: String = reason.chars().map(|c| if c.is_control() || c == '\u{2028}' || c == '\u{2029}' { ' ' } else { c }).take(200).collect();
    m.insert("subtype".into(), "ui_client_fault".into());
    m.insert("phase".into(), phase.into());
    m.insert("reason".into(), reason.into());
    Ok(Value::Object(m))
}

/// 호스트 stdout 한 줄 → 무엇인가
#[derive(Debug, PartialEq)]
pub enum Line {
    /// 내 요청의 답 — Ok(response) 또는 Err(오류 글)
    Reply(String, Result<Value, String>),
    /// 밀림 — ui_invalidate·ui_status·ui_toast·ui_panes·ui_log·ui_scroll (system 줄 통째)
    Push(Value),
    Other,
}

pub fn route(line: &str) -> Line {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return Line::Other };
    match v.get("type").and_then(|t| t.as_str()) {
        Some("control_response") => {
            let r = &v["response"];
            let Some(id) = r.get("request_id").and_then(|i| i.as_str()) else { return Line::Other };
            let res = if r.get("subtype").and_then(|s| s.as_str()) == Some("success") {
                Ok(r.get("response").cloned().unwrap_or(Value::Null))
            } else {
                Err(r.get("error").and_then(|e| e.as_str()).unwrap_or("error").to_string())
            };
            Line::Reply(id.to_string(), res)
        }
        Some("system") if v.get("subtype").and_then(|s| s.as_str()).is_some_and(|s| s.starts_with("ui_")) => Line::Push(v),
        _ => Line::Other,
    }
}

/// 이 판이 규약을 모른다 — attach 가 거절되거나 desktop 표면이 없거나 요청 이름을 모른다
pub fn unsupported(attach: &Result<Value, String>) -> bool {
    match attach {
        Err(e) => e.contains("Unsupported control request subtype"),
        Ok(v) => !v.get("surfaces").and_then(|s| s.as_array()).is_some_and(|s| s.iter().any(|x| x == SURFACE)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-modes-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn mode(dir: &Path, modules: bool, hint: Option<&str>) {
        std::fs::create_dir_all(dir.join(".claude-plugin")).unwrap();
        std::fs::create_dir_all(dir.join("hooks")).unwrap();
        std::fs::write(dir.join(".claude-plugin/plugin.json"), r#"{"name":"x"}"#).unwrap();
        let hooks = if modules { r#"{"modules":["./register.tsx"]}"# } else { r#"{"hooks":{}}"# };
        std::fs::write(dir.join("hooks/hooks.json"), hooks).unwrap();
        if let Some(h) = hint {
            std::fs::write(dir.join(".claude-plugin/chammo.json"), h).unwrap();
        }
    }

    #[test]
    fn 모드는_데이터_폴더_플러그인_예시_순이고_같은_이름은_앞의_것() {
        let d = tmp("discover");
        mode(&d.join("modes/tally"), true, Some(r#"{"title":"집계판","where":"panel"}"#));
        mode(&d.join("modes/plain"), false, None); // command hooks 플러그인은 모드가 아니다
        std::fs::create_dir_all(d.join("modes/counter/run")).unwrap(); // 호스트 작업 폴더만 남은 것
        mode(&d.join("modes/.hidden"), true, None);
        mode(&d.join("plug/board"), true, None);
        mode(&d.join("plug/tally2"), true, None);
        let installed = json!({"plugins": {
            "board@m": [{"scope": "user", "installPath": d.join("plug/board")}],
            "tally@m": [{"scope": "user", "installPath": d.join("plug/tally2")}],
            "proj@m": [{"scope": "project", "projectPath": "/p", "installPath": d.join("plug/board")}]
        }});
        let got = discover(&d, &installed);
        let names: Vec<(&str, &str)> = got.iter().map(|m| (m.name.as_str(), m.source)).collect();
        assert_eq!(names, vec![("tally", "folder"), ("board", "plugin"), ("counter", "example")]);
        assert_eq!(got[0].title, "집계판");
        assert_eq!(got[0].where_default, "panel");
        assert_eq!(got[1].where_default, "window");
    }

    #[test]
    fn 더한_폴더는_데이터_폴더_다음_플러그인_앞이고_이름이_겹치면_앞의_것() {
        let d = tmp("added");
        mode(&d.join("modes/tally"), true, None);
        mode(&d.join("dev/shop-mode"), true, Some(r#"{"title":"가게판"}"#));
        mode(&d.join("dev/x/tally"), true, None); // 데이터 폴더 것과 이름이 같다
        mode(&d.join("dev/plain"), false, None); // 모드가 아닌 폴더(지운 뒤 남은 등록)
        let added = vec![d.join("dev/shop-mode"), d.join("dev/x/tally"), d.join("dev/plain"), d.join("dev/none")];
        let got = discover_with(&d, &Value::Null, &added);
        let names: Vec<(&str, &str)> = got.iter().map(|m| (m.name.as_str(), m.source)).collect();
        assert_eq!(names, vec![("tally", "folder"), ("shop-mode", "added"), ("counter", "example")]);
        assert_eq!(got[1].title, "가게판");
    }

    #[test]
    fn 모드_더하기는_모드_폴더만_이름이_겹치면_거절() {
        let d = tmp("add-check");
        mode(&d.join("dev/shop-mode"), true, None);
        mode(&d.join("dev/plain"), false, None);
        mode(&d.join("dev/counter"), true, None);
        std::fs::create_dir_all(d.join("dev/한글")).unwrap();
        let existing = discover_with(&d, &Value::Null, &[]);
        assert_eq!(add_check(&d.join("dev/shop-mode"), &existing).unwrap(), "shop-mode");
        assert!(add_check(&d.join("dev/plain"), &existing).unwrap_err().contains("hooks"), "function hooks 없는 플러그인");
        assert!(add_check(&d.join("dev/none"), &existing).is_err());
        assert!(add_check(Path::new("relative/x"), &existing).is_err(), "절대 경로만");
        assert!(add_check(&d.join("dev/counter"), &existing).is_err(), "예시와 같은 이름");
        assert!(add_check(&d.join("dev/한글"), &existing).is_err());
        let again = discover_with(&d, &Value::Null, &[d.join("dev/shop-mode")]);
        assert_eq!(add_check(&d.join("dev/shop-mode"), &again).unwrap(), "shop-mode", "같은 폴더를 또 더하면 그대로");
    }

    #[test]
    fn 더한_폴더_기억은_절대_경로만_겹치지_않게() {
        let l = load_added(r#"["/a/b", "rel", "/a/b", 3, "/c"]"#);
        assert_eq!(l, vec![PathBuf::from("/a/b"), PathBuf::from("/c")]);
        assert!(load_added("깨짐").is_empty());
        assert_eq!(load_added(&dump_added(&l)), l);
    }

    #[test]
    fn claude_판이_2_1_287_전이면_모드를_못_그린다() {
        assert_eq!(supported("2.1.296 (Claude Code)"), Some(true));
        assert_eq!(supported("2.1.287"), Some(true));
        assert_eq!(supported("2.1.286 (Claude Code)"), Some(false));
        assert_eq!(supported("2.0.999"), Some(false));
        assert_eq!(supported("3.0.0"), Some(true));
        assert_eq!(supported(""), None);
        assert_eq!(supported("claude: command not found"), None);
    }

    #[test]
    fn keep_alive_false_인_모드만_안_보인_지_5분이면_재운다() {
        use std::time::Duration as D;
        assert!(should_sleep(false, true, 0, D::from_secs(300)));
        assert!(!should_sleep(false, true, 0, D::from_secs(299)), "아직");
        assert!(!should_sleep(false, true, 1, D::from_secs(9999)), "보는 칸이 있다");
        assert!(!should_sleep(true, true, 0, D::from_secs(9999)), "기본은 안 재운다(모드 안 상태를 잃으니)");
        assert!(!should_sleep(false, false, 0, D::from_secs(9999)), "이미 꺼졌다");
        let d = tmp("keepalive");
        mode(&d.join("modes/a"), true, Some(r#"{"keepAlive":false}"#));
        mode(&d.join("modes/b"), true, Some(r#"{"keepAlive":"no"}"#));
        mode(&d.join("modes/c"), true, None);
        let got = discover(&d, &Value::Null);
        assert_eq!(got.iter().map(|m| (m.name.as_str(), m.keep_alive)).take(3).collect::<Vec<_>>(), vec![("a", false), ("b", true), ("c", true)]);
    }

    #[test]
    fn 예시는_풀기_전에도_제목과_자리를_안다() {
        // 2026-10-10 시험 앱: 처음 켜기 전 목록·창 제목이 'counter'(폴더 이름)로 나왔다 — 힌트를 아직 안 푼 폴더에서 읽어서
        let d = tmp("example-hint");
        let ex = discover(&d, &Value::Null).into_iter().find(|m| m.source == "example").unwrap();
        assert_eq!(ex.title, "Counter");
        assert_eq!(ex.where_default, "window");
    }

    #[test]
    fn 예시를_풀면_모드_폴더가_된다() {
        let d = tmp("example");
        let dir = write_example(&d, "counter").unwrap();
        assert!(is_mode_dir(&dir));
        assert!(std::fs::read_to_string(dir.join("hooks/register.tsx")).unwrap().contains("ui.render"));
    }

    #[test]
    fn 이름은_메뉴_창_이름에_그대로_쓸_수_있는_것만() {
        assert!(safe_name("counter") && safe_name("usage-board_2.x"));
        assert!(!safe_name("") && !safe_name(".examples") && !safe_name("a/b") && !safe_name("모드") && !safe_name(&"a".repeat(65)));
    }

    #[test]
    fn 자리는_말한_것_지난번_권한_것_순() {
        let s = Saved { on: false, place: "panel".into(), dash: None, top: false };
        assert_eq!(pick_where(Some("window"), Some(&s), "panel"), "window");
        assert_eq!(pick_where(None, Some(&s), "window"), "panel");
        assert_eq!(pick_where(None, None, "panel"), "panel");
        assert_eq!(pick_where(Some("modal"), None, "nope"), "modal");
        assert_eq!(pick_where(Some("full"), None, "window"), "full");
        assert_eq!(pick_where(Some("sidebar"), None, "nope"), "window"); // 없는 자리는 기본
    }

    #[test]
    fn 자리는_다섯_가지만() {
        for w in ["window", "panel", "dash", "modal", "full"] {
            assert_eq!(safe_where(w), Some(w));
        }
        assert_eq!(safe_where("Window"), None);
        assert_eq!(safe_where(""), None);
    }

    #[test]
    fn 대시보드_대상은_길이와_제어_글자만_거른다() {
        assert_eq!(safe_dash("  helper-2 "), Some("helper-2".into()));
        assert_eq!(safe_dash("/Users/a/dev/shop"), Some("/Users/a/dev/shop".into()));
        assert_eq!(safe_dash("참모"), Some("참모".into()));
        assert_eq!(safe_dash("   "), None);
        assert_eq!(safe_dash("a\nb"), None);
        assert_eq!(safe_dash(&"가".repeat(201)), None);
    }

    #[test]
    fn 항상_위는_켰을_때만_적고_읽어_온다() {
        let m = load_saved(r#"{"a":{"on":true,"where":"window","top":true},"b":{"on":true,"where":"window","top":"yes"},"c":{"on":false}}"#);
        assert!(m["a"].top);
        assert!(!m["b"].top, "참·거짓이 아니면 끔");
        assert!(!m["c"].top, "없으면 끔");
        let out = dump_saved(&m);
        assert_eq!(out.matches("\"top\"").count(), 1, "끈 모드엔 칸을 안 쓴다");
        assert_eq!(load_saved(&out), m);
    }

    #[test]
    fn 기억은_이상한_이름_자리를_거른다() {
        let m = load_saved(r#"{"counter":{"on":true,"where":"panel"},"../x":{"on":true},"b":{"where":"side"},"c":{"on":true,"where":"dash","dash":"shop"},"d":{"where":"dash","dash":"\u0007"}}"#);
        assert_eq!(m.len(), 4);
        assert_eq!(m["counter"], Saved { on: true, place: "panel".into(), dash: None, top: false });
        assert_eq!(m["b"], Saved { on: false, place: "window".into(), dash: None, top: false });
        assert_eq!(m["c"], Saved { on: true, place: "dash".into(), dash: Some("shop".into()), top: false });
        assert_eq!(m["d"].dash, None, "제어 글자 대상은 버린다");
        assert!(!dump_saved(&m).contains("\"dash\": null"), "대상 없으면 칸도 안 쓴다");
        assert_eq!(load_saved(&dump_saved(&m)), m);
        assert!(load_saved("깨진 글").is_empty());
    }

    #[test]
    fn 그리기_요청엔_표면과_손님_이름이_붙는다() {
        // 2.1.296 실측: surface 없으면 ui_render 오류, client_id 없으면 ui_detach 오류
        let r = render_req("Pane", "board", 100, 30);
        assert_eq!(r["surface"], "desktop");
        assert_eq!(r["client_id"], "chammo");
        assert_eq!(r["viewport"], json!({"columns": 100, "rows": 30, "isFullscreen": true}));
        assert_eq!(detach_req()["client_id"], "chammo");
        let line: Value = serde_json::from_str(&control("a1", attach_req(0, 0))).unwrap();
        assert_eq!(line["type"], "control_request");
        assert_eq!(line["request"]["viewport"]["columns"], 1);
    }

    #[test]
    fn 누름_입력_고르기는_받는_칸만_담는다() {
        let p = act_req(&json!({"kind": "press", "plugin": "counter", "handle": 7, "key": "inc", "evil": 1})).unwrap();
        assert_eq!(p, json!({"subtype": "ui_press", "plugin": "counter", "handle": 7, "key": "inc", "surface": "desktop"}));
        let i = act_req(&json!({"kind": "input", "plugin": "f", "handle": 1, "key": "name", "value": "hi"})).unwrap();
        assert_eq!((i["subtype"].as_str(), i["kind"].as_str(), i["value"].as_str()), (Some("ui_input"), Some("submit"), Some("hi")));
        let c = act_req(&json!({"kind": "input", "plugin": "f", "handle": 1, "value": "h", "submit": false})).unwrap();
        assert_eq!(c["kind"], "change");
        let s = act_req(&json!({"kind": "select", "plugin": "f", "handle": 2, "value": "b"})).unwrap();
        assert_eq!(s["subtype"], "ui_select");
        assert!(act_req(&json!({"kind": "detach", "plugin": "f", "handle": 1})).is_err());
        assert!(act_req(&json!({"kind": "press", "plugin": "f"})).is_err());
        assert!(act_req(&json!({"kind": "select", "plugin": "f", "handle": 2})).is_err());
    }

    #[test]
    fn 호스트_줄은_답_밀림_나머지로_가른다() {
        let ok = r#"{"type":"control_response","response":{"subtype":"success","request_id":"r1","response":{"tree":{"type":"Box"}}}}"#;
        assert_eq!(route(ok), Line::Reply("r1".into(), Ok(json!({"tree": {"type": "Box"}}))));
        let bad = r#"{"type":"control_response","response":{"subtype":"error","request_id":"r2","error":"ui_render: surface must be"}}"#;
        assert_eq!(route(bad), Line::Reply("r2".into(), Err("ui_render: surface must be".into())));
        let push = r#"{"type":"system","subtype":"ui_toast","plugin":"counter","text":"Pressed 1","timeout_ms":4000}"#;
        assert!(matches!(route(push), Line::Push(v) if v["text"] == "Pressed 1"));
        assert_eq!(route(r#"{"type":"system","subtype":"hook_started"}"#), Line::Other);
        assert_eq!(route("not json"), Line::Other);
    }

    fn at() -> Value {
        json!({"plugin": "tick", "instance_id": "board", "client": "b1", "module": "hooks/board.tsx", "component": "Pane", "evil": 1})
    }

    #[test]
    fn client_방은_불투명_출처에_스크립트만_바깥_보내기는_막는다() {
        let r = frame_response("/");
        let csp = r.headers()["Content-Security-Policy"].to_str().unwrap();
        assert!(csp.starts_with("sandbox allow-scripts;"), "{csp}");
        for no in ["allow-same-origin", "allow-popups", "allow-top-navigation", "allow-forms", "allow-modals", "https:", "hodoc", "'unsafe-eval'"] {
            assert!(!csp.contains(no), "{no} — {csp}");
        }
        for yes in ["default-src 'none'", "connect-src 'none'", "img-src 'none'", "frame-src 'none'", "worker-src 'none'", "form-action 'none'", "base-uri 'none'", "script-src 'unsafe-inline' blob:;"] {
            assert!(csp.contains(yes), "{yes} — {csp}");
        }
        assert_eq!(r.headers()["X-Content-Type-Options"], "nosniff");
        let body = String::from_utf8(r.body().clone()).unwrap();
        // 같은 막이가 페이지 안에도(머리글이 빠지는 길에서도) — sandbox 만 빼고
        assert!(body.contains(r#"http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; connect-src 'none';"#));
        // 고정 페이지 — 바깥 주소·모드 코드가 없다. 부모 말만 듣는다
        assert!(!body.contains("http://") && !body.contains("https://"), "바깥 주소 없음");
        assert!(body.contains("if (e.source !== parent) return;"));
        // 날 줄 바꿈 글자(U+2028·2029)가 스크립트에 들어가면 JS 가 깨진다(파일 쓰기 도구가 \u2028 을 진짜 글자로 바꿔 넣은 적이 있다)
        assert!(!body.contains('\u{2028}') && !body.contains('\u{2029}'));
        assert_eq!(frame_response("/x").status(), 404);
        assert_eq!(frame_response("/../etc").status(), 404);
    }

    #[test]
    fn client_누름은_다섯_칸_자리와_사건만_담는다() {
        let p = client_press_req(&at(), &json!({"kind": "press", "element": "up", "handle": 9})).unwrap();
        assert_eq!(p, json!({"subtype": "ui_client_press", "plugin": "tick", "instance_id": "board", "client": "b1", "module": "hooks/board.tsx", "component": "Pane", "element": "up", "event": {"type": "press"}}));
        let i = client_press_req(&at(), &json!({"kind": "input", "element": "q", "value": "hi", "submit": false})).unwrap();
        assert_eq!(i["event"], json!({"type": "input", "kind": "change", "value": "hi"}));
        let s = client_press_req(&at(), &json!({"kind": "select", "element": "pick", "value": "b"})).unwrap();
        assert_eq!(s["event"], json!({"type": "select", "value": "b"}));
        let long = client_press_req(&at(), &json!({"kind": "input", "element": "q", "value": "가".repeat(20000)})).unwrap();
        assert_eq!(long["event"]["value"].as_str().unwrap().chars().count(), 16384);
        assert!(client_press_req(&at(), &json!({"kind": "select", "element": "pick"})).is_err());
        assert!(client_press_req(&at(), &json!({"kind": "detach", "element": "up"})).is_err());
        assert!(client_press_req(&at(), &json!({"kind": "press"})).is_err(), "element 없음");
        let mut bad = at();
        bad["component"] = "UserMessage".into();
        assert!(client_press_req(&bad, &json!({"kind": "press", "element": "up"})).is_err(), "Pane·AbovePrompt 만");
        let mut bad = at();
        bad["client"] = "a\nb".into();
        assert!(client_press_req(&bad, &json!({"kind": "press", "element": "up"})).is_err());
        let mut bad = at();
        bad.as_object_mut().unwrap().remove("module");
        assert!(client_press_req(&bad, &json!({"kind": "press", "element": "up"})).is_err());
    }

    #[test]
    fn client_글은_한도_안에서만_고장_까닭은_200자_한_줄() {
        let m = client_message_req(&at(), &json!({"n": 6})).unwrap();
        assert_eq!((m["subtype"].as_str(), &m["data"]), (Some("ui_message"), &json!({"n": 6})));
        assert!(m.get("evil").is_none());
        assert!(client_message_req(&at(), &Value::Null).is_err());
        assert!(client_message_req(&at(), &json!({"x": "a".repeat(CLIENT_POST_MAX)})).is_err());
        let f = client_fault_req(&at(), "run", &format!("boom\nline\u{2028}{}", "x".repeat(300))).unwrap();
        assert_eq!(f["phase"], "run");
        let r = f["reason"].as_str().unwrap();
        assert!(r.starts_with("boom line ") && r.chars().count() == 200 && !r.contains('\n'));
        assert!(client_fault_req(&at(), "boot", "x").is_err());
        assert_eq!(client_module_req("tick").unwrap(), json!({"subtype": "ui_client_module", "plugin": "tick"}));
        assert!(client_module_req("").is_err());
    }

    #[test]
    fn 판이_규약을_모르면_알아본다() {
        assert!(unsupported(&Err("Unsupported control request subtype: ui_attach".into())));
        assert!(unsupported(&Ok(json!({"surfaces": []}))));
        assert!(!unsupported(&Ok(json!({"surfaces": ["desktop"]}))));
        assert!(!unsupported(&Err("timeout".into())));
    }

    #[test]
    fn 호스트는_사용자_설정_훅_mcp_없이_뜬다() {
        let a = host_args(Path::new("/m/counter"));
        let s = a.join(" ");
        assert!(s.starts_with("-p --input-format stream-json --output-format stream-json"));
        assert!(s.contains("--plugin-dir /m/counter"));
        assert!(s.contains("--setting-sources project") && s.contains("--strict-mcp-config") && s.contains("--no-session-persistence"));
    }
}
