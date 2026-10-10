use super::*;
use std::time::Duration;

/// 데이터 폴더·HQ 를 안 쓰는 시험
fn rules(data: &Path, hq: &str) -> Rules {
    Rules { data_dir: data.to_path_buf(), hq_dir: hq.to_string(), home: PathBuf::from("/nonexistent-home") }
}

fn nd() -> &'static Path {
    Path::new("/nonexistent-data")
}

/// 맥 temp 는 /var → /private/var 링크라 실제 위치로 잡는다(아니면 링크 거절에 걸린다)
fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-mfiles-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::canonicalize(d).unwrap()
}

#[test]
fn 허용_집합은_보여준_파일_지침서_starter() {
    let show = "{\"ts\":\"1\",\"path\":\"/u/a.png\",\"from\":\"x\"}\n깨진 줄\n{\"ts\":\"2\",\"path\":\"/u/doc.md\"}\n{\"ts\":\"3\",\"path\":\"/u/a.png\"}\n";
    let routines = r#"[{"name":"daily-check"},{"name":"../../etc"},{"name":"a/b"},{"name":""},{"kind":"cloud"}]"#;
    let v = allowed_files(show, routines, Path::new("/data"), "/hq");
    assert_eq!(v, vec!["/u/a.png", "/u/doc.md", "/data/routines/daily-check/ROUTINE.md", "/hq/docs/starter.md"]);
    // 비서 HQ 를 모르면 starter 는 없다
    assert!(!allowed_files("", "[]", Path::new("/data"), "").iter().any(|p| p.ends_with("starter.md")));
}

#[test]
fn 윈도우_hq_starter_는_폰이_묻는_슬래시_모양으로() {
    // 폰은 env.hqDir(fwd) + '/docs/starter.md' 로 묻는다 — 허용 집합은 글자 그대로 비교라 윈도우 join(역슬래시)·섞인 HQ 로는 늘 403 이었다(2026-10-05)
    let v = allowed_files("", "[]", Path::new("/data"), "C:\\Users\\Me/.chammo/hq");
    assert!(v.iter().any(|p| p == "C:/Users/Me/.chammo/hq/docs/starter.md"), "{v:?}");
    // 맥은 그대로 한 줄
    assert_eq!(allowed_files("", "[]", Path::new("/data"), "/hq/"), vec!["/hq/docs/starter.md"]);
}

#[test]
fn 집합_안의_진짜_파일만() {
    let d = tmp("pick");
    let f = d.join("doc.md");
    std::fs::write(&f, "hi").unwrap();
    let fs = f.to_string_lossy().into_owned();
    assert_eq!(pick(&fs, &[fs.clone()], &rules(nd(), "")), Pick::Ok(f.clone()));
    // 집합 밖 · 상대 경로 · 빈 글
    assert_eq!(pick(&fs, &[], &rules(nd(), "")), Pick::Forbidden);
    assert_eq!(pick("doc.md", &["doc.md".into()], &rules(nd(), "")), Pick::Forbidden);
    assert_eq!(pick("", &["".into()], &rules(nd(), "")), Pick::Forbidden);
    // 집합 글자에 ../ 가 섞여 있으면 실제 위치가 달라 거절
    let dotted = format!("{}/sub/../doc.md", d.display());
    std::fs::create_dir_all(d.join("sub")).unwrap();
    assert_eq!(pick(&dotted, &[dotted.clone()], &rules(nd(), "")), Pick::Forbidden);
    // 폴더(확장자 없음 → 허용 목록 밖)·없는 파일
    let ds = d.to_string_lossy().into_owned();
    assert_eq!(pick(&ds, &[ds.clone()], &rules(nd(), "")), Pick::Forbidden);
    let gone = format!("{}/gone.md", d.display());
    assert_eq!(pick(&gone, &[gone.clone()], &rules(nd(), "")), Pick::NotFound);
    let _ = std::fs::remove_dir_all(&d);
}

#[cfg(unix)]
#[test]
fn 심볼릭_링크로_밖을_가리키면_거절() {
    let d = tmp("link");
    let outside = tmp("outside").join("secret.txt");
    std::fs::write(&outside, "secret").unwrap();
    // 파일 링크
    let link = d.join("innocent.md");
    std::os::unix::fs::symlink(&outside, &link).unwrap();
    let ls = link.to_string_lossy().into_owned();
    assert_eq!(pick(&ls, &[ls.clone()], &rules(nd(), "")), Pick::Forbidden);
    // 폴더 링크를 거친 경로
    let dirlink = d.join("dir");
    std::os::unix::fs::symlink(outside.parent().unwrap(), &dirlink).unwrap();
    let via = format!("{}/secret.txt", dirlink.display());
    assert_eq!(pick(&via, &[via.clone()], &rules(nd(), "")), Pick::Forbidden);
    let _ = std::fs::remove_dir_all(&d);
    let _ = std::fs::remove_dir_all(outside.parent().unwrap());
}

#[test]
fn 스크립트가_도는_형식은_글로() {
    for p in ["a.html", "a.htm", "a.svg", "a.xhtml", "a.js", "a.md", "noext"] {
        assert_eq!(kind_of(Path::new(p)), Kind::Text, "{p}");
    }
    assert_eq!(kind_of(Path::new("a.PNG")), Kind::Image("image/png"));
    assert_eq!(kind_of(Path::new("a.heic")), Kind::Heic);
    assert_eq!(kind_of(Path::new("a.pdf")), Kind::Pdf);
}

