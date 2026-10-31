use super::*;
use std::path::{Path, PathBuf};

/// 맥 temp 는 /var → /private/var 링크라 실제 위치로 잡는다
fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-lockerfs-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::canonicalize(d).unwrap()
}

/// 가짜 홈 한 벌 — 데이터 폴더·보관함 뿌리는 홈 안(진짜와 같은 모양)
struct W {
    home: PathBuf,
    data: PathBuf,
    root: PathBuf,
    dev: PathBuf,
}
impl W {
    fn new(name: &str) -> W {
        let home = tmp(name);
        let data = home.join(".chammo");
        std::fs::create_dir_all(data.join("attach")).unwrap();
        let root = home.join("Documents/Chammo");
        let dev = home.join("Desktop/dev");
        W { home, data, root, dev }
    }
    fn ctx(&self) -> Ctx<'_> {
        Ctx { home: &self.home, data: &self.data, root: &self.root, settled: std::slice::from_ref(&self.dev) }
    }
}

fn put(p: &Path, body: &str) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    v.sort();
    v
}

// ── ① 진짜 폴더 ──

#[test]
fn root_rules() {
    let h = Path::new("/Users/u");
    assert_eq!(root_of(h, Path::new("/Users/u/.chammo"), None, true), PathBuf::from("/Users/u/Documents/Chammo"));
    // 시험 데이터 폴더면 그 안 — 진짜 문서 폴더를 안 건드린다
    assert_eq!(root_of(h, Path::new("/Users/u/.chammo-test"), None, false), PathBuf::from("/Users/u/.chammo-test/Documents-Chammo"));
    assert_eq!(root_of(h, Path::new("/Users/u/.chammo"), Some("/tmp/lk"), true), PathBuf::from("/tmp/lk"));
    assert_eq!(root_of(h, Path::new("/Users/u/.chammo"), Some("  "), true), PathBuf::from("/Users/u/Documents/Chammo"));
}

#[test]
fn owner_folder_has_id_and_inbox() {
    let w = W::new("own");
    let d = owner_dir(&w.root, "s-111", "운영").unwrap();
    assert_eq!(d, w.root.join("운영"));
    assert_eq!(std::fs::read_to_string(d.join(ID_FILE)).unwrap().trim(), "s-111");
    assert!(d.join(BASE_FOLDER).is_dir(), "새 참모 폴더엔 기본 폴더 '자료' 하나");
    assert!(!d.join(OLD_INBOX).exists(), "'받은 것'은 안 만든다");
    // 두 번 불러도 같은 폴더
    assert_eq!(owner_dir(&w.root, "s-111", "운영").unwrap(), d);
}

#[test]
fn renamed_assistant_moves_folder_with_files() {
    let w = W::new("ren");
    let d = owner_dir(&w.root, "s-1", "운영").unwrap();
    put(&d.join("a.txt"), "a");
    let d2 = owner_dir(&w.root, "s-1", "총무").unwrap();
    assert_eq!(d2, w.root.join("총무"));
    assert!(!w.root.join("운영").exists());
    assert_eq!(std::fs::read_to_string(d2.join("a.txt")).unwrap(), "a");
}

#[test]
fn rename_never_clobbers_another_folder() {
    let w = W::new("clob");
    owner_dir(&w.root, "s-1", "운영").unwrap();
    put(&w.root.join("총무/메모.md"), "남의 것");
    // s-1 이 '총무' 로 이름을 바꿨지만 그 자리에 다른 폴더가 있다 → 옛 이름 그대로
    assert_eq!(owner_dir(&w.root, "s-1", "총무").unwrap(), w.root.join("운영"));
    assert_eq!(std::fs::read_to_string(w.root.join("총무/메모.md")).unwrap(), "남의 것");
    // 그 '총무' 폴더(id 없음)를 다른 참모가 새로 쓰려 하면 '총무 2'
    assert_eq!(owner_dir(&w.root, "s-2", "총무").unwrap(), w.root.join("총무 2"));
}

#[test]
fn unsafe_names_are_cleaned() {
    assert_eq!(safe_name("../위험", "id"), "-위험");
    assert_eq!(safe_name("a/b", "id"), "a-b");
    assert_eq!(safe_name(".숨김", "id"), "숨김");
    assert_eq!(safe_name("   ", "s-9"), "s-9");
    assert_eq!(safe_name("..", "s-9"), "s-9");
    assert_eq!(safe_name("a\u{0}b", "id"), "ab");
}

// ── ② 넣기 ──

#[test]
fn check_refuses_escapes() {
    let w = W::new("chk");
    let other = tmp("chk-other");
    put(&other.join("a.pdf"), "x");
    assert!(check_add(&other.join("a.pdf"), &w.ctx()).is_err());
    assert!(check_add(Path::new("rel.txt"), &w.ctx()).is_err());
    put(&w.home.join("Downloads/a.txt"), "x");
    assert!(check_add(&w.home.join("Downloads/../Downloads/a.txt"), &w.ctx()).is_err());
    // 링크로 홈 밖을 가리키면 안 됨
    std::os::unix::fs::symlink(other.join("a.pdf"), w.home.join("Downloads/out.pdf")).unwrap();
    assert!(check_add(&w.home.join("Downloads/out.pdf"), &w.ctx()).is_err());
    // 폴더·없는 파일
    assert!(check_add(&w.home.join("Downloads"), &w.ctx()).is_err());
    assert!(check_add(&w.home.join("Downloads/없음.txt"), &w.ctx()).is_err());
    // 데이터 폴더는 attach 만
    put(&w.data.join("config.json"), "{}");
    assert!(check_add(&w.data.join("config.json"), &w.ctx()).is_err());
    put(&w.data.join("attach/1-phone.png"), "p");
    assert!(check_add(&w.data.join("attach/1-phone.png"), &w.ctx()).is_ok());
    // 이미 보관함 안이면 넣기가 아니라 옮기기
    let d = owner_dir(&w.root, "s-1", "운영").unwrap();
    put(&d.join("in.txt"), "x");
    assert!(check_add(&d.join("in.txt"), &w.ctx()).is_err());
}

#[test]
fn decide_by_where_it_came_from() {
    let w = W::new("dec");
    let c = w.ctx();
    let small = 10;
    assert_eq!(decide(&w.home.join("Downloads/a.pdf"), small, &c), Home::Copy);
    assert_eq!(decide(&w.home.join("Desktop/a.png"), small, &c), Home::Copy);
    assert_eq!(decide(&w.home.join("Pictures/Screenshots/s.png"), small, &c), Home::Copy);
    assert_eq!(decide(&w.data.join("attach/1-x.png"), small, &c), Home::Copy);
    assert_eq!(decide(&w.home.join("Documents/계약/a.pdf"), small, &c), Home::Link);
    assert_eq!(decide(&w.home.join("Desktop/dev/shop-video/cut.png"), small, &c), Home::Link);
    // 큰 파일은 어디서 왔든 별칭 — 첨부만 늘 복사
    assert_eq!(decide(&w.home.join("Downloads/촬영본.mov"), BIG + 1, &c), Home::Link);
    assert_eq!(decide(&w.data.join("attach/1-big.mov"), BIG + 1, &c), Home::Copy);
    // Desktop 안이어도 dev 같은 작업 폴더는 자리 잡은 곳
    assert_eq!(decide(&w.home.join("Desktop/작업/old.key"), small, &c), Home::Copy);
}

#[test]
fn add_copies_from_downloads_and_leaves_original() {
    let w = W::new("cp");
    let d = owner_dir(&w.root, "s-1", "운영").unwrap();
    let f = w.home.join("Downloads/견적서.xlsx");
    put(&f, "원본");
    let a = add(&w.ctx(), &d, "", &f).unwrap();
    assert_eq!(a.path, d.join("견적서.xlsx"));
    assert!(!a.link);
    assert_eq!(std::fs::read_to_string(&a.path).unwrap(), "원본");
    assert_eq!(std::fs::read_to_string(&f).unwrap(), "원본");
    // 남은 임시 조각 없음
    assert!(names(&d).iter().all(|n| !n.ends_with(PART)));
}

