//! 보낸 말이 세션 대화 기록(jsonl)에 실제로 들어왔나 — 채팅·폰 보내기의 '보냈다' 기준(2026-11-09 chat-send-stuck, chammo#18).
//! 예전 기준은 '입력칸에서 빠졌나'를 앱이 그린 화면 사본으로 봤는데, TUI 가 느리거나(기록 20만 줄 참모 — 입력이 2초 넘게 늦게 그려짐)
//! 사본이 엉키면 친 글을 한 번도 못 봐(seen=false) Enter 한 번 넣고 '보냄'으로 끝났다. 그 Enter 가 안 먹으면 말이 입력칸에 남고,
//! '다시 보내기'가 같은 글을 또 쳐서 입력칸에 쌓였다가 사람이 터미널에서 Enter 를 치면 한꺼번에 들어갔다.
//! 이제: 보내기 직전 기록 끝을 재 두고, 그 뒤에 붙은 사람 말(user)·대기열(enqueue·queued_command)에 그 글이 있나로 본다.
use crate::claude::{poll_until, SendNote};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::Duration;

/// Enter 뒤 기록에 들어오기를 기다리는 최대 — 느린 참모 세션은 쉬는 중에도 친 글을 2.2초 뒤에 받았다(11-09 19:42 실측)
pub(crate) const LAND_WAIT: Duration = Duration::from_millis(3000);
/// 다시 보내기의 'Enter 먼저' 뒤 기다리는 최대 — 남은 말이 그 Enter 로 갔는데 훅이 늦어 기록이 늦으면 또 쳐서 두 번 간다.
/// 훅이 18~21초 걸린 날도 있었다(2026-10-10) — 치기 차례를 쥐고 기다리니 무작정 늘리진 않는다
pub(crate) const AGAIN_WAIT: Duration = Duration::from_millis(6000);
/// 입력칸을 지운 뒤 빈 칸이 보이기를 기다리는 최대
const CLEAR_MAX: Duration = Duration::from_millis(1500);
/// 다시 친 글이 입력칸에 보이기를 기다리는 최대(못 보면 그냥 Enter)
const RETYPE_SHOWN_MAX: Duration = Duration::from_millis(400);
/// 기록 꼬리를 읽는 최대 — 보낸 뒤 몇 초 사이에 붙는 줄이라 작다(도구 출력이 큰 줄도 넉넉히)
const READ_CAP: u64 = 8 * 1024 * 1024;

/// 한 번 보내기의 기록 자리 — 파일, 보내기 직전 끝(from), 그 말의 알맹이(sig, land_norm)
#[derive(Debug, Clone)]
pub(crate) struct Landing {
    path: PathBuf,
    from: u64,
    sig: String,
}

impl Landing {
    /// 알맹이가 빈 말(경로·그림 칩뿐)은 기록으로 못 가린다 — None
    pub(crate) fn at(path: PathBuf, text: &str) -> Option<Landing> {
        let sig = land_norm(text);
        (!sig.is_empty()).then(|| Landing { path, from: 0, sig }.start())
    }

    /// 세션 짧은 번호(agents 목록의 id, 16진수 8자)로 — 목록에서 sessionId 를 찾아 그 기록 파일. 못 찾으면 None(예전처럼 화면만 본다).
    /// 짧은 번호가 아닌 것(시험의 가짜 id)은 목록을 부르지 않는다
    pub(crate) fn for_session(short: &str, text: &str) -> Option<Landing> {
        if short.len() != 8 || !short.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let list = crate::claude::agents_json().ok()?;
        let sid = session_id_in(&list, short)?;
        Landing::at(crate::claude::transcript_path(&sid)?, text)
    }

    /// 기록 끝을 지금으로 다시 잰다 — 치기 차례(TYPE_LOCK)를 잡은 뒤에. 기다리는 사이 앞 말이 붙은 줄을 이 말로 세지 않게
    pub(crate) fn start(mut self) -> Landing {
        self.from = std::fs::metadata(&self.path).map_or(0, |m| m.len());
        self
    }

    /// 보내기 직전 끝 뒤에 이 말이 들어왔나
    pub(crate) fn landed(&self) -> bool {
        landed_in(&read_from(&self.path, self.from), &self.sig)
    }
}

