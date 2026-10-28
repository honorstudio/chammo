use super::*;
use crate::accounts_store::fake::Fake;
use crate::e2e_chain::link_hash;
use crate::e2e_roster::team_hash;
use crate::team_relay::{mutate, Account, Room};
use crate::team_relay_keys::DeviceKeys;
use crate::team_test_util::FakeRelay;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::json;
use std::collections::BTreeMap;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
}

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-e2e-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 이 기기(계정 a1, 기기 d1) — 열쇠는 가짜 키체인, 서버는 가짜 중계
fn me(tag: &str) -> (std::path::PathBuf, Fake, FakeRelay, DeviceKeys) {
    let d = dir(tag);
    let kc = Fake::default();
    let r = FakeRelay::default();
    let (k, acct) = crate::team_relay_keys::create(&kc).unwrap();
    r.devices.borrow_mut().push(("d1".into(), k.public()));
    mutate(&d, |s| {
        s.server = "https://relay.test".into();
        s.key_account = acct;
        s.device_id = "d1".into();
        s.account = Some(Account { id: "a1".into(), ..Default::default() });
        s.rooms = vec![Room { id: "rs".into(), kind: "self".into(), ..Default::default() }, Room { id: "r1".into(), kind: "dm".into(), peer: "m2".into(), team: "t1".into(), ..Default::default() }];
        s.put_team(crate::team_relay::TeamEntry { id: "t1".into(), name: "샘플팀".into(), member_id: "m1".into(), role: "owner".into(), ..Default::default() });
    })
    .unwrap();
    (d, kc, r, k)
}

fn other(n: u8) -> DeviceKeys {
    DeviceKeys::from_seeds([n; 32], [n.wrapping_add(100); 32])
}

fn clink(acc: &str, by: &DeviceKeys, by_id: &str, seq: u64, prev: &str, f: Value) -> Link {
    let mut b = json!({ "v": 1, "account": acc, "seq": seq, "prev": prev, "by": by_id });
    b.as_object_mut().unwrap().extend(f.as_object().unwrap().clone());
    let body = b.to_string();
    Link { seq, sig: by.sign(&format!("chammo-chain/1\n{body}")), body }
}

fn genesis(acc: &str, k: &DeviceKeys, id: &str) -> Link {
    clink(acc, k, id, 0, "", json!({ "kind": "genesis", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public() }))
}

fn add(acc: &str, by: &DeviceKeys, by_id: &str, prev: &Link, k: &DeviceKeys, id: &str) -> Link {
    clink(acc, by, by_id, prev.seq + 1, &link_hash(&prev.body, &prev.sig), json!({ "kind": "add", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public(), "selfSig": k.e2e_key_sig() }))
}

fn reset(acc: &str, prev: &Link, k: &DeviceKeys, id: &str) -> Link {
    clink(acc, k, id, prev.seq + 1, &link_hash(&prev.body, &prev.sig), json!({ "kind": "reset", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public() }))
}

fn answer_chain(r: &FakeRelay, acc: &str, links: &[Link]) {
    r.answer(&format!("/v0/accounts/{acc}/chain"), 200, &json!({ "links": links }).to_string());
}

fn tl(by: &DeviceKeys, by_id: &str, seq: u64, prev: &str, f: Value) -> TLink {
    let mut b = json!({ "v": 1, "team": "t1", "seq": seq, "prev": prev, "by": by_id });
    b.as_object_mut().unwrap().extend(f.as_object().unwrap().clone());
    let body = b.to_string();
    TLink { seq, sig: by.sign(&format!("chammo-team/1\n{body}")), body, sig2: None }
}

/// 팀 t1: 나(m1, a1) 팀장 · 철수(m2, a2, 기기 p1) 초대로 들어옴
fn roster_links(mine: &DeviceKeys, peer: &DeviceKeys) -> Vec<TLink> {
    let t = tl(mine, "d1", 0, "", json!({ "kind": "team", "name": "샘플팀", "member": "m1", "account": "a1", "displayName": "사용자" }));
    let code = SigningKey::from_bytes(&crate::e2e_roster::invite_seed("C"));
    let pk = B64.encode(code.verifying_key().as_bytes());
    let i = tl(mine, "d1", 1, &team_hash(&t), json!({ "kind": "invite", "invPub": pk, "role": "member", "expires": 1 }));
    let mut j = tl(peer, "p1", 2, &team_hash(&i), json!({ "kind": "join", "invPub": pk, "member": "m2", "account": "a2", "displayName": "철수" }));
    j.sig2 = Some(B64.encode(code.sign(format!("chammo-team/1\n{}", j.body).as_bytes()).to_bytes()));
    vec![t, i, j]
}


#[test]
fn 처음_본_사슬은_핀_이어지면_머리만_바뀌고_다시_시작은_사람이_받아들일_때까지_changed() {
    let (d, kc, r, _) = me("pin");
    let st = relay::load_state(&d);
    let (p1, p2) = (other(2), other(3));
    let g = genesis("a2", &p1, "p1");
    answer_chain(&r, "a2", std::slice::from_ref(&g));
    assert!(matches!(chain_of(&d, &kc, &r, &st, "a2", true).unwrap(), Trust::Ok(_)));
    let a = add("a2", &p1, "p1", &g, &p2, "p2");
    answer_chain(&r, "a2", &[g.clone(), a.clone()]);
    assert!(matches!(chain_of(&d, &kc, &r, &st, "a2", true).unwrap(), Trust::Ok(c) if c.devices.len() == 2));
    assert_eq!(load(&d).pins["a2"].seq, 1);
    let x = reset("a2", &a, &other(4), "p9");
    answer_chain(&r, "a2", &[g.clone(), a.clone(), x.clone()]);
    assert!(matches!(chain_of(&d, &kc, &r, &st, "a2", true).unwrap(), Trust::Changed(_)));
    // 받아들이기 전엔 다시 받아도 changed
    assert!(matches!(chain_of(&d, &kc, &r, &st, "a2", false).unwrap(), Trust::Changed(_)));
    accept(&d, "a2").unwrap();
    assert!(matches!(chain_of(&d, &kc, &r, &st, "a2", false).unwrap(), Trust::Ok(c) if c.devices.contains_key("p9")));
}

#[test]
fn 전에_본_머리를_잇지_않으면_forked() {
    let (d, kc, r, _) = me("fork");
    let st = relay::load_state(&d);
    let (p1, p2, p3) = (other(2), other(3), other(5));
    let g = genesis("a2", &p1, "p1");
    answer_chain(&r, "a2", &[g.clone(), add("a2", &p1, "p1", &g, &p2, "p2")]);
    chain_of(&d, &kc, &r, &st, "a2", true).unwrap();
    // 다른 사람에겐 p2 대신 p3 를 보여 주는 서버
    answer_chain(&r, "a2", &[g.clone(), add("a2", &p1, "p1", &g, &p3, "p3")]);
    assert_eq!(chain_of(&d, &kc, &r, &st, "a2", true).unwrap(), Trust::Forked);
}

#[test]
fn 내_기기끼리_방은_내_사슬_기기에게_봉하고_내가_연다() {
    let (d, kc, r, k) = me("self");
    let g = genesis("a1", &k, "d1");
    answer_chain(&r, "a1", std::slice::from_ref(&g));
    let sent_at = now_ms();
    let body = wrap(&d, &kc, &r, "rs", "c1", "내일 회의", true, sent_at).expect("봉투");
    assert!(!body.contains("내일 회의"));
    let st = relay::load_state(&d);
    let m = json!({ "t": "msg", "room": "rs", "from": { "device": "d1", "account": "a1" }, "origin": "human", "body": body });
    assert_eq!(unwrap(&d, &kc, &r, &st, &m), Unwrapped::Opened { text: "내일 회의".into(), human: true, note: String::new(), at: sent_at, extra: Default::default(), via: String::new() });
    // 바깥(서버)이 agent 면 안쪽이 human 이라도 참모 말(같은 봉투를 다시 열면 재전송으로 걸리니 새 봉투로)
    answer_chain(&r, "a1", std::slice::from_ref(&g));
    let body2 = wrap(&d, &kc, &r, "rs", "c2", "내일 회의", true, now_ms()).expect("봉투");
    let m2 = json!({ "t": "msg", "room": "rs", "from": { "device": "d1", "account": "a1" }, "origin": "agent", "body": body2 });
    assert!(matches!(unwrap(&d, &kc, &r, &st, &m2), Unwrapped::Opened { human: false, .. }));
}

