//! 계정 여러 개 — 칸마다 로그인 정보를 키체인에 따로 보관해 두고, Claude Code 로그인 칸에 바꿔 끼운다(docs/plans/2026-10-02-account-pool.md).
//! 한 폴더(~/.claude)를 그대로 쓰고 로그인만 바꾼다: 키체인 `Claude Code-credentials` + `~/.claude.json` 의 `oauthAccount`.
//! 칸 목록(이름·이메일·요금제·순서)은 데이터 폴더 accounts.json, 토큰은 키체인 `Chammo account` / 칸 id 에만 있다.
//!
//! 바꿔 끼우는 순서(도중에 꺼져도 이름 붙은 칸이 남의 토큰으로 덮이지 않게):
//! 1 고른 칸이 있나 본다 → 2 지금 로그인을 백업 칸과 지금 칸에 다시 저장(쓰다 보면 갱신된다)
//! → 3 목록에 '바꾸는 중(from→to)'을 적고 지금 칸을 비운다 → 4 고른 칸을 로그인 칸에 쓴다 → 5 oauthAccount 병합 → 6 지금 칸 = 고른 칸.
//! 4·5 가 실패하면 되돌린다. 3 과 6 사이에 꺼지면 다음에 열 때 로그인 칸 값을 두 칸과 맞대 어느 쪽인지 정한다(reconcile)
//!
//! 로그인 칸 덩어리엔 계정 로그인(claudeAiOauth, ~500자) 말고 MCP 로그인(mcpOAuth, 11KB)도 들어 있다(2026-10-02 실측).
//! MCP 로그인은 계정과 무관하다 — 칸에는 계정 로그인만 보관하고, 바꿔 끼울 땐 지금 덩어리에서 그 부분만 갈아 끼운다(MCP 로그인은 그대로).
//! 백업 칸 둘은 덩어리 통째로
use crate::accounts_store::{Secret, Store, StoreError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const SLOT_SERVICE: &str = "Chammo account";
/// 처음 바꿔 끼우기 전 로그인 — 한 번만 쓴다
pub const BACKUP_FIRST: &str = "backup-first";
/// 바꿔 끼우기 직전 로그인 — 매번 덮는다
pub const BACKUP_LAST: &str = "backup-last";

/// Claude Code 로그인 칸(키체인 서비스·계정 이름)과 oauthAccount 가 든 파일
pub struct Live {
    pub service: String,
    pub account: String,
    pub claude_json: PathBuf,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub email: String,
    /// 사람이 읽는 요금제 — "Max 5x" 등
    pub plan: String,
    /// 작을수록 먼저 쓴다
    pub order: u32,
    /// ~/.claude.json 의 oauthAccount 그대로 — 바꿔 끼울 때 병합한다(토큰 아님)
    pub oauth: Value,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Switching {
    pub from: Option<String>,
    pub to: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Pool {
    pub accounts: Vec<Account>,
    /// 지금 로그인 칸에 든 계정 — 모르면 None(그땐 이름 붙은 칸에 지금 로그인을 안 쓴다)
    pub current: Option<String>,
    pub switching: Option<Switching>,
    /// 자동 전환 상태(켜짐·고정·칸별 마지막 사용량·다시 열리는 시각) — 판단은 화면 쪽 domain/accountAuto.ts, 여기선 보관만
    #[serde(skip_serializing_if = "Value::is_null")]
    pub auto: Value,
}

#[derive(Debug, PartialEq)]
pub enum Error {
    NotLoggedIn,
    NoOauth,
    Unknown,
    NoSlot,
    /// 지금 로그인이 다른 칸의 것과 똑같다 — 로그인이 바뀌는 도중일 수 있어 보관하지 않는다
    Mismatch,
    Locked,
    /// macOS 허용 창에서 거절·닫음
    Denied,
    Store(String),
    Io(String),
}

impl Error {
    /// 화면이 글로 바꾸는 짧은 이름
    pub fn code(&self) -> String {
        match self {
            Error::NotLoggedIn => "notLoggedIn".into(),
            Error::NoOauth => "noOauth".into(),
            Error::Unknown => "unknown".into(),
            Error::NoSlot => "noSlot".into(),
            Error::Mismatch => "mismatch".into(),
            Error::Locked => "locked".into(),
            Error::Denied => "denied".into(),
            Error::Store(m) => format!("store:{m}"),
            Error::Io(m) => format!("io:{m}"),
        }
    }
}

impl From<StoreError> for Error {
    fn from(e: StoreError) -> Self {
        match e {
            StoreError::Locked => Error::Locked,
            StoreError::Denied => Error::Denied,
            StoreError::Failed(m) => Error::Store(m),
        }
    }
}

fn io(e: impl std::fmt::Display) -> Error {
    Error::Io(e.to_string())
}

/// 요금제 등급 글 → (보이는 이름, 작은 순 번호)
pub fn plan_of(oauth: &Value) -> (String, u32) {
    let tier = oauth.get("organizationRateLimitTier").or_else(|| oauth.get("userRateLimitTier")).and_then(Value::as_str).unwrap_or("");
    if tier.contains("max_20x") {
        ("Max 20x".into(), 3)
    } else if tier.contains("max_5x") {
        ("Max 5x".into(), 2)
    } else if tier.contains("pro") {
        ("Pro".into(), 1)
    } else {
        (tier.to_string(), 4)
    }
}

/// 같은 계정인가 — 사람 하나가 조직 여럿에 있을 수 있어 둘 다 본다
fn key(oauth: &Value) -> Option<(String, String)> {
    let a = oauth.get("accountUuid")?.as_str()?.to_string();
    let o = oauth.get("organizationUuid").and_then(Value::as_str).unwrap_or("").to_string();
    Some((a, o))
}

// ── 파일 ─────────────────────────────────────────────

pub fn load(path: &Path) -> Result<Pool, Error> {
    match std::fs::read_to_string(path) {
        Ok(t) => serde_json::from_str(&t).map_err(io), // 깨졌으면 덮어쓰지 않게 멈춘다
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Pool::default()),
        Err(e) => Err(io(e)),
    }
}

/// 옆에 다 쓴 뒤 이름을 바꿔 끼운다. 원래 권한을 물려주고, 새 파일이면 600(남이 못 읽게). 링크면 가리키는 파일을 바꾼다
pub fn write_atomic(file: &Path, content: &str) -> Result<(), Error> {
    let target = if file.is_symlink() { std::fs::canonicalize(file).map_err(io)? } else { file.to_path_buf() };
    if let Some(d) = target.parent() {
        std::fs::create_dir_all(d).map_err(io)?;
    }
    let mut name = target.file_name().unwrap_or_default().to_os_string();
    name.push(".chammo-tmp");
    let tmp = target.with_file_name(name);
    std::fs::write(&tmp, content).map_err(io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perm = std::fs::metadata(&target).map(|m| m.permissions()).unwrap_or_else(|_| std::fs::Permissions::from_mode(0o600));
        std::fs::set_permissions(&tmp, perm).map_err(io)?;
    }
    std::fs::rename(&tmp, &target).map_err(io)
}

pub fn save(path: &Path, pool: &Pool) -> Result<(), Error> {
    write_atomic(path, &(serde_json::to_string_pretty(pool).map_err(io)? + "\n"))
}

pub fn read_oauth(claude_json: &Path) -> Option<Value> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(claude_json).ok()?).ok()?;
    v.get("oauthAccount").filter(|o| o.is_object()).cloned()
}

