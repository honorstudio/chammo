//! 폰 중계 — 이 컴퓨터가 중계 허브에 주인으로 붙어 있는 소켓 하나(ADR 0013·서버 ADR 0005). 테일스케일 없는 폰이 이 길로 온다.
//! - 켜지는 때: 폰 연결을 켜 뒀고(mobile.json) 이 기기가 중계에 등록돼 있고(team.json) 폰 입구 주소(phoneWeb)가 있을 때
//! - 받은 틀은 phone_relay_core(세션·같은 문)로, 처리는 일꾼 스레드(최대 8)에서 하고 봉하기·보내기는 이 스레드만(번호 차례)
//! - 끊기면 2·4·8…초(최대 5분) 뒤 다시. 서버가 이 기기를 끊으면(4001) 다시 안 붙는다
use crate::mobile_http::{Backend, Gate};
use crate::phone_relay_core::{self as core, Ev, Lines, Tunnels};
use crate::phone_tunnel as tun;
use crate::team_relay::{self, TeamState};
use crate::team_relay_keys::{new_nonce, DeviceKeys};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tungstenite::Message;

const PING_EVERY: Duration = Duration::from_secs(45);
const DEAD_AFTER: Duration = Duration::from_secs(120);
const CHECK_EVERY: Duration = Duration::from_secs(10);
const MAX_WORKERS: usize = 8;
/// 이만큼 붙어 있다 끊기면 '잘 돌던 연결' — 다시 붙기 기다림을 처음(4초)부터
const HEALTHY: Duration = Duration::from_secs(60);

/// 다음 다시 붙기 차례 수(team_relay_ws::backoff 에 넣는다). up = 이번에 붙어 있던 시간(못 붙었으면 None)
fn next_fails(fails: u32, up: Option<Duration>) -> u32 {
    if up.is_some_and(|d| d >= HEALTHY) { 1 } else { fails.saturating_add(1) }
}

/// 지금 상태 — 설정 화면이 읽는다
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatus {
    pub on: bool,
    pub connected: bool,
    pub phones: usize,
    pub error: Option<String>,
}

static STATUS: Mutex<Option<RelayStatus>> = Mutex::new(None);
static STARTED: AtomicBool = AtomicBool::new(false);

pub fn status() -> RelayStatus {
    STATUS.lock().unwrap().clone().unwrap_or_default()
}

fn set_status(f: impl FnOnce(&mut RelayStatus)) {
    let mut g = STATUS.lock().unwrap();
    f(g.get_or_insert_with(Default::default));
}

