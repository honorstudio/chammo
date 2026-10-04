//! 세션 브라우저 '크게 보기' 모달에서 직접 조작(2026-10-03 사용자 "이게 크게 보여야 해") — 앱이 받은 클릭·스크롤·키·글을
//! CDP Input 으로 그 크롬(127.0.0.1)에 보낸다. 친 글·비밀번호는 어디에도 남기지 않는다(로그·오류 글에도 글자 없음)
use serde::Deserialize;
use serde_json::{json, Value};

/// 프론트가 보내는 입력 하나. 좌표는 화면 그림 안 비율(0~1) — 그림이 작게 줄어 있어도 페이지 좌표로 환산한다
#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputEv {
    #[serde(rename_all = "camelCase")]
    Mouse {
        #[serde(rename = "type")]
        ty: String,
        x: f64,
        y: f64,
        #[serde(default)]
        button: Option<String>,
        #[serde(default)]
        click_count: Option<u32>,
        #[serde(default)]
        delta_x: Option<f64>,
        #[serde(default)]
        delta_y: Option<f64>,
        #[serde(default)]
        modifiers: u32,
    },
    #[serde(rename_all = "camelCase")]
    Key {
        #[serde(rename = "type")]
        ty: String,
        key: String,
        #[serde(default)]
        code: String,
        #[serde(default)]
        key_code: u32,
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        modifiers: u32,
        #[serde(default)]
        commands: Vec<String>,
    },
    Text { text: String },
    /// ⌘R·⌘[·⌘] — 새로고침·뒤로·앞으로
    Nav { action: String },
}

/// 지금 화면 프레임의 페이지 크기(CSS px) — screencastFrame metadata.deviceWidth/Height
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Meta {
    pub w: f64,
    pub h: f64,
}

const MOUSE: &[&str] = &["mouseMoved", "mousePressed", "mouseReleased", "mouseWheel"];
const KEY: &[&str] = &["keyDown", "keyUp", "rawKeyDown", "char"];
const BUTTONS: &[&str] = &["none", "left", "middle", "right"];
/// 편집 명령만(⌘A·복사 등) — 아무 명령이나 받지 않는다
const COMMANDS: &[&str] = &["selectAll", "copy", "cut", "paste", "undo", "redo"];
const MAX_TEXT: usize = 10_000;

/// 입력 하나 → CDP (메서드, 인자). 모양이 이상하면 None(조용히 버림 — 글자를 오류에 안 실으려고)
pub fn to_cdp(ev: &InputEv, meta: Meta) -> Option<(&'static str, Value)> {
    match ev {
        InputEv::Mouse { ty, x, y, button, click_count, delta_x, delta_y, modifiers } => {
            if !MOUSE.contains(&ty.as_str()) || meta.w <= 0.0 || meta.h <= 0.0 || !x.is_finite() || !y.is_finite() {
                return None;
            }
            let b = button.as_deref().filter(|b| BUTTONS.contains(b)).unwrap_or(if ty == "mouseMoved" || ty == "mouseWheel" { "none" } else { "left" });
            let mut p = json!({
                "type": ty, "x": (x.clamp(0.0, 1.0) * meta.w).round(), "y": (y.clamp(0.0, 1.0) * meta.h).round(),
                "button": b, "modifiers": modifiers & 0xf, "clickCount": click_count.unwrap_or(if ty == "mousePressed" || ty == "mouseReleased" { 1 } else { 0 }).min(3),
            });
            if ty == "mouseWheel" {
                p["deltaX"] = json!(delta_x.unwrap_or(0.0).clamp(-5000.0, 5000.0));
                p["deltaY"] = json!(delta_y.unwrap_or(0.0).clamp(-5000.0, 5000.0));
            }
            Some(("Input.dispatchMouseEvent", p))
        }
        InputEv::Key { ty, key, code, key_code, text, modifiers, commands } => {
            if !KEY.contains(&ty.as_str()) || key.chars().count() > 32 || code.len() > 32 {
                return None;
            }
            let mut p = json!({ "type": ty, "key": key, "code": code, "windowsVirtualKeyCode": key_code, "nativeVirtualKeyCode": key_code, "modifiers": modifiers & 0xf });
            if let Some(t) = text.as_ref().filter(|t| t.chars().count() <= 4) {
                p["text"] = json!(t);
                p["unmodifiedText"] = json!(t);
            }
            let cmds: Vec<&String> = commands.iter().filter(|c| COMMANDS.contains(&c.as_str())).collect();
            if !cmds.is_empty() {
                p["commands"] = json!(cmds);
            }
            Some(("Input.dispatchKeyEvent", p))
        }
        InputEv::Text { text } => (!text.is_empty() && text.len() <= MAX_TEXT).then(|| ("Input.insertText", json!({ "text": text }))),
        InputEv::Nav { action } => match action.as_str() {
            "reload" => Some(("Page.reload", json!({}))),
            "back" => Some(("Runtime.evaluate", json!({ "expression": "history.back()" }))),
            "forward" => Some(("Runtime.evaluate", json!({ "expression": "history.forward()" }))),
            _ => None,
        },
    }
}