/// oauthAccount 만 바꾸고 다른 키·순서는 그대로. Claude Code 도 이 파일을 수시로 쓰니 —
/// 다 만든 뒤 다시 읽어 그새 바뀌었으면 처음부터(세 번까지), 같으면 바꿔 끼운다
pub fn merge_oauth(claude_json: &Path, oauth: &Value) -> Result<(), Error> {
    for _ in 0..3 {
        let before = std::fs::read_to_string(claude_json).map_err(io)?;
        let mut v: Value = serde_json::from_str(&before).map_err(io)?;
        let obj = v.as_object_mut().ok_or_else(|| io("~/.claude.json 이 객체가 아니에요"))?;
        if obj.get("oauthAccount") == Some(oauth) {
            return Ok(());
        }
        obj.insert("oauthAccount".into(), oauth.clone());
        let text = serde_json::to_string_pretty(&v).map_err(io)?;
        if std::fs::read_to_string(claude_json).map_err(io)? == before {
            return write_atomic(claude_json, &text);
        }
    }
    Err(io("~/.claude.json 이 계속 바뀌어 쓰지 못했어요"))
}

// ── 로그인 덩어리 ─────────────────────────────────────

/// 덩어리에서 계정 로그인(claudeAiOauth)만
pub fn part(s: &Secret) -> Option<Value> {
    serde_json::from_str::<Value>(s.expose()).ok()?.get("claudeAiOauth").filter(|v| v.is_object()).cloned()
}

