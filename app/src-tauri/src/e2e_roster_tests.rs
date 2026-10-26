use super::*;
use crate::e2e_chain::{self, link_hash, Link};
use crate::team_relay_keys::DeviceKeys;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::json;

fn k(n: u8) -> DeviceKeys {
    DeviceKeys::from_seeds([n; 32], [n.wrapping_add(100); 32])
}

/// 기기 하나짜리 계정 사슬
fn chain(account: &str, d: &DeviceKeys, id: &str) -> Chain {
    let body = json!({ "v": 1, "account": account, "seq": 0, "prev": "", "by": id, "kind": "genesis", "device": id, "edPub": d.public(), "e2ePub": d.e2e_public() }).to_string();
    let l = Link { seq: 0, sig: d.sign(&format!("chammo-chain/1\n{body}")), body };
    let _ = link_hash(&l.body, &l.sig);
    e2e_chain::verify(account, &[l]).unwrap()
}

/// 사용자(a1, 기기 o1)·철수(a2, 기기 c1)·모르는 사람(a9, 기기 x1)
fn chains() -> BTreeMap<String, Chain> {
    BTreeMap::from([("a1".into(), chain("a1", &k(1), "o1")), ("a2".into(), chain("a2", &k(2), "c1")), ("a9".into(), chain("a9", &k(9), "x1"))])
}

fn tl(by: &DeviceKeys, by_id: &str, seq: u64, prev: &str, f: Value) -> TLink {
    let mut b = json!({ "v": 1, "team": "t1", "seq": seq, "prev": prev, "by": by_id, "at": 1 });
    b.as_object_mut().unwrap().extend(f.as_object().unwrap().clone());
    let body = b.to_string();
    TLink { seq, sig: by.sign(&format!("chammo-team/1\n{body}")), body, sig2: None }
}

fn code_key(code: &str) -> SigningKey {
    SigningKey::from_bytes(&invite_seed(code))
}

/// 팀 시작(사용자) → 초대 → 철수 들어옴
fn base() -> Vec<TLink> {
    let t = tl(&k(1), "o1", 0, "", json!({ "kind": "team", "name": "샘플팀", "member": "m1", "account": "a1", "displayName": "사용자" }));
    let inv = code_key("CODE-1");
    let pubk = B64.encode(inv.verifying_key().as_bytes());
    let i = tl(&k(1), "o1", 1, &team_hash(&t), json!({ "kind": "invite", "invPub": pubk, "role": "member", "expires": 9 }));
    let mut j = tl(&k(2), "c1", 2, &team_hash(&i), json!({ "kind": "join", "invPub": pubk, "member": "m2", "account": "a2", "displayName": "철수" }));
    j.sig2 = Some(B64.encode(inv.sign(format!("chammo-team/1\n{}", j.body).as_bytes()).to_bytes()));
    vec![t, i, j]
}

#[test]
fn 초대_열쇠는_서버_시험_webcrypto_와_같은_식() {
    // Node 24 WebCrypto 로 따로 뽑은 값(HKDF-SHA256 빈 소금, "chammo-invite/1" → Ed25519 씨앗) — roster-helpers inviteKey 와 같다
    assert_eq!(B64.encode(code_key("TEST-CODE-chammo").verifying_key().as_bytes()), "YdE0OA3WvfSDdiik43RnLDFkjhmHq6bb1niNuvAL21w");
}

#[test]
fn 시작·초대·들어옴으로_멤버를_낸다() {
    let r = verify("t1", &base(), &chains()).unwrap();
    assert_eq!(r.name, "샘플팀");
    let got: Vec<_> = r.active().map(|(id, m)| (id.as_str(), m.account.as_str(), m.display_name.as_str(), m.role.as_str())).collect();
    assert_eq!(got, vec![("m1", "a1", "사용자", "owner"), ("m2", "a2", "철수", "member")]);
}

#[test]
fn 코드_열쇠_서명이_없거나_다르면_들어옴_거절() {
    let mut ls = base();
    ls[2].sig2 = None;
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(2, "join")));
    let mut ls = base();
    ls[2].sig2 = Some(B64.encode(code_key("OTHER").sign(format!("chammo-team/1\n{}", ls[2].body).as_bytes()).to_bytes()));
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(2, "join")));
}

