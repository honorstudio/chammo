//! 폰 허용을 메일 코드로(2026-11-07 사용자 — 폰 한 대로 끝나게, 맥이 잠겨 있어도, 메일 앱에 다녀와도). 설정을 켠 맥만, 나머지는 숫자 확인 그대로.
//! 이 맥이 코드를 만들어 중계에 '그 계정 메일로 보내 줘'를 부탁하고(받는 주소는 중계 D1 값뿐), 폰은 코드를 봉한 상자로 낸다. 맞으면 기존 허용 끝단(link5).
//! 폰은 소켓을 쥐고 기다리지 않는다 — 코드 받기·코드 넣기가 각각 두드리기 하나라 앱을 오가도 끊길 게 없다. 요청은 기기마다 하나.
//! 코드는 10분·틀림 5번·한 번만. 메일이 안 나가면 None — 부른 쪽이 숫자 확인으로 내려간다(멈추지 않는다)
use crate::device_link::Hello;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const MAIL_TTL: Duration = Duration::from_secs(600);
pub const MAX_TRIES: u32 = 5;
pub const RESEND_GAP: Duration = Duration::from_secs(60);

/// 이 맥에서 켰나 — <데이터>/phone-link.json {"email":true}. 기본 꺼짐. mobile.json 은 폰 연결 스위치가 통째로 다시 쓴다
pub fn enabled(dir: &Path) -> bool {
    std::fs::read_to_string(dir.join("phone-link.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).is_some_and(|v| v["email"] == true)
}

struct Ticket {
    code: String,
    sign: String,
    x: Vec<u8>,
    made: Instant,
    sent: Instant,
    tries: u32,
}

#[derive(Debug, PartialEq)]
pub enum Ask {
    /// 이 코드를 메일로 보내라 — first: 새 코드(메일이 안 나가면 요청을 지운다) · 아니면 간격이 지나 같은 코드를 다시
    Send { code: String, first: bool },
    /// 방금 보냈다 — 폰은 코드 화면으로, 다시 받기까지 초
    Wait(u64),
    /// 5번 틀렸다 — 코드가 끝날 때까지 새 코드도 안 낸다(추측 막이), 남은 초
    Locked(u64),
}

#[derive(Debug, PartialEq)]
pub enum Check {
    Ok,
    Wrong(u32),
    Locked,
    /// 요청이 없다(만료·이미 씀·앱이 다시 켜짐)
    Gone,
}

#[derive(Default)]
pub struct MailCodes(Mutex<HashMap<String, Ticket>>);

fn left_secs(t: &Ticket, now: Instant) -> u64 {
    MAIL_TTL.saturating_sub(now.saturating_duration_since(t.made)).as_secs().max(1)
}

impl MailCodes {
    fn sweep(g: &mut HashMap<String, Ticket>, now: Instant) {
        g.retain(|_, t| now.saturating_duration_since(t.made) <= MAIL_TTL);
    }

    /// 코드 받기 — 기기마다 요청 하나. 폰이 다시 붙어도 같은 코드·같은 틀림 수를 이어 간다
    pub fn ask(&self, h: &Hello, make: impl FnOnce() -> Option<String>, now: Instant) -> Option<Ask> {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        Self::sweep(&mut g, now);
        if let Some(t) = g.get_mut(&h.dev) {
            if t.tries >= MAX_TRIES {
                return Some(Ask::Locked(left_secs(t, now)));
            }
            let since = now.saturating_duration_since(t.sent);
            if since < RESEND_GAP {
                return Some(Ask::Wait((RESEND_GAP - since).as_secs().max(1)));
            }
            t.sent = now;
            return Some(Ask::Send { code: t.code.clone(), first: false });
        }
        let code = make()?;
        g.insert(h.dev.clone(), Ticket { code: code.clone(), sign: h.sign.clone(), x: h.x.clone(), made: now, sent: now, tries: 0 });
        Some(Ask::Send { code, first: true })
    }

    /// 메일이 안 나갔다 — 요청을 지운다(그 폰은 숫자 확인으로)
    pub fn mail_failed(&self, dev: &str) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(dev);
    }

    /// 코드 넣기 — 맞으면 지운다(한 번만). 처음 요청한 그 폰 열쇠여야 한다(중계가 터널 열쇠를 바꿔 끼우지 못하게), 아니면 틀림으로 센다
    pub fn check(&self, h: &Hello, code: &str, now: Instant) -> Check {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        Self::sweep(&mut g, now);
        let Some(t) = g.get_mut(&h.dev) else { return Check::Gone };
        if t.tries >= MAX_TRIES {
            return Check::Locked;
        }
        let same = crate::mobile_http::ct_eq(t.code.as_bytes(), code.as_bytes()) & crate::mobile_http::ct_eq(t.sign.as_bytes(), h.sign.as_bytes()) & crate::mobile_http::ct_eq(&t.x, &h.x);
        if same {
            g.remove(&h.dev);
            return Check::Ok;
        }
        t.tries += 1;
        if t.tries >= MAX_TRIES { Check::Locked } else { Check::Wrong(MAX_TRIES - t.tries) }
    }
}

/// 여섯 자리 코드 — OS 난수
pub fn new_code() -> Option<String> {
    let mut b = [0u8; 4];
    getrandom::fill(&mut b).ok()?;
    Some(format!("{:06}", u32::from_be_bytes(b) % 1_000_000))
}

/// 코드 받기 단계 — None 이면 숫자 확인으로 내려간다(꺼짐·코드를 못 만듦·메일이 안 나감). send = 중계에 메일 부탁, 나가면 true
pub fn request(codes: &MailCodes, on: bool, h: &Hello, send: impl FnOnce(&str) -> bool, now: Instant) -> Option<Value> {
    if !on || h.peer {
        return None;
    }
    match codes.ask(h, new_code, now)? {
        Ask::Send { code, first } => {
            if send(&code) {
                Some(json!({ "step": "mail", "sent": true, "ttl": MAIL_TTL.as_secs() }))
            } else if first {
                codes.mail_failed(&h.dev);
                None
            } else {
                // 앞서 보낸 메일의 코드는 아직 산다 — 지우지 않고 코드 화면에 둔다
                Some(json!({ "step": "mail", "sent": false, "wait": RESEND_GAP.as_secs() }))
            }
        }
        Ask::Wait(s) => Some(json!({ "step": "mail", "sent": false, "wait": s })),
        Ask::Locked(s) => Some(json!({ "step": "mail", "locked": s })),
    }
}

/// 코드 넣기 단계 — Ok 면 부른 쪽이 허용 끝단으로, Err 면 폰에 줄 답(끝)
pub fn submit(codes: &MailCodes, on: bool, h: &Hello, code: &str, now: Instant) -> Result<(), Value> {
    if !on || h.peer {
        return Err(json!({ "step": "link5", "ok": false, "error": "off" }));
    }
    match codes.check(h, code, now) {
        Check::Ok => Ok(()),
        Check::Wrong(left) => Err(json!({ "step": "link5", "ok": false, "error": "wrong", "left": left })),
        Check::Locked => Err(json!({ "step": "link5", "ok": false, "error": "locked" })),
        Check::Gone => Err(json!({ "step": "link5", "ok": false, "error": "expired" })),
    }
}

#[cfg(test)]
#[path = "phone_mail_link_tests.rs"]
mod tests;
