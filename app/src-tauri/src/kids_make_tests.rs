//! 바로 만들기 시험 — 만들기 표시 읽기·틀로 첫 화면·작품 목록·작품 내주기(CSP·그림 넣기)·캐릭터 복사
use super::*;
use std::path::PathBuf;

fn home(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-kmake-{tag}-{}-{}", std::process::id(), crate::mobile_pair::random_hex(4).unwrap()));
    crate::kids::ensure_home(&d, "참모-2").unwrap()
}

#[test]
fn orders_are_read_and_removed_from_spoken_text() {
    let (said, orders) = parse_orders("좋아, 만들어 볼게!\n[만들기 game dino-pizza: 공룡이 피자 먹는 게임]");
    assert_eq!(said, "좋아, 만들어 볼게!");
    assert_eq!(orders, vec![Order { kind: Some("game".into()), name: "dino-pizza".into(), task: "공룡이 피자 먹는 게임".into() }]);
    let (said, orders) = parse_orders("두 마리로 바꿀게! [고치기 dino-pizza: 공룡 두 마리로]");
    assert_eq!(said, "두 마리로 바꿀게!");
    assert_eq!(orders[0].kind, None);
    // 모르는 종류는 game 으로, 이름은 영문 소문자·숫자·- 만(경로 글자 거름)
    let (_, o) = parse_orders("[만들기 movie ../../x: 춤추는 고양이]");
    assert_eq!((o[0].kind.as_deref(), o[0].name.as_str()), (Some("game"), "x"));
    assert_eq!(parse_orders("그냥 말").1, vec![]);
}

#[test]
fn new_work_starts_from_template_at_once() {
    let k = home("start");
    let o = Order { kind: Some("anim".into()), name: "cat-dance".into(), task: "고양이가 춤추는 그림".into() };
    assert!(start_in(&k, &o).unwrap(), "새 작품");
    let html = std::fs::read_to_string(k.join("works/cat-dance/index.html")).unwrap();
    assert!(html.contains("requestAnimationFrame") && html.contains("고양이가 춤추는 그림"), "틀 + 제목");
    // 이미 있으면 틀로 덮지 않는다(고치기)
    std::fs::write(k.join("works/cat-dance/index.html"), "<p>자란 것</p>").unwrap();
    assert!(!start_in(&k, &o).unwrap());
    assert_eq!(std::fs::read_to_string(k.join("works/cat-dance/index.html")).unwrap(), "<p>자란 것</p>");
    // 없는 작품을 고치라면 game 틀로 새로
    assert!(start_in(&k, &Order { kind: None, name: "new-one".into(), task: "점프".into() }).unwrap());
}

#[test]
fn works_list_newest_first_and_context_line() {
    let k = home("list");
    start_in(&k, &Order { kind: Some("card".into()), name: "mom-card".into(), task: "엄마 카드".into() }).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    start_in(&k, &Order { kind: Some("game".into()), name: "dino".into(), task: "공룡 점프".into() }).unwrap();
    let w = works_in(&k);
    assert_eq!(w.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), ["dino", "mom-card"]);
    assert_eq!(w[0].title, "공룡 점프");
    std::fs::create_dir_all(k.join("chars")).unwrap();
    std::fs::write(k.join("chars/토끼.png"), b"png").unwrap();
    let line = context_line(&k);
    assert!(line.contains("dino(공룡 점프)") && line.contains("mom-card(엄마 카드)") && line.contains("캐릭터: 토끼"), "{line}");
}

#[test]
fn served_work_has_csp_no_network_and_inlines_local_pictures() {
    let k = home("serve");
    std::fs::create_dir_all(k.join("works/w/img")).unwrap();
    std::fs::create_dir_all(k.join("chars")).unwrap();
    std::fs::write(k.join("chars/곰.png"), [0x89, b'P', b'N', b'G']).unwrap();
    std::fs::write(k.join("works/w/img/a.svg"), "<svg/>").unwrap();
    std::fs::write(k.join("works/w/index.html"), r#"<html><head><title>t</title></head><body><img src="../../chars/곰.png"><img src="img/a.svg"><img src="https://evil.example/x.png"><img src="../../../../etc/passwd"></body></html>"#).unwrap();
    let h = serve_work(&k, "w").unwrap();
    assert!(h.contains("connect-src 'none'") && h.contains("default-src 'none'"), "CSP 머리");
    assert!(h.contains("data:image/png;base64,"), "아이 집 안 그림은 data: 로");
    assert!(h.contains("data:image/svg+xml;base64,"));
    assert!(!h.contains("evil.example") || h.contains("src=\"\""), "밖 주소는 비운다");
    assert!(!h.contains("passwd"), "집 밖 경로는 비운다");
    assert!(serve_work(&k, "../x").is_err());
}

#[test]
fn characters_copied_read_only_images_only() {
    let k = home("chars");
    let src = k.parent().unwrap().join("locker-캐릭터");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(src.join("토끼.png"), PNG).unwrap();
    std::fs::write(src.join("메모.txt"), b"x").unwrap();
    assert_eq!(sync_chars_in(&k, &src).unwrap(), 1);
    assert!(k.join("chars/토끼.png").exists() && !k.join("chars/메모.txt").exists());
    // 원본에서 빠지면 아이 집에서도 빠진다
    std::fs::remove_file(src.join("토끼.png")).unwrap();
    assert_eq!(sync_chars_in(&k, &src).unwrap(), 0);
    assert!(!k.join("chars/토끼.png").exists());
}

const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];

