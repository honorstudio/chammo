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


// 2026-10-10 계정 풀 '남은 위험': 앱 안에서 ~/.claude.json 을 고치는 길(계정 oauthAccount·믿음·화면 조종·브라우저 붙이기·MCP 끄기)이
// 서로 읽고-고치고-쓰는 사이에 끼면 먼저 쓴 것이 사라졌고, 셋은 같은 임시 파일 이름(.claude.json.chammo-tmp)을 써서 서로 지웠다
#[test]
fn claude_json_고치기는_동시에_불러도_하나도_안_사라진다() {
    let d = tmp("edit-race");
    let f = d.join(".claude.json");
    std::fs::write(&f, r#"{"projects":{}}"#).unwrap();
    let hs: Vec<_> = (0..8)
        .map(|t| {
            let f = f.clone();
            std::thread::spawn(move || {
                for i in 0..25 {
                    let k = format!("p{t}-{i}");
                    let k2 = k.clone();
                    edit_json(
                        &f,
                        |text| {
                            let mut v: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
                            v["projects"][&k] = serde_json::json!({ "hasTrustDialogAccepted": true });
                            std::thread::yield_now(); // 읽고 쓰는 사이를 벌린다
                            Ok(Some(serde_json::to_string_pretty(&v).unwrap()))
                        },
                        || Ok(()),
                        |v| v["projects"][&k2]["hasTrustDialogAccepted"] == serde_json::json!(true),
                    )
                    .unwrap();
                }
            })
        })
        .collect();
    for h in hs {
        h.join().unwrap();
    }
    let v = read_json(&f);
    let n = v["projects"].as_object().unwrap().len();
    assert_eq!(n, 200, "사라진 칸이 있다");
    assert!(std::fs::read_dir(&d).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().contains("chammo")), "임시 파일이 남았다");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn claude_json_고치기는_권한을_지키고_안_바뀌면_안_쓴다() {
    let d = tmp("edit-perm");
    let f = d.join(".claude.json");
    std::fs::write(&f, "{}").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(edit_json(&f, |_| Ok(Some("{\"a\":1}".into())), || Ok(()), |v| v["a"] == 1).unwrap());
        assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let mut wrote = false;
    assert!(!edit_json(&f, |_| Ok(None), || { wrote = true; Ok(()) }, |_| true).unwrap());
    assert!(!wrote, "안 바뀔 땐 백업도 안 뜬다");
    let _ = std::fs::remove_dir_all(&d);
}
