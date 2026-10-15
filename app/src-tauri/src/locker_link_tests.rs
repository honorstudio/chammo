use super::*;
use crate::locker_fs::{self, Ctx, Owner};
use std::path::{Path, PathBuf};

/// 맥 temp 는 /var → /private/var 링크라 실제 위치로 잡는다
fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-lockerlink-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::canonicalize(d).unwrap()
}

/// 가짜 홈 한 벌 — 진짜 바탕화면·문서 폴더는 안 건드린다
struct W {
    home: PathBuf,
    data: PathBuf,
    root: PathBuf,
    owner: PathBuf,
}
impl W {
    fn new(name: &str) -> W {
        let home = tmp(name);
        let data = home.join(".chammo");
        std::fs::create_dir_all(data.join("attach")).unwrap();
        let root = home.join("Documents/Chammo");
        let owner = locker_fs::owner_dir(&root, "s-1", "운영").unwrap();
        W { home, data, root, owner }
    }
    fn ctx(&self) -> Ctx<'_> {
        Ctx { home: &self.home, data: &self.data, root: &self.root, settled: &[] }
    }
}

fn put(p: &Path, body: &str) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn at_time(p: &Path, secs: u64) {
    let f = std::fs::OpenOptions::new().write(true).open(p).unwrap();
    f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs)).unwrap();
}

/// 휴지통 지킴 — 지킬 자리 없음, 폴더 확인 받음(옛 시험들은 낱개 폴더도 지운다)
const G_OK: crate::locker_trash::Guard<'static> = crate::locker_trash::Guard { keep: &[], folders_ok: true };

fn rels(es: &[locker_fs::Entry]) -> Vec<String> {
    es.iter().map(|e| e.rel.clone()).collect()
}

// ── 연결 ──

#[test]
fn connect_makes_a_live_link_without_copying() {
    let w = W::new("live");
    let shots = w.home.join("Pictures/찍은것");
    put(&shots.join("a.png"), "A");
    let at = connect(&w.ctx(), &w.owner, "", &shots, None).unwrap();
    assert_eq!(at, w.owner.join("찍은것"));
    assert!(std::fs::symlink_metadata(&at).unwrap().file_type().is_symlink(), "보관함 안엔 바로가기만");
    let es = locker_fs::tree_in(&w.owner, Some(&w.home));
    let top = es.iter().find(|e| e.rel == "찍은것").unwrap();
    assert!(top.dir && top.linked && !top.gone && !top.ro);
    let a = es.iter().find(|e| e.rel == "찍은것/a.png").unwrap();
    assert!(a.ro && !a.dir && a.link.is_none());
    // 새 파일이 생기면 다음에 읽을 때 바로 뜬다 — 원본은 복사하지 않는다
    put(&shots.join("b.png"), "B");
    assert!(rels(&locker_fs::tree_in(&w.owner, Some(&w.home))).contains(&"찍은것/b.png".to_string()));
    assert!(!w.owner.join("a.png").exists(), "복사 없음");
}

#[test]
fn connected_children_are_newest_first() {
    let w = W::new("newest");
    let d = w.home.join("Desktop/스크린샷");
    for (n, t) in [("old.png", 100), ("new.png", 300), ("mid.png", 200)] {
        put(&d.join(n), n);
        at_time(&d.join(n), t);
    }
    put(&d.join("sub/x.png"), "x");
    connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    let es = locker_fs::tree_in(&w.owner, Some(&w.home));
    let kids: Vec<_> = es.iter().filter_map(|e| e.rel.strip_prefix("스크린샷/").filter(|r| !r.contains('/')).map(|_| e.name.clone())).collect();
    assert_eq!(kids, vec!["sub", "new.png", "mid.png", "old.png"], "폴더 먼저, 그 뒤 최신이 맨 앞");
}

#[test]
fn hidden_and_inner_symlinks_are_not_listed() {
    let w = W::new("hid");
    let d = w.home.join("Pictures/p");
    put(&d.join("ok.png"), "x");
    put(&d.join(".secret"), "x");
    std::os::unix::fs::symlink(w.home.join("Pictures"), d.join("loop")).unwrap();
    connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    let r = rels(&locker_fs::tree_in(&w.owner, Some(&w.home)));
    assert!(r.contains(&"p/ok.png".to_string()));
    assert!(!r.iter().any(|x| x.contains(".secret") || x.contains("loop")));
}

#[test]
fn connecting_the_same_folder_twice_gives_the_same_link() {
    let w = W::new("twice");
    let d = w.home.join("Pictures/p");
    put(&d.join("a.png"), "x");
    let a = connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    let b = connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    assert_eq!(a, b);
    assert_eq!(std::fs::read_dir(&w.owner).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with('p')).count(), 1);
}

#[test]
fn same_name_gets_a_number() {
    let w = W::new("num");
    put(&w.home.join("a/사진/1.png"), "1");
    put(&w.home.join("b/사진/2.png"), "2");
    let x = connect(&w.ctx(), &w.owner, "", &w.home.join("a/사진"), None).unwrap();
    let y = connect(&w.ctx(), &w.owner, "", &w.home.join("b/사진"), None).unwrap();
    assert_eq!(x.file_name().unwrap(), "사진");
    assert_eq!(y.file_name().unwrap(), "사진 2");
}

