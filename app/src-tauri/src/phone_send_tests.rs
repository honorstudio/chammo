//! 폰·스페이스 보내기(attach_type_segs → type_into) — 2026-11-06 12:12 폰에서 그림 4장 + 글이 'ok' 로 찍히고 기록엔 없던 것.
//! 말이 그림 경로(/Users/…)로 시작해 / 명령으로 읽혔고, 그러면 이 길은 Enter 한 번만 넣고 확인 없이 '쳤음'으로 끝났다(친 글이 0.4초 안에 안 보일 때도).
//! 그 Enter 가 안 먹어 말이 입력칸에 남았다(턴이 막 시작된 때 — 12:16 다음 말을 칠 때 type-stash 로 치워짐). 가짜 화면은 그림 읽기로 Enter 를 버리는 칸
use super::{type_into, typed_segs, SendNote};
use crate::fake_claude::Fake;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const IMGS: &str = "/tmp/fake-attach/1-phone.jpg /tmp/fake-attach/2-phone.jpg /tmp/fake-attach/3-phone.jpg /tmp/fake-attach/4-phone.jpg";

fn send(f: &Fake, text: &str) -> (std::io::Result<()>, SendNote) {
    let wr = f.writer();
    let shown = f.screen.lock().unwrap().screen().clone();
    let look = || f.screen.lock().unwrap().screen().clone();
    let mut g = wr.lock().unwrap();
    let mut note = SendNote::default();
    let r = type_into("t", &mut **g, Some(&shown), Some(&look), &typed_segs(text), &mut note);
    (r, note)
}

#[test]
fn 그림_경로를_친_말은_그림을_다_읽은_뒤에도_들어갈_때까지_본다() {
    // 실측 모양: 경로가 들어가는 순간 화면이 0.6초 멈추고(0.4초 안에 글이 안 보임) Pasting… 동안 Enter 는 버려진다
    let f = Fake::new(Some((Duration::from_millis(600), Duration::from_millis(1500))), false);
    let text = format!("{IMGS} 중간에 내가 보낸 거 다 사라졌네");
    let (r, note) = send(&f, &text);
    let (sent, _) = f.sent();
    assert!(r.is_ok(), "{r:?}");
    assert_eq!(sent.len(), 1, "한 번 들어가야 한다: {sent:?} {note:?}");
    assert!(note.paste, "그림 읽기를 봤다고 남긴다: {note:?}");
}

#[test]
fn 그림을_읽은_뒤_스스로_보낸_말엔_enter_를_더_안_넣는다() {
    let f = Fake::new(Some((Duration::from_millis(600), Duration::from_millis(1500))), true);
    let (r, _) = send(&f, &format!("{IMGS} 확인해줘"));
    let (sent, _) = f.sent();
    assert!(r.is_ok());
    assert_eq!(sent.len(), 1, "두 번 가면 안 된다: {sent:?}");
}

#[test]
fn 그림_경로로_시작하는_말은_슬래시_명령이_아니다() {
    use super::slash_command;
    assert!(slash_command("/clear"));
    assert!(slash_command("  /compact 앞 대화 요약"));
    assert!(!slash_command("/Users/a/attach/1-phone.jpg 이거 봐"), "12:12 말 — 경로로 시작");
    assert!(!slash_command("/"));
    assert!(!slash_command("이거 /clear 해"));
}

#[test]
fn 보통_말은_enter_한_번() {
    let f = Fake::new(None, false);
    let (r, note) = send(&f, "ㄱㄱ");
    let (sent, enters) = f.sent();
    assert!(r.is_ok());
    assert_eq!((sent, enters), (vec!["ㄱㄱ".to_string()], 1));
    assert!(note.seen && !note.left, "{note:?}");
}

/// 바뀌지 않는 화면 + 받은 키 기록(세션이 Enter 를 안 받는 칸)
fn still(screen: &str) -> (vt100::Parser, Arc<Mutex<Vec<u8>>>) {
    let mut p = vt100::Parser::new(12, 60, 0);
    p.process(screen.as_bytes());
    (p, Arc::new(Mutex::new(Vec::new())))
}

