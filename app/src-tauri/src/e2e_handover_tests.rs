use super::*;
use crate::accounts_store::fake::Fake;
use crate::e2e_chain::{link_hash, Link};
use crate::e2e_envelope::{Inner, Meta, Recipient};
use crate::team_relay::{mutate, Account, Room};
use crate::team_relay_keys::DeviceKeys;
use crate::team_test_util::FakeRelay;
use serde_json::{json, Value};

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
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

/// 나 = 옛 기기 d1(사슬 시작), 새 기기 d2 를 숫자로 들였다. 방은 내 기기끼리 rs 와 DM r1
fn setup(tag: &str, with_new: bool) -> (std::path::PathBuf, Fake, FakeRelay, DeviceKeys, Vec<Link>) {
    let d = std::env::temp_dir().join(format!("chammo-handover-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
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
    })
    .unwrap();
    let g = clink("a1", &k, "d1", 0, "", json!({ "kind": "genesis", "device": "d1", "edPub": k.public(), "e2ePub": k.e2e_public() }));
    let mut links = vec![g.clone()];
    if with_new {
        let n = other(6);
        links.push(clink("a1", &k, "d1", 1, &link_hash(&g.body, &g.sig), json!({ "kind": "add", "device": "d2", "edPub": n.public(), "e2ePub": n.e2e_public(), "selfSig": n.e2e_key_sig() })));
    }
    crate::e2e_state::seed_trusted(&d, "a1", links.clone());
    r.always("GET", "/v0/accounts/a1/chain", 200, &json!({ "links": links }).to_string());
    r.always("GET", "/heads", 404, r#"{"error":"not_found"}"#);
    (d, kc, r, k, links)
}

/// d1 이 혼자일 때 봉한 말(목록엔 d1 만)
fn sealed(k: &DeviceKeys, links: &[Link], room: &str, cid: &str) -> String {
    let m = Meta { room: room.into(), cid: cid.into(), from: "d1".into(), head: link_hash(&links[0].body, &links[0].sig), ..Default::default() };
    crate::e2e_envelope::seal(k, &m, &Inner { origin: "human".into(), text: format!("지난 말 {cid}"), at: now_ms(), ..Default::default() }, &[Recipient { device: "d1".into(), e2e: k.e2e_public() }]).unwrap()
}

fn row(room: &str, seq: u64, b: &str) -> Value {
    json!({ "t": "msg", "seq": seq, "room": room, "from": { "device": "d1", "account": "a1" }, "origin": "human", "body": b })
}

fn hist(msgs: Vec<Value>, next: Value) -> String {
    json!({ "msgs": msgs, "next": next }).to_string()
}

fn posts(r: &FakeRelay, end: &str) -> Vec<Value> {
    r.seen.borrow().iter().filter(|(m, p, _, _)| m == "POST" && p.ends_with(end)).map(|(_, _, _, b)| serde_json::from_str(b).unwrap()).collect()
}

fn late_calls(r: &FakeRelay) -> usize {
    r.seen.borrow().iter().filter(|(_, p, _, _)| p.starts_with("/v0/me/late/")).count()
}

#[test]
fn 사슬에_새로_든_내_기기에게_방을_묶어_한_번에_건네고_한_번만_한다() {
    let (d, kc, r, k, links) = setup("auto", true);
    let (b1, b2) = (sealed(&k, &links, "rs", "c1"), sealed(&k, &links, "rs", "c2"));
    r.answer("/v0/me/late/history", 200, &hist(vec![row("rs", 1, &b1), row("rs", 2, &b2)], json!({})));
    r.always("POST", "/v0/me/late/keys", 200, r#"{"added":2}"#);
    assert!(pending(&d));
    assert_eq!(sweep(&d, &kc, &r).unwrap(), 2);
    // 방 둘(rs·r1)을 history 한 번에, 열쇠는 keys 한 번에 — 방마다 부르지 않는다
    let ask = posts(&r, "/v0/me/late/history");
    assert_eq!(ask, vec![json!({ "for": "d2", "rooms": [{ "room": "rs", "after": 0 }, { "room": "r1", "after": 0 }] })]);
    let keys = posts(&r, "/v0/me/late/keys");
    assert_eq!(keys.len(), 1);
    let items = keys[0]["items"].as_array().unwrap();
    assert_eq!(items.iter().map(|x| (x["room"].as_str().unwrap(), x["seq"].as_u64().unwrap())).collect::<Vec<_>>(), vec![("rs", 1), ("rs", 2)]);
    // 새 기기가 건네받은 열쇠로 실제로 연다
    let late = crate::e2e_envelope::Late { enc: items[0]["enc"].as_str().unwrap().into(), w: items[0]["w"].as_str().unwrap().into() };
    assert_eq!(crate::e2e_envelope::open_late(&other(6), "d2", &b1, Some(&k.public()), &late).unwrap().1.text, "지난 말 c1");
    // 끝났으니 다시 안 묻는다 — 바깥 루프가 자주 불러도 요청 0
    assert!(!pending(&d));
    let n = late_calls(&r);
    assert_eq!(sweep(&d, &kc, &r).unwrap(), 0);
    assert_eq!(late_calls(&r), n);
}

#[test]
fn 새_기기가_없으면_아무것도_안_묻고_서버_기기_목록은_안_본다() {
    let (d, kc, r, _k, _) = setup("none", false);
    assert!(!pending(&d));
    assert_eq!(sweep(&d, &kc, &r).unwrap(), 0);
    assert!(r.seen.borrow().iter().all(|(_, p, _, _)| !p.starts_with("/v0/me/late/") && !p.contains("/v0/me/devices")));
}

#[test]
fn 요청_수_상한_말이_많아도_history_는_이어_받고_keys_는_60개씩_묶는다() {
    let (d, kc, r, k, links) = setup("many", true);
    let rows: Vec<Value> = (1..=70).map(|i| row("rs", i, &sealed(&k, &links, "rs", &format!("c{i}")))).collect();
    r.answer("/v0/me/late/history", 200, &hist(rows[..50].to_vec(), json!({ "rs": 50 })));
    r.answer("/v0/me/late/history", 200, &hist(rows[50..].to_vec(), json!({})));
    r.always("POST", "/v0/me/late/keys", 200, r#"{"added":1}"#);
    assert_eq!(sweep(&d, &kc, &r).unwrap(), 70);
    let ask = posts(&r, "/v0/me/late/history");
    assert_eq!(ask.len(), 2);
    assert_eq!(ask[1]["rooms"], json!([{ "room": "rs", "after": 50 }]), "남은 방만, 받은 자리부터");
    assert_eq!(posts(&r, "/v0/me/late/keys").iter().map(|k| k["items"].as_array().unwrap().len()).collect::<Vec<_>>(), vec![60, 10]);
    assert_eq!(late_calls(&r), 4);
}

#[test]
fn 서버가_끝없이_더_있다고_해도_바퀴당_상한에서_멈추고_물러선다() {
    let (d, kc, r, _k, _) = setup("cap", true);
    r.always("POST", "/v0/me/late/history", 200, &hist(vec![], json!({ "rs": 1 })));
    assert_eq!(sweep(&d, &kc, &r), Ok(0));
    assert!(late_calls(&r) <= MAX_CALLS, "상한까지만");
    let s = crate::e2e_state::load(&d);
    assert!(s.handover_after > now_ms() && !s.handed.contains_key("d2"));
    assert_eq!(s.handover_at["d2"]["rs"], 1, "받은 자리를 적는다");
    assert!(!pending(&d), "물러선 동안 바깥 루프가 안 부른다");
}

#[test]
fn 공격_서명이_틀린_말은_안_건네고_429_면_물러섰다_다음에_다시() {
    let (d, kc, r, k, links) = setup("bad", true);
    let good = sealed(&k, &links, "rs", "c1");
    let mut forged: Value = serde_json::from_str(&sealed(&k, &links, "rs", "c2")).unwrap();
    forged["head"] = json!("H9");
    r.answer("/v0/me/late/history", 429, r#"{"error":"slow_down"}"#);
    assert!(sweep(&d, &kc, &r).is_err());
    assert!(!pending(&d));
    let n = late_calls(&r);
    // 중계 쉬라는 1분(team_relay SLOW)과 건네주기 물러섬이 다 지난 뒤
    crate::team_relay::slow_down(&k.public(), &json!({ "retryAfter": 0 }), std::time::Instant::now() - std::time::Duration::from_secs(5));
    crate::e2e_state::mutate(&d, |s| s.handover_after = 0).unwrap();
    r.answer("/v0/me/late/history", 200, &hist(vec![row("rs", 1, &good), row("rs", 2, &forged.to_string())], json!({})));
    r.always("POST", "/v0/me/late/keys", 200, r#"{"added":1}"#);
    assert_eq!(sweep(&d, &kc, &r).unwrap(), 1, "서명 틀린 말은 안 건넨다");
    assert_eq!(late_calls(&r) - n, 2);
    let s = crate::e2e_state::load(&d);
    assert!(s.handed.contains_key("d2") && s.handover_fails == 0);
}

#[test]
fn 옛_중계면_물러서고_내_사슬이_바뀌었으면_아무것도_안_보낸다() {
    let (d, kc, r, _k, _) = setup("old", true);
    r.answer("/v0/me/late/history", 404, r#"{"error":"not_found"}"#);
    assert_eq!(sweep(&d, &kc, &r).unwrap(), 0);
    let s = crate::e2e_state::load(&d);
    assert!(!s.handed.contains_key("d2") && s.handover_after > now_ms(), "옛 중계 — 끝난 게 아니고 물러선다");
    // 내 사슬 핀이 바뀜(내가 안 한 다시 시작) — 건네지 않는다
    crate::e2e_state::mutate(&d, |s| {
        s.handover_after = 0;
        s.pins.get_mut("a1").unwrap().state = "changed".into();
    })
    .unwrap();
    let n = late_calls(&r);
    assert!(sweep(&d, &kc, &r).is_err());
    assert_eq!(late_calls(&r), n);
}

#[test]
fn 팀원이_보낸_dm_말도_그_사람_사슬로_서명을_확인해_건넨다() {
    let (d, kc, r, k, _) = setup("peer", true);
    let p = other(8);
    mutate(&d, |s| s.put_team(crate::team_relay::TeamEntry { id: "t1".into(), members: vec![crate::team_relay::Member { id: "m2".into(), ..Default::default() }], ..Default::default() })).unwrap();
    let g = clink("a2", &p, "p1", 0, "", json!({ "kind": "genesis", "device": "p1", "edPub": p.public(), "e2ePub": p.e2e_public() }));
    r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [g.clone()] }).to_string());
    let m = Meta { room: "r1".into(), cid: "p-c1".into(), from: "p1".into(), head: link_hash(&g.body, &g.sig), ..Default::default() };
    let body = crate::e2e_envelope::seal(&p, &m, &Inner { origin: "human".into(), text: "철수 말".into(), at: now_ms(), ..Default::default() }, &[Recipient { device: "d1".into(), e2e: k.e2e_public() }, Recipient { device: "p1".into(), e2e: p.e2e_public() }]).unwrap();
    let msg = json!({ "t": "msg", "seq": 7, "room": "r1", "from": { "member": "m2", "device": "p1", "account": "a2" }, "origin": "human", "body": body });
    r.answer("/v0/me/late/history", 200, &hist(vec![msg], json!({})));
    r.always("POST", "/v0/me/late/keys", 200, r#"{"added":1}"#);
    assert_eq!(sweep(&d, &kc, &r).unwrap(), 1);
    let it = &posts(&r, "/v0/me/late/keys")[0]["items"][0];
    let late = crate::e2e_envelope::Late { enc: it["enc"].as_str().unwrap().into(), w: it["w"].as_str().unwrap().into() };
    assert_eq!(crate::e2e_envelope::open_late(&other(6), "d2", &body, Some(&p.public()), &late).unwrap().1.text, "철수 말");
}

#[test]
fn 모르는_보낸_기기가_말마다_사슬을_다시_받게_하지_않는다() {
    let (d, kc, r, k, links) = setup("senders", true);
    let rows: Vec<Value> = (1..=5).map(|i| json!({ "t": "msg", "seq": i, "room": "rs", "from": { "device": "ghost", "account": "a1" }, "body": sealed(&k, &links, "rs", &format!("g{i}")) })).collect();
    r.answer("/v0/me/late/history", 200, &hist(rows, json!({})));
    let before = r.seen.borrow().iter().filter(|(m, p, _, _)| m == "GET" && p.ends_with("/v0/accounts/a1/chain")).count();
    assert_eq!(sweep(&d, &kc, &r).unwrap(), 0);
    let after = r.seen.borrow().iter().filter(|(m, p, _, _)| m == "GET" && p.ends_with("/v0/accounts/a1/chain")).count();
    assert!(after - before <= 1, "계정마다 한 번만 다시 받는다: {}", after - before);
}

#[test]
fn 팀을_나간_사람_말은_그_사람_사슬을_새로_받지_않는다() {
    // 10-29 — 나간 사람의 옛 DM 말을 훑다 사슬을 새로 받아 '보안 번호 바뀜' 카드가 떴다. 나간 사람은 캐시만 본다(망 없음·핀 그대로)
    let (d, kc, r, k, links) = setup("left", true);
    let msg = json!({ "t": "msg", "seq": 3, "room": "r1", "from": { "member": "m9", "device": "x1", "account": "a9" }, "origin": "human", "body": sealed(&k, &links, "r1", "z1") });
    r.answer("/v0/me/late/history", 200, &hist(vec![msg], json!({})));
    r.always("GET", "/v0/accounts/a9/chain", 200, r#"{"links":[]}"#);
    assert_eq!(sweep(&d, &kc, &r).unwrap(), 0);
    assert!(!r.seen.borrow().iter().any(|(_, p, _, _)| p.ends_with("/v0/accounts/a9/chain")), "나간 사람 사슬은 안 받는다");
}

#[test]
fn 못_건네는_말이_많아도_바퀴마다_이어서_가고_상한에_걸려도_싼_것은_보낸다() {
    // 0.4.4 리뷰 — 바퀴 사이 커서가 없어 못 싸는 말(나간 사람)을 매번 처음부터 다시 받고, 상한에 걸리면 싼 묶음까지 버리고 6시간 물러났다
    let (d, kc, r, k, links) = setup("cursor", true);
    let gone = |seq: u64| json!({ "t": "msg", "seq": seq, "room": "r1", "from": { "member": "m9", "device": "x1", "account": "a9" }, "body": sealed(&k, &links, "r1", &format!("z{seq}")) });
    // 앞 바퀴: 못 싸는 말 50개씩 끝없이 + 싼 말 하나
    r.answer("/v0/me/late/history", 200, &hist(vec![row("rs", 1, &sealed(&k, &links, "rs", "c1"))], json!({ "r1": 0 })));
    for i in 0..20u64 {
        r.answer("/v0/me/late/history", 200, &hist((1..=50).map(|j| gone(i * 50 + j)).collect(), json!({ "r1": (i + 1) * 50 })));
    }
    r.always("POST", "/v0/me/late/keys", 200, r#"{"added":1}"#);
    assert_eq!(sweep(&d, &kc, &r).unwrap(), 1, "상한에 걸려도 싼 것은 보낸다");
    assert!(late_calls(&r) <= MAX_CALLS);
    assert_eq!(posts(&r, "/v0/me/late/keys").len(), 1);
    let s = crate::e2e_state::load(&d);
    assert!(!s.handed.contains_key("d2"), "다 못 훑었다");
    assert_eq!(s.handover_fails, 0, "나아갔으니 실패로 안 센다");
    assert!(s.handover_after <= now_ms() + 5 * 60_000, "6시간씩 물러나지 않는다");
    // 다음 바퀴는 받은 자리부터
    crate::e2e_state::mutate(&d, |s| s.handover_after = 0).unwrap();
    let n = posts(&r, "/v0/me/late/history").len();
    r.answers.borrow_mut().clear();
    r.answer("/v0/me/late/history", 200, &hist(vec![], json!({})));
    assert_eq!(sweep(&d, &kc, &r).unwrap(), 0);
    let ask = &posts(&r, "/v0/me/late/history")[n];
    let after = |room: &str| ask["rooms"].as_array().unwrap().iter().find(|x| x["room"] == room).map(|x| x["after"].as_u64().unwrap());
    assert!(after("r1").unwrap() > 0, "못 싼 말은 건너뛴 자리부터: {ask}");
    assert_eq!(after("rs"), Some(1), "다 훑은 방도 본 자리부터");
    assert!(crate::e2e_state::load(&d).handed.contains_key("d2"));
}
