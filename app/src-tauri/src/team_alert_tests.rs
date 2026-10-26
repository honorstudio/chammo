use super::*;

fn rec(note: &str, origin: &str) -> Record {
    Record { room: "r1".into(), seq: 7, person: "하린".into(), origin: origin.into(), body: "표지   사진은\nB컷으로 갈게요".into(), note: note.into(), kind: "team".into(), ..Default::default() }
}

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-team-alert-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn 남이_보낸_새_말은_알리고_소리_이름을_붙인다() {
    let a = decide(&rec("delivered", "human"), &[], &Settings::default()).unwrap();
    assert_eq!(a.title, "하린");
    assert_eq!(a.body, "표지 사진은 B컷으로 갈게요");
    assert_eq!(a.target, "team:r1");
    assert_eq!(a.sound.as_deref(), Some("Glass"));
    assert_eq!(decide(&rec("delivered", "agent"), &[], &Settings::default()).unwrap().title, "하린의 참모");
}

#[test]
fn 그_대화를_앞에_띄웠으면_안_울리고_뒤에_있으면_울린다() {
    let s = Settings::default();
    assert!(decide(&rec("delivered", "human"), &[("r1".into(), true)], &s).is_none());
    assert!(decide(&rec("delivered", "human"), &[("r1".into(), false)], &s).is_some(), "창이 뒤에 있으면 사람은 못 본다");
    assert!(decide(&rec("delivered", "human"), &[("r2".into(), true)], &s).is_some(), "다른 대화를 보는 중");
}

#[test]
fn 내가_보낸_말·막은_말·옛_말·내_기기끼리_방은_안_알린다() {
    let s = Settings::default();
    for n in ["sent", "mine", "forged", "rate-limited", "history", "age-unknown", ""] {
        assert!(decide(&rec(n, "human"), &[], &s).is_none(), "{n}");
    }
    let mut own = rec("delivered", "agent");
    own.kind = "self".into();
    assert!(decide(&own, &[], &s).is_none());
}

#[test]
fn 소리를_끄면_알림만() {
    let s = Settings { sound: false, name: "Pop".into() };
    assert_eq!(decide(&rec("delivered", "human"), &[], &s).unwrap().sound, None);
}

#[test]
fn 소리_설정은_목록_안_이름만_저장하고_모르는_이름은_기본으로_읽는다() {
    let d = dir("set");
    assert_eq!(load(&d), Settings::default());
    save(&d, &Settings { sound: false, name: "Pop".into() }).unwrap();
    assert_eq!(load(&d), Settings { sound: false, name: "Pop".into() });
    assert!(save(&d, &Settings { sound: true, name: "../../x".into() }).is_err());
    std::fs::write(d.join(SETTINGS_FILE), r#"{"sound":true,"name":"../evil"}"#).unwrap();
    assert_eq!(load(&d).name, "Glass");
}

#[test]
fn 미리보기는_한_줄_80자() {
    assert_eq!(preview("a\n\nb"), "a b");
    let long = "가".repeat(100);
    assert_eq!(preview(&long).chars().count(), 80);
}

#[test]
fn 보는_대화는_창마다_하나_빈_글이면_지운다() {
    set_view("team-x", "r5");
    assert!(views().contains(&("team-x".to_string(), "r5".to_string())));
    set_view("team-x", "");
    assert!(!views().iter().any(|(l, _)| l == "team-x"));
}

#[test]
fn 보안_메신저_명령은_메신저_창에서만() {
    // 되돌림 10-23: 창 확인이 없던 넷 — 모드·리더·미리보기 창이 부르지 못하게
    for (file, name) in [(include_str!("team_window.rs"), "fn team_window_close"), (include_str!("team_window.rs"), "fn team_window_state"), (include_str!("team_alert.rs"), "fn team_alert_get"), (include_str!("team_alert.rs"), "fn team_sound_try")] {
        let body = &file[file.find(name).unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        assert!(body.contains("crate::team_ui::ui_window(window.label())"), "{name} 에 창 확인이 없다");
    }
}

#[test]
fn 단톡방_일반_말·반응은_안_울리고_부른_말은_울린다() {
    let set = Settings::default();
    let r = |note: &str| Record { room: "g1".into(), seq: 1, note: note.into(), kind: "team".into(), person: "민아".into(), origin: "human".into(), body: "x".into(), ..Default::default() };
    assert!(decide(&r("room"), &[], &set).is_none());
    assert!(decide(&r("react"), &[], &set).is_none());
    assert!(decide(&r("delivered"), &[], &set).is_some());
}
