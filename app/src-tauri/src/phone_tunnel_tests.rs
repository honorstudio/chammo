use super::*;

fn sk(b: u8) -> SecretKey {
    secret_from_seed(&[b; 32]).unwrap()
}

fn pair() -> (SecretKey, Vec<u8>, SecretKey, Vec<u8>) {
    let (m, p) = (sk(7), sk(9));
    let (mp, pp) = (public_of(&m), public_of(&p));
    (m, mp, p, pp)
}

fn hello(pk: &[u8], n: &[u8]) -> Vec<u8> {
    [vec![HELLO], serde_json::json!({ "v": 1, "pk": b64(pk), "n": b64(n) }).to_string().into_bytes()].concat()
}

/// 컴퓨터·폰 세션 한 쌍
fn sessions() -> (Session, Session) {
    let (m, _mp, p, pp) = pair();
    let n_p = [1u8; NONCE_LEN];
    let h = parse_hello(&hello(&pp, &n_p)).unwrap();
    let shared_m = agree(&m, &h.pk).unwrap();
    let (mac, reply) = Session::accept(&shared_m, &h);
    let shared_p = agree(&p, &public_of(&m)).unwrap();
    let phone = Session::connect(&shared_p, &n_p, &reply).unwrap();
    (mac, phone)
}

#[test]
fn seal_open_roundtrip_and_wrong_key() {
    let (m, mp, _p, _pp) = pair();
    let boxed = seal(&mp, b"code").unwrap();
    assert_eq!(open(&mp, |e| agree(&m, e).ok(), &boxed).unwrap(), b"code");
    let other = sk(3);
    assert_eq!(open(&mp, |e| agree(&other, e).ok(), &boxed), Err(TunnelErr::Auth));
    let mut bad = boxed.clone();
    *bad.last_mut().unwrap() ^= 1;
    assert_eq!(open(&mp, |e| agree(&m, e).ok(), &bad), Err(TunnelErr::Auth));
    assert_eq!(open(&mp, |e| agree(&m, e).ok(), &boxed[..40]), Err(TunnelErr::Shape));
}

#[test]
fn bad_points_are_refused() {
    // 곡선 위 점이 아니거나 압축 모양·길이가 다르면 합의하지 않는다
    let (m, mp, _, _) = pair();
    let mut off = mp.clone();
    off[64] ^= 1;
    for bad in [vec![0u8; 65], off, mp[..33].to_vec(), [vec![2u8], mp[1..33].to_vec()].concat()] {
        assert_eq!(seal(&bad, b"x"), Err(TunnelErr::BadKey));
        assert_eq!(agree(&m, &bad), Err(TunnelErr::BadKey));
    }
    assert!(pubkey(&b64(&mp)).is_ok());
    assert!(pubkey(&b64(&[4u8; 65])).is_err());
}

#[test]
fn session_both_ways_in_order() {
    let (mut mac, mut phone) = sessions();
    let f = phone.seal(b"GET /api/env");
    assert_eq!(mac.open(&f).unwrap(), b"GET /api/env");
    let r = mac.seal(b"200");
    assert_eq!(phone.open(&r).unwrap(), b"200");
    let f2 = phone.seal(b"two");
    assert_eq!(mac.open(&f2).unwrap(), b"two");
}

#[test]
fn replay_skip_and_tamper_are_refused() {
    let (mut mac, mut phone) = sessions();
    let f1 = phone.seal(b"a");
    let f2 = phone.seal(b"b");
    assert_eq!(mac.open(&f2), Err(TunnelErr::Order)); // 건너뛰기
    assert_eq!(mac.open(&f1).unwrap(), b"a");
    assert_eq!(mac.open(&f1), Err(TunnelErr::Order)); // 되감기
    let mut t = f2.clone();
    t[3] ^= 1; // 번호 칸을 바꿔도 aad 라 복호 실패
    assert!(mac.open(&t).is_err());
    let mut t = f2.clone();
    *t.last_mut().unwrap() ^= 1;
    assert_eq!(mac.open(&t), Err(TunnelErr::Auth));
    assert_eq!(mac.open(&f2).unwrap(), b"b"); // 틀린 틀은 번호를 안 올린다
    // 자기 방향 틀을 되돌려 보내도 못 연다(방향 열쇠가 다르다)
    let mine = mac.seal(b"x");
    assert_eq!(mac.open(&mine), Err(TunnelErr::Order));
}

