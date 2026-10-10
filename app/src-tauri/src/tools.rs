//! 도구 화면 — MCP·플러그인·스킬을 보고 끄고 켜고 더하기(2026-10-04 사용자 "슬래시 커맨드랑 mcp skills connector … 피씨 기준으로 먼저",
//! 기획 docs/plans/2026-10-02-mcp-skills-panel.md). 사용자가 CLI 를 못 써도 되게.
//! 읽기 = 설정 파일(빠름) + claude 명령줄(MCP 상태·플러그인 목록). 고치기 = 되는 건 전부 claude 명령줄,
//! 프로젝트별 MCP 끄기만 ~/.claude.json 의 projects.<경로>.disabledMcpServers(`/mcp` 에서 끌 때 쌓이는 자리) 를 직접.
//! 고치기 전엔 늘 설정 파일을 데이터 폴더 backups/tools/<시각>/ 에 떠 둔다(깨지면 모든 프로젝트가 같이 망가진다).
//! 터미널 화면은 건드리지 않는다. CLAUDE_CONFIG_DIR 가 있으면 그 밑을 본다(시험은 그걸로)
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use crate::tools_mcp::{login_error, mcp_add_args, mcp_config, parse_mcp_list, safe_arg, set_disabled, user_server, McpConf, McpStatus};
use crate::tools_plugins::{enabled_plugin_skills, parse_available, parse_cost, parse_markets, parse_plugin_list, skills_in, Available, Market, PluginRow, ToolSkill};

/// Claude Code 설정 자리 — dir = ~/.claude(스킬·플러그인·settings.json), json = ~/.claude.json(MCP·프로젝트별 상태)
pub struct Cfg {
    pub dir: PathBuf,
    pub json: PathBuf,
}

impl Cfg {
    pub fn from(home: &Path, config_dir: Option<&str>) -> Cfg {
        match config_dir.filter(|d| !d.is_empty()) {
            Some(d) => Cfg { dir: PathBuf::from(d), json: Path::new(d).join(".claude.json") },
            None => Cfg { dir: home.join(".claude"), json: home.join(".claude.json") },
        }
    }
}

pub fn cfg() -> Cfg {
    Cfg::from(Path::new(&crate::config::home()), std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref())
}

pub fn read_json(p: &Path) -> serde_json::Value {
    std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(serde_json::Value::Null)
}

/// ~/.claude.json 의 projects 칸 이름 — Claude 는 슬래시 경로로 적는다(윈도우도 C:/…)
pub fn project_key(root: &str) -> String {
    root.replace('\\', "/").trim_end_matches('/').to_string()
}

/// ~/.claude.json 고치기 — 앱 안의 모든 길(계정 oauthAccount·믿음·화면 조종·브라우저 붙이기·MCP 끄기)이 이 하나로.
/// f = 지금 글 → 고친 글(안 바뀌면 None, 아무것도 안 쓴다) · first = 처음 쓰기 직전 한 번(백업) · ok = 쓴 뒤 다시 읽어 확인.
/// 쓰기 직전에 다시 읽어 그새 바뀌었으면(떠 있는 claude 가 썼다) 새로 읽어 다시, 확인이 틀려도(쓴 뒤에 덮였다) 다시 — 세 번까지.
/// 링크면 가리키는 파일을, 권한은 원래 것 그대로(0600). 앱 안 길끼리는 JSON_LOCK 한 줄에 선다 — 떠 있는 claude 와의 틈만 남는다
pub fn edit_json(path: &Path, mut f: impl FnMut(&str) -> Result<Option<String>, String>, mut first: impl FnMut() -> Result<(), String>, ok: impl Fn(&serde_json::Value) -> bool) -> Result<bool, String> {
    let _g = JSON_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let target = if path.is_symlink() { std::fs::canonicalize(path).map_err(|e| e.to_string())? } else { path.to_path_buf() };
    let mut wrote = false;
    for _ in 0..3 {
        let text = std::fs::read_to_string(&target).map_err(|e| e.to_string())?;
        let Some(next) = f(&text)? else { return Ok(wrote) };
        if !wrote {
            first()?;
        }
        let mut name = target.file_name().unwrap_or_default().to_os_string();
        name.push(format!(".chammo-{}", tmp_tag()));
        let tmp = target.with_file_name(name);
        std::fs::write(&tmp, &next).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perm = std::fs::metadata(&target).map(|m| m.permissions()).unwrap_or_else(|_| std::fs::Permissions::from_mode(0o600));
            let _ = std::fs::set_permissions(&tmp, perm);
        }
        if std::fs::read_to_string(&target).map_err(|e| e.to_string())? != text {
            let _ = std::fs::remove_file(&tmp);
            continue;
        }
        if let Err(e) = std::fs::rename(&tmp, &target) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.to_string());
        }
        wrote = true;
        if ok(&read_json(&target)) {
            return Ok(true);
        }
    }
    Err(crate::i18n::tr("~/.claude.json 을 다른 쪽이 계속 덮어써서 못 고쳤어 — 잠시 뒤 다시", "~/.claude.json kept being overwritten — try again shortly").into())
}

