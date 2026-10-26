use super::*;
use crate::accounts_store::fake::Fake;
use crate::team_relay::register;
use crate::team_test_util::FakeRelay;

const SERVER: &str = "https://relay.test";

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-team-manage-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 옛 길 팀장(계정 없음) — 이미 있던 상태(지금은 create 가 ready 에서 막아 등록 길로 준비, ADR 0007 R8)
fn owner(tag: &str) -> (std::path::PathBuf, Fake, FakeRelay) {
    let d = dir(tag);
    let kc = Fake::default();
    let r = FakeRelay::default();
    r.answer("/v0/teams", 201, r#"{"teamId":"t1","memberId":"m1","deviceId":"d1"}"#);
    let st = register(&d, &kc, &r, SERVER, "/v0/teams", serde_json::json!({ "name": "샘플팀" }), "owner", "지수", "맥북").unwrap();
    let k = crate::team_relay_keys::load(&kc, &st.key_account).unwrap().unwrap();
    r.devices.borrow_mut().push(("d1".into(), k.public()));
    (d, kc, r)
}

#[test]
fn 팀_이름을_바꾸면_지금_팀과_팀_목록이_같이_바뀐다() {
    let (d, kc, r) = owner("rename");
    r.answer("/v0/teams/t1/name", 200, r#"{"name":"ACME"}"#);
    let st = rename(&d, &kc, &r, "", "  ACME ").unwrap();
    assert_eq!(st.team_name, "ACME");
    assert_eq!(st.teams[0].name, "ACME", "팀 목록에도");
    let (m, p, _, body) = r.seen.borrow().last().cloned().unwrap();
    assert_eq!((m.as_str(), p.as_str()), ("POST", "/v0/teams/t1/name"));
    assert_eq!(serde_json::from_str::<serde_json::Value>(&body).unwrap()["name"], "ACME");
    assert!(rename(&d, &kc, &r, "", "  ").is_err(), "빈 이름은 서버에 안 보낸다");
    assert!(rename(&d, &kc, &r, "", &"a".repeat(41)).is_err());
    assert!(rename(&d, &kc, &r, "없는팀", "x").is_err(), "모르는 팀은 안 보낸다");
}

#[test]
fn 안_쓴_초대를_보고_막는다() {
    let (d, kc, r) = owner("invites");
    r.answer("/v0/teams/t1/invites", 200, r#"{"invites":[{"id":"abcdef123456","createdAt":1,"expiresAt":2}]}"#);
    let l = invites(&d, &kc, &r, "").unwrap();
    assert_eq!(l.len(), 1);
    assert_eq!(l[0].id, "abcdef123456");
    r.answer("/v0/teams/t1/invites/revoke", 200, r#"{"revoked":3}"#);
    assert_eq!(revoke_invites(&d, &kc, &r, "t1").unwrap(), 3);
}

#[test]
fn 팀장이_아니면_사람이_읽는_이유() {
    let (d, kc, r) = owner("forbidden");
    r.answer("/v0/teams/t1/invites", 403, r#"{"error":"forbidden"}"#);
    assert!(invites(&d, &kc, &r, "").unwrap_err().contains("팀장"));
}

#[test]
fn 이름_바꾸기·초대_막기는_참모_스크립트로_못_부른다() {
    // 화면(team_ui_*)만 — scripts/team 요청 줄로는 안 들어온다
    for verb in ["rename", "invites", "invites-revoke"] {
        let line = serde_json::json!({ "action": "team", "id": "x1", "arg": { "verb": verb } }).to_string();
        assert!(crate::team_cmd::request(&line).is_none(), "{verb}");
    }
}
