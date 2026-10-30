//! 팀 앱을 이 기기에서 쓰는 길(chammo-relay ADR 0011, 첫 앱 = 팀 캘린더) — 열쇠(보관함 appkey 줄)·since 따라잡기·판 맞춘 쓰기·
//! 소켓으로 온 기록 반영·기기 봉한 캐시. 화면 명령(team_app_cmd)·폰(mobile_http)이 이것만 부른다.
//! 첫 그림은 망 없이 캐시에서(load), 다음에 since 로 차이만(sync) — 클로드는 안 낀다
use crate::accounts_store::Store;
use crate::team_app::{self as core, KeyRow, Merge, Now, Op, Remote};
use crate::team_locker_app::{self as locker, ShareJob};
use crate::team_relay::{self as relay, Http};
use crate::team_relay_keys::DeviceKeys;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 봉한 기록 평문 상한 — 서버 ct 상한(base64 12000 글자) 안에 들게
const PLAIN_MAX: usize = 8 * 1024;
/// 판이 어긋나 다시 합쳐 보내기 — 세 번까지
const TRIES: usize = 3;

/// 화면에 줄 기록 하나 — why 가 비어 있지 않으면 못 연 줄(data 는 빈 객체)
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Shown {
    pub id: String,
    pub rev: u64,
    pub data: Value,
    /// 마지막으로 쓴 멤버 id
    pub by: String,
    pub at: u64,
    pub del: bool,
    pub deleted_at: Option<u64>,
    pub why: String,
}

/// 팀 하나 앱 하나의 기록장 — 서버 줄과 푼 내용
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Book {
    pub rev: u64,
    pub items: BTreeMap<String, (Remote, Shown)>,
}

/// 화면이 받는 한 장
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snap {
    pub team: String,
    pub rev: u64,
    /// 바뀔 때마다 오르는 이 기기 번호 — 화면이 poll 로 견준다
    pub ver: u64,
    pub items: Vec<Shown>,
    /// 이 팀에서의 내 멤버 id
    pub me: String,
    /// 기기에 봉해 둔 것에서 꺼냈다(새로 받는 중)
    pub cached: bool,
}

/// 쓰기 결과 — lost = 남의 고침을 덮은 칸('*' = 남이 방금 고친 걸 지움), by = 그 사람, gone = 남이 지운 일정이라 안 씀
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct WriteOut {
    pub snap: Snap,
    pub rev: u64,
    pub lost: Vec<String>,
    pub by: String,
    pub gone: bool,
}

impl Book {
    /// 서버 줄을 반영 — 판이 더 새 줄만. 못 연 줄도 why 를 달아 둔다(열쇠가 나중에 오면 다음 sync 에서 다시).
    /// rev(since 커서)는 안 올린다 — 소켓·쓰기 200 의 한 줄이 받지 않은 판 너머로 밀면 그 사이 줄을 영영 못 받는다(0.4.5 리뷰). 커서는 sync 응답의 서버 판만
    pub fn apply(&mut self, team: &str, app: &str, rows: Vec<Remote>, keys: &BTreeMap<String, [u8; 32]>, signers: &BTreeMap<String, String>) -> bool {
        let mut changed = false;
        for r in rows {
            if self.items.get(&r.id).is_some_and(|(old, s)| old.rev >= r.rev && s.why.is_empty()) {
                continue;
            }
            let (data, why) = match core::open_remote(&r, team, app, keys, signers) {
                Ok(v) => (v, String::new()),
                Err(e) => (json!({}), e),
            };
            let s = Shown { id: r.id.clone(), rev: r.rev, data, by: r.by.member.clone(), at: r.at, del: r.del, deleted_at: r.deleted_at, why };
            self.items.insert(r.id.clone(), (r, s));
            changed = true;
        }
        changed
    }

    pub fn shown(&self) -> Vec<Shown> {
        self.items.values().map(|(_, s)| s.clone()).collect()
    }
}

// ── 메모리 — 팀마다 기록장 + 바뀐 번호 + 마지막 열쇠·서명 기기(소켓 반영용) ──

struct Live {
    book: Book,
    ver: u64,
    keys: BTreeMap<String, [u8; 32]>,
    signers: BTreeMap<String, String>,
}

