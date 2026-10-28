use super::*;

#[test]
fn 소켓_알림이_화면이_본_판보다_새로우면_바뀜() {
    assert!(!changed("tA"));
    nudge("tA", 3);
    assert!(changed("tA"));
    seen_rev("tA", 3);
    assert!(!changed("tA"));
    nudge("tA", 2); // 늦게 온 옛 알림
    assert!(!changed("tA"));
    nudge("", 9);
    assert!(!changed(""));
}

#[test]
fn 실패한_올리기만_치운다() {
    UPLOADS.lock().unwrap().extend([
        Upload { local: "u1".into(), team: "tB".into(), kind: "file".into(), total: 10, done: 3, ..Default::default() },
        Upload { local: "u2".into(), team: "tB".into(), kind: "file".into(), total: 10, done: 3, error: "x".into(), ..Default::default() },
    ]);
    dismiss("u1");
    dismiss("u2");
    let left: Vec<_> = uploads("tB").into_iter().map(|u| u.local).collect();
    assert_eq!(left, vec!["u1"], "올리는 중인 건 닫기로 안 사라진다");
}

#[test]
fn 앱_안쪽_올리기_프로필_사진_팀_홈_글은_올리는_중_줄로_안_보인다() {
    // 10-28 사용자: 프로필을 바꾸면 팀 보관함에 'profile.json 112B' 카드가 떴다 — 올리는 중 줄엔 kind 가 없어서 다 보였다
    UPLOADS.lock().unwrap().extend([
        Upload { local: "k1".into(), team: "tK".into(), kind: "file".into(), name: "견적.pdf".into(), total: 10, ..Default::default() },
        Upload { local: "k2".into(), team: "tK".into(), kind: "profile".into(), name: "profile.json".into(), total: 112, error: "x".into(), ..Default::default() },
        Upload { local: "k3".into(), team: "tK".into(), kind: "avatar".into(), name: "photo.png".into(), total: 9, ..Default::default() },
        Upload { local: "k4".into(), team: "tK".into(), kind: "post".into(), name: "post.json".into(), total: 9, ..Default::default() },
        Upload { local: "k5".into(), team: "tK".into(), kind: "file".into(), room: "r1".into(), name: "대화.png".into(), total: 9, ..Default::default() },
    ]);
    let left: Vec<_> = uploads("tK").into_iter().map(|u| u.local).collect();
    assert_eq!(left, vec!["k1", "k5"], "사람이 올린 파일(대화 첨부 포함)만");
}

#[test]
fn 로그인_안_한_기기는_팀_보관함을_못_쓴다() {
    let d = std::env::temp_dir().join(format!("chammo-lk-app-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    let kc = crate::accounts_store::fake::Fake::default();
    let e = list(&d, &kc, &crate::team_test_util::FakeRelay::default(), "t1").unwrap_err();
    assert!(e.contains("로그인"));
}

#[test]
fn 참모_길은_id_나_꼭_맞는_이름_하나로_고른다() {
    let it = |id: &str, name: &str, folder: &str| Item { id: id.into(), name: name.into(), folder: folder.into(), kind: "file".into(), state: "live".into(), ..Default::default() };
    let v = View { items: vec![it("f1", "견적서.pdf", "견적"), it("f2", "견적서.pdf", ""), it("f3", "a.png", ""), Item { state: "trash".into(), ..it("f4", "b.png", "") }], ..Default::default() };
    assert_eq!(resolve(&v, "f3").unwrap(), "f3");
    assert_eq!(resolve(&v, "a.png").unwrap(), "f3");
    assert_eq!(resolve(&v, "견적/견적서.pdf").unwrap(), "f1");
    assert!(resolve(&v, "견적서.pdf").unwrap_err().contains("2개"));
    assert!(resolve(&v, "b.png").is_err(), "휴지통 파일은 이름으로 안 고른다");
    assert!(resolve(&v, "없음").is_err());
}

fn tmpd(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-lk-view-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn aged(p: &Path, secs: u64) {
    let f = std::fs::File::options().write(true).open(p).unwrap();
    f.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(secs)).unwrap();
}

#[test]
fn 풀어_둔_평문은_데이터_폴더_안_나만_여는_자리() {
    let d = tmpd("root");
    let v = view_dir(&d, "t1").unwrap();
    assert!(v.starts_with(d.join(VIEW_DIR)), "사용자 폴더(~/Documents)가 아니라 데이터 폴더 아래");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(d.join(VIEW_DIR)).unwrap().permissions().mode() & 0o777, 0o700);
    }
    assert!(view_dir(&d, "../x").is_err(), "팀 id 로 자리 밖에 못 나간다");
}

