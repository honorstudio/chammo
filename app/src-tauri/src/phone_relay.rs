//! 폰 중계 — 이 컴퓨터가 중계 허브에 주인으로 붙어 있는 소켓 하나(ADR 0013·서버 ADR 0005). 테일스케일 없는 폰이 이 길로 온다.
//! - 켜지는 때: 폰 연결을 켜 뒀고(mobile.json) 이 기기가 중계에 등록돼 있고(team.json) 폰 입구 주소(phoneWeb)가 있을 때
//! - 받은 틀은 phone_relay_core(세션·같은 문)로, 처리는 일꾼 스레드(최대 8)에서 하고 봉하기·보내기는 이 스레드만(번호 차례)
//! - 끊기면 2·4·8…초(최대 5분) 뒤 다시. 서버가 이 기기를 끊으면(4001) 다시 안 붙는다
use crate::mobile_http::{Backend, Gate};
use crate::phone_relay_core::{self as core, Ev, Lines, Tunnels};
use crate::phone_tunnel as tun;
use crate::team_relay::{self, TeamState};
use crate::team_relay_keys::{new_nonce, DeviceKeys};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tungstenite::Message;

const PING_EVERY: Duration = Duration::from_secs(45);
const DEAD_AFTER: Duration = Duration::from_secs(120);
const CHECK_EVERY: Duration = Duration::from_secs(10);
const MAX_WORKERS: usize = 8;

/// 지금 상태 — 설정 화면이 읽는다
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatus {
    pub on: bool,
    pub connected: bool,
    pub phones: usize,
    pub error: Option<String>,
}

static STATUS: Mutex<Option<RelayStatus>> = Mutex::new(None);
static STARTED: AtomicBool = AtomicBool::new(false);

pub fn status() -> RelayStatus {
    STATUS.lock().unwrap().clone().unwrap_or_default()
}

fn set_status(f: impl FnOnce(&mut RelayStatus)) {
    let mut g = STATUS.lock().unwrap();
    f(g.get_or_insert_with(Default::default));
}

fn log(line: &str) {
    crate::claude::log_out("phone-relay", line);
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

struct RealLines {
    devices: Arc<crate::mobile_pair::Devices>,
    keys: DeviceKeys,
}

impl Lines for RealLines {
    fn line_of(&self, relay: &str) -> Option<(String, Vec<u8>)> {
        let (id, x) = self.devices.relay_line(relay)?;
        Some((id, tun::pubkey(&x).ok()?))
    }
    fn agree(&self, their: &[u8]) -> Option<[u8; 32]> {
        self.keys.tunnel_agree(their)
    }
}

/// 켤 조건이 맞으면 (상태, 입구 주소)
fn wanted(dir: &Path) -> Option<(TeamState, String)> {
    if !crate::mobile::saved_on(dir) {
        return None;
    }
    let st = team_relay::load_state(dir);
    if !st.registered() || st.revoked {
        return None;
    }
    let web = team_relay::phone_web(&st)?;
    team_relay::server_ok(&st.server)?;
    Some((st, web))
}

/// QR 주소 — 입구 주소 # 코드·이 기기 중계 id·터널 열쇠·중계 주소. `#` 뒤라 호스팅 로그·Referer 에 안 남는다
pub fn qr_url(web: &str, code: &str, st: &TeamState, mac_x: &str) -> String {
    let enc = |s: &str| s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>();
    format!("{web}/pair#p={code}&m={}&k={mac_x}&r={}", enc(&st.device_id), enc(&st.server))
}

/// 설정 화면 — 켤 수 있으면 (입구 주소, 상태, 이 기기 터널 공개 열쇠)
pub fn ready(dir: &Path) -> Option<(String, TeamState, String)> {
    let (st, web) = wanted(dir)?;
    let keys = team_relay::device_keys(&crate::team_relay_keys::store(), &st).ok()?;
    Some((web, st, keys.tunnel_public()))
}

/// 앱이 뜰 때 한 번 — 조건을 10초마다 보며 붙었다 떨어졌다 한다
pub fn boot<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let dir = crate::config::data_dir().to_path_buf();
        let mut fails = 0u32;
        loop {
            drain(&dir);
            let Some((st, web)) = wanted(&dir) else {
                set_status(|s| *s = RelayStatus::default());
                std::thread::sleep(CHECK_EVERY);
                continue;
            };
            let keys = match team_relay::device_keys(&crate::team_relay_keys::store(), &st) {
                Ok(k) => k,
                Err(e) => {
                    set_status(|s| { s.on = true; s.connected = false; s.error = Some(e); });
                    std::thread::sleep(CHECK_EVERY * 6);
                    continue;
                }
            };
            let (gate, be) = crate::mobile::relay_parts(&app, &web);
            set_status(|s| { s.on = true; s.error = None; });
            match run(&dir, &st, &web, keys, gate, be) {
                Ok(()) => fails = 0,
                Err(e) if e == "revoked" => {
                    log("서버가 이 기기를 끊었어 — 폰 중계 멈춤");
                    let _ = team_relay::mutate_if(&dir, &st.device_id, |s| s.revoked = true);
                }
                Err(e) => {
                    set_status(|s| { s.connected = false; s.error = Some(e.clone()); });
                    fails += 1;
                    std::thread::sleep(crate::team_relay_ws::backoff(fails));
                }
            }
        }
    });
}

