//! 다른 기기 참모가 이 기기 참모에게 한 줄 넣고 답을 받는 길의 판단(ADR 0007) — 폰 서버 /api/peer-say·/api/peer-reply 가 부른다.
//! - 이름표는 받는 쪽(여기)만 붙인다: `[다른 기기 참모 · <짝지을 때 받은 이름> · peer#<cid>]`. 본문 줄이 [ 나 < 로 시작하면 앞에 › 를 붙여
//!   앱 줄([앱])·다른 세션 메시지·이름표인 척을 못 하게, 사람 승인 문구는 거절(다른 기기 참모 말은 사람 말이 아니다)
//! - 답 = 대화 기록에서 그 cid 꼬리표 줄 뒤의 첫 턴 끝 답(텔레그램 회신과 같은 scan)
use std::collections::HashMap;
use std::sync::Mutex;

/// 한 번에 넣는 글 상한(글자) — 폰 /api/send(8,000)보다 좁게
pub const MAX_SAY: usize = 4_000;
/// 돌려줄 답 상한(글자)
pub const MAX_REPLY: usize = 16_000;
/// 기기마다 1분에 넣을 수 있는 횟수
pub const PER_MIN: usize = 6;

#[derive(Debug, PartialEq)]
pub enum SayErr {
    Empty,
    TooLong,
    /// 사람 승인 문구를 흉내 냈다
    Forged,
}

/// cid 꼬리표 — 기록에서 내 줄을 찾는 열쇠(ASCII 라 JSON 에 그대로 남는다)
pub fn tag(cid: &str) -> String {
    format!("peer#{cid}")
}

