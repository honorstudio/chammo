use super::*;
use std::io::{Read, Write};

fn ip(s: &str) -> Ipv4Addr {
    s.parse().unwrap()
}

fn st(self_ip: &str) -> TsStatus {
    TsStatus { ip: ip(self_ip), dns: Some("mac.ts.net".to_string()), peers: vec!["100.100.10.2".parse().unwrap()], certs: true, login: None }
}

#[test]
fn 테일스케일_주소가_없으면_안_연다() {
    // 아무것도 없음 · LAN 만 · 통신사 CGNAT(이름이 en0) — 전부 안 연다
    assert_eq!(plan(&[], || None, || None), None);
    assert_eq!(plan(&[("en0".into(), ip("192.168.0.31")), ("lo0".into(), ip("127.0.0.1"))], || None, || None), None);
    assert_eq!(plan(&[("en0".into(), ip("100.70.1.2"))], || Some(st("100.70.1.2")), || None), None);
    // utun 에 있어도 100.64/10 밖이면 아니다
    assert_eq!(plan(&[("utun3".into(), ip("10.8.0.2"))], || None, || None), None);
    // utun 100.x 인데 테일스케일 상태를 못 읽으면 안 연다
    assert_eq!(plan(&[("utun4".into(), ip("100.100.10.1"))], || None, || None), None);
}

#[test]
fn 인터페이스_100x_면_거기만() {
    let t = plan(&[("en0".into(), ip("192.168.0.2")), ("utun4".into(), ip("100.100.10.1"))], || Some(st("100.100.10.1")), || panic!("userspace 는 안 본다")).unwrap();
    assert_eq!(t.bind, IpAddr::V4(ip("100.100.10.1")));
    assert_eq!(t.dns.as_deref(), Some("mac.ts.net"));
    assert_eq!(t.peers, vec!["100.100.10.2".parse::<IpAddr>().unwrap()]);
}

#[test]
fn s2_다른_vpn_의_utun_100x_엔_묶지_않는다() {
    // Cloudflare WARP(100.96/12)·NetBird 도 utun 에 100.x — 테일스케일이 말한 내 주소와 같은 인터페이스에만
    assert_eq!(plan(&[("utun5".into(), ip("100.96.0.5"))], || Some(st("100.100.10.1")), || None), None);
    let t = plan(&[("utun5".into(), ip("100.96.0.5")), ("utun6".into(), ip("100.100.10.1"))], || Some(st("100.100.10.1")), || None).unwrap();
    assert_eq!(t.bind, IpAddr::V4(ip("100.100.10.1")));
    // WARP utun 만 있고 테일스케일은 userspace 면 127.0.0.1(WARP 주소에 안 묶음)
    let t = plan(&[("utun5".into(), ip("100.96.0.5"))], || None, || Some((st("100.100.10.1"), "/s".into()))).unwrap();
    assert_eq!(t.bind, IpAddr::V4(Ipv4Addr::LOCALHOST));
}

