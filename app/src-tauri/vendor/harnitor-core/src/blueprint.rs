//! 청사진 — **"이 하네스는 이렇게 되어야 한다"**.
//!
//! 관측(v1)이 "지금 어떻게 되어 있나"에 답한다면, 청사진은 **의도**를 담는다.
//! 그리고 CLAUDE.md 의 원칙대로, 관측 결과와 **같은 자료구조 위에서** 움직인다 —
//! 따로 만들면 "본 것"과 "적용할 것"이 다른 물건이 된다.
//!
//! ## 여기서 하지 않는 일
//!
//! **파일을 건드리지 않는다.** 청사진은 의도의 목록이고, 그걸 실제 변경으로 옮기는 것은
//! `write.rs` 다(백업·미리보기·되돌리기가 거기 있다). 여기서는
//! **"이대로 하면 무엇이 얼마나 달라지는가"** 만 계산한다 — 그게 `Delta` 다.
//!
//! ## 왜 미리 계산하나
//!
//! 스킬 하나를 끄는 결정의 근거는 "매 세션 몇 토큰이 준다"이다. 적용해 보고 알면 늦다.
//! 실측: 글로벌 스킬 52개 = 세션당 9,206토큰, 그중 호출 0회가 41개.

use crate::model::{EdgeKind, Kind, Scan, Scope};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 청사진에 담기는 의도 하나.
///
/// 두 방향이 있다 — **빼기**(끄기·내리기)와 **더하기**(길 놓기).
/// 실측이 그 대칭을 요구했다: 훅이 부르는 스킬은 67%가 쓰이고, 아무도 안 부르는 것은 20%다.
/// **안 쓰이는 스킬은 나쁜 스킬이 아니라 열릴 길이 없는 스킬**이라, 빼기만으로는 절반이다.
///
/// 길은 **그을 수 있는 엣지에만** 놓는다(ADR-0006) — 훅→스킬, 지침→스킬.
/// 스킬→MCP 는 *사실의 관측*이라 손으로 만들 수 없다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Intent {
    /// 끈다. 지우지 않는다 — 보관함으로 옮겨 되돌릴 수 있게 둔다(절대원칙 1).
    Disable {
        kind: Kind,
        scope: Scope,
        name: String,
    },
    /// 꺼둔 것을 되돌린다.
    Enable {
        kind: Kind,
        scope: Scope,
        name: String,
    },
    /// 스코프를 옮긴다. 글로벌 스킬을 한 프로젝트로 내리면 **다른 모든 세션에서 사라진다** —
    /// 토큰 절감이 가장 큰 동작이다.
    MoveScope {
        kind: Kind,
        name: String,
        from: Scope,
        to: Scope,
        /// 어느 프로젝트로/에서. 글로벌 ↔ 프로젝트 이동이라 한쪽은 늘 프로젝트다.
        project: String,
    },
    /// 훅에 **낱말**을 등록해 스킬이 열리게 한다.
    ///
    /// 훅은 사람이 친 말에 그 낱말이 있을 때만 스킬을 환기한다. 그래서 길을 놓는다는 건
    /// **어떤 말에 반응할지 정하는 일**이다 — 넓으면 매번 뜨고 좁으면 안 뜬다.
    /// 그 균형은 기계가 못 정하므로 낱말은 사람이 확정한 값으로 들어온다.
    LinkHook {
        skill: String,
        /// 정규식 대안으로 이어 붙일 낱말들. 비면 길이 아니라 소음이 된다.
        words: Vec<String>,
        /// 어느 훅 이벤트에 붙일지 (`UserPromptSubmit` 등).
        event: String,
    },
    /// 지침(CLAUDE.md)에 한 줄 넣어 스킬을 가리키게 한다.
    ///
    /// 훅은 낱말이 걸릴 때만 뜨고 **지침은 매 세션 늘 로드된다** — 토큰을 늘 쓰므로
    /// 자주 쓰는 것만 여기 넣는다.
    LinkDoc { skill: String, scope: Scope },
    /// **새 스킬을 만든다.**
    ///
    /// 청사진이 "이 프로젝트엔 이런 스킬이 있으면 좋겠다"까지 답하려면 여기가 있어야 한다 —
    /// 없으면 AI 가 좋은 제안을 해도 글자로만 지나간다(실측 2026-08-31: 제안 4개가
    /// 전부 사라졌다).
    ///
    /// **우리가 파일을 쓰지 않는다.** 스킬을 만드는 일은 `skill-creator` 가 이미 한다 —
    /// frontmatter 규약·progressive disclosure·디렉토리 구조를 아는 쪽이 만드는 게 맞고,
    /// 우리가 뼈대만 찍으면 그 규약을 반쪽으로 재발명하게 된다(사용자가 지적).
    ///
    /// 그래서 이 의도는 **무엇을 만들지의 약속**이고, 적용 단계에서 그 요청을
    /// skill-creator 에게 넘긴다. 만들 자리는 우리가 정해 인자로 고정하고,
    /// 끝난 뒤 **약속한 자리에만 생겼는지 검사**한다.
    CreateSkill {
        name: String,
        /// frontmatter 의 description. **이게 매 세션 토큰을 먹는다**(절대원칙 8).
        description: String,
        /// 글로벌이면 모든 세션에, 프로젝트면 그곳에서만.
        scope: Scope,
        /// 프로젝트 스코프일 때 어디에.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        project: Option<String>,
    },
    /// 대상이 사라진 심볼릭 링크를 치운다.
    ///
    /// **지우지 않고 보관함으로 옮긴다**(절대원칙 1) — 링크가 가리키던 경로가
    /// 그 자체로 단서다. 지우면 "무엇이 있었는지"가 사라진다.
    RemoveLink { path: PathBuf },
}

impl Intent {
    pub fn name(&self) -> &str {
        match self {
            Intent::Disable { name, .. }
            | Intent::Enable { name, .. }
            | Intent::MoveScope { name, .. } => name,
            Intent::LinkHook { skill, .. } | Intent::LinkDoc { skill, .. } => skill,
            Intent::CreateSkill { name, .. } => name,
            // 링크는 경로가 곧 이름이다
            Intent::RemoveLink { .. } => "",
        }
    }
    pub fn kind(&self) -> Kind {
        match self {
            Intent::Disable { kind, .. }
            | Intent::Enable { kind, .. }
            | Intent::MoveScope { kind, .. } => *kind,
            // 길 놓기의 대상은 늘 스킬이다.
            Intent::LinkHook { .. } | Intent::LinkDoc { .. } => Kind::Skill,
            Intent::RemoveLink { .. } | Intent::CreateSkill { .. } => Kind::Skill,
        }
    }
    /// 더하기(길 놓기)인가. 화면이 빼기와 갈라 그린다.
    pub fn is_link(&self) -> bool {
        matches!(self, Intent::LinkHook { .. } | Intent::LinkDoc { .. })
    }
}

