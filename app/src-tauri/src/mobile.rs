//! 모바일 — 폰(테일스케일)에서 참모를 보는 작은 웹 서버. 문지기(열쇠·주소·허용 목록)는 mobile_http.rs, 여긴 켜고 끄기와 맥 쪽 일.
//! 묶는 주소: ① 테일스케일 인터페이스(utun 등)의 100.x 가 있으면 거기만 ② 없고 tailscaled 가 userspace 모드로 돌면 127.0.0.1 만
//! (그 모드는 100.x 로 온 연결을 tailscaled 가 127.0.0.1 로 넘긴다) ③ 둘 다 아니면 안 연다. 0.0.0.0·LAN 주소는 어떤 경우에도 안 묶는다.
//! 접속 = 짝짓기(mobile_pair): QR 엔 10분 한 번짜리 코드만, 기기별 토큰은 해시만 <데이터>/mobile-devices.json(600). 켜고 끈 상태는 <데이터>/mobile.json — 기본 꺼짐
use crate::mobile_http::{self, Backend, Gate};
use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// 본판·개발판 기본 포트를 다르게 — serve 대상 포트로 '내 것'을 가리니 둘이 같으면 서로의 serve 를 내린다
const DEFAULT_PORT: u16 = 47123;
const DEV_PORT: u16 = 47124;
/// 동시에 받는 연결 상한 — 넘으면 바로 닫는다(폰 한 대엔 넉넉)
const MAX_CONNS: usize = 16;

pub fn port_from(env: Option<&str>, debug: bool) -> u16 {
    env.and_then(|p| p.parse().ok()).unwrap_or(if debug { DEV_PORT } else { DEFAULT_PORT })
}

pub fn port() -> u16 {
    port_from(std::env::var("CHAMMO_MOBILE_PORT").ok().as_deref(), cfg!(debug_assertions))
}

// ── 테일스케일 주소 찾기 ─────────────────────────────────────

/// 100.64.0.0/10 (테일스케일·CGNAT 대역)
pub fn is_cgnat(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 100 && (64..128).contains(&o[1])
}

/// 테일스케일이 만든 인터페이스만 — 통신사 CGNAT 도 100.64/10 을 쓰니 이름까지 본다(맥 utun·리눅스 tailscale0)
pub fn pick_iface(addrs: &[(String, Ipv4Addr)]) -> Option<Ipv4Addr> {
    addrs.iter().find(|(name, ip)| (name.starts_with("utun") || name.starts_with("tailscale")) && is_cgnat(*ip)).map(|(_, ip)| *ip)
}

/// `ps -axo command` 에서 userspace 모드 tailscaled 를 찾아 그 소켓 경로(없으면 기본 소켓 = 빈 문자열)
pub fn userspace_socket(ps: &str) -> Option<String> {
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
        let sock = args.iter().enumerate().find_map(|(i, a)| {
            a.strip_prefix("--socket=").or_else(|| a.strip_prefix("-socket=")).map(str::to_string).or_else(|| {
                (*a == "--socket" || *a == "-socket").then(|| args.get(i + 1).map(|s| s.to_string())).flatten()
            })
        });
        Some(sock.unwrap_or_default())
    })
}

/// `tailscale status --json` 에서 쓰는 것 — 내 100.x·MagicDNS 이름·피어 주소들(맞은편 확인용)
#[derive(Debug, Clone, PartialEq)]
pub struct TsStatus {
    pub ip: Ipv4Addr,
    pub dns: Option<String>,
    pub peers: Vec<IpAddr>,
}

/// 로그아웃·꺼짐이면 None
pub fn parse_status(json: &str) -> Option<TsStatus> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    if v["BackendState"].as_str().is_some_and(|s| s != "Running") {
        return None;
    }
    let me = &v["Self"];
    let ip = me["TailscaleIPs"].as_array()?.iter().filter_map(|s| s.as_str()?.parse::<Ipv4Addr>().ok()).find(|ip| is_cgnat(*ip))?;
    let dns = me["DNSName"].as_str().map(|d| d.trim_end_matches('.').to_string()).filter(|d| !d.is_empty());
    let peers = v["Peer"].as_object().map(|m| {
        m.values().flat_map(|p| p["TailscaleIPs"].as_array().cloned().unwrap_or_default()).filter_map(|x| x.as_str()?.parse::<IpAddr>().ok()).collect()
    }).unwrap_or_default();
    Some(TsStatus { ip, dns, peers })
}

#[derive(Debug, Clone, PartialEq)]
pub struct Tailnet {
    /// 실제로 묶을 주소(100.x 또는 127.0.0.1)
    pub bind: IpAddr,
    /// 폰이 열 주소
    pub ip: Ipv4Addr,
    pub dns: Option<String>,
    /// tailscale CLI 에 넘길 소켓(userspace 면 그 소켓, 인터페이스 모드면 "" = 기본)
    pub socket: String,
    /// 켤 때의 테일넷 피어 주소 — 맞은편 확인(Peers)의 처음 값
    pub peers: Vec<IpAddr>,
}

