use super::*;
use crate::locker_fs::{self, Ctx};
use crate::locker_link::{connect, trash_any};
use std::path::{Path, PathBuf};

/// 가짜 홈 한 벌 — 진짜 바탕화면·문서 폴더·스크린샷은 안 건드린다
fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-lockertrash-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::canonicalize(d).unwrap()
}

fn put(p: &Path, body: &str) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

struct W {
    home: PathBuf,
    data: PathBuf,
    root: PathBuf,
    owner: PathBuf,
    bin: PathBuf,
    /// 자리 잡은 곳(devRoot) — 바탕화면 안 work/dev
    settled: Vec<PathBuf>,
}
impl W {
    /// 사고 난 바탕화면 모양 — devRoot 가 바탕화면 안, 거래처 폴더 안에 저장소, 돌고 있는 세션 작업 폴더, 그냥 폴더·파일. 바탕화면을 '바탕화면'으로 연결
    fn new(name: &str) -> W {
        let home = tmp(name);
        let data = home.join(".chammo");
        std::fs::create_dir_all(&data).unwrap();
        let root = home.join("Documents/Chammo");
        let owner = locker_fs::owner_dir(&root, "s-1", "운영").unwrap();
        let bin = home.join(".Trash");
        std::fs::create_dir_all(&bin).unwrap();
        let desk = home.join("Desktop");
        put(&desk.join("work/dev/앱/src/main.rs"), "fn main(){}");
        put(&desk.join("저장소/.git/HEAD"), "ref");
        put(&desk.join("저장소/README.md"), "x");
        put(&desk.join("거래처/가나/사이트/.git/HEAD"), "ref");
        put(&desk.join("거래처/가나/견적.xlsx"), "x");
        put(&desk.join("일터/세션자리/a.md"), "x");
        put(&desk.join("묶음/a.txt"), "a");
        put(&desk.join("묶음/안/b.txt"), "b");
        put(&desk.join("메모.txt"), "m");
        put(&desk.join("사진.png"), "p");
        let w = W { settled: vec![desk.join("work/dev")], home, data, root, owner, bin };
        connect(&w.ctx(), &w.owner, "", &desk, Some("바탕화면")).unwrap();
        w
    }
    fn ctx(&self) -> Ctx<'_> {
        Ctx { home: &self.home, data: &self.data, root: &self.root, settled: &self.settled }
    }
    fn desk(&self) -> PathBuf {
        self.home.join("Desktop")
    }
    /// 지킬 자리 = 자리 잡은 곳 + 돌고 있는 세션 작업 폴더
    fn keep(&self) -> Vec<PathBuf> {
        let mut v = self.settled.clone();
        v.push(self.desk().join("일터/세션자리"));
        v
    }
    fn bin_count(&self) -> usize {
        std::fs::read_dir(&self.bin).unwrap().count()
    }
}

// ── 최후 방어 — 화면을 믿지 않고 Rust 가 거절 ──

#[test]
fn refuses_repos_dev_root_session_folders_even_with_the_folder_flag() {
    let w = W::new("guard");
    let keep = w.keep();
    let g = Guard { keep: &keep, folders_ok: true };
    for (rel, why) in [
        ("바탕화면/work", "devRoot 의 조상"),
        ("바탕화면/work/dev", "devRoot 자체"),
        ("바탕화면/저장소", ".git 이 있는 폴더"),
        ("바탕화면/거래처", "안쪽 깊이 저장소가 있는 폴더"),
        ("바탕화면/거래처/가나", "안쪽에 저장소"),
        ("바탕화면/일터", "돌고 있는 세션 작업 폴더의 조상"),
        ("바탕화면/일터/세션자리", "돌고 있는 세션 작업 폴더"),
    ] {
        assert!(trash_any(&w.ctx(), &w.owner, rel, &w.bin, &g).is_err(), "거절해야: {rel} ({why})");
    }
    assert_eq!(w.bin_count(), 0, "하나도 안 갔다");
    assert!(w.desk().join("work/dev/앱/src/main.rs").exists() && w.desk().join("거래처/가나/사이트/.git/HEAD").exists());
    // 평범한 폴더는 확인 플래그가 있으면 간다
    trash_any(&w.ctx(), &w.owner, "바탕화면/묶음", &w.bin, &g).unwrap();
    assert!(w.bin.join("묶음/안/b.txt").exists());
}

