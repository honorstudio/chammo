//! 종단 암호 허용 화면 명령(chammo-relay ADR 0007, 시안 docs/design-drafts/e2e-approve v1) — 다 메인 창 전용.
//! 카드 열기·숫자 넣어 허용은 사람 손 길: 프런트는 진짜(isTrusted) 클릭·입력에서만 부른다. scripts/team·참모 길엔 없다
use crate::team_relay::{self as relay, bg_job, human_job, Curl};

fn main_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if w.label() == "main" { Ok(()) } else { Err("main window only".into()) }
}

/// 메인 창·메신저 따로 창(team-*) — 팀 설정·대화 칸이 뜨는 우리 창(사람 화면)
fn ui_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if crate::team_ui::ui_window(w.label()) { Ok(()) } else { Err("messenger windows only".into()) }
}

/// 허용 카드 갈래 — number(이 기기가 사슬에 있고 새 기기가 봉인을 올림) / wait(이 기기가 사슬에 있는데 새 컴퓨터가 아직 봉인 전 — 숫자를 기다린다)
/// / outside(계정에 사슬이 있는데 이 기기는 밖 — 허용·거절을 못 한다, 안내만) / click(사슬 전 계정이거나 받는 열쇠 없는 폰 — 예전처럼 누르기).
/// 열쇠 있는 기기엔 누르기 갈래가 없다 — 서버도 link_required 로 막는다(10-25 QA)
pub fn card_mode(dir: &std::path::Path, dev: &str) -> &'static str {
    let st = relay::load_state(dir);
    let acc = st.account.as_ref().map(|a| a.id.clone()).unwrap_or_default();
    let mine = crate::e2e_team::in_chain(dir, &st);
    if !mine && crate::e2e_state::load(dir).chains.get(&acc).is_some_and(|l| !l.is_empty()) {
        return "outside";
    }
    let row = st.my_devices.iter().find(|d| d.id == dev);
    let ready = row.is_some_and(|d| !d.e2e_pub.is_empty() && !d.approve_commit.is_empty());
    let keyless_phone = row.is_some_and(|d| d.kind == "phone" && d.e2e_pub.is_empty());
    match (mine, ready, keyless_phone) {
        (true, true, _) => "number",
        (true, false, false) => "wait",
        _ => "click",
    }
}

/// 허용 카드 열기 응답 — {mode, code?, mine?}. 데스크톱 명령(e2e_card_open)·폰(/api/device-number open)이 같은 모양을 낸다(계약: src/domain/e2eCardOpen.contract.json)
pub fn card_open_json(dir: &std::path::Path, dev: &str) -> Result<serde_json::Value, String> {
    number_op(dir, dev, "open", "")
}

