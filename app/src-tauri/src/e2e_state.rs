//! 종단 암호를 실제 보내기·받기에 붙이는 곳 — chammo-relay ADR 0007, 계획 2026-10-24 e2e-multiteam §2.4~2.7.
//! - 믿음 저장 `<데이터>/e2e.json`(600): 계정마다 처음 본 사슬의 신원·본 머리(핀)와 상태(ok·changed·forked), 사슬·명부 캐시
//! - 보내기(wrap): 봉투만(ADR 0007 R8 암호 전용). 내 사슬 확인 전·사슬 밖, 명부 없음·내 자리 없음, 상대 사슬 없음이면 Err — 평문으로 내려가지 않는다
//!   상대 보안 번호가 바뀌었거나(changed) 사슬이 갈렸으면(forked) 사람이 받아들이기 전엔 Err — 참모 자동 발송이 바뀐 열쇠로 새지 않게
//! - 받기(unwrap): 봉투면 보낸 사람 계정 사슬로 서명을 보고 이 기기 몫을 연다. 사람 말은 바깥(서버)·안쪽이 둘 다 human 일 때만
//! - 받아들이기(accept)는 사람 손 길에서만 부른다(화면 명령) — scripts/team·참모 길엔 없다
use crate::accounts_store::Store;
use crate::e2e_chain::{self, extends, Chain, Link};
use crate::e2e_envelope::{self, Extra, Inner, Meta, Recipient};
use crate::e2e_roster::{self, Roster, TLink};
use crate::team_relay::{self as relay, Http, TeamState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Mutex;

pub const FILE: &str = "e2e.json";

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Pin {
    /// 처음 믿은(또는 사람이 받아들인) 신원
    pub identity: String,
    /// 마지막으로 본 머리
    pub seq: u64,
    pub hash: String,
    /// ok | changed(신원이 바뀜) | forked(전에 본 머리를 잇지 않음)
    pub state: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct E2eStore {
    pub pins: BTreeMap<String, Pin>,
    pub chains: BTreeMap<String, Vec<Link>>,
    pub rosters: BTreeMap<String, Vec<TLink>>,
    /// 이 기기가 허용을 기다릴 때 봉해 둔 nP(base64url) — nM 을 받은 뒤에만 연다
    pub my_np: String,
    /// 이 기기(사슬 기기)가 연 허용 카드마다 낸 nM — 서버가 준 값이 아니라 이걸로 숫자를 셈한다
    pub card_nm: BTreeMap<String, String>,
    /// 카드를 열 때(nM 을 내기 전) 본 새 기기 봉인·열쇠 — 나중에 서버가 바꿔 보여 주면 거절(리뷰 B 치명 1: nM 을 본 뒤 갈아 맞추기)
    pub card_seen: BTreeMap<String, CardSeen>,
    /// 새 기기 쪽 — nP 를 처음 보낸 그 nM(보내기 전에 적는다, R4). 다른 nM 으로는 열지도 셈하지도 않는다
    pub my_nm: String,
    /// 그 nM 으로 nP 를 보내 서버가 받았나(200·409 revealed) — 못 받았으면 같은 nM 으로만 다시 보낸다
    pub my_revealed: bool,
    /// 팀 명부 핀(identity = 첫 고리 해시, seq·hash = 본 머리) — 되감기·갈림을 잡는다(리뷰 B 치명 3)
    pub roster_pins: BTreeMap<String, Pin>,
    /// 받은 봉투(보낸 기기|cid → 봉투 안 at) — 옛 봉투를 새 seq 로 다시 넣는 것 거르기(리뷰 B 중간 6).
    /// SEEN_KEEP 보다 오래된 줄은 버리고, 그보다 오래된 봉투는 아예 안 받는다(버린 뒤 다시 넣기 막기)
    pub seen_at: BTreeMap<String, u64>,
    /// 서버가 내 계정에 사슬이 없다고 했다(ensure 가 적는다) — 로그인 화면이 '첫 기기로 시작'을 묻는다(R8)
    pub no_chain: bool,
    /// 사슬 밖인데 안 끊긴 사슬 기기가 하나도 없다(ensure 가 적는다) — 로그인 화면이 '이 기기로 다시 시작'을 묻는다(계정 되찾기 갈래 ①)
    pub need_reset: bool,
    /// 24시간 auto 기기인데 사슬 기기가 하나도 없다(ensure 가 적는다) — 로그인 화면이 '다시 로그인'을 묻는다(10-26)
    pub relogin: bool,
    /// 허용은 됐는데 사슬 밖 — 살아 있는 사슬 기기에서 숫자로 확인받아야 메시지를 읽는다(ensure 가 적는다, 10-26 어디서든 허용)
    pub outside: bool,
    /// ensure 가 한 번이라도 끝났다 — 그 전엔 로그인 화면 단계가 checking(다시 묻기, 1025 첫 기기 화면 안 뜸)
    pub ensured: bool,
    /// 새 기기 쪽 — 숫자를 띄울 때 서버가 보여 준 내 계정 사슬(신원·머리, R7). 4자리 확인 봉투가 이 신원이어야 핀을 꽂는다
    pub my_sas: SasSeen,
    /// 새 기기 쪽 — 4자리가 한 번 틀렸다(R7). 이 흐름은 끝, 다시 로그인부터
    pub confirm_failed: bool,
    /// 보안 번호를 견주고 받아들였거나 '같아요'를 누른 계정 → 그때(ms). 멤버 화면 '확인됨'(시안 e2e-safety v1)
    pub verified: BTreeMap<String, u64>,
    /// 사람이 '막아 두기'를 누른 계정 — 카드를 다시 안 띄운다(멤버 화면에서 다시 볼 수 있다)
    pub blocked: BTreeSet<String>,
    /// 보안 번호가 바뀌어 멈춘 말 — 받아들이면 보낸다(평문이라 7일 지나면·로그아웃하면 지운다)
    pub held: Vec<Held>,
    /// 갈린 사람을 '다시 받기'한 사슬(신원, 머리) — 갈림은 이걸로 셈한 번호를 견줬을 때만 받아들인다(6차 리뷰)
    pub refetched: BTreeMap<String, (String, String)>,    /// 지난 대화를 다 건넨 내 사슬 기기 → 그때(ms) — e2e_handover 가 다시 안 훑게(relay ADR 0007 R10)
    pub handed: BTreeMap<String, u64>,
    /// 건네주기가 실패(망·429·상한·옛 중계)해 물러선 때까지(ms)·이어진 실패 수 — 그 전엔 다시 안 훑는다
    pub handover_after: u64,
    pub handover_fails: u32,
    /// 다 못 훑은 내 사슬 기기 → 방 → 이어 받을 자리(seq) — 바퀴가 상한에 걸려도 다음 바퀴가 거기서부터(못 싸는 말을 매번 처음부터 다시 받지 않게)
    pub handover_at: BTreeMap<String, BTreeMap<String, u64>>,
    /// 팀원 보안 번호가 바뀌어(다시 시작) 저절로 받아들인 때 — 대화 안 회색 줄('보안 번호가 바뀌었어요 · 번호 비교')이 그 자리에(사용자 10-29)
    pub rekeyed: BTreeMap<String, u64>,
}

/// 멈춘 말 하나
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Held {
    pub room: String,
    pub cid: String,
    pub body: String,
    pub human: bool,
    pub at: u64,
    /// 멈추게 한 상대 계정
    pub account: String,
}

/// 숫자를 셈할 때 본 사슬 신원·머리
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SasSeen {
    pub identity: String,
    pub head: String,
}

const SEEN_KEEP_MS: u64 = 30 * 24 * 3600_000;

/// 허용 카드를 열 때 본 새 기기(봉인 cP·서명 열쇠·받는 열쇠)
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CardSeen {
    pub commit: String,
    pub ed: String,
    pub e2e: String,
    /// 카드를 열 때 내 사슬 신원·머리(R7) — 숫자에 들어가고, 허용 땐 그대로여야
    pub identity: String,
    pub head: String,
}

static LOCK: Mutex<()> = Mutex::new(());

pub fn load(dir: &Path) -> E2eStore {
    std::fs::read_to_string(dir.join(FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub(crate) fn mutate<T>(dir: &Path, f: impl FnOnce(&mut E2eStore) -> T) -> Result<T, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut s = load(dir);
    let out = f(&mut s);
    let text = serde_json::to_string(&s).map_err(|e| e.to_string())?;
    crate::accounts::write_atomic(&dir.join(FILE), &text).map_err(|e| format!("e2e.json 을 못 썼어요({e:?})"))?;
    Ok(out)
}

#[derive(Debug, PartialEq)]
pub enum Trust {
    Ok(Chain),
    /// 신원이 바뀜(다시 시작) — 사람이 받아들이기 전
    Changed(Chain),
    /// 전에 본 머리를 잇지 않음 — 서버가 사람마다 다른 사슬을 보여 준다
    Forked,
    /// 아직 사슬이 없는 계정(옛 앱)
    NoChain,
    /// 내 계정 사슬인데 아직 처음 믿기 전 — 내가 시작한 사슬도, 4자리로 확인한 사슬도 아니다(R7). 핀을 안 꽂는다
    Unconfirmed(Chain),
}

/// 핀과 견준다 — 처음이면 핀을 꽂는다(처음 믿기)
fn judge(pin: Option<&Pin>, c: &Chain) -> (Trust, Pin) {
    let now = Pin { identity: c.identity.clone(), seq: c.hashes.len() as u64 - 1, hash: c.head(), state: "ok".into() };
    let Some(p) = pin else { return (Trust::Ok(c.clone()), now) };
    if !extends(c, p.seq, &p.hash) {
        return (Trust::Forked, Pin { state: "forked".into(), ..p.clone() });
    }
    if c.identity != p.identity || p.state == "changed" {
        return (Trust::Changed(c.clone()), Pin { state: "changed".into(), ..p.clone() });
    }
    if p.state == "forked" {
        return (Trust::Forked, p.clone());
    }
    (Trust::Ok(c.clone()), now)
}

/// 그 계정 사슬 — refresh 면 서버에서 다시 받는다(아니면 캐시가 있으면 캐시)
pub fn chain_of(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, account: &str, refresh: bool) -> Result<Trust, String> {
    let cached = load(dir).chains.get(account).cloned();
    let links = match cached.filter(|_| !refresh) {
        Some(l) => l,
        None => {
            let k = relay::device_keys(kc, st)?;
            let (code, v) = relay::call(http, &st.server, &k, Some(&st.device_id), "GET", &format!("/v0/accounts/{account}/chain"), None)?;
            if code != 200 {
                return Err(relay::why(code, &v));
            }
            serde_json::from_value::<Vec<Link>>(v["links"].clone()).map_err(|e| e.to_string())?
        }
    };
    if links.is_empty() {
        return Ok(Trust::NoChain);
    }
    let c = e2e_chain::verify(account, &links).map_err(|e| format!("{account} 사슬이 틀렸어: {e:?}"))?;
    // R7 — 내 계정은 처음 믿기(TOFU)를 하지 않는다. 신원 고리(마지막 genesis/reset)를 내 열쇠로 쓴 사슬 — 내가 시작했거나 내가 다시 시작한 —
    // 만 바로 믿고, 아니면 4자리 확인(e2e_flow::confirm_code)이 핀을 꽂을 때까지 '확인 전'
    let mine = st.account.as_ref().is_some_and(|a| a.id == account);
    if mine {
        let my_pub = relay::device_keys(kc, st)?.public();
        let rooted = links.iter().any(|l| {
            e2e_chain::link_hash(&l.body, &l.sig) == c.identity
                && serde_json::from_str::<Value>(&l.body).is_ok_and(|b| b["device"] == st.device_id.as_str() && b["edPub"] == my_pub.as_str())
        });
        match load(dir).pins.get(account) {
            None if !rooted => return Ok(Trust::Unconfirmed(c)),
            // 내가 다시 시작했다(계정 되찾기) — 예전에 본 머리를 잇는 내 reset 만 새 신원으로 믿는다. 되감기(머리를 안 이음)는 judge 가 갈림으로
            Some(p) if rooted && p.identity != c.identity && e2e_chain::extends(&c, p.seq, &p.hash) => {
                return mutate(dir, |s| {
                    s.pins.insert(account.into(), Pin { identity: c.identity.clone(), seq: c.hashes.len() as u64 - 1, hash: c.head(), state: "ok".into() });
                    s.chains.insert(account.into(), links);
                    Trust::Ok(c)
                });
            }
            _ => {}
        }
    }
    mutate(dir, |s| {
        let (t, pin) = judge(s.pins.get(account), &c);
        s.pins.insert(account.into(), pin);
        s.chains.insert(account.into(), links);
        t
    })
}

// ── 팀 머리(chammo-relay GET /v0/teams/:team/heads, 10-26 팀 지연 3차) — 캐시한 사슬·명부의 마지막 고리가 서버 머리와 같으면 다시 안 받는다.
//    서버가 머리를 속여(새 고리를 숨겨) 봐야 사슬을 통째로 다시 받을 때 옛 사슬을 주는 것과 같은 범위다 — 검증·핀 견주기는 그대로 ──

/// 명부 머리·계정마다 사슬 머리(seq, 마지막 고리 해시) — 사슬이 없는 계정은 None
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Heads {
    pub log: Option<(u64, String)>,
    pub chains: BTreeMap<String, Option<(u64, String)>>,
}

/// 머리 길이 없는 옛 중계(404) — 10분 기억해 매번 404 를 안 맞는다
static NO_HEADS: Mutex<BTreeMap<String, std::time::Instant>> = Mutex::new(BTreeMap::new());
const NO_HEADS_FOR: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// 시험은 실마다 가짜 중계가 따로라 기억도 실마다
fn heads_key(server: &str) -> String {
    if cfg!(test) { format!("{server}#{:?}", std::thread::current().id()) } else { server.to_string() }
}

fn head_of(v: &Value) -> Option<(u64, String)> {
    Some((v["seq"].as_u64()?, v["hash"].as_str()?.to_string()))
}

/// 팀 머리 — 옛 중계·망 실패·모양이 틀리면 None(그땐 예전처럼 하나씩 받는다)
pub(crate) fn heads(kc: &dyn Store, http: &dyn Http, st: &TeamState, team: &str) -> Option<Heads> {
    let key = heads_key(&st.server);
    if NO_HEADS.lock().unwrap_or_else(|e| e.into_inner()).get(&key).is_some_and(|t| t.elapsed() < NO_HEADS_FOR) {
        return None;
    }
    let k = relay::device_keys(kc, st).ok()?;
    let (code, v) = relay::call(http, &st.server, &k, Some(&st.device_id), "GET", &format!("/v0/teams/{team}/heads"), None).ok()?;
    if code == 404 {
        NO_HEADS.lock().unwrap_or_else(|e| e.into_inner()).insert(key, std::time::Instant::now());
        return None;
    }
    if code != 200 {
        return None;
    }
    let chains = v["chains"].as_object()?.iter().map(|(a, h)| (a.clone(), head_of(h))).collect();
    Some(Heads { log: head_of(&v["log"]), chains })
}

/// 사슬을 새로 — 머리가 캐시한 사슬 끝과 같으면 캐시로(요청 없음). 머리가 없거나 다르면 chain_of(refresh).
/// 머리 seq 는 서버 값이라 seq + 1 은 checked_add(u64 끝이면 넘쳐 패닉)
fn chain_fresh(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, account: &str, h: Option<&Heads>) -> Result<Trust, String> {
    let same = h.and_then(|h| h.chains.get(account)).and_then(|x| x.as_ref()).is_some_and(|(seq, hash)| {
        load(dir).chains.get(account).is_some_and(|c| seq.checked_add(1) == Some(c.len() as u64) && c.last().is_some_and(|l| l.seq == *seq && e2e_chain::link_hash(&l.body, &l.sig) == *hash))
    });
    chain_of(dir, kc, http, st, account, !same)
}

/// 시험 준비 — 이 사슬을 믿은 상태로(캐시 + 핀)
#[cfg(test)]
pub(crate) fn seed_trusted(dir: &Path, account: &str, links: Vec<Link>) {
    let c = e2e_chain::verify(account, &links).expect("시험 사슬");
    mutate(dir, |s| {
        s.pins.insert(account.into(), Pin { identity: c.identity.clone(), seq: c.hashes.len() as u64 - 1, hash: c.head(), state: "ok".into() });
        s.chains.insert(account.into(), links);
    })
    .unwrap();
}

/// 시험 준비 — 이 기기를 자기 계정 사슬의 첫 기기로(내가 시작한 사슬, 핀까지)
#[cfg(test)]
pub(crate) fn seed_self(dir: &Path, kc: &dyn Store) {
    let st = relay::load_state(dir);
    let k = relay::device_keys(kc, &st).expect("시험 열쇠");
    let acc = st.account.as_ref().expect("계정").id.clone();
    let body = serde_json::json!({ "v": 1, "account": acc, "seq": 0, "prev": "", "by": st.device_id, "kind": "genesis", "device": st.device_id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    seed_trusted(dir, &acc, vec![Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{body}")), body }]);
}

/// 믿었던 사슬(R3) — 핀이 ok 면 지금 사슬, 바뀐 계정이면 핀 머리까지의 앞부분(그 뒤 새 기기 서명은 무효), 갈렸거나 없으면 None
pub fn trusted_chain(dir: &Path, account: &str) -> Option<Chain> {
    let s = load(dir);
    let (pin, links) = (s.pins.get(account)?, s.chains.get(account)?);
    let upto = links.get(..=pin.seq as usize)?;
    let c = e2e_chain::verify(account, upto).ok()?;
    (c.head() == pin.hash && c.identity == pin.identity).then_some(c)
}

/// 이 기기의 허용 흐름 상태를 지운다 — 로그아웃(forget_local)·로그인 마침 때. 4자리가 틀려 묶인 흐름도 여기서 풀린다(5차 리뷰).
/// account = 내 계정이면 그 계정 핀·사슬도 지운다(새 기기 열쇠로 다시 4자리부터). 다른 계정 핀은 남긴다
pub(crate) fn reset_self(dir: &Path, account: Option<&str>) -> Result<(), String> {
    mutate(dir, |s| {
        s.confirm_failed = false;
        s.no_chain = false;
        s.need_reset = false;
        s.outside = false;
        s.relogin = false;
        s.ensured = false;
        s.my_sas = Default::default();
        s.my_np.clear();
        s.my_nm.clear();
        s.my_revealed = false;
        // 멈춘 말은 평문 — 기기 주인이 바뀌는 때(로그인·로그아웃) 지운다(6차 리뷰)
        s.held.clear();
        if let Some(a) = account {
            s.pins.remove(a);
            s.chains.remove(a);
        }
    })
}

/// 4자리로 확인한 내 계정 사슬에 처음 핀을 꽂는다(R7) — seq·hash = 허용 기기가 확인 봉투에 담은 머리
pub(crate) fn pin_first(dir: &Path, account: &str, links: Vec<Link>, identity: &str, seq: u64, hash: &str) -> Result<(), String> {
    mutate(dir, |s| {
        s.pins.insert(account.into(), Pin { identity: identity.into(), seq, hash: hash.into(), state: "ok".into() });
        s.chains.insert(account.into(), links);
    })
}

/// 사람이 '받아들이기'를 눌렀다 — 지금 캐시한 사슬을 새 핀으로(사람 손 길에서만 부른다)
pub fn accept(dir: &Path, account: &str) -> Result<(), String> {
    let links = load(dir).chains.get(account).cloned().ok_or("그 사람 사슬을 아직 못 받았어")?;
    let c = e2e_chain::verify(account, &links).map_err(|e| format!("{e:?}"))?;
    mutate(dir, |s| {
        s.pins.insert(account.into(), Pin { identity: c.identity.clone(), seq: c.hashes.len() as u64 - 1, hash: c.head(), state: "ok".into() });
    })
}

/// 팀 명부 — 나오는 계정 사슬을 먼저 받아 검증한다(갈린 사슬이면 Err). 명부가 없거나 내 자리가 없으면 Err(R8 — 평문 전환기 없음)
pub fn roster_of(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, team: &str) -> Result<Roster, String> {
    roster_with(dir, kc, http, st, team, None)
}

// ── 받는 길 명부(10-28 22:53 429) — 받은 말마다 /log 를 다시 받으면 다시 붙은 방의 밀린 말이 열쇠의 10분 300개를 다 먹는다.
//    받을 땐 1분 안에 받은 명부를 다시 쓴다(빠진 사람 말이 그만큼 늦게 막힌다 — 보낼 땐 지금처럼 늘 새로). 캐시 명부에 보낸 이가 없거나
//    봉투의 명부 머리를 모르면 새로 받되 10초에 한 번까지(지어낸 보낸 이로 요청을 쏟게 하지 못하게) ──

static RECV_AT: Mutex<BTreeMap<String, std::time::Instant>> = Mutex::new(BTreeMap::new());
const RECV_REUSE: std::time::Duration = std::time::Duration::from_secs(60);
const RECV_FORCE_GAP: std::time::Duration = std::time::Duration::from_secs(10);

/// 받는 길 명부 기억을 지운다 — 다시 열기(e2e_retry)처럼 '이제 명부가 맞춰졌을' 때 첫 말이 새로 받게
pub(crate) fn recv_forget(dir: &Path) {
    let pre = format!("{}|", dir.display());
    RECV_AT.lock().unwrap_or_else(|e| e.into_inner()).retain(|k, _| !k.starts_with(&pre));
}

/// 받는 길 명부 — force 면 캐시가 1분 안이어도 새로(단 10초에 한 번). 새로 못 받는 사이엔 캐시 명부로
pub(crate) fn roster_recv(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, team: &str, force: bool) -> Result<Roster, String> {
    // 새로 받기는 따로 센다 — 막 받은 명부 바로 뒤에 온 새 사람 말도 한 번은 새로 받게
    let key = format!("{}|{team}{}", dir.display(), if force { "|force" } else { "" });
    let last = RECV_AT.lock().unwrap_or_else(|e| e.into_inner()).get(&key).copied();
    let gap = if force { RECV_FORCE_GAP } else { RECV_REUSE };
    let cached = load(dir).rosters.get(team).and_then(|c| c.last().map(|l| (l.seq, e2e_roster::team_hash(l))));
    if let (Some(t), Some(head)) = (last, cached) {
        if t.elapsed() < gap {
            return roster_with(dir, kc, http, st, team, Some(&Heads { log: Some(head), chains: BTreeMap::new() }));
        }
    }
    RECV_AT.lock().unwrap_or_else(|e| e.into_inner()).insert(key, std::time::Instant::now());
    roster_of(dir, kc, http, st, team)
}

/// roster_of — 팀 머리가 캐시한 명부 끝과 같으면 명부를 다시 안 받는다(검증은 그대로)
pub(crate) fn roster_with(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, team: &str, h: Option<&Heads>) -> Result<Roster, String> {
    let same = h.and_then(|h| h.log.as_ref()).and_then(|(seq, hash)| {
        load(dir).rosters.get(team).filter(|c| seq.checked_add(1) == Some(c.len() as u64) && c.last().is_some_and(|l| l.seq == *seq && e2e_roster::team_hash(l) == *hash)).cloned()
    });
    let links: Vec<TLink> = match same {
        Some(c) => c,
        None => {
            let k = relay::device_keys(kc, st)?;
            let (code, v) = relay::call(http, &st.server, &k, Some(&st.device_id), "GET", &format!("/v0/teams/{team}/log"), None)?;
            if code != 200 {
                return Err(relay::why(code, &v));
            }
            serde_json::from_value(v["links"].clone()).map_err(|e| e.to_string())?
        }
    };
    if links.is_empty() {
        return Err(NO_ROSTER.into());
    }
    // 서명 기기 확인용 사슬 — 먼저 캐시로, 틀리면(새 기기·새 사람) 새로 받아 한 번 더
    // 명부 서명 확인엔 믿는 사슬만(R3) — 바뀐 계정은 핀 머리까지(그 뒤 공격 기기가 그 사람 이름으로 쓴 고리는 무효)
    // 바뀐 계정은 두 벌 — 믿음 표시는 핀 머리까지(trusted), 구조는 지금 사슬(loose, 받아들였다면 될 모양). 한 사람이 바뀌었다고 명부 전체를 버리지 않는다(결정 5, 계획 e2e-recover §9)
    let gather = |refresh: bool| -> Result<(BTreeMap<String, Chain>, BTreeMap<String, Chain>), String> {
        let (mut trusted, mut loose) = (BTreeMap::new(), BTreeMap::new());
        for a in e2e_roster::accounts_needed(&links) {
            match chain_of(dir, kc, http, st, &a, refresh)? {
                Trust::Ok(c) => {
                    trusted.insert(a.clone(), c.clone());
                    loose.insert(a, c);
                }
                Trust::Changed(c) => {
                    if let Some(t) = trusted_chain(dir, &a) {
                        trusted.insert(a.clone(), t);
                    }
                    loose.insert(a, c);
                }
                Trust::Forked => return Err(format!("{a} 사슬이 갈렸어 — 명부를 믿을 수 없어")),
                Trust::NoChain | Trust::Unconfirmed(_) => {}
            }
        }
        Ok((trusted, loose))
    };
    // R3 — 내가 핀한 머리 뒤 고리는 지금 사슬 기기 서명만
    let pinned = load(dir).roster_pins.get(team).map(|p| p.seq);
    let check = |(t, l): (BTreeMap<String, Chain>, BTreeMap<String, Chain>)| e2e_roster::verify_two(team, &links, &t, &l, pinned);
    let r = match check(gather(false)?) {
        Ok(r) => r,
        Err(_) => check(gather(true)?).map_err(|e| format!("팀 명부가 틀렸어: {e:?}"))?,
    };
    // 명부에 '내 자리'(내 멤버 id·내 계정)가 있어야 — 고리마다 앞 고리 해시가 묶여 있어 내 자리 앞부분은 진짜다.
    // 서버가 지어낸 명부(가짜 팀장·가짜 멤버)엔 내 자리가 없다(리뷰 B 치명 3)
    let my_acc = st.account.as_ref().map(|a| a.id.clone()).unwrap_or_default();
    let my_member = st.teams.iter().find(|t| t.id == team).map(|t| t.member_id.clone()).unwrap_or_default();
    if !r.members.get(&my_member).is_some_and(|m| m.account == my_acc) {
        return Err("서명된 팀 명부에 내가 없어 — 서버가 다른 명부를 보여 줄 수 있어(보내지 않았어)".into());
    }
    // 본 머리를 이어야 — 되감기(빠진 사람 되살리기)·갈림 막기
    let now = Pin { identity: r.hashes[0].clone(), seq: r.hashes.len() as u64 - 1, hash: r.head(), state: "ok".into() };
    let pinned = load(dir).roster_pins.get(team).cloned();
    if let Some(p) = &pinned {
        if p.identity != now.identity || r.hashes.get(p.seq as usize) != Some(&p.hash) {
            return Err("팀 명부가 전에 본 것과 갈렸어(되감기·바꿔치기) — 보내지 않았어(서버를 의심)".into());
        }
    }
    mutate(dir, |s| {
        s.rosters.insert(team.into(), links);
        s.roster_pins.insert(team.into(), now);
    })?;
    Ok(r)
}

/// 명부가 없는 팀(옛 앱으로 만든 팀) — 암호 전용이라 못 쓴다
pub(crate) const NO_ROSTER: &str = "이 팀은 종단 암호 명부가 없어 — 팀을 새 판에서 새로 만들어야 메신저를 써요(보내지 않았어)";

fn recipients(c: &Chain) -> impl Iterator<Item = Recipient> + '_ {
    c.devices.iter().map(|(d, x)| Recipient { device: d.clone(), e2e: x.e2e.clone() })
}

/// 내 계정 사슬(내가 그 안에 있을 때만) — 아니면 Err(이 기기는 아직 종단 암호를 못 쓴다, R8 평문 없음).
/// 보낼 땐 늘 새로 받는다 — 캐시로 보내면 막 허용한 내 기기가 받는 목록에서 빠졌다(로컬 종단 시험 10-24)
/// 내 사슬 신원이 바뀌었거나(다른 열쇠의 reset) 갈렸으면 Err — 서버가 [공격자 reset + 내 기기 다시 add]를 붙이면 내 말이 공격자 기기 몫까지 봉해진다(리뷰 B 치명 2).
/// 사람이 확인(받아들이기)하기 전엔 보내기·허용·고리 쓰기를 멈춘다
pub(crate) const NOT_READY: &str = "이 기기는 아직 종단 암호 준비 전이야 — 로그인·기기 허용을 먼저 마쳐 줘(보내지 않았어)";
pub(crate) const MY_CHAIN_UNCONFIRMED: &str = "이 기기는 아직 4자리 확인 전이야 — 다른 내 기기에 뜬 4자리를 넣으면 보낼 수 있어";
pub(crate) const MY_CHAIN_CHANGED: &str = "내 계정 기기 사슬이 바뀌었어(내가 안 한 다시 시작·갈림) — 확인 전엔 보내지도 허용하지도 않아";
fn my_chain(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, h: Option<&Heads>) -> Result<Chain, String> {
    let acc = st.account.as_ref().map(|a| a.id.clone()).ok_or(NOT_READY)?;
    match chain_fresh(dir, kc, http, st, &acc, h)? {
        Trust::Ok(c) if c.devices.contains_key(&st.device_id) => Ok(c),
        Trust::Changed(_) | Trust::Forked => Err(MY_CHAIN_CHANGED.into()),
        // 사슬엔 들었는데 4자리 확인 전 — 서버가 보여 준 사슬로 봉하지 않는다(R7)
        Trust::Unconfirmed(c) if c.devices.contains_key(&st.device_id) => Err(MY_CHAIN_UNCONFIRMED.into()),
        _ => Err(NOT_READY.into()),
    }
}

/// 보내기 — 봉투 또는 Err(보내지 않음). 평문은 없다(R8)
/// 받을 사람 — (받는 기기, 받는 계정 → 내가 본 사슬 머리, 명부 머리). 메시지 봉투(wrap)와 파일 봉투(team_locker)가 같은 셈을 쓴다.
/// 내 기기끼리 방 = 내 사슬, DM = 명부의 그 상대 + 내 사슬, 단톡방 = 명부 room 고리의 방 사람(팀에 남은) + 내 사슬
pub struct Audience {
    pub to: Vec<Recipient>,
    pub peers: BTreeMap<String, String>,
    pub roster: String,
    /// 내 사슬 머리
    pub head: String,
}

pub fn audience(dir: &Path, kc: &dyn Store, http: &dyn Http, room: &str) -> Result<Audience, String> {
    let st = relay::load_state(dir);
    let r = st.rooms.iter().find(|r| r.id == room).cloned().ok_or("모르는 방")?;
    // 팀 방이면 팀 머리 한 번 — 내 사슬·명부·상대 사슬이 그대로면 다시 안 받는다
    let h = if r.kind == "self" { None } else { heads(kc, http, &st, &r.team) };
    let mine = my_chain(dir, kc, http, &st, h.as_ref())?;
    let mut a = Audience { to: recipients(&mine).collect(), peers: BTreeMap::new(), roster: String::new(), head: mine.head() };
    if r.kind == "self" {
        return Ok(a);
    }
    let roster = roster_with(dir, kc, http, &st, &r.team, h.as_ref())?;
    let my_acc = st.account.as_ref().map(|a| a.id.clone()).unwrap_or_default();
    if r.kind == "group" {
        // 단톡방 — 받을 사람은 서명된 명부의 방 사람(서버 방 목록이 아니라). 바뀜·갈림·준비 전인 사람은 그 사람만 빼고 보낸다(결정 5)
        let others: Vec<_> = group_peers(&roster, &st, &r)?.into_iter().filter(|p| p.account != my_acc).collect();
        let mut sent_to = 0;
        for peer in others.iter().filter(|p| p.confirmed) {
            if let Trust::Ok(pc) = chain_fresh(dir, kc, http, &st, &peer.account, h.as_ref())? {
                a.to.extend(recipients(&pc));
                a.peers.insert(peer.account.clone(), pc.head());
                sent_to += 1;
            }
        }
        if sent_to == 0 && !others.is_empty() {
            return Err("이 팀챗에 받을 수 있는 사람이 없어(보안 번호 바뀜·준비 전) — 보내지 않았어".into());
        }
    } else {
        let peer = roster.members.get(&r.peer).ok_or("그 사람은 서명된 팀 명부에 없어 — 보내지 않았어(새 판으로 그 팀에 들어와야 해)")?;
        if !peer.active {
            return Err(format!("{} 은(는) 팀 명부에서 빠졌어 — 보내지 않았어", peer.display_name));
        }
        // 상대 사슬도 새로 — 그 사람이 막 들인 기기까지 받게
        match chain_fresh(dir, kc, http, &st, &peer.account, h.as_ref())? {
            Trust::Ok(pc) => {
                a.to.extend(recipients(&pc));
                a.peers.insert(peer.account.clone(), pc.head());
            }
            Trust::Changed(_) => return Err(format!("{} 의 보안 번호가 바뀌었어 — 사람이 앱에서 받아들이기 전엔 안 보내", peer.display_name)),
            Trust::Forked => return Err(format!("{} 의 기기 사슬이 갈려 보여 — 보내지 않았어(서버를 의심)", peer.display_name)),
            Trust::NoChain => return Err(format!("{} 은(는) 아직 종단 암호 준비 전이라 보내지 않았어 — 그 사람이 새 판으로 로그인해야 해", peer.display_name)),
            Trust::Unconfirmed(_) => return Err("상대 사슬을 확인하지 못했어".into()),
        }
        // 확인 전 멤버(확인 전 팀장의 초대로 들어옴 등) — 사슬이 괜찮아도 받아들이기 전엔 안 보낸다(계획 e2e-recover §9 S7)
        if !peer.confirmed {
            return Err(format!("{} 은(는) 아직 확인 전 멤버라 보내지 않았어 — 팀장 보안 번호를 받아들이면 보내요", peer.display_name));
        }
    }
    a.roster = roster.head();
    Ok(a)
}

/// 파일 봉투용 — 받는 기기만
pub fn room_recipients(dir: &Path, kc: &dyn Store, http: &dyn Http, room: &str) -> Result<Vec<Recipient>, String> {
    audience(dir, kc, http, room).map(|a| a.to)
}

pub fn wrap(dir: &Path, kc: &dyn Store, http: &dyn Http, room: &str, cid: &str, text: &str, human: bool, at: u64) -> Result<String, String> {
    wrap_with(dir, kc, http, room, cid, text, human, at, Extra::default())
}

/// 반응·붙인 파일까지 싣기(chammo-relay team-rooms v2)
#[allow(clippy::too_many_arguments)]
pub fn wrap_with(dir: &Path, kc: &dyn Store, http: &dyn Http, room: &str, cid: &str, text: &str, human: bool, at: u64, extra: Extra) -> Result<String, String> {
    extra.check()?;
    seal_inner(dir, kc, http, room, cid, Inner { origin: if human { "human".into() } else { "agent".into() }, text: text.into(), at, extra, ..Default::default() })
}

/// 팀 참모 답(team_helper) — 참모 말(agent) + 안쪽 via=helper. 받는 사람 셈·봉투는 보통 말과 같다
pub fn wrap_helper(dir: &Path, kc: &dyn Store, http: &dyn Http, room: &str, cid: &str, text: &str, at: u64) -> Result<String, String> {
    wrap_helper_with(dir, kc, http, room, cid, text, at, Extra::default())
}

/// 팀 참모 답 + 딸린 것(참모 id·이름·이어 묻기·붙인 파일 — ADR 0017)
#[allow(clippy::too_many_arguments)]
pub fn wrap_helper_with(dir: &Path, kc: &dyn Store, http: &dyn Http, room: &str, cid: &str, text: &str, at: u64, extra: Extra) -> Result<String, String> {
    extra.check()?;
    seal_inner(dir, kc, http, room, cid, Inner { origin: "agent".into(), text: text.into(), at, via: "helper".into(), extra })
}

fn seal_inner(dir: &Path, kc: &dyn Store, http: &dyn Http, room: &str, cid: &str, inner: Inner) -> Result<String, String> {
    let a = audience(dir, kc, http, room)?;
    let st = relay::load_state(dir);
    let meta = Meta { room: room.into(), cid: cid.into(), from: st.device_id.clone(), head: a.head, peers: a.peers, roster: a.roster };
    let keys = relay::device_keys(kc, &st)?;
    e2e_envelope::seal(&keys, &meta, &inner, &a.to).map_err(|e| format!("봉투를 못 만들었어: {e:?}"))
}

/// 단톡방 사람(팀에서 안 빠진) — 명부 room 고리에서만. 명부에 그 방이 없거나 내가 방 사람이 아니면 못 쓴다
pub(crate) const ROOM_UNCONFIRMED: &str = "이 팀챗은 보안 번호가 바뀐 사람이 만들거나 고쳐서 — 받아들이기 전엔 보내지 않아";

/// 보내기·방 고치기용 — 확인 전 방(확인 전 사람이 만들거나 고친 방)은 받아들이기 전까지 안 쓴다
fn group_peers<'a>(roster: &'a Roster, st: &TeamState, r: &relay::Room) -> Result<Vec<&'a e2e_roster::RosterMember>, String> {
    if roster.rooms.get(&r.id).is_some_and(|x| !x.confirmed) {
        return Err(ROOM_UNCONFIRMED.into());
    }
    group_peers_any(roster, st, r)
}

/// 받기용 — 확인 전 방도 방 사람은 본다(받은 말엔 note 를 단다)
fn group_peers_any<'a>(roster: &'a Roster, st: &TeamState, r: &relay::Room) -> Result<Vec<&'a e2e_roster::RosterMember>, String> {
    let room = roster.rooms.get(&r.id).ok_or("이 팀챗은 서명된 팀 명부에 없어 — 보내지·받지 않아")?;
    let me = st.teams.iter().find(|t| t.id == r.team).map(|t| t.member_id.as_str()).unwrap_or("");
    if !room.members.iter().any(|m| m == me) {
        return Err("이 팀챗에서 빠졌어".into());
    }
    Ok(room.members.iter().filter_map(|m| roster.members.get(m)).filter(|p| p.active).collect())
}

/// 팀 보관함 사람들(chammo-relay ADR 0009) — 받는 기기(내 사슬 + 명부의 빠지지 않은 사람 사슬, 믿는 것만)·
/// 서명 기기(믿는 사슬에 한 번이라도 든 기기 → 서명 열쇠)·멤버 이름. 보관함 일 한 번에 한 번 받는다(사슬은 새로)
#[derive(Default, Debug)]
pub struct LockerPeople {
    pub recipients: Vec<Recipient>,
    pub signers: BTreeMap<String, String>,
    pub names: BTreeMap<String, String>,
    /// 받는 목록에서 뺀 사람(보안 번호 바뀜·갈림·준비 전) — 화면 한 줄
    pub skipped: Vec<String>,
}

/// 올린 기기 열쇠 더하기 — 같은 기기 id 가 다른 열쇠로 또 오면 그 id 는 못 쓰게(빈 열쇠, 서명 확인이 늘 실패). 남의 기기 id 를 자기 사슬에 넣어 그 기기 이름으로 파일을 꾸미지 못하게(공격 리뷰 5)
pub(crate) fn add_signers(to: &mut BTreeMap<String, String>, more: &BTreeMap<String, String>) {
    for (d, ed) in more {
        match to.get(d) {
            Some(x) if x != ed => {
                to.insert(d.clone(), String::new());
            }
            Some(_) => {}
            None => {
                to.insert(d.clone(), ed.clone());
            }
        }
    }
}

pub fn locker_people(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, team: &str) -> Result<LockerPeople, String> {
    let h = heads(kc, http, st, team);
    let mine = my_chain(dir, kc, http, st, h.as_ref())?;
    let roster = roster_with(dir, kc, http, st, team, h.as_ref())?;
    let my_acc = st.account.as_ref().map(|a| a.id.clone()).unwrap_or_default();
    let mut p = LockerPeople { recipients: recipients(&mine).collect(), signers: mine.ever.clone(), ..Default::default() };
    for (member, m) in &roster.members {
        p.names.insert(member.clone(), m.display_name.clone());
        if m.account == my_acc {
            continue;
        }
        let got = if m.active { chain_fresh(dir, kc, http, st, &m.account, h.as_ref())? } else { chain_of(dir, kc, http, st, &m.account, false)? };
        match got {
            // 확인 전 멤버 — 받는 사람도 올린 사람 확인도 아니다(받아들이기 전, 계획 e2e-recover §9)
            Trust::Ok(_) if !m.confirmed => {
                if m.active {
                    p.skipped.push(m.display_name.clone());
                }
            }
            Trust::Ok(c) => {
                add_signers(&mut p.signers, &c.ever);
                if m.active {
                    p.recipients.extend(recipients(&c));
                }
            }
            Trust::Changed(_) => {
                // 바뀐 사람의 믿었던 앞부분 — 확인된 멤버였을 때만(확인 전 멤버의 처음 본 앞부분을 서명자로 쓰지 않게, 공격 리뷰 5)
                if let Some(c) = trusted_chain(dir, &m.account).filter(|_| m.confirmed) {
                    add_signers(&mut p.signers, &c.ever);
                }
                if m.active {
                    p.skipped.push(m.display_name.clone());
                }
            }
            _ if m.active => p.skipped.push(m.display_name.clone()),
            _ => {}
        }
    }
    let mut seen = std::collections::BTreeSet::new();
    p.recipients.retain(|r| seen.insert(r.device.clone()));
    Ok(p)
}

#[derive(Debug, PartialEq)]
pub enum Unwrapped {
    /// 풀었다 — note 가 비어 있지 않으면 넘기지 말고 기록만(changed·fork). at = 보낸 기기가 봉한 시각(서버 at 대신). extra = 반응·파일
    /// via = "helper" 면 팀 참모 답(바깥·안쪽 둘 다 참모 말일 때만)
    Opened { text: String, human: bool, note: String, at: u64, extra: Extra, via: String },
    /// 못 풀었다(이유)
    Failed(String),
}

/// 건네받은 열쇠 — {t:"late", key:{enc, w, by}} 틀에서만(msg 틀에 붙은 key 는 안 본다)
fn late_key(m: &Value) -> Option<(e2e_envelope::Late, String)> {
    if m["t"] != "late" {
        return None;
    }
    let k = &m["key"];
    let s = |x: &str| k[x].as_str().unwrap_or("").to_string();
    Some((e2e_envelope::Late { enc: s("enc"), w: s("w") }, s("by")))
}

/// 받기 — 서버가 찍은 보낸 기기·계정(m.from)과 봉투 머리가 같아야 한다
pub fn unwrap(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, m: &Value) -> Unwrapped {
    unwrap_as(dir, kc, http, st, m, false)
}

/// 다시 열기(e2e_retry) — 이 기기가 직접 보관한 봉투라 되넣기 거름만 건너뛰고 나머지는 처음부터 다시 본다
pub(crate) fn reopen(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, m: &Value) -> Unwrapped {
    unwrap_as(dir, kc, http, st, m, true)
}

fn unwrap_as(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, m: &Value, again: bool) -> Unwrapped {
    let body = m["body"].as_str().unwrap_or("");
    let (room, device, account) = (m["room"].as_str().unwrap_or(""), m["from"]["device"].as_str().unwrap_or(""), m["from"]["account"].as_str().unwrap_or(""));
    let my_acc = st.account.as_ref().map(|a| a.id.clone()).unwrap_or_default();
    let r = st.rooms.iter().find(|x| x.id == room).cloned().unwrap_or_default();
    let own = r.kind == "self";
    // 평문은 방·보낸 이와 상관없이 안 받는다(R8 — 서버가 평문을 끼워 넣거나 내려앉히는 길을 통째로 없앤다)
    let Some(meta) = e2e_envelope::peek(body) else { return Unwrapped::Failed("plain".into()) };
    if meta.room != room || meta.from != device || account.is_empty() {
        return Unwrapped::Failed("shape".into());
    }
    // 보낸 계정이 이 방에 맞아야 — 내 기기끼리 방은 내 계정, 팀 방은 명부상 그 상대(또는 내 다른 기기)(리뷰 B 높음 4)
    let mut roster_head_ok = true;
    let mut doubtful = false;
    if own {
        if account != my_acc {
            return Unwrapped::Failed("account".into());
        }
    } else {
        let found = |roster: &Roster| {
            // 단톡방은 명부의 방 사람 중 하나, DM 은 그 상대
            let sender = if r.kind == "group" {
                group_peers_any(roster, st, &r).ok().and_then(|ps| ps.into_iter().find(|p| p.account == account).cloned())
            } else {
                roster.members.get(&r.peer).filter(|p| p.active && p.account == account).cloned()
            };
            let head_ok = meta.roster.is_empty() || roster.hashes.contains(&meta.roster);
            (sender, head_ok)
        };
        let mut roster = match roster_recv(dir, kc, http, st, &r.team, false) {
            Ok(x) => x,
            Err(e) => return Unwrapped::Failed(e),
        };
        let (mut sender, mut head_ok) = found(&roster);
        // 캐시 명부로 모르는 보낸 이·명부 머리 — 새 사람·새 고리일 수 있으니 새로 한 번
        if (account != my_acc && sender.is_none()) || !head_ok {
            if let Ok(x) = roster_recv(dir, kc, http, st, &r.team, true) {
                roster = x;
                (sender, head_ok) = found(&roster);
            }
        }
        let sender = sender.as_ref();
        if account != my_acc && sender.is_none() {
            return Unwrapped::Failed("account".into());
        }
        // 확인 전 사람이 보냈거나 확인 전 방이면 받되 기록만(넘기지 않음) — 받아들이기 전(계획 e2e-recover §9 S13)
        doubtful = sender.is_some_and(|p| !p.confirmed) || (r.kind == "group" && roster.rooms.get(&r.id).is_some_and(|x| !x.confirmed));
        roster_head_ok = head_ok;
    }
    // 같은 봉투를 새 seq 로 다시 넣기 거르기(리뷰 B 중간 6)
    let seen_key = format!("{device}|{}", meta.cid);
    if !again && load(dir).seen_at.contains_key(&seen_key) {
        return Unwrapped::Failed("replay".into());
    }
    let get = |refresh| chain_of(dir, kc, http, st, account, refresh);
    let mut trust = get(false);
    // 모르는 기기거나 봉투 머리가 아직 안 본 고리면 한 번 새로 받는다
    if !matches!(&trust, Ok(Trust::Ok(c) | Trust::Changed(c)) if c.devices.contains_key(device) && c.hashes.contains(&meta.head)) {
        trust = get(true);
    }
    let (c, mut note) = match trust {
        Ok(Trust::Ok(c)) => (c, String::new()),
        Ok(Trust::Changed(c)) => (c, "changed".to_string()),
        Ok(Trust::Forked) => return Unwrapped::Failed("forked".into()),
        Ok(Trust::NoChain) => return Unwrapped::Failed("no-chain".into()),
        Ok(Trust::Unconfirmed(_)) => return Unwrapped::Failed("unconfirmed".into()),
        Err(e) => return Unwrapped::Failed(e),
    };
    let Some(ed) = c.devices.get(device).map(|d| d.ed.clone()) else { return Unwrapped::Failed("not-in-chain".into()) };
    let keys = match relay::device_keys(kc, st) {
        Ok(k) => k,
        Err(e) => return Unwrapped::Failed(e),
    };
    // 지난 대화 건네받기(R10) — late 틀에서만. 건넨 기기와 원래 받는 기기 중 하나가 내 사슬(한 번이라도 든 기기)이어야
    let opened = match late_key(m) {
        None => e2e_envelope::open(&keys, &st.device_id, body, Some(&ed)),
        Some((l, by)) => {
            let mine = |refresh| match chain_of(dir, kc, http, st, &my_acc, refresh) {
                Ok(Trust::Ok(c)) => Some(c),
                _ => None,
            };
            let Some(mc) = mine(false).filter(|c| c.ever.contains_key(&by)).or_else(|| mine(true)) else { return Unwrapped::Failed("late-chain".into()) };
            if !mc.ever.contains_key(&by) {
                return Unwrapped::Failed("late-by".into());
            }
            if !e2e_envelope::recipients(body).iter().any(|d| mc.ever.contains_key(d)) {
                return Unwrapped::Failed("late-not-mine".into());
            }
            e2e_envelope::open_late(&keys, &st.device_id, body, Some(&ed), &l)
        }
    };
    let (meta, inner) = match opened {
        Ok(x) => x,
        Err(e) => return Unwrapped::Failed(format!("{e:?}")),
    };
    // 포크 대조 — 보낸 사람이 본 사슬 머리가 그 사람 사슬에 있어야, 내 사슬로 본 머리가 내 사슬에 있어야
    let mine_ok = meta.peers.get(&my_acc).is_none_or(|h| {
        let has = |t: &Result<Trust, String>| matches!(t, Ok(Trust::Ok(c) | Trust::Changed(c)) if c.hashes.contains(h));
        has(&chain_of(dir, kc, http, st, &my_acc, false)) || has(&chain_of(dir, kc, http, st, &my_acc, true))
    });
    if !c.hashes.contains(&meta.head) || !mine_ok || !roster_head_ok {
        note = "fork".into();
    } else if doubtful && note.is_empty() {
        note = "changed".into();
    }
    // 거르기 목록에서 버린 뒤 다시 넣기 막기 — 그만큼 오래된 봉투는 안 받는다. 적기에 실패하면 받지 않는다(다시 넣기 거름이 빠지니)
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    if inner.at.saturating_add(SEEN_KEEP_MS) < now {
        return Unwrapped::Failed("too-old".into());
    }
    // 먼 미래 시각 봉투 — 거르기 목록에서 안 빠지고 쌓인다(3차 리뷰 낮음). 시계 틀림 하루까지는 받는다
    if inner.at > now.saturating_add(24 * 3600_000) {
        return Unwrapped::Failed("future".into());
    }
    if let Err(e) = mutate(dir, |s| {
        s.seen_at.retain(|_, at| at.saturating_add(SEEN_KEEP_MS) >= now);
        s.seen_at.insert(seen_key, inner.at);
    }) {
        return Unwrapped::Failed(e);
    }
    let human = m["origin"] == "human" && inner.origin == "human";
    // 팀 참모 답 표시는 바깥·안쪽 둘 다 참모 말일 때만 — 사람 말이 via 를 달고 와도 팀 참모로 안 보인다
    let via = if m["origin"] == "agent" && inner.origin == "agent" && inner.via == "helper" { "helper".to_string() } else { String::new() };
    // 모양이 틀린 반응·파일 칸은 버리고 글만(보낸 쪽 앱이 틀렸거나 장난 — 글은 서명이 맞으니 받는다)
    let extra = if inner.extra.check().is_ok() { inner.extra } else { Extra::default() };
    Unwrapped::Opened { text: inner.text, human, note, at: inner.at, extra, via }
}

#[cfg(test)]
#[path = "e2e_state_tests.rs"]
mod tests;
