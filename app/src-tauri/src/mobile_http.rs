//! 모바일 서버의 문지기 — HTTP 한 요청을 읽고(httparse), 주소(Host)·열쇠·출처(Origin)를 본 뒤 허용 목록 길만 연다.
//! 하위 세션은 확인 없이 도니 이 서버는 맥을 조종하는 문이다. 여기 없는 길은 없다: 임의 경로·셸·키체인·계정·설정 쓰기 없음.
//! 실제로 맥에서 일하는 건 Backend(mobile.rs) — 테스트는 가짜 Backend 로 문지기만 잰다.
use crate::mobile_files::{self, Kind, Pick};
use crate::platform::same_dir;
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
    /// 작업 기록(tasks.jsonl)에 한 줄 — 결정 대기함 답(answer). 데스크톱 append_task_event 와 같은 파일
    fn append_task(&self, _line: &str) -> Result<(), String> {
        Err("not supported".into())
    }
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
    /// 폰 진단 한 줄 — 걸러진 '종류 키=값…'(diag_line)을 notify.log 에
    fn diag(&self, _line: &str) {}
    /// 폰 화면 박힘 진단(layout-*) — <데이터>/phone-layout.jsonl 에 한 줄(크기 상한 PHONE_LAYOUT_CAP, 글 내용 없음)
    fn layout_log(&self, line: &str) {
        self.diag(line);
    }
    /// 참모 별명 — 맥 앱(데스크톱)에 넘긴다: 앱 별명(setOrchLabel)을 바꾸고, 쉬는 때 /rename '참모-N · 별명'(데스크톱 renamesToSend)
    fn rename(&self, id: &str, nick: &str) -> Result<(), String>;
    /// 참모 제거 — claude stop(켜져 있으면) + rm(데스크톱 remove_session 과 같은 길). 목록에서 빠지고 대화 기록 파일은 맥에 남는다
    fn remove(&self, id: &str) -> Result<String, String>;
    /// 참모 재우기 — claude stop(데스크톱 끄기와 같은 길). 대화는 남아 다시 깨울 수 있다
    fn stop(&self, id: &str) -> Result<String, String>;
    fn routine(&self, name: &str, action: &str) -> Result<String, String>;
    /// 비서 세션(짧은 id)의 대화 기록 (대화 id, 지금 길이) — 다른 기기 참모가 넣은 말의 답을 그 자리부터 찾는다
    fn transcript_mark(&self, _id: &str) -> Option<(String, u64)> {
        None
    }
    /// 대화 기록 offset 뒤(상한까지) — 다른 기기 참모 답 찾기
    fn transcript_read(&self, _session: &str, _offset: u64) -> Option<String> {
        None
    }
    /// 화면 파일 — 이름은 문지기가 이미 걸렀다("mobile.html" 또는 "assets/<안전한 이름>")
    fn asset(&self, path: &str) -> Option<(Vec<u8>, String)>;
    /// scripts/show 기록 꼬리 — 파일 길의 허용 집합 출처
    fn show_log(&self) -> String;
    /// 파일 보관함 뿌리(~/Documents/Chammo — 참모마다 진짜 폴더). 보관함 파일도 허용 집합(locker_fs::phone_paths)
    fn locker_root(&self) -> Option<PathBuf> {
        None
    }
    /// 폰이 올린 첨부(<데이터>/attach/<숫자>-phone.<확장자>)를 그 참모 보관함에 — 보관함 복사본 경로
    fn locker_add(&self, _owner: &str, _path: &str) -> Result<String, String> {
        Err("locker unavailable".into())
    }
    /// 홈 폴더 — 보관함 바로가기는 홈 안 파일만(locker_fs::alias). 시험은 가짜 홈
    fn home(&self) -> PathBuf {
        PathBuf::from(crate::platform::home())
    }
    /// 참모 모드(폰 홈 모드 카드) — 목록(mode_list)·한 칸 그리기·누름·켜기. 맥 쪽 모드 호스트가 없으면 오류
    fn modes(&self) -> serde_json::Value {
        serde_json::json!([])
    }
    fn mode_view(&self, _name: &str, _columns: u32, _rows: u32) -> Result<serde_json::Value, String> {
        Err("modes unavailable".into())
    }
    fn mode_act(&self, _name: &str, _act: &serde_json::Value) -> Result<serde_json::Value, String> {
        Err("modes unavailable".into())
    }
    fn mode_open(&self, _name: &str, _dash: &str) -> Result<(), String> {
        Err("modes unavailable".into())
    }
    /// 이 홈에서 끄기 — 그 홈(dash)에 켜진 모드만 맥이 끈다
    fn mode_close(&self, _name: &str, _dash: &str) -> Result<(), String> {
        Err("modes unavailable".into())
    }
    /// 고르기 카드 그림 — {kind: svg|img|tree, …} 또는 null(자리표시). Svg 거름은 폰 화면이 한다
    fn mode_card(&self, _name: &str) -> serde_json::Value {
        serde_json::Value::Null
    }
    /// 지우기 — 기본 모드는 숨기기, 사용자 모드는 제거. 원본 폴더 휴지통은 데스크톱에서만이라 폰 길엔 없다 → {kind, trashed, undo}
    fn mode_remove(&self, _name: &str) -> Result<serde_json::Value, String> {
        Err("modes unavailable".into())
    }
    /// 되돌리기 — 숨긴 것 다시 보이기·방금 제거한 것 되살리기
    fn mode_restore(&self, _name: &str) -> Result<(), String> {
        Err("modes unavailable".into())
    }
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
    /// 사람 개입(2026-10-06 사용자) — on 이면 그 세션 브라우저에 개입, 아니면 돌려주기(세션이 부르는 중이면 '다 했어')
    fn browser_takeover(&self, _profile: &str, _session_pid: i32, _on: bool) -> Result<(), String> {
        Err("not supported".into())
    }
    /// 개입 중 폰에서 누르기·글자·스크롤 — 개입·부름이 아니면 맥이 버린다(agent_browser human_ok)
    fn browser_input(&self, _profile: &str, _session_pid: i32, _events: Vec<crate::agent_input::InputEv>) -> Result<(), String> {
        Err("not supported".into())
    }
    /// 화면 다시 받기(맥 모달의 다시 시도와 같은 agent_retry)
    fn browser_retry(&self, _profile: &str) {}
    /// 계정 칸 — 이름·요금제·사용량·쉬는 때만(accounts_cmd::PhoneView, 이메일·토큰 없음) · 바꾸기(데스크톱과 같은 길 + 고정) · 자동 전환 켜기
    fn accounts(&self) -> Result<serde_json::Value, String> {
        Err("unsupported".into())
    }
    fn account_switch(&self, _id: &str) -> Result<serde_json::Value, String> {
        Err("unsupported".into())
    }
    fn account_auto(&self, _on: bool) -> Result<serde_json::Value, String> {
        Err("unsupported".into())
    }
    /// 맥 앱 음성 모드(<데이터>/voice.json) — 폰 입력창 마이크. 켜기·끄기는 scripts/app voice 와 같은 통로(앱 __appctl)
    fn voice_on(&self) -> bool {
        false
    }
    fn set_voice(&self, _on: bool) -> Result<(), String> {
        Err("unsupported".into())
    }
    /// 폰에서 음성 소리 틀기(phone_voice) — 하트비트 한 번(보고 있음·소리 소식)을 받고 가져갈 소리·멈춤 번호를 답한다 · 내놓은 소리 파일(wav)
    fn voice_beat(&self, _b: crate::phone_voice::Beat) -> serde_json::Value {
        serde_json::json!({ "item": null, "cancel": 0 })
    }
    fn voice_audio(&self, _id: u64) -> Option<Vec<u8>> {
        None
    }
    /// 참모 모델·에포트 바꾸기 — 앱(데스크톱) 모델 칩과 같은 runModelPick 으로 넘긴다(새 세션 기본값은 앱이 되돌린다). 값은 문지기가 걸렀다
    fn pick_model(&self, _id: &str, _model: Option<&str>, _effort: Option<&str>) -> Result<(), String> {
        Err("unsupported".into())
    }
    /// 로그인 풀림(login.rs) — 화면이 적은 판단 + 폰 로그인 흐름 · 시작 · 코드 한 줄(값은 어디에도 안 남긴다) · 그만
    fn login_view(&self) -> serde_json::Value {
        serde_json::json!({ "need": null, "flow": { "state": "idle" } })
    }
    fn login_start(&self) -> Result<serde_json::Value, String> {
        Err("unsupported".into())
    }
    fn login_code(&self, _code: &str) -> Result<serde_json::Value, String> {
        Err("unsupported".into())
    }
    fn login_cancel(&self) {}
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
    /// 폰이 보낸 글(클라이언트 id) — 같은 id 는 한 번만 치고, 뒤에서 친 결과를 send-status 로 알린다(데이터 폴더에 하루, mobile_sends)
    pub sends: std::sync::Arc<crate::mobile_sends::Sends>,
    /// html 시안 표(ticket) → (경로, 낸 때) — iframe 은 열쇠를 못 실어서 짧게 사는 표 주소로 연다(10분)
    pub tickets: std::sync::Mutex<std::collections::HashMap<String, (String, std::time::Instant)>>,
}

