//! Chammo 계정 로그인(중계 서버 ADR 0004) — 구글로 로그인해 이 기기 열쇠를 내 계정에 묶는다.
//! begin(기기 열쇠 서명, returnTo = 이 컴퓨터 127.0.0.1 루프백) → 시스템 브라우저 → 서버가 루프백으로 일회용 마침 코드 →
//! **내가 begin 한 loginId 의 결과만** 받아 같은 열쇠로 finish. 10분 넘으면 루프백을 닫는다.
//! - 열쇠는 지금 팀 열쇠(키체인 chammo-team)를 그대로 — 팀이 없는 새 기기만 새 열쇠를 만든다(실패하면 치움)
//! - 루프백 응답은 "Chammo로 돌아가세요" 한 줄(글 그대로, HTML 아님). 마침 코드는 화면·로그·파일에 안 남긴다
use crate::accounts_store::Store;
use crate::team_relay::{self as relay, Account, DeviceName, Http, TeamState};
use crate::team_relay_keys::{self as keys, DeviceKeys};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};

/// 로그인을 기다리는 최대 시간 — 서버 login 행(10분)과 같게
pub const LOGIN_WAIT: Duration = Duration::from_secs(600);
const PAGE: &str = "Chammo로 돌아가세요";
const RETURN_PATH: &str = "/chammo-login";
/// 루프백에 받아 주는 연결 수 상한 — 남의 프로세스가 두드려도 끝없이 붙잡히지 않게
const MAX_HITS: usize = 64;

/// 시스템 브라우저 열기 — 시험에선 가짜
pub trait Opener {
    fn open(&self, url: &str) -> Result<(), String>;
}

/// 맥 open·윈도우 url.dll. 디버그 빌드만 CHAMMO_TEAM_BROWSER(프로그램)로 바꿔 끼울 수 있다(실측 — 사람 브라우저를 안 띄우게)
pub struct SystemBrowser;

impl Opener for SystemBrowser {
    fn open(&self, url: &str) -> Result<(), String> {
        if cfg!(debug_assertions) {
            if let Some(p) = std::env::var("CHAMMO_TEAM_BROWSER").ok().filter(|p| !p.is_empty()) {
                return crate::platform::command(p).arg(url).spawn().map(|_| ()).map_err(|e| e.to_string());
            }
        }
        crate::platform::open_path(url).map_err(|e| format!("브라우저를 못 열었어요: {e}"))
    }
}

fn uuid_ok(s: &str) -> bool {
    s.len() == 36 && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

fn code_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// 이 기기 이름 — 서버 규칙(1~80자)
pub fn device_name_ok(s: &str) -> Option<String> {
    let t: String = s.chars().filter(|c| !c.is_control()).collect::<String>().trim().to_string();
    (!t.is_empty() && t.chars().count() <= 80).then_some(t)
}

/// 이 기기 이름 기본값 — 컴퓨터 이름(맥 'MacBook-Pro.local' → 'MacBook-Pro')
pub fn default_device_name() -> String {
    let mut buf = [0u8; 256];
    #[cfg(unix)]
    let raw = if unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) } == 0 {
        String::from_utf8_lossy(&buf[..buf.iter().position(|b| *b == 0).unwrap_or(buf.len())]).into_owned()
    } else {
        String::new()
    };
    #[cfg(not(unix))]
    let raw = {
        let _ = &mut buf;
        std::env::var("COMPUTERNAME").unwrap_or_default()
    };
    device_name_ok(raw.split('.').next().unwrap_or("")).unwrap_or_else(|| "Chammo".into())
}

/// 루프백 요청 하나 읽기 → (경로, 쿼리). 머리 8KB, 연결 하나에 by 까지만 — read 한 번마다가 아니라 통째로
/// (1바이트씩 흘리는 연결이 고리를 붙잡아 10분 마감이 안 돌았다, 리뷰 10-23)
fn read_request(s: &mut TcpStream, by: Instant) -> Option<(String, Vec<(String, String)>)> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        let left = by.checked_duration_since(Instant::now()).filter(|d| !d.is_zero())?;
        s.set_read_timeout(Some(left)).ok()?;
        let n = s.read(&mut chunk).ok()?;
        if n == 0 || buf.len() + n > 8 * 1024 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let mut heads = [httparse::EMPTY_HEADER; 32];
    let mut req = httparse::Request::new(&mut heads);
    req.parse(&buf).ok()?;
    if req.method? != "GET" {
        return None;
    }
    let (path, q) = req.path?.split_once('?').unwrap_or((req.path?, ""));
    let pairs = q
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned()))
        .collect();
    Some((path.to_string(), pairs))
}

