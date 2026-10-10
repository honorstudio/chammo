use super::*;
use crate::messenger::typed;
use serde_json::json;

fn ask(kind: &str) -> serde_json::Value {
    json!({ "ts": "2026-10-08T01:00:00Z", "type": "ask", "id": "ab12cd34", "from": "a1b2c3d4", "kind": kind, "q": "진행할까?", "yes": "승인", "no": "거절", "options": ["개인", "법인"], "amount": "US$25", "detail": "카드 ····4821" })
}

#[test]
fn 결제·보내기·삭제·운영_카드엔_버튼이_없다() {
    for kind in ["pay", "send", "delete", "ops", "", "PAY", "unknown"] {
        let (text, kb) = card_message(&ask(kind), "project-b");
        let ok = crate::messenger::buttons_ok(kind);
        assert_eq!(kb.is_some(), ok, "{kind}");
        if !ok {
            assert!(text.contains("앱·폰"), "{text}");
        }
    }
    let (text, _) = card_message(&ask("pay"), "project-b");
    assert!(text.contains("결제 승인 요청") && text.contains("US$25") && text.contains("진행할까?"), "{text}");
}

#[test]
fn other·login_카드는_선택지와_예아니오_버튼() {
    let (_, kb) = card_message(&ask("other"), "project-b");
    let kb = kb.unwrap();
    let rows = kb["inline_keyboard"].as_array().unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0][0]["callback_data"], "c:ab12cd34:o0");
    assert_eq!(rows[1][0]["text"], "법인");
    assert_eq!(rows[2][0]["callback_data"], "c:ab12cd34:y");
    assert_eq!(rows[2][1]["callback_data"], "c:ab12cd34:n");
    for r in rows {
        for b in r.as_array().unwrap() {
            assert!(b["callback_data"].as_str().unwrap().len() <= 64);
            assert_eq!(crate::messenger::parse_button(b["callback_data"].as_str().unwrap()).unwrap().0, "ab12cd34");
        }
    }
    assert!(card_message(&ask("login"), "x").1.is_some());
    // id 가 이상하면 버튼을 안 단다
    let mut a = ask("other");
    a["id"] = json!("../x");
    assert!(card_message(&a, "x").1.is_none());
}

const DATA: &str = "/Users/me/.chammo";
const HOME: &str = "/Users/me";

fn r(s: &str) -> String {
    redact(s, DATA, HOME)
}

#[test]
fn 키·토큰처럼_생긴_것은_가린다() {
    let tg = concat!("123456789:", "AAH4kq9_sZx-", "Qw3eRtYuIoP1aSdFgHjKlZx");
    assert_eq!(r(&format!("봇 토큰 {tg} 넣었어")), format!("봇 토큰 {HIDDEN} 넣었어"));
    assert!(!r(&format!("https://api.telegram.org/bot{tg}/getMe")).contains("AAH4kq9"));
    assert!(!r("키는 sk-ant-api03-abcdefghijklmnop1234 이야").contains("abcdefghijklmnop"));
    assert!(!r("ghp_1234567890abcdefghijABCDEFGHIJ").contains("1234567890"));
    assert!(!r("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF123_xyz").contains("eyJzdWIi"));
    assert!(!r("https://x.com/cb?code=abc123&state=ok&token=zzz").contains("abc123"));
    assert!(r("https://x.com/cb?code=abc123&state=ok&token=zzz").contains("state=ok"));
    assert!(!r("token=zzz").contains("zzz"));
    assert_eq!(r("password: hunter2"), format!("password: {HIDDEN}"));
    assert_eq!(r("비밀번호: 1234abcd"), format!("비밀번호: {HIDDEN}"));
    assert_eq!(r("AWS AKIAIOSFODNN7EXAMPLE"), format!("AWS {HIDDEN}"));
    let pem = "앞\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n뒤";
    assert_eq!(r(pem), format!("앞\n{HIDDEN}\n뒤"));
}

#[test]
fn 데이터_폴더_밖_절대_경로는_파일_이름만() {
    assert_eq!(r("캡처는 /Users/me/Desktop/dev/client-a/.shots/a.png 에"), "캡처는 …/a.png 에");
    assert_eq!(r("~/Desktop/dev/client-a/README.md."), "…/README.md.");
    assert_eq!(r("C:\\Users\\Me\\dev\\x.txt"), "…/x.txt");
    assert_eq!(r("기록은 /Users/me/.chammo/direct.jsonl"), "기록은 /Users/me/.chammo/direct.jsonl", "데이터 폴더 안은 그대로");
    assert_eq!(r("/참모 쳐 봐"), "/참모 쳐 봐");
}

#[test]
fn 보통_글은_그대로() {
    for s in [
        "PR #412 머지했어 — CI 초록, 테스트 1,203개",
        "커밋 56b178ab 위에 쌓았어",
        "토큰은 키체인에 넣었어",
        "MessengerSection.tsx:264 를 봐",
        "https://github.com/honorstudio/chammo/pull/12",
        "가격은 US$25, 내일 09:00 배포",
    ] {
        assert_eq!(r(s), s);
    }
}

#[test]
fn 긴_회신은_나눠서_보내고_너무_길면_끝에_안내() {
    assert_eq!(split("짧은 답"), vec!["짧은 답"]);
    assert!(split("  ").is_empty());
    let long = "가나다라마바사\n".repeat(1000); // 8,000자
    let parts = split(&long);
    assert_eq!(parts.len(), 3);
    assert!(parts.iter().all(|p| p.chars().count() <= CHUNK));
    assert!(parts[0].ends_with("사"), "줄 경계에서 자른다");
    let huge = "가".repeat(CHUNK * 6);
    let parts = split(&huge);
    assert_eq!(parts.len(), MAX_CHUNKS);
    assert!(parts.last().unwrap().contains("나머지는 앱에서"));
}

