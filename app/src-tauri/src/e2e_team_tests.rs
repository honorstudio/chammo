use super::*;
use crate::accounts_store::fake::Fake;
use crate::e2e_chain::{self, Chain, Link};
use crate::e2e_roster;
use crate::team_relay::{mutate, Account, TeamEntry};
use crate::team_test_util::FakeRelay;
use std::collections::BTreeMap;

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-e2eteam-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 계정 acc 의 기기 id — 팀 t1 의 멤버 member
fn device(tag: &str, id: &str, acc: &str, member: &str, r: &FakeRelay) -> (std::path::PathBuf, Fake, DeviceKeys) {
    let d = dir(tag);
    let kc = Fake::default();
    let (k, key_acct) = crate::team_relay_keys::create(&kc).unwrap();
    r.devices.borrow_mut().push((id.into(), k.public()));
    mutate(&d, |s| {
        s.server = "https://relay.test".into();
        s.key_account = key_acct;
        s.device_id = id.into();
        s.account = Some(Account { id: acc.into(), ..Default::default() });
        s.put_team(TeamEntry { id: "t1".into(), name: "샘플팀".into(), member_id: member.into(), role: "owner".into(), display_name: "사용자".into(), members: vec![] });
        s.select_current("t1");
    })
    .unwrap();
    // 이 기기가 내 사슬에 든 상태(ensure 가 받아 둔 캐시)
    let body = json!({ "v": 1, "account": acc, "seq": 0, "prev": "", "by": id, "kind": "genesis", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    let g = Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{body}")), body };
    crate::e2e_state::seed_trusted(&d, acc, vec![g]);
    (d, kc, k)
}

fn chain(acc: &str, k: &DeviceKeys, id: &str) -> Chain {
    let body = json!({ "v": 1, "account": acc, "seq": 0, "prev": "", "by": id, "kind": "genesis", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    e2e_chain::verify(acc, &[Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{body}")), body }]).unwrap()
}

/// 서버에 보낸 명부 고리들(보낸 차례)
fn posted(r: &FakeRelay) -> Vec<TLink> {
    r.seen.borrow().iter().filter(|(m, p, _, _)| m == "POST" && p == "/v0/teams/t1/log").map(|(_, _, _, b)| serde_json::from_value(serde_json::from_str::<Value>(b).unwrap()["link"].clone()).unwrap()).collect()
}

fn answer_log(r: &FakeRelay, links: &[TLink]) {
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": links }).to_string());
}

#[test]
fn 만들기·초대·들어오기_고리는_받는_쪽_명부_검증을_지난다() {
    let r = FakeRelay::default();
    let (od, okc, ok) = device("owner", "o1", "a1", "m1", &r);
    let (jd, jkc, jk) = device("joiner", "c1", "a2", "m2", &r);
    r.answer("/v0/teams/t1/log", 201, "{}");
    after_create(&od, &okc, &r, "t1", "m1", "사용자", "샘플팀").unwrap();
    let mut links = posted(&r);
    answer_log(&r, &links);
    r.answer("/v0/teams/t1/log", 201, "{}");
    after_invite(&od, &okc, &r, "t1", "CODE-XYZ", 99).unwrap();
    links = posted(&r);
    answer_log(&r, &links);
    r.answer("/v0/teams/t1/log", 201, "{}");
    after_join(&jd, &jkc, &r, "t1", "CODE-XYZ", "m2", "철수").unwrap();
    links = posted(&r);
    let chains = BTreeMap::from([("a1".to_string(), chain("a1", &ok, "o1")), ("a2".to_string(), chain("a2", &jk, "c1"))]);
    let roster = e2e_roster::verify("t1", &links, &chains).expect("명부 검증");
    assert_eq!(roster.active().map(|(m, x)| (m.as_str(), x.display_name.as_str())).collect::<Vec<_>>(), vec![("m1", "사용자"), ("m2", "철수")]);
}

#[test]
fn 역할·빼기·나가기_고리는_명부가_있을_때만() {
    let r = FakeRelay::default();
    let (od, okc, _) = device("role", "o1", "a1", "m1", &r);
    r.answer("/v0/teams/t1/log", 200, r#"{"links":[]}"#);
    assert_eq!(link_for(&od, &okc, &r, "t1", json!({ "kind": "role", "member": "m2", "role": "owner" })).unwrap(), None);
    r.answer("/v0/teams/t1/log", 201, "{}");
    after_create(&od, &okc, &r, "t1", "m1", "사용자", "샘플팀").unwrap();
    answer_log(&r, &posted(&r));
    let l = link_for(&od, &okc, &r, "t1", json!({ "kind": "role", "member": "m2", "role": "owner" })).unwrap().unwrap();
    let b: Value = serde_json::from_str(l["body"].as_str().unwrap()).unwrap();
    assert_eq!((b["seq"].as_u64(), b["kind"].as_str()), (Some(1), Some("role")));
    assert_eq!(b["prev"], team_hash(&posted(&r)[0]));
}

#[test]
fn 사슬에_든_게_저장_안_된_기기는_요청도_없이_지나간다() {
    let r = FakeRelay::default();
    let (od, okc, _) = device("nochain", "o1", "a1", "m1", &r);
    std::fs::remove_file(od.join(crate::e2e_state::FILE)).unwrap();
    after_create(&od, &okc, &r, "t1", "m1", "사용자", "샘플팀").unwrap();
    assert!(r.seen.borrow().is_empty());
}

#[test]
fn 사슬_밖_기기는_고리_없이_지나간다() {
    let r = FakeRelay::default();
    let (od, okc, _) = device("outside", "o1", "a1", "m1", &r);
    r.answer("/v0/teams/t1/log", 403, r#"{"error":"not_in_chain"}"#);
    assert!(after_create(&od, &okc, &r, "t1", "m1", "사용자", "샘플팀").is_ok());
}

#[test]
fn 팀장_바꾸기는_명부가_있으면_고리를_같이_싣는다() {
    let r = FakeRelay::default();
    let (od, okc, _) = device("setrole", "o1", "a1", "m1", &r);
    let members = json!({ "members": [{ "id": "m1", "displayName": "사용자", "role": "owner" }, { "id": "m2", "displayName": "철수", "role": "member" }] }).to_string();
    r.answer("/v0/teams/t1/log", 201, "{}");
    after_create(&od, &okc, &r, "t1", "m1", "사용자", "샘플팀").unwrap();
    r.answer("/v0/teams/t1/members", 200, &members);
    answer_log(&r, &posted(&r));
    r.answer("/v0/teams/t1/members/m2/role", 200, r#"{"ok":true}"#);
    r.answer("/v0/teams/t1/members", 200, &members.replace("\"member\"}]", "\"owner\"}]"));
    crate::team_relay::set_role(&od, &okc, &r, "t1", "철수", "owner").unwrap();
    let seen = r.seen.borrow();
    let (_, _, _, b) = seen.iter().find(|(_, p, _, _)| p == "/v0/teams/t1/members/m2/role").unwrap();
    let v: Value = serde_json::from_str(b).unwrap();
    assert_eq!(v["role"], "owner");
    assert!(v["link"]["body"].as_str().unwrap().contains("\"kind\":\"role\""));
}
