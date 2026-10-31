//! 팀 메신저 시험 도우미 — 받은 요청을 적어 두고 서명을 진짜로 확인하는 가짜 중계 서버(chammo-relay 의 문지기 흉내)
use crate::team_relay::Http;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use std::cell::RefCell;

/// 받은 요청을 적어 두고 서명을 진짜로 확인하는 가짜 서버(chammo-relay 의 문지기 흉내)
#[derive(Default)]
pub struct FakeRelay {
    pub seen: RefCell<Vec<(String, String, Vec<(String, String)>, String)>>,
    /// (길 끝, 응답 코드, 응답 몸통)
    pub answers: RefCell<Vec<(String, u16, String)>>,
    /// 늘 같은 답(방법, 길 끝, 코드, 몸통) — 줄 선 답이 없을 때만. 시험이 관심 없는 길(명부 고리 등)을 채운다
    pub always: RefCell<Vec<(String, String, u16, String)>>,
    /// 등록된 기기 id → 공개 열쇠
    pub devices: RefCell<Vec<(String, String)>>,
    /// 요청을 받는 순간 부른다(길) — 그사이 바깥(로그아웃 등)이 바뀌는 때를 만들려고
    #[allow(clippy::type_complexity)]
    pub on_send: RefCell<Option<Box<dyn Fn(&str)>>>,
}

impl FakeRelay {
    pub fn answer(&self, path_end: &str, status: u16, body: &str) {
        self.answers.borrow_mut().push((path_end.into(), status, body.into()));
    }
    pub fn always(&self, method: &str, path_end: &str, status: u16, body: &str) {
        self.always.borrow_mut().push((method.into(), path_end.into(), status, body.into()));
    }
    pub fn header<'a>(h: &'a [(String, String)], k: &str) -> Option<&'a str> {
        h.iter().find(|(n, _)| n.eq_ignore_ascii_case(k)).map(|(_, v)| v.as_str())
    }
    pub fn verify(&self, method: &str, path: &str, h: &[(String, String)], body: &[u8]) -> bool {
        let key = match (Self::header(h, "X-Chammo-Key"), Self::header(h, "X-Chammo-Device")) {
            (Some(k), None) => k.to_string(),
            (None, Some(d)) => match self.devices.borrow().iter().find(|(id, _)| id == d) {
                Some((_, k)) => k.clone(),
                None => return false,
            },
            _ => return false,
        };
        let (Some(ts), Some(nonce), Some(sig)) = (Self::header(h, "X-Chammo-Ts"), Self::header(h, "X-Chammo-Nonce"), Self::header(h, "X-Chammo-Sig")) else { return false };
        let pk: [u8; 32] = B64.decode(key).unwrap().try_into().unwrap();
        let s: [u8; 64] = B64.decode(sig).unwrap().try_into().unwrap();
        let vk = ed25519_dalek::VerifyingKey::from_bytes(&pk).unwrap();
        let text = crate::team_relay_keys::signing_text(method, path, ts, nonce, body);
        vk.verify_strict(text.as_bytes(), &ed25519_dalek::Signature::from_bytes(&s)).is_ok()
    }
}

impl Http for FakeRelay {
    fn send(&self, method: &str, url: &str, headers: &[(String, String)], body: &[u8]) -> Result<(u16, String), String> {
        let path = url.strip_prefix("https://relay.test").expect("설정한 서버로만 나간다").to_string();
        if let Some(f) = self.on_send.borrow().as_ref() {
            f(&path);
        }
        self.seen.borrow_mut().push((method.into(), path.clone(), headers.to_vec(), String::from_utf8_lossy(body).into()));
        // Cloudflare 가 주는 서명 없는 길(/cdn-cgi/trace — 시계 확인) — 준비한 답이 없으면 로컬 중계처럼 404
        if path.starts_with("/cdn-cgi/") {
            let mut a = self.answers.borrow_mut();
            return Ok(match a.iter().position(|(p, _, _)| path.ends_with(p.as_str())) {
                Some(i) => {
                    let (_, st, b) = a.remove(i);
                    (st, b)
                }
                None => (404, String::new()),
            });
        }
        if !self.verify(method, &path, headers, body) {
            return Ok((401, r#"{"error":"unauthorized"}"#.into()));
        }
        let mut a = self.answers.borrow_mut();
        let (st, b) = match a.iter().position(|(p, _, _)| path.ends_with(p.as_str())) {
            Some(i) => {
                let (_, st, b) = a.remove(i);
                (st, b)
            }
            // 팀 머리(/heads)는 준비 안 했으면 옛 중계처럼 404 — 머리 길이 없는 중계에서도 예전처럼 도는지 시험들이 그대로 본다
            None if method == "GET" && path.ends_with("/heads") && !self.always.borrow().iter().any(|(m, p, _, _)| m == method && path.ends_with(p.as_str())) => (404, r#"{"error":"not_found"}"#.into()),
            None => self.always.borrow().iter().find(|(m, p, _, _)| m == method && path.ends_with(p.as_str())).map(|(_, _, st, b)| (*st, b.clone())).expect("준비 안 한 길"),
        };
        // 진짜 서버처럼 — 로그인 마침이 새 기기를 만들면 그 열쇠를 그 기기 id 로 기억한다(다음 요청부터 기기 머리)
        if path.ends_with("/v0/auth/google/finish") && st == 201 {
            if let (Some(k), Some(d)) = (Self::header(headers, "X-Chammo-Key"), serde_json::from_str::<serde_json::Value>(&b).ok().and_then(|v| v["deviceId"].as_str().map(String::from))) {
                self.devices.borrow_mut().push((d, k.to_string()));
            }
        }
        Ok((st, b))
    }
}

