//! 도구 화면의 플러그인·스킬·/memory 쪽 — 켜진 플러그인과 그 스킬(`플러그인:스킬`), `claude plugin list --json`·details 읽기,
//! /memory 가 여는 파일. 명령 실행은 tools.rs
use crate::tools::{cfg, project_key, read_json, Cfg};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// 켜진 플러그인 (id, 설치 폴더) — 깔린 것 중 사용자 범위이거나 이 프로젝트에 깔린 것, 켜짐은 사용자 → 프로젝트 → 로컬 settings 순으로 덮는다
pub fn enabled_plugins(installed: &serde_json::Value, settings: &[&serde_json::Value], root: Option<&str>) -> Vec<(String, PathBuf)> {
    let mut on = std::collections::BTreeMap::<String, bool>::new();
    for s in settings {
        if let Some(m) = s.get("enabledPlugins").and_then(|m| m.as_object()) {
            for (k, v) in m {
                on.insert(k.clone(), v.as_bool().unwrap_or(false));
            }
        }
    }
    let mut out = Vec::new();
    let Some(map) = installed.get("plugins").and_then(|p| p.as_object()) else { return out };
    for (id, installs) in map {
        if !on.get(id).copied().unwrap_or(false) { continue; }
        let pick = installs.as_array().into_iter().flatten().find(|i| {
            let scope = i.get("scope").and_then(|s| s.as_str()).unwrap_or("user");
            scope == "user" || (root.is_some() && i.get("projectPath").and_then(|p| p.as_str()).map(project_key) == root.map(project_key))
        });
        if let Some(p) = pick.and_then(|i| i.get("installPath")).and_then(|p| p.as_str()) {
            out.push((id.clone(), PathBuf::from(p)));
        }
    }
    out.sort();
    out
}

/// 스킬 한 줄 — name = 채팅에 치는 이름(플러그인은 `플러그인:스킬`), path = SKILL.md(또는 명령 md)
#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct ToolSkill {
    pub name: String,
    pub desc: String,
    pub source: &'static str,
    pub path: String,
    pub plugin: Option<String>,
}

/// 한 폴더의 skills/*/SKILL.md 와 commands/*.md — prefix 가 있으면 `prefix:이름`
pub fn skills_in(dir: &Path, prefix: Option<&str>, source: &'static str, plugin: Option<&str>) -> Vec<ToolSkill> {
    let mut out = Vec::new();
    let mut push = |name: String, desc: String, path: PathBuf| {
        out.push(ToolSkill { name: prefix.map(|p| format!("{p}:{name}")).unwrap_or(name), desc, source, path: path.to_string_lossy().into_owned(), plugin: plugin.map(String::from) });
    };
    if let Ok(rd) = std::fs::read_dir(dir.join("skills")) {
        let mut v: Vec<_> = rd.flatten().filter(|e| e.path().join("SKILL.md").is_file()).collect();
        v.sort_by_key(|e| e.file_name());
        for e in v {
            let f = e.path().join("SKILL.md");
            let (name, desc) = crate::slash::front(&std::fs::read_to_string(&f).unwrap_or_default());
            push(name.unwrap_or_else(|| e.file_name().to_string_lossy().into_owned()), desc, f);
        }
    }
    if let Ok(rd) = std::fs::read_dir(dir.join("commands")) {
        let mut v: Vec<_> = rd.flatten().filter(|e| e.path().extension().is_some_and(|x| x == "md")).collect();
        v.sort_by_key(|e| e.file_name());
        for e in v {
            let (_, desc) = crate::slash::front(&std::fs::read_to_string(e.path()).unwrap_or_default());
            push(e.path().file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(), desc, e.path());
        }
    }
    out
}

/// 플러그인 하나가 데려온 스킬·명령 — `플러그인:스킬` 이름(Claude 가 부르는 그대로)
pub fn plugin_skills(id: &str, install: &Path) -> Vec<ToolSkill> {
    let short = id.split('@').next().unwrap_or(id);
    skills_in(install, Some(short), "plugin", Some(id))
}

fn settings_list(cfg: &Cfg, root: Option<&Path>) -> Vec<serde_json::Value> {
    let mut v = vec![read_json(&cfg.dir.join("settings.json"))];
    if let Some(r) = root {
        v.push(read_json(&r.join(".claude/settings.json")));
        v.push(read_json(&r.join(".claude/settings.local.json")));
    }
    v
}