#[test]
fn 오래된_평문만_지우고_빈_폴더도_치운다() {
    let d = tmpd("sweep");
    let root = d.join(VIEW_DIR);
    std::fs::create_dir_all(root.join("t1/대화 파일")).unwrap();
    std::fs::create_dir_all(root.join("t2")).unwrap();
    let old = root.join("t1/대화 파일/옛.txt");
    let new = root.join("t2/새.png");
    std::fs::write(&old, b"x").unwrap();
    std::fs::write(&new, b"y").unwrap();
    aged(&old, VIEW_KEEP.as_secs() + 60);
    assert_eq!(sweep(&root, VIEW_KEEP, std::time::SystemTime::now()), 1);
    assert!(!old.exists() && new.exists());
    assert!(!root.join("t1").exists(), "빈 폴더는 치운다");
    assert!(root.exists(), "뿌리는 남긴다");
}

#[test]
fn 다시_쓴_평문은_새로_쓴_것으로_친다() {
    let d = tmpd("touch");
    let p = d.join("a.txt");
    std::fs::write(&p, b"x").unwrap();
    aged(&p, VIEW_KEEP.as_secs() + 60);
    touch(&p);
    assert_eq!(sweep(&d, VIEW_KEEP, std::time::SystemTime::now()), 0);
    assert!(p.exists());
}

#[test]
fn 내려받기는_풀어_둔_자리_안_파일만_다운로드로_복사한다() {
    let d = tmpd("copy");
    let v = view_dir(&d, "t1").unwrap();
    let src = v.join("회의록.txt");
    std::fs::write(&src, b"hello").unwrap();
    let out = d.join("Downloads");
    std::fs::create_dir_all(&out).unwrap();
    std::fs::write(out.join("회의록.txt"), b"old").unwrap();
    let got = copy_out(&d, &src, &out).unwrap();
    assert_eq!(got.file_name().unwrap(), "회의록 2.txt", "있던 파일은 안 덮는다");
    assert_eq!(std::fs::read(&got).unwrap(), b"hello");
    let outside = d.join("비밀.txt");
    std::fs::write(&outside, b"s").unwrap();
    assert!(copy_out(&d, &outside, &out).is_err(), "풀어 둔 자리 밖 파일은 못 꺼낸다");
    assert!(copy_out(&d, &v.join("../../비밀.txt"), &out).is_err(), "../ 로 빠져나가도 못 꺼낸다");
}

#[test]
fn 마지막_목록은_기기_열쇠로_봉해_두고_그_기기만_다시_연다() {
    let d = tmpd("vcache");
    let k = crate::team_relay_keys::DeviceKeys::from_seeds([7; 32], [8; 32]);
    let v = View { rev: 3, items: vec![Item { id: "f1".into(), name: "견적서.pdf".into(), folder: "계약".into(), size: 10, ..Default::default() }], ..Default::default() };
    save_view(&d, &k, "t1", &v);
    let raw = std::fs::read(view_cache_path(&d, "t1")).unwrap();
    assert!(!String::from_utf8_lossy(&raw).contains("견적서") && !String::from_utf8_lossy(&raw).contains("계약"), "이름·폴더는 봉한 채로만");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(view_cache_path(&d, "t1")).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let got = read_view(&d, &k, "t1").unwrap();
    assert_eq!((got.rev, got.items.clone()), (3, v.items.clone()));
    let other = crate::team_relay_keys::DeviceKeys::from_seeds([9; 32], [9; 32]);
    assert!(read_view(&d, &other, "t1").is_none(), "다른 기기 열쇠로는 안 열린다");
    assert!(read_view(&d, &k, "t2").is_none(), "다른 팀 자리는 없다");
    std::fs::write(view_cache_path(&d, "t1"), b"broken").unwrap();
    assert!(read_view(&d, &k, "t1").is_none(), "깨진 파일은 없는 것처럼");
}