/// 폰 화면(껍데기·api 응답) 공통 CSP — media-src 의 blob: 은 폰이 맥에서 받은 음성 소리를 틀 때만(data/phoneVoice). 그 밖의 곳으로는 안 열린다
pub const PHONE_CSP: &str = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/// 시안 표가 사는 시간 — 껍데기 '처음부터'(새로 고침)도 그 안이면 된다
const TICKET_KEEP: Duration = Duration::from_secs(600);

use crate::mobile_sends::SendState;

/// 큰 몸통(그림)은 읽기 마감을 크기만큼 늘린다 — 느린 LTE(초당 64KB)로도 끝나게, 상한 3분.
/// 15초 안에 다 읽어야 해서 LTE 로 큰 사진이 'Load failed' 났다(2026-10-03)
pub fn body_deadline(base: std::time::Instant, len: usize) -> std::time::Instant {
    base + Duration::from_secs((len as u64).div_ceil(64_000).min(180))
}

/// html 시안 상한 — 그림을 data: 로 박은 시안이 2~8MB(2026-10-09 dev 전체 실측 최대 7.9MB). 글 파일 상한(1MB)과 따로
pub const MAX_HTML_FILE: u64 = 10 * 1024 * 1024;

/// 쓰기 마감 — 읽기 마감(limit)의 두 배, 큰 응답(html 시안)은 느린 LTE(초당 64KB)로도 끝나게 크기만큼, 상한 3분
pub fn write_deadline(base: std::time::Instant, limit: Duration, len: usize) -> std::time::Instant {
    (base + limit * 2).max(body_deadline(base, len))
}

/// 다른 기기 참모와 말하는 약속 번호 — /api 길을 바꾸면 올린다(손님은 이 번호로 기능을 켜고 끈다)
pub const PROTO: u32 = 1;

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

/// 작업 기록 꼬리 — 폰이 5초마다 읽는다. 이만큼 넘게 뒤처졌으면(처음 받기 포함) 끝 이만큼부터 다시(reset)
const TASKS_TAIL: u64 = 512 * 1024;

