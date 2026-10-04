//! 하네스를 고치는 쪽. **ADR-0004의 안전장치가 여기 구현돼 있다.**
//!
//! 규칙은 넷이고 하나도 건너뛸 수 없다:
//! 1. 계획(`plan_*`)은 아무것도 바꾸지 않는다 — 무엇이 바뀔지 먼저 보여주기 위해서다
//! 2. 실행(`apply`)은 **백업을 먼저** 만든다
//! 3. 되돌리기(`undo`)는 마지막 변경을 통째로 취소한다 — 단, **우리가 바꾼 자리만**.
//!    그 사이 남이 쓴 값은 지키고, 같은 자리를 남이 또 바꿨으면 되돌리지 않는다
//! 4. 자동 수정은 없다 — 사람이 누른 계획만 실행된다
//!
//! 되돌리기가 한 번이라도 실패하면 쓰기를 닫는다(ADR-0004 재검토 조건).

use crate::i18n::{pick, Lang};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum WriteError {
    #[error("{0}")]
    NotFound(String),
    #[error("파일을 다루지 못했다: {0}")]
    Io(#[from] std::io::Error),
    #[error("설정을 읽지 못했다: {0}")]
    Json(#[from] serde_json::Error),
    #[error("되돌릴 변경이 없다")]
    NothingToUndo,
    /// 하려면 할 수 있지만 **하지 않기로 한** 경우. 남의 값을 갈아엎는 자리가 여기다.
    #[error("{0}")]
    Refused(String),
}

pub type Result<T> = std::result::Result<T, WriteError>;

/// 파일 하나에 가하는 변경. **되돌릴 수 있는 형태로만 표현한다.**
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Change {
    /// 경로를 옮긴다. 스킬 끄기가 이 형태다 —
    /// Claude Code가 개별 스킬 비활성화를 지원하지 않아 파일을 옮기는 수밖에 없다.
    MovePath { from: PathBuf, to: PathBuf },
    /// JSON 설정의 한 자리를 바꾼다. 플러그인·MCP·훅 토글이 이 형태다.
    EditJson {
        file: PathBuf,
        /// 자리. **점으로 이은 한 줄이 아니라 조각의 목록이다.**
        /// 키에 점이 들어가는 경우가 실제로 있어서(`a.b@market` 같은 플러그인 이름,
        /// 그리고 `projects` 아래의 파일 경로) 한 줄로 이으면 나눌 수가 없다.
        /// 예: `["projects", "/Users/me/dev/x", "disabledMcpServers"]`
        path: Vec<String>,
        /// 새 값. `None` 이면 그 자리를 지운다.
        to: Option<serde_json::Value>,
    },
    /// 텍스트 파일의 **앵커 바로 앞에** 블록을 끼운다. 훅에 길을 놓는 게 이 형태다.
    ///
    /// 통째로 쓰지 않는 이유는 훅 스크립트가 **사용자 소유**라서다. 앵커를 못 찾거나
    /// 여럿이면 실패한다 — 어디에 넣을지 모르는 채로 남의 스크립트를 건드리면
    /// 그 사람의 모든 프롬프트에서 훅이 깨진다.
    InsertText {
        file: PathBuf,
        /// 이 문자열 **바로 앞**에 넣는다. 파일에 정확히 한 번 나와야 한다.
        anchor: String,
        block: String,
    },
    /// 파일을 통째로 쓴다. **Harnitor 가 만든 파일에만** 쓴다.
    ///
    /// 보관함(`.harnitor/disabled/hooks.json`)처럼 우리 것이라면, 형식이 깨져 있을 때
    /// 고쳐 넣기보다 새로 쓰는 게 맞다. 사용자 설정(`settings.json`·`.claude.json`)에는
    /// 절대 쓰지 않는다 — 거기서 모양이 다르면 그건 남의 데이터이고, 갈아엎는 게 아니라
    /// 거절하는 게 맞다.
    WriteJson {
        file: PathBuf,
        value: serde_json::Value,
    },
}

/// 실행 전에 사람에게 보여줄 계획.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub changes: Vec<Change>,
    /// 한 줄 요약. 무엇이 왜 바뀌는지
    pub summary: String,
    /// 이 변경으로 매 세션 아끼는(또는 더 드는) 설명 토큰
    pub token_delta: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub summary: String,
    pub changes: Vec<Change>,
    /// 건드리기 전 파일 통째 사본. 적용한 뒤 **아무도 그 파일을 안 썼으면** 이걸로
    /// 글자 하나 다르지 않게 되돌린다.
    pub saved_files: Vec<(PathBuf, String)>,
    /// 적용 직후 파일 내용. 되돌릴 때 지금 내용과 같으면 "그 사이 아무도 안 썼다"는 뜻이다.
    /// 비어 있으면 이 칸이 생기기 전 백업이다(그때처럼 통째로 되돌린다).
    #[serde(default)]
    pub written: Vec<(PathBuf, String)>,
    /// EditJson 이 바꾼 자리마다 원래 값과 쓴 값. 그 사이 남이 파일을 썼으면
    /// 통째로 덮지 않고 **이 자리들만** 원래 값으로 돌린다.
    ///
    /// `~/.claude.json` 은 Claude Code 가 쉬지 않고 쓴다(팁 기록·새 프로젝트 믿음·MCP 승인).
    /// 통째로 덮으면 그것들이 같이 사라진다 — 2026-10-02 참모 안에서 시험하다 확인했다.
    #[serde(default)]
    pub slots: Vec<Slot>,
}

/// EditJson 한 건이 바꾼 자리.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Slot {
    pub file: PathBuf,
    pub path: Vec<String>,
    /// 바꾸기 전 값. `None` 이면 자리가 없었다(되돌릴 때 지운다)
    pub before: Option<serde_json::Value>,
    /// 우리가 쓴 값. 되돌릴 때 지금 값이 이것과 다르면 남이 또 바꾼 것이다
    pub after: Option<serde_json::Value>,
}

#[derive(Debug)]
pub struct Applied {
    pub backup_dir: PathBuf,
    pub summary: String,
}

/// 백업은 **우리 폴더 안에** 둔다.
///
/// `~/.claude/backups/`는 Claude Code 자신이 쓰는 자리다(실측: `.claude.json.backup.<epoch>`
/// 파일들이 계속 쌓인다). 거기에 섞어 두면 저쪽이 정리할 때 우리 백업이 같이 사라지고,
/// 그러면 되돌리기가 깨진다 — ADR-0004에서 가장 먼저 지켜야 할 것이다.
fn backups_root(home: &Path) -> PathBuf {
    home.join(".claude/.harnitor/backups")
}

