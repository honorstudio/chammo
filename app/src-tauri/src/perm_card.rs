//! 회사 정책(관리 설정) 아래 권한 창을 사람 카드로(ADR 0023, 2026-11-02 사용자 2차 첫 조각).
//! 바이패스가 막힌 기기에선 앱이 권한 창·붙잡힌 메시지 창을 대신 누르지 않는다 — 세션 화면을 읽어 직접 카드(direct.jsonl, sub "perm")를 띄우고,
//! 사람이 앱 화면·짝지은 폰에서 고르면 **누르기 직전에 화면을 다시 읽어 같은 창인지(지문) 본 뒤** 그 선택지 번호로 간다.
//! 창 읽기·지문은 여기 한 곳(Rust)에만 — 띄울 때와 누를 때 판정이 갈리면 다른 명령을 허락하는 사고가 난다
use crate::direct::Pick;
use serde_json::{json, Value};

pub const PERM_SUB: &str = "perm";
const DOWN: &str = "\x1b[B";
const UP: &str = "\x1b[A";
const ESC: &str = "\x1b";

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Choice {
    Allow,
    Again,
    Deny,
}

/// 화면에서 읽은 권한 창. 번호는 창에 적힌 선택지 번호(1. 2. 3.)
#[derive(Debug, Clone)]
pub struct PermDialog {
    /// 창 구분선 아래부터 마지막 선택지까지(앞뒤 공백 걷고 빈 줄 뺀 것) — 같은 창인지 견주는 열쇠
    pub fp: String,
    pub question: String,
    /// 도구·명령 줄(카드에 보일 것)
    pub what: String,
    pub options: Vec<(u32, String)>,
    pub cursor: u32,
    pub allow: Option<u32>,
    pub again: Option<u32>,
    pub deny: Option<u32>,
}

fn is_rule(l: &str) -> bool {
    l.trim_start().chars().take(4).filter(|c| matches!(c, '─' | '━')).count() == 4
}

