//! 키즈 목소리 시험 — 소리로 읽을 글 다듬기·문장 나누기·멀티파트·받아쓰기 서버 답 읽기
use super::*;

#[test]
fn spoken_text_drops_emoji_paths_and_markdown() {
    assert_eq!(clean_say("공룡을 그렸어! 🦖"), "공룡을 그렸어!");
    assert_eq!(clean_say("파일은 `works/dinosaur.svg`에 있어."), "");
    assert_eq!(clean_say("**좋아!** 초록색 공룡이야."), "좋아! 초록색 공룡이야.");
    assert_eq!(clean_say("works/a.html 에 넣었어. 톡 눌러 봐!"), "톡 눌러 봐!");
}

#[test]
fn sentences_split_on_marks_and_lines_and_merge_tiny() {
    assert_eq!(sentences("공룡을 그렸어!\n\n초록색 공룡이야. 등에 노란 뿔이 있어."), ["공룡을 그렸어!", "초록색 공룡이야.", "등에 노란 뿔이 있어."]);
    // 아주 짧은 조각은 다음 문장과 붙인다(따로 만들면 이음새 쉼만 늘어난다)
    assert_eq!(sentences("응! 공룡 그릴게."), ["응! 공룡 그릴게."]);
    assert!(sentences("  ").is_empty());
    // 너무 길면 쉼표에서 나눈다(첫 소리를 빨리)
    let long = "초록색 공룡이 노란 뿔을 달고 해님 아래에서 껑충껑충 뛰어다니는데, 친구 공룡도 같이 놀자고 따라와.";
    assert!(sentences(long).len() >= 2);
}

#[test]
fn multipart_has_file_and_fields() {
    let (ct, body) = multipart(b"RIFFxx", &[("response_format", "json")]);
    let b = String::from_utf8_lossy(&body);
    let bd = ct.split("boundary=").nth(1).unwrap();
    assert!(b.contains(&format!("--{bd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.wav\"")));
    assert!(b.contains("name=\"response_format\"\r\n\r\njson\r\n"));
    assert!(b.ends_with(&format!("--{bd}--\r\n")));
}

