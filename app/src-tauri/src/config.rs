//! 설정 층 — 데이터 폴더와 config.json.
//! 데이터 폴더 규칙은 Rust·scripts(hq-template 포함) 모두 같다: $CHAMMO_HOME → ~/.chammo →
//! 단 ~/.chammo 가 없고 ~/.honor-orchestrator 가 있으면 그걸 그대로 쓴다(옛 설치의 기록을 옮기지 않는다)
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};

pub const DATA: &str = ".chammo";
pub const LEGACY: &str = ".honor-orchestrator";

pub fn home() -> String {
    crate::platform::home()
}

/// `~` / `~/…` 를 홈으로 푼다. 나머지는 그대로
pub fn expand(home: &str, p: &str) -> String {
    let p = p.trim();
    if p == "~" {
        home.to_string()
    } else if let Some(rest) = p.strip_prefix("~/") {
        format!("{home}/{rest}")
    } else {
        p.to_string()
    }
}

/// 홈 아래 경로는 `~/…` 로 줄인다(설정 파일·화면에 보이는 모양)
pub fn tilde(home: &str, p: &str) -> String {
    match p.strip_prefix(home).filter(|_| !home.is_empty()) {
        Some("") => "~".into(),
        Some(rest) if rest.starts_with('/') => format!("~{rest}"),
        _ => p.to_string(),
    }
}

/// 데이터 폴더 고르기. `exists` 를 밖에서 받는 건 테스트 때문
pub fn resolve_data_dir(home: &str, env: Option<&str>, exists: impl Fn(&str) -> bool) -> PathBuf {
    if let Some(e) = env.map(str::trim).filter(|e| !e.is_empty()) {
        return PathBuf::from(expand(home, e));
    }
    let new = format!("{home}/{DATA}");
    let old = format!("{home}/{LEGACY}");
    if !exists(&new) && exists(&old) {
        PathBuf::from(old)
    } else {
        PathBuf::from(new)
    }
}

/// 앱이 뜰 때 한 번 정하고 계속 쓴다(없으면 만든다 — 기록 파일을 붙여 쓰는 곳이 많아서)
pub fn data_dir() -> &'static Path {
    static D: OnceLock<PathBuf> = OnceLock::new();
    D.get_or_init(|| {
        let d = resolve_data_dir(&home(), std::env::var("CHAMMO_HOME").ok().as_deref(), |p| Path::new(p).is_dir());
        let _ = std::fs::create_dir_all(&d);
        d
    })
}

/// 진짜 데이터 폴더인가(~/.chammo·~/.honor-orchestrator) — 시험 폴더(CHAMMO_HOME=~/.chammo-test 등)면 false.
/// 맥 전역에 남는 것(tailscale serve·launchd)은 진짜 폴더일 때만 건다(scripts routine real_data 와 같은 판단, 2026-10-03)
pub fn is_real_data(home: &str, dir: &Path) -> bool {
    let d = dir.to_string_lossy().replace('\\', "/");
    let d = d.trim_end_matches('/');
    let h = home.replace('\\', "/");
    [DATA, LEGACY].iter().any(|n| d == format!("{}/{n}", h.trim_end_matches('/')))
}

/// 데이터 폴더 안 파일
pub fn data_file(name: &str) -> PathBuf {
    data_dir().join(name)
}

// ── config.json ──────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Features {
    pub office: bool,
    pub tama: bool,
    pub gacha: bool,
    pub review: bool,
    pub voice: bool,
    /// 재시작으로 꺼진 세션을 사람 없이 이어서 켜기(무인 기계용, domain/revive). 기본 끔 — 앱(TS)만 읽지만 여기 없으면 저장 때 버려졌다(2026-10-04)
    pub auto_revive: bool,
    /// 세션 브라우저 앱에서 보기 — 참모 브라우저 래퍼가 이 값을 읽어 크롬 CDP 포트를 연다(tools/chammo-browser/src/live.js). 기본 켬
    pub agent_view: bool,
    /// 화면 조종(Claude Code 내장 MCP computer-use)을 앱이 아는 모든 프로젝트에서 켜기 — 켜면 빠진 프로젝트에 넣어 준다(computer_use.rs).
    /// 사용자 화면을 조종하는 기능이라 기본 끔, 마법사·설정에서 고른다(2026-10-05)
    pub computer_use: bool,
}

