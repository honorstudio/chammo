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

/// 경로 가까이(앞뒤 NEAR 글자)에 있으면 경로 주장이 아닌 신호(진단 v2 남은 헛경고, 2026-10-02) — 예시, 없앤 자리, "없으면 만든다" 같은 없는 게 정상인 자리.
/// 줄 전체로 보면 긴 줄 먼 곳의 '없으면'이 진짜 낡은 경로까지 지웠다(실측: 다른 저장소 416행)
#[rustfmt::skip]
const LINE_CUES: &[&str] = &[
    "예:", "예시", "예를 들어", "e.g.", "for example",
    "폐지", "없앴", "지웠", "사라졌", "그 전에는", "예전엔", "no longer", "removed", "deprecated",
    "없으면", "없을 때", "없어도", "필요해지면", "if missing", "if absent",
];
const NEAR: usize = 40;
/// 경로 바로 뒤에 오면 그 경로는 돌려서 생기는 목적지다(`X`로 이관 · `X` 에 저장한다).
#[rustfmt::skip]
const DEST_AFTER: &[&str] = &[
    "로 이관", "으로 이관", "로 옮", "으로 옮", "로 압축", "에 저장", "에 남긴", "에 남겨", "에 만든", "에 만들", "에 적는", "에 생긴", "가 생긴", "이 생긴", "에 떨어",
];
/// 경로 바로 앞에 오면 목적지다(write to `X`).
const DEST_BEFORE: &[&str] = &["write to", "writes to", "written to", "save to", "saved to", "output to"];
/// 기계마다 다른 자리 — 설치된 앱·OS 상태. 하네스가 장담할 파일이 아니다(아이맥 이야기를 맥북에서 읽으면 늘 없다)
const MACHINE: &[&str] = &["Library/", "Applications/"];
/// Claude Code 가 정한 자리 — 쓰지 않으면 없는 게 정상이다
#[rustfmt::skip]
const CONVENTION_DIRS: &[&str] = &[
    "~/.claude/agents", "~/.claude/commands", "~/.claude/output-styles", ".claude/agents", ".claude/commands", ".claude/output-styles",
];

fn is_repo_name(n: &str) -> bool {
    n.len() >= 4 && n.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

/// `name` 이 줄에 낱말로 나오나 — 대소문자 무시, 경계는 ASCII 낱말 글자만(`project-b의` 도 잡게). 백틱 안은 안 본다(경로 자체가 이름과 겹친다)
fn names_word(line: &str, name: &str) -> bool {
    let hay = md::strip_code_spans(line).to_lowercase();
    let w = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    let mut from = 0;
    while let Some(i) = hay[from..].find(name) {
        let (a, b) = (from + i, from + i + name.len());
        if hay[..a].chars().next_back().is_none_or(|c| !w(c)) && hay[b..].chars().next().is_none_or(|c| !w(c)) {
            return true;
        }
        from = b;
    }
    false
}

/// 조각 앞뒤 NEAR 글자(소문자) — 신호 낱말을 찾는 창
fn near(line: &str, span: &str) -> String {
    let Some(off) = (span.as_ptr() as usize).checked_sub(line.as_ptr() as usize).filter(|o| *o + span.len() <= line.len()) else {
        return line.to_lowercase();
    };
    let before: String = line[..off].chars().rev().take(NEAR).collect::<Vec<_>>().into_iter().rev().collect();
    let after: String = line[off + span.len()..].chars().take(NEAR).collect();
    format!("{before} {after}").to_lowercase()
}

/// 이 조각이 줄 안에서 목적지 자리(돌려야 생기는 파일)에 있나 — 바로 뒤 "로 이관"·"에 저장", 바로 앞 "write to", `a` → `b` 의 b
fn is_destination(line: &str, span: &str) -> bool {
    let Some(off) = (span.as_ptr() as usize).checked_sub(line.as_ptr() as usize).filter(|o| *o + span.len() <= line.len()) else {
        return false;
    };
    let before = line[..off].trim_end_matches([' ', '`']);
    let after = line[off + span.len()..].trim_start_matches([' ', '`']);
    let low = before.to_lowercase();
    DEST_AFTER.iter().any(|c| after.starts_with(c))
        || DEST_BEFORE.iter().any(|c| low.ends_with(c))
        || before.strip_suffix('→').is_some_and(|b| b.trim_end().ends_with('`'))
}

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
    /// 다른 저장소 이름(소문자) — 줄에 나오면 그 경로는 그 저장소 이야기다(`project-b의 `di/container.ts``)
    repos: &'a [String],
    /// 프로젝트들이 놓인 폴더(devRoot) — 그 바로 아래 없는 폴더는 이 맥에 안 받은 저장소다
    repo_roots: &'a [PathBuf],
    /// 이 파일의 주인 프로젝트 이름(소문자) — 자기 이름은 다른 저장소가 아니다
    own: Option<String>,
}

