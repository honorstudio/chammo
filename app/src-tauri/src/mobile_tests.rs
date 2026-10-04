use super::*;
use std::io::{Read, Write};

fn ip(s: &str) -> Ipv4Addr {
    s.parse().unwrap()
}

fn st(self_ip: &str) -> TsStatus {
    TsStatus { ip: ip(self_ip), dns: Some("mac.ts.net".to_string()), peers: vec!["100.100.10.2".parse().unwrap()] }
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
    let j = r#"{"BackendState":"Running","Self":{"DNSName":"mac.tail1.ts.net.","TailscaleIPs":["fd7a:115c:a1e0::1","100.100.10.1"]},
      "Peer":{"k1":{"TailscaleIPs":["100.100.10.2","fd7a:115c:a1e0::2"]},"k2":{"TailscaleIPs":["100.100.10.3"]}}}"#;
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
    let t = Tailnet { bind: IpAddr::V4(Ipv4Addr::LOCALHOST), ip: ip("100.100.10.1"), dns: Some("mac.ts.net".into()), socket: String::new(), peers: vec![] };
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
    let (stop, addr) = serve(format!("127.0.0.1:{port}").parse().unwrap(), Gate { devices: Arc::new(crate::mobile_pair::Devices::with_token(&key, "시험")), hosts: vec![h.clone()], origins: vec![format!("http://{h}")], stops: Default::default(), sends: Default::default(), tickets: Default::default() }, Arc::new(Stub), Arc::new(Peers::new(vec![], || None))).unwrap();
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
    let (stop, addr) = serve(h.parse().unwrap(), Gate { devices: Arc::new(crate::mobile_pair::Devices::with_token(&key, "시험")), hosts: vec![h.clone()], origins: vec![], stops: Default::default(), sends: Default::default(), tickets: Default::default() }, Arc::new(Panicky), Arc::new(Peers::new(vec![], || None))).unwrap();
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
    let t = Tailnet { bind: IpAddr::V4(ip("100.100.10.1")), ip: ip("100.100.10.1"), dns: None, socket: String::new(), peers: vec!["100.100.10.2".parse().unwrap()] };
    let ps = Peers::new(allowed_peers(&t.ip, &t.peers), || None);
    assert!(ps.allows("100.100.10.1".parse().unwrap()));
    assert!(ps.allows("100.100.10.2".parse().unwrap()));
    assert!(!ps.allows("100.96.0.9".parse().unwrap()));
}

#[test]
fn r5_꺼진_채로_뜨면_남은_우리_serve_만_내린다() {
    let ours = r#"{"Web":{"mac.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:47124"}}}}}"#;
    let t = "http://127.0.0.1:47124";
    assert!(stale_serve(false, ours, "mac.ts.net", t), "강제 종료 뒤 남은 우리 것");
    assert!(!stale_serve(true, ours, "mac.ts.net", t), "켜 둔 상태면 start 가 다시 쓴다");
    assert!(!stale_serve(false, &ours.replace("47124", "47123"), "mac.ts.net", t), "본판 것은 안 건드린다");
    assert!(!stale_serve(false, "{}", "mac.ts.net", t));
}

#[test]
fn r6_tcp_funnel_도_잡고_켜진_동안_걸리면_내린다() {
    // tailscale funnel --tcp 443 … — HTTP 헤더가 안 붙으니 문지기로는 못 막는다. 상태로 본다
    let tcp = r#"{"TCP":{"443":{"TCPForward":"127.0.0.1:47124"}},"AllowFunnel":{"mac.ts.net:443":true}}"#;
    assert!(funnel_open(tcp, "mac.ts.net"));
    assert!(funnel_guard(tcp, "mac.ts.net").is_some_and(|m| m.contains("funnel")));
    assert_eq!(funnel_guard(r#"{"Web":{}}"#, "mac.ts.net"), None);
}
