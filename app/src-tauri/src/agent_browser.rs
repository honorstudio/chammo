//! 세션 브라우저 앱에서 보기(2026-10-03 사용자 "가보자") — 참모 브라우저 래퍼가 <데이터>/browser/live/<프로필>.json(600) 에
//! CDP 포트·지금 탭·하는 일을 적으면(tools/chammo-browser/src/live.js), 앱이 그 포트로 붙어 Page.startScreencast 프레임을 받는다.
//! 세션 ↔ 브라우저 = live 의 sessionPid(래퍼의 부모) = `claude agents --json` 의 pid.
//!
//! - 보이는 칸이 있을 때만 받는다: 프론트가 agent_frame 을 묻는 동안만 일꾼이 돌고, 3초 안 물으면 끊는다(CPU·대역폭)
//! - 지금 탭 따라가기: MCP 가 말한 지금 탭 주소(live.url)와 같은 탭 → 없으면 마지막으로 주소가 바뀐 탭 → 지금 보던 탭
//! - 127.0.0.1 에만 붙고, 포트·경로는 live 파일(600)에서만 읽어 모양을 검사한다. Origin 머리를 안 보낸다(크롬은 Origin 붙은 접속을 거절)
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveTab {
    pub index: u32,
    #[serde(default)]
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub current: bool,
}

/// 래퍼 상태 파일 한 장
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Live {
    pub profile: String,
    pub pid: i32,
    pub session_pid: i32,
    pub port: u16,
    pub ws_path: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub tabs: Vec<LiveTab>,
    /// 하는 일 한 줄(값 없이 — live.js toolLine)
    #[serde(default)]
    pub tool: String,
    #[serde(default)]
    pub tool_at: u64,
    #[serde(default)]
    pub busy: bool,
    #[serde(default)]
    pub ts: u64,
    /// 세션이 사람을 부름(browser_ask_human) {reason, at} — 앱이 그 브라우저를 크게 띄우고 알린다
    #[serde(default)]
    pub ask: Option<serde_json::Value>,
    /// 래퍼가 '개입' 때 세션 도구를 붙잡을 수 있다(tools/chammo-browser src/takeover.js) — 없으면(스크립트 크롬·옛 래퍼) 멈추지 못한다
    #[serde(default)]
    pub gate: bool,
    /// 세션 도구가 사람이 돌려주길 기다리기 시작한 때(ms, 0 = 안 기다림)
    #[serde(default)]
    pub held: u64,
    /// 사람이 개입 중 {by, at} — 래퍼가 아니라 앱이 채운다(takeover.rs)
    #[serde(default)]
    pub takeover: Option<serde_json::Value>,
    /// 이 크롬을 같이 쓰는 산 스크립트 수(chammo-browser launch, <browser>/locks/<프로필>.users) — 앱이 채운다.
    /// 스크립트는 래퍼를 안 거쳐 개입해도 못 멈춘다 — 개입 줄에 알린다
    #[serde(default)]
    pub scripts: u32,
}

/// 같이 쓰는 산 스크립트 수 — 명부 <locks>/<프로필>.users/<pid>(src/users.js). 세션 브라우저 도구가 같이 쓰는 칸(by=session, src/share.js)·
/// 크롬 주인(상태 파일 pid)은 뺀다
pub fn script_users(locks: &std::path::Path, profile: &str, owner: i32, alive: impl Fn(i32) -> bool) -> u32 {
    let Ok(rd) = std::fs::read_dir(locks.join(format!("{profile}.users"))) else { return 0 };
    rd.flatten()
        .filter_map(|e| {
            let pid: i32 = e.file_name().to_str()?.parse().ok()?;
            let v: serde_json::Value = std::fs::read_to_string(e.path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
            (pid > 0 && pid != owner && v["by"] != "session" && alive(pid)).then_some(())
        })
        .count() as u32
}

/// 상태 파일 글 → Live. 포트·경로·프로필 모양이 이상하면 None(남이 심은 파일로 엉뚱한 곳에 붙지 않게)
pub fn parse_live(text: &str) -> Option<Live> {
    let l: Live = serde_json::from_str(text).ok()?;
    let ws_ok = l.ws_path.strip_prefix("/devtools/browser/").is_some_and(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    let profile_ok = !l.profile.is_empty() && !l.profile.starts_with('.') && !l.profile.contains(['/', '\\', '\0']);
    (l.port > 0 && ws_ok && profile_ok && l.pid > 0).then_some(l)
}

pub fn live_dir() -> PathBuf {
    crate::config::data_file("browser").join("live")
}

fn read_live(profile: &str) -> Option<Live> {
    if profile.is_empty() || profile.starts_with('.') || profile.contains(['/', '\\', '\0']) {
        return None;
    }
    parse_live(&std::fs::read_to_string(live_dir().join(format!("{profile}.json"))).ok()?).filter(|l| l.profile == profile)
}

/// 사람이 친 순간 모달 머리에 보던 탭·주소 — 일꾼이 보내기 직전에 지금 입력 대상과 맞춰 본다
#[derive(Deserialize, Clone, Debug)]
pub struct Expect {
    pub target: String,
    pub url: String,
}

/// 출처(스킴://호스트:포트) — 사용자 정보(google.com@)는 빼고 소문자로. 스킴뿐인 주소(about:·data:)는 스킴만
fn origin_of(url: &str) -> String {
    match url.split_once("://") {
        Some((scheme, rest)) => {
            let auth = rest.split(['/', '?', '#']).next().unwrap_or_default();
            format!("{}://{}", scheme.to_ascii_lowercase(), auth.rsplit('@').next().unwrap_or_default().to_ascii_lowercase())
        }
        None => format!("{}:", url.split(':').next().unwrap_or_default().to_ascii_lowercase()),
    }
}

/// 사람이 본 탭이 지금 입력 대상이고 출처도 같은가 — 팝업으로 넘어갔거나 다른 사이트로 이동했으면 false(머리 도메인은 최대 1초쯤 늦게 바뀐다).
/// 같은 출처 안에서 주소만 바뀐 건(SPA) 통과
fn expect_ok(ex: &Expect, target: Option<&str>, pages: &[Page]) -> bool {
    target == Some(ex.target.as_str()) && pages.iter().find(|p| p.id == ex.target).is_some_and(|p| origin_of(&p.url) == origin_of(&ex.url))
}

/// 사람이 친 것(글·파일·대화상자 답·다 했어)은 모달이 보던 그 래퍼(pid)일 때만 — 세션이 끝나고 다른 세션 브라우저가 같은 프로필을 잡으면
/// 모달이 닫히기 전 틈에 친 글이 그쪽으로 갔다(2026-10-04 QA B1 줄기)
fn for_wrapper(live: Option<&Live>, pid: i32) -> bool {
    live.is_some_and(|l| l.pid == pid)
}

/// 일꾼이 붙은 브라우저가 그대로인가 — 포트만 보면 같은 크롬을 새 세션 래퍼가 이어 쓸 때 남은 입력이 새 세션 쪽으로 간다
fn same_wrapper(old: &Live, new: &Live) -> bool {
    new.port == old.port && new.pid == old.pid
}

/// 127.0.0.1:포트에 듣는 곳이 있나 — 크롬이 죽어도 프로필의 포트 파일·상태 파일은 남는다. 루프백이라 없으면 바로 거절된다
pub fn port_open(port: u16) -> bool {
    TcpStream::connect_timeout(&std::net::SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(300)).is_ok()
}

#[derive(Debug, PartialEq)]
pub enum LiveKind {
    Show,
    /// 래퍼가 죽었다(비정상 종료) — 파일을 치운다
    Remove,
    /// 래퍼는 살아 있는데 크롬이 꺼졌다 — 숨기기만(래퍼가 곧 새 포트로 다시 쓸 파일을 앱이 지우면 그 사이 쓴 것까지 날아간다)
    Hide,
}

/// 상태 파일 하나를 보여 줄까 — 크롬이 꺼진 파일을 보여 주면 모달이 '화면 받는 중'에 멈췄다(2026-10-05 QA 5)
pub fn live_kind(l: &Live, alive: impl Fn(i32) -> bool, open: impl Fn(u16) -> bool) -> LiveKind {
    if !alive(l.pid) {
        LiveKind::Remove
    } else if !open(l.port) {
        LiveKind::Hide
    } else {
        LiveKind::Show
    }
}

/// 지금 떠 있는 세션 브라우저들 — 래퍼가 죽었으면(비정상 종료) 그 파일을 치우고, 크롬만 꺼졌으면 빼고 보여 준다
#[tauri::command]
pub fn agent_lives() -> Vec<Live> {
    let Ok(rd) = std::fs::read_dir(live_dir()) else { return vec![] };
    let mut out = vec![];
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let Some(l) = std::fs::read_to_string(&p).ok().as_deref().and_then(parse_live) else { continue };
        match live_kind(&l, crate::platform::pid_alive, port_open) {
            LiveKind::Show => out.push(with_takeover(l)),
            LiveKind::Remove => {
                let _ = std::fs::remove_file(&p);
            }
            LiveKind::Hide => {}
        }
    }
    out.sort_by(|a, b| a.profile.cmp(&b.profile));
    out
}

/// 사람 개입 상태를 채운다 — 세션이 바뀐 개입은 치우고, 개입 중이면 앱이 살아 있다는 표시(래퍼가 3분 안 고쳐지면 푼다).
/// 세션이 사람을 부르는 동안은 기록을 모은다. 쥐고 있으면 보는 칸이 없어도 일꾼을 붙여 둔다(주소·탭 바뀜 기록)
fn with_takeover(mut l: Live) -> Live {
    let dir = live_dir();
    crate::takeover::drop_foreign(&dir, &l.profile, l.pid);
    if let Some((_, at, by)) = crate::takeover::current(&dir, &l.profile) {
        crate::takeover::heartbeat(&dir, &l.profile);
        l.takeover = Some(serde_json::json!({ "by": by, "at": at }));
    }
    match &l.ask {
        Some(a) => crate::takeover::start_ask(&l.profile, l.pid, a["at"].as_u64().unwrap_or(0)),
        None => crate::takeover::drop_ask(&dir, &l.profile),
    }
    if crate::takeover::holding(&l.profile) {
        wake(&l.profile);
    }
    l.scripts = script_users(&crate::config::data_file("browser").join("locks"), &l.profile, l.pid, crate::platform::pid_alive);
    l
}

/// 사람이 조작해도 되나 — 그 래퍼에 개입 중이거나 그 래퍼가 사람을 부르는 중. 아니면 보기만(2026-10-06 사용자 ①)
fn human_ok(profile: &str, pid: i32) -> bool {
    let live = read_live(profile);
    for_wrapper(live.as_ref(), pid) && crate::takeover::allows(&live_dir(), profile, pid, live.as_ref().is_some_and(|l| l.ask.is_some()))
}

/// 사람 개입 시작 — 그 래퍼(pid)에. 그때부터 화면 조작이 되고 래퍼는 세션의 다음 브라우저 도구를 붙잡는다
#[tauri::command]
pub fn agent_takeover(profile: String, pid: i32, by: Option<String>) -> Result<(), String> {
    if !for_wrapper(read_live(&profile).as_ref(), pid) {
        return Err("browser changed".into());
    }
    crate::takeover::start(&live_dir(), &profile, pid, by.as_deref().unwrap_or("desktop"))?;
    #[cfg(not(test))]
    crate::claude::log_out("browser", &format!("사람 개입 시작 ({profile})"));
    wake(&profile);
    Ok(())
}

/// 돌려주기 — 사람이 한 일 기록(.handback)을 먼저 쓰고 개입을 푼다. 래퍼가 붙잡은 세션 도구가 꼬리표와 함께 이어진다
#[tauri::command]
pub fn agent_handback(profile: String, pid: i32) -> Result<(), String> {
    if profile.is_empty() || profile.starts_with('.') || profile.contains(['/', '\\', '\0']) {
        return Err("bad profile".into());
    }
    crate::takeover::hand_back(&live_dir(), &profile, pid)?;
    #[cfg(not(test))]
    crate::claude::log_out("browser", &format!("사람 개입 돌려줌 ({profile})"));
    Ok(())
}

/// 일꾼이 없거나 끝났으면 띄운다(보는 칸이 없어도 — 개입 중 기록용)
fn wake(profile: &str) {
    let running = with_workers(|ws| ws.get(profile).is_some_and(|w| w.view.lock().is_ok_and(|v| !v.done)));
    if !running {
        touch(profile);
    }
}

/// CDP 로 본 탭 하나
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Page {
    pub id: String,
    pub url: String,
    pub title: String,
}

/// 보여 줄 탭 — ① 사용자가 띠에서 고른 탭 ② 사이트가 띄운 새 창(구글·카카오 로그인 팝업·결제창 — 열려 있는 동안)
/// ③ MCP 가 말한 지금 탭 주소와 같은 탭(여럿이면 지금 보던·마지막으로 바뀐 것) ④ 마지막으로 주소가 바뀐 탭 ⑤ 지금 보던 탭 ⑥ 첫 탭.
/// 새 창이 닫히면 ② 가 빠져 원래 탭으로 돌아온다
pub fn pick_target(pages: &[Page], live_url: &str, last_changed: Option<&str>, current: Option<&str>, pinned: Option<&str>, popup: Option<&str>) -> Option<String> {
    let has = |id: &str| pages.iter().any(|p| p.id == id);
    if let Some(p) = pinned.filter(|p| has(p)) {
        return Some(p.to_string());
    }
    if let Some(p) = popup.filter(|p| has(p)) {
        return Some(p.to_string());
    }
    if !live_url.is_empty() {
        let same: Vec<&Page> = pages.iter().filter(|p| p.url == live_url).collect();
        if let Some(p) = same.iter().find(|p| Some(p.id.as_str()) == current).or_else(|| same.iter().find(|p| Some(p.id.as_str()) == last_changed)).or(same.first()) {
            return Some(p.id.clone());
        }
    }
    last_changed.filter(|id| has(id)).or(current.filter(|id| has(id))).map(str::to_string).or_else(|| pages.first().map(|p| p.id.clone()))
}

/// 탭 목록을 새로 읽은 것으로 맞춘다 — 순서는 지금 띠 그대로(띠가 들썩이지 않게), 새 탭은 뒤에, 닫힌 탭은 뺀다
pub fn merge_pages(pages: &mut Vec<Page>, fresh: &[Page]) {
    pages.retain(|p| fresh.iter().any(|f| f.id == p.id));
    for p in pages.iter_mut() {
        if let Some(f) = fresh.iter().find(|f| f.id == p.id) {
            p.title = f.title.clone();
            p.url = f.url.clone();
        }
    }
    for f in fresh {
        if !pages.iter().any(|p| p.id == f.id) {
            pages.push(f.clone());
        }
    }
}

/// 프레임 응답 — [순번 8바이트 LE][jpeg]. 새 프레임이 없으면 빈 것
pub fn pack_frame(seq: u64, jpeg: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(8 + jpeg.len());
    v.extend_from_slice(&seq.to_le_bytes());
    v.extend_from_slice(jpeg);
    v
}

/// 권한 감시 스크립트(agent_perm.js)가 부르는 바인딩 — 일꾼이 붙은 탭에만 넣는다
const PERM_BINDING: &str = "__chammoPerm";
const PERM_JS: &str = include_str!("agent_perm.js");
/// 모달에 띄울 권한 — 감시 스크립트가 이만큼 기다린 뒤 크롬에 넘긴다(그 뒤 버튼은 소용없다)
const PERM_TTL: Duration = Duration::from_secs(60);

/// 사이트가 물은 권한(위치·알림) — 숨긴 크롬의 말풍선 대신 모달에서 허용·거부한다(roadmap 부채 agent-browser-modal ②)
#[derive(Clone, Debug)]
struct Perm {
    kind: String,
    origin: String,
    at: Instant,
}

#[derive(Default)]
struct View {
    /// 지금 프레임의 페이지 크기 — 모달 입력 좌표 환산(agent_input)
    meta: crate::agent_input::Meta,
    /// 보낼 입력(CDP 메서드·인자) — 일꾼이 지금 탭 세션으로 보낸다. 친 글이 들어 있으니 어디에도 안 남긴다
    /// 사람 입력엔 본 탭·주소 꼬리표(Expect) — 다르면 안 보내고 dropped 를 센다
    outbox: Vec<(&'static str, serde_json::Value, Option<Expect>)>,
    /// 탭·주소가 바뀌어 안 보낸 사람 입력 수(모달이 늘어난 걸 보고 알린다)
    dropped: u64,
    /// 탭별 JS 대화상자(alert·confirm·prompt·나가기 확인) — 모달이 지금 탭 것만 띄워 사람이 고른다.
    /// 탭과 묶는다 — 안 묶었더니 다른 탭을 보는 동안에도 앞 탭 대화상자가 떠 있고 거기서 답하면 지금 탭으로 갔다(QA B6)
    dialogs: HashMap<String, serde_json::Value>,
    /// 사람이 고른 대화상자 답(탭, 인자) — 일꾼이 그 대화상자를 받은 세션으로 보낸다
    answers: Vec<(String, serde_json::Value)>,
    /// 멈춘 탭 — 답을 크롬이 거절했거나(앱이 붙기 전에 뜬 대화상자) 페이지가 평가에 답하지 않는다. 모달이 '크롬에서 보기'로 풀게 한다
    stuck: Option<String>,
    /// 사람이 모달에서 마지막으로 누른 때 — 파일 고르기 창이 사람 것인지 가른다
    human_at: Option<Instant>,
    /// 사람이 연 파일 고르기 {mode, backendNodeId} — 앱이 맥 파일 창을 띄워 넣는다(agent_choose_files)
    chooser: Option<serde_json::Value>,
    /// 크롬이 페이지 밖에 창을 띄웠다(패스키·Touch ID·폰 QR 등) — 이 그림엔 안 찍혀 모달이 '크롬에서 보기'로 꺼내게 한다(chrome_popup)
    popup: bool,
    /// 탭별 권한 요청(위치·알림) — 감시 스크립트가 알린 것
    perms: HashMap<String, Perm>,
    /// 사람이 고른 권한 답 — 일꾼이 Browser.setPermission 으로(브라우저 단위, 세션 없음)
    perm_answers: Vec<serde_json::Value>,
    seq: u64,
    jpeg: Vec<u8>,
    pages: Vec<Page>,
    current: Option<String>,
    pinned: Option<String>,
    /// 일꾼이 크롬에 붙어 탭 목록을 읽었다 — 이때 pages 가 비었으면 '탭 0개'(맥 크롬은 마지막 창을 닫아도 포트가 산다), 아니면 아직 붙는 중
    attached: bool,
    /// 일꾼이 끝났다(크롬 닫힘·연결 끊김) — 다음 물음에 새로 띄운다
    done: bool,
    /// 마지막 실패 이유 — 다시 붙는 동안에도 남기고, 붙으면 지운다(모달이 이유를 보여 준다)
    error: String,
    /// 실패로 끝난 때 — RETRY 동안은 다시 안 붙는다
    failed_at: Option<Instant>,
}

struct Worker {
    view: Arc<Mutex<View>>,
    seen: Arc<Mutex<Instant>>,
    stop: Arc<AtomicBool>,
}

static WORKERS: Mutex<Option<HashMap<String, Worker>>> = Mutex::new(None);

fn with_workers<T>(f: impl FnOnce(&mut HashMap<String, Worker>) -> T) -> T {
    let mut g = WORKERS.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashMap::new))
}

