//! 폰 ↔ 컴퓨터 터널 암호 (ADR 0013) — 표준 조각만: ECDH P-256 · HKDF-SHA256 · AES-256-GCM. 같은 글이 폰 입구(app/src/phone-web/tunnel.ts)에 있다.
//! P-256 인 까닭: iOS 사파리는 X25519 CryptoKey 를 IndexedDB 에 못 넣는다(오류 없이 null 로 읽힘, 2026-10-23 시뮬레이터 실측) — 꺼낼 수 없는 폰 열쇠를 지키려면 P-256
//! - 공개 열쇠 = SEC1 압축 안 한 점 65바이트(WebCrypto raw 와 같은 모양)
//! - 봉하기(seal): 짝짓기 두드리기 상자. 받는 쪽 공개 열쇠로 — 일회용 열쇠(65) ‖ iv(12) ‖ 암호문
//! - 세션: 폰 hello{pk, n} → 컴퓨터 hello{n, c}. 열쇠 = HKDF(salt = 표식 ‖ nP ‖ nM, 정적 X25519 합의), 방향마다 따로.
//!   틀 = 2 ‖ 번호(8, 큰 끝) ‖ 암호문. 번호는 1씩만 늘어난다(되감기·건너뛰기·바꿔치기는 틀린 틀). c = 컴퓨터→폰 번호 0 의 "chammo-ok"
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use hkdf::Hkdf;
use sha2::Sha256;
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::{PublicKey, SecretKey};

const SEAL_INFO: &[u8] = b"chammo-seal/v1";
const TUNNEL_SALT: &[u8] = b"chammo-tunnel/v1";
const P2M: &[u8] = b"phone->mac";
const M2P: &[u8] = b"mac->phone";
pub const CONFIRM: &[u8] = b"chammo-ok";
pub const HELLO: u8 = 1;
pub const DATA: u8 = 2;
/// hello 의 난수 길이
pub const NONCE_LEN: usize = 16;
/// 공개 열쇠 길이(SEC1 압축 안 한 점)
pub const PUB_LEN: usize = 65;

#[derive(Debug, PartialEq)]
pub enum TunnelErr {
    /// 모양이 틀림(길이·종류·base64·JSON)
    Shape,
    /// 상대 열쇠가 작은 차수 점(합의가 0)
    BadKey,
    /// 복호가 안 됨(열쇠가 다르거나 바뀐 틀)
    Auth,
    /// 번호가 차례가 아님(되감기·건너뛰기)
    Order,
}

fn rand<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("OS 난수");
    b
}

/// 32바이트 씨앗 → 비밀 열쇠(0 이거나 차수 넘으면 None — 거의 없다)
pub fn secret_from_seed(seed: &[u8; 32]) -> Option<SecretKey> {
    SecretKey::from_slice(seed).ok()
}

pub fn public_of(k: &SecretKey) -> Vec<u8> {
    k.public_key().to_encoded_point(false).as_bytes().to_vec()
}

/// ECDH P-256 — 상대 열쇠가 곡선 위 점이 아니면(모양·무한 원점) 거절
pub fn agree(me: &SecretKey, their: &[u8]) -> Result<[u8; 32], TunnelErr> {
    if their.len() != PUB_LEN || their[0] != 4 {
        return Err(TunnelErr::BadKey);
    }
    let pk = PublicKey::from_sec1_bytes(their).map_err(|_| TunnelErr::BadKey)?;
    let shared = p256::ecdh::diffie_hellman(me.to_nonzero_scalar(), pk.as_affine());
    let mut out = [0u8; 32];
    out.copy_from_slice(shared.raw_secret_bytes());
    Ok(out)
}

fn seal_key(shared: &[u8; 32], eph: &[u8], to: &[u8]) -> Aes256Gcm {
    let salt = [eph, to].concat();
    let mut k = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&salt), shared).expand(SEAL_INFO, &mut k).expect("32 바이트");
    Aes256Gcm::new(&k.into())
}

