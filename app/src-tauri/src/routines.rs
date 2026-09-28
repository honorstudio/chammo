//! 루틴(반복 업무) — 앱은 보여 주고 버튼만 누른다. 만들기·실행·예약(launchd)은 전부 scripts/routine 한 곳이 한다
//! (참모도 같은 스크립트를 쓴다). 앱이 켤 때 <데이터>/tools/routine 에 풀어 두고, launchd 도 그걸 부른다
use std::path::{Path, PathBuf};

const SCRIPT: &str = include_str!("../../hq-template/scripts/routine");

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

/// 버튼으로 할 수 있는 것만 — 이름은 스크립트가 다시 검사한다
pub fn allowed(action: &str) -> bool {
    matches!(action, "run" | "pause" | "resume" | "remove")
}

fn script(args: &[&str]) -> Result<String, String> {
    let data = crate::config::data_dir();
    let out = std::process::Command::new("/usr/bin/python3")
        .arg(tool_path(data))
        .args(args)
        .env("CHAMMO_HOME", data)
        .output()
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
    tauri::async_runtime::spawn_blocking(|| script(&["list"]).unwrap_or_else(|_| "[]".into())).await.unwrap_or_else(|_| "[]".into())
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
    fn 스크립트를_데이터_폴더에_실행_권한으로() {
        let d = std::env::temp_dir().join(format!("chammo-routine-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        export(&d).unwrap();
        let p = tool_path(&d);
        assert!(std::fs::read_to_string(&p).unwrap().contains("def run_now"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o111, 0o111);
        }
        let _ = std::fs::remove_dir_all(&d);
    }
}
