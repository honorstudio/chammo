//! 끊고 보내기 — Esc 뒤 세션이 정말 멈췄나를 대화 기록(jsonl)으로 본다(2026-11-17 참모 채팅 '이렇게 보냈음').
//! Claude Code 는 일하는 중 받은 말을 대기열에 두었다가 도구 결과 뒤에 그 턴에 넣는다(queued_command). 넣은 직후 Esc 가 오면
//! 턴째 끊겨 그 말엔 끝내 답이 없다 — 시험 세션 실측(E: 넣고 0.2초 뒤 Esc → '[Request interrupted by user]' 만 남음).
//! 아직 안 넣은 말은 Esc 에 꺼내져 새 턴으로 간다(B). 그래서: Esc 를 먼저, 기록에 끊김이 붙은 걸 본 뒤에 새 글을 치고,
//! 끊긴 턴에 들어가 버린 사람 말(lost)은 다시 넣는다. agents 목록의 state 는 끊긴 뒤에도 working 으로 남아(실측) 못 믿는다.
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// 기록에서 본 멈춤
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Idle {
    /// Esc 뒤 '[Request interrupted by user…]' 가 붙었다
    Interrupt,
    /// Esc 는 안 먹었지만 턴이 제대로 끝났다(turn_duration)
    Ended,
    /// 보기 전부터 이미 멈춰 있었다(앞 Esc 로 끊겼거나 쉬는 중)
    Already,
}

impl Idle {
    fn name(self) -> &'static str {
        match self {
            Idle::Interrupt => "interrupt",
            Idle::Ended => "ended",
            Idle::Already => "already",
        }
    }
}

fn parse(line: &str) -> Option<serde_json::Value> {
    serde_json::from_str(line).ok()
}

/// 사람 말 줄(user)의 글 — 글이거나 text 조각들. 도구 결과만 있는 줄은 None
fn user_text(v: &serde_json::Value) -> Option<String> {
    if v["type"] != "user" {
        return None;
    }
    match &v["message"]["content"] {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(a) => {
            let t: Vec<&str> = a.iter().filter(|p| p["type"] == "text").filter_map(|p| p["text"].as_str()).collect();
            (!t.is_empty()).then(|| t.join("\n"))
        }
        _ => None,
    }
}

fn is_interrupt(v: &serde_json::Value) -> bool {
    user_text(v).is_some_and(|t| t.trim_start().starts_with("[Request interrupted by user"))
}

fn is_turn_end(v: &serde_json::Value) -> bool {
    v["type"] == "system" && v["subtype"] == "turn_duration"
}

/// 새로 붙은 줄들에서 멈춤 — 끊김이 먼저 보이면 Interrupt, 턴 끝이면 Ended
pub(crate) fn idle_in(new: &str) -> Option<Idle> {
    new.lines().filter_map(parse).find_map(|v| {
        if is_interrupt(&v) {
            Some(Idle::Interrupt)
        } else if is_turn_end(&v) {
            Some(Idle::Ended)
        } else {
            None
        }
    })
}

/// 보기 전 기록의 마지막 턴 줄(사람 말·답·턴 끝)이 끊김이나 턴 끝이면 이미 멈춰 있다
pub(crate) fn idle_before(old: &str) -> bool {
    old.lines()
        .rev()
        .filter_map(parse)
        .find(|v| v["type"] == "assistant" || is_turn_end(v) || user_text(v).is_some())
        .is_some_and(|v| is_interrupt(&v) || is_turn_end(&v))
}

/// 사람이 친 대기 말인가 — origin 이 없거나 human. 다른 세션이 보낸 말(SendMessage)은 사람이 다시 넣을 말이 아니다
fn human_queued(v: &serde_json::Value) -> Option<String> {
    let a = &v["attachment"];
    if v["type"] != "attachment" || a["type"] != "queued_command" {
        return None;
    }
    let kind = a["origin"]["kind"].as_str();
    if kind.is_some_and(|k| k != "human") {
        return None;
    }
    a["prompt"].as_str().map(str::to_string).filter(|s| !s.trim().is_empty())
}