#[test]
fn 붙이는_그림은_앞_바이트로() {
    assert_eq!(image_ext(b"\x89PNG\r\n\x1a\nxxxx"), Some("png"));
    assert_eq!(image_ext(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0]), Some("jpg"));
    assert_eq!(image_ext(b"GIF89a...."), Some("gif"));
    assert_eq!(image_ext(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
    assert_eq!(image_ext(b"\0\0\0\x18ftypheic\0\0\0\0"), Some("heic"));
    // 글·html·실행 파일·빈 것
    for b in [&b"<html><script>"[..], b"#!/bin/sh\n", b"\x7fELF....", b"", b"%PDF-1.7"] {
        assert_eq!(image_ext(b), None);
    }
}

#[test]
fn 민감한_파일은_보여_준_기록에_있어도_거절() {
    let d = tmp("sens");
    for name in ["mobile.key", ".env", ".env.local", "server.pem", "id_rsa", "id_ed25519.pub", "secrets.local.md", "CLAUDE.local.md", ".credentials.json", "cert.p12"] {
        let f = d.join(name);
        std::fs::write(&f, "x").unwrap();
        let fs = f.to_string_lossy().into_owned();
        assert_eq!(pick(&fs, &[fs.clone()], &rules(nd(), "")), Pick::Forbidden, "{name}");
    }
    for dir in [".ssh", ".gnupg", ".aws", "Keychains"] {
        std::fs::create_dir_all(d.join(dir)).unwrap();
        let f = d.join(dir).join("config");
        std::fs::write(&f, "x").unwrap();
        let fs = f.to_string_lossy().into_owned();
        assert_eq!(pick(&fs, &[fs.clone()], &rules(nd(), "")), Pick::Forbidden, "{dir}");
    }
    // 보통 문서는 그대로
    let ok = d.join("notes.md");
    std::fs::write(&ok, "x").unwrap();
    let os = ok.to_string_lossy().into_owned();
    assert_eq!(pick(&os, &[os.clone()], &rules(nd(), "")), Pick::Ok(ok));
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn s4_허용_목록_밖은_보여_준_기록에_있어도_거절() {
    let home = tmp("s4home");
    let data = home.join(".honor-orchestrator");
    let hq = home.join("hq");
    let bad: Vec<PathBuf> = vec![
        data.join("accounts.json"),
        home.join("dev/app/apple-secrets.json"),
        home.join(".claude/infra.md"),
        home.join("dev/app/.mcp.json"),
        home.join(".claude.json"),
        home.join(".claude/settings.json"),
        home.join("dev/app/settings.json"),
        home.join(".npmrc"),
        home.join(".netrc"),
        home.join(".git-credentials"),
        home.join(".config/gh/hosts.yml"),
        home.join("dev/app/api-token-guide.md"),
        home.join("dev/app/my_password.txt"),
        home.join("dev/app/infra.md"),
        home.join("dev/app/CLAUDE.local.md"),
        home.join("dev/app/key-notes.md"),
        // 코드·json 은 2026-10-03 부터 열린다(글 속 키는 secret_in) — 서비스 계정·실행 파일은 그대로 막힌다
        home.join("dev/app/firebase-adminsdk-x.json"),
        home.join("dev/app/run.command"),
        data.join("routines/x/other.md"),
        data.join("show.md"),
    ];
    for p in &bad {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, "x").unwrap();
        let s = p.to_string_lossy().into_owned();
        assert_eq!(pick(&s, &[s.clone()], &rules(&data, &hq.to_string_lossy())), Pick::Forbidden, "{s}");
    }
    let good = [home.join("dev/app/docs/plan.md"), home.join("dev/app/shot.PNG"), home.join("dev/app/report.pdf"), home.join("dev/app/v1.html"), data.join("routines/daily/ROUTINE.md"), hq.join("docs/starter.md")];
    for p in &good {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, "x").unwrap();
        let s = p.to_string_lossy().into_owned();
        assert_eq!(pick(&s, &[s.clone()], &rules(&data, &hq.to_string_lossy())), Pick::Ok(p.clone()), "{s}");
    }
    let _ = std::fs::remove_dir_all(&home);
}