/// 칸에 보관하는 모양 — 계정 로그인만
fn slot_secret(p: &Value) -> Secret {
    Secret::new(serde_json::json!({ "claudeAiOauth": p }).to_string())
}

fn slot_part(store: &dyn Store, id: &str) -> Result<Option<Value>, Error> {
    Ok(store.get(SLOT_SERVICE, id)?.as_ref().and_then(part))
}

/// 지금 덩어리에 계정 로그인만 갈아 끼운 새 덩어리 — 다른 키(MCP 로그인 등)·순서 그대로. 지금 것이 없거나 깨졌으면 계정 로그인만
pub fn with_part(now: Option<&Secret>, p: &Value) -> Secret {
    let mut v = now.and_then(|n| serde_json::from_str::<Value>(n.expose()).ok()).filter(Value::is_object).unwrap_or_else(|| serde_json::json!({}));
    v["claudeAiOauth"] = p.clone();
    Secret::new(v.to_string())
}

// ── 동작 ─────────────────────────────────────────────

fn slot<'a>(pool: &'a Pool, id: &str) -> Option<&'a Account> {
    pool.accounts.iter().find(|a| a.id == id)
}

fn sorted(pool: &mut Pool) {
    pool.accounts.sort_by_key(|a| a.order);
    for (i, a) in pool.accounts.iter_mut().enumerate() {
        a.order = i as u32;
    }
}

/// 도중에 꺼진 바꿔 끼우기를 마무리하고, 지금 칸이 실제 로그인과 맞는지 본다. 바뀐 게 있으면 저장한다
pub fn reconcile(store: &dyn Store, live: &Live, list: &Path, pool: &mut Pool) -> Result<(), Error> {
    let before = pool.clone();
    let now = store.get(&live.service, &live.account)?.as_ref().and_then(part);
    // 바꾸던 중인데 로그인 칸이 어느 쪽과도 안 맞으면 — 누가 쓴 토큰인지 모르니 이번엔 칸을 맡지도 않는다
    let mut ambiguous = false;
    if let Some(sw) = pool.switching.take() {
        let to = slot_part(store, &sw.to)?;
        let from = match &sw.from { Some(f) => slot_part(store, f)?, None => None };
        pool.current = None;
        let pick = if now.is_some() && now == to { Some(sw.to) } else if now.is_some() && now == from { sw.from } else { None };
        if let Some(acc) = pick.as_deref().and_then(|id| slot(pool, id)) {
            merge_oauth(&live.claude_json, &acc.oauth)?;
            pool.current = pick;
        } else {
            ambiguous = true;
        }
    }
    let live_key = read_oauth(&live.claude_json).as_ref().and_then(key);
    // 사람이 밖에서 로그인을 바꿨으면(claude auth login) 지금 칸은 모른다
    if let Some(c) = pool.current.clone() {
        if now.is_none() || slot(pool, &c).and_then(|a| key(&a.oauth)) != live_key {
            pool.current = None;
        }
    }
    // 모르는데 로그인이 칸 하나와 같은 계정이면 그 칸으로 — 새 토큰도 그 칸에 보관
    if pool.current.is_none() && !ambiguous {
        if let (Some(n), Some(k)) = (&now, &live_key) {
            if let Some(id) = pool.accounts.iter().find(|a| key(&a.oauth).as_ref() == Some(k)).map(|a| a.id.clone()) {
                // 그 로그인이 다른 칸 토큰과 같으면 키체인과 oauthAccount 가 어긋난 것 — 맡지 않는다
                let mut clash = false;
                for a in pool.accounts.iter().filter(|a| a.id != id) {
                    clash |= slot_part(store, &a.id)?.as_ref() == Some(n);
                }
                if !clash {
                    store.set(SLOT_SERVICE, &id, &slot_secret(n))?;
                    pool.current = Some(id);
                }
            }
        }
    }
    if *pool != before {
        save(list, pool)?;
    }
    Ok(())
}

