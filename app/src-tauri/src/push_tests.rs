use super::*;

fn b64(s: &str) -> Vec<u8> {
    URL.decode(s.replace([' ', '\n'], "")).unwrap()
}

#[test]
fn rfc8291_시험_벡터와_같은_암호문() {
    // RFC 8291 5장·부록 A — 보내는 쪽 비밀 키·salt 를 고정하면 몸통이 글자 하나까지 같아야 한다
    let as_private = b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw");
    let ua_public = b64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4");
    let auth = b64("BTBZMqHH6r4Tts7J_aSIgg");
    let salt: [u8; 16] = b64("DGv6ra1nlYgDCS1FRnbzlw").try_into().unwrap();
    let body = encrypt_with(b"When I grow up, I want to be a watermelon", &ua_public, &auth, &as_private, salt).unwrap();
    let want = b64(
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
         mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
         pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
    assert_eq!(body, want);
}

#[test]
fn 받는_쪽_키가_이상하면_암호화하지_않는다() {
    assert!(encrypt(b"x", &[4u8; 10], &[0u8; 16]).is_err());
    assert!(encrypt(b"x", &b64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"), &[0u8; 3]).is_err());
}

#[test]
fn vapid_서명은_공개키로_검증된다() {
    use p256::ecdsa::signature::Verifier;
    let v = Vapid::generate().unwrap();
    let jwt = v.jwt("https://web.push.apple.com", 1_800_000_000).unwrap();
    let parts: Vec<&str> = jwt.split('.').collect();
    assert_eq!(parts.len(), 3);
    let claims: serde_json::Value = serde_json::from_slice(&URL.decode(parts[1]).unwrap()).unwrap();
    assert_eq!(claims["aud"], "https://web.push.apple.com");
    assert_eq!(claims["exp"], 1_800_000_000u64);
    assert!(claims["sub"].as_str().unwrap().starts_with("mailto:") || claims["sub"].as_str().unwrap().starts_with("https://"));
    let key = p256::ecdsa::VerifyingKey::from_sec1_bytes(&URL.decode(v.public_b64()).unwrap()).unwrap();
    let sig = p256::ecdsa::Signature::from_slice(&URL.decode(parts[2]).unwrap()).unwrap();
    key.verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &sig).unwrap();
}

#[test]
fn vapid_키는_저장했다_다시_읽는다() {
    let v = Vapid::generate().unwrap();
    let back = Vapid::from_json(&v.to_json()).unwrap();
    assert_eq!(back.public_b64(), v.public_b64());
    assert!(Vapid::from_json("{깨진").is_none());
}

#[test]
fn 구독_주소는_알려진_푸시_서버_https_만() {
    for ok in [
        "https://web.push.apple.com/QGFb0aFKk",
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/x",
        "https://wns2-par02p.notify.windows.com/w/?token=x",
    ] {
        assert!(endpoint_ok(ok), "{ok}");
    }
    for bad in [
        "http://web.push.apple.com/x",
        "https://web.push.apple.com.evil.com/x",
        "https://evil.com/web.push.apple.com",
        "https://127.0.0.1/x",
        "https://user@web.push.apple.com/x",
        "https://web.push.apple.com:8443/x",
        "file:///etc/passwd",
        "",
    ] {
        assert!(!endpoint_ok(bad), "{bad}");
    }
    assert!(!endpoint_ok(&format!("https://web.push.apple.com/{}", "a".repeat(2000))));
}

#[test]
fn 구독은_기기마다_같은_주소면_하나() {
    let a = Sub { device: "d1".into(), endpoint: "https://web.push.apple.com/a".into(), p256dh: "k".into(), auth: "s".into(), at: 1 };
    let mut list = vec![];
    add_sub(&mut list, a.clone());
    add_sub(&mut list, Sub { at: 2, ..a.clone() });
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].at, 2);
    add_sub(&mut list, Sub { endpoint: "https://web.push.apple.com/b".into(), ..a.clone() });
    assert_eq!(list.len(), 2);
    remove_sub(&mut list, "d1", "https://web.push.apple.com/a");
    assert_eq!(list.iter().map(|s| s.endpoint.as_str()).collect::<Vec<_>>(), vec!["https://web.push.apple.com/b"]);
    // 남의 기기 구독은 못 지운다
    remove_sub(&mut list, "d2", "https://web.push.apple.com/b");
    assert_eq!(list.len(), 1);
}