/// 받는 쪽 공개 열쇠로 봉한다
pub fn seal(to: &[u8], pt: &[u8]) -> Result<Vec<u8>, TunnelErr> {
    loop {
        let seed = rand::<32>();
        if secret_from_seed(&seed).is_some() {
            return seal_with(&seed, &rand::<12>(), to, pt);
        }
    }
}

/// 시험 값용 — 일회용 열쇠 씨앗·iv 를 받는다
pub fn seal_with(eph_seed: &[u8; 32], iv: &[u8; 12], to: &[u8], pt: &[u8]) -> Result<Vec<u8>, TunnelErr> {
    let eph = secret_from_seed(eph_seed).ok_or(TunnelErr::Shape)?;
    let eph_pub = public_of(&eph);
    let shared = agree(&eph, to)?;
    let ct = seal_key(&shared, &eph_pub, to).encrypt(Nonce::from_slice(iv), Payload { msg: pt, aad: SEAL_INFO }).map_err(|_| TunnelErr::Shape)?;
    Ok([eph_pub.as_slice(), iv.as_slice(), &ct].concat())
}

/// 내 열쇠로 연다. agree_me = 내 비밀 열쇠로의 합의(컴퓨터는 키체인 열쇠에서 나온 터널 열쇠, DeviceKeys::tunnel_agree)
pub fn open(me_pub: &[u8], agree_me: impl Fn(&[u8]) -> Option<[u8; 32]>, sealed: &[u8]) -> Result<Vec<u8>, TunnelErr> {
    if sealed.len() < PUB_LEN + 12 + 16 {
        return Err(TunnelErr::Shape);
    }
    let eph = &sealed[..PUB_LEN];
    let shared = agree_me(eph).ok_or(TunnelErr::BadKey)?;
    seal_key(&shared, eph, me_pub).decrypt(Nonce::from_slice(&sealed[PUB_LEN..PUB_LEN + 12]), Payload { msg: &sealed[PUB_LEN + 12..], aad: SEAL_INFO }).map_err(|_| TunnelErr::Auth)
}

pub fn b64(b: &[u8]) -> String {
    B64.encode(b)
}

pub fn unb64(s: &str) -> Result<Vec<u8>, TunnelErr> {
    B64.decode(s).map_err(|_| TunnelErr::Shape)
}

/// base64url 공개 열쇠(65바이트 압축 안 한 점)
pub fn pubkey(s: &str) -> Result<Vec<u8>, TunnelErr> {
    let k = unb64(s)?;
    if k.len() == PUB_LEN && k[0] == 4 && PublicKey::from_sec1_bytes(&k).is_ok() { Ok(k) } else { Err(TunnelErr::Shape) }
}

/// 한 연결의 열쇠 둘과 번호
pub struct Session {
    send: Aes256Gcm,
    recv: Aes256Gcm,
    send_ctr: u64,
    recv_ctr: u64,
}

/// 폰 hello — {v:1, pk, n}
pub struct PhoneHello {
    pub pk: Vec<u8>,
    pub n: Vec<u8>,
}

pub fn parse_hello(frame: &[u8]) -> Result<PhoneHello, TunnelErr> {
    let (&t, rest) = frame.split_first().ok_or(TunnelErr::Shape)?;
    if t != HELLO {
        return Err(TunnelErr::Shape);
    }
    let v: serde_json::Value = serde_json::from_slice(rest).map_err(|_| TunnelErr::Shape)?;
    if v["v"] != 1 {
        return Err(TunnelErr::Shape);
    }
    let pk = pubkey(v["pk"].as_str().ok_or(TunnelErr::Shape)?)?;
    let n = unb64(v["n"].as_str().ok_or(TunnelErr::Shape)?)?;
    if n.len() != NONCE_LEN {
        return Err(TunnelErr::Shape);
    }
    Ok(PhoneHello { pk, n })
}

fn keys(shared: &[u8; 32], n_p: &[u8], n_m: &[u8]) -> (Aes256Gcm, Aes256Gcm) {
    let salt = [TUNNEL_SALT, n_p, n_m].concat();
    let h = Hkdf::<Sha256>::new(Some(&salt), shared);
    let (mut a, mut b) = ([0u8; 32], [0u8; 32]);
    h.expand(P2M, &mut a).expect("32");
    h.expand(M2P, &mut b).expect("32");
    (Aes256Gcm::new(&a.into()), Aes256Gcm::new(&b.into()))
}

