//! 메신저 양방향 1단계 — 텔레그램에서 참모와 말하기(docs/plans/2026-10-06-messenger.md). 여기는 판단만(파일·망 없음):
//! 들어온 글 거르기·짝짓기 코드·명령·속도 상한·참모 고르기. 회신 가림·나눔·카드 글·대화 기록 읽기는 messenger_text.rs
//! 메신저 계정 = 권한 확인 없이 도는 참모에게 말 걸 수 있는 사람이라 — 짝지은 한 사람의 1:1 대화만 받고, 모르는 사람에겐 답도 안 한다.
//! 결제·보내기·삭제·운영 카드는 메신저에선 알림만(버튼 없음, 2026-10-08 사용자) — 승인은 앱·폰 카드에서
use crate::direct::Pick;
use crate::mobile_http::ct_eq;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::VecDeque;

/// 짝짓기 코드 수명·틀린 코드 상한(폰 짝짓기와 같은 값)
pub const CODE_TTL_MS: u64 = 10 * 60 * 1000;
pub const MAX_FAILS: u32 = 5;
/// 한 글 상한 — 텔레그램 한 글은 4,096자, 참모 입력칸에 치는 글은 짧게
pub const MAX_TEXT: usize = 2000;
/// 1분에 받는 글·버튼 상한
pub const RATE_PER_MIN: usize = 20;
/// 보낸 카드 id 기억 상한
pub const MAX_CARDS: usize = 300;
/// 텔레그램 글 시각(초 단위)이 브리지가 뜬 때보다 이만큼 앞서면 '꺼져 있던 동안 온 글'
const LATE_SLACK_MS: u64 = 5_000;

/// 짝지은 텔레그램 계정 — 1:1 대화라 대화 id = 사용자 id
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct User {
    pub id: i64,
    pub name: String,
    pub at: u64,
    /// @사용자 이름 — 이름(first_name)은 아무나 바꿀 수 있어 맥 확인 화면엔 이것과 숫자 id 를 같이 보인다
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}

/// <데이터>/messenger.json(600) — 토큰은 여기 없다(키체인)
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct State {
    pub on: bool,
    /// 봇 사용자 이름(@ 없이) — getMe 로 확인한 것
    pub bot: Option<String>,
    pub user: Option<User>,
    /// 짝짓기 코드를 낸 계정 — 맥 설정에서 '이 계정이 맞아요'를 눌러야 user 가 된다(코드가 새도 몰래 못 넘어가게, 2026-10-08 리뷰 M2)
    pub pending: Option<User>,
    /// 다음에 받을 update_id
    pub offset: i64,
    /// 마지막으로 말한 참모(기본 이름)
    pub last_orch: Option<String>,
    /// 메신저로 이미 보낸 카드 id(오래된 것부터 빠짐)
    pub cards: Vec<String>,
}