fn disabled_root(home: &Path) -> PathBuf {
    // `skills-disabled/` 같은 형제 이름을 쓰지 않는다 —
    // Claude Code가 어떤 경로를 훑는지에 대한 가정을 최소화한다(ADR-0004).
    home.join(".claude/.harnitor/disabled")
}

/// 스킬 하나를 끄는 계획. `project`가 `None`이면 글로벌 스킬이다.
pub fn plan_disable_skill(scan: &crate::Scan, name: &str, project: Option<&Path>) -> Result<Plan> {
    let lang = scan.lang;
    let (skill, scope_label) = match project {
        None => (
            scan.global.skills.iter().find(|s| s.name == name),
            pick(lang, "글로벌", "global"),
        ),
        Some(p) => {
            let proj = scan.projects.iter().find(|x| x.path == p).ok_or_else(|| {
                WriteError::NotFound(pick(
                    lang,
                    &format!("그런 프로젝트가 없다: {}", p.display()),
                    &format!("no such project: {}", p.display()),
                ))
            })?;
            (
                proj.skills.iter().find(|s| s.name == name),
                pick(
                    lang,
                    &format!("프로젝트 {}", proj.name),
                    &format!("project {}", proj.name),
                ),
            )
        }
    };
    let skill = skill.ok_or_else(|| {
        WriteError::NotFound(pick(
            lang,
            &format!("{scope_label} 스코프에 '{name}' 스킬이 없다"),
            &format!("no skill '{name}' in the {scope_label} scope"),
        ))
    })?;

    let home = &scan.home;
    let to = disabled_root(home).join("skills").join(name);
    Ok(Plan {
        summary: {
            let dest = to.strip_prefix(home).unwrap_or(&to).display().to_string();
            pick(lang,
                &format!("{scope_label} 스킬 '{name}'을 끈다 — 폴더를 {dest}로 옮긴다. 파일은 지우지 않는다."),
                &format!("Turn off the {scope_label} skill '{name}' — move its folder to {dest}. Nothing is deleted."))
        },
        token_delta: -(skill.description_tokens as i64),
        changes: vec![Change::MovePath {
            from: skill.path.clone(),
            to,
        }],
    })
}

/// 꺼둔 스킬을 되살리는 계획.
pub fn plan_enable_skill(home: &Path, name: &str, lang: Lang) -> Result<Plan> {
    let from = disabled_root(home).join("skills").join(name);
    if !from.exists() {
        return Err(WriteError::NotFound(pick(
            lang,
            &format!("꺼둔 스킬 중에 '{name}'이 없다"),
            &format!("'{name}' is not among the skills you turned off"),
        )));
    }
    let to = home.join(".claude/skills").join(name);
    Ok(Plan {
        summary: pick(
            lang,
            &format!("스킬 '{name}'을 다시 켠다"),
            &format!("Turn the skill '{name}' back on"),
        ),
        token_delta: 0,
        changes: vec![Change::MovePath { from, to }],
    })
}

