//! 채팅 입력칸 / 자동완성 목록 — 사용자(~/.claude)·프로젝트(<cwd>/.claude)의 스킬(skills/<이름>/SKILL.md)과 명령(commands/<이름>.md).
//! 기본 명령은 화면 쪽(domain/slash.ts)이 들고 있다(2026-10-01 사용자)
//! (같은 파일에 참모 대화 기록에서 '띄운 세션·말 건 세션' 줄만 훑는 spawn_lines 도 둔다)
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug, PartialEq)]
pub struct SlashItem {
    pub name: String,
    pub desc: String,
    pub kind: &'static str,
}

/// SKILL.md·명령 md 머리말(--- ... ---)에서 name·description. 머리말이 없으면 이름 없음 + 첫 글줄을 설명으로
pub fn front(text: &str) -> (Option<String>, String) {
    let mut name = None;
    let mut desc = String::new();
    let body = text.trim_start_matches('\u{feff}');
    if let Some(rest) = body.strip_prefix("---") {
        let end = rest.find("\n---").unwrap_or(rest.len());
        for line in rest[..end].lines() {
            if let Some(v) = line.strip_prefix("name:") {
                name = Some(v.trim().trim_matches('"').to_string()).filter(|s| !s.is_empty());
            } else if let Some(v) = line.strip_prefix("description:") {
                desc = v.trim().trim_matches('"').to_string();
            }
        }
    } else if let Some(first) = body.lines().map(str::trim).find(|l| !l.is_empty()) {
        desc = first.trim_start_matches('#').trim().to_string();
    }
    (name, shorten(&desc, 80))
}

fn shorten(s: &str, n: usize) -> String {
    if s.chars().count() <= n { s.to_string() } else { format!("{}…", s.chars().take(n).collect::<String>()) }
}

/// 한 .claude 폴더의 skills·commands
pub fn scan(dot_claude: &Path, out: &mut Vec<SlashItem>) {
    if let Ok(rd) = std::fs::read_dir(dot_claude.join("skills")) {
        let mut v: Vec<_> = rd.flatten().filter(|e| e.path().join("SKILL.md").is_file()).collect();
        v.sort_by_key(|e| e.file_name());
        for e in v {
            let dir = e.file_name().to_string_lossy().into_owned();
            let (name, desc) = front(&std::fs::read_to_string(e.path().join("SKILL.md")).unwrap_or_default());
            out.push(SlashItem { name: name.unwrap_or(dir), desc, kind: "skill" });
        }
    }
    if let Ok(rd) = std::fs::read_dir(dot_claude.join("commands")) {
        let mut v: Vec<_> = rd.flatten().filter(|e| e.path().extension().is_some_and(|x| x == "md")).collect();
        v.sort_by_key(|e| e.file_name());
        for e in v {
            let stem = e.path().file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let (_, desc) = front(&std::fs::read_to_string(e.path()).unwrap_or_default());
            out.push(SlashItem { name: stem, desc, kind: "command" });
        }
    }
}

/// 프로젝트 것 먼저(같은 이름이면 프로젝트가 이긴다), 그다음 사용자 것, 끝에 켜진 플러그인 것
#[tauri::command]
pub fn slash_commands(cwd: Option<String>) -> Vec<SlashItem> {
    let mut out = Vec::new();
    if let Some(c) = cwd.as_deref().filter(|c| !c.is_empty()) {
        scan(&Path::new(c).join(".claude"), &mut out);
    }
    let root = cwd.as_deref().filter(|c| !c.is_empty()).map(Path::new);
    scan(&crate::tools::cfg().dir, &mut out); // CLAUDE_CONFIG_DIR 를 쓰면 그 밑(도구 화면과 같은 자리)
    // 켜진 플러그인 스킬 — `플러그인:스킬`(Claude 가 부르는 이름 그대로, 2026-10-04 사용자)
    out.extend(crate::tools_plugins::enabled_plugin_skills(root).into_iter().map(|s| SlashItem { name: s.name, desc: shorten(&s.desc, 80), kind: "skill" }));
    out
}

