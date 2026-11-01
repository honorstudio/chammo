// 앱 자동 업데이트(ADR 0005) — '새 버전' 띠의 버튼 하나가 받기 → 설치 → 다시 켜기. 조용히 깔지 않는다(사람이 띠에서 누른다)
// Tauri updater 를 Rust 명령에서만 부른다(JS 플러그인·권한 파일 없이). 무엇이든 실패하면 화면이 지금처럼 내려받기 링크로 떨어진다
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::ipc::Channel;

static ON: AtomicBool = AtomicBool::new(false);

/// 설정의 plugins.updater 에 엔드포인트가 있을 때만 켠다 — 개인 앱(tauri.private.json)은 비워서 공개판으로 덮이지 않게
pub fn enabled(plugins_updater: Option<&serde_json::Value>) -> bool {
    plugins_updater
        .and_then(|u| u.get("endpoints"))
        .and_then(|e| e.as_array())
        .is_some_and(|a| a.iter().any(|x| x.as_str().is_some_and(|s| !s.trim().is_empty())))
}

/// 빌더에 플러그인을 붙일지 정하고 기억한다(명령이 꺼진 플러그인 상태를 부르면 패닉이라 여기서 막는다)
pub fn attach<R: tauri::Runtime>(b: tauri::Builder<R>, ctx: &tauri::Context<R>) -> tauri::Builder<R> {
    let on = enabled(ctx.config().plugins.0.get("updater"));
    ON.store(on, Ordering::Relaxed);
    if on { b.plugin(tauri_plugin_updater::Builder::new().build()) } else { b }
}

/// 업데이트를 시작하며 남기는 표시 — 받을 판 번호 한 줄. 깔리고 다시 켜지면 지운다
fn pending_file() -> std::path::PathBuf {
    crate::config::data_dir().join("update-pending")
}

/// 지난 업데이트가 안 끝났나 — 시작 표시가 있는데 지금 판이 그 판보다 낮으면 그 판 번호(윈도우는 설치기가 실패해도 앱이 이미 꺼져 아무 말이 없었다)
pub fn leftover(pending: Option<&str>, current: &str) -> Option<String> {
    let to = pending.map(str::trim).filter(|t| !t.is_empty())?;
    let num = |v: &str| v.trim_start_matches('v').split('.').map(|x| x.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    (num(current) < num(to)).then(|| to.to_string())
}

/// 켤 때 한 번 — 지난 업데이트가 안 끝났으면 그 판 번호(띠가 '다시 해 볼까요'로 알린다). 표시는 읽고 지운다. 파일을 만지니 메인 스레드 밖에서(offmain_scan)
#[tauri::command]
pub async fn app_update_leftover(app: tauri::AppHandle) -> Option<String> {
    let now = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let f = pending_file();
        let pending = std::fs::read_to_string(&f).ok();
        let _ = std::fs::remove_file(&f);
        leftover(pending.as_deref(), &now)
    })
    .await
    .ok()
    .flatten()
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Step {
    /// 받기 시작 — 전체 크기(모르면 null)
    Started { total: Option<u64> },
    /// 받은 조각
    Progress { got: u64 },
    /// 다 받음 — 서명 확인·설치 중
    Installing,
}

/// latest.json 에 이 기기용 새 판이 있으면 그 번호, 없으면 None — 띠가 업데이트 버튼과 같은 곳을 본다.
/// 웹뷰는 github.com 의 latest.json 을 못 읽어서(CORS 없음) 띠는 GitHub API(IP 당 시간 60번)만 봤다 — 사무실 망에서 막히면 띠가 안 떴다
#[tauri::command]
pub async fn app_update_check(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    if !ON.load(Ordering::Relaxed) {
        return Err("off".into());
    }
    let up = app.updater().map_err(|e| e.to_string())?;
    up.check().await.map(|u| u.map(|u| u.version)).map_err(|e| e.to_string())
}

