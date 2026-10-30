use super::*;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};

const K: [u8; 32] = [7u8; 32];

fn keys() -> crate::team_relay_keys::DeviceKeys {
    crate::team_relay_keys::DeviceKeys::from_seeds([1u8; 32], [2u8; 32])
}

/// 서명까지 한 서버 줄 — 시험용
fn remote(id: &str, rev: u64, base: u64, data: &Value, del: bool, by: &str) -> Remote {
    let k = keys();
    let ik = item_key(&K, "t1", APP_CAL);
    let ct = seal(&ik, "t1", APP_CAL, id, &serde_json::to_vec(data).unwrap());
    let sig = k.sign(&sig_text("t1", APP_CAL, id, base, "key1", &ct, del));
    Remote { id: id.into(), rev, base, key: "key1".into(), ct, sig, by: By { member: by.into(), device: "d1".into() }, at: 1, del, deleted_at: if del { Some(1) } else { None } }
}

fn signers() -> BTreeMap<String, String> {
    BTreeMap::from([("d1".to_string(), keys().public())])
}

fn key_map() -> BTreeMap<String, [u8; 32]> {
    BTreeMap::from([("key1".to_string(), K)])
}

#[test]
fn 봉하고_열면_같은_내용_다른_기록_자리에선_안_열린다() {
    let ik = item_key(&K, "t1", APP_CAL);
    let ct = seal(&ik, "t1", APP_CAL, "ev1", b"{\"title\":\"x\"}");
    assert_eq!(open(&ik, "t1", APP_CAL, "ev1", &ct).unwrap(), b"{\"title\":\"x\"}");
    assert!(open(&ik, "t1", APP_CAL, "ev2", &ct).is_err(), "id 가 다르면 못 연다(AAD)");
    assert!(open(&item_key(&K, "t2", APP_CAL), "t2", APP_CAL, "ev1", &ct).is_err(), "팀이 다르면 열쇠도 다르다");
    assert_ne!(seal(&ik, "t1", APP_CAL, "ev1", b"a"), seal(&ik, "t1", APP_CAL, "ev1", b"a"), "nonce 는 매번 새로");
}

#[test]
fn 서명된_줄만_연다() {
    let r = remote("ev1", 3, 0, &json!({"title": "주간회의"}), false, "m1");
    assert_eq!(open_remote(&r, "t1", APP_CAL, &key_map(), &signers()).unwrap()["title"], "주간회의");
    let mut bad = r.clone();
    bad.base = 9;
    assert!(open_remote(&bad, "t1", APP_CAL, &key_map(), &signers()).unwrap_err().contains("서명"), "base 를 바꾸면 서명이 깨진다");
    let mut stranger = r.clone();
    stranger.by.device = "d9".into();
    assert!(open_remote(&stranger, "t1", APP_CAL, &key_map(), &signers()).is_err(), "사슬 밖 기기");
    assert!(open_remote(&r, "t1", APP_CAL, &BTreeMap::new(), &signers()).unwrap_err().contains("열쇠"), "열쇠가 없으면 못 연다");
    let arr = remote("ev2", 3, 0, &json!([1, 2]), false, "m1");
    assert!(open_remote(&arr, "t1", APP_CAL, &key_map(), &signers()).is_err(), "객체가 아니면 버린다");
}

#[test]
fn 열쇠는_빠진_기기가_없는_가장_새_것() {
    let now: BTreeSet<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
    let rows = vec![
        KeyRow { id: "k-old".into(), have: vec!["a".into(), "b".into()], created_at: 1 },
        KeyRow { id: "k-new".into(), have: vec!["a".into(), "b".into(), "x".into()], created_at: 2 },
    ];
    assert_eq!(pick_key(&rows, &now), Some("k-old".into()), "x 가 빠졌으니 새 것은 못 쓴다");
    let rows2 = vec![KeyRow { id: "k1".into(), have: vec!["a".into()], created_at: 1 }, KeyRow { id: "k2".into(), have: vec!["a".into(), "b".into()], created_at: 5 }];
    assert_eq!(pick_key(&rows2, &now), Some("k2".into()), "새로 든 기기(c)는 봉투가 나중에 붙는다 — 상관없음");
    assert_eq!(pick_key(&[KeyRow { id: "k".into(), have: vec!["gone".into()], created_at: 1 }], &now), None, "다 빠진 기기면 새 열쇠를 만들어야");
    assert_eq!(pick_key(&[], &now), None);
}

