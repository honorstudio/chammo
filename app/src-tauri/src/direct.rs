//! 직접 답하기 카드(2026-10-03 사용자 "내 파트너는 세션 옮겨 가면서 하는 거 어려워할 것 같아") — 하위 세션이 본인 승인·본인 입력을 원하면
//! scripts/direct ask 로 <데이터>/direct.jsonl 에 카드를 남기고 턴을 끝낸다. 사람이 앱(데스크톱 채팅·폰) 카드에서 누르거나 치면
//! 앱이 그 세션 입력칸에 사람 입력으로 친다(claude attach — 진짜 사용자 턴). 앱이 치는 건 사람이 누를 때만:
//! 데스크톱은 메인 창 웹뷰의 클릭, 폰은 짝지은 기기 토큰. scripts/app(appctl) 에는 이 길이 없다
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Mutex;

/// 카드 답 하나 — 맞춰 보고 기록하고 치는 동안 다른 답(폰·데스크톱 동시)이 끼지 않게
static ANSWER_LOCK: Mutex<()> = Mutex::new(());
const MAX_TEXT: usize = 2000;

#[derive(Deserialize, serde::Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "pick", rename_all = "lowercase")]
pub enum Pick {
    Yes,
    No,
    Option { option: usize },
    Text { text: String },
}

#[derive(Debug, PartialEq)]
pub enum Refuse {
    NotFound,
    /// 이미 답했다(다른 기기·다른 사람)
    Answered,
    /// 세션이 끝냈거나 거둬들였다
    Closed,
    /// 같은 세션이 그 뒤 새 카드를 열었다 — 지난 질문
    Superseded,
    Bad(String),
}

/// 기록에서 그 카드와 지금 답할 수 있는지
pub fn check(log: &str, id: &str) -> Result<Value, Refuse> {
    let rows: Vec<Value> = log.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    let ask = rows.iter().find(|r| r["type"] == "ask" && r["id"] == id).cloned().ok_or(Refuse::NotFound)?;
    let after = rows.iter().skip_while(|r| !(r["type"] == "ask" && r["id"] == id)).skip(1);
    let mut answered = false;
    for r in after {
        if r["id"] == id && r["type"] == "answer" {
            answered = true;
        }
        if r["id"] == id && r["type"] == "answer-failed" {
            answered = false; // 치다 실패 — 다시 누를 수 있다
        }
        if r["id"] == id && (r["type"] == "done" || r["type"] == "cancel") {
            return Err(Refuse::Closed);
        }
        // 연결 요청 카드는 기기마다 따로 — 둘이 같이 오면 앞 카드가 '지난 질문'이 돼 눌러도 안 됐다(같은 기기 새 요청은 peer_ask 가 옛 카드를 닫는다).
        // 결제 카드도 뒤 카드에 안 밀린다 — 답·거둠·처리로만 끝(2026-10-22 아이맥 001). 화면(domain/directAsk stays)과 같은 규칙
        if r["type"] == "ask" && r["from"] == ask["from"] && ask["kind"] != LINK_KIND && ask["kind"] != "pay" {
            return Err(Refuse::Superseded);
        }
    }
    if answered {
        return Err(Refuse::Answered);
    }
    Ok(ask)
}

/// 세션 입력칸에 칠 한 줄과 기록에 남길 고른 것(자유 글은 길이만 — 친 글은 세션에만 간다)
pub fn compose(ask: &Value, pick: &Pick) -> Result<(String, Value), Refuse> {
    compose_by(ask, pick, "desktop")
}

