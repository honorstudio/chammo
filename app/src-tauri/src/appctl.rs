//! 참모가 앱을 대신 조작한다 — HQ scripts/app 이 <데이터 폴더>/app.jsonl 에 {ts, action, arg} 를 한 줄 쓰면
//! 0.7초 안에 메인 창 웹뷰의 window.__appctl(<그 줄>) 로 넘긴다(route_menu 처럼 권한 파일 없이 되는 eval).
//! 무엇을 할지는 프론트 domain/appctl.ts 가 정한다. show.jsonl(reader::watch)과 같은 방식 — 앱이 켜지기 전 줄은 건너뛴다
use tauri::{Manager, Runtime};

/// offset 뒤 새 줄 중 JSON 객체인 것만(원문 그대로) + 다음 offset. 파일이 줄었으면 처음부터
pub fn new_lines(content: &str, offset: usize) -> (Vec<String>, usize) {
    let start = if offset > content.len() || !content.is_char_boundary(offset) { 0 } else { offset };
    let lines = content[start..]
        .lines()
        .filter(|l| serde_json::from_str::<serde_json::Value>(l).map(|v| v.is_object()).unwrap_or(false))
        .map(str::to_owned)
        .collect();
    (lines, content.len())
}

/// 앱이 꺼진 동안 쓴 줄 중 켤 때 다시 칠 것 — 지난번 읽은 자리(app.jsonl.seen) 뒤의 자리표 알림만, 한 시간 안 것만.
/// 열쇠·화면 조작은 옛것이면 엉뚱한 창에 들어가 다시 안 한다. 읽은 자리를 모르면(처음 켬) 없음
pub fn replay_on_start(content: &str, seen: Option<usize>, now: u64) -> Vec<String> {
    let Some(seen) = seen else { return Vec::new() };
    new_lines(content, seen)
        .0
        .into_iter()
        .filter(|l| {
            let v: serde_json::Value = serde_json::from_str(l).unwrap_or_default();
            v["action"] == "slot-notice" && v["at"].as_u64().is_some_and(|at| now.saturating_sub(at) <= 3600)
        })
        .collect()
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

/// 하네스 글 요청(scripts/app harness) → (id, 프로젝트). id 는 답 파일 첫 줄에 그대로 쓰니 글자·숫자·- 만
pub fn harness_request(line: &str) -> Option<(String, Option<String>)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("action")?.as_str()? != "harness" {
        return None;
    }
    let id = v.get("id")?.as_str()?;
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    let p = v.get("arg").and_then(|a| a.as_str()).map(str::trim).filter(|a| !a.is_empty()).map(str::to_owned);
    Some((id.to_string(), p))
}

/// 참모 브라우저 연결(scripts/app browser status|connect <폴더>) → (id, 동사, 폴더). 'need'(카드)는 화면 몫이라 여기선 안 받는다
pub fn browser_request(line: &str) -> Option<(String, String, String)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("action")?.as_str()? != "browser" {
        return None;
    }
    let id = v.get("id")?.as_str()?;
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    let verb = v["arg"]["verb"].as_str()?;
    let dir = v["arg"]["dir"].as_str()?.trim();
    (matches!(verb, "status" | "connect") && !dir.is_empty()).then(|| (id.to_string(), verb.to_string(), dir.to_string()))
}

/// 폰 푸시(scripts/app push) → (제목, 한 줄). 문구 자르기는 push::payload 가 한다(제목 80자·한 줄 60자)
pub fn push_request(line: &str) -> Option<(String, String)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("action")?.as_str()? != "push" {
        return None;
    }
    let title = v["arg"]["title"].as_str()?.trim();
    (!title.is_empty()).then(|| (title.to_string(), v["arg"]["body"].as_str().unwrap_or("").trim().to_string()))
}