impl Ctx<'_> {
    /// 한 파일을 훑어 없는 경로를 `(줄, 경로)` 로.
    fn missing_in(&mut self, text: &str) -> Vec<(usize, String)> {
        let home_s = self.home.to_string_lossy().into_owned();
        let mut out = vec![];
        // 이 파일이 devRoot 바로 아래 폴더로 부르는 저장소(`~/Desktop/dev/acme`) — 이 맥에 없어도 이름이 다른 줄에서 나온다(ACME `docs/…`)
        let mut repos: Vec<String> = self.repos.to_vec();
        for l in md::lines(text).iter().filter(|l| !l.in_code) {
            for span in md::code_spans(l.text) {
                if let Some(n) = self.repo_dir(span).filter(|n| is_repo_name(n)) {
                    repos.push(n);
                }
            }
        }
        repos.retain(|r| Some(r) != self.own.as_ref());
        for l in md::lines(text).iter().filter(|l| !l.in_code) {
            let other_repo = repos.iter().any(|r| names_word(l.text, r));
            let named: Vec<&(String, PathBuf)> = self
                .skills
                .iter()
                .filter(|(n, _)| crate::edges::mentions(l.text, n))
                .collect();
            for span in md::code_spans(l.text) {
                let Some(c) = candidate(span) else { continue };
                let bare = c.trim_end_matches('/');
                let cue = || {
                    let w = near(l.text, span);
                    LINE_CUES.iter().any(|c| w.contains(c))
                };
                if is_destination(l.text, span) || cue()
                    || CONVENTION_DIRS.contains(&bare)
                    || self.repo_dir(c).is_some()
                    || first_seg(c).strip_prefix('.').is_some_and(|n| self.skills.iter().any(|(s, _)| s == n))
                {
                    continue;
                }
                let machine = |rest: &str| MACHINE.iter().any(|m| rest.starts_with(m));
                if c.strip_prefix("~/").is_some_and(machine) || c.strip_prefix(home_s.as_str()).and_then(|r| r.strip_prefix('/')).is_some_and(machine) {
                    continue;
                }
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
                // 다른 저장소를 이름으로 부른 줄 — 이 프로젝트에 없어도 그 저장소 이야기다
                if !exists && !other_repo {
                    out.push((l.no, c.to_string()));
                }
            }
        }
        out
    }
}

impl Ctx<'_> {
    /// `~/Desktop/dev/acme` 처럼 devRoot 바로 아래 폴더를 가리키면 그 이름(소문자)
    fn repo_dir(&self, span: &str) -> Option<String> {
        let c = candidate(span)?;
        let p = match c.strip_prefix("~/") {
            Some(r) => self.home.join(r),
            None if c.starts_with('/') => PathBuf::from(c),
            None => return None,
        };
        let p = PathBuf::from(p.to_string_lossy().trim_end_matches('/'));
        let parent = p.parent()?;
        self.repo_roots.iter().any(|r| r == parent).then(|| p.file_name().map(|n| n.to_string_lossy().to_lowercase())).flatten()
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
    // 저장소들이 놓인 폴더(devRoot 처럼 프로젝트가 셋 이상, 홈은 빼고)와 그 안 폴더 이름 — 줄에 다른 저장소 이름이 나오면 그 저장소 이야기다.
    // 하나뿐인 폴더(~/Desktop)까지 넣으면 `~/Desktop/x.pdf` 가 저장소가 돼 진짜를 놓쳤다(실측)
    let mut per_parent: BTreeMap<PathBuf, usize> = BTreeMap::new();
    for p in &scan.projects {
        if let Some(r) = p.path.parent().filter(|r| *r != home) {
            *per_parent.entry(r.to_path_buf()).or_default() += 1;
        }
    }
    let repo_roots: Vec<PathBuf> = per_parent.into_iter().filter(|(_, n)| *n >= 3).map(|(r, _)| r).collect();
    let mut repos: Vec<String> = scan.projects.iter().filter_map(|p| p.path.file_name()).map(|n| n.to_string_lossy().to_lowercase()).collect();
    for r in &repo_roots {
        for e in std::fs::read_dir(r).into_iter().flatten().flatten() {
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                repos.push(e.file_name().to_string_lossy().to_lowercase());
            }
        }
    }
    // 저장소 이름은 영문 슬러그만 — 나스 '로그' 같은 한글 폴더 이름이 줄의 낱말과 겹쳐 진짜를 지웠다(실측)
    repos.retain(|n| is_repo_name(n) && !n.starts_with('.') && !ROOTS.contains(&n.as_str()) && !SKILL_OWN.contains(&n.as_str()));
    repos.sort();
    repos.dedup();

    for f in budget::instruction_files(home, None) {
        let mut cx = Ctx {
            home,
            bases: vec![],
            own_only: false,
            index: None,
            skills: &skills,
            repos: &repos,
            repo_roots: &repo_roots,
            own: None,
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
            repos: &repos,
            repo_roots: &repo_roots,
            own: None,
        };
        if let Some(t) = read(&file) {
            push(false, None, &file, cx.missing_in(&t), s.name.clone());
        }
    }
    for p in &scan.projects {
        let own = p.path.file_name().map(|n| n.to_string_lossy().to_lowercase());
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
                    repos: &repos,
                    repo_roots: &repo_roots,
                    own: own.clone(),
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
                    repos: &repos,
                    repo_roots: &repo_roots,
                    own: own.clone(),
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
