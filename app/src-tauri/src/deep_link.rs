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

/// 토스트를 누르면 여는 주소 — chammo://notify?go=<갈 곳(퍼센트 인코딩)>. 윈도우 토스트는 누름을 프로세스 안 콜백으로만 받아서
/// 알림 센터에서 누른 것(띄운 토스트가 사라진 뒤)은 아무 데도 안 갔다 — 주소로 열면 셸 → 새 프로세스 → single-instance 로 떠 있는 앱에 온다
pub fn notify_link(go: &str) -> String {
    let mut out = String::from("chammo://notify?go=");
    for b in go.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// 알림 주소 → 갈 곳. 아무 웹페이지나 만들 수 있는 주소라 좁게 — 300자 아래, 제어 문자 없음, 인코딩이 맞을 때만(화면은 앞으로 띄우고 그 자리로 옮기기만 한다)
pub fn notify_target(url: &str) -> Option<String> {
    let u = url.trim();
    let raw = u.strip_prefix("chammo://notify?go=").or_else(|| u.strip_prefix("chammo://notify/?go="))?;
    if raw.is_empty() || raw.len() > 900 {
        return None;
    }
    let b = raw.as_bytes();
    let mut bytes = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let h = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            bytes.push(u8::from_str_radix(h, 16).ok()?);
            i += 3;
        } else {
            bytes.push(b[i]);
            i += 1;
        }
    }
    let go = String::from_utf8(bytes).ok()?;
    (go.chars().count() <= 300 && !go.chars().any(char::is_control)).then_some(go)
}

/// 윈도우 토스트 XML — 누르면(띄운 것·알림 센터 모두) 알림 주소를 연다
#[cfg_attr(not(windows), allow(dead_code))]
pub fn toast_xml(title: &str, body: &str, go: &str) -> String {
    let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;");
    format!(
        r#"<toast activationType="protocol" launch="{}"><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text></binding></visual></toast>"#,
        esc(&notify_link(go)),
        esc(title),
        esc(body)
    )
}

/// 누른 알림을 화면이 가져갈 때까지 들고 있는 시간 — 앱을 막 켜는 중이면 웹뷰가 뜨기까지 몇 초 걸린다
pub const CLICK_KEEP: std::time::Duration = std::time::Duration::from_secs(60);

/// 마지막으로 누른 알림 갈 곳 — 웹뷰가 덜 떴으면(앱이 꺼져 있다 켜짐·바꿔 끼우는 중) window.__notifyClick 이 없어 버려졌다.
/// 화면이 켜질 때·누름을 받을 때 notify_click_take 로 한 번 가져간다
#[derive(Default)]
pub struct ClickBox(Option<(String, std::time::Instant)>);

impl ClickBox {
    pub fn put(&mut self, go: &str, now: std::time::Instant) {
        self.0 = Some((go.to_owned(), now));
    }
    pub fn take(&mut self, now: std::time::Instant) -> Option<String> {
        self.0.take().filter(|(_, at)| now.saturating_duration_since(*at) <= CLICK_KEEP).map(|(go, _)| go)
    }
}

static CLICK: Mutex<ClickBox> = Mutex::new(ClickBox(None));

/// 메인 창 화면이 가져간다(한 번만) — 켤 때 한 번, 그리고 누름을 받을 때(받았으니 비운다). 다른 창은 못 가져간다(초대 team_take_invite 와 같다)
#[tauri::command]
pub fn notify_click_take(window: tauri::WebviewWindow) -> Option<String> {
    (window.label() == "main").then(|| CLICK.lock().ok().and_then(|mut b| b.take(std::time::Instant::now()))).flatten()
}

/// 알림을 눌렀다(맥 알림 센터·윈도우 토스트 같은 길) — 메인 창(트레이·⌘Q 로 숨었어도)을 띄우고 그 자리로
pub fn open_notify<R: tauri::Runtime>(app: &tauri::AppHandle<R>, go: &str) {
    use tauri::Manager;
    crate::claude::log_out("notify-click", go);
    if let Ok(mut b) = CLICK.lock() {
        b.put(go, std::time::Instant::now());
    }
    // ⌘Q 는 창을 숨기고 Dock 에서 뺀다(main.rs to_background) — Reopen·초대 링크처럼 Dock 을 되살린다. 시험판은 그대로 숨김
    #[cfg(target_os = "macos")]
    if crate::test_window::spot().is_none() {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    }
    crate::tray::show_main(app);
    if let Some(w) = app.get_webview_window("main") {
        let arg = serde_json::to_string(go).unwrap_or_default();
        let _ = w.eval(format!("window.__notifyClick && window.__notifyClick({arg})"));
    }
}

