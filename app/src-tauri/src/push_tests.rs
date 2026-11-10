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
    let a = Sub { device: "d1".into(), endpoint: "https://web.push.apple.com/a".into(), p256dh: "k".into(), auth: "s".into(), at: 1, replaces: vec![] };
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
    let s = |d: &str| Sub { device: d.into(), endpoint: format!("https://web.push.apple.com/{d}"), p256dh: "k".into(), auth: "s".into(), at: 1, replaces: vec![] };
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
    let s = Sub { device: "e2e".into(), endpoint: j["endpoint"].as_str().unwrap().into(), p256dh: j["keys"]["p256dh"].as_str().unwrap().into(), auth: j["keys"]["auth"].as_str().unwrap().into(), at: 0, replaces: vec![] };
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
    let s = Sub { device: "d1".into(), endpoint: "https://web.push.apple.com/a".into(), p256dh: "k".into(), auth: "s".into(), at: 1, replaces: vec![] };
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
    let s = Sub { device: device.into(), endpoint: format!("https://fcm.googleapis.com/fcm/send/{device}-{at}"), p256dh: URL.encode(ua.public_key().to_encoded_point(false).as_bytes()), auth: URL.encode(&auth), at, replaces: vec![] };
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
    let p = plan(&list, &["ph01".to_string(), "tail1".to_string(), "nope".to_string()], &["ph01".to_string(), "nope".to_string()]);
    assert_eq!(p.relay, vec![("ph01".to_string(), Some(new)), ("nope".to_string(), None)]);
    // 중계 폰(ph01)의 구독은 중계 VAPID 로 걸린 것 — 맥 VAPID 로 보내면 푸시 서버가 403
    assert_eq!(p.direct, vec![tail]);
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
    let s = Sub { device: "ph01".into(), endpoint: endpoint.into(), p256dh: URL.encode(pt.as_bytes()), auth: URL.encode(auth), at: 1, replaces: vec![] };
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

#[test]
fn 중계_푸시_답에서_본문이_빠졌으면_기록할_한_줄을_만든다() {
    let sealed = serde_json::json!({ "to": "bbbb1111-d8d3-4", "body": "x", "sub": "y" });
    let bare = serde_json::json!({ "to": "bbbb1111-d8d3-4" });
    let ok = |sent: bool, s: bool| serde_json::json!({ "sent": sent, "sealed": s });
    // 정상: 봉해서 실렸다·간격 안이라 안 보냄 — 기록 없음
    assert_eq!(notify_note(&sealed, 202, &ok(true, true)), None);
    assert_eq!(notify_note(&sealed, 202, &ok(false, false)), None);
    // 중계가 본문을 뺐다(11-04 계정 폰이 이랬다)
    assert_eq!(notify_note(&sealed, 202, &ok(true, false)).as_deref(), Some("폰 bbbb1111 에 본문 없이 감 — 중계가 뺐어(구독이 바뀜·폰 아닌 기기)"));
    // 맥이 구독 열쇠를 몰라 봉하지 못했다
    assert_eq!(notify_note(&bare, 202, &ok(true, false)).as_deref(), Some("폰 bbbb1111 에 본문 없이 감 — 이 컴퓨터가 그 폰 구독 열쇠를 몰라"));
    // 끊긴 기기·다른 오류
    assert_eq!(notify_note(&bare, 404, &serde_json::json!({ "error": "device_not_found" })).as_deref(), Some("폰 bbbb1111 이 중계에 없어(끊긴 기기) — 푸시 못 보냄"));
    assert_eq!(notify_note(&bare, 429, &serde_json::json!({ "error": "slow_down" })).as_deref(), Some("폰 bbbb1111 푸시 부탁 429"));
    // 받는 기기 id 에 이상한 글자가 있어도 기록엔 영숫자 8자까지만
    assert_eq!(notify_note(&serde_json::json!({ "to": "\n[가짜]ab" }), 404, &serde_json::Value::Null).as_deref(), Some("폰 ab 이 중계에 없어(끊긴 기기) — 푸시 못 보냄"));
}

// ── 같은 폰 앱을 다시 짝지었을 때(2026-11-09 사용자 폰 알림 두 번) ─────────────
// 실측: 같은 아이폰이 11-07(1c2e…)·11-09 11:08(fbf7…) 두 번 짝지어 두 기기 줄이 됐고, 홈 화면 앱의 구독 주소는 하나라
// push-subs.json 에 같은 주소가 두 기기 이름으로 들어갔다. 알림 한 번에 중계 부탁이 두 기기로 나가 같은 주소에 두 번 닿았다
// (중계 push_subs last_at 둘 다 23:43:46·47).

fn ep(tag: &str) -> String {
    format!("https://web.push.apple.com/{tag}")
}
fn sub(device: &str, endpoint: &str, at: u64) -> Sub {
    Sub { device: device.into(), endpoint: endpoint.into(), p256dh: format!("k-{device}-{at}"), auth: format!("a-{device}-{at}"), at, replaces: vec![] }
}
fn ids(v: &[String]) -> Vec<String> {
    v.to_vec()
}
fn relay_to(p: &Plan) -> Vec<&str> {
    p.relay.iter().map(|(d, _)| d.as_str()).collect()
}

