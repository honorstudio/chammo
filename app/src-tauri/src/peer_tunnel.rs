//! 거는 쪽(손님) 터널 — 같은 계정 다른 컴퓨터의 허브에 손님으로 붙어 그 컴퓨터 폰 서버 /api 를 부른다
//! (테일스케일 없이 컴퓨터끼리, docs/plans/2026-11-01-peer-relay.md C-2).
//! 폰 입구(app/src/phone-web/hub.ts·tunnel.ts)가 하는 손님 역할을 Rust 로 — 암호·틀 모양은 phone_tunnel·phone_relay_core 그대로라
//! 받는 컴퓨터는 지금 폰 길 코드(Tunnels)로 받는다. 이 파일은 망 없는 순수 부분 — 소켓·다시 붙기는 C-4
//!
//! 순서: hello(1 ‖ {v:1, pk, n}) → 주인 hello(n, c) 를 Session::connect 로 확인 → 요청 조각 {id, i, n, m?, p?, h?, b} 를 봉해 보냄
//!       → 응답 조각 {id, i, n, s?, h?, b} 를 차례로 열어 모음(주인이 gzip 했으면 GZ 머리 — 풀어서 준다)
// 소켓(C-4)이 붙기 전까진 시험만 부른다 — 붙이면 이 줄을 지운다(roadmap 🧹)
#![allow(dead_code)]
use crate::phone_relay_core::{CHUNK, GZ};
use crate::phone_tunnel::{self as tun, Session, TunnelErr, DATA, HELLO};
use serde_json::{json, Value};
use std::collections::HashMap;

/// 한 번에 기다리는 요청 수 — 주인 쪽 MAX_PARTS 와 같게
pub const MAX_WAITS: usize = 16;
/// 응답 하나 상한(조각을 모은 크기) — 그 기기 파일 보기까지
pub const MAX_RESP: usize = 64 * 1024 * 1024;

/// 다 모인 응답
#[derive(Debug, PartialEq)]
pub struct Done {
    pub id: u64,
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

struct Wait {
    n: usize,
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    got: usize,
}

pub struct Guest {
    shared: [u8; 32],
    pk: Vec<u8>,
    n_p: Vec<u8>,
    s: Option<Session>,
    next_id: u64,
    waits: HashMap<u64, Wait>,
}

impl Guest {
    /// shared = 내 터널 비밀 열쇠 ↔ 그 컴퓨터 터널 공개 열쇠(짝지을 때 숫자로 확인한 것) 합의, pk = 내 터널 공개 열쇠
    pub fn new(shared: [u8; 32], pk: Vec<u8>) -> Self {
        let mut n = vec![0u8; tun::NONCE_LEN];
        getrandom::fill(&mut n).expect("OS 난수");
        Self::with_nonce(shared, pk, n)
    }

    pub fn with_nonce(shared: [u8; 32], pk: Vec<u8>, n_p: Vec<u8>) -> Self {
        Guest { shared, pk, n_p, s: None, next_id: 1, waits: HashMap::new() }
    }

    /// 처음 보낼 틀
    pub fn hello(&self) -> Vec<u8> {
        [vec![HELLO], json!({ "v": 1, "pk": tun::b64(&self.pk), "n": tun::b64(&self.n_p) }).to_string().into_bytes()].concat()
    }

    pub fn ready(&self) -> bool {
        self.s.is_some()
    }

    /// 요청 하나 → (id, 봉한 틀들). gz = 글 답을 압축해 달라(풀어서 돌려준다)
    pub fn request(&mut self, method: &str, path: &str, headers: &[(String, String)], body: &[u8], gz: bool) -> Result<(u64, Vec<Vec<u8>>), TunnelErr> {
        let s = self.s.as_mut().ok_or(TunnelErr::Shape)?;
        if self.waits.len() >= MAX_WAITS {
            return Err(TunnelErr::Shape);
        }
        let id = self.next_id;
        self.next_id += 1;
        let mut h = serde_json::Map::new();
        for (k, v) in headers {
            h.insert(k.to_ascii_lowercase(), Value::String(v.clone()));
        }
        if gz {
            h.insert(GZ.into(), Value::String("1".into()));
        }
        let parts: Vec<&[u8]> = if body.is_empty() { vec![&[][..]] } else { body.chunks(CHUNK).collect() };
        let n = parts.len();
        let frames = parts
            .iter()
            .enumerate()
            .map(|(i, b)| {
                let mut v = json!({ "id": id, "i": i, "n": n, "b": tun::b64(b) });
                if i == 0 {
                    v["m"] = json!(method);
                    v["p"] = json!(path);
                    v["h"] = Value::Object(h.clone());
                }
                s.seal(v.to_string().as_bytes())
            })
            .collect();
        self.waits.insert(id, Wait { n: 0, status: 0, headers: vec![], body: vec![], got: 0 });
        Ok((id, frames))
    }

