//! Claude Code 판이 바뀌면 맥이 그 판을 새 앱으로 봐서 데스크톱·문서 폴더 권한 창을 다시 띄운다(TCC 는 판 폴더 경로로 기억한다).
//! 답을 기다리는 동안 그 판의 파일 접근이 멈추고, 오래 두면 맥 전체의 폴더 확인까지 멈춘다 — 2026-11-04 2.1.318: 16:24 에야 눌렸는데
//! 13:19 부터 sandboxd 요청이 끊겨 앱 재시작이 113분 멈췄다. 창은 앱이 대신 못 누르니 사람에게 알린다. 권한 기록(TCC.db)을 못 읽으면 조용히 넘어간다
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// 판이 깔리고 이만큼 지나도 허용 기록이 없으면 알린다 — 세션이 새 판으로 넘어와 폴더를 만지기까지 여유
const GRACE: Duration = Duration::from_secs(300);
const QUERY_LIMIT: Duration = Duration::from_secs(5);

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderPrompt {
    pub version: String,
    /// desktop | documents
    pub folder: &'static str,
}

/// 프로젝트 폴더가 맥이 지키는 폴더 안이면 (TCC 서비스 이름, 폴더)
pub fn service_for(home: &str, dev_root: &str) -> Option<(&'static str, &'static str)> {
    let under = |name: &str| Path::new(dev_root).starts_with(Path::new(home).join(name));
    if under("Desktop") {
        Some(("kTCCServiceSystemPolicyDesktopFolder", "desktop"))
    } else if under("Documents") {
        Some(("kTCCServiceSystemPolicyDocumentsFolder", "documents"))
    } else {
        None
    }
}

/// 네이티브 설치 판 경로의 판 번호 — 아니면(npm·brew) None: 그쪽은 경로 기억이 다르다
pub fn native_version(real: &Path) -> Option<String> {
    let s = real.to_string_lossy();
    s.contains("/.local/share/claude/versions/").then(|| real.file_name().map(|n| n.to_string_lossy().into_owned())).flatten()
}

/// daemon.lock 의 launchTarget(데몬이 띄운 판 경로)
pub fn launch_target(lock: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(lock).ok()?.get("launchTarget")?.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

/// 답(허용·거절)이 아직 없나 — rows 는 그 판의 서비스 이름 줄들
pub fn waiting(rows: &str, service: &str, age: Duration) -> bool {
    age >= GRACE && !rows.lines().any(|l| l.trim() == service)
}

fn answered() -> &'static Mutex<Option<PathBuf>> {
    static V: Mutex<Option<PathBuf>> = Mutex::new(None);
    &V
}

/// 지금 판이 폴더 권한 창 답을 기다리는 것 같으면 그 판·폴더. 답을 본 판은 다시 안 읽는다(평소엔 sqlite3 를 안 부른다)
#[tauri::command]
pub fn claude_folder_prompt() -> Option<FolderPrompt> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let home = crate::config::home();
    let dev_root = crate::config::expand(&home, &crate::config::current().dev_root);
    let (service, folder) = service_for(&home, &dev_root)?;
    // 데몬이 실제로 돌리는 판 — 새 판이 깔려도 데몬이 옛 판이면 그 판은 아직 폴더를 안 만져서 기록이 없는 게 맞다
    let lock = std::fs::read_to_string(Path::new(&home).join(".claude/daemon.lock")).ok()?;
    let real = PathBuf::from(launch_target(&lock)?);
    let version = native_version(&real)?;
    if answered().lock().unwrap().as_ref() == Some(&real) {
        return None;
    }
    let age = std::fs::metadata(&real).and_then(|m| m.modified()).ok()?.elapsed().ok()?;
    if age < GRACE {
        return None;
    }
    let db = Path::new(&home).join("Library/Application Support/com.apple.TCC/TCC.db");
    let sql = format!("select service from access where client='{}'", real.to_string_lossy().replace('\'', "''"));
    let mut cmd = crate::platform::command("/usr/bin/sqlite3");
    cmd.arg("-readonly").arg(&db).arg(sql);
    // 시간 초과면 다음 차례에 다시. 못 읽는 맥(전체 디스크 접근 없음)이면 이 판은 그만 본다 — sqlite3 를 2분마다 부르지 않게
    let out = crate::platform::run_capped(&mut cmd, QUERY_LIMIT).ok()?;
    if out.status.success() && waiting(&String::from_utf8_lossy(&out.stdout), service, age) {
        return Some(FolderPrompt { version, folder });
    }
    *answered().lock().unwrap() = Some(real);
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    const DESK: &str = "kTCCServiceSystemPolicyDesktopFolder";

    #[test]
    fn 프로젝트_폴더가_지키는_폴더_안일_때만_본다() {
        assert_eq!(service_for("/Users/a", "/Users/a/Desktop/dev"), Some((DESK, "desktop")));
        assert_eq!(service_for("/Users/a", "/Users/a/Documents/x").map(|x| x.1), Some("documents"));
        assert_eq!(service_for("/Users/a", "/Users/a/dev"), None);
        assert_eq!(service_for("/Users/a", "/Users/a/DesktopX/dev"), None, "이름이 비슷한 폴더는 아니다");
    }

    #[test]
    fn 네이티브_판_경로만_판_번호를_읽는다() {
        assert_eq!(native_version(Path::new("/Users/a/.local/share/claude/versions/2.1.318")).as_deref(), Some("2.1.318"));
        assert_eq!(native_version(Path::new("/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js")), None);
    }

    #[test]
    fn 데몬이_돌리는_판을_읽는다() {
        let lock = r#"{"pid":26399,"version":"2.1.318","launchTarget":"/Users/a/.local/share/claude/versions/2.1.318","processWrapper":""}"#;
        assert_eq!(launch_target(lock).as_deref(), Some("/Users/a/.local/share/claude/versions/2.1.318"));
        assert_eq!(launch_target(r#"{"pid":1}"#), None);
        assert_eq!(launch_target("깨진 글"), None);
    }

    #[test]
    fn 재현_판이_깔리고_5분_넘게_답이_없으면_기다리는_것() {
        let min = |m: u64| Duration::from_secs(m * 60);
        assert!(waiting("", DESK, min(444)), "2.1.318: 기록 없음, 7시간째");
        assert!(waiting("kTCCServiceMicrophone\n", DESK, min(6)), "다른 권한만 있으면 아직");
        assert!(!waiting(&format!("{DESK}\n"), DESK, min(444)), "허용·거절 기록이 있으면 답한 것");
        assert!(!waiting("", DESK, min(4)), "막 깔린 판은 기다린다");
    }
}
