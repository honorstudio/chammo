//! 다른 기기 참모(폰 서버, mobile_http.rs)에 손님으로 묻는 아주 작은 HTTP/1.1 클라이언트 — 테일넷 안 100.x:47123 만.
//! 맥이 tailscaled userspace 모드면 앱이 100.x 로 바로 못 간다(utun 이 없다) → tailscaled 의 SOCKS5(--socks5-server)를 거친다.
//! TLS 는 안 쓴다 — 테일넷 안은 WireGuard 가 이미 암호화한다(폰 서버의 https 는 폰 마이크 때문). 리다이렉트는 따르지 않는다.
//! 폰 서버는 응답마다 Content-Length + Connection: close 라 그만큼만 읽는다(chunked 없음).
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

/// 어디로 나가나 — 인터페이스 모드(utun·Wintun)면 직통, userspace 면 이 맥의 tailscaled SOCKS5
#[derive(Debug, Clone, PartialEq)]
pub enum Route {
    Direct,
    Socks(SocketAddr),
}

/// 원격 폰 서버 주소 — 테일넷 100.x 와 포트
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Target {
    pub ip: Ipv4Addr,
    pub port: u16,
}

impl Target {
    /// 원격 문지기의 Host 목록·출처 목록에 있는 모양 그대로("100.x.y.z:47123")
    fn host(&self) -> String {
        format!("{}:{}", self.ip, self.port)
    }
}

pub struct Request<'a> {
    pub method: &'a str,
    /// "/api/…?…" — 거르기는 부르는 쪽(remote.rs)이 한다
    pub path: &'a str,
    /// JSON 몸통(POST)
    pub body: Option<&'a [u8]>,
    /// 기기 열쇠 — 오류 글·로그 어디에도 안 남긴다
    pub token: Option<&'a str>,
}

#[derive(Debug)]
pub struct Response {
    pub status: u16,
    pub ctype: String,
    pub body: Vec<u8>,
}

/// 실패 갈래 — 화면이 '연결 끊김'과 '참모 없음'을 가르는 데 쓴다. 글에는 열쇠·몸통이 절대 안 들어간다
#[derive(Debug, Clone, PartialEq)]
pub enum NetErr {
    /// 거부(포트에 아무도 없음·SOCKS 가 거절)
    Refused,
    /// 마감 안에 답이 없음(꺼짐·절전·망 끊김)
    Timeout,
    /// 응답이 상한보다 큼
    TooBig,
    /// 응답 모양이 HTTP 가 아님
    Bad(String),
    /// 그 밖의 입출력 오류(종류만)
    Io(String),
}

const MAX_HEAD: usize = 16 * 1024;

fn io_err(e: &std::io::Error) -> NetErr {
    use std::io::ErrorKind::*;
    match e.kind() {
        ConnectionRefused => NetErr::Refused,
        TimedOut | WouldBlock => NetErr::Timeout,
        k => NetErr::Io(format!("{k:?}")),
    }
}

/// 남은 시간 — 다 썼으면 Timeout
fn left(deadline: Instant) -> Result<Duration, NetErr> {
    let d = deadline.saturating_duration_since(Instant::now());
    if d.is_zero() { Err(NetErr::Timeout) } else { Ok(d) }
}

fn read_exact_by(s: &mut TcpStream, buf: &mut [u8], deadline: Instant) -> Result<(), NetErr> {
    let mut got = 0;
    while got < buf.len() {
        s.set_read_timeout(Some(left(deadline)?)).map_err(|e| io_err(&e))?;
        match s.read(&mut buf[got..]) {
            Ok(0) => return Err(NetErr::Bad("closed".into())),
            Ok(n) => got += n,
            Err(e) => return Err(io_err(&e)),
        }
    }
    Ok(())
}