#[cfg(unix)]
#[test]
fn s9_고른_뒤_폴더를_링크로_바꿔치기하면_읽지_않는다() {
    let home = tmp("s9");
    let dir = home.join("docs");
    std::fs::create_dir_all(&dir).unwrap();
    let f = dir.join("plan.md");
    std::fs::write(&f, "진짜").unwrap();
    let s = f.to_string_lossy().into_owned();
    assert_eq!(pick(&s, &[s.clone()], &rules(nd(), "")), Pick::Ok(f.clone()));
    assert_eq!(read_verified(&s, 1024).unwrap(), "진짜".as_bytes());
    // 고른 다음 — 폴더를 비밀 폴더를 가리키는 링크로 바꿔치기
    let secret = home.join("vault");
    std::fs::create_dir_all(&secret).unwrap();
    std::fs::write(secret.join("plan.md"), "비밀").unwrap();
    std::fs::rename(&dir, home.join("docs-old")).unwrap();
    std::os::unix::fs::symlink(&secret, &dir).unwrap();
    assert!(read_verified(&s, 1024).is_err(), "바꿔치기한 파일을 읽었다");
    // 끝 성분이 링크여도
    let link = home.join("x.md");
    std::os::unix::fs::symlink(secret.join("plan.md"), &link).unwrap();
    assert!(read_verified(&link.to_string_lossy(), 1024).is_err());
    // 크기 상한
    std::fs::write(home.join("big.md"), vec![b'a'; 2048]).unwrap();
    assert!(read_verified(&home.join("big.md").to_string_lossy(), 1024).is_err());
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn s4b_점_경로는_프로젝트_안_shots_와_claude_worktrees_만() {
    let home = tmp("s4bhome");
    let r = Rules { data_dir: home.join(".honor-orchestrator"), hq_dir: String::new(), home: home.clone() };
    let good = [home.join("dev/app/.shots/cap.png"), home.join("dev/app/.shots/release/v1/1-local.md"), home.join("dev/app/.claude/worktrees/feat/docs/design-drafts/v1.html")];
    let bad = [
        home.join(".claude/worktrees/x/a.md"),          // 홈 바로 아래 .claude
        home.join("dev/app/.claude/settings.md"),        // .claude 인데 worktrees 아님
        home.join("dev/app/.claude/worktrees/b/.git/x.md"),
        home.join("dev/app/.claude/worktrees/b/secret-notes.md"),
        home.join("dev/app/.shots/token.png"),
        home.join("dev/app/.claude/worktrees/b/service-account.json"),
        home.join("dev/app/.ssh/a.md"),
        home.join(".shots/../.ssh/a.md"),
    ];
    for p in &good {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, "x").unwrap();
        let s = p.to_string_lossy().into_owned();
        assert_eq!(pick(&s, &[s.clone()], &r), Pick::Ok(p.clone()), "{s}");
    }
    for p in &bad {
        let _ = std::fs::create_dir_all(p.parent().unwrap());
        let _ = std::fs::write(p, "x");
        let s = p.to_string_lossy().into_owned();
        assert_eq!(pick(&s, &[s.clone()], &r), Pick::Forbidden, "{s}");
    }
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn r3_외부_명령은_시간이_넘으면_죽인다() {
    let t0 = std::time::Instant::now();
    let r = crate::platform::run_capped(crate::platform::command("/bin/sleep").arg("5"), Duration::from_millis(500));
    assert!(r.is_err());
    assert!(t0.elapsed() < Duration::from_secs(2), "{:?}", t0.elapsed());
    let ok = crate::platform::run_capped(crate::platform::command("/bin/echo").arg("안녕"), Duration::from_secs(5)).unwrap();
    assert_eq!(String::from_utf8_lossy(&ok.stdout).trim(), "안녕");
}

#[test]
fn 붙일_파일은_허용_형식만_앞_바이트_mime_이름으로() {
    let png = b"\x89PNG\r\n\x1a\nrest";
    // 그림은 앞 바이트가 정한다(이름표가 틀려도)
    assert_eq!(attach_kind(png, "image/png", "a.png"), Some("png"));
    assert_eq!(attach_kind(png, "application/octet-stream", "photo"), Some("png"));
    assert_eq!(attach_kind(b"%PDF-1.7\n...", "application/pdf", "doc.pdf"), Some("pdf"));
    assert_eq!(attach_kind(b"PK\x03\x04....", "application/zip", "a.zip"), Some("zip"));
    assert_eq!(attach_kind("메모\n줄".as_bytes(), "text/plain", "note.txt"), Some("txt"));
    assert_eq!(attach_kind(b"# t\n", "text/markdown", "README.md"), Some("md"));
    assert_eq!(attach_kind(b"a,b\n1,2\n", "text/csv", "t.csv"), Some("csv"));
    assert_eq!(attach_kind(b"{\"a\":1}", "application/json", "d.json"), Some("json"));
    // 실행 파일·스크립트 — 이름을 바꿔도
    for (b, mime, name) in [
        (&b"#!/bin/sh\nrm -rf ~\n"[..], "text/plain", "note.txt"),
        (b"#!/usr/bin/env python3\n", "text/plain", "a.md"),
        (b"\xcf\xfa\xed\xfe\x07\x00\x00\x01", "application/octet-stream", "a.txt"),
        (b"\xca\xfe\xba\xbe\x00\x00\x00\x02", "application/octet-stream", "a.zip"),
        (b"\x7fELF\x02\x01", "application/octet-stream", "a.pdf"),
        (b"MZ\x90\x00\x03", "application/octet-stream", "a.txt"),
        (b"echo hi\n", "text/plain", "run.sh"),
        (b"echo hi\n", "text/plain", "run.command"),
        (b"PK\x03\x04....", "application/zip", "a.app"),
        (b"PK\x03\x04....", "application/zip", "a.pkg"),
        (b"PK\x03\x04....", "application/zip", "a.jar"),
        (b"PK\x03\x04....", "application/vnd.android.package-archive", "a.apk"),
        (b"koly", "application/x-apple-diskimage", "a.dmg"),
        (b"display dialog", "text/plain", "a.scpt"),
        (b"<html><script>", "text/html", "a.html"),
        // 이름표만 글 — 속은 바이너리(NUL)
        (b"abc\x00def", "text/plain", "a.txt"),
        // 이름 조작: 겹친 확장자·경로·끝 점
        (b"echo", "text/plain", "a.txt.sh"),
        (b"echo", "text/plain", "../../x.sh"),
        (b"hi", "text/plain", "a."),
        (b"hi", "text/plain", ""),
    ] {
        assert_eq!(attach_kind(b, mime, name), None, "{name} {mime}");
    }
    // 글인데 확장자가 겹쳐 .txt 로 끝나면 글로(이름은 서버가 새로 짓는다)
    assert_eq!(attach_kind(b"hi", "text/plain", "../../a.sh.txt"), Some("txt"));
    // 글 MIME 이 아닌데 .txt 라고 우겨도(예: application/x-sh) 거절
    assert_eq!(attach_kind(b"hi", "application/x-sh", "a.txt"), None);
}

#[cfg(unix)]
#[test]
fn m1_시간_넘으면_손자까지_죽이고_파이프에_안_멈춘다() {
    // 셸이 손자(백그라운드 sleep)를 띄우고 그 손자가 출력 파이프를 쥔다 — 직계만 죽이면 손자가 남고 출력 읽기(join)가 30초 멈췄다
    let t0 = std::time::Instant::now();
    let r = crate::platform::run_capped(crate::platform::command("/bin/sh").args(["-c", "/bin/sleep 31.4159 & /bin/sleep 30"]), Duration::from_millis(500));
    assert!(r.is_err());
    assert!(t0.elapsed() < Duration::from_secs(3), "{:?}", t0.elapsed());
    std::thread::sleep(Duration::from_millis(200));
    let left = crate::platform::command("/usr/bin/pgrep").args(["-f", "sleep 31.4159"]).output().unwrap();
    assert!(left.stdout.is_empty(), "손자가 남았다: {}", String::from_utf8_lossy(&left.stdout));
}

#[cfg(unix)]
#[test]
fn m1_끝났는데_백그라운드_손자가_파이프를_쥐어도_2초_안에_돌아온다() {
    let t0 = std::time::Instant::now();
    let out = crate::platform::run_capped(crate::platform::command("/bin/sh").args(["-c", "echo 끝; /bin/sleep 27.1828 &"]), Duration::from_secs(10)).unwrap();
    assert!(t0.elapsed() < Duration::from_secs(4), "{:?}", t0.elapsed());
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "끝");
    let _ = crate::platform::command("/usr/bin/pkill").args(["-f", "sleep 27.1828"]).status();
}

