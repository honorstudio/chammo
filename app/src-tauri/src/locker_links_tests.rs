use super::*;

fn urls(t: &str) -> Vec<String> {
    urls_in(t).into_iter().map(|f| f.url).collect()
}

#[test]
fn plain_urls_and_boundaries() {
    assert_eq!(urls("확인해 https://shop-landing.vercel.app/en 영어판"), ["https://shop-landing.vercel.app/en"]);
    assert_eq!(urls("http://localhost:1420/ 띄웠어"), ["http://localhost:1420/"]);
    // 낱말 안(xhttp://)은 주소가 아니다
    assert!(urls("xhttp://a.com").is_empty());
    // 한글이 바로 붙어도 거기서 끊는다
    assert_eq!(urls("주소는https://a.com/b야"), ["https://a.com/b"]);
    // 따옴표·백틱·꺾쇠 안
    assert_eq!(urls("`https://a.com/x` \"https://b.com\" <https://c.com/y>"), ["https://a.com/x", "https://b.com", "https://c.com/y"]);
    // 한 글 안 같은 주소는 한 번
    assert_eq!(urls("https://a.com 그리고 https://a.com"), ["https://a.com"]);
}

#[test]
fn trailing_punctuation_and_parens() {
    assert_eq!(urls("여기 https://a.com/x."), ["https://a.com/x"]);
    assert_eq!(urls("(https://a.com/x), 그리고"), ["https://a.com/x"]);
    assert_eq!(urls("**https://a.com/x**"), ["https://a.com/x"]);
    // 짝이 맞는 괄호는 주소 몫(애플 문서)
    assert_eq!(urls("https://developer.apple.com/documentation/appkit/nsworkspace/open(_:)"), ["https://developer.apple.com/documentation/appkit/nsworkspace/open(_:)"]);
    assert_eq!(urls("https://a.com/q?x=1&y=2#top!"), ["https://a.com/q?x=1&y=2#top"]);
}

#[test]
fn truncated_and_bad_hosts_dropped() {
    // 말줄임으로 잘린 주소는 버린다
    assert!(urls("https://shop-admin… 에서").is_empty());
    assert!(urls("https://shop-admin.vercel.app/orders… 끝").is_empty());
    assert!(urls("https:// 빈 주소").is_empty());
    assert!(urls("https://foo 점 없는 이름").is_empty());
    assert_eq!(urls("http://127.0.0.1:5173/x"), ["http://127.0.0.1:5173/x"]);
}

#[test]
fn markdown_labels() {
    let f = urls_in("열어 봐 — [배송 기본 정책](https://docs.example.com/guides/payout) 그리고 [**PR #418**](https://github.com/o/r/pull/418).");
    assert_eq!(f.len(), 2);
    assert_eq!(f[0].url, "https://docs.example.com/guides/payout");
    assert_eq!(f[0].label.as_deref(), Some("배송 기본 정책"));
    assert_eq!(f[1].url, "https://github.com/o/r/pull/418");
    assert_eq!(f[1].label.as_deref(), Some("PR #418"));
    // 이름이 주소 그대로면 이름 없음
    let g = urls_in("[https://a.com/x](https://a.com/x)");
    assert_eq!(g.len(), 1);
    assert_eq!(g[0].label, None);
    // 같은 주소가 맨몸으로 먼저 나와도 뒤의 이름을 쓴다
    let h = urls_in("https://a.com/x 는 [문서](https://a.com/x)");
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].label.as_deref(), Some("문서"));
}

fn user(text: &str) -> String {
    serde_json::json!({ "type": "user", "uuid": "u1", "timestamp": "2026-11-06T05:00:00.000Z", "message": { "role": "user", "content": text } }).to_string()
}

fn asst(text: &str) -> String {
    serde_json::json!({ "type": "assistant", "uuid": "a1", "timestamp": "2026-11-06T05:01:00.000Z", "message": { "role": "assistant", "content": [
        { "type": "thinking", "thinking": "https://think.example.com" },
        { "type": "text", "text": text },
        { "type": "tool_use", "name": "Bash", "input": { "command": "curl https://tool.example.com" } },
    ] } }).to_string()
}

