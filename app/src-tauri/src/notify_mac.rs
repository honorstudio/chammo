//! macOS 알림을 앱 이름·아이콘으로 — UNUserNotificationCenter.
//! osascript "display notification" 은 '스크립트 편집기' 이름으로 묶이고 눌러도 우리 앱이 안 열렸다(2026-09-27 사용자).
//! 알림을 누르면 메인 창을 앞으로 가져오고 window.__notifyClick('<갈 곳>') 을 부른다(갈 곳은 프론트 domain/notify noteTarget).
//! .app 번들로 돌 때만 쓸 수 있다 — `tauri dev` 맨 실행 파일에서 부르면 죽으므로 available() 로 가른다

use std::sync::OnceLock;

use block2::{DynBlock, RcBlock};
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread};
use objc2_foundation::{NSBundle, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Manager};

use crate::claude::log_out;

static APP: OnceLock<AppHandle> = OnceLock::new();

/// 요청 id = "<갈 곳>#<밀리초>" — 같은 id 면 앞 알림을 덮어쓰므로 시각을 붙인다. 눌리면 # 앞을 떼어 쓴다
pub fn request_id(target: &str, ms: u128) -> String {
    format!("{target}#{ms}")
}

pub fn target_of(request_id: &str) -> &str {
    request_id.rsplit_once('#').map_or("", |(t, _)| t)
}

/// .app 번들 안에서 돌고 있나 (번들 id 가 있고 경로가 .app)
pub fn available() -> bool {
    let b = NSBundle::mainBundle();
    b.bundleIdentifier().is_some() && b.bundlePath().to_string().ends_with(".app")
}

define_class!(
    // SAFETY: NSObject 는 상속 요건이 없고, Delegate 는 Drop 을 구현하지 않는다
    #[unsafe(super = NSObject)]
    #[name = "HonorNotifyDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        /// 앱이 앞에 있을 때도 배너를 띄운다(기본은 조용히 삼킨다)
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion.call((UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List,));
        }

        /// 알림을 눌렀다 → 메인 창을 앞으로 + 갈 곳을 프론트에
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &DynBlock<dyn Fn()>,
        ) {
            let id = response.notification().request().identifier().to_string();
            let target = target_of(&id).to_owned();
            log_out("notify-click", &target);
            if let Some(app) = APP.get() {
                let a = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Some(w) = a.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                        let arg = serde_json::to_string(&target).unwrap_or_default();
                        let _ = w.eval(format!("window.__notifyClick && window.__notifyClick({arg})"));
                    }
                });
            }
            completion.call(());
        }
    }
);

/// 앱 시작 때 한 번 — 누름을 받을 델리게이트를 달고 알림 권한을 묻는다(처음 한 번 macOS 가 사용자에게 묻는다)
pub fn init(app: &AppHandle) {
    if !available() {
        return;
    }
    let _ = APP.set(app.clone());
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let delegate: objc2::rc::Retained<Delegate> = unsafe { msg_send![Delegate::alloc(), init] };
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    // delegate 는 약한 참조라 앱이 끝날 때까지 들고 있어야 한다
    std::mem::forget(delegate);
    let done = RcBlock::new(|granted: Bool, err: *mut NSError| {
        let why = unsafe { err.as_ref() }.map(|e| e.localizedDescription().to_string()).unwrap_or_default();
        log_out("notify-auth", &format!("granted={} {why}", granted.as_bool()));
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge,
        &done,
    );
}

/// 보낸다. 번들이 아니면 false(부르는 쪽이 osascript 로 대신)
pub fn send(title: &str, body: &str, target: &str) -> bool {
    if APP.get().is_none() {
        return false;
    }
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let id = NSString::from_str(&request_id(target, ms));
    let req = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
    // 권한이 없으면(거절·아직 안 물음) 여기로 오류가 온다 — notify.log 에 남긴다
    let done = RcBlock::new(|err: *mut NSError| {
        if let Some(e) = unsafe { err.as_ref() } {
            log_out("notify-fail", &e.localizedDescription().to_string());
        }
    });
    UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&req, Some(&done));
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 요청_id_에서_갈_곳을_되찾는다() {
        assert_eq!(target_of(&request_id("inbox", 1)), "inbox");
        assert_eq!(target_of(&request_id("session:abc-1", 17)), "session:abc-1");
        // 세션 이름에 # 이 있어도 마지막 # 뒤(시각)만 뗀다
        assert_eq!(target_of(&request_id("session:a#b", 5)), "session:a#b");
        assert_eq!(target_of("no-hash"), "");
    }

    #[test]
    fn 테스트_실행_파일은_번들이_아니다() {
        assert!(!available());
    }
}

/// 마법사 알림 줄 — 지금 권한 상태. 번들이 아니면(dev) "unavailable"
#[tauri::command]
pub async fn notify_status() -> String {
    if !available() {
        return "unavailable".into();
    }
    let (tx, rx) = std::sync::mpsc::channel::<isize>();
    let done = RcBlock::new(move |s: std::ptr::NonNull<objc2_user_notifications::UNNotificationSettings>| {
        let _ = tx.send(unsafe { s.as_ref() }.authorizationStatus().0);
    });
    UNUserNotificationCenter::currentNotificationCenter().getNotificationSettingsWithCompletionHandler(&done);
    // 0 아직 안 물음 · 1 거부 · 2 허용 · 3 임시 허용 · 4 한시 허용
    match rx.recv_timeout(std::time::Duration::from_secs(3)) {
        Ok(0) => "notDetermined",
        Ok(1) => "denied",
        Ok(_) => "granted",
        Err(_) => "unavailable",
    }
    .into()
}

/// 마법사 "알림 허용" 버튼 — macOS 가 묻는 창을 띄우고 답을 기다린다(아직 안 물었을 때만 창이 뜬다)
#[tauri::command]
pub async fn notify_request() -> bool {
    if !available() {
        return false;
    }
    let (tx, rx) = std::sync::mpsc::channel::<bool>();
    let done = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
        let _ = tx.send(granted.as_bool());
    });
    UNUserNotificationCenter::currentNotificationCenter().requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge,
        &done,
    );
    rx.recv_timeout(std::time::Duration::from_secs(120)).unwrap_or(false)
}

/// 거부돼 있으면 앱은 다시 못 묻는다 — 시스템 설정 알림 화면을 연다
#[tauri::command]
pub fn notify_open_settings() {
    let _ = std::process::Command::new("/usr/bin/open").arg("x-apple.systempreferences:com.apple.Notifications-Settings.extension").spawn();
}