#[test]
fn connect_into_a_locker_subfolder() {
    let w = W::new("sub");
    let d = w.home.join("Pictures/p");
    put(&d.join("a.png"), "x");
    let at = connect(&w.ctx(), &w.owner, "자료", &d, None).unwrap();
    assert_eq!(at, w.owner.join("자료/p"));
    assert!(rels(&locker_fs::tree_in(&w.owner, Some(&w.home))).contains(&"자료/p/a.png".to_string()));
}

// ── 보안 ──

#[test]
fn rejects_unsafe_folders() {
    let w = W::new("sec");
    let outside = tmp("sec-outside");
    put(&outside.join("x"), "x");
    let ok = w.home.join("Pictures/p");
    put(&ok.join("a.png"), "x");
    let bad: Vec<(&str, PathBuf)> = vec![
        ("홈 밖", outside.clone()),
        ("홈 자체", w.home.clone()),
        ("점 폴더(.ssh)", w.home.join(".ssh")),
        ("점 폴더 안", w.home.join(".config/gh")),
        ("라이브러리", w.home.join("Library/Keychains")),
        ("데이터 폴더", w.data.clone()),
        ("보관함 뿌리", w.root.clone()),
        ("보관함 참모 폴더", w.owner.clone()),
        ("뿌리를 품은 문서 폴더", w.home.join("Documents")),
        ("파일", ok.join("a.png")),
        ("없는 폴더", w.home.join("없음")),
        ("상대 경로", PathBuf::from("Pictures/p")),
        ("점점", w.home.join("Pictures/../.ssh")),
    ];
    for d in ["Library/Keychains", ".ssh", ".config/gh"] {
        std::fs::create_dir_all(w.home.join(d)).unwrap();
    }
    for (why, p) in bad {
        assert!(connect(&w.ctx(), &w.owner, "", &p, None).is_err(), "거절해야 해: {why} {}", p.display());
    }
    // 홈 안 링크가 홈 밖으로 새는 것도 풀어서 거절
    let esc = w.home.join("Pictures/새는링크");
    std::os::unix::fs::symlink(&outside, &esc).unwrap();
    assert!(connect(&w.ctx(), &w.owner, "", &esc, None).is_err(), "링크를 풀어 홈 밖이면 거절");
    // 점 폴더로 가는 홈 안 링크도 거절
    let esc2 = w.home.join("Pictures/ssh링크");
    std::os::unix::fs::symlink(w.home.join(".ssh"), &esc2).unwrap();
    assert!(connect(&w.ctx(), &w.owner, "", &esc2, None).is_err(), "민감 폴더로 가는 링크 거절");
    assert!(connect(&w.ctx(), &w.owner, "", &ok, None).is_ok());
}

#[test]
fn contents_are_read_only() {
    let w = W::new("ro");
    let d = w.home.join("Pictures/p");
    put(&d.join("a.png"), "x");
    connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    // 안쪽 파일·폴더는 이름 바꾸기·옮기기·휴지통·새 폴더·넣기가 전부 거절 — 원본은 집이다
    assert!(locker_fs::rename_entry(&w.owner, "p/a.png", "b.png").is_err());
    assert!(locker_fs::move_entry(&w.owner, "p/a.png", "자료").is_err());
    assert!(locker_fs::remove(&w.owner, "p/a.png", &w.home.join(".Trash")).is_err());
    assert!(locker_fs::mkdir(&w.owner, "p", "새").is_err());
    let src = w.home.join("Desktop/in.txt");
    put(&src, "in");
    assert!(locker_fs::add(&w.ctx(), &w.owner, "p", &src).is_err(), "연결 폴더 안으로 넣기 거절");
    assert!(locker_fs::new_doc(&w.owner, "p", "md", "x").is_err());
    assert!(locker_fs::move_entry(&w.owner, "자료", "p").is_err(), "연결 폴더 안으로 옮기기 거절");
    assert_eq!(std::fs::read_to_string(d.join("a.png")).unwrap(), "x");
    assert!(!d.join("in.txt").exists() && !d.join("새").exists());
}

#[test]
fn phone_cannot_remove_or_write_connections() {
    let w = W::new("ph");
    let d = w.home.join("Pictures/p");
    put(&d.join("a.md"), "# x");
    connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    assert!(locker_fs::unalias(&w.owner, "p").is_err(), "폰은 연결을 못 풀어");
    assert!(w.owner.join("p").exists());
    assert!(locker_fs::write_md(&w.owner, &w.owner.join("p/a.md"), "# y").is_err(), "폰은 연결 폴더 글을 못 고쳐");
    assert_eq!(std::fs::read_to_string(d.join("a.md")).unwrap(), "# x");
    // 읽기는 된다 — 폰이 열 길은 진짜 경로로
    let v = locker_fs::phone_view(&w.root, &w.home);
    let items = v["items"].as_array().unwrap();
    let it = items.iter().find(|i| i["rel"] == "p/a.md").unwrap();
    assert_eq!(it["path"].as_str().unwrap(), d.join("a.md").to_string_lossy());
    assert_eq!(it["ro"], true, "폰 화면이 읽기 전용으로 보인다");
    let f = v["folders"].as_array().unwrap().iter().find(|f| f["name"] == "p").unwrap();
    assert_eq!(f["linked"], true);
    assert!(locker_fs::phone_paths(&w.root, &w.home).contains(&d.join("a.md").to_string_lossy().into_owned()));
}

