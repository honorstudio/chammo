//! 계정 바꿔 끼우기 — 실제 키체인 대신 가짜 저장소, ~/.claude.json 대신 임시 파일
use super::*;
use crate::accounts_store::fake::Fake;
use serde_json::json;

const LIVE: &str = "Claude Code-credentials";

/// 실제 모양의 로그인 덩어리 — 계정 로그인 + MCP 로그인(실제는 11KB, 여기선 12KB)
fn blob(tok: &str, mcp: &str) -> String {
    format!("{{\"claudeAiOauth\":{{\"accessToken\":\"{tok}\",\"refreshToken\":\"r-{tok}\"}},\"mcpOAuth\":{{\"tag\":\"{mcp}\",\"pad\":\"{}\"}}}}", "x".repeat(12 * 1024))
}

/// 덩어리에서 (accessToken, mcp tag)
fn read(v: &str) -> (Option<String>, Option<String>) {
    let j: Value = serde_json::from_str(v).unwrap();
    (j["claudeAiOauth"]["accessToken"].as_str().map(str::to_string), j["mcpOAuth"]["tag"].as_str().map(str::to_string))
}

/// 갱신이 불리면 안 되는 시험의 갱신 길
fn no_refresh(_: &Value) -> Result<Value, String> {
    panic!("이 시험에선 칸 토큰을 갱신하면 안 된다")
}

/// 토큰 주인을 모름(망이 안 됨) — 예전처럼 저장한다
fn unknown_owner(_: &Value) -> Option<String> {
    None
}

/// 가짜 주인 묻기 — accessToken 이 "tokA…"·"fresh-tokA…" 면 u-a
fn owner_by_tok(o: &Value) -> Option<String> {
    let t = o["accessToken"].as_str()?.trim_start_matches("fresh-");
    let c = t.strip_prefix("tok")?.chars().next()?;
    Some(format!("u-{}", c.to_ascii_lowercase()))
}

struct Env {
    dir: PathBuf,
    list: PathBuf,
    live: Live,
    store: Fake,
}

fn oauth(who: &str, tier: &str) -> Value {
    json!({ "accountUuid": format!("u-{who}"), "organizationUuid": format!("o-{who}"), "emailAddress": format!("{who}@x.com"), "organizationRateLimitTier": tier })
}

