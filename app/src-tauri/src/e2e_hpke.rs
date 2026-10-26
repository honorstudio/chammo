//! 종단 암호 봉투의 열쇠 감싸기 — HPKE(RFC 9180) base 모드, DHKEM(P-256, HKDF-SHA256) / HKDF-SHA256 / AES-128-GCM
//! (chammo-relay ADR 0007 · 계획 2026-10-24 e2e-multiteam §2.3). 같은 글이 폰 입구(app/src/phone-web/hpke.ts)에 있고,
//! 두 쪽 다 RFC 부록 A.3.1 벡터(app/src/phone-web/hpke-vectors.json)로 고정한다.
//! - P-256 인 까닭: iOS 사파리는 X25519 CryptoKey 를 IndexedDB 에 못 넣는다(ADR 0013 과 같은 이유)
//! - 공개 열쇠·enc = SEC1 압축 안 한 점 65바이트(WebCrypto raw 와 같은 모양)
//! - 감싸는 것은 32바이트 내용 열쇠뿐 — AES-128 이면 P-256 의 128비트 강도와 맞는다. 본문은 봉투 쪽에서 AES-256-GCM
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes128Gcm, Nonce};
use hkdf::Hkdf;
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::{PublicKey, SecretKey};
use sha2::Sha256;

const KEM_ID: u16 = 0x0010;
const KDF_ID: u16 = 0x0001;
const AEAD_ID: u16 = 0x0001;
const N_PK: usize = 65;

#[derive(Debug, PartialEq)]
pub enum HpkeErr {
    /// 상대 공개 열쇠·enc 가 65바이트 곡선 위 점이 아님
    BadKey,
    /// 열리지 않음(열쇠·aad·info 가 다르거나 바뀐 암호문)
    Auth,
}

fn kem_suite() -> Vec<u8> {
    [b"KEM".as_slice(), &KEM_ID.to_be_bytes()].concat()
}

fn hpke_suite() -> Vec<u8> {
    [b"HPKE".as_slice(), &KEM_ID.to_be_bytes(), &KDF_ID.to_be_bytes(), &AEAD_ID.to_be_bytes()].concat()
}

/// LabeledExtract — HKDF-Extract(salt, "HPKE-v1" ‖ suite ‖ label ‖ ikm). 빈 salt 는 HKDF 규칙대로 0 32개
fn extract(suite: &[u8], salt: &[u8], label: &[u8], ikm: &[u8]) -> [u8; 32] {
    let ikm = [b"HPKE-v1".as_slice(), suite, label, ikm].concat();
    let (prk, _) = Hkdf::<Sha256>::extract(Some(salt), &ikm);
    prk.into()
}

/// LabeledExpand — HKDF-Expand(prk, I2OSP(L,2) ‖ "HPKE-v1" ‖ suite ‖ label ‖ info, L)
fn expand<const L: usize>(suite: &[u8], prk: &[u8; 32], label: &[u8], info: &[u8]) -> [u8; L] {
    let info = [(L as u16).to_be_bytes().as_slice(), b"HPKE-v1", suite, label, info].concat();
    let mut out = [0u8; L];
    Hkdf::<Sha256>::from_prk(prk).expect("32바이트 prk").expand(&info, &mut out).expect("L 은 작다");
    out
}

fn point(b: &[u8]) -> Result<PublicKey, HpkeErr> {
    if b.len() != N_PK || b[0] != 4 {
        return Err(HpkeErr::BadKey);
    }
    PublicKey::from_sec1_bytes(b).map_err(|_| HpkeErr::BadKey)
}

fn dh(me: &SecretKey, their: &PublicKey) -> [u8; 32] {
    let s = p256::ecdh::diffie_hellman(me.to_nonzero_scalar(), their.as_affine());
    let mut out = [0u8; 32];
    out.copy_from_slice(s.raw_secret_bytes());
    out
}

fn shared_secret(dh: &[u8; 32], enc: &[u8], pk_r: &[u8]) -> [u8; 32] {
    let prk = extract(&kem_suite(), b"", b"eae_prk", dh);
    expand::<32>(&kem_suite(), &prk, b"shared_secret", &[enc, pk_r].concat())
}

fn public_bytes(k: &SecretKey) -> Vec<u8> {
    k.public_key().to_encoded_point(false).as_bytes().to_vec()
}

