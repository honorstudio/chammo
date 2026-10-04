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
    let p: serde_json::Value = serde_json::from_slice(&payload("참모 업데이트 답이 필요해", &format!("첫 줄 {}\n둘째 줄 비밀", "가".repeat(100)), "session:abc")).unwrap();
    assert_eq!(p["title"], "참모 업데이트 답이 필요해");
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
