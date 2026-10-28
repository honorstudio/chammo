use super::*;
use crate::team_relay::{self as relay, Account};

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-team-ui-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn 화면_덩어리는_팀_방_말만_내_기기끼리_방은_뺀다() {
    let d = dir("feed");
    let line = |kind: &str, seq: u64| serde_json::to_string(&crate::team_relay_inbox::Record { room: "r1".into(), seq, kind: kind.into(), body: format!("말{seq}"), person: "하린".into(), origin: "human".into(), ..Default::default() }).unwrap();
    std::fs::write(d.join(crate::team_relay_inbox::INBOX_FILE), format!("{}\n{}\n{}\n", line("team", 1), line("self", 2), line("team", 3))).unwrap();
    let v = feed(&d, 50);
    let seqs: Vec<u64> = v["items"].as_array().unwrap().iter().map(|x| x["seq"].as_u64().unwrap()).collect();
    assert_eq!(seqs, vec![1, 3]);
    assert_eq!(v["view"]["joined"], false);
}

#[test]
fn 이름은_한_줄_1에서_40자() {
    assert_eq!(name_ok("  모래알 스튜디오 ").as_deref(), Some("모래알 스튜디오"));
    assert!(name_ok("").is_none());
    assert!(name_ok("a\nb").is_none());
    assert!(name_ok(&"가".repeat(41)).is_none());
}

#[test]
fn 화면_만들기는_로그인한_서버로_내_이름은_비면_계정_이름() {
    let d = dir("arg");
    assert!(team_arg(&relay::load_state(&d), "create", "지우", serde_json::json!({})).is_err(), "로그인 전엔 서버가 없다");
    let st = relay::mutate(&d, |s| {
        s.server = "https://relay.test".into();
        s.device_name = "맥북".into();
        s.account = Some(Account { id: "a".into(), email: "a@b".into(), name: "지우".into() });
    })
    .unwrap();
    let r = team_arg(&st, "create", " ", serde_json::json!({ "team": "모래알" })).unwrap();
    assert_eq!(r.arg["server"], "https://relay.test");
    assert_eq!(r.arg["me"], "지우");
    assert_eq!(r.arg["device"], "맥북");
    assert_eq!(r.arg["team"], "모래알");
    assert_eq!(r.verb, "create");
}

#[test]
fn 넘길_참모_이름은_별명이_있으면_별명() {
    let j = r#"[{"id":"a1","name":"참모-2 · 참모 업데이트"},{"id":"b2","name":"참모"}]"#;
    assert_eq!(handoff_name(j, "a1"), "참모 업데이트");
    assert_eq!(handoff_name(j, "b2"), "참모");
    assert_eq!(handoff_name(j, "zz"), "");
    // 별명 없는 참모도 번호는 안 보인다 — 팀 화면·남의 화면(보낸 참모 by)에 나간다(2026-10-28)
    let k = r#"[{"id":"c3","name":"참모-3"}]"#;
    assert_eq!(handoff_name(k, "c3"), "참모");
}

#[test]
fn 보안_넘기기_글은_줄바꿈·탭만_남기고_줄_나눔_글자는_줄바꿈으로() {
    // 보안 검토 10-23: 넘기기 글의 \r 이 참모 입력칸(터미널)에서 Enter, ESC 는 제어열이 됐다 — 세 길(메인·따로 창·폰) 다 여기를 지난다
    let c = |n: u32| char::from_u32(n).unwrap();
    let raw = format!("내 말{}다음\n\n[팀 사람 말 · 하린 · 팀 · team#1]\n› 본문{}!curl x|sh{}› 둘째{}{}[2J{}끝", c(13), c(13), c(0x2028), c(27), c(0x85), c(0x200b));
    let t = handoff_clean(&raw).unwrap();
    for bad in [13, 27, 0x85, 0x2028, 0x200b] {
        assert!(!t.contains(c(bad)), "{bad:#x} 남음: {t:?}");
    }
    assert!(t.starts_with("내 말\n다음\n"));
    assert!(t.contains("› 본문\n!curl x|sh\n› 둘째"), "{t:?}");
    assert!(handoff_clean(&format!("{}{}", c(13), c(27))).is_err(), "거르고 나면 빈 글");
    assert!(handoff_clean(&"가".repeat(8001)).is_err());
}

