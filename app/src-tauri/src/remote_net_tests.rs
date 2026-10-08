use super::*;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener};
use std::thread;
use std::time::{Duration, Instant};

const T: Duration = Duration::from_secs(3);

/// 요청 하나를 받아 머리를 돌려주고 정해 둔 응답을 쓴다(폰 서버처럼 Connection: close)
fn one_shot(resp: &'static [u8]) -> (SocketAddr, thread::JoinHandle<String>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let at = l.local_addr().unwrap();
    let h = thread::spawn(move || {
        let (mut s, _) = l.accept().unwrap();
        s.set_read_timeout(Some(T)).unwrap();
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        // 머리 + Content-Length 만큼 읽기
        loop {
            let n = s.read(&mut chunk).unwrap();
            buf.extend_from_slice(&chunk[..n]);
            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&buf[..i]).to_ascii_lowercase();
                let len = head.lines().find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                if buf.len() >= i + 4 + len {
                    break;
                }
            }
            if n == 0 {
                break;
            }
        }
        s.write_all(resp).unwrap();
        String::from_utf8_lossy(&buf).into_owned()
    });
    (at, h)
}

fn get(path: &str) -> Request<'_> {
    Request { method: "GET", path, body: None, token: None }
}

#[test]
fn md2_직통으로_get_하고_머리를_원격_것으로_맞춘다() {
    let (at, h) = one_shot(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{\"app\":\"chammo\"}");
    let target = Target { ip: Ipv4Addr::LOCALHOST, port: at.port() };
    let r = send(&Route::Direct, &target, &Request { token: Some("k".repeat(64).as_str()), ..get("/api/hello") }, T, 1024).unwrap();
    assert_eq!(r.status, 200);
    assert_eq!(r.ctype, "application/json");
    assert_eq!(r.body, b"{\"app\":\"chammo\"");
    let head = h.join().unwrap();
    assert!(head.starts_with("GET /api/hello HTTP/1.1\r\n"), "{head}");
    assert!(head.contains(&format!("Host: 127.0.0.1:{}\r\n", at.port())));
    assert!(head.contains(&format!("Authorization: Bearer {}\r\n", "k".repeat(64))));
    assert!(head.contains("Connection: close\r\n"));
    assert!(!head.contains("Origin:"), "GET 엔 출처를 안 붙인다");
}

#[test]
fn md2_post_는_같은_출처_json_으로() {
    let (at, h) = one_shot(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}");
    let target = Target { ip: Ipv4Addr::LOCALHOST, port: at.port() };
    let r = send(&Route::Direct, &target, &Request { method: "POST", path: "/api/send", body: Some(br#"{"id":"x"}"#), token: None }, T, 1024).unwrap();
    assert_eq!(r.status, 200);
    let head = h.join().unwrap();
    assert!(head.contains(&format!("Origin: http://127.0.0.1:{}\r\n", at.port())), "{head}");
    assert!(head.contains("Content-Type: application/json\r\n"));
    assert!(head.contains("Content-Length: 10\r\n"));
    assert!(head.ends_with(r#"{"id":"x"}"#));
}

#[test]
fn md2_응답이_상한을_넘으면_실패() {
    let (at, h) = one_shot(b"HTTP/1.1 200 OK\r\nContent-Length: 2000\r\n\r\n");
    let target = Target { ip: Ipv4Addr::LOCALHOST, port: at.port() };
    assert_eq!(send(&Route::Direct, &target, &get("/api/tasks"), T, 1000).unwrap_err(), NetErr::TooBig);
    let _ = h.join();
}

#[test]
fn md2_닫힌_포트는_닿지_않음() {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    let e = send(&Route::Direct, &Target { ip: Ipv4Addr::LOCALHOST, port }, &get("/api/hello"), T, 1024).unwrap_err();
    assert_eq!(e, NetErr::Refused);
}

#[test]
fn md2_답을_안_주는_서버는_마감에_끊긴다() {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    let h = thread::spawn(move || {
        let (s, _) = l.accept().unwrap();
        thread::sleep(Duration::from_millis(1500));
        drop(s);
    });
    let t0 = Instant::now();
    let e = send(&Route::Direct, &Target { ip: Ipv4Addr::LOCALHOST, port }, &get("/api/hello"), Duration::from_millis(400), 1024).unwrap_err();
    assert_eq!(e, NetErr::Timeout);
    assert!(t0.elapsed() < Duration::from_millis(1200), "{:?}", t0.elapsed());
    let _ = h.join();
}

/// 가짜 SOCKS5 — 인증 없음만 받고, CONNECT 대상을 기록한 뒤 진짜 서버로 이어 준다. refuse 면 '연결 거부(5)'로 답한다
fn fake_socks(refuse: bool) -> (SocketAddr, thread::JoinHandle<Option<(Ipv4Addr, u16)>>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let at = l.local_addr().unwrap();
    let h = thread::spawn(move || {
        let (mut c, _) = l.accept().unwrap();
        let mut b = [0u8; 3];
        c.read_exact(&mut b).unwrap();
        assert_eq!(b, [5, 1, 0], "인증 없음 하나만 내민다");
        c.write_all(&[5, 0]).unwrap();
        let mut req = [0u8; 10];
        c.read_exact(&mut req).unwrap();
        assert_eq!(&req[..4], &[5, 1, 0, 1], "CONNECT · IPv4");
        let ip = Ipv4Addr::new(req[4], req[5], req[6], req[7]);
        let port = u16::from_be_bytes([req[8], req[9]]);
        if refuse {
            c.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]).unwrap();
            return Some((ip, port));
        }
        let mut up = std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        c.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0]).unwrap();
        let mut c2 = c.try_clone().unwrap();
        let mut up2 = up.try_clone().unwrap();
        let t = thread::spawn(move || {
            let _ = std::io::copy(&mut c2, &mut up2);
        });
        let _ = std::io::copy(&mut up, &mut c);
        let _ = c.shutdown(std::net::Shutdown::Both);
        let _ = t.join();
        Some((ip, port))
    });
    (at, h)
}

#[test]
fn md2_socks5_를_거쳐_간다() {
    let (srv, h) = one_shot(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 6\r\n\r\nno key");
    let (socks, sh) = fake_socks(false);
    // 대상 주소는 SOCKS 가 받는다 — 여기선 127.0.0.1(가짜 SOCKS 가 그 포트로 잇는다)
    let r = send(&Route::Socks(socks), &Target { ip: Ipv4Addr::LOCALHOST, port: srv.port() }, &get("/api/env"), T, 1024).unwrap();
    assert_eq!(r.status, 401);
    assert_eq!(r.body, b"no key");
    assert_eq!(sh.join().unwrap(), Some((Ipv4Addr::LOCALHOST, srv.port())));
    assert!(h.join().unwrap().starts_with("GET /api/env HTTP/1.1"));
}

#[test]
fn md2_socks5_가_거절하면_닿지_않음() {
    let (socks, sh) = fake_socks(true);
    let e = send(&Route::Socks(socks), &Target { ip: Ipv4Addr::new(100, 64, 0, 9), port: 47123 }, &get("/api/hello"), T, 1024).unwrap_err();
    assert_eq!(e, NetErr::Refused);
    assert_eq!(sh.join().unwrap(), Some((Ipv4Addr::new(100, 64, 0, 9), 47123)));
}

#[test]
fn md2_tailscaled_인자에서_socks5_주소() {
    let ps = "/opt/homebrew/bin/tailscaled --tun=userspace-networking --socks5-server=localhost:1055 --socket=/Users/me/.ts/s\n";
    assert_eq!(socks_addr(ps), Some("127.0.0.1:1055".parse().unwrap()));
    assert_eq!(socks_addr("tailscaled --tun=userspace-networking --socks5-server 127.0.0.1:2000\n"), Some("127.0.0.1:2000".parse().unwrap()));
    // userspace 가 아니면(인터페이스 모드) 직통이라 필요 없다 · socks 인자가 없으면 None
    assert_eq!(socks_addr("tailscaled --tun=utun --socks5-server=localhost:1055\n"), None);
    assert_eq!(socks_addr("tailscaled --tun=userspace-networking\n"), None);
    // 모든 주소로 열렸으면 이 맥 것이니 127.0.0.1 로, 바깥 주소면 안 쓴다(남의 기계를 거쳐 열쇠를 보내지 않게)
    assert_eq!(socks_addr("tailscaled --tun=userspace-networking --socks5-server=0.0.0.0:1055\n"), Some("127.0.0.1:1055".parse().unwrap()));
    assert_eq!(socks_addr("tailscaled --tun=userspace-networking --socks5-server=:1055\n"), Some("127.0.0.1:1055".parse().unwrap()));
    assert_eq!(socks_addr("tailscaled --tun=userspace-networking --socks5-server=10.0.0.5:1055\n"), None);
}

/// 실측 — CHAMMO_PEER_IP=100.x 로 켠다(기본 꺼짐). 읽기만: 열쇠 없이 /api/hello · /api/env
#[test]
#[ignore]
fn md2_실측_테일넷_기기() {
    let Ok(ip) = std::env::var("CHAMMO_PEER_IP") else { return };
    let ps = String::from_utf8_lossy(&crate::platform::command("/bin/ps").args(["-axo", "command"]).output().unwrap().stdout).into_owned();
    let route = socks_addr(&ps).map(Route::Socks).unwrap_or(Route::Direct);
    let t = Target { ip: ip.parse().unwrap(), port: 47123 };
    for p in ["/api/hello", "/api/env"] {
        let t0 = Instant::now();
        let r = send(&route, &t, &get(p), T, 64 * 1024);
        eprintln!("{route:?} {p} → {:?} {:?}", r.as_ref().map(|r| (r.status, String::from_utf8_lossy(&r.body).chars().take(80).collect::<String>())), t0.elapsed());
    }
}
