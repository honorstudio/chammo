//! 겹침 — 같은 사실이 두 칸에 있나.
//!
//! 같은 말이 두 자리에 있으면 언젠가 하나만 고쳐져 서로 부딪힌다 — **한 사실은 한 자리.**
//! 늘 읽히는 칸끼리면 토큰도 두 번 낸다. 세 갈래를 본다:
//! CLAUDE.md 층끼리 · CLAUDE.md ↔ 메모리 파일 · 전역 ↔ 프로젝트 같은 이름 스킬.
//!
//! 비교는 줄 단위로, 공백·기호를 지운 뒤 글자 쌍(bigram)이 80% 넘게 같으면 겹침이다.

use crate::diagnose::{aim, at, d};
use crate::i18n::{pick, Lang};
use crate::model::*;
use crate::{budget, md};
use std::path::{Path, PathBuf};

/// 이보다 짧은 줄은 비교하지 않는다 — 제목·"짧은 줄"·목록 머리는 우연히 같다.
const MIN_CHARS: usize = 20;
const SIMILAR: f64 = 0.8;

/// 비교할 한 줄: (줄 번호, 정규화한 글자 수, 글자 쌍).
/// **줄 내용은 담지 않는다** — 메모리·지침엔 키가 평문으로 있어서, 미리보기를 근거에 실었더니
/// 키 앞부분이 그대로 찍혔다(원칙 2). 사람은 줄 번호를 따라가 본다.
struct Norm {
    no: usize,
    chars: usize,
    pairs: Vec<(char, char)>,
}

fn normalize(text: &str) -> Vec<Norm> {
    md::lines(text)
        .iter()
        .filter(|l| !l.in_code)
        .filter_map(|l| {
            let n: Vec<char> = l
                .text
                .chars()
                .filter(|c| c.is_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect();
            if n.len() < MIN_CHARS {
                return None;
            }
            let mut pairs: Vec<(char, char)> = n.windows(2).map(|w| (w[0], w[1])).collect();
            pairs.sort_unstable();
            Some(Norm {
                no: l.no,
                chars: n.len(),
                pairs,
            })
        })
        .collect()
}

/// 글자 쌍 다이스 계수. 둘 다 정렬돼 있어 한 번 훑으면 된다.
fn dice(a: &Norm, b: &Norm) -> f64 {
    let (short, long) = (a.chars.min(b.chars), a.chars.max(b.chars));
    // 길이가 너무 다르면 80% 를 넘을 수 없다 — 셈을 아낀다
    if (short as f64) < (long as f64) * 0.6 {
        return 0.0;
    }
    let (mut i, mut j, mut common) = (0, 0, 0);
    while i < a.pairs.len() && j < b.pairs.len() {
        match a.pairs[i].cmp(&b.pairs[j]) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                common += 1;
                i += 1;
                j += 1;
            }
        }
    }
    2.0 * common as f64 / (a.pairs.len() + b.pairs.len()).max(1) as f64
}

fn short(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(r) => format!("~/{}", r.display()),
        Err(_) => path.display().to_string(),
    }
}

/// 두 파일에서 겹치는 줄을 근거 문장으로.
fn pairs(a: &Path, b: &Path, home: &Path) -> Vec<String> {
    let (Ok(ta), Ok(tb)) = (std::fs::read_to_string(a), std::fs::read_to_string(b)) else {
        return vec![];
    };
    let (na, nb) = (normalize(&ta), normalize(&tb));
    let mut out = vec![];
    for x in &na {
        if let Some(y) = nb.iter().find(|y| dice(x, y) >= SIMILAR) {
            out.push(format!(
                "{}:{} ↔ {}:{}",
                short(a, home),
                x.no,
                short(b, home),
                y.no
            ));
        }
    }
    out
}

/// 그 스킬을 일부러 복사해 맞추는 스크립트가 프로젝트에 있나.
fn synced(project: &Path, skill: &str) -> bool {
    ["scripts", "bin", ".claude/hooks", ".claude/scripts"]
        .iter()
        .flat_map(|d| {
            walkdir::WalkDir::new(project.join(d))
                .max_depth(2)
                .into_iter()
                .flatten()
        })
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .any(|t| {
            crate::edges::mentions(&t, skill)
                && ["rsync", "cp -", "sync", "copy"]
                    .iter()
                    .any(|k| t.contains(k))
        })
}