/// 자리표 알림(scripts/slot — 만료로 넘겨받음·--force 정리·기다리는데 주인이 쉼) → (짧은 세션 번호, 칠 한 줄).
/// 문구는 여기서 정한다 — 줄에는 자리·까닭·주인 이름만 오고 다 거른다(이 줄로 세션에 아무 말이나 치게 할 수는 없다)
pub fn slot_notice_request(line: &str, lang: &str) -> Option<(String, String)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("action")?.as_str()? != "slot-notice" {
        return None;
    }
    let a = &v["arg"];
    let sid = a["session"].as_str()?;
    let slot = a["slot"].as_str()?;
    let by = a["by"].as_str()?;
    let sid_ok = sid.len() >= 8 && sid.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    let by_ok = !by.is_empty() && by.chars().count() <= 64 && by.chars().all(|c| c.is_alphanumeric() || "-_.".contains(c));
    if !sid_ok || !by_ok || !crate::load::SLOT_TTL.iter().any(|(n, _)| *n == slot) {
        return None;
    }
    let en = lang == "en";
    let text = match (a["why"].as_str()?, en) {
        ("ttl", false) => format!("[자리표] {slot} 자리가 TTL 이 지나 {by} 에게 넘어갔어 — 그 자리로 하던 일(빌드·기기 조작)은 지금 멈춰. 다시 쓰려면 줄부터: 명령은 slot run {slot} <프로젝트> -- <명령>, 기기 조작은 slot take {slot} <프로젝트> --wait 1800"),
        ("ttl", true) => format!("[slot] Your {slot} slot passed its TTL and went to {by} — stop what you were running on it (builds, device control). To use it again, queue first: slot run {slot} <project> -- <command>, or slot take {slot} <project> --wait 1800 for device control"),
        ("force", false) => format!("[자리표] {by} 가 오래 잡힌 네 {slot} 자리를 정리했어 — 그 자리로 하던 일은 멈추고, 다시 쓰려면 slot run {slot} <프로젝트> -- <명령> 또는 slot take {slot} <프로젝트> --wait 1800"),
        ("force", true) => format!("[slot] {by} cleared your {slot} slot (held too long) — stop what you were running on it; to use it again: slot run {slot} <project> -- <command> or slot take {slot} <project> --wait 1800"),
        ("wait", false) => format!("[자리표] {by} 가 {slot} 자리를 기다리는데 네가 쉬는 중이라 알려 — 다 썼으면 slot give {slot} <프로젝트>, 아직 쓰면 slot renew {slot} <프로젝트>"),
        ("wait", true) => format!("[slot] {by} is waiting for the {slot} slot while you are idle — if you are done, slot give {slot} <project>; if you still need it, slot renew {slot} <project>"),
        _ => return None,
    };
    Some((sid[..8].to_string(), text))
}

/// 같은 알림(세션·자리·까닭)은 5분에 한 번 — 여럿이 기다리면 각자 찌른다
pub fn first_in(seen: &mut std::collections::HashMap<String, u64>, key: &str, now: u64) -> bool {
    if seen.get(key).is_some_and(|t| now < t + 300) {
        return false;
    }
    seen.insert(key.to_string(), now);
    true
}