#[test]
fn a_hand_made_folder_link_is_not_followed() {
    let w = W::new("hand");
    let secret = w.home.join(".ssh");
    put(&secret.join("id"), "KEY");
    std::os::unix::fs::symlink(&secret, w.owner.join("몰래")).unwrap();
    let r = rels(&locker_fs::tree_in(&w.owner, Some(&w.home)));
    assert!(!r.iter().any(|x| x.contains("id")), "표식에 없는 폴더 링크는 안 따라간다");
}

#[test]
fn a_retargeted_link_to_a_sensitive_folder_is_not_followed() {
    let w = W::new("retarget");
    let d = w.home.join("Pictures/p");
    put(&d.join("a.png"), "x");
    let at = connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    let secret = w.home.join(".ssh");
    put(&secret.join("id"), "KEY");
    // 링크를 민감 폴더로 바꿔치기 + 표식은 그 글자 그대로 — 그래도 열지 않는다
    std::fs::remove_file(&at).unwrap();
    std::os::unix::fs::symlink(&secret, &at).unwrap();
    std::fs::write(w.owner.join(LINKS), format!("{}\n", secret.display())).unwrap();
    let es = locker_fs::tree_in(&w.owner, Some(&w.home));
    assert!(!rels(&es).iter().any(|x| x.ends_with("/id")));
    assert!(es.iter().find(|e| e.rel == "p").is_some_and(|e| e.gone));
}

// ── 끊기·다시 찾기·풀기 ──

#[test]
fn disconnect_removes_only_the_link() {
    let w = W::new("dis");
    let d = w.home.join("Pictures/p");
    put(&d.join("a.png"), "x");
    connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    disconnect(&w.owner, "p").unwrap();
    assert!(!w.owner.join("p").exists() && std::fs::symlink_metadata(w.owner.join("p")).is_err());
    assert_eq!(std::fs::read_to_string(d.join("a.png")).unwrap(), "x", "원본은 그대로");
    assert!(linked_targets(&w.owner).is_empty());
    // 연결이 아닌 것(진짜 폴더·파일 별칭)은 못 풀어
    assert!(disconnect(&w.owner, "자료").is_err());
    assert!(w.owner.join("자료").is_dir());
    let f = w.home.join("Desktop/f.txt");
    put(&f, "f");
    let al = locker_fs::alias(&w.ctx(), &w.owner, "자료", &f).unwrap();
    assert!(disconnect(&w.owner, "자료/f.txt").is_err());
    assert!(al.exists());
}

#[test]
fn missing_folder_shows_as_gone_and_can_be_found_again() {
    let w = W::new("gone");
    let d = w.home.join("Pictures/p");
    put(&d.join("a.png"), "x");
    connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    std::fs::remove_dir_all(&d).unwrap();
    let es = locker_fs::tree_in(&w.owner, Some(&w.home));
    let top = es.iter().find(|e| e.rel == "p").unwrap();
    assert!(top.dir && top.linked && top.gone, "끊겨도 연결 폴더로 보인다");
    assert!(!rels(&es).iter().any(|r| r.starts_with("p/")));
    // 다시 찾기 — 새 자리로
    let nd = w.home.join("Pictures/옮김");
    put(&nd.join("z.png"), "z");
    reconnect(&w.ctx(), &w.owner, "p", &nd).unwrap();
    let es = locker_fs::tree_in(&w.owner, Some(&w.home));
    assert!(es.iter().find(|e| e.rel == "p").is_some_and(|e| !e.gone && e.linked));
    assert!(rels(&es).contains(&"p/z.png".to_string()));
    assert_eq!(linked_targets(&w.owner), vec![nd.to_string_lossy().into_owned()], "옛 표식은 치운다");
    // 연결이 아닌 것은 다시 찾기 못 해
    assert!(reconnect(&w.ctx(), &w.owner, "자료", &nd).is_err());
    assert!(reconnect(&w.ctx(), &w.owner, "p", &w.home.join(".ssh")).is_err());
}

#[test]
fn renaming_and_moving_the_link_keeps_the_connection() {
    let w = W::new("mv");
    let d = w.home.join("Pictures/p");
    put(&d.join("a.png"), "x");
    connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    locker_fs::rename_entry(&w.owner, "p", "내 사진").unwrap();
    locker_fs::move_entry(&w.owner, "내 사진", "자료").unwrap();
    assert!(rels(&locker_fs::tree_in(&w.owner, Some(&w.home))).contains(&"자료/내 사진/a.png".to_string()));
    disconnect(&w.owner, "자료/내 사진").unwrap();
    assert!(d.join("a.png").exists());
}

// ── 이름 정규화(맥 한글은 풀어 쓴 모양) ──