pub fn diagnose(scan: &Scan, lang: Lang) -> Vec<Diagnosis> {
    let home = scan.home.as_path();
    let mut out = vec![];
    let global_md = budget::instruction_files(home, None);

    for p in &scan.projects {
        let own: Vec<PathBuf> = [p.path.join("CLAUDE.md"), p.path.join(".claude/CLAUDE.md")]
            .into_iter()
            .filter(|f| f.is_file())
            .collect();
        let docs: Vec<&PathBuf> = global_md.iter().chain(own.iter()).collect();

        // ① CLAUDE.md 층끼리 — 전역↔프로젝트, 프로젝트 두 자리끼리
        let mut ev = vec![];
        for (i, a) in docs.iter().enumerate() {
            for b in docs.iter().skip(i + 1) {
                if global_md.contains(a) && global_md.contains(b) {
                    continue;
                }
                ev.extend(pairs(a, b, home));
            }
        }
        if !ev.is_empty() {
            let n = ev.len();
            out.push(at(aim(d(Severity::Cost, "dup.instructions",
                pick(lang, &format!("늘 읽히는 지침 두 곳에 같은 줄 {n}건"),
                    &format!("{n} line(s) repeated across always-loaded instructions")),
                pick(lang,
                    "같은 규칙이 두 층에 있다. 매 세션 두 번 실리고, 언젠가 하나만 고쳐져 서로 부딪힌다. 모든 프로젝트에 필요하면 전역에, 아니면 프로젝트에 — 한 자리만 남긴다.",
                    "The same rule lives in two layers. It is loaded twice every session and one copy will eventually drift. Keep it in one place: global if every project needs it, otherwise the project."),
                ev), ["CLAUDE.md".to_string()]), Some(&p.path)));
        }

        // ② CLAUDE.md ↔ 메모리 파일
        let mem = budget::memory_dir(home, &p.path);
        let mut ev = vec![];
        let mut files: Vec<PathBuf> = std::fs::read_dir(&mem)
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .filter(|x| x.extension().is_some_and(|e| e == "md"))
                    .collect()
            })
            .unwrap_or_default();
        files.sort();
        let mut names = vec![];
        for m in &files {
            for doc in &docs {
                let found = pairs(m, doc, home);
                if !found.is_empty() {
                    names.extend(m.file_stem().map(|s| s.to_string_lossy().into_owned()));
                }
                ev.extend(found);
            }
        }
        if !ev.is_empty() {
            let n = ev.len();
            out.push(at(aim(d(Severity::Cost, "dup.memory",
                pick(lang, &format!("메모리와 지침에 같은 줄 {n}건"),
                    &format!("{n} memory line(s) repeating the instructions")),
                pick(lang,
                    "규칙으로 굳은 것이 메모리에도 남아 있다. CLAUDE.md 에 있으면 메모리 쪽은 지운다 — 둘이 갈라지면 어느 쪽이 맞는지 모른다.",
                    "A rule that made it into CLAUDE.md is still in memory too. Delete the memory copy — once they drift apart nobody knows which one is right."),
                ev), names), Some(&p.path)));
        }

        // ③ 전역 ↔ 프로젝트 같은 이름 스킬
        let (mut copied, mut clash) = (vec![], vec![]);
        for s in &p.skills {
            let Some(g) = scan.global.skills.iter().find(|g| g.name == s.name) else {
                continue;
            };
            let read =
                |x: &Skill| std::fs::read_to_string(x.path.join("SKILL.md")).unwrap_or_default();
            let same = read(g) == read(s);
            let line = pick(
                lang,
                &format!(
                    "{} — 전역 ↔ 프로젝트, 내용 {}",
                    s.name,
                    if same { "같음" } else { "다름" }
                ),
                &format!(
                    "{} — global ↔ project, content {}",
                    s.name,
                    if same { "identical" } else { "differs" }
                ),
            );
            if synced(&p.path, &s.name) {
                copied.push((line, s.name.clone()));
            } else {
                clash.push((line, s.name.clone()));
            }
        }
        if !clash.is_empty() {
            let n = clash.len();
            let (ev, names): (Vec<_>, Vec<_>) = clash.into_iter().unzip();
            out.push(at(aim(d(Severity::Cost, "dup.skill",
                pick(lang, &format!("전역과 같은 이름의 프로젝트 스킬 {n}개"),
                    &format!("{n} project skill(s) shadowing a global skill of the same name")),
                pick(lang,
                    "이 프로젝트에선 프로젝트 것이 전역 것을 가린다. 일부러 고친 사본이 아니면 한쪽을 지운다. 일부러 복사해 맞추는 거라면 동기화 스크립트를 두면 옅게 표시된다.",
                    "In this project the project copy hides the global one. Unless it is a deliberate variant, remove one. If you copy it on purpose, a sync script turns this into a note."),
                ev), names), Some(&p.path)));
        }
        if !copied.is_empty() {
            let n = copied.len();
            let (ev, names): (Vec<_>, Vec<_>) = copied.into_iter().unzip();
            out.push(at(aim(d(Severity::Note, "dup.skill_synced",
                pick(lang, &format!("동기화 스크립트로 맞추는 스킬 사본 {n}개"),
                    &format!("{n} skill copy(ies) kept in sync by a script")),
                pick(lang,
                    "일부러 복사한 사본이다. 원본을 고친 뒤 스크립트를 돌려야 맞는다.",
                    "A deliberate copy. Edit the original, then run the script to keep them equal."),
                ev), names), Some(&p.path)));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 공백과_기호는_무시한다() {
        let a = &normalize("- **커밋은 한 가지 이유로 되돌릴 수 있는 단위로 쪼갠다**")[0];
        let b = &normalize("커밋은 한가지 이유로 되돌릴 수 있는 단위로 쪼갠다!")[0];
        assert!(dice(a, b) > 0.99);
    }
}