impl State {
    pub fn remember_card(&mut self, id: &str) {
        if !self.cards.iter().any(|c| c == id) {
            self.cards.push(id.to_string());
        }
        let over = self.cards.len().saturating_sub(MAX_CARDS);
        self.cards.drain(..over);
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn sha(s: &str) -> String {
    hex(&Sha256::digest(s.as_bytes()))
}

/// 살아 있는 짝짓기 코드 — 원문은 안 두고 해시만
struct PairCode {
    hash: String,
    until: u64,
    fails: u32,
}

/// 짝짓기 코드 + 속도 상한. 브리지와 설정 명령이 같이 쓴다(앱 안에서만 — 파일에 안 남는다)
#[derive(Default)]
pub struct Gate {
    code: Option<PairCode>,
    hits: VecDeque<u64>,
    warned: bool,
}

enum Rate {
    Ok,
    /// 상한을 처음 넘음 — 한 번만 알린다
    Warn,
    Drop,
}

impl Gate {
    /// 새 코드(16진 32자) — 옛 코드는 죽는다
    pub fn issue(&mut self, now: u64) -> Result<String, String> {
        let mut b = [0u8; 16];
        getrandom::fill(&mut b).map_err(|e| e.to_string())?;
        let code = hex(&b);
        self.code = Some(PairCode { hash: sha(&code), until: now + CODE_TTL_MS, fails: 0 });
        Ok(code)
    }

    /// 코드가 아직 살아 있나(설정 화면 '기다리는 중')
    pub fn waiting(&self, now: u64) -> bool {
        self.code.as_ref().is_some_and(|c| now <= c.until)
    }

    pub fn cancel(&mut self) {
        self.code = None;
    }

    /// 맞으면 코드를 죽이고 true. 틀리면 셈하고 MAX_FAILS 번째에 코드를 죽인다
    fn try_code(&mut self, code: &str, now: u64) -> bool {
        let Some(c) = self.code.as_mut() else { return false };
        if now > c.until {
            self.code = None;
            return false;
        }
        if code.len() == 32 && ct_eq(sha(code).as_bytes(), c.hash.as_bytes()) {
            self.code = None;
            return true;
        }
        c.fails += 1;
        if c.fails >= MAX_FAILS {
            self.code = None;
        }
        false
    }

    fn rate(&mut self, now: u64) -> Rate {
        while self.hits.front().is_some_and(|&t| now.saturating_sub(t) >= 60_000) {
            self.hits.pop_front();
        }
        if self.hits.len() < RATE_PER_MIN {
            self.hits.push_back(now);
            self.warned = false;
            return Rate::Ok;
        }
        if self.warned {
            Rate::Drop
        } else {
            self.warned = true;
            Rate::Warn
        }
    }
}

/// 텔레그램 update 하나를 우리가 보는 모양으로
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Text {
        update: i64,
        from: i64,
        chat: i64,
        private: bool,
        bot: bool,
        forwarded: bool,
        /// 글이 아닌 것(사진·스티커·음성 …)
        media: bool,
        name: String,
        username: Option<String>,
        date_ms: u64,
        text: String,
    },
    Button {
        update: i64,
        cb: String,
        from: i64,
        chat: i64,
        msg: i64,
        data: String,
    },
    /// 고친 글·채널 글·그룹 초대 같은 것 — 다 버린다
    Other { update: i64 },
}

impl Incoming {
    pub fn update_id(&self) -> i64 {
        match self {
            Incoming::Text { update, .. } | Incoming::Button { update, .. } | Incoming::Other { update } => *update,
        }
    }
}

pub fn parse(u: &Value) -> Incoming {
    let update = u["update_id"].as_i64().unwrap_or(0);
    if let Some(m) = u.get("message").filter(|m| m.is_object()) {
        let from = &m["from"];
        let first = from["first_name"].as_str().unwrap_or("");
        let name = clean_name(if first.is_empty() { from["username"].as_str().unwrap_or("") } else { first });
        let username = from["username"].as_str().filter(|u| !u.is_empty() && u.len() <= 32 && u.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')).map(str::to_string);
        let text = m["text"].as_str().map(str::to_string);
        return Incoming::Text {
            update,
            from: from["id"].as_i64().unwrap_or(0),
            chat: m["chat"]["id"].as_i64().unwrap_or(0),
            private: m["chat"]["type"] == "private",
            bot: from["is_bot"].as_bool().unwrap_or(false),
            forwarded: m.get("forward_origin").is_some() || m.get("forward_from").is_some() || m.get("forward_date").is_some(),
            media: text.is_none(),
            name,
            username,
            date_ms: m["date"].as_u64().unwrap_or(0) * 1000,
            text: text.unwrap_or_default(),
        };
    }
    if let Some(q) = u.get("callback_query").filter(|q| q.is_object()) {
        return Incoming::Button {
            update,
            cb: q["id"].as_str().unwrap_or("").to_string(),
            from: q["from"]["id"].as_i64().unwrap_or(0),
            chat: q["message"]["chat"]["id"].as_i64().unwrap_or(0),
            msg: q["message"]["message_id"].as_i64().unwrap_or(0),
            data: q["data"].as_str().unwrap_or("").to_string(),
        };
    }
    Incoming::Other { update }
}

/// 브리지가 할 일
#[derive(Debug, Clone, PartialEq)]
pub enum Act {
    /// 아무 답도 안 한다(모르는 사람·그룹·봇·이상한 것)
    Ignore,
    /// 앱이 꺼져 있던 동안 온 짝의 글 — 세기만
    Late,
    Paired(User),
    Reply(String),
    /// /잠금 — 짝을 끊는다
    Lock,
    /// /참모 — 목록
    List,
    /// /이름 만 — 기본 참모 바꾸기
    Choose(String),
    /// to = /이름 으로 고른 참모, 없으면 기본
    Send { to: Option<String>, text: String },
    Button { cb: String, msg: i64, card: String, pick: Pick },
    /// 짝이 누른 버튼인데 모양이 이상함 — 돌기만 멈춘다
    ButtonIgnore { cb: String },
}

/// 안 보이는 글자 — 너비 없는 글자·방향 바꾸기(U+202E 로 이름을 뒤집어 보이게 한다)·줄 구분자. 표준 라이브러리엔 Cf 분류가 없어 목록으로
pub fn invisible(c: char) -> bool {
    matches!(c, '\u{00AD}' | '\u{061C}' | '\u{180E}' | '\u{200B}'..='\u{200F}' | '\u{2028}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}' | '\u{FFF9}'..='\u{FFFB}')
}

/// 참모 입력칸에 치기 전 거름 — 제어 문자(ESC·Ctrl+C·DEL)·안 보이는 글자는 빼고 줄바꿈·탭만 둔다(폰 /api/send 보다 한 겹 더)
pub fn clean_text(t: &str) -> String {
    t.chars().filter(|&c| (!c.is_control() || c == '\n' || c == '\t') && !invisible(c)).collect::<String>().trim().to_string()
}

/// 텔레그램 이름 — 제어·안 보이는 글자 빼고 40자
pub fn clean_name(t: &str) -> String {
    t.chars().filter(|&c| !c.is_control() && !invisible(c)).take(40).collect::<String>().trim().to_string()
}

pub fn help() -> String {
    help_for(&crate::config::assistant_name())
}

/// 예시 이름은 사용자가 정한 비서 이름으로
pub fn help_for(name: &str) -> String {
    if crate::i18n::is_en() {
        format!("Messages go to your chief of staff.\n/list — assistants\n/name text — to that one (e.g. /{name}-2 hi)\n/lock — cut this link (reconnect in the Mac settings)\nNever type passwords or keys here — Telegram keeps them on its servers")
    } else {
        format!("글을 보내면 참모에게 가요.\n/참모 — 참모 목록\n/이름 글 — 그 참모에게(예: /{name}-2 안녕)\n/잠금 — 이 연결 끊기(맥 설정에서 다시 연결)\n비밀번호·키는 여기 치지 마세요 — 텔레그램 서버에 남아요")
    }
}

/// 들어온 것 하나 → 할 일. started = 브리지가 뜬 때(ms), now = 지금(ms)
pub fn decide(st: &State, gate: &mut Gate, inc: &Incoming, started: u64, now: u64) -> Act {
    let paired = |id: i64| st.user.as_ref().is_some_and(|u| u.id == id && id != 0);
    match inc {
        Incoming::Other { .. } => Act::Ignore,
        Incoming::Text { from, chat, private, bot, forwarded, media, name, username, date_ms, text, .. } => {
            // 1:1 대화(대화 id = 보낸 사람 id)만 — 그룹·채널·봇 글은 짝이 보냈어도 버린다
            if !*private || chat != from || *bot || *from == 0 {
                return Act::Ignore;
            }
            if date_ms + LATE_SLACK_MS < started {
                return if paired(*from) { Act::Late } else { Act::Ignore };
            }
            if let Some(rest) = command(text, "start") {
                if !rest.is_empty() {
                    if gate.try_code(rest, now) {
                        return Act::Paired(User { id: *from, name: name.clone(), at: now, username: username.clone() });
                    }
                    return Act::Ignore; // 틀린 코드엔 짝이어도 답 안 한다
                }
            }
            if !paired(*from) {
                return Act::Ignore;
            }
            match gate.rate(now) {
                Rate::Ok => {}
                Rate::Warn => return Act::Reply(crate::i18n::tr("너무 빨라요 — 1분 뒤에 다시 보내 주세요", "Too fast — send again in a minute").into()),
                Rate::Drop => return Act::Ignore,
            }
            if *forwarded {
                return Act::Reply(crate::i18n::tr("전달한 글은 안 받아요 — 직접 쳐 주세요", "Forwarded messages are not accepted — type it yourself").into());
            }
            if *media {
                return Act::Reply(crate::i18n::tr("지금은 글만 받아요", "Only text for now").into());
            }
            let t = clean_text(text);
            if t.is_empty() {
                return Act::Ignore;
            }
            if t.chars().count() > MAX_TEXT {
                return Act::Reply(crate::i18n::tr("글이 너무 길어요 — 2,000자까지", "Too long — up to 2,000 characters").into());
            }
            let Some(body) = t.strip_prefix('/') else { return Act::Send { to: None, text: t } };
            let (head, rest) = body.split_once(char::is_whitespace).map(|(h, r)| (h, r.trim())).unwrap_or((body, ""));
            let head = head.split('@').next().unwrap_or(head); // /list@봇이름
            match head.to_lowercase().as_str() {
                "잠금" | "lock" => Act::Lock,
                "참모" | "list" | "orchs" => Act::List,
                "start" | "help" | "도움" | "도움말" => Act::Reply(help()),
                "" => Act::Reply(help()),
                _ if rest.is_empty() => Act::Choose(head.to_string()),
                _ => Act::Send { to: Some(head.to_string()), text: rest.to_string() },
            }
        }
        Incoming::Button { cb, from, chat, msg, data, .. } => {
            if !paired(*from) || chat != from {
                return Act::Ignore; // 남의 버튼엔 돌기 멈춤도 안 보낸다
            }
            if matches!(gate.rate(now), Rate::Drop | Rate::Warn) {
                return Act::ButtonIgnore { cb: cb.clone() };
            }
            match parse_button(data) {
                Some((card, pick)) => Act::Button { cb: cb.clone(), msg: *msg, card, pick },
                None => Act::ButtonIgnore { cb: cb.clone() },
            }
        }
    }
}

/// "/start abc" → Some("abc"), "/start" → Some(""), 그 밖은 None
fn command<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let t = text.trim();
    let rest = t.strip_prefix('/')?.strip_prefix(name)?;
    if let Some(r) = rest.strip_prefix('@') {
        return Some(r.split_once(char::is_whitespace).map_or("", |(_, x)| x.trim())); // /start@봇이름 코드
    }
    if rest.is_empty() || rest.starts_with(char::is_whitespace) {
        Some(rest.trim())
    } else {
        None
    }
}

// ── 버튼 ────────────────────────────────────────────────────

/// 메신저에서 버튼으로 답해도 되는 카드 — 되돌리기 쉬운 것만. 결제·보내기·삭제·운영은 알림만
pub fn buttons_ok(kind: &str) -> bool {
    matches!(kind, "other" | "login")
}

pub fn is_card_id(s: &str) -> bool {
    s.len() == 8 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// "c:<카드 8자>:y|n|o<0~9>"
pub fn parse_button(data: &str) -> Option<(String, Pick)> {
    let mut it = data.split(':');
    if it.next()? != "c" {
        return None;
    }
    let id = it.next().filter(|s| is_card_id(s))?;
    let p = it.next()?;
    if it.next().is_some() {
        return None;
    }
    let pick = match p {
        "y" => Pick::Yes,
        "n" => Pick::No,
        _ => {
            let n = p.strip_prefix('o')?;
            if n.len() != 1 {
                return None;
            }
            Pick::Option { option: n.parse().ok()? }
        }
    };
    Some((id.to_string(), pick))
}

// ── 참모 ────────────────────────────────────────────────────

/// 참모 세션 이름인가 — 기본 이름(" · " 앞)이 비서 이름 또는 비서 이름-숫자
pub fn is_orch_name(name: &str, assistant: &str) -> bool {
    let base = crate::orch_roles::base_of(name);
    !assistant.is_empty() && (base == assistant || base.strip_prefix(assistant).and_then(|r| r.strip_prefix('-')).is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())))
}

