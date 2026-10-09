//! 있던 프로젝트(gh repo clone 한 저장소 등)에 참모 브라우저 붙이기 — GitHub #2(2026-10-06).
//! 저장소 .mcp.json 은 안 건드리고 ~/.claude.json 의 그 프로젝트 local scope(projects.<git 루트>.mcpServers)에 등록한다 —
//! 공유 저장소에 diff 가 안 남고, local 은 .mcp.json 보다 위라 승인 창도 없다(2.1.290 실측: 같은 이름이 아니면 둘 다 뜬다).
//! 이름은 'playwright', 그 이름을 다른 서버(저장소 .mcp.json 의 남의 헤드리스 래퍼 등)가 쓰면 'chammo-browser' — 둘이 같이 떠
//! 우리 쪽 browser_ask_human 이 늘 있다. 떠 있던 claude 가 projects 칸을 기본값 모양으로 다시 써서 지울 수 있어(교훈),
//! 붙인 칸은 <데이터>/browser-attached.json 에 남기고 앱 켤 때·세션 띄우기 직전에 다시 본다(reassert)
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const NAMES: [&str; 2] = ["playwright", "chammo-browser"];
const WRAPPER: &str = "chammo-browser-mcp.js";

/// 옛 이름 껍데기 — 참모 브라우저 시절 .mcp.json 이 git 으로 여러 기계에 퍼져서 명령 이름만 남겼다(~/bin/local-browser-mcp → exec node …/chammo-browser-mcp.js)
const SHIM: &str = "local-browser-mcp";

/// 이 서버가 우리 래퍼를 띄우나 — args 중 하나가 …/chammo-browser-mcp.js(윈도우 역슬래시도),
/// 또는 명령이 옛 이름 껍데기이고 이 기계의 그 껍데기가 우리 래퍼를 부를 때(공개판처럼 껍데기가 없으면 남의 것)
pub fn is_ours(server: &Value) -> bool {
    is_ours_by(server, shim_text)
}

/// shim = 명령(그대로) → 이 기계에서 그 명령 파일의 글. 시험은 가짜로
pub fn is_ours_by(server: &Value, shim: impl Fn(&str) -> Option<String>) -> bool {
    let base = |s: &str| s.replace('\\', "/").rsplit('/').next().map(str::to_string);
    if server["args"].as_array().is_some_and(|a| a.iter().filter_map(|x| x.as_str()).any(|s| base(s).as_deref() == Some(WRAPPER))) {
        return true;
    }
    let Some(cmd) = server["command"].as_str() else { return false };
    let name = base(cmd).unwrap_or_default();
    let stem = [".cmd", ".bat", ".exe", ".sh"].iter().find_map(|x| name.strip_suffix(x)).unwrap_or(&name);
    stem == SHIM && shim(cmd).is_some_and(|t| t.contains(WRAPPER))
}

/// 명령 파일 글 — 경로면 그대로, 이름이면 앱 PATH(adopt_user_path 로 터미널과 같다 → 세션도 같은 걸 띄운다)에서 찾는다. 껍데기라 앞 16KB 만
fn shim_text(cmd: &str) -> Option<String> {
    use std::io::Read;
    let path = if cmd.contains(['/', '\\']) {
        PathBuf::from(cmd)
    } else {
        let exts: &[&str] = if cfg!(windows) { &["", ".cmd", ".bat"] } else { &[""] };
        std::env::split_paths(&std::env::var_os("PATH")?).flat_map(|d| exts.iter().map(move |x| d.join(format!("{cmd}{x}")))).find(|p| p.is_file())?
    };
    let mut buf = Vec::new();
    std::fs::File::open(path).ok()?.take(16 * 1024).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

fn servers<'a>(v: Option<&'a Value>) -> Option<&'a serde_json::Map<String, Value>> {
    v?.get("mcpServers")?.as_object()
}

/// 지금 붙어 있는 우리 서버 — (이름, "local"|"project"). 저장소 .mcp.json 의 우리 것은 같은 이름의 남의 local 서버가 가리면 없는 것
pub fn link_of(cj: &Value, mcp_json: Option<&Value>, key: &str) -> Option<(String, &'static str)> {
    link_of_by(cj, mcp_json, key, shim_text)
}