/// 청사진. 의도의 목록이다.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Blueprint {
    #[serde(default)]
    pub intents: Vec<Intent>,
}

/// 청사진이 말이 되는지 본 결과. **틀린 의도는 조용히 버리지 않고 이유와 함께 남긴다**
/// (절대원칙 6: 진단은 근거와 함께).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rejected {
    pub intent: Intent,
    /// 왜 못 하는지. 화면에 그대로 띄운다.
    pub reason: String,
}

/// 적용하면 무엇이 얼마나 달라지는가. **before/after 를 같은 구조로 담는다** —
/// 화면이 뺄셈만 하면 되도록.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Counts {
    /// 매 세션 로드되는 글로벌 스킬 수 (플러그인이 데려온 것 포함)
    pub global_skills: usize,
    /// 그 설명들이 매 세션 차지하는 토큰
    pub global_tokens: usize,
    /// 지금 보고 있는 프로젝트의 스킬 수
    pub project_skills: usize,
    pub project_tokens: usize,
    /// **열린 길** — 훅이나 지침이 실제로 부르는 글로벌 스킬 수.
    /// 토큰과 나란히 보여야 "빼기만 하고 있지 않다"가 읽힌다.
    pub open_paths: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Delta {
    pub before: Counts,
    pub after: Counts,
    /// 실제로 적용될 의도
    pub accepted: Vec<Intent>,
    /// 못 하는 의도와 그 이유
    pub rejected: Vec<Rejected>,
}

impl Delta {
    /// 매 세션 아끼는 토큰. 음수면 늘어난 것이므로 `i64` 다.
    pub fn tokens_saved(&self) -> i64 {
        self.before.global_tokens as i64 - self.after.global_tokens as i64
    }
}

/// 지금 하네스의 수치.
pub fn counts_of(scan: &Scan, project: Option<&str>) -> Counts {
    let g = &scan.global;
    // 플러그인이 데려온 스킬도 실제로 로드된다 — 빼면 화면 숫자와 어긋난다.
    let plugin_skills: Vec<_> = g
        .plugins
        .iter()
        .filter(|p| p.enabled)
        .flat_map(|p| p.skills.iter())
        .collect();
    let mut c = Counts {
        global_skills: g.skills.len() + plugin_skills.len(),
        global_tokens: g.skills.iter().map(|s| s.description_tokens).sum::<usize>()
            + plugin_skills
                .iter()
                .map(|s| s.description_tokens)
                .sum::<usize>(),
        ..Default::default()
    };
    if let Some(p) = project.and_then(|name| scan.projects.iter().find(|p| p.name == name)) {
        c.project_skills = p.skills.len();
        c.project_tokens = p.skills.iter().map(|s| s.description_tokens).sum();
    }
    c.open_paths = open_paths(scan);
    c
}

/// **열린 길** — 훅이나 지침이 실제로 부르는 글로벌 스킬 수.
///
/// 스킬→스킬 참조는 세지 않는다. 그 스킬이 먼저 열려야 이어지므로 시작점이 못 된다.
fn open_paths(scan: &Scan) -> usize {
    use std::collections::BTreeSet;
    let names: BTreeSet<&str> = scan.global.skills.iter().map(|s| s.name.as_str()).collect();
    scan.edges
        .iter()
        .filter(|e| matches!(e.kind, EdgeKind::HookTriggers | EdgeKind::DocDirects))
        .map(|e| e.to.as_str())
        .filter(|to| names.contains(to))
        .collect::<BTreeSet<_>>()
        .len()
}

/// 청사진을 적용하면 어떻게 되는지 **계산만** 한다. 파일은 건드리지 않는다.
pub fn preview(scan: &Scan, bp: &Blueprint, project: Option<&str>) -> Delta {
    let before = counts_of(scan, project);
    let mut after = before;
    let mut accepted = vec![];
    let mut rejected = vec![];
    // 같은 대상에 두 번 적용되지 않게 한다 — 두 번 끄면 토큰이 두 번 줄어드는 오류가 난다.
    let mut touched: Vec<(Kind, Scope, String)> = vec![];

    for it in &bp.intents {
        let key = match it {
            Intent::Disable { kind, scope, name } | Intent::Enable { kind, scope, name } => {
                (*kind, *scope, name.clone())
            }
            Intent::MoveScope {
                kind, name, from, ..
            } => (*kind, *from, name.clone()),
            // 훅과 지침은 다른 길이라 **같은 스킬에 둘 다 놓을 수 있다.**
            // 그래서 키에 종류를 섞어 서로를 막지 않게 한다.
            Intent::LinkHook { skill, .. } => (Kind::Skill, Scope::Global, format!("hook:{skill}")),
            Intent::LinkDoc { skill, scope } => (Kind::Skill, *scope, format!("doc:{skill}")),
            Intent::CreateSkill { name, scope, .. } => (Kind::Skill, *scope, format!("new:{name}")),
            Intent::RemoveLink { path } => (
                Kind::Skill,
                Scope::Global,
                format!("link:{}", path.display()),
            ),
        };
        if touched.contains(&key) {
            rejected.push(Rejected {
                intent: it.clone(),
                reason: format!("{} 은 이미 이 청사진에서 한 번 다뤘다", it.name()),
            });
            continue;
        }

        match check(scan, it, project) {
            Err(reason) => rejected.push(Rejected {
                intent: it.clone(),
                reason,
            }),
            Ok(tokens) => {
                touched.push(key);
                apply_counts(&mut after, it, tokens);
                accepted.push(it.clone());
            }
        }
    }
    Delta {
        before,
        after,
        accepted,
        rejected,
    }
}

