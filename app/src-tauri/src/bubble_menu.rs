//! 메뉴 '참모 배지' 체크 항목(맥 보기 메뉴·윈도우 창 메뉴 보기·윈도우 트레이) — 설정 › 기능의 bubble 과 같은 값(2026-11-13 사용자 "불편해하는 사람들이 있음, 메뉴에서 켜고 끄게").
//! 누르면 화면(웹)을 거치지 않고 Rust 가 바로 설정을 바꾼다 — 메인 창 화면이 멈춰도(11-05 TDZ) 메뉴로 배지를 다시 켜 대화할 길이 남게.
//! 배지 창은 orch_bubble::watch 가 0.7초 안에 설정을 보고 내리거나 띄운다

/// 메뉴·트레이 항목 id — 앱 메뉴 사건 하나에서만 받는다(트레이 메뉴 사건도 같은 전역 처리로 온다: 두 곳에서 받으면 두 번 뒤집힌다)
pub const MENU_ID: &str = "bubble_toggle";

/// 메뉴 글자
pub fn label(en: bool) -> &'static str {
    if en { "Assistant Badge" } else { "참모 배지" }
}

/// 메인 창 화면에 '설정 다시 읽기' — scripts/app config reload 와 같은 줄(domain/appctl intentOf). 메뉴 ✓ 는 Rust 가 이미 다시 만들었다
const RELOAD_JS: &str = r#"window.__appctl && window.__appctl({"action":"config","arg":"reload"})"#;

/// 메뉴에서 눌렀다 — 파일의 지금 값을 뒤집어 저장하고, 메뉴·트레이 ✓ 와 메인 화면 설정을 맞춘다
pub fn toggle(app: &tauri::AppHandle) {
    use tauri::Manager;
    // 파일에서 다시 읽고 뒤집는다 — 화면·scripts/app 이 방금 바꾼 값을 옛 기억으로 덮지 않게
    let on = !crate::config::reload_config().features.bubble;
    if let Err(e) = crate::config::set_bubble(on) {
        crate::claude::log_out("bubble", &format!("menu toggle: {e}"));
        crate::refresh_menu(app); // ✓ 를 파일 값으로 되돌린다(누르면 체크 항목이 스스로 바뀐다)
        return;
    }
    crate::refresh_menu(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(RELOAD_JS);
    }
}

/// 메인 창 오류 화면 '참모 배지로 대화하기' — 꺼져 있으면 켠다. 메인 창 화면만 부른다(그 화면이 멈춰 있어 다시 읽기는 안 보낸다)
#[tauri::command]
pub fn bubble_rescue(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("main window only".into());
    }
    if crate::config::reload_config().features.bubble {
        return Ok(());
    }
    crate::config::set_bubble(true)?;
    crate::refresh_menu(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn 글자는_한글_참모_배지_영어_assistant_badge() {
        assert_eq!(super::label(false), "참모 배지");
        assert_eq!(super::label(true), "Assistant Badge");
    }

    #[test]
    fn 다시_읽기_줄은_appctl_config_reload() {
        assert!(super::RELOAD_JS.contains(r#"{"action":"config","arg":"reload"}"#));
        assert!(super::RELOAD_JS.starts_with("window.__appctl && "), "화면이 아직 안 붙었으면 조용히 넘어간다");
    }

    /// 보기 메뉴에 체크 항목 — ✓ 는 설정 값(f.bubble)
    #[test]
    fn 보기_메뉴에_설정_값으로_체크된_참모_배지() {
        let main = include_str!("main.rs");
        let build = &main[main.find("fn build_menu").unwrap()..];
        let build = &build[..build.find("let session = ").unwrap()];
        assert!(build.contains("CheckMenuItem::with_id(app, bubble_menu::MENU_ID, bubble_menu::label(i18n::is_en()), true, f.bubble, None::<&str>)"), "보기 메뉴 참모 배지 ✓");
    }

    /// 메뉴 누름은 Rust 가 바로(메인 화면 __menu 로 안 넘긴다) — 화면이 멈춰도 켤 수 있게. 한 곳에서만 받는다
    #[test]
    fn 누름은_앱_메뉴_사건에서_rust_가_바로() {
        let main = include_str!("main.rs");
        let ev = &main[main.find(".on_menu_event(|app, e|").unwrap()..];
        let ev = &ev[..ev.find("route_menu(app, &id);").unwrap()];
        let at = ev.find("bubble_menu::MENU_ID").expect("앱 메뉴 사건이 받는다");
        assert!(ev[at..].contains("bubble_menu::toggle(app);\n                return;"), "뒤집고 끝 — route_menu 로 안 넘긴다");
        let ours = &ev[ev.find("const OURS").unwrap()..];
        assert!(!ours[..ours.find(']').unwrap()].contains("bubble"), "웹 __menu 길에 안 넣는다");
        assert!(!include_str!("tray.rs").contains("bubble_menu::toggle"), "트레이 사건에서 또 받으면 두 번 뒤집힌다");
    }

    /// 오류 화면 단추가 부를 수 있게 — 명령 표에 있다
    #[test]
    fn 오류_화면_배지_켜기_명령이_등록돼_있다() {
        assert!(include_str!("main.rs").contains("bubble_menu::bubble_rescue,"));
    }

    /// 메뉴를 다시 만들 때(설정 저장·scripts/app feature·메뉴 누름) 트레이 ✓ 도 같이
    #[test]
    fn 메뉴를_다시_만들면_트레이도() {
        let main = include_str!("main.rs");
        for f in ["pub fn refresh_menu", "fn rebuild_menu(app: tauri::AppHandle)"] {
            let body = &main[main.find(f).unwrap()..];
            let body = &body[..body.find("\n}\n").unwrap()];
            assert!(body.contains("tray::refresh("), "{f} 가 트레이도 다시");
        }
    }
}