fn log(line: &str) {
    crate::claude::log_out("phone-relay", line);
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

struct RealLines {
    devices: Arc<crate::mobile_pair::Devices>,
    keys: DeviceKeys,
}

impl Lines for RealLines {
    fn line_of(&self, relay: &str) -> Option<(String, Vec<u8>)> {
        let (id, x) = self.devices.relay_line(relay)?;
        Some((id, tun::pubkey(&x).ok()?))
    }
    fn agree(&self, their: &[u8]) -> Option<[u8; 32]> {
        self.keys.tunnel_agree(their)
    }
}

/// 켤 조건이 맞으면 (상태, 입구 주소) — 폰 연결 켬, 또는 로그인했고 사람이 끄지 않음
fn wanted(dir: &Path) -> Option<(TeamState, String)> {
    let st = team_relay::load_state(dir);
    // 폰 연결을 켰거나, 로그인한 컴퓨터는 사람이 끄지 않은 한 늘(ADR 0014 — 넣기 없이 폰이 숫자 확인으로 붙는다)
    if !(crate::mobile::saved_on(dir) || st.account.is_some() && !crate::mobile::explicit_off(dir)) {
        return None;
    }
    if !st.registered() || st.revoked {
        return None;
    }
    let web = team_relay::phone_web(&st)?;
    team_relay::server_ok(&st.server)?;
    Some((st, web))
}

/// 폰 추가 QR 주소 — 입구 주소만(짝 코드·열쇠·비밀 없음). 폰은 사파리에서 홈 화면에 추가 → 홈 화면 앱에서 계정 로그인 → 이 컴퓨터 숫자 확인(ADR 0014)
pub fn entry_url(web: &str) -> String {
    format!("{}/", web.trim_end_matches('/'))
}

/// QR 주소 — 입구 주소 # 코드·이 기기 중계 id·터널 열쇠·중계 주소. `#` 뒤라 호스팅 로그·Referer 에 안 남는다
pub fn qr_url(web: &str, code: &str, st: &TeamState, mac_x: &str) -> String {
    let enc = |s: &str| s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>();
    format!("{web}/pair#p={code}&m={}&k={mac_x}&r={}", enc(&st.device_id), enc(&st.server))
}

/// 설정 화면 — 켤 수 있으면 (입구 주소, 상태, 이 기기 터널 공개 열쇠)
pub fn ready(dir: &Path) -> Option<(String, TeamState, String)> {
    let (st, web) = wanted(dir)?;
    let keys = team_relay::device_keys(&crate::team_relay_keys::store(), &st).ok()?;
    Some((web, st, keys.tunnel_public()))
}

/// 앱이 뜰 때 한 번 — 조건을 10초마다 보며 붙었다 떨어졌다 한다
pub fn boot<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let dir = crate::config::data_dir().to_path_buf();
        let mut fails = 0u32;
        loop {
            drain(&dir);
            let Some((st, web)) = wanted(&dir) else {
                set_status(|s| *s = RelayStatus::default());
                std::thread::sleep(CHECK_EVERY);
                continue;
            };
            let keys = match team_relay::device_keys(&crate::team_relay_keys::store(), &st) {
                Ok(k) => k,
                Err(e) => {
                    set_status(|s| { s.on = true; s.connected = false; s.error = Some(e); });
                    std::thread::sleep(CHECK_EVERY * 6);
                    continue;
                }
            };
            let (gate, be) = crate::mobile::relay_parts(&app, &web);
            set_status(|s| { s.on = true; s.error = None; });
            let mut up = None;
            match run(&dir, &st, &web, keys, gate, be, &mut up) {
                Ok(()) => fails = 0,
                Err(e) if e == "revoked" => {
                    log("서버가 이 기기를 끊었어 — 폰 중계 멈춤");
                    let _ = team_relay::mutate_if(&dir, &st.device_id, |s| s.revoked = true);
                }
                Err(e) => {
                    set_status(|s| { s.connected = false; s.error = Some(e.clone()); });
                    fails = next_fails(fails, up.map(|t: Instant| t.elapsed()));
                    let wait = crate::team_relay_ws::backoff(fails);
                    // 끊긴 까닭·붙어 있던 시간을 남긴다 — 전엔 '허브에 붙음'만 남아 폰이 안 될 때 맥 쪽이 빠졌었는지 못 가렸다
                    log(&format!("허브 끊김 — {e} · {}초 붙어 있었음 · {}초 뒤 다시", up.map_or(0, |t: Instant| t.elapsed().as_secs()), wait.as_secs()));
                    std::thread::sleep(wait);
                }
            }
        }
    });
}

enum Out {
    /// 그 연결로 보낼 평문 조각들(봉하는 건 소켓 스레드)
    Reply(String, Vec<Vec<u8>>),
    /// 두드리기 답(이미 봉한 상자)
    Knock(String, String),
    /// 숫자 확인 두드리기의 답(이미 봉한 상자 — 단계 이름은 상자 안, 허브는 단계를 안 넘긴다). end = 마지막 답(허브가 두드리기를 닫는다) — ADR 0014
    KnockLink(String, String, bool),
    /// 못 연 상자 — 두드린 쪽을 바로 닫게(보안 검토 F)
    KnockClose(String),
}

