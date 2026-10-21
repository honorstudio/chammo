//! Craft 개입 입력(2026-10-16) — 사람이 Craft 창 비추기 칸에서 누르고 끄고 친 것을 그 맥 앱 조작 채널로.
//! CGEvent 를 그 앱에 직접 보내면 이동만 닿고 누르기는 egui 가 버려서(실측) 조작 채널 명령(ui.click·ui.move·ui.key·ui.type·ui.pointer)으로 넘긴다.
//! Swift 비추기 뷰가 {method, params} JSON 을 C 콜백으로 주면, 앱마다 일꾼 스레드 하나가 인증된 연결을 쥐고 차례로 보낸다.
//! 캔버스 끌기는 Swift 가 "__stroke"(창 점들 + 캔버스 자리)로 주고, 여기서 ui.inspect 의 보기(가운데·배율)로 문서 좌표 ui.pointer 로 바꾼다
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;

/// 조작 채널 연결 하나 — scripts/craft 상태 파일(<데이터>/craft-native/<앱>.json)의 포트·인증으로
pub struct Conn {
    w: TcpStream,
    r: BufReader<TcpStream>,
    id: u64,
}

impl Conn {
    pub fn open(data_dir: &Path, app: &str) -> Result<Conn, String> {
        let st: Value = serde_json::from_str(&std::fs::read_to_string(data_dir.join("craft-native").join(format!("{app}.json"))).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let auth = st["auth"].as_str().unwrap_or("");
        let secret_path = st["secret"].as_str().unwrap_or("");
        let (port, secret) = match auth {
            "file" => {
                let j: Value = serde_json::from_str(&std::fs::read_to_string(secret_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                (j["port"].as_u64().unwrap_or(0), j["token"].as_str().unwrap_or("").to_string())
            }
            "" => (st["port"].as_u64().unwrap_or(0), String::new()),
            _ => (st["port"].as_u64().unwrap_or(0), std::fs::read_to_string(secret_path).map_err(|e| e.to_string())?.trim().to_string()),
        };
        let w = TcpStream::connect(("127.0.0.1", port as u16)).map_err(|e| e.to_string())?;
        let _ = w.set_read_timeout(Some(std::time::Duration::from_secs(60)));
        let r = BufReader::new(w.try_clone().map_err(|e| e.to_string())?);
        let mut c = Conn { w, r, id: 0 };
        match auth {
            "key" => c.send(json!({"method": "auth", "key": secret}))?,
            "" => Value::Null,
            _ => c.send(json!({"method": "auth", "params": {"token": secret}}))?,
        };
        Ok(c)
    }

    /// 읽기 시간 제한 — 기본 60초(긴 명령), 칸 그림·창 옮기기는 짧게
    pub fn timeout(&mut self, d: std::time::Duration) {
        let _ = self.w.set_read_timeout(Some(d));
    }

    fn send(&mut self, mut req: Value) -> Result<Value, String> {
        self.id += 1;
        req["id"] = json!(self.id);
        writeln!(self.w, "{req}").map_err(|e| e.to_string())?;
        let mut line = String::new();
        if self.r.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
            return Err("closed".into());
        }
        let v: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        if v["ok"].as_bool() == Some(true) {
            Ok(v["result"].clone())
        } else {
            Err(v["error"].as_str().unwrap_or("error").to_string())
        }
    }

    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.send(json!({"method": method, "params": params}))
    }
}

/// 캔버스 끌기 → ui.pointer 사건들(문서 좌표). 캔버스 가운데 = 보기 가운데(center).
/// zoom 은 기기 픽셀 기준이라 1 문서 픽셀 = zoom / pixelsPerPoint 점(PhotoCraft canvas.rs to_doc). 보기 돌림·뒤집기는 아직 안 따짐(부채)
pub fn stroke_events(points: &[[f64; 2]], canvas: [f64; 4], center: [f64; 2], zoom: f64, ppp: f64) -> Value {
    let (cx, cy) = (canvas[0] + canvas[2] / 2.0, canvas[1] + canvas[3] / 2.0);
    let z = if zoom > 0.0 && ppp > 0.0 { zoom / ppp } else { 1.0 };
    let n = points.len();
    let ev: Vec<Value> = points
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let kind = if i == 0 { "down" } else if i + 1 == n { "up" } else { "move" };
            let (x, y) = (center[0] + (p[0] - cx) / z, center[1] + (p[1] - cy) / z);
            json!({"kind": kind, "x": (x * 10.0).round() / 10.0, "y": (y * 10.0).round() / 10.0})
        })
        .collect();
    json!(ev)
}

