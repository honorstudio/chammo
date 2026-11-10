use super::*;

/// 가짜 디스크 한 벌 — home 은 /x/home, 홈 밖 '다른 드라이브'는 /x/D (맥 temp 는 /private/var 라 실제 자리로)
struct Disk {
    top: PathBuf,
    home: PathBuf,
    d: PathBuf,
    attach: PathBuf,
}
impl Disk {
    fn new(name: &str) -> Disk {
        let top = std::fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("chammo-outside-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&top);
        let (home, d) = (top.join("home"), top.join("D"));
        let attach = home.join(".chammo/attach");
        for p in [&home.join("dev"), &d.join("Desktop/보고"), &attach] {
            std::fs::create_dir_all(p).unwrap();
        }
        Disk { top, home, d, attach }
    }
    fn hs(&self) -> String {
        self.home.to_string_lossy().into_owned()
    }
}
impl Drop for Disk {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.top);
    }
}

#[test]
fn 설정에서_연_폴더는_홈_밖_드라이브도_받고_홈을_품은_곳은_안_받는다() {
    let k = Disk::new("roots");
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let open = vec![
        s(&k.d),                     // 다른 드라이브 맨 위(D:\) — 받는다
        s(&k.d.join("Desktop")),     // 그 안 — 이미 D 가 있지만 따로 적어도 된다
        s(&k.top),                   // 홈을 품은 곳(C:\ · /Users) — 디스크 통째라 안 받는다
        "/".into(),                  // 맨 위
        s(&k.home),                  // 홈 자체 — 이미 열려 있다
        s(&k.home.join("dev")),      // 홈 안 — 이미 열려 있다
        s(&k.top.join("없는 폴더")), // 없는 폴더
        "  ".into(),
        s(&k.d),                     // 겹침
    ];
    assert_eq!(open_roots(&k.home, &open, &k.hs()), vec![k.d.clone(), k.d.join("Desktop")]);
    // ~ 모양도 푼다(홈 안이라 빠지는 것까지)
    assert!(open_roots(&k.home, &["~/dev".into()], &k.hs()).is_empty());
}

#[test]
fn 홈_밖_파일은_첨부_사본으로_원본은_그대로() {
    let k = Disk::new("copy");
    let f = k.d.join("Desktop/보고/매출 11월.xlsx");
    std::fs::write(&f, "엑셀").unwrap();
    let roots = vec![k.home.clone()];
    let (p, copied) = give(&f, &roots, &k.attach, 1_700_000_000_000).unwrap();
    assert!(copied);
    assert_eq!(p.parent(), Some(k.attach.as_path()), "사본은 <데이터>/attach 에");
    assert_eq!(p.file_name().unwrap().to_string_lossy(), "1700000000000-매출_11월.xlsx", "시각-이름(save_attach 와 같은 이름 규칙)");
    assert_eq!(std::fs::read_to_string(&p).unwrap(), "엑셀");
    assert_eq!(std::fs::read_to_string(&f).unwrap(), "엑셀", "원본은 그대로");
    // 같은 시각에 또 — 덮어쓰지 않고 옆 이름
    let (p2, _) = give(&f, &roots, &k.attach, 1_700_000_000_000).unwrap();
    assert_ne!(p2, p);
    assert_eq!(std::fs::read_to_string(&p).unwrap(), "엑셀");
}

#[test]
fn 열_수_있는_곳의_파일과_폴더는_그대로() {
    let k = Disk::new("asis");
    let f = k.home.join("dev/a.md");
    std::fs::write(&f, "a").unwrap();
    let g = k.d.join("Desktop/보고/b.pdf");
    std::fs::write(&g, "b").unwrap();
    // 홈 안
    assert_eq!(give(&f, &[k.home.clone()], &k.attach, 1).unwrap(), (f.clone(), false));
    // 설정에서 연 드라이브 안 — 원본 그대로(사본 없음)
    assert_eq!(give(&g, &[k.home.clone(), k.d.clone()], &k.attach, 1).unwrap(), (g.clone(), false));
    // 폴더는 어디든 그대로(사본을 안 뜬다)
    assert_eq!(give(&k.d.join("Desktop/보고"), &[k.home.clone()], &k.attach, 1).unwrap(), (k.d.join("Desktop/보고"), false));
    assert_eq!(std::fs::read_dir(&k.attach).unwrap().count(), 0, "사본 없음");
}