/// 3초 안 물으면 보는 칸이 없는 것 — 끊는다
const IDLE: Duration = Duration::from_secs(3);
/// 대화상자가 떠 있으면 보는 칸이 없어도 이만큼 붙어 있는다 — 크롬은 대화상자가 뜰 때 Page 를 켜 둔 세션의 답만 받고
/// 새로 붙은 세션의 답은 'No dialog is showing' 으로 거절해서, 끊었다 다시 붙으면 앱에선 못 풀었다(QA B6). 세션 브라우저 유휴 닫기(10분)보다 길게
const DIALOG_HOLD: Duration = Duration::from_secs(15 * 60);
/// 붙을 때 묻는 '살아 있나'(Runtime.evaluate)가 이만큼 안 오면 멈춘 페이지 — 앱이 붙기 전에 뜬 대화상자일 수 있다
const PROBE_WAIT: Duration = Duration::from_millis(1500);

/// 화면 받기에 실패하면 이만큼은 그 일꾼(이유)을 보여 주고 다시 붙지 않는다 — 물음(66ms)마다 새로 띄웠더니 이유가 바로 지워졌다(QA 5)
const RETRY: Duration = Duration::from_secs(2);

/// 있는 일꾼을 그대로 쓸까 — 도는 중이거나, 막 실패해 이유를 보여 주는 중이면
pub fn reuse_worker(done: bool, failed_at: Option<Instant>, now: Instant) -> bool {
    !done || failed_at.is_some_and(|t| now.duration_since(t) < RETRY)
}

/// 일꾼을 계속 둘까 — 보는 칸이 있거나, 이 일꾼만 답할 수 있는 대화상자가 떠 있거나, 사람이 쥐고 있으면(개입·부름 — 주소·탭 바뀜을 기록)
pub fn keep_running(idle: Duration, has_dialog: bool, holding: bool) -> bool {
    idle <= IDLE || (has_dialog && idle <= DIALOG_HOLD) || holding
}

/// 그 프로필 일꾼을 깨우고(없거나 끝났으면 새로) 보는 중이라고 알린다
fn touch(profile: &str) -> Arc<Mutex<View>> {
    with_workers(|ws| {
        let mut last_error = String::new();
        if let Some(w) = ws.get(profile) {
            let (done, failed_at, error) = w.view.lock().map(|v| (v.done, v.failed_at, v.error.clone())).unwrap_or((true, None, String::new()));
            if reuse_worker(done, failed_at, Instant::now()) {
                if !done {
                    *w.seen.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
                }
                return w.view.clone();
            }
            last_error = error;
        }
        // 다시 붙는 동안에도 지난 이유를 남긴다 — 붙으면 run 이 지운다(안 남기면 2초마다 이유와 '화면 받는 중'이 번갈아 보인다)
        let view = View { error: last_error, ..View::default() };
        let w = Worker { view: Arc::new(Mutex::new(view)), seen: Arc::new(Mutex::new(Instant::now())), stop: Arc::new(AtomicBool::new(false)) };
        let (view, seen, stop, p) = (w.view.clone(), w.seen.clone(), w.stop.clone(), profile.to_string());
        std::thread::spawn(move || {
            let err = run(&p, &view, &seen, &stop).err().unwrap_or_default();
            if let Ok(mut v) = view.lock() {
                v.done = true;
                v.attached = false;
                v.failed_at = (!err.is_empty()).then(Instant::now);
                v.error = err;
            }
        });
        let v = w.view.clone();
        if let Some(old) = ws.insert(profile.to_string(), w) {
            old.stop.store(true, Ordering::Relaxed);
        }
        v
    })
}

/// 화면 한 장 — since 보다 새 프레임이 있으면 [순번][jpeg], 없으면 빈 것. 묻는 동안만 받는다
#[tauri::command]
pub fn agent_frame(profile: String, since: u64) -> tauri::ipc::Response {
    tauri::ipc::Response::new(frame_bytes(&profile, since))
}

/// agent_frame 의 몸통 — 폰 서버(mobile.rs)도 같은 일꾼에서 받는다
pub fn frame_bytes(profile: &str, since: u64) -> Vec<u8> {
    let view = touch(profile);
    let v = view.lock().unwrap_or_else(|e| e.into_inner());
    if v.seq > since && !v.jpeg.is_empty() { pack_frame(v.seq, &v.jpeg) } else { vec![] }
}

/// 폰 브라우저 보기의 화면 받기 상태 — 이유(주소 뺀 한 줄, 120자)·붙음·탭 수. 폰이 맥 모달과 같은 판단(browserScreen)으로 이유를 보인다.
/// 포트·devtools 경로는 맥 안에서만(lives_for_phone 과 같은 선) — 주소·절대 경로 낱말은 '…'로, 끝의 구두점은 남긴다
pub fn phone_screen(error: &str, attached: bool, pages: usize) -> serde_json::Value {
    let words: Vec<String> = error
        .split(' ')
        .map(|w| {
            if w.contains("://") || w.starts_with('/') {
                let tail = w.len() - w.trim_end_matches([':', ',', ';', ')']).len();
                format!("…{}", &w[w.len() - tail..])
            } else {
                w.to_string()
            }
        })
        .collect();
    let why: String = words.join(" ").chars().take(120).collect();
    serde_json::json!({ "error": why, "attached": attached, "pages": pages })
}

/// 일꾼이 있으면 그 화면 받기 상태 — 새로 띄우지 않는다(목록 읽기가 크롬에 붙으면 안 된다)
fn screen_of(profile: &str) -> Option<serde_json::Value> {
    with_workers(|ws| ws.get(profile).and_then(|w| w.view.lock().ok().map(|v| phone_screen(&v.error, v.attached, v.pages.len()))))
}

/// 폰에 보낼 세션 브라우저 목록 — 보기에 필요한 것만(포트·devtools 경로·래퍼 pid 는 맥 안에서만).
/// 개입·부름 상태도(부름은 이유 한 줄만) — 폰에서도 개입·돌려주기·다 했어를 한다(2026-10-06 사용자 ⑥)
pub fn lives_for_phone() -> serde_json::Value {
    serde_json::Value::Array(agent_lives().into_iter().map(|l| serde_json::json!({
        "profile": l.profile, "sessionPid": l.session_pid, "url": l.url, "title": l.title, "tabs": l.tabs,
        "tool": l.tool, "toolAt": l.tool_at, "busy": l.busy, "ts": l.ts,
        "ask": l.ask.as_ref().map(|a| serde_json::json!({ "reason": a["reason"], "at": a["at"] })), "gate": l.gate, "held": l.held, "takeover": l.takeover, "scripts": l.scripts,
        "screen": screen_of(&l.profile),
    })).collect())
}

/// 폰이 본 그 세션(sessionPid)의 지금 래퍼 pid — 세션이 바뀌었으면 None
fn phone_pid(profile: &str, session_pid: i32) -> Option<Live> {
    read_live(profile).filter(|l| l.session_pid == session_pid)
}

/// 폰에서 개입·돌려주기. 세션이 부르는 중이면 돌려주기 = '다 했어'
pub fn phone_takeover(profile: &str, session_pid: i32, on: bool) -> Result<(), String> {
    let l = phone_pid(profile, session_pid).ok_or("browser changed")?;
    match (on, l.ask.is_some()) {
        (true, true) => Ok(()), // 부르는 중엔 이미 조작할 수 있다
        (true, false) => agent_takeover(profile.to_string(), l.pid, Some("phone".into())),
        (false, true) => agent_ask_done(profile.to_string(), l.pid, None),
        (false, false) => agent_handback(profile.to_string(), l.pid),
    }
}

