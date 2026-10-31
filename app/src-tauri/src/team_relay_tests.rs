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
fn 서버가_지운_기기는_401_뒤_열쇠로_물어_끊김으로_적고_다시_안_묻는다() {
    // 10-28 윈도우 실측: 로그인 허용 대기 중 거절돼 서버가 기기 줄을 지웠는데 앱은 로그인된 줄 알고 60초마다 401 — 초대 링크를 눌러도 못 들어왔다
    let (d, kc, r) = logged_in("gone");
    r.devices.borrow_mut().clear(); // 서버에 기기 줄 없음 → 기기 머리 요청은 401
    r.answer(KEY_PROBE, 404, r#"{"error":"not_found"}"#); // 모르는 열쇠 + 시계 맞음(서명 통과)
    let e = sync_rooms(&d, &kc, &r).unwrap_err();
    assert!(e.contains("다시 로그인"), "{e}");
    assert!(load_state(&d).revoked);
    let probe = r.seen.borrow().iter().find(|(_, p, _, _)| p == KEY_PROBE).cloned().unwrap();
    assert_eq!(probe.0, "GET");
    assert!(FakeRelay::header(&probe.2, "X-Chammo-Device").is_none() && FakeRelay::header(&probe.2, "X-Chammo-Key").is_some(), "기기 머리 없이 열쇠 머리로");
    // 끊긴 줄 알면 서버에 다시 안 묻는다(60초마다 401 을 안 쌓는다)
    let n = r.seen.borrow().len();
    assert!(sync_rooms(&d, &kc, &r).unwrap_err().contains("다시 로그인"));
    assert_eq!(r.seen.borrow().len(), n);
}

#[test]
fn 열쇠를_서버가_알거나_답이_애매하면_401_은_끊김이_아니다() {
    // 시계가 5분 넘게 틀린 기기는 확인 요청도 401 — 끊김으로 적지 않고 옛 안내 그대로. 5xx·429·망 오류도 마찬가지
    for (tag, code) in [("gone-401", 401), ("gone-500", 500), ("gone-429", 429)] {
        let (d, kc, r) = logged_in(tag);
        r.devices.borrow_mut().clear();
        r.answer(KEY_PROBE, code, r#"{"error":"x"}"#);
        assert!(sync_rooms(&d, &kc, &r).unwrap_err().contains("시계"), "{tag}");
        assert!(!load_state(&d).revoked, "{tag}");
    }
}

#[test]
fn 끊긴_기기는_초대를_받으면_서버에_안_가고_다시_로그인을_말한다() {
    let (d, kc, r) = logged_in("join-gone");
    mutate(&d, |s| s.revoked = true).unwrap();
    let e = join(&d, &kc, &r, "", "https://chammo.app/join#Ab-_9z", "민아", "윈도우").unwrap_err();
    assert!(e.contains("다시 로그인") && e.contains("초대"), "{e}");
    assert!(r.seen.borrow().is_empty());
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

#[test]
fn 화면_명령처럼_spawn_blocking_실에서_두_번_보내면_연결_하나로() {
    // fix/team-latency3 — 화면 명령은 tauri spawn_blocking 실에서 중계를 부른다. 거기서 다시 쓰는 연결이 실제로 다시 쓰이는지(연결 수로)
    use std::io::{Read, Write};
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    let accepts = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let a = accepts.clone();
    std::thread::spawn(move || {
        for s in l.incoming().flatten() {
            a.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            std::thread::spawn(move || {
                let mut s = s;
                let mut buf = Vec::new();
                let mut b = [0u8; 1024];
                while let Ok(n) = s.read(&mut b) {
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&b[..n]);
                    while let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        buf.drain(..i + 4);
                        let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
                    }
                }
            });
        }
    });
    let url = format!("http://127.0.0.1:{port}/v0/me");
    let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
    for _ in 0..2 {
        let u = url.clone();
        let got = rt.block_on(async move { tokio::task::spawn_blocking(move || pooled_send("GET", &u, &[], b"", "", std::time::Duration::from_secs(5))).await.unwrap() });
        assert_eq!(got.expect("다시 쓰는 연결로 갔다").unwrap(), (200, b"ok".to_vec()));
    }
    assert_eq!(accepts.load(std::sync::atomic::Ordering::SeqCst), 1, "두 요청이 연결 하나를 같이 썼다");
    // 비동기 실 안에서 불러도 앱이 죽지 않는다(디버그 빌드 reqwest 는 패닉 → curl 로)
    let u = url.clone();
    let _ = rt.block_on(async move { pooled_send("GET", &u, &[], b"", "", std::time::Duration::from_secs(5)) });
    let src = include_str!("team_relay.rs");
    assert!(src.contains(".redirect(no_hops())") && src.contains("hops::Policy::none()"), "curl 처럼 리다이렉트를 안 따라간다(서명한 요청이 다른 곳으로 새지 않게)");
}

#[test]
fn 다시_쓰는_연결_클라이언트가_패닉_없이_만들어진다() {
    // reqwest(rustls-no-provider)는 암호 제공자가 없으면 내부 실에서 패닉한다(10-27 실측 — 단위 시험이 클라이언트를 안 만들어 못 잡았다)
    assert!(pool().is_some());
}

fn three() -> (TeamEntry, std::collections::BTreeMap<String, String>) {
    let m = |id: &str, n: &str| Member { id: id.into(), display_name: n.into(), role: "member".into(), perms: vec![], devices: vec![] };
    let t = TeamEntry { id: "t1".into(), name: "샘플팀".into(), member_id: "m1".into(), members: vec![m("m1", "지수"), m("m2", "그늘"), m("m3", "Sky Lee"), m("m4", "도윤")], ..Default::default() };
    // 프로필 이름 — m2 는 '도윤 대표', m3 는 m4 의 명부 이름과 같은 '도윤'(옛 기록·다른 팀에서 지은 이름)
    let aka = [("m2", "도윤 대표"), ("m3", "도윤")].into_iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
    (t, aka)
}

#[test]
fn 사람은_프로필_이름으로도_찾고_겹치면_고르라고_한다() {
    // 10-28 아이맥 참모: 사용자가 부른 프로필 이름('○○ 대표님한테 DM')을 못 찾았다 — 명부 이름(계정 이름)만 봐서
    let (t, aka) = three();
    assert_eq!(find_member(&t, "도윤 대표", &aka).unwrap().id, "m2", "프로필 이름 정확히");
    assert_eq!(find_member(&t, "그늘", &aka).unwrap().id, "m2", "명부 이름도 그대로");
    assert_eq!(find_member(&t, "sky", &aka).unwrap().id, "m3", "하나뿐인 앞부분");
    assert_eq!(find_member(&t, "m4", &aka).unwrap().id, "m4", "멤버 id");
    let e = find_member(&t, "도윤", &aka).unwrap_err();
    assert!(e.contains("누구") && e.contains("도윤(Sky Lee) [m3]") && e.contains("도윤 [m4]"), "겹치면 엉뚱한 사람에게 안 보내고 id 와 함께 고르라고: {e}");
    let e = find_member(&t, "철수", &aka).unwrap_err();
    assert!(e.contains("도윤 대표(그늘)"), "모를 땐 '프로필 이름(계정 이름)' 목록: {e}");
}

// ── 사람 말 몫(10-28 22:53 429) — 배경 요청이 칸 몫(BG_CAP)을 다 써도 사람 말은 나간다 ──

#[test]
fn 배경_요청은_칸마다_200개에서_멈추고_사람_말은_그_뒤에도_나간다() {
    let key = "budget-test-key";
    let t = 7 * BUCKET_MS + 1;
    for _ in 0..BG_CAP {
        assert!(spend(key, t, false));
    }
    assert!(!spend(key, t, false), "배경 201번째는 안 보낸다");
    for _ in 0..100 {
        assert!(spend(key, t, true), "사람 말 몫 100개");
    }
    assert_eq!(spent(key, t), BG_CAP + 100, "서버 칸(300)을 안 넘는다");
    assert!(spend(key, t + BUCKET_MS, false), "다음 칸이면 다시");
    assert!(!as_human(|| false) && !human_now(), "as_human 밖으로 새지 않는다");
    assert!(as_human(human_now));
}

#[test]
fn 배경_몫을_다_쓴_뒤엔_서버에_안_닿고_사람_말은_쉬는_중이어도_닿는다() {
    let (d, kc, r) = (dir("budget-call"), crate::accounts_store::fake::Fake::default(), FakeRelay::default());
    let (k, _) = crate::team_relay_keys::create(&kc).unwrap();
    r.devices.borrow_mut().push(("d1".into(), k.public()));
    r.always("GET", "/v0/me", 200, "{}");
    let _ = &d;
    let now = now_ms();
    while spend(&k.public(), now, false) {}
    let (c, v) = call(&r, "https://relay.test", &k, Some("d1"), "GET", "/v0/me", None).unwrap();
    assert_eq!((c, v["budget"].as_bool()), (429, Some(true)));
    assert_eq!(r.seen.borrow().len(), 0, "배경은 서버에 안 닿는다");
    slow_down(&k.public(), &Value::Null, std::time::Instant::now());
    let (c, _) = as_human(|| call(&r, "https://relay.test", &k, Some("d1"), "GET", "/v0/me", None)).unwrap();
    assert_eq!(c, 200, "사람 말은 쉬는 중·몫 넘김이어도 한 번 두드린다");
}

// ── 사람이 누른 팀 동작(10-30 팀챗 만들기가 '잠시 쉬래요') — 화면 명령은 뒤 스레드 입구 두 개(human_job·bg_job)로만 중계를 부른다.
//    목록·폴링(화면 열 때·몇 초마다 저절로)만 bg_job, 나머지는 사람이 눌러야 불리는 것이라 human_job ──

/// 저절로 불리는 화면 명령 — 배경 몫(BG_CAP)을 센다
const BG_CMDS: &[&str] = &[
    "team_agents",
    "team_agents_cached",
    "team_agent_usage",
    "team_home",
    "team_cal",
    "team_cal_cached",
    "team_locker_list",
    "team_locker_cached",
    "team_locker_peek",
    "team_peek_state",
    "team_posts",
    "team_profiles",
    "team_ui_invites",
    "team_ui_all_room",
    "e2e_self_number",
    "e2e_card_ready",
    "e2e_card_open",
    "e2e_safety_people",
    "e2e_recover_state",
    "e2e_self_step",
];

const CMD_SRC: &[(&str, &str)] = &[
    ("team_ui.rs", include_str!("team_ui.rs")),
    ("team_cmd.rs", include_str!("team_cmd.rs")),
    ("team_locker_cmd.rs", include_str!("team_locker_cmd.rs")),
    ("team_home_cmd.rs", include_str!("team_home_cmd.rs")),
    ("team_app_cmd.rs", include_str!("team_app_cmd.rs")),
    ("team_post_cmd.rs", include_str!("team_post_cmd.rs")),
    ("team_profile_cmd.rs", include_str!("team_profile_cmd.rs")),
    ("team_agent_cmd.rs", include_str!("team_agent_cmd.rs")),
    ("e2e_cmd.rs", include_str!("e2e_cmd.rs")),
];

/// (파일, 명령 이름, 몸통)
fn commands() -> Vec<(&'static str, String, String)> {
    let mut out = vec![];
    for (file, src) in CMD_SRC {
        for part in src.split("#[tauri::command]").skip(1) {
            let at = part.find("fn ").unwrap() + 3;
            let name: String = part[at..].chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
            let body = part[..part.find("\n}\n").unwrap_or(part.len())].to_string();
            out.push((*file, name, body));
        }
    }
    out
}

#[test]
fn 사람이_누른_팀_명령은_human_job_저절로_불리는_목록만_bg_job() {
    let cmds = commands();
    assert!(cmds.len() > 50, "명령을 못 읽었어: {}", cmds.len());
    for name in BG_CMDS {
        let (_, _, body) = cmds.iter().find(|(_, n, _)| n == name).unwrap_or_else(|| panic!("{name} 이 없어 — 목록을 고쳐"));
        assert!(body.contains("bg_job("), "{name} 은 저절로 불려 bg_job 으로");
    }
    for (file, name, body) in &cmds {
        if body.contains("bg_job(") {
            assert!(BG_CMDS.contains(&name.as_str()), "{file} {name}: 사람이 누르는 명령이 배경 몫을 센다 — human_job 으로(저절로 불리면 BG_CMDS 에)");
        }
        assert!(!body.contains("spawn_blocking") || !body.contains("relay::Curl") && !body.contains("team_relay_keys::store"), "{file} {name}: 중계는 human_job·bg_job 으로만");
    }
    // 입구를 모듈마다 따로 두지 않는다 — 진짜 curl 을 쥐는 곳은 사람 입구(as_human) 안뿐
    for (file, src) in CMD_SRC {
        assert!(!src.contains("async fn job") && !src.contains("async fn manage"), "{file}: 뒤 스레드 입구를 따로 두지 마 — team_relay::human_job·bg_job");
        for (i, _) in src.match_indices("relay::Curl") {
            let from = src[..i].rfind("\n}\n").unwrap_or(0);
            let to = i + src[i..].find("\n}\n").unwrap_or(src.len() - i);
            let chunk = &src[from..to];
            assert!(chunk.contains("as_human") || chunk.contains("impl Wire for RealWire"), "{file}: 입구 밖에서 relay::Curl 을 쥔다 —\n{chunk}");
        }
    }
}

#[test]
fn 경로_모양은_id_칸을_뭉갠다() {
    assert_eq!(path_shape("/v0/teams/7f3c-9a1e-44b2/locker/f_9Ab/0?x=1"), "/v0/teams/*/locker/*/*");
    assert_eq!(path_shape("/v0/me/self"), "/v0/me/self");
    assert_eq!(path_shape("/v0/key-probe"), "/v0/key-probe");
}

#[test]
fn 배경이_처음_막힌_때_경로별_셈_한_줄만() {
    let (key, t) = ("tally-test-key", 9 * BUCKET_MS + 5);
    for _ in 0..3 {
        assert_eq!(tally(key, t, "GET", "/v0/teams/abc123/locker", false, true), None);
    }
    assert_eq!(tally(key, t, "POST", "/v0/teams/abc123/rooms", true, true), None, "사람 동작은 줄을 안 남긴다");
    let line = tally(key, t, "GET", "/v0/teams/abc123/posts", false, false).expect("처음 막힘");
    assert!(line.contains("GET /v0/teams/*/locker 3") && line.contains("사람 POST /v0/teams/*/rooms 1") && line.contains("막힘 GET /v0/teams/*/posts 1"), "{line}");
    assert!(!line.contains("abc123"), "id 는 안 남긴다: {line}");
    assert_eq!(tally(key, t, "GET", "/v0/teams/abc123/posts", false, false), None, "칸마다 한 번");
    assert!(tally(key, t + BUCKET_MS, "GET", "/v0/me", false, false).unwrap().contains("막힘 GET /v0/me 1"), "다음 칸은 새로 센다");
}

// ── 401 물러서기(10-31 운영 24시간: 요청의 약 절반이 401 — 서버가 모르는 기기가 허용 기다림 화면에서 2초마다 두드렸다) ──

#[test]
fn 기기_서명이_401_을_받으면_배경_요청은_물러서고_사람_동작은_간다() {
    let (d, kc, r) = logged_in("deny-back");
    r.devices.borrow_mut().clear(); // 서버가 이 기기를 모른다 → 기기 머리 요청은 401
    let st = load_state(&d);
    let k = device_keys(&kc, &st).unwrap();
    let n0 = r.seen.borrow().len();
    for _ in 0..5 {
        assert_eq!(call(&r, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/self", None).unwrap().0, 401);
    }
    assert_eq!(r.seen.borrow().len() - n0, 1, "첫 401 뒤 물러서는 동안은 서버에 안 간다");
    assert_eq!(as_human(|| call(&r, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/self", None)).unwrap().0, 401);
    assert_eq!(r.seen.borrow().len() - n0, 2, "사람이 누른 건 물러서기를 안 탄다");
}

#[test]
fn 물러서기는_2초부터_두_배씩_5분까지() {
    let s = |n| denied_wait(n).as_secs();
    assert_eq!((s(1), s(2), s(3), s(4)), (2, 4, 8, 16));
    assert_eq!((s(9), s(30)), (300, 300));
}

#[test]
fn 물러서던_열쇠도_서버가_받아_주면_바로_풀린다() {
    let (d, kc, r) = logged_in("deny-ok");
    let st = load_state(&d);
    let k = device_keys(&kc, &st).unwrap();
    let keep = r.devices.borrow().clone();
    r.devices.borrow_mut().clear();
    assert_eq!(call(&r, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/self", None).unwrap().0, 401);
    *r.devices.borrow_mut() = keep;
    r.answer("/v0/me/self", 200, "{}");
    assert_eq!(as_human(|| call(&r, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/self", None)).unwrap().0, 200);
    r.answer("/v0/me/self", 200, "{}");
    let n0 = r.seen.borrow().len();
    assert_eq!(call(&r, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/self", None).unwrap().0, 200);
    assert_eq!(r.seen.borrow().len() - n0, 1, "받아 준 뒤엔 배경도 바로 간다");
}

#[test]
fn 열쇠를_서버가_알고_시계가_맞으면_끊긴_기기로_적는다() {
    // 끊긴(revoked) 기기는 줄이 남아 열쇠 확인이 404 가 아니라 401 — 시계(Cloudflare /cdn-cgi/trace ts)가 맞으면 시계 탓이 아니다
    let (d, kc, r) = logged_in("gone-revoked");
    r.devices.borrow_mut().clear();
    r.answer(KEY_PROBE, 401, r#"{"error":"unauthorized"}"#);
    r.answer("/cdn-cgi/trace", 200, &format!("fl=1\nh=relay.test\nts={}.123\nvisit_scheme=https\n", now_ms() / 1000));
    let e = sync_rooms(&d, &kc, &r).unwrap_err();
    assert!(e.contains("다시 로그인"), "{e}");
    assert!(load_state(&d).revoked);
}

#[test]
fn 멀쩡한_기기가_401_을_한_번_받고_열쇠_확인도_401_이어도_다시_물어_보고_끊김으로_안_적는다() {
    // 10-31 리뷰: 열쇠 확인은 등록된 열쇠면 멀쩡한 기기에도 늘 401(chammo-relay index.ts) — 그것과 시계만으로 끊김을 적으면 멀쩡한 기기가 '다시 로그인'에 빠진다
    let (d, kc, r) = logged_in("gone-once");
    r.answer("/v0/me/rooms", 401, r#"{"error":"unauthorized"}"#); // 한 번만 튄 401(기기 줄은 그대로)
    r.answer(KEY_PROBE, 401, r#"{"error":"unauthorized"}"#);
    r.answer("/cdn-cgi/trace", 200, &format!("ts={}.5\n", now_ms() / 1000));
    r.answer("/v0/me/self", 200, "{}");
    let _ = sync_rooms(&d, &kc, &r);
    assert!(!load_state(&d).revoked, "기기 서명으로 다시 물어 200 이면 끊김이 아니다");
}

#[test]
fn 물러서는_동안의_가짜_401_로는_열쇠_확인도_끊김도_없다() {
    // 10-31 리뷰: 물러서기(DENIED) 중 배경 요청이 받는 401 은 서버 답이 아니다 — 그걸로 끊김을 가리면 시계가 막 고쳐진 멀쩡한 기기가 끊긴다
    let (d, kc, r) = logged_in("gone-local");
    let st = load_state(&d);
    let k = device_keys(&kc, &st).unwrap();
    note_denied(&k.public(), 401, std::time::Instant::now());
    r.answer(KEY_PROBE, 401, r#"{"error":"unauthorized"}"#);
    r.answer("/cdn-cgi/trace", 200, &format!("ts={}.5\n", now_ms() / 1000));
    r.answer("/v0/me/self", 401, r#"{"error":"unauthorized"}"#);
    assert!(sync_rooms(&d, &kc, &r).is_err());
    assert!(!load_state(&d).revoked);
    assert_eq!(r.seen.borrow().iter().filter(|(_, p, _, _)| p == KEY_PROBE).count(), 0, "가짜 401 로는 열쇠 확인도 안 보낸다");
}

#[test]
fn 시계가_틀렸거나_시계를_모르면_끊긴_기기로_안_적고_확인도_5분에_한_번() {
    for (tag, trace) in [("gone-skew", Some(now_ms() / 1000 - 600)), ("gone-notrace", None)] {
        let (d, kc, r) = logged_in(tag);
        r.devices.borrow_mut().clear();
        r.answer(KEY_PROBE, 401, r#"{"error":"unauthorized"}"#);
        if let Some(ts) = trace {
            r.answer("/cdn-cgi/trace", 200, &format!("ts={ts}.5\n"));
        }
        assert!(sync_rooms(&d, &kc, &r).unwrap_err().contains("시계"), "{tag}");
        assert!(!load_state(&d).revoked, "{tag}");
        let probes = || r.seen.borrow().iter().filter(|(_, p, _, _)| p == KEY_PROBE).count();
        assert_eq!(probes(), 1, "{tag}");
        let _ = sync_rooms(&d, &kc, &r);
        assert_eq!(probes(), 1, "{tag}: 열쇠 확인은 5분에 한 번");
    }
}

// ── 같이 받기(10-31 팀 홈 첫 열기: 글 30개 본문을 하나씩 차례로 → 운영 ≈ 8초) ──

/// 사본을 주는 가짜 — 동시에 몇 개가 도는지 센다
struct Par {
    now: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    max: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    forks: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}
impl Http for Par {
    fn send(&self, _: &str, url: &str, _: &[(String, String)], _: &[u8]) -> Result<(u16, String), String> {
        use std::sync::atomic::Ordering::SeqCst;
        let n = self.now.fetch_add(1, SeqCst) + 1;
        self.max.fetch_max(n, SeqCst);
        std::thread::sleep(std::time::Duration::from_millis(30));
        self.now.fetch_sub(1, SeqCst);
        Ok((200, url.to_string()))
    }
    fn fork(&self) -> Option<Box<dyn Http + Send>> {
        self.forks.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Some(Box::new(Par { now: self.now.clone(), max: self.max.clone(), forks: self.forks.clone() }))
    }
}

#[test]
fn 사본을_주는_클라이언트면_최대_6개씩_같이_받고_순서는_그대로() {
    let p = Par { now: Default::default(), max: Default::default(), forks: Default::default() };
    let items: Vec<String> = (0..20).map(|i| format!("/f{i}")).collect();
    let t = std::time::Instant::now();
    let got = par_map(&p, &items, PAR, |h, it| h.send("GET", it, &[], b"").unwrap().1);
    assert_eq!(got, items, "돌려주는 순서는 넣은 순서");
    let max = p.max.load(std::sync::atomic::Ordering::SeqCst);
    assert!((2..=PAR).contains(&max), "같이 돈 수 {max}");
    assert!(t.elapsed() < std::time::Duration::from_millis(20 * 30 / 2), "차례로(600ms)보다 빨라야 {:?}", t.elapsed());
}

#[test]
fn 사람_동작_안에서_같이_받으면_스레드에서도_사람_동작이다() {
    // 10-31 리뷰: HUMAN 은 스레드마다 따로라 같이 받기 스레드에선 배경으로 세어 — 글 지우기 안의 본문 받기가 배경 몫에 막혔다
    let p = Par { now: Default::default(), max: Default::default(), forks: Default::default() };
    let items: Vec<u8> = (0..12).collect();
    assert!(as_human(|| par_map(&p, &items, PAR, |_, _| human_now())).iter().all(|h| *h), "사람 동작 안이면 모든 칸이 사람");
    assert!(par_map(&p, &items, PAR, |_, _| human_now()).iter().all(|h| !*h), "배경이면 배경 그대로");
}

#[test]
fn 사본이_없는_클라이언트_시험_가짜는_차례로() {
    let r = FakeRelay::default();
    r.always("GET", "/x", 200, "{}");
    let items = vec!["/x".to_string(); 3];
    let got = par_map(&r, &items, PAR, |h, it| h.send("GET", &format!("{SERVER}{it}"), &[], b"").map(|x| x.0));
    assert_eq!(got.len(), 3);
}

// ── 예산 넘침 알림(10-31 사용자: 사람이 캡처를 보내기 전에 알아채게) — 앱 화면이 받아 '참모 앱' 담당 참모 입력칸에 [앱] 한 줄 ──

#[test]
fn 배경_몫을_처음_넘으면_알림_하나_경로별_셈과_같이() {
    let key = "alert-bg-key";
    let t = 11 * BUCKET_MS + 7;
    for _ in 0..BG_CAP {
        assert!(take_at(key, t, "GET", "/v0/teams/abc1/heads"));
    }
    assert!(!take_at(key, t, "GET", "/v0/teams/abc1/heads"), "몫을 넘으면 막힌다");
    let _ = take_at(key, t, "GET", "/v0/teams/abc1/heads");
    let a = take_alerts_for(key);
    assert_eq!(a.len(), 1, "칸마다 한 번: {a:?}");
    assert_eq!(a[0]["kind"], "bg-cap");
    assert!(a[0]["detail"].as_str().unwrap().contains("GET /v0/teams/*/heads 200"), "{a:?}");
    assert!(a[0].get("key").is_none(), "열쇠는 밖으로 안 낸다");
}

#[test]
fn 사람_동작이_서버_429_를_받으면_알림() {
    let (d, kc, r) = logged_in("alert-429");
    let st = load_state(&d);
    let k = device_keys(&kc, &st).unwrap();
    r.answer("/v0/teams/t1/rooms", 429, r#"{"error":"slow_down","retryAfter":60}"#);
    let (code, _) = as_human(|| call(&r, &st.server, &k, Some(&st.device_id), "POST", "/v0/teams/t1/rooms", Some(&serde_json::json!({})))).unwrap();
    assert_eq!(code, 429);
    let a = take_alerts_for(&k.public());
    assert_eq!(a.len(), 1, "{a:?}");
    assert_eq!((a[0]["kind"].as_str(), a[0]["detail"].as_str()), (Some("human-429"), Some("POST /v0/teams/*/rooms")));
}