#[test]
fn folders_need_the_flag() {
    let w = W::new("flag");
    let keep = w.keep();
    let no = Guard { keep: &keep, folders_ok: false };
    assert!(trash_any(&w.ctx(), &w.owner, "바탕화면/묶음", &w.bin, &no).is_err(), "폴더는 '폴더 포함' 확인 없이는 거절");
    assert!(w.desk().join("묶음/a.txt").exists());
    trash_any(&w.ctx(), &w.owner, "바탕화면/메모.txt", &w.bin, &no).unwrap();
    assert!(w.bin.join("메모.txt").exists(), "파일은 그냥 간다");
}

#[test]
fn refuses_standard_home_folders_data_and_locker_root() {
    let w = W::new("std");
    let keep = w.keep();
    for d in ["Desktop", "Documents", "Downloads", "Pictures", "Movies", "Music", "Public", "Applications", "Library"] {
        std::fs::create_dir_all(w.home.join(d)).unwrap();
        assert!(refuse(&w.ctx(), &keep, &w.home.join(d)).is_err(), "홈 바로 아래 표준 폴더 자체: {d}");
    }
    assert!(refuse(&w.ctx(), &keep, &w.home).is_err(), "홈 자체");
    assert!(refuse(&w.ctx(), &keep, w.home.parent().unwrap()).is_err(), "홈의 조상");
    assert!(refuse(&w.ctx(), &keep, &w.data).is_err(), "앱 데이터 폴더");
    put(&w.data.join("config.json"), "{}");
    assert!(refuse(&w.ctx(), &keep, &w.data.join("config.json")).is_err(), "앱 데이터 폴더 안");
    assert!(refuse(&w.ctx(), &keep, &w.root).is_err(), "보관함 뿌리");
    assert!(refuse(&w.ctx(), &keep, &w.home.join("Documents/Chammo")).is_err());
    // 표준 폴더 '안'의 평범한 것은 된다
    put(&w.home.join("Documents/편지.txt"), "x");
    assert!(refuse(&w.ctx(), &keep, &w.home.join("Documents/편지.txt")).is_ok());
    assert!(refuse(&w.ctx(), &keep, &w.desk().join("묶음")).is_ok());
}

#[test]
fn locker_inside_the_test_data_folder_still_trashes() {
    // 시험 데이터 폴더면 보관함 뿌리가 데이터 폴더 안(Documents-Chammo) — 그 안 파일은 데이터 폴더 검사에 안 걸린다
    let home = tmp("dataroot");
    let data = home.join(".chammo");
    let root = data.join("Documents-Chammo");
    let owner = locker_fs::owner_dir(&root, "s-1", "운영").unwrap();
    put(&owner.join("자료/c.md"), "C");
    put(&owner.join("자료/d.md"), "D");
    let bin = home.join(".Trash");
    std::fs::create_dir_all(&bin).unwrap();
    let ctx = Ctx { home: &home, data: &data, root: &root, settled: &[] };
    trash_any(&ctx, &owner, "자료/c.md", &bin, &Guard { keep: &[], folders_ok: false }).unwrap();
    assert!(bin.join("c.md").exists());
    assert!(trash_any(&ctx, &owner, "자료", &bin, &Guard { keep: &[], folders_ok: false }).is_err(), "보관함 안 폴더도 플래그 없이는 거절");
    trash_any(&ctx, &owner, "자료", &bin, &Guard { keep: &[], folders_ok: true }).unwrap();
}

// ── 묶음 — ⌘A 를 흉내 ──

