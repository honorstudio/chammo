use super::*;
use crate::device_link::Links;
use crate::phone_tunnel as tun;

fn hello_for(dev: &str, x: u8) -> Hello {
    let sign = tun::b64(&[7u8; 32]);
    let v = json!({ "sign": sign, "x": tun::b64(&phone_x(x)), "dev": dev, "ua": "Mozilla/5.0 (iPhone)" });
    Links::hello_of("k1", &v, &sign, dev, false).unwrap()
}

/// 진짜 P-256 점(생성점 G·2G) — 모양만 맞추면 tun::pubkey 가 거절한다
fn phone_x(n: u8) -> Vec<u8> {
    let hex = if n == 1 {
        "046B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C2964FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5"
    } else {
        "047CF27B188D034F7E8A52380304B51AC3C08969E277F21B35A60B48FC4766997807775510DB8ED040293D9AC69F7430DBBA7DADE63CE982299E04B79D227873D1"
    };
    (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect()
}

fn sent(v: &Option<Value>) -> bool {
    v.as_ref().is_some_and(|x| x["step"] == "mail" && x["sent"] == true)
}

#[test]
fn 끈_맥은_메일_없이_숫자_확인으로() {
    let c = MailCodes::default();
    let mut mails = 0;
    assert_eq!(request(&c, false, &hello_for("p1", 1), |_| { mails += 1; true }, Instant::now()), None);
    assert_eq!(mails, 0, "메일이 안 나간다");
    assert!(submit(&c, false, &hello_for("p1", 1), "000000", Instant::now()).is_err(), "끈 맥은 코드로 허용되지 않는다");
}

#[test]
fn 컴퓨터끼리_잇기엔_안_쓴다() {
    let c = MailCodes::default();
    let mut h = hello_for("p1", 1);
    h.peer = true;
    assert_eq!(request(&c, true, &h, |_| true, Instant::now()), None);
    assert!(submit(&c, true, &h, "000000", Instant::now()).is_err());
}

#[test]
fn 맞는_코드는_한_번만_통과() {
    let c = MailCodes::default();
    let h = hello_for("p1", 1);
    let now = Instant::now();
    let mut code = String::new();
    assert!(sent(&request(&c, true, &h, |x| { code = x.to_string(); true }, now)));
    assert_eq!(code.len(), 6);
    assert!(code.bytes().all(|b| b.is_ascii_digit()));
    assert_eq!(submit(&c, true, &h, &code, now), Ok(()));
    assert_eq!(submit(&c, true, &h, &code, now).unwrap_err()["error"], "expired", "두 번은 안 된다");
}

#[test]
fn 다시_붙어도_같은_코드_같은_틀림_수를_이어_간다() {
    // 폰이 메일 앱에 다녀오면 소켓이 끊긴다(14:43~14:48 카드가 새로 쌓였다) — 두드리기가 새로 와도 요청은 하나
    let c = MailCodes::default();
    let h = hello_for("p1", 1);
    let t0 = Instant::now();
    let mut first = String::new();
    request(&c, true, &h, |x| { first = x.to_string(); true }, t0);
    assert_eq!(submit(&c, true, &h, "wrong1", t0).unwrap_err()["left"], 4);
    // 간격 안 — 메일을 또 안 보낸다
    let mut mails = 0;
    let v = request(&c, true, &h, |_| { mails += 1; true }, t0 + Duration::from_secs(10)).unwrap();
    assert_eq!((v["sent"].clone(), v["wait"].clone(), mails), (json!(false), json!(50), 0));
    // 간격이 지나면 같은 코드를 다시
    let mut again = String::new();
    assert!(sent(&request(&c, true, &h, |x| { again = x.to_string(); true }, t0 + RESEND_GAP)));
    assert_eq!(again, first, "새 코드로 바꾸면 먼저 온 메일이 헛것이 된다");
    assert_eq!(submit(&c, true, &h, "wrong2", t0 + RESEND_GAP).unwrap_err()["left"], 3, "틀림 수는 이어진다");
    assert_eq!(submit(&c, true, &h, &first, t0 + RESEND_GAP), Ok(()));
}

#[test]
fn 다섯_번_틀리면_맞는_코드도_새_코드도_안_된다() {
    let c = MailCodes::default();
    let h = hello_for("p1", 1);
    let t0 = Instant::now();
    let mut code = String::new();
    request(&c, true, &h, |x| { code = x.to_string(); true }, t0);
    for left in [4, 3, 2, 1] {
        assert_eq!(submit(&c, true, &h, "bad", t0).unwrap_err()["left"], left);
    }
    assert_eq!(submit(&c, true, &h, "bad", t0).unwrap_err()["error"], "locked");
    assert_eq!(submit(&c, true, &h, &code, t0).unwrap_err()["error"], "locked", "다섯 번 뒤엔 맞는 코드도");
    let mut mails = 0;
    let v = request(&c, true, &h, |_| { mails += 1; true }, t0 + RESEND_GAP).unwrap();
    assert_eq!(mails, 0, "새 코드로 추측을 이어 가지 못한다");
    assert!(v["locked"].as_u64().unwrap() > 0);
    // 10분이 지나면 새로
    assert!(sent(&request(&c, true, &h, |_| true, t0 + MAIL_TTL + Duration::from_secs(1))));
}

#[test]
fn 십분이_지나면_코드가_끝난다() {
    let c = MailCodes::default();
    let h = hello_for("p1", 1);
    let t0 = Instant::now();
    let mut code = String::new();
    request(&c, true, &h, |x| { code = x.to_string(); true }, t0);
    assert_eq!(submit(&c, true, &h, &code, t0 + MAIL_TTL), Ok(()), "10분까지는 된다");
    request(&c, true, &h, |x| { code = x.to_string(); true }, t0);
    assert_eq!(submit(&c, true, &h, &code, t0 + MAIL_TTL + Duration::from_secs(1)).unwrap_err()["error"], "expired");
}

#[test]
fn 다른_폰_열쇠로는_맞는_코드도_틀림() {
    // 중계가 코드를 안다(메일을 보내니까) — 그래도 처음 요청한 터널 열쇠가 아니면 안 된다, 토큰은 그 열쇠로 봉해 나간다
    let c = MailCodes::default();
    let t0 = Instant::now();
    let mut code = String::new();
    request(&c, true, &hello_for("p1", 1), |x| { code = x.to_string(); true }, t0);
    assert_eq!(submit(&c, true, &hello_for("p1", 2), &code, t0).unwrap_err()["error"], "wrong");
    assert_eq!(submit(&c, true, &hello_for("p2", 1), &code, t0).unwrap_err()["error"], "expired", "기기마다 따로");
    assert_eq!(submit(&c, true, &hello_for("p1", 1), &code, t0), Ok(()));
}

#[test]
fn 메일이_안_나가면_숫자_확인으로_내려가고_요청이_남지_않는다() {
    let c = MailCodes::default();
    let h = hello_for("p1", 1);
    let t0 = Instant::now();
    assert_eq!(request(&c, true, &h, |_| false, t0), None);
    assert_eq!(submit(&c, true, &h, "000000", t0).unwrap_err()["error"], "expired");
    assert!(sent(&request(&c, true, &h, |_| true, t0)), "다음엔 바로 다시 해 본다");
}

#[test]
fn 다시_보내기만_실패하면_받아_둔_코드는_살아_있다() {
    // 첫 메일은 받았는데 재전송이 잠깐 실패 — 요청을 지우면 손에 든 코드가 죽고 틀림 수도 0 으로 돌아간다
    let c = MailCodes::default();
    let h = hello_for("p1", 1);
    let t0 = Instant::now();
    let mut code = String::new();
    request(&c, true, &h, |x| { code = x.to_string(); true }, t0);
    assert_eq!(submit(&c, true, &h, "bad", t0).unwrap_err()["left"], 4);
    let v = request(&c, true, &h, |_| false, t0 + RESEND_GAP).expect("숫자 확인으로 안 내려간다 — 코드 화면 그대로");
    assert_eq!((v["step"].clone(), v["sent"].clone()), (json!("mail"), json!(false)));
    assert!(v["wait"].as_u64().unwrap() > 0);
    assert_eq!(submit(&c, true, &h, "bad", t0 + RESEND_GAP).unwrap_err()["left"], 3, "틀림 수가 안 지워진다");
    assert_eq!(submit(&c, true, &h, &code, t0 + RESEND_GAP), Ok(()));
}

#[test]
fn 설정은_파일로_기본_꺼짐() {
    let d = std::env::temp_dir().join(format!("chammo-phone-mail-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    let f = d.join("phone-link.json");
    let _ = std::fs::remove_file(&f);
    assert!(!enabled(&d), "파일이 없으면 꺼짐");
    std::fs::write(&f, "{\"email\":false}").unwrap();
    assert!(!enabled(&d));
    std::fs::write(&f, "깨진 글").unwrap();
    assert!(!enabled(&d), "깨졌으면 꺼짐");
    std::fs::write(&f, "{\"email\":\"true\"}").unwrap();
    assert!(!enabled(&d), "글자 true 는 아니다");
    std::fs::write(&f, "{\"email\":true}").unwrap();
    assert!(enabled(&d));
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 인사가_틀리면_받지_않는다() {
    let sign = tun::b64(&[7u8; 32]);
    let good = json!({ "sign": sign, "x": tun::b64(&phone_x(1)), "dev": "p1", "ua": "iPhone" });
    assert!(Links::hello_of("k", &good, &sign, "p1", false).is_ok());
    assert!(Links::hello_of("k", &good, &tun::b64(&[8u8; 32]), "p1", false).is_err(), "허브가 확인한 열쇠와 달라");
    assert!(Links::hello_of("k", &good, &sign, "p2", false).is_err(), "허브가 확인한 기기와 달라");
    assert!(Links::hello_of("k/1", &good, &sign, "p1", false).is_err(), "두드리기 id 모양");
    let bad_x = json!({ "sign": sign, "x": "AAAA", "dev": "p1" });
    assert!(Links::hello_of("k", &bad_x, &sign, "p1", false).is_err());
}

#[test]
fn 사람_카드를_건너뛰는_건_메일_길뿐이고_끈_맥은_그대로() {
    let src = include_str!("phone_relay.rs");
    let step = &src[src.find("fn link_step").unwrap()..src.find("pub fn link_answer").unwrap()];
    assert!(step.contains("crate::phone_mail_link::enabled(dir)"), "설정을 그때그때 본다");
    assert!(step.contains("\"mail-code\""));
    assert!(!step.contains("grant_phone("), "단계 안에서 바로 허용하지 않는다");
    let sub = &src[src.find("fn mail_submit").unwrap()..src.find("struct LinkOut").unwrap()];
    assert!(sub.find("phone_mail_link::submit").unwrap() < sub.find("grant_phone(").unwrap(), "코드 확인 뒤에만");
    assert_eq!(src.matches("grant_phone(").count(), 3, "정의·숫자 카드 답·메일 코드 — 허용 끝단은 이 둘뿐");
}