/// 지금 로그인을 칸으로 보관 — 같은 계정 칸이 있으면 그 칸을 갱신, 없으면 새 칸. (칸 id, 새로 만들었나)
pub fn capture(store: &dyn Store, live: &Live, list: &Path, name: Option<&str>, new_id: &str) -> Result<(Pool, String, bool), Error> {
    let mut pool = load(list)?;
    reconcile(store, live, list, &mut pool)?;
    let now = store.get(&live.service, &live.account)?.as_ref().and_then(part).ok_or(Error::NotLoggedIn)?;
    let oauth = read_oauth(&live.claude_json).ok_or(Error::NoOauth)?;
    let k = key(&oauth).ok_or(Error::NoOauth)?;
    let found = pool.accounts.iter().position(|a| key(&a.oauth).as_ref() == Some(&k));
    // 지금 로그인이 다른 계정 칸의 토큰과 같으면 — 키체인과 oauthAccount 가 서로 다른 계정을 가리키는 중이다
    for a in pool.accounts.iter().filter(|a| Some(&a.id) != found.map(|i| &pool.accounts[i].id)) {
        if slot_part(store, &a.id)?.as_ref() == Some(&now) {
            return Err(Error::Mismatch);
        }
    }
    let (plan, rank) = plan_of(&oauth);
    let email = oauth.get("emailAddress").and_then(Value::as_str).unwrap_or("").to_string();
    let (id, created) = match found {
        Some(i) => {
            let a = &mut pool.accounts[i];
            a.oauth = oauth;
            a.email = email;
            a.plan = plan;
            if let Some(n) = name.map(str::trim).filter(|n| !n.is_empty()) {
                a.name = n.to_string();
            }
            (a.id.clone(), false)
        }
        None => {
            // 기본 순서 = 요금제 작은 순 — 나보다 큰 요금제 앞에 끼운다
            let at = pool.accounts.iter().position(|a| plan_of(&a.oauth).1 > rank).unwrap_or(pool.accounts.len());
            let order = if at < pool.accounts.len() { pool.accounts[at].order } else { pool.accounts.len() as u32 };
            for a in pool.accounts.iter_mut().filter(|a| a.order >= order) {
                a.order += 1;
            }
            let default_name = email.split('@').next().unwrap_or("").to_string();
            let name = name.map(str::trim).filter(|n| !n.is_empty()).map(str::to_string).unwrap_or(default_name);
            pool.accounts.push(Account { id: new_id.to_string(), name, email, plan, order, oauth });
            (new_id.to_string(), true)
        }
    };
    if let Err(e) = store.set(SLOT_SERVICE, &id, &slot_secret(&now)) {
        // 새 칸이면 반쯤 쓰인 칸이 남지 않게(2026-10-02 잘린 값으로 칸이 생기고 실패했다)
        if created {
            let _ = store.remove(SLOT_SERVICE, &id);
        }
        return Err(e.into());
    }
    pool.current = Some(id.clone());
    sorted(&mut pool);
    save(list, &pool)?;
    Ok((pool, id, created))
}