/// 열쇠 = (데이터 폴더, 팀 id, 앱) — 시험 앱·시험 기기 둘이 한 프로세스에 있어도 안 섞이게
type Key = (String, String, String);
fn key(dir: &Path, team: &str, app: &str) -> Key {
    (dir.to_string_lossy().into_owned(), team.to_string(), app.to_string())
}

static LIVE: Mutex<BTreeMap<Key, Live>> = Mutex::new(BTreeMap::new());
static VER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn next_ver() -> u64 {
    VER.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
}

/// 화면이 1초마다 — 이 팀 기록장이 바뀐 번호(망 안 씀)
pub fn ver(dir: &Path, team: &str, app: &str) -> u64 {
    LIVE.lock().unwrap_or_else(|e| e.into_inner()).get(&key(dir, team, app)).map_or(0, |l| l.ver)
}

/// 소켓으로 온 기록째(chammo-relay src/apps.ts announce) — 아는 열쇠로 열어 바로 반영. 기록째가 아니면({id,rev}) 다음 sync 가 받게 판만 표시
pub fn push(dir: &Path, v: &Value) {
    let (team, app) = (v["team"].as_str().unwrap_or(""), v["app"].as_str().unwrap_or(""));
    let Ok(rows) = serde_json::from_value::<Vec<Remote>>(v["items"].clone()) else { return };
    let mut m = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let Some(l) = m.get_mut(&key(dir, team, app)) else { return };
    let full: Vec<Remote> = rows.iter().filter(|r| !r.ct.is_empty()).cloned().collect();
    let behind = rows.iter().any(|r| r.ct.is_empty() && l.book.items.get(&r.id).is_none_or(|(o, _)| o.rev < r.rev));
    if l.book.apply(team, app, full, &l.keys, &l.signers) || behind {
        l.ver = next_ver();
        if behind {
            STALE.lock().unwrap_or_else(|e| e.into_inner()).insert(key(dir, team, app));
        }
    }
}

/// 소켓이 기록째를 못 실어 준 팀 — 화면 poll 이 보고 sync 를 부른다
static STALE: Mutex<BTreeSet<Key>> = Mutex::new(BTreeSet::new());

pub fn stale(dir: &Path, team: &str, app: &str) -> bool {
    STALE.lock().unwrap_or_else(|e| e.into_inner()).contains(&key(dir, team, app))
}

// ── 기기 봉한 캐시 — 열자마자 그리기(team_locker_app::save_view 와 같은 봉하기) ──

fn cache_path(dir: &Path, tid: &str, app: &str) -> PathBuf {
    dir.join("team-apps").join(format!("{tid}-{app}.bin"))
}

fn id_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn save_cache(dir: &Path, k: &DeviceKeys, tid: &str, app: &str, b: &Book) {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    if !id_ok(tid) || !id_ok(app) {
        return;
    }
    let Ok(pt) = serde_json::to_vec(b) else { return };
    let mut nonce = [0u8; 12];
    if getrandom::fill(&mut nonce).is_err() {
        return;
    }
    let aad = format!("{tid}\n{app}");
    let Ok(ct) = aes_gcm::Aes256Gcm::new((&k.local_key("team-app-cache/1")).into()).encrypt(aes_gcm::Nonce::from_slice(&nonce), Payload { msg: &pt, aad: aad.as_bytes() }) else { return };
    let p = cache_path(dir, tid, app);
    let _ = std::fs::create_dir_all(p.parent().unwrap_or(dir));
    let tmp = p.with_extension(format!("tmp-{}", crate::tools::tmp_tag()));
    let mut buf = nonce.to_vec();
    buf.extend(ct);
    #[cfg(unix)]
    let w = {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&tmp).and_then(|mut f| f.write_all(&buf))
    };
    #[cfg(not(unix))]
    let w = std::fs::write(&tmp, &buf);
    if w.is_ok() && std::fs::rename(&tmp, &p).is_ok() {
        return;
    }
    let _ = std::fs::remove_file(&tmp);
}