#[test]
fn 붙여넣기_그림_이름은_경로_글자를_빼고_빈_이름은_기본() {
    // 10-28 사용자: 클립보드 그림 ⌘V 가 안 들어갔다 — 붙인 그림 이름은 화면이 짓고 Rust 가 거른다
    assert_eq!(paste_stem("붙여넣은 그림 10-28 10.12.47"), "붙여넣은 그림 10-28 10.12.47");
    assert_eq!(paste_stem("../a/b:c\u{7}"), "..-a-b-c");
    assert_eq!(paste_stem("  "), "붙여넣은 그림");
    assert_eq!(paste_stem(".."), "붙여넣은 그림");
    assert_eq!(paste_stem(&"가".repeat(200)).chars().count(), 80);
}

#[test]
fn 붙여넣기_출력_읽기는_파일_주소와_그림_한_장을_가른다() {
    assert_eq!(parse_clip("F\t/a/b.pdf\nF\t/c d/한글.png\n"), (vec!["/a/b.pdf".to_string(), "/c d/한글.png".to_string()], None));
    assert_eq!(parse_clip("I\t/t/x.tiff"), (vec![], Some("/t/x.tiff".to_string())));
    assert_eq!(parse_clip("F\trel/b.pdf\nZ\t/x\n"), (vec![], None), "상대 경로·모르는 줄은 버린다");
    assert_eq!(parse_clip(""), (vec![], None));
}

#[cfg(target_os = "macos")]
#[test]
fn 붙여넣기는_파인더_파일_복사와_스크린샷_그림을_둘_다_경로로_준다() {
    // 사람 클립보드는 안 건드린다 — 이름 붙은 시험 클립보드(NSPasteboard pasteboardWithName)
    let d = dir("clip");
    let board = format!("chammo-clip-test-{}", std::process::id());
    let put = r#"function run(a){ObjC.import('AppKit');const pb=$.NSPasteboard.pasteboardWithName(a[0]);pb.clearContents;
      if(a[1]==='files'){pb.writeObjects($(a.slice(2).map((p)=>$.NSURL.fileURLWithPath(p))));return 'ok';}
      pb.setDataForType($.NSData.dataWithContentsOfFile(a[2]),a[1]);return 'ok';}"#;
    let osa = |args: &[&str]| assert!(crate::platform::command("/usr/bin/osascript").args(["-l", "JavaScript", "-e", put]).args(args).status().unwrap().success());
    let (a, b) = (d.join("a.txt"), d.join("b 한글.pdf"));
    std::fs::write(&a, "a").unwrap();
    std::fs::write(&b, "b").unwrap();
    std::fs::create_dir_all(d.join("폴더")).unwrap();
    osa(&[&board, "files", a.to_str().unwrap(), b.to_str().unwrap(), d.join("폴더").to_str().unwrap()]);
    let got = clip_files(&d.join("paste"), Some(&board), "그림").unwrap();
    assert_eq!(got, vec![a.to_string_lossy().into_owned(), b.to_string_lossy().into_owned()], "폴더는 빼고 파일만");

    // 그림(tiff 로 복사하는 앱도 있다) — png 로 바꿔 데이터 폴더 자리에
    let tif = d.join("s.tiff");
    assert!(crate::platform::command("/usr/bin/sips").args(["-s", "format", "tiff", "-z", "4", "4", "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericDocumentIcon.icns", "--out"]).arg(&tif).output().unwrap().status.success());
    osa(&[&board, "public.tiff", tif.to_str().unwrap()]);
    let got = clip_files(&d.join("paste"), Some(&board), "붙여넣은 그림 10-28 10.12.47").unwrap();
    assert_eq!(got.len(), 1);
    assert!(got[0].ends_with("/붙여넣은 그림 10-28 10.12.47.png"), "{got:?}");
    assert!(got[0].starts_with(d.join("paste").to_str().unwrap()));
    assert!(std::path::Path::new(&got[0]).is_file());

    // 글만 있으면 빈 목록(화면은 글 붙여넣기 그대로)
    let txt = d.join("t.txt");
    std::fs::write(&txt, "hello").unwrap();
    osa(&[&board, "public.utf8-plain-text", txt.to_str().unwrap()]);
    assert_eq!(clip_files(&d.join("paste"), Some(&board), "그림").unwrap(), Vec::<String>::new());
}

