//! 패스키(Face ID 등) 나가기 시험 — 가짜 인증기(정해 둔 P-256 열쇠로 서명)로 등록·확인과 우회 경계
use super::*;
use p256::ecdsa::{signature::Signer as _, Signature, SigningKey};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

fn data(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-kpk-{tag}-{}-{}", std::process::id(), crate::mobile_pair::random_hex(4).unwrap()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

pub(crate) const RP: &str = "pad.example.com";
pub(crate) const ORIGIN: &str = "https://pad.example.com";

fn b64(b: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// 가짜 인증기 — 열쇠 하나, 서명 횟수(경로 시험도 쓴다)
pub(crate) struct Fake {
    sk: SigningKey,
    id: Vec<u8>,
    count: u32,
}

impl Fake {
    pub(crate) fn new(seed: u8) -> Fake {
        Fake { sk: SigningKey::from_bytes(&[seed; 32].into()).unwrap(), id: vec![seed, 1, 2, 3, 4, 5, 6, 7], count: 0 }
    }
    fn spki(&self) -> Vec<u8> {
        let mut v = hex_bytes("3059301306072a8648ce3d020106082a8648ce3d030107034200");
        v.extend_from_slice(self.sk.verifying_key().to_encoded_point(false).as_bytes());
        v
    }
    fn auth_data(&self, rp: &str, flags: u8) -> Vec<u8> {
        let mut a = Sha256::digest(rp.as_bytes()).to_vec();
        a.push(flags);
        a.extend_from_slice(&self.count.to_be_bytes());
        a
    }
    fn client(&self, ty: &str, challenge: &str, origin: &str) -> Vec<u8> {
        serde_json::json!({ "type": ty, "challenge": challenge, "origin": origin }).to_string().into_bytes()
    }
    pub(crate) fn register(&self, challenge: &str) -> Reg {
        Reg { id: b64(&self.id), client_data: b64(&self.client("webauthn.create", challenge, ORIGIN)), auth_data: b64(&self.auth_data(RP, 0x45)), public_key: b64(&self.spki()) }
    }
    pub(crate) fn assert(&mut self, challenge: &str, rp: &str, origin: &str, flags: u8) -> Assertion {
        self.count += 1;
        let ad = self.auth_data(rp, flags);
        let cd = self.client("webauthn.get", challenge, origin);
        let mut msg = ad.clone();
        msg.extend_from_slice(&Sha256::digest(&cd));
        let sig: Signature = self.sk.sign(&msg);
        Assertion { id: b64(&self.id), client_data: b64(&cd), auth_data: b64(&ad), signature: b64(&der(&sig)) }
    }
}

fn hex_bytes(h: &str) -> Vec<u8> {
    (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect()
}

/// ECDSA 서명 → DER(인증기가 주는 모양)
fn der(sig: &Signature) -> Vec<u8> {
    let int = |b: &[u8]| {
        let mut v: Vec<u8> = b.iter().copied().skip_while(|x| *x == 0).collect();
        if v.first().is_some_and(|x| x & 0x80 != 0) {
            v.insert(0, 0);
        }
        let mut o = vec![0x02, v.len() as u8];
        o.extend(v);
        o
    };
    let (r, s) = sig.split_bytes();
    let mut body = int(&r);
    body.extend(int(&s));
    let mut o = vec![0x30, body.len() as u8];
    o.extend(body);
    o
}

#[test]
fn register_then_leave_with_passkey() {
    let d = data("ok");
    let mut f = Fake::new(7);
    let c = challenge_in(&d, Purpose::Register, RP, 1_000).unwrap();
    register_in(&d, &f.register(&c), 1_001).unwrap();
    assert_eq!(count_in(&d), 1);
    let c = challenge_in(&d, Purpose::Leave, RP, 2_000).unwrap();
    assert_eq!(verify_in(&d, &f.assert(&c, RP, ORIGIN, 0x05), 2_001), Ok(()));
}

#[test]
fn passkey_bypass_edges() {
    let d = data("edge");
    let mut f = Fake::new(9);
    let c = challenge_in(&d, Purpose::Register, RP, 1_000).unwrap();
    register_in(&d, &f.register(&c), 1_001).unwrap();
    // 한 번 쓴 도전값은 다시 못 쓴다(되풀이 막기)
    let c = challenge_in(&d, Purpose::Leave, RP, 2_000).unwrap();
    let a = f.assert(&c, RP, ORIGIN, 0x05);
    assert_eq!(verify_in(&d, &a, 2_001), Ok(()));
    assert!(verify_in(&d, &a, 2_002).is_err(), "같은 서명 되풀이");
    // 도전값을 안 받았거나 지났으면
    let mut g = Fake::new(9);
    g.count = 50;
    assert!(verify_in(&d, &g.assert("made-up", RP, ORIGIN, 0x05), 3_000).is_err());
    let c = challenge_in(&d, Purpose::Leave, RP, 4_000).unwrap();
    assert!(verify_in(&d, &g.assert(&c, RP, ORIGIN, 0x05), 4_000 + CHALLENGE_MS + 1).is_err(), "2분 지남");
    // 다른 사이트(rpId)·다른 출처·Face ID 없이(UV 꺼짐)·다른 열쇠·등록용 도전값으로 나가기
    for (rp, origin, flags, why) in [("evil.example", ORIGIN, 0x05, "rpId"), (RP, "https://evil.example", 0x05, "출처"), (RP, ORIGIN, 0x01, "본인 확인 없음")] {
        let c = challenge_in(&d, Purpose::Leave, RP, 5_000).unwrap();
        assert!(verify_in(&d, &g.assert(&c, rp, origin, flags), 5_001).is_err(), "{why}");
    }
    let mut stranger = Fake::new(3);
    stranger.id = f.id.clone(); // 등록된 id 를 흉내 내도 열쇠가 다르면
    let c = challenge_in(&d, Purpose::Leave, RP, 6_000).unwrap();
    assert!(verify_in(&d, &stranger.assert(&c, RP, ORIGIN, 0x05), 6_001).is_err(), "다른 열쇠");
    let c = challenge_in(&d, Purpose::Register, RP, 7_000).unwrap();
    assert!(verify_in(&d, &g.assert(&c, RP, ORIGIN, 0x05), 7_001).is_err(), "등록용 도전값으론 못 나간다");
    // 서명 횟수가 뒤로 가면(복제된 인증기)
    let mut old = Fake::new(9);
    old.count = 0;
    let c = challenge_in(&d, Purpose::Leave, RP, 8_000).unwrap();
    assert!(verify_in(&d, &old.assert(&c, RP, ORIGIN, 0x05), 8_001).is_err(), "횟수 되돌림");
}

#[test]
fn register_rejects_wrong_type_challenge_or_key_shape_and_mac_can_clear() {
    let d = data("reg");
    let f = Fake::new(5);
    let c = challenge_in(&d, Purpose::Register, RP, 1_000).unwrap();
    let mut r = f.register(&c);
    r.public_key = b64(&[0u8; 91]);
    assert!(register_in(&d, &r, 1_001).is_err(), "SPKI 머리가 아니면");
    let mut r = f.register(&c);
    r.client_data = b64(&f.client("webauthn.get", &c, ORIGIN));
    assert!(register_in(&d, &r, 1_002).is_err(), "create 가 아니면");
    assert!(register_in(&d, &f.register("nope"), 1_003).is_err(), "받지 않은 도전값");
    let c = challenge_in(&d, Purpose::Register, RP, 2_000).unwrap();
    register_in(&d, &f.register(&c), 2_001).unwrap();
    clear_in(&d).unwrap();
    assert_eq!(count_in(&d), 0, "맥에서 지우면 숫자만 남는다");
}