#[test]
fn select_all_batch_without_flag_moves_nothing() {
    let w = W::new("all");
    let keep = w.keep();
    let all: Vec<String> = ["work", "저장소", "거래처", "일터", "묶음", "메모.txt", "사진.png"].iter().map(|n| format!("바탕화면/{n}")).collect();
    let r = trash_batch(&w.ctx(), &w.owner, &all, &w.bin, &Guard { keep: &keep, folders_ok: false });
    assert!(r.is_err(), "폴더가 섞인 묶음은 플래그 없이 통째로 거절");
    assert_eq!(w.bin_count(), 0, "파일도 하나도 안 갔다");
    // 플래그가 있어도 지킬 자리는 빠지고 나머지만
    let d = trash_batch(&w.ctx(), &w.owner, &all, &w.bin, &Guard { keep: &keep, folders_ok: true }).unwrap();
    assert_eq!(d.moved, 3, "묶음·메모·사진만");
    assert_eq!(d.errors.len(), 4);
    for kept in ["work/dev/앱/src/main.rs", "저장소/.git/HEAD", "거래처/가나/견적.xlsx", "일터/세션자리/a.md"] {
        assert!(w.desk().join(kept).exists(), "남아야: {kept}");
    }
}

#[test]
fn plan_counts_files_folders_and_items_inside() {
    let w = W::new("plan");
    let keep = w.keep();
    let rels: Vec<String> = ["묶음", "메모.txt", "사진.png", "저장소"].iter().map(|n| format!("바탕화면/{n}")).collect();
    let p = plan(&w.ctx(), &w.owner, &rels, &keep);
    assert_eq!((p.files, p.dirs, p.empties, p.inside, p.more), (2, 1, 0, 2, false), "파일 2·폴더 1(안에 a.txt·안/b.txt — 카드 숫자처럼 폴더는 안 센다)");
    assert_eq!(p.blocked.len(), 1);
    assert_eq!(p.blocked[0].rel, "바탕화면/저장소");
    assert_eq!(p.file_rels, vec!["바탕화면/메모.txt".to_string(), "바탕화면/사진.png".into()]);
    assert_eq!(w.bin_count(), 0, "세기만 한다");
}

// ── 되돌리기 ──

#[test]
fn undo_puts_the_last_batch_back_even_after_restart() {
    let w = W::new("undo");
    let keep = w.keep();
    put(&w.owner.join("자료/c.md"), "C");
    let rels: Vec<String> = vec!["바탕화면/묶음".into(), "바탕화면/메모.txt".into(), "자료/c.md".into()];
    let d = trash_batch(&w.ctx(), &w.owner, &rels, &w.bin, &Guard { keep: &keep, folders_ok: true }).unwrap();
    assert_eq!(d.moved, 3);
    assert!(!w.desk().join("묶음").exists());
    // 앱을 다시 켜도(기록은 데이터 폴더 파일) 마지막 묶음이 보인다
    let l = last(&w.data).unwrap();
    assert_eq!(l.count, 3);
    let u = undo_last(&w.data).unwrap();
    assert_eq!(u.restored, 3);
    assert!(u.errors.is_empty());
    assert_eq!(std::fs::read_to_string(w.desk().join("묶음/안/b.txt")).unwrap(), "b");
    assert!(w.desk().join("메모.txt").exists() && w.owner.join("자료/c.md").exists());
    assert_eq!(w.bin_count(), 0);
    assert!(last(&w.data).is_none(), "다 되돌리면 기록도 없다");
    assert!(undo_last(&w.data).is_err());
}

#[test]
fn undo_never_overwrites_and_keeps_what_it_could_not_restore() {
    let w = W::new("undo2");
    let keep = w.keep();
    let rels: Vec<String> = vec!["바탕화면/메모.txt".into(), "바탕화면/사진.png".into()];
    trash_batch(&w.ctx(), &w.owner, &rels, &w.bin, &Guard { keep: &keep, folders_ok: false }).unwrap();
    put(&w.desk().join("메모.txt"), "새것"); // 그 자리에 새 파일이 생겼다
    let u = undo_last(&w.data).unwrap();
    assert_eq!(u.restored, 1);
    assert_eq!(u.errors.len(), 1);
    assert_eq!(std::fs::read_to_string(w.desk().join("메모.txt")).unwrap(), "새것", "덮어쓰지 않는다");
    assert_eq!(last(&w.data).unwrap().count, 1, "못 되돌린 것만 남는다");
}

