//! 폰이 이 컴퓨터 화면을 열기 — QR 대신 '확인 숫자'(ADR 0014). 두드리기 소켓 위 5단계 중 컴퓨터 쪽 순서 지키기와 숫자 계산.
//! ① 폰 link1 {sign, x, ua, dev, cP = H(Pt‖nP)} → ② 컴퓨터 cM = H(Mt‖nM) → ③ 폰 nP(대조) → ④ 컴퓨터 nM 공개 + 숫자 카드 → ⑤ 사람이 허용하면 토큰.
//! 양쪽이 다 봉해 두고 연다 — 중계는 어느 쪽 숫자든 알기 전에 패를 먼저 깨야 하고, 컴퓨터 숫자를 아는 순간 카드가 이미 떠 있다(리뷰 2차 심각).
//! 그래서 순서를 어긴 틀은 다 버리고, 한 두드리기에 숫자는 한 번, nM 내주기는 컴퓨터 전체로 10분에 5번
use crate::phone_tunnel as tun;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const COMMIT_TAG: &[u8] = b"chammo-link-commit/1";
pub const SAS_TAG: &[u8] = b"chammo-link-sas/1";
pub const COMMIT_M_TAG: &[u8] = b"chammo-link-commit-m/1";
/// 두드리기 하나·카드 하나의 수명
pub const LINK_TTL: Duration = Duration::from_secs(600);
/// 동시에 기다리는 두드리기 상한 — 남이 두드려 대도 메모리가 안 붓게
const MAX_LINKS: usize = 16;

/// commit = SHA256(표식 ‖ 폰 터널 공개 열쇠 ‖ nP)
pub fn commit(pt: &[u8], np: &[u8]) -> [u8; 32] {
    Sha256::new().chain_update(COMMIT_TAG).chain_update(pt).chain_update(np).finalize().into()
}

/// 컴퓨터 commit = SHA256(표식 ‖ 컴퓨터 터널 공개 열쇠 ‖ nM) — 폰이 nP 를 열기 전에 받는다
pub fn commit_m(mt: &[u8], nm: &[u8]) -> [u8; 32] {
    Sha256::new().chain_update(COMMIT_M_TAG).chain_update(mt).chain_update(nm).finalize().into()
}

/// 확인 숫자 = SHA256(표식 ‖ Pt ‖ Mt ‖ 폰 서명 열쇠 ‖ 폰 기기 id(utf8) ‖ nP ‖ nM) 앞 4바이트 mod 10⁶.
/// 앞뒤 칸 길이가 고정(65·65·32 … 16·16)이라 가운데 기기 id 의 경계가 하나로 정해진다
pub fn sas(pt: &[u8], mt: &[u8], sign: &[u8], dev: &[u8], np: &[u8], nm: &[u8]) -> u32 {
    let h = Sha256::new().chain_update(SAS_TAG).chain_update(pt).chain_update(mt).chain_update(sign).chain_update(dev).chain_update(np).chain_update(nm).finalize();
    u32::from_be_bytes([h[0], h[1], h[2], h[3]]) % 1_000_000
}

/// "482 913" — 세 자리씩, 앞 0 채움
pub fn sas_text(n: u32) -> String {
    let s = format!("{n:06}");
    format!("{} {}", &s[..3], &s[3..])
}

/// 폰 인사(link1) — 확인을 마친 값만
#[derive(Clone, Debug, PartialEq)]
pub struct Hello {
    /// 폰 Ed25519 공개 열쇠(중계 서명용) base64url
    pub sign: String,
    /// 폰 터널 공개 열쇠(P-256, 65바이트)
    pub x: Vec<u8>,
    pub name: String,
    /// 중계 기기 id(허브가 서명으로 확인해 넘긴 것)
    pub dev: String,
    commit: [u8; 32],
}

struct Link {
    hello: Hello,
    nm: [u8; 16],
    sas: Option<u32>,
    card: Option<String>,
    started: Instant,
    /// 순서를 어겼다 — 이 두드리기는 끝
    dead: bool,
}

