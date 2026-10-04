//! 무엇이 무엇을 부르는가 — 계층 위에 곡선으로 그려지는 관계.
//!
//! 텍스트에서 이름을 찾는 일이라 **부분 문자열 오탐**이 최대 위험이다.
//! `alphabet`이 `alpha` 참조로 잡히면 그래프 전체가 거짓말이 된다.
//! 그래서 단어 경계를 직접 판정한다.

use crate::model::*;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// 식별자를 이루는 문자. 이름 양옆이 이 문자면 다른 단어의 일부다.
fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '-' || c == '_'
}

/// `needle`이 **온전한 단어로** 등장하는가.
pub fn mentions(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let mut from = 0;
    while let Some(i) = haystack[from..].find(needle) {
        let start = from + i;
        let end = start + needle.len();
        let before_ok = haystack[..start]
            .chars()
            .next_back()
            .is_none_or(|c| !is_word(c));
        let after_ok = haystack[end..].chars().next().is_none_or(|c| !is_word(c));
        if before_ok && after_ok {
            return true;
        }
        from = end;
    }
    false
}

/// 텍스트에서 `mcp__<서버>__<도구>` 꼴을 찾아 서버 이름만 추린다.
///
/// 서버 이름에 공백이 들어갈 수 있어(`Figma Desktop`) 문자 종류로 자르지 않고
/// 여는 `mcp__`와 닫는 `__` 사이를 그대로 가져온다.
pub fn mcp_calls(text: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut rest = text;
    while let Some(i) = rest.find("mcp__") {
        let after = &rest[i + 5..];
        // 닫는 `__`를 못 찾으면 이 `mcp__`만 건너뛴다.
        // 통째로 멈추면 뒤에 남은 진짜 호출을 전부 잃고, 그러면 그래프가 조용히 비어버린다.
        let Some(j) = after.find("__") else {
            rest = after;
            continue;
        };
        let name = after[..j].trim();
        // `{name}` `<server>` 같은 자리표시자는 실제 호출이 아니다.
        // (`xxx` 같은 예시 이름까지는 못 거른다 — 그건 사람이 판단할 몫이다)
        let placeholder = name.contains(['{', '}', '<', '>', '$']);
        if !name.is_empty() && name.len() < 64 && !name.contains('\n') && !placeholder {
            out.insert(name.to_string());
        }
        rest = &after[j + 2..];
    }
    out
}

/// 스킬 폴더 안의 텍스트를 **본문**과 **예시**로 갈라 이어 붙인다. MCP 호출 탐지용.
///
/// `.md` 의 코드 블록·표는 예시 자리다 — MCP 를 설명하는 스킬이 `mcp__xxx__…` 같은
/// 이름을 거기 적는다. 스크립트(`.sh`·`.json`)는 통째로 본문이다: 거기 적힌 건 실제로 돈다.
fn folder_text(dir: &Path) -> (String, String) {
    let (mut live, mut example) = (String::new(), String::new());
    for e in walkdir::WalkDir::new(dir)
        .max_depth(3)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        let ext = e.path().extension().and_then(|x| x.to_str()).unwrap_or("");
        if !e.file_type().is_file() || !matches!(ext, "md" | "sh" | "json") {
            continue;
        }
        let Ok(t) = std::fs::read_to_string(e.path()) else {
            continue;
        };
        if ext != "md" {
            live.push_str(&t);
            live.push('\n');
            continue;
        }
        for l in crate::md::lines(&t) {
            let buf = if l.is_example() {
                &mut example
            } else {
                &mut live
            };
            buf.push_str(l.text);
            buf.push('\n');
        }
    }
    (live, example)
}

/// 훅 명령줄에서 실행 스크립트 경로를 뽑는다. `bash ~/.claude/hooks/x.sh` → 그 파일.
/// 훅 명령줄에서 실행 스크립트 경로를 뽑는다. 본문 로딩에서도 쓰므로 공개한다.
pub fn hook_script_path(command: &str, home: &Path) -> Option<PathBuf> {
    hook_script(command, home)
}