/// 작업 기록 이어 받기 — 예전엔 5초마다 꼬리 512KB 를 통째로 보냈다(2026-10-08, 안 바뀐 5초에도 518KB). 파일이 없으면 빈 조각
fn tasks_chunk(path: &Path, from: u64) -> crate::claude::TranscriptChunk {
    let len = std::fs::metadata(path).map_or(0, |m| m.len());
    let from = (len.saturating_sub(from) <= TASKS_TAIL).then_some(from);
    crate::claude::read_chunk_with(path, from, TASKS_TAIL, 0, TASKS_TAIL)
        .unwrap_or(crate::claude::TranscriptChunk { text: String::new(), next: 0, reset: true, start: 0 })
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

/// 작업 id — scripts/task 는 1006-1615-5e02, 옛 기록엔 report-fix 같은 이름도 있다. 글자·숫자·-·_ 만, 40자까지
fn is_task_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 40 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

enum AnswerState {
    Waiting,
    /// 폰이 2분 안에 같은 답을 이미 남겼다 — 응답이 끊겨 다시 누른 것. 새 줄 없이 받아 준다(폰은 그때 글을 보낸다)
    Replay,
    No,
}

/// 그 일이 지금 답을 기다리나 — send 를 뺀 마지막 이벤트가 ask(domain/mobile waitingList 와 같은 판단). 깨진 줄은 건너뛴다
fn task_answer_state(log: &str, task: &str, note: &str, now_ms: i64) -> AnswerState {
    let mut last = None;
    for line in log.lines() {
        let Ok(e) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if e["task"] == task && e["type"] != "send" {
            last = Some(e);
        }
    }
    let Some(e) = last else { return AnswerState::No };
    if e["type"] == "ask" {
        return AnswerState::Waiting;
    }
    let recent = e["ts"].as_str().and_then(crate::accounts_usage::iso_ms).is_some_and(|t| (now_ms - t).abs() <= 120_000);
    if e["type"] == "answer" && e["by"] == "phone" && e["note"] == note && recent {
        AnswerState::Replay
    } else {
        AnswerState::No
    }
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

/// 열쇠가 다른 기기 참모(peer 줄)면 (기기 id, 짝지을 때 받은 이름)
fn peer_of(req: &Req, gate: &Gate) -> Option<(String, String)> {
    let dev = device_of(req, gate)?;
    gate.devices.list().into_iter().find(|d| d.id == dev && d.peer).map(|d| (d.id, d.name))
}

fn peer_allowed(method: &str, path: &str) -> bool {
    match method {
        "GET" | "HEAD" => crate::remote::GETS.contains(&path),
        "POST" => crate::remote::POSTS.contains(&path),
        _ => false,
    }
}

/// 다른 기기 참모의 말을 이 기기 참모에게 — 이름표는 여기서 붙인다. cid 는 기기마다 따로 센다(남의 cid 를 못 덮게)
fn peer_say(req: &Req, gate: &Gate, be: &dyn Backend, dev: &str, name: &str) -> Resp {
    if req.method != "POST" {
        return Resp::text(405, "method not allowed");
    }
    if !same_origin_write(req, gate) {
        return Resp::text(403, "bad origin");
    }
    let b: PeerSayBody = match body(req) { Ok(b) => b, Err(r) => return r };
    if !cid_ok(&b.cid) {
        return Resp::text(400, "bad cid");
    }
    let text = match crate::peer_link::compose(name, &b.from, &b.cid, &b.text) {
        Ok(t) => t,
        Err(crate::peer_link::SayErr::Forged) => return Resp::text(400, "forged approval — a peer cannot pass on a human approval"),
        Err(crate::peer_link::SayErr::TooLong) => return Resp::text(400, "text too long"),
        Err(crate::peer_link::SayErr::Empty) => return Resp::text(400, "empty text"),
    };
    let sessions = match be.sessions() { Ok(s) => s, Err(e) => return Resp::text(502, &e) };
    let id = match crate::peer_link::target(&sessions, &be.hq_dir(), &b.to) {
        Ok(id) => id,
        Err(crate::peer_link::TargetErr::Missing) => return Resp::text(404, "no such assistant"),
        Err(crate::peer_link::TargetErr::NotAssistant) => return Resp::text(403, "not an assistant session"),
        Err(crate::peer_link::TargetErr::Ambiguous) => return Resp::text(409, "which assistant? (to)"),
    };
    let key = format!("peer-{dev}-{}", b.cid);
    // 다시 보내기(응답을 못 받은 손님)는 상한을 안 먹는다
    if gate.sends.state(&key).is_none() && !crate::peer_link::allow(dev) {
        return Resp::text(429, "too many — wait a minute");
    }
    if !gate.sends.begin(&key) {
        return Resp::json(&serde_json::json!({ "ok": true, "dup": true, "id": id }));
    }
    if let Some((session, offset)) = be.transcript_mark(&id) {
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        crate::peer_link::marks().put(&key, crate::peer_link::Mark { device: dev.into(), session, offset, at });
    }
    let sends = gate.sends.clone();
    be.send_later(&id, &text, Box::new(move |r| sends.finish(&key, match r { Ok(()) => SendState::Done, Err(e) => SendState::Failed(e) })));
    Resp::new(202, "application/json", serde_json::json!({ "ok": true, "queued": true, "id": id }).to_string())
}

/// 넣은 말의 답 — state: typing(치는 중)·failed·working(턴이 안 끝남)·done(text)·interrupted(사람이 끼어듦)·sent(쳤지만 기록을 못 읽음)·unknown
fn peer_reply(req: &Req, gate: &Gate, be: &dyn Backend, dev: &str) -> Resp {
    if req.method != "GET" {
        return Resp::text(405, "method not allowed");
    }
    let Some(cid) = req.param("cid").filter(|c| cid_ok(c)) else { return Resp::text(400, "bad cid") };
    let key = format!("peer-{dev}-{cid}");
    let j = |state: &str| Resp::json(&serde_json::json!({ "state": state }));
    match gate.sends.state(&key) {
        None | Some(SendState::Lost) => j("unknown"),
        Some(SendState::Typing) => j("typing"),
        Some(SendState::Failed(e)) => Resp::json(&serde_json::json!({ "state": "failed", "error": e })),
        Some(SendState::Done) => {
            let Some(m) = crate::peer_link::marks().get(&key, dev) else { return j("sent") };
            let Some(chunk) = be.transcript_read(&m.session, m.offset) else { return j("sent") };
            match crate::peer_link::reply_from(&chunk, cid) {
                crate::peer_link::Reply::Waiting => j("working"),
                crate::peer_link::Reply::Interrupted => j("interrupted"),
                crate::peer_link::Reply::Done(text) => Resp::json(&serde_json::json!({ "state": "done", "text": text })),
            }
        }
    }
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

/// 꼬리표 — 길이 + FNV-1a. 같은 글이면 같은 값(앱을 다시 켜도), 틀려도 폰이 한 번 통째로 받을 뿐
fn body_tag(s: &str) -> String {
    let h = s.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ b as u64).wrapping_mul(0x0100_0000_01b3));
    format!("{}-{h:x}", s.len())
}

/// since(지난번 꼬리표)가 있으면 첫 줄 {"tag","same"} + 바뀌었을 때만 원문 — show 기록 5초·세션 목록 3초마다 통째로 받던 것(2026-10-09).
/// show 기록은 세션별 공평 나누기 꼬리라 바이트 자리 이어 받기(/api/tasks?from=)가 안 맞아 꼬리표 비교로. 화면은 domain/tagTail
fn tagged(req: &Req, body: String) -> Resp {
    let tag = body_tag(&body);
    let same = req.param("since") == Some(tag.as_str());
    let body = if same { String::new() } else { body };
    Resp::new(200, "text/plain; charset=utf-8", format!("{}\n{body}", serde_json::json!({ "tag": tag, "same": same })))
}

/// since 가 없으면 옛 폰 화면용 글 그대로
fn shows_resp(req: &Req, be: &dyn Backend) -> Resp {
    let log = phone_show_log(be);
    if req.param("since").is_none() {
        return Resp::new(200, "text/plain; charset=utf-8", log);
    }
    tagged(req, log)
}

/// 폰에 보낼 엑셀 표 — 시트마다 앞 PHONE_ROWS 행까지만(LTE·폰 메모리), 잘린 행 수는 cut 에
pub const PHONE_ROWS: u32 = 2000;
fn phone_sheet(b: &crate::sheet_book::Book) -> Vec<u8> {
    let mut v = serde_json::to_value(b).unwrap_or_default();
    if let Some(sheets) = v.get_mut("sheets").and_then(|x| x.as_array_mut()) {
        for sh in sheets {
            let Some(cells) = sh.get_mut("cells").and_then(|x| x.as_array_mut()) else { continue };
            let max = cells.iter().filter_map(|c| c["r"].as_u64()).max().map_or(0, |m| m + 1);
            cells.retain(|c| c["r"].as_u64().is_some_and(|r| r < PHONE_ROWS as u64));
            sh["cut"] = serde_json::json!(max.saturating_sub(PHONE_ROWS as u64));
        }
    }
    serde_json::to_vec(&v).unwrap_or_default()
}

/// 글로 바꾼 문서(워드 → html) — 글자로 내고, 혹시 문서로 그려져도 스크립트 없이
fn text_resp(body: Vec<u8>) -> Resp {
    let mut r = Resp::new(200, "text/plain; charset=utf-8", body);
    r.headers.push(("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'".into()));
    r
}

/// 폰 보관함 — 진짜 폴더(locker_fs::phone_view)에서 폰이 열 수 있는 것(pick 이 Ok)만 줄째 넘긴다(통째로 넘기면 거름 밖 파일 이름이 샌다)
fn locker_resp(be: &dyn Backend) -> Resp {
    let allowed = allowed_of(be);
    let rules = mobile_files::Rules { data_dir: be.data_dir(), hq_dir: be.hq_dir(), home: PathBuf::from(crate::platform::home()) };
    let mut v = match be.locker_root() {
        Some(r) => crate::locker_fs::phone_view(&r, &be.home()),
        None => serde_json::json!({ "items": [], "hidden": [], "folders": [] }),
    };
    if let Some(items) = v.get_mut("items").and_then(|x| x.as_array_mut()) {
        items.retain(|i| i["path"].as_str().is_some_and(|p| matches!(mobile_files::pick(p, &allowed, &rules), Pick::Ok(_))));
    }
    Resp::json(&v)
}

/// 폰이 읽어도 되는 경로 집합 — 보여 준 파일·지침서·starter(allowed_files) + 보관함에 넣은 파일
fn allowed_of(be: &dyn Backend) -> Vec<String> {
    let mut v = mobile_files::allowed_files(&be.show_log(), &be.routines().unwrap_or_default(), &be.data_dir(), &be.hq_dir());
    v.extend(be.locker_root().map(|r| crate::locker_fs::phone_paths(&r, &be.home())).unwrap_or_default());
    v
}

fn file_resp(req: &Req, be: &dyn Backend) -> Resp {
    let Some(raw) = req.param("path") else { return Resp::text(400, "no path") };
    let Ok(path) = percent_encoding::percent_decode_str(raw).decode_utf8() else { return Resp::text(400, "bad path") };
    let allowed = allowed_of(be);
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
    // 엑셀은 표로(맥 스페이스와 같은 Rust 읽기 — 폰은 읽기만). 칸 글에 키가 보이면 안 낸다
    if req.param("as") == Some("sheet") {
        let ext = real.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
        if !matches!(ext.as_str(), "xlsx" | "xlsm") {
            return Resp::text(403, "not an excel file");
        }
        let Ok(bytes) = mobile_files::read_verified(&path, mobile_files::MAX_BIN_FILE) else { return Resp::text(403, "not allowed") };
        return match crate::sheet_book::read_book(&bytes).map(|b| phone_sheet(&b)) {
            Ok(body) if mobile_files::secret_in(&body) => Resp::text(403, "secret inside"),
            Ok(body) => {
                let mut r = Resp::new(200, "application/json; charset=utf-8", body);
                r.headers.push(("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'".into()));
                r
            }
            Err(e) => Resp::text(422, &e),
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
    /// 다른 기기의 참모 앱이 붙는다 — 이름은 몸통 name 에서(폰은 UA 에서, name 무시)
    #[serde(default)]
    peer: bool,
    #[serde(default)]
    name: Option<String>,
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

/// 다른 기기 참모가 넣는 말 — to = 받을 참모(짧은 id·이름·별명, 비우면 참모가 하나일 때만)
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PeerSayBody {
    #[serde(default)]
    to: String,
    text: String,
    cid: String,
    /// 보낸 참모 이름 — 이름표에 기기 이름 다음으로(괄호·제어 글자는 걸러진다)
    #[serde(default)]
    from: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InterruptBody {
    id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountSwitchBody {
    id: String,
}

/// 폰 하트비트 — ready = 오디오가 깨어 있다(사람이 한 번 눌렀다) · hidden = 화면을 떠난다 · ack = 지난 소리의 시작·끝·실패
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BeatBody {
    ready: bool,
    #[serde(default)]
    hidden: bool,
    #[serde(default)]
    ack: Option<BeatAck>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BeatAck {
    id: u64,
    s: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
/// 켜기·끄기 한 칸(자동 전환·음성 모드)
struct AccountAutoBody {
    on: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LoginCodeBody {
    code: String,
}

/// 폰 로그인 시작은 몇 초에 한 번 — 두 번 탭에 pty 가 둘 뜨지 않게(흐름도 하나만 받지만 앞에서 막는다)
pub const LOGIN_GAP: Duration = Duration::from_secs(3);

/// 계정 칸 id — 맥이 만든 "a<밀리초>" 모양(영숫자·-·_ 64자). 백업 칸 이름은 칸이 아니다
fn account_id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') && id != crate::accounts::BACKUP_FIRST && id != crate::accounts::BACKUP_LAST
}

/// 계정 바꾸기는 몇 초에 한 번 — 두 번 탭·다른 탭에서 겹쳐 눌러도 한 번만(칸이 달라도)
pub const ACCOUNT_GAP: Duration = Duration::from_secs(4);
/// 모델 칩 — 앱 runModelPick 이 결과를 기다리고 기본값을 되돌리는 동안(최대 20초)은 겹치지 않게, 폰 연타만 막는 짧은 틈
pub const MODEL_GAP: Duration = Duration::from_secs(3);
/// 모델 칩이 고를 수 있는 값 — domain/modelPick MODEL_CHOICES·LEVELS 와 같은 목록
const MODEL_ALIASES: &[&str] = &["opus", "sonnet", "haiku"];
const EFFORT_LEVELS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ModelBody {
    id: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    effort: Option<String>,
}

#[derive(Deserialize)]
struct LockerAddBody {
    owner: String,
    path: String,
}

/// 폰 보관함 쓰기(홈·보관함 v1) — 주인 = 참모 폴더 이름. 나머지 칸은 길마다 쓰는 것만
#[derive(Deserialize)]
struct LockerOpBody {
    owner: String,
    #[serde(default)]
    path: String,
    #[serde(default)]
    folder: String,
    #[serde(default)]
    rel: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    parent: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
struct ModeActBody {
    name: String,
    act: serde_json::Value,
}

#[derive(Deserialize)]
struct ModeOpenBody {
    name: String,
    dash: String,
}

/// 지우기·되돌리기 몸통 — 이름만(다른 칸은 버린다: 폰은 원본 휴지통을 못 고른다)
#[derive(Deserialize)]
struct ModeNameBody {
    name: String,
}

/// 폰 홈·보관함 v1 에 더한 쓰기 길 — 같은 출처 문지기·head_check 몸통 목록·405 가 이 목록 하나를 본다
const PHONE_POSTS: &[&str] = &["/api/locker-alias", "/api/locker-unalias", "/api/locker-new", "/api/locker-mkdir", "/api/locker-write", "/api/mode-act", "/api/mode-open", "/api/mode-close", "/api/mode-remove", "/api/mode-restore"];
const PHONE_GETS: &[&str] = &["/api/modes", "/api/mode-view", "/api/mode-card"];
/// 폰 md 글 칸 저장만 몸통을 크게(글 512KB + JSON)
const MAX_WRITE_BODY: usize = crate::locker_fs::MAX_PHONE_MD + 64 * 1024;

/// 모드 이름 — 모드 폴더 이름 꼴만(modes.rs 가 다시 찾는다)
fn mode_name_ok(n: &str) -> bool {
    !n.is_empty() && n.len() <= 80 && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// 폰 보관함 쓰기 — 그 참모 보관함 안에서만. 참모 폴더는 이름으로 있는 것만(폰은 새로 안 만든다)
fn locker_op(req: &Req, be: &dyn Backend) -> Resp {
    let b: LockerOpBody = match body(req) { Ok(b) => b, Err(r) => return r };
    let Some(root) = be.locker_root() else { return Resp::text(503, "locker unavailable") };
    let Some(owner) = crate::locker_fs::phone_owner(&root, b.owner.trim()) else { return Resp::text(404, "no locker") };
    let bad = |e: String| Resp::text(400, &e);
    match req.path.as_str() {
        "/api/locker-alias" => {
            // 폰이 볼 수 있는 파일만 — 바로가기가 생기면 폰 허용 목록(phone_paths)이 그만큼 넓어진다
            let rules = mobile_files::Rules { data_dir: be.data_dir(), hq_dir: be.hq_dir(), home: PathBuf::from(crate::platform::home()) };
            let Pick::Ok(real) = mobile_files::pick(&b.path, &allowed_of(be), &rules) else { return Resp::text(403, "not allowed") };
            let (home, data) = (be.home(), be.data_dir());
            let ctx = crate::locker_fs::Ctx { home: &home, data: &data, root: &root, settled: &[] };
            match crate::locker_fs::alias(&ctx, &owner, &b.folder, &real) {
                Ok(at) => Resp::json(&serde_json::json!({ "path": at.to_string_lossy() })),
                Err(e) => bad(e),
            }
        }
        "/api/locker-unalias" => match crate::locker_fs::unalias(&owner, &b.rel) {
            Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
            Err(e) => bad(e),
        },
        "/api/locker-new" => {
            if b.kind.as_deref().is_some_and(|k| k != "md") {
                return bad("폰은 새 문서(md)만".into());
            }
            match crate::locker_fs::new_doc(&owner, &b.folder, "md", &b.title) {
                Ok(at) => Resp::json(&serde_json::json!({ "path": at.to_string_lossy() })),
                Err(e) => bad(e),
            }
        }
        "/api/locker-mkdir" => match crate::locker_fs::mkdir(&owner, &b.parent, &b.name) {
            Ok(rel) => Resp::json(&serde_json::json!({ "rel": rel })),
            Err(e) => bad(e),
        },
        _ => match crate::locker_fs::write_md(&owner, Path::new(&b.path), &b.text) {
            Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
            Err(e) => bad(e),
        },
    }
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

/// 폰 프로필 — avatar null = 처음대로(지우기). 그림은 폰에서 못 올린다(그림 프사면 목소리·자르기만, 있던 그림 그대로)
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AvatarBody {
    id: String,
    avatar: Option<crate::avatar::Avatar>,
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
    let allowed = allowed_of(be);
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
/// 검토 틀 고르기 창(.cur-pick)의 메모 칸은 손가락이면 키보드를 안 띄우고 폰에 넘긴다(cur-note: 고른 블록 k·쓰던 글) — 시안 안 작은 칸은
/// 키보드가 뜨며 화면이 스크롤되면 틀이 고르기 창을 닫아 못 썼다(2026-10-11). 폰이 아래 시트로 받아 cur-cmd note 로 되돌린다. 고르기 창은 닫는다(틀이 스크롤에 닫는다)
const HTML_SHIM: &str = r#"<script>(function(){try{window.localStorage.length}catch(e){var m={},s={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null}};Object.defineProperty(s,'length',{get:function(){return Object.keys(m).length}});try{Object.defineProperty(window,'localStorage',{value:s,configurable:true})}catch(_){}}
function size(){var d=document.documentElement,w=d.scrollWidth;[].forEach.call(document.querySelectorAll('.decks'),function(e){if(e.scrollWidth>e.clientWidth+4)w=Math.max(w,Math.min(4000,e.scrollWidth+d.clientWidth-e.clientWidth))});parent.postMessage({hodoc:'html-size',w:w,h:d.scrollHeight},'*')}
addEventListener('load',function(){size();setTimeout(size,600)});addEventListener('resize',size);
var d0=0;function g(t){return Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY)}
addEventListener('touchstart',function(e){if(e.touches.length===2)d0=g(e.touches)},{passive:true});
addEventListener('touchmove',function(e){if(e.touches.length===2&&d0){e.preventDefault();parent.postMessage({hodoc:'html-pinch',k:g(e.touches)/d0},'*')}},{passive:false});
addEventListener('touchend',function(e){if(d0&&e.touches.length<2){d0=0;parent.postMessage({hodoc:'html-pinch',done:true},'*')}});
var nt=0;function note(e){var i=e.target;if(!i||i.tagName!=='INPUT'||!i.closest||!i.closest('.cur-pick'))return;if(e.type!=='touchend'&&!(navigator.maxTouchPoints>0||matchMedia('(pointer:coarse)').matches))return;if(e.cancelable)e.preventDefault();e.stopPropagation();i.blur();var n=Date.now();if(n-nt<600)return;nt=n;var m=document.querySelector('[data-k].cur-sel');if(!m)return;parent.postMessage({hodoc:'cur-note',k:m.getAttribute('data-k')||'',text:i.value},'*');document.dispatchEvent(new Event('scroll',{bubbles:true}))}
addEventListener('touchend',note,true);addEventListener('focusin',note,true);
})()</script>"#;

/// 시안 맨 앞 모양 — 아이폰은 넓은 페이지를 줄여 보일 때 글자만 멋대로 키워(text autosizing) 줄끼리 겹친다(2026-10-04 폰 겹침).
/// 시안이 직접 정한 값이 있으면 뒤에 오는 그게 이긴다. 원본 파일은 안 고친다(옛 시안 수백 개).
/// 검토 틀(design-curation)이 블록을 누르면 띄우는 고르기 창(.cur-pick)은 손가락으로 누르기 쉽게 44px, 메모 칸은 16px(작으면 아이폰이 확대) —
/// 틀이 뒤에서 같은 세기로 높이·글꼴을 정해 메모 칸은 html 을 붙여 세기를 올린다
const HTML_HEAD: &str = r#"<style>html{-webkit-text-size-adjust:100%;text-size-adjust:100%}@media (pointer:coarse){.cur-pick button{min-width:44px;min-height:44px}html .cur-pick input{height:44px;font-size:16px}}</style>"#;

/// <head ...> 바로 뒤에 끼운다 — 시안 스크립트보다 먼저 돌아야 저장소가 갈린다. head 가 없으면 <html> 뒤, 그것도 없으면
/// doctype 뒤(doctype 앞에 무엇이 오면 쿼크 모드가 된다), 다 없으면 맨 앞
fn inject_shim(html: &str) -> String {
    let low = html.to_ascii_lowercase();
    let at = ["head", "html", "!doctype"].iter().find_map(|n| crate::reader::tag_end(low.as_bytes(), n)).unwrap_or(0);
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

/// 받기 한 번에 통째로 줄 수 있는 크기 — 응답을 메모리에 올려 보낸다(쓰기 마감도 크기만큼 늘어난다). 넘으면 맥에서
const MAX_DOWNLOAD: u64 = 200 * 1024 * 1024;
/// 받기 조각(Range) 상한
const DL_CHUNK: u64 = 8 * 1024 * 1024;

/// 받기 MIME — 확장자로(내보내는 확장자는 mobile_files::shareable 이 정한다 — 받기라고 새로 열지 않는다). 리더 표(mime_of)는 모르면 글로 주지만 받기는 모르면 octet-stream(사파리가 글로 열어 버리지 않게)
fn dl_mime(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("pptx") => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Some("doc") => "application/msword",
        Some("xls") => "application/vnd.ms-excel",
        Some("ppt") => "application/vnd.ms-powerpoint",
        Some("txt" | "log") => "text/plain; charset=utf-8",
        Some("md") => "text/markdown; charset=utf-8",
        Some("csv") => "text/csv; charset=utf-8",
        _ => match crate::reader::mime_of(p) {
            "text/plain; charset=utf-8" => "application/octet-stream",
            m => m,
        },
    }
}

/// 내려받기 이름 — 옛 칸(filename)은 아스키만 되니 아니면 file.<확장자>, 진짜 이름은 filename*(RFC 5987)
fn attachment(name: &str) -> String {
    const KEEP: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC.remove(b'.').remove(b'-').remove(b'_');
    let plain = !name.is_empty() && name.bytes().all(|b| (b.is_ascii_graphic() || b == b' ') && b != b'"' && b != b'\\');
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).filter(|e| e.bytes().all(|b| b.is_ascii_alphanumeric()));
    let fallback = if plain { name.to_string() } else { ext.map_or_else(|| "file".to_string(), |e| format!("file.{e}")) };
    format!("attachment; filename=\"{fallback}\"; filename*=UTF-8''{}", percent_encoding::utf8_percent_encode(name, KEEP))
}

/// 표 주소로 받기 — 열쇠 없이 표만(사파리 내려받기 링크는 Bearer 를 못 싣는다). 보여 준 파일 거름은 /api/file 과 같고, 글 속 키가 보이면 안 준다.
/// 원본 그대로·attachment·Range(조각 8MB)
fn dl_page(req: &Req, gate: &Gate, be: &dyn Backend) -> Resp {
    let Some(path) = ticket_path(req, gate) else { return Resp::text(403, "bad ticket") };
    let Pick::Ok(real) = pick_shown(be, &path) else { return Resp::text(403, "not allowed") };
    let Ok((_, total)) = mobile_files::open_verified(&path) else { return Resp::text(403, "not allowed") };
    if mobile_files::kind_of(&real) == Kind::Text {
        match mobile_files::read_verified(&path, MAX_DOWNLOAD) {
            Ok(b) if mobile_files::secret_in(&b) => return Resp::text(403, "secret inside"),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::InvalidData => return Resp::text(413, "file too large"),
            Err(_) => return Resp::text(403, "not allowed"),
        }
    }
    let mut r = if req.header("range").is_some() {
        let Some((start, end)) = mobile_files::parse_range(req.header("range"), total, DL_CHUNK) else {
            let mut r = Resp::text(416, "bad range");
            r.headers.push(("Content-Range", format!("bytes */{total}")));
            return r;
        };
        let Ok((bytes, total)) = mobile_files::read_range_verified(&path, start, end) else { return Resp::text(403, "not allowed") };
        let mut r = Resp::new(206, dl_mime(&real), bytes);
        r.headers.push(("Content-Range", format!("bytes {start}-{end}/{total}")));
        r
    } else {
        match mobile_files::read_verified(&path, MAX_DOWNLOAD) {
            Ok(b) => Resp::new(200, dl_mime(&real), b),
            Err(e) if e.kind() == std::io::ErrorKind::InvalidData => return Resp::text(413, "file too large"),
            Err(_) => return Resp::text(403, "not allowed"),
        }
    };
    let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    r.headers.push(("Content-Disposition", attachment(&name)));
    r.headers.push(("Accept-Ranges", "bytes".into()));
    r.headers.push(("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'".into()));
    r
}

fn html_page(req: &Req, gate: &Gate, be: &dyn Backend) -> Resp {
    let Some(path) = ticket_path(req, gate).filter(|p| is_html(p)) else { return Resp::text(403, "bad ticket") };
    let Pick::Ok(_) = pick_shown(be, &path) else { return Resp::text(403, "not allowed") };
    let bytes = match mobile_files::read_verified(&path, MAX_HTML_FILE) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => return Resp::text(413, "file too large"),
        Err(_) => return Resp::text(403, "not allowed"),
    };
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
struct DiagBody {
    kind: String,
    line: String,
}

/// 폰 화면 박힘 기록 상한 — 넘으면 앞 절반을 버린다(줄 단위)
pub const PHONE_LAYOUT_CAP: usize = 256 * 1024;

/// 기록 글에 한 줄 더하기 — cap 을 넘으면 앞에서부터 줄 단위로 버려 절반 아래로
pub fn capped_append(old: &str, line: &str, cap: usize) -> String {
    let mut out = format!("{old}{line}\n");
    if out.len() > cap {
        let mut cut = out.len() - cap / 2;
        while !out.is_char_boundary(cut) { cut += 1; }
        let from = out[cut..].find('\n').map(|i| cut + i + 1).unwrap_or(out.len());
        out = out[from..].to_string();
    }
    out
}

/// 폰 진단 한 줄 거르기 — 종류는 영문 소문자·하이픈, 줄은 '키=값' 30칸까지(키 영문 12자, 값 영문·숫자·.-_ 24자). 하나라도 어긋나면 통째로 버린다
fn diag_line(kind: &str, line: &str) -> Option<String> {
    let word = |s: &str, max: usize, ok: fn(char) -> bool| !s.is_empty() && s.len() <= max && s.chars().all(ok);
    if !word(kind, 24, |c| c.is_ascii_lowercase() || c == '-') {
        return None;
    }
    let parts: Vec<&str> = line.split(' ').collect();
    if line.is_empty() || parts.len() > 30 {
        return None;
    }
    let good = parts.iter().all(|p| {
        p.split_once('=').is_some_and(|(k, v)| word(k, 12, |c| c.is_ascii_alphabetic()) && word(v, 24, |c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')))
    });
    good.then(|| format!("{kind} {line}"))
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
    // 다른 기기 참모가 '여기 참모가 있나·말이 통하나'만 묻는다 — 열쇠 없이, 앱 표시·약속 번호·버전·OS 만(이름·경로·세션은 없음)
    if req.path == "/api/hello" {
        if !is_get {
            return Resp::text(405, "method not allowed");
        }
        return Resp::json(&serde_json::json!({ "app": "chammo", "proto": PROTO, "version": env!("CARGO_PKG_VERSION"), "os": std::env::consts::OS }));
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
        let name = match (b.peer, b.name.as_deref().map(str::trim).filter(|n| !n.is_empty())) {
            (true, Some(n)) => n.to_string(),
            (true, None) => "참모".into(),
            (false, _) => crate::mobile_pair::device_name(req.header("user-agent").unwrap_or("")),
        };
        let p = crate::mobile_pair::Pairing { name: &name, home: b.home && !b.peer, prev: b.prev.as_deref(), peer: b.peer };
        return match gate.devices.pair_with(&b.code, &p, std::time::SystemTime::now()) {
            Some(token) => Resp::json(&serde_json::json!({ "token": token })),
            None => Resp::text(401, "짝짓기 코드가 틀렸거나 10분이 지났어요 — 맥 설정 > 모바일에서 QR 을 새로 만들어 주세요"),
        };
    }
    // html 시안 — 표가 열쇠(iframe 은 Bearer 를 못 싣는다)
    if req.path == "/api/html" {
        return if is_get { html_page(req, gate, be) } else { Resp::text(405, "method not allowed") };
    }
    if req.path == "/api/dl" {
        return if is_get { dl_page(req, gate, be) } else { Resp::text(405, "method not allowed") };
    }
    if req.path == "/api/media" {
        return if is_get { media_page(req, gate, be) } else { Resp::text(405, "method not allowed") };
    }
    if !authed(req, gate) {
        return Resp::text(401, "no key");
    }
    // 다른 기기 참모 열쇠(peer 줄)는 보기 + 이름표 붙는 말 넣기만 — 사람 길(이름표 없이 치기·카드 답)과 파일·계정·짝짓기 코드는 못 쓴다(ADR 0007)
    let peer = peer_of(req, gate);
    let peer_path = matches!(req.path.as_str(), "/api/peer-say" | "/api/peer-reply");
    match &peer {
        Some(_) if !peer_allowed(&req.method, &req.path) => return Resp::text(403, "not for a peer key"),
        None if peer_path => return Resp::text(403, "peer key only"),
        _ => {}
    }
    if let Some((dev, name)) = &peer {
        if req.path == "/api/peer-say" {
            return peer_say(req, gate, be, dev, name);
        }
        if req.path == "/api/peer-reply" {
            return peer_reply(req, gate, be, dev);
        }
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
            Ok(s) if req.param("since").is_some() => tagged(req, with_ctx(&s, &be.ctx_files())),
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
        // from(지난번 next)이 있으면 그 뒤 온전한 줄만 — 없으면 옛 폰 화면(캐시된 페이지)용 꼬리 글 그대로
        ("GET", "/api/tasks") => match req.param("from").map(str::parse::<u64>) {
            None => Resp::new(200, "text/plain; charset=utf-8", be.tasks()),
            Some(Ok(from)) => {
                // 첫 줄 = {"next","reset"}, 그 뒤 = 줄 원문 — JSON 글로 싸면 따옴표 이스케이프로 첫 받기가 7% 커졌다(518→554KB)
                let c = tasks_chunk(&be.data_dir().join("tasks.jsonl"), from);
                Resp::new(200, "text/plain; charset=utf-8", format!("{}\n{}", serde_json::json!({ "next": c.next, "reset": c.reset }), c.text))
            }
            Some(Err(_)) => Resp::text(400, "bad from"),
        },
        ("GET", "/api/routines") => match be.routines() {
            Ok(s) => Resp::raw_json(s),
            Err(e) => Resp::text(502, &format!("예약 목록을 못 읽었어요: {e}")),
        },
        ("GET", "/api/usage") => Resp::raw_json(be.usage()),
        // 맥 부하 — 앱이 적는 load.json + 빌드·시뮬레이터·갤럭시 자리 누가(읽기만)
        ("GET", "/api/load") => {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            Resp::json(&crate::load::phone_load(&be.data_dir(), now))
        }
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
        // 참모 순서 — 데스크톱 채팅 탭에서 끌어 둔 순서(폰은 읽기만)
        ("GET", "/api/order") => match crate::orch_pins::read_order(&be.data_dir()) {
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
        ("GET", "/api/shows") => shows_resp(req, be),
        ("GET", "/api/locker") => locker_resp(be),
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
            Resp::json(&match gate.sends.state(c) {
                Some(SendState::Typing) => serde_json::json!({ "state": "typing" }),
                Some(SendState::Done) => serde_json::json!({ "state": "done" }),
                Some(SendState::Failed(e)) => serde_json::json!({ "state": "failed", "error": e }),
                // 치다가 앱이 꺼졌거나 기록에 없음 — 폰이 대화 기록을 찾아본 뒤 판단한다
                Some(SendState::Lost) | None => serde_json::json!({ "state": "unknown" }),
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
        ("POST", "/api/send" | "/api/routine" | "/api/interrupt" | "/api/respawn" | "/api/spawn" | "/api/stop" | "/api/push-subscribe" | "/api/push-unsubscribe" | "/api/html-ticket" | "/api/curation" | "/api/media-ticket" | "/api/dl-ticket" | "/api/open-mac" | "/api/direct-answer" | "/api/task-answer" | "/api/remove" | "/api/rename" | "/api/pin" | "/api/role" | "/api/avatar" | "/api/account-switch" | "/api/account-auto" | "/api/voice-mode" | "/api/voice-beat" | "/api/model" | "/api/login-start" | "/api/login-code" | "/api/login-cancel" | "/api/browser-takeover" | "/api/browser-input" | "/api/browser-retry" | "/api/diag" | "/api/locker-add") if !same_origin_write(req, gate) => Resp::text(403, "bad origin"),
        ("POST", p) if PHONE_POSTS.contains(&p) && !same_origin_write(req, gate) => Resp::text(403, "bad origin"),
        ("POST", "/api/locker-alias" | "/api/locker-unalias" | "/api/locker-new" | "/api/locker-mkdir" | "/api/locker-write") => locker_op(req, be),
        // 폰 홈 모드 카드 — 목록 · 한 칸 그리기(글자 칸 크기) · 누름 · 고른 모드 켜기·이 홈에서 끄기(대시보드 칸 자리 = 그 참모)
        ("GET", "/api/modes") => Resp::json(&be.modes()),
        ("GET", "/api/mode-card") => {
            let name = req.param("name").unwrap_or("");
            if !mode_name_ok(name) {
                return Resp::text(400, "bad mode");
            }
            Resp::json(&be.mode_card(name))
        }
        ("GET", "/api/mode-view") => {
            let name = req.param("name").unwrap_or("");
            let num = |k: &str| req.param(k).and_then(|v| v.parse::<u32>().ok()).filter(|n| (1..=400).contains(n));
            let (Some(c), Some(r)) = (num("columns"), num("rows")) else { return Resp::text(400, "bad size") };
            if !mode_name_ok(name) {
                return Resp::text(400, "bad name");
            }
            match be.mode_view(name, c, r) {
                Ok(v) => Resp::json(&v),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("POST", "/api/mode-act") => {
            let b: ModeActBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !mode_name_ok(&b.name) || !b.act.is_object() {
                return Resp::text(400, "bad act");
            }
            match be.mode_act(&b.name, &b.act) {
                Ok(v) => Resp::json(&v),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("POST", "/api/mode-open") => {
            let b: ModeOpenBody = match body(req) { Ok(b) => b, Err(r) => return r };
            let dash = b.dash.trim();
            if !mode_name_ok(&b.name) || dash.is_empty() || dash.chars().count() > 80 {
                return Resp::text(400, "bad open");
            }
            match be.mode_open(&b.name, dash) {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("POST", "/api/mode-close") => {
            let b: ModeOpenBody = match body(req) { Ok(b) => b, Err(r) => return r };
            let dash = b.dash.trim();
            if !mode_name_ok(&b.name) || dash.is_empty() || dash.chars().count() > 80 {
                return Resp::text(400, "bad close");
            }
            match be.mode_close(&b.name, dash) {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("POST", "/api/mode-remove") | ("POST", "/api/mode-restore") => {
            let b: ModeNameBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !mode_name_ok(&b.name) {
                return Resp::text(400, "bad mode");
            }
            let r = if req.path == "/api/mode-remove" { be.mode_remove(&b.name) } else { be.mode_restore(&b.name).map(|()| serde_json::json!({ "ok": true })) };
            match r {
                Ok(v) => Resp::json(&v),
                Err(e) => Resp::text(502, &e),
            }
        }
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
            match mobile_files::read_verified(&b.path, MAX_HTML_FILE) {
                Ok(bytes) if mobile_files::secret_in(&bytes) => return Resp::text(403, "secret inside"),
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::InvalidData => return Resp::text(413, "file too large"),
                Err(_) => return Resp::text(403, "not allowed"),
            }
            let Some(t) = new_ticket(gate, &b.path) else { return Resp::text(500, "no random") };
            Resp::json(&serde_json::json!({ "url": format!("/api/html?t={t}") }))
        }
        // 받기 표 — 보여 준 파일이면 무엇이든(폰 공유 시트·내려받기). 이름·크기·MIME 도 같이(폰이 50MB 넘으면 공유 대신 내려받기)
        ("POST", "/api/dl-ticket") => {
            let b: PathBody = match body(req) { Ok(b) => b, Err(r) => return r };
            let real = match pick_shown(be, &b.path) {
                Pick::Ok(p) => p,
                Pick::Forbidden => return Resp::text(403, "not allowed"),
                Pick::NotFound => return Resp::text(404, "not found"),
            };
            let Ok((_, size)) = mobile_files::open_verified(&b.path) else { return Resp::text(403, "not allowed") };
            let Some(t) = new_ticket(gate, &b.path) else { return Resp::text(500, "no random") };
            let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            Resp::json(&serde_json::json!({ "url": format!("/api/dl?t={t}"), "size": size, "name": name, "mime": dl_mime(&real) }))
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
        // 폰 진단 — 화면이 이상한 상태(유령 키보드 등)를 스스로 알아채면 값 한 줄. 글 내용이 못 실리게 키=값 낱말만, 10초에 한 번
        ("POST", "/api/diag") => {
            let b: DiagBody = match body(req) { Ok(b) => b, Err(r) => return r };
            let Some(line) = diag_line(&b.kind, &b.line) else { return Resp::text(400, "bad line") };
            // 화면 박힘(layout-*)은 따로 막이·따로 기록 — 유령 키보드 진단과 서로 안 막는다
            let layout = b.kind.starts_with("layout-");
            if !once_per(gate, if layout { "diag-layout" } else { "diag" }, Duration::from_secs(if layout { 5 } else { 10 })) {
                return Resp::text(429, "too soon");
            }
            let dev = device_of(req, gate).unwrap_or_default();
            let line = format!("{line}{}", if dev.is_empty() { String::new() } else { format!(" dev={}", dev.get(..4).unwrap_or(&dev)) });
            if layout { be.layout_log(&line) } else { be.diag(&line) }
            Resp::json(&serde_json::json!({ "ok": true }))
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
        // 폰이 올린 첨부를 보관함에 — 폰이 맥의 아무 경로나 보관함(=폰 허용 목록)에 넣지 못하게 폰 첨부 꼴만 받는다
        ("POST", "/api/locker-add") => {
            let b: LockerAddBody = match body(req) { Ok(b) => b, Err(r) => return r };
            let owner = b.owner.trim();
            if owner.is_empty() || owner.chars().count() > 80 || !mobile_files::phone_attach(Path::new(&b.path), &be.data_dir()) {
                return Resp::text(400, "bad locker add");
            }
            match be.locker_add(owner, &b.path) {
                Ok(path) => Resp::json(&serde_json::json!({ "path": path })),
                Err(e) => Resp::text(502, &e),
            }
        }
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
        // 참모 프로필(모양·색·목소리) — 켜진 HQ 참모만, 열쇠는 맥이 그 세션 이름에서 뽑는다. 저장·검사는 데스크톱 프로필 창과 같은 함수(avatar::save_in)
        ("POST", "/api/avatar") => {
            let b: AvatarBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !is_short_id(&b.id) {
                return Resp::text(400, "bad id");
            }
            let sessions = match be.sessions() { Ok(s) => s, Err(e) => return Resp::text(502, &e) };
            if !session_cwd(&sessions, &b.id).is_some_and(|cwd| same_dir(&cwd, &be.hq_dir())) {
                return Resp::text(404, "no such assistant");
            }
            let Some(name) = session_name(&sessions, &b.id) else { return Resp::text(404, "no such assistant") };
            let key = crate::orch_roles::base_of(&name);
            let dir = be.data_dir().join("avatars");
            match b.avatar {
                None => match crate::avatar::delete_in(&dir, key) {
                    Ok(()) => Resp::new(200, "application/json", br#"{"ok":true}"#.to_vec()),
                    Err(e) => Resp::text(400, &e),
                },
                Some(a) => match crate::avatar::save_in(&dir, key, a, None) {
                    Ok(e) => Resp::json(&serde_json::to_value(e).unwrap_or_default()),
                    Err(e) => Resp::text(400, &e),
                },
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
        // 꺼진 참모 다시 켜기 — HQ 폴더의 꺼진 대화만, 같은 대화는 10초에 한 번.
        // 이미 켜진 HQ 대화면(폰 목록이 낡음) 다시 켜지 않고 already — respawn 은 재시작이라 하던 턴이 끊긴다(2026-10-05)
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
            if crate::mobile_wake::hq_live(&live, &hq, &b.session_id) {
                return Resp::json(&serde_json::json!({ "ok": true, "already": true }));
            }
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
        ("GET", "/api/accounts") => match be.accounts() {
            Ok(v) => Resp::json(&v),
            Err(e) => Resp::text(502, &e),
        },
        // 계정 바꾸기 — 같은 출처 문지기 뒤. 맥 키체인 칸을 바꿔 끼운다(데스크톱 '이 계정으로'와 같은 길). 실패는 오류 이름 그대로(화면이 글로)
        ("POST", "/api/account-switch") => {
            let b: AccountSwitchBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !account_id_ok(&b.id) {
                return Resp::text(400, "bad id");
            }
            if !once_per(gate, "account-switch", ACCOUNT_GAP) {
                return Resp::text(429, "too soon");
            }
            match be.account_switch(&b.id) {
                Ok(v) => Resp::json(&v),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("POST", "/api/account-auto") => {
            let b: AccountAutoBody = match body(req) { Ok(b) => b, Err(r) => return r };
            match be.account_auto(b.on) {
                Ok(v) => Resp::json(&v),
                Err(e) => Resp::text(502, &e),
            }
        }
        // 모델·에포트 — 비서(HQ) 세션만, 별칭·단계 목록 안 값만, 연달아는 한 번(앞 것이 기본값을 되돌리는 동안 겹치면 둘째가 바뀐 값을 원래 값으로 뜬다)
        ("POST", "/api/model") => {
            let b: ModelBody = match body(req) { Ok(b) => b, Err(r) => return r };
            let model_ok = b.model.as_deref().is_none_or(|m| MODEL_ALIASES.contains(&m));
            let effort_ok = b.effort.as_deref().is_none_or(|e| EFFORT_LEVELS.contains(&e));
            if !is_short_id(&b.id) || !model_ok || !effort_ok || (b.model.is_none() && b.effort.is_none()) {
                return Resp::text(400, "bad pick");
            }
            let sessions = match be.sessions() { Ok(s) => s, Err(e) => return Resp::text(502, &e) };
            match session_cwd(&sessions, &b.id) {
                Some(cwd) if same_dir(&cwd, &be.hq_dir()) => {}
                Some(_) => return Resp::text(403, "not an assistant session"),
                None => return Resp::text(404, "no such session"),
            }
            if !once_per(gate, "model", MODEL_GAP) {
                return Resp::text(429, "too soon");
            }
            match be.pick_model(&b.id, b.model.as_deref(), b.effort.as_deref()) {
                Ok(()) => Resp::new(202, "application/json", serde_json::json!({ "ok": true }).to_string()),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("GET", "/api/voice") => Resp::json(&serde_json::json!({ "on": be.voice_on() })),
        // 폰 음성 — 하트비트(보고 있음)·내놓은 소리 파일. 소리 파일은 내놓은 id 하나만(경로를 받지 않는다)
        ("POST", "/api/voice-beat") => {
            let b: BeatBody = match body(req) { Ok(b) => b, Err(r) => return r };
            let ack = match b.ack {
                None => None,
                Some(a) => {
                    let kind = match a.s.as_str() {
                        "start" => crate::phone_voice::AckKind::Start,
                        "end" => crate::phone_voice::AckKind::End,
                        "fail" => crate::phone_voice::AckKind::Fail,
                        _ => return Resp::text(400, "bad ack"),
                    };
                    Some(crate::phone_voice::Ack { id: a.id, kind })
                }
            };
            Resp::json(&be.voice_beat(crate::phone_voice::Beat { ready: b.ready, hidden: b.hidden, ack }))
        }
        ("GET", "/api/voice-audio") => {
            let Some(id) = req.param("id").and_then(|v| v.parse::<u64>().ok()) else { return Resp::text(400, "bad id") };
            match be.voice_audio(id) {
                Some(bytes) => {
                    let mut r = Resp::new(200, "audio/wav", bytes);
                    r.headers.push(("Cache-Control", "no-store".into()));
                    r
                }
                None => Resp::text(404, "not found"),
            }
        }
        ("POST", "/api/voice-mode") => {
            let b: AccountAutoBody = match body(req) { Ok(b) => b, Err(r) => return r };
            match be.set_voice(b.on) {
                Ok(()) => Resp::json(&serde_json::json!({ "on": b.on })),
                Err(e) => Resp::text(502, &e),
            }
        }
        // 로그인 풀림 — 보기는 열쇠만, 쓰기는 같은 출처 문지기 뒤(위 줄)
        ("GET", "/api/login") => Resp::json(&be.login_view()),
        ("POST", "/api/login-start") => {
            if !once_per(gate, "login-start", LOGIN_GAP) {
                return Resp::text(429, "too soon");
            }
            match be.login_start() {
                Ok(v) => Resp::json(&v),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("POST", "/api/login-code") => {
            let b: LoginCodeBody = match body(req) { Ok(b) => b, Err(r) => return r };
            if !crate::login::code_ok(&b.code) {
                return Resp::text(400, "bad code");
            }
            match be.login_code(&b.code) {
                Ok(v) => Resp::json(&v),
                Err(e) => Resp::text(409, &e),
            }
        }
        ("POST", "/api/login-cancel") => {
            be.login_cancel();
            Resp::json(&serde_json::json!({ "ok": true }))
        }
        ("GET", "/api/direct") => Resp::new(200, "text/plain; charset=utf-8", be.direct_log()),
        ("POST", "/api/browser-takeover" | "/api/browser-input" | "/api/browser-retry") => {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct B {
                profile: String,
                session_pid: i32,
                #[serde(default)]
                on: bool,
                #[serde(default)]
                events: Vec<crate::agent_input::InputEv>,
            }
            let b: B = match body(req) { Ok(b) => b, Err(r) => return r };
            if b.profile.is_empty() || b.profile.len() > 64 || !b.profile.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                return Resp::text(400, "bad profile");
            }
            if b.events.len() > 50 {
                return Resp::text(400, "too many events");
            }
            // 폰이 본 그 세션 브라우저일 때만(세션이 바뀌었으면 남의 브라우저에 안 간다)
            if !be.browser_lives().as_array().is_some_and(|l| l.iter().any(|x| x["profile"] == b.profile.as_str() && x["sessionPid"] == b.session_pid)) {
                return Resp::text(404, "no such browser");
            }
            if req.path == "/api/browser-retry" {
                be.browser_retry(&b.profile);
                return Resp::json(&serde_json::json!({ "ok": true }));
            }
            let r = if req.path == "/api/browser-input" { be.browser_input(&b.profile, b.session_pid, b.events) } else { be.browser_takeover(&b.profile, b.session_pid, b.on) };
            match r {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(409, &e),
            }
        }
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
        // 결정 대기함(scripts/task ask) 답 — 그 일의 마지막 이벤트(send 빼고, 앱 waitingList 와 같이)가 물음일 때만 answer 한 줄.
        // 폰이 이걸 안 남겨 카드가 안 빠졌고 같은 답을 세 번 보냈다(2026-10-06). 같은 일은 5초에 한 번(기록이 바뀌기 전 두 번 붙지 않게)
        ("POST", "/api/task-answer") => {
            #[derive(serde::Deserialize)]
            struct B {
                task: String,
                note: String,
            }
            let mut b: B = match body(req) { Ok(b) => b, Err(r) => return r };
            if !is_task_id(&b.task) {
                return Resp::text(400, "bad task");
            }
            b.note.retain(|c| !c.is_control() || c == '\n' || c == '\t');
            let note = b.note.trim();
            if note.is_empty() || note.chars().count() > MAX_TEXT {
                return Resp::text(400, "bad text");
            }
            if !once_per(gate, &format!("task-answer:{}", b.task), Duration::from_secs(5)) {
                return Resp::text(429, "too soon");
            }
            match task_answer_state(&be.tasks(), &b.task, note, crate::orch_roles::now_ms() as i64) {
                AnswerState::Waiting => {}
                AnswerState::Replay => return Resp::json(&serde_json::json!({ "ok": true, "again": true })),
                AnswerState::No => return Resp::text(409, "not waiting"),
            }
            let row = serde_json::json!({ "ts": crate::direct::chrono_now(), "type": "answer", "task": b.task, "note": note, "by": "phone" });
            match be.append_task(&row.to_string()) {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(502, &e),
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
                    // 앱이 다시 켜졌거나 한참 뒤에 다시 보내도(하루 안) 안 친다 — 2026-10-10 '다시보내기 누르다 무한증식'
                    if let Some(c) = &b.cid {
                        if !gate.sends.begin(c) {
                            return Resp::json(&serde_json::json!({ "ok": true, "dup": true }));
                        }
                    }
                    let (sends, cid) = (gate.sends.clone(), b.cid.clone());
                    be.send_later(&b.id, &b.text, Box::new(move |r| {
                        if let Some(c) = cid {
                            sends.finish(&c, match r { Ok(()) => SendState::Done, Err(e) => SendState::Failed(e) });
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
        (_, "/api/env" | "/api/sessions" | "/api/transcript" | "/api/tasks" | "/api/routines" | "/api/usage" | "/api/load" | "/api/file" | "/api/shows" | "/api/avatars" | "/api/avatar" | "/api/avatar-image" | "/api/send" | "/api/attach" | "/api/routine" | "/api/interrupt" | "/api/stopped" | "/api/tails" | "/api/respawn" | "/api/spawn" | "/api/browsers" | "/api/browser-frame" | "/api/push-key" | "/api/push-subscribe" | "/api/push-unsubscribe" | "/api/send-status" | "/api/stop" | "/api/html-ticket" | "/api/curation" | "/api/curation-state" | "/api/media-ticket" | "/api/dl-ticket" | "/api/open-mac" | "/api/direct" | "/api/direct-answer" | "/api/task-answer" | "/api/remove" | "/api/rename" | "/api/pin" | "/api/pins" | "/api/order" | "/api/role" | "/api/roles" | "/api/accounts" | "/api/account-switch" | "/api/account-auto" | "/api/voice" | "/api/voice-mode" | "/api/voice-beat" | "/api/voice-audio" | "/api/model" | "/api/login" | "/api/login-start" | "/api/login-code" | "/api/login-cancel" | "/api/browser-takeover" | "/api/browser-input" | "/api/browser-retry" | "/api/diag" | "/api/locker" | "/api/locker-add") => {
            Resp::text(405, "method not allowed")
        }
        (_, p) if PHONE_POSTS.contains(&p) || PHONE_GETS.contains(&p) => Resp::text(405, "method not allowed"),
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
    if !matches!(req.path.as_str(), "/api/send" | "/api/attach" | "/api/voice-mode" | "/api/voice-beat" | "/api/model" | "/api/routine" | "/api/interrupt" | "/api/respawn" | "/api/spawn" | "/api/stop" | "/api/html-ticket" | "/api/curation" | "/api/media-ticket" | "/api/dl-ticket" | "/api/open-mac" | "/api/push-subscribe" | "/api/push-unsubscribe" | "/api/pair-code" | "/api/pair" | "/api/direct-answer" | "/api/task-answer" | "/api/remove" | "/api/rename" | "/api/pin" | "/api/role" | "/api/avatar" | "/api/account-switch" | "/api/account-auto" | "/api/login-start" | "/api/login-code" | "/api/login-cancel" | "/api/browser-takeover" | "/api/browser-input" | "/api/browser-retry" | "/api/diag" | "/api/locker-add" | "/api/peer-say") && !PHONE_POSTS.contains(&req.path.as_str()) {
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
    let cap = match req.path.as_str() {
        "/api/attach" => mobile_files::MAX_ATTACH,
        "/api/locker-write" => MAX_WRITE_BODY,
        _ => MAX_BODY,
    };
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
    write_resp_paced(s, r, head_only, deadline, Duration::MAX)
}

/// stall = 한 바이트도 못 보내고 기다리는 최대 시간 — 큰 응답은 전체 마감이 길어도(write_deadline) 아예 안 읽는 손님은 이만큼에 끊는다.
/// 조금씩이라도 나가면 다시 잰다(소켓 버퍼가 커지며 찔끔 나가는 동안 두 배가 돼서 서버는 읽기 마감 하나로 건다)
pub fn write_resp_paced(s: &mut impl TimedWrite, r: &Resp, head_only: bool, deadline: std::time::Instant, stall: Duration) -> std::io::Result<()> {
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
        out.push_str(&format!("Content-Security-Policy: {PHONE_CSP}\r\n"));
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
            s.set_wtimeout(left.min(stall));
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

/// limit = 읽기 마감. 맥 쪽 처리와 쓰기는 각각 그 두 배까지(큰 응답 쓰기는 write_deadline 이 크기만큼) — 넘으면 504·끊기로 자리를 돌려준다
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
    let _ = write_resp_paced(&mut s, &resp, head, write_deadline(std::time::Instant::now(), limit, if head { 0 } else { resp.body.len() }), limit);
}

/// 맥에서 열기는 문서·그림·영상만 — 코드·스크립트·html 은 맥 기본 앱으로 열면 실행되거나 브라우저 스크립트가 돈다
fn open_mac_kind(path: &str) -> bool {
    let ext = std::path::Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "doc" | "docx" | "ppt" | "pptx" | "key" | "xls" | "xlsx" | "numbers" | "pages" | "pdf" | "png" | "jpg" | "jpeg" | "gif" | "heic" | "webp" | "mp4" | "mov" | "m4v")
}

#[cfg(test)]
#[path = "mobile_http_tests.rs"]
mod tests;
