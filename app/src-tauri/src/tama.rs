//! 다마고치 위젯 창과 저장 파일. 계산은 전부 프론트(domain/tama) — 여기선 파일 읽기/쓰기와 창 조작만
use tauri::Manager;

fn tama_path() -> std::path::PathBuf {
    crate::config::data_file("tama.json")
}

/// 다마고치 저장 파일. 없으면 빈 문자열(프론트가 빈 상태로 시작). 파싱은 domain/tama/store.ts
#[tauri::command]
pub fn read_tama() -> String {
    std::fs::read_to_string(tama_path()).unwrap_or_default()
}

/// 쓰는 도중에 위젯 창이 읽어도 안 깨지게 임시 파일에 쓰고 옮긴다
#[tauri::command]
pub fn write_tama(json: String) -> Result<(), String> {
    let path = tama_path();
    let tmp = path.with_extension("json.tmp");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 테두리 없는 창이라 끌어 옮기기를 직접 시작한다(권한 파일 없이 되게 커스텀 명령으로)
#[tauri::command]
pub fn tama_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

/// 위젯 보이기/숨기기. visible 을 안 주면 지금 상태만 알려준다 — 숨기면 상단 바에 작게 뜬다
#[tauri::command]
pub fn tama_widget(app: tauri::AppHandle, visible: Option<bool>) -> bool {
    let Some(w) = app.get_webview_window("tama") else { return false };
    match visible {
        Some(true) => { let _ = w.show(); }
        Some(false) => { let _ = w.hide(); }
        None => {}
    }
    w.is_visible().unwrap_or(false)
}

/// 위젯 → 메인 창 부탁("dex" = 다마고치 페이지 열어줘). 창끼리 이벤트는 권한 파일이 필요해서 한 칸짜리 우편함으로 대신한다.
/// kind 를 주면 넣고 메인 창을 앞으로, 안 주면(메인 창이 0.3초마다) 꺼내 간다
static REQUEST: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[tauri::command]
pub fn tama_request(app: tauri::AppHandle, kind: Option<String>) -> Option<String> {
    let mut slot = REQUEST.lock().unwrap();
    match kind {
        Some(k) => {
            *slot = Some(k);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            None
        }
        None => slot.take(),
    }
}

/// Dock 아이콘 뱃지 — 결정 대기 개수(0 이면 지움). 패널을 닫아 놔도, 다른 앱을 보고 있어도 보이게
#[tauri::command]
pub fn set_badge(app: tauri::AppHandle, count: u32) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(if count > 0 { Some(count as i64) } else { None });
    }
}

/// 처음 켤 때 위젯을 주 화면 오른쪽 위에
pub fn place(app: &tauri::App) {
    let Some(w) = app.get_webview_window("tama") else { return };
    let (Ok(Some(m)), Ok(size)) = (w.primary_monitor(), w.outer_size()) else { return };
    let x = m.position().x + m.size().width as i32 - size.width as i32 - (24.0 * m.scale_factor()) as i32;
    let y = m.position().y + (64.0 * m.scale_factor()) as i32;
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
}

fn gacha_path() -> std::path::PathBuf {
    crate::config::data_file("gacha.json")
}

/// 머지 가챠 저장 파일(코인·가진 것·천장). 없으면 빈 문자열. 파싱은 domain/gacha.ts
#[tauri::command]
pub fn read_gacha() -> String {
    std::fs::read_to_string(gacha_path()).unwrap_or_default()
}

/// 임시 파일에 쓰고 옮긴다(뽑는 순간 앱이 꺼져도 반쯤 쓴 파일이 안 남게)
#[tauri::command]
pub fn write_gacha(json: String) -> Result<(), String> {
    let path = gacha_path();
    let tmp = path.with_extension("json.tmp");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 다마고치 더보기 창(도감·보관함) — 있으면 앞으로, 없으면 만든다. 메인 창 페이지 대신 다마고치 틀의 따로 창(사용자 2026-09-28)
#[tauri::command]
pub fn tama_more(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("tama-more") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "tama-more", tauri::WebviewUrl::App("tama-more.html".into()))
        .title(crate::i18n::tr("다마고치", "Tamagotchi"))
        .inner_size(900.0, 680.0)
        .min_inner_size(560.0, 420.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