/// by = 누른 곳(desktop·phone·telegram:<id>) — 텔레그램이면 세션에 '텔레그램 카드에서'로 알린다
pub fn compose_by(ask: &Value, pick: &Pick, by: &str) -> Result<(String, Value), Refuse> {
    let id = ask["id"].as_str().unwrap_or_default();
    let tg = by.starts_with("telegram:");
    // 원격(peer_human) — 짝지은 다른 기기 앱 화면·그 기기 폰에서 사람이 눌렀다
    let remote = by.strip_prefix("remote:").map(|d| d.chars().filter(|c| !c.is_control()).take(40).collect::<String>());
    let (ko_at, en_at) = match (&remote, tg) {
        (Some(d), _) => (format!("{d}에서 원격으로 앱 카드에서"), format!("on the app card, remotely from {d}")),
        (None, true) => ("텔레그램 카드에서".into(), "on the Telegram card".into()),
        (None, false) => ("앱 카드에서".into(), "on the app card".into()),
    };
    let tail = |how: &str| crate::i18n::tr(&format!(" — 직접 답(카드 {id}) · 사람이 {ko_at} {how}"), &format!(" — direct answer (card {id}) · the person {how} {en_at}")).to_string();
    let pressed = crate::i18n::tr("눌렀어", "pressed it");
    let label = |k: &str| ask[k].as_str().unwrap_or_default().to_string();
    match pick {
        Pick::Yes => Ok((format!("{}{}", label("yes"), tail(pressed)), json!({ "pick": "yes", "label": label("yes") }))),
        Pick::No => Ok((format!("{}{}", label("no"), tail(pressed)), json!({ "pick": "no", "label": label("no") }))),
        Pick::Option { option } => {
            let o = ask["options"].get(*option).and_then(|v| v.as_str()).ok_or_else(|| Refuse::Bad("no such option".into()))?;
            Ok((format!("{o}{}", tail(pressed)), json!({ "pick": "option", "label": o })))
        }
        Pick::Text { text } => {
            let t: String = text.chars().map(|c| if c == '\n' || c == '\t' { ' ' } else { c }).filter(|c| !c.is_control()).collect();
            let t = t.trim();
            if t.is_empty() || t.chars().count() > MAX_TEXT {
                return Err(Refuse::Bad("empty or too long".into()));
            }
            Ok((format!("{t}{}", tail(crate::i18n::tr("썼어", "wrote it"))), json!({ "pick": "text", "len": t.chars().count() })))
        }
    }
}

fn log_path() -> std::path::PathBuf {
    crate::config::data_file("direct.jsonl")
}

fn append(row: &Value) -> Result<(), String> {
    use std::io::Write;
    let p = log_path();
    let mut o = std::fs::OpenOptions::new();
    o.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let mut f = o.open(&p).map_err(|e| e.to_string())?;
    writeln!(f, "{row}").map_err(|e| e.to_string())
}

pub(crate) fn refuse_text(r: Refuse) -> String {
    match r {
        Refuse::NotFound => crate::i18n::tr("없는 카드", "No such card").into(),
        Refuse::Answered => crate::i18n::tr("이미 답했어요", "Already answered").into(),
        Refuse::Closed => crate::i18n::tr("세션이 이 질문을 끝냈어요", "The session closed this question").into(),
        Refuse::Superseded => crate::i18n::tr("세션이 새 질문을 올려서 지난 질문이에요", "Replaced by a newer question").into(),
        Refuse::Bad(s) => s,
    }
}

/// 답하기 — 맞춰 보고(이미 답함·끝남·지난 질문·세션 꺼짐) 기록 먼저 남기고 세션에 친다. 치다 실패하면 실패 줄을 남겨 다시 누를 수 있게
pub fn answer(id: &str, pick: &Pick, by: &str) -> Result<(), String> {
    let _one = ANSWER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let log = std::fs::read_to_string(log_path()).unwrap_or_default();
    let ask = check(&log, id).map_err(refuse_text)?;
    // 다른 기기 연결 요청 카드(peer_ask) — 세션에 치지 않고 앱이 그 자리에서 허용·거절을 적는다
    if ask["kind"] == LINK_KIND {
        let yes = link_pick(pick, by).map_err(refuse_text)?;
        if ask["sub"] == PHONE_SUB {
            crate::mobile::devices().decide_hold(id, yes)?;
        } else {
            crate::peer_ask::asks().decide(id, yes, crate::messenger_cmd::now_ms())?;
        }
        let label = ask[if yes { "yes" } else { "no" }].as_str().unwrap_or_default();
        return append(&json!({ "ts": chrono_now(), "type": "answer", "id": id, "by": by, "pick": if yes { "yes" } else { "no" }, "label": label }));
    }
    let (typed, picked) = compose_by(&ask, pick, by).map_err(refuse_text)?;
    let sid = ask["from"].as_str().unwrap_or_default().to_string();
    if !crate::claude::listed_alive(&sid) {
        return Err(crate::i18n::tr("세션이 꺼져서 못 보냈어요", "The session is gone").into());
    }
    let now = chrono_now();
    let mut row = json!({ "ts": now, "type": "answer", "id": id, "by": by });
    if let (Some(r), Some(p)) = (row.as_object_mut(), picked.as_object()) {
        r.extend(p.clone());
    }
    append(&row)?; // 기록 먼저 — 치는 동안 다른 기기가 또 누르지 않게
    let r = crate::claude::type_text_quiet(&sid, &typed); // 글은 로그에 안 남긴다
    if let Err(e) = &r {
        let _ = append(&json!({ "ts": chrono_now(), "type": "answer-failed", "id": id }));
        return Err(e.clone());
    }
    Ok(())
}

