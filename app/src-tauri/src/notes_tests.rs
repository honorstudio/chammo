use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

fn tmp() -> PathBuf {
    static N: AtomicU32 = AtomicU32::new(0);
    let d = std::env::temp_dir().join(format!("chammo-notes-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}
const NOW: u64 = 1_800_000_000_000;
const DAY: u64 = 24 * 3600 * 1000;

#[test]
fn 이름은_폴더를_못_넘고_md_만() {
    for bad in ["../x.md", "a/b.md", "a\\b.md", ".hidden.md", "x.txt", ".md", "a..b.md", "x\0.md"] {
        assert!(!name_ok(bad), "{bad}");
    }
    assert!(name_ok("note-1.md"));
    assert!(name_ok("장 볼 것.md"));
    assert!(!name_ok(&format!("{}.md", "a".repeat(200))));
}

#[test]
fn 제목은_첫_줄_미리보기는_둘째_줄() {
    assert_eq!(title_preview("# 장 볼 것 내용\n\n우유랑 달걀\n빵은 내일\n"), ("장 볼 것 내용".into(), "우유랑 달걀".into()));
    assert_eq!(title_preview("\n- 달걀\n* 대파\n"), ("달걀".into(), "대파".into()));
    assert_eq!(title_preview(""), (String::new(), String::new()));
    assert_eq!(title_preview(&"가".repeat(200)).0.chars().count(), 80);
}

#[test]
fn 폴더가_없으면_빈_목록이고_새_메모가_폴더를_만든다() {
    let d = tmp().join("notes");
    assert_eq!(list_in(&d, NOW).unwrap(), vec![]);
    let r = create_in(&d, NOW).unwrap();
    assert_eq!(r.name, format!("note-{NOW}.md"));
    assert!(Path::new(&r.path).is_file());
    assert_eq!(r.title, "");
}

#[test]
fn 맨_위가_빈_메모면_새로_안_만든다() {
    let d = tmp();
    let a = create_in(&d, NOW).unwrap();
    assert_eq!(create_in(&d, NOW + 1).unwrap().name, a.name);
    assert_eq!(list_in(&d, NOW).unwrap().len(), 1);
    write_in(&d, &a.name, "장 볼 것\n", None, |_| {}).unwrap();
    assert_ne!(create_in(&d, NOW + 2).unwrap().name, a.name);
    assert_eq!(list_in(&d, NOW).unwrap().len(), 2);
}

#[test]
fn 목록은_최근_것부터_휴지통과_다른_파일은_뺀다() {
    let d = tmp();
    std::fs::write(d.join("note-1.md"), "첫째\n").unwrap();
    std::fs::write(d.join("note-2.md"), "둘째\n").unwrap();
    std::fs::write(d.join("그림.png"), "x").unwrap();
    std::fs::write(d.join(".note-1.md.chammo-tmp"), "x").unwrap();
    std::fs::create_dir_all(d.join("assets.md")).unwrap();
    trash_in(&d, "note-1.md", NOW).unwrap();
    let rows = list_in(&d, NOW).unwrap();
    assert_eq!(rows.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["note-2.md"]);
    std::fs::write(d.join("note-3.md"), "셋째\n").unwrap();
    let f = std::fs::File::options().write(true).open(d.join("note-2.md")).unwrap();
    f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(100)).unwrap();
    assert_eq!(list_in(&d, NOW).unwrap()[0].name, "note-3.md");
}

#[test]
fn 저장은_알던_글이_다르면_안_덮는다() {
    let d = tmp();
    let n = create_in(&d, NOW).unwrap().name;
    write_in(&d, &n, "맥 글\n", Some(""), |_| {}).unwrap();
    assert_eq!(write_in(&d, &n, "폰 글\n", Some(""), |_| {}).unwrap_err(), crate::reader::CHANGED_OUTSIDE);
    assert_eq!(read_in(&d, &n).unwrap(), "맥 글\n");
    let r = write_in(&d, &n, "폰 글\n", Some("맥 글\n"), |_| {}).unwrap();
    assert_eq!(r.title, "폰 글");
    assert_eq!(read_in(&d, &n).unwrap(), "폰 글\n");
}

#[test]
fn 저장_전_판을_남기는_고리를_부른다() {
    let d = tmp();
    let n = create_in(&d, NOW).unwrap().name;
    let hit = std::cell::Cell::new(0);
    write_in(&d, &n, "글\n", None, |_| hit.set(hit.get() + 1)).unwrap();
    assert_eq!(hit.get(), 1);
}

#[test]
fn 없는_파일을_안_만들고_너무_긴_글을_안_받는다() {
    let d = tmp();
    assert!(write_in(&d, "note-9.md", "x", None, |_| {}).is_err());
    assert!(!d.join("note-9.md").exists());
    let n = create_in(&d, NOW).unwrap().name;
    assert!(write_in(&d, &n, &"x".repeat(crate::locker_fs::MAX_PHONE_MD), None, |_| {}).is_err());
}

#[cfg(unix)]
#[test]
fn 링크를_따라가_notes_밖을_읽거나_쓰지_않는다() {
    let d = tmp();
    let out = tmp().join("남.md");
    std::fs::write(&out, "비밀\n").unwrap();
    std::os::unix::fs::symlink(&out, d.join("링크.md")).unwrap();
    assert!(read_in(&d, "링크.md").is_err());
    assert!(write_in(&d, "링크.md", "덮음", None, |_| {}).is_err());
    assert!(trash_in(&d, "링크.md", NOW).is_err());
    assert_eq!(std::fs::read_to_string(&out).unwrap(), "비밀\n");
    assert!(list_in(&d, NOW).unwrap().is_empty());
}

#[test]
fn 휴지통은_옮긴_날부터_30일_뒤_정리한다() {
    let d = tmp();
    let old = d.join("note-old.md");
    std::fs::write(&old, "오래된 메모\n").unwrap();
    // 고친 지 오래된 메모도 옮기자마자 지워지면 안 된다
    std::fs::File::options().write(true).open(&old).unwrap().set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(100)).unwrap();
    trash_in(&d, "note-old.md", NOW).unwrap();
    let f = d.join(TRASH).join(format!("{NOW}--note-old.md"));
    list_in(&d, NOW + DAY).unwrap();
    assert!(f.is_file(), "옮긴 지 하루");
    list_in(&d, NOW + 30 * DAY).unwrap();
    assert!(f.is_file(), "딱 30일은 남긴다");
    std::fs::write(d.join(TRASH).join("사람이 넣은 파일.md"), "x").unwrap();
    list_in(&d, NOW + 31 * DAY).unwrap();
    assert!(!f.exists(), "31일이면 정리");
    assert!(d.join(TRASH).join("사람이 넣은 파일.md").is_file(), "시각 없는 이름은 그대로");
}

#[test]
fn 메모를_고친_기록을_알아본다() {
    let d = tmp();
    let n = create_in(&d, NOW).unwrap();
    let line = |p: &str| serde_json::json!({ "ts": "t", "who": "user", "kind": "edit", "path": p }).to_string();
    assert!(is_note_log(&line(&n.path), &d));
    assert!(!is_note_log(&line("/somewhere/else/note.md"), &d));
    assert!(!is_note_log(&format!("{{\"path\":\"{}x/note.md\"}}", d.display()), &d), "이름만 비슷한 폴더");
    assert!(!is_note_log("글자", &d));
}

// ── 스킨·띄움·따로 창(시안 memo-panel v2, 11-05 사용자) — notes/.meta.json

#[test]
fn 메타가_없으면_최근_메모_하나만_띄우고_스킨은_메모지() {
    let d = tmp();
    std::fs::write(d.join("note-1.md"), "첫째\n").unwrap();
    std::fs::write(d.join("note-2.md"), "둘째\n").unwrap();
    std::fs::File::options().write(true).open(d.join("note-1.md")).unwrap().set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(100)).unwrap();
    let rows = list_in(&d, NOW).unwrap();
    assert_eq!(rows.iter().map(|r| (r.name.as_str(), r.shown, r.skin.as_str(), r.win)).collect::<Vec<_>>(), [("note-2.md", true, "paper", false), ("note-1.md", false, "paper", false)]);
    assert!(!d.join(META).exists(), "목록 읽기만으로 파일을 안 만든다");
}

