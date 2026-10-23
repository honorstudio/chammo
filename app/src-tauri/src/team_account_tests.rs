use super::*;
use crate::accounts_store::fake::Fake;
use crate::team_test_util::FakeRelay;
use std::cell::RefCell;
use std::sync::{Arc, Mutex};
use std::io::{Read, Write};

fn get(port: u16, q: &str) -> (String, String) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(s, "GET {q} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").unwrap();
    let mut out = String::new();
    let _ = s.read_to_string(&mut out);
    let (head, body) = out.split_once("\r\n\r\n").unwrap_or((&out, ""));
    (head.lines().next().unwrap_or("").to_string(), body.to_string())
}

const MINE: &str = "11111111-1111-4111-8111-111111111111";

#[test]
fn 루프백은_내_loginId_결과만_받고_나머지는_돌려보낸다() {
    let _ports = crate::test_ports::lock();
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    let h = std::thread::spawn(move || {
        let a = get(port, "/favicon.ico");
        let b = get(port, "/chammo-login?login=22222222-2222-4222-8222-222222222222&code=EVIL");
        let c = get(port, &format!("/chammo-login?login={MINE}&code=GOOD_code-1"));
        (a, b, c)
    });
    assert_eq!(wait_result(&l, MINE, Duration::from_secs(5)).unwrap(), "GOOD_code-1");
    let (a, b, c) = h.join().unwrap();
    assert!(a.0.contains(" 404 ") && b.0.contains(" 400 ") && c.0.contains(" 200 "), "{a:?} {b:?} {c:?}");
    assert_eq!(c.1, "Chammo로 돌아가세요", "응답은 글 한 줄");
}

#[test]
fn 루프백_실패_결과·이상한_코드는_실패로() {
    let _ports = crate::test_ports::lock();
    for q in [format!("/chammo-login?login={MINE}&error=login_failed"), format!("/chammo-login?login={MINE}&code=%3Cscript%3E"), format!("/chammo-login?login={MINE}")] {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || get(port, &q));
        assert!(wait_result(&l, MINE, Duration::from_secs(5)).is_err());
        h.join().unwrap();
    }
}

#[test]
fn 루프백은_시간이_지나면_실패() {
    let _ports = crate::test_ports::lock();
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let t = Instant::now();
    assert!(wait_result(&l, MINE, Duration::from_millis(300)).unwrap_err().contains("시간"));
    assert!(t.elapsed() < Duration::from_secs(2));
}

