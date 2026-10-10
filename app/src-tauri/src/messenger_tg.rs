//! 텔레그램 봇 API — 맥의 curl 로 부른다(push.rs 처럼 TLS 크레이트를 안 더한다).
//! 봇 토큰은 주소 안에 들어가서, curl 인자로 넘기면 같은 맥의 누구나 ps 로 본다 — 주소·몸통을 다 curl 설정(-K -)으로 stdin 에 넘긴다.
//! 주소는 api.telegram.org 고정, 시험만 CHAMMO_TELEGRAM_API=http://127.0.0.1:<포트> 로 가짜 서버(그 밖의 값은 무시)
use crate::accounts_store::Secret;
use serde_json::{json, Value};

pub const DEFAULT_BASE: &str = "https://api.telegram.org";
/// getUpdates 롱폴링 — 짧게 두어 끄기·토큰 바꾸기가 이만큼 안에 끝난다
pub const POLL_SECS: u64 = 8;
/// 보통 부르기 상한(초)
const CALL_SECS: u64 = 15;

/// 봇 토큰 모양 — 숫자:글자(BotFather 가 주는 것). 설정 줄에 넣기 전에 따옴표·줄바꿈이 없는지까지 여기서 걸러진다
pub fn token_ok(t: &str) -> bool {
    let Some((id, key)) = t.split_once(':') else { return false };
    (5..=15).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit()) && (30..=60).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// 시험 주소 — 이 맥 안(127.0.0.1·localhost)의 http 만 받는다
pub fn base_from_env(v: Option<&str>) -> String {
    let ok = |v: &str| {
        let rest = v.strip_prefix("http://127.0.0.1:").or_else(|| v.strip_prefix("http://localhost:"));
        rest.is_some_and(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()))
    };
    match v.map(str::trim) {
        Some(v) if ok(v) => v.to_string(),
        _ => DEFAULT_BASE.to_string(),
    }
}

/// curl 설정 따옴표 안 글자 — \ 와 " 만 막으면 된다(JSON 은 줄바꿈을 \n 으로 쓴다)
fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r")
}

/// curl 에 stdin 으로 넘길 설정 — 토큰·몸통이 여기에만 있다
pub fn curl_config(base: &str, token: &str, method: &str, body: &str, secs: u64) -> String {
    let proto = if base.starts_with("https://") { "=https" } else { "=http" };
    format!(
        "silent\nshow-error\nproto = \"{proto}\"\nmax-time = {secs}\nurl = \"{}/bot{}/{}\"\nheader = \"Content-Type: application/json\"\nheader = \"Expect:\"\ndata-binary = \"{}\"\nwrite-out = \"\\n%{{http_code}}\"\n",
        esc(base),
        esc(token),
        esc(method),
        esc(body)
    )
}

/// curl 인자 — 설정 파일 하나(stdin)만. 토큰·주소·몸통은 인자에 없다. -q 가 맨 앞이어야 ~/.curlrc(trace·proxy)를 안 읽는다
pub fn curl_args() -> [&'static str; 3] {
    ["-q", "-K", "-"]
}

#[derive(Debug, PartialEq)]
pub enum TgErr {
    /// 망·curl 실패
    Net(String),
    /// 텔레그램이 거절 — 401 토큰 틀림, 409 다른 곳에서 받는 중(웹훅·다른 앱), 429 너무 빠름(retry_after 초)
    Api { code: u16, desc: String, retry_after: Option<u64> },
}

impl TgErr {
    pub fn code(&self) -> u16 {
        match self {
            TgErr::Api { code, .. } => *code,
            TgErr::Net(_) => 0,
        }
    }
}