fn hook_script(command: &str, home: &Path) -> Option<PathBuf> {
    // 인자·따옴표·`"$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh` 형태가 모두 온다.
    // 마지막 토큰만 보면 인자가 붙은 훅을 통째로 놓친다 — 토큰을 모두 훑어 실재하는 파일을 찾는다.
    for raw in command.split_whitespace() {
        let token = raw.trim_matches(['"', '\'']);
        let expanded = token
            .replace("$CLAUDE_PROJECT_DIR/", "")
            .replace("${CLAUDE_PROJECT_DIR}/", "");
        let path = if let Some(rel) = expanded.strip_prefix("~/") {
            home.join(rel)
        } else {
            PathBuf::from(&expanded)
        };
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

/// 한 스코프에서 **실제로 보이는** 이름들.
///
/// 글로벌 스킬은 글로벌 것만 부를 수 있고, 프로젝트 스킬은 그 프로젝트 것 + 가려지지 않은
/// 글로벌 것을 부른다. 이 규칙을 안 지키면 `proj-a`의 스킬이 `proj-b`의 스킬을 참조하는
/// 있을 수 없는 엣지가 생긴다.
struct Vocab {
    skills: Vec<(String, Scope)>,
    mcp: Vec<(String, Scope)>,
    knowledge: Vec<(String, Scope)>,
}

/// `project`가 `None`이면 글로벌 시점, `Some`이면 그 프로젝트 시점의 어휘를 만든다.
fn vocab_for(scan: &Scan, project: Option<&Project>) -> Vocab {
    let mut v = Vocab {
        skills: vec![],
        mcp: vec![],
        knowledge: vec![],
    };
    if let Some(p) = project {
        v.skills
            .extend(p.skills.iter().map(|s| (s.name.clone(), Scope::Project)));
        v.mcp
            .extend(p.mcp.iter().map(|m| (m.name.clone(), Scope::Project)));
        v.knowledge
            .extend(p.knowledge.iter().map(|k| (k.name.clone(), Scope::Project)));
    }
    // 프로젝트가 같은 이름을 갖고 있으면 글로벌 쪽은 가려져 안 보인다
    for s in &scan.global.skills {
        if !v.skills.iter().any(|(n, _)| *n == s.name) {
            v.skills.push((s.name.clone(), Scope::Global));
        }
    }
    // **어디서나 읽히는 선언만 어휘다.** 스킬은 아무 폴더에서나 돌기 때문이다.
    //
    // `~/.claude/.mcp.json` 은 어느 세션도 안 읽고, 홈 루트 `~/.mcp.json` 은 홈에서만
    // 읽힌다. 둘 다 어휘에 넣어 주면 "선언돼 있으니 괜찮다"고 잘못 판정하게 된다 —
    // 안 읽히는 선언을 뺐을 때 미선언 호출이 10건에서 18건으로 드러난 그 자리다.
    for m in scan.global.mcp.iter().filter(|m| m.loaded.everywhere()) {
        if !v.mcp.iter().any(|(n, _)| *n == m.name) {
            v.mcp.push((m.name.clone(), Scope::Global));
        }
    }
    // 켜진 플러그인이 데려온 서버는 어디서나 뜬다. 도구 이름 속 서버 칸은
    // `plugin_<플러그인>_<서버>` 꼴이다(실측: `mcp__plugin_sentry_sentry__…`).
    for pl in scan.global.plugins.iter().filter(|p| p.enabled) {
        for srv in &pl.mcp {
            v.mcp
                .push((format!("plugin_{}_{}", pl.short_name(), srv), Scope::Global));
        }
    }
    // 지식은 가려지지 않는다 — 스코프마다 따로 쌓이고 스킬이 양쪽을 다 읽는다
    v.knowledge.extend(
        scan.global
            .knowledge
            .iter()
            .map(|k| (k.name.clone(), Scope::Global)),
    );
    v
}

/// 이 서버가 이 어휘에서 선언돼 있나. claude.ai 커넥터(`claude_ai_*`)는 파일이 아니라
/// 계정에 붙어 어느 세션에나 뜨므로 선언된 것으로 친다.
fn declared_in(vocab: &Vocab, server: &str) -> Option<Scope> {
    if server.starts_with("claude_ai_") {
        return Some(Scope::Global);
    }
    vocab.mcp.iter().find(|(n, _)| n == server).map(|(_, s)| *s)
}

/// 한 텍스트가 부르는 것들을 엣지로 만든다.
#[allow(clippy::too_many_arguments)]
fn edges_from_text(
    text: &str,
    from: &str,
    from_scope: Scope,
    vocab: &Vocab,
    self_name: Option<&str>,
    refer_kind: EdgeKind,
    project: Option<&Path>,
    out: &mut Vec<Edge>,
) {
    let owner = || project.map(|p| p.to_path_buf());
    // 스킬의 MCP 호출은 폴더 전체를 보는 쪽(`extract`)이 맡는다 — 예시 자리를 가려야 해서.
    let with_mcp = refer_kind == EdgeKind::HookTriggers;
    for (name, scope) in &vocab.skills {
        if Some(name.as_str()) == self_name {
            continue;
        }
        if mentions(text, name) {
            out.push(Edge {
                kind: refer_kind,
                from: from.to_string(),
                from_scope,
                to: name.clone(),
                to_scope: *scope,
                project: owner(),
                example: false,
            });
        }
    }
    if !with_mcp {
        return;
    }
    for server in mcp_calls(text) {
        let declared = declared_in(vocab, &server);
        out.push(Edge {
            kind: match declared {
                Some(_) => EdgeKind::CallsMcp,
                None => EdgeKind::CallsMissingMcp,
            },
            from: from.to_string(),
            from_scope,
            to: server,
            to_scope: declared.unwrap_or(Scope::Global),
            project: owner(),
            example: false,
        });
    }
}

/// 스캔 결과에서 관계를 통째로 뽑아낸다.
pub fn extract(scan: &Scan, home: &Path) -> Vec<Edge> {
    let mut out = vec![];
    let global_vocab = vocab_for(scan, None);

    // 훅 → 스킬. 훅은 사람이 부르지 않아도 도는 유일한 계층이라 먼저 본다.
    // 프로젝트 훅도 똑같이 돈다 — 화면에 칩으로 그려놓고 엣지를 안 만들면
    // 눌렀을 때 늘 "0개를 부른다"가 나온다.
    let mut hook_jobs: Vec<(&Hook, Scope, &Vocab, Option<&Path>)> = scan
        .global
        .hooks
        .iter()
        .map(|h| (h, Scope::Global, &global_vocab, None))
        .collect();
    let project_vocabs: Vec<Vocab> = scan
        .projects
        .iter()
        .map(|p| vocab_for(scan, Some(p)))
        .collect();
    for (p, v) in scan.projects.iter().zip(project_vocabs.iter()) {
        for h in &p.hooks {
            hook_jobs.push((h, Scope::Project, v, Some(p.path.as_path())));
        }
    }
    for (h, scope, vocab, owner) in hook_jobs {
        let Some(script) = hook_script(&h.command, home) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(&script) else {
            continue;
        };
        let from = script
            .strip_prefix(home)
            .unwrap_or(&script)
            .display()
            .to_string();
        edges_from_text(
            &text,
            &from,
            scope,
            vocab,
            None,
            EdgeKind::HookTriggers,
            owner,
            &mut out,
        );
    }

    // 지침 → 스킬
    if let Some(md) = &scan.global.claude_md {
        if let Ok(text) = std::fs::read_to_string(md) {
            edges_from_text(
                &text,
                "CLAUDE.md",
                Scope::Global,
                &global_vocab,
                None,
                EdgeKind::DocDirects,
                None,
                &mut out,
            );
        }
    }

    // 프로젝트 지침 → 스킬. 전역 CLAUDE.md 만 읽고 **프로젝트 것은 빠져 있었다** —
    // 화면에 칩으로 그려놓고 엣지를 안 만들면 눌렀을 때 늘 "0개를 부른다"가 나온다.
    for (p, v) in scan.projects.iter().zip(project_vocabs.iter()) {
        if !p.has_claude_md {
            continue;
        }
        // CLAUDE.local.md 는 읽지 않는다 — 계정·키를 담으라고 만든 자리다(절대원칙 2).
        let Ok(text) = std::fs::read_to_string(p.path.join("CLAUDE.md")) else {
            continue;
        };
        edges_from_text(
            &text,
            "CLAUDE.md",
            Scope::Project,
            v,
            None,
            EdgeKind::DocDirects,
            Some(p.path.as_path()),
            &mut out,
        );
    }

    // 스킬 → 스킬 / MCP / 지식. 스코프마다 보이는 어휘가 다르므로 따로 돈다.
    let mut jobs: Vec<(&Skill, Scope, &Vocab, Option<&Path>)> = vec![];
    for s in &scan.global.skills {
        jobs.push((s, Scope::Global, &global_vocab, None));
    }
    for (p, v) in scan.projects.iter().zip(project_vocabs.iter()) {
        for s in &p.skills {
            jobs.push((s, Scope::Project, v, Some(p.path.as_path())));
        }
    }

    for (skill, scope, vocab, owner) in jobs {
        // 스킬 참조는 SKILL.md 기준(본문에서 다른 스킬을 부르는 것),
        // MCP 호출은 references/까지 본다(실제 호출 예시가 거기 있다).
        let Ok(text) = std::fs::read_to_string(skill.path.join("SKILL.md")) else {
            continue;
        };
        edges_from_text(
            &text,
            &skill.name,
            scope,
            vocab,
            Some(&skill.name),
            EdgeKind::SkillRefers,
            owner,
            &mut out,
        );
        let (live, example) = folder_text(&skill.path);
        let live = mcp_calls(&live);
        let calls = live
            .iter()
            .chain(mcp_calls(&example).iter())
            .cloned()
            .collect::<BTreeSet<_>>();
        for server in calls {
            let declared = declared_in(vocab, &server);
            let edge = Edge {
                example: !live.contains(&server),
                kind: if declared.is_some() {
                    EdgeKind::CallsMcp
                } else {
                    EdgeKind::CallsMissingMcp
                },
                from: skill.name.clone(),
                from_scope: scope,
                to: server,
                to_scope: declared.unwrap_or(Scope::Global),
                project: owner.map(|p| p.to_path_buf()),
            };
            if !out
                .iter()
                .any(|e| e.kind == edge.kind && e.from == edge.from && e.to == edge.to)
            {
                out.push(edge);
            }
        }
        // 같은 이름의 지식 폴더 = 이 스킬이 그 스코프에 쌓아둔 것
        for (name, kscope) in &vocab.knowledge {
            if *name == skill.name {
                out.push(Edge {
                    kind: EdgeKind::SkillWritesKnowledge,
                    from: skill.name.clone(),
                    from_scope: scope,
                    to: name.clone(),
                    to_scope: *kscope,
                    project: owner.map(|p| p.to_path_buf()),
                    example: false,
                });
            }
        }
    }
    out
}