#[cfg(unix)]
fn iface_addrs() -> Vec<(String, Ipv4Addr)> {
    let mut out = Vec::new();
    unsafe {
        let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut head) != 0 {
            return out;
        }
        let mut p = head;
        while !p.is_null() {
            let a = &*p;
            if !a.ifa_addr.is_null() && (*a.ifa_addr).sa_family as i32 == libc::AF_INET {
                let sin = &*(a.ifa_addr as *const libc::sockaddr_in);
                let ip = Ipv4Addr::from(u32::from_be(sin.sin_addr.s_addr));
                let name = std::ffi::CStr::from_ptr(a.ifa_name).to_string_lossy().into_owned();
                out.push((name, ip));
            }
            p = a.ifa_next;
        }
        libc::freeifaddrs(head);
    }
    out
}

#[cfg(not(unix))]
fn iface_addrs() -> Vec<(String, Ipv4Addr)> {
    Vec::new() // 윈도우는 아직 — 서버를 안 연다
}

fn tailscale_bin() -> Option<String> {
    ["/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]
        .into_iter()
        .find(|p| Path::new(p).is_file())
        .map(str::to_string)
}

fn tailscale_status(socket: &str) -> Option<TsStatus> {
    let bin = tailscale_bin()?;
    let mut c = crate::platform::command(&bin);
    if !socket.is_empty() {
        c.arg(format!("--socket={socket}"));
    }
    // 맞은편 확인(받는 스레드)이 부르니 멈추면 안 된다 — 5초 넘으면 죽인다
    let out = crate::platform::run_capped(c.args(["status", "--json"]), Duration::from_secs(5)).ok()?;
    out.status.success().then(|| parse_status(&String::from_utf8_lossy(&out.stdout))).flatten()
}

/// 묶을 곳 정하기(순수) — 테일스케일이 말한 내 주소(Self IP)와 **같은** 주소를 가진 utun·tailscale 인터페이스에만(WARP·NetBird 도 utun 에 100.x 를 쓴다),
/// 없으면 userspace tailscaled 가 있을 때 127.0.0.1, 둘 다 아니면 None. userspace = (상태, 소켓)
pub fn plan(ifaces: &[(String, Ipv4Addr)], iface_status: impl FnOnce() -> Option<TsStatus>, userspace: impl FnOnce() -> Option<(TsStatus, String)>) -> Option<Tailnet> {
    if pick_iface(ifaces).is_some() {
        if let Some(st) = iface_status() {
            if ifaces.iter().any(|(n, ip)| (n.starts_with("utun") || n.starts_with("tailscale")) && *ip == st.ip) {
                return Some(Tailnet { bind: IpAddr::V4(st.ip), ip: st.ip, dns: st.dns, socket: String::new(), peers: st.peers });
            }
        }
    }
    let (st, socket) = userspace()?;
    Some(Tailnet { bind: IpAddr::V4(Ipv4Addr::LOCALHOST), ip: st.ip, dns: st.dns, socket, peers: st.peers })
}

fn userspace_status() -> Option<(TsStatus, String)> {
    if cfg!(not(unix)) {
        return None;
    }
    let ps = crate::platform::command("/bin/ps").args(["-axo", "command"]).output().ok()?;
    let sock = userspace_socket(&String::from_utf8_lossy(&ps.stdout))?;
    tailscale_status(&sock).map(|st| (st, sock))
}

/// 지금 묶을 테일스케일 주소 — 없으면 None(서버를 안 연다)
pub fn detect() -> Option<Tailnet> {
    plan(&iface_addrs(), || tailscale_status(""), userspace_status)
}

/// 받아 줄 Host 헤더 값들. https = 테일스케일 serve 가 <맥>.ts.net:443 을 이 포트로 넘기는 중(Host 는 포트 없는 이름으로 온다)
pub fn hosts(t: &Tailnet, port: u16, https: bool) -> Vec<String> {
    let mut v = vec![format!("{}:{port}", t.ip)];
    if let Some(d) = &t.dns {
        v.push(format!("{d}:{port}"));
        if https {
            v.push(d.clone());
        }
    }
    v.push(format!("127.0.0.1:{port}"));
    v.push(format!("localhost:{port}"));
    v
}

/// 쓰기를 받아 줄 출처 — http 주소들 + https 면 https://<맥>.ts.net
pub fn origins(t: &Tailnet, port: u16, https: bool) -> Vec<String> {
    let mut v: Vec<String> = hosts(t, port, false).into_iter().map(|h| format!("http://{h}")).collect();
    if let (true, Some(d)) = (https, &t.dns) {
        v.push(format!("https://{d}"));
    }
    v
}

// ── 테일스케일 HTTPS(serve) — 폰 마이크는 https 에서만 열린다 ─────────────

#[derive(Debug, PartialEq)]
pub enum ServeState {
    /// 그 이름 443 에 아무것도 없다
    Free,
    /// 이미 이 서버로 넘기고 있다(지난번에 켜 둔 것)
    Ours,
    /// 다른 것이 쓰고 있다 — 덮지 않는다
    Other(String),
    /// 그 이름이 funnel 로 인터넷에 열려 있다 — 모바일을 안 켠다
    Funnel,
}

/// 그 이름의 어느 포트든 funnel(인터넷 공개)이 켜져 있나
pub fn funnel_open(json: &str, dns: &str) -> bool {
    let v: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
    v["AllowFunnel"].as_object().is_some_and(|m| m.iter().any(|(k, on)| k.starts_with(&format!("{dns}:")) && on == true))
}

/// `tailscale serve status --json` → 그 이름의 443 이 누구 것인가
pub fn serve_state(json: &str, dns: &str, target: &str) -> ServeState {
    if funnel_open(json, dns) {
        return ServeState::Funnel;
    }
    let v: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
    let web = &v["Web"][format!("{dns}:443")]["Handlers"];
    let Some(h) = web.as_object() else {
        // 443 이 TCP 로만 잡혀 있어도(웹 말고 다른 넘김) 남의 것
        return if v["TCP"]["443"].is_object() { ServeState::Other("tcp 443".into()) } else { ServeState::Free };
    };
    if h.len() == 1 && h.get("/").and_then(|x| x["Proxy"].as_str()) == Some(target) {
        ServeState::Ours
    } else {
        ServeState::Other(serde_json::to_string(h).unwrap_or_default())
    }
}

fn tailscale(t: &Tailnet, args: &[&str]) -> Result<String, String> {
    let bin = tailscale_bin().ok_or("tailscale CLI not found")?;
    let mut c = crate::platform::command(&bin);
    if !t.socket.is_empty() {
        c.arg(format!("--socket={}", t.socket));
    }
    let out = crate::platform::run_capped(c.args(args), Duration::from_secs(15)).map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn serve_target(t: &Tailnet, port: u16) -> String {
    format!("http://{}:{port}", t.bind)
}

/// https://<맥>.ts.net → 이 서버. 남의 443 설정은 덮지 않는다
fn https_on(t: &Tailnet, port: u16) -> Result<(), String> {
    let dns = t.dns.as_deref().ok_or("MagicDNS 이름이 없어요")?;
    let target = serve_target(t, port);
    match serve_state(&tailscale(t, &["serve", "status", "--json"])?, dns, &target) {
        ServeState::Ours => Ok(()),
        ServeState::Funnel => Err(format!("{dns} 가 funnel 로 인터넷에 열려 있어요")),
        ServeState::Other(what) => Err(format!("{dns}:443 에 다른 serve 설정이 있어 건드리지 않았어요 ({what})")),
        ServeState::Free => tailscale(t, &["serve", "--bg", "--https=443", &target]).map(|_| ()),
    }
}

/// 켜져 있는 동안 funnel 이 켜지면 내릴 이유(TCP funnel 은 HTTP 헤더가 안 붙어 문지기로는 못 막는다)
pub fn funnel_guard(json: &str, dns: &str) -> Option<String> {
    funnel_open(json, dns).then(|| crate::i18n::tr("테일스케일 funnel(인터넷 공개)이 켜져 모바일을 내렸어요 — funnel 을 끈 뒤 다시 켜 주세요", "Tailscale Funnel (public internet) was turned on, so mobile was stopped — turn funnel off and start it again").to_string())
}

/// 지금 떠 있는 서버를 funnel 로 다시 본다 — 걸리면 내리고 이유를 남기고 알린다. 내렸으면 true
fn funnel_check() -> bool {
    let (t, stop) = {
        let r = RUNNING.lock().unwrap();
        let Some(r) = r.as_ref() else { return false };
        (r.tailnet.clone(), r.stop.clone())
    };
    let (Some(dns), Ok(json)) = (t.dns.as_deref(), tailscale(&t, &["serve", "status", "--json"])) else { return false };
    let Some(msg) = funnel_guard(&json, dns) else { return false };
    if stop.load(Ordering::Relaxed) {
        return false;
    }
    stop_running(false);
    set_error(Some(msg.clone()));
    crate::claude::notify(crate::i18n::tr("모바일을 내렸어요", "Mobile stopped").into(), msg, None);
    true
}

/// 뜰 때 정리할 serve 인가 — 모바일이 꺼져 있는데 우리 포트로 넘기는 serve 가 남아 있으면(강제 종료·크래시 뒤)
pub fn stale_serve(on: bool, json: &str, dns: &str, target: &str) -> bool {
    !on && serve_state(json, dns, target) == ServeState::Ours
}

/// tailscale serve(맥 전역에 남는 설정)를 만져도 되나 — 진짜 데이터 폴더일 때만
fn serve_allowed() -> bool {
    crate::config::is_real_data(&crate::config::home(), crate::config::data_dir())
}

/// 끌 때 — 우리 것일 때만 내린다
fn https_off(t: &Tailnet, port: u16) {
    let Some(dns) = t.dns.as_deref() else { return };
    if tailscale(t, &["serve", "status", "--json"]).is_ok_and(|j| serve_state(&j, dns, &serve_target(t, port)) == ServeState::Ours) {
        let _ = tailscale(t, &["serve", "--https=443", "off"]);
    }
}

/// 맞은편 확인 — 이 맥(loopback, userspace 모드는 tailscaled 가 127.0.0.1 로 넘긴다)이나 테일넷 피어 주소만.
/// 같은 100.64/10 이어도 피어 목록에 없으면(WARP·NetBird·남의 테일넷) 거절. 모르는 주소면 목록을 다시 묻되 10초에 한 번
pub struct Peers {
    ips: std::sync::RwLock<std::collections::HashSet<IpAddr>>,
    last: Mutex<std::time::Instant>,
    refresh: Box<dyn Fn() -> Option<Vec<IpAddr>> + Send + Sync>,
}

const PEER_REFRESH: Duration = Duration::from_secs(10);

/// 받아 줄 맞은편 = 테일넷 피어들 + 내 Self IP(인터페이스 모드 serve 는 내 주소에서 들어오고, 맥 브라우저 직접 접속도 그렇다)
pub fn allowed_peers(me: &Ipv4Addr, peers: &[IpAddr]) -> Vec<IpAddr> {
    let mut v = peers.to_vec();
    v.push(IpAddr::V4(*me));
    v
}

fn norm(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v) => v.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v)),
        x => x,
    }
}