/// 지금 켜진 플러그인들의 스킬 — 채팅 / 자동완성(slash.rs)도 이걸 쓴다
pub fn enabled_plugin_skills(root: Option<&Path>) -> Vec<ToolSkill> {
    let c = cfg();
    let installed = read_json(&c.dir.join("plugins/installed_plugins.json"));
    let st = settings_list(&c, root);
    let refs: Vec<&serde_json::Value> = st.iter().collect();
    let key = root.map(|r| project_key(&r.to_string_lossy()));
    enabled_plugins(&installed, &refs, key.as_deref()).iter().flat_map(|(id, p)| plugin_skills(id, p)).collect()
}

/// `claude plugin list --json` 한 줄
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginRow {
    pub id: String,
    pub name: String,
    pub market: String,
    pub scope: String,
    pub enabled: bool,
    pub version: String,
    pub desc: String,
    pub install_path: String,
    pub skills: usize,
    pub mcp: usize,
}

/// 사용자 범위 것과 이 프로젝트에 깔린 것만(다른 프로젝트에 깔린 건 여기서 못 켠다)
pub fn parse_plugin_list(text: &str, root: Option<&str>) -> Result<Vec<PluginRow>, String> {
    let v: Vec<serde_json::Value> = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let key = root.map(project_key);
    Ok(v.into_iter()
        .filter(|p| {
            let scope = p["scope"].as_str().unwrap_or("user");
            scope == "user" || (key.is_some() && p["projectPath"].as_str().map(project_key) == key)
        })
        .map(|p| {
            let id = p["id"].as_str().unwrap_or_default().to_string();
            let (name, market) = id.split_once('@').map(|(a, b)| (a.to_string(), b.to_string())).unwrap_or((id.clone(), String::new()));
            let install = PathBuf::from(p["installPath"].as_str().unwrap_or_default());
            let manifest = read_json(&install.join(".claude-plugin/plugin.json"));
            let mcp = [read_json(&install.join(".mcp.json")), manifest.clone()].iter().filter_map(|m| m.get("mcpServers").and_then(|x| x.as_object()).map(|x| x.len())).sum();
            PluginRow {
                skills: plugin_skills(&id, &install).len(),
                mcp,
                desc: manifest["description"].as_str().unwrap_or_default().to_string(),
                name,
                market,
                scope: p["scope"].as_str().unwrap_or("user").to_string(),
                enabled: p["enabled"].as_bool().unwrap_or(false),
                version: p["version"].as_str().unwrap_or_default().to_string(),
                install_path: install.to_string_lossy().into_owned(),
                id,
            }
        })
        .collect())
}

/// `claude plugin details` 의 "Always-on: ~22 tok" → "~22" (매 세션 늘 실리는 토큰)
pub fn parse_cost(text: &str) -> Option<String> {
    let line = text.lines().find(|l| l.trim_start().starts_with("Always-on:"))?;
    line.split_once(':')?.1.split_whitespace().next().map(String::from)
}

/// 마켓플레이스 한 줄 — from = 어디서(GitHub 저장소·git 주소·폴더)
#[derive(Serialize, Debug, PartialEq)]
pub struct Market {
    pub name: String,
    pub from: String,
}

/// `claude plugin marketplace list --json`
pub fn parse_markets(text: &str) -> Result<Vec<Market>, String> {
    let v: Vec<serde_json::Value> = serde_json::from_str(text).map_err(|e| e.to_string())?;
    Ok(v.iter()
        .map(|m| Market {
            name: m["name"].as_str().unwrap_or_default().to_string(),
            from: ["repo", "url", "path"].iter().find_map(|k| m[*k].as_str()).unwrap_or_default().to_string(),
        })
        .collect())
}

/// 설치할 수 있는 플러그인 — 깔린 건 뺀다
#[derive(Serialize, Debug, PartialEq)]
pub struct Available {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub market: String,
}

/// `claude plugin list --available --json` 의 {installed, available}
pub fn parse_available(text: &str) -> Result<Vec<Available>, String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let have: Vec<&str> = v["installed"].as_array().into_iter().flatten().filter_map(|p| p["id"].as_str()).collect();
    Ok(v["available"].as_array().into_iter().flatten()
        .filter(|p| p["pluginId"].as_str().is_some_and(|id| !have.contains(&id)))
        .map(|p| Available {
            id: p["pluginId"].as_str().unwrap_or_default().to_string(),
            name: p["name"].as_str().unwrap_or_default().to_string(),
            desc: p["description"].as_str().unwrap_or_default().to_string(),
            market: p["marketplaceName"].as_str().unwrap_or_default().to_string(),
        })
        .collect())
}