pub fn link_of_by(cj: &Value, mcp_json: Option<&Value>, key: &str, shim: impl Fn(&str) -> Option<String> + Copy) -> Option<(String, &'static str)> {
    let local = servers(cj.get("projects").and_then(|p| p.get(key)));
    if let Some((n, _)) = local.and_then(|m| m.iter().find(|(_, s)| is_ours_by(s, shim))) {
        return Some((n.clone(), "local"));
    }
    let (n, _) = servers(mcp_json)?.iter().find(|(_, s)| is_ours_by(s, shim))?;
    if local.is_some_and(|m| m.contains_key(n)) {
        return None;
    }
    Some((n.clone(), "project"))
}

/// 저장소 .mcp.json 중 실제로 뜨는 것만 — Claude 는 승인한 것(enabledMcpjsonServers·enableAllProjectMcpServers)만 띄운다.
/// 승인 자리 = ~/.claude.json 그 칸 + 설정 파일들(사용자 ~/.claude/settings.json·저장소 .claude/settings.json·settings.local.json).
/// 다른 맥에서 new-project 로 만든 저장소를 clone 하면 우리 항목은 있는데 승인(settings.local.json)은 git 밖이라 없다
pub fn approved_mcp(mcp_json: Option<&Value>, cj: &Value, key: &str, settings: &[Value]) -> Option<Value> {
    let p = cj.get("projects").and_then(|p| p.get(key)).cloned().unwrap_or(Value::Null);
    let places: Vec<&Value> = std::iter::once(&p).chain(settings.iter()).collect();
    let listed = |field: &str, n: &str| places.iter().any(|v| v[field].as_array().is_some_and(|a| a.iter().any(|x| x.as_str() == Some(n))));
    let all = places.iter().any(|v| v["enableAllProjectMcpServers"] == json!(true));
    let m = servers(mcp_json)?;
    let kept: serde_json::Map<String, Value> =
        m.iter().filter(|(n, _)| !listed("disabledMcpjsonServers", n) && (all || listed("enabledMcpjsonServers", n))).map(|(n, v)| (n.clone(), v.clone())).collect();
    Some(json!({ "mcpServers": kept }))
}

/// 쓸 이름 — 그 프로젝트의 local·저장소 .mcp.json 어디에도 없는 첫 이름. 둘 다 남이 쓰면 None
pub fn pick_name(cj: &Value, mcp_json: Option<&Value>, key: &str) -> Option<&'static str> {
    let local = servers(cj.get("projects").and_then(|p| p.get(key)));
    let project = servers(mcp_json);
    NAMES.into_iter().find(|n| !local.is_some_and(|m| m.contains_key(*n)) && !project.is_some_and(|m| m.contains_key(*n)))
}

/// 남이 쓰는 'playwright'(우리 것 아님) — 화면·결과가 "저장소 것과 같이 뜬다"고 알리게
pub fn other_playwright(cj: &Value, mcp_json: Option<&Value>, key: &str) -> bool {
    other_playwright_by(cj, mcp_json, key, shim_text)
}

pub fn other_playwright_by(cj: &Value, mcp_json: Option<&Value>, key: &str, shim: impl Fn(&str) -> Option<String> + Copy) -> bool {
    let local = servers(cj.get("projects").and_then(|p| p.get(key)));
    [local, servers(mcp_json)].into_iter().flatten().any(|m| m.get("playwright").is_some_and(|s| !is_ours_by(s, shim)))
}

/// 프로필 이름 = 폴더 이름(새 프로젝트와 같은 규칙). 앞 점은 떼고, 경로 글자가 있거나 비면 None — paths.js checkProfile 과 같다
pub fn profile_of(dir: &Path) -> Option<String> {
    let n = dir.file_name()?.to_string_lossy().trim_start_matches('.').to_string();
    (!n.is_empty() && !n.contains(['/', '\\', '\0'])).then_some(n)
}

/// local 칸에 넣을 항목 — 기계마다라서 절대 경로 그대로. 시험 데이터 폴더면 래퍼가 같은 곳을 쓰게 env 로 적는다(setup.js 와 같은 판단)
pub fn entry(node: &str, wrapper: &str, profile: &str, browser_home: Option<&str>) -> Value {
    let mut e = json!({"type": "stdio", "command": node, "args": [wrapper, profile]});
    if let Some(h) = browser_home {
        e["env"] = json!({"CHAMMO_BROWSER_HOME": h});
    }
    e
}