struct Rec(Arc<Mutex<Vec<u8>>>);
impl std::io::Write for Rec {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn 끝내_입력칸에서_안_빠지면_실패로_돌려준다() {
    // 입력칸에 그 말이 그대로 있고 Enter 를 넣어도 안 빠지는 칸 — 예전엔 '쳤음'(ok)이라 폰이 영영 기다렸다
    let text = "사라지는 말 이거 그대로 보냈었는데";
    let (p, got) = still(&format!("⏺ 앞 답\r\n{}\r\n❯ {text}\r\n{}\r\n  main · Opus", "─".repeat(60), "─".repeat(60)));
    let shown = p.screen().clone();
    let look = || shown.clone();
    let mut note = SendNote::default();
    let r = type_into("t", &mut Rec(got.clone()), Some(&shown), Some(&look), &typed_segs(text), &mut note);
    assert!(r.is_err(), "실패여야 폰이 '전달 안 됨' + 다시 보내기를 띄운다");
    assert!(note.left && note.enters == 3, "{note:?}");
    assert_eq!(String::from_utf8_lossy(&got.lock().unwrap()), "\r\r\r", "같은 말이 남아 있으면 다시 치지 않고 Enter 만");
}

#[test]
fn 선택_창이_떠_있으면_치지_않고_실패() {
    // 선택 창엔 입력칸이 없다 — 치면 글자가 선택(숫자)·다른 칸으로 들어간다
    let (p, got) = still(&format!("⏺ 물어볼게\r\n{}\r\n 어느 쪽으로 할까?\r\n ❯ 1. 이쪽\r\n   2. 저쪽\r\n   3. Type something.\r\n", "─".repeat(60)));
    let shown = p.screen().clone();
    let look = || shown.clone();
    let mut note = SendNote::default();
    let r = type_into("t", &mut Rec(got.clone()), Some(&shown), Some(&look), &typed_segs("1 이거 보내"), &mut note);
    assert!(r.is_err());
    assert!(note.dialog, "{note:?}");
    assert!(got.lock().unwrap().is_empty(), "한 글자도 안 친다");
}

/// 실측(일회용 세션 필요): 폰 길(attach_type_noted)로 그림 경로 + 글을 한 번 친다 — 결과와 블랙박스 줄을 찍는다. 기록에 표식이 들어갔나는 부른 쪽이 센다.
/// PHONETEST_ID=<짧은 id> PHONETEST_TEXT='<경로들> 표식 PH123' cargo test --bin honor-orchestrator phone_send_tests::실측_폰_길로_한_번 -- --ignored --exact --nocapture
#[test]
#[ignore]
fn 실측_폰_길로_한_번() {
    let id = std::env::var("PHONETEST_ID").expect("PHONETEST_ID");
    let text = std::env::var("PHONETEST_TEXT").expect("PHONETEST_TEXT");
    let t = std::time::Instant::now();
    let (r, note) = super::attach_type_noted(&id, &typed_segs(&text));
    eprintln!("RESULT {r:?} {note} 걸림 {:?}", t.elapsed());
}

#[test]
fn 친_글을_못_본_말은_화면_모양을_남긴다_글_내용_없이() {
    // 11-07 02:20:35 'ok seen=false' 인데 Claude 입력 기록에 없던 말 — 다음에 또 나면 어느 쪽인지 가르게: 입력칸이 있었나·글자 수·화면 줄 수(치기 전>뒤)
    let text = "비밀스러운 내용 ABC";
    let line = "─".repeat(60);
    let (p, got) = still(&format!("⏺ 앞 답\r\n{line}\r\n❯ \r\n{line}\r\n  main · Opus"));
    let shown = p.screen().clone();
    let look = || shown.clone();
    let mut note = SendNote::default();
    let r = type_into("t", &mut Rec(got.clone()), Some(&shown), Some(&look), &typed_segs(text), &mut note);
    assert!(r.is_ok(), "못 봐도 전처럼 믿는다 — '미안 오락가락해서'는 seen=false 인데 들어갔다");
    assert!(!note.seen);
    assert_eq!(note.shape, "box:0:5>box:0:5", "{note:?}");
    let shown_line = note.to_string();
    assert!(shown_line.contains(" shape=box:0:5>box:0:5"), "{shown_line}");
    assert!(!shown_line.contains("비밀") && !shown_line.contains("ABC"), "글 내용은 안 남긴다: {shown_line}");
}

#[test]
fn 입력칸이_없는_화면도_갈린다_그림자_없이_빈_화면도() {
    let (p, got) = still("⏺ 아무 입력칸 없는 화면");
    let shown = p.screen().clone();
    let look = || shown.clone();
    let mut note = SendNote::default();
    let _ = type_into("t", &mut Rec(got), Some(&shown), Some(&look), &typed_segs("말"), &mut note);
    assert_eq!(note.shape, "nobox:0:1>nobox:0:1", "{note:?}");
    let (empty, got2) = still("");
    let blank = empty.screen().clone();
    let look2 = || blank.clone();
    let mut n2 = SendNote::default();
    let _ = type_into("t", &mut Rec(got2), Some(&blank), Some(&look2), &typed_segs("말"), &mut n2);
    assert_eq!(n2.shape, "nobox:0:0>nobox:0:0", "화면을 하나도 못 받은 attach: {n2:?}");
}

#[test]
fn 친_글을_봤으면_줄이_늘지_않는다() {
    let f = Fake::new(None, false);
    let (_, note) = send(&f, "ㄱㄱ");
    assert!(note.seen);
    assert_eq!(note.shape, "");
    assert!(!note.to_string().contains("shape"), "{note}");
}
