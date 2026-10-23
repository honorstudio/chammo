//! 팀 방 상시 연결(wss, ADR 0012) — 전용 스레드 하나가 내 방들의 WebSocket 을 돌아 가며 읽는다.
//! - 끊기면 2·4·8…초(최대 5분) 뒤 다시 붙고, 서버는 내 ack 커서 뒤부터 밀린 말을 다시 준다. 같은 seq 는 team-seen.json 으로 한 번만 넘긴다
//! - 받은 말 → team_relay_inbox(기록·이름표) → 넘기기 줄(sink). 보내기는 Cmd::Send 로 이 스레드에 맡긴다(소켓은 여기만 쥔다)
//! - origin 은 HumanProof 가 있을 때만 human — HumanProof 는 메인 창·메신저 창 명령과 폰 /api/team-say 에서만 만들어진다. 참모·스크립트 길은 늘 agent
use crate::team_relay::{self, TeamState};
use crate::team_relay_inbox::{self as inbox, Action, Record};
use crate::team_relay_keys::{new_nonce, DeviceKeys};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender};
use std::time::{Duration, Instant};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::Message;

pub(crate) type Ws = tungstenite::WebSocket<MaybeTlsStream<TcpStream>>;
pub type Sink = Box<dyn Fn(String) + Send>;
/// 방 찾기 — 멤버 목록을 받고 아직 모르는 사람과의 DM 방을 연다(서버엔 '내 방 목록' 길이 없어서). team.json 을 고친다
pub type Discover = Box<dyn FnMut() -> Result<(), String> + Send>;

/// 사람이 메인 창에서 직접 쳤다는 표 — 밖에서 못 만든다(필드가 이 모듈 안에서만 보인다)
pub struct HumanProof(());

impl HumanProof {
    /// 메인 창·메신저 따로 창(team-*, 우리 페이지만 뜨는 창)의 명령에서만 — 창 프런트는 진짜(isTrusted) 키·클릭 뒤 1.5초 안에만 부른다(ADR 0011 과 같은 문)
    pub fn ui_window(w: &tauri::WebviewWindow) -> Result<HumanProof, String> {
        Self::of_label(w.label())
    }
    fn of_label(label: &str) -> Result<HumanProof, String> {
        if crate::team_ui::ui_window(label) { Ok(HumanProof(())) } else { Err("messenger windows only".into()) }
    }
    /// 폰(짝지은 폰 열쇠로 들어온 /api/team-say) — 폰 화면에서 사람이 친 말. mobile_http 의 그 길만 부른다
    pub(crate) fn phone() -> HumanProof {
        HumanProof(())
    }
}

pub enum Cmd {
    Send { room: String, cid: String, body: String, human: Option<HumanProof>, reply: Sender<Result<u64, String>> },
    /// team.json 이 바뀌었다(방이 늘었다)
    Reload,
    Stop,
}

pub fn backoff(fails: u32) -> Duration {
    Duration::from_secs((2u64 << fails.min(8)).min(300))
}

const READ_SLICE: Duration = Duration::from_millis(50);
const PING_EVERY: Duration = Duration::from_secs(45);
const DEAD_AFTER: Duration = Duration::from_secs(120);
const SEND_WAIT: Duration = Duration::from_secs(15);
/// 내 방 목록(GET /v0/me/rooms)을 다시 받는 주기 — 켤 때·연결이 끊긴 뒤·1분마다(새 방 알림 길은 서버에 아직 없음)
const DISCOVER_EVERY: Duration = Duration::from_secs(60);

struct Conn {
    ws: Ws,
    last_rx: Instant,
    last_ping: Instant,
}