#[test]
fn 서버가_지어낸_가짜_멤버_같은_이름·남의_계정은_못_들어온다() {
    // 서버가 모르는 사람(a9) 계정으로 '철수' 들어옴을 지어냄 — 초대 코드를 모르니 sig2 를 못 만든다
    let mut ls = base();
    let mut fake = tl(&k(9), "x1", 2, &team_hash(&ls[1]), json!({ "kind": "join", "invPub": serde_json::from_str::<Value>(&ls[1].body).unwrap()["invPub"], "member": "m9", "account": "a9", "displayName": "철수" }));
    fake.sig2 = Some(B64.encode(code_key("GUESS").sign(b"x").to_bytes()));
    ls[2] = fake;
    assert!(verify("t1", &ls, &chains()).is_err());
}

#[test]
fn 한_초대에_들어옴_하나() {
    let mut ls = base();
    let inv = code_key("CODE-1");
    let pubk = B64.encode(inv.verifying_key().as_bytes());
    let mut j2 = tl(&k(9), "x1", 3, &team_hash(&ls[2]), json!({ "kind": "join", "invPub": pubk, "member": "m9", "account": "a9", "displayName": "또" }));
    j2.sig2 = Some(B64.encode(inv.sign(format!("chammo-team/1\n{}", j2.body).as_bytes()).to_bytes()));
    ls.push(j2);
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(3, "join")));
}

#[test]
fn 팀장만_초대·역할·빼기를_서명한다_가짜_팀장_불가() {
    let mut ls = base();
    // 철수(멤버)가 자기를 팀장으로
    ls.push(tl(&k(2), "c1", 3, &team_hash(&ls[2]), json!({ "kind": "role", "member": "m2", "role": "owner" })));
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(3, "owner-op")));
    // 사용자(팀장)이 올리면 된다 → 그 뒤엔 철수도 팀장 일을 한다
    let mut ls = base();
    ls.push(tl(&k(1), "o1", 3, &team_hash(&ls[2]), json!({ "kind": "role", "member": "m2", "role": "owner" })));
    ls.push(tl(&k(2), "c1", 4, &team_hash(&ls[3]), json!({ "kind": "remove", "member": "m1" })));
    let r = verify("t1", &ls, &chains()).unwrap();
    assert_eq!(r.active().map(|(id, _)| id.as_str()).collect::<Vec<_>>(), vec!["m2"]);
}

#[test]
fn 나가기는_본인_계정_기기만() {
    let mut ls = base();
    ls.push(tl(&k(1), "o1", 3, &team_hash(&ls[2]), json!({ "kind": "leave", "member": "m2" })));
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(3, "leave")), "남이 대신 나가기 못 씀");
    let mut ls = base();
    ls.push(tl(&k(2), "c1", 3, &team_hash(&ls[2]), json!({ "kind": "leave", "member": "m2" })));
    assert!(!verify("t1", &ls, &chains()).unwrap().members["m2"].active);
}

#[test]
fn 사슬이_없는_계정이_나오면_받아_오라고_알린다() {
    let mut c = chains();
    c.remove("a2");
    assert_eq!(verify("t1", &base(), &c), Err(RosterErr::NeedChain("a2".into())));
    assert_eq!(accounts_needed(&base()).into_iter().collect::<Vec<_>>(), vec!["a1", "a2"]);
}

#[test]
fn 기존_팀_옮기기_목록_보증과_차례_틀림() {
    let t = tl(&k(1), "o1", 0, "", json!({ "kind": "team", "name": "옛 팀", "member": "m1", "account": "a1", "members": [
        { "member": "m1", "account": "a1", "displayName": "사용자", "role": "owner" },
        { "member": "m2", "account": "a2", "displayName": "철수", "role": "member" } ] }));
    let r = verify("t1", std::slice::from_ref(&t), &chains()).unwrap();
    assert_eq!(r.active().map(|(m, _)| m.as_str()).collect::<Vec<_>>(), vec!["m1"], "옮기기 목록은 자리를 안 만든다(R1)");
    let i = tl(&k(1), "o1", 1, "wrong", json!({ "kind": "invite", "invPub": "x", "role": "member", "expires": 1 }));
    assert_eq!(verify("t1", &[t, i], &chains()), Err(RosterErr::Bad(1, "shape")));
}

// ── 단톡방(room 고리, 계획 2026-10-26 team-rooms) — 방 사람·이름은 명부에서만 ──