#[test]
fn 사슬_밖_기기가_보낸_봉투·머리가_다른_봉투는_못_푼다() {
    let (d, kc, r, k) = me("outsider");
    let g = genesis("a1", &k, "d1");
    answer_chain(&r, "a1", std::slice::from_ref(&g));
    let body = wrap(&d, &kc, &r, "rs", "c1", "x", false, now_ms()).unwrap();
    let st = relay::load_state(&d);
    // 서버가 보낸 기기를 d7 로 찍어 왔다(봉투엔 d1) — 모양 틀림
    let m = json!({ "room": "rs", "from": { "device": "d7", "account": "a1" }, "body": body });
    assert_eq!(unwrap(&d, &kc, &r, &st, &m), Unwrapped::Failed("shape".into()));
    // 평문은 받지 않는다(R8)
    assert_eq!(unwrap(&d, &kc, &r, &st, &json!({ "body": "안녕" })), Unwrapped::Failed("plain".into()));
}

#[test]
fn dm_은_명부의_그_사람_사슬_기기까지_봉하고_보안_번호가_바뀌면_안_보낸다() {
    let (d, kc, r, k) = me("dm");
    let peer = other(2);
    let g1 = genesis("a1", &k, "d1");
    let g2 = genesis("a2", &peer, "p1");
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": roster_links(&k, &peer) }).to_string());
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    let body = wrap(&d, &kc, &r, "r1", "c1", "철수야", false, now_ms()).expect("봉투");
    let v: Value = serde_json::from_str(&body).unwrap();
    let mut ds: Vec<_> = v["env"].as_array().unwrap().iter().map(|e| e["d"].as_str().unwrap().to_string()).collect();
    ds.sort();
    assert_eq!(ds, vec!["d1", "p1"]);
    assert_eq!(v["peers"]["a2"], link_hash(&g2.body, &g2.sig));
    // 철수가 다시 시작 → 받아들이기 전엔 Err
    let x = reset("a2", &g2, &other(9), "p9");
    answer_chain(&r, "a2", &[g2.clone(), x.clone()]);
    chain_of(&d, &kc, &r, &relay::load_state(&d), "a2", true).unwrap();
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": roster_links(&k, &peer) }).to_string());
    answer_chain(&r, "a2", &[g2.clone(), x]);
    let e = wrap(&d, &kc, &r, "r1", "c2", "x", false, now_ms()).unwrap_err();
    assert!(e.contains("보안 번호가 바뀌었어"), "{e}");
}

#[test]
fn 보낼_땐_내_사슬을_새로_받아_막_들인_기기까지_봉한다() {
    // 로컬 종단 시험(10-24)에서 잡힌 것 — 캐시로 보내면 막 허용한 폰이 받는 목록에서 빠졌다
    let (d, kc, r, k) = me("fresh");
    let g = genesis("a1", &k, "d1");
    answer_chain(&r, "a1", std::slice::from_ref(&g));
    chain_of(&d, &kc, &r, &relay::load_state(&d), "a1", true).unwrap();
    let phone = other(2);
    answer_chain(&r, "a1", &[g.clone(), add("a1", &k, "d1", &g, &phone, "d2")]);
    let body = wrap(&d, &kc, &r, "rs", "c1", "x", false, now_ms()).unwrap();
    assert!(body.contains("\"d\":\"d2\""), "막 들인 기기도 받는 목록에");
}

// ── 공격 재현(리뷰 B 치명 2): 서버가 내 사슬에 공격자 reset + 내 기기 다시 add ──
#[test]
fn 공격_내_사슬에_공격자_reset_을_붙이면_보내지도_고리를_쓰지도_않는다() {
    let (d, kc, r, k) = me("my-reset");
    let g = genesis("a1", &k, "d1");
    answer_chain(&r, "a1", std::slice::from_ref(&g));
    chain_of(&d, &kc, &r, &relay::load_state(&d), "a1", true).unwrap();
    let kz = other(77);
    let x = reset("a1", &g, &kz, "dz");
    // 내 기기를 다시 넣는 add — 묶기 서명(selfSig)은 서버 목록의 공개값이라 베낄 수 있다
    let a = add("a1", &kz, "dz", &x, &k, "d1");
    answer_chain(&r, "a1", &[g.clone(), x, a]);
    let e = wrap(&d, &kc, &r, "rs", "c1", "비밀", false, now_ms()).unwrap_err();
    assert!(e.contains("내 계정"), "{e}");
    assert!(!crate::e2e_team::in_chain(&d, &relay::load_state(&d)), "바뀐 내 사슬로는 팀 명부 고리도 안 쓴다");
}

// ── 공격 재현(리뷰 B 치명 3 · 높음 4·5 · 중간 6) ──

/// 서버가 지어낸 명부 — 가짜 팀장 F(aF) 가 팀을 만들고 가짜 G(aG) 를 철수 멤버 id(m2)로 들임
fn fake_roster() -> (Vec<TLink>, Link, Link) {
    let (f, g) = (other(40), other(41));
    let t = tl(&f, "f1", 0, "", json!({ "kind": "team", "name": "샘플팀", "member": "mF", "account": "aF", "displayName": "사용자" }));
    let code = SigningKey::from_bytes(&crate::e2e_roster::invite_seed("X"));
    let pk = B64.encode(code.verifying_key().as_bytes());
    let i = tl(&f, "f1", 1, &team_hash(&t), json!({ "kind": "invite", "invPub": pk, "role": "member", "expires": 1 }));
    let mut j = tl(&g, "g1", 2, &team_hash(&i), json!({ "kind": "join", "invPub": pk, "member": "m2", "account": "aG", "displayName": "철수" }));
    j.sig2 = Some(B64.encode(code.sign(format!("chammo-team/1\n{}", j.body).as_bytes()).to_bytes()));
    (vec![t, i, j], genesis("aF", &f, "f1"), genesis("aG", &g, "g1"))
}

#[test]
fn 공격_내_자리가_없는_지어낸_명부로는_dm_을_안_보낸다() {
    let (d, kc, r, k) = me("fake-roster");
    mutate(&d, |s| s.put_team(crate::team_relay::TeamEntry { id: "t1".into(), member_id: "m1".into(), ..Default::default() })).unwrap();
    let (links, gf, gg) = fake_roster();
    answer_chain(&r, "a1", &[genesis("a1", &k, "d1")]);
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": links }).to_string());
    answer_chain(&r, "aF", &[gf]);
    answer_chain(&r, "aG", std::slice::from_ref(&gg));
    answer_chain(&r, "aG", &[gg]);
    let e = wrap(&d, &kc, &r, "r1", "c1", "철수야", false, now_ms()).unwrap_err();
    assert!(e.contains("명부"), "{e}");
}

#[test]
fn 공격_명부를_되감아_보여_주면_안_보낸다() {
    let (d, kc, r, k) = me("roster-rollback");
    mutate(&d, |s| s.put_team(crate::team_relay::TeamEntry { id: "t1".into(), member_id: "m1".into(), ..Default::default() })).unwrap();
    let peer = other(2);
    let mut long = roster_links(&k, &peer);
    long.push(tl(&k, "d1", 3, &team_hash(&long[2]), json!({ "kind": "role", "member": "m2", "role": "owner" })));
    let (g1, g2) = (genesis("a1", &k, "d1"), genesis("a2", &peer, "p1"));
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": long }).to_string());
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    assert!(wrap(&d, &kc, &r, "r1", "c1", "x", false, now_ms()).is_ok());
    // 같은 서버가 이번엔 앞부분만(역할 고리 빼고) — 되감기
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": roster_links(&k, &peer) }).to_string());
    let e = wrap(&d, &kc, &r, "r1", "c2", "x", false, now_ms()).unwrap_err();
    assert!(e.contains("명부"), "{e}");
}