#[test]
fn add_same_name_gets_number() {
    let w = W::new("dup");
    let d = owner_dir(&w.root, "s-1", "운영").unwrap();
    put(&w.home.join("Downloads/a.txt"), "1");
    put(&w.home.join("Desktop/a.txt"), "2");
    put(&w.home.join("Downloads/x/a.txt"), "3");
    put(&w.home.join("Downloads/README"), "r");
    put(&w.home.join("Desktop/README"), "r2");
    add(&w.ctx(), &d, "", &w.home.join("Downloads/a.txt")).unwrap();
    assert_eq!(add(&w.ctx(), &d, "", &w.home.join("Desktop/a.txt")).unwrap().path, d.join("a 2.txt"));
    assert_eq!(add(&w.ctx(), &d, "", &w.home.join("Downloads/x/a.txt")).unwrap().path, d.join("a 3.txt"));
    add(&w.ctx(), &d, "", &w.home.join("Downloads/README")).unwrap();
    assert_eq!(add(&w.ctx(), &d, "", &w.home.join("Desktop/README")).unwrap().path, d.join("README 2"));
}

#[test]
fn add_links_settled_files() {
    let w = W::new("ln");
    let d = owner_dir(&w.root, "s-1", "운영").unwrap();
    let f = w.home.join("Desktop/dev/shop-video/cut_01.png");
    put(&f, "png");
    let a = add(&w.ctx(), &d, "", &f).unwrap();
    assert!(a.link);
    assert_eq!(std::fs::read_link(&a.path).unwrap(), f);
    assert_eq!(std::fs::read_to_string(&a.path).unwrap(), "png");
}

#[test]
fn add_into_subfolder_only_inside_owner() {
    let w = W::new("sub");
    let d = owner_dir(&w.root, "s-1", "운영").unwrap();
    std::fs::create_dir_all(d.join("10월 보고/세부")).unwrap();
    let f = w.home.join("Downloads/a.txt");
    put(&f, "a");
    assert_eq!(add(&w.ctx(), &d, "10월 보고/세부", &f).unwrap().path, d.join("10월 보고/세부/a.txt"));
    assert!(add(&w.ctx(), &d, "../밖", &f).is_err());
    assert!(add(&w.ctx(), &d, "없는 폴더", &f).is_err());
    assert!(add(&w.ctx(), &d, ".판", &f).is_err());
    // 폴더처럼 보이는 링크가 밖을 가리키면 안 됨
    let out = tmp("sub-out");
    std::os::unix::fs::symlink(&out, d.join("탈출")).unwrap();
    assert!(add(&w.ctx(), &d, "탈출", &f).is_err());
    assert!(names(&out).is_empty());
}

// ── ⑥ 옛 기록 옮기기 ──

fn line(v: serde_json::Value) -> String {
    format!("{v}\n")
}

#[test]
fn migrate_moves_old_log_once() {
    let w = W::new("mig");
    let files = w.data.join("locker/files");
    put(&files.join("1700000000000-붙인그림.png"), "img");
    put(&w.home.join("Downloads/견적서.xlsx"), "x");
    put(&w.home.join("Desktop/dev/shop-video/cut.png"), "c");
    put(&w.home.join("Downloads/숨긴것.txt"), "h");
    let mut log = String::new();
    log += &line(serde_json::json!({"op":"add","owner":"운영","path": files.join("1700000000000-붙인그림.png"),"copy":true,"by":"me","ts":"t"}));
    log += &line(serde_json::json!({"op":"add","owner":"운영","path": w.home.join("Downloads/견적서.xlsx"),"copy":false,"by":"me","ts":"t","folder":"견적·계약"}));
    log += &line(serde_json::json!({"op":"rename","owner":"운영","path": w.home.join("Downloads/견적서.xlsx"),"name":"견적 최종.xlsx"}));
    log += &line(serde_json::json!({"op":"add","owner":"운영","path": w.home.join("Desktop/dev/shop-video/cut.png"),"copy":false,"by":"me","ts":"t"}));
    log += &line(serde_json::json!({"op":"add","owner":"운영","path": w.home.join("Downloads/숨긴것.txt"),"copy":false,"by":"me","ts":"t"}));
    log += &line(serde_json::json!({"op":"hide","owner":"운영","path": w.home.join("Downloads/숨긴것.txt")}));
    log += &line(serde_json::json!({"op":"add","owner":"운영","path": w.home.join("Downloads/없어짐.pdf"),"copy":false,"by":"me","ts":"t"}));
    log += &line(serde_json::json!({"op":"folder","owner":"운영","name":"빈 폴더"}));
    std::fs::write(w.data.join("locker.jsonl"), &log).unwrap();

    let owners = vec![Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() }];
    let r = migrate(&w.ctx(), &owners).unwrap();
    let d = w.root.join("운영");
    assert_eq!(std::fs::read_to_string(d.join("붙인그림.png")).unwrap(), "img");
    assert!(!files.join("1700000000000-붙인그림.png").exists(), "옛 복사본은 확인 뒤 지운다");
    assert_eq!(std::fs::read_to_string(d.join("견적·계약/견적 최종.xlsx")).unwrap(), "x");
    assert!(w.home.join("Downloads/견적서.xlsx").exists(), "다운로드 원본은 그대로");
    assert_eq!(std::fs::read_link(d.join("cut.png")).unwrap(), w.home.join("Desktop/dev/shop-video/cut.png"));
    assert!(!d.join("숨긴것.txt").exists());
    assert!(d.join("빈 폴더").is_dir());
    assert_eq!(r.gone, 1);
    assert_eq!(r.moved, 3);
    // 옛 기록은 백업으로, 두 번째는 아무것도 안 한다
    assert!(!w.data.join("locker.jsonl").exists());
    assert_eq!(std::fs::read_to_string(w.data.join(OLD_LOG)).unwrap(), log);
    let again = migrate(&w.ctx(), &owners).unwrap();
    assert_eq!(again.moved, 0);
    assert!(!d.join("붙인그림 2.png").exists());
}

#[test]
fn migrate_rerun_after_crash_does_not_duplicate() {
    let w = W::new("mig2");
    put(&w.home.join("Downloads/a.txt"), "a");
    let log = line(serde_json::json!({"op":"add","owner":"운영","path": w.home.join("Downloads/a.txt"),"copy":false,"by":"me","ts":"t"}));
    std::fs::write(w.data.join("locker.jsonl"), &log).unwrap();
    // 앞선 시도가 복사까지 하고 끝맺음 전에 멈춘 모양
    let d = owner_dir(&w.root, "s-1", "운영").unwrap();
    put(&d.join("a.txt"), "a");
    let owners = vec![Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() }];
    migrate(&w.ctx(), &owners).unwrap();
    assert!(d.join("a.txt").is_file() && !d.join("a 2.txt").exists(), "이미 놓인 건 다시 안 놓는다");
}

#[test]
fn migrate_without_old_log_just_marks_done() {
    let w = W::new("mig3");
    let r = migrate(&w.ctx(), &[]).unwrap();
    assert_eq!(r.moved, 0);
    assert!(w.data.join(DONE_MARK).exists());
}

#[test]
fn settled_skips_empty_and_home() {
    let h = Path::new("/Users/u");
    let v = settled_of(h, &["~/Desktop/dev".into(), "".into(), "  ".into(), "~".into(), "/Users/u".into(), "~/automation/a".into()]);
    assert_eq!(v, vec![PathBuf::from("/Users/u/Desktop/dev"), PathBuf::from("/Users/u/automation/a")]);
}

// ── ③ 폴더 여러 층·끌기 정리 ──

fn owner(w: &W) -> PathBuf {
    owner_dir(&w.root, "s-1", "운영").unwrap()
}

