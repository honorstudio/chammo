//! 늘 실리는 양 — 세션 하나가 시작할 때 무조건 읽는 것.
//!
//! 층: 전역 `~/.claude/CLAUDE.md` → 프로젝트 `CLAUDE.md` · `.claude/CLAUDE.md` · `CLAUDE.local.md`
//! (+ 그것들이 `@경로` 로 가져온 파일) → 메모리 목록 앞 200줄 → 스킬 설명 → 매 지시 훅.
//! 토큰 셈은 스킬 설명과 같은 어림(`estimate_tokens`)이다 — 서로 비교되는 숫자라서.

use crate::model::*;
use crate::{estimate_tokens, md};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Claude Code 가 메모리 목록에서 읽는 줄 수.
const MEMORY_LINES: usize = 200;
/// `@` 가져오기를 따라가는 깊이. Claude Code 의 상한과 같다.
const IMPORT_DEPTH: usize = 5;
/// 이보다 긴 섹션을 "부를 때만 읽혀도 되는 후보"로 짚는다.
const HINT_MIN_TOKENS: usize = 300;
/// `CLAUDE.local.md` 는 읽지 않고 크기로 어림한다. 한글(3바이트·0.9토큰)과
/// 영문(1바이트·0.28토큰)이 둘 다 바이트당 약 0.3토큰이라 섞여도 크게 안 틀린다.
const TOKENS_PER_BYTE: f64 = 0.3;

/// 세션이 늘 읽는 지침 파일 자리 — 낡음·충돌·겹침 진단도 같은 목록을 본다.
/// `CLAUDE.local.md` 는 넣지 않는다(키를 담는 자리라 내용을 읽지 않는다).
pub fn instruction_files(home: &Path, project: Option<&Path>) -> Vec<PathBuf> {
    let mut v = vec![home.join(".claude/CLAUDE.md")];
    if let Some(p) = project {
        v.push(p.join("CLAUDE.md"));
        v.push(p.join(".claude/CLAUDE.md"));
    }
    v.into_iter().filter(|p| p.is_file()).collect()
}

/// 프로젝트 메모리 폴더. Claude Code 는 경로의 `/`·`.` 같은 글자를 `-` 로 바꾼 이름을 쓴다.
pub fn memory_dir(home: &Path, project: &Path) -> PathBuf {
    let enc: String = project
        .display()
        .to_string()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    home.join(".claude/projects").join(enc).join("memory")
}

