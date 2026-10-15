//! 지금 로그인 미리 갱신 — 가짜 키체인·가짜 시계·가짜 갱신기. 실제 토큰 주소는 안 부른다
use super::*;
use crate::accounts::{capture, load, merge_oauth, Live, SLOT_SERVICE};
use crate::accounts_refresh::{lock_paths, Refresher};
use crate::accounts_store::fake::Fake;
use serde_json::json;
use std::cell::RefCell;
use std::path::PathBuf;

const LIVE: &str = "Claude Code-credentials";
const HOUR: i64 = 3600_000;
const MIN: i64 = 60_000;
const T0: i64 = 4_000_000_000_000;

thread_local! {
    /// 가짜 갱신기가 받은 갱신 토큰들(한 시험 = 한 스레드)
    static CALLS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    /// 갱신하는 순간 Claude Code 잠금 둘이 다 잡혀 있었나
    static LOCKED: RefCell<Vec<bool>> = const { RefCell::new(Vec::new()) };
    static DIR: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

fn calls() -> Vec<String> {
    CALLS.with(|c| c.borrow().clone())
}

fn record(o: &Value) {
    CALLS.with(|c| c.borrow_mut().push(o["refreshToken"].as_str().unwrap_or("").to_string()));
    let held = DIR.with(|d| d.borrow().as_ref().map(|d| { let (n, l) = lock_paths(d); n.is_dir() && l.is_dir() }).unwrap_or(false));
    LOCKED.with(|c| c.borrow_mut().push(held));
}

/// 성공 — 새 토큰, 8시간
fn ok(o: &Value) -> Result<Value, String> {
    record(o);
    let mut n = o.clone();
    n["accessToken"] = format!("new-{}", o["accessToken"].as_str().unwrap()).into();
    n["refreshToken"] = format!("rn-{}", o["accessToken"].as_str().unwrap()).into();
    n["expiresAt"] = (T0 + 8 * HOUR).into();
    Ok(n)
}

fn limited(o: &Value) -> Result<Value, String> {
    record(o);
    Err("rate".into())
}

fn limited_30m(o: &Value) -> Result<Value, String> {
    record(o);
    Err("rate:1800".into())
}

fn limited_3h(o: &Value) -> Result<Value, String> {
    record(o);
    Err("rate:10800".into())
}

fn dead(o: &Value) -> Result<Value, String> {
    record(o);
    Err("dead".into())
}

fn network(o: &Value) -> Result<Value, String> {
    record(o);
    Err("network".into())
}

fn never(_: &Value) -> Result<Value, String> {
    panic!("서버를 부르면 안 된다")
}

fn oauth(who: &str) -> Value {
    json!({ "accountUuid": format!("u-{who}"), "organizationUuid": format!("o-{who}"), "emailAddress": format!("{who}@x.com"), "organizationRateLimitTier": "default_claude_max_5x" })
}

/// 계정 로그인 + MCP 로그인이 든 지금 덩어리
fn blob(tok: &str, exp: i64) -> String {
    json!({ "claudeAiOauth": { "accessToken": tok, "refreshToken": format!("r-{tok}"), "expiresAt": exp, "scopes": ["user:inference"] }, "mcpOAuth": { "srv": { "accessToken": "mcp-x" } } }).to_string()
}

struct Env {
    dir: PathBuf,
    list: PathBuf,
    state: PathBuf,
    live: Live,
    store: Fake,
    log: Vec<String>,
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

impl Env {
    /// 지금 로그인 a(남은 시간 left), 계정 칸 없음
    fn new(tag: &str, left: i64) -> Env {
        let dir = std::env::temp_dir().join(format!("chammo-keep-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let claude_dir = dir.join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        let claude_json = dir.join(".claude.json");
        std::fs::write(&claude_json, "{}").unwrap();
        DIR.with(|d| *d.borrow_mut() = Some(claude_dir.clone()));
        let e = Env {
            list: dir.join("accounts.json"),
            state: dir.join("login-keep.json"),
            live: Live { service: LIVE.into(), account: "me".into(), claude_json, claude_dir: Some(claude_dir), refresh: never },
            dir,
            store: Fake::default(),
            log: Vec::new(),
        };
        e.login("a", T0 + left);
        e
    }
    fn login(&self, who: &str, exp: i64) {
        self.store.put(LIVE, "me", &blob(&format!("tok-{who}"), exp));
        merge_oauth(&self.live.claude_json, &oauth(who)).unwrap();
    }
    fn live_part(&self) -> Value {
        let v: Value = serde_json::from_str(&self.store.val(LIVE, "me").unwrap()).unwrap();
        v["claudeAiOauth"].clone()
    }
    fn live_all(&self) -> Value {
        serde_json::from_str(&self.store.val(LIVE, "me").unwrap()).unwrap()
    }
    fn slot(&self, id: &str) -> Value {
        let v: Value = serde_json::from_str(&self.store.val(SLOT_SERVICE, id).unwrap()).unwrap();
        v["claudeAiOauth"].clone()
    }
    fn keep(&self) -> Keep {
        load_keep(&self.state)
    }
    fn tick(&mut self, now: i64, r: Refresher) {
        let mut lines = Vec::new();
        tick(&self.store, &self.live, &self.list, &self.state, now, r, &mut |l: &str| lines.push(l.to_string())).unwrap();
        self.log.extend(lines);
    }
}

// ── 카드 판단(순수) ───────────────────────────────────

#[test]
fn 카드는_죽었거나_15분_안인데_못_받았을_때만_최근_본_것으로() {
    let k = |exp: i64, dead: bool| Keep { exp: Some(exp), seen_at: T0, dead_exp: dead.then_some(exp), ..Keep::default() };
    assert_eq!(need(&k(T0 + 16 * MIN, false), T0), None);
    assert_eq!(need(&k(T0 + 14 * MIN, false), T0), Some("late"));
    assert_eq!(need(&k(T0 - HOUR, false), T0), Some("late")); // 이미 만료
    assert_eq!(need(&k(T0 + 5 * HOUR, true), T0), Some("dead"));
    // 앱이 꺼져 있던 동안의 옛 기록으로는 안 띄운다
    assert_eq!(need(&k(T0 + 14 * MIN, false), T0 + FRESH_MS + 1), None);
    assert_eq!(need(&Keep::default(), T0), None);
}

// ── 돌리기 ─────────────────────────────────────────

#[test]
fn 남은_시간이_60분_넘으면_서버를_안_부르고_60분_전에_다시_본다() {
    let mut e = Env::new("ahead", 3 * HOUR);
    let before = e.live_all();
    e.tick(T0, never);
    assert_eq!(e.live_all(), before);
    let k = e.keep();
    assert_eq!(k.exp, Some(T0 + 3 * HOUR));
    // 넉넉해도 15분마다는 본다(계정 바꾸기로 만료가 앞당겨질 수 있다)
    assert_eq!(k.next_at, T0 + LOOK_MAX_MS);
    // 다시 볼 때 전엔 키체인도 안 읽는다
    *e.store.locked.borrow_mut() = true;
    e.tick(T0 + LOOK_MAX_MS - 1, never);
    *e.store.locked.borrow_mut() = false;
    // 61분 남음 → 아직, 다음은 만료 60분 전
    e.tick(T0 + 3 * HOUR - 61 * MIN, never);
    assert_eq!(e.keep().next_at, T0 + 2 * HOUR);
    assert!(calls().is_empty());
}

#[test]
fn 남은_시간이_60분_아래면_잠금을_쥐고_지금_칸_계정_로그인만_바꾼다() {
    let mut e = Env::new("refresh", 59 * MIN);
    let shown = std::fs::read_to_string(&e.live.claude_json).unwrap();
    e.tick(T0, ok);
    assert_eq!(calls(), vec!["r-tok-a"]);
    assert_eq!(LOCKED.with(|c| c.borrow().clone()), vec![true], "갱신하는 동안 Claude Code 잠금 둘을 쥔다");
    let all = e.live_all();
    assert_eq!(all["claudeAiOauth"]["accessToken"], json!("new-tok-a"));
    assert_eq!(all["claudeAiOauth"]["refreshToken"], json!("rn-tok-a"));
    assert_eq!(all["claudeAiOauth"]["scopes"], json!(["user:inference"]));
    assert_eq!(all["mcpOAuth"], json!({ "srv": { "accessToken": "mcp-x" } }), "MCP 로그인은 그대로");
    assert_eq!(std::fs::read_to_string(&e.live.claude_json).unwrap(), shown, ".claude.json 계정 표시는 안 건드린다");
    // 잠금은 놓았다
    let (n, l) = lock_paths(e.live.claude_dir.as_ref().unwrap());
    assert!(!n.exists() && !l.exists());
    let k = e.keep();
    assert_eq!((k.exp, k.last.as_str(), k.fails), (Some(T0 + 8 * HOUR), "ok", 0));
    assert_eq!(need(&k, T0), None);
    assert_eq!(e.log, vec!["ok · left 59m → 480m"]);
    // 다음 차례엔 안 부른다
    e.tick(T0 + LOOK_MAX_MS, never);
}

#[test]
fn 잠금을_세션이_쥐고_있으면_안_부르고_다음_차례에() {
    let mut e = Env::new("busy", 50 * MIN);
    let (n, _) = lock_paths(e.live.claude_dir.as_ref().unwrap());
    std::fs::create_dir(&n).unwrap();
    e.tick(T0, never);
    assert_eq!(e.keep().last, "busy");
    assert_eq!(e.keep().next_at, T0, "바로 다음 차례(1분 뒤)에 다시");
    assert_eq!(e.log, vec!["busy · left 50m"]);
    std::fs::remove_dir(&n).unwrap();
    e.tick(T0 + MIN, ok);
    assert_eq!(calls(), vec!["r-tok-a"]);
}

#[test]
fn 잠금을_기다리는_사이_세션이_먼저_갱신했으면_안_부른다() {
    let mut e = Env::new("raced", 50 * MIN);
    // 잠금을 잡은 직후 다시 읽을 때 이미 새 값 — 세션이 갱신해 두고 잠금을 놓은 것
    let fresh = blob("tok-s", T0 + 8 * HOUR);
    let n = std::cell::Cell::new(0);
    *e.store.on_get.borrow_mut() = Some(Box::new(move |f: &Fake, s: &str| {
        if s == LIVE {
            n.set(n.get() + 1);
            if n.get() == 2 {
                f.put(LIVE, "me", &fresh); // 두 번째 읽기(잠금 안) 직전에 세션이 바꿔 둔다
            }
        }
    }));
    e.tick(T0, never);
    assert_eq!(e.live_part()["accessToken"], json!("tok-s"));
    assert_eq!(e.keep().exp, Some(T0 + 8 * HOUR));
    assert_eq!(e.log, vec!["session · left 480m"]);
}

fn rate_file(e: &Env) -> crate::token_rate::Rate {
    crate::token_rate::load(&crate::token_rate::path_for(&e.list))
}

#[test]
fn 막히면_10분마다_두드리지_않고_한_곳_쉬기가_풀릴_때까지_안_부른다() {
    // 2026-10-15 17:18~ 이 맥 IP 가 막혔을 때 10분마다 다시 보내 막힘을 늘렸다
    let mut e = Env::new("rate", 3 * HOUR + 55 * MIN);
    e.tick(T0 + 3 * HOUR, limited);
    let live = e.live_all();
    let k = e.keep();
    // 다음에 볼 때 = 쉬기가 풀릴 때, 그보다 먼저 만료 20분 전(마지막 한 번)이 오면 그때
    assert_eq!((k.next_at, k.fails, k.last.as_str()), (T0 + 3 * HOUR + 35 * MIN, 1, "rate"));
    assert_eq!(rate_file(&e).until, T0 + 4 * HOUR, "세 길이 같이 보는 쉬기 1시간");
    for m in 1..35 {
        e.tick(T0 + 3 * HOUR + m * MIN, never); // 10분마다 안 부른다
    }
    assert_eq!(e.live_all(), live, "실패하면 키체인은 그대로");
    // 그사이 사람이 브라우저로 로그인 — 카드 없이 넉넉
    e.login("a", T0 + 9 * HOUR);
    e.tick(T0 + 3 * HOUR + 35 * MIN, never);
    assert_eq!(need(&e.keep(), T0 + 3 * HOUR + 35 * MIN), None);
    assert_eq!(calls().len(), 1);
    assert_eq!(e.log, vec!["rate · left 55m · try #1"]);
}

#[test]
fn 다른_길이_막혀_둔_쉬기도_지키고_retry_after_가_길면_그만큼() {
    let mut e = Env::new("rate-other", 50 * MIN);
    let r = crate::token_rate::Rate { until: T0 + 3 * HOUR, at: T0, count: 1, by: "warm".into(), ..Default::default() };
    crate::token_rate::save(&crate::token_rate::path_for(&e.list), &r);
    for m in 0..30 {
        e.tick(T0 + m * MIN, never); // 만료 20분 전까지는 안 부른다
    }
    assert_eq!(e.keep().last, "wait");
    assert_eq!(e.log, vec!["wait · left 50m · rest 180m"], "쉬는 동안 기록은 한 줄");
    // Retry-After 3시간
    let mut e = Env::new("rate-3h", 55 * MIN);
    e.tick(T0, limited_3h);
    assert_eq!(rate_file(&e).until, T0 + 3 * HOUR);
}

#[test]
fn 만료_20분_안이면_쉬는_중이어도_딱_한_번_또_막히면_바로_카드() {
    let mut e = Env::new("last", 55 * MIN);
    e.tick(T0, limited); // 쉬기 1시간 — 만료(55분)보다 길다
    e.tick(T0 + 34 * MIN, never); // 21분 남음 — 아직(보기만)
    assert_eq!(need(&e.keep(), T0 + 34 * MIN), None);
    e.tick(T0 + 35 * MIN, limited); // 20분 안 — 세션이 멈추기 직전 마지막 기회
    assert_eq!(calls().len(), 2);
    assert_eq!(need(&e.keep(), T0 + 35 * MIN), Some("late"), "또 막혔으면 15분을 기다리지 않고 바로 카드");
    let r = rate_file(&e);
    assert_eq!((r.count, r.until, r.by.as_str()), (2, T0 + 35 * MIN + 2 * HOUR, "keep"), "이어진 막힘이라 2배");
    for m in 36..60 {
        e.tick(T0 + m * MIN, never); // 한 번뿐
        assert_eq!(need(&e.keep(), T0 + m * MIN), Some("late"), "{m}분 — 카드는 계속 떠 있어야");
    }
    assert_eq!(e.log, vec!["rate · left 55m · try #1", "lastChance · left 20m", "rate · left 20m · try #2", "card late"]);
}

#[test]
fn 마지막_한_번이_되면_쉬기도_풀린다() {
    let mut e = Env::new("last-ok", 55 * MIN);
    e.tick(T0, limited);
    e.tick(T0 + 40 * MIN, ok); // 15분 남음
    assert_eq!(e.live_part()["accessToken"], json!("new-tok-a"));
    assert_eq!(need(&e.keep(), T0 + 40 * MIN), None);
    assert_eq!(rate_file(&e).until, 0, "받았으면 다른 길도 다시 부를 수 있다");
}

#[test]
fn 막힌_게_아닌_실패는_10분_뒤_다시() {
    let mut e = Env::new("net", 55 * MIN);
    e.tick(T0, network);
    assert_eq!(e.keep().next_at, T0 + RETRY_MS);
    e.tick(T0 + RETRY_MS - 1, never);
    e.tick(T0 + RETRY_MS, network);
    assert_eq!(calls().len(), 2);
    assert_eq!(rate_file(&e).until, 0);
}

#[test]
fn 갱신_토큰이_죽으면_멈추고_카드_다시_로그인하면_풀린다() {
    let mut e = Env::new("dead", 40 * MIN);
    e.tick(T0, dead);
    let k = e.keep();
    assert_eq!(k.dead_exp, Some(T0 + 40 * MIN));
    assert_eq!(need(&k, T0), Some("dead"));
    assert_eq!(e.log, vec!["dead · left 40m · try #1", "card dead"]);
    // 죽은 동안엔 다시 안 보낸다
    e.tick(T0 + RETRY_MS, never);
    e.tick(T0 + 3 * RETRY_MS, never);
    // 다시 로그인 → 풀림
    e.login("a", T0 + 8 * HOUR);
    e.tick(T0 + 4 * RETRY_MS, never);
    assert_eq!(e.keep().dead_exp, None);
    assert_eq!(need(&e.keep(), T0 + 4 * RETRY_MS), None);
}

#[test]
fn 만료_15분_안이면_다시_보낼_때가_아니어도_매_차례_키체인을_본다() {
    // 막혀 쉬는 동안 세션이 스스로 갱신했으면 카드를 내려야 한다
    let mut e = Env::new("late-look", 14 * MIN);
    e.tick(T0, limited_30m);
    assert_eq!(need(&e.keep(), T0), Some("late"));
    e.login("a", T0 + 8 * HOUR); // 세션이 5분 전에 갱신에 성공
    e.tick(T0 + MIN, never);
    assert_eq!(need(&e.keep(), T0 + MIN), None);
}

#[test]
fn 갱신하면_같은_계정_보관_칸도_같은_새_값_다른_칸은_그대로() {
    let mut e = Env::new("slots", 3 * HOUR);
    // 칸 b·a 를 담는다 — 마지막에 담은 a 가 지금 계정
    e.login("b", T0 + 5 * HOUR);
    capture(&e.store, &e.live, &e.list, None, "b").unwrap();
    e.login("a", T0 + 50 * MIN);
    capture(&e.store, &e.live, &e.list, None, "a").unwrap();
    assert_eq!(load(&e.list).unwrap().current.as_deref(), Some("a"));
    let b_before = e.store.val(SLOT_SERVICE, "b").unwrap();
    e.tick(T0, ok);
    assert_eq!(e.slot("a"), e.live_part(), "보관 칸이 옛 갱신 토큰을 들고 있으면 다음 바꾸기 때 죽은 토큰");
    assert_eq!(e.slot("a")["refreshToken"], json!("rn-tok-a"));
    assert_eq!(e.store.val(SLOT_SERVICE, "b").unwrap(), b_before);
    // 백업 칸 등 다른 칸도 안 만든다
    let keys: Vec<(String, String)> = e.store.items.borrow().keys().cloned().collect();
    assert_eq!(keys.iter().filter(|(s, _)| s == SLOT_SERVICE).count(), 2);
}

#[test]
fn 지금_칸을_몰라도_같은_갱신_토큰을_든_칸은_같이() {
    let mut e = Env::new("slots-unknown", 50 * MIN);
    // 칸 목록엔 있는데 지금 칸은 모른다(사람이 밖에서 로그인을 바꿨다 등) — 표시는 다른 계정
    let pool = json!({ "accounts": [
        { "id": "x", "name": "x", "email": "", "plan": "", "order": 0, "oauth": oauth("x") },
        { "id": "y", "name": "y", "email": "", "plan": "", "order": 1, "oauth": oauth("y") },
    ] });
    std::fs::write(&e.list, pool.to_string()).unwrap();
    e.store.put(SLOT_SERVICE, "x", &json!({ "claudeAiOauth": e.live_part() }).to_string());
    e.store.put(SLOT_SERVICE, "y", &json!({ "claudeAiOauth": { "accessToken": "tok-y", "refreshToken": "r-tok-y", "expiresAt": T0 } }).to_string());
    e.tick(T0, ok);
    assert_eq!(e.slot("x")["refreshToken"], json!("rn-tok-a"));
    assert_eq!(e.slot("y")["refreshToken"], json!("r-tok-y"));
}

#[test]
fn 키체인에_새_값을_못_쓰면_죽은_것으로_카드() {
    let mut e = Env::new("notkept", 50 * MIN);
    *e.store.fail_set.borrow_mut() = Some(LIVE.into());
    e.tick(T0, ok);
    let k = e.keep();
    assert_eq!(k.last, "notKept");
    assert_eq!(need(&k, T0), Some("dead"));
    assert!(e.log[0].starts_with("notKept"));
}

#[test]
fn 잠금_자리를_모르거나_계정_로그인이_아니면_안_돈다() {
    // 설정 폴더를 모르면(시험 앱이 가짜 자리를 안 줌) 잠금 없이는 절대 안 한다
    let mut e = Env::new("nodir", 10 * MIN);
    e.live.claude_dir = None;
    e.tick(T0, never);
    assert_eq!(need(&e.keep(), T0), None);
    // 만료 시각이 없는 로그인(API 키·옛 로그인)·갱신 토큰 없음·로그아웃
    let mut e = Env::new("apikey", 10 * MIN);
    e.store.put(LIVE, "me", &json!({ "claudeAiOauth": { "accessToken": "a", "refreshToken": "r" } }).to_string());
    e.tick(T0, never);
    e.store.put(LIVE, "me", &json!({ "claudeAiOauth": { "accessToken": "a", "expiresAt": T0 } }).to_string());
    e.tick(T0 + LOOK_MAX_MS, never);
    e.store.items.borrow_mut().clear();
    e.tick(T0 + 2 * LOOK_MAX_MS, never);
    assert_eq!(need(&e.keep(), T0 + 2 * LOOK_MAX_MS), None);
    assert!(e.log.is_empty());
}

#[test]
fn 기록엔_토큰도_이메일도_없다() {
    let mut e = Env::new("log", 50 * MIN);
    e.tick(T0, limited);
    e.tick(T0 + RETRY_MS, dead);
    e.login("a", T0 + 8 * HOUR);
    e.tick(T0 + 2 * RETRY_MS, never);
    let text = e.log.join("\n") + &std::fs::read_to_string(&e.state).unwrap();
    for bad in ["tok-a", "r-tok", "@x.com", "u-a", "mcp-x"] {
        assert!(!text.contains(bad), "{bad} 가 기록에: {text}");
    }
}

/// 성공인데 새 토큰이 30분짜리 — 서버가 짧게 주면
fn ok_short(o: &Value) -> Result<Value, String> {
    record(o);
    let mut n = o.clone();
    n["refreshToken"] = format!("rs-{}", calls().len()).into();
    n["expiresAt"] = (T0 + 30 * MIN).into();
    Ok(n)
}

#[test]
fn 받은_토큰이_짧아도_매분_서버를_부르지_않는다() {
    let mut e = Env::new("short", 50 * MIN);
    e.tick(T0, ok_short);
    assert_eq!(e.keep().next_at, T0 + RETRY_MS);
    e.tick(T0 + MIN, never);
    e.tick(T0 + RETRY_MS - 1, never);
    // 세션이 먼저 갱신했는데 그것도 짧아도 같다
    let mut e = Env::new("short-session", 50 * MIN);
    let fresh = blob("tok-s", T0 + 40 * MIN);
    let n = std::cell::Cell::new(0);
    *e.store.on_get.borrow_mut() = Some(Box::new(move |f: &Fake, s: &str| {
        if s == LIVE {
            n.set(n.get() + 1);
            if n.get() == 2 {
                f.put(LIVE, "me", &fresh);
            }
        }
    }));
    e.tick(T0, never);
    assert_eq!(e.keep().next_at, T0 + RETRY_MS);
}
