//! 맥 밖(윈도우 등)의 알림 — 맥 알림(notify_mac)과 같은 명령 이름. 윈도우는 토스트(tauri-winrt-notification),
//! 누르면 메인 창을 앞으로 가져오고 window.__notifyClick('<갈 곳>') 을 부른다(맥과 같다). 그 밖은 "없음"
use std::sync::OnceLock;
use tauri::AppHandle;
#[cfg(windows)]
use tauri::Manager;

static APP: OnceLock<AppHandle> = OnceLock::new();

/// 앱 시작 때 한 번 — 누름을 받을 때 창을 찾으려고 들고 있는다
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// 보낸다. 못 보내면 false
#[cfg(windows)]
pub fn send(title: &str, body: &str, target: &str) -> bool {
    use tauri_winrt_notification::Toast;
    let Some(app) = APP.get() else { return false };
    let exe_dir = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_string_lossy().into_owned())).unwrap_or_default();
    let id = crate::platform::toast_app_id(&exe_dir, &app.config().identifier, Toast::POWERSHELL_APP_ID);
    let (a, target) = (app.clone(), target.to_string());
    let res = Toast::new(&id)
        .title(title)
        .text1(body)
        .on_activated(move |_| {
            crate::claude::log_out("notify-click", &target);
            let (a2, t) = (a.clone(), target.clone());
            let _ = a.run_on_main_thread(move || {
                if let Some(w) = a2.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                    let arg = serde_json::to_string(&t).unwrap_or_default();
                    let _ = w.eval(format!("window.__notifyClick && window.__notifyClick({arg})"));
                }
            });
            Ok(())
        })
        .show();
    if let Err(e) = &res {
        crate::claude::log_out("notify-fail", &e.to_string());
    }
    res.is_ok()
}
#[cfg(not(windows))]
pub fn send(_title: &str, _body: &str, _target: &str) -> bool {
    false
}

/// 윈도우 설정 > 알림을 통째로 껐나(HKCU …\PushNotifications ToastEnabled = 0)
#[cfg(windows)]
fn toasts_off() -> bool {
    use std::os::windows::process::CommandExt;
    crate::platform::command("reg")
        .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications", "/v", "ToastEnabled"])
        .creation_flags(0x0800_0000)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("0x0"))
        .unwrap_or(false)
}

/// 마법사 알림 줄 — 윈도우는 따로 허락을 묻지 않는다(켜져 있으면 바로 뜬다)
#[tauri::command]
pub async fn notify_status() -> String {
    #[cfg(windows)]
    return if toasts_off() { "denied".into() } else { "granted".into() };
    #[cfg(not(windows))]
    "unavailable".into()
}

#[tauri::command]
pub async fn notify_request() -> bool {
    cfg!(windows)
}

/// 알림을 꺼 둔 사람에게 — 윈도우 설정 > 시스템 > 알림
#[tauri::command]
pub fn notify_open_settings() {
    #[cfg(windows)]
    let _ = crate::platform::open_path("ms-settings:notifications");
}