/// 모달 위로 끌어다 놓은 파일 → 그 자리에 drag(들어옴·위·놓기). 진짜 있는 파일(절대 경로)만, 20개까지.
/// 파일 칸·올리기 칸(드롭 존) 둘 다 받는다. 경로는 크롬에만 가고 어디에도 안 남긴다
pub fn drop_events(paths: &[String], x: f64, y: f64, meta: Meta) -> Vec<(&'static str, Value)> {
    let files: Vec<&String> = paths.iter().filter(|p| std::path::Path::new(p).is_absolute() && std::path::Path::new(p).is_file()).take(20).collect();
    if files.is_empty() || meta.w <= 0.0 || meta.h <= 0.0 || !x.is_finite() || !y.is_finite() {
        return vec![];
    }
    let (px, py) = ((x.clamp(0.0, 1.0) * meta.w).round(), (y.clamp(0.0, 1.0) * meta.h).round());
    let data = json!({ "items": [], "files": files, "dragOperationsMask": 1 });
    ["dragEnter", "dragOver", "drop"].iter().map(|t| ("Input.dispatchDragEvent", json!({ "type": t, "x": px, "y": py, "data": data, "modifiers": 0 }))).collect()
}

/// 파일 고르기 창이 사람이 모달에서 막 누른 것인가(2초 안) — 세션이 누른 건 플레이라이트(browser_file_upload)가 맡는다
pub fn chooser_by_human(human_at: Option<std::time::Instant>, now: std::time::Instant) -> bool {
    human_at.is_some_and(|t| now.saturating_duration_since(t) < std::time::Duration::from_secs(2))
}

#[cfg(test)]
mod tests {
    use super::*;
    const M: Meta = Meta { w: 1392.0, h: 769.0 };