/// `agents --json` 에서 그 짧은 번호의 sessionId
pub(crate) fn session_id_in(list: &str, short: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(list).ok()?;
    v.as_array()?.iter().find(|a| a["id"].as_str() == Some(short))?["sessionId"].as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

/// from 부터 끝까지(최대 READ_CAP). 파일이 그보다 짧아졌으면(새로 쓰임) 처음부터
fn read_from(path: &std::path::Path, from: u64) -> String {
    let Ok(mut f) = std::fs::File::open(path) else { return String::new() };
    let len = f.metadata().map_or(0, |m| m.len());
    let at = if len < from { 0 } else { from };
    if f.seek(SeekFrom::Start(at)).is_err() {
        return String::new();
    }
    let mut buf = Vec::new();
    let _ = f.take(READ_CAP).read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

/// 기록 줄들 가운데 사람 말·대기열 줄에 sig 가 있나. 도구 결과(tool_result)·답(assistant) 안의 같은 글은 안 센다.
/// 글 없는 enqueue(2.1.319 — 11-09 참모 업데이트 3,150개 중 37개)도 들어간 것으로 — 보내기 직전 끝 뒤에 붙었고 그동안 치기 차례를 쥐고 있어 이 말이다.
/// 못 알아보면 대기열에 이미 든 말을 다시 쳐서 두세 번 갔다(23:09~23:14)
pub(crate) fn landed_in(text: &str, sig: &str) -> bool {
    !sig.is_empty() && text.lines().filter(|l| l.contains("\"user\"") || l.contains("enqueue") || l.contains("queued_command")).any(|l| anon_enqueue(l) || line_texts(l).iter().any(|t| land_norm(t).contains(sig)))
}

/// 글(content) 없는 enqueue 줄
fn anon_enqueue(line: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(line).is_ok_and(|v| v["type"] == "queue-operation" && v["operation"] == "enqueue" && v.get("content").is_none_or(|c| c.is_null()))
}

/// 한 줄에서 사람이 보낸 글 — user 의 content(글 또는 text 조각), 대기열 enqueue 의 content, queued_command 의 prompt
fn line_texts(line: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { return vec![] };
    let c = match v["type"].as_str() {
        Some("user") => &v["message"]["content"],
        Some("queue-operation") if v["operation"].as_str() == Some("enqueue") => &v["content"],
        Some("attachment") if v["attachment"]["type"].as_str() == Some("queued_command") => &v["attachment"]["prompt"],
        _ => return vec![],
    };
    match c {
        serde_json::Value::String(s) => vec![s.clone()],
        serde_json::Value::Array(a) => vec![a.iter().filter(|p| p["type"].as_str() == Some("text")).filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n")],
        _ => vec![],
    }
}

/// 비교할 알맹이 — 그림 칩([Image #n])·파일 경로(/…, ~/…, "…" 경로, 이스케이프 띄어쓰기)·공백을 뺀 글.
/// Claude 는 그림 경로를 칩으로 바꾸고, 앱은 그림·파일 경로를 따로 붙여넣어 기록에선 글 앞·뒤에 경로가 붙는다 — 양쪽에서 같이 빼고 견준다
pub(crate) fn land_norm(s: &str) -> String {
    // 친 키의 줄바꿈(ESC CR)·제어 글자는 띄어쓰기로 — 기록엔 줄바꿈으로 남는다
    let s: String = strip_chips(s).chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let toks: Vec<&str> = s.split_whitespace().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < toks.len() {
        let t = toks[i];
        if ["/", "~/", "\"/", "\"~/"].iter().any(|h| t.starts_with(h)) {
            // 경로 한 덩어리 — 따옴표 경로는 닫는 따옴표까지, '\ ' 로 이은 경로는 다음 낱말까지
            let mut j = i;
            if t.starts_with('"') {
                while j + 1 < toks.len() && !(toks[j].len() > 1 && toks[j].ends_with('"')) {
                    j += 1;
                }
            } else {
                while j + 1 < toks.len() && toks[j].ends_with('\\') {
                    j += 1;
                }
            }
            i = j + 1;
            continue;
        }
        out.push_str(t);
        i += 1;
    }
    out
}

/// [Image #n]·[Pasted text #n …] 같은 칩을 띄어쓰기로
fn strip_chips(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('[') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let chip = ["[Image #", "[Pasted text #"].iter().any(|h| tail.starts_with(h));
        match (chip, tail.find(']')) {
            (true, Some(e)) => {
                out.push(' ');
                rest = &tail[e + 1..];
            }
            _ => {
                out.push('[');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// 들어가게 하는 키 — Enter, 입력칸 n 글자 지우기, 같은 말 다시 치기
pub(crate) struct Keys<'a> {
    pub enter: &'a mut dyn FnMut() -> std::io::Result<()>,
    pub clear: &'a mut dyn FnMut(usize) -> std::io::Result<()>,
    pub retype: &'a mut dyn FnMut() -> std::io::Result<()>,
}

/// Enter 를 넣은 뒤 — 그 말이 기록에 들어왔나로 끝을 정한다. 안 들어왔으면
/// ① Enter 만 한 번 더(같은 글을 또 치지 않는다). 화면을 믿을 수 있고(trusted = 친 글을 한 번이라도 봤다) 그 말이 입력칸에 없으면 안 누른다 — 입력칸의 다른 글이 나간다
/// ② 그래도 안 들어왔고 믿을 화면이 그 말을 입력칸에 쥐고 있으면 비우고(지울 글자 수 = held) 다시 쳐서 Enter.
///    화면을 못 믿으면 ②는 안 한다 — 느린 TUI 가 앞 Enter 를 늦게 받으면 다시 친 글이 두 번 간다.
/// held() = 입력칸에 그 말이 보이면 지울 글자 수, 아니면 None. 돌려주는 값 = 들어갔나
pub(crate) fn ensure_landed(landed: &dyn Fn() -> bool, k: Keys, held: Option<&dyn Fn() -> Option<usize>>, trusted: bool, wait: Duration, note: &mut SendNote) -> std::io::Result<bool> {
    if poll_until(wait, landed) {
        return Ok(true);
    }
    let held_now = || held.and_then(|h| h());
    if trusted && held.is_some() && held_now().is_none() {
        // 입력칸에선 빠졌는데 기록엔 아직 — 조금 더 기다릴 뿐 누르지 않는다
        return Ok(poll_until(wait, landed));
    }
    note.enters += 1;
    note.land_enter = true;
    (k.enter)()?;
    if poll_until(wait, landed) {
        return Ok(true);
    }
    let Some(n) = held_now().filter(|_| trusted) else { return Ok(landed()) };
    note.retyped = true;
    (k.clear)(n + n / 8 + 4)?;
    // 지운 게 화면에 안 보여도 다시 친다 — 화면 사본이 낡아(엉킴) 앞 말을 계속 보여 줄 수 있다. 백스페이스는 진짜 입력칸을 비웠다
    poll_until(CLEAR_MAX, || held_now().is_none());
    (k.retype)()?;
    poll_until(RETYPE_SHOWN_MAX, || held_now().is_some());
    note.enters += 1;
    (k.enter)()?;
    Ok(poll_until(wait, landed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[test]
    fn 알맹이는_칩_경로_공백을_뺀다() {
        assert_eq!(land_norm("#img1 혹시 이것 때문?"), "#img1혹시이것때문?");
        assert_eq!(land_norm("[Image #11] 이거 좀 바꿔볼래"), "이거좀바꿔볼래");
        assert_eq!(land_norm("\"/Users/a b/스크린샷 오후 1.00.png\" #img1 모모 화면"), "#img1모모화면");
        assert_eq!(land_norm("/Users/me/Documents/참모\\ 모모/스크린샷\\ 1.00.00.png #img1 확인"), "#img1확인");
        assert_eq!(land_norm("~/Desktop/a.md #file1 이 파일"), "#file1이파일");
        assert_eq!(land_norm("첫 줄\n둘째 줄"), "첫줄둘째줄");
        assert_eq!(land_norm("첫 줄\x1b\r둘째 줄"), land_norm("첫 줄\n둘째 줄"), "친 키의 줄바꿈(ESC CR)은 기록의 줄바꿈과 같다");
        assert_eq!(land_norm("a/b 와 [링크] 비교"), "a/b와[링크]비교", "경로·칩이 아닌 건 그대로");
        assert_eq!(land_norm("\"/Users/a.png\""), "", "경로뿐인 말은 빈 알맹이");
    }

    #[test]
    fn 사람_말과_대기열만_센다() {
        let sig = land_norm("이거 좀 바꿔볼래");
        let user = r#"{"type":"user","message":{"role":"user","content":"이거 좀 바꿔볼래"}}"#;
        let parts = r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Image #11] 이거 좀 바꿔볼래"},{"type":"image","source":{}}]}}"#;
        let queued = r##"{"type":"queue-operation","operation":"enqueue","timestamp":"t","content":"#img1 .\n이거 좀 바꿔볼래\n/Users/a\\ b.png"}"##;
        let att = r#"{"type":"attachment","attachment":{"type":"queued_command","prompt":"이거 좀 바꿔볼래"}}"#;
        for l in [user, parts, queued, att] {
            assert!(landed_in(l, &sig), "{l}");
        }
        let tool = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"이거 좀 바꿔볼래"}]}}"#;
        let answer = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"이거 좀 바꿔볼래"}]}}"#;
        let removed = r#"{"type":"queue-operation","operation":"remove","content":"이거 좀 바꿔볼래"}"#;
        let anon = r#"{"type":"queue-operation","operation":"enqueue","timestamp":"2026-01-01T00:00:00.000Z","sessionId":"c0ffee11"}"#;
        assert!(landed_in(anon, &sig), "글 없는 enqueue 도 들어간 것(실측 모양)");
        let empty_text = r#"{"type":"queue-operation","operation":"enqueue","content":""}"#;
        assert!(!landed_in(empty_text, &sig), "글이 빈 문자열인 건 다른 말");
        for l in [tool, answer, removed, "깨진 줄 \"user\""] {
            assert!(!landed_in(l, &sig), "{l}");
        }
        assert!(!landed_in(user, ""), "빈 알맹이는 못 가린다");
    }

    #[test]
    fn 보내기_전에_있던_같은_말은_안_센다() {
        let dir = std::env::temp_dir().join(format!("land-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("s.jsonl");
        let line = r#"{"type":"user","message":{"role":"user","content":"."}}"#;
        std::fs::write(&p, format!("{line}\n")).unwrap();
        let l = Landing::at(p.clone(), ".").unwrap();
        assert!(!l.landed(), "앞서 간 '.' 은 이번 말이 아니다");
        std::fs::write(&p, format!("{line}\n{line}\n")).unwrap();
        assert!(l.landed());
        // 파일이 새로 쓰여 짧아지면 처음부터
        std::fs::write(&p, format!("{line}\n")).unwrap();
        let l2 = Landing { path: p.clone(), from: 10_000, sig: ".".into() };
        assert!(l2.landed());
        assert!(Landing::at(p, "\"/Users/a.png\"").is_none(), "경로뿐인 말은 기록으로 안 가린다");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn 목록에서_sessionid() {
        let list = r#"[{"id":"c0ffee11","sessionId":"c0ffee11-0000-4000"},{"id":"aaaa0001","sessionId":""}]"#;
        assert_eq!(session_id_in(list, "c0ffee11").as_deref(), Some("c0ffee11-0000-4000"));
        assert_eq!(session_id_in(list, "aaaa0001"), None);
        assert_eq!(session_id_in("nope", "c0ffee11"), None);
        assert!(Landing::for_session("t", "글").is_none(), "짧은 번호가 아니면 목록을 안 부른다");
    }

    /// 가짜 칸: Enter 를 몇 번 버리고, held = 입력칸에 그 말이 있나
    struct Box_ {
        input: RefCell<String>,
        swallow: Cell<usize>,
        sent: RefCell<Vec<String>>,
        enters: Cell<usize>,
    }

    fn run(swallow: usize, trusted: bool, show: bool) -> (bool, SendNote, Vec<String>) {
        let b = Box_ { input: RefCell::new("보낼 말".into()), swallow: Cell::new(swallow), sent: RefCell::new(vec![]), enters: Cell::new(0) };
        let mut note = SendNote::default();
        let landed = || b.sent.borrow().iter().any(|s| land_norm(s).contains("보낼말"));
        let held = || (show && b.input.borrow().contains("보낼 말")).then(|| b.input.borrow().chars().count());
        let ok = ensure_landed(
            &landed,
            Keys {
                enter: &mut || {
                    b.enters.set(b.enters.get() + 1);
                    if b.swallow.get() > 0 {
                        b.swallow.set(b.swallow.get() - 1);
                    } else if !b.input.borrow().is_empty() {
                        let t = std::mem::take(&mut *b.input.borrow_mut());
                        b.sent.borrow_mut().push(t);
                    }
                    Ok(())
                },
                clear: &mut |n| {
                    for _ in 0..n {
                        b.input.borrow_mut().pop();
                    }
                    Ok(())
                },
                retype: &mut || {
                    b.input.borrow_mut().push_str("보낼 말");
                    Ok(())
                },
            },
            Some(&held),
            trusted,
            Duration::from_millis(30),
            &mut note,
        )
        .unwrap();
        let sent = b.sent.borrow().clone();
        (ok, note, sent)
    }

    #[test]
    fn 이미_들어갔으면_아무것도_안_누른다() {
        let b = RefCell::new(0);
        let mut note = SendNote::default();
        let ok = ensure_landed(&|| true, Keys { enter: &mut || { *b.borrow_mut() += 1; Ok(()) }, clear: &mut |_| Ok(()), retype: &mut || Ok(()) }, None, false, Duration::from_millis(30), &mut note).unwrap();
        assert!(ok && *b.borrow() == 0 && note.enters == 0);
    }

    #[test]
    fn 안_들어갔으면_enter_만_한_번_더() {
        // 앞 Enter(send_watched)가 버려져 입력칸에 남은 칸 — 같은 글을 또 치지 않고 Enter 로 들어간다
        let (ok, note, sent) = run(0, false, false);
        assert!(ok, "{note:?}");
        assert_eq!(sent, vec!["보낼 말".to_string()]);
        assert!(note.land_enter && !note.retyped, "{note:?}");
    }

    #[test]
    fn enter_도_안_먹으면_비우고_다시_친다_믿을_화면일_때만() {
        let (ok, note, sent) = run(1, true, true);
        assert!(ok && note.retyped, "{note:?}");
        assert_eq!(sent, vec!["보낼 말".to_string()], "겹치지 않고 한 번");
        // 화면을 못 믿으면(친 글을 한 번도 못 봄) 다시 치지 않는다 — 늦게 들어가면 두 번 간다
        let (ok, note, sent) = run(1, false, false);
        assert!(!ok && !note.retyped && sent.is_empty(), "{note:?}");
    }

    #[test]
    fn 낡은_화면이_지운_뒤에도_그_말을_보여도_다시_친다() {
        // 엉킨 사본이 앞 말을 입력칸에 계속 보여 준다 — '이미 있다'고 안 친 말이 빈 진짜 칸에서 Enter 만 받아 아무 데도 안 갔다
        let sent = RefCell::new(Vec::<String>::new());
        let real = RefCell::new(String::new());
        let mut note = SendNote::default();
        let stale = || Some(4usize);
        let ok = ensure_landed(
            &|| sent.borrow().iter().any(|s| s == "보낼 말"),
            Keys {
                enter: &mut || {
                    let t = std::mem::take(&mut *real.borrow_mut());
                    if !t.is_empty() {
                        sent.borrow_mut().push(t);
                    }
                    Ok(())
                },
                clear: &mut |_| {
                    real.borrow_mut().clear();
                    Ok(())
                },
                retype: &mut || {
                    real.borrow_mut().push_str("보낼 말");
                    Ok(())
                },
            },
            Some(&stale),
            true,
            Duration::from_millis(20),
            &mut note,
        )
        .unwrap();
        assert!(ok && note.retyped, "{note:?}");
        assert_eq!(*sent.borrow(), vec!["보낼 말".to_string()]);
    }

    #[test]
    fn 믿을_화면에서_그_말이_입력칸에_없으면_enter_를_안_넣는다() {
        // 입력칸이 비었거나 다른 글 — Enter 는 그 다른 글을 보낸다
        let b = RefCell::new(0);
        let mut note = SendNote::default();
        let none = || None;
        let ok = ensure_landed(&|| false, Keys { enter: &mut || { *b.borrow_mut() += 1; Ok(()) }, clear: &mut |_| Ok(()), retype: &mut || Ok(()) }, Some(&none), true, Duration::from_millis(20), &mut note).unwrap();
        assert!(!ok && *b.borrow() == 0, "{note:?}");
    }
}
