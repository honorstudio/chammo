//! 새 세션 기본 모델·노력값(설정 > 참모, 폰 더보기) — 앱 config(defaultModel·defaultEffort)에 두고 앱이 띄우는 세션에만 `--model`·`--effort` 를 붙인다.
//! 사용자 전역 ~/.claude/settings.json 은 안 바꾼다(앱 밖 터미널 claude 는 그대로, 모델 칩의 '기본값 되돌리기'와도 안 부딪힌다 — claude_defaults.rs).
//! 빈 값 = Claude Code 기본(전역 settings.json)을 따른다. 참모가 Bash 로 치는 `claude --bg` 는 HQ 훅(scripts/default-model-hook)이 같은 값을 붙인다
use std::path::Path;

/// Claude Code 별칭 — 판마다 그 계열 가장 새 모델로 풀린다(claude --help 2.1.326: 'fable', 'opus', 'sonnet')
pub const MODELS: &[&str] = &["opus", "sonnet", "haiku", "fable"];
pub const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];
/// fable 별칭이 생긴 판(Fable 5.2, 2.1.321 — domain/modelPick OTHER_MODELS 주석)
const FABLE_SINCE: (u32, u32, u32) = (2, 1, 321);

/// 받을 수 있는 값만 — 모르는 값은 빈 값(기본 따름)
pub fn clean(model: &str, effort: &str) -> (String, String) {
    let m = model.trim().to_lowercase();
    let e = effort.trim().to_lowercase();
    (if MODELS.contains(&m.as_str()) { m } else { String::new() }, if EFFORTS.contains(&e.as_str()) { e } else { String::new() })
}

/// 붙일 인자 — 빈 칸은 안 붙인다
pub fn flags(model: &str, effort: &str) -> Vec<String> {
    let (m, e) = clean(model, effort);
    let mut a = Vec::new();
    if !m.is_empty() {
        a.extend(["--model".to_string(), m]);
    }
    if !e.is_empty() {
        a.extend(["--effort".to_string(), e]);
    }
    a
}

/// 띄우기 인자에 기본값을 끼운다 — `--bg` 바로 뒤(없으면 맨 앞). 이미 `--model`/`--effort` 가 있으면(예약·키즈가 고른 값) 그 칸은 안 건드린다.
/// `--` 뒤(첫 지시 글)는 인자로 안 본다
pub fn with_defaults(mut args: Vec<String>, model: &str, effort: &str) -> Vec<String> {
    let opts: Vec<&String> = args.iter().take_while(|a| a.as_str() != "--").collect();
    let has = |k: &str| opts.iter().any(|a| a.as_str() == k || a.starts_with(&format!("{k}=")));
    let add: Vec<String> = flags(model, effort).chunks(2).filter(|p| !has(&p[0])).flatten().cloned().collect();
    let at = args.iter().position(|a| a == "--bg").map(|i| i + 1).unwrap_or(0);
    args.splice(at..at, add);
    args
}

/// 지금 설정값으로 끼운 인자
pub fn apply(args: Vec<String>) -> Vec<String> {
    if cfg!(test) {
        return args; // cargo test 는 진짜 데이터 폴더 설정을 읽는다 — 끼우기는 with_defaults 로 시험한다
    }
    let c = crate::config::current();
    with_defaults(args, &c.default_model, &c.default_effort)
}

/// `claude --version` 첫 줄의 판 — "2.1.326 (Claude Code)"
fn version_of(text: &str) -> Option<(u32, u32, u32)> {
    let v = text.split_whitespace().next()?;
    let mut it = v.split('.').map(|x| x.parse::<u32>().ok());
    Some((it.next()??, it.next()??, it.next()??))
}

/// 깔린 claude 가 아는 별칭만 — 판을 모르면 fable 은 뺀다(옛 판에 주면 세션이 안 뜬다)
pub fn known_models(version_text: &str) -> Vec<&'static str> {
    let fable = version_of(version_text).is_some_and(|v| v >= FABLE_SINCE);
    MODELS.iter().copied().filter(|m| *m != "fable" || fable).collect()
}

