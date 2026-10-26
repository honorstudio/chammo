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
fn entry_url_is_only_the_entry_address_no_secret() {
    // 폰 추가 QR(2026-10-24) — 카메라는 늘 사파리로 연다. 짝 코드·기기 id·열쇠·중계 주소가 실리면 사파리가 써 버려 홈 화면 앱엔 안 남는다
    let st = st();
    for web in ["https://phone.example", "https://phone.example/"] {
        let u = entry_url(web);
        assert_eq!(u, "https://phone.example/");
        for secret in ["#", "?", "p=", &st.device_id, &st.server, "relay"] {
            assert!(!u.contains(secret), "{u} 에 {secret} 이 없어야");
        }
    }
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

#[test]
fn 로그인한_컴퓨터는_허브를_늘_켜고_사람이_끄면_끈다() {
    // 10-24 참모-2·사용자: 넣기 없는 흐름(ADR 0014)의 전제 — 폰 연결을 한 번도 안 건드렸어도 로그인돼 있으면 허브
    let dir = std::env::temp_dir().join(format!("chammo-relay-auto-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let mut s = st();
    s.phone_web = "https://phone.example".into();
    std::fs::write(dir.join(team_relay::STATE_FILE), serde_json::to_string(&s).unwrap()).unwrap();
    assert!(wanted(&dir).is_none(), "계정 없는 옛 팀 기기는 그대로 — 폰 연결을 켜야");
    s.account = Some(team_relay::Account { id: "a1".into(), email: "me@example.com".into(), name: "지수".into() });
    std::fs::write(dir.join(team_relay::STATE_FILE), serde_json::to_string(&s).unwrap()).unwrap();
    assert!(wanted(&dir).is_some(), "로그인한 컴퓨터는 mobile.json 이 없어도 켠다");
    std::fs::write(dir.join("mobile.json"), r#"{"on":false}"#).unwrap();
    assert!(wanted(&dir).is_none(), "사람이 폰 연결을 껐으면 끈다");
    assert!(crate::mobile::explicit_off(&dir));
    std::fs::write(dir.join("mobile.json"), r#"{"on":true}"#).unwrap();
    assert!(wanted(&dir).is_some());
    assert!(!crate::mobile::explicit_off(&dir));
    let _ = std::fs::remove_dir_all(&dir);
}
