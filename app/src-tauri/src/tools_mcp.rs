//! 도구 화면의 MCP 쪽 판단 — `claude mcp list` 읽기, 설정 파일에서 어디서 왔나, 프로젝트별 끄기 글 고치기, 추가 명령 인자.
//! 명령 실행·백업은 tools.rs
use serde::Serialize;

/// `claude mcp list` 한 줄 — state = ok·fail·off(이 프로젝트에서 꺼짐)·pending(승인 전)·auth(인증 필요)·unknown
#[derive(Serialize, Debug, PartialEq)]
pub struct McpStatus {
    pub name: String,
    pub target: String,
    pub state: &'static str,
    pub detail: String,
}

/// `이름: 대상 - ✔ Connected` 꼴. 이름엔 ':' 가 들어갈 수 있어(plugin:sentry:sentry) 첫 ": " 로 가르고,
/// 상태는 기호로 시작하는 마지막 " - " 뒤(대상 안의 " - " 는 건너뛴다)
pub fn parse_mcp_list(text: &str) -> Vec<McpStatus> {
    let mut out = Vec::new();
    for line in text.lines() {
        let Some((name, rest)) = line.split_once(": ") else { continue };
        let Some(at) = rest.match_indices(" - ").map(|(i, _)| i).filter(|&i| rest[i + 3..].chars().next().is_some_and(|c| !c.is_alphanumeric())).last() else { continue };
        let target = rest[..at].trim().to_string();
        let status = rest[at + 3..].trim();
        let lower = status.to_lowercase();
        let state = if lower.contains("auth") {
            "auth"
        } else if status.starts_with('✔') || status.starts_with('✓') {
            "ok"
        } else if status.starts_with('✘') || status.starts_with('✗') {
            "fail"
        } else if status.starts_with('⊘') {
            "off"
        } else if status.starts_with('⏸') {
            "pending"
        } else {
            "unknown"
        };
        let detail = status.split_once(" — ").map(|(_, d)| d.trim().to_string()).unwrap_or_default();
        out.push(McpStatus { name: name.trim().to_string(), target, state, detail });
    }
    out
}

/// 설정에 적힌 MCP — source = user(모든 프로젝트)·local(이 프로젝트, 나만)·project(.mcp.json, 같이 쓰는)·builtin(내장 computer-use, tools_conf 가 붙인다)
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpConf {
    pub name: String,
    pub source: &'static str,
    /// 명령 또는 주소 — 비밀은 가린 것
    pub target: String,
    pub http: bool,
    /// 이 프로젝트에서 꺼 둠(disabledMcpServers)
    pub off_here: bool,
}