#[test]
fn nfc_composes_hangul_only() {
    let nfd = "\u{1109}\u{1173}\u{110f}\u{1173}\u{1105}\u{1175}\u{11ab}\u{1109}\u{1163}\u{11ba}";
    assert_eq!(nfc(nfd), "스크린샷");
    assert_eq!(nfc("스크린샷"), "스크린샷");
    assert_eq!(nfc("Screen Shot 2026 \u{1100}\u{1161}"), "Screen Shot 2026 가");
    assert_eq!(nfc("a\u{1100}b"), "a\u{1100}b", "짝 없는 자음은 그대로");
}

#[test]
fn nfd_folder_name_becomes_composed_link_name() {
    let w = W::new("nfd");
    let nfd = "\u{1109}\u{1173}\u{110f}\u{1173}\u{1105}\u{1175}\u{11ab}\u{1109}\u{1163}\u{11ba}";
    let d = w.home.join("Desktop").join(nfd);
    put(&d.join("a.png"), "x");
    let at = connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    assert_eq!(at.file_name().unwrap().to_string_lossy(), "스크린샷");
}

// ── 스크린샷 자동 연결 ──

#[test]
fn shot_dir_follows_setting_then_desktop() {
    let w = W::new("sd");
    let desk = w.home.join("Desktop");
    std::fs::create_dir_all(w.home.join("Desktop/스크린샷")).unwrap();
    assert_eq!(shot_dir_on(&w.home, None, false), Some(desk.clone()));
    assert_eq!(shot_dir_on(&w.home, Some("  "), false), Some(desk.clone()));
    assert_eq!(shot_dir_on(&w.home, Some("~/Desktop/스크린샷"), false), Some(w.home.join("Desktop/스크린샷")));
    assert_eq!(shot_dir_on(&w.home, Some(&format!("{}/Desktop/스크린샷", w.home.display())), false), Some(w.home.join("Desktop/스크린샷")));
    // 설정이 가리키는 폴더가 없으면 바탕화면
    assert_eq!(shot_dir_on(&w.home, Some("~/없는곳"), false), Some(desk));
}

#[test]
fn windows_shot_dir_is_pictures_screenshots_or_none() {
    // 0.3.0 2차 — 윈도우에서 바탕화면을 '스크린샷'으로 이었다. 윈도우 스크린샷(Win+PrtScn)은 사진\스크린샷에 쌓인다
    let w = W::new("wsd");
    assert_eq!(shot_dir_on(&w.home, None, true), None, "폴더가 없으면 연결하지 않는다(바탕화면으로 가지 않는다)");
    std::fs::create_dir_all(w.home.join("OneDrive/Pictures/Screenshots")).unwrap();
    assert_eq!(shot_dir_on(&w.home, None, true), Some(w.home.join("OneDrive/Pictures/Screenshots")), "OneDrive 로 옮겨진 사진");
    std::fs::create_dir_all(w.home.join("Pictures/Screenshots")).unwrap();
    assert_eq!(shot_dir_on(&w.home, None, true), Some(w.home.join("Pictures/Screenshots")));
}

#[test]
fn no_shot_dir_means_no_link_and_no_mark() {
    let w = W::new("nosd");
    let o = Owner { key: "참모".into(), id: "o1".into(), name: "참모".into() };
    assert!(!connect_shots_at(&w.ctx(), Some(&o), None).unwrap());
    assert!(!w.data.join(SHOTS_MARK).exists(), "아무것도 안 했으니 표식도 없다 — 폴더가 생기면 다음에 잇는다");
}

#[test]
fn auto_connect_shots_once_and_respects_removal() {
    let w = W::new("auto");
    let nfd = "\u{1109}\u{1173}\u{110f}\u{1173}\u{1105}\u{1175}\u{11ab}\u{1109}\u{1163}\u{11ba}";
    let d = w.home.join("Desktop").join(nfd);
    put(&d.join("Screenshot 1.png"), "1");
    let o = Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() };
    // 참모가 아직 없으면 기다린다(표식 안 남김)
    assert!(!auto_connect_shots(&w.ctx(), None, Some(&format!("~/Desktop/{nfd}"))).unwrap());
    assert!(!w.data.join(SHOTS_MARK).exists());
    assert!(auto_connect_shots(&w.ctx(), Some(&o), Some(&format!("~/Desktop/{nfd}"))).unwrap());
    assert!(w.data.join(SHOTS_MARK).exists());
    let es = locker_fs::tree_in(&w.owner, Some(&w.home));
    assert!(es.iter().any(|e| e.rel == "스크린샷" && e.linked && !e.gone));
    assert!(rels(&es).contains(&"스크린샷/Screenshot 1.png".to_string()));
    // 한 번만 — 사람이 풀면 다시 안 붙는다
    disconnect(&w.owner, "스크린샷").unwrap();
    assert!(!auto_connect_shots(&w.ctx(), Some(&o), Some(&format!("~/Desktop/{nfd}"))).unwrap());
    assert!(!w.owner.join("스크린샷").exists());
}

