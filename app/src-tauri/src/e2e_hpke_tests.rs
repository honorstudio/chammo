//! RFC 9180 부록 A.3.1 벡터(app/src/phone-web/hpke-vectors.json — 폰 입구 hpke.ts 도 같은 파일을 본다)
use super::*;

fn hex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn v() -> serde_json::Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/phone-web/hpke-vectors.json");
    serde_json::from_str(&std::fs::read_to_string(&path).expect("hpke-vectors.json")).unwrap()
}

fn h(v: &serde_json::Value, k: &str) -> Vec<u8> {
    hex(v[k].as_str().unwrap())
}

fn sk(b: &[u8]) -> SecretKey {
    SecretKey::from_slice(b).unwrap()
}

#[test]
fn 보내는_쪽_열쇠_만들기가_rfc_와_같다() {
    let v = v();
    let (enc, ctx) = setup_s_with(&sk(&h(&v, "skEm")), &h(&v, "pkRm"), &h(&v, "info")).unwrap();
    assert_eq!(enc, h(&v, "pkEm"));
    assert_eq!(ctx.key.to_vec(), h(&v, "key"));
    assert_eq!(ctx.base_nonce.to_vec(), h(&v, "baseNonce"));
}

#[test]
fn 공유_비밀이_rfc_와_같다() {
    let v = v();
    assert_eq!(encap_with(&sk(&h(&v, "skEm")), &h(&v, "pkRm")).unwrap().1.to_vec(), h(&v, "sharedSecret"));
    assert_eq!(decap(&sk(&h(&v, "skRm")), &h(&v, "pkEm")).unwrap().to_vec(), h(&v, "sharedSecret"));
}

#[test]
fn 번호마다_암호문이_rfc_와_같고_받는_쪽이_연다() {
    let v = v();
    let (_, mut s) = setup_s_with(&sk(&h(&v, "skEm")), &h(&v, "pkRm"), &h(&v, "info")).unwrap();
    let mut r = setup_r(&sk(&h(&v, "skRm")), &h(&v, "pkEm"), &h(&v, "info")).unwrap();
    let pt = h(&v, "pt");
    let mut seq = 0u64;
    for e in v["encryptions"].as_array().unwrap() {
        let want = e["seq"].as_u64().unwrap();
        // 번호를 건너뛴 칸은 버리고 맞춘다(RFC 벡터가 0,1,2,4,255,256 만 준다)
        while seq < want {
            s.seal(b"", b"").unwrap();
            r.seq += 1;
            seq += 1;
        }
        let aad = hex(e["aad"].as_str().unwrap());
        let ct = s.seal(&aad, &pt).unwrap();
        assert_eq!(ct, hex(e["ct"].as_str().unwrap()), "seq {want}");
        assert_eq!(r.open(&aad, &ct).unwrap(), pt, "seq {want}");
        seq += 1;
    }
}

#[test]
fn 한_번_봉하기_왕복과_틀린_열쇠·바뀐_aad·바뀐_info_는_실패() {
    let r = sk(&[7; 32]);
    let other = sk(&[9; 32]);
    let pk = r.public_key().to_encoded_point(false).as_bytes().to_vec();
    let (enc, ct) = seal(&pk, b"chammo-e2e/1 room cid dev", b"aad", b"content key 32 bytes!!!!!!!!!!!").unwrap();
    assert_eq!(enc.len(), 65);
    assert_eq!(open(&r, &enc, b"chammo-e2e/1 room cid dev", b"aad", &ct).unwrap(), b"content key 32 bytes!!!!!!!!!!!");
    assert!(open(&other, &enc, b"chammo-e2e/1 room cid dev", b"aad", &ct).is_err());
    assert!(open(&r, &enc, b"chammo-e2e/1 room cid dev", b"AAD", &ct).is_err());
    assert!(open(&r, &enc, b"chammo-e2e/1 room cid other", b"aad", &ct).is_err(), "info 에 받는 기기 id — 다른 기기 몫으로 못 옮긴다");
}

#[test]
fn 곡선_밖_점·압축_점·길이_틀린_enc_는_거절() {
    let r = sk(&[7; 32]);
    let mut bad = vec![4u8; 65];
    bad[1] = 0xff;
    assert!(decap(&r, &bad).is_err());
    let pk = r.public_key().to_encoded_point(true).as_bytes().to_vec();
    assert!(decap(&r, &pk).is_err(), "압축 점은 안 받는다(WebCrypto raw 와 같은 65바이트만)");
    assert!(decap(&r, &[4u8; 64]).is_err());
}