#[test]
fn folders_nest_rename_and_list() {
    let w = W::new("tree");
    let d = owner(&w);
    assert_eq!(mkdir(&d, "", "10월 보고").unwrap(), "10월 보고");
    assert_eq!(mkdir(&d, "10월 보고", "세부").unwrap(), "10월 보고/세부");
    assert_eq!(mkdir(&d, "", "10월 보고").unwrap(), "10월 보고 2", "겹치면 번호");
    assert!(mkdir(&d, "../밖", "x").is_err());
    assert!(mkdir(&d, "", ".숨김").is_ok_and(|r| r == "숨김"));
    put(&d.join("10월 보고/세부/a.md"), "# a");
    assert_eq!(rename_entry(&d, "10월 보고", "11월 보고").unwrap(), "11월 보고");
    assert!(d.join("11월 보고/세부/a.md").is_file());
    assert!(rename_entry(&d, "", "다른 이름").is_err(), "보관함 자체는 이름을 못 바꾼다");
    assert!(rename_entry(&d, BASE_FOLDER, "자료함").is_ok(), "기본 폴더는 보통 폴더 — 바꿀 수 있다");
    assert!(rename_entry(&d, "11월 보고", "10월 보고 2").is_err(), "같은 이름이 있으면 거절");
    let t = tree(&d);
    let rels: Vec<&str> = t.iter().map(|e| e.rel.as_str()).collect();
    assert!(rels.contains(&"11월 보고/세부/a.md"));
    assert!(rels.contains(&"자료함"));
    assert!(!rels.iter().any(|r| r.contains(ID_FILE) || r.starts_with('.')), "점 파일은 안 보인다");
    // 폴더가 먼저
    let top: Vec<&Entry> = t.iter().filter(|e| !e.rel.contains('/')).collect();
    assert!(top.iter().all(|e| e.dir));
}

#[test]
fn move_file_moves_home_and_link_moves_only_link() {
    let w = W::new("mv");
    let d = owner(&w);
    mkdir(&d, "", "견적·계약").unwrap();
    put(&w.home.join("Downloads/견적.xlsx"), "x");
    let f = w.home.join("Desktop/dev/shop-video/cut.png");
    put(&f, "c");
    add(&w.ctx(), &d, "", &w.home.join("Downloads/견적.xlsx")).unwrap();
    add(&w.ctx(), &d, "", &f).unwrap();
    keep_before_write_in(&w.root, &d.join("견적.xlsx")); // 고치기 직전 판 하나
    assert_eq!(move_entry(&d, "견적.xlsx", "견적·계약").unwrap(), "견적·계약/견적.xlsx");
    assert_eq!(std::fs::read_to_string(d.join("견적·계약/견적.xlsx")).unwrap(), "x");
    assert!(d.join("견적·계약/.판/견적.xlsx/1.xlsx").is_file(), ".판 도 같이 간다");
    assert_eq!(move_entry(&d, "cut.png", "견적·계약").unwrap(), "견적·계약/cut.png");
    assert_eq!(std::fs::read_link(d.join("견적·계약/cut.png")).unwrap(), f, "별칭은 별칭만 이동");
    assert!(f.is_file(), "집은 제자리");
    // 폴더를 자기 안으로·보관함 자체·밖으로는 못 옮김
    mkdir(&d, "견적·계약", "안").unwrap();
    assert!(move_entry(&d, "견적·계약", "견적·계약/안").is_err());
    assert!(move_entry(&d, "", "견적·계약").is_err(), "보관함 자체는 못 옮김");
    assert!(move_entry(&d, "견적·계약/견적.xlsx", "../").is_err());
    // 같은 이름이 있으면 번호
    put(&d.join("견적.xlsx"), "y");
    assert_eq!(move_entry(&d, "견적.xlsx", "견적·계약").unwrap(), "견적·계약/견적 2.xlsx");
}

#[test]
fn trash_takes_link_not_target() {
    let w = W::new("trash");
    let d = owner(&w);
    let bin = w.home.join(".Trash");
    std::fs::create_dir_all(&bin).unwrap();
    let f = w.home.join("Desktop/dev/shop-video/cut.png");
    put(&f, "c");
    add(&w.ctx(), &d, "", &f).unwrap();
    remove(&d, "cut.png", &bin).unwrap();
    assert!(f.is_file(), "별칭을 지워도 원본은 그대로");
    assert!(!exists_any(&d.join("cut.png")));
    assert!(remove(&d, "", &bin).is_err(), "보관함 자체는 못 지움");
    mkdir(&d, "", "치울 폴더").unwrap();
    put(&d.join("치울 폴더/a.txt"), "a");
    remove(&d, "치울 폴더", &bin).unwrap();
    assert!(bin.join("치울 폴더/a.txt").is_file(), "휴지통으로(되살릴 수 있게)");
}

#[test]
fn broken_link_shows_gone() {
    let w = W::new("gone");
    let d = owner(&w);
    let f = w.home.join("Documents/계약/a.pdf");
    put(&f, "p");
    add(&w.ctx(), &d, "", &f).unwrap();
    std::fs::remove_file(&f).unwrap();
    let e = tree(&d).into_iter().find(|e| e.rel == "a.pdf").unwrap();
    assert!(e.gone && e.link.is_some());
}

// ── ④ .판 ──

#[test]
fn versions_keep_each_change_and_restore() {
    let w = W::new("ver");
    let d = owner(&w);
    put(&w.home.join("Downloads/메모.md"), "1판");
    let a = add(&w.ctx(), &d, "", &w.home.join("Downloads/메모.md")).unwrap();
    assert!(versions(&a.path).is_empty(), "들여올 땐 판을 안 남긴다(두 벌이 된다)");
    assert!(!d.join(VERS).exists());
    // 앱이 고치기 직전 — 지금 모양을 판으로
    keep_before_write_in(&w.root, &a.path);
    std::thread::sleep(std::time::Duration::from_millis(1100));
    std::fs::write(&a.path, "2판 고침").unwrap();
    keep_before_write_in(&w.root, &a.path);
    keep_before_write_in(&w.root, &a.path);
    assert_eq!(versions(&a.path).len(), 2, "같은 판을 두 번 안 남긴다");
    restore(&a.path, 1).unwrap();
    assert_eq!(std::fs::read_to_string(&a.path).unwrap(), "1판");
    let v = versions(&a.path);
    assert_eq!(v.len(), 3, "되돌린 것도 새 판으로(지금 판은 이미 남아 있다)");
    assert!(restore(&a.path, 99).is_err());
}

#[test]
fn versions_capped_and_links_skipped() {
    let w = W::new("cap");
    let d = owner(&w);
    let p = d.join("a.txt");
    for i in 0..(MAX_VERS + 3) {
        std::fs::write(&p, format!("판 {i}")).unwrap();
        let t = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000 + i as u64);
        std::fs::File::options().write(true).open(&p).unwrap().set_modified(t).unwrap();
        track_file(&p);
    }
    let v = versions(&p);
    assert_eq!(v.len(), MAX_VERS);
    assert_eq!(v.last().unwrap().n, MAX_VERS + 3, "오래된 것부터 버린다");
    let f = w.home.join("Desktop/dev/x/b.txt");
    put(&f, "b");
    let a = add(&w.ctx(), &d, "", &f).unwrap();
    keep_before_write_in(&w.root, &a.path);
    assert!(versions(&a.path).is_empty(), "별칭은 집(프로젝트)이 관리");
    // 보관함 밖 파일은 .판 을 안 만든다(md·엑셀은 자기 history 가 따로 있다)
    let out = w.home.join("Desktop/dev/x/c.md");
    put(&out, "c");
    keep_before_write_in(&w.root, &out);
    assert!(!w.home.join("Desktop/dev/x/.판").exists());
}

// ── ⑤ 이사 ──

