use super::*;

fn t(name: &str) -> String {
    format!("{name}-{}", std::process::id())
}

#[test]
fn 받는_중_진행과_다_받음이_목록에_보인다() {
    let team = t("down-ok");
    let p = std::env::temp_dir().join(format!("{team}.zip"));
    std::fs::write(&p, b"12345").unwrap();
    let r = track(&team, "f1", "save", |tick| {
        tick(0, 5)?;
        tick(3, 5)?;
        let l = list(&team);
        assert_eq!((l[0].state.as_str(), l[0].done, l[0].total), ("going", 3, 5));
        tick(5, 5)?;
        Ok(p.clone())
    });
    assert_eq!(r.unwrap(), p);
    let l = list(&team);
    assert_eq!(l.len(), 1);
    assert_eq!((l[0].state.as_str(), l[0].done, l[0].total, l[0].path.as_str()), ("done", 5, 5, p.to_str().unwrap()));
    dismiss(&team, "f1");
    assert!(list(&team).is_empty());
}

#[test]
fn 이미_받아_둔_파일은_진행_없이_끝나도_크기를_채운다() {
    let team = t("down-cached");
    let p = std::env::temp_dir().join(format!("{team}.bin"));
    std::fs::write(&p, vec![0u8; 42]).unwrap();
    track(&team, "f1", "save", |_| Ok(p.clone())).unwrap();
    let d = &list(&team)[0];
    assert_eq!((d.done, d.total), (42, 42));
}

#[test]
fn 멈추기를_누르면_다음_조각에서_멈추고_이유는_stopped() {
    let team = t("down-stop");
    let r = track(&team, "f1", "save", |tick| {
        tick(0, 100)?;
        assert!(stop(&team, "f1"));
        tick(10, 100)?;
        unreachable!("멈춘 뒤엔 안 온다");
    });
    assert!(r.is_err());
    let d = &list(&team)[0];
    assert_eq!((d.state.as_str(), d.why.as_str()), ("failed", "stopped"));
    assert!(!stop(&team, "nope"), "없는 받기는 못 멈춘다");
}

#[test]
fn 여는_받기는_다_받으면_목록에서_빠지고_실패만_남는다() {
    let team = t("down-open");
    track(&team, "f1", "open", |_| Ok(std::env::temp_dir())).unwrap();
    assert!(list(&team).is_empty(), "연 것은 스페이스·기본 앱이 보여 준다");
    let _ = track(&team, "f2", "open", |_| Err("중계 서버에 못 닿았어요: timeout".to_string()));
    let l = list(&team);
    assert_eq!((l.len(), l[0].why.as_str(), l[0].mode.as_str()), (1, "net", "open"));
}

#[test]
fn 같은_파일을_받는_중에_또_누르면_두_번_안_받는다() {
    let team = t("down-twice");
    let r = track(&team, "f1", "save", |_| {
        let again = track(&team, "f1", "save", |_| unreachable!("겹쳐 받지 않는다"));
        assert!(again.is_err());
        Ok(std::env::temp_dir())
    });
    assert!(r.is_ok());
}

#[test]
fn 실패_이유를_종류로_가른다() {
    assert_eq!(why_kind("중계 서버에 못 닿았어요: Could not resolve host", false), "net");
    assert_eq!(why_kind("중계 서버 답을 못 읽었어요: timed out", false), "net");
    assert_eq!(why_kind("No space left on device (os error 28)", false), "disk");
    assert_eq!(why_kind("디스크 공간이 부족합니다. (os error 112)", false), "disk");
    assert_eq!(why_kind("그 파일이 없어(지워졌거나 볼 수 없는 방)", false), "gone");
    assert_eq!(why_kind("아무 오류", true), "stopped");
    assert_eq!(why_kind("1번째 조각이 안 열려", false), "other");
}

#[test]
fn 열기_폴더에서_보기는_다_받은_저장_줄의_경로만() {
    let team = t("down-saved");
    let p = std::env::temp_dir().join(format!("{team}.txt"));
    std::fs::write(&p, b"x").unwrap();
    assert_eq!(saved(&team, "f1"), None);
    let _ = track(&team, "f1", "save", |tick| {
        tick(0, 1)?;
        assert_eq!(saved(&team, "f1"), None, "받는 중엔 아직 없다");
        Ok(p.clone())
    });
    assert_eq!(saved(&team, "f1"), Some(p.clone()));
    std::fs::remove_file(&p).unwrap();
    assert_eq!(saved(&team, "f1"), None, "그새 지워진 파일은 안 연다");
}

#[test]
fn 빈_팀이면_모든_팀_줄() {
    let team = t("down-all");
    let _ = track(&team, "f1", "save", |_| Err("x".into()));
    assert!(list("").iter().any(|d| d.team == team));
}