/// 이 의도가 말이 되는가. 되면 대상의 토큰 수를 준다.
fn check(scan: &Scan, it: &Intent, project: Option<&str>) -> Result<usize, String> {
    // v1 에서 켜고 끄는 것이 열린 종류는 스킬뿐이다(ADR-0004). 나머지는 아직 계산하지 않는다.
    if it.kind() != Kind::Skill {
        return Err(format!("{:?} 는 아직 청사진이 다루지 않는다", it.kind()));
    }
    let g = &scan.global;
    let find_global = |n: &str| g.skills.iter().find(|s| s.name == n);
    let find_disabled = |n: &str| g.disabled_skills.iter().find(|s| s.name == n);
    let find_project = |n: &str| {
        project
            .and_then(|p| scan.projects.iter().find(|x| x.name == p))
            .and_then(|p| p.skills.iter().find(|s| s.name == n))
    };

    match it {
        Intent::Disable {
            scope: Scope::Global,
            name,
            ..
        } => match find_global(name) {
            Some(s) => Ok(s.description_tokens),
            None if find_disabled(name).is_some() => Err(format!("{name} 은 이미 꺼져 있다")),
            None => Err(format!("글로벌에 {name} 이 없다")),
        },
        Intent::Disable {
            scope: Scope::Project,
            name,
            ..
        } => match find_project(name) {
            Some(s) => Ok(s.description_tokens),
            None => Err(format!("이 프로젝트에 {name} 이 없다")),
        },
        Intent::Enable { name, .. } => match find_disabled(name) {
            Some(s) => Ok(s.description_tokens),
            None if find_global(name).is_some() => Err(format!("{name} 은 이미 켜져 있다")),
            None => Err(format!("꺼둔 것 중에 {name} 이 없다")),
        },
        Intent::MoveScope {
            name,
            from: Scope::Global,
            to: Scope::Project,
            project: p,
            ..
        } => {
            // 대상 프로젝트에 같은 이름이 이미 있으면 옮길 수 없다 — 덮어쓰면 남의 것이 사라진다.
            if let Some(pr) = scan.projects.iter().find(|x| &x.name == p) {
                if pr.skills.iter().any(|s| &s.name == name) {
                    return Err(format!("{p} 에 이미 {name} 이 있다"));
                }
            } else {
                return Err(format!("{p} 라는 프로젝트를 못 찾았다"));
            }
            find_global(name)
                .map(|s| s.description_tokens)
                .ok_or_else(|| format!("글로벌에 {name} 이 없다"))
        }
        Intent::MoveScope {
            name,
            from: Scope::Project,
            to: Scope::Global,
            ..
        } => {
            if find_global(name).is_some() {
                return Err(format!("글로벌에 이미 {name} 이 있다"));
            }
            find_project(name)
                .map(|s| s.description_tokens)
                .ok_or_else(|| format!("이 프로젝트에 {name} 이 없다"))
        }
        Intent::MoveScope { from, to, .. } if from == to => {
            Err("같은 스코프로는 옮길 수 없다".into())
        }
        Intent::MoveScope { .. } => Err("글로벌 ↔ 프로젝트 이동만 된다".into()),

        Intent::LinkHook {
            skill,
            words,
            event,
        } => {
            if find_global(skill).is_none() && find_project(skill).is_none() {
                return Err(format!("{skill} 이라는 스킬이 없다"));
            }
            // 낱말이 없으면 어떤 말에도 안 걸린다 — 길을 놓은 게 아니라 죽은 코드를 넣는 것이다.
            if words.iter().all(|w| w.trim().is_empty()) {
                return Err(format!("{skill} 에 등록할 낱말이 비어 있다"));
            }
            if event.trim().is_empty() {
                return Err(format!("{skill} 을 어느 훅 이벤트에 붙일지가 없다"));
            }
            if already_linked(scan, skill, EdgeKind::HookTriggers) {
                return Err(format!("{skill} 은 이미 훅이 부른다"));
            }
            Ok(0) // 길 놓기는 토큰을 바꾸지 않는다
        }
        Intent::CreateSkill {
            name,
            description,
            scope,
            project: proj,
        } => {
            let n = name.trim();
            if n.is_empty() {
                return Err("스킬 이름이 비어 있다".into());
            }
            // 폴더 이름이 되므로 경로 문자가 들어가면 안 된다.
            if !n
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                return Err(format!(
                    "{n} 은 스킬 이름으로 쓸 수 없다 — 영숫자·하이픈·밑줄만 된다"
                ));
            }
            if description.trim().is_empty() {
                return Err(format!(
                    "{n} 의 설명이 비어 있다 — 설명이 없으면 자동으로 안 열린다"
                ));
            }
            match scope {
                Scope::Global => {
                    if find_global(n).is_some() || find_disabled(n).is_some() {
                        return Err(format!("글로벌에 이미 {n} 이 있다"));
                    }
                }
                Scope::Project => {
                    let Some(pn) = proj.as_deref().or(project) else {
                        return Err(format!("{n} 을 어느 프로젝트에 만들지가 없다"));
                    };
                    let Some(p) = scan.projects.iter().find(|p| p.name == pn) else {
                        return Err(format!("{pn} 라는 프로젝트가 없다"));
                    };
                    if p.skills.iter().any(|s| s.name == n) {
                        return Err(format!("{pn} 에 이미 {n} 이 있다"));
                    }
                }
            }
            // 만들면 **설명만큼 토큰이 는다.** 그 값을 미리 보여야 결정이 된다.
            Ok(crate::estimate_tokens(description))
        }
        Intent::RemoveLink { path } => {
            // 실제로 깨져 있는지 다시 본다 — 담아둔 사이에 고쳐졌을 수 있다.
            let listed = scan
                .global
                .links
                .iter()
                .chain(scan.projects.iter().flat_map(|p| p.links.iter()))
                .any(|l| &l.path == path && !l.alive);
            if !listed {
                return Err(format!(
                    "{} 는 깨진 링크가 아니다 — 이미 고쳐졌을 수 있다",
                    path.display()
                ));
            }
            Ok(0)
        }
        Intent::LinkDoc { skill, .. } => {
            if find_global(skill).is_none() && find_project(skill).is_none() {
                return Err(format!("{skill} 이라는 스킬이 없다"));
            }
            if already_linked(scan, skill, EdgeKind::DocDirects) {
                return Err(format!("{skill} 은 이미 지침이 가리킨다"));
            }
            Ok(0)
        }
    }
}

/// 이미 그 종류의 길이 놓여 있나. 두 번 놓으면 훅이 같은 스킬을 두 번 환기한다.
fn already_linked(scan: &Scan, skill: &str, kind: EdgeKind) -> bool {
    scan.edges.iter().any(|e| e.kind == kind && e.to == skill)
}

fn apply_counts(c: &mut Counts, it: &Intent, tokens: usize) {
    match it {
        Intent::Disable {
            scope: Scope::Global,
            ..
        } => {
            c.global_skills = c.global_skills.saturating_sub(1);
            c.global_tokens = c.global_tokens.saturating_sub(tokens);
        }
        Intent::Disable {
            scope: Scope::Project,
            ..
        } => {
            c.project_skills = c.project_skills.saturating_sub(1);
            c.project_tokens = c.project_tokens.saturating_sub(tokens);
        }
        Intent::Enable { .. } => {
            c.global_skills += 1;
            c.global_tokens += tokens;
        }
        // 내리면 **매 세션 비용에서 빠지고** 그 프로젝트에서만 든다. 이게 절감의 핵심이다.
        Intent::MoveScope {
            from: Scope::Global,
            ..
        } => {
            c.global_skills = c.global_skills.saturating_sub(1);
            c.global_tokens = c.global_tokens.saturating_sub(tokens);
            c.project_skills += 1;
            c.project_tokens += tokens;
        }
        Intent::MoveScope {
            from: Scope::Project,
            ..
        } => {
            c.project_skills = c.project_skills.saturating_sub(1);
            c.project_tokens = c.project_tokens.saturating_sub(tokens);
            c.global_skills += 1;
            c.global_tokens += tokens;
        }
        // 길을 놓아도 토큰은 그대로다. **느는 건 열린 길이다** —
        // 그래서 화면이 두 수치를 나란히 보여줘야 한다.
        Intent::LinkHook { .. } | Intent::LinkDoc { .. } => c.open_paths += 1,
        // 만들면 **비용이 는다.** 빼기만 보여주면 결정이 한쪽으로 기운다.
        Intent::CreateSkill {
            scope: Scope::Global,
            ..
        } => {
            c.global_skills += 1;
            c.global_tokens += tokens;
        }
        Intent::CreateSkill { .. } => {
            c.project_skills += 1;
            c.project_tokens += tokens;
        }
        // 링크를 치워도 토큰·길은 안 바뀐다. 깨진 것이 사라질 뿐이다.
        Intent::RemoveLink { .. } => {}
    }
}

