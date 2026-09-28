//! 디버그 빌드 전용 실측 도구 — 화면 캡처 없이 dev 앱을 확인하려고(computer-use 안 씀).
//! HONOR_ORCH_DEBUG_JS=<js 파일> 로 띄우면 12초 뒤 메인 창에서 그 JS 를 돌리고, JS 는 debug_dump 로 글자를
//! HONOR_ORCH_DEBUG_OUT(없으면 <데이터 폴더>/debug) 에 남긴다. 릴리스 빌드에선 아무것도 안 한다
use tauri::{Manager, Runtime};

pub fn eval_from_env<R: Runtime>(app: &tauri::AppHandle<R>) {
    if !cfg!(debug_assertions) {
        return;
    }
    let Ok(path) = std::env::var("HONOR_ORCH_DEBUG_JS") else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(12));
        if let (Ok(js), Some(w)) = (std::fs::read_to_string(&path), app.get_webview_window("main")) {
            let _ = w.eval(js);
        }
    });
}

#[tauri::command]
pub fn debug_dump(name: String, text: String) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err(crate::i18n::tr("디버그 빌드에서만", "Debug builds only").into());
    }
    let dir = std::env::var("HONOR_ORCH_DEBUG_OUT").unwrap_or_else(|_| crate::config::data_file("debug").to_string_lossy().into_owned());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name.chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' }).collect();
    std::fs::write(format!("{dir}/{safe}.txt"), text).map_err(|e| e.to_string())
}