enum Out {
    /// 그 연결로 보낼 평문 조각들(봉하는 건 소켓 스레드)
    Reply(String, Vec<Vec<u8>>),
    /// 두드리기 답(이미 봉한 상자)
    Knock(String, String),
    /// 못 연 상자 — 두드린 쪽을 바로 닫게(보안 검토 F)
    KnockClose(String),
}

/// 붙어서 돌기 — 조건이 바뀌면 Ok 로 나온다
fn run(dir: &Path, st: &TeamState, web: &str, keys: DeviceKeys, gate: Arc<Gate>, be: Arc<dyn Backend>) -> Result<(), String> {
    let mut ws = crate::team_relay_ws::connect_url(&team_relay::hub_url(st, &keys, now_ms(), &new_nonce()?)?)?;
    log("허브에 붙음");
    set_status(|s| { s.connected = true; s.error = None; });
    let me_pub = tun::pubkey(&keys.tunnel_public()).map_err(|_| "열쇠 모양")?;
    let mac = json!({ "id": st.device_id, "name": st.device_name });
    let lines = Arc::new(RealLines { devices: gate.devices.clone(), keys });
    let mut t = Tunnels::default();
    let (tx, rx): (Sender<Out>, Receiver<Out>) = channel();
    let busy = Arc::new(AtomicUsize::new(0));
    let (mut last_rx, mut last_ping, mut last_check) = (Instant::now(), Instant::now(), Instant::now());
    let send = |ws: &mut crate::team_relay_ws::Ws, v: Value| ws.send(Message::text(v.to_string())).map_err(|e| e.to_string());
    loop {
        // 일꾼이 끝낸 것 — 봉해서 보낸다(번호는 이 스레드에서만 오른다)
        while let Ok(o) = rx.try_recv() {
            match o {
                Out::Reply(c, chunks) => {
                    for pt in chunks {
                        let Some(f) = t.seal(&c, &pt) else { break };
                        send(&mut ws, json!({ "t": "f", "to": c, "d": tun::b64(&f) }))?;
                    }
                }
                Out::Knock(k, boxed) => send(&mut ws, json!({ "t": "knock-reply", "k": k, "box": boxed }))?,
                Out::KnockClose(k) => send(&mut ws, json!({ "t": "knock-close", "k": k }))?,
            }
        }
        match ws.read() {
            Ok(Message::Text(txt)) => {
                last_rx = Instant::now();
                let Ok(m) = serde_json::from_str::<Value>(txt.as_str()) else { continue };
                let s = |k: &str| m[k].as_str().unwrap_or("").to_string();
                match m["t"].as_str() {
                    Some("f") => {
                        let (from, c) = (s("from"), s("c"));
                        let Ok(frame) = tun::unb64(&s("d")) else { continue };
                        for ev in t.on_frame(&*lines, &from, &c, &frame) {
                            match ev {
                                Ev::Send(f) => send(&mut ws, json!({ "t": "f", "to": c, "d": tun::b64(&f) }))?,
                                Ev::Drop(why) => log(&format!("연결 버림 {} — {why}", &c)),
                                Ev::Run(req) => {
                                    let line = t.line(&c).unwrap_or_default().to_string();
                                    work(req, line, c.clone(), &gate, &be, &busy, &tx);
                                }
                            }
                        }
                        set_status(|x| x.phones = t.len());
                    }
                    Some("bye") => {
                        t.bye(&s("c"));
                        set_status(|x| x.phones = t.len());
                    }
                    Some("knock") => knock(s("k"), s("box"), s("key"), me_pub.clone(), lines.clone(), gate.clone(), st.clone(), mac.clone(), tx.clone()),
                    _ => {}
                }
            }
            Ok(Message::Ping(_) | Message::Pong(_)) => last_rx = Instant::now(),
            Ok(Message::Close(f)) => {
                let code: u16 = f.map(|f| f.code.into()).unwrap_or(0);
                return Err(if code == 4001 { "revoked".into() } else { format!("허브가 닫음 {code}") });
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(e) => return Err(e.to_string()),
        }
        if last_ping.elapsed() > PING_EVERY {
            last_ping = Instant::now();
            ws.send(Message::Ping(Vec::new().into())).map_err(|e| e.to_string())?;
        }
        if last_rx.elapsed() > DEAD_AFTER {
            return Err("허브가 2분 넘게 조용함".into());
        }
        if last_check.elapsed() > CHECK_EVERY {
            last_check = Instant::now();
            drain(dir);
            // 폰 연결을 껐거나 로그아웃·주소가 바뀌면 나간다(바깥 고리가 다시 본다)
            if wanted(dir).is_none_or(|(s, w)| s.device_id != st.device_id || s.server != st.server || w != web) {
                let _ = ws.close(None);
                return Ok(());
            }
        }
    }
}

/// 요청 하나를 일꾼에게 — 다 차 있으면 바로 503
fn work(req: core::TReq, line: String, c: String, gate: &Arc<Gate>, be: &Arc<dyn Backend>, busy: &Arc<AtomicUsize>, tx: &Sender<Out>) {
    let head = req.method == "HEAD";
    if busy.fetch_add(1, Ordering::SeqCst) >= MAX_WORKERS {
        busy.fetch_sub(1, Ordering::SeqCst);
        let r = crate::mobile_http::Resp { status: 503, headers: vec![("Content-Type", "text/plain; charset=utf-8".into())], body: b"busy".to_vec() };
        let _ = tx.send(Out::Reply(c, core::resp_chunks(req.id, &r, head)));
        return;
    }
    let (gate, be, busy, tx) = (gate.clone(), be.clone(), busy.clone(), tx.clone());
    std::thread::spawn(move || {
        let r = core::serve(&req, &line, &gate, &*be);
        busy.fetch_sub(1, Ordering::SeqCst);
        let _ = tx.send(Out::Reply(c, core::resp_chunks(req.id, &r, head)));
    });
}

/// 두드리기 — 상자를 열어 짝짓기(중계에 기기 들이기 포함)하고 답을 폰 열쇠로 봉한다. 못 연 상자엔 답하지 않는다(봉할 열쇠가 없다)
#[allow(clippy::too_many_arguments)]
fn knock(k: String, boxed: String, hub_key: String, me_pub: Vec<u8>, lines: Arc<RealLines>, gate: Arc<Gate>, st: TeamState, mac: Value, tx: Sender<Out>) {
    std::thread::spawn(move || {
        let knock = match core::open_knock(&me_pub, |e| lines.agree(e), &boxed) {
            Ok(x) => x,
            Err(e) => {
                let _ = tx.send(Out::KnockClose(k));
                return log(&format!("두드리기 상자 못 엶 — {e}"));
            }
        };
        let add = |sign: &str, name: &str| -> Result<String, String> {
            let (code, v) = team_relay::call(&team_relay::Curl, &st.server, &lines.keys, Some(&st.device_id), "POST", "/v0/me/devices/add", Some(&json!({ "publicKey": sign, "name": name })))?;
            match (code, v["deviceId"].as_str()) {
                (200 | 201, Some(id)) => Ok(id.to_string()),
                _ => Err(team_relay::why(code, &v)),
            }
        };
        let v = core::answer_knock(&knock, &hub_key, &gate.devices, add, &mac);
        log(&format!("두드리기 {}", if v["ok"] == true { "짝지음".to_string() } else { format!("거절 {}", v["error"]) }));
        if let Ok(b) = tun::seal(&knock.x, v.to_string().as_bytes()) {
            let _ = tx.send(Out::Knock(k, tun::b64(&b)));
        }
    });
}

/// 끊긴 폰 줄의 중계 기기를 중계에서도 끊는다(보안 검토 C) — 실패하면 대기열에 남아 다음에 다시. 폰 연결을 꺼 둬도 돈다
fn drain(dir: &Path) {
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    {
        let mut last = LAST.lock().unwrap();
        if last.is_some_and(|t| t.elapsed() < Duration::from_secs(30)) {
            return;
        }
        *last = Some(Instant::now());
    }
    let devices = crate::mobile::devices();
    if devices.pending_revokes().is_empty() {
        return;
    }
    let st = team_relay::load_state(dir);
    if !st.registered() || st.revoked {
        return;
    }
    let Ok(keys) = team_relay::device_keys(&crate::team_relay_keys::store(), &st) else { return };
    let (done, left) = core::drain_revokes(&devices, |id| {
        if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
            return Ok(404); // 모양이 틀린 줄은 버린다
        }
        team_relay::call(&team_relay::Curl, &st.server, &keys, Some(&st.device_id), "POST", &format!("/v0/me/devices/{id}/revoke"), Some(&json!({}))).map(|(c, _)| c)
    });
    if done + left > 0 {
        log(&format!("끊긴 폰 중계 기기 끊기 {done}개{}", if left > 0 { format!(", {left}개는 다음에 다시") } else { String::new() }));
    }
}

/// 컴퓨터 일(참모 답·카드)이 생겼을 때 — 중계로 짝지은 폰마다 본문 없는 푸시를 부탁한다(서버가 10초에 한 번으로 묶는다)
pub fn notify_phones(dir: &PathBuf, relays: Vec<String>) {
    if relays.is_empty() {
        return;
    }
    let dir = dir.clone();
    std::thread::spawn(move || {
        let Some((st, _)) = wanted(&dir) else { return };
        let Ok(keys) = team_relay::device_keys(&crate::team_relay_keys::store(), &st) else { return };
        for to in relays {
            if let Err(e) = team_relay::call(&team_relay::Curl, &st.server, &keys, Some(&st.device_id), "POST", "/v0/push/notify", Some(&json!({ "to": to }))) {
                log(&format!("푸시 부탁 실패 — {e}"));
            }
        }
    });
}

#[cfg(test)]
#[path = "phone_relay_tests.rs"]
mod tests;
