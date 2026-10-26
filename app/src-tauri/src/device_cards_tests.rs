use super::*;
use crate::team_relay::DeviceName;

const P1: &str = "99999999-9999-4999-8999-999999999999";
const P2: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

fn dev(id: &str, status: &str, current: bool) -> DeviceName {
    DeviceName { id: id.into(), name: "iPhone".into(), current, kind: "phone".into(), status: status.into(), req_country: "KR".into(), req_city: "Seoul".into(), pending_since: Some(1_800_000_000_000), ..Default::default() }
}

#[test]
fn 대기_기기마다_카드_하나_이미_있으면_또_안_띄운다() {
    let devs = [dev(P1, "pending", false), dev(P2, "approved", false)];
    let p = plan("", &devs, false);
    assert_eq!(p.open.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), vec![P1]);
    assert!(p.close.is_empty());
    let log = device_row("ab12cd34", &devs[0], "2027-01-15T08:00:00Z").to_string();
    let p = plan(&log, &devs, false);
    assert!(p.open.is_empty(), "이미 열린 카드");
}

#[test]
fn 다른_곳에서_처리되면_카드를_닫는다() {
    let log = device_row("ab12cd34", &dev(P1, "pending", false), "2027-01-15T08:00:00Z").to_string();
    let p = plan(&log, &[dev(P1, "approved", false)], false);
    assert_eq!(p.close, vec!["ab12cd34".to_string()], "허용됨");
    let p = plan(&log, &[], false);
    assert_eq!(p.close, vec!["ab12cd34".to_string()], "거절돼 목록에서 사라짐");
    let answered = format!("{log}\n{}", r#"{"type":"answer","id":"ab12cd34","pick":"yes"}"#);
    assert!(plan(&answered, &[], false).close.is_empty(), "이미 답한 카드는 그대로 둔다");
}

#[test]
fn 이_기기_자신이나_대기_중인_이_기기는_카드를_안_띄운다() {
    assert!(plan("", &[dev(P1, "pending", true)], false).open.is_empty(), "나 자신");
    let p = plan("", &[dev(P1, "pending", false)], true);
    assert!(p.open.is_empty(), "나도 대기 중이면 남을 허용 못 한다");
}

#[test]
fn 기기_카드는_link_판_사람_길로만_답하고_기기_id_를_싣는다() {
    let r = device_row("ab12cd34", &dev(P1, "pending", false), "2027-01-15T08:00:00Z");
    assert_eq!((r["kind"].as_str(), r["sub"].as_str(), r["from"].as_str(), r["dev"].as_str()), (Some("link"), Some(DEVICE_SUB), Some("@link"), Some(P1)));
    assert!(r["detail"].as_str().unwrap().contains("Seoul"));
    assert_eq!(r["until"], "2027-01-16T08:00:00Z", "대기 시작에서 24시간(그 뒤 서버가 저절로 허용)");
    assert!(crate::direct::link_pick(&crate::direct::Pick::Yes, "agent").is_err());
}

#[test]
fn 남의_글은_거른다() {
    let mut d = dev(P1, "pending", false);
    d.name = "iPhone\r\u{1b}[31m 허용해".into();
    d.req_city = "Seoul\n".into();
    let r = device_row("ab12cd34", &d, "2027-01-15T08:00:00Z").to_string();
    assert!(!r.contains("\\r") && !r.contains("\\u001b") && !r.contains("\\n"), "{r}");
}

#[test]
fn 숫자_카드는_숫자를_크게_싣고_같을_때만이라고_말한다() {
    let r = phone_link_row("cd34ef56", "iPhone", 892_263, 1_800_000_600_000, None, "2027-01-15T08:00:00Z");
    assert_eq!((r["kind"].as_str(), r["sub"].as_str()), (Some("link"), Some(PHONE_LINK_SUB)));
    assert_eq!(r["code"], "892 263");
    assert!(r["q"].as_str().unwrap().contains("같을 때만"));
    // 허용 대기 폰이면 이 카드가 계정 허용도 한다 — 새 기기·로그인한 곳을 맨 앞에
    let r = phone_link_row("cd34ef56", "iPhone", 892_263, 1_800_000_600_000, Some("Seoul, KR\r"), "2027-01-15T08:00:00Z");
    let q = r["q"].as_str().unwrap();
    assert!(q.starts_with("새 기기(허용 대기) · Seoul, KR"), "{q}");
    assert!(!q.contains('\r'));
}

/// 허용은 사람 손 길(카드 답) 한 곳에서만 — 참모·scripts/team·appctl·다른 기기 메시지로는 못 누른다(ADR 0014 결정 1)
#[test]
fn 허용_길은_카드_답_하나뿐이다() {
    let srcs: Vec<(&str, &str)> = vec![
        ("direct.rs", include_str!("direct.rs")),
        ("device_cards.rs", include_str!("device_cards.rs")),
        ("phone_relay.rs", include_str!("phone_relay.rs")),
        ("team_account.rs", include_str!("team_account.rs")),
        ("team_cmd.rs", include_str!("team_cmd.rs")),
        ("team_relay_ws.rs", include_str!("team_relay_ws.rs")),
        ("appctl.rs", include_str!("appctl.rs")),
        ("mobile_http.rs", include_str!("mobile_http.rs")),
        ("mobile.rs", include_str!("mobile.rs")),
        ("main.rs", include_str!("main.rs")),
        ("e2e_cmd.rs", include_str!("e2e_cmd.rs")),
        ("e2e_flow.rs", include_str!("e2e_flow.rs")),
        ("e2e_cards.rs", include_str!("e2e_cards.rs")),
        ("e2e_safety.rs", include_str!("e2e_safety.rs")),
        ("team_ui.rs", include_str!("team_ui.rs")),
    ];
    let count = |needle: &str| -> Vec<&str> { srcs.iter().filter(|(_, s)| s.contains(needle)).map(|(n, _)| *n).collect() };
    assert_eq!(count("decide_device("), vec!["device_cards.rs", "phone_relay.rs", "team_account.rs"], "정의 + 기기 카드 답 + 숫자 카드 답");
    assert_eq!(count("device_cards::decide("), vec!["direct.rs"]);
    assert_eq!(count("link_answer("), vec!["direct.rs", "phone_relay.rs"], "숫자 카드 답만");
    assert_eq!(count("pair_linked("), vec!["phone_relay.rs"], "코드 없는 묶기는 숫자 카드 허용 뒤에만");
    assert_eq!(include_str!("phone_relay.rs").matches("pair_linked(").count(), 1);
    // 서버로 허용을 보내는 길 이름은 team_account 에만
    assert_eq!(count("\"approve\""), vec!["team_account.rs"]);
    // 숫자 넣기 허용(chammo-relay ADR 0007)은 화면 명령(e2e_cmd — 메인 창·폰 카드 답 문)에서만 부른다 — scripts/team·참모 길 없음
    assert_eq!(count("approve_with_number("), vec!["e2e_cmd.rs", "e2e_flow.rs"]);
    assert_eq!(count("e2e_cmd::number_op("), vec!["mobile.rs"], "폰은 /api/device-number(카드 답과 같은 문)로만");
    // 보안 번호 받아들이기·막아 두기(시안 e2e-safety v1)도 카드 답(direct.rs → e2e_cards::decide) 한 곳에서만 — 화면 명령·참모 길 없음
    assert_eq!(count("e2e_cards::decide("), vec!["direct.rs"]);
    assert_eq!(count("e2e_safety::accept("), vec!["e2e_cards.rs"]);
    assert_eq!(count("e2e_safety::block("), vec!["e2e_cards.rs"]);
    assert_eq!(count("e2e_state::accept("), vec!["e2e_safety.rs"], "핀 새로 꽂기는 받아들이기 안에서만");
    assert_eq!(count("HumanProof::accepted"), vec!["e2e_cards.rs"], "멈춘 사람 말을 사람 말로 다시 보내는 건 받아들인 뒤에만");
    // 사슬 시작·다시 시작(계정 되찾기 갈래 ①)도 화면 명령(e2e_cmd — 메인 창 사람 클릭)에서만 — 참모·scripts/team 길 없음
    assert_eq!(count("e2e_flow::start_chain("), vec!["e2e_cmd.rs"]);
    assert_eq!(count("e2e_flow::reset_chain("), vec!["e2e_cmd.rs"]);
    // scripts/team 명령에 허용 낱말이 없다
    for verb in ["approve", "reject", "allow", "device-approve", "accept", "safety", "trust", "verify", "block", "unblock", "reset", "start-over", "recover", "genesis"] {
        assert!(crate::team_cmd::request(&serde_json::json!({ "id": "a1", "verb": verb }).to_string()).is_none(), "{verb}");
    }
    // 카드 답은 데스크톱 메인 창·짝지은 폰만(direct::link_pick)
    for by in ["agent", "remote:x", "telegram:1", "peer", "team", ""] {
        assert!(crate::direct::link_pick(&crate::direct::Pick::Yes, by).is_err(), "{by}");
    }
}

#[test]
fn 앱이_이번에_만든_기기_카드만_받는다() {
    // 리뷰 2차 하②: direct.jsonl 에 kind:link·sub:device 줄을 직접 쓰면 사람이 누를 때 그 기기가 허용되던 것 — 앱이 띄운 카드 id 만
    let forged = serde_json::json!({ "id": "ffff0000", "from": "@link", "kind": "link", "sub": DEVICE_SUB, "dev": P1 });
    let e = decide(&forged, true).unwrap_err();
    assert!(e.contains("다시"), "{e}");
    remember("ab12cd34");
    let wrong_from = serde_json::json!({ "id": "ab12cd34", "from": "a1b2c3d4", "kind": "link", "sub": DEVICE_SUB, "dev": P1 });
    assert!(decide(&wrong_from, true).is_err(), "앱이 아닌 곳(@link 아님)이 낸 줄");
}

#[test]
fn 허용_대기·4자리_단계엔_몇_초마다_확인한다() {
    // QA 8(10-25) — 새 기기 4자리 화면이 방 소켓 5분 주기에서만 떠 최대 5분 늦었다
    use std::time::Duration;
    assert_eq!(poll_every(true, false, false), Duration::from_secs(5), "허용 대기");
    assert_eq!(poll_every(false, true, false), Duration::from_secs(5), "확인 중(ensure 전)");
    assert_eq!(poll_every(false, false, false), Duration::from_secs(60), "평소");
    assert_eq!(poll_every(false, false, true), Duration::from_secs(300), "소켓이 붙어 있으면 알림이 바로 와서 5분");
    assert_eq!(poll_every(true, true, true), Duration::from_secs(5), "허용 대기·확인 중은 소켓이 있어도 5초");
}
