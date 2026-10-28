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
    let p = plan("", &devs, false, false);
    assert_eq!(p.open.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), vec![P1]);
    assert!(p.close.is_empty());
    let log = device_row("ab12cd34", &devs[0], "2027-01-15T08:00:00Z").to_string();
    let p = plan(&log, &devs, false, false);
    assert!(p.open.is_empty(), "이미 열린 카드");
}

#[test]
fn 다른_곳에서_처리되면_카드를_닫는다() {
    let log = device_row("ab12cd34", &dev(P1, "pending", false), "2027-01-15T08:00:00Z").to_string();
    let p = plan(&log, &[dev(P1, "approved", false)], false, false);
    assert_eq!(p.close, vec!["ab12cd34".to_string()], "허용됨");
    let p = plan(&log, &[], false, false);
    assert_eq!(p.close, vec!["ab12cd34".to_string()], "거절돼 목록에서 사라짐");
    let answered = format!("{log}\n{}", r#"{"type":"answer","id":"ab12cd34","pick":"yes"}"#);
    assert!(plan(&answered, &[], false, false).close.is_empty(), "이미 답한 카드는 그대로 둔다");
}

#[test]
fn 이_기기_자신이나_대기_중인_이_기기는_카드를_안_띄운다() {
    assert!(plan("", &[dev(P1, "pending", true)], false, false).open.is_empty(), "나 자신");
    let p = plan("", &[dev(P1, "pending", false)], true, false);
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
    // 저절로 받아들인 사람 막아 두기는 화면 명령(번호 비교 안)에서만
    assert_eq!(count("e2e_safety::block_rekeyed("), vec!["e2e_cmd.rs"]);
    assert_eq!(count("e2e_state::accept("), vec!["e2e_safety.rs"], "핀 새로 꽂기는 받아들이기 안에서만");
    assert_eq!(count("HumanProof::accepted"), vec!["e2e_cards.rs"], "멈춘 사람 말을 사람 말로 다시 보내는 건 받아들인 뒤에만");
    // 사슬 시작·다시 시작(계정 되찾기 갈래 ①)도 화면 명령(e2e_cmd — 메인 창 사람 클릭)에서만 — 참모·scripts/team 길 없음
    assert_eq!(count("e2e_flow::start_chain("), vec!["e2e_cmd.rs"]);
    assert_eq!(count("e2e_flow::reset_chain("), vec!["e2e_cmd.rs"]);
    // 계정 되찾기 갈래 ②(relay ADR 0007 R9) — 코드 받기·마치기는 화면 명령에서만, 취소는 화면 명령과 기기 카드 답(사람 길)에서만
    assert_eq!(count("e2e_flow::recover_code("), vec!["e2e_cmd.rs"]);
    assert_eq!(count("e2e_flow::recover_finish("), vec!["e2e_cmd.rs"]);
    assert_eq!(count("e2e_flow::recover_cancel("), vec!["device_cards.rs", "e2e_cmd.rs"]);
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
    let _ports = crate::test_ports::lock(); // 기기 카드 당김(NUDGE)은 전역 — 소켓 시험과 겹치지 않게
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

fn outsider(id: &str) -> DeviceName {
    DeviceName { id: id.into(), name: "윈도우".into(), kind: "win".into(), status: "approved".into(), approved_by: "auto".into(), e2e_pub: "E".into(), approve_commit: "C".into(), in_chain: false, ..Default::default() }
}

#[test]
fn 사슬_밖_허용_컴퓨터도_사슬_기기에_내_기기_확인_카드가_뜬다() {
    // 10-26 '어디서든 허용' — 카드가 대기 기기에만 떠서 auto 허용·사슬 밖 기기는 사슬에 들 길이 없었다
    let devs = [outsider(P1)];
    assert_eq!(plan("", &devs, false, true).open.len(), 1, "사슬에 든 이 기기에");
    assert!(plan("", &devs, false, false).open.is_empty(), "사슬 밖인 이 기기는 확인을 못 해 안 띄운다");
    let mut no_commit = outsider(P1);
    no_commit.approve_commit.clear();
    assert!(plan("", &[no_commit], false, true).open.is_empty(), "봉인을 안 올린 기기(옛 앱)는 숫자를 못 띄운다");
    let mut keyless = outsider(P1);
    keyless.e2e_pub.clear();
    assert!(plan("", &[keyless], false, true).open.is_empty(), "받는 열쇠 없는 폰은 사슬 기기가 아니다");
    let mut inside = outsider(P1);
    inside.in_chain = true;
    let log = device_row("ab12cd34", &devs[0], "2027-01-15T08:00:00Z").to_string();
    assert_eq!(plan(&log, &[inside], false, true).close, vec!["ab12cd34".to_string()], "사슬에 들면 닫는다");
    assert!(plan(&log, &devs, false, true).close.is_empty());
}

#[test]
fn 내_기기_확인_카드는_새_기기_문구가_아니고_기한이_없다() {
    let r = device_row("ab12cd34", &outsider(P1), "2027-01-15T08:00:00Z");
    assert!(r["q"].as_str().unwrap().contains("확인"), "{}", r["q"]);
    assert!(!r["q"].as_str().unwrap().contains("로그인했어요"));
    assert!(r.get("until").is_none() || r["until"] == "", "24시간 자동 허용 기한이 없다: {}", r["until"]);
    assert_eq!(r["no"], "빼기");
}

fn rec(mine: bool) -> crate::team_relay::Recover {
    crate::team_relay::Recover { ready_at: 1_800_000_000_000 + 47 * 3_600_000, mine, device: "client-d".into(), device_name: "새 맥<script>".into(), place: "Seoul, KR".into() }
}

#[test]
fn 다시_시작_요청은_사람이_허용한_내_다른_기기에만_카드_하나() {
    let (open, close) = recover_plan("", Some(&rec(false)), true);
    assert_eq!(open.unwrap().device, "client-d");
    assert!(close.is_empty());
    // 내가 낸 요청·취소 권한 없는 기기(대기·24시간 auto)엔 안 띄운다
    assert!(recover_plan("", Some(&rec(true)), true).0.is_none());
    assert!(recover_plan("", Some(&rec(false)), false).0.is_none());
    let log = recover_row("ab12cd34", &rec(false), 1_800_000_000_000, "2027-01-15T08:00:00Z").to_string();
    assert!(recover_plan(&log, Some(&rec(false)), true).0.is_none(), "이미 열린 카드");
    // 요청이 끝나면(취소·마침) 닫는다
    assert_eq!(recover_plan(&log, None, true).1, vec!["ab12cd34".to_string()]);
}

#[test]
fn 다시_시작_카드는_남의_이름을_거르고_남은_시간과_취소를_말한다() {
    let r = recover_row("ab12cd34", &rec(false), 1_800_000_000_000, "2027-01-15T08:00:00Z");
    assert_eq!(r["sub"], RECOVER_SUB);
    assert_eq!(r["kind"], crate::direct::LINK_KIND);
    assert!(!r["q"].as_str().unwrap().contains('<'), "{}", r["q"]);
    assert!(r["detail"].as_str().unwrap().contains("47"), "{}", r["detail"]);
    assert!(r["yes"].as_str().unwrap().contains("취소") || r["yes"].as_str().unwrap().contains("cancel"));
}


#[test]
fn 다시_켜도_목록과_같은_카드는_새로_안_띄우고_이어_쓴다() {
    // 10-28 맥 — 앱을 다시 켜면 열린 카드를 닫고 새 id 로 다시 띄워 알림이 또 가고, 옛 id 를 쥔 폰·다른 화면은 '지난 카드'만 받았다
    let d = dev(P1, "pending", false);
    let log = device_row("ab12cd34", &d, "2027-01-15T08:00:00Z").to_string();
    assert_eq!(carry_over(&log, std::slice::from_ref(&d), false, false), vec!["ab12cd34".to_string()]);
    let o = outsider(P2);
    let log2 = device_row("cd34ef56", &o, "2027-01-15T08:00:00Z").to_string();
    assert_eq!(carry_over(&log2, std::slice::from_ref(&o), false, true), vec!["cd34ef56".to_string()], "내 기기 확인 카드도");
}

#[test]
fn 글이_다르거나_대기가_끝난_카드는_이어_쓰지_않는다() {
    let d = dev(P1, "pending", false);
    let mut row = device_row("ab12cd34", &d, "2027-01-15T08:00:00Z");
    row["q"] = serde_json::json!("새 기기가 로그인했어요 — 맥 회사 맥북, 허용할까요?");
    assert!(carry_over(&row.to_string(), std::slice::from_ref(&d), false, false).is_empty(), "누가 고쳐 쓴 줄은 닫고 새로");
    let log = device_row("ab12cd34", &d, "2027-01-15T08:00:00Z").to_string();
    assert!(carry_over(&log, &[dev(P1, "approved", false)], false, false).is_empty(), "그새 다른 기기가 허용");
    assert!(carry_over(&log, std::slice::from_ref(&d), true, false).is_empty(), "이 기기가 대기 중이면 카드 없음");
    let answered = format!("{log}\n{}", r#"{"type":"done","id":"ab12cd34"}"#);
    assert!(carry_over(&answered, std::slice::from_ref(&d), false, false).is_empty(), "닫힌 카드");
}

#[test]
fn 지난_카드를_누르면_다음_바퀴를_당긴다() {
    let _ports = crate::test_ports::lock(); // 기기 카드 당김(NUDGE)은 전역 — 소켓 시험과 겹치지 않게
    // '잠시 뒤 새 카드'라고 해 놓고 방 소켓이 붙어 있으면 5분 뒤에야 새 카드가 떴다
    let _ = take_nudge();
    let stale = serde_json::json!({ "id": "eeee0000", "from": "@link", "kind": "link", "sub": DEVICE_SUB, "dev": P1 });
    assert!(decide(&stale, true).is_err());
    assert!(take_nudge(), "지난 카드 → 바로 목록을 다시 받아 맞춘다");
}

#[test]
fn 목록_받기가_실패하면_30초_뒤_다시_본다() {
    // 10-28 윈도우 — 중계 429 로 한 번 실패하면 소켓이 붙어 있다고 5분을 기다려, 다른 기기에서 처리한 카드가 10분 늦게 닫혔다
    use std::time::Duration;
    assert_eq!(since_after(true, Duration::from_secs(300)), Duration::ZERO);
    assert_eq!(since_after(false, Duration::from_secs(300)), Duration::from_secs(270));
    assert_eq!(since_after(false, Duration::from_secs(60)), Duration::from_secs(30));
    assert_eq!(since_after(false, Duration::from_secs(5)), Duration::ZERO, "5초 주기는 그대로 5초");
}

#[test]
fn 대기_시각을_모르면_기한을_안_싣는다() {
    // until 이 1970 으로 찍히면 화면이 뜨자마자 '시간이 지났어요'로 닫아 누를 수 없었다
    let mut d = dev(P1, "pending", false);
    d.pending_since = None;
    assert!(device_row("ab12cd34", &d, "2027-01-15T08:00:00Z")["until"].is_null());
    assert_eq!(device_row("ab12cd34", &dev(P1, "pending", false), "2027-01-15T08:00:00Z")["until"], "2027-01-16T08:00:00Z");
}
