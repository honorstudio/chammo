//! 패스키 나가기(일곱째 조각, '되면 고르기') — 숫자 네 자리는 그대로, 아이패드가 패스키(Face ID 등)를 쓸 수 있으면 등록·확인 길을 더한다.
//! <데이터>/kids/passkey.json { creds: [{id, rp, pk(공개키 65바이트), count}], pending: [{c, purpose, rp, at}] }
//! - rpId = 패드가 연 주소의 호스트(중계면 중계 도메인) — 도전값을 받을 때 정하고, 등록한 열쇠마다 그 rp 로만 확인한다
//! - 등록은 잠긴 패드에서 부모 숫자를 맞힌 뒤에만(kids_guard::check_pin_in — 틀리면 같은 쉬기), 확인은 ES256 서명 + 도전값 1회·2분·출처·rpIdHash·UP+UV·서명 횟수
//! - 서명 DER 은 직접 푼다(p256 에 der 기능이 없다), 공개키는 getPublicKey() 의 SPKI 에서 끝 65바이트
use base64::Engine as _;
use p256::ecdsa::{signature::Verifier as _, Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// 도전값 수명
pub const CHALLENGE_MS: u64 = 120_000;
const MAX_CREDS: usize = 5;
const MAX_PENDING: usize = 8;
/// P-256 공개키 SPKI 머리(ecPublicKey + prime256v1, 비트열 머리까지)
const SPKI_HEAD: [u8; 26] = [0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00];

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Purpose {
    Register,
    Leave,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Store {
    creds: Vec<Cred>,
    pending: Vec<Pending>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Cred {
    id: String,
    rp: String,
    pk: String,
    count: u32,
}

#[derive(Serialize, Deserialize, Clone)]
struct Pending {
    c: String,
    purpose: Purpose,
    rp: String,
    at: u64,
}

/// 등록 — 패드가 navigator.credentials.create 뒤에 보낸 것(모두 base64url)
#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Reg {
    pub id: String,
    pub client_data: String,
    pub auth_data: String,
    pub public_key: String,
}

/// 확인 — navigator.credentials.get 뒤에 보낸 것
#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Assertion {
    pub id: String,
    pub client_data: String,
    pub auth_data: String,
    pub signature: String,
}

/// 읽고-고치고-쓰기 동안 잡는다 — 동시 요청 둘이 같은 도전값을 같이 읽어 둘 다 통과하지 못하게
static RW: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn file(data: &Path) -> PathBuf {
    data.join("kids").join("passkey.json")
}

fn read(data: &Path) -> Store {
    std::fs::read_to_string(file(data)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write(data: &Path, s: &Store) -> Result<(), String> {
    let f = file(data);
    std::fs::create_dir_all(f.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = f.with_file_name(format!("passkey.json.{}", crate::tools::tmp_tag()));
    std::fs::write(&tmp, serde_json::to_string(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())
}

fn unb64(s: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(s.trim_end_matches('=')).map_err(|_| "b64".to_string())
}

fn b64(b: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// rpId 모양 — 호스트 이름만(소문자·숫자·점·하이픈), IP 는 패스키가 안 된다
pub fn rp_ok(rp: &str) -> bool {
    !rp.is_empty() && rp.len() <= 253 && rp.contains('.') && !rp.bytes().all(|b| b.is_ascii_digit() || b == b'.') && rp.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
}

/// 도전값 내주기 — 지난 것은 버리고 최근 8개만
pub fn challenge_in(data: &Path, purpose: Purpose, rp: &str, now: u64) -> Result<String, String> {
    let _g = RW.lock().unwrap_or_else(|e| e.into_inner());
    if !rp_ok(rp) {
        return Err("rp".into());
    }
    let mut s = read(data);
    let c = b64(&hex_to_bytes(&crate::mobile_pair::random_hex(32).map_err(|e| e.to_string())?));
    s.pending.retain(|p| now.saturating_sub(p.at) <= CHALLENGE_MS);
    s.pending.push(Pending { c: c.clone(), purpose, rp: rp.into(), at: now });
    let over = s.pending.len().saturating_sub(MAX_PENDING);
    s.pending.drain(..over);
    write(data, &s)?;
    Ok(c)
}

fn hex_to_bytes(h: &str) -> Vec<u8> {
    (0..h.len() / 2).filter_map(|i| u8::from_str_radix(&h[i * 2..i * 2 + 2], 16).ok()).collect()
}

/// 도전값 쓰기 — 맞든 틀리든 한 번 쓰면 없어진다
fn take(s: &mut Store, c: &str, purpose: Purpose, now: u64) -> Option<Pending> {
    let i = s.pending.iter().position(|p| p.c == c)?;
    let p = s.pending.remove(i);
    (p.purpose == purpose && now.saturating_sub(p.at) <= CHALLENGE_MS).then_some(p)
}

/// clientDataJSON 확인 — 종류·도전값을 돌려준다, 출처 호스트가 rp 와 같은지는 따로
fn client(raw: &[u8], ty: &str) -> Result<(String, String), String> {
    let v: serde_json::Value = serde_json::from_slice(raw).map_err(|_| "client".to_string())?;
    if v["type"] != ty {
        return Err("type".into());
    }
    let c = v["challenge"].as_str().ok_or("challenge")?.to_string();
    let origin = v["origin"].as_str().ok_or("origin")?.to_string();
    Ok((c, origin))
}

fn origin_host_is(origin: &str, rp: &str) -> bool {
    let Some(rest) = origin.strip_prefix("https://") else { return false };
    let host = rest.split(':').next().unwrap_or("");
    host == rp
}

/// authenticatorData 앞 37바이트 — rpIdHash·UP(0x01)+UV(0x04)·서명 횟수
fn auth(ad: &[u8], rp: &str) -> Result<u32, String> {
    if ad.len() < 37 || ad[..32] != Sha256::digest(rp.as_bytes())[..] {
        return Err("rpIdHash".into());
    }
    if ad[32] & 0x05 != 0x05 {
        return Err("UP·UV".into());
    }
    Ok(u32::from_be_bytes([ad[33], ad[34], ad[35], ad[36]]))
}

/// 등록 — 부모 숫자는 부르는 쪽(kids_pad)이 먼저 본다
pub fn register_in(data: &Path, r: &Reg, now: u64) -> Result<(), String> {
    let _g = RW.lock().unwrap_or_else(|e| e.into_inner());
    let mut s = read(data);
    let cd = unb64(&r.client_data)?;
    let (c, origin) = client(&cd, "webauthn.create")?;
    let p = take(&mut s, &c, Purpose::Register, now);
    write(data, &s)?; // 도전값은 썼다
    let p = p.ok_or("challenge")?;
    if !origin_host_is(&origin, &p.rp) {
        return Err("origin".into());
    }
    let count = auth(&unb64(&r.auth_data)?, &p.rp)?;
    let spki = unb64(&r.public_key)?;
    if spki.len() != 91 || spki[..26] != SPKI_HEAD {
        return Err("key".into());
    }
    VerifyingKey::from_sec1_bytes(&spki[26..]).map_err(|_| "key".to_string())?;
    let id = r.id.trim();
    if id.is_empty() || id.len() > 512 || unb64(id).is_err() {
        return Err("id".into());
    }
    s.creds.retain(|x| x.id != id);
    s.creds.push(Cred { id: id.into(), rp: p.rp, pk: b64(&spki[26..]), count });
    let over = s.creds.len().saturating_sub(MAX_CREDS);
    s.creds.drain(..over);
    write(data, &s)
}

/// DER ECDSA 서명 → 64바이트(r‖s)
fn der_to_raw(d: &[u8]) -> Option<[u8; 64]> {
    let int = |b: &[u8]| -> Option<(Vec<u8>, usize)> {
        if b.len() < 2 || b[0] != 0x02 {
            return None;
        }
        let n = b[1] as usize;
        let v = b.get(2..2 + n)?;
        let v: Vec<u8> = v.iter().copied().skip_while(|x| *x == 0).collect();
        (v.len() <= 32).then_some((v, 2 + n))
    };
    if d.len() < 8 || d[0] != 0x30 || d[1] as usize != d.len() - 2 {
        return None;
    }
    let (r, n) = int(&d[2..])?;
    let (s, m) = int(&d[2 + n..])?;
    if 2 + n + m != d.len() {
        return None;
    }
    let mut out = [0u8; 64];
    out[32 - r.len()..32].copy_from_slice(&r);
    out[64 - s.len()..].copy_from_slice(&s);
    Some(out)
}

/// 나가기 확인 — 맞으면 서명 횟수를 올려 적는다
pub fn verify_in(data: &Path, a: &Assertion, now: u64) -> Result<(), String> {
    let _g = RW.lock().unwrap_or_else(|e| e.into_inner());
    let mut s = read(data);
    let cd = unb64(&a.client_data)?;
    let (c, origin) = client(&cd, "webauthn.get")?;
    let p = take(&mut s, &c, Purpose::Leave, now);
    write(data, &s)?;
    let p = p.ok_or("challenge")?;
    let i = s.creds.iter().position(|x| x.id == a.id && x.rp == p.rp).ok_or("cred")?;
    if !origin_host_is(&origin, &p.rp) {
        return Err("origin".into());
    }
    let ad = unb64(&a.auth_data)?;
    let count = auth(&ad, &p.rp)?;
    let cred = &s.creds[i];
    let vk = VerifyingKey::from_sec1_bytes(&unb64(&cred.pk)?).map_err(|_| "key".to_string())?;
    let raw = der_to_raw(&unb64(&a.signature)?).ok_or("sig")?;
    let sig = Signature::from_slice(&raw).map_err(|_| "sig".to_string())?;
    let sig = sig.normalize_s().unwrap_or(sig);
    let mut msg = ad.clone();
    msg.extend_from_slice(&Sha256::digest(&cd));
    vk.verify(&msg, &sig).map_err(|_| "sig".to_string())?;
    // 서명 횟수 — 둘 다 0 이면(애플 패스키는 늘 0) 안 본다, 아니면 늘어야 한다(복제 막기)
    if (count != 0 || cred.count != 0) && count <= cred.count {
        return Err("count".into());
    }
    s.creds[i].count = count;
    write(data, &s)
}

/// 등록된 열쇠 수
pub fn count_in(data: &Path) -> usize {
    read(data).creds.len()
}

/// 그 rp 로 등록된 열쇠 id(패드 allowCredentials)
pub fn ids_in(data: &Path, rp: &str) -> Vec<String> {
    read(data).creds.into_iter().filter(|c| c.rp == rp).map(|c| c.id).collect()
}

/// 맥에서 지우기 — 숫자만 남는다
pub fn clear_in(data: &Path) -> Result<(), String> {
    match std::fs::remove_file(file(data)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
#[path = "kids_passkey_tests.rs"]
pub(crate) mod tests;
