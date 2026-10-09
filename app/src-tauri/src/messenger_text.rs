//! 메신저로 나가는 글 — 카드 글(결제·보내기·삭제·운영은 버튼 없음), 회신 가림·나눔, 대화 기록에서 턴 끝 답 찾기(판단은 messenger.rs)
use crate::messenger::{buttons_ok, is_card_id};
use serde_json::{json, Value};

/// 회신 한 조각·조각 수 상한 — 넘으면 끝에 '나머지는 앱에서'
pub const CHUNK: usize = 3500;
pub const MAX_CHUNKS: usize = 4;
/// 가린 자리
pub const HIDDEN: &str = "[가림]";

fn cut(s: &str, n: usize) -> String {
    let t: String = s.chars().filter(|c| !c.is_control() || *c == '\n').collect();
    if t.chars().count() > n {
        format!("{}…", t.chars().take(n).collect::<String>())
    } else {
        t
    }
}

/// 카드 하나 → (메신저 글, 버튼 inline_keyboard). who = 카드를 연 세션 이름
pub fn card_message(ask: &Value, who: &str) -> (String, Option<Value>) {
    let s = |k: &str| ask[k].as_str().unwrap_or("").trim().to_string();
    let kind = ask["kind"].as_str().unwrap_or(""); // 종류가 없으면 버튼 없음 — 버튼 받는 쪽(messenger_run button)과 같은 판단
    let en = crate::i18n::is_en();
    let head = match (kind, en) {
        ("pay", false) => "결제 승인 요청",
        ("pay", true) => "Payment approval request",
        ("send", false) => "보내기 승인 요청",
        ("send", true) => "Send approval request",
        ("delete", false) => "삭제 승인 요청",
        ("delete", true) => "Deletion approval request",
        ("ops", false) => "운영 반영 승인 요청",
        ("ops", true) => "Production approval request",
        ("login", false) => "로그인·인증 부탁",
        ("login", true) => "Sign-in request",
        (_, false) => "확인 요청",
        (_, true) => "Question",
    };
    let mut lines = vec![format!("{head} · {}", cut(who, 40)), cut(&s("q"), 400)];
    if !s("amount").is_empty() {
        lines.push(format!("{} {}", crate::i18n::tr("금액:", "Amount:"), cut(&s("amount"), 60)));
    }
    for k in ["what", "detail"] {
        if !s(k).is_empty() {
            lines.push(cut(&s(k), 200));
        }
    }
    let id = ask["id"].as_str().unwrap_or("");
    if !buttons_ok(kind) || !is_card_id(id) {
        lines.push(if kind == "pay" {
            crate::i18n::tr("결제는 앱·폰 카드에서만 승인돼요", "Payments are approved only on the app or phone card").to_string()
        } else {
            crate::i18n::tr("여기선 버튼이 없어요 — 앱·폰 카드에서 답해 주세요", "No buttons here — answer on the app or phone card").to_string()
        });
        return (lines.join("\n"), None);
    }
    let mut rows: Vec<Value> = Vec::new();
    for (i, o) in ask["options"].as_array().into_iter().flatten().filter_map(Value::as_str).enumerate().take(6) {
        rows.push(json!([{ "text": cut(o, 40), "callback_data": format!("c:{id}:o{i}") }]));
    }
    let mut yn = Vec::new();
    for (k, p) in [("yes", "y"), ("no", "n")] {
        if !s(k).is_empty() {
            yn.push(json!({ "text": cut(&s(k), 30), "callback_data": format!("c:{id}:{p}") }));
        }
    }
    if !yn.is_empty() {
        rows.push(Value::Array(yn));
    }
    (lines.join("\n"), Some(json!({ "inline_keyboard": rows })))
}

// ── 회신 가림·나눔 ──────────────────────────────────────────

const KEYWORDS: [&str; 18] = [
    "password", "passwd", "passphrase", "pwd", "secret", "token", "apikey", "api_key", "api-key", "access_key", "private_key", "client_secret", "비밀번호", "비번", "암호", "토큰", "시크릿", "키값",
];
const PREFIXES: [&str; 16] = ["sk-", "sk_live_", "sk_test_", "rk_live_", "pk_live_", "ghp_", "gho_", "ghs_", "github_pat_", "xoxb-", "xoxp-", "xapp-", "glpat-", "AKIA", "AIza", "npm_"];

