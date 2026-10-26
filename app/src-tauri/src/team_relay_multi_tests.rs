//! 팀 여러 개(chammo-relay 계획 2026-10-24 e2e-multiteam 단계 A) — 계정 기기는 팀을 여럿, 옛 초대 기기는 하나
use super::*;
use crate::accounts_store::fake::Fake;
use crate::team_test_util::FakeRelay;

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-multi-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

const SERVER: &str = "https://relay.test";

/// 구글로 로그인한 기기(팀 없음)
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

/// 팀 둘 — 샘플팀(t1, 나 m1 팀장)·시험(t2, 나 m9 멤버). 지금 팀은 나중에 들어간 시험
fn two_teams(tag: &str) -> (std::path::PathBuf, Fake, FakeRelay) {
    let (d, kc, r) = logged_in(tag);
    r.answer("/v0/teams", 201, r#"{"teamId":"t1","memberId":"m1","deviceId":"d7"}"#);
    create(&d, &kc, &r, "", "샘플팀", "지수", "맥북").unwrap();
    r.answer("/v0/invites/redeem", 201, r#"{"teamId":"t2","teamName":"시험","memberId":"m9","deviceId":"d7"}"#);
    join(&d, &kc, &r, "", "CODE", "지수(시험)", "맥북").unwrap();
    (d, kc, r)
}

#[test]
fn 로그인한_기기는_팀을_둘_가지고_지금_팀은_나중_팀() {
    let (d, _, _) = two_teams("two");
    let st = load_state(&d);
    let got: Vec<_> = st.teams.iter().map(|t| (t.id.as_str(), t.name.as_str(), t.member_id.as_str(), t.role.as_str())).collect();
    assert_eq!(got, vec![("t1", "샘플팀", "m1", "owner"), ("t2", "시험", "m9", "member")]);
    assert_eq!((st.team_id.as_str(), st.member_id.as_str(), st.display_name.as_str()), ("t2", "m9", "지수(시험)"));
}

#[test]
fn 옛_초대_기기는_여전히_팀_하나() {
    let d = dir("legacy");
    let kc = Fake::default();
    let r = FakeRelay::default();
    // 이미 있던 옛 초대 기기 상태(지금은 create 가 ready 에서 막는다, R8) — 등록 길로 두 번째 팀은 거절
    r.answer("/v0/teams", 201, r#"{"teamId":"t1","memberId":"m1","deviceId":"d1"}"#);
    register(&d, &kc, &r, SERVER, "/v0/teams", serde_json::json!({ "name": "샘플팀" }), "owner", "지수", "맥북").unwrap();
    let e = register(&d, &kc, &r, SERVER, "/v0/teams", serde_json::json!({ "name": "둘째" }), "owner", "지수", "맥북").unwrap_err();
    assert!(e.contains("팀 하나"), "{e}");
}

#[test]
fn 옛_team_json_은_읽을_때_teams_로_옮겨진다() {
    let d = dir("migrate");
    std::fs::write(
        d.join(STATE_FILE),
        r#"{"server":"https://relay.test","keyAccount":"k","teamId":"t1","teamName":"샘플팀","memberId":"m1","deviceId":"d1","displayName":"지수","role":"owner","members":[{"id":"m1","displayName":"지수","role":"owner"}],"rooms":[{"id":"r1","kind":"dm","peer":"m2"}]}"#,
    )
    .unwrap();
    let st = load_state(&d);
    assert_eq!(st.teams.len(), 1);
    assert_eq!((st.teams[0].id.as_str(), st.teams[0].member_id.as_str(), st.teams[0].members.len()), ("t1", "m1", 1));
    assert_eq!(st.rooms[0].team, "t1", "팀 칸 없는 옛 DM 방은 그 하나뿐인 팀");
}

#[test]
fn 팀을_이름이나_id_로_골라_초대한다_모르는_팀은_목록과_함께_거절() {
    let (d, kc, r) = two_teams("pick");
    r.answer("/v0/teams/t1/invites", 201, r#"{"code":"C1","expiresAt":9}"#);
    assert_eq!(invite(&d, &kc, &r, "샘플팀").unwrap().code, "C1");
    r.answer("/v0/teams/t2/invites", 201, r#"{"code":"C2","expiresAt":9}"#);
    assert_eq!(invite(&d, &kc, &r, "").unwrap().code, "C2", "안 고르면 지금 팀");
    let e = invite(&d, &kc, &r, "없는팀").unwrap_err();
    assert!(e.contains("샘플팀") && e.contains("시험"), "{e}");
}

#[test]
fn 멤버_목록은_고른_팀에만_적고_이름표는_모든_팀에서_찾는다() {
    let (d, kc, r) = two_teams("members");
    r.answer("/v0/teams/t1/members", 200, r#"{"members":[{"id":"m1","displayName":"지수","role":"owner"},{"id":"m2","displayName":"민아","role":"member","devices":[{"id":"dx","name":"민아 아이맥"}]}]}"#);
    refresh_members(&d, &kc, &r, "샘플팀").unwrap();
    let st = load_state(&d);
    assert_eq!(st.teams[0].members.len(), 2);
    assert!(st.teams[1].members.is_empty(), "다른 팀 목록은 그대로");
    assert_eq!(st.member_name("m2"), Some("민아"), "지금 팀(시험)이 아니어도 이름을 찾는다");
    assert_eq!(st.device_label("dx").as_deref(), Some("민아 아이맥"));
}

#[test]
fn dm_은_고른_팀에서_열고_방에_팀을_적는다() {
    let (d, kc, r) = two_teams("dm");
    r.answer("/v0/teams/t1/members", 200, r#"{"members":[{"id":"m1","displayName":"지수","role":"owner"},{"id":"m2","displayName":"민아","role":"member"}]}"#);
    r.answer("/v0/teams/t1/dms", 201, r#"{"roomId":"r1"}"#);
    let room = open_dm(&d, &kc, &r, "샘플팀", "민아").unwrap();
    assert_eq!((room.id.as_str(), room.team.as_str(), room.peer.as_str()), ("r1", "t1", "m2"));
    assert!(open_dm(&d, &kc, &r, "샘플팀", "지수").is_err(), "그 팀의 나 자신과는 DM 없음");
}

#[test]
fn 방_목록의_dm_상대는_그_방_팀의_내_멤버_id_로_가린다() {
    // 팀마다 내 멤버 id 가 다르다 — 지금 팀(m9) 하나로 가리면 t1 DM 의 상대가 나(m1)로 잡혔다
    let (d, kc, r) = two_teams("sync");
    r.answer("/v0/me/rooms", 200, r#"{"rooms":[{"roomId":"r1","kind":"dm","teamId":"t1","memberIds":["m1","m2"]},{"roomId":"r2","kind":"dm","teamId":"t2","memberIds":["m3","m9"]},{"roomId":"rs","kind":"self","teamId":null,"memberIds":[]}]}"#);
    let st = sync_rooms(&d, &kc, &r).unwrap();
    let got: Vec<_> = st.rooms.iter().map(|x| (x.id.as_str(), x.team.as_str(), x.peer.as_str())).collect();
    assert_eq!(got, vec![("r1", "t1", "m2"), ("r2", "t2", "m3"), ("rs", "", "")]);
    assert!(st.is_me("m1") && st.is_me("m9") && !st.is_me("m2"));
}

#[test]
fn 나가기는_그_팀과_그_팀_방만_지우고_지금_팀을_남은_팀으로() {
    let (d, kc, r) = two_teams("leave");
    mutate(&d, |s| {
        s.rooms = vec![
            Room { id: "r1".into(), kind: "dm".into(), peer: "m2".into(), team: "t1".into(), ..Default::default() },
            Room { id: "r2".into(), kind: "dm".into(), peer: "m3".into(), team: "t2".into(), ..Default::default() },
        ]
    })
    .unwrap();
    r.answer("/v0/teams/t2/leave", 200, r#"{"ok":true}"#);
    let st = leave(&d, &kc, &r, "시험").unwrap();
    assert_eq!(st.teams.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["t1"]);
    assert_eq!(st.rooms.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["r1"]);
    assert_eq!((st.team_id.as_str(), st.member_id.as_str()), ("t1", "m1"), "지금 팀은 남은 팀");
}

#[test]
fn 마지막_팀장은_못_나간다는_이유를_사람_말로() {
    let (d, kc, r) = two_teams("last-owner");
    r.answer("/v0/teams/t1/leave", 409, r#"{"error":"last_owner"}"#);
    let e = leave(&d, &kc, &r, "샘플팀").unwrap_err();
    assert!(e.contains("마지막 팀장"), "{e}");
    assert_eq!(load_state(&d).teams.len(), 2, "실패하면 그대로");
}

#[test]
fn 빼기와_팀장_바꾸기는_고른_팀의_사람으로() {
    let (d, kc, r) = two_teams("kick");
    r.answer("/v0/teams/t1/members", 200, r#"{"members":[{"id":"m1","displayName":"지수","role":"owner"},{"id":"m2","displayName":"민아","role":"member"}]}"#);
    refresh_members(&d, &kc, &r, "샘플팀").unwrap();
    r.answer("/v0/teams/t1/members/m2/role", 200, r#"{"ok":true}"#);
    r.answer("/v0/teams/t1/members", 200, r#"{"members":[{"id":"m1","displayName":"지수","role":"owner"},{"id":"m2","displayName":"민아","role":"owner"}]}"#);
    let st = set_role(&d, &kc, &r, "샘플팀", "민아", "owner").unwrap();
    assert_eq!(st.teams[0].members[1].role, "owner");
    r.answer("/v0/teams/t1/members/m2/remove", 200, r#"{"ok":true}"#);
    r.answer("/v0/teams/t1/members", 200, r#"{"members":[{"id":"m1","displayName":"지수","role":"owner"}]}"#);
    let st = remove_member(&d, &kc, &r, "샘플팀", "민아").unwrap();
    assert_eq!(st.teams[0].members.len(), 1);
    let b = r.seen.borrow();
    assert!(b.iter().any(|(m, p, _, body)| m == "POST" && p == "/v0/teams/t1/members/m2/role" && body.contains("\"owner\"")));
    drop(b);
    assert!(set_role(&d, &kc, &r, "샘플팀", "지수", "king").is_err(), "모르는 역할");
}

#[test]
fn 팀_고르기는_다음_명령의_기본_팀을_바꾼다() {
    let (d, _, _) = two_teams("use");
    let st = use_team(&d, "샘플팀").unwrap();
    assert_eq!((st.team_id.as_str(), st.member_id.as_str(), st.role.as_str(), st.team_name.as_str()), ("t1", "m1", "owner", "샘플팀"));
    assert!(use_team(&d, "없음").is_err());
}

#[test]
fn 계정_갱신은_서버의_팀을_모두_담고_서버에_없는_팀은_지운다() {
    let (d, kc, r) = two_teams("refresh");
    r.answer("/v0/me", 200, r#"{"account":{"id":"a1","email":"me@example.com","name":"지수"},"device":{"id":"d7","name":"맥북"},"teams":[{"memberId":"m1","teamId":"t1","name":"샘플팀","role":"owner"},{"memberId":"m5","teamId":"t5","name":"새팀","role":"member"}]}"#);
    r.answer("/v0/me/devices", 200, r#"{"devices":[]}"#);
    let st = crate::team_account::refresh_me(&d, &kc, &r).unwrap();
    assert_eq!(st.teams.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["t1", "t5"]);
    assert_eq!(st.team_id, "t1", "지금 팀(t2)이 없어졌으면 첫 팀으로");
}

#[test]
fn 팀_지우기는_팀장만_서버에서_지운_뒤_이_기기_목록에서도_뺀다() {
    // 부채 ⑧(1025 B') — 혼자 남은 팀장이 명부 없는 옛 팀을 지울 길이 없었다
    let (d, kc, r) = two_teams("delete");
    let e = delete_team(&d, &kc, &r, "t2").unwrap_err();
    assert!(e.contains("팀장"), "멤버인 팀은 못 지운다: {e}");
    assert!(!r.seen.borrow().iter().any(|(_, p, _, _)| p.ends_with("/delete")), "요청도 없이");
    r.answer("/v0/teams/t1/delete", 200, r#"{"ok":true}"#);
    let st = delete_team(&d, &kc, &r, "t1").unwrap();
    assert!(r.seen.borrow().iter().any(|(m, p, _, _)| m == "POST" && p == "/v0/teams/t1/delete"));
    assert_eq!(st.teams.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["t2"]);
    // 서버가 거절하면 목록은 그대로
    r.answer("/v0/teams/t2/delete", 403, r#"{"error":"forbidden"}"#);
    mutate(&d, |s| s.teams[0].role = "owner".into()).unwrap();
    assert!(delete_team(&d, &kc, &r, "t2").is_err());
    assert_eq!(load_state(&d).teams.len(), 1);
}

#[test]
fn 팀_지우기는_화면_길만_scripts_team_엔_없다() {
    // 되돌릴 수 없어서 사람 손(팀 설정 확인 창)으로만 — 참모 길 낱말이 없다
    for verb in ["delete", "team-delete", "delete-team", "remove-team"] {
        assert!(crate::team_cmd::request(&serde_json::json!({ "id": "a1", "verb": verb }).to_string()).is_none(), "{verb}");
    }
    let srcs = [include_str!("team_cmd.rs"), include_str!("appctl.rs"), include_str!("mobile.rs"), include_str!("mobile_http.rs"), include_str!("team_relay_ws.rs")];
    assert!(srcs.iter().all(|s| !s.contains("delete_team(")), "팀 지우기는 team_ui 화면 명령에서만");
}

#[test]
fn 팀_지우기는_팀_id_로만_이미_지운_팀_id_로는_다시_안_간다() {
    // 같은 이름 팀 둘: 한 팀을 지우면 지금 팀이 같은 이름의 다른 팀으로 바뀐다 — 이름으로 다시 지우면 엉뚱한 팀이 지워진다
    let (d, kc, r) = two_teams("delete-by-id");
    mutate(&d, |s| s.teams[1].role = "owner".into()).unwrap();
    assert!(delete_team(&d, &kc, &r, "").unwrap_err().contains("팀 id"), "빈 글(= 지금 팀)로는 안 지운다");
    assert!(delete_team(&d, &kc, &r, "샘플팀").unwrap_err().contains("팀 id"), "이름으로는 안 지운다(같은 이름 팀)");
    r.answer("/v0/teams/t1/delete", 200, r#"{"ok":true}"#);
    delete_team(&d, &kc, &r, "t1").unwrap();
    let n = r.seen.borrow().len();
    assert!(delete_team(&d, &kc, &r, "t1").unwrap_err().contains("이미 지운"), "지운 팀 id 로 또");
    assert_eq!(r.seen.borrow().len(), n, "요청도 없이");
    assert_eq!(load_state(&d).teams.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["t2"], "남은 팀은 그대로");
}
