//! 진단 규칙.
//!
//! 규칙은 전부 여기 있고 화면에는 없다(ADR-0002). 그래야 픽스처로 검증된다.
//! 그리고 **판정하지 않고 알린다** — 근거를 함께 내고, 고치는 건 사람이 한다(ADR-0003).

use crate::i18n::{pick, Lang};
use crate::model::*;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub(crate) fn d(
    sev: Severity,
    rule: &str,
    title: String,
    detail: String,
    evidence: Vec<String>,
) -> Diagnosis {
    Diagnosis {
        severity: sev,
        rule: rule.into(),
        title,
        detail,
        evidence,
        project: None,
        targets: vec![],
        suggestion: None,
        fix: fix_path(rule),
    }
}

/// 규칙마다 고치는 길. 새 규칙을 만들면 여기 한 줄을 더한다 — 빠지면 "상태"로 읽힌다.
pub fn fix_path(rule: &str) -> FixPath {
    use FixPath::*;
    match rule {
        "link.broken" => Toggle,
        "mcp.declared_where_nobody_reads"
        | "mcp.home_only"
        | "mcp.permission_without_server"
        | "mcp.server_without_permission"
        | "mcp.missing_server_called"
        | "mcp.scoped_server_called"
        | "skill.frontmatter"
        | "project.case_duplicate"
        | "stale.always_on"
        | "stale.skill"
        | "dup.instructions"
        | "dup.memory" => EditFile,
        // 0회는 "안 쓴다"가 아니다 — 지우기 전에 사람이 정한다(원칙 8)
        "skill.never_called" | "conflict.global_ban" | "dup.skill" => Ask,
        _ => None,
    }
}

/// 어느 프로젝트의 이야기인지 달아 준다. 글로벌이면 붙이지 않는다.
pub(crate) fn at(mut x: Diagnosis, project: Option<&Path>) -> Diagnosis {
    x.project = project.map(|p| p.to_path_buf());
    x
}

/// 짚어 줄 대상을 달아 준다. 중복은 접고 순서를 고정한다 —
/// 같은 스킬이 근거에 여러 번 나오는 규칙이 있다.
pub(crate) fn aim(mut x: Diagnosis, names: impl IntoIterator<Item = String>) -> Diagnosis {
    let mut v: Vec<String> = names.into_iter().filter(|s| !s.is_empty()).collect();
    v.sort();
    v.dedup();
    x.targets = v;
    x
}

/// 자리 목록이 길면 셋만 적고 개수로 접는다 — 실제 하네스에서 프로젝트 27개가 한 줄에 나열됐다.
fn fold(places: &[String]) -> String {
    match places.len() {
        0..=3 => places.join(", "),
        n => format!("{} 외 {}곳", places[..3].join(", "), n - 3),
    }
}