#[test]
fn 다른_칸은_둘_다_남는다() {
    let base = json!({"title": "회의", "start": "10:00", "note": ""});
    let mine = json!({"title": "회의", "start": "10:00", "note": "자료 준비"});
    let theirs = json!({"title": "회의", "start": "11:00", "note": ""});
    let m = merge(Some(&base), &Op::Put(mine), &Now { data: theirs, del: false, by: "m2".into() }, false);
    let Merge::Write { data, del, lost, .. } = m else { panic!("써야 한다") };
    assert!(!del);
    assert_eq!(data["start"], "11:00");
    assert_eq!(data["note"], "자료 준비");
    assert!(lost.is_empty());
}

#[test]
fn 같은_칸은_내가_이기고_진_칸을_알린다() {
    let base = json!({"start": "10:00"});
    let m = merge(Some(&base), &Op::Put(json!({"start": "12:00"})), &Now { data: json!({"start": "11:00"}), del: false, by: "m2".into() }, false);
    let Merge::Write { data, lost, by, .. } = m else { panic!() };
    assert_eq!(data["start"], "12:00");
    assert_eq!(lost, vec!["start".to_string()]);
    assert_eq!(by, "m2");
}

#[test]
fn 남이_지운_걸_고치면_멈추고_다시_살리기는_된다() {
    let base = json!({"title": "a"});
    let now = Now { data: base.clone(), del: true, by: "m2".into() };
    assert_eq!(merge(Some(&base), &Op::Put(json!({"title": "b"})), &now, false), Merge::Gone { by: "m2".into() });
    let Merge::Write { del, data, .. } = merge(Some(&base), &Op::Put(json!({"title": "b"})), &now, true) else { panic!("다시 살리기") };
    assert!(!del);
    assert_eq!(data["title"], "b");
}

#[test]
fn 남이_고친_걸_지우면_지움이_들어가고_알린다() {
    let base = json!({"title": "a"});
    let now = Now { data: json!({"title": "b"}), del: false, by: "m2".into() };
    let Merge::Write { del, data, lost, .. } = merge(Some(&base), &Op::Del, &now, false) else { panic!() };
    assert!(del);
    assert_eq!(data["title"], "b", "무덤엔 남이 고친 마지막 내용 — 되살리면 그게 돌아온다");
    assert_eq!(lost, vec!["*".to_string()], "방금 고친 일정이었다는 표시");
    let Merge::Write { lost, .. } = merge(Some(&base), &Op::Del, &Now { data: base.clone(), del: false, by: "m2".into() }, false) else { panic!() };
    assert!(lost.is_empty(), "안 고친 걸 지우면 알릴 것 없음");
}

#[test]
fn 고친_칸을_기록하고_20번까지() {
    let before = json!({"title": "a", "start": "1", "made": {"by": "m1", "at": 1}, "edits": []});
    let mut after = json!({"title": "b", "start": "1", "made": {"by": "m1", "at": 1}, "edits": []});
    stamp(&mut after, Some(&before), "m2", 50);
    assert_eq!(after["edits"][0], json!({"by": "m2", "at": 50, "f": ["title"]}));
    let mut fresh = json!({"title": "새"});
    stamp(&mut fresh, None, "m3", 9);
    assert_eq!(fresh["made"], json!({"by": "m3", "at": 9}));
    assert_eq!(fresh["edits"], json!([]), "새로 만든 건 made 만");
    let mut many = json!({"title": "x", "edits": (0..25).map(|i| json!({"by": "m", "at": i, "f": ["title"]})).collect::<Vec<_>>()});
    let prev = json!({"title": "y", "edits": many["edits"].clone()});
    stamp(&mut many, Some(&prev), "m9", 99);
    let e = many["edits"].as_array().unwrap();
    assert_eq!(e.len(), EDITS_MAX);
    assert_eq!(e.last().unwrap()["by"], "m9");
}