pub(crate) fn read_cache(dir: &Path, k: &DeviceKeys, tid: &str, app: &str) -> Option<Book> {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    let buf = std::fs::read(cache_path(dir, tid, app)).ok()?;
    if buf.len() < 13 {
        return None;
    }
    let aad = format!("{tid}\n{app}");
    let pt = aes_gcm::Aes256Gcm::new((&k.local_key("team-app-cache/1")).into()).decrypt(aes_gcm::Nonce::from_slice(&buf[..12]), Payload { msg: &buf[12..], aad: aad.as_bytes() }).ok()?;
    serde_json::from_slice(&pt).ok()
}

// ── 망 ──

/// 이 기기 열쇠·상태·팀 id·내 멤버 id
fn ctx(dir: &Path, kc: &dyn Store, team: &str) -> Result<(relay::TeamState, DeviceKeys, String, String), String> {
    let st = relay::load_state(dir);
    if st.account.is_none() || !st.registered() {
        return Err("Chammo 계정에 로그인한 기기에서만 팀 캘린더를 써요".into());
    }
    let k = relay::device_keys(kc, &st)?;
    let t = st.team(team)?;
    let (tid, me) = (t.id.clone(), t.member_id.clone());
    Ok((st, k, tid, me))
}

fn snap(tid: &str, me: &str, l: &Live, cached: bool) -> Snap {
    Snap { team: tid.into(), rev: l.book.rev, ver: l.ver, items: l.book.shown(), me: me.into(), cached }
}

/// 열자마자 — 메모리, 없으면 기기 봉한 캐시(망 안 씀). 처음이면 None
pub fn load(dir: &Path, kc: &dyn Store, team: &str, app: &str) -> Option<Snap> {
    let (_, k, tid, me) = ctx(dir, kc, team).ok()?;
    let mut m = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(l) = m.get(&key(dir, &tid, app)) {
        return Some(snap(&tid, &me, l, false));
    }
    let book = read_cache(dir, &k, &tid, app)?;
    let l = Live { book, ver: next_ver(), keys: BTreeMap::new(), signers: BTreeMap::new() };
    let s = snap(&tid, &me, &l, true);
    m.insert(key(dir, &tid, app), l);
    Some(s)
}

/// 열쇠·서명 기기 — 보관함 목록에서(appkey 줄). 보통은 기억한 것(team_locker_app::app_keys), fresh 면 목록을 새로
struct Keys {
    keys: BTreeMap<String, [u8; 32]>,
    rows: Vec<KeyRow>,
    signers: BTreeMap<String, String>,
    recipients: BTreeSet<String>,
}

fn keys(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, fresh: bool) -> Result<(Keys, ShareJob), String> {
    let (files, p, job) = locker::app_keys(dir, kc, http, team, fresh)?;
    let rows = files.iter().map(|(f, _)| KeyRow { id: f.id.clone(), have: f.have.clone(), created_at: f.created_at }).collect();
    let keys = files.into_iter().map(|(f, k)| (f.id, k)).collect();
    Ok((Keys { keys, rows, signers: p.signers, recipients: p.recipients.into_iter().map(|r| r.device).collect() }, job))
}

fn get_rows(http: &dyn Http, st: &relay::TeamState, k: &DeviceKeys, tid: &str, app: &str, since: u64) -> Result<(u64, bool, Vec<Remote>), String> {
    let path = if since == 0 { format!("/v0/teams/{tid}/apps/{app}") } else { format!("/v0/teams/{tid}/apps/{app}/since/{since}") };
    let (c, v) = relay::call(http, &st.server, k, Some(&st.device_id), "GET", &path, None)?;
    if c != 200 {
        return Err(relay::why(c, &v));
    }
    let rows = serde_json::from_value(v["items"].clone()).map_err(|e| format!("팀 앱 목록 모양이 틀렸어: {e}"))?;
    Ok((v["rev"].as_u64().unwrap_or(0), v["full"].as_bool().unwrap_or(false), rows))
}