fn conf_rows(map: Option<&serde_json::Value>, source: &'static str, disabled: &[String], out: &mut Vec<McpConf>) {
    let Some(m) = map.and_then(|m| m.as_object()) else { return };
    for (name, s) in m {
        let url = s.get("url").and_then(|u| u.as_str());
        let target = match url {
            Some(u) => harnitor_core::secret::mask_url(u),
            None => {
                let args: Vec<String> = s.get("args").and_then(|a| a.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                let cmd = s.get("command").and_then(|c| c.as_str()).unwrap_or_default().to_string();
                std::iter::once(cmd).chain(harnitor_core::secret::mask_args(&args)).filter(|x| !x.is_empty()).collect::<Vec<_>>().join(" ")
            }
        };
        out.push(McpConf { name: name.clone(), source, target, http: url.is_some(), off_here: disabled.contains(name) });
    }
}

fn disabled_of(cj: &serde_json::Value, key: &str) -> Vec<String> {
    cj["projects"][key]["disabledMcpServers"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// 설정 파일만으로 본 MCP — 이 프로젝트 것(local·.mcp.json) 먼저, 그다음 사용자 것. 커넥터·플러그인 MCP 는 `claude mcp list` 가 알려 준다
pub fn mcp_config(cj: &serde_json::Value, mcp_json: Option<&serde_json::Value>, key: &str) -> Vec<McpConf> {
    let disabled = disabled_of(cj, key);
    let mut out = Vec::new();
    conf_rows(cj["projects"][key].get("mcpServers"), "local", &disabled, &mut out);
    conf_rows(mcp_json.and_then(|v| v.get("mcpServers")), "project", &disabled, &mut out);
    conf_rows(cj.get("mcpServers"), "user", &disabled, &mut out);
    out
}

/// 이 프로젝트에서 끄기·켜기 — ~/.claude.json 글을 받아 고친 글을 돌려준다(다른 칸·칸 순서는 그대로). JSON 이 아니면 Err
pub fn set_disabled(text: &str, key: &str, name: &str, off: bool) -> Result<String, String> {
    let mut v: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let root = v.as_object_mut().ok_or("not an object")?;
    let projects = root.entry("projects").or_insert_with(|| serde_json::json!({}));
    let p = projects.as_object_mut().ok_or("projects")?.entry(key).or_insert_with(|| serde_json::json!({}));
    let list = p.as_object_mut().ok_or("project")?.entry("disabledMcpServers").or_insert_with(|| serde_json::json!([]));
    let arr = list.as_array_mut().ok_or("disabledMcpServers")?;
    let has = arr.iter().any(|x| x.as_str() == Some(name));
    if off && !has {
        arr.push(name.into());
    } else if !off && has {
        arr.retain(|x| x.as_str() != Some(name));
    } else {
        return Ok(text.to_string());
    }
    Ok(serde_json::to_string_pretty(&v).map_err(|e| e.to_string())? + "\n")
}

/// 사용자 범위 MCP 하나의 설정 — '모든 프로젝트에서 끄기'는 이걸 떠 두고 지웠다가, 켤 때 그대로 되돌린다(add-json)
pub fn user_server(text: &str, name: &str) -> Option<serde_json::Value> {
    serde_json::from_str::<serde_json::Value>(text).ok()?.get("mcpServers")?.get(name).cloned()
}

/// MCP 추가 명령 인자 — 주소면 http, 아니면 `--` 뒤에 명령(따옴표로 묶은 칸은 한 칸)
pub fn mcp_add_args(name: &str, target: &str, scope: &str) -> Result<Vec<String>, String> {
    if !safe_arg(name) || name.contains(char::is_whitespace) {
        return Err(crate::i18n::tr("이름이 비었거나 쓸 수 없는 글자가 있어", "The name is empty or has characters that can't be used").into());
    }
    if !matches!(scope, "user" | "local" | "project") {
        return Err("scope".into());
    }
    let t = target.trim();
    let mut a: Vec<String> = ["mcp", "add", "-s", scope].iter().map(|s| s.to_string()).collect();
    if t.starts_with("http://") || t.starts_with("https://") {
        a.extend(["--transport", "http", name, t].iter().map(|s| s.to_string()));
        return Ok(a);
    }
    let words = split_words(t);
    if words.is_empty() {
        return Err(crate::i18n::tr("주소나 명령을 적어 줘", "Enter a URL or a command").into());
    }
    a.push(name.into());
    a.push("--".into());
    a.extend(words);
    Ok(a)
}

/// 셸처럼 칸 나누기 — "…"·'…' 는 한 칸. 셸 확장은 안 한다
fn split_words(s: &str) -> Vec<String> {
    let (mut out, mut cur, mut q, mut any) = (Vec::new(), String::new(), None::<char>, false);
    for c in s.chars() {
        match (q, c) {
            (Some(x), c) if c == x => q = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => { q = Some(c); any = true; }
            (None, c) if c.is_whitespace() => { if any || !cur.is_empty() { out.push(std::mem::take(&mut cur)); any = false; } }
            (None, c) => cur.push(c),
        }
    }
    if any || !cur.is_empty() { out.push(cur); }
    out
}

/// 명령줄에 넘기는 이름·주소 — 비었거나 옵션처럼(-) 시작하거나 줄바꿈이 있으면 안 넘긴다
pub fn safe_arg(s: &str) -> bool {
    !s.is_empty() && !s.starts_with('-') && !s.contains(['\n', '\r', '\0']) && s.len() < 2048
}

/// 실패 글에서 색 코드를 빼고 마지막 몇 줄만
pub fn login_error(text: &str) -> String {
    let clean: String = {
        let mut s = String::new();
        let mut it = text.chars().peekable();
        while let Some(c) = it.next() {
            if c == '\u{1b}' {
                if it.peek() == Some(&'[') { it.next(); while let Some(&d) = it.peek() { it.next(); if d.is_ascii_alphabetic() { break; } } }
                continue;
            }
            if c != '\r' { s.push(c); }
        }
        s
    };
    let lines: Vec<&str> = clean.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(3)..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn mcp_list_줄을_이름_대상_상태로() {
        let text = "Checking MCP server health…\n\n\
    claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected\n\
    plugin:sentry:sentry: https://mcp.sentry.dev/mcp?utm_source=plugin (HTTP) - ✔ Connected\n\
    echo1: /bin/cat  - ✘ Failed to connect — -32601: Method not found\n\
    web1: https://example.com/mcp (HTTP) - ⊘ Disabled for this project (re-enable via /mcp)\n\
    playwright: npx -y @playwright/mcp@latest --extension - ⏸ Pending approval (run `claude` to approve)\n\
    linear: https://mcp.linear.app/mcp (HTTP) - ! Needs authentication\n\
    dash: npx a - b - ✔ Connected\n";
        let got = parse_mcp_list(text);
        let rows: Vec<_> = got.iter().map(|s| (s.name.as_str(), s.state)).collect();
        assert_eq!(rows, vec![
            ("claude.ai Claude Docs", "ok"),
            ("plugin:sentry:sentry", "ok"),
            ("echo1", "fail"),
            ("web1", "off"),
            ("playwright", "pending"),
            ("linear", "auth"),
            ("dash", "ok"),
        ]);
        assert_eq!(got[2].detail, "-32601: Method not found");
        assert_eq!(got[6].target, "npx a - b"); // 대상 안의 " - " 는 상태로 안 본다
        assert_eq!(got[1].target, "https://mcp.sentry.dev/mcp?utm_source=plugin (HTTP)");
    }

    #[test]
    fn 프로젝트_mcp_끄기는_disabled_목록에_넣고_빼기() {
        let text = r#"{"numStartups":3,"projects":{"/p":{"allowedTools":[],"disabledMcpServers":["a"]}},"zzz":1}"#;
        let on = set_disabled(text, "/p", "b", true).unwrap();
        let v: serde_json::Value = serde_json::from_str(&on).unwrap();
        assert_eq!(v["projects"]["/p"]["disabledMcpServers"], json!(["a", "b"]));
        assert_eq!(v["numStartups"], json!(3)); // 다른 칸은 그대로
        // 두 번 꺼도 한 번만
        assert_eq!(set_disabled(&on, "/p", "b", true).unwrap(), on);
        let off: serde_json::Value = serde_json::from_str(&set_disabled(&on, "/p", "a", false).unwrap()).unwrap();
        assert_eq!(off["projects"]["/p"]["disabledMcpServers"], json!(["b"]));
        // 처음 보는 프로젝트는 칸을 만든다
        let new: serde_json::Value = serde_json::from_str(&set_disabled(text, "/q", "x", true).unwrap()).unwrap();
        assert_eq!(new["projects"]["/q"]["disabledMcpServers"], json!(["x"]));
        // 칸 순서 유지(preserve_order) — 맨 끝 칸이 끝에 남는다
        assert!(on.trim_end().trim_end_matches('}').trim_end().ends_with("\"zzz\": 1"));
        // JSON 이 아니면 안 건드린다
        assert!(set_disabled("{깨짐", "/p", "a", true).is_err());
    }

    #[test]
    fn mcp_설정을_어디서_왔나와_함께() {
        let cj = json!({
            "mcpServers": {"mobile": {"command": "npx", "args": ["-y", "m"]}, "web": {"type": "http", "url": "https://x.dev/mcp?api_key=abcdef1234567890abcd"}},
            "projects": {"/p": {"mcpServers": {"loc": {"command": "/bin/echo"}}, "disabledMcpServers": ["web"]}}
        });
        let mj = json!({"mcpServers": {"pw": {"command": "npx", "args": ["@playwright/mcp"]}}});
        let rows = mcp_config(&cj, Some(&mj), "/p");
        let got: Vec<_> = rows.iter().map(|m| (m.name.as_str(), m.source, m.off_here)).collect();
        assert_eq!(got, vec![("loc", "local", false), ("pw", "project", false), ("mobile", "user", false), ("web", "user", true)]);
        assert_eq!(rows[2].target, "npx -y m");
        assert!(!rows[3].target.contains("abcdef1234567890abcd")); // 주소 속 비밀은 가린다
        assert!(rows[3].http);
    }

    #[test]
    fn mcp_추가_인자는_주소면_http_명령이면_대시_두개_뒤로() {
        assert_eq!(mcp_add_args("sentry", "https://mcp.sentry.dev/mcp", "user").unwrap(),
            vec!["mcp", "add", "-s", "user", "--transport", "http", "sentry", "https://mcp.sentry.dev/mcp"]);
        assert_eq!(mcp_add_args("files", "npx -y \"@x/server files\" --root '/a b'", "local").unwrap(),
            vec!["mcp", "add", "-s", "local", "files", "--", "npx", "-y", "@x/server files", "--root", "/a b"]);
        // 이름이 옵션처럼 보이거나 비면 막는다
        assert!(mcp_add_args("-x", "npx a", "user").is_err());
        assert!(mcp_add_args("", "npx a", "user").is_err());
        assert!(mcp_add_args("a", "  ", "user").is_err());
        assert!(mcp_add_args("a", "npx", "global").is_err());
    }

    #[test]
    fn 명령줄에_넘기는_이름은_옵션처럼_보이면_막는다() {
        assert!(safe_arg("code-review@claude-plugins-official"));
        assert!(safe_arg("anthropics/skills"));
        assert!(safe_arg("https://github.com/a/b.git"));
        assert!(!safe_arg("--force"));
        assert!(!safe_arg(""));
        assert!(!safe_arg("a\nb"));
    }

    #[test]
    fn 쉬어둔_mcp_는_되돌릴_설정과_함께() {
        let text = r#"{"mcpServers":{"mobile":{"command":"npx","args":["m"]},"keep":{"command":"k"}}}"#;
        let conf = user_server(text, "mobile").unwrap();
        assert_eq!(conf, json!({"command": "npx", "args": ["m"]}));
        assert!(user_server(text, "none").is_none());
    }

    #[test]
    fn 로그인_실패_글은_색을_빼고_끝_세_줄만() {
        let t = "Starting…\r\n\u{1b}[31mstep a\u{1b}[39m\r\nstep b\r\n\r\n\u{1b}]8;;https://x\u{7}link\r\nCouldn't complete authentication\r\n";
        let got = login_error(t);
        assert_eq!(got.lines().count(), 3);
        assert!(got.ends_with("Couldn't complete authentication"));
        assert!(got.starts_with("step b"));
        assert!(!got.contains('\u{1b}'));
    }
}