/// 숫자 갈래 응답 — 이 기기가 지금 봉인에 낸 난수를 쥐고 있으면 mine(카드를 다시 그려도 숫자 기다림을 이어 간다). 상태 파일만
fn number_json(dir: &std::path::Path, dev: &str) -> serde_json::Value {
    let commit = relay::load_state(dir).my_devices.into_iter().find(|d| d.id == dev).map(|d| d.approve_commit).unwrap_or_default();
    let s = crate::e2e_state::load(dir);
    let mine = !commit.is_empty() && s.card_nm.contains_key(dev) && s.card_seen.get(dev).is_some_and(|c| c.commit == commit);
    if mine { serde_json::json!({ "mode": "number", "mine": true }) } else { serde_json::json!({ "mode": "number" }) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 사슬이_있는_계정의_사슬_밖_기기는_outside_사슬_전_계정은_click() {
        let d = std::env::temp_dir().join(format!("chammo-cardmode-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        relay::mutate(&d, |s| {
            s.device_id = "d7".into();
            s.account = Some(relay::Account { id: "a1".into(), ..Default::default() });
        })
        .unwrap();
        assert_eq!(card_mode(&d, "d8"), "click", "사슬 전 계정 — 예전처럼");
        // 다른 기기가 시작한 사슬(이 기기는 밖)
        let k = crate::team_relay_keys::DeviceKeys::from_seeds([3; 32], [4; 32]);
        let body = serde_json::json!({ "v": 1, "account": "a1", "seq": 0, "prev": "", "by": "d1", "kind": "genesis", "device": "d1", "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
        crate::e2e_state::seed_trusted(&d, "a1", vec![crate::e2e_chain::Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{body}")), body }]);
        assert_eq!(card_mode(&d, "d8"), "outside");
    }

    /// Rust·TS 계약 — 화면이 받는 JSON 모양을 같은 파일로 묶는다(10-25 QA: 데스크톱 명령만 글자를 돌려줘 TS 의 m.mode 가 undefined → 늘 누르기 화면)
    #[test]
    fn 카드_열기_응답은_계약_파일_모양_그대로() {
        let contract: serde_json::Value = serde_json::from_str(include_str!("../../src/domain/e2eCardOpen.contract.json")).unwrap();
        let d = std::env::temp_dir().join(format!("chammo-cardopen-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let dev = "4d4d4d4d-0000-4000-8000-000000000002";
        assert_eq!(card_open_json(&d, dev).unwrap(), contract["click"], "사슬 전 계정 — 누르기");
        show_code(dev, "0420");
        assert_eq!(card_open_json(&d, dev).unwrap(), contract["code"], "허용하고 4자리를 띄운 카드");
        forget_code(dev);
    }

    #[test]
    fn 열쇠_있는_컴퓨터_카드엔_누르기_갈래가_없다() {
        // 10-25 QA — 사슬이 있는 계정에서 새 컴퓨터가 아직 봉인을 안 올렸으면 '누르기'가 떴고, 누르면 서버가 link_required 로 막았다
        let d = std::env::temp_dir().join(format!("chammo-cardmode2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let k = crate::team_relay_keys::DeviceKeys::from_seeds([3; 32], [4; 32]);
        relay::mutate(&d, |s| {
            s.device_id = "d7".into();
            s.account = Some(relay::Account { id: "a1".into(), ..Default::default() });
            s.my_devices = vec![
                relay::DeviceName { id: "mac2".into(), kind: "mac".into(), status: "pending".into(), e2e_pub: "E".into(), ..Default::default() },
                relay::DeviceName { id: "phone1".into(), kind: "phone".into(), status: "pending".into(), ..Default::default() },
            ];
        })
        .unwrap();
        let body = serde_json::json!({ "v": 1, "account": "a1", "seq": 0, "prev": "", "by": "d7", "kind": "genesis", "device": "d7", "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
        crate::e2e_state::seed_trusted(&d, "a1", vec![crate::e2e_chain::Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{body}")), body }]);
        assert_eq!(card_mode(&d, "mac2"), "wait", "봉인 전 컴퓨터 — 숫자를 기다린다(누르기 아님)");
        assert_eq!(card_mode(&d, "phone1"), "click", "받는 열쇠 없는 폰만 누르기(서버 예외와 같은 선)");
        relay::mutate(&d, |s| s.my_devices[0].approve_commit = "C".into()).unwrap();
        assert_eq!(card_mode(&d, "mac2"), "number");
    }

    /// 숫자 칸을 켜 둔 기기(사슬 기기 d7, 봉인 올린 새 기기 mac2)
    fn number_dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-cardclaim-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let k = crate::team_relay_keys::DeviceKeys::from_seeds([3; 32], [4; 32]);
        relay::mutate(&d, |s| {
            s.device_id = "d7".into();
            s.account = Some(relay::Account { id: "a1".into(), ..Default::default() });
            s.my_devices = vec![relay::DeviceName { id: "mac2".into(), kind: "mac".into(), status: "pending".into(), e2e_pub: "E".into(), approve_commit: "C".into(), ..Default::default() }];
        })
        .unwrap();
        let body = serde_json::json!({ "v": 1, "account": "a1", "seq": 0, "prev": "", "by": "d7", "kind": "genesis", "device": "d7", "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
        crate::e2e_state::seed_trusted(&d, "a1", vec![crate::e2e_chain::Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{body}")), body }]);
        d
    }

    #[test]
    fn 카드_열기는_망을_안_쓰고_난수는_사람이_칸을_누를_때만() {
        // 10-27 사용자 — 무인 아이맥 채팅 뷰가 카드를 그리자마자 난수를 내 자리를 잡아, 맥북 종 카드는 busy 를 삼키고 '기다려요'에 갇혔다
        let d = number_dir("open");
        let contract: serde_json::Value = serde_json::from_str(include_str!("../../src/domain/e2eCardOpen.contract.json")).unwrap();
        assert_eq!(card_open_json(&d, "mac2").unwrap(), contract["number"], "그리기(open)는 상태 파일만 — 중계에 난수를 안 낸다");
        assert!(crate::e2e_state::load(&d).card_nm.is_empty());
    }

    #[test]
    fn 이_기기가_이미_낸_난수가_지금_봉인_것이면_mine() {
        let d = number_dir("mine");
        let contract: serde_json::Value = serde_json::from_str(include_str!("../../src/domain/e2eCardOpen.contract.json")).unwrap();
        crate::e2e_state::mutate(&d, |s| {
            s.card_nm.insert("mac2".into(), "N".into());
            s.card_seen.insert("mac2".into(), crate::e2e_state::CardSeen { commit: "C".into(), head: "H".into(), ..Default::default() });
        })
        .unwrap();
        assert_eq!(card_open_json(&d, "mac2").unwrap(), contract["number_mine"], "다시 그려도 이 기기가 쥔 카드 — 숫자 기다림을 이어 간다");
        // 새 기기가 '숫자 다시'로 봉인을 바꿨으면 다시 눌러야
        relay::mutate(&d, |s| s.my_devices[0].approve_commit = "C2".into()).unwrap();
        assert_eq!(card_open_json(&d, "mac2").unwrap(), contract["number"]);
    }

    #[test]
    fn 숫자_갈래가_아니면_claim_은_망_없이_갈래만() {
        let d = number_dir("claimwait");
        relay::mutate(&d, |s| s.my_devices[0].approve_commit.clear()).unwrap();
        assert_eq!(number_op(&d, "mac2", "claim", "").unwrap(), serde_json::json!({ "mode": "wait" }));
    }

    #[test]
    fn 허용하고_띄운_4자리는_10분만_기억하고_닫으면_잊는다() {
        let dev = "4d4d4d4d-0000-4000-8000-000000000001";
        assert_eq!(shown_code(dev), None);
        show_code(dev, "0420");
        assert_eq!(shown_code(dev).as_deref(), Some("0420"));
        assert!(code_alive(dev));
        forget_code(dev);
        assert!(!code_alive(dev));
        // 오래된 것은 없는 것
        SHOWN.lock().unwrap().insert(dev.into(), ("0420".into(), std::time::Instant::now() - CODE_TTL - std::time::Duration::from_secs(1)));
        assert_eq!(shown_code(dev), None);
    }
}

/// 허용한 뒤 화면에 띄운 4자리(R7 A) — 새 기기에 넣을 때까지 카드를 열어 둔다(대기가 끝나도 카드가 안 닫히게). 메모리에만, 10분
static SHOWN: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, (String, std::time::Instant)>>> = std::sync::LazyLock::new(Default::default);
const CODE_TTL: std::time::Duration = std::time::Duration::from_secs(600);

fn show_code(dev: &str, code: &str) {
    SHOWN.lock().unwrap_or_else(|e| e.into_inner()).insert(dev.into(), (code.into(), std::time::Instant::now()));
}
fn shown_code(dev: &str) -> Option<String> {
    let mut m = SHOWN.lock().unwrap_or_else(|e| e.into_inner());
    m.retain(|_, (_, at)| at.elapsed() < CODE_TTL);
    m.get(dev).map(|(c, _)| c.clone())
}
/// 그 기기 카드에 4자리가 떠 있나 — device_cards 가 카드를 닫지 않는다
pub fn code_alive(dev: &str) -> bool {
    shown_code(dev).is_some()
}
fn forget_code(dev: &str) {
    SHOWN.lock().unwrap_or_else(|e| e.into_inner()).remove(dev);
}

/// 허용 기기 쪽 한 걸음(데스크톱 명령·폰 /api/device-number 가 같이 쓴다) — open → {mode, code?, mine?}(상태 파일만, 그리기마다 불러도 된다)
/// / claim → open 과 같은 모양(사람이 숫자 칸을 눌렀다 — 이때만 이 기기가 nM 을 낸다) / ready → {ready} / enter → {ok, code}
/// / close → 4자리 카드 닫기 / cut → 허용한 그 기기를 끊기(4자리 카드의 '거절' — 허용 뒤엔 서버 거절 길이 없다)
pub fn number_op(dir: &std::path::Path, dev: &str, op: &str, digits: &str) -> Result<serde_json::Value, String> {
    let kc = crate::team_relay_keys::store();
    match op {
        "open" if code_alive(dev) => Ok(serde_json::json!({ "mode": "code", "code": shown_code(dev) })),
        // 그리기만으로는 nM 을 안 낸다 — 무인 기기(아이맥 채팅 뷰)가 카드를 그리자마자 자리를 잡아 사람이 앉은 기기가 busy 에 갇혔다(10-27)
        "open" => Ok(match card_mode(dir, dev) {
            "number" => number_json(dir, dev),
            mode => serde_json::json!({ "mode": mode }),
        }),
        "claim" if code_alive(dev) => Ok(serde_json::json!({ "mode": "code", "code": shown_code(dev) })),
        "claim" => match card_mode(dir, dev) {
            "number" => {
                crate::e2e_flow::card_open(dir, &kc, &Curl, dev)?;
                Ok(number_json(dir, dev))
            }
            mode => Ok(serde_json::json!({ "mode": mode })),
        },
        "ready" => crate::e2e_flow::card_number(dir, &kc, &Curl, dev).map(|n| serde_json::json!({ "ready": n.is_some() })),
        "enter" => {
            // code = 새 기기에 넣을 4자리(R7) — 이 화면에만 띄운다
            let code = crate::e2e_flow::approve_with_number(dir, &kc, &Curl, dev, digits)?;
            show_code(dev, &code);
            let _ = crate::team_account::refresh_me(dir, &kc, &Curl);
            crate::device_cards::nudge();
            Ok(serde_json::json!({ "ok": true, "code": code }))
        }
        "close" => {
            forget_code(dev);
            crate::device_cards::nudge();
            Ok(serde_json::json!({ "ok": true }))
        }
        "cut" => {
            crate::team_account::revoke_device(dir, &kc, &Curl, dev)?;
            forget_code(dev);
            crate::device_cards::nudge();
            Ok(serde_json::json!({ "ok": true }))
        }
        _ => Err("bad op".into()),
    }
}

/// 새 기기 쪽 — 다른 기기에서 카드를 열었으면 6자리, 아직이면 None
#[tauri::command]
pub async fn e2e_self_number(window: tauri::WebviewWindow) -> Result<Option<u32>, String> {
    main_only(&window)?;
    bg_job(|d, _, _| crate::e2e_flow::my_number(d, &crate::team_relay_keys::store(), &Curl)).await
}

/// 새 기기 쪽 '숫자 다시'
#[tauri::command]
pub async fn e2e_renew(window: tauri::WebviewWindow) -> Result<(), String> {
    main_only(&window)?;
    human_job(|d, _, _| crate::e2e_flow::renew(d, &crate::team_relay_keys::store(), &Curl)).await
}

/// 허용 기기 쪽 — 카드를 그렸다. 갈래만 본다(망 안 씀) — nM 은 e2e_card_claim
#[tauri::command]
pub async fn e2e_card_open(window: tauri::WebviewWindow, dev: String) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    bg_job(move |d, _, _| card_open_json(d, &dev)).await
}

/// 허용 기기 쪽 — 사람이 숫자 칸을 눌렀다(진짜 클릭·키에서만). 이 기기가 nM 을 낸다 — 다른 기기가 먼저면 그 이유를 Err 로
#[tauri::command]
pub async fn e2e_card_claim(window: tauri::WebviewWindow, dev: String) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    human_job(move |d, _, _| number_op(d, &dev, "claim", "")).await
}

/// 허용 기기 쪽 — 새 기기 화면에 숫자가 떴으면 Some(이 기기만 셈한다 — 화면엔 안 보이고 넣은 값과 견주기만)
#[tauri::command]
pub async fn e2e_card_ready(window: tauri::WebviewWindow, dev: String) -> Result<bool, String> {
    main_only(&window)?;
    bg_job(move |d, _, _| number_op(d, &dev, "ready", "").map(|v| v["ready"] == true)).await
}

/// 허용 기기 쪽 — 사람이 넣은 6자리로 허용. 새 기기에 넣을 4자리를 돌려준다(R7)
#[tauri::command]
pub async fn e2e_card_approve(window: tauri::WebviewWindow, dev: String, digits: String) -> Result<String, String> {
    main_only(&window)?;
    human_job(move |d, _, _| number_op(d, &dev, "enter", &digits).map(|v| v["code"].as_str().unwrap_or("").to_string())).await
}

/// 허용 기기 쪽 — 4자리 카드 닫기(close)·끊기(cut). 사람 클릭에서만
#[tauri::command]
pub async fn e2e_card_op(window: tauri::WebviewWindow, dev: String, op: String) -> Result<(), String> {
    main_only(&window)?;
    if !matches!(op.as_str(), "close" | "cut") {
        return Err("bad op".into());
    }
    human_job(move |d, _, _| number_op(d, &dev, &op, "").map(|_| ())).await
}

/// 보안 번호 — 팀 사람들 상태·번호·열린 카드(멤버 화면·대화 '확인'). 받아들이기·막아 두기는 여기 없다(카드 답 direct_answer 로만)
#[tauri::command]
pub async fn e2e_safety_people(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    bg_job(|d, _, _| Ok(crate::e2e_safety::view(d))).await
}

/// 멤버 화면 '같아요' — 번호를 견줬다(핀이 ok 인 사람만 확인됨 표시). 사람 클릭에서만
#[tauri::command]
pub async fn e2e_safety_verify(window: tauri::WebviewWindow, account: String) -> Result<(), String> {
    ui_only(&window)?;
    human_job(move |d, _, _| {
        let me = crate::team_relay::load_state(d).account.map(|a| a.id).ok_or("로그인 전이야")?;
        crate::e2e_safety::verify(d, &me, &account)
    })
    .await
}

/// 갈린 사람 '다시 받기' — 서버에서 그 사람 사슬을 새로 받아 적고, 그 사슬로 셈한 번호로 카드를 다시 띄운다(6차 리뷰: 갈림은 다시 받은 뒤에만 받아들이기)
#[tauri::command]
pub async fn e2e_safety_refetch(window: tauri::WebviewWindow, account: String) -> Result<(), String> {
    ui_only(&window)?;
    human_job(move |d, _, _| {
        let st = crate::team_relay::load_state(d);
        crate::e2e_state::chain_of(d, &crate::team_relay_keys::store(), &Curl, &st, &account, true)?;
        crate::e2e_safety::mark_refetched(d, &account)?;
        crate::e2e_cards::sync(d);
        Ok(())
    })
    .await
}

/// 대화 회색 줄 '번호 비교'에서 막아 두기 — 저절로 받아들인 사람만, 메신저 화면 사람 클릭에서만
#[tauri::command]
pub async fn e2e_safety_block(window: tauri::WebviewWindow, account: String) -> Result<(), String> {
    ui_only(&window)?;
    human_job(move |d, _, _| crate::e2e_safety::block_rekeyed(d, &account)).await
}

/// 멤버 화면 '카드 다시 띄우기' — 막아 둔 사람의 카드를 결정 대기함에 다시
#[tauri::command]
pub async fn e2e_safety_unblock(window: tauri::WebviewWindow, account: String) -> Result<(), String> {
    ui_only(&window)?;
    human_job(move |d, _, _| {
        crate::e2e_safety::unblock(d, &account)?;
        crate::e2e_cards::sync(d);
        Ok(())
    })
    .await
}

/// 사람이 '이 기기가 첫 기기'를 눌렀다 — 계정 사슬 시작(R8). 메인 창 사람 클릭에서만
#[tauri::command]
pub async fn e2e_start_chain(window: tauri::WebviewWindow) -> Result<(), String> {
    main_only(&window)?;
    human_job(|d, _, _| crate::e2e_flow::start_chain(d, &crate::team_relay_keys::store(), &Curl)).await
}

/// 사람이 '이 기기로 다시 시작'을 눌렀다 — 허용해 줄 사슬 기기가 하나도 없을 때(계정 되찾기 갈래 ①). 메인 창 사람 클릭에서만
#[tauri::command]
pub async fn e2e_reset_chain(window: tauri::WebviewWindow) -> Result<(), String> {
    main_only(&window)?;
    human_job(|d, _, _| crate::e2e_flow::reset_chain(d, &crate::team_relay_keys::store(), &Curl)).await
}

/// 계정 되찾기 갈래 ②(relay ADR 0007 R9) — 새 기기 화면의 8자리 요청 코드. 메인 창 사람 클릭에서만
#[tauri::command]
pub async fn e2e_recover_code(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    human_job(|d, _, _| crate::e2e_flow::recover_code(d, &crate::team_relay_keys::store(), &Curl).map(|(code, until)| serde_json::json!({ "code": code, "expiresAt": until }))).await
}

/// 기다리는 다시 시작 요청 취소(이 기기 화면에서). 메인 창 사람 클릭에서만 — 내 다른 기기는 결정 대기함 카드로
#[tauri::command]
pub async fn e2e_recover_cancel(window: tauri::WebviewWindow) -> Result<(), String> {
    main_only(&window)?;
    human_job(|d, _, _| crate::e2e_flow::recover_cancel(d, &crate::team_relay_keys::store(), &Curl)).await
}

/// 48시간이 찼다 — '다시 시작 마치기'. 메인 창 사람 클릭에서만
#[tauri::command]
pub async fn e2e_recover_finish(window: tauri::WebviewWindow) -> Result<(), String> {
    main_only(&window)?;
    human_job(|d, _, _| crate::e2e_flow::recover_finish(d, &crate::team_relay_keys::store(), &Curl)).await
}

/// 되찾기 페이지를 시스템 브라우저로 — 이 기기 중계 주소의 /recover 만(코드는 주소에 싣지 않는다, 사람이 손으로 옮긴다)
#[tauri::command]
pub async fn e2e_recover_open(window: tauri::WebviewWindow) -> Result<(), String> {
    main_only(&window)?;
    human_job(|d, _, _| {
        let server = crate::team_relay::load_state(d).server;
        if !server.starts_with("https://") && !cfg!(debug_assertions) {
            return Err("중계 주소가 https 가 아니에요".into());
        }
        crate::team_account::Opener::open(&crate::team_account::SystemBrowser, &format!("{}/recover", server.trim_end_matches('/')))
    })
    .await
}

/// 이 기기가 낸 다시 시작 요청(기다림 화면의 남은 시간) — 망 없이 상태 파일만
#[tauri::command]
pub async fn e2e_recover_state(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    bg_job(|d, _, _| Ok(serde_json::to_value(crate::team_relay::load_state(d).recover.filter(|r| r.mine)).unwrap_or_default())).await
}

/// 로그인 화면 단계 — start / reset / need / failed / ""
#[tauri::command]
pub async fn e2e_self_step(window: tauri::WebviewWindow) -> Result<String, String> {
    main_only(&window)?;
    bg_job(|d, _, _| Ok(crate::e2e_flow::self_step(d).to_string())).await
}

/// 새 기기 쪽 — 다른 기기에 뜬 4자리를 넣는다(R7). 틀리면 그 흐름은 끝
#[tauri::command]
pub async fn e2e_self_code(window: tauri::WebviewWindow, code: String) -> Result<(), String> {
    main_only(&window)?;
    human_job(move |d, _, _| crate::e2e_flow::confirm_code(d, &crate::team_relay_keys::store(), &Curl, &code)).await
}
