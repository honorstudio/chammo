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
    // 12초 뒤 한 번, 그 뒤로 3초마다 다시 — 개발판은 화면이 다시 읽히면(vite) 심은 JS 가 사라진다. JS 쪽이 window 표시로 두 번 안 돌게 막는다
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(12));
        loop {
            if let (Ok(js), Some(w)) = (std::fs::read_to_string(&path), app.get_webview_window("main")) {
                let _ = w.eval(js);
            }
            if std::env::var("HONOR_ORCH_DEBUG_REPEAT").is_err() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(3));
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

/// 개발판 창은 사용자 눈앞(주 화면) 말고 — 시험 앱이 작업 화면을 자꾸 가렸다(2026-10-02 사용자). 외장 모니터가 있으면 주 화면 아닌 진짜 화면,
/// 맥북 하나면 가짜 화면(Chammo agents — 행사장처럼 화면이 하나면 내장 화면이 곧 사용자 눈앞, 2026-10-03), 그것도 없으면 화면 밖.
/// 화면 = (x, y, 폭, 높이, 가짜인가) 물리 픽셀, 주 화면은 (0,0) 에서 시작. 돌려주는 값 = (자리, 고른 화면 번호 — 화면 밖이면 None)
pub fn aside_spot(monitors: &[(i32, i32, u32, u32, bool)], scale: f64) -> ((i32, i32), Option<usize>) {
    let pick = monitors.iter().position(|m| (m.0, m.1) != (0, 0) && !m.4).or_else(|| monitors.iter().position(|m| m.4));
    match pick {
        Some(i) => ((monitors[i].0 + (20.0 * scale) as i32, monitors[i].1 + (40.0 * scale) as i32), Some(i)),
        None => ((monitors.iter().map(|m| m.0 + m.2 as i32).max().unwrap_or(0) + (4000.0 * scale) as i32, 0), None),
    }
}

pub fn place_dev_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if !cfg!(debug_assertions) || std::env::var("CHAMMO_DEV_WINDOW").as_deref() == Ok("main") {
        return;
    }
    let Some(w) = app.get_webview_window("main") else { return };
    let Ok(ms) = w.available_monitors() else { return };
    // 화면마다 배율이 달라(맥북 2배·가짜 화면 1배) 물리 픽셀을 섞으면 자리·크기가 반쪽이 됐다(2026-10-03 실측) — 논리 좌표로 고른다
    let lg = |m: &tauri::Monitor| {
        let s = m.scale_factor();
        ((m.position().x as f64 / s) as i32, (m.position().y as f64 / s) as i32, (m.size().width as f64 / s) as u32, (m.size().height as f64 / s) as u32)
    };
    let list: Vec<_> = ms.iter().map(|m| { let (x, y, w, h) = lg(m); (x, y, w, h, m.name().is_some_and(|n| n == crate::vdisplay::NAME)) }).collect();
    let ((x, y), at) = aside_spot(&list, 1.0);
    let _ = w.set_position(tauri::LogicalPosition::new(x, y));
    if let Some(i) = at {
        // 그 화면에 들어가게 — 화면보다 크면 줄인다(논리 크기)
        let (_, _, mw, mh, _) = list[i];
        if let (Ok(sz), Ok(s)) = (w.outer_size(), w.scale_factor()) {
            let (cw, ch) = ((sz.width as f64 / s) as u32, (sz.height as f64 / s) as u32);
            let (fw, fh) = (cw.min(mw.saturating_sub(40)), ch.min(mh.saturating_sub(80)));
            if (fw, fh) != (cw, ch) {
                let _ = w.set_size(tauri::LogicalSize::new(fw, fh));
            }
        }
    }
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

#[cfg(test)]
mod aside_tests {
    use super::aside_spot;
    #[test]
    fn 외장_모니터가_있으면_주_화면_아닌_진짜_화면() {
        // 주 화면(0,0 1920x1080) + 왼쪽 맥북 + 가짜 화면
        let ms = [(0, 0, 1920, 1080, false), (-2880, 2000, 2880, 1800, true), (-2940, 248, 2940, 1912, false)];
        assert_eq!(aside_spot(&ms, 2.0), ((-2940 + 40, 248 + 80), Some(2)));
    }
    #[test]
    fn 맥북_하나면_가짜_화면에_사용자_눈앞에_안_뜨게() {
        let ms = [(0, 0, 2940, 1912, false), (-2880, 1912, 2880, 1800, true)];
        assert_eq!(aside_spot(&ms, 2.0), ((-2880 + 40, 1912 + 80), Some(1)));
    }
    #[test]
    fn 둘_다_없으면_화면_밖() {
        let ((x, _), at) = aside_spot(&[(0, 0, 2940, 1912, false)], 2.0);
        assert!(x > 2940 && at.is_none());
    }
}