/// 비추기가 넘길 수 있는 것(Swift 가 만드는 것) — 사람 입력 흉내 + 개입 때 진짜 창을 칸 자리로 옮기기(ui.window.frame)
const ALLOWED: [&str; 6] = ["ui.click", "ui.move", "ui.key", "ui.type", "__stroke", "ui.window.frame"];

/// Swift 가 준 입력 한 줄 → 보낼 (method, params). "__stroke" 은 보기를 물어 ui.pointer 로
pub fn translate(conn: &mut Conn, line: &str) -> Result<(String, Value), String> {
    let v: Value = serde_json::from_str(line).map_err(|e| e.to_string())?;
    let method = v["method"].as_str().ok_or("no method")?.to_string();
    // 비추기 칸이 넘기는 것만 — 다른 조작 채널 명령(저장·열기·끄기 등)은 이 길로 못 보낸다
    if !ALLOWED.contains(&method.as_str()) {
        return Err(format!("not an input method: {method}"));
    }
    if method != "__stroke" {
        return Ok((method, v["params"].clone()));
    }
    let pts: Vec<[f64; 2]> = v["params"]["points"].as_array().ok_or("no points")?.iter().filter_map(|p| Some([p[0].as_f64()?, p[1].as_f64()?])).collect();
    let c: Vec<f64> = v["params"]["canvas"].as_array().ok_or("no canvas")?.iter().filter_map(Value::as_f64).collect();
    if pts.len() < 2 || c.len() != 4 {
        return Err("bad stroke".into());
    }
    let ui = conn.call("ui.inspect", json!({}))?;
    let view = &ui["views"][0];
    let center = [view["center"][0].as_f64().unwrap_or(0.0), view["center"][1].as_f64().unwrap_or(0.0)];
    let zoom = view["zoom"].as_f64().unwrap_or(1.0);
    let ppp = ui["window"]["pixelsPerPoint"].as_f64().unwrap_or(1.0);
    Ok(("ui.pointer".into(), json!({"events": stroke_events(&pts, [c[0], c[1], c[2], c[3]], center, zoom, ppp)})))
}

static WORKERS: Mutex<Option<HashMap<String, Sender<String>>>> = Mutex::new(None);

/// 앱마다 일꾼 하나 — 연결을 쥐고 차례로 보낸다(끊기면 다음 줄에서 다시 연결)
fn worker(app: &str) -> Sender<String> {
    let mut g = WORKERS.lock().unwrap();
    let map = g.get_or_insert_with(HashMap::new);
    if let Some(tx) = map.get(app) {
        return tx.clone();
    }
    let (tx, rx) = channel::<String>();
    let name = app.to_string();
    std::thread::spawn(move || {
        let mut conn: Option<Conn> = None;
        for line in rx {
            let method = serde_json::from_str::<Value>(&line).ok().and_then(|v| v["method"].as_str().map(str::to_string)).unwrap_or_default();
            let mut res = String::from("no connection");
            for _ in 0..2 {
                if conn.is_none() {
                    match Conn::open(crate::config::data_dir(), &name) {
                        Ok(c) => conn = Some(c),
                        Err(e) => res = format!("connect: {e}"),
                    }
                }
                let Some(c) = conn.as_mut() else { break };
                match translate(c, &line).and_then(|(m, p)| c.call(&m, p)) {
                    Ok(_) => {
                        res = "ok".into();
                        break;
                    }
                    Err(e) if e == "closed" || e.contains("Broken pipe") || e.contains("reset") => {
                        res = e;
                        conn = None
                    }
                    Err(e) => {
                        res = e;
                        break;
                    }
                }
            }
            log(&name, &method, &res);
        }
    });
    map.insert(app.to_string(), tx.clone());
    tx
}

/// 개입 입력 기록 — <데이터>/craft-native/input.log(명령 이름과 결과만, 친 글·자리는 안 남김, 64KB 넘으면 앞을 버린다).
/// 실사용에서 '개입이 안 먹는다'를 기록으로 가르려고(10/16)
fn log(app: &str, method: &str, res: &str) {
    if method == "ui.move" && res == "ok" {
        return; // 올라감은 초당 20번 — 잘된 건 안 남긴다
    }
    let t = chrono_like_now();
    let _ = crate::debug::append_capped(&crate::config::data_dir().join("craft-native").join("input.log"), &format!("{t} {app} {method} {res}"), 64 * 1024);
}

fn chrono_like_now() -> String {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{:02}:{:02}:{:02}Z", (s / 3600) % 24, (s / 60) % 60, s % 60)
}