#[test]
fn 끊긴_기기의_구독엔_안_보낸다() {
    let s = |d: &str| Sub { device: d.into(), endpoint: format!("https://web.push.apple.com/{d}"), p256dh: "k".into(), auth: "s".into(), at: 1 };
    let live = live_subs(&[s("d1"), s("d2")], &["d2".to_string()]);
    assert_eq!(live.iter().map(|s| s.device.as_str()).collect::<Vec<_>>(), vec!["d2"]);
}

#[test]
fn 알림_문구는_제목과_짧은_한_줄() {
    let p: serde_json::Value = serde_json::from_slice(&payload("모모 답이 필요해", &format!("첫 줄 {}\n둘째 줄 비밀", "가".repeat(100)), "session:abc")).unwrap();
    assert_eq!(p["title"], "모모 답이 필요해");
    let body = p["body"].as_str().unwrap();
    assert!(!body.contains('\n') && !body.contains("둘째"));
    assert!(body.chars().count() <= 61, "{}", body.chars().count());
    assert_eq!(p["target"], "session:abc");
}

#[test]
fn 푸시_서버_응답_404_410_이면_구독을_지운다() {
    assert!(gone(404) && gone(410));
    assert!(!gone(201) && !gone(429) && !gone(500));
}

/// 진짜 푸시 서버로 끝에서 끝까지 — 평소엔 안 돈다. E2E_DIR(키 둘 폴더)·E2E_SUB(구독 JSON 파일)를 주고
/// `cargo test push_e2e -- --ignored --nocapture`. 키가 없으면 만들고 공개 키만 찍는다(브라우저가 그 키로 구독)
#[test]
#[ignore]
fn push_e2e() {
    let dir = std::path::PathBuf::from(std::env::var("E2E_DIR").expect("E2E_DIR"));
    let v = vapid(&dir).unwrap();
    println!("PUBLIC {}", v.public_b64());
    let Ok(sub) = std::env::var("E2E_SUB") else { return };
    let j: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(sub).unwrap()).unwrap();
    let s = Sub { device: "e2e".into(), endpoint: j["endpoint"].as_str().unwrap().into(), p256dh: j["keys"]["p256dh"].as_str().unwrap().into(), auth: j["keys"]["auth"].as_str().unwrap().into(), at: 0 };
    let code = post(&v, &s, &payload("참모 시험", "웹 푸시 끝에서 끝까지", "session:e2e")).unwrap();
    println!("STATUS {code}");
    assert!((200..300).contains(&code), "{code}");
}