fn line(v: serde_json::Value) -> String {
    format!("{v}\n")
}

#[test]
fn 대화_기록에서_턴_끝_답만_찾는다() {
    let mut buf = String::new();
    let mut chunk = String::new();
    chunk += &line(json!({ "type": "user", "message": { "content": typed("배포 봐 줘") } }));
    chunk += &line(json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "먼저 볼게" }], "stop_reason": "tool_use" } }));
    chunk += &line(json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "ok" }] } }));
    chunk += &line(json!({ "type": "user", "message": { "content": "<task-notification>x</task-notification>" } }));
    chunk += &line(json!({ "type": "user", "message": { "content": "[앱] project-b 세션이 선택지 창에서 멈췄어" } }));
    chunk += &line(json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "배포 끝났어" }], "stop_reason": null } }));
    chunk += &line(json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "확인해 줘" }], "stop_reason": "end_turn" } }));
    let half = r#"{"type":"assistant","message":{"content":[{"type":"text","te"#;
    chunk += half;
    let s = scan(&chunk, &mut buf);
    assert_eq!(s.replies, vec!["배포 끝났어\n확인해 줘".to_string()]);
    assert!(!s.mac_prompt);
    assert_eq!(s.consumed, chunk.len() - half.len(), "덜 쓴 줄은 다음에");
    assert!(buf.is_empty());
}

#[test]
fn 맥에서_사람이_치면_멈춤_api_오류는_보냄() {
    let mut buf = String::new();
    let chunk = line(json!({ "type": "assistant", "isApiErrorMessage": true, "message": { "content": [{ "type": "text", "text": "Login expired · Please run /login" }] } }))
        + &line(json!({ "type": "user", "message": { "content": "맥에서 직접 친 지시" } }))
        + &line(json!({ "type": "user", "isMeta": true, "message": { "content": "메타" } }))
        + &line(json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "맥 사람에게 한 답" }], "stop_reason": "end_turn" } }));
    let s = scan(&chunk, &mut buf);
    assert_eq!(s.replies, vec!["Login expired · Please run /login".to_string()]);
    assert!(s.mac_prompt);
}

#[test]
fn 리뷰가_찾은_새는_모양도_가린다() {
    let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcDEF123_xyz";
    for (input, leak) in [
        (format!("SUPABASE_SERVICE_ROLE_KEY={jwt}"), "eyJyb2xl"),
        ("DATABASE_URL=postgresql://postgres:MyS3cretPw@db.x.supabase.co:5432/postgres".to_string(), "MyS3cretPw"),
        ("git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y".to_string(), "ghp_abc"),
        ("DB_PASSWORD=\"Winter2026!\"".to_string(), "Winter2026"),
        ("{\"password\": \"Winter2026\"}".to_string(), "Winter2026"),
        ("password: P@ss!w0rd#xyz 다음".to_string(), "w0rd"),
        (format!("https://hooks.slack.{}/services/T0000AAAA/B0000BBBB/{}", "com", "abcdefghijklmnopqrstuvwx"), "abcdefghijklmnopqrstuvwx") /* 가짜 값 — 한 덩어리로 쓰면 GitHub 비밀 검사가 공개 push 를 막는다(0.2.6) */,
        ("api_key:abc123def456".to_string(), "abc123def456"),
    ] {
        let out = r(&input);
        assert!(!out.contains(leak), "{input} → {out}");
    }
    assert!(r("password: P@ss!w0rd#xyz 다음").ends_with(" 다음"), "빈칸 뒤 글은 남긴다");
    assert!(r("git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y").contains("@github.com/x/y"));
    assert!(r("DATABASE_URL=postgresql://postgres:MyS3cretPw@db.x.supabase.co:5432/postgres").contains("postgres:"));
}

#[test]
fn 세션_id_는_안_가린다() {
    assert_eq!(r("세션 7c0e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b 이 끝났어"), "세션 7c0e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b 이 끝났어");
}

#[test]
fn 일하는_중에_맥에서_친_지시도_사람_글로_본다() {
    let mut buf = String::new();
    let chunk = line(json!({ "type": "attachment", "attachment": { "type": "queued_command", "prompt": "[텔레그램] 텔레그램 글", "origin": { "kind": "human" } } }))
        + &line(json!({ "type": "attachment", "attachment": { "type": "queued_command", "prompt": "<task-notification>x</task-notification>", "origin": { "kind": "human" } } }))
        + &line(json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "텔레그램 답" }], "stop_reason": "end_turn" } }))
        + &line(json!({ "type": "attachment", "attachment": { "type": "queued_command", "prompt": "맥에서 끼어든 지시", "origin": { "kind": "human" } } }))
        + &line(json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "맥 답" }], "stop_reason": "end_turn" } }));
    let s = scan(&chunk, &mut buf);
    assert_eq!(s.replies, vec!["텔레그램 답".to_string()]);
    assert!(s.mac_prompt);
}

#[test]
fn 종류가_빈_카드엔_버튼이_없다() {
    let mut a = ask("other");
    a.as_object_mut().unwrap().remove("kind");
    assert!(card_message(&a, "x").1.is_none());
}