#[test]
fn 사람_목록은_10분만_다시_쓴다() {
    assert!(people_fresh(std::time::Duration::from_secs(599)));
    assert!(!people_fresh(std::time::Duration::from_secs(601)));
}

#[test]
fn 모르는_서명_기기나_열쇠가_나오면_사람_목록을_새로_받는다() {
    assert!(stale_people("올린 기기를 믿을 수 없어(팀 명부·사슬 밖)"));
    assert!(stale_people("이름 붙인 기기를 믿을 수 없어"));
    assert!(!stale_people("이 기기 몫 열쇠가 아직 없어 — 다른 팀원 앱이 켜지면 채워져"));
    assert!(!stale_people("크기가 서명과 달라"));
}

fn memo_file(id: &str, at: u64, size: u64, name: &str) -> (RemoteFile, core::Opened) {
    (RemoteFile { id: id.into(), parts: 1, size: size + 32, state: "live".into(), ..Default::default() }, core::Opened { k: [3; 32], meta: core::Meta { name: name.into(), size, at, folder: String::new(), dir: false } })
}

#[test]
fn 목록에서_연_파일은_기억해_두고_새_판이_알려지면_안_쓴다() {
    remember("tM", 5, &[memo_file("f1", 1, 3, "a.txt")]);
    assert_eq!(recall("tM", "f1").map(|(_, o)| o.meta.name), Some("a.txt".into()));
    assert!(recall("tM", "f2").is_none(), "목록에 없던 파일");
    assert!(recall("tX", "f1").is_none(), "다른 팀");
    nudge("tM", 6); // 소켓이 새 판(누가 지우거나 이름을 바꿈)
    assert!(recall("tM", "f1").is_none(), "새 판이 알려지면 다시 받는다");
    remember("tM", 6, &[memo_file("f1", 2, 3, "b.txt")]);
    assert_eq!(recall("tM", "f1").map(|(_, o)| o.meta.name), Some("b.txt".into()));
    forget("tM");
    assert!(recall("tM", "f1").is_none(), "내가 고치면 지운다");
}

#[test]
fn 기억은_10분만_쓴다() {
    assert!(memo_fresh(std::time::Duration::from_secs(9 * 60)));
    assert!(!memo_fresh(std::time::Duration::from_secs(11 * 60)));
}

/// 구글로 로그인하고 팀 tV 에 든 기기 — 열쇠는 가짜 키체인, 중계는 받은 요청을 적는 가짜
fn in_team(tag: &str) -> (PathBuf, crate::accounts_store::fake::Fake, crate::team_test_util::FakeRelay) {
    let d = tmpd(tag);
    let kc = crate::accounts_store::fake::Fake::default();
    let (_, account) = crate::team_relay_keys::create(&kc).unwrap();
    relay::mutate(&d, |s| {
        s.server = "https://relay.test".into();
        s.key_account = account;
        s.device_id = "d7".into();
        s.account = Some(relay::Account { id: "a1".into(), email: "me@example.com".into(), name: "지수".into() });
        s.teams = vec![relay::TeamEntry { id: "tV".into(), name: "ACME".into(), member_id: "m1".into(), role: "owner".into(), ..Default::default() }];
        s.team_id = "tV".into();
    })
    .unwrap();
    (d, kc, crate::team_test_util::FakeRelay::default())
}