impl Peers {
    pub fn new(initial: Vec<IpAddr>, refresh: impl Fn() -> Option<Vec<IpAddr>> + Send + Sync + 'static) -> Peers {
        Peers {
            ips: std::sync::RwLock::new(initial.into_iter().map(norm).collect()),
            last: Mutex::new(std::time::Instant::now()),
            refresh: Box::new(refresh),
        }
    }

    #[cfg(test)]
    pub fn backdate(&self, d: Duration) {
        *self.last.lock().unwrap() = std::time::Instant::now() - d;
    }

    pub fn allows(&self, peer: IpAddr) -> bool {
        let p = norm(peer);
        if p.is_loopback() || self.ips.read().unwrap().contains(&p) {
            return true;
        }
        let mut last = self.last.lock().unwrap();
        if last.elapsed() < PEER_REFRESH {
            return false;
        }
        *last = std::time::Instant::now();
        drop(last);
        if let Some(list) = (self.refresh)() {
            *self.ips.write().unwrap() = list.into_iter().map(norm).collect();
        }
        self.ips.read().unwrap().contains(&p)
    }
}

// ── 짝지은 기기 ──────────────────────────────────────────────

/// 앱 전체에 하나 — 서버를 다시 띄워도(테일스케일 주소가 바뀌어도) 같은 기기 목록
fn devices() -> Arc<crate::mobile_pair::Devices> {
    static D: std::sync::OnceLock<Arc<crate::mobile_pair::Devices>> = std::sync::OnceLock::new();
    D.get_or_init(|| {
        let dir = crate::config::data_dir();
        // 예전 마스터 열쇠 파일은 이제 안 쓴다 — 남겨 두지 않는다
        let _ = std::fs::remove_file(dir.join("mobile.key"));
        Arc::new(crate::mobile_pair::Devices::open(dir))
    })
    .clone()
}

