//! 말 앞단 Claude API(1단계 일곱째 조각, 사용자 11-18 '섞어서') — 설정 > 키즈 모드에 키가 있으면 아이 말을 Claude API(Haiku, 스트리밍)로
//! 바로 불러 첫 문장이 나오는 즉시 소리를 만든다. 키가 없거나 API 가 실패·늦으면 지금처럼 Claude Code 세션 앞단으로 넘긴다.
//! 규칙은 두 길이 같다: 도구 없음, 아이 말은 세션과 같은 이름표(compose_kid), 같은 아이 화면 규칙(CLAUDE.md)·부모 튜닝,
//! 답은 같은 거름(이모지·경로 문장 빼기 — kids_voice::clean_say)과 같은 만들기 표시(kids_make::parse_orders).
//! 미성년자: Anthropic 이용 정책 '미성년자에게 제공되는 제품' + 지원 문서(2026-03-16) — 아동 안전 지침·AI 라고 알리기·지켜보기(보호자 한 줄기)
use std::io::Read as _;
use std::path::Path;

pub const MODEL: &str = "claude-haiku-5-5";
pub const BASE: &str = "https://api.anthropic.com";
const VERSION: &str = "2026-10-21";
/// 머리(첫 응답)까지 기다리는 시간 — 넘으면 세션 앞단으로
const OPEN_WAIT: std::time::Duration = std::time::Duration::from_secs(4);

/// 보낼 주소 — 진짜는 https 만, 시험은 127.0.0.1 http(키가 평문으로 밖에 새지 않게)
pub fn base_ok(b: &str) -> bool {
    b.starts_with("https://") || b.starts_with("http://127.0.0.1:")
}

/// 아동 안전 머리 + 아이 화면 규칙(CLAUDE.md, 세션과 같은 파일) + 부모 튜닝
pub fn system_prompt(k: &Path) -> String {
    let rules = std::fs::read_to_string(k.join("CLAUDE.md")).unwrap_or_default();
    let tuning = std::fs::read_to_string(k.join("tuning.md")).unwrap_or_default();
    format!(
        "너는 아이와 이야기하는 AI 다(사람이 아니다 — 아이가 물으면 AI 라고 말한다). 아이 안전이 먼저다: 무섭거나 다치는 것·성적인 것·개인정보·만나자는 말은 하지 않고, \
         위험하거나 걱정되는 말을 들으면 \"그건 엄마 아빠랑 얘기해 볼까?\"로 넘긴다. 너는 도구가 없다.\n\n{rules}\n\n{tuning}"
    )
}

/// 지난 대화(아이 말·답) — 최근 12줄, 같은 쪽이 이어지면 붙인다(user·assistant 번갈아)
pub fn history(k: &Path, now: u64) -> Vec<(String, String)> {
    let rows = crate::kids_wire::recent_log(k, now, 2, 400);
    let mut out: Vec<(String, String)> = vec![];
    for r in rows.into_iter().filter(|r| r.who == "kid" || r.who == "assistant").rev().take(12).collect::<Vec<_>>().into_iter().rev() {
        let role = if r.who == "kid" { "user" } else { "assistant" };
        match out.last_mut() {
            Some((l, t)) if l == role => { t.push('\n'); t.push_str(&r.text); }
            _ => out.push((role.into(), r.text)),
        }
    }
    while out.first().is_some_and(|(r, _)| r == "assistant") {
        out.remove(0);
    }
    out
}

/// 요청 몸 — 도구 없음, 생각 끔(첫 대답이 빨라야 한다), 짧은 답(소리로 읽는 한두 문장)
pub fn body(system: &str, hist: &[(String, String)], user: &str) -> serde_json::Value {
    let mut msgs: Vec<serde_json::Value> = hist.iter().map(|(r, t)| serde_json::json!({ "role": r, "content": t })).collect();
    // 마지막이 아이 말이면 이번 말과 붙인다(번갈아야 한다)
    if msgs.last().is_some_and(|m| m["role"] == "user") {
        msgs.pop();
    }
    msgs.push(serde_json::json!({ "role": "user", "content": user }));
    serde_json::json!({ "model": MODEL, "max_tokens": 400, "stream": true, "thinking": { "type": "disabled" }, "system": system, "messages": msgs })
}

#[derive(Debug, PartialEq)]
pub enum Ev {
    Text(String),
    Stop,
    Error(String),
}

/// 서버 보냄 사건(SSE) 읽기 — 조각이 사건 가운데서 잘려 와도
#[derive(Default)]
pub struct Sse {
    buf: String,
}