/// Encap — 정해 준 일회용 열쇠로(시험·벡터). (enc, 공유 비밀)
pub(crate) fn encap_with(eph: &SecretKey, pk_r: &[u8]) -> Result<(Vec<u8>, [u8; 32]), HpkeErr> {
    let r = point(pk_r)?;
    let enc = public_bytes(eph);
    Ok((enc.clone(), shared_secret(&dh(eph, &r), &enc, pk_r)))
}

/// Decap — 받는 쪽 비밀 열쇠로 공유 비밀
pub(crate) fn decap(sk_r: &SecretKey, enc: &[u8]) -> Result<[u8; 32], HpkeErr> {
    let e = point(enc)?;
    Ok(shared_secret(&dh(sk_r, &e), enc, &public_bytes(sk_r)))
}

/// 열쇠 일정(base 모드: psk·psk_id 빈 글) 뒤의 상태 — 번호가 하나씩 는다
pub(crate) struct Context {
    pub(crate) key: [u8; 16],
    pub(crate) base_nonce: [u8; 12],
    pub(crate) seq: u64,
}

impl Context {
    fn new(ss: &[u8; 32], info: &[u8]) -> Self {
        let s = hpke_suite();
        let psk_id_hash = extract(&s, b"", b"psk_id_hash", b"");
        let info_hash = extract(&s, b"", b"info_hash", info);
        let ctx = [[0u8].as_slice(), &psk_id_hash, &info_hash].concat();
        let secret = extract(&s, ss, b"secret", b"");
        Context { key: expand::<16>(&s, &secret, b"key", &ctx), base_nonce: expand::<12>(&s, &secret, b"base_nonce", &ctx), seq: 0 }
    }
    fn nonce(&self) -> [u8; 12] {
        let mut n = self.base_nonce;
        for (i, b) in self.seq.to_be_bytes().iter().enumerate() {
            n[4 + i] ^= b;
        }
        n
    }
    pub(crate) fn seal(&mut self, aad: &[u8], pt: &[u8]) -> Result<Vec<u8>, HpkeErr> {
        let ct = Aes128Gcm::new(&self.key.into()).encrypt(Nonce::from_slice(&self.nonce()), Payload { msg: pt, aad }).map_err(|_| HpkeErr::Auth)?;
        self.seq += 1;
        Ok(ct)
    }
    pub(crate) fn open(&mut self, aad: &[u8], ct: &[u8]) -> Result<Vec<u8>, HpkeErr> {
        let pt = Aes128Gcm::new(&self.key.into()).decrypt(Nonce::from_slice(&self.nonce()), Payload { msg: ct, aad }).map_err(|_| HpkeErr::Auth)?;
        self.seq += 1;
        Ok(pt)
    }
}

pub(crate) fn setup_s_with(eph: &SecretKey, pk_r: &[u8], info: &[u8]) -> Result<(Vec<u8>, Context), HpkeErr> {
    let (enc, ss) = encap_with(eph, pk_r)?;
    Ok((enc, Context::new(&ss, info)))
}

pub(crate) fn setup_r(sk_r: &SecretKey, enc: &[u8], info: &[u8]) -> Result<Context, HpkeErr> {
    Ok(Context::new(&decap(sk_r, enc)?, info))
}

/// 한 번 봉하기 — 받는 기기 공개 열쇠로. (enc 65바이트, 암호문)
pub fn seal(pk_r: &[u8], info: &[u8], aad: &[u8], pt: &[u8]) -> Result<(Vec<u8>, Vec<u8>), HpkeErr> {
    // 씨앗은 getrandom 으로 직접(rand 없이 — phone_tunnel 과 같은 길). 0·차수 넘는 씨앗은 거의 없지만 다시 뽑는다
    let eph = loop {
        let mut seed = [0u8; 32];
        getrandom::fill(&mut seed).expect("OS 난수");
        if let Ok(k) = SecretKey::from_slice(&seed) {
            break k;
        }
    };
    let (enc, mut ctx) = setup_s_with(&eph, pk_r, info)?;
    Ok((enc, ctx.seal(aad, pt)?))
}

/// 한 번 열기 — 이 기기 비밀 열쇠로
pub fn open(sk_r: &SecretKey, enc: &[u8], info: &[u8], aad: &[u8], ct: &[u8]) -> Result<Vec<u8>, HpkeErr> {
    setup_r(sk_r, enc, info)?.open(aad, ct)
}

#[cfg(test)]
#[path = "e2e_hpke_tests.rs"]
mod tests;
