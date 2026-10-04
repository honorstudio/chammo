//! 계정 칸 — 화면이 부르는 명령. 로그인 칸 자리는 환경 변수로 바꿀 수 있다(시험 앱이 실제 Claude Code 로그인을 안 건드리게):
//! CHAMMO_ACCOUNT_LIVE_SERVICE(키체인 서비스) · CHAMMO_ACCOUNT_CLAUDE_JSON(oauthAccount 파일) · CHAMMO_ACCOUNT_KEYCHAIN(키체인 파일)
//! · CHAMMO_ACCOUNT_KEYCHAIN_PASSWORD(시험 키체인 비밀번호 — 없으면 시험 키체인이 잠겼을 때 사람 화면에 창이 뜬다)
use crate::accounts::{self, Live, Pool};
use crate::accounts_store::Keychain;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const LIVE_SERVICE: &str = "Claude Code-credentials";

/// 바꿔 끼우기는 한 번에 하나만
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub id: String,
    pub name: String,
    pub email: String,
    pub plan: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub accounts: Vec<Row>,
    /// 지금 로그인과 같은 계정 칸(~/.claude.json 의 oauthAccount 로 — 키체인은 안 읽는다, 위쪽 막대가 자주 부른다)
    pub active: Option<String>,
    /// 지금 로그인 이메일 — 칸에 없는 계정이어도
    pub live_email: Option<String>,
    pub live_plan: Option<String>,
    /// 자동 전환 상태 그대로(domain/accountAuto.ts 가 읽고 쓴다)
    pub auto: Value,
}

fn same(a: &Value, b: &Value) -> bool {
    let k = |v: &Value| (v.get("accountUuid").cloned(), v.get("organizationUuid").cloned());
    a.get("accountUuid").is_some() && k(a) == k(b)
}

pub fn view(pool: &Pool, live_oauth: Option<&Value>) -> View {
    let active = live_oauth.and_then(|o| pool.accounts.iter().find(|a| same(&a.oauth, o))).map(|a| a.id.clone());
    View {
        accounts: pool.accounts.iter().map(|a| Row { id: a.id.clone(), name: a.name.clone(), email: a.email.clone(), plan: a.plan.clone() }).collect(),
        active,
        live_email: live_oauth.and_then(|o| o.get("emailAddress")).and_then(Value::as_str).map(str::to_string),
        live_plan: live_oauth.map(|o| accounts::plan_of(o).0).filter(|p| !p.is_empty()),
        auto: pool.auto.clone(),
    }
}

/// 로그인 칸 자리. CLAUDE_CONFIG_DIR 를 쓰면 Claude Code 의 키체인 이름이 달라지는데 그 규칙은 아직 안 봤다 — 막는다
pub fn live_paths(home: &Path, config_dir: Option<&str>, json_env: Option<&str>, service_env: Option<&str>) -> Result<(String, PathBuf), String> {
    let service = service_env.filter(|s| !s.is_empty());
    if config_dir.is_some_and(|d| !d.is_empty()) && service.is_none() {
        return Err("configDir".into());
    }
    let json = json_env.filter(|s| !s.is_empty()).map(PathBuf::from).unwrap_or_else(|| home.join(".claude.json"));
    Ok((service.unwrap_or(LIVE_SERVICE).to_string(), json))
}

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok()
}

fn paths() -> Result<(String, PathBuf), String> {
    if !cfg!(target_os = "macos") {
        return Err("macOnly".into());
    }
    live_paths(Path::new(&crate::config::home()), env("CLAUDE_CONFIG_DIR").as_deref(), env("CHAMMO_ACCOUNT_CLAUDE_JSON").as_deref(), env("CHAMMO_ACCOUNT_LIVE_SERVICE").as_deref())
}

fn setup() -> Result<(Keychain, Live, PathBuf), String> {
    let (service, claude_json) = paths()?;
    let keychain = env("CHAMMO_ACCOUNT_KEYCHAIN").filter(|s| !s.is_empty());
    // 시험 키체인 비밀번호 — 명령마다 잠금을 풀어 비밀번호 창이 안 뜨게(시험 키체인일 때만 쓴다)
    let unlock = keychain.as_ref().and(env("CHAMMO_ACCOUNT_KEYCHAIN_PASSWORD"));
    // 시험 키체인이면 macOS 창을 아예 못 띄우게(잠김·허용 필요는 오류로)
    let quiet = keychain.is_some();
    // 로그인 칸은 security 명령으로만 — 프레임워크로 건드리면 허용 창이 연달아 떴다(accounts_store 머리말)
    let kc = Keychain { path: keychain, unlock, quiet, cli_service: Some(service.clone()) };
    // 키체인 계정 이름은 지금 칸에 붙은 것 그대로(값은 안 읽는다). 칸이 없으면 맥 사용자 이름 — Claude Code 와 같은 규칙
    let account = kc.account_of(&service).or_else(|| env("USER")).unwrap_or_default();
    Ok((kc, Live { service, account, claude_json }, crate::config::data_file("accounts.json")))
}