// ── 켜고 끄기 ────────────────────────────────────────────────

fn on_path(dir: &Path) -> PathBuf {
    dir.join("mobile.json")
}

/// 폰 푸시를 보내도 되나 — 모바일을 켜 뒀고 진짜 데이터 폴더일 때만(시험 개발판이 사용자 폰에 알림을 쏘지 않게)
pub fn push_allowed(dir: &Path) -> bool {
    saved_on(dir) && crate::config::is_real_data(&crate::config::home(), dir)
}

pub fn saved_on(dir: &Path) -> bool {
    std::fs::read_to_string(on_path(dir)).ok().and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()).is_some_and(|v| v["on"] == true)
}

fn save_on(dir: &Path, on: bool) -> std::io::Result<()> {
    std::fs::write(on_path(dir), serde_json::json!({ "on": on }).to_string())
}

struct Running {
    stop: Arc<AtomicBool>,
    tailnet: Tailnet,
    port: u16,
    /// 테일스케일 HTTPS 를 걸었나(못 걸면 이유는 LAST_ERROR 가 아니라 https_note)
    https: bool,
    https_note: Option<String>,
}

static RUNNING: Mutex<Option<Running>> = Mutex::new(None);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

/// 연결 수 세기 — 처리 스레드가 패닉해도 Drop 에서 줄인다(안 그러면 16번 만에 꽉 차 영영 먹통)
struct ConnSlot(Arc<AtomicUsize>);
impl Drop for ConnSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

