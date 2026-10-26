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

/// 이 기기 이름 기본값 — 컴퓨터 이름(맥 'MacBook-Pro.local' → 'MacBook-Pro'), 시험 데이터 폴더면 뒤에 '(.chammo-team3)'
pub fn default_device_name() -> String {
    name_for_data(&host_name(), &crate::config::home(), crate::config::data_dir())
}

/// 같은 컴퓨터의 본판·시험판이 기기 관리에서 같은 이름으로 뜨지 않게 — 진짜 데이터 폴더가 아니면 폴더 이름을 붙인다(10-26 시험판이 남의 계정에 붙어 있었다)
pub(crate) fn name_for_data(host: &str, home: &str, dir: &Path) -> String {
    if crate::config::is_real_data(home, dir) {
        return host.to_string();
    }
    let folder = dir.to_string_lossy().replace('\\', "/").trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string();
    let tail = format!(" ({folder})");
    let room = 80usize.saturating_sub(tail.chars().count()).max(1);
    format!("{}{tail}", host.chars().take(room).collect::<String>())
}

fn host_name() -> String {
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
        return Err("이 기기에서 로그인을 진행하고 있어요 — 열린 브라우저에서 마치거나, 10분 뒤 다시 해 주세요".into());
    }
    g.push(dir.to_path_buf());
    Ok(LoginTurn(dir.to_path_buf()))
}

pub(crate) fn login_busy(dir: &Path) -> bool {
    BUSY.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|d| d == dir)
}

/// 로그인할 중계 — 사람이 적은 것 → 이 기기 team.json → 로그아웃 전에 쓰던 것(relay::LAST_SERVER_FILE) → 기본(QA 4: '처음부터'·첫 로그인이 기본 중계로 갔다)
pub(crate) fn login_server(dir: &Path, arg: &str) -> String {
    if !arg.trim().is_empty() {
        return arg.trim().to_string();
    }
    let st = relay::load_state(dir);
    if !st.server.trim().is_empty() {
        return st.server;
    }
    let last = std::fs::read_to_string(dir.join(relay::LAST_SERVER_FILE)).unwrap_or_default();
    relay::server_or_default(last.trim()).to_string()
}

/// 구글 로그인 — 브라우저를 열고 끝날 때까지 기다린다(최대 wait). 성공하면 계정·내 기기·서버에 있던 내 팀까지 채운 상태
pub fn login_with(dir: &Path, kc: &dyn Store, http: &dyn Http, opener: &dyn Opener, server: &str, device_name: &str, wait: Duration) -> Result<TeamState, String> {
    let _turn = login_turn(dir)?;
    let st = relay::load_state(dir);
    if st.account.is_some() {
        // 밖(scripts/team login)에서 먼저 로그인한 때도 — 화면은 이 문구를 보면 상태를 다시 읽어 닫는다(QA 7)
        return Err("이미 이 기기는 로그인돼 있어요 — 화면을 새로 볼게요. 다른 계정으로 바꾸려면 설정에서 로그아웃한 뒤에 해 주세요".into());
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
        let server = relay::server_ok(&login_server(dir, server)).ok_or("서버 주소는 https://… 로")?;
        let (k, account) = keys::create(kc)?;
        (server, k, Some(account), None)
    };
    // 종단 암호 받는 열쇠·묶기 서명·봉인(chammo-relay ADR 0007) — nP 는 이 기기 e2e.json 에만
    let e2e = crate::e2e_flow::login_fields(dir, &k)?;
    let done = run(http, opener, &server, &k, device.as_deref(), &device_name, &e2e, wait);
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
        st.pending = v["status"] == "pending";
    })
    .map_err(|e| format!("{e} — 서버엔 로그인됨(기기 {})", s("deviceId")))?;
    let _ = refresh_me(dir, kc, http);
    Ok(relay::load_state(dir))
}

/// 내 대기 상태(/v0/me/self)를 받아 적는다 — 허용됐으면 true
fn self_approved(dir: &Path, http: &dyn Http, st: &TeamState, k: &DeviceKeys) -> Result<bool, String> {
    let (code, me) = relay::call(http, &st.server, k, Some(&st.device_id), "GET", "/v0/me/self", None)?;
    if code != 200 {
        return Err(relay::why(code, &me));
    }
    let auto = me["autoAt"].as_u64().unwrap_or(0);
    let approved = me["status"] == "approved";
    relay::mutate_if(dir, &st.device_id, |s| {
        s.pending = !approved;
        s.pending_auto_at = if approved { 0 } else { auto };
    })?;
    Ok(approved)
}

