//! 받은 팀 말 → 내 참모(중계 서버 ADR 0002 '참모 말은 사람 말·승인이 아니다').
//! - 이름표는 받는 쪽(여기)만 붙인다: 참모 말 `[팀 참모 · <사람> · <기기> · team#<seq>]`, 사람 말 `[팀 사람 말 · <사람> · team#<seq>]`.
//!   사람 이름은 서버 멤버 목록(그 사람이 들어올 때 적은 이름 — 남의 글이라 거른다), 기기는 서버가 이름을 안 줘서 id 앞 6자
//! - 본문은 peer_link 와 같은 거름: 줄 첫머리 [ < 엔 › , 승인 문구·카드 답 꼬리·사람 말 이름표 흉내는 사람 말이어도 안 넘긴다
//!   (남의 사람 말은 '그 사람의 말'일 뿐 내 참모의 결제·운영 승인이 아니다 — 그건 늘 내 기기 카드)
//! - 받은 순서: 기록(team-inbox.jsonl) → 받은 seq 표시 → 서버에 ack → 참모에게 넘기기. 같은 seq 는 한 번만
use crate::peer_link::{body_lines, clean_name, forged, SayErr, MAX_SAY};
use crate::team_relay::TeamState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

pub const INBOX_FILE: &str = "team-inbox.jsonl";
pub const SEEN_FILE: &str = "team-seen.json";

#[derive(Debug, PartialEq)]
pub enum Action {
    /// 이미 받았거나 모양이 틀림 — ack 만
    Skip,
    /// 내(같은 멤버) 다른 기기가 보낸 말 — 기록만
    Mine,
    /// 승인 흉내 등 — 기록만(note 에 이유)
    Blocked(String),
    /// 내 참모에게 칠 글
    Deliver(String),
}

/// 받은 말 한 줄 기록(화면·폰이 읽는다)
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Record {
    pub room: String,
    pub seq: u64,
    pub member: String,
    pub device: String,
    pub person: String,
    pub origin: String,
    pub body: String,
    pub at: u64,
    /// 보낸 기기 이름(서버 기기 목록 — 없으면 id 앞 6자)
    pub device_name: String,
    /// "self" = 내 기기끼리 방(서버 ADR 0004), 아니면 팀 방
    pub kind: String,
    /// delivered | mine | forged | no-assistant | …
    pub note: String,
}

pub fn tag(seq: u64) -> String {
    format!("team#{seq}")
}

/// 사람·기기 이름 — 이름표를 흉내 내거나 비면 ?
pub(crate) fn safe_name(s: &str) -> String {
    if forged(s) { "?".into() } else { clean_name(s) }
}

/// 보낸 사람 이름 — 다른 멤버·나와 겹치면 멤버 id 앞자리를 붙인다(누가 한 말인지 섞이지 않게, 보안 검토 1-D)
fn person_of(st: &TeamState, member: &str) -> String {
    let Some(name) = st.member_name(member).map(safe_name) else { return "?".into() };
    let clash = st.members.iter().any(|o| o.id != member && safe_name(&o.display_name) == name) || (member != st.member_id && !st.display_name.is_empty() && safe_name(&st.display_name) == name);
    if clash {
        format!("{name} #{}", member.chars().filter(char::is_ascii_alphanumeric).take(4).collect::<String>())
    } else {
        name
    }
}

/// 보낸 기기 이름 — 서버 기기 목록, 모르면 id 앞 6자. 이름표를 흉내 내면 ?
fn device_of(st: &TeamState, device: &str) -> String {
    let raw = st.device_label(device).unwrap_or_else(|| format!("{} {}", crate::i18n::tr("기기", "device"), device.chars().take(6).collect::<String>()));
    safe_name(&raw)
}

/// 받은 말 하나를 판단한다. last = 이 방에서 이미 받은 마지막 seq
pub fn on_msg(st: &TeamState, last: u64, m: &Value) -> (Action, Record) {
    let room = m["room"].as_str().unwrap_or("");
    let own = st.rooms.iter().any(|r| r.id == room && r.kind == "self");
    let member = m["from"]["member"].as_str().unwrap_or("");
    let device = m["from"]["device"].as_str().unwrap_or("");
    let (Some(seq), Some(body)) = (m["seq"].as_u64(), m["body"].as_str()) else { return (Action::Skip, Record::default()) };
    // 팀 방은 보낸 멤버가, 내 기기끼리 방은 보낸 기기가 있어야 한다
    if (!own && member.is_empty()) || (own && device.is_empty()) {
        return (Action::Skip, Record::default());
    }
    let mut rec = Record {
        room: room.into(),
        seq,
        member: member.into(),
        device: device.into(),
        person: if own { String::new() } else { person_of(st, member) },
        // 정확히 "human" 일 때만 사람 말 — 서버 originOf 와 같은 선
        origin: if m["origin"] == "human" { "human".into() } else { "agent".into() },
        body: body.into(),
        at: m["at"].as_u64().unwrap_or(0),
        device_name: device_of(st, device),
        kind: if own { "self".into() } else { "team".into() },
        note: String::new(),
    };
    if seq <= last || body.trim().is_empty() {
        return (Action::Skip, rec);
    }
    // 이 기기가 보낸 말(다시 붙을 때 밀린 말에 섞여 온다) — 보낼 때 이미 'sent' 로 적었다
    if rec.device == st.device_id && (own || member == st.member_id) {
        return (Action::Skip, rec);
    }
    if !own && member == st.member_id {
        rec.note = "mine".into();
        return (Action::Mine, rec);
    }
    // 로그인한 기기인데 만든 때를 아직 못 받았다 — 옛 말인지 모르니 닫힌 쪽으로(방 찾기가 다시 받는다, 리뷰 10-23)
    if st.account.is_some() && st.device_created_at == 0 {
        rec.note = "age-unknown".into();
        return (Action::Blocked("age-unknown".into()), rec);
    }
    // 이 기기가 생기기 전에 오간 말(새로 로그인한 기기가 받는 밀린 말) — 기록만, 참모에겐 안 넘긴다
    if st.device_created_at > 0 && rec.at < st.device_created_at {
        rec.note = "history".into();
        return (Action::Blocked("history".into()), rec);
    }
    match compose(&rec) {
        Ok(t) => {
            rec.note = "delivered".into();
            (Action::Deliver(t), rec)
        }
        Err(SayErr::Forged) => {
            rec.note = "forged".into();
            (Action::Blocked("forged".into()), rec)
        }
        Err(_) => (Action::Skip, rec),
    }
}