// ───────── /memory ─────────

/// ~/.claude/projects 밑 프로젝트 폴더 이름 — 글자·숫자가 아닌 건 '-'(Claude 와 같은 규칙, 실측 /…/.chammo-qa → --chammo-qa)
pub fn project_slug(path: &str) -> String {
    path.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

#[derive(Serialize, Debug, PartialEq)]
pub struct MemoryFile {
    pub kind: &'static str,
    pub path: String,
}

/// `/memory` 가 여는 파일 중 있는 것 — 사용자 CLAUDE.md, 프로젝트 CLAUDE.md·.claude/CLAUDE.md·CLAUDE.local.md, 자동 메모리 MEMORY.md
pub fn memory_files(cfg: &Cfg, root: Option<&Path>) -> Vec<MemoryFile> {
    let mut c: Vec<(&'static str, PathBuf)> = vec![("user", cfg.dir.join("CLAUDE.md"))];
    if let Some(r) = root {
        c.push(("project", r.join("CLAUDE.md")));
        c.push(("project", r.join(".claude/CLAUDE.md")));
        c.push(("local", r.join("CLAUDE.local.md")));
        c.push(("memory", cfg.dir.join("projects").join(project_slug(&r.to_string_lossy())).join("memory/MEMORY.md")));
    }
    c.into_iter().filter(|(_, p)| p.is_file()).map(|(kind, p)| MemoryFile { kind, path: p.to_string_lossy().into_owned() }).collect()
}

#[tauri::command]
pub fn memory_files_for(root: Option<String>) -> Vec<MemoryFile> {
    memory_files(&cfg(), root.as_deref().filter(|r| !r.is_empty()).map(Path::new))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::Cfg;
    use serde_json::json;
    use std::path::{Path, PathBuf};

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-tools-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn 켜진_플러그인은_사용자_프로젝트_로컬_순으로_덮는다() {
        let installed = json!({"version": 2, "plugins": {
            "a@m": [{"scope": "user", "installPath": "/c/a"}],
            "b@m": [{"scope": "user", "installPath": "/c/b"}],
            "c@m": [{"scope": "project", "projectPath": "/p", "installPath": "/c/c"}],
            "d@m": [{"scope": "project", "projectPath": "/other", "installPath": "/c/d"}],
            "e@m": [{"scope": "user", "installPath": "/c/e"}]
        }});
        let user = json!({"enabledPlugins": {"a@m": true, "b@m": true, "d@m": true}});
        let proj = json!({"enabledPlugins": {"c@m": true}});
        let local = json!({"enabledPlugins": {"b@m": false}});
        let got = enabled_plugins(&installed, &[&user, &proj, &local], Some("/p"));
        assert_eq!(got, vec![("a@m".to_string(), PathBuf::from("/c/a")), ("c@m".to_string(), PathBuf::from("/c/c"))]);
    }

    #[test]
    fn 플러그인_스킬은_플러그인_이름을_앞에() {
        let d = tmp("pskills");
        std::fs::create_dir_all(d.join("skills/xlsx")).unwrap();
        std::fs::write(d.join("skills/xlsx/SKILL.md"), "---\nname: xlsx\ndescription: 표 파일\n---").unwrap();
        std::fs::create_dir_all(d.join("commands")).unwrap();
        std::fs::write(d.join("commands/code-review.md"), "---\ndescription: PR 리뷰\n---").unwrap();
        let got = plugin_skills("document-skills@anthropic", &d);
        let names: Vec<_> = got.iter().map(|s| (s.name.as_str(), s.desc.as_str(), s.source)).collect();
        assert_eq!(names, vec![("document-skills:xlsx", "표 파일", "plugin"), ("document-skills:code-review", "PR 리뷰", "plugin")]);
        assert!(got[0].path.ends_with("skills/xlsx/SKILL.md"));
        assert_eq!(got[0].plugin.as_deref(), Some("document-skills@anthropic"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 플러그인_목록은_사용자_것과_이_프로젝트_것만() {
        let text = r#"[
     {"id":"code-review@official","version":"1","scope":"user","enabled":true,"installPath":"/nope/a"},
     {"id":"expo@official","version":"2","scope":"project","enabled":false,"installPath":"/nope/b","projectPath":"/other"},
     {"id":"supabase@official","version":"3","scope":"local","enabled":false,"installPath":"/nope/c","projectPath":"/p"}
    ]"#;
        let rows = parse_plugin_list(text, Some("/p")).unwrap();
        let got: Vec<_> = rows.iter().map(|p| (p.id.as_str(), p.name.as_str(), p.market.as_str(), p.scope.as_str(), p.enabled)).collect();
        assert_eq!(got, vec![("code-review@official", "code-review", "official", "user", true), ("supabase@official", "supabase", "official", "local", false)]);
        assert!(parse_plugin_list("not json", None).is_err());
    }

    #[test]
    fn 플러그인_토큰_비용은_늘_실리는_양() {
        let text = "code-review\n\nProjected token cost\n  Always-on:   ~22 tok   added to every session\n\nPer-component\n";
        assert_eq!(parse_cost(text).as_deref(), Some("~22"));
        assert_eq!(parse_cost("Always-on:   ~1.2k tok").as_deref(), Some("~1.2k"));
        assert_eq!(parse_cost("없음"), None);
    }

    #[test]
    fn 메모리_폴더_이름은_경로의_글자_아닌_것을_빼기로() {
        assert_eq!(project_slug("/Users/a/Desktop/dev/honor-orchestrator"), "-Users-a-Desktop-dev-honor-orchestrator");
        assert_eq!(project_slug("/Users/a/.chammo-qa/dev/demo_a"), "-Users-a--chammo-qa-dev-demo-a");
        assert_eq!(project_slug("C:\\Users\\a\\proj"), "C--Users-a-proj");
    }

    #[test]
    fn memory_파일은_있는_것만_사용자_프로젝트_메모리_순() {
        let d = tmp("memory");
        let cfg = Cfg { dir: d.join(".claude"), json: d.join(".claude.json") };
        let root = d.join("proj");
        std::fs::create_dir_all(cfg.dir.join("projects").join(project_slug(&root.to_string_lossy())).join("memory")).unwrap();
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(cfg.dir.join("CLAUDE.md"), "u").unwrap();
        std::fs::write(root.join("CLAUDE.md"), "p").unwrap();
        std::fs::write(root.join("CLAUDE.local.md"), "l").unwrap();
        std::fs::write(cfg.dir.join("projects").join(project_slug(&root.to_string_lossy())).join("memory/MEMORY.md"), "m").unwrap();
        let got: Vec<_> = memory_files(&cfg, Some(&root)).into_iter().map(|m| (m.kind, Path::new(&m.path).file_name().unwrap().to_string_lossy().into_owned())).collect();
        assert_eq!(got, vec![("user", "CLAUDE.md".into()), ("project", "CLAUDE.md".into()), ("local", "CLAUDE.local.md".into()), ("memory", "MEMORY.md".into())]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 마켓플레이스_목록은_이름과_출처_한_줄로() {
        let text = r#"[
 {"name":"official","source":"github","repo":"anthropics/claude-plugins-official","installLocation":"/x"},
 {"name":"gptaku","source":"git","url":"https://github.com/a/b.git","installLocation":"/y"},
 {"name":"local","source":"directory","path":"/Users/me/mk","installLocation":"/z"}
]"#;
        let got: Vec<_> = parse_markets(text).unwrap().into_iter().map(|m| (m.name, m.from)).collect();
        assert_eq!(got, vec![
            ("official".to_string(), "anthropics/claude-plugins-official".to_string()),
            ("gptaku".to_string(), "https://github.com/a/b.git".to_string()),
            ("local".to_string(), "/Users/me/mk".to_string()),
        ]);
        assert!(parse_markets("x").is_err());
    }

    #[test]
    fn 설치할_수_있는_플러그인은_깔린_것을_뺀다() {
        let text = r#"{"installed":[{"id":"code-review@official"}],"available":[
 {"pluginId":"code-review@official","name":"code-review","description":"리뷰","marketplaceName":"official"},
 {"pluginId":"expo@official","name":"expo","description":"엑스포","marketplaceName":"official"}
]}"#;
        let got = parse_available(text).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!((got[0].id.as_str(), got[0].name.as_str(), got[0].desc.as_str(), got[0].market.as_str()), ("expo@official", "expo", "엑스포", "official"));
    }
}