/// MCP 서버를 **그 프로젝트에서** 끄거나 켠다.
///
/// **선언 파일을 건드리지 않는다.** Claude Code 가 이미 스위치를 갖고 있어서
/// `~/.claude.json` 의 `projects.<경로>.disabledMcpServers` 배열만 손대면 된다
/// (실측: 24개 프로젝트가 이 방식으로 꺼둔 서버를 갖고 있었다 — `/mcp` 로 끄면 여기 쌓인다).
/// `.mcp.json` 에서 서버를 지우는 쪽은 팀과 공유되는 파일을 바꾸는 일이고,
/// 되돌릴 때 원래 설정을 통째로 복원해야 한다. 스위치가 있는데 파일을 부술 이유가 없다.
///
/// ⚠️ **전역으로 끄는 자리는 없다.** 등록부에 프로젝트별 배열만 있다 —
/// 그래서 이 함수는 "어느 프로젝트에서" 를 반드시 받는다.
pub fn plan_toggle_mcp(
    scan: &crate::Scan,
    project: &Path,
    name: &str,
    enabled: bool,
) -> Result<Plan> {
    let lang = scan.lang;
    let registry = scan.home.join(".claude.json");
    let root: serde_json::Value = if registry.is_file() {
        serde_json::from_str(&std::fs::read_to_string(&registry)?)?
    } else {
        return Err(WriteError::NotFound(pick(
            lang,
            "등록부(~/.claude.json)가 없다",
            "no registry at ~/.claude.json",
        )));
    };

    // 등록부의 키는 **사용자가 그때 친 경로 그대로**다. 우리 쪽 경로는 정규화돼 있어서
    // 그대로 비교하면 대소문자만 다른 등록(실측 1건)에서 빗나간다.
    let want = project.to_string_lossy().to_lowercase();
    let key = root
        .get("projects")
        .and_then(|p| p.as_object())
        .and_then(|m| {
            // **접미사 일치로 넘어가지 않는다.** `/elsewhere/Users/me/app` 도
            // `/Users/me/app` 으로 끝나므로, 못 찾았을 때 그쪽으로 흘러가면
            // 남의 프로젝트 설정을 바꾸게 된다. 못 찾으면 못 찾은 것이다.
            m.keys().find(|k| k.to_lowercase() == want).cloned()
        })
        .ok_or_else(|| {
            WriteError::NotFound(pick(
                lang,
                &format!("등록부에 없는 프로젝트다: {}", project.display()),
                &format!("project is not in the registry: {}", project.display()),
            ))
        })?;

    let mut off: Vec<String> = root
        .get("projects")
        .and_then(|p| p.get(&key))
        .and_then(|p| p.get("disabledMcpServers"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let already = off.iter().any(|x| x == name);
    if enabled {
        off.retain(|x| x != name);
    } else if !already {
        off.push(name.to_string());
        off.sort();
    }

    let short = key.replace(&scan.home.to_string_lossy().to_string(), "~");
    Ok(Plan {
        summary: pick(
            lang,
            &format!(
                "MCP '{name}'을 {}에서 {} — 선언은 그대로 두고 등록부의 스위치만 바꾼다.",
                short,
                if enabled { "다시 켠다" } else { "끈다" }
            ),
            &format!(
                "{} MCP '{name}' in {short} — the declaration stays; only the registry switch changes.",
                if enabled { "Re-enable" } else { "Disable" }
            ),
        ),
        // MCP 는 스킬처럼 설명이 시스템 프롬프트에 실리지 않는다. 재지 않은 것을 0으로 적는다.
        token_delta: 0,
        changes: vec![Change::EditJson {
            file: registry,
            path: vec![
                "projects".into(),
                key,
                "disabledMcpServers".into(),
            ],
            to: Some(serde_json::json!(off)),
        }],
    })
}

/// 플러그인을 켜거나 끈다. **파일을 옮기지 않는다** — `enabledPlugins` 한 줄만 바꾼다.
pub fn plan_toggle_plugin(scan: &crate::Scan, name: &str, enabled: bool) -> Result<Plan> {
    let lang = scan.lang;
    let plugin = scan
        .global
        .plugins
        .iter()
        .find(|p| p.name == name)
        .ok_or_else(|| {
            WriteError::NotFound(pick(
                lang,
                &format!("그런 플러그인이 없다: {name}"),
                &format!("no such plugin: {name}"),
            ))
        })?;

    let tokens: usize = plugin.skills.iter().map(|s| s.description_tokens).sum();
    let delta = if enabled {
        tokens as i64
    } else {
        -(tokens as i64)
    };
    Ok(Plan {
        summary: {
            let n = plugin.skills.len();
            pick(
                lang,
                &format!(
                    "플러그인 '{name}'을 {} — 스킬 {n}개가 함께 {}",
                    if enabled { "켠다" } else { "끈다" },
                    if enabled { "로드된다" } else { "빠진다" }
                ),
                &format!(
                    "{} the plugin '{name}' — its {n} skill(s) {} with it",
                    if enabled { "Enable" } else { "Disable" },
                    if enabled { "load" } else { "drop out" }
                ),
            )
        },
        token_delta: delta,
        changes: vec![Change::EditJson {
            file: scan.home.join(".claude/settings.json"),
            path: vec!["enabledPlugins".into(), name.to_string()],
            to: Some(serde_json::Value::Bool(enabled)),
        }],
    })
}

/// 훅을 끄거나 켠다.
///
/// MCP 와 달리 **Claude Code 에 훅 비활성 스위치가 없다**(`settings.json` 을 다 뒤져도
/// 그런 자리가 없었다). 그래서 스킬 끄기와 같은 방식을 쓴다 —
/// `settings.json` 에서 빼되 `.harnitor/disabled/hooks.json` 에 원본을 그대로 보관하고,
/// 켤 때 거기서 되살린다. **지우는 게 아니라 옮기는 것**이라 되돌릴 수 있다.
///
/// 훅은 `command` 로 가른다. 같은 스크립트가 여러 이벤트에 걸릴 수 있어서
/// 이벤트도 함께 받는다 — 하나만 끄려다 다른 이벤트의 것까지 떼면 안 된다.
pub fn plan_toggle_hook(
    scan: &crate::Scan,
    event: &str,
    command: &str,
    enabled: bool,
) -> Result<Plan> {
    let lang = scan.lang;
    let settings = scan.home.join(".claude/settings.json");
    let stash = disabled_root(&scan.home).join("hooks.json");

    let read = |p: &Path| -> Result<serde_json::Value> {
        Ok(if p.is_file() {
            serde_json::from_str(&std::fs::read_to_string(p)?)?
        } else {
            serde_json::json!({})
        })
    };
    let live = read(&settings)?;
    let mut kept = read(&stash)?;
    // 보관함이 우리가 쓴 모양이 아니면(사람이 손댔거나 깨졌으면) 빈 것으로 보고 시작한다.
    // `kept["hooks"][event] = …` 는 객체가 아닌 값에 쓰면 serde_json 이 패닉한다.
    if !kept.is_object() {
        kept = serde_json::json!({});
    }
    if !kept.get("hooks").map(|h| h.is_object()).unwrap_or(true) {
        kept["hooks"] = serde_json::json!({});
    }

    let groups = |v: &serde_json::Value, ev: &str| -> Vec<serde_json::Value> {
        v.get("hooks")
            .and_then(|h| h.get(ev))
            .and_then(|a| a.as_array())
            .cloned()
            .unwrap_or_default()
    };

    if enabled {
        // 보관해 둔 것에서 되살린다
        let stashed: Vec<serde_json::Value> = kept
            .get("hooks")
            .and_then(|h| h.get(event))
            .and_then(|a| a.as_array())
            .cloned()
            .unwrap_or_default();
        let (mine, rest): (Vec<_>, Vec<_>) = stashed
            .into_iter()
            .partition(|g| group_has_command(g, command));
        if mine.is_empty() {
            return Err(WriteError::NotFound(pick(
                lang,
                &format!("꺼둔 훅 중에 '{command}'가 없다"),
                &format!("'{command}' is not among the hooks you turned off"),
            )));
        }
        let mut now = groups(&live, event);
        now.extend(mine);
        kept["hooks"][event] = serde_json::json!(rest);
        return Ok(Plan {
            summary: pick(
                lang,
                &format!("훅 '{command}'을 {event}에서 다시 켠다"),
                &format!("Turn the hook '{command}' back on for {event}"),
            ),
            token_delta: 0,
            changes: vec![
                Change::EditJson {
                    file: settings,
                    path: vec!["hooks".into(), event.to_string()],
                    to: Some(serde_json::json!(now)),
                },
                Change::WriteJson {
                    file: stash,
                    value: kept,
                },
            ],
        });
    }

    // 끄기 — settings 에서 떼어 보관으로 옮긴다
    let (mine, rest): (Vec<_>, Vec<_>) = groups(&live, event)
        .into_iter()
        .partition(|g| group_has_command(g, command));
    if mine.is_empty() {
        return Err(WriteError::NotFound(pick(
            lang,
            &format!("{event}에 '{command}' 훅이 없다"),
            &format!("no hook '{command}' on {event}"),
        )));
    }
    let mut box_ = kept
        .get("hooks")
        .and_then(|h| h.get(event))
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();
    box_.extend(mine);

    Ok(Plan {
        summary: pick(
            lang,
            &format!("훅 '{command}'을 {event}에서 끈다 — 원본은 .harnitor/disabled/hooks.json 에 남는다."),
            &format!("Turn off the hook '{command}' on {event} — the original is kept in .harnitor/disabled/hooks.json."),
        ),
        token_delta: 0,
        changes: vec![
            Change::EditJson {
                file: settings,
                path: vec!["hooks".into(), event.to_string()],
                to: Some(serde_json::json!(rest)),
            },
            Change::WriteJson {
                file: stash,
                // **`settings.json` 과 같은 모양으로 담는다** — 그래야 스캐너가 훅 파서를
                // 그대로 재사용해 꺼둔 훅도 화면에 띄울 수 있다(절대원칙 1).
                value: {
                    kept["hooks"][event] = serde_json::json!(box_);
                    kept
                },
            },
        ],
    })
}

/// 훅 그룹(`{matcher, hooks:[...]}`) 안에 이 명령이 있나.
fn group_has_command(group: &serde_json::Value, command: &str) -> bool {
    group
        .get("hooks")
        .and_then(|h| h.as_array())
        .map(|a| {
            a.iter()
                .any(|h| h.get("command").and_then(|c| c.as_str()) == Some(command))
        })
        .unwrap_or(false)
}

/// 계획을 실행한다. **백업이 먼저다.**
/// 앵커 바로 앞에 블록을 끼운다. **앵커가 정확히 하나일 때만** 한다.
fn insert_text(file: &Path, anchor: &str, block: &str) -> Result<()> {
    let body = std::fs::read_to_string(file)?;
    match body.matches(anchor).count() {
        1 => {}
        0 => {
            return Err(WriteError::Refused(format!(
                "{} 에서 넣을 자리를 못 찾았다 — 이 훅은 손으로 고쳐야 한다",
                file.display()
            )))
        }
        n => {
            return Err(WriteError::Refused(format!(
                "{} 에 넣을 자리가 {n} 군데라 어디인지 정할 수 없다",
                file.display()
            )))
        }
    }
    std::fs::write(file, body.replacen(anchor, &format!("{block}{anchor}"), 1))?;
    Ok(())
}

/// 훅에 넣을 낱말에서 **위험한 글자를 걸러낸다.**
///
/// 실측(2026-08-31): 낱말을 큰따옴표 안에 그대로 넣었더니
/// 백틱이 **명령 치환으로 실행됐다.** 훅은 매 프롬프트마다 도는 자리라 그대로 두면
/// 임의 명령 실행이 된다. 그래서 두 겹으로 막는다 —
/// ① 여기서 글자를 제한하고 ② 스크립트에는 **작은따옴표**로 넣는다(치환이 없다).
///
/// 정규식 메타문자도 막는다. `(` 하나만 있어도 `grep -E` 가 통째로 실패해서
/// 그 훅의 다른 환기까지 같이 죽는다.
pub fn check_words(words: &[String]) -> Result<Vec<String>> {
    let mut out = vec![];
    for w in words {
        let w = w.trim();
        if w.is_empty() {
            continue;
        }
        if let Some(bad) = w
            .chars()
            .find(|c| !(c.is_alphanumeric() || matches!(c, ' ' | '-' | '_')))
        {
            return Err(WriteError::Refused(format!(
                "낱말 '{w}' 에 쓸 수 없는 글자 '{bad}' 가 있다 — 글자·숫자·공백·하이픈·밑줄만 된다"
            )));
        }
        out.push(w.to_string());
    }
    if out.is_empty() {
        return Err(WriteError::Refused(
            "등록할 낱말이 없다 — 어떤 말에도 안 걸리는 길은 길이 아니다".into(),
        ));
    }
    Ok(out)
}

/// 훅에 낱말을 등록해 스킬이 열리게 한다 — **길 놓기**.
///
/// 훅 스크립트는 사람마다 구조가 다르다. 우리가 아는 건 `out` 을 모아 마지막에 내보내는
/// 규약뿐이라, **그 앵커가 있는 훅에만** 넣는다. 없으면 손으로 고치라고 말한다 —
/// 모르는 구조에 끼워 넣으면 그 사람의 모든 프롬프트에서 훅이 깨진다.
/// 훅 명령줄에서 실제 스크립트 파일을 찾는다. `edges` 의 것을 그대로 쓴다 —
/// 두 곳이 다르게 풀면 "본 것"과 "고치는 것"이 어긋난다.
pub fn hook_script_of(command: &str, home: &Path) -> Option<PathBuf> {
    crate::edges::hook_script_path(command, home)
}

pub fn plan_link_hook(
    home: &Path,
    hook_file: &Path,
    skill: &str,
    words: &[String],
    lang: Lang,
) -> Result<Plan> {
    let words = check_words(words)?;
    if !hook_file.is_file() {
        return Err(WriteError::NotFound(format!(
            "{} 를 찾지 못했다",
            hook_file.display()
        )));
    }
    let body = std::fs::read_to_string(hook_file)?;
    let tag = format!("# (harnitor) {skill}");
    if body.contains(&tag) {
        return Err(WriteError::Refused(format!(
            "{skill} 은 이 훅에 이미 등록돼 있다"
        )));
    }

    // **작은따옴표로 감싼다.** 큰따옴표 안에서는 백틱·$ 가 치환돼 임의 명령이 실행된다
    // (실측 2026-08-31). check_words 가 글자를 걸렀어도 인용 방식으로 한 겹 더 막는다.
    let pattern = words.join("|");
    let block = format!(
        "\n{tag} 환기 — Harnitor 가 등록\n         if printf '%s' \"$prompt\" | grep -qiE '{pattern}'; then\n         \x20 [ -n \"$out\" ] && out=\"$out\n\"\n         \x20 out=\"${{out}}{skill} 신호 감지 → {skill} 스킬을 열어라.\"\nfi\n"
    );

    let _ = home;
    Ok(Plan {
        summary: pick(
            lang,
            &format!("{skill} 을 훅에 등록한다 (낱말 {}개)", words.len()),
            &format!("register {skill} in the hook ({} word(s))", words.len()),
        ),
        changes: vec![Change::InsertText {
            file: hook_file.to_path_buf(),
            anchor: ANCHOR.to_string(),
            block,
        }],
        token_delta: 0,
    })
}

/// 훅 스크립트에서 우리가 아는 유일한 자리 — 모은 `out` 을 내보내기 직전.
pub const ANCHOR: &str = "\n[ -z \"$out\" ] && exit 0";

/// 스킬을 다른 스코프로 옮긴다 — **절감이 가장 큰 동작**.
///
/// 글로벌에서 프로젝트로 내리면 다른 모든 세션에서 사라지고, 그 프로젝트에서는 그대로 쓴다.
/// 끄기와 달리 **기능을 잃지 않는다**.
///
/// 옮기는 것뿐이라 `MovePath` 하나면 되고, 되돌리기도 역방향 이동으로 성립한다.
pub fn plan_move_scope(
    scan: &crate::Scan,
    name: &str,
    to_project: &Path,
    to_global: bool,
    lang: Lang,
) -> Result<Plan> {
    let proj = scan
        .projects
        .iter()
        .find(|p| p.path == to_project)
        .ok_or_else(|| WriteError::NotFound(format!("{} 를 찾지 못했다", to_project.display())))?;

    let (from, to, summary) = if to_global {
        // 프로젝트 → 글로벌
        let s = proj
            .skills
            .iter()
            .find(|s| s.name == name)
            .ok_or_else(|| WriteError::NotFound(format!("{} 에 {name} 이 없다", proj.name)))?;
        if scan.global.skills.iter().any(|g| g.name == name) {
            return Err(WriteError::Refused(format!("글로벌에 이미 {name} 이 있다")));
        }
        let dest = scan.home.join(".claude/skills").join(name);
        (
            s.path.clone(),
            dest,
            pick(
                lang,
                &format!("{name} 을 글로벌로 올린다 — 모든 세션에서 로드된다"),
                &format!("move {name} to global — it will load in every session"),
            ),
        )
    } else {
        // 글로벌 → 프로젝트
        let s = scan
            .global
            .skills
            .iter()
            .find(|s| s.name == name)
            .ok_or_else(|| WriteError::NotFound(format!("글로벌에 {name} 이 없다")))?;
        // 덮어쓰면 남의 것이 사라진다.
        if proj.skills.iter().any(|p| p.name == name) {
            return Err(WriteError::Refused(format!(
                "{} 에 이미 {name} 이 있다",
                proj.name
            )));
        }
        let dest = to_project.join(".claude/skills").join(name);
        (
            s.path.clone(),
            dest,
            pick(
                lang,
                &format!(
                    "{name} 을 {} 로 내린다 — 다른 세션에서는 사라진다",
                    proj.name
                ),
                &format!(
                    "move {name} down to {} — it disappears from other sessions",
                    proj.name
                ),
            ),
        )
    };

    // 토큰은 글로벌 기준으로만 센다. 내리면 매 세션 비용에서 빠진다.
    let tokens = scan
        .global
        .skills
        .iter()
        .chain(proj.skills.iter())
        .find(|s| s.name == name)
        .map(|s| s.description_tokens as i64)
        .unwrap_or(0);

    Ok(Plan {
        changes: vec![Change::MovePath { from, to }],
        summary,
        token_delta: if to_global { -tokens } else { tokens },
    })
}

/// 깨진 심볼릭 링크를 치운다. **지우지 않고 보관함으로 옮긴다**(절대원칙 1).
///
/// 링크가 가리키던 경로가 그 자체로 단서라, 지우면 무엇이 있었는지가 사라진다.
/// `fs::rename` 은 링크를 **링크인 채로** 옮기므로 되돌리면 그대로 살아난다.
pub fn plan_remove_link(home: &Path, link: &Path, lang: Lang) -> Result<Plan> {
    if !link.is_symlink() {
        return Err(WriteError::NotFound(format!(
            "{} 는 심볼릭 링크가 아니다",
            link.display()
        )));
    }
    let name = link
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "link".into());
    let dest = disabled_root(home).join("links").join(&name);
    Ok(Plan {
        changes: vec![Change::MovePath {
            from: link.to_path_buf(),
            to: dest,
        }],
        summary: pick(
            lang,
            &format!("깨진 링크 {name} 을 보관함으로 옮긴다 — 지우지 않는다"),
            &format!("move the dead link {name} to the stash — nothing is deleted"),
        ),
        token_delta: 0,
    })
}

pub fn apply(home: &Path, plan: &Plan) -> Result<Applied> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dir = backups_root(home).join(format!("{stamp}"));
    std::fs::create_dir_all(&dir)?;

    // 1) 건드릴 JSON 파일을 통째로 저장해 둔다
    let mut saved = vec![];
    for c in &plan.changes {
        let file = match c {
            Change::EditJson { file, .. }
            | Change::WriteJson { file, .. }
            | Change::InsertText { file, .. } => Some(file),
            Change::MovePath { .. } => None,
        };
        if let Some(file) = file {
            if file.is_file() {
                saved.push((file.clone(), std::fs::read_to_string(file)?));
            }
        }
    }
    let mut slots = vec![];
    for c in &plan.changes {
        if let Change::EditJson { file, path, to } = c {
            let root = read_json(file)?;
            slots.push(Slot {
                file: file.clone(),
                path: path.clone(),
                before: get_at(&root, path).cloned(),
                after: to.clone(),
            });
        }
    }
    let mut manifest = Manifest {
        summary: plan.summary.clone(),
        changes: plan.changes.clone(),
        saved_files: saved,
        written: vec![],
        slots,
    };
    std::fs::write(
        dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest)?,
    )?;

    // 2) 그다음에야 실제로 바꾼다
    for c in &plan.changes {
        match c {
            Change::MovePath { from, to } => move_path(from, to)?,
            Change::EditJson { file, path, to } => edit_json(file, path, to.clone())?,
            Change::InsertText {
                file,
                anchor,
                block,
            } => insert_text(file, anchor, block)?,
            Change::WriteJson { file, value } => {
                if let Some(dir) = file.parent() {
                    std::fs::create_dir_all(dir)?;
                }
                write_atomic(file, &serde_json::to_string_pretty(value)?)?;
            }
        }
    }
    // 3) 적용 직후 모습을 남긴다 — 되돌릴 때 "그 사이 누가 썼나"를 가르는 기준
    for (file, _) in &manifest.saved_files {
        if let Ok(now) = std::fs::read_to_string(file) {
            manifest.written.push((file.clone(), now));
        }
    }
    std::fs::write(
        dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest)?,
    )?;
    Ok(Applied {
        backup_dir: dir,
        summary: plan.summary.clone(),
    })
}

