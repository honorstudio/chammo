//! 낡음 — 지침·스킬이 가리키는 경로가 지금도 있나.
//!
//! 늘 읽히는 칸(CLAUDE.md)이 없는 파일을 가리키면 **매 순간 틀린 길을 안내한다.**
//! 스킬 본문은 부를 때만 해롭다. 그래서 같은 사실도 자리에 따라 무게가 다르다.
//!
//! 오탐이 제일 무섭다(원칙 4의 교훈). 그래서 **경로라고 주장하는 것만** 본다:
//! 백틱 안, 공백 없음, 자리표시자·글롭 없음, 그리고 기준을 확정할 수 있는 것.

use crate::diagnose::{aim, at, d};
use crate::i18n::{pick, Lang};
use crate::model::*;
use crate::{budget, md};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// 프로젝트 루트 기준으로 읽어도 되는 첫 마디. 이게 아니면 확장자가 있어야 경로로 본다.
#[rustfmt::skip]
const ROOTS: &[&str] = &[
    "src", "app", "docs", "scripts", "lib", "components", "crates", "packages", "supabase", "tests", "test", "references", "templates", ".claude", "public", "assets", "hooks",
];
/// 전역 스킬이 자기 폴더 안을 가리킬 때 쓰는 첫 마디.
#[rustfmt::skip]
const SKILL_OWN: &[&str] = &[
    "references", "scripts", "templates", "assets", "examples", "agents",
];
/// 꼬리 찾기에서 내려가지 않는 폴더 — 크고, 사람이 가리킬 리 없다.
#[rustfmt::skip]
const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "build", "dist", ".next", "Pods", ".expo", ".turbo", "coverage", "vendor", ".gradle", "DerivedData",
];

/// 예시로 쓰는 낱말 — 경로 자리에 이게 있으면 실제 경로가 아니라 틀이다.
const PLACEHOLDERS: &[&str] = &["YYYY", "MM-DD", "xxx", "XXX", "foo", "example"];

/// 백틱 조각에서 경로 후보를 다듬는다. 경로가 아니면 `None`.
fn candidate(span: &str) -> Option<&str> {
    if span
        .chars()
        .any(|c| c.is_whitespace() || "<>{}*$?[]|\"'`".contains(c))
        || span.contains("://")
        || span.contains("...")
        || span.contains('…')
        || span.starts_with('-')
        || span.starts_with('@')
        || span.get(1..).is_some_and(|rest| rest.contains('~'))
        || span.matches('(').count() != span.matches(')').count()
        || span.contains("(-")
        || PLACEHOLDERS.iter().any(|p| span.contains(p))
        // 돌려야 생기는 산출물 — 없는 게 정상이다(실측: 워커 로그·빌드 단계의 node_modules)
        || span.ends_with(".log")
        || span.contains("node_modules")
    {
        return None;
    }
    // `a.rs:12` · `a.rs:26,93` · `a.md#제목` · 문장 부호 꼬리는 경로가 아니다
    let s = span.split('#').next().unwrap_or(span);
    let s = match s.rsplit_once(':') {
        Some((head, tail))
            if tail
                .chars()
                .all(|c| c.is_ascii_digit() || c == '-' || c == ',') =>
        {
            head
        }
        _ => s,
    };
    let s = s.trim_end_matches(['.', ',', ';', ':']);
    // 한 마디짜리 폴더(`references/`)는 특정 자리가 아니라 개념을 말한다
    let one_dir = s.ends_with('/') && s.trim_end_matches('/').matches('/').count() == 0;
    (s.contains('/') && s.len() > 2 && !one_dir).then_some(s)
}

/// `docs/decisions/0001` 처럼 파일 이름 앞부분만 적은 것 — 같은 폴더에 그걸로 시작하는 게 있으면 산 것이다.
fn exists_or_prefix(p: &Path) -> bool {
    if p.exists() {
        return true;
    }
    let (Some(dir), Some(stem)) = (p.parent(), p.file_name().and_then(|n| n.to_str())) else {
        return false;
    };
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .any(|e| e.file_name().to_string_lossy().starts_with(stem))
        })
        .unwrap_or(false)
}

fn has_ext(s: &str) -> bool {
    let last = s.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    match last.rsplit_once('.') {
        Some((stem, ext)) => {
            !stem.is_empty()
                && (1..=5).contains(&ext.len())
                && ext.chars().all(|c| c.is_ascii_alphanumeric())
        }
        None => false,
    }
}

fn first_seg(s: &str) -> &str {
    s.trim_start_matches("./").split('/').next().unwrap_or("")
}

/// 프로젝트 안 파일·폴더의 상대 경로 목록. 꼬리 찾기용이라 처음 물을 때 한 번만 짓는다.
struct Index {
    root: PathBuf,
    paths: Option<Vec<String>>,
}