/// 사용자(m1)이 고리 at 에 방 r1 을 만든다
fn room(by: &DeviceKeys, by_id: &str, member: &str, account: &str, ls: &[TLink], name: &str, members: &[&str]) -> TLink {
    let prev = team_hash(ls.last().unwrap());
    tl(by, by_id, ls.len() as u64, &prev, json!({ "kind": "room", "room": "r1", "name": name, "members": members, "member": member, "account": account }))
}

#[test]
fn 방_만들기·바꾸기는_명부에서_방_사람을_낸다() {
    let mut ls = base();
    ls.push(room(&k(1), "o1", "m1", "a1", &ls, "디자인", &["m1", "m2"]));
    let r = verify("t1", &ls, &chains()).unwrap();
    assert_eq!(r.rooms["r1"], RosterRoom { name: "디자인".into(), members: vec!["m1".into(), "m2".into()], confirmed: true, trusted_members: vec!["m1".into(), "m2".into()], by: "m1".into() });
    // 철수(방 사람)가 이름을 바꾸고 사용자을 뺀다
    ls.push(room(&k(2), "c1", "m2", "a2", &ls, "디자인 2", &["m2"]));
    let r = verify("t1", &ls, &chains()).unwrap();
    assert_eq!(r.rooms["r1"].name, "디자인 2");
    assert_eq!(r.rooms["r1"].members, vec!["m2".to_string()]);
}

#[test]
fn 방_밖_사람·남의_계정·모르는_멤버·만든_사람_빠짐은_거절() {
    // 만들 때 나를 안 넣음
    let mut ls = base();
    ls.push(room(&k(1), "o1", "m1", "a1", &ls, "x", &["m2"]));
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(3, "room")));
    // 명부에 없는 멤버
    let mut ls = base();
    ls.push(room(&k(1), "o1", "m1", "a1", &ls, "x", &["m1", "m9"]));
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(3, "room")));
    // 남의 멤버 자리로 서명(사용자 기기가 m2 라고)
    let mut ls = base();
    ls.push(room(&k(1), "o1", "m2", "a2", &ls, "x", &["m1", "m2"]));
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(3, "room")));
    // 방에 없는 사람이 바꾸기 — 사용자만 있는 방을 철수가 고침
    let mut ls = base();
    ls.push(room(&k(1), "o1", "m1", "a1", &ls, "x", &["m1"]));
    ls.push(room(&k(2), "c1", "m2", "a2", &ls, "뺏기", &["m2"]));
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(4, "room")));
    // 같은 사람 둘
    let mut ls = base();
    ls.push(room(&k(1), "o1", "m1", "a1", &ls, "x", &["m1", "m1"]));
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(3, "room")));
}

#[test]
fn 팀에서_빠진_사람은_방_사람으로_못_넣는다() {
    let mut ls = base();
    ls.push(tl(&k(2), "c1", 3, &team_hash(&ls[2]), json!({ "kind": "leave", "member": "m2" })));
    ls.push(room(&k(1), "o1", "m1", "a1", &ls, "x", &["m1", "m2"]));
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(4, "room")));
}

// ── 한 사람 신원이 바뀌어도 팀 명부 전체가 멈추지 않는다(계획 2026-10-26-e2e-recover §9 표 S1~S11) ──
// 믿는 사슬(trusted) = 받아들이기 전 핀 머리까지, 느슨한 사슬(loose) = 바뀐 계정의 지금 사슬(받아들였다면 될 모양)

/// 기기 d1 로 시작했다가 d2 로 다시 시작한 계정 사슬(바뀐 계정의 지금 사슬)
fn reset_chain(account: &str, d1: &DeviceKeys, id1: &str, d2: &DeviceKeys, id2: &str) -> Chain {
    let b0 = json!({ "v": 1, "account": account, "seq": 0, "prev": "", "by": id1, "kind": "genesis", "device": id1, "edPub": d1.public(), "e2ePub": d1.e2e_public() }).to_string();
    let l0 = Link { seq: 0, sig: d1.sign(&format!("chammo-chain/1\n{b0}")), body: b0 };
    let b1 = json!({ "v": 1, "account": account, "seq": 1, "prev": link_hash(&l0.body, &l0.sig), "by": id2, "kind": "reset", "device": id2, "edPub": d2.public(), "e2ePub": d2.e2e_public() }).to_string();
    let l1 = Link { seq: 1, sig: d2.sign(&format!("chammo-chain/1\n{b1}")), body: b1 };
    e2e_chain::verify(account, &[l0, l1]).unwrap()
}