#[test]
fn auto_connect_falls_back_to_desktop_and_refuses_outside_home() {
    let w = W::new("auto2");
    std::fs::create_dir_all(w.home.join("Desktop")).unwrap();
    let o = Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() };
    assert!(auto_connect_shots(&w.ctx(), Some(&o), None).unwrap());
    assert!(w.owner.join("스크린샷").exists());
    // 홈 밖으로 잡힌 설정은 거절 — 바탕화면으로도 안 넘어간다(설정이 있는데 못 쓰는 경우는 연결 안 함)
    let w2 = W::new("auto3");
    let out = tmp("auto3-out");
    let o = Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() };
    let r = auto_connect_shots(&w2.ctx(), Some(&o), Some(out.to_str().unwrap()));
    assert!(r.is_err() || r == Ok(false));
    assert!(!w2.owner.join("스크린샷").exists());
    assert!(w2.data.join(SHOTS_MARK).exists(), "한 번 시도했으면 표식");
}

// ── 최근 스크린샷 ──

#[test]
fn recent_shots_newest_images_only() {
    let w = W::new("rec");
    let d = w.home.join("Desktop/스크린샷");
    for (n, t) in [("a.png", 10), ("b.JPG", 30), ("c.heic", 20), ("d.txt", 40), (".hidden.png", 50)] {
        put(&d.join(n), n);
        at_time(&d.join(n), t);
    }
    std::fs::create_dir_all(d.join("dir.png")).unwrap();
    let v = recent_shots(&w.ctx(), &d, 2);
    let names: Vec<_> = v.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["b.JPG", "c.heic"]);
    assert_eq!(v[0].path, d.join("b.JPG").to_string_lossy());
    assert_eq!(recent_shots(&w.ctx(), &d, 99).len(), 3);
    assert_eq!(recent_shots(&w.ctx(), &d, 0).len(), 0);
}

#[test]
fn recent_shots_on_the_desktop_only_takes_screenshot_names() {
    let w = W::new("recdesk");
    let desk = w.home.join("Desktop");
    let nfd = "\u{1109}\u{1173}\u{110f}\u{1173}\u{1105}\u{1175}\u{11ab}\u{1109}\u{1163}\u{11ba}";
    put(&desk.join(format!("{nfd} 2026-10-12 오전 9.00.00.png")), "s");
    put(&desk.join("Screenshot 2026-10-12.png"), "s");
    put(&desk.join("로고.png"), "x");
    let v = recent_shots(&w.ctx(), &desk, 10);
    assert_eq!(v.len(), 2, "바탕화면이면 스크린샷 이름만");
    assert!(v.iter().all(|s| !s.name.contains("로고")));
    assert!(v.iter().any(|s| s.name.starts_with("스크린샷")), "이름은 합쳐 보여 준다");
}

#[test]
fn recent_shots_refuses_unsafe_dirs() {
    let w = W::new("recbad");
    let secret = w.home.join(".ssh");
    put(&secret.join("a.png"), "x");
    assert!(recent_shots(&w.ctx(), &secret, 5).is_empty());
    let out = tmp("recbad-out");
    put(&out.join("a.png"), "x");
    assert!(recent_shots(&w.ctx(), &out, 5).is_empty());
}

// ── 파인더로 보기·iCloud 내려받기는 연결 폴더 안 파일도 ──

#[test]
fn read_only_paths_reach_into_connected_folders_only() {
    let w = W::new("rp");
    let d = w.home.join("Pictures/p");
    put(&d.join("a.png"), "x");
    connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    assert!(read_path_ok(&w.ctx(), &w.owner.join("p/a.png")));
    // 보관함 밖 경로·상대 경로·점 폴더로 새는 링크는 안 됨
    assert!(!read_path_ok(&w.ctx(), &d.join("a.png")));
    assert!(!read_path_ok(&w.ctx(), Path::new("p/a.png")));
    put(&w.home.join(".ssh/id"), "KEY");
    std::os::unix::fs::symlink(w.home.join(".ssh"), w.owner.join("몰래")).unwrap();
    assert!(!read_path_ok(&w.ctx(), &w.owner.join("몰래/id")));
}

#[test]
fn phone_never_sees_broad_connections() {
    // 설정이 없으면 자동 연결이 바탕화면으로 떨어진다 — 맥 화면엔 보이지만 폰엔 바탕화면 전체를 안 준다
    let w = W::new("broad");
    let desk = w.home.join("Desktop");
    put(&desk.join("계약서.md"), "# 비밀");
    put(&desk.join("스크린샷/a.md"), "# 스샷");
    connect(&w.ctx(), &w.owner, "", &desk, Some("바탕화면")).unwrap();
    let es = locker_fs::tree_in(&w.owner, Some(&w.home));
    assert!(rels(&es).contains(&"바탕화면/계약서.md".to_string()), "맥 화면엔 보인다");
    let v = locker_fs::phone_view(&w.root, &w.home);
    let items = v["items"].as_array().unwrap();
    assert!(!items.iter().any(|i| i["rel"].as_str().unwrap().starts_with("바탕화면")), "폰엔 안 간다");
    assert!(!v["folders"].as_array().unwrap().iter().any(|f| f["name"].as_str().unwrap().starts_with("바탕화면")));
    assert!(locker_fs::phone_paths(&w.root, &w.home).iter().all(|p| !p.contains("Desktop")), "폰 허용 목록에도 없다");
    // 좁은 폴더(바탕화면 안 스크린샷 폴더)는 폰도 읽기만으로 본다
    connect(&w.ctx(), &w.owner, "", &desk.join("스크린샷"), None).unwrap();
    assert!(locker_fs::phone_paths(&w.root, &w.home).contains(&desk.join("스크린샷/a.md").to_string_lossy().into_owned()));
    assert!(broad_target(&w.home, &desk) && broad_target(&w.home, &w.home.join("Downloads")) && !broad_target(&w.home, &desk.join("스크린샷")));
}