#[test]
fn line_rules_person_and_answer() {
    let h = in_line(&user("이거 봐 https://x.com/a/status/1")).unwrap();
    assert_eq!((h.how, h.uuid.as_str(), h.ts.as_str()), (How::Said, "u1", "2026-11-06T05:00:00.000Z"));
    assert_eq!(h.found.len(), 1);
    // 참모 답 — 글 칸만(생각·도구 입력은 뺀다)
    let a = in_line(&asst("PR 올렸어 [PR #3](https://github.com/o/r/pull/3)")).unwrap();
    assert_eq!(a.how, How::Answer);
    assert_eq!(a.found.iter().map(|f| f.url.as_str()).collect::<Vec<_>>(), ["https://github.com/o/r/pull/3"]);
}

#[test]
fn line_rules_skip_not_human() {
    // 앱이 넣은 줄·다른 참모·팀 이름표·감싼 줄(세션 회신·작업 알림)은 사람 말이 아니다
    for t in [
        "[앱] 정리할 세션: x — https://a.com",
        "[다른 기기 참모 · 아이맥 · 참모 · peer#1] https://a.com",
        "[남의 참모 · 지수 · 맥 · team#2] https://a.com",
        "[팀 사람 말 · 지수 · team#3] https://a.com",
        "<cross-session-message from=\"x\">PR https://github.com/o/r/pull/9</cross-session-message>",
        "<task-notification>https://a.com</task-notification>",
    ] {
        assert!(in_line(&user(t)).is_none_or(|h| h.found.is_empty()), "{t}");
    }
    // system-reminder 안 주소는 빼고 사람 말만
    let h = in_line(&user("<system-reminder>https://hook.example.com</system-reminder>\n열어 https://a.com/b")).unwrap();
    assert_eq!(h.found.iter().map(|f| f.url.as_str()).collect::<Vec<_>>(), ["https://a.com/b"]);
    // 메타 줄·도구 결과
    let meta = serde_json::json!({ "type": "user", "isMeta": true, "uuid": "m", "timestamp": "t", "message": { "content": "https://a.com" } }).to_string();
    assert!(in_line(&meta).is_none_or(|h| h.found.is_empty()));
    let tool = serde_json::json!({ "type": "user", "uuid": "r", "timestamp": "t", "message": { "content": [{ "type": "tool_result", "content": "https://a.com" }] } }).to_string();
    assert!(in_line(&tool).is_none_or(|h| h.found.is_empty()));
    // 대화가 꽉 차 압축된 요약 줄 — 사람 말 칸에 들지만 예전 주소를 다시 끌고 온다(실측 11-06: 참모-2 요약 넷이 옛 주소를 '내가 보냄'으로 다시 쌓음)
    let sum = serde_json::json!({ "type": "user", "isCompactSummary": true, "isVisibleInTranscriptOnly": true, "uuid": "c", "timestamp": "t", "message": { "content": "This session is being continued … https://a.com/old" } }).to_string();
    assert!(in_line(&sum).is_none_or(|h| h.found.is_empty()));
    // promptSource — system(다른 참모 전언·작업 알림)은 빼고, queued(일하는 중 쌓아 둔 사람 말)는 사람 말
    let peer = serde_json::json!({ "type": "user", "promptSource": "system", "origin": { "kind": "peer" }, "uuid": "p", "timestamp": "t", "message": { "content": "PR 올렸어 https://github.com/o/r/pull/9" } }).to_string();
    assert!(in_line(&peer).is_none_or(|h| h.found.is_empty()));
    let queued = serde_json::json!({ "type": "user", "promptSource": "queued", "origin": { "kind": "human" }, "uuid": "q", "timestamp": "t", "message": { "content": "이것도 https://a.com/q" } }).to_string();
    assert_eq!(in_line(&queued).unwrap().found.len(), 1);
    // 그림 이름표로 시작하는 사람 말은 사람 말
    assert_eq!(in_line(&user("[Image #2] 이 사이트 https://a.com/c")).unwrap().found.len(), 1);
    // 깨진 줄
    assert!(in_line("{not json").is_none());
}

