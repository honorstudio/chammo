//! 아이 말이 끝났나(11-18 사용자 "아이가 더 말하려는 걸 감지하면 추임새, 아니면 말이 끝난 걸 수 있잖아") — 쉼 0.45초에 미리 받아쓴 글로
//! 끝남(바로 대답) · 이어감(추임새 한 번 + 최대 3초 더 듣기) · 모름(0.9초 기다렸다 대답). 규칙·문턱은 kids.json "turn" 으로 고친다(진짜 5살 말투에 맞추게).
//! 판정 기록은 아이 집 turns.jsonl(숫자와 판정만 — 글은 안 남김)로, 나중에 실사용으로 문턱을 고친다
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Judge {
    End,
    More,
    Unsure,
}

impl Judge {
    pub fn as_str(self) -> &'static str {
        match self {
            Judge::End => "end",
            Judge::More => "more",
            Judge::Unsure => "unsure",
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct TurnRules {
    /// 기본에 더하는 끝말·이음말(낱말 끝)
    pub end_words: Vec<String>,
    pub more_words: Vec<String>,
    /// 쉼이 이만큼이면 미리 받아쓰기 · 모름이면 이만큼 쉬고 대답 · 이어감이면 이만큼까지 더 듣기(ms)
    pub peek_ms: i64,
    pub unsure_ms: i64,
    pub more_ms: i64,
    /// 말로 치는 소리 크기(RMS) — 어린아이 작은 목소리에 맞게 고칠 수 있게, 기본은 기록을 본 뒤 정한다
    pub speech_level: f64,
}

impl Default for TurnRules {
    fn default() -> Self {
        TurnRules { end_words: vec![], more_words: vec![], peek_ms: 450, unsure_ms: 900, more_ms: 3000, speech_level: 0.02 }
    }
}

impl TurnRules {
    /// 엉뚱한 값이 들어와도 아이 화면이 멈추지 않게
    pub fn clamped(&self) -> TurnRules {
        let lv = if self.speech_level.is_finite() { self.speech_level.clamp(0.003, 0.2) } else { 0.02 };
        TurnRules { peek_ms: self.peek_ms.clamp(250, 1500), unsure_ms: self.unsure_ms.clamp(400, 3000), more_ms: self.more_ms.clamp(1000, 6000), speech_level: lv, ..self.clone() }
    }
}

const MORE_WORDS: [&str; 14] = ["그리고", "그래서", "근데", "그러면", "그러니까", "그다음에", "다음에", "어", "음", "저기", "있잖아", "그", "막", "아니면"];
const MORE_ENDS: [&str; 11] = ["고", "는데", "은데", "인데", "서", "면", "구", "랑", "하고", "니까", "지만"];
const END_ENDS: [&str; 16] = ["요", "다", "야", "지", "줘", "자", "까", "니", "래", "네", "죠", "해", "어", "봐", "와", "게"];

/// 끝남·이어감·모름
pub fn judge(text: &str, r: &TurnRules) -> Judge {
    let raw = text.trim();
    if raw.is_empty() {
        return Judge::Unsure;
    }
    // 말꼬리 늘임·머뭇거림 표시(받아쓰기가 ~·… 로 적는다)
    if raw.ends_with('~') || raw.ends_with('…') || raw.ends_with("...") {
        return Judge::More;
    }
    if raw.ends_with('?') || raw.ends_with('!') {
        return Judge::End;
    }
    let t = raw.trim_end_matches(['.', ',', ' ']);
    let words: Vec<&str> = t.split_whitespace().collect();
    let last = *words.last().unwrap_or(&"");
    let is = |list: &[&str], extra: &[String]| list.contains(&last) || extra.iter().any(|w| w == last);
    if is(&MORE_WORDS, &r.more_words) {
        return Judge::More;
    }
    let ends = |list: &[&str], extra: &[String]| list.iter().any(|e| last.ends_with(e) && last.chars().count() > e.chars().count()) || extra.iter().any(|e| last.ends_with(e.as_str()));
    if ends(&MORE_ENDS, &r.more_words) {
        return Judge::More;
    }
    // 끝말은 한 글자 낱말 그 자체여도 끝이다(줘·봐·해) — 머뭇거림 '어'·'음'은 위에서 이미 이어감
    if END_ENDS.iter().any(|e| last.ends_with(e)) || r.end_words.iter().any(|e| last.ends_with(e.as_str())) {
        return Judge::End;
    }
    // 짧은 대답 — 한두 낱말(공룡·응·아니·두 마리)
    if words.len() <= 2 && t.chars().count() <= 6 {
        return Judge::End;
    }
    Judge::Unsure
}

/// kids.json 의 "turn"(없으면 기본) — 고친 값은 clamped
pub fn rules_in(data: &Path) -> TurnRules {
    std::fs::read_to_string(data.join("kids").join("kids.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| serde_json::from_value::<TurnRules>(v["turn"].clone()).ok())
        .unwrap_or_default()
        .clamped()
}

/// 판정 한 번 기록 — 쉼(ms)·판정·그 뒤 아이가 이었나·마지막 말에서 끝까지 기다린 시간. 글은 안 남긴다
pub fn log_turn(k: &Path, ts: u64, cid: &str, judge: &str, pause_ms: u64, resumed: bool, waited_ms: u64) -> Result<(), String> {
    log_hear(k, ts, cid, judge, pause_ms, resumed, waited_ms, None, None)
}

fn level(v: Option<f64>) -> serde_json::Value {
    v.filter(|x| x.is_finite()).map(|x| serde_json::json!((x.clamp(0.0, 1.0) * 10_000.0).round() / 10_000.0)).unwrap_or(serde_json::Value::Null)
}

/// 말 받기(hear) 한 번 — 판정 기록 + 그 말의 최대 소리·바닥 소음(어린아이 목소리 문턱을 고칠 근거)
#[allow(clippy::too_many_arguments)]
pub fn log_hear(k: &Path, ts: u64, cid: &str, judge: &str, pause_ms: u64, resumed: bool, waited_ms: u64, lv: Option<f64>, fl: Option<f64>) -> Result<(), String> {
    let judge = if matches!(judge, "end" | "more" | "unsure" | "none") { judge } else { "?" };
    append(k, serde_json::json!({ "ts": ts, "cid": cid, "event": "hear", "judge": judge, "pause_ms": pause_ms.min(60_000), "resumed": resumed, "waited_ms": waited_ms.min(60_000), "max_level": level(lv), "floor": level(fl) }))
}

/// 패드가 말을 못 넘긴 때 — giveup(말로 못 잡고 끝)·empty(받아쓰기 빈 글)·hidden(화면이 가려짐)·error(맥이 못 받음). 숫자만
pub fn log_event(k: &Path, ts: u64, cid: &str, event: &str, lv: Option<f64>, fl: Option<f64>, follow: bool) -> Result<(), String> {
    if !matches!(event, "giveup" | "empty" | "hidden" | "error") {
        return Err("event".into());
    }
    append(k, serde_json::json!({ "ts": ts, "cid": cid, "event": event, "max_level": level(lv), "floor": level(fl), "follow": follow }))
}

fn append(k: &Path, row: serde_json::Value) -> Result<(), String> {
    use std::io::Write;
    std::fs::create_dir_all(k).map_err(|e| e.to_string())?;
    let mut h = std::fs::OpenOptions::new().create(true).append(true).open(k.join("turns.jsonl")).map_err(|e| e.to_string())?;
    writeln!(h, "{row}").map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "kids_turn_tests.rs"]
mod tests;