pub struct Loop {
    dir: PathBuf,
    keys: DeviceKeys,
    sink: Sink,
    rx: Receiver<Cmd>,
    tick: Duration,
    conns: HashMap<String, Conn>,
    /// 방 → (실패 횟수, 다음 시도 시각)
    retry: HashMap<String, (u32, Instant)>,
    /// cid → (방, 본문, human|agent, 답할 곳, 기한)
    pending: HashMap<String, (String, String, &'static str, Sender<Result<u64, String>>, Instant)>,
    st: TeamState,
    discover: Option<Discover>,
    last_discover: Option<Instant>,
    /// 멤버마다 1분 안에 넘긴 시각 — 남이 말을 쏟아부어 내 참모 입력칸을 덮지 못하게(peer PER_MIN 과 같은 상한)
    rate: HashMap<String, Vec<u64>>,
    /// 서버가 이 기기를 끊었다(close 4001 — 다른 기기에서 끊기·로그아웃) — 다시 붙지 않는다
    revoked: bool,
}

impl Loop {
    pub fn new(dir: PathBuf, keys: DeviceKeys, sink: Sink, rx: Receiver<Cmd>) -> Loop {
        let st = team_relay::load_state(&dir);
        Loop { dir, keys, sink, rx, tick: Duration::from_millis(200), conns: HashMap::new(), retry: HashMap::new(), pending: HashMap::new(), st, discover: None, last_discover: None, rate: HashMap::new(), revoked: false }
    }

    pub fn with_discover(mut self, d: Discover) -> Loop {
        self.discover = Some(d);
        self
    }

    /// 켤 때 한 번, 그 뒤 5분마다
    fn maybe_discover(&mut self) {
        // 끊긴 기기는 서버가 401 만 준다 — 1분마다 두드리지 않는다
        if self.revoked || self.last_discover.is_some_and(|t| t.elapsed() < DISCOVER_EVERY) {
            return;
        }
        let Some(d) = self.discover.as_mut() else { return };
        self.last_discover = Some(Instant::now());
        match d() {
            Ok(()) => self.st = team_relay::load_state(&self.dir),
            Err(e) => log(&format!("방 찾기 실패: {e}")),
        }
    }

    pub fn with_tick(mut self, t: Duration) -> Loop {
        self.tick = t;
        self
    }

    pub fn run(mut self) {
        loop {
            while let Ok(c) = self.rx.try_recv() {
                match c {
                    Cmd::Stop => return,
                    Cmd::Reload => self.st = team_relay::load_state(&self.dir),
                    Cmd::Send { room, cid, body, human, reply } => self.send(room, cid, body, human.is_some(), reply),
                }
            }
            self.maybe_discover();
            let rooms: Vec<String> = if self.revoked { Vec::new() } else { self.st.rooms.iter().map(|r| r.id.clone()).collect() };
            for room in &rooms {
                if !self.conns.contains_key(room) {
                    self.try_connect(room);
                }
            }
            for room in rooms {
                self.pump(&room);
            }
            let now = Instant::now();
            self.pending.retain(|_, (_, _, _, tx, by)| {
                let alive = *by > now;
                if !alive {
                    let _ = tx.send(Err("중계 서버가 15초 안에 답하지 않았어 — 같은 cid 로 다시 보내면 한 번만 저장된다".into()));
                }
                alive
            });
            if self.conns.is_empty() {
                std::thread::sleep(self.tick);
            }
        }
    }

    fn try_connect(&mut self, room: &str) {
        let now = Instant::now();
        if self.retry.get(room).is_some_and(|(_, at)| *at > now) {
            return;
        }
        match connect(&self.st, &self.keys, room) {
            Ok(ws) => {
                self.retry.remove(room);
                self.conns.insert(room.to_string(), Conn { ws, last_rx: now, last_ping: now });
            }
            Err(e) => {
                let fails = self.retry.get(room).map_or(0, |(f, _)| f + 1);
                self.retry.insert(room.to_string(), (fails, now + backoff(fails)));
                log(&format!("방 {} 연결 실패({fails}): {e}", short(room)));
            }
        }
    }

    fn drop_conn(&mut self, room: &str, why: &str) {
        if let Some(mut c) = self.conns.remove(room) {
            let _ = c.ws.close(None);
        }
        self.retry.insert(room.to_string(), (0, Instant::now() + backoff(0)));
        // 끊긴 뒤엔 방 목록부터 다시(그사이 방이 늘었거나 내가 빠졌을 수 있다)
        self.last_discover = None;
        log(&format!("방 {} 끊김: {why}", short(room)));
    }