#[test]
fn 공격_남의_계정이_내_기기끼리_방에_넣은_봉투는_안_받는다() {
    let (d, kc, r, k) = me("foreign-self");
    let st = relay::load_state(&d);
    let x = other(50);
    let meta = crate::e2e_envelope::Meta { room: "rs".into(), cid: "c9".into(), from: "x1".into(), head: link_hash(&genesis("a9", &x, "x1").body, &genesis("a9", &x, "x1").sig), ..Default::default() };
    let inner = crate::e2e_envelope::Inner { origin: "human".into(), text: "결제해".into(), at: now_ms(), ..Default::default() };
    let body = crate::e2e_envelope::seal(&x, &meta, &inner, &[crate::e2e_envelope::Recipient { device: "d1".into(), e2e: k.e2e_public() }]).unwrap();
    answer_chain(&r, "a9", &[genesis("a9", &x, "x1")]);
    answer_chain(&r, "a9", &[genesis("a9", &x, "x1")]);
    let m = json!({ "room": "rs", "from": { "device": "x1", "account": "a9" }, "origin": "human", "body": body });
    assert!(matches!(unwrap(&d, &kc, &r, &st, &m), Unwrapped::Failed(_)));
}

#[test]
fn 공격_핀이_있는_상대에게_빈_사슬을_주면_평문으로_안_내려간다() {
    let (d, kc, r, k) = me("downgrade");
    mutate(&d, |s| s.put_team(crate::team_relay::TeamEntry { id: "t1".into(), member_id: "m1".into(), ..Default::default() })).unwrap();
    let peer = other(2);
    let (g1, g2) = (genesis("a1", &k, "d1"), genesis("a2", &peer, "p1"));
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": roster_links(&k, &peer) }).to_string());
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    assert!(wrap(&d, &kc, &r, "r1", "c1", "x", false, now_ms()).is_ok());
    // 상대 사슬을 빈 것으로
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": roster_links(&k, &peer) }).to_string());
    answer_chain(&r, "a2", &[]);
    assert!(wrap(&d, &kc, &r, "r1", "c2", "x", false, now_ms()).is_err(), "핀이 있던 상대는 평문으로 안 보낸다");
    // 빈 명부도
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, r#"{"links":[]}"#);
    assert!(wrap(&d, &kc, &r, "r1", "c3", "x", false, now_ms()).is_err(), "명부가 있던 팀은 평문으로 안 보낸다");
    // 받기: 내 사슬이 있는데 내 기기끼리 방에 평문이 오면 안 받는다
    let st = relay::load_state(&d);
    assert!(matches!(unwrap(&d, &kc, &r, &st, &json!({ "room": "rs", "from": { "device": "d1", "account": "a1" }, "body": "평문" })), Unwrapped::Failed(_)));
}

#[test]
fn 같은_봉투를_다시_넣으면_새_말로_안_받는다() {
    let (d, kc, r, k) = me("replay");
    answer_chain(&r, "a1", &[genesis("a1", &k, "d1")]);
    let body = wrap(&d, &kc, &r, "rs", "c1", "한 번", false, now_ms()).unwrap();
    let st = relay::load_state(&d);
    let m = json!({ "room": "rs", "seq": 1, "from": { "device": "d1", "account": "a1" }, "body": body });
    assert!(matches!(unwrap(&d, &kc, &r, &st, &m), Unwrapped::Opened { .. }));
    let again = json!({ "room": "rs", "seq": 9, "from": { "device": "d1", "account": "a1" }, "body": body });
    assert!(matches!(unwrap(&d, &kc, &r, &st, &again), Unwrapped::Failed(_)), "새 seq 로 다시 넣은 옛 봉투");
}

#[test]
fn 공격_가짜_팀장의_옮기기_목록에_내_자리를_끼운_명부는_안_믿는다() {
    // 2차 리뷰 높음 2(R1·R2) — 옮기기 목록 자리는 누가 서명했는지 안 봐서 통과했다
    let (d, kc, r, k) = me("fake-migrate");
    let (f, g) = (other(40), other(41));
    let t = tl(&f, "f1", 0, "", json!({ "kind": "team", "name": "샘플팀", "member": "mF", "account": "aF", "displayName": "가짜", "members": [
        { "member": "mF", "account": "aF", "displayName": "가짜", "role": "owner" },
        { "member": "m1", "account": "a1", "displayName": "사용자", "role": "member" },
        { "member": "m2", "account": "aG", "displayName": "철수", "role": "member" } ] }));
    answer_chain(&r, "a1", &[genesis("a1", &k, "d1")]);
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": [t] }).to_string());
    answer_chain(&r, "aF", &[genesis("aF", &f, "f1")]);
    answer_chain(&r, "aG", &[genesis("aG", &g, "g1")]);
    answer_chain(&r, "aG", &[genesis("aG", &g, "g1")]);
    let e = wrap(&d, &kc, &r, "r1", "c1", "철수야", false, now_ms()).unwrap_err();
    assert!(e.contains("명부"), "{e}");
}

#[test]
fn 공격_신원이_바뀐_계정이_서명한_명부_고리는_그_사람만_막고_명부는_산다() {
    // 2차 리뷰 중간 4(R3) — reset 한 공격 기기가 그 사람 이름으로 '나가기'를 서명해 명부를 바꿨다.
    // 예전엔 명부 전체를 버려 팀 전체가 멈췄다(10-26 종단 시험) — 이제 그 고리는 구조로만 반영되고, 바뀐 그 사람에겐 받아들이기 전까지 안 보낸다(결정 5)
    let (d, kc, r, k) = me("changed-signer");
    let peer = other(2);
    let (g1, g2) = (genesis("a1", &k, "d1"), genesis("a2", &peer, "p1"));
    let links = roster_links(&k, &peer);
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": links }).to_string());
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    assert!(wrap(&d, &kc, &r, "r1", "c1", "x", false, now_ms()).is_ok());
    // a2 사슬에 공격자 reset(dz), 그 기기로 철수 '나가기' 고리
    let kz = other(77);
    let x = reset("a2", &g2, &kz, "dz");
    let mut l2 = links.clone();
    l2.push(tl(&kz, "dz", 3, &team_hash(&links[2]), json!({ "kind": "leave", "member": "m2" })));
    answer_chain(&r, "a2", &[g2.clone(), x]);
    chain_of(&d, &kc, &r, &relay::load_state(&d), "a2", true).unwrap();
    let st = relay::load_state(&d);
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": l2 }).to_string());
    // 캐시로 검증이 틀리면 한 번 새로 받는다 — 서버는 또 공격 사슬을 준다
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    answer_chain(&r, "a2", &[g2.clone(), reset("a2", &g2, &kz, "dz")]);
    let ro = roster_of(&d, &kc, &r, &st, "t1").expect("한 사람이 바뀌었다고 명부 전체를 버리지 않는다");
    assert!(!ro.members["m2"].active, "줄어드는 쪽(나가기)은 반영");
    assert!(ro.members["m1"].confirmed);
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": l2 }).to_string());
    answer_chain(&r, "a2", &[g2.clone(), reset("a2", &g2, &kz, "dz")]);
    answer_chain(&r, "a2", &[g2.clone(), reset("a2", &g2, &kz, "dz")]);
    assert!(wrap(&d, &kc, &r, "r1", "c2", "x", false, now_ms()).is_err(), "바뀐 그 사람에겐 안 보낸다");
}

#[test]
fn 공격_전환기_핑계로_명부에_있던_사람의_평문은_안_받는다() {
    // R8 — 한 번 명부에 든 사람은 해시 사슬이라 서버가 못 지운다. 그 사람 이름의 평문은 내려앉히기
    let (d, kc, r, k) = me("migrate-downgrade");
    let peer = other(2);
    let (g1, g2) = (genesis("a1", &k, "d1"), genesis("a2", &peer, "p1"));
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": roster_links(&k, &peer) }).to_string());
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    assert!(wrap(&d, &kc, &r, "r1", "c1", "x", false, now_ms()).is_ok());
    let st = relay::load_state(&d);
    assert_eq!(unwrap(&d, &kc, &r, &st, &json!({ "room": "r1", "from": { "device": "p1", "account": "a2", "member": "m2" }, "body": "평문" })), Unwrapped::Failed("plain".into()));
}