/// 진단을 낸다. 문장은 **여기서 언어를 정해 만든다** — 화면에서 EN 을 눌렀는데
/// 진단만 한국어로 남으면, 반쯤 번역된 화면이 되어 아예 한국어인 것보다 나쁘다.
pub fn run(scan: &Scan, lang: Lang) -> Vec<Diagnosis> {
    let mut out = vec![];

    // ── 권한과 서버가 어긋난 자리
    // 아무도 읽지 않는 자리에 선언된 것들. **선언은 있는데 실제로는 없는 서버**다.
    let unread: Vec<String> = scan
        .global
        .mcp
        .iter()
        .filter(|m| m.loaded == Loaded::Never)
        .map(|m| m.name.clone())
        .collect();
    if !unread.is_empty() {
        let n = unread.len();
        let names = unread.clone();
        out.push(aim(d(Severity::Problem, "mcp.declared_where_nobody_reads",
            pick(lang,
                &format!("아무도 읽지 않는 자리에 선언된 MCP {n}개"),
                &format!("{n} MCP server(s) declared where nothing reads them")),
            pick(lang,
                "`.mcp.json` 은 **프로젝트 스코프** 파일이라 프로젝트 폴더에 있을 때만 로드된다. \
                 `~/.claude/.mcp.json` 에 둔 것은 어느 세션도 읽지 않는다 — 선언은 있는데 서버는 없는 셈이다. \
                 모든 프로젝트에서 쓰려면 `~/.claude.json` 의 `mcpServers` 로 옮겨야 한다.",
                "`.mcp.json` is a **project-scoped** file — it is only loaded from a project folder. \
                 One placed in `~/.claude/` is read by nothing, so the declaration exists but the server does not. \
                 To use these everywhere, move them into `mcpServers` in `~/.claude.json`."),
            unread), names));
    }

    // 홈에서만 읽히는 자리. **"없다"가 아니라 "여기서만 있다"** 라서 따로 낸다 —
    // 한 진단에 섞으면 옮겨야 할 것과 그대로 둬도 될 것이 구분되지 않는다.
    let home_only: Vec<String> = scan
        .global
        .mcp
        .iter()
        .filter(|m| m.loaded == Loaded::HomeOnly)
        .map(|m| m.name.clone())
        .collect();
    if !home_only.is_empty() {
        let n = home_only.len();
        let names = home_only.clone();
        out.push(aim(d(Severity::Note, "mcp.home_only",
            pick(lang,
                &format!("홈에서 열 때만 뜨는 MCP {n}개"),
                &format!("{n} MCP server(s) that only appear in the home folder")),
            pick(lang,
                "홈 루트 `~/.mcp.json` 에 있다. `.mcp.json` 은 **그 폴더에서 세션을 열 때** 로드되는 파일이라, \
                 홈에서는 뜨고 다른 폴더에서는 없는 것과 같다. 자기 `.mcp.json` 이 있는 프로젝트는 그쪽이 이기니 \
                 영향이 없지만, **선언이 아무 데도 없는 폴더에서는 이것도 안 뜬다.** \
                 어디서나 쓰려면 `~/.claude.json` 의 `mcpServers` 로 옮긴다.",
                "Declared in `~/.mcp.json` at the home root. A `.mcp.json` is loaded **from the folder you open a session in**, \
                 so this appears in the home folder and nowhere else. Projects with their own `.mcp.json` win anyway, \
                 but **a folder that declares nothing gets nothing.** \
                 To use these everywhere, move them into `mcpServers` in `~/.claude.json`."),
            home_only), names));
    }

    // 아래 계산에서도 **읽히는 것만** 선언으로 친다. 안 읽히는 선언을 세면
    // 권한이 어긋난 자리를 놓치고, 실패할 호출을 괜찮다고 말하게 된다.
    let declared: Vec<&str> = scan
        .global
        .mcp
        .iter()
        .filter(|m| m.loaded.everywhere())
        .map(|m| m.name.as_str())
        .collect();
    // 어휘(어디서나 읽히는 선언)에는 없어도 **어딘가에는** 선언된 서버 — 프로젝트 `.mcp.json`·
    // 로컬 스코프(둘 다 `p.mcp`)·홈 `~/.mcp.json`. 권한·호출 진단이 같은 목록을 본다.
    let somewhere: Vec<(&str, String)> = scan
        .projects
        .iter()
        .flat_map(|p| p.mcp.iter().map(move |m| (m.name.as_str(), p.name.clone())))
        .chain(
            scan.global
                .mcp
                .iter()
                .filter(|m| m.loaded == Loaded::HomeOnly)
                .map(|m| (m.name.as_str(), "~".to_string())),
        )
        .collect();
    let where_declared = |server: &str| -> Vec<String> {
        let mut v: Vec<String> = somewhere
            .iter()
            .filter(|(n, _)| *n == server)
            .map(|(_, w)| w.clone())
            .collect();
        v.sort();
        v.dedup();
        v
    };
    // 켜진 플러그인 서버·claude.ai 커넥터는 어디서나 뜬다
    let everywhere_extra = |server: &str| {
        server.starts_with("claude_ai_")
            || scan.global.plugins.iter().filter(|p| p.enabled).any(|p| {
                p.mcp
                    .iter()
                    .any(|m| server == format!("plugin_{}_{}", p.short_name(), m))
            })
    };
    let allowed: Vec<String> = scan
        .global
        .allowed_mcp
        .iter()
        .filter_map(|p| p.strip_prefix("mcp__"))
        .map(|r| r.split("__").next().unwrap_or(r).to_string())
        .collect::<std::collections::BTreeSet<_>>()
        // 도구마다 권한 줄이 따로 있어도 서버는 하나다(실측: playwright 가 다섯 번 세였다)
        .into_iter()
        .collect();

    let orphan_perms: Vec<String> = allowed
        .iter()
        .filter(|a| {
            !declared.iter().any(|d| d == *a)
                && where_declared(a).is_empty()
                && !everywhere_extra(a)
        })
        .cloned()
        .collect();
    if !orphan_perms.is_empty() {
        let names = orphan_perms.clone();
        out.push(aim(d(Severity::Note, "mcp.permission_without_server",
            pick(lang,
                &format!("권한만 있고 서버가 없는 MCP {}개", orphan_perms.len()),
                &format!("{} MCP permission(s) with no server", orphan_perms.len())),
            pick(lang,
                "settings.json에서 허용해 뒀지만 사용자·로컬·프로젝트·홈·플러그인·커넥터 어디에도 그 서버 선언이 없다. 지운 서버의 권한이 남은 것일 수 있다.",
                "Allowed in settings.json, but no user, local, project, home, plugin or connector scope declares the server. It may be left over from a removed server."),
            orphan_perms), names));
    }

    let unallowed: Vec<String> = declared
        .iter()
        .filter(|n| !allowed.iter().any(|a| a == **n))
        .map(|s| s.to_string())
        .collect();
    if !unallowed.is_empty() {
        let names = unallowed.clone();
        out.push(aim(d(
            Severity::Cost,
            "mcp.server_without_permission",
            pick(lang,
                &format!("쓸 때마다 확인을 묻는 MCP {}개", unallowed.len()),
                &format!("{} MCP server(s) that ask every time", unallowed.len())),
            pick(lang,
                "서버는 선언돼 있는데 permissions.allow에 없어서 호출할 때마다 승인을 물어본다.",
                "The server is declared but missing from permissions.allow, so every call asks for approval."),
            unallowed,
        ), names));
    }

    // ── 실행하면 실패하는 호출
    // 어휘에 없다고 다 실패는 아니다. 셋으로 가른다:
    //   ① 어느 프로젝트(또는 홈)에는 선언돼 있다 → 그 자리에서만 쓰는 서버(Note)
    //   ② 코드 블록·표에서만 나왔다 → 예시일 가능성이 크다(Note)
    //   ③ 그 밖 → 실제로 부르면 실패한다(Problem)
    // 한 덩어리로 내던 때는 MCP 를 설명하는 스킬의 예시 이름까지 빨갛게 떴다.
    // (갈래, 주인) → [(엣지, 선언된 자리들)]
    type Calls<'a> = Vec<(&'a Edge, Vec<String>)>;
    let mut missing_by: BTreeMap<(u8, Option<PathBuf>), Calls> = BTreeMap::new();
    for e in scan
        .edges
        .iter()
        .filter(|e| e.kind == EdgeKind::CallsMissingMcp)
    {
        let places = where_declared(&e.to);
        let class = if !places.is_empty() {
            0
        } else if e.example {
            1
        } else {
            2
        };
        missing_by
            .entry((class, e.project.clone()))
            .or_default()
            .push((e, places));
    }
    for ((class, owner), edges) in &missing_by {
        // 부르는 쪽과 불리는 쪽을 **둘 다** 짚는다 — 고칠 자리는 스킬일 수도 선언일 수도 있다.
        let names: Vec<String> = edges
            .iter()
            .flat_map(|(e, _)| [e.from.clone(), e.to.clone()])
            .collect();
        let mut ev: Vec<String> = edges
            .iter()
            .map(|(e, places)| match places.is_empty() {
                true => format!("{} → {}", e.from, e.to),
                false => format!("{} → {} ({})", e.from, e.to, fold(places)),
            })
            .collect();
        ev.sort();
        ev.dedup();
        let n = ev.len();
        let x = match class {
            0 => d(Severity::Note, "mcp.scoped_server_called",
                pick(lang,
                    &format!("그 프로젝트에서만 뜨는 MCP 를 부르는 스킬 {n}건"),
                    &format!("{n} call(s) to an MCP server only some projects declare")),
                pick(lang,
                    "선언이 어느 프로젝트(괄호 안)에만 있다. 거기서 열면 되고 다른 폴더에서 부르면 실패한다. \
                     그 스킬을 그 프로젝트로 내리거나, 어디서나 쓸 거면 `~/.claude.json` 의 `mcpServers` 로 올린다.",
                    "Only the project(s) in brackets declare it. It works there and fails elsewhere. \
                     Move the skill into that project, or declare the server in `mcpServers` of `~/.claude.json` to use it everywhere."),
                ev),
            1 => d(Severity::Note, "mcp.example_only",
                pick(lang,
                    &format!("코드 블록·표에만 나오는 MCP 이름 {n}건"),
                    &format!("{n} MCP name(s) seen only in code blocks or tables")),
                pick(lang,
                    "어디에도 선언이 없지만 예시 자리(코드 블록·표)에서만 나왔다. MCP 를 설명하는 스킬이 적어 둔 예시라면 그대로 둬도 된다.",
                    "Declared nowhere, but it only appears in example spots (code blocks, tables). If the skill is documenting MCP, this is fine as is."),
                ev),
            _ => d(Severity::Problem, "mcp.missing_server_called",
                pick(lang,
                    &format!("선언 안 된 MCP를 부르는 스킬 {n}건"),
                    &format!("{n} call(s) to an undeclared MCP server")),
                pick(lang,
                    "스킬 본문이 이 서버의 도구를 부르는데 사용자·로컬·프로젝트·홈·플러그인·커넥터 어디에도 선언이 없다. 실제로 부르면 실패한다.",
                    "The skill calls this server's tools in prose, but no user, local, project, home, plugin or connector scope declares it. The call would fail."),
                ev),
        };
        out.push(at(aim(x, names), owner.as_deref()));
    }

    // ── 깨진 심볼릭 링크
    // 깨진 링크도 어디에 있느냐가 다르다 — 글로벌 것과 그 프로젝트 것을 갈라 낸다.
    let link_groups: Vec<(Option<&Path>, Vec<&Link>)> = std::iter::once((
        None,
        scan.global
            .links
            .iter()
            .filter(|l| !l.alive)
            .collect::<Vec<_>>(),
    ))
    .chain(scan.projects.iter().map(|p| {
        (
            Some(p.path.as_path()),
            p.links.iter().filter(|l| !l.alive).collect::<Vec<_>>(),
        )
    }))
    .collect();
    for (owner, links) in &link_groups {
        if links.is_empty() {
            continue;
        }
        // 링크 폴더의 마지막 이름이 곧 화면에 뜨는 이름이다
        let names: Vec<String> = links
            .iter()
            .filter_map(|l| l.path.file_name().map(|n| n.to_string_lossy().into_owned()))
            .collect();
        let ev: Vec<String> = links
            .iter()
            .map(|l| format!("{} → {}", l.path.display(), l.target.display()))
            .collect();
        let n = ev.len();
        out.push(at(
            aim(d(
                Severity::Problem,
                "link.broken",
                pick(lang,
                    &format!("대상이 사라진 심볼릭 링크 {n}개"),
                    &format!("{n} broken symlink(s)")),
                pick(lang,
                    "링크는 남아 있는데 가리키는 곳이 없다. 조용히 방치되기 쉬운 자리다.",
                    "The link is still there but its target is gone. This is the kind of thing that sits unnoticed."),
                ev,
            ), names),
            *owner,
        ));
    }

    // ── 안 쓰는데 비용을 내는 스킬
    let used: Vec<&str> = scan.usage.iter().map(|u| u.skill.as_str()).collect();
    // 플러그인이 데려온 스킬도 매 세션 설명을 낸다 — 오히려 그게 절대원칙 7의 사례다.
    // 헤더 토큰 합계와 이 진단이 다른 모집단을 쓰면 두 숫자가 서로 어긋난다.
    let all_skills: Vec<&Skill> = scan
        .global
        .skills
        .iter()
        .chain(
            scan.global
                .plugins
                .iter()
                .filter(|p| p.enabled)
                .flat_map(|p| p.skills.iter()),
        )
        .collect();
    let never: Vec<&Skill> = all_skills
        .iter()
        .copied()
        .filter(|s| {
            !used
                .iter()
                .any(|u| *u == s.name || u.ends_with(&format!(":{}", s.name)))
        })
        .collect();
    if !never.is_empty() {
        let tokens: usize = never.iter().map(|s| s.description_tokens).sum();
        let total: usize = all_skills.iter().map(|s| s.description_tokens).sum();
        let mut ev: Vec<String> = never
            .iter()
            .map(|s| {
                pick(
                    lang,
                    &format!("{} ({}토큰)", s.name, s.description_tokens),
                    &format!("{} ({} tokens)", s.name, s.description_tokens),
                )
            })
            .collect();
        ev.sort();
        let names: Vec<String> = never.iter().map(|s| s.name.clone()).collect();
        // "0회"는 기록이 있는 기간의 0회다. 그 기간을 제목에 박는다.
        let (since_ko, since_en) = match &scan.usage_since {
            Some(day) => (format!("{day} 이후 "), format!(" since {day}")),
            None => (String::new(), String::new()),
        };
        out.push(aim(d(Severity::Cost, "skill.never_called",
            pick(lang,
                &format!("{}호출 기록이 없는 스킬 {}개 · 매 세션 약 {tokens}토큰", since_ko, never.len()),
                &format!("{} skill(s) with no recorded calls{} · ~{tokens} tokens every session", never.len(), since_en)),
            pick(lang,
                &format!("스킬 설명은 쓰든 안 쓰든 매 세션 시스템 프롬프트에 들어간다(전체 {total}토큰 중 {tokens}토큰). \
                     다만 0회를 '안 쓴다'로 단정할 수는 없다 — 기록이 정리된 옛 세션은 안 잡히고, \
                     최근 만든 스킬은 당연히 0이며, 가끔 쓰는 게 정상인 스킬도 있다."),
                &format!("A skill's description goes into the system prompt every session whether it is used or not \
                     ({tokens} of {total} tokens). Zero calls does not prove a skill is unused, though — pruned \
                     sessions are not counted, a recently added skill is naturally at zero, and some skills are \
                     meant to be used only now and then.")),
            ev), names));
    }

    // ── frontmatter 규격
    // 문장이 아니라 종류로 고른다. `reason.contains("frontmatter")` 로 걸렀더니
    // 영어로 스캔하는 순간 하나도 안 걸렸다 — 문장은 언어를 타고 판정은 안 탄다.
    let fm_all: Vec<&Failure> = scan
        .failures
        .iter()
        .filter(|f| {
            matches!(
                f.kind,
                FailureKind::LooseFrontmatter | FailureKind::NoFrontmatter
            )
        })
        .collect();
    // 파일이 어느 프로젝트 안에 있는지로 가른다. 글로벌 스킬의 규격 문제를
    // 남의 프로젝트 화면에서 보여줄 이유가 없고, 그 반대도 마찬가지다.
    let owner_of = |f: &Failure| -> Option<&Path> {
        scan.projects
            .iter()
            .find(|p| f.path.starts_with(&p.path))
            .map(|p| p.path.as_path())
    };
    let mut fm_by: BTreeMap<Option<PathBuf>, Vec<&Failure>> = BTreeMap::new();
    for f in &fm_all {
        fm_by
            .entry(owner_of(f).map(|p| p.to_path_buf()))
            .or_default()
            .push(f);
    }
    for (owner, group) in &fm_by {
        let names: Vec<String> = group
            .iter()
            .filter_map(|f| {
                f.path
                    .parent()?
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
            })
            .collect();
        let ev: Vec<String> = group
            .iter()
            .map(|f| format!("{}: {}", f.path.display(), f.reason))
            .collect();
        let n = ev.len();
        out.push(at(
            aim(d(Severity::Note, "skill.frontmatter",
                pick(lang,
                    &format!("frontmatter가 규격을 벗어난 스킬 {n}개"),
                    &format!("{n} skill(s) with off-spec frontmatter")),
                pick(lang,
                    "Claude Code는 관대하게 읽지만 엄격한 YAML 파서는 거부한다. 다른 도구와 함께 쓸 때 문제가 된다.",
                    "Claude Code reads these leniently, but a strict YAML parser rejects them — which bites once another tool touches the same files."),
                ev), names),
            owner.as_deref(),
        ));
    }

    // ── 막아둔 서버
    if !scan.global.denied_mcp.is_empty() {
        // 권한 패턴(`mcp__scary__*`)에서 서버 이름만 딴다 — 화면에 뜨는 건 이름이다
        let names: Vec<String> = scan
            .global
            .denied_mcp
            .iter()
            .filter_map(|p| p.strip_prefix("mcp__"))
            .map(|r| r.split("__").next().unwrap_or(r).to_string())
            .collect();
        out.push(aim(d(
            Severity::Note,
            "mcp.denied",
            pick(lang,
                &format!("거부 목록에 있는 MCP {}개", scan.global.denied_mcp.len()),
                &format!("{} MCP server(s) on the deny list", scan.global.denied_mcp.len())),
            pick(lang,
                "permissions.deny에 걸려 있어 호출되지 않는다. 서버가 선언돼 있어도 동작하지 않는다.",
                "Blocked by permissions.deny, so it never runs — declaring the server changes nothing."),
            scan.global.denied_mcp.clone(),
        ), names));
    }

    // ── 프로젝트 등록 상태
    let dup: Vec<String> = scan
        .projects
        .iter()
        .filter(|p| !p.duplicate_paths.is_empty())
        .map(|p| {
            format!(
                "{} ↔ {}",
                p.path.display(),
                p.duplicate_paths
                    .iter()
                    .map(|x| x.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
        .collect();
    if !dup.is_empty() {
        let names: Vec<String> = scan
            .projects
            .iter()
            .filter(|p| !p.duplicate_paths.is_empty())
            .map(|p| p.name.clone())
            .collect();
        out.push(aim(d(
            Severity::Problem,
            "project.case_duplicate",
            pick(lang,
                &format!("대소문자만 다른 경로로 중복 등록된 프로젝트 {}개", dup.len()),
                &format!("{} project(s) registered twice under case-different paths", dup.len())),
            pick(lang,
                "같은 폴더인데 Claude Code는 별개 프로젝트로 본다. 세션 기록과 설정이 갈린다.",
                "macOS sees one folder; Claude Code sees two projects. Session history and settings split in half."),
            dup,
        ), names));
    }

    let bare: Vec<String> = scan
        .projects
        .iter()
        .filter(|p| {
            p.skills.is_empty()
                && p.mcp.is_empty()
                && p.hooks.is_empty()
                && !p.has_claude_md
                && !p.has_claude_local_md
        })
        .map(|p| p.path.display().to_string())
        .collect();
    if !bare.is_empty() {
        let names: Vec<String> = scan
            .projects
            .iter()
            .filter(|p| {
                p.skills.is_empty()
                    && p.mcp.is_empty()
                    && p.hooks.is_empty()
                    && !p.has_claude_md
                    && !p.has_claude_local_md
            })
            .map(|p| p.name.clone())
            .collect();
        out.push(aim(d(
            Severity::Note,
            "project.no_harness",
            pick(lang,
                &format!("하네스 설정이 하나도 없는 등록 프로젝트 {}개", bare.len()),
                &format!("{} registered project(s) with no harness of their own", bare.len())),
            pick(lang,
                "전역 설정만으로 동작한다. 여기서 세션을 연 적이 있어 등록됐을 뿐이다.",
                "They run on the global setup alone. They are listed only because a session was opened there once."),
            bare,
        ), names));
    }

    // ── 연결 안 된 스킬은 '상태'지 문제가 아니다 (절대원칙 1)
    let referenced: Vec<&str> = scan.edges.iter().map(|e| e.to.as_str()).collect();
    let unlinked: Vec<String> = scan
        .global
        .skills
        .iter()
        .filter(|s| !referenced.contains(&s.name.as_str()))
        .map(|s| s.name.clone())
        .collect();
    if !unlinked.is_empty() {
        let names = unlinked.clone();
        out.push(aim(d(Severity::Note, "skill.unlinked",
            pick(lang,
                &format!("훅·지침·다른 스킬 어디서도 부르지 않는 스킬 {}개", unlinked.len()),
                &format!("{} skill(s) nothing calls", unlinked.len())),
            pick(lang,
                "문제가 아니다. 직접 이름을 불러 쓰려고 만든 스킬이면 정상이다. 다만 '만들어놓고 잊은 것'과 구분되지 않으므로 상태로 표시한다.",
                "Not a problem. A skill you invoke by name is supposed to look like this. It is shown as a state because it cannot be told apart from one you built and forgot."),
            unlinked), names));
    }

    // ── 늘 읽히는 칸과 스킬 본문의 낡음·충돌·겹침
    out.extend(crate::stale::diagnose(scan, lang));
    out.extend(crate::conflict::diagnose(scan, lang));
    out.extend(crate::overlap::diagnose(scan, lang));

    out.sort_by_key(|x| match x.severity {
        Severity::Problem => 0,
        Severity::Cost => 1,
        Severity::Note => 2,
    });
    out
}
