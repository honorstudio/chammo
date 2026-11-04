// perm_card 시험 — 회사 정책 아래 권한 창을 사람 카드로(ADR 0023). 화면 모양은 2026-11-01 orgpol-t2 실측(2.1.316)
use super::*;

const BASH: &str = "⏺ Running 1 shell command…
  ⎿  $ date > out2.txt
────────────────────────────────────────────────
 Bash command

   date > out2.txt
   Write current date into out2.txt in the working directory

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to /Users/me/sandbox from this project
   3. No

 Esc to cancel · Tab to amend
──────────────────────────────────────────── orgpol-t2 ─";

#[test]
fn 권한_창을_읽어_허용_다시묻지않기_거절_번호와_명령을_잡는다() {
    let d = perm_dialog(BASH).expect("창");
    assert_eq!(d.cursor, 1);
    assert_eq!((d.allow, d.again, d.deny), (Some(1), Some(2), Some(3)));
    assert!(d.what.contains("date > out2.txt"), "{}", d.what);
    assert_eq!(d.question, "Do you want to proceed?");
    // 맨 아래 세션 이름 줄(구분선)이 있어도 창을 찾는다 — '마지막 구분선 아래만'이면 빈 화면이 된다(12:16 자동 허용 '커서 못 찾음')
    assert!(d.fp.contains("1. Yes") && d.fp.contains("date > out2.txt") && !d.fp.contains("orgpol-t2"));
}

#[test]
fn 명령이_다르면_지문이_다르다() {
    let a = perm_dialog(BASH).unwrap().fp;
    let b = perm_dialog(&BASH.replace("date > out2.txt", "rm -rf ~/work")).unwrap().fp;
    assert_ne!(a, b);
}

#[test]
fn 창이_없으면_없음() {
    assert!(perm_dialog("❯ 안녕\n그냥 대화").is_none());
    assert!(perm_dialog("").is_none());
}

#[test]
fn 붙잡힌_메시지_창도_읽는다_거절_줄이_없으면_esc() {
    let s = "─────────────\n Held peer message — from uds:/tmp/x.sock (peer claims name: org-policy)\n Deliver it?\n ❯ 1. Deliver this message to Claude\n   2. Discard it\n";
    let d = perm_dialog(s).unwrap();
    assert_eq!(d.allow, Some(1));
    assert_eq!(d.again, None);
    // '버리기'는 거절 낱말로 안 잡혀도 된다 — 거절은 Esc 로
    assert_eq!(keys_for(&d, Choice::Deny), "\x1b");
}

#[test]
fn 키는_커서에서_그_번호까지_화살표_엔터() {
    let d = perm_dialog(BASH).unwrap();
    assert_eq!(keys_for(&d, Choice::Allow), "\r");
    assert_eq!(keys_for(&d, Choice::Again), "\x1b[B\r");
    assert_eq!(keys_for(&d, Choice::Deny), "\x1b[B\x1b[B\r");
    let moved = BASH.replace(" ❯ 1. Yes", "   1. Yes").replace("   3. No", " ❯ 3. No");
    let d2 = perm_dialog(&moved).unwrap();
    assert_eq!(keys_for(&d2, Choice::Allow), "\x1b[A\x1b[A\r");
}

#[test]
fn 카드_줄은_세션에서_온_perm_카드_다시묻지않기는_있을_때만() {
    let d = perm_dialog(BASH).unwrap();
    let r = card_row("ab12cd34", "c0ffee42", "/w/shop", &d, "2026-11-02T00:00:00Z");
    assert_eq!((r["type"].as_str(), r["sub"].as_str(), r["from"].as_str(), r["kind"].as_str()), (Some("ask"), Some(PERM_SUB), Some("c0ffee42"), Some("other")));
    assert_eq!(r["options"].as_array().map(|a| a.len()), Some(1));
    assert_eq!(r["fp"].as_str(), Some(d.fp.as_str()));
    let held = perm_dialog("────\n Deliver it?\n ❯ 1. Deliver this message to Claude\n   2. Discard it\n").unwrap();
    assert_eq!(card_row("x", "s", "/w", &held, "t")["options"].as_array().map(|a| a.len()), Some(0));
}

#[test]
fn 답은_앱_화면과_폰만_글_답은_안_된다() {
    assert_eq!(choice_of(&Pick::Yes, "desktop"), Ok(Choice::Allow));
    assert_eq!(choice_of(&Pick::No, "phone"), Ok(Choice::Deny));
    assert_eq!(choice_of(&Pick::Option { option: 0 }, "desktop"), Ok(Choice::Again));
    assert!(choice_of(&Pick::Yes, "telegram:1").is_err());
    assert!(choice_of(&Pick::Yes, "remote:아이맥").is_err());
    assert!(choice_of(&Pick::Text { text: "응".into() }, "desktop").is_err());
    assert!(choice_of(&Pick::Option { option: 1 }, "desktop").is_err());
}

#[test]
fn 누르기_전에_같은_창인지_본다() {
    let d = perm_dialog(BASH).unwrap();
    assert_eq!(keys_if_same(BASH, &d.fp, Choice::Allow), Ok("\r".to_string()));
    // 그사이 다른 명령 창으로 바뀌었다 — 누르지 않는다(다른 명령을 허락하는 사고)
    let other = BASH.replace("date > out2.txt", "git push origin main");
    assert!(keys_if_same(&other, &d.fp, Choice::Allow).is_err());
    assert!(keys_if_same("그냥 대화", &d.fp, Choice::Allow).is_err());
    // 다시 묻지 않기가 없는 창이면 그 단추는 안 된다
    let held = perm_dialog("────\n ❯ 1. Deliver this message to Claude\n   2. Discard it\n").unwrap();
    assert!(keys_if_same("────\n ❯ 1. Deliver this message to Claude\n   2. Discard it\n", &held.fp, Choice::Again).is_err());
}

#[test]
fn 열린_perm_카드_찾기와_닫기() {
    let d = perm_dialog(BASH).unwrap();
    let row = card_row("c1", "s1", "/w", &d, "t1");
    let log = format!("{row}\n");
    assert_eq!(open_card(&log, "s1", &d.fp), Some("c1".to_string()), "같은 창이면 새 카드 안 만든다");
    assert_eq!(open_card(&log, "s1", "다른 지문"), None);
    assert_eq!(open_ids(&log, "s1"), vec!["c1".to_string()]);
    let closed = format!("{log}{}\n", serde_json::json!({"type": "cancel", "id": "c1", "ts": "t2"}));
    assert!(open_ids(&closed, "s1").is_empty());
    assert_eq!(open_card(&closed, "s1", &d.fp), None);
}

#[test]
fn 명령_위아래_점선은_카드_글에서_뺀다() {
    // 2.1.316 실측 화면 — 명령 블록 위아래에 ╌ 점선이 있다(카드 q 에 300자 점선이 들어갔다)
    let s = "────────────\n Bash command\n   Write current date to live1.txt\n ╌╌╌╌╌╌╌╌╌╌╌╌\n   date > live1.txt\n ╌╌╌╌╌╌╌╌╌╌╌╌\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n";
    let d = perm_dialog(s).unwrap();
    assert_eq!(d.what, "Bash command / Write current date to live1.txt / date > live1.txt");
}