#[test]
fn characters_follow_linked_series_folders_one_level() {
    // 진짜 모양(11-18 선생님 보관함): 캐릭터/<시리즈>/<캐릭터>-N.png, 시리즈 폴더는 보관함 밖 kids-characters/out/<시리즈> 를 가리키는 링크
    let k = home("series");
    let base = k.parent().unwrap().to_path_buf();
    let out = base.join("kids-characters-out");
    for (series, files) in [("pororo", vec!["crong-1.png", "pororo-1.png", "pororo-2.png"]), ("moana", vec!["moana-1.png", "maui-1.png"])] {
        std::fs::create_dir_all(out.join(series)).unwrap();
        for f in files {
            std::fs::write(out.join(series).join(f), PNG).unwrap();
        }
    }
    std::fs::write(out.join("pororo/readme.txt"), b"x").unwrap();
    std::fs::write(out.join("pororo/run.sh"), b"#!/bin/sh").unwrap();
    std::fs::write(out.join("pororo/fake.png"), b"not a picture at all").unwrap(); // 확장자만 그림 — 내용이 아니면 안 가져간다
    std::fs::create_dir_all(out.join("pororo/deeper")).unwrap();
    std::fs::write(out.join("pororo/deeper/too-deep.png"), PNG).unwrap(); // 두 단계 아래는 안 본다
    let src = base.join("locker/캐릭터");
    std::fs::create_dir_all(&src).unwrap();
    for series in ["pororo", "moana"] {
        std::os::unix::fs::symlink(out.join(series), src.join(series)).unwrap();
    }
    std::fs::write(src.join("top.png"), PNG).unwrap(); // 맨 위 그림도 그대로
    let n = sync_chars_in(&k, &src).unwrap();
    let mut names = char_names(&k);
    names.sort();
    assert_eq!(names, ["moana-1", "moana-maui-1", "pororo-1", "pororo-2", "pororo-crong-1", "top"], "시리즈가 보이는 이름, 시리즈 이름으로 시작하면 그대로");
    assert_eq!(n, 6);
    assert!(std::fs::symlink_metadata(k.join("chars/pororo-crong-1.png")).is_ok_and(|m| m.is_file()), "링크가 아니라 복사본");
}

#[test]
fn characters_capped_and_names_never_collide() {
    let k = home("cap");
    let src = k.parent().unwrap().join("many");
    std::fs::create_dir_all(src.join("a")).unwrap();
    std::fs::write(src.join("a/x.png"), PNG).unwrap();
    std::fs::write(src.join("a-x.png"), PNG).unwrap(); // 맨 위 a-x 와 a/x 가 같은 이름이 된다
    for i in 0..200 {
        std::fs::write(src.join(format!("p{i:03}.png")), PNG).unwrap();
    }
    let n = sync_chars_in(&k, &src).unwrap();
    assert_eq!(n, CHAR_CAP, "상한");
    let names = char_names(&k);
    assert_eq!(names.len(), CHAR_CAP);
    let mut uniq = names.clone();
    uniq.dedup();
    assert_eq!(uniq.len(), names.len(), "이름이 겹치지 않는다");
    assert!(names.contains(&"a-x".to_string()) && names.contains(&"a-x-2".to_string()), "{names:?}");
}

// 진짜 보관함 폴더로 몇 장이 들어오나(읽기만 — 복사는 임시 아이 집으로)
//   KIDS_CHARS_SRC="$HOME/Documents/Chammo/참모-5 · 선생님 2/캐릭터" cargo test kids_make::tests::real_chars_count -- --ignored --nocapture
#[test]
#[ignore]
fn real_chars_count() {
    let src = PathBuf::from(std::env::var("KIDS_CHARS_SRC").expect("KIDS_CHARS_SRC"));
    let k = home("real");
    let n = sync_chars_in(&k, &src).unwrap();
    let names = char_names(&k);
    println!("복사 {n}장 · 이름 예: {:?}", names.iter().step_by(10).collect::<Vec<_>>());
    assert!(n > 0);
}