/// `@경로` 가져오기. 코드 블록·백틱 안은 가져오기가 아니다. 실재하는 파일만 돌려준다 —
/// `@scope/package` 같은 패키지 이름은 파일이 없어서 자연히 빠진다.
pub fn imports(text: &str, base: &Path, home: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    for l in md::lines(text).iter().filter(|l| !l.in_code) {
        let plain = md::strip_code_spans(l.text);
        for tok in plain.split_whitespace() {
            let Some(raw) = tok.strip_prefix('@') else {
                continue;
            };
            let raw = raw.trim_end_matches(['.', ',', ';', ':', ')', ']']);
            if raw.is_empty() || !(raw.contains('/') || raw.contains('.')) {
                continue;
            }
            let p = if let Some(r) = raw.strip_prefix("~/") {
                home.join(r)
            } else if raw.starts_with('/') {
                PathBuf::from(raw)
            } else {
                base.join(raw)
            };
            if p.is_file() && !p.ends_with("CLAUDE.local.md") {
                out.push(p);
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

struct Acc<'a> {
    home: &'a Path,
    parts: Vec<BudgetPart>,
    hints: Vec<BudgetHint>,
    seen: BTreeSet<PathBuf>,
}

impl Acc<'_> {
    /// 지침 파일 하나와 그것이 가져오는 파일들을 담는다.
    fn doc(&mut self, path: &Path, kind: BudgetKind, depth: usize) {
        if depth > IMPORT_DEPTH || !self.seen.insert(path.to_path_buf()) {
            return;
        }
        let Ok(text) = std::fs::read_to_string(path) else {
            return;
        };
        self.parts.push(BudgetPart {
            kind,
            label: short(path, self.home),
            path: Some(path.to_path_buf()),
            tokens: estimate_tokens(&text),
            estimated_from_size: false,
        });
        for s in md::sections(&text) {
            let tokens = estimate_tokens(&s.body);
            if tokens >= HINT_MIN_TOKENS {
                self.hints.push(BudgetHint {
                    path: path.to_path_buf(),
                    line: s.line,
                    heading: s.heading,
                    tokens,
                });
            }
        }
        let base = path.parent().unwrap_or(Path::new("/")).to_path_buf();
        for p in imports(&text, &base, self.home) {
            self.doc(&p, BudgetKind::Import, depth + 1);
        }
    }

    fn skills(&mut self, label: String, skills: &[&Skill]) {
        if skills.is_empty() {
            return;
        }
        self.parts.push(BudgetPart {
            kind: BudgetKind::SkillDescriptions,
            label,
            path: None,
            tokens: skills.iter().map(|s| s.description_tokens).sum(),
            estimated_from_size: false,
        });
    }
}

/// 전역 하나 + 프로젝트마다 하나.
pub fn compute(scan: &Scan, lang: crate::i18n::Lang) -> Vec<Budget> {
    std::iter::once(None)
        .chain(scan.projects.iter().map(Some))
        .map(|p| one(scan, p, lang))
        .collect()
}

fn one(scan: &Scan, project: Option<&Project>, lang: crate::i18n::Lang) -> Budget {
    use crate::i18n::pick;
    let home = scan.home.as_path();
    let mut acc = Acc {
        home,
        parts: vec![],
        hints: vec![],
        seen: BTreeSet::new(),
    };

    for f in instruction_files(home, project.map(|p| p.path.as_path())) {
        acc.doc(&f, BudgetKind::Instructions, 0);
    }
    if let Some(p) = project {
        let local = p.path.join("CLAUDE.local.md");
        if let Ok(meta) = std::fs::metadata(&local) {
            acc.parts.push(BudgetPart {
                kind: BudgetKind::Instructions,
                label: short(&local, home),
                path: Some(local),
                tokens: (meta.len() as f64 * TOKENS_PER_BYTE) as usize,
                estimated_from_size: true,
            });
        }
        let index = memory_dir(home, &p.path).join("MEMORY.md");
        if let Ok(text) = std::fs::read_to_string(&index) {
            let head: String = text
                .lines()
                .take(MEMORY_LINES)
                .map(|l| format!("{l}\n"))
                .collect();
            acc.parts.push(BudgetPart {
                kind: BudgetKind::Memory,
                label: short(&index, home),
                path: Some(index),
                tokens: estimate_tokens(&head),
                estimated_from_size: false,
            });
        }
    }

    // 스킬 설명 — 프로젝트가 같은 이름을 가지면 전역 것은 가려져 안 실린다
    let own: Vec<&Skill> = project
        .map(|p| p.skills.iter().collect())
        .unwrap_or_default();
    let global: Vec<&Skill> = scan
        .global
        .skills
        .iter()
        .filter(|g| !own.iter().any(|o| o.name == g.name))
        .collect();
    acc.skills(
        pick(
            lang,
            &format!("스킬 설명 · 전역 {}개", global.len()),
            &format!("skill descriptions · global {}", global.len()),
        ),
        &global,
    );
    acc.skills(
        pick(
            lang,
            &format!("스킬 설명 · 프로젝트 {}개", own.len()),
            &format!("skill descriptions · project {}", own.len()),
        ),
        &own,
    );
    for pl in scan.global.plugins.iter().filter(|p| p.enabled) {
        let list: Vec<&Skill> = pl.skills.iter().collect();
        acc.skills(
            pick(
                lang,
                &format!("스킬 설명 · 플러그인 {} {}개", pl.name, list.len()),
                &format!("skill descriptions · plugin {} {}", pl.name, list.len()),
            ),
            &list,
        );
    }

    let prompt_hooks: Vec<String> = scan
        .global
        .hooks
        .iter()
        .chain(project.map(|p| p.hooks.iter()).into_iter().flatten())
        .filter(|h| h.event == "UserPromptSubmit")
        .map(|h| h.command.clone())
        .collect();

    let mut parts = acc.parts;
    parts.sort_by(|a, b| b.tokens.cmp(&a.tokens));
    let mut hints = acc.hints;
    hints.sort_by(|a, b| b.tokens.cmp(&a.tokens));
    hints.truncate(5);
    Budget {
        project: project.map(|p| p.path.clone()),
        total_tokens: parts.iter().map(|p| p.tokens).sum(),
        parts,
        prompt_hooks,
        hints,
    }
}
