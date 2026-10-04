//! 브라우저 자동화의 도구 부품·시험 열기 — 고른 node 로 `npm ci`(셸·PATH 에 안 기댄다, 브라우저 내려받기는 끈다)와
//! `chammo-browser check`(헤드리스·임시 프로필로 크롬을 한 번 — 화면에 안 뜨고 사람 프로필을 안 건드린다)
use crate::browser_get as bg;
use std::path::{Path, PathBuf};

/// PATH 앞에 node 폴더 — npm 이 부르는 node 가 이 node 가 되게
fn path_with(node: &Path) -> std::ffi::OsString {
    let mut parts = vec![node.parent().map(Path::to_path_buf).unwrap_or_default()];
    if let Some(p) = std::env::var_os("PATH") {
        parts.extend(std::env::split_paths(&p));
    }
    std::env::join_paths(parts).unwrap_or_default()
}

/// 도구 부품 — `node npm-cli.js ci`(셸·PATH 에 안 기댄다). 브라우저 내려받기는 끈다(크롬 베타만 쓴다 — Chrome for Testing 금지)
pub fn npm_ci(node: &Path, tool: &Path) -> Result<(), String> {
    let cli = crate::browser_node::npm_cli(node, cfg!(windows), |p| std::fs::canonicalize(p).ok()).ok_or(crate::i18n::tr("이 Node 옆에서 npm 을 찾지 못했어요", "Could not find npm next to this Node"))?;
    let out = crate::platform::run_capped(
        crate::platform::command(node)
            .arg(cli)
            .args(["ci", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"])
            .current_dir(tool)
            .env("PATH", path_with(node))
            .env("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "1")
            .env("npm_config_update_notifier", "false"),
        std::time::Duration::from_secs(900),
    )
    .map_err(|e| e.to_string())?;
    let log = [String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)].concat();
    let _ = std::fs::write(tool.join("install.log"), &log);
    if out.status.success() {
        Ok(())
    } else {
        // 윈도우는 떠 있는 세션 브라우저가 부품 파일을 쥐고 있으면 바꾸지 못한다
        let busy = log.contains("EPERM") || log.contains("EBUSY");
        let hint = if busy { crate::i18n::tr(" — 세션 브라우저를 닫고 다시 시도해 주세요", " — close session browsers and try again") } else { "" };
        Err(format!("npm: {}{hint}", bg::last_line(&log)))
    }
}

/// 시험 열기 표시 — 있으면 '시험 열기 됨'. 설치를 다시 돌리면 지운다
pub fn checked_mark(data: &Path) -> PathBuf {
    crate::browser::tool_dir(data).join(".checked")
}

/// `chammo-browser check` — 헤드리스·임시 프로필로 크롬을 한 번(화면에 안 뜨고 사람 프로필 안 건드림)
pub fn run_check(node: &Path, data: &Path) -> Result<String, String> {
    let tool = crate::browser::tool_dir(data);
    let out = crate::platform::run_capped(
        crate::platform::command(node).arg(tool.join("bin/chammo-browser.js")).arg("check").env("CHAMMO_HOME", data),
        std::time::Duration::from_secs(150),
    )
    .map_err(|e| e.to_string())?;
    let so = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(&bg::last_line(&so)).map_err(|_| format!("check: {}", bg::last_line(&String::from_utf8_lossy(&out.stderr))))?;
    if v.get("ok").and_then(|b| b.as_bool()) == Some(true) {
        let _ = std::fs::write(checked_mark(data), v.to_string());
        return Ok(v.get("version").and_then(|s| s.as_str()).unwrap_or("").to_string());
    }
    let e = v.get("error").and_then(|s| s.as_str()).unwrap_or("");
    Err(if e == "no-chrome" { crate::i18n::tr("크롬 베타를 찾지 못했어요", "Chrome Beta was not found").into() } else { format!("{}: {e}", crate::i18n::tr("시험으로 열지 못했어요", "Test open failed")) })
}

