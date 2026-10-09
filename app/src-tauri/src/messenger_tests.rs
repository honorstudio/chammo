use super::*;
use serde_json::json;

const ME: i64 = 7001;
const STRANGER: i64 = 9009;
const T0: u64 = 1_800_000_000_000;

fn paired() -> State {
    State { on: true, bot: Some("chammo_test_bot".into()), user: Some(User { id: ME, name: "길동".into(), at: T0, username: None }), ..Default::default() }
}

fn text_from(from: i64, text: &str) -> Incoming {
    parse(&json!({ "update_id": 1, "message": { "message_id": 1, "date": T0 / 1000, "chat": { "id": from, "type": "private" }, "from": { "id": from, "is_bot": false, "first_name": "길동" }, "text": text } }))
}

fn decide_now(st: &State, gate: &mut Gate, inc: &Incoming) -> Act {
    decide(st, gate, inc, T0, T0)
}

#[test]
fn 모르는_사람·그룹·봇·채널은_답도_안_한다() {
    let st = paired();
    let mut g = Gate::default();
    assert_eq!(decide_now(&st, &mut g, &text_from(STRANGER, "안녕")), Act::Ignore);
    assert_eq!(decide_now(&st, &mut g, &text_from(STRANGER, "/참모")), Act::Ignore);
    assert_eq!(decide_now(&st, &mut g, &text_from(STRANGER, "/start")), Act::Ignore);
    let group = parse(&json!({ "update_id": 2, "message": { "date": T0 / 1000, "chat": { "id": -100, "type": "group" }, "from": { "id": ME, "first_name": "길동" }, "text": "그룹에서 짝이" } }));
    assert_eq!(decide_now(&st, &mut g, &group), Act::Ignore, "짝이 보냈어도 그룹 글은 버린다");
    let bot = parse(&json!({ "update_id": 3, "message": { "date": T0 / 1000, "chat": { "id": ME, "type": "private" }, "from": { "id": ME, "is_bot": true }, "text": "x" } }));
    assert_eq!(decide_now(&st, &mut g, &bot), Act::Ignore);
    let channel = parse(&json!({ "update_id": 4, "channel_post": { "text": "x" } }));
    assert_eq!(decide_now(&st, &mut g, &channel), Act::Ignore);
    let edited = parse(&json!({ "update_id": 5, "edited_message": { "chat": { "id": ME, "type": "private" }, "from": { "id": ME }, "text": "고친 글" } }));
    assert_eq!(decide_now(&st, &mut g, &edited), Act::Ignore);
    // 짝이 없으면 누구 글도 안 받는다
    assert_eq!(decide_now(&State::default(), &mut g, &text_from(ME, "안녕")), Act::Ignore);
}

#[test]
fn 짝짓기_코드는_한_번만_10분_안에() {
    let st = State::default();
    let mut g = Gate::default();
    let code = g.issue(T0).unwrap();
    assert_eq!(code.len(), 32);
    assert!(g.waiting(T0));
    match decide_now(&st, &mut g, &text_from(STRANGER, &format!("/start {code}"))) {
        Act::Paired(u) => assert_eq!((u.id, u.name.as_str()), (STRANGER, "길동")),
        a => panic!("{a:?}"),
    }
    assert!(!g.waiting(T0), "쓰면 죽는다");
    assert_eq!(decide_now(&st, &mut g, &text_from(ME, &format!("/start {code}"))), Act::Ignore, "다시 못 쓴다");
    // 만료
    let code = g.issue(T0).unwrap();
    assert_eq!(decide(&st, &mut g, &text_from(ME, &format!("/start {code}")), T0, T0 + CODE_TTL_MS + 1), Act::Ignore);
    // 딥링크 모양(/start@봇 코드)
    let code = g.issue(T0).unwrap();
    assert!(matches!(decide_now(&st, &mut g, &text_from(ME, &format!("/start@chammo_test_bot {code}"))), Act::Paired(_)));
}

#[test]
fn 틀린_코드_5번이면_그_코드는_죽는다() {
    let st = State::default();
    let mut g = Gate::default();
    let code = g.issue(T0).unwrap();
    for i in 0..MAX_FAILS {
        assert_eq!(decide_now(&st, &mut g, &text_from(STRANGER, &format!("/start {:032x}", i))), Act::Ignore, "틀린 코드엔 답 안 함");
    }
    assert!(!g.waiting(T0));
    assert_eq!(decide_now(&st, &mut g, &text_from(ME, &format!("/start {code}"))), Act::Ignore, "잠긴 뒤엔 맞는 코드도 안 된다");
}