/// 쓰기마다 남은 시간을 다시 건다 — 맥(BSD)은 일부를 보냈으면 시간 초과 대신 보낸 수를 돌려줘서 write_all 이 마감을 늘린다(교훈)
fn write_by(s: &mut TcpStream, mut data: &[u8], deadline: Instant) -> Result<(), NetErr> {
    while !data.is_empty() {
        s.set_write_timeout(Some(left(deadline)?)).map_err(|e| io_err(&e))?;
        match s.write(data) {
            Ok(0) => return Err(NetErr::Io("WriteZero".into())),
            Ok(n) => data = &data[n..],
            Err(e) => return Err(io_err(&e)),
        }
    }
    Ok(())
}

/// SOCKS5 CONNECT(인증 없음, IPv4) — RFC 1928
fn socks_connect(s: &mut TcpStream, t: &Target, deadline: Instant) -> Result<(), NetErr> {
    write_by(s, &[5, 1, 0], deadline)?;
    let mut hello = [0u8; 2];
    read_exact_by(s, &mut hello, deadline)?;
    if hello != [5, 0] {
        return Err(NetErr::Bad("socks auth".into()));
    }
    let mut req = vec![5, 1, 0, 1];
    req.extend_from_slice(&t.ip.octets());
    req.extend_from_slice(&t.port.to_be_bytes());
    write_by(s, &req, deadline)?;
    let mut rep = [0u8; 4];
    read_exact_by(s, &mut rep, deadline)?;
    if rep[0] != 5 {
        return Err(NetErr::Bad("socks reply".into()));
    }
    // 1 일반 실패·3 망 닿지 않음·4 호스트 닿지 않음·5 거부·6 TTL — 손님에겐 다 '닿지 않음', 4·6 은 꺼진 기기에서 흔하다
    match rep[1] {
        0 => {}
        4 | 6 => return Err(NetErr::Timeout),
        _ => return Err(NetErr::Refused),
    }
    // 묶인 주소(BND.ADDR·PORT) 버리기 — 모양에 따라 길이가 다르다
    let rest = match rep[3] {
        1 => 4 + 2,
        4 => 16 + 2,
        3 => {
            let mut n = [0u8; 1];
            read_exact_by(s, &mut n, deadline)?;
            n[0] as usize + 2
        }
        _ => return Err(NetErr::Bad("socks atyp".into())),
    };
    let mut skip = vec![0u8; rest];
    read_exact_by(s, &mut skip, deadline)
}

fn open(route: &Route, t: &Target, deadline: Instant) -> Result<TcpStream, NetErr> {
    let to = match route {
        Route::Direct => SocketAddr::new(IpAddr::V4(t.ip), t.port),
        Route::Socks(a) => *a,
    };
    let mut s = TcpStream::connect_timeout(&to, left(deadline)?).map_err(|e| io_err(&e))?;
    let _ = s.set_nodelay(true);
    if let Route::Socks(_) = route {
        socks_connect(&mut s, t, deadline)?;
    }
    Ok(s)
}

/// 요청 하나 — 마감(timeout)은 연결부터 마지막 바이트까지 전체, max_body 넘는 응답은 TooBig
pub fn send(route: &Route, t: &Target, req: &Request, timeout: Duration, max_body: usize) -> Result<Response, NetErr> {
    let deadline = Instant::now() + timeout;
    let mut s = open(route, t, deadline)?;
    let mut head = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: Chammo/{} (peer)\r\nAccept: application/json\r\nConnection: close\r\n",
        req.method,
        req.path,
        t.host(),
        env!("CARGO_PKG_VERSION")
    );
    if let Some(tok) = req.token {
        head.push_str(&format!("Authorization: Bearer {tok}\r\n"));
    }
    // 쓰기는 원격 문지기가 같은 출처 + JSON 만 받는다 — 브라우저 CSRF 막이라 손님은 원격 자기 출처를 그대로 댄다(진짜 문은 열쇠)
    if req.method != "GET" {
        head.push_str(&format!("Origin: http://{}\r\nContent-Type: application/json\r\n", t.host()));
    }
    let body = req.body.unwrap_or(&[]);
    if req.method != "GET" || !body.is_empty() {
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    head.push_str("\r\n");
    let mut out = head.into_bytes();
    out.extend_from_slice(body);
    write_by(&mut s, &out, deadline)?;
    read_resp(&mut s, deadline, max_body)
}

