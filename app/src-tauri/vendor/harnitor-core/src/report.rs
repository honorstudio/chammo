//! 글 보고 — 에이전트(오케스트레이터)가 읽고 바로 움직이는 하네스 요약.
//!
//! 순서가 곧 우선순위다: 맨 위에 늘 실리는 양 한 줄, 그다음 Problem → Cost → Note.
//! 진단마다 근거는 다섯까지, 그리고 **고치는 길** 한 줄. 사람이 읽는 화면과 같은 판정을 쓴다.

use crate::i18n::{pick, Lang};
use crate::model::*;
use std::fmt::Write;
use std::path::Path;

const EVIDENCE: usize = 5;

fn fix_line(lang: Lang, f: FixPath) -> String {
    match f {
        FixPath::Toggle => pick(lang, "하니터 토글로 된다", "a Harnitor toggle does it"),
        FixPath::EditFile => pick(lang, "파일을 고친다", "edit the file"),
        FixPath::Ask => pick(lang, "사람에게 묻는다", "ask the user"),
        FixPath::None => pick(
            lang,
            "고칠 것 없음 — 알아둘 상태",
            "nothing to fix — a state to know",
        ),
    }
}

fn thousands(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// `project` 가 `None` 이면 전역만(프로젝트 지침이 없는 폴더에서 연 세션).
pub fn harness_text(scan: &Scan, project: Option<&Path>, lang: Lang) -> String {
    let mut t = String::new();
    let where_ = project
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| pick(lang, "전역만", "global only"));

    // ── 늘 실리는 양
    if let Some(b) = scan
        .budgets
        .iter()
        .find(|b| b.project.as_deref() == project)
    {
        let top: Vec<String> = b
            .parts
            .iter()
            .take(3)
            .map(|p| format!("{} {}", p.label, thousands(p.tokens)))
            .collect();
        let _ = writeln!(
            t,
            "{} · {where_} · {} {} — {}{}",
            pick(lang, "늘 실리는 양", "Always loaded"),
            pick(lang, "약", "~"),
            pick(
                lang,
                &format!("{}토큰", thousands(b.total_tokens)),
                &format!("{} tokens", thousands(b.total_tokens))
            ),
            top.join(" · "),
            if b.prompt_hooks.is_empty() {
                String::new()
            } else {
                pick(
                    lang,
                    &format!(" · 매 지시 훅 {}개", b.prompt_hooks.len()),
                    &format!(" · {} per-prompt hook(s)", b.prompt_hooks.len()),
                )
            }
        );
        for h in b.hints.iter().take(3) {
            let file = h
                .path
                .strip_prefix(&scan.home)
                .map(|r| format!("~/{}", r.display()))
                .unwrap_or_else(|_| h.path.display().to_string());
            let _ = writeln!(
                t,
                "  {} {file}:{} \"{}\" ({})",
                pick(lang, "부를 때만 읽혀도 되는 후보:", "could load on demand:"),
                h.line,
                h.heading,
                pick(
                    lang,
                    &format!("{}토큰", thousands(h.tokens)),
                    &format!("{} tokens", thousands(h.tokens))
                )
            );
        }
    }
    if let Some(day) = &scan.usage_since {
        let _ = writeln!(
            t,
            "{}",
            pick(
                lang,
                &format!("기록 기간: {day}부터"),
                &format!("Usage recorded since {day}")
            )
        );
    }

    // ── 진단 — 이미 Problem → Cost → Note 로 정렬돼 있다
    let mine = scan
        .diagnoses
        .iter()
        .filter(|d| d.project.is_none() || d.project.as_deref() == project);
    let mut n = 0;
    for d in mine {
        n += 1;
        let label = match d.severity {
            Severity::Problem => pick(lang, "문제", "problem"),
            Severity::Cost => pick(lang, "비용", "cost"),
            Severity::Note => pick(lang, "상태", "note"),
        };
        let _ = writeln!(t, "\n[{label}] {}  ({})", d.title, d.rule);
        for e in d.evidence.iter().take(EVIDENCE) {
            let _ = writeln!(t, "  · {e}");
        }
        if d.evidence.len() > EVIDENCE {
            let more = d.evidence.len() - EVIDENCE;
            let _ = writeln!(
                t,
                "  · {}",
                pick(
                    lang,
                    &format!("… 외 {more}건"),
                    &format!("… and {more} more")
                )
            );
        }
        let _ = writeln!(
            t,
            "  {} {}",
            pick(lang, "고치는 길:", "fix:"),
            fix_line(lang, d.fix)
        );
    }
    if n == 0 {
        let _ = writeln!(t, "\n{}", pick(lang, "걸린 것 없음.", "Nothing caught."));
    }
    t
}