/// 고른 칸으로 바꿔 끼운다
pub fn switch(store: &dyn Store, live: &Live, list: &Path, id: &str) -> Result<Pool, Error> {
    let mut pool = load(list)?;
    reconcile(store, live, list, &mut pool)?;
    let target = slot(&pool, id).cloned().ok_or(Error::Unknown)?;
    if pool.current.as_deref() == Some(id) {
        return Ok(pool);
    }
    let want = slot_part(store, id)?.ok_or(Error::NoSlot)?;
    let now = store.get(&live.service, &live.account)?;
    let from = pool.current.clone();
    if let Some(n) = &now {
        if store.get(SLOT_SERVICE, BACKUP_FIRST)?.is_none() {
            store.set(SLOT_SERVICE, BACKUP_FIRST, n)?;
        }
        store.set(SLOT_SERVICE, BACKUP_LAST, n)?;
        if let (Some(c), Some(p)) = (&from, part(n)) {
            store.set(SLOT_SERVICE, c, &slot_secret(&p))?; // reconcile 이 지금 칸 = 실제 로그인 계정임을 확인했다
        }
    }
    pool.current = None;
    pool.switching = Some(Switching { from: from.clone(), to: id.to_string() });
    save(list, &pool)?;
    let undo = |pool: &mut Pool| -> Result<(), Error> {
        pool.switching = None;
        pool.current = from.clone();
        save(list, pool)
    };
    // 계정 로그인만 갈아 끼운다 — MCP 로그인 등 나머지는 지금 덩어리 그대로
    if let Err(e) = store.set(&live.service, &live.account, &with_part(now.as_ref(), &want)) {
        undo(&mut pool)?;
        return Err(e.into());
    }
    if let Err(e) = merge_oauth(&live.claude_json, &target.oauth) {
        // 로그인 칸을 원래대로 — 되돌리기도 실패하면 '바꾸는 중'을 남겨 다음 reconcile 이 정하게
        let back = match &now { Some(n) => store.set(&live.service, &live.account, n), None => store.remove(&live.service, &live.account) };
        if back.is_ok() {
            undo(&mut pool)?;
        }
        return Err(e);
    }
    pool.switching = None;
    pool.current = Some(id.to_string());
    save(list, &pool)?;
    Ok(pool)
}

/// 자동 상태 윗단 키만 합친다(null 이면 그 키 지움). 화면이 보내는 값이라 모양·크기를 본다
pub fn patch_auto(list: &Path, patch: &Value) -> Result<Pool, Error> {
    let obj = patch.as_object().ok_or_else(|| io("자동 상태는 객체여야 해요"))?;
    if patch.to_string().len() > 64 * 1024 {
        return Err(io("자동 상태가 너무 커요"));
    }
    let mut pool = load(list)?;
    if !pool.auto.is_object() {
        pool.auto = Value::Object(Default::default());
    }
    let auto = pool.auto.as_object_mut().expect("방금 객체로 만들었다");
    for (k, v) in obj {
        if v.is_null() {
            auto.remove(k);
        } else {
            auto.insert(k.clone(), v.clone());
        }
    }
    save(list, &pool)?;
    Ok(pool)
}

pub fn rename(list: &Path, id: &str, name: &str) -> Result<Pool, Error> {
    let mut pool = load(list)?;
    let a = pool.accounts.iter_mut().find(|a| a.id == id).ok_or(Error::Unknown)?;
    a.name = name.trim().to_string();
    save(list, &pool)?;
    Ok(pool)
}

/// 화면이 준 순서대로. 목록에 없는 id 는 무시하고, 빠진 칸은 뒤에 그대로
pub fn reorder(list: &Path, ids: &[String]) -> Result<Pool, Error> {
    let mut pool = load(list)?;
    let n = ids.len() as u32;
    for a in pool.accounts.iter_mut() {
        a.order = ids.iter().position(|x| *x == a.id).map(|i| i as u32).unwrap_or(n + a.order);
    }
    sorted(&mut pool);
    save(list, &pool)?;
    Ok(pool)
}

/// 칸 빼기 — 보관해 둔 토큰만 지운다(지금 로그인은 그대로)
pub fn remove(store: &dyn Store, list: &Path, id: &str) -> Result<Pool, Error> {
    let mut pool = load(list)?;
    if slot(&pool, id).is_none() {
        return Err(Error::Unknown);
    }
    store.remove(SLOT_SERVICE, id)?;
    pool.accounts.retain(|a| a.id != id);
    if pool.current.as_deref() == Some(id) {
        pool.current = None;
    }
    sorted(&mut pool);
    save(list, &pool)?;
    Ok(pool)
}

#[cfg(test)]
#[path = "accounts_tests.rs"]
mod tests;