#[test]
fn 창_밖에_놓은_자리는_그_화면_자리의_다른_앱_창_안_좌표로() {
    // 10-28 사용자: 메인 창 참모 보관함 카드를 메신저 따로 창 팀 보관함에 놓아도 반응이 없었다 — 포인터 끌기는 창을 못 넘는다
    let wins = vec![("main".to_string(), 0.0, 25.0, 1200.0, 800.0), ("team-all".to_string(), 1300.0, 100.0, 700.0, 600.0)];
    assert_eq!(window_at(&wins, "main", 1500.0, 300.0), Some(("team-all".to_string(), 200.0, 200.0)));
    assert_eq!(window_at(&wins, "main", 100.0, 100.0), None, "보낸 창 자신은 아니다");
    assert_eq!(window_at(&wins, "team-all", 100.0, 100.0), Some(("main".to_string(), 100.0, 75.0)), "거꾸로도");
    assert_eq!(window_at(&wins, "main", 2100.0, 300.0), None, "어느 창 위도 아니면 없음");
    assert_eq!(window_at(&wins, "main", 2000.0, 300.0), None, "오른쪽 끝 바깥 경계");
}

#[test]
fn 창_밖_놓기는_절대_경로_파일만_50개까지() {
    assert!(drag_paths_ok(&["/u/a.md".to_string()]));
    assert!(!drag_paths_ok(&[]));
    assert!(!drag_paths_ok(&["rel/a.md".to_string()]));
    assert!(!drag_paths_ok(&vec!["/a".to_string(); 51]));
}

#[test]
fn 창_자리는_물리_좌표를_그_창_배율로_나눈_논리_좌표() {
    // 레티나(2배) 창은 물리 좌표가 두 배 — JS screenX(논리 점)와 맞추려면 그 창 배율로 나눈다
    assert_eq!(logical_rect((2600, 200), (1400, 1200), 2.0), (1300.0, 100.0, 700.0, 600.0));
    // 1배 외장 모니터 창(왼쪽 모니터는 음수 자리)
    assert_eq!(logical_rect((-1920, 0), (800, 600), 1.0), (-1920.0, 0.0, 800.0, 600.0));
    // 배율이 이상하면 1배로 본다(0 나누기 막기)
    assert_eq!(logical_rect((10, 20), (30, 40), 0.0), (10.0, 20.0, 30.0, 40.0));
}

#[test]
fn 여러_모니터_배율이_달라도_화면_자리로_창을_찾는다() {
    // 메인 창은 2배 레티나, 메신저 따로 창은 오른쪽 1배 모니터
    let main = logical_rect((0, 50), (2400, 1600), 2.0);
    let team = logical_rect((1600, 100), (700, 600), 1.0);
    let wins = vec![("main".to_string(), main.0, main.1, main.2, main.3), ("team-all".to_string(), team.0, team.1, team.2, team.3)];
    assert_eq!(window_at(&wins, "main", 1700.0, 150.0), Some(("team-all".to_string(), 100.0, 50.0)));
}

#[test]
fn 지나감이_다른_창으로_옮기거나_빠지면_앞_창에_끝을_알린다() {
    assert_eq!(hover_leave(None, Some("team-all")), None, "처음 들어감");
    assert_eq!(hover_leave(Some("team-all"), Some("team-all")), None, "같은 창 안에서 움직임");
    assert_eq!(hover_leave(Some("team-all"), None), Some("team-all".to_string()), "창 밖 빈 자리로 빠짐");
    assert_eq!(hover_leave(Some("team-all"), Some("team-x")), Some("team-all".to_string()), "다른 창으로");
}