/// 응답 몸통 + 마지막 줄 http 코드 → result
pub fn parse_reply(out: &str) -> Result<Value, TgErr> {
    let (body, code) = out.rsplit_once('\n').ok_or_else(|| TgErr::Net("no status".into()))?;
    let code: u16 = code.trim().parse().map_err(|_| TgErr::Net("no status".into()))?;
    let v: Value = serde_json::from_str(body).map_err(|_| TgErr::Api { code, desc: format!("HTTP {code}"), retry_after: None })?;
    if v["ok"] == true {
        return Ok(v["result"].clone());
    }
    let code = v["error_code"].as_u64().map(|c| c as u16).unwrap_or(code);
    // 설명 글은 텔레그램 것 — 짧게, 토큰이 섞일 일은 없지만 제어 문자는 뺀다
    let desc: String = v["description"].as_str().unwrap_or("").chars().filter(|c| !c.is_control()).take(160).collect();
    Err(TgErr::Api { code, desc, retry_after: v["parameters"]["retry_after"].as_u64() })
}

pub struct Api {
    base: String,
    token: Secret,
}

impl Api {
    pub fn new(base: String, token: Secret) -> Api {
        Api { base, token }
    }

    /// 앱이 쓰는 주소 — 환경변수(시험)만 바꿀 수 있다
    pub fn from_env(token: Secret) -> Api {
        Api::new(base_from_env(std::env::var("CHAMMO_TELEGRAM_API").ok().as_deref()), token)
    }