/// 폰에서 누르기·글자·스크롤 — 데스크톱 모달과 같은 길(agent_input). 폰은 탭 목록을 안 받으니 지금 보여 주는 탭으로 맞춰 본다
pub fn phone_input(profile: &str, session_pid: i32, events: Vec<crate::agent_input::InputEv>) -> Result<(), String> {
    let l = phone_pid(profile, session_pid).ok_or("browser changed")?;
    if !human_ok(profile, l.pid) {
        return Err("not in control".into());
    }
    let expect = {
        let view = touch(profile);
        let v = view.lock().unwrap_or_else(|e| e.into_inner());
        v.current.as_ref().and_then(|c| v.pages.iter().find(|p| &p.id == c)).map(|p| Expect { target: p.id.clone(), url: p.url.clone() })
    };
    agent_input(profile.to_string(), l.pid, expect, events);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tabs {
    pages: Vec<Page>,
    current: Option<String>,
    pinned: bool,
    error: String,
    /// 일꾼이 붙어 탭 목록을 읽었다 — 모달이 '탭 0개'(닫힘)와 '붙는 중'을 가른다
    attached: bool,
    /// 지금 탭에 열린 JS 대화상자 {type, message, defaultPrompt}
    dialog: Option<serde_json::Value>,
    /// 대화상자가 떠 있는 탭들(탭 띠 표시)
    dialog_tabs: Vec<String>,
    /// 지금 탭이 멈춰 있다(답이 안 들어감·모르는 대화상자) — '크롬에서 보기'로 풀 것
    stuck: bool,
    /// 진짜 크롬 창을 보이게 꺼내 둔 상태('크롬에서 보기') — 막대에 숨기기 아이콘
    shown: bool,
    /// 파일 고르기 창이 열렸다 — 'multiple'·'single' (모달이 맥 파일 창을 띄운다)
    chooser: Option<String>,
    /// 꺼낸 창을 사람이 닫아 앱이 빈 탭을 다시 열어 뒀다(그 빈 탭을 보는 동안)
    reopened: bool,
    /// 탭·주소가 바뀌어 안 보낸 사람 입력 수
    dropped: u64,
    /// 크롬이 이 그림 밖에 창을 띄웠다(패스키 등) — 모달이 '크롬에서 보기' 줄을 띄운다
    popup: bool,
    /// 지금 탭이 물은 권한 {kind, origin} — 모달이 허용·거부를 띄운다
    permission: Option<serde_json::Value>,
    /// 멈춘 탭 대화상자를 래퍼에 부탁한 결과 {at, ok, error}(takeover::dialog_done) — 못 풀었으면 모달이 알린다
    wrapper_dialog: Option<serde_json::Value>,
}

/// 탭 띠 — CDP 로 본 탭들과 지금 보여 주는 탭
#[tauri::command]
pub fn agent_tabs(profile: String) -> Tabs {
    let view = touch(&profile);
    let v = view.lock().unwrap_or_else(|e| e.into_inner());
    let live = read_live(&profile);
    let shown = live.as_ref().and_then(|l| chrome_pid(l.port)).is_some_and(|p| self::shown().contains(&p));
    let wrapper_dialog = live.as_ref().and_then(|l| crate::takeover::dialog_done(&live_dir(), &profile, l.pid));
    let chooser = v.chooser.as_ref().map(|c| if c["mode"] == "selectMultiple" { "multiple".to_string() } else { "single".to_string() });
    let blank = v.current.as_ref().and_then(|c| v.pages.iter().find(|p| &p.id == c)).is_some_and(|p| p.url == "about:blank");
    let reopened = blank && REOPENED.lock().is_ok_and(|r| r.contains(&profile));
    let dialog = v.current.as_ref().and_then(|c| v.dialogs.get(c)).cloned();
    let dialog_tabs = v.pages.iter().filter(|p| v.dialogs.contains_key(&p.id)).map(|p| p.id.clone()).collect();
    let stuck = v.current.is_some() && v.stuck == v.current && dialog.is_none();
    Tabs { pages: v.pages.clone(), current: v.current.clone(), pinned: v.pinned.is_some(), error: v.error.clone(), attached: v.attached, dialog, dialog_tabs, stuck, shown, chooser, reopened, dropped: v.dropped, popup: v.popup, permission: perm_of(&v), wrapper_dialog }
}

/// 멈춘 탭(앱이 붙기 전에 뜬 대화상자) 답을 래퍼에 부탁 — 그 래퍼가 세션 도구를 붙잡는 래퍼(gate)일 때만. 사람 조작으로 센다
#[tauri::command]
pub fn agent_dialog_wrapper(profile: String, pid: i32, accept: bool) -> Result<(), String> {
    if !human_ok(&profile, pid) || !read_live(&profile).is_some_and(|l| l.gate) {
        return Err("not allowed".into());
    }
    crate::takeover::ask_dialog(&live_dir(), &profile, pid, accept)?;
    crate::takeover::record(&profile, crate::takeover_note::dialog(accept));
    Ok(())
}

/// 화면 다시 받기 — 실패해 쉬는 일꾼의 기다림(RETRY)을 풀어 다음 물음에 바로 다시 붙는다. 도는 일꾼(탭 0개로 '닫혔어'인 때 등)도
/// 끊어 새로 붙인다 — 눌러도 아무 일이 없었다(리뷰). 대화상자가 떠 있으면 그대로(그 대화상자는 이 일꾼 세션으로만 답할 수 있다, QA B6)
#[tauri::command]
pub fn agent_retry(profile: String) {
    with_workers(|ws| {
        if let Some(w) = ws.get(&profile) {
            if let Ok(mut v) = w.view.lock() {
                v.failed_at = None;
                if retry_restarts(v.done, !v.dialogs.is_empty()) {
                    w.stop.store(true, Ordering::Relaxed);
                }
            }
        }
    });
}

/// 다시 시도가 도는 일꾼을 끊을까 — 대화상자를 쥐고 있지 않을 때만
pub fn retry_restarts(done: bool, has_dialog: bool) -> bool {
    !done && !has_dialog
}

/// 띠에서 탭을 골라 보기(에이전트 조작엔 안 끼어든다). None = 다시 알아서 따라가기
#[tauri::command]
pub fn agent_pin(profile: String, target: Option<String>) {
    let view = touch(&profile);
    view.lock().unwrap_or_else(|e| e.into_inner()).pinned = target;
}

/// 모달에서 직접 조작 — 클릭·스크롤·키·글을 그 크롬 지금 탭에(CDP Input). 모양이 이상한 건 조용히 버린다
#[tauri::command]
pub fn agent_input(profile: String, pid: i32, expect: Option<Expect>, events: Vec<crate::agent_input::InputEv>) {
    if !human_ok(&profile, pid) {
        return;
    }
    let view = touch(&profile);
    let mut v = view.lock().unwrap_or_else(|e| e.into_inner());
    // 지금 탭·주소를 아직 모르면(모달이 막 열림) 안 보낸다 — 어디로 갈지 모르는 글
    let Some(expect) = expect else {
        v.dropped += 1;
        return;
    };
    let meta = v.meta;
    v.human_at = Some(Instant::now());
    for e in events.iter().take(200) {
        if let Some((m, p)) = crate::agent_input::to_cdp(e, meta) {
            v.outbox.push((m, p, Some(expect.clone())));
        }
    }
}

/// JS 대화상자 답(확인·취소, prompt 글) — 모달이 띄운 그 탭(target, 없으면 지금 탭)의 대화상자에. 그 탭에 대화상자가 없으면 버린다
#[tauri::command]
pub fn agent_dialog(profile: String, pid: i32, target: Option<String>, accept: bool, prompt: Option<String>) {
    if !human_ok(&profile, pid) {
        return;
    }
    let view = touch(&profile);
    if queue_answer(&mut view.lock().unwrap_or_else(|e| e.into_inner()), target, accept, prompt) {
        crate::takeover::record(&profile, crate::takeover_note::dialog(accept));
    }
}

/// 답을 줄에 — 그 탭에 아는 대화상자가 있을 때만(지금 탭에 없는데 앞 탭 것으로 가거나, 같은 대화상자에 두 번 가지 않게)
fn queue_answer(v: &mut View, target: Option<String>, accept: bool, prompt: Option<String>) -> bool {
    let Some(t) = target.or_else(|| v.current.clone()) else { return false };
    if v.dialogs.remove(&t).is_none() {
        return false;
    }
    let mut p = serde_json::json!({ "accept": accept });
    if let Some(text) = prompt.filter(|t| t.len() <= 10_000) {
        p["promptText"] = serde_json::json!(text);
    }
    v.answers.push((t, p));
    true
}

/// 권한 답을 줄에 — 그 탭(없으면 지금 탭)에 요청이 있을 때만, 한 번
fn queue_permission(v: &mut View, target: Option<String>, allow: bool) -> bool {
    let Some(t) = target.or_else(|| v.current.clone()) else { return false };
    let Some(p) = v.perms.remove(&t) else { return false };
    v.perm_answers.push(serde_json::json!({ "permission": { "name": p.kind }, "setting": if allow { "granted" } else { "denied" }, "origin": p.origin }));
    true
}

/// 지금 탭의 권한 요청 {kind, origin} — 감시 스크립트가 아직 기다리는 것만
fn perm_of(v: &View) -> Option<serde_json::Value> {
    let p = v.perms.get(v.current.as_ref()?)?;
    (p.at.elapsed() < PERM_TTL).then(|| serde_json::json!({ "kind": p.kind, "origin": p.origin }))
}

/// 사이트가 물은 위치·알림 권한에 답 — 사람 조작(개입 중·세션이 부르는 중)일 때만
#[tauri::command]
pub fn agent_permission(profile: String, pid: i32, target: Option<String>, allow: bool) {
    if !human_ok(&profile, pid) {
        return;
    }
    let view = touch(&profile);
    queue_permission(&mut view.lock().unwrap_or_else(|e| e.into_inner()), target, allow);
}

/// 모달 위로 끌어다 놓은 파일 — 그 자리에 drag 로 놓는다(파일 칸·올리기 칸). 경로는 크롬에만, 어디에도 안 남긴다
#[tauri::command]
pub fn agent_drop_files(profile: String, pid: i32, expect: Expect, paths: Vec<String>, x: f64, y: f64) -> usize {
    if !human_ok(&profile, pid) {
        return 0;
    }
    let view = touch(&profile);
    let mut v = view.lock().unwrap_or_else(|e| e.into_inner());
    let evs = crate::agent_input::drop_events(&paths, x, y, v.meta);
    let n = evs.len();
    if n > 0 {
        crate::takeover::record(&profile, crate::takeover_note::files(paths.len()));
    }
    v.human_at = Some(Instant::now());
    v.outbox.extend(evs.into_iter().map(|(m, p)| (m, p, Some(expect.clone()))));
    n
}

/// 사람이 연 파일 고르기 — 앱의 파일 창(NSOpenPanel)으로 고른 파일을 그 칸에(DOM.setFileInputFiles). 취소면 false
#[tauri::command]
pub async fn agent_choose_files(app: tauri::AppHandle, profile: String, pid: i32) -> Result<bool, String> {
    if !human_ok(&profile, pid) {
        return Ok(false);
    }
    let view = touch(&profile);
    let Some(ch) = view.lock().unwrap_or_else(|e| e.into_inner()).chooser.take() else { return Ok(false) };
    let multiple = ch["mode"] == "selectMultiple";
    let files = tauri::async_runtime::spawn_blocking(move || choose_files(&app, multiple)).await.map_err(|e| e.to_string())??;
    if files.is_empty() {
        return Ok(false);
    }
    // 파일 창이 떠 있는 동안 브라우저가 바뀌었으면 안 넣는다
    if !for_wrapper(read_live(&profile).as_ref(), pid) {
        return Ok(false);
    }
    crate::takeover::record(&profile, crate::takeover_note::files(files.len()));
    let mut v = view.lock().unwrap_or_else(|e| e.into_inner());
    v.outbox.push(("DOM.setFileInputFiles", serde_json::json!({ "files": files, "backendNodeId": ch["backendNodeId"] }), None)); // 그 페이지 칸 번호에 묶여 있어 다른 탭엔 안 들어간다
    Ok(true)
}

/// 파일 창 — 앱 창에 붙는 시트(NSOpenPanel). osascript 'choose file' 은 맥이 자리를 골라 가상 모니터 위에 떠서 사람이 못 봤고,
/// runModal 은 창이 떠 있는 동안 앱 메인 스레드를 붙잡았다(2026-10-03 실측). 고른 경로는 돌려주기만 하고 남기지 않는다
fn choose_files(app: &tauri::AppHandle, multiple: bool) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        let win = app.get_webview_window("main").ok_or("no window")?.ns_window().map_err(|e| e.to_string())? as usize;
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || open_sheet(win, multiple, tx)).map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, multiple);
        Err("file chooser: mac only".into())
    }
}

#[cfg(target_os = "macos")]
fn open_sheet(win: usize, multiple: bool, tx: std::sync::mpsc::Sender<Vec<String>>) {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;
    let msg = NSString::from_str(crate::i18n::tr("세션 브라우저에 올릴 파일", "File to upload in the session browser"));
    unsafe {
        let Some(panel): Option<Retained<AnyObject>> = msg_send![class!(NSOpenPanel), openPanel] else {
            let _ = tx.send(vec![]);
            return;
        };
        let _: () = msg_send![&*panel, setCanChooseFiles: true];
        let _: () = msg_send![&*panel, setCanChooseDirectories: false];
        let _: () = msg_send![&*panel, setAllowsMultipleSelection: multiple];
        let _: () = msg_send![&*panel, setMessage: &*msg];
        let p = panel.clone();
        let done = RcBlock::new(move |r: isize| {
            // NSModalResponseOK = 1, 그 밖은 취소
            let files = if r == 1 { panel_paths(&p) } else { vec![] };
            let _ = tx.send(files);
        });
        let _: () = msg_send![&*panel, beginSheetModalForWindow: win as *mut AnyObject, completionHandler: &*done];
    }
}

#[cfg(target_os = "macos")]
fn panel_paths(panel: &objc2::runtime::AnyObject) -> Vec<String> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_foundation::NSString;
    unsafe {
        let urls: *mut AnyObject = msg_send![panel, URLs];
        let Some(urls) = urls.as_ref() else { return vec![] };
        let n: usize = msg_send![urls, count];
        (0..n)
            .filter_map(|i| {
                let u: *mut AnyObject = msg_send![urls, objectAtIndex: i];
                let p: *mut NSString = msg_send![u.as_ref()?, path];
                p.as_ref().map(|p| p.to_string())
            })
            .collect()
    }
}