/// Swift → 여기(C 콜백). ctx = 앱 이름(Box<String>, 창이 닫힐 때까지 산다)
pub extern "C" fn on_input(ctx: *mut std::ffi::c_void, json: *const std::ffi::c_char) {
    if ctx.is_null() || json.is_null() {
        return;
    }
    let app = unsafe { &*(ctx as *const String) };
    let line = unsafe { std::ffi::CStr::from_ptr(json) }.to_string_lossy().into_owned();
    let _ = worker(app).send(line);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 캔버스_끌기는_문서_좌표_down_move_up() {
        // 캔버스 (40,68) 995x702 가운데 = (537.5, 419), 보기 가운데 문서 (760,1000), 배율 100%(기기 픽셀) · 레티나 2배 = 문서 1픽셀이 0.5점
        let ev = stroke_events(&[[537.5, 419.0], [547.5, 419.0], [557.5, 429.0]], [40.0, 68.0, 995.0, 702.0], [760.0, 1000.0], 1.0, 2.0);
        let a = ev.as_array().unwrap();
        assert_eq!(a[0], json!({"kind": "down", "x": 760.0, "y": 1000.0}));
        assert_eq!(a[1], json!({"kind": "move", "x": 780.0, "y": 1000.0}));
        assert_eq!(a[2], json!({"kind": "up", "x": 800.0, "y": 1020.0}));
    }

    /// 가짜 조작 채널 — 받은 줄을 돌려주고 ui.inspect 엔 보기 하나
    fn fake(auth: &'static str) -> (u16, std::sync::Arc<Mutex<Vec<Value>>>) {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let seen = std::sync::Arc::new(Mutex::new(vec![]));
        let s2 = seen.clone();
        std::thread::spawn(move || {
            let (s, _) = l.accept().unwrap();
            let mut w = s.try_clone().unwrap();
            for line in BufReader::new(s).lines().map_while(Result::ok) {
                let v: Value = serde_json::from_str(&line).unwrap();
                s2.lock().unwrap().push(v.clone());
                let ok = match v["method"].as_str() {
                    Some("auth") => (auth == "token" && v["params"]["token"] == "t0k") || (auth == "key" && v["key"] == "t0k"),
                    _ => true,
                };
                let res = if v["method"] == "ui.inspect" { json!({"views": [{"center": [760.0, 1000.0], "zoom": 1.0}], "window": {"pixelsPerPoint": 2.0}}) } else { json!(null) };
                let _ = writeln!(w, "{}", json!({"id": v["id"], "ok": ok, "result": res, "error": if ok { Value::Null } else { json!("unauthorized") }}));
            }
        });
        (port, seen)
    }

    fn state(dir: &Path, app: &str, port: u16, auth: &str) {
        let n = dir.join("craft-native");
        std::fs::create_dir_all(&n).unwrap();
        std::fs::write(n.join("tok"), "t0k\n").unwrap();
        std::fs::write(n.join(format!("{app}.json")), json!({"port": port, "auth": if auth.is_empty() { Value::Null } else { json!(auth) }, "secret": n.join("tok")}).to_string()).unwrap();
    }

    #[test]
    fn 토큰_앱은_첫_줄이_auth_그다음_명령() {
        let d = std::env::temp_dir().join(format!("craft-in-{}", std::process::id()));
        let (port, seen) = fake("token");
        state(&d, "photocraft", port, "token");
        let mut c = Conn::open(&d, "photocraft").unwrap();
        c.call("ui.click", json!({"x": 1, "y": 2})).unwrap();
        let s = seen.lock().unwrap();
        assert_eq!((s[0]["method"].as_str(), s[0]["params"]["token"].as_str()), (Some("auth"), Some("t0k")));
        assert_eq!(s[1]["method"], "ui.click");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 끌기는_보기를_물어_ui_pointer_로() {
        let d = std::env::temp_dir().join(format!("craft-in2-{}", std::process::id()));
        let (port, _seen) = fake("token");
        state(&d, "photocraft", port, "token");
        let mut c = Conn::open(&d, "photocraft").unwrap();
        let (m, p) = translate(&mut c, r#"{"method":"__stroke","params":{"points":[[537.5,419],[557.5,429]],"canvas":[40,68,995,702]}}"#).unwrap();
        assert_eq!(m, "ui.pointer");
        assert_eq!(p["events"][1], json!({"kind": "up", "x": 800.0, "y": 1020.0}));
        let (m, _) = translate(&mut c, r#"{"method":"ui.click","params":{"x":3,"y":4}}"#).unwrap();
        assert_eq!(m, "ui.click", "그 밖은 그대로");
        assert!(translate(&mut c, r#"{"method":"app.save","params":{"path":"/x.psd"}}"#).is_err(), "입력 아닌 명령은 막는다");
        let _ = std::fs::remove_dir_all(&d);
    }
}
