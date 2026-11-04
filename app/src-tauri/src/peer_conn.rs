//! 손님 소켓(테일스케일 없이 컴퓨터끼리, docs/plans/2026-11-01-peer-relay.md C-4) — 같은 계정 다른 컴퓨터의 허브에 손님으로 붙어
//! peer_tunnel::Guest 로 요청을 하나씩 주고받는다. 허브 틀: 손님 → {t:"f", d}, 허브 → {t:"owner", on} · {t:"f", d}(서버가 붙이는 칸은 주인 쪽만).
//! 한 연결에 hello 한 번(리뷰 ②) — 끊기거나 틀이 틀리면 이 연결은 버리고 다음 요청이 새로 연다(풀은 C-4 다음 조각)
use crate::peer_tunnel::{Done, Guest};
use crate::phone_tunnel as tun;
use crate::team_relay_ws::Ws;
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tungstenite::Message;

/// 그 컴퓨터 Chammo 가 허브에 안 붙어 있다(꺼짐·잠듦·로그아웃)
pub const OFFLINE: &str = "offline";

pub struct PeerConn {
    ws: Ws,
    g: Guest,
    /// 열 때 걸린 ms — 소켓·허브 붙기 / 터널 확인 왕복(C-6 ③)
    pub connect_ms: u32,
    pub hello_ms: u32,
    /// 마지막으로 쓴 때 — 풀이 오래 논 연결을 닫는다
    pub last: Instant,
}