    /// 한 방에서 지금 읽을 수 있는 말을 다 읽는다(조각 시간 동안)
    fn pump(&mut self, room: &str) {
        loop {
            let Some(c) = self.conns.get_mut(room) else { return };
            let now = Instant::now();
            if now.duration_since(c.last_rx) > DEAD_AFTER {
                return self.drop_conn(room, "2분 동안 아무것도 안 옴");
            }
            if now.duration_since(c.last_ping) > PING_EVERY {
                c.last_ping = now;
                if let Err(e) = c.ws.send(Message::Ping(Vec::new().into())) {
                    return self.drop_conn(room, &e.to_string());
                }
            }
            match c.ws.read() {
                Ok(m) => {
                    c.last_rx = Instant::now();
                    match m {
                        Message::Text(t) => {
                            let v: Value = serde_json::from_str(t.as_str()).unwrap_or(Value::Null);
                            self.handle(room, &v);
                        }
                        Message::Close(f) if f.as_ref().is_some_and(|f| u16::from(f.code) == 4001) => {
                            self.revoked = true;
                            self.conns.clear();
                            let me = self.st.device_id.clone();
                            let _ = team_relay::mutate_if(&self.dir, &me, |s| s.revoked = true);
                            return log("이 기기가 끊겼어(다른 기기에서 끊었거나 로그아웃) — 다시 로그인해야 붙어");
                        }
                        Message::Close(_) => return self.drop_conn(room, "서버가 닫음"),
                        _ => {}
                    }
                }
                Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => return,
                Err(e) => return self.drop_conn(room, &e.to_string()),
            }
        }
    }

    fn out(&mut self, room: &str, v: Value) {
        if let Some(c) = self.conns.get_mut(room) {
            if let Err(e) = c.ws.send(Message::text(v.to_string())) {
                self.drop_conn(room, &e.to_string());
            }
        }
    }

    fn handle(&mut self, room: &str, v: &Value) {
        match v["t"].as_str().unwrap_or("") {
            "msg" => {
                let (mut act, mut rec) = inbox::on_msg(&self.st, inbox::last_seen(&self.dir, room), v);
                let Some(seq) = v["seq"].as_u64() else { return };
                if matches!(act, Action::Deliver(_)) && !crate::peer_link::allow_in(&mut self.rate, if rec.member.is_empty() { &rec.device } else { &rec.member }, now_ms()) {
                    rec.note = "rate-limited".into();
                    act = Action::Blocked("rate".into());
                }
                if act != Action::Skip {
                    // 기록 먼저 — 넘기다 앱이 꺼져도 화면엔 남는다
                    if let Err(e) = inbox::append(&self.dir, &rec) {
                        log(&format!("받은 말 기록 실패: {e}"));
                    }
                    // 창에 새 말 알리기·OS 알림(team_alert — 그 대화를 앞에 띄웠으면 안 울림)
                    crate::team_alert::on_record(&rec);
                    if let Err(e) = inbox::mark_seen(&self.dir, room, seq) {
                        log(&format!("받은 seq 기록 실패: {e}"));
                    }
                }
                self.out(room, json!({ "t": "ack", "seq": seq }));
                if let Action::Deliver(text) = act {
                    (self.sink)(text);
                }
            }
            "ready" if v["more"] == true => self.out(room, json!({ "t": "pull" })),
            "sent" | "error" => {
                let Some((rm, body, origin, tx, _)) = v["cid"].as_str().and_then(|c| self.pending.remove(c)) else { return };
                if let Some(seq) = v["seq"].as_u64().filter(|_| v["t"] == "sent") {
                    let me = &self.st;
                    let own = me.rooms.iter().any(|r| r.id == rm && r.kind == "self");
                    let rec = Record {
                        kind: if own { "self".into() } else { "team".into() },
                        member: if own { String::new() } else { me.member_id.clone() },
                        device: me.device_id.clone(),
                        device_name: me.device_name.clone(),
                        person: me.display_name.clone(),
                        room: rm,
                        seq,
                        body,
                        origin: origin.into(),
                        at: now_ms(),
                        note: "sent".into(),
                        ..Default::default()
                    };
                    let _ = inbox::append(&self.dir, &rec);
                    crate::team_alert::on_record(&rec);
                    let _ = tx.send(Ok(seq));
                } else {
                    let _ = tx.send(Err(format!("중계 서버 거절: {}", v["code"].as_str().unwrap_or("?"))));
                }
            }
            _ => {}
        }
    }

