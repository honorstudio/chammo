//! 폰 중계 터널의 속(ADR 0013) — 소켓 없이 시험되는 부분. 소켓·스레드는 phone_relay.rs.
//! - 틀 → 세션(phone_tunnel) → 조각 모으기 → 요청. 응답은 128KB 조각으로
//! - **같은 문**: 터널 요청은 폰 서버와 같은 head_check + handle 을 지난다. 더해서 Bearer 토큰의 기기 = 이 터널 세션의 기기여야 하고,
//!   짝짓기·연결 요청·다른 기기 참모 길은 터널에서 없다(짝짓기는 두드리기로만)
//! - 두드리기: 상자를 열어 10분 코드 확인 → 중계에 '내 기기 추가' → 그 줄에 중계 묶음 → 토큰을 폰 열쇠로 봉해 돌려준다
use crate::mobile_http::{self as http, Backend, Gate, Req, Resp};
use crate::mobile_pair::{Devices, Pairing, Relay};
use crate::phone_tunnel::{self as tun, Session, DATA, HELLO};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::SystemTime;

/// 터널 요청의 Host — 중계 Gate 는 이 이름만 받는다(테일넷 이름과 섞이지 않게)
pub const RELAY_HOST: &str = "chammo-relay.tunnel";
/// 응답·요청 조각 크기(평문) — base64·허브 JSON 을 거쳐도 Workers WebSocket 1MiB 안
pub const CHUNK: usize = 128 * 1024;
/// 모은 요청 상한 — 붙이기(20MB) + 여유
const MAX_REQ: usize = crate::mobile_files::MAX_ATTACH + 1024 * 1024;
/// 한 연결에 모으는 중인 요청 수 상한
const MAX_PARTS: usize = 16;
/// 터널로 넘기는 요청 머리 — 그 밖은 버린다(Host·Origin 은 이쪽이 정한다)
const PASS_HEADERS: &[&str] = &["authorization", "content-type", "range", "accept"];

/// 이 컴퓨터가 아는 중계 폰 줄과 열쇠 — 시험은 가짜
pub trait Lines {
    /// 중계 기기 id → (폰 줄 id, 폰 터널 공개 열쇠 65바이트)
    fn line_of(&self, relay_device: &str) -> Option<(String, Vec<u8>)>;
    /// 컴퓨터 터널 비밀 열쇠로 합의
    fn agree(&self, their: &[u8]) -> Option<[u8; 32]>;
}

#[derive(Debug, Clone, PartialEq)]
pub struct TReq {
    pub id: u64,
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug, PartialEq)]
pub enum Ev {
    /// 이 연결로 보낼 틀(이미 봉함)
    Send(Vec<u8>),
    /// 다 모인 요청 — 처리해서 응답 조각을 seal 로 보낸다
    Run(TReq),
    /// 이 연결을 버렸다(틀린 틀·모르는 폰)
    Drop(String),
}

struct Part {
    req: TReq,
    n: usize,
    next: usize,
}

struct Conn {
    line: String,
    relay: String,
    s: Session,
    parts: HashMap<u64, Part>,
}

#[derive(Default)]
pub struct Tunnels {
    conns: HashMap<String, Conn>,
}

fn b64d(v: &Value) -> Option<Vec<u8>> {
    v.as_str().and_then(|s| tun::unb64(s).ok())
}

impl Tunnels {
    pub fn line(&self, c: &str) -> Option<&str> {
        self.conns.get(c).map(|x| x.line.as_str())
    }

    pub fn bye(&mut self, c: &str) {
        self.conns.remove(c);
    }

    /// 지금 연결 수(상태 화면)
    pub fn len(&self) -> usize {
        self.conns.len()
    }

    /// 응답 평문 하나를 그 연결 열쇠로 봉한다 — 연결이 없으면 None
    pub fn seal(&mut self, c: &str, pt: &[u8]) -> Option<Vec<u8>> {
        self.conns.get_mut(c).map(|x| x.s.seal(pt))
    }