/// 붙어서 돌기 — 조건이 바뀌면 Ok 로 나온다
fn run(dir: &Path, st: &TeamState, web: &str, keys: DeviceKeys, gate: Arc<Gate>, be: Arc<dyn Backend>, up: &mut Option<Instant>) -> Result<(), String> {
    let mut ws = crate::team_relay_ws::connect_url(&team_relay::hub_url(st, &keys, now_ms(), &new_nonce()?)?)?;
    *up = Some(Instant::now());
    log("허브에 붙음");
    set_status(|s| { s.connected = true; s.error = None; });
    let me_pub = tun::pubkey(&keys.tunnel_public()).map_err(|_| "열쇠 모양")?;
    let mac = json!({ "id": st.device_id, "name": st.device_name });
    let lines = Arc::new(RealLines { devices: gate.devices.clone(), keys });
    let mut t = Tunnels::default();
    let (tx, rx): (Sender<Out>, Receiver<Out>) = channel();
    let busy = Arc::new(AtomicUsize::new(0));
    let (mut last_rx, mut last_ping, mut last_check) = (Instant::now(), Instant::now(), Instant::now());
    *LINK_OUT.lock().unwrap_or_else(|e| e.into_inner()) = Some(LinkOut { gen: LINK_GEN.fetch_add(1, Ordering::SeqCst) + 1, tx: tx.clone(), mac: mac.clone(), devices: gate.devices.clone() });
    register_tunnel(st, &lines.keys);
    let mut tunnel_sent = !st.pending;
    let send = |ws: &mut crate::team_relay_ws::Ws, v: Value| ws.send(Message::text(v.to_string())).map_err(|e| e.to_string());
    loop {
        // 일꾼이 끝낸 것 — 봉해서 보낸다(번호는 이 스레드에서만 오른다)
        while let Ok(o) = rx.try_recv() {
            match o {
                Out::Reply(c, chunks) => {
                    for pt in chunks {
                        let Some(f) = t.seal(&c, &pt) else { break };
                        send(&mut ws, json!({ "t": "f", "to": c, "d": tun::b64(&f) }))?;
                    }
                }
                Out::Knock(k, boxed) => send(&mut ws, json!({ "t": "knock-reply", "k": k, "box": boxed }))?,
                Out::KnockLink(k, boxed, end) => send(&mut ws, json!({ "t": "knock-reply", "k": k, "box": boxed, "end": end }))?,
                Out::KnockClose(k) => send(&mut ws, json!({ "t": "knock-close", "k": k }))?,
            }
        }
        match ws.read() {
            Ok(Message::Text(txt)) => {
                last_rx = Instant::now();
                let Ok(m) = serde_json::from_str::<Value>(txt.as_str()) else { continue };
                let s = |k: &str| m[k].as_str().unwrap_or("").to_string();
                match m["t"].as_str() {
                    Some("f") => {
                        let had = t.len();
                        let (from, c) = (s("from"), s("c"));
                        let Ok(frame) = tun::unb64(&s("d")) else { continue };
                        for ev in t.on_frame(&*lines, &from, &c, &frame) {
                            match ev {
                                Ev::Send(f) => send(&mut ws, json!({ "t": "f", "to": c, "d": tun::b64(&f) }))?,
                                Ev::Drop(why) => log(&format!("연결 버림 {} — {why}", &c)),
                                Ev::Run(req) => {
                                    let line = t.line(&c).unwrap_or_default().to_string();
                                    work(req, line, c.clone(), &gate, &be, &busy, &tx);
                                }
                            }
                        }
                        // 익명 사용 통계 — 폰이 새로 붙은 횟수만
                        if t.len() > had {
                            crate::usage_counts::record_use("phone");
                        }
                        set_status(|x| x.phones = t.len());
                    }
                    Some("bye") => {
                        t.bye(&s("c"));
                        set_status(|x| x.phones = t.len());
                    }
                    // 숫자 확인 두드리기(ADR 0014) — 단계가 붙은 틀. 단계 없는 두드리기는 QR 짝짓기 그대로
                    // 기기 두드리기(허브가 확인한 기기 id 가 붙음) = 숫자 확인. 기기 id 없는 두드리기는 QR 짝짓기 그대로
                    Some("knock") if m["dev"].as_str().is_some_and(|d| !d.is_empty()) => {
                        // 목록을 다시 받을 수 있어(망) 소켓 스레드를 안 막게 따로 — 일꾼은 넷까지, 넘으면 그 두드리기를 닫는다(리뷰 3)
                        if LINK_BUSY.fetch_add(1, Ordering::SeqCst) >= MAX_LINK_WORKERS {
                            LINK_BUSY.fetch_sub(1, Ordering::SeqCst);
                            send(&mut ws, json!({ "t": "knock-close", "k": s("k") }))?;
                        } else {
                            let (m, me_pub, lines, tx) = (m.clone(), me_pub.clone(), lines.clone(), tx.clone());
                            std::thread::spawn(move || {
                                link_step(&m, &me_pub, &lines, &tx);
                                LINK_BUSY.fetch_sub(1, Ordering::SeqCst);
                            });
                        }
                    }
                    Some("knock") => knock(s("k"), s("box"), s("key"), me_pub.clone(), lines.clone(), gate.clone(), st.clone(), mac.clone(), tx.clone()),
                    Some("knock-end") => {
                        if let Some(card) = LINKS.drop_knock(&s("k")) {
                            crate::direct::close_link(&card, crate::i18n::tr("폰이 나갔어요", "The phone left"));
                        }
                    }
                    _ => {}
                }
            }
            Ok(Message::Ping(_) | Message::Pong(_)) => last_rx = Instant::now(),
            Ok(Message::Close(f)) => {
                let code: u16 = f.map(|f| f.code.into()).unwrap_or(0);
                return Err(if code == 4001 { "revoked".into() } else { format!("허브가 닫음 {code}") });
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(e) => return Err(e.to_string()),
        }
        if last_ping.elapsed() > PING_EVERY {
            last_ping = Instant::now();
            ws.send(Message::Ping(Vec::new().into())).map_err(|e| e.to_string())?;
        }
        if last_rx.elapsed() > DEAD_AFTER {
            return Err("허브가 2분 넘게 조용함".into());
        }
        if last_check.elapsed() > CHECK_EVERY {
            last_check = Instant::now();
            drain(dir);
            // 대기로 붙었다가 허용됐으면 그때 터널 열쇠를 올린다(리뷰: 다시 붙을 때까지 안 올라가던 것)
            if st.pending && !tunnel_sent {
                let now_st = team_relay::load_state(dir);
                if !now_st.pending {
                    register_tunnel(&now_st, &lines.keys);
                    tunnel_sent = true;
                }
            }
            // 폰 연결을 껐거나 로그아웃·주소가 바뀌면 나간다(바깥 고리가 다시 본다)
            if wanted(dir).is_none_or(|(s, w)| s.device_id != st.device_id || s.server != st.server || w != web) {
                let _ = ws.close(None);
                return Ok(());
            }
        }
    }
}

const MAX_LINK_WORKERS: usize = 4;
static LINK_BUSY: AtomicUsize = AtomicUsize::new(0);
/// 숫자 확인 link1 의 목록 다시 받기는 몇 초에 한 번만(모르는 기기로 두드려 서버 요청을 불리지 못하게)
static LINK_REFRESHED: Mutex<Option<Instant>> = Mutex::new(None);

/// 숫자 확인 두드리기 상태(이 컴퓨터 하나) — 카드 답(link_answer)이 다른 스레드에서 꺼낸다
static LINKS: std::sync::LazyLock<crate::device_link::Links> = std::sync::LazyLock::new(Default::default);

struct LinkOut {
    /// 허브 연결 세대 — 붙을 때마다 하나씩(카드 답 사이에 다시 붙었는지 가린다)
    gen: u64,
    tx: Sender<Out>,
    mac: Value,
    devices: Arc<crate::mobile_pair::Devices>,
}
/// 지금 붙어 있는 허브로 보내는 길 — 끊기면 다음 붙을 때 바뀐다
static LINK_OUT: Mutex<Option<LinkOut>> = Mutex::new(None);
static LINK_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 이 컴퓨터 터널 공개 열쇠를 서버에 알린다(폰이 /v0/me/self 로 받아 link1 을 봉한다 — 숫자 확인이 진짜인지 가린다). 안 되면 조용히
fn register_tunnel(st: &TeamState, keys: &DeviceKeys) {
    if st.pending || st.account.is_none() {
        return;
    }
    match team_relay::call(&team_relay::Curl, &st.server, keys, Some(&st.device_id), "PUT", "/v0/me/tunnel", Some(&json!({ "tunnelPub": keys.tunnel_public() }))) {
        Ok((200 | 204, _)) => {}
        Ok((c, _)) => log(&format!("터널 열쇠 등록 {c}")),
        Err(e) => log(&format!("터널 열쇠 등록 실패 {e}")),
    }
}

/// 숫자 확인 한 단계 — link1(인사·commit) → link2(nM) / link3(nP) → 숫자 카드. 순서를 어기거나 못 연 상자는 닫는다
fn link_step(m: &Value, me_pub: &[u8], lines: &Arc<RealLines>, tx: &Sender<Out>) {
    let s = |k: &str| m[k].as_str().unwrap_or("").to_string();
    let k = s("k");
    let close = |why: &str| {
        log(&format!("숫자 확인 두드리기 닫음 — {why}"));
        if let Some(card) = LINKS.drop_knock(&k) {
            crate::direct::close_link(&card, crate::i18n::tr("확인이 끊겼어요", "The check was cut off"));
        }
        let _ = tx.send(Out::KnockClose(k.clone()));
    };
    // 지금 상태를 새로 읽는다(허브에 붙을 때 받아 둔 것은 낡았다 — 막 로그인한 폰이 목록에 없다)
    let dir = crate::config::data_dir();
    let mut st = team_relay::load_state(dir);
    if st.pending || st.account.is_none() {
        return close("이 기기가 아직 허용 전");
    }
    let opened = tun::unb64(&s("box")).ok().and_then(|b| tun::open(me_pub, |e| lines.agree(e), &b).ok()).and_then(|pt| serde_json::from_slice::<Value>(&pt).ok());
    let Some(body) = opened else { return close("상자 못 엶") };
    let now = Instant::now();
    // 단계 이름은 봉한 상자 안에서 읽는다(허브는 단계를 넘기지 않고, 중계가 바꿔 끼울 수도 없다)
    let step = body["step"].as_str().unwrap_or("").to_string();
    // 답은 늘 폰 터널 열쇠로 봉한다
    let send_box = |x: &[u8], v: Value, end: bool| match tun::seal(x, v.to_string().as_bytes()) {
        Ok(b) => {
            let _ = tx.send(Out::KnockLink(k.clone(), tun::b64(&b), end));
            true
        }
        Err(_) => false,
    };
    match step.as_str() {
        "link1" => {
            // 같은 계정의 폰 기기만 — 서버가 확인한 기기 id 가 내 기기 목록에서 폰이어야
            let dev = s("dev");
            let mine = |st: &TeamState| st.my_devices.iter().any(|d| d.id == dev && d.kind == "phone" && !d.current);
            if !mine(&st) {
                let due = {
                    let mut last = LINK_REFRESHED.lock().unwrap_or_else(|e| e.into_inner());
                    let due = last.is_none_or(|t| t.elapsed() > Duration::from_secs(5));
                    if due {
                        *last = Some(Instant::now());
                    }
                    due
                };
                if due {
                    if let Ok(fresh) = crate::team_account::refresh_me(dir, &crate::team_relay_keys::store(), &team_relay::Curl) {
                        st = fresh;
                    }
                }
                if !mine(&st) {
                    return close("내 계정 폰이 아님");
                }
            }
            match LINKS.first_replacing(&k, &body, &s("key"), &dev, me_pub, now) {
                Ok((cm, old)) => {
                    // 같은 폰의 옛 두드리기 카드는 닫는다(기기마다 하나)
                    if let Some(card) = old {
                        crate::direct::close_link(&card, crate::i18n::tr("새 확인으로 바뀌었어요", "Replaced by a newer check"));
                    }
                    // ② nM 은 봉한 것(cM)만 — 폰이 nP 를 연 뒤에 연다
                    let x = tun::pubkey(body["x"].as_str().unwrap_or_default()).unwrap_or_default();
                    if !send_box(&x, json!({ "step": "link2", "cM": tun::b64(&cm) }), false) {
                        close("봉하기");
                    }
                }
                Err(e) => close(&e),
            }
        }
        "link3" => {
            let np = tun::unb64(body["nP"].as_str().unwrap_or_default()).unwrap_or_default();
            // 카드를 먼저 띄우고 ④ nM 을 연다 — 중계가 숫자를 아는 순간 카드는 이미 사람 화면에(리뷰 2차 심각)
            let fresh = team_relay::load_state(dir);
            let write_card = |h: &crate::device_link::Hello, n: u32| -> Option<String> {
                let id = crate::mobile_pair::random_hex(4).ok().filter(|i| !i.is_empty())?;
                let until = now_ms() + crate::device_link::LINK_TTL.as_millis() as u64;
                // 허용 대기 기기면 이 카드가 계정 허용도 한다 — 새 기기·로그인한 곳을 같이 보인다(리뷰 2차 중)
                let pending = fresh.my_devices.iter().find(|d| d.id == h.dev && d.pending()).map(|d| [d.req_city.as_str(), d.req_country.as_str()].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", "));
                crate::direct::append_row(&crate::device_cards::phone_link_row(&id, &h.name, n, until, pending.as_deref(), &crate::direct::chrono_now())).ok()?;
                Some(id)
            };
            match LINKS.link3(&k, &np, me_pub, now, write_card) {
                Ok((nm, _card, x)) => {
                    log("숫자 확인 카드 띄움");
                    if !send_box(&x, json!({ "step": "link4", "nM": tun::b64(&nm) }), false) {
                        close("봉하기");
                    }
                }
                // 카드는 썼는데 그새 두드리기가 끊겼다 — 묶이지 않은 카드를 닫는다(재리뷰 2)
                Err(e) if e.starts_with("gone:") => {
                    crate::direct::close_link(&e[5..], crate::i18n::tr("확인이 끊겼어요", "The check was cut off"));
                    close("두드리기 끊김");
                }
                Err(e) => close(&e),
            }
        }
        _ => close("모르는 단계"),
    }
}