// ── 연결 폴더 안 휴지통(2026-10-12 사용자 "스크린샷 골라서 지우려는데") — 맥 휴지통만 허용, 이름 바꾸기·옮기기는 그대로 거절 ──

#[test]
fn trash_inside_a_connection_goes_to_the_mac_trash() {
    let w = W::new("tr");
    let d = w.home.join("Pictures/p");
    put(&d.join("a.png"), "A");
    put(&d.join("안/b.png"), "B");
    connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    let bin = w.home.join(".Trash");
    std::fs::create_dir_all(&bin).unwrap();
    assert!(in_connection(&w.owner, "p/a.png") && in_connection(&w.owner, "p/안/b.png"));
    assert!(!in_connection(&w.owner, "p") && !in_connection(&w.owner, "자료"), "연결 자체·집 폴더는 안쪽이 아니다");
    trash_any(&w.ctx(), &w.owner, "p/a.png", &bin, &G_OK).unwrap();
    assert!(!d.join("a.png").exists(), "원본이 빠졌다");
    assert_eq!(std::fs::read_to_string(bin.join("a.png")).unwrap(), "A", "맥 휴지통에서 되살릴 수 있다");
    trash_any(&w.ctx(), &w.owner, "p/안", &bin, &G_OK).unwrap();
    assert!(bin.join("안/b.png").exists(), "안쪽 폴더도 통째로 휴지통");
    // 같은 이름이 또 가면 번호(덮어쓰지 않는다)
    put(&d.join("a.png"), "A2");
    trash_any(&w.ctx(), &w.owner, "p/a.png", &bin, &G_OK).unwrap();
    assert_eq!(std::fs::read_to_string(bin.join("a.png")).unwrap(), "A");
    assert_eq!(std::fs::read_dir(&bin).unwrap().count(), 3);
    // 연결은 그대로
    assert!(w.owner.join("p").exists() && linked_targets(&w.owner).len() == 1);
}

#[test]
fn trash_still_refuses_rename_move_and_the_connection_itself() {
    let w = W::new("trno");
    let d = w.home.join("Pictures/p");
    put(&d.join("a.png"), "A");
    connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    let bin = w.home.join(".Trash");
    std::fs::create_dir_all(&bin).unwrap();
    assert!(locker_fs::rename_entry(&w.owner, "p/a.png", "b.png").is_err(), "이름 바꾸기는 그대로 거절");
    assert!(locker_fs::move_entry(&w.owner, "p/a.png", "자료").is_err(), "옮기기는 그대로 거절");
    assert!(trash_any(&w.ctx(), &w.owner, "p", &bin, &G_OK).is_err(), "연결 자체는 휴지통 말고 '연결 풀기'");
    assert!(std::fs::symlink_metadata(w.owner.join("p")).is_ok());
    for bad in ["p/../p/a.png", "p/./a.png", "p/.숨김", "p/없는.png", "p/a.png/", "../p/a.png", "/p/a.png"] {
        assert!(trash_any(&w.ctx(), &w.owner, bad, &bin, &G_OK).is_err(), "이상한 경로 거절: {bad}");
    }
    assert!(d.join("a.png").exists());
    assert_eq!(std::fs::read_dir(&bin).unwrap().count(), 0);
}

#[test]
fn trash_rechecks_the_path_every_time() {
    let w = W::new("trre");
    let d = w.home.join("Pictures/p");
    put(&d.join("a.png"), "A");
    let at = connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    let bin = w.home.join(".Trash");
    std::fs::create_dir_all(&bin).unwrap();
    // 안쪽 링크(밖으로 샐 수 있다)는 휴지통 길도 안 탄다
    put(&w.home.join(".ssh/id"), "KEY");
    std::os::unix::fs::symlink(w.home.join(".ssh/id"), d.join("몰래.png")).unwrap();
    std::os::unix::fs::symlink(w.home.join(".ssh"), d.join("몰래폴더")).unwrap();
    assert!(trash_any(&w.ctx(), &w.owner, "p/몰래.png", &bin, &G_OK).is_err());
    assert!(trash_any(&w.ctx(), &w.owner, "p/몰래폴더/id", &bin, &G_OK).is_err());
    // 표식에 없는 손으로 만든 폴더 링크는 연결이 아니다
    std::os::unix::fs::symlink(w.home.join(".ssh"), w.owner.join("손")).unwrap();
    assert!(trash_any(&w.ctx(), &w.owner, "손/id", &bin, &G_OK).is_err());
    // 링크를 민감 폴더로 바꿔치기 + 표식도 그 글자로 — 지우기 직전에 다시 보고 거절
    std::fs::remove_file(&at).unwrap();
    std::os::unix::fs::symlink(w.home.join(".ssh"), &at).unwrap();
    std::fs::write(w.owner.join(LINKS), format!("{}\n", w.home.join(".ssh").display())).unwrap();
    assert!(trash_any(&w.ctx(), &w.owner, "p/id", &bin, &G_OK).is_err());
    assert!(w.home.join(".ssh/id").exists());
    // 홈 밖으로 바꿔치기도 거절
    let out = tmp("trre-out");
    put(&out.join("x.png"), "X");
    std::fs::remove_file(&at).unwrap();
    std::os::unix::fs::symlink(&out, &at).unwrap();
    std::fs::write(w.owner.join(LINKS), format!("{}\n", out.display())).unwrap();
    assert!(trash_any(&w.ctx(), &w.owner, "p/x.png", &bin, &G_OK).is_err());
    assert!(out.join("x.png").exists());
    assert_eq!(std::fs::read_dir(&bin).unwrap().count(), 0);
}

