use super::*;

/// 맥 temp 는 /var → /private/var 링크라 실제 위치로 잡는다
fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-locker-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::canonicalize(d).unwrap()
}

fn put(p: &Path, body: &str) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

#[test]
fn locker_copy_shape() {
    let data = Path::new("/d");
    assert!(is_locker_copy(Path::new("/d/locker/files/17-견적서.png"), data));
    assert!(!is_locker_copy(Path::new("/d/locker/files/x-견적서.png"), data));
    assert!(!is_locker_copy(Path::new("/d/locker/files/sub/17-a.png"), data));
    assert!(!is_locker_copy(Path::new("/d/locker/files/./17-a.png"), data));
    assert!(!is_locker_copy(Path::new("/d/locker/17-a.png"), data));
}

fn line(v: serde_json::Value) -> String {
    format!("{v}\n")
}

#[test]
fn fold_add_move_rename_hide() {
    let log = [
        line(serde_json::json!({"ts":"2026-10-11T01:00:00Z","op":"add","owner":"참모-2","path":"/h/a.xlsx","by":"me"})),
        line(serde_json::json!({"ts":"2026-10-11T01:01:00Z","op":"add","owner":"참모-2","path":"/h/b.pdf","by":"참모-2","folder":"10월 보고"})),
        line(serde_json::json!({"ts":"2026-10-11T01:02:00Z","op":"folder","owner":"참모-2","name":"10월 보고"})),
        line(serde_json::json!({"ts":"2026-10-11T01:03:00Z","op":"move","owner":"참모-2","path":"/h/a.xlsx","folder":"10월 보고"})),
        line(serde_json::json!({"ts":"2026-10-11T01:04:00Z","op":"rename","owner":"참모-2","path":"/h/a.xlsx","name":"매출 9월"})),
        line(serde_json::json!({"ts":"2026-10-11T01:05:00Z","op":"hide","owner":"참모-2","path":"/h/b.pdf"})),
        "깨진 줄\n".to_string(),
        line(serde_json::json!({"ts":"2026-10-11T01:06:00Z","op":"add","owner":"참모","path":"/h/a.xlsx","by":"me"})),
    ]
    .concat();
    let s = fold(&log);
    assert_eq!(s.items.len(), 2, "숨긴 건 빠지고 참모가 다르면 따로");
    let a = s.items.iter().find(|i| i.owner == "참모-2").unwrap();
    assert_eq!((a.folder.as_deref(), a.name.as_deref(), a.ts.as_str()), (Some("10월 보고"), Some("매출 9월"), "2026-10-11T01:00:00Z"));
    assert!(s.hidden.contains(&("참모-2".to_string(), "/h/b.pdf".to_string())), "show 로 들어온 것도 숨겨야 해서 숨긴 목록을 남긴다");
    assert_eq!(s.folders, vec![("참모-2".to_string(), "10월 보고".to_string())]);
}

#[test]
fn fold_readd_unhides_and_unfolder_returns_items_home() {
    let log = [
        line(serde_json::json!({"ts":"1","op":"add","owner":"o","path":"/h/a.md","by":"me","folder":"f"})),
        line(serde_json::json!({"ts":"2","op":"folder","owner":"o","name":"f"})),
        line(serde_json::json!({"ts":"3","op":"hide","owner":"o","path":"/h/a.md"})),
        line(serde_json::json!({"ts":"4","op":"add","owner":"o","path":"/h/a.md","by":"me"})),
        line(serde_json::json!({"ts":"5","op":"unfolder","owner":"o","name":"f"})),
    ]
    .concat();
    let s = fold(&log);
    assert_eq!(s.items.len(), 1);
    assert_eq!(s.items[0].folder, None, "지운 폴더의 파일은 저절로 자리로");
    assert!(s.hidden.is_empty());
    assert!(s.folders.is_empty());
}

#[test]
fn first_line_of_documents() {
    let d = tmp("peek");
    put(&d.join("a.md"), "---\ntitle: x\n---\n\n# 시설사용 신청서 요약\n본문");
    assert_eq!(peek(&d.join("a.md")).as_deref(), Some("시설사용 신청서 요약"));
    put(&d.join("b.csv"), "\n월,매출,비용\n7월,1,2");
    assert_eq!(peek(&d.join("b.csv")).as_deref(), Some("월 · 매출 · 비용"));
    assert_eq!(peek(&d.join("없음.md")), None);
}

/// 접기 규칙 표(locker_fold.fixture.json) — 옛 기록 옮기기(locker_fs::migrate)가 이 접기로 읽는다
#[test]
fn fold_matches_shared_fixture() {
    let fx: serde_json::Value = serde_json::from_str(include_str!("locker_fold.fixture.json")).unwrap();
    let log: String = fx["log"].as_array().unwrap().iter().map(|l| match l.as_str() { Some(raw) => format!("{raw}\n"), None => format!("{l}\n") }).collect();
    let s = fold(&log);
    let items: Vec<serde_json::Value> = s.items.iter().map(|i| serde_json::json!({"owner": i.owner, "path": i.path, "folder": i.folder, "name": i.name, "ts": i.ts})).collect();
    assert_eq!(serde_json::Value::Array(items), fx["items"]);
    let pair = |v: &[(String, String)]| serde_json::Value::Array(v.iter().map(|(a, b)| serde_json::json!([a, b])).collect());
    assert_eq!(pair(&s.hidden), fx["hidden"]);
    assert_eq!(pair(&s.folders), fx["folders"]);
}
