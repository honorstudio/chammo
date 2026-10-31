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

// ── 팀 권한 새 판(relay ADR 0014) ──

fn with_log(tag: &str, r: &FakeRelay) -> (std::path::PathBuf, Fake) {
    let (od, okc, _) = device(tag, "o1", "a1", "m1", r);
    let members = json!({ "members": [{ "id": "m1", "displayName": "사용자", "role": "owner" }, { "id": "m2", "displayName": "철수", "role": "member" }] }).to_string();
    r.answer("/v0/teams/t1/log", 201, "{}");
    after_create(&od, &okc, r, "t1", "m1", "사용자", "샘플팀").unwrap();
    r.always("GET", "/v0/teams/t1/members", 200, &members);
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": posted(r) }).to_string());
    (od, okc)
}

fn sent(r: &FakeRelay, path: &str) -> Value {
    let seen = r.seen.borrow();
    let (_, _, _, b) = seen.iter().rev().find(|(m, p, _, _)| m == "POST" && p == path).expect("보냈다");
    serde_json::from_str(b).unwrap()
}

#[test]
fn 매니저_권한은_한_가지_모양으로_고리와_함께() {
    let r = FakeRelay::default();
    let (od, okc) = with_log("perms", &r);
    r.answer("/v0/teams/t1/members/m2/role", 200, r#"{"ok":true}"#);
    crate::team_relay::set_perms(&od, &okc, &r, "t1", "철수", &["kick".into(), "invite".into(), "kick".into()]).unwrap();
    let v = sent(&r, "/v0/teams/t1/members/m2/role");
    assert_eq!((v["role"].clone(), v["perms"].clone()), (json!("manager"), json!(["invite", "kick"])));
    let b: Value = serde_json::from_str(v["link"]["body"].as_str().unwrap()).unwrap();
    assert_eq!((b["role"].clone(), b["perms"].clone()), (json!("manager"), json!(["invite", "kick"])));
    // 빈 목록 = 팀원으로 — perms 칸 없이
    r.answer("/v0/teams/t1/members/m2/role", 200, r#"{"ok":true}"#);
    crate::team_relay::set_perms(&od, &okc, &r, "t1", "철수", &[]).unwrap();
    let v = sent(&r, "/v0/teams/t1/members/m2/role");
    assert_eq!(v["role"], "member");
    assert!(v.get("perms").is_none() && !v["link"]["body"].as_str().unwrap().contains("perms"));
    assert!(crate::team_relay::set_perms(&od, &okc, &r, "t1", "철수", &["delete_team".into()]).is_err());
}

#[test]
fn 팀장_넘기기는_from_을_실어_보내고_옛_서버면_예전_팀장_올리기로() {
    let r = FakeRelay::default();
    let (od, okc) = with_log("transfer", &r);
    r.answer("/v0/teams/t1/transfer", 200, r#"{"ok":true}"#);
    crate::team_relay::transfer_owner(&od, &okc, &r, "t1", "철수").unwrap();
    let v = sent(&r, "/v0/teams/t1/transfer");
    assert_eq!(v["member"], "m2");
    let b: Value = serde_json::from_str(v["link"]["body"].as_str().unwrap()).unwrap();
    assert_eq!((b["kind"].clone(), b["role"].clone(), b["from"].clone()), (json!("role"), json!("owner"), json!("m1")));
    // 스위치 꺼진 서버 — 예전 길(팀장 올리기)로
    r.answer("/v0/teams/t1/transfer", 400, r#"{"error":"roles_off"}"#);
    r.answer("/v0/teams/t1/members/m2/role", 200, r#"{"ok":true}"#);
    r.answer("/v0/teams/t1/members/m1/role", 200, r#"{"ok":true}"#);
    crate::team_relay::transfer_owner(&od, &okc, &r, "t1", "철수").unwrap();
    assert_eq!(sent(&r, "/v0/teams/t1/members/m2/role")["role"], "owner");
    // '넘기기'라서 나는 내려온다 — 팀장이 둘로 남지 않게(손 시험 ⑤, 10-30)
    assert_eq!(sent(&r, "/v0/teams/t1/members/m1/role")["role"], "member");
}

/// 요청 하나(POST path) 앞에 GET log 가 몇 번 갔나 — from 번째 요청부터
fn logs_before(r: &FakeRelay, from: usize, post: &str) -> usize {
    let seen = r.seen.borrow();
    let tail = &seen[from..];
    let at = tail.iter().position(|(m, p, _, _)| m == "POST" && p == post).expect("보냈다");
    tail[..at].iter().filter(|(m, p, _, _)| m == "GET" && p == "/v0/teams/t1/log").count()
}

#[test]
fn 쓰기_전_명부는_확인해_둔_끝으로_서버가_다르다_하면_새로_받아_한_번_더() {
    // 10-31 실측: 권한 칩 하나에 GET log → POST role → GET members 를 차례로(운영 ≈ 0.75초) — 쓰기 전 GET log 는 확인해 둔 명부로 갈음
    let r = FakeRelay::default();
    let (od, okc) = with_log("tip", &r);
    crate::e2e_state::mutate(&od, |s| {
        s.rosters.insert("t1".into(), posted(&r));
    })
    .unwrap();
    let post = "/v0/teams/t1/members/m2/role";
    let n = r.seen.borrow().len();
    r.answer(post, 200, r#"{"ok":true}"#);
    crate::team_relay::set_perms(&od, &okc, &r, "t1", "철수", &["invite".into()]).unwrap();
    assert_eq!(logs_before(&r, n, post), 0, "쓰기 전에 명부를 다시 안 받는다");
    // 서버 명부가 그새 늘었다 — 409 stale_head 면 명부를 새로 받아 한 번 더
    let n = r.seen.borrow().len();
    r.answer(post, 409, r#"{"error":"stale_head"}"#);
    r.answer(post, 200, r#"{"ok":true}"#);
    crate::team_relay::set_perms(&od, &okc, &r, "t1", "철수", &["kick".into()]).unwrap();
    let posts = r.seen.borrow()[n..].iter().filter(|(m, p, _, _)| m == "POST" && p == post).count();
    assert_eq!(posts, 2, "한 번 더 보냈다");
    assert_eq!(sent(&r, post)["perms"], json!(["kick"]));
}

#[test]
fn 초대_고리도_확인해_둔_명부_끝으로_다르면_새로_받아_한_번_더() {
    let r = FakeRelay::default();
    let (od, okc) = with_log("tip-inv", &r);
    crate::e2e_state::mutate(&od, |s| {
        s.rosters.insert("t1".into(), posted(&r));
    })
    .unwrap();
    let n = r.seen.borrow().len();
    r.answer("/v0/teams/t1/log", 201, "{}");
    after_invite(&od, &okc, &r, "t1", "code-1", 1).unwrap();
    assert_eq!(logs_before(&r, n, "/v0/teams/t1/log"), 0, "초대 고리 전에 명부를 다시 안 받는다");
    let n = r.seen.borrow().len();
    // 가짜 중계의 줄 선 답은 방법을 안 가린다 — POST 409 → GET log(명부) → POST 201 차례로
    r.answer("/v0/teams/t1/log", 409, r#"{"error":"stale_head"}"#);
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": posted(&r) }).to_string());
    r.answer("/v0/teams/t1/log", 201, "{}");
    after_invite(&od, &okc, &r, "t1", "code-2", 1).unwrap();
    let posts = r.seen.borrow()[n..].iter().filter(|(m, p, _, _)| m == "POST" && p == "/v0/teams/t1/log").count();
    assert_eq!(posts, 2, "409 면 새로 받아 한 번 더");
}

#[test]
fn 내가_쓴_고리가_받아들여지면_기억한_명부_끝에_붙여_다음_쓰기도_명부를_안_받는다() {
    // 10-31 고친 판 실측: 칩 다음 초대가 매번 409 → GET log → 한 번 더(요청 3 → 4) — 내 고리를 기억한 명부에 안 붙였다
    let r = FakeRelay::default();
    let (od, okc) = with_log("tip-chain", &r);
    crate::e2e_state::mutate(&od, |s| {
        s.rosters.insert("t1".into(), posted(&r));
    })
    .unwrap();
    let n = r.seen.borrow().len();
    r.answer("/v0/teams/t1/members/m2/role", 200, r#"{"ok":true}"#);
    crate::team_relay::set_perms(&od, &okc, &r, "t1", "철수", &["invite".into()]).unwrap();
    r.answer("/v0/teams/t1/log", 201, "{}");
    after_invite(&od, &okc, &r, "t1", "code-9", 1).unwrap();
    r.answer("/v0/teams/t1/members/m2/role", 200, r#"{"ok":true}"#);
    crate::team_relay::set_perms(&od, &okc, &r, "t1", "철수", &[]).unwrap();
    let seen = r.seen.borrow();
    let logs = seen[n..].iter().filter(|(m, p, _, _)| m == "GET" && p == "/v0/teams/t1/log").count();
    assert_eq!(logs, 0, "쓰기 셋 동안 명부를 다시 안 받는다");
    let roster = crate::e2e_state::load(&od).rosters["t1"].clone();
    assert_eq!(roster.len(), 4, "첫 고리 + 내가 쓴 셋(권한·초대·권한) — 서버가 그 고리들로 명부를 늘렸다");
    let rs: Vec<u64> = roster.iter().map(|l| l.seq).collect();
    assert_eq!(rs, (0..rs.len() as u64).collect::<Vec<_>>(), "seq 가 이어진다");
}