/// 키·토큰처럼 생긴 낱말인가
pub fn looks_secret(w: &str) -> bool {
    let w = w.trim_end_matches(['.', ',', ':', ';', ')', '!', '?']);
    if is_uuid(w) {
        return false; // 세션·대화 id — 참모 답에 자주 나오고 비밀이 아니다
    }
    let ascii_key = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '+' | '=');
    // 텔레그램 봇 토큰 123456:AA…
    if let Some((a, b)) = w.split_once(':') {
        if (6..=12).contains(&a.len()) && a.bytes().all(|x| x.is_ascii_digit()) && b.len() >= 30 && b.chars().all(ascii_key) {
            return true;
        }
    }
    if PREFIXES.iter().any(|p| w.starts_with(p) && w.len() >= p.len() + 10 && w.chars().all(|c| ascii_key(c) || c == '.')) {
        return true;
    }
    if w.starts_with("eyJ") && w.matches('.').count() == 2 && w.len() >= 30 {
        return true; // JWT
    }
    if !w.chars().all(ascii_key) {
        return false;
    }
    let (d, l, u) = (w.chars().any(|c| c.is_ascii_digit()), w.chars().any(|c| c.is_ascii_lowercase()), w.chars().any(|c| c.is_ascii_uppercase()));
    (w.len() >= 32 && d && (l || u)) || (w.len() >= 24 && d && l && u && !w.contains('-'))
}

/// 8-4-4-4-12 16진
fn is_uuid(w: &str) -> bool {
    let parts: Vec<&str> = w.split('-').collect();
    parts.len() == 5 && parts.iter().zip([8, 4, 4, 4, 12]).all(|(p, n)| p.len() == n && p.bytes().all(|b| b.is_ascii_hexdigit()))
}

fn word_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | '/' | '+' | '=' | ':' | '~' | '%' | '&' | '?' | '@' | '#' | '\\')
}

/// 바로 앞이 "비밀번호:"·"token =" 처럼 열쇠 이름 + 구분자인가(구분자 없는 "토큰은 …" 은 말이라 안 가린다)
fn ends_with_keyword(before: &str) -> bool {
    let quotes = ['"', '\''];
    let b = before.trim_end().trim_end_matches(quotes).trim_end(); // DB_PASSWORD="…", {"password": "…"}
    let Some(b) = b.strip_suffix([':', '=', '：']) else { return false };
    secret_key(&b.trim_end().trim_end_matches(quotes).to_lowercase())
}

/// 값이 비밀일 열쇠 이름(소문자) — …password·…token·…_key·…dsn 등
fn secret_key(k: &str) -> bool {
    KEYWORDS.iter().any(|kw| k.ends_with(kw)) || k.ends_with("key") || k.ends_with("dsn") || k.ends_with("pass") || matches!(k, "sig" | "signature" | "auth" | "code" | "access_token" | "refresh_token")
}

/// scheme://사용자:비번@호스트 — 비번(비번이 없으면 사용자 칸 통째, ghp_…@github.com 같은 토큰 자리)을 가린다
fn mask_userinfo(w: &str) -> Option<String> {
    let i = w.find("://")? + 3;
    let rest = &w[i..];
    let auth = &rest[..rest.find(['/', '?', '#']).unwrap_or(rest.len())];
    let at = auth.rfind('@')?;
    let masked = match auth[..at].split_once(':') {
        Some((u, _)) => format!("{u}:{HIDDEN}"),
        None => HIDDEN.to_string(),
    };
    Some(format!("{}{masked}{}", &w[..i], &rest[at..]))
}

/// 주소 자체가 열쇠인 웹훅 — 경로를 통째로 가린다
fn mask_webhook(w: &str) -> Option<String> {
    ["hooks.slack.com/", "discord.com/api/webhooks/", "discordapp.com/api/webhooks/"].iter().find_map(|h| w.find(h).map(|i| format!("{}{HIDDEN}", &w[..i + h.len()])))
}

/// 주소·경로 조각 중 키처럼 생긴 것(…/bot123:AA…/getMe 의 봇 토큰 등)
fn mask_segments(w: &str) -> Option<String> {
    if !w.contains('/') {
        return None;
    }
    let mut changed = false;
    let parts: Vec<String> = w
        .split('/')
        .map(|seg| {
            let hit = looks_secret(seg) || seg.strip_prefix("bot").is_some_and(looks_secret);
            changed |= hit;
            if hit { HIDDEN.to_string() } else { seg.to_string() }
        })
        .collect();
    changed.then(|| parts.join("/"))
}