/// 철수(a2)가 기기 c1 을 잃고 c3 으로 다시 시작 — 나는 아직 받아들이기 전
fn loose_a2() -> BTreeMap<String, Chain> {
    let mut c = chains();
    c.insert("a2".into(), reset_chain("a2", &k(2), "c1", &k(3), "c3"));
    c
}

/// 사용자(팀장 a1)이 기기 o1 을 잃고 o2 로 다시 시작
fn loose_a1() -> BTreeMap<String, Chain> {
    let mut c = chains();
    c.insert("a1".into(), reset_chain("a1", &k(1), "o1", &k(4), "o2"));
    c
}

/// 팀장(by)이 새 초대 → (초대 고리, 코드 열쇠 공개값)
fn invite(by: &DeviceKeys, by_id: &str, ls: &[TLink], code: &str) -> (TLink, String) {
    let inv = code_key(code);
    let pubk = B64.encode(inv.verifying_key().as_bytes());
    (tl(by, by_id, ls.len() as u64, &team_hash(ls.last().unwrap()), json!({ "kind": "invite", "invPub": pubk, "role": "member", "expires": 9 })), pubk)
}

/// code 로 들어옴(by 기기가 account 계정 이름으로)
fn join(by: &DeviceKeys, by_id: &str, ls: &[TLink], code: &str, member: &str, account: &str, name: &str) -> TLink {
    let inv = code_key(code);
    let pubk = B64.encode(inv.verifying_key().as_bytes());
    let mut j = tl(by, by_id, ls.len() as u64, &team_hash(ls.last().unwrap()), json!({ "kind": "join", "invPub": pubk, "member": member, "account": account, "displayName": name }));
    j.sig2 = Some(B64.encode(inv.sign(format!("chammo-team/1\n{}", j.body).as_bytes()).to_bytes()));
    j
}

fn op(by: &DeviceKeys, by_id: &str, ls: &[TLink], f: Value) -> TLink {
    tl(by, by_id, ls.len() as u64, &team_hash(ls.last().unwrap()), f)
}

/// 오늘 실측 모양 — 팀장이 철수(m2)를 뺐고, 다시 시작한 철수가 새 초대로 새 기기 c3 으로 들어옴(m3)
fn rejoined() -> Vec<TLink> {
    let mut ls = base();
    ls.push(op(&k(1), "o1", &ls, json!({ "kind": "remove", "member": "m2" })));
    let (i, _) = invite(&k(1), "o1", &ls, "CODE-2");
    ls.push(i);
    ls.push(join(&k(3), "c3", &ls, "CODE-2", "m3", "a2", "철수"));
    ls
}

fn conf(r: &Roster, m: &str) -> (bool, bool) {
    let x = &r.members[m];
    (x.active, x.confirmed)
}

#[test]
fn 바뀐_사람이_새_기기로_다시_들어오면_그_사람만_확인_전() {
    let ls = rejoined();
    // 고치기 전 모양(믿는 사슬로만) — 명부 전체가 틀렸다
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(5, "join")));
    let r = verify_two("t1", &ls, &chains(), &loose_a2(), None).unwrap();
    assert_eq!(conf(&r, "m1"), (true, true), "팀장은 확인됨");
    assert_eq!(conf(&r, "m3"), (true, false), "다시 들어온 철수만 확인 전");
    assert_eq!(conf(&r, "m2"), (false, true), "빠진 옛 자리는 그대로 빠짐");
}

#[test]
fn 어느_사슬에도_없는_기기_서명은_여전히_명부_틀림() {
    let mut ls = rejoined();
    ls.pop();
    ls.push(join(&k(8), "z8", &ls, "CODE-2", "m3", "a2", "철수"));
    assert_eq!(verify_two("t1", &ls, &chains(), &loose_a2(), None), Err(RosterErr::Bad(5, "join")));
}

#[test]
fn 코드_없는_들어옴은_바뀐_기기여도_거절() {
    let mut ls = rejoined();
    ls[5].sig2 = None;
    assert_eq!(verify_two("t1", &ls, &chains(), &loose_a2(), None), Err(RosterErr::Bad(5, "join")));
}