/// 사용자 전역 settings.json 의 기본값(화면에 '기본 (…)'으로 보여 줄 것) — 못 읽으면 빈 값
pub fn user_defaults(text: &str) -> (String, String) {
    let v: serde_json::Value = serde_json::from_str(text).unwrap_or_default();
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    (s("model"), s("effortLevel"))
}

/// 화면·폰이 읽는 한 덩어리 — 지금 값, 고를 수 있는 것, 전역 기본값
pub fn view(model: &str, effort: &str, version_text: &str, settings_text: &str) -> serde_json::Value {
    let (m, e) = clean(model, effort);
    let (um, ue) = user_defaults(settings_text);
    serde_json::json!({ "model": m, "effort": e, "models": known_models(version_text), "efforts": EFFORTS, "userModel": um, "userEffort": ue })
}

fn claude_version() -> String {
    static V: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    V.get_or_init(|| {
        let mut c = crate::platform::command(crate::claude::claude_bin());
        c.arg("--version");
        crate::platform::run_capped(&mut c, std::time::Duration::from_secs(10)).map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
    })
    .clone()
}

fn settings_text() -> String {
    let p = crate::claude_defaults::settings_path(Path::new(&crate::config::home()), std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref());
    std::fs::read_to_string(p).unwrap_or_default()
}

/// 지금 값(설정 화면·폰) — claude --version 을 한 번 부르니 뒤 스레드에서
pub fn current_view() -> serde_json::Value {
    let c = crate::config::current();
    view(&c.default_model, &c.default_effort, &claude_version(), &settings_text())
}

#[tauri::command]
pub async fn default_model_view() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(current_view).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn 빈_값이면_아무것도_안_붙인다() {
        let a = s(&["--bg", "--dangerously-skip-permissions", "-n", "x", "--", "일"]);
        assert_eq!(with_defaults(a.clone(), "", ""), a);
    }

    #[test]
    fn bg_바로_뒤에_모델과_노력값() {
        let a = with_defaults(s(&["--bg", "--dangerously-skip-permissions", "-n", "x", "--", "일"]), "sonnet", "high");
        assert_eq!(a, s(&["--bg", "--model", "sonnet", "--effort", "high", "--dangerously-skip-permissions", "-n", "x", "--", "일"]));
    }

    #[test]
    fn 이미_고른_칸은_그대로() {
        let a = with_defaults(s(&["--bg", "--model", "haiku", "-n", "x"]), "opus", "max");
        assert_eq!(a, s(&["--bg", "--effort", "max", "--model", "haiku", "-n", "x"]));
        let b = with_defaults(s(&["--bg", "--effort=low", "-n", "x"]), "", "max");
        assert_eq!(b, s(&["--bg", "--effort=low", "-n", "x"]));
    }

    #[test]
    fn 첫_지시_글_속_낱말은_인자가_아니다() {
        let a = with_defaults(s(&["--bg", "-n", "x", "--", "--model 바꿔줘"]), "opus", "");
        assert_eq!(a, s(&["--bg", "--model", "opus", "-n", "x", "--", "--model 바꿔줘"]));
    }

    #[test]
    fn 모르는_값은_버린다() {
        assert_eq!(clean("gpt-5", "ultra"), (String::new(), String::new()));
        assert_eq!(clean(" Opus ", "XHIGH"), ("opus".into(), "xhigh".into()));
        assert!(flags("rm -rf", "").is_empty());
    }

    #[test]
    fn fable_은_아는_판에서만() {
        assert_eq!(known_models("2.1.326 (Claude Code)"), vec!["opus", "sonnet", "haiku", "fable"]);
        assert_eq!(known_models("2.1.320 (Claude Code)"), vec!["opus", "sonnet", "haiku"]);
        assert_eq!(known_models(""), vec!["opus", "sonnet", "haiku"]);
    }

    #[test]
    fn 전역_기본값을_읽는다() {
        assert_eq!(user_defaults(r#"{"model":"opus","effortLevel":"high","x":1}"#), ("opus".into(), "high".into()));
        assert_eq!(user_defaults("깨진 글"), (String::new(), String::new()));
        let v = view("sonnet", "bad", "2.1.326", r#"{"model":"opus"}"#);
        assert_eq!(v["model"], "sonnet");
        assert_eq!(v["effort"], "");
        assert_eq!(v["userModel"], "opus");
    }
}