    fn ev(s: &str) -> InputEv {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn 클릭은_비율을_페이지_좌표로() {
        let (m, p) = to_cdp(&ev(r#"{"kind":"mouse","type":"mousePressed","x":0.5,"y":0.25,"button":"left","clickCount":1}"#), M).unwrap();
        assert_eq!(m, "Input.dispatchMouseEvent");
        assert_eq!((p["x"].as_f64(), p["y"].as_f64(), p["button"].as_str()), (Some(696.0), Some(192.0), Some("left")));
        // 그림 밖으로 끌면 가장자리로
        let (_, p) = to_cdp(&ev(r#"{"kind":"mouse","type":"mouseMoved","x":1.4,"y":-1}"#), M).unwrap();
        assert_eq!((p["x"].as_f64(), p["y"].as_f64(), p["button"].as_str()), (Some(1392.0), Some(0.0), Some("none")));
    }

    #[test]
    fn 휠은_델타를_같이() {
        let (_, p) = to_cdp(&ev(r#"{"kind":"mouse","type":"mouseWheel","x":0.1,"y":0.1,"deltaY":240}"#), M).unwrap();
        assert_eq!((p["deltaY"].as_f64(), p["deltaX"].as_f64()), (Some(240.0), Some(0.0)));
    }

    #[test]
    fn 모양이_이상하면_버린다() {
        assert!(to_cdp(&ev(r#"{"kind":"mouse","type":"mouseTeleport","x":0.1,"y":0.1}"#), M).is_none());
        assert!(to_cdp(&ev(r#"{"kind":"mouse","type":"mouseMoved","x":0.1,"y":0.1}"#), Meta::default()).is_none(), "화면 크기를 아직 모르면");
        assert!(to_cdp(&ev(r#"{"kind":"key","type":"keyDown","key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#), M).is_none());
        assert!(to_cdp(&InputEv::Text { text: String::new() }, M).is_none());
        assert!(to_cdp(&InputEv::Text { text: "가".repeat(5000) }, M).is_none(), "너무 긴 붙여넣기");
    }

    #[test]
    fn 키는_가상_키코드와_편집_명령만() {
        let (m, p) = to_cdp(&ev(r#"{"kind":"key","type":"keyDown","key":"a","code":"KeyA","keyCode":65,"modifiers":4,"commands":["selectAll","rm -rf"]}"#), M).unwrap();
        assert_eq!(m, "Input.dispatchKeyEvent");
        assert_eq!(p["windowsVirtualKeyCode"].as_u64(), Some(65));
        assert_eq!(p["commands"], json!(["selectAll"]));
        let (_, p) = to_cdp(&ev(r#"{"kind":"key","type":"keyDown","key":"Enter","code":"Enter","keyCode":13,"text":"\r"}"#), M).unwrap();
        assert_eq!(p["text"].as_str(), Some("\r"));
    }

    #[test]
    fn 새로고침_뒤로_앞으로() {
        assert_eq!(to_cdp(&ev(r#"{"kind":"nav","action":"reload"}"#), M).unwrap().0, "Page.reload");
        let (m, p) = to_cdp(&ev(r#"{"kind":"nav","action":"back"}"#), M).unwrap();
        assert_eq!((m, p["expression"].as_str()), ("Runtime.evaluate", Some("history.back()")));
        assert_eq!(to_cdp(&ev(r#"{"kind":"nav","action":"forward"}"#), M).unwrap().1["expression"], "history.forward()");
        assert!(to_cdp(&ev(r#"{"kind":"nav","action":"eval"}"#), M).is_none(), "목록 밖은 버린다");
    }

    #[test]
    fn 끌어다_놓기는_파일만_골라_drag_세_번() {
        let dir = std::env::temp_dir().join(format!("agent-drop-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.txt");
        std::fs::write(&f, "x").unwrap();
        let paths = vec![f.to_string_lossy().to_string(), dir.to_string_lossy().to_string(), "relative.txt".into(), "/no/such/file".into()];
        let evs = drop_events(&paths, 0.5, 0.5, M);
        assert_eq!(evs.iter().map(|e| e.1["type"].as_str().unwrap()).collect::<Vec<_>>(), ["dragEnter", "dragOver", "drop"]);
        assert_eq!(evs[2].1["data"]["files"], json!([f.to_string_lossy()]), "폴더·상대 경로·없는 파일은 뺀다");
        assert_eq!((evs[2].1["x"].as_f64(), evs[2].0), (Some(696.0), "Input.dispatchDragEvent"));
        assert!(drop_events(&["/no/such".into()], 0.5, 0.5, M).is_empty(), "넣을 파일이 없으면 아무것도");
        assert!(drop_events(&[f.to_string_lossy().to_string()], 0.5, 0.5, Meta::default()).is_empty(), "화면 크기 모름");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 파일_고르기는_사람이_막_누른_것만() {
        let now = std::time::Instant::now();
        assert!(chooser_by_human(Some(now - std::time::Duration::from_millis(800)), now));
        assert!(!chooser_by_human(Some(now - std::time::Duration::from_secs(5)), now), "세션이 누른 파일 창은 플레이라이트 몫");
        assert!(!chooser_by_human(None, now));
    }

    #[test]
    fn 한글은_글로_넣는다() {
        let (m, p) = to_cdp(&InputEv::Text { text: "안녕하세요".into() }, M).unwrap();
        assert_eq!((m, p["text"].as_str()), ("Input.insertText", Some("안녕하세요")));
    }
}
