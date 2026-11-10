//! 다른 기기 참모 짝을 Chammo 계정에 묶는다(11-09 보안 — 테일스케일로 짝지은 PC 가 Chammo 를 로그아웃하고 다른 계정으로 로그인했는데도
//! 이 맥의 결정 카드·결제 카드가 그 PC 에 계속 떴고 거기서 답할 수도 있었다. 짝짓기가 테일스케일 계정만 보고 Chammo 계정은 안 봤다).
//!
//! - 짝마다 상대의 **Chammo 기기 id**(중계 서버 기기 id)를 묶는다. 테일넷 짝은 짝지을 때 증명(아래 Bind)으로, 중계 짝은 허브 id 그대로
//! - 부를 때·받을 때마다 중계 서버 `/v0/me/self` 의 **내 계정 허용 컴퓨터 목록**에 그 기기 id 가 있는지 본다 — 상대가 말하는 값이 아니라
//!   서버가 말하는 값이라, 로그아웃(서버가 그 기기를 끊음)·다른 계정 로그인(새 기기 id)이면 상대 앱이 옛 판이어도·거짓말해도 멈춘다
//! - 묶인 기기 id 가 없는 옛 짝(10월 테일넷 짝)·내가 로그아웃함·서버를 못 물음(10분 넘게) → 멈춤. 다시 짝지으면(사람이 카드 허용) 다시 된다
//! - 결제(pay)·운영(ops) 카드는 1분 안에 서버로 다시 확인한 것(fresh)만 — 묵은 목록으로는 안 보낸다(이중 안전)
use crate::mobile_http::ct_eq;
use crate::phone_tunnel as tun;
use sha2::Sha256;

/// 서버 목록을 이만큼만 믿고 다시 묻는다 — 결제·운영 카드는 이 안의 것만
pub const FRESH_MS: u64 = 60_000;
/// 서버를 못 물을 때 묵은 목록을 쓰는 끝 — 넘으면 '확인 못 함'으로 멈춘다
pub const GRACE_MS: u64 = 10 * 60_000;
/// 서버 묻기가 실패하면 이만큼 쉬었다 다시(요청마다 망을 붙잡지 않게)
const RETRY_MS: u64 = 15_000;

/// 짝 하나를 지금 써도 되나
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// 같은 계정 — fresh = 1분 안에 서버로 확인함(결제·운영 카드는 이것만)
    Same { fresh: bool },
    /// 계정이 묶이지 않은 옛 짝(다시 짝짓기)
    Unbound,
    /// 상대가 내 계정의 허용 컴퓨터가 아니다(로그아웃·다른 계정·끊김)
    Other,
    /// 내가 Chammo 에 로그인 안 함(허용 대기·끊김 포함)
    NoLogin,
    /// 서버를 못 물었다(10분 넘게)
    Unknown,
}

impl Verdict {
    pub fn ok(self) -> bool {
        matches!(self, Verdict::Same { .. })
    }
    /// 결제·운영 카드 — 1분 안에 서버로 확인한 같은 계정만
    pub fn strict(self) -> bool {
        self == Verdict::Same { fresh: true }
    }
    /// 오류 글·화면이 읽는 이름 — "account:<이것>"
    pub fn code(self) -> &'static str {
        match self {
            Verdict::Same { .. } => "same",
            Verdict::Unbound => "unbound",
            Verdict::Other => "other",
            Verdict::NoLogin => "nologin",
            Verdict::Unknown => "unknown",
        }
    }
    /// 망으로 오가는 오류 글(403 몸통·부른 쪽 Err) — "account:other" 처럼
    pub fn err(self) -> String {
        format!("{PREFIX}{}", self.code())
    }
}

/// 계정 때문에 멈춘 짝의 오류 글 머리
pub const PREFIX: &str = "account:";

/// 화면 한 줄(앱·scripts/peer)
pub fn word(code: &str) -> &'static str {
    match code {
        "nologin" => "이 기기가 Chammo 에 로그인하지 않아 연결이 멈췄어요 — 로그인한 뒤 다시 짝짓기",
        "unknown" => "Chammo 계정을 확인하지 못해 연결이 멈췄어요 — 인터넷을 확인하고 다시 짝짓기",
        _ => "계정이 바뀌어 연결이 멈췄어요 — 다시 짝짓기",
    }
}

