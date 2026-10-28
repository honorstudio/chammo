//! 받은 팀 말 → 내 참모(중계 서버 ADR 0002 '참모 말은 사람 말·승인이 아니다').
//! - 팀 방 말은 내 참모 입력칸에 저절로 안 간다(10-28) — 기록·알림만, 넘기기는 사람이 말풍선에서(이름표 `[남의 참모 · …]`·`[팀 사람 말 · …]` 는 화면 handoffText 가 붙인다).
//!   내 기기끼리 방 말만 이름표를 붙여 넘긴다: `[내 다른 기기 참모 · <기기> · self#<seq>]`·`[내 다른 기기 사람 말 · …]`.
//!   (10-26 전엔 참모 말이 `[팀 참모 · …]` 였다 — '팀 참모'는 방 도우미(team_helper) 이름이 돼서 바꿨다. 옛 이름표도 앱·안내문은 남의 말로 읽는다)
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
    /// delivered(내 기기끼리 방) | human(팀 사람 말 — 사람에게만) | to-human(남의 참모 말 — 사람에게만) | mine | forged | no-assistant | room | react | helper | …
    pub note: String,
    /// "helper" = 방에서 부른 팀 참모의 답(team_helper) — 화면은 이름 자리에 '팀 참모 · <person>'(person = 부른 사람). 비면 칸을 안 쓴다
    #[serde(skip_serializing_if = "String::is_empty")]
    pub via: String,
    /// 반응·붙인 파일(봉투 안쪽 — 비면 칸 없음)
    #[serde(flatten)]
    pub extra: crate::e2e_envelope::Extra,
}

/// 사람·기기 이름 — 이름표를 흉내 내거나 비면 ?
pub(crate) fn safe_name(s: &str) -> String {
    if forged(s) { "?".into() } else { clean_name(s) }
}