/// 딥링크로 받을 주소인가(초대·알림) — single-instance 가 다른 인자(그냥 다시 켜기)와 가른다
pub fn wanted(url: &str) -> bool {
    invite_from_url(url).is_some() || notify_target(url).is_some()
}

/// 받은 주소들 — 알림이면 창을 띄워 그 자리로, 초대면 메인 창을 앞으로 띄우고 화면에 넘긴다(화면이 아직이면 PENDING 에 두고 화면이 켤 때 가져감)
pub fn handle<R: tauri::Runtime>(app: &tauri::AppHandle<R>, urls: impl IntoIterator<Item = String>) {
    use tauri::Manager;
    let urls: Vec<String> = urls.into_iter().collect();
    if let Some(go) = urls.iter().find_map(|u| notify_target(u)) {
        return open_notify(app, &go);
    }
    let Some(inv) = urls.into_iter().find_map(|u| invite_from_url(&u)) else { return };
    if let Ok(mut p) = PENDING.lock() {
        *p = Some(inv.clone());
    }
    crate::claude::log_out("deep-link", "team invite");
    if let Some(w) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        if crate::test_window::spot().is_none() {
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        }
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

    // 2026-11-01 윈도우 시험판 실측: 트레이로 숨긴 채 알림 센터에서 토스트를 누르면 창이 안 떴다(띄운 토스트만 프로세스 안 콜백이 받았다).
    // 토스트는 누르면 chammo://notify?go=<갈 곳> 를 연다 → single-instance 로 떠 있는 앱에 넘어온다
    #[test]
    fn 알림_주소는_갈_곳을_싣고_되읽는다() {
        for go in ["inbox", "session:5e5e0a1b", "card:모모 · 시험 참모:c0de", "team:room-1"] {
            let url = notify_link(go);
            assert!(url.starts_with("chammo://notify?go="), "{url}");
            assert!(url.is_ascii(), "주소는 ASCII 로: {url}");
            assert_eq!(notify_target(&url).as_deref(), Some(go));
        }
        // 윈도우 셸이 넣는 빗금 모양(교훈: chammo://join?x → chammo://join/?x)
        assert_eq!(notify_target("chammo://notify/?go=inbox").as_deref(), Some("inbox"));
    }

    // 2026-11-18 사용자 "알림에서 세션으로 바로 가는 게 어떨 땐 되고 안 되고" — 누름은 window.__notifyClick 한 번 쏘고 끝이라
    // 웹뷰가 덜 뜬 때(앱이 막 켜짐·바꿔 끼우는 중) 누른 건 버려졌다. 들고 있다가 화면이 켜질 때 한 번 가져간다
    #[test]
    fn 누른_알림은_화면이_가져갈_때까지_들고_있다가_한_번만_준다() {
        let t0 = std::time::Instant::now();
        let mut b = ClickBox::default();
        b.put("session:abc", t0);
        assert_eq!(b.take(t0 + CLICK_KEEP / 2).as_deref(), Some("session:abc"));
        assert_eq!(b.take(t0 + CLICK_KEEP / 2), None, "두 번 안 준다");
        b.put("inbox", t0);
        b.put("team:r1", t0);
        assert_eq!(b.take(t0).as_deref(), Some("team:r1"), "마지막 누름만");
        b.put("inbox", t0);
        assert_eq!(b.take(t0 + CLICK_KEEP + std::time::Duration::from_millis(1)), None, "오래된 누름은 버린다 — 늦게 켠 화면이 엉뚱한 때 옮기지 않게");
    }

    #[test]
    fn 알림_주소는_남이_만든_글이라_좁게_받는다() {
        assert_eq!(notify_target("chammo://join?code=x"), None);
        assert_eq!(notify_target("chammo://notify?go="), None);
        assert_eq!(notify_target(&format!("chammo://notify?go={}", "a".repeat(400))), None, "너무 길다");
        assert_eq!(notify_target("chammo://notify?go=a%0Ab"), None, "줄바꿈 같은 제어 문자");
        assert_eq!(notify_target("chammo://notify?go=%ZZ"), None, "깨진 인코딩");
    }

    #[test]
    fn 토스트_xml_은_누르면_주소를_열고_글자는_이스케이프() {
        let x = toast_xml("참모 <확인>", "A & B \"C\"", "inbox");
        assert!(x.contains(r#"activationType="protocol""#));
        assert!(x.contains(&format!(r#"launch="{}""#, notify_link("inbox"))));
        assert!(x.contains("참모 &lt;확인&gt;") && x.contains("A &amp; B &quot;C&quot;"));
    }

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