fn read_resp(s: &mut TcpStream, deadline: Instant, max_body: usize) -> Result<Response, NetErr> {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 16 * 1024];
    let mut parsed: Option<(u16, String, usize, usize)> = None; // status, ctype, 머리 끝, 몸 길이
    loop {
        if let Some((status, ctype, start, len)) = &parsed {
            if buf.len() >= start + len {
                return Ok(Response { status: *status, ctype: ctype.clone(), body: buf[*start..start + len].to_vec() });
            }
        }
        s.set_read_timeout(Some(left(deadline)?)).map_err(|e| io_err(&e))?;
        let n = match s.read(&mut chunk) {
            Ok(n) => n,
            Err(e) => return Err(io_err(&e)),
        };
        if n == 0 {
            // 닫혔다 — Content-Length 가 없던 응답이면 받은 만큼이 몸
            return match parsed {
                Some((status, ctype, start, usize::MAX)) => Ok(Response { status, ctype, body: buf[start..].to_vec() }),
                _ => Err(NetErr::Bad("closed early".into())),
            };
        }
        buf.extend_from_slice(&chunk[..n]);
        if parsed.is_none() {
            let mut headers = [httparse::EMPTY_HEADER; 32];
            let mut r = httparse::Response::new(&mut headers);
            match r.parse(&buf) {
                Ok(httparse::Status::Complete(end)) => {
                    let status = r.code.unwrap_or(0);
                    let hv = |name: &str| r.headers.iter().find(|h| h.name.eq_ignore_ascii_case(name)).map(|h| String::from_utf8_lossy(h.value).trim().to_string());
                    if hv("transfer-encoding").is_some() {
                        return Err(NetErr::Bad("chunked".into()));
                    }
                    let len = match hv("content-length") {
                        Some(v) => v.parse::<usize>().map_err(|_| NetErr::Bad("content-length".into()))?,
                        None => usize::MAX,
                    };
                    if len != usize::MAX && len > max_body {
                        return Err(NetErr::TooBig);
                    }
                    let ctype = hv("content-type").unwrap_or_default();
                    parsed = Some((status, ctype, end, len));
                }
                Ok(httparse::Status::Partial) if buf.len() > MAX_HEAD => return Err(NetErr::Bad("head too big".into())),
                Ok(httparse::Status::Partial) => {}
                Err(e) => return Err(NetErr::Bad(e.to_string())),
            }
        }
        if let Some((_, _, start, usize::MAX)) = &parsed {
            if buf.len() - start > max_body {
                return Err(NetErr::TooBig);
            }
        }
    }
}

/// `ps -axo command` 에서 userspace tailscaled 의 SOCKS5 주소 — 이 맥(루프백·모든 주소) 것만. 인터페이스 모드면 None(직통으로 간다)
pub fn socks_addr(ps: &str) -> Option<SocketAddr> {
    ps.lines().find_map(|line| {
        let mut words = line.split_whitespace();
        let exe = words.next()?;
        if !(exe == "tailscaled" || exe.ends_with("/tailscaled")) {
            return None;
        }
        let args: Vec<&str> = words.collect();
        if !args.iter().any(|a| *a == "--tun=userspace-networking" || *a == "-tun=userspace-networking") {
            return None;
        }
        let v = args.iter().enumerate().find_map(|(i, a)| {
            a.strip_prefix("--socks5-server=").or_else(|| a.strip_prefix("-socks5-server=")).map(str::to_string).or_else(|| {
                (*a == "--socks5-server" || *a == "-socks5-server").then(|| args.get(i + 1).map(|s| s.to_string())).flatten()
            })
        })?;
        let (host, port) = v.rsplit_once(':')?;
        let port: u16 = port.parse().ok()?;
        let local = match host.trim_matches(['[', ']']) {
            "" | "localhost" | "0.0.0.0" | "::" | "::1" => true,
            h => h.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback()),
        };
        local.then(|| SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port))
    })
}

#[cfg(test)]
#[path = "remote_net_tests.rs"]
mod tests;