impl Default for Features {
    fn default() -> Self {
        Features { office: true, tama: true, gacha: true, review: true, voice: true, auto_revive: false, agent_view: true, computer_use: false }
    }
}

/// 설정 파일(<데이터 폴더>/config.json). 경로는 `~/…` 모양 그대로 두고 쓸 때 푼다(expand).
/// 빠진 칸은 기본값(serde default) — 옛 파일에 새 칸이 생겨도 안 깨진다
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// "ko" | "en"
    pub language: String,
    /// 비서(오케스트레이터) 이름. 비면 참모/Chammo
    pub assistant_name: String,
    /// 프로젝트들이 사는 폴더
    pub dev_root: String,
    /// 비서 세션이 도는 폴더(HQ)
    pub hq_dir: String,
    /// devRoot 밖에 따로 둔 프로젝트 폴더들(`~/…` 모양). devRoot 아래 폴더와 똑같이 프로젝트로 본다
    /// (아이맥 ~/automation/… 처럼 옮길 수 없는 폴더, 2026-09-28 사용자)
    pub extra_projects: Vec<String>,
    pub github_user: String,
    /// 음성 모드로 읽을 명령. 글자를 마지막 인자로 받는다
    pub tts_command: String,
    pub memo_dir: String,
    pub features: Features,
    pub setup_done: bool,
    /// 말하기 키(누르고 말하면 세션에 음성 입력) — "" 끔 · "fn" 지구본 · "right-option" 오른쪽 ⌥. 기본 끔(0.2.0)
    pub talk_key: String,
    /// 앱 밖에서도 말하기 키를 본다 — 손쉬운 사용 권한이 필요해서 켤 때만 묻는다
    pub talk_anywhere: bool,
}

/// 시스템 언어(맥 ko_KR·윈도우 ko-KR 등) → 언어
pub fn lang_from_locale(locale: &str) -> &'static str {
    if locale.trim().to_lowercase().starts_with("ko") { "ko" } else { "en" }
}

/// 새 설치 기본값. devRoot = ~/Developer·~/Projects 중 있는 첫 것(없으면 ~/Developer).
/// ~/Desktop/dev 는 묻지 않는다 — 맥 보호 폴더(데스크탑)라 있는지만 봐도 앱이 뜨자마자 권한 창이 떴다(2026-10-05 아이맥 QA).
/// 거기 두는 사람은 마법사에서 고른다(고를 때 묻는 건 사람이 한 일이라 이유가 보인다)
/// githubUser 는 비워 둔다 — gh 는 네트워크라 설정 화면이 따로 채운다(detect_github_user)
pub fn default_config(home: &str, data: &Path, lang: &str, exists: impl Fn(&str) -> bool) -> Config {
    let dev = ["Developer", "Projects"]
        .iter()
        .find(|d| exists(&format!("{home}/{d}")))
        .unwrap_or(&"Developer");
    let data = tilde(home, &data.to_string_lossy());
    Config {
        language: lang.into(),
        assistant_name: String::new(),
        dev_root: format!("~/{dev}"),
        hq_dir: format!("{data}/hq"),
        extra_projects: Vec::new(),
        github_user: String::new(),
        tts_command: "say".into(),
        memo_dir: format!("{data}/memo"),
        features: Features::default(),
        setup_done: false,
        talk_key: String::new(),
        talk_anywhere: false,
    }
}

