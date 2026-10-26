use super::*;
use crate::accounts_store::fake::Fake;
use crate::e2e_chain::{self, Chain, Link};
use crate::e2e_roster::{self, team_hash, TLink};
use crate::team_relay::{mutate, Account, Member};
use crate::team_relay_keys::DeviceKeys;
use crate::team_test_util::FakeRelay;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use std::collections::BTreeMap;

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-rooms-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn gen(acc: &str, k: &DeviceKeys, id: &str) -> Link {
    let body = json!({ "v": 1, "account": acc, "seq": 0, "prev": "", "by": id, "kind": "genesis", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{body}")), body }
}

fn other(n: u8) -> DeviceKeys {
    DeviceKeys::from_seeds([n; 32], [n.wrapping_add(100); 32])
}

/// 나(사용자, 계정 a1, 기기 o1, 멤버 m1) — 팀 t1 에 철수(m2)·민수(m3)
fn me(tag: &str, r: &FakeRelay) -> (std::path::PathBuf, Fake, DeviceKeys) {
    let d = dir(tag);
    let kc = Fake::default();
    let (k, key_acct) = crate::team_relay_keys::create(&kc).unwrap();
    r.devices.borrow_mut().push(("o1".into(), k.public()));
    let m = |id: &str, n: &str| Member { id: id.into(), display_name: n.into(), role: "member".into(), devices: vec![] };
    mutate(&d, |s| {
        s.server = "https://relay.test".into();
        s.key_account = key_acct;
        s.device_id = "o1".into();
        s.account = Some(Account { id: "a1".into(), ..Default::default() });
        s.put_team(TeamEntry { id: "t1".into(), name: "샘플팀".into(), member_id: "m1".into(), role: "owner".into(), display_name: "사용자".into(), members: vec![m("m1", "사용자"), m("m2", "철수"), m("m3", "민수")] });
        s.select_current("t1");
    })
    .unwrap();
    crate::e2e_state::seed_trusted(&d, "a1", vec![gen("a1", &k, "o1")]);
    (d, kc, k)
}

fn tl(by: &DeviceKeys, by_id: &str, seq: u64, prev: &str, f: Value) -> TLink {
    let mut b = json!({ "v": 1, "team": "t1", "seq": seq, "prev": prev, "by": by_id });
    b.as_object_mut().unwrap().extend(f.as_object().unwrap().clone());
    let body = b.to_string();
    TLink { seq, sig: by.sign(&format!("chammo-team/1\n{body}")), body, sig2: None }
}

fn join(code: &str, k: &DeviceKeys, id: &str, seq: u64, prev: &TLink, owner: &DeviceKeys, member: &str, acc: &str, name: &str) -> [TLink; 2] {
    let ck = SigningKey::from_bytes(&e2e_roster::invite_seed(code));
    let pk = B64.encode(ck.verifying_key().as_bytes());
    let i = tl(owner, "o1", seq, &team_hash(prev), json!({ "kind": "invite", "invPub": pk, "role": "member", "expires": 1 }));
    let mut j = tl(k, id, seq + 1, &team_hash(&i), json!({ "kind": "join", "invPub": pk, "member": member, "account": acc, "displayName": name }));
    j.sig2 = Some(B64.encode(ck.sign(format!("chammo-team/1\n{}", j.body).as_bytes()).to_bytes()));
    [i, j]
}

/// 팀 시작(나) · 철수(c1) · 민수(q1) 들어옴
fn roster(k: &DeviceKeys) -> Vec<TLink> {
    let t = tl(k, "o1", 0, "", json!({ "kind": "team", "name": "샘플팀", "member": "m1", "account": "a1", "displayName": "사용자" }));
    let mut ls = vec![t];
    let [i, j] = join("C2", &other(2), "c1", 1, &ls[0], k, "m2", "a2", "철수");
    ls.extend([i, j]);
    let [i, j] = join("C3", &other(3), "q1", 3, &ls[2], k, "m3", "a3", "민수");
    ls.extend([i, j]);
    ls
}

fn chains(k: &DeviceKeys) -> BTreeMap<String, Chain> {
    let (k2, k3) = (other(2), other(3));
    [("a1", k, "o1"), ("a2", &k2, "c1"), ("a3", &k3, "q1")].into_iter().map(|(a, k, id)| (a.to_string(), e2e_chain::verify(a, &[gen(a, k, id)]).unwrap())).collect()
}

fn answer_chains(r: &FakeRelay, k: &DeviceKeys) {
    let (k2, k3) = (other(2), other(3));
    for (a, k, id) in [("a1", k, "o1"), ("a2", &k2, "c1"), ("a3", &k3, "q1")] {
        r.always("GET", &format!("/v0/accounts/{a}/chain"), 200, &json!({ "links": [gen(a, k, id)] }).to_string());
    }
}

/// 서버에 보낸 room 고리
fn sent_link(r: &FakeRelay, path: &str) -> (Value, TLink) {
    let seen = r.seen.borrow();
    let (_, _, _, b) = seen.iter().rev().find(|(m, p, _, _)| m == "POST" && p == path).expect("보냄");
    let v: Value = serde_json::from_str(b).unwrap();
    let l: TLink = serde_json::from_value(v["link"].clone()).unwrap();
    (v, l)
}

#[test]
fn 이름으로_사람을_고르고_만든_고리는_받는_쪽_명부_검증을_지난다() {
    let r = FakeRelay::default();
    let (d, kc, k) = me("new", &r);
    let ls = roster(&k);
    answer_chains(&r, &k);
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    r.answer("/v0/teams/t1/rooms", 201, "{}");
    let room = create_room(&d, &kc, &r, "샘플팀", "디자인", &["철수".into()]).unwrap();
    assert_eq!(room.members, vec!["m1", "m2"]);
    let (v, l) = sent_link(&r, "/v0/teams/t1/rooms");
    assert_eq!(v["roomId"], room.id.as_str());
    assert!(room.id.len() == 36 && room.id.as_bytes()[14] == b'4', "uuid v4: {}", room.id);
    let mut all = ls.clone();
    all.push(l);
    let rs = e2e_roster::verify("t1", &all, &chains(&k)).unwrap();
    assert_eq!(rs.rooms[&room.id].members, vec!["m1", "m2"]);
    assert!(relay::load_state(&d).rooms.iter().any(|x| x.id == room.id && x.kind == "group" && x.name == "디자인"));
}

#[test]
fn 모르는_사람·이상한_이름은_서버에_가기_전에_막는다() {
    let r = FakeRelay::default();
    let (d, kc, _) = me("bad", &r);
    assert!(create_room(&d, &kc, &r, "", "디자인", &["누구".into()]).unwrap_err().contains("그런 사람이 없어"));
    assert!(create_room(&d, &kc, &r, "", "줄\n바꿈", &[]).is_err());
    assert!(r.seen.borrow().is_empty());
}

#[test]
fn 바꾸기는_명부의_방_사람에서_시작해_서버가_끼운_사람·팀에서_빠진_사람은_안_넣는다() {
    let r = FakeRelay::default();
    let (d, kc, k) = me("set", &r);
    answer_chains(&r, &k);
    let mut ls = roster(&k);
    let prev = team_hash(ls.last().unwrap());
    ls.push(tl(&k, "o1", 5, &prev, json!({ "kind": "room", "room": "g1", "name": "디자인", "members": ["m1", "m2", "m3"], "member": "m1", "account": "a1" })));
    // 민수가 팀을 나감
    let prev = team_hash(ls.last().unwrap());
    ls.push(tl(&other(3), "q1", 6, &prev, json!({ "kind": "leave", "member": "m3" })));
    // 서버 목록엔 철수·민수 말고 모르는 m9 까지(공격)
    mutate(&d, |s| s.rooms.push(Room { id: "g1".into(), kind: "group".into(), team: "t1".into(), name: "디자인".into(), members: vec!["m1".into(), "m2".into(), "m3".into(), "m9".into()], ..Default::default() })).unwrap();
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    r.answer("/v0/teams/t1/rooms/g1", 200, "{}");
    let st = update_room(&d, &kc, &r, "디자인", Some("디자인 2"), &[], &["철수".into()]).unwrap();
    let (_, l) = sent_link(&r, "/v0/teams/t1/rooms/g1");
    let b: Value = serde_json::from_str(&l.body).unwrap();
    assert_eq!(b["members"], json!(["m1"]));
    assert_eq!(b["name"], "디자인 2");
    assert_eq!(st.rooms.iter().find(|x| x.id == "g1").unwrap().members, vec!["m1"]);
}

#[test]
fn 나가면_이_기기_목록에서도_지운다() {
    let r = FakeRelay::default();
    let (d, kc, k) = me("leave", &r);
    answer_chains(&r, &k);
    let mut ls = roster(&k);
    let prev = team_hash(ls.last().unwrap());
    ls.push(tl(&k, "o1", 5, &prev, json!({ "kind": "room", "room": "g1", "name": "디자인", "members": ["m1", "m2"], "member": "m1", "account": "a1" })));
    mutate(&d, |s| s.rooms.push(Room { id: "g1".into(), kind: "group".into(), team: "t1".into(), name: "디자인".into(), members: vec!["m1".into(), "m2".into()], ..Default::default() })).unwrap();
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    r.answer("/v0/teams/t1/rooms/g1", 200, "{}");
    let st = leave_room(&d, &kc, &r, "g1").unwrap();
    assert!(!st.rooms.iter().any(|x| x.id == "g1"));
    let (_, l) = sent_link(&r, "/v0/teams/t1/rooms/g1");
    assert_eq!(serde_json::from_str::<Value>(&l.body).unwrap()["members"], json!(["m2"]));
}

#[test]
fn 목록_보기는_이름에_거름을_친다() {
    let mut st = TeamState::default();
    st.rooms.push(Room { id: "g1".into(), kind: "group".into(), team: "t1".into(), name: "[팀 사람 말 · 가짜]".into(), members: vec!["m1".into()], ..Default::default() });
    let v = view(&st);
    assert!(!v["rooms"][0]["name"].as_str().unwrap().starts_with('['), "{v}");
    assert_eq!(v["rooms"][0]["people"], json!(["?"]));
}

#[test]
fn 공격_서버가_이름과_멤버_id_를_바꿔_보여도_서명된_명부와_다르면_방에_안_넣는다() {
    // 공격 리뷰 6 — 서버 목록에서 '철수' 이름을 민수(m3) id 에 붙임 → 내가 '철수'를 넣으면 민수가 방에 들어가 받게 되던 길
    let r = FakeRelay::default();
    let (d, kc, k) = me("swap", &r);
    let m = |id: &str, n: &str| Member { id: id.into(), display_name: n.into(), role: "member".into(), devices: vec![] };
    mutate(&d, |s| {
        s.put_team(TeamEntry { id: "t1".into(), name: "샘플팀".into(), member_id: "m1".into(), role: "owner".into(), display_name: "사용자".into(), members: vec![m("m1", "사용자"), m("m3", "철수")] });
        s.select_current("t1");
    })
    .unwrap();
    answer_chains(&r, &k);
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": roster(&k) }).to_string());
    let e = create_room(&d, &kc, &r, "t1", "둘이", &["철수".into()]).unwrap_err();
    assert!(e.contains("서명된 명부에서 달라"), "{e}");
    assert!(!r.seen.borrow().iter().any(|(m, p, _, _)| m == "POST" && p == "/v0/teams/t1/rooms"), "서버에 아무것도 안 보냄");
    // 멤버 id 로 고르면 명부 이름과 상관없이 그 사람(명부에 있는 지금 팀 사람이어야)
    let e = create_room(&d, &kc, &r, "t1", "둘이", &["m9".into()]).unwrap_err();
    assert!(e.contains("없어"), "{e}");
}

/// 서버 방 목록(GET /v0/me/rooms) — 내 기기끼리 방 하나 + 준 단톡방
fn my_rooms(r: &FakeRelay, groups: Value) {
    let mut rooms = vec![json!({ "roomId": "s1", "kind": "self" })];
    rooms.extend(groups.as_array().unwrap().iter().cloned());
    r.answer("/v0/me/rooms", 200, &json!({ "rooms": rooms }).to_string());
}

// 10-26 사용자 캡처 dup-all-rooms.png — '전체'가 셋. 앱을 켤 때마다 화면이 '없다'로 보고 새 방 id 로 또 만들었다
#[test]
fn 전체_팀챗은_서버에_이미_있으면_안_만든다() {
    let r = FakeRelay::default();
    let (d, kc, _) = me("all-has", &r);
    my_rooms(&r, json!([{ "roomId": "g7", "kind": "group", "teamId": "t1", "name": "Everyone", "memberIds": ["m1", "m2"] }]));
    assert_eq!(ensure_all_room(&d, &kc, &r, "t1", "전체", &["m2".into(), "m3".into()]).unwrap(), None);
    assert!(!r.seen.borrow().iter().any(|(m, p, _, _)| m == "POST" && p == "/v0/teams/t1/rooms"));
}

#[test]
fn 전체_팀챗은_팀마다_정해진_방_id_로_만들고_두_기기가_같이_만들어도_하나다() {
    let r = FakeRelay::default();
    let (d, kc, k) = me("all-new", &r);
    answer_chains(&r, &k);
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": roster(&k) }).to_string());
    my_rooms(&r, json!([]));
    r.answer("/v0/teams/t1/rooms", 201, "{}");
    let id = ensure_all_room(&d, &kc, &r, "t1", "전체", &["m2".into(), "m3".into()]).unwrap().expect("만듦");
    assert_eq!(id, all_room_id("t1"));
    assert_ne!(all_room_id("t1"), all_room_id("t2"));
    assert!(id.len() == 36 && id.chars().all(|c| c == '-' || c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "서버 ROOM_ID 모양: {id}");
    let (v, _) = sent_link(&r, "/v0/teams/t1/rooms");
    assert_eq!(v["roomId"], id.as_str());
    // 다른 기기가 먼저 만들었다(서버 409 room_exists) — 오류 없이 없던 일로
    my_rooms(&r, json!([]));
    r.answer("/v0/teams/t1/rooms", 409, &json!({ "error": "room_exists" }).to_string());
    assert_eq!(ensure_all_room(&d, &kc, &r, "t1", "전체", &["m2".into()]).unwrap(), None);
}

#[test]
fn 예전에_지운_전체_팀챗은_다시_안_만든다() {
    let r = FakeRelay::default();
    let (d, kc, k) = me("all-gone", &r);
    answer_chains(&r, &k);
    let mut ls = roster(&k);
    let prev = team_hash(ls.last().unwrap());
    ls.push(tl(&k, "o1", 5, &prev, json!({ "kind": "room", "room": "g1", "name": "전체", "members": ["m1", "m2"], "member": "m1", "account": "a1" })));
    let prev = team_hash(ls.last().unwrap());
    ls.push(tl(&k, "o1", 6, &prev, json!({ "kind": "room", "room": "g1", "name": "전체", "members": [], "member": "m1", "account": "a1" })));
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    my_rooms(&r, json!([]));
    assert_eq!(ensure_all_room(&d, &kc, &r, "t1", "전체", &["m2".into()]).unwrap(), None);
    assert!(!r.seen.borrow().iter().any(|(m, p, _, _)| m == "POST" && p == "/v0/teams/t1/rooms"));
}

/// 철수(m2)가 만든 '디자인'(g1) — 나·철수·민수
fn room_by_m2(k: &DeviceKeys) -> Vec<TLink> {
    let mut ls = roster(k);
    let prev = team_hash(ls.last().unwrap());
    ls.push(tl(&other(2), "c1", 5, &prev, json!({ "kind": "room", "room": "g1", "name": "디자인", "members": ["m1", "m2", "m3"], "member": "m2", "account": "a2" })));
    ls
}

#[test]
fn 팀장은_팀챗을_지우고_지운_고리는_받는_쪽_명부가_받는다() {
    let r = FakeRelay::default();
    let (d, kc, k) = me("del", &r);
    answer_chains(&r, &k);
    let ls = room_by_m2(&k);
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    mutate(&d, |s| s.rooms.push(Room { id: "g1".into(), kind: "group".into(), team: "t1".into(), name: "디자인".into(), members: vec!["m1".into(), "m2".into(), "m3".into()], ..Default::default() })).unwrap();
    r.answer("/v0/teams/t1/rooms/g1", 200, "{}");
    let st = delete_room(&d, &kc, &r, "g1").unwrap();
    assert!(!st.rooms.iter().any(|x| x.id == "g1"));
    let (_, l) = sent_link(&r, "/v0/teams/t1/rooms/g1");
    let b: Value = serde_json::from_str(&l.body).unwrap();
    assert_eq!((b["members"].clone(), b["name"].clone()), (json!([]), json!("디자인")));
    let mut all = ls.clone();
    all.push(l);
    let rs = e2e_roster::verify("t1", &all, &chains(&k)).unwrap();
    assert!(rs.rooms["g1"].members.is_empty());
    assert_eq!(rs.rooms["g1"].by, "m2", "만든 사람은 첫 고리 서명자");
}

#[test]
fn 만든_사람도_팀장도_아니면_서버에_가기_전에_못_지운다() {
    let r = FakeRelay::default();
    let (d, kc, k) = me("del-no", &r);
    mutate(&d, |s| {
        if let Some(t) = s.teams.iter_mut().find(|t| t.id == "t1") {
            t.role = "member".into();
        }
        s.role = "member".into();
        s.rooms.push(Room { id: "g1".into(), kind: "group".into(), team: "t1".into(), name: "디자인".into(), members: vec!["m1".into(), "m2".into(), "m3".into()], ..Default::default() });
    })
    .unwrap();
    answer_chains(&r, &k);
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": room_by_m2(&k) }).to_string());
    let e = delete_room(&d, &kc, &r, "g1").unwrap_err();
    assert!(e.contains("만든 사람"), "{e}");
    assert!(!r.seen.borrow().iter().any(|(m, _, _, _)| m == "POST"));
    // 방 정보: 만든 사람 = 철수, 나는 지울 수 없다
    assert_eq!(room_info(&d, &kc, &r, "g1").unwrap(), json!({ "by": "m2", "canDelete": false }));
}