    /// 허브에서 온 틀 하나. from = 서버가 찍은 폰 중계 기기 id, c = 연결 번호
    pub fn on_frame(&mut self, lines: &dyn Lines, from: &str, c: &str, frame: &[u8]) -> Vec<Ev> {
        match frame.first() {
            Some(&HELLO) => {
                // 새 hello 는 그 연결의 앞 세션을 버린다(폰이 다시 붙음)
                self.conns.remove(c);
                let Some((line, x)) = lines.line_of(from) else { return vec![Ev::Drop("unknown phone".into())] };
                let Ok(h) = tun::parse_hello(frame) else { return vec![Ev::Drop("bad hello".into())] };
                // 폰이 내민 열쇠 = 짝지을 때 받은 그 열쇠여야(서버가 찍은 기기 id 와 둘 다 맞아야)
                if h.pk != x {
                    return vec![Ev::Drop("key mismatch".into())];
                }
                let Some(shared) = lines.agree(&x) else { return vec![Ev::Drop("bad key".into())] };
                let (s, reply) = Session::accept(&shared, &h);
                self.conns.insert(c.to_string(), Conn { line, relay: from.to_string(), s, parts: HashMap::new() });
                vec![Ev::Send(reply)]
            }
            Some(&DATA) => {
                let Some(conn) = self.conns.get_mut(c).filter(|x| x.relay == from) else { return vec![Ev::Drop("no session".into())] };
                let pt = match conn.s.open(frame) {
                    Ok(pt) => pt,
                    Err(e) => {
                        self.conns.remove(c);
                        return vec![Ev::Drop(format!("{e:?}"))];
                    }
                };
                match conn.take(&pt) {
                    Ok(Some(r)) => vec![Ev::Run(r)],
                    Ok(None) => vec![],
                    Err(e) => {
                        self.conns.remove(c);
                        vec![Ev::Drop(e)]
                    }
                }
            }
            _ => vec![Ev::Drop("bad frame".into())],
        }
    }
}

impl Conn {
    /// 요청 조각 {id, i, n, m?, p?, h?, b} — 차례대로만. 다 모이면 Some
    fn take(&mut self, pt: &[u8]) -> Result<Option<TReq>, String> {
        let v: Value = serde_json::from_slice(pt).map_err(|_| "bad chunk")?;
        let (Some(id), Some(i), Some(n)) = (v["id"].as_u64(), v["i"].as_u64(), v["n"].as_u64()) else { return Err("bad chunk".into()) };
        let (i, n) = (i as usize, n as usize);
        let b = b64d(&v["b"]).ok_or("bad chunk")?;
        if n == 0 || n > MAX_REQ / CHUNK + 1 || b.len() > CHUNK {
            return Err("bad chunk".into());
        }
        if i == 0 {
            if self.parts.len() >= MAX_PARTS || self.parts.contains_key(&id) {
                return Err("too many requests".into());
            }
            let method = v["m"].as_str().filter(|m| matches!(*m, "GET" | "HEAD" | "POST")).ok_or("bad method")?;
            let path = v["p"].as_str().filter(|p| p.starts_with('/') && p.len() <= 4096).ok_or("bad path")?;
            let headers = v["h"].as_object().map(|h| h.iter().filter_map(|(k, x)| Some((k.to_ascii_lowercase(), x.as_str()?.to_string()))).filter(|(k, _)| PASS_HEADERS.contains(&k.as_str())).collect()).unwrap_or_default();
            self.parts.insert(id, Part { req: TReq { id, method: method.into(), path: path.into(), headers, body: Vec::new() }, n, next: 0 });
        }
        let p = self.parts.get_mut(&id).ok_or("bad chunk")?;
        if i != p.next || n != p.n || p.req.body.len() + b.len() > MAX_REQ {
            return Err("bad chunk".into());
        }
        p.req.body.extend_from_slice(&b);
        p.next += 1;
        if p.next < p.n {
            return Ok(None);
        }
        Ok(self.parts.remove(&id).map(|p| p.req))
    }
}

