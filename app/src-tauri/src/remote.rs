//! 다른 기기의 참모와 잇기 — 같은 테일스케일 계정 기기의 폰 서버에 '참모 손님'으로(ADR 0007).
//! 원격 기기는 자기 폰 서버(mobile_http.rs, 47123)를 그대로 쓰고, 이 앱은 그 서버의 '손님'이 된다(docs/research/2026-10-06-multi-device.md).
//! - 기기 찾기: 이 맥 `tailscale status --json` 의 같은 계정 피어(태그·공유 노드 빼고) × `/api/hello`
//! - 신원: 처음 한 번 그 기기 설정의 연결 코드로 짝짓기(peer 줄) → 기기 열쇠는 키체인(윈도우는 자격 증명 관리자, wincred.rs)에만, 목록 파일엔 열쇠 없이
//! - 대신 보내기: 허용한 길만(보기·이름표 붙는 말 넣기·답 읽기), 응답은 상한·JSON 확인 뒤 화면으로. 원격이 보낸 것은 남의 글이다 —
//!   이 맥 파일·명령 길(파일 열기·셸)로 절대 흘려보내지 않는다(그런 길은 허용 목록에 없다)
use crate::accounts_store::{Secret, Store};
use crate::remote_net::{NetErr, Request, Response, Route, Target};
use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;
use std::path::Path;
use std::time::Duration;

/// 키체인 칸 서비스 이름 — 계정 = 기기의 테일스케일 노드 ID
pub const SERVICE: &str = "Chammo remote peer";
/// 열쇠 저장소 이름(사람이 읽는 오류 글)
const STORE_WORD: &str = if cfg!(windows) { "자격 증명 관리자" } else { "키체인" };

/// 연결을 받는 쪽·요청하는 쪽이 될 수 있는 OS — 짝 열쇠를 둘 저장소가 있는 곳(맥 키체인·윈도우 자격 증명 관리자)
pub fn can_link(os: &str) -> bool {
    matches!(os, "macos" | "windows")
}

pub const FILE: &str = "remote-peers.json";
const PORT: u16 = 47123;

/// 다른 기기 폰 서버 포트 — 본판은 늘 47123. 개발판만 CHAMMO_PEER_PORT 로 바꿀 수 있다(같은 기기에 본판이 47123 을 쥔 채 시험 앱을 붙일 때)
pub fn peer_port_from(env: Option<&str>, debug: bool) -> u16 {
    if !debug {
        return PORT;
    }
    env.and_then(|p| p.parse().ok()).unwrap_or(PORT)
}

/// 키체인 칸 서비스 이름 — 본판은 늘 SERVICE. 개발판만 CHAMMO_PEER_SERVICE 로 바꿀 수 있다(시험 앱이 진짜 앱의 짝 열쇠 칸을 덮지 않게 —
/// 키체인 set 은 있는 칸의 값을 그 자리에서 바꾼다)
pub fn service_from(env: Option<&str>, debug: bool) -> String {
    match env.map(str::trim).filter(|s| debug && !s.is_empty()) {
        Some(s) => s.to_string(),
        None => SERVICE.to_string(),
    }
}

fn service() -> String {
    service_from(std::env::var("CHAMMO_PEER_SERVICE").ok().as_deref(), cfg!(debug_assertions))
}