/// 붙이기 — 고친 글(이미 붙어 있으면 None)과 이름. 이름 둘 다 남이 쓰면 Err.
/// 처음 보는 프로젝트 칸은 Claude 기본 칸과 함께 만든다(반쪽 칸이면 Claude 가 기본값을 안 섞는다 — computer_use 와 같은 이유)
/// settings = 승인 자리 설정 파일들(approved_mcp)
pub fn attach_text(text: &str, key: &str, e: &Value, mcp_json: Option<&Value>, settings: &[Value]) -> Result<(Option<String>, String), String> {
    let mut v: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if !v.is_object() {
        return Err("not an object".into());
    }
    if let Some((n, _)) = link_of(&v, approved_mcp(mcp_json, &v, key, settings).as_ref(), key) {
        return Ok((None, n));
    }
    let name = pick_name(&v, mcp_json, key).ok_or_else(|| crate::i18n::tr("playwright·chammo-browser 이름을 둘 다 다른 서버가 쓰고 있어 — 도구 화면에서 하나를 정리해 줘", "Both names (playwright, chammo-browser) are taken by other servers — remove one in Tools").to_string())?;
    let projects = v.as_object_mut().ok_or("not an object")?.entry("projects").or_insert_with(|| json!({}));
    let p = projects.as_object_mut().ok_or("projects")?.entry(key).or_insert_with(crate::computer_use::new_project);
    let p = p.as_object_mut().ok_or("project")?;
    let m = p.entry("mcpServers").or_insert_with(|| json!({}));
    if !m.is_object() {
        *m = json!({});
    }
    m.as_object_mut().ok_or("mcpServers")?.insert(name.into(), e.clone());
    Ok((Some(serde_json::to_string_pretty(&v).map_err(|e| e.to_string())? + "\n"), name.into()))
}

/// 남긴 칸 중 사라진 것만 다시 넣는다 — (고친 글, 다시 넣은 키들). 폴더가 없어졌거나 다른 길로 붙어 있으면 건너뜀
pub fn reassert_text(text: &str, rec: &[Attached], mcp_of: impl Fn(&str) -> (Option<Value>, Vec<Value>), dir_ok: impl Fn(&str) -> bool) -> Result<(Option<String>, Vec<String>), String> {
    let mut cur = text.to_string();
    let mut back = Vec::new();
    for r in rec {
        if !dir_ok(&r.dir) {
            continue;
        }
        let (mj, set) = mcp_of(&r.dir);
        if let (Some(t), _) = attach_text(&cur, &r.key, &r.entry, mj.as_ref(), &set)? {
            cur = t;
            back.push(r.key.clone());
        }
    }
    Ok(((!back.is_empty()).then_some(cur), back))
}

// ───────── 기록 ─────────

#[derive(Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct Attached {
    /// ~/.claude.json projects 칸 이름(git 루트)
    pub key: String,
    /// 프로젝트 폴더
    pub dir: String,
    pub name: String,
    pub entry: Value,
}

fn record_file() -> PathBuf {
    crate::config::data_file("browser-attached.json")
}