#[test]
fn trash_any_keeps_the_old_locker_path() {
    // 보관함 집 파일·바로가기는 예전 휴지통 길 그대로(.판 도 따라간다)
    let w = W::new("trold");
    put(&w.owner.join("자료/c.md"), "C");
    let bin = w.home.join(".Trash");
    std::fs::create_dir_all(&bin).unwrap();
    trash_any(&w.ctx(), &w.owner, "자료/c.md", &bin, &G_OK).unwrap();
    assert!(bin.join("c.md").exists() && !w.owner.join("자료/c.md").exists());
}

// ── 스크린샷 연결은 스크린샷 파일만(2026-10-12 사고 — 바탕화면 연결에서 ⌘A → 휴지통에 폴더 93개가 갔다) ──

const NFD_SHOT: &str = "\u{1109}\u{1173}\u{110f}\u{1173}\u{1105}\u{1175}\u{11ab}\u{1109}\u{1163}\u{11ba}";

/// 바탕화면 한 벌 — 스크린샷·화면 기록 + 섞여 있는 다른 파일·폴더·저장소
fn messy_desktop(w: &W) -> PathBuf {
    let desk = w.home.join("Desktop");
    put(&desk.join("스크린샷 2026-10-12 오후 4.10.11.png"), "s1");
    put(&desk.join(format!("{NFD_SHOT} 2026-10-12 오후 4.11.00.png")), "s2");
    put(&desk.join("Screenshot 2026-10-12 at 4.12.00 PM.png"), "s3");
    put(&desk.join("화면 기록 2026-10-12 오후 4.13.00.mov"), "r1");
    put(&desk.join("Screen Recording 2026-10-12 at 4.14.00 PM.mov"), "r2");
    put(&desk.join("계약서.pdf"), "x");
    put(&desk.join("스크린샷 메모.txt"), "x");
    put(&desk.join("거래처/견적.xlsx"), "x");
    put(&desk.join("dev/앱/.git/HEAD"), "x");
    put(&desk.join("스크린샷 폴더처럼/a.png"), "x");
    desk
}

#[test]
fn shots_connection_lists_only_screenshot_files() {
    let w = W::new("shotonly");
    messy_desktop(&w);
    let o = Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() };
    assert!(auto_connect_shots(&w.ctx(), Some(&o), None).unwrap(), "설정 없음 → 바탕화면 연결");
    let es = locker_fs::tree_in(&w.owner, Some(&w.home));
    let mut kids: Vec<String> = es.iter().filter_map(|e| e.rel.strip_prefix("스크린샷/").map(nfc)).collect();
    kids.sort();
    assert_eq!(
        kids,
        vec![
            "Screen Recording 2026-10-12 at 4.14.00 PM.mov".to_string(),
            "Screenshot 2026-10-12 at 4.12.00 PM.png".into(),
            "스크린샷 2026-10-12 오후 4.10.11.png".into(),
            "스크린샷 2026-10-12 오후 4.11.00.png".into(),
            "화면 기록 2026-10-12 오후 4.13.00.mov".into(),
        ],
        "폴더·다른 파일은 목록에 아예 없다(⌘A 로도 못 고른다)"
    );
    assert!(es.iter().filter(|e| e.rel.starts_with("스크린샷/")).all(|e| !e.dir && e.ro));
}

#[test]
fn a_plain_connection_named_like_shots_still_lists_everything() {
    // 사람이 고른 좁은 폴더는 이름이 '스크린샷'이어도 거르지 않는다(자동 연결·바탕화면만 거른다)
    let w = W::new("shotplain");
    let d = w.home.join("Pictures/스크린샷");
    put(&d.join("메모.txt"), "x");
    put(&d.join("안/b.png"), "x");
    connect(&w.ctx(), &w.owner, "", &d, None).unwrap();
    let r = rels(&locker_fs::tree_in(&w.owner, Some(&w.home)));
    assert!(r.contains(&"스크린샷/메모.txt".to_string()) && r.contains(&"스크린샷/안/b.png".to_string()));
}

