//! 음성 — 설정에서 macOS 목소리와 Supertonic 중에 고른다(2026-09-28 사용자).
//! Supertonic 은 고를 때만 받는다: <데이터 폴더>/tts/supertonic 에 파이썬 가상환경(약 125MB) + 모델(약 385MB).
//! 설정에는 실행기 경로(`…/speak -v M1`)가 음성 명령으로 적히고, 읽기는 예전처럼 tts_argv 가 부른다
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

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
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755));
            }
        }
        let log = std::fs::File::create(d.join("install.log")).map_err(|e| e.to_string())?;
        let status = Command::new("/bin/bash")
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

/// 설정 화면이 열리거나 목소리를 바꿀 때 — 기다리지 않는다
#[tauri::command]
pub fn tts_warm(command: String) {
    let argv = crate::config::tts_argv(&crate::config::home(), &command, " ", |p| std::path::Path::new(p).is_file());
    let out = std::env::temp_dir().join("chammo-tts-warm.aiff");
    if let Some(w) = warm_argv(&argv, &out.to_string_lossy()) {
        let _ = Command::new(&w[0]).args(&w[1..]).spawn();
    }
}

/// `say -v ?` 목록 그대로 — 언어별로 거르는 건 프론트(domain/tts nativeVoices)
#[tauri::command]
pub fn native_voices() -> String {
    Command::new("say").args(["-v", "?"]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

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
