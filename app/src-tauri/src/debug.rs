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

/// 모델 칩이 실패했을 때 그때 터미널 화면을 <데이터 폴더>/pick-debug.log 에 덧붙인다(로컬 파일, 200KB 넘으면 앞을 버린다) — 실제 앱에서 왜 못 읽었는지 보려고
#[tauri::command]
pub fn pick_log(text: String) -> Result<(), String> {
    append_capped(&crate::config::data_file("pick-debug.log"), &text, 200 * 1024).map_err(|e| e.to_string())
}

pub fn append_capped(path: &std::path::Path, text: &str, cap: usize) -> std::io::Result<()> {
    let mut cur = std::fs::read_to_string(path).unwrap_or_default();
    cur.push_str(text);
    if !text.ends_with('\n') { cur.push('\n'); }
    if cur.len() > cap {
        let mut cut = cur.len() - cap;
        while !cur.is_char_boundary(cut) { cut += 1; }
        cur = cur[cut..].to_string();
    }
    if let Some(d) = path.parent() { std::fs::create_dir_all(d)?; }
    std::fs::write(path, cur)
}

#[cfg(test)]
mod pick_log_tests {
    #[test]
    fn 덧붙이고_크기를_넘으면_앞을_버린다() {
        let p = std::env::temp_dir().join(format!("chammo-picklog-{}.log", std::process::id()));
        let _ = std::fs::remove_file(&p);
        super::append_capped(&p, "하나", 100).unwrap();
        super::append_capped(&p, "둘", 100).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "하나\n둘\n");
        super::append_capped(&p, &"가".repeat(60), 100).unwrap(); // 180 바이트 → 100 이하로 앞을 자른다(글자 경계 지킴)
        let t = std::fs::read_to_string(&p).unwrap();
        assert!(t.len() <= 100 && t.ends_with("가\n"), "{}", t.len());
        let _ = std::fs::remove_file(&p);
    }
}
