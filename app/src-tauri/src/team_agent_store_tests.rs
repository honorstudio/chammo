use super::*;
use crate::team_agent::{Def, Shown};
use std::os::unix::fs::PermissionsExt;

fn tmp(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-agents-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}
fn shown(id: &str, name: &str, ver: &str) -> Shown {
    Shown { id: id.into(), ver: ver.into(), def: Def { t: "agent".into(), name: name.into(), ..Default::default() }, ..Default::default() }
}

#[test]
fn 받은_목록은_팀마다_캐시로_남고_600() {
    let d = tmp("cache");
    assert!(cached(&d, "t1").is_empty());
    save_cache(&d, "t1", &[shown("aaaaaaaaaaaaaaaa1", "회의록", "v1")]);
    assert_eq!(cached(&d, "t1")[0].def.name, "회의록");
    assert!(cached(&d, "t2").is_empty());
    let f = d.join(CACHE_DIR).join("t1.json");
    assert_eq!(std::fs::metadata(f).unwrap().permissions().mode() & 0o777, 0o600);
    save_cache(&d, "../x", &[]);
    assert!(!d.join("x.json").exists(), "팀 id 로 폴더 밖에 못 쓴다");
}

#[test]
fn 확인한_판은_정의째_남는다() {
    let d = tmp("seen");
    let a = shown("aaaaaaaaaaaaaaaa1", "회의록", "v1");
    assert!(seen(&d).is_empty());
    confirm(&d, &a).unwrap();
    let s = seen(&d);
    assert_eq!(s["aaaaaaaaaaaaaaaa1"].ver, "v1");
    assert_eq!(s["aaaaaaaaaaaaaaaa1"].def.name, "회의록", "다음에 바뀐 것을 보여 주려고 정의째");
    assert_eq!(std::fs::metadata(d.join(SEEN_FILE)).unwrap().permissions().mode() & 0o777, 0o600);
}

#[test]
fn 토큰은_방마다_seq_로() {
    let d = tmp("usage");
    usage_add(&d, "r1", 7, "sonnet", 6200);
    usage_add(&d, "r2", 3, "haiku", 900);
    let u = usage(&d, "r1");
    assert_eq!(u.len(), 1);
    assert_eq!(u[&7], ("sonnet".to_string(), 6200));
}

#[test]
fn 부를_대상_참모_멘션이_먼저_겹친_이름은_안_부른다() {
    let mut clash = shown("bbbbbbbbbbbbbbbb1", "번역", "v");
    clash.clash = true;
    let list = vec![shown("aaaaaaaaaaaaaaaa1", "회의록", "v"), clash];
    match resolve("@회의록 정리", &list) {
        Some(Target::Agent(a, ask)) => {
            assert_eq!(a.id, "aaaaaaaaaaaaaaaa1");
            assert_eq!(ask, "정리");
        }
        _ => panic!("참모"),
    }
    assert!(matches!(resolve("@팀참모 요약", &list), Some(Target::Base(_))));
    assert!(resolve("@번역 hi", &list).is_none(), "이름 겹침 참모는 멘션을 못 받는다");
    assert!(resolve("그냥 말", &list).is_none());
}
