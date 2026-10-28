use super::*;
use crate::accounts_store::fake::Fake;
use crate::e2e_chain::{self, link_hash, Link};
use crate::team_relay::{mutate, Account};
use crate::team_test_util::FakeRelay;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-flow-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 계정 a1 의 기기 하나(열쇠는 가짜 키체인) — 가짜 중계에 등록
fn device(tag: &str, id: &str, r: &FakeRelay, pending: bool) -> (std::path::PathBuf, Fake, DeviceKeys) {
    let d = dir(tag);
    let kc = Fake::default();
    let (k, acct) = crate::team_relay_keys::create(&kc).unwrap();
    r.devices.borrow_mut().push((id.into(), k.public()));
    mutate(&d, |s| {
        s.server = "https://relay.test".into();
        s.key_account = acct;
        s.device_id = id.into();
        s.account = Some(Account { id: "a1".into(), ..Default::default() });
        s.pending = pending;
    })
    .unwrap();
    (d, kc, k)
}

fn genesis(k: &DeviceKeys, id: &str) -> Link {
    let body = json!({ "v": 1, "account": "a1", "seq": 0, "prev": "", "by": id, "kind": "genesis", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{body}")), body }
}

fn chain_answer(r: &FakeRelay, links: &[Link]) {
    r.answer("/v0/accounts/a1/chain", 200, &json!({ "links": links }).to_string());
}

/// 사슬 [자기 genesis] 를 믿는 허용 기기
fn approver(tag: &str, id: &str, r: &FakeRelay) -> (std::path::PathBuf, Fake, DeviceKeys, Link) {
    let (d, kc, k) = device(tag, id, r, false);
    let g = genesis(&k, id);
    e2e_state::seed_trusted(&d, "a1", vec![g.clone()]);
    (d, kc, k, g)
}

fn add_link(by: &DeviceKeys, by_id: &str, prev: &Link, k: &DeviceKeys, id: &str) -> Link {
    let body = json!({ "v": 1, "account": "a1", "seq": prev.seq + 1, "prev": link_hash(&prev.body, &prev.sig), "by": by_id, "kind": "add", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public(), "selfSig": k.e2e_key_sig() }).to_string();
    Link { seq: prev.seq + 1, sig: by.sign(&format!("chammo-chain/1\n{body}")), body }
}

struct Flow {
    da: std::path::PathBuf,
    kca: Fake,
    db: std::path::PathBuf,
    kcb: Fake,
    kb: DeviceKeys,
    g: Link,
    f: Value,
    n_m: String,
    n_p: String,
}

/// 허용 기기 dA 가 카드를 열고(nM), 새 기기 dB 가 숫자를 띄울 때까지. shown = 서버가 새 기기에 보여 주는 내 계정 사슬(None 이면 진짜)
fn start(tag: &str, r: &FakeRelay, shown: Option<Vec<Link>>) -> (Flow, u32) {
    let (da, kca, _, g) = approver(&format!("{tag}-a"), "dA", r);
    let (db, kcb, kb) = device(&format!("{tag}-b"), "dB", r, true);
    let f = login_fields(&db, &kb).unwrap();
    let n_p = e2e_state::load(&db).my_np;
    r.answer("/v0/me/devices", 200, &json!({ "devices": [{ "id": "dB", "name": "iPhone", "status": "pending", "publicKey": kb.public(), "e2ePub": f["e2ePub"], "e2eSig": f["e2eSig"], "approveCommit": f["approveCommit"] }] }).to_string());
    chain_answer(r, std::slice::from_ref(&g));
    r.answer("/v0/me/devices/dB/nonce", 200, r#"{"ok":true}"#);
    card_open(&da, &kca, r, "dB").unwrap();
    let n_m = last_body(r, "/v0/me/devices/dB/nonce")["nM"].as_str().unwrap().to_string();
    r.answer("/v0/me/self", 200, &json!({ "status": "pending", "approveNonce": n_m }).to_string());
    chain_answer(r, &shown.unwrap_or_else(|| vec![g.clone()]));
    r.answer("/v0/me/self/reveal", 200, r#"{"ok":true}"#);
    let sas = my_number(&db, &kcb, r).unwrap().unwrap();
    (Flow { da, kca, db, kcb, kb, g, f, n_m, n_p }, sas)
}

/// 허용 기기가 본 서버 줄(새 기기가 nP 를 연 뒤)
fn rows(fl: &Flow) -> String {
    json!({ "devices": [{ "id": "dB", "name": "iPhone", "status": "pending", "publicKey": fl.kb.public(), "e2ePub": fl.f["e2ePub"], "e2eSig": fl.f["e2eSig"],
        "approveCommit": fl.f["approveCommit"], "approveNonce": fl.n_m, "approveReveal": fl.n_p }] }).to_string()
}

/// 맞는 숫자로 허용 — (허용 기기 화면의 4자리 K, add 고리, 맡긴 확인 봉투)
fn approve(fl: &Flow, r: &FakeRelay, sas: u32) -> (String, Link, String) {
    let devs = rows(fl);
    r.answer("/v0/me/devices", 200, &devs);
    chain_answer(r, std::slice::from_ref(&fl.g));
    r.answer("/v0/me/devices", 200, &devs);
    r.answer("/v0/me/devices/dB/confirm", 200, r#"{"ok":true}"#);
    r.answer("/v0/me/devices/dB/approve", 200, r#"{"ok":true}"#);
    let k = approve_with_number(&fl.da, &fl.kca, r, "dB", &format!("{sas:06}")).unwrap();
    let l = last_body(r, "/v0/me/devices/dB/approve")["link"].clone();
    let add = Link { seq: 1, body: l["body"].as_str().unwrap().into(), sig: l["sig"].as_str().unwrap().into() };
    (k, add, last_body(r, "/v0/me/devices/dB/confirm")["confirm"].as_str().unwrap().to_string())
}

/// 새 기기 — 허용됐다는 서버 답 + 확인 봉투
fn approved(fl: &Flow, r: &FakeRelay, confirm: &str) {
    mutate(&fl.db, |s| s.pending = false).unwrap();
    r.answer("/v0/me/self", 200, &json!({ "status": "approved", "approveConfirm": confirm }).to_string());
}

fn last_body(r: &FakeRelay, path_end: &str) -> Value {
    let seen = r.seen.borrow();
    let (_, _, _, b) = seen.iter().rev().find(|(_, p, _, _)| p.ends_with(path_end)).expect("그 길로 보낸 적 없음");
    serde_json::from_str(b).unwrap()
}

#[test]
fn 받는_열쇠가_없는_옛_기기는_올리고_사슬이_없으면_사람이_첫_기기를_눌러야_시작한다() {
    // ADR 0007 R8 — 서버가 '사슬 없음'이라 해도 스스로 genesis 하지 않는다. 로그인 화면이 '첫 기기로 시작'을 묻는다
    let r = FakeRelay::default();
    let (d, kc, k) = device("ensure", "dA", &r, false);
    let mac = json!({ "devices": [{ "id": "dA", "name": "맥", "current": true, "status": "approved" }] }).to_string();
    r.answer("/v0/me/devices", 200, &mac);
    r.answer("/v0/me/e2e", 200, r#"{"ok":true}"#);
    chain_answer(&r, &[]);
    assert_eq!(ensure(&d, &kc, &r).unwrap(), Status::NeedStart);
    assert_eq!(last_body(&r, "/v0/me/e2e")["e2ePub"], k.e2e_public());
    assert!(!r.seen.borrow().iter().any(|(m, p, _, _)| m == "POST" && p == "/v0/me/chain"), "스스로 시작하지 않는다");
    assert_eq!(self_step(&d), "start");
    // 사람이 '첫 기기로 시작'
    r.answer("/v0/me/devices", 200, &mac);
    chain_answer(&r, &[]);
    r.answer("/v0/me/chain", 201, r#"{"seq":0}"#);
    // 시작한 뒤 사슬을 받아 적는다 — genesis 글은 시각 없이라 같은 열쇠면 같은 글
    chain_answer(&r, &[genesis(&k, "dA")]);
    start_chain(&d, &kc, &r).unwrap();
    let g = last_body(&r, "/v0/me/chain")["link"].clone();
    let link = Link { seq: 0, body: g["body"].as_str().unwrap().into(), sig: g["sig"].as_str().unwrap().into() };
    assert_eq!(link, genesis(&k, "dA"), "보낸 genesis = 받는 쪽이 받을 글");
    assert!(crate::e2e_team::in_chain(&d, &crate::team_relay::load_state(&d)), "시작한 사슬을 믿고 적어 둔다");
    assert_eq!(self_step(&d), "");
}

#[test]
fn 서버가_끊은_기기는_로그인_화면이_다시_로그인을_띄운다() {
    // 10-28 윈도우: 서버에서 지워진·끊긴 기기가 로그인된 채로 남아 문이 안 떴다
    let r = FakeRelay::default();
    let (d, _kc, _k) = device("revoked-step", "dR", &r, false);
    assert_ne!(self_step(&d), "relogin");
    mutate(&d, |s| s.revoked = true).unwrap();
    assert_eq!(self_step(&d), "relogin");
}

#[test]
fn 사슬이_이미_있거나_자동_허용_기기면_첫_기기로_시작하지_못한다() {
    let r = FakeRelay::default();
    let (d, kc, k) = device("start-refuse", "dA", &r, false);
    r.answer("/v0/me/devices", 200, &json!({ "devices": [{ "id": "dA", "name": "맥", "current": true, "status": "approved", "approvedBy": "auto" }] }).to_string());
    assert!(start_chain(&d, &kc, &r).unwrap_err().contains("자동 허용"));
    r.answer("/v0/me/devices", 200, &json!({ "devices": [{ "id": "dA", "name": "맥", "current": true, "status": "approved" }] }).to_string());
    chain_answer(&r, &[genesis(&DeviceKeys::from_seeds([1; 32], [2; 32]), "dZ")]);
    assert!(start_chain(&d, &kc, &r).unwrap_err().contains("이미"));
    assert!(!r.seen.borrow().iter().any(|(m, p, _, _)| m == "POST" && p == "/v0/me/chain"));
    let _ = k;
}

#[test]
fn 자동_허용_기기는_사슬을_시작하지_않고_봉인만_올려_기다린다() {
    let r = FakeRelay::default();
    let (d, kc, k) = device("auto", "dA", &r, false);
    r.answer("/v0/me/devices", 200, &json!({ "devices": [{ "id": "dA", "name": "맥", "current": true, "status": "approved", "approvedBy": "auto", "e2ePub": k.e2e_public() }] }).to_string());
    r.answer("/v0/accounts/a1/chain", 200, r#"{"links":[]}"#);
    r.answer("/v0/me/self/commit", 200, r#"{"ok":true}"#);
    assert_eq!(ensure(&d, &kc, &r).unwrap(), Status::Waiting);
    assert!(!r.seen.borrow().iter().any(|(_, p, _, _)| p == "/v0/me/chain"));
}

#[test]
fn 카드를_열면_양쪽에_같은_숫자가_뜨고_맞게_넣어야_허용되고_새_기기는_4자리를_넣어야_사슬을_믿는다() {
    let r = FakeRelay::default();
    let (fl, sas_b) = start("happy", &r, None);
    assert_eq!(last_body(&r, "/v0/me/self/reveal")["nP"], fl.n_p);
    assert_eq!(e2e_state::load(&fl.da).card_nm["dB"], fl.n_m, "숫자는 내가 낸 nM 으로 셈한다");
    r.answer("/v0/me/devices", 200, &rows(&fl));
    assert_eq!(card_number(&fl.da, &fl.kca, &r, "dB").unwrap(), Some(sas_b), "두 화면 숫자가 같다");
    // 틀린 숫자 — 고리도 확인 봉투도 안 보낸다
    r.answer("/v0/me/devices", 200, &rows(&fl));
    let wrong = format!("{:06}", (sas_b + 1) % 1_000_000);
    assert!(approve_with_number(&fl.da, &fl.kca, &r, "dB", &wrong).unwrap_err().contains("숫자가 달라요"));
    assert!(!r.seen.borrow().iter().any(|(_, p, _, _)| p.ends_with("/approve") || p.ends_with("/confirm")));
    // 맞는 숫자 — add 고리 + 4자리 K
    let (k, add, confirm) = approve(&fl, &r, sas_b);
    assert!(k.len() == 4 && k.chars().all(|c| c.is_ascii_digit()), "{k}");
    assert!(!confirm.contains(&k), "K 는 봉투 밖으로 안 나간다");
    let c = e2e_chain::verify("a1", &[fl.g.clone(), add.clone()]).expect("받는 쪽 검증이 받는 add 고리");
    assert_eq!(c.devices["dB"].e2e, fl.kb.e2e_public());
    assert!(!e2e_state::load(&fl.da).card_nm.contains_key("dB"), "쓴 nM 은 지운다");
    // 새 기기 — 4자리 전엔 사슬을 안 믿고, K 를 넣으면 믿는다
    approved(&fl, &r, &confirm);
    r.answer("/v0/me/devices", 200, &json!({ "devices": [{ "id": "dB", "name": "iPhone", "current": true, "status": "approved", "e2ePub": fl.kb.e2e_public() }] }).to_string());
    chain_answer(&r, &[fl.g.clone(), add.clone()]);
    assert_eq!(ensure(&fl.db, &fl.kcb, &r).unwrap(), Status::NeedCode);
    assert!(!e2e_state::load(&fl.db).pins.contains_key("a1"));
    chain_answer(&r, &[fl.g.clone(), add.clone()]);
    assert_eq!(self_step(&fl.db), "need", "로그인 화면이 4자리 넣기를 띄운다");
    confirm_code(&fl.db, &fl.kcb, &r, &k).unwrap();
    assert_eq!(self_step(&fl.db), "");
    r.answer("/v0/me/devices", 200, &json!({ "devices": [{ "id": "dB", "name": "iPhone", "current": true, "status": "approved", "e2ePub": fl.kb.e2e_public() }] }).to_string());
    chain_answer(&r, &[fl.g.clone(), add]);
    assert_eq!(ensure(&fl.db, &fl.kcb, &r).unwrap(), Status::InChain);
}

// ── 공격 재현(3차 리뷰 R7): 새 기기가 자기 계정 사슬을 처음 믿기 ──

#[test]
fn 공격_서버가_새_기기에_공격자_사슬과_맞춘_add_를_주면_숫자가_갈리고_핀을_안_꽂는다() {
    let r = FakeRelay::default();
    let kx = DeviceKeys::from_seeds([90; 32], [91; 32]);
    let gx = genesis(&kx, "dX");
    let (fl, sas_b) = start("r7-fake", &r, Some(vec![gx.clone()]));
    r.answer("/v0/me/devices", 200, &rows(&fl));
    let sas_a = card_number(&fl.da, &fl.kca, &r, "dB").unwrap().unwrap();
    assert_ne!(sas_a, sas_b, "새 기기에 보여 준 사슬이 다르면 숫자가 갈린다 — 사람이 넣으면 허용 기기가 거절");
    // 그래도 서버가 [gX → dB add] 를 주고 허용됐다고 한다(전에는 처음 믿기로 그대로 믿었다)
    let addx = add_link(&kx, "dX", &gx, &fl.kb, "dB");
    approved(&fl, &r, "");
    r.answer("/v0/me/devices", 200, &json!({ "devices": [{ "id": "dB", "name": "iPhone", "current": true, "status": "approved", "e2ePub": fl.kb.e2e_public() }] }).to_string());
    chain_answer(&r, &[gx.clone(), addx.clone()]);
    assert_ne!(ensure(&fl.db, &fl.kcb, &r).unwrap(), Status::InChain);
    assert!(!e2e_state::load(&fl.db).pins.contains_key("a1"), "4자리 확인 전엔 핀을 안 꽂는다");
    // 서버가 K 를 짐작해 만든 확인 봉투 — 사람이 넣는 4자리(진짜 허용 기기엔 안 떴으니 무엇이든)와 안 맞는다
    let forged = seal_confirm(&fl.kb.e2e_public(), "a1", "dB", &link_hash(&gx.body, &gx.sig), &link_hash(&addx.body, &addx.sig), "0000", &fl.n_p, &fl.n_m).unwrap();
    r.answer("/v0/me/self", 200, &json!({ "status": "approved", "approveConfirm": forged }).to_string());
    assert!(confirm_code(&fl.db, &fl.kcb, &r, "1234").is_err());
    assert!(!e2e_state::load(&fl.db).pins.contains_key("a1"));
}

#[test]
fn 공격_k_를_모르는_서버가_확인_봉투를_바꿔치기하면_안_믿는다() {
    let r = FakeRelay::default();
    let (fl, sas) = start("r7-forge", &r, None);
    let (k, add, _) = approve(&fl, &r, sas);
    let guess = if k == "0000" { "0001" } else { "0000" };
    let forged = seal_confirm(&fl.kb.e2e_public(), "a1", "dB", &link_hash(&fl.g.body, &fl.g.sig), &link_hash(&add.body, &add.sig), guess, &fl.n_p, &fl.n_m).unwrap();
    approved(&fl, &r, &forged);
    assert!(confirm_code(&fl.db, &fl.kcb, &r, &k).is_err(), "진짜 K 로도 서버가 만든 봉투는 안 열린다");
    assert!(!e2e_state::load(&fl.db).pins.contains_key("a1"));
}

#[test]
fn 틀린_k_를_넣으면_그_흐름은_끝_맞는_k_로도_다시_안_된다() {
    let r = FakeRelay::default();
    let (fl, sas) = start("r7-wrong", &r, None);
    let (k, add, confirm) = approve(&fl, &r, sas);
    let wrong = format!("{:04}", (k.parse::<u32>().unwrap() + 1) % 10_000);
    approved(&fl, &r, &confirm);
    assert!(confirm_code(&fl.db, &fl.kcb, &r, &wrong).unwrap_err().contains("4자리가 달라요"));
    assert_eq!(self_step(&fl.db), "failed");
    r.answer("/v0/me/self", 200, &json!({ "status": "approved", "approveConfirm": confirm }).to_string());
    chain_answer(&r, &[fl.g.clone(), add]);
    assert!(confirm_code(&fl.db, &fl.kcb, &r, &k).unwrap_err().contains("처음부터"), "한 번 틀리면 다시 넣기 없이 처음부터");
    assert!(!e2e_state::load(&fl.db).pins.contains_key("a1"));
}

#[test]
fn 서버가_준_nm_이_내가_낸_것과_다르면_숫자를_안_낸다() {
    let r = FakeRelay::default();
    let (da, kca, _, g) = approver("swap", "dA", &r);
    r.answer("/v0/me/devices", 200, r#"{"devices":[{"id":"dB","name":"x","status":"pending","publicKey":"K","e2ePub":"E","approveCommit":"C"}]}"#);
    chain_answer(&r, &[g]);
    r.answer("/v0/me/devices/dB/nonce", 200, r#"{"ok":true}"#);
    card_open(&da, &kca, &r, "dB").unwrap();
    r.answer("/v0/me/devices", 200, &json!({ "devices": [{ "id": "dB", "name": "x", "status": "pending", "approveNonce": "AAAAAAAAAAAAAAAAAAAAAA", "approveReveal": "AAAAAAAAAAAAAAAAAAAAAA" }] }).to_string());
    assert!(card_number(&da, &kca, &r, "dB").is_err());
}

#[test]
fn 다른_카드가_먼저_열었으면_busy_를_사람_말로() {
    let r = FakeRelay::default();
    let (da, kca, _, g) = approver("busy", "dA", &r);
    r.answer("/v0/me/devices", 200, r#"{"devices":[{"id":"dB","name":"x","status":"pending","publicKey":"K","e2ePub":"E","approveCommit":"C"}]}"#);
    chain_answer(&r, &[g]);
    r.answer("/v0/me/devices/dB/nonce", 409, r#"{"error":"busy"}"#);
    assert!(card_open(&da, &kca, &r, "dB").unwrap_err().contains("다른 기기에서"));
}

#[test]
fn 끊기_전에_사슬에서도_빼는_고리를_보낸다_사슬_밖이면_안_보낸다() {
    let r = FakeRelay::default();
    let (da, kca, ka) = device("remove", "dA", &r, false);
    let kb = DeviceKeys::from_seeds([7; 32], [8; 32]);
    let g = genesis(&ka, "dA");
    let body = json!({ "v": 1, "account": "a1", "seq": 1, "prev": link_hash(&g.body, &g.sig), "by": "dA", "kind": "add", "device": "dB", "edPub": kb.public(), "e2ePub": kb.e2e_public(), "selfSig": kb.e2e_key_sig() }).to_string();
    let add = Link { seq: 1, sig: ka.sign(&format!("chammo-chain/1\n{body}")), body };
    // 사슬에 든 게 저장 안 됨 → 요청 없이
    remove_link(&da, &kca, &r, "dB").unwrap();
    assert!(r.seen.borrow().is_empty());
    e2e_state::seed_trusted(&da, "a1", vec![g.clone(), add.clone()]);
    r.answer("/v0/accounts/a1/chain", 200, &json!({ "links": [g.clone(), add.clone()] }).to_string());
    r.answer("/v0/me/chain", 201, "{}");
    remove_link(&da, &kca, &r, "dB").unwrap();
    let l = last_body(&r, "/v0/me/chain")["link"].clone();
    let rm = Link { seq: 2, body: l["body"].as_str().unwrap().into(), sig: l["sig"].as_str().unwrap().into() };
    let c = e2e_chain::verify("a1", &[g, add, rm]).unwrap();
    assert!(!c.devices.contains_key("dB"));
}

// ── 공격 재현(리뷰 B 치명 1): 서버가 숫자를 갈아 맞추기 ──

#[test]
fn 공격_nm_을_본_뒤_서버가_새_기기_열쇠·봉인을_바꾸면_허용_기기는_숫자를_안_낸다() {
    let r = FakeRelay::default();
    let (da, kca, _, g) = approver("grind-a", "dA", &r);
    let (db, _, kb) = device("grind-b", "dB", &r, true);
    let f = login_fields(&db, &kb).unwrap();
    // 카드를 열 때 서버가 보여 준 진짜 새 기기
    r.answer("/v0/me/devices", 200, &json!({ "devices": [{ "id": "dB", "name": "iPhone", "status": "pending", "publicKey": kb.public(), "e2ePub": f["e2ePub"], "e2eSig": f["e2eSig"], "approveCommit": f["approveCommit"] }] }).to_string());
    chain_answer(&r, &[g]);
    r.answer("/v0/me/devices/dB/nonce", 200, r#"{"ok":true}"#);
    card_open(&da, &kca, &r, "dB").unwrap();
    let n_m = last_body(&r, "/v0/me/devices/dB/nonce")["nM"].as_str().unwrap().to_string();
    // nM 을 본 서버가 자기 열쇠·새 nP′ 로 봉인을 새로 만들어 보여 준다(숫자를 맞출 때까지 돌릴 수 있다)
    let kz = DeviceKeys::from_seeds([66; 32], [67; 32]);
    let n_p2 = [9u8; 16];
    let raw = |s: &str| B64.decode(s).unwrap();
    let commit2 = approve_commit(&raw(&kz.public()), &raw(&kz.e2e_public()), &n_p2);
    r.answer("/v0/me/devices", 200, &json!({ "devices": [{ "id": "dB", "name": "iPhone", "status": "pending", "publicKey": kz.public(), "e2ePub": kz.e2e_public(), "e2eSig": kz.e2e_key_sig(),
        "approveCommit": commit2, "approveNonce": n_m, "approveReveal": B64.encode(n_p2) }] }).to_string());
    assert!(card_number(&da, &kca, &r, "dB").is_err(), "카드를 연 때 적어 둔 봉인·열쇠와 다르면 숫자를 안 낸다");
}

#[test]
fn 공격_서버가_nm_을_바꿔_보여_줘도_새_기기는_처음_숫자만_낸다() {
    let r = FakeRelay::default();
    let (db, kcb, kb) = device("grind-new", "dB", &r, true);
    login_fields(&db, &kb).unwrap();
    r.answer("/v0/me/self", 200, r#"{"status":"pending","approveNonce":"AAAAAAAAAAAAAAAAAAAAAA"}"#);
    chain_answer(&r, &[genesis(&DeviceKeys::from_seeds([1; 32], [2; 32]), "dA")]);
    r.answer("/v0/me/self/reveal", 200, r#"{"ok":true}"#);
    let first = my_number(&db, &kcb, &r).unwrap().unwrap();
    // 같은 nM 이면 같은 숫자(다시 열기 없이)
    r.answer("/v0/me/self", 200, r#"{"status":"pending","approveNonce":"AAAAAAAAAAAAAAAAAAAAAA"}"#);
    assert_eq!(my_number(&db, &kcb, &r).unwrap(), Some(first));
    // nP 를 본 서버가 nM 을 바꿔 다른 숫자를 만들게 한다
    r.answer("/v0/me/self", 200, r#"{"status":"pending","approveNonce":"BBBBBBBBBBBBBBBBBBBBBB"}"#);
    r.answer("/v0/me/self/reveal", 409, r#"{"error":"revealed"}"#);
    assert!(my_number(&db, &kcb, &r).unwrap_err().contains("숫자 다시"));
}

#[test]
fn 공격_첫_reveal_이_500_이어도_다른_nm_으로는_숫자를_안_낸다() {
    // 2차 리뷰 치명 1(R4) — 서버는 응답과 무관하게 본문에서 nP 를 본다. 500 을 주고 nM2 를 갈아 맞춰 주면 새 기기가 그 숫자를 띄웠다
    let r = FakeRelay::default();
    let (db, kcb, kb) = device("reveal500", "dB", &r, true);
    login_fields(&db, &kb).unwrap();
    r.answer("/v0/me/self", 200, r#"{"status":"pending","approveNonce":"AAAAAAAAAAAAAAAAAAAAAA"}"#);
    chain_answer(&r, &[genesis(&DeviceKeys::from_seeds([1; 32], [2; 32]), "dA")]);
    r.answer("/v0/me/self/reveal", 500, r#"{"error":"boom"}"#);
    assert!(my_number(&db, &kcb, &r).is_err());
    r.answer("/v0/me/self", 200, r#"{"status":"pending","approveNonce":"BBBBBBBBBBBBBBBBBBBBBB"}"#);
    assert!(my_number(&db, &kcb, &r).unwrap_err().contains("숫자 다시"), "다른 nM 이면 열지도 셈하지도 않는다");
    assert_eq!(r.seen.borrow().iter().filter(|(_, p, _, _)| p.ends_with("/reveal")).count(), 1, "nM2 로는 nP 를 다시 안 보낸다");
    // 같은 nM 으로는 다시 보낼 수 있다
    r.answer("/v0/me/self", 200, r#"{"status":"pending","approveNonce":"AAAAAAAAAAAAAAAAAAAAAA"}"#);
    r.answer("/v0/me/self/reveal", 200, r#"{"ok":true}"#);
    assert!(my_number(&db, &kcb, &r).unwrap().is_some());
}

#[test]
fn 숫자_다시로_봉인이_바뀌면_허용_카드를_다시_열_수_있다() {
    // 2차 리뷰 중간 5 — 카드 상태가 남아 영영 못 열던 것
    let r = FakeRelay::default();
    let (da, kca, _, g) = approver("reopen", "dA", &r);
    let row = |commit: &str, nonce: &str| json!({ "devices": [{ "id": "dB", "name": "x", "status": "pending", "publicKey": "K", "e2ePub": "E", "approveCommit": commit, "approveNonce": nonce }] }).to_string();
    r.answer("/v0/me/devices", 200, &row("C1", ""));
    chain_answer(&r, std::slice::from_ref(&g));
    r.answer("/v0/me/devices/dB/nonce", 200, r#"{"ok":true}"#);
    card_open(&da, &kca, &r, "dB").unwrap();
    // 새 기기가 '숫자 다시' — 봉인 C2, 서버는 nM 을 비움
    r.answer("/v0/me/devices", 200, &row("C2", ""));
    chain_answer(&r, &[g]);
    r.answer("/v0/me/devices/dB/nonce", 200, r#"{"ok":true}"#);
    card_open(&da, &kca, &r, "dB").unwrap();
    assert_eq!(e2e_state::load(&da).card_seen["dB"].commit, "C2", "새 봉인으로 다시 연다(nM 도 새로)");
    assert_eq!(r.seen.borrow().iter().filter(|(_, p, _, _)| p.ends_with("/nonce")).count(), 2);
}

#[test]
fn 네자리를_틀려_묶인_기기도_로그아웃·다시_로그인하면_풀린다() {
    // 5차 리뷰 중간 — confirm_failed 를 '숫자 다시'도 로그아웃도 안 지워 그 맥이 영영 묶였다. 다른 계정 핀은 남긴다
    let r = FakeRelay::default();
    let (d, kc, k) = device("unstick", "dB", &r, false);
    let other = genesis(&DeviceKeys::from_seeds([5; 32], [6; 32]), "dP");
    e2e_state::mutate(&d, |s| {
        s.confirm_failed = true;
        s.no_chain = true;
        s.my_sas = e2e_state::SasSeen { identity: "I".into(), head: "H".into() };
        s.pins.insert("a1".into(), Default::default());
        s.pins.insert("a9".into(), Default::default());
        s.chains.insert("a9".into(), vec![other]);
    })
    .unwrap();
    assert_eq!(self_step(&d), "failed");
    crate::team_relay::forget_local(&d, &kc).unwrap();
    let s = e2e_state::load(&d);
    assert!(!s.confirm_failed && !s.no_chain && s.my_sas.identity.is_empty());
    assert!(!s.pins.contains_key("a1"), "내 계정 핀은 지운다 — 새 기기로 다시 4자리부터");
    assert!(s.pins.contains_key("a9") && s.chains.contains_key("a9"), "다른 계정 핀은 남긴다");
    // 로그인 마침에서도(로그아웃 없이 다시 로그인한 경우)
    e2e_state::mutate(&d, |s| s.confirm_failed = true).unwrap();
    login_fields(&d, &k).unwrap();
    assert!(!e2e_state::load(&d).confirm_failed);
}

#[test]
fn ensure_가_한_번도_안_돈_계정_기기는_checking_이라_화면이_다시_묻는다() {
    // 첫 기기 화면이 안 떴다(1025 B') — 앱이 뜨자마자 물으면 ensure 전이라 '' 이 와서 로그인 화면이 다시 안 물었다
    let r = FakeRelay::default();
    let (d, kc, k) = device("checking", "dA", &r, false);
    assert_eq!(self_step(&d), "checking", "계정은 있는데 내 계정 핀이 없고 ensure 전");
    r.answer("/v0/me/devices", 200, &json!({ "devices": [{ "id": "dA", "name": "맥", "current": true, "status": "approved", "e2ePub": k.e2e_public() }] }).to_string());
    chain_answer(&r, &[]);
    assert_eq!(ensure(&d, &kc, &r).unwrap(), Status::NeedStart);
    assert_eq!(self_step(&d), "start", "ensure 뒤엔 정해진다");
}

/// 계정 되찾기 갈래 ① — prev 다음에 id 가 자기 열쇠로 다시 시작(reset)
fn reset_link(k: &DeviceKeys, id: &str, prev: &Link) -> Link {
    let body = json!({ "v": 1, "account": "a1", "seq": prev.seq + 1, "prev": link_hash(&prev.body, &prev.sig), "by": id, "kind": "reset", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    Link { seq: prev.seq + 1, sig: k.sign(&format!("chammo-chain/1\n{body}")), body }
}

/// yg3204 모양 — 사슬을 시작한 옛 기기(dOld)는 서버에서 끊겨 목록에 없고, 새 기기 dB 는 계정 첫 기기로 허용됨(사슬 밖)
fn lost_all(tag: &str, r: &FakeRelay, approved_by: &str) -> (std::path::PathBuf, Fake, DeviceKeys, Link, String) {
    let (d, kc, k) = device(tag, "dB", r, false);
    let old = DeviceKeys::from_seeds([7; 32], [8; 32]);
    let g = genesis(&old, "dOld");
    let rows = json!({ "devices": [{ "id": "dB", "name": "새 맥", "current": true, "status": "approved", "approvedBy": approved_by, "e2ePub": k.e2e_public(), "inChain": false }] }).to_string();
    (d, kc, k, g, rows)
}

#[test]
fn 남은_사슬_기기가_없으면_다시_시작을_묻고_사람이_누르면_내_reset_을_믿는다() {
    let r = FakeRelay::default();
    let (d, kc, k, g, rows) = lost_all("reset", &r, "");
    r.answer("/v0/me/devices", 200, &rows);
    chain_answer(&r, std::slice::from_ref(&g));
    assert_eq!(ensure(&d, &kc, &r).unwrap(), Status::NeedReset);
    assert_eq!(self_step(&d), "reset");
    assert!(!r.seen.borrow().iter().any(|(m, p, _, _)| m == "POST" && p == "/v0/me/chain"), "스스로 다시 시작하지 않는다");
    // 사람이 '이 기기로 다시 시작'
    r.answer("/v0/me/devices", 200, &rows);
    chain_answer(&r, std::slice::from_ref(&g));
    r.answer("/v0/me/chain", 201, r#"{"seq":1}"#);
    let want = reset_link(&k, "dB", &g);
    chain_answer(&r, &[g.clone(), want.clone()]);
    reset_chain(&d, &kc, &r).unwrap();
    let sent = last_body(&r, "/v0/me/chain")["link"].clone();
    assert_eq!(Link { seq: 1, body: sent["body"].as_str().unwrap().into(), sig: sent["sig"].as_str().unwrap().into() }, want, "보낸 reset = 받는 쪽이 받을 글");
    assert!(crate::e2e_team::in_chain(&d, &crate::team_relay::load_state(&d)), "내가 서명한 reset 이라 바로 믿는다");
    assert_eq!(self_step(&d), "");
    // 다음 ensure 는 사슬 안
    r.answer("/v0/me/devices", 200, &rows);
    chain_answer(&r, &[g.clone(), want.clone()]);
    assert_eq!(ensure(&d, &kc, &r).unwrap(), Status::InChain);
}

#[test]
fn 사슬_기기가_살아_있거나_자동_허용_기기면_다시_시작하지_못한다() {
    // 살아 있는 사슬 기기 — 그 기기에서 숫자로 허용받으면 된다(대화가 이어진다)
    let r = FakeRelay::default();
    let (d, kc, k, g, _) = lost_all("reset-alive", &r, "");
    let alive = json!({ "devices": [
        { "id": "dOld", "name": "옛 맥", "status": "approved", "inChain": true },
        { "id": "dB", "name": "새 맥", "current": true, "status": "approved", "e2ePub": k.e2e_public(), "inChain": false }] }).to_string();
    r.answer("/v0/me/devices", 200, &alive);
    chain_answer(&r, std::slice::from_ref(&g));
    r.answer("/v0/me/self/commit", 200, r#"{"ok":true}"#);
    assert_eq!(ensure(&d, &kc, &r).unwrap(), Status::Waiting);
    assert_ne!(self_step(&d), "reset");
    // 허용된 사슬 밖 기기 — 살아 있는 사슬 기기에서 숫자로 확인받는 화면(10-26 '어디서든 허용')
    assert_eq!(self_step(&d), "outside");
    r.answer("/v0/me/devices", 200, &alive);
    chain_answer(&r, std::slice::from_ref(&g));
    assert!(reset_chain(&d, &kc, &r).unwrap_err().contains("쓰는 내 기기"));
}

#[test]
fn 자동_허용_기기는_사슬_기기가_하나도_없으면_다시_로그인을_묻는다() {
    // 10-26 공격 리뷰 — auto 기기가 다시 시작하면 숨은 탈취자 기기가 신원을 가져갈 수 있어 서버가 막는다(auto_approved).
    // 대신 갇히지 않게 '다시 로그인' — 로그아웃 뒤 다시 로그인하면 허용해 줄 기기 0 이라 바로 허용돼 다시 시작(relay ADR 0007 덧붙임)
    let r = FakeRelay::default();
    let (d, kc, _, g, rows) = lost_all("relogin-auto", &r, "auto");
    r.answer("/v0/me/devices", 200, &rows);
    chain_answer(&r, std::slice::from_ref(&g));
    assert_eq!(ensure(&d, &kc, &r).unwrap(), Status::NeedRelogin);
    assert_eq!(self_step(&d), "relogin");
    assert!(!r.seen.borrow().iter().any(|(m, p, _, _)| m == "POST" && p == "/v0/me/self/commit"), "허용해 줄 기기가 없으니 봉인을 안 올린다");
    r.answer("/v0/me/devices", 200, &rows);
    assert!(reset_chain(&d, &kc, &r).unwrap_err().contains("자동 허용"));
    assert!(!r.seen.borrow().iter().any(|(m, p, _, _)| m == "POST" && p == "/v0/me/chain"));
}

#[test]
fn 사슬에_들면_outside_가_풀린다() {
    let r = FakeRelay::default();
    let (d, kc, k, g, _) = lost_all("outside-done", &r, "auto");
    let alive = json!({ "devices": [
        { "id": "dOld", "name": "옛 맥", "status": "approved", "inChain": true },
        { "id": "dB", "name": "새 맥", "current": true, "status": "approved", "approvedBy": "auto", "e2ePub": k.e2e_public(), "inChain": false }] }).to_string();
    r.answer("/v0/me/devices", 200, &alive);
    chain_answer(&r, std::slice::from_ref(&g));
    r.answer("/v0/me/self/commit", 200, r#"{"ok":true}"#);
    assert_eq!(ensure(&d, &kc, &r).unwrap(), Status::Waiting);
    assert_eq!(self_step(&d), "outside", "auto 기기도 살아 있는 사슬 기기가 있으면 숫자로 확인받는다");
    // 4자리 확인까지 끝나 핀이 꽂히면 화면 없음
    e2e_state::mutate(&d, |s| { s.pins.insert("a1".into(), Default::default()); }).unwrap();
    assert_eq!(self_step(&d), "");
}

#[test]
fn 공격_다시_시작한_뒤_서버가_옛_사슬로_되감거나_남의_reset_을_끼우면_안_믿는다() {
    let r = FakeRelay::default();
    let (d, kc, k, g, rows) = lost_all("reset-attack", &r, "");
    let mine = reset_link(&k, "dB", &g);
    r.answer("/v0/me/devices", 200, &rows);
    chain_answer(&r, std::slice::from_ref(&g));
    r.answer("/v0/me/chain", 201, r#"{"seq":1}"#);
    chain_answer(&r, &[g.clone(), mine.clone()]);
    reset_chain(&d, &kc, &r).unwrap();
    let st = crate::team_relay::load_state(&d);
    // 내가 한 번 더 다시 시작(나를 뺀 뒤 r2) — 예전 머리를 이으니 새 신원으로 믿는다
    let body = json!({ "v": 1, "account": "a1", "seq": 2, "prev": link_hash(&mine.body, &mine.sig), "by": "dB", "kind": "remove", "device": "dB" }).to_string();
    let rm = Link { seq: 2, sig: k.sign(&format!("chammo-chain/1\n{body}")), body };
    let mine2 = reset_link(&k, "dB", &rm);
    chain_answer(&r, &[g.clone(), mine.clone(), rm.clone(), mine2.clone()]);
    assert!(matches!(e2e_state::chain_of(&d, &kc, &r, &st, "a1", true).unwrap(), Trust::Ok(_)));
    // 되감기 — 서버가 내 옛 reset(r1)까지만 보여 준다. 신원 고리는 여전히 내 열쇠지만 본 머리를 안 이으니 갈림
    chain_answer(&r, &[g.clone(), mine.clone()]);
    assert_eq!(e2e_state::chain_of(&d, &kc, &r, &st, "a1", true).unwrap(), Trust::Forked);
    // 내 reset 전으로 되감기도 갈림
    chain_answer(&r, std::slice::from_ref(&g));
    assert_eq!(e2e_state::chain_of(&d, &kc, &r, &st, "a1", true).unwrap(), Trust::Forked);
    // 남(서버 기기)이 내 뒤에 다시 시작 — 내 열쇠 서명이 아니니 '바뀜'(받아들이기 전엔 안 보냄). 핀이 '갈림'이 아닌 새 기기로
    let evil = DeviceKeys::from_seeds([9; 32], [9; 32]);
    let r2 = FakeRelay::default();
    let (d3, kc3, k3, g3, rows3) = lost_all("reset-attack-3", &r2, "");
    let mine3 = reset_link(&k3, "dB", &g3);
    r2.answer("/v0/me/devices", 200, &rows3);
    chain_answer(&r2, std::slice::from_ref(&g3));
    r2.answer("/v0/me/chain", 201, r#"{"seq":1}"#);
    chain_answer(&r2, &[g3.clone(), mine3.clone()]);
    reset_chain(&d3, &kc3, &r2).unwrap();
    chain_answer(&r2, &[g3.clone(), mine3.clone(), reset_link(&evil, "dEvil", &mine3)]);
    let st3 = crate::team_relay::load_state(&d3);
    assert!(matches!(e2e_state::chain_of(&d3, &kc3, &r2, &st3, "a1", true).unwrap(), Trust::Changed(_)));
}

#[test]
fn 남의_reset_으로_시작하는_사슬은_내_사슬로_처음_믿지_않는다() {
    // 서버가 '공격자 기기가 다시 시작한 사슬'에 내 기기를 넣어 보여 줘도 4자리 확인 전엔 확인 전(R7)
    let r = FakeRelay::default();
    let (d, kc, k, g, _) = lost_all("reset-other", &r, "");
    let evil = DeviceKeys::from_seeds([9; 32], [9; 32]);
    let er = reset_link(&evil, "dEvil", &g);
    let add = add_link(&evil, "dEvil", &er, &k, "dB");
    let st = crate::team_relay::load_state(&d);
    chain_answer(&r, &[g, er, add]);
    assert!(matches!(e2e_state::chain_of(&d, &kc, &r, &st, "a1", true).unwrap(), Trust::Unconfirmed(_)));
}

#[test]
fn 봉인_없는_대기_기기는_relogin_봉인이_있으면_기다림() {
    // 옛 판(0.4.1) 로그인은 받는 열쇠·봉인을 안 올렸고, 대기 기기는 /v0/me/e2e 도 막혀 숫자가 영영 안 뜬다(10-26 아이맥)
    let r = FakeRelay::default();
    let (d, _kc, k) = device("relogin", "dA", &r, true);
    assert_eq!(self_step(&d), "relogin");
    // 이 판 로그인은 봉인을 같이 올린다 — 평소 대기
    login_fields(&d, &k).unwrap();
    assert_eq!(self_step(&d), "");
    // 4자리가 틀린 흐름이 먼저
    e2e_state::mutate(&d, |s| { s.my_np.clear(); s.confirm_failed = true; }).unwrap();
    assert_eq!(self_step(&d), "failed");
    // 허용돼 핀이 꽂힌 뒤(nP 지워짐)엔 대기가 늦게 풀려도 relogin 이 아니다
    e2e_state::mutate(&d, |s| { s.confirm_failed = false; s.pins.insert("a1".into(), Default::default()); }).unwrap();
    assert_eq!(self_step(&d), "");
}

// ── 계정 되찾기 갈래 ②(relay ADR 0007 R9) — 잃은 맥(dOld)이 서버엔 사슬 기기로 살아 있고 새 맥 dB 는 대기 ──

fn waiting_for(d: &std::path::Path, mine: bool, ready_in_ms: i64) {
    let at = (now_ms() as i64 + ready_in_ms) as u64;
    mutate(d, |s| s.recover = Some(crate::team_relay::Recover { ready_at: at, mine, device: if mine { "dB".into() } else { "dX".into() }, device_name: "새 맥".into(), place: "서울".into() })).unwrap();
}

#[test]
fn 되찾기_코드는_서버가_준_8자리_모양일_때만_보여_준다() {
    let r = FakeRelay::default();
    let (d, kc, _) = device("rcv-code", "dB", &r, true);
    r.answer("/v0/me/recover/code", 200, r#"{"code":"K7QM2XPA","expiresAt":99}"#);
    assert_eq!(recover_code(&d, &kc, &r).unwrap(), ("K7QM2XPA".to_string(), 99));
    // 서버가 엉뚱한 글(주소·긴 글)을 코드라고 주면 화면에 안 띄운다
    r.answer("/v0/me/recover/code", 200, r#"{"code":"https://evil.test/x","expiresAt":99}"#);
    assert!(recover_code(&d, &kc, &r).is_err());
    r.answer("/v0/me/recover/code", 409, r#"{"error":"recover_open","readyAt":5}"#);
    assert!(recover_code(&d, &kc, &r).is_err());
}

#[test]
fn 되찾기_기다림·마치기_단계는_내_요청일_때만() {
    let r = FakeRelay::default();
    let (d, _, _) = device("rcv-step", "dB", &r, true);
    waiting_for(&d, true, 3_600_000);
    assert_eq!(self_step(&d), "recover-wait");
    waiting_for(&d, true, -1000);
    assert_eq!(self_step(&d), "recover-ready");
    // 남의 요청(내 다른 기기 화면) — 이 기기 문은 그대로, 카드는 device_cards 몫
    waiting_for(&d, false, -1000);
    assert_ne!(self_step(&d), "recover-ready");
}

#[test]
fn 다시_시작_마치기는_내_reset_을_서명해_보내고_바로_믿는다() {
    let r = FakeRelay::default();
    let (d, kc, k) = device("rcv-finish", "dB", &r, true);
    let old = DeviceKeys::from_seeds([7; 32], [8; 32]);
    let g = genesis(&old, "dOld");
    waiting_for(&d, true, -1000);
    chain_answer(&r, std::slice::from_ref(&g));
    r.answer("/v0/me/recover/finish", 200, r#"{"seq":1,"revoked":1}"#);
    let want = reset_link(&k, "dB", &g);
    chain_answer(&r, &[g.clone(), want.clone()]);
    recover_finish(&d, &kc, &r).unwrap();
    let sent = last_body(&r, "/v0/me/recover/finish")["link"].clone();
    assert_eq!(Link { seq: 1, body: sent["body"].as_str().unwrap().into(), sig: sent["sig"].as_str().unwrap().into() }, want);
    let st = crate::team_relay::load_state(&d);
    assert!(crate::e2e_team::in_chain(&d, &st), "내가 서명한 reset 이라 바로 믿는다");
    assert!(!st.pending && st.recover.is_none());
}

#[test]
fn 아직_48시간_전이거나_남의_요청이면_마치기를_안_보낸다() {
    let r = FakeRelay::default();
    let (d, kc, _) = device("rcv-early", "dB", &r, true);
    waiting_for(&d, true, 3_600_000);
    assert!(recover_finish(&d, &kc, &r).is_err());
    waiting_for(&d, false, -1000);
    assert!(recover_finish(&d, &kc, &r).is_err());
    mutate(&d, |s| s.recover = None).unwrap();
    assert!(recover_finish(&d, &kc, &r).is_err());
    assert!(!r.seen.borrow().iter().any(|(_, p, _, _)| p == "/v0/me/recover/finish"));
}

#[test]
fn 되찾기_취소는_서버에_보내고_기다림을_지운다() {
    let r = FakeRelay::default();
    let (d, kc, _) = device("rcv-cancel", "dB", &r, true);
    waiting_for(&d, true, 3_600_000);
    r.answer("/v0/me/recover/cancel", 200, r#"{"ok":true}"#);
    recover_cancel(&d, &kc, &r).unwrap();
    assert!(crate::team_relay::load_state(&d).recover.is_none());
}