/// 옛 설치(honor-orchestrator)를 쓰던 주인의 값 — 설정 파일 없이 옛 폴더만 있으면 이걸로 채워 오늘과 똑같이 돈다
pub fn owner_config() -> Config {
    Config {
        language: "ko".into(),
        assistant_name: "참모".into(),
        dev_root: "~/Desktop/dev".into(),
        hq_dir: "~/Desktop/dev/honor-orchestrator".into(),
        extra_projects: Vec::new(),
        github_user: "honorstudio".into(),
        tts_command: "~/bin/local-say".into(),
        memo_dir: "~/.config/holo/memo".into(),
        features: Features::default(),
        setup_done: true,
        talk_key: "fn".into(),
        talk_anywhere: true,
    }
}

#[derive(Debug, PartialEq)]
pub enum Boot {
    /// 저장된 설정
    Saved(Config),
    /// 옛 설치 — 주인 값으로 파일을 써 둔다
    Owner(Config),
    /// 새 설치 — 기본값(파일은 설정 화면에서 저장할 때 생긴다)
    Fresh,
}

/// 켤 때 설정 정하기. text = config.json 내용(없으면 None). 깨진 파일은 없는 것처럼
pub fn boot(home: &str, data: &Path, text: Option<&str>) -> Boot {
    if let Some(c) = text.and_then(|t| serde_json::from_str::<Config>(t).ok()) {
        return Boot::Saved(c);
    }
    if data == Path::new(&format!("{home}/{LEGACY}")) {
        Boot::Owner(owner_config())
    } else {
        Boot::Fresh
    }
}

fn system_lang() -> &'static str {
    lang_from_locale(&crate::platform::system_locale())
}

fn write_file(c: &Config) -> Result<(), String> {
    let path = data_file("config.json");
    let tmp = data_file("config.json.tmp");
    let text = serde_json::to_string_pretty(c).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text + "\n").map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

static CURRENT: RwLock<Option<Config>> = RwLock::new(None);

/// 지금 설정(처음 부를 때 파일을 읽고, 이후엔 기억해 둔 것)
pub fn current() -> Config {
    if let Some(c) = CURRENT.read().ok().and_then(|g| g.clone()) {
        return c;
    }
    let home = home();
    let text = std::fs::read_to_string(data_file("config.json")).ok();
    let c = match boot(&home, data_dir(), text.as_deref()) {
        Boot::Saved(c) => c,
        Boot::Owner(c) => {
            let _ = write_file(&c);
            c
        }
        Boot::Fresh => default_config(&home, data_dir(), system_lang(), |p| Path::new(p).is_dir()),
    };
    if let Ok(mut g) = CURRENT.write() {
        *g = Some(c.clone());
    }
    c
}

/// 음성 명령 + 읽을 글자 → 실행할 인자들. 명령 전체가 있는 파일이면 그대로(경로에 빈칸이 있어도),
/// 아니면 빈칸으로 나눠 앞이 프로그램(`say -v Yuna` 처럼). 비어 있으면 macOS say
pub fn tts_argv(home: &str, cmd: &str, text: &str, exists: impl Fn(&str) -> bool) -> Vec<String> {
    let full = expand(home, cmd);
    let mut argv: Vec<String> = if full.is_empty() {
        vec!["say".into()]
    } else if exists(&full) {
        vec![full]
    } else {
        full.split_whitespace().map(|p| expand(home, p)).collect()
    };
    argv.push(text.into());
    if cfg!(windows) { say_for_windows(argv) } else { argv }
}

/// 윈도우엔 say 가 없다 — `say [-v 이름] 글자` 를 윈도우 기본 음성(System.Speech)으로 바꾼다. 이름의 _ 는 빈칸
pub fn say_for_windows(argv: Vec<String>) -> Vec<String> {
    if argv.first().map(String::as_str) != Some("say") || argv.len() < 2 {
        return argv;
    }
    let q = |s: &str| format!("'{}'", s.replace('\'', "''"));
    let text = argv.last().unwrap();
    let voice = match (argv.get(1).map(String::as_str), argv.get(2)) {
        (Some("-v"), Some(v)) if argv.len() == 4 => format!("$s.SelectVoice({}); ", q(&v.replace('_', " "))),
        _ => String::new(),
    };
    let script = format!("$ProgressPreference = 'SilentlyContinue'; Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; {voice}$s.Speak({})", q(text));
    vec!["powershell".into(), "-NoProfile".into(), "-NonInteractive".into(), "-EncodedCommand".into(), crate::platform::encode_ps(&script)]
}