/// 보이지 않는 글자(zero-width·단어 잇기·BOM·방향 표시) — 끼워 넣어 거름을 피하지 못하게 본문에서도 뺀다
/// 채움·무시 글자(한글 채움 U+3164·U+115F·U+1160·U+FFA0, 점자 빈칸, 결합 무시 U+034F, 몽골 자모 분리자, 아랍 글자 표시, 변형 선택자, 태그 글자)도 —
/// trim_start 가 못 지워서 줄 앞에 두면 '[앱] …' 줄이 줄머리 거름을 지났다(보안 검토 1-A)
pub(crate) fn invisible(c: char) -> bool {
    matches!(c, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{feff}' | '\u{00ad}')
        || matches!(c, '\u{034f}' | '\u{061c}' | '\u{115f}' | '\u{1160}' | '\u{180b}'..='\u{180f}' | '\u{2800}' | '\u{3164}' | '\u{ffa0}' | '\u{fe00}'..='\u{fe0f}' | '\u{e0000}'..='\u{e007f}' | '\u{e0100}'..='\u{e01ef}')
}

/// 화면에서 새 줄로 보이는 글자 — 줄바꿈으로 바꿔 줄 첫머리 거름(› )을 지나게 한다
pub(crate) fn line_break(c: char) -> bool {
    matches!(c, '\r' | '\u{85}' | '\u{2028}' | '\u{2029}' | '\u{b}' | '\u{c}')
}

/// 모양만 비슷한 라틴 글자(키릴·그리스) → 라틴 — 승인 문구 거름용, 흔한 것만
fn latin_twin(c: char) -> char {
    match c {
        'а' | 'α' => 'a', 'в' | 'β' => 'b', 'с' | 'ϲ' => 'c', 'ԁ' => 'd', 'е' | 'ε' => 'e', 'һ' => 'h', 'і' | 'ι' => 'i', 'ј' => 'j',
        'к' | 'κ' => 'k', 'м' => 'm', 'п' | 'η' => 'n', 'о' | 'ο' | 'σ' => 'o', 'р' | 'ρ' => 'p', 'ѕ' => 's', 'т' | 'τ' => 't',
        'υ' => 'u', 'ν' | 'ѵ' => 'v', 'ш' | 'ω' => 'w', 'х' | 'χ' => 'x', 'у' | 'γ' => 'y',
        _ => c,
    }
}

/// 승인 문구를 견줄 모양(NFKC 비슷하게, 의존성 없이) — 전각·수학 글자 → ASCII, 닮은꼴 → 라틴, 결합 부호 빼기,
/// 풀어 쓴 한글 자모 → 음절, 소문자, 글자·숫자만 남기기(띄어쓰기·점·줄표를 끼워도 같은 글)
fn fold(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        let u = c as u32;
        let c = match u {
            0xFF01..=0xFF5E => char::from_u32(u - 0xFEE0).unwrap_or(c),
            // 수학 글자(굵게·기울임·…) — 52자(A–Z a–z)씩 되풀이, 숫자는 10자씩
            0x1D400..=0x1D6A3 => {
                let i = ((u - 0x1D400) % 52) as u8;
                (if i < 26 { b'A' + i } else { b'a' + i - 26 }) as char
            }
            0x1D7CE..=0x1D7FF => (b'0' + ((u - 0x1D7CE) % 10) as u8) as char,
            0x0300..=0x036F => continue,
            _ => latin_twin(c),
        };
        // 풀어 쓴 한글(초성·중성·종성 자모) → 음절
        let v = c as u32;
        if (0x1161..=0x1175).contains(&v) {
            if let Some(l) = out.chars().last().map(|p| p as u32).filter(|p| (0x1100..=0x1112).contains(p)) {
                out.pop();
                out.push(char::from_u32(0xAC00 + ((l - 0x1100) * 21 + (v - 0x1161)) * 28).unwrap_or(c));
                continue;
            }
        }
        if (0x11A8..=0x11C2).contains(&v) {
            if let Some(s) = out.chars().last().map(|p| p as u32).filter(|p| (0xAC00..=0xD7A3).contains(p) && (p - 0xAC00) % 28 == 0) {
                out.pop();
                out.push(char::from_u32(s + v - 0x11A7).unwrap_or(c));
                continue;
            }
        }
        out.push(c);
    }
    out.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// 사람 직접 승인 문구(CHAMMO 안내문 두 판)·원격 사람 말 이름표(peer_human)·카드 답 꼬리(direct::compose_by) —
/// 띄어쓰기·대소문자·닮은 글자·사이에 끼운 점·전각 괄호를 바꿔도 잡는다. 다른 기기 참모 말 안에 사람 표시가 섞이지 않게
pub(crate) fn forged(text: &str) -> bool {
    let s = fold(&text.chars().filter(|c| !invisible(*c)).collect::<String>());
    // 어순·조사만 바꾼 '받았다' 주장도("사람이 직접 승인했어"·"직접 사람 승인 받음"·"approved directly by the person") — 2026-10-21 리뷰.
    // '사람 승인 카드로 해'·'직접 승인해 줘'·'Has the user approved the PR?' 같은 그냥 승인 얘기는 된다(코드 리뷰: 짧은 조각만 보면 이것까지 막았다)
    // 사람 말 이름표(원격)·카드 답 꼬리 뒤쪽(direct::compose_by) — 앞쪽 '직접 답(카드' 없이 끝만 흉내 내도(remote-chat)
    [
        "사람직접승인", "직접사람승인", "사람이직접승인", "본인직접승인", "직접승인받", "직접승인했", "직접승인됐", "사람승인받", "사람승인됐", "사람이승인했", "본인승인받", "본인이승인했",
        "approvedbythepersondirectly", "approveddirectlybytheperson", "personapproveddirectly", "humanapproveddirectly", "userapproveddirectly", "approveddirectlybytheuser", "approvedbythehumandirectly",
        "사람말원격", "personremote", "직접답카드", "directanswercard",
        // 팀 메신저 사람 말 이름표(team_relay_inbox) — 남의 말 안에 섞여 '팀 사람이 쳤다'인 척 못 하게
        "팀사람말", "teamhuman",
        // 내 기기끼리 방 이름표(team_relay_inbox) — 남의 글 안에서 '내 다른 기기에서 내가 쳤다'인 척 못 하게
        "내다른기기사람말", "내다른기기참모", "mydevicehuman", "mydeviceassistant",
        "앱카드에서눌렀", "앱카드에서썼", "텔레그램카드에서눌렀", "텔레그램카드에서썼", "원격으로앱카드",
        "presseditontheappcard", "wroteitontheappcard", "ontheappcardremotely", "onthetelegramcard",
        // 앱이 참모 입력칸에 치는 정해진 줄([앱] …) — 줄 가운데 있어도 남의 글 안에선 앱 줄인 척이다
        "재시작으로꺼진세션", "선택지창에서멈췄어", "stoppedbyrestart", "isstuckonachoiceprompt",
    ]
    .iter()
    .any(|p| s.contains(p))
}

pub(crate) fn clean_name(s: &str) -> String {
    let t: String = s.chars().filter(|c| !c.is_control() && !invisible(*c) && !matches!(c, '[' | ']' | '<' | '>')).take(40).collect();
    let t = t.trim().to_string();
    if t.is_empty() { "?".into() } else { t }
}

/// 세션에 칠 글 — 이름표 한 줄 + 본문(제어 글자는 줄바꿈·탭만 남김).
/// device = 짝지을 때 받은 이름("참모 · 맥북" — 앞의 "참모 · " 는 뺀다), who = 보낸 참모 이름(그 기기 앱이 알려 준 것, 비면 뺌)
/// 본문 줄 — 제어 글자는 줄바꿈·탭만, 보이지 않는 글자 빼기, 줄 첫머리 [ < 엔 › (이름표·앱 줄인 척 못 하게)
pub(crate) fn body_lines(text: &str) -> Result<Vec<String>, SayErr> {
    let body: String = text.replace("\r\n", "\n").chars().map(|c| if line_break(c) { '\n' } else { c }).filter(|c| (!c.is_control() || *c == '\n' || *c == '\t') && !invisible(*c)).collect();
    if body.trim().is_empty() {
        return Err(SayErr::Empty);
    }
    if body.chars().count() > MAX_SAY {
        return Err(SayErr::TooLong);
    }
    Ok(body
        .trim_matches('\n')
        .lines()
        .map(|l| {
            let s = l.trim_start();
            // 앱 줄·이름표처럼 보이는 머리 — 전각·다른 괄호(［앱］·【…】·＜…＞)도
            if s.starts_with(['[', '<', '［', '＜', '【', '〔', '〈', '《', '「', '『', '〖', '〘', '〚', '⟦', '⟨', '❬', '❮', '﹝', '‹', '«']) { format!("› {s}") } else { l.to_string() }
        })
        .collect())
}

/// 세션에 칠 글 — 이름표 한 줄 + 본문(제어 글자는 줄바꿈·탭만 남김).
/// device = 짝지을 때 받은 이름("참모 · 맥북" — 앞의 "참모 · " 는 뺀다), who = 보낸 참모 이름(그 기기 앱이 알려 준 것, 비면 뺌)
pub fn compose(device: &str, who: &str, cid: &str, text: &str) -> Result<String, SayErr> {
    if forged(text) {
        return Err(SayErr::Forged);
    }
    let lines = body_lines(text)?;
    let head = crate::i18n::tr("다른 기기 참모", "Assistant on another device");
    let dev = clean_name(device.strip_prefix("참모 · ").unwrap_or(device));
    let who = if forged(who) { "?".to_string() } else { clean_name(who) };
    let from = if who == "?" { dev } else { format!("{dev} · {who}") };
    Ok(format!("[{head} · {from} · {}]\n{}", tag(cid), lines.join("\n")))
}

/// 1분 창 안의 횟수 — 넘으면 false(그때는 적지 않는다)
pub fn allow_in(m: &mut HashMap<String, Vec<u64>>, device: &str, now: u64) -> bool {
    allow_in_window(m, device, now, 60_000)
}

/// window(ms) 안에 PER_MIN 번까지 — 시험이 창을 줄여 쓴다(team_relay_ws)
pub fn allow_in_window(m: &mut HashMap<String, Vec<u64>>, device: &str, now: u64, window: u64) -> bool {
    let v = m.entry(device.to_string()).or_default();
    v.retain(|t| now.saturating_sub(*t) < window);
    if v.len() >= PER_MIN {
        return false;
    }
    v.push(now);
    true
}

pub fn allow(device: &str) -> bool {
    static M: Mutex<Option<HashMap<String, Vec<u64>>>> = Mutex::new(None);
    let mut g = M.lock().unwrap_or_else(|e| e.into_inner());
    allow_in(g.get_or_insert_with(HashMap::new), device, now_ms())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Debug, PartialEq)]