#[test]
fn 공격_명부를_본_뒤엔_사슬에서_빠진_기기가_서명한_새_고리는_확인_전_빠짐은_의심() {
    // 3차 리뷰 중간(R3) — 한 번이라도 든 기기(ever) 서명을 다 받아, 뺀 훔친 기기가 털린 서버와 함께 그 사람 이름 고리를 계속 썼다
    let (d, kc, r, k) = me("roster-removed-signer");
    let peer = other(2);
    let stolen = other(9);
    let g2 = genesis("a2", &peer, "p1");
    let a2 = add("a2", &peer, "p1", &g2, &stolen, "p9");
    let rm = clink("a2", &peer, "p1", 2, &link_hash(&a2.body, &a2.sig), json!({ "kind": "remove", "device": "p9" }));
    let peer_chain = vec![g2, a2, rm];
    let g1 = genesis("a1", &k, "d1");
    let links = roster_links(&k, &peer);
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": links }).to_string());
    answer_chain(&r, "a2", &peer_chain);
    answer_chain(&r, "a2", &peer_chain);
    assert!(wrap(&d, &kc, &r, "r1", "c1", "x", false, now_ms()).is_ok(), "명부 핀");
    // 뺀 기기 p9 로 철수 '나가기'
    let mut l2 = links.clone();
    l2.push(tl(&stolen, "p9", 3, &team_hash(&links[2]), json!({ "kind": "leave", "member": "m2" })));
    let st = relay::load_state(&d);
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": l2 }).to_string());
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    answer_chain(&r, "a2", &peer_chain);
    // 공격 리뷰 2 뒤(10-26) — 구조는 한 번이라도 든 기기로 보고(정상 다시 시작에서 기기마다 갈려 팀 전체가 멈추던 것),
    // 핀 뒤 뺀 기기 서명은 믿음 쪽에서 확인 전 — 빠짐은 반영(기밀이 먼저)하고 의심으로 남긴다
    let ro = roster_of(&d, &kc, &r, &st, "t1").expect("명부는 산다");
    assert!(!ro.members["m2"].active);
    assert_eq!(ro.doubts, vec!["m2".to_string()], "뺀 기기 서명으로 빠짐 — 의심");
}

#[test]
fn 오래된_봉투는_받지_않고_까닭을_남기고_먼_미래_봉투도_안_받는다() {
    // 3차 리뷰 낮음 — 30일 넘은 봉투(꺼져 있던 기기의 밀린 말·시계 틀린 기기), 먼 미래 시각 봉투(거르기 목록에서 안 빠진다)
    let (d, kc, r, k) = me("too-old");
    let g1 = genesis("a1", &k, "d1");
    seed_trusted(&d, "a1", vec![g1.clone()]);
    let st = relay::load_state(&d);
    let day = 24 * 3600_000u64;
    for (cid, at, why) in [("old", now_ms() - 31 * day, "too-old"), ("future", now_ms() + 2 * day, "future")] {
        answer_chain(&r, "a1", std::slice::from_ref(&g1));
        let body = wrap(&d, &kc, &r, "rs", cid, "밀린 말", false, at).expect("봉투");
        let m = json!({ "room": "rs", "from": { "device": "d1", "account": "a1" }, "body": body });
        assert_eq!(unwrap(&d, &kc, &r, &st, &m), Unwrapped::Failed(why.into()));
    }
    assert!(load(&d).seen_at.is_empty(), "거르기 목록에 안 넣는다");
}

// ── 공격 재현(4차 리뷰, R8 암호 전용): 평문으로 내려앉히기·평문 주입 ──

#[test]
fn 공격_새_기기에_빈_명부를_주면_평문으로_안_내려간다() {
    // 4차 리뷰 높음 1 — 이 기기 기억(my_place)이 빈 새 기기에 서버가 빈 명부를 주면 DM 이 평문으로 나갔다
    let (d, kc, r, k) = me("r8-empty-roster");
    answer_chain(&r, "a1", &[genesis("a1", &k, "d1")]);
    r.answer("/v0/teams/t1/log", 200, r#"{"links":[]}"#);
    assert!(wrap(&d, &kc, &r, "r1", "c1", "철수야", false, now_ms()).is_err(), "명부가 없으면 안 보낸다(평문 없음)");
}

#[test]
fn 공격_확인_전_새_기기에_내_기기끼리_방_평문을_넣어도_안_받는다() {
    // 4차 리뷰 높음 2 — 핀이 없는 새 기기는 self 방 평문을 받아 '[내 다른 기기 사람 말]'로 넘겼다
    let (d, kc, r, _) = me("r8-self-inject");
    let st = relay::load_state(&d);
    let m = json!({ "room": "rs", "from": { "device": "d2", "account": "a1" }, "origin": "human", "body": "결제해" });
    assert_eq!(unwrap(&d, &kc, &r, &st, &m), Unwrapped::Failed("plain".into()));
    let t = json!({ "room": "r1", "from": { "device": "p1", "account": "a2", "member": "m2" }, "body": "평문" });
    assert_eq!(unwrap(&d, &kc, &r, &st, &t), Unwrapped::Failed("plain".into()), "팀 방도 평문은 안 받는다");
}

#[test]
fn 공격_사슬은_있는데_이_기기는_밖이라고_하면_평문으로_안_보낸다() {
    // 4차 리뷰 중간 — 서버가 '사슬은 있는데 너는 없다'를 주면 평문으로 보냈다
    let (d, kc, r, _) = me("r8-outside");
    let x = other(30);
    answer_chain(&r, "a1", &[genesis("a1", &x, "dX")]);
    assert!(wrap(&d, &kc, &r, "rs", "c1", "나야", false, now_ms()).is_err());
    answer_chain(&r, "a1", &[]);
    assert!(wrap(&d, &kc, &r, "rs", "c2", "나야", false, now_ms()).is_err(), "사슬이 없어도 평문 없음");
}

// ── 단톡방(계획 2026-10-26 team-rooms) — 받는 사람은 서버 방 목록이 아니라 명부 room 고리 ──

/// 팀 t1 에 민수(m3, a3, 기기 q1)도 들어오고, 내가 단톡방 r2 = [나, 철수] 를 만든 명부
fn group_links(mine: &DeviceKeys, peer: &DeviceKeys, third: &DeviceKeys) -> Vec<TLink> {
    let mut ls = roster_links(mine, peer);
    let code = SigningKey::from_bytes(&crate::e2e_roster::invite_seed("C3"));
    let pk = B64.encode(code.verifying_key().as_bytes());
    ls.push(tl(mine, "d1", 3, &team_hash(&ls[2]), json!({ "kind": "invite", "invPub": pk, "role": "member", "expires": 1 })));
    let mut j = tl(third, "q1", 4, &team_hash(&ls[3]), json!({ "kind": "join", "invPub": pk, "member": "m3", "account": "a3", "displayName": "민수" }));
    j.sig2 = Some(B64.encode(code.sign(format!("chammo-team/1\n{}", j.body).as_bytes()).to_bytes()));
    ls.push(j);
    ls.push(tl(mine, "d1", 5, &team_hash(&ls[4]), json!({ "kind": "room", "room": "r2", "name": "디자인", "members": ["m1", "m2"], "member": "m1", "account": "a1" })));
    ls
}

/// 서버는 r2 에 민수까지 넣었다고 말한다(공격) — 앱은 명부만 믿는다
fn with_group(d: &std::path::Path) {
    mutate(d, |s| s.rooms.push(Room { id: "r2".into(), kind: "group".into(), team: "t1".into(), name: "디자인".into(), members: vec!["m1".into(), "m2".into(), "m3".into()], ..Default::default() })).unwrap();
}

#[test]
fn 단톡방은_명부의_방_사람_사슬_기기에만_봉한다_서버가_끼운_사람은_못_받는다() {
    let (d, kc, r, k) = me("group");
    with_group(&d);
    let (peer, third) = (other(2), other(3));
    let (g1, g2, g3) = (genesis("a1", &k, "d1"), genesis("a2", &peer, "p1"), genesis("a3", &third, "q1"));
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": group_links(&k, &peer, &third) }).to_string());
    for (a, g) in [("a2", &g2), ("a3", &g3), ("a2", &g2)] {
        answer_chain(&r, a, std::slice::from_ref(g));
    }
    let body = wrap(&d, &kc, &r, "r2", "c1", "다들 안녕", false, now_ms()).expect("봉투");
    let v: Value = serde_json::from_str(&body).unwrap();
    let mut ds: Vec<_> = v["env"].as_array().unwrap().iter().map(|e| e["d"].as_str().unwrap().to_string()).collect();
    ds.sort();
    assert_eq!(ds, vec!["d1", "p1"], "민수(q1)는 명부상 방 사람이 아니라 봉투가 없다");
    assert!(v["peers"].get("a3").is_none());
}

#[test]
fn 단톡방_말은_명부의_방_사람이_보낸_것만_받는다() {
    let (d, kc, r, k) = me("group-in");
    with_group(&d);
    let (peer, third) = (other(2), other(3));
    let (g1, g3) = (genesis("a1", &k, "d1"), genesis("a3", &third, "q1"));
    let st = relay::load_state(&d);
    // 민수(방 밖)가 r2 에 넣은 봉투 — 서버 방 목록엔 있어도 명부엔 없다
    let meta = Meta { room: "r2".into(), cid: "x1".into(), from: "q1".into(), head: link_hash(&g3.body, &g3.sig), ..Default::default() };
    let inner = Inner { origin: "agent".into(), text: "끼어들기".into(), at: now_ms(), ..Default::default() };
    let to = vec![Recipient { device: "d1".into(), e2e: k.e2e_public() }];
    let body = e2e_envelope::seal(&third, &meta, &inner, &to).unwrap();
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": group_links(&k, &peer, &third) }).to_string());
    r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [genesis("a2", &peer, "p1")] }).to_string());
    r.always("GET", "/v0/accounts/a3/chain", 200, &json!({ "links": [g3.clone()] }).to_string());
    let m = json!({ "room": "r2", "body": body, "from": { "device": "q1", "account": "a3" } });
    assert_eq!(unwrap(&d, &kc, &r, &st, &m), Unwrapped::Failed("account".into()));
}