#[test]
fn 확인_전_멤버가_만든_방은_확인_전() {
    let mut ls = rejoined();
    ls.push(room(&k(3), "c3", "m3", "a2", &ls, "둘이", &["m3", "m1"]));
    let r = verify_two("t1", &ls, &chains(), &loose_a2(), None).unwrap();
    let rm = r.rooms.values().next().unwrap();
    assert_eq!(rm.members, vec!["m3", "m1"]);
    assert!(!rm.confirmed, "확인 전 사람이 만든 방");
}

#[test]
fn 확인_전_멤버가_고친_방은_확인_전으로() {
    // 사용자가 만든 방(사용자·철수) — 철수가 다시 들어온 뒤 그 방에 들게 사용자가 고침(확인됨) → 확인 전 철수가 모르는 사람 끼우기
    let mut ls = rejoined();
    let (i, _) = invite(&k(1), "o1", &ls, "CODE-9");
    ls.push(i);
    ls.push(join(&k(9), "x1", &ls, "CODE-9", "m9", "a9", "민수"));
    ls.push(room(&k(1), "o1", "m1", "a1", &ls, "둘이", &["m1", "m3"]));
    let r = verify_two("t1", &ls, &chains(), &loose_a2(), None).unwrap();
    assert!(r.rooms.values().next().unwrap().confirmed, "믿는 팀장이 만든 방(확인 전 사람이 들어 있어도)");
    let id = r.rooms.keys().next().unwrap().clone();
    let b: Value = serde_json::from_str(&ls.last().unwrap().body).unwrap();
    assert_eq!(b["room"], id.as_str());
    ls.push(room_as(&k(3), "c3", "m3", "a2", &ls, &id, "둘이", &["m1", "m3", "m9"]));
    let r = verify_two("t1", &ls, &chains(), &loose_a2(), None).unwrap();
    let rm = &r.rooms[&id];
    assert_eq!(rm.members, vec!["m1", "m3", "m9"]);
    assert!(!rm.confirmed, "확인 전 사람이 고쳤으면 그 방은 받아들이기 전엔 못 쓴다");
    // 그 뒤 믿는 사람이 고쳐도 확인 전 내용을 이어받으니 확인 전 그대로
    ls.push(room_as(&k(1), "o1", "m1", "a1", &ls, &id, "둘이", &["m1", "m3", "m9"]));
    assert!(!verify_two("t1", &ls, &chains(), &loose_a2(), None).unwrap().rooms[&id].confirmed);
}

#[test]
fn 줄어드는_쪽은_누가_서명했든_반영() {
    // S6 확인 전 멤버가 나감
    let mut ls = rejoined();
    ls.push(op(&k(3), "c3", &ls, json!({ "kind": "leave", "member": "m3" })));
    let r = verify_two("t1", &ls, &chains(), &loose_a2(), None).unwrap();
    assert!(!r.members["m3"].active);
    // S8 다시 시작한 팀장(o2)이 철수를 뺌
    let mut ls = base();
    ls.push(op(&k(4), "o2", &ls, json!({ "kind": "remove", "member": "m2" })));
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(3, "owner-op")), "고치기 전 — 명부 전체 틀림");
    let r = verify_two("t1", &ls, &chains(), &loose_a1(), None).unwrap();
    assert!(!r.members["m2"].active, "빠짐은 반영(기밀이 먼저)");
    assert!(r.members["m1"].confirmed && r.members["m1"].owner_ok, "팀장 자리는 옛 고리로 확인됨");
}

#[test]
fn 확인_전_초대로_들어온_사람은_확인_전() {
    // S7 다시 시작한 팀장 o2 가 초대 → 믿는 민수(a9, x1)가 그 초대로 들어옴
    let mut ls = base();
    let (i, _) = invite(&k(4), "o2", &ls, "CODE-3");
    ls.push(i);
    ls.push(join(&k(9), "x1", &ls, "CODE-3", "m9", "a9", "민수"));
    let r = verify_two("t1", &ls, &chains(), &loose_a1(), None).unwrap();
    assert_eq!(conf(&r, "m9"), (true, false), "확인 전 팀장의 초대로 들어옴 — 번진다");
    assert_eq!(conf(&r, "m2"), (true, true));
}

