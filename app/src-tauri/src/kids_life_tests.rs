//! 키즈 참모 생애 시험 — 지우면 칸·집이 비켜지고, 같은 이름 새 참모엔 옛 설정이 안 붙는다
use super::*;
use crate::kids::{self, KidsOrch};
use std::path::PathBuf;

fn tmpdir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-kidslife-{tag}-{}-{}", std::process::id(), crate::mobile_pair::random_hex(4).unwrap()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn kid(data: &Path, key: &str) -> PathBuf {
    kids::set_in(data, key, Some(KidsOrch { child: "서아".into(), age: 5, since: 1 })).unwrap();
    let k = kids::ensure_home(data, key).unwrap();
    std::fs::write(k.join("works").join("공룡.html"), "<p>공룡</p>").unwrap();
    kids::log_line(&k, 1, "kid", "공룡", None).unwrap();
    k
}

#[test]
fn retire_drops_entry_and_moves_home_keeping_works() {
    let d = tmpdir("retire");
    kid(&d, "참모-5");
    kid(&d, "참모-2");
    let to = retire_in(&d, "참모-5", 77).unwrap().expect("비킨 자리");
    assert_eq!(to, d.join("kids/_archive/참모-5-77"));
    assert!(to.join("works/공룡.html").exists(), "작품은 남는다");
    assert!(to.join("log").is_dir(), "기록은 남는다");
    assert!(!d.join("kids/참모-5").exists());
    let r = kids::read_in(&d);
    assert!(!r.orchs.contains_key("참모-5"));
    assert!(r.orchs.contains_key("참모-2"), "다른 참모는 그대로");
    // 같은 이름으로 새로 만들면 옛 설정·작품이 안 붙는다
    assert!(!kids::is_kids(&d, true, "참모-5"));
    let k = kids::ensure_home(&d, "참모-5").unwrap();
    assert!(std::fs::read_dir(k.join("works")).unwrap().next().is_none(), "새 집은 빈 works");
    // 다시 비켜도 덮지 않는다
    kid(&d, "참모-5");
    assert_eq!(retire_in(&d, "참모-5", 77).unwrap().unwrap(), d.join("kids/_archive/참모-5-77-2"));
    // 없는 참모는 아무것도 안 한다
    assert_eq!(retire_in(&d, "없음", 1).unwrap(), None);
}

#[test]
fn reborn_orch_drops_old_kids_setting() {
    let d = tmpdir("reborn");
    kid(&d, "참모-5");
    crate::orch_roles::start_role(&d, "참모-5 · 선생님", "", 99).unwrap();
    assert!(!kids::is_kids(&d, true, "참모-5"), "새로 태어난 참모-5 는 키즈가 아니다");
    assert!(d.join("kids/_archive/참모-5-99/works/공룡.html").exists());
}

#[test]
fn intro_and_notice_tell_the_guardian_face() {
    let i = intro("서아");
    assert!(i.starts_with("[앱] ") && i.contains("보호자") && i.ends_with("아이 이름: 서아"), "{i}");
    assert!(!intro("").contains("아이 이름"));
    assert!(notice(true, "서아").contains("키즈 참모야") && notice(true, "서아").contains("서아"));
    assert!(notice(false, "").contains("일반 참모"));
}

#[test]
fn finds_orch_and_removed_key_only_in_hq() {
    let j = r#"[
      {"id":"aaaa1111","name":"참모-5 · 선생님","cwd":"/u/hq","state":"working"},
      {"id":"bbbb2222","name":"참모-5 · 아이","cwd":"/u/data/kids/참모-5","state":"working"},
      {"id":"cccc3333","name":"참모-2","cwd":"/u/hq","state":"stopped"},
      {"id":"dddd4444","name":"shop","cwd":"/u/dev/shop","state":"working"}
    ]"#;
    assert_eq!(orch_id_in(j, "/u/hq", "참모-5").as_deref(), Some("aaaa1111"));
    assert_eq!(orch_id_in(j, "/u/hq", "참모-2"), None, "꺼진 참모엔 안 보낸다");
    assert_eq!(hq_key_of(j, "/u/hq", "aaaa1111").as_deref(), Some("참모-5"));
    assert_eq!(hq_key_of(j, "/u/hq", "cccc3333").as_deref(), Some("참모-2"), "꺼진 참모를 지워도 비킨다");
    assert_eq!(hq_key_of(j, "/u/hq", "bbbb2222"), None, "아이 세션을 지워도 키즈 칸은 그대로");
    assert_eq!(hq_key_of(j, "/u/hq", "dddd4444"), None);
}
