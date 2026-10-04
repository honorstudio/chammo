//! 루틴(반복 업무) — 앱은 보여 주고 버튼만 누른다. 만들기·실행·예약(launchd)은 전부 scripts/routine 한 곳이 한다
//! (참모도 같은 스크립트를 쓴다). 앱이 켤 때 <데이터>/tools/routine 에 풀어 두고, launchd 도 그걸 부른다.
//! 맥 launchd 는 항목 하나가 1분마다 이 앱 실행 파일을 `--routine-tick` 으로 부른다 — 예약마다 python 항목을 걸었더니
//! 걸 때마다 '백그라운드 활동' 알림이 뜨고 로그인 항목에 python3.14 가 쌓였다(2026-10-03). 맥은 실행 파일 서명으로 이름을 붙인다
use std::path::{Path, PathBuf};

const SCRIPT: &str = include_str!("../../hq-template/scripts/routine");
pub const TICK_FLAG: &str = "--routine-tick";

pub fn tool_path(data: &Path) -> PathBuf {
    data.join("tools/routine")
}

pub fn export(data: &Path) -> std::io::Result<()> {
    let dest = tool_path(data);
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(&dest, SCRIPT)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

/// launchd 가 부른 `--routine-tick` — main 맨 앞에서 갈라 창·트레이·단일 실행 잠금 없이 `routine tick` 만 돌리고 끝낸다.
/// 데이터 폴더 스크립트가 이 앱 것과 다르면(앱을 올렸는데 아직 안 켰다) 이 앱 것으로 바꿔 놓고 돈다
pub fn tick_main() -> i32 {
    let data = crate::config::data_dir();
    if std::fs::read_to_string(tool_path(data)).ok().as_deref() != Some(SCRIPT) {
        let _ = export(data);
    }
    // 예약 세션 몇 개를 띄우는 데 1분이면 넉넉하다 — 멈추면 10분 뒤 죽여 다음 tick 이 막히지 않게
    match crate::platform::run_capped(crate::platform::python().arg(tool_path(data)).arg("tick").env("CHAMMO_HOME", data), std::time::Duration::from_secs(600)) {
        Ok(out) => {
            use std::io::Write;
            let _ = std::io::stdout().write_all(&out.stdout);
            let _ = std::io::stderr().write_all(&out.stderr);
            out.status.code().unwrap_or(1)
        }
        Err(e) => {
            eprintln!("routine tick: {e}");
            1
        }
    }
}

/// 앱 번들 안에서 돌 때만 자기 실행 파일을 실행기로 넘긴다 — 개발판(target/debug)은 서명이 없고 다시 빌드하면 바뀐다
pub fn launcher_arg(exe: &str) -> Option<&str> {
    exe.contains(".app/Contents/MacOS/").then_some(exe)
}

/// 앱이 켤 때 — 옛 예약별 launchd 항목을 tick 하나로 옮기고 이 앱 실행 파일로 건다. 이미 그렇게 걸려 있으면 손대지 않는다(맥만 — 윈도우는 작업 스케줄러 그대로)
#[cfg(target_os = "macos")]
pub fn install() {
    let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let mut args = vec!["install"];
    if let Some(e) = launcher_arg(&exe) {
        args.extend(["--launcher", e]);
    }
    if let Err(e) = script(&args) {
        eprintln!("routine install: {e}");
    }
}

/// 버튼으로 할 수 있는 것만 — 이름은 스크립트가 다시 검사한다(클라우드 루틴 이름이면 스크립트가 거절)
pub fn allowed(action: &str) -> bool {
    matches!(action, "run" | "pause" | "resume" | "remove")
}

fn script(args: &[&str]) -> Result<String, String> {
    let data = crate::config::data_dir();
    // 멈추면 1분 뒤 죽인다(모바일 서버 연결 자리가 안 풀리던 것 — 2026-10-02)
    let out = crate::platform::run_capped(crate::platform::python().arg(tool_path(data)).args(args).env("CHAMMO_HOME", data), std::time::Duration::from_secs(60))
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// 사이드바·루틴 화면 — 목록 JSON 원문(파싱은 domain/routine.ts)
#[tauri::command]
pub async fn routines_list() -> String {
    tauri::async_runtime::spawn_blocking(|| list_result().unwrap_or_else(|_| "[]".into())).await.unwrap_or_else(|_| "[]".into())
}

/// 예약 목록 — 실패면 이유(폰은 '예약 없음'과 '못 읽음'을 가른다). 실패는 앱 기록(notify.log)에도 남긴다 — 사용자 맥에서만 빈 목록이 났는데 이유가 어디에도 없었다(2026-10-03)
pub fn list_result() -> Result<String, String> {
    let r = script(&["list"]).map_err(|e| if e.trim().is_empty() { "예약 스크립트가 이유 없이 실패했어요".to_string() } else { e }).and_then(|s| match serde_json::from_str::<serde_json::Value>(&s) {
        Ok(v) if v.is_array() => Ok(s),
        _ => Err(format!("목록 모양이 이상해요: {}", s.chars().take(120).collect::<String>())),
    });
    if let Err(e) = &r {
        crate::claude::log_out("routines-list", e);
    }
    r
}

#[tauri::command]
pub async fn routine_do(name: String, action: String) -> Result<String, String> {
    if !allowed(&action) {
        return Err(format!("unknown action: {action}"));
    }
    tauri::async_runtime::spawn_blocking(move || script(&[&action, &name])).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 버튼_동작만_허용() {
        for a in ["run", "pause", "resume", "remove"] {
            assert!(allowed(a));
        }
        assert!(!allowed("new"));
        assert!(!allowed("report"));
        assert!(!allowed("run; rm -rf /"));
    }

    #[test]
    fn 번들_안_실행_파일만_실행기로() {
        assert_eq!(launcher_arg("/Applications/Chammo.app/Contents/MacOS/Chammo"), Some("/Applications/Chammo.app/Contents/MacOS/Chammo"));
        assert_eq!(launcher_arg("/repo/app/src-tauri/target/debug/Chammo"), None);
    }

    #[test]
    fn 스크립트를_데이터_폴더에_실행_권한으로() {
        let d = std::env::temp_dir().join(format!("chammo-routine-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        export(&d).unwrap();
        let p = tool_path(&d);
        let body = std::fs::read_to_string(&p).unwrap();
        assert!(body.contains("def run_now"));
        // 클라우드 루틴(claude.ai)은 목록에만 — routine_do 로 온 run·pause·remove 는 스크립트가 거절한다
        assert!(body.contains("def cloud_add") && body.contains("is a cloud routine"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o111, 0o111);
        }
        let _ = std::fs::remove_dir_all(&d);
    }
}