/// 다른 기기 연결 요청 카드 — from 은 세션이 아니라 앱(@link)
pub const LINK_KIND: &str = "link";
pub const LINK_FROM: &str = "@link";

/// 연결 요청 카드 답 — 허용·거절 두 단추만, 사람 길 중에서도 이 앱 화면(데스크톱 메인 창)과 짝지은 폰만.
/// 텔레그램(밖의 중계)·참모(appctl 엔 길 자체가 없다)·다른 기기 참모 열쇠(/api/direct-answer 403)로는 못 누른다
pub fn link_pick(pick: &Pick, by: &str) -> Result<bool, Refuse> {
    if by != "desktop" && by != "phone" {
        return Err(Refuse::Bad(crate::i18n::tr("기기 연결은 앱이나 짝지은 폰 카드에서만 허용해요", "Device links are approved only in the app or a paired phone").into()));
    }
    match pick {
        Pick::Yes => Ok(true),
        Pick::No => Ok(false),
        _ => Err(Refuse::Bad("allow or decline only".into())),
    }
}

/// 연결 요청 카드 줄 — 이름·테일넷·OS 는 이 기기 tailscale 이 말한 것(요청이 보낸 글이 아니다). until 이 지나면 화면이 '시간 지남'으로
pub fn link_row(id: &str, p: &crate::peer_ask::LinkPeer, until_ms: u64, ts: &str) -> Value {
    let name: String = p.name.chars().filter(|c| !c.is_control()).take(64).collect();
    let tn: String = p.tailnet.chars().filter(|c| !c.is_control()).take(64).collect();
    json!({
        "ts": ts, "type": "ask", "id": id, "from": LINK_FROM, "cwd": "", "kind": LINK_KIND,
        "q": crate::i18n::tr(&format!("{name} 기기와 연결할까요? 이 기기 참모와 말을 주고받게 돼요"), &format!("Link with {name}? The assistants on both devices will be able to talk")),
        "detail": crate::i18n::tr(&format!("테일넷 {tn} · {}", p.os), &format!("Tailnet {tn} · {}", p.os)),
        "what": crate::i18n::tr("다른 기기 연결 요청", "Link request from another device"),
        "yes": crate::i18n::tr("허용", "Allow"), "no": crate::i18n::tr("거절", "Decline"), "options": [],
        "until": iso_of_ms(until_ms),
    })
}

/// 연결 요청 카드 남기기 → 카드 id(8자, 다른 카드와 같은 모양)
pub(crate) fn ask_link(p: &crate::peer_ask::LinkPeer, until_ms: u64) -> Result<String, String> {
    // ANSWER_LOCK 은 안 잡는다 — 답(answer)이 그 자물쇠 안에서 peer_ask 자물쇠를 잡으니 거꾸로 잡으면 서로 기다린다.
    // 줄 하나 덧붙이기(O_APPEND)라 겹쳐도 안 깨지고, 두 번 답하기는 peer_ask::decide 가 막는다
    let id = crate::mobile_pair::random_hex(4).map_err(|e| e.to_string())?;
    append(&link_row(&id, p, until_ms, &chrono_now()))?;
    Ok(id)
}

