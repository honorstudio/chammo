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
/// 받은 말 열기(시험이 바꿔 끼운다 — 전달·ack·속도 제한 시험은 봉투 열기를 e2e_state 시험에 맡긴다)
#[cfg(test)]
pub type Opener = Box<dyn Fn(&TeamState, &Value) -> crate::e2e_state::Unwrapped + Send>;

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
    /// 보안 번호가 바뀌어 멈췄던, 사람이 쳤던 말 — 사람이 카드에서 받아들인 뒤 다시 보낼 때만(e2e_cards::decide)
    pub(crate) fn accepted() -> HumanProof {
        HumanProof(())
    }
}

pub enum Cmd {
    /// body = 이 기기에 남길 평문, wire = 방에 실을 종단 암호 봉투(평문 대체 없음, R8)
    Send { room: String, cid: String, body: String, wire: String, human: Option<HumanProof>, extra: crate::e2e_envelope::Extra, reply: Sender<Result<u64, String>> },
    /// 팀 참모 답(team_helper) — 서버엔 참모 말(agent), 기록엔 via=helper
    SendHelper { room: String, cid: String, body: String, wire: String, extra: crate::e2e_envelope::Extra, reply: Sender<Result<u64, String>> },
    /// 사람이 이 방을 여기까지 봤다(화면이 보고 있을 때만 — team_mark_read). 방마다 1초에 한 번까지 묶어 {t:"read"} 로
    Read { room: String, seq: u64 },
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
/// 보낸 말을 실은 뒤 이만큼 아무것도 안 오면 그 소켓은 죽었다고 보고 다시 붙는다(2분 DEAD_AFTER 를 기다리면 보내기가 15초에 실패)
const SEND_STALL: Duration = Duration::from_secs(5);
/// 내 방 목록(GET /v0/me/rooms)을 다시 받는 주기 — 켤 때·연결이 끊긴 뒤·team_changed 를 받았을 때 바로, 그 밖엔 1분마다(놓친 알림 대비).
/// 내 기기끼리 방 소켓이 붙어 있으면 team_changed 가 그리로 오니 5분(10-26 사고 뒤 — 기기 하나가 하루 1,440번 부르던 것)
const DISCOVER_EVERY: Duration = Duration::from_secs(60);
const DISCOVER_EVERY_LIVE: Duration = Duration::from_secs(5 * 60);

/// 방 찾기 주기 — self_up = 내 기기끼리 방 소켓이 붙어 있다(team_changed 가 그리로 온다)
pub(crate) fn discover_every(self_up: bool) -> Duration {
    if self_up { DISCOVER_EVERY_LIVE } else { DISCOVER_EVERY }
}

/// 내 기기끼리 방 소켓이 지금 붙어 있나 — 기기 알림(device_pending·device_resolved)·team_changed 가 그리로 온다.
/// 붙어 있으면 1분 폴링(방 찾기·기기 카드)을 5분으로 늦춘다
static SELF_LIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn self_live() -> bool {
    SELF_LIVE.load(std::sync::atomic::Ordering::SeqCst)
}

/// 서버가 team_changed(합류·나감·새 방·방 바뀜)를 밀었다 — 다음 방 찾기에서 사람·명부 이름도 5분을 안 기다리고 다시 받는다
static NAMES_NOW: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 보내고 서버 답(sent·error)을 기다리는 말 — 끊기면 다시 붙어 같은 cid 로 다시 싣는다(서버가 기기·cid 로 한 번만 저장)
struct Pending {
    room: String,
    body: String,
    wire: String,
    origin: &'static str,
    extra: crate::e2e_envelope::Extra,
    reply: Sender<Result<u64, String>>,
    /// 마지막으로 소켓에 실은 때 — 그 뒤로 아무것도 안 오면 반쯤 죽은 소켓
    at: Instant,
    by: Instant,
}

struct Conn {
    ws: Ws,
    last_rx: Instant,
    last_ping: Instant,
    /// 끊겼다 다시 붙었으면 (끊긴 때, 붙는 데 실패한 번수, 지금까지 메운 말) — 밀린 말 끝(ready)에 한 줄 남긴다(윈도우 시험 PC 끊김 메우는 시간 재기)
    refill: Option<(Instant, u32, u32)>,
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
    /// cid → 답을 기다리는 보낸 말
    pending: HashMap<String, Pending>,
    st: TeamState,
    discover: Option<Discover>,
    last_discover: Option<Instant>,
    #[cfg(test)]
    opener: Option<Opener>,
    /// 멤버마다 1분 안에 넘긴 시각 — 남이 말을 쏟아부어 내 참모 입력칸을 덮지 못하게(peer PER_MIN 과 같은 상한)
    rate: HashMap<String, Vec<u64>>,
    /// 상한을 넘은 말 — 버리지 않고 사람마다 줄 세웠다가 자리가 나면 묶어서 넘긴다(team_relay_inbox::RateHold)
    held: inbox::RateHold,
    /// 상한 창(ms) — 1분, 시험만 줄인다
    rate_window: u64,
    /// 서버가 이 기기를 끊었다(close 4001 — 다른 기기에서 끊기·로그아웃) — 다시 붙지 않는다
    revoked: bool,
    /// 올릴 읽음(chammo-relay ADR 0012)
    reads: crate::team_reads::Outbox,
    /// 내 기기 방이 한 번이라도 붙었나·마지막으로 다시 붙어 기기 카드를 당긴 때 — 끊긴 틈의 기기 알림을 메우려고
    self_was_up: bool,
    self_nudged: Option<Instant>,
    /// 방마다 끊긴 때 — 다시 붙음 기록용
    dropped: HashMap<String, Instant>,
}

/// 내 기기 방이 다시 붙어 기기 카드를 당기는 건 이만큼에 한 번 — 소켓이 출렁여도 목록 요청이 쌓이지 않게
const SELF_RENUDGE: Duration = Duration::from_secs(60);

impl Loop {
    pub fn new(dir: PathBuf, keys: DeviceKeys, sink: Sink, rx: Receiver<Cmd>) -> Loop {
        let st = team_relay::load_state(&dir);
        Loop { dir, keys, sink, rx, tick: Duration::from_millis(200), conns: HashMap::new(), retry: HashMap::new(), pending: HashMap::new(), st, discover: None, last_discover: None, rate: HashMap::new(), held: inbox::RateHold::default(), rate_window: 60_000, revoked: false, reads: Default::default(), self_was_up: false, self_nudged: None, dropped: HashMap::new(), #[cfg(test)] opener: None }
    }

    #[cfg(test)]
    pub fn with_opener(mut self, o: Opener) -> Loop {
        self.opener = Some(o);
        self
    }

    fn open(&self, v: &Value) -> crate::e2e_state::Unwrapped {
        #[cfg(test)]
        if let Some(o) = &self.opener {
            return o(&self.st, v);
        }
        crate::e2e_state::unwrap(&self.dir, &crate::team_relay_keys::store(), &team_relay::Curl, &self.st, v)
    }

    pub fn with_discover(mut self, d: Discover) -> Loop {
        self.discover = Some(d);
        self
    }

    /// 켤 때 한 번, 그 뒤 5분마다
    fn maybe_discover(&mut self) {
        // 끊긴 기기는 서버가 401 만 준다 — 1분마다 두드리지 않는다
        let self_up = self.st.rooms.iter().any(|r| r.kind == "self" && self.conns.contains_key(&r.id));
        SELF_LIVE.store(self_up && !self.revoked, std::sync::atomic::Ordering::SeqCst);
        if self.revoked || self.last_discover.is_some_and(|t| t.elapsed() < discover_every(self_up)) {
            return;
        }
        let Some(d) = self.discover.as_mut() else { return };
        self.last_discover = Some(Instant::now());
        match d() {
            Ok(()) => self.st = team_relay::load_state(&self.dir),
            Err(e) => log(&format!("방 찾기 실패: {e}")),
        }
    }

    #[cfg(test)]
    pub fn with_rate_window(mut self, ms: u64) -> Loop {
        self.rate_window = ms;
        self
    }

    pub fn with_tick(mut self, t: Duration) -> Loop {
        self.tick = t;
        self
    }

    pub fn run(mut self) {
        loop {
            while let Ok(c) = self.rx.try_recv() {
                match c {
                    Cmd::Stop => {
                        SELF_LIVE.store(false, std::sync::atomic::Ordering::SeqCst);
                        return;
                    }
                    Cmd::Reload => self.st = team_relay::load_state(&self.dir),
                    Cmd::Read { room, seq } => self.reads.want(&room, seq),
                    Cmd::Send { room, cid, body, wire, human, extra, reply } => self.send(room, cid, body, wire, if human.is_some() { "human" } else { "agent" }, extra, reply),
                    Cmd::SendHelper { room, cid, body, wire, extra, reply } => self.send(room, cid, body, wire, "helper", extra, reply),
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
            self.flush_reads();
            let now = Instant::now();
            self.pending.retain(|_, p| {
                let alive = p.by > now;
                if !alive {
                    let _ = p.reply.send(Err("중계 서버가 15초 안에 답하지 않았어 — 같은 cid 로 다시 보내면 한 번만 저장된다".into()));
                }
                alive
            });
            for text in self.held.ready_in(&mut self.rate, now_ms(), self.rate_window) {
                (self.sink)(text);
            }
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
        // 사람 말이 답을 기다리면 다시 붙기도 사람 몫으로
        let human = self.pending.values().any(|p| p.room == room && p.origin == "human");
        let c = if human { team_relay::as_human(|| connect(&self.st, &self.keys, room)) } else { connect(&self.st, &self.keys, room) };
        match c {
            Ok(ws) => {
                if self.st.rooms.iter().any(|r| r.id == room && r.kind == "self") {
                    // 다시 붙었다 — 끊긴 틈에 온 device_pending·device_resolved 는 사라졌으니 목록을 한 번 다시 받는다(10-28 윈도우: 카드가 10분 늦게 닫힘).
                    // 처음 붙을 땐 켤 때 바퀴가 이미 받는다
                    if self.self_was_up && self.self_nudged.is_none_or(|t| t.elapsed() >= SELF_RENUDGE) {
                        crate::device_cards::nudge();
                        self.self_nudged = Some(now);
                    }
                    self.self_was_up = true;
                }
                let fails = self.retry.get(room).map_or(0, |(f, _)| *f);
                let refill = self.dropped.remove(room).map(|at| (at, fails, 0));
                self.retry.remove(room);
                self.conns.insert(room.to_string(), Conn { ws, last_rx: now, last_ping: now, refill });
                // 끊기기 전에 실었는데 답을 못 받은 말 — 보낸 차례대로 같은 cid 로 다시(서버에 이미 있으면 그 seq 로 답한다)
                let mut again: Vec<(Instant, String, Value)> = self.pending.iter().filter(|(_, p)| p.room == room).map(|(cid, p)| (p.by, cid.clone(), wire_send(cid, &p.wire, p.origin))).collect();
                again.sort_by_key(|x| x.0);
                for (_, cid, v) in again {
                    if let Some(p) = self.pending.get_mut(&cid) {
                        p.at = Instant::now();
                    }
                    self.out(room, v);
                }
            }
            Err(e) => {
                // 서버가 이 열쇠 칸이 찼다고 했다 — 다른 배경 요청도 같이 쉬게(서버 Retry-After 60초)
                if e.contains("429") {
                    team_relay::slow_down(&self.keys.public(), &serde_json::Value::Null, now);
                }
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
        // 답을 기다리는 말이 있으면 물러서지 않고 바로 다시 붙는다(답 기한 15초 안에)
        let waiting = self.pending.values().any(|p| p.room == room);
        self.retry.insert(room.to_string(), (0, Instant::now() + if waiting { Duration::ZERO } else { backoff(0) }));
        // 끊긴 뒤엔 방 목록부터 다시(그사이 방이 늘었거나 내가 빠졌을 수 있다)
        self.last_discover = None;
        self.dropped.entry(room.to_string()).or_insert_with(Instant::now);
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
            let last_rx = c.last_rx;
            if self.pending.values().any(|p| p.room == room && p.at > last_rx && now.duration_since(p.at) > SEND_STALL) {
                return self.drop_conn(room, "보낸 말에 5초 동안 아무 답 없음");
            }
            let Some(c) = self.conns.get_mut(room) else { return };
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
                        // 이 팀에서 빠졌다(나가기·빼기) — 그 방만 닫고 잊는다. 다른 팀 방·내 기기끼리 방은 그대로
                        Message::Close(f) if f.as_ref().is_some_and(|f| u16::from(f.code) == 4003) => {
                            self.conns.remove(room);
                            let (me, gone) = (self.st.device_id.clone(), room.to_string());
                            if let Ok(st) = team_relay::mutate_if(&self.dir, &me, |s| s.rooms.retain(|r| r.id != gone)) {
                                self.st = st;
                            }
                            return log(&format!("방 {}: 이 팀에서 빠졌어 — 그 팀 방만 닫았어", short(room)));
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

    /// 묶어 둔 읽음 올리기 — 붙은 방만(안 붙은 방은 붙은 뒤 다음 바퀴에)
    fn flush_reads(&mut self) {
        let now = Instant::now();
        for (room, seq) in self.reads.due(now, crate::team_reads::EVERY) {
            if !self.conns.contains_key(&room) {
                continue;
            }
            self.out(&room, json!({ "t": "read", "seq": seq }));
            if self.conns.contains_key(&room) {
                self.reads.sent(&room, seq, now);
            }
        }
    }

    /// 받은 읽음 합치기 — 올랐으면 창이 다시 읽게
    fn got_reads(&self, room: &str, got: &[(String, u64)]) {
        if crate::team_reads::merge(&self.dir, room, got) {
            crate::team_alert::poke_state();
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
            // 계정 기기 알림(ADR 0014) — 내용은 안 믿고 목록을 다시 받게만 당긴다(카드는 목록으로 맞춘다)
            // 계정 되찾기 요청이 생김·끝남(relay ADR 0007 R9) — 내용은 안 믿고 /v0/me 를 다시 받아 카드를 맞춘다
            "device_pending" | "recover_pending" | "recover_resolved" => crate::device_cards::nudge(),
            // 허용·거절·빼기 — 사슬이 바뀌었을 수 있어 방 찾기(ensure·건네주기)를 바로 돌린다
            "device_resolved" => {
                crate::device_cards::nudge();
                self.last_discover = None;
            }
            // 팀 보관함 바뀜(chammo-relay ADR 0009) — 판 번호만, 화면이 목록을 다시 받는다
            "locker" => crate::team_locker_app::nudge(v["team"].as_str().unwrap_or(""), v["rev"].as_u64().unwrap_or(0)),
            // 팀이 바뀜(합류·나감·새 방·방 바뀜, chammo-relay team-rooms) — 내용은 안 믿고 방 목록·사람을 바로 다시 받는다(qa-invite 원인 2·첫 DM 60초)
            "team_changed" => {
                NAMES_NOW.store(true, std::sync::atomic::Ordering::SeqCst);
                self.last_discover = None;
                // 사람이 들고 났다 — 보관함 받는 사람·서명 기기를 다음 목록에서 새로
                crate::team_locker_app::forget_people(v["team"].as_str().unwrap_or(""));
            }
            "msg" => {
                if let Some(r) = self.conns.get_mut(room).and_then(|c| c.refill.as_mut()) {
                    r.2 += 1;
                }
                // 봉투를 푼다(평문은 안 받는다, R8) — 못 풀거나 바뀐/갈린 사슬이면 기록만
                let opened = self.open(v);
                let (mut act, mut rec) = inbox::with_e2e(&self.st, inbox::last_seen(&self.dir, room), v, &opened);
                let Some(seq) = v["seq"].as_u64() else { return };
                // 상한을 넘었으면(또는 이 사람 몫이 이미 줄 서 있으면 — 차례가 안 뒤집히게) 줄 세운다. 자리가 나면 run 이 묶어 넘긴다
                let who = if rec.member.is_empty() { rec.device.clone() } else { rec.member.clone() };
                if let Action::Deliver(text) = &act {
                    if self.held.has(&who) || !crate::peer_link::allow_in_window(&mut self.rate, &who, now_ms(), self.rate_window) {
                        self.held.push(&who, text.clone());
                        rec.note = "rate-limited".into();
                        act = Action::Blocked("rate".into());
                    }
                }
                if act != Action::Skip {
                    // 기록 먼저 — 넘기다 앱이 꺼져도 화면엔 남는다
                    if let Err(e) = inbox::append(&self.dir, &rec) {
                        log(&format!("받은 말 기록 실패: {e}"));
                    }
                    // 받아들이면 열릴 말(명부·사슬·확인 전·보안 번호 바뀜) — 봉투를 남겨 둔다(ack 뒤엔 다시 안 온다, e2e_retry)
                    if crate::e2e_retry::worth_keeping(&opened) {
                        if let Err(e) = crate::e2e_retry::keep(&self.dir, v, &rec.note) {
                            log(&format!("다시 열 봉투 보관 실패: {e}"));
                        }
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
            // 지난 대화 건네받기(chammo-relay ADR 0007 R10) — 내 다른 기기가 이 기기 몫으로 다시 봉한 지난 말. 같은 자리에 기록만, 참모에겐 안 넘긴다
            "late" => {
                let Some(seq) = v["seq"].as_u64() else { return };
                let opened = self.open(v);
                if let Some(rec) = crate::e2e_retry::late_record(&self.st, v, &opened).filter(|_| matches!(opened, crate::e2e_state::Unwrapped::Opened { .. })) {
                    match inbox::append(&self.dir, &rec) {
                        Ok(()) => crate::team_alert::poke_state(),
                        Err(e) => log(&format!("건네받은 말 기록 실패: {e}")),
                    }
                } else if crate::e2e_retry::worth_keeping(&opened) {
                    // 내 사슬을 아직 못 믿는 등 — 남겨 두고 받아들인 뒤 다시 연다
                    if let Err(e) = crate::e2e_retry::keep(&self.dir, v, "e2e-fail") {
                        log(&format!("건네받은 봉투 보관 실패: {e}"));
                    }
                }
                self.out(room, json!({ "t": "late_ack", "seq": seq }));
            }
            // 읽음(chammo-relay ADR 0012) — 붙을 때 한 벌, 그 뒤 오를 때마다 한 줄. 옛 중계엔 없다
            "ready" => {
                self.got_reads(room, &crate::team_reads::from_ready(v));
                if v["more"] == true {
                    self.out(room, json!({ "t": "pull" }));
                } else if let Some((at, fails, n)) = self.conns.get_mut(room).and_then(|c| c.refill.take()) {
                    // 밀린 말 끝 — 다시 붙은 방이면 걸린 시간·메운 말 수 한 줄(윈도우 시험 PC 끊김 메우는 시간 재기)
                    log(&format!("방 {} 다시 붙음: 끊긴 지 {:.1}초(붙기 실패 {fails}번), 메운 말 {n}개", short(room), at.elapsed().as_secs_f64()));
                }
            }
            "read" => {
                if let Some(r) = crate::team_reads::from_read(v) {
                    self.got_reads(room, &[r]);
                }
            }
            "sent" | "error" => {
                let Some(Pending { room: rm, body, origin, extra, reply: tx, .. }) = v["cid"].as_str().and_then(|c| self.pending.remove(c)) else { return };
                if let Some(seq) = v["seq"].as_u64().filter(|_| v["t"] == "sent") {
                    let me = &self.st;
                    let own = me.rooms.iter().any(|r| r.id == rm && r.kind == "self");
                    // 보낸 방 팀의 내 멤버 id·표시 이름(팀마다 다르다)
                    let t = me.rooms.iter().find(|r| r.id == rm).and_then(|r| me.teams.iter().find(|t| t.id == r.team));
                    let rec = Record {
                        kind: if own { "self".into() } else { "team".into() },
                        member: if own { String::new() } else { t.map(|t| t.member_id.clone()).unwrap_or_else(|| me.member_id.clone()) },
                        device: me.device_id.clone(),
                        device_name: me.device_name.clone(),
                        person: t.map(|t| t.display_name.clone()).unwrap_or_else(|| me.display_name.clone()),
                        room: rm,
                        seq,
                        body,
                        origin: if origin == "helper" { "agent".into() } else { origin.into() },
                        via: if origin == "helper" { "helper".into() } else { String::new() },
                        at: now_ms(),
                        note: "sent".into(),
                        extra,
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

    /// origin = human | agent | helper(팀 참모 답 — 서버엔 agent)
    #[allow(clippy::too_many_arguments)]
    fn send(&mut self, room: String, cid: String, body: String, wire: String, origin: &'static str, extra: crate::e2e_envelope::Extra, reply: Sender<Result<u64, String>>) {
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
        let now = Instant::now();
        let v = wire_send(&cid, &wire, origin);
        self.pending.insert(cid, Pending { room: room.clone(), body, wire, origin, extra, reply, at: now, by: now + SEND_WAIT });
        self.out(&room, v);
    }
}

/// 방에 싣는 send 틀 — 팀 참모 답(helper)도 서버엔 agent
fn wire_send(cid: &str, wire: &str, origin: &str) -> Value {
    json!({ "t": "send", "cid": cid, "body": wire, "origin": if origin == "human" { "human" } else { "agent" } })
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
        let pushed = NAMES_NOW.swap(false, std::sync::atomic::Ordering::SeqCst);
        if pushed || names_due(&before, &st.rooms) {
            names_at = None;
        }
        // 기기 만든 때를 아직 모르면(로그인 직후 받기 실패) 5분을 기다리지 않고 다시 — 그동안 받은 말은 안 넘긴다
        let age_unknown = st.account.is_some() && st.device_created_at == 0;
        if age_unknown || names_at.is_none_or(|t| t.elapsed() > Duration::from_secs(300)) {
            names_at = Some(Instant::now());
            for t in &st.teams {
                let _ = team_relay::refresh_members(&dd, &kc, &team_relay::Curl, &t.id);
            }
            if st.account.is_some() {
                let _ = crate::team_account::refresh_me(&dd, &kc, &team_relay::Curl);
                // 종단 암호 준비(chammo-relay ADR 0007) — 받는 열쇠 올리기·사슬 시작. 실패해도 평문 전환기라 메신저는 돈다
                if let Err(e) = crate::e2e_flow::ensure(&dd, &kc, &team_relay::Curl) {
                    log(&format!("종단 암호 준비 실패: {e}"));
                }
                // 숫자로 막 들인 내 기기가 있으면 지난 말 열쇠를 저절로 건넨다(relay ADR 0007 R10, 뒤에서)
                crate::e2e_handover::kick(&dd);
            }
        }
        if pushed {
            crate::team_alert::poke_state();
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
        // '@참모-2'·'@별명'으로 부른 참모가 있으면 그 참모, 아니면 받는 참모(deliverTo, 비면 설정 참모 이름)
        let name = crate::config::assistant_name();
        let Some(id) = inbox::called(&sessions, &hq, &name, text).or_else(|| inbox::assistant(&st, &sessions, &hq, &name)) else {
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

/// 읽음 올리기 맡기기 — 답을 안 기다린다(스레드가 안 떠 있으면 다음에 볼 때 다시 넘어온다)
pub fn read(room: &str, seq: u64) {
    if let Some(tx) = TX.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        let _ = tx.send(Cmd::Read { room: room.into(), seq });
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
    send_with(dir, room, cid, body, human, crate::e2e_envelope::Extra::default())
}

/// 반응·붙인 파일까지(chammo-relay team-rooms v2)
pub fn send_with(dir: &Path, room: &str, cid: &str, body: &str, human: Option<HumanProof>, extra: crate::e2e_envelope::Extra) -> Result<u64, String> {
    ensure(dir);
    // 종단 암호(ADR 0007 R8) — 봉투만. 준비 전·명부 없음·보안 번호 바뀜·갈림이면 여기서 막힌다(평문으로 안 내려간다)
    // 사람 말은 배경 요청 몫과 따로(team_relay::as_human) — 폴링이 칸을 채워도 사람이 친 말은 나간다
    let seal = || crate::e2e_state::wrap_with(dir, &crate::team_relay_keys::store(), &team_relay::Curl, room, cid, body, human.is_some(), now_ms(), extra.clone());
    let sealed = if human.is_some() { team_relay::as_human(seal) } else { seal() };
    let wire = match sealed {
        Ok(w) => w,
        Err(e) => {
            // 상대 보안 번호가 바뀜·갈림이라 막혔으면 말을 멈춰 두고 카드를 당긴다 — 사람이 받아들이면 보낸다(시안 e2e-safety v1)
            if let Some(acc) = crate::e2e_safety::stopped_peer(dir, &team_relay::load_state(dir), room) {
                let _ = crate::e2e_safety::hold(dir, crate::e2e_state::Held { room: room.into(), cid: cid.into(), body: body.into(), human: human.is_some(), at: now_ms(), account: acc });
                crate::device_cards::nudge();
                return Err(format!("멈춤 — 받아들이면 보내요: {e}"));
            }
            return Err(e);
        }
    };
    let by_human = human.is_some();
    let re = extra.re;
    let (rtx, rrx) = std::sync::mpsc::channel();
    let seq = dispatch(Cmd::Send { room: room.into(), cid: cid.into(), body: body.into(), wire, human, extra, reply: rtx }, rrx)?;
    // 사람이 @팀참모·@<팀 참모 이름> 으로 불렀으면 이 기기(멘션 글을 만든 기기)만 한 번 답한다 — 받는 기기는 안 돈다
    if by_human {
        crate::team_helper::on_sent(dir, room, seq, body, re);
    }
    Ok(seq)
}

/// 팀 참모 답 보내기 — 보통 말과 같은 봉투(받는 사람 셈 그대로), 안쪽 via=helper·바깥 agent
pub fn send_helper(dir: &Path, room: &str, cid: &str, body: &str, extra: crate::e2e_envelope::Extra) -> Result<u64, String> {
    ensure(dir);
    let wire = crate::e2e_state::wrap_helper_with(dir, &crate::team_relay_keys::store(), &team_relay::Curl, room, cid, body, now_ms(), extra.clone())?;
    let (rtx, rrx) = std::sync::mpsc::channel();
    dispatch(Cmd::SendHelper { room: room.into(), cid: cid.into(), body: body.into(), wire, extra, reply: rtx }, rrx)
}

fn dispatch(cmd: Cmd, rrx: Receiver<Result<u64, String>>) -> Result<u64, String> {
    let tx = TX.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or("팀 연결이 안 떠 있어")?;
    tx.send(cmd).map_err(|_| "팀 연결 스레드가 멈췄어".to_string())?;
    rrx.recv_timeout(SEND_WAIT + Duration::from_secs(15)).map_err(|_| "팀 연결 스레드가 답하지 않았어".to_string())?
}

#[cfg(test)]
#[path = "team_relay_ws_tests.rs"]
mod tests;