#[test]
fn give_moves_home_to_project_and_leaves_link() {
    let w = W::new("give");
    let d = owner(&w);
    let proj = w.home.join("Desktop/dev/shop-video");
    std::fs::create_dir_all(&proj).unwrap();
    put(&w.home.join("Downloads/컷_01.png"), "img");
    let a = add(&w.ctx(), &d, "", &w.home.join("Downloads/컷_01.png")).unwrap();
    let to = give(&w.ctx(), &a.path, &proj).unwrap();
    assert_eq!(to, proj.join("assets/보관함/컷_01.png"));
    assert_eq!(std::fs::read_to_string(&to).unwrap(), "img");
    assert_eq!(std::fs::read_link(&a.path).unwrap(), to, "보관함 자리엔 별칭");
    // 프로젝트가 고친 것이 보관함에서 보인다
    std::fs::write(&to, "보정함").unwrap();
    assert_eq!(std::fs::read_to_string(&a.path).unwrap(), "보정함");
    // 같은 파일을 둘째 프로젝트에 → 복사(집은 그대로)
    let p2 = w.home.join("Desktop/dev/shop-reel");
    std::fs::create_dir_all(&p2).unwrap();
    let to2 = give(&w.ctx(), &a.path, &p2).unwrap();
    assert_eq!(std::fs::read_to_string(&to2).unwrap(), "보정함");
    assert_eq!(std::fs::read_link(&a.path).unwrap(), to);
    // 이미 그 프로젝트 것이면 그대로
    assert_eq!(give(&w.ctx(), &a.path, &proj).unwrap(), to);
    // 되돌리기 — 다시 보관함이 집
    take_back_in(&w.root, &w.home, &a.path).unwrap();
    assert!(std::fs::read_link(&a.path).is_err());
    assert_eq!(std::fs::read_to_string(&a.path).unwrap(), "보정함");
    assert!(!to.exists());
}