/// 살아 있는 참모 하나
#[derive(Debug, Clone, PartialEq)]
pub struct Orch {
    /// claude agents 짧은 id
    pub id: String,
    /// 대화 id(대화 기록 파일 이름)
    pub session: String,
    pub name: String,
}

impl Orch {
    pub fn base(&self) -> &str {
        crate::orch_roles::base_of(&self.name)
    }
    /// 사람에게 보일 이름 — 별명(" · " 뒤)이 있으면 별명, 없으면 기본 이름(2026-10-10 답 머리가 '참모-2:' 로 나왔다)
    pub fn label(&self) -> &str {
        self.name.split(" · ").nth(1).map(str::trim).filter(|n| !n.is_empty()).unwrap_or_else(|| self.base())
    }
}

/// /이름 → 참모(기본 이름이나 별명, 대소문자 무시)
pub fn find_orch<'a>(list: &'a [Orch], key: &str) -> Option<&'a Orch> {
    let k = key.trim().to_lowercase();
    if k.is_empty() {
        return None;
    }
    list.iter().find(|o| o.base().to_lowercase() == k).or_else(|| list.iter().find(|o| o.name.split(" · ").nth(1).is_some_and(|n| n.trim().to_lowercase() == k)))
}

/// 기본 참모 — 마지막으로 말한 참모가 살아 있으면 그, 아니면 비서 이름 그대로인 참모, 아니면 첫 참모
pub fn default_orch<'a>(list: &'a [Orch], last: Option<&str>, assistant: &str) -> Option<&'a Orch> {
    last.and_then(|l| list.iter().find(|o| o.base() == l)).or_else(|| list.iter().find(|o| o.base() == assistant)).or_else(|| list.first())
}