#[test]
fn userspace_면_127_0_0_1_만() {
    let t = plan(&[("en0".into(), ip("192.168.0.2"))], || None, || Some((st("100.100.10.1"), "/s".into()))).unwrap();
    assert_eq!(t.bind, IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert_eq!(t.ip, ip("100.100.10.1"));
    assert_eq!(t.socket, "/s");
    // 어떤 경우에도 0.0.0.0 이나 LAN 주소로 묶지 않는다
    assert!(!t.bind.is_unspecified());
}

#[test]
fn ps_에서_userspace_tailscaled_찾기() {
    let ps = "COMMAND\n/bin/zsh -c grep tailscaled --tun=userspace-networking\n/opt/homebrew/bin/tailscaled --tun=userspace-networking --socks5-server=localhost:1055 --socket=/Users/me/.ts/tailscaled.sock --statedir=/x\n";
    assert_eq!(userspace_socket(ps).as_deref(), Some("/Users/me/.ts/tailscaled.sock"));
    assert_eq!(userspace_socket("tailscaled --tun=userspace-networking --socket /tmp/s\n").as_deref(), Some("/tmp/s"));
    assert_eq!(userspace_socket("tailscaled --tun=userspace-networking\n").as_deref(), Some(""));
    // 커널 모드 tailscaled · 다른 프로그램 인자에 낀 글자는 아니다
    assert_eq!(userspace_socket("/usr/local/bin/tailscaled --tun=utun\n"), None);
    assert_eq!(userspace_socket("/bin/echo tailscaled --tun=userspace-networking\n"), None);
}

#[test]
fn tailscale_status_읽기() {
    let j = r#"{"BackendState":"Running","Self":{"DNSName":"mac.tail1.ts.net.","UserID":7,"TailscaleIPs":["fd7a:115c:a1e0::1","100.100.10.1"]},
      "Peer":{"k1":{"UserID":7,"TailscaleIPs":["100.100.10.2","fd7a:115c:a1e0::2"]},"k2":{"UserID":7,"Tags":[],"TailscaleIPs":["100.100.10.3"]}},
      "User":{"7":{"ID":7,"LoginName":"me@example.com"}}}"#;
    let s = parse_status(j).unwrap();
    assert_eq!((s.ip, s.dns.as_deref()), (ip("100.100.10.1"), Some("mac.tail1.ts.net")));
    let mut p: Vec<String> = s.peers.iter().map(|x| x.to_string()).collect();
    p.sort();
    assert_eq!(p, vec!["100.100.10.2", "100.100.10.3", "fd7a:115c:a1e0::2"]);
    assert_eq!(parse_status(r#"{"BackendState":"NeedsLogin","Self":{"TailscaleIPs":["100.100.10.1"]}}"#), None);
    assert_eq!(parse_status(r#"{"BackendState":"Running","Self":{"TailscaleIPs":["192.168.0.1"]}}"#), None);
    assert_eq!(parse_status("nope"), None);
}

#[test]
fn s2_맞은편은_같은_계정의_내_기기만() {
    // 공유받은 남의 노드·태그 노드도 피어로 받아 연결 16자리를 묶고 연결 요청 상한을 써 버릴 수 있었다(2026-10-21 리뷰 ④-5·6)
    let j = r#"{"BackendState":"Running","Self":{"UserID":7,"TailscaleIPs":["100.100.10.1"]},
      "Peer":{"phone":{"UserID":7,"TailscaleIPs":["100.100.10.2"]},"shared":{"UserID":9,"TailscaleIPs":["100.100.10.9"]},
              "tagged":{"UserID":7,"Tags":["tag:server"],"TailscaleIPs":["100.100.10.8"]}},
      "User":{"7":{"ID":7,"LoginName":"me@example.com"},"9":{"ID":9,"LoginName":"friend@example.com"}}}"#;
    let s = parse_status(j).unwrap();
    assert_eq!(s.peers, vec!["100.100.10.2".parse::<IpAddr>().unwrap()]);
    assert_eq!(s.login.as_deref(), Some("me@example.com"));
    // 계정을 모르면(UserID 없음) 피어는 아무도
    let s = parse_status(r#"{"BackendState":"Running","Self":{"TailscaleIPs":["100.100.10.1"]},"Peer":{"k":{"UserID":7,"TailscaleIPs":["100.100.10.2"]}}}"#).unwrap();
    assert!(s.peers.is_empty() && s.login.is_none());
}

#[test]
fn s2_맞은편은_테일넷_피어만() {
    let ps = Peers::new(vec!["100.100.10.2".parse().unwrap(), "fd7a:115c:a1e0::2".parse().unwrap()], || None);
    for ok in ["127.0.0.1", "::1", "::ffff:127.0.0.1", "100.100.10.2", "fd7a:115c:a1e0::2", "::ffff:100.100.10.2"] {
        assert!(ps.allows(ok.parse().unwrap()), "{ok}");
    }
    // 같은 100.64/10 이어도 피어 목록에 없으면(WARP·NetBird·남의 테일넷) 거절
    for bad in ["100.96.0.9", "100.64.0.1", "fd7a:115c:a1e0::99", "192.168.0.26", "8.8.8.8"] {
        assert!(!ps.allows(bad.parse().unwrap()), "{bad}");
    }
}

#[test]
fn s2_모르는_주소면_피어_목록을_다시_묻되_10초에_한_번() {
    use std::sync::atomic::AtomicUsize;
    let calls = Arc::new(AtomicUsize::new(0));
    let c2 = calls.clone();
    let ps = Peers::new(vec![], move || { c2.fetch_add(1, Ordering::Relaxed); Some(vec!["100.100.10.3".parse().unwrap()]) });
    ps.backdate(Duration::from_secs(11));
    assert!(ps.allows("100.100.10.3".parse().unwrap()), "새로 붙은 폰");
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    // 바로 다시 모르는 주소 — 10초 안이라 다시 묻지 않고 거절
    assert!(!ps.allows("100.96.0.9".parse().unwrap()));
    assert_eq!(calls.load(Ordering::Relaxed), 1);
}

#[test]
fn host_origin_목록() {
    let t = Tailnet { bind: IpAddr::V4(Ipv4Addr::LOCALHOST), ip: ip("100.100.10.1"), dns: Some("mac.ts.net".into()), socket: String::new(), peers: vec![], certs: true };
    assert_eq!(hosts(&t, 47123, false), vec!["100.100.10.1:47123", "mac.ts.net:47123", "127.0.0.1:47123", "localhost:47123"]);
    assert_eq!(hosts(&t, 47123, true), vec!["100.100.10.1:47123", "mac.ts.net:47123", "mac.ts.net", "127.0.0.1:47123", "localhost:47123"]);
    let o = origins(&t, 47123, true);
    assert!(o.contains(&"https://mac.ts.net".to_string()) && o.contains(&"http://100.100.10.1:47123".to_string()));
    // http://mac.ts.net(포트 없음)·https 의 100.x 는 아니다
    assert!(!o.contains(&"http://mac.ts.net".to_string()) && !o.iter().any(|x| x.starts_with("https://100.")));
    assert!(!origins(&t, 47123, false).iter().any(|x| x.starts_with("https://")));
}

#[test]
fn serve_설정은_우리_것만_만진다() {
    let t = "http://127.0.0.1:47123";
    assert_eq!(serve_state("{}", "mac.ts.net", t), ServeState::Free);
    let ours = r#"{"TCP":{"443":{"HTTPS":true}},"Web":{"mac.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:47123"}}}}}"#;
    assert_eq!(serve_state(ours, "mac.ts.net", t), ServeState::Ours);
    // 다른 포트로 넘기는 중·경로가 더 있음·TCP 만 잡혀 있음 = 남의 것
    assert!(matches!(serve_state(&ours.replace("47123", "3000"), "mac.ts.net", t), ServeState::Other(_)));
    let more = r#"{"Web":{"mac.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:47123"},"/x":{"Path":"/tmp"}}}}}"#;
    assert!(matches!(serve_state(more, "mac.ts.net", t), ServeState::Other(_)));
    assert!(matches!(serve_state(r#"{"TCP":{"443":{"TCPForward":"127.0.0.1:22"}}}"#, "mac.ts.net", t), ServeState::Other(_)));
}

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-mobile-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn 기본은_꺼짐() {
    let d = tmp("on");
    assert!(!saved_on(&d));
    save_on(&d, true).unwrap();
    assert!(saved_on(&d));
    save_on(&d, false).unwrap();
    assert!(!saved_on(&d));
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 잠금을_기다리는_사이_꺼졌으면_안_켠다() {
    // 설정 화면 켜기 시도(start) 뒤에 끄기를 누르면 저장은 off 인데 서버가 떠 있었다 — start 는 잠금을 잡은 뒤 저장값을 다시 본다
    let d = tmp("may");
    save_on(&d, true).unwrap();
    assert!(may_start(false, &d));
    assert!(!may_start(true, &d), "앱이 끝나는 중");
    save_on(&d, false).unwrap();
    assert!(!may_start(false, &d), "사람이 껐다");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 작업_기록은_끝만_줄_경계로() {
    assert_eq!(tail_lines("a\nb\nc\n".into(), 100), "a\nb\nc\n");
    assert_eq!(tail_lines("aaaa\nbb\ncc\n".into(), 5), "cc\n");
}

// ── 진짜 소켓으로 한 바퀴 ──

struct Stub;
impl Backend for Stub {
    fn env(&self) -> serde_json::Value { serde_json::json!({}) }
    fn sessions(&self) -> Result<String, String> { Ok("[]".into()) }
    fn hq_dir(&self) -> String { "/hq".into() }
    fn transcript(&self, _: &str, _: Option<u64>) -> serde_json::Value { serde_json::json!({}) }
    fn transcript_before(&self, _: &str, _: u64) -> serde_json::Value { serde_json::json!({}) }
    fn tasks(&self) -> String { String::new() }
    fn routines(&self) -> Result<String, String> { Ok("[]".into()) }
    fn usage(&self) -> String { "{}".into() }
    fn send(&self, _: &str, _: &str) -> Result<(), String> { Ok(()) }
    fn interrupt(&self, _: &str) -> Result<(), String> { Ok(()) }
    fn rename(&self, _: &str, _: &str) -> Result<(), String> { Ok(()) }
    fn remove(&self, _: &str) -> Result<String, String> { Ok(String::new()) }
    fn doc_html(&self, _: &Path) -> Option<String> { None }
    fn open_on_mac(&self, _: &str) -> Result<(), String> { Ok(()) }
    fn save_curation(&self, _: &str, _: &str, _: &str) -> Result<(), String> { Ok(()) }
    fn read_curation_state(&self, _: &str) -> String { String::new() }
    fn stop(&self, _: &str) -> Result<String, String> { Ok(String::new()) }
    fn routine(&self, _: &str, _: &str) -> Result<String, String> { Ok(String::new()) }
    fn asset(&self, _: &str) -> Option<(Vec<u8>, String)> { None }
    fn show_log(&self) -> String { String::new() }
    fn data_dir(&self) -> PathBuf { PathBuf::from("/nonexistent") }
    fn ctx_files(&self) -> Vec<String> { vec![] }
    fn attach(&self, _: &str, _: &[u8]) -> Result<String, String> { Err("no".into()) }
    fn jpeg(&self, _: &Path, _: Option<u32>) -> Option<Vec<u8>> { None }
    fn ql_thumb(&self, _: &Path, _: u32) -> Option<Vec<u8>> { None }
    fn avatars(&self) -> serde_json::Value { serde_json::json!([]) }
    fn avatar_image(&self, _: &str) -> Option<(Vec<u8>, &'static str)> { None }
    fn sessions_all(&self) -> Result<String, String> { Ok("[]".into()) }
    fn resume(&self, _: &str, _: &str, _: &str) -> Result<String, String> { Ok(String::new()) }
    fn spawn(&self, _: &str, _: &str) -> Result<String, String> { Ok(String::new()) }
    fn tails(&self, _: &[String]) -> serde_json::Value { serde_json::json!({}) }
    fn browser_lives(&self) -> serde_json::Value { serde_json::json!([]) }
    fn browser_frame(&self, _: &str, _: u64) -> Vec<u8> { vec![] }
    fn push_key(&self) -> Result<String, String> { Ok(String::new()) }
    fn push_subscribe(&self, _: &str, _: &str, _: &str, _: &str) -> Result<(), String> { Ok(()) }
    fn push_unsubscribe(&self, _: &str, _: &str) -> Result<(), String> { Ok(()) }
}

fn ask(addr: SocketAddr, raw: &str) -> String {
    let mut s = std::net::TcpStream::connect(addr).unwrap();
    s.write_all(raw.as_bytes()).unwrap();
    let mut out = String::new();
    let _ = s.read_to_string(&mut out);
    out
}

#[test]
fn 소켓으로_401_403_200() {
    let key = "a".repeat(64);
    let probe = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    let h = format!("127.0.0.1:{port}");
    let (stop, addrs) = serve(&[format!("127.0.0.1:{port}").parse().unwrap()], Gate { devices: Arc::new(crate::mobile_pair::Devices::with_token(&key, "시험")), hosts: vec![h.clone()], origins: vec![format!("http://{h}")], stops: Default::default(), sends: Default::default(), tickets: Default::default(), owner: None }, Arc::new(Stub), Arc::new(Peers::new(vec![], || None))).unwrap();
    let addr = addrs[0];
    assert!(ask(addr, &format!("GET /api/sessions HTTP/1.1\r\nHost: {h}\r\n\r\n")).starts_with("HTTP/1.1 401"));
    assert!(ask(addr, &format!("GET /api/sessions HTTP/1.1\r\nHost: evil.com\r\nAuthorization: Bearer {key}\r\n\r\n")).starts_with("HTTP/1.1 403"));
    let ok = ask(addr, &format!("GET /api/sessions HTTP/1.1\r\nHost: {h}\r\nAuthorization: Bearer {key}\r\n\r\n"));
    assert!(ok.starts_with("HTTP/1.1 200") && ok.ends_with("[]"), "{ok}");
    assert!(!ok.to_ascii_lowercase().contains("access-control"));
    // 멈추면 포트가 풀린다
    stop.store(true, Ordering::Relaxed);
    std::thread::sleep(Duration::from_millis(150));
    assert!(TcpListener::bind(format!("127.0.0.1:{port}")).is_ok());
}

// 2026-10-04 폰 첫 켜기 ③: 받는 고리가 연결이 없으면 50ms 씩 자서 요청마다 평균 25ms 를 더 기다렸다 — 들어오면 바로 받는다
#[test]
fn 쉬던_서버도_요청을_바로_받는다() {
    let key = "c".repeat(64);
    let probe = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    let h = format!("127.0.0.1:{port}");
    let (stop, addrs) = serve(&[h.parse().unwrap()], Gate { devices: Arc::new(crate::mobile_pair::Devices::with_token(&key, "시험")), hosts: vec![h.clone()], origins: vec![], stops: Default::default(), sends: Default::default(), tickets: Default::default(), owner: None }, Arc::new(Stub), Arc::new(Peers::new(vec![], || None))).unwrap();
    let req = format!("GET /api/sessions HTTP/1.1\r\nHost: {h}\r\nAuthorization: Bearer {key}\r\n\r\n");
    let mut total = Duration::ZERO;
    for i in 0..20u64 {
        std::thread::sleep(Duration::from_millis(17 + i % 7)); // 받는 고리가 쉬는 사이에 들어오게
        let t = std::time::Instant::now();
        assert!(ask(addrs[0], &req).starts_with("HTTP/1.1 200"));
        total += t.elapsed();
    }
    stop.store(true, Ordering::Relaxed);
    let avg = total / 20;
    assert!(avg < Duration::from_millis(10), "요청 평균 {avg:?} — 받는 고리가 자느라 늦다");
}

#[test]
fn s1_작업_기록_자르기는_한글_글자_중간에서_패닉하지_않는다() {
    // "가"는 3바이트 — 자를 자리가 글자 가운데에 오게
    let s = format!("{}\n{}\n마지막 줄\n", "가".repeat(100), "나".repeat(100));
    for max in 1..s.len() {
        let out = tail_lines(s.clone(), max);
        assert!(s.ends_with(&out), "max={max}");
        assert!(out.is_empty() || out.starts_with('나') || out.starts_with('마') || out.starts_with('가'), "줄 처음부터: max={max} {out:.10}");
    }
}

/// sessions() 가 패닉하는 Backend — 처리 스레드가 죽어도 연결 카운터가 새면 안 된다
struct Panicky;
impl Backend for Panicky {
    fn env(&self) -> serde_json::Value { serde_json::json!({}) }
    fn sessions(&self) -> Result<String, String> { panic!("일부러 패닉") }
    fn hq_dir(&self) -> String { "/hq".into() }
    fn transcript(&self, _: &str, _: Option<u64>) -> serde_json::Value { serde_json::json!({}) }
    fn transcript_before(&self, _: &str, _: u64) -> serde_json::Value { serde_json::json!({}) }
    fn tasks(&self) -> String { String::new() }
    fn routines(&self) -> Result<String, String> { Ok("[]".into()) }
    fn usage(&self) -> String { "{}".into() }
    fn send(&self, _: &str, _: &str) -> Result<(), String> { Ok(()) }
    fn interrupt(&self, _: &str) -> Result<(), String> { Ok(()) }
    fn rename(&self, _: &str, _: &str) -> Result<(), String> { Ok(()) }
    fn remove(&self, _: &str) -> Result<String, String> { Ok(String::new()) }
    fn doc_html(&self, _: &Path) -> Option<String> { None }
    fn open_on_mac(&self, _: &str) -> Result<(), String> { Ok(()) }
    fn save_curation(&self, _: &str, _: &str, _: &str) -> Result<(), String> { Ok(()) }
    fn read_curation_state(&self, _: &str) -> String { String::new() }
    fn stop(&self, _: &str) -> Result<String, String> { Ok(String::new()) }
    fn routine(&self, _: &str, _: &str) -> Result<String, String> { Ok(String::new()) }
    fn asset(&self, _: &str) -> Option<(Vec<u8>, String)> { None }
    fn show_log(&self) -> String { String::new() }
    fn data_dir(&self) -> PathBuf { PathBuf::from("/nonexistent") }
    fn ctx_files(&self) -> Vec<String> { vec![] }
    fn attach(&self, _: &str, _: &[u8]) -> Result<String, String> { Err("no".into()) }
    fn jpeg(&self, _: &Path, _: Option<u32>) -> Option<Vec<u8>> { None }
    fn ql_thumb(&self, _: &Path, _: u32) -> Option<Vec<u8>> { None }
    fn avatars(&self) -> serde_json::Value { serde_json::json!([]) }
    fn avatar_image(&self, _: &str) -> Option<(Vec<u8>, &'static str)> { None }
    fn sessions_all(&self) -> Result<String, String> { Ok("[]".into()) }
    fn resume(&self, _: &str, _: &str, _: &str) -> Result<String, String> { Ok(String::new()) }
    fn spawn(&self, _: &str, _: &str) -> Result<String, String> { Ok(String::new()) }
    fn tails(&self, _: &[String]) -> serde_json::Value { serde_json::json!({}) }
    fn browser_lives(&self) -> serde_json::Value { serde_json::json!([]) }
    fn browser_frame(&self, _: &str, _: u64) -> Vec<u8> { vec![] }
    fn push_key(&self) -> Result<String, String> { Ok(String::new()) }
    fn push_subscribe(&self, _: &str, _: &str, _: &str, _: &str) -> Result<(), String> { Ok(()) }
    fn push_unsubscribe(&self, _: &str, _: &str) -> Result<(), String> { Ok(()) }
}

#[test]
fn s1_처리_중_패닉이_20번_나도_서버는_계속_답한다() {
    let key = "b".repeat(64);
    let probe = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    let h = format!("127.0.0.1:{port}");
    let (stop, addrs) = serve(&[h.parse().unwrap()], Gate { devices: Arc::new(crate::mobile_pair::Devices::with_token(&key, "시험")), hosts: vec![h.clone()], origins: vec![], stops: Default::default(), sends: Default::default(), tickets: Default::default(), owner: None }, Arc::new(Panicky), Arc::new(Peers::new(vec![], || None))).unwrap();
    let addr = addrs[0];
    for _ in 0..(MAX_CONNS + 4) {
        let _ = ask(addr, &format!("GET /api/sessions HTTP/1.1\r\nHost: {h}\r\nAuthorization: Bearer {key}\r\n\r\n"));
    }
    std::thread::sleep(Duration::from_millis(200));
    let ok = ask(addr, &format!("GET /api/env HTTP/1.1\r\nHost: {h}\r\nAuthorization: Bearer {key}\r\n\r\n"));
    stop.store(true, Ordering::Relaxed);
    assert!(ok.starts_with("HTTP/1.1 200"), "패닉 뒤 먹통: {ok:?}");
}

#[test]
fn s3_funnel_이_켜져_있으면_공개로_보고_안_켠다() {
    let t = "http://127.0.0.1:47123";
    let ours_funnel = r#"{"TCP":{"443":{"HTTPS":true}},"Web":{"mac.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:47123"}}}},"AllowFunnel":{"mac.ts.net:443":true}}"#;
    assert_eq!(serve_state(ours_funnel, "mac.ts.net", t), ServeState::Funnel);
    // 다른 포트 funnel 이어도 그 이름이 인터넷에 열려 있으면 안 켠다
    assert!(funnel_open(r#"{"AllowFunnel":{"mac.ts.net:8443":true}}"#, "mac.ts.net"));
    assert!(!funnel_open(r#"{"AllowFunnel":{"mac.ts.net:443":false}}"#, "mac.ts.net"));
    assert!(!funnel_open(r#"{"AllowFunnel":{"other.ts.net:443":true}}"#, "mac.ts.net"));
    assert!(!funnel_open("{}", "mac.ts.net"));
}

#[test]
fn s6_개발판과_본판은_기본_포트가_달라_서로의_serve_를_우리_것으로_안_본다() {
    assert_eq!(port_from(None, false), 47123, "본판");
    assert_eq!(port_from(None, true), 47124, "개발판");
    assert_eq!(port_from(Some("50000"), false), 50000);
    assert_eq!(port_from(Some("엉터리"), true), 47124);
    // 본판이 걸어 둔 serve(→47123)를 개발판(47124)은 남의 것으로 본다 — 개발판을 끄면서 본판 serve 를 내리지 않게
    let prod = r#"{"Web":{"mac.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:47123"}}}}}"#;
    assert!(matches!(serve_state(prod, "mac.ts.net", "http://127.0.0.1:47124"), ServeState::Other(_)));
    assert_eq!(serve_state(prod, "mac.ts.net", "http://127.0.0.1:47123"), ServeState::Ours);
    // 앱이 끝날 때 부르는 정리 — 떠 있는 게 없어도 안전
    shutdown();
}

#[test]
fn r2_내_self_ip_도_맞은편으로_받는다() {
    // 인터페이스 모드: serve(→ http://100.x:포트)가 내 Self IP 에서 들어오고, 맥 브라우저 직접 접속도 Self IP
    let t = Tailnet { bind: IpAddr::V4(ip("100.100.10.1")), ip: ip("100.100.10.1"), dns: None, socket: String::new(), peers: vec!["100.100.10.2".parse().unwrap()], certs: true };
    let ps = Peers::new(allowed_peers(&t.ip, &t.peers), || None);
    assert!(ps.allows("100.100.10.1".parse().unwrap()));
    assert!(ps.allows("100.100.10.2".parse().unwrap()));
    assert!(!ps.allows("100.96.0.9".parse().unwrap()));
}

#[test]
fn r5_꺼진_채로_뜨면_남은_우리_serve_만_내린다() {
    let ours = r#"{"Web":{"mac.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:47124"}}}}}"#;
    let t = "http://127.0.0.1:47124";
    assert!(stale_state(false, &serve_state(ours, "mac.ts.net", t)), "강제 종료 뒤 남은 우리 것");
    assert!(!stale_state(true, &serve_state(ours, "mac.ts.net", t)), "켜 둔 상태면 start 가 다시 쓴다");
    assert!(!stale_state(false, &serve_state(&ours.replace("47124", "47123"), "mac.ts.net", t)), "본판 것은 안 건드린다");
    assert!(!stale_state(false, &serve_state("{}", "mac.ts.net", t)));
}

#[test]
fn r6_tcp_funnel_도_잡고_켜진_동안_걸리면_내린다() {
    // tailscale funnel --tcp 443 … — HTTP 헤더가 안 붙으니 문지기로는 못 막는다. 상태로 본다
    let tcp = r#"{"TCP":{"443":{"TCPForward":"127.0.0.1:47124"}},"AllowFunnel":{"mac.ts.net:443":true}}"#;
    assert!(funnel_open(tcp, "mac.ts.net"));
    assert!(funnel_guard(tcp, "mac.ts.net").is_some_and(|m| m.contains("funnel")));
    assert_eq!(funnel_guard(r#"{"Web":{}}"#, "mac.ts.net"), None);
}

#[test]
fn 윈도우_테일스케일_주소가_이_pc_것이면_목록에_넣는다() {
    // 윈도우엔 getifaddrs 가 없다 — 테일스케일이 말한 내 주소에 실제로 묶일 수 있으면(Wintun 'Tailscale' 어댑터) 그 하나만
    let local = |x: Ipv4Addr| x == ip("100.64.0.10");
    let v = ts_self_iface(Some(ip("100.64.0.10")), local);
    assert_eq!(v, vec![("tailscale".to_string(), ip("100.64.0.10"))]);
    // 그 목록이면 plan 이 그 주소에 묶는다(0.0.0.0·LAN 아님)
    let t = plan(&v, || Some(st("100.64.0.10")), || None).unwrap();
    assert_eq!(t.bind, IpAddr::V4(ip("100.64.0.10")));
}

#[test]
fn 윈도우_묶을_수_없거나_100x_가_아니면_빈_목록() {
    // 테일스케일 꺼짐 · 주소는 말하는데 이 PC 에 없음(어댑터 내려감) · 100.64/10 밖
    assert!(ts_self_iface(None, |_| true).is_empty());
    assert!(ts_self_iface(Some(ip("100.64.0.10")), |_| false).is_empty());
    assert!(ts_self_iface(Some(ip("192.168.0.5")), |_| true).is_empty());
}

#[test]
fn 테일스케일_cli_자리() {
    // 맥은 brew·앱 번들, 윈도우는 Program Files 아래 — 둘 다 후보에
    let mac = tailscale_candidates(false, None);
    assert!(mac.iter().any(|p| p == "/Applications/Tailscale.app/Contents/MacOS/Tailscale"));
    let win = tailscale_candidates(true, Some(r"C:\Program Files"));
    assert_eq!(win, vec![r"C:\Program Files\Tailscale\tailscale.exe".to_string()]);
    // ProgramFiles 를 못 읽으면 기본 자리
    assert_eq!(tailscale_candidates(true, None), vec![r"C:\Program Files\Tailscale\tailscale.exe".to_string()]);
}

fn iface_tailnet() -> Tailnet {
    Tailnet { bind: IpAddr::V4(ip("100.64.0.20")), ip: ip("100.64.0.20"), dns: Some("pc.ts.net".into()), socket: String::new(), peers: vec![], certs: true }
}

#[test]
fn w1_윈도우_serve_대상은_127_0_0_1_맥은_묶은_곳_그대로() {
    // 윈도우 tailscaled(서비스·Wintun)는 serve 백엔드로 자기 100.x 에 못 붙어 21초 뒤 502(윈도우 QA 실측) → 127.0.0.1
    let t = iface_tailnet();
    assert_eq!(serve_host(&t, true), IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert_eq!(serve_target_for(&t, 47123, true), "http://127.0.0.1:47123");
    // 맥 인터페이스 모드(utun)는 지금처럼 100.x — 바뀌면 안 된다
    assert_eq!(serve_host(&t, false), IpAddr::V4(ip("100.64.0.20")));
    assert_eq!(serve_target_for(&t, 47123, false), "http://100.64.0.20:47123");
    // 맥 userspace 는 원래 127.0.0.1
    let u = Tailnet { bind: IpAddr::V4(Ipv4Addr::LOCALHOST), ..iface_tailnet() };
    assert_eq!(serve_target_for(&u, 47124, false), "http://127.0.0.1:47124");
}

#[test]
fn w2_윈도우는_100x_와_127_0_0_1_둘_다_묶고_맥은_하나() {
    let t = iface_tailnet();
    let lo = IpAddr::V4(Ipv4Addr::LOCALHOST);
    assert_eq!(binds(&t, true), vec![t.bind, lo]);
    assert_eq!(binds(&t, false), vec![t.bind], "맥 인터페이스 모드는 100.x 하나 그대로");
    // 이미 127.0.0.1 이면 겹쳐 묶지 않는다
    let u = Tailnet { bind: lo, ..iface_tailnet() };
    assert_eq!(binds(&u, true), vec![lo]);
    assert_eq!(binds(&u, false), vec![lo]);
    // 어떤 경우에도 0.0.0.0·LAN 은 없다
    for b in binds(&t, true).into_iter().chain(binds(&t, false)) {
        assert!(b.is_loopback() || matches!(b, IpAddr::V4(v) if is_cgnat(v)), "{b}");
    }
}

#[test]
fn w3_윈도우_0_2_4_가_걸어_둔_100x_serve_는_우리_것으로_보고_갈아_끼운다() {
    let t = iface_tailnet();
    let old = r#"{"TCP":{"443":{"HTTPS":true}},"Web":{"pc.ts.net:443":{"Handlers":{"/":{"Proxy":"http://100.64.0.20:47123"}}}}}"#;
    let new = old.replace("100.64.0.20", "127.0.0.1");
    let st = |json: &str, win: bool| serve_state_for(json, "pc.ts.net", &t, 47123, win);
    assert_eq!(st(old, true), ServeState::Legacy, "옛 대상 = 우리 것(갈아 끼울 것)");
    assert_eq!(st(&new, true), ServeState::Ours);
    assert_eq!(st("{}", true), ServeState::Free);
    // 맥은 100.x 가 지금 대상이라 그대로 Ours, 127.0.0.1 은 남의 것(맥 동작 불변)
    assert_eq!(st(old, false), ServeState::Ours);
    assert!(matches!(st(&new, false), ServeState::Other(_)));
    // 포트가 다르면(개발판↔본판) 옛 것이어도 남의 것
    assert!(matches!(serve_state_for(old, "pc.ts.net", &t, 47124, true), ServeState::Other(_)));
    // 남의 100.x(다른 기기 주소)·경로가 더 있음 = 남의 것
    assert!(matches!(st(&old.replace("100.64.0.20", "100.64.0.21"), true), ServeState::Other(_)));
    let more = r#"{"Web":{"pc.ts.net:443":{"Handlers":{"/":{"Proxy":"http://100.64.0.20:47123"},"/x":{"Path":"C:\\tmp"}}}}}"#;
    assert!(matches!(st(more, true), ServeState::Other(_)));
    // funnel 이 먼저
    let f = r#"{"Web":{"pc.ts.net:443":{"Handlers":{"/":{"Proxy":"http://100.64.0.20:47123"}}}},"AllowFunnel":{"pc.ts.net:443":true}}"#;
    assert_eq!(st(f, true), ServeState::Funnel);
    // 꺼진 채로 뜨면 옛 것도 정리 대상, 켜 둔 상태면 start 가 갈아 끼운다
    assert!(stale_state(false, &st(old, true)));
    assert!(stale_state(false, &st(&new, true)));
    assert!(!stale_state(true, &st(old, true)));
    assert!(!stale_state(false, &st("{}", true)));
}

#[test]
fn w4_여러_주소에_묶고_하나라도_못_묶으면_다_푼다() {
    let key = "b".repeat(64);
    let probe = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    let gate = |h: &str| Gate { devices: Arc::new(crate::mobile_pair::Devices::with_token(&key, "시험")), hosts: vec![h.to_string(), format!("[::1]:{port}")], origins: vec![], stops: Default::default(), sends: Default::default(), tickets: Default::default(), owner: None };
    let h = format!("127.0.0.1:{port}");
    let v6: SocketAddr = format!("[::1]:{port}").parse().unwrap();
    let (stop, addrs) = serve(&[h.parse().unwrap(), v6], gate(&h), Arc::new(Stub), Arc::new(Peers::new(vec![], || None))).unwrap();
    assert_eq!(addrs.len(), 2);
    for a in &addrs {
        let ok = ask(*a, &format!("GET /api/sessions HTTP/1.1\r\nHost: {h}\r\nAuthorization: Bearer {key}\r\n\r\n"));
        assert!(ok.starts_with("HTTP/1.1 200"), "{a}: {ok}");
    }
    stop.store(true, Ordering::Relaxed);
    std::thread::sleep(Duration::from_millis(200));
    assert!(TcpListener::bind(&h).is_ok() && TcpListener::bind(v6).is_ok(), "멈추면 둘 다 풀린다");
    // 둘째 주소가 이미 잡혀 있으면 실패하고 첫째도 풀어 둔다(반만 열린 서버 금지)
    let hold = TcpListener::bind(v6).unwrap();
    assert!(serve(&[h.parse().unwrap(), v6], gate(&h), Arc::new(Stub), Arc::new(Peers::new(vec![], || None))).is_err());
    assert!(TcpListener::bind(&h).is_ok(), "첫째 주소가 남아 있으면 안 된다");
    drop(hold);
}

#[test]
fn w5_https_자기_확인_판정() {
    // 껍데기(/)는 열쇠 없이 200 — 2xx·3xx 면 열림
    assert_eq!(https_check_reason(Some(0), "200"), None);
    assert_eq!(https_check_reason(Some(0), "302"), None);
    // 윈도우 QA 실측: 21초 뒤 502 — serve 는 걸렸는데 백엔드에 못 붙음
    let r = https_check_reason(Some(0), "502").unwrap();
    assert!(r.contains("502"), "{r}");
    // curl 이 못 붙음·시간 초과·인증서 = 000 + 종료 코드
    assert!(https_check_reason(Some(28), "000").unwrap().contains("28"));
    assert!(https_check_reason(Some(60), "000").is_some());
    // curl 을 못 띄움·이상한 출력도 '열림'으로 보지 않는다
    assert!(https_check_reason(None, "").is_some());
    assert!(https_check_reason(Some(0), "엉터리").is_some());
    assert!(https_check_reason(Some(0), " 200\n").is_none(), "앞뒤 공백은 지운다");
}

#[test]
fn w6_https_자기_확인_인자() {
    let a = https_check_args_for("pc.ts.net", ip("100.64.0.20"), true);
    assert_eq!(a.last().map(String::as_str), Some("https://pc.ts.net/"));
    assert!(a.windows(2).any(|w| w == ["-o", "NUL"]), "윈도우는 NUL");
    assert!(https_check_args_for("pc.ts.net", ip("100.64.0.20"), false).windows(2).any(|w| w == ["-o", "/dev/null"]));
    assert!(a.windows(2).any(|w| w[0] == "--proto" && w[1] == "=https"), "https 만");
    assert!(a.iter().any(|x| x == "--max-time"), "매달리지 않게");
}

#[test]
fn w7_https_자기_확인은_dns·프록시·폐기_확인에_안_흔들린다() {
    // 이 PC 가 MagicDNS 를 안 쓰거나·HTTPS_PROXY 가 있거나·사내망이 인증서 폐기 확인을 막으면 폰에선 열리는 https 를 거짓으로 내렸다(리뷰)
    let a = https_check_args_for("pc.ts.net", ip("100.64.0.20"), true);
    assert!(a.windows(2).any(|w| w == ["--resolve", "pc.ts.net:443:100.64.0.20"]));
    assert!(a.windows(2).any(|w| w == ["--noproxy", "*"]));
    assert!(a.iter().any(|x| x == "--ssl-no-revoke"), "윈도우 Schannel 만");
    assert!(!https_check_args_for("pc.ts.net", ip("100.64.0.20"), false).iter().any(|x| x == "--ssl-no-revoke"), "맥 curl 엔 없는 옵션");
    assert_eq!(a.last().map(String::as_str), Some("https://pc.ts.net/"));
}

#[test]
fn w8_127_0_0_1_을_못_묶으면_100x_만_다시() {
    // 다른 프로그램이 127.0.0.1:포트를 쥐고 있으면 예전처럼 100.x http 라도 — https 는 끈다
    let t = iface_tailnet();
    assert_eq!(fallback_binds(&t, true), Some(vec![t.bind]));
    assert_eq!(fallback_binds(&t, false), None, "맥은 하나만 묶으니 대피로 없음");
    let u = Tailnet { bind: IpAddr::V4(Ipv4Addr::LOCALHOST), ..iface_tailnet() };
    assert_eq!(fallback_binds(&u, true), None);
}

// ── 재부팅 뒤 테일스케일이 앱보다 늦게 뜰 때(2026-10-20) — 켜 둔 상태면 다시 시도한다 ──

fn net(ip_s: &str) -> Tailnet {
    Tailnet { bind: IpAddr::V4(Ipv4Addr::LOCALHOST), ip: ip(ip_s), dns: Some("mac.ts.net".into()), socket: "/s".into(), peers: vec![], certs: true }
}

/// 가짜 바깥 — detect 는 nets 를 앞에서부터 하나씩(마지막 것은 계속), start 는 그 주소가 있으면 진짜 소켓을 연다
struct FakeKeep {
    on: bool,
    nets: Vec<Option<Tailnet>>,
    up: Option<(Tailnet, Arc<AtomicBool>, SocketAddr)>,
    starts: usize,
    logs: Vec<String>,
}

impl FakeKeep {
    fn new(on: bool, nets: Vec<Option<Tailnet>>) -> Self {
        FakeKeep { on, nets, up: None, starts: 0, logs: vec![] }
    }
    fn next_net(&mut self) -> Option<Tailnet> {
        if self.nets.len() > 1 { self.nets.remove(0) } else { self.nets[0].clone() }
    }
}

impl Keep for FakeKeep {
    fn on(&self) -> bool { self.on }
    fn running(&self) -> Option<Tailnet> { self.up.as_ref().map(|u| u.0.clone()) }
    fn detect(&mut self) -> Option<Tailnet> { self.next_net() }
    fn start(&mut self, _restart: bool) -> Result<(), String> {
        self.starts += 1;
        if let Some((_, stop, _)) = self.up.take() {
            stop.store(true, Ordering::Relaxed);
        }
        let t = self.next_net().ok_or("테일스케일 주소가 없어요")?;
        let gate = Gate { devices: Arc::new(crate::mobile_pair::Devices::with_token(&"d".repeat(64), "시험")), hosts: vec![], origins: vec![], stops: Default::default(), sends: Default::default(), tickets: Default::default(), owner: None };
        let (stop, addrs) = serve(&["127.0.0.1:0".parse().unwrap()], gate, Arc::new(Stub), Arc::new(Peers::new(vec![], || None))).map_err(|e| e.to_string())?;
        self.up = Some((t, stop, addrs[0]));
        Ok(())
    }
    fn log(&mut self, line: &str) { self.logs.push(line.to_string()) }
}

#[test]
fn 켜_둔_채_테일스케일이_늦게_뜨면_다시_시도해_서버가_뜬다() {
    let mut k = FakeKeep::new(true, vec![None, None, None, Some(net("100.100.10.1"))]);
    let mut st = KeepState::default();
    let t0 = std::time::Instant::now();
    let mut waits = vec![];
    for i in 0..4 {
        waits.push(keep_step(&mut k, &mut st, t0 + Duration::from_secs(5 * i)));
    }
    assert_eq!(k.starts, 4);
    assert_eq!(waits[..3], [Duration::from_secs(5); 3], "처음 2분은 5초마다");
    let (_, stop, addr) = k.up.clone().expect("네 번째에 떠야 한다");
    assert!(ask(addr, "GET /api/sessions HTTP/1.1\r\nHost: x\r\n\r\n").starts_with("HTTP/1.1 "), "진짜 소켓이 받는다");
    // 같은 이유 실패는 처음 한 번만, 살아나면 한 줄
    assert_eq!(k.logs, vec!["start failed: 테일스케일 주소가 없어요".to_string(), "started after 3 failed tries".to_string()]);
    // 떠 있으면 다시 켜지 않는다
    keep_step(&mut k, &mut st, t0 + Duration::from_secs(80));
    assert_eq!(k.starts, 4);
    stop.store(true, Ordering::Relaxed);
}

#[test]
fn 꺼_둔_상태면_다시_시도하지_않는다() {
    let mut k = FakeKeep::new(false, vec![Some(net("100.100.10.1"))]);
    let mut st = KeepState::default();
    let t0 = std::time::Instant::now();
    for i in 0..5 {
        assert_eq!(keep_step(&mut k, &mut st, t0 + Duration::from_secs(60 * i)), Duration::from_secs(60));
    }
    assert_eq!((k.starts, k.up.is_none(), k.logs.len()), (0, true, 0));
}

#[test]
fn 다시_시도는_2분_뒤엔_1분마다_켜고_끄면_처음부터() {
    let mut k = FakeKeep::new(true, vec![None]);
    let mut st = KeepState::default();
    let t0 = std::time::Instant::now();
    assert_eq!(keep_step(&mut k, &mut st, t0), Duration::from_secs(5));
    assert_eq!(keep_step(&mut k, &mut st, t0 + Duration::from_secs(115)), Duration::from_secs(5));
    assert_eq!(keep_step(&mut k, &mut st, t0 + Duration::from_secs(120)), Duration::from_secs(60));
    assert_eq!(keep_step(&mut k, &mut st, t0 + Duration::from_secs(600)), Duration::from_secs(60));
    assert_eq!(k.logs.len(), 1, "같은 이유는 한 번만: {:?}", k.logs);
    // 끄면 멈추고, 다시 켜면 빠른 구간부터
    k.on = false;
    let n = k.starts;
    keep_step(&mut k, &mut st, t0 + Duration::from_secs(660));
    assert_eq!(k.starts, n);
    k.on = true;
    assert_eq!(keep_step(&mut k, &mut st, t0 + Duration::from_secs(720)), Duration::from_secs(5));
    assert_eq!(k.logs.len(), 2, "끄고 켠 뒤 실패는 다시 적는다");
}

#[test]
fn 떠_있는데_테일스케일_주소가_바뀌면_새_주소로_다시_켠다() {
    let mut k = FakeKeep::new(true, vec![Some(net("100.100.10.1"))]);
    let mut st = KeepState::default();
    let t0 = std::time::Instant::now();
    keep_step(&mut k, &mut st, t0);
    assert_eq!(k.starts, 1);
    // 테일스케일이 잠깐 없으면(다시 뜨는 중) 서버는 그대로 둔다
    k.nets = vec![None];
    assert_eq!(keep_step(&mut k, &mut st, t0 + Duration::from_secs(60)), Duration::from_secs(60));
    assert_eq!((k.starts, k.up.is_some()), (1, true));
    // 같은 주소로 돌아오면 그대로
    k.nets = vec![Some(net("100.100.10.1"))];
    keep_step(&mut k, &mut st, t0 + Duration::from_secs(120));
    assert_eq!(k.starts, 1);
    // 다른 주소로 돌아오면 새 주소로 다시 켠다
    k.nets = vec![Some(net("100.100.10.9"))];
    keep_step(&mut k, &mut st, t0 + Duration::from_secs(180));
    assert_eq!(k.starts, 2);
    assert_eq!(k.up.as_ref().map(|u| u.0.ip), Some(ip("100.100.10.9")));
    assert!(k.logs.iter().any(|l| l.starts_with("tailnet changed")), "{:?}", k.logs);
    if let Some((_, stop, _)) = k.up.take() {
        stop.store(true, Ordering::Relaxed);
    }
}

// ── 남의 테일넷은 HTTPS 인증서가 기본 꺼짐(2026-10-22 '사용자 말고는 PWA 가 다 안 된다') ──
// 꺼진 테일넷에서 `tailscale serve --https` 는 '켜러 가세요' 주소를 찍고 기다리다 15초 제한에 죽어 "command timed out" 만 남았다.
// 폰은 http://100.x 로 열려 보안 안 된 출처 — 안드로이드는 설치가 막히고(크롬 '이 앱을 설치할 수 없습니다'), 알림 종은 숨고, 마이크도 안 된다

fn status_json(self_extra: &str, top: &str) -> String {
    format!(r#"{{"BackendState":"Running"{top},"Self":{{"DNSName":"mac.tail1.ts.net.","TailscaleIPs":["100.100.10.1"]{self_extra}}}}}"#)
}

#[test]
fn p1_tailscale_status_에서_https_인증서가_켜졌나_읽는다() {
    // 사용자 테일넷 모양 — Capabilities·CapMap 에 https, CertDomains 에 내 이름
    assert!(parse_status(&status_json(r#","Capabilities":["https"],"CapMap":{"https":null}"#, r#","CertDomains":["mac.tail1.ts.net"]"#)).unwrap().certs);
    assert!(parse_status(&status_json(r#","CapMap":{"https":null}"#, "")).unwrap().certs);
    assert!(parse_status(&status_json("", r#","CertDomains":["mac.tail1.ts.net"]"#)).unwrap().certs);
    // 새 테일넷 기본값 — https 로 시작하는 다른 권한 이름에 속지 않는다
    assert!(!parse_status(&status_json(r#","CapMap":{"https://tailscale.com/cap/ssh":null},"Capabilities":["https://tailscale.com/cap/file-sharing"]"#, r#","CertDomains":null"#)).unwrap().certs);
    assert!(!parse_status(&status_json("", r#","CertDomains":[]"#)).unwrap().certs);
}

#[test]
fn p2_https_를_못_거는_까닭은_serve_를_부르기_전에_가른다() {
    let t = iface_tailnet();
    assert_eq!(https_skip(&t, true), None);
    assert_eq!(https_skip(&t, false), Some(HttpsSkip::TestFolder));
    assert_eq!(https_skip(&Tailnet { dns: None, ..t.clone() }, true), Some(HttpsSkip::NoMagicDns));
    assert_eq!(https_skip(&Tailnet { certs: false, ..t.clone() }, true), Some(HttpsSkip::CertsOff));
    // 사람이 고칠 곳은 관리 화면 DNS 칸(MagicDNS·HTTPS Certificates 둘 다 거기) — 시험 폴더는 고칠 게 없다
    assert_eq!(HttpsSkip::CertsOff.fix_url(), Some(TS_DNS_ADMIN));
    assert_eq!(HttpsSkip::NoMagicDns.fix_url(), Some(TS_DNS_ADMIN));
    assert_eq!(HttpsSkip::TestFolder.fix_url(), None);
    // 안내는 무엇을 켤지 말한다 — "command timed out" 같은 말이 아니라
    assert!(HttpsSkip::CertsOff.note().contains("HTTPS"));
}

#[test]
fn p3_serve_를_건_뒤_진짜_걸렸나_다시_본다() {
    let t = Tailnet { bind: IpAddr::V4(Ipv4Addr::LOCALHOST), ..iface_tailnet() };
    let ours = r#"{"Web":{"pc.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:47123"}}}}}"#;
    assert_eq!(serve_took(ours, "pc.ts.net", &t, 47123, false), Ok(()));
    // tailscale 이 '켜러 가세요' 안내만 찍고 0 으로 끝난 경우 — 설정이 비어 있으면 https 가 아니다
    assert!(serve_took("{}", "pc.ts.net", &t, 47123, false).is_err());
    assert!(serve_took(r#"{"Web":{"pc.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:9999"}}}}}"#, "pc.ts.net", &t, 47123, false).is_err());
}

#[test]
fn p4_켜_둔_채_https_인증서가_켜지면_다시_띄워_https_로_간다() {
    let off = Tailnet { certs: false, ..net("100.100.10.1") };
    let on = Tailnet { certs: true, ..off.clone() };
    let mut k = FakeKeep::new(true, vec![Some(off.clone()), Some(off.clone()), Some(on.clone())]);
    let mut st = KeepState::default();
    let t0 = std::time::Instant::now();
    keep_step(&mut k, &mut st, t0); // 처음 켬(인증서 꺼짐 → http)
    keep_step(&mut k, &mut st, t0 + Duration::from_secs(60)); // 그대로
    assert_eq!(k.starts, 1);
    keep_step(&mut k, &mut st, t0 + Duration::from_secs(120)); // 사람이 관리 화면에서 켰다
    assert_eq!(k.starts, 2, "인증서가 켜지면 다시 띄워 serve 를 건다: {:?}", k.logs);
    assert!(k.logs.iter().any(|l| l.contains("https certificates on")), "{:?}", k.logs);
    keep_step(&mut k, &mut st, t0 + Duration::from_secs(180));
    assert_eq!(k.starts, 2, "한 번만");
    // 거꾸로(켜짐 → 꺼짐)는 다시 띄우지 않는다 — 떠 있는 https 를 굳이 내리지 않게
    let mut k2 = FakeKeep::new(true, vec![Some(on.clone()), Some(on), Some(off)]);
    let mut st = KeepState::default();
    for i in 0..3 {
        keep_step(&mut k2, &mut st, t0 + Duration::from_secs(60 * i));
    }
    assert_eq!(k2.starts, 1);
    for (_, stop, _) in [k.up, k2.up].into_iter().flatten() {
        stop.store(true, Ordering::Relaxed);
    }
}