/// 보낸 사람 이름 — 다른 멤버·나와 겹치면 멤버 id 앞자리를 붙인다(누가 한 말인지 섞이지 않게, 보안 검토 1-D)
/// 팀이 여럿이면 그 사람이 든 팀 안에서 이름 겹침을 본다(다른 팀의 같은 이름은 섞일 일이 없다)
fn person_of(st: &TeamState, member: &str) -> String {
    let Some(name) = st.member_name(member).map(safe_name) else { return "?".into() };
    let (others, mine) = match st.team_of_member(member) {
        Some(t) => (&t.members, (t.member_id.as_str(), t.display_name.as_str())),
        None => (&st.members, (st.member_id.as_str(), st.display_name.as_str())),
    };
    let clash = others.iter().any(|o| o.id != member && safe_name(&o.display_name) == name) || (member != mine.0 && !mine.1.is_empty() && safe_name(mine.1) == name);
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
/// 종단 암호 봉투를 푼 결과를 받은 말에 입힌다(chammo-relay ADR 0007) — 푼 말은 평문처럼 이름표를 붙이고,
/// 못 푼 말·보안 번호 바뀜·사슬 갈림은 기록만(참모에게 안 넘김, 봉투 JSON 은 안 보인다)
pub fn with_e2e(st: &TeamState, last: u64, m: &Value, opened: &crate::e2e_state::Unwrapped) -> (Action, Record) {
    use crate::e2e_state::Unwrapped;
    let mut v = m.clone();
    match opened {
        Unwrapped::Opened { text, human, at, extra, .. } => {
            // 글이 빈 반응·파일 말도 기록되게(on_msg 는 빈 본문을 건너뛴다)
            let shown = if text.trim().is_empty() && extra.react.is_some() { "(반응)".to_string() } else if text.trim().is_empty() && !extra.files.is_empty() { files_line(&extra.files) } else { text.clone() };
            v["body"] = Value::from(shown.as_str());
            v["origin"] = Value::from(if *human { "human" } else { "agent" });
            // 시각은 보낸 기기가 봉한 것(서명 안) — 서버 at 은 안 믿는다(리뷰 B 중간 6)
            v["at"] = Value::from(*at);
        }
        // 암호 없이 온 말 — 받지 않는다(R8 암호 전용). 버리지 않고 사람에게 알린다
        Unwrapped::Failed(why) if why == "plain" => v["body"] = Value::from("(암호 없이 온 말 — 받지 않았어요. 보낸 쪽 앱이 옛 판이면 업데이트하면 돼요)"),
        Unwrapped::Failed(why) if why == "too-old" => v["body"] = Value::from("(30일 넘게 지난 봉투라 받지 않았어요 — 오래 꺼져 있던 기기의 밀린 말이거나 보낸 기기 시계가 틀렸을 수 있어요)"),
        Unwrapped::Failed(why) if why == "future" => v["body"] = Value::from("(보낸 시각이 하루 넘게 미래인 봉투라 받지 않았어요 — 보낸 기기 시계가 틀렸을 수 있어요)"),
        Unwrapped::Failed(_) => v["body"] = Value::from("(종단 암호 — 이 기기에서 못 연 말)"),
    }
    let (mut act, mut rec) = on_msg(st, last, &v);
    if let Unwrapped::Opened { text, extra, human, .. } = opened {
        rec.extra = extra.clone();
        // 참모 별명은 남의 글 — 이름표 흉내를 거르고, 사람 말엔 안 싣는다
        rec.extra.by = if *human || extra.by.trim().is_empty() { String::new() } else { safe_name(&extra.by) };
        if extra.react.is_some() {
            // 반응은 화면 칩으로만 — 참모 입력칸·알림엔 안 간다
            rec.body = String::new();
            if act != Action::Skip && act != Action::Mine {
                rec.note = "react".into();
                act = Action::Blocked("react".into());
            }
        } else if !extra.files.is_empty() && !text.trim().is_empty() {
            if let Action::Deliver(t) = &act {
                act = Action::Deliver(format!("{t}\n{}", files_line(&extra.files)));
            }
        }
        if text.trim().is_empty() && !extra.files.is_empty() {
            rec.body = String::new();
        }
    }
    // 팀 참모 답 — 방 글일 뿐, 누구의 참모에게도 안 넘긴다(넘기면 참모끼리 되받아 루프가 생긴다)
    if let Unwrapped::Opened { via, note, .. } = opened {
        if via == "helper" && note.is_empty() && act != Action::Skip {
            rec.via = "helper".into();
            rec.note = "helper".into();
            return (Action::Blocked("helper".into()), rec);
        }
    }
    let note = match opened {
        Unwrapped::Failed(why) if why == "plain" => "e2e-plain".to_string(),
        Unwrapped::Failed(why) if why == "too-old" => "e2e-old".to_string(),
        Unwrapped::Failed(why) if why == "future" => "e2e-future".to_string(),
        Unwrapped::Failed(_) => "e2e-fail".to_string(),
        Unwrapped::Opened { note, .. } if !note.is_empty() => format!("e2e-{note}"),
        _ => return (act, rec),
    };
    if act == Action::Skip {
        return (act, rec);
    }
    rec.note = note;
    (Action::Blocked("e2e".into()), rec)
}

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
        via: String::new(),
        extra: Default::default(),
    };
    if seq <= last || body.trim().is_empty() {
        return (Action::Skip, rec);
    }
    // 이 기기가 보낸 말(다시 붙을 때 밀린 말에 섞여 온다) — 보낼 때 이미 'sent' 로 적었다
    if rec.device == st.device_id && (own || st.is_me(member)) {
        return (Action::Skip, rec);
    }
    if !own && st.is_me(member) {
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
    // 팀 메신저 말(남의 사람·그 사람 참모 — DM·팀챗·@내이름 무엇이든)은 내 참모 입력칸에 저절로 안 넣는다(10-28 사용자:
    // "매번 모든 메시지를 보고 내 참모가 감지하라는 뜻이 아님" — 아이맥 참모가 사람끼리 DM 에 혼자 끼어 답했다).
    // 사람에게만 보이고(기록·알림), 참모에겐 사람이 말풍선 '내 참모에게'로 고른 참모 하나에만 보낸다(team_ui::team_handoff).
    // 표시: 단톡방 일반 말 room(안 울림) · 나를 부른 단톡방 말과 DM 사람 말 human · 남의 참모 말 to-human · 흉내 forged
    if !own {
        let group = st.rooms.iter().any(|r| r.id == room && r.kind == "group");
        rec.note = if forged(&rec.body) {
            "forged"
        } else if group && (!mentions_me(st, room, &rec.body) || helper_call(&rec.body)) {
            "room"
        } else if rec.origin == "human" {
            "human"
        } else {
            "to-human"
        }
        .into();
        return (Action::Blocked(rec.note.clone()), rec);
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

/// 참모에게 보일 파일 줄 — 이름만(남의 글이라 거른다)
fn files_line(files: &[Value]) -> String {
    let names: Vec<String> = files.iter().map(|f| safe_name(f["name"].as_str().unwrap_or("?"))).collect();
    format!("({} {})", crate::i18n::tr("붙인 파일:", "Files:"), names.join(", "))
}

/// '@팀참모'(영문 '@TeamHelper')로 시작하는 글 — 팀 참모(team_helper)가 답한다
pub fn helper_call(body: &str) -> bool {
    let t = body.trim_start();
    use crate::team_helper::{MENTION_EN, MENTION_KO};
    t.starts_with(MENTION_KO) || t.get(..MENTION_EN.len()).is_some_and(|h| h.eq_ignore_ascii_case(MENTION_EN))
}

/// 이 방 팀에서 내 표시 이름(팀마다 다르다)
fn my_name(st: &TeamState, room: &str) -> String {
    let team = st.rooms.iter().find(|r| r.id == room).map(|r| r.team.as_str()).unwrap_or("");
    let t = st.teams.iter().find(|t| t.id == team);
    let mine = t.map(|t| t.member_id.as_str()).unwrap_or(st.member_id.as_str());
    t.map(|t| t.display_name.trim().to_string()).filter(|n| !n.is_empty()).or_else(|| st.member_name(mine).map(|n| n.trim().to_string())).unwrap_or_default()
}

/// 이 방 팀에서 내 이름을 '@이름'으로 불렀나 — 이름 바로 뒤에 영문·숫자가 붙으면 다른 이름. 한글은 조사(님·아)가 붙어 가리지 못해 부름으로 본다
pub fn mentions_me(st: &TeamState, room: &str, body: &str) -> bool {
    let name = my_name(st, room);
    if name.is_empty() {
        return false;
    }
    let at = format!("@{name}");
    body.match_indices(&at).any(|(i, _)| {
        let next = body[i + at.len()..].chars().next();
        next.is_none_or(|c| !c.is_ascii_alphanumeric())
    })
}

/// 참모에게 칠 글 — 이름표 한 줄 + 거른 본문(길면 잘라서). 내 기기끼리 방 말만 온다(팀 방 말은 on_msg 가 막는다). 승인 문구는 사람 말이어도 막음
pub fn compose(r: &Record) -> Result<String, SayErr> {
    if forged(&r.body) {
        return Err(SayErr::Forged);
    }
    let body = if r.body.chars().count() > MAX_SAY { format!("{}\n…(잘림)", r.body.chars().take(MAX_SAY - 20).collect::<String>()) } else { r.body.clone() };
    let lines = body_lines(&body)?;
    let head = if r.origin == "human" {
        format!("[{} · {} · self#{}]", crate::i18n::tr("내 다른 기기 사람 말", "My device human"), r.device_name, r.seq)
    } else {
        format!("[{} · {} · self#{}]", crate::i18n::tr("내 다른 기기 참모", "My device assistant"), r.device_name, r.seq)
    };
    Ok(format!("{head}\n{}", lines.join("\n")))
}

/// 한 사람 몫으로 줄 세워 두는 말 수 — 넘친 건 기록에만 두고 묶음 머리에 개수를 적는다
pub const HOLD_MAX: usize = 20;

/// 1분 상한(peer PER_MIN)을 넘은 말 — 버리지 않고 사람마다 줄 세웠다가, 자리가 나면 한 번에 묶어 넘긴다(묶음 하나 = 상한 한 칸).
/// 10-28 아이맥: 상한에 걸린 #32~#36 다섯 개가 기록에만 남고 참모 입력칸엔 조용히 안 들어갔다
#[derive(Default)]
pub struct RateHold {
    /// 사람(멤버, 없으면 기기) → (넘길 글, 넘친 개수)
    q: HashMap<String, (Vec<String>, usize)>,
}

impl RateHold {
    pub fn push(&mut self, key: &str, text: String) {
        let e = self.q.entry(key.to_string()).or_default();
        if e.0.len() < HOLD_MAX {
            e.0.push(text);
        } else {
            e.1 += 1;
        }
    }

    /// 줄 선 말이 있나 — 있으면 새 말도 그 뒤에 선다(차례가 안 뒤집히게)
    pub fn has(&self, key: &str) -> bool {
        self.q.contains_key(key)
    }

    pub fn ready(&mut self, rate: &mut HashMap<String, Vec<u64>>, now: u64) -> Vec<String> {
        self.ready_in(rate, now, 60_000)
    }

    /// 자리가 난 사람 몫을 묶음 하나씩 — window 는 시험이 줄여 쓴다
    pub fn ready_in(&mut self, rate: &mut HashMap<String, Vec<u64>>, now: u64, window: u64) -> Vec<String> {
        let keys: Vec<String> = self.q.keys().cloned().collect();
        let mut out = Vec::new();
        for k in keys {
            if crate::peer_link::allow_in_window(rate, &k, now, window) {
                if let Some((texts, over)) = self.q.remove(&k) {
                    out.push(held_batch(&texts, over));
                }
            }
        }
        out
    }
}

/// 묶음 — 머리 한 줄은 앱 말(사람 이름은 안 싣는다 — 남이 고른 이름이 앱 줄에 섞이지 않게), 그 아래는 받은 말 그대로(이름표째)
fn held_batch(texts: &[String], over: usize) -> String {
    let n = crate::peer_link::PER_MIN;
    let mut head = crate::i18n::tr(
        &format!("[앱] 같은 사람이 1분에 {n}개 넘게 보내서 늦게 묶어 넘겨 — {}개", texts.len()),
        &format!("[App] Same sender went over {n} a minute — passing these on late, together: {}", texts.len()),
    )
    .to_string();
    if over > 0 {
        head.push_str(&crate::i18n::tr(&format!(" · 넘친 {over}개는 기록에만(scripts/team inbox)"), &format!(" · {over} more kept in the record only (scripts/team inbox)")));
    }
    format!("{head}

{}", texts.join("

"))
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

/// '@이름' 이 글에 있나 — 이름 바로 뒤가 영문·숫자면 다른 이름(@참모x), '-'·한글·공백(@참모-2·@참모님)은 부름.
/// '@' 바로 앞이 영문·숫자면 이메일(x@a.com)이라 부름 아님
fn at_name(body: &str, name: &str) -> bool {
    let at = format!("@{name}");
    body.match_indices(&at).any(|(i, _)| {
        body[..i].chars().next_back().is_none_or(|c| !c.is_ascii_alphanumeric()) && body[i + at.len()..].chars().next().is_none_or(|c| !c.is_ascii_alphanumeric())
    })
}

/// 넘길 글(이름표 줄 + 본문)에서 '@번호'·'@별명'으로 부른 HQ 참모 — 여럿이면 가장 긴 이름(@참모-2 가 @참모 를 이긴다). 이름표 줄(남의 이름)은 안 본다.
/// 참모(앱이 참모로 치는 이름 — messenger::is_orch_name)만 — 남의 말 본문으로 도우미·예약 세션에 글을 넣지 않는다
pub fn called(sessions_json: &str, hq: &str, assistant: &str, text: &str) -> Option<String> {
    let body = text.split_once('\n').map(|(_, b)| b)?;
    let v: Value = serde_json::from_str(sessions_json).ok()?;
    let mut best: Option<(usize, String)> = None;
    let orch = |a: &&Value| crate::platform::same_dir(a["cwd"].as_str().unwrap_or(""), hq) && crate::messenger::is_orch_name(a["name"].as_str().unwrap_or(""), assistant);
    for a in v.as_array()?.iter().filter(orch) {
        let name = a["name"].as_str().unwrap_or("");
        let (num, nick) = name.split_once(" · ").unwrap_or((name, ""));
        for n in [name, num, nick] {
            if !n.trim().is_empty() && at_name(body, n) && best.as_ref().is_none_or(|(l, _)| n.len() > *l) {
                best = Some((n.len(), a["id"].as_str().unwrap_or("").to_string()));
            }
        }
    }
    best.map(|(_, id)| id).filter(|id| !id.is_empty())
}

#[cfg(test)]
#[path = "team_relay_inbox_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "team_call_live_tests.rs"]
mod call_live;