#[test]
fn 명부에_없는_단톡방_내가_빠진_단톡방엔_안_보낸다() {
    let (d, kc, r, k) = me("group-gone");
    with_group(&d);
    let (peer, third) = (other(2), other(3));
    let g1 = genesis("a1", &k, "d1");
    let mut ls = group_links(&k, &peer, &third);
    // 내가 r2 에서 나감
    let prev = team_hash(ls.last().unwrap());
    ls.push(tl(&k, "d1", 6, &prev, json!({ "kind": "room", "room": "r2", "name": "디자인", "members": ["m2"], "member": "m1", "account": "a1" })));
    answer_chain(&r, "a1", std::slice::from_ref(&g1));
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [genesis("a2", &peer, "p1")] }).to_string());
    r.always("GET", "/v0/accounts/a3/chain", 200, &json!({ "links": [genesis("a3", &third, "q1")] }).to_string());
    let e = wrap(&d, &kc, &r, "r2", "c1", "x", false, now_ms()).unwrap_err();
    assert!(e.contains("빠졌어"), "{e}");
}

#[test]
fn 팀_참모_답은_via_helper_로_열리고_사람_말은_via_를_달아도_아니다() {
    let (d, kc, r, k) = me("helper-via");
    let g = genesis("a1", &k, "d1");
    let st = relay::load_state(&d);
    let msg = |body: String, origin: &str| json!({ "t": "msg", "room": "rs", "from": { "device": "d1", "account": "a1" }, "origin": origin, "body": body });
    answer_chain(&r, "a1", std::slice::from_ref(&g));
    let body = wrap_helper(&d, &kc, &r, "rs", "h1", "- 3시 회의", now_ms()).expect("봉투");
    assert!(matches!(unwrap(&d, &kc, &r, &st, &msg(body, "agent")), Unwrapped::Opened { ref via, human: false, .. } if via == "helper"));
    // 바깥이 human 이면(사람 말 문으로 보낸 봉투) via 를 안 믿는다
    answer_chain(&r, "a1", std::slice::from_ref(&g));
    let body = wrap_helper(&d, &kc, &r, "rs", "h2", "가짜", now_ms()).expect("봉투");
    assert!(matches!(unwrap(&d, &kc, &r, &st, &msg(body, "human")), Unwrapped::Opened { ref via, .. } if via.is_empty()));
    // 안쪽이 human 인데 via 를 단 봉투도 아니다
    answer_chain(&r, "a1", std::slice::from_ref(&g));
    let a = audience(&d, &kc, &r, "rs").unwrap();
    let meta = crate::e2e_envelope::Meta { room: "rs".into(), cid: "h3".into(), from: "d1".into(), head: a.head, ..Default::default() };
    let inner = Inner { origin: "human".into(), text: "가짜".into(), at: now_ms(), via: "helper".into(), ..Default::default() };
    let body = crate::e2e_envelope::seal(&relay::device_keys(&kc, &st).unwrap(), &meta, &inner, &a.to).unwrap();
    assert!(matches!(unwrap(&d, &kc, &r, &st, &msg(body, "agent")), Unwrapped::Opened { ref via, .. } if via.is_empty()));
}

// ── 한 사람 신원이 바뀌어도 팀 전체가 멈추지 않는다(계획 2026-10-26-e2e-recover §9 S1·S7·S13, 10-26 종단 시험) ──

fn inv_pair(code: &str) -> (SigningKey, String) {
    let c = SigningKey::from_bytes(&crate::e2e_roster::invite_seed(code));
    let pk = B64.encode(c.verifying_key().as_bytes());
    (c, pk)
}

fn next(by: &DeviceKeys, by_id: &str, ls: &[TLink], f: Value) -> TLink {
    tl(by, by_id, ls.len() as u64, &team_hash(ls.last().unwrap()), f)
}

fn join_by(by: &DeviceKeys, by_id: &str, ls: &[TLink], code: &str, member: &str, account: &str, name: &str) -> TLink {
    let (c, pk) = inv_pair(code);
    let mut j = next(by, by_id, ls, json!({ "kind": "join", "invPub": pk, "member": member, "account": account, "displayName": name }));
    j.sig2 = Some(B64.encode(c.sign(format!("chammo-team/1\n{}", j.body).as_bytes()).to_bytes()));
    j
}

fn sealed_from(from: &DeviceKeys, from_id: &str, head: &Link, room: &str, cid: &str, text: &str, to: &DeviceKeys) -> String {
    let m = crate::e2e_envelope::Meta { room: room.into(), cid: cid.into(), from: from_id.into(), head: link_hash(&head.body, &head.sig), peers: Default::default(), roster: String::new() };
    let inner = crate::e2e_envelope::Inner { origin: "human".into(), text: text.into(), at: now_ms(), ..Default::default() };
    crate::e2e_envelope::seal(from, &m, &inner, &[crate::e2e_envelope::Recipient { device: "d1".into(), e2e: to.e2e_public() }]).unwrap()
}

#[test]
fn 바뀐_사람이_다시_들어와도_다른_사람에겐_보내고_그_사람_말은_기록만() {
    let (d, kc, r, k) = me("rejoin");
    let (p2, p3, pz) = (other(2), other(3), other(50));
    mutate(&d, |s| {
        s.rooms.push(Room { id: "r3".into(), kind: "dm".into(), peer: "m3".into(), team: "t1".into(), ..Default::default() });
        s.rooms.push(Room { id: "r4".into(), kind: "dm".into(), peer: "m4".into(), team: "t1".into(), ..Default::default() });
    })
    .unwrap();
    // 나(m1) 팀장 · 철수(m2, p1) · 민수(m3, q1) → 철수 뺌 → 다시 시작한 철수(pz)가 새 초대로 m4
    let mut ls = roster_links(&k, &p2);
    let (_, pk3) = inv_pair("C3");
    ls.push(next(&k, "d1", &ls, json!({ "kind": "invite", "invPub": pk3, "role": "member", "expires": 1 })));
    ls.push(join_by(&p3, "q1", &ls, "C3", "m3", "a3", "민수"));
    ls.push(next(&k, "d1", &ls, json!({ "kind": "remove", "member": "m2" })));
    let (_, pk4) = inv_pair("C4");
    ls.push(next(&k, "d1", &ls, json!({ "kind": "invite", "invPub": pk4, "role": "member", "expires": 1 })));
    ls.push(join_by(&pz, "pz", &ls, "C4", "m4", "a2", "철수"));
    let (g1, g2, g3) = (genesis("a1", &k, "d1"), genesis("a2", &p2, "p1"), genesis("a3", &p3, "q1"));
    let x = reset("a2", &g2, &pz, "pz");
    // 철수 옛 사슬을 핀해 둔 상태(어제 만남)
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    chain_of(&d, &kc, &r, &relay::load_state(&d), "a2", true).unwrap();
    r.always("GET", "/v0/accounts/a1/chain", 200, &json!({ "links": [g1] }).to_string());
    r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [g2.clone(), x.clone()] }).to_string());
    r.always("GET", "/v0/accounts/a3/chain", 200, &json!({ "links": [g3] }).to_string());
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    // 민수에겐 보낸다(예전엔 '팀 명부가 틀렸어' 로 팀 전체가 멈췄다)
    let body = wrap(&d, &kc, &r, "r3", "c1", "민수야", false, now_ms()).expect("다른 사람에겐 보낸다");
    let v: Value = serde_json::from_str(&body).unwrap();
    let mut ds: Vec<_> = v["env"].as_array().unwrap().iter().map(|e| e["d"].as_str().unwrap().to_string()).collect();
    ds.sort();
    assert_eq!(ds, vec!["d1", "q1"], "다시 시작한 철수 기기엔 안 봉한다");
    // 철수에겐 받아들이기 전엔 안 보낸다
    let e = wrap(&d, &kc, &r, "r4", "c2", "철수야", false, now_ms()).unwrap_err();
    assert!(e.contains("보안 번호가 바뀌었어"), "{e}");
    // 철수가 보낸 말 — 받되 기록만(note changed)
    let st = relay::load_state(&d);
    let m = json!({ "room": "r4", "from": { "device": "pz", "account": "a2" }, "origin": "human", "body": sealed_from(&pz, "pz", &x, "r4", "z1", "나 다시 왔어", &k) });
    assert!(matches!(unwrap(&d, &kc, &r, &st, &m), Unwrapped::Opened { ref note, ref text, .. } if note == "changed" && text == "나 다시 왔어"));
}