#[test]
fn a_new_batch_replaces_the_last_one() {
    let w = W::new("undo3");
    let keep = w.keep();
    let g = Guard { keep: &keep, folders_ok: false };
    trash_batch(&w.ctx(), &w.owner, &["바탕화면/메모.txt".to_string()], &w.bin, &g).unwrap();
    trash_batch(&w.ctx(), &w.owner, &["바탕화면/사진.png".to_string()], &w.bin, &g).unwrap();
    assert_eq!(last(&w.data).unwrap().count, 1);
    undo_last(&w.data).unwrap();
    assert!(w.desk().join("사진.png").exists() && !w.desk().join("메모.txt").exists(), "마지막 묶음만");
}

// ── 안에 든 것이 있는 폴더 — 같이 버리기 / 꺼내고 폴더만 / 다른 폴더로 옮기고 폴더만(2026-10-12 사용자) ──

/// 보관함 '페이지' 폴더 — 안에 파일 둘 + assets(파일 하나·바로가기 하나) + 숨은 파일
fn page_folder(w: &W) {
    put(&w.owner.join("페이지/a.md"), "a");
    put(&w.owner.join("페이지/b.md"), "b");
    put(&w.owner.join("페이지/assets/c.png"), "c");
    put(&w.owner.join("페이지/.DS_Store"), "x");
    put(&w.home.join("Pictures/원본.png"), "o");
    std::os::unix::fs::symlink(w.home.join("Pictures/원본.png"), w.owner.join("페이지/assets/원본.png")).unwrap();
    put(&w.owner.join("a.md"), "겹침"); // 위 폴더에 같은 이름
}

#[test]
fn inside_count_matches_the_folder_card() {
    // 카드 숫자 = 하위 폴더까지 보이는 파일·바로가기(폴더 자체·숨은 파일은 안 센다)
    let w = W::new("cnt");
    page_folder(&w);
    let p = plan(&w.ctx(), &w.owner, &["페이지".to_string()], &[]);
    assert_eq!((p.dirs, p.inside), (1, 4), "a.md·b.md·assets/c.png·assets/원본.png");
    let es = locker_fs::tree_in(&w.owner, Some(&w.home));
    let card = es.iter().filter(|e| !e.dir && e.rel.starts_with("페이지/")).count();
    assert_eq!(card, p.inside, "화면 카드가 세는 것과 같다");
    assert!(p.lift_ok, "보관함 폴더는 꺼내기·옮기기가 된다");
}

#[test]
fn empty_or_hidden_only_folder_goes_without_asking() {
    let w = W::new("empty");
    put(&w.owner.join("빈/.DS_Store"), "x");
    std::fs::create_dir_all(w.owner.join("빈2/안도빈")).unwrap();
    let p = plan(&w.ctx(), &w.owner, &["빈".to_string(), "빈2".to_string()], &[]);
    assert_eq!((p.dirs, p.empties), (0, 2), "숨은 파일·빈 하위 폴더뿐이면 빈 폴더");
    let d = trash_batch(&w.ctx(), &w.owner, &["빈".to_string(), "빈2".to_string()], &w.bin, &Guard { keep: &[], folders_ok: false }).unwrap();
    assert_eq!(d.moved, 2, "빈 폴더는 플래그 없이 간다");
}

#[test]
fn lift_contents_up_then_trash_the_folder() {
    let w = W::new("lift");
    page_folder(&w);
    let d = empty_out_batch(&w.ctx(), &w.owner, &["페이지".to_string()], None, &w.bin, &Guard { keep: &[], folders_ok: false }).unwrap();
    assert_eq!(d.moved, 1);
    assert!(!w.owner.join("페이지").exists());
    assert_eq!(std::fs::read_to_string(w.owner.join("a.md")).unwrap(), "겹침", "원래 있던 건 그대로");
    assert_eq!(std::fs::read_to_string(w.owner.join("a 2.md")).unwrap(), "a", "겹치면 ' 2'");
    assert!(w.owner.join("b.md").exists() && w.owner.join("assets/c.png").exists());
    assert!(std::fs::symlink_metadata(w.owner.join("assets/원본.png")).unwrap().file_type().is_symlink(), "바로가기는 바로가기째");
    assert!(w.bin.join("페이지/.DS_Store").exists(), "숨은 것만 폴더와 같이 휴지통");
    // 되돌리기 — 폴더가 돌아오고 꺼낸 것도 제자리로
    let u = undo_last(&w.data).unwrap();
    assert!(u.errors.is_empty(), "{:?}", u.errors);
    assert_eq!(std::fs::read_to_string(w.owner.join("페이지/a.md")).unwrap(), "a");
    assert!(w.owner.join("페이지/assets/c.png").exists() && !w.owner.join("a 2.md").exists() && !w.owner.join("assets").exists());
    assert_eq!(std::fs::read_to_string(w.owner.join("a.md")).unwrap(), "겹침");
}