// ── 저장 ────────────────────────────────────────────────────────────
//
// 청사진은 **며칠 남는다.** 담아두고 보다가 적용하는 게 실제 쓰임이라
// (v3 규칙), 앱을 껐다 켜도 살아 있어야 한다.
//
// **다시 검증하는 별도 로직은 없다.** 담아둔 사이에 하네스가 바뀌었으면
// `preview()` 를 다시 돌리면 그만이고, 무효가 된 의도는 `rejected` 에 이유와 함께 나온다 —
// 그게 곧 "이제 못 하는 것" 표시다. 조용히 지우지 않는 이유이기도 하다.

/// 작업 하나 — **대화와 그때 담은 청사진이 한 벌**이다.
///
/// 오늘 스킬 얘기를 하다 내일로 미루고, 내일 다른 걸 하다가 어제 것을 다시 여는 게
/// 실제 쓰임이다(사용자가 지적). 그러려면 대화와 청사진이 따로 놀면 안 된다 —
/// "그때 무슨 얘기 끝에 이걸 담았는지"가 사라지면 며칠 뒤엔 못 알아본다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Work {
    pub id: String,
    /// 목록에서 알아볼 이름. 비어 있으면 첫 질문에서 만든다.
    pub title: String,
    #[serde(default)]
    pub chat: Vec<ChatLine>,
    /// 마지막으로 손댄 시각(epoch **밀리초**). 목록을 최근 순으로 놓는다.
    /// 초 단위로 두면 같은 초에 저장된 둘의 순서가 안 갈린다 — 실제로 그렇게 됐다.
    #[serde(default)]
    pub updated: u64,
}

/// 대화 한 줄.
///
/// **담긴 것도 대화의 한 줄이다.** 별도 목록으로 두면 "언제 무슨 얘기 끝에 담았는지"가
/// 사라지고, 같은 걸 두 곳에 그리게 된다(실측: 칩·탭·읽어보기 세 군데에 그리다
/// 구조를 못 알아보게 됐다).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatLine {
    /// `me` 사람 · `ai` AI · `act` 조작 기록 · `err` 실패 · `chip` 담긴 것
    pub kind: String,
    pub text: String,
    /// `chip` 일 때 무엇을 담았는지.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent: Option<Intent>,
    /// 이 말이 **가리킨 것들**. 사람이 문장 안에 끼워 넣은 칩이다.
    /// 글로만 남기면 다시 열었을 때 칩이었다는 사실이 사라진다 — 무엇을 짚어
    /// 물었는지가 안 보이면 답이 왜 그렇게 나왔는지도 안 읽힌다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chips: Vec<Intent>,
}

impl Work {
    pub fn new(id: String) -> Self {
        Work {
            id,
            title: String::new(),
            chat: vec![],
            updated: now(),
        }
    }
    /// 담긴 것 — **대화에 박힌 칩에서 뽑는다.**
    ///
    /// 따로 들고 있으면 두 곳이 어긋난다. 대화가 곧 순서이고 곧 목록이다.
    pub fn blueprint(&self) -> Blueprint {
        Blueprint {
            intents: self.chat.iter().filter_map(|c| c.intent.clone()).collect(),
        }
    }

