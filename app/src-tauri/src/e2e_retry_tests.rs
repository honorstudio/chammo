use super::*;
use crate::accounts_store::fake::Fake;
use crate::e2e_chain::{link_hash, Link};
use crate::e2e_roster::{invite_seed, team_hash, TLink};
use crate::team_relay::{mutate, Account, Room};
use crate::team_relay_keys::DeviceKeys;
use crate::team_test_util::FakeRelay;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::json;

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

fn genesis(acc: &str, k: &DeviceKeys, id: &str) -> Link {
    clink(acc, k, id, 0, "", json!({ "kind": "genesis", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public() }))
}

fn tl(by: &DeviceKeys, by_id: &str, ls: &[TLink], f: Value) -> TLink {
    let (seq, prev) = (ls.len() as u64, ls.last().map(team_hash).unwrap_or_default());
    let mut b = json!({ "v": 1, "team": "t1", "seq": seq, "prev": prev, "by": by_id });
    b.as_object_mut().unwrap().extend(f.as_object().unwrap().clone());
    let body = b.to_string();
    TLink { seq, sig: by.sign(&format!("chammo-team/1\n{body}")), body, sig2: None }
}

fn join(by: &DeviceKeys, by_id: &str, ls: &[TLink], code: &str, member: &str, account: &str, name: &str) -> TLink {
    let c = SigningKey::from_bytes(&invite_seed(code));
    let pk = B64.encode(c.verifying_key().as_bytes());
    let mut j = tl(by, by_id, ls, json!({ "kind": "join", "invPub": pk, "member": member, "account": account, "displayName": name }));
    j.sig2 = Some(B64.encode(c.sign(format!("chammo-team/1\n{}", j.body).as_bytes()).to_bytes()));
    j
}

fn invite(by: &DeviceKeys, by_id: &str, ls: &[TLink], code: &str) -> TLink {
    let c = SigningKey::from_bytes(&invite_seed(code));
    tl(by, by_id, ls, json!({ "kind": "invite", "invPub": B64.encode(c.verifying_key().as_bytes()), "role": "member", "expires": 1 }))
}

/// 나(m1, d1) 팀장 · 철수(m2, a2 p1) — 철수에게 DM 방 r1
fn setup(tag: &str) -> (std::path::PathBuf, Fake, FakeRelay, DeviceKeys, DeviceKeys, Vec<TLink>) {
    let d = std::env::temp_dir().join(format!("chammo-retry-{tag}-{}", std::process::id()));
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
        s.device_created_at = 1;
        s.account = Some(Account { id: "a1".into(), ..Default::default() });
        s.rooms = vec![Room { id: "r1".into(), kind: "dm".into(), peer: "m2".into(), team: "t1".into(), ..Default::default() }];
        s.put_team(crate::team_relay::TeamEntry { id: "t1".into(), name: "샘플팀".into(), member_id: "m1".into(), role: "owner".into(), ..Default::default() });
    })
    .unwrap();
    let p = other(2);
    let mut ls = vec![tl(&k, "d1", &[], json!({ "kind": "team", "name": "샘플팀", "member": "m1", "account": "a1", "displayName": "사용자" }))];
    ls.push(invite(&k, "d1", &ls, "C"));
    ls.push(join(&p, "p1", &ls, "C", "m2", "a2", "철수"));
    (d, kc, r, k, p, ls)
}

fn msg(from: &DeviceKeys, from_id: &str, head: &Link, seq: u64, text: &str, to: &DeviceKeys) -> Value {
    let m = crate::e2e_envelope::Meta { room: "r1".into(), cid: format!("z{seq}"), from: from_id.into(), head: link_hash(&head.body, &head.sig), peers: Default::default(), roster: String::new() };
    let inner = crate::e2e_envelope::Inner { origin: "human".into(), text: text.into(), at: now_ms(), ..Default::default() };
    let body = crate::e2e_envelope::seal(from, &m, &inner, &[crate::e2e_envelope::Recipient { device: "d1".into(), e2e: to.e2e_public() }]).unwrap();
    json!({ "t": "msg", "room": "r1", "seq": seq, "from": { "member": "m2", "device": from_id, "account": "a2" }, "origin": "human", "body": body, "at": 5 })
}

fn records(d: &std::path::Path) -> Vec<Value> {
    crate::team_cmd::inbox_tail(d, 100).into_iter().filter(|v| v["room"] == "r1").collect()
}

#[test]
fn 다시_열_수_있는_실패만_봉투를_남긴다() {
    for why in ["plain", "too-old", "future", "replay", "shape", "NotForMe", "Shape", "Open", "Sig", "Key"] {
        assert!(!retryable(why), "{why} — 영영 못 여는 것");
    }
    for why in ["account", "not-in-chain", "unconfirmed", "no-chain", "forked", "팀 명부가 틀렸어: Bad(11, \"join\")"] {
        assert!(retryable(why), "{why} — 명부·사슬이 맞춰지면 열린다");
    }
}

