//! 키즈 배선 시험 — 아이 세션 답 옮기기·기록 읽기·세션 자리(계획 docs/plans/kids-mode.md C)
use super::*;
use std::path::PathBuf;

fn tmpdir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-kidswire-{tag}-{}-{}", std::process::id(), crate::mobile_pair::random_hex(4).unwrap()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn line(v: serde_json::Value) -> String {
    format!("{v}\n")
}

fn assistant(text: &str, ts: &str) -> String {
    line(serde_json::json!({ "type": "assistant", "timestamp": ts, "message": { "role": "assistant", "content": [{ "type": "text", "text": text }] } }))
}

fn rows(k: &std::path::Path) -> Vec<serde_json::Value> {
    let mut out = vec![];
    let mut files: Vec<PathBuf> = std::fs::read_dir(k.join("log")).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "jsonl")).collect();
    files.sort();
    for f in files {
        for l in std::fs::read_to_string(f).unwrap().lines() {
            out.push(serde_json::from_str(l).unwrap());
        }
    }
    out
}

#[test]
fn iso_to_ms_reads_claude_timestamps() {
    assert_eq!(iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
    assert_eq!(iso_ms("2026-11-17T12:00:00.500Z"), Some(1_794_916_800_500));
    assert_eq!(iso_ms("엉망"), None);
}

#[test]
fn ready_reply_is_not_the_answer_to_the_first_kid_words() {
    // 11-18 아침 점검: 첫 말이 세션을 띄우면 준비 지시('준비됐어…')에 대한 답("알겠어. 아이 말이 들어오면 그때 시작할게.")이
    // 아이 말의 대답으로 읽혔다 — 준비 답은 ready 로 적어 아이에게 안 읽고 패드·보호자 화면에도 안 띄운다. 나눠 읽어도(옮기기 사이에 끊겨도) 이어진다
    let d = tmpdir("ready");
    let k = crate::kids::ensure_home(&d, "참모-2").unwrap();
    let t = d.join("s.jsonl");
    let mut body = line(serde_json::json!({ "type": "user", "message": { "role": "user", "content": READY } }));
    std::fs::write(&t, &body).unwrap();
    let off = sync_replies_from(&k, &t, 0).unwrap();
    body += &assistant("알겠어. 아이 말이 들어오면 그때 시작할게.", "2026-11-17T12:00:01.000Z");
    body += &line(serde_json::json!({ "type": "user", "message": { "role": "user", "content": [{ "type": "text", "text": "[아이 말 · 키즈 화면 · kid#c1]\n안녕하세요" }] } }));
    body += &assistant("안녕! 만나서 반가워.", "2026-11-17T12:00:03.000Z");
    std::fs::write(&t, &body).unwrap();
    sync_replies_from(&k, &t, off).unwrap();
    let r = rows(&k);
    let who: Vec<_> = r.iter().map(|x| x["who"].as_str().unwrap().to_string()).collect();
    assert_eq!(who, ["ready", "assistant"], "{r:?}");
    assert_eq!(r[1]["text"], "안녕! 만나서 반가워.");
}

#[test]
fn meta_narration_is_stripped_when_moving_replies() {
    // 실사용 기록에서 — 해설째 답이 기록(=소리·보호자 화면)으로 갔다
    let d = tmpdir("meta");
    let k = crate::kids::ensure_home(&d, "참모-5").unwrap();
    let t = d.join("s.jsonl");
    let body = assistant("[아이 말 · 키즈 화면 · kid#c1]에서 아이가 \"공룡\"이라고 했어요. 공룡 이야기를 이어 가면 좋겠어요.\n공룡 좋아! 어떤 공룡이 제일 좋아?", "2026-01-02T03:04:05.000Z")
        + &assistant("[아이 말 · 키즈 화면 · kid#x]에서 아이가 말했어요.", "2026-01-02T03:04:10.000Z");
    std::fs::write(&t, &body).unwrap();
    sync_replies_from(&k, &t, 0).unwrap();
    let r = rows(&k);
    assert_eq!(r.len(), 1, "해설뿐인 답은 안 옮긴다: {r:?}");
    assert_eq!(r[0]["text"], "공룡 좋아! 어떤 공룡이 제일 좋아?");
}

#[test]
fn replies_move_assistant_text_once() {
    let d = tmpdir("reply");
    let k = crate::kids::ensure_home(&d, "참모-2").unwrap();
    let t = d.join("s.jsonl");
    let mut body = String::new();
    body += &line(serde_json::json!({ "type": "user", "message": { "role": "user", "content": "[아이 말 · 키즈 화면 · kid#c1]\n공룡" } }));
    body += &assistant("좋아! 공룡 그려 볼게.", "2026-11-17T12:00:01.000Z");
    body += &line(serde_json::json!({ "type": "assistant", "timestamp": "2026-11-17T12:00:02.000Z", "message": { "content": [{ "type": "tool_use", "name": "Write", "input": {} }] } }));
    std::fs::write(&t, &body).unwrap();
    let off = sync_replies_from(&k, &t, 0).unwrap();
    assert_eq!(off, body.len() as u64);
    // 두 번 불러도 같은 답을 또 안 옮긴다
    assert_eq!(sync_replies_from(&k, &t, off).unwrap(), off);
    let r = rows(&k);
    assert_eq!(r.len(), 1, "도구 호출·아이 말은 안 옮긴다: {r:?}");
    assert_eq!(r[0]["who"], "assistant");
    assert_eq!(r[0]["text"], "좋아! 공룡 그려 볼게.");
    assert_eq!(r[0]["ts"], 1_794_916_801_000u64);
}

#[test]
fn half_written_last_line_waits() {
    let d = tmpdir("half");
    let k = crate::kids::ensure_home(&d, "참모-2").unwrap();
    let t = d.join("s.jsonl");
    let full = assistant("하나", "2026-11-17T12:00:01.000Z");
    std::fs::write(&t, format!("{full}{{\"type\":\"assist")).unwrap();
    let off = sync_replies_from(&k, &t, 0).unwrap();
    assert_eq!(off, full.len() as u64, "줄 끝이 없는 마지막 줄은 다음에");
    assert_eq!(rows(&k).len(), 1);
}

#[test]
fn shrunk_transcript_restarts_from_zero_without_duplicates_of_new() {
    // /clear 등으로 기록 파일이 짧아지면 처음부터 — 오프셋이 파일보다 크면 0 으로
    let d = tmpdir("shrink");
    let k = crate::kids::ensure_home(&d, "참모-2").unwrap();
    let t = d.join("s.jsonl");
    std::fs::write(&t, assistant("새 답", "2026-11-17T12:00:01.000Z")).unwrap();
    let off = sync_replies_from(&k, &t, 99_999).unwrap();
    assert_eq!(rows(&k).len(), 1);
    assert!(off > 0);
}

#[test]
fn recent_log_reads_days_in_order_and_caps() {
    let d = tmpdir("recent");
    let k = crate::kids::ensure_home(&d, "참모-2").unwrap();
    let day = 86_400_000u64;
    let base = 1_795_003_200_000u64;
    crate::kids::log_line(&k, base - 2 * day, "kid", "그저께", None).unwrap();
    crate::kids::log_line(&k, base - day, "kid", "어제", None).unwrap();
    crate::kids::log_line(&k, base, "assistant", "오늘", None).unwrap();
    let r = recent_log(&k, base, 2, 100);
    assert_eq!(r.iter().map(|x| x.text.as_str()).collect::<Vec<_>>(), ["어제", "오늘"], "이틀 치만, 시간순");
    let r = recent_log(&k, base, 7, 2);
    assert_eq!(r.iter().map(|x| x.text.as_str()).collect::<Vec<_>>(), ["어제", "오늘"], "상한이면 최근 것");
}

#[test]
fn session_file_roundtrip() {
    let d = tmpdir("sess");
    let k = crate::kids::ensure_home(&d, "참모-2").unwrap();
    assert!(read_session(&k).is_none());
    write_session(&k, &Sess { id: "5eed0a11".into(), at: 1, file: None, off: 0 }).unwrap();
    let s = read_session(&k).unwrap();
    assert_eq!(s.id, "5eed0a11");
    // 번호 모양이 아니면 믿지 않는다(기록 파일 찾기에 쓰니까)
    std::fs::write(k.join("session.json"), r#"{"id":"../x","at":1}"#).unwrap();
    assert!(read_session(&k).is_none());
}

#[test]
fn transcript_found_by_short_id_prefix() {
    let d = tmpdir("find");
    let p = d.join("-Users-x-kids-a");
    std::fs::create_dir_all(&p).unwrap();
    std::fs::write(p.join("5eed0a11-1234-4cde-8f00-00000000beef.jsonl"), "").unwrap();
    std::fs::write(p.join("aaaa0000-0000-0000-0000-000000000000.jsonl"), "").unwrap();
    assert_eq!(find_transcript(&d, "5eed0a11"), Some(p.join("5eed0a11-1234-4cde-8f00-00000000beef.jsonl")));
    assert_eq!(find_transcript(&d, "ffffffff"), None);
}

#[test]
fn alive_reads_agents_json() {
    let j = r#"[{"id":"5eed0a11","state":"working"},{"id":"11112222","state":"stopped"}]"#;
    assert!(alive_in(j, "5eed0a11"));
    assert!(!alive_in(j, "11112222"), "꺼진 세션은 산 게 아니다");
    assert!(!alive_in(j, "deadbeef"));
    assert!(!alive_in("깨짐", "5eed0a11"));
}

// 진짜 claude --bg 로 켜기 → 살아 있나 → 첫 답 옮기기 → 끄기. 아이 집은 ~/.claude 밖 임시 폴더, CHAMMO_HOME 도 임시로(log_out 이 진짜 데이터 폴더에 쓰지 않게).
//   CHAMMO_HOME=$(mktemp -d) cargo test kids_wire::tests::real_wire_e2e -- --ignored --test-threads=1 --nocapture
#[test]
#[ignore]
fn real_wire_e2e() {
    let d = tmpdir("real");
    let k = crate::kids::ensure_home(&d, "시험참모").unwrap();
    let id = start(&k, "시험참모").expect("켜기");
    println!("세션 {id}");
    assert!((0..20).any(|_| {
        std::thread::sleep(std::time::Duration::from_secs(1));
        crate::claude::forget_agents();
        alive(&id)
    }), "켜진 세션이 목록에 없다");
    // 첫 지시('준비됐어…')에 대한 답이 기록 파일에 쌓이면 옮긴다
    let moved = (0..45).any(|_| {
        std::thread::sleep(std::time::Duration::from_secs(2));
        sync(&k);
        rows(&k).iter().any(|r| r["who"] == "assistant" || r["who"] == "ready")
    });
    let s = read_session(&k).unwrap();
    stop(&k);
    let _ = crate::platform::command(crate::claude::claude_bin()).args(["rm", &id]).output();
    let r = rows(&k);
    println!("기록 {} 줄 · 기록 파일 {:?} · 오프셋 {}", r.len(), s.file, s.off);
    for x in &r {
        println!("  {} {}", x["who"], x["text"].as_str().unwrap_or("").chars().take(60).collect::<String>());
    }
    assert!(moved, "아이 세션 답을 못 옮겼다");
    assert!(s.file.is_some() && s.off > 0, "기록 파일·오프셋을 기억 못 했다");
    std::thread::sleep(std::time::Duration::from_secs(2));
    crate::claude::forget_agents();
    assert!(!alive(&id), "끈 세션이 아직 산다");
}
