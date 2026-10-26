use super::*;
use crate::accounts_store::fake::Fake;
use crate::team_test_util::FakeRelay;

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-team-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

const SERVER: &str = "https://relay.test";

#[test]
fn curl_인자엔_서명·nonce_가_없고_머리는_600_파일로() {
    // 보안 검토 3-D: -H 'X-Chammo-Sig: …' 가 프로세스 인자(ps)에 보였다 — 머리는 600 임시 파일(-H @파일), curl 은 절대 경로
    let h = vec![("X-Chammo-Sig".to_string(), "SIGVALUE".to_string()), ("X-Chammo-Nonce".to_string(), "NONCEVALUE".to_string())];
    let dir = std::env::temp_dir().join(format!("chammo-curl-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let (prog, args, file) = curl_call(&dir, "POST", "https://relay.example.dev/v0/teams", &h, true).unwrap();
    let joined = args.join(" ");
    assert!(!joined.contains("SIGVALUE") && !joined.contains("NONCEVALUE"), "{joined}");
    assert!(args.windows(2).any(|w| w[0] == "-H" && w[1] == format!("@{}", file.display())));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
    }
    assert!(std::fs::read_to_string(&file).unwrap().contains("X-Chammo-Sig: SIGVALUE"));
    if cfg!(target_os = "macos") {
        assert_eq!(prog, "/usr/bin/curl");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn 서버_주소는_https_만_받고_끝_빗금은_뗀다() {
    assert_eq!(server_ok("https://relay.example.dev/").as_deref(), Some("https://relay.example.dev"));
    assert_eq!(server_ok("http://localhost:8787").as_deref(), Some("http://localhost:8787"), "로컬 wrangler dev 시험만 평문");
    for bad in ["http://relay.example.dev", "https://u:p@relay.example.dev", "https://relay.example.dev/v0", "ftp://x", "", "https://", "https://a b"] {
        assert_eq!(server_ok(bad), None, "{bad}");
    }
}

#[test]
fn 안_적으면_공개판_기본_중계와_폰_입구() {
    assert_eq!(server_or_default(" "), DEFAULT_SERVER);
    assert_eq!(server_or_default("https://relay.example.test"), "https://relay.example.test", "설정에서 바꾼 주소가 이긴다");
    assert_eq!(server_ok(DEFAULT_SERVER).as_deref(), Some(DEFAULT_SERVER));
    let mut st = TeamState::default();
    assert_eq!(phone_web_from(None, &st).as_deref(), Some(DEFAULT_PHONE_WEB));
    st.phone_web = "https://phone.example.test".into();
    assert_eq!(phone_web_from(None, &st).as_deref(), Some("https://phone.example.test"), "team.json 이 기본값보다 먼저");
    assert_eq!(phone_web_from(Some("https://env.example.test".into()), &st).as_deref(), Some("https://env.example.test"), "CHAMMO_PHONE_WEB 이 맨 먼저");
}

#[test]
fn 평문은_정확히_로컬일_때만_그것도_디버그에서만() {
    // 보안 검토 4-A: host.starts_with("127.0.0.1") 이라 127.0.0.1.attacker.net 이 평문으로 통과했다
    for bad in ["http://127.0.0.1.attacker.net", "http://127.0.0.1.attacker.net:8787", "http://localhost.evil.com", "http://localhostx:1", "http://127.0.0.10:8787", "https://relay.example.dev:x", "https://relay.example.dev:"] {
        assert_eq!(server_ok_in(bad, true), None, "{bad}");
    }
    assert_eq!(server_ok_in("http://127.0.0.1:8787", true).as_deref(), Some("http://127.0.0.1:8787"));
    assert_eq!(server_ok_in("http://localhost", true).as_deref(), Some("http://localhost"));
    assert_eq!(server_ok_in("https://relay.example.dev:8443", true).as_deref(), Some("https://relay.example.dev:8443"));
    // 릴리스 빌드에선 로컬이라도 평문 금지
    assert_eq!(server_ok_in("http://127.0.0.1:8787", false), None);
    assert_eq!(server_ok_in("http://localhost", false), None);
    assert_eq!(server_ok_in("https://relay.example.dev", false).as_deref(), Some("https://relay.example.dev"));
}

#[test]
fn team_json_의_서버를_바꿔치기해도_안_나간다() {
    // 보안 검토 4-B: load_state 가 server 를 다시 안 걸렀다 — 고친 team.json 의 주소로 서명 요청·소켓이 나갔다
    let (d, kc, r) = joined("tamper");
    let before = r.seen.borrow().len();
    for evil in ["http://evil.example", "https://u:p@evil.example", "http://127.0.0.1.attacker.net"] {
        mutate(&d, |s| s.server = evil.into()).unwrap();
        assert!(invite(&d, &kc, &r, "").is_err(), "{evil}");
        assert!(refresh_members(&d, &kc, &r, "").is_err(), "{evil}");
        let st = load_state(&d);
        let k = crate::team_relay_keys::load(&kc, &st.key_account).unwrap().unwrap();
        assert!(ws_url(&st, &k, "r1", 1, "BBBBBBBBBBBBBBBBBBBBBB").is_err(), "{evil}");
    }
    assert_eq!(r.seen.borrow().len(), before, "한 번도 안 나감");
}

#[test]
fn 기기_머리값에_줄바꿈이_있으면_안_보낸다() {
    // 리뷰 3: team.json 의 기기 id 가 curl 머리 파일에 그대로 들어가 다른 머리를 끼울 수 있었다
    let (d, kc, r) = joined("hdr");
    mutate(&d, |s| s.device_id = "d1\nX-Evil: 1".into()).unwrap();
    let before = r.seen.borrow().len();
    assert!(invite(&d, &kc, &r, "").is_err());
    assert_eq!(r.seen.borrow().len(), before);
}

#[test]
fn 옛_기기_등록은_새_열쇠로_서명하고_상태를_남긴다() {
    // 계정 없는 옛 초대 기기 상태가 만들어지던 길(register) — 지금은 create·join 이 ready 에서 막아(R8) 이미 있는 옛 상태만 남는다
    let d = dir("create");
    let kc = Fake::default();
    let r = FakeRelay::default();
    r.answer("/v0/teams", 201, r#"{"teamId":"t1","memberId":"m1","deviceId":"d1"}"#);
    let st = register(&d, &kc, &r, SERVER, "/v0/teams", serde_json::json!({ "name": "샘플팀", "deviceName": "맥북", "displayName": "지수" }), "owner", "지수", "맥북").unwrap();
    assert_eq!((st.team_id.as_str(), st.member_id.as_str(), st.device_id.as_str(), st.role.as_str()), ("t1", "m1", "d1", "owner"));
    let seen = r.seen.borrow();
    let (m, p, h, body) = &seen[0];
    assert_eq!((m.as_str(), p.as_str()), ("POST", "/v0/teams"));
    assert!(FakeRelay::header(h, "X-Chammo-Key").is_some() && FakeRelay::header(h, "X-Chammo-Device").is_none(), "아직 미등록 = 공개 열쇠 머리");
    let b: serde_json::Value = serde_json::from_str(body).unwrap();
    assert_eq!(b, serde_json::json!({ "name": "샘플팀", "deviceName": "맥북", "displayName": "지수" }));
    // 다시 읽어도 같고, 비밀 열쇠는 파일에 없다
    let again = load_state(&d);
    assert_eq!(again.team_id, "t1");
    let file = std::fs::read_to_string(d.join(STATE_FILE)).unwrap();
    assert!(file.contains(&again.key_account) && !file.contains("\"ed\""));
    assert!(crate::team_relay_keys::load(&kc, &again.key_account).unwrap().is_some());
    // 이미 팀이 있으면 또 못 만든다(신원 덮기 막기)
    assert!(register(&d, &kc, &r, SERVER, "/v0/teams", serde_json::json!({ "name": "샘플팀", "deviceName": "맥북", "displayName": "지수" }), "owner", "지수", "맥북").is_err());
}

#[test]
fn 서버가_거절하면_만든_열쇠를_치운다() {
    let d = dir("reject");
    let kc = Fake::default();
    let r = FakeRelay::default();
    r.answer("/v0/teams", 400, r#"{"error":"bad_request"}"#);
    assert!(register(&d, &kc, &r, SERVER, "/v0/teams", serde_json::json!({ "name": "샘플팀", "deviceName": "맥북", "displayName": "지수" }), "owner", "지수", "맥북").is_err());
    assert!(kc.items.borrow().is_empty(), "등록 안 된 열쇠는 남기지 않는다");
    assert!(load_state(&d).team_id.is_empty());
}

/// 계정 없는 옛 초대 기기(팀 t1 팀장) — 이미 있던 상태(지금은 새로 못 만든다, R8)
fn joined(tag: &str) -> (std::path::PathBuf, Fake, FakeRelay) {
    let d = dir(tag);
    let kc = Fake::default();
    let r = FakeRelay::default();
    r.answer("/v0/teams", 201, r#"{"teamId":"t1","memberId":"m1","deviceId":"d1"}"#);
    let st = register(&d, &kc, &r, SERVER, "/v0/teams", serde_json::json!({ "name": "샘플팀", "deviceName": "맥북", "displayName": "지수" }), "owner", "지수", "맥북").unwrap();
    let k = crate::team_relay_keys::load(&kc, &st.key_account).unwrap().unwrap();
    r.devices.borrow_mut().push(("d1".into(), k.public()));
    (d, kc, r)
}

#[test]
fn 초대_코드는_등록된_기기로_서명하고_링크째_붙여도_코드만_보낸다() {
    let (d, kc, r) = joined("invite");
    r.answer("/v0/teams/t1/invites", 201, r#"{"code":"CODE123","expiresAt":99}"#);
    let inv = invite(&d, &kc, &r, "").unwrap();
    assert_eq!(inv.code, "CODE123");
    // 슬랙·카톡에서 눌리는 https 링크(코드는 # 뒤 — 페이지 서버 기록에 안 남는다), 기본 중계가 아니면 서버도 # 뒤에
    assert_eq!(inv.link, "https://chammo.app/join#CODE123&server=https%3A%2F%2Frelay.test");
    assert_eq!(FakeRelay::header(&r.seen.borrow()[1].2, "X-Chammo-Device"), Some("d1"));

    // 들어오는 쪽은 사슬에 든 계정 기기(R8)
    let (d2, kc2, r2) = logged_in("join");
    r2.answer("/v0/invites/redeem", 201, r#"{"teamId":"t1","memberId":"m2","deviceId":"d7"}"#);
    let st = join(&d2, &kc2, &r2, "", &inv.link, "민아", "아이맥").unwrap();
    assert_eq!((st.member_id.as_str(), st.role.as_str()), ("m2", "member"));
    let seen = r2.seen.borrow();
    let (_, _, _, body) = seen.iter().find(|(_, p, _, _)| p == "/v0/invites/redeem").unwrap();
    assert_eq!(serde_json::from_str::<serde_json::Value>(body).unwrap()["code"], "CODE123", "링크째 붙여 넣어도 코드만 보낸다");
}

#[test]
fn 쓰인_초대_코드는_사람이_읽는_이유로() {
    let (d, kc, r) = logged_in("used");
    r.answer("/v0/invites/redeem", 410, r#"{"error":"invite_invalid"}"#);
    let e = join(&d, &kc, &r, "", "CODE", "민아", "아이맥").unwrap_err();
    assert!(e.contains("초대 코드"), "{e}");
    assert!(load_state(&d).teams.is_empty());
}

#[test]
fn 사람_이름으로_dm_방을_열고_기억한다() {
    let (d, kc, r) = joined("dm");
    r.answer("/v0/teams/t1/members", 200, r#"{"members":[{"id":"m1","displayName":"지수","role":"owner"},{"id":"m2","displayName":"민아","role":"member"}]}"#);
    r.answer("/v0/teams/t1/dms", 201, r#"{"roomId":"r1"}"#);
    let room = open_dm(&d, &kc, &r, "", "민아").unwrap();
    assert_eq!(room.id, "r1");
    let st = load_state(&d);
    assert_eq!(st.rooms.len(), 1);
    assert_eq!(st.rooms[0].peer, "m2");
    assert_eq!(st.members.len(), 2);
    // 두 번째는 서버에 안 묻고 기억한 방
    assert_eq!(open_dm(&d, &kc, &r, "", "m2").unwrap().id, "r1");
    assert_eq!(r.seen.borrow().len(), 3);
    assert!(open_dm(&d, &kc, &r, "", "지수").is_err(), "나 자신과는 DM 없음");
}

/// 구글로 로그인만 한 기기(팀 없음) — 열쇠·기기 id·계정만 있는 상태
fn logged_in(tag: &str) -> (std::path::PathBuf, Fake, FakeRelay) {
    let d = dir(tag);
    let kc = Fake::default();
    let r = FakeRelay::default();
    let (k, account) = crate::team_relay_keys::create(&kc).unwrap();
    r.devices.borrow_mut().push(("d7".into(), k.public()));
    mutate(&d, |s| {
        s.server = SERVER.into();
        s.key_account = account;
        s.device_id = "d7".into();
        s.device_name = "맥북".into();
        s.account = Some(Account { id: "a1".into(), email: "me@example.com".into(), name: "지수".into() });
    })
    .unwrap();
    // 암호 전용(R8) — 계정 기기는 사슬에 든 뒤에만 팀을 만들고 들어온다. 명부 고리 길은 이 시험들 관심 밖이라 늘 같은 답
    crate::e2e_state::seed_self(&d, &kc);
    r.always("GET", "/log", 200, r#"{"links":[]}"#);
    r.always("POST", "/log", 201, "{}");
    (d, kc, r)
}

#[test]
fn 로그인한_기기는_팀_만들기를_기기_서명으로_하고_새_열쇠를_안_만든다() {
    // ADR 0004: 계정 기기는 이미 등록된 기기 — 미등록 열쇠 머리(X-Chammo-Key)로 새 열쇠를 만들면 계정 밖 새 기기가 생긴다
    let (d, kc, r) = logged_in("acct-create");
    let before = kc.items.borrow().len();
    r.answer("/v0/teams", 201, r#"{"teamId":"t9","memberId":"m9","deviceId":"d7"}"#);
    let st = create(&d, &kc, &r, "", "샘플팀", "지수", "맥북").unwrap();
    assert_eq!(FakeRelay::header(&r.seen.borrow()[0].2, "X-Chammo-Device"), Some("d7"));
    assert!(FakeRelay::header(&r.seen.borrow()[0].2, "X-Chammo-Key").is_none());
    assert_eq!(kc.items.borrow().len(), before, "새 열쇠 없음");
    assert_eq!((st.team_id.as_str(), st.member_id.as_str(), st.device_id.as_str(), st.role.as_str()), ("t9", "m9", "d7", "owner"));
    assert_eq!(st.account.as_ref().map(|a| a.id.as_str()), Some("a1"), "계정은 그대로");
    // 다른 서버 주소를 주면 거절(이 기기는 그 서버 계정)
    let (d2, kc2, r2) = logged_in("acct-other-server");
    assert!(create(&d2, &kc2, &r2, "https://other.example", "x", "지수", "맥북").is_err());
}

#[test]
fn 로그인한_기기는_초대로도_기기_서명으로_들어오고_팀_이름을_받는다() {
    let (d, kc, r) = logged_in("acct-join");
    r.answer("/v0/invites/redeem", 201, r#"{"teamId":"t1","teamName":"샘플팀","memberId":"m5","deviceId":"d7"}"#);
    let st = join(&d, &kc, &r, "", "CODE", "지수", "맥북").unwrap();
    assert_eq!(FakeRelay::header(&r.seen.borrow()[0].2, "X-Chammo-Device"), Some("d7"));
    assert_eq!((st.team_name.as_str(), st.member_id.as_str(), st.role.as_str()), ("샘플팀", "m5", "member"));
}

#[test]
fn 멤버_목록은_기기_이름까지_받는다() {
    let (d, kc, r) = joined("member-devices");
    r.answer("/v0/teams/t1/members", 200, r#"{"members":[{"id":"m1","displayName":"지수","role":"owner","devices":[{"id":"d1","name":"맥북"}]},{"id":"m2","displayName":"민아","role":"member","devices":[{"id":"dx","name":"아이맥"},{"id":"dy","name":"폰"}]}]}"#);
    let st = refresh_members(&d, &kc, &r, "").unwrap();
    assert_eq!(st.device_label("dy").as_deref(), Some("폰"));
    assert_eq!(st.device_label("없음"), None);
}

#[test]
fn 내_방_목록으로_방을_찾고_내_기기끼리_방이_없으면_만든다() {
    // 서버 ADR 0004: 5분마다 멤버 전원과 DM 을 열던 것 대신 GET /v0/me/rooms
    let (d, kc, r) = logged_in("rooms");
    mutate(&d, |s| s.member_id = "m1".into()).unwrap();
    r.answer("/v0/me/rooms", 200, r#"{"rooms":[{"roomId":"r1","kind":"dm","teamId":"t1","memberIds":["m1","m2"]},{"roomId":"r2","kind":"dm","teamId":"t1","memberIds":["m3","m1"]}]}"#);
    r.answer("/v0/me/room", 201, r#"{"roomId":"rs"}"#);
    let st = sync_rooms(&d, &kc, &r).unwrap();
    let got: Vec<_> = st.rooms.iter().map(|x| (x.id.as_str(), x.kind.as_str(), x.peer.as_str())).collect();
    assert_eq!(got, vec![("r1", "dm", "m2"), ("r2", "dm", "m3"), ("rs", "self", "")]);
    // 다음엔 목록에 있으니 안 만든다
    r.answer("/v0/me/rooms", 200, r#"{"rooms":[{"roomId":"rs","kind":"self","teamId":null,"memberIds":[]}]}"#);
    let n = r.seen.borrow().len();
    sync_rooms(&d, &kc, &r).unwrap();
    assert_eq!(r.seen.borrow().len(), n + 1);
}

#[test]
fn 계정_없는_옛_기기는_내_기기끼리_방을_안_만든다() {
    let (d, kc, r) = joined("rooms-old");
    r.answer("/v0/me/rooms", 200, r#"{"rooms":[{"roomId":"r1","kind":"dm","teamId":"t1","memberIds":["m1","m2"]}]}"#);
    let st = sync_rooms(&d, &kc, &r).unwrap();
    assert_eq!(st.rooms.len(), 1);
    assert!(!r.seen.borrow().iter().any(|(_, p, _, _)| p.ends_with("/v0/me/room")));
}

#[test]
fn 웹소켓_주소엔_같은_서명을_쿼리로() {
    let (d, kc, _r) = joined("ws");
    let st = load_state(&d);
    let k = crate::team_relay_keys::load(&kc, &st.key_account).unwrap().unwrap();
    let u = ws_url(&st, &k, "r1", 1_761_148_800_000, "BBBBBBBBBBBBBBBBBBBBBB").unwrap();
    let want = k.sign_request("GET", "/v0/rooms/r1/ws", b"", 1_761_148_800_000, "BBBBBBBBBBBBBBBBBBBBBB");
    assert_eq!(u, format!("wss://relay.test/v0/rooms/r1/ws?device=d1&ts=1761148800000&nonce=BBBBBBBBBBBBBBBBBBBBBB&sig={}", want.sig));
}

#[test]
fn 상태_파일은_남이_못_읽는다() {
    let (d, _kc, _r) = joined("perm");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(d.join(STATE_FILE)).unwrap().permissions().mode() & 0o777, 0o600);
    }
}

#[test]
fn 사슬_전_계정_기기는_팀을_만들지도_들어오지도_못한다() {
    // ADR 0007 R8 암호 전용 — 명부 없는 팀은 쓸 수 없으니 서버에 팀을 만들기 전에 막는다
    let d = dir("acct-not-ready");
    let kc = Fake::default();
    let r = FakeRelay::default();
    let (k, account) = crate::team_relay_keys::create(&kc).unwrap();
    r.devices.borrow_mut().push(("d7".into(), k.public()));
    mutate(&d, |s| {
        s.server = SERVER.into();
        s.key_account = account;
        s.device_id = "d7".into();
        s.account = Some(Account { id: "a1".into(), ..Default::default() });
    })
    .unwrap();
    assert!(create(&d, &kc, &r, "", "팀", "지수", "맥북").unwrap_err().contains("준비 전"));
    assert!(join(&d, &kc, &r, "", "CODE", "지수", "맥북").unwrap_err().contains("준비 전"));
    assert!(r.seen.borrow().is_empty(), "서버에 아무 요청도 안 간다");
}

#[test]
fn 계정_없는_옛_초대_기기는_팀을_만들지도_들어오지도_못한다() {
    // 5차 리뷰 낮음 — 암호 전용(R8)이라 계정 없는 기기는 봉투를 못 만든다. 서버에 팀을 만들기 전에 막는다
    let d = dir("legacy-refused");
    let kc = Fake::default();
    let r = FakeRelay::default();
    assert!(create(&d, &kc, &r, SERVER, "팀", "지수", "맥북").unwrap_err().contains("준비 전"));
    assert!(join(&d, &kc, &r, SERVER, "CODE", "지수", "맥북").unwrap_err().contains("준비 전"));
    assert!(r.seen.borrow().is_empty());
}

#[test]
fn 명부_첫_고리를_못_올리면_만든_팀을_그_자리에서_지운다() {
    // 5차 리뷰 낮음 — 명부 없는 팀이 서버에 고아로 남았다
    let (d, kc, r) = logged_in("orphan");
    r.answer("/v0/teams", 201, r#"{"teamId":"t9","memberId":"m9","deviceId":"d7"}"#);
    r.answer("/v0/teams/t9/log", 500, r#"{"error":"boom"}"#);
    r.answer("/v0/teams/t9/delete", 200, r#"{"ok":true}"#);
    let e = create(&d, &kc, &r, "", "샘플팀", "지수", "맥북").unwrap_err();
    assert!(e.contains("지웠"), "{e}");
    assert!(r.seen.borrow().iter().any(|(m, p, _, _)| m == "POST" && p == "/v0/teams/t9/delete"));
    assert!(load_state(&d).teams.iter().all(|t| t.id != "t9"), "이 기기 목록에서도 뺀다");
}

#[test]
fn 초대_링크는_https_고_기본_중계면_코드만() {
    assert_eq!(invite_link(DEFAULT_SERVER, "Ab-_9z"), "https://chammo.app/join#Ab-_9z");
    assert_eq!(invite_link("https://relay.chammo.app/", "C1"), "https://chammo.app/join#C1", "끝 빗금만 다른 기본 중계");
    assert_eq!(invite_link("https://relay.test", "C1"), "https://chammo.app/join#C1&server=https%3A%2F%2Frelay.test");
    assert!(!invite_link(DEFAULT_SERVER, "C1").starts_with("chammo://"), "chammo:// 는 슬랙에서 안 눌린다(10-24 사용자)");
}

#[test]
fn 붙여_넣은_초대는_https_링크_옛_링크_딥링크_코드만_다_받는다() {
    let d = Some(DEFAULT_SERVER.to_string());
    for (raw, want) in [
        ("https://chammo.app/join#Ab-_9z", (d.clone(), "Ab-_9z")),
        ("  https://chammo.app/join#Ab-_9z\n", (d.clone(), "Ab-_9z")),
        ("chammo.app/join#Ab-_9z", (d.clone(), "Ab-_9z")),
        ("https://www.chammo.app/join/#Ab-_9z", (d.clone(), "Ab-_9z")),
        ("<https://chammo.app/join#Ab-_9z>", (d.clone(), "Ab-_9z")),
        ("https://chammo.app/join#Ab-_9z&server=https%3A%2F%2Frelay.test", (Some("https://relay.test".into()), "Ab-_9z")),
        ("https://chammo.app/join#code=Ab-_9z", (d.clone(), "Ab-_9z")),
        ("chammo://join?server=https%3A%2F%2Frelay.test&code=Ab-_9z", (Some("https://relay.test".into()), "Ab-_9z")),
        ("chammo://join?code=Ab-_9z", (None, "Ab-_9z")),
        ("chammo://join/?code=Ab-_9z", (None, "Ab-_9z")),
        ("Ab-_9z", (None, "Ab-_9z")),
    ] {
        assert_eq!(parse_invite(raw), (want.0, want.1.to_string()), "{raw:?}");
    }
}

#[test]
fn 초대가_아닌_글은_코드로_보내지_않는다() {
    for raw in ["", "   ", "https://evil.example/join#Ab", "https://chammo.app/join", "https://chammo.app/join#", "코드 Ab", "Ab cd", "chammo://other?code=Ab", "a&b=c"] {
        assert_eq!(parse_invite(raw).1, "", "{raw:?}");
    }
    let d = dir("junk");
    let e = join(&d, &Fake::default(), &FakeRelay::default(), SERVER, "https://evil.example/join#Ab", "민아", "아이맥").unwrap_err();
    assert!(e.contains("초대") || e.contains("invite"), "{e}");
}

#[test]
fn 클립보드_글에서_초대_링크만_찾는다() {
    assert_eq!(invite_in_text("민아님 이거 눌러요 https://chammo.app/join#Ab-_9z 24시간이에요").as_deref(), Some("https://chammo.app/join#Ab-_9z"));
    assert_eq!(invite_in_text("<https://chammo.app/join#Ab|초대>").as_deref(), Some("https://chammo.app/join#Ab"), "슬랙 링크 모양");
    assert_eq!(invite_in_text("chammo://join?server=https%3A%2F%2Frelay.test&code=Ab").as_deref(), Some("https://chammo.app/join#Ab&server=https%3A%2F%2Frelay.test"));
    for t in ["", "Ab-_9z", "https://chammo.app/privacy", "https://chammo.app/join#", "https://evil.example/chammo.app/join#Ab", "chammo://join?code=Ab&server=http%3A%2F%2Fevil.example"] {
        assert_eq!(invite_in_text(t), None, "{t:?}");
    }
}

#[test]
fn 서버_409_는_까닭마다_사람_말로() {
    // 10-25 QA — link_required 가 '이 열쇠는 이미 등록돼 있어'(반말에 뜻도 모름)로 나왔다
    let w = |e: &str| why(409, &serde_json::json!({ "error": e }));
    assert!(w("link_required").contains("6자리"), "{}", w("link_required"));
    assert!(w("not_revealed").contains("숫자"));
    assert!(w("stale_head").contains("다시 열어"));
    assert!(w("busy").contains("다른 기기"));
    assert!(w("key_in_use").contains("열쇠"));
    for e in ["link_required", "not_revealed", "stale_head", "no_commit", "busy", "something_new"] {
        assert!(!w(e).contains("이미 등록돼 있어"), "{e}: {}", w(e));
    }
}