#[test]
fn 짝의_글과_명령() {
    let st = paired();
    let mut g = Gate::default();
    assert_eq!(decide_now(&st, &mut g, &text_from(ME, "  배포 상태 봐 줘 ")), Act::Send { to: None, text: "배포 상태 봐 줘".into() });
    assert_eq!(decide_now(&st, &mut g, &text_from(ME, "/잠금")), Act::Lock);
    assert_eq!(decide_now(&st, &mut g, &text_from(ME, "/lock")), Act::Lock);
    assert_eq!(decide_now(&st, &mut g, &text_from(ME, "/참모")), Act::List);
    assert_eq!(decide_now(&st, &mut g, &text_from(ME, "/참모-2 이거 해 줘\n둘째 줄")), Act::Send { to: Some("참모-2".into()), text: "이거 해 줘\n둘째 줄".into() });
    assert_eq!(decide_now(&st, &mut g, &text_from(ME, "/참모-2")), Act::Choose("참모-2".into()));
    assert!(matches!(decide_now(&st, &mut g, &text_from(ME, "/start")), Act::Reply(_)));
    assert!(matches!(decide_now(&st, &mut g, &text_from(ME, "/help")), Act::Reply(_)));
}

#[test]
fn 제어_문자는_빼고_길면_거절() {
    let st = paired();
    let mut g = Gate::default();
    assert_eq!(decide_now(&st, &mut g, &text_from(ME, "멈춰\u{1b}[2J\u{3}\u{7f}줘")), Act::Send { to: None, text: "멈춰[2J줘".into() });
    assert!(matches!(decide_now(&st, &mut g, &text_from(ME, &"가".repeat(MAX_TEXT + 1))), Act::Reply(_)));
    assert!(matches!(decide_now(&st, &mut g, &text_from(ME, &"가".repeat(MAX_TEXT))), Act::Send { .. }));
    assert_eq!(decide_now(&st, &mut g, &text_from(ME, "\u{1b}\u{3}")), Act::Ignore);
}

#[test]
fn 속도_상한은_한_번_알리고_조용히_버린다() {
    let st = paired();
    let mut g = Gate::default();
    for i in 0..RATE_PER_MIN as u64 {
        assert!(matches!(decide(&st, &mut g, &text_from(ME, "a"), T0, T0 + i), Act::Send { .. }));
    }
    assert!(matches!(decide(&st, &mut g, &text_from(ME, "a"), T0, T0 + 30), Act::Reply(_)));
    assert_eq!(decide(&st, &mut g, &text_from(ME, "a"), T0, T0 + 31), Act::Ignore);
    assert!(matches!(decide(&st, &mut g, &text_from(ME, "a"), T0, T0 + 60_001), Act::Send { .. }), "1분 지나면 다시");
}

#[test]
fn 꺼져_있던_동안_온_글은_세기만() {
    let st = paired();
    let mut g = Gate::default();
    let old = text_from(ME, "앱 꺼졌을 때 보낸 글");
    assert_eq!(decide(&st, &mut g, &old, T0 + 60_000, T0 + 60_000), Act::Late);
    assert_eq!(decide(&st, &mut g, &text_from(STRANGER, "x"), T0 + 60_000, T0 + 60_000), Act::Ignore);
    // 짝짓기도 꺼져 있던 동안 것은 안 받는다
    let code = g.issue(T0 + 60_000).unwrap();
    assert_eq!(decide(&State::default(), &mut g, &text_from(ME, &format!("/start {code}")), T0 + 60_000, T0 + 60_000), Act::Ignore);
}

#[test]
fn 전달한_글·사진은_안_받는다() {
    let st = paired();
    let mut g = Gate::default();
    let fwd = parse(&json!({ "update_id": 9, "message": { "date": T0 / 1000, "chat": { "id": ME, "type": "private" }, "from": { "id": ME }, "forward_origin": { "type": "user" }, "text": "남이 쓴 지시" } }));
    assert!(matches!(decide_now(&st, &mut g, &fwd), Act::Reply(_)));
    let photo = parse(&json!({ "update_id": 9, "message": { "date": T0 / 1000, "chat": { "id": ME, "type": "private" }, "from": { "id": ME }, "photo": [] } }));
    assert!(matches!(decide_now(&st, &mut g, &photo), Act::Reply(_)));
}

fn button(from: i64, chat: i64, data: &str) -> Incoming {
    parse(&json!({ "update_id": 20, "callback_query": { "id": "cb1", "from": { "id": from }, "message": { "message_id": 55, "chat": { "id": chat } }, "data": data } }))
}

