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
    Env { list: dir.join("accounts.json"), live: Live { service: LIVE.into(), account: "me".into(), claude_json }, dir, store }
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