/// 참모가 만든 폰 연결 QR(scripts/app phone pair)의 사람 허용 카드 — 연결 요청 카드와 같은 판(kind link, from @link, 사람 길로만 답), sub = phone
pub const PHONE_SUB: &str = "phone";
pub fn phone_pair_row(id: &str, until_ms: u64, ts: &str) -> Value {
    json!({
        "ts": ts, "type": "ask", "id": id, "from": LINK_FROM, "cwd": "", "kind": LINK_KIND, "sub": PHONE_SUB,
        "q": crate::i18n::tr("이 폰을 연결할까요? 참모가 폰 연결 QR 을 만들었어요", "Link this phone? An assistant made a phone link QR"),
        "detail": crate::i18n::tr("허용하면 그 QR 을 연 폰이 이 컴퓨터에 사람으로 닿아요(카드 답·말 보내기). 내가 연 게 아니면 거절", "If allowed, the phone that opened the QR reaches this computer as you (card answers, messages). Decline if it wasn't you"),
        "what": crate::i18n::tr("폰 연결 허용", "Allow phone link"),
        "yes": crate::i18n::tr("허용", "Allow"), "no": crate::i18n::tr("거절", "Decline"), "options": [],
        "until": iso_of_ms(until_ms),
    })
}

/// 폰 연결 허용 카드 남기기 → 카드 id
pub(crate) fn ask_phone_pair(until_ms: u64) -> Result<String, String> {
    let id = crate::mobile_pair::random_hex(4).map_err(|e| e.to_string())?;
    append(&phone_pair_row(&id, until_ms, &chrono_now()))?;
    Ok(id)
}

/// 연결 요청 카드 끝 — 연결됨·시간 지남·실패를 한 줄로
pub(crate) fn close_link(id: &str, note: &str) {
    let _ = append(&json!({ "ts": chrono_now(), "type": "done", "id": id, "note": note }));
}

