use super::*;
use serde_json::json;

fn l(v: serde_json::Value) -> String {
    format!("{v}\n")
}
fn user(t: &str) -> String {
    l(json!({"type":"user","message":{"role":"user","content":t}}))
}
fn interrupt() -> String {
    l(json!({"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]}}))
}
fn tool_result() -> String {
    l(json!({"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":"ok"}]}}))
}
fn thinking() -> String {
    l(json!({"type":"assistant","message":{"content":[{"type":"thinking","thinking":"..."}]}}))
}
fn tool_use() -> String {
    l(json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{}}]}}))
}
fn said(t: &str) -> String {
    l(json!({"type":"assistant","message":{"content":[{"type":"text","text":t}]}}))
}
fn queued(t: &str, kind: Option<&str>) -> String {
    let mut a = json!({"type":"queued_command","prompt":t,"commandMode":"prompt"});
    if let Some(k) = kind {
        a["origin"] = json!({"kind": k});
    }
    l(json!({"type":"attachment","attachment":a}))
}
fn hook() -> String {
    l(json!({"type":"attachment","attachment":{"type":"hook_success","hookName":"UserPromptSubmit"}}))
}
fn op(o: &str, t: &str) -> String {
    l(json!({"type":"queue-operation","operation":o,"content":t}))
}
fn turn_end() -> String {
    l(json!({"type":"system","subtype":"turn_duration"}))
}

/// 11-17 13:39 참모 채팅 신고 그대로: 스페이스 말 턴 → 같은 말 한 번 더·'이렇게 보냈음' 대기 → 도구 결과 뒤 넣음 → 0.2초 뒤 끊김
fn reported() -> String {
    [
        user("[스페이스] 고친 것"),
        hook(),
        op("enqueue", "[스페이스] 고친 것"),
        op("enqueue", "이렇게 보냈음"),
        thinking(),
        tool_use(),
        op("remove", "[스페이스] 고친 것"),
        op("remove", "이렇게 보냈음"),
        tool_result(),
        queued("[스페이스] 고친 것", None),
        hook(),
        queued("이렇게 보냈음", Some("human")),
        hook(),
        interrupt(),
    ]
    .concat()
}

#[test]
fn 끊긴_턴에_들어간_사람_말을_찾는다() {
    assert_eq!(lost_prompts(&reported()), vec!["[스페이스] 고친 것".to_string(), "이렇게 보냈음".to_string()]);
}

#[test]
fn 끊김_뒤에_꺼내져_다시_간_말은_뺀다() {
    // 실측 B: 아직 안 넣은 말은 Esc 에 꺼내져 새 user 줄로 간다 — 넣은 말과 글이 같으면 두 번 넣지 않게
    let s = [reported(), op("dequeue", ""), user("이렇게 보냈음")].concat();
    assert_eq!(lost_prompts(&s), vec!["[스페이스] 고친 것".to_string()]);
}

#[test]
fn 답을_한_뒤의_끊김엔_잃은_말이_없다() {
    // 넣은 말에 이미 글로 답했으면 받은 것 — 그 뒤 도구 중에 끊겨도 다시 안 넣는다
    let s = [user("일 해"), tool_use(), tool_result(), queued("이것도", Some("human")), said("알았어, 그것도 할게"), tool_use(), interrupt()].concat();
    assert!(lost_prompts(&s).is_empty());
}

#[test]
fn 다른_세션이_보낸_말은_다시_넣지_않는다() {
    let s = [user("일 해"), tool_use(), tool_result(), queued("참모 전언", Some("peer")), interrupt()].concat();
    assert!(lost_prompts(&s).is_empty());
}

#[test]
fn 끊김이_없으면_잃은_말도_없다() {
    let s = [user("일 해"), tool_use(), tool_result(), queued("이것도", None)].concat();
    assert!(lost_prompts(&s).is_empty());
}

#[test]
fn 도구_중_끊김도_끊김이다() {
    let s = [tool_use(), l(json!({"type":"user","message":{"content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]}}))].concat();
    assert_eq!(idle_in(&s), Some(Idle::Interrupt));
}

#[test]
fn 멈춤_판정() {
    assert_eq!(idle_in(&[thinking(), tool_use()].concat()), None);
    assert_eq!(idle_in(&[said("끝"), turn_end()].concat()), Some(Idle::Ended));
    assert_eq!(idle_in(&[hook(), interrupt(), user("새 말")].concat()), Some(Idle::Interrupt));
    // 사람 말 글에 같은 낱말이 섞인 건 끊김이 아니다
    assert_eq!(idle_in(&user("왜 [Request interrupted by user] 가 떠?")), None);
}

#[test]
fn 이미_멈춘_세션() {
    assert!(idle_before(&[user("a"), tool_use(), interrupt(), hook()].concat()));
    assert!(idle_before(&[user("a"), said("b"), turn_end()].concat()));
    assert!(!idle_before(&[user("a"), tool_use(), tool_result()].concat()));
}

fn tmp(name: &str, body: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("cut-wait-{}-{name}.jsonl", std::process::id()));
    std::fs::write(&p, body).unwrap();
    p
}

#[test]
fn 기다리는_사이_붙은_끊김을_보고_잃은_말을_준다() {
    let head = [user("[스페이스] 고친 것"), tool_use(), tool_result(), queued("이렇게 보냈음", Some("human"))].concat();
    let p = tmp("late", &head);
    let from = head.len() as u64;
    let p2 = p.clone();
    let w = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(250));
        use std::io::Write;
        std::fs::OpenOptions::new().append(true).open(&p2).unwrap().write_all(interrupt().as_bytes()).unwrap();
    });
    let r = wait_at(&p, from, Duration::from_secs(3), Duration::from_millis(20));
    w.join().unwrap();
    assert_eq!(r.via, "interrupt");
    assert!(r.ms >= 200, "끊김이 붙기 전엔 안 돌아온다: {}", r.ms);
    assert_eq!(r.lost, vec!["이렇게 보냈음".to_string()]);
    let _ = std::fs::remove_file(p);
}

#[test]
fn 끊김이_안_오면_시간_넘김() {
    let head = [user("a"), tool_use()].concat();
    let p = tmp("timeout", &head);
    let r = wait_at(&p, head.len() as u64, Duration::from_millis(300), Duration::from_millis(20));
    assert_eq!(r.via, "timeout");
    let _ = std::fs::remove_file(p);
}

#[test]
fn 앞_Esc_로_이미_멈췄으면_바로() {
    let head = [user("a"), tool_use(), interrupt()].concat();
    let p = tmp("already", &head);
    let r = wait_at(&p, head.len() as u64, Duration::from_secs(3), Duration::from_millis(20));
    assert_eq!(r.via, "already");
    assert!(r.ms < 200);
    let _ = std::fs::remove_file(p);
}