#[test]
fn 스킨_띄움_창을_메모마다_기억한다() {
    let d = tmp();
    let a = create_in(&d, NOW).unwrap();
    write_in(&d, &a.name, "가\n", None, |_| {}).unwrap();
    let b = create_in(&d, NOW + 1).unwrap();
    let r = meta_in(&d, &a.name, &MetaPatch { skin: Some("term".into()), ..Default::default() }).unwrap();
    assert_eq!((r.skin.as_str(), r.shown), ("term", true));
    meta_in(&d, &b.name, &MetaPatch { shown: Some(false), ..Default::default() }).unwrap();
    meta_in(&d, &a.name, &MetaPatch { win: Some(true), frame: Some([10.0, 20.0, 380.0, 400.0]), ..Default::default() }).unwrap();
    let rows = list_in(&d, NOW).unwrap();
    let ra = rows.iter().find(|r| r.name == a.name).unwrap();
    let rb = rows.iter().find(|r| r.name == b.name).unwrap();
    assert_eq!((ra.skin.as_str(), ra.shown, ra.win), ("term", true, true));
    assert!(!rb.shown);
    assert_eq!(frame_in(&d, &a.name), Some([10.0, 20.0, 380.0, 400.0]));
    assert_eq!(frame_in(&d, &b.name), None);
}

