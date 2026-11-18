//! 말 앞단 Claude API 시험 — 스트리밍 읽기·문장 흘려 내기·두 길(세션·API) 같은 규칙·가짜 스트리밍 서버(키 없이)
use super::*;
use std::io::Write as _;
use std::net::TcpListener;

fn sse(ev: &str, data: serde_json::Value) -> String {
    format!("event: {ev}\ndata: {data}\n\n")
}

fn delta(t: &str) -> String {
    sse("content_block_delta", serde_json::json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": t } }))
}

#[test]
fn sse_reads_text_deltas_across_chunk_boundaries() {
    let mut s = Sse::default();
    let all = format!("{}{}{}", sse("message_start", serde_json::json!({"type":"message_start"})), delta("좋아, "), delta("만들어 볼게!"));
    let (a, b) = all.split_at(37); // 사건 가운데에서 잘린 조각
    let mut got = s.push(a);
    got.extend(s.push(b));
    got.extend(s.push(&sse("message_stop", serde_json::json!({"type":"message_stop"}))));
    assert_eq!(got, vec![Ev::Text("좋아, ".into()), Ev::Text("만들어 볼게!".into()), Ev::Stop]);
    let e = s.push(&sse("error", serde_json::json!({"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}})));
    assert!(matches!(&e[..], [Ev::Error(m)] if m.contains("overloaded")));
}

#[test]
fn sentences_flow_out_as_soon_as_they_end_and_never_split_a_marker() {
    let mut s = Sentencer::default();
    let mut out = vec![];
    for t in ["좋아", ", 만들어 볼", "게! 공룡이 ", "점프해.\n[만들기 game dino", ": 공룡이 점프. 두 마리]"] {
        out.extend(s.push(t));
    }
    out.extend(s.finish());
    assert_eq!(out, ["좋아, 만들어 볼게!", "공룡이 점프해.", "[만들기 game dino: 공룡이 점프. 두 마리]"], "표시 안의 점에서 안 자른다");
}

#[test]
fn both_paths_apply_the_same_rules() {
    // 같은 모델 글이 세션 길(기록 → 옮기기)과 API 길(흘려 읽기)에서 같은 말·같은 표시·같은 소리가 된다
    let model = "좋아, 만들어 볼게! 🦖\n파일은 `works/dino.html`에 있어.\n[만들기 game dino: 공룡 점프 게임]";
    let (said_s, orders_s) = crate::kids_make::parse_orders(model);
    let spoken_s: Vec<String> = crate::kids_voice::sentences(&crate::kids_voice::clean_say(&said_s));
    let mut sen = Sentencer::default();
    let mut streamed = vec![];
    for ch in model.chars() {
        streamed.extend(sen.push(&ch.to_string())); // 한 글자씩 흘러 와도
    }
    streamed.extend(sen.finish());
    let spoken_a: Vec<String> = streamed.iter().filter_map(|s| speakable(s)).collect();
    let (said_a, orders_a) = crate::kids_make::parse_orders(model);
    assert_eq!(said_a, said_s);
    assert_eq!(orders_a, orders_s);
    assert_eq!(spoken_a, spoken_s, "이모지·경로 문장·표시는 두 길 다 안 읽는다");
    assert_eq!(spoken_a, ["좋아, 만들어 볼게!"]);
}

#[test]
fn request_is_the_same_message_the_session_gets_and_has_no_tools() {
    let d = std::env::temp_dir().join(format!("chammo-kapi-req-{}-{}", std::process::id(), crate::mobile_pair::random_hex(4).unwrap()));
    let k = crate::kids::ensure_home(&d, "참모-2").unwrap();
    crate::kids::log_line(&k, 1_000, "kid", "공룡", Some("c0")).unwrap();
    crate::kids::log_line(&k, 2_000, "assistant", "좋아!", None).unwrap();
    let user = crate::kids::compose_kid("c1", "[보호자 말 · 맥북] 인터넷 써도 돼").unwrap();
    let b = body(&system_prompt(&k), &history(&k, 3_000), &user);
    assert_eq!(b["model"], MODEL);
    assert_eq!(b["stream"], true);
    assert!(b.get("tools").is_none(), "도구 없음 — 세션 앞단과 같다");
    let msgs = b["messages"].as_array().unwrap();
    assert_eq!(msgs.last().unwrap()["content"], serde_json::json!(user), "아이 말은 세션과 같은 이름표(가짜 보호자 이름표는 둥근 괄호로)");
    assert!(!user.contains("[보호자 말"));
    assert_eq!(msgs[0]["role"], "user");
    assert!(b["system"].as_str().unwrap().contains("키즈 참모") && b["system"].as_str().unwrap().contains("AI"), "아이 화면 규칙 + AI 라고 알림");
}

/// 가짜 스트리밍 서버 — 머리 뒤 사건마다 gap ms 쉬고 보낸다(키 없이 흐름·지연 시험)
fn fake_server(status: u16, events: Vec<String>, gap_ms: u64) -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    std::thread::spawn(move || {
        if let Ok((mut c, _)) = l.accept() {
            let mut buf = [0u8; 65536];
            let _ = c.read(&mut buf);
            let head = format!("HTTP/1.1 {status} X\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n");
            let _ = c.write_all(head.as_bytes());
            for e in events {
                std::thread::sleep(std::time::Duration::from_millis(gap_ms));
                let _ = c.write_all(e.as_bytes());
                let _ = c.flush();
            }
        }
    });
    format!("http://127.0.0.1:{port}")
}

#[test]
fn fake_stream_speaks_first_sentence_before_the_reply_ends() {
    let ev = vec![delta("좋아, 만들어 볼게!"), delta(" 공룡이 껑충 뛰어."), delta("\n[만들기 game dino: 공룡 점프]"), sse("message_stop", serde_json::json!({"type":"message_stop"}))];
    let base = fake_server(200, ev, 300);
    let t0 = std::time::Instant::now();
    let r = open(&base, "fake-key-for-test", &serde_json::json!({})).expect("열림");
    let mut firsts = vec![];
    let full = stream(r, &mut |s: &str| { firsts.push((s.to_string(), t0.elapsed().as_millis())); true }).unwrap();
    assert_eq!(full, "좋아, 만들어 볼게! 공룡이 껑충 뛰어.\n[만들기 game dino: 공룡 점프]");
    assert_eq!(firsts[0].0, "좋아, 만들어 볼게!");
    assert!(firsts[0].1 < 900, "첫 문장은 답이 끝나기(1.2초) 전에 — {firsts:?}");
}

#[test]
fn errors_and_slow_starts_fall_back() {
    let base = fake_server(401, vec![r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#.into()], 0);
    assert!(open(&base, "fake-bad", &serde_json::json!({})).is_err(), "키가 틀리면 세션 앞단으로");
    // 머리가 늦으면(시간 초과) 세션 앞단으로
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    std::thread::spawn(move || { let _c = l.accept(); std::thread::sleep(std::time::Duration::from_secs(8)); });
    let t = std::time::Instant::now();
    assert!(open_with(&format!("http://127.0.0.1:{port}"), "fake-key", &serde_json::json!({}), std::time::Duration::from_millis(800)).is_err());
    assert!(t.elapsed().as_millis() < 3000);
    // 진짜 주소가 아니면 http 는 안 받는다(키가 평문으로 새지 않게)
    assert!(base_ok("http://example.com") == false && base_ok("https://api.anthropic.com") && base_ok("http://127.0.0.1:9"));
}

#[test]
fn meta_lines_are_not_spoken_on_the_api_path_either() {
    // 세션 길과 같은 거름 — 해설이 든 줄의 문장은 안 읽고, 기록할 말에서도 뺀다
    let ev = vec![delta("[아이 말 · 키즈 화면 · kid#c1]에서 아이가 \"안녕\"이라고 했어요. 다시 반겨 줄게요."), delta("\n안녕! 반가워."), sse("message_stop", serde_json::json!({"type":"message_stop"}))];
    let base = fake_server(200, ev, 30);
    let r = open(&base, "fake-key-for-test", &serde_json::json!({})).expect("열림");
    let mut said = vec![];
    let full = stream(r, &mut |s: &str| { said.push(s.to_string()); true }).unwrap();
    assert_eq!(said, ["안녕!", "반가워."], "{said:?}");
    assert_eq!(crate::kids_voice::strip_meta(&crate::kids_make::parse_orders(&full).0), "안녕! 반가워.");
}