#[test]
fn shots_connection_trash_takes_screenshot_files_only() {
    let w = W::new("shottr");
    let desk = messy_desktop(&w);
    let o = Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() };
    auto_connect_shots(&w.ctx(), Some(&o), None).unwrap();
    let bin = w.home.join(".Trash");
    std::fs::create_dir_all(&bin).unwrap();
    let g = crate::locker_trash::Guard { keep: &[], folders_ok: true };
    // 화면이 보내도(⌘A 를 흉내) 스크린샷이 아닌 건 Rust 가 거절 — 폴더 확인 플래그가 있어도
    for bad in ["스크린샷/계약서.pdf", "스크린샷/스크린샷 메모.txt", "스크린샷/거래처", "스크린샷/dev", "스크린샷/스크린샷 폴더처럼", "스크린샷/거래처/견적.xlsx"] {
        assert!(trash_any(&w.ctx(), &w.owner, bad, &bin, &g).is_err(), "스크린샷 연결에서 거절: {bad}");
    }
    assert!(desk.join("계약서.pdf").exists() && desk.join("dev/앱/.git/HEAD").exists() && desk.join("거래처/견적.xlsx").exists());
    let moved = trash_any(&w.ctx(), &w.owner, "스크린샷/스크린샷 2026-10-12 오후 4.10.11.png", &bin, &g).unwrap();
    assert_eq!(moved.len(), 1);
    assert!(bin.join("스크린샷 2026-10-12 오후 4.10.11.png").exists());
}

#[test]
fn shot_dir_matches_nfc_and_nfd_folder_names() {
    // 설정은 풀어 쓴 글자(NFD)로, 폴더는 합쳐 쓴 글자(NFC)로 만들어도 같은 폴더
    let w = W::new("shotnfd");
    std::fs::create_dir_all(w.home.join("Desktop/스크린샷")).unwrap();
    assert_eq!(nfc(&shot_dir_on(&w.home, Some(&format!("~/Desktop/{NFD_SHOT}")), false).unwrap().to_string_lossy()), nfc(&w.home.join("Desktop/스크린샷").to_string_lossy()));
    let w2 = W::new("shotnfd2");
    std::fs::create_dir_all(w2.home.join("Desktop").join(NFD_SHOT)).unwrap();
    assert_eq!(nfc(&shot_dir_on(&w2.home, Some("~/Desktop/스크린샷"), false).unwrap().to_string_lossy()), nfc(&w2.home.join("Desktop/스크린샷").to_string_lossy()));
}

#[test]
fn shots_connection_moves_to_the_screenshot_folder_once_it_exists() {
    // 설정은 ~/Desktop/스크린샷(NFD)인데 폴더가 없어 바탕화면에 붙었던 것 — 폴더가 생기면 그 폴더로 옮겨 붙는다
    let w = W::new("shotfollow");
    messy_desktop(&w);
    let conf = format!("~/Desktop/{NFD_SHOT}");
    let o = Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() };
    auto_connect_shots(&w.ctx(), Some(&o), Some(&conf)).unwrap();
    let desk = canon_s(&w.home.join("Desktop"));
    assert_eq!(std::fs::read_link(w.owner.join("스크린샷")).unwrap().to_string_lossy(), desk);
    assert!(!follow_shots(&w.ctx(), &w.owner, Some(&conf)).unwrap(), "폴더가 아직 없으면 그대로");
    // 사용자가 폴더를 만들었다(합쳐 쓴 이름으로)
    let made = w.home.join("Desktop/스크린샷");
    put(&made.join("스크린샷 2026-10-12 오후 5.00.00.png"), "new");
    put(&made.join("메모.txt"), "x");
    assert!(follow_shots(&w.ctx(), &w.owner, Some(&conf)).unwrap(), "새 폴더로 옮겨 붙었다");
    let now = std::fs::read_link(w.owner.join("스크린샷")).unwrap();
    assert_eq!(nfc(&now.to_string_lossy()), nfc(&canon_s(&made)));
    assert!(!follow_shots(&w.ctx(), &w.owner, Some(&conf)).unwrap(), "두 번째는 할 일 없음");
    let r = rels(&locker_fs::tree_in(&w.owner, Some(&w.home)));
    assert!(r.contains(&"스크린샷/스크린샷 2026-10-12 오후 5.00.00.png".to_string()));
    assert!(!r.iter().any(|x| x.contains("메모.txt") || x.contains("계약서")), "옮겨 붙어도 스크린샷 파일만");
    assert_eq!(linked_targets(&w.owner).len(), 1, "옛 바탕화면 표식은 빠진다");
}

#[test]
fn existing_desktop_shots_link_without_marker_is_still_filtered() {
    // 이번 고침 전에 붙은 연결(표식 없이 '스크린샷' 이름으로 바탕화면을 가리킴)도 거른다
    let w = W::new("shotold");
    messy_desktop(&w);
    connect(&w.ctx(), &w.owner, "", &w.home.join("Desktop"), Some(SHOTS_NAME)).unwrap();
    let _ = std::fs::remove_file(w.owner.join(SHOTS_FILE));
    let r = rels(&locker_fs::tree_in(&w.owner, Some(&w.home)));
    assert!(r.contains(&"스크린샷/스크린샷 2026-10-12 오후 4.10.11.png".to_string()));
    assert!(!r.iter().any(|x| x == "스크린샷/거래처" || x == "스크린샷/dev" || x.ends_with("계약서.pdf")));
}

fn canon_p(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap()
}
fn canon_s(p: &Path) -> String {
    canon_p(p).to_string_lossy().into_owned()
}