    /// 제목이 없으면 첫 사람 말에서 만든다. 없으면 담긴 것에서.
    pub fn label(&self) -> String {
        if !self.title.trim().is_empty() {
            return self.title.clone();
        }
        if let Some(first) = self.chat.iter().find(|c| c.kind == "me") {
            return first.text.chars().take(24).collect();
        }
        let bp = self.blueprint();
        if let Some(i) = bp.intents.first() {
            return format!("{} 외 {}건", i.name(), bp.intents.len());
        }
        "새 작업".into()
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 한 프로젝트의 작업들.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Desk {
    #[serde(default)]
    pub works: Vec<Work>,
}

/// 작업은 **파일 하나에 모아 담는다.** 경로를 파일 이름으로 쓰지 않는다 —
/// macOS 파일시스템은 대소문자를 안 가려서 `/dev/Thing` 과 `/dev/thing` 이
/// 같은 파일이 된다. 그런데 Claude Code 는 그 둘을 **다른 프로젝트로 등록**한다
/// (이 저장소의 알려진 함정 2번이고, 실측에서 실제로 그런 등록이 있었다).
/// 경로를 JSON 키로 두면 대소문자가 그대로 살아 갈리지 않는다.
fn store_file(home: &Path) -> PathBuf {
    home.join(".claude/.harnitor/blueprints.json")
}

type Store = std::collections::BTreeMap<String, Desk>;

fn key_of(project: Option<&Path>) -> String {
    project
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "_global".into())
}

fn read_store(home: &Path) -> Store {
    std::fs::read_to_string(store_file(home))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 이 프로젝트의 작업들. 없거나 깨졌으면 **빈 것**을 준다 —
/// 저장 파일 하나 때문에 화면이 안 뜨면 안 된다(절대원칙 9).
pub fn load_desk(home: &Path, project: Option<&Path>) -> Desk {
    let mut d = read_store(home)
        .remove(&key_of(project))
        .unwrap_or_default();
    // 최근 손댄 것이 위로. 며칠 전 것을 찾을 때 그게 순서다.
    // 안정 정렬이라 시각이 같으면 저장 순서(맨 앞이 최근)가 그대로 유지된다.
    d.works.sort_by(|a, b| b.updated.cmp(&a.updated));
    d
}

/// 통째로 저장한다. 작업이 하나도 없으면 그 자리를 지운다.
pub fn save_desk(home: &Path, project: Option<&Path>, desk: &Desk) -> std::io::Result<()> {
    let mut store = read_store(home);
    let key = key_of(project);
    if desk.works.is_empty() {
        store.remove(&key);
    } else {
        store.insert(key, desk.clone());
    }
    let file = store_file(home);
    if store.is_empty() {
        if file.exists() {
            std::fs::remove_file(&file)?;
        }
        return Ok(());
    }
    if let Some(d) = file.parent() {
        std::fs::create_dir_all(d)?;
    }
    let body = serde_json::to_string_pretty(&store)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(file, body)
}

/// 작업 하나를 넣거나 갈아 끼운다. **손댄 시각을 여기서 찍는다** —
/// 화면이 매번 챙기게 하면 빠뜨린 자리가 생긴다.
pub fn put_work(home: &Path, project: Option<&Path>, mut s: Work) -> std::io::Result<()> {
    let mut desk = load_desk(home, project);
    s.updated = now();
    desk.works.retain(|x| x.id != s.id);
    // **맨 앞에 넣는다.** 시각만으로 정렬하면 같은 밀리초에 저장된 둘의 순서가
    // 안 갈린다(실측에서 실제로 어긋났다) — 방금 손댄 것이 늘 위여야 한다.
    desk.works.insert(0, s);
    save_desk(home, project, &desk)
}

/// 작업을 닫는다. **되돌릴 수 없다** — 화면이 먼저 물어야 한다.
pub fn close_work(home: &Path, project: Option<&Path>, id: &str) -> std::io::Result<()> {
    let mut desk = load_desk(home, project);
    desk.works.retain(|s| s.id != id);
    save_desk(home, project, &desk)
}

// ── 의도 → 쓰기 계획 ────────────────────────────────────────────────
//
// 청사진은 **무엇을 하고 싶은가**이고 `write::Plan` 은 **어느 파일을 어떻게 건드리는가**다.
// 둘을 갈라 두는 이유는 청사진이 며칠 남기 때문이다 — 담을 때의 파일 상태와
// 적용할 때의 상태가 다를 수 있어서, 계획은 **적용 직전에** 만들어야 한다.

/// 의도 하나를 쓰기 계획으로 바꾼다.
///
/// 아직 쓰기가 없는 의도는 `Refused` 로 돌려준다 — 조용히 건너뛰면
/// 사람은 적용된 줄 안다.
pub fn to_plan(
    scan: &Scan,
    home: &Path,
    it: &Intent,
    project_path: Option<&Path>,
) -> crate::write::Result<crate::write::Plan> {
    use crate::write::{self, WriteError};
    match it {
        Intent::Disable { scope, name, .. } => write::plan_disable_skill(
            scan,
            name,
            match scope {
                Scope::Global => None,
                Scope::Project => project_path,
            },
        ),
        Intent::Enable { name, .. } => write::plan_enable_skill(home, name, scan.lang),
        Intent::LinkHook {
            skill,
            words,
            event,
        } => {
            let hook = scan
                .global
                .hooks
                .iter()
                .filter(|h| &h.event == event)
                .find_map(|h| write::hook_script_of(&h.command, home))
                .ok_or_else(|| {
                    WriteError::NotFound(format!("{event} 에 걸린 훅 스크립트를 못 찾았다"))
                })?;
            write::plan_link_hook(home, &hook, skill, words, scan.lang)
        }
        Intent::MoveScope {
            name, to, project, ..
        } => {
            // AI 는 프로젝트를 **이름**으로 준다(프롬프트가 그렇게 시킨다). 경로로 바꾼다.
            let p = scan
                .projects
                .iter()
                .find(|p| &p.name == project || p.path.to_string_lossy() == project.as_str())
                .ok_or_else(|| WriteError::NotFound(format!("{project} 라는 프로젝트가 없다")))?;
            write::plan_move_scope(scan, name, &p.path, *to == Scope::Global, scan.lang)
        }
        Intent::CreateSkill {
            name,
            scope,
            project: proj,
            ..
        } => {
            let dir = match scope {
                Scope::Global => home.join(".claude/skills").join(name),
                Scope::Project => {
                    let pn = proj.as_deref().unwrap_or_default();
                    let p = scan.projects.iter().find(|p| p.name == pn).ok_or_else(|| {
                        WriteError::NotFound(format!("{pn} 라는 프로젝트가 없다"))
                    })?;
                    p.path.join(".claude/skills").join(name)
                }
            };
            // 파일을 만드는 계획이 아니다 — 만들 자리만 정해 넘긴다(위 주석 참조).
            Err(WriteError::Refused(format!(
                "{name} 만들기는 skill-creator 가 한다 — 청사진 화면에서 실행한다 ({})",
                dir.display()
            )))
        }
        Intent::RemoveLink { path } => write::plan_remove_link(home, path, scan.lang),
        Intent::LinkDoc { .. } => Err(WriteError::Refused(
            "지침에 넣기는 아직 쓰기가 없다 — CLAUDE.md 는 사람이 쓴 산문이라 자리를 정하기 어렵다"
                .into(),
        )),
    }
}

/// 고른 것만 계획으로 바꾼다. **일부만 적용할 수 있어야 한다**(v3 규칙) —
/// 전부 아니면 전무보다 실제 쓰임에 맞다.
///
/// 되는 것과 안 되는 것을 **같이** 돌려준다. 하나가 막혀도 나머지는 간다(절대원칙 9).
pub fn to_plans(
    scan: &Scan,
    home: &Path,
    bp: &Blueprint,
    pick: &[usize],
    project_path: Option<&Path>,
) -> (Vec<crate::write::Plan>, Vec<Rejected>) {
    let mut plans = vec![];
    let mut rejected = vec![];
    for &i in pick {
        let Some(it) = bp.intents.get(i) else {
            continue;
        };
        match to_plan(scan, home, it, project_path) {
            Ok(p) => plans.push(p),
            Err(e) => rejected.push(Rejected {
                intent: it.clone(),
                reason: e.to_string(),
            }),
        }
    }
    (plans, rejected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn skill(name: &str, tokens: usize) -> Skill {
        Skill {
            name: name.into(),
            description: format!("{name} 설명"),
            path: format!("/fake/{name}").into(),
            reference_count: 0,
            is_symlink: false,
            description_tokens: tokens,
            body: None,
        }
    }

    /// 글로벌 스킬 3개(100/200/300) + 프로젝트 스킬 1개(50)인 하네스.
    fn scan_with(global: Vec<Skill>, proj: Vec<Skill>) -> Scan {
        let mut s = Scan::default();
        s.global.skills = global;
        // `Project` 에 Default 를 달지 않는다 — 빈 프로젝트가 유효한 상태가 아니라서,
        // 프로덕션 타입에 의미 없는 기본값을 붙이면 실수로 그게 쓰인다.
        s.projects.push(Project {
            name: "demo".into(),
            path: "/fake/demo".into(),
            is_git: true,
            has_claude_md: false,
            has_claude_local_md: false,
            skills: proj,
            knowledge: vec![],
            mcp: vec![],
            hooks: vec![],
            links: vec![],
            duplicate_paths: vec![],
            last_commit: None,
            disabled_mcp: vec![],
        });
        s
    }

    fn base() -> Scan {
        scan_with(
            vec![skill("alpha", 100), skill("beta", 200), skill("gamma", 300)],
            vec![skill("local-only", 50)],
        )
    }

    #[test]
    fn 빈_청사진은_아무것도_바꾸지_않는다() {
        let s = base();
        let d = preview(&s, &Blueprint::default(), Some("demo"));
        assert_eq!(d.before, d.after);
        assert_eq!(d.tokens_saved(), 0);
        assert!(d.accepted.is_empty() && d.rejected.is_empty());
    }

    #[test]
    fn 스킬을_끄면_그만큼_토큰이_준다() {
        let s = base();
        let bp = Blueprint {
            intents: vec![Intent::Disable {
                kind: Kind::Skill,
                scope: Scope::Global,
                name: "beta".into(),
            }],
        };
        let d = preview(&s, &bp, Some("demo"));
        assert_eq!(d.before.global_tokens, 600);
        assert_eq!(d.after.global_tokens, 400, "beta 의 200 만 빠져야 한다");
        assert_eq!(d.after.global_skills, 2);
        assert_eq!(d.tokens_saved(), 200);
        assert!(d.rejected.is_empty());
    }

    #[test]
    fn 여러_개를_끄면_합산된다() {
        let s = base();
        let bp = Blueprint {
            intents: ["alpha", "gamma"]
                .iter()
                .map(|n| Intent::Disable {
                    kind: Kind::Skill,
                    scope: Scope::Global,
                    name: n.to_string(),
                })
                .collect(),
        };
        let d = preview(&s, &bp, Some("demo"));
        assert_eq!(d.tokens_saved(), 400);
        assert_eq!(d.after.global_skills, 1);
    }

    /// 같은 것을 두 번 끄면 토큰이 두 번 줄어드는 오류가 난다. 두 번째는 거절한다.
    #[test]
    fn 같은_것을_두_번_끄지_않는다() {
        let s = base();
        let one = Intent::Disable {
            kind: Kind::Skill,
            scope: Scope::Global,
            name: "beta".into(),
        };
        let bp = Blueprint {
            intents: vec![one.clone(), one],
        };
        let d = preview(&s, &bp, Some("demo"));
        assert_eq!(d.tokens_saved(), 200, "두 번 빠지면 안 된다");
        assert_eq!(d.accepted.len(), 1);
        assert_eq!(d.rejected.len(), 1);
    }

    /// **프로젝트로 내리는 것이 절감의 핵심이다** — 매 세션 비용에서 빠지고
    /// 그 프로젝트에서만 든다.
    #[test]
    fn 프로젝트로_내리면_매_세션_비용에서_빠진다() {
        let s = base();
        let bp = Blueprint {
            intents: vec![Intent::MoveScope {
                kind: Kind::Skill,
                name: "gamma".into(),
                from: Scope::Global,
                to: Scope::Project,
                project: "demo".into(),
            }],
        };
        let d = preview(&s, &bp, Some("demo"));
        assert_eq!(d.after.global_tokens, 300, "글로벌에서 300 이 빠진다");
        assert_eq!(
            d.after.project_tokens, 350,
            "프로젝트에서는 든다 (50 + 300)"
        );
        assert_eq!(d.tokens_saved(), 300);
    }

    #[test]
    fn 없는_스킬은_이유와_함께_거절한다() {
        let s = base();
        let bp = Blueprint {
            intents: vec![Intent::Disable {
                kind: Kind::Skill,
                scope: Scope::Global,
                name: "nope".into(),
            }],
        };
        let d = preview(&s, &bp, Some("demo"));
        assert!(d.accepted.is_empty());
        assert_eq!(d.rejected.len(), 1);
        assert!(
            d.rejected[0].reason.contains("nope"),
            "무엇이 문제인지 이름이 들어 있어야 한다: {}",
            d.rejected[0].reason
        );
        assert_eq!(d.before, d.after, "거절된 의도는 수치를 바꾸지 않는다");
    }

    /// 이름이 겹치는 곳으로 내리면 **남의 것이 덮인다.** 막는다.
    #[test]
    fn 이름이_겹치는_프로젝트로는_못_내린다() {
        let s = scan_with(vec![skill("dup", 100)], vec![skill("dup", 10)]);
        let bp = Blueprint {
            intents: vec![Intent::MoveScope {
                kind: Kind::Skill,
                name: "dup".into(),
                from: Scope::Global,
                to: Scope::Project,
                project: "demo".into(),
            }],
        };
        let d = preview(&s, &bp, Some("demo"));
        assert_eq!(d.rejected.len(), 1);
        assert!(d.rejected[0].reason.contains("이미"));
    }

    /// 하나가 틀려도 나머지는 계산된다(절대원칙 9: 부분 실패로 전체가 죽지 않는다).
    #[test]
    fn 틀린_의도가_섞여도_나머지는_계산된다() {
        let s = base();
        let bp = Blueprint {
            intents: vec![
                Intent::Disable {
                    kind: Kind::Skill,
                    scope: Scope::Global,
                    name: "nope".into(),
                },
                Intent::Disable {
                    kind: Kind::Skill,
                    scope: Scope::Global,
                    name: "alpha".into(),
                },
            ],
        };
        let d = preview(&s, &bp, Some("demo"));
        assert_eq!(d.accepted.len(), 1);
        assert_eq!(d.rejected.len(), 1);
        assert_eq!(d.tokens_saved(), 100);
    }

    fn link(skill: &str) -> Intent {
        Intent::LinkHook {
            skill: skill.into(),
            words: vec!["엠씨피".into(), "mcp".into()],
            event: "UserPromptSubmit".into(),
        }
    }

    /// 길을 놓아도 **토큰은 안 준다.** 느는 건 열린 길이다 —
    /// 화면이 두 수치를 나란히 보여줘야 하는 이유다.
    #[test]
    fn 길을_놓으면_토큰이_아니라_열린_길이_는다() {
        let s = base();
        let d = preview(
            &s,
            &Blueprint {
                intents: vec![link("alpha")],
            },
            Some("demo"),
        );
        assert_eq!(d.tokens_saved(), 0, "길 놓기는 토큰을 안 바꾼다");
        assert_eq!(d.after.open_paths, d.before.open_paths + 1);
        assert_eq!(d.accepted.len(), 1);
    }

    #[test]
    fn 없는_스킬에는_길을_못_놓는다() {
        let s = base();
        let d = preview(
            &s,
            &Blueprint {
                intents: vec![link("nope")],
            },
            Some("demo"),
        );
        assert_eq!(d.rejected.len(), 1);
        assert!(d.rejected[0].reason.contains("nope"));
    }

    /// 낱말이 없으면 어떤 말에도 안 걸린다. 길이 아니라 죽은 코드다.
    #[test]
    fn 낱말이_비면_거절한다() {
        let s = base();
        let bp = Blueprint {
            intents: vec![Intent::LinkHook {
                skill: "alpha".into(),
                words: vec!["  ".into()],
                event: "UserPromptSubmit".into(),
            }],
        };
        let d = preview(&s, &bp, Some("demo"));
        assert_eq!(d.rejected.len(), 1);
        assert!(d.rejected[0].reason.contains("낱말"));
    }

    /// 이미 훅이 부르는 스킬에 또 놓으면 같은 스킬을 두 번 환기한다.
    #[test]
    fn 이미_훅이_부르면_거절한다() {
        let mut s = base();
        s.edges.push(Edge {
            kind: EdgeKind::HookTriggers,
            from: "some-hook.sh".into(),
            from_scope: Scope::Global,
            to: "alpha".into(),
            to_scope: Scope::Global,
            project: None,
            example: false,
        });
        let d = preview(
            &s,
            &Blueprint {
                intents: vec![link("alpha")],
            },
            Some("demo"),
        );
        assert_eq!(d.rejected.len(), 1);
        assert!(d.rejected[0].reason.contains("이미"));
    }

    /// 훅과 지침은 **다른 길**이다. 같은 스킬에 둘 다 놓을 수 있어야 한다 —
    /// 실측에서 가장 많이 쓰이는 스킬들은 둘 다 갖고 있었다.
    #[test]
    fn 훅과_지침은_같은_스킬에_둘_다_놓인다() {
        let s = base();
        let bp = Blueprint {
            intents: vec![
                link("alpha"),
                Intent::LinkDoc {
                    skill: "alpha".into(),
                    scope: Scope::Global,
                },
            ],
        };
        let d = preview(&s, &bp, Some("demo"));
        assert_eq!(d.accepted.len(), 2, "서로 막으면 안 된다: {:?}", d.rejected);
        assert_eq!(d.after.open_paths, d.before.open_paths + 2);
    }

    /// 빼기와 더하기가 한 청사진에 섞여도 각자 제 수치를 움직인다.
    #[test]
    fn 빼기와_더하기가_섞여도_각각_계산된다() {
        let s = base();
        let bp = Blueprint {
            intents: vec![
                Intent::Disable {
                    kind: Kind::Skill,
                    scope: Scope::Global,
                    name: "beta".into(),
                },
                link("alpha"),
            ],
        };
        let d = preview(&s, &bp, Some("demo"));
        assert_eq!(d.tokens_saved(), 200);
        assert_eq!(d.after.open_paths, d.before.open_paths + 1);
        assert_eq!(d.accepted.iter().filter(|i| i.is_link()).count(), 1);
    }
    fn work(id: &str, intents: Vec<Intent>) -> Work {
        let mut chat = vec![ChatLine {
            kind: "me".into(),
            text: "안 쓰는 것 정리해줘".into(),
            intent: None,
            chips: vec![],
        }];
        // 담긴 것은 대화의 한 줄이다
        chat.extend(intents.into_iter().map(|i| ChatLine {
            kind: "chip".into(),
            text: i.name().to_string(),
            intent: Some(i),
            chips: vec![],
        }));
        Work {
            id: id.into(),
            title: String::new(),
            chat,
            updated: 0,
        }
    }

    #[test]
    fn 담았다_읽으면_그대로다() {
        let t = tempfile::tempdir().unwrap();
        let proj = Path::new("/fake/demo");
        put_work(t.path(), Some(proj), work("a", vec![link("alpha")])).unwrap();
        let d = load_desk(t.path(), Some(proj));
        assert_eq!(d.works.len(), 1);
        assert_eq!(d.works[0].blueprint().intents.len(), 1);
        assert_eq!(d.works[0].chat.len(), 2, "사람 말 + 칩");
    }

    #[test]
    fn 담은_적_없으면_빈_책상이다() {
        let t = tempfile::tempdir().unwrap();
        assert!(load_desk(t.path(), None).works.is_empty());
    }

    /// 저장 파일이 깨져도 화면은 떠야 한다(절대원칙 9).
    #[test]
    fn 깨진_저장_파일은_빈_것으로_읽는다() {
        let t = tempfile::tempdir().unwrap();
        let f = t.path().join(".claude/.harnitor/blueprints.json");
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(&f, "{ 이건 JSON 이 아니다").unwrap();
        assert!(load_desk(t.path(), None).works.is_empty());
    }

    /// **여러 작업이 나란히 산다.** 오늘 하다 미룬 것과 내일 새로 여는 것.
    #[test]
    fn 작업_여러_개가_나란히_산다() {
        let t = tempfile::tempdir().unwrap();
        put_work(t.path(), None, work("어제", vec![link("alpha")])).unwrap();
        put_work(t.path(), None, work("오늘", vec![link("beta")])).unwrap();
        let d = load_desk(t.path(), None);
        assert_eq!(d.works.len(), 2);
        // 최근 손댄 것이 위로 — 며칠 전 것을 찾을 때 그게 순서다
        assert_eq!(d.works[0].id, "오늘");
    }

    #[test]
    fn 같은_작업을_다시_담으면_갈아_끼운다() {
        let t = tempfile::tempdir().unwrap();
        put_work(t.path(), None, work("a", vec![link("alpha")])).unwrap();
        put_work(t.path(), None, work("a", vec![link("alpha"), link("beta")])).unwrap();
        let d = load_desk(t.path(), None);
        assert_eq!(d.works.len(), 1, "복제됐다");
        assert_eq!(d.works[0].blueprint().intents.len(), 2);
    }

    #[test]
    fn 닫으면_그것만_사라진다() {
        let t = tempfile::tempdir().unwrap();
        put_work(t.path(), None, work("a", vec![link("alpha")])).unwrap();
        put_work(t.path(), None, work("b", vec![link("beta")])).unwrap();
        close_work(t.path(), None, "a").unwrap();
        let d = load_desk(t.path(), None);
        assert_eq!(d.works.len(), 1);
        assert_eq!(d.works[0].id, "b");
    }

    #[test]
    fn 프로젝트마다_따로_담긴다() {
        let t = tempfile::tempdir().unwrap();
        let a = Path::new("/fake/a");
        put_work(t.path(), Some(a), work("x", vec![link("alpha")])).unwrap();
        assert_eq!(load_desk(t.path(), Some(a)).works.len(), 1);
        assert!(load_desk(t.path(), Some(Path::new("/fake/b")))
            .works
            .is_empty());
        assert!(load_desk(t.path(), None).works.is_empty());
    }

    /// 이름이 같아도 경로가 다르면 다른 책상이다(대소문자만 다른 중복 등록이 실제로 있다).
    #[test]
    fn 이름이_같아도_경로가_다르면_갈린다() {
        let t = tempfile::tempdir().unwrap();
        put_work(
            t.path(),
            Some(Path::new("/Users/me/dev/Thing")),
            work("x", vec![]),
        )
        .unwrap();
        assert!(load_desk(t.path(), Some(Path::new("/users/me/dev/thing")))
            .works
            .is_empty());
    }

    #[test]
    fn 다_닫으면_파일이_사라진다() {
        let t = tempfile::tempdir().unwrap();
        put_work(t.path(), None, work("a", vec![link("alpha")])).unwrap();
        close_work(t.path(), None, "a").unwrap();
        assert!(!t.path().join(".claude/.harnitor/blueprints.json").exists());
    }

    /// 제목이 없으면 첫 사람 말에서 만든다 — 목록에서 알아볼 수 있어야 한다.
    #[test]
    fn 이름이_없으면_첫_말에서_만든다() {
        let s = work("a", vec![]);
        assert_eq!(s.label(), "안 쓰는 것 정리해줘");
        let mut empty = Work::new("b".into());
        assert_eq!(empty.label(), "새 작업");
        empty.chat.push(ChatLine {
            kind: "chip".into(),
            text: "alpha".into(),
            intent: Some(link("alpha")),
            chips: vec![],
        });
        assert!(empty.label().contains("alpha"));
    }

    /// **담아둔 사이에 하네스가 바뀌면** 무효가 된 의도가 이유와 함께 드러나야 한다.
    /// 별도 재검증 로직 없이 preview 를 다시 돌리는 것으로 충분하다는 명세다.
    #[test]
    fn 담아둔_사이에_스킬이_사라지면_이유가_나온다() {
        let t = tempfile::tempdir().unwrap();
        let bp = Blueprint {
            intents: vec![
                Intent::Disable {
                    kind: Kind::Skill,
                    scope: Scope::Global,
                    name: "beta".into(),
                },
                Intent::Disable {
                    kind: Kind::Skill,
                    scope: Scope::Global,
                    name: "alpha".into(),
                },
            ],
        };
        let mut w = Work::new("a".into());
        w.chat = bp
            .intents
            .iter()
            .map(|i| ChatLine {
                kind: "chip".into(),
                text: i.name().into(),
                intent: Some(i.clone()),
                chips: vec![],
            })
            .collect();
        put_work(t.path(), None, w).unwrap();

        // 그 사이 beta 를 손으로 지웠다
        let mut later = base();
        later.global.skills.retain(|s| s.name != "beta");

        let saved = load_desk(t.path(), None).works.remove(0).blueprint();
        let d = preview(&later, &saved, Some("demo"));
        assert_eq!(d.accepted.len(), 1, "멀쩡한 것은 살아야 한다");
        assert_eq!(d.rejected.len(), 1);
        assert!(
            d.rejected[0].reason.contains("beta"),
            "무엇이 문제인지 말해야 한다"
        );
    }
    /// **일부만 적용할 수 있어야 한다**(v3 규칙). 고른 것만 계획이 된다.
    #[test]
    fn 고른_것만_계획이_된다() {
        let t = tempfile::tempdir().unwrap();
        let mut s = base();
        s.global.skills[0].path = t.path().join("skills/alpha");
        std::fs::create_dir_all(&s.global.skills[0].path).unwrap();

        let bp = Blueprint {
            intents: vec![
                Intent::Disable {
                    kind: Kind::Skill,
                    scope: Scope::Global,
                    name: "alpha".into(),
                },
                Intent::Disable {
                    kind: Kind::Skill,
                    scope: Scope::Global,
                    name: "beta".into(),
                },
            ],
        };
        let (plans, rejected) = to_plans(&s, t.path(), &bp, &[0], None);
        assert_eq!(plans.len(), 1, "고른 하나만 계획이 돼야 한다");
        assert!(rejected.is_empty());
    }

    /// 쓰기가 없는 의도는 **조용히 건너뛰지 않는다** — 그러면 적용된 줄 안다.
    /// (스코프 이동은 쓰기가 생겼으므로 이제 남은 건 지침에 넣기뿐이다)
    #[test]
    fn 아직_쓰기가_없는_의도는_이유와_함께_돌아온다() {
        let t = tempfile::tempdir().unwrap();
        let s = base();
        let bp = Blueprint {
            intents: vec![Intent::LinkDoc {
                skill: "alpha".into(),
                scope: Scope::Global,
            }],
        };
        let (plans, rejected) = to_plans(&s, t.path(), &bp, &[0], None);
        assert!(plans.is_empty());
        assert_eq!(rejected.len(), 1);
        assert!(rejected[0].reason.contains("아직"));
    }

    /// 스코프 이동은 이제 실제 계획이 된다 — 절감이 가장 큰 동작이라 먼저 열었다.
    #[test]
    fn 스코프_이동은_계획이_된다() {
        let t = tempfile::tempdir().unwrap();
        let mut s = base();
        // 파일이 실제로 있어야 옮길 계획을 세운다
        let g = t.path().join(".claude/skills/gamma");
        std::fs::create_dir_all(&g).unwrap();
        s.home = t.path().to_path_buf();
        s.global.skills[2].path = g;
        s.projects[0].path = t.path().join("dev/demo");

        let bp = Blueprint {
            intents: vec![Intent::MoveScope {
                kind: Kind::Skill,
                name: "gamma".into(),
                from: Scope::Global,
                to: Scope::Project,
                project: "demo".into(),
            }],
        };
        let (plans, rejected) = to_plans(&s, t.path(), &bp, &[0], None);
        assert_eq!(plans.len(), 1, "계획이 나와야 한다: {rejected:?}");
        assert_eq!(plans[0].token_delta, 300);
    }

    /// 하나가 막혀도 나머지는 계획이 된다(절대원칙 9).
    #[test]
    fn 하나가_막혀도_나머지는_간다() {
        let t = tempfile::tempdir().unwrap();
        let mut s = base();
        s.global.skills[0].path = t.path().join("skills/alpha");
        std::fs::create_dir_all(&s.global.skills[0].path).unwrap();
        let bp = Blueprint {
            intents: vec![
                Intent::LinkDoc {
                    skill: "alpha".into(),
                    scope: Scope::Global,
                },
                Intent::Disable {
                    kind: Kind::Skill,
                    scope: Scope::Global,
                    name: "alpha".into(),
                },
            ],
        };
        let (plans, rejected) = to_plans(&s, t.path(), &bp, &[0, 1], None);
        assert_eq!(plans.len(), 1);
        assert_eq!(rejected.len(), 1);
    }
    #[test]
    fn 스킬이_아닌_종류는_아직_거절한다() {
        let s = base();
        let bp = Blueprint {
            intents: vec![Intent::Disable {
                kind: Kind::Mcp,
                scope: Scope::Global,
                name: "postgres".into(),
            }],
        };
        let d = preview(&s, &bp, Some("demo"));
        assert_eq!(d.rejected.len(), 1);
    }

    /// **가리킨 것은 저장을 건너 살아남아야 한다.** 글로만 남으면 다시 열었을 때
    /// 칩이었다는 사실이 사라져서, 무엇을 짚어 물었는지가 안 읽힌다.
    #[test]
    fn 말이_가리킨_칩은_다시_열어도_남는다() {
        let t = tempfile::tempdir().unwrap();
        let mut w = Work::new("w1".into());
        w.chat.push(ChatLine {
            kind: "me".into(),
            text: "alpha 이거 문제 뭐야?".into(),
            intent: None,
            chips: vec![link("alpha")],
        });
        put_work(t.path(), None, w).unwrap();

        let back = load_desk(t.path(), None);
        assert_eq!(back.works[0].chat[0].chips, vec![link("alpha")]);
        // 가리킨 것은 담은 것이 아니다 — 청사진에 섞이면 안 된다
        assert!(back.works[0].blueprint().intents.is_empty());
    }
}
