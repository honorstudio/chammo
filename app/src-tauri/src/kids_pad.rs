//! 패드 키즈 화면(1단계 셋째 조각) — 키즈 참모를 고른 패드(폰 PWA 기기 줄)를 그 참모에 잠근다.
//! - 잠김은 <데이터>/kids/pads.json { 기기 줄 id: { key, at } } — 서버가 매 요청 본다(gated): 잠긴 줄은 /api/kids/* 말고 전부 403
//! - 키즈 길은 잠긴 줄만(키는 잠김에서 — 패드가 참모를 고를 수 없다). 고르기(enter)는 안 잠긴 사람 줄만
//! - 나가기(leave)는 다음 조각(부모 잠금 — Face ID·숫자) 전까지 임시로 숨은 길 하나(화면 구석 3초)
use crate::mobile_http::{Backend, Req, Resp};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default)]
pub struct Pad {
    pub key: String,
    pub at: u64,
}

fn file(data: &Path) -> PathBuf {
    data.join("kids").join("pads.json")
}

pub fn read_in(data: &Path) -> BTreeMap<String, Pad> {
    std::fs::read_to_string(file(data)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_in(data: &Path, m: &BTreeMap<String, Pad>) -> Result<(), String> {
    let f = file(data);
    std::fs::create_dir_all(f.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = f.with_file_name(format!("pads.json.{}", crate::tools::tmp_tag()));
    std::fs::write(&tmp, serde_json::to_string_pretty(m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())
}

/// 그 기기 줄이 잠긴 참모 키
pub fn lock_of(data: &Path, dev: &str) -> Option<String> {
    read_in(data).remove(dev).map(|p| p.key)
}

pub fn lock_in(data: &Path, dev: &str, key: &str, now: u64) -> Result<(), String> {
    let mut m = read_in(data);
    m.insert(dev.to_string(), Pad { key: key.to_string(), at: now });
    write_in(data, &m)
}

pub fn unlock_in(data: &Path, dev: &str) -> Result<(), String> {
    let mut m = read_in(data);
    if m.remove(dev).is_some() {
        write_in(data, &m)?;
    }
    Ok(())
}

#[derive(Deserialize)]
struct EnterBody {
    key: String,
}

#[derive(Deserialize)]
struct SayBody {
    text: String,
    cid: String,
}

/// 녹음 몸 — wav 머리(RIFF…WAVE)와 audio/wav 만(남의 페이지 form 은 audio/wav 를 못 보낸다). 빈 몸은 '미리 받아쓴 글로'
fn wav_ok(req: &Req) -> bool {
    let ct = req.header("content-type").map(|c| c.split(';').next().unwrap_or("").trim().to_ascii_lowercase()).unwrap_or_default();
    ct == "audio/wav" && (req.body.is_empty() || (req.body.len() > 44 && &req.body[..4] == b"RIFF" && &req.body[8..12] == b"WAVE"))
}

fn cid_ok(c: &str) -> bool {
    !c.is_empty() && c.len() <= 64 && c.chars().all(|x| x.is_ascii_alphanumeric() || x == '-' || x == '_')
}

/// 그 키가 지금 키즈 참모인가(설정 스위치까지)
fn live(be: &dyn Backend, key: &str) -> Option<crate::kids::KidsOrch> {
    if be.env()["kids"] != true {
        return None;
    }
    crate::kids::read_in(&be.data_dir()).orchs.get(key).cloned()
}

/// /api/kids/* — dev = 열쇠의 기기 줄, locked = 그 줄의 잠김
/// 숫자판이 보낸 숫자 — 모양이 틀린 건 횟수에 안 넣고 400(숫자판은 네 자리만 보낸다)
fn pin_of(v: &serde_json::Value) -> Result<String, Resp> {
    v.get("pin").and_then(|p| p.as_str()).filter(|p| p.len() == 4 && p.bytes().all(|b| b.is_ascii_digit())).map(str::to_string).ok_or_else(|| Resp::text(400, "pin"))
}

/// 부모 숫자 보기 — 틀리면 403 {wrong, waitMs}, 쉬는 중 429 {waitMs}, 잠금 없음 409
fn check_pin(data: &std::path::Path, pin: &str) -> Result<(), Resp> {
    match crate::kids_guard::check_pin_in(data, pin, crate::notes::now_ms()) {
        Ok(()) => Ok(()),
        Err(crate::kids_guard::PinErr::NoLock) => Err(Resp::text(409, "no lock")),
        Err(crate::kids_guard::PinErr::Wait { wait_ms }) => { let mut r = Resp::json(&serde_json::json!({ "waitMs": wait_ms })); r.status = 429; Err(r) }
        Err(crate::kids_guard::PinErr::Wrong { wait_ms }) => { let mut r = Resp::json(&serde_json::json!({ "wrong": true, "waitMs": wait_ms })); r.status = 403; Err(r) }
    }
}

pub(crate) fn route(req: &Req, be: &dyn Backend, dev: &str, locked: Option<String>, body: impl Fn(&Req) -> Result<serde_json::Value, Resp>) -> Resp {
    let data = be.data_dir();
    let post = req.method == "POST";
    if req.path == "/api/kids/enter" {
        if !post {
            return Resp::text(405, "method not allowed");
        }
        if locked.is_some() {
            return Resp::text(409, "already a kids pad");
        }
        let b: EnterBody = match body(req).and_then(|v| serde_json::from_value(v).map_err(|_| Resp::text(400, "bad body"))) { Ok(b) => b, Err(r) => return r };
        let key = b.key.trim();
        if live(be, key).is_none() {
            return Resp::text(404, "not a kids assistant");
        }
        // 부모 잠금을 정해야 고를 수 있다 — 안 그러면 아이가 나갈 길을 막을 숫자가 없다(여섯째 조각)
        if !crate::kids_guard::lock_set_in(&data) {
            return Resp::text(409, "no lock");
        }
        return match lock_in(&data, dev, key, crate::notes::now_ms()) {
            Ok(()) => {
                be.kid_start(key); // 아이가 말하기 전에 세션 첫 턴을 끝내 둔다(11-18 아침 점검)
                Resp::json(&serde_json::json!({ "ok": true, "key": key }))
            }
            Err(e) => Resp::text(500, &e),
        };
    }
    let Some(key) = locked else { return Resp::text(403, "not a kids pad") };
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/api/kids/me") => {
            // 아이 화면 그리기에 필요한 것만 — 프사(도형·눈·색)·아이 이름. 꺼졌으면 잠든 화면(on false)
            let av = crate::avatar::read_all_in(&data.join("avatars")).into_iter().find(|e| e.key == key).map(|e| e.avatar);
            let time = crate::kids_guard::usage_in(&data, &key, crate::notes::now_ms(), crate::kids_guard::local_off());
            if live(be, &key).is_some() {
                be.kid_start(&key); // 앱을 다시 켠 뒤에도 패드가 화면을 열면 아이 세션을 미리(이미 떠 있으면 ensure 가 그대로 둔다)
            }
            match live(be, &key) {
                // voice = 맥 받아쓰기·목소리를 쓸 수 있나(없으면 패드는 글 칸), voiceMode = 숨은 스위치(tap 기본 · hold — 계획서 D 시험 칸), time = 오늘 쓴 시간
                Some(o) => Resp::json(&serde_json::json!({ "key": key, "on": true, "child": o.child, "avatar": av, "voice": be.kids_voice(), "voiceMode": crate::kids::read_in(&data).voice_mode.unwrap_or_else(|| "tap".into()), "time": time, "passkey": crate::kids_passkey::count_in(&data) > 0, "turn": turn_view(&data) })),
                None => Resp::json(&serde_json::json!({ "key": key, "on": false, "avatar": av })),
            }
        }
        ("POST", "/api/kids/say") => {
            let b: SayBody = match body(req).and_then(|v| serde_json::from_value(v).map_err(|_| Resp::text(400, "bad body"))) { Ok(b) => b, Err(r) => return r };
            let text = b.text.trim();
            if text.is_empty() || text.chars().count() > 2000 || !cid_ok(&b.cid) {
                return Resp::text(400, "bad text");
            }
            if live(be, &key).is_none() {
                return Resp::text(409, "kids assistant is off");
            }
            match be.kids_say(&key, text, &b.cid) {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("GET", "/api/kids/log") => {
            // 패드엔 아이 말과 아이 화면 답만 — 앱 줄·보호자 줄은 보호자 화면 몫. 최근 40줄
            let rows: Vec<_> = be.kids_log(&key).into_iter().filter(|r| r.who == "kid" || r.who == "assistant").collect();
            let skip = rows.len().saturating_sub(40);
            Resp::json(&serde_json::to_value(&rows[skip..]).unwrap_or_default())
        }
        // 목소리 — 몸은 16kHz 모노 wav 그대로(같은 출처 + audio/wav), cid 는 주소에
        ("POST", "/api/kids/peek" | "/api/kids/hear") => {
            let Some(cid) = req.param("cid").filter(|c| cid_ok(c)) else { return Resp::text(400, "bad cid") };
            if !wav_ok(req) {
                return Resp::text(400, "audio/wav only");
            }
            if live(be, &key).is_none() {
                return Resp::text(409, "kids assistant is off");
            }
            if req.path == "/api/kids/peek" {
                return match be.kids_peek(&req.body, cid) {
                    // 말이 끝났나(kids_turn) — 끝남 바로 대답 · 이어감 추임새 + 더 듣기 · 모름 조금 더. more 는 옛 패드용
                    Ok((text, _)) => {
                        let j = crate::kids_turn::judge(&text, &crate::kids_turn::rules_in(&data));
                        Resp::json(&serde_json::json!({ "text": text, "more": j == crate::kids_turn::Judge::More, "judge": j.as_str() }))
                    }
                    Err(e) => Resp::text(502, &e),
                };
            }
            // 판정 기록(패드가 주소에 붙임: 판정·쉼·그 뒤 이었나·기다린 시간) — 나중에 실사용으로 문턱을 고친다
            if let (Some(j), Ok(k)) = (req.param("j"), crate::kids::kid_dir(&data, &key)) {
                let n = |q: &str| req.param(q).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
                let f = |q: &str| req.param(q).and_then(|v| v.parse::<f64>().ok());
                let _ = crate::kids_turn::log_hear(&k, crate::notes::now_ms(), cid, j, n("p"), n("r") == 1, n("w"), f("lv"), f("fl"));
            }
            match be.kids_hear(&key, &req.body, cid) {
                Ok(text) => Resp::json(&serde_json::json!({ "text": text })),
                Err(e) => Resp::text(502, &e),
            }
        }
        ("GET", "/api/kids/voice") => {
            let Some(cid) = req.param("cid").filter(|c| cid_ok(c)) else { return Resp::text(400, "bad cid") };
            let n = req.param("n").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
            match be.kids_clip(&key, cid, n) {
                Ok(Some(w)) => Resp::new(200, "audio/wav", w),
                Ok(None) => Resp::new(204, "text/plain", Vec::new()),
                Err(()) => Resp::text(410, "no more"),
            }
        }
        ("GET", "/api/kids/pre") => match req.param("i").and_then(|v| v.parse::<usize>().ok()).and_then(|i| be.kids_pre(i)) {
            Some(w) => Resp::new(200, "audio/wav", w),
            None => Resp::text(404, "not ready"),
        },
        // 작품(다섯째 조각) — 목록(최근 바뀐 것부터)과 한 작품 HTML(CSP 인터넷 0·아이 집 안 그림만 data:). 패드는 iframe sandbox 에 srcdoc 로
        ("GET", "/api/kids/works") => match crate::kids::kid_dir(&data, &key) {
            Ok(k) => Resp::json(&serde_json::to_value(crate::kids_make::works_in(&k)).unwrap_or_default()),
            Err(e) => Resp::text(400, &e),
        },
        ("GET", "/api/kids/work") => {
            let Some(name) = req.param("name") else { return Resp::text(400, "name") };
            match crate::kids::kid_dir(&data, &key).and_then(|k| crate::kids_make::serve_work(&k, name)) {
                Ok(h) => Resp::new(200, "text/plain; charset=utf-8", h), // 글로 내준다 — 패드가 srcdoc 로만 그린다(이 주소를 직접 열어도 HTML 로 안 돈다)
                Err(_) => Resp::text(404, "no work"),
            }
        }
        // 패드가 말을 못 넘긴 때(못 잡음·빈 받아쓰기·화면 가림·오류) — 최대 소리·바닥 소음만, 다음 실사용에서 원인을 가르게(11-18)
        ("POST", "/api/kids/turnlog") => {
            let v = match body(req) { Ok(v) => v, Err(r) => return r };
            let cid = v["cid"].as_str().filter(|c| cid_ok(c)).unwrap_or("-");
            let Ok(k) = crate::kids::kid_dir(&data, &key) else { return Resp::text(400, "key") };
            match crate::kids_turn::log_event(&k, crate::notes::now_ms(), cid, v["ev"].as_str().unwrap_or(""), v["lv"].as_f64(), v["fl"].as_f64(), v["follow"].as_bool().unwrap_or(false)) {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(400, &e),
            }
        }
        // 아이 화면이 보이는 동안 30초마다 — 오늘 쓴 시간(빈틈은 안 셈)
        ("POST", "/api/kids/tick") => Resp::json(&serde_json::to_value(crate::kids_guard::tick_in(&data, &key, crate::notes::now_ms(), crate::kids_guard::local_off())).unwrap_or_default()),
        // 나가기 = 부모 숫자(맥에 해시, 틀리면 점점 길게 쉬기) 또는 등록한 패스키 서명(일곱째 조각) — 서버가 본다. 둘 다 없이는 어떤 길로도 안 풀린다
        ("POST", "/api/kids/leave") => {
            let v = match body(req) { Ok(v) => v, Err(r) => return r };
            if let Some(a) = v.get("passkey") {
                let Ok(a) = serde_json::from_value::<crate::kids_passkey::Assertion>(a.clone()) else { return Resp::text(400, "passkey") };
                return match crate::kids_passkey::verify_in(&data, &a, crate::notes::now_ms()) {
                    Ok(()) => match unlock_in(&data, dev) {
                        Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                        Err(e) => Resp::text(500, &e),
                    },
                    Err(_) => { let mut r = Resp::json(&serde_json::json!({ "passkey": false })); r.status = 403; r }
                };
            }
            match pin_of(&v) {
                Ok(pin) => match check_pin(&data, &pin) {
                    Ok(()) => match unlock_in(&data, dev) {
                        Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                        Err(e) => Resp::text(500, &e),
                    },
                    Err(r) => r,
                },
                Err(r) => r,
            }
        }
        // 패스키 도전값 — rp 는 패드가 연 주소의 호스트(중계면 중계 도메인), 나가기용이면 그 rp 로 등록된 열쇠 id 도
        ("POST", "/api/kids/passkey/challenge") => {
            let v = match body(req) { Ok(v) => v, Err(r) => return r };
            let rp = v.get("rp").and_then(|x| x.as_str()).unwrap_or("").to_ascii_lowercase();
            let purpose = match v.get("purpose").and_then(|x| x.as_str()) { Some("register") => crate::kids_passkey::Purpose::Register, Some("leave") => crate::kids_passkey::Purpose::Leave, _ => return Resp::text(400, "purpose") };
            match crate::kids_passkey::challenge_in(&data, purpose, &rp, crate::notes::now_ms()) {
                Ok(c) => Resp::json(&serde_json::json!({ "challenge": c, "ids": crate::kids_passkey::ids_in(&data, &rp) })),
                Err(_) => Resp::text(400, "rp"),
            }
        }
        // 패스키 등록 — 부모 숫자를 맞혀야(틀리면 나가기와 같은 쉬기). 등록만 하고 나가지는 않는다
        ("POST", "/api/kids/passkey/register") => {
            let v = match body(req) { Ok(v) => v, Err(r) => return r };
            let pin = match pin_of(&v) { Ok(p) => p, Err(r) => return r };
            let Some(reg) = v.get("reg").and_then(|x| serde_json::from_value::<crate::kids_passkey::Reg>(x.clone()).ok()) else { return Resp::text(400, "reg") };
            if let Err(r) = check_pin(&data, &pin) {
                return r;
            }
            match crate::kids_passkey::register_in(&data, &reg, crate::notes::now_ms()) {
                Ok(()) => Resp::json(&serde_json::json!({ "ok": true })),
                Err(e) => Resp::text(400, &e),
            }
        }
        (_, "/api/kids/me" | "/api/kids/say" | "/api/kids/log" | "/api/kids/leave" | "/api/kids/passkey/challenge" | "/api/kids/passkey/register" | "/api/kids/peek" | "/api/kids/hear" | "/api/kids/voice" | "/api/kids/pre" | "/api/kids/works" | "/api/kids/work" | "/api/kids/tick" | "/api/kids/turnlog") => Resp::text(405, "method not allowed"),
        _ => Resp::text(404, "not found"),
    }
}

/// 보호자 — 오늘 n분 더(폰 메뉴). 잠긴 패드는 gated 가 키즈 길 말고 다 막아 여기 못 온다
pub(crate) fn guardian_time(req: &Req, be: &dyn Backend, body: impl Fn(&Req) -> Result<serde_json::Value, Resp>) -> Resp {
    if req.method != "POST" {
        return Resp::text(405, "method not allowed");
    }
    let v = match body(req) { Ok(v) => v, Err(r) => return r };
    let key = v["key"].as_str().unwrap_or("").trim().to_string();
    let add = v["addMin"].as_u64().unwrap_or(0);
    if !(1..=60).contains(&add) {
        return Resp::text(400, "addMin 1~60");
    }
    if live(be, &key).is_none() {
        return Resp::text(404, "not a kids assistant");
    }
    match crate::kids_guard::add_today_in(&be.data_dir(), &key, add as u32, crate::notes::now_ms(), crate::kids_guard::local_off()) {
        Ok(u) => Resp::json(&serde_json::to_value(u).unwrap_or_default()),
        Err(e) => Resp::text(500, &e),
    }
}

/// 패드가 쓸 말 끝 문턱(kids.json turn, 고친 값은 clamped)
fn turn_view(data: &std::path::Path) -> serde_json::Value {
    let r = crate::kids_turn::rules_in(data);
    serde_json::json!({ "peekMs": r.peek_ms, "unsureMs": r.unsure_ms, "moreMs": r.more_ms, "speechLevel": r.speech_level })
}

/// 주소 칸(퍼센트 디코딩) — 참모 이름이 한글이라
fn qparam(req: &Req, name: &str) -> Option<String> {
    req.param(name).and_then(|v| percent_encoding::percent_decode_str(v).decode_utf8().ok()).map(|v| v.into_owned())
}

/// 보호자 폰·패드 — 아이 대화(7일, 보호자 줄 빼고)·작품 목록·오늘 시간(아홉째 조각, '오늘 만든 것' 줄과 보호자 채팅에 끼울 아이 줄)
/// 잠긴 패드 줄은 여기 오기 전에 막힌다(mobile_http 'kids pad' 403)
pub(crate) fn guardian_today(req: &Req, be: &dyn Backend) -> Resp {
    if req.method != "GET" {
        return Resp::text(405, "method not allowed");
    }
    let key = qparam(req, "key").unwrap_or_default();
    let Some(o) = live(be, &key) else { return Resp::text(404, "not a kids assistant") };
    let data = be.data_dir();
    let Ok(k) = crate::kids::kid_dir(&data, &key) else { return Resp::text(400, "key") };
    let rows: Vec<_> = be.kids_log(&key).into_iter().filter(|r| r.who != "guardian").collect();
    let time = crate::kids_guard::usage_in(&data, &key, crate::notes::now_ms(), crate::kids_guard::local_off());
    Resp::json(&serde_json::json!({ "child": o.child, "rows": rows, "works": crate::kids_make::works_in(&k), "time": time }))
}

/// 보호자 폰·패드 — 작품 하나(패드와 같은 serve_work: 맥이 인터넷 막는 머리·그림 data:, 글로 내줘 srcdoc 로만)
pub(crate) fn guardian_work(req: &Req, be: &dyn Backend) -> Resp {
    if req.method != "GET" {
        return Resp::text(405, "method not allowed");
    }
    let key = qparam(req, "key").unwrap_or_default();
    if live(be, &key).is_none() {
        return Resp::text(404, "not a kids assistant");
    }
    let name = qparam(req, "name").unwrap_or_default();
    match crate::kids::kid_dir(&be.data_dir(), &key).and_then(|k| crate::kids_make::serve_work(&k, &name)) {
        Ok(h) => Resp::new(200, "text/plain; charset=utf-8", h),
        Err(_) => Resp::text(404, "no work"),
    }
}

/// 맥 쪽 — 아이 말을 그 참모 아이 세션에(앱 kids_say 와 같은 길: 이름표·켜기·기록). 돌려주는 건 (세션 번호, 칠 글)
pub(crate) fn say_prepare(key: &str, text: &str, cid: &str) -> Result<(String, String), String> {
    let k = crate::kids::kid_ready_pub(key)?;
    let msg = crate::kids::compose_kid(cid, text)?;
    let msg = format!("{msg}\n{}", crate::kids_make::context_line(&k));
    let id = crate::kids_wire::ensure(&k, key).inspect_err(|e| crate::kids::kid_down(key, e))?;
    crate::kids::log_line(&k, crate::notes::now_ms(), "kid", text, Some(cid))?;
    Ok((id, msg))
}

/// 맥 쪽 — 새 답을 옮기고 최근 기록
pub(crate) fn log_blocking(key: &str) -> Vec<crate::kids_wire::Row> {
    let data = crate::config::data_dir();
    if !crate::kids::is_kids(data, crate::config::current().features.kids, key) {
        return vec![];
    }
    let Ok(k) = crate::kids::kid_dir(data, key) else { return vec![] };
    crate::kids_wire::sync(&k);
    crate::kids_wire::recent_log(&k, crate::notes::now_ms(), 2, 200)
}
