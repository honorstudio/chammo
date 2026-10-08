//! 다른 기기의 참모를 이 앱에서 조종하기 — 1단계(보기 + 채팅)의 아래층.
//! 원격 기기는 자기 폰 서버(mobile_http.rs, 47123)를 그대로 쓰고, 이 앱은 그 서버의 '손님'이 된다(docs/research/2026-10-06-multi-device.md).
//! - 기기 찾기: 이 맥 `tailscale status --json` 의 같은 계정 피어(태그·공유 노드 빼고) × `/api/hello`
//! - 신원: 처음 한 번 그 기기 설정의 연결 코드로 짝짓기(peer 줄) → 기기 열쇠는 키체인에만, 목록 파일엔 열쇠 없이
//! - 대신 보내기: 허용한 길만(보기·채팅·대기함 답하기), 응답은 상한·JSON 확인 뒤 화면으로. 원격이 보낸 것은 남의 글이다 —
//!   이 맥 파일·명령 길(파일 열기·셸)로 절대 흘려보내지 않는다(그런 길은 허용 목록에 없다)
use crate::accounts_store::{Secret, Store};
use crate::remote_net::{NetErr, Request, Response, Route, Target};
use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;
use std::path::Path;
use std::time::Duration;

/// 키체인 칸 서비스 이름 — 계정 = 기기의 테일스케일 노드 ID
pub const SERVICE: &str = "Chammo remote peer";
pub const FILE: &str = "remote-peers.json";
const PORT: u16 = 47123;
const HELLO_WAIT: Duration = Duration::from_secs(3);
const CALL_WAIT: Duration = Duration::from_secs(10);
const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_SEND: usize = 64 * 1024;

/// 테일넷의 같은 계정 기기 하나
#[derive(Debug, Clone, PartialEq)]
pub struct TsPeer {
    pub id: String,
    pub name: String,
    pub os: String,
    pub ip: Ipv4Addr,
    pub online: bool,
}

/// 짝지은 기기(열쇠는 키체인, 여기엔 없음)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub id: String,
    pub name: String,
    pub ip: Ipv4Addr,
    pub port: u16,
    pub paired_at: u64,
    #[serde(default)]
    pub last_ok: Option<u64>,
}

/// 화면 한 줄 — status: connected(열쇠 통함) · pair(참모는 있는데 열쇠 없음/끊김) · offline(짝지은 기기가 안 닿음)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub id: String,
    pub name: String,
    pub os: String,
    pub status: &'static str,
    pub paired: bool,
    /// hello 를 모르는 옛판 — 짝짓기·보기·채팅은 되지만 업데이트 권함
    pub old: bool,
    pub version: Option<String>,
    pub last_ok: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Presence {
    Chammo { proto: u32, version: String },
    /// 열쇠 없음(401)으로 답함 — hello 없는 옛 Chammo
    Old,
    Absent,
}

/// 한 기기 물어본 결과 — auth: 열쇠로 /api/env 가 통했나(짝지은 기기만)
pub struct Probe {
    pub hello: Presence,
    pub auth: Option<bool>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 화면에 찍힐 짧은 글 — 제어 글자·꺾쇠 빼고 길이 제한(원격이 준 글이다)
fn clean(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control() && !matches!(c, '<' | '>' | '"' | '\'' | '`')).take(max).collect()
}

/// (내 호스트 이름, 같은 계정 피어) — 꺼짐·로그아웃이면 None
pub fn same_user_peers(json: &str) -> Option<(String, Vec<TsPeer>)> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    if v["BackendState"].as_str() != Some("Running") {
        return None;
    }
    let me = &v["Self"];
    let uid = me["UserID"].as_u64()?;
    let ip4 = |p: &serde_json::Value| p["TailscaleIPs"].as_array().and_then(|a| a.iter().filter_map(|s| s.as_str()?.parse::<Ipv4Addr>().ok()).next());
    let mut peers: Vec<TsPeer> = v["Peer"]
        .as_object()
        .map(|m| {
            m.values()
                .filter(|p| p["UserID"].as_u64() == Some(uid) && p["Tags"].as_array().is_none_or(|t| t.is_empty()))
                .filter_map(|p| {
                    Some(TsPeer {
                        id: clean(p["ID"].as_str()?, 64),
                        name: clean(p["HostName"].as_str().unwrap_or(""), 64),
                        os: clean(p["OS"].as_str().unwrap_or(""), 16),
                        ip: ip4(p)?,
                        online: p["Online"].as_bool().unwrap_or(false),
                    })
                })
                .filter(|p| !p.id.is_empty())
                .collect()
        })
        .unwrap_or_default();
    peers.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.id.cmp(&b.id)));
    Some((clean(me["HostName"].as_str().unwrap_or(""), 64), peers))
}

