//! 종단 암호 봉투 — chammo-relay ADR 0007, 계획 2026-10-24 e2e-multiteam §2.4. 방 메시지 body 가 이 JSON 글이다.
//! 내용 열쇠 k(무작위 32바이트)로 안쪽 JSON 을 AES-256-GCM, k 는 받는 기기마다 HPKE(P-256)로 감싼다(e2e_hpke).
//! 보낸 기기 Ed25519 서명이 방·cid·보낸 기기·사슬/명부 머리·kh(=H(k))·암호문·봉투 목록을 덮는다.
//! - kh: AES-GCM 은 열쇠를 묶지 않는다 — 나쁜 멤버가 사람마다 다른 k 를 봉해 '사람마다 다르게 읽히는 말'을 못 만들게
//! - 사람 말 표시는 안쪽에도 — 받는 쪽은 바깥(서버)·안쪽이 둘 다 human 일 때만 사람 말
//! - 서버(room.ts envelopeOk)는 모양만 본다: v1 · 보낸 기기/방/cid 가 소켓과 같음 · 받는 기기 하나씩
use crate::e2e_chain::{sha_b64, verify_sig};
use crate::e2e_hpke;
use crate::team_relay_keys::DeviceKeys;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// 봉투 머리(서명 대상) — 사슬·명부 머리는 받는 쪽이 자기 본 것과 대조해 포크를 잡는다
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Meta {
    pub room: String,
    pub cid: String,
    pub from: String,
    /// 보낸 사람 계정 사슬 머리
    pub head: String,
    /// 받는 계정 → 내가 본 그 사슬 머리
    pub peers: BTreeMap<String, String>,
    /// 팀 방이면 내가 본 명부 머리(내 기기끼리 방은 빈 글)
    pub roster: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Inner {
    /// human | agent
    pub origin: String,
    pub text: String,
    pub at: u64,
    /// "helper" = 방에서 부른 팀 참모의 답(team_helper). 비면 안 쓴다 — 옛 봉투·기준값 바이트 그대로
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub via: String,
    /// 반응·붙인 파일(비면 칸이 없어 옛 봉투 바이트 그대로) — 옛 앱은 모르는 칸이라 무시
    #[serde(flatten)]
    pub extra: Extra,
}

/// 반응 표식 — 직접 그린 SVG 다섯(시안 msg-rooms v2, 화면 ui/Icons.tsx REACT_MARKS 와 같은 이름)
pub const REACT_MARKS: [&str; 5] = ["like", "check", "smile", "eyes", "heart"];
/// 한 말에 붙이는 파일 수 상한
pub const MAX_FILES: usize = 10;

/// 말에 딸린 것(chammo-relay team-rooms v2) — react = 같은 방 다른 글(seq)에 표식 달기·떼기, files = 팀 보관함 파일 참조(team_locker FileRef 모양 — 열쇠는 안 싣는다)
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Extra {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub react: Option<React>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct React {
    pub seq: u64,
    pub mark: String,
    /// true = 달기, false = 떼기
    pub on: bool,
}

impl Extra {
    /// 모양 확인 — 모르는 표식·너무 많은 파일·파일 칸 모양이 틀리면 Err
    pub fn check(&self) -> Result<(), &'static str> {
        if let Some(r) = &self.react {
            if r.seq == 0 || !REACT_MARKS.contains(&r.mark.as_str()) {
                return Err("모르는 반응");
            }
        }
        if self.files.len() > MAX_FILES || !self.files.iter().all(|f| f["id"].as_str().is_some_and(|x| !x.is_empty() && x.len() <= 80) && f["name"].as_str().is_some_and(|x| !x.is_empty() && x.chars().count() <= 200) && f["size"].is_u64()) {
            return Err("파일 칸 모양이 틀렸어");
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct Recipient {
    pub device: String,
    /// P-256 받는 열쇠(65바이트 base64url)
    pub e2e: String,
}

#[derive(Debug, PartialEq)]
pub enum EnvErr {
    /// JSON·모양이 틀림
    Shape,
    /// 이 기기 몫 봉투가 없음(보낼 때 받는 기기가 아니었다)
    NotForMe,
    /// 보낸 기기 서명이 틀리거나 보낸 기기를 모름
    Sig,
    /// 감싼 열쇠·내용이 안 열리거나 kh 가 다름
    Open,
    /// 받는 열쇠 모양이 틀림(보낼 때)
    Key,
}

fn info(room: &str, cid: &str, d: &str) -> Vec<u8> {
    format!("chammo-e2e/1\n{room}\n{cid}\n{d}").into_bytes()
}

fn content_aad(m: &Meta) -> Vec<u8> {
    format!("chammo-e2e-content/1\n{}\n{}\n{}", m.room, m.cid, m.from).into_bytes()
}

fn key_hash(k: &[u8]) -> String {
    sha_b64(&[b"chammo-e2e-key/1", k])
}

/// 서명할 글 — 봉투 목록은 기기 id 순으로
fn sig_text(m: &Meta, kh: &str, ct: &str, iv: &str, env: &[(String, String, String)]) -> String {
    let peers = m.peers.iter().map(|(a, h)| format!("{a}={h}")).collect::<Vec<_>>().join(";");
    let mut e: Vec<_> = env.iter().map(|(d, enc, w)| format!("{d},{enc},{w}")).collect();
    e.sort();
    format!("chammo-e2e/1\n{}\n{}\n{}\n{}\n{peers}\n{}\n{kh}\n{}\n{iv}\n{}", m.room, m.cid, m.from, m.head, m.roster, sha_b64(&[ct.as_bytes()]), e.join(";"))
}

fn rand<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("OS 난수");
    b
}

/// 봉하기 — 받는 기기가 하나도 없으면 Key(나 혼자 방이라도 내 다른 기기·나 자신을 넣는다)
pub fn seal(keys: &DeviceKeys, m: &Meta, inner: &Inner, to: &[Recipient]) -> Result<String, EnvErr> {
    if to.is_empty() {
        return Err(EnvErr::Key);
    }
    let k = rand::<32>();
    let iv = rand::<12>();
    let pt = serde_json::to_vec(inner).map_err(|_| EnvErr::Shape)?;
    let ct = Aes256Gcm::new(&k.into()).encrypt(Nonce::from_slice(&iv), Payload { msg: &pt, aad: &content_aad(m) }).map_err(|_| EnvErr::Open)?;
    let (ct, iv) = (B64.encode(ct), B64.encode(iv));
    let mut env = Vec::new();
    for r in to {
        let pk = B64.decode(&r.e2e).map_err(|_| EnvErr::Key)?;
        let (enc, w) = e2e_hpke::seal(&pk, &info(&m.room, &m.cid, &r.device), b"", &k).map_err(|_| EnvErr::Key)?;
        env.push((r.device.clone(), B64.encode(enc), B64.encode(w)));
    }
    let kh = key_hash(&k);
    let sig = keys.sign(&sig_text(m, &kh, &ct, &iv, &env));
    let mut out = json!({
        "v": 1, "room": m.room, "cid": m.cid, "from": m.from, "head": m.head, "peers": m.peers,
        "iv": iv, "ct": ct, "kh": kh, "env": env.iter().map(|(d, enc, w)| json!({ "d": d, "enc": enc, "w": w })).collect::<Vec<_>>(), "sig": sig,
    });
    if !m.roster.is_empty() {
        out["roster"] = json!(m.roster);
    }
    Ok(out.to_string())
}

/// 봉투 머리만 읽기(열기 전 — 누가 보냈나·어느 사슬 머리를 봤나)
pub fn peek(body: &str) -> Option<Meta> {
    let v: Value = serde_json::from_str(body).ok()?;
    if v["v"] != 1 {
        return None;
    }
    let s = |k: &str| v[k].as_str().map(String::from);
    let peers = v["peers"].as_object()?.iter().filter_map(|(a, h)| Some((a.clone(), h.as_str()?.to_string()))).collect();
    Some(Meta { room: s("room")?, cid: s("cid")?, from: s("from")?, head: s("head")?, peers, roster: s("roster").unwrap_or_default() })
}

/// 열기 — me = 이 기기 id, sender_ed = 보낸 기기의 서명 열쇠(보낸 사람 계정 사슬에서 고른 것. 모르면 None → Sig)
pub fn open(keys: &DeviceKeys, me: &str, body: &str, sender_ed: Option<&str>) -> Result<(Meta, Inner), EnvErr> {
    let v: Value = serde_json::from_str(body).map_err(|_| EnvErr::Shape)?;
    let m = peek(body).ok_or(EnvErr::Shape)?;
    let g = |k: &str| v[k].as_str().map(String::from).ok_or(EnvErr::Shape);
    let (iv, ct, kh, sig) = (g("iv")?, g("ct")?, g("kh")?, g("sig")?);
    let env: Vec<(String, String, String)> = v["env"]
        .as_array()
        .ok_or(EnvErr::Shape)?
        .iter()
        .map(|e| Some((e["d"].as_str()?.to_string(), e["enc"].as_str()?.to_string(), e["w"].as_str()?.to_string())))
        .collect::<Option<_>>()
        .ok_or(EnvErr::Shape)?;
    // 서명부터 — 서버가 머리·봉투를 바꿔치기했으면 여기서 끝
    let ed = sender_ed.ok_or(EnvErr::Sig)?;
    if !verify_sig(ed, &sig_text(&m, &kh, &ct, &iv, &env), &sig) {
        return Err(EnvErr::Sig);
    }
    let (_, enc, w) = env.iter().find(|(d, _, _)| d == me).ok_or(EnvErr::NotForMe)?;
    let dec = |s: &str| B64.decode(s).map_err(|_| EnvErr::Shape);
    let k = e2e_hpke::open(&keys.e2e_secret(), &dec(enc)?, &info(&m.room, &m.cid, me), b"", &dec(w)?).map_err(|_| EnvErr::Open)?;
    if k.len() != 32 || key_hash(&k) != kh {
        return Err(EnvErr::Open);
    }
    let iv = dec(&iv)?;
    if iv.len() != 12 {
        return Err(EnvErr::Shape);
    }
    let pt = Aes256Gcm::new_from_slice(&k).map_err(|_| EnvErr::Open)?.decrypt(Nonce::from_slice(&iv), Payload { msg: &dec(&ct)?, aad: &content_aad(&m) }).map_err(|_| EnvErr::Open)?;
    let mut inner: Inner = serde_json::from_slice(&pt).map_err(|_| EnvErr::Shape)?;
    // 사람 말은 정확히 human 일 때만(ADR 0002) — 받는 쪽은 바깥 origin 과 둘 다 볼 것
    if inner.origin != "human" {
        inner.origin = "agent".into();
    }
    Ok((m, inner))
}

#[cfg(test)]
#[path = "e2e_envelope_tests.rs"]
mod tests;