#[test]
fn 목록에서_본_파일을_다시_열면_중계에_안_묻는다() {
    let (d, kc, r) = in_team("memo-open");
    remember("tV", 1, &[memo_file("f9", 77, 5, "회의록.txt")]);
    // 전에 풀어 둔 평문 + 받은 자리 기록(같은 파일·같은 판이면 그대로 쓴다)
    let vd = view_dir(&d, "tV").unwrap();
    std::fs::write(vd.join("회의록.txt"), b"hello").unwrap();
    let cache = json!({ format!("f9:77:{}", vd.display()): vd.join("회의록.txt").to_string_lossy() });
    std::fs::write(d.join(CACHE), cache.to_string()).unwrap();
    assert_eq!(view(&d, &kc, &r, "tV", "f9").unwrap(), vd.join("회의록.txt"));
    assert_eq!(peek(&d, &kc, &r, "tV", "f9").unwrap(), vd.join("회의록.txt"));
    assert!(r.seen.borrow().is_empty(), "목록·사람 목록을 다시 받지 않는다: {:?}", r.seen.borrow().iter().map(|s| s.1.clone()).collect::<Vec<_>>());
}

// ── 내 참모에게(10-26 사용자 "보관함에서 내 참모들한테 주고 수정 시키려는데 안 된다") ──

#[test]
fn 내_참모에게는_그_참모_보관함_팀_보관함_팀이름_아래에_푼다() {
    let (d, kc, r) = in_team("give");
    relay::mutate(&d, |s| s.team_name = "ACME".into()).unwrap(); // 지금 팀 칸 이름(진짜 상태는 늘 있다)
    remember("tV", 1, &[memo_file("f9", 77, 5, "회의록.txt")]);
    let root = d.join("Chammo");
    let owner = crate::locker_fs::owner_dir(&root, "o1", "참모").unwrap();
    let to = give_dir(&owner, "ACME", "tV");
    assert_eq!(to, owner.join(GIVE_DIR).join("ACME"));
    // 같은 판을 전에 준 자리 — 그대로 쓴다(중계를 안 부르고 같은 파일)
    std::fs::create_dir_all(&to).unwrap();
    std::fs::write(to.join("회의록.txt"), b"hello").unwrap();
    std::fs::write(d.join(CACHE), json!({ format!("f9:77:{}", to.display()): to.join("회의록.txt").to_string_lossy() }).to_string()).unwrap();
    let got = give(&d, &kc, &r, "tV", "f9", &root, "o1", "참모").unwrap();
    assert_eq!(got, to.join("회의록.txt"));
    assert!(got.starts_with(&root), "참모 보관함 안 — 데이터 폴더(풀어 두기 자리) 밖이라 청소에 안 지워진다");
    assert!(!got.starts_with(view_dir(&d, "tV").unwrap()));
}

#[test]
fn 팀_이름이_폴더로_못_쓰는_글이면_고쳐_쓰고_비면_팀_id() {
    let o = Path::new("/x/참모");
    assert_eq!(give_dir(o, "A/B", "tV"), o.join(GIVE_DIR).join(crate::locker_fs::safe_name("A/B", "")));
    for bad in ["../..", "..", ".hidden"] {
        let g = give_dir(o, bad, "tV");
        assert!(g.starts_with(o.join(GIVE_DIR)) && g.components().count() == o.join(GIVE_DIR).components().count() + 1, "{bad:?} → {g:?}");
        assert!(!g.components().any(|c| c == std::path::Component::ParentDir) && !g.file_name().unwrap().to_string_lossy().starts_with('.'), "{bad:?} → {g:?}");
    }
    assert_eq!(give_dir(o, "  ", "tV"), o.join(GIVE_DIR).join("tV"));
}

#[test]
fn 팀_폴더나_이상한_참모_id_로는_안_준다() {
    let (d, kc, r) = in_team("give-bad");
    let root = d.join("Chammo");
    for bad in ["team-tV", "", "../x", "a/b", ".hid"] {
        assert!(give(&d, &kc, &r, "tV", "f9", &root, bad, "참모").is_err(), "{bad:?}");
    }
    assert!(!root.join("참모").exists(), "거절하면 참모 폴더도 안 만든다");
    assert!(give(&d, &kc, &r, "없는팀", "f9", &root, "o1", "참모").is_err(), "모르는 팀");
}

