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

pub fn watch<R: Runtime>(app: &tauri::AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let file = crate::config::data_file("app.jsonl");
        let mut offset = std::fs::read_to_string(&file).map(|s| s.len()).unwrap_or(0);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(700));
            let Ok(content) = std::fs::read_to_string(&file) else { continue };
            if content.len() == offset {
                continue;
            }
            let (lines, next) = new_lines(&content, offset);
            offset = next;
            for line in lines {
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
