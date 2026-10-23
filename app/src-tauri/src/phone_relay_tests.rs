use super::*;

fn st() -> TeamState {
    TeamState { server: "https://relay.example".into(), device_id: "mac-1".into(), key_account: "dev-x".into(), ..Default::default() }
}

#[test]
fn qr_url_puts_everything_after_the_hash() {
    let u = qr_url("https://phone.example", "ab12", &st(), "KEY_x-1");
    assert_eq!(u, "https://phone.example/pair#p=ab12&m=mac-1&k=KEY_x-1&r=https%3A%2F%2Frelay.example");
    assert!(!u.split('#').next().unwrap().contains("ab12"), "코드는 # 앞에 없다");
}

#[test]
fn not_wanted_without_mobile_on_registration_or_phone_web() {
    let dir = std::env::temp_dir().join(format!("chammo-relay-wanted-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let save = |s: &TeamState| std::fs::write(dir.join(team_relay::STATE_FILE), serde_json::to_string(s).unwrap()).unwrap();
    let mut s = st();
    s.phone_web = "https://phone.example".into();
    save(&s);
    assert!(wanted(&dir).is_none(), "폰 연결 꺼짐");
    std::fs::write(dir.join("mobile.json"), r#"{"on":true}"#).unwrap();
    assert_eq!(wanted(&dir).map(|x| x.1), Some("https://phone.example".into()));
    s.phone_web = "http://evil.example".into();
    save(&s);
    assert!(wanted(&dir).is_none(), "https 아닌 입구");
    s.phone_web = "https://phone.example".into();
    s.revoked = true;
    save(&s);
    assert!(wanted(&dir).is_none(), "끊긴 기기");
    s.revoked = false;
    s.device_id.clear();
    save(&s);
    assert!(wanted(&dir).is_none(), "등록 안 됨");
    let _ = std::fs::remove_dir_all(&dir);
}