    fn send(&mut self, room: String, cid: String, body: String, human: bool, reply: Sender<Result<u64, String>>) {
        if self.revoked {
            let _ = reply.send(Err("이 기기는 끊겼어 — 다시 로그인해 줘".into()));
            return;
        }
        if !self.st.rooms.iter().any(|r| r.id == room) {
            self.st = team_relay::load_state(&self.dir);
        }
        if !self.conns.contains_key(&room) {
            self.retry.remove(&room);
            self.try_connect(&room);
        }
        if !self.conns.contains_key(&room) {
            let _ = reply.send(Err("방에 못 붙었어(중계 서버·망 확인)".into()));
            return;
        }
        let origin = if human { "human" } else { "agent" };
        self.pending.insert(cid.clone(), (room.clone(), body.clone(), origin, reply, Instant::now() + SEND_WAIT));
        self.out(&room, json!({ "t": "send", "cid": cid, "body": body, "origin": origin }));
    }
}

/// 방 하나에 붙기 — TCP 는 직접(시간 제한), TLS·업그레이드는 tungstenite(rustls). 읽기는 짧게 끊어 돌아 가며 읽는다
fn connect(st: &TeamState, k: &DeviceKeys, room: &str) -> Result<Ws, String> {
    connect_url(&team_relay::ws_url(st, k, room, now_ms(), &new_nonce()?)?)
}

/// 서명한 wss 주소로 붙고 읽기를 READ_SLICE 로 끊는다 — 방 소켓·폰 허브 소켓(phone_relay)이 같이 쓴다
pub(crate) fn connect_url(url: &str) -> Result<Ws, String> {
    let url = url.to_string();
    let tls = url.starts_with("wss://");
    let host_port = url.split_once("://").map(|x| x.1).unwrap_or("").split('/').next().unwrap_or("");
    let (host, port) = match host_port.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().map_err(|_| "bad port")?),
        None => (host_port, if tls { 443 } else { 80 }),
    };
    let addr = (host, port).to_socket_addrs().map_err(|e| format!("주소 못 찾음: {e}"))?.next().ok_or("주소 없음")?;
    let tcp = TcpStream::connect_timeout(&addr, Duration::from_secs(10)).map_err(|e| e.to_string())?;
    tcp.set_read_timeout(Some(Duration::from_secs(10))).map_err(|e| e.to_string())?;
    tcp.set_write_timeout(Some(Duration::from_secs(10))).map_err(|e| e.to_string())?;
    let _ = tcp.set_nodelay(true);
    let (ws, _) = tungstenite::client_tls_with_config(url.as_str(), tcp, None, None).map_err(|e| match e {
        tungstenite::HandshakeError::Failure(tungstenite::Error::Http(r)) => format!("서버 {}", r.status()),
        e => e.to_string(),
    })?;
    let sock = match ws.get_ref() {
        MaybeTlsStream::Plain(s) => s,
        MaybeTlsStream::Rustls(s) => &s.sock,
        _ => return Err("모르는 연결".into()),
    };
    sock.set_read_timeout(Some(READ_SLICE)).map_err(|e| e.to_string())?;
    Ok(ws)
}