/// 오류 글이 계정 멈춤인가 → 그 이름
pub fn paused(e: &str) -> Option<&str> {
    e.trim().strip_prefix(PREFIX).map(|c| c.split_whitespace().next().unwrap_or(""))
}

/// 중계 기기 id 모양 — 서버가 짓는 id(영문·숫자·-·_)
pub fn valid_dev(d: &str) -> bool {
    !d.is_empty() && d.len() <= 64 && d.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// 이 기기의 Chammo 계정·기기 id
#[derive(Debug, Clone, PartialEq)]
pub struct Mine {
    pub account: String,
    pub device: String,
}

/// team.json → 로그인해 허용된 기기만(허용 대기·서버가 끊은 기기·초대 코드만 쓴 옛 기기는 None)
pub fn mine_of(st: &crate::team_relay::TeamState) -> Option<Mine> {
    let a = st.account.as_ref().filter(|a| !a.id.is_empty())?;
    (st.registered() && !st.pending && !st.revoked && valid_dev(&st.device_id)).then(|| Mine { account: a.id.clone(), device: st.device_id.clone() })
}

/// 서버가 말한 내 계정 허용 컴퓨터(나 빼고) — (기기 id, 터널 공개 열쇠 b64)
#[derive(Debug, Clone, PartialEq)]
pub struct Seen {
    /// 물을 때의 나 — 계정이 바뀌면 이 목록은 버린다
    pub mine: Mine,
    pub at_ms: u64,
    pub computers: Vec<(String, String)>,
    /// 내 계정 허용 폰(중계 기기 id, /v0/me/devices kind phone·status approved) — 폰 줄 확인용(11-09 2차)
    pub phones: Vec<String>,
}

/// 판정(망 없음) — bound = 그 짝에 묶인 상대 기기 id
pub fn judge(bound: Option<&str>, mine: Option<&Mine>, seen: Option<&Seen>, now: u64) -> Verdict {
    let Some(m) = mine else { return Verdict::NoLogin };
    let Some(b) = bound.filter(|b| valid_dev(b)) else { return Verdict::Unbound };
    // 내 기기 id 를 대는 짝은 있을 수 없다
    if b == m.device {
        return Verdict::Other;
    }
    let Some(s) = seen.filter(|s| &s.mine == m) else { return Verdict::Unknown };
    let age = now.saturating_sub(s.at_ms);
    if age > GRACE_MS {
        return Verdict::Unknown;
    }
    if s.computers.iter().any(|(id, _)| id == b) {
        Verdict::Same { fresh: age <= FRESH_MS }
    } else {
        Verdict::Other
    }
}

/// 폰 줄 판정(망 없음) — relay = 그 폰 줄의 중계 기기 id. 직통 줄(테일넷·같은 와이파이 QR, 컴퓨터 브라우저로 연 줄 포함)은 계정을 확인할 길이 없어 Unbound
pub fn judge_phone(relay: Option<&str>, mine: Option<&Mine>, seen: Option<&Seen>, now: u64) -> Verdict {
    let Some(r) = relay.filter(|r| valid_dev(r)) else { return Verdict::Unbound };
    let Some(m) = mine else { return Verdict::NoLogin };
    let Some(s) = seen.filter(|s| &s.mine == m) else { return Verdict::Unknown };
    let age = now.saturating_sub(s.at_ms);
    if age > GRACE_MS {
        return Verdict::Unknown;
    }
    if s.phones.iter().any(|p| p == r) {
        Verdict::Same { fresh: age <= FRESH_MS }
    } else {
        Verdict::Other
    }
}

/// /v0/me/devices 응답 → 허용된 폰 id(끊긴 기기는 서버가 안 준다)
pub fn phones_of(v: &serde_json::Value) -> Vec<String> {
    v["devices"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|d| d["kind"] == "phone" && d["status"] == "approved")
                .filter_map(|d| d["id"].as_str().filter(|i| valid_dev(i)).map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// /v0/me/self 응답 → 컴퓨터 목록(모양이 틀린 줄은 뺀다). 허용 대기 기기는 서버가 빈 목록을 준다
pub fn computers_of(v: &serde_json::Value) -> Vec<(String, String)> {
    v["computers"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|c| Some((c["id"].as_str().filter(|d| valid_dev(d))?.to_string(), c["tunnelPub"].as_str().unwrap_or("").to_string())))
                .collect()
        })
        .unwrap_or_default()
}

// ── 짝지을 때 증명(테일넷 짝) — 상대가 "나는 기기 D" 라고만 하면 내 다른 컴퓨터 id 를 댈 수 있다.
//    D 의 터널 열쇠(서버가 준 것)와 내 터널 열쇠의 합의값으로 맥을 만들어, D 의 비밀 열쇠를 가진 쪽만 증명할 수 있게 한다.
//    ctx = 그 짝짓기의 비밀(요청 번호·연결 코드) — 다른 짝짓기에 재생 못 하게

/// 요청하는 쪽이 싣는 것
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Bind {
    pub device: String,
    pub proof: String,
}

fn mac(shared: &[u8; 32], role: &str, from: &str, to: &str, ctx: &str) -> String {
    let h = hkdf::Hkdf::<Sha256>::new(Some(b"chammo-peer-bind/1"), shared);
    let mut out = [0u8; 32];
    h.expand(format!("{role}|{from}|{to}|{ctx}").as_bytes(), &mut out).expect("32");
    out.iter().map(|b| format!("{b:02x}")).collect()
}

/// 열쇠 합의(시험은 가짜)
pub type Agree<'a> = dyn Fn(&[u8]) -> Option<[u8; 32]> + 'a;

fn shared_with(computers: &[(String, String)], dev: &str, agree: &Agree) -> Result<[u8; 32], Verdict> {
    let x = computers.iter().find(|(id, _)| id == dev).map(|(_, x)| x.as_str()).ok_or(Verdict::Other)?;
    let pk = tun::pubkey(x).map_err(|_| Verdict::Other)?;
    agree(&pk).ok_or(Verdict::Other)
}

fn ctx_ok(ctx: &str) -> bool {
    ctx.len() >= 32 && ctx.len() <= 128 && ctx.bytes().all(|b| b.is_ascii_hexdigit())
}

/// 요청하는 쪽 — 상대(target)가 내 계정 허용 컴퓨터일 때만 증명을 만든다
pub fn make(me: &Mine, target: &str, ctx: &str, computers: &[(String, String)], agree: &Agree) -> Result<Bind, Verdict> {
    if !valid_dev(target) || target == me.device || !ctx_ok(ctx) {
        return Err(Verdict::Other);
    }
    let s = shared_with(computers, target, agree)?;
    Ok(Bind { device: me.device.clone(), proof: mac(&s, "req", &me.device, target, ctx) })
}

/// 받는 쪽 — 그 기기가 내 계정 허용 컴퓨터이고 증명이 맞으면 답 증명(요청한 쪽이 이 기기를 확인)
pub fn verify(me: &Mine, b: &Bind, ctx: &str, computers: &[(String, String)], agree: &Agree) -> Result<String, Verdict> {
    if !valid_dev(&b.device) || b.device == me.device || !ctx_ok(ctx) || b.proof.len() != 64 {
        return Err(Verdict::Other);
    }
    let s = shared_with(computers, &b.device, agree)?;
    if !ct_eq(mac(&s, "req", &b.device, &me.device, ctx).as_bytes(), b.proof.to_ascii_lowercase().as_bytes()) {
        return Err(Verdict::Other);
    }
    Ok(mac(&s, "resp", &me.device, &b.device, ctx))
}

/// 요청한 쪽 — 받는 쪽 답 증명 확인(target 이 정말 그 열쇠를 가진 기기인가)
pub fn check_reply(me: &Mine, target: &str, ctx: &str, proof: &str, computers: &[(String, String)], agree: &Agree) -> bool {
    shared_with(computers, target, agree).is_ok_and(|s| proof.len() == 64 && ct_eq(mac(&s, "resp", target, &me.device, ctx).as_bytes(), proof.to_ascii_lowercase().as_bytes()))
}

// ── 요청마다 '그 기기 열쇠를 지금도 가졌다' 증명(테일넷 짝) — 서버 목록에 옛 기기 id 가 '허용'으로 남아도(상대가 서버 로그아웃 없이
//    데이터만 지우고·다시 깔고 다른 계정으로 로그인) 그 기기 열쇠가 없으면 못 만든다(11-09 공격 리뷰 1). 중계 짝은 허브가 기기 서명으로 같은 일을 한다

/// 머리 이름(소문자) — 값 = "<ts_ms>.<맥 16진 64>"
pub const LIVE_HEADER: &str = "x-chammo-live";
/// 시계 차이·재생 허용 폭
pub const LIVE_SKEW_MS: u64 = 120_000;

fn path_only(p: &str) -> &str {
    p.split('?').next().unwrap_or(p)
}

/// 부르는 쪽 머리 값(from = 나, to = 상대)
pub fn live_make(shared: &[u8; 32], from: &str, to: &str, ts: u64, method: &str, path: &str) -> String {
    format!("{ts}.{}", mac(shared, "live", from, to, &format!("{ts}|{method}|{}", path_only(path))))
}

/// 받는 쪽 확인(from = 짝에 묶인 상대, to = 나)
pub fn live_ok(shared: &[u8; 32], from: &str, to: &str, header: &str, method: &str, path: &str, now: u64) -> bool {
    let Some((ts, m)) = header.trim().split_once('.') else { return false };
    let Ok(ts) = ts.parse::<u64>() else { return false };
    if now.abs_diff(ts) > LIVE_SKEW_MS || m.len() != 64 {
        return false;
    }
    ct_eq(mac(shared, "live", from, to, &format!("{ts}|{method}|{}", path_only(path))).as_bytes(), m.to_ascii_lowercase().as_bytes())
}

// ── 앱에 붙이는 길(team.json·키체인·중계 서버) ─────────────────────────────

struct Cache {
    seen: Option<Seen>,
    tried_ms: u64,
    /// '다름' 판정으로 다시 물은 때 — 방금 허용된 컴퓨터가 묵은 목록에 막히지 않게 다시 묻되, 다른 계정 기기가 4초마다 두드려도 서버를 30초에 한 번만
    recheck_ms: u64,
}

/// '다름'이면 이만큼에 한 번까지 서버에 다시 묻는다
const RECHECK_MS: u64 = 30_000;
/// 짝지을 때·결제 카드처럼 새로 물어야 할 때도 이 간격 안이면 받아 둔 것 — 남이 아무 증명이나 연타해 중계 몫(배경 200/10분)을 태우지 못하게(공격 리뷰 2)
const FORCE_GAP_MS: u64 = 15_000;

/// (내 기기 id, 상대 터널 공개 열쇠) → 합의값 — 요청마다 키체인을 안 읽게
static SHARED: std::sync::Mutex<Option<std::collections::HashMap<(String, String), [u8; 32]>>> = std::sync::Mutex::new(None);

static CACHE: std::sync::Mutex<Cache> = std::sync::Mutex::new(Cache { seen: None, tried_ms: 0, recheck_ms: 0 });

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn state() -> crate::team_relay::TeamState {
    crate::team_relay::load_state(crate::config::data_dir())
}

/// 이 기기 Chammo 기기 id — 로그인해 허용된 기기만(/api/hello 가 싣는다. 비밀 아님 — 서버 요청은 열쇠 서명이 있어야 된다)
pub fn my_device() -> Option<String> {
    mine_of(&state()).map(|m| m.device)
}

/// (컴퓨터, 폰) — 둘 다 받아야 적는다
fn fetch(st: &crate::team_relay::TeamState) -> Result<(Vec<(String, String)>, Vec<String>), String> {
    let k = crate::team_relay::device_keys(&crate::team_relay_keys::store(), st)?;
    let get = |path: &str| -> Result<serde_json::Value, String> {
        let (code, v) = crate::team_relay::call(&crate::team_relay::Curl, &st.server, &k, Some(&st.device_id), "GET", path, None)?;
        if code != 200 {
            return Err(crate::team_relay::why(code, &v));
        }
        Ok(v)
    };
    Ok((computers_of(&get("/v0/me/self")?), phones_of(&get("/v0/me/devices")?)))
}

/// 지금 나 + 서버 목록 — 1분 넘게 묵었으면 다시 묻는다(force = 1분 안 것도 다시, 짝지을 때). 실패는 15초에 한 번만 다시
fn current(force: bool) -> (Option<Mine>, Option<Seen>) {
    let st = state();
    let Some(me) = mine_of(&st) else { return (None, None) };
    let now = now_ms();
    {
        let mut g = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        let good = g.seen.as_ref().filter(|s| s.mine == me);
        let fresh = good.is_some_and(|s| now.saturating_sub(s.at_ms) <= if force { FORCE_GAP_MS } else { FRESH_MS });
        // 실패 뒤 쉬기·새로 묻기 간격은 force 여도 지킨다 — 한 번에 하나만 묻는다(먼저 표시해 두고 망으로)
        let gap = if force { FORCE_GAP_MS } else { RETRY_MS };
        if fresh || now.saturating_sub(g.tried_ms) < gap {
            return (Some(me), good.cloned());
        }
        g.tried_ms = now;
    }
    let got = fetch(&st);
    let mut g = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    match got {
        // 물은 때(시작)로 적는다 — 늦게 끝난 옛 물음이 그 뒤 물음 결과를 덮지 않게(공격 리뷰 3)
        Ok((computers, phones)) if g.seen.as_ref().is_none_or(|s| s.mine != me || s.at_ms <= now) => g.seen = Some(Seen { mine: me.clone(), at_ms: now, computers, phones }),
        Ok(_) => {}
        Err(e) => crate::claude::log_out("peer", &format!("계정 확인(중계 /v0/me/self) 실패 — {e}")),
    }
    let s = g.seen.clone().filter(|s| s.mine == me);
    (Some(me), s)
}

/// 이 짝을 지금 써도 되나 — strict 면 1분 안에 서버로 확인한 것만 Same{fresh}
pub fn check(bound: Option<&str>, strict: bool) -> Verdict {
    // 묶인 게 없으면 망을 부를 것도 없다
    if bound.is_none_or(|b| !valid_dev(b)) {
        return judge(None, mine_of(&state()).as_ref(), None, 0);
    }
    let (me, seen) = current(false);
    let v = judge(bound, me.as_ref(), seen.as_ref(), now_ms());
    if v == Verdict::Other {
        let again = {
            let mut g = CACHE.lock().unwrap_or_else(|e| e.into_inner());
            let n = now_ms();
            let go = n.saturating_sub(g.recheck_ms) >= RECHECK_MS;
            if go {
                g.recheck_ms = n;
            }
            go
        };
        if again {
            let (me, seen) = current(true);
            return judge(bound, me.as_ref(), seen.as_ref(), now_ms());
        }
        return v;
    }
    if strict && v == (Verdict::Same { fresh: false }) {
        let (me, seen) = current(true);
        return judge(bound, me.as_ref(), seen.as_ref(), now_ms());
    }
    v
}

/// 폰 줄을 지금 믿어도 되나(결제·운영·발송·삭제 카드) — strict 면 1분 안 확인만. 직통 줄은 망을 안 부르고 Unbound
pub fn check_phone(relay: Option<&str>, strict: bool) -> Verdict {
    if relay.is_none_or(|r| !valid_dev(r)) {
        return Verdict::Unbound;
    }
    let judge_now = |force: bool| {
        let (me, seen) = current(force);
        judge_phone(relay, me.as_ref(), seen.as_ref(), now_ms())
    };
    let v = judge_now(false);
    // 방금 허용된 폰이 묵은 목록에 막히지 않게 · 결제류는 새로 — 서버 묻기 간격(FORCE_GAP_MS)은 current 가 지킨다
    if v == Verdict::Other || (strict && v == (Verdict::Same { fresh: false })) {
        return judge_now(true);
    }
    v
}

fn agree_now(st: &crate::team_relay::TeamState) -> Result<impl Fn(&[u8]) -> Option<[u8; 32]>, String> {
    let k = crate::team_relay::device_keys(&crate::team_relay_keys::store(), st)?;
    Ok(move |x: &[u8]| k.tunnel_agree(x))
}

/// 합의값(받아 둔 것 또는 키체인에서 한 번) — 상대 터널 공개 열쇠 b64
fn shared_now(me: &Mine, their_pub: &str) -> Option<[u8; 32]> {
    let key = (me.device.clone(), their_pub.to_string());
    if let Some(s) = SHARED.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(&key).copied()) {
        return Some(s);
    }
    let pk = tun::pubkey(their_pub).ok()?;
    let st = state();
    if mine_of(&st).as_ref() != Some(me) {
        return None;
    }
    let k = crate::team_relay::device_keys(&crate::team_relay_keys::store(), &st).ok()?;
    let s = k.tunnel_agree(&pk)?;
    SHARED.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(Default::default).insert(key, s);
    Some(s)
}