#[test]
fn 구독_파일을_못_읽으면_덮어쓰지_않는다() {
    // 2026-10-03 사용자 폰 구독이 '[]' 로 — 어떤 길로든 남의 구독을 빈 목록으로 덮으면 안 된다
    let d = std::env::temp_dir().join(format!("chammo-push-keep-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    let f = d.join("push-subs.json");
    std::fs::write(&f, "[{깨진").unwrap();
    let s = Sub { device: "d1".into(), endpoint: "https://web.push.apple.com/a".into(), p256dh: "k".into(), auth: "s".into(), at: 1 };
    assert!(subscribe(&d, s.clone()).is_err());
    assert!(unsubscribe(&d, "d1", "https://web.push.apple.com/a").is_err());
    assert_eq!(std::fs::read_to_string(&f).unwrap(), "[{깨진", "그대로");
    // 파일이 없으면 새로
    std::fs::remove_file(&f).unwrap();
    subscribe(&d, s.clone()).unwrap();
    assert_eq!(read_subs(&d).len(), 1);
    // 다른 기기의 해제는 이 구독을 못 지운다
    unsubscribe(&d, "d2", "https://web.push.apple.com/a").unwrap();
    assert_eq!(read_subs(&d).len(), 1);
}

#[test]
fn 마지막_알림_갈_곳은_새_것으로_덮고_나이를_준다() {
    // 중계 입구 푸시는 본문이 없어 폰이 눌린 알림의 갈 곳을 모른다 — 컴퓨터가 마지막 알림 갈 곳을 들고 있다가 알려 준다(2026-10-23)
    let d = std::env::temp_dir().join(format!("chammo-push-last-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    assert_eq!(last_target(&d, 1_000), serde_json::json!({ "target": "", "age": null }));
    keep_last(&d, "card:o1:w:t1", 1_000);
    assert_eq!(last_target(&d, 61_000), serde_json::json!({ "target": "card:o1:w:t1", "age": 60 }));
    // 갈 곳 없는 알림(참모가 부른 푸시)도 덮는다 — 그보다 옛 알림의 갈 곳으로 엉뚱하게 가지 않게
    keep_last(&d, "", 70_000);
    assert_eq!(last_target(&d, 70_000)["target"], "");
    let _ = std::fs::remove_dir_all(&d);
}

// ── 중계 길 폰에 본문 싣기(2026-11-01 사용자 제보 — 잠금 화면에 '새 메시지'만, ADR 0013 결정 7 갱신) ──

/// 폰(받는 쪽)이 하는 풀기 — RFC 8291 그대로. 시험에서만
fn decrypt_as_phone(body: &[u8], ua_private: &[u8], auth: &[u8]) -> Vec<u8> {
    let salt = &body[..16];
    let idlen = body[20] as usize;
    let as_pub = PublicKey::from_sec1_bytes(&body[21..21 + idlen]).unwrap();
    let ct = &body[21 + idlen..];
    let me = SecretKey::from_slice(ua_private).unwrap();
    let ua_raw = me.public_key().to_encoded_point(false);
    let shared = p256::ecdh::diffie_hellman(me.to_nonzero_scalar(), as_pub.as_affine());
    let mut key_info = b"WebPush: info\0".to_vec();
    key_info.extend_from_slice(ua_raw.as_bytes());
    key_info.extend_from_slice(as_pub.to_encoded_point(false).as_bytes());
    let ikm: [u8; 32] = expand(&Hkdf::<Sha256>::new(Some(auth), shared.raw_secret_bytes()), &key_info).unwrap();
    let prk = Hkdf::<Sha256>::new(Some(salt), &ikm);
    let cek: [u8; 16] = expand(&prk, b"Content-Encoding: aes128gcm\0").unwrap();
    let nonce: [u8; 12] = expand(&prk, b"Content-Encoding: nonce\0").unwrap();
    let mut rec = Aes128Gcm::new_from_slice(&cek).unwrap().decrypt(Nonce::from_slice(&nonce), ct).unwrap();
    assert_eq!(rec.pop(), Some(2));
    rec
}

fn phone_sub(device: &str, at: u64) -> (Sub, Vec<u8>, Vec<u8>) {
    let ua = SecretKey::from_slice(&[7u8; 32]).unwrap();
    let auth = vec![9u8; 16];
    let s = Sub { device: device.into(), endpoint: format!("https://fcm.googleapis.com/fcm/send/{device}-{at}"), p256dh: URL.encode(ua.public_key().to_encoded_point(false).as_bytes()), auth: URL.encode(&auth), at };
    (s, ua.to_bytes().to_vec(), auth)
}

#[test]
fn 중계_폰엔_구독_열쇠로_봉한_본문과_구독_주소_해시를_싣는다() {
    let (s, ua_private, auth) = phone_sub("ph01", 5);
    let msg = payload("참모 답", "빌드 끝났어", "session:abc");
    let v = relay_notify_body("relay-dev-1", Some(&s), &msg);
    assert_eq!(v["to"], "relay-dev-1");
    let body = URL.decode(v["body"].as_str().expect("본문 암호문")).unwrap();
    assert_eq!(decrypt_as_phone(&body, &ua_private, &auth), msg);
    // 중계는 자기가 가진 구독 주소의 해시와 같을 때만 싣는다 — 폰이 다시 구독해 열쇠가 바뀌었으면 '새 메시지'로
    let h = URL.encode(<Sha256 as sha2::Digest>::digest(s.endpoint.as_bytes()));
    assert_eq!(v["sub"], h.as_str());
    // 평문 글자는 부탁 어디에도 없다
    assert!(!v.to_string().contains("빌드"));
}

#[test]
fn 구독_열쇠를_모르면_지금처럼_본문_없이() {
    let v = relay_notify_body("relay-dev-1", None, b"{}");
    assert_eq!(v, serde_json::json!({ "to": "relay-dev-1" }));
    let (mut s, _, _) = phone_sub("ph01", 5);
    s.p256dh = "망가진".into();
    assert_eq!(relay_notify_body("relay-dev-1", Some(&s), b"{}"), serde_json::json!({ "to": "relay-dev-1" }));
}

#[test]
fn 중계_폰은_가장_최근_구독을_쓰고_맥_열쇠로_직접_보내지_않는다() {
    let (old, _, _) = phone_sub("ph01", 1);
    let (new, _, _) = phone_sub("ph01", 9);
    let (tail, _, _) = phone_sub("tail1", 3);
    let list = vec![old, new.clone(), tail.clone()];
    assert_eq!(latest_sub(&list, "ph01"), Some(&new));
    assert_eq!(latest_sub(&list, "nope"), None);
    // 중계 폰(ph01)의 구독은 중계 VAPID 로 걸린 것 — 맥 VAPID 로 보내면 푸시 서버가 403
    let direct = direct_subs(&list, &["ph01".to_string(), "tail1".to_string()], &["ph01".to_string()]);
    assert_eq!(direct, vec![tail]);
}

#[test]
fn 잠금_화면_한_줄의_비밀번호는_가린다() {
    let p: serde_json::Value = serde_json::from_slice(&payload("참모 답", "비밀번호: hunter2xyz 로 로그인했어", "")).unwrap();
    let body = p["body"].as_str().unwrap();
    assert!(!body.contains("hunter2xyz"), "{body}");
    assert!(body.contains(crate::messenger_text::HIDDEN), "{body}");
    let p: serde_json::Value = serde_json::from_slice(&payload(&format!("키 {}{}", "sk-", "ant-api03-abcdefghijklmnopqrstuvwxyz0123"), "ok", "")).unwrap();
    assert!(!p["title"].as_str().unwrap().contains("abcdefghij"), "{}", p["title"]);
}

#[test]
fn 중계_본문은_중계_상한_안에_들어간다() {
    // 제목 80자·한 줄 60자를 다 채운 한글 + 긴 갈 곳 — 중계 PUSH_BODY_MAX(2048 바이트) 안
    let (s, _, _) = phone_sub("ph01", 5);
    let msg = payload(&"가".repeat(200), &"나".repeat(200), &format!("session:{}", "a".repeat(80)));
    let v = relay_notify_body("r", Some(&s), &msg);
    let n = URL.decode(v["body"].as_str().unwrap()).unwrap().len();
    assert!(n <= RELAY_BODY_MAX, "{n}");
}

/// 중계 시험 벡터 — 이 컴퓨터가 만든 진짜 부탁(본문 암호문·구독 해시)과 폰 열쇠(JWK)를 E2E_OUT 에 쓴다.
/// 중계 저장소 test/push-body-vectors.json 이 이걸로 만든 것 — 중계가 바이트 그대로 싣고 WebCrypto 로 풀리는지 본다.
/// `E2E_OUT=… cargo test relay_body_vectors -- --ignored`
#[test]
#[ignore]
fn relay_body_vectors() {
    let out = std::env::var("E2E_OUT").expect("E2E_OUT");
    let ua = SecretKey::from_slice(&rand::<32>().unwrap()).unwrap();
    let pt = ua.public_key().to_encoded_point(false);
    let auth = rand::<16>().unwrap();
    let endpoint = "https://web.push.apple.com/vectors/relay-body";
    let s = Sub { device: "ph01".into(), endpoint: endpoint.into(), p256dh: URL.encode(pt.as_bytes()), auth: URL.encode(auth), at: 1 };
    let msg = payload("모모 — 답이 왔어", "빌드 끝났어, 비밀번호: hunter2xyz 는 가려져", "session:vector");
    let ask = relay_notify_body("PHONE", Some(&s), &msg);
    let v = serde_json::json!({
        "endpoint": endpoint,
        "jwk": { "kty": "EC", "crv": "P-256", "d": URL.encode(ua.to_bytes()), "x": URL.encode(pt.x().unwrap()), "y": URL.encode(pt.y().unwrap()) },
        "auth": URL.encode(auth),
        "ask": ask,
        "plain": String::from_utf8(msg).unwrap(),
    });
    std::fs::write(out, serde_json::to_string_pretty(&v).unwrap()).unwrap();
}