/// 무거운 일(키체인)은 뒤에서, 한 번에 하나만
async fn run<F>(f: F) -> Result<View, String>
where
    F: FnOnce(&Keychain, &Live, &Path) -> Result<(), accounts::Error> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (kc, live, list) = setup()?;
        f(&kc, &live, &list).map_err(|e| e.code())?;
        let pool = accounts::load(&list).map_err(|e| e.code())?;
        Ok(view(&pool, accounts::read_oauth(&live.claude_json).as_ref()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn accounts_view() -> Result<View, String> {
    let (_, claude_json) = paths()?;
    let pool = accounts::load(&crate::config::data_file("accounts.json")).map_err(|e| e.code())?;
    Ok(view(&pool, accounts::read_oauth(&claude_json).as_ref()))
}

/// 지금 로그인을 칸으로(같은 계정 칸이 있으면 갱신)
#[tauri::command]
pub async fn accounts_capture(name: Option<String>) -> Result<View, String> {
    let id = format!("a{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    run(move |kc, live, list| accounts::capture(kc, live, list, name.as_deref(), &id).map(|_| ())).await
}

#[tauri::command]
pub async fn accounts_switch(id: String) -> Result<View, String> {
    run(move |kc, live, list| accounts::switch(kc, live, list, &id).map(|_| ())).await
}

#[tauri::command]
pub async fn accounts_rename(id: String, name: String) -> Result<View, String> {
    run(move |_, _, list| accounts::rename(list, &id, &name).map(|_| ())).await
}

#[tauri::command]
pub async fn accounts_reorder(ids: Vec<String>) -> Result<View, String> {
    run(move |_, _, list| accounts::reorder(list, &ids).map(|_| ())).await
}

/// 자동 전환 상태 윗단 키 합치기 — 바꿔 끼우기와 같은 줄에 서서(LOCK) 서로 덮지 않게
#[tauri::command]
pub async fn accounts_auto_patch(patch: Value) -> Result<View, String> {
    run(move |_, _, list| accounts::patch_auto(list, &patch).map(|_| ())).await
}

/// 칸마다 사용량을 그 계정 토큰으로 바로 묻는다(accounts_usage.rs). live = 지금 로그인 칸도 — 그 값은 칸 id 로(칸에 없는 로그인이면 "live").
/// 목록에 있는 칸 id 만 — 백업 칸 등 다른 키체인 값은 안 꺼낸다. 토큰은 이 함수 밖으로 안 나가고, 결과엔 퍼센트·시각만.
/// 시험 앱은 CHAMMO_ACCOUNT_USAGE_URL 로 가짜 주소
#[tauri::command]
pub async fn accounts_usage(ids: Vec<String>, live: bool) -> Result<Vec<crate::accounts_usage::Got>, String> {
    use crate::accounts_usage::{ask, fetch, DEFAULT_URL};
    use crate::accounts_store::Store;
    tauri::async_runtime::spawn_blocking(move || {
        let (kc, l, list) = setup()?;
        // 키체인은 바꿔 끼우기와 같은 줄에 서서 읽는다(바꾸는 도중 값을 안 읽게). 묻는 건 줄 밖에서
        let secrets = {
            let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let pool = accounts::load(&list).map_err(|e| e.code())?;
            let mut v = Vec::new();
            if live {
                // 지금 로그인 값의 주인 = 같은 잠금 안에서 읽은 로그인 표시(oauthAccount)의 칸. 바꿔 끼우기도 이 잠금 안에서 둘을 바꾼다
                let who = view(&pool, accounts::read_oauth(&l.claude_json).as_ref()).active.unwrap_or_else(|| "live".into());
                v.push((who, kc.get(&l.service, &l.account).ok().flatten()));
            }
            for id in ids.iter().filter(|id| pool.accounts.iter().any(|a| &a.id == *id)) {
                v.push((id.clone(), kc.get(accounts::SLOT_SERVICE, id).ok().flatten()));
            }
            v
        };
        let url = env("CHAMMO_ACCOUNT_USAGE_URL").filter(|u| !u.is_empty()).unwrap_or_else(|| DEFAULT_URL.into());
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        Ok(secrets.iter().map(|(who, sec)| ask(who, sec.as_ref(), now, &url, fetch)).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn accounts_remove(id: String) -> Result<View, String> {
    run(move |kc, _, list| accounts::remove(kc, list, &id).map(|_| ())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::Account;
    use serde_json::json;

    #[test]
    fn 로그인_칸_자리() {
        let h = Path::new("/Users/me");
        assert_eq!(live_paths(h, None, None, None).unwrap(), (LIVE_SERVICE.to_string(), PathBuf::from("/Users/me/.claude.json")));
        // 시험 앱은 가짜 자리로
        assert_eq!(live_paths(h, None, Some("/tmp/c.json"), Some("Chammo test live")).unwrap(), ("Chammo test live".to_string(), PathBuf::from("/tmp/c.json")));
        assert_eq!(live_paths(h, Some("/x"), None, None).unwrap_err(), "configDir");
        assert!(live_paths(h, Some("/x"), None, Some("S")).is_ok());
    }

    #[test]
    fn 보기는_지금_로그인_계정을_칸에서_찾는다() {
        let a = json!({ "accountUuid": "u1", "organizationUuid": "o1", "emailAddress": "a@x.com", "organizationRateLimitTier": "default_claude_max_5x" });
        let pool = Pool { accounts: vec![Account { id: "a1".into(), name: "작은 것".into(), email: "a@x.com".into(), plan: "Max 5x".into(), order: 0, oauth: a.clone() }], current: None, switching: None, auto: Value::Null };
        let v = view(&pool, Some(&a));
        assert_eq!(v.active.as_deref(), Some("a1"));
        assert_eq!(v.live_plan.as_deref(), Some("Max 5x"));
        let other = json!({ "accountUuid": "u2", "emailAddress": "b@x.com" });
        let v = view(&pool, Some(&other));
        assert_eq!((v.active, v.live_email.as_deref()), (None, Some("b@x.com")));
        // 보기에 oauth 원본은 안 나간다
        assert!(!serde_json::to_string(&view(&pool, None)).unwrap().contains("organizationUuid"));
    }
}