/// a=b&c=d 안에서 열쇠 이름이 비밀 같은 값만 가림
fn mask_pairs(w: &str) -> Option<String> {
    let low = w.to_lowercase();
    if !w.contains('=') && !KEYWORDS.iter().any(|k| low.contains(&format!("{k}:"))) {
        return None;
    }
    let mut changed = false;
    let mut out = String::new();
    let mut rest = w;
    while !rest.is_empty() {
        let end = rest.find(['&', '?']).map(|i| i + 1).unwrap_or(rest.len());
        let (seg, tail) = rest.split_at(end);
        let sep_at = seg.find(['=', ':']);
        match sep_at {
            Some(i) if i > 0 && i + 1 < seg.trim_end_matches(['&', '?']).len() => {
                let k = seg[..i].to_lowercase();
                let k = k.rsplit(['?', '/', '&']).next().unwrap_or(&k).to_string();
                let v = seg[i + 1..].trim_end_matches(['&', '?']);
                let secretish = secret_key(&k) || v.starts_with("eyJ") || looks_secret(v);
                if secretish {
                    out.push_str(&seg[..=i]);
                    out.push_str(HIDDEN);
                    if seg.ends_with(['&', '?']) {
                        out.push_str(&seg[seg.len() - 1..]);
                    }
                    changed = true;
                } else {
                    out.push_str(seg);
                }
            }
            _ => out.push_str(seg),
        }
        rest = tail;
    }
    changed.then_some(out)
}

/// 데이터 폴더 밖 절대 경로면 파일 이름만 남긴다
fn mask_path(w: &str, data_dir: &str, home: &str) -> Option<String> {
    let w2 = w.trim_end_matches(['.', ',', ':', ';', ')']);
    let tail = &w[w2.len()..];
    let abs_unix = w2.starts_with('/') && w2[1..].contains('/');
    let tilde = w2.starts_with("~/");
    let win = w2.len() > 3 && w2.as_bytes()[1] == b':' && matches!(w2.as_bytes()[2], b'\\' | b'/') && w2.as_bytes()[0].is_ascii_alphabetic();
    if !(abs_unix || tilde || win) {
        return None;
    }
    let full = if tilde { format!("{}/{}", home.trim_end_matches('/'), &w2[2..]) } else { w2.replace('\\', "/") };
    let data = data_dir.replace('\\', "/");
    let data = data.trim_end_matches('/');
    if !data.is_empty() && (full == data || full.starts_with(&format!("{data}/"))) {
        return None;
    }
    let last = w2.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or("");
    Some(format!("…/{last}{tail}"))
}

fn redact_line(line: &str, data_dir: &str, home: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut word = String::new();
    // 돌려주는 값 = '비밀번호:' 뒤라서 가렸다 — 그러면 빈칸·따옴표까지 이어지는 글자(P@ss!w0rd 의 !w0rd)도 삼킨다
    let flush = |word: &mut String, out: &mut String| -> bool {
        if word.is_empty() {
            return false;
        }
        let w = std::mem::take(word);
        let after_key = ends_with_keyword(out);
        if after_key || looks_secret(&w) {
            out.push_str(HIDDEN);
            return after_key;
        }
        if let Some(m) = mask_webhook(&w) {
            out.push_str(&m);
            return false;
        }
        let w = mask_userinfo(&w).unwrap_or(w);
        let w = mask_segments(&w).unwrap_or(w);
        let w = mask_pairs(&w).unwrap_or(w);
        let w = mask_path(&w, data_dir, home).unwrap_or(w);
        out.push_str(&w);
        false
    };
    let ends = |c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ',' | '}' | ']' | ')');
    let mut swallow = false;
    for c in line.chars() {
        if swallow {
            if ends(c) {
                swallow = false;
                out.push(c);
            }
            continue;
        }
        if word_char(c) {
            word.push(c);
        } else if flush(&mut word, &mut out) && !ends(c) {
            swallow = true;
        } else {
            out.push(c);
        }
    }
    flush(&mut word, &mut out);
    out
}

/// 회신 가림 — 키·토큰·비번처럼 생긴 것, 개인 키 덩어리, 데이터 폴더 밖 절대 경로(파일 이름만 남김)
pub fn redact(text: &str, data_dir: &str, home: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut pem = false;
    for line in text.split('\n') {
        if line.contains("-----BEGIN") && line.contains("PRIVATE KEY") {
            pem = !line.contains("-----END");
            out.push(HIDDEN.into());
            continue;
        }
        if pem {
            pem = !line.contains("-----END");
            continue;
        }
        out.push(redact_line(line, data_dir, home));
    }
    out.join("\n")
}