#[test]
fn 이사_중_치워_둔_원본은_바로가기_대신_복사가_지우지_않는다() {
    // 윈도우(바로가기 권한 없음)에서 link 는 copy_verified(to, file) 로 떨어진다 — 그 조각 이름이 치워 둔 원본 이름과 같아서
    // 원본을 지우고, give 가 되돌리며 사본까지 지워 파일이 통째로 사라졌다(2026-10-21 리뷰). 맥에서도 같은 순서로 재현한다
    let d = tmp("give-held");
    let (file, to) = (d.join("계약서.pdf"), d.join("사본.pdf"));
    std::fs::write(&file, "원본").unwrap();
    std::fs::write(&to, "원본").unwrap();
    let hold = held(&file);
    std::fs::rename(&file, &hold).unwrap();
    copy_verified(&to, &file).unwrap(); // 윈도우 link 가 바로가기 대신 하는 일
    assert_eq!(std::fs::read_to_string(&hold).unwrap(), "원본", "치워 둔 원본이 살아 있어야 되돌릴 수 있다");
    assert_ne!(held(&file), part_of(&file));
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn give_refuses_bad_places() {
    let w = W::new("give2");
    let d = owner(&w);
    put(&d.join("a.txt"), "a");
    let out = tmp("give2-out");
    assert!(give(&w.ctx(), &d.join("a.txt"), &out).is_err(), "홈 밖 프로젝트");
    assert!(give(&w.ctx(), &d.join("a.txt"), &w.root.join("x")).is_err(), "보관함 안");
    assert!(give(&w.ctx(), &w.home.join("Downloads/zz.txt"), &w.home.join("Desktop/dev")).is_err(), "보관함 밖 파일");
    // 프로젝트 원래 파일을 가리키는 별칭은 되돌리기 거절(데려올 집이 아님)
    let f = w.home.join("Desktop/dev/x/b.txt");
    put(&f, "b");
    let a = add(&w.ctx(), &d, "", &f).unwrap();
    assert!(take_back_in(&w.root, &w.home, &a.path).is_err());
    assert!(f.is_file());
}

/// 넣기 규칙 표(locker_rules.fixture.json) — scripts/locker(파이썬) 시험도 같은 표를 읽는다
#[test]
fn rules_match_shared_fixture() {
    let fx: serde_json::Value = serde_json::from_str(include_str!("locker_rules.fixture.json")).unwrap();
    assert_eq!(fx["big"].as_u64(), Some(BIG));
    let w = W::new("fx");
    let settled: Vec<PathBuf> = fx["settled"].as_array().unwrap().iter().map(|s| w.home.join(s.as_str().unwrap())).collect();
    let c = Ctx { home: &w.home, data: &w.data, root: &w.root, settled: &settled };
    for row in fx["decide"].as_array().unwrap() {
        let (p, len, want) = (row[0].as_str().unwrap(), row[1].as_u64().unwrap(), row[2].as_str().unwrap());
        let real = match p.strip_prefix("@attach/") {
            Some(n) => w.data.join("attach").join(n),
            None => w.home.join(p),
        };
        let got = if decide(&real, len, &c) == Home::Copy { "copy" } else { "link" };
        assert_eq!(got, want, "{p}");
    }
    for row in fx["names"].as_array().unwrap() {
        assert_eq!(safe_name(row[0].as_str().unwrap(), row[1].as_str().unwrap()), row[2].as_str().unwrap());
    }
}

// ── 폰 ──

#[test]
fn 폰에_내보내는_보관함_경로는_슬래시로() {
    // 폰은 dirs[주인] + '/' + rel 로 여는 경로를 만든다 — 윈도우 join(C:\…\주인\a/b.md)을 그대로 주면 그 경로가 허용 집합에 없어 403,
    // 보관함이 안 열렸다(공개 이슈 #15). 맥 경로는 그대로
    assert_eq!(phone_path(Path::new("C:\\Users\\Me\\Documents\\Chammo\\참모\\a/b.md")), "C:/Users/Me/Documents/Chammo/참모/a/b.md");
    assert_eq!(phone_path(Path::new("/Users/me/Documents/Chammo/참모/a/b.md")), "/Users/me/Documents/Chammo/참모/a/b.md");
    let w = W::new("phone-fwd");
    let d = owner(&w);
    mkdir(&d, "", "10월").unwrap();
    put(&d.join("10월/보고서.pdf"), "p");
    let v = phone_view(&w.root, &w.home);
    let dir = v["dirs"]["운영"].as_str().unwrap().to_string();
    let it = v["items"].as_array().unwrap().iter().find(|i| i["rel"] == "10월/보고서.pdf").unwrap().clone();
    assert_eq!(it["path"].as_str().unwrap(), format!("{dir}/10월/보고서.pdf"), "폰이 만드는 경로와 같은 글자");
    assert!(phone_paths(&w.root, &w.home).contains(&format!("{dir}/10월/보고서.pdf")));
}

#[test]
fn phone_view_lists_every_owner_in_old_shape() {
    let w = W::new("phone");
    let d = owner(&w);
    mkdir(&d, "", "10월").unwrap();
    put(&d.join("10월/보고서.pdf"), "p");
    put(&d.join("a.png"), "i");
    let f = w.home.join("Desktop/dev/x/cut.png");
    put(&f, "c");
    add(&w.ctx(), &d, "", &f).unwrap();
    std::os::unix::fs::symlink(w.home.join("없음.pdf"), d.join("끊김.pdf")).unwrap();
    let v = phone_view(&w.root, &w.home);
    let items = v["items"].as_array().unwrap();
    let get = |n: &str| items.iter().find(|i| i["path"].as_str().unwrap().ends_with(n)).unwrap().clone();
    assert_eq!(get("보고서.pdf")["owner"], "운영");
    assert_eq!(get("보고서.pdf")["folder"], "10월");
    assert!(get("a.png")["folder"].is_null(), "보관함 맨 위는 폴더 없음");
    assert_eq!(get("cut.png")["copy"], false);
    assert_eq!(get("cut.png")["path"], f.to_string_lossy().as_ref(), "별칭 줄은 진짜 파일 경로");
    assert_eq!(get("끊김.pdf")["gone"], true);
    assert_eq!(v["folders"], serde_json::json!([{ "owner": "운영", "name": "10월" }, { "owner": "운영", "name": "자료" }]));
    // 주인 폴더 이름 → id(.chammo) — 폰 팀 탭이 이름이 아니라 id(team-<팀>)로 팀 폴더를 고른다(같은 이름의 참모 폴더와 안 섞이게)
    assert_eq!(v["ids"]["운영"], owner_id_of_test(&d));
    let paths = phone_paths(&w.root, &w.home);
    assert!(paths.contains(&d.join("10월/보고서.pdf").to_string_lossy().into_owned()));
    assert!(paths.contains(&f.to_string_lossy().into_owned()), "별칭은 가리키는 진짜 파일로 허용");
    assert!(!paths.contains(&d.join("cut.png").to_string_lossy().into_owned()), "링크 경로는 안 넣는다");
    assert!(!paths.iter().any(|p| p.ends_with("끊김.pdf")));
    // 폰 홈·보관함 v1 — 폰도 데스크톱처럼 기록(lockerLog)을 만들게 자리(rel)·참모 폴더(dirs)를 같이
    assert_eq!(get("보고서.pdf")["rel"], "10월/보고서.pdf");
    assert_eq!(get("cut.png")["rel"], "cut.png", "별칭 줄도 자리는 보관함 안 이름");
    assert_eq!(v["dirs"]["운영"], d.to_string_lossy().as_ref());
}

#[test]
fn phone_owner_by_name_only_existing() {
    let w = W::new("phown");
    let d = owner(&w);
    assert_eq!(phone_owner(&w.root, "운영"), Some(d));
    assert_eq!(phone_owner(&w.root, "없는 참모"), None, "폰은 참모 폴더를 새로 만들지 않는다");
    assert_eq!(phone_owner(&w.root, "../운영"), None);
    assert_eq!(phone_owner(&w.root, ""), None);
}

#[test]
fn unalias_removes_only_links_inside() {
    let w = W::new("unal");
    let d = owner(&w);
    let f = w.home.join("Desktop/dev/x/cut.png");
    put(&f, "c");
    let at = alias(&w.ctx(), &d, "자료", &f).unwrap();
    assert_eq!(at, d.join("자료/cut.png"));
    put(&d.join("자료/진짜.md"), "# 진짜");
    assert!(unalias(&d, "자료/진짜.md").is_err(), "진짜 파일은 못 지운다");
    assert!(d.join("자료/진짜.md").is_file());
    assert!(unalias(&d, "../운영/자료/cut.png").is_err());
    assert!(unalias(&d, "자료").is_err(), "폴더도 아니다");
    unalias(&d, "자료/cut.png").unwrap();
    assert!(std::fs::symlink_metadata(d.join("자료/cut.png")).is_err(), "바로가기만 사라짐");
    assert!(f.is_file(), "가리키던 진짜 파일은 그대로");
    assert!(unalias(&d, "자료/cut.png").is_err(), "없는 자리");
}

#[test]
fn write_md_only_real_md_inside_owner() {
    let w = W::new("wmd");
    let d = owner(&w);
    let other = owner_dir(&w.root, "s-2", "디자인").unwrap();
    let doc = new_doc(&d, "자료", "md", "회의 메모").unwrap();
    write_md(&d, &doc, "# 회의 메모\n\n- 표지는 둘째로\n").unwrap();
    assert_eq!(std::fs::read_to_string(&doc).unwrap(), "# 회의 메모\n\n- 표지는 둘째로\n");
    assert_eq!(versions(&doc).len(), 1, "고치기 직전 모양을 판으로");
    // 거절: 다른 참모 폴더 · 별칭 · md 아닌 것 · 없는 파일 · 정규형 아닌 경로 · 너무 큼
    let theirs = new_doc(&other, "", "md", "남의 것").unwrap();
    assert!(write_md(&d, &theirs, "x").is_err());
    let f = w.home.join("Desktop/dev/x/README.md");
    put(&f, "원본");
    let at = alias(&w.ctx(), &d, "자료", &f).unwrap();
    assert!(write_md(&d, &at, "x").is_err(), "바로가기 너머 파일은 안 고친다");
    assert_eq!(std::fs::read_to_string(&f).unwrap(), "원본");
    put(&d.join("자료/표.txt"), "t");
    assert!(write_md(&d, &d.join("자료/표.txt"), "x").is_err());
    assert!(write_md(&d, &d.join("자료/없음.md"), "x").is_err());
    let odd = PathBuf::from(format!("{}/자료/../자료/회의 메모.md", d.display()));
    assert!(write_md(&d, &odd, "x").is_err());
    assert!(write_md(&d, &doc, &"가".repeat(MAX_PHONE_MD)).is_err());
    let ver = PathBuf::from(&versions(&doc)[0].path);
    std::fs::rename(&ver, ver.with_extension("md")).unwrap();
    assert!(write_md(&d, &ver.with_extension("md"), "x").is_err(), "판 폴더(.판) 안은 안 고친다");
}

#[test]
fn phone_md_save_does_not_overwrite_mac_edits() {
    // 폰이 연 뒤 맥(사람·참모)이 같은 md 에 줄을 더하면, 폰 저장이 통째로 써 그 줄이 말없이 사라졌다(2026-10-21 리뷰 ⑦-5)
    let w = W::new("wmd-base");
    let d = owner(&w);
    let doc = new_doc(&d, "", "md", "메모").unwrap();
    write_md(&d, &doc, "# 메모\n").unwrap();
    std::fs::write(&doc, "# 메모\n- 맥에서 더한 줄\n").unwrap();
    assert_eq!(write_md_from(&d, &doc, "# 메모\n폰 글\n", Some("# 메모\n")).unwrap_err(), crate::reader::CHANGED_OUTSIDE);
    assert_eq!(std::fs::read_to_string(&doc).unwrap(), "# 메모\n- 맥에서 더한 줄\n");
    write_md_from(&d, &doc, "# 메모\n- 맥에서 더한 줄\n폰 글\n", Some("# 메모\n- 맥에서 더한 줄\n")).unwrap();
    assert!(std::fs::read_to_string(&doc).unwrap().ends_with("폰 글\n"));
}

#[test]
fn phone_add_finds_owner_by_name() {
    let w = W::new("phadd");
    let d = owner(&w);
    put(&w.data.join("attach/1700000000000-phone.png"), "ph");
    let a = add_for_name(&w.ctx(), "운영", &w.data.join("attach/1700000000000-phone.png")).unwrap();
    assert_eq!(a.path, d.join("phone.png"));
    // 처음 보는 이름이면 그 이름으로 새 폴더
    put(&w.data.join("attach/1700000000001-phone.png"), "ph2");
    let b = add_for_name(&w.ctx(), "새 참모", &w.data.join("attach/1700000000001-phone.png")).unwrap();
    assert!(b.path.starts_with(w.root.join("새 참모")));
}

// ── 끊긴 바로가기 다시 잇기 ──

#[test]
fn relink_only_replaces_broken_shortcut_inside_home() {
    let w = W::new("relink");
    let d = owner(&w);
    let old = w.home.join("Documents/계약/a.pdf");
    put(&old, "p");
    let a = add(&w.ctx(), &d, "", &old).unwrap();
    // 원본을 옮겼다 → 끊김
    let moved = w.home.join("Documents/보관/a.pdf");
    put(&moved, "p");
    std::fs::remove_file(&old).unwrap();
    relink(&w.ctx(), &a.path, &moved).unwrap();
    assert_eq!(std::fs::read_link(&a.path).unwrap(), moved);
    // 집 파일(바로가기 아님)·홈 밖·폴더는 거절
    put(&d.join("집.txt"), "x");
    assert!(relink(&w.ctx(), &d.join("집.txt"), &moved).is_err());
    let out = tmp("relink-out");
    put(&out.join("b.pdf"), "b");
    assert!(relink(&w.ctx(), &a.path, &out.join("b.pdf")).is_err());
    assert!(relink(&w.ctx(), &a.path, &w.home.join("Documents")).is_err());
    assert_eq!(std::fs::read_link(&a.path).unwrap(), moved, "거절되면 그대로");
}

#[test]
fn candidates_rank_same_name_and_skip_locker() {
    let hits = vec!["/H/Documents/Chammo/운영/받은 것/a.pdf".to_string(), "/H/Documents/보관/a.pdf".into(), "/H/Library/x/a.pdf".into(), "/H/Desktop/b.pdf".into()];
    let v = rank_candidates(&hits, "a.pdf", Path::new("/H"), Path::new("/H/Documents/Chammo"));
    assert_eq!(v, vec![PathBuf::from("/H/Documents/보관/a.pdf")], "같은 이름만, 보관함·라이브러리 안은 빼고");
}

// ── 리뷰가 찾은 구멍(재현) ──

#[test]
fn restore_refuses_when_current_could_not_be_saved() {
    let w = W::new("rv1");
    let d = owner(&w);
    let p = d.join("큰.psd");
    std::fs::write(&p, "1판").unwrap();
    track_file_max(&p, 100);
    std::thread::sleep(std::time::Duration::from_millis(1100));
    std::fs::write(&p, "지금 판 — 판으로 못 남길 만큼 큼").unwrap();
    // 판 한도(5바이트)를 넘어 지금 판이 안 남는다 → 되돌리기 거절, 지금 내용 그대로
    assert!(restore_max(&p, 1, 5).is_err());
    assert_eq!(std::fs::read_to_string(&p).unwrap(), "지금 판 — 판으로 못 남길 만큼 큼");
}

#[test]
fn restore_refuses_shortcuts() {
    let w = W::new("rv9");
    let d = owner(&w);
    let f = w.home.join("Desktop/dev/x/a.txt");
    put(&f, "a");
    let a = add(&w.ctx(), &d, "", &f).unwrap();
    assert!(restore(&a.path, 1).is_err());
    assert_eq!(std::fs::read_to_string(&f).unwrap(), "a");
}

#[test]
fn migrate_same_name_size_but_different_content_is_kept() {
    let w = W::new("rv2");
    let files = w.data.join("locker/files");
    put(&files.join("1700000000000-a.txt"), "AAAA");
    let log = line(serde_json::json!({"op":"add","owner":"운영","path": files.join("1700000000000-a.txt"),"copy":true,"by":"me","ts":"t"}));
    std::fs::write(w.data.join("locker.jsonl"), &log).unwrap();
    let d = owner_dir(&w.root, "s-1", "운영").unwrap();
    put(&d.join("a.txt"), "BBBB");
    let owners = vec![Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() }];
    migrate(&w.ctx(), &owners).unwrap();
    assert_eq!(std::fs::read_to_string(d.join("a.txt")).unwrap(), "BBBB");
    assert_eq!(std::fs::read_to_string(d.join("a 2.txt")).unwrap(), "AAAA", "내용이 다르면 따로 옮긴다");
}