pub(crate) fn chrono_now() -> String {
    let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    // RFC3339 UTC — 프론트 Date.parse 가 읽는다
    let secs = d.as_secs() as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (y, m, dd) = civil(days);
    format!("{y:04}-{m:02}-{dd:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// 밀리초 → 같은 RFC3339 UTC 모양(보관함 폰 목록의 ts)
pub(crate) fn iso_of_ms(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (y, m, dd) = civil(days);
    format!("{y:04}-{m:02}-{dd:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// 1970-01-01 부터 날 수 → 연·월·일(Howard Hinnant civil_from_days)
fn civil(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 앱이 카드를 처음 화면에 그렸다는 줄(2026-10-05 아이맥 — 참모가 기록에 ask 줄만 보고 떴다고 믿었다) — scripts/direct ask·status 가 읽는다.
/// 없는 카드면 거절, 같은 카드·같은 자리 줄이 이미 있으면 None(또 안 쓴다). 자리 이름은 제어 문자 빼고 60자
pub fn shown_row(log: &str, id: &str, place: &str, ts: &str) -> Result<Option<Value>, Refuse> {
    let rows: Vec<Value> = log.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    if !rows.iter().any(|r| r["type"] == "ask" && r["id"] == id) {
        return Err(Refuse::NotFound);
    }
    let place: String = place.chars().filter(|c| !c.is_control()).take(60).collect();
    if place.trim().is_empty() {
        return Err(Refuse::Bad("empty place".into()));
    }
    if rows.iter().any(|r| r["type"] == "shown" && r["id"] == id && r["where"] == place.as_str()) {
        return Ok(None);
    }
    Ok(Some(json!({ "ts": ts, "type": "shown", "id": id, "where": place })))
}

/// 앱 밖 자리(메신저)에 카드를 보냈다는 줄 — 답과 같은 자물쇠 안에서
pub(crate) fn mark_shown(id: &str, place: &str) -> Result<(), String> {
    let _one = ANSWER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let log = std::fs::read_to_string(log_path()).unwrap_or_default();
    match shown_row(&log, id, place, &chrono_now()).map_err(refuse_text)? {
        Some(row) => append(&row),
        None => Ok(()),
    }
}

/// 데스크톱 카드가 화면에 보였다 — 메인 창에서만. 기록 쓰기는 답과 같은 자물쇠 안에서(맞춰 보고 쓰는 사이 겹치지 않게)
#[tauri::command]
pub fn direct_shown(window: tauri::WebviewWindow, id: String, place: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("main window only".into());
    }
    let _one = ANSWER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let log = std::fs::read_to_string(log_path()).unwrap_or_default();
    match shown_row(&log, &id, &place, &chrono_now()).map_err(refuse_text)? {
        Some(row) => append(&row),
        None => Ok(()),
    }
}

/// 카드 기록 원문(프론트 domain/directAsk 가 읽는다)
#[tauri::command]
pub fn direct_log() -> String {
    std::fs::read_to_string(log_path()).unwrap_or_default()
}

/// 데스크톱 카드 답 — 메인 창 웹뷰에서만(다른 창·원격 페이지는 못 부른다). 프론트는 진짜 클릭(isTrusted)에서만 부른다
#[tauri::command]
pub async fn direct_answer(window: tauri::WebviewWindow, id: String, pick: Pick) -> Result<(), String> {
    if window.label() != "main" {
        return Err("main window only".into());
    }
    tauri::async_runtime::spawn_blocking(move || answer(&id, &pick, "desktop")).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const ASK: &str = r#"{"ts":"2026-10-03T06:00:00Z","type":"ask","id":"ab12cd34","from":"a1b2c3d4","kind":"pay","q":"결제?","yes":"결제 승인","no":"거절","options":["개인","법인"]}"#;

    #[test]
    fn 기다리는_카드만_답한다() {
        assert_eq!(check(ASK, "ab12cd34").unwrap()["kind"], "pay");
        assert_eq!(check(ASK, "zz").unwrap_err(), Refuse::NotFound);
        let answered = format!("{ASK}\n{}", r#"{"type":"answer","id":"ab12cd34","pick":"yes"}"#);
        assert_eq!(check(&answered, "ab12cd34").unwrap_err(), Refuse::Answered, "폰·데스크톱 동시면 먼저 누른 것만");
        let done = format!("{ASK}\n{}", r#"{"type":"cancel","id":"ab12cd34"}"#);
        assert_eq!(check(&done, "ab12cd34").unwrap_err(), Refuse::Closed);
        let newer = format!("{}\n{}", ASK.replace(r#""kind":"pay""#, r#""kind":"send""#), r#"{"type":"ask","id":"ffff0000","from":"a1b2c3d4"}"#);
        assert_eq!(check(&newer, "ab12cd34").unwrap_err(), Refuse::Superseded, "결제 아닌 카드는 같은 세션 새 카드에 밀린다");
        let other = format!("{ASK}\n{}", r#"{"type":"ask","id":"eeee0000","from":"99999999"}"#);
        assert!(check(&other, "ab12cd34").is_ok(), "다른 세션 카드는 상관없음");
    }

    #[test]
    fn 결제_카드는_같은_세션_뒤_카드에_안_밀린다() {
        // 2026-10-22 아이맥 001 — 결제 카드 뒤에 다른 카드를 띄우면 결제 카드가 지난 질문으로 숨었다
        let log = format!("{ASK}\n{}", r#"{"type":"ask","id":"ffff0000","from":"a1b2c3d4","kind":"other"}"#);
        assert!(check(&log, "ab12cd34").is_ok(), "결제 카드는 아직 누를 수 있다");
        let other = r#"{"type":"ask","id":"eeee0000","from":"a1b2c3d4","kind":"other"}"#;
        let log = format!("{other}\n{ASK}");
        assert_eq!(check(&log, "eeee0000").unwrap_err(), Refuse::Superseded, "결제 아닌 앞 카드는 그대로 지난 질문");
    }

    #[test]
    fn 연결_요청_카드_둘은_서로_지난_질문이_아니다() {
        let peer = |name: &str| crate::peer_ask::LinkPeer { id: format!("n-{name}"), name: name.into(), os: "macOS".into(), ip: std::net::Ipv4Addr::new(100, 64, 0, 1), tailnet: "t".into() };
        let log = format!("{}\n{}", link_row("aa11bb22", &peer("A"), 0, "2026-10-21T00:00:00Z"), link_row("cc33dd44", &peer("B"), 0, "2026-10-21T00:00:01Z"));
        assert!(check(&log, "aa11bb22").is_ok(), "앞 기기 카드도 누를 수 있다");
        assert!(check(&log, "cc33dd44").is_ok());
    }

    #[test]
    fn 실패한_뒤엔_다시_누를_수_있게_실패_줄은_답으로_안_친다() {
        let failed = format!("{ASK}\n{}", r#"{"type":"answer-failed","id":"ab12cd34"}"#);
        // 답 줄이 먼저 남고 실패 줄이 뒤따른다 — 실패면 앞 답 줄을 무른다
        let both = format!("{ASK}\n{}\n{}", r#"{"type":"answer","id":"ab12cd34","pick":"yes"}"#, r#"{"type":"answer-failed","id":"ab12cd34"}"#);
        assert!(check(&failed, "ab12cd34").is_ok());
        assert!(check(&both, "ab12cd34").is_ok());
    }

    #[test]
    fn 칠_글은_고른_버튼_글자_더하기_카드_표시() {
        let ask: Value = serde_json::from_str(ASK).unwrap();
        let (t, p) = compose(&ask, &Pick::Yes).unwrap();
        assert!(t.starts_with("결제 승인") && t.contains("ab12cd34"), "{t}");
        assert_eq!(p["pick"], "yes");
        assert!(compose(&ask, &Pick::Option { option: 1 }).unwrap().0.starts_with("법인"));
        assert!(compose(&ask, &Pick::Option { option: 9 }).is_err());
    }

    #[test]
    fn 텔레그램_버튼_답은_텔레그램_카드라고_알린다() {
        let ask: Value = serde_json::from_str(ASK).unwrap();
        let (t, _) = compose_by(&ask, &Pick::Option { option: 0 }, "telegram:7001").unwrap();
        assert!(t.contains("직접 답(카드 ab12cd34)") && t.contains("텔레그램 카드에서 눌렀어"), "{t}");
        assert!(compose(&ask, &Pick::Yes).unwrap().0.contains("앱 카드에서"));
    }

    #[test]
    fn 원격_카드_답은_어느_기기에서_눌렀는지_알린다() {
        let ask: Value = serde_json::from_str(ASK).unwrap();
        let (t, _) = compose_by(&ask, &Pick::Yes, "remote:맥북\u{1b}").unwrap();
        assert!(t.starts_with("결제 승인") && t.contains("직접 답(카드 ab12cd34)") && t.contains("맥북에서 원격으로 앱 카드에서 눌렀어"), "{t}");
        assert!(!t.contains('\u{1b}'));
        // 연결 요청 카드는 원격으로 못 누른다
        assert!(link_pick(&Pick::Yes, "remote:맥북").is_err());
    }

    #[test]
    fn 자유_글은_한_줄로_기록엔_길이만() {
        let ask: Value = serde_json::from_str(ASK).unwrap();
        let (t, p) = compose(&ask, &Pick::Text { text: "카드 말고\n계좌로\u{1b}[2J".into() }).unwrap();
        assert!(t.starts_with("카드 말고 계좌로[2J") && !t.contains('\n') && !t.contains('\u{1b}'), "{t}");
        assert_eq!(p, json!({ "pick": "text", "len": 12 }));
        assert!(compose(&ask, &Pick::Text { text: "  ".into() }).is_err());
    }

    #[test]
    fn 고르기_모양() {
        assert_eq!(serde_json::from_str::<Pick>(r#"{"pick":"option","option":1}"#).unwrap(), Pick::Option { option: 1 });
        assert_eq!(serde_json::from_str::<Pick>(r#"{"pick":"yes"}"#).unwrap(), Pick::Yes);
        assert!(serde_json::from_str::<Pick>(r#"{"pick":"rm"}"#).is_err());
    }

    #[test]
    fn 보임_줄은_있는_카드에_자리마다_한_번() {
        let t = "2026-10-05T10:26:28Z";
        let row = shown_row(ASK, "ab12cd34", "chat:참모", t).unwrap().unwrap();
        assert_eq!(row, json!({ "ts": t, "type": "shown", "id": "ab12cd34", "where": "chat:참모" }));
        let again = format!("{ASK}\n{row}");
        assert_eq!(shown_row(&again, "ab12cd34", "chat:참모", t).unwrap(), None, "같은 자리는 또 안 쓴다");
        assert!(shown_row(&again, "ab12cd34", "inbox", t).unwrap().is_some(), "다른 자리는 쓴다");
        // soak 008 — 앱이 알림을 낸 때 남기는 notified 줄이 있어도, 나중에 화면에 그린 줄은 따로 쓴다
        let note = shown_row(ASK, "ab12cd34", "notified", t).unwrap().unwrap();
        let after = format!("{ASK}\n{note}");
        assert!(shown_row(&after, "ab12cd34", "chat:참모", t).unwrap().is_some());
        assert_eq!(shown_row(&after, "ab12cd34", "notified", t).unwrap(), None);
        assert_eq!(shown_row(ASK, "zz", "inbox", t).unwrap_err(), Refuse::NotFound);
        let odd = shown_row(ASK, "ab12cd34", &format!("chat:\n{}", "가".repeat(100)), t).unwrap().unwrap();
        let w = odd["where"].as_str().unwrap();
        assert!(!w.contains('\n') && w.chars().count() == 60, "{w}");
        assert!(shown_row(ASK, "ab12cd34", "\n\t", t).is_err());
    }

    #[test]
    fn 보임_줄은_답할_수_있나에_영향_없다() {
        let shown = format!("{ASK}\n{}", r#"{"type":"shown","id":"ab12cd34","where":"inbox"}"#);
        assert!(check(&shown, "ab12cd34").is_ok());
    }

    #[test]
    fn pe_연결_요청_카드는_허용_거절만_앱과_폰에서만() {
        assert_eq!(link_pick(&Pick::Yes, "desktop"), Ok(true));
        assert_eq!(link_pick(&Pick::No, "phone"), Ok(false));
        assert!(link_pick(&Pick::Yes, "telegram:7001").is_err(), "밖의 중계로는 못 누른다");
        assert!(link_pick(&Pick::Yes, "peer").is_err());
        assert!(link_pick(&Pick::Yes, "").is_err());
        assert!(link_pick(&Pick::Option { option: 0 }, "desktop").is_err());
        assert!(link_pick(&Pick::Text { text: "허용".into() }, "desktop").is_err(), "글로는 허용 못 한다");
    }

    #[test]
    fn pe_연결_요청_카드_줄은_기기_이름과_테일넷() {
        let p = crate::peer_ask::LinkPeer { id: "nA".into(), name: "office-mac\u{1b}".into(), os: "macOS".into(), ip: "100.64.0.2".parse().unwrap(), tailnet: "me@example.com".into() };
        let r = link_row("ab12cd34", &p, 1_800_000_300_000, "2027-01-15T08:00:00Z");
        assert_eq!((r["from"].as_str(), r["kind"].as_str(), r["yes"].as_str(), r["no"].as_str()), (Some(LINK_FROM), Some(LINK_KIND), Some("허용"), Some("거절")));
        let q = r["q"].as_str().unwrap();
        assert!(q.contains("office-mac 기기와 연결할까요") && !q.contains('\u{1b}'), "{q}");
        assert_eq!(r["detail"], "테일넷 me@example.com · macOS");
        assert_eq!(r["until"], "2027-01-15T08:05:00Z");
        // 기록 모양은 보통 카드와 같아 check 를 지난다(이미 답함·끝남 거르기)
        let log = format!("{r}");
        assert!(check(&log, "ab12cd34").is_ok());
        let done = format!("{r}\n{}", json!({ "type": "done", "id": "ab12cd34", "note": "연결됨" }));
        assert_eq!(check(&done, "ab12cd34").unwrap_err(), Refuse::Closed);
    }

    #[test]
    fn 보안_폰_연결_허용_카드는_연결_요청_카드와_같은_판에_sub_phone_답은_사람_길만() {
        let r = phone_pair_row("ab12cd99", 1_800_000_300_000, "2027-01-15T08:00:00Z");
        assert_eq!((r["from"].as_str(), r["kind"].as_str(), r["sub"].as_str()), (Some(LINK_FROM), Some(LINK_KIND), Some(PHONE_SUB)));
        assert!(r["q"].as_str().unwrap().contains("이 폰을 연결할까요"));
        assert!(check(&format!("{r}"), "ab12cd99").is_ok());
        // 참모 길(scripts/direct answer 등 by=세션)로는 허용 못 한다 — 앱·짝지은 폰 카드만
        assert!(link_pick(&Pick::Yes, "desktop").is_ok());
        assert!(link_pick(&Pick::Yes, "remote:nB").is_err());
        assert!(link_pick(&Pick::Yes, "agent").is_err());
    }

    #[test]
    fn 시각() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_729), (2026, 10, 3));
    }
}
