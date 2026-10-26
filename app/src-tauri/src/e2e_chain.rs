//! 계정 기기 사슬 검증 · 확인 숫자(SAS) · 보안 번호 — chammo-relay ADR 0007, 계획 2026-10-24 e2e-multiteam §2.5.
//! 서버(chain.ts)는 모양·서명·차례만 보고 보관한다. 여기서 처음부터 다시 검증하고, 받는 기기 목록을 이 결과로만 고른다.
//! - 고리 = {seq, body(서명한 JSON 글 그대로), sig}. 서명할 글 = "chammo-chain/1\n" ‖ body
//! - 고리 해시 = SHA256("chammo-chain-link/1\n" ‖ body ‖ "\n" ‖ sig) — 다음 고리의 prev
//! - 신원(identity) = 마지막 genesis/reset 고리 해시. 기기가 늘고 줄어도 그대로, reset 때만 바뀐다 → 보안 번호
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Link {
    pub seq: u64,
    pub body: String,
    pub sig: String,
}

/// 사슬에 든 기기 하나
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChainDevice {
    /// Ed25519 서명 열쇠(32바이트 base64url)
    pub ed: String,
    /// P-256 받는 열쇠(65바이트 base64url)
    pub e2e: String,
}

/// 검증한 사슬
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Chain {
    pub account: String,
    /// 마지막 genesis/reset 고리 해시 — 보안 번호의 뿌리
    pub identity: String,
    /// 고리 해시(seq 순) — 포크 대조에 쓴다
    pub hashes: Vec<String>,
    /// 지금 사슬에 든 기기
    pub devices: BTreeMap<String, ChainDevice>,
    /// 한 번이라도 사슬에 들었던 기기의 서명 열쇠(팀 명부 옛 고리 확인용)
    pub ever: BTreeMap<String, String>,
}

impl Chain {
    pub fn head(&self) -> String {
        self.hashes.last().cloned().unwrap_or_default()
    }
}

#[derive(Debug, PartialEq)]
pub enum ChainErr {
    /// 몇 번째 고리가 왜 틀렸나
    Bad(u64, &'static str),
}

pub fn sha_b64(parts: &[&[u8]]) -> String {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
    }
    B64.encode(h.finalize())
}

pub fn link_hash(body: &str, sig: &str) -> String {
    sha_b64(&[format!("chammo-chain-link/1\n{body}\n{sig}").as_bytes()])
}

/// Ed25519 서명 확인(열쇠·서명 모양이 틀려도 false)
pub fn verify_sig(ed_pub: &str, text: &str, sig: &str) -> bool {
    let (Ok(k), Ok(s)) = (B64.decode(ed_pub), B64.decode(sig)) else { return false };
    let (Ok(k), Ok(s)) = (<[u8; 32]>::try_from(k), <[u8; 64]>::try_from(s)) else { return false };
    let Ok(vk) = VerifyingKey::from_bytes(&k) else { return false };
    vk.verify_strict(text.as_bytes(), &Signature::from_bytes(&s)).is_ok()
}

pub fn keys_text(ed: &str, e2e: &str) -> String {
    format!("chammo-device-keys/1\n{ed}\n{e2e}")
}

fn e2e_ok(s: &str) -> bool {
    B64.decode(s).is_ok_and(|b| b.len() == 65 && b[0] == 4)
}