/// 따라잡기 — 본 판 뒤 기록만(처음·오래 못 봤으면 통째). 열쇠는 보관함 목록에서, 나중에 든 사람 봉투 더하기는 돌려주는 job 으로
pub fn sync(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, app: &str) -> Result<(Snap, ShareJob), String> {
    let (st, k, tid, me) = ctx(dir, kc, team)?;
    let k_ = key(dir, &tid, app);
    let (seen, unopened) = LIVE.lock().unwrap_or_else(|e| e.into_inner()).get(&k_).filter(|l| !l.keys.is_empty() || l.book.rev > 0).map_or((false, false), |l| (true, l.book.items.values().any(|(_, s)| !s.why.is_empty())));
    // 못 연 줄이 있으면(열쇠가 막 왔을 수 있다) 열쇠도 새로·기록도 통째로 다시
    let (mut ks, mut job) = keys(dir, kc, http, team, unopened)?;
    let since = if seen && !unopened { LIVE.lock().unwrap_or_else(|e| e.into_inner()).get(&k_).map_or(0, |l| l.book.rev) } else { 0 };
    let (rev, full, rows) = get_rows(http, &st, &k, &tid, app, since)?;
    // 기억한 열쇠에 없는 열쇠로 봉한 줄(누가 새 appkey 를 올림) — 열쇠만 한 번 새로
    if !unopened && rows.iter().any(|r| !r.ct.is_empty() && !ks.keys.contains_key(&r.key)) {
        (ks, job) = keys(dir, kc, http, team, true)?;
    }
    let mut m = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let l = m.entry(k_.clone()).or_insert_with(|| Live { book: Book::default(), ver: 0, keys: BTreeMap::new(), signers: BTreeMap::new() });
    if full {
        l.book = Book::default();
    }
    l.keys = ks.keys;
    l.signers = ks.signers;
    l.book.apply(&tid, app, rows, &l.keys, &l.signers);
    l.book.rev = l.book.rev.max(rev);
    l.ver = next_ver();
    STALE.lock().unwrap_or_else(|e| e.into_inner()).remove(&k_);
    save_cache(dir, &k, &tid, app, &l.book);
    Ok((snap(&tid, &me, l, false), job))
}

/// 쓸 열쇠 — 기억한 것에서 못 고르면 목록을 새로 받아 한 번 더, 그래도 없거나 빠진 기기가 든 것뿐이면 새 appkey 줄을 올리고 다시 고른다
fn key_for_write(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, tid: &str, app: &str) -> Result<(String, [u8; 32], BTreeMap<String, String>), String> {
    for fresh in [false, true] {
        let (ks, job) = keys(dir, kc, http, team, fresh)?;
        job.spawn();
        if let Some(id) = core::pick_key(&ks.rows, &ks.recipients) {
            return Ok((id.clone(), ks.keys[&id], ks.signers));
        }
    }
    let body = serde_json::to_vec(&json!({ "t": "appkey", "app": app, "v": 1 })).map_err(|e| e.to_string())?;
    crate::team_profile::put(dir, kc, http, tid, "appkey", "appkey.json", &body)?;
    let (ks, _) = keys(dir, kc, http, team, true)?;
    let id = core::pick_key(&ks.rows, &ks.recipients).ok_or("팀 앱 열쇠를 못 만들었어 — 잠시 뒤 다시")?;
    Ok((id.clone(), ks.keys[&id], ks.signers))
}

/// 쓰기에서 받은 서버 줄 하나를 기록장에 — 쓴 열쇠·서명 기기도 기억(소켓 반영용)
#[allow(clippy::too_many_arguments)]
fn keep(dir: &Path, k: &DeviceKeys, tid: &str, me: &str, app: &str, r: Remote, (key_id, kk): (&str, [u8; 32]), signers: &BTreeMap<String, String>) -> Snap {
    let mut m = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let l = m.entry(key(dir, tid, app)).or_insert_with(|| Live { book: Book::default(), ver: 0, keys: BTreeMap::new(), signers: BTreeMap::new() });
    l.keys.insert(key_id.to_string(), kk);
    l.signers = signers.clone();
    l.book.apply(tid, app, vec![r], &l.keys, &l.signers);
    l.ver = next_ver();
    save_cache(dir, k, tid, app, &l.book);
    snap(tid, me, l, false)
}