fn nonce(ctr: u64) -> [u8; 12] {
    let mut n = [0u8; 12];
    n[4..].copy_from_slice(&ctr.to_be_bytes());
    n
}

impl Session {
    /// 컴퓨터 쪽 — 폰 hello 를 받아 세션과 답 hello 를 만든다. shared = 컴퓨터 정적 열쇠 ↔ 폰 정적 열쇠(짝지을 때 받은 것) 합의
    pub fn accept(shared: &[u8; 32], hello: &PhoneHello) -> (Session, Vec<u8>) {
        Self::accept_with(shared, hello, &rand::<NONCE_LEN>())
    }

    pub fn accept_with(shared: &[u8; 32], hello: &PhoneHello, n_m: &[u8]) -> (Session, Vec<u8>) {
        let (p2m, m2p) = keys(shared, &hello.n, n_m);
        let mut s = Session { send: m2p, recv: p2m, send_ctr: 0, recv_ctr: 0 };
        let c = s.seal_at(0, CONFIRM);
        s.send_ctr = 1;
        let body = serde_json::json!({ "v": 1, "n": b64(n_m), "c": b64(&c) });
        (s, [vec![HELLO], body.to_string().into_bytes()].concat())
    }

    /// 폰 쪽(시험·다른 기기 흉내) — 컴퓨터 답 hello 를 확인하고 세션을 연다
    pub fn connect(shared: &[u8; 32], n_p: &[u8], reply: &[u8]) -> Result<Session, TunnelErr> {
        let (&t, rest) = reply.split_first().ok_or(TunnelErr::Shape)?;
        if t != HELLO {
            return Err(TunnelErr::Shape);
        }
        let v: serde_json::Value = serde_json::from_slice(rest).map_err(|_| TunnelErr::Shape)?;
        let n_m = unb64(v["n"].as_str().ok_or(TunnelErr::Shape)?)?;
        let (p2m, m2p) = keys(shared, n_p, &n_m);
        let mut s = Session { send: p2m, recv: m2p, send_ctr: 1, recv_ctr: u64::MAX };
        if s.open(&unb64(v["c"].as_str().ok_or(TunnelErr::Shape)?)?)? != CONFIRM {
            return Err(TunnelErr::Auth);
        }
        Ok(s)
    }

    fn seal_at(&self, ctr: u64, pt: &[u8]) -> Vec<u8> {
        let mut head = vec![DATA];
        head.extend_from_slice(&ctr.to_be_bytes());
        let ct = self.send.encrypt(Nonce::from_slice(&nonce(ctr)), Payload { msg: pt, aad: &head }).expect("AES-GCM 봉하기");
        [head, ct].concat()
    }

    pub fn seal(&mut self, pt: &[u8]) -> Vec<u8> {
        let f = self.seal_at(self.send_ctr, pt);
        self.send_ctr += 1;
        f
    }

    /// 다음 차례 틀만 연다 — 받는 번호는 앞 번호 + 1(첫 틀은 1, 폰이 받는 첫 틀은 확인용 0)
    pub fn open(&mut self, frame: &[u8]) -> Result<Vec<u8>, TunnelErr> {
        if frame.len() < 9 + 16 || frame[0] != DATA {
            return Err(TunnelErr::Shape);
        }
        let ctr = u64::from_be_bytes(frame[1..9].try_into().map_err(|_| TunnelErr::Shape)?);
        if ctr != self.recv_ctr.wrapping_add(1) {
            return Err(TunnelErr::Order);
        }
        let pt = self.recv.decrypt(Nonce::from_slice(&nonce(ctr)), Payload { msg: &frame[9..], aad: &frame[..9] }).map_err(|_| TunnelErr::Auth)?;
        self.recv_ctr = ctr;
        Ok(pt)
    }
}

#[cfg(test)]
#[path = "phone_tunnel_tests.rs"]
mod tests;