#[test]
fn wrong_mac_key_fails_confirm() {
    let (m, _mp, p, pp) = pair();
    let n_p = [2u8; NONCE_LEN];
    let h = parse_hello(&hello(&pp, &n_p)).unwrap();
    let (_mac, reply) = Session::accept(&agree(&m, &h.pk).unwrap(), &h);
    // 폰이 QR 로 받은 컴퓨터 열쇠가 다르면(중계가 바꿔치기) 확인이 안 풀린다
    let wrong = agree(&p, &public_of(&sk(5))).unwrap();
    assert_eq!(Session::connect(&wrong, &n_p, &reply).err(), Some(TunnelErr::Auth));
}

#[test]
fn hello_shape() {
    let (_, _, _, pp) = pair();
    assert!(parse_hello(&hello(&pp, &[0u8; NONCE_LEN])).is_ok());
    assert_eq!(parse_hello(&hello(&pp, &[0u8; 8])).err(), Some(TunnelErr::Shape));
    assert_eq!(parse_hello(b"\x02{}").err(), Some(TunnelErr::Shape));
    assert_eq!(parse_hello(b"").err(), Some(TunnelErr::Shape));
    assert_eq!(parse_hello(&[vec![HELLO], br#"{"v":2,"pk":"","n":""}"#.to_vec()].concat()).err(), Some(TunnelErr::Shape));
}

/// 폰 입구(app/src/phone-web/tunnel.ts)와 같은 값이 나오는지 — 고정 씨앗으로 만든 값을 파일에 두고 두 쪽이 같이 본다.
/// 값을 새로 쓰려면 CHAMMO_WRITE_VECTORS=1 cargo test phone_tunnel
#[test]
fn vectors_match_phone_web() {
    let (m, mp, p, pp) = pair();
    let sealed = seal_with(&[11u8; 32], &[12u8; 12], &mp, b"{\"code\":\"abc\"}").unwrap();
    let n_p = [13u8; NONCE_LEN];
    let n_m = [14u8; NONCE_LEN];
    let h = parse_hello(&hello(&pp, &n_p)).unwrap();
    let (mut mac, reply) = Session::accept_with(&agree(&m, &h.pk).unwrap(), &h, &n_m);
    let m2p = mac.seal(b"{\"id\":1}");
    let mut phone = Session::connect(&agree(&p, &mp).unwrap(), &n_p, &reply).unwrap();
    let p2m = phone.seal(b"{\"id\":2}");
    let v = serde_json::json!({
        "macSeed": b64(&[7u8; 32]), "phoneSeed": b64(&[9u8; 32]), "macPub": b64(&mp), "phonePub": b64(&pp),
        "seal": { "ephSeed": b64(&[11u8; 32]), "iv": b64(&[12u8; 12]), "pt": "{\"code\":\"abc\"}", "out": b64(&sealed) },
        "tunnel": { "nP": b64(&n_p), "nM": b64(&n_m), "reply": b64(&reply), "m2p": b64(&m2p), "m2pPt": "{\"id\":1}", "p2m": b64(&p2m), "p2mPt": "{\"id\":2}" },
    });
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/phone-web/tunnel-vectors.json");
    if std::env::var("CHAMMO_WRITE_VECTORS").is_ok() {
        std::fs::write(&path, serde_json::to_string_pretty(&v).unwrap() + "\n").unwrap();
    }
    let want: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).expect("tunnel-vectors.json")).unwrap();
    assert_eq!(v, want);
    assert_eq!(mac.open(&p2m).unwrap(), b"{\"id\":2}");
}