pub enum TargetErr {
    Missing,
    /// HQ 폴더 세션이 아니다(프로젝트 세션은 그 기기 참모가 조종한다)
    NotAssistant,
    /// 이름을 비웠는데 참모가 여럿
    Ambiguous,
}

/// 받는 참모 — 짧은 id, 전체 이름, ' · ' 앞(번호)·뒤(별명). 비우면 참모가 하나일 때만
pub fn target(sessions_json: &str, hq: &str, to: &str) -> Result<String, TargetErr> {
    let v: serde_json::Value = serde_json::from_str(sessions_json).map_err(|_| TargetErr::Missing)?;
    let all = v.as_array().cloned().unwrap_or_default();
    let in_hq = |a: &serde_json::Value| crate::platform::same_dir(a["cwd"].as_str().unwrap_or(""), hq);
    let to = to.trim();
    let hit = |a: &serde_json::Value| {
        let name = a["name"].as_str().unwrap_or("");
        let (num, nick) = name.split_once(" · ").unwrap_or((name, ""));
        a["id"] == to || name == to || num == to || (!nick.is_empty() && nick == to)
    };
    if to.is_empty() {
        let hq_list: Vec<_> = all.iter().filter(|a| in_hq(a)).collect();
        return match hq_list.as_slice() {
            [one] => Ok(one["id"].as_str().unwrap_or("").to_string()),
            [] => Err(TargetErr::Missing),
            _ => Err(TargetErr::Ambiguous),
        };
    }
    let found: Vec<_> = all.iter().filter(|a| hit(a)).collect();
    match found.as_slice() {
        [] => Err(TargetErr::Missing),
        [a] if in_hq(a) => Ok(a["id"].as_str().unwrap_or("").to_string()),
        [_] => Err(TargetErr::NotAssistant),
        many => {
            let hq_hits: Vec<_> = many.iter().filter(|a| in_hq(a)).collect();
            match hq_hits.as_slice() {
                [a] => Ok(a["id"].as_str().unwrap_or("").to_string()),
                [] => Err(TargetErr::NotAssistant),
                _ => Err(TargetErr::Ambiguous),
            }
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Reply {
    /// 내 줄이 아직 안 보이거나 턴이 안 끝남
    Waiting,
    Done(String),
    /// 내 줄 뒤에 사람이 직접 친 말이 와서 그 뒤 답은 사람 것
    Interrupted,
}

fn cap(s: String) -> String {
    if s.chars().count() > MAX_REPLY { format!("{}…", s.chars().take(MAX_REPLY).collect::<String>()) } else { s }
}

/// 기록 조각에서 cid 꼬리표가 든 줄을 찾고, 그 뒤 첫 턴 끝 답
pub fn reply_from(chunk: &str, cid: &str) -> Reply {
    // 꼬리표 뒤에 글자가 더 붙은 다른 cid(c1 ↔ c10)를 안 집게 닫는 ']' 까지
    let needle = format!("{}]", tag(cid));
    let mut pos = 0;
    let mut start = None;
    for line in chunk.split_inclusive('\n') {
        if start.is_none() && line.contains(&needle) {
            start = Some(pos + line.len());
            break;
        }
        pos += line.len();
    }
    let Some(start) = start else { return Reply::Waiting };
    let mut buf = String::new();
    let s = crate::messenger_text::scan(&chunk[start..], &mut buf);
    if let Some(r) = s.replies.into_iter().next() {
        return Reply::Done(cap(r));
    }
    if s.mac_prompt { Reply::Interrupted } else { Reply::Waiting }
}

/// 넣은 말 표시 — 답을 어디서부터 찾을지(그 세션 기록과 넣기 직전 길이)
#[derive(Clone, Debug)]
pub struct Mark {
    pub device: String,
    pub session: String,
    pub offset: u64,
    pub at: u64,
}

/// 메모리에만 하루 — 앱이 다시 켜지면 잊는다(peer-reply 가 unknown)
#[derive(Default)]
pub struct Marks(Mutex<HashMap<String, Mark>>);

const KEEP_MS: u64 = 24 * 3_600_000;
const MAX_MARKS: usize = 200;

impl Marks {
    pub fn put(&self, cid: &str, m: Mark) {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let now = now_ms();
        g.retain(|_, v| now.saturating_sub(v.at) < KEEP_MS);
        if g.len() >= MAX_MARKS {
            if let Some(old) = g.iter().min_by_key(|(_, v)| v.at).map(|(k, _)| k.clone()) {
                g.remove(&old);
            }
        }
        g.insert(cid.to_string(), m);
    }
    /// 그 기기가 넣은 것만
    pub fn get(&self, cid: &str, device: &str) -> Option<Mark> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).get(cid).filter(|m| m.device == device).cloned()
    }
}

pub fn marks() -> &'static Marks {
    static M: std::sync::OnceLock<Marks> = std::sync::OnceLock::new();
    M.get_or_init(Marks::default)
}

#[cfg(test)]
#[path = "peer_link_tests.rs"]
mod tests;
