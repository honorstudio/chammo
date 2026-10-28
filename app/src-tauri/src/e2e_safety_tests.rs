use super::*;
use crate::e2e_chain::{link_hash, Link};
use crate::e2e_roster::TLink;
use crate::e2e_state::Pin;
use crate::team_relay::{mutate, Room};
use crate::team_relay_keys::DeviceKeys;
use serde_json::json;

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-safety-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn genesis(acc: &str, k: &DeviceKeys, id: &str) -> Link {
    let body = json!({ "v": 1, "account": acc, "seq": 0, "prev": "", "by": id, "kind": "genesis", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{body}")), body }
}

fn reset(acc: &str, prev: &Link, k: &DeviceKeys, id: &str) -> Link {
    let body = json!({ "v": 1, "account": acc, "seq": 1, "prev": link_hash(&prev.body, &prev.sig), "by": id, "kind": "reset", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    Link { seq: 1, sig: k.sign(&format!("chammo-chain/1\n{body}")), body }
}

fn tl(f: serde_json::Value) -> TLink {
    TLink { seq: 0, body: f.to_string(), sig: String::new(), sig2: None }
}

/// 나(a1)·철수(a2) — 팀 t1 명부 캐시, 둘 다 핀 ok, DM 방 r1
fn world(tag: &str) -> (std::path::PathBuf, Link) {
    let d = dir(tag);
    let (me, peer) = (DeviceKeys::from_seeds([1; 32], [2; 32]), DeviceKeys::from_seeds([3; 32], [4; 32]));
    let (g1, g2) = (genesis("a1", &me, "d1"), genesis("a2", &peer, "p1"));
    e2e_state::seed_trusted(&d, "a1", vec![g1]);
    e2e_state::seed_trusted(&d, "a2", vec![g2.clone()]);
    e2e_state::mutate(&d, |s| {
        s.rosters.insert("t1".into(), vec![
            tl(json!({ "kind": "team", "member": "m1", "account": "a1", "displayName": "사용자" })),
            tl(json!({ "kind": "join", "member": "m2", "account": "a2", "displayName": "철수" })),
        ]);
    })
    .unwrap();
    mutate(&d, |s| s.rooms = vec![Room { id: "r1".into(), kind: "dm".into(), peer: "m2".into(), team: "t1".into(), ..Default::default() }]).unwrap();
    (d, g2)
}

/// 철수가 다시 시작(reset) — 핀은 바뀜
fn changed(d: &std::path::Path, g2: &Link) {
    let x = reset("a2", g2, &DeviceKeys::from_seeds([9; 32], [8; 32]), "p9");
    e2e_state::mutate(d, |s| {
        s.chains.insert("a2".into(), vec![g2.clone(), x]);
        s.pins.get_mut("a2").unwrap().state = "changed".into();
    })
    .unwrap();
}

#[test]
fn 사람마다_보안_번호와_상태_내_계정은_빼고() {
    let (d, _) = world("people");
    let p = people(&d, "a1");
    assert_eq!(p.len(), 1);
    assert_eq!((p[0].account.as_str(), p[0].name.as_str(), p[0].team.as_str(), p[0].member.as_str(), p[0].state.as_str()), ("a2", "철수", "t1", "m2", "ok"));
    let s = e2e_state::load(&d);
    assert_eq!(p[0].number, e2e_chain::safety_number(&s.pins["a1"].identity, &s.pins["a2"].identity));
    assert_eq!(p[0].number.split(' ').count(), 6);
}

#[test]
fn 같아요는_핀이_ok_일_때만_확인됨으로() {
    let (d, g2) = world("verify");
    verify(&d, "a1", "a2").unwrap();
    assert_eq!(person(&d, "a1", "a2").unwrap().state, "verified");
    changed(&d, &g2);
    assert_eq!(person(&d, "a1", "a2").unwrap().state, "changed", "바뀌면 확인됨보다 바뀜이 먼저");
    assert!(verify(&d, "a1", "a2").unwrap_err().contains("카드"), "바뀐 사람은 카드에서만 받아들인다");
}

#[test]
fn 받아들이면_새_신원으로_핀_확인됨_막아_둠_풀림_그_사람_멈춘_말만_돌려준다() {
    let (d, g2) = world("accept");
    changed(&d, &g2);
    let before = person(&d, "a1", "a2").unwrap().number;
    block(&d, "a2").unwrap();
    assert!(person(&d, "a1", "a2").unwrap().blocked);
    hold(&d, Held { room: "r1".into(), cid: "c1".into(), body: "내일 3시?".into(), human: true, at: now_ms(), account: "a2".into() }).unwrap();
    hold(&d, Held { room: "r1".into(), cid: "c1".into(), body: "내일 3시?".into(), human: true, at: now_ms(), account: "a2".into() }).unwrap();
    hold(&d, Held { room: "rX".into(), cid: "c2".into(), body: "딴 사람".into(), human: false, at: now_ms(), account: "a9".into() }).unwrap();
    assert_eq!(held(&d).len(), 2, "같은 cid 는 한 번만");
    let shown = person(&d, "a1", "a2").unwrap();
    let out = accept(&d, "a2", &shown.identity, &shown.head).unwrap();
    assert_eq!(out.iter().map(|h| h.cid.as_str()).collect::<Vec<_>>(), vec!["c1"]);
    assert_eq!(held(&d).iter().map(|h| h.cid.as_str()).collect::<Vec<_>>(), vec!["c2"], "다른 사람 말은 그대로 멈춤");
    let p = person(&d, "a1", "a2").unwrap();
    assert_eq!((p.state.as_str(), p.blocked), ("verified", false));
    assert_eq!(p.number, before, "보여 준 번호(새 신원) 그대로 핀");
    assert_eq!(e2e_state::load(&d).pins["a2"].state, "ok");
}

#[test]
fn 멈추는_건_그_방_상대가_바뀜·갈림일_때만() {
    let (d, g2) = world("stopped");
    let st = crate::team_relay::load_state(&d);
    assert_eq!(stopped_peer(&d, &st, "r1"), None);
    changed(&d, &g2);
    assert_eq!(stopped_peer(&d, &st, "r1").as_deref(), Some("a2"));
    assert_eq!(stopped_peer(&d, &st, "없는방"), None);
    e2e_state::mutate(&d, |s| s.pins.get_mut("a2").unwrap().state = "forked".into()).unwrap();
    assert_eq!(stopped_peer(&d, &st, "r1").as_deref(), Some("a2"));
    let _ = Pin::default();
}

// ── 6차 리뷰 ──

#[test]
fn 공격_번호를_견주는_사이_서버가_다른_reset_사슬을_보여_주면_받아들이지_않는다() {
    // 카드 번호는 띄울 때 사슬로 셈했는데 accept 는 그 순간 캐시 사슬로 핀을 박았다
    let (d, g2) = world("swap-while-compare");
    changed(&d, &g2);
    let shown = person(&d, "a1", "a2").unwrap();
    // 사람이 번호를 견주는 사이 서버가 다른 reset 을 보여 준다(캐시가 바뀜)
    let x2 = reset("a2", &g2, &DeviceKeys::from_seeds([77; 32], [78; 32]), "pZ");
    e2e_state::mutate(&d, |s| {
        s.chains.insert("a2".into(), vec![g2.clone(), x2]);
    })
    .unwrap();
    let e = accept(&d, "a2", &shown.identity, &shown.head).unwrap_err();
    assert!(e.contains("새 카드"), "{e}");
    assert_eq!(e2e_state::load(&d).pins["a2"].state, "changed", "핀은 그대로(안 박힘)");
    let now = person(&d, "a1", "a2").unwrap();
    assert_ne!(now.number, shown.number, "새 카드는 새 번호로");
    // 띄운 번호 그대로면 받아들인다
    assert!(accept(&d, "a2", &now.identity, &now.head).is_ok());
}

#[test]
fn 갈림은_다시_받은_뒤_그_사슬_번호를_견줬을_때만_받아들인다() {
    let (d, _) = world("forked");
    e2e_state::mutate(&d, |s| s.pins.get_mut("a2").unwrap().state = "forked".into()).unwrap();
    let p = person(&d, "a1", "a2").unwrap();
    assert!(!p.refetched);
    assert!(accept(&d, "a2", &p.identity, &p.head).unwrap_err().contains("다시 받기"));
    mark_refetched(&d, "a2").unwrap();
    let p = person(&d, "a1", "a2").unwrap();
    assert!(p.refetched);
    assert!(accept(&d, "a2", &p.identity, &p.head).is_ok());
}

#[test]
fn 멈춘_말은_7일_지나면_지우고_로그아웃하면_다_지운다() {
    let (d, _) = world("held-expiry");
    let now = now_ms();
    hold(&d, Held { room: "r1".into(), cid: "old".into(), body: "오래된 말".into(), human: true, at: now - 8 * 24 * 3600_000, account: "a2".into() }).unwrap();
    hold(&d, Held { room: "r1".into(), cid: "new".into(), body: "새 말".into(), human: true, at: now, account: "a2".into() }).unwrap();
    assert_eq!(held(&d).iter().map(|h| h.cid.as_str()).collect::<Vec<_>>(), vec!["new"]);
    e2e_state::reset_self(&d, Some("a1")).unwrap();
    assert!(e2e_state::load(&d).held.is_empty(), "로그아웃 땐 멈춘 말 평문도 지운다");
}

#[test]
fn 다시_보내기에_실패한_멈춘_말은_목록으로_돌아간다() {
    let (d, _) = world("held-back");
    let h = Held { room: "r1".into(), cid: "c1".into(), body: "x".into(), human: false, at: now_ms(), account: "a2".into() };
    put_back(&d, vec![h.clone()]).unwrap();
    assert_eq!(held(&d), vec![h]);
}

#[test]
fn 저절로_받아들이기는_확인됨을_안_적고_바뀐_때를_적고_멈춘_말을_돌려준다() {
    // 사용자 10-29 — 팀원 보안 번호 바뀜은 묻지 않고 받아들이고 대화에 회색 줄('보안 번호가 바뀌었어요 · 번호 비교')만
    let (d, g2) = world("auto");
    hold(&d, Held { room: "r1".into(), cid: "c1".into(), body: "안녕".into(), human: true, at: now_ms(), account: "a2".into() }).unwrap();
    e2e_state::mutate(&d, |s| {
        s.verified.insert("a2".into(), 1);
    })
    .unwrap();
    changed(&d, &g2);
    let p = person(&d, "a1", "a2").unwrap();
    assert_eq!(p.state, "changed");
    let out = auto_accept(&d, "a2", &p.identity, &p.head).unwrap();
    assert_eq!(out.len(), 1, "멈춘 말을 돌려준다");
    let after = person(&d, "a1", "a2").unwrap();
    assert_eq!(after.state, "ok", "번호를 견준 건 아니라 확인됨이 아니다");
    assert!(after.rekeyed_at > 0);
    // 견주는 사이 또 바뀌면 그때 것만
    assert!(auto_accept(&d, "a2", "다른", &p.head).is_err());
}

#[test]
fn 저절로_받아들인_사람을_번호_비교에서_막아_두면_다시_바뀜으로_보내기가_멈춘다() {
    let (d, g2) = world("autoblock");
    changed(&d, &g2);
    let p = person(&d, "a1", "a2").unwrap();
    auto_accept(&d, "a2", &p.identity, &p.head).unwrap();
    block_rekeyed(&d, "a2").unwrap();
    let after = person(&d, "a1", "a2").unwrap();
    assert_eq!((after.state.as_str(), after.blocked), ("changed", true));
    // 저절로 받아들인 적 없는 사람은 이 길로 못 막는다(멀쩡한 사람을 '바뀜'으로 만들지 않게)
    let (d2, _) = world("autoblock2");
    assert!(block_rekeyed(&d2, "a2").is_err());
}