#[test]
fn 느리게_보내는_연결이_마감을_넘겨_붙잡지_못한다() {
    // 리뷰 2: 3초 제한이 read 한 번마다라 1바이트씩 흘리면 accept 고리가 멈춰 10분 마감이 안 돌았다
    let _ports = crate::test_ports::lock();
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    std::thread::spawn(move || {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        for _ in 0..40 {
            if s.write_all(b"G").is_err() {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    });
    let t = Instant::now();
    assert!(wait_result(&l, MINE, Duration::from_millis(800)).is_err());
    assert!(t.elapsed() < Duration::from_millis(2_000), "마감을 넘겨 붙잡힘: {:?}", t.elapsed());
}

#[test]
fn 기기_이름_기본값은_컴퓨터_이름() {
    let _ports = crate::test_ports::lock();
    let n = default_device_name();
    assert!(device_name_ok(&n).is_some() && !n.contains(".local"), "{n}");
}

#[test]
fn 기기_이름은_1에서_80자() {
    let _ports = crate::test_ports::lock();
    assert_eq!(device_name_ok("  맥북\n ").as_deref(), Some("맥북"));
    assert_eq!(device_name_ok("   "), None);
    assert_eq!(device_name_ok(&"가".repeat(81)), None);
}

// ── 로그인 흐름 ──

const SERVER: &str = "https://relay.test";

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-acct-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 루프백 주소(http://127.0.0.1:<포트>/…)에 GET 한 번
fn hit(url: &str) -> (String, String) {
    let rest = url.strip_prefix("http://127.0.0.1:").unwrap();
    let (port, path) = rest.split_once('/').unwrap();
    get(port.parse().unwrap(), &format!("/{path}"))
}

/// 가짜 시스템 브라우저 — 서버(가짜 중계)가 받은 returnTo 로, 계획한 결과들을 차례로 돌려준다
struct FakeBrowser<'a> {
    relay: &'a FakeRelay,
    /// 루프백에 붙일 쿼리들(login=…&code=… 등). "{mine}" 는 내 loginId
    hits: Vec<String>,
    opened: RefCell<Vec<String>>,
    got: Arc<Mutex<Vec<(String, String)>>>,
}

impl<'a> FakeBrowser<'a> {
    fn new(relay: &'a FakeRelay, hits: &[&str]) -> Self {
        FakeBrowser { relay, hits: hits.iter().map(|s| s.to_string()).collect(), opened: RefCell::new(Vec::new()), got: Arc::new(Mutex::new(Vec::new())) }
    }
}

impl Opener for FakeBrowser<'_> {
    fn open(&self, url: &str) -> Result<(), String> {
        self.opened.borrow_mut().push(url.to_string());
        let seen = self.relay.seen.borrow();
        let begin = seen.iter().rev().find(|(_, p, _, _)| p.ends_with("/v0/auth/google/begin")).unwrap();
        let ret = serde_json::from_str::<serde_json::Value>(&begin.3).unwrap()["returnTo"].as_str().unwrap().to_string();
        let mine = url.rsplit_once("login=").unwrap().1.to_string();
        let hits: Vec<String> = self.hits.iter().map(|h| h.replace("{mine}", &mine)).collect();
        let got = self.got.clone();
        std::thread::spawn(move || {
            for h in hits {
                let r = hit(&format!("{ret}?{h}"));
                got.lock().unwrap().push(r);
            }
        });
        Ok(())
    }
}

fn begin_ok(r: &FakeRelay, login: &str) {
    r.answer("/v0/auth/google/begin", 201, &format!(r#"{{"loginId":"{login}","url":"{SERVER}/auth/google/start?login={login}","expiresAt":1}}"#));
}

fn me_ok(r: &FakeRelay, teams: &str) {
    r.answer("/v0/me", 200, &format!(r#"{{"account":{{"id":"a1","email":"me@example.com","name":"지수"}},"device":{{"id":"d7","name":"맥북"}},"teams":{teams}}}"#));
    r.answer("/v0/me/devices", 200, r#"{"devices":[{"id":"d7","name":"맥북","createdAt":1,"current":true},{"id":"d8","name":"아이맥","createdAt":2,"current":false}]}"#);
}

const L1: &str = "11111111-1111-4111-8111-111111111111";

#[test]
fn 새_기기는_새_열쇠로_로그인하고_내_loginId_결과만_마친다() {
    let _ports = crate::test_ports::lock();
    let d = dir("new");
    let kc = Fake::default();
    let r = FakeRelay::default();
    begin_ok(&r, L1);
    r.answer("/v0/auth/google/finish", 201, r#"{"accountId":"a1","deviceId":"d7","email":"me@example.com","name":"지수"}"#);
    me_ok(&r, "[]");
    // 남의 loginId 결과가 먼저 와도 무시하고 기다린다(다른 로그인 결과·끼어들기)
    let b = FakeBrowser::new(&r, &["login=22222222-2222-4222-8222-222222222222&code=EVIL", "login={mine}&code=GOOD"]);
    let st = login_with(&d, &kc, &r, &b, SERVER, "맥북", Duration::from_secs(5)).unwrap();
    assert_eq!(st.account.as_ref().unwrap().email, "me@example.com");
    assert_eq!((st.device_id.as_str(), st.device_name.as_str(), st.server.as_str()), ("d7", "맥북", SERVER));
    assert_eq!(st.my_devices.len(), 2);
    assert_eq!(st.device_created_at, 1, "이 기기 만든 때(서버 시각) — 그 전 말은 안 넘긴다");
    let seen = r.seen.borrow();
    let begin = &seen[0];
    assert!(crate::team_test_util::FakeRelay::header(&begin.2, "X-Chammo-Key").is_some(), "미등록 열쇠 머리로 begin");
    let ret = serde_json::from_str::<serde_json::Value>(&begin.3).unwrap()["returnTo"].as_str().unwrap().to_string();
    assert!(ret.starts_with("http://127.0.0.1:") && ret.ends_with("/chammo-login"), "{ret}");
    let fin: Vec<_> = seen.iter().filter(|(_, p, _, _)| p.ends_with("/finish")).collect();
    assert_eq!(fin.len(), 1, "finish 는 한 번, 내 것으로만");
    let body: serde_json::Value = serde_json::from_str(&fin[0].3).unwrap();
    assert_eq!((body["loginId"].as_str(), body["code"].as_str(), body["deviceName"].as_str()), (Some(L1), Some("GOOD"), Some("맥북")));
    // 같은 열쇠로 begin·finish
    assert_eq!(crate::team_test_util::FakeRelay::header(&fin[0].2, "X-Chammo-Key"), crate::team_test_util::FakeRelay::header(&begin.2, "X-Chammo-Key"));
    let got = b.got.lock().unwrap().clone();
    assert_eq!(got.len(), 2);
    assert!(got[0].0.contains(" 400 "), "남의 결과는 400: {:?}", got[0]);
    assert!(got[1].0.contains(" 200 ") && got[1].1 == "Chammo로 돌아가세요", "{:?}", got[1]);
    // 열쇠는 키체인 chammo-team 칸, 비밀은 파일에 없다
    assert!(crate::team_relay_keys::load(&kc, &st.key_account).unwrap().is_some());
    assert!(!std::fs::read_to_string(d.join(crate::team_relay::STATE_FILE)).unwrap().contains("GOOD"));
}

#[test]
fn 구글에서_실패하면_마치지_않고_새_열쇠를_치운다() {
    let _ports = crate::test_ports::lock();
    let d = dir("fail");
    let kc = Fake::default();
    let r = FakeRelay::default();
    begin_ok(&r, L1);
    let b = FakeBrowser::new(&r, &["login={mine}&error=login_failed"]);
    let e = login_with(&d, &kc, &r, &b, SERVER, "맥북", Duration::from_secs(5)).unwrap_err();
    assert!(e.contains("로그인"), "{e}");
    assert!(!r.seen.borrow().iter().any(|(_, p, _, _)| p.ends_with("/finish")));
    assert!(kc.items.borrow().is_empty(), "만든 열쇠 치움");
    assert!(!crate::team_relay::load_state(&d).registered());
}

#[test]
fn 서버가_준_주소가_우리_서버_로그인_주소가_아니면_브라우저를_안_연다() {
    let _ports = crate::test_ports::lock();
    for bad in ["https://evil.example/auth/google/start?login=L", "https://relay.test/other?login=L", "javascript:alert(1)", "https://relay.test.evil.example/auth/google/start?login=L"] {
        let d = dir("badurl");
        let kc = Fake::default();
        let r = FakeRelay::default();
        r.answer("/v0/auth/google/begin", 201, &format!(r#"{{"loginId":"{L1}","url":"{bad}","expiresAt":1}}"#));
        let b = FakeBrowser::new(&r, &[]);
        assert!(login_with(&d, &kc, &r, &b, SERVER, "맥북", Duration::from_secs(2)).is_err(), "{bad}");
        assert!(b.opened.borrow().is_empty(), "{bad}");
    }
}

#[test]
fn 이미_팀이_있는_옛_기기는_그_열쇠로_로그인하고_팀을_지킨다() {
    let _ports = crate::test_ports::lock();
    let d = dir("old");
    let kc = Fake::default();
    let r = FakeRelay::default();
    let (k, account) = crate::team_relay_keys::create(&kc).unwrap();
    r.devices.borrow_mut().push(("d1".into(), k.public()));
    crate::team_relay::mutate(&d, |s| {
        s.server = SERVER.into();
        s.key_account = account.clone();
        s.device_id = "d1".into();
        s.team_id = "t1".into();
        s.member_id = "m1".into();
        s.role = "owner".into();
    })
    .unwrap();
    begin_ok(&r, L1);
    r.answer("/v0/auth/google/finish", 200, r#"{"accountId":"a1","deviceId":"d1","email":"me@example.com","name":"지수"}"#);
    me_ok(&r, r#"[{"teamId":"t1","name":"샘플팀","memberId":"m1","role":"owner"}]"#);
    let b = FakeBrowser::new(&r, &["login={mine}&code=OK"]);
    let st = login_with(&d, &kc, &r, &b, "", "맥북", Duration::from_secs(5)).unwrap();
    assert_eq!(crate::team_test_util::FakeRelay::header(&r.seen.borrow()[0].2, "X-Chammo-Device"), Some("d1"));
    assert_eq!((st.team_id.as_str(), st.key_account.as_str(), st.account.as_ref().unwrap().id.as_str()), ("t1", account.as_str(), "a1"));
    assert_eq!(kc.items.borrow().len(), 1, "새 열쇠 없음");
}

#[test]
fn 로그인하면_서버에_있던_내_팀을_이어받는다() {
    let _ports = crate::test_ports::lock();
    // 다른 기기에서 만든 팀 — 이 기기는 로그인만 해도 그 팀의 내 멤버로 말한다(ADR 0004)
    let d = dir("teams");
    let kc = Fake::default();
    let r = FakeRelay::default();
    begin_ok(&r, L1);
    r.answer("/v0/auth/google/finish", 201, r#"{"accountId":"a1","deviceId":"d7","email":"me@example.com","name":"지수"}"#);
    me_ok(&r, r#"[{"teamId":"t1","name":"샘플팀","memberId":"m1","role":"owner"}]"#);
    let b = FakeBrowser::new(&r, &["login={mine}&code=OK"]);
    let st = login_with(&d, &kc, &r, &b, SERVER, "맥북", Duration::from_secs(5)).unwrap();
    assert_eq!((st.team_id.as_str(), st.team_name.as_str(), st.member_id.as_str(), st.role.as_str()), ("t1", "샘플팀", "m1", "owner"));
}

#[test]
fn 이미_로그인한_기기는_또_로그인하지_않는다() {
    let _ports = crate::test_ports::lock();
    let d = dir("twice");
    crate::team_relay::mutate(&d, |s| s.account = Some(crate::team_relay::Account { id: "a1".into(), ..Default::default() })).unwrap();
    let r = FakeRelay::default();
    let b = FakeBrowser::new(&r, &[]);
    assert!(login_with(&d, &Fake::default(), &r, &b, SERVER, "맥북", Duration::from_secs(1)).is_err());
    assert!(r.seen.borrow().is_empty());
}

// ── 계정 관리 ──

fn logged(tag: &str) -> (std::path::PathBuf, Fake, FakeRelay) {
    let d = dir(tag);
    let kc = Fake::default();
    let r = FakeRelay::default();
    let (k, account) = crate::team_relay_keys::create(&kc).unwrap();
    r.devices.borrow_mut().push((D7.into(), k.public()));
    crate::team_relay::mutate(&d, |s| {
        s.server = SERVER.into();
        s.key_account = account;
        s.device_id = D7.into();
        s.team_id = "t1".into();
        s.member_id = "m1".into();
        s.account = Some(crate::team_relay::Account { id: "a1".into(), email: "me@example.com".into(), name: "지수".into() });
        s.my_devices = vec![DeviceName { id: D7.into(), name: "맥북".into(), current: true }, DeviceName { id: D8.into(), name: "아이맥".into(), current: false }];
    })
    .unwrap();
    std::fs::write(d.join(crate::team_relay_inbox::INBOX_FILE), "{}\n").unwrap();
    (d, kc, r)
}

const D7: &str = "77777777-7777-4777-8777-777777777777";
const D8: &str = "88888888-8888-4888-8888-888888888888";

#[test]
fn 내_기기_이름_바꾸기와_다른_기기_끊기() {
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("manage");
    r.answer(&format!("/v0/me/devices/{D8}/name"), 200, r#"{"ok":true}"#);
    let st = rename_device(&d, &kc, &r, D8, "회사 아이맥").unwrap();
    assert_eq!(st.device_label(D8).as_deref(), Some("회사 아이맥"));
    let body: serde_json::Value = serde_json::from_str(&r.seen.borrow()[0].3).unwrap();
    assert_eq!(body["name"], "회사 아이맥");
    r.answer(&format!("/v0/me/devices/{D8}/revoke"), 200, r#"{"ok":true}"#);
    let st = revoke_device(&d, &kc, &r, D8).unwrap();
    assert!(st.account.is_some(), "다른 기기 끊기는 이 기기 로그인을 안 건드린다");
    assert!(st.my_devices.iter().all(|x| x.id != D8));
    // 기기 id 는 경로에 들어가니 모양을 본다
    for bad in ["../me/delete", "d8/revoke", ""] {
        assert!(rename_device(&d, &kc, &r, bad, "x").is_err() && revoke_device(&d, &kc, &r, bad).is_err(), "{bad}");
    }
    assert_eq!(r.seen.borrow().len(), 2);
}

#[test]
fn 로그아웃은_자기를_끊고_열쇠·상태·받은_기록을_지운다() {
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("logout");
    r.answer(&format!("/v0/me/devices/{D7}/revoke"), 200, r#"{"ok":true}"#);
    logout(&d, &kc, &r).unwrap();
    assert_eq!(crate::team_test_util::FakeRelay::header(&r.seen.borrow()[0].2, "X-Chammo-Device"), Some(D7));
    assert!(kc.items.borrow().is_empty(), "키체인 칸 지움");
    assert!(!d.join(crate::team_relay::STATE_FILE).exists() && !d.join(crate::team_relay_inbox::INBOX_FILE).exists());
}

#[test]
fn 로그아웃은_끊긴_줄_아는_기기만_401_에도_지우고_망이_안_닿으면_남긴다() {
    let _ports = crate::test_ports::lock();
    // 리뷰 3: 401 은 시계가 5분 넘게 틀려도 온다 — 서버가 4001 로 끊었다고 알린 기기(revoked)만 401 을 '이미 끊김'으로 본다
    let (d, kc, r) = logged("logout-401");
    r.answer(&format!("/v0/me/devices/{D7}/revoke"), 401, r#"{"error":"unauthorized"}"#);
    assert!(logout(&d, &kc, &r).unwrap_err().contains("forget"));
    assert!(d.join(crate::team_relay::STATE_FILE).exists() && !kc.items.borrow().is_empty(), "서버엔 살아 있을 수 있어 남긴다");
    crate::team_relay::mutate(&d, |s| s.revoked = true).unwrap();
    r.answer(&format!("/v0/me/devices/{D7}/revoke"), 401, r#"{"error":"unauthorized"}"#);
    logout(&d, &kc, &r).unwrap();
    assert!(!d.join(crate::team_relay::STATE_FILE).exists() && kc.items.borrow().is_empty());
    struct Down;
    impl Http for Down {
        fn send(&self, _: &str, _: &str, _: &[(String, String)], _: &[u8]) -> Result<(u16, String), String> {
            Err("못 닿음".into())
        }
    }
    let (d2, kc2, _r2) = logged("logout-down");
    assert!(logout(&d2, &kc2, &Down).is_err());
    assert!(d2.join(crate::team_relay::STATE_FILE).exists() && !kc2.items.borrow().is_empty(), "서버에서 안 끊겼으면 다시 할 수 있게 남긴다");
}

#[test]
fn 로그아웃은_team_json_의_기기_id_가_이상하면_안_보낸다() {
    let _ports = crate::test_ports::lock();
    // 리뷰 3: 손댄 team.json 의 id('../delete?x=')가 주소 경로로 그대로 나갔다(curl 이 .. 를 정리해 다른 길로)
    for bad in ["../delete?x=", "d7\nX-Evil: 1", ""] {
        let (d, kc, r) = logged("logout-bad");
        crate::team_relay::mutate(&d, |s| s.device_id = bad.into()).unwrap();
        assert!(logout(&d, &kc, &r).is_err(), "{bad:?}");
        assert!(r.seen.borrow().is_empty(), "{bad:?}");
        assert!(d.join(crate::team_relay::STATE_FILE).exists());
    }
}

#[test]
fn 계정_지우기는_이메일을_그대로_쳐야_한다() {
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("delete");
    for wrong in ["", "지우기", "ME@example.com", "me@example.com "] {
        assert!(delete_account(&d, &kc, &r, wrong).is_err(), "{wrong:?}");
    }
    assert!(r.seen.borrow().is_empty(), "확인 전엔 아무것도 안 보냄");
    r.answer("/v0/me/delete", 200, r#"{"ok":true}"#);
    delete_account(&d, &kc, &r, "me@example.com").unwrap();
    assert!(r.seen.borrow()[0].1.ends_with("/v0/me/delete"));
    assert!(kc.items.borrow().is_empty() && !d.join(crate::team_relay::STATE_FILE).exists());
}

// ── 리뷰(10-23) 되돌림 ──

#[test]
fn 로그인이_도는_동안엔_두_번째_로그인도_팀_만들기도_막는다() {
    // 리뷰 1: 두 로그인이 겹치면 나중 것이 team.json 의 열쇠를 덮어써 먼저 만든 열쇠가 키체인·서버 계정에 영영 남았다
    let _ports = crate::test_ports::lock();
    let d = dir("busy");
    let _busy = login_turn(&d).unwrap();
    assert!(login_turn(&d).is_err(), "같은 데이터 폴더엔 하나만");
    let kc = Fake::default();
    let r = FakeRelay::default();
    let b = FakeBrowser::new(&r, &[]);
    assert!(login_with(&d, &kc, &r, &b, SERVER, "맥북", Duration::from_secs(1)).unwrap_err().contains("로그인 중"));
    assert!(crate::team_relay::create(&d, &kc, &r, SERVER, "팀", "지수", "맥북").unwrap_err().contains("로그인 중"));
    assert!(r.seen.borrow().is_empty() && kc.items.borrow().is_empty(), "열쇠도 요청도 없음");
}

#[test]
fn 로그아웃과_겹친_뒤_스레드가_team_json_을_되살리지_않는다() {
    let _ports = crate::test_ports::lock();
    // 리뷰 4: 방 찾기·이름 받기가 도는 사이 로그아웃이 파일을 지우면, 그 뒤 쓰기가 account 만 있는 반쪽 team.json 을 되살려
    // 로그인('이미 로그인')·로그아웃('로그인 전') 둘 다 막혔다
    let (d, kc, r) = logged("race");
    me_ok(&r, "[]");
    let d2 = d.clone();
    *r.on_send.borrow_mut() = Some(Box::new(move |p: &str| {
        if p.ends_with("/v0/me") {
            let _ = std::fs::remove_file(d2.join(crate::team_relay::STATE_FILE));
        }
    }));
    assert!(refresh_me(&d, &kc, &r).is_err());
    assert!(!d.join(crate::team_relay::STATE_FILE).exists(), "지워진 채로 둔다");
    // 방 찾기도
    let (d, kc, r) = logged("race-rooms");
    r.answer("/v0/me/rooms", 200, r#"{"rooms":[{"roomId":"rs","kind":"self","teamId":null,"memberIds":[]}]}"#);
    let d2 = d.clone();
    *r.on_send.borrow_mut() = Some(Box::new(move |p: &str| {
        if p.ends_with("/v0/me/rooms") {
            let _ = std::fs::remove_file(d2.join(crate::team_relay::STATE_FILE));
        }
    }));
    assert!(crate::team_relay::sync_rooms(&d, &kc, &r).is_err());
    assert!(!d.join(crate::team_relay::STATE_FILE).exists());
}