#[test]
fn 풀어_둔_팀_파일_경로로도_참모_보관함에_준다_같은_내용이면_같은_파일() {
    let (d, _kc, _r) = in_team("give-path");
    relay::mutate(&d, |s| s.team_name = "ACME".into()).unwrap();
    let root = d.join("Chammo");
    let vd = view_dir(&d, "tV").unwrap();
    std::fs::create_dir_all(vd.join("주간회의")).unwrap();
    std::fs::write(vd.join("주간회의/안.pdf"), b"pdf1").unwrap();
    let got = give_path(&d, &vd.join("주간회의/안.pdf"), &root, "o1", "참모").unwrap();
    let owner = crate::locker_fs::owner_dir(&root, "o1", "참모").unwrap();
    assert_eq!(got, owner.join(GIVE_DIR).join("ACME/주간회의/안.pdf"), "팀 폴더 자리 그대로");
    assert_eq!(std::fs::read(&got).unwrap(), b"pdf1");
    assert_eq!(give_path(&d, &vd.join("주간회의/안.pdf"), &root, "o1", "참모").unwrap(), got, "또 줘도 같은 파일");
    // 참모가 고쳐 둔 것은 안 덮는다 — 새 이름으로
    std::fs::write(&got, b"edited").unwrap();
    let again = give_path(&d, &vd.join("주간회의/안.pdf"), &root, "o1", "참모").unwrap();
    assert_ne!(again, got);
    assert_eq!(std::fs::read(&got).unwrap(), b"edited");
}

#[test]
fn 경로_주기의_같은_내용_비교는_통째로_안_읽는다() {
    // 10-27 리뷰 — 큰 파일(수 GB 영상)을 줄 때마다 두 파일을 통째로 메모리에 읽어 비교했다. 크기 먼저, 같을 때만 조각으로(locker_fs::same_content)
    let src = include_str!("team_locker_app.rs");
    let body = src.split("pub fn give_path(").nth(1).unwrap().split("\n}\n").next().unwrap();
    assert!(!body.contains("std::fs::read("), "통째 읽기 없음");
    assert!(body.contains("same_content("));
    // 크기가 같고 내용이 다르면 새 이름 — 끝 바이트만 다른 것도
    let (d, _kc, _r) = in_team("give-path-cmp");
    let root = d.join("Chammo");
    let vd = view_dir(&d, "tV").unwrap();
    let mut big = vec![7u8; 200 * 1024];
    std::fs::write(vd.join("v.bin"), &big).unwrap();
    let got = give_path(&d, &vd.join("v.bin"), &root, "o1", "참모").unwrap();
    assert_eq!(give_path(&d, &vd.join("v.bin"), &root, "o1", "참모").unwrap(), got, "같은 내용이면 같은 파일");
    *big.last_mut().unwrap() = 8;
    std::fs::write(vd.join("v.bin"), &big).unwrap();
    assert_ne!(give_path(&d, &vd.join("v.bin"), &root, "o1", "참모").unwrap(), got, "끝 바이트만 달라도 새 이름");
}

#[test]
fn 풀어_둔_자리_밖이나_팀_폴더로는_경로_주기를_거절한다() {
    let (d, _kc, _r) = in_team("give-path-bad");
    let root = d.join("Chammo");
    let vd = view_dir(&d, "tV").unwrap();
    std::fs::write(vd.join("a.txt"), b"a").unwrap();
    std::fs::write(d.join("team.json.bak"), b"x").unwrap();
    assert!(give_path(&d, &d.join("team.json.bak"), &root, "o1", "참모").is_err(), "데이터 폴더 다른 파일");
    assert!(give_path(&d, &vd.join("../tV/../../team.json.bak"), &root, "o1", "참모").is_err(), "../ 로 빠져나가기");
    assert!(give_path(&d, &vd.join("a.txt"), &root, "team-tV", "ACME").is_err(), "팀 폴더");
    assert!(give_path(&d, &vd, &root, "o1", "참모").is_err(), "폴더");
    let other = view_dir(&d, "tZ").unwrap();
    std::fs::write(other.join("b.txt"), b"b").unwrap();
    assert!(give_path(&d, &other.join("b.txt"), &root, "o1", "참모").is_err(), "내 팀이 아닌 자리");
}