/// 비서 폴더(HQ). 검증용 dev 앱은 CHAMMO_HQ(옛 이름 HONOR_ORCH_CWD)로 바꿔 진짜 비서와 안 섞이게
pub fn hq_dir(home: &str, c: &Config, env: impl Fn(&str) -> Option<String>) -> String {
    env("CHAMMO_HQ")
        .or_else(|| env("HONOR_ORCH_CWD"))
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| expand(home, &c.hq_dir))
}

/// 비서 이름(메뉴 등 Rust 쪽 글자). 비어 있으면 참모/Chammo
pub fn assistant_name() -> String {
    let n = current().assistant_name.trim().to_string();
    if n.is_empty() { crate::i18n::tr("참모", "Chammo").to_string() } else { n }
}

/// 설정 읽기. 바로 돌려준다 — GitHub 아이디는 설정 화면의 환경 점검(gh auth status, setup.rs)이 채운다
/// (예전엔 여기서 `gh api user` 를 불러 첫 화면이 몇 초 늦었다)
#[tauri::command]
pub fn read_config() -> Config {
    current()
}

/// 설정 파일을 다시 읽는다 — 참모(scripts/app project)가 config.json 을 직접 고친 뒤 앱이 부른다
#[tauri::command]
pub fn reload_config() -> Config {
    if let Ok(mut g) = CURRENT.write() {
        *g = None;
    }
    current()
}

