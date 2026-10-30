use super::*;
use std::path::{Path, PathBuf};

/// 가짜 홈 — 데이터 폴더(.chammo)·프로젝트 하나. 맥 temp 는 /var → /private/var 링크라 실제 위치로
fn home(name: &str) -> (PathBuf, Rules) {
    let d = std::env::temp_dir().join(format!("chammo-shown-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(d.join(".chammo")).unwrap();
    std::fs::create_dir_all(d.join("Desktop/dev/shop/assets")).unwrap();
    let d = std::fs::canonicalize(d).unwrap();
    let rules = Rules { data_dir: d.join(".chammo"), hq_dir: String::new(), home: d.clone() };
    (d, rules)
}

fn put(p: &Path) -> String {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, b"x").unwrap();
    p.to_string_lossy().into_owned()
}

fn log(paths: &[&str]) -> String {
    paths.iter().map(|p| format!("{}\n", serde_json::json!({ "path": p, "ts": "2026-10-30T14:00:00", "by": "디자인" }))).collect()
}

#[test]
fn 보여_준_파일은_된다() {
    let (h, r) = home("ok");
    let p = put(&h.join("Desktop/dev/shop/assets/poster.png"));
    assert!(shown_ok(&p, &log(&[&p]), &[], &r));
}

#[test]
fn 폰이_못_여는_형식도_보여_줬으면_된다() {
    let (h, r) = home("ext");
    let ai = put(&h.join("Desktop/dev/shop/assets/poster.ai"));
    let zip = put(&h.join("Desktop/dev/shop/assets/print.zip"));
    assert!(shown_ok(&ai, &log(&[&ai, &zip]), &[], &r));
    assert!(shown_ok(&zip, &log(&[&ai, &zip]), &[], &r));
}

#[test]
fn 안_보여_준_파일은_안_된다() {
    let (h, r) = home("unlisted");
    let shown = put(&h.join("Desktop/dev/shop/assets/a.png"));
    let other = put(&h.join("Desktop/dev/shop/assets/b.png"));
    assert!(!shown_ok(&other, &log(&[&shown]), &[], &r));
}

#[test]
fn 보관함_목록에_있으면_된다() {
    let (h, r) = home("locker");
    let p = put(&h.join("Documents/Chammo/디자인/견적.pdf"));
    assert!(shown_ok(&p, "", std::slice::from_ref(&p), &r));
}

#[test]
fn 보여_줬어도_비밀_이름·점_폴더·데이터_폴더·상대_경로는_안_된다() {
    let (h, r) = home("deny");
    let secret = put(&h.join("Desktop/dev/shop/api-key.png"));
    let dot = put(&h.join(".ssh/id.png"));
    let data = put(&h.join(".chammo/attach/1-a.png"));
    let all = log(&[&secret, &dot, &data, "Desktop/dev/shop/assets/a.png"]);
    for p in [&secret, &dot, &data] {
        assert!(!shown_ok(p, &all, &[], &r), "{p}");
    }
    assert!(!shown_ok("Desktop/dev/shop/assets/a.png", &all, &[], &r));
}

#[cfg(unix)]
#[test]
fn 링크_경로는_보여_줬어도_안_된다() {
    let (h, r) = home("link");
    let real = put(&h.join("Desktop/dev/shop/real.png"));
    let link = h.join("Desktop/dev/shop/link.png");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let link = link.to_string_lossy().into_owned();
    assert!(!shown_ok(&link, &log(&[&link]), &[], &r));
}

#[test]
fn 끌_묶음은_1에서_50개_하나라도_거름_밖이면_통째로_거절() {
    let ok = |p: &str| p.starts_with("/ok/");
    assert_eq!(drag_list(&["/ok/a.png".into()], ok).unwrap(), vec![PathBuf::from("/ok/a.png")]);
    assert!(drag_list(&[], ok).is_err());
    assert!(drag_list(&vec!["/ok/a.png".to_string(); 51], ok).is_err());
    assert!(drag_list(&["/ok/a.png".into(), "/etc/passwd".into()], ok).is_err());
}