impl Index {
    fn has_tail(&mut self, rel: &str) -> bool {
        let root = &self.root;
        let paths = self.paths.get_or_insert_with(|| {
            walkdir::WalkDir::new(root)
                .max_depth(8)
                .follow_links(false)
                .into_iter()
                .filter_entry(|e| !SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
                .flatten()
                .take(50_000)
                .filter_map(|e| {
                    e.path()
                        .strip_prefix(root)
                        .ok()
                        .map(|r| r.to_string_lossy().into_owned())
                })
                .collect()
        });
        let rel = rel.trim_start_matches("./").trim_end_matches('/');
        let tail = format!("/{rel}");
        paths.iter().any(|p| p == rel || p.ends_with(&tail))
    }
}

/// 한 파일을 읽는 기준들.
struct Ctx<'a> {
    home: &'a Path,
    /// 상대 경로를 붙여 볼 자리(프로젝트 루트·그 부모·스킬 폴더)
    bases: Vec<PathBuf>,
    /// 전역 스킬 — 자기 폴더 안(`references/`·`scripts/`)만 본다
    own_only: bool,
    /// 이 프로젝트 안 꼬리 찾기. 프로젝트 파일일 때만
    index: Option<&'a mut Index>,
    /// 줄에 이름이 나오면 그 폴더도 기준이 되는 스킬들 — "`x` 스킬의 `scripts/a.sh`"
    skills: &'a [(String, PathBuf)],
}

impl Ctx<'_> {
    /// 한 파일을 훑어 없는 경로를 `(줄, 경로)` 로.
    fn missing_in(&mut self, text: &str) -> Vec<(usize, String)> {
        let home_s = self.home.to_string_lossy().into_owned();
        let mut out = vec![];
        for l in md::lines(text).iter().filter(|l| !l.in_code) {
            let named: Vec<&(String, PathBuf)> = self
                .skills
                .iter()
                .filter(|(n, _)| crate::edges::mentions(l.text, n))
                .collect();
            for span in md::code_spans(l.text) {
                let Some(c) = candidate(span) else { continue };
                let exists = if let Some(r) = c.strip_prefix("~/") {
                    // 홈 최상위가 이 맥에 없으면 다른 기계(서버·다른 맥)의 경로이거나
                    // 프로젝트의 `~/` 별칭이다 — 이 맥에서 낡았다고 말할 수 없다
                    let top = r.split('/').next().unwrap_or("");
                    if !self.home.join(top).exists() {
                        continue;
                    }
                    exists_or_prefix(&self.home.join(r))
                } else if c.starts_with('/') {
                    // 홈 밑 절대 경로만 — `/api/ingest` 같은 라우트는 경로가 아니다
                    if !c.starts_with(&home_s) {
                        continue;
                    }
                    exists_or_prefix(Path::new(c))
                } else {
                    let seg = first_seg(c);
                    // 같은 줄에 이름이 나온 스킬 — `x/references/a.md` 면 스킬들 폴더에,
                    // `references/a.md` 면 그 스킬 폴더에 붙인다. 그 밖(`docs/…`)은 그 스킬이
                    // 다루는 프로젝트 이야기라 기준이 못 된다.
                    let via: Vec<PathBuf> = named
                        .iter()
                        .filter_map(|(n, p)| {
                            if seg == n {
                                p.parent().map(Path::to_path_buf)
                            } else if SKILL_OWN.contains(&seg) {
                                Some(p.clone())
                            } else {
                                None
                            }
                        })
                        .collect();
                    let own = if self.own_only {
                        SKILL_OWN.contains(&seg)
                    } else {
                        ROOTS.contains(&seg) || has_ext(c)
                    };
                    if via.is_empty() && (!own || self.bases.is_empty()) {
                        continue;
                    }
                    // `스킬/주제` 줄임 — 실제 파일은 `스킬/references/주제.md` 다
                    let short_ref = named.iter().find(|(n, _)| seg == n).map(|(_, p)| {
                        let rest = c.trim_start_matches("./")[seg.len()..].trim_start_matches('/');
                        p.join("references").join(rest)
                    });
                    short_ref.is_some_and(|r| exists_or_prefix(&r))
                        || self
                            .bases
                            .iter()
                            .chain(via.iter())
                            .any(|b| exists_or_prefix(&b.join(c)))
                        || self.index.as_deref_mut().is_some_and(|i| i.has_tail(c))
                };
                if !exists {
                    out.push((l.no, c.to_string()));
                }
            }
        }
        out
    }
}

fn short(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(r) => format!("~/{}", r.display()),
        Err(_) => path.display().to_string(),
    }
}