/// 되돌리기 전에 **무엇이 되돌려지는지** 알려준다.
/// 모르고 누르는 버튼은 안전장치가 아니다.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoPeek {
    pub summary: String,
    pub change_count: usize,
    pub backup_dir: PathBuf,
}

pub fn peek_undo(home: &Path) -> Result<Option<UndoPeek>> {
    let Some(last) = last_backup(home) else {
        return Ok(None);
    };
    let m: Manifest = serde_json::from_str(&std::fs::read_to_string(last.join("manifest.json"))?)?;
    Ok(Some(UndoPeek {
        summary: m.summary,
        change_count: m.changes.len(),
        backup_dir: last,
    }))
}

fn last_backup(home: &Path) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(backups_root(home))
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.join("manifest.json").is_file())
        .collect();
    dirs.sort();
    dirs.pop()
}

/// 마지막 변경을 되돌린다.
pub fn undo(home: &Path) -> Result<String> {
    let last = last_backup(home).ok_or(WriteError::NothingToUndo)?;

    let m: Manifest = serde_json::from_str(&std::fs::read_to_string(last.join("manifest.json"))?)?;

    // 1) 파일마다 되돌릴 내용을 **먼저 다 정한다** — 하나라도 충돌하면 아무것도 안 건드린다
    let mut writes = vec![];
    for (path, saved) in &m.saved_files {
        writes.push((path.clone(), restored(path, saved, &m)?));
    }

    // 2) 역순으로 되돌린다 — 순서가 있는 변경도 안전하게
    for c in m.changes.iter().rev() {
        if let Change::MovePath { from, to } = c {
            move_path(to, from)?;
        }
    }
    for (path, content) in &writes {
        write_atomic(path, content)?;
    }
    // 되돌린 백업은 치운다 — 남겨두면 undo를 두 번 눌렀을 때 같은 걸 또 되돌린다
    std::fs::remove_dir_all(&last)?;
    Ok(m.summary)
}

