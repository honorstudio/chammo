//! 말이 끝났나 판정 — 5살 말투 표(끝남·이어감·모름)
use super::*;

#[test]
fn five_year_old_endings_table() {
    let r = TurnRules::default();
    // 끝남 — 문장 끝(-요·-다·-야·-지·-줘·-자·-까), 물음·느낌표, 짧은 한 낱말 대답
    for t in ["공룡 그려 줘", "빨간색으로 바꿔줘.", "이거 뭐야?", "좋아!", "공룡", "응", "아니", "두 마리", "토끼가 좋아요", "같이 하자", "이제 다 했다", "이거 공룡이지"] {
        assert_eq!(judge(t, &r), Judge::End, "{t}");
    }
    // 이어감 — 이음 끝(-고·-는데·-서·-면·-랑), 이음 낱말, 머뭇거림, 말꼬리 늘임
    for t in ["공룡이 점프하고", "빨간색인데", "그리고", "어…", "토끼랑", "만들어서", "음", "저기", "그래서", "공룡이 있는데~", "그 다음에 어"] {
        assert_eq!(judge(t, &r), Judge::More, "{t}");
    }
    // 모름 — 끝도 이음도 아닌 말(이름만 늘어놓다 멈춤 등)
    for t in ["공룡이 큰 공룡 빨간 공룡", "오늘 유치원에서 친구랑 블록"] {
        assert_eq!(judge(t, &r), Judge::Unsure, "{t}");
    }
    assert_eq!(judge("", &r), Judge::Unsure, "빈 글은 모름");
}

#[test]
fn rules_come_from_kids_json_and_merge_with_defaults() {
    // 실사용 기록으로 문턱·낱말을 고칠 수 있게 — kids.json "turn"
    let v: TurnRules = serde_json::from_str(r#"{"moreWords":["그니까"],"unsureMs":700}"#).unwrap();
    assert_eq!(judge("그니까", &v), Judge::More);
    assert_eq!(judge("공룡 그려 줘", &v), Judge::End, "기본 끝말은 그대로");
    assert_eq!((v.peek_ms, v.unsure_ms, v.more_ms), (450, 700, 3000));
    let bad: TurnRules = serde_json::from_str(r#"{"peekMs":5,"unsureMs":99999,"moreMs":-1}"#).unwrap_or_default();
    let c = bad.clamped();
    assert!(c.peek_ms >= 250 && c.unsure_ms <= 3000 && c.more_ms >= 1000, "{c:?}");
}

#[test]
fn turn_log_line_keeps_only_numbers_and_the_judge() {
    let d = std::env::temp_dir().join(format!("chammo-kturn-{}-{}", std::process::id(), crate::mobile_pair::random_hex(4).unwrap()));
    std::fs::create_dir_all(&d).unwrap();
    log_turn(&d, 1_000, "c1", "more", 480, true, 3100).unwrap();
    log_turn(&d, 2_000, "c2", "x<script>", 99_999_999, false, 0).unwrap();
    let t = std::fs::read_to_string(d.join("turns.jsonl")).unwrap();
    let rows: Vec<serde_json::Value> = t.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(rows[0]["judge"], "more");
    assert_eq!(rows[0]["resumed"], true);
    assert_eq!(rows[1]["judge"], "?", "모르는 판정 글은 안 남긴다");
    assert!(rows[1]["pause_ms"].as_u64().unwrap() <= 60_000);
}