/// spawn_lines 결과 — 줄들과 다음에 이어 읽을 자리
#[derive(Serialize, Debug, PartialEq)]
pub struct SpawnLines {
    pub lines: Vec<String>,
    pub next: u64,
}

/// 대화 기록(jsonl)에서 from 바이트 뒤로, 세션을 띄웠거나(`claude --bg`) 말 건(SendMessage) 도구 호출 줄만 — 화면 domain/spaceNav transcriptTargets 가 읽는다.
/// 끝 256KB 만 보면 앞서 띄운 세션을 놓쳤다(2026-10-01 사용자). 처음은 from=0 으로 전체를 훑고, 그 뒤엔 next 부터 늘어난 부분만. 마지막 줄이 덜 쓰였으면 거기서 멈춘다
pub fn scan_spawn_lines(path: &Path, from: u64) -> std::io::Result<SpawnLines> {
    use std::io::{BufRead, BufReader, Seek, SeekFrom};
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    let start = if from > len { 0 } else { from }; // 파일이 줄었으면(새 기록) 처음부터
    f.seek(SeekFrom::Start(start))?;
    let mut r = BufReader::new(f);
    let mut lines = Vec::new();
    let mut pos = start;
    let mut buf = Vec::new();
    loop {
        buf.clear();
        let n = r.read_until(b'\n', &mut buf)?;
        if n == 0 { break; }
        if buf.last() != Some(&b'\n') { break; } // 아직 쓰는 중인 줄 — 다음에
        pos += n as u64;
        let text = String::from_utf8_lossy(&buf);
        if keep_spawn_line(&text) && lines.len() < 5000 {
            lines.push(text.trim_end().to_string());
        }
    }
    Ok(SpawnLines { lines, next: pos })
}

/// 고를 줄 — 세션 띄움(`claude --bg`)·말 건(SendMessage)·분신(Agent 호출, 띄운 결과의 agentId, 끝 알림 <task-notification>).
/// 분신은 domain/subAgents foldAgents 가 읽는다(2026-10-02 사용자 — 대시보드 제목 아래 분신 목록)
fn keep_spawn_line(text: &str) -> bool {
    let tool = text.contains("\"tool_use\"") && (text.contains("claude --bg") || text.contains("\"SendMessage\"") || text.contains("\"name\":\"Agent\""));
    let user = text.starts_with("{") && (text.contains("\"type\":\"user\"") || text.contains("\"type\":\"queued_command\""));
    tool || (user && (text.contains("<task-notification>") || (text.contains("\"toolUseResult\"") && text.contains("\"agentId\""))))
}

/// subagent_tails 결과 — 분신 하나의 기록 꼬리
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubTail {
    pub tool_use_id: String,
    pub agent_id: String,
    /// 기록 파일 마지막으로 고친 때(ms) — 오래 조용하면 화면이 '조용함'
    pub mtime: u64,
    pub tail: String,
}

/// subagents 폴더에서 물어본 호출(tool_use id)의 분신 기록 꼬리 — meta.json 의 toolUseId 로 짝을 찾는다. 끝 max 바이트, 잘린 첫 줄은 버린다
pub fn read_subagent_tails(dir: &Path, ids: &[String], max: u64) -> Vec<SubTail> {
    use std::io::{Read, Seek, SeekFrom};
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else { return out };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(agent) = name.strip_prefix("agent-").and_then(|n| n.strip_suffix(".meta.json")) else { continue };
        let Ok(meta) = std::fs::read_to_string(e.path()) else { continue };
        let Some(tid) = serde_json::from_str::<serde_json::Value>(&meta).ok().and_then(|v| v["toolUseId"].as_str().map(String::from)) else { continue };
        if !ids.contains(&tid) { continue; }
        let Ok(mut f) = std::fs::File::open(dir.join(format!("agent-{agent}.jsonl"))) else { continue };
        let md = f.metadata().ok();
        let len = md.as_ref().map(|m| m.len()).unwrap_or(0);
        let mtime = md.and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
        let start = len.saturating_sub(max);
        let _ = f.seek(SeekFrom::Start(start));
        let mut buf = Vec::new();
        if f.read_to_end(&mut buf).is_err() { continue; }
        let mut text = String::from_utf8_lossy(&buf).into_owned();
        if start > 0 { text = text.split_once('\n').map(|(_, r)| r.to_string()).unwrap_or_default(); }
        out.push(SubTail { tool_use_id: tid, agent_id: agent.to_string(), mtime, tail: text });
    }
    out
}