pub fn diagnose(scan: &Scan, lang: Lang) -> Vec<Diagnosis> {
    let home = scan.home.as_path();
    // (늘 읽힘?, 주인) → [(근거, 대상)]
    type Found = BTreeMap<(bool, Option<PathBuf>), Vec<(String, String)>>;
    let mut found: Found = BTreeMap::new();
    let mut push = |always: bool,
                    owner: Option<&Path>,
                    file: &Path,
                    hits: Vec<(usize, String)>,
                    target: String| {
        for (line, p) in hits {
            found
                .entry((always, owner.map(Path::to_path_buf)))
                .or_default()
                .push((
                    format!("{}:{line} → {p}", short(file, home)),
                    target.clone(),
                ));
        }
    };

    // 줄에 이름이 나오면 그 폴더를 기준으로 삼을 스킬들(전역 + 모든 프로젝트)
    let skills: Vec<(String, PathBuf)> = scan
        .global
        .skills
        .iter()
        .chain(scan.projects.iter().flat_map(|p| p.skills.iter()))
        .map(|s| (s.name.clone(), s.path.clone()))
        .collect();
    let read = |p: &Path| std::fs::read_to_string(p).ok();

    for f in budget::instruction_files(home, None) {
        let mut cx = Ctx {
            home,
            bases: vec![],
            own_only: false,
            index: None,
            skills: &skills,
        };
        if let Some(t) = read(&f) {
            push(true, None, &f, cx.missing_in(&t), "CLAUDE.md".into());
        }
    }
    for s in &scan.global.skills {
        let file = s.path.join("SKILL.md");
        let mut cx = Ctx {
            home,
            bases: vec![s.path.clone()],
            own_only: true,
            index: None,
            skills: &skills,
        };
        if let Some(t) = read(&file) {
            push(false, None, &file, cx.missing_in(&t), s.name.clone());
        }
    }
    for p in &scan.projects {
        let mut index = Index {
            root: p.path.clone(),
            paths: None,
        };
        // 프로젝트 루트, 그 부모(옆 프로젝트를 이름으로 부른다), 홈(`Desktop/…`)
        let roots: Vec<PathBuf> = [
            Some(p.path.clone()),
            p.path.parent().map(Path::to_path_buf),
            Some(home.to_path_buf()),
        ]
        .into_iter()
        .flatten()
        .collect();
        for f in [p.path.join("CLAUDE.md"), p.path.join(".claude/CLAUDE.md")] {
            if let Some(t) = read(&f) {
                let mut cx = Ctx {
                    home,
                    bases: roots.clone(),
                    own_only: false,
                    index: Some(&mut index),
                    skills: &skills,
                };
                push(
                    true,
                    Some(&p.path),
                    &f,
                    cx.missing_in(&t),
                    "CLAUDE.md".into(),
                );
            }
        }
        for s in &p.skills {
            let file = s.path.join("SKILL.md");
            if let Some(t) = read(&file) {
                let mut bases = roots.clone();
                bases.push(s.path.clone());
                let mut cx = Ctx {
                    home,
                    bases,
                    own_only: false,
                    index: Some(&mut index),
                    skills: &skills,
                };
                push(
                    false,
                    Some(&p.path),
                    &file,
                    cx.missing_in(&t),
                    s.name.clone(),
                );
            }
        }
    }

    found
        .into_iter()
        .map(|((always, owner), items)| {
            let n = items.len();
            let (ev, names): (Vec<String>, Vec<String>) = items.into_iter().unzip();
            let x = if always {
                d(Severity::Problem, "stale.always_on",
                    pick(lang, &format!("늘 읽히는 지침이 없는 경로를 가리킨다 {n}건"),
                        &format!("{n} always-loaded instruction(s) point at a missing path")),
                    pick(lang,
                        "CLAUDE.md 는 매 세션 실려 대기 중에도 판단에 끼어든다. 가리키는 파일이 옮겨졌거나 지워졌으면 늘 틀린 길을 안내한다 — 낡음 의심. 경로를 고치거나 줄을 지운다.",
                        "CLAUDE.md is loaded every session and steers every turn. If the file it points at moved or was deleted, it misdirects all the time — likely stale. Fix the path or drop the line."),
                    ev)
            } else {
                d(Severity::Cost, "stale.skill",
                    pick(lang, &format!("스킬 본문이 없는 경로를 가리킨다 {n}건"),
                        &format!("{n} skill reference(s) to a missing path")),
                    pick(lang,
                        "부를 때만 읽히니 당장 해는 없지만, 부르는 순간 없는 파일을 찾아 헤맨다 — 낡음 의심.",
                        "Only read when the skill is invoked, so it does no harm until then — but then it sends the model after a file that is gone. Likely stale."),
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
    fn 경로_후보를_다듬는다() {
        assert_eq!(candidate("src/a.rs:12"), Some("src/a.rs"));
        assert_eq!(candidate("docs/x.md#제목"), Some("docs/x.md"));
        assert_eq!(candidate("src/<n>.ts"), None);
        assert_eq!(candidate("https://a.b/c"), None);
        assert_eq!(candidate("@scope/pkg"), None);
        assert_eq!(candidate("npm run build"), None);
        assert_eq!(candidate("tests/scan.rs:26,93"), Some("tests/scan.rs"));
        assert_eq!(candidate("references/"), None);
        assert_eq!(candidate("app/(tabs)/a.tsx"), Some("app/(tabs)/a.tsx"));
    }

    #[test]
    fn 확장자를_가린다() {
        assert!(has_ext("profile/terms.tsx"));
        assert!(!has_ext("owner/repo"));
        assert!(!has_ext("a/.env"));
    }
}
