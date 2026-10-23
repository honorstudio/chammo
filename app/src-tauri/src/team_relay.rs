//! 팀 메신저(중계 서버 chammo-relay) 1단계 — 팀 만들기·초대 코드·초대로 들어오기·멤버·DM 방 열기.
//! - HTTP 는 curl 하위 프로세스(push.rs 와 같은 길 — TLS 크레이트는 상시 소켓에만, ADR 0012). 요청마다 기기 열쇠 서명 머리 4개(서버 ADR 0002)
//! - 서버 주소는 코드에 없다 — 만들기·들어오기 때 받은 값을 `<데이터>/team.json` 에(공개판에 우리 서버가 박히지 않게)
//! - team.json 엔 공개 값(팀·멤버·기기 id, 방, 열쇠 칸 이름)만. 비밀 열쇠는 키체인(team_relay_keys)
use crate::accounts_store::Store;
use crate::team_relay_keys::{self as keys, DeviceKeys};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;

pub const STATE_FILE: &str = "team.json";

/// 기기 이름(받는 쪽 이름표의 기기 칸 — 서버 members[].devices·/v0/me/devices)
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DeviceName {
    pub id: String,
    pub name: String,
    /// /v0/me/devices 의 '이 기기'
    pub current: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Member {
    pub id: String,
    pub display_name: String,
    pub role: String,
    pub devices: Vec<DeviceName>,
}

/// Chammo 계정(구글 로그인, 서버 ADR 0004) — 서버가 준 공개 값만
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Room {
    pub id: String,
    /// "dm"
    pub kind: String,
    /// DM 상대 멤버 id
    pub peer: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TeamState {
    pub server: String,
    /// 키체인 chammo-team 칸 이름(공개 열쇠로 지은 것)
    pub key_account: String,
    pub team_id: String,
    pub team_name: String,
    pub member_id: String,
    pub device_id: String,
    pub display_name: String,
    pub device_name: String,
    /// owner | member
    pub role: String,
    pub members: Vec<Member>,
    pub rooms: Vec<Room>,
    /// 받은 팀 말을 넘길 내 참모(이름·id). 비면 설정의 참모 이름
    pub deliver_to: String,
    /// 구글로 로그인한 기기면 그 계정 — 없으면 초대 코드로만 들어온 옛 기기
    pub account: Option<Account>,
    /// 내 계정 기기들(이름표·설정 화면)
    pub my_devices: Vec<DeviceName>,
    /// 이 기기를 서버에 만든 때(서버 시각 ms, /v0/me/devices) — 그 전에 오간 말은 넘기지 않는다(다시 로그인한 새 기기가 옛 말을 다 받지 않게). 0 = 모름
    pub device_created_at: u64,
    /// 서버가 이 기기를 끊었다고 알렸다(방 소켓 close 4001) — 로그아웃이 401 을 '이미 끊김'으로 볼 수 있는 유일한 근거
    pub revoked: bool,
    /// 폰 입구 주소(ADR 0013) — 비면 기본 입구(DEFAULT_PHONE_WEB)
    pub phone_web: String,
}

impl TeamState {
    pub fn joined(&self) -> bool {
        !self.team_id.is_empty() && !self.device_id.is_empty()
    }
    /// 서버에 등록된 기기(열쇠·기기 id 가 있다) — 팀이 없어도 로그인한 기기는 등록돼 있다
    pub fn registered(&self) -> bool {
        !self.device_id.is_empty() && !self.key_account.is_empty()
    }
    /// 기기 id → 이름(팀 멤버 기기·내 계정 기기)
    pub fn device_label(&self, id: &str) -> Option<String> {
        self.members.iter().flat_map(|m| m.devices.iter()).chain(self.my_devices.iter()).find(|d| d.id == id).map(|d| d.name.clone())
    }
    pub fn member_name(&self, id: &str) -> Option<&str> {
        self.members.iter().find(|m| m.id == id).map(|m| m.display_name.as_str())
    }
}

/// HTTP 한 번 — (응답 코드, 몸통)
pub trait Http {
    fn send(&self, method: &str, url: &str, headers: &[(String, String)], body: &[u8]) -> Result<(u16, String), String>;
}

/// curl 부르기 준비 — (프로그램, 인자, 머리 파일). 서명·nonce 머리는 600 임시 파일(-H @파일)로 — 프로세스 인자(ps)엔 안 보이게(보안 검토 3-D).
/// 프로그램은 맥 /usr/bin/curl(PATH 의 다른 curl 을 안 집게), 윈도우는 시스템 curl
pub(crate) fn curl_call(tmp: &Path, method: &str, url: &str, headers: &[(String, String)], has_body: bool) -> Result<(String, Vec<String>, std::path::PathBuf), String> {
    use std::io::Write;
    let file = tmp.join(format!("chammo-team-h-{}", crate::tools::tmp_tag()));
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let mut f = o.open(&file).map_err(|e| format!("curl 머리 파일을 못 만들었어요: {e}"))?;
    let mut lines: String = headers.iter().map(|(k, v)| format!("{k}: {v}\n")).collect();
    if has_body {
        lines.push_str("Content-Type: application/json\n");
    }
    f.write_all(lines.as_bytes()).map_err(|e| e.to_string())?;
    let mut args: Vec<String> = ["-sS", "--max-time", "15", "--proto", "=https,http", "-X", method, "-w", "\n%{http_code}", "-H"].map(String::from).to_vec();
    args.push(format!("@{}", file.display()));
    if has_body {
        args.extend(["--data-binary".to_string(), "@-".to_string()]);
    }
    args.push(url.to_string());
    let prog = if cfg!(target_os = "macos") { "/usr/bin/curl" } else { "curl" };
    Ok((prog.to_string(), args, file))
}

/// 맥·윈도우 curl. 몸통은 stdin 으로, 머리는 600 임시 파일로(인자·ps 에 안 남게), 응답 끝에 코드 한 줄
pub struct Curl;

impl Http for Curl {
    fn send(&self, method: &str, url: &str, headers: &[(String, String)], body: &[u8]) -> Result<(u16, String), String> {
        use std::io::Write;
        let (prog, args, hfile) = curl_call(&std::env::temp_dir(), method, url, headers, !body.is_empty())?;
        struct Gone(std::path::PathBuf);
        impl Drop for Gone {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
        let _gone = Gone(hfile);
        let mut c = crate::platform::command(prog);
        c.args(&args).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
        let mut child = c.spawn().map_err(|e| format!("curl 을 못 띄웠어요: {e}"))?;
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        stdin.write_all(body).map_err(|e| e.to_string())?;
        drop(stdin);
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        let (body, code) = text.rsplit_once('\n').unwrap_or(("", &text));
        match code.trim().parse::<u16>() {
            Ok(0) | Err(_) => Err(format!("중계 서버에 못 닿았어요: {}", String::from_utf8_lossy(&out.stderr).trim())),
            Ok(c) => Ok((c, body.to_string())),
        }
    }
}

/// 공개판 기본 중계·폰 입구(Cloudflare) — 설정 입력칸·`scripts/team --server`·team.json(server·phoneWeb)으로 바꿀 수 있다
pub const DEFAULT_SERVER: &str = "https://relay.chammo.app";
pub const DEFAULT_PHONE_WEB: &str = "https://phone.chammo.app";

/// 새 기기가 등록할 서버 — 안 적었으면 기본 중계
pub fn server_or_default(raw: &str) -> &str {
    if raw.trim().is_empty() { DEFAULT_SERVER } else { raw }
}

/// 서버 주소 — https 만(로컬 wrangler dev 시험은 디버그 빌드에서 정확히 localhost·127.0.0.1 일 때만 평문). 사용자 정보·경로 없이, 끝 빗금은 뗀다
pub fn server_ok(raw: &str) -> Option<String> {
    server_ok_in(raw, cfg!(debug_assertions))
}

/// plain = 로컬 평문을 받을지(릴리스 빌드는 false)
pub fn server_ok_in(raw: &str, plain: bool) -> Option<String> {
    let s = raw.trim().trim_end_matches('/');
    let (scheme, rest) = s.split_once("://")?;
    // host:port 를 나눠 host 를 통째로 본다 — 앞부분만 보면 127.0.0.1.attacker.net 이 로컬로 통과했다
    let host = match rest.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()) => h,
        Some(_) => return None,
        None => rest,
    };
    let ok_host = !host.is_empty() && host.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-'));
    let local = host == "localhost" || host == "127.0.0.1";
    let ok_scheme = scheme == "https" || (scheme == "http" && local && plain);
    (ok_scheme && ok_host).then(|| s.to_string())
}

static LOCK: Mutex<()> = Mutex::new(());

pub fn load_state(dir: &Path) -> TeamState {
    std::fs::read_to_string(dir.join(STATE_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save_state(dir: &Path, st: &TeamState) -> Result<(), String> {
    let text = serde_json::to_string_pretty(st).map_err(|e| e.to_string())? + "\n";
    crate::accounts::write_atomic(&dir.join(STATE_FILE), &text).map_err(|e| format!("team.json 을 못 썼어요({e:?})"))
}

/// 이 기기(device_id) 상태일 때만 고친다 — 뒤 스레드(방 찾기·이름 받기)가 그사이 로그아웃·잊기로 지워진 team.json 을
/// 반쪽(account 는 있고 열쇠·기기 id 는 없는)으로 되살리지 않게(리뷰 10-23). 아니면 아무것도 안 쓴다
pub fn mutate_if(dir: &Path, device_id: &str, f: impl FnOnce(&mut TeamState)) -> Result<TeamState, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut st = load_state(dir);
    if device_id.is_empty() || st.device_id != device_id {
        return Err("이 기기 상태가 바뀌었어(로그아웃·잊기)".into());
    }
    f(&mut st);
    save_state(dir, &st)?;
    Ok(st)
}

/// 읽고 고치고 쓰기를 한 줄로 — 앱 안 여러 길(스크립트·소켓 스레드)이 같이 고친다
pub fn mutate(dir: &Path, f: impl FnOnce(&mut TeamState)) -> Result<TeamState, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut st = load_state(dir);
    f(&mut st);
    save_state(dir, &st)?;
    Ok(st)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 서명한 요청. device = 등록된 기기 id(없으면 공개 열쇠 머리 — 팀 만들기·들어오기)
pub(crate) fn call(http: &dyn Http, server: &str, k: &DeviceKeys, device: Option<&str>, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
    // 기기 id 는 머리값(curl 머리 파일)에 들어간다 — 줄바꿈 등으로 다른 머리를 끼우지 못하게(리뷰 10-23)
    if device.is_some_and(|d| d.is_empty() || d.len() > 64 || !d.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')) {
        return Err("team.json 의 기기 id 가 이상해".into());
    }
    // team.json 은 손으로 고칠 수 있는 파일 — 나가기 직전마다 다시 거른다(보안 검토 4-B)
    let server = server_ok(server).ok_or("team.json 의 서버 주소가 https 가 아니야")?;
    let raw = body.map(|b| b.to_string()).unwrap_or_default();
    let s = k.sign_request(method, path, raw.as_bytes(), now_ms(), &keys::new_nonce()?);
    let mut h = vec![("X-Chammo-Ts".to_string(), s.ts), ("X-Chammo-Nonce".to_string(), s.nonce), ("X-Chammo-Sig".to_string(), s.sig)];
    h.push(match device {
        Some(d) => ("X-Chammo-Device".into(), d.into()),
        None => ("X-Chammo-Key".into(), k.public()),
    });
    let (code, text) = http.send(method, &format!("{server}{path}"), &h, raw.as_bytes())?;
    Ok((code, serde_json::from_str(&text).unwrap_or(Value::Null)))
}

/// 서버 오류 → 사람이 읽는 이유
pub(crate) fn why(code: u16, v: &Value) -> String {
    match (code, v["error"].as_str().unwrap_or("")) {
        (401, _) => "중계 서버가 서명을 거절했어(이 기기 시계가 5분 넘게 틀렸거나 기기가 끊겼어)".into(),
        (403, _) => "그 팀·방의 권한이 없어(초대는 팀장 기기만)".into(),
        (404, "member_not_found") => "그 사람이 팀에 없어".into(),
        (409, _) => "이 열쇠는 이미 등록돼 있어".into(),
        (410, _) => "초대 코드가 틀렸거나 이미 썼거나 24시간이 지났어 — 팀장에게 새 코드를 받아".into(),
        (413, _) => "너무 커".into(),
        (c, e) => format!("중계 서버 {c} {e}"),
    }
}

fn need(st: &TeamState) -> Result<(), String> {
    if st.joined() { Ok(()) } else { Err("아직 팀이 없어 — scripts/team create 또는 join".into()) }
}

pub fn device_keys(kc: &dyn Store, st: &TeamState) -> Result<DeviceKeys, String> {
    keys::load(kc, &st.key_account)?.ok_or_else(|| "이 기기의 팀 열쇠가 키체인에 없어(다른 맥으로 옮긴 데이터 폴더?) — 팀장에게 새로 초대받아".into())
}

/// 팀 만들기·들어오기. 로그인한 기기(계정)는 지금 열쇠·기기 서명으로(서버가 계정 멤버로 붙인다),
/// 아니면 새 열쇠를 만들어 미등록 길로 등록하고 서버가 거절하면 만든 열쇠를 치운다
fn register(dir: &Path, kc: &dyn Store, http: &dyn Http, server: &str, path: &str, body: Value, role: &str, display: &str, device: &str) -> Result<TeamState, String> {
    if crate::team_account::login_busy(dir) {
        return Err("지금 로그인 중이야 — 끝난 뒤에".into());
    }
    let now = load_state(dir);
    if now.joined() {
        return Err("이 데이터 폴더엔 이미 팀이 있어 — 지금은 팀 하나".into());
    }
    if now.account.is_some() && now.registered() {
        let here = server_ok(&now.server).ok_or("team.json 의 서버 주소가 https 가 아니야")?;
        if !server.trim().is_empty() && server_ok(server).as_deref() != Some(here.as_str()) {
            return Err(format!("이 기기는 {here} 계정에 로그인돼 있어 — 다른 서버는 로그아웃 뒤에"));
        }
        let k = device_keys(kc, &now)?;
        let (code, v) = call(http, &here, &k, Some(&now.device_id), "POST", path, Some(&body))?;
        if code != 201 {
            return Err(why(code, &v));
        }
        let s = |k: &str| v[k].as_str().unwrap_or("").to_string();
        let team_name = v["teamName"].as_str().or(body["name"].as_str()).unwrap_or("").to_string();
        return mutate(dir, |st| {
            st.team_id = s("teamId");
            st.team_name = team_name;
            st.member_id = s("memberId");
            st.display_name = display.into();
            st.role = role.into();
        });
    }
    if now.registered() {
        return Err("이 기기는 이미 등록돼 있어 — 지금은 팀 하나".into());
    }
    let server = server_ok(server_or_default(server)).ok_or("서버 주소는 https://… 로")?;
    let (k, account) = keys::create(kc)?;
    let (code, v) = match call(http, &server, &k, None, "POST", path, Some(&body)) {
        Ok(r) => r,
        Err(e) => {
            let _ = keys::remove(kc, &account);
            return Err(e);
        }
    };
    if code != 201 {
        let _ = keys::remove(kc, &account);
        return Err(why(code, &v));
    }
    let s = |k: &str| v[k].as_str().unwrap_or("").to_string();
    let team_name = v["teamName"].as_str().or(body["name"].as_str()).unwrap_or("").to_string();
    // 서버엔 등록됐다 — 여기서 실패해도 열쇠는 남긴다(id 를 알려 주면 다시 적을 수 있다)
    mutate(dir, |st| {
        *st = TeamState {
            server,
            key_account: account.clone(),
            team_id: s("teamId"),
            team_name,
            member_id: s("memberId"),
            device_id: s("deviceId"),
            display_name: display.into(),
            device_name: device.into(),
            role: role.into(),
            ..Default::default()
        }
    })
    .map_err(|e| format!("{e} — 서버엔 등록됨(팀 {}, 기기 {})", s("teamId"), s("deviceId")))
}

pub fn create(dir: &Path, kc: &dyn Store, http: &dyn Http, server: &str, team: &str, display: &str, device: &str) -> Result<TeamState, String> {
    register(dir, kc, http, server, "/v0/teams", json!({ "name": team, "deviceName": device, "displayName": display }), "owner", display, device)
}

#[derive(Debug, Serialize)]
pub struct Invite {
    pub code: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: u64,
    /// 받는 사람이 그대로 붙여 넣는 것 — 서버 주소까지
    pub link: String,
}

pub fn invite(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<Invite, String> {
    let st = load_state(dir);
    need(&st)?;
    let k = device_keys(kc, &st)?;
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/invites", st.team_id), Some(&json!({})))?;
    if code != 201 {
        return Err(why(code, &v));
    }
    let c = v["code"].as_str().unwrap_or("").to_string();
    // URL 에서 그대로 둬도 되는 글자(-._~)는 남긴다
    const KEEP: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC.remove(b'-').remove(b'.').remove(b'_').remove(b'~');
    let enc = |s: &str| percent_encoding::utf8_percent_encode(s, KEEP).to_string();
    Ok(Invite { link: format!("chammo://join?server={}&code={}", enc(&st.server), enc(&c)), code: c, expires_at: v["expiresAt"].as_u64().unwrap_or(0) })
}

/// 붙여 넣은 초대 — 링크면 (서버, 코드), 코드만이면 (None, 코드)
pub fn parse_invite(raw: &str) -> (Option<String>, String) {
    let s = raw.trim();
    let Some(q) = s.strip_prefix("chammo://join?") else { return (None, s.to_string()) };
    let mut server = None;
    let mut code = String::new();
    for kv in q.split('&') {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        let v = percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned();
        match k {
            "server" => server = Some(v),
            "code" => code = v,
            _ => {}
        }
    }
    (server, code)
}

/// 초대로 들어오기 — server 가 비면 링크에 든 서버
pub fn join(dir: &Path, kc: &dyn Store, http: &dyn Http, server: &str, invite: &str, display: &str, device: &str) -> Result<TeamState, String> {
    let (from_link, code) = parse_invite(invite);
    let server = if server.trim().is_empty() { from_link.unwrap_or_default() } else { server.to_string() };
    if code.is_empty() {
        return Err("초대 코드가 비었어".into());
    }
    register(dir, kc, http, &server, "/v0/invites/redeem", json!({ "code": code, "deviceName": device, "displayName": display }), "member", display, device)
}

pub fn refresh_members(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<TeamState, String> {
    let st = load_state(dir);
    need(&st)?;
    let k = device_keys(kc, &st)?;
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "GET", &format!("/v0/teams/{}/members", st.team_id), None)?;
    if code != 200 {
        return Err(why(code, &v));
    }
    let members: Vec<Member> = serde_json::from_value(v["members"].clone()).unwrap_or_default();
    mutate_if(dir, &st.device_id, |s| s.members = members)
}

/// 사람 찾기 — id, 이름(대소문자 무시), 하나뿐인 앞부분
pub fn find_member<'a>(st: &'a TeamState, q: &str) -> Result<&'a Member, String> {
    let q = q.trim();
    let low = q.to_lowercase();
    if let Some(m) = st.members.iter().find(|m| m.id == q || m.display_name.to_lowercase() == low) {
        return Ok(m);
    }
    let hits: Vec<_> = st.members.iter().filter(|m| !low.is_empty() && m.display_name.to_lowercase().starts_with(&low)).collect();
    match hits.as_slice() {
        [m] => Ok(m),
        [] => Err(format!("팀에 그런 사람이 없어: {q} — {}", st.members.iter().map(|m| m.display_name.as_str()).collect::<Vec<_>>().join(", "))),
        many => Err(format!("누구?: {}", many.iter().map(|m| m.display_name.as_str()).collect::<Vec<_>>().join(", "))),
    }
}

/// 그 사람과의 DM 방 — 기억한 방이 있으면 그것, 없으면 서버에 연다(서버도 두 사람 사이에 하나만 만든다)
pub fn open_dm(dir: &Path, kc: &dyn Store, http: &dyn Http, who: &str) -> Result<Room, String> {
    let mut st = load_state(dir);
    need(&st)?;
    if find_member(&st, who).is_err() {
        st = refresh_members(dir, kc, http)?;
    }
    let m = find_member(&st, who)?.clone();
    if m.id == st.member_id {
        return Err("나 자신과는 DM 이 없어".into());
    }
    if let Some(r) = st.rooms.iter().find(|r| r.kind == "dm" && r.peer == m.id) {
        return Ok(r.clone());
    }
    let k = device_keys(kc, &st)?;
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/dms", st.team_id), Some(&json!({ "memberId": m.id })))?;
    if code != 200 && code != 201 {
        return Err(why(code, &v));
    }
    let room = Room { id: v["roomId"].as_str().unwrap_or("").to_string(), kind: "dm".into(), peer: m.id };
    if room.id.is_empty() {
        return Err("중계 서버가 방 id 를 안 줬어".into());
    }
    let r = room.clone();
    mutate_if(dir, &st.device_id, move |s| {
        if !s.rooms.iter().any(|x| x.id == r.id) {
            s.rooms.push(r);
        }
    })?;
    Ok(room)
}

/// 내가 든 방 전부(GET /v0/me/rooms, 서버 ADR 0004) — 5분마다 멤버 전원과 DM 을 열어 찾던 것 대신.
/// 계정 기기인데 내 기기끼리 방이 아직 없으면 만든다(POST /v0/me/room, 계정마다 하나)
pub fn sync_rooms(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<TeamState, String> {
    let st = load_state(dir);
    if !st.registered() {
        return Err("아직 팀·로그인 전이야".into());
    }
    let k = device_keys(kc, &st)?;
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/rooms", None)?;
    if code != 200 {
        return Err(why(code, &v));
    }
    let mut rooms: Vec<Room> = v["rooms"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    let id = r["roomId"].as_str().filter(|s| !s.is_empty())?.to_string();
                    let kind = r["kind"].as_str()?;
                    let peer = r["memberIds"].as_array().and_then(|m| m.iter().filter_map(Value::as_str).find(|m| *m != st.member_id)).unwrap_or("").to_string();
                    match kind {
                        "self" => Some(Room { id, kind: "self".into(), peer: String::new() }),
                        "dm" => Some(Room { id, kind: "dm".into(), peer }),
                        _ => None,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    if st.account.is_some() && !rooms.iter().any(|r| r.kind == "self") {
        let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "POST", "/v0/me/room", Some(&json!({})))?;
        match v["roomId"].as_str().filter(|_| code == 200 || code == 201) {
            Some(id) => rooms.push(Room { id: id.into(), kind: "self".into(), peer: String::new() }),
            None => return Err(why(code, &v)),
        }
    }
    mutate_if(dir, &st.device_id, |s| s.rooms = rooms)
}

/// 내 기기끼리 방 id(없으면 만든다)
pub fn self_room(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<String, String> {
    let st = load_state(dir);
    if st.account.is_none() {
        return Err("내 기기끼리 말은 로그인한 기기만 — scripts/team login".into());
    }
    if let Some(r) = st.rooms.iter().find(|r| r.kind == "self") {
        return Ok(r.id.clone());
    }
    sync_rooms(dir, kc, http)?.rooms.into_iter().find(|r| r.kind == "self").map(|r| r.id).ok_or_else(|| "내 기기끼리 방을 못 열었어".into())
}

/// 이 기기에서 팀·계정을 잊는다 — 연결 끄고 열쇠(키체인 칸)·team.json·받은 기록·seq 지우기. 잊은 팀 id
pub fn forget_local(dir: &Path, kc: &dyn Store) -> Result<String, String> {
    crate::team_relay_ws::stop();
    let st = load_state(dir);
    if !st.key_account.is_empty() {
        let _ = keys::remove(kc, &st.key_account);
    }
    for f in [crate::team_relay_inbox::INBOX_FILE, crate::team_relay_inbox::SEEN_FILE] {
        let _ = std::fs::remove_file(dir.join(f));
    }
    match std::fs::remove_file(dir.join(STATE_FILE)) {
        Ok(()) => Ok(st.team_id),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(st.team_id),
        Err(e) => Err(e.to_string()),
    }
}

/// 폰 허브 WebSocket 주소(주인 = 이 기기) — 서명은 쿼리로(서버 connectHub, ADR 0005)
pub fn hub_url(st: &TeamState, k: &DeviceKeys, ts_ms: u64, nonce: &str) -> Result<String, String> {
    let path = format!("/v0/hubs/{}/ws", st.device_id);
    let s = k.sign_request("GET", &path, b"", ts_ms, nonce);
    let base = server_ok(&st.server).ok_or("team.json 의 서버 주소가 https 가 아니야")?;
    let base = base.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    Ok(format!("{base}{path}?device={}&ts={}&nonce={}&sig={}", st.device_id, s.ts, s.nonce, s.sig))
}

/// 폰 입구 주소 — 오리진만(https, 디버그 빌드는 로컬 평문도). CHAMMO_PHONE_WEB → team.json → 기본 입구
pub fn phone_web(st: &TeamState) -> Option<String> {
    let env = std::env::var("CHAMMO_PHONE_WEB").ok().filter(|s| !s.trim().is_empty());
    phone_web_from(env, st)
}

fn phone_web_from(env: Option<String>, st: &TeamState) -> Option<String> {
    let saved = Some(st.phone_web.clone()).filter(|s| !s.trim().is_empty());
    server_ok(&env.or(saved).unwrap_or_else(|| DEFAULT_PHONE_WEB.into()))
}

/// 방 WebSocket 주소 — 서명은 쿼리로(서버 connectRoom)
pub fn ws_url(st: &TeamState, k: &DeviceKeys, room: &str, ts_ms: u64, nonce: &str) -> Result<String, String> {
    let path = format!("/v0/rooms/{room}/ws");
    let s = k.sign_request("GET", &path, b"", ts_ms, nonce);
    let base = server_ok(&st.server).ok_or("team.json 의 서버 주소가 https 가 아니야")?;
    let base = base.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    Ok(format!("{base}{path}?device={}&ts={}&nonce={}&sig={}", st.device_id, s.ts, s.nonce, s.sig))
}

#[cfg(test)]
#[path = "team_relay_tests.rs"]
mod tests;