/// 참모(session_id) 가 띄운 분신들의 기록 꼬리 — ~/.claude/projects/<프로젝트>/<세션>/subagents
#[tauri::command]
pub async fn subagent_tails(session_id: String, ids: Vec<String>) -> Vec<SubTail> {
    if !valid_sid(&session_id) || ids.is_empty() { return Vec::new(); }
    tauri::async_runtime::spawn_blocking(move || {
        let home = crate::platform::home();
        let Ok(rd) = std::fs::read_dir(format!("{home}/.claude/projects")) else { return Vec::new() };
        let Some(dir) = rd.flatten().map(|e| e.path().join(&session_id).join("subagents")).find(|p| p.is_dir()) else { return Vec::new() };
        read_subagent_tails(&dir, &ids, 128 * 1024)
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn spawn_lines(session_id: String, from: u64) -> Option<SpawnLines> {
    if !valid_sid(&session_id) { return None; } // 경로에 붙이니 세션 id 모양만
    tauri::async_runtime::spawn_blocking(move || {
        let home = crate::platform::home();
        let path = std::fs::read_dir(format!("{home}/.claude/projects")).ok()?.flatten().map(|e| e.path().join(format!("{session_id}.jsonl"))).find(|p| p.exists())?;
        scan_spawn_lines(&path, from).ok()
    })
    .await
    .ok()
    .flatten()
}

/// Claude 세션 id 모양(16진수·-, 8~64자)
pub fn valid_sid(s: &str) -> bool {
    (8..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 세션_id_모양만_받는다() {
        assert!(valid_sid("00000000-1111-4222-8333-444444444444"));
        assert!(!valid_sid("../../etc/passwd"));
        assert!(!valid_sid("abc"));
    }

    #[test]
    fn 머리말에서_이름과_설명() {
        let (n, d) = front("---\nname: project-starter\ndescription: \"새 프로젝트 하네스를 깐다\"\n---\n# 본문");
        assert_eq!(n.as_deref(), Some("project-starter"));
        assert_eq!(d, "새 프로젝트 하네스를 깐다");
    }

    #[test]
    fn 머리말이_없으면_첫_글줄() {
        assert_eq!(front("\n# 배포 체크리스트\n내용"), (None, "배포 체크리스트".to_string()));
    }

    #[test]
    fn 긴_설명은_자른다() {
        let (_, d) = front(&format!("---\ndescription: {}\n---", "가".repeat(100)));
        assert_eq!(d.chars().count(), 81);
    }

    #[test]
    fn 폴더에서_스킬과_명령을_읽는다() {
        let root = std::env::temp_dir().join(format!("chammo-slash-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("skills/zeta")).unwrap();
        std::fs::create_dir_all(root.join("skills/alpha")).unwrap();
        std::fs::create_dir_all(root.join("skills/empty")).unwrap(); // SKILL.md 없음 — 뺀다
        std::fs::create_dir_all(root.join("commands")).unwrap();
        std::fs::write(root.join("skills/zeta/SKILL.md"), "---\nname: zeta\ndescription: z\n---").unwrap();
        std::fs::write(root.join("skills/alpha/SKILL.md"), "---\ndescription: a\n---").unwrap(); // name 없으면 폴더 이름
        std::fs::write(root.join("commands/deploy.md"), "# 배포").unwrap();
        std::fs::write(root.join("commands/notes.txt"), "x").unwrap(); // md 아님 — 뺀다
        let mut out = Vec::new();
        scan(&root, &mut out);
        let got: Vec<_> = out.iter().map(|i| (i.name.as_str(), i.kind)).collect();
        assert_eq!(got, vec![("alpha", "skill"), ("zeta", "skill"), ("deploy", "command")]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn 띄운_세션과_말_건_줄만_이어서_읽는다() {
        let p = std::env::temp_dir().join(format!("chammo-spawn-{}.jsonl", std::process::id()));
        let a = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"claude --bg -n report-fix \"x\""}}]}}"#;
        let b = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"claude --bg 얘기만"}]}}"#; // tool_use 아님 — 뺀다
        let c = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"SendMessage","input":{"to":"oms"}}]}}"#;
        std::fs::write(&p, format!("{a}\n{b}\n")).unwrap();
        let r1 = scan_spawn_lines(&p, 0).unwrap();
        assert_eq!(r1.lines, vec![a.to_string()]);
        // 늘어난 부분만 — 덜 쓴 마지막 줄(개행 없음)은 다음에
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        use std::io::Write;
        write!(f, "{c}\n{{\"partial").unwrap();
        let r2 = scan_spawn_lines(&p, r1.next).unwrap();
        assert_eq!(r2.lines, vec![c.to_string()]);
        assert_eq!(r2.next, std::fs::read_to_string(&p).unwrap().rfind("{\"partial").unwrap() as u64);
        // 파일이 줄었으면 처음부터
        std::fs::write(&p, format!("{a}\n")).unwrap();
        assert_eq!(scan_spawn_lines(&p, 99_999).unwrap().lines.len(), 1);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn 분신_띄움과_끝_알림_줄도_고른다() {
        let p = std::env::temp_dir().join(format!("chammo-agents-{}.jsonl", std::process::id()));
        let call = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Agent","input":{"description":"조사"}}]}}"#;
        let launched = r#"{"type":"user","toolUseResult":{"status":"async_launched","agentId":"a1"},"message":{"content":[{"type":"tool_result","tool_use_id":"t1"}]}}"#;
        let note = r#"{"type":"user","message":{"content":"<task-notification>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>"}}"#;
        let queued = r#"{"type":"queue-operation","content":"<task-notification>\n<tool-use-id>t1</tool-use-id>"}"#; // 줄 서기 기록 — 뺀다
        let plain = r#"{"type":"user","message":{"content":"그냥 말"}}"#;
        let mid = r#"{"type":"attachment","attachment":{"type":"queued_command","prompt":"<task-notification>\n<tool-use-id>t1</tool-use-id>"}}"#; // 일하는 도중 끝 알림
        std::fs::write(&p, format!("{call}\n{launched}\n{note}\n{queued}\n{plain}\n{mid}\n")).unwrap();
        assert_eq!(scan_spawn_lines(&p, 0).unwrap().lines, vec![call.to_string(), launched.to_string(), note.to_string(), mid.to_string()]);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn 분신_기록_꼬리는_띄운_호출_id_로_찾는다() {
        let dir = std::env::temp_dir().join(format!("chammo-sub-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("agent-a1.meta.json"), r#"{"agentType":"general-purpose","description":"조사","toolUseId":"t1"}"#).unwrap();
        std::fs::write(dir.join("agent-a1.jsonl"), format!("{}\n{{\"type\":\"assistant\"}}\n", "x".repeat(200))).unwrap();
        std::fs::write(dir.join("agent-a2.meta.json"), r#"{"toolUseId":"t2"}"#).unwrap(); // 안 물어본 것 — 뺀다
        let got = read_subagent_tails(&dir, &["t1".to_string(), "t9".to_string()], 64);
        assert_eq!(got.len(), 1);
        assert_eq!((got[0].tool_use_id.as_str(), got[0].agent_id.as_str()), ("t1", "a1"));
        assert_eq!(got[0].tail, "{\"type\":\"assistant\"}\n"); // 끝 64바이트 — 잘린 첫 줄은 버린다
        assert!(got[0].mtime > 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