/// .done 에 적을 표 — 그 래퍼(pid)의 지금 부름(ask.at). 모달이 보던 부름(at)이 있으면 같을 때만.
/// 래퍼는 표가 지금 부름과 같을 때만 끝낸다 — 검사·쓰기 사이 틈에 새 부름을 대신 끝내지 않게(2026-10-04 ①)
fn done_mark(live: Option<&Live>, pid: i32, at: Option<u64>) -> Option<String> {
    let l = live.filter(|l| for_wrapper(Some(l), pid))?;
    let now = l.ask.as_ref()?.get("at")?.as_u64()?;
    (at.is_none() || at == Some(now)).then(|| format!("{pid}:{now}"))
}

/// 사람이 다 했다(browser_ask_human 에 답) — 래퍼가 기다리는 <live>/<프로필>.done. at = 모달이 보던 부름(ask.at, 폰은 없음)
#[tauri::command]
pub fn agent_ask_done(profile: String, pid: i32, at: Option<u64>) -> Result<(), String> {
    if profile.is_empty() || profile.starts_with('.') || profile.contains(['/', '\\', '\0']) {
        return Err("bad profile".into());
    }
    // 다른 세션 브라우저가 같은 프로필을 잡았으면 그 세션의 부름을 대신 끝내지 않는다
    let live = read_live(&profile);
    if !for_wrapper(live.as_ref(), pid) {
        return Err("browser changed".into());
    }
    // 사람이 한 일 기록을 먼저(래퍼는 .done 을 보자마자 읽는다)
    crate::takeover::ask_done(&live_dir(), &profile, pid)?;
    let Some(mark) = done_mark(live.as_ref(), pid, at) else { return Err("ask changed".into()) };
    let f = live_dir().join(format!("{profile}.done"));
    std::fs::write(&f, mark.as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

// ── CDP ────────────────────────────────────────────────────────────

type Ws = tungstenite::WebSocket<TcpStream>;

fn connect(l: &Live) -> Result<Ws, String> {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], l.port));
    let tcp = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).map_err(|e| e.to_string())?;
    tcp.set_read_timeout(Some(Duration::from_millis(250))).map_err(|e| e.to_string())?;
    tcp.set_nodelay(true).ok();
    let url = format!("ws://127.0.0.1:{}{}", l.port, l.ws_path);
    let (ws, _) = tungstenite::client::client(url.as_str(), tcp).map_err(|e| e.to_string())?;
    Ok(ws)
}

struct Cdp {
    ws: Ws,
    next: u64,
}

