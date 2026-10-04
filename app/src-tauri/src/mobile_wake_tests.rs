use super::*;

const HQ: &str = "/Users/me/hq";
const ALL: &str = r#"[
  {"id":"aaaa0001","sessionId":"11111111-1111-4111-8111-111111111111","cwd":"/Users/me/hq","name":"참모-1 · 개발","state":"working"},
  {"id":"aaaa0002","sessionId":"22222222-2222-4222-8222-222222222222","cwd":"/Users/me/hq/","name":"참모-3 · 나스","state":"stopped","startedAt":5},
  {"id":"aaaa0003","sessionId":"33333333-3333-4333-8333-333333333333","cwd":"/Users/me/dev/shop","name":"shop","state":"stopped"},
  {"id":"aaaa0004","sessionId":"44444444-4444-4444-8444-444444444444","cwd":"/Users/me/hq","name":"sns-post","state":"done"},
  {"id":"aaaa0005","cwd":"/Users/me/hq","name":"참모-4","state":"failed"}
]"#;
const LIVE: &str = r#"[{"id":"aaaa0001","sessionId":"11111111-1111-4111-8111-111111111111","cwd":"/Users/me/hq","name":"참모-1 · 개발","state":"working"}]"#;

#[test]
fn 꺼진_참모는_hq_폴더의_꺼진_세션만() {
    let got = hq_stopped(ALL, LIVE, HQ);
    // 프로젝트 세션(shop)은 빼고, sessionId 없는 것도 뺀다. 이름이 참모 같지 않은 도우미(sns-post)는 화면이 거른다
    assert_eq!(got.iter().map(|v| v["id"].as_str().unwrap()).collect::<Vec<_>>(), vec!["aaaa0002", "aaaa0004"]);
}

#[test]
fn 살아_있는_대화는_꺼진_목록에서_뺀다() {
    let live = r#"[{"id":"bbbb0009","sessionId":"22222222-2222-4222-8222-222222222222","cwd":"/Users/me/hq","name":"참모-3 · 나스","state":"working"}]"#;
    assert!(hq_stopped(ALL, live, HQ).iter().all(|v| v["id"] != "aaaa0002"));
}

#[test]
fn 새_이름은_살아_있는_꺼진_번호_다음() {
    let names = hq_names(ALL, HQ);
    assert_eq!(next_name("참모", &names), "참모-5");
    assert_eq!(next_name("참모", &[]), "참모");
    assert_eq!(next_name("참모", &["참모".into()]), "참모-2");
    // 다른 비서 이름 번호는 안 센다
    assert_eq!(next_name("도우미", &names), "도우미");
}

#[test]
fn 별명_다듬기() {
    assert_eq!(clean_nick("  디자인   담당 ").as_deref(), Some("디자인 담당"));
    assert_eq!(clean_nick("가".repeat(30).as_str()).map(|n| n.chars().count()), Some(24));
    assert_eq!(clean_nick("   "), None);
    assert_eq!(clean_nick("a · b"), None, "· 는 이름 나눔표");
    assert_eq!(clean_nick("a\u{1b}[2J"), None, "제어 문자");
}

#[test]
fn 별명_겹침은_대소문자_무시() {
    let names = vec!["참모-1 · 개발".to_string(), "참모-3 · Nas".into()];
    assert!(nick_taken(&names, "nas"));
    assert!(nick_taken(&names, "개발"));
    assert!(!nick_taken(&names, "디자인"));
}