#[test]
fn whisper_answer_text_trimmed() {
    assert_eq!(heard_text(r#"{"text":" 공룡이 점프하는 게임 만들어줘\n"}"#), "공룡이 점프하는 게임 만들어줘");
    assert_eq!(heard_text(r#"{"text":" [BLANK_AUDIO]\n"}"#), "", "빈 소리 표시는 말이 아니다");
    assert_eq!(heard_text("깨짐"), "");
}

#[test]
fn clip_store_counts_ready_and_done() {
    let d = std::env::temp_dir().join(format!("chammo-kvoice-{}-{}", std::process::id(), crate::mobile_pair::random_hex(4).unwrap()));
    let c = Clips::new(&d, "k1abc").unwrap();
    assert_eq!(c.state(), (0, false));
    std::fs::write(c.path(0), b"RIFF").unwrap();
    c.mark(1, false).unwrap();
    assert_eq!(c.state(), (1, false));
    c.mark(1, true).unwrap();
    assert_eq!(c.state(), (1, true));
    assert!(Clips::new(&d, "../x").is_err(), "cid 모양");
}

#[test]
fn continuing_endings_wait_longer() {
    for t in ["공룡이 점프하고", "빨간색인데", "그리고", "어…", "토끼랑", "만들어서"] {
        assert!(continues(t), "{t}");
    }
    for t in ["공룡 그려 줘", "빨간색으로 바꿔줘.", "고양이", "좋아!"] {
        assert!(!continues(t), "{t}");
    }
}

fn pre_tmp(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-kpre-{tag}-{}-{}", std::process::id(), crate::mobile_pair::random_hex(4).unwrap()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 가짜 만들기 — 느리게 20개 + 목록을 쓴다(진짜 목소리 서버 대신)
fn fake_make(d: &std::path::Path, n: &std::sync::atomic::AtomicUsize) -> Result<(), String> {
    n.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    std::thread::sleep(std::time::Duration::from_millis(150));
    for i in 1..=PHRASES.len() {
        std::fs::write(d.join(format!("{i:02}.wav")), b"RIFF").unwrap();
    }
    std::fs::write(d.join("index.json"), serde_json::to_string(&PHRASES).unwrap()).unwrap();
    Ok(())
}

#[test]
fn 미리_만든_말은_요청이_몰려도_한_번만_만든다() {
    // 11-18 진짜 맥: 패드가 20개를 한꺼번에 받자 기다리던 요청마다 20개를 처음부터 다시 만들어 목소리 서버·중계 일꾼을 몇 분씩 잡았다
    let d = pre_tmp("once");
    let n = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let hs: Vec<_> = (0..12)
        .map(|_| {
            let (d, n) = (d.clone(), n.clone());
            std::thread::spawn(move || pre_dir_with(&d, || fake_make(&d, &n)))
        })
        .collect();
    for h in hs {
        h.join().unwrap().unwrap();
    }
    assert_eq!(n.load(std::sync::atomic::Ordering::SeqCst), 1, "만들기는 한 번");
    // 이미 있으면 안 만든다
    pre_dir_with(&d, || fake_make(&d, &n)).unwrap();
    assert_eq!(n.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn 패드가_받는_한_마디는_기다리지_않는다() {
    let d = pre_tmp("clip");
    let kicks = std::sync::atomic::AtomicUsize::new(0);
    let kick = || { kicks.fetch_add(1, std::sync::atomic::Ordering::SeqCst); };
    // 아직 없으면 바로 None + 뒤에서 만들기를 건다(일꾼을 안 붙잡는다)
    let t = std::time::Instant::now();
    assert!(pre_clip_in(&d, 1, kick).is_none());
    assert!(t.elapsed().as_millis() < 50);
    assert_eq!(kicks.load(std::sync::atomic::Ordering::SeqCst), 1);
    // 번호가 틀리면 만들기도 안 건다
    assert!(pre_clip_in(&d, 0, kick).is_none());
    assert!(pre_clip_in(&d, PHRASES.len() + 1, kick).is_none());
    assert_eq!(kicks.load(std::sync::atomic::Ordering::SeqCst), 1);
    // 다 만들어졌으면 그 소리
    let n = std::sync::atomic::AtomicUsize::new(0);
    fake_make(&d, &n).unwrap();
    assert_eq!(pre_clip_in(&d, 2, kick).as_deref(), Some(&b"RIFF"[..]));
    assert_eq!(kicks.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn meta_narration_never_reaches_the_child() {
    // 실사용 기록에서 — 다시 이어 붙은(resume) 아이 세션이 해설째 답했고 첫 소리 조각으로 그대로 읽혔다
    let real = "[아이 말 · 키즈 화면 · kid#c1]에서 아이가 \"공룡\"이라고 했어요. 공룡 이야기를 이어 가면 좋겠어요.\n공룡 좋아! 어떤 공룡이 제일 좋아?";
    assert_eq!(strip_meta(real), "공룡 좋아! 어떤 공룡이 제일 좋아?");
    // 한 줄에 붙어 오면 그 문장만
    assert_eq!(strip_meta("아이가 공룡을 말했어요. 공룡 좋아! 같이 그려 볼까?"), "공룡 좋아! 같이 그려 볼까?");
    assert_eq!(strip_meta("[앱 · 작품: 없음] 좋아, 만들어 볼게!"), "좋아, 만들어 볼게!", "이름표만 빼고 말은 남긴다");
    // 보통 답·만들기 표시는 그대로
    for t in ["좋아, 만들어 볼게!\n[만들기 game dino: 공룡 점프]", "안녕! 뭐 만들까?", "공룡이 아이스크림을 먹어!"] {
        assert_eq!(strip_meta(t), t, "{t}");
    }
    // 다 해설이면 빈 글(읽을 게 없다 — 앱이 그 답은 안 읽는다)
    assert_eq!(strip_meta("[아이 말 · 키즈 화면 · kid#x]에서 아이가 말했어요."), "");
}
