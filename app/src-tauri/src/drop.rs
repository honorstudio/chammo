//! 파일 끌어다 놓기 — 창의 드래그드롭 이벤트를 메인 웹뷰의 window.__drop(...) 으로 넘긴다.
//! 어느 칸에 넣을지·경로 이스케이프는 프론트(domain/drop.ts). 좌표는 웹뷰 안 좌표(clientX/Y) —
//! 이름은 PhysicalPosition 이지만 macOS(wry)는 포인트 단위라 그대로 쓰고, 윈도우(wry ScreenToClient)는 진짜 물리 픽셀이라
//! 창 배율로 나눈다(125·150% PC 에서 놓은 자리가 오른쪽 아래로 틀어져 끌기가 조용히 사라졌다, 2026-10-24)

use serde_json::json;
use tauri::{DragDropEvent, Manager, Runtime, Window};

/// scale = 좌표를 나눌 배율(맥 1, 윈도우 창 배율)
fn payload(e: &DragDropEvent, scale: f64) -> serde_json::Value {
    let paths = |ps: &[std::path::PathBuf]| ps.iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>();
    let k = if scale > 0.0 { scale } else { 1.0 };
    match e {
        DragDropEvent::Enter { position, .. } | DragDropEvent::Over { position } => json!({ "type": "over", "x": position.x / k, "y": position.y / k }),
        DragDropEvent::Drop { paths: ps, position } => json!({ "type": "drop", "x": position.x / k, "y": position.y / k, "paths": paths(ps) }),
        _ => json!({ "type": "leave" }),
    }
}

fn send<R: Runtime>(app: &tauri::AppHandle<R>, v: serde_json::Value) {
    send_to(app, "main", v);
}

fn send_to<R: Runtime>(app: &tauri::AppHandle<R>, label: &str, v: serde_json::Value) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.eval(format!("window.__drop && window.__drop({v})"));
    }
}

/// 메신저 따로 창(team-*)에 놓은 파일은 그 창으로(대화에 붙이기, 시안 msg-rooms v2) — 나머지 창은 메인 창으로
pub fn forward<R: Runtime>(window: &Window<R>, e: &DragDropEvent) {
    let scale = if cfg!(windows) { window.scale_factor().unwrap_or(1.0) } else { 1.0 };
    let label = window.label();
    // 바탕 배지 대화창에 놓은 파일도 그 창으로(그 참모 대화창 입력에 붙인다)
    let to = if crate::team_ui::ui_window(label) || label == crate::orch_bubble::LABEL { label } else { "main" };
    send_to(window.app_handle(), to, payload(e, scale));
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
        assert_eq!(payload(&e, 1.0), json!({ "type": "drop", "x": 10.0, "y": 20.0, "paths": ["/a/스크린샷 1.png"] }));
    }

    // 윈도우(wry)는 ScreenToClient 물리 픽셀을 준다 — 150% 배율 PC 에서 입력칸(CSS 431,587)에 놓으면 646,880 이 와서
    // 창 밖(높이 630)으로 떨어져 끌기가 조용히 사라졌다(2026-10-24 시험 PC 실측). 웹뷰 좌표(CSS px)로 나눠 넘긴다
    #[test]
    fn 윈도우_물리_좌표는_배율로_나눠_웹뷰_좌표로() {
        let e = DragDropEvent::Drop { paths: vec![r"C:\Users\Me\Desktop\a.png".into()], position: PhysicalPosition::new(646.5, 880.5) };
        let v = payload(&e, 1.5);
        assert_eq!((v["x"].as_f64().unwrap(), v["y"].as_f64().unwrap()), (431.0, 587.0));
        assert_eq!(v["paths"][0], r"C:\Users\Me\Desktop\a.png");
        assert_eq!(payload(&DragDropEvent::Over { position: PhysicalPosition::new(300.0, 125.0) }, 1.25)["x"], 240.0);
        // 배율을 못 읽으면(0) 나누지 않는다
        assert_eq!(payload(&e, 0.0)["x"], 646.5);
    }

    #[test]
    fn 들어옴_움직임은_over_떠남은_leave() {
        let p = PhysicalPosition::new(1.0, 2.0);
        assert_eq!(payload(&DragDropEvent::Enter { paths: vec![], position: p }, 1.0)["type"], "over");
        assert_eq!(payload(&DragDropEvent::Over { position: p }, 1.0)["type"], "over");
        assert_eq!(payload(&DragDropEvent::Leave, 1.0)["type"], "leave");
    }
}