/// 서버 하나 띄우기 — 묶기에 성공하면 받는 스레드를 돌리고 멈춤 깃발을 돌려준다
pub fn serve(bind: SocketAddr, gate: Gate, be: Arc<dyn Backend>, peers: Arc<Peers>) -> std::io::Result<(Arc<AtomicBool>, SocketAddr)> {
    let listener = TcpListener::bind(bind)?;
    let local = listener.local_addr()?;
    listener.set_nonblocking(true)?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let gate = Arc::new(gate);
    let active = Arc::new(AtomicUsize::new(0));
    std::thread::spawn(move || {
        while !stop2.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((s, peer)) => {
                    if active.load(Ordering::Relaxed) >= MAX_CONNS || !peers.allows(peer.ip()) {
                        continue; // 그냥 닫는다
                    }
                    // 맥(BSD)에선 받은 소켓이 듣는 소켓의 non-blocking 을 물려받는다
                    let _ = s.set_nonblocking(false);
                    active.fetch_add(1, Ordering::Relaxed);
                    let slot = ConnSlot(active.clone());
                    let (g, b) = (gate.clone(), be.clone());
                    // 자리(slot)는 처리가 끝날 때 놓인다 — 504 로 먼저 끊어도 맥 쪽 일이 돌고 있으면 계속 센다
                    std::thread::spawn(move || mobile_http::serve_conn_guarded(s, g, b, mobile_http::REQ_DEADLINE, slot));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(50)),
                Err(_) => std::thread::sleep(Duration::from_millis(200)),
            }
        }
    });
    Ok((stop, local))
}

/// keep_https = 열쇠만 바꿔 다시 띄울 때(serve 는 같은 포트라 그대로 둔다)
fn stop_running(keep_https: bool) {
    if let Some(r) = RUNNING.lock().unwrap().take() {
        r.stop.store(true, Ordering::Relaxed);
        if r.https && !keep_https {
            https_off(&r.tailnet, r.port);
        }
        // 받는 스레드가 깃발을 보고 듣는 소켓을 닫을 때까지(포트를 바로 다시 묶을 수 있게)
        std::thread::sleep(Duration::from_millis(150));
    }
}

fn start<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    stop_running(true);
    let t = detect().ok_or_else(|| crate::i18n::tr("테일스케일 주소가 없어요 — 테일스케일을 켜고 로그인한 뒤 다시 켜 주세요", "No Tailscale address — start and log in to Tailscale, then turn this on again").to_string())?;
    // funnel(인터넷 공개)이 켜져 있으면 아예 안 켠다 — serve 가 이 서버를 넘기면 인터넷 전체에 열린다
    if let (Some(dns), Ok(json)) = (t.dns.as_deref(), tailscale(&t, &["serve", "status", "--json"])) {
        if funnel_open(&json, dns) {
            return Err(crate::i18n::tr("테일스케일 funnel(인터넷 공개)이 켜져 있어 모바일을 안 켰어요 — `tailscale funnel` 을 끈 뒤 다시 켜 주세요", "Tailscale Funnel (public internet) is on, so mobile was not started — turn off `tailscale funnel` and try again").to_string());
        }
    }
    let port = port();
    // 먼저 묶는다 — 포트를 못 잡으면 serve 도 걸지 않는다. 문지기는 https 이름까지 받아 두고, serve 를 못 걸면 그 이름으로 올 길이 없을 뿐
    let gate = Gate { devices: devices(), hosts: hosts(&t, port, true), origins: origins(&t, port, true), stops: Default::default(), sends: Default::default(), tickets: Default::default() };
    let be: Arc<dyn Backend> = Arc::new(MacBackend { app: app.clone() });
    let sock = t.socket.clone();
    let peers = Arc::new(Peers::new(allowed_peers(&t.ip, &t.peers), move || tailscale_status(&sock).map(|st| allowed_peers(&st.ip, &st.peers))));
    let (stop, _) = serve(SocketAddr::new(t.bind, port), gate, be, peers).map_err(|e| format!("{}:{port} — {e}", t.bind))?;
    // tailscale serve 는 tailscaled 상태에 남아 재시작 뒤에도 그대로다 — 시험 데이터 폴더 개발판이 443 을 자기 포트로 걸면
    // 진짜 앱이 '다른 serve'로 보고 물러나 사용자 폰이 못 붙었다(2026-10-03). 시험 폴더면 serve 는 아예 안 건드린다(127.0.0.1:<포트>로 바로)
    let (https, https_note) = if !serve_allowed() {
        (false, Some(crate::i18n::tr("시험 데이터 폴더라 테일스케일 https 는 안 걸었어요", "Test data folder — Tailscale HTTPS was not set up").to_string()))
    } else {
        match https_on(&t, port) {
            Ok(()) => (true, None),
            Err(e) => (false, Some(e)),
        }
    };
    let watch = stop.clone();
    *RUNNING.lock().unwrap() = Some(Running { stop, tailnet: t, port, https, https_note });
    // 켜져 있는 동안 30초마다 funnel 다시 보기 — 이 서버가 멈추면(깃발) 같이 끝난다
    std::thread::spawn(move || loop {
        for _ in 0..30 {
            if watch.load(Ordering::Relaxed) {
                return;
            }
            std::thread::sleep(Duration::from_secs(1));
        }
        if funnel_check() {
            return;
        }
    });
    Ok(())
}

/// 앱이 끝날 때 — 서버를 멈추고 우리가 건 serve 를 내린다(안 그러면 443 → 죽은 포트가 남아 폰이 502)
pub fn shutdown() {
    stop_running(false);
}

