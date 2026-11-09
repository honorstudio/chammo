//! 앱 창 안 칸(iframe)이 바깥 사이트로 넘어가지 않게(2026-11-05 참모 업데이트 — 시안 칸 링크를 누르면 칸이 바깥 사이트로 가서,
//! 그 사이트가 남의 칸에 안 띄우게 막아 둬 하얗게 비었다). 맥 WKWebView 는 칸 이동도 navigation 처리기에 넘긴다(wry navigation_policy —
//! 메인 프레임만 거르지 않음): 앱 창(바깥 웹페이지 창 webpage 빼고)의 http(s) 바깥 주소 이동은 막고, 그 창 화면의 window.__frameNav(주소)를 부른다 —
//! 화면이 누른 칸(포커스)이 있으면 그 참모·프로젝트 브라우저로 연다(ui/followLink watchFrameNav). 스크립트 location·되돌아가기·PDF 링크도 이 길.
//! 앱 자신의 주소(tauri·hodoc·harnitor·modeframe, 개발판 localhost:1420, 윈도우 *.localhost)는 그대로. 윈도우 WebView2 는 칸 이동을
//! 이 처리기에 안 넘긴다 — 거기선 링크 다리·칸 지킴이(ui/frameGuard)가 막는다
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, Url};

/// 막을 이동인가 — 바깥 웹페이지 창(webpage)이 아니고, http(s)이고, 이 기기 주소(localhost·127.0.0.1·::1·*.localhost)가 아닌 것
pub fn blocks(label: &str, url: &Url) -> bool {
    if label == crate::webpage::LABEL || !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(h) = url.host_str() else { return false };
    let h = h.trim_start_matches('[').trim_end_matches(']');
    if h == "localhost" || h.ends_with(".localhost") {
        return false;
    }
    h.parse::<std::net::IpAddr>().map_or(true, |ip| !ip.is_loopback())
}

/// 그 창 화면에 넘기는 한 줄 — 주소는 JSON 글로(따옴표·줄바꿈이 코드가 되지 않게). 메뉴 window.__menu 와 같은 길
pub fn call_js(url: &str) -> String {
    format!("window.__frameNav&&window.__frameNav({})", serde_json::to_string(url).unwrap_or_else(|_| "\"\"".into()))
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("frame-nav")
        .on_navigation(|wv, url| {
            if !blocks(wv.label(), url) {
                return true;
            }
            let _ = wv.eval(call_js(url.as_str()));
            false
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn 바깥_사이트로_가는_칸_이동은_막는다() {
        for s in ["https://shipping.example.com/", "http://example.org/loc", "https://www.awwwards.com/sites/zeroz?ref=1", "http://192.168.0.10/", "https://hodoc.localhost.evil.com/"] {
            assert!(blocks("main", &u(s)), "{s}");
            assert!(blocks("reader-1", &u(s)), "{s}");
        }
    }

    #[test]
    fn 화면에_넘기는_줄은_주소를_글로만() {
        assert_eq!(call_js("https://a.com/x?q=1"), r#"window.__frameNav&&window.__frameNav("https://a.com/x?q=1")"#);
        assert_eq!(call_js("https://a.com/\");alert(1)//"), r#"window.__frameNav&&window.__frameNav("https://a.com/\");alert(1)//")"#);
    }

    #[test]
    fn 앱_자신의_주소와_바깥_웹페이지_창은_그대로() {
        for s in ["tauri://localhost/", "hodoc://localhost/Users/me/a.html", "http://hodoc.localhost/C:/a.html", "http://tauri.localhost/", "http://localhost:1420/", "http://127.0.0.1:47441/doc.html", "http://[::1]:3000/", "harnitor://localhost/", "about:blank", "about:srcdoc", "data:text/html,x", "blob:tauri://localhost/x"] {
            assert!(!blocks("main", &u(s)), "{s}");
        }
        assert!(!blocks(crate::webpage::LABEL, &u("https://shipping.example.com/")), "바깥 웹페이지 창은 자기 처리기가 본다");
    }
}