#[test]
fn 같은_주소를_다른_기기가_구독하면_하나로_합치고_옛_기기를_적는다() {
    let mut list = vec![sub("old", &ep("same"), 1), sub("other", &ep("o"), 1)];
    add_sub(&mut list, sub("new", &ep("same"), 5));
    let same: Vec<&Sub> = list.iter().filter(|s| s.endpoint == ep("same")).collect();
    assert_eq!(same.len(), 1, "같은 주소는 한 줄");
    assert_eq!(same[0].device, "new");
    assert_eq!(same[0].replaces, vec!["old".to_string()]);
    // 다른 주소(다른 폰)는 그대로
    assert!(list.iter().any(|s| s.device == "other"));
    // 새 기기가 다시 구독해도(폰은 하루에도 여러 번 다시 보낸다) 옛 기기 기록은 남는다
    add_sub(&mut list, sub("new", &ep("same"), 9));
    let s = list.iter().find(|s| s.endpoint == ep("same")).unwrap();
    assert_eq!((s.at, s.replaces.clone()), (9, vec!["old".to_string()]));
}

#[test]
fn 세_번_짝지어도_옛_기기는_전부_적히고_되찾은_기기는_빠진다() {
    let mut list = vec![sub("a", &ep("x"), 1)];
    add_sub(&mut list, sub("b", &ep("x"), 2));
    add_sub(&mut list, sub("c", &ep("x"), 3));
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].replaces, vec!["a".to_string(), "b".to_string()]);
    // 옛 기기 a 가 같은 주소로 다시 구독(같은 폰 앱이 옛 열쇠로 돌아옴) — a 가 주인, c 가 옛 기기
    add_sub(&mut list, sub("a", &ep("x"), 4));
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].device, "a");
    assert_eq!(list[0].replaces, vec!["b".to_string(), "c".to_string()]);
}

#[test]
fn 옛_기록은_한없이_쌓이지_않는다() {
    let mut list = vec![];
    for i in 0..100u64 {
        add_sub(&mut list, sub(&format!("d{i}"), &ep("x"), i));
    }
    assert_eq!(list.len(), 1);
    assert!(list[0].replaces.len() <= REPLACES_MAX);
    // 가장 최근 옛 기기는 남는다
    assert!(list[0].replaces.contains(&"d98".to_string()));
}

#[test]
fn 옛_파일에_같은_주소가_두_기기로_있으면_알림은_새_기기로_한_번만() {
    // 11-09 23:35 사용자 데이터 모양 그대로(주소·열쇠만 가짜): 중계 폰 다섯, 구독 넷(두 줄이 같은 주소)
    let list = vec![sub("d0fe", &ep("p1"), 10), sub("4fdd", &ep("p2"), 20), sub("3be5", &ep("p3"), 30), sub("1c2e", &ep("phone"), 40), sub("fbf7", &ep("phone"), 50)];
    let devices = ids(&["95c3".into(), "00ae".into(), "3be5".into(), "1c2e".into(), "fbf7".into()]);
    let p = plan(&list, &devices, &devices);
    assert_eq!(relay_to(&p), vec!["95c3", "00ae", "3be5", "fbf7"], "옛 기기 1c2e 엔 중계 부탁을 안 낸다");
    let (_, s) = p.relay.iter().find(|(d, _)| d == "fbf7").unwrap();
    assert_eq!(s.as_ref().map(|s| s.at), Some(50), "새 기기 열쇠로 봉한다");
    assert!(p.direct.is_empty());
    // 같은 주소로 가는 부탁은 하나뿐
    let to_phone = p.relay.iter().filter(|(_, s)| s.as_ref().map(|s| s.endpoint == ep("phone")).unwrap_or(false)).count();
    assert_eq!(to_phone, 1);
}

#[test]
fn 합친_뒤에는_구독이_없어진_옛_기기에도_본문_없는_부탁을_안_낸다() {
    // 합치면 옛 기기 줄이 사라진다 — 그냥 두면 '열쇠 모르는 중계 폰'으로 보여 {to} 만 보내고, 중계는 같은 주소로 또 보낸다
    let mut list = vec![sub("1c2e", &ep("phone"), 40)];
    add_sub(&mut list, sub("fbf7", &ep("phone"), 50));
    let devices = ids(&["1c2e".into(), "fbf7".into(), "nosub".into()]);
    let p = plan(&list, &devices, &devices);
    assert_eq!(relay_to(&p), vec!["fbf7", "nosub"], "구독을 원래 안 알린 폰(nosub)은 지금처럼 본문 없이");
}

