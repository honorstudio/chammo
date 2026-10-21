//! 사람이 다른 기기(A) 앱 화면에서 직접 친 말·누른 카드를 이 기기(B)로(ADR 0011) — 폰 서버 /api/peer-human·/api/peer-direct-answer 가 부른다.
//! - 문은 peer 열쇠(짝지은 그 기기 앱)와 길 이름뿐이다. A 앱은 이 두 길을 메인 창 웹뷰의 사람 입력에서만 부르고, 참모·스크립트 길(appctl,
//!   scripts/peer)의 허용 목록(remote::POSTS)엔 이 길이 없다 — 그래서 B 는 '이 길로 왔다 = A 의 사람이 쳤다'로 읽는다
//! - 이름표는 B(여기)가 붙인다: `[사람 말 · 원격 · <짝지을 때 받은 이름>에서 직접 · human#<cid>]`. 참모 말(peer-say)은 이 이름표·카드 답 꼬리를
//!   본문에 못 담는다(peer_link::forged)
//! - 재생: cid 는 기기마다 한 번, 보낸 시각(ts)이 이 기기 시계와 SKEW_MS 넘게 어긋나면 거절 — 기억은 그 창의 두 배만
use crate::peer_link::{body_lines, clean_name, SayErr};
use std::collections::HashMap;
use std::sync::Mutex;

/// 보낸 시각 허용 폭 — 기기 시계 어긋남(NTP)을 넉넉히
pub const SKEW_MS: u64 = 5 * 60_000;
/// 기기마다 1분에 넣을 수 있는 사람 말·카드 답(사람 타자 속도로 충분)
pub const PER_MIN: usize = 12;
/// 기억하는 cid 상한 — 1분 PER_MIN 번 × 10분이면 120, 넘치면 가장 옛것부터
const MAX_SEEN: usize = 512;

pub fn tag(cid: &str) -> String {
    format!("human#{cid}")
}

/// 짝지을 때 받은 이름에서 기기 이름만("참모 · 맥북" → "맥북")
pub fn device_word(name: &str) -> String {
    clean_name(name.strip_prefix("참모 · ").unwrap_or(name))
}

/// 세션에 칠 글 — 사람 말 이름표 한 줄 + 본문. 본문은 사람 글이라 승인 문구도 그대로 두지만, 줄 첫머리 [ < 는 표시를 붙인다
pub fn compose(device: &str, cid: &str, text: &str) -> Result<String, SayErr> {
    let lines = body_lines(text)?;
    let dev = device_word(device);
    let head = crate::i18n::tr(&format!("사람 말 · 원격 · {dev}에서 직접"), &format!("Person · remote · typed on {dev}")).to_string();
    Ok(format!("[{head} · {}]\n{}", tag(cid), lines.join("\n")))
}

/// 카드 답을 누른 곳(direct::compose_by 의 by) — "remote:<기기>"
pub fn by_of(device: &str) -> String {
    format!("remote:{}", device_word(device))
}

#[derive(Debug, PartialEq)]
pub enum Fresh {
    New,
    /// 같은 기기·같은 cid 가 창 안에 이미 왔다 — 응답을 못 받은 다시 보내기면 같은 답, 재생이면 아무것도 안 함
    Dup,
    /// 보낸 시각이 창 밖(옛 요청 재생·시계 고장)
    Stale,
}

/// 재생 거름 — 메모리에만(앱을 다시 켜면 잊지만, 그땐 ts 창이 옛 요청을 막는다: 다시 켜는 데 걸린 시간만큼만 열린다)
#[derive(Default)]
pub struct Seen(Mutex<HashMap<String, u64>>);

impl Seen {
    pub fn check(&self, device: &str, cid: &str, ts: u64, now: u64) -> Fresh {
        if ts.saturating_add(SKEW_MS) < now || ts > now.saturating_add(SKEW_MS) {
            return Fresh::Stale;
        }
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        g.retain(|_, at| now.saturating_sub(*at) <= 2 * SKEW_MS);
        let key = format!("{device}\n{cid}");
        if g.contains_key(&key) {
            return Fresh::Dup;
        }
        if g.len() >= MAX_SEEN {
            if let Some(old) = g.iter().min_by_key(|(_, v)| **v).map(|(k, _)| k.clone()) {
                g.remove(&old);
            }
        }
        g.insert(key, now);
        Fresh::New
    }
}

pub fn seen() -> &'static Seen {
    static S: std::sync::OnceLock<Seen> = std::sync::OnceLock::new();
    S.get_or_init(Seen::default)
}

pub fn allow(device: &str) -> bool {
    static M: Mutex<Option<HashMap<String, Vec<u64>>>> = Mutex::new(None);
    let mut g = M.lock().unwrap_or_else(|e| e.into_inner());
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let v = g.get_or_insert_with(HashMap::new).entry(device.to_string()).or_default();
    v.retain(|t| now.saturating_sub(*t) < 60_000);
    if v.len() >= PER_MIN {
        return false;
    }
    v.push(now);
    true
}

#[cfg(test)]
#[path = "peer_human_tests.rs"]
mod tests;