/// 참모에게 칠 글 — 이름표 한 줄 + 거른 본문(길면 잘라서). 내 기기끼리 방도 같은 거름(승인 문구는 사람 말이어도 막음)
pub fn compose(r: &Record) -> Result<String, SayErr> {
    if forged(&r.body) {
        return Err(SayErr::Forged);
    }
    let body = if r.body.chars().count() > MAX_SAY { format!("{}\n…(잘림)", r.body.chars().take(MAX_SAY - 20).collect::<String>()) } else { r.body.clone() };
    let lines = body_lines(&body)?;
    let human = r.origin == "human";
    let head = match (r.kind == "self", human) {
        (true, false) => format!("[{} · {} · self#{}]", crate::i18n::tr("내 다른 기기 참모", "My device assistant"), r.device_name, r.seq),
        (true, true) => format!("[{} · {} · self#{}]", crate::i18n::tr("내 다른 기기 사람 말", "My device human"), r.device_name, r.seq),
        (false, true) => format!("[{} · {} · {}]", crate::i18n::tr("팀 사람 말", "Team human"), r.person, tag(r.seq)),
        (false, false) => format!("[{} · {} · {} · {}]", crate::i18n::tr("팀 참모", "Team assistant"), r.person, r.device_name, tag(r.seq)),
    };
    Ok(format!("{head}\n{}", lines.join("\n")))
}

static SEEN_LOCK: Mutex<()> = Mutex::new(());

fn read_seen(dir: &Path) -> HashMap<String, u64> {
    std::fs::read_to_string(dir.join(SEEN_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn last_seen(dir: &Path, room: &str) -> u64 {
    read_seen(dir).get(room).copied().unwrap_or(0)
}

/// 방마다 받은 마지막 seq — 앞으로만 간다
pub fn mark_seen(dir: &Path, room: &str, seq: u64) -> Result<(), String> {
    let _g = SEEN_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut m = read_seen(dir);
    let v = m.entry(room.to_string()).or_insert(0);
    *v = (*v).max(seq);
    crate::accounts::write_atomic(&dir.join(SEEN_FILE), &serde_json::to_string(&m).map_err(|e| e.to_string())?).map_err(|e| format!("{e:?}"))
}

/// 기록 한 줄 붙이기(600)
pub fn append(dir: &Path, r: &Record) -> Result<(), String> {
    use std::io::Write;
    let mut o = std::fs::OpenOptions::new();
    o.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let mut f = o.open(dir.join(INBOX_FILE)).map_err(|e| e.to_string())?;
    writeln!(f, "{}", serde_json::to_string(r).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// 받을 내 참모 — team.json deliverTo, 비면 설정의 참모 이름(peer_link::target 과 같은 찾기: id·이름·번호·별명, 없으면 HQ 참모가 하나일 때 그것)
pub fn assistant(st: &TeamState, sessions_json: &str, hq: &str, name: &str) -> Option<String> {
    let want = if st.deliver_to.trim().is_empty() { name } else { st.deliver_to.as_str() };
    crate::peer_link::target(sessions_json, hq, want).or_else(|_| crate::peer_link::target(sessions_json, hq, "")).ok()
}

/// 그 참모가 선택지·권한 창에 멈춰 있나(agents --json 의 state blocked) — 그때 치면 글자가 답으로 눌린다. 못 읽으면 기다린다
pub fn must_wait(sessions_json: &str, id: &str) -> bool {
    let Ok(v) = serde_json::from_str::<Value>(sessions_json) else { return true };
    v.as_array().and_then(|a| a.iter().find(|x| x["id"] == id)).is_some_and(|x| x["state"] == "blocked")
}

/// 내 참모 세션에 친다 — 받은 팀 말이 세션에 들어가는 길은 이것 하나뿐(승인 길 없음).
/// 기록(notify.log)엔 꼬리표·세션·성공만 — 남의 말 본문은 안 남긴다
pub fn deliver(session: &str, text: &str) -> Result<(), String> {
    crate::claude::type_text_tagged(session, text, "team-deliver")
}

#[cfg(test)]
#[path = "team_relay_inbox_tests.rs"]
mod tests;