/// 부르는 쪽 — 그 짝(target = 묶인 상대 Chammo 기기 id)에 보낼 보유 증명. 시험은 없음(진짜 키체인·team.json 을 안 읽는다)
pub fn live_now(target: &str, method: &str, path: &str) -> Option<String> {
    if cfg!(test) {
        return None;
    }
    let (Some(me), Some(seen)) = current(false) else { return None };
    let x = seen.computers.iter().find(|(id, _)| id == target).map(|(_, x)| x.clone())?;
    let s = shared_now(&me, &x)?;
    Some(live_make(&s, &me.device, target, now_ms(), method, path))
}

/// 받는 쪽 — 짝에 묶인 상대(bound)가 보낸 보유 증명이 맞나
pub fn live_check(bound: &str, header: &str, method: &str, path: &str) -> bool {
    let (Some(me), Some(seen)) = current(false) else { return false };
    let Some(x) = seen.computers.iter().find(|(id, _)| id == bound).map(|(_, x)| x.clone()) else { return false };
    shared_now(&me, &x).is_some_and(|s| live_ok(&s, bound, &me.device, header, method, path, now_ms()))
}

/// 요청하는 쪽 증명 — 서버 목록을 새로 받아서
pub fn bind_now(target: &str, ctx: &str) -> Result<Bind, Verdict> {
    let st = state();
    let (me, seen) = current(true);
    let me = me.ok_or(Verdict::NoLogin)?;
    let seen = seen.filter(|s| now_ms().saturating_sub(s.at_ms) <= FRESH_MS).ok_or(Verdict::Unknown)?;
    let agree = agree_now(&st).map_err(|_| Verdict::NoLogin)?;
    make(&me, target, ctx, &seen.computers, &agree)
}