/// 앱 안에서 ~/.claude.json 을 고치는 길들의 줄 — 읽고-고치고-쓰는 사이에 다른 길이 끼면 먼저 쓴 것이 사라졌다
static JSON_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 임시 파일 꼬리 — 부를 때마다 다르게(같은 이름을 쓰던 쓰기 길끼리 서로 지웠다)
pub(crate) fn tmp_tag() -> String {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    format!("{}-{}.tmp", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

// ───────── 백업 ─────────

/// 고치기 전 설정 파일을 to_root/<stamp>/ 에 — 있는 것만
pub fn backup_into(cfg: &Cfg, to_root: &Path, stamp: &str) -> std::io::Result<PathBuf> {
    let to = to_root.join(stamp);
    std::fs::create_dir_all(&to)?;
    for (src, name) in [
        (cfg.json.clone(), ".claude.json"),
        (cfg.dir.join("settings.json"), "settings.json"),
        (cfg.dir.join("plugins/installed_plugins.json"), "installed_plugins.json"),
        (cfg.dir.join("plugins/known_marketplaces.json"), "known_marketplaces.json"),
    ] {
        if src.is_file() {
            std::fs::copy(&src, to.join(name))?;
        }
    }
    Ok(to)
}

/// 이름 순(=시각 순)으로 keep 개만 남긴다
pub fn prune_backups(root: &Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    let mut v: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    v.sort();
    let n = v.len().saturating_sub(keep);
    for p in v.into_iter().take(n) {
        let _ = std::fs::remove_dir_all(p);
    }
}

pub(crate) fn backup(c: &Cfg, project_mcp: Option<&Path>) -> Result<(), String> {
    let root = crate::config::data_dir().join("backups/tools");
    let stamp = format!("{:013}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    let to = backup_into(c, &root, &stamp).map_err(|e| format!("{}: {e}", crate::i18n::tr("백업 실패 — 안 고쳤어", "Backup failed — nothing changed")))?;
    if let Some(m) = project_mcp.filter(|m| m.is_file()) {
        let _ = std::fs::copy(m, to.join("project.mcp.json"));
    }
    prune_backups(&root, 20);
    Ok(())
}

// ───────── 명령 ─────────

fn claude(cwd: Option<&Path>, args: &[String], limit: u64) -> Result<String, String> {
    let mut c = crate::platform::command(crate::claude::claude_bin());
    c.args(args);
    // 폴더가 없으면 홈에서 — 앱이 뜬 폴더의 .mcp.json 을 건드리지 않게
    let home = PathBuf::from(crate::config::home());
    c.current_dir(cwd.filter(|d| d.is_dir()).unwrap_or(&home));
    let out = crate::platform::run_capped(&mut c, Duration::from_secs(limit)).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() { text.trim().to_string() } else { err });
    }
    Ok(text)
}

fn sargs(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

fn root_of(root: &Option<String>) -> Option<PathBuf> {
    root.as_deref().filter(|r| !r.is_empty()).map(PathBuf::from)
}

fn parked_path() -> PathBuf {
    crate::config::data_dir().join("mcp-parked.json")
}

fn read_parked() -> serde_json::Map<String, serde_json::Value> {
    read_json(&parked_path()).as_object().cloned().unwrap_or_default()
}

fn write_parked(m: &serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    let p = parked_path();
    std::fs::write(&p, serde_json::to_string_pretty(m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)); // 열쇠가 든 설정일 수 있다
    }
    Ok(())
}

/// 도구 화면 첫 그림 — 설정 파일만(빠름). MCP 상태는 tools_mcp_status, 플러그인은 tools_plugins 가 따로
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsConf {
    pub mcp: Vec<McpConf>,
    /// 모든 프로젝트에서 쉬어 둔 MCP 이름
    pub parked: Vec<String>,
    pub skills: Vec<ToolSkill>,
}

#[tauri::command]
pub async fn tools_conf(root: Option<String>) -> Result<ToolsConf, String> {
    let root = root_of(&root);
    blocking(move || {
        let c = cfg();
        let key = root.as_ref().map(|r| project_key(&r.to_string_lossy())).unwrap_or_default();
        let mj = root.as_ref().map(|r| read_json(&r.join(".mcp.json")));
        let cj = read_json(&c.json);
        let mut mcp = mcp_config(&cj, mj.as_ref().filter(|v| !v.is_null()), &key);
        // 내장 화면 조종 — mcp list 에도 설정 파일에도 없어서 따로 한 줄(맥만, Claude Code 가 맥에서만 준다)
        if cfg!(target_os = "macos") && !key.is_empty() {
            mcp.push(McpConf { name: crate::computer_use::NAME.into(), source: "builtin", target: String::new(), http: false, off_here: !crate::computer_use::enabled_in(&cj, &key) });
        }
        let mut skills = Vec::new();
        if let Some(r) = &root {
            skills.extend(skills_in(&r.join(".claude"), None, "project", None));
        }
        skills.extend(skills_in(&c.dir, None, "user", None));
        skills.extend(enabled_plugin_skills(root.as_deref()));
        Ok(ToolsConf { mcp, parked: read_parked().keys().cloned().collect(), skills })
    })
    .await
}

/// MCP 상태 — `claude mcp list`(프로젝트 폴더에서). 서버마다 잠깐 붙어 보니 몇 초 걸린다
#[tauri::command]
pub async fn tools_mcp_status(root: Option<String>) -> Result<Vec<McpStatus>, String> {
    let root = root_of(&root);
    blocking(move || Ok(parse_mcp_list(&claude(root.as_deref(), &sargs(&["mcp", "list"]), 90)?))).await
}

#[tauri::command]
pub async fn tools_plugins(root: Option<String>) -> Result<Vec<PluginRow>, String> {
    let root = root_of(&root);
    blocking(move || {
        let text = claude(root.as_deref(), &sargs(&["plugin", "list", "--json"]), 30)?;
        parse_plugin_list(&text, root.as_ref().map(|r| r.to_string_lossy().into_owned()).as_deref())
    })
    .await
}

#[tauri::command]
pub async fn tools_plugin_cost(id: String) -> Result<Option<String>, String> {
    if !safe_arg(&id) { return Err("id".into()); }
    blocking(move || Ok(parse_cost(&claude(None, &["plugin".into(), "details".into(), id], 30)?))).await
}

/// MCP 끄기·켜기. all=false 면 이 프로젝트에서만(disabledMcpServers), all=true 면 사용자 범위 서버를 모든 프로젝트에서 —
/// 끌 땐 설정을 데이터 폴더(mcp-parked.json)에 떠 두고 `claude mcp remove -s user`, 켤 땐 `claude mcp add-json -s user` 로 그대로
#[tauri::command]
pub async fn tools_mcp_set(root: Option<String>, name: String, on: bool, all: bool) -> Result<(), String> {
    if !safe_arg(&name) { return Err("name".into()); }
    let root = root_of(&root);
    if name == crate::computer_use::NAME {
        // 내장 화면 조종 — 모든 프로젝트는 기능 칸(설정 저장)으로만 바꾼다. 여긴 이 프로젝트만
        if all { return Err("computer-use: use features.computerUse".into()); }
        let key = project_key(&root.ok_or("root")?.to_string_lossy());
        return blocking(move || crate::computer_use::set_here(&key, on)).await;
    }
    blocking(move || {
        let c = cfg();
        backup(&c, None)?;
        if !all {
            let key = project_key(&root.ok_or("root")?.to_string_lossy());
            let ok = |v: &serde_json::Value| v["projects"][&key]["disabledMcpServers"].as_array().is_some_and(|a| a.iter().any(|x| x == name.as_str())) == !on;
            edit_json(&c.json, |text| set_disabled(text, &key, &name, !on).map(|n| (n != text).then_some(n)), || Ok(()), ok)?;
            return Ok(());
        }
        let mut parked = read_parked();
        if on {
            let conf = parked.get(&name).cloned().ok_or(crate::i18n::tr("쉬어 둔 설정이 없어", "No saved settings for this server"))?;
            claude(None, &["mcp".into(), "add-json".into(), "-s".into(), "user".into(), name.clone(), conf.to_string()], 30)?;
            parked.remove(&name);
            write_parked(&parked)
        } else {
            let conf = user_server(&std::fs::read_to_string(&c.json).unwrap_or_default(), &name)
                .ok_or(crate::i18n::tr("모든 프로젝트 끄기는 사용자 범위 서버만 돼", "Only user-scope servers can be turned off everywhere"))?;
            parked.insert(name.clone(), conf); // 먼저 적고 지운다 — 지운 뒤 적다 실패하면 설정이 사라진다
            write_parked(&parked)?;
            claude(None, &["mcp".into(), "remove".into(), "-s".into(), "user".into(), name], 30).map(|_| ())
        }
    })
    .await
}

#[tauri::command]
pub async fn tools_plugin_set(root: Option<String>, id: String, scope: String, on: bool) -> Result<(), String> {
    if !safe_arg(&id) || !matches!(scope.as_str(), "user" | "project" | "local") { return Err("id".into()); }
    let root = root_of(&root);
    blocking(move || {
        backup(&cfg(), None)?;
        claude(root.as_deref(), &["plugin".into(), if on { "enable" } else { "disable" }.into(), id, "-s".into(), scope], 60).map(|_| ())
    })
    .await
}

/// 일하지 않는 세션을 다시 켜서 바뀐 도구를 읽게 — `claude respawn <짧은 번호>`. 되살린 수
#[tauri::command]
pub async fn tools_respawn(ids: Vec<String>) -> Result<usize, String> {
    blocking(move || {
        let mut n = 0;
        for id in ids.into_iter().filter(|i| i.len() == 8 && i.chars().all(|c| c.is_ascii_hexdigit())) {
            if claude(None, &["respawn".into(), id], 60).is_ok() { n += 1; }
        }
        Ok(n)
    })
    .await
}

// ───────── 더하기·지우기(2단계) ─────────

/// MCP 추가 — 주소면 http, 아니면 명령. scope = local(이 프로젝트·나만)·project(.mcp.json·같이)·user(모든 프로젝트)
#[tauri::command]
pub async fn tools_mcp_add(root: Option<String>, name: String, target: String, scope: String) -> Result<(), String> {
    let args = mcp_add_args(name.trim(), &target, &scope)?;
    let root = root_of(&root);
    blocking(move || {
        backup(&cfg(), root.as_ref().map(|r| r.join(".mcp.json")).as_deref())?;
        claude(root.as_deref(), &args, 60).map(|_| ())
    })
    .await
}

/// MCP 지우기 — 쉬어 둔 것이면 쉬어 둔 설정만 지운다
#[tauri::command]
pub async fn tools_mcp_remove(root: Option<String>, name: String, scope: String) -> Result<(), String> {
    if !safe_arg(&name) || !matches!(scope.as_str(), "user" | "local" | "project" | "parked") { return Err("name".into()); }
    let root = root_of(&root);
    blocking(move || {
        backup(&cfg(), root.as_ref().map(|r| r.join(".mcp.json")).as_deref())?;
        if scope == "parked" {
            let mut parked = read_parked();
            parked.remove(&name);
            return write_parked(&parked);
        }
        claude(root.as_deref(), &["mcp".into(), "remove".into(), name.clone(), "-s".into(), scope.clone()], 30)?;
        // 앱이 붙인 참모 브라우저를 사람이 지웠다 — 다시 넣지 않게(browser_attach::reassert)
        if let (Some(r), "local") = (root.as_deref(), scope.as_str()) {
            crate::browser_attach::forget(r, &name);
        }
        Ok(())
    })
    .await
}

/// 인증 — `claude mcp login` 은 터미널(TTY)이 아니면 바로 끝난다(2.1.289 실측: "stdin isn't a terminal").
/// 그래서 안 보이는 가짜 터미널(pty)에서 돌린다 — 키는 안 넣는다(화면 조종 아님). 브라우저는 claude 가 연다. 돌아올 때까지 5분
fn login_in_pty(cwd: Option<&Path>, name: &str) -> Result<(), String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Read;
    use std::sync::{Arc, Mutex};
    let pair = native_pty_system().openpty(PtySize { rows: 30, cols: 120, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(crate::claude::claude_bin());
    cmd.args(["mcp", "login", name]);
    cmd.env("TERM", "xterm-256color");
    let home = PathBuf::from(crate::config::home());
    cmd.cwd(cwd.filter(|d| d.is_dir()).unwrap_or(&home));
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let _writer = pair.master.take_writer().map_err(|e| e.to_string())?; // 쥐고만 있다 — 닫으면 입력 끝(EOF)으로 읽힐 수 있다
    let out = Arc::new(Mutex::new(Vec::new()));
    if let Ok(mut r) = pair.master.try_clone_reader() {
        let o = out.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = r.read(&mut buf) {
                if n == 0 { break; }
                let mut v = o.lock().unwrap();
                if v.len() < 64 * 1024 { v.extend_from_slice(&buf[..n]); }
            }
        });
    }
    let until = std::time::Instant::now() + Duration::from_secs(300);
    let status = loop {
        if let Ok(Some(st)) = child.try_wait() { break Some(st); }
        if std::time::Instant::now() >= until { let _ = child.kill(); break None; }
        std::thread::sleep(Duration::from_millis(200));
    };
    let text = String::from_utf8_lossy(&out.lock().unwrap()).into_owned();
    match status {
        Some(st) if st.success() => Ok(()),
        Some(_) => Err(login_error(&text)),
        None => Err(crate::i18n::tr("5분 안에 브라우저 인증이 안 끝났어", "Sign-in did not finish within 5 minutes").into()),
    }
}

