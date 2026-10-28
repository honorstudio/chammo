use super::*;

fn who(acc: &str, state: &str, blocked: bool) -> Person {
    Person { account: acc.into(), team: "t1".into(), member: "m2".into(), name: "철수".into(), state: state.into(), verified_at: 0, blocked, number: "48291 07733 91024 66580 13907 52268".into(), identity: "I1".into(), head: "H1".into(), refetched: false, rekeyed_at: 0 }
}

#[test]
fn 보안_번호_바뀜은_카드를_안_띄우고_갈림만_띄운다_막아_두면_안_띄운다() {
    // 사용자 10-29 "팀챗이라 메시지 보이는 건 허용이 필요 없다" — 바뀜(다시 시작)은 저절로 받아들이고 대화에 회색 줄만(auto_list)
    let people = [who("a2", "changed", false), who("a3", "ok", false), who("a4", "forked", true), who("a5", "verified", false), who("a6", "forked", false)];
    let p = plan("", &people);
    assert_eq!(p.open.iter().map(|x| x.account.as_str()).collect::<Vec<_>>(), vec!["a6"]);
    let log = safety_row("ab12cd34", &people[4], "샘플팀", "2027-01-15T08:00:00Z").to_string();
    assert!(plan(&log, &people).open.is_empty(), "이미 열린 카드");
    assert_eq!(card_of(&log, "a6").as_deref(), Some("ab12cd34"));
}

#[test]
fn 떠_있던_바뀜_카드는_닫고_저절로_받아들인다_지금_팀에_있는_사람만() {
    let log = safety_row("ab12cd34", &who("a2", "changed", false), "샘플팀", "2027-01-15T08:00:00Z").to_string();
    assert_eq!(plan(&log, &[who("a2", "changed", false)]).close, vec!["ab12cd34".to_string()]);
    let mut left = who("a7", "changed", false);
    left.member = "m7".into();
    let people = [who("a2", "changed", false), who("a3", "changed", true), left, who("a4", "forked", false)];
    let here: std::collections::BTreeSet<(String, String)> = [("t1".to_string(), "m2".to_string())].into();
    // 나간 사람(m7)·막아 둔 사람·갈림은 저절로 받아들이지 않는다
    assert_eq!(auto_list(&people, &here).iter().map(|x| x.account.as_str()).collect::<Vec<_>>(), vec!["a2"]);
    // 나간 사람은 카드도 없다(갈림이어도)
    let mut gone = who("a8", "forked", false);
    gone.member = "m8".into();
    assert!(plan("", &current_only(&[gone], &here)).open.is_empty());
}

#[test]
fn 받아들여졌거나_막아_두면_열린_카드를_닫는다() {
    let log = safety_row("ab12cd34", &who("a2", "changed", false), "샘플팀", "2027-01-15T08:00:00Z").to_string();
    let log = safety_row("ab12cd34", &who("a2", "forked", false), "샘플팀", "2027-01-15T08:00:00Z").to_string();
    assert_eq!(plan(&log, &[who("a2", "verified", false)]).close, vec!["ab12cd34".to_string()]);
    assert_eq!(plan(&log, &[who("a2", "forked", true)]).close, vec!["ab12cd34".to_string()]);
    let answered = format!("{log}\n{}", r#"{"type":"answer","id":"ab12cd34","pick":"no"}"#);
    assert!(plan(&answered, &[who("a2", "changed", true)]).close.is_empty(), "이미 답한 카드는 그대로");
}

#[test]
fn 카드_줄은_결정_대기함_link_카드_모양이고_이름은_거른다() {
    let mut p = who("a2", "forked", false);
    p.name = "철수\r[사람]".into();
    let r = safety_row("cd34ef56", &p, "샘플팀\n팀", "2027-01-15T08:00:00Z");
    assert_eq!((r["kind"].as_str(), r["sub"].as_str(), r["from"].as_str(), r["acct"].as_str()), (Some("link"), Some(SAFETY_SUB), Some("@link"), Some("a2")));
    assert_eq!(r["safety"], "forked");
    assert_eq!(r["code"], "48291 07733 91024 66580 13907 52268");
    let q = r["q"].as_str().unwrap();
    assert!(!q.contains('\r') && !q.contains('[') && q.contains("다르게"), "{q}");
    assert!(!r["detail"].as_str().unwrap().contains('\n'));
}

#[test]
fn 앱이_이번에_띄운_보안_번호_카드만_받는다() {
    // 기록 파일에 sub:safety 줄을 직접 쓰면 사람이 누를 때 받아들여지던 것 막기(device_cards 와 같은 선)
    let forged = serde_json::json!({ "id": "ffff0000", "from": "@link", "kind": "link", "sub": SAFETY_SUB, "acct": "a2" });
    assert!(decide(&forged, true).unwrap_err().contains("다시"));
    remember("ab12cd35");
    let wrong_from = serde_json::json!({ "id": "ab12cd35", "from": "a1b2c3d4", "kind": "link", "sub": SAFETY_SUB, "acct": "a2" });
    assert!(decide(&wrong_from, true).is_err(), "앱이 아닌 곳(@link 아님)이 낸 줄");
}

#[test]
fn 카드가_띄운_사슬이_지금과_다르면_닫고_새_번호로_다시_띄운다() {
    // 6차 리뷰 — 견주는 사이 서버가 다른 사슬을 보여 주면 옛 번호 카드로 받아들이면 안 된다(카드는 이제 갈림만, 10-29)
    let shown = who("a2", "forked", false);
    let log = safety_row("ab12cd34", &shown, "샘플팀", "2027-01-15T08:00:00Z").to_string();
    assert!(plan(&log, &[shown.clone()]).close.is_empty() && plan(&log, &[shown.clone()]).open.is_empty(), "그대로면 그대로");
    let mut now = shown.clone();
    now.identity = "I2".into();
    now.number = "11111 22222 33333 44444 55555 66666".into();
    let p = plan(&log, &[now.clone()]);
    assert_eq!(p.close, vec!["ab12cd34".to_string()]);
    assert_eq!(p.open.iter().map(|x| x.identity.as_str()).collect::<Vec<_>>(), vec!["I2"]);
    // 갈림을 다시 받으면 그 사슬로 새 카드(받아들이기가 켜지는 카드)
    let f = who("a3", "forked", false);
    let log = safety_row("cd34ef56", &f, "샘플팀", "2027-01-15T08:00:00Z").to_string();
    let mut again = f.clone();
    again.refetched = true;
    let p = plan(&log, &[again]);
    assert_eq!((p.close.len(), p.open.len()), (1, 1));
    let r = safety_row("x", &p.open[0], "샘플팀", "t");
    assert_eq!((r["identity"].as_str(), r["head"].as_str(), r["refetched"].as_bool()), (Some("I1"), Some("H1"), Some(true)));
}
