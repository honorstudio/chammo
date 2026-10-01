//! 참모가 앱을 대신 조작한다 — HQ scripts/app 이 <데이터 폴더>/app.jsonl 에 {ts, action, arg} 를 한 줄 쓰면
//! 0.7초 안에 메인 창 웹뷰의 window.__appctl(<그 줄>) 로 넘긴다(route_menu 처럼 권한 파일 없이 되는 eval).
//! 무엇을 할지는 프론트 domain/appctl.ts 가 정한다. show.jsonl(reader::watch)과 같은 방식 — 앱이 켜지기 전 줄은 건너뛴다
use tauri::{Manager, Runtime};

/// offset 뒤 새 줄 중 JSON 객체인 것만(원문 그대로) + 다음 offset. 파일이 줄었으면 처음부터
pub fn new_lines(content: &str, offset: usize) -> (Vec<String>, usize) {
    let start = if offset > content.len() { 0 } else { offset };
    let lines = content[start..]
        .lines()
        .filter(|l| serde_json::from_str::<serde_json::Value>(l).map(|v| v.is_object()).unwrap_or(false))
        .map(str::to_owned)
        .collect();
    (lines, content.len())
}

/// 화면을 바꾸는 명령이면 숨어 있던 창도 앞으로(⌘W 로 숨겼을 수 있다). 음성·기능 켜기는 창을 안 띄운다
fn wants_window(line: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(line)
        .ok()
        .and_then(|v| v.get("action").and_then(|a| a.as_str()).map(|a| matches!(a, "open" | "focus")))
        .unwrap_or(false)
}

/// 선택지 답 넣기(윈도우 scripts/choice — 가짜 터미널이 없어 앱이 대신 누른다). 위·아래 화살표·Enter 만 받는다
pub fn keys_request(line: &str) -> Option<(String, String)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("action")?.as_str()? != "keys" {
        return None;
    }
    let id = v["arg"]["id"].as_str()?;
    let keys = v["arg"]["keys"].as_str()?;
    let id_ok = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    let rest = keys.replace("\x1b[A", "").replace("\x1b[B", "").replace('\r', "");
    (id_ok && !keys.is_empty() && rest.is_empty()).then(|| (id.to_string(), keys.to_string()))
}

pub fn watch<R: Runtime>(app: &tauri::AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let file = crate::config::data_file("app.jsonl");
        // 바이트로 읽어 깨진 글자는 바꿔 넣는다 — read_to_string 은 UTF-8 이 아닌 바이트가 하나라도 있으면 매번 실패해 감시가 영영 멈춘다
        let read = |f: &std::path::Path| std::fs::read(f).map(|b| String::from_utf8_lossy(&b).into_owned());
        let mut offset = read(&file).map(|s| s.len()).unwrap_or(0);
        // 윈도우에서 선택지 키가 한 번도 안 들어갔다 — 감시가 어느 파일을 보고 무엇을 받았는지 남긴다
        crate::claude::log_out("appctl-watch", &format!("{} offset {offset}", file.display()));
        loop {
            std::thread::sleep(std::time::Duration::from_millis(700));
            let Ok(content) = read(&file) else { continue };
            if content.len() == offset {
                continue;
            }
            let (lines, next) = new_lines(&content, offset);
            offset = next;
            for line in lines {
                crate::claude::log_out("appctl", &line.chars().take(120).collect::<String>());
                if let Some((id, keys)) = keys_request(&line) {
                    std::thread::spawn(move || {
                        crate::claude::log_out("choice-keys", &format!("{id} start"));
                        let r = crate::claude::press_keys(&id, &keys);
                        crate::claude::log_out("choice-keys", &format!("{id} {}", if r.is_ok() { "ok" } else { "fail" }));
                    });
                    continue;
                }
                let Some(w) = app.get_webview_window("main") else { continue };
                if wants_window(&line) {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                // 줄은 이미 JSON 이라 그대로 인자로 넣는다
                let _ = w.eval(format!("window.__appctl && window.__appctl({line})"));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 키_넣기_요청은_화살표와_enter_만() {
        let ok = r#"{"ts":"1","action":"keys","arg":{"id":"9b9042fe","keys":"\u001b[B\u001b[B\r"}}"#;
        assert_eq!(keys_request(ok), Some(("9b9042fe".into(), "\x1b[B\x1b[B\r".into())));
        // 글자·다른 제어 문자는 거절 — 이 줄로 세션에 아무 말이나 치게 할 수는 없다
        assert_eq!(keys_request(r#"{"action":"keys","arg":{"id":"a","keys":"rm -rf /\r"}}"#), None);
        assert_eq!(keys_request(r#"{"action":"keys","arg":{"id":"a;b","keys":"\r"}}"#), None);
        assert_eq!(keys_request(r#"{"action":"voice","arg":"on"}"#), None);
        assert_eq!(keys_request(r#"{"action":"keys","arg":{"id":"a","keys":""}}"#), None);
    }

    #[test]
    fn 새_줄만_객체만() {
        let a = "{\"ts\":\"1\",\"action\":\"voice\",\"arg\":\"on\"}\n";
        let all = format!("{a}깨진 줄\n[1,2]\n{{\"ts\":\"2\",\"action\":\"open\",\"arg\":\"settings\"}}\n");
        let (got, next) = new_lines(&all, a.len());
        assert_eq!(got, vec!["{\"ts\":\"2\",\"action\":\"open\",\"arg\":\"settings\"}".to_string()]);
        assert_eq!(next, all.len());
        assert_eq!(new_lines(a, 999).0.len(), 1); // 파일이 줄었으면 처음부터
    }

    #[test]
    fn 화면_바꾸는_명령만_창을_띄운다() {
        assert!(wants_window(r#"{"action":"open","arg":"settings"}"#));
        assert!(wants_window(r#"{"action":"focus","arg":"acme"}"#));
        assert!(!wants_window(r#"{"action":"voice","arg":"on"}"#));
        assert!(!wants_window("깨짐"));
    }
}