#[test]
fn 확인_전_팀장이_올린_팀장의_초대는_확인_전() {
    // S9 o2 가 철수를 팀장으로 올림 → 철수(믿는 기기 c1)가 초대 → 민수가 들어옴
    let mut ls = base();
    ls.push(op(&k(4), "o2", &ls, json!({ "kind": "role", "member": "m2", "role": "owner" })));
    let (i, _) = invite(&k(2), "c1", &ls, "CODE-4");
    ls.push(i);
    ls.push(join(&k(9), "x1", &ls, "CODE-4", "m9", "a9", "민수"));
    let r = verify_two("t1", &ls, &chains(), &loose_a1(), None).unwrap();
    assert_eq!(r.members["m2"].role, "owner", "구조는 올림");
    assert!(!r.members["m2"].owner_ok, "확인 전 팀장이 올렸으니 팀장 일은 확인 전");
    assert_eq!(conf(&r, "m9"), (true, false));
}

#[test]
fn 확인된_방의_확인_전_사람은_받는_목록에서만_빠짐() {
    // S10 — 방은 확인됨, 사람 표시는 따로(받는 기기 셈은 e2e_state 가 confirmed 로 거른다)
    let mut ls = rejoined();
    ls.push(room(&k(1), "o1", "m1", "a1", &ls, "둘이", &["m1", "m3"]));
    let r = verify_two("t1", &ls, &chains(), &loose_a2(), None).unwrap();
    assert!(r.rooms.values().next().unwrap().confirmed);
    assert!(!r.members["m3"].confirmed);
}

#[test]
fn 받아들이면_예전과_같다() {
    // S11 — 믿는 사슬 = 지금 사슬이면 전부 확인됨, 예전 verify 와 같은 명부
    let ls = rejoined();
    let r = verify_two("t1", &ls, &loose_a2(), &loose_a2(), None).unwrap();
    assert!(r.members.values().all(|m| m.confirmed));
    assert_eq!(verify("t1", &ls, &loose_a2()).unwrap(), r);
    let mut ls = base();
    ls.push(room(&k(1), "o1", "m1", "a1", &ls, "둘이", &["m1", "m2"]));
    let r = verify("t1", &ls, &chains()).unwrap();
    assert!(r.rooms.values().all(|x| x.confirmed) && r.members.values().all(|m| m.confirmed && (m.role != "owner" || m.owner_ok)));
}

fn room_as(by: &DeviceKeys, by_id: &str, member: &str, account: &str, ls: &[TLink], id: &str, name: &str, members: &[&str]) -> TLink {
    tl(by, by_id, ls.len() as u64, &team_hash(ls.last().unwrap()), json!({ "kind": "room", "room": id, "name": name, "members": members, "member": member, "account": account }))
}

// ── 공격 리뷰(10-26, 따로 맡긴 분신) 뒤 고친 것 ──

#[test]
fn 확인된_팀장이_확인_전_멤버를_올려도_그_사람_팀장_일은_확인_전() {
    // 리뷰 1(높음) — 지어낸 팀장 o2 의 초대로 들어온 민수(m9, 확인 전)를 진짜 팀장(o1)이 팀장으로 올림 → 민수 초대로 들어온 사람이 확인됨이 되던 세탁
    let mut ls = base();
    let (i, _) = invite(&k(4), "o2", &ls, "CODE-5");
    ls.push(i);
    ls.push(join(&k(9), "x1", &ls, "CODE-5", "m9", "a9", "민수"));
    ls.push(op(&k(1), "o1", &ls, json!({ "kind": "role", "member": "m9", "role": "owner" })));
    let (i, _) = invite(&k(9), "x1", &ls, "CODE-6");
    ls.push(i);
    ls.push(join(&k(2), "c1", &ls, "CODE-6", "m7", "a2", "철수2"));
    let r = verify_two("t1", &ls, &chains(), &loose_a1(), None).unwrap();
    assert!(!r.members["m9"].owner_ok, "확인 전 사람은 올려도 팀장 일이 확인 전");
    assert_eq!(conf(&r, "m7"), (true, false));
}

