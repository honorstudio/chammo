//! 다른 기기 참모 연결 요청 — 코드 없이(0.3.2, ADR 0007 '짝짓기를 코드 없이').
//! 요청하는 쪽(A): '연결' → 비밀 요청 번호 req(16진 32자)를 적어 두고 B 의 /api/link-request 에 {req, node: A 노드 ID}.
//! 받는 쪽(B): ① 10분 5번·기다리는 카드 3장 상한 ② 그 노드가 B 테일넷의 같은 계정·태그 없는 기기인지
//!   ③ A 주소(지금 테일넷의 그 노드 ID 주소)로 되물어(/api/link-check) A 가 정말 그 req 로 요청 중인지 — userspace 맥은 출발지 주소를
//!   못 믿어서(교훈) 출발지 대신 되묻기로 신원을 본다 ④ 사람에게 카드(결정 대기함·채팅·폰). 카드 답은 사람 길만(direct.rs)
//! A 는 /api/link-status?req 로 기다리다 허용이면 열쇠 둘(A→B, B→A)을 한 번에 받는다 — 허용 한 번으로 양방향.
//! 거절·5분 무응답·앱 재시작이면 아무것도 안 생긴다(열쇠는 A 가 받아 갈 때 만든다)
use crate::mobile_http::ct_eq;
use sha2::{Digest, Sha256};
use std::net::Ipv4Addr;
use std::sync::Mutex;

/// 카드가 허용을 기다리는 시간
pub const TTL_MS: u64 = 5 * 60_000;
/// 허용한 뒤 요청한 기기가 열쇠를 받아 가야 하는 시간
pub const PICKUP_MS: u64 = 60_000;
/// 요청 상한 창 — 이 안에 PER_WINDOW 번(기기 가리지 않고)
pub const WINDOW_MS: u64 = 10 * 60_000;
pub const PER_WINDOW: usize = 5;
/// 한꺼번에 허용을 기다리는 카드
pub const MAX_WAITING: usize = 3;

/// 받는 쪽이 자기 테일넷에서 찾은 요청 기기 — 이름·OS·테일넷 이름은 요청이 아니라 이 기기 tailscale 이 말한 것
#[derive(Debug, Clone, PartialEq)]
pub struct LinkPeer {
    pub id: String,
    pub name: String,
    pub os: String,
    pub ip: Ipv4Addr,
    pub tailnet: String,
}

#[derive(Debug, PartialEq)]
pub enum AskErr {
    Bad,
    TooMany,
    /// 같은 계정·태그 없는 기기가 아니다(공유받은 남의 노드·태그 노드·모르는 노드)
    NotMine,
    /// 되물었더니 그 기기가 그런 요청을 모른다
    Unconfirmed,
    /// 이 기기는 아직 받는 쪽이 못 된다(키체인이 맥 전용)
    Unsupported,
    Card(String),
}

/// 받는 쪽 바깥(테일넷·되묻기·카드 기록·열쇠 저장) — 시험에선 가짜
pub trait LinkEnv {
    fn supported(&self) -> bool;
    fn lookup(&self, node: &str) -> Option<LinkPeer>;
    /// 그 기기에 /api/link-check?h=<sha256(req)> — 그 req 로 요청 중이면 true
    fn confirm(&self, peer: &LinkPeer, hash: &str) -> bool;
    /// 결정 대기함 카드 → 카드 id
    fn card(&self, peer: &LinkPeer, until_ms: u64) -> Result<String, String>;
    fn close_card(&self, card: &str, done: bool, note: &str);
    /// 열쇠 둘을 만들어 이 기기에 걸고 (그 기기가 이 기기에 쓸 열쇠, 이 기기가 그 기기에 쓸 열쇠)
    fn commit(&self, peer: &LinkPeer) -> Result<(String, String), String>;
}

/// 받는 쪽이 못 되는 곳(시험 기본·윈도우 — 키체인이 맥 전용)
pub struct NoLink;