#[test]
fn move_contents_to_another_folder_then_trash() {
    let w = W::new("mvout");
    page_folder(&w);
    std::fs::create_dir_all(w.owner.join("자료")).unwrap();
    empty_out_batch(&w.ctx(), &w.owner, &["페이지".to_string()], Some("자료"), &w.bin, &Guard { keep: &[], folders_ok: false }).unwrap();
    assert!(w.owner.join("자료/a.md").exists() && w.owner.join("자료/assets/c.png").exists());
    assert!(!w.owner.join("페이지").exists());
    // 자기 안으로·없는 곳·연결 폴더 안쪽 폴더는 거절, 아무것도 안 옮긴다
    page_folder_again(&w);
    for (to, why) in [(Some("페이지/assets"), "자기 안"), (Some("없는곳"), "없는 폴더")] {
        assert!(empty_out_batch(&w.ctx(), &w.owner, &["페이지".to_string()], to, &w.bin, &Guard { keep: &[], folders_ok: false }).is_err(), "{why}");
        assert!(w.owner.join("페이지/b.md").exists(), "{why} — 그대로");
    }
}

fn page_folder_again(w: &W) {
    put(&w.owner.join("페이지/b.md"), "b");
    put(&w.owner.join("페이지/assets/d.png"), "d");
}

#[test]
fn lift_refuses_folders_inside_a_connection() {
    // 연결 폴더 안쪽은 읽기 전용 — 꺼내기·옮기기 없이 '같이 휴지통'만
    let w = W::new("liftlink");
    let p = plan(&w.ctx(), &w.owner, &["바탕화면/묶음".to_string()], &[]);
    assert!(!p.lift_ok);
    assert!(empty_out_batch(&w.ctx(), &w.owner, &["바탕화면/묶음".to_string()], None, &w.bin, &Guard { keep: &[], folders_ok: false }).is_err());
    assert!(w.desk().join("묶음/a.txt").exists() && !w.desk().join("a.txt").exists());
}

#[test]
fn lift_with_loose_files_trashes_them_in_the_same_batch() {
    // 파일과 폴더를 같이 골라 '꺼내고 폴더만' — 파일은 휴지통, 폴더 안의 것은 위로, 되돌리기는 한 묶음
    let w = W::new("liftmix");
    page_folder(&w);
    put(&w.owner.join("버릴.md"), "x");
    let d = empty_out_batch(&w.ctx(), &w.owner, &["버릴.md".to_string(), "페이지".to_string()], None, &w.bin, &Guard { keep: &[], folders_ok: false }).unwrap();
    assert_eq!(d.moved, 2);
    assert!(w.bin.join("버릴.md").exists() && w.owner.join("b.md").exists());
    assert_eq!(last(&w.data).unwrap().count, 2);
    undo_last(&w.data).unwrap();
    assert!(w.owner.join("버릴.md").exists() && w.owner.join("페이지/b.md").exists());
}

#[test]
fn refuses_home_and_its_parents_even_when_data_lives_elsewhere() {
    // 데이터·보관함이 홈 밖이어도(검사가 서로 가리지 않게) 홈과 그 위는 거절
    let home = tmp("homeup");
    let other = tmp("homeup-data");
    let (data, root) = (other.join("data"), other.join("root"));
    std::fs::create_dir_all(&data).unwrap();
    std::fs::create_dir_all(&root).unwrap();
    let ctx = Ctx { home: &home, data: &data, root: &root, settled: &[] };
    assert!(refuse(&ctx, &[], &home).is_err(), "홈 자체");
    assert!(refuse(&ctx, &[], home.parent().unwrap()).is_err(), "홈의 위");
    put(&home.join("그냥/a.txt"), "x");
    assert!(refuse(&ctx, &[], &home.join("그냥")).is_ok());
}