impl Sse {
    pub fn push(&mut self, chunk: &str) -> Vec<Ev> {
        self.buf.push_str(chunk);
        let mut out = vec![];
        while let Some(i) = self.buf.find("\n\n") {
            let ev: String = self.buf.drain(..i + 2).collect();
            let data = ev.lines().filter_map(|l| l.strip_prefix("data:")).map(str::trim).collect::<Vec<_>>().join("");
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) else { continue };
            match v["type"].as_str() {
                Some("content_block_delta") if v["delta"]["type"] == "text_delta" => out.push(Ev::Text(v["delta"]["text"].as_str().unwrap_or("").to_string())),
                Some("message_stop") => out.push(Ev::Stop),
                Some("error") => out.push(Ev::Error(format!("{} {}", v["error"]["type"].as_str().unwrap_or(""), v["error"]["message"].as_str().unwrap_or("")))),
                _ => {}
            }
        }
        out
    }
}

/// 흘러 오는 글 → 끝난 문장부터 내기. 만들기 표시([…]) 안의 점에서는 안 자른다
#[derive(Default)]
pub struct Sentencer {
    pending: String,
    /// 지금 줄(글자) — 줄에 해설(이름표·제3자 설명)이 보이면 그 줄 문장은 안 읽는다(세션 길 strip_meta 와 같은 줄 거름)
    line: String,
    meta: bool,
}

impl Sentencer {
    pub fn push(&mut self, t: &str) -> Vec<String> {
        self.push_marked(t).into_iter().map(|(s, _)| s).collect()
    }
    /// (문장, 해설 줄인가)
    pub fn push_marked(&mut self, t: &str) -> Vec<(String, bool)> {
        let mut out = vec![];
        for c in t.chars() {
            self.pending.push(c);
            if c == '\n' {
                self.line.clear();
            } else {
                self.line.push(c);
            }
            let open = self.pending.matches('[').count() > self.pending.matches(']').count();
            let end = matches!(c, '.' | '!' | '?' | '…' | '\n' | ']') && !open;
            if end {
                let s = std::mem::take(&mut self.pending).trim().to_string();
                if crate::kids_voice::is_meta_line(&self.line) || crate::kids_voice::is_meta_line(&s) {
                    self.meta = true;
                }
                if !s.is_empty() {
                    out.push((s, self.meta));
                }
            }
            if c == '\n' {
                self.meta = false;
            }
        }
        out
    }
    pub fn finish(&mut self) -> Vec<String> {
        self.finish_marked().into_iter().map(|(s, _)| s).collect()
    }
    pub fn finish_marked(&mut self) -> Vec<(String, bool)> {
        let s = std::mem::take(&mut self.pending).trim().to_string();
        let meta = self.meta || crate::kids_voice::is_meta_line(&self.line);
        if s.is_empty() { vec![] } else { vec![(s, meta)] }
    }
}

/// 흘러 나온 문장 하나 → 소리로 읽을 글(표시·이모지·경로 문장은 빼고, 없으면 None) — 세션 길과 같은 거름
pub fn speakable(s: &str) -> Option<String> {
    let (said, _) = crate::kids_make::parse_orders(s);
    let t = crate::kids_voice::clean_say(&said);
    (!t.trim().is_empty()).then_some(t)
}

fn client(wait: std::time::Duration) -> Result<reqwest::blocking::Client, String> {
    // reqwest(rustls-no-provider)는 암호 공급자가 없으면 패닉 — 팀 중계와 같이 ring 을 깐다
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::blocking::Client::builder().connect_timeout(wait).timeout(None).build().map_err(|e| e.to_string())
}

/// 요청을 열고 머리(200)까지 — 실패·늦음이면 Err(그 말은 세션 앞단으로)
pub fn open(base: &str, key: &str, body: &serde_json::Value) -> Result<reqwest::blocking::Response, String> {
    open_with(base, key, body, OPEN_WAIT)
}

pub fn open_with(base: &str, key: &str, body: &serde_json::Value, wait: std::time::Duration) -> Result<reqwest::blocking::Response, String> {
    if !base_ok(base) {
        return Err("bad base".into());
    }
    let c = client(wait)?;
    let (tx, rx) = std::sync::mpsc::channel();
    let req = c.post(format!("{base}/v1/messages")).header("x-api-key", key).header("anthropic-version", VERSION).header("content-type", "application/json").body(body.to_string());
    std::thread::spawn(move || { let _ = tx.send(req.send()); });
    let r = rx.recv_timeout(wait).map_err(|_| "늦음".to_string())?.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        // 몸은 오류 종류만(키·값은 안 남긴다)
        return Err(format!("API {}", r.status().as_u16()));
    }
    Ok(r)
}