#[test]
fn 버튼은_짝의_1대1_것만() {
    let st = paired();
    let mut g = Gate::default();
    assert_eq!(decide_now(&st, &mut g, &button(STRANGER, STRANGER, "c:ab12cd34:y")), Act::Ignore);
    assert_eq!(decide_now(&st, &mut g, &button(ME, -100, "c:ab12cd34:y")), Act::Ignore, "그룹에 올라간 카드");
    assert_eq!(decide_now(&st, &mut g, &button(ME, ME, "c:ab12cd34:y")), Act::Button { cb: "cb1".into(), msg: 55, card: "ab12cd34".into(), pick: Pick::Yes });
    assert_eq!(decide_now(&st, &mut g, &button(ME, ME, "c:ab12cd34:o2")), Act::Button { cb: "cb1".into(), msg: 55, card: "ab12cd34".into(), pick: Pick::Option { option: 2 } });
    assert_eq!(decide_now(&st, &mut g, &button(ME, ME, "c:../etc:y")), Act::ButtonIgnore { cb: "cb1".into() });
}

#[test]
fn 버튼_데이터는_엄격하게() {
    assert_eq!(parse_button("c:ab12cd34:n"), Some(("ab12cd34".into(), Pick::No)));
    assert_eq!(parse_button("c:ab12cd34:o9"), Some(("ab12cd34".into(), Pick::Option { option: 9 })));
    for bad in ["c:ab12cd34:o10", "c:AB12CD34:y", "c:ab12cd3:y", "c:ab12cd34:y:x", "x:ab12cd34:y", "c:ab12cd34:t", "c:ab12cd34:o-1", ""] {
        assert_eq!(parse_button(bad), None, "{bad}");
    }
}

#[test]
fn 참모_이름_가리기() {
    assert!(is_orch_name("참모", "참모"));
    assert!(is_orch_name("참모-2 · 참모 업데이트", "참모"));
    assert!(!is_orch_name("참모-x", "참모"));
    assert!(!is_orch_name("sns-posting", "참모"));
    assert!(!is_orch_name("참모", ""));
    let list = vec![
        Orch { id: "aaaaaaaa".into(), session: "s1".into(), name: "참모".into() },
        Orch { id: "bbbbbbbb".into(), session: "s2".into(), name: "참모-2 · 참모 업데이트".into() },
    ];
    assert_eq!(find_orch(&list, "참모-2").unwrap().id, "bbbbbbbb");
    assert_eq!(find_orch(&list, "참모 업데이트").unwrap().id, "bbbbbbbb");
    assert!(find_orch(&list, "참모-9").is_none());
    assert_eq!(default_orch(&list, Some("참모-2"), "참모").unwrap().id, "bbbbbbbb");
    assert_eq!(default_orch(&list, Some("참모-7"), "참모").unwrap().id, "aaaaaaaa", "꺼진 참모면 기본 이름");
    assert!(list_text(&list, list.get(1)).contains("참모-2 · 참모 업데이트 — 지금 받는 참모"));
}

#[test]
fn 보낸_카드는_상한까지만_기억() {
    let mut st = State::default();
    for i in 0..MAX_CARDS + 5 {
        st.remember_card(&format!("{i:08x}"));
    }
    st.remember_card("00000010");
    assert_eq!(st.cards.len(), MAX_CARDS);
    assert_eq!(st.cards[0], "00000005");
}

#[test]
fn 도움말_예시는_비서_이름으로() {
    assert!(help_for("루나").contains("/루나-2 안녕"));
    assert!(!help_for("루나").contains("/참모-2"), "예시에 기본 이름을 박지 않는다 — 공개본에선 참모가 참모로 바뀌어 /참모 목록 명령과 겹친다");
}

#[test]
fn 안_보이는_글자는_입력칸·이름에서_뺀다() {
    assert_eq!(clean_text("a\u{202E}b\u{200B}c\u{2028}d"), "abcd");
    assert_eq!(clean_name("\u{202E}동길 이"), "동길 이");
    match parse(&json!({ "update_id": 1, "message": { "date": 1, "chat": { "id": 5, "type": "private" }, "from": { "id": 5, "first_name": "가\u{202E}나", "username": "real_user" }, "text": "x" } })) {
        Incoming::Text { name, username, .. } => assert_eq!((name.as_str(), username.as_deref()), ("가나", Some("real_user"))),
        i => panic!("{i:?}"),
    }
}