#[test]
fn 홈_안_링크가_밖을_가리키면_밖으로_본다() {
    let k = Disk::new("link");
    let g = k.d.join("Desktop/보고/c.txt");
    std::fs::write(&g, "c").unwrap();
    let l = k.home.join("dev/c.txt");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&g, &l).unwrap();
    #[cfg(unix)]
    {
        let (p, copied) = give(&l, &[k.home.clone()], &k.attach, 2).unwrap();
        assert!(copied, "링크를 푼 진짜 자리가 홈 밖 — 사본으로");
        assert!(p.starts_with(&k.attach));
    }
}

#[test]
fn 못_붙이는_것은_이유를_돌려준다() {
    let k = Disk::new("bad");
    let roots = vec![k.home.clone()];
    let e = give(Path::new("rel/a.txt"), &roots, &k.attach, 1).unwrap_err();
    assert!(e.contains("rel/a.txt"), "{e}");
    let e = give(&k.d.join("없음.xlsx"), &roots, &k.attach, 1).unwrap_err();
    assert!(e.contains("없음.xlsx"), "{e}");
    // 큰 파일 — 사본 대신 폴더를 열어 달라고(희소 파일이라 디스크는 안 쓴다)
    let big = k.d.join("Desktop/촬영본.mov");
    std::fs::File::create(&big).unwrap().set_len(COPY_MAX + 1).unwrap();
    let e = give(&big, &roots, &k.attach, 1).unwrap_err();
    assert!(e.contains("촬영본.mov") && e.contains("500"), "{e}");
    assert_eq!(std::fs::read_dir(&k.attach).unwrap().count(), 0, "실패하면 조각도 안 남는다");
    // 딱 끝 크기는 된다
    let edge = k.d.join("Desktop/끝.bin");
    std::fs::File::create(&edge).unwrap().set_len(COPY_MAX).unwrap();
    assert!(give(&edge, &roots, &k.attach, 1).unwrap().1);
}

#[test]
fn 같은_파일을_또_붙이면_앞_사본을_다시_쓰고_고치면_새로() {
    let k = Disk::new("cache");
    let f = k.d.join("Desktop/보고/d.txt");
    std::fs::write(&f, "1").unwrap();
    let roots = vec![k.home.clone()];
    let (a, _) = give_cached(&f, &roots, &k.attach).unwrap();
    let (b, _) = give_cached(&f, &roots, &k.attach).unwrap();
    assert_eq!(a, b, "같은 사본 — #file 번호가 새로 안 붙는다");
    std::fs::write(&f, "22").unwrap(); // 크기가 바뀌었다
    let (c, _) = give_cached(&f, &roots, &k.attach).unwrap();
    assert_ne!(c, a);
    assert_eq!(std::fs::read_to_string(&c).unwrap(), "22");
    std::fs::remove_file(&c).unwrap(); // 사본이 지워졌으면 새로
    let (e, _) = give_cached(&f, &roots, &k.attach).unwrap();
    assert!(e.is_file());
}

#[test]
fn 열_수_있는_곳은_링크를_푼_자리로도_비교하고_사본_기억보다_먼저() {
    let k = Disk::new("canon");
    let f = k.d.join("Desktop/보고/e.txt");
    std::fs::write(&f, "e").unwrap();
    // roots 가 링크(맥 /var → /private/var 같은)여도 홈 안 파일은 그대로
    #[cfg(unix)]
    {
        let alias = k.top.join("alias-home");
        std::os::unix::fs::symlink(&k.home, &alias).unwrap();
        let g = k.home.join("dev/g.md");
        std::fs::write(&g, "g").unwrap();
        assert_eq!(give(&g, &[alias.clone()], &k.attach, 1).unwrap(), (g.clone(), false));
    }
    // 처음엔 사본 — 그 뒤 사람이 D 를 열면 같은 파일도 원래 경로(앞 사본 기억을 안 쓴다)
    let (a, copied) = give_cached(&f, &[k.home.clone()], &k.attach).unwrap();
    assert!(copied && a.starts_with(&k.attach));
    assert_eq!(give_cached(&f, &[k.home.clone(), k.d.clone()], &k.attach).unwrap(), (f.clone(), false));
}