/// 설정 저장. 앱은 저장 뒤 창을 다시 연다(언어·비서 이름은 뜰 때 정해서)
#[tauri::command]
pub fn write_config<R: tauri::Runtime>(app: tauri::AppHandle<R>, config: Config) -> Result<(), String> {
    let was = current().features.computer_use;
    write_file(&config)?;
    #[cfg(target_os = "macos")]
    {
        // 말하기 키 설정은 바로 — 앱 밖 모니터는 메인 스레드에서 깐다
        let (k, a) = (config.talk_key.clone(), config.talk_anywhere);
        let _ = app.run_on_main_thread(move || crate::keys_mac::apply_talk(&k, a));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = &app;
    let now = config.features.computer_use;
    if let Ok(mut g) = CURRENT.write() {
        *g = Some(config);
    }
    // 화면 조종 — 바꿨으면 모든 프로젝트에 넣거나 빼고, 켜 둔 채 저장이면 새로 생긴 프로젝트(따로 둔 폴더 추가 등)에만
    std::thread::spawn(move || {
        let r = if was != now { crate::computer_use::turned(now) } else { crate::computer_use::sweep() };
        if let Err(e) = r { crate::claude::log_out("computer-use", &e); }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 진짜_데이터_폴더는_홈의_chammo_와_옛_이름만() {
        let h = "/Users/me";
        assert!(is_real_data(h, Path::new("/Users/me/.chammo")));
        assert!(is_real_data(h, Path::new("/Users/me/.honor-orchestrator/")));
        // 시험 폴더(CHAMMO_HOME=~/.chammo-test 등)는 맥 전역에 남는 것(launchd·tailscale serve)을 걸지 않는다
        for d in [".chammo-test", ".chammo-test-agent", ".chammo-qa", "demo-data", ".chammo/sub"] {
            assert!(!is_real_data(h, &Path::new(h).join(d)), "{d}");
        }
    }

    #[test]
    fn 빠진_칸은_기본값() {
        let c: Config = serde_json::from_str(r#"{"language":"en","features":{"tama":false}}"#).unwrap();
        assert_eq!(c.language, "en");
        assert!(!c.features.tama);
        assert!(c.features.office && c.features.gacha && c.features.review && c.features.voice);
        assert!(c.features.agent_view, "세션 브라우저 앱에서 보기는 기본 켬");
        let off: Config = serde_json::from_str(r#"{"features":{"agentView":false}}"#).unwrap();
        assert!(!off.features.agent_view);
        assert!(serde_json::to_string(&off).unwrap().contains("\"agentView\":false"), "끈 값이 저장된다(래퍼가 읽는다)");
        assert!(!c.setup_done);
        // 말하기 키는 기본 끔 — 공개판이 첫 실행에 설명 없이 손쉬운 사용 권한을 묻고 지구본 키를 앱 밖에서도 봤다(0.2.0 검증)
        assert_eq!(c.talk_key, "");
        assert!(!c.talk_anywhere);
    }

    #[test]
    fn 주인은_지금처럼_지구본_키_어디서든() {
        let c = owner_config();
        assert_eq!(c.talk_key, "fn");
        assert!(c.talk_anywhere);
    }

    #[test]
    fn 기능_칸은_쓰기_읽기_왕복에서_안_사라진다() {
        // 앱(TS)이 보낸 설정을 그대로 저장했다가 다시 읽는다 — 구조체에 없는 칸은 serde 가 조용히 버린다
        let sent = r#"{"features":{"office":true,"tama":true,"gacha":true,"review":true,"voice":true,"autoRevive":true,"agentView":false}}"#;
        let c: Config = serde_json::from_str(sent).unwrap();
        let back = serde_json::to_value(&c).unwrap();
        assert_eq!(back["features"]["autoRevive"], serde_json::json!(true), "자동으로 다시 켜기가 저장에서 사라짐");
        assert_eq!(back["features"]["agentView"], serde_json::json!(false));
    }

    /// TS 소스에서 `{ 이름: 값, … }` / `이름?: 타입;` 줄의 칸 이름만 뽑는다(정규식 크레이트 없이)
    fn ts_keys(block: &str) -> Vec<(String, String)> {
        block
            .split([',', '\n', ';'])
            .filter_map(|part| {
                let t = part.trim().trim_start_matches('{').trim();
                let name: String = t.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
                let rest = t[name.len()..].trim_start_matches('?');
                (!name.is_empty() && rest.starts_with(':')).then(|| (name, rest[1..].trim().trim_end_matches('}').trim().to_string()))
            })
            .collect()
    }
    fn ts_block<'a>(src: &'a str, head: &str, end: &str) -> &'a str {
        let i = src.find(head).unwrap_or_else(|| panic!("TS 소스에 {head} 없음")) + head.len();
        &src[i..i + src[i..].find(end).unwrap()]
    }

    #[test]
    fn 기능_칸과_기본값이_ts_와_같다() {
        // 앱 화면(domain/config.ts ALL_ON)이 아는 기능 = 설정 파일(Rust Features)이 저장하는 기능, 기본값까지
        let ts = include_str!("../../src/domain/config.ts");
        let all_on = ts_keys(ts_block(ts, "export const ALL_ON: Features = {", "};"));
        let rust = serde_json::to_value(Features::default()).unwrap();
        let rust = rust.as_object().unwrap();
        let ts_names: Vec<&str> = all_on.iter().map(|(k, _)| k.as_str()).collect();
        let rust_names: Vec<&str> = rust.keys().map(|k| k.as_str()).collect();
        assert_eq!(ts_names, rust_names, "TS ALL_ON 과 Rust Features 칸이 다르다");
        for (k, v) in &all_on {
            assert_eq!(rust[k].to_string(), *v, "{k} 기본값이 TS·Rust 가 다르다");
        }
    }

    #[test]
    fn 설정_칸이_ts_와_같다() {
        // data/tauri.ts 의 Config 타입 칸 = Rust Config 가 저장하는 칸
        let ts = include_str!("../../src/data/tauri.ts");
        let mut ts_names: Vec<String> = ts_keys(ts_block(ts, "export type Config = {", "};")).into_iter().map(|(k, _)| k).collect();
        let v = serde_json::to_value(Config::default()).unwrap();
        let mut rust_names: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
        assert!(ts_names.len() >= 10, "TS Config 칸을 못 읽었다: {ts_names:?}");
        ts_names.sort();
        rust_names.sort();
        assert_eq!(ts_names, rust_names, "TS Config 와 Rust Config 칸이 다르다");
    }

    #[test]
    fn 파일_칸_이름은_카멜() {
        let v = serde_json::to_value(owner_config()).unwrap();
        for k in ["language", "assistantName", "devRoot", "hqDir", "extraProjects", "githubUser", "ttsCommand", "memoDir", "features", "setupDone", "talkKey", "talkAnywhere"] {
            assert!(v.get(k).is_some(), "{k}");
        }
    }

    // 2026-10-05 아이맥 QA: 기본값을 고르며 ~/Desktop/dev 를 물어(is_dir) 앱이 뜨자마자·폴더 고르기 전에
    // '데스크탑 폴더 접근' 권한 창이 떴다 — 맥 보호 폴더(데스크탑·문서·다운로드)는 사용자가 고르기 전엔 안 건드린다
    #[test]
    fn 새_설치_기본값은_보호_폴더를_안_묻는다() {
        let asked = std::cell::RefCell::new(Vec::<String>::new());
        let c = default_config("/h", Path::new("/h/.chammo"), "ko", |p| { asked.borrow_mut().push(p.to_string()); p == "/h/Desktop/dev" });
        for p in asked.borrow().iter() {
            assert!(!["/h/Desktop", "/h/Documents", "/h/Downloads"].iter().any(|x| p.starts_with(x)), "보호 폴더를 물었다: {p}");
        }
        assert_eq!(c.dev_root, "~/Developer");
    }

    #[test]
    fn 새_설치_기본값() {
        let c = default_config("/h", Path::new("/h/.chammo"), "en", |p| p == "/h/Projects");
        assert_eq!(c.dev_root, "~/Projects"); // 있는 것 중 첫 번째
        assert_eq!(c.hq_dir, "~/.chammo/hq");
        assert_eq!(c.memo_dir, "~/.chammo/memo");
        assert_eq!(c.tts_command, "say");
        assert_eq!(c.language, "en");
        assert!(!c.setup_done);
        assert_eq!(default_config("/h", Path::new("/d"), "ko", |_| false).dev_root, "~/Developer");
        assert_eq!(default_config("/h", Path::new("/d"), "ko", |_| false).hq_dir, "/d/hq");
    }

    #[test]
    fn 옛_설치는_주인_값으로() {
        let b = boot("/h", Path::new("/h/.honor-orchestrator"), None);
        let Boot::Owner(c) = b else { panic!("{b:?}") };
        assert_eq!(c.dev_root, "~/Desktop/dev");
        assert_eq!(c.hq_dir, "~/Desktop/dev/honor-orchestrator");
        assert_eq!(c.tts_command, "~/bin/local-say");
        assert_eq!(c.memo_dir, "~/.config/holo/memo");
        assert_eq!(c.github_user, "honorstudio");
        assert_eq!(c.assistant_name, "참모");
        assert_eq!(c.language, "ko");
        assert!(c.setup_done);
    }

    #[test]
    fn 저장된_설정이_있으면_그것() {
        let b = boot("/h", Path::new("/h/.honor-orchestrator"), Some(r#"{"language":"en"}"#));
        assert!(matches!(b, Boot::Saved(c) if c.language == "en"));
    }

    #[test]
    fn 새_설치는_기본값_깨진_파일도() {
        assert_eq!(boot("/h", Path::new("/h/.chammo"), None), Boot::Fresh);
        assert_eq!(boot("/h", Path::new("/h/.chammo"), Some("깨짐")), Boot::Fresh);
    }

    #[test]
    fn 음성_명령() {
        let none = |_: &str| false;
        assert_eq!(tts_argv("/h", "say", "안녕", none), ["say", "안녕"]);
        assert_eq!(tts_argv("/h", "say -v Yuna", "hi", none), ["say", "-v", "Yuna", "hi"]);
        assert_eq!(tts_argv("/h", "~/bin/local-say", "hi", |p| p == "/h/bin/local-say"), ["/h/bin/local-say", "hi"]);
        assert_eq!(tts_argv("/h", "/My Tools/tts", "hi", |p| p == "/My Tools/tts"), ["/My Tools/tts", "hi"]);
        assert_eq!(tts_argv("/h", " ", "hi", none), ["say", "hi"]);
    }

    #[test]
    fn 윈도우_say_는_파워셸_음성으로() {
        let a = say_for_windows(vec!["say".into(), "it's \"ok\"".into()]);
        assert_eq!(&a[..4], ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand"]);
        let script = crate::platform::decode_ps(&a[4]);
        assert!(script.contains("SpeechSynthesizer"));
        assert!(script.contains("Speak('it''s \"ok\"')"));
        assert!(!script.contains("SelectVoice"));
        let v = say_for_windows(vec!["say".into(), "-v".into(), "Microsoft_Heami_Desktop".into(), "안녕".into()]);
        let script = crate::platform::decode_ps(&v[4]);
        assert!(script.contains("SelectVoice('Microsoft Heami Desktop')"));
        assert!(script.contains("Speak('안녕')"));
        // say 가 아니면 손대지 않는다
        assert_eq!(say_for_windows(vec!["C:/t/speak.exe".into(), "hi".into()]), ["C:/t/speak.exe", "hi"]);
    }

    #[test]
    fn 비서_폴더는_환경변수가_먼저() {
        let c = owner_config();
        assert_eq!(hq_dir("/h", &c, |_| None), "/h/Desktop/dev/honor-orchestrator");
        assert_eq!(hq_dir("/h", &c, |k| (k == "HONOR_ORCH_CWD").then(|| "/t/old".into())), "/t/old");
        assert_eq!(hq_dir("/h", &c, |_| Some("/t/new".into())), "/t/new"); // CHAMMO_HQ 가 먼저
    }

    #[test]
    fn 언어는_시스템_지역으로() {
        assert_eq!(lang_from_locale("ko_KR"), "ko");
        assert_eq!(lang_from_locale("en_US"), "en");
        assert_eq!(lang_from_locale(""), "en");
        assert_eq!(lang_from_locale("ko-KR\r\n"), "ko"); // 윈도우 PowerShell (Get-UICulture).Name
    }

    #[test]
    fn 환경변수가_먼저() {
        let d = resolve_data_dir("/h", Some("/x/data"), |_| true);
        assert_eq!(d, PathBuf::from("/x/data"));
        assert_eq!(resolve_data_dir("/h", Some("~/d"), |_| false), PathBuf::from("/h/d"));
    }

    #[test]
    fn 빈_환경변수는_없는_것() {
        assert_eq!(resolve_data_dir("/h", Some("  "), |_| false), PathBuf::from("/h/.chammo"));
    }

    #[test]
    fn 새_설치는_chammo() {
        assert_eq!(resolve_data_dir("/h", None, |_| false), PathBuf::from("/h/.chammo"));
    }

    #[test]
    fn 옛_폴더만_있으면_옛_폴더를_그대로() {
        let d = resolve_data_dir("/h", None, |p| p == "/h/.honor-orchestrator");
        assert_eq!(d, PathBuf::from("/h/.honor-orchestrator"));
    }

    #[test]
    fn 둘_다_있으면_chammo() {
        assert_eq!(resolve_data_dir("/h", None, |_| true), PathBuf::from("/h/.chammo"));
    }

    #[test]
    fn 물결_풀기와_줄이기() {
        assert_eq!(expand("/h", "~/Desktop/dev"), "/h/Desktop/dev");
        assert_eq!(expand("/h", "~"), "/h");
        assert_eq!(expand("/h", "/abs"), "/abs");
        assert_eq!(tilde("/h", "/h/Desktop/dev"), "~/Desktop/dev");
        assert_eq!(tilde("/h", "/h"), "~");
        assert_eq!(tilde("/h", "/hx/a"), "/hx/a");
        assert_eq!(tilde("", "/a"), "/a");
    }
}