/// 사람이 숫자 카드에 답했다(direct::answer 의 폰 화면 열기 갈래 — 데스크톱 메인 창·짝지은 폰만).
/// 허용 = (폰이 계정 대기면 계정 허용도) → 기기 줄 묶기 → 토큰을 폰 터널 열쇠로 봉해 link5(end). 거절 = link5 {ok:false}
pub fn link_answer(card: &str, yes: bool) -> Result<(), String> {
    let (k, h) = LINKS.take_card(card, Instant::now()).ok_or_else(|| crate::i18n::tr("이 확인은 끝났어요(시간 지남·폰이 나감)", "This check has ended (timed out or the phone left)").to_string())?;
    // 보내는 길만 복제하고 잠금은 바로 놓는다 — 아래 서버 요청(curl) 동안 허브 재접속을 막지 않게(리뷰 7)
    let (gen, tx, mac, devices) = {
        let g = LINK_OUT.lock().unwrap_or_else(|e| e.into_inner());
        let out = g.as_ref().ok_or_else(|| crate::i18n::tr("중계에 안 붙어 있어요", "Not connected to the relay").to_string())?;
        (out.gen, out.tx.clone(), out.mac.clone(), out.devices.clone())
    };
    let reply = |v: Value| -> Result<(), String> {
        let b = tun::seal(&h.x, v.to_string().as_bytes()).map_err(|_| "seal")?;
        tx.send(Out::KnockLink(k.clone(), tun::b64(&b), true)).map_err(|_| "허브 연결이 끊겼어요".to_string())
    };
    if !yes {
        return reply(json!({ "step": "link5", "ok": false, "error": "declined" }));
    }
    let dir = crate::config::data_dir();
    let st = team_relay::load_state(dir);
    let line = st.my_devices.iter().find(|d| d.id == h.dev).cloned();
    if line.as_ref().is_some_and(|d| d.pending()) {
        if let Err(e) = crate::team_account::decide_device(dir, &crate::team_relay_keys::store(), &team_relay::Curl, &h.dev, true) {
            let _ = reply(json!({ "step": "link5", "ok": false, "error": "relay" }));
            return Err(e);
        }
    } else if line.is_none() {
        let _ = reply(json!({ "step": "link5", "ok": false, "error": "device" }));
        return Err(crate::i18n::tr("내 계정 기기 목록에 없는 폰이에요", "That phone is not in this account").into());
    }
    // 허브가 그새 끊겼으면 줄을 만들기 전에 멈춘다 — 토큰을 아무도 모르는 줄이 남지 않게(리뷰 7)
    if LINK_OUT.lock().unwrap_or_else(|e| e.into_inner()).as_ref().is_none_or(|o| o.gen != gen) {
        return Err(crate::i18n::tr("허브 연결이 바뀌었어요 — 폰에서 다시 해 주세요", "The relay connection changed — try again from the phone").into());
    }
    let p = crate::mobile_pair::Pairing { name: &h.name, home: false, prev: None, peer: false };
    let Some(token) = devices.pair_linked(&p, crate::mobile_pair::Relay { device: h.dev.clone(), x: tun::b64(&h.x) }, std::time::SystemTime::now()) else {
        let _ = reply(json!({ "step": "link5", "ok": false, "error": "pair" }));
        return Err("기기 줄을 못 만들었어요".into());
    };
    if let Err(e) = reply(json!({ "step": "link5", "ok": true, "token": token, "device": h.dev, "mac": mac })) {
        // 못 보냈으면 방금 만든 줄은 지운다(아무도 그 토큰을 모른다)
        if let Some(id) = devices.list().into_iter().find(|d| devices.relay_of(&d.id).as_deref() == Some(h.dev.as_str())).map(|d| d.id) {
            let _ = devices.remove(&id);
        }
        return Err(e);
    }
    Ok(())
}