fn env(tag: &str) -> Env {
    let dir = std::env::temp_dir().join(format!("chammo-accounts-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let claude_json = dir.join(".claude.json");
    // 다른 키와 순서가 그대로 남는지 보려고 oauthAccount 를 가운데에
    std::fs::write(&claude_json, serde_json::to_string_pretty(&json!({ "numStartups": 5, "oauthAccount": oauth("a", "default_claude_max_20x"), "zeta": { "k": 1 } })).unwrap()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&claude_json, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let store = Fake::default();
    store.put(LIVE, "me", &blob("tokA", "m1"));
    let claude_dir = Some(dir.join(".claude"));
    Env { list: dir.join("accounts.json"), live: Live { service: LIVE.into(), account: "me".into(), claude_json, claude_dir, refresh: no_refresh, owner: unknown_owner }, dir, store }
}

impl Env {
    fn login(&self, who: &str, tier: &str, tok: &str) {
        self.store.put(LIVE, "me", &blob(tok, "m1"));
        merge_oauth(&self.live.claude_json, &oauth(who, tier)).unwrap();
    }
    fn live_tok(&self) -> Option<String> {
        self.store.val(LIVE, "me").and_then(|v| read(&v).0)
    }
    fn slot(&self, id: &str) -> Option<String> {
        self.store.val(SLOT_SERVICE, id).and_then(|v| read(&v).0)
    }
    fn live_email(&self) -> String {
        read_oauth(&self.live.claude_json).unwrap()["emailAddress"].as_str().unwrap().to_string()
    }
    fn pool(&self) -> Pool {
        load(&self.list).unwrap()
    }
    /// A(20x, 지금 로그인)·B(5x) 두 칸, 지금은 B
    fn two(tag: &str) -> Env {
        let e = env(tag);
        capture(&e.store, &e.live, &e.list, None, "a1").unwrap();
        e.login("b", "default_claude_max_5x", "tokB");
        capture(&e.store, &e.live, &e.list, Some("작은 것"), "a2").unwrap();
        e
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn 추가_흐름_지금_로그인_보관_뒤_새_로그인_보관() {
    let e = env("add");
    let (pool, id, created) = capture(&e.store, &e.live, &e.list, None, "a1").unwrap();
    assert!(created);
    assert_eq!((id.as_str(), pool.current.as_deref()), ("a1", Some("a1")));
    assert_eq!(pool.accounts[0].name, "a"); // 이름 없으면 이메일 앞부분
    assert_eq!(pool.accounts[0].plan, "Max 20x");
    assert_eq!(e.slot("a1").as_deref(), Some("tokA"));
    // 앱 안 터미널에서 claude auth login → 새 계정
    e.login("b", "default_claude_max_5x", "tokB");
    let (pool, id, created) = capture(&e.store, &e.live, &e.list, Some("작은 것"), "a2").unwrap();
    assert!(created && id == "a2");
    // 요금제 작은 B 가 앞으로
    assert_eq!(pool.accounts.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), vec!["a2", "a1"]);
    assert_eq!(pool.accounts.iter().map(|a| a.order).collect::<Vec<_>>(), vec![0, 1]);
    assert_eq!(e.slot("a2").as_deref(), Some("tokB"));
    assert_eq!(e.slot("a1").as_deref(), Some("tokA"));
    // 같은 계정을 또 보관하면 새 칸이 아니라 그 칸 갱신
    e.store.put(LIVE, "me", &blob("tokB2", "m1"));
    let (pool, id, created) = capture(&e.store, &e.live, &e.list, None, "a3").unwrap();
    assert!(!created && id == "a2" && pool.accounts.len() == 2);
    assert_eq!(pool.accounts[0].name, "작은 것");
    assert_eq!(e.slot("a2").as_deref(), Some("tokB2"));
}

#[test]
fn 로그인_안_돼_있으면_보관_못_함() {
    let e = env("nologin");
    e.store.items.borrow_mut().clear();
    assert_eq!(capture(&e.store, &e.live, &e.list, None, "a1").unwrap_err(), Error::NotLoggedIn);
    assert!(!e.list.exists());
}

#[test]
fn 바꾸기_지금_것_다시_저장_고른_칸_쓰기_oauth_병합_백업() {
    let e = Env::two("switch");
    e.store.put(LIVE, "me", &blob("tokB-갱신됨", "m1")); // 쓰다 보면 토큰이 갱신된다
    let pool = switch(&e.store, &e.live, &e.list, "a1").unwrap();
    assert_eq!(pool.current.as_deref(), Some("a1"));
    assert_eq!(pool.switching, None);
    assert_eq!(e.live_tok().as_deref(), Some("tokA"));
    assert_eq!(e.live_email(), "a@x.com");
    assert_eq!(e.slot("a2").as_deref(), Some("tokB-갱신됨"));
    assert_eq!(e.slot(BACKUP_FIRST).as_deref(), Some("tokB-갱신됨"));
    assert_eq!(e.slot(BACKUP_LAST).as_deref(), Some("tokB-갱신됨"));
    // 다른 키·순서 그대로
    let v: Value = serde_json::from_str(&std::fs::read_to_string(&e.live.claude_json).unwrap()).unwrap();
    assert_eq!(v.as_object().unwrap().keys().collect::<Vec<_>>(), vec!["numStartups", "oauthAccount", "zeta"]);
    assert_eq!(v["zeta"]["k"], 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&e.live.claude_json).unwrap().permissions().mode() & 0o777, 0o600);
    }
    // 되돌아가기 — 처음 백업은 그대로, 마지막 백업은 갱신
    switch(&e.store, &e.live, &e.list, "a2").unwrap();
    assert_eq!(e.live_tok().as_deref(), Some("tokB-갱신됨"));
    assert_eq!(e.slot(BACKUP_FIRST).as_deref(), Some("tokB-갱신됨"));
    assert_eq!(e.slot(BACKUP_LAST).as_deref(), Some("tokA"));
    // 같은 칸으로 또 바꾸면 아무것도 안 함
    switch(&e.store, &e.live, &e.list, "a2").unwrap();
    assert_eq!(e.slot(BACKUP_LAST).as_deref(), Some("tokA"));
}

// 2026-10-05 폰 계정 ①: 자동 전환이 다시 읽은(view) 뒤 바꾸기(switchTo) 전 몇 ms 에 폰이 바꾸면 폰 선택을 덮었다 —
// 자동 전환은 '지금 칸이 내가 본 것일 때만' 바꾼다(같은 잠금 안에서 확인)
#[test]
fn 본_칸이_그새_바뀌었으면_자동_바꾸기는_안_한다() {
    let e = Env::two("switch-if");
    // 지금은 a2(B). 자동 전환은 a1 을 지금 칸으로 알고 있었다 → 안 바꾼다
    assert_eq!(switch_if(&e.store, &e.live, &e.list, "a1", Some("a1")).unwrap_err(), Error::Moved);
    assert_eq!(e.pool().current.as_deref(), Some("a2"));
    assert_eq!(e.live_tok().as_deref(), Some("tokB"));
    // 본 칸이 맞으면 바꾼다
    assert_eq!(switch_if(&e.store, &e.live, &e.list, "a1", Some("a2")).unwrap().current.as_deref(), Some("a1"));
    assert_eq!(e.live_tok().as_deref(), Some("tokA"));
    // 조건 없으면(손으로 바꾸기) 예전처럼
    assert_eq!(switch_if(&e.store, &e.live, &e.list, "a2", None).unwrap().current.as_deref(), Some("a2"));
    assert_eq!(Error::Moved.code(), "moved");
}

#[test]
fn 칸_없음_모르는_id_는_아무것도_안_바꾼다() {
    let e = Env::two("noslot");
    e.store.items.borrow_mut().remove(&(SLOT_SERVICE.to_string(), "a1".to_string()));
    let before = std::fs::read_to_string(&e.live.claude_json).unwrap();
    assert_eq!(switch(&e.store, &e.live, &e.list, "a1").unwrap_err(), Error::NoSlot);
    assert_eq!(switch(&e.store, &e.live, &e.list, "없는칸").unwrap_err(), Error::Unknown);
    assert_eq!(e.live_tok().as_deref(), Some("tokB"));
    assert_eq!(std::fs::read_to_string(&e.live.claude_json).unwrap(), before);
    assert_eq!(e.pool().current.as_deref(), Some("a2"));
    assert_eq!(e.slot(BACKUP_LAST), None);
}

#[test]
fn 잠긴_키체인() {
    let e = Env::two("locked");
    let before = std::fs::read_to_string(&e.live.claude_json).unwrap();
    *e.store.locked.borrow_mut() = true;
    assert_eq!(switch(&e.store, &e.live, &e.list, "a1").unwrap_err(), Error::Locked);
    *e.store.locked.borrow_mut() = false;
    assert_eq!(e.live_tok().as_deref(), Some("tokB"));
    assert_eq!(std::fs::read_to_string(&e.live.claude_json).unwrap(), before);
    assert_eq!(e.pool().current.as_deref(), Some("a2"));
}

#[test]
fn 로그인_칸_쓰기_실패면_되돌린다() {
    let e = Env::two("setfail");
    *e.store.fail_set.borrow_mut() = Some(LIVE.into());
    assert!(matches!(switch(&e.store, &e.live, &e.list, "a1").unwrap_err(), Error::Store(_)));
    let p = e.pool();
    assert_eq!((p.current.as_deref(), p.switching), (Some("a2"), None));
    assert_eq!(e.live_tok().as_deref(), Some("tokB"));
    assert_eq!(e.live_email(), "b@x.com");
}

#[test]
fn oauth_병합_실패면_로그인_칸도_되돌린다() {
    let e = Env::two("mergefail");
    // 칸 목록은 a2 가 지금이라고 알지만, 파일이 깨졌다(쓰는 도중 등)
    std::fs::write(&e.live.claude_json, "{ 깨진").unwrap();
    assert!(matches!(switch(&e.store, &e.live, &e.list, "a1").unwrap_err(), Error::Io(_)));
    assert_eq!(e.live_tok().as_deref(), Some("tokB"));
    let p = e.pool();
    assert_eq!(p.switching, None);
    // 깨진 파일로는 지금 계정을 확인 못 하니 모름으로 — 이름 붙은 칸에 안 쓴다
    assert_eq!(p.current, None);
    assert_eq!(e.slot("a2").as_deref(), Some("tokB"));
}

#[test]
fn 도중에_꺼졌으면_로그인_칸_값으로_어느_쪽인지_정한다() {
    // ① 로그인 칸까지 썼고 oauthAccount 는 아직 → 고른 칸(a1)으로 마무리, oauth 도 맞춘다
    let e = Env::two("crash1");
    let mut p = e.pool();
    p.current = None;
    p.switching = Some(Switching { from: Some("a2".into()), to: "a1".into() });
    save(&e.list, &p).unwrap();
    e.store.put(LIVE, "me", &blob("tokA", "m1"));
    let mut p = e.pool();
    reconcile(&e.store, &e.live, &e.list, &mut p).unwrap();
    assert_eq!((p.current.as_deref(), &p.switching), (Some("a1"), &None));
    assert_eq!(e.live_email(), "a@x.com");
    assert_eq!(e.pool(), p);

    // ② 로그인 칸을 쓰기 전 → 원래 칸(a2)
    let e = Env::two("crash2");
    let mut p = e.pool();
    p.current = None;
    p.switching = Some(Switching { from: Some("a2".into()), to: "a1".into() });
    reconcile(&e.store, &e.live, &e.list, &mut p).unwrap();
    assert_eq!(p.current.as_deref(), Some("a2"));
    assert_eq!(e.live_email(), "b@x.com");

    // ③ 둘 다 아니면 모름 — 다음 바꾸기에서 이 로그인은 백업에만 들어간다
    let e = Env::two("crash3");
    let mut p = e.pool();
    p.switching = Some(Switching { from: Some("a2".into()), to: "a1".into() });
    save(&e.list, &p).unwrap();
    e.store.put(LIVE, "me", &blob("tokX", "m1"));
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    assert_eq!(e.slot("a2").as_deref(), Some("tokB"));
    assert_eq!(e.slot(BACKUP_LAST).as_deref(), Some("tokX"));
}

#[test]
fn 밖에서_다른_계정으로_로그인했으면_지금_칸에_안_쓴다() {
    let e = Env::two("outside");
    e.login("c", "default_claude_max_20x", "tokC"); // 모르는 계정
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    assert_eq!(e.slot("a2").as_deref(), Some("tokB"));
    assert_eq!(e.slot(BACKUP_LAST).as_deref(), Some("tokC"));
    assert_eq!(e.live_tok().as_deref(), Some("tokA"));
}

#[test]
fn 밖에서_아는_계정으로_로그인했으면_그_칸을_맡고_새_토큰을_보관() {
    let e = Env::two("adopt");
    e.login("a", "default_claude_max_20x", "tokA-새로");
    let mut p = e.pool();
    reconcile(&e.store, &e.live, &e.list, &mut p).unwrap();
    assert_eq!(p.current.as_deref(), Some("a1"));
    assert_eq!(e.slot("a1").as_deref(), Some("tokA-새로"));
}

#[test]
fn 키체인과_oauth_가_어긋나면_보관하지_않는다() {
    let e = Env::two("mismatch");
    // 로그인 칸은 A 토큰인데 oauthAccount 는 아직 B (로그인이 바뀌는 도중)
    e.store.put(LIVE, "me", &blob("tokA", "m1"));
    assert_eq!(capture(&e.store, &e.live, &e.list, None, "a9").unwrap_err(), Error::Mismatch);
    assert_eq!(e.slot("a2").as_deref(), Some("tokB"));
    // 모를 때 맡기도 안 한다
    let mut p = e.pool();
    p.current = None;
    reconcile(&e.store, &e.live, &e.list, &mut p).unwrap();
    assert_eq!(p.current, None);
    assert_eq!(e.slot("a2").as_deref(), Some("tokB"));
}

#[test]
fn 이름_순서_빼기() {
    let e = Env::two("edit");
    let p = rename(&e.list, "a1", "  큰 것 ").unwrap();
    assert_eq!(p.accounts.iter().find(|a| a.id == "a1").unwrap().name, "큰 것");
    let p = reorder(&e.list, &["a1".into(), "a2".into(), "없음".into()]).unwrap();
    assert_eq!(p.accounts.iter().map(|a| (a.id.as_str(), a.order)).collect::<Vec<_>>(), vec![("a1", 0), ("a2", 1)]);
    let p = remove(&e.store, &e.list, "a2").unwrap();
    assert_eq!(p.accounts.len(), 1);
    assert_eq!(p.current, None); // 지금 칸을 뺐다 — 로그인 자체는 그대로
    assert_eq!(e.slot("a2"), None);
    assert_eq!(e.live_tok().as_deref(), Some("tokB"));
    assert_eq!(remove(&e.store, &e.list, "a2").unwrap_err(), Error::Unknown);
}

#[test]
fn 깨진_목록은_덮어쓰지_않는다() {
    let e = env("corrupt");
    std::fs::write(&e.list, "{ 깨짐").unwrap();
    assert!(matches!(capture(&e.store, &e.live, &e.list, None, "a1").unwrap_err(), Error::Io(_)));
    assert_eq!(std::fs::read_to_string(&e.list).unwrap(), "{ 깨짐");
    assert_eq!(e.slot("a1"), None);
}

#[test]
fn 목록_파일에_토큰이_없다() {
    let e = Env::two("notoken");
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    let text = std::fs::read_to_string(&e.list).unwrap();
    assert!(!text.contains("tokA") && !text.contains("tokB"), "{text}");
}

#[test]
fn 요금제_이름과_순서() {
    assert_eq!(plan_of(&json!({ "organizationRateLimitTier": "default_claude_max_5x" })), ("Max 5x".into(), 2));
    assert_eq!(plan_of(&json!({ "organizationRateLimitTier": "default_claude_max_20x" })), ("Max 20x".into(), 3));
    assert_eq!(plan_of(&json!({})).1, 4);
}

#[test]
fn 칸에는_계정_로그인만_mcp_로그인은_지금_것_그대로() {
    let e = Env::two("mcp");
    // B 를 쓰는 동안 MCP 로그인이 새로 생겼다(m2)
    e.store.put(LIVE, "me", &blob("tokB", "m2"));
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    let live = e.store.val(LIVE, "me").unwrap();
    assert_eq!(read(&live), (Some("tokA".into()), Some("m2".into()))); // 계정은 A, MCP 는 방금 것
    assert!(live.len() > 12 * 1024);
    // 칸은 작다 — MCP 로그인이 안 들어간다
    for id in ["a1", "a2"] {
        let v = e.store.val(SLOT_SERVICE, id).unwrap();
        assert!(v.len() < 300 && !v.contains("mcpOAuth"), "{id}: {}자", v.len());
    }
    // 백업은 덩어리 통째로
    assert_eq!(read(&e.store.val(SLOT_SERVICE, BACKUP_LAST).unwrap()), (Some("tokB".into()), Some("m2".into())));
    // 되돌아가도 MCP 는 지금 것
    e.store.put(LIVE, "me", &blob("tokA", "m3"));
    switch(&e.store, &e.live, &e.list, "a2").unwrap();
    assert_eq!(read(&e.store.val(LIVE, "me").unwrap()), (Some("tokB".into()), Some("m3".into())));
}

#[test]
fn 계정_로그인이_없는_덩어리는_로그인_안_됨() {
    let e = env("nopart");
    e.store.put(LIVE, "me", "{\"mcpOAuth\":{}}");
    assert_eq!(capture(&e.store, &e.live, &e.list, None, "a1").unwrap_err(), Error::NotLoggedIn);
    e.store.put(LIVE, "me", "깨진 값");
    assert_eq!(capture(&e.store, &e.live, &e.list, None, "a1").unwrap_err(), Error::NotLoggedIn);
}

#[test]
fn 갈아_끼우기는_다른_키와_순서를_지킨다() {
    let now = Secret::new("{\"a\":1,\"claudeAiOauth\":{\"accessToken\":\"old\"},\"mcpOAuth\":{\"x\":2}}");
    let out = with_part(Some(&now), &json!({ "accessToken": "new" }));
    assert_eq!(out.expose(), "{\"a\":1,\"claudeAiOauth\":{\"accessToken\":\"new\"},\"mcpOAuth\":{\"x\":2}}");
    assert_eq!(with_part(None, &json!({ "accessToken": "n" })).expose(), "{\"claudeAiOauth\":{\"accessToken\":\"n\"}}");
}

#[test]
fn 허용_거절은_따로_알린다() {
    let e = Env::two("denied");
    assert_eq!(Error::from(StoreError::Denied).code(), "denied");
    *e.store.locked.borrow_mut() = true; // 가짜에선 잠김으로 흉내 — 아무것도 안 바뀐다
    assert!(switch(&e.store, &e.live, &e.list, "a1").is_err());
    *e.store.locked.borrow_mut() = false;
    assert_eq!(e.live_tok().as_deref(), Some("tokB"));
}

#[test]
fn 새_칸_쓰기가_실패하면_반쯤_쓴_칸을_지운다() {
    let e = env("partial");
    *e.store.fail_set.borrow_mut() = Some(SLOT_SERVICE.into());
    *e.store.partial.borrow_mut() = true;
    assert!(matches!(capture(&e.store, &e.live, &e.list, None, "a1").unwrap_err(), Error::Store(_)));
    assert_eq!(e.store.val(SLOT_SERVICE, "a1"), None);
    assert!(load(&e.list).unwrap().accounts.is_empty());
}

#[test]
fn 자동_상태는_보관_바꾸기에도_남고_patch_는_윗단_키만_합친다() {
    let e = Env::two("auto");
    let p = patch_auto(&e.list, &json!({ "on": false, "slots": { "a1": { "blockedUntil": 5 } } })).unwrap();
    assert_eq!(p.auto["on"], false);
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    e.login("c", "default_claude_max_20x", "tokC");
    capture(&e.store, &e.live, &e.list, None, "a3").unwrap();
    let p = patch_auto(&e.list, &json!({ "pinned": "a1" })).unwrap();
    assert_eq!(p.auto, json!({ "on": false, "slots": { "a1": { "blockedUntil": 5 } }, "pinned": "a1" }));
    // null 이면 그 키를 지운다
    let p = patch_auto(&e.list, &json!({ "pinned": null })).unwrap();
    assert!(p.auto.get("pinned").is_none());
    // 객체가 아니거나 너무 크면 거절(목록 파일을 지킨다)
    assert!(matches!(patch_auto(&e.list, &json!([1])).unwrap_err(), Error::Io(_)));
    assert!(matches!(patch_auto(&e.list, &json!({ "x": "y".repeat(70 * 1024) })).unwrap_err(), Error::Io(_)));
    assert_eq!(load(&e.list).unwrap().auto["on"], false);
}

#[test]
fn 폰_바꾸기는_바꾼_칸에_고정까지_한_번에() {
    let e = Env::two("phone-pin");
    patch_auto(&e.list, &json!({ "on": true, "pinned": "a2", "nudged": { "s1": 1 } })).unwrap();
    let pool = switch_pinned(&e.store, &e.live, &e.list, "a1", 4242).unwrap();
    assert_eq!(pool.current.as_deref(), Some("a1"));
    assert_eq!(e.live_tok().as_deref(), Some("tokA"));
    assert_eq!((pool.auto["pinned"].clone(), pool.auto["switchedAt"].clone()), (json!("a1"), json!(4242)));
    // 다른 자동 상태 키는 그대로(자동 켜짐·깨운 기록)
    assert_eq!((pool.auto["on"].clone(), pool.auto["nudged"]["s1"].clone()), (json!(true), json!(1)));
}

#[test]
fn 폰_바꾸기_실패면_고정도_안_바뀐다() {
    let e = Env::two("phone-fail");
    patch_auto(&e.list, &json!({ "pinned": "a2", "switchedAt": 1 })).unwrap();
    // 키체인 잠김(폰은 창을 못 띄워 이걸로 끝난다)
    *e.store.locked.borrow_mut() = true;
    assert_eq!(switch_pinned(&e.store, &e.live, &e.list, "a1", 9).unwrap_err(), Error::Locked);
    *e.store.locked.borrow_mut() = false;
    // 없는 칸
    assert_eq!(switch_pinned(&e.store, &e.live, &e.list, "zz", 9).unwrap_err(), Error::Unknown);
    // 로그인 칸 쓰기 실패 — 되돌린다
    *e.store.fail_set.borrow_mut() = Some(LIVE.into());
    assert!(switch_pinned(&e.store, &e.live, &e.list, "a1", 9).is_err());
    *e.store.fail_set.borrow_mut() = None;
    let p = e.pool();
    assert_eq!((p.current.as_deref(), p.switching.clone()), (Some("a2"), None));
    assert_eq!(e.live_tok().as_deref(), Some("tokB"));
    assert_eq!((p.auto["pinned"].clone(), p.auto["switchedAt"].clone()), (json!("a2"), json!(1)));
}

#[test]
fn 폰_바꾸기_지금_칸으로_또_누르면_고정만_새로() {
    let e = Env::two("phone-same");
    let pool = switch_pinned(&e.store, &e.live, &e.list, "a2", 7).unwrap();
    assert_eq!((pool.current.as_deref(), pool.auto["pinned"].clone()), (Some("a2"), json!("a2")));
    assert_eq!(e.live_tok().as_deref(), Some("tokB"));
}

// 2026-10-10 계정 풀 '남은 위험': 백업 칸(backup-first·backup-last)은 있는데 되돌리는 명령이 없었다(손으로 security 를 써야 했다)
#[test]
fn 백업_되돌리기는_키체인과_oauth_를_같이_돌려놓고_mcp_로그인은_지금_것() {
    let e = Env::two("restore");
    switch(&e.store, &e.live, &e.list, "a1").unwrap(); // 처음 백업 = B
    // 깨짐: 키체인엔 모르는 토큰, 표시는 A
    e.store.put(LIVE, "me", &blob("tokX", "m2"));
    let pool = restore(&e.store, &e.live, &e.list, BACKUP_FIRST).unwrap();
    assert_eq!(e.live_tok().as_deref(), Some("tokB"));
    assert_eq!(e.live_email(), "b@x.com");
    assert_eq!(pool.current.as_deref(), Some("a2")); // 같은 계정 칸을 다시 맡는다
    assert_eq!(pool.switching, None);
    assert_eq!(e.store.val(LIVE, "me").map(|v| read(&v).1), Some(Some("m2".into()))); // MCP 로그인은 지금 것
    assert_eq!(e.slot(BACKUP_UNDO).as_deref(), Some("tokX")); // 되돌리기 전 것도 남긴다
    assert_eq!(e.slot(BACKUP_FIRST).as_deref(), Some("tokB")); // 백업 칸은 그대로
}

#[test]
fn 마지막_백업으로도_되돌린다() {
    let e = Env::two("restore-last");
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    switch(&e.store, &e.live, &e.list, "a2").unwrap(); // 마지막 백업 = A
    e.store.put(LIVE, "me", &blob("tokX", "m1"));
    let pool = restore(&e.store, &e.live, &e.list, BACKUP_LAST).unwrap();
    assert_eq!((e.live_tok().as_deref(), e.live_email().as_str(), pool.current.as_deref()), (Some("tokA"), "a@x.com", Some("a1")));
}

#[test]
fn 백업보다_칸이_새것이면_되돌려도_칸의_새_토큰을_지키고_그걸_끼운다() {
    // 2026-10-21 리뷰: 데우기가 칸 a1 을 tokA2 로 갱신한 뒤(백업 tokA 의 갱신 토큰은 회전돼 죽음) 마지막 백업으로 되돌리면
    // reconcile 이 죽은 tokA 로 칸 a1 을 덮어 그 계정을 다시 로그인해야 했다
    let e = Env::two("restore-newer");
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    switch(&e.store, &e.live, &e.list, "a2").unwrap(); // 마지막 백업 = A(tokA)
    let later = crate::accounts_refresh::now_ms() + 8 * HOUR;
    e.store.put(SLOT_SERVICE, "a1", &slot_blob("tokA2", later)); // 데우기가 갱신한 칸
    let pool = restore(&e.store, &e.live, &e.list, BACKUP_LAST).unwrap();
    assert_eq!(e.slot("a1").as_deref(), Some("tokA2"), "살아 있던 칸 토큰을 옛 백업으로 덮지 않는다");
    assert_eq!(e.live_tok().as_deref(), Some("tokA2"), "로그인엔 그 계정의 새 토큰");
    assert_eq!((e.live_email().as_str(), pool.current.as_deref()), ("a@x.com", Some("a1")));
}

#[test]
fn 표시를_안_적은_옛_백업은_같은_토큰_칸의_표시로() {
    let e = Env::two("restore-old");
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    let mut p = e.pool();
    p.backup_oauth = Value::Null; // 이 기능 전에 만든 백업
    save(&e.list, &p).unwrap();
    e.store.put(LIVE, "me", &blob("tokX", "m1"));
    restore(&e.store, &e.live, &e.list, BACKUP_FIRST).unwrap();
    assert_eq!((e.live_tok().as_deref(), e.live_email().as_str()), (Some("tokB"), "b@x.com"));
}

#[test]
fn 백업이_없거나_이름이_틀리면_안_건드린다() {
    let e = Env::two("restore-none");
    assert_eq!(restore(&e.store, &e.live, &e.list, BACKUP_FIRST).unwrap_err(), Error::NoBackup);
    assert_eq!(restore(&e.store, &e.live, &e.list, "a1").unwrap_err(), Error::Unknown); // 칸 id 는 바꾸기로
    assert_eq!(e.live_tok().as_deref(), Some("tokB"));
}

// ── 2026-10-13 19:14 자동 전환 때 세션들이 "another Claude Code process is refreshing it" 으로 멈춘 것 ──

const HOUR: i64 = 3600_000;

/// 만료 시각이 있는 칸 값(계정 로그인만)
fn slot_blob(tok: &str, exp: i64) -> String {
    json!({ "claudeAiOauth": { "accessToken": tok, "refreshToken": format!("r-{tok}"), "expiresAt": exp, "scopes": ["user:inference"], "subscriptionType": "max" } }).to_string()
}

fn live_exp(e: &Env) -> Option<i64> {
    let v: Value = serde_json::from_str(&e.store.val(LIVE, "me")?).ok()?;
    v["claudeAiOauth"]["expiresAt"].as_i64()
}

/// 가짜 갱신 — 새 토큰 = "fresh-" + 옛 토큰, 8시간
fn fresh(o: &Value) -> Result<Value, String> {
    let mut n = o.clone();
    n["accessToken"] = format!("fresh-{}", o["accessToken"].as_str().unwrap()).into();
    n["refreshToken"] = format!("r2-{}", o["accessToken"].as_str().unwrap()).into();
    n["expiresAt"] = (crate::accounts_refresh::now_ms() + 8 * HOUR).into();
    Ok(n)
}

fn dead(_: &Value) -> Result<Value, String> {
    Err("dead".into())
}

#[test]
fn 만료된_칸으로_바꿀_땐_끼우기_전에_갱신해서_끼운다() {
    // 칸 토큰은 보관한 뒤 몇 시간이 지나 대개 만료돼 있다 — 그대로 끼우면 돌던 세션이 다 같이 갱신하러 몰려 잠금에서 멈췄다
    let mut e = Env::two("refresh-expired");
    e.store.put(SLOT_SERVICE, "a1", &slot_blob("tokA", crate::accounts_refresh::now_ms() - HOUR));
    e.live.refresh = fresh;
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    assert_eq!(e.live_tok().as_deref(), Some("fresh-tokA"));
    assert!(live_exp(&e).unwrap() > crate::accounts_refresh::now_ms() + 7 * HOUR, "끼운 토큰이 만료 전이어야 세션이 갱신하러 안 간다");
    // 새 갱신 토큰은 칸에도 — 옛 갱신 토큰은 이미 써 버렸다
    assert_eq!(e.slot("a1").as_deref(), Some("fresh-tokA"));
    // MCP 로그인은 지금 것 그대로
    assert_eq!(read(&e.store.val(LIVE, "me").unwrap()).1.as_deref(), Some("m1"));
}

#[test]
fn 넉넉한_칸_토큰은_갱신하지_않는다() {
    let e = Env::two("refresh-fresh");
    e.store.put(SLOT_SERVICE, "a1", &slot_blob("tokA", crate::accounts_refresh::now_ms() + 5 * HOUR));
    switch(&e.store, &e.live, &e.list, "a1").unwrap(); // no_refresh — 불리면 실패
    assert_eq!(e.live_tok().as_deref(), Some("tokA"));
}

#[test]
fn 칸_토큰을_갱신하지_못하면_바꾸지_않는다() {
    // 만료된 토큰을 끼우면 세션이 갱신에 실패해 멈춘다 — 지금 계정 그대로 두고 알린다
    let mut e = Env::two("refresh-dead");
    e.store.put(SLOT_SERVICE, "a1", &slot_blob("tokA", crate::accounts_refresh::now_ms() - HOUR));
    e.live.refresh = dead;
    assert_eq!(switch(&e.store, &e.live, &e.list, "a1").unwrap_err(), Error::Refresh("dead".into()));
    let p = e.pool();
    assert_eq!((e.live_tok().as_deref(), e.live_email().as_str(), p.current.as_deref(), p.switching), (Some("tokB"), "b@x.com", Some("a2"), None));
    assert_eq!(e.slot("a1").as_deref(), Some("tokA"));
}

#[test]
fn Claude_Code_세션이_갱신_잠금을_쥐고_있으면_바꾸지_않는다() {
    // 세션이 지금 계정을 갱신하는 도중에 바꾸면, 그 세션이 받은 새 토큰은 버려지고 칸엔 이미 써 버린 갱신 토큰이 남는다
    let e = Env::two("lock-busy");
    let dir = e.live.claude_dir.clone().unwrap();
    std::fs::create_dir_all(dir.join(".oauth_refresh.lock")).unwrap();
    assert_eq!(switch(&e.store, &e.live, &e.list, "a1").unwrap_err(), Error::Busy);
    let p = e.pool();
    assert_eq!((e.live_tok().as_deref(), p.current.as_deref(), p.switching), (Some("tokB"), Some("a2"), None));
    assert!(dir.join(".oauth_refresh.lock").is_dir(), "남의 잠금은 안 지운다");
}

#[test]
fn 바꿔_끼우는_동안_Claude_Code_갱신_잠금을_쥔다() {
    let e = Env::two("lock-held");
    let dir = e.live.claude_dir.clone().unwrap();
    let (new, legacy) = crate::accounts_refresh::lock_paths(&dir);
    let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let (s2, n2, l2) = (seen.clone(), new.clone(), legacy.clone());
    *e.store.on_set.borrow_mut() = Some(Box::new(move |svc| {
        if svc == LIVE {
            s2.borrow_mut().push(n2.is_dir() && l2.is_dir());
        }
    }));
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    assert_eq!(*seen.borrow(), vec![true], "로그인 칸에 쓰는 순간 두 잠금을 다 쥐고 있어야 한다");
    assert!(!new.exists() && !legacy.exists(), "끝나면 놓는다");
}

// ── 2026-10-15 17:18~ 토큰 주소가 이 맥 IP 를 막았는데 자동 전환이 5분마다 끼울 칸을 갱신하러 또 보낸 것(token_rate) ──

fn limited_10m(_: &Value) -> Result<Value, String> {
    Err("rate:600".into())
}

/// 다른 길(데우기·지금 로그인 미리)이 막혀 둔 쉬기
fn rest_until(e: &Env, until: i64) {
    let r = crate::token_rate::Rate { until, at: until - HOUR, count: 1, by: "warm".into(), ..Default::default() };
    crate::token_rate::save(&crate::token_rate::path_for(&e.list), &r);
}

#[test]
fn 토큰_주소가_쉬는_중이면_만료된_칸으로는_서버를_안_부르고_바로_wait() {
    let e = Env::two("rate-gate");
    let now = crate::accounts_refresh::now_ms();
    e.store.put(SLOT_SERVICE, "a1", &slot_blob("tokA", now - HOUR));
    rest_until(&e, now + HOUR);
    // no_refresh — 불리면 실패
    let Error::Refresh(code) = switch(&e.store, &e.live, &e.list, "a1").unwrap_err() else { panic!("wait 이어야") };
    let secs: i64 = code.strip_prefix("wait:").expect(&code).parse().unwrap();
    assert!((3590..=3600).contains(&secs), "남은 초 {secs}");
    let p = e.pool();
    assert_eq!((e.live_tok().as_deref(), p.current.as_deref(), p.switching), (Some("tokB"), Some("a2"), None), "안 바꿨다");
}

#[test]
fn 쉬는_중이어도_만료_전_칸은_서버_없이_그대로_바꾼다() {
    let e = Env::two("rate-fresh");
    let now = crate::accounts_refresh::now_ms();
    e.store.put(SLOT_SERVICE, "a1", &slot_blob("tokA", now + 5 * HOUR));
    rest_until(&e, now + HOUR);
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    assert_eq!(e.live_tok().as_deref(), Some("tokA"));
}

#[test]
fn 바꾸다_막히면_세_길이_같이_보는_쉬기를_남기고_다음엔_안_부른다() {
    let mut e = Env::two("rate-hit");
    let now = crate::accounts_refresh::now_ms();
    e.store.put(SLOT_SERVICE, "a1", &slot_blob("tokA", now - HOUR));
    e.live.refresh = limited_10m;
    // 화면엔 서버가 준 10분이 아니라 실제로 쉬는 시간(1시간)
    let Error::Refresh(code) = switch(&e.store, &e.live, &e.list, "a1").unwrap_err() else { panic!("rate 여야") };
    let secs: i64 = code.strip_prefix("rate:").expect(&code).parse().unwrap();
    assert!((3590..=3600).contains(&secs), "{code}");
    let r = crate::token_rate::load(&crate::token_rate::path_for(&e.list));
    assert!(r.until >= now + HOUR && r.until < now + HOUR + 60_000, "Retry-After 10분이어도 1시간");
    assert_eq!((r.by.as_str(), r.retry_after, r.count), ("switch", Some(600), 1));
    e.live.refresh = no_refresh;
    assert!(matches!(switch(&e.store, &e.live, &e.list, "a1").unwrap_err(), Error::Refresh(c) if c.starts_with("wait:")));
}

// ── 2026-10-21 리뷰 ⑤-2·3 ──

#[test]
fn 돌던_세션이_옛_계정_토큰을_되써도_지금_칸을_남의_토큰으로_덮지_않는다() {
    // A→B 로 바꾼 뒤 돌던 세션이 A 토큰으로 갱신해 로그인 칸에 되쓰면(oauthAccount 는 B 그대로) 다음 바꾸기가 칸 b 의 B 토큰을 A 것으로 덮었다
    let mut e = Env::two("owner");
    e.live.owner = owner_by_tok;
    e.store.put(LIVE, "me", &blob("tokA-세션이-되씀", "m1"));
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    assert_eq!(e.slot("a2").as_deref(), Some("tokB"), "칸 b 는 B 토큰 그대로");
    assert_eq!(e.slot(BACKUP_LAST).as_deref(), Some("tokA-세션이-되씀"), "되돌리기 백업엔 남는다");
    // 주인이 맞으면(정상 갱신) 그대로 저장
    e.store.put(LIVE, "me", &blob("tokA-갱신됨", "m1"));
    switch(&e.store, &e.live, &e.list, "a2").unwrap();
    assert_eq!(e.slot("a1").as_deref(), Some("tokA-갱신됨"));
}

#[test]
fn 남의_계정_토큰은_표시가_같아도_칸으로_맡지_않는다() {
    // reconcile — 지금 칸을 모를 때 표시 계정이 같은 칸에 로그인 토큰을 넣는데, 그 토큰이 다른 계정 것이면 칸이 죽는다
    let mut e = Env::two("owner-reconcile");
    e.live.owner = owner_by_tok;
    let mut p = e.pool();
    p.current = None;
    save(&e.list, &p).unwrap();
    e.store.put(LIVE, "me", &blob("tokA-섞임", "m1")); // 표시는 B
    let mut p = e.pool();
    reconcile(&e.store, &e.live, &e.list, &mut p).unwrap();
    assert_eq!((p.current, e.slot("a2").as_deref()), (None, Some("tokB")));
}

#[test]
fn 갱신한_새_토큰을_칸에_못_담아도_버리지_않는다() {
    // 서버가 갱신 토큰을 돌린 뒤 칸 쓰기가 실패하면 `?` 로 돌아가며 유일한 새 토큰을 버려 그 칸이 죽었다(⑤-3)
    let mut e = Env::two("refresh-keep");
    e.store.put(SLOT_SERVICE, "a1", &slot_blob("tokA", crate::accounts_refresh::now_ms() - HOUR));
    e.live.refresh = fresh;
    *e.store.fail_account.borrow_mut() = Some(("a1".into(), 1));
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    assert_eq!(e.slot("a1").as_deref(), Some("fresh-tokA"), "한 번 실패해도 다시 담는다");
    // 끝내 못 담아도 바꾸기는 새 토큰으로 — 로그인 칸에 살아 있고, 다음에 이 칸에서 바꿀 때 칸에 담긴다
    let mut e = Env::two("refresh-keep2");
    e.store.put(SLOT_SERVICE, "a1", &slot_blob("tokA", crate::accounts_refresh::now_ms() - HOUR));
    e.live.refresh = fresh;
    *e.store.fail_account.borrow_mut() = Some(("a1".into(), 99));
    switch(&e.store, &e.live, &e.list, "a1").unwrap();
    assert_eq!(e.live_tok().as_deref(), Some("fresh-tokA"));
    *e.store.fail_account.borrow_mut() = None;
    switch(&e.store, &e.live, &e.list, "a2").unwrap();
    assert_eq!(e.slot("a1").as_deref(), Some("fresh-tokA"));
}

#[test]
fn 갱신_응답에_만료_시간이_없어도_새_토큰을_받는다() {
    let old = json!({ "accessToken": "x", "refreshToken": "r", "expiresAt": 1 });
    let n = crate::accounts_refresh::apply(&old, &json!({ "access_token": "y", "refresh_token": "r2" }), 1_000).unwrap();
    assert_eq!((n["accessToken"].as_str(), n["refreshToken"].as_str()), (Some("y"), Some("r2")));
    assert!(n["expiresAt"].as_i64().unwrap() > 1_000);
}

#[test]
fn 계정_정보_응답에서_주인을_읽는다() {
    assert_eq!(crate::accounts_refresh::profile_owner(r#"{"account":{"uuid":"u-1","email":"a@x.com"},"organization":{"uuid":"o-1"}}"#).as_deref(), Some("u-1"));
    assert_eq!(crate::accounts_refresh::profile_owner(r#"{"error":"x"}"#), None);
    assert_eq!(crate::accounts_refresh::profile_owner("nope"), None);
}