/// begin → 브라우저 → 루프백 결과 → finish. 돌려주는 값 = finish 응답
fn run(http: &dyn Http, opener: &dyn Opener, server: &str, k: &DeviceKeys, device: Option<&str>, device_name: &str, e2e: &Value, wait: Duration) -> Result<Value, String> {
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
    let (st, v) = relay::call(http, server, k, device, "POST", "/v0/auth/google/finish", Some(&{
        let mut b = json!({ "loginId": login, "code": code, "deviceName": device_name, "kind": this_kind() });
        b.as_object_mut().expect("객체").extend(e2e.as_object().cloned().unwrap_or_default());
        b
    }))?;
    match st {
        200 | 201 => Ok(v),
        409 => Err("이 기기는 다른 계정에 묶여 있어 — 로그아웃 뒤 다시".into()),
        403 if v["error"] == "key_rejected" => Err("이 기기는 다른 기기에서 거절됐어 — 24시간 뒤 다시 로그인할 수 있어".into()),
        429 => Err("계정에 허용을 기다리는 기기가 5개를 넘었어 — 다른 기기에서 먼저 허용하거나 거절해 줘".into()),
        _ => Err(relay::why(st, &v)),
    }
}

/// 서버에 있는 내 계정·내 기기·내 팀(전부)을 받아 적는다
pub fn refresh_me(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<TeamState, String> {
    let st = relay::load_state(dir);
    if !st.registered() {
        return Err("아직 로그인 전이야".into());
    }
    let k = relay::device_keys(kc, &st)?;
    // 허용을 기다리는 기기는 /v0/me/self 만 된다 — 허용됐으면 아래로 이어서 다 받는다
    if st.pending && !self_approved(dir, http, &st, &k)? {
        return Ok(relay::load_state(dir));
    }
    let (code, me) = relay::call(http, &st.server, &k, Some(&st.device_id), "GET", "/v0/me", None)?;
    // 서버만 대기인 기기 — 옛 판(0.4.1)이 로그인해 team.json 에 대기가 안 적혔다(10-26 아이맥). 서버 말로 대기를 적는다
    // 사슬에 든 기기는 서버 말만으로 대기로 안 바꾼다 — 대기 화면 '로그인 취소'로 스스로 사슬에서 빠지게 꾀지 못하게(10-26 공격 리뷰)
    if code == 403 && me["error"] == "device_pending" && !st.pending && !crate::e2e_team::in_chain(dir, &st) && !self_approved(dir, http, &st, &k)? {
        return Ok(relay::load_state(dir));
    }
    if code != 200 {
        return Err(relay::why(code, &me));
    }
    let (code, devs) = relay::call(http, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/devices", None)?;
    let devices: Vec<DeviceName> = if code == 200 { relay::device_rows(&devs["devices"]) } else { st.my_devices.clone() };
    let created = devs["devices"].as_array().and_then(|a| a.iter().find(|d| d["current"] == true)).and_then(|d| d["createdAt"].as_u64());
    relay::mutate_if(dir, &st.device_id, |s| {
        if let Some(a) = me["account"].as_object() {
            let g = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            s.account = Some(Account { id: g("id"), email: g("email"), name: g("name") });
        }
        if let Some(n) = me["device"]["name"].as_str() {
            s.device_name = n.to_string();
        }
        // 서버가 아는 내 팀 전부 — 멤버 목록·표시 이름은 이미 받은 것을 남기고, 서버에 없는 팀(나감·빠짐·지워짐)과 그 방은 지운다
        if let Some(list) = me["teams"].as_array() {
            let ids: Vec<String> = list.iter().filter_map(|t| t["teamId"].as_str().map(String::from)).collect();
            for gone in s.teams.iter().map(|t| t.id.clone()).filter(|id| !ids.contains(id)).collect::<Vec<_>>() {
                s.drop_team(&gone);
            }
            for t in list {
                let g = |k: &str| t[k].as_str().unwrap_or("").to_string();
                let old = s.teams.iter().find(|x| x.id == g("teamId")).cloned().unwrap_or_default();
                s.put_team(relay::TeamEntry { id: g("teamId"), name: g("name"), member_id: g("memberId"), role: g("role"), ..old });
            }
            let cur = s.team_id.clone();
            s.select_current(&cur);
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

/// 이 컴퓨터 종류 — 서버 기기 칸(kind)
fn this_kind() -> &'static str {
    if cfg!(windows) { "win" } else { "mac" }
}

/// 허용 대기 기기 허용·거절(ADR 0014) — 사람 손 길(결정 대기함의 기기 카드 답)에서만 부른다.
/// 이미 처리(409, 다른 기기에서 먼저 누름)는 실패가 아니다. 이 기기 자신·허용을 기다리는 기기에선 안 보낸다
pub fn decide_device(dir: &Path, kc: &dyn Store, http: &dyn Http, id: &str, yes: bool) -> Result<TeamState, String> {
    device_id_ok(id)?;
    let st = relay::load_state(dir);
    if st.device_id == id {
        return Err("이 기기는 스스로 허용하지 않아".into());
    }
    if st.pending {
        return Err("이 기기도 아직 허용을 기다려 — 허용된 기기에서 눌러".into());
    }
    let (_, code, v) = me_call(dir, kc, http, &format!("/v0/me/devices/{id}/{}", if yes { "approve" } else { "reject" }), json!({}))?;
    match code {
        200 => {}
        // 이미 처리됨 — 바란 쪽과 같으면 성공, 다르면 실제 결과를 말한다(서버 409 몸통 status·approvedBy)
        409 => {
            let _ = refresh_me(dir, kc, http);
            return match (yes, v["status"].as_str().unwrap_or(""), v["approvedBy"].as_str().unwrap_or("")) {
                (true, "approved", _) | (false, "rejected", _) => Ok(relay::load_state(dir)),
                (false, "approved", "auto") => Err("24시간이 지나 자동으로 허용됐어요 — 끊으려면 기기 관리에서 그 기기를 빼기".into()),
                (false, "approved", _) => Err("다른 기기에서 이미 허용했어요 — 끊으려면 기기 관리에서 그 기기를 빼기".into()),
                (true, "rejected", _) => Err("다른 기기에서 이미 거절했어요".into()),
                _ => Err(relay::why(code, &v)),
            };
        }
        _ => return Err(relay::why(code, &v)),
    }
    refresh_me(dir, kc, http)
}

/// 참모 길(scripts/team devices remove --yes)의 기기 빼기 — 사슬에 든 기기는 사람 카드 몫이라 거절(리뷰 B 중간 7), 사슬 밖 기기만
pub fn revoke_device_agent(dir: &Path, kc: &dyn Store, http: &dyn Http, id: &str) -> Result<TeamState, String> {
    device_id_ok(id)?;
    // R6 — 사슬에 든 기기인지는 서버 목록(inChain)이 아니라 내가 검증한 사슬로(새로 받아). 확인 못 하면 사람 몫
    let st = relay::load_state(dir);
    if let Some(acc) = st.account.as_ref().map(|a| a.id.clone()) {
        use crate::e2e_state::Trust;
        let pinned = crate::e2e_state::load(dir).pins.contains_key(&acc);
        match crate::e2e_state::chain_of(dir, kc, http, &st, &acc, true)? {
            Trust::Ok(c) if c.devices.contains_key(id) => return Err("그 기기는 종단 암호 사슬에 들어 있어 — 사람이 설정 > 기기 관리에서 빼야 해".into()),
            Trust::Ok(_) => {}
            Trust::NoChain if !pinned => {}
            _ => return Err("내 기기 사슬을 확인하지 못했어 — 사람이 설정 > 기기 관리에서 빼야 해".into()),
        }
    }
    // 참모 길은 사슬 고리를 안 쓴다 — 서버 끊기만
    revoke_inner(dir, kc, http, id, false)
}

/// 내 다른 기기 끊기(잃은 기기). 이 기기 자신은 logout 으로
pub fn revoke_device(dir: &Path, kc: &dyn Store, http: &dyn Http, id: &str) -> Result<TeamState, String> {
    revoke_inner(dir, kc, http, id, true)
}

/// with_link = 사람 손 길(사슬 remove 고리 먼저, R5). 참모 길은 false(R6)
fn revoke_inner(dir: &Path, kc: &dyn Store, http: &dyn Http, id: &str, with_link: bool) -> Result<TeamState, String> {
    device_id_ok(id)?;
    let st = relay::load_state(dir);
    if st.device_id == id {
        return Err("이 기기는 로그아웃으로 끊어".into());
    }
    // 허용 대기 기기를 빼는 건 거절이다 — 사람 손 길(카드)만(ADR 0014)
    if st.my_devices.iter().any(|d| d.id == id && d.pending()) {
        return Err("허용 대기 기기는 카드에서 허용·거절해 줘".into());
    }
    // 사슬에서도 뺀다(남들이 봉투에서 빼게, chammo-relay ADR 0007) — 실패하면 끊기도 멈춘다(끊긴 기기가 사슬에 남지 않게, 리뷰 B 중간 7)
    if with_link {
        crate::e2e_flow::remove_link(dir, kc, http, id).map_err(|e| format!("사슬에서 빼지 못해 끊기를 멈췄어: {e}"))?;
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
    logout_with(dir, kc, http, true)
}

/// with_link = 사람 손 길(사슬 remove 고리 먼저, R5). 참모 길(scripts/team logout)은 false — 서버 끊기만(R6)
pub fn logout_with(dir: &Path, kc: &dyn Store, http: &dyn Http, with_link: bool) -> Result<(), String> {
    let st = relay::load_state(dir);
    if !st.registered() {
        return Err("로그인 전이야 — 로그아웃할 게 없어".into());
    }
    let id = st.device_id;
    device_id_ok(&id)?;
    if with_link {
        if let Err(e) = crate::e2e_flow::remove_link(dir, kc, http, &id) {
            eprintln!("[기기] 사슬 빼기 고리 실패: {e}");
        }
    }
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