/// 응답 → 평문 조각들 {id, i, n, s?, h?, b}. 공통 머리(CSP·캐시 금지)는 폰 서버와 같게
pub fn resp_chunks(id: u64, r: &Resp, head_only: bool) -> Vec<Vec<u8>> {
    let body: &[u8] = if head_only { &[] } else { &r.body };
    let parts: Vec<&[u8]> = if body.is_empty() { vec![&[][..]] } else { body.chunks(CHUNK).collect() };
    let n = parts.len();
    let mut h = serde_json::Map::new();
    for (k, v) in r.headers.iter().map(|(k, v)| (*k, v.clone())).chain(http::std_headers(r)) {
        h.insert(k.to_string(), Value::String(v));
    }
    parts
        .into_iter()
        .enumerate()
        .map(|(i, b)| {
            let mut m = json!({ "id": id, "i": i, "n": n, "b": tun::b64(b) });
            if i == 0 {
                m["s"] = json!(r.status);
                m["h"] = Value::Object(h.clone());
            }
            m.to_string().into_bytes()
        })
        .collect()
}

fn text(status: u16, t: &str) -> Resp {
    Resp { status, headers: vec![("Content-Type", "text/plain; charset=utf-8".into())], body: t.as_bytes().to_vec() }
}

/// 터널에 없는 길 — 짝짓기는 두드리기로만, 연결 요청·다른 기기 참모 길은 테일넷 손님용
fn blocked(path: &str) -> bool {
    matches!(path, "/api/pair" | "/api/hello" | "/api/link-request" | "/api/link-status" | "/api/link-check" | "/api/peer-say" | "/api/peer-reply" | "/api/peer-human" | "/api/peer-direct-answer" | "/api/peer-locker")
}

/// 표(ticket)가 열쇠인 길 — iframe·소리·내려받기. 표는 이 폰이 자기 토큰으로 받은 것
fn ticket_path(path: &str) -> bool {
    path == "/api/html" || path.starts_with("/api/html/") || path == "/api/dl" || path == "/api/media"
}

/// 터널 요청 → 폰 서버 요청. Host·Origin 은 이쪽이 정하고, 같은 문(head_check)과 '토큰 기기 = 세션 기기'를 본다
pub fn gate_req(t: &TReq, line: &str, gate: &Gate) -> Result<Req, Resp> {
    let (path, query) = t.path.split_once('?').map_or((t.path.as_str(), ""), |(p, q)| (p, q));
    if blocked(path) {
        return Err(text(404, "not found"));
    }
    let mut headers: Vec<(String, String)> = t.headers.clone();
    headers.push(("host".into(), RELAY_HOST.into()));
    if let Some(o) = gate.origins.first() {
        headers.push(("origin".into(), o.clone()));
    }
    headers.push(("content-length".into(), t.body.len().to_string()));
    let req = Req { method: t.method.clone(), path: path.into(), query: query.into(), headers, body: t.body.clone() };
    if let Some(r) = http::head_check(&req, gate) {
        return Err(r);
    }
    if path.starts_with("/api/") && !ticket_path(path) {
        let who = req.header("authorization").and_then(|v| v.strip_prefix("Bearer ")).and_then(|tok| gate.devices.check(tok, SystemTime::now()));
        if who.as_deref() != Some(line) {
            return Err(text(401, "no key"));
        }
    }
    Ok(req)
}

/// 요청 하나 처리 — 같은 문을 지나 handle. 패닉은 500
pub fn serve(t: &TReq, line: &str, gate: &Gate, be: &dyn Backend) -> Resp {
    match gate_req(t, line, gate) {
        Err(r) => r,
        Ok(req) => std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| http::handle(&req, gate, be))).unwrap_or_else(|_| text(500, "internal error")),
    }
}

/// 두드리기 상자 속
#[derive(Debug, PartialEq)]
pub struct Knock {
    pub code: String,
    pub name: String,
    pub home: bool,
    pub prev: Option<String>,
    /// 폰 Ed25519 공개 열쇠(중계 서명용) base64url
    pub sign: String,
    /// 폰 터널 공개 열쇠(P-256, 65바이트)
    pub x: Vec<u8>,
}