/// 파일 하나를 되돌린 내용.
///
/// 적용한 뒤 아무도 안 썼으면 저장해 둔 원본 그대로. 누가 썼으면 우리가 바꾼 자리만
/// 원래 값으로 돌리고 나머지(남이 쓴 것)는 둔다. 같은 자리를 남이 또 바꿨으면 거절한다.
fn restored(file: &Path, saved: &str, m: &Manifest) -> Result<String> {
    let now = std::fs::read_to_string(file).ok();
    // `written` 이 없는 옛 백업은 예전처럼 통째로
    let untouched = m.written.is_empty()
        || m.written
            .iter()
            .any(|(p, w)| p == file && now.as_deref() == Some(w.as_str()));
    if untouched {
        return Ok(saved.to_string());
    }
    let changed_meanwhile = || {
        WriteError::Refused(format!(
            "{} 의 바꾼 자리를 그 사이 다른 곳에서 또 바꿨다 — 덮으면 그 변경이 사라져서 되돌리지 않는다. 손으로 고쳐라",
            file.display()
        ))
    };
    let Some(now) = now else {
        return Err(changed_meanwhile());
    };

    let mine: Vec<&Slot> = m.slots.iter().filter(|s| s.file == file).collect();
    if !mine.is_empty() {
        let mut root: serde_json::Value = serde_json::from_str(&now)?;
        for slot in mine.iter().rev() {
            if get_at(&root, &slot.path) != slot.after.as_ref() {
                return Err(changed_meanwhile());
            }
            set_at(&mut root, &slot.path, slot.before.clone())?;
        }
        return Ok(serde_json::to_string_pretty(&root)?);
    }

    let mut text = now;
    let mut ours = false;
    for c in m.changes.iter().rev() {
        match c {
            // 훅 스크립트 — 끼운 블록만 뺀다. 남이 그 블록을 고쳤으면 못 찾으니 거절
            Change::InsertText {
                file: f,
                anchor,
                block,
            } if f == file => {
                let put = format!("{block}{anchor}");
                if text.matches(&put).count() != 1 {
                    return Err(changed_meanwhile());
                }
                text = text.replacen(&put, anchor, 1);
            }
            // 보관함처럼 우리가 만든 파일은 통째로 되돌린다
            Change::WriteJson { file: f, .. } if f == file => ours = true,
            _ => {}
        }
    }
    Ok(if ours { saved.to_string() } else { text })
}