fn short(id: &str) -> String {
    id.chars().take(8).collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn log(line: &str) {
    #[cfg(not(test))]
    crate::claude::log_out("team", line);
    #[cfg(test)]
    let _ = line;
}

// ── 앱에 붙이는 길 ─────────────────────────────────────────────

static TX: std::sync::Mutex<Option<Sender<Cmd>>> = std::sync::Mutex::new(None);

/// 팀이 있거나 로그인했으면 연결 스레드를 띄운다(이미 돌면 다시 읽게만). 받은 말은 넘기기 스레드가 차례로 내 참모에게
pub fn ensure(dir: &Path) {
    let st = team_relay::load_state(dir);
    // 팀이 없어도 로그인한 기기는 내 기기끼리 방이 있다
    if !st.joined() && st.account.is_none() {
        return;
    }
    let mut g = TX.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(tx) = g.as_ref() {
        if tx.send(Cmd::Reload).is_ok() {
            return;
        }
    }
    let keys = match team_relay::device_keys(&crate::team_relay_keys::store(), &st) {
        Ok(k) => k,
        Err(e) => return log(&e),
    };
    let (tx, rx) = std::sync::mpsc::channel();
    let (dtx, drx) = std::sync::mpsc::channel::<String>();
    let d = dir.to_path_buf();
    std::thread::spawn(move || {
        for text in drx {
            deliver_now(&d, &text);
        }
    });
    let sink: Sink = Box::new(move |t| {
        let _ = dtx.send(t);
    });
    let d = dir.to_path_buf();
    let dd = dir.to_path_buf();
    let mut names_at: Option<Instant> = None;
    let discover: Discover = Box::new(move || {
        let kc = crate::team_relay_keys::store();
        let before: Vec<String> = team_relay::load_state(&dd).rooms.into_iter().map(|r| r.id).collect();
        team_relay::sync_rooms(&dd, &kc, &team_relay::Curl)?;
        // 이름표에 쓸 기기·멤버 이름은 5분마다 — 새 방이 생겼으면 바로(새 사람의 첫 말이 '?' 이름으로 기록·알림되던 것, 10-23 실측)
        let st = team_relay::load_state(&dd);
        if names_due(&before, &st.rooms) {
            names_at = None;
        }
        // 기기 만든 때를 아직 모르면(로그인 직후 받기 실패) 5분을 기다리지 않고 다시 — 그동안 받은 말은 안 넘긴다
        let age_unknown = st.account.is_some() && st.device_created_at == 0;
        if age_unknown || names_at.is_none_or(|t| t.elapsed() > Duration::from_secs(300)) {
            names_at = Some(Instant::now());
            if st.joined() {
                let _ = team_relay::refresh_members(&dd, &kc, &team_relay::Curl);
            }
            if st.account.is_some() {
                let _ = crate::team_account::refresh_me(&dd, &kc, &team_relay::Curl);
            }
        }
        Ok(())
    });
    std::thread::spawn(move || Loop::new(d, keys, sink, rx).with_discover(discover).run());
    *g = Some(tx);
}

/// 방 목록에 새 방이 생겼나 — 그러면 멤버·기기 이름을 바로 다시 받는다
pub fn names_due(before: &[String], now: &[team_relay::Room]) -> bool {
    now.iter().any(|r| !before.contains(&r.id))
}

/// 선택지·권한 창에 멈춘 참모를 기다리는 최대 시간 — 넘으면 기록에만(뒤 말도 이 줄 뒤에 선다)
const BLOCKED_WAIT: Duration = Duration::from_secs(600);

fn deliver_now(dir: &Path, text: &str) {
    let st = team_relay::load_state(dir);
    let hq = crate::config::hq_dir(&crate::config::home(), &crate::config::current(), |k| std::env::var(k).ok());
    let until = Instant::now() + BLOCKED_WAIT;
    loop {
        let sessions = crate::claude::agents_json().unwrap_or_default();
        let Some(id) = inbox::assistant(&st, &sessions, &hq, &crate::config::assistant_name()) else {
            return log("받은 팀 말을 넘길 참모 세션이 없어 — 기록에만 남김");
        };
        // 입력칸에 사람이 반쯤 친 글은 치기 길이 치워 두고(Ctrl+S) 치지만, 선택 창은 글자가 답으로 눌리니 줄 세운다
        if inbox::must_wait(&sessions, &id) {
            if Instant::now() >= until {
                return log("참모가 10분 넘게 선택 창에 멈춰 있어 — 받은 팀 말은 기록에만 남김");
            }
            std::thread::sleep(Duration::from_secs(10));
            continue;
        }
        if let Err(e) = inbox::deliver(&id, text) {
            log(&format!("참모에게 못 넘김: {e}"));
        }
        return;
    }
}

/// 연결 스레드를 끈다(팀을 잊을 때)
pub fn stop() {
    if let Some(tx) = TX.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = tx.send(Cmd::Stop);
    }
}

/// 이 스레드에 보내기를 맡기고 seq 를 기다린다
pub fn send(dir: &Path, room: &str, cid: &str, body: &str, human: Option<HumanProof>) -> Result<u64, String> {
    ensure(dir);
    let (rtx, rrx) = std::sync::mpsc::channel();
    let tx = TX.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or("팀 연결이 안 떠 있어")?;
    tx.send(Cmd::Send { room: room.into(), cid: cid.into(), body: body.into(), human, reply: rtx }).map_err(|_| "팀 연결 스레드가 멈췄어".to_string())?;
    rrx.recv_timeout(SEND_WAIT + Duration::from_secs(15)).map_err(|_| "팀 연결 스레드가 답하지 않았어".to_string())?
}

#[cfg(test)]
#[path = "team_relay_ws_tests.rs"]
mod tests;