/// 쓰기 — base = 화면이 고치기 시작한 판(0 = 새로), before = 그때 내용, data None = 지우기, restore = 지운 일정 다시 살리기.
/// 판이 어긋나면(409) 지금 기록과 칸마다 합쳐 세 번까지
#[allow(clippy::too_many_arguments)]
pub fn write(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, app: &str, id: &str, base: u64, before: Option<Value>, data: Option<Value>, restore: bool) -> Result<WriteOut, String> {
    if !id_ok(id) {
        return Err("기록 id 모양이 아니야".into());
    }
    let (st, k, tid, me) = ctx(dir, kc, team)?;
    let (key_id, kk, signers) = key_for_write(dir, kc, http, team, &tid, app)?;
    let ik = core::item_key(&kk, &tid, app);
    let op = match data {
        Some(d) if d.is_object() => Op::Put(d),
        Some(_) => return Err("기록은 객체여야 해".into()),
        None => Op::Del,
    };
    let (mut base, mut lost, mut by) = (base, vec![], String::new());
    let (mut body, mut del) = match &op {
        Op::Put(d) => (d.clone(), false),
        Op::Del => (before.clone().unwrap_or(json!({})), true),
    };
    let mut prev = before.clone();
    for _ in 0..TRIES {
        if !del {
            core::stamp(&mut body, prev.as_ref(), &me, relay::now_ms());
        }
        let pt = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
        if pt.len() > PLAIN_MAX {
            return Err("일정 내용이 너무 길어 — 메모를 줄여 줘".into());
        }
        let ct = core::seal(&ik, &tid, app, id, &pt);
        let sig = k.sign(&core::sig_text(&tid, app, id, base, &key_id, &ct, del));
        let req = json!({ "base": base, "key": key_id, "ct": ct, "sig": sig, "del": del });
        let (c, v) = relay::call(http, &st.server, &k, Some(&st.device_id), "POST", &format!("/v0/teams/{tid}/apps/{app}/items/{id}"), Some(&req))?;
        if c == 200 {
            let rev = v["rev"].as_u64().unwrap_or(0);
            let r = Remote { id: id.into(), rev, base, key: key_id.clone(), ct, sig, by: core::By { member: me.clone(), device: st.device_id.clone() }, at: relay::now_ms(), del, deleted_at: del.then(relay::now_ms) };
            let snap = keep(dir, &k, &tid, &me, app, r, (&key_id, kk), &signers);
            return Ok(WriteOut { snap, rev, lost, by, gone: false });
        }
        if c != 409 || v["error"] != "stale" {
            return Err(relay::why(c, &v));
        }
        // 판이 어긋남 — 지금 기록을 열어 칸마다 합친다
        let now = if v["item"].is_null() {
            None
        } else {
            let r: Remote = serde_json::from_value(v["item"].clone()).map_err(|e| e.to_string())?;
            let mut keys = BTreeMap::from([(key_id.clone(), kk)]);
            if let Some(l) = LIVE.lock().unwrap_or_else(|e| e.into_inner()).get(&key(dir, &tid, app)) {
                keys.extend(l.keys.clone());
            }
            let data = core::open_remote(&r, &tid, app, &keys, &signers)?;
            Some((r, data))
        };
        let Some((r, now_data)) = now else {
            // 서버에 없는 기록(30일 지난 무덤이 치워짐) — 새로 쓴다
            base = 0;
            prev = None;
            continue;
        };
        match core::merge(before.as_ref(), &op, &Now { data: now_data.clone(), del: r.del, by: r.by.member.clone() }, restore) {
            Merge::Gone { by } => {
                // 받은 삭제 줄을 기록장에 — 안 하면 '다시 살리기' 알림인데 화면엔 살아 있다(0.4.5 리뷰)
                let rev = r.rev;
                let snap = keep(dir, &k, &tid, &me, app, r, (&key_id, kk), &signers);
                return Ok(WriteOut { snap, rev, lost: vec![], by, gone: true });
            }
            Merge::Write { data, del: d, lost: l, by: b } => {
                body = data;
                del = d;
                lost = l;
                by = b;
                base = r.rev;
                prev = Some(now_data);
            }
        }
    }
    Err("다른 팀원이 계속 고치는 중이야 — 잠시 뒤 다시".into())
}

#[cfg(test)]
#[path = "team_app_store_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "team_app_live_tests.rs"]
mod live;
