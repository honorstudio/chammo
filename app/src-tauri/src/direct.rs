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

#[derive(Deserialize, Debug, Clone, PartialEq)]
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
        if r["type"] == "ask" && r["from"] == ask["from"] {
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
    let id = ask["id"].as_str().unwrap_or_default();
    let tail = |how: &str| crate::i18n::tr(&format!(" — 직접 답(카드 {id}) · 사람이 앱 카드에서 {how}"), &format!(" — direct answer (card {id}) · the person {how} on the app card")).to_string();
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

fn refuse_text(r: Refuse) -> String {
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
    let (typed, picked) = compose(&ask, pick).map_err(refuse_text)?;
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

fn chrono_now() -> String {
    let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    // RFC3339 UTC — 프론트 Date.parse 가 읽는다
    let secs = d.as_secs() as i64;
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
        let newer = format!("{ASK}\n{}", r#"{"type":"ask","id":"ffff0000","from":"a1b2c3d4"}"#);
        assert_eq!(check(&newer, "ab12cd34").unwrap_err(), Refuse::Superseded);
        let other = format!("{ASK}\n{}", r#"{"type":"ask","id":"eeee0000","from":"99999999"}"#);
        assert!(check(&other, "ab12cd34").is_ok(), "다른 세션 카드는 상관없음");
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
    fn 시각() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_729), (2026, 10, 3));
    }
}