pub fn read_record() -> Vec<Attached> {
    std::fs::read_to_string(record_file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_record(v: &[Attached]) -> Result<(), String> {
    let f = record_file();
    let tmp = f.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())
}

/// 도구 화면에서 사람이 지웠다 — 다시 넣지 않게 기록에서 뺀다
pub fn forget(root: &Path, name: &str) {
    let key = key_of(root);
    let mut rec = read_record();
    let n = rec.len();
    rec.retain(|r| !(r.key == key && r.name == name));
    if rec.len() != n {
        let _ = write_record(&rec);
    }
}

// ───────── 파일 ─────────

/// Claude 가 local 칸을 적는 이름 — 진짜 경로의 git 루트(워크트리면 본 저장소, 링크는 풀어서). git 이 아니면 폴더 그대로
pub fn key_of(dir: &Path) -> String {
    // 윈도우 canonicalize 는 \\?\C:\… 를 붙인다 — Claude 칸 이름(C:/…)과 안 맞으니 떼어 낸다
    let real = std::fs::canonicalize(dir).map(|p| PathBuf::from(p.to_string_lossy().trim_start_matches(r"\\?\").to_string())).unwrap_or_else(|_| dir.to_path_buf());
    let top = crate::claude::git(&real, &["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    let root = Path::new(&top).file_name().is_some_and(|n| n == ".git").then(|| Path::new(&top).parent().map(Path::to_path_buf)).flatten();
    crate::tools::project_key(&root.unwrap_or(real).to_string_lossy())
}

fn read_mcp_json(dir: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(dir.join(".mcp.json")).ok()?).ok()
}

/// 승인 자리 설정 파일들 — 사용자·저장소·저장소 로컬
fn read_settings(dir: &Path) -> Vec<Value> {
    [crate::tools::cfg().dir.join("settings.json"), dir.join(".claude/settings.json"), dir.join(".claude/settings.local.json")]
        .iter()
        .map(|p| crate::tools::read_json(p))
        .filter(|v| v.is_object())
        .collect()
}

/// 폴더 하나의 저장소 쪽 — (.mcp.json, 승인 설정들)
fn repo_of(dir: &Path) -> (Option<Value>, Vec<Value>) {
    (read_mcp_json(dir), read_settings(dir))
}

/// 래퍼를 띄울 node — 맥은 앱이 고른 node 링크(<데이터>/tools/bin/node, 바꿔도 링크만 고치면 따라온다), 윈도우는 고른 node
fn node_cmd(data: &Path) -> Option<String> {
    let p = if cfg!(windows) { crate::browser_setup::chosen_node(data)?.0 } else { crate::browser_fix::node_link(data) };
    std::fs::metadata(&p).ok()?;
    Some(p.to_string_lossy().into_owned())
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BrowserLink {
    /// 브라우저 자동화가 깔려 있나 — 아니면 버튼 대신 설정의 '설치'
    pub available: bool,
    pub connected: bool,
    /// 붙은 서버 이름(도구 이름 mcp__<이름>__…)
    pub name: String,
    /// "local"(앱이 붙임) | "project"(저장소 .mcp.json — 새 프로젝트)
    pub scope: String,
    /// 저장소 등에 다른 'playwright' 가 있다 — 붙이면 chammo-browser 이름으로 같이 뜬다
    pub other: bool,
    /// 이번에 새로 붙였나(붙이기 결과에서만)
    pub added: bool,
}

/// 이 폴더 상태 — 버튼을 띄울지
pub fn status_at(dir: &Path) -> BrowserLink {
    // 붙여 둔 칸을 떠 있던 claude 가 지웠으면 먼저 되살린다 — 화면이 '안 붙음'을 보이기 전에
    reassert_for(&dir.to_string_lossy());
    let data = crate::config::data_dir();
    let cj = crate::tools::read_json(&crate::tools::cfg().json);
    let (mj, set) = repo_of(dir);
    let key = key_of(dir);
    let link = link_of(&cj, approved_mcp(mj.as_ref(), &cj, &key, &set).as_ref(), &key);
    BrowserLink {
        available: crate::browser::installed(data),
        connected: link.is_some(),
        scope: link.as_ref().map(|l| l.1.to_string()).unwrap_or_default(),
        name: link.map(|l| l.0).unwrap_or_default(),
        other: other_playwright(&cj, mj.as_ref(), &key),
        added: false,
    }
}

/// 붙이기 — 앱(사람이 누름)·scripts/app browser connect 가 부른다. 저장소 파일은 하나도 안 쓴다
pub fn attach_at(dir: &Path) -> Result<BrowserLink, String> {
    use crate::i18n::tr;
    let data = crate::config::data_dir();
    if !dir.is_dir() {
        return Err(format!("{}: {}", tr("폴더가 없어", "No such folder"), dir.display()));
    }
    if !crate::browser::installed(data) {
        return Err(tr("브라우저 자동화가 아직 안 깔렸어 — 설정 → 기능 → 브라우저 자동화의 '설치'부터", "Browser automation is not installed yet — press Install in Settings → Features → Browser automation").into());
    }
    let profile = profile_of(dir).ok_or_else(|| tr("이 폴더 이름으로는 프로필을 못 만들어", "Can't make a profile name from this folder").to_string())?;
    let node = node_cmd(data).ok_or_else(|| tr("쓸 Node 가 없어 — 설정의 브라우저 자동화 '설치'를 다시", "No Node to run it — press Install in browser automation again").to_string())?;
    let wrapper = crate::browser::tool_dir(data).join("bin").join(WRAPPER).to_string_lossy().into_owned();
    let home = crate::config::home();
    let bh = (!crate::config::is_real_data(&home, data)).then(|| data.join("browser").to_string_lossy().into_owned());
    let e = entry(&node, &wrapper, &profile, bh.as_deref());
    let key = key_of(dir);
    let (mj, set) = repo_of(dir);
    let wrote = crate::computer_use::edit(
        |t| attach_text(t, &key, &e, mj.as_ref(), &set).map(|(next, _)| next),
        |v| link_of(v, approved_mcp(mj.as_ref(), v, &key, &set).as_ref(), &key).is_some(),
    )?;
    let mut st = status_at(dir);
    st.added = wrote;
    // 앱이 붙인 칸만 다시 볼 목록에 — 저장소 .mcp.json(새 프로젝트)으로 붙은 건 Claude 가 지울 일이 없다
    if st.scope == "local" {
        let mut rec = read_record();
        rec.retain(|r| r.key != key);
        rec.push(Attached { key, dir: dir.to_string_lossy().into_owned(), name: st.name.clone(), entry: e });
        write_record(&rec)?;
    }
    Ok(st)
}

/// 붙여 둔 칸이 사라졌으면 다시 — 앱 켤 때·세션 띄우기 직전. 다시 넣은 키 수
pub fn reassert() -> usize {
    let rec = read_record();
    if rec.is_empty() {
        return 0;
    }
    let mut back = Vec::new();
    let r = crate::computer_use::edit(
        |t| {
            let (next, b) = reassert_text(t, &rec, |d| repo_of(Path::new(d)), |d| Path::new(d).is_dir())?;
            back = b;
            Ok(next)
        },
        |v| {
            rec.iter().filter(|r| Path::new(&r.dir).is_dir()).all(|r| {
                let (mj, set) = repo_of(Path::new(&r.dir));
                link_of(v, approved_mcp(mj.as_ref(), v, &r.key, &set).as_ref(), &r.key).is_some()
            })
        },
    );
    match r {
        Ok(true) => {
            crate::claude::log_out("browser-attach", &format!("reassert {}", back.join(",")));
            back.len()
        }
        Ok(false) => 0,
        Err(e) => {
            crate::claude::log_out("browser-attach", &format!("reassert failed: {e}"));
            0
        }
    }
}

/// 세션 띄우기 직전 — 이 폴더(또는 그 git 루트)가 붙여 둔 칸이면 다시 본다. 기록이 없으면 ~/.claude.json 을 안 읽는다
pub fn reassert_for(cwd: &str) {
    let rec = read_record();
    if rec.is_empty() {
        return;
    }
    let key = key_of(Path::new(cwd));
    if rec.iter().any(|r| r.key == key) {
        reassert();
    }
}

#[tauri::command]
pub async fn project_browser(dir: String) -> BrowserLink {
    let d = PathBuf::from(crate::config::expand(&crate::config::home(), &dir));
    tauri::async_runtime::spawn_blocking(move || status_at(&d)).await.unwrap_or_default()
}

#[tauri::command]
pub async fn project_browser_attach(dir: String) -> Result<BrowserLink, String> {
    let d = PathBuf::from(crate::config::expand(&crate::config::home(), &dir));
    tauri::async_runtime::spawn_blocking(move || attach_at(&d)).await.map_err(|e| e.to_string())?
}

/// scripts/app browser status|connect <폴더> → 답 줄(JSON). 엔진은 앱 안에만(HQ 는 데스크탑 권한이 막혀 있을 수 있다 — #1)
pub fn answer(verb: &str, dir: &str) -> Value {
    let d = PathBuf::from(crate::config::expand(&crate::config::home(), dir));
    let r = match verb {
        "connect" => attach_at(&d),
        _ => Ok(status_at(&d)),
    };
    match r {
        Ok(s) => json!({"ok": true, "dir": d, "link": s}),
        Err(e) => json!({"ok": false, "dir": d, "error": e}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: &str = "/Users/u/.chammo/tools/chammo-browser/bin/chammo-browser-mcp.js";
    fn v(t: &str) -> Value {
        serde_json::from_str(t).unwrap()
    }
    fn ours() -> Value {
        entry("/Users/u/.chammo/tools/bin/node", W, "shop", None)
    }
    // 저장소에 커밋된 남의 playwright(헤드리스 래퍼 같은 것) — 이슈 #2 의 project-a. 옛 이름 껍데기는 기계마다 달라 여기선 안 쓴다(옛_이름_… 시험)
    fn repo_other() -> Value {
        json!({"mcpServers": {"playwright": {"type": "stdio", "command": "someone-browser-mcp", "args": ["shop"]}, "supabase": {"type": "http", "url": "https://x"}}})
    }

    #[test]
    fn 우리_래퍼인지는_args_의_파일_이름으로() {
        assert!(is_ours(&ours()));
        assert!(is_ours(&json!({"command": "node", "args": ["${HOME}/.chammo/tools/chammo-browser/bin/chammo-browser-mcp.js", "p"]})));
        assert!(is_ours(&json!({"command": "node.exe", "args": [r"C:\Users\Me\.chammo\tools\chammo-browser\bin\chammo-browser-mcp.js", "p"]})));
        assert!(!is_ours_by(&json!({"command": "local-browser-mcp", "args": ["shop"]}), |_| None));
        assert!(!is_ours(&json!({"command": "npx", "args": ["@playwright/mcp", "--extension"]})));
        assert!(!is_ours(&json!({"command": "node", "args": ["/x/not-chammo-browser-mcp.js.bak"]})));
        assert!(!is_ours(&json!({"type": "http", "url": "https://x/chammo-browser-mcp.js"})));
    }

    #[test]
    fn 옛_이름_껍데기는_우리_래퍼를_부를_때만_우리_것() {
        // 아이맥 .mcp.json 5곳의 local-browser-mcp — ~/bin 껍데기가 exec node …/chammo-browser-mcp.js 한다(2026-10-09 qa/office-imac)
        let shim = "#!/bin/bash\nexec node \"$D/tools/chammo-browser/bin/chammo-browser-mcp.js\" \"$@\"\n";
        let old = json!({"command": "local-browser-mcp", "args": ["shop"]});
        assert!(is_ours_by(&old, |c| (c == "local-browser-mcp").then(|| shim.to_string())));
        // 절대 경로·윈도우 .cmd 도 이름으로
        assert!(is_ours_by(&json!({"command": "/Users/u/bin/local-browser-mcp", "args": ["p"]}), |_| Some(shim.into())));
        assert!(is_ours_by(&json!({"command": r"C:\Users\Me\bin\local-browser-mcp.cmd", "args": ["p"]}), |_| Some(shim.into())));
        // 이 기계에 껍데기가 없거나(공개판이 project-a 를 clone) 옛 참모 브라우저 코드를 부르면 남의 것
        assert!(!is_ours_by(&old, |_| None));
        assert!(!is_ours_by(&old, |_| Some("exec node ~/Desktop/dev/browser/bin/local-browser-mcp.js \"$@\"".into())));
        // 이름이 다르면 껍데기 안을 안 본다
        assert!(!is_ours_by(&json!({"command": "my-mcp", "args": []}), |_| Some(shim.into())));
    }

    #[test]
    fn 옛_이름이_저장소에_있으면_붙은_것으로_보고_하나_더_안_붙인다() {
        let shim = |_: &str| Some("exec node \"$D/tools/chammo-browser/bin/chammo-browser-mcp.js\"".to_string());
        let mj = json!({"mcpServers": {"playwright": {"command": "local-browser-mcp", "args": ["shop"]}}});
        let all = [json!({"enableAllProjectMcpServers": true})];
        let ap = approved_mcp(Some(&mj), &v("{}"), "/d/shop", &all);
        assert_eq!(link_of_by(&v("{}"), ap.as_ref(), "/d/shop", shim), Some(("playwright".into(), "project")));
        assert!(!other_playwright_by(&v("{}"), Some(&mj), "/d/shop", shim));
    }

    #[test]
    fn 저장소에_남의_playwright_가_있으면_chammo_browser_로_따로_붙고_저장소는_그대로() {
        let mj = repo_other();
        let (t, name) = attach_text(r#"{"projects":{}}"#, "/d/shop", &ours(), Some(&mj), &[]).unwrap();
        assert_eq!(name, "chammo-browser");
        let t = v(&t.unwrap());
        assert_eq!(t["projects"]["/d/shop"]["mcpServers"]["chammo-browser"], ours());
        assert!(t["projects"]["/d/shop"]["mcpServers"].get("playwright").is_none()); // 남의 것을 local 로 덮어 가리지 않는다
        assert_eq!(link_of(&t, Some(&mj), "/d/shop"), Some(("chammo-browser".into(), "local")));
        assert!(other_playwright(&t, Some(&mj), "/d/shop"));
    }

    #[test]
    fn 아무것도_없으면_playwright_이름으로() {
        let (t, name) = attach_text("{}", "/d/shop", &ours(), None, &[]).unwrap();
        assert_eq!(name, "playwright");
        let t = v(&t.unwrap());
        // 처음 보는 칸은 Claude 기본 칸과 함께 — 반쪽 칸 금지
        assert_eq!(t["projects"]["/d/shop"]["allowedTools"], json!([]));
        assert_eq!(t["projects"]["/d/shop"]["mcpServers"]["playwright"], ours());
    }

    #[test]
    fn 이미_붙어_있으면_안_쓴다() {
        // local 에 이미
        let (t, _) = attach_text("{}", "/d/shop", &ours(), None, &[]).unwrap();
        let t = t.unwrap();
        assert_eq!(attach_text(&t, "/d/shop", &ours(), None, &[]).unwrap(), (None, "playwright".into()));
        // 새 프로젝트(.mcp.json 에 우리 것 + new-project 가 .claude/settings.local.json 에 적은 승인)
        let mj = json!({"mcpServers": {"playwright": ours()}});
        let ok = [json!({"enabledMcpjsonServers": ["playwright"]})];
        assert_eq!(attach_text("{}", "/d/shop", &ours(), Some(&mj), &ok).unwrap(), (None, "playwright".into()));
        assert_eq!(link_of(&v("{}"), Some(&mj), "/d/shop"), Some(("playwright".into(), "project")));
    }

    #[test]
    fn 저장소의_우리_것을_남의_local_이_가리면_안_붙은_것() {
        // local-browser setup 이 local 에 --extension playwright 를 넣어 둔 폴더 — local 이 이겨서 우리 것이 안 뜬다
        let mj = json!({"mcpServers": {"playwright": ours()}});
        let cj = json!({"projects": {"/d/shop": {"mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp", "--extension"]}}}}});
        assert_eq!(link_of(&cj, Some(&mj), "/d/shop"), None);
        let (t, name) = attach_text(&cj.to_string(), "/d/shop", &ours(), Some(&mj), &[]).unwrap();
        assert_eq!(name, "chammo-browser");
        assert!(t.is_some());
    }

    #[test]
    fn 저장소의_우리_것도_승인이_없으면_안_뜨는_것() {
        // 다른 맥에서 new-project 로 만든 저장소를 clone — .mcp.json 에 우리 항목은 있는데 승인(settings.local.json)은 git 밖이라 없다
        let mj = json!({"mcpServers": {"playwright": ours(), "db": {"command": "x"}}});
        let cj = json!({"projects": {}});
        assert_eq!(approved_mcp(Some(&mj), &cj, "/d/shop", &[]).unwrap(), json!({"mcpServers": {}}));
        // 승인 자리 셋 — ~/.claude.json 칸·설정 파일의 목록·모두 승인
        let cj2 = json!({"projects": {"/d/shop": {"enabledMcpjsonServers": ["playwright"]}}});
        assert!(approved_mcp(Some(&mj), &cj2, "/d/shop", &[]).unwrap()["mcpServers"].get("playwright").is_some());
        let set = json!({"enabledMcpjsonServers": ["playwright"]});
        assert!(approved_mcp(Some(&mj), &cj, "/d/shop", &[set]).unwrap()["mcpServers"].get("playwright").is_some());
        let all = json!({"enableAllProjectMcpServers": true});
        assert_eq!(approved_mcp(Some(&mj), &cj, "/d/shop", &[all.clone()]).unwrap()["mcpServers"].as_object().unwrap().len(), 2);
        // 끈 것은 모두 승인이어도 빠진다
        let off = json!({"projects": {"/d/shop": {"disabledMcpjsonServers": ["playwright"]}}});
        assert!(approved_mcp(Some(&mj), &off, "/d/shop", &[all]).unwrap()["mcpServers"].get("playwright").is_none());
        assert!(approved_mcp(None, &cj, "/d/shop", &[]).is_none());
        // 승인 없는 우리 것 → 안 붙은 것, 이름은 그 자리를 피해 chammo-browser
        let shown = approved_mcp(Some(&mj), &cj, "/d/shop", &[]);
        assert_eq!(link_of(&cj, shown.as_ref(), "/d/shop"), None);
        assert_eq!(pick_name(&cj, Some(&mj), "/d/shop"), Some("chammo-browser"));
    }

    #[test]
    fn 이름_둘_다_남이_쓰면_안_건드리고_이유() {
        let mj = json!({"mcpServers": {"playwright": {"command": "x"}, "chammo-browser": {"command": "y"}}});
        let r = attach_text("{}", "/d/shop", &ours(), Some(&mj), &[]);
        assert!(r.is_err());
    }

    #[test]
    fn 다른_칸과_다른_프로젝트는_그대로() {
        let base = r#"{"numStartups":3,"projects":{"/d/shop":{"allowedTools":["Bash"],"mcpServers":{"mine":{"command":"m"}},"hasTrustDialogAccepted":true},"/d/other":{"allowedTools":[]}},"zzz":1}"#;
        let (t, _) = attach_text(base, "/d/shop", &ours(), None, &[]).unwrap();
        let t = v(&t.unwrap());
        assert_eq!(t["projects"]["/d/shop"]["allowedTools"], json!(["Bash"]));
        assert_eq!(t["projects"]["/d/shop"]["hasTrustDialogAccepted"], json!(true)); // 신뢰를 기본값으로 덮지 않는다
        assert_eq!(t["projects"]["/d/shop"]["mcpServers"]["mine"], json!({"command": "m"}));
        assert_eq!(t["projects"]["/d/other"], json!({"allowedTools": []}));
        assert_eq!(t["numStartups"], json!(3));
        assert_eq!(t["zzz"], json!(1));
        // mcpServers 가 이상한 모양이면 객체로 바꿔 넣는다
        let (t2, _) = attach_text(r#"{"projects":{"/d/shop":{"mcpServers":[]}}}"#, "/d/shop", &ours(), None, &[]).unwrap();
        assert_eq!(v(&t2.unwrap())["projects"]["/d/shop"]["mcpServers"]["playwright"], ours());
    }

    #[test]
    fn 깨진_설정은_안_고친다() {
        assert!(attach_text("{깨짐", "/d/shop", &ours(), None, &[]).is_err());
        assert!(attach_text("[]", "/d/shop", &ours(), None, &[]).is_err());
    }

    #[test]
    fn 떠_있던_claude_가_칸을_기본값으로_덮으면_다시_넣는다() {
        let mj = repo_other();
        let rec = vec![Attached { key: "/d/shop".into(), dir: "/d/shop".into(), name: "chammo-browser".into(), entry: ours() }];
        // 덮인 뒤 — projects 칸이 기본값 모양(mcpServers 빈 것)
        let wiped = r#"{"projects":{"/d/shop":{"allowedTools":[],"mcpServers":{},"hasTrustDialogAccepted":true}}}"#;
        let (t, back) = reassert_text(wiped, &rec, |_| (Some(mj.clone()), vec![]), |_| true).unwrap();
        assert_eq!(back, vec!["/d/shop"]);
        let t = t.unwrap();
        assert_eq!(link_of(&v(&t), Some(&mj), "/d/shop"), Some(("chammo-browser".into(), "local")));
        // 그대로면 안 쓴다
        assert_eq!(reassert_text(&t, &rec, |_| (Some(mj.clone()), vec![]), |_| true).unwrap(), (None, vec![]));
        // 폴더가 없어졌으면 건너뛴다
        assert_eq!(reassert_text(wiped, &rec, |_| (None, vec![]), |_| false).unwrap(), (None, vec![]));
    }

    #[test]
    fn 프로필_이름은_폴더_이름() {
        assert_eq!(profile_of(Path::new("/d/project-a")).as_deref(), Some("project-a"));
        assert_eq!(profile_of(Path::new("/d/.dotfiles")).as_deref(), Some("dotfiles"));
        assert_eq!(profile_of(Path::new("/d/...")), None);
        assert_eq!(profile_of(Path::new("/")), None);
    }

    #[test]
    fn 시험_데이터_폴더면_래퍼_자리를_env_로() {
        let e = entry("/n", W, "p", Some("/Users/u/.chammo-test/browser"));
        assert_eq!(e["env"]["CHAMMO_BROWSER_HOME"], json!("/Users/u/.chammo-test/browser"));
        assert!(ours().get("env").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn 칸_이름은_git_루트_워크트리는_본_저장소() {
        let d = std::env::temp_dir().join(format!("chammo-attach-key-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("repo/sub")).unwrap();
        let g = |args: &[&str]| assert!(crate::platform::command("git").current_dir(d.join("repo")).args(args).output().unwrap().status.success(), "{args:?}");
        g(&["init", "-q"]);
        g(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "i"]);
        g(&["worktree", "add", "-q", "../wt"]);
        let real = std::fs::canonicalize(d.join("repo")).unwrap().to_string_lossy().into_owned();
        assert_eq!(key_of(&d.join("repo")), real);
        assert_eq!(key_of(&d.join("repo/sub")), real);
        assert_eq!(key_of(&d.join("wt")), real);
        // git 이 아닌 폴더는 그 폴더(진짜 경로)
        std::fs::create_dir_all(d.join("plain")).unwrap();
        assert_eq!(key_of(&d.join("plain")), std::fs::canonicalize(d.join("plain")).unwrap().to_string_lossy());
        let _ = std::fs::remove_dir_all(&d);
    }
}
