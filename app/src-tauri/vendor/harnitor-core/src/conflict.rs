//! 충돌 — 전역이 금지한 것을 프로젝트 지침·스킬이 쓰라고 하나.
//!
//! 전역 CLAUDE.md 는 모든 세션에 실린다. 프로젝트 쪽이 그 금지를 거꾸로 말하면
//! 모델은 매번 둘 중 하나를 어긴다. 실례: 전역 "아이콘 라이브러리 금지(lucide-react)" ↔
//! 프로젝트 스킬 "lucide Plus 아이콘 사용".
//!
//! 낱말 맞추기라 오탐이 섞인다. 그래서 **쓰라는 말이 있는 줄만 Problem**,
//! 이름만 나오는 줄은 Note 로 낮춘다. 금지를 되풀이하는 줄은 동의라 빼고.

use crate::diagnose::{aim, at, d};
use crate::edges::mentions;
use crate::i18n::{pick, Lang};
use crate::md;
use crate::model::*;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// 이 낱말이 든 전역 줄을 금지 줄로 본다.
const BAN: &[&str] = &["금지", "절대", "하지 않는다", "NEVER", "never"];
/// 대상 줄에 이게 있으면 금지에 동의하는 말이다 — 충돌이 아니다.
#[rustfmt::skip]
const NEG: &[&str] = &[
    "금지", "않", "말 것", "말고", "마라", "말라", "없이", "대신", "피한", "피해", "빼",
    "never", "don't", "do not", "avoid", "❌", "✕",
];
/// 대상 줄에 이게 있으면 쓰라는 말이다.
#[rustfmt::skip]
const USE: &[&str] = &[
    "사용", "쓴다", "써라", "쓰기", "쓰고", "써서", "넣", "실행", "돌려", "돌린다", "설치", "추가", "적용",
    "use ", "run ", "import", "install",
];

/// 금지 줄 하나에서 뽑은 금지어.
struct Ban {
    term: String,
    /// 같이 찾을 줄기 — `lucide-react` 면 `lucide`
    stem: Option<String>,
    line: usize,
}