/// 요청 하나를 일꾼에게 — 다 차 있으면 바로 503
fn work(req: core::TReq, line: String, c: String, gate: &Arc<Gate>, be: &Arc<dyn Backend>, busy: &Arc<AtomicUsize>, tx: &Sender<Out>) {
    let head = req.method == "HEAD";
    if busy.fetch_add(1, Ordering::SeqCst) >= MAX_WORKERS {
        busy.fetch_sub(1, Ordering::SeqCst);
        let r = crate::mobile_http::Resp { status: 503, headers: vec![("Content-Type", "text/plain; charset=utf-8".into())], body: b"busy".to_vec() };
        let _ = tx.send(Out::Reply(c, core::resp_chunks(req.id, &r, head)));
        return;
    }
    let (gate, be, busy, tx) = (gate.clone(), be.clone(), busy.clone(), tx.clone());
    std::thread::spawn(move || {
        let r = core::serve(&req, &line, &gate, &*be);
        busy.fetch_sub(1, Ordering::SeqCst);
        let _ = tx.send(Out::Reply(c, core::reply_chunks(&req, &r)));
    });
}

/// 두드리기 — 상자를 열어 짝짓기(중계에 기기 들이기 포함)하고 답을 폰 열쇠로 봉한다. 못 연 상자엔 답하지 않는다(봉할 열쇠가 없다)
#[allow(clippy::too_many_arguments)]
fn knock(k: String, boxed: String, hub_key: String, me_pub: Vec<u8>, lines: Arc<RealLines>, gate: Arc<Gate>, st: TeamState, mac: Value, tx: Sender<Out>) {
    std::thread::spawn(move || {
        let knock = match core::open_knock(&me_pub, |e| lines.agree(e), &boxed) {
            Ok(x) => x,
            Err(e) => {
                let _ = tx.send(Out::KnockClose(k));
                return log(&format!("두드리기 상자 못 엶 — {e}"));
            }
        };
        let add = |sign: &str, name: &str| -> Result<String, String> {
            let (code, v) = team_relay::call(&team_relay::Curl, &st.server, &lines.keys, Some(&st.device_id), "POST", "/v0/me/devices/add", Some(&json!({ "publicKey": sign, "name": name })))?;
            match (code, v["deviceId"].as_str()) {
                (200 | 201, Some(id)) => Ok(id.to_string()),
                _ => Err(team_relay::why(code, &v)),
            }
        };
        let v = core::answer_knock(&knock, &hub_key, &gate.devices, add, &mac);
        log(&format!("두드리기 {}", if v["ok"] == true { "짝지음".to_string() } else { format!("거절 {}", v["error"]) }));
        if let Ok(b) = tun::seal(&knock.x, v.to_string().as_bytes()) {
            let _ = tx.send(Out::Knock(k, tun::b64(&b)));
        }
    });
}