/// 받는 쪽 확인 → 답 증명
pub fn verify_now(b: &Bind, ctx: &str) -> Result<String, Verdict> {
    let st = state();
    let (me, seen) = current(true);
    let me = me.ok_or(Verdict::NoLogin)?;
    let seen = seen.filter(|s| now_ms().saturating_sub(s.at_ms) <= FRESH_MS).ok_or(Verdict::Unknown)?;
    let agree = agree_now(&st).map_err(|_| Verdict::NoLogin)?;
    verify(&me, b, ctx, &seen.computers, &agree)
}

/// 요청한 쪽 — 받는 쪽 답 증명 확인
pub fn check_reply_now(target: &str, ctx: &str, proof: &str) -> bool {
    let st = state();
    let (Some(me), Some(seen)) = current(false) else { return false };
    agree_now(&st).is_ok_and(|agree| check_reply(&me, target, ctx, proof, &seen.computers, &agree))
}

/// 짝지을 때 쓰는 것 — 시험은 가짜(remote::pair·connect 가 받는다)
pub trait Binder {
    /// 요청하는 쪽 증명(target = 상대 Chammo 기기 id, ctx = 연결 코드·요청 번호)
    fn bind(&self, target: &str, ctx: &str) -> Result<Bind, Verdict>;
    /// 받는 쪽 답 증명 확인
    fn check_reply(&self, target: &str, ctx: &str, proof: &str) -> bool;
}

pub struct RealBinder;

impl Binder for RealBinder {
    fn bind(&self, target: &str, ctx: &str) -> Result<Bind, Verdict> {
        bind_now(target, ctx)
    }
    fn check_reply(&self, target: &str, ctx: &str, proof: &str) -> bool {
        check_reply_now(target, ctx, proof)
    }
}

/// 짝지을 때 실패 이유(사람이 읽는)
pub fn bind_word(v: Verdict) -> &'static str {
    match v {
        Verdict::NoLogin => "이 기기가 Chammo 에 로그인해야 다른 기기와 이어져요",
        Verdict::Unknown => "Chammo 계정을 확인하지 못했어요 — 인터넷을 확인하고 다시 해 주세요",
        _ => "그 기기는 이 기기와 같은 Chammo 계정의 컴퓨터가 아니에요 — 같은 계정으로 로그인한 뒤 다시 해 주세요",
    }
}

/// 로그아웃 — 목록을 버린다(다음 판정은 NoLogin)
pub fn forget() {
    let mut g = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    g.seen = None;
    g.tried_ms = 0;
    g.recheck_ms = 0;
    drop(g);
    *SHARED.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

#[cfg(test)]
#[path = "peer_account_tests.rs"]
mod tests;