#[test]
fn 다시_시작한_팀장의_초대로_들어온_사람은_사슬이_멀쩡해도_확인_전() {
    // S7 — 팀장 철수(a2)가 다시 시작(pz) → 그 기기로 낸 초대로 민수(a3, 사슬 멀쩡)가 들어옴. 서버가 지어낸 팀장 초대로 가짜 사람을 믿게 하는 길
    let (d, kc, r, k) = me("tainted-invite");
    let (p2, p3, pz) = (other(2), other(3), other(50));
    mutate(&d, |s| s.rooms.push(Room { id: "r3".into(), kind: "dm".into(), peer: "m3".into(), team: "t1".into(), ..Default::default() })).unwrap();
    let mut ls = vec![tl(&p2, "p1", 0, "", json!({ "kind": "team", "name": "샘플팀", "member": "m2", "account": "a2", "displayName": "철수" }))];
    let (_, pk1) = inv_pair("C1");
    ls.push(next(&p2, "p1", &ls, json!({ "kind": "invite", "invPub": pk1, "role": "member", "expires": 1 })));
    ls.push(join_by(&k, "d1", &ls, "C1", "m1", "a1", "사용자"));
    let (_, pk3) = inv_pair("C3");
    ls.push(next(&pz, "pz", &ls, json!({ "kind": "invite", "invPub": pk3, "role": "member", "expires": 1 })));
    ls.push(join_by(&p3, "q1", &ls, "C3", "m3", "a3", "민수"));
    let (g1, g2, g3) = (genesis("a1", &k, "d1"), genesis("a2", &p2, "p1"), genesis("a3", &p3, "q1"));
    let x = reset("a2", &g2, &pz, "pz");
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    chain_of(&d, &kc, &r, &relay::load_state(&d), "a2", true).unwrap();
    r.always("GET", "/v0/accounts/a1/chain", 200, &json!({ "links": [g1] }).to_string());
    r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [g2, x] }).to_string());
    r.always("GET", "/v0/accounts/a3/chain", 200, &json!({ "links": [g3.clone()] }).to_string());
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    let e = wrap(&d, &kc, &r, "r3", "c1", "민수야", false, now_ms()).unwrap_err();
    assert!(e.contains("확인 전 멤버"), "{e}");
    let st = relay::load_state(&d);
    let m = json!({ "room": "r3", "from": { "device": "q1", "account": "a3" }, "origin": "human", "body": sealed_from(&p3, "q1", &g3, "r3", "z1", "안녕", &k) });
    assert!(matches!(unwrap(&d, &kc, &r, &st, &m), Unwrapped::Opened { ref note, .. } if note == "changed"), "확인 전 멤버의 말은 기록만");
    // 내가 만든 단톡방(나·민수) — 민수 사슬이 멀쩡해도 확인 전이라 빼고, 받을 사람이 없으니 안 보낸다
    let mut l2 = ls.clone();
    l2.push(next(&k, "d1", &l2, json!({ "kind": "room", "room": "g1", "name": "둘", "members": ["m1", "m3"], "member": "m1", "account": "a1" })));
    mutate(&d, |s| s.rooms.push(Room { id: "g1".into(), kind: "group".into(), team: "t1".into(), name: "둘".into(), ..Default::default() })).unwrap();
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": l2 }).to_string());
    let e = wrap(&d, &kc, &r, "g1", "c3", "둘이", false, now_ms()).unwrap_err();
    assert!(e.contains("받을 수 있는 사람이 없어"), "{e}");
    // 보관함 — 확인 전 민수는 받는 사람도 올린 사람 확인(서명자)도 아니다
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": l2 }).to_string());
    let lp = locker_people(&d, &kc, &r, &relay::load_state(&d), "t1").unwrap();
    assert!(!lp.signers.contains_key("q1") && lp.skipped.contains(&"민수".to_string()));
    // 서버가 민수 다시 시작을 지어냄(바뀜) — 확인 전이던 사람의 처음 본 앞부분도 서명자로 안 쓴다(공격 리뷰 5)
    r.always.borrow_mut().retain(|x| x.1 != "/v0/accounts/a3/chain");
    r.always("GET", "/v0/accounts/a3/chain", 200, &json!({ "links": [g3.clone(), reset("a3", &g3, &other(61), "q9")] }).to_string());
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": l2 }).to_string());
    let lp = locker_people(&d, &kc, &r, &relay::load_state(&d), "t1").unwrap();
    assert!(!lp.signers.contains_key("q1") && !lp.signers.contains_key("q9"));
}

#[test]
fn 단톡방은_확인_전_사람만_빼고_확인_전_사람이_만든_방엔_안_보내고_고치지도_않는다() {
    // S4·S10 — 나(m1)·민수(m3)·다시 들어온 철수(m4, pz). 내가 만든 방 g1(셋) / 철수가 만든 방 g2(셋)
    let (d, kc, r, k) = me("rejoin-group");
    let (p2, p3, pz) = (other(2), other(3), other(50));
    mutate(&d, |s| {
        s.rooms.push(Room { id: "g1".into(), kind: "group".into(), team: "t1".into(), name: "셋".into(), ..Default::default() });
        s.rooms.push(Room { id: "g2".into(), kind: "group".into(), team: "t1".into(), name: "철수방".into(), ..Default::default() });
    })
    .unwrap();
    let mut ls = roster_links(&k, &p2);
    let (_, pk3) = inv_pair("C3");
    ls.push(next(&k, "d1", &ls, json!({ "kind": "invite", "invPub": pk3, "role": "member", "expires": 1 })));
    ls.push(join_by(&p3, "q1", &ls, "C3", "m3", "a3", "민수"));
    ls.push(next(&k, "d1", &ls, json!({ "kind": "remove", "member": "m2" })));
    let (_, pk4) = inv_pair("C4");
    ls.push(next(&k, "d1", &ls, json!({ "kind": "invite", "invPub": pk4, "role": "member", "expires": 1 })));
    ls.push(join_by(&pz, "pz", &ls, "C4", "m4", "a2", "철수"));
    ls.push(next(&k, "d1", &ls, json!({ "kind": "room", "room": "g1", "name": "셋", "members": ["m1", "m3", "m4"], "member": "m1", "account": "a1" })));
    ls.push(next(&pz, "pz", &ls, json!({ "kind": "room", "room": "g2", "name": "철수방", "members": ["m4", "m1", "m3"], "member": "m4", "account": "a2" })));
    let (g1, g2, g3) = (genesis("a1", &k, "d1"), genesis("a2", &p2, "p1"), genesis("a3", &p3, "q1"));
    let x = reset("a2", &g2, &pz, "pz");
    answer_chain(&r, "a2", std::slice::from_ref(&g2));
    chain_of(&d, &kc, &r, &relay::load_state(&d), "a2", true).unwrap();
    r.always("GET", "/v0/accounts/a1/chain", 200, &json!({ "links": [g1] }).to_string());
    r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [g2, x] }).to_string());
    r.always("GET", "/v0/accounts/a3/chain", 200, &json!({ "links": [g3.clone()] }).to_string());
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    // 내가 만든 방 — 민수에게만(철수 기기엔 안 봉함)
    let body = wrap(&d, &kc, &r, "g1", "c1", "다들", false, now_ms()).expect("확인된 방");
    let v: Value = serde_json::from_str(&body).unwrap();
    let mut ds: Vec<_> = v["env"].as_array().unwrap().iter().map(|e| e["d"].as_str().unwrap().to_string()).collect();
    ds.sort();
    assert_eq!(ds, vec!["d1", "q1"]);
    // 철수가 만든 방 — 받아들이기 전엔 안 보낸다(그 방에 누구를 넣었는지 믿을 수 없다)
    let e = wrap(&d, &kc, &r, "g2", "c2", "x", false, now_ms()).unwrap_err();
    assert_eq!(e, ROOM_UNCONFIRMED);
    // 그 방에서 민수가 보낸 말 — 받되 기록만
    let st = relay::load_state(&d);
    let m = json!({ "room": "g2", "from": { "device": "q1", "account": "a3" }, "origin": "human", "body": sealed_from(&p3, "q1", &g3, "g2", "z1", "응", &k) });
    assert!(matches!(unwrap(&d, &kc, &r, &st, &m), Unwrapped::Opened { ref note, .. } if note == "changed"));
    // 내 믿는 서명으로 이어 고치지 않는다(끼운 사람이 확인됨이 되는 길)
    let before = r.seen.borrow().iter().filter(|(m, _, _, _)| m == "POST").count();
    let e = crate::team_rooms::update_room(&d, &kc, &r, "g2", Some("새 이름"), &[], &[]).unwrap_err();
    assert!(e.contains("확인된 적이 없어"), "{e}");
    assert_eq!(r.seen.borrow().iter().filter(|(m, _, _, _)| m == "POST").count(), before, "서버에 아무것도 안 보냄");
}