pub fn watch<R: Runtime>(app: &tauri::AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let file = crate::config::data_file("app.jsonl");
        // 바이트로 읽어 깨진 글자는 바꿔 넣는다 — read_to_string 은 UTF-8 이 아닌 바이트가 하나라도 있으면 매번 실패해 감시가 영영 멈춘다
        let read = |f: &std::path::Path| std::fs::read(f).map(|b| String::from_utf8_lossy(&b).into_owned());
        let seen_file = crate::config::data_file("app.jsonl.seen");
        let seen = std::fs::read_to_string(&seen_file).ok().and_then(|s| s.trim().parse::<usize>().ok());
        let now = || std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let start = read(&file).unwrap_or_default();
        let mut offset = start.len();
        // 꺼진 동안 쓴 자리표 알림 — 자리를 잃고도 빌드를 계속 돌리는 세션이 없게(2026-10-06 slot 남은 것 ①)
        let mut pending = replay_on_start(&start, seen, now());
        let _ = std::fs::write(&seen_file, offset.to_string()); // 새 줄이 한 번도 안 와도 다음 켬이 읽은 자리를 안다
        let mut slot_seen = std::collections::HashMap::new();
        // 윈도우에서 선택지 키가 한 번도 안 들어갔다 — 감시가 어느 파일을 보고 무엇을 받았는지 남긴다
        crate::claude::log_out("appctl-watch", &format!("{} offset {offset} replay {}", file.display(), pending.len()));
        loop {
            if pending.is_empty() {
                std::thread::sleep(std::time::Duration::from_millis(700));
                let Ok(content) = read(&file) else { continue };
                if content.len() == offset {
                    continue;
                }
                let (lines, next) = new_lines(&content, offset);
                offset = next;
                pending = lines;
            }
            let _ = std::fs::write(&seen_file, offset.to_string());
            for line in std::mem::take(&mut pending) {
                crate::claude::log_out("appctl", &line.chars().take(120).collect::<String>());
                if let Some((id, keys)) = keys_request(&line) {
                    std::thread::spawn(move || {
                        crate::claude::log_out("choice-keys", &format!("{id} start"));
                        let r = crate::claude::press_keys(&id, &keys);
                        crate::claude::log_out("choice-keys", &format!("{id} {}", if r.is_ok() { "ok" } else { "fail" }));
                    });
                    continue;
                }
                // 폰 푸시 — 참모가 일부러 부른 것이라 맥 창을 보고 있어도 보낸다. 진짜 데이터 폴더·모바일 켬·짝지은 기기 구독만(push::send_all)
                if let Some((title, body)) = push_request(&line) {
                    crate::push::send_all(&title, &body, "");
                    continue;
                }
                // 자리표 알림 — 쥔 세션에 정해진 한 줄. 창은 안 띄운다
                if let Some((id, text)) = slot_notice_request(&line, &crate::config::current().language) {
                    let v: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
                    let key = format!("{id}|{}|{}", v["arg"]["slot"].as_str().unwrap_or(""), v["arg"]["why"].as_str().unwrap_or(""));
                    if first_in(&mut slot_seen, &key, now()) {
                        std::thread::spawn(move || {
                            let _ = crate::claude::type_text_tagged(&id, &text, "slot-notice");
                        });
                    }
                    continue;
                }
                // 하네스 글 — 창 없이 엔진으로 훑어 <데이터>/harness.txt 에 "#id <id>" 다음 줄부터 적는다(전체 스캔 2초대라 따로)
                if let Some((id, project)) = harness_request(&line) {
                    std::thread::spawn(move || {
                        let lang = harnitor_core::i18n::Lang::parse(&crate::config::current().language);
                        let text = crate::harnitor::report_at(&crate::harnitor::home(), lang, project.as_deref());
                        let file = crate::config::data_file("harness.txt");
                        let tmp = file.with_extension("txt.tmp");
                        if std::fs::write(&tmp, format!("#id {id}\n{text}\n")).is_ok() {
                            let _ = std::fs::rename(&tmp, &file);
                        }
                    });
                    continue;
                }
                // 참모 브라우저 연결 — HQ 는 데스크탑 권한이 막혀 있을 수 있어(#1) 앱이 대신 읽고 ~/.claude.json 에 적는다.
                // 답은 <데이터>/browser-attach.txt("#id <id>" 다음 줄 JSON)
                if let Some((id, verb, dir)) = browser_request(&line) {
                    std::thread::spawn(move || {
                        let ans = crate::browser_attach::answer(&verb, &dir);
                        let file = crate::config::data_file("browser-attach.txt");
                        let tmp = file.with_extension("txt.tmp");
                        if std::fs::write(&tmp, format!("#id {id}\n{ans}\n")).is_ok() {
                            let _ = std::fs::rename(&tmp, &file);
                        }
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
    fn 앱이_꺼진_동안_쓴_자리표_알림은_켤_때_다시_본다() {
        // 2026-10-06 slot 남은 것 ①: 켤 때 파일 끝부터 읽어 꺼진 동안 쓴 slot-notice 가 영영 안 갔다
        let n = |at: u64| format!(r#"{{"at":{at},"action":"slot-notice","arg":{{"session":"5eed0a01-ff12","slot":"build","why":"ttl","by":"project-x-app"}}}}"#);
        let before = format!("{}\n", n(100));
        let keys = r#"{"action":"keys","arg":{"id":"5eed0a01","keys":"1"}}"#;
        let content = format!("{before}{}\n{keys}\n{}\n", n(5_000), n(10_000));
        // 지난번 어디까지 읽었는지(seen) 뒤 줄 중 자리표 알림만, 한 시간 안 것만 — 열쇠(keys)는 옛것이면 위험해 다시 안 친다
        assert_eq!(replay_on_start(&content, Some(before.len()), 10_100), vec![n(10_000)]);
        assert_eq!(replay_on_start(&content, Some(before.len()), 8_000), vec![n(5_000), n(10_000)]);
        // 읽은 자리를 모르면(처음 켬) 예전처럼 건너뛴다, 파일이 줄었으면 처음부터
        assert!(replay_on_start(&content, None, 10_100).is_empty());
        assert_eq!(replay_on_start(&format!("{}\n", n(10_000)), Some(content.len()), 10_100), vec![n(10_000)]);
        // at 없는 옛 줄은 시각을 몰라 안 친다
        let old = r#"{"action":"slot-notice","arg":{"session":"5eed0a01-ff12","slot":"build","why":"ttl","by":"project-x-app"}}"#;
        assert!(replay_on_start(&format!("{old}\n"), Some(0), 10).is_empty());
    }

    #[test]
    fn 키_넣기_요청은_화살표와_enter_만() {
        let ok = r#"{"ts":"1","action":"keys","arg":{"id":"c0ffee12","keys":"\u001b[B\u001b[B\r"}}"#;
        assert_eq!(keys_request(ok), Some(("c0ffee12".into(), "\x1b[B\x1b[B\r".into())));
        // 글자·다른 제어 문자는 거절 — 이 줄로 세션에 아무 말이나 치게 할 수는 없다
        assert_eq!(keys_request(r#"{"action":"keys","arg":{"id":"a","keys":"rm -rf /\r"}}"#), None);
        assert_eq!(keys_request(r#"{"action":"keys","arg":{"id":"a;b","keys":"\r"}}"#), None);
        assert_eq!(keys_request(r#"{"action":"voice","arg":"on"}"#), None);
        assert_eq!(keys_request(r#"{"action":"keys","arg":{"id":"a","keys":""}}"#), None);
    }

    #[test]
    fn 하네스_글_요청은_id_와_프로젝트() {
        assert_eq!(harness_request(r#"{"action":"harness","arg":"","id":"a1b2"}"#), Some(("a1b2".into(), None)));
        assert_eq!(harness_request(r#"{"action":"harness","arg":" shop ","id":"x9"}"#), Some(("x9".into(), Some("shop".into()))));
        // id 는 파일 첫 줄에 그대로 쓰니 글자·숫자·- 만
        assert_eq!(harness_request(r#"{"action":"harness","arg":"","id":"a\nb"}"#), None);
        assert_eq!(harness_request(r#"{"action":"harness","arg":""}"#), None);
        assert_eq!(harness_request(r#"{"action":"open","arg":"harnitor","id":"a"}"#), None);
    }

    #[test]
    fn 브라우저_연결_요청은_id_동사_폴더() {
        let l = r#"{"action":"browser","id":"ab-1","arg":{"verb":"connect","dir":"~/dev/shop"}}"#;
        assert_eq!(browser_request(l), Some(("ab-1".into(), "connect".into(), "~/dev/shop".into())));
        assert!(browser_request(r#"{"action":"browser","id":"x","arg":{"verb":"status","dir":"/d"}}"#).is_some());
        assert_eq!(browser_request(r#"{"action":"browser","id":"x","arg":{"verb":"rm","dir":"/d"}}"#), None); // 모르는 동사
        assert_eq!(browser_request(r#"{"action":"browser","id":"x/../y","arg":{"verb":"status","dir":"/d"}}"#), None); // 답 파일에 쓰는 id
        assert_eq!(browser_request(r#"{"action":"browser","id":"x","arg":{"verb":"status","dir":"  "}}"#), None);
        assert_eq!(browser_request(r#"{"action":"browser-need","id":"x","arg":{"dir":"/d"}}"#), None); // 카드는 화면으로
    }

    #[test]
    fn 폰_푸시_요청은_제목과_한_줄() {
        assert_eq!(push_request(r#"{"action":"push","arg":{"title":" 빌드 끝 ","body":"확인해 줘"}}"#), Some(("빌드 끝".into(), "확인해 줘".into())));
        assert_eq!(push_request(r#"{"action":"push","arg":{"title":"끝"}}"#), Some(("끝".into(), String::new())));
        assert_eq!(push_request(r#"{"action":"push","arg":{"title":"  ","body":"x"}}"#), None, "제목은 있어야");
        assert_eq!(push_request(r#"{"action":"push","arg":"끝"}"#), None);
        assert_eq!(push_request(r#"{"action":"voice","arg":{"title":"x"}}"#), None);
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

    #[test]
    fn 자리_알림은_정해진_문구만_쥔_세션에() {
        // scripts/slot 이 만료로 넘겨받거나 --force 로 정리하면 쥔 세션에 알린다(2026-10-05 헬로노트 gradle 이 자리 잃고도 계속 돔)
        let ttl = r#"{"action":"slot-notice","arg":{"session":"5eed0a01-ff12-4abc-9def-000000000000","slot":"galaxy","why":"ttl","by":"project-b-platform"}}"#;
        let (id, text) = slot_notice_request(ttl, "ko").unwrap();
        assert_eq!(id, "5eed0a01", "attach 는 짧은 번호로");
        assert!(text.starts_with("[자리표] galaxy 자리"), "{text}");
        assert!(text.contains("project-b-platform") && text.contains("slot run galaxy"), "{text}");
        assert!(!text.contains('\n'), "한 줄 — 줄바꿈이면 입력칸에서 먼저 보내진다");
        let wait = ttl.replace(r#""why":"ttl""#, r#""why":"wait""#);
        assert!(slot_notice_request(&wait, "ko").unwrap().1.contains("slot give galaxy"));
        let force = ttl.replace(r#""why":"ttl""#, r#""why":"force""#);
        assert!(slot_notice_request(&force, "ko").unwrap().1.contains("정리"));
        assert!(slot_notice_request(&force, "en").unwrap().1.starts_with("[slot] "));
    }

    #[test]
    fn 자리_알림으로_아무_말이나_치게_할_수는_없다() {
        let ok = |arg: &str| slot_notice_request(&format!(r#"{{"action":"slot-notice","arg":{arg}}}"#), "ko");
        assert!(ok(r#"{"session":"5eed0a01-ff12","slot":"build","why":"ttl","by":"project-x-app"}"#).is_some());
        assert!(ok(r#"{"session":"5eed0a01-ff12","slot":"gpu","why":"ttl","by":"project-x-app"}"#).is_none(), "모르는 자리");
        assert!(ok(r#"{"session":"5eed0a01-ff12","slot":"build","why":"rm","by":"project-x-app"}"#).is_none(), "모르는 까닭");
        assert!(ok(r#"{"session":"5eed0a01-ff12","slot":"build","why":"ttl","by":"x\r/clear"}"#).is_none(), "주인 이름에 제어 문자·명령");
        assert!(ok(r#"{"session":"5eed0a01-ff12","slot":"build","why":"ttl","by":"a b"}"#).is_none());
        assert!(ok(&format!(r#"{{"session":"5eed0a01-ff12","slot":"build","why":"ttl","by":"{}"}}"#, "a".repeat(65))).is_none());
        assert!(ok(r#"{"session":"9ea8;rm","slot":"build","why":"ttl","by":"project-x-app"}"#).is_none(), "세션 번호는 16진수·- 만");
        assert!(ok(r#"{"session":"9ea8","slot":"build","why":"ttl","by":"project-x-app"}"#).is_none(), "짧은 번호보다 짧으면");
        assert!(slot_notice_request(r#"{"action":"push","arg":{"title":"x"}}"#, "ko").is_none());
    }

    #[test]
    fn 같은_자리_알림은_5분에_한_번() {
        let mut seen = std::collections::HashMap::new();
        assert!(first_in(&mut seen, "a|build|wait", 1000));
        assert!(!first_in(&mut seen, "a|build|wait", 1200), "여럿이 기다려도 한 번");
        assert!(first_in(&mut seen, "a|build|ttl", 1200), "까닭이 다르면 따로");
        assert!(first_in(&mut seen, "a|build|wait", 1301));
    }
}