fn set_error(e: Option<String>) {
    *LAST_ERROR.lock().unwrap() = e;
}

/// 앱이 뜰 때 — 켜 둔 상태면 연다(테일스케일이 늦게 뜨면 설정 화면을 열 때 다시 시도)
pub fn boot<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if saved_on(crate::config::data_dir()) {
        let h = app.clone();
        std::thread::spawn(move || set_error(start(&h).err()));
    } else {
        // 꺼진 채로 떴는데 지난번(강제 종료·크래시) 우리 serve 가 남아 있으면 내린다 — 포트가 같은 것만. 시험 폴더면 serve 를 안 만진다
        if !serve_allowed() {
            return;
        }
        std::thread::spawn(|| {
            let Some(t) = detect() else { return };
            let (Some(dns), Ok(json)) = (t.dns.as_deref(), tailscale(&t, &["serve", "status", "--json"])) else { return };
            if stale_serve(false, &json, dns, &serve_target(&t, port())) {
                let _ = tailscale(&t, &["serve", "--https=443", "off"]);
            }
        });
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileStatus {
    pub on: bool,
    pub running: bool,
    /// 실제로 묶은 곳(127.0.0.1:47123 등)
    pub bind: Option<String>,
    pub error: Option<String>,
    /// 테일스케일 HTTPS 로 열린다(폰 마이크가 된다). 못 걸었으면 이유
    pub https: bool,
    pub https_note: Option<String>,
    /// 짝지은 기기들(이름·만든 때·마지막 접속)
    pub devices: Vec<crate::mobile_pair::DeviceView>,
}

/// 짝짓기 QR — 이 화면(맥 앱)에서만 보인다. 10분 지나거나 한 번 쓰면 죽는다
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairQr {
    pub url: String,
    pub qr_svg: Option<String>,
    /// 만료 시각(ms)
    pub expires: u64,
}

fn qr_svg(text: &str) -> Option<String> {
    let code = qrcode::QrCode::new(text.as_bytes()).ok()?;
    Some(code.render::<qrcode::render::svg::Color>().min_dimensions(220, 220).quiet_zone(true).build())
}

fn status() -> MobileStatus {
    let on = saved_on(crate::config::data_dir());
    let r = RUNNING.lock().unwrap();
    MobileStatus {
        on,
        running: r.is_some(),
        bind: r.as_ref().map(|r| format!("{}:{}", r.tailnet.bind, r.port)),
        error: LAST_ERROR.lock().unwrap().clone(),
        https: r.as_ref().is_some_and(|r| r.https),
        https_note: r.as_ref().and_then(|r| r.https_note.clone()),
        devices: devices().list(),
    }
}

#[tauri::command]
pub async fn mobile_status<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> MobileStatus {
    // 켜 뒀는데 안 떠 있으면(테일스케일이 늦게 떴다) 한 번 더 시도
    if saved_on(crate::config::data_dir()) && RUNNING.lock().unwrap().is_none() {
        let _ = tauri::async_runtime::spawn_blocking(move || set_error(start(&app).err())).await;
    } else {
        // 상태를 물을 때도 funnel 을 다시 본다
        let _ = tauri::async_runtime::spawn_blocking(funnel_check).await;
    }
    status()
}

#[tauri::command]
pub async fn mobile_set<R: tauri::Runtime>(app: tauri::AppHandle<R>, on: bool) -> Result<MobileStatus, String> {
    save_on(crate::config::data_dir(), on).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        if on {
            set_error(start(&app).err());
        } else {
            stop_running(false);
            set_error(None);
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(status())
}

/// 폰 연결 QR 새로 — https 를 걸었으면 그 주소(마이크 됨), 아니면 100.x 직접. 새로 만들면 옛 QR 은 죽는다
#[tauri::command]
pub fn mobile_pair_new() -> Result<PairQr, String> {
    let r = RUNNING.lock().unwrap();
    let r = r.as_ref().ok_or_else(|| crate::i18n::tr("모바일이 꺼져 있어요", "Mobile is off").to_string())?;
    let now = std::time::SystemTime::now();
    let code = devices().new_code(now).map_err(|e| e.to_string())?;
    let url = match (&r.tailnet.dns, r.https) {
        (Some(d), true) => format!("https://{d}/?pair={code}"),
        _ => format!("http://{}:{}/?pair={code}", r.tailnet.ip, r.port),
    };
    let expires = (now + crate::mobile_pair::PAIR_TTL).duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    Ok(PairQr { qr_svg: qr_svg(&url), url, expires })
}

/// 기기 하나 끊기 — 그 폰은 다음 요청부터 401
#[tauri::command]
pub fn mobile_device_remove(id: String) -> Result<MobileStatus, String> {
    devices().remove(&id).map_err(|e| e.to_string())?;
    Ok(status())
}

/// 모든 기기 끊기(살아 있는 짝짓기 QR 도 죽인다)
#[tauri::command]
pub fn mobile_devices_clear() -> Result<MobileStatus, String> {
    devices().clear().map_err(|e| e.to_string())?;
    Ok(status())
}

// ── 맥 쪽 일(허용 목록의 실제 몸) ─────────────────────────────

struct MacBackend<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
}

/// 작업 기록은 계속 자란다 — 폰엔 끝 512KB 만(줄 경계에서 자른다)
fn tail_lines(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    // 한글은 3바이트 — 자를 자리가 글자 가운데면 다음 글자 처음으로(s[cut..] 가 패닉했다, 2026-10-02 보안 리뷰)
    let mut cut = s.len() - max;
    while !s.is_char_boundary(cut) {
        cut += 1;
    }
    let start = s[cut..].find('\n').map_or(s.len(), |i| cut + i + 1);
    s[start..].to_string()
}

impl<R: tauri::Runtime> Backend for MacBackend<R> {
    fn env(&self) -> serde_json::Value {
        let c = crate::config::current();
        let home = crate::config::home();
        serde_json::json!({
            "assistantName": crate::config::assistant_name(),
            "language": c.language,
            "devRoot": crate::config::expand(&home, &c.dev_root),
            "extraProjects": c.extra_projects.iter().map(|p| crate::config::expand(&home, p).trim_end_matches('/').to_string()).collect::<Vec<_>>(),
            "hqDir": self.hq_dir(),
        })
    }
    fn sessions(&self) -> Result<String, String> {
        // claude agents 가 멈추면 10초 뒤 죽인다(앱의 list_sessions 는 시간 제한이 없다)
        let out = crate::platform::run_capped(crate::platform::command(crate::claude::claude_bin()).args(["agents", "--json"]), Duration::from_secs(10)).map_err(|e| e.to_string())?;
        if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).into_owned()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
    }
    fn sessions_all(&self) -> Result<String, String> {
        let out = crate::platform::run_capped(crate::platform::command(crate::claude::claude_bin()).args(["agents", "--json", "--all"]), Duration::from_secs(10)).map_err(|e| e.to_string())?;
        if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).into_owned()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
    }
    fn resume(&self, cwd: &str, session_id: &str, id: &str) -> Result<String, String> {
        crate::claude::resume_blocking(cwd, session_id, (!id.is_empty()).then_some(id))
    }
    fn spawn(&self, cwd: &str, name: &str) -> Result<String, String> {
        // 데스크톱 새 참모와 같은 첫 지시 — 첫 인사를 '뭐부터 할까?'로 물으면 결정 대기로 뜬다(App spawnOrchestrator)
        let prompt = crate::i18n::tr("준비만 해 둬 — 답은 \"준비됐어\" 한 줄로, 묻지 말고 다음 지시를 기다려.", "Just get ready — reply \"Ready.\" in one line, ask nothing, and wait for the next instruction.");
        crate::claude::spawn_blocking(cwd, name, prompt)
    }
    fn push_key(&self) -> Result<String, String> {
        crate::push::vapid(crate::config::data_dir()).map(|v| v.public_b64())
    }
    fn push_subscribe(&self, device: &str, endpoint: &str, p256dh: &str, auth: &str) -> Result<(), String> {
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        crate::push::subscribe(crate::config::data_dir(), crate::push::Sub { device: device.into(), endpoint: endpoint.into(), p256dh: p256dh.into(), auth: auth.into(), at })
    }
    fn push_unsubscribe(&self, device: &str, endpoint: &str) -> Result<(), String> {
        crate::push::unsubscribe(crate::config::data_dir(), device, endpoint)
    }
    fn browser_lives(&self) -> serde_json::Value {
        crate::agent_browser::lives_for_phone()
    }
    fn browser_frame(&self, profile: &str, since: u64) -> Vec<u8> {
        crate::agent_browser::frame_bytes(profile, since)
    }
    fn tails(&self, ids: &[String]) -> serde_json::Value {
        // 하던 일 한 줄이면 된다 — 꼬리 48KB 씩(폰으로 보내는 크기)
        serde_json::to_value(crate::claude::transcript_tails(ids, 48 * 1024)).unwrap_or_default()
    }
    fn hq_dir(&self) -> String {
        crate::config::hq_dir(&crate::config::home(), &crate::config::current(), |k| std::env::var(k).ok())
    }
    fn transcript(&self, session_id: &str, from: Option<u64>) -> serde_json::Value {
        // 폰은 처음을 가볍게 읽는다(끝 256KB~2MB) — 앞은 위로 올리면 transcript_before
        serde_json::to_value(crate::claude::read_transcript_phone(session_id, from)).unwrap_or_default()
    }
    fn transcript_before(&self, session_id: &str, before: u64) -> serde_json::Value {
        serde_json::to_value(crate::claude::read_transcript_before(session_id, before)).unwrap_or_default()
    }
    fn tasks(&self) -> String {
        tail_lines(crate::claude::read_tasks(), 512 * 1024)
    }
    fn routines(&self) -> Result<String, String> {
        crate::routines::list_result()
    }
    fn usage(&self) -> String {
        let u = crate::claude::read_usage();
        if u.trim().is_empty() { "{}".into() } else { u }
    }
    fn send(&self, id: &str, text: &str) -> Result<(), String> {
        tauri::async_runtime::block_on(crate::claude::send_text_to_session(id.to_string(), text.to_string()))
    }
    fn send_later(&self, id: &str, text: &str, done: Box<dyn FnOnce(Result<(), String>) + Send>) {
        let (id, text) = (id.to_string(), text.to_string());
        std::thread::spawn(move || done(tauri::async_runtime::block_on(crate::claude::send_text_to_session(id, text))));
    }
    fn save_curation(&self, path: &str, text: &str, store: &str) -> Result<(), String> {
        crate::reader::save_curation(path.to_string(), text.to_string())?;
        crate::reader::save_curation_state(path.to_string(), store.to_string())
    }
    fn read_curation_state(&self, path: &str) -> String {
        crate::reader::read_curation_state(path.to_string())
    }
    fn doc_html(&self, path: &Path) -> Option<String> {
        crate::mobile_files::doc_html(path)
    }
    fn open_on_mac(&self, path: &str) -> Result<(), String> {
        let o = crate::platform::command("/usr/bin/open").arg(path).output().map_err(|e| e.to_string())?;
        if o.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&o.stderr).trim().to_string()) }
    }
    fn rename(&self, id: &str, nick: &str) -> Result<(), String> {
        use tauri::Manager;
        // 앱 별명으로 넘긴다(appctl 과 같은 통로) — 앱이 별명을 바꾸고 쉬는 때 /rename '참모-N · 별명'을 보낸다
        let w = self.app.get_webview_window("main").ok_or("앱 창이 없어요")?;
        let line = serde_json::json!({ "action": "orch-label", "arg": { "id": id, "nick": nick } });
        w.eval(format!("window.__appctl && window.__appctl({line})")).map_err(|e| e.to_string())
    }
    fn remove(&self, id: &str) -> Result<String, String> {
        crate::claude::remove_blocking(id)
    }
    fn stop(&self, id: &str) -> Result<String, String> {
        crate::claude::stop_blocking(id)
    }
    fn direct_log(&self) -> String {
        crate::direct::direct_log()
    }
    fn direct_answer(&self, id: &str, pick: &crate::direct::Pick) -> Result<(), String> {
        crate::direct::answer(id, pick, "phone")
    }
    fn interrupt(&self, id: &str) -> Result<(), String> {
        // 데스크톱 채팅 멈춤과 같은 Esc 한 글자 — 붙어서 넣고 뗀다. 글 치기와 차례를 지킨다(claude::interrupt_session)
        crate::claude::interrupt_session(id)
    }
    fn routine(&self, name: &str, action: &str) -> Result<String, String> {
        tauri::async_runtime::block_on(crate::routines::routine_do(name.to_string(), action.to_string()))
    }
    fn show_log(&self) -> String {
        crate::reader::read_show_log()
    }
    fn data_dir(&self) -> PathBuf {
        crate::config::data_dir().to_path_buf()
    }
    fn ctx_files(&self) -> Vec<String> {
        crate::claude::read_ctx()
    }
    fn attach(&self, ext: &str, bytes: &[u8]) -> Result<String, String> {
        crate::reader::save_attach(format!("phone.{ext}"), bytes.to_vec())
    }
    fn jpeg(&self, path: &Path, max: Option<u32>) -> Option<Vec<u8>> {
        crate::mobile_files::sips_jpeg(path, max)
    }
    fn ql_thumb(&self, path: &Path, size: u32) -> Option<Vec<u8>> {
        crate::mobile_files::ql_jpeg(path, size)
    }
    fn avatars(&self) -> serde_json::Value {
        serde_json::to_value(crate::avatar::avatars_read()).unwrap_or_default()
    }
    fn avatar_image(&self, key: &str) -> Option<(Vec<u8>, &'static str)> {
        crate::mobile_files::avatar_image_in(&crate::config::data_file("avatars"), key)
    }
    fn asset(&self, path: &str) -> Option<(Vec<u8>, String)> {
        if let Some(a) = self.app.asset_resolver().get(path.to_string()) {
            return Some((a.bytes, a.mime_type));
        }
        // 개발판(tauri dev)은 화면을 묶어 넣지 않는다 — vite build 한 dist 를 읽는다. 이름은 문지기가 이미 걸렀다
        #[cfg(debug_assertions)]
        {
            let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist").join(path);
            let bytes = std::fs::read(&p).ok()?;
            let ctype = match p.extension().and_then(|e| e.to_str()) {
                Some("html") => "text/html; charset=utf-8",
                Some("js" | "mjs") => "text/javascript; charset=utf-8",
                Some("css") => "text/css; charset=utf-8",
                Some("svg") => "image/svg+xml",
                Some("png") => "image/png",
                Some("woff2") => "font/woff2",
                Some("webmanifest") => "application/manifest+json",
                _ => "application/octet-stream",
            };
            return Some((bytes, ctype.into()));
        }
        #[allow(unreachable_code)]
        None
    }
}

#[cfg(test)]
#[path = "mobile_tests.rs"]
mod tests;