#[test]
fn 핀_뒤에_정상으로_다시_시작한_사람의_옛_기기_고리도_구조로는_받는다() {
    // 리뷰 2(높음·가용성) — 내가 명부를 핀한 뒤 철수 옛 기기 c1 이 방 고리를 쓰고 철수가 다시 시작(c3). 구조를 지금 기기로만 보면 Bad 로 팀 전체가 멈췄다(핀이 없는 기기는 통과 — 기기마다 갈림)
    let mut ls = base();
    ls.push(room(&k(2), "c1", "m2", "a2", &ls, "둘이", &["m2", "m1"]));
    assert!(verify_two("t1", &ls, &chains(), &loose_a2(), Some(2)).is_ok(), "핀 뒤 고리 — 옛 기기도 구조로는 인정");
    assert!(verify_two("t1", &ls, &chains(), &loose_a2(), None).is_ok(), "핀 없는 기기와 같은 판정");
    // 믿음은 여전히 R3 — 내가 믿는 사슬에서 지금 기기여야 확인됨(여기선 받아들이기 전 앞부분에 c1 이 지금 기기라 확인됨)
    assert!(verify_two("t1", &ls, &chains(), &loose_a2(), Some(2)).unwrap().rooms["r1"].confirmed);
    // 받아들인 뒤(믿는 사슬 = 다시 시작한 사슬) 핀 뒤의 옛 기기 고리는 확인 전
    assert!(!verify_two("t1", &ls, &loose_a2(), &loose_a2(), Some(2)).unwrap().rooms["r1"].confirmed);
}

#[test]
fn 확인_전_서명으로_빠진_사람은_의심으로_따로_남긴다() {
    // 리뷰 4 — 빼기는 반영(기밀이 먼저)하되 누가 확인 전 서명으로 뺐는지 남겨 화면이 경보를 띄울 수 있게
    let mut ls = base();
    ls.push(op(&k(4), "o2", &ls, json!({ "kind": "remove", "member": "m2" })));
    let r = verify_two("t1", &ls, &chains(), &loose_a1(), None).unwrap();
    assert_eq!(r.doubts, vec!["m2".to_string()]);
    let mut ls = base();
    ls.push(op(&k(1), "o1", &ls, json!({ "kind": "remove", "member": "m2" })));
    assert!(verify_two("t1", &ls, &chains(), &loose_a1(), None).unwrap().doubts.is_empty(), "확인된 팀장이 뺀 건 의심 아님");
}

#[test]
fn 확인_전_사람이_고친_방은_확인된_사람이_마지막_확인된_사람들만으로_다시_서명하면_되살아난다() {
    // 리뷰 4 — 확인 전 방이 영영 못 쓰게 남던 것. 마지막 확인된 목록 안에서만 다시 확인됨(더하기는 그다음 단계 — 세탁 아님)
    let mut ls = rejoined();
    ls.push(room(&k(1), "o1", "m1", "a1", &ls, "둘이", &["m1", "m3"]));
    let (i, _) = invite(&k(1), "o1", &ls, "CODE-9");
    ls.push(i);
    ls.push(join(&k(9), "x1", &ls, "CODE-9", "m9", "a9", "민수"));
    ls.push(room(&k(3), "c3", "m3", "a2", &ls, "둘이", &["m1", "m3", "m9"]));
    assert!(!verify_two("t1", &ls, &chains(), &loose_a2(), None).unwrap().rooms["r1"].confirmed);
    // 끼운 m9 를 그대로 두고 다시 서명 — 확인 전 그대로
    let mut a = ls.clone();
    a.push(room(&k(1), "o1", "m1", "a1", &a, "둘이", &["m1", "m3", "m9"]));
    assert!(!verify_two("t1", &a, &chains(), &loose_a2(), None).unwrap().rooms["r1"].confirmed);
    // 마지막 확인된 사람들(m1·m3)로만 — 되살아남
    ls.push(room(&k(1), "o1", "m1", "a1", &ls, "둘이", &["m1", "m3"]));
    let r = verify_two("t1", &ls, &chains(), &loose_a2(), None).unwrap();
    assert!(r.rooms["r1"].confirmed);
    assert_eq!(r.rooms["r1"].trusted_members, vec!["m1", "m3"]);
}

#[test]
fn 같은_초대_열쇠를_다시_올리면_명부_틀림() {
    // 리뷰 7 — 이미 쓴 초대를 같은 열쇠로 다시 올려 '안 씀'으로 되돌리던 길
    let mut ls = base();
    let pk = serde_json::from_str::<Value>(&ls[1].body).unwrap()["invPub"].as_str().unwrap().to_string();
    ls.push(op(&k(1), "o1", &ls, json!({ "kind": "invite", "invPub": pk, "role": "member", "expires": 9 })));
    assert_eq!(verify("t1", &ls, &chains()), Err(RosterErr::Bad(3, "invite")));
}