#[test]
fn 새_메모는_띄우고_마지막에_고른_스킨을_따른다() {
    let d = tmp();
    let a = create_in(&d, NOW).unwrap();
    assert_eq!((a.skin.as_str(), a.shown), ("paper", true));
    write_in(&d, &a.name, "가\n", None, |_| {}).unwrap();
    meta_in(&d, &a.name, &MetaPatch { skin: Some("lined".into()), ..Default::default() }).unwrap();
    let b = create_in(&d, NOW + 1).unwrap();
    assert_eq!((b.skin.as_str(), b.shown, b.win), ("lined", true, false));
    // 메타 파일이 생긴 뒤에도 a 는 계속 띄운 채
    assert!(list_in(&d, NOW).unwrap().iter().all(|r| r.shown));
}

#[test]
fn 모르는_스킨_없는_메모_이상한_이름은_안_받는다() {
    let d = tmp();
    let a = create_in(&d, NOW).unwrap();
    assert!(meta_in(&d, &a.name, &MetaPatch { skin: Some("neon".into()), ..Default::default() }).is_err());
    assert!(meta_in(&d, "note-9.md", &MetaPatch { shown: Some(true), ..Default::default() }).is_err());
    assert!(meta_in(&d, "../x.md", &MetaPatch { shown: Some(true), ..Default::default() }).is_err());
    assert!(meta_in(&d, &a.name, &MetaPatch { frame: Some([f64::NAN, 0.0, 300.0, 300.0]), ..Default::default() }).is_err());
}

#[test]
fn 망가진_메타_파일이면_처음처럼_읽는다() {
    let d = tmp();
    let a = create_in(&d, NOW).unwrap();
    std::fs::write(d.join(META), "{깨짐").unwrap();
    let rows = list_in(&d, NOW).unwrap();
    assert_eq!((rows[0].name.as_str(), rows[0].shown, rows[0].skin.as_str()), (a.name.as_str(), true, "paper"));
}
