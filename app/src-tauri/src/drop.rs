//! 파일 끌어다 놓기 — 창의 드래그드롭 이벤트를 메인 웹뷰의 window.__drop(...) 으로 넘긴다.
//! 어느 칸에 넣을지·경로 이스케이프는 프론트(domain/drop.ts). 좌표는 웹뷰 안 좌표 —
//! 이름은 PhysicalPosition 이지만 macOS(wry)는 포인트 단위라 그대로 clientX/Y 다

use serde_json::json;
use tauri::{DragDropEvent, Manager, Runtime, Window};

fn payload(e: &DragDropEvent) -> serde_json::Value {
    let paths = |ps: &[std::path::PathBuf]| ps.iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>();
    match e {
        DragDropEvent::Enter { position, .. } | DragDropEvent::Over { position } => json!({ "type": "over", "x": position.x, "y": position.y }),
        DragDropEvent::Drop { paths: ps, position } => json!({ "type": "drop", "x": position.x, "y": position.y, "paths": paths(ps) }),
        _ => json!({ "type": "leave" }),
    }
}

fn send<R: Runtime>(app: &tauri::AppHandle<R>, v: serde_json::Value) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(format!("window.__drop && window.__drop({v})"));
    }
}

pub fn forward<R: Runtime>(window: &Window<R>, e: &DragDropEvent) {
    send(window.app_handle(), payload(e));
}

/// dev 검증용 — 사람 손 없이 드롭을 흉내 낸다. HONOR_ORCH_FAKE_DROP="x,y|경로|경로…" 면 12초 뒤 한 번.
/// 네이티브 이벤트 바로 다음(웹뷰로 넘기는 곳)부터는 진짜 드롭과 같은 길로 간다. 디버그 빌드에만 있다
#[cfg(debug_assertions)]
pub fn fake_from_env<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Ok(spec) = std::env::var("HONOR_ORCH_FAKE_DROP") else { return };
    let mut parts = spec.split('|');
    let xy: Vec<f64> = parts.next().unwrap_or("").split(',').filter_map(|n| n.trim().parse().ok()).collect();
    let paths: Vec<String> = parts.map(str::to_owned).collect();
    let (x, y) = (xy.first().copied().unwrap_or(0.0), xy.get(1).copied().unwrap_or(0.0));
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(12));
        send(&app, json!({ "type": "over", "x": x, "y": y }));
        std::thread::sleep(std::time::Duration::from_millis(800));
        send(&app, json!({ "type": "drop", "x": x, "y": y, "paths": paths }));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::PhysicalPosition;

    #[test]
    fn 드롭은_경로와_좌표를_그대로() {
        let e = DragDropEvent::Drop { paths: vec!["/a/스크린샷 1.png".into()], position: PhysicalPosition::new(10.0, 20.0) };
        assert_eq!(payload(&e), json!({ "type": "drop", "x": 10.0, "y": 20.0, "paths": ["/a/스크린샷 1.png"] }));
    }

    #[test]
    fn 들어옴_움직임은_over_떠남은_leave() {
        let p = PhysicalPosition::new(1.0, 2.0);
        assert_eq!(payload(&DragDropEvent::Enter { paths: vec![], position: p })["type"], "over");
        assert_eq!(payload(&DragDropEvent::Over { position: p })["type"], "over");
        assert_eq!(payload(&DragDropEvent::Leave)["type"], "leave");
    }
}