#[test]
fn give_refuses_symlinked_assets() {
    let w = W::new("rv3");
    let d = owner(&w);
    let proj = w.home.join("Desktop/dev/cloned");
    std::fs::create_dir_all(&proj).unwrap();
    let out = tmp("rv3-out");
    std::os::unix::fs::symlink(&out, proj.join("assets")).unwrap();
    put(&w.home.join("Downloads/a.png"), "img");
    let a = add(&w.ctx(), &d, "", &w.home.join("Downloads/a.png")).unwrap();
    assert!(give(&w.ctx(), &a.path, &proj).is_err());
    assert!(names(&out).is_empty(), "밖으로 안 새");
    assert_eq!(std::fs::read_to_string(&a.path).unwrap(), "img");
    assert!(std::fs::read_link(&a.path).is_err(), "집 그대로");
}

#[test]
fn take_back_keeps_target_other_lockers_still_use() {
    let w = W::new("rv4");
    let d = owner(&w);
    let d2 = owner_dir(&w.root, "s-2", "총무").unwrap();
    let proj = w.home.join("Desktop/dev/shop-video");
    std::fs::create_dir_all(&proj).unwrap();
    put(&w.home.join("Downloads/a.png"), "img");
    let a = add(&w.ctx(), &d, "", &w.home.join("Downloads/a.png")).unwrap();
    let to = give(&w.ctx(), &a.path, &proj).unwrap();
    std::os::unix::fs::symlink(&to, d2.join("a.png")).unwrap();
    take_back_in(&w.root, &w.home, &a.path).unwrap();
    assert_eq!(std::fs::read_to_string(&a.path).unwrap(), "img");
    assert!(to.is_file(), "다른 보관함이 아직 가리키면 지우지 않는다");
}

#[test]
fn take_back_resolves_relative_link_from_its_folder() {
    let w = W::new("rv4b");
    let d = owner(&w);
    let given = w.home.join("Desktop/dev/p/assets/보관함/r.txt");
    put(&given, "r");
    // 사람이 만든 상대 링크(../../../ 로 프로젝트를 가리킴) — 앱 현재 폴더 기준이 아니라 링크 폴더 기준으로 풀어야(참모 폴더 맨 위에서 홈까지 세 칸)
    let rel = PathBuf::from("../../../Desktop/dev/p/assets/보관함/r.txt");
    std::os::unix::fs::symlink(&rel, d.join("r.txt")).unwrap();
    take_back_in(&w.root, &w.home, &d.join("r.txt")).unwrap();
    assert_eq!(std::fs::read_to_string(d.join("r.txt")).unwrap(), "r");
    assert!(!given.exists());
}

#[test]
fn copy_never_follows_a_planted_part_link() {
    let w = W::new("rv6");
    let d = owner(&w);
    let victim = w.home.join("Documents/소중.txt");
    put(&victim, "소중");
    // 조각 자리에 누가 링크를 심어 둠
    std::os::unix::fs::symlink(&victim, d.join(format!(".a.txt{PART}"))).unwrap();
    put(&w.home.join("Downloads/a.txt"), "새것");
    add(&w.ctx(), &d, "", &w.home.join("Downloads/a.txt")).unwrap();
    assert_eq!(std::fs::read_to_string(&victim).unwrap(), "소중");
    assert_eq!(std::fs::read_to_string(d.join("a.txt")).unwrap(), "새것");
}

#[test]
fn folder_link_out_is_refused() {
    let w = W::new("rv8");
    let d = owner(&w);
    std::fs::remove_dir(d.join(BASE_FOLDER)).unwrap();
    let out = tmp("rv8-out");
    std::os::unix::fs::symlink(&out, d.join(BASE_FOLDER)).unwrap();
    put(&w.home.join("Downloads/a.txt"), "a");
    assert!(add(&w.ctx(), &d, BASE_FOLDER, &w.home.join("Downloads/a.txt")).is_err());
    assert!(names(&out).is_empty());
}

#[test]
fn rename_case_only_is_allowed() {
    let w = W::new("rv11");
    let d = owner(&w);
    put(&d.join("a.txt"), "a");
    assert_eq!(rename_entry(&d, "a.txt", "A.txt").unwrap(), "A.txt");
    assert_eq!(names(&d).iter().filter(|n| !n.starts_with('.') && !d.join(n).is_dir()).cloned().collect::<Vec<_>>(), vec!["A.txt"]);
}

// ── 홈·모드 ④: '받은 것' 없앰 — 새 파일은 보관함 맨 위, 옛 '받은 것' 안 파일은 맨 위로 한 번 ──

#[test]
fn add_without_folder_lands_at_top() {
    let w = W::new("top");
    let d = owner(&w);
    put(&w.home.join("Downloads/a.txt"), "a");
    assert_eq!(add(&w.ctx(), &d, "", &w.home.join("Downloads/a.txt")).unwrap().path, d.join("a.txt"));
    assert!(!d.join(OLD_INBOX).exists());
}

/// 옛 모양 참모 폴더 — '받은 것' 안에 집 파일(판 포함)·별칭·하위 폴더, 맨 위엔 같은 이름 파일
fn old_owner(w: &W) -> PathBuf {
    let d = w.root.join("운영");
    std::fs::create_dir_all(d.join(OLD_INBOX)).unwrap();
    std::fs::write(d.join(ID_FILE), "s-1\n").unwrap();
    put(&d.join(OLD_INBOX).join("견적.xlsx"), "x");
    put(&d.join(OLD_INBOX).join(".판/견적.xlsx/1.xlsx"), "x0");
    put(&d.join(OLD_INBOX).join("묶음/b.md"), "# b");
    let f = w.home.join("Desktop/dev/shop/cut.png");
    put(&f, "c");
    std::os::unix::fs::symlink(&f, d.join(OLD_INBOX).join("cut.png")).unwrap();
    put(&d.join("견적.xlsx"), "먼저 있던 것");
    d
}