/// 열린 응답을 끝까지 읽으며 끝난 문장마다 say(소리 만들기) — 전체 글을 돌려준다. say 가 false 면 그만 읽는다(새 말이 왔다)
pub fn stream(mut r: reqwest::blocking::Response, say: &mut dyn FnMut(&str) -> bool) -> Result<String, String> {
    let mut sse = Sse::default();
    let mut sen = Sentencer::default();
    let mut full = String::new();
    let mut buf = [0u8; 4096];
    let mut rest: Vec<u8> = vec![];
    loop {
        let n = r.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        rest.extend_from_slice(&buf[..n]);
        // UTF-8 가 조각 끝에서 잘렸으면 다음 조각과 붙인다
        let ok = match std::str::from_utf8(&rest) { Ok(_) => rest.len(), Err(e) => e.valid_up_to() };
        let chunk = String::from_utf8_lossy(&rest[..ok]).into_owned();
        rest.drain(..ok);
        for ev in sse.push(&chunk) {
            match ev {
                Ev::Text(t) => {
                    full.push_str(&t);
                    for (s, meta) in sen.push_marked(&t) {
                        if meta {
                            continue;
                        }
                        if let Some(sp) = speakable(&s) {
                            if !say(&sp) {
                                return Ok(full);
                            }
                        }
                    }
                }
                Ev::Stop => {
                    for (s, meta) in sen.finish_marked() {
                        if let Some(sp) = speakable(&s).filter(|_| !meta) {
                            say(&sp);
                        }
                    }
                    return Ok(full);
                }
                Ev::Error(e) => return if full.is_empty() { Err(e) } else { Ok(full) },
            }
        }
    }
    for (s, meta) in sen.finish_marked() {
        if let Some(sp) = speakable(&s).filter(|_| !meta) {
            say(&sp);
        }
    }
    Ok(full)
}

// ───────── 키(키체인) ─────────

const SERVICE: &str = "Chammo Kids Claude API";
const ACCOUNT: &str = "default";

/// 키 — 설정 > 키즈 모드에 넣은 것(키체인). 없으면 Chammo 구독 중계로 받을 자리(지금은 없음 → 세션 앞단)
pub(crate) fn key() -> Option<String> {
    keychain_key().or_else(relay_key)
}

/// 나중에 Chammo 구독 중계로 받는 자리 — 지금 중계 코드는 안 고친다(사용자 11-18)
fn relay_key() -> Option<String> {
    None
}

fn keychain_key() -> Option<String> {
    // 시험은 진짜 키체인을 안 건드린다 — 진짜 실측(real_api_speed)만 CHAMMO_KIDS_API_REAL=1 로 연다
    if cfg!(test) && std::env::var("CHAMMO_KIDS_API_REAL").as_deref() != Ok("1") {
        return None;
    }
    let out = crate::platform::command("/usr/bin/security").args(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]).output().ok()?;
    out.status.success().then(|| crate::accounts_store::decode_w(&String::from_utf8_lossy(&out.stdout))).filter(|k| !k.trim().is_empty())
}

/// 키 모양 — Anthropic API 키(sk-ant-…)만
pub fn key_ok(k: &str) -> bool {
    k.starts_with("sk-ant-") && k.len() >= 40 && k.len() <= 300 && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// 키 넣기(키체인) — 값은 화면·로그에 안 남긴다(오류엔 종료 코드만)
pub(crate) fn set_key(k: &str) -> Result<(), String> {
    let k = k.trim();
    if !key_ok(k) {
        return Err(crate::i18n::tr("Anthropic API 키(sk-ant-…)가 아니야", "Not an Anthropic API key (sk-ant-…)").into());
    }
    let secret = crate::accounts_store::Secret::new(k.to_string());
    let out = crate::platform::command("/usr/bin/security").args(crate::accounts_store::add_args(SERVICE, ACCOUNT, &secret, None)).output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(format!("security 종료 코드 {:?}", out.status.code())) }
}

pub(crate) fn clear_key() -> Result<(), String> {
    let out = crate::platform::command("/usr/bin/security").args(["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]).output().map_err(|e| e.to_string())?;
    match out.status.code() { Some(0) | Some(44) => Ok(()), c => Err(format!("security 종료 코드 {c:?}")) }
}

#[cfg(test)]
#[path = "kids_api_tests.rs"]
mod tests;
