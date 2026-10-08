//! 폰에서 참모 깨우기 — 꺼진 참모 고르기·새 참모 이름 짓기. 화면·통신 없음(문지기는 mobile_http.rs).
//! 데스크톱 오케스트레이터 홈(domain/orchHome·stopped)과 같은 셈을 서버 쪽에서 한다 — 폰은 대화 번호와 별명만 보낸다
use serde_json::Value;

/// 이름 나눔표 — "참모-3 · 나스"(domain/orchLabel NICK_SEP)
const NICK_SEP: &str = " · ";
const STOPPED: [&str; 3] = ["stopped", "done", "failed"];
const NICK_MAX: usize = 24;

fn same_dir(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
    !a.is_empty() && norm(a) == norm(b)
}

fn list(json: &str) -> Vec<Value> {
    serde_json::from_str::<Value>(json).ok().and_then(|v| v.as_array().cloned()).unwrap_or_default()
}

fn base_of(name: &str) -> &str {
    name.split_once(NICK_SEP).map_or(name, |(b, _)| b)
}

/// `agents --json --all` 에서 HQ 폴더의 꺼진 대화(이어 켤 수 있는 것) — 지금 살아 있는 대화(live = `agents --json`)는 뺀다. 원문 그대로
pub fn hq_stopped(all_json: &str, live_json: &str, hq: &str) -> Vec<Value> {
    let alive: Vec<String> = list(live_json).iter().filter_map(|a| a["sessionId"].as_str().map(str::to_string)).collect();
    list(all_json)
        .into_iter()
        .filter(|a| {
            let sid = a["sessionId"].as_str().unwrap_or("");
            STOPPED.contains(&a["state"].as_str().unwrap_or(""))
                && !sid.is_empty()
                && !alive.iter().any(|x| x == sid)
                && same_dir(a["cwd"].as_str().unwrap_or(""), hq)
        })
        .collect()
}

/// 그 대화가 HQ 폴더에서 지금 살아 있나(live = `agents --json`) — 폰이 낡은 꺼진 목록에서 누른 것
pub fn hq_live(live_json: &str, hq: &str, session_id: &str) -> bool {
    list(live_json).iter().any(|a| a["sessionId"].as_str() == Some(session_id) && same_dir(a["cwd"].as_str().unwrap_or(""), hq))
}

/// HQ 폴더에서 쓴 적 있는 이름 전부(살아 있는·꺼진) — 번호와 별명 겹침을 이걸로 센다
pub fn hq_names(all_json: &str, hq: &str) -> Vec<String> {
    list(all_json).iter().filter(|a| same_dir(a["cwd"].as_str().unwrap_or(""), hq)).filter_map(|a| a["name"].as_str().map(str::to_string)).collect()
}

/// 다음 참모 이름 — 쓴 번호 중 가장 큰 것 다음(domain/session nextOrchestratorName 과 같은 셈). 하나도 없으면 맨 이름
pub fn next_name(base: &str, names: &[String]) -> String {
    let n = names
        .iter()
        .map(|x| base_of(x))
        .filter_map(|b| if b == base { Some(1) } else { b.strip_prefix(base)?.strip_prefix('-')?.parse::<u32>().ok() })
        .max();
    match n {
        Some(n) => format!("{base}-{}", n + 1),
        None => base.to_string(),
    }
}

/// 별명 다듬기(domain/orchLabel cleanLabel·nickProblem) — 빈칸 하나로·앞뒤 자르기·24자. 비었거나 · 나 제어 문자가 있으면 None
pub fn clean_nick(raw: &str) -> Option<String> {
    if raw.chars().any(|c| c.is_control() && !c.is_whitespace()) || raw.contains('·') {
        return None;
    }
    let t: String = raw.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(NICK_MAX).collect();
    (!t.is_empty()).then_some(t)
}

/// 그 별명을 이미 쓰나 — 별명(없으면 이름 전체)과 대소문자 없이
pub fn nick_taken(names: &[String], nick: &str) -> bool {
    let want = nick.to_lowercase();
    names.iter().any(|n| n.split_once(NICK_SEP).map_or(n.as_str(), |(_, k)| k.trim()).to_lowercase() == want)
}

/// 새 참모 진짜 이름 — "참모-4 · 디자인"
pub fn spawn_name(base: &str, names: &[String], nick: &str) -> String {
    format!("{}{NICK_SEP}{nick}", next_name(base, names))
}

#[cfg(test)]
#[path = "mobile_wake_tests.rs"]
mod tests;