fn peer_port() -> u16 {
    peer_port_from(std::env::var("CHAMMO_PEER_PORT").ok().as_deref(), cfg!(debug_assertions))
}
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
    /// 그 기기가 연결을 받는 쪽이 될 수 있다고 했나(hello link, 0.3.8~). 옛 맥은 없어도 받는다 — 화면이 OS 와 같이 본다
    pub link: bool,
    pub version: Option<String>,
    pub last_ok: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Presence {
    /// link = 연결 요청을 받을 수 있다고 했나(0.3.8~)
    Chammo { proto: u32, version: String, link: bool },
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

/// 이 기기 노드 ID — 연결 요청에 '나는 이 노드'로 싣는다(받는 쪽이 되물어 확인한다)
pub fn self_id(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    Some(clean(v["Self"]["ID"].as_str()?, 64)).filter(|s| !s.is_empty())
}

/// 연결 요청을 받은 쪽이 그 노드를 자기 테일넷에서 찾는다 — 같은 계정·태그 없는 피어만. 이름·테일넷 이름은 요청이 아니라 여기 tailscale 이 말한 것
pub fn link_peer(json: &str, node: &str) -> Option<crate::peer_ask::LinkPeer> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let (_, peers) = same_user_peers(json)?;
    let p = peers.into_iter().find(|p| p.id == node)?;
    let tailnet = v["CurrentTailnet"]["Name"].as_str().or(v["CurrentTailnet"]["MagicDNSSuffix"].as_str()).or(v["MagicDNSSuffix"].as_str()).unwrap_or("");
    Some(crate::peer_ask::LinkPeer { id: p.id, name: p.name, os: p.os, ip: p.ip, tailnet: clean(tailnet, 64) })
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
            Presence::Chammo { proto: v["proto"].as_u64().unwrap_or(0) as u32, version, link: v["link"] == true }
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
        let (old, version, link) = match &pr.hello {
            Presence::Chammo { version, link, .. } => (false, Some(version.clone()).filter(|v| !v.is_empty()), *link),
            Presence::Old => (true, None, false),
            Presence::Absent => (false, None, false),
        };
        let status = match (s.is_some(), &pr.hello, pr.auth) {
            (true, _, Some(true)) => "connected",
            (true, Presence::Absent, _) => "offline",
            (true, _, _) => "pair",
            (false, Presence::Absent, _) => continue,
            (false, _, _) => "pair",
        };
        out.push(DeviceView { id: p.id.clone(), name: p.name.clone(), os: p.os.clone(), status, paired: s.is_some(), old, link, version, last_ok: s.and_then(|s| s.last_ok) });
    }
    // 짝지었는데 테일넷 목록에서 사라진 기기(지워졌거나 이름이 바뀜) — 끊김으로 남긴다
    for s in saved.iter().filter(|s| !peers.iter().any(|p| p.id == s.id)) {
        out.push(DeviceView { id: s.id.clone(), name: s.name.clone(), os: String::new(), status: "offline", paired: true, old: false, link: false, version: None, last_ok: s.last_ok });
    }
    out
}

/// 손님(다른 기기 참모 열쇠)이 쓰는 길 — 보기 + 이름표 붙는 말 넣기·답 읽기(ADR 0007). 받는 폰 서버도 peer 열쇠엔 이 목록만 연다.
/// 사람 길(이름표 없이 치기 /api/send·카드 답 /api/direct-answer·멈춤)과 파일·깨우기·지우기·계정·로그인·짝짓기 코드는 없다
pub(crate) const GETS: &[&str] = &[
    "/api/hello", "/api/env", "/api/sessions", "/api/stopped", "/api/transcript", "/api/tails", "/api/send-status", "/api/direct", "/api/tasks",
    "/api/browsers", "/api/browser-frame", "/api/avatars", "/api/usage", "/api/load", "/api/roles", "/api/pins", "/api/order", "/api/routines",
    "/api/peer-reply",
];
pub(crate) const POSTS: &[&str] = &["/api/peer-say"];

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
    let code = norm_code(code).ok_or("연결 코드는 16진 32자예요 — 그 기기 설정 > 폰의 코드를 그대로 붙여 넣어 주세요")?;
    let name = format!("참모 · {}", if my_name.is_empty() { "이 기기" } else { my_name });
    let body = serde_json::json!({ "code": code, "peer": true, "name": name }).to_string();
    let t = Target { ip: peer.ip, port: peer_port() };
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
    kc.set(&service(), &peer.id, &Secret::new(token)).map_err(|e| format!("열쇠를 {STORE_WORD}에 못 넣었어요({e:?})"))?;
    let mut list = load(dir);
    list.retain(|s| s.id != peer.id);
    list.push(Saved { id: peer.id.clone(), name: peer.name.clone(), ip: peer.ip, port: peer_port(), paired_at: now_ms(), last_ok: Some(now_ms()) });
    save(dir, &list).map_err(|e| e.to_string())
}

pub fn unpair(kc: &dyn Store, dir: &Path, id: &str) -> Result<(), String> {
    kc.remove(&service(), id).map_err(|e| format!("{STORE_WORD} 칸을 못 지웠어요({e:?})"))?;
    let mut list = load(dir);
    list.retain(|s| s.id != id);
    save(dir, &list).map_err(|e| e.to_string())
}

