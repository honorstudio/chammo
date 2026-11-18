//! 키즈 배선(1단계 둘째 조각) — 아이 세션 자리·켜기/끄기, 아이 세션 답을 기록으로 옮기기, 보호자 화면용 기록 읽기.
//! - session.json = { id(짧은 번호), at, file(기록 파일, 찾으면 기억), off(어디까지 옮겼나) }
//! - 짧은 번호(8자리)는 기록 파일 이름(sessionId) 앞부분과 같다 — ~/.claude/projects/*/<번호>*.jsonl 로 찾는다(11-17 --bg 실측)
//! - 답 옮기기는 assistant 글만(도구 호출·아이 말은 아님 — 아이 말은 kids_say 가 이미 적는다). 줄 끝이 없는 마지막 줄은 다음 차례에
use crate::kids;
use serde::{Deserialize, Serialize};
use std::io::{Read as _, Seek as _};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default)]
pub struct Sess {
    pub id: String,
    pub at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    pub off: u64,
}

/// 세션 번호 모양 — 기록 파일 찾기에 쓰니 경로 글자가 섞이면 안 된다
fn id_ok(id: &str) -> bool {
    id.len() >= 6 && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

pub fn read_session(k: &Path) -> Option<Sess> {
    let s: Sess = serde_json::from_str(&std::fs::read_to_string(k.join("session.json")).ok()?).ok()?;
    id_ok(&s.id).then_some(s)
}

pub fn write_session(k: &Path, s: &Sess) -> Result<(), String> {
    let f = k.join("session.json");
    let tmp = k.join(format!("session.json.{}", crate::tools::tmp_tag()));
    std::fs::write(&tmp, serde_json::to_string(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())
}

/// `2026-11-17T12:00:01.000Z` → ms(UTC). 모양이 다르면 None
pub fn iso_ms(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[10] != b'T' {
        return None;
    }
    let n = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (n(0, 4)?, n(5, 7)?, n(8, 10)?, n(11, 13)?, n(14, 16)?, n(17, 19)?);
    let ms = if b.get(19) == Some(&b'.') { s.get(20..23).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0) } else { 0 };
    // 날짜 → 1970 부터 날 수(그레고리력)
    let (y2, m2) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let t = ((days * 24 + h) * 60 + mi) * 60 + se;
    u64::try_from(t * 1000 + ms).ok()
}

/// 기록 파일에서 off 뒤의 새 답(assistant 글)을 아이 기록으로 옮긴다. 새 off 를 돌려준다(파일이 off 보다 짧아졌으면 처음부터)
pub fn sync_replies_from(k: &Path, jsonl: &Path, off: u64) -> Result<u64, String> {
    sync_replies_with(k, jsonl, off, &mut |_| {})
}

/// sync_replies_from + 만들기 표시 — 표시는 기록·소리에서 빼고 on_order 로(한 답은 한 번만 지나간다 — 오프셋)
/// 아이 세션 첫 지시 — 이 말에 대한 답은 아이 말의 대답이 아니다(ready 로 적는다)
pub const READY: &str = "준비됐어. 아이가 말하면 시작해.";

/// 준비 지시 뒤 아이 말 전 — 옮기기를 나눠 해도 이어지게 파일로 둔다
fn ready_flag(k: &Path) -> PathBuf {
    k.join(".claude").join("ready-pending")
}

fn user_text(v: &serde_json::Value) -> String {
    match &v["message"]["content"] {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(a) => a.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n"),
        _ => String::new(),
    }
}

pub fn sync_replies_with(k: &Path, jsonl: &Path, off: u64, on_order: &mut dyn FnMut(crate::kids_make::Order)) -> Result<u64, String> {
    let mut f = std::fs::File::open(jsonl).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    let start = if off > len { 0 } else { off };
    f.seek(std::io::SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let Some(end) = buf.iter().rposition(|&c| c == b'\n') else { return Ok(start) };
    for l in String::from_utf8_lossy(&buf[..=end]).lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(l) else { continue };
        if v["type"] == "user" {
            // 준비 지시면 표시, 다른 말(아이 말 등)이면 표시를 지운다 — 도구 결과처럼 글 없는 줄은 그대로
            let t = user_text(&v);
            if t.contains(READY) {
                let _ = std::fs::write(ready_flag(k), "1");
            } else if !t.trim().is_empty() {
                let _ = std::fs::remove_file(ready_flag(k));
            }
            continue;
        }
        if v["type"] != "assistant" {
            continue;
        }
        let text = v["message"]["content"].as_array().into_iter().flatten().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n");
        if text.trim().is_empty() {
            continue;
        }
        let ts = v["timestamp"].as_str().and_then(iso_ms).unwrap_or_else(crate::notes::now_ms);
        if ready_flag(k).exists() {
            kids::log_line(k, ts, "ready", text.trim(), None)?; // 준비 답 — 아이에게 안 읽고, 화면에도 안 띄운다(만들기 표시도 안 따른다)
            continue;
        }
        let (said, orders) = crate::kids_make::parse_orders(text.trim());
        let said = crate::kids_voice::strip_meta(&said); // 이름표·제3자 해설은 아이에게 안 간다(11-18 실사용)
        if !said.is_empty() {
            kids::log_line(k, ts, "assistant", &said, None)?;
        }
        orders.into_iter().for_each(&mut *on_order);
    }
    Ok(start + end as u64 + 1)
}

/// ~/.claude/projects/*/<짧은 번호>*.jsonl
pub fn find_transcript(projects: &Path, short: &str) -> Option<PathBuf> {
    if !id_ok(short) {
        return None;
    }
    for d in std::fs::read_dir(projects).ok()?.flatten() {
        for f in std::fs::read_dir(d.path()).into_iter().flatten().flatten() {
            let name = f.file_name().to_string_lossy().into_owned();
            if name.starts_with(short) && name.ends_with(".jsonl") {
                return Some(f.path());
            }
        }
    }
    None
}

/// `claude agents --json` 에 그 번호가 살아 있나(꺼진·실패한 건 아님)
pub fn alive_in(agents_json: &str, id: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(agents_json)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .into_iter()
        .flatten()
        .any(|a| a["id"] == id && !matches!(a["state"].as_str(), Some("stopped" | "failed" | "exited")))
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Row {
    pub ts: u64,
    pub who: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cid: Option<String>,
}

/// 최근 days 날 치 기록(시간순), 많으면 마지막 cap 줄만
pub fn recent_log(k: &Path, now: u64, days: u64, cap: usize) -> Vec<Row> {
    let mut out: Vec<Row> = vec![];
    for back in (0..days).rev() {
        let day = now.saturating_sub(back * 86_400_000);
        let f = k.join("log").join(format!("{}.jsonl", kids::ymd_of(day)));
        for l in std::fs::read_to_string(f).unwrap_or_default().lines() {
            if let Ok(r) = serde_json::from_str::<Row>(l) {
                out.push(r);
            }
        }
    }
    out.sort_by_key(|r| r.ts);
    let skip = out.len().saturating_sub(cap);
    out.split_off(skip)
}

// ───────── 앱 쪽 ─────────

fn projects() -> PathBuf {
    crate::tools::cfg().dir.join("projects")
}

/// 그 번호의 아이 세션이 떠 있나
pub(crate) fn alive(id: &str) -> bool {
    crate::claude::agents_json().is_ok_and(|j| alive_in(&j, id))
}

/// 아이 세션을 새로 띄운다 — 집 믿음 → claude --bg(막힘 인자). 돌려주는 건 짧은 번호
pub(crate) fn start(k: &Path, key: &str) -> Result<String, String> {
    let cwd = k.to_string_lossy().into_owned();
    crate::trust::trust_own(&cwd);
    let out = crate::claude::spawn_plain(&cwd, &kids::kid_spawn_args(k, key, READY, Some(kids::KID_MODEL)))?;
    let id = kids::bg_id(&out).ok_or_else(|| format!("세션 번호를 못 읽음: {out}"))?;
    write_session(k, &Sess { id: id.clone(), at: crate::notes::now_ms(), file: None, off: 0 })?;
    kids::log_line(k, crate::notes::now_ms(), "app", "아이 세션 켬", None)?;
    let key = key.to_string();
    std::thread::spawn(move || crate::kids_make::sync_chars(&key)); // 선생님 보관함 '캐릭터/' → chars/
    Ok(id)
}

/// 떠 있으면 그 번호, 아니면 새로 띄운다(앱이 다시 켜졌거나 사람이 껐을 때)
pub(crate) fn ensure(k: &Path, key: &str) -> Result<String, String> {
    match read_session(k) {
        Some(s) if alive(&s.id) => Ok(s.id),
        _ => start(k, key),
    }
}

/// 아이 세션 끄기(키즈 참모를 끌 때) — 집·기록·작품은 그대로
pub(crate) fn stop(k: &Path) {
    if let Some(s) = read_session(k) {
        let _ = crate::platform::command(crate::claude::claude_bin()).args(["stop", &s.id]).output();
        let _ = kids::log_line(k, crate::notes::now_ms(), "app", "아이 세션 끔", None);
    }
}

/// 아이 세션 기록에서 새 답을 옮긴다 — 기록 파일은 처음 한 번 찾아 기억한다
pub(crate) fn sync(k: &Path) {
    let Some(mut s) = read_session(k) else { return };
    let file = s.file.clone().map(PathBuf::from).filter(|p| p.exists()).or_else(|| find_transcript(&projects(), &s.id));
    let Some(file) = file else { return };
    let key = k.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if let Ok(off) = sync_replies_with(k, &file, s.off, &mut |o| crate::kids_make::order(&key, o)) {
        let changed = off != s.off || s.file.as_deref() != Some(&*file.to_string_lossy());
        s.off = off;
        s.file = Some(file.to_string_lossy().into_owned());
        if changed {
            let _ = write_session(k, &s);
        }
    }
}

#[cfg(test)]
#[path = "kids_wire_tests.rs"]
mod tests;