fn read_json(file: &Path) -> Result<serde_json::Value> {
    Ok(if file.is_file() {
        serde_json::from_str(&std::fs::read_to_string(file)?)?
    } else {
        serde_json::json!({})
    })
}

/// 조각 목록으로 자리를 찾아 내려간다. 없거나 객체가 아니면 `None`.
fn get_at<'a>(root: &'a serde_json::Value, path: &[String]) -> Option<&'a serde_json::Value> {
    path.iter().try_fold(root, |v, k| v.as_object()?.get(k))
}

/// 파일을 반쯤 쓴 순간을 남에게 보이지 않게 — 옆에 다 쓴 뒤 이름을 바꿔 끼운다.
/// `~/.claude.json` 은 Claude Code 가 수시로 읽는다. 쓰는 도중에 읽히면 깨진 JSON 이다.
/// 링크면 링크가 가리키는 파일을 바꾼다(링크를 일반 파일로 갈아치우면 dotfiles 연결이 끊긴다).
fn write_atomic(file: &Path, content: &str) -> Result<()> {
    let target = if file.is_symlink() {
        std::fs::canonicalize(file)?
    } else {
        file.to_path_buf()
    };
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut name = target.file_name().unwrap_or_default().to_os_string();
    name.push(".harnitor-tmp");
    let tmp = target.with_file_name(name);
    std::fs::write(&tmp, content)?;
    // 권한을 물려준다 — `~/.claude.json` 은 600 이다. 새 파일 기본 권한(644)으로 바뀌면 남이 읽는다
    if let Ok(meta) = std::fs::metadata(&target) {
        std::fs::set_permissions(&tmp, meta.permissions())?;
    }
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// 경로를 옮긴다. **심볼릭 링크는 링크인 채로** 옮겨야 한다 —
/// 대상을 따라가 복사하면 원본과의 연결이 끊겨 되돌리기가 성립하지 않는다.
/// (`fs::rename`은 링크 자체를 옮긴다)
fn move_path(from: &Path, to: &Path) -> Result<()> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if to.exists() || to.is_symlink() {
        return Err(WriteError::Io(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("옮길 자리에 이미 뭔가 있다: {}", to.display()),
        )));
    }
    std::fs::rename(from, to)?;
    Ok(())
}

fn edit_json(file: &Path, path: &[String], value: Option<serde_json::Value>) -> Result<()> {
    let mut root = read_json(file)?;
    set_at(&mut root, path, value)?;
    // 보관함(`.harnitor/disabled/hooks.json`)처럼 **아직 없는 파일**에 처음 쓰는 경우가 있다 —
    // write_atomic 이 폴더를 만든다.
    write_atomic(file, &serde_json::to_string_pretty(&root)?)
}