fn tmp(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-links-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn scan_appends_once_and_follows_offset() {
    let d = tmp("scan");
    let tr = d.join("sid-1.jsonl");
    std::fs::write(&tr, format!("{}\n{}\n", user("봐 https://a.com/x"), asst("[문서](https://b.com/y)"))).unwrap();
    assert_eq!(scan(&d, "o2", "sid-1", &tr).unwrap(), 2);
    let v = read(&d, "o2").unwrap();
    assert_eq!(v.links.iter().map(|l| (l.url.as_str(), l.by.as_str(), l.how)).collect::<Vec<_>>(), [("https://b.com/y", "o2", How::Answer), ("https://a.com/x", "me", How::Said)]);
    assert_eq!(v.links[0].label.as_deref(), Some("문서"));
    // 다시 읽어도 늘어난 만큼만
    assert_eq!(scan(&d, "o2", "sid-1", &tr).unwrap(), 0);
    // 끝 줄이 아직 덜 쓰였으면(줄바꿈 없음) 다음 차례에
    let mut f = std::fs::OpenOptions::new().append(true).open(&tr).unwrap();
    std::io::Write::write_all(&mut f, user("또 https://c.com/z").replace("\"uuid\":\"u1\"", "\"uuid\":\"u3\"").as_bytes()).unwrap();
    assert_eq!(scan(&d, "o2", "sid-1", &tr).unwrap(), 0);
    std::io::Write::write_all(&mut f, b"\n").unwrap();
    assert_eq!(scan(&d, "o2", "sid-1", &tr).unwrap(), 1);
    // 기록이 짧아졌으면(바뀐 파일) 처음부터 — 같은 줄 열쇠라 겹치지 않는다
    std::fs::write(&tr, format!("{}\n", user("봐 https://a.com/x"))).unwrap();
    scan(&d, "o2", "sid-1", &tr).unwrap();
    assert_eq!(read(&d, "o2").unwrap().links.len(), 3);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn scan_saves_as_it_goes() {
    // 큰 기록(708MB, 부하 높을 때 4분 실측) — 조금씩 저장해 읽는 동안 목록이 차오르고, 중간에 꺼도 그 자리부터
    let d = tmp("chunks");
    let tr = d.join("sid-2.jsonl");
    let lines: Vec<String> = (0..5).map(|i| user(&format!("봐 https://a.com/{i}")).replace("\"uuid\":\"u1\"", &format!("\"uuid\":\"u{i}\""))).collect();
    std::fs::write(&tr, lines.join("\n") + "\n").unwrap();
    let mut seen = Vec::new();
    let n = scan_with(&d, "o2", "sid-2", &tr, 1, &mut |_| seen.push(read(&d, "o2").unwrap().links.len())).unwrap();
    assert_eq!(n, 5);
    assert_eq!(seen, [1, 2, 3, 4, 5], "줄마다 저장한 만큼 읽힌다");
    assert_eq!(scan(&d, "o2", "sid-2", &tr).unwrap(), 0, "읽은 자리도 같이 저장");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn hide_unhide_and_hand_add() {
    let d = tmp("hide");
    let l = add_hand(&d, "o2", " chammo.app/download ").unwrap();
    assert_eq!((l.url.as_str(), l.by.as_str(), l.how), ("https://chammo.app/download", "me", How::Hand));
    assert!(add_hand(&d, "o2", "그냥 글").is_err());
    assert!(add_hand(&d, "o2", "ftp://a.com").is_err());
    let m = add_hand(&d, "o2", "https://a.com/1").unwrap();
    assert_ne!(l.id, m.id);
    set_hidden(&d, "o2", &l.id, true).unwrap();
    set_hidden(&d, "o2", "show:2026-11-06T03:00:00Z:https://s.com/", true).unwrap();
    let v = read(&d, "o2").unwrap();
    assert_eq!(v.links.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), [m.id.as_str()]);
    assert_eq!(v.hidden.len(), 2);
    set_hidden(&d, "o2", &l.id, false).unwrap();
    assert_eq!(read(&d, "o2").unwrap().links.len(), 2);
    // 참모 id 는 파일 이름이 되니 글자를 거른다
    assert!(read(&d, "../x").is_err());
    assert!(set_hidden(&d, "o2", "a\nb", true).is_err());
    // 없는 참모는 빈 목록
    assert_eq!(read(&d, "o9").unwrap(), View::default());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn clean_input_rules() {
    assert_eq!(clean_input("https://a.com/x").as_deref(), Some("https://a.com/x"));
    assert_eq!(clean_input("a.com/x.").as_deref(), Some("https://a.com/x"));
    assert_eq!(clean_input("http://localhost:3000").as_deref(), Some("http://localhost:3000"));
    for bad in ["", "a b", "javascript:alert(1)", "https://foo", "https://a.com https://b.com"] {
        assert_eq!(clean_input(bad), None, "{bad}");
    }
}

#[test]
fn sid_from_agents_json() {
    let j = r#"[{"id":"o2","sessionId":"0a1b2c3d-4e5f-4061-8a7b-9c0d1e2f3a4b","name":"참모-2"},{"id":"x","sessionId":"../../etc"}]"#;
    assert_eq!(sid_of(j, "o2").as_deref(), Some("0a1b2c3d-4e5f-4061-8a7b-9c0d1e2f3a4b"));
    assert_eq!(sid_of(j, "x"), None, "기록 id 꼴이 아니면 안 쓴다");
    assert_eq!(sid_of(j, "none"), None);
    assert_eq!(sid_of("not json", "o2"), None);
}

#[test]
fn refresh_scans_then_reads() {
    let d = tmp("refresh");
    let tr = d.join("t.jsonl");
    std::fs::write(&tr, format!("{}\n", user("https://a.com/x"))).unwrap();
    assert_eq!(refresh(&d, "o2", Some("abc-1"), Some(&tr)).unwrap().links.len(), 1);
    // 기록이 없으면 쌓인 것만
    assert_eq!(refresh(&d, "o2", None, None).unwrap().links.len(), 1);
    let _ = std::fs::remove_dir_all(&d);
}

/// 실측(손으로) — LINKS_REAL=<대화 기록 jsonl> cargo test -- --ignored links_real_transcript --nocapture
#[test]
#[ignore]
fn links_real_transcript() {
    let Ok(p) = std::env::var("LINKS_REAL") else { return };
    let d = tmp("real");
    let t = std::time::Instant::now();
    let n = scan(&d, "real", "s", std::path::Path::new(&p)).unwrap();
    let first = t.elapsed();
    let t = std::time::Instant::now();
    let again = scan(&d, "real", "s", std::path::Path::new(&p)).unwrap();
    let v = read(&d, "real").unwrap();
    let said = v.links.iter().filter(|l| l.how == How::Said).count();
    let named = v.links.iter().filter(|l| l.label.is_some()).count();
    let uniq: std::collections::HashSet<&str> = v.links.iter().map(|l| l.url.as_str()).collect();
    println!("REAL found {n} in {first:?} · again {again} in {:?} · said {said} answer {} · named {named} · unique {}", t.elapsed(), v.links.len() - said, uniq.len());
    for l in v.links.iter().take(8) {
        println!("REAL  {} {:?} {} {}", l.ts, l.how, l.url, l.label.as_deref().unwrap_or(""));
    }
    let _ = std::fs::remove_dir_all(&d); // 진짜 링크가 들어 있다
}
