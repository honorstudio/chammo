//! 거는 쪽(B) 컴퓨터 짝짓기 — 같은 계정 다른 컴퓨터(A) 허브를 기기 두드리기로 두드려 숫자 확인 5단계(device_link::Initiator)를 돌고,
//! A 사람이 허용하면 받은 열쇠를 저장하고 반대 방향 열쇠를 넘긴다(계획 2026-11-01-peer-relay C-3b·C-4).
//! 상자는 늘 받는 쪽 터널 열쇠로 봉한다(중계는 못 연다). A 열쇠(Mt)는 서버가 준 것이라 숫자로 확인한다 — A 카드는 A 앱·A 의 폰에서만 눌린다
use crate::device_link::Initiator;
use crate::phone_tunnel as tun;
use crate::team_relay_ws::Ws;
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tungstenite::Message;

/// 사람이 A 에서 누를 때까지 — A 카드도 10분
pub const WAIT: Duration = Duration::from_secs(600);

/// 이 컴퓨터(B) — 터널 공개 열쇠·서명 공개 열쇠·중계 기기 id·이름, 터널 합의(비밀 열쇠는 밖에서)
pub struct Me {
    pub pt: Vec<u8>,
    pub sign: Vec<u8>,
    pub dev: String,
    pub name: String,
    pub agree: Box<dyn Fn(&[u8]) -> Option<[u8; 32]>>,
}

/// A 가 허용하고 준 것
#[derive(Debug)]
pub struct Linked {
    pub token: String,
    pub name: String,
}

fn send_box(ws: &mut Ws, mt: &[u8], v: &Value) -> Result<(), String> {
    let b = tun::seal(mt, v.to_string().as_bytes()).map_err(|e| format!("{e:?}"))?;
    ws.send(Message::text(json!({ "t": "knock", "box": tun::b64(&b) }).to_string())).map_err(|e| e.to_string())
}

/// 두드리기 한 바퀴 — url = 서명한 `…/v0/hubs/<A>/knock?device=<나>…`, mt = A 터널 공개 열쇠. on_sas = 숫자를 화면에.
/// 오류 글: declined(A 가 거절) · old(A 가 옛 판, 서버 unsupported) · offline · timeout · 그 밖은 모양·끊김
pub fn run_knock(url: &str, me: &Me, mt: &[u8], mut on_sas: impl FnMut(&str), wait: Duration) -> Result<Linked, String> {
    let until = Instant::now() + wait;
    let mut ws = crate::team_relay_ws::connect_url(url)?;
    let mut run = Initiator::new(me.pt.clone(), mt.to_vec(), me.sign.clone(), me.dev.clone());
    send_box(&mut ws, mt, &run.link1(&me.name))?;
    loop {
        if Instant::now() >= until {
            return Err("timeout".into());
        }
        let m = match ws.read() {
            Ok(Message::Text(t)) => serde_json::from_str::<Value>(t.as_str()).unwrap_or(Value::Null),
            Ok(Message::Close(_)) => return Err("closed".into()),
            Ok(_) => continue,
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
            Err(e) => return Err(e.to_string()),
        };
        match m["t"].as_str() {
            Some("unsupported") => return Err("old".into()),
            Some("offline") => return Err(crate::peer_conn::OFFLINE.into()),
            Some("refused") => return Err("refused".into()),
            Some("error") => return Err(m["code"].as_str().unwrap_or("error").to_string()),
            Some("reply") => {}
            _ => continue,
        }
        let sealed = tun::unb64(m["box"].as_str().unwrap_or_default()).map_err(|_| "bad box")?;
        let pt = tun::open(&me.pt, |e| (me.agree)(e), &sealed).map_err(|_| "bad box")?;
        let x: Value = serde_json::from_slice(&pt).map_err(|_| "bad box")?;
        match x["step"].as_str() {
            Some("link2") => {
                let cm = tun::unb64(x["cM"].as_str().unwrap_or_default()).map_err(|_| "bad cM")?;
                let l3 = run.link2(&cm)?;
                send_box(&mut ws, mt, &l3)?;
            }
            Some("link4") => {
                let nm = tun::unb64(x["nM"].as_str().unwrap_or_default()).map_err(|_| "bad nM")?;
                on_sas(&crate::device_link::sas_text(run.link4(&nm)?));
            }
            Some("link5") => {
                // 숫자를 낸 뒤에만 — 숫자 없이 온 열쇠는 가짜 컴퓨터일 수 있다
                if !run.can_finish() {
                    return Err("key".into());
                }
                if x["ok"] != true {
                    return Err(x["error"].as_str().unwrap_or("declined").to_string());
                }
                let token = x["token"].as_str().filter(|t| t.len() == 64 && t.bytes().all(|b| b.is_ascii_hexdigit())).ok_or("bad token")?;
                let name: String = x["mac"]["name"].as_str().unwrap_or_default().chars().filter(|c| !c.is_control()).take(40).collect();
                return Ok(Linked { token: token.to_string(), name });
            }
            _ => return Err("key".into()),
        }
    }
}

// ── 앱에 붙이는 길 — 사람이 '연결'을 눌렀을 때(메인 창 사람 클릭만) ─────────────

