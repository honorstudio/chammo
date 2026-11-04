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

/// 허브 다시 붙기 — 1분 넘게 잘 붙어 있다 끊기면 처음부터 짧게. 전엔 앱이 켜진 뒤 끊긴 횟수가 쌓이기만 해서(성공해도 안 줄었다)
/// 하루 몇 번 끊긴 뒤엔 망이 잠깐 튈 때마다 5분씩 허브에서 빠졌다 — 그동안 폰은 요청마다 'aborted'(2026-10-27)
#[test]
fn backoff_resets_after_a_healthy_connection() {
    use std::time::Duration;
    assert_eq!(next_fails(7, Some(Duration::from_secs(90))), 1);
    assert_eq!(crate::team_relay_ws::backoff(next_fails(20, Some(Duration::from_secs(600)))), Duration::from_secs(4));
    // 붙자마자 끊기거나 못 붙으면 늘어난다(허브가 거절하는 동안 두드리지 않게)
    assert_eq!(next_fails(7, Some(Duration::from_secs(10))), 8);
    assert_eq!(next_fails(3, None), 4);
}

/// 잘 돌던 연결이 끊기면 1초 뒤 바로 — 중계 쪽 연결이 몇 분마다 빈손으로 닫혀서(notify.log 11-02 'Connection reset without closing handshake')
/// 4초씩 비면 그동안 폰 요청이 다 실패했다. 짧게 붙었다 끊기기를 되풀이하거나 못 붙으면 예전처럼 늘린다(서버를 두드리지 않게)
#[test]
fn 잘_돌던_허브가_끊기면_1초_뒤_다시() {
    use std::time::Duration;
    let healthy = Some(Duration::from_secs(646));
    assert_eq!(reconnect_wait(next_fails(0, healthy)), Duration::from_secs(1));
    assert_eq!(reconnect_wait(next_fails(9, healthy)), Duration::from_secs(1), "앞서 몇 번 끊겼어도 잘 돌았으면 처음부터");
    // 11-02 15:54 처럼 21초·46초 만에 또 끊기면 늘어난다 — 1·4·8·16초…
    let short = Some(Duration::from_secs(21));
    let mut f = next_fails(0, healthy);
    let mut waits = vec![reconnect_wait(f).as_secs()];
    for _ in 0..3 {
        f = next_fails(f, short);
        waits.push(reconnect_wait(f).as_secs());
    }
    assert_eq!(waits, vec![1, 4, 8, 16]);
    // 못 붙는 동안도 늘어나고 5분에서 멈춘다
    assert_eq!(reconnect_wait(next_fails(40, None)), Duration::from_secs(300));
}

// 컴퓨터끼리 숫자 확인(C-3b) — 폰 갈래는 그대로(대기 폰도), 컴퓨터 갈래는 같은 계정의 허용된 다른 컴퓨터만
#[test]
fn 숫자_확인_받을_기기_폰은_대기도_컴퓨터는_허용된_것만() {
    let d = |id: &str, kind: &str, status: &str, current: bool| crate::team_relay::DeviceName { id: id.into(), name: id.into(), kind: kind.into(), status: status.into(), current, ..Default::default() };
    let mut s = st();
    s.my_devices = vec![d("me", "mac", "approved", true), d("ph", "phone", "pending", false), d("imac", "mac", "approved", false), d("pc", "win", "pending", false), d("odd", "", "approved", false)];
    assert!(link_dev_ok(&s, "ph", false), "대기 폰은 폰 갈래로");
    assert!(!link_dev_ok(&s, "ph", true), "폰을 컴퓨터 갈래로는 안 받는다");
    assert!(link_dev_ok(&s, "imac", true));
    assert!(!link_dev_ok(&s, "imac", false), "컴퓨터를 폰 갈래로는 안 받는다");
    assert!(!link_dev_ok(&s, "pc", true), "대기 컴퓨터는 기기 허용이 먼저");
    assert!(!link_dev_ok(&s, "me", true), "나 자신");
    assert!(!link_dev_ok(&s, "odd", true), "종류 모름");
    assert!(!link_dev_ok(&s, "ghost", true));
}