pub fn presence(r: &Result<Response, NetErr>) -> Presence {
    match r {
        Ok(resp) if resp.status == 200 => {
            let Ok(v) = serde_json::from_slice::<serde_json::Value>(&resp.body) else { return Presence::Absent };
            if v["app"] != "chammo" {
                return Presence::Absent;
            }
            let ver = v["version"].as_str().unwrap_or("");
            let version = if ver.len() <= 32 && ver.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+')) { ver.to_string() } else { String::new() };
            Presence::Chammo { proto: v["proto"].as_u64().unwrap_or(0) as u32, version }
        }
        Ok(resp) if resp.status == 401 => Presence::Old,
        _ => Presence::Absent,
    }
}

/// 테일넷 피어 + 짝지은 목록 + 물어본 결과 → 기기 칸. 참모가 없는 기기(폰·참모 안 깐 PC)는 안 보인다
pub fn merge(peers: &[TsPeer], saved: &[Saved], probe: impl Fn(&str) -> Probe) -> Vec<DeviceView> {
    let mut out = Vec::new();
    for p in peers {
        let s = saved.iter().find(|s| s.id == p.id);
        let pr = probe(&p.id);
        let (old, version) = match &pr.hello {
            Presence::Chammo { version, .. } => (false, Some(version.clone()).filter(|v| !v.is_empty())),
            Presence::Old => (true, None),
            Presence::Absent => (false, None),
        };
        let status = match (s.is_some(), &pr.hello, pr.auth) {
            (true, _, Some(true)) => "connected",
            (true, Presence::Absent, _) => "offline",
            (true, _, _) => "pair",
            (false, Presence::Absent, _) => continue,
            (false, _, _) => "pair",
        };
        out.push(DeviceView { id: p.id.clone(), name: p.name.clone(), os: p.os.clone(), status, paired: s.is_some(), old, version, last_ok: s.and_then(|s| s.last_ok) });
    }
    // 짝지었는데 테일넷 목록에서 사라진 기기(지워졌거나 이름이 바뀜) — 끊김으로 남긴다
    for s in saved.iter().filter(|s| !peers.iter().any(|p| p.id == s.id)) {
        out.push(DeviceView { id: s.id.clone(), name: s.name.clone(), os: String::new(), status: "offline", paired: true, old: false, version: None, last_ok: s.last_ok });
    }
    out
}

/// 손님이 대신 보내도 되는 길 — 1단계 보기 + 채팅 + 대기함 답하기. 파일·깨우기·지우기·계정·로그인·짝짓기 코드는 없다
const GETS: &[&str] = &[
    "/api/hello", "/api/env", "/api/sessions", "/api/stopped", "/api/transcript", "/api/tails", "/api/send-status", "/api/direct", "/api/tasks",
    "/api/browsers", "/api/browser-frame", "/api/avatars", "/api/usage", "/api/load", "/api/roles", "/api/pins", "/api/routines",
];
const POSTS: &[&str] = &["/api/send", "/api/interrupt", "/api/direct-answer"];

pub fn allowed(method: &str, path_q: &str) -> bool {
    // 머리 끼워 넣기(CR·LF)·공백·비ASCII 는 길째 거절 — 쿼리는 부르는 쪽이 encodeURIComponent 한다
    if !path_q.bytes().all(|b| b.is_ascii_graphic()) {
        return false;
    }
    let (path, _q) = path_q.split_once('?').unwrap_or((path_q, ""));
    let list = match method {
        "GET" => GETS,
        "POST" => POSTS,
        _ => return false,
    };
    list.contains(&path)
}