/// 마지막 끊김 바로 앞 턴에 들어갔다가 같이 끊긴 사람 말들(들어간 순서) — 끊김에서 거꾸로, 보이는 답(assistant 글)이나
/// 진짜 사람 말 줄을 만나면 멈춘다(그 앞 말은 답을 받았거나 그 턴의 시작). 생각·도구 호출·도구 결과·훅 줄은 건너간다.
/// 끊김 뒤에 같은 글이 사람 말로 다시 붙었으면(대기열에서 꺼내 보냄) 뺀다
pub(crate) fn lost_prompts(region: &str) -> Vec<String> {
    let rows: Vec<serde_json::Value> = region.lines().filter_map(parse).collect();
    let Some(at) = rows.iter().rposition(is_interrupt) else { return vec![] };
    let mut lost = Vec::new();
    for v in rows[..at].iter().rev() {
        if let Some(p) = human_queued(v) {
            lost.push(p);
            continue;
        }
        if v["type"] == "assistant" && v["message"]["content"].as_array().is_some_and(|a| a.iter().any(|p| p["type"] == "text" && p["text"].as_str().is_some_and(|t| !t.trim().is_empty()))) {
            break;
        }
        if user_text(v).is_some() {
            break;
        }
    }
    lost.reverse();
    let after: Vec<String> = rows[at + 1..].iter().filter_map(user_text).collect();
    lost.retain(|p| !after.iter().any(|a| a.trim() == p.trim()));
    lost
}

/// 기록 파일 from 부터 끝까지(최대 cap)
fn read_range(path: &Path, from: u64, cap: u64) -> String {
    let Ok(mut f) = std::fs::File::open(path) else { return String::new() };
    if f.seek(SeekFrom::Start(from)).is_err() {
        return String::new();
    }
    let mut buf = Vec::new();
    let _ = f.take(cap).read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

/// 끊긴 턴을 거슬러 볼 앞 기록 크기 — 긴 도구 결과 줄도 넉넉히
const BACK: u64 = 2 * 1024 * 1024;
/// 끊김을 본 뒤 대기열에서 꺼낸 말이 붙기를 잠깐 기다린다(실측 B: 끊김 뒤 1.3초 안에 user 줄)
const SETTLE: Duration = Duration::from_millis(500);

/// 기다린 결과 — via: interrupt·ended·already·timeout, lost = 다시 넣을 사람 말
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub(crate) struct CutWait {
    pub via: &'static str,
    pub ms: u64,
    pub lost: Vec<String>,
}

/// from(Esc 직전 기록 끝) 뒤로 멈춤이 붙기를 max 까지 기다린다
pub(crate) fn wait_at(path: &Path, from: u64, max: Duration, tick: Duration) -> CutWait {
    let started = Instant::now();
    let before = read_range(path, from.saturating_sub(BACK), from - from.saturating_sub(BACK));
    let already = idle_before(&before);
    loop {
        let len = std::fs::metadata(path).map_or(0, |m| m.len());
        let new = if len > from { read_range(path, from, len - from) } else { String::new() };
        let idle = idle_in(&new).or((already && new.lines().filter_map(parse).all(|v| user_text(&v).is_none() && v["type"] != "assistant")).then_some(Idle::Already));
        if let Some(i) = idle {
            let mut lost = vec![];
            if i == Idle::Interrupt {
                std::thread::sleep(SETTLE);
                let len = std::fs::metadata(path).map_or(0, |m| m.len());
                let start = from.saturating_sub(BACK);
                lost = lost_prompts(&read_range(path, start, len - start));
            }
            return CutWait { via: i.name(), ms: started.elapsed().as_millis() as u64, lost };
        }
        if started.elapsed() >= max {
            return CutWait { via: "timeout", ms: started.elapsed().as_millis() as u64, lost: vec![] };
        }
        std::thread::sleep(tick);
    }
}

/// 세션 짧은 번호 → 기록 파일
fn path_of(id: &str) -> Option<PathBuf> {
    if id.len() != 8 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let list = crate::claude::agents_json().ok()?;
    crate::claude::transcript_path(&crate::send_land::session_id_in(&list, id)?)
}

/// Esc 직전에 부른다 — 그 세션 기록의 지금 끝(못 찾으면 None: 채팅은 예전처럼 0.7초 쉬고 친다)
#[tauri::command]
pub async fn cut_mark(id: String) -> Option<u64> {
    tauri::async_runtime::spawn_blocking(move || path_of(&id).and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len())).await.ok().flatten()
}

/// Esc 뒤 멈춤을 기다린다 — 블랙박스 chat-cut 한 줄(글 없이, 다시 넣을 말 개수만)
#[tauri::command]
pub async fn cut_wait(id: String, from: u64, max_ms: u64) -> CutWait {
    let who = id.clone();
    let r = tauri::async_runtime::spawn_blocking(move || match path_of(&id) {
        Some(p) => wait_at(&p, from, Duration::from_millis(max_ms.min(10_000)), Duration::from_millis(100)),
        None => CutWait { via: "no-transcript", ms: 0, lost: vec![] },
    })
    .await
    .unwrap_or(CutWait { via: "error", ms: 0, lost: vec![] });
    crate::claude::log_out("chat-cut", &format!("{who} idle via={} ms={} lost={}", r.via, r.ms, r.lost.len()));
    r
}

#[cfg(test)]
#[path = "cut_wait_tests.rs"]
mod tests;