/// 받기 → 서명 확인 → 설치 → 다시 켜기. 돌려주는 Err 글은 화면이 링크로 떨어질 때 같이 적는다
#[tauri::command]
pub async fn app_update_install(app: tauri::AppHandle, on_step: Channel<Step>) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    if !ON.load(Ordering::Relaxed) {
        return Err("off".into());
    }
    // 윈도우는 설치기를 띄우자마자 플러그인이 std::process::exit(0) 을 불러 RunEvent::Exit 가 안 온다 — 그 직전 고리(맥은 안 부른다)에서
    // 평소 종료와 같은 정리와 성공 기록. 플러그인 기본 고리(cleanup_before_exit)는 이게 대신하니 끝에 같이 부른다
    let h = app.clone();
    let up = app
        .updater_builder()
        .on_before_exit(move || {
            crate::usage_counts::record_update(None);
            crate::exit_cleanup();
            h.cleanup_before_exit();
        })
        .build()
        .map_err(|e| e.to_string())?;
    let Some(u) = up.check().await.map_err(|e| {
        crate::usage_counts::record_crash("updater"); // 익명 사용 통계 — 종류 이름만
        e.to_string()
    })?
    else {
        return Err("none".into());
    };
    let _ = std::fs::write(pending_file(), &u.version);
    let mut first = true;
    let unpacking = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let unpack_mark = unpacking.clone();
    u.download_and_install(
        |got, total| {
            if first {
                first = false;
                let _ = on_step.send(Step::Started { total });
            }
            let _ = on_step.send(Step::Progress { got: got as u64 });
        },
        || {
            unpack_mark.store(true, Ordering::Relaxed);
            let _ = on_step.send(Step::Installing);
        },
    )
    .await
    .map_err(|e| {
        let _ = std::fs::remove_file(pending_file()); // 이 자리에서 실패를 바로 보여 준다 — 다음에 켤 때 또 알리지 않게
        // 익명 사용 통계 — 어느 단계에서 실패했나만(받기·풀기)
        crate::usage_counts::record_update(Some(if unpacking.load(Ordering::Relaxed) { "unpack" } else { "download" }));
        e.to_string()
    })?;
    crate::usage_counts::record_update(None);
    // 세션은 claude daemon 소속이라 앱이 다시 켜져도 안 죽는다
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::enabled;
    use serde_json::{json, Value};
    // 개인 앱(tauri.private.json)이 엔드포인트를 비우는지는 buildConfig.test.ts 가 본다 — 그 파일은 공개본에 없어서 여기서 읽으면 공개본 cargo test 가 안 지어진다

    fn conf(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    // 윈도우 업데이터는 설치기를 띄우자마자 std::process::exit(0) — RunEvent::Exit 가 안 와 앱 종료 정리(음성·Craft 저장·폰 serve·메신저)를
    // 다 건너뛰었고 성공 기록도 안 남았다(2026-11-01 점검). 끄기 직전 고리에서 같은 정리 + 성공 기록
    #[test]
    fn 윈도우_업데이트_종료도_같은_정리를_한다() {
        let up = include_str!("updater.rs");
        let install = &up[up.find("pub async fn app_update_install").unwrap()..];
        let install = &install[..install.find("\n}\n").unwrap()];
        let hook = install.find(".on_before_exit(").expect("끄기 직전 고리");
        assert!(hook < install.find("download_and_install").unwrap(), "설치에 쓰는 업데이터에 건다");
        assert!(install.contains("crate::exit_cleanup()") && install.contains("record_update(None)") && install.contains("cleanup_before_exit()"));
        let main = include_str!("main.rs");
        let exit = &main[main.find("tauri::RunEvent::Exit = event").unwrap()..];
        assert!(exit[..300].contains("exit_cleanup()"), "평소 종료도 같은 함수");
    }

    // 윈도우는 설치기가 실패해도(디스크·백신·창 닫음) 앱이 이미 꺼져 아무 말이 안 남았다 — 다음에 켤 때 판이 그대로면 띠로 알린다
    #[test]
    fn 끝나지_않은_업데이트는_판이_그대로일_때만() {
        use super::leftover;
        assert_eq!(leftover(Some("0.4.7"), "0.4.6"), Some("0.4.7".to_string()));
        assert_eq!(leftover(Some("0.4.7"), "0.4.7"), None, "깔렸다");
        assert_eq!(leftover(Some("0.4.7"), "0.4.8"), None, "그 뒤 손으로 더 새 판을 깔았다");
        assert_eq!(leftover(None, "0.4.6"), None);
        assert_eq!(leftover(Some(" "), "0.4.6"), None);
    }

    #[test]
    fn 공개판은_켜진다() {
        let c = conf(include_str!("../tauri.conf.json"));
        assert!(enabled(c.pointer("/plugins/updater")));
    }

    #[test]
    fn 엔드포인트가_없거나_비면_꺼진다() {
        assert!(!enabled(None));
        assert!(!enabled(Some(&json!({}))));
        assert!(!enabled(Some(&json!({ "endpoints": [] }))));
        assert!(!enabled(Some(&json!({ "endpoints": [" "] }))));
        assert!(enabled(Some(&json!({ "endpoints": ["https://example.com/latest.json"] }))));
    }
}
