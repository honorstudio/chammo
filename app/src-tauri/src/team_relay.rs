//! 팀 메신저(중계 서버 chammo-relay) 1단계 — 팀 만들기·초대 코드·초대로 들어오기·멤버·DM 방 열기.
//! - HTTP 는 curl 하위 프로세스(push.rs 와 같은 길 — TLS 크레이트는 상시 소켓에만, ADR 0012). 요청마다 기기 열쇠 서명 머리 4개(서버 ADR 0002)
//! - 서버 주소는 코드에 없다 — 만들기·들어오기 때 받은 값을 `<데이터>/team.json` 에(공개판에 우리 서버가 박히지 않게)
//! - team.json 엔 공개 값(팀·멤버·기기 id, 방, 열쇠 칸 이름)만. 비밀 열쇠는 키체인(team_relay_keys)
use crate::accounts_store::Store;
use crate::team_relay_keys::{self as keys, DeviceKeys};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;
use reqwest::redirect as hops;

pub const STATE_FILE: &str = "team.json";

/// 서버가 null 로 준 글자 칸은 빈 글로 — 칸 하나의 null 이 목록 전체 읽기를 깨지 않게(10-24 로컬 중계 실측)
fn null_str<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(d)?.unwrap_or_default())
}

fn null_u64<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    Ok(Option::<u64>::deserialize(d)?.unwrap_or_default())
}

/// 서버 기기 줄들 — 줄마다 따로 읽어 틀린 줄(id null·모양 틀림)만 버린다(한 줄이 목록 전체를 비우지 않게, 재리뷰 4)
pub fn device_rows(v: &Value) -> Vec<DeviceName> {
    v.as_array().map(|a| a.iter().filter_map(|r| serde_json::from_value::<DeviceName>(r.clone()).ok()).filter_map(DeviceName::tidy).collect()).unwrap_or_default()
}

/// 기기 이름(받는 쪽 이름표의 기기 칸 — 서버 members[].devices·/v0/me/devices)
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DeviceName {
    #[serde(deserialize_with = "null_str")]
    pub id: String,
    #[serde(deserialize_with = "null_str")]
    pub name: String,
    /// /v0/me/devices 의 '이 기기'
    pub current: bool,
    /// mac | win | phone — 모르는 값은 비움(ADR 0014)
    #[serde(deserialize_with = "null_str")]
    pub kind: String,
    /// approved | pending
    #[serde(deserialize_with = "null_str")]
    pub status: String,
    /// 마지막으로 서버에 닿은 때(ms)
    pub last_seen: Option<u64>,
    #[serde(deserialize_with = "null_u64")]
    pub created_at: u64,
    /// 대기 기기가 로그인한 곳(서버가 본 나라·도시 — IP 는 안 받는다)
    #[serde(deserialize_with = "null_str")]
    pub req_country: String,
    #[serde(deserialize_with = "null_str")]
    pub req_city: String,
    pub pending_since: Option<u64>,
    /// human | auto(24시간 지나 서버가 허용) | '' — 자동 허용 기기는 목록에 따로 보인다
    #[serde(deserialize_with = "null_str")]
    pub approved_by: String,
    /// 종단 암호(chammo-relay ADR 0007) — 서명 열쇠·받는 열쇠·묶기 서명·사슬에 들었나·확인 숫자 봉인/난수/연 값(서버가 준 값 — 숫자로 확인한다)
    #[serde(deserialize_with = "null_str")]
    pub public_key: String,
    #[serde(deserialize_with = "null_str")]
    pub e2e_pub: String,
    #[serde(deserialize_with = "null_str")]
    pub e2e_sig: String,
    pub in_chain: bool,
    #[serde(deserialize_with = "null_str")]
    pub approve_commit: String,
    #[serde(deserialize_with = "null_str")]
    pub approve_nonce: String,
    #[serde(deserialize_with = "null_str")]
    pub approve_reveal: String,
}