/// 연결 중인 컴퓨터마다 — 숫자(띄웠으면)·끝난 이유(실패면). 화면이 1초마다 읽는다
#[derive(serde::Serialize, Clone, Default)]
pub struct Pending {
    pub sas: Option<String>,
    pub error: Option<String>,
}
static PENDING: std::sync::Mutex<Option<std::collections::HashMap<String, Pending>>> = std::sync::Mutex::new(None);

fn set(hub: &str, f: impl FnOnce(&mut Pending)) {
    let mut g = PENDING.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(Default::default).entry(hub.to_string()).or_default());
}

/// 같은 계정 컴퓨터(hub)와 잇기 — 숫자 확인 → A 허용 → 받은 열쇠 저장 → 반대 방향 열쇠 넘기기. 반대 방향이 실패해도 이 쪽 길은 남는다
pub fn connect_now(hub: &str) -> Result<(), String> {
    let dir = crate::config::data_dir();
    let st = crate::team_relay::load_state(dir);
    let k = crate::team_relay::device_keys(&crate::team_relay_keys::store(), &st)?;
    let (code, me_v) = crate::team_relay::call(&crate::team_relay::Curl, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/self", None)?;
    if code != 200 {
        return Err(crate::team_relay::why(code, &me_v));
    }
    let c = me_v["computers"].as_array().and_then(|a| a.iter().find(|c| c["id"] == hub).cloned()).ok_or("같은 계정의 허용된 컴퓨터가 아니에요")?;
    let x = c["tunnelPub"].as_str().filter(|x| !x.is_empty()).ok_or("그 컴퓨터가 아직 중계에 열쇠를 안 알렸어요 — 그 컴퓨터 Chammo 를 켜 주세요")?.to_string();
    let mt = tun::pubkey(&x).map_err(|_| "그 컴퓨터 열쇠 모양이 틀려요")?;
    let me = Me {
        pt: tun::pubkey(&k.tunnel_public()).map_err(|_| "내 열쇠 모양")?,
        sign: tun::unb64(&k.public()).map_err(|_| "내 서명 열쇠 모양")?,
        dev: st.device_id.clone(),
        name: st.device_name.clone(),
        // DeviceKeys 는 Clone 이 없다(비밀 사본이 퍼지지 않게) — 합의용으로 한 번 더 읽는다
        agree: Box::new({ let k2 = crate::team_relay::device_keys(&crate::team_relay_keys::store(), &st)?; move |e| k2.tunnel_agree(e) }),
    };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let url = crate::team_relay::hub_url_for(&st, &k, hub, "knock", now, &crate::team_relay_keys::new_nonce()?)?;
    let linked = run_knock(&url, &me, &mt, |s| set(hub, |p| p.sas = Some(s.to_string())), WAIT)?;
    let name = if linked.name.is_empty() { c["name"].as_str().unwrap_or_default().to_string() } else { linked.name };
    crate::remote::store_relay_key(hub, &linked.token)?;
    crate::remote::save_relay_peer(dir, hub, &name, &x).map_err(|e| e.to_string())?;
    // 반대 방향 — 그 컴퓨터가 이 컴퓨터를 부를 줄을 먼저 쓰고(stage), 넘기는 데 성공하면 확정
    let back = crate::mobile_pair::random_hex(32).map_err(|e| e.to_string())?;
    let devs = crate::mobile::devices();
    let line = devs.stage_peer_relay(&back, &name, crate::mobile_pair::Relay { device: hub.to_string(), x }, std::time::SystemTime::now()).map_err(|e| e.to_string())?;
    match crate::remote::key_back_now(&crate::remote::relay_key_account(hub), &back) {
        Ok(()) => devs.commit_peer_relay(hub, &line).map_err(|e| e.to_string()),
        Err(e) => {
            let _ = devs.remove(&line);
            crate::claude::log_out("peer", &format!("반대 방향 열쇠 못 넘김 — {e}"));
            Ok(())
        }
    }
}

/// 메인 창 사람 클릭만 — 바로 돌아오고, 숫자·결과는 peer_relay_state 로
#[tauri::command]
pub fn peer_relay_connect(window: tauri::WebviewWindow, hub: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("main window only".into());
    }
    set(&hub, |p| *p = Pending::default());
    std::thread::spawn(move || {
        let r = connect_now(&hub);
        let mut g = PENDING.lock().unwrap_or_else(|e| e.into_inner());
        let m = g.get_or_insert_with(Default::default);
        match r {
            Ok(()) => {
                m.remove(&hub);
            }
            Err(e) => m.entry(hub).or_default().error = Some(e),
        }
    });
    Ok(())
}

#[tauri::command]
pub fn peer_relay_state() -> std::collections::HashMap<String, Pending> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default()
}

/// 실패 줄 닫기·연결 중 지우기(소켓은 시간이 지나면 저절로 끝난다)
#[tauri::command]
pub fn peer_relay_clear(hub: String) {
    if let Some(m) = PENDING.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        m.remove(&hub);
    }
}

#[cfg(test)]
#[path = "peer_pair_tests.rs"]
mod tests;