    /// 기다리던 요청을 버린다(시간 초과 등) — 늦게 온 조각은 조용히 버려진다
    pub fn forget(&mut self, id: u64) {
        self.waits.remove(&id);
    }

    /// 주인이 보낸 틀 하나 — 다 모인 응답들. Err 면 이 연결은 버린다(다시 hello 부터)
    pub fn on_frame(&mut self, frame: &[u8]) -> Result<Vec<Done>, TunnelErr> {
        match frame.first() {
            Some(&HELLO) => {
                // 한 Guest 에 hello 는 한 번 — 열린 뒤 또 오면(중계가 옛 답을 되넣음) 같은 열쇠로 번호가 처음부터라 nonce 를 다시 쓴다. 버리고 새 Guest 로(리뷰 11-01 ②)
                if self.s.is_some() {
                    self.s = None;
                    self.waits.clear();
                    return Err(TunnelErr::Order);
                }
                self.s = Some(Session::connect(&self.shared, &self.n_p, frame)?);
                Ok(vec![])
            }
            Some(&DATA) => {
                let s = self.s.as_mut().ok_or(TunnelErr::Shape)?;
                let pt = s.open(frame)?;
                Ok(self.take(&pt)?.into_iter().collect())
            }
            _ => Err(TunnelErr::Shape),
        }
    }

    /// 응답 조각 {id, i, n, s?, h?, b} — 차례대로만
    fn take(&mut self, pt: &[u8]) -> Result<Option<Done>, TunnelErr> {
        let v: Value = serde_json::from_slice(pt).map_err(|_| TunnelErr::Shape)?;
        let (Some(id), Some(i), Some(n)) = (v["id"].as_u64(), v["i"].as_u64(), v["n"].as_u64()) else { return Err(TunnelErr::Shape) };
        let b = v["b"].as_str().and_then(|x| tun::unb64(x).ok()).ok_or(TunnelErr::Shape)?;
        // 버린(forget) 요청의 늦은 조각 — 연결은 살린다
        let Some(w) = self.waits.get_mut(&id) else { return Ok(None) };
        let (i, n) = (i as usize, n as usize);
        if i != w.got || n == 0 || (i > 0 && n != w.n) || w.body.len() + b.len() > MAX_RESP {
            return Err(TunnelErr::Shape);
        }
        if i == 0 {
            w.n = n;
            w.status = v["s"].as_u64().filter(|s| (100..600).contains(s)).unwrap_or(502) as u16;
            w.headers = v["h"].as_object().map(|h| h.iter().filter_map(|(k, x)| Some((k.clone(), x.as_str()?.to_string()))).collect()).unwrap_or_default();
        }
        w.body.extend_from_slice(&b);
        w.got += 1;
        if w.got < w.n {
            return Ok(None);
        }
        let w = self.waits.remove(&id).expect("있음");
        let gz = w.headers.iter().any(|(k, x)| k == GZ && x == "1");
        let headers: Vec<_> = w.headers.into_iter().filter(|(k, _)| k != GZ).collect();
        let body = if gz { gunzip(&w.body).ok_or(TunnelErr::Shape)? } else { w.body };
        Ok(Some(Done { id, status: w.status, headers, body }))
    }
}

fn gunzip(b: &[u8]) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(b).take(MAX_RESP as u64 + 1).read_to_end(&mut out).ok()?;
    (out.len() <= MAX_RESP).then_some(out)
}

#[cfg(test)]
#[path = "peer_tunnel_tests.rs"]
mod tests;
