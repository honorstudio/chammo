use super::*;
use crate::team_relay_keys::DeviceKeys;
use serde_json::json;

fn k(n: u8) -> DeviceKeys {
    DeviceKeys::from_seeds([n; 32], [n.wrapping_add(100); 32])
}

/// 고리 하나 — by 열쇠로 서명
fn link(by: &DeviceKeys, by_id: &str, seq: u64, prev: &str, f: Value) -> Link {
    let mut b = json!({ "v": 1, "account": "a1", "seq": seq, "prev": prev, "by": by_id, "at": 1 });
    b.as_object_mut().unwrap().extend(f.as_object().unwrap().clone());
    let body = b.to_string();
    Link { seq, sig: by.sign(&format!("chammo-chain/1\n{body}")), body }
}

fn start(d: &DeviceKeys, id: &str, kind: &str, seq: u64, prev: &str) -> Link {
    link(d, id, seq, prev, json!({ "kind": kind, "device": id, "edPub": d.public(), "e2ePub": d.e2e_public() }))
}

fn add(by: &DeviceKeys, by_id: &str, seq: u64, prev: &str, d: &DeviceKeys, id: &str) -> Link {
    link(by, by_id, seq, prev, json!({ "kind": "add", "device": id, "edPub": d.public(), "e2ePub": d.e2e_public(), "selfSig": d.e2e_key_sig() }))
}

/// 맥(d1) 시작 → 폰(d2) 들임
fn two() -> Vec<Link> {
    let g = start(&k(1), "d1", "genesis", 0, "");
    let a = add(&k(1), "d1", 1, &link_hash(&g.body, &g.sig), &k(2), "d2");
    vec![g, a]
}

#[test]
fn 시작과_들임을_검증하고_기기_목록·신원을_낸다() {
    let c = verify("a1", &two()).unwrap();
    assert_eq!(c.devices.keys().collect::<Vec<_>>(), vec!["d1", "d2"]);
    assert_eq!(c.devices["d2"].e2e, k(2).e2e_public());
    assert_eq!(c.identity, c.hashes[0], "신원 = genesis 고리 해시");
}

#[test]
fn 남의_계정·서명_틀림·차례_틀림·없는_서명자·묶기_서명_틀림은_통째로_거절() {
    let ls = two();
    assert!(verify("a2", &ls).is_err(), "남의 계정");
    let mut bad = ls.clone();
    bad[1].sig = k(9).sign("x");
    assert_eq!(verify("a1", &bad), Err(ChainErr::Bad(1, "sig")));
    let g = &ls[0];
    let skip = add(&k(1), "d1", 1, "wrong-prev", &k(2), "d2");
    assert_eq!(verify("a1", &[g.clone(), skip]), Err(ChainErr::Bad(1, "prev")));
    let stranger = add(&k(9), "d9", 1, &link_hash(&g.body, &g.sig), &k(2), "d2");
    assert_eq!(verify("a1", &[g.clone(), stranger]), Err(ChainErr::Bad(1, "signer")), "사슬에 없는 기기가 들임");
    // 서버가 받는 열쇠를 바꿔치기 — 새 기기 묶기 서명이 안 맞는다
    let mut swapped = add(&k(1), "d1", 1, &link_hash(&g.body, &g.sig), &k(2), "d2");
    let fake = k(7).e2e_public();
    let mut b: Value = serde_json::from_str(&swapped.body).unwrap();
    b["e2ePub"] = json!(fake);
    swapped.body = b.to_string();
    swapped.sig = k(1).sign(&format!("chammo-chain/1\n{}", swapped.body));
    assert_eq!(verify("a1", &[g.clone(), swapped]), Err(ChainErr::Bad(1, "add")));
    assert!(verify("a1", &[]).is_err());
}

