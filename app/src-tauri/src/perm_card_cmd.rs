//! 권한 카드(perm_card)의 앱 길 — 화면 읽기·direct.jsonl 쓰기·키 누르기. 판정은 perm_card(순수)에
use crate::direct::Pick;
use crate::perm_card::{card_row, choice_of, keys_if_same, open_card, open_ids, perm_dialog, Choice};
use serde_json::{json, Value};

/// 앱(useAutoAllow)이 정책 아래에서 부른다: 화면을 읽어 카드를 띄운다 → 카드 id(창을 못 읽으면 None)
pub fn open(sid: &str, cwd: &str) -> Result<Option<String>, String> {
    let screen = crate::claude::screen_of(sid)?;
    let Some(d) = perm_dialog(&screen) else { return Ok(None) };
    let log = crate::direct::direct_log();
    if let Some(id) = open_card(&log, sid, &d.fp) {
        return Ok(Some(id));
    }
    let id = crate::mobile_pair::random_hex(4).map_err(|e| e.to_string())?;
    crate::direct::append_row(&card_row(&id, sid, cwd, &d, &crate::direct::chrono_now()))?;
    Ok(Some(id))
}

/// 세션이 창을 벗어났다(터미널에서 직접 답함·창이 사라짐) — 그 세션의 열린 perm 카드를 거둔다
pub fn close(sid: &str) -> Result<usize, String> {
    let ids = open_ids(&crate::direct::direct_log(), sid);
    for id in &ids {
        crate::direct::append_row(&json!({ "ts": crate::direct::chrono_now(), "type": "cancel", "id": id }))?;
    }
    Ok(ids.len())
}

/// direct::answer 가 perm 카드면 여기로 — 기록 먼저, 같은 창일 때만 누른다. 창이 바뀌었으면 카드를 닫고 거절
pub fn answer(ask: &Value, pick: &Pick, by: &str) -> Result<(), String> {
    let choice = choice_of(pick, by)?;
    let (id, sid, fp) = (ask["id"].as_str().unwrap_or_default(), ask["from"].as_str().unwrap_or_default(), ask["fp"].as_str().unwrap_or_default());
    if !crate::claude::listed_alive(sid) {
        return Err(crate::i18n::tr("세션이 꺼져서 못 보냈어요", "The session is gone").into());
    }
    let keys = match keys_if_same(&crate::claude::screen_of(sid)?, fp, choice) {
        Ok(k) => k,
        Err(e) => {
            let _ = crate::direct::append_row(&json!({ "ts": crate::direct::chrono_now(), "type": "cancel", "id": id }));
            return Err(e);
        }
    };
    let label = match choice {
        Choice::Allow => ask["yes"].clone(),
        Choice::Deny => ask["no"].clone(),
        Choice::Again => ask["options"][0].clone(),
    };
    let pick_word = match choice {
        Choice::Allow => "yes",
        Choice::Deny => "no",
        Choice::Again => "option",
    };
    crate::direct::append_row(&json!({ "ts": crate::direct::chrono_now(), "type": "answer", "id": id, "by": by, "pick": pick_word, "label": label }))?;
    if let Err(e) = crate::claude::press_keys(sid, &keys) {
        let _ = crate::direct::append_row(&json!({ "ts": crate::direct::chrono_now(), "type": "answer-failed", "id": id }));
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub async fn perm_card_open(id: String, cwd: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || open(&id, &cwd)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn perm_card_close(id: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || close(&id)).await.map_err(|e| e.to_string())?
}


/// 실측(ADR 0023) — 정책 흉내 세션(--settings 로 바이패스·auto 막음) 하나에 진짜로 붙어 본다. 평소엔 안 돈다:
/// CHAMMO_HOME=<시험 폴더> LIVE_PERM_SID=<세션 짧은 id> LIVE_PERM_CWD=<폴더> cargo test --bin honor-orchestrator perm_card_cmd::live -- --ignored --exact perm_card_cmd::live::한_바퀴
/// 세션은 `date > live1.txt` 다음 `date > live2.txt` 를 하도록 띄운다 — 첫 창은 허용, 둘째 창은 거절
#[cfg(test)]
mod live {
    use super::*;

    fn wait_dialog(sid: &str, not_fp: Option<&str>) -> crate::perm_card::PermDialog {
        for _ in 0..60 {
            if let Some(d) = crate::claude::screen_of(sid).ok().as_deref().and_then(perm_dialog).filter(|d| Some(d.fp.as_str()) != not_fp) {
                return d;
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
        panic!("권한 창이 2분 안에 안 떴다");
    }

    fn ask_of(id: &str) -> Value {
        crate::direct::check(&crate::direct::direct_log(), id).expect("열린 카드")
    }

    #[test]
    #[ignore]
    fn 한_바퀴() {
        let sid = std::env::var("LIVE_PERM_SID").expect("LIVE_PERM_SID");
        let cwd = std::env::var("LIVE_PERM_CWD").expect("LIVE_PERM_CWD");
        assert!(std::env::var("CHAMMO_HOME").is_ok_and(|h| !h.contains(".honor-orchestrator")), "시험 데이터 폴더로만");
        let first = wait_dialog(&sid, None);
        eprintln!("첫 창: what={:?} options={:?} cursor={}", first.what, first.options, first.cursor);
        let id = open(&sid, &cwd).unwrap().expect("카드");
        assert_eq!(open(&sid, &cwd).unwrap().as_deref(), Some(id.as_str()), "같은 창이면 같은 카드");
        let ask = ask_of(&id);
        assert!(answer(&ask, &Pick::Text { text: "응".into() }, "desktop").is_err(), "글 답은 안 됨");
        assert!(answer(&ask, &Pick::Yes, "telegram:1").is_err(), "텔레그램은 안 됨");
        answer(&ask, &Pick::Yes, "desktop").expect("허용 누르기");
        let second = wait_dialog(&sid, Some(&first.fp));
        eprintln!("둘째 창: what={:?}", second.what);
        assert_eq!(close(&sid).unwrap(), 0, "답한 카드는 열린 게 아니다");
        let id2 = open(&sid, &cwd).unwrap().expect("둘째 카드");
        assert_ne!(id, id2);
        answer(&ask_of(&id2), &Pick::No, "phone").expect("거절 누르기");
        // 옛 카드에 다시 답해도 안 눌린다(이미 답함)
        assert!(crate::direct::answer(&id, &Pick::Yes, "desktop").is_err());
    }
}