impl LinkEnv for NoLink {
    fn supported(&self) -> bool {
        false
    }
    fn lookup(&self, _: &str) -> Option<LinkPeer> {
        None
    }
    fn confirm(&self, _: &LinkPeer, _: &str) -> bool {
        false
    }
    fn card(&self, _: &LinkPeer, _: u64) -> Result<String, String> {
        Err("unsupported".into())
    }
    fn close_card(&self, _: &str, _: bool, _: &str) {}
    fn commit(&self, _: &LinkPeer) -> Result<(String, String), String> {
        Err("unsupported".into())
    }
}

#[derive(Debug, PartialEq)]
pub enum Status {
    Unknown,
    Wait,
    No,
    Expired,
    Yes { token: String, back: String },
    Failed(String),
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Pick {
    Wait,
    Yes,
    No,
}

struct Incoming {
    card: String,
    hash: String,
    peer: LinkPeer,
    at: u64,
    pick: Pick,
    decided: u64,
}

impl Incoming {
    fn dead(&self, now: u64) -> bool {
        match self.pick {
            Pick::Wait => now > self.at + TTL_MS,
            _ => now > self.decided + PICKUP_MS,
        }
    }
}

struct Outgoing {
    hash: String,
    node: String,
    at: u64,
}

#[derive(Default)]
struct Inner {
    incoming: Vec<Incoming>,
    times: Vec<u64>,
    outgoing: Vec<Outgoing>,
}

/// 메모리에만 — 앱이 다시 켜지면 기다리던 요청은 모두 없던 일(아무것도 안 생김)
#[derive(Default)]
pub struct Asks(Mutex<Inner>);

pub fn hex_sha(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn valid_req(r: &str) -> bool {
    r.len() == 32 && r.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn valid_node(n: &str) -> bool {
    !n.is_empty() && n.len() <= 64 && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// 끝난 요청 치우기 — 기다리던 카드는 '시간이 지났어요'로 닫는다
fn sweep(g: &mut Inner, env: &dyn LinkEnv, now: u64) {
    g.incoming.retain(|i| {
        if !i.dead(now) {
            return true;
        }
        match i.pick {
            Pick::Wait => env.close_card(&i.card, false, "시간이 지났어요"),
            Pick::Yes => env.close_card(&i.card, false, "그 기기가 받아 가지 않았어요"),
            Pick::No => {}
        }
        false
    });
    g.outgoing.retain(|o| now.saturating_sub(o.at) <= TTL_MS + PICKUP_MS);
}

impl Asks {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ── 받는 쪽 ──

    /// /api/link-request — 되묻기(망)는 자물쇠 밖에서
    pub fn request(&self, env: &dyn LinkEnv, req: &str, node: &str, now: u64) -> Result<(), AskErr> {
        if !valid_req(req) || !valid_node(node) {
            return Err(AskErr::Bad);
        }
        if !env.supported() {
            return Err(AskErr::Unsupported);
        }
        {
            let mut g = self.lock();
            sweep(&mut g, env, now);
            g.times.retain(|t| now.saturating_sub(*t) < WINDOW_MS);
            if g.times.len() >= PER_WINDOW {
                return Err(AskErr::TooMany);
            }
            g.times.push(now);
        }
        let peer = env.lookup(node).ok_or(AskErr::NotMine)?;
        let hash = hex_sha(req);
        if !env.confirm(&peer, &hash) {
            return Err(AskErr::Unconfirmed);
        }
        let mut g = self.lock();
        if let Some(i) = g.incoming.iter().position(|i| i.peer.id == node && i.pick == Pick::Wait) {
            let old = g.incoming.remove(i);
            env.close_card(&old.card, false, "새 요청으로 바뀌었어요");
        }
        if g.incoming.iter().filter(|i| i.pick == Pick::Wait).count() >= MAX_WAITING {
            return Err(AskErr::TooMany);
        }
        let card = env.card(&peer, now + TTL_MS).map_err(AskErr::Card)?;
        g.incoming.push(Incoming { card, hash, peer, at: now, pick: Pick::Wait, decided: 0 });
        Ok(())
    }

    /// 카드 답 — 사람 길(direct::answer)만 부른다
    pub fn decide(&self, card: &str, yes: bool, now: u64) -> Result<(), String> {
        let mut g = self.lock();
        // 치우기는 안 한다 — 시간이 지난 요청도 받아 갈 때(status) '시간 지남'으로 알려야 해서
        let i = g.incoming.iter_mut().find(|i| i.card == card && i.pick == Pick::Wait && !i.dead(now)).ok_or("이 연결 요청은 끝났어요(시간이 지났거나 이미 답했어요)")?;
        i.pick = if yes { Pick::Yes } else { Pick::No };
        i.decided = now;
        Ok(())
    }

    /// /api/link-status — 허용이면 이때 열쇠를 만들어 한 번만 내준다
    pub fn status(&self, env: &dyn LinkEnv, req: &str, now: u64) -> Status {
        if !valid_req(req) {
            return Status::Unknown;
        }
        let h = hex_sha(req);
        let mut g = self.lock();
        let mut at = None;
        for (n, i) in g.incoming.iter().enumerate() {
            if ct_eq(h.as_bytes(), i.hash.as_bytes()) {
                at = Some(n);
            }
        }
        let Some(n) = at else {
            sweep(&mut g, env, now);
            return Status::Unknown;
        };
        if g.incoming[n].dead(now) {
            sweep(&mut g, env, now);
            return Status::Expired;
        }
        let out = match g.incoming[n].pick {
            Pick::Wait => return Status::Wait,
            Pick::No => Status::No,
            Pick::Yes => {
                let i = &g.incoming[n];
                match env.commit(&i.peer) {
                    Ok((token, back)) => {
                        env.close_card(&i.card, true, "연결됨");
                        Status::Yes { token, back }
                    }
                    Err(e) => {
                        env.close_card(&i.card, false, "연결하다 실패했어요");
                        Status::Failed(e)
                    }
                }
            }
        };
        g.incoming.remove(n);
        sweep(&mut g, env, now);
        out
    }

    // ── 요청하는 쪽 ──

    /// 새 요청 번호 — 같은 기기에 낸 옛 요청은 죽는다
    pub fn start(&self, node: &str, now: u64) -> Result<String, String> {
        let req = crate::mobile_pair::random_hex(16).map_err(|e| e.to_string())?;
        let mut g = self.lock();
        g.outgoing.retain(|o| o.node != node && now.saturating_sub(o.at) <= TTL_MS + PICKUP_MS);
        g.outgoing.push(Outgoing { hash: hex_sha(&req), node: node.to_string(), at: now });
        Ok(req)
    }

    /// /api/link-check — 그 해시로 지금 요청 중인가
    pub fn asking(&self, hash: &str, now: u64) -> bool {
        let g = self.lock();
        let mut hit = false;
        for o in &g.outgoing {
            if ct_eq(hash.as_bytes(), o.hash.as_bytes()) && now.saturating_sub(o.at) <= TTL_MS + PICKUP_MS {
                hit = true;
            }
        }
        hit
    }

    /// 아직 기다리나(취소·새 요청이면 false)
    pub fn waiting(&self, req: &str, now: u64) -> bool {
        self.asking(&hex_sha(req), now)
    }

    pub fn end(&self, req: &str) {
        let h = hex_sha(req);
        self.lock().outgoing.retain(|o| o.hash != h);
    }

    /// 그 기기에 낸 요청 거두기(화면 '취소')
    pub fn cancel_node(&self, node: &str) {
        self.lock().outgoing.retain(|o| o.node != node);
    }
}

pub fn asks() -> &'static Asks {
    static A: std::sync::OnceLock<Asks> = std::sync::OnceLock::new();
    A.get_or_init(Asks::default)
}

#[cfg(test)]
#[path = "peer_ask_tests.rs"]
mod tests;
