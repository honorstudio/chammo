use super::*;

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-tools-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn 설정_자리는_claude_config_dir_가_있으면_그_밑() {
    let c = Cfg::from(Path::new("/h"), None);
    assert_eq!((c.dir.as_path(), c.json.as_path()), (Path::new("/h/.claude"), Path::new("/h/.claude.json")));
    let c = Cfg::from(Path::new("/h"), Some("/t/cfg"));
    assert_eq!((c.dir.as_path(), c.json.as_path()), (Path::new("/t/cfg"), Path::new("/t/cfg/.claude.json")));
    assert_eq!(Cfg::from(Path::new("/h"), Some("")).dir, Path::new("/h/.claude"));
}

#[test]
fn 고치기_전_백업은_있는_파일만_시각_폴더에() {
    let d = tmp("backup");
    let cfg = Cfg { dir: d.join(".claude"), json: d.join(".claude.json") };
    std::fs::create_dir_all(&cfg.dir).unwrap();
    std::fs::write(&cfg.json, "{\"a\":1}").unwrap();
    std::fs::write(cfg.dir.join("settings.json"), "{}").unwrap();
    let to = backup_into(&cfg, &d.join("bk"), "20261004-120000").unwrap();
    assert_eq!(std::fs::read_to_string(to.join(".claude.json")).unwrap(), "{\"a\":1}");
    assert!(to.join("settings.json").is_file());
    assert!(!to.join("known_marketplaces.json").exists()); // 없는 건 건너뛴다
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 오래된_백업은_스무_개만_남긴다() {
    let d = tmp("prune");
    for i in 0..25 { std::fs::create_dir_all(d.join(format!("2026100{}-1200{i:02}", i % 3))).unwrap(); }
    prune_backups(&d, 20);
    assert_eq!(std::fs::read_dir(&d).unwrap().count(), 20);
    let _ = std::fs::remove_dir_all(&d);
}