#[test]
fn 받아들이기_전에_못_연_말을_받아들인_뒤_다시_열어_같은_자리에_보인다() {
    // qa-team3 맥 실측 #3 — 철수가 다시 시작(새 기기 pz). 서버 명부가 철수 새 기기 들어옴보다 늦어 '이 기기에서 못 연 말'
    let (d, kc, r, k, p, mut ls) = setup("late");
    let pz = other(50);
    let (g1, g2) = (genesis("a1", &k, "d1"), genesis("a2", &p, "p1"));
    let x = clink("a2", &pz, "pz", 1, &link_hash(&g2.body, &g2.sig), json!({ "kind": "reset", "device": "pz", "edPub": pz.public(), "e2ePub": pz.e2e_public() }));
    r.answer("/v0/accounts/a2/chain", 200, &json!({ "links": [g2.clone()] }).to_string());
    crate::e2e_state::chain_of(&d, &kc, &r, &crate::team_relay::load_state(&d), "a2", true).unwrap();
    r.always("GET", "/v0/accounts/a1/chain", 200, &json!({ "links": [g1] }).to_string());
    r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [g2, x.clone()] }).to_string());
    // 서버 명부엔 철수 옛 자리(m2)만 — 새 기기 pz 는 사슬엔 있지만 DM 상대 m2 의 기기
    let m = msg(&pz, "pz", &x, 7, "나 다시 왔어", &k);
    // 둘 — 캐시 명부에 보낸 이가 없으면 한 번 더 새로 받는다
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": [ls[0].clone()] }).to_string());
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": [ls[0].clone()] }).to_string());
    let st = crate::team_relay::load_state(&d);
    let opened = crate::e2e_state::unwrap(&d, &kc, &r, &st, &m);
    let crate::e2e_state::Unwrapped::Failed(why) = &opened else { panic!("명부가 모자라 못 연다: {opened:?}") };
    assert!(retryable(why), "{why}");
    let (_, rec) = crate::team_relay_inbox::with_e2e(&st, 0, &m, &opened);
    crate::team_relay_inbox::append(&d, &rec).unwrap();
    keep(&d, &m, &rec.note).unwrap();
    assert_eq!(records(&d)[0]["note"], "e2e-fail");
    // 명부가 맞춰지면 — 받아들이기 전이라 경고 붙은 말(e2e-changed)로 바꿔 끼우고 봉투는 남긴다
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    assert_eq!(retry(&d, &kc, &r), 1);
    let rs = records(&d);
    assert_eq!(rs.len(), 1, "같은 (방, seq) 는 한 줄로");
    assert_eq!((rs[0]["body"].as_str(), rs[0]["note"].as_str()), (Some("나 다시 왔어"), Some("e2e-changed")));
    assert_eq!(load(&d).len(), 1);
    assert_eq!(retry(&d, &kc, &r), 0, "같은 모양이면 다시 안 쓴다");
    // 사람이 받아들임 → 다시 열기 — 서명부터 다시 검증하고 경고를 뗀다(늦게 연 말 — 참모에겐 안 넘긴다)
    crate::e2e_state::accept(&d, "a2").unwrap();
    assert_eq!(retry(&d, &kc, &r), 1);
    let rs = records(&d);
    assert_eq!(rs.len(), 1);
    assert_eq!((rs[0]["body"].as_str(), rs[0]["note"].as_str()), (Some("나 다시 왔어"), Some("late")));
    assert!(load(&d).is_empty(), "연 봉투는 보관함에서 뺀다");
    assert_eq!(retry(&d, &kc, &r), 0, "두 번 열지 않는다");
    ls.clear();
}

#[test]
fn 공격_사슬_밖_기기가_보낸_봉투는_보관해_둬도_다시_열기에서_안_열린다() {
    let (d, kc, r, k, p, ls) = setup("tamper");
    let g1 = genesis("a1", &k, "d1");
    let g2 = genesis("a2", &p, "p1");
    r.always("GET", "/v0/accounts/a1/chain", 200, &json!({ "links": [g1] }).to_string());
    r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [g2.clone()] }).to_string());
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": ls }).to_string());
    // 모르는 기기(z9)가 철수 이름으로 — 보관은 돼도(파일이 바뀌어도) 다시 열 때 사슬 밖이라 안 열리고 버린다
    let mut m = msg(&other(9), "z9", &g2, 3, "가짜", &k);
    m["from"]["device"] = json!("z9");
    keep(&d, &m, "e2e-fail").unwrap();
    assert_eq!(retry(&d, &kc, &r), 0, "사슬 밖 기기 — 열지 않는다(기록도 안 바꾼다)");
    assert!(records(&d).is_empty());
}

#[test]
fn 보관은_30일·300개까지_같은_자리는_한_번() {
    let (d, ..) = setup("cap");
    for i in 0..310u64 {
        keep(&d, &json!({ "room": "r1", "seq": i, "body": "{}" }), "e2e-fail").unwrap();
    }
    keep(&d, &json!({ "room": "r1", "seq": 309, "body": "{}" }), "e2e-fail").unwrap();
    let l = load(&d);
    assert_eq!(l.len(), CAP);
    assert_eq!(l.first().unwrap().msg["seq"], 10, "오래된 것부터 버린다");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(d.join(FILE)).unwrap().permissions().mode() & 0o777, 0o600);
    }
}