impl Cdp {
    fn send(&mut self, method: &str, params: serde_json::Value, session: Option<&str>) -> Result<u64, String> {
        self.next += 1;
        let mut m = serde_json::json!({ "id": self.next, "method": method, "params": params });
        if let Some(s) = session {
            m["sessionId"] = s.into();
        }
        self.ws.send(tungstenite::Message::text(m.to_string())).map_err(|e| e.to_string())?;
        Ok(self.next)
    }
    /// 한 통 — 시간 안에 없으면 None
    fn recv(&mut self) -> Result<Option<serde_json::Value>, String> {
        match self.ws.read() {
            Ok(tungstenite::Message::Text(t)) => Ok(serde_json::from_str(t.as_str()).ok()),
            Ok(tungstenite::Message::Close(_)) => Err("closed".into()),
            Ok(_) => Ok(None),
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    /// 그 id 의 답을 기다린다(사이에 온 사건은 handle 로)
    fn call(&mut self, method: &str, params: serde_json::Value, session: Option<&str>, handle: impl FnMut(&serde_json::Value)) -> Result<serde_json::Value, String> {
        self.call_for(method, params, session, Duration::from_secs(5), handle)
    }
    /// call 을 기다릴 시간을 정해서 — 대화상자에 막힌 페이지는 그림·평가가 안 돌아와 일꾼이 그동안 입력을 못 보낸다
    fn call_for(&mut self, method: &str, params: serde_json::Value, session: Option<&str>, wait: Duration, mut handle: impl FnMut(&serde_json::Value)) -> Result<serde_json::Value, String> {
        let id = self.send(method, params, session)?;
        let until = Instant::now() + wait;
        while Instant::now() < until {
            if let Some(m) = self.recv()? {
                if m["id"].as_u64() == Some(id) {
                    return if m.get("error").is_some() { Err(m["error"].to_string()) } else { Ok(m["result"].clone()) };
                }
                handle(&m);
            }
        }
        Err(format!("{method}: no answer"))
    }
}

fn page_of(info: &serde_json::Value) -> Option<Page> {
    (info["type"] == "page").then(|| Page { id: info["targetId"].as_str().unwrap_or_default().into(), url: info["url"].as_str().unwrap_or_default().into(), title: info["title"].as_str().unwrap_or_default().into() })
}

/// 일꾼이 붙어 있는 동안의 상태
#[derive(Default)]
struct St {
    profile: String,
    pages: Vec<Page>,
    last_changed: Option<String>,
    /// 지금 보여 주는 탭과 그 세션
    target: Option<String>,
    session: Option<String>,
    /// 붙여 둔 탭 → 세션. 탭을 바꿔도 떼지 않는다 — 대화상자는 그게 뜰 때 Page 를 켜 둔 세션으로만 답할 수 있다(QA B6)
    sessions: HashMap<String, String>,
    acks: Vec<String>,
    popups: Vec<String>,
    /// 묻고 아직 답이 없는 '살아 있나'(요청 번호, 탭, 보낸 때) — 늦게라도 답이 오면 그 탭은 풀린 것
    probes: Vec<(u64, String, Instant)>,
    /// 지금 탭 화면을 받는 중 — 아무도 안 보는데 대화상자 때문에 붙어 있는 동안은 끈다
    casting: bool,
    /// 사람 개입 기록용으로 물은 요소 설명(요청 번호, 누름이면 true·글자면 false) — 답은 on_event 가 기록한다
    describes: Vec<(u64, bool)>,
}

fn screencast_params() -> serde_json::Value {
    serde_json::json!({ "format": "jpeg", "quality": 60, "maxWidth": 1280, "maxHeight": 800, "everyNthFrame": 1 })
}

impl St {
    fn target_of(&self, session: Option<&str>) -> Option<String> {
        let s = session?;
        self.sessions.iter().find(|(_, v)| v.as_str() == s).map(|(k, _)| k.clone())
    }
}

/// 사건 처리 — 탭 목록·바뀐 탭·대화상자·프레임(받은 프레임 번호는 acks 에 모아 확인을 돌려준다 — 안 돌려주면 크롬이 다음 프레임을 안 보낸다)
fn on_event(m: &serde_json::Value, view: &Arc<Mutex<View>>, st: &mut St) {
    if let Some(id) = m["id"].as_u64() {
        // 사람 개입 기록 — 누른 곳·글자 넣은 칸의 이름(값 없음, takeover::describe_js)
        if let Some(i) = st.describes.iter().position(|d| d.0 == id) {
            let (_, click) = st.describes.remove(i);
            let raw = m["result"]["result"]["value"].as_str().unwrap_or_default();
            let ev = if click { crate::takeover_note::click(raw) } else { Some(crate::takeover_note::typed(raw)) };
            if let Some(ev) = ev {
                crate::takeover::record(&st.profile, ev);
            }
            return;
        }
    }
    // '살아 있나'의 답 — 그 탭은 대화상자에 막혀 있지 않다
    if let Some(id) = m["id"].as_u64() {
        if let Some(i) = st.probes.iter().position(|p| p.0 == id) {
            let (_, t, _) = st.probes.remove(i);
            st.probes.retain(|p| p.1 != t);
            if let Ok(mut v) = view.lock() {
                if v.stuck.as_ref() == Some(&t) {
                    v.stuck = None;
                }
            }
        }
        return;
    }
    let mine = m["sessionId"].as_str().is_some() && m["sessionId"].as_str() == st.session.as_deref();
    match m["method"].as_str().unwrap_or_default() {
        "Target.targetCreated" | "Target.targetInfoChanged" => {
            let info = &m["params"]["targetInfo"];
            // 사이트가 띄운 새 창(openerId 가 있는 page) — 열려 있는 동안 그 창을 보여 준다
            if m["method"] == "Target.targetCreated" && info["type"] == "page" && info["openerId"].as_str().is_some_and(|o| !o.is_empty()) {
                if let Some(id) = info["targetId"].as_str() {
                    st.popups.retain(|p| p != id);
                    st.popups.push(id.to_string());
                }
            }
            if let Some(p) = page_of(info) {
                let known = st.pages.iter().any(|x| x.id == p.id);
                let changed = st.pages.iter().find(|x| x.id == p.id).is_none_or(|x| x.url != p.url);
                if changed {
                    st.last_changed = Some(p.id.clone());
                    // 사람이 쥔 동안 간 주소·연 탭(쥐지 않았으면 record 가 버린다). 처음 붙을 때 본 탭은 known 이라 '연 탭'이 아니다
                    if let Some(ev) = crate::takeover_note::nav(&p.url) {
                        crate::takeover::record(&st.profile, ev);
                    }
                }
                if !known && m["method"] == "Target.targetCreated" && !st.profile.is_empty() {
                    crate::takeover::record(&st.profile, crate::takeover_note::tab_opened(&p.url));
                }
                st.pages.retain(|x| x.id != p.id);
                st.pages.push(p);
            }
        }
        "Target.targetDestroyed" => {
            let gone = m["params"]["targetId"].as_str().unwrap_or_default().to_string();
            if let Some(p) = st.pages.iter().find(|x| x.id == gone) {
                crate::takeover::record(&st.profile, crate::takeover_note::tab_closed(&p.url));
            }
            st.pages.retain(|x| x.id != gone);
            st.popups.retain(|p| *p != gone);
            st.sessions.remove(&gone);
            st.probes.retain(|p| p.1 != gone);
            if let Ok(mut v) = view.lock() {
                v.dialogs.remove(&gone);
                v.perms.remove(&gone);
                if v.stuck.as_ref() == Some(&gone) {
                    v.stuck = None;
                }
            }
        }
        "Runtime.bindingCalled" if m["params"]["name"] == PERM_BINDING => {
            let Some(t) = st.target_of(m["sessionId"].as_str()) else { return };
            let kind = serde_json::from_str::<serde_json::Value>(m["params"]["payload"].as_str().unwrap_or_default()).ok().and_then(|p| p["kind"].as_str().map(str::to_string));
            let Some(kind) = kind.filter(|k| ["geolocation", "notifications"].contains(&k.as_str())) else { return };
            let Some(url) = st.pages.iter().find(|p| p.id == t).map(|p| p.url.clone()) else { return };
            if let Ok(mut v) = view.lock() {
                v.perms.insert(t, Perm { kind, origin: origin_of(&url), at: Instant::now() });
            }
        }
        "Page.javascriptDialogOpening" => {
            let Some(t) = st.target_of(m["sessionId"].as_str()) else { return };
            let p = &m["params"];
            if let Ok(mut v) = view.lock() {
                v.dialogs.insert(t.clone(), serde_json::json!({ "type": p["type"], "message": p["message"], "defaultPrompt": p["defaultPrompt"] }));
                if v.stuck.as_ref() == Some(&t) {
                    v.stuck = None;
                }
            }
        }
        "Page.javascriptDialogClosed" => {
            let Some(t) = st.target_of(m["sessionId"].as_str()) else { return };
            if let Ok(mut v) = view.lock() {
                v.dialogs.remove(&t);
                if v.stuck.as_ref() == Some(&t) {
                    v.stuck = None;
                }
            }
        }
        // 파일 고르기 — 사람이 모달에서 막 누른 것만(세션이 누른 건 플레이라이트 browser_file_upload 몫)
        "Page.fileChooserOpened" if mine => {
            if let Ok(mut v) = view.lock() {
                if crate::agent_input::chooser_by_human(v.human_at, Instant::now()) {
                    let p = &m["params"];
                    v.chooser = Some(serde_json::json!({ "mode": p["mode"], "backendNodeId": p["backendNodeId"] }));
                    // 플레이라이트도 이 창을 '[File chooser]' 로 쌓아 세션 도구를 막는다(QA N3) — 래퍼가 다음 호출 앞에서 치우게 센다
                    if !st.profile.is_empty() {
                        bump_count(&live_dir().join(format!("{}.choosers", st.profile)));
                    }
                }
            }
        }
        "Page.screencastFrame" if mine => {
            if let Ok(jpeg) = base64::engine::general_purpose::STANDARD.decode(m["params"]["data"].as_str().unwrap_or_default()) {
                if let Ok(mut v) = view.lock() {
                    v.seq += 1;
                    v.jpeg = jpeg;
                    let md = &m["params"]["metadata"];
                    if let (Some(w), Some(h)) = (md["deviceWidth"].as_f64(), md["deviceHeight"].as_f64()) {
                        v.meta = crate::agent_input::Meta { w, h };
                    }
                }
            }
            if let Some(n) = m["params"]["sessionId"].as_i64() {
                st.acks.push(n.to_string());
            }
        }
        _ => {}
    }
}

/// 사람 입력 하나에 붙일 요소 설명 JS — 누르기(그 자리)·글자 넣기(포커스 칸). 나머지는 None
fn human_note(method: &str, p: &serde_json::Value) -> Option<(String, bool)> {
    match method {
        "Input.dispatchMouseEvent" if p["type"] == "mousePressed" => Some((crate::takeover_note::describe_js(Some((p["x"].as_f64()?, p["y"].as_f64()?))), true)),
        "Input.insertText" => Some((crate::takeover_note::describe_js(None), false)),
        _ => None,
    }
}

/// 수 파일 하나 늘리기(600, 통째로 바꿔 씀 — 래퍼가 반쯤 쓴 걸 안 읽게). 모양이 이상하면 0 부터
fn bump_count(f: &std::path::Path) {
    let n = std::fs::read_to_string(f).ok().and_then(|t| t.trim().parse::<u64>().ok()).unwrap_or(0);
    let tmp = f.with_extension("choosers.tmp");
    if std::fs::write(&tmp, (n + 1).to_string()).is_err() {
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    let _ = std::fs::rename(&tmp, f);
}

/// 그 탭에 '살아 있나'를 묻는다 — 대화상자에 막힌 페이지는 평가가 안 돌아온다(답은 on_event 가 받는다). 탭마다 하나만 걸어 둔다
fn probe(cdp: &mut Cdp, st: &mut St, target: &str, session: &str) {
    if st.probes.len() >= 20 || st.probes.iter().any(|p| p.1 == target) {
        return;
    }
    if let Ok(id) = cdp.send("Runtime.evaluate", serde_json::json!({ "expression": "1", "returnByValue": true }), Some(session)) {
        st.probes.push((id, target.to_string(), Instant::now()));
    }
}

/// 지금 탭을 한 장 직접 찍는다 — 화면이 가만히 있으면 screencast 가 첫 장을 안 보내 옛 탭 그림이 남았다(2026-10-03 실측).
/// 대화상자에 막힌 페이지는 그림이 안 올 수 있어 짧게만 기다린다
fn snap(cdp: &mut Cdp, s: &str, view: &Arc<Mutex<View>>, st: &mut St) {
    let mut buf = vec![];
    if let Ok(shot) = cdp.call_for("Page.captureScreenshot", serde_json::json!({ "format": "jpeg", "quality": 60, "optimizeForSpeed": true }), Some(s), Duration::from_millis(1500), |m| buf.push(m.clone())) {
        if let Ok(jpeg) = base64::engine::general_purpose::STANDARD.decode(shot["data"].as_str().unwrap_or_default()) {
            if let Ok(mut v) = view.lock() {
                v.seq += 1;
                v.jpeg = jpeg;
            }
        }
    }
    for m in buf {
        on_event(&m, view, st);
    }
}

/// 브라우저 창 자리들(탭마다 물어 같은 창은 한 번) — chrome_popup 이 그 안쪽에 뜬 크롬 자체 창을 가린다
fn browser_rects(cdp: &mut Cdp, st: &mut St, view: &Arc<Mutex<View>>) -> Vec<crate::vdisplay::Rect> {
    let ids: Vec<String> = st.pages.iter().take(10).map(|p| p.id.clone()).collect();
    let (mut seen, mut out, mut buf) = (vec![], vec![], vec![]);
    for id in ids {
        // 짧게 — 화면 받기·입력 보내기와 같은 루프라 오래 붙잡지 않는다(브라우저 쪽 물음이라 페이지 대화상자에 안 막힌다)
        let Ok(w) = cdp.call_for("Browser.getWindowForTarget", serde_json::json!({ "targetId": id }), None, Duration::from_millis(800), |m| buf.push(m.clone())) else { continue };
        if seen.contains(&w["windowId"]) {
            continue;
        }
        seen.push(w["windowId"].clone());
        let b = &w["bounds"];
        let f = |k: &str| b[k].as_f64().unwrap_or(0.0);
        out.push(crate::vdisplay::Rect { x: f("left"), y: f("top"), w: f("width"), h: f("height") });
    }
    for m in buf {
        on_event(&m, view, st);
    }
    out
}

/// 일꾼 — 보는 칸이 있는 동안 지금 탭 화면을 받는다
fn run(profile: &str, view: &Arc<Mutex<View>>, seen: &Arc<Mutex<Instant>>, stop: &Arc<AtomicBool>) -> Result<(), String> {
    let mut live = read_live(profile).ok_or("no live browser")?;
    let mut cdp = Cdp { ws: connect(&live)?, next: 0 };
    let mut st = St { profile: profile.to_string(), ..St::default() };
    cdp.call("Target.setDiscoverTargets", serde_json::json!({ "discover": true }), None, |_| {})?;
    let got = cdp.call("Target.getTargets", serde_json::json!({}), None, |_| {})?;
    for t in got["targetInfos"].as_array().cloned().unwrap_or_default() {
        if let Some(p) = page_of(&t) {
            st.pages.push(p);
        }
    }
    if let Ok(mut v) = view.lock() {
        v.error.clear(); // 붙었다 — 지난 실패 이유를 지운다
        v.pages = st.pages.clone();
        v.attached = true;
    }
    let mut checked = Instant::now() - Duration::from_secs(1);
    let mut listed = Instant::now();
    let mut popped = Instant::now();
    let mut beat = Instant::now() - Duration::from_secs(60);
    loop {
        let idle = seen.lock().map(|s| s.elapsed()).unwrap_or(Duration::MAX);
        let has_dialog = view.lock().is_ok_and(|v| !v.dialogs.is_empty());
        if stop.load(Ordering::Relaxed) || !keep_running(idle, has_dialog, crate::takeover::holding(profile)) {
            break;
        }
        let watching = idle <= IDLE;
        // 0.5초마다 래퍼 상태를 다시 읽고(지금 탭이 바뀌었나) 보여 줄 탭을 고른다
        if checked.elapsed() >= Duration::from_millis(500) {
            checked = Instant::now();
            match read_live(profile) {
                Some(l) if same_wrapper(&live, &l) => live = l,
                _ => break, // 브라우저 닫힘·다시 뜸 — 다음 물음에 새로 붙는다
            }
            // 사람이 쥔 동안 앱이 살아 있다는 표시 — 창이 가려져 화면 쪽 물음(agent_lives)이 느려져도 래퍼가 개입을 풀지 않게
            if beat.elapsed() >= Duration::from_secs(20) && crate::takeover::holding(profile) {
                beat = Instant::now();
                crate::takeover::heartbeat(&live_dir(), profile);
            }
            // 2초마다 탭 목록을 다시 읽는다 — 제목이 바뀐 걸 targetInfoChanged 가 늘 알려 주진 않아 탭 이름이 주소로 남았다(2026-10-03 실측)
            if listed.elapsed() >= Duration::from_secs(2) {
                listed = Instant::now();
                let mut buf = vec![];
                if let Ok(got) = cdp.call("Target.getTargets", serde_json::json!({}), None, |m| buf.push(m.clone())) {
                    let fresh: Vec<Page> = got["targetInfos"].as_array().cloned().unwrap_or_default().iter().filter_map(page_of).collect();
                    merge_pages(&mut st.pages, &fresh);
                }
                for m in buf {
                    on_event(&m, view, &mut st);
                }
            }
            let pinned = view.lock().ok().and_then(|v| v.pinned.clone());
            let want = pick_target(&st.pages, &live.url, st.last_changed.as_deref(), st.target.as_deref(), pinned.as_deref(), st.popups.last().map(String::as_str));
            if want != st.target {
                // 앞 탭 세션은 떼지 않고 화면만 끊는다 — 그 탭에 뜬 대화상자는 그 세션으로만 답할 수 있다
                if let Some(s) = st.session.take() {
                    if st.casting {
                        let _ = cdp.send("Page.stopScreencast", serde_json::json!({}), Some(&s));
                    }
                }
                st.casting = false;
                st.target = want.clone();
                if let Some(t) = want {
                    let s = match st.sessions.get(&t) {
                        Some(s) => s.clone(),
                        None => {
                            let mut buf = vec![];
                            let r = cdp.call("Target.attachToTarget", serde_json::json!({ "targetId": t, "flatten": true }), None, |m| buf.push(m.clone()))?;
                            for m in buf {
                                on_event(&m, view, &mut st);
                            }
                            let s = r["sessionId"].as_str().unwrap_or_default().to_string();
                            // Page 사건(JS 대화상자 등)을 받으려면 켜야 한다 — 안 켜서 alert 가 모달에 안 떴다(2026-10-03 실측)
                            let _ = cdp.send("Page.enable", serde_json::json!({}), Some(&s));
                            // 파일 고르기 창은 가로챈다 — 숨긴 크롬의 맥 창 대신 앱이 파일 창을 띄운다(사람이 누른 것만, on_event)
                            let _ = cdp.send("Page.setInterceptFileChooserDialog", serde_json::json!({ "enabled": true }), Some(&s));
                            // 위치·알림 권한 감시 — 숨긴 크롬 말풍선 대신 모달에서(agent_perm.js). 바인딩은 Runtime 을 켜야 페이지에 보인다(2026-10-09 실측)
                            let _ = cdp.send("Runtime.enable", serde_json::json!({}), Some(&s));
                            let _ = cdp.send("Runtime.addBinding", serde_json::json!({ "name": PERM_BINDING }), Some(&s));
                            let _ = cdp.send("Page.addScriptToEvaluateOnNewDocument", serde_json::json!({ "source": PERM_JS }), Some(&s));
                            let _ = cdp.send("Runtime.evaluate", serde_json::json!({ "expression": PERM_JS }), Some(&s));
                            st.sessions.insert(t.clone(), s.clone());
                            s
                        }
                    };
                    st.session = Some(s.clone());
                    if watching {
                        cdp.send("Page.startScreencast", screencast_params(), Some(&s))?;
                        st.casting = true;
                    }
                    // 이 일꾼이 모르는 대화상자(붙기 전에 뜬 것)에 막혔는지 — 답이 안 오면 멈춘 탭으로 알린다
                    let known = view.lock().is_ok_and(|v| v.dialogs.contains_key(&t));
                    if !known {
                        probe(&mut cdp, &mut st, &t, &s);
                    }
                    snap(&mut cdp, &s, view, &mut st);
                }
            }
            // 아무도 안 보는데 대화상자 때문에 붙어 있는 동안은 화면을 안 받는다(CPU·대역폭) — 다시 보면 다시 받는다
            if let Some(s) = st.session.clone() {
                if watching != st.casting {
                    let (m, p) = if watching { ("Page.startScreencast", screencast_params()) } else { ("Page.stopScreencast", serde_json::json!({})) };
                    let _ = cdp.send(m, p, Some(&s));
                    st.casting = watching;
                    if watching {
                        snap(&mut cdp, &s, view, &mut st);
                    }
                }
            }
            if let Ok(mut v) = view.lock() {
                v.pages = st.pages.clone();
                v.current = st.target.clone();
                if v.pinned.as_ref().is_some_and(|p| !st.pages.iter().any(|x| &x.id == p)) {
                    v.pinned = None;
                }
                // 답 없는 '살아 있나'가 오래됐고 아는 대화상자도 없으면 멈춘 탭
                if let Some(p) = st.probes.iter().find(|p| p.2.elapsed() >= PROBE_WAIT && !v.dialogs.contains_key(&p.1)) {
                    v.stuck = Some(p.1.clone());
                }
            }
        }
        // 크롬 자체 창(패스키·Touch ID·폰 QR) — 페이지 그림엔 안 찍히고 크롬은 가려져 있어 사람이 못 본다(2026-10-06). 보는 동안 1초마다
        // 맥만(창 목록·가리기가 맥 것) — 다른 OS 에서 chrome_pid 가 매초 lsof 를 부르지 않게
        if cfg!(target_os = "macos") && watching && popped.elapsed() >= Duration::from_secs(1) {
            popped = Instant::now();
            let popup = chrome_pid(live.port).is_some_and(|pid| {
                let wins = crate::chrome_popup::windows(pid);
                crate::chrome_popup::worth_asking(&wins) && crate::chrome_popup::popup_open(&wins, pid, &browser_rects(&mut cdp, &mut st, view))
            });
            if let Ok(mut v) = view.lock() {
                v.popup = popup;
            }
        }
        if let Some(m) = cdp.recv()? {
            on_event(&m, view, &mut st);
        }
        // 대화상자 답 — 그걸 받은 탭 세션으로. 크롬이 거절하면(그 세션이 대화상자를 모름) 버리지 않고 멈춘 탭으로 알린다
        let answers = view.lock().map(|mut v| std::mem::take(&mut v.answers)).unwrap_or_default();
        for (t, p) in answers {
            let mut buf = vec![];
            let ok = match st.sessions.get(&t).cloned() {
                Some(s) => {
                    let r = cdp.call("Page.handleJavaScriptDialog", p, Some(&s), |m| buf.push(m.clone()));
                    if r.is_err() {
                        probe(&mut cdp, &mut st, &t, &s); // 풀리면(크롬에서 누름 등) 늦은 답이 멈춤 표시를 지운다
                    }
                    r.is_ok()
                }
                None => false,
            };
            if !ok {
                #[cfg(not(test))]
                crate::claude::log_out("browser", &format!("대화상자 답을 크롬이 안 받음 — 멈춘 탭으로 알림 ({profile})"));
                if let Ok(mut v) = view.lock() {
                    v.stuck = Some(t);
                }
            }
            for m in buf {
                on_event(&m, view, &mut st);
            }
        }
        // 권한 답 — 브라우저 단위(세션 없이). 감시 스크립트가 바뀐 상태를 보고 원래 함수를 부른다
        let perms = view.lock().map(|mut v| std::mem::take(&mut v.perm_answers)).unwrap_or_default();
        for p in perms {
            let _ = cdp.send("Browser.setPermission", p, None);
        }
        // 모달에서 온 입력 — 지금 탭 세션으로. 글자가 들어 있으니 오류에도 안 싣는다
        // 사람 입력은 보내기 직전에 본 탭·출처와 맞춰 본다(일꾼의 탭 목록이 가장 새것) — 다르면 버리고 센다
        let outbox: Vec<(&'static str, serde_json::Value, Option<Expect>)> = view.lock().map(|mut v| std::mem::take(&mut v.outbox)).unwrap_or_default();
        let mut dropped = 0;
        for (m, p, ex) in outbox {
            match st.session.clone() {
                Some(s) if ex.as_ref().is_none_or(|ex| expect_ok(ex, st.target.as_deref(), &st.pages)) => {
                    // 사람 개입 기록 — 누르기 직전 그 자리 요소, 글자를 넣기 직전 포커스 칸(이름만). 쥐고 있을 때만
                    if ex.is_some() && crate::takeover::holding(profile) {
                        if let Some((js, click)) = human_note(m, &p) {
                            if let Ok(id) = cdp.send("Runtime.evaluate", serde_json::json!({ "expression": js, "returnByValue": true }), Some(&s)) {
                                if st.describes.len() < 50 {
                                    st.describes.push((id, click));
                                }
                            }
                        }
                        if m == "Input.dispatchKeyEvent" && matches!(p["type"].as_str(), Some("keyDown" | "rawKeyDown")) && matches!(p["key"].as_str(), Some("Enter" | "Escape" | "Tab")) {
                            crate::takeover::record(profile, crate::takeover_note::key(p["key"].as_str().unwrap_or_default()));
                        }
                    }
                    let _ = cdp.send(m, p, Some(&s));
                }
                _ => dropped += u64::from(ex.is_some()),
            }
        }
        if dropped > 0 {
            if let Ok(mut v) = view.lock() {
                v.dropped += dropped;
            }
        }
        for a in st.acks.drain(..) {
            if let Some(s) = st.session.as_deref() {
                let _ = cdp.send("Page.screencastFrameAck", serde_json::json!({ "sessionId": a.parse::<i64>().unwrap_or(0) }), Some(s));
            }
        }
    }
    if let (Some(s), true) = (st.session, st.casting) {
        let _ = cdp.send("Page.stopScreencast", serde_json::json!({}), Some(&s));
    }
    let _ = cdp.ws.close(None);
    Ok(())
}

/// 크롬에서 보기 — 지금 보여 주는 탭을 앞 탭으로, 창을 펴고(최소화였으면), 그 크롬(에이전트 것 — 사용자 크롬 말고)을 앞으로
#[tauri::command]
pub async fn agent_focus(profile: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let live = read_live(&profile).ok_or("no live browser")?;
        // 진짜 크롬 창을 꺼내면 사람이 직접 만질 수 있다 — 개입이 아니었으면 개입부터(세션 도구가 섞이지 않게), 기록엔 '크롬 창 꺼냄'
        if !crate::takeover::allows(&live_dir(), &profile, live.pid, live.ask.is_some()) {
            crate::takeover::start(&live_dir(), &profile, live.pid, "desktop")?;
        }
        crate::takeover::mark_chrome(&profile);
        let target = with_workers(|ws| ws.get(&profile).and_then(|w| w.view.lock().ok().and_then(|v| v.current.clone())));
        let mut cdp = Cdp { ws: connect(&live)?, next: 0 };
        let target = match target {
            Some(t) => t,
            None => {
                let got = cdp.call("Target.getTargets", serde_json::json!({}), None, |_| {})?;
                let pages: Vec<Page> = got["targetInfos"].as_array().cloned().unwrap_or_default().iter().filter_map(page_of).collect();
                pick_target(&pages, &live.url, None, None, None, None).ok_or("no tab")?
            }
        };
        cdp.call("Target.activateTarget", serde_json::json!({ "targetId": target }), None, |_| {})?;
        keep_alive(&profile);
        if let Ok(w) = cdp.call("Browser.getWindowForTarget", serde_json::json!({ "targetId": target }), None, |_| {}) {
            let _ = cdp.call("Browser.setWindowBounds", serde_json::json!({ "windowId": w["windowId"], "bounds": { "windowState": "normal" } }), None, |_| {});
            // 가상 모니터 위거나 어느 화면도 아닌 좌표(가상 모니터가 지워진 뒤)면 맥북 화면 안으로 옮겨 온다
            let b = &w["bounds"];
            let win = crate::vdisplay::Rect { x: b["left"].as_f64().unwrap_or(0.0), y: b["top"].as_f64().unwrap_or(0.0), w: b["width"].as_f64().unwrap_or(0.0), h: b["height"].as_f64().unwrap_or(0.0) };
            let visible = crate::vdisplay::visible_displays();
            let rects: Vec<crate::vdisplay::Rect> = visible.iter().map(|d| d.0).collect();
            if !crate::vdisplay::on_visible(win, &rects) {
                if let Some(d) = crate::vdisplay::show_display(&visible) {
                    let p = crate::vdisplay::place_in(d);
                    let _ = cdp.call("Browser.setWindowBounds", serde_json::json!({ "windowId": w["windowId"], "bounds": { "left": p.x as i64, "top": p.y as i64, "width": p.w as i64, "height": p.h as i64 } }), None, |_| {});
                }
            }
        }
        let _ = cdp.ws.close(None);
        front_chrome(live.port);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── 크롬 창 숨기기(2026-10-03 사용자 "숨겨져야 의미가 있다… 숨겨져도 그려져야 한다") ──────────────────
// 세션 크롬은 앱(⌘H 와 같은 NSRunningApplication.hide)으로 가려 둔다 — 실측: 가려도 screencast 60fps·페이지 rAF 60fps,
// 페이지가 보는 visibilityState·hasFocus·창 크기 그대로(플레이라이트가 가림 막는 플래그를 기본으로 켠다).
// 화면 밖 자리는 크롬·맥이 화면 안으로 끌어와 못 쓰고, 최소화는 Dock 에 썸네일이 쌓인다. 새 탭·창이 열리면 크롬이 스스로 다시 보여서
// 지킴이(watch_hidden)가 0.3초마다 다시 가린다. 앱이 꺼져 있으면 아무도 안 가린다 — 공개판 다른 기계·앱 없는 곳은 지금처럼 보이는 창

/// '크롬에서 보기'로 연 크롬 pid — 이것만 보이게 둔다. 크롬이 다시 뜨면 pid 가 바뀌어 다시 가려진다
static SHOWN: Mutex<Vec<i32>> = Mutex::new(Vec::new());
/// 포트 → 그 포트를 연 크롬 pid(lsof 를 매번 안 부르게)
static PIDS: Mutex<Option<HashMap<u16, i32>>> = Mutex::new(None);

/// `lsof -t` 출력 첫 줄 → pid
pub fn parse_lsof_pid(out: &str) -> Option<i32> {
    out.lines().next()?.trim().parse::<i32>().ok().filter(|p| *p > 0)
}

/// 가릴지 — 기능이 켜져 있고 '크롬에서 보기'로 연 크롬이 아니면
pub fn should_hide(feature_on: bool, shown: &[i32], pid: i32) -> bool {
    feature_on && !shown.contains(&pid)
}

fn chrome_pid(port: u16) -> Option<i32> {
    let mut g = PIDS.lock().unwrap_or_else(|e| e.into_inner());
    let m = g.get_or_insert_with(HashMap::new);
    if let Some(p) = m.get(&port).copied().filter(|p| crate::platform::pid_alive(*p)) {
        return Some(p);
    }
    let out = crate::platform::command("/usr/sbin/lsof").args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"]).output().ok()?;
    let pid = parse_lsof_pid(&String::from_utf8_lossy(&out.stdout))?;
    m.insert(port, pid);
    Some(pid)
}

fn shown() -> Vec<i32> {
    SHOWN.lock().map(|v| v.clone()).unwrap_or_default()
}

#[cfg(target_os = "macos")]
mod app_window {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
    fn app(pid: i32) -> Option<objc2::rc::Retained<NSRunningApplication>> {
        NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
    }
    pub fn hidden(pid: i32) -> Option<bool> {
        app(pid).map(|a| a.isHidden())
    }
    pub fn hide(pid: i32) {
        if let Some(a) = app(pid) {
            a.hide();
        }
    }
    /// 보이고 맨 앞으로 — `open -a` 는 사용자 크롬을 깨운다(크롬이 둘), System Events 는 권한 창이 뜬다
    pub fn show(pid: i32) {
        if let Some(a) = app(pid) {
            a.unhide();
            #[allow(deprecated)]
            a.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
        }
    }
}
#[cfg(not(target_os = "macos"))]
mod app_window {
    pub fn hidden(_pid: i32) -> Option<bool> {
        None
    }
    pub fn hide(_pid: i32) {}
    pub fn show(_pid: i32) {}
}

/// 지킴이 — 0.3초마다 세션 크롬이 보이면 가린다(새 탭·창이 열리면 크롬이 스스로 다시 보인다)
pub fn watch_hidden() {
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_millis(300));
        let on = crate::config::current().features.agent_view;
        let alive: Vec<i32> = agent_lives().iter().filter_map(|l| chrome_pid(l.port)).collect();
        if let Ok(mut v) = SHOWN.lock() {
            v.retain(|p| alive.contains(p));
        }
        let sh = shown();
        for pid in alive {
            if should_hide(on, &sh, pid) && app_window::hidden(pid) == Some(false) {
                app_window::hide(pid);
                // 크롬이 스스로 다시 보였다(새 탭·팝업) — 가상 모니터 밖에 있던 창이면 다음엔 안 보이게 그리로
                std::thread::spawn(move || rehome_pid(pid));
            }
        }
    });
}

/// 꺼내 두지 않은 세션 크롬의 창을 다 가상 모니터로(가린 채). 가상 모니터가 새로 생기거나 자리가 바뀔 때 —
/// 앱을 다시 켜면 가짜 화면이 다른 번호·자리로 다시 생기는데 크롬 창은 옛 좌표에 남아, 새 탭이 뜰 때 사용자 화면에 잠깐 보였다가
/// 지킴이가 가렸다(2026-10-03 사용자 "한 번씩 브라우저가 뜨거든? 사라지긴 하는데")
pub fn rehome_all() {
    let sh = shown();
    for l in agent_lives() {
        if chrome_pid(l.port).is_some_and(|p| !sh.contains(&p)) {
            let _ = rehome(&l);
        }
    }
}

fn rehome_pid(pid: i32) {
    if let Some(l) = agent_lives().into_iter().find(|l| chrome_pid(l.port) == Some(pid)) {
        let _ = rehome(&l);
    }
}

/// 그 크롬의 창(탭마다 창을 물어 겹치는 건 한 번)을 가상 모니터 안으로 — 이미 안에 있으면 그대로
fn rehome(live: &Live) -> Result<(), String> {
    let Some((_, vd)) = crate::vdisplay::bounds() else { return Ok(()) };
    let mut cdp = Cdp { ws: connect(live)?, next: 0 };
    let got = cdp.call("Target.getTargets", serde_json::json!({}), None, |_| {})?;
    let mut done: Vec<i64> = vec![];
    for t in got["targetInfos"].as_array().cloned().unwrap_or_default().iter().filter(|t| t["type"] == "page") {
        let Ok(w) = cdp.call("Browser.getWindowForTarget", serde_json::json!({ "targetId": t["targetId"] }), None, |_| {}) else { continue };
        let id = w["windowId"].as_i64().unwrap_or(-1);
        if done.contains(&id) {
            continue;
        }
        done.push(id);
        let b = &w["bounds"];
        let win = crate::vdisplay::Rect { x: b["left"].as_f64().unwrap_or(0.0), y: b["top"].as_f64().unwrap_or(0.0), w: b["width"].as_f64().unwrap_or(0.0), h: b["height"].as_f64().unwrap_or(0.0) };
        if b["windowState"] == "normal" && crate::vdisplay::inside(win, vd) {
            continue;
        }
        let p = crate::vdisplay::place_in(vd);
        let _ = cdp.call("Browser.setWindowBounds", serde_json::json!({ "windowId": id, "bounds": { "windowState": "normal" } }), None, |_| {});
        let _ = cdp.call("Browser.setWindowBounds", serde_json::json!({ "windowId": id, "bounds": { "left": p.x as i64, "top": p.y as i64, "width": p.w as i64, "height": p.h as i64 } }), None, |_| {});
    }
    let _ = cdp.ws.close(None);
    Ok(())
}

/// 크롬 다시 숨기기(앱 칸 아이콘) — 가상 모니터가 있으면 창을 그리로 돌려보내고 가린다
#[tauri::command]
pub async fn agent_hide(profile: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let Some(live) = read_live(&profile) else { return };
        let Some(pid) = chrome_pid(live.port) else { return };
        if let Ok(mut v) = SHOWN.lock() {
            v.retain(|p| *p != pid);
        }
        if let Some((_, vd)) = crate::vdisplay::bounds() {
            let _ = move_window(&profile, &live, crate::vdisplay::place_in(vd));
        }
        app_window::hide(pid);
    })
    .await;
}

