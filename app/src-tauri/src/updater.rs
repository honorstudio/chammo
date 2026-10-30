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
    let up = app.updater().map_err(|e| e.to_string())?;
    let Some(u) = up.check().await.map_err(|e| {
        crate::usage_counts::record_crash("updater"); // 익명 사용 통계 — 종류 이름만
        e.to_string()
    })?
    else {
        return Err("none".into());
    };
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
