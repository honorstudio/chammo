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

#[test]
fn 시험_데이터_폴더면_기기_이름에_폴더를_붙인다() {
    // 같은 맥의 본판·시험판이 같은 컴퓨터 이름으로 떠서 기기 관리에서 무엇이 시험판인지 몰랐다(10-26 시험판이 다른 사람 계정에 붙어 있었다)
    let h = "/Users/me";
    assert_eq!(name_for_data("iMac", h, Path::new("/Users/me/.chammo")), "iMac");
    assert_eq!(name_for_data("iMac", h, Path::new("/Users/me/.honor-orchestrator")), "iMac");
    assert_eq!(name_for_data("iMac", h, Path::new("/Users/me/.chammo-team3")), "iMac (.chammo-team3)");
    assert_eq!(name_for_data("PC", "C:\\Users\\me", Path::new("C:\\Users\\me\\.chammo-qa")), "PC (.chammo-qa)");
    // 80자를 넘으면 컴퓨터 이름을 줄여서라도 폴더는 남긴다
    let long = name_for_data(&"m".repeat(90), h, Path::new("/Users/me/.chammo-recover"));
    assert!(device_name_ok(&long).is_some() && long.ends_with(" (.chammo-recover)"), "{long}");
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
        s.my_devices = vec![DeviceName { id: D7.into(), name: "맥북".into(), current: true, ..Default::default() }, DeviceName { id: D8.into(), name: "아이맥".into(), current: false, ..Default::default() }];
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
    r.answer(crate::team_relay::KEY_PROBE, 401, r#"{"error":"unauthorized"}"#); // 서버가 이 열쇠를 안다(또는 시계가 틀림)
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
fn 서버가_지운_기기는_계정_새로고침에서_끊김으로_적히고_로그아웃이_된다() {
    let _ports = crate::test_ports::lock();
    // 10-28 윈도우: 허용 대기 중 거절돼 기기 줄이 지워진 기기 — '다시 로그인'은 로그아웃부터라 401 에 막히면 영영 못 빠져나왔다
    let (d, kc, r) = logged("me-gone");
    r.devices.borrow_mut().clear();
    r.answer(crate::team_relay::KEY_PROBE, 404, r#"{"error":"not_found"}"#);
    assert!(refresh_me(&d, &kc, &r).unwrap_err().contains("다시 로그인"));
    assert!(crate::team_relay::load_state(&d).revoked);
    logout(&d, &kc, &r).unwrap();
    assert!(!d.join(crate::team_relay::STATE_FILE).exists() && kc.items.borrow().is_empty());
    // 대기로 적힌 기기가 거절돼 지워져도(/v0/me/self 401) 같은 길
    let (d3, kc3, r3) = logged("pending-gone");
    crate::team_relay::mutate(&d3, |s| s.pending = true).unwrap();
    r3.devices.borrow_mut().clear();
    r3.answer(crate::team_relay::KEY_PROBE, 404, r#"{"error":"not_found"}"#);
    assert!(refresh_me(&d3, &kc3, &r3).unwrap_err().contains("다시 로그인"));
    assert!(crate::team_relay::load_state(&d3).revoked);
    // 끊긴 줄 몰라도 로그아웃의 401 뒤 확인이 404 면 지운다
    let (d2, kc2, r2) = logged("logout-gone");
    r2.devices.borrow_mut().clear();
    r2.answer(crate::team_relay::KEY_PROBE, 404, r#"{"error":"not_found"}"#);
    logout(&d2, &kc2, &r2).unwrap();
    assert!(!d2.join(crate::team_relay::STATE_FILE).exists() && kc2.items.borrow().is_empty());
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
    assert!(login_with(&d, &kc, &r, &b, SERVER, "맥북", Duration::from_secs(1)).unwrap_err().contains("로그인을 진행하고 있어요"));
    assert!(crate::team_relay::create(&d, &kc, &r, SERVER, "팀", "지수", "맥북").is_err(), "로그인 중(사슬 전)엔 팀 만들기도 막힌다");
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

// ── 기기 로그인(ADR 0014) — 대기·허용·목록 칸 ──

#[test]
fn 로그인_마침이_대기면_대기로_적고_내_상태만_본다() {
    let _ports = crate::test_ports::lock();
    let d = dir("pending-login");
    let kc = Fake::default();
    let r = FakeRelay::default();
    begin_ok(&r, L1);
    r.answer("/v0/auth/google/finish", 201, r#"{"accountId":"a1","deviceId":"d7","email":"me@example.com","name":"지수","status":"pending"}"#);
    r.answer("/v0/me/self", 200, r#"{"status":"pending","pendingSince":1000,"autoAt":86401000,"computers":[]}"#);
    let b = FakeBrowser::new(&r, &["login={mine}&code=GOOD"]);
    let st = login_with(&d, &kc, &r, &b, SERVER, "맥북", Duration::from_secs(5)).unwrap();
    assert!(st.pending, "허용 기다림");
    assert_eq!(st.pending_auto_at, 86_401_000);
    let seen = r.seen.borrow();
    let fin = seen.iter().find(|(_, p, _, _)| p.ends_with("/finish")).unwrap();
    let kind = serde_json::from_str::<serde_json::Value>(&fin.3).unwrap()["kind"].as_str().unwrap().to_string();
    assert!(kind == "mac" || kind == "win", "컴퓨터 종류를 알린다: {kind}");
    assert!(seen.iter().all(|(_, p, _, _)| !p.ends_with("/v0/me") && !p.ends_with("/v0/me/devices")), "대기 기기는 /v0/me/self 만");
    // 종단 암호(chammo-relay ADR 0007) — 받는 열쇠·묶기 서명·봉인을 같이 싣고, nP 는 이 기기에만
    let fb: serde_json::Value = serde_json::from_str(&fin.3).unwrap();
    let k = crate::team_relay_keys::load(&kc, &st.key_account).unwrap().unwrap();
    assert_eq!(fb["e2ePub"], k.e2e_public());
    assert_eq!(fb["e2eSig"], k.e2e_key_sig());
    let n_p = crate::e2e_state::load(&d).my_np;
    let raw = |s: &str| base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, s).unwrap();
    assert_eq!(fb["approveCommit"], crate::e2e_chain::approve_commit(&raw(&k.public()), &raw(&k.e2e_public()), &raw(&n_p)));
    assert!(!fin.3.contains(&n_p), "nP 는 서버로 안 나간다");
}

#[test]
fn 대기_기기는_허용되면_목록을_받는다() {
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("pending-refresh");
    crate::team_relay::mutate(&d, |s| s.pending = true).unwrap();
    r.answer("/v0/me/self", 200, r#"{"status":"pending","pendingSince":1000,"autoAt":5000,"computers":[]}"#);
    let st = refresh_me(&d, &kc, &r).unwrap();
    assert!(st.pending);
    assert_eq!(r.seen.borrow().len(), 1);
    r.answer("/v0/me/self", 200, r#"{"status":"approved","computers":[]}"#);
    me_ok(&r, "[]");
    let st = refresh_me(&d, &kc, &r).unwrap();
    assert!(!st.pending, "허용됐다");
    assert_eq!(st.my_devices.len(), 2);
}

#[test]
fn 옛_판에서_로그인해_서버만_대기인_기기도_대기로_알아챈다() {
    // 10-26 아이맥: 0.4.1 이 로그인(서버는 pending)하고 0.4.2 로 다시 켜짐 — team.json 엔 pending 칸이 없어 관문 없이 모든 요청이 403 device_pending 이었다
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("pending-server-only");
    r.answer("/v0/me", 403, r#"{"error":"device_pending"}"#);
    r.answer("/v0/me/self", 200, r#"{"status":"pending","pendingSince":1000,"autoAt":5000,"computers":[]}"#);
    let st = refresh_me(&d, &kc, &r).unwrap();
    assert!(st.pending, "서버 말로 대기를 적는다");
    assert_eq!(st.pending_auto_at, 5000);
    assert_eq!(crate::e2e_flow::self_step(&d), "relogin", "봉인(nP)이 없는 대기 기기는 숫자를 못 띄운다 — 다시 로그인");
    // 그사이 허용됐으면 대기로 적지 않는다
    let (d, kc, r) = logged("pending-server-race");
    r.answer("/v0/me", 403, r#"{"error":"device_pending"}"#);
    r.answer("/v0/me/self", 200, r#"{"status":"approved","computers":[]}"#);
    assert!(refresh_me(&d, &kc, &r).is_err());
    assert!(!crate::team_relay::load_state(&d).pending);
    // 공격 리뷰: 사슬에 든 기기는 서버가 대기라 해도 안 믿는다 — 대기 화면의 '로그인 취소'로 스스로 사슬에서 빠지게 꾀지 못하게
    let (d, kc, r) = logged("pending-server-inchain");
    let k = crate::team_relay::device_keys(&kc, &crate::team_relay::load_state(&d)).unwrap();
    let body = serde_json::json!({ "v": 1, "account": "a1", "seq": 0, "prev": "", "by": D7, "kind": "genesis", "device": D7, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    let g = crate::e2e_chain::Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{body}")), body };
    let head = crate::e2e_chain::link_hash(&g.body, &g.sig);
    crate::e2e_state::pin_first(&d, "a1", vec![g], &head, 0, &head).unwrap();
    assert!(crate::e2e_team::in_chain(&d, &crate::team_relay::load_state(&d)), "시험 준비: 사슬에 든 기기");
    r.answer("/v0/me", 403, r#"{"error":"device_pending"}"#);
    r.answer("/v0/me/self", 200, r#"{"status":"pending","pendingSince":1000,"autoAt":5000,"computers":[]}"#);
    assert!(refresh_me(&d, &kc, &r).is_err());
    assert!(!crate::team_relay::load_state(&d).pending);
    // 다른 403(폰·막힘)은 대기가 아니다
    let (d, kc, r) = logged("pending-server-other");
    r.answer("/v0/me", 403, r#"{"error":"forbidden"}"#);
    assert!(refresh_me(&d, &kc, &r).is_err());
    assert!(!crate::team_relay::load_state(&d).pending);
    assert!(r.seen.borrow().iter().all(|(_, p, _, _)| !p.ends_with("/v0/me/self")));
}

#[test]
fn 대기_기기는_로그아웃으로_자기를_빼고_다시_로그인할_수_있다() {
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("pending-logout");
    crate::team_relay::mutate(&d, |s| s.pending = true).unwrap();
    r.answer(&format!("/v0/me/devices/{D7}/revoke"), 200, r#"{"ok":true}"#);
    logout(&d, &kc, &r).unwrap();
    let seen = r.seen.borrow();
    assert_eq!(seen.len(), 1, "대기 기기가 부를 수 있는 길(자기 빼기)만: {:?}", seen.iter().map(|x| &x.1).collect::<Vec<_>>());
    assert!(!d.join(crate::team_relay::STATE_FILE).exists() && kc.items.borrow().is_empty());
}

#[test]
fn 기기_목록에_종류·상태·마지막·요청_곳을_적는다() {
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("fields");
    r.answer("/v0/me", 200, r#"{"account":{"id":"a1","email":"me@example.com","name":"지수"},"device":{"id":"d7","name":"맥북"},"teams":[]}"#);
    r.answer("/v0/me/devices", 200, r#"{"devices":[
      {"id":"d7","name":"맥북","kind":"mac","status":"approved","lastSeen":9000,"createdAt":1,"current":true},
      {"id":"d9","name":"iPhone","kind":"phone","status":"pending","lastSeen":null,"createdAt":5,"current":false,"reqCountry":"KR","reqCity":"Seoul","pendingSince":5},
      {"id":"da","name":"아이패드","kind":"phone","status":"approved","approvedBy":"auto","createdAt":7,"current":false},
      {"id":"dx","name":"이상한","kind":"toaster","status":"weird","approvedBy":"robot","createdAt":6,"current":false},
      {"id":"../x","name":"길","kind":"phone","status":"pending","createdAt":8,"current":false},
      {"id":"db","name":"먼 미래","kind":"mac","status":"approved","lastSeen":99999999999999999,"pendingSince":18446744073709551615,"createdAt":9,"current":false}]}"#);
    let st = refresh_me(&d, &kc, &r).unwrap();
    let p = st.my_devices.iter().find(|x| x.id == "d9").unwrap();
    assert_eq!((p.kind.as_str(), p.status.as_str(), p.req_city.as_str(), p.pending_since), ("phone", "pending", "Seoul", Some(5)));
    assert_eq!(st.my_devices.iter().find(|x| x.id == "d7").unwrap().last_seen, Some(9000));
    let x = st.my_devices.iter().find(|x| x.id == "dx").unwrap();
    assert_eq!((x.kind.as_str(), x.status.as_str()), ("", "approved"), "모르는 종류는 비우고, 모르는 상태는 허용으로 본다(서버가 막는 쪽)");
    assert_eq!(x.approved_by, "", "모르는 허용 주체는 비움");
    assert_eq!(st.my_devices.iter().find(|x| x.id == "da").unwrap().approved_by, "auto", "24시간 자동 허용");
    assert!(st.my_devices.iter().all(|x| x.id != "../x"), "모양이 틀린 기기 id 줄은 버린다(리뷰 5)");
    assert_eq!(st.my_devices.iter().find(|x| x.id == "db").unwrap().last_seen, None, "말이 안 되는 시각은 버린다");
}

#[test]
fn 허용·거절은_그_기기_길로만_보내고_목록을_다시_받는다() {
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("decide");
    r.answer(&format!("/v0/me/devices/{D8}/approve"), 200, r#"{"ok":true}"#);
    me_ok(&r, "[]");
    decide_device(&d, &kc, &r, D8, true).unwrap();
    r.answer(&format!("/v0/me/devices/{D8}/reject"), 409, r#"{"error":"not_pending","status":"rejected","approvedBy":null}"#);
    me_ok(&r, "[]");
    decide_device(&d, &kc, &r, D8, false).expect("다른 기기에서 먼저 같은 쪽(거절)으로 처리 — 실패가 아니다");
    // 결과가 바란 쪽과 다르면 실제 결과를 말한다(서버 409 몸통) — 24시간 경계에서 거절이 늦으면 '자동으로 허용됐어요'
    r.answer(&format!("/v0/me/devices/{D8}/reject"), 409, r#"{"error":"not_pending","status":"approved","approvedBy":"auto"}"#);
    me_ok(&r, "[]");
    let e = decide_device(&d, &kc, &r, D8, false).unwrap_err();
    assert!(e.contains("자동으로 허용") && e.contains("빼기"), "{e}");
    r.answer(&format!("/v0/me/devices/{D8}/reject"), 409, r#"{"error":"not_pending","status":"approved","approvedBy":"human"}"#);
    me_ok(&r, "[]");
    assert!(decide_device(&d, &kc, &r, D8, false).unwrap_err().contains("이미 허용"));
    r.answer(&format!("/v0/me/devices/{D8}/approve"), 409, r#"{"error":"not_pending","status":"rejected"}"#);
    me_ok(&r, "[]");
    assert!(decide_device(&d, &kc, &r, D8, true).unwrap_err().contains("거절"));
    let paths: Vec<String> = r.seen.borrow().iter().filter(|(m, _, _, _)| m == "POST").take(2).map(|(_, p, _, _)| p.clone()).collect();
    assert_eq!(paths, vec![format!("/v0/me/devices/{D8}/approve"), format!("/v0/me/devices/{D8}/reject")]);
    for bad in ["../me/delete", "x/approve", ""] {
        assert!(decide_device(&d, &kc, &r, bad, true).is_err(), "{bad}");
    }
    assert!(decide_device(&d, &kc, &r, D7, true).is_err(), "이 기기 자신은 허용 못 한다");
    crate::team_relay::mutate(&d, |s| s.pending = true).unwrap();
    assert!(decide_device(&d, &kc, &r, D8, true).is_err(), "대기 중인 기기는 남을 허용 못 한다");
}

#[test]
fn 허용이_서버에_들어갔으면_목록_다시_받기가_막혀도_성공() {
    // 10-28 윈도우 — 중계가 '잠시 쉬래요'(429)인 동안 허용을 누르면 서버엔 허용이 들어갔는데 목록 받기 실패로 오류가 떠 카드가 그대로 남았다
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("decide-429");
    r.answer(&format!("/v0/me/devices/{D8}/approve"), 200, r#"{"ok":true}"#);
    r.answer("/v0/me", 429, r#"{"error":"rate_limited"}"#);
    decide_device(&d, &kc, &r, D8, true).expect("허용은 됐다 — 목록은 다음 바퀴에 받는다");
}

/// 로그인 필수(10-24 사용자) — 한 번 로그인하면 다시 켜도·서버가 잠깐 안 닿아도 그대로. 지우는 건 사람의 '이 기기 빼기'(logout)뿐
#[test]
fn 한_번_로그인하면_다시_켜도_망_오류에도_유지된다() {
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("persist");
    // 다시 켠 것처럼 — 파일·키체인에서 다시 읽는다
    let st = crate::team_relay::load_state(&d);
    assert!(st.account.is_some() && st.registered());
    assert!(crate::team_relay::device_keys(&kc, &st).is_ok(), "기기 열쇠는 키체인에 그대로");
    // 서버가 잠깐 이상해도(5xx·401) 로그인을 지우지 않는다
    r.answer("/v0/me", 503, r#"{"error":"down"}"#);
    assert!(refresh_me(&d, &kc, &r).is_err());
    r.answer("/v0/me", 401, r#"{"error":"unauthorized"}"#);
    r.answer(crate::team_relay::KEY_PROBE, 401, r#"{"error":"unauthorized"}"#); // 서버가 이 열쇠를 안다 — 시계 탓일 수 있다
    assert!(refresh_me(&d, &kc, &r).is_err());
    let st = crate::team_relay::load_state(&d);
    assert!(st.account.is_some() && !st.revoked, "로그인 유지");
    assert_eq!(st.my_devices.len(), 2, "목록도 그대로");
}

#[test]
fn 로그인_마침의_거절_열쇠·대기_초과는_사람_말로() {
    let _ports = crate::test_ports::lock();
    for (code, body, want) in [(403, r#"{"error":"key_rejected"}"#, "거절"), (429, r#"{"error":"too_many_pending"}"#, "5")] {
        let d = dir(&format!("finish-{code}"));
        let kc = Fake::default();
        let r = FakeRelay::default();
        begin_ok(&r, L1);
        r.answer("/v0/auth/google/finish", code, body);
        let b = FakeBrowser::new(&r, &["login={mine}&code=GOOD"]);
        let e = login_with(&d, &kc, &r, &b, SERVER, "맥북", Duration::from_secs(5)).unwrap_err();
        assert!(e.contains(want), "{code}: {e}");
    }
}

#[test]
fn 허용_대기_기기는_빼기로_못_지운다_거절은_카드로() {
    // 리뷰 2차 하③: 대기 기기 빼기 = 거절(서버 삭제) — 사람 손 길(카드)만
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("revoke-pending");
    crate::team_relay::mutate(&d, |s| s.my_devices[1].status = "pending".into()).unwrap();
    let e = revoke_device(&d, &kc, &r, D8).unwrap_err();
    assert!(e.contains("카드"), "{e}");
    assert!(r.seen.borrow().is_empty(), "서버에 안 보냈다");
}

#[test]
fn 진짜_서버처럼_null_이_든_줄도_읽는다() {
    // 10-24 로컬 중계 끝까지 시험에서 잡음: 서버는 reqCountry·reqCity·approvedBy·lastSeen·kind 를 null 로 준다 — 글자 칸이 null 에 걸려 목록이 통째로 비었다
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("nulls");
    r.answer("/v0/me", 200, r#"{"account":{"id":"a1","email":"me@example.com","name":"지수"},"device":{"id":"d7","name":"맥북"},"teams":[]}"#);
    r.answer("/v0/me/devices", 200, r#"{"devices":[{"id":"d7","name":"맥북","kind":"mac","status":"approved","lastSeen":null,"createdAt":1,"current":true,"reqCountry":null,"reqCity":null,"pendingSince":null,"approvedBy":null},{"id":"d8","name":null,"kind":null,"status":"pending","lastSeen":null,"createdAt":2,"current":false,"reqCountry":"KR","reqCity":null,"pendingSince":5,"approvedBy":null}]}"#);
    let st = refresh_me(&d, &kc, &r).unwrap();
    assert_eq!(st.my_devices.len(), 2, "{:?}", st.my_devices);
    assert!(st.my_devices[1].pending());
    assert_eq!(st.my_devices[1].req_country, "KR");
    // 재리뷰 4: id 가 null 이거나 줄 모양이 아주 틀려도 그 줄만 버린다(목록 통째로 비지 않게) — 숫자 칸 null 은 0
    r.answer("/v0/me", 200, r#"{"account":{"id":"a1","email":"me@example.com","name":"지수"},"device":{"id":"d7","name":"맥북"},"teams":[]}"#);
    r.answer("/v0/me/devices", 200, r#"{"devices":[{"id":"d7","name":"맥북","createdAt":null,"current":true},{"id":null,"name":"x"},"엉뚱한 줄",{"id":"d9","name":"폰","kind":"phone","status":"pending","createdAt":3,"current":"yes"}]}"#);
    let st = refresh_me(&d, &kc, &r).unwrap();
    assert_eq!(st.my_devices.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["d7"], "{:?}", st.my_devices);
    assert_eq!(st.my_devices[0].created_at, 0);
}

/// 이 기기(D7)와 D8 이 둘 다 든 계정 사슬을 믿는 상태로(chammo-relay ADR 0007)
fn chain_with_d8(d: &std::path::Path, kc: &Fake) -> Vec<crate::e2e_chain::Link> {
    use crate::e2e_chain::{link_hash, Link};
    let st = crate::team_relay::load_state(d);
    let k = crate::team_relay_keys::load(kc, &st.key_account).unwrap().unwrap();
    let k8 = crate::team_relay_keys::DeviceKeys::from_seeds([8; 32], [9; 32]);
    let gb = serde_json::json!({ "v": 1, "account": "a1", "seq": 0, "prev": "", "by": D7, "kind": "genesis", "device": D7, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    let g = Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{gb}")), body: gb };
    let ab = serde_json::json!({ "v": 1, "account": "a1", "seq": 1, "prev": link_hash(&g.body, &g.sig), "by": D7, "kind": "add", "device": D8, "edPub": k8.public(), "e2ePub": k8.e2e_public(), "selfSig": k8.e2e_key_sig() }).to_string();
    let a = Link { seq: 1, sig: k.sign(&format!("chammo-chain/1\n{ab}")), body: ab };
    crate::e2e_state::seed_trusted(d, "a1", vec![g.clone(), a.clone()]);
    vec![g, a]
}

#[test]
fn 참모_길은_사슬에_든_기기를_못_뺀다() {
    // 리뷰 B 중간 7 — 남의 기기 사슬 빼기(remove)는 사람 카드 몫. scripts/team devices remove --yes 는 사슬 밖 기기만
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("agent-remove");
    let links = chain_with_d8(&d, &kc);
    r.answer("/v0/accounts/a1/chain", 200, &serde_json::json!({ "links": links }).to_string());
    let e = revoke_device_agent(&d, &kc, &r, D8).unwrap_err();
    assert!(e.contains("사람이"), "{e}");
    assert!(!r.seen.borrow().iter().any(|(m, _, _, _)| m == "POST"), "끊기·고리 요청 없이");
}

#[test]
fn 사슬_빼기_고리가_실패하면_끊기도_멈춘다() {
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("remove-fail");
    let links = chain_with_d8(&d, &kc);
    r.answer("/v0/accounts/a1/chain", 200, &serde_json::json!({ "links": links }).to_string());
    r.answer("/v0/me/chain", 409, r#"{"error":"stale_head"}"#);
    assert!(revoke_device(&d, &kc, &r, D8).is_err());
    assert!(!r.seen.borrow().iter().any(|(_, p, _, _)| p.ends_with("/revoke")), "고리가 실패하면 끊지 않는다(사슬에 기기가 남는 것 막기)");
}

#[test]
fn 공격_중_내_사슬이_바뀌어도_훔친_기기는_끊을_수_있다() {
    // 2차 리뷰 높음 3(R5) — 바뀐 사슬에선 remove 고리가 늘 실패해 서버 끊기까지 막혔다
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("revoke-changed");
    let links = chain_with_d8(&d, &kc);
    let kz = crate::team_relay_keys::DeviceKeys::from_seeds([70; 32], [71; 32]);
    let body = serde_json::json!({ "v": 1, "account": "a1", "seq": 2, "prev": crate::e2e_chain::link_hash(&links[1].body, &links[1].sig), "by": "dz", "kind": "reset", "device": "dz", "edPub": kz.public(), "e2ePub": kz.e2e_public() }).to_string();
    let x = crate::e2e_chain::Link { seq: 2, sig: kz.sign(&format!("chammo-chain/1\n{body}")), body };
    r.answer("/v0/accounts/a1/chain", 200, &serde_json::json!({ "links": [links[0].clone(), links[1].clone(), x] }).to_string());
    r.answer(&format!("/v0/me/devices/{D8}/revoke"), 200, r#"{"ok":true}"#);
    revoke_device(&d, &kc, &r, D8).unwrap();
    assert!(r.seen.borrow().iter().any(|(_, p, _, _)| p.ends_with("/revoke")), "고리 없이도 끊는다");
    assert!(!r.seen.borrow().iter().any(|(m, p, _, _)| m == "POST" && p == "/v0/me/chain"));
}

#[test]
fn 공격_서버가_사슬_밖이라고_해도_참모_길은_내가_검증한_사슬로_막는다() {
    // 3차 리뷰 중간(R6) — 참모 길이 서버 inChain 을 믿어, false 거짓말이면 사슬 기기를 뺐다
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("agent-lie");
    let links = chain_with_d8(&d, &kc);
    r.answer("/v0/me/devices", 200, &serde_json::json!({ "devices": [{ "id": D8, "name": "아이맥", "status": "approved", "inChain": false }] }).to_string());
    r.answer("/v0/accounts/a1/chain", 200, &serde_json::json!({ "links": links }).to_string());
    assert!(revoke_device_agent(&d, &kc, &r, D8).unwrap_err().contains("사람이"));
    assert!(!r.seen.borrow().iter().any(|(m, _, _, _)| m == "POST"));
}

#[test]
fn 참모_길은_사슬_밖_기기를_고리_없이_서버에서만_끊는다() {
    // R6 — 참모·scripts 길은 사슬 고리를 안 쓴다
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("agent-outside");
    let links = chain_with_d8(&d, &kc);
    let other = "99999999-9999-4999-8999-999999999999";
    r.answer("/v0/accounts/a1/chain", 200, &serde_json::json!({ "links": links }).to_string());
    r.answer(&format!("/v0/me/devices/{other}/revoke"), 200, r#"{"ok":true}"#);
    revoke_device_agent(&d, &kc, &r, other).unwrap();
    assert!(r.seen.borrow().iter().any(|(_, p, _, _)| p.ends_with("/revoke")));
    assert!(!r.seen.borrow().iter().any(|(_, p, _, _)| p == "/v0/me/chain"), "고리 없이");
}

#[test]
fn 로그인_서버는_적은_것_이_기기_team_json_로그아웃_전에_쓰던_것_기본_순서() {
    // QA 4(10-25) — '처음부터'(로그아웃 뒤 로그인)·첫 로그인이 기본 중계로 갔다
    let d = std::env::temp_dir().join(format!("chammo-login-server-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    assert_eq!(login_server(&d, ""), crate::team_relay::DEFAULT_SERVER, "아무것도 없으면 기본");
    crate::team_relay::mutate(&d, |s| s.server = "http://localhost:8797".into()).unwrap();
    assert_eq!(login_server(&d, ""), "http://localhost:8797", "team.json 에 적힌 서버 먼저");
    assert_eq!(login_server(&d, "https://relay.example.test"), "https://relay.example.test", "사람이 적은 서버가 이긴다");
    // 로그아웃(forget_local) 뒤에도 쓰던 서버를 기억한다
    crate::team_relay::forget_local(&d, &Fake::default()).unwrap();
    assert_eq!(crate::team_relay::load_state(&d).server, "", "team.json 은 지워졌다");
    assert_eq!(login_server(&d, ""), "http://localhost:8797", "로그아웃 전에 쓰던 서버");
}

#[test]
fn 로그인_막힘_문구는_해요체_사람_말() {
    // QA 7·11(10-25) — '이미 로그인돼 있어 — 다른 계정은 로그아웃 뒤에'(반말·막다른 길)
    let _ports = crate::test_ports::lock();
    let (d, kc, r) = logged("already-in");
    struct Never;
    impl Opener for Never {
        fn open(&self, _: &str) -> Result<(), String> {
            Err("열면 안 됨".into())
        }
    }
    let e = login_with(&d, &kc, &r, &Never, "", "맥북", std::time::Duration::from_millis(10)).unwrap_err();
    assert!(e.contains("이미 이 기기는 로그인돼 있어요"), "{e}");
    let _turn = login_turn(&d).unwrap();
    assert!(login_turn(&d).err().unwrap().contains("로그인을 진행하고 있어요"));
}