#[test]
fn m4_프사_그림은_키로_만든_경로의_허용_형식만() {
    let d = tmp("avatar");
    std::fs::write(d.join("참모-3.png"), b"\x89PNG\r\n\x1a\nxx").unwrap();
    assert_eq!(avatar_image_in(&d, "참모-3").map(|x| x.1), Some("image/png"));
    // 이름표(확장자)와 속이 다르면 거절, 없는 키 None
    std::fs::write(d.join("참모-4.png"), b"<svg onload=alert(1)>").unwrap();
    assert_eq!(avatar_image_in(&d, "참모-4"), None);
    assert_eq!(avatar_image_in(&d, "참모-9"), None);
    // 크기 상한(5MB)
    std::fs::write(d.join("큰.jpg"), [&[0xFF, 0xD8, 0xFF][..], &vec![0u8; crate::avatar::MAX_IMAGE]].concat()).unwrap();
    assert_eq!(avatar_image_in(&d, "큰"), None);
    // 링크로 밖을 가리키면 거절
    #[cfg(unix)]
    {
        let outside = tmp("avatar-out").join("secret.png");
        std::fs::write(&outside, b"\x89PNG\r\n\x1a\nsecret").unwrap();
        std::os::unix::fs::symlink(&outside, d.join("참모-5.png")).unwrap();
        assert_eq!(avatar_image_in(&d, "참모-5"), None);
        let _ = std::fs::remove_dir_all(outside.parent().unwrap());
    }
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn m4b_파인더·sips_가_만든_nfd_한글_이름도_nfc_요청으로_읽힌다() {
    // macOS 도구는 한글 파일 이름을 풀어 쓴 꼴(NFD)로 저장한다 — 실제 경로 글자 비교는 NFC 요청과 달라 거절했다
    let d = tmp("nfd");
    let nfd = "\u{110E}\u{1161}\u{11B7}\u{1106}\u{1169}-2"; // 참모-2 (NFD)
    std::fs::write(d.join(format!("{nfd}.png")), b"\x89PNG\r\n\x1a\nxx").unwrap();
    assert_eq!(avatar_image_in(&d, "참모-2").map(|x| x.1), Some("image/png"));
    std::fs::write(d.join(format!("{nfd} 메모.md")), "hi").unwrap();
    let nfc_req = format!("{}/참모-2 메모.md", d.display());
    assert!(matches!(pick(&nfc_req, &[nfc_req.clone()], &rules(nd(), "")), Pick::Ok(_)));
    assert_eq!(read_verified(&nfc_req, 100).unwrap(), b"hi");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 폰이_올린_첨부는_목록_없이도_보인다_서버가_지은_이름만() {
    let data = tmp("attach");
    let att = data.join("attach");
    std::fs::create_dir_all(att.join("sub")).unwrap();
    let r = rules(&data, "");
    let put = |name: &str| {
        let p = att.join(name);
        std::fs::write(&p, "x").unwrap();
        p.to_string_lossy().into_owned()
    };
    // 폰 보내기 말풍선 썸네일 — 보여 준 목록(show log)에 없어도
    for ok in ["1790949356271-phone.jpg", "1-phone.png", "2-phone.webp", "3-phone.gif", "4-phone.pdf", "5-phone.md", "6-phone.txt"] {
        let p = put(ok);
        assert_eq!(pick(&p, &[], &r), Pick::Ok(PathBuf::from(&p)), "{ok}");
    }
    // 데스크톱이 붙인 그림(시각-원래이름)·이름 꼴이 다른 것·보기 안 되는 확장자·하위 폴더
    for bad in ["1790949356271-image.png", "abc-phone.jpg", "-phone.jpg", "1-phone.jpg.png.html", "1-phone.zip", "1-phone.csv", "1-phone.json", "1-phone.html", "1-Phone.jpg", "1-phone", "sub/1-phone.jpg"] {
        let p = put(bad);
        assert_eq!(pick(&p, &[], &r), Pick::Forbidden, "{bad}");
    }
    // ../ · ./ 로 첨부 폴더처럼 보이게
    let up = format!("{}/attach/../attach/7-phone.jpg", data.display());
    put("7-phone.jpg");
    assert_eq!(pick(&up, &[], &r), Pick::Forbidden);
    let dot = format!("{}/attach/./7-phone.jpg", data.display());
    assert_eq!(pick(&dot, &[], &r), Pick::Forbidden);
    assert_eq!(pick(&format!("{}/attach//7-phone.jpg", data.display()), &[], &r), Pick::Forbidden);
    // 다른 폴더의 attach 는 아니다
    let other = tmp("attach-other");
    std::fs::create_dir_all(other.join("attach")).unwrap();
    let o = other.join("attach/8-phone.jpg");
    std::fs::write(&o, "x").unwrap();
    assert_eq!(pick(&o.to_string_lossy(), &[], &r), Pick::Forbidden);
    // 링크는 이름이 맞아도 거절
    #[cfg(unix)]
    {
        let secret = other.join("secret.jpg");
        std::fs::write(&secret, "s").unwrap();
        let link = att.join("9-phone.jpg");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        assert_eq!(pick(&link.to_string_lossy(), &[], &r), Pick::Forbidden);
        // 첨부 폴더 자체가 링크여도
        let d2 = tmp("attach-link");
        std::os::unix::fs::symlink(other.join("attach"), d2.join("attach")).unwrap();
        assert_eq!(pick(&d2.join("attach/8-phone.jpg").to_string_lossy(), &[], &rules(&d2, "")), Pick::Forbidden);
    }
}

// ── 폰 그림 보기·썸네일(2026-10-03 사용자 '주고받은 파일 전략' 1·2) ──

fn png_head(w: u32, h: u32) -> Vec<u8> {
    let mut b = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    b.extend_from_slice(&w.to_be_bytes());
    b.extend_from_slice(&h.to_be_bytes());
    b.extend_from_slice(&[8, 6, 0, 0, 0]);
    b
}

#[test]
fn 그림_크기는_앞_바이트로() {
    assert_eq!(image_dims(&png_head(1800, 1500)), Some((1800, 1500)));
    // JPEG — SOI, APP0 조각 하나 건너 SOF0
    let mut j = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08];
    j.extend_from_slice(&1500u16.to_be_bytes());
    j.extend_from_slice(&4032u16.to_be_bytes());
    assert_eq!(image_dims(&j), Some((4032, 1500)));
    let mut g = b"GIF89a".to_vec();
    g.extend_from_slice(&320u16.to_le_bytes());
    g.extend_from_slice(&200u16.to_le_bytes());
    assert_eq!(image_dims(&g), Some((320, 200)));
    // WebP VP8X — 24비트 너비-1·높이-1
    let mut w = b"RIFF\0\0\0\0WEBPVP8X\0\0\0\0\0\0\0\0".to_vec();
    w.extend_from_slice(&[0xFF, 0x0E, 0x00, 0x3F, 0x0A, 0x00]); // 3840 x 2624
    assert_eq!(image_dims(&w), Some((3840, 2624)));
    assert_eq!(image_dims(b"hello"), None);
}

#[test]
fn 보기용_그림은_크거나_무거울_때만_줄인다() {
    let png = Kind::Image("image/png");
    // v1.png(1800×1500, 227KB) — 그대로
    assert_eq!(view_plan(&png, 227_000, Some((1800, 1500))), None);
    // 긴 변 2560 넘음·1.5MB 넘음 → 2560 JPEG
    assert_eq!(view_plan(&png, 400_000, Some((4032, 3024))), Some(2560));
    assert_eq!(view_plan(&png, 3_000_000, Some((1200, 900))), Some(2560));
    assert_eq!(view_plan(&png, 3_000_000, None), Some(2560));
    // GIF 는 움직임이 깨지니 그대로, HEIC 는 늘 JPEG
    assert_eq!(view_plan(&Kind::Image("image/gif"), 9_000_000, Some((4000, 3000))), None);
    assert_eq!(view_plan(&Kind::Heic, 900_000, Some((1000, 800))), Some(2560));
    assert_eq!(view_plan(&Kind::Pdf, 9_000_000, None), None);
}

#[test]
fn 긴_캡처는_짧은_변으로_줄인다() {
    // 2026-10-03 전략 표 7번 — 긴 변 2560 으로 줄이면 1170×12000 캡처가 250px 폭이 돼 글씨가 뭉갰다
    let png = Kind::Image("image/png");
    // 짧은 변 1440 이하·가벼우면 원본, 무거우면 같은 크기 JPEG
    assert_eq!(view_plan(&png, 1_000_000, Some((1170, 12000))), None);
    assert_eq!(view_plan(&png, 3_000_000, Some((1170, 12000))), Some(12000));
    // 짧은 변 1440 으로(2880×20000 → 1440×10000)
    assert_eq!(view_plan(&png, 3_000_000, Some((2880, 20000))), Some(10000));
    // 화소 16MP 넘지 않게(1170×40000 → 긴 변 23388)
    assert_eq!(view_plan(&png, 3_000_000, Some((1170, 40000))), Some(23388));
    // 가로로 긴 것도 같다
    assert_eq!(view_plan(&png, 3_000_000, Some((20000, 2880))), Some(10000));
    // 2.5배 이하는 예전대로
    assert_eq!(view_plan(&png, 400_000, Some((1170, 2532))), None);
}

#[test]
fn 썸네일_크기는_정해_둔_것만() {
    assert_eq!(thumb_size(None), 480);
    assert_eq!(thumb_size(Some("360")), 360);
    assert_eq!(thumb_size(Some("720")), 720);
    assert_eq!(thumb_size(Some("4000")), 480);
    assert_eq!(thumb_size(Some("x")), 480);
}

#[test]
fn 오피스_영상은_종류가_따로_있고_보여_준_것이면_썸네일_대상() {
    assert_eq!(kind_of(Path::new("/a/b.pptx")), Kind::Office);
    assert_eq!(kind_of(Path::new("/a/b.DOCX")), Kind::Office);
    assert_eq!(kind_of(Path::new("/a/b.mov")), Kind::Video);
    // 썸네일을 QuickLook 으로 — PDF·HTML 시안·오피스·영상. 그림은 sips, 글은 폰이 앞부분을 글로
    for p in ["a.pdf", "a.html", "a.pptx", "a.key", "a.docx", "a.xlsx", "a.mov", "a.mp4"] {
        assert!(wants_quicklook(Path::new(p)), "{p}");
    }
    for p in ["a.png", "a.md", "a.txt", "a.heic"] {
        assert!(!wants_quicklook(Path::new(p)), "{p}");
    }
}

#[test]
fn 코드_텍스트_확장자는_열리고_비밀_이름은_막힌다() {
    let r = rules(nd(), "");
    for ok in ["/u/a.json", "/u/b.csv", "/u/c.tsv", "/u/d.log", "/u/e.yaml", "/u/f.toml", "/u/g.ts", "/u/h.tsx", "/u/i.py", "/u/j.rs", "/u/k.sh", "/u/l.swift", "/u/m.css", "/u/n.sql"] {
        assert!(shareable(Path::new(ok), &r), "{ok}");
    }
    for bad in ["/u/service-account.json", "/u/firebase-adminsdk-x.json", "/u/google-services.json", "/u/GoogleService-Info.plist", "/u/id_rsa.pub", "/u/x.pem", "/u/a.env", "/u/.env.json", "/u/secret.ts"] {
        assert!(!shareable(Path::new(bad), &r), "{bad}");
    }
    assert_eq!(kind_of(Path::new("/u/a.json")), Kind::Text);
}

#[test]
fn 글_속_비밀은_내보내지_않는다() {
    for bad in [
        "-----BEGIN OPENSSH PRIVATE KEY-----\nabc",
        "key = \"sk-proj-abcdefghijklmnopqrstuvwxyz012345\"",
        "AWS AKIAABCDEFGHIJKLMNOP",
        "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "SLACK=xoxb-123456789012-abcdefghij",
        r#"{"type":"service_account","private_key":"x"}"#,
        "SUPABASE eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxfQ.abcdefghijklmnopqrstuvwxyz",
        "sb_secret_abcdefghijklmnopqrstu",
    ] {
        assert!(secret_in(bad.as_bytes()), "{bad}");
    }
    for ok in ["# 문서\nsk- 로 시작하는 키는 금지", "AKIA 는 AWS 접두", "eyJ 로 시작", "그냥 글 private key 얘기"] {
        assert!(!secret_in(ok.as_bytes()), "{ok}");
    }
}

#[test]
fn md_속_그림은_그_문서가_가리킨_것만() {
    let doc = Path::new("/u/docs/plan.md");
    let md = "# 계획\n![첫](./shots/a.png)\n![둘](../assets/b%20c.jpg \"제목\")\n<img src=\"img/c.webp\" width=200>\n![밖](https://x.com/d.png)\n![절대](/etc/e.png)\n`![코드](f.png)` 는 그래도 넣는다";
    let v = md_images(md, doc);
    assert!(v.contains(&PathBuf::from("/u/docs/shots/a.png")), "{v:?}");
    assert!(v.contains(&PathBuf::from("/u/assets/b c.jpg")), "{v:?}");
    assert!(v.contains(&PathBuf::from("/u/docs/img/c.webp")), "{v:?}");
    assert!(!v.iter().any(|p| p.to_string_lossy().contains("x.com") || p.starts_with("/etc")), "{v:?}");
    // 그림 확장자만
    assert!(md_images("[링크](./other.md) ![x](a.txt)", doc).is_empty());
}

#[test]
fn range_머리_해석() {
    const C: u64 = 1024 * 1024;
    assert_eq!(parse_range(Some("bytes=0-1"), 3000, C), Some((0, 1)));
    assert_eq!(parse_range(Some("bytes=2990-"), 3000, C), Some((2990, 2999)));
    assert_eq!(parse_range(Some("bytes=-5"), 3000, C), Some((2995, 2999)));
    assert_eq!(parse_range(Some("bytes=0-99999"), 3000, C), Some((0, 2999)), "끝이 넘치면 파일 끝까지");
    // 한 번에 1MB 까지 — 사파리는 이어서 다시 묻는다
    assert_eq!(parse_range(Some("bytes=0-"), 3 * C, C), Some((0, C - 1)));
    assert_eq!(parse_range(None, 3 * C, C), Some((0, C - 1)), "머리 없으면 앞부터");
    for bad in ["bytes=5000-", "bytes=5-2", "items=0-1", "bytes=0-1,5-6", "bytes=-0", "bytes=a-b"] {
        assert_eq!(parse_range(Some(bad), 3000, C), None, "{bad}");
    }
    assert_eq!(parse_range(None, 0, C), None);
}

#[test]
fn 범위_읽기도_링크_바꿔치기를_막는다() {
    let home = tmp("rangev");
    let f = home.join("clip.mp4");
    std::fs::write(&f, (0..3000u32).map(|i| (i % 256) as u8).collect::<Vec<_>>()).unwrap();
    let (b, total) = read_range_verified(&f.to_string_lossy(), 2990, 2999).unwrap();
    assert_eq!((b.len(), total, b[0]), (10, 3000, (2990 % 256) as u8));
    let link = home.join("l.mp4");
    std::os::unix::fs::symlink(&f, &link).unwrap();
    assert!(read_range_verified(&link.to_string_lossy(), 0, 1).is_err());
    let _ = std::fs::remove_dir_all(&home);
}

/// 닫힌 워크트리 시험 판 — <홈>/proj(.git 있음) 와 그 안 문서·캡처. 워크트리 폴더는 만들지 않는다(닫힌 뒤)
fn closed_wt(name: &str) -> (PathBuf, PathBuf) {
    let home = tmp(name);
    let repo = home.join("proj");
    std::fs::create_dir_all(repo.join(".git")).unwrap();
    std::fs::create_dir_all(repo.join("docs/drafts")).unwrap();
    std::fs::write(repo.join("docs/drafts/v1.html"), "<p>v1</p>").unwrap();
    std::fs::create_dir_all(repo.join(".shots/wt-mobile/a")).unwrap();
    std::fs::write(repo.join(".shots/wt-mobile/a/s1.png"), b"\x89PNG").unwrap();
    (home, repo)
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[test]
fn 닫힌_워크트리_경로는_본_폴더_같은_자리로_풀린다() {
    let (home, repo) = closed_wt("wt-merged");
    let wt = repo.join(".claude/worktrees/mobile/docs/drafts/v1.html");
    assert_eq!(moved_from_worktree(&wt, &home), Some(repo.join("docs/drafts/v1.html")));
    // .shots 는 닫을 때 옮겨 둔 .shots/wt-<이름>/ 에서
    let shot = repo.join(".claude/worktrees/mobile/.shots/a/s1.png");
    assert_eq!(moved_from_worktree(&shot, &home), Some(repo.join(".shots/wt-mobile/a/s1.png")));
    // 본 폴더 .shots 에 같은 자리가 있으면 그게 먼저
    std::fs::create_dir_all(repo.join(".shots/a")).unwrap();
    std::fs::write(repo.join(".shots/a/s1.png"), b"\x89PNG").unwrap();
    assert_eq!(moved_from_worktree(&shot, &home), Some(repo.join(".shots/a/s1.png")));
}

#[test]
fn 재현_고정한_문서가_닫힌_워크트리_경로면_새_자리를_알려_준다() {
    // 고정(spacePins)은 show 기록이 아니라 앱 기억에 있어서 기록 풀기(resolve_show_log)를 안 거쳤다
    let (home, repo) = closed_wt("wt-pins");
    let wt = repo.join(".claude/worktrees/mobile/docs/drafts/v1.html").to_string_lossy().into_owned();
    let live = repo.join("docs/drafts/v1.html").to_string_lossy().into_owned();
    let none = repo.join(".claude/worktrees/mobile/docs/none.md").to_string_lossy().into_owned();
    let m = crate::mobile_files::moved_map(&[wt.clone(), live.clone(), none, "rel/x.md".into()], &home);
    assert_eq!(m.len(), 1, "옮겨 간 것만 — 있는 경로·못 찾은 경로·상대 경로는 빠진다");
    assert_eq!(m.get(&wt), Some(&live));
}

#[test]
fn 풀리지_않는_경로() {
    let (home, repo) = closed_wt("wt-nope");
    // 본 폴더에도 없음
    assert_eq!(moved_from_worktree(&repo.join(".claude/worktrees/mobile/docs/none.md"), &home), None);
    // 이름이 비슷한 다른 워크트리 — wt-mobile 은 mobile 것이지 mobile-max 것이 아니다
    assert_eq!(moved_from_worktree(&repo.join(".claude/worktrees/mobile-max/.shots/a/s1.png"), &home), None);
    assert_eq!(moved_from_worktree(&repo.join(".claude/worktrees/mob/.shots/ile/a/s1.png"), &home), None);
    // 원래 경로가 살아 있으면 손대지 않는다
    std::fs::create_dir_all(repo.join(".claude/worktrees/live/docs/drafts")).unwrap();
    std::fs::write(repo.join(".claude/worktrees/live/docs/drafts/v1.html"), "x").unwrap();
    assert_eq!(moved_from_worktree(&repo.join(".claude/worktrees/live/docs/drafts/v1.html"), &home), None);
    // 워크트리 모양이 아님 · 글자만 비슷함(worktrees-old) · 이름만 있고 나머지 없음
    assert_eq!(moved_from_worktree(&repo.join("docs/gone.md"), &home), None);
    assert_eq!(moved_from_worktree(&repo.join(".claude/worktrees-old/mobile/docs/drafts/v1.html"), &home), None);
    assert_eq!(moved_from_worktree(&repo.join(".claude/worktrees/mobile"), &home), None);
    // 상대 경로
    assert_eq!(moved_from_worktree(Path::new("proj/.claude/worktrees/mobile/docs/drafts/v1.html"), &home), None);
}

#[test]
fn 풀기는_거름을_우회하는_길이_아니다() {
    let (home, repo) = closed_wt("wt-attack");
    // ../ 로 위로 — 성분에 .. · . 이 있으면 아예 풀지 않는다
    std::fs::write(home.join("outside.md"), "x").unwrap();
    assert_eq!(moved_from_worktree(&repo.join(".claude/worktrees/mobile/../../../outside.md"), &home), None);
    assert_eq!(moved_from_worktree(&repo.join(".claude/worktrees/../worktrees/mobile/docs/drafts/v1.html"), &home), None);
    assert_eq!(moved_from_worktree(&repo.join(".claude/worktrees/./mobile/docs/drafts/v1.html"), &home), None);
    // 이름이 점으로 시작(.. 를 이름처럼) — .shots/wt-.. 로 새지 않게
    assert_eq!(moved_from_worktree(&repo.join(".claude/worktrees/.x/.shots/a/s1.png"), &home), None);
    // 홈 밖 저장소 · 홈 자체가 저장소(~/.claude/worktrees 는 프로젝트가 아니다) · .git 없는 폴더
    let other = tmp("wt-attack-out");
    std::fs::create_dir_all(other.join("r/.git")).unwrap();
    std::fs::write(other.join("r/a.md"), "x").unwrap();
    assert_eq!(moved_from_worktree(&other.join("r/.claude/worktrees/w/a.md"), &home), None);
    std::fs::create_dir_all(home.join(".git")).unwrap();
    std::fs::write(home.join("notes.md"), "x").unwrap();
    assert_eq!(moved_from_worktree(&home.join(".claude/worktrees/w/notes.md"), &home), None);
    std::fs::create_dir_all(home.join("plain")).unwrap();
    std::fs::write(home.join("plain/a.md"), "x").unwrap();
    assert_eq!(moved_from_worktree(&home.join("plain/.claude/worktrees/w/a.md"), &home), None);
    // 본 폴더 쪽 자리가 링크면(밖을 가리켜도·안을 가리켜도) 풀지 않는다
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(other.join("r/a.md"), repo.join("docs/link.md")).unwrap();
        assert_eq!(moved_from_worktree(&repo.join(".claude/worktrees/mobile/docs/link.md"), &home), None);
        std::os::unix::fs::symlink(repo.join("docs"), repo.join("ldocs")).unwrap();
        assert_eq!(moved_from_worktree(&repo.join(".claude/worktrees/mobile/ldocs/drafts/v1.html"), &home), None);
    }
}

#[test]
fn 풀린_경로도_폰_거름을_그대로_지난다() {
    let (home, repo) = closed_wt("wt-fence");
    std::fs::write(repo.join("CLAUDE.local.md"), "계정").unwrap();
    std::fs::write(repo.join(".env"), "K=1").unwrap();
    let log = [
        format!("{{\"ts\":\"1\",\"path\":\"{}\",\"from\":\"a\"}}", s(&repo.join(".claude/worktrees/mobile/docs/drafts/v1.html"))),
        format!("{{\"ts\":\"2\",\"path\":\"{}\"}}", s(&repo.join(".claude/worktrees/mobile/CLAUDE.local.md"))),
        format!("{{\"ts\":\"3\",\"path\":\"{}\"}}", s(&repo.join(".claude/worktrees/mobile/.env"))),
    ]
    .join("\n");
    let fixed = resolve_show_log(&log, &home);
    let allowed = allowed_files(&fixed, "[]", nd(), "");
    let r = Rules { data_dir: nd().to_path_buf(), hq_dir: String::new(), home: home.clone() };
    assert_eq!(pick(&s(&repo.join("docs/drafts/v1.html")), &allowed, &r), Pick::Ok(repo.join("docs/drafts/v1.html")));
    // 민감 파일은 풀려도 거절
    assert_eq!(pick(&s(&repo.join("CLAUDE.local.md")), &allowed, &r), Pick::Forbidden);
    assert_eq!(pick(&s(&repo.join(".env")), &allowed, &r), Pick::Forbidden);
}

#[test]
fn 기록을_읽을_때_옮긴_줄은_새_자리_못_찾으면_gone() {
    let (home, repo) = closed_wt("wt-log");
    std::fs::write(repo.join("docs/here.md"), "x").unwrap();
    let here = format!("{{\"ts\":\"1\",\"path\":\"{}\",\"from\":\"a\"}}", s(&repo.join("docs/here.md")));
    let moved = format!("{{\"ts\":\"2\",\"path\":\"{}\",\"from\":\"b\",\"at\":{{\"line\":3}}}}", s(&repo.join(".claude/worktrees/mobile/docs/drafts/v1.html")));
    let gone = format!("{{\"ts\":\"3\",\"path\":\"{}\"}}", s(&repo.join(".claude/worktrees/mobile/docs/x.md")));
    let log = format!("{here}\n깨진 줄\n{moved}\n{{\"ts\":\"4\",\"path\":\"https://a.b/c\"}}\n{gone}\n");
    let out = resolve_show_log(&log, &home);
    let lines: Vec<&str> = out.lines().collect();
    // 있는 줄·깨진 줄·웹 주소는 글자 그대로
    assert_eq!(lines[0], here);
    assert_eq!(lines[1], "깨진 줄");
    assert_eq!(lines[3], "{\"ts\":\"4\",\"path\":\"https://a.b/c\"}");
    // 옮긴 줄 — path 만 바뀌고 나머지(from·at·순서)는 그대로
    let v: serde_json::Value = serde_json::from_str(lines[2]).unwrap();
    assert_eq!(v["path"], s(&repo.join("docs/drafts/v1.html")));
    assert_eq!(v["from"], "b");
    assert_eq!(v["at"]["line"], 3);
    assert!(v.get("gone").is_none());
    let g: serde_json::Value = serde_json::from_str(lines[4]).unwrap();
    assert_eq!(g["gone"], true);
    assert!(out.ends_with('\n'));
}