/// 조각 목록이 가리키는 자리에 값을 넣는다(`None` 이면 지운다).
fn set_at(
    root: &mut serde_json::Value,
    path: &[String],
    value: Option<serde_json::Value>,
) -> Result<()> {
    let Some((leaf, parents)) = path.split_last() else {
        return Err(WriteError::Refused("바꿀 자리가 비어 있다".into()));
    };

    // 중간 자리가 없으면 만들면서 내려간다. 있는데 객체가 아니면 **건드리지 않는다** —
    // 남의 값을 객체로 갈아치우는 건 고치는 게 아니라 부수는 것이다.
    //
    // ⚠️ `value[key] = …` 로 쓰면 안 된다. serde_json 은 객체가 아닌 값에 문자열로
    // 인덱싱하면 **패닉한다**. 설정 파일이 배열이거나 통째로 깨져 있는 건 실제로 있는 일이라
    // (하네스는 원래 깨진 걸 보러 가는 도구다 — 절대원칙 9) 매번 객체인지 확인하고 내려간다.
    let mut cur = root;
    for key in parents {
        let Some(obj) = cur.as_object_mut() else {
            return Err(WriteError::Refused(format!(
                "'{key}' 로 들어가려는 자리가 객체가 아니다"
            )));
        };
        let slot = obj
            .entry(key.as_str())
            .or_insert_with(|| serde_json::json!({}));
        if !slot.is_object() {
            return Err(WriteError::Refused(format!(
                "'{key}' 가 객체가 아니라 더 들어갈 수 없다"
            )));
        }
        cur = slot;
    }
    let Some(obj) = cur.as_object_mut() else {
        return Err(WriteError::Refused(format!(
            "'{leaf}' 를 쓰려는 자리가 객체가 아니다"
        )));
    };
    match value {
        Some(v) => {
            obj.insert(leaf.clone(), v);
        }
        None => {
            obj.remove(leaf);
        }
    }
    Ok(())
}

#[cfg(test)]
mod link_hook_tests {
    use super::*;

    /// 실제 훅의 최소 형태 — `out` 을 모아 마지막에 내보낸다.
    fn fake_hook(dir: &Path) -> PathBuf {
        let p = dir.join("dev-trigger-prompt.sh");
        std::fs::write(
            &p,
            "#!/usr/bin/env bash\nprompt=\"$1\"\nout=\"\"\n             if printf '%s' \"$prompt\" | grep -qiE '에러|버그'; then\n  out=\"기존 환기\"\nfi\n             \n[ -z \"$out\" ] && exit 0\nprintf '%s' \"$out\"\nexit 0\n",
        )
        .unwrap();
        p
    }

    #[test]
    fn 위험한_글자가_든_낱말은_거절한다() {
        for bad in [
            "백틱`whoami`",
            "따옴표\"있음",
            "괄호(열림",
            "달러$HOME",
            "슬래시/있음",
        ] {
            let e = check_words(&[bad.to_string()]).unwrap_err();
            assert!(matches!(e, WriteError::Refused(_)), "{bad} 를 통과시켰다");
        }
    }

    #[test]
    fn 쓸_수_있는_낱말은_통과한다() {
        let ok = check_words(&[
            "mcp".into(),
            "엠씨피".into(),
            "MCP 서버".into(),
            "안 뜨는".into(),
        ])
        .unwrap();
        assert_eq!(ok.len(), 4);
    }

    #[test]
    fn 낱말이_전부_비면_거절한다() {
        assert!(check_words(&["   ".into(), "".into()]).is_err());
    }

    #[test]
    fn 앵커가_없는_훅은_거절한다() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("weird.sh");
        std::fs::write(&p, "#!/bin/sh\necho 우리가 모르는 구조\n").unwrap();
        let plan = plan_link_hook(t.path(), &p, "x", &["mcp".into()], Lang::Ko).unwrap();
        // 계획은 서지만 실제로 넣을 때 자리를 못 찾아 거절해야 한다
        let e = apply(t.path(), &plan).unwrap_err();
        assert!(
            matches!(e, WriteError::Refused(m) if m.contains("자리")),
            "앵커 없이 넣었다"
        );
    }

    #[test]
    fn 이미_등록된_스킬은_거절한다() {
        let t = tempfile::tempdir().unwrap();
        let p = fake_hook(t.path());
        let plan = plan_link_hook(t.path(), &p, "manage-mcp", &["mcp".into()], Lang::Ko).unwrap();
        apply(t.path(), &plan).unwrap();
        let e = plan_link_hook(t.path(), &p, "manage-mcp", &["mcp".into()], Lang::Ko).unwrap_err();
        assert!(matches!(e, WriteError::Refused(m) if m.contains("이미")));
    }

    /// **끼운 스크립트가 실제로 도는지**까지 본다. 문법이 깨지면 그 사람의
    /// 모든 프롬프트에서 훅이 죽는다 — 픽스처 비교만으로는 못 잡는다.
    #[test]
    fn 끼운_뒤에도_스크립트가_돈다() {
        let t = tempfile::tempdir().unwrap();
        let p = fake_hook(t.path());
        let plan = plan_link_hook(
            t.path(),
            &p,
            "manage-mcp",
            &["mcp".into(), "엠씨피".into()],
            Lang::Ko,
        )
        .unwrap();
        apply(t.path(), &plan).unwrap();

        let syntax = std::process::Command::new("bash")
            .arg("-n")
            .arg(&p)
            .status();
        if let Ok(st) = syntax {
            assert!(st.success(), "끼운 뒤 문법이 깨졌다");
        }
        let run = |arg: &str| -> String {
            std::process::Command::new("bash")
                .arg(&p)
                .arg(arg)
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
                .unwrap_or_default()
        };
        assert!(
            run("엠씨피 서버가 안 떠").contains("manage-mcp"),
            "새 낱말이 안 걸린다"
        );
        assert!(run("에러 났어").contains("기존 환기"), "기존 환기가 깨졌다");
        assert!(run("버튼 색 바꿔줘").is_empty(), "엉뚱한 말에 뜬다");
    }

    /// 되돌리면 원래 파일 그대로여야 한다.
    #[test]
    fn 되돌리면_원본으로_돌아온다() {
        let t = tempfile::tempdir().unwrap();
        let p = fake_hook(t.path());
        let before = std::fs::read_to_string(&p).unwrap();
        let plan = plan_link_hook(t.path(), &p, "manage-mcp", &["mcp".into()], Lang::Ko).unwrap();
        apply(t.path(), &plan).unwrap();
        assert_ne!(std::fs::read_to_string(&p).unwrap(), before);
        undo(t.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            before,
            "원본과 다르다"
        );
    }
}

#[cfg(test)]
mod move_scope_tests {
    use super::*;
    use crate::model::*;

    fn skill_at(dir: &Path, name: &str, tokens: usize) -> Skill {
        let p = dir.join(name);
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(p.join("SKILL.md"), format!("---\nname: {name}\n---\n")).unwrap();
        Skill {
            name: name.into(),
            description: "d".into(),
            path: p,
            reference_count: 0,
            is_symlink: false,
            description_tokens: tokens,
            body: None,
        }
    }

    fn project(path: &Path, name: &str, skills: Vec<Skill>) -> Project {
        Project {
            name: name.into(),
            path: path.to_path_buf(),
            is_git: true,
            has_claude_md: false,
            has_claude_local_md: false,
            skills,
            knowledge: vec![],
            mcp: vec![],
            hooks: vec![],
            links: vec![],
            duplicate_paths: vec![],
            last_commit: None,
            disabled_mcp: vec![],
        }
    }