/// 앱이 꺼질 때 — 세션 크롬을 다 가린다(가상 모니터가 사라지기 전에)
pub fn hide_all() {
    for l in agent_lives() {
        if let Some(pid) = chrome_pid(l.port) {
            app_window::hide(pid);
        }
    }
    if let Ok(mut v) = SHOWN.lock() {
        v.clear();
    }
}

/// 그 크롬의 지금 탭 창을 네모 자리로(CDP) — 최소화·전체화면이면 먼저 보통으로
fn move_window(profile: &str, live: &Live, r: crate::vdisplay::Rect) -> Result<(), String> {
    let target = with_workers(|ws| ws.get(profile).and_then(|w| w.view.lock().ok().and_then(|v| v.current.clone())));
    let mut cdp = Cdp { ws: connect(live)?, next: 0 };
    let target = match target {
        Some(t) => t,
        None => {
            let got = cdp.call("Target.getTargets", serde_json::json!({}), None, |_| {})?;
            let pages: Vec<Page> = got["targetInfos"].as_array().cloned().unwrap_or_default().iter().filter_map(page_of).collect();
            pick_target(&pages, &live.url, None, None, None, None).ok_or("no tab")?
        }
    };
    let w = cdp.call("Browser.getWindowForTarget", serde_json::json!({ "targetId": target }), None, |_| {})?;
    let _ = cdp.call("Browser.setWindowBounds", serde_json::json!({ "windowId": w["windowId"], "bounds": { "windowState": "normal" } }), None, |_| {});
    let b = serde_json::json!({ "left": r.x as i64, "top": r.y as i64, "width": r.w as i64, "height": r.h as i64 });
    cdp.call("Browser.setWindowBounds", serde_json::json!({ "windowId": w["windowId"], "bounds": b }), None, |_| {})?;
    let _ = cdp.ws.close(None);
    Ok(())
}

