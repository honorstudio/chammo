use super::*;
use std::os::unix::fs::PermissionsExt;

fn tmp(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-drafts-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn one(k: &str, v: Option<&str>) -> HashMap<String, Option<String>> {
    HashMap::from([(k.to_string(), v.map(str::to_string))])
}

#[test]
fn 대화마다_쓰고_읽고_비우면_지운다() {
    let d = tmp("rw");
    write(&d, one("team:r1", Some("{\"text\":\"쓰던 글\"}")), 1).unwrap();
    write(&d, one("chat:s1", Some("{\"text\":\"참모에게\"}")), 2).unwrap();
    let all = read(&d);
    assert_eq!(all.get("team:r1").map(String::as_str), Some("{\"text\":\"쓰던 글\"}"));
    assert_eq!(all.len(), 2);
    write(&d, one("team:r1", None), 3).unwrap();
    assert_eq!(read(&d).keys().collect::<Vec<_>>(), vec!["chat:s1"]);
}

#[test]
fn 파일은_600() {
    // 비밀번호·키를 입력칸에 붙였다 지우기 전에 나가도 남는 글이라 나만 읽게
    let d = tmp("perm");
    write(&d, one("team:r1", Some("x")), 1).unwrap();
    assert_eq!(std::fs::metadata(d.join(FILE)).unwrap().permissions().mode() & 0o777, 0o600);
}

#[test]
fn 없거나_깨진_파일은_빈_목록이고_깨진_파일은_덮지_않는다() {
    let d = tmp("bad");
    assert!(read(&d).is_empty());
    std::fs::write(d.join(FILE), "{깨짐").unwrap();
    assert!(read(&d).is_empty());
    assert!(write(&d, one("team:r1", Some("x")), 1).is_err());
    assert_eq!(std::fs::read_to_string(d.join(FILE)).unwrap(), "{깨짐");
}

#[test]
fn 너무_긴_글·이상한_열쇠는_거절하고_오래된_것부터_밀어낸다() {
    let d = tmp("cap");
    assert!(write(&d, one("team:r1", Some(&"가".repeat(MAX_VALUE))), 1).is_err());
    assert!(write(&d, one(&"k".repeat(MAX_KEY + 1), Some("x")), 1).is_err());
    assert!(write(&d, one("", Some("x")), 1).is_err());
    for i in 0..(MAX_KEYS + 5) {
        write(&d, one(&format!("chat:{i}"), Some("x")), i as u64).unwrap();
    }
    let all = read(&d);
    assert_eq!(all.len(), MAX_KEYS);
    assert!(!all.contains_key("chat:0") && all.contains_key(&format!("chat:{}", MAX_KEYS + 4)));
}

#[test]
fn 바꾼_칸만_쓴다_다른_창이_쓴_대화는_그대로() {
    // 메신저 따로 창과 본 창이 각자 메모리를 들고 있어도 서로의 대화를 지우지 않게
    let d = tmp("merge");
    write(&d, one("team:a", Some("창1")), 1).unwrap();
    write(&d, one("team:b", Some("창2")), 2).unwrap();
    let all = read(&d);
    assert_eq!((all["team:a"].as_str(), all["team:b"].as_str()), ("창1", "창2"));
}