pub fn open_knock(me_pub: &[u8], agree: impl Fn(&[u8]) -> Option<[u8; 32]>, boxed: &str) -> Result<Knock, String> {
    let pt = tun::open(me_pub, agree, &tun::unb64(boxed).map_err(|_| "bad box")?).map_err(|e| format!("box {e:?}"))?;
    let v: Value = serde_json::from_slice(&pt).map_err(|_| "bad box json")?;
    let s = |k: &str| v[k].as_str().map(str::to_string);
    let code = s("code").filter(|c| c.len() == 32 && c.bytes().all(|b| b.is_ascii_hexdigit())).ok_or("bad code")?;
    let sign = s("sign").filter(|k| tun::unb64(k).is_ok_and(|b| b.len() == 32)).ok_or("bad sign key")?;
    let x = tun::pubkey(&s("x").ok_or("bad x")?).map_err(|_| "bad x")?;
    let prev = s("prev").filter(|p| p.len() == 64);
    let name = crate::mobile_pair::device_name(&s("ua").unwrap_or_default());
    Ok(Knock { code, name, home: v["home"].as_bool().unwrap_or(false), prev, sign, x })
}

/// 두드리기 답 — 열쇠 대조 → 코드 확인 → 중계에 기기 들이기(add) → 줄에 묶음 → 토큰. 실패도 봉해서 돌려준다(이유만).
/// hub_key = 허브가 두드리기 소켓 서명으로 확인한 열쇠 — 상자 속 sign 과 달라야 할 까닭이 없다(남의 상자를 옮겨 실은 것, 보안 검토 E)
/// 들인 뒤 줄에 못 묶었으면(그사이 코드가 죽음) 방금 넣은 중계 기기는 끊을 대기열에(고아 기기, 보안 검토 F)
pub fn answer_knock(k: &Knock, hub_key: &str, devices: &Devices, add: impl FnOnce(&str, &str) -> Result<String, String>, mac: &Value) -> Value {
    if !crate::mobile_http::ct_eq(k.sign.as_bytes(), hub_key.as_bytes()) {
        return json!({ "ok": false, "error": "key" });
    }
    let now = SystemTime::now();
    // 참모가 만든 코드(scripts/app phone pair)는 사람이 컴퓨터 카드에서 허용해야 — 그 전엔 중계에 들이지 않고 기다리라고만(코드는 그대로)
    if devices.held(&k.code, now) {
        return json!({ "ok": false, "error": "held" });
    }
    if !devices.code_alive(&k.code, now) {
        return json!({ "ok": false, "error": "code" });
    }
    let relay = match add(&k.sign, &k.name) {
        Ok(id) => id,
        Err(e) => return json!({ "ok": false, "error": "relay", "detail": e }),
    };
    let p = Pairing { name: &k.name, home: k.home, prev: k.prev.as_deref(), peer: false };
    match devices.pair_relay(&k.code, &p, Relay { device: relay.clone(), x: tun::b64(&k.x) }, now) {
        Some(token) => json!({ "ok": true, "token": token, "device": relay, "mac": mac }),
        None => {
            let _ = devices.queue_revoke(&relay);
            json!({ "ok": false, "error": "code" })
        }
    }
}

/// 끊을 중계 기기 대기열 비우기 — 200·404(이미 없음)면 뺀다, 그 밖(망·5xx·401)은 남겨 다음에 다시. → (끊음, 남음)
pub fn drain_revokes(devices: &Devices, call: impl Fn(&str) -> Result<u16, String>) -> (usize, usize) {
    let q = devices.pending_revokes();
    let done: Vec<String> = q.iter().filter(|id| matches!(call(id), Ok(200 | 404))).cloned().collect();
    let _ = devices.revoked(&done);
    (done.len(), q.len() - done.len())
}

#[cfg(test)]
#[path = "phone_relay_core_tests.rs"]
mod tests;