/// 꺼낸 창을 사람이 닫아 빈 탭을 다시 열어 둔 세션 브라우저들 — 앱 칸이 '창이 닫혔어'를 보인다
static REOPENED: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// 창 지킴이가 도는 프로필
static KEEPING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// 꺼낸 창이 닫혀도 세션 브라우저가 살게(2026-10-03 사용자 "닫기 버튼을 누르면 그 창이 아예 꺼져 버린다") —
/// '크롬에서 보기' 동안 탭이 하나도 안 남으면 빈 탭을 가상 모니터에 다시 열고 숨긴다. 안 그러면 세션의 다음 탭이
/// 사람이 닫은 자리(보이는 화면)에 뜨고 앱 칸은 빈다. 다시 숨기면(agent_hide) 지킴이도 끝
fn keep_alive(profile: &str) {
    {
        let Ok(mut k) = KEEPING.lock() else { return };
        if k.iter().any(|p| p == profile) {
            return;
        }
        k.push(profile.to_string());
    }
    if let Ok(mut r) = REOPENED.lock() {
        r.retain(|p| p != profile);
    }
    let profile = profile.to_string();
    std::thread::spawn(move || {
        let _ = keep_loop(&profile);
        if let Ok(mut k) = KEEPING.lock() {
            k.retain(|p| p != &profile);
        }
    });
}

fn keep_loop(profile: &str) -> Result<(), String> {
    let live = read_live(profile).ok_or("no live")?;
    let pid = chrome_pid(live.port).ok_or("no chrome")?;
    let mut cdp = Cdp { ws: connect(&live)?, next: 0 };
    cdp.call("Target.setDiscoverTargets", serde_json::json!({ "discover": true }), None, |_| {})?;
    let mut checked = Instant::now();
    loop {
        // 다시 숨겼거나 브라우저가 닫히면(세션이 browser_close) 끝
        if checked.elapsed() >= Duration::from_millis(500) {
            checked = Instant::now();
            if !shown().contains(&pid) || read_live(profile).is_none_or(|l| l.port != live.port) {
                break;
            }
        }
        let Some(m) = cdp.recv()? else { continue };
        if m["method"] != "Target.targetDestroyed" {
            continue;
        }
        std::thread::sleep(Duration::from_millis(400)); // 탭 닫기와 새 탭이 겹칠 때(세션이 탭을 바꾸는 중)
        let got = cdp.call("Target.getTargets", serde_json::json!({}), None, |_| {})?;
        if got["targetInfos"].as_array().is_some_and(|a| a.iter().any(|t| t["type"] == "page")) {
            continue;
        }
        // 기록 먼저(바꾸고 기록하는 순서면 그 사이 칸이 옛 상태를 읽는다)
        if let Ok(mut r) = REOPENED.lock() {
            r.retain(|p| p != profile);
            r.push(profile.to_string());
        }
        if let Ok(mut v) = SHOWN.lock() {
            v.retain(|p| *p != pid);
        }
        let mut params = serde_json::json!({ "url": "about:blank", "newWindow": true, "background": true });
        if let Some((_, vd)) = crate::vdisplay::bounds() {
            let p = crate::vdisplay::place_in(vd);
            params = serde_json::json!({ "url": "about:blank", "newWindow": true, "background": true, "left": p.x as i64, "top": p.y as i64, "width": p.w as i64, "height": p.h as i64 });
        }
        let made = cdp.call("Target.createTarget", params, None, |_| {})?;
        // left/top 을 모르는 크롬이면 만든 뒤 옮긴다
        if let (Some((_, vd)), Some(t)) = (crate::vdisplay::bounds(), made["targetId"].as_str()) {
            if let Ok(w) = cdp.call("Browser.getWindowForTarget", serde_json::json!({ "targetId": t }), None, |_| {}) {
                let p = crate::vdisplay::place_in(vd);
                let _ = cdp.call("Browser.setWindowBounds", serde_json::json!({ "windowId": w["windowId"], "bounds": { "left": p.x as i64, "top": p.y as i64, "width": p.w as i64, "height": p.h as i64 } }), None, |_| {});
            }
        }
        app_window::hide(pid);
        break;
    }
    let _ = cdp.ws.close(None);
    Ok(())
}