/// 사슬 전체를 처음부터 검증한다 — 한 고리라도 틀리면 통째로 거절(부분 신뢰 없음)
pub fn verify(account: &str, links: &[Link]) -> Result<Chain, ChainErr> {
    let mut c = Chain { account: account.into(), ..Default::default() };
    for (i, l) in links.iter().enumerate() {
        let n = i as u64;
        let bad = |why| Err(ChainErr::Bad(n, why));
        let b: Value = serde_json::from_str(&l.body).map_err(|_| ChainErr::Bad(n, "json"))?;
        let s = |k: &str| b[k].as_str().unwrap_or("").to_string();
        if l.seq != n || b["v"] != 1 || b["seq"].as_u64() != Some(n) || s("account") != account {
            return bad("shape");
        }
        if s("prev") != c.head() {
            return bad("prev");
        }
        let (kind, by, device) = (s("kind"), s("by"), s("device"));
        let text = format!("chammo-chain/1\n{}", l.body);
        match kind.as_str() {
            "genesis" | "reset" => {
                if (kind == "genesis") != (n == 0) || by != device || !e2e_ok(&s("e2ePub")) || !verify_sig(&s("edPub"), &text, &l.sig) {
                    return bad("start");
                }
                c.devices = BTreeMap::from([(device.clone(), ChainDevice { ed: s("edPub"), e2e: s("e2ePub") })]);
                c.ever.insert(device, s("edPub"));
                c.identity = link_hash(&l.body, &l.sig);
            }
            "add" | "remove" => {
                let Some(signer) = c.devices.get(&by) else { return bad("signer") };
                if n == 0 || !verify_sig(&signer.ed, &text, &l.sig) {
                    return bad("sig");
                }
                if kind == "add" {
                    let (ed, e2e) = (s("edPub"), s("e2ePub"));
                    if c.devices.contains_key(&device) || !e2e_ok(&e2e) || !verify_sig(&ed, &keys_text(&ed, &e2e), &s("selfSig")) {
                        return bad("add");
                    }
                    c.devices.insert(device.clone(), ChainDevice { ed: ed.clone(), e2e });
                    c.ever.insert(device, ed);
                } else if c.devices.remove(&device).is_none() {
                    return bad("remove");
                }
            }
            _ => return bad("kind"),
        }
        c.hashes.push(link_hash(&l.body, &l.sig));
    }
    if c.hashes.is_empty() {
        return Err(ChainErr::Bad(0, "empty"));
    }
    Ok(c)
}

/// 전에 본 머리(seq·해시)가 새 사슬의 앞부분인가 — 아니면 서버가 사람마다 다른 사슬을 보여 준다(포크)
pub fn extends(c: &Chain, seen_seq: u64, seen_hash: &str) -> bool {
    c.hashes.get(seen_seq as usize).is_some_and(|h| h == seen_hash)
}

/// 확인 숫자 봉인 cP = SHA256("chammo-approve-commit/1" ‖ edPub ‖ e2ePub ‖ nP) — 서버 chain.ts commitOf 와 같다
pub fn approve_commit(ed: &[u8], e2e: &[u8], n_p: &[u8]) -> String {
    sha_b64(&[b"chammo-approve-commit/1", ed, e2e, n_p])
}

/// 확인 숫자 6자리 — 양쪽 열쇠·두 난수·계정·기기 id·사슬 신원·머리가 다 들어간다. 봉해 두고 여는 순서라 서버가 미리 맞출 수 없고,
/// 서버가 새 기기에 다른 사슬을 보여 주면 숫자가 갈린다(ADR 0007 R7)
#[allow(clippy::too_many_arguments)]
pub fn approve_sas(account: &str, device: &str, ed: &[u8], e2e: &[u8], n_p: &[u8], n_m: &[u8], identity: &str, head: &str) -> u32 {
    let mut h = Sha256::new();
    h.update(format!("chammo-approve-sas/2\n{account}\n{device}\n{identity}\n{head}\n").as_bytes());
    for p in [ed, e2e, n_p, n_m] {
        h.update(p);
    }
    let d = h.finalize();
    u32::from_be_bytes([d[0], d[1], d[2], d[3]]) % 1_000_000
}

/// 보안 번호 — 두 신원(정렬)으로 5자리 여섯 묶음. 양쪽 화면에 같게 나온다
pub fn safety_number(a: &str, b: &str) -> String {
    let (x, y) = if a <= b { (a, b) } else { (b, a) };
    let d = Sha256::new().chain_update(b"chammo-safety/1\n").chain_update(x.as_bytes()).chain_update(b"\n").chain_update(y.as_bytes()).finalize();
    (0..6)
        .map(|i| {
            let c = &d[i * 5..i * 5 + 5];
            let n = c.iter().fold(0u64, |acc, b| acc << 8 | *b as u64) % 100_000;
            format!("{n:05}")
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
#[path = "e2e_chain_tests.rs"]
mod tests;