#[tauri::command]
pub async fn tools_mcp_login(root: Option<String>, name: String) -> Result<(), String> {
    if !safe_arg(&name) { return Err("name".into()); }
    let root = root_of(&root);
    blocking(move || login_in_pty(root.as_deref(), &name)).await
}

#[tauri::command]
pub async fn tools_markets() -> Result<Vec<Market>, String> {
    blocking(|| parse_markets(&claude(None, &sargs(&["plugin", "marketplace", "list", "--json"]), 30)?)).await
}

/// 마켓플레이스 add·update·remove — 저장소를 받아 오니 2분까지
#[tauri::command]
pub async fn tools_market(action: String, arg: String) -> Result<(), String> {
    if !safe_arg(&arg) || !matches!(action.as_str(), "add" | "update" | "remove") { return Err("arg".into()); }
    blocking(move || {
        backup(&cfg(), None)?;
        claude(None, &["plugin".into(), "marketplace".into(), action, arg], 120).map(|_| ())
    })
    .await
}

/// 깔 수 있는 플러그인(깔린 것 빼고)
#[tauri::command]
pub async fn tools_available(root: Option<String>) -> Result<Vec<Available>, String> {
    let root = root_of(&root);
    blocking(move || parse_available(&claude(root.as_deref(), &sargs(&["plugin", "list", "--available", "--json"]), 60)?)).await
}

/// 플러그인 설치(사용자 범위). 명령을 돌려 까는 플러그인은 -y 없이는 안 깔린다 — 사람이 그 명령을 봐야 해서 앱은 넘기지 않는다
#[tauri::command]
pub async fn tools_plugin_install(id: String) -> Result<(), String> {
    if !safe_arg(&id) { return Err("id".into()); }
    blocking(move || {
        backup(&cfg(), None)?;
        claude(None, &["plugin".into(), "install".into(), id, "-s".into(), "user".into()], 180).map(|_| ())
    })
    .await
}

#[cfg(test)]
#[path = "tools_tests.rs"]
mod tests;