/// 허브 말 하나 — 마감까지(읽기는 READ_SLICE 로 끊겨 와서 그 사이 시간을 다시 잰다)
fn next(ws: &mut Ws, until: Instant) -> Result<Value, String> {
    loop {
        if Instant::now() >= until {
            return Err("timeout".into());
        }
        match ws.read() {
            Ok(Message::Text(t)) => {
                if let Ok(v) = serde_json::from_str::<Value>(t.as_str()) {
                    return Ok(v);
                }
            }
            Ok(Message::Close(_)) => return Err("closed".into()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn send(ws: &mut Ws, f: &[u8]) -> Result<(), String> {
    ws.send(Message::text(json!({ "t": "f", "d": tun::b64(f) }).to_string())).map_err(|e| e.to_string())
}

/// 틀 하나 꺼내기 — owner off 면 OFFLINE
fn frame_of(v: &Value) -> Result<Option<Vec<u8>>, String> {
    match v["t"].as_str() {
        Some("owner") if v["on"] == false => Err(OFFLINE.into()),
        Some("f") => v["d"].as_str().and_then(|d| tun::unb64(d).ok()).map(Some).ok_or_else(|| "bad frame".into()),
        _ => Ok(None),
    }
}

impl PeerConn {
    /// url = 서명한 `wss://…/v0/hubs/<그 컴퓨터>/ws?device=<나>…`, shared = 내 터널 열쇠 ↔ 그 컴퓨터 터널 열쇠(숫자로 확인한 것), pk = 내 터널 공개 열쇠
    pub fn open(url: &str, shared: [u8; 32], pk: Vec<u8>, wait: Duration) -> Result<Self, String> {
        let until = Instant::now() + wait;
        let t0 = Instant::now();
        let mut ws = crate::team_relay_ws::connect_url(url)?;
        let connect_ms = t0.elapsed().as_millis().min(u32::MAX as u128) as u32;
        let t1 = Instant::now();
        let mut g = Guest::new(shared, pk);
        // 붙자마자 허브가 owner 를 알린다 — 붙어 있으면 hello
        loop {
            let v = next(&mut ws, until)?;
            if v["t"] == "owner" {
                if v["on"] != true {
                    return Err(OFFLINE.into());
                }
                send(&mut ws, &g.hello())?;
                break;
            }
        }
        while !g.ready() {
            if let Some(f) = frame_of(&next(&mut ws, until)?)? {
                g.on_frame(&f).map_err(|e| format!("그 컴퓨터 확인 실패({e:?})"))?;
            }
        }
        let hello_ms = t1.elapsed().as_millis().min(u32::MAX as u128) as u32;
        Ok(PeerConn { ws, g, connect_ms, hello_ms, last: Instant::now() })
    }

    /// 요청 하나 — 답이 다 모일 때까지. 실패하면 이 연결은 버린다(부른 쪽이 새로 연다)
    pub fn call(&mut self, method: &str, path: &str, headers: &[(String, String)], body: &[u8], wait: Duration) -> Result<Done, String> {
        let until = Instant::now() + wait;
        let (id, frames) = self.g.request(method, path, headers, body, true).map_err(|e| format!("{e:?}"))?;
        for f in &frames {
            send(&mut self.ws, f)?;
        }
        loop {
            let v = match next(&mut self.ws, until) {
                Ok(v) => v,
                Err(e) => {
                    self.g.forget(id);
                    return Err(e);
                }
            };
            let Some(f) = frame_of(&v)? else { continue };
            for d in self.g.on_frame(&f).map_err(|e| format!("{e:?}"))? {
                if d.id == id {
                    self.last = Instant::now();
                    return Ok(d);
                }
            }
        }
    }
}

/// 요청 시간 기억 수 — 최근 것만(C-5 실측 ④: 정밀 지연은 앱 안에서만 잰다)
pub const LAT_KEEP: usize = 200;

/// 요청마다 걸린 ms(최근 LAT_KEEP 개)
#[derive(Default)]
pub struct Lat(std::collections::VecDeque<u32>);

impl Lat {
    pub fn push(&mut self, ms: u32) {
        if self.0.len() == LAT_KEEP {
            self.0.pop_front();
        }
        self.0.push_back(ms);
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    /// p 백분위(가장 가까운 순위) — 없으면 None
    pub fn pct(&self, p: u32) -> Option<u32> {
        if self.0.is_empty() {
            return None;
        }
        let mut v: Vec<u32> = self.0.iter().copied().collect();
        v.sort_unstable();
        let i = ((p as usize * v.len()).div_ceil(100)).max(1) - 1;
        v.get(i.min(v.len() - 1)).copied()
    }
}

/// 단계별 시간(C-6 ③ — p95 원인 나누기): call(요청 왕복) · call-idle(10초 넘게 쉬었다 온 요청 — 허브 DO 깨우기 의심) · connect(소켓·TLS·허브 붙기) ·
/// hello(터널 확인 왕복) · serve-peer(주인 쪽 폰 서버 처리) · retry(실패 뒤 새 연결로 다시)
static STAGES: std::sync::Mutex<Option<(std::collections::BTreeMap<&'static str, Lat>, std::collections::BTreeMap<&'static str, usize>)>> = std::sync::Mutex::new(None);

/// 단계 한 줄 — "call p50 …·p95 …ms(n) · … · retry n번"
pub fn stage_line(m: &std::collections::BTreeMap<&'static str, Lat>) -> String {
    m.iter()
        .map(|(k, l)| if *k == "retry" { format!("retry {}번", l.len()) } else { format!("{k} p50 {}·p95 {}ms({})", l.pct(50).unwrap_or(0), l.pct(95).unwrap_or(0), l.len()) })
        .collect::<Vec<_>>()
        .join(" · ")
}

/// 단계 시간 하나 — call·serve-peer 가 50개 찰 때마다 notify.log 'peer' 칸에 전체 한 줄
pub fn note(stage: &'static str, ms: u32) {
    let line = {
        let mut g = STAGES.lock().unwrap_or_else(|e| e.into_inner());
        let (m, n) = g.get_or_insert_with(Default::default);
        m.entry(stage).or_default().push(ms);
        let c = n.entry(stage).or_default();
        *c += 1;
        (matches!(stage, "call" | "serve-peer") && *c % 50 == 0).then(|| format!("중계 단계 시간(최근) — {}", stage_line(m)))
    };
    if let Some(l) = line {
        crate::claude::log_out("peer", &l);
    }
}

/// 오래 논 연결은 닫는다 — 허브 DO 에 손님 소켓을 붙잡아 두지 않게
const IDLE: Duration = Duration::from_secs(120);
/// 그 컴퓨터마다 열린 연결 하나(부르는 동안은 꺼내 쓴다 — 다른 컴퓨터 부르기를 막지 않게)
static POOL: std::sync::Mutex<Option<std::collections::HashMap<String, PeerConn>>> = std::sync::Mutex::new(None);

fn take(hub: &str) -> Option<PeerConn> {
    let mut g = POOL.lock().unwrap_or_else(|e| e.into_inner());
    let m = g.get_or_insert_with(Default::default);
    m.retain(|_, c| c.last.elapsed() < IDLE);
    m.remove(hub)
}

fn put(hub: &str, c: PeerConn) {
    POOL.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).insert(hub.to_string(), c);
}

/// 중계로 짝지은 다른 컴퓨터(hub = 그 중계 기기 id, hub_x = 그 터널 공개 열쇠 b64)의 폰 서버 /api 를 부른다 — remote.rs 가 테일넷 대신 쓰는 길.
/// 열린 연결이 실패하면 한 번 새로 연다
pub fn call_relay(hub: &str, hub_x: &str, token: &str, method: &str, path: &str, body: Option<&[u8]>, wait: Duration) -> Result<crate::remote_net::Response, String> {
    let mut headers = vec![("authorization".to_string(), format!("Bearer {token}"))];
    if body.is_some() {
        headers.push(("content-type".into(), "application/json".into()));
    }
    let body = body.unwrap_or_default();
    let mut tries = 0;
    let d = loop {
        let mut c = match take(hub) {
            Some(c) => c,
            None => {
                let c = open_to(hub, hub_x, wait)?;
                note("connect", c.connect_ms);
                note("hello", c.hello_ms);
                c
            }
        };
        let idle = c.last.elapsed() > Duration::from_secs(10);
        let t0 = Instant::now();
        match c.call(method, path, &headers, body, wait) {
            Ok(d) => {
                let ms = t0.elapsed().as_millis().min(u32::MAX as u128) as u32;
                note("call", ms);
                if idle {
                    note("call-idle", ms);
                }
                put(hub, c);
                break d;
            }
            Err(e) if tries == 0 && e != OFFLINE => {
                note("retry", 0);
                tries += 1
            }
            Err(e) => return Err(e),
        }
    };
    let ctype = d.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("content-type")).map(|(_, v)| v.clone()).unwrap_or_default();
    Ok(crate::remote_net::Response { status: d.status, ctype, body: d.body })
}

fn open_to(hub: &str, hub_x: &str, wait: Duration) -> Result<PeerConn, String> {
    let dir = crate::config::data_dir();
    let st = crate::team_relay::load_state(dir);
    let k = crate::team_relay::device_keys(&crate::team_relay_keys::store(), &st)?;
    let x = tun::pubkey(hub_x).map_err(|_| "그 컴퓨터 열쇠 모양이 틀려요")?;
    let shared = k.tunnel_agree(&x).ok_or("그 컴퓨터 열쇠로 합의를 못 했어요")?;
    let me = tun::pubkey(&k.tunnel_public()).map_err(|_| "내 열쇠 모양")?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let url = crate::team_relay::hub_url_for(&st, &k, hub, "ws", now, &crate::team_relay_keys::new_nonce()?)?;
    PeerConn::open(&url, shared, me, wait)
}

#[cfg(test)]
#[path = "peer_conn_tests.rs"]
mod tests;