#[test]
fn 빼기는_목록에서_빼고_옛_서명_열쇠는_ever_에_남는다() {
    let mut ls = two();
    let h = link_hash(&ls[1].body, &ls[1].sig);
    ls.push(link(&k(1), "d1", 2, &h, json!({ "kind": "remove", "device": "d2" })));
    let c = verify("a1", &ls).unwrap();
    assert!(!c.devices.contains_key("d2"));
    assert_eq!(c.ever.get("d2"), Some(&k(2).public()));
    // 빠진 기기는 더는 고리를 못 쓴다
    let h3 = c.head();
    ls.push(add(&k(2), "d2", 3, &h3, &k(3), "d3"));
    assert_eq!(verify("a1", &ls), Err(ChainErr::Bad(3, "signer")));
}

#[test]
fn 다시_시작하면_신원이_바뀌고_옛_기기는_빠진다() {
    let mut ls = two();
    let h = link_hash(&ls[1].body, &ls[1].sig);
    ls.push(start(&k(5), "d5", "reset", 2, &h));
    let c = verify("a1", &ls).unwrap();
    assert_eq!(c.devices.keys().collect::<Vec<_>>(), vec!["d5"]);
    assert_eq!(c.identity, c.head());
    assert_ne!(c.identity, c.hashes[0]);
    // genesis 는 맨 앞에서만
    let g2 = start(&k(5), "d5", "genesis", 2, &h);
    assert_eq!(verify("a1", &[ls[0].clone(), ls[1].clone(), g2]), Err(ChainErr::Bad(2, "start")));
}

#[test]
fn 전에_본_머리를_이어야_한다_포크면_false() {
    let c = verify("a1", &two()).unwrap();
    assert!(extends(&c, 0, &c.hashes[0]) && extends(&c, 1, &c.hashes[1]));
    assert!(!extends(&c, 1, "other"));
    assert!(!extends(&c, 5, &c.hashes[1]), "전에 본 것보다 짧아지면(되감기) 아님");
}

#[test]
fn 확인_숫자는_서버_봉인과_같은_글이고_한_값만_바뀌어도_다른_숫자() {
    // 서버 test/chain-helpers.ts commitOf 와 같은 식(SHA256("chammo-approve-commit/1" ‖ ed ‖ e2e ‖ nP))
    let (ed, e2e) = ([3u8; 32], {
        let mut p = [2u8; 65];
        p[0] = 4;
        p
    });
    let c = approve_commit(&ed, &e2e, &[5; 16]);
    assert_eq!(c.len(), 43);
    let sas = approve_sas("a1", "d9", &ed, &e2e, &[5; 16], &[6; 16], "I1", "H1");
    assert!(sas < 1_000_000);
    assert_eq!(sas, approve_sas("a1", "d9", &ed, &e2e, &[5; 16], &[6; 16], "I1", "H1"));
    assert_ne!(sas, approve_sas("a1", "d9", &ed, &e2e, &[5; 16], &[7; 16], "I1", "H1"));
    assert_ne!(sas, approve_sas("a1", "d8", &ed, &e2e, &[5; 16], &[6; 16], "I1", "H1"));
    // R7 — 사슬 신원·머리가 다르면(서버가 새 기기에 다른 사슬을 보여 주면) 다른 숫자
    assert_ne!(sas, approve_sas("a1", "d9", &ed, &e2e, &[5; 16], &[6; 16], "I2", "H1"));
    assert_ne!(sas, approve_sas("a1", "d9", &ed, &e2e, &[5; 16], &[6; 16], "I1", "H2"));
    // 기준값(TS·폰이 붙을 때 같은 값을 내야 한다)
    assert_eq!(format!("{sas:06}"), SAS_REF);
}

const SAS_REF: &str = include_str!("e2e_sas_ref.txt");

#[test]
fn 보안_번호는_양쪽에서_같고_신원이_바뀌면_다르다() {
    let n = safety_number("idA", "idB");
    assert_eq!(n, safety_number("idB", "idA"));
    assert_eq!(n.split(' ').count(), 6);
    assert!(n.split(' ').all(|g| g.len() == 5 && g.bytes().all(|b| b.is_ascii_digit())));
    assert_ne!(n, safety_number("idA", "idC"));
}
