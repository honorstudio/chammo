use super::*;
use crate::accounts_store::fake::Fake;

// RFC 8032 시험 1 의 비밀 열쇠 — 공개 열쇠가 표준 값과 같아야 서버(WebCrypto)와 같은 곡선·인코딩이다
const SEED: &str = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
// RFC 7748 6.1 앨리스 비밀 열쇠 → 공개 열쇠
const X_SEED: &str = "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a";

fn unhex(s: &str) -> [u8; 32] {
    let v: Vec<u8> = (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect();
    v.try_into().unwrap()
}

fn keys() -> DeviceKeys {
    DeviceKeys::from_seeds(unhex(SEED), unhex(X_SEED))
}

#[test]
fn 공개_열쇠는_표준_벡터와_같다() {
    let k = keys();
    assert_eq!(k.public(), "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo");
    // 8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a 를 base64url 로
    assert_eq!(k.dh_public(), "hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo");
}

#[test]
fn 본문_해시는_서버와_같은_base64url() {
    // chammo-relay/src/auth.ts sha256() 와 같은 입력·같은 출력(node WebCrypto 로 뽑은 값)
    let body = r#"{"name":"시험-샘플팀","deviceName":"지수-맥","displayName":"지수"}"#;
    assert_eq!(body_hash(body.as_bytes()), "bBlnNkgdfA1hDtbgv74TzcnueOlHUSV4b0UupALK8k0");
    assert_eq!(body_hash(b""), "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
}

#[test]
fn 서명할_글은_adr_0002_모양() {
    let t = signing_text("POST", "/v0/teams", "1761148800000", "AAAAAAAAAAAAAAAAAAAAAA", b"");
    assert_eq!(t, "chammo-relay/v0\nPOST\n/v0/teams\n1761148800000\nAAAAAAAAAAAAAAAAAAAAAA\n47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
}

#[test]
fn 같은_입력엔_서버_시험과_같은_서명() {
    // 서버 시험 도우미(test/helpers.ts signature)와 같은 WebCrypto 서명을 같은 열쇠로 뽑아 둔 값 — Ed25519 는 결정적이라 한 글자도 같아야 한다
    let k = keys();
    let body = r#"{"name":"시험-샘플팀","deviceName":"지수-맥","displayName":"지수"}"#;
    let s = k.sign_request("POST", "/v0/teams", body.as_bytes(), 1_761_148_800_000, "AAAAAAAAAAAAAAAAAAAAAA");
    assert_eq!(s.ts, "1761148800000");
    assert_eq!(s.nonce, "AAAAAAAAAAAAAAAAAAAAAA");
    assert_eq!(s.sig, "hkI8475h2tg_7Urt3J2lUVP91coM4ZkOIB1GYzbw0p9MaEuv6BEY3Y2Qz3E4riWJTcYpqgSt4pqlf-juQs5IBg");
    // WebSocket 은 같은 서명을 쿼리로 — 서명할 경로엔 쿼리가 안 들어간다
    let w = k.sign_request("GET", "/v0/rooms/r1/ws?device=d1", b"", 1_761_148_800_000, "BBBBBBBBBBBBBBBBBBBBBB");
    assert_eq!(w.sig, "2RyOf_XoNVFLRtGBD7EgOYgM4iryq4lallVrrh5qNpCEsJ9fgl3FKIlTQNAvzgTEtMRHobhihOfdknEsQV0oBg");
}

#[test]
fn nonce_는_서버가_받는_모양이고_매번_다르다() {
    let a = new_nonce().unwrap();
    let b = new_nonce().unwrap();
    assert_ne!(a, b);
    for n in [&a, &b] {
        assert!((16..=64).contains(&n.len()), "{n}");
        assert!(n.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'), "{n}");
    }
}

#[test]
fn 만든_열쇠는_저장소에_넣고_다시_읽힌다() {
    let st = Fake::default();
    let (k, account) = create(&st).unwrap();
    assert_eq!(account, account_of(&k.public()));
    assert!(st.val(SERVICE, &account).is_some(), "service chammo-team 칸에 들어간다");
    let back = load(&st, &account).unwrap().unwrap();
    assert_eq!(back.public(), k.public());
    assert_eq!(back.dh_public(), k.dh_public());
    // 다시 만든 열쇠는 다른 열쇠(같은 맥 두 데이터 폴더 = 두 신원)
    let (k2, a2) = create(&st).unwrap();
    assert_ne!(k2.public(), k.public());
    assert_ne!(a2, account);
}

#[test]
fn 없는_칸·깨진_칸·잠긴_저장소() {
    let st = Fake::default();
    assert!(load(&st, "dev-없음").unwrap().is_none());
    st.put(SERVICE, "dev-깨짐", "{\"v\":1,\"ed\":\"짧다\"}");
    assert!(load(&st, "dev-깨짐").is_err(), "깨진 값을 빈 것처럼 넘기면 새 열쇠로 덮어 신원을 잃는다");
    *st.locked.borrow_mut() = true;
    assert!(create(&st).is_err());
}

#[test]
fn 비밀_열쇠는_디버그_출력에_안_나온다() {
    let k = keys();
    let s = format!("{k:?}");
    assert!(s.contains(&k.public()));
    assert!(!s.contains("nWGx"), "비밀 씨앗 base64 가 찍히면 안 된다: {s}");
}

#[test]
fn 종단_암호_받는_열쇠는_터널_열쇠와_다르고_늘_같으며_묶기_서명이_맞는다() {
    use ed25519_dalek::Verifier;
    let k = keys();
    let e = k.e2e_public();
    assert_eq!(B64.decode(&e).unwrap().len(), 65);
    assert_ne!(e, k.tunnel_public(), "용도가 다른 열쇠는 라벨이 달라 갈린다");
    assert_eq!(e, keys().e2e_public(), "같은 씨앗이면 같은 열쇠");
    let vk = ed25519_dalek::VerifyingKey::from_bytes(&B64.decode(k.public()).unwrap().try_into().unwrap()).unwrap();
    let sig = ed25519_dalek::Signature::from_bytes(&B64.decode(k.e2e_key_sig()).unwrap().try_into().unwrap());
    vk.verify(format!("chammo-device-keys/1\n{}\n{}", k.public(), e).as_bytes(), &sig).unwrap();
}

#[cfg(not(windows))]
#[test]
fn 시험에선_로그인_키체인을_안_연다() {
    // 10-27 — 카드 숫자 시험이 store() 로 진짜 키체인의 chammo-team 을 읽으려 해 사용자 화면에 암호 창이 떴다
    if std::env::var("CHAMMO_TEAM_KEYCHAIN").is_ok_and(|s| !s.is_empty()) {
        return;
    }
    let k = super::store();
    let p = k.path.clone().expect("시험 store() 는 늘 키체인 파일을 가리킨다");
    assert!(!p.contains("login.keychain"), "{p}");
    assert!(!std::path::Path::new(&p).exists(), "없는 파일이라 읽기는 창 없이 실패");
}