#[test]
fn old_inbox_moves_to_top_once() {
    let w = W::new("inbox-mv");
    let d = old_owner(&w);
    let r = migrate_inbox(&w.data, &w.root).unwrap();
    assert_eq!(r.moved, 3);
    assert!(!d.join(OLD_INBOX).exists(), "비면 '받은 것' 폴더도 치운다");
    assert_eq!(std::fs::read_to_string(d.join("견적 2.xlsx")).unwrap(), "x", "이름 겹치면 번호 — 덮어쓰지 않는다");
    assert_eq!(std::fs::read_to_string(d.join("견적.xlsx")).unwrap(), "먼저 있던 것");
    assert!(d.join(".판/견적 2.xlsx/1.xlsx").is_file(), ".판 도 같이 간다");
    assert!(d.join("묶음/b.md").is_file(), "하위 폴더째");
    assert_eq!(std::fs::read_link(d.join("cut.png")).unwrap(), w.home.join("Desktop/dev/shop/cut.png"), "별칭은 별칭 그대로");
    assert!(d.join(BASE_FOLDER).is_dir(), "있던 참모에도 '자료' 한 번");
    assert!(w.data.join(INBOX_MARK).is_file());
    // 두 번째는 아무것도 안 한다 — 지운 '자료'도 다시 안 생긴다
    std::fs::remove_dir(d.join(BASE_FOLDER)).unwrap();
    put(&d.join(OLD_INBOX).join("뒤늦게.txt"), "z");
    assert_eq!(migrate_inbox(&w.data, &w.root).unwrap().moved, 0);
    assert!(!d.join(BASE_FOLDER).exists());
    assert!(d.join(OLD_INBOX).join("뒤늦게.txt").is_file());
}

#[test]
fn old_inbox_link_or_leftovers_are_left_alone() {
    let w = W::new("inbox-keep");
    let d = w.root.join("운영");
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(ID_FILE), "s-1\n").unwrap();
    let out = tmp("inbox-keep-out");
    put(&out.join("밖.txt"), "o");
    std::os::unix::fs::symlink(&out, d.join(OLD_INBOX)).unwrap();
    let r = migrate_inbox(&w.data, &w.root).unwrap();
    assert_eq!(r.moved, 0);
    assert!(out.join("밖.txt").is_file(), "링크로 된 '받은 것'은 안 따라간다");
    assert!(std::fs::symlink_metadata(d.join(OLD_INBOX)).unwrap().file_type().is_symlink());
}

#[test]
fn old_inbox_without_owners_still_marks_done() {
    let w = W::new("inbox-none");
    assert_eq!(migrate_inbox(&w.data, &w.root).unwrap().moved, 0);
    assert!(w.data.join(INBOX_MARK).is_file());
}

// ── 홈·모드 ⑤: 기록에서 내 폴더로 끌면 바로가기만(기록·집은 그대로) ──

#[test]
fn alias_makes_shortcut_only_and_keeps_home() {
    let w = W::new("alias");
    let d = owner(&w);
    // 보관함 맨 위 집 파일 → 자료에 바로가기, 집은 제자리
    put(&d.join("견적.xlsx"), "x");
    let at = alias(&w.ctx(), &d, BASE_FOLDER, &d.join("견적.xlsx")).unwrap();
    assert_eq!(at, d.join("자료/견적.xlsx"));
    assert_eq!(std::fs::read_link(&at).unwrap(), d.join("견적.xlsx"));
    assert!(d.join("견적.xlsx").is_file());
    // 같은 곳을 가리키는 바로가기가 이미 있으면 또 만들지 않는다
    assert_eq!(alias(&w.ctx(), &d, BASE_FOLDER, &d.join("견적.xlsx")).unwrap(), at);
    // 프로젝트 파일 → 바로가기, 별칭을 넘겨도 진짜 파일을 가리킨다
    let f = w.home.join("Desktop/dev/shop/cut.png");
    put(&f, "c");
    std::os::unix::fs::symlink(&f, d.join("cut.png")).unwrap();
    let at2 = alias(&w.ctx(), &d, BASE_FOLDER, &d.join("cut.png")).unwrap();
    assert_eq!(std::fs::read_link(&at2).unwrap(), f);
    // 거절: 폴더 없음·보관함 맨 위(빈 자리)·홈 밖·폴더·데이터 폴더
    assert!(alias(&w.ctx(), &d, "", &f).is_err(), "맨 위엔 바로가기를 안 만든다");
    assert!(alias(&w.ctx(), &d, "없는 폴더", &f).is_err());
    let out = tmp("alias-out");
    put(&out.join("밖.txt"), "o");
    assert!(alias(&w.ctx(), &d, BASE_FOLDER, &out.join("밖.txt")).is_err());
    assert!(alias(&w.ctx(), &d, BASE_FOLDER, &w.home.join("Desktop/dev/shop")).is_err());
    put(&w.data.join("accounts.json"), "{}");
    assert!(alias(&w.ctx(), &d, BASE_FOLDER, &w.data.join("accounts.json")).is_err());
}

// ── 홈·모드 ⑦: 보관함 머리 + → 새 문서(md)·새 엑셀(빈 xlsx) ──

#[test]
fn new_doc_makes_md_and_blank_xlsx_in_folder() {
    let w = W::new("newdoc");
    let d = owner(&w);
    let md = new_doc(&d, "", "md", "회의 메모").unwrap();
    assert_eq!(md, d.join("회의 메모.md"));
    assert_eq!(std::fs::read_to_string(&md).unwrap(), "# 회의 메모\n\n");
    assert_eq!(new_doc(&d, "", "md", "회의 메모").unwrap(), d.join("회의 메모 2.md"), "겹치면 번호");
    let x = new_doc(&d, BASE_FOLDER, "xlsx", "").unwrap();
    assert_eq!(x, d.join("자료/새 엑셀.xlsx"));
    let parts = crate::sheet::unzip(&std::fs::read(&x).unwrap()).unwrap();
    let list = crate::sheet::sheet_list(&parts).unwrap();
    assert_eq!(list.len(), 1, "시트 하나짜리 빈 통합 문서");
    assert!(new_doc(&d, "", "pdf", "x").is_err(), "문서·엑셀만");
    assert!(new_doc(&d, "../밖", "md", "x").is_err());
}

// ── 홈·모드 ⑧: 내 페이지(<데이터>/pages) → 첫 참모 보관함 '페이지' 폴더로 한 번(복사 → 확인, 옛 자리는 백업) ──

fn old_pages(w: &W) -> PathBuf {
    let p = w.data.join("pages");
    put(&p.join("올해 할 일.md"), "# 올해 할 일\n\n- 앱 출시\n");
    put(&p.join("올해 할 일/1분기.md"), "# 1분기\n");
    put(&p.join("거래처 메모.md"), "# 거래처 메모\n");
    put(&p.join("assets/a.png"), "png");
    p
}

#[test]
fn pages_move_into_first_owner_once_and_keep_backup() {
    let w = W::new("pages");
    let src = old_pages(&w);
    let first = Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() };
    let r = migrate_pages(&w.ctx(), Some(&first)).unwrap();
    assert_eq!(r.moved, 4);
    let d = w.root.join("운영").join(PAGES_FOLDER);
    assert_eq!(std::fs::read_to_string(d.join("올해 할 일.md")).unwrap(), "# 올해 할 일\n\n- 앱 출시\n");
    assert!(d.join("올해 할 일/1분기.md").is_file(), "하위 페이지는 같은 이름 폴더 그대로");
    assert!(d.join("assets/a.png").is_file());
    assert!(!src.exists(), "옛 자리는 비켜 준다");
    assert_eq!(std::fs::read_to_string(w.data.join("pages.bak/거래처 메모.md")).unwrap(), "# 거래처 메모\n", "지우지 않고 백업");
    assert!(w.data.join(PAGES_MARK).is_file());
    // 두 번째는 아무것도 안 한다(다시 생긴 pages 도 그대로)
    put(&src.join("새로.md"), "# 새로");
    assert_eq!(migrate_pages(&w.ctx(), Some(&first)).unwrap().moved, 0);
    assert!(src.join("새로.md").is_file());
}