/// 숫자 카드는 기기마다 이 시간 안에 이만큼까지 — 되풀이해 카드를 쌓아 사람이 지쳐 허용하게 만들지 못하게(리뷰 3)
const MAX_SHOWN: usize = 3;
/// nM 내주기는 컴퓨터 전체로 이 시간 안에 이만큼까지(link1 때 셈, 기기 상관없이)
const MAX_ISSUED: usize = 5;

#[derive(Default)]
struct Inner {
    links: HashMap<String, Link>,
    /// 기기 id → 숫자를 낸 때들
    shown: HashMap<String, Vec<Instant>>,
    /// nM 을 내준 때들(컴퓨터 전체)
    issued: Vec<Instant>,
}

/// 기다리는 두드리기들(두드리기 id → 순서 상태). 기기마다 하나 — 새 두드리기가 옛 것을 닫는다
#[derive(Default)]
pub struct Links(Mutex<Inner>);

fn id_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

impl Links {
    fn sweep(g: &mut Inner, now: Instant) {
        g.links.retain(|_, l| now.saturating_duration_since(l.started) <= LINK_TTL);
        for v in g.shown.values_mut() {
            v.retain(|t| now.saturating_duration_since(*t) <= LINK_TTL);
        }
        g.shown.retain(|_, v| !v.is_empty());
        g.issued.retain(|t| now.saturating_duration_since(*t) <= LINK_TTL);
    }

    /// ① link1 — first_replacing 에서 닫은 카드는 버린다(시험용 짧은 길)
    pub fn first(&self, k: &str, hello: &Value, hub_key: &str, dev: &str, mt: &[u8], now: Instant) -> Result<[u8; 32], String> {
        self.first_replacing(k, hello, hub_key, dev, mt, now).map(|(cm, _)| cm)
    }

    /// ① link1 — 허브가 확인한 열쇠(hub_key)·기기 id(dev) 와 상자 속 인사(sign·dev)를 대조하고 nM 을 뽑아 봉한 것(cM)만 돌려준다(② link2).
    /// 같은 기기의 옛 두드리기는 닫고, 거기 띄운 카드 id 를 돌려준다(카드를 닫으라고). nM 내주기는 컴퓨터 전체로 10분에 5번
    pub fn first_replacing(&self, k: &str, hello: &Value, hub_key: &str, dev: &str, mt: &[u8], now: Instant) -> Result<([u8; 32], Option<String>), String> {
        let s = |f: &str| hello[f].as_str().unwrap_or_default();
        if !id_ok(k) || !id_ok(dev) {
            return Err("bad id".into());
        }
        if !crate::mobile_http::ct_eq(s("sign").as_bytes(), hub_key.as_bytes()) || tun::unb64(s("sign")).map(|b| b.len()) != Ok(32) {
            return Err("key".into());
        }
        // 폰이 자기 기기 id 를 봉한 상자에 넣는다 — 중계가 숫자 맞은 카드에 다른 기기를 붙이지 못하게(리뷰 4)
        if !crate::mobile_http::ct_eq(s("dev").as_bytes(), dev.as_bytes()) {
            return Err("dev".into());
        }
        let x = tun::pubkey(s("x")).map_err(|_| "bad x")?;
        let commit: [u8; 32] = tun::unb64(s("commit")).ok().and_then(|b| b.try_into().ok()).ok_or("bad commit")?;
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        Self::sweep(&mut g, now);
        if let Some(l) = g.links.get_mut(k) {
            l.dead = true;
            return Err("second link1".into());
        }
        // 한도·바쁨부터 — 통과했을 때만 옛 것을 바꾼다(한도에 걸린 다시 두드리기가 진짜 카드를 죽이지 못하게, 재리뷰 1)
        let old: Vec<String> = g.links.iter().filter(|(_, l)| l.hello.dev == dev).map(|(k, _)| k.clone()).collect();
        if g.links.len() - old.len() >= MAX_LINKS || g.issued.len() >= MAX_ISSUED {
            return Err("busy".into());
        }
        let closed = old.iter().filter_map(|k| g.links.remove(k)).find_map(|l| l.card);
        let mut nm = [0u8; 16];
        getrandom::fill(&mut nm).map_err(|e| e.to_string())?;
        g.issued.push(now);
        let hello = Hello { sign: s("sign").to_string(), x, name: crate::mobile_pair::device_name(s("ua")), dev: dev.to_string(), commit };
        g.links.insert(k.to_string(), Link { hello, nm, sas: None, card: None, started: now, dead: false });
        Ok((commit_m(mt, &nm), closed))
    }

