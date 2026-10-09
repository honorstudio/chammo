//! 음성 — 설정에서 macOS 목소리와 Supertonic 중에 고른다(2026-09-28 사용자).
//! Supertonic 은 고를 때만 받는다: <데이터 폴더>/tts/supertonic 에 파이썬 가상환경(약 125MB) + 모델(약 385MB).
//! 설정에는 실행기 경로(`…/speak -v M1`)가 음성 명령으로 적히고, 읽기는 예전처럼 tts_argv 가 부른다
use serde::Serialize;
use std::path::PathBuf;

const SAY_PY: &str = include_str!("../tts/say.py");
const SPEAK: &str = include_str!("../tts/speak");
const INSTALL: &str = include_str!("../tts/install.sh");

fn dir() -> PathBuf {
    crate::config::data_file("tts").join("supertonic")
}

/// 설정에 적힐 실행기 경로 — 홈은 ~ 로 줄여서(설정 화면·config.json 에 그대로 보인다)
pub fn tilde(home: &str, p: &str) -> String {
    match p.strip_prefix(home) {
        Some(rest) if !home.is_empty() && (rest.is_empty() || rest.starts_with('/')) => format!("~{rest}"),
        _ => p.to_string(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupertonicStatus {
    /// 설정에 적힐 실행기 경로
    runner: String,
    /// 받기가 끝났나(설치 스크립트가 마지막에 ready 를 남긴다)
    ready: bool,
}

#[tauri::command]
pub fn supertonic_status() -> SupertonicStatus {
    let d = dir();
    SupertonicStatus {
        runner: tilde(&crate::config::home(), &d.join("speak").to_string_lossy()),
        ready: d.join("ready").exists(),
    }
}

/// Supertonic 받기 — 몇 분 걸린다. 실패하면 설치 기록(install.log) 끝부분을 돌려준다
#[tauri::command]
pub async fn supertonic_install() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let d = dir();
        std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
        for (name, body, exec) in [("say.py", SAY_PY, false), ("speak", SPEAK, true), ("install.sh", INSTALL, true)] {
            let p = d.join(name);
            std::fs::write(&p, body).map_err(|e| format!("{name}: {e}"))?;
            if exec {
                crate::platform::make_executable(&p);
            }
        }
        let log = std::fs::File::create(d.join("install.log")).map_err(|e| e.to_string())?;
        let status = crate::platform::command("/bin/bash")
            .arg(d.join("install.sh"))
            .arg(&d)
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin")
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
        let tail = std::fs::read_to_string(d.join("install.log")).unwrap_or_default();
        let lines: Vec<&str> = tail.lines().rev().take(6).collect();
        Err(lines.into_iter().rev().collect::<Vec<_>>().join("\n"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 깔린 실행기가 앱의 것과 다르면 새것으로 — 받기 때 한 번만 써져서, 실행기를 고쳐도(PLAYING 줄, 2026-10-02) 옛것이 남는다.
/// 받기가 끝난 곳(ready)만. 모델·가상환경은 그대로
pub(crate) fn refresh_runner(d: &std::path::Path) {
    if !d.join("ready").exists() {
        return;
    }
    let p = d.join("speak");
    if std::fs::read_to_string(&p).ok().as_deref() != Some(SPEAK) && std::fs::write(&p, SPEAK).is_ok() {
        crate::platform::make_executable(&p);
    }
}

pub(crate) fn refresh_installed() {
    refresh_runner(&dir());
}

/// 미리 데우기 인자 — macOS say 만: 같은 목소리로 빈칸 하나를 파일로 만든다(소리 없이 목소리를 불러 둔다).
/// 처음 쓰는 목소리는 불러오느라 "들어보기"가 몇 초 늦었다(2026-09-28 아이맥). 스피커가 잠들었다 깨는 1초 남짓은 못 줄인다
pub fn warm_argv(argv: &[String], out: &str) -> Option<Vec<String>> {
    if argv.first().map(String::as_str) != Some("say") {
        return None;
    }
    let mut v = vec!["say".to_string(), "-o".into(), out.into()];
    v.extend(argv[1..].iter().cloned());
    Some(v)
}

/// Supertonic 목소리 10개 — 참모마다 고르는 목소리(avatars/<기본 이름>.json voice)도 이 안에서만
pub const VOICES: [&str; 10] = ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"];

/// 음성 명령의 목소리만 바꾼다 — 앱의 Supertonic 실행기(<데이터 폴더>/tts/supertonic/speak)일 때만.
/// macOS say·직접 입력(local-say 등 — 거기선 -v 가 OpenAI 로 간다)은 None = 손대지 않고 설정 그대로 읽는다
pub fn with_voice(home: &str, cmd: &str, voice: &str) -> Option<String> {
    if !VOICES.contains(&voice) {
        return None;
    }
    let mut parts = cmd.split_whitespace();
    let prog = parts.next()?;
    let full = crate::config::expand(home, prog).replace('\\', "/");
    if !full.ends_with("/tts/supertonic/speak") && !full.ends_with("/tts/supertonic/speak.cmd") {
        return None;
    }
    let rest: Vec<&str> = parts.collect();
    let mut out = vec![prog.to_string(), "-v".into(), voice.to_string()];
    let mut i = 0;
    while i < rest.len() {
        if rest[i] == "-v" { i += 2; continue; } // 있던 목소리는 뺀다
        out.push(rest[i].to_string());
        i += 1;
    }
    Some(out.join(" "))
}

/// 설정 목소리 — Supertonic 실행기일 때만(-v 값, 없거나 이상하면 M1). 아니면 None = 참모마다 목소리를 못 바꾼다(화면 domain/avatar baseVoice 와 같은 판단)
pub fn base_voice(home: &str, cmd: &str) -> Option<&'static str> {
    with_voice(home, cmd, "M1")?;
    let parts: Vec<&str> = cmd.split_whitespace().collect();
    let v = parts.iter().position(|p| *p == "-v").and_then(|i| parts.get(i + 1)).copied().unwrap_or("M1");
    Some(VOICES.iter().copied().find(|x| *x == v).unwrap_or("M1"))
}

/// 설정 화면이 열리거나 목소리를 바꿀 때 — 기다리지 않는다
#[tauri::command]
pub fn tts_warm(command: String) {
    let argv = crate::config::tts_argv(&crate::config::home(), &command, " ", |p| std::path::Path::new(p).is_file());
    let out = std::env::temp_dir().join("chammo-tts-warm.aiff");
    if let Some(w) = warm_argv(&argv, &out.to_string_lossy()) {
        let _ = crate::platform::spawn_reaped(crate::platform::command(&w[0]).args(&w[1..]));
    }
}

/// `say -v ?` 목록 그대로 — 언어별로 거르는 건 프론트(domain/tts nativeVoices)
#[tauri::command]
pub fn native_voices() -> String {
    crate::platform::native_voices()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 참모_목소리는_supertonic_실행기일_때만_바꾼다() {
        let h = "/Users/me";
        assert_eq!(with_voice(h, "~/.chammo/tts/supertonic/speak -v M1", "F3").as_deref(), Some("~/.chammo/tts/supertonic/speak -v F3"));
        assert_eq!(with_voice(h, "/Users/me/.honor-orchestrator/tts/supertonic/speak", "M2").as_deref(), Some("/Users/me/.honor-orchestrator/tts/supertonic/speak -v M2"));
        // macOS say·local-say(-v 가 OpenAI)·OpenAI 직접 입력은 그대로
        assert_eq!(with_voice(h, "say -v Yuna", "F1"), None);
        assert_eq!(with_voice(h, "~/bin/local-say", "F1"), None);
        assert_eq!(with_voice(h, "~/bin/local-say -openai", "F1"), None);
        // 허용 목록 밖 목소리·주입 시도는 거절
        assert_eq!(with_voice(h, "~/.chammo/tts/supertonic/speak -v M1", "X9"), None);
        assert_eq!(with_voice(h, "~/.chammo/tts/supertonic/speak -v M1", "M1; rm -rf ~"), None);
        assert_eq!(with_voice(h, "", "M1"), None);
    }

    #[test]
    fn 기본_목소리는_supertonic_일_때만_폰에_알린다() {
        // 폰 프로필 창의 '기본' 목소리 — 화면 domain/avatar baseVoice 와 같은 판단, 명령 원문은 폰에 안 낸다
        let h = "/Users/me";
        assert_eq!(base_voice(h, "~/.chammo/tts/supertonic/speak -v F3"), Some("F3"));
        assert_eq!(base_voice(h, "~/.chammo/tts/supertonic/speak"), Some("M1"));
        assert_eq!(base_voice(h, "~/.chammo/tts/supertonic/speak -v X9"), Some("M1"));
        assert_eq!(base_voice(h, "say -v Yuna"), None);
        assert_eq!(base_voice(h, "~/bin/local-say -v alloy"), None);
    }

    #[test]
    fn macos_목소리만_소리_없이_파일로_미리_부른다() {
        let a = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(warm_argv(&a(&["say", "-v", "Yuna", " "]), "/tmp/w.aiff"), Some(a(&["say", "-o", "/tmp/w.aiff", "-v", "Yuna", " "])));
        assert_eq!(warm_argv(&a(&["say", " "]), "/tmp/w.aiff"), Some(a(&["say", "-o", "/tmp/w.aiff", " "])));
        // Supertonic 은 매번 새로 띄우는 파이썬이라 데울 게 없다 — 부르면 소리가 난다
        assert_eq!(warm_argv(&a(&["/h/.chammo/tts/supertonic/speak", "-v", "M1", " "]), "/tmp/w.aiff"), None);
    }

    #[test]
    fn 홈_아래는_물결로_줄인다() {
        assert_eq!(tilde("/Users/a", "/Users/a/.chammo/tts/supertonic/speak"), "~/.chammo/tts/supertonic/speak");
        assert_eq!(tilde("/Users/a", "/Users/ab/x"), "/Users/ab/x");
        assert_eq!(tilde("", "/x"), "/x");
    }

    #[test]
    fn 설치_스크립트는_마지막에_ready_를_남긴다() {
        assert!(INSTALL.trim_end().ends_with(r#"touch "$DIR/ready""#));
        assert!(SPEAK.contains("afplay"));
    }
}

#[cfg(test)]
mod runner_tests {
    use super::{refresh_runner, SPEAK};

    // 깔린 실행기는 받기 때 한 번만 써진다 — PLAYING 줄이 없는 옛 실행기면 '재생 중'을 영영 모른다
    #[test]
    fn 깔린_옛_실행기는_새것으로_바꾼다() {
        let d = std::env::temp_dir().join(format!("chammo-runner-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("speak"), "#!/bin/bash\nafplay x\n").unwrap();
        refresh_runner(&d);
        assert!(std::fs::read_to_string(d.join("speak")).unwrap().contains("afplay x"), "받기가 안 끝났으면(ready 없음) 건드리지 않는다");
        std::fs::write(d.join("ready"), "").unwrap();
        refresh_runner(&d);
        assert_eq!(std::fs::read_to_string(d.join("speak")).unwrap(), SPEAK);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert!(std::fs::metadata(d.join("speak")).unwrap().permissions().mode() & 0o111 != 0);
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 실행기는_afplay_직전에_playing_을_찍는다() {
        let i = SPEAK.find("echo \"PLAYING $BASE.wav\"").expect("PLAYING <wav> 줄 — 곡선을 뽑게 경로를 단다");
        assert!(SPEAK.contains("trap 'rm -f"), "멈춤으로 끊겨도 임시 wav 를 지운다");
        assert!(i < SPEAK.rfind("afplay").unwrap());
    }
}