#[test]
fn pages_folder_name_taken_gets_number() {
    let w = W::new("pages2");
    old_pages(&w);
    let d = owner_dir(&w.root, "s-1", "운영").unwrap();
    put(&d.join(PAGES_FOLDER).join("내 것.md"), "mine");
    let first = Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() };
    migrate_pages(&w.ctx(), Some(&first)).unwrap();
    assert_eq!(std::fs::read_to_string(d.join(PAGES_FOLDER).join("내 것.md")).unwrap(), "mine", "있던 폴더에 섞지 않는다");
    assert!(d.join(format!("{PAGES_FOLDER} 2")).join("거래처 메모.md").is_file());
}

#[test]
fn pages_copy_failure_keeps_original_and_does_not_mark() {
    use std::os::unix::fs::PermissionsExt;
    let w = W::new("pages3");
    let src = old_pages(&w);
    let bad = src.join("거래처 메모.md");
    std::fs::set_permissions(&bad, std::fs::Permissions::from_mode(0o000)).unwrap();
    let first = Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() };
    let r = migrate_pages(&w.ctx(), Some(&first));
    std::fs::set_permissions(&bad, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(r.is_err() || !r.unwrap().errors.is_empty());
    assert!(src.join("거래처 메모.md").is_file() && src.join("올해 할 일.md").is_file(), "원본은 그대로");
    assert!(!w.data.join(PAGES_MARK).exists(), "다음에 다시 시도");
}

#[test]
fn pages_without_old_folder_or_owner_just_mark_or_wait() {
    let w = W::new("pages4");
    assert_eq!(migrate_pages(&w.ctx(), None).unwrap().moved, 0);
    assert!(!w.data.join(PAGES_MARK).exists(), "참모가 없으면 기다린다");
    let first = Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() };
    assert_eq!(migrate_pages(&w.ctx(), Some(&first)).unwrap().moved, 0);
    assert!(w.data.join(PAGES_MARK).is_file(), "옮길 게 없으면 표시만");
}

// ── 판은 고치기 직전에만 — 이미 생긴 '원본과 같은 첫 판'은 한 번 휴지통으로(2026-10-11 실데이터: 페이지 옮기자마자 mp4·pptx 까지 두 벌) ──

/// 파일 + 그 파일과 크기·수정 시각이 같은 첫 판(훑기가 남긴 모양)
fn with_first_ver(p: &Path, body: &str) {
    put(p, body);
    track_file(p);
}

#[test]
fn same_first_versions_go_to_trash_once() {
    let w = W::new("vclean");
    let d = owner(&w);
    let bin = w.home.join(".Trash");
    with_first_ver(&d.join("영상.mp4"), "mp4");
    with_first_ver(&d.join("페이지/보고.pptx"), "pptx");
    // 첫 판 뒤 고쳐진 것 — 첫 판이 진짜 이전 판이라 남긴다
    with_first_ver(&d.join("고친.md"), "옛");
    std::thread::sleep(std::time::Duration::from_millis(1100));
    std::fs::write(d.join("고친.md"), "새로 고침").unwrap();
    // 판이 둘 — 손대지 않는다
    with_first_ver(&d.join("둘.txt"), "1");
    std::thread::sleep(std::time::Duration::from_millis(1100));
    std::fs::write(d.join("둘.txt"), "22").unwrap();
    track_file(&d.join("둘.txt"));
    let r = clean_first_versions(&w.data, &w.root, &bin).unwrap();
    assert_eq!(r.moved, 2);
    assert!(versions(&d.join("영상.mp4")).is_empty() && versions(&d.join("페이지/보고.pptx")).is_empty());
    assert!(!d.join(VERS).join("영상.mp4").exists(), "빈 판 폴더도 치운다");
    assert!(!d.join("페이지").join(VERS).exists());
    assert_eq!(versions(&d.join("고친.md")).len(), 1);
    assert_eq!(versions(&d.join("둘.txt")).len(), 2);
    assert_eq!(std::fs::read_to_string(d.join("영상.mp4")).unwrap(), "mp4", "원본은 그대로");
    assert_eq!(names(&bin).len(), 2, "지우지 않고 휴지통으로");
    assert!(w.data.join(VERS_CLEAN_MARK).is_file());
    // 두 번째는 아무것도 안 한다
    with_first_ver(&d.join("새로.txt"), "n");
    assert_eq!(clean_first_versions(&w.data, &w.root, &bin).unwrap().moved, 0);
    assert_eq!(versions(&d.join("새로.txt")).len(), 1);
}

// ── 첫 실행 — 보관함은 처음 열 때 만든다(0.3.0 2차: 켜자마자 문서·데스크탑 권한 창이 설명 없이 떴다) ──

#[test]
fn 처음엔_보관함을_안_건드리고_열면_만든다() {
    let w = W::new("firstopen");
    let o = Owner { key: "운영".into(), id: "s-1".into(), name: "운영".into() };
    put(&w.home.join("Desktop/a.txt"), "x");
    // 홈 화면이 나무를 읽어도(open = false) 문서 폴더에 아무것도 안 만든다
    let t = tree_at(&w.ctx(), "s-1", "운영", false, None).unwrap();
    assert!(!t.started && t.dir.is_empty() && t.entries.is_empty());
    // 앱을 켜면 도는 옮기기도 아무것도 안 한다(스크린샷 연결도 표식도 없다)
    let m = migrate_all(&w.ctx(), std::slice::from_ref(&o), None).unwrap();
    assert!(!m.shots);
    assert!(!w.root.exists(), "보관함 뿌리를 만들면 안 된다");
    assert!(!w.data.join(crate::locker_link::SHOTS_MARK).exists());
    // 보관함을 처음 열면 — 표식을 남기고 폴더를 만든다
    let t = tree_at(&w.ctx(), "s-1", "운영", true, None).unwrap();
    assert!(t.started && Path::new(&t.dir).is_dir());
    assert!(started(&w.data));
    // 그 뒤 옮기기에서 스크린샷 연결(화면이 한 줄 안내)
    let m = migrate_all(&w.ctx(), std::slice::from_ref(&o), None).unwrap();
    assert!(m.shots);
    // 다음부턴 홈에서 읽어도 그대로 보인다
    let t = tree_at(&w.ctx(), "s-1", "운영", false, None).unwrap();
    assert!(t.started && !t.dir.is_empty());
}

#[test]
fn 이미_쓰던_사람은_표식으로_그대로() {
    for mark in [crate::locker_link::SHOTS_MARK, DONE_MARK] {
        let w = W::new("already");
        put(&w.data.join(mark), "1");
        assert!(started(&w.data), "{mark}");
        let t = tree_at(&w.ctx(), "s-1", "운영", false, None).unwrap();
        assert!(t.started && Path::new(&t.dir).is_dir(), "{mark}");
    }
}

#[test]
fn screen_paths_use_os_separators() {
    // 윈도우 화면이 'C:\\…\\참모' + '/자료/a.md' 로 넘긴 경로(2026-10-21 리뷰 ⑦-8)
    assert_eq!(os_sep(r"C:\Users\Me\Documents\Chammo\참모/자료/a.md", true), r"C:\Users\Me\Documents\Chammo\참모\자료\a.md");
    assert_eq!(os_sep("/Users/me/Documents/Chammo/참모/자료/a.md", false), "/Users/me/Documents/Chammo/참모/자료/a.md");
}

#[test]
#[cfg(windows)]
fn windows_mixed_separators_are_plain_after_os_sep() {
    let mixed = r"C:\x\Chammo\o/자료/a.md";
    assert!(!plain_abs(Path::new(mixed)), "섞인 그대로는 정규형이 아니다");
    assert!(plain_abs(Path::new(&os_sep(mixed, true))));
}

fn owner_id_of_test(d: &Path) -> String {
    std::fs::read_to_string(d.join(ID_FILE)).unwrap().trim().to_string()
}