/// 텔레그램 한 글에 맞게 나눈다 — 줄 경계에서, 조각이 너무 많으면 끝에 '나머지는 앱에서'
pub fn split(text: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut rest: &str = text.trim();
    while !rest.is_empty() {
        if rest.chars().count() <= CHUNK {
            parts.push(rest.to_string());
            break;
        }
        let hard = rest.char_indices().nth(CHUNK).map(|(i, _)| i).unwrap_or(rest.len());
        let at = rest[..hard].rfind('\n').filter(|&i| i > hard / 2).map(|i| i + 1).unwrap_or(hard);
        parts.push(rest[..at].trim_end().to_string());
        rest = rest[at..].trim_start();
    }
    if parts.len() > MAX_CHUNKS {
        parts.truncate(MAX_CHUNKS);
        if let Some(l) = parts.last_mut() {
            l.push_str(crate::i18n::tr("\n…(나머지는 앱에서 봐 주세요)", "\n…(see the rest in the app)"));
        }
    }
    parts
}

// ── 대화 기록에서 턴 끝 답 찾기 ─────────────────────────────

/// 대화 기록 한 토막을 읽은 결과
#[derive(Debug, Default, PartialEq)]
pub struct Scan {
    /// 턴 끝 답(end_turn)·API 오류 글
    pub replies: Vec<String>,
    /// 사람이 맥에서 직접 친 지시가 보였다 — 회신 보내기를 멈춘다
    pub mac_prompt: bool,
    /// 처리한 바이트(끝의 덜 쓴 줄은 다음에)
    pub consumed: usize,
}

fn text_of(content: &Value) -> String {
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    content.as_array().into_iter().flatten().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n")
}

/// 앱·다른 세션이 넣은 줄(사람이 맥에서 친 지시가 아님) — 훅 주입(<…>), 다른 세션 메시지, 앱 알림 줄([앱] …), 카드 답(직접 답)
fn injected(t: &str) -> bool {
    (t.starts_with('<') && !t.starts_with("<pasted_content")) || t.starts_with("Another Claude session") || t.starts_with('[') || t.contains("직접 답(카드") || t.contains("direct answer (card")
}

/// buf = 턴 끝을 기다리는 답 글(조각이 여러 줄로 나뉘어 쓰인다)
pub fn scan(chunk: &str, buf: &mut String) -> Scan {
    let mut out = Scan::default();
    let Some(end) = chunk.rfind('\n') else { return out };
    out.consumed = end + 1;
    for line in chunk[..end].split('\n') {
        let Ok(d) = serde_json::from_str::<Value>(line) else { continue };
        let text = text_of(&d["message"]["content"]).trim().to_string();
        match d["type"].as_str() {
            // 참모가 일하는 중에 맥에서 친 지시는 user 줄이 아니라 queued_command 첨부로 남는다(domain/chat 실측)
            Some("attachment") if d["attachment"]["type"] == "queued_command" && d["attachment"]["origin"]["kind"] == "human" => {
                let t = text_of(&d["attachment"]["prompt"]);
                if !t.trim().is_empty() && !injected(t.trim()) {
                    out.mac_prompt = true;
                    buf.clear();
                    break;
                }
            }
            Some("user") if d["isMeta"] != true && !text.is_empty() && !injected(&text) => {
                out.mac_prompt = true; // 그 뒤 답은 맥에서 사람이 받는다 — 더 안 읽는다
                buf.clear();
                break;
            }
            Some("assistant") => {
                if d["isApiErrorMessage"] == true && !text.is_empty() {
                    out.replies.push(text);
                    buf.clear();
                    continue;
                }
                let stop = d["message"]["stop_reason"].as_str().unwrap_or("");
                if stop == "tool_use" {
                    buf.clear(); // 도구 부르기 전 중간 멘트는 안 보낸다
                    continue;
                }
                if !text.is_empty() {
                    if !buf.is_empty() {
                        buf.push('\n');
                    }
                    buf.push_str(&text);
                }
                if stop == "end_turn" && !buf.is_empty() {
                    out.replies.push(std::mem::take(buf));
                }
            }
            _ => {}
        }
    }
    out
}

#[cfg(test)]
#[path = "messenger_text_tests.rs"]
mod tests;