/// "  ❯ 2. 글" → (커서인가, 번호, 숫자가 시작하는 칸, 글)
fn opt_line(l: &str) -> Option<(bool, u32, usize, String)> {
    let t = l.trim_start();
    let (cur, rest) = match t.strip_prefix('❯') {
        Some(r) => (true, r.trim_start()),
        None => (false, t),
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    let after = rest[digits.len()..].strip_prefix(". ")?;
    let n = digits.parse().ok()?;
    let col = l.chars().count() - rest.chars().count();
    Some((cur, n, col, after.trim().to_string()))
}

fn has_any(s: &str, words: &[&str]) -> bool {
    words.iter().any(|w| s.contains(w))
}

pub fn perm_dialog(screen: &str) -> Option<PermDialog> {
    let lines: Vec<&str> = screen.lines().collect();
    let cur = lines.iter().rposition(|l| opt_line(l).is_some_and(|o| o.0))?;
    let (_, cursor, col, _) = opt_line(lines[cur])?;
    let is_opt = |l: &str| opt_line(l).is_some_and(|o| o.2 == col);
    let indent = |l: &str| l.chars().count() - l.trim_start().chars().count();
    let is_more = |l: &str| !l.trim().is_empty() && !is_rule(l) && !is_opt(l) && indent(l) > col;
    let (mut top, mut bottom) = (cur, cur);
    while top > 0 && (is_opt(lines[top - 1]) || is_more(lines[top - 1])) {
        top -= 1;
    }
    while top < cur && !is_opt(lines[top]) {
        top += 1;
    }
    while bottom + 1 < lines.len() && (is_opt(lines[bottom + 1]) || is_more(lines[bottom + 1])) {
        bottom += 1;
    }
    let mut options: Vec<(u32, String)> = Vec::new();
    for l in &lines[top..=bottom] {
        match opt_line(l).filter(|o| o.2 == col) {
            Some((_, n, _, t)) => options.push((n, t)),
            None => {
                if let Some(o) = options.last_mut() {
                    o.1 = format!("{} {}", o.1, l.trim());
                }
            }
        }
    }
    let rule = lines[..top].iter().rposition(|l| is_rule(l)).map_or(0, |i| i + 1);
    let q = (rule..top).rev().find(|&i| !lines[i].trim().is_empty()).filter(|&i| lines[i].trim_end().ends_with('?'));
    let question = q.map(|i| lines[i].trim().to_string()).unwrap_or_default();
    // 명령 블록 위아래 ╌ 점선(2.1.316)은 글이 아니다
    let line_only = |l: &str| l.chars().all(|c| matches!(c, '╌' | '┄' | '┈' | '─' | '━' | '═' | '-'));
    let what: String = lines[rule..q.unwrap_or(top)].iter().map(|l| l.trim()).filter(|l| !l.is_empty() && !line_only(l)).collect::<Vec<_>>().join(" / ").chars().take(300).collect();
    let fp = lines[rule..=bottom].iter().map(|l| l.trim().trim_start_matches('❯').trim()).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n");
    let low = |t: &str| t.to_lowercase();
    let deny_word = |t: &str| low(t).starts_with("no") || has_any(&low(t), &["deny", "reject", "don't allow", "do not allow"]);
    let allow = options.iter().find(|(_, t)| has_any(&low(t), &["yes", "allow", "approve", "deliver", "continue"]) && !deny_word(t) && !has_any(&low(t), &["always", "don't ask", "this session"])).map(|o| o.0);
    let again = options.iter().find(|(n, t)| Some(*n) != allow && !deny_word(t) && has_any(&low(t), &["always allow", "don't ask again", "during this session", "for this session"])).map(|o| o.0);
    let deny = options.iter().find(|(_, t)| deny_word(t)).map(|o| o.0);
    Some(PermDialog { fp, question, what, options, cursor, allow, again, deny })
}

/// 고른 것을 누를 키 — 커서에서 그 번호까지 화살표 + Enter. 거절 줄이 없으면 Esc(창 닫기 = 거절). 없는 선택지면 빈 글
pub fn keys_for(d: &PermDialog, c: Choice) -> String {
    let target = match c {
        Choice::Allow => d.allow,
        Choice::Again => d.again,
        Choice::Deny => d.deny,
    };
    let Some(t) = target else {
        return if c == Choice::Deny { ESC.into() } else { String::new() };
    };
    let idx = |n: u32| d.options.iter().position(|o| o.0 == n).unwrap_or(0) as i64;
    let diff = idx(t) - idx(d.cursor);
    let arrow = if diff > 0 { DOWN } else { UP };
    format!("{}\r", arrow.repeat(diff.unsigned_abs() as usize))
}

/// 누르기 직전 확인 — 지금 화면이 카드를 띄운 그 창(같은 지문)일 때만 키를 준다
pub fn keys_if_same(screen: &str, fp: &str, c: Choice) -> Result<String, String> {
    let d = perm_dialog(screen).filter(|d| d.fp == fp).ok_or_else(|| crate::i18n::tr("권한 창이 바뀌어서 카드를 닫았어요", "The prompt changed, so the card closed").to_string())?;
    let k = keys_for(&d, c);
    if k.is_empty() {
        return Err(crate::i18n::tr("이 창엔 없는 선택이에요", "That option isn't on this prompt").into());
    }
    Ok(k)
}

/// 카드 단추 → 고른 것. 회사 정책으로 사람이 확인하는 창이라 이 앱 화면과 짝지은 폰만(텔레그램·다른 기기·참모는 못 누른다), 글 답은 없다
pub fn choice_of(pick: &Pick, by: &str) -> Result<Choice, String> {
    if by != "desktop" && by != "phone" {
        return Err(crate::i18n::tr("이 앱이나 연결된 폰에서만 답할 수 있어요", "Only this app or your paired phone can answer").into());
    }
    match pick {
        Pick::Yes => Ok(Choice::Allow),
        Pick::No => Ok(Choice::Deny),
        Pick::Option { option: 0 } => Ok(Choice::Again),
        _ => Err(crate::i18n::tr("지원하지 않는 답이에요", "That answer isn't supported").into()),
    }
}

pub fn card_row(id: &str, sid: &str, cwd: &str, d: &PermDialog, ts: &str) -> Value {
    let again_label = d.again.and_then(|n| d.options.iter().find(|o| o.0 == n)).map(|o| {
        if o.1.to_lowercase().contains("session") {
            crate::i18n::tr("이 세션 동안 허용", "Allow for this session")
        } else {
            crate::i18n::tr("다시 묻지 않기", "Don't ask again")
        }
    });
    let what = if d.what.is_empty() { d.question.clone() } else { d.what.clone() };
    json!({
        "ts": ts, "type": "ask", "id": id, "from": sid, "cwd": cwd, "kind": "other", "sub": PERM_SUB,
        "q": what, "detail": d.question,
        "what": crate::i18n::tr("권한 요청 — 회사 정책상 직접 정해요", "Permission request — your call, per company policy"),
        "yes": crate::i18n::tr("허용", "Allow"), "no": crate::i18n::tr("거절", "Deny"),
        "options": again_label.into_iter().collect::<Vec<_>>(), "fp": d.fp,
    })
}

fn rows(log: &str) -> Vec<Value> {
    log.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
}

/// 그 세션의 아직 열린(답·닫힘 없는) perm 카드 id
pub fn open_ids(log: &str, sid: &str) -> Vec<String> {
    let rs = rows(log);
    rs.iter()
        .filter(|r| r["type"] == "ask" && r["sub"] == PERM_SUB && r["from"] == sid)
        .filter_map(|r| r["id"].as_str())
        .filter(|id| !rs.iter().any(|x| x["id"] == *id && matches!(x["type"].as_str(), Some("answer" | "done" | "cancel"))))
        .map(String::from)
        .collect()
}

/// 같은 창으로 이미 띄운 열린 카드 — 있으면 새로 안 만든다
pub fn open_card(log: &str, sid: &str, fp: &str) -> Option<String> {
    let open = open_ids(log, sid);
    rows(log).into_iter().filter(|r| r["type"] == "ask" && r["fp"] == fp).filter_map(|r| r["id"].as_str().map(String::from)).filter(|id| open.contains(id)).last()
}

#[cfg(test)]
#[path = "perm_card_tests.rs"]
mod tests;