/// 끊기 — 이 기기 열쇠 + 그 기기가 이 기기에 쓰던 줄(양방향으로 이었으니 끊기도 양쪽)
pub fn unpair_with(kc: &dyn Store, dir: &Path, lines: &crate::mobile_pair::Devices, id: &str) -> Result<(), String> {
    lines.remove_node(id).map_err(|e| format!("기기 줄을 못 지웠어요({e})"))?;
    unpair(kc, dir, id)
}

/// 코드 없이 잇기에 쓰는 것들 — 키체인·목록 폴더·이 기기 폰 서버의 기기 줄·요청 상태
pub struct Link<'a> {
    pub kc: &'a dyn Store,
    pub dir: &'a Path,
    pub lines: &'a crate::mobile_pair::Devices,
    pub asks: &'a crate::peer_ask::Asks,
}

fn hex64(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn upsert_saved(dir: &Path, id: &str, name: &str, ip: Ipv4Addr) -> std::io::Result<()> {
    let mut list = load(dir);
    list.retain(|s| s.id != id);
    list.push(Saved { id: id.into(), name: name.into(), ip, port: peer_port(), paired_at: now_ms(), last_ok: Some(now_ms()) });
    save(dir, &list)
}

/// 받는 쪽 — 사람이 허용했고 요청한 기기가 받아 가는 순간: 열쇠 둘을 만들어 (그 기기가 이 기기에 쓸 것 → 기기 줄 해시, 이 기기가 그 기기에 쓸 것 → 키체인)
/// 둘 중 하나라도 못 걸면 되돌린다(반쪽 연결을 남기지 않는다)
pub fn accept(kc: &dyn Store, dir: &Path, lines: &crate::mobile_pair::Devices, p: &crate::peer_ask::LinkPeer) -> Result<(String, String), String> {
    let rnd = || crate::mobile_pair::random_hex(32).map_err(|e| e.to_string());
    let (token, back) = (rnd()?, rnd()?);
    lines.add_peer(&token, &format!("참모 · {}", p.name), &p.id, std::time::SystemTime::now()).map_err(|e| e.to_string())?;
    if let Err(e) = kc.set(&service(), &p.id, &Secret::new(back.clone())) {
        let _ = lines.remove_node(&p.id);
        return Err(format!("열쇠를 {STORE_WORD}에 못 넣었어요({e:?})"));
    }
    if let Err(e) = upsert_saved(dir, &p.id, &p.name, p.ip) {
        let _ = lines.remove_node(&p.id);
        let _ = kc.remove(&service(), &p.id);
        return Err(e.to_string());
    }
    Ok((token, back))
}

/// 요청하는 쪽 — '연결'을 누르면: 요청 번호를 적어 두고 그 기기에 요청 → 사람이 허용할 때까지 기다렸다가 열쇠 둘을 받아 건다.
/// pause = 한 번 묻고 쉬기(2초), now = 지금(ms) — 시험에선 가짜 시계
pub fn connect(l: &Link, me_id: &str, peer: &TsPeer, send: &SendFn, pause: &dyn Fn(), now: &dyn Fn() -> u64) -> Result<(), String> {
    let req = l.asks.start(&peer.id, now())?;
    let r = connect_inner(l, me_id, peer, &req, send, pause, now);
    l.asks.end(&req);
    r
}

fn connect_inner(l: &Link, me_id: &str, peer: &TsPeer, req: &str, send: &SendFn, pause: &dyn Fn(), now: &dyn Fn() -> u64) -> Result<(), String> {
    let t = Target { ip: peer.ip, port: peer_port() };
    let body = serde_json::json!({ "req": req, "node": me_id }).to_string();
    let r = send(&t, &Request { method: "POST", path: "/api/link-request", body: Some(body.as_bytes()), token: None }, CALL_WAIT, 4096).map_err(|e| net_word(&e))?;
    let text = String::from_utf8_lossy(&r.body).trim().to_string();
    match r.status {
        200..=299 => {}
        404 => return Err("그 기기 Chammo 가 옛 판이에요 — 그 기기를 업데이트하거나 '코드로'로 이어 주세요".into()),
        403 if text.starts_with("unconfirmed") => return Err("그 기기가 이 기기를 확인하지 못했어요 — 두 기기 다 Chammo 를 켜 두고 다시".into()),
        403 => return Err("같은 테일스케일 계정 기기끼리만 이어져요".into()),
        429 => return Err("연결 요청이 너무 잦아요 — 10분쯤 뒤에 다시".into()),
        501 => return Err("그 기기 Chammo 가 옛 판이라 연결을 못 받아요 — 그 기기를 업데이트해 주세요".into()),
        s => return Err(format!("그 기기가 연결 요청을 못 받았어요({s})")),
    }
    let end = now() + crate::peer_ask::TTL_MS + crate::peer_ask::PICKUP_MS;
    let path = format!("/api/link-status?req={req}");
    loop {
        if now() > end {
            return Err("5분 안에 그 기기에서 허용하지 않았어요".into());
        }
        if !l.asks.waiting(req, now()) {
            return Err("연결을 취소했어요".into());
        }
        // 한 번 못 닿는 건 넘긴다(절전에서 깨는 중) — 다음 바퀴에 다시
        if let Ok(r) = send(&t, &Request { method: "GET", path: &path, body: None, token: None }, HELLO_WAIT, 4096) {
            if r.status == 404 {
                return Err("그 기기가 이 요청을 잊었어요(그 기기 앱이 다시 켜졌나요?) — 다시 연결해 주세요".into());
            }
            let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap_or_default();
            match (r.status, v["state"].as_str().unwrap_or("")) {
                (200, "yes") => return keep(l, peer, v["token"].as_str().unwrap_or(""), v["back"].as_str().unwrap_or("")),
                (200, "no") => return Err("그 기기에서 거절했어요".into()),
                (200, "expired") => return Err("5분 안에 그 기기에서 허용하지 않았어요".into()),
                (200, "failed") => return Err("그 기기가 연결하다 실패했어요 — 다시 해 주세요".into()),
                _ => {}
            }
        }
        pause();
    }
}

/// 받은 열쇠 둘 걸기 — 못 걸면 되돌린다
fn keep(l: &Link, peer: &TsPeer, token: &str, back: &str) -> Result<(), String> {
    if !hex64(token) || !hex64(back) || token == back {
        return Err("그 기기가 준 열쇠 모양이 이상해요".into());
    }
    l.kc.set(&service(), &peer.id, &Secret::new(token.to_string())).map_err(|e| format!("열쇠를 {STORE_WORD}에 못 넣었어요({e:?})"))?;
    if let Err(e) = l.lines.add_peer(back, &format!("참모 · {}", peer.name), &peer.id, std::time::SystemTime::now()) {
        let _ = l.kc.remove(&service(), &peer.id);
        return Err(e.to_string());
    }
    upsert_saved(l.dir, &peer.id, &peer.name, peer.ip).map_err(|e| e.to_string())
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
    let token = kc.get(&service(), id).map_err(|e| format!("{STORE_WORD}에서 열쇠를 못 읽었어요({e:?})"))?.ok_or("pair")?;
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

#[cfg(not(windows))]
fn keychain() -> crate::accounts_store::Keychain {
    // 창은 안 띄운다 — 개발판을 다시 빌드하면 서명이 바뀌어 못 읽는데(교훈), 그땐 '다시 짝짓기'로 보인다
    crate::accounts_store::Keychain { path: None, unlock: None, quiet: true, cli_service: None }
}

/// 윈도우는 키체인 대신 자격 증명 관리자(창 없음)
#[cfg(windows)]
fn keychain() -> crate::wincred::WinCred {
    crate::wincred::WinCred
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
                        let t = Target { ip: p.ip, port: peer_port() };
                        let hello = presence(&send(&t, &Request { method: "GET", path: "/api/hello", body: None, token: None }, HELLO_WAIT, 4096));
                        let auth = (saved.iter().any(|s| s.id == p.id) && hello != Presence::Absent).then(|| {
                            let tok = kc.get(&service(), &p.id).ok().flatten();
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

/// 짝짓기(실제 테일넷·키체인) — 앱 화면과 scripts/peer(appctl) 가 같이 쓴다
pub fn pair_now(id: &str, code: &str) -> Result<(), String> {
    let (route, json) = tailnet()?;
    let (me, peers) = same_user_peers(&json).ok_or("테일스케일이 꺼져 있거나 로그인 전이에요")?;
    let peer = peers.into_iter().find(|p| p.id == id).ok_or("테일넷에 그 기기가 없어요(같은 계정 기기만)")?;
    pair(&keychain(), &data_dir(), &peer, code, &me, &real_send(route))
}

pub fn unpair_now(id: &str) -> Result<(), String> {
    unpair_with(&keychain(), &data_dir(), &crate::mobile::devices(), id)
}

#[tauri::command]
pub async fn remote_pair(id: String, code: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || pair_now(&id, &code)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remote_unpair(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || unpair_now(&id)).await.map_err(|e| e.to_string())?
}

/// 연결 요청을 받는 쪽 진짜 바깥 — 맥(키체인)·윈도우(자격 증명 관리자). 그 밖은 '못 받음'(501)
pub struct RealLink;

impl crate::peer_ask::LinkEnv for RealLink {
    fn supported(&self) -> bool {
        can_link(std::env::consts::OS)
    }
    fn lookup(&self, node: &str) -> Option<crate::peer_ask::LinkPeer> {
        let (_, json) = tailnet().ok()?;
        link_peer(&json, node)
    }
    /// 요청한 기기의 지금 테일넷 주소로 되묻는다 — 요청이 온 출발지(userspace 면 127.0.0.1)는 안 믿는다
    fn confirm(&self, p: &crate::peer_ask::LinkPeer, hash: &str) -> bool {
        let Ok((route, _)) = tailnet() else { return false };
        let path = format!("/api/link-check?h={hash}");
        let r = crate::remote_net::send(&route, &Target { ip: p.ip, port: peer_port() }, &Request { method: "GET", path: &path, body: None, token: None }, HELLO_WAIT, 4096);
        r.is_ok_and(|r| r.status == 200 && serde_json::from_slice::<serde_json::Value>(&r.body).is_ok_and(|v| v["ok"] == true))
    }
    fn card(&self, p: &crate::peer_ask::LinkPeer, until_ms: u64) -> Result<String, String> {
        crate::direct::ask_link(p, until_ms)
    }
    fn close_card(&self, card: &str, _done: bool, note: &str) {
        crate::direct::close_link(card, note);
    }
    fn commit(&self, p: &crate::peer_ask::LinkPeer) -> Result<(String, String), String> {
        accept(&keychain(), &data_dir(), &crate::mobile::devices(), p)
    }
}

/// 연결(실제 테일넷·키체인) — 앱 화면 '연결'과 scripts/peer connect 가 같이 쓴다. 허용될 때까지(최대 6분) 붙잡는다
pub fn connect_now(id: &str) -> Result<(), String> {
    if !can_link(std::env::consts::OS) {
        return Err("다른 기기 참모 연결은 맥·윈도우에서만 돼요".into());
    }
    // 그 기기가 이 기기 폰 서버로 되물어 확인하고, 이어진 뒤엔 그 기기 참모도 이리로 말을 넣는다
    if !crate::mobile::server_running() {
        return Err("이 기기 설정 > 폰을 먼저 켜 주세요 — 그 기기가 이 기기에 되물어 확인해요".into());
    }
    let (route, json) = tailnet()?;
    let (_, peers) = same_user_peers(&json).ok_or("테일스케일이 꺼져 있거나 로그인 전이에요")?;
    let me = self_id(&json).ok_or("테일스케일에서 이 기기 번호를 못 읽었어요")?;
    let peer = peers.into_iter().find(|p| p.id == id).ok_or("테일넷에 그 기기가 없어요(같은 계정 기기만)")?;
    let (kc, dir, lines) = (keychain(), data_dir(), crate::mobile::devices());
    let l = Link { kc: &kc, dir: &dir, lines: &lines, asks: crate::peer_ask::asks() };
    connect(&l, &me, &peer, &real_send(route), &|| std::thread::sleep(Duration::from_secs(2)), &now_ms)
}

#[tauri::command]
pub async fn remote_connect(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || connect_now(&id)).await.map_err(|e| e.to_string())?
}

/// 기다리던 연결 거두기 — 다음 바퀴(2초 안)에 멈추고, 그 기기의 되묻기에도 '모름'으로 답한다
#[tauri::command]
pub fn remote_connect_cancel(id: String) {
    crate::peer_ask::asks().cancel_node(&id);
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

pub fn call_now(id: &str, method: &str, path: &str, body: Option<&str>) -> Result<CallOut, String> {
    let (route, peers) = route_and_peers()?;
    let here = peers.iter().find(|p| p.id == id).map(|p| p.ip);
    call(&keychain(), &data_dir(), id, here, method, path, body, &real_send(route))
}

#[tauri::command]
pub async fn remote_call(id: String, method: String, path: String, body: Option<String>) -> Result<CallOut, String> {
    tauri::async_runtime::spawn_blocking(move || call_now(&id, &method, &path, body.as_deref())).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "remote_tests.rs"]
mod tests;