    /// ③ link3 — nP 를 commit 과 대조하고 숫자와 nM 을 낸다(한 번만 — 부른 쪽이 카드를 먼저 띄우고 ④ nM 을 보낸다). 틀리면 그 두드리기는 끝. 기기마다 10분에 3장까지
    pub fn reveal(&self, k: &str, np: &[u8], mt: &[u8], now: Instant) -> Result<(u32, Hello, [u8; 16]), String> {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        Self::sweep(&mut g, now);
        let Inner { links, shown, .. } = &mut *g;
        let l = links.get_mut(k).ok_or("no link1")?;
        if l.dead || l.sas.is_some() {
            l.dead = true;
            return Err("out of order".into());
        }
        if np.len() != 16 || !crate::mobile_http::ct_eq(&commit(&l.hello.x, np), &l.hello.commit) {
            l.dead = true;
            return Err("commit".into());
        }
        let seen = shown.entry(l.hello.dev.clone()).or_default();
        if seen.len() >= MAX_SHOWN {
            l.dead = true;
            return Err("too many checks".into());
        }
        let sign = tun::unb64(&l.hello.sign).map_err(|_| "bad sign")?;
        let n = sas(&l.hello.x, mt, &sign, l.hello.dev.as_bytes(), np, &l.nm);
        seen.push(now);
        l.sas = Some(n);
        Ok((n, l.hello.clone(), l.nm))
    }

    /// 숫자가 나온 두드리기(카드를 그릴 때)
    pub fn shown(&self, k: &str, now: Instant) -> Option<(u32, Hello)> {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        Self::sweep(&mut g, now);
        g.links.get(k).filter(|l| !l.dead).and_then(|l| l.sas.map(|n| (n, l.hello.clone())))
    }

    /// 카드 id 를 두드리기에 묶는다 — 그새 두드리기가 끊겼으면 false(부른 쪽이 그 카드를 닫는다, 재리뷰 2)
    pub fn card(&self, k: &str, card: &str) -> bool {
        match self.0.lock().unwrap_or_else(|e| e.into_inner()).links.get_mut(k) {
            Some(l) if !l.dead => {
                l.card = Some(card.to_string());
                true
            }
            _ => false,
        }
    }

    /// ③→④ 한 번에: nP 대조·숫자 → **카드를 먼저 쓴다**(write_card → 카드 id) → 묶이면 그때 nM 을 내준다.
    /// 카드를 못 쓰거나 못 묶으면 nM 없이 두드리기를 끝낸다(중계가 숫자를 아는 순간 카드는 늘 사람 화면에)
    pub fn link3(&self, k: &str, np: &[u8], mt: &[u8], now: Instant, write_card: impl FnOnce(&Hello, u32) -> Option<String>) -> Result<([u8; 16], String, Vec<u8>), String> {
        let (n, h, nm) = self.reveal(k, np, mt, now)?;
        let Some(card) = write_card(&h, n) else {
            self.drop_knock(k);
            return Err("card".into());
        };
        if !self.card(k, &card) {
            return Err(format!("gone:{card}"));
        }
        Ok((nm, card, h.x))
    }

    /// 사람이 답한 카드 → (두드리기 id, 인사). 꺼내면 지운다 — 두 번 허용으로 토큰 둘이 나가지 않게
    pub fn take_card(&self, card: &str, now: Instant) -> Option<(String, Hello)> {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        Self::sweep(&mut g, now);
        let k = g.links.iter().find(|(_, l)| l.card.as_deref() == Some(card) && l.sas.is_some() && !l.dead).map(|(k, _)| k.clone())?;
        g.links.remove(&k).map(|l| (k, l.hello))
    }

    /// 두드리기가 닫혔다(폰이 나감·허브 끊김)
    pub fn drop_knock(&self, k: &str) -> Option<String> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).links.remove(k).and_then(|l| l.card)
    }
}

#[cfg(test)]
#[path = "device_link_tests.rs"]
mod tests;