impl DeviceName {
    /// 서버가 준 줄을 아는 값으로만 — 기기 id 모양이 틀리면 버림(경로·참모 출력에 들어간다), 종류는 셋 중 하나 아니면 비움,
    /// 상태는 pending 아니면 approved(막는 건 서버 몫), 말이 안 되는 시각(3000년 넘음)은 버림(리뷰 5·6)
    pub fn tidy(mut self) -> Option<Self> {
        if self.id.is_empty() || self.id.len() > 64 || !self.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
            return None;
        }
        const Y3000_MS: u64 = 32_503_680_000_000;
        self.last_seen = self.last_seen.filter(|t| *t <= Y3000_MS);
        self.pending_since = self.pending_since.filter(|t| *t <= Y3000_MS);
        self.created_at = self.created_at.min(Y3000_MS);
        if !matches!(self.kind.as_str(), "mac" | "win" | "phone") {
            self.kind.clear();
        }
        if self.status != "pending" {
            self.status = "approved".into();
        }
        if !matches!(self.approved_by.as_str(), "human" | "auto") {
            self.approved_by.clear();
        }
        let short = |s: &str| s.chars().filter(|c| !c.is_control()).take(40).collect::<String>();
        self.req_country = short(&self.req_country);
        self.req_city = short(&self.req_city);
        Some(self)
    }
    pub fn pending(&self) -> bool {
        self.status == "pending"
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Member {
    pub id: String,
    pub display_name: String,
    /// owner | manager | member — 서버 값이라 화면 표시용. 권한 판정은 명부(team_owners)
    pub role: String,
    /// 매니저 권한(서버 값, 표시용)
    pub perms: Vec<String>,
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
    /// "dm" | "group"(단톡방) | "self"
    pub kind: String,
    /// DM 상대 멤버 id(단톡방은 빈 글)
    pub peer: String,
    /// 이 방의 팀 id(내 기기끼리 방은 빈 글) — 팀마다 내 멤버 id 가 다르다
    pub team: String,
    /// 단톡방 이름 — 서버 목록 값(표시용). 봉투를 받을 사람·믿는 이름은 명부 room 고리(e2e_roster)에서만
    pub name: String,
    /// 서버가 준 방 사람(멤버 id) — 표시용. 받는 기기는 명부에서 센다
    pub members: Vec<String>,
}

/// 내가 든 팀 하나(chammo-relay 계획 2026-10-24 e2e-multiteam 단계 A) — 계정 기기는 팀을 여럿 가진다
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TeamEntry {
    pub id: String,
    pub name: String,
    /// 이 팀에서의 내 멤버 id
    pub member_id: String,
    /// owner | member
    pub role: String,
    pub display_name: String,
    pub members: Vec<Member>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TeamState {
    pub server: String,
    /// 키체인 chammo-team 칸 이름(공개 열쇠로 지은 것)
    pub key_account: String,
    /// 아래 팀 칸 여섯(team_id·team_name·member_id·display_name·role·members)은 **지금 팀**(teams 중 하나)을 비춘 것 —
    /// 화면·옛 team.json 이 이 칸을 읽는다. 고칠 땐 teams 를 고치고 select_current 로 다시 비춘다
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
    /// 내가 든 팀 전부 — 진짜 기록은 여기(위 팀 칸은 지금 팀 비춤)
    pub teams: Vec<TeamEntry>,
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
    /// 이 기기가 계정의 다른 기기 허용을 기다린다(ADR 0014) — 그동안 서버는 /v0/me/self 만 받는다
    pub pending: bool,
    /// 거절이 없으면 서버가 저절로 허용하는 때(ms)
    pub pending_auto_at: u64,
    /// 계정 되찾기 기다림(relay ADR 0007 R9) — 서버 /v0/me·/v0/me/self 의 recover 를 그대로. 없으면 None
    pub recover: Option<Recover>,
}

/// 기다리는 다시 시작 요청 하나 — 기기 이름·나라·도시는 서버가 준 남의 글(화면에서 거른다)
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Recover {
    pub ready_at: u64,
    /// 이 기기가 낸 요청
    pub mine: bool,
    pub device: String,
    pub device_name: String,
    pub place: String,
}

/// 서버 응답의 recover 칸 → Recover(없거나 null·모양이 틀리면 None)
pub fn recover_of(v: &Value) -> Option<Recover> {
    let r = v.get("recover").filter(|r| r["state"] == "waiting")?;
    let s = |k: &str| r[k].as_str().unwrap_or("").to_string();
    let place = [s("city"), s("country")].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join(", ");
    Some(Recover { ready_at: r["readyAt"].as_u64()?, mine: r["mine"] == true, device: r["device"]["id"].as_str()?.to_string(), device_name: r["device"]["name"].as_str().unwrap_or("").to_string(), place })
}

impl TeamState {
    pub fn joined(&self) -> bool {
        !self.team_id.is_empty() && !self.device_id.is_empty()
    }
    /// 서버에 등록된 기기(열쇠·기기 id 가 있다) — 팀이 없어도 로그인한 기기는 등록돼 있다
    pub fn registered(&self) -> bool {
        !self.device_id.is_empty() && !self.key_account.is_empty()
    }
    /// 기기 id → 이름(모든 팀 멤버 기기·내 계정 기기)
    pub fn device_label(&self, id: &str) -> Option<String> {
        self.all_members().flat_map(|m| m.devices.iter()).chain(self.my_devices.iter()).find(|d| d.id == id).map(|d| d.name.clone())
    }
    /// 멤버 id → 이름 — 멤버 id 는 서버가 팀마다 새로 짓는 UUID 라 모든 팀에서 찾아도 섞이지 않는다
    pub fn member_name(&self, id: &str) -> Option<&str> {
        self.all_members().find(|m| m.id == id).map(|m| m.display_name.as_str())
    }
    fn all_members(&self) -> impl Iterator<Item = &Member> {
        self.teams.iter().flat_map(|t| t.members.iter()).chain(self.members.iter())
    }
    /// 그 멤버가 나인가(어느 팀에서든)
    pub fn is_me(&self, member: &str) -> bool {
        !member.is_empty() && (member == self.member_id || self.teams.iter().any(|t| t.member_id == member))
    }
    /// 그 멤버가 든 팀(내 팀 기록 중) — 이름표 겹침은 그 팀 안에서만 본다
    pub fn team_of_member(&self, member: &str) -> Option<&TeamEntry> {
        self.teams.iter().find(|t| t.member_id == member || t.members.iter().any(|m| m.id == member))
    }
    /// 팀 고르기 — 빈 글이면 지금 팀, 아니면 id 나 이름(대소문자 무시)
    pub fn team(&self, sel: &str) -> Result<&TeamEntry, String> {
        let q = sel.trim();
        let want = if q.is_empty() { self.team_id.as_str() } else { q };
        let low = want.to_lowercase();
        if let Some(t) = self.teams.iter().find(|t| t.id == want).or_else(|| self.teams.iter().find(|t| t.name.to_lowercase() == low)) {
            return Ok(t);
        }
        if self.teams.is_empty() {
            return Err("아직 팀이 없어 — scripts/team create 또는 join".into());
        }
        Err(format!("그런 팀이 없어: {q} — {}", self.teams.iter().map(|t| t.name.as_str()).collect::<Vec<_>>().join(", ")))
    }
    /// 옛 team.json(팀 칸 한 벌·방에 팀 칸 없음)을 teams 로 옮긴다 — 읽을 때마다.
    /// 지금 팀 칸이 그 팀 기록과 다르면(옛 길·손으로 고친 파일) 지금 팀 칸을 따른다 — 화면이 보는 칸과 이름표가 보는 칸이 갈리지 않게
    fn normalize(&mut self) {
        if !self.team_id.is_empty() {
            let cur = TeamEntry {
                id: self.team_id.clone(),
                name: self.team_name.clone(),
                member_id: self.member_id.clone(),
                role: self.role.clone(),
                display_name: self.display_name.clone(),
                members: self.members.clone(),
            };
            match self.teams.iter_mut().find(|t| t.id == cur.id) {
                Some(t) => *t = cur,
                None => self.teams.push(cur),
            }
        }
        if self.teams.len() == 1 {
            let only = self.teams[0].id.clone();
            for r in self.rooms.iter_mut().filter(|r| r.kind != "self" && r.team.is_empty()) {
                r.team = only.clone();
            }
        }
    }
    /// 지금 팀을 바꾸고 위 팀 칸에 비춘다. 없는 id 면 첫 팀, 팀이 없으면 칸을 비운다
    pub fn select_current(&mut self, id: &str) {
        let t = self.teams.iter().find(|t| t.id == id).or(self.teams.first()).cloned().unwrap_or_default();
        self.team_id = t.id;
        self.team_name = t.name;
        self.member_id = t.member_id;
        self.role = t.role;
        self.display_name = t.display_name;
        self.members = t.members;
    }
    /// 팀 하나를 넣거나 바꾸고(같은 id) 지금 팀이면 다시 비춘다
    pub fn put_team(&mut self, e: TeamEntry) {
        match self.teams.iter_mut().find(|t| t.id == e.id) {
            Some(t) => *t = e,
            None => self.teams.push(e),
        }
        let cur = self.team_id.clone();
        self.select_current(&cur);
    }
    /// 팀과 그 팀 방을 지운다(나감·빠짐·지워짐). 지금 팀이었으면 남은 첫 팀으로
    pub fn drop_team(&mut self, id: &str) {
        self.teams.retain(|t| t.id != id);
        self.rooms.retain(|r| r.team != id);
        let cur = self.team_id.clone();
        self.select_current(&cur);
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

/// 지연 실측(fix/team-latency3) — 디버그·시험 빌드에서 CHAMMO_NET_TRACE=<파일> 이면 중계 요청마다 JSON 한 줄(시작 시각 ms·걸린 ms·방법·경로·코드).
/// 경로만(서버·쿼리 뺌), 머리·몸통은 안 남긴다
pub(crate) fn trace(method: &str, url: &str, began: std::time::Instant, code: u16, bytes: usize) {
    if !cfg!(debug_assertions) && !cfg!(test) {
        return;
    }
    let Some(file) = std::env::var_os("CHAMMO_NET_TRACE").filter(|f| !f.is_empty()) else { return };
    let ms = began.elapsed().as_millis() as u64;
    let path = url.split_once("://").map_or(url, |(_, r)| r.find('/').map_or("/", |i| &r[i..]));
    let line = json!({ "start": now_ms().saturating_sub(ms), "ms": ms, "method": method, "path": path.split('?').next().unwrap_or(""), "code": code, "bytes": bytes, "human": human_now(), "thread": format!("{:?}", std::thread::current().id()) });
    trace_line(&file, &line);
}

/// 배경 몫에 막혀 서버에 안 간 요청(local) — 경로별 셈을 앱 밖에서 잴 때 보낸 것과 같이 센다
fn trace_local(method: &str, path: &str) {
    if !cfg!(debug_assertions) && !cfg!(test) {
        return;
    }
    let Some(file) = std::env::var_os("CHAMMO_NET_TRACE").filter(|f| !f.is_empty()) else { return };
    trace_line(&file, &json!({ "start": now_ms(), "ms": 0, "method": method, "path": path.split('?').next().unwrap_or(""), "code": 429, "local": true, "human": false }));
}

fn trace_line(file: &std::ffi::OsStr, line: &Value) {
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
        use std::io::Write;
        let _ = writeln!(f, "{line}");
    }
}

// ── 연결 다시 쓰기(fix/team-latency3) — 요청마다 curl 을 띄우면 TCP+TLS 를 매번 다시 맺는다(운영 실측 새 연결 p50 0.19초 ↔ 다시 쓰기 0.09초).
//    프로세스에 클라이언트 하나(업데이터가 이미 쓰는 reqwest). 리다이렉트 안 따라감·15초 한도는 curl 길과 같다.
//    화면 명령은 spawn_blocking 실에서 부른다 — 거기선 blocking 클라이언트를 써도 된다(curl 을 띄워 기다리는 것과 같다).
//    curl 로 가는 때: CHAMMO_HTTP_CURL=1(되돌리기·진단) · 연결 자체가 안 될 때 한 번 더 · 디버그 빌드에서 비동기 실 안이라 reqwest 가 패닉할 때 ──

/// 예전 길(curl)만
pub(crate) fn curl_only() -> bool {
    std::env::var("CHAMMO_HTTP_CURL").is_ok_and(|v| v == "1")
}

/// 리다이렉트를 안 따라간다(서명한 요청이 다른 곳으로 새지 않게) — 그 모듈 이름 글자는 팀 모듈 승인 길 검사(team_relay_inbox_tests)에 걸려서 use 이름으로
fn no_hops() -> hops::Policy {
    hops::Policy::none()
}

fn pool() -> Option<&'static reqwest::blocking::Client> {
    static C: std::sync::OnceLock<Option<reqwest::blocking::Client>> = std::sync::OnceLock::new();
    C.get_or_init(|| {
        // reqwest(rustls-no-provider)는 암호 제공자가 없으면 패닉 — 업데이터와 같이 ring 을 깔고(이미 있으면 그대로), 그래도 패닉이면 curl 로
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        std::panic::catch_unwind(|| {
            reqwest::blocking::Client::builder()
            .user_agent(concat!("Chammo/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(15))
            .connect_timeout(std::time::Duration::from_secs(10))
            .redirect(no_hops())
            .pool_idle_timeout(std::time::Duration::from_secs(90))
            .build()
            .ok()
        })
        .ok()
        .flatten()
    })
    .as_ref()
}

/// 다시 쓰는 연결로 한 번 — None 이면 curl 로(쓸 수 없거나 연결 자체가 안 됨: 요청이 안 나갔으니 같은 서명으로 다시 보내도 된다)
pub(crate) fn pooled_send(method: &str, url: &str, headers: &[(String, String)], body: &[u8], ctype: &str, timeout: std::time::Duration) -> Option<Result<(u16, Vec<u8>), String>> {
    if curl_only() {
        return None;
    }
    let c = pool()?;
    let m = reqwest::Method::from_bytes(method.as_bytes()).ok()?;
    let mut rb = c.request(m, url).timeout(timeout);
    for (k, v) in headers {
        rb = rb.header(k.as_str(), v.as_str());
    }
    if !body.is_empty() {
        rb = rb.header("Content-Type", ctype).body(body.to_vec());
    }
    // 디버그 빌드의 reqwest 는 비동기 실(런타임 일꾼) 안에서 부르면 패닉한다 — 그땐 curl 로(요청은 안 나갔다)
    let sent = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| rb.send())).ok()?;
    match sent {
        Err(e) if e.is_connect() || e.is_builder() => None,
        Err(e) => Some(Err(format!("중계 서버에 못 닿았어요: {e}"))),
        Ok(r) => {
            let code = r.status().as_u16();
            Some(r.bytes().map(|b| (code, b.to_vec())).map_err(|e| format!("중계 서버 답을 못 읽었어요: {e}")))
        }
    }
}

/// 맥·윈도우 curl. 몸통은 stdin 으로, 머리는 600 임시 파일로(인자·ps 에 안 남게), 응답 끝에 코드 한 줄.
/// 먼저 다시 쓰는 연결로(pooled_send), 못 쓰면 curl
pub struct Curl;

impl Http for Curl {
    fn send(&self, method: &str, url: &str, headers: &[(String, String)], body: &[u8]) -> Result<(u16, String), String> {
        use std::io::Write;
        let began = std::time::Instant::now();
        if let Some(r) = pooled_send(method, url, headers, body, "application/json", std::time::Duration::from_secs(15)) {
            let (code, b) = r?;
            trace(method, url, began, code, b.len());
            return Ok((code, String::from_utf8_lossy(&b).into_owned()));
        }
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
        trace(method, url, began, code.trim().parse().unwrap_or(0), body.len());
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
    let mut st: TeamState = std::fs::read_to_string(dir.join(STATE_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    st.normalize();
    st
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

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// ── 429 slow_down — 서버 nonce 칸(10분)이 찬 열쇠는 Retry-After(60초)만큼 아무 요청도 안 보낸다. 예전엔 다른 실패처럼 다뤄
//    화면 폴링이 그대로 두드렸다(10-26 사고). 열쇠(공개 열쇠)마다 — 서버가 nonce 칸을 열쇠마다 센다 ──

static SLOW: Mutex<std::collections::BTreeMap<String, std::time::Instant>> = Mutex::new(std::collections::BTreeMap::new());

/// 이 열쇠가 쉬는 중이면 남은 시간
pub(crate) fn slow_left(key: &str, now: std::time::Instant) -> Option<std::time::Duration> {
    SLOW.lock().unwrap_or_else(|e| e.into_inner()).get(key).and_then(|t| t.checked_duration_since(now)).filter(|d| !d.is_zero())
}

/// 429 slow_down 을 받았다 — 몸통 retryAfter(초)가 있으면 그만큼, 없으면 서버 Retry-After 와 같은 60초(1~600초로 자른다)
pub(crate) fn slow_down(key: &str, v: &Value, now: std::time::Instant) {
    let secs = v["retryAfter"].as_u64().unwrap_or(60).clamp(1, 600);
    SLOW.lock().unwrap_or_else(|e| e.into_inner()).insert(key.to_string(), now + std::time::Duration::from_secs(secs));
}

pub(crate) const SLOW_DOWN: &str = "중계 서버가 요청이 너무 잦다고 잠시 쉬래요 — 1분쯤 뒤 저절로 다시 해요";

// ── 사람 말 몫(10-28 22:53 429 — 사용자 맥에서 사람이 친 DM 이 '잠시 쉬래요'로 못 나감) — 서버는 열쇠마다 10분 칸에 nonce 300개(chammo-relay NONCE_CAP).
//    앱이 같은 칸(10분 단위로 자른 시각)을 따라 세고, 배경 요청(목록·사슬·명부·소켓 다시 붙기·폴링)은 BG_CAP 에서 멈춰 나머지를 사람 말 보내기에 남긴다.
//    사람 말(as_human 안)은 몫을 안 따지고 쉬는 중(SLOW)이어도 한 번 두드린다 — 칸이 막 넘어갔으면 바로 나간다 ──

pub(crate) const BUCKET_MS: u64 = 10 * 60_000;
/// 배경 요청 상한(칸마다) — 서버 300 중 100 은 사람 말 몫
pub(crate) const BG_CAP: u32 = 200;
static SPENT: Mutex<std::collections::BTreeMap<String, (u64, u32)>> = Mutex::new(std::collections::BTreeMap::new());

thread_local! {
    static HUMAN: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// 사람이 직접 보내는 말 — 이 안에서 부른 서명 요청은 배경 몫·쉬는 중을 건너뛴다
pub(crate) fn as_human<T>(f: impl FnOnce() -> T) -> T {
    let was = HUMAN.with(|h| h.replace(true));
    let r = f();
    HUMAN.with(|h| h.set(was));
    r
}

pub(crate) fn human_now() -> bool {
    HUMAN.with(|h| h.get())
}

async fn ui_job<T: Send + 'static>(human: bool, f: impl FnOnce(&Path, &dyn crate::accounts_store::Store, &dyn Http) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let go = || f(crate::config::data_dir(), &crate::team_relay_keys::store(), &Curl);
        if human { as_human(go) } else { go() }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 화면 명령 입구 — 사람이 눌러야 불리는 팀 동작(만들기·고치기·지우기·올리기…). 배경 몫·쉬는 중에 안 막힌다(10-30 팀챗 만들기가 '잠시 쉬래요')
pub(crate) async fn human_job<T: Send + 'static>(f: impl FnOnce(&Path, &dyn crate::accounts_store::Store, &dyn Http) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    ui_job(true, f).await
}

/// 화면 명령 입구 — 화면 열 때·몇 초마다 저절로 부르는 목록 받기. 배경 몫(BG_CAP)을 센다
pub(crate) async fn bg_job<T: Send + 'static>(f: impl FnOnce(&Path, &dyn crate::accounts_store::Store, &dyn Http) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    ui_job(false, f).await
}

/// 서명 하나를 쓴다 — 배경 요청이 이 칸 몫을 다 썼으면 false(안 보낸다). 사람 말은 늘 true(세기만)
pub(crate) fn spend(key: &str, now_ms: u64, human: bool) -> bool {
    let b = now_ms / BUCKET_MS;
    let mut m = SPENT.lock().unwrap_or_else(|e| e.into_inner());
    let e = m.entry(key.to_string()).or_insert((b, 0));
    if e.0 != b {
        *e = (b, 0);
    }
    if !human && e.1 >= BG_CAP {
        return false;
    }
    e.1 += 1;
    true
}

// ── 몫 진단(10-30 '잠시 쉬래요' — 무엇이 배경 200 을 먹나) — 칸마다 열쇠별로 경로 셈. 메서드·뭉갠 경로(id 칸은 *)·사람/배경·횟수만,
//    비밀값·본문 없음. 배경이 칸 몫을 처음 넘은 때 notify.log 에 한 줄(운영판에서도 그때 무엇이 몰렸는지 본다) ──

static TALLY: Mutex<std::collections::BTreeMap<String, Tally>> = Mutex::new(std::collections::BTreeMap::new());

#[derive(Default)]
struct Tally {
    bucket: u64,
    paths: std::collections::BTreeMap<String, u32>,
    told: bool,
}

/// 경로 모양 — 글자·하이픈만인 칸(teams·locker·key-probe)과 판(v0)만 남기고 나머지(id·조각 번호)는 *
pub(crate) fn path_shape(path: &str) -> String {
    let keep = |s: &str| s.bytes().all(|b| b.is_ascii_lowercase() || b == b'-') || (s.len() <= 3 && s.starts_with('v') && s[1..].bytes().all(|b| b.is_ascii_digit()));
    path.split('?').next().unwrap_or("").split('/').map(|s| if keep(s) { s } else { "*" }).collect::<Vec<_>>().join("/")
}

/// 서명 하나를 셌다(sent = 보냈다, 아니면 배경 몫에 막혔다). 배경이 이 칸에서 처음 막힌 때 남길 한 줄
pub(crate) fn tally(key: &str, now_ms: u64, method: &str, path: &str, human: bool, sent: bool) -> Option<String> {
    let b = now_ms / BUCKET_MS;
    let mut m = TALLY.lock().unwrap_or_else(|e| e.into_inner());
    let t = m.entry(key.to_string()).or_default();
    if t.bucket != b {
        *t = Tally { bucket: b, ..Default::default() };
    }
    let who = if human { "사람 " } else if sent { "" } else { "막힘 " };
    *t.paths.entry(format!("{who}{method} {}", path_shape(path))).or_default() += 1;
    if sent || human || t.told {
        return None;
    }
    t.told = true;
    let mut rows: Vec<(&String, &u32)> = t.paths.iter().collect();
    rows.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    let top: Vec<String> = rows.iter().take(12).map(|(k, n)| format!("{k} {n}")).collect();
    Some(format!("배경 요청이 10분 몫 {BG_CAP}개를 다 썼어 — 경로별: {}", top.join(" · ")))
}

/// 서명 하나 — 몫(spend)을 따지고 경로 셈(tally)에 남긴다. false = 배경 몫을 다 써서 안 보낸다
pub(crate) fn take(key: &str, ts: u64, method: &str, path: &str) -> bool {
    let human = human_now();
    let ok = spend(key, ts, human);
    if let Some(line) = tally(key, ts, method, path, human, ok) {
        // cargo test 는 데이터 폴더를 안 줘 진짜 notify.log 에 쓴다 — 시험에선 tally 가 돌려준 줄만 본다
        #[cfg(not(test))]
        crate::claude::log_out("team", &line);
        #[cfg(test)]
        let _ = line;
    }
    if !ok {
        trace_local(method, path);
    }
    ok
}

/// 이 칸에 쓴 서명 수(시험·진단)
pub(crate) fn spent(key: &str, now_ms: u64) -> u32 {
    SPENT.lock().unwrap_or_else(|e| e.into_inner()).get(key).filter(|e| e.0 == now_ms / BUCKET_MS).map_or(0, |e| e.1)
}

/// 서명한 요청. device = 등록된 기기 id(없으면 공개 열쇠 머리 — 팀 만들기·들어오기)
pub(crate) fn call(http: &dyn Http, server: &str, k: &DeviceKeys, device: Option<&str>, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
    // 기기 id 는 머리값(curl 머리 파일)에 들어간다 — 줄바꿈 등으로 다른 머리를 끼우지 못하게(리뷰 10-23)
    if device.is_some_and(|d| d.is_empty() || d.len() > 64 || !d.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')) {
        return Err("team.json 의 기기 id 가 이상해".into());
    }
    // team.json 은 손으로 고칠 수 있는 파일 — 나가기 직전마다 다시 거른다(보안 검토 4-B)
    let server = server_ok(server).ok_or("team.json 의 서버 주소가 https 가 아니야")?;
    // 쉬는 중이면 서버에 안 닿고 같은 답 — 부르는 쪽은 진짜 429 와 똑같이 다룬다
    let human = human_now();
    if !human && slow_left(&k.public(), std::time::Instant::now()).is_some() {
        return Ok((429, json!({ "error": "slow_down", "local": true })));
    }
    let ts = now_ms();
    if !take(&k.public(), ts, method, path) {
        return Ok((429, json!({ "error": "slow_down", "local": true, "budget": true })));
    }
    let raw = body.map(|b| b.to_string()).unwrap_or_default();
    let s = k.sign_request(method, path, raw.as_bytes(), ts, &keys::new_nonce()?);
    let mut h = vec![("X-Chammo-Ts".to_string(), s.ts), ("X-Chammo-Nonce".to_string(), s.nonce), ("X-Chammo-Sig".to_string(), s.sig)];
    h.push(match device {
        Some(d) => ("X-Chammo-Device".into(), d.into()),
        None => ("X-Chammo-Key".into(), k.public()),
    });
    let (code, text) = http.send(method, &format!("{server}{path}"), &h, raw.as_bytes())?;
    let v = serde_json::from_str(&text).unwrap_or(Value::Null);
    if code == 429 && v["error"] == "slow_down" {
        slow_down(&k.public(), &v, std::time::Instant::now());
    }
    Ok((code, v))
}

/// 서버가 이 기기를 모를 때 열쇠 머리로 서명해 묻는 없는 길 — 서버는 등록된 열쇠면 401, 모르는 열쇠면 서명·시계를 통과해 404(chammo-relay index.ts)
pub(crate) const KEY_PROBE: &str = "/v0/key-probe";

pub(crate) const GONE: &str = "이 기기는 중계 서버에서 끊겼어(다른 기기에서 끊었거나 로그인 허용이 거절됨) — 다시 로그인해 줘";

/// 기기 서명이 401 을 받은 뒤 — 서버가 이 열쇠를 아예 모르면(대기 중 거절로 지운 기기 등) 끊긴 기기로 적는다.
/// 401 은 시계가 5분 넘게 틀려도 와서 그것만으론 못 가린다 — 404 가 와야 시계도 맞고 기기도 없는 것(10-28 윈도우 실측). 적었으면 true
pub(crate) fn mark_if_gone(dir: &Path, http: &dyn Http, st: &TeamState, k: &DeviceKeys) -> bool {
    if st.revoked {
        return true;
    }
    if !matches!(call(http, &st.server, k, None, "GET", KEY_PROBE, None), Ok((404, _))) {
        return false;
    }
    // cargo test 는 데이터 폴더를 안 줘 진짜 notify.log 에 썼다 — 10-30 그 줄을 보고 사용자 기기가 끊긴 줄 알 뻔했다
    #[cfg(not(test))]
    crate::claude::log_out("team", "중계 서버가 이 기기를 몰라 — 끊긴 기기로 적음(다시 로그인)");
    mutate_if(dir, &st.device_id, |s| s.revoked = true).is_ok()
}

/// 서버 오류 → 사람이 읽는 이유
pub(crate) fn why(code: u16, v: &Value) -> String {
    match (code, v["error"].as_str().unwrap_or("")) {
        (401, _) => "중계 서버가 서명을 거절했어(이 기기 시계가 5분 넘게 틀렸거나 기기가 끊겼어)".into(),
        (400, "roles_off") => "중계 서버가 아직 매니저 권한을 안 켰어 — 팀 기기가 다 새 판이 된 뒤 켜요".into(),
        (400, "use_transfer") => "팀장은 '팀장 넘기기'로만 바꿔".into(),
        (403, "owner_only") => "전체 권한은 팀장만 주고 뺏어".into(),
        (403, "rank") => "같거나 높은 사람의 권한은 못 바꿔".into(),
        (409, "transfer_first") => "다른 사람이 있는 팀의 팀장이라 계정을 못 지워 — 먼저 팀장을 넘기거나 팀을 지워".into(),
        (403, _) => "그 팀·방의 권한이 없어(초대·빼기·역할은 팀장이나 그 권한을 받은 매니저만)".into(),
        (409, "last_owner") => "마지막 팀장이라 안 돼 — 다른 사람을 팀장으로 올린 뒤에".into(),
        (409, "already_member") => "이미 그 팀에 있어".into(),
        (404, "member_not_found") => "그 사람이 팀에 없어".into(),
        // 허용·사슬(ADR 0007) — 10-25 QA: 모두 '이 열쇠는 이미 등록돼 있어'로 나왔다
        (409, "link_required") => "이 계정은 숫자 확인으로만 허용해요 — 새 기기 화면의 6자리를 카드에 넣어 주세요".into(),
        (409, "not_revealed" | "no_nonce") => "새 기기 화면에 아직 숫자가 안 떴어요 — 잠시 뒤 다시 해 주세요".into(),
        (409, "no_commit") => "새 기기가 아직 숫자 준비를 안 했어요 — 새 기기 앱을 켜 두고 잠시 뒤 다시".into(),
        (409, "stale_head") => "그새 다른 기기가 기기 목록을 바꿨어요 — 카드를 다시 열어 주세요".into(),
        (409, "busy") => "다른 기기에서 이 기기를 확인하고 있어요 — 그 카드로 해 주세요".into(),
        (409, "revealed") => "이미 숫자를 보냈어요".into(),
        (409, "not_trustable" | "not_in_chain") => "이 기기는 지금 그렇게 할 수 없어요(기기 목록 상태가 달라요)".into(),
        (409, "chain_alive") => "아직 쓰는 내 기기가 있어요 — 그 기기에서 허용받아 주세요".into(),
        (409, "key_in_use" | "device_registered" | "device_other_account") => "이 기기 열쇠는 이미 다른 등록에 쓰이고 있어요 — 로그아웃 뒤 다시 로그인해 주세요".into(),
        (409, e) => format!("지금은 할 수 없어요 — 이미 처리됐거나 상태가 바뀌었어요({e})"),
        (410, _) => "초대 코드가 틀렸거나 이미 썼거나 24시간이 지났어 — 팀장에게 새 코드를 받아".into(),
        (413, _) => "너무 커".into(),
        (429, "slow_down") => SLOW_DOWN.into(),
        (c, e) => format!("중계 서버 {c} {e}"),
    }
}


pub fn device_keys(kc: &dyn Store, st: &TeamState) -> Result<DeviceKeys, String> {
    keys::load(kc, &st.key_account)?.ok_or_else(|| "이 기기의 팀 열쇠가 키체인에 없어(다른 맥으로 옮긴 데이터 폴더?) — 팀장에게 새로 초대받아".into())
}

/// 팀 만들기·들어오기. 로그인한 기기(계정)는 지금 열쇠·기기 서명으로(서버가 계정 멤버로 붙인다),
/// 아니면 새 열쇠를 만들어 미등록 길로 등록하고 서버가 거절하면 만든 열쇠를 치운다
pub(crate) fn register(dir: &Path, kc: &dyn Store, http: &dyn Http, server: &str, path: &str, body: Value, role: &str, display: &str, device: &str) -> Result<TeamState, String> {
    if crate::team_account::login_busy(dir) {
        return Err("지금 로그인 중이야 — 끝난 뒤에".into());
    }
    let now = load_state(dir);
    // 계정 없는 옛 초대 기기는 서버에서도 팀 하나(device_registered) — 계정 기기만 여럿
    if now.joined() && now.account.is_none() {
        return Err("이 기기는 초대 코드로만 들어온 옛 기기라 팀 하나 — 여러 팀은 scripts/team login 뒤에".into());
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
        let id = s("teamId");
        return mutate(dir, |st| {
            st.put_team(TeamEntry { id: id.clone(), name: team_name, member_id: s("memberId"), role: role.into(), display_name: display.into(), members: vec![] });
            st.select_current(&id);
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
        };
        st.normalize();
    })
    .map_err(|e| format!("{e} — 서버엔 등록됨(팀 {}, 기기 {})", s("teamId"), s("deviceId")))
}

pub fn create(dir: &Path, kc: &dyn Store, http: &dyn Http, server: &str, team: &str, display: &str, device: &str) -> Result<TeamState, String> {
    // 암호 전용(chammo-relay ADR 0007 R8) — 명부 없는 팀은 쓸 수 없으니 이 기기가 사슬에 든 뒤에만 만든다
    crate::e2e_team::ready(dir)?;
    let st = register(dir, kc, http, server, "/v0/teams", json!({ "name": team, "deviceName": device, "displayName": display }), "owner", display, device)?;
    if let Err(e) = crate::e2e_team::after_create(dir, kc, http, &st.team_id, &st.member_id, display, team) {
        // 명부 없는 팀은 못 쓴다 — 서버에 고아로 남기지 않게 그 자리에서 지운다(5차 리뷰)
        let k = device_keys(kc, &st)?;
        let gone = call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/delete", st.team_id), Some(&json!({}))).is_ok_and(|(c, _)| c == 200);
        mutate_if(dir, &st.device_id, |s| s.drop_team(&st.team_id))?;
        return Err(if gone { format!("명부 첫 고리를 못 올려서 만든 팀을 지웠어 — 다시 만들어 줘: {e}") } else { format!("명부 첫 고리를 못 올렸어, 서버의 팀도 못 지웠어(팀 {}): {e}", st.team_id) });
    }
    Ok(st)
}

#[derive(Debug, Serialize)]
pub struct Invite {
    pub code: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: u64,
    /// 받는 사람이 그대로 붙여 넣는 것 — 서버 주소까지
    pub link: String,
}

pub fn invite(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<Invite, String> {
    let st = load_state(dir);
    let t = st.team(team)?;
    let k = device_keys(kc, &st)?;
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/invites", t.id), Some(&json!({})))?;
    if code != 201 {
        return Err(why(code, &v));
    }
    let c = v["code"].as_str().unwrap_or("").to_string();
    // 초대 고리(팀장 서명, 초대 코드에서 끌어낸 열쇠) — 이게 없으면 받은 사람의 들어옴이 명부에 못 든다
    crate::e2e_team::after_invite(dir, kc, http, &t.id, &c, v["expiresAt"].as_u64().unwrap_or(0)).map_err(|e| format!("초대는 만들었는데 명부 고리를 못 올렸어: {e}"))?;
    Ok(Invite { link: invite_link(&st.server, &c), code: c, expires_at: v["expiresAt"].as_u64().unwrap_or(0) })
}

/// 초대 페이지 — 슬랙·카톡에서 눌리는 https(chammo:// 는 메신저가 링크로 안 만든다, 10-24 사용자). 페이지가 'Chammo 에서 열기'(chammo://join?…)·내려받기·코드 복사를 준다
pub const INVITE_PAGE: &str = "https://chammo.app/join";

fn enc(s: &str) -> String {
    // URL 에서 그대로 둬도 되는 글자(-._~)는 남긴다
    const KEEP: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC.remove(b'-').remove(b'.').remove(b'_').remove(b'~');
    percent_encoding::utf8_percent_encode(s, KEEP).to_string()
}

/// 받는 사람이 누르는 링크 — 코드는 # 뒤(페이지 서버 기록에 안 남게), 기본 중계가 아니면 서버도 # 뒤에
pub fn invite_link(server: &str, code: &str) -> String {
    let s = server_ok(server).unwrap_or_else(|| server.trim().to_string());
    if s == DEFAULT_SERVER { format!("{INVITE_PAGE}#{}", enc(code)) } else { format!("{INVITE_PAGE}#{}&server={}", enc(code), enc(&s)) }
}

/// 초대 코드 모양 — 서버가 주는 base64url(22자). 그 밖의 글은 코드로 서버에 보내지 않는다
fn code_ok(c: &str) -> bool {
    (1..=128).contains(&c.len()) && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// k=v&… 에서 (server, code) — 이름 없는 첫 조각은 코드(https 링크의 #코드)
fn invite_parts(q: &str) -> (Option<String>, String) {
    let mut server = None;
    let mut code = String::new();
    for (i, kv) in q.split('&').enumerate() {
        let dec = |v: &str| percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned();
        match kv.split_once('=') {
            Some(("server", v)) => server = Some(dec(v)),
            Some(("code", v)) => code = dec(v),
            None if i == 0 => code = dec(kv),
            _ => {}
        }
    }
    (server, if code_ok(&code) { code } else { String::new() })
}

/// 붙여 넣은 초대 — https 링크(chammo.app/join#코드)·딥링크(chammo://join?…)·코드만 다 받는다.
/// (서버, 코드) — https 링크에 서버가 없으면 기본 중계, 코드만이면 서버 None. 초대로 못 읽으면 코드가 빈 글
pub fn parse_invite(raw: &str) -> (Option<String>, String) {
    let s = raw.trim().trim_start_matches('<').trim_end_matches('>').trim();
    // 윈도우 셸은 chammo://join?… 을 chammo://join/?… 로 넘긴다(10-24 윈도우 PC 실측)
    if let Some(q) = s.strip_prefix("chammo://join?").or_else(|| s.strip_prefix("chammo://join/?")) {
        return invite_parts(q);
    }
    let bare = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(s);
    let bare = bare.strip_prefix("www.").unwrap_or(bare);
    if let Some(f) = bare.strip_prefix("chammo.app/join#").or_else(|| bare.strip_prefix("chammo.app/join/#")) {
        let (server, code) = invite_parts(f);
        return (Some(server.unwrap_or_else(|| DEFAULT_SERVER.to_string())), code);
    }
    (None, if code_ok(s) { s.to_string() } else { String::new() })
}

/// 클립보드 같은 글 안의 초대 링크 하나 — https(chammo.app/join#…)나 딥링크(chammo://join?…)만, 코드만 있는 글은 안 본다(아무 글이나 초대로 채우지 않게).
/// 찾은 것으로 다시 만든 https 링크를 돌려준다 — 글 원문은 화면에 안 넘긴다
pub fn invite_in_text(text: &str) -> Option<String> {
    text.chars().take(4000).collect::<String>().split(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | '(' | ')' | '|')).find_map(|w| {
        if !(w.starts_with("chammo://join") || w.contains("chammo.app/join")) {
            return None;
        }
        let (server, code) = parse_invite(w);
        let server = server.unwrap_or_else(|| DEFAULT_SERVER.to_string());
        (!code.is_empty() && server_ok(&server).is_some()).then(|| invite_link(&server, &code))
    })
}

/// 초대로 들어오기 — server 가 비면 링크에 든 서버
pub fn join(dir: &Path, kc: &dyn Store, http: &dyn Http, server: &str, invite: &str, display: &str, device: &str) -> Result<TeamState, String> {
    let (from_link, code) = parse_invite(invite);
    let server = if server.trim().is_empty() { from_link.unwrap_or_default() } else { server.to_string() };
    if load_state(dir).revoked {
        return Err(format!("{GONE} — 그다음 초대 링크를 다시 눌러 줘"));
    }
    if code.is_empty() {
        return Err(crate::i18n::tr("초대 링크(또는 코드)를 못 읽었어 — 받은 https://chammo.app/join#… 링크를 그대로 붙여 줘", "Couldn't read the invite — paste the https://chammo.app/join#… link you got").into());
    }
    crate::e2e_team::ready(dir)?;
    let st = register(dir, kc, http, &server, "/v0/invites/redeem", json!({ "code": code, "deviceName": device, "displayName": display }), "member", display, device)?;
    // 들어옴 고리(초대 코드 열쇠 서명까지) — 없으면 명부에 내 자리가 없어 아무와도 말할 수 없다
    crate::e2e_team::after_join(dir, kc, http, &st.team_id, &code, &st.member_id, display).map_err(|e| format!("팀엔 들어왔는데 명부 고리를 못 올렸어: {e}"))?;
    Ok(st)
}

/// 고른 팀(빈 글 = 지금 팀)의 멤버 목록을 받아 그 팀에 적는다
pub fn refresh_members(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<TeamState, String> {
    let st = load_state(dir);
    let t = st.team(team)?.clone();
    let k = device_keys(kc, &st)?;
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "GET", &format!("/v0/teams/{}/members", t.id), None)?;
    if code != 200 {
        return Err(why(code, &v));
    }
    let members: Vec<Member> = serde_json::from_value(v["members"].clone()).unwrap_or_default();
    mutate_if(dir, &st.device_id, |s| s.put_team(TeamEntry { members, ..t }))
}

/// 사람 이름표 — 프로필 이름이 있고 명부(계정) 이름과 다르면 '프로필 이름(계정 이름)', 아니면 계정 이름. 앱 화면은 프로필 이름을 쓴다(domain/teamProfile lookOf)
pub fn label(account: &str, profile: Option<&str>) -> String {
    match profile.map(str::trim).filter(|p| !p.is_empty() && *p != account.trim()) {
        Some(p) => format!("{p}({account})"),
        None => account.to_string(),
    }
}

/// 사람 찾기(그 팀 안) — id, 계정 이름이나 프로필 이름(aka: 멤버 id → 프로필 이름, 대소문자 무시)이 정확히 맞는 게 먼저, 없으면 하나뿐인 앞부분.
/// 둘 이상 맞으면 엉뚱한 사람에게 가지 않게 고르라고 한다(멤버 id 를 붙여)
pub fn find_member<'a>(t: &'a TeamEntry, q: &str, aka: &BTreeMap<String, String>) -> Result<&'a Member, String> {
    let q = q.trim();
    let low = q.to_lowercase();
    if let Some(m) = t.members.iter().find(|m| m.id == q) {
        return Ok(m);
    }
    let names = |m: &Member| [Some(m.display_name.to_lowercase()), aka.get(&m.id).map(|a| a.trim().to_lowercase())].into_iter().flatten().filter(|n| !n.is_empty()).collect::<Vec<_>>();
    let shown = |m: &Member| label(&m.display_name, aka.get(&m.id).map(String::as_str));
    let mut hits: Vec<&Member> = t.members.iter().filter(|m| names(m).contains(&low)).collect();
    if hits.is_empty() && !low.is_empty() {
        hits = t.members.iter().filter(|m| names(m).iter().any(|n| n.starts_with(&low))).collect();
    }
    match hits.as_slice() {
        [m] => Ok(m),
        [] => Err(format!("{} 팀에 그런 사람이 없어: {q} — {}", t.name, t.members.iter().map(shown).collect::<Vec<_>>().join(", "))),
        many => Err(format!("누구?: {} — 멤버 id 로 골라 줘", many.iter().map(|m| format!("{} [{}]", shown(m), m.id)).collect::<Vec<_>>().join(", "))),
    }
}

/// 고른 팀에서 그 사람(없으면 목록을 다시 받아 한 번 더) — (상태, 팀, 멤버)
/// 팀을 안 골랐는데 who 가 다른 팀의 멤버 id 면 그 팀으로(화면·폰은 멤버 id 로 부른다 — 멤버 id 는 팀마다 새 UUID)
fn member_in(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, who: &str) -> Result<(TeamState, TeamEntry, Member), String> {
    let mut st = load_state(dir);
    let by_id = if team.trim().is_empty() { st.teams.iter().find(|t| t.members.iter().any(|m| m.id == who.trim())).map(|t| t.id.clone()) } else { None };
    let team = by_id.as_deref().unwrap_or(team);
    // 사용자는 프로필 이름으로 부른다(10-28 아이맥 참모 — 계정 이름만 봐서 못 찾았다)
    let aka = crate::team_profile::cached_names(dir, kc, &st.team(team)?.id);
    if find_member(st.team(team)?, who, &aka).is_err() {
        st = refresh_members(dir, kc, http, team)?;
    }
    let t = st.team(team)?.clone();
    let m = find_member(&t, who, &aka)?.clone();
    Ok((st, t, m))
}

/// 그 사람과의 DM 방 — 기억한 방이 있으면 그것, 없으면 서버에 연다(서버도 두 사람 사이에 하나만 만든다)
pub fn open_dm(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, who: &str) -> Result<Room, String> {
    let (st, t, m) = member_in(dir, kc, http, team, who)?;
    if m.id == t.member_id {
        return Err("나 자신과는 DM 이 없어".into());
    }
    if let Some(r) = st.rooms.iter().find(|r| r.kind == "dm" && r.peer == m.id) {
        return Ok(r.clone());
    }
    let k = device_keys(kc, &st)?;
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/dms", t.id), Some(&json!({ "memberId": m.id })))?;
    if code != 200 && code != 201 {
        return Err(why(code, &v));
    }
    let room = Room { id: v["roomId"].as_str().unwrap_or("").to_string(), kind: "dm".into(), peer: m.id, team: t.id, ..Default::default() };
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
    if st.revoked {
        return Err(GONE.into());
    }
    let k = device_keys(kc, &st)?;
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/rooms", None)?;
    if code == 401 && mark_if_gone(dir, http, &st, &k) {
        return Err(GONE.into());
    }
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
                    // 팀마다 내 멤버 id 가 다르다 — 그 방 팀의 내 멤버 id 로 상대를 가린다
                    let team = r["teamId"].as_str().unwrap_or("").to_string();
                    let me = st.teams.iter().find(|t| t.id == team).map(|t| t.member_id.as_str()).unwrap_or(st.member_id.as_str());
                    let peer = r["memberIds"].as_array().and_then(|m| m.iter().filter_map(Value::as_str).find(|m| *m != me)).unwrap_or("").to_string();
                    match kind {
                        "self" => Some(Room { id, kind: "self".into(), ..Default::default() }),
                        "dm" => Some(Room { id, kind: "dm".into(), peer, team, ..Default::default() }),
                        "group" => {
                            let members = r["memberIds"].as_array().map(|m| m.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
                            Some(Room { id, kind: "group".into(), team, name: r["name"].as_str().unwrap_or("").to_string(), members, ..Default::default() })
                        }
                        _ => None,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    if st.account.is_some() && !rooms.iter().any(|r| r.kind == "self") {
        let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "POST", "/v0/me/room", Some(&json!({})))?;
        match v["roomId"].as_str().filter(|_| code == 200 || code == 201) {
            Some(id) => rooms.push(Room { id: id.into(), kind: "self".into(), ..Default::default() }),
            None => return Err(why(code, &v)),
        }
    }
    mutate_if(dir, &st.device_id, |s| s.rooms = rooms)
}

/// 고른 팀에서 나가기 — 마지막 팀장이면 서버가 409. 나가면 그 팀과 그 팀 방을 이 기기에서도 지운다
pub fn leave(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<TeamState, String> {
    let st = load_state(dir);
    let t = st.team(team)?.clone();
    let k = device_keys(kc, &st)?;
    let body = match crate::e2e_team::link_for(dir, kc, http, &t.id, json!({ "kind": "leave", "member": t.member_id }))? {
        Some(link) => json!({ "link": link }),
        None => json!({}),
    };
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/leave", t.id), Some(&body))?;
    if code != 200 {
        return Err(why(code, &v));
    }
    mutate_if(dir, &st.device_id, |s| s.drop_team(&t.id))
}

/// 팀 지우기(팀장만) — 서버가 모든 멤버를 빼고 남은 초대를 막고 방 내용을 지운다. 되돌릴 수 없어 화면 확인 창 뒤 team_ui_delete 에서만 부른다(scripts/team 엔 없다)
/// 팀 id 로만 — 빈 글(지금 팀)·이름으로는 안 지운다. 같은 이름 팀이 둘이면 지운 뒤 지금 팀이 다른 같은 이름 팀으로 바뀌어 다시 연 설정이 그 팀까지 지웠다(1025 B')
pub fn delete_team(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<TeamState, String> {
    let st = load_state(dir);
    let id = team.trim();
    if id.is_empty() || st.teams.iter().any(|t| t.name == id && t.id != id) {
        return Err("지울 팀은 팀 id 로 골라 줘(이름·지금 팀으로는 안 지워)".into());
    }
    let t = st.teams.iter().find(|t| t.id == id).cloned().ok_or("이미 지운 팀이거나 이 기기가 모르는 팀이야 — 지우지 않았어(팀 id 로 골라 줘)")?;
    if t.role != "owner" {
        return Err("팀장만 팀을 지울 수 있어".into());
    }
    let k = device_keys(kc, &st)?;
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/delete", t.id), Some(&json!({})))?;
    if code != 200 {
        return Err(why(code, &v));
    }
    mutate_if(dir, &st.device_id, |s| s.drop_team(&t.id))
}

/// 고른 팀에서 사람 빼기(팀장만) — 뒤에 멤버 목록을 다시 받는다
pub fn remove_member(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, who: &str) -> Result<TeamState, String> {
    let (st, t, m) = member_in(dir, kc, http, team, who)?;
    if m.id == t.member_id {
        return Err("나 자신은 빼기 대신 나가기(scripts/team leave)".into());
    }
    let k = device_keys(kc, &st)?;
    let body = match crate::e2e_team::link_for(dir, kc, http, &t.id, json!({ "kind": "remove", "member": m.id }))? {
        Some(link) => json!({ "link": link }),
        None => json!({}),
    };
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/members/{}/remove", t.id, m.id), Some(&body))?;
    if code != 200 {
        return Err(why(code, &v));
    }
    refresh_members(dir, kc, http, &t.id)
}

/// 고른 팀에서 역할 바꾸기(owner | member, 팀장만) — 마지막 팀장을 내리면 서버가 409
pub fn set_role(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, who: &str, role: &str) -> Result<TeamState, String> {
    if role != "owner" && role != "member" {
        return Err("역할은 owner 또는 member".into());
    }
    let (st, t, m) = member_in(dir, kc, http, team, who)?;
    let k = device_keys(kc, &st)?;
    let mut body = json!({ "role": role });
    if let Some(link) = crate::e2e_team::link_for(dir, kc, http, &t.id, json!({ "kind": "role", "member": m.id, "role": role }))? {
        body["link"] = link;
    }
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/members/{}/role", t.id, m.id), Some(&body))?;
    if code != 200 {
        return Err(why(code, &v));
    }
    after_role(dir, kc, http, &t)
}

/// 역할이 바뀐 뒤 — 멤버 목록을 다시 받고 내 역할도 팀 기록에
fn after_role(dir: &Path, kc: &dyn Store, http: &dyn Http, t: &TeamEntry) -> Result<TeamState, String> {
    let st = refresh_members(dir, kc, http, &t.id)?;
    let mine = st.team(&t.id)?.members.iter().find(|x| x.id == t.member_id).map(|x| x.role.clone());
    match mine {
        Some(r) => mutate_if(dir, &st.device_id, |s| s.put_team(TeamEntry { role: r, ..s.team(&t.id).cloned().unwrap_or_default() })),
        None => Ok(st),
    }
}

/// 매니저 임명·권한 바꾸기 — perms 가 비면 팀원으로(relay ADR 0014). 권한은 한 가지 모양(정렬·중복 없음, all 은 혼자)으로 고리에 싣는다
pub fn set_perms(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, who: &str, perms: &[String]) -> Result<TeamState, String> {
    let mut p: Vec<String> = perms.to_vec();
    if p.iter().any(|x| x == "all") {
        p = vec!["all".into()];
    } else {
        p.sort();
        p.dedup();
    }
    if p.iter().any(|x| x != "all" && !crate::e2e_roster::ITEMS.contains(&x.as_str())) {
        return Err(format!("모르는 권한이야 — {}", crate::e2e_roster::ITEMS.join(", ")));
    }
    let (st, t, m) = member_in(dir, kc, http, team, who)?;
    let k = device_keys(kc, &st)?;
    let role = if p.is_empty() { "member" } else { "manager" };
    let mut f = json!({ "kind": "role", "member": m.id, "role": role });
    let mut body = json!({ "role": role });
    if !p.is_empty() {
        f["perms"] = json!(p);
        body["perms"] = json!(p);
    }
    if let Some(link) = crate::e2e_team::link_for(dir, kc, http, &t.id, f)? {
        body["link"] = link;
    }
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/members/{}/role", t.id, m.id), Some(&body))?;
    if code != 200 {
        return Err(why(code, &v));
    }
    after_role(dir, kc, http, &t)
}

/// 팀장 넘기기 — 받는 사람 = 팀장, 나 = 전체 권한 매니저, 한 고리(from = 나). 스위치가 꺼진 옛 서버면 예전 '팀장으로 올리기'
pub fn transfer_owner(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, who: &str) -> Result<TeamState, String> {
    let (st, t, m) = member_in(dir, kc, http, team, who)?;
    let k = device_keys(kc, &st)?;
    let link = crate::e2e_team::link_for(dir, kc, http, &t.id, json!({ "kind": "role", "member": m.id, "role": "owner", "from": t.member_id }))?;
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{}/transfer", t.id), Some(&json!({ "member": m.id, "link": link })))?;
    if code == 400 && v["error"] == "roles_off" {
        // 옛 서버(스위치 꺼짐) — 받는 사람을 팀장으로 올린 뒤 나는 팀원으로 내려온다(팀장이 둘로 남지 않게, 손 시험 ⑤ 10-30)
        set_role(dir, kc, http, team, &m.id, "owner")?;
        return set_role(dir, kc, http, team, &t.member_id, "member");
    }
    if code != 200 {
        return Err(why(code, &v));
    }
    after_role(dir, kc, http, &t)
}

/// 다음 명령의 기본 팀 고르기(서버는 안 부름)
pub fn use_team(dir: &Path, team: &str) -> Result<TeamState, String> {
    let st = load_state(dir);
    let id = st.team(team)?.id.clone();
    mutate_if(dir, &st.device_id, |s| s.select_current(&id))
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
/// 로그아웃 전에 쓰던 중계 주소 — 다시 로그인('처음부터')할 때 기본 중계 대신 이것(QA 4). 비밀 아님
pub const LAST_SERVER_FILE: &str = "last-server.txt";

pub fn forget_local(dir: &Path, kc: &dyn Store) -> Result<String, String> {
    crate::team_relay_ws::stop();
    let st = load_state(dir);
    if let Some(s) = server_ok(&st.server) {
        let _ = std::fs::write(dir.join(LAST_SERVER_FILE), s);
    }
    if !st.key_account.is_empty() {
        let _ = keys::remove(kc, &st.key_account);
    }
    for f in [crate::team_relay_inbox::INBOX_FILE, crate::team_relay_inbox::SEEN_FILE] {
        let _ = std::fs::remove_file(dir.join(f));
    }
    // 종단 암호 허용 흐름·내 계정 핀(다른 계정 핀은 남긴다) — 다시 로그인하면 4자리부터(5차 리뷰)
    crate::e2e_state::reset_self(dir, st.account.as_ref().map(|a| a.id.as_str()))?;
    match std::fs::remove_file(dir.join(STATE_FILE)) {
        Ok(()) => Ok(st.team_id),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(st.team_id),
        Err(e) => Err(e.to_string()),
    }
}

/// 폰 허브 WebSocket 주소(주인 = 이 기기) — 서명은 쿼리로(서버 connectHub, ADR 0005)
pub fn hub_url(st: &TeamState, k: &DeviceKeys, ts_ms: u64, nonce: &str) -> Result<String, String> {
    let path = format!("/v0/hubs/{}/ws", st.device_id);
    if !take(&k.public(), ts_ms, "GET", &path) {
        return Err("서버 429 — 배경 요청 몫을 다 써서 잠시 쉬어요".into());
    }
    trace("GET", &path, std::time::Instant::now(), 101, 0);
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
    if !take(&k.public(), ts_ms, "GET", &path) {
        return Err("서버 429 — 배경 요청 몫을 다 써서 잠시 쉬어요".into());
    }
    trace("GET", &path, std::time::Instant::now(), 101, 0);
    let s = k.sign_request("GET", &path, b"", ts_ms, nonce);
    let base = server_ok(&st.server).ok_or("team.json 의 서버 주소가 https 가 아니야")?;
    let base = base.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    Ok(format!("{base}{path}?device={}&ts={}&nonce={}&sig={}", st.device_id, s.ts, s.nonce, s.sig))
}

#[cfg(test)]
#[path = "team_relay_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "team_relay_multi_tests.rs"]
mod multi_tests;
