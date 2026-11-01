//! 윈도우 알림 영역(트레이) — 메인 창 X 는 앱을 끄지 않고 숨긴다(윈도우 앱 표준). 예전엔 X = 앱 종료라
//! 폰 연결·결정 카드 토스트·팀 말 받기가 조용히 끊겼다(2026-11-01 점검). 처음 한 번만 "여기서 계속 돌아요" 토스트

use tauri::Manager;

/// 첫 안내를 띄울 차례인가 — 데이터 폴더에 표시 파일을 남겨 한 번만(지워지면 다시 한 번)
pub fn hint_due(dir: &std::path::Path) -> bool {
    let f = dir.join("tray-hint-shown");
    if f.exists() {
        return false;
    }
    let _ = std::fs::write(&f, b"1");
    true
}

/// 트레이 메뉴 글자(열기·끝내기) — 윈도우 영어판 관례대로 Exit
pub fn labels(en: bool) -> (&'static str, &'static str) {
    if en { ("Open", "Exit") } else { ("열기", "끝내기") }
}

/// 처음 X 를 눌렀을 때 한 번 뜨는 토스트 [제목, 본문]
fn hint_text(en: bool) -> (&'static str, &'static str) {
    if en {
        ("Still running after you close the window", "Chammo keeps running in the notification area, so your phone stays connected and you still get approval requests. Click its icon to reopen, or right-click and choose Exit to quit.")
    } else {
        ("창을 닫아도 계속 돌아가요", "알림 영역에서 계속 실행 중이라 폰 연결과 확인 요청 알림이 이어져요. 다시 열려면 아이콘을 누르고, 끄려면 오른쪽 클릭 후 '끝내기'를 골라요.")
    }
}

/// 앱이 뜰 때 한 번(윈도우만 부른다) — 앱 아이콘, 글자 없이 이름만 툴팁. 왼쪽 누름 = 열기, 오른쪽 = 메뉴(열기·끝내기)
pub fn setup<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let (open, quit) = labels(crate::i18n::is_en());
    let open = MenuItem::with_id(app, "tray_open", open, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray_quit", quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut b = TrayIconBuilder::with_id("main").menu(&menu).show_menu_on_left_click(false).tooltip(app.package_info().name.clone());
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.on_menu_event(|app, e| match e.id().as_ref() {
        "tray_open" => show_main(app),
        // 지금까지 X 가 하던 끄기와 같다 — 앱만 끄고 세션은 계속
        "tray_quit" => crate::quit::exit_now(app, "tray exit"),
        _ => {}
    })
    .on_tray_icon_event(|tray, e| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            show_main(tray.app_handle());
        }
    })
    .build(app)?;
    Ok(())
}

/// 메인 창을 다시 — 트레이·토스트 누름·앱 다시 켜기(single-instance)
pub fn show_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    owned_hidden(app, false);
}

/// 메인 창 X(윈도우) — 숨기고, 처음이면 안내 토스트
pub fn hide_main<R: tauri::Runtime>(window: &tauri::Window<R>) {
    let _ = window.hide();
    owned_hidden(window.app_handle(), true);
    if hint_due(crate::config::data_dir()) {
        let (title, body) = hint_text(crate::i18n::is_en());
        let _ = crate::notify_mac::send(title, body, ""); // 윈도우는 notify_other.rs 가 이 이름(토스트)
    }
}

/// 메인 창에 붙어 뜨는 창(세션 브라우저 칸·주소 미리보기)은 윈도우에서 주인 창이 숨어도 남아서 같이 가렸다 돌려놓는다
fn owned_hidden<R: tauri::Runtime>(app: &tauri::AppHandle<R>, hidden: bool) {
    crate::webpage::app_hidden(app, hidden);
    #[cfg(windows)]
    {
        let _ = app.run_on_main_thread(move || crate::browser_pane_win::owner_hidden(hidden));
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn 첫_안내는_한_번만() {
        let d = std::env::temp_dir().join(format!("chammo-tray-hint-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        assert!(super::hint_due(&d), "처음엔 띄운다");
        assert!(!super::hint_due(&d), "두 번째부터는 안 띄운다");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 메뉴는_열기_끝내기_두_줄() {
        assert_eq!(super::labels(false), ("열기", "끝내기"));
        assert_eq!(super::labels(true), ("Open", "Exit"));
    }

    // X 는 윈도우에서 숨기기(트레이), 맥은 원래대로 숨기기 — 메인 창 X 로 앱이 꺼지는 줄이 남아 있으면 안 된다
    #[test]
    fn 윈도우_메인_창_x_는_트레이로_숨긴다() {
        let main = include_str!("main.rs");
        let ev = &main[main.find(".on_window_event(").unwrap()..];
        let ev = &ev[..ev.find(".build(ctx)").unwrap()];
        assert!(ev.contains("tray::hide_main("), "윈도우 X → 트레이로 숨기기");
        assert!(!ev.contains("window.label() == \"main\" => window.app_handle().exit(0)"), "X 로 앱을 끄던 줄");
    }
}