/// 끊긴 폰 줄의 중계 기기를 중계에서도 끊는다(보안 검토 C) — 실패하면 대기열에 남아 다음에 다시. 폰 연결을 꺼 둬도 돈다
fn drain(dir: &Path) {
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    {
        let mut last = LAST.lock().unwrap();
        if last.is_some_and(|t| t.elapsed() < Duration::from_secs(30)) {
            return;
        }
        *last = Some(Instant::now());
    }
    let devices = crate::mobile::devices();
    if devices.pending_revokes().is_empty() {
        return;
    }
    let st = team_relay::load_state(dir);
    if !st.registered() || st.revoked {
        return;
    }
    let Ok(keys) = team_relay::device_keys(&crate::team_relay_keys::store(), &st) else { return };
    let (done, left) = core::drain_revokes(&devices, |id| {
        if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
            return Ok(404); // 모양이 틀린 줄은 버린다
        }
        team_relay::call(&team_relay::Curl, &st.server, &keys, Some(&st.device_id), "POST", &format!("/v0/me/devices/{id}/revoke"), Some(&json!({}))).map(|(c, _)| c)
    });
    if done + left > 0 {
        log(&format!("끊긴 폰 중계 기기 끊기 {done}개{}", if left > 0 { format!(", {left}개는 다음에 다시") } else { String::new() }));
    }
}

/// 컴퓨터 일(참모 답·카드)이 생겼을 때 — 중계로 짝지은 폰마다 본문 없는 푸시를 부탁한다(서버가 10초에 한 번으로 묶는다)
pub fn notify_phones(dir: &PathBuf, relays: Vec<String>) {
    if relays.is_empty() {
        return;
    }
    let dir = dir.clone();
    std::thread::spawn(move || {
        let Some((st, _)) = wanted(&dir) else { return };
        let Ok(keys) = team_relay::device_keys(&crate::team_relay_keys::store(), &st) else { return };
        for to in relays {
            if let Err(e) = team_relay::call(&team_relay::Curl, &st.server, &keys, Some(&st.device_id), "POST", "/v0/push/notify", Some(&json!({ "to": to }))) {
                log(&format!("푸시 부탁 실패 — {e}"));
            }
        }
    });
}

#[cfg(test)]
#[path = "phone_relay_tests.rs"]
mod tests;
