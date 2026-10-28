//! 참모 브라우저(2026-10-28 사용자) — 참모 앱 서랍의 '참모 브라우저'를 누르면 사람이 바로 쓰는 크롬이 스페이스 칸에 뜬다.
//! 프로필은 참모(HQ)마다 하나(HQ 폴더 이름 — 참모 세션 브라우저와 같은 프로필, 로그인이 같이 남는다). 세션 없이도:
//! 래퍼의 스크립트 길(chammo-browser launch --owner <앱 pid>)로 띄워 세션 크롬과 같은 사본·같은 화면 규칙(Dock 안 뜸·가짜 화면)을 그대로 쓰고,
//! 앱이 꺼지면 지킴이가 닫는다. 이미 떠 있으면(참모 세션이 쓰는 중) 그 크롬을 그대로 칸에 — 새로 띄우지 않는다
use serde::Deserialize;

/// launch 의 인자 — 주인 = 앱(앱이 살아 있는 동안 크롬 유지). 기다림 30초(다른 손이 프로필을 쥐고 있으면 그만큼 기다렸다 같이 쓴다)
pub fn launch_args(cli: &str, profile: &str, owner: u32) -> Vec<String> {
    vec![cli.into(), "launch".into(), profile.into(), "--owner".into(), owner.to_string(), "--wait".into(), "30".into()]
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct Launched {
    pub ok: bool,
    #[serde(default)]
    pub error: String,
}

/// launch 출력의 마지막 줄(한 줄 JSON) — 못 읽으면 오류 글
pub fn parse_launch(stdout: &str) -> Result<(), String> {
    let line = stdout.trim().lines().last().unwrap_or_default();
    match serde_json::from_str::<Launched>(line) {
        Ok(l) if l.ok => Ok(()),
        Ok(l) => Err(if l.error.is_empty() { "chammo-browser launch failed".into() } else { l.error }),
        Err(_) => Err("chammo-browser did not answer".into()),
    }
}

/// 이 참모의 브라우저 프로필 — HQ 폴더 이름(세션 브라우저 붙이기와 같은 규칙, browser_attach::profile_for)
pub fn hq_profile() -> Option<String> {
    let hq = crate::config::hq_dir(&crate::config::home(), &crate::config::current(), |k| std::env::var(k).ok());
    crate::browser_attach::profile_for(std::path::Path::new(&hq))
}

/// 참모 브라우저 프로필 — 탭 줄이 세션 없는 참모 브라우저도 그 참모 독에 둔다
#[tauri::command(async)]
pub fn hq_browser_profile() -> Option<String> {
    hq_profile()
}

/// 참모 브라우저를 띄운다(이미 떠 있으면 그대로) — 답 = 프로필(칸 열쇠 b:<프로필>)
#[tauri::command]
pub async fn hq_browser_open() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let profile = hq_profile().ok_or("no HQ browser profile")?;
        if crate::agent_browser::live_up(&profile) {
            return Ok(profile);
        }
        let data = crate::config::data_dir();
        let node = crate::browser_attach::node_for(data).ok_or("node is not installed — Settings > Features > Browser")?;
        let cli = crate::browser::tool_dir(data).join("bin/chammo-browser.js");
        let mut cmd = crate::platform::command(node);
        cmd.args(launch_args(&cli.to_string_lossy(), &profile, std::process::id()));
        let out = crate::platform::run_capped(&mut cmd, std::time::Duration::from_secs(60)).map_err(|e| e.to_string())?;
        parse_launch(&String::from_utf8_lossy(&out.stdout))?;
        // 래퍼가 live 파일을 쓰면 칸이 붙는다 — 늦어도 5초
        for _ in 0..50 {
            if crate::agent_browser::live_up(&profile) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        #[cfg(not(test))]
        crate::claude::log_out("browser", &format!("참모 브라우저를 띄웠어 ({profile})"));
        Ok(profile)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 앱이_주인으로_띄운다() {
        assert_eq!(launch_args("/d/cli.js", "my-hq", 42), ["/d/cli.js", "launch", "my-hq", "--owner", "42", "--wait", "30"]);
    }

    #[test]
    fn 띄우기_답_읽기() {
        assert!(parse_launch("warn line\n{\"ok\":true,\"wsEndpoint\":\"ws://127.0.0.1:1/x\",\"shared\":false}\n").is_ok());
        assert_eq!(parse_launch("{\"ok\":false,\"code\":2,\"error\":\"busy\"}"), Err("busy".into()));
        assert_eq!(parse_launch(""), Err("chammo-browser did not answer".into()));
        assert_eq!(parse_launch("{\"ok\":false}"), Err("chammo-browser launch failed".into()));
    }
}