/// 백틱 조각과 따옴표 안 낱말. 한국어만 든 따옴표("저장")는 허용 예시인 경우가 많아 뺀다.
fn terms(line: &str) -> Vec<String> {
    let mut raw: Vec<String> = md::code_spans(line).iter().map(|s| s.to_string()).collect();
    for (open, close) in [('"', '"'), ('“', '”')] {
        let mut rest = line;
        while let Some(i) = rest.find(open) {
            let after = &rest[i + open.len_utf8()..];
            let Some(j) = after.find(close) else { break };
            raw.push(after[..j].to_string());
            rest = &after[j + close.len_utf8()..];
        }
    }
    let mut out: Vec<String> = raw
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| {
            t.chars().count() >= 3
                && t.chars().any(|c| c.is_ascii_alphabetic())
                && !t.contains(['{', '}', '<', '>', '/', '*', '"', '\''])
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

fn stem(term: &str) -> Option<String> {
    let (head, tail) = term.rsplit_once('-')?;
    (["react", "js", "native", "icons", "vue"].contains(&tail) && head.len() >= 4)
        .then(|| head.to_string())
}

/// 한 줄을 절로 자른다. 금지 줄 끝에 "— `x` 스킬" 같은 포인터가 붙는 일이 흔해서,
/// 줄 통째로 낱말을 뽑으면 포인터까지 금지어가 된다(실측: 스킬 이름 13건 오탐).
fn clauses(line: &str) -> Vec<&str> {
    let mut out = vec![line];
    for sep in [" — ", " - ", ". ", "; ", " / ", " → ", " | "] {
        out = out.iter().flat_map(|c| c.split(sep)).collect();
    }
    out
}

/// `(lucide-react 등)` 처럼 백틱 없이 적은 패키지·속성 이름(소문자-소문자).
fn bare_ids(clause: &str) -> Vec<String> {
    clause
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .filter(|w| {
            w.contains('-')
                && !w.starts_with('-')
                && !w.ends_with('-')
                && w.chars().any(|c| c.is_ascii_lowercase())
                && !w.chars().any(|c| c.is_ascii_uppercase())
                && !w.chars().next().is_some_and(|c| c.is_ascii_digit())
        })
        .map(str::to_string)
        .collect()
}

/// 금지 줄의 금지 절에서 금지어를 뽑는다. 하네스에 있는 이름(스킬·MCP)은 가리키는 말이지
/// 금지 대상이 아니라 뺀다.
fn bans(global_md: &str, names: &[String]) -> Vec<Ban> {
    let mut out: Vec<Ban> = vec![];
    for l in md::lines(global_md).iter().filter(|l| !l.in_code) {
        for c in clauses(l.text) {
            if !BAN.iter().any(|b| c.contains(b)) {
                continue;
            }
            let mut ts = terms(c);
            ts.extend(bare_ids(c));
            ts.sort();
            ts.dedup();
            for t in ts {
                if names.iter().any(|n| n.eq_ignore_ascii_case(&t))
                    || out.iter().any(|b| b.term == t)
                {
                    continue;
                }
                out.push(Ban {
                    stem: stem(&t),
                    term: t,
                    line: l.no,
                });
            }
        }
    }
    out
}

/// 이 줄이 금지어를 부르나. 낱말 경계로 보되, 하이픈으로 이어 붙인 확장 이름도 같은 것이다 —
/// `lucide-react` 금지에 `lucide-react-native` 를 쓰는 줄이 실제로 있었다.
fn names_it(line: &str, term: &str) -> bool {
    mentions(line, term) || {
        let mut from = 0;
        let mut hit = false;
        while let Some(i) = line[from..].find(term) {
            let start = from + i;
            let end = start + term.len();
            let before = line[..start].chars().next_back();
            let ok_before = before.is_none_or(|c| !(c.is_alphanumeric() || c == '_' || c == '-'));
            if ok_before && line[end..].starts_with('-') {
                hit = true;
                break;
            }
            from = end;
        }
        hit
    }
}

/// 대상 파일 하나에서 (줄, 금지어, 금지 줄, 쓰라는 말인가).
fn hits(text: &str, bans: &[Ban]) -> Vec<(usize, String, usize, bool)> {
    let mut out = vec![];
    for l in md::lines(text) {
        let low = l.text.to_lowercase();
        if NEG.iter().any(|n| low.contains(&n.to_lowercase())) {
            continue;
        }
        for b in bans {
            let found = [Some(&b.term), b.stem.as_ref()]
                .into_iter()
                .flatten()
                .any(|t| names_it(&low, &t.to_lowercase()));
            if found {
                let uses = USE.iter().any(|u| low.contains(u));
                out.push((l.no, b.term.clone(), b.line, uses));
                break; // 한 줄에 하나면 충분하다
            }
        }
    }
    out
}

fn short(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(r) => format!("~/{}", r.display()),
        Err(_) => path.display().to_string(),
    }
}

pub fn diagnose(scan: &Scan, lang: Lang) -> Vec<Diagnosis> {
    let home = scan.home.as_path();
    let Ok(global) = std::fs::read_to_string(home.join(".claude/CLAUDE.md")) else {
        return vec![];
    };
    let names: Vec<String> = scan
        .global
        .skills
        .iter()
        .chain(scan.projects.iter().flat_map(|p| p.skills.iter()))
        .chain(scan.global.plugins.iter().flat_map(|p| p.skills.iter()))
        .map(|s| s.name.clone())
        .chain(scan.global.mcp.iter().map(|m| m.name.clone()))
        .collect();
    let bans = bans(&global, &names);
    if bans.is_empty() {
        return vec![];
    }

    // (쓰라는 말인가, 주인) → [(근거, 대상)]
    type Found = BTreeMap<(bool, Option<PathBuf>), Vec<(String, String)>>;
    let mut found: Found = BTreeMap::new();
    let mut look = |file: &Path, owner: Option<&Path>, target: &str| {
        let Ok(text) = std::fs::read_to_string(file) else {
            return;
        };
        for (no, term, ban_line, uses) in hits(&text, &bans) {
            found
                .entry((uses, owner.map(Path::to_path_buf)))
                .or_default()
                .push((
                    format!(
                        "{}:{no} `{term}` ↔ ~/.claude/CLAUDE.md:{ban_line}",
                        short(file, home)
                    ),
                    target.to_string(),
                ));
        }
    };
    for s in &scan.global.skills {
        look(&s.path.join("SKILL.md"), None, &s.name);
    }
    for p in &scan.projects {
        for f in [p.path.join("CLAUDE.md"), p.path.join(".claude/CLAUDE.md")] {
            look(&f, Some(&p.path), "CLAUDE.md");
        }
        for s in &p.skills {
            look(&s.path.join("SKILL.md"), Some(&p.path), &s.name);
        }
    }

    found
        .into_iter()
        .map(|((uses, owner), items)| {
            let n = items.len();
            let (ev, names): (Vec<String>, Vec<String>) = items.into_iter().unzip();
            let x = if uses {
                d(Severity::Problem, "conflict.global_ban",
                    pick(lang, &format!("전역이 금지한 것을 쓰라고 하는 줄 {n}건"),
                        &format!("{n} line(s) telling the model to use something the global rules forbid")),
                    pick(lang,
                        "전역 CLAUDE.md 의 금지 줄(↔ 오른쪽)과 거꾸로 말한다 — 충돌 의심. 둘 다 실리면 모델은 매번 하나를 어긴다. 어느 쪽이 맞는지 정해 한쪽을 고친다(프로젝트 예외면 그렇다고 적는다).",
                        "Contradicts a ban in the global CLAUDE.md (right of ↔) — a likely conflict. With both loaded, the model breaks one of them every time. Decide which is right and fix the other (or state the project exception)."),
                    ev)
            } else {
                d(Severity::Note, "conflict.global_ban_mention",
                    pick(lang, &format!("전역이 금지한 이름이 나오는 줄 {n}건"),
                        &format!("{n} line(s) mentioning something the global rules forbid")),
                    pick(lang,
                        "쓰라는 말은 없고 이름만 나온다. 낱말 맞추기라 예시·설명일 수 있다 — 원문을 보고 판단한다.",
                        "The name appears without an instruction to use it. This is word matching, so it may be an example or an explanation — check the source."),
                    ev)
            };
            at(aim(x, names), owner.as_deref())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 금지어를_뽑는다() {
        let t = terms(
            r#"아이콘 라이브러리 금지. `from "lucide-react"` 보이면 · "저장" · `{p}/CLAUDE.md`"#,
        );
        assert_eq!(t, vec!["lucide-react".to_string()]);
        assert_eq!(stem("lucide-react").as_deref(), Some("lucide"));
        assert_eq!(stem("border-left"), None);
        assert_eq!(
            bare_ids("아이콘 라이브러리(lucide-react 등) 금지"),
            vec!["lucide-react"]
        );
        assert_eq!(clauses("a 금지 — `x` 스킬").len(), 2);
        assert!(names_it(
            "`plus` icon (lucide-react-native)",
            "lucide-react"
        ));
        assert!(!names_it("mylucide-react", "lucide-react"));
    }
}
