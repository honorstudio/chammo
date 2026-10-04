//! 모바일 서버의 문지기 — HTTP 한 요청을 읽고(httparse), 주소(Host)·열쇠·출처(Origin)를 본 뒤 허용 목록 길만 연다.
//! 하위 세션은 확인 없이 도니 이 서버는 맥을 조종하는 문이다. 여기 없는 길은 없다: 임의 경로·셸·키체인·계정·설정 쓰기 없음.
//! 실제로 맥에서 일하는 건 Backend(mobile.rs) — 테스트는 가짜 Backend 로 문지기만 잰다.
use crate::mobile_files::{self, Kind, Pick};
use serde::Deserialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::net::TcpStream;
use std::time::Duration;

const MAX_HEAD: usize = 16 * 1024;
const MAX_BODY: usize = 64 * 1024;
/// 한 번에 보내는 글 상한(글자) — 폰 입력칸에서 이보다 길 일은 없다
const MAX_TEXT: usize = 8_000;

/// 폰이 부를 수 있는 맥 쪽 일 — 이게 전부다
pub trait Backend: Send + Sync {
    /// 화면이 domain/* 에 넘길 환경(비서 이름·dev 폴더·HQ 폴더)
    fn env(&self) -> serde_json::Value;
    /// `claude agents --json` 원문
    fn sessions(&self) -> Result<String, String>;
    fn hq_dir(&self) -> String;
    /// 대화 기록 이어 읽기 — 세션 id(UUID)로만 찾는다
    fn transcript(&self, session_id: &str, from: Option<u64>) -> serde_json::Value;
    /// 앞 대화 거슬러 읽기 — before(줄 처음 자리) 앞의 온전한 줄들 {text, start}
    fn transcript_before(&self, session_id: &str, before: u64) -> serde_json::Value;
    fn tasks(&self) -> String;
    /// 예약 목록 원문 — 스크립트가 실패하면 그 이유(빈 목록으로 숨기지 않는다)
    fn routines(&self) -> Result<String, String>;
    fn usage(&self) -> String;
    fn send(&self, id: &str, text: &str) -> Result<(), String>;
    /// 직접 답하기 카드 기록 원문(<데이터>/direct.jsonl)
    fn direct_log(&self) -> String {
        String::new()
    }
    /// 직접 답하기 카드에 답 — 데스크톱과 같은 길(direct::answer, by phone)
    fn direct_answer(&self, _id: &str, _pick: &crate::direct::Pick) -> Result<(), String> {
        Err("not supported".into())
    }
    /// 뒤에서 보내고 끝나면 done — 폰엔 받자마자 답한다(글자를 다 치는 동안 연결을 붙잡지 않게). 맥은 스레드, 시험은 그 자리에서
    fn send_later(&self, id: &str, text: &str, done: Box<dyn FnOnce(Result<(), String>) + Send>) {
        done(self.send(id, text));
    }
    /// 하던 일 멈추기 — 그 세션에 Esc 한 번(데스크톱 채팅 멈춤과 같은 키)
    fn interrupt(&self, id: &str) -> Result<(), String>;
    /// 시안 검토(큐레이션) 결과 — 데스크톱과 같은 <데이터>/curation/<폴더>-<시안>.md·.state.json
    fn save_curation(&self, path: &str, text: &str, store: &str) -> Result<(), String>;
    fn read_curation_state(&self, path: &str) -> String;
    /// 워드 → html(textutil). 폰은 거른 뒤 글로 읽는다
    fn doc_html(&self, path: &Path) -> Option<String>;
    /// 맥에서 열기(open) — 폰에서 못 보는 오피스·영상을 맥 앱으로
    fn open_on_mac(&self, path: &str) -> Result<(), String>;
    /// 참모 별명 — 맥 앱(데스크톱)에 넘긴다: 앱 별명(setOrchLabel)을 바꾸고, 쉬는 때 /rename '참모-N · 별명'(데스크톱 renamesToSend)
    fn rename(&self, id: &str, nick: &str) -> Result<(), String>;
    /// 참모 제거 — claude stop(켜져 있으면) + rm(데스크톱 remove_session 과 같은 길). 목록에서 빠지고 대화 기록 파일은 맥에 남는다
    fn remove(&self, id: &str) -> Result<String, String>;
    /// 참모 재우기 — claude stop(데스크톱 끄기와 같은 길). 대화는 남아 다시 깨울 수 있다
    fn stop(&self, id: &str) -> Result<String, String>;
    fn routine(&self, name: &str, action: &str) -> Result<String, String>;
    /// 화면 파일 — 이름은 문지기가 이미 걸렀다("mobile.html" 또는 "assets/<안전한 이름>")
    fn asset(&self, path: &str) -> Option<(Vec<u8>, String)>;
    /// scripts/show 기록 꼬리 — 파일 길의 허용 집합 출처
    fn show_log(&self) -> String;
    fn data_dir(&self) -> PathBuf;
    /// 세션별 컨텍스트 파일 원문(<데이터>/ctx/*.json)
    fn ctx_files(&self) -> Vec<String>;
    /// 붙인 그림 저장(<데이터>/attach) → 저장한 경로
    fn attach(&self, ext: &str, bytes: &[u8]) -> Result<String, String>;
    /// 참모 프사 목록(<데이터>/avatars/*.json — 키 검사·형식 검사를 거친 것만)
    fn avatars(&self) -> serde_json::Value;
    /// 그 키의 프사 그림(경로는 키로 만든다) — (바이트, MIME)
    fn avatar_image(&self, key: &str) -> Option<(Vec<u8>, &'static str)>;
    /// 그림을 JPEG 로(max = 긴 변 px, None = 크기 그대로) — 맥 sips
    fn jpeg(&self, path: &Path, max: Option<u32>) -> Option<Vec<u8>>;
    /// QuickLook 첫 장 썸네일(JPEG, 긴 변 size) — PDF·HTML 시안·오피스·영상. 맥 qlmanage
    fn ql_thumb(&self, path: &Path, size: u32) -> Option<Vec<u8>>;
    /// `claude agents --json --all` 원문(꺼진 세션까지)
    fn sessions_all(&self) -> Result<String, String>;
    /// 꺼진 대화를 그대로 다시 켠다(respawn, 안 되면 이어 띄우기 — claude::resume_blocking). 폴더는 문지기가 HQ 로 골랐다
    fn resume(&self, cwd: &str, session_id: &str, id: &str) -> Result<String, String>;
    /// 새 참모를 띄운다 — 이름은 문지기가 지었고 첫 지시는 Backend 가 정한다(데스크톱 새 참모와 같은 '준비만 해 둬')
    fn spawn(&self, cwd: &str, name: &str) -> Result<String, String>;
    /// 대화 기록 꼬리 — 꺼진 참모가 마지막에 하던 일(sessionId → 꼬리 글)
    fn tails(&self, ids: &[String]) -> serde_json::Value;
    /// 떠 있는 세션 브라우저들 — 보기에 필요한 것만(포트·devtools 경로는 빼고)
    fn browser_lives(&self) -> serde_json::Value;
    /// 폰 푸시 — VAPID 공개 키(없으면 만든다) · 그 기기 구독 넣기·빼기(주소는 문지기가 이미 걸렀다)
    fn push_key(&self) -> Result<String, String>;
    fn push_subscribe(&self, device: &str, endpoint: &str, p256dh: &str, auth: &str) -> Result<(), String>;
    fn push_unsubscribe(&self, device: &str, endpoint: &str) -> Result<(), String>;
    /// 그 브라우저 화면 한 장 — since 보다 새 것이 있으면 [순번 8바이트 LE][jpeg], 없으면 빈 것(agent_browser::frame_bytes)
    fn browser_frame(&self, profile: &str, since: u64) -> Vec<u8>;
}

/// 이 서버 하나의 문지기 — 짝지은 기기들·받아 줄 주소(Host 헤더 값: "100.x.y.z:47123" 등)·쓰기를 받아 줄 출처(Origin).
/// 인증은 Authorization: Bearer <기기 토큰> 만 — 쿠키는 포트를 안 가려 같은 호스트의 다른 포트 서버(vite·Metro)로 샌다(2026-10-02 재검토).
/// 폰은 토큰을 localStorage(출처 = 스킴+호스트+포트)에 둔다
pub struct Gate {
    /// 짝지은 기기(토큰 해시) — 설정에서 끊으면 바로 막힌다
    pub devices: std::sync::Arc<crate::mobile_pair::Devices>,
    pub hosts: Vec<String>,
    /// "http://100.x.y.z:47123"·"https://<맥>.ts.net" 처럼 scheme 까지
    pub origins: Vec<String>,
    /// 세션별 마지막 멈춤 — 연타는 STOP_GAP 에 한 번(Esc 가 두 번 가면 쉬는 세션에 되감기 메뉴가 뜬다)
    pub stops: std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>,
    /// 폰이 보낸 글(클라이언트 id) — 같은 id 는 한 번만 치고, 뒤에서 친 결과를 send-status 로 알린다(10분 기억)
    pub sends: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, (std::time::Instant, SendState)>>>,
    /// html 시안 표(ticket) → (경로, 낸 때) — iframe 은 열쇠를 못 실어서 짧게 사는 표 주소로 연다(10분)
    pub tickets: std::sync::Mutex<std::collections::HashMap<String, (String, std::time::Instant)>>,
}

/// 시안 표가 사는 시간 — 껍데기 '처음부터'(새로 고침)도 그 안이면 된다
const TICKET_KEEP: Duration = Duration::from_secs(600);

#[derive(Clone, Debug, PartialEq)]
pub enum SendState {
    Typing,
    Done,
    Failed(String),
}

/// 보낸 글 기억 시간
const SEND_KEEP: Duration = Duration::from_secs(600);

/// 큰 몸통(그림)은 읽기 마감을 크기만큼 늘린다 — 느린 LTE(초당 64KB)로도 끝나게, 상한 3분.
/// 15초 안에 다 읽어야 해서 LTE 로 큰 사진이 'Load failed' 났다(2026-10-03)
pub fn body_deadline(base: std::time::Instant, len: usize) -> std::time::Instant {
    base + Duration::from_secs((len as u64).div_ceil(64_000).min(180))
}

/// 멈춤 연타 간격
pub const STOP_GAP: Duration = Duration::from_secs(2);
/// 되살리기·새 참모 연타 — 대화 하나·새로 만들기는 이만큼에 한 번(두 번 누르면 복사본·참모 둘이 뜬다)
pub const WAKE_GAP: Duration = Duration::from_secs(10);
/// 꼬리 읽기 한 번에 대화 몇 개까지
const MAX_TAILS: usize = 12;

#[derive(Debug, Default)]
pub struct Req {
    pub method: String,
    pub path: String,
    pub query: String,
    /// 이름은 소문자
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Req {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
    fn param(&self, name: &str) -> Option<&str> {
        self.query.split('&').find_map(|kv| kv.split_once('=').filter(|(k, _)| *k == name).map(|(_, v)| v))
    }
}

#[derive(Debug)]
pub struct Resp {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

impl Resp {
    fn new(status: u16, ctype: &str, body: impl Into<Vec<u8>>) -> Resp {
        Resp { status, headers: vec![("Content-Type", ctype.to_string())], body: body.into() }
    }
    fn text(status: u16, body: &str) -> Resp {
        Resp::new(status, "text/plain; charset=utf-8", body)
    }
    fn json(v: &serde_json::Value) -> Resp {
        Resp::new(200, "application/json; charset=utf-8", serde_json::to_vec(v).unwrap_or_default())
    }
    fn raw_json(s: String) -> Resp {
        Resp::new(200, "application/json; charset=utf-8", s)
    }
}

/// 길이가 같으면 끝까지 다 비교한다(어디서 틀렸는지 시간으로 새지 않게). 열쇠 길이는 비밀이 아니다(늘 64자)
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 대화 기록 이름 = Claude 대화 id(UUID 소문자 8-4-4-4-12). 이 모양이 아니면 파일을 찾지도 않는다(../ 등)
pub fn is_session_uuid(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() == 5
        && parts.iter().zip([8, 4, 4, 4, 12]).all(|(p, n)| p.len() == n && p.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// `claude agents --json` 의 짧은 id(16진 8자리)
pub fn is_short_id(s: &str) -> bool {
    s.len() == 8 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn is_routine_name(s: &str) -> bool {
    !s.is_empty() && s.chars().count() <= 64 && s.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

/// 화면 파일 이름 — assets/ 아래 한 단계, 점으로 시작 안 함, 영숫자·점·-·_ 만(퍼센트 인코딩도 거절)
fn asset_path(path: &str) -> Option<String> {
    if path == "/" || path == "/index.html" {
        return Some("mobile.html".into());
    }
    // 폰 푸시 서비스 워커(범위가 / 라 맨 위에 있어야 한다)·홈 화면 앱 manifest — vite public/ 에서 dist 맨 위로 온다
    if path == "/sw.js" || path == "/manifest.webmanifest" {
        return Some(path[1..].to_string());
    }
    let name = path.strip_prefix("/assets/")?;
    let ok = !name.is_empty() && !name.starts_with('.') && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'));
    ok.then(|| format!("assets/{name}"))
}

/// 짝지은 기기의 토큰(Bearer)인가 — 쿠키·마스터 열쇠는 안 받는다
fn authed(req: &Req, gate: &Gate) -> bool {
    device_of(req, gate).is_some()
}

/// 열쇠의 기기 id — 푸시 구독을 그 기기에 묶는다(기기를 끊으면 그 구독도 끝)
fn device_of(req: &Req, gate: &Gate) -> Option<String> {
    let now = std::time::SystemTime::now();
    req.header("authorization").and_then(|v| v.strip_prefix("Bearer ")).and_then(|t| gate.devices.check(t, now))
}

/// 쓰기 요청 — 출처가 같은 주소 목록이어야(없으면 거절), JSON 이어야(남의 페이지 form 은 JSON 을 못 보낸다)
fn same_origin_write(req: &Req, gate: &Gate) -> bool {
    let origin_ok = req.header("origin").is_some_and(|o| gate.origins.iter().any(|a| a == o));
    let json = req.header("content-type").is_some_and(|c| c.split(';').next().is_some_and(|t| t.trim().eq_ignore_ascii_case("application/json")));
    origin_ok && json
}

/// 그림 올리기 — 출처가 같고 image/* 여야(남의 페이지 form 은 image/* 를 못 보낸다 — 보내려면 미리 묻기(preflight)가 필요하고 CORS 는 안 연다)
/// 붙이기 — 출처가 같고 MIME 이 허용 목록(그림·pdf·zip·글·json)일 때만. 내용은 mobile_files::attach_kind 가 다시 본다
fn same_origin_upload(req: &Req, gate: &Gate) -> bool {
    let ct = req.header("content-type").map(|c| c.split(';').next().unwrap_or("").trim().to_ascii_lowercase()).unwrap_or_default();
    req.header("origin").is_some_and(|o| gate.origins.iter().any(|a| a == o))
        && (ct.starts_with("image/")
            || matches!(ct.as_str(), "application/pdf" | "application/zip" | "application/x-zip-compressed" | "application/octet-stream" | "text/plain" | "text/markdown" | "text/x-markdown" | "text/csv" | "application/json"))
}

/// 세션 목록에 컨텍스트를 붙인다 — 그 세션(sessionId) 의 ctx 파일 내용을 "ctx" 칸에 그대로(파싱은 domain/ctx.ts)
pub fn with_ctx(sessions_json: &str, ctx_files: &[String]) -> String {
    let Ok(serde_json::Value::Array(mut list)) = serde_json::from_str::<serde_json::Value>(sessions_json) else { return sessions_json.to_string() };
    let ctx: std::collections::HashMap<String, serde_json::Value> = ctx_files
        .iter()
        .filter_map(|t| serde_json::from_str::<serde_json::Value>(t).ok())
        .filter_map(|v| Some((v["sessionId"].as_str()?.to_string(), v)))
        .collect();
    for a in list.iter_mut() {
        if let Some(c) = a["sessionId"].as_str().and_then(|sid| ctx.get(sid)).cloned() {
            a["ctx"] = c;
        }
    }
    serde_json::to_string(&list).unwrap_or_else(|_| sessions_json.to_string())
}

/// 허용 집합 안의 파일 하나. thumb 면 그림을 긴 변 480px JPEG 로
/// 폰에 넘길 보여 준 목록 — 폰에 내보낼 수 있는 파일(shareable)과 웹 주소 줄만. 줄째 넘기면 CLAUDE.local.md 를 짚은
/// find 글(계정 줄)까지 폰에 갔다(2026-10-03)
fn phone_show_log(be: &dyn Backend) -> String {
    let rules = mobile_files::Rules { data_dir: be.data_dir(), hq_dir: be.hq_dir(), home: PathBuf::from(crate::platform::home()) };
    let mut out = String::new();
    for line in be.show_log().lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let Some(p) = v["path"].as_str() else { continue };
        let web = (p.starts_with("https://") || p.starts_with("http://")) && !p.chars().any(|c| c.is_whitespace() || c.is_control());
        if web || (Path::new(p).is_absolute() && mobile_files::shareable(Path::new(p), &rules)) {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// 글로 바꾼 문서(워드 → html) — 글자로 내고, 혹시 문서로 그려져도 스크립트 없이
fn text_resp(body: Vec<u8>) -> Resp {
    let mut r = Resp::new(200, "text/plain; charset=utf-8", body);
    r.headers.push(("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'".into()));
    r
}

fn file_resp(req: &Req, be: &dyn Backend) -> Resp {
    let Some(raw) = req.param("path") else { return Resp::text(400, "no path") };
    let Ok(path) = percent_encoding::percent_decode_str(raw).decode_utf8() else { return Resp::text(400, "bad path") };
    let allowed = mobile_files::allowed_files(&be.show_log(), &be.routines().unwrap_or_default(), &be.data_dir(), &be.hq_dir());
    let rules = mobile_files::Rules { data_dir: be.data_dir(), hq_dir: be.hq_dir(), home: PathBuf::from(crate::platform::home()) };
    // md 속 그림 — doc(보여 준 md)이 가리킨 그림이면 그 그림 하나만 목록에 더한다(링크·점·이름 거름은 pick 이 그대로)
    let allowed = match req.param("doc") {
        None => allowed,
        Some(d) => {
            let Ok(doc) = percent_encoding::percent_decode_str(d).decode_utf8() else { return Resp::text(400, "bad doc") };
            let Pick::Ok(_) = mobile_files::pick(&doc, &allowed, &rules) else { return Resp::text(403, "not allowed") };
            let Ok(text) = mobile_files::read_verified(&doc, mobile_files::MAX_TEXT_FILE) else { return Resp::text(403, "not allowed") };
            let refs = mobile_files::md_images(&String::from_utf8_lossy(&text), Path::new(doc.as_ref()));
            if !refs.iter().any(|p| p.as_os_str() == path.as_ref() as &str) {
                return Resp::text(403, "not allowed");
            }
            vec![path.to_string()]
        }
    };
    let real = match mobile_files::pick(&path, &allowed, &rules) {
        Pick::Ok(p) => p,
        Pick::Forbidden => return Resp::text(403, "not allowed"),
        Pick::NotFound => return Resp::text(404, "not found"),
    };
    let thumb = req.param("thumb") == Some("1");
    // 보기용(view=1) — 그림이 크거나 무거우면 JPEG 2560 으로 줄여서(mobile_files::view_plan), 원본은 view 없이
    let view = req.param("view") == Some("1");
    let kind = mobile_files::kind_of(&real);
    let ql = thumb && mobile_files::wants_quicklook(&real);
    // 워드는 글로(textutil → html, 폰이 거른다). 다른 오피스는 글로 못 바꾼다
    if req.param("as") == Some("html") {
        let ext = real.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
        if !matches!(ext.as_str(), "docx" | "doc") {
            return Resp::text(403, "not a word file");
        }
        let Ok(bytes) = mobile_files::read_verified(&path, mobile_files::MAX_BIN_FILE) else { return Resp::text(403, "not allowed") };
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let tmp = std::env::temp_dir().join(format!("chammo-mobile-doc-{}-{nanos}.{ext}", std::process::id()));
        let out = mobile_files::write_private_tmp(&tmp, &bytes).ok().and_then(|_| be.doc_html(&tmp));
        let _ = std::fs::remove_file(&tmp);
        return match out {
            Some(h) if mobile_files::secret_in(h.as_bytes()) => Resp::text(403, "secret inside"),
            Some(h) => text_resp(h.into_bytes()),
            None => Resp::text(502, "convert failed"),
        };
    }
    // 오피스·영상 원본은 안 낸다 — 오피스는 첫 장(QuickLook)·워드 글, 영상은 표 주소(/api/media, Range)
    if matches!(kind, Kind::Office | Kind::Video) && !ql {
        return Resp::text(403, "preview only");
    }
    let img = matches!(kind, Kind::Image(_) | Kind::Heic);
    let cap = if ql || (thumb && img) { mobile_files::MAX_THUMB_SRC } else if kind == Kind::Text { mobile_files::MAX_TEXT_FILE } else { mobile_files::MAX_BIN_FILE };
    // 고른 뒤 바꿔치기 막기 — 경로로 다시 열지 않고 확인된 fd 에서 읽는다(S9)
    let bytes = match mobile_files::read_verified(&path, cap) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => return Resp::text(413, "file too large"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Resp::text(404, "not found"),
        Err(_) => return Resp::text(403, "not allowed"),
    };
    // 코드·설정 글을 열면서 — 글 속에 키가 보이면 내보내지 않는다(이름 거름이 못 거르는 것)
    if kind == Kind::Text && mobile_files::secret_in(&bytes) {
        return Resp::text(403, "secret inside");
    }
    let dims = if img { mobile_files::image_dims(&bytes) } else { None };
    // 줄일 크기 — 썸네일(그림·QuickLook)은 size, 보기용은 view_plan, HEIC 원본은 그대로 크기로 JPEG 만
    let size = mobile_files::thumb_size(req.param("size"));
    let shrink: Option<Option<u32>> = if ql || (thumb && img) {
        Some(Some(size))
    } else if view && img {
        mobile_files::view_plan(&kind, bytes.len() as u64, dims).map(Some).or((kind == Kind::Heic).then_some(None))
    } else if kind == Kind::Heic {
        Some(None)
    } else {
        None
    };
    let mut r = if let Some(max) = shrink {
        // sips·qlmanage 는 경로로 읽으니 읽은 바이트를 600 임시 파일에 두고 그걸 바꾼다
        let ext = real.extension().and_then(|e| e.to_str()).unwrap_or("img");
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let tmp = std::env::temp_dir().join(format!("chammo-mobile-src-{}-{nanos}.{ext}", std::process::id()));
        let out = mobile_files::write_private_tmp(&tmp, &bytes).ok().and_then(|_| if ql { be.ql_thumb(&tmp, size) } else { be.jpeg(&tmp, max) });
        let _ = std::fs::remove_file(&tmp);
        match out {
            Some(b) => Resp::new(200, "image/jpeg", b),
            None => return Resp::text(502, "convert failed"),
        }
    } else {
        let ct = match kind {
            Kind::Image(ct) => ct,
            Kind::Pdf => "application/pdf",
            _ => "text/plain; charset=utf-8",
        };
        Resp::new(200, ct, bytes)
    };
    // 원본 크기 — 폰이 '실제 크기(1:1)' 배율과 원본을 더 받을지 정한다
    if let Some((w, h)) = dims {
        r.headers.push(("X-Image-Size", format!("{w}x{h}")));
    }
    // 혹시 브라우저가 문서로 그리더라도 스크립트·폼·같은 출처 권한 없이
    r.headers.push(("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'none'".into()));
    r
}

fn body<'a, T: Deserialize<'a>>(req: &'a Req) -> Result<T, Resp> {
    serde_json::from_slice(&req.body).map_err(|_| Resp::text(400, "bad body"))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PairBody {
    code: String,
    /// 홈 화면에 붙인 앱에서 짝짓기 — 설정 기기 목록에 '홈 화면 앱'으로(사파리와 저장 칸이 따로라 기기가 둘이 된다)
    #[serde(default)]
    home: bool,
    /// 이 저장 공간에 남아 있던 옛 열쇠 — 맞으면 새 줄 대신 그 줄의 열쇠를 바꿔 끼운다(같은 폰이 줄줄이 쌓이지 않게, 2026-10-05)
    #[serde(default)]
    prev: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SendBody {
    id: String,
    text: String,
    /// 폰 보낼 함의 말 id — 응답을 못 받고 다시 보내도 한 번만 친다
    #[serde(default)]
    cid: Option<String>,
}

fn cid_ok(c: &str) -> bool {
    !c.is_empty() && c.len() <= 64 && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InterruptBody {
    id: String,
}

#[derive(Deserialize)]
struct PinBody {
    #[serde(rename = "sessionId")]
    session_id: String,
    on: bool,
}

#[derive(Deserialize)]
struct RenameBody {
    id: String,
    nick: String,
}

#[derive(Deserialize)]
struct RoleBody {
    id: String,
    role: String,
}

/// 별명 다듬기(앱 domain/orchLabel cleanLabel 과 같게) — 제어 글자·빈칸 덩어리는 빈칸 하나, 앞뒤 빈칸 빼고 24자.
/// 별명 구분자 '·' 는 빼서 번호 칸('참모-N')을 흉내 내지 못하게
pub fn clean_nick(raw: &str) -> String {
    let t: String = raw.chars().map(|c| if c.is_control() || c == '·' { ' ' } else { c }).collect();
    t.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(24).collect()
}

#[derive(Deserialize)]
struct PathBody {
    path: String,
}

#[derive(Deserialize)]
struct CurationBody {
    path: String,
    text: String,
    #[serde(default)]
    store: serde_json::Value,
}

/// 보여 준 목록·지침서·starter 안이고 내보낼 수 있는 파일인가 — /api/file 과 같은 거름
fn pick_shown(be: &dyn Backend, path: &str) -> Pick {
    let allowed = mobile_files::allowed_files(&be.show_log(), &be.routines().unwrap_or_default(), &be.data_dir(), &be.hq_dir());
    let rules = mobile_files::Rules { data_dir: be.data_dir(), hq_dir: be.hq_dir(), home: PathBuf::from(crate::platform::home()) };
    mobile_files::pick(path, &allowed, &rules)
}

fn is_html(p: &str) -> bool {
    let l = p.to_ascii_lowercase();
    l.ends_with(".html") || l.ends_with(".htm")
}

/// 시안 앞에 넣는 것 — 불투명 출처라 막힌 localStorage 대신 이 페이지 동안만 쓰는 저장소(표시는 폰이 cur-state 로 받아 맥에 적고
/// 열 때 restore 로 되돌린다), 폰이 넓은 시안을 맞추게 크기 알림 — 옛 검토 시안은 넓은 덱이 안쪽 가로 스크롤(.decks)이라
/// 그 폭까지 알려 폰이 시안 전체를 그 폭으로 그리고 화면에 맞춘다, 두 손가락은 폰에 넘긴다(시안 안 핀치는 사파리 확대가 된다)
const HTML_SHIM: &str = r#"<script>(function(){try{window.localStorage.length}catch(e){var m={},s={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null}};Object.defineProperty(s,'length',{get:function(){return Object.keys(m).length}});try{Object.defineProperty(window,'localStorage',{value:s,configurable:true})}catch(_){}}
function size(){var d=document.documentElement,w=d.scrollWidth;[].forEach.call(document.querySelectorAll('.decks'),function(e){if(e.scrollWidth>e.clientWidth+4)w=Math.max(w,Math.min(4000,e.scrollWidth+d.clientWidth-e.clientWidth))});parent.postMessage({hodoc:'html-size',w:w,h:d.scrollHeight},'*')}
addEventListener('load',function(){size();setTimeout(size,600)});addEventListener('resize',size);
var d0=0;function g(t){return Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY)}
addEventListener('touchstart',function(e){if(e.touches.length===2)d0=g(e.touches)},{passive:true});
addEventListener('touchmove',function(e){if(e.touches.length===2&&d0){e.preventDefault();parent.postMessage({hodoc:'html-pinch',k:g(e.touches)/d0},'*')}},{passive:false});
addEventListener('touchend',function(e){if(d0&&e.touches.length<2){d0=0;parent.postMessage({hodoc:'html-pinch',done:true},'*')}});
})()</script>"#;

/// 시안 맨 앞 모양 — 아이폰은 넓은 페이지를 줄여 보일 때 글자만 멋대로 키워(text autosizing) 줄끼리 겹친다(2026-10-04 폰 겹침).
/// 시안이 직접 정한 값이 있으면 뒤에 오는 그게 이긴다. 원본 파일은 안 고친다(옛 시안 수백 개).
/// 검토 틀(design-curation)이 블록을 누르면 띄우는 고르기 창(.cur-pick)은 손가락으로 누르기 쉽게 44px, 메모 칸은 16px(작으면 아이폰이 확대) —
/// 틀이 뒤에서 같은 세기로 높이·글꼴을 정해 메모 칸은 html 을 붙여 세기를 올린다
const HTML_HEAD: &str = r#"<style>html{-webkit-text-size-adjust:100%;text-size-adjust:100%}@media (pointer:coarse){.cur-pick button{min-width:44px;min-height:44px}html .cur-pick input{height:44px;font-size:16px}}</style>"#;

/// `<name ...>` 여는 태그 끝 다음 자리 — `<head` 로 `<header>` 를 잡지 않게 이름 뒤 글자를 본다
fn tag_end(low: &str, name: &str) -> Option<usize> {
    let open = format!("<{name}");
    let mut from = 0;
    while let Some(i) = low[from..].find(&open).map(|i| from + i) {
        let after = i + open.len();
        if low[after..].chars().next().is_some_and(|c| c == '>' || c == '/' || c.is_ascii_whitespace()) {
            return low[after..].find('>').map(|j| after + j + 1);
        }
        from = after;
    }
    None
}

/// <head ...> 바로 뒤에 끼운다 — 시안 스크립트보다 먼저 돌아야 저장소가 갈린다. head 가 없으면 <html> 뒤, 그것도 없으면
/// doctype 뒤(doctype 앞에 무엇이 오면 쿼크 모드가 된다), 다 없으면 맨 앞
fn inject_shim(html: &str) -> String {
    let low = html.to_ascii_lowercase();
    let at = tag_end(&low, "head").or_else(|| tag_end(&low, "html")).or_else(|| tag_end(&low, "!doctype")).unwrap_or(0);
    format!("{}{HTML_HEAD}{HTML_SHIM}{}", &html[..at], &html[at..])
}

/// 표 주소로 시안 — 열쇠 없이(iframe 이 못 싣는다) 표만 본다. 응답은 sandbox allow-scripts(불투명 출처: 폰 열쇠·/api 에 못 닿음),
/// 바깥으로 보내기(connect) 금지, 같은 출처 틀에만
fn ticket_path(req: &Req, gate: &Gate) -> Option<String> {
    let mut m = gate.tickets.lock().unwrap_or_else(|e| e.into_inner());
    m.retain(|_, (_, at)| at.elapsed() < TICKET_KEEP);
    req.param("t").and_then(|t| m.get(t)).map(|(p, _)| p.clone())
}

fn new_ticket(gate: &Gate, path: &str) -> Option<String> {
    let t = crate::mobile_pair::random_hex(16).ok()?;
    let mut m = gate.tickets.lock().unwrap_or_else(|e| e.into_inner());
    m.retain(|_, (_, at)| at.elapsed() < TICKET_KEEP);
    m.insert(t.clone(), (path.to_string(), std::time::Instant::now()));
    Some(t)
}

/// 영상 한 번에 보내는 조각 — 느린 LTE 로도 쓰기 마감 안에
const MEDIA_CHUNK: u64 = 1024 * 1024;

/// 표 주소로 영상 — 열쇠 없이 표만(<video> 는 Bearer 를 못 싣는다), Range 로 1MB 씩(206)
fn media_page(req: &Req, gate: &Gate, be: &dyn Backend) -> Resp {
    let Some(path) = ticket_path(req, gate) else { return Resp::text(403, "bad ticket") };
    let kind = mobile_files::kind_of(Path::new(&path));
    if kind != Kind::Video || !matches!(pick_shown(be, &path), Pick::Ok(_)) {
        return Resp::text(403, "not allowed");
    }
    let Ok((_, total)) = mobile_files::open_verified(&path) else { return Resp::text(403, "not allowed") };
    let Some((start, end)) = mobile_files::parse_range(req.header("range"), total, MEDIA_CHUNK) else {
        let mut r = Resp::text(416, "bad range");
        r.headers.push(("Content-Range", format!("bytes */{total}")));
        return r;
    };
    let Ok((bytes, total)) = mobile_files::read_range_verified(&path, start, end) else { return Resp::text(403, "not allowed") };
    let ct = if path.to_ascii_lowercase().ends_with(".mov") { "video/quicktime" } else { "video/mp4" };
    let mut r = Resp::new(206, ct, bytes);
    r.headers.push(("Content-Range", format!("bytes {start}-{end}/{total}")));
    r.headers.push(("Accept-Ranges", "bytes".into()));
    r
}

fn html_page(req: &Req, gate: &Gate, be: &dyn Backend) -> Resp {
    let Some(path) = ticket_path(req, gate).filter(|p| is_html(p)) else { return Resp::text(403, "bad ticket") };
    let Pick::Ok(_) = pick_shown(be, &path) else { return Resp::text(403, "not allowed") };
    let Ok(bytes) = mobile_files::read_verified(&path, mobile_files::MAX_TEXT_FILE) else { return Resp::text(403, "not allowed") };
    if mobile_files::secret_in(&bytes) {
        return Resp::text(403, "secret inside");
    }
    let mut r = Resp::new(200, "text/html; charset=utf-8", inject_shim(&String::from_utf8_lossy(&bytes)).into_bytes());
    r.headers.push(("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src https://cdn.jsdelivr.net https://fonts.gstatic.com data:; img-src https: data: blob:; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'".into()));
    r.headers.push(("X-Frame-Options", "SAMEORIGIN".into()));
    r
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RespawnBody {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[derive(Deserialize)]
struct PushKeys {
    p256dh: String,
    auth: String,
}

/// 브라우저 PushSubscription.toJSON() 모양 — expirationTime 등 다른 칸은 무시
#[derive(Deserialize)]
struct PushSubBody {
    endpoint: String,
    #[serde(default)]
    keys: Option<PushKeys>,
}

/// base64url 한 덩이 — 길이 상한
fn b64url_ok(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'=')
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SpawnBody {
    nick: String,
    /// 맡은 일(비워도 됨) — 같은 번호를 다시 쓰면 옛 참모 것이 붙지 않게 늘 덮는다
    #[serde(default)]
    role: String,
}

/// 연타 막기 — 그 열쇠로 gap 안에 또 오면 false(오면 시각을 적는다). 멈춤과 같은 장부를 쓴다
fn once_per(gate: &Gate, key: &str, gap: Duration) -> bool {
    let mut stops = gate.stops.lock().unwrap_or_else(|e| e.into_inner());
    let now = std::time::Instant::now();
    if stops.get(key).is_some_and(|t| now.duration_since(*t) < gap) {
        return false;
    }
    stops.insert(key.to_string(), now);
    true
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RoutineBody {
    name: String,
    action: String,
}

/// 세션 목록에서 그 짧은 id 의 cwd — 없으면 None
fn session_name(sessions_json: &str, id: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(sessions_json).ok()?;
    v.as_array()?.iter().find(|a| a["id"] == id).and_then(|a| a["name"].as_str()).filter(|n| !n.trim().is_empty()).map(str::to_string)
}

fn session_cwd(sessions_json: &str, id: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(sessions_json).ok()?;
    v.as_array()?.iter().find(|a| a["id"] == id).map(|a| a["cwd"].as_str().unwrap_or("").to_string())
}

/// 그 세션이 지금 턴을 도는 중인가 — 앱(domain/session parseAgents)과 같은 판단: state done 이면 끝남,
/// status(busy/idle)가 있으면 그게 진짜 상태(state working + status idle = 입력 기다림), 없으면 state
fn session_busy(sessions_json: &str, id: &str) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(sessions_json) else { return false };
    let Some(a) = v.as_array().and_then(|l| l.iter().find(|a| a["id"] == id)) else { return false };
    let state = a["state"].as_str().unwrap_or("");
    state != "done" && a["status"].as_str().map_or(state == "working", |st| st == "busy")
}

fn same_dir(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
    !a.is_empty() && norm(a) == norm(b)
}

/// 문지기 — 순서: 주소(Host) → 화면 파일·열쇠 주소 → 열쇠 → 길(허용 목록) → 쓰기면 출처
pub fn handle(req: &Req, gate: &Gate, be: &dyn Backend) -> Resp {
    // DNS 리바인딩: 남의 이름으로 이 포트에 온 요청은 무엇이든 거절
    if !req.header("host").is_some_and(|h| gate.hosts.iter().any(|a| a == h)) {
        return Resp::text(403, "bad host");
    }
    // 인터넷(tailscale funnel)에서 온 요청 — 누가 나중에 funnel 을 켜도 여기서 막는다
    if req.header("tailscale-funnel-request").is_some() {
        return Resp::text(403, "funnel");
    }
    let is_get = req.method == "GET" || req.method == "HEAD";
    if is_get && !req.path.starts_with("/api/") {
        // 화면 껍데기(html·js·css)는 열쇠 없이 — 비밀이 없다. 짝짓기 주소(?pair=)도 껍데기만 주고, 코드는 페이지가 POST /api/pair 로 낸다. 데이터는 전부 /api 뒤
        return match asset_path(&req.path).and_then(|p| be.asset(&p)) {
            Some((bytes, ctype)) => Resp::new(200, &ctype, bytes),
            None => Resp::text(404, "not found"),
        };
    }
    // 짝짓기 — 코드가 열쇠라 토큰 없이. 같은 출처 JSON 만, 토큰은 응답 몸으로(쿠키 없음) → 페이지가 localStorage 에
    if req.path == "/api/pair" {
        if req.method != "POST" {
            return Resp::text(405, "method not allowed");
        }
        if !same_origin_write(req, gate) {
            return Resp::text(403, "bad origin");
        }
        let b: PairBody = match body(req) { Ok(b) => b, Err(r) => return r };
        let name = crate::mobile_pair::device_name(req.header("user-agent").unwrap_or(""));
        let p = crate::mobile_pair::Pairing { name: &name, home: b.home, prev: b.prev.as_deref() };
        return match gate.devices.pair_with(&b.code, &p, std::time::SystemTime::now()) {
            Some(token) => Resp::json(&serde_json::json!({ "token": token })),
            None => Resp::text(401, "짝짓기 코드가 틀렸거나 10분이 지났어요 — 맥 설정 > 모바일에서 QR 을 새로 만들어 주세요"),
        };
    }
    // html 시안 — 표가 열쇠(iframe 은 Bearer 를 못 싣는다)
    if req.path == "/api/html" {
        return if is_get { html_page(req, gate, be) } else { Resp::text(405, "method not allowed") };
    }
    if req.path == "/api/media" {
        return if is_get { media_page(req, gate, be) } else { Resp::text(405, "method not allowed") };
    }
    if !authed(req, gate) {
        return Resp::text(401, "no key");
    }
    // 홈 화면 앱 연결 코드 — 이미 연결된 기기(열쇠)가 새 일회용 코드를 받는다. 홈 화면 앱은 QR(카메라 → 사파리)로 못 열려서
    // 사파리에서 코드를 복사해 앱에 붙여 넣는다(2026-10-03 사용자 "PWA 하려면 어떻게 해?"). 코드 규칙은 QR 과 같다(10분·한 번·새 코드면 옛 코드 죽음)
    if req.path == "/api/pair-code" {
        if req.method != "POST" {
            return Resp::text(405, "method not allowed");
        }
        if !same_origin_write(req, gate) {
            return Resp::text(403, "bad origin");
        }
        let device = device_of(req, gate).unwrap_or_default();
        if !once_per(gate, &format!("pair-code:{device}"), WAKE_GAP) {
            return Resp::text(429, "too soon");
        }
        let now = std::time::SystemTime::now();
        // 낸 기기를 코드에 붙여 둔다 — 이 코드로 붙은 홈 화면 앱은 그 폰 아래로 묶인다
        return match gate.devices.new_code_from(&device, now) {
            Ok(code) => {
                let expires = (now + crate::mobile_pair::PAIR_TTL).duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                Resp::json(&serde_json::json!({ "code": code, "expires": expires }))
            }
            Err(e) => Resp::text(502, &e.to_string()),
        };
    }
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/api/env") => Resp::json(&be.env()),
        ("GET", "/api/sessions") => match be.sessions() {
            Ok(s) => Resp::raw_json(with_ctx(&s, &be.ctx_files())),
            Err(e) => Resp::text(502, &e),
        },
        ("GET", "/api/transcript") => {
            let Some(id) = req.param("id").filter(|s| is_session_uuid(s)) else { return Resp::text(400, "bad session id") };
            // 위로 올렸을 때 앞 대화(before=첫 줄 자리)
            if let Some(b) = req.param("before") {
                let Ok(before) = b.parse::<u64>() else { return Resp::text(400, "bad before") };
                return Resp::json(&be.transcript_before(id, before));
            }
            let from = match req.param("from") {
                None => None,
                Some(f) => match f.parse::<u64>() {
                    Ok(n) => Some(n),
                    Err(_) => return Resp::text(400, "bad from"),
                },
            };
            Resp::json(&be.transcript(id, from))
        }
        ("GET", "/api/tasks") => Resp::new(200, "text/plain; charset=utf-8", be.tasks()),
        ("GET", "/api/routines") => match be.routines() {
            Ok(s) => Resp::raw_json(s),
            Err(e) => Resp::text(502, &format!("예약 목록을 못 읽었어요: {e}")),
        },
        ("GET", "/api/usage") => Resp::raw_json(be.usage()),
        ("GET", "/api/file") => file_resp(req, be),
        // 대시보드 파일 카드 — 누가 무엇을 보여 줬나(scripts/show 기록 꼬리). 파일 내용은 /api/file 이 따로 거른다
        // 참모 프사 — 데스크톱에서 바꾼 모양·그림을 폰에도. 그림은 키로만(경로를 받지 않는다)
        ("GET", "/api/avatars") => Resp::json(&be.avatars()),
        ("GET", "/api/avatar-image") => {
            let key = req.param("key").and_then(|k| percent_encoding::percent_decode_str(k).decode_utf8().ok()).map(|k| k.into_owned());
            let Some(key) = key.filter(|k| crate::avatar::safe_key(k).is_ok_and(|ok| &ok == k)) else { return Resp::text(400, "bad key") };
            match be.avatar_image(&key) {
                Some((bytes, ct)) => {
                    let mut r = Resp::new(200, ct, bytes);
                    r.headers.push(("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'".into()));
                    r
                }
                None => Resp::text(404, "not found"),
            }
        }
        ("GET", "/api/pins") => match crate::orch_pins::read_pins(&be.data_dir()) {
            Ok(v) => Resp::json(&serde_json::json!(v)),
            Err(e) => Resp::text(502, &e),
        },
        // 참모 맡은 일 — 기본 이름별(데스크톱과 같은 orch-roles.json)
        ("GET", "/api/roles") => match crate::orch_roles::read_roles(&be.data_dir()) {
            Ok(m) => Resp::json(&serde_json::json!(m)),
            Err(e) => Resp::text(502, &e),
        },
        ("GET", "/api/curation-state") => {
            let Some(p) = req.param("path").and_then(|p| percent_encoding::percent_decode_str(p).decode_utf8().ok()) else { return Resp::text(400, "no path") };
            if !is_html(&p) || !matches!(pick_shown(be, &p), Pick::Ok(_)) {
                return Resp::text(403, "not allowed");
            }
            Resp::new(200, "application/json; charset=utf-8", be.read_curation_state(&p).into_bytes())
        }
        ("GET", "/api/shows") => Resp::new(200, "text/plain; charset=utf-8", phone_show_log(be)),
        // 꺼진 참모 — HQ 폴더의 꺼진 대화만(프로젝트 세션은 참모가 다룬다). 파싱은 화면 domain/stopped
        ("GET", "/api/stopped") => {
            let (all, live) = match (be.sessions_all(), be.sessions()) {
                (Ok(a), Ok(l)) => (a, l),
                (Err(e), _) | (_, Err(e)) => return Resp::text(502, &e),
            };
            Resp::json(&serde_json::Value::Array(crate::mobile_wake::hq_stopped(&all, &live, &be.hq_dir())))
        }
        // 폰이 보낸 글을 뒤에서 쳤나 — typing·done·failed(이유)·unknown(모름: 맥이 다시 켜졌거나 안 받음)
        ("GET", "/api/send-status") => {
            let Some(c) = req.param("cid").filter(|c| cid_ok(c)) else { return Resp::text(400, "bad cid") };
            let m = gate.sends.lock().unwrap_or_else(|e| e.into_inner());
            Resp::json(&match m.get(c).map(|(_, s)| s) {
                Some(SendState::Typing) => serde_json::json!({ "state": "typing" }),
                Some(SendState::Done) => serde_json::json!({ "state": "done" }),
                Some(SendState::Failed(e)) => serde_json::json!({ "state": "failed", "error": e }),
                None => serde_json::json!({ "state": "unknown" }),
            })
        }
        // 세션 브라우저 보기 — 읽기만(누르기·치기 없음). 화면은 지금 떠 있는 프로필만
        ("GET", "/api/browsers") => Resp::json(&be.browser_lives()),
        ("GET", "/api/browser-frame") => {
            let Some(profile) = req.param("profile").filter(|p| !p.is_empty() && p.len() <= 64 && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')) else {
                return Resp::text(400, "bad profile");
            };
            let since = match req.param("since").map(str::parse::<u64>) {
                None => 0,
                Some(Ok(n)) => n,
                Some(Err(_)) => return Resp::text(400, "bad since"),
            };
            if !be.browser_lives().as_array().is_some_and(|l| l.iter().any(|x| x["profile"] == profile)) {
                return Resp::text(404, "no such browser");
            }
            Resp::new(200, "application/octet-stream", be.browser_frame(profile, since))
        }
        // 대화 기록 꼬리 — 세션 번호(UUID)로만, 한 번에 몇 개까지(/api/transcript 와 같은 범위)
        ("GET", "/api/tails") => {
            let ids: Vec<String> = req.param("ids").unwrap_or("").split(',').filter(|s| !s.is_empty()).map(str::to_string).collect();
            if ids.is_empty() || ids.len() > MAX_TAILS || !ids.iter().all(|s| is_session_uuid(s)) {
                return Resp::text(400, "bad ids");
            }
            Resp::json(&be.tails(&ids))
        }
        ("POST", "/api/attach") if !same_origin_upload(req, gate) => Resp::text(403, "bad origin"),
        ("POST", "/api/attach") => {
            // 형식은 앞 바이트·MIME·이름 확장자로(attach_kind) — 이름은 힌트로만, 저장 이름은 서버가. HEIC 는 Claude 가 못 읽으니 JPEG 로 바꿔 저장
            let name = req.param("name").and_then(|n| percent_encoding::percent_decode_str(n).decode_utf8().ok()).map(|c| c.into_owned()).unwrap_or_default();
            let mime = req.header("content-type").unwrap_or("");
            let Some(ext) = mobile_files::attach_kind(&req.body, mime, &name) else { return Resp::text(415, "not an allowed file") };
            let saved = if ext == "heic" {
                let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
                let tmp = be.data_dir().join(format!("attach-{}-{nanos}.heic", std::process::id()));
                let jpg = std::fs::write(&tmp, &req.body).ok().and_then(|_| be.jpeg(&tmp, None));
                let _ = std::fs::remove_file(&tmp);
                match jpg {
                    Some(b) => be.attach("jpg", &b),
                    None => return Resp::text(502, "convert failed"),
                }
            } else {
                be.attach(ext, &req.body)
            };
            match saved {
                Ok(path) => Resp::json(&serde_json::json!({ "path": path })),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("POST", "/api/send" | "/api/routine" | "/api/interrupt" | "/api/respawn" | "/api/spawn" | "/api/stop" | "/api/push-subscribe" | "/api/push-unsubscribe" | "/api/html-ticket" | "/api/curation" | "/api/media-ticket" | "/api/open-mac" | "/api/direct-answer" | "/api/remove" | "/api/rename" | "/api/pin" | "/api/role") if !same_origin_write(req, gate) => Resp::text(403, "bad origin"),
        // html 시안 표 — 보여 준 html 만, 글 속 비밀은 안 낸다
        ("POST", "/api/html-ticket") => {
            let b: PathBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !is_html(&b.path) {
                return Resp::text(400, "not html");
            }
            match pick_shown(be, &b.path) {
                Pick::Ok(_) => {}
                Pick::Forbidden => return Resp::text(403, "not allowed"),
                Pick::NotFound => return Resp::text(404, "not found"),
            }
            match mobile_files::read_verified(&b.path, mobile_files::MAX_TEXT_FILE) {
                Ok(bytes) if mobile_files::secret_in(&bytes) => return Resp::text(403, "secret inside"),
                Ok(_) => {}
                Err(_) => return Resp::text(403, "not allowed"),
            }
            let Some(t) = new_ticket(gate, &b.path) else { return Resp::text(500, "no random") };
            Resp::json(&serde_json::json!({ "url": format!("/api/html?t={t}") }))
        }
        // 영상 표 — 보여 준 영상만, 크기도 같이(폰이 20MB 넘으면 LTE 확인)
        ("POST", "/api/media-ticket") => {
            let b: PathBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if mobile_files::kind_of(Path::new(&b.path)) != Kind::Video {
                return Resp::text(400, "not video");
            }
            match pick_shown(be, &b.path) {
                Pick::Ok(_) => {}
                Pick::Forbidden => return Resp::text(403, "not allowed"),
                Pick::NotFound => return Resp::text(404, "not found"),
            }
            let Ok((_, size)) = mobile_files::open_verified(&b.path) else { return Resp::text(403, "not allowed") };
            let Some(t) = new_ticket(gate, &b.path) else { return Resp::text(500, "no random") };
            Resp::json(&serde_json::json!({ "url": format!("/api/media?t={t}"), "size": size }))
        }
        // 맥에서 열기 — 폰에서 못 보는 오피스·영상을 맥 앱으로(보여 준 것만, 3초에 한 번)
        ("POST", "/api/open-mac") => {
            let b: PathBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !matches!(pick_shown(be, &b.path), Pick::Ok(_)) || !open_mac_kind(&b.path) {
                return Resp::text(403, "not allowed");
            }
            if !once_per(gate, "open-mac", Duration::from_secs(3)) {
                return Resp::text(429, "too soon");
            }
            match be.open_on_mac(&b.path) {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(502, &e),
            }
        }
        // 시안 검토 표시 — 데스크톱과 같은 curation/ 에(참모는 보내기 전에도 여기서 읽는다)
        ("POST", "/api/curation") => {
            let b: CurationBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !is_html(&b.path) || !matches!(pick_shown(be, &b.path), Pick::Ok(_)) {
                return Resp::text(403, "not allowed");
            }
            match be.save_curation(&b.path, &b.text, &b.store.to_string()) {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(502, &e),
            }
        }
        // 폰 푸시 — 공개 키 받기, 이 기기 구독 넣기·빼기. 구독 주소는 알려진 푸시 서버 https 만(push::endpoint_ok)
        ("GET", "/api/push-key") => match be.push_key() {
            Ok(k) => Resp::json(&serde_json::json!({ "key": k })),
            Err(e) => Resp::text(502, &e),
        },
        ("POST", "/api/push-subscribe") => {
            let b: PushSubBody = match body(req) { Ok(b) => b, Err(r) => return r };
            let Some(keys) = b.keys.filter(|k| b64url_ok(&k.p256dh, 120) && b64url_ok(&k.auth, 40)) else { return Resp::text(400, "bad keys") };
            if !crate::push::endpoint_ok(&b.endpoint) {
                return Resp::text(400, "bad endpoint");
            }
            let Some(device) = device_of(req, gate) else { return Resp::text(401, "no key") };
            match be.push_subscribe(&device, &b.endpoint, &keys.p256dh, &keys.auth) {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("POST", "/api/push-unsubscribe") => {
            let b: PushSubBody = match body(req) { Ok(b) => b, Err(r) => return r };
            let Some(device) = device_of(req, gate) else { return Resp::text(401, "no key") };
            match be.push_unsubscribe(&device, &b.endpoint) {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(502, &e),
            }
        }
        // 참모 재우기 — HQ 폴더 세션(참모)만. 하위 세션은 폰에서 못 끈다(참모가 starter 갱신을 시킨 뒤에 끈다) — 404. 같은 참모는 10초에 한 번
        // 참모 제거 — HQ 폴더 참모만(켜진 것·꺼진 것 다), 하위 세션은 404. 켜져 있으면 끄고 지운다. 같은 참모는 10초에 한 번
        // 참모 고정 — 대화 id 를 고정한 순서대로(같은 출처 문지기 뒤)
        ("POST", "/api/pin") => {
            let b: PinBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !is_session_uuid(&b.session_id) {
                return Resp::text(400, "bad session id");
            }
            match crate::orch_pins::set_pin(&be.data_dir(), &b.session_id, b.on) {
                Ok(v) => Resp::json(&serde_json::json!(v)),
                Err(e) => Resp::text(502, &e),
            }
        }
        // 참모 별명 — 켜진 HQ 참모만, 별명만(앞 번호는 맥 앱이 원래 이름에서). 받아서 넘기고 202 — /rename 은 쉬는 때 맥 앱이 보낸다
        ("POST", "/api/rename") => {
            let b: RenameBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !is_short_id(&b.id) {
                return Resp::text(400, "bad id");
            }
            let sessions = match be.sessions() { Ok(s) => s, Err(e) => return Resp::text(502, &e) };
            if !session_cwd(&sessions, &b.id).is_some_and(|cwd| same_dir(&cwd, &be.hq_dir())) {
                return Resp::text(404, "no such assistant");
            }
            match be.rename(&b.id, &clean_nick(&b.nick)) {
                Ok(()) => Resp::new(202, "application/json", br#"{"ok":true}"#.to_vec()),
                Err(e) => Resp::text(502, &e),
            }
        }
        // 참모 맡은 일 — 켜진 HQ 참모만. 열쇠(기본 이름)는 폰이 주는 게 아니라 맥이 그 세션 이름에서 뽑는다
        ("POST", "/api/role") => {
            let b: RoleBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !is_short_id(&b.id) {
                return Resp::text(400, "bad id");
            }
            let sessions = match be.sessions() { Ok(s) => s, Err(e) => return Resp::text(502, &e) };
            if !session_cwd(&sessions, &b.id).is_some_and(|cwd| same_dir(&cwd, &be.hq_dir())) {
                return Resp::text(404, "no such assistant");
            }
            let Some(name) = session_name(&sessions, &b.id) else { return Resp::text(404, "no such assistant") };
            match crate::orch_roles::set_role(&be.data_dir(), &name, &b.role, crate::orch_roles::now_ms()) {
                Ok(m) => Resp::json(&serde_json::json!(m)),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("POST", "/api/remove") => {
            let b: InterruptBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !is_short_id(&b.id) {
                return Resp::text(400, "bad id");
            }
            let all = match be.sessions_all() { Ok(s) => s, Err(e) => return Resp::text(502, &e) };
            if !session_cwd(&all, &b.id).is_some_and(|cwd| same_dir(&cwd, &be.hq_dir())) {
                return Resp::text(404, "no such assistant");
            }
            if !once_per(gate, &format!("remove:{}", b.id), WAKE_GAP) {
                return Resp::text(429, "too soon");
            }
            match be.remove(&b.id) {
                Ok(_) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("POST", "/api/stop") => {
            let b: InterruptBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !is_short_id(&b.id) {
                return Resp::text(400, "bad id");
            }
            let sessions = match be.sessions() { Ok(s) => s, Err(e) => return Resp::text(502, &e) };
            if !session_cwd(&sessions, &b.id).is_some_and(|cwd| same_dir(&cwd, &be.hq_dir())) {
                return Resp::text(404, "no such assistant");
            }
            if !once_per(gate, &format!("stop:{}", b.id), WAKE_GAP) {
                return Resp::text(429, "too soon");
            }
            match be.stop(&b.id) {
                Ok(_) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(502, &e),
            }
        }
        // 꺼진 참모 다시 켜기 — HQ 폴더의 꺼진 대화만, 같은 대화는 10초에 한 번
        ("POST", "/api/respawn") => {
            let b: RespawnBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !is_session_uuid(&b.session_id) {
                return Resp::text(400, "bad session id");
            }
            let (all, live) = match (be.sessions_all(), be.sessions()) {
                (Ok(a), Ok(l)) => (a, l),
                (Err(e), _) | (_, Err(e)) => return Resp::text(502, &e),
            };
            let hq = be.hq_dir();
            let Some(off) = crate::mobile_wake::hq_stopped(&all, &live, &hq).into_iter().find(|a| a["sessionId"] == b.session_id.as_str()) else {
                return Resp::text(404, "no such stopped assistant");
            };
            if !once_per(gate, &format!("respawn:{}", b.session_id), WAKE_GAP) {
                return Resp::text(429, "too soon");
            }
            let id = off["id"].as_str().filter(|i| is_short_id(i)).unwrap_or("");
            match be.resume(&hq, &b.session_id, id) {
                Ok(out) => Resp::json(&serde_json::json!({ "ok": true, "out": out })),
                Err(e) => Resp::text(502, &e),
            }
        }
        // 새 참모 — 폰은 별명만, 이름(번호)·폴더(HQ)·첫 지시는 서버가. 새로 만들기는 10초에 하나
        ("POST", "/api/spawn") => {
            let b: SpawnBody = match body(req) { Ok(b) => b, Err(r) => return r };
            let Some(nick) = crate::mobile_wake::clean_nick(&b.nick) else { return Resp::text(400, "bad name") };
            let all = match be.sessions_all() { Ok(a) => a, Err(e) => return Resp::text(502, &e) };
            let hq = be.hq_dir();
            let names = crate::mobile_wake::hq_names(&all, &hq);
            if crate::mobile_wake::nick_taken(&names, &nick) {
                return Resp::text(409, "name taken");
            }
            let base = be.env()["assistantName"].as_str().unwrap_or("").trim().to_string();
            if base.is_empty() {
                return Resp::text(502, "no assistant name");
            }
            if !once_per(gate, "spawn", WAKE_GAP) {
                return Resp::text(429, "too soon");
            }
            let name = crate::mobile_wake::spawn_name(&base, &names, &nick);
            // 맡은 일·태어난 때를 먼저 적는다 — 꺼진 참모를 지워 번호가 다시 쓰이면 옛 맡은 일·기록이 새 참모에 붙었다(2026-10-04 QA ⑥).
            // 못 적어도(손으로 깨뜨린 파일) 참모는 띄운다 — 맡은 일은 나중에 다시 적으면 된다
            let _ = crate::orch_roles::start_role(&be.data_dir(), &name, &b.role, crate::orch_roles::now_ms());
            match be.spawn(&hq, &name) {
                Ok(_) => Resp::json(&serde_json::json!({ "ok": true, "name": name })),
                Err(e) => Resp::text(502, &e),
            }
        }
        // 직접 답하기 카드(2026-10-03) — 읽기, 그리고 사람이 폰 카드에서 누른 답. 데스크톱과 같은 문지기(direct::answer: 이미 답함·지난 질문·꺼진 세션 거절)
        ("GET", "/api/direct") => Resp::new(200, "text/plain; charset=utf-8", be.direct_log()),
        ("POST", "/api/direct-answer") => {
            #[derive(serde::Deserialize)]
            struct B {
                id: String,
                pick: crate::direct::Pick,
            }
            let b: B = match body(req) { Ok(b) => b, Err(r) => return r };
            if b.id.len() != 8 || !b.id.chars().all(|c| c.is_ascii_hexdigit()) {
                return Resp::text(400, "bad id");
            }
            match be.direct_answer(&b.id, &b.pick) {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(409, &e),
            }
        }
        ("POST", "/api/send") => {
            let mut b: SendBody = match body(req) { Ok(b) => b, Err(r) => return r };
            // 글은 TUI 입력칸에 키처럼 쳐진다 — ESC·Ctrl+C·DEL 같은 제어 문자는 빼고 줄바꿈·탭만 둔다
            b.text.retain(|c| !c.is_control() || c == '\n' || c == '\t');
            if !is_short_id(&b.id) || b.cid.as_deref().is_some_and(|c| !cid_ok(c)) {
                return Resp::text(400, "bad id");
            }
            if b.text.trim().is_empty() || b.text.chars().count() > MAX_TEXT {
                return Resp::text(400, "bad text");
            }
            // 보내기는 비서(HQ 폴더에서 도는 세션)에게만 — 하위 세션은 비서가 조종한다
            let sessions = match be.sessions() { Ok(s) => s, Err(e) => return Resp::text(502, &e) };
            match session_cwd(&sessions, &b.id) {
                Some(cwd) if same_dir(&cwd, &be.hq_dir()) => {
                    // 폰에서 보냈다는 표시 — 훅(scripts/voice-hint)이 읽어 참모에게 '사용자은 지금 폰' 을 알린다(2026-10-03 사용자).
                    // 보내기 전에 남긴다(세션이 지시를 받는 순간 훅이 돈다). 글 내용은 안 남긴다
                    let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                    let dir = be.data_dir();
                    if dir.is_absolute() { let _ = std::fs::write(dir.join("mobile-sent.json"), serde_json::json!({ "id": b.id, "at": at }).to_string()); }
                    // 같은 말을 다시 보냈으면(응답을 못 받은 폰) 치는 중이거나 쳤으면 무시, 실패했으면 다시
                    let now = std::time::Instant::now();
                    if let Some(c) = &b.cid {
                        let mut m = gate.sends.lock().unwrap_or_else(|e| e.into_inner());
                        m.retain(|_, (t, _)| now.duration_since(*t) < SEND_KEEP);
                        if matches!(m.get(c), Some((_, SendState::Typing | SendState::Done))) {
                            return Resp::json(&serde_json::json!({ "ok": true, "dup": true }));
                        }
                        m.insert(c.clone(), (now, SendState::Typing));
                    }
                    let (sends, cid) = (gate.sends.clone(), b.cid.clone());
                    be.send_later(&b.id, &b.text, Box::new(move |r| {
                        if let Some(c) = cid {
                            let st = match r { Ok(()) => SendState::Done, Err(e) => SendState::Failed(e) };
                            sends.lock().unwrap_or_else(|e| e.into_inner()).insert(c, (std::time::Instant::now(), st));
                        }
                    }));
                    Resp::new(202, "application/json", serde_json::json!({ "ok": true, "queued": true }).to_string())
                }
                Some(_) => Resp::text(403, "not an assistant session"),
                None => Resp::text(404, "no such session"),
            }
        }
        ("POST", "/api/interrupt") => {
            let b: InterruptBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !is_short_id(&b.id) {
                return Resp::text(400, "bad id");
            }
            // /api/send 와 같은 범위 — 비서(HQ 폴더에서 도는 세션)만. 일하는 중일 때만(쉴 때 Esc 는 되감기 메뉴)
            let sessions = match be.sessions() { Ok(s) => s, Err(e) => return Resp::text(502, &e) };
            match session_cwd(&sessions, &b.id) {
                Some(cwd) if same_dir(&cwd, &be.hq_dir()) => {}
                Some(_) => return Resp::text(403, "not an assistant session"),
                None => return Resp::text(404, "no such session"),
            }
            if !session_busy(&sessions, &b.id) {
                return Resp::text(409, "not working");
            }
            {
                let mut stops = gate.stops.lock().unwrap_or_else(|e| e.into_inner());
                let now = std::time::Instant::now();
                if stops.get(&b.id).is_some_and(|t| now.duration_since(*t) < STOP_GAP) {
                    return Resp::text(429, "too soon");
                }
                stops.insert(b.id.clone(), now);
            }
            match be.interrupt(&b.id) {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("POST", "/api/routine") => {
            let b: RoutineBody = match body(req) { Ok(b) => b, Err(r) => return r };
            // 지우기(remove)는 폰에서 안 연다 — 실행·일시정지·다시 켜기만
            if !matches!(b.action.as_str(), "run" | "pause" | "resume") || !is_routine_name(&b.name) {
                return Resp::text(400, "bad routine");
            }
            let listed: serde_json::Value = serde_json::from_str(&be.routines().unwrap_or_default()).unwrap_or_default();
            if !listed.as_array().is_some_and(|a| a.iter().any(|r| r["name"] == b.name.as_str())) {
                return Resp::text(404, "no such routine");
            }
            match be.routine(&b.name, &b.action) {
                Ok(out) => Resp::json(&serde_json::json!({ "ok": true, "out": out })),
                Err(e) => Resp::text(400, &e),
            }
        }
        (_, "/api/env" | "/api/sessions" | "/api/transcript" | "/api/tasks" | "/api/routines" | "/api/usage" | "/api/file" | "/api/shows" | "/api/avatars" | "/api/avatar-image" | "/api/send" | "/api/attach" | "/api/routine" | "/api/interrupt" | "/api/stopped" | "/api/tails" | "/api/respawn" | "/api/spawn" | "/api/browsers" | "/api/browser-frame" | "/api/push-key" | "/api/push-subscribe" | "/api/push-unsubscribe" | "/api/send-status" | "/api/stop" | "/api/html-ticket" | "/api/curation" | "/api/curation-state" | "/api/media-ticket" | "/api/open-mac" | "/api/direct" | "/api/direct-answer" | "/api/remove" | "/api/rename" | "/api/pin" | "/api/pins" | "/api/role" | "/api/roles") => {
            Resp::text(405, "method not allowed")
        }
        _ => Resp::text(404, "not found"),
    }
}

/// 읽기마다 남은 시간을 거는 읽기 — 요청 하나 전체 마감(한 글자씩 흘리는 연결이 자리를 오래 못 잡게)
pub trait TimedRead: Read {
    fn set_timeout(&mut self, d: Duration);
}
impl TimedRead for TcpStream {
    fn set_timeout(&mut self, d: Duration) {
        let _ = self.set_read_timeout(Some(d.max(Duration::from_millis(1))));
    }
}
impl TimedRead for std::io::Cursor<Vec<u8>> {
    fn set_timeout(&mut self, _: Duration) {}
}

/// 요청 하나 전체 마감
pub const REQ_DEADLINE: Duration = Duration::from_secs(15);

fn read_more(s: &mut impl TimedRead, deadline: std::time::Instant, chunk: &mut [u8]) -> Result<usize, Resp> {
    let left = deadline.saturating_duration_since(std::time::Instant::now());
    if left.is_zero() {
        return Err(Resp::text(408, "request timeout"));
    }
    s.set_timeout(left);
    match s.read(chunk) {
        Ok(0) => Err(Resp::text(400, "incomplete")),
        Ok(n) => Ok(n),
        Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => Err(Resp::text(408, "request timeout")),
        Err(_) => Err(Resp::text(400, "incomplete")),
    }
}

/// 머리만 보고 거를 것 — 몸통(그림은 10MB)을 읽기 전에 Host·길·열쇠·출처. 통과하면 None
pub fn head_check(req: &Req, gate: &Gate) -> Option<Resp> {
    if !req.header("host").is_some_and(|h| gate.hosts.iter().any(|a| a == h)) {
        return Some(Resp::text(403, "bad host"));
    }
    if req.header("tailscale-funnel-request").is_some() {
        return Some(Resp::text(403, "funnel"));
    }
    let has_body = req.header("content-length").is_some_and(|v| v.trim() != "0");
    if req.method != "POST" && !has_body {
        return None;
    }
    if !matches!(req.path.as_str(), "/api/send" | "/api/attach" | "/api/routine" | "/api/interrupt" | "/api/respawn" | "/api/spawn" | "/api/stop" | "/api/html-ticket" | "/api/curation" | "/api/media-ticket" | "/api/open-mac" | "/api/push-subscribe" | "/api/push-unsubscribe" | "/api/pair-code" | "/api/pair" | "/api/direct-answer" | "/api/remove" | "/api/rename" | "/api/pin" | "/api/role") {
        return Some(Resp::text(404, "not found"));
    }
    // 짝짓기는 코드가 열쇠 — 출처·JSON 만 본다
    if req.path == "/api/pair" {
        return (!same_origin_write(req, gate)).then(|| Resp::text(403, "bad origin"));
    }
    if !authed(req, gate) {
        return Some(Resp::text(401, "no key"));
    }
    let origin_ok = if req.path == "/api/attach" { same_origin_upload(req, gate) } else { same_origin_write(req, gate) };
    (!origin_ok).then(|| Resp::text(403, "bad origin"))
}

/// 소켓에서 요청 하나 읽기 — 머리 16KB·몸 64KB(그림 10MB)·chunked 거절, check 가 통과해야 몸통을 읽는다, deadline 넘으면 408
pub fn read_req_checked(s: &mut impl TimedRead, deadline: std::time::Instant, check: impl Fn(&Req) -> Option<Resp>) -> Result<Req, Resp> {
    let mut buf = Vec::with_capacity(2048);
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if buf.len() > MAX_HEAD {
            return Err(Resp::text(431, "header too large"));
        }
        let n = read_more(s, deadline, &mut chunk)?;
        buf.extend_from_slice(&chunk[..n]);
    };
    if head_end > MAX_HEAD {
        return Err(Resp::text(431, "header too large"));
    }
    let mut hs = [httparse::EMPTY_HEADER; 32];
    let mut p = httparse::Request::new(&mut hs);
    match p.parse(&buf[..head_end]) {
        Ok(httparse::Status::Complete(_)) => {}
        _ => return Err(Resp::text(400, "bad request")),
    }
    let target = p.path.unwrap_or("");
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let mut req = Req {
        method: p.method.unwrap_or("").to_string(),
        path: path.to_string(),
        query: query.to_string(),
        headers: p.headers.iter().map(|h| (h.name.to_ascii_lowercase(), String::from_utf8_lossy(h.value).into_owned())).collect(),
        body: Vec::new(),
    };
    if req.header("transfer-encoding").is_some() {
        return Err(Resp::text(501, "chunked not supported"));
    }
    let len = match req.header("content-length") {
        None => 0,
        Some(v) => v.trim().parse::<usize>().map_err(|_| Resp::text(400, "bad length"))?,
    };
    // 그림 올리기만 10MB, 나머지는 64KB
    let cap = if req.path == "/api/attach" { mobile_files::MAX_ATTACH } else { MAX_BODY };
    if len > cap {
        return Err(Resp::text(413, "body too large"));
    }
    let deadline = body_deadline(deadline, len);
    if let Some(r) = check(&req) {
        return Err(r);
    }
    let mut body = buf[head_end..].to_vec();
    while body.len() < len {
        let n = read_more(s, deadline, &mut chunk)?;
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(len);
    req.body = body;
    Ok(req)
}

/// 검사 없이 읽기(테스트·파서 확인용)
#[cfg(test)]
pub fn read_req(s: &mut impl TimedRead) -> Result<Req, Resp> {
    read_req_checked(s, std::time::Instant::now() + REQ_DEADLINE, |_| None)
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        303 => "See Other",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        408 => "Request Timeout",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        502 => "Bad Gateway",
        504 => "Gateway Timeout",
        _ => "",
    }
}

/// 남은 시간을 거는 쓰기
pub trait TimedWrite: Write {
    fn set_wtimeout(&mut self, d: Duration);
}
impl TimedWrite for TcpStream {
    fn set_wtimeout(&mut self, d: Duration) {
        let _ = self.set_write_timeout(Some(d.max(Duration::from_millis(1))));
    }
}
impl TimedWrite for Vec<u8> {
    fn set_wtimeout(&mut self, _: Duration) {}
}

/// 응답 쓰기 — 모든 응답에 캐시 금지·끼워 넣기 금지·리퍼러 금지. CORS 헤더는 어떤 경우에도 내지 않는다
pub fn write_resp(s: &mut impl TimedWrite, r: &Resp, head_only: bool, deadline: std::time::Instant) -> std::io::Result<()> {
    let mut out = format!("HTTP/1.1 {} {}\r\n", r.status, reason(r.status));
    for (k, v) in &r.headers {
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    out.push_str(&format!("Content-Length: {}\r\n", r.body.len()));
    // 자기 CSP·틀 규칙을 단 응답(html 시안 표 주소)엔 공통 것을 겹쳐 달지 않는다 — CSP 가 둘이면 둘 다 걸려 시안 스크립트가 막힌다
    let own = |k: &str| r.headers.iter().any(|(n, _)| n.eq_ignore_ascii_case(k));
    out.push_str("Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n");
    if !own("X-Frame-Options") {
        out.push_str("X-Frame-Options: DENY\r\n");
    }
    if !own("Content-Security-Policy") {
        out.push_str("Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\r\n");
    }
    out.push_str("Connection: close\r\n\r\n");
    let head = out.into_bytes();
    let body: &[u8] = if head_only { &[] } else { &r.body };
    // 16KB 씩 나눠 쓰며 남은 시간을 건다 — 조금씩 읽는 클라이언트가 큰 응답으로 자리를 오래 못 잡게
    // write_all 은 안 쓴다 — 맥(BSD)은 시간 초과 전에 일부를 보냈으면 오류 대신 보낸 수를 돌려줘서, 남은 시간을 다시 안 재면 마감이 몇 배로 늘었다
    for chunk in head.chunks(16 * 1024).chain(body.chunks(16 * 1024)) {
        let mut rest = chunk;
        while !rest.is_empty() {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            if left.is_zero() {
                return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "write deadline"));
            }
            s.set_wtimeout(left);
            match s.write(rest) {
                Ok(0) => return Err(std::io::Error::new(std::io::ErrorKind::WriteZero, "closed")),
                Ok(n) => rest = &rest[n..],
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e),
            }
        }
    }
    s.flush()
}

/// limit = 읽기 마감. 맥 쪽 처리와 쓰기는 각각 그 두 배까지 — 넘으면 504·끊기로 자리를 돌려준다
#[cfg(test)]
pub fn serve_conn_within(s: TcpStream, gate: std::sync::Arc<Gate>, be: std::sync::Arc<dyn Backend>, limit: Duration) {
    serve_conn_guarded(s, gate, be, limit, ());
}

/// 연결 하나 — 요청 하나 받고 답하고 닫는다. 기록은 안 남긴다. guard = 연결 자리(ConnSlot) — 놓이는 때가 자리 반환
pub fn serve_conn_guarded<G: Send + 'static>(mut s: TcpStream, gate: std::sync::Arc<Gate>, be: std::sync::Arc<dyn Backend>, limit: Duration, guard: G) {
    // 자리는 처리 스레드가 끝날 때 놓는다 — 504 로 먼저 끊어도 맥 쪽 일이 아직 돌면 그 자리를 계속 센다
    let mut guard = Some(guard);
    let deadline = std::time::Instant::now() + limit;
    let (resp, head) = match read_req_checked(&mut s, deadline, |req| head_check(req, &gate)) {
        Ok(req) => {
            let head = req.method == "HEAD";
            // 맥 쪽 일(claude agents·예약 스크립트 등)은 따로 돌리고 시간 안에 안 끝나면 504 — 패닉도 500 으로
            let (tx, rx) = std::sync::mpsc::channel();
            let (g, b, held) = (gate.clone(), be.clone(), guard.take());
            std::thread::spawn(move || {
                let _held = held;
                let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handle(&req, &g, &*b))).unwrap_or_else(|_| Resp::text(500, "internal error"));
                let _ = tx.send(r);
            });
            (rx.recv_timeout(limit * 2).unwrap_or_else(|_| Resp::text(504, "mac side took too long")), head)
        }
        Err(r) => (r, false),
    };
    let _ = write_resp(&mut s, &resp, head, std::time::Instant::now() + limit * 2);
}

/// 맥에서 열기는 문서·그림·영상만 — 코드·스크립트·html 은 맥 기본 앱으로 열면 실행되거나 브라우저 스크립트가 돈다
fn open_mac_kind(path: &str) -> bool {
    let ext = std::path::Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "doc" | "docx" | "ppt" | "pptx" | "key" | "xls" | "xlsx" | "numbers" | "pages" | "pdf" | "png" | "jpg" | "jpeg" | "gif" | "heic" | "webp" | "mp4" | "mov" | "m4v")
}

#[cfg(test)]
#[path = "mobile_http_tests.rs"]
mod tests;
