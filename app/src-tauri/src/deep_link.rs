//! chammo:// 딥링크(ADR 0015) — 초대 페이지(chammo.app/join)의 'Chammo 에서 열기'가 chammo://join?code=…&server=… 로 앱을 연다.
//! 받은 주소는 아무 웹페이지나 만들 수 있는 남의 글이다 — 팀 초대 창에 코드를 채워 띄우기만 하고, 들어가기는 사람이 누른다.
//! 맥은 Apple 이벤트(앱이 꺼져 있었으면 켜면서), 윈도우는 새 프로세스 인자 → single-instance 가 떠 있는 앱으로 넘긴다
use std::sync::Mutex;

/// 앱이 켜지는 중이라 화면이 아직 없을 때 받은 초대 — 화면이 뜨면 team_take_invite 로 한 번 가져간다
static PENDING: Mutex<Option<String>> = Mutex::new(None);

/// 딥링크 주소 → 초대 칸에 채울 글. chammo://join 이 아니거나 코드가 초대 모양이 아니면 None.
/// 원문을 그대로 넘기지 않고 읽은 것(서버·코드)으로 다시 만든다 — 서버가 있으면 사람이 슬랙에서 본 그 https 링크, 없으면 코드만
pub fn invite_from_url(url: &str) -> Option<String> {
    let u = url.trim();
    if u.len() > 600 || !(u.starts_with("chammo://join?") || u.starts_with("chammo://join/?")) {
        return None;
    }
    let (server, code) = crate::team_relay::parse_invite(u);
    if code.is_empty() {
        return None;
    }
    Some(match server {
        Some(s) if crate::team_relay::server_ok(&s).is_some() => crate::team_relay::invite_link(&s, &code),
        Some(_) => return None,
        None => code,
    })
}

/// 화면이 가져간다(한 번만)
pub fn take() -> Option<String> {
    PENDING.lock().ok().and_then(|mut p| p.take())
}

/// 받은 주소들 — 초대면 메인 창을 앞으로 띄우고 화면에 넘긴다(화면이 아직이면 PENDING 에 두고 화면이 켤 때 가져감)
pub fn handle<R: tauri::Runtime>(app: &tauri::AppHandle<R>, urls: impl IntoIterator<Item = String>) {
    use tauri::Manager;
    let Some(inv) = urls.into_iter().find_map(|u| invite_from_url(&u)) else { return };
    if let Ok(mut p) = PENDING.lock() {
        *p = Some(inv.clone());
    }
    crate::claude::log_out("deep-link", "team invite");
    if let Some(w) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        // 화면이 받으면 PENDING 을 비운다(take) — 아직 안 떴으면 켤 때 가져간다
        let _ = w.eval(format!("window.__teamInvite && window.__teamInvite({})", serde_json::to_string(&inv).unwrap_or_default()));
    }
}

/// 화면이 켤 때·__teamInvite 를 받을 때 — 기다리던 초대 가져가기(메인 창만)
#[tauri::command]
pub fn team_take_invite(window: tauri::WebviewWindow) -> Option<String> {
    (window.label() == "main").then(take).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 초대_딥링크만_받고_https_링크로_다시_만든다() {
        assert_eq!(invite_from_url("chammo://join?code=Ab-_9z").as_deref(), Some("Ab-_9z"));
        assert_eq!(invite_from_url("chammo://join?code=Ab-_9z&server=https%3A%2F%2Frelay.chammo.app").as_deref(), Some("https://chammo.app/join#Ab-_9z"));
        assert_eq!(invite_from_url("chammo://join?server=https%3A%2F%2Frelay.test&code=Ab").as_deref(), Some("https://chammo.app/join#Ab&server=https%3A%2F%2Frelay.test"));
    }

    #[test]
    fn 윈도우_셸이_붙이는_빗금도_받는다() {
        // 10-24 윈도우 PC 실측: Start-Process 'chammo://join?code=…' → 앱이 받은 인자는 "chammo://join/?code=…"(떠 있을 때 넘김이 이걸로 빗나갔다)
        assert_eq!(invite_from_url("chammo://join/?code=Ab-_9z&server=https%3A%2F%2Frelay.chammo.app").as_deref(), Some("https://chammo.app/join#Ab-_9z"));
        assert_eq!(invite_from_url("chammo://join/?code=Ab").as_deref(), Some("Ab"));
    }

    #[test]
    fn 초대가_아닌_딥링크는_무시한다() {
        for u in [
            "chammo://other?code=Ab",
            "chammo://join?code=",
            "chammo://join?code=a%20b",
            "chammo://join?code=Ab&server=http%3A%2F%2Fevil.example",
            "chammo://join?code=Ab&server=https%3A%2F%2Fu%3Ap%40evil.example",
            "https://chammo.app/join#Ab",
            "",
        ] {
            assert_eq!(invite_from_url(u), None, "{u}");
        }
        assert_eq!(invite_from_url(&format!("chammo://join?code={}", "a".repeat(700))), None, "너무 긴 주소");
    }

    #[test]
    fn 공개판·개인판_둘_다_chammo_주소를_등록한다() {
        // 개인판(tauri.private.json)은 plugins.deep-link 를 안 덮어 공개판 설정을 그대로 받는다 — 둘 다 같은 이름을 등록(맥은 먼저 등록된·최근 실행 앱이 받는다)
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["plugins"]["deep-link"]["desktop"]["schemes"], serde_json::json!(["chammo"]));
        // 개인판 설정은 공개본에 없다 — 있을 때만 본다
        let Ok(raw) = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.private.json")) else { return };
        let private: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(private["plugins"].get("deep-link").is_none());
    }
}