#[test]
fn 지나감_이름표는_한_줄_80자() {
    assert_eq!(hover_label("a.md"), "a.md");
    assert_eq!(hover_label("가\n나"), "가 나");
    assert_eq!(hover_label(&"가".repeat(200)).chars().count(), 80);
}

#[test]
fn 다른_창_자리는_틀_크기와_같이_넘긴다() {
    // 10-28 아이맥 실측: macOS 26 은 inner_position 이 제목줄을 포함한 틀 자리라 받는 창이 제목줄만큼 아래로 읽었다 — 틀 크기를 같이 주고 받는 창이 안 크기와 견줘 뺀다
    let wins = vec![("team-all".to_string(), 1320.0, 120.0, 900.0, 700.0)];
    assert_eq!(window_at(&wins, "main", 1700.0, 470.0), Some(("team-all".to_string(), 380.0, 350.0)));
    assert_eq!(at_payload(380.0, 350.0, &wins[0]), json!({ "x": 380.0, "y": 350.0, "fw": 900.0, "fh": 700.0 }));
}

#[test]
fn 화면_덩어리에_읽음_자리와_방마다_내_멤버() {
    let d = dir("reads");
    relay::mutate(&d, |s| {
        s.member_id = "m1".into();
        s.teams = vec![relay::TeamEntry { id: "t1".into(), member_id: "m1".into(), ..Default::default() }];
        s.rooms = vec![relay::Room { id: "r1".into(), kind: "dm".into(), peer: "m2".into(), team: "t1".into(), ..Default::default() }, relay::Room { id: "s".into(), kind: "self".into(), ..Default::default() }];
    })
    .unwrap();
    crate::team_reads::merge(&d, "r1", &[("m2".into(), 3)]);
    let v = feed(&d, 50);
    assert_eq!(v["reads"]["r1"]["m2"], 3);
    assert_eq!(v["view"]["rooms"][0]["me"], "m1");
    assert_eq!(v["view"]["rooms"][1]["me"], "", "내 기기끼리 방은 읽음 없음");
}

#[test]
fn 내가_읽은_자리는_바로_이_기기에_적힌다_내_기기끼리_방·모르는_방은_안_적는다() {
    let d = dir("mark");
    relay::mutate(&d, |s| {
        s.member_id = "m1".into();
        s.rooms = vec![relay::Room { id: "r1".into(), kind: "dm".into(), peer: "m2".into(), ..Default::default() }, relay::Room { id: "s".into(), kind: "self".into(), ..Default::default() }];
    })
    .unwrap();
    assert!(mark_read(&d, "r1", 5).is_ok());
    assert_eq!(crate::team_reads::load(&d)["r1"]["m1"], 5);
    assert!(mark_read(&d, "s", 5).is_err());
    assert!(mark_read(&d, "모름", 5).is_err());
    assert!(mark_read(&d, "r1", 0).is_err());
}

#[test]
fn 창_밖_팀_파일_놓기는_팀_id_와_파일_id_모양만_50개까지() {
    // 10-28 사용자: 메신저 따로 창 팀 보관함 파일을 메인 창 참모에게 끌어 줘도 안 됐다 — id 만 넘기고 받는 창이 푼다
    let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert!(team_drag_ok("t-1a", &ids(&["f1", "dir:견적"])));
    assert!(!team_drag_ok("", &ids(&["f1"])), "팀 없음");
    assert!(!team_drag_ok("t\"1", &ids(&["f1"])), "따옴표가 낀 팀");
    assert!(!team_drag_ok("t1", &[]), "빈 묶음");
    assert!(!team_drag_ok("t1", &vec!["f".to_string(); 51]), "50개 넘음");
    assert!(!team_drag_ok("t1", &ids(&["f1\n<script>"])), "줄바꿈");
    assert!(!team_drag_ok("t1", &ids(&[&"x".repeat(300)])), "너무 긴 id");
}

#[test]
fn 돌려보내는_한_줄은_한_줄로_200자까지() {
    assert_eq!(back_note("참모에게 주려면\n얼굴에 놓아 줘"), "참모에게 주려면 얼굴에 놓아 줘");
    assert_eq!(back_note(&"가".repeat(300)).chars().count(), 200);
}