    /// 글로벌 스킬 하나 + 빈 프로젝트 하나인 하네스를 파일로 짓는다.
    fn setup(t: &Path) -> Scan {
        let g = t.join(".claude/skills");
        std::fs::create_dir_all(&g).unwrap();
        let proj = t.join("dev/demo");
        std::fs::create_dir_all(proj.join(".claude/skills")).unwrap();
        let mut scan = Scan {
            home: t.to_path_buf(),
            ..Default::default()
        };
        scan.global.skills.push(skill_at(&g, "wanderer", 300));
        scan.projects.push(project(&proj, "demo", vec![]));
        scan
    }

    /// **내리면 파일이 실제로 옮겨진다.** 지우는 게 아니라 옮기는 것이라 기능이 남는다.
    #[test]
    fn 내리면_그_프로젝트로_옮겨진다() {
        let t = tempfile::tempdir().unwrap();
        let scan = setup(t.path());
        let proj = t.path().join("dev/demo");
        let plan = plan_move_scope(&scan, "wanderer", &proj, false, Lang::Ko).unwrap();
        assert_eq!(plan.token_delta, 300, "글로벌에서 그만큼 빠진다");
        apply(t.path(), &plan).unwrap();

        assert!(
            !t.path().join(".claude/skills/wanderer").exists(),
            "글로벌에 남았다"
        );
        assert!(
            proj.join(".claude/skills/wanderer/SKILL.md").is_file(),
            "프로젝트로 안 갔다"
        );
    }

    /// 되돌리면 원래 자리로. 옮기기라 역방향이면 성립한다.
    #[test]
    fn 되돌리면_글로벌로_돌아온다() {
        let t = tempfile::tempdir().unwrap();
        let scan = setup(t.path());
        let proj = t.path().join("dev/demo");
        let plan = plan_move_scope(&scan, "wanderer", &proj, false, Lang::Ko).unwrap();
        apply(t.path(), &plan).unwrap();
        undo(t.path()).unwrap();
        assert!(
            t.path().join(".claude/skills/wanderer/SKILL.md").is_file(),
            "안 돌아왔다"
        );
        assert!(!proj.join(".claude/skills/wanderer").exists());
    }

    /// 같은 이름이 이미 있으면 **덮으면 안 된다** — 남의 것이 사라진다.
    #[test]
    fn 이름이_겹치면_거절한다() {
        let t = tempfile::tempdir().unwrap();
        let mut scan = setup(t.path());
        let proj = t.path().join("dev/demo");
        let dup = skill_at(&proj.join(".claude/skills"), "wanderer", 10);
        scan.projects[0].skills.push(dup);
        let e = plan_move_scope(&scan, "wanderer", &proj, false, Lang::Ko).unwrap_err();
        assert!(matches!(e, WriteError::Refused(m) if m.contains("이미")));
    }

    #[test]
    fn 없는_프로젝트로는_못_옮긴다() {
        let t = tempfile::tempdir().unwrap();
        let scan = setup(t.path());
        let e = plan_move_scope(&scan, "wanderer", &t.path().join("nope"), false, Lang::Ko)
            .unwrap_err();
        assert!(matches!(e, WriteError::NotFound(_)));
    }

    /// 올리는 것도 된다 — 프로젝트 전용이던 게 여러 곳에서 쓰이게 됐을 때.
    #[test]
    fn 프로젝트에서_글로벌로_올린다() {
        let t = tempfile::tempdir().unwrap();
        let mut scan = setup(t.path());
        scan.global.skills.clear();
        std::fs::remove_dir_all(t.path().join(".claude/skills/wanderer")).unwrap();
        let proj = t.path().join("dev/demo");
        let s = skill_at(&proj.join(".claude/skills"), "risen", 120);
        scan.projects[0].skills.push(s);

        let plan = plan_move_scope(&scan, "risen", &proj, true, Lang::Ko).unwrap();
        assert_eq!(plan.token_delta, -120, "글로벌 비용이 는다");
        apply(t.path(), &plan).unwrap();
        assert!(t.path().join(".claude/skills/risen/SKILL.md").is_file());
    }
}

// 참모 사본: 심볼릭 링크를 유닉스로만 만들 수 있어 윈도우에선 뺀다(vendor/HARNITOR.md)
#[cfg(all(test, unix))]
mod dead_link_tests {
    use super::*;

    fn dead_link(dir: &Path, name: &str) -> PathBuf {
        let link = dir.join(name);
        std::os::unix::fs::symlink(dir.join("gone-away"), &link).unwrap();
        link
    }

    /// **지우지 않는다.** 링크가 가리키던 경로가 단서라, 보관함으로 옮긴다.
    #[test]
    fn 깨진_링크를_보관함으로_옮긴다() {
        let t = tempfile::tempdir().unwrap();
        let skills = t.path().join(".claude/skills");
        std::fs::create_dir_all(&skills).unwrap();
        let link = dead_link(&skills, "legacy-helper");
        assert!(link.is_symlink() && !link.exists(), "깨진 링크여야 한다");

        let plan = plan_remove_link(t.path(), &link, Lang::Ko).unwrap();
        apply(t.path(), &plan).unwrap();

        assert!(!link.is_symlink(), "원래 자리에 남았다");
        let stash = t
            .path()
            .join(".claude/.harnitor/disabled/links/legacy-helper");
        assert!(stash.is_symlink(), "보관함에 링크인 채로 있어야 한다");
    }

    /// 되돌리면 링크가 **링크인 채로** 살아난다.
    #[test]
    fn 되돌리면_링크가_그대로_살아난다() {
        let t = tempfile::tempdir().unwrap();
        let skills = t.path().join(".claude/skills");
        std::fs::create_dir_all(&skills).unwrap();
        let link = dead_link(&skills, "legacy-helper");
        let target = std::fs::read_link(&link).unwrap();

        let plan = plan_remove_link(t.path(), &link, Lang::Ko).unwrap();
        apply(t.path(), &plan).unwrap();
        undo(t.path()).unwrap();

        assert!(link.is_symlink(), "안 돌아왔다");
        assert_eq!(
            std::fs::read_link(&link).unwrap(),
            target,
            "가리키던 곳이 바뀌었다"
        );
    }

    #[test]
    fn 링크가_아니면_거절한다() {
        let t = tempfile::tempdir().unwrap();
        let f = t.path().join("plain.txt");
        std::fs::write(&f, "x").unwrap();
        assert!(plan_remove_link(t.path(), &f, Lang::Ko).is_err());
    }
}