fn respond(s: &mut TcpStream, status: &str) {
    let _ = write!(
        s,
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{PAGE}",
        PAGE.len()
    );
}

/// 루프백에서 내 loginId 의 결과 하나를 기다린다 → 마침 코드. 남의 loginId·다른 길은 400·404 로 돌려보내고 계속 기다린다
fn wait_result(l: &TcpListener, mine: &str, wait: Duration) -> Result<String, String> {
    l.set_nonblocking(true).map_err(|e| e.to_string())?;
    let until = Instant::now() + wait;
    let mut hits = 0;
    while Instant::now() < until {
        match l.accept() {
            Ok((mut s, _)) => {
                hits += 1;
                if hits > MAX_HITS {
                    return Err("로그인 주소에 이상한 요청이 너무 많이 왔어 — 다시 해 줘".into());
                }
                let _ = s.set_nonblocking(false);
                let _ = s.set_write_timeout(Some(Duration::from_secs(3)));
                let Some((path, q)) = read_request(&mut s, until.min(Instant::now() + Duration::from_secs(3))) else {
                    respond(&mut s, "400 Bad Request");
                    continue;
                };
                let get = |k: &str| q.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
                if path != RETURN_PATH {
                    respond(&mut s, "404 Not Found");
                    continue;
                }
                // 내가 begin 한 로그인이 아닌 결과(다른 로그인·끼어들기)는 무시 — 그 코드로는 마치지 않는다
                if get("login") != Some(mine) {
                    respond(&mut s, "400 Bad Request");
                    continue;
                }
                respond(&mut s, "200 OK");
                if get("error").is_some() {
                    return Err("로그인을 마치지 못했어(구글에서 취소했거나 시간이 지났어) — 다시 해 줘".into());
                }
                return get("code").filter(|c| code_ok(c)).map(String::from).ok_or_else(|| "로그인 결과가 이상해 — 다시 해 줘".into());
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("로그인 시간이 지났어(10분) — 다시 해 줘".into())
}

static BUSY: std::sync::Mutex<Vec<std::path::PathBuf>> = std::sync::Mutex::new(Vec::new());

/// 이 데이터 폴더에서 로그인이 도는 동안 쥐는 표 — 화면·scripts/team 로그인이 겹치거나 그사이 팀 만들기가 끼면
/// 나중 것이 team.json 의 열쇠를 덮어써 먼저 만든 열쇠가 키체인·서버 계정에 남았다(리뷰 10-23)
pub(crate) struct LoginTurn(std::path::PathBuf);

impl Drop for LoginTurn {
    fn drop(&mut self) {
        BUSY.lock().unwrap_or_else(|e| e.into_inner()).retain(|d| d != &self.0);
    }
}

pub(crate) fn login_turn(dir: &Path) -> Result<LoginTurn, String> {
    let mut g = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    if g.iter().any(|d| d == dir) {
        return Err("이미 로그인 중이야 — 브라우저에서 마치거나 10분 뒤에".into());
    }
    g.push(dir.to_path_buf());
    Ok(LoginTurn(dir.to_path_buf()))
}

pub(crate) fn login_busy(dir: &Path) -> bool {
    BUSY.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|d| d == dir)
}

/// 구글 로그인 — 브라우저를 열고 끝날 때까지 기다린다(최대 wait). 성공하면 계정·내 기기·서버에 있던 내 팀까지 채운 상태
pub fn login_with(dir: &Path, kc: &dyn Store, http: &dyn Http, opener: &dyn Opener, server: &str, device_name: &str, wait: Duration) -> Result<TeamState, String> {
    let _turn = login_turn(dir)?;
    let st = relay::load_state(dir);
    if st.account.is_some() {
        return Err("이미 로그인돼 있어 — 다른 계정은 로그아웃 뒤에".into());
    }
    let device_name = device_name_ok(device_name).ok_or("기기 이름은 1~80자")?;
    let (server, k, created, device) = if st.registered() {
        // 팀이 있는 옛 기기 — 그 열쇠·기기로(서버가 기기와 팀 멤버를 계정에 붙인다)
        let here = relay::server_ok(&st.server).ok_or("team.json 의 서버 주소가 https 가 아니야")?;
        if !server.trim().is_empty() && relay::server_ok(server).as_deref() != Some(here.as_str()) {
            return Err(format!("이 기기는 {here} 에 등록돼 있어 — 다른 서버는 팀을 잊은 뒤에"));
        }
        (here, relay::device_keys(kc, &st)?, None, Some(st.device_id.clone()))
    } else {
        let server = relay::server_ok(relay::server_or_default(server)).ok_or("서버 주소는 https://… 로")?;
        let (k, account) = keys::create(kc)?;
        (server, k, Some(account), None)
    };
    let done = run(http, opener, &server, &k, device.as_deref(), &device_name, wait);
    let v = match done {
        Ok(v) => v,
        Err(e) => {
            if let Some(a) = &created {
                let _ = keys::remove(kc, a);
            }
            return Err(e);
        }
    };
    let s = |k: &str| v[k].as_str().unwrap_or("").to_string();
    // 서버엔 묶였다 — 여기서 실패해도 열쇠는 남긴다
    relay::mutate(dir, |st| {
        if let Some(a) = &created {
            st.server = server.clone();
            st.key_account = a.clone();
            st.device_id = s("deviceId");
        }
        st.device_name = device_name.clone();
        st.account = Some(Account { id: s("accountId"), email: s("email"), name: s("name") });
    })
    .map_err(|e| format!("{e} — 서버엔 로그인됨(기기 {})", s("deviceId")))?;
    let _ = refresh_me(dir, kc, http);
    Ok(relay::load_state(dir))
}

/// begin → 브라우저 → 루프백 결과 → finish. 돌려주는 값 = finish 응답
fn run(http: &dyn Http, opener: &dyn Opener, server: &str, k: &DeviceKeys, device: Option<&str>, device_name: &str, wait: Duration) -> Result<Value, String> {
    let l = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("로그인 받을 자리를 못 열었어: {e}"))?;
    let port = l.local_addr().map_err(|e| e.to_string())?.port();
    let return_to = format!("http://127.0.0.1:{port}{RETURN_PATH}");
    let (code, v) = relay::call(http, server, k, device, "POST", "/v0/auth/google/begin", Some(&json!({ "returnTo": return_to })))?;
    if code != 201 {
        return Err(relay::why(code, &v));
    }
    let login = v["loginId"].as_str().unwrap_or("");
    let url = v["url"].as_str().unwrap_or("");
    // 서버가 준 주소는 우리 서버의 로그인 시작 주소와 정확히 같을 때만 연다 — 엉뚱한 곳으로 사람 브라우저를 보내지 않게
    if !uuid_ok(login) || url != format!("{server}/auth/google/start?login={login}") {
        return Err("중계 서버가 이상한 로그인 주소를 줬어 — 열지 않았어".into());
    }
    opener.open(url)?;
    let code = wait_result(&l, login, wait)?;
    drop(l);
    let (st, v) = relay::call(http, server, k, device, "POST", "/v0/auth/google/finish", Some(&json!({ "loginId": login, "code": code, "deviceName": device_name })))?;
    match st {
        200 | 201 => Ok(v),
        409 => Err("이 기기는 다른 계정에 묶여 있어 — 로그아웃 뒤 다시".into()),
        _ => Err(relay::why(st, &v)),
    }
}

/// 서버에 있는 내 계정·내 기기·내 팀을 받아 적는다 — 팀이 없는 기기는 서버의 첫 팀을 이어받는다
pub fn refresh_me(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<TeamState, String> {
    let st = relay::load_state(dir);
    if !st.registered() {
        return Err("아직 로그인 전이야".into());
    }
    let k = relay::device_keys(kc, &st)?;
    let (code, me) = relay::call(http, &st.server, &k, Some(&st.device_id), "GET", "/v0/me", None)?;
    if code != 200 {
        return Err(relay::why(code, &me));
    }
    let (code, devs) = relay::call(http, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/devices", None)?;
    let devices: Vec<DeviceName> = if code == 200 { serde_json::from_value(devs["devices"].clone()).unwrap_or_default() } else { st.my_devices.clone() };
    let created = devs["devices"].as_array().and_then(|a| a.iter().find(|d| d["current"] == true)).and_then(|d| d["createdAt"].as_u64());
    relay::mutate_if(dir, &st.device_id, |s| {
        if let Some(a) = me["account"].as_object() {
            let g = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            s.account = Some(Account { id: g("id"), email: g("email"), name: g("name") });
        }
        if let Some(n) = me["device"]["name"].as_str() {
            s.device_name = n.to_string();
        }
        if !s.joined() {
            if let Some(t) = me["teams"].as_array().and_then(|a| a.first()) {
                let g = |k: &str| t[k].as_str().unwrap_or("").to_string();
                s.team_id = g("teamId");
                s.team_name = g("name");
                s.member_id = g("memberId");
                s.role = g("role");
            }
        }
        s.my_devices = devices;
        if let Some(t) = created {
            s.device_created_at = t;
        }
    })
}

/// 기기 id 는 서버 경로에 들어간다 — UUID 모양만
fn device_id_ok(id: &str) -> Result<(), String> {
    if uuid_ok(id) { Ok(()) } else { Err("기기 id 가 이상해".into()) }
}

/// 내 계정 기기에 서명 요청(계정이 있어야)
fn me_call(dir: &Path, kc: &dyn Store, http: &dyn Http, path: &str, body: Value) -> Result<(TeamState, u16, Value), String> {
    let st = relay::load_state(dir);
    if st.account.is_none() || !st.registered() {
        return Err("로그인 전이야 — scripts/team login".into());
    }
    let k = relay::device_keys(kc, &st)?;
    let (code, v) = relay::call(http, &st.server, &k, Some(&st.device_id), "POST", path, Some(&body))?;
    Ok((st, code, v))
}

/// 내 기기 이름 바꾸기(같은 계정 기기만)
pub fn rename_device(dir: &Path, kc: &dyn Store, http: &dyn Http, id: &str, name: &str) -> Result<TeamState, String> {
    device_id_ok(id)?;
    let name = device_name_ok(name).ok_or("기기 이름은 1~80자")?;
    let (st, code, v) = me_call(dir, kc, http, &format!("/v0/me/devices/{id}/name"), json!({ "name": name }))?;
    if code != 200 {
        return Err(relay::why(code, &v));
    }
    relay::mutate_if(dir, &st.device_id, |s| {
        for d in s.my_devices.iter_mut().filter(|d| d.id == id) {
            d.name = name.clone();
        }
        if s.device_id == id {
            s.device_name = name.clone();
        }
    })
}

/// 내 다른 기기 끊기(잃은 기기). 이 기기 자신은 logout 으로
pub fn revoke_device(dir: &Path, kc: &dyn Store, http: &dyn Http, id: &str) -> Result<TeamState, String> {
    device_id_ok(id)?;
    if relay::load_state(dir).device_id == id {
        return Err("이 기기는 로그아웃으로 끊어".into());
    }
    let (st, code, v) = me_call(dir, kc, http, &format!("/v0/me/devices/{id}/revoke"), json!({}))?;
    if code != 200 {
        return Err(relay::why(code, &v));
    }
    relay::mutate_if(dir, &st.device_id, |s| s.my_devices.retain(|d| d.id != id))
}

/// 로그아웃 = 이 기기 끊기(서버) + 열쇠·상태 지우기. 다시 로그인하면 새 열쇠로 새 기기.
/// 서버가 이미 끊긴 기기(401·404)라고 하면 그대로 지우고, 망이 안 닿으면 남긴다(서버엔 살아 있으니 다시 할 수 있게)
pub fn logout(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<(), String> {
    let id = relay::load_state(dir).device_id;
    device_id_ok(&id)?;
    let (st, code, v) = me_call(dir, kc, http, &format!("/v0/me/devices/{id}/revoke"), json!({}))?;
    match code {
        200 | 404 => {}
        // 401 은 시계가 5분 넘게 틀려도 온다 — 서버가 끊었다고 알린 기기(4001)만 '이미 끊김'으로 본다(리뷰 10-23)
        401 if st.revoked => {}
        401 => return Err("중계 서버가 이 기기 서명을 거절했어(시계가 틀렸거나 이미 끊김) — 다른 기기에서 끊긴 게 맞으면 scripts/team forget --yes".into()),
        _ => return Err(relay::why(code, &v)),
    }
    relay::forget_local(dir, kc).map(|_| ())
}

/// 계정 지우기 — 되돌릴 수 없어서 계정 이메일을 그대로 쳐야 한다(이메일이 없는 계정은 계정 이름)
pub fn delete_account(dir: &Path, kc: &dyn Store, http: &dyn Http, confirm: &str) -> Result<(), String> {
    let st = relay::load_state(dir);
    let Some(a) = st.account.as_ref() else { return Err("로그인 전이야".into()) };
    let want = if a.email.is_empty() { &a.name } else { &a.email };
    if want.is_empty() || confirm != want.as_str() {
        return Err("확인 글이 계정 이메일과 달라 — 지우지 않았어".into());
    }
    let (_, code, v) = me_call(dir, kc, http, "/v0/me/delete", json!({}))?;
    if code != 200 {
        return Err(relay::why(code, &v));
    }
    relay::forget_local(dir, kc).map(|_| ())
}

#[cfg(test)]
#[path = "team_account_tests.rs"]
mod tests;