#[test]
fn 공격_같은_기기_id_가_다른_열쇠로_오면_그_id_로는_파일을_못_연다() {
    // 공격 리뷰 5 — 확인된 멤버가 자기 사슬에 남의 기기 id 를 자기 열쇠로 넣어 그 기기 이름으로 파일을 꾸미던 길
    let mut to = BTreeMap::from([("p1".to_string(), "ED-A".to_string())]);
    add_signers(&mut to, &BTreeMap::from([("p1".to_string(), "ED-B".to_string()), ("q1".to_string(), "ED-Q".to_string())]));
    assert_eq!(to["p1"], "", "겹친 id 는 빈 열쇠(서명 확인이 늘 실패)");
    assert_eq!(to["q1"], "ED-Q");
    add_signers(&mut to, &BTreeMap::from([("p1".to_string(), "ED-A".to_string())]));
    assert_eq!(to["p1"], "", "한 번 겹친 id 는 되살아나지 않는다");
}

#[test]
fn 보관함_새_폴더는_사람_확인을_한_번만_한다() {
    // 10-26 사용자 "폴더 만드는데 한참" — 새 폴더가 사람 확인(내 사슬·명부·사람마다 사슬)을 두 번 차례로 불러 운영에서 호출 11번(약 7초)이었다
    let (d, kc, r, k) = me("lk-mkdir");
    let p1 = other(2);
    r.always("GET", "/v0/accounts/a1/chain", 200, &json!({ "links": [genesis("a1", &k, "d1")] }).to_string());
    r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [genesis("a2", &p1, "p1")] }).to_string());
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": roster_links(&k, &p1) }).to_string());
    r.always("GET", "/v0/teams/t1/locker", 200, &json!({ "rev": 1, "files": [] }).to_string());
    r.always("POST", "/v0/teams/t1/locker/files", 503, r#"{"error":"stop"}"#);
    let _ = crate::team_locker_app::mkdir(&d, &kc, &r, "t1", "새 폴더");
    let seen = r.seen.borrow();
    let n = |p: &str| seen.iter().filter(|(m, x, ..)| m == "GET" && x == p).count();
    assert!(seen.iter().any(|(m, x, ..)| m == "POST" && x == "/v0/teams/t1/locker/files"), "표시 줄을 올리러 갔다");
    assert_eq!(n("/v0/teams/t1/log"), 1, "명부는 한 번");
    assert_eq!(n("/v0/accounts/a1/chain"), 1, "내 사슬도 한 번(철수 사슬은 처음 보는 거라 명부 확인·받는 사람 셈에서 한 번씩)");
    let posted: Value = serde_json::from_str(&seen.iter().find(|(m, x, ..)| m == "POST" && x == "/v0/teams/t1/locker/files").unwrap().3).unwrap();
    let mut to: Vec<_> = posted["keys"].as_array().unwrap().iter().map(|e| e["d"].as_str().unwrap_or_default().to_string()).collect();
    to.sort();
    assert_eq!(to, vec!["d1", "p1"], "받는 기기는 새로 확인한 사람 목록 그대로(나·철수)");
}