/// '크롬에서 보기' — 이 크롬은 지킴이가 안 가리게 하고 보이게·맨 앞으로
fn front_chrome(port: u16) {
    let Some(pid) = chrome_pid(port) else { return };
    if let Ok(mut v) = SHOWN.lock() {
        if !v.contains(&pid) {
            v.push(pid);
        }
    }
    app_window::show(pid);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 같이_쓰는_스크립트_수는_산_것만_세션_칸과_주인은_빼고() {
        // 개입해도 스크립트는 못 멈춘다 — 개입 줄에 수를 알린다(roadmap 부채 browser-takeover ①)
        let d = std::env::temp_dir().join(format!("chammo-script-users-{}", std::process::id()));
        let u = d.join("shop.users");
        std::fs::create_dir_all(&u).unwrap();
        std::fs::write(u.join("101"), r#"{"pid":101,"at":"x"}"#).unwrap(); // 산 스크립트
        std::fs::write(u.join("102"), r#"{"pid":102,"at":"x"}"#).unwrap(); // 죽은 스크립트
        std::fs::write(u.join("103"), r#"{"pid":103,"at":"x","by":"session"}"#).unwrap(); // 같이 쓰는 세션 래퍼
        std::fs::write(u.join("104"), r#"{"pid":104}"#).unwrap(); // 크롬 주인(지킴이 자신은 안 올라가지만 혹시)
        std::fs::write(u.join("note"), "x").unwrap();
        let alive = |p: i32| p != 102;
        assert_eq!(script_users(&d, "shop", 104, alive), 1);
        assert_eq!(script_users(&d, "none", 104, alive), 0);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 폰에_보내는_화면_상태는_이유를_짧게_주소_없이() {
        // 폰 브라우저 보기가 '화면 받는 중'에 이유 없이 멈췄다(2026-10-05 남은 것 ①) — 이유는 보내되 포트·devtools 주소는 맥 안에만
        let s = phone_screen("WebSocket connect ws://127.0.0.1:9333/devtools/page/AB12: Connection refused (os error 61)", false, 0);
        assert_eq!(s["error"], "WebSocket connect …: Connection refused (os error 61)");
        assert_eq!((s["attached"].as_bool(), s["pages"].as_u64()), (Some(false), Some(0)));
        let long = "x ".repeat(200);
        assert!(phone_screen(&long, true, 2)["error"].as_str().unwrap().chars().count() <= 120);
        assert_eq!(phone_screen("", true, 3), serde_json::json!({ "error": "", "attached": true, "pages": 3 }));
    }

    fn page(id: &str, url: &str) -> Page {
        Page { id: id.into(), url: url.into(), title: String::new() }
    }

    #[test]
    fn 사람_입력은_사람이_본_탭과_출처일_때만() {
        // 리뷰: 팝업·이동 직후 머리 도메인이 옛것인 채로 입력이 새 페이지로 갔다(탭 목록 복사 0.5초 + 모달 물음 0.4초)
        assert_eq!(origin_of("https://Accounts.Google.com/signin?x=1#a"), "https://accounts.google.com");
        assert_eq!(origin_of("https://google.com@evil.com/"), "https://evil.com");
        assert_eq!(origin_of("http://127.0.0.1:8765/login.html"), "http://127.0.0.1:8765");
        assert_eq!(origin_of("about:blank"), "about:");
        assert_eq!(origin_of("data:text/html,<form>"), "data:");
        let ps = vec![page("main", "https://shop.com/cart"), page("pop", "https://pay.example.com/auth")];
        let ex = |t: &str, u: &str| Expect { target: t.into(), url: u.into() };
        assert!(expect_ok(&ex("main", "https://shop.com/other"), Some("main"), &ps), "같은 출처 안에서 주소만 바뀐 건(SPA) 그대로");
        assert!(!expect_ok(&ex("main", "https://shop.com/cart"), Some("pop"), &ps), "입력 대상이 팝업으로 바뀌었으면 버린다");
        assert!(!expect_ok(&ex("pop", "about:blank"), Some("pop"), &ps), "본 건 빈 팝업인데 그새 다른 사이트로 갔으면 버린다");
        assert!(!expect_ok(&ex("main", "https://shop.com/"), None, &ps), "지금 탭을 모르면 버린다");
        assert!(!expect_ok(&ex("gone", "https://shop.com/"), Some("gone"), &ps), "탭이 닫혔으면 버린다");
    }

    #[test]
    fn 다_했어는_보던_그_부름의_표만() {
        // 2026-10-04 ①: .done 이 프로필 이름뿐이라 검사와 쓰기 사이 틈에 새 래퍼 부름을 대신 끝낼 수 있었다 — 래퍼 pid:ask.at 을 적는다
        let asking = r#"{"profile":"acme","pid":11,"sessionPid":22,"port":5000,"wsPath":"/devtools/browser/ab-12","ts":2,"ask":{"reason":"로그인","at":700}}"#;
        let l = parse_live(asking).unwrap();
        assert_eq!(done_mark(Some(&l), 11, Some(700)), Some("11:700".to_string()));
        assert_eq!(done_mark(Some(&l), 11, None), Some("11:700".to_string()), "폰은 지금 부름 그대로");
        assert_eq!(done_mark(Some(&l), 11, Some(600)), None, "모달이 보던 부름이 끝나고 새 부름이 왔으면 안 끝낸다");
        assert_eq!(done_mark(Some(&l), 33, Some(700)), None, "다른 래퍼");
        let idle = parse_live(&asking.replace(r#","ask":{"reason":"로그인","at":700}"#, "")).unwrap();
        assert_eq!(done_mark(Some(&idle), 11, None), None, "부름이 없으면 쓸 게 없다");
        assert_eq!(done_mark(None, 11, None), None);
    }

    #[test]
    fn 사람_입력은_보던_그_래퍼에만() {
        // 2026-10-04 QA B1 줄기 — 모달이 보던 세션이 끝나고 다른 세션 브라우저가 같은 프로필을 잡으면, 화면이 닫히기 전에 친 글이 그쪽으로 갔다
        let ok = r#"{"profile":"acme","pid":11,"sessionPid":22,"port":5000,"wsPath":"/devtools/browser/ab-12","ts":2}"#;
        let a = parse_live(ok).unwrap();
        let b = parse_live(&ok.replace("\"pid\":11", "\"pid\":33")).unwrap();
        assert!(for_wrapper(Some(&a), 11));
        assert!(!for_wrapper(Some(&b), 11), "같은 프로필이어도 다른 래퍼면 버린다");
        assert!(!for_wrapper(None, 11), "브라우저가 사라졌으면 버린다");
        // 일꾼도 래퍼가 바뀌면 끊는다 — 같은 크롬(포트)을 새 세션이 이어 써도 남은 입력이 새 세션 쪽으로 안 가게
        assert!(same_wrapper(&a, &a.clone()));
        assert!(!same_wrapper(&a, &b));
        let mut c = a.clone();
        c.port = 5001;
        assert!(!same_wrapper(&a, &c));
    }

    #[test]
    fn 상태_파일_모양_검사() {
        let ok = r#"{"profile":"acme","pid":11,"sessionPid":22,"port":5000,"wsPath":"/devtools/browser/ab-12","url":"https://a.com/","title":"A","tabs":[{"index":0,"title":"A","url":"https://a.com/","current":true}],"tool":"이동 https://a.com/","toolAt":1,"busy":false,"ts":2}"#;
        let l = parse_live(ok).unwrap();
        assert_eq!((l.port, l.session_pid, l.tabs.len(), l.ask.is_none()), (5000, 22, 1, true));
        let asked = parse_live(&ok.replace("\"ts\":2}", "\"ts\":2,\"ask\":{\"reason\":\"네이버 로그인\",\"at\":3}}")).unwrap();
        assert_eq!(asked.ask.unwrap()["reason"], "네이버 로그인");
        for bad in [
            ok.replace("/devtools/browser/ab-12", "/json/../x"),
            ok.replace("/devtools/browser/ab-12", "/devtools/browser/a?b"),
            ok.replace("\"port\":5000", "\"port\":0"),
            ok.replace("\"profile\":\"acme\"", "\"profile\":\"../x\""),
            ok.replace("\"pid\":11", "\"pid\":0"),
            "{깨짐".to_string(),
        ] {
            assert!(parse_live(&bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn 지금_탭_고르기() {
        let ps = [page("a", "https://a.com/"), page("b", "https://b.com/"), page("c", "https://a.com/")];
        // MCP 가 말한 지금 탭 주소가 이긴다
        assert_eq!(pick_target(&ps, "https://b.com/", Some("a"), Some("a"), None, None).as_deref(), Some("b"));
        // 같은 주소 탭이 둘이면 지금 보던 것 → 마지막으로 바뀐 것
        assert_eq!(pick_target(&ps, "https://a.com/", Some("c"), Some("a"), None, None).as_deref(), Some("a"));
        assert_eq!(pick_target(&ps, "https://a.com/", Some("c"), None, None, None).as_deref(), Some("c"));
        // 지금 탭 주소가 안 맞으면(페이지 안에서 옮겨 감) 마지막으로 바뀐 탭
        assert_eq!(pick_target(&ps, "https://gone.com/", Some("b"), Some("a"), None, None).as_deref(), Some("b"));
        // 고른 탭(띠)이 있으면 그것, 닫혔으면 무시
        assert_eq!(pick_target(&ps, "https://b.com/", None, None, Some("c"), None).as_deref(), Some("c"));
        assert_eq!(pick_target(&ps, "https://b.com/", None, None, Some("zz"), None).as_deref(), Some("b"));
        assert_eq!(pick_target(&ps, "", None, None, None, None).as_deref(), Some("a"));
        assert_eq!(pick_target(&[], "https://a.com/", None, None, None, None), None);
        // 사이트가 띄운 새 창은 MCP 지금 탭보다 앞, 닫히면(목록에 없으면) 원래대로 — 띠에서 고른 탭은 그보다 앞
        assert_eq!(pick_target(&ps, "https://a.com/", None, Some("a"), None, Some("b")).as_deref(), Some("b"));
        assert_eq!(pick_target(&ps, "https://a.com/", None, Some("a"), None, Some("closed")).as_deref(), Some("a"));
        assert_eq!(pick_target(&ps, "https://a.com/", None, Some("a"), Some("c"), Some("b")).as_deref(), Some("c"));
    }

    #[test]
    fn 탭_목록_맞추기는_순서를_지킨다() {
        let mut ps = vec![page("a", "u1"), page("b", "u2"), page("c", "u3")];
        let fresh = [Page { id: "c".into(), url: "u3".into(), title: "셋".into() }, page("d", "u4"), Page { id: "a".into(), url: "u1x".into(), title: "하나".into() }];
        merge_pages(&mut ps, &fresh);
        assert_eq!(ps.iter().map(|p| (p.id.as_str(), p.title.as_str(), p.url.as_str())).collect::<Vec<_>>(), [("a", "하나", "u1x"), ("c", "셋", "u3"), ("d", "", "u4")]);
    }

    #[test]
    fn 크롬_pid_읽기() {
        assert_eq!(parse_lsof_pid("58014\n"), Some(58014));
        assert_eq!(parse_lsof_pid("  77 \n88\n"), Some(77));
        assert_eq!(parse_lsof_pid(""), None);
        assert_eq!(parse_lsof_pid("x\n"), None);
        assert_eq!(parse_lsof_pid("0\n"), None);
    }

    #[test]
    fn 가릴지() {
        // 기능이 켜져 있고 '크롬에서 보기'로 연 크롬이 아니면 가린다
        assert!(should_hide(true, &[], 5));
        assert!(!should_hide(true, &[5], 5));
        assert!(should_hide(true, &[6], 5));
        // 기능을 끄면 지금처럼 보이는 창 그대로
        assert!(!should_hide(false, &[], 5));
    }

    #[test]
    fn 대화상자가_떠_있으면_보는_칸이_없어도_일꾼을_둔다() {
        assert!(keep_running(Duration::from_secs(1), false, false));
        assert!(!keep_running(IDLE + Duration::from_millis(1), false, false));
        assert!(keep_running(Duration::from_secs(60), true, false));
        assert!(!keep_running(DIALOG_HOLD + Duration::from_secs(1), true, false));
        // 사람이 쥐고 있으면(개입·부름) 아무도 안 봐도 붙어 있는다 — 주소·탭 바뀜을 기록
        assert!(keep_running(DIALOG_HOLD + Duration::from_secs(1), false, true));
    }

    #[test]
    fn 세션으로_탭_찾기() {
        let mut st = St::default();
        st.sessions.insert("A".into(), "s1".into());
        st.sessions.insert("B".into(), "s2".into());
        assert_eq!(st.target_of(Some("s2")).as_deref(), Some("B"));
        assert_eq!(st.target_of(Some("s9")), None);
        assert_eq!(st.target_of(None), None);
    }

    #[test]
    fn 대화상자는_받은_세션의_탭에_묶는다() {
        let view = Arc::new(Mutex::new(View::default()));
        let mut st = St::default();
        st.sessions.insert("A".into(), "s1".into());
        st.sessions.insert("B".into(), "s2".into());
        st.session = Some("s2".into()); // B 를 보는 중
        let open = serde_json::json!({ "method": "Page.javascriptDialogOpening", "sessionId": "s1", "params": { "type": "confirm", "message": "q", "defaultPrompt": "" } });
        on_event(&open, &view, &mut st);
        assert_eq!(view.lock().unwrap().dialogs.get("A").unwrap()["message"], "q");
        assert!(!view.lock().unwrap().dialogs.contains_key("B"));
        // 모르는 세션(남의 것)의 대화상자는 안 받는다
        on_event(&serde_json::json!({ "method": "Page.javascriptDialogOpening", "sessionId": "zz", "params": {} }), &view, &mut st);
        assert_eq!(view.lock().unwrap().dialogs.len(), 1);
        on_event(&serde_json::json!({ "method": "Page.javascriptDialogClosed", "sessionId": "s1", "params": {} }), &view, &mut st);
        assert!(view.lock().unwrap().dialogs.is_empty());
    }

    #[test]
    fn 살아_있나_답이_오면_멈춤을_지운다() {
        let view = Arc::new(Mutex::new(View::default()));
        let mut st = St::default();
        st.sessions.insert("A".into(), "s1".into());
        st.probes.push((7, "A".into(), Instant::now()));
        st.probes.push((9, "A".into(), Instant::now()));
        view.lock().unwrap().stuck = Some("A".into());
        on_event(&serde_json::json!({ "id": 7, "sessionId": "s1", "result": {} }), &view, &mut st);
        assert!(view.lock().unwrap().stuck.is_none());
        assert!(st.probes.is_empty(), "그 탭의 다른 물음도 지운다");
        // 닫힌 탭은 세션·대화상자·멈춤을 다 지운다
        view.lock().unwrap().dialogs.insert("A".into(), serde_json::json!({}));
        view.lock().unwrap().stuck = Some("A".into());
        on_event(&serde_json::json!({ "method": "Target.targetDestroyed", "params": { "targetId": "A" } }), &view, &mut st);
        let v = view.lock().unwrap();
        assert!(v.dialogs.is_empty() && v.stuck.is_none() && st.sessions.get("A").is_none());
    }

    #[test]
    fn 위치_알림_권한_요청은_감시_스크립트_신호로_그_탭에_묶는다() {
        // 숨긴 크롬의 권한 말풍선은 모달 그림에 안 찍힌다(roadmap 부채 agent-browser-modal ②) — 붙을 때 넣은 감시 스크립트가 알린다
        let view = Arc::new(Mutex::new(View::default()));
        let mut st = St::default();
        st.sessions.insert("A".into(), "s1".into());
        st.pages.push(Page { id: "A".into(), url: "https://Map.example.com:8443/x?y=1".into(), title: String::new() });
        let ask = |kind: &str| serde_json::json!({ "method": "Runtime.bindingCalled", "sessionId": "s1", "params": { "name": PERM_BINDING, "payload": format!("{{\"kind\":\"{kind}\"}}") } });
        on_event(&ask("geolocation"), &view, &mut st);
        let v = view.lock().unwrap().perms.get("A").cloned().unwrap();
        assert_eq!((v.kind.as_str(), v.origin.as_str()), ("geolocation", "https://map.example.com:8443"));
        // 모르는 권한·남의 바인딩·모르는 세션은 안 받는다
        view.lock().unwrap().perms.clear();
        on_event(&ask("camera"), &view, &mut st);
        on_event(&serde_json::json!({ "method": "Runtime.bindingCalled", "sessionId": "s1", "params": { "name": "other", "payload": "{\"kind\":\"geolocation\"}" } }), &view, &mut st);
        on_event(&serde_json::json!({ "method": "Runtime.bindingCalled", "sessionId": "zz", "params": { "name": PERM_BINDING, "payload": "{\"kind\":\"geolocation\"}" } }), &view, &mut st);
        assert!(view.lock().unwrap().perms.is_empty());
        on_event(&ask("notifications"), &view, &mut st);
        // 닫힌 탭이면 지운다
        on_event(&serde_json::json!({ "method": "Target.targetDestroyed", "params": { "targetId": "A" } }), &view, &mut st);
        assert!(view.lock().unwrap().perms.is_empty());
    }

    #[test]
    fn 권한_답은_그_탭_요청이_있을_때만_한_번_setPermission_으로() {
        let mut v = View { current: Some("A".into()), ..View::default() };
        v.perms.insert("A".into(), Perm { kind: "notifications".into(), origin: "https://a.com".into(), at: Instant::now() });
        assert!(!queue_permission(&mut v, Some("B".into()), true));
        assert!(queue_permission(&mut v, None, false));
        assert_eq!(v.perm_answers, vec![serde_json::json!({ "permission": { "name": "notifications" }, "setting": "denied", "origin": "https://a.com" })]);
        assert!(!queue_permission(&mut v, None, true), "두 번 누름");
        // 오래된 요청(감시 스크립트가 60초 뒤 크롬에 넘김)은 안 보인다
        v.perms.insert("A".into(), Perm { kind: "geolocation".into(), origin: "https://a.com".into(), at: Instant::now() - Duration::from_secs(61) });
        assert!(perm_of(&v).is_none());
    }

    #[test]
    fn 감시_스크립트는_같은_바인딩_이름을_부른다() {
        assert!(PERM_JS.contains(&format!("'{PERM_BINDING}'")));
    }

    #[test]
    fn 대화상자_답은_그_탭에_대화상자가_있을_때만() {
        let mut v = View { current: Some("B".into()), ..View::default() };
        v.dialogs.insert("A".into(), serde_json::json!({ "type": "prompt" }));
        // 지금 탭(B)엔 대화상자가 없다 — 앞 탭 대화상자에 잘못 가지 않는다
        assert!(!queue_answer(&mut v, None, true, None));
        assert!(v.answers.is_empty());
        assert!(queue_answer(&mut v, Some("A".into()), true, Some("글".into())));
        assert_eq!(v.answers, vec![("A".to_string(), serde_json::json!({ "accept": true, "promptText": "글" }))]);
        assert!(v.dialogs.is_empty());
        // 같은 대화상자에 두 번 답하지 않는다(두 번 누름)
        assert!(!queue_answer(&mut v, Some("A".into()), false, None));
    }

    #[test]
    fn 사람_파일_창_수_늘리기() {
        let d = std::env::temp_dir().join(format!("chammo-count-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("p.choosers");
        bump_count(&f);
        bump_count(&f);
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "2");
        std::fs::write(&f, "깨짐").unwrap();
        bump_count(&f);
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "1");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 다시_시도는_대화상자를_쥔_일꾼은_안_끊는다() {
        assert!(retry_restarts(false, false), "도는 일꾼(탭 0개 등)은 끊어 새로 붙는다");
        assert!(!retry_restarts(false, true), "대화상자는 이 일꾼 세션으로만 답할 수 있다");
        assert!(!retry_restarts(true, false), "끝난 일꾼은 다음 물음이 새로 띄운다");
    }

    #[test]
    fn 사람_입력_설명은_누르기와_글자에만() {
        let (js, click) = human_note("Input.dispatchMouseEvent", &serde_json::json!({ "type": "mousePressed", "x": 10.0, "y": 20.0 })).unwrap();
        assert!(click && js.contains("elementFromPoint(10,20)"));
        assert!(human_note("Input.dispatchMouseEvent", &serde_json::json!({ "type": "mouseMoved", "x": 1.0, "y": 2.0 })).is_none());
        let (js, click) = human_note("Input.insertText", &serde_json::json!({ "text": "비밀" })).unwrap();
        assert!(!click && js.contains("activeElement"));
        assert!(!js.contains("비밀"), "친 글은 JS 에 안 들어간다");
        assert!(human_note("Input.dispatchKeyEvent", &serde_json::json!({ "type": "keyDown", "key": "a" })).is_none());
    }

    #[test]
    fn 프레임_포장() {
        let v = pack_frame(258, &[0xff, 0xd8]);
        assert_eq!(&v[..8], &258u64.to_le_bytes());
        assert_eq!(&v[8..], &[0xff, 0xd8]);
    }

    #[test]
    fn 포트_확인은_진짜로_붙어_본다() {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        assert!(port_open(port));
        drop(l);
        assert!(!port_open(port), "크롬이 죽으면 포트 파일이 남아도 붙을 곳이 없다");
    }

    #[test]
    fn 꺼진_크롬의_상태_파일은_거른다() {
        // 2026-10-05 QA 5 — 유휴 닫기 뒤 사람 부르기가 죽은 포트로 상태 파일을 다시 써서 모달이 '화면 받는 중'에 멈췄다
        let l = parse_live(r#"{"profile":"acme","pid":11,"sessionPid":22,"port":5000,"wsPath":"/devtools/browser/ab-12"}"#).unwrap();
        assert_eq!(live_kind(&l, |_| true, |_| true), LiveKind::Show);
        assert_eq!(live_kind(&l, |_| false, |_| true), LiveKind::Remove, "래퍼가 죽었으면 파일을 치운다");
        // 래퍼는 살아 있는데 크롬만 꺼졌으면 숨기기만 — 래퍼가 곧 새 포트로 다시 쓸 파일을 앱이 지우면 그 사이 쓴 것까지 날아간다
        assert_eq!(live_kind(&l, |_| true, |_| false), LiveKind::Hide);
    }

    #[test]
    fn 화면_받기에_실패하면_잠깐_이유를_보여_주고_다시_붙는다() {
        // 실패한 일꾼을 다음 물음(66ms)마다 새로 띄워 이유가 바로 지워졌다 — 모달엔 '화면 받는 중'만 남았다(QA 5)
        let now = Instant::now();
        assert!(reuse_worker(false, None, now), "도는 일꾼은 그대로");
        assert!(!reuse_worker(true, None, now), "실패 없이 끝났으면(보는 칸이 없어 쉼) 바로 새로");
        assert!(reuse_worker(true, Some(now), now + Duration::from_millis(500)), "막 실패했으면 이유를 보여 준다");
        assert!(!reuse_worker(true, Some(now), now + RETRY), "조금 뒤엔 다시 붙어 본다");
    }

}

#[cfg(test)]
#[path = "agent_browser_e2e.rs"]
mod e2e;

#[cfg(test)]
#[path = "chrome_popup_e2e.rs"]
mod popup_e2e;