/// 붙여 넣은 연결 코드(16진 32자) — 공백·대문자·QR 주소 통째도 받는다
pub fn norm_code(raw: &str) -> Option<String> {
    let s = raw.trim();
    let s = s.split_once("pair=").map(|(_, c)| c.split('&').next().unwrap_or("")).unwrap_or(s);
    let c: String = s.chars().filter(|c| !c.is_whitespace() && *c != '-').collect::<String>().to_ascii_lowercase();
    (c.len() == 32 && c.chars().all(|c| c.is_ascii_hexdigit())).then_some(c)
}

pub fn load(dir: &Path) -> Vec<Saved> {
    std::fs::read_to_string(dir.join(FILE)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save(dir: &Path, list: &[Saved]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    crate::mobile_pair::write_private(&dir.join(FILE), &serde_json::to_string_pretty(list).map_err(std::io::Error::other)?)
}

/// 원격에 요청 하나 — 시험에선 가짜를 넣는다
pub type SendFn<'a> = dyn Fn(&Target, &Request, Duration, usize) -> Result<Response, NetErr> + 'a;

fn net_word(e: &NetErr) -> String {
    match e {
        NetErr::Refused => "그 기기에 참모가 꺼져 있어요".into(),
        NetErr::Timeout => "그 기기에 닿지 않아요(꺼짐·절전·테일스케일 끊김)".into(),
        NetErr::TooBig => "응답이 너무 커요".into(),
        NetErr::Bad(_) | NetErr::Io(_) => "그 기기와 말이 안 통해요".into(),
    }
}

/// 짝짓기 — 원격 /api/pair 에 코드를 내고 받은 열쇠를 키체인에, 기기를 목록에
pub fn pair(kc: &dyn Store, dir: &Path, peer: &TsPeer, code: &str, my_name: &str, send: &SendFn) -> Result<(), String> {
    let code = norm_code(code).ok_or("연결 코드는 16진 32자예요 — 그 기기 설정 > 모바일의 코드를 그대로 붙여 넣어 주세요")?;
    let name = format!("참모 · {}", if my_name.is_empty() { "이 기기" } else { my_name });
    let body = serde_json::json!({ "code": code, "peer": true, "name": name }).to_string();
    let t = Target { ip: peer.ip, port: PORT };
    let post = |b: &str| send(&t, &Request { method: "POST", path: "/api/pair", body: Some(b.as_bytes()), token: None }, CALL_WAIT, 4096).map_err(|e| net_word(&e));
    let mut r = post(&body)?;
    // 0.2.5 까지의 폰 서버는 모르는 칸(peer·name)을 400 으로 거절한다(deny_unknown_fields) — 코드는 안 닳으니 코드만 다시. 그 기기엔 '기기' 줄로 남는다
    if r.status == 400 {
        r = post(&serde_json::json!({ "code": code }).to_string())?;
    }
    match r.status {
        200 => {}
        401 => return Err("연결 코드가 틀렸거나 10분이 지났어요 — 그 기기에서 새 코드를 만들어 주세요".into()),
        403 => return Err("그 기기가 연결을 막았어요(주소가 안 맞음)".into()),
        s => return Err(format!("그 기기가 짝짓기를 못 했어요({s})")),
    }
    let token = serde_json::from_slice::<serde_json::Value>(&r.body).ok().and_then(|v| v["token"].as_str().map(str::to_string)).filter(|t| t.len() == 64 && t.chars().all(|c| c.is_ascii_hexdigit()));
    let token = token.ok_or("그 기기가 준 열쇠 모양이 이상해요")?;
    kc.set(SERVICE, &peer.id, &Secret::new(token)).map_err(|e| format!("열쇠를 키체인에 못 넣었어요({e:?})"))?;
    let mut list = load(dir);
    list.retain(|s| s.id != peer.id);
    list.push(Saved { id: peer.id.clone(), name: peer.name.clone(), ip: peer.ip, port: PORT, paired_at: now_ms(), last_ok: Some(now_ms()) });
    save(dir, &list).map_err(|e| e.to_string())
}

pub fn unpair(kc: &dyn Store, dir: &Path, id: &str) -> Result<(), String> {
    kc.remove(SERVICE, id).map_err(|e| format!("키체인 칸을 못 지웠어요({e:?})"))?;
    let mut list = load(dir);
    list.retain(|s| s.id != id);
    save(dir, &list).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct CallOut {
    pub status: u16,
    /// 글 응답(JSON·텍스트)
    pub text: Option<String>,
    /// 그림 같은 바이트 응답
    pub b64: Option<String>,
}

/// 대신 보내기. here = 지금 테일넷(같은 계정)에서 그 노드 ID 의 주소 — 짝지을 때 적은 주소는 안 믿는다(노드가 지워지고 주소가 남에게 가면 열쇠가 샌다).
/// 오류 글 "pair" = 열쇠가 끊겼다(다시 짝짓기), 그 밖은 사람이 읽는 이유
pub fn call(kc: &dyn Store, dir: &Path, id: &str, here: Option<Ipv4Addr>, method: &str, path: &str, body: Option<&str>, send: &SendFn) -> Result<CallOut, String> {
    if !allowed(method, path) {
        return Err("그 길은 다른 기기로 못 보내요".into());
    }
    if let Some(b) = body {
        if b.len() > MAX_SEND || serde_json::from_str::<serde_json::Value>(b).is_err() {
            return Err("보낼 몸통이 JSON 이 아니거나 너무 커요".into());
        }
    }
    let mut list = load(dir);
    let Some(i) = list.iter().position(|s| s.id == id) else { return Err("짝지은 기기가 아니에요".into()) };
    let ip = here.ok_or("테일넷에 그 기기가 안 보여요(꺼짐·지워짐·다른 계정)")?;
    let token = kc.get(SERVICE, id).map_err(|e| format!("키체인을 못 읽었어요({e:?})"))?.ok_or("pair")?;
    let t = Target { ip, port: list[i].port };
    let r = send(&t, &Request { method, path, body: body.map(str::as_bytes), token: Some(token.expose()) }, CALL_WAIT, MAX_BODY).map_err(|e| net_word(&e))?;
    if r.status == 401 {
        return Err("pair".into());
    }
    // 1분에 한 번만 파일에 — 마지막으로 닿은 때(끊겼을 때 '언제까지 봤나')
    let now = now_ms();
    if list[i].last_ok.is_none_or(|t| now.saturating_sub(t) > 60_000) {
        list[i].last_ok = Some(now);
        let _ = save(dir, &list);
    }
    let binary = r.ctype.starts_with("application/octet-stream") || r.ctype.starts_with("image/");
    if binary {
        use base64::Engine;
        return Ok(CallOut { status: r.status, text: None, b64: Some(base64::engine::general_purpose::STANDARD.encode(&r.body)) });
    }
    Ok(CallOut { status: r.status, text: Some(String::from_utf8_lossy(&r.body).into_owned()), b64: None })
}

// ── 앱에 붙이는 길(실제 망·키체인·tailscale) ─────────────────────────────

fn keychain() -> crate::accounts_store::Keychain {
    // 창은 안 띄운다 — 개발판을 다시 빌드하면 서명이 바뀌어 못 읽는데(교훈), 그땐 '다시 짝짓기'로 보인다
    crate::accounts_store::Keychain { path: None, unlock: None, quiet: true, cli_service: None }
}

fn ps() -> String {
    if cfg!(not(unix)) {
        return String::new();
    }
    crate::platform::command("/bin/ps").args(["-axo", "command"]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}

/// (나가는 길, 테일스케일 상태 JSON) — userspace 맥은 그 tailscaled 소켓으로 묻고 SOCKS5 로 나간다
fn tailnet() -> Result<(Route, String), String> {
    let ps = ps();
    let sock = crate::mobile::userspace_socket(&ps);
    let route = match (&sock, crate::remote_net::socks_addr(&ps)) {
        (Some(_), Some(a)) => Route::Socks(a),
        (Some(_), None) => return Err("테일스케일이 userspace 모드인데 SOCKS5 가 꺼져 있어요 — tailscaled 에 --socks5-server=localhost:1055 를 켜 주세요".into()),
        (None, _) => Route::Direct,
    };
    let json = crate::mobile::tailscale_status_json(sock.as_deref().unwrap_or("")).ok_or("테일스케일이 꺼져 있거나 로그인 전이에요")?;
    Ok((route, json))
}

fn real_send(route: Route) -> impl Fn(&Target, &Request, Duration, usize) -> Result<Response, NetErr> {
    move |t, r, wait, max| crate::remote_net::send(&route, t, r, wait, max)
}

fn data_dir() -> std::path::PathBuf {
    crate::config::data_dir().to_path_buf()
}

#[derive(Serialize)]
pub struct DevicesOut {
    pub me: String,
    pub devices: Vec<DeviceView>,
}

#[tauri::command]
pub async fn remote_devices() -> Result<DevicesOut, String> {
    tauri::async_runtime::spawn_blocking(devices_now).await.map_err(|e| e.to_string())?
}

/// 지금 테일넷의 기기 칸 — 같은 계정 온라인 기기마다 hello(+짝지은 기기는 열쇠로 /api/env)
pub fn devices_now() -> Result<DevicesOut, String> {
    {
        let (route, json) = tailnet()?;
        let (me, peers) = same_user_peers(&json).ok_or("테일스케일이 꺼져 있거나 로그인 전이에요")?;
        let dir = data_dir();
        let saved = load(&dir);
        let kc = keychain();
        let send = real_send(route);
        // 기기마다 따로(꺼진 기기 3초를 줄 세우지 않게) — 온라인인 기기만 묻는다
        let probes: Vec<(String, Probe)> = std::thread::scope(|sc| {
            let hs: Vec<_> = peers
                .iter()
                .filter(|p| p.online)
                .map(|p| {
                    let (send, saved, kc) = (&send, &saved, &kc);
                    sc.spawn(move || {
                        let t = Target { ip: p.ip, port: PORT };
                        let hello = presence(&send(&t, &Request { method: "GET", path: "/api/hello", body: None, token: None }, HELLO_WAIT, 4096));
                        let auth = (saved.iter().any(|s| s.id == p.id) && hello != Presence::Absent).then(|| {
                            let tok = kc.get(SERVICE, &p.id).ok().flatten();
                            tok.is_some_and(|tok| send(&t, &Request { method: "GET", path: "/api/env", body: None, token: Some(tok.expose()) }, HELLO_WAIT, 64 * 1024).is_ok_and(|r| r.status == 200))
                        });
                        (p.id.clone(), Probe { hello, auth })
                    })
                })
                .collect();
            hs.into_iter().filter_map(|h| h.join().ok()).collect()
        });
        let devices = merge(&peers, &saved, |id| probes.iter().find(|(i, _)| i == id).map(|(_, p)| Probe { hello: p.hello.clone(), auth: p.auth }).unwrap_or(Probe { hello: Presence::Absent, auth: None }));
        Ok(DevicesOut { me, devices })
    }
}

#[tauri::command]
pub async fn remote_pair(id: String, code: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (route, json) = tailnet()?;
        let (me, peers) = same_user_peers(&json).ok_or("테일스케일이 꺼져 있거나 로그인 전이에요")?;
        let peer = peers.into_iter().find(|p| p.id == id).ok_or("테일넷에 그 기기가 없어요(같은 계정 기기만)")?;
        pair(&keychain(), &data_dir(), &peer, &code, &me, &real_send(route))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remote_unpair(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || unpair(&keychain(), &data_dir(), &id)).await.map_err(|e| e.to_string())?
}

/// 테일넷 피어 목록 — 대신 보내기는 폴링(3초)마다 불리니 10초 묵힌다(tailscale status 를 매번 안 부르게)
static PEERS: std::sync::Mutex<Option<(std::time::Instant, Route, Vec<TsPeer>)>> = std::sync::Mutex::new(None);
const PEERS_KEEP: Duration = Duration::from_secs(10);

fn route_and_peers() -> Result<(Route, Vec<TsPeer>), String> {
    let mut g = PEERS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, route, peers)) = g.as_ref() {
        if at.elapsed() < PEERS_KEEP {
            return Ok((route.clone(), peers.clone()));
        }
    }
    let (route, json) = tailnet()?;
    let (_, peers) = same_user_peers(&json).ok_or("테일스케일이 꺼져 있거나 로그인 전이에요")?;
    *g = Some((std::time::Instant::now(), route.clone(), peers.clone()));
    Ok((route, peers))
}

#[tauri::command]
pub async fn remote_call(id: String, method: String, path: String, body: Option<String>) -> Result<CallOut, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (route, peers) = route_and_peers()?;
        let here = peers.iter().find(|p| p.id == id).map(|p| p.ip);
        call(&keychain(), &data_dir(), &id, here, &method, &path, body.as_deref(), &real_send(route))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "remote_tests.rs"]
mod tests;