#[test]
fn 서버_머리_seq_가_u64_끝이어도_죽지_않고_새로_받는다() {
    // 10-27 리뷰 — 서버가 준 머리 seq 로 seq + 1 을 셈해서 u64::MAX 면 디버그에서 오버플로 패닉(남의 서버 값)
    let (d, kc, r, mine) = me("heads-max");
    let st = relay::load_state(&d);
    let p1 = other(2);
    let g = genesis("a2", &p1, "p1");
    answer_chain(&r, "a2", std::slice::from_ref(&g));
    chain_of(&d, &kc, &r, &st, "a2", true).unwrap();
    let h = Heads { log: Some((u64::MAX, "x".into())), chains: BTreeMap::from([("a2".to_string(), Some((u64::MAX, "x".to_string())))]) };
    answer_chain(&r, "a2", std::slice::from_ref(&g));
    assert!(matches!(chain_fresh(&d, &kc, &r, &st, "a2", Some(&h)).unwrap(), Trust::Ok(_)), "머리가 안 맞으면 새로 받아 그대로 믿는다");
    let links = roster_links(&mine, &other(7));
    super::mutate(&d, |s| {
        s.rosters.insert("t1".into(), links.clone());
    })
    .unwrap();
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": links }).to_string());
    r.always("GET", "/chain", 404, r#"{"error":"not_found"}"#); // 명부 사람 사슬 — 이 시험은 패닉 여부만
    let _ = roster_with(&d, &kc, &r, &st, "t1", Some(&h)); // 패닉만 없으면 된다(명부 검증 결과는 이 시험 몫 아님)
    let got = |p: &str| r.seen.borrow().iter().filter(|(m, path, _, _)| m == "GET" && path.ends_with(p)).count();
    assert_eq!(got("/v0/accounts/a2/chain"), 2, "사슬은 캐시와 안 맞으니 새로");
    assert_eq!(got("/v0/teams/t1/log"), 1, "명부도 새로");
}

// ── 지난 대화 건네받기(chammo-relay ADR 0007 R10) — 나는 새 기기 d1, 옛 기기 d0 가 사슬을 시작했고 d1 을 add ──

/// (d0 열쇠, 사슬) — d1 은 사슬을 믿는 상태(숫자 확인 뒤)
fn late_setup(d: &std::path::Path, r: &FakeRelay, k: &DeviceKeys) -> (DeviceKeys, Vec<Link>) {
    let a = other(5);
    let g = genesis("a1", &a, "d0");
    let l1 = add("a1", &a, "d0", &g, k, "d1");
    let links = vec![g, l1];
    answer_chain(r, "a1", &links);
    seed_trusted(d, "a1", links.clone());
    (a, links)
}

/// d0 이 d1 이 들기 전에 내 기기끼리 방에 봉한 말 — 봉투 목록엔 to 만
fn old_msg(a: &DeviceKeys, links: &[Link], cid: &str, to: &[(&DeviceKeys, &str)], at: u64) -> String {
    let m = Meta { room: "rs".into(), cid: cid.into(), from: "d0".into(), head: link_hash(&links[0].body, &links[0].sig), ..Default::default() };
    let to: Vec<Recipient> = to.iter().map(|(k, id)| Recipient { device: id.to_string(), e2e: k.e2e_public() }).collect();
    e2e_envelope::seal(a, &m, &Inner { origin: "human".into(), text: "지난 회의록".into(), at, ..Default::default() }, &to).unwrap()
}

fn late_frame(body: &str, l: &e2e_envelope::Late, by: &str) -> Value {
    json!({ "t": "late", "seq": 1, "room": "rs", "from": { "device": "d0", "account": "a1" }, "origin": "human", "body": body, "key": { "enc": l.enc, "w": l.w, "by": by } })
}

#[test]
fn 옛_기기가_건넨_열쇠로_새_기기가_지난_말을_연다() {
    let (d, kc, r, k) = me("late-open");
    let (a, links) = late_setup(&d, &r, &k);
    let at = now_ms() - 3600_000;
    let body = old_msg(&a, &links, "c1", &[(&a, "d0")], at);
    let st = relay::load_state(&d);
    // 그냥 받으면 이 기기 몫이 없다
    let plain = json!({ "t": "msg", "room": "rs", "from": { "device": "d0", "account": "a1" }, "origin": "human", "body": body });
    assert_eq!(unwrap(&d, &kc, &r, &st, &plain), Unwrapped::Failed("NotForMe".into()));
    let me_r = Recipient { device: "d1".into(), e2e: k.e2e_public() };
    let l = e2e_envelope::rewrap(&a, "d0", &body, Some(&a.public()), &me_r).unwrap();
    assert_eq!(unwrap(&d, &kc, &r, &st, &late_frame(&body, &l, "d0")), Unwrapped::Opened { text: "지난 회의록".into(), human: true, note: String::new(), at, extra: Default::default(), via: String::new() });
    // 같은 걸 또 넣으면 되넣기로 걸린다
    assert_eq!(unwrap(&d, &kc, &r, &st, &late_frame(&body, &l, "d0")), Unwrapped::Failed("replay".into()));
}

#[test]
fn 공격_건넨_기기가_내_사슬이_아니거나_원래_내_계정이_받는_말이_아니면_안_연다() {
    let (d, kc, r, k) = me("late-bad");
    let (a, links) = late_setup(&d, &r, &k);
    let st = relay::load_state(&d);
    let me_r = Recipient { device: "d1".into(), e2e: k.e2e_public() };
    // 건넨 기기라고 서버가 남의 기기 이름을 찍어 왔다
    let body = old_msg(&a, &links, "c1", &[(&a, "d0")], now_ms());
    let l = e2e_envelope::rewrap(&a, "d0", &body, Some(&a.public()), &me_r).unwrap();
    assert_eq!(unwrap(&d, &kc, &r, &st, &late_frame(&body, &l, "x9")), Unwrapped::Failed("late-by".into()));
    // 원래 봉투에 내 계정 기기가 하나도 없던 말(남이 남에게 보낸 말을 누가 열쇠째 넘김)
    let x = other(7);
    let body2 = old_msg(&a, &links, "c2", &[(&x, "x7")], now_ms());
    let l2 = e2e_envelope::rewrap(&x, "x7", &body2, Some(&a.public()), &me_r).unwrap();
    assert_eq!(unwrap(&d, &kc, &r, &st, &late_frame(&body2, &l2, "d0")), Unwrapped::Failed("late-not-mine".into()));
    // msg 틀에 key 를 붙여 와도 건네받기로 안 연다
    let mut f = late_frame(&body, &l, "d0");
    f["t"] = json!("msg");
    assert_eq!(unwrap(&d, &kc, &r, &st, &f), Unwrapped::Failed("NotForMe".into()));
}

#[test]
fn 내_사슬을_믿기_전엔_건네받은_말도_안_연다() {
    let (d, kc, r, k) = me("late-unconf");
    let a = other(5);
    let g = genesis("a1", &a, "d0");
    let links = vec![g.clone(), add("a1", &a, "d0", &g, &k, "d1")];
    answer_chain(&r, "a1", &links);
    let body = old_msg(&a, &links, "c1", &[(&a, "d0")], now_ms());
    let l = e2e_envelope::rewrap(&a, "d0", &body, Some(&a.public()), &Recipient { device: "d1".into(), e2e: k.e2e_public() }).unwrap();
    answer_chain(&r, "a1", &links);
    let st = relay::load_state(&d);
    assert_eq!(unwrap(&d, &kc, &r, &st, &late_frame(&body, &l, "d0")), Unwrapped::Failed("unconfirmed".into()));
}


// ── 요청 수 상한(10-28 22:53 429) — 받은 말 하나마다 명부(/log)·사슬을 다시 받으면 다시 붙은 방의 밀린 말이 열쇠의 10분 300개를 다 먹는다 ──

#[test]
fn 받은_말_열_개를_풀어도_중계엔_처음_한_번만_묻는다() {
    let (d, kc, r, k) = me("unwrap-burst");
    let p2 = other(2);
    let (g1, g2) = (genesis("a1", &k, "d1"), genesis("a2", &p2, "p1"));
    r.always("GET", "/v0/accounts/a1/chain", 200, &json!({ "links": [g1] }).to_string());
    r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [g2.clone()] }).to_string());
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": roster_links(&k, &p2) }).to_string());
    let st = relay::load_state(&d);
    for i in 0..10 {
        let m = json!({ "room": "r1", "from": { "device": "p1", "account": "a2" }, "origin": "human", "body": sealed_from(&p2, "p1", &g2, "r1", &format!("b{i}"), "안녕", &k) });
        assert!(matches!(unwrap(&d, &kc, &r, &st, &m), Unwrapped::Opened { .. }), "{i}번째");
    }
    let n = r.seen.borrow().len();
    assert!(n <= 4, "말 열 개에 중계 요청 {n}개: {:?}", r.seen.borrow().iter().map(|(m, p, _, _)| format!("{m} {p}")).collect::<Vec<_>>());
}

#[test]
fn 캐시_명부에_없는_새_사람_말은_한_번_새로_받아_열고_지어낸_보낸_이는_10초에_한_번만_묻는다() {
    let (d, kc, r, k) = me("unwrap-newcomer");
    let (p2, p3) = (other(2), other(3));
    mutate(&d, |s| s.rooms.push(Room { id: "r3".into(), kind: "dm".into(), peer: "m3".into(), team: "t1".into(), ..Default::default() })).unwrap();
    let (g1, g2, g3) = (genesis("a1", &k, "d1"), genesis("a2", &p2, "p1"), genesis("a3", &p3, "q1"));
    r.always("GET", "/v0/accounts/a1/chain", 200, &json!({ "links": [g1] }).to_string());
    r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [g2.clone()] }).to_string());
    r.always("GET", "/v0/accounts/a3/chain", 200, &json!({ "links": [g3.clone()] }).to_string());
    let mut ls = roster_links(&k, &p2);
    // 처음 명부(철수만)를 줄 서게 하고, 그 뒤엔 민수가 들어온 명부
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    let st = relay::load_state(&d);
    let m = json!({ "room": "r1", "from": { "device": "p1", "account": "a2" }, "origin": "human", "body": sealed_from(&p2, "p1", &g2, "r1", "c1", "안녕", &k) });
    assert!(matches!(unwrap(&d, &kc, &r, &st, &m), Unwrapped::Opened { .. }));
    let (_, pk3) = inv_pair("C3");
    ls.push(next(&k, "d1", &ls, json!({ "kind": "invite", "invPub": pk3, "role": "member", "expires": 1 })));
    ls.push(join_by(&p3, "q1", &ls, "C3", "m3", "a3", "민수"));
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    let m3 = json!({ "room": "r3", "from": { "device": "q1", "account": "a3" }, "origin": "human", "body": sealed_from(&p3, "q1", &g3, "r3", "c2", "나 왔어", &k) });
    assert!(matches!(unwrap(&d, &kc, &r, &st, &m3), Unwrapped::Opened { ref text, .. } if text == "나 왔어"), "새 사람 말은 명부를 새로 받아 연다");
    let logs = || r.seen.borrow().iter().filter(|(m, p, _, _)| m == "GET" && p.ends_with("/v0/teams/t1/log")).count();
    assert_eq!(logs(), 2);
    // 명부에 없는 계정이 r3 에 말을 쏟아도 10초 안엔 명부를 다시 안 받는다
    let pz = other(60);
    for i in 0..10 {
        let z = json!({ "room": "r3", "from": { "device": "zz", "account": "az" }, "origin": "human", "body": sealed_from(&pz, "zz", &genesis("az", &pz, "zz"), "r3", &format!("z{i}"), "가짜", &k) });
        assert_eq!(unwrap(&d, &kc, &r, &st, &z), Unwrapped::Failed("account".into()));
    }
    assert_eq!(logs(), 2, "지어낸 보낸 이로 명부 요청을 쏟게 하지 못한다");
}