#[test]
fn 새_기기를_끊으면_옛_기기로_다시_간다() {
    let mut list = vec![sub("1c2e", &ep("phone"), 40)];
    add_sub(&mut list, sub("fbf7", &ep("phone"), 50));
    // fbf7 을 끊었다 — 1c2e 는 아직 짝지어 있다. 그 주소 주인이 없으니 옛 기기를 막지 않는다
    let devices = ids(&["1c2e".into()]);
    let p = plan(&list, &devices, &devices);
    assert_eq!(relay_to(&p), vec!["1c2e"]);
    // 옛 파일 모양(두 줄)에서도 같다 — 살아 있는 쪽으로
    let legacy = vec![sub("1c2e", &ep("phone"), 40), sub("fbf7", &ep("phone"), 50)];
    let p = plan(&legacy, &devices, &devices);
    assert_eq!(relay_to(&p), vec!["1c2e"]);
    assert_eq!(p.relay[0].1.as_ref().map(|s| s.at), Some(40));
}

#[test]
fn 직통_폰도_같은_주소면_한_번만_보낸다() {
    let list = vec![sub("t1", &ep("tail"), 1), sub("t2", &ep("tail"), 2), sub("t3", &ep("own"), 3)];
    let devices = ids(&["t1".into(), "t2".into(), "t3".into()]);
    let p = plan(&list, &devices, &[]);
    assert!(p.relay.is_empty());
    let mut got: Vec<(&str, &str)> = p.direct.iter().map(|s| (s.device.as_str(), s.endpoint.as_str())).collect();
    got.sort();
    assert_eq!(got, vec![("t2", ep("tail").as_str()), ("t3", ep("own").as_str())]);
}

#[test]
fn 직통과_중계가_같은_주소를_쥐면_새_쪽_한_길로만() {
    // 폰이 직통(테일넷)에서 중계로 옮겨 다시 짝지은 경우
    let list = vec![sub("tail", &ep("p"), 1), sub("rel", &ep("p"), 2)];
    let devices = ids(&["tail".into(), "rel".into()]);
    let p = plan(&list, &devices, &ids(&["rel".into()]));
    assert_eq!(relay_to(&p), vec!["rel"]);
    assert!(p.direct.is_empty(), "옛 직통 줄로 또 보내지 않는다");
}

#[test]
fn 다른_폰들은_전과_같이_각자_받는다() {
    let list = vec![sub("ph1", &ep("a"), 1), sub("ph2", &ep("b"), 2), sub("tl", &ep("c"), 3)];
    let devices = ids(&["ph1".into(), "ph2".into(), "tl".into()]);
    let p = plan(&list, &devices, &ids(&["ph1".into(), "ph2".into()]));
    assert_eq!(relay_to(&p), vec!["ph1", "ph2"]);
    assert_eq!(p.direct.iter().map(|s| s.device.as_str()).collect::<Vec<_>>(), vec!["tl"]);
    // 한 기기가 다시 구독해 주소가 바뀌면 중계 봉함은 가장 최근 것으로(전과 같음)
    let list = vec![sub("ph1", &ep("old"), 1), sub("ph1", &ep("new"), 9)];
    let p = plan(&list, &ids(&["ph1".into()]), &ids(&["ph1".into()]));
    assert_eq!(p.relay[0].1.as_ref().map(|s| s.endpoint.clone()), Some(ep("new")));
}

#[test]
fn 끊긴_기기의_옛_기록은_살아_있는_기기를_막지_않는다() {
    // 주인(new)이 끊겼는데 replaces 에 old 가 있다 — old 는 살아 있으니 받아야 한다
    let mut list = vec![sub("old", &ep("x"), 1)];
    add_sub(&mut list, sub("new", &ep("x"), 2));
    let p = plan(&list, &ids(&["old".into()]), &ids(&["old".into()]));
    assert_eq!(relay_to(&p), vec!["old"]);
}

#[test]
fn 파일에서도_구독을_합친다() {
    let d = std::env::temp_dir().join(format!("chammo-push-merge-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    // 옛 판이 남긴 파일(replaces 칸 없음)도 읽는다
    std::fs::write(d.join("push-subs.json"), format!(r#"[{{"device":"1c2e","endpoint":"{}","p256dh":"k","auth":"s","at":40}}]"#, ep("phone"))).unwrap();
    subscribe(&d, sub("fbf7", &ep("phone"), 50)).unwrap();
    let back = read_subs(&d);
    assert_eq!(back.len(), 1);
    assert_eq!((back[0].device.as_str(), back[0].replaces.clone()), ("fbf7", vec!["1c2e".to_string()]));
    // 옛 판이 다시 읽어도 깨지지 않게 — 옛 기기가 없으면 칸을 안 쓴다
    subscribe(&d, sub("solo", &ep("solo"), 60)).unwrap();
    let raw = std::fs::read_to_string(d.join("push-subs.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let solo = v.as_array().unwrap().iter().find(|x| x["device"] == "solo").unwrap();
    assert!(solo.get("replaces").is_none());
    // 옛 기기가 자기 이름으로 그 주소를 끄려 해도 새 기기 구독은 안 지워진다(남의 기기 구독은 못 지운다)
    unsubscribe(&d, "1c2e", &ep("phone")).unwrap();
    assert!(read_subs(&d).iter().any(|s| s.device == "fbf7"));
    let _ = std::fs::remove_dir_all(&d);
}