pub fn list_text(list: &[Orch], current: Option<&Orch>) -> String {
    if list.is_empty() {
        return crate::i18n::tr("지금 켜진 참모가 없어요 — 맥에서 앱을 확인해 주세요", "No assistant is running — check the app on the Mac").into();
    }
    let mut lines = vec![if crate::i18n::is_en() { format!("{} assistant(s)", list.len()) } else { format!("참모 {}명", list.len()) }];
    for o in list {
        let now = current.is_some_and(|c| c.id == o.id);
        lines.push(format!("· {}{}", o.name, if now { crate::i18n::tr(" — 지금 받는 참모", " — current") } else { "" }));
    }
    lines.push(crate::i18n::tr("/이름 글 로 보내면 그 참모에게 가요", "Send /name text to reach that one").into());
    lines.join("\n")
}

/// 참모 입력칸에 칠 글 — 앞머리로 어디서 왔는지 알린다(빈칸 뒤 '/'·'!' 로 시작해도 슬래시 명령·셸로 안 읽힌다)
pub fn typed(text: &str) -> String {
    format!("{} {text}", prefix())
}

pub fn prefix() -> &'static str {
    crate::i18n::tr("[텔레그램]", "[Telegram]")
}

#[cfg(test)]
#[path = "messenger_tests.rs"]
mod tests;