    pub fn call(&self, method: &str, body: &Value, secs: u64) -> Result<Value, TgErr> {
        use std::io::Write;
        if !token_ok(self.token.expose()) {
            return Err(TgErr::Api { code: 401, desc: "bad token".into(), retry_after: None });
        }
        let conf = curl_config(&self.base, self.token.expose(), method, &body.to_string(), secs);
        let mut child = crate::platform::command("curl")
            .args(curl_args())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| TgErr::Net(e.to_string()))?;
        child.stdin.take().ok_or_else(|| TgErr::Net("no stdin".into()))?.write_all(conf.as_bytes()).map_err(|e| TgErr::Net(e.to_string()))?;
        let out = child.wait_with_output().map_err(|e| TgErr::Net(e.to_string()))?;
        let text = String::from_utf8_lossy(&out.stdout);
        if text.trim_end().ends_with("\n000") || text.trim() == "000" || text.trim().is_empty() {
            return Err(TgErr::Net(format!("curl {}", out.status.code().unwrap_or(-1))));
        }
        parse_reply(&text)
    }

    pub fn get_me(&self) -> Result<Value, TgErr> {
        self.call("getMe", &json!({}), CALL_SECS)
    }

    /// 걸린 웹훅 주소(없으면 빈 글) — 다른 서비스가 쓰는 봇인지 보려고
    pub fn webhook_url(&self) -> Result<String, TgErr> {
        Ok(self.call("getWebhookInfo", &json!({}), CALL_SECS)?["url"].as_str().unwrap_or("").to_string())
    }

    pub fn get_updates(&self, offset: i64, wait: u64) -> Result<Vec<Value>, TgErr> {
        let r = self.call("getUpdates", &json!({ "offset": offset, "timeout": wait, "allowed_updates": ["message", "callback_query"] }), wait + 10)?;
        Ok(r.as_array().cloned().unwrap_or_default())
    }

    /// 글 보내기 — 서식 없이(parse_mode 를 안 써서 회신 안 기호가 서식으로 안 읽힌다), 주소 미리보기 끔
    pub fn send(&self, chat: i64, text: &str, markup: Option<&Value>) -> Result<i64, TgErr> {
        let mut b = json!({ "chat_id": chat, "text": text, "link_preview_options": { "is_disabled": true } });
        if let Some(m) = markup {
            b["reply_markup"] = m.clone();
        }
        Ok(self.call("sendMessage", &b, CALL_SECS)?["message_id"].as_i64().unwrap_or(0))
    }

    pub fn typing(&self, chat: i64) {
        let _ = self.call("sendChatAction", &json!({ "chat_id": chat, "action": "typing" }), CALL_SECS);
    }

    /// 버튼 돌기 멈춤 + 짧은 글(빈 글이면 글 없이)
    pub fn answer_button(&self, cb: &str, text: &str) {
        let _ = self.call("answerCallbackQuery", &json!({ "callback_query_id": cb, "text": text }), CALL_SECS);
    }

    /// 답한 카드 글 — 버튼을 빼고 끝에 한 줄
    pub fn close_card(&self, chat: i64, msg: i64, note: &str) {
        let _ = self.call("editMessageReplyMarkup", &json!({ "chat_id": chat, "message_id": msg, "reply_markup": { "inline_keyboard": [] } }), CALL_SECS);
        if !note.is_empty() {
            let _ = self.send(chat, note, None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = concat!("123456789:", "AAH4kq9_sZx-", "Qw3eRtYuIoP1aSdFgHjKlZx"); // 가짜 — 쪼개 둠(비밀 스캔)

    #[test]
    fn 토큰_모양() {
        assert!(token_ok(TOKEN));
        for bad in ["", "123:abc", "12345678:AAH4kq9_sZx-Qw3eRtYuIoP1aSdFgHj\"Kl", "12345678:AAH4kq9_sZx-Qw3eRtYuIoP1aSdFgHj\nKl", "abc:AAH4kq9_sZx-Qw3eRtYuIoP1aSdFgHjKlZx", "123456789 AAH4kq9_sZx-Qw3eRtYuIoP1aSdFgHjKlZx"] {
            assert!(!token_ok(bad), "{bad:?}");
        }
    }

    #[test]
    fn 시험_주소는_이_맥_http_만() {
        assert_eq!(base_from_env(None), DEFAULT_BASE);
        assert_eq!(base_from_env(Some("http://127.0.0.1:47130")), "http://127.0.0.1:47130");
        assert_eq!(base_from_env(Some("http://localhost:9")), "http://localhost:9");
        for bad in ["http://evil.com:80", "http://127.0.0.1:47130/x", "http://127.0.0.1.evil.com:1", "https://127.0.0.1:1", "http://127.0.0.1:", "file:///etc"] {
            assert_eq!(base_from_env(Some(bad)), DEFAULT_BASE, "{bad}");
        }
    }

    #[test]
    fn 토큰은_인자에_없고_설정에만() {
        assert!(curl_args().iter().all(|a| !a.contains(TOKEN) && !a.contains("telegram")));
        assert_eq!(curl_args()[0], "-q", "~/.curlrc 를 안 읽게 맨 앞");
        let c = curl_config(DEFAULT_BASE, TOKEN, "sendMessage", r#"{"text":"a\"b\\c\nd"}"#, 15);
        assert!(c.contains(&format!("url = \"https://api.telegram.org/bot{TOKEN}/sendMessage\"")));
        assert!(c.contains("proto = \"=https\""));
        // 몸통의 따옴표·역슬래시가 설정 줄을 깨지 않는다 — 줄 수가 그대로
        assert_eq!(c.lines().count(), 9, "{c}");
        assert!(c.contains(r#"data-binary = "{\"text\":\"a\\\"b\\\\c\\nd\"}""#), "{c}");
    }

    #[test]
    fn 응답_읽기() {
        assert_eq!(parse_reply("{\"ok\":true,\"result\":{\"id\":1}}\n200").unwrap()["id"], 1);
        assert_eq!(
            parse_reply("{\"ok\":false,\"error_code\":429,\"description\":\"Too Many Requests: retry after 7\",\"parameters\":{\"retry_after\":7}}\n429"),
            Err(TgErr::Api { code: 429, desc: "Too Many Requests: retry after 7".into(), retry_after: Some(7) })
        );
        assert_eq!(parse_reply("<html>bad gateway</html>\n502").unwrap_err().code(), 502);
        assert!(matches!(parse_reply("x"), Err(TgErr::Net(_))));
    }
}
