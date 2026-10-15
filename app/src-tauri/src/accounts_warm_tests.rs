//! 쉬는 칸 미리 데우기 — 가짜 키체인·가짜 갱신기·가짜 시계. 실제 토큰 주소는 안 부른다
use super::*;
use crate::accounts::{capture, load, merge_oauth, Live, Pool, SLOT_SERVICE};
use crate::accounts_refresh::{needs, Refresher};
use crate::accounts_store::fake::Fake;
use serde_json::json;
use std::cell::RefCell;
use std::path::PathBuf;

const LIVE: &str = "Claude Code-credentials";
const HOUR: i64 = 3600_000;
const MIN: i64 = 60_000;
/// 가짜 시계 — 먼 앞날(2096년쯤): 바꾸기(switch)는 진짜 시계로 needs 를 보는데, 데운 칸이 진짜 지금 기준으로도 넉넉하게
const T0: i64 = 4_000_000_000_000;

thread_local! {
    /// 가짜 갱신기가 받은 갱신 토큰들(한 시험 = 한 스레드)
    static CALLS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

fn calls() -> Vec<String> {
    CALLS.with(|c| c.borrow().clone())
}

fn record(o: &Value) {
    CALLS.with(|c| c.borrow_mut().push(o["refreshToken"].as_str().unwrap_or("").to_string()));
}

/// 성공 — 새 토큰은 가짜 시계 처음 + 10시간까지(시험은 몇 시간 안에 끝난다)
fn ok(o: &Value) -> Result<Value, String> {
    record(o);
    let mut n = o.clone();
    n["accessToken"] = format!("warm-{}", o["accessToken"].as_str().unwrap()).into();
    n["refreshToken"] = format!("rw-{}", o["accessToken"].as_str().unwrap()).into();
    n["expiresAt"] = (T0 + 10 * HOUR).into();
    Ok(n)
}

fn limited(o: &Value) -> Result<Value, String> {
    record(o);
    Err("rate".into())
}

fn limited_2h(o: &Value) -> Result<Value, String> {
    record(o);
    Err("rate:7200".into())
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
    panic!("바꾸는 순간엔 서버를 부르면 안 된다")
}

fn oauth(who: &str) -> Value {
    json!({ "accountUuid": format!("u-{who}"), "organizationUuid": format!("o-{who}"), "emailAddress": format!("{who}@x.com"), "organizationRateLimitTier": "default_claude_max_5x" })
}

/// 만료 시각이 있는 로그인(계정 로그인만)
fn blob(tok: &str, exp: i64) -> String {
    json!({ "claudeAiOauth": { "accessToken": tok, "refreshToken": format!("r-{tok}"), "expiresAt": exp, "scopes": ["user:inference"] } }).to_string()
}

struct Env {
    dir: PathBuf,
    list: PathBuf,
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
    /// 칸 a·b·c — 담은 순서대로 로그인하고 담아서, 마지막에 담은 c 가 지금 계정. 칸 토큰은 다 만료 1시간 전
    fn new(tag: &str, who: &[&str]) -> Env {
        let dir = std::env::temp_dir().join(format!("chammo-warm-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let claude_json = dir.join(".claude.json");
        std::fs::write(&claude_json, "{}").unwrap();
        let e = Env {
            list: dir.join("accounts.json"),
            live: Live { service: LIVE.into(), account: "me".into(), claude_json, claude_dir: None, refresh: never },
            dir,
            store: Fake::default(),
            log: Vec::new(),
        };
        for w in who {
            e.login(w, T0 + HOUR);
            capture(&e.store, &e.live, &e.list, None, w).unwrap();
        }
        e
    }
    fn login(&self, who: &str, exp: i64) {
        self.store.put(LIVE, "me", &blob(&format!("tok-{who}"), exp));
        merge_oauth(&self.live.claude_json, &oauth(who)).unwrap();
    }
    fn put_slot(&self, id: &str, tok: &str, exp: i64) {
        self.store.put(SLOT_SERVICE, id, &blob(tok, exp));
    }
    fn slot(&self, id: &str) -> Value {
        let v: Value = serde_json::from_str(&self.store.val(SLOT_SERVICE, id).unwrap()).unwrap();
        v["claudeAiOauth"].clone()
    }
    fn live_val(&self) -> String {
        self.store.val(LIVE, "me").unwrap()
    }
    fn pool(&self) -> Pool {
        load(&self.list).unwrap()
    }
    fn warm(&mut self, now: i64, w: Refresher) -> Option<String> {
        let mut lines = Vec::new();
        let r = run(&self.store, &self.live, &self.list, now, w, &mut |l: &str| lines.push(l.to_string())).unwrap();
        self.log.extend(lines);
        r
    }
}

// ── 고르기(순수) ─────────────────────────────────────

fn cand(id: &str, exp: Option<i64>) -> Cand {
    Cand { id: id.into(), exp, refreshable: true }
}

#[test]
fn 남은_시간이_2시간_안인_칸만_가장_먼저_만료되는_것부터() {
    let w = Warm::default();
    let c = [cand("a", Some(T0 + 3 * HOUR)), cand("b", Some(T0 + 90 * MIN)), cand("c", Some(T0 - 39 * HOUR))];
    assert_eq!(pick(&w, &c, T0), Some(2)); // 이미 만료된 칸(39시간 지남)부터 — 갱신 토큰은 살아 있다
    assert_eq!(pick(&w, &c[..2], T0), Some(1));
    assert_eq!(pick(&w, &c[..1], T0), None); // 3시간 남은 칸은 아직
    // 만료 시각을 모르거나 갱신 토큰이 없으면 안 건드린다(바꾸기도 안 건드린다 — accounts_refresh::needs)
    assert_eq!(pick(&w, &[cand("a", None)], T0), None);
    assert_eq!(pick(&w, &[Cand { id: "a".into(), exp: Some(T0), refreshable: false }], T0), None);
}

#[test]
fn 한_번에_하나_칸_사이엔_간격() {
    let c = [cand("a", Some(T0)), cand("b", Some(T0))];
    let w = Warm { last_at: T0 - GAP_MS + 1, ..Warm::default() };
    assert_eq!(pick(&w, &c, T0), None);
    let w = Warm { last_at: T0 - GAP_MS, ..Warm::default() };
    assert!(pick(&w, &c, T0).is_some());
}

#[test]
fn 쉬는_중이면_안_보내고_죽은_칸은_칸_값이_바뀔_때까지_안_건드린다() {
    let c = [cand("a", Some(T0)), cand("b", Some(T0 + MIN))];
    // 전체 쉬기(429 — 이 맥 IP 단위)는 여기 없다 — 세 길이 같이 보는 token_rate 가 run 앞에서 막는다
    // 칸 하나 쉬기 → 다른 칸
    let mut w = Warm::default();
    w.slots.insert("a".into(), WarmSlot { rest_until: T0 + 1, dead_exp: None });
    assert_eq!(pick(&w, &c, T0), Some(1));
    // 죽은 칸 — 그때 만료 시각과 같으면 그대로 죽음, 칸 값이 바뀌면(다시 담음) 다시 후보
    let mut w = Warm::default();
    w.slots.insert("a".into(), WarmSlot { rest_until: 0, dead_exp: Some(T0) });
    assert_eq!(pick(&w, &c, T0), Some(1));
    assert_eq!(pick(&w, &[cand("a", Some(T0 + 5))], T0), Some(0));
}

// ── 돌리기 ─────────────────────────────────────────

#[test]
fn 쉬는_칸만_데우고_지금_계정은_절대_안_건드린다() {
    let mut e = Env::new("live-safe", &["a", "b"]);
    // 지금 계정 b 가 더 먼저 만료 — 그래도 앱은 안 건드린다(Claude Code 세션이 갱신한다)
    e.login("b", T0 + 10 * MIN);
    e.put_slot("b", "tok-b", T0 + 10 * MIN);
    let live_before = e.live_val();
    assert_eq!(e.warm(T0, ok), Some("a".into()));
    assert_eq!(calls(), vec!["r-tok-a"]);
    assert_eq!(e.live_val(), live_before);
    assert_eq!(e.slot("b")["accessToken"], json!("tok-b"));
    // 데운 칸은 바꾸는 순간 서버를 안 부른다
    assert_eq!(e.slot("a")["accessToken"], json!("warm-tok-a"));
    assert!(!needs(&e.slot("a"), T0));
    crate::accounts::switch(&e.store, &e.live, &e.list, "a").unwrap(); // never — 불리면 실패
    // 다음 차례(간격 뒤)엔 이제 쉬는 칸이 된 b 를
    assert_eq!(e.warm(T0 + GAP_MS, ok), Some("b".into()));
    assert_eq!(e.slot("b")["accessToken"], json!("warm-tok-b"));
    assert_eq!(calls(), vec!["r-tok-a", "r-tok-b"]);
}

#[test]
fn 지금_칸을_모를_때도_로그인과_같은_계정_칸과_같은_토큰_칸은_뺀다() {
    let mut e = Env::new("live-unknown", &["a", "b", "c"]);
    // 지금 칸을 모름(밖에서 로그인을 바꿨다 등) — 로그인 표시가 c 면 c 는 뺀다
    let mut p = e.pool();
    p.current = None;
    crate::accounts::save(&e.list, &p).unwrap();
    assert_eq!(e.warm(T0, ok), Some("a".into()));
    // 로그인 표시는 b 인데 키체인 토큰이 a 칸 것과 같다(어긋난 중) — 둘 다 빼서 아무것도 안 보낸다
    e.put_slot("a", "tok-x", T0);
    e.store.put(LIVE, "me", &blob("tok-x", T0));
    merge_oauth(&e.live.claude_json, &oauth("b")).unwrap();
    let mut p = e.pool();
    p.current = None;
    crate::accounts::save(&e.list, &p).unwrap();
    assert_eq!(e.warm(T0 + 2 * GAP_MS, ok), Some("c".into()));
    assert_eq!(calls(), vec!["r-tok-a", "r-tok-c"]);
}

#[test]
fn 자동_전환을_껐거나_칸이_하나거나_바꾸는_중이면_안_돈다() {
    let mut one = Env::new("one", &["a"]);
    assert_eq!(one.warm(T0, ok), None);
    let mut e = Env::new("off", &["a", "b"]);
    crate::accounts::patch_auto(&e.list, &json!({ "on": false })).unwrap();
    assert_eq!(e.warm(T0, ok), None);
    crate::accounts::patch_auto(&e.list, &json!({ "on": true })).unwrap();
    let mut p = e.pool();
    p.switching = Some(crate::accounts::Switching { from: Some("b".into()), to: "a".into() });
    crate::accounts::save(&e.list, &p).unwrap();
    assert_eq!(e.warm(T0, ok), None);
    assert!(calls().is_empty());
    // 자동 상태가 아예 없으면(처음 쓰는 사람) 켜짐으로 본다 — 화면 readAuto 와 같다
    let mut p = e.pool();
    p.switching = None;
    p.auto = Value::Null;
    crate::accounts::save(&e.list, &p).unwrap();
    assert_eq!(e.warm(T0, ok), Some("a".into()));
}

#[test]
fn 여러_칸이_곧_만료여도_한_번에_하나씩_간격을_두고() {
    let mut e = Env::new("spread", &["a", "b", "c", "d"]);
    e.put_slot("a", "tok-a", T0 + 30 * MIN);
    e.put_slot("b", "tok-b", T0 - 95 * HOUR);
    e.put_slot("c", "tok-c", T0 + 10 * MIN);
    assert_eq!(e.warm(T0, ok), Some("b".into()));
    // 5분 뒤 차례 — 간격 안이라 안 보낸다
    assert_eq!(e.warm(T0 + 5 * MIN, ok), None);
    assert_eq!(e.warm(T0 + GAP_MS, ok), Some("c".into()));
    assert_eq!(e.warm(T0 + 2 * GAP_MS, ok), Some("a".into()));
    assert_eq!(e.warm(T0 + 3 * GAP_MS, ok), None); // 다 데웠다
    assert_eq!(calls().len(), 3);
    // 기록 — 한 번 보낼 때마다 한 줄, 몇 번째인지. 토큰은 없다
    assert_eq!(e.log.len(), 3);
    assert!(e.log[2].contains("3"), "{:?}", e.log);
    for l in &e.log {
        assert!(!l.contains("tok-") && !l.contains("r-") && !l.contains("warm-"), "기록에 토큰: {l}");
    }
}

#[test]
fn 막히면_길게_쉬고_서버가_준_만큼_쉰다() {
    let mut e = Env::new("rate", &["a", "b", "c"]);
    assert_eq!(e.warm(T0, limited), Some("a".into()));
    // 429 는 이 맥 IP 단위 — 다른 칸도 1시간 안 보낸다
    assert_eq!(e.warm(T0 + 59 * MIN, ok), None);
    assert_eq!(calls().len(), 1);
    assert_eq!(e.slot("a")["accessToken"], json!("tok-a"), "실패면 칸 값 그대로");
    assert_eq!(e.warm(T0 + HOUR, ok).is_some(), true);
    // Retry-After 를 주면 그만큼(1시간보다 길면)
    let mut e = Env::new("rate-2h", &["a", "b", "c"]);
    e.warm(T0, limited_2h);
    assert_eq!(e.warm(T0 + 119 * MIN, ok), None);
    assert!(e.warm(T0 + 120 * MIN, ok).is_some());
    assert!(e.log.iter().any(|l| l.contains("rate")));
}

#[test]
fn 막힘은_세_길이_같이_보는_파일에_남고_이어지면_2배() {
    let mut e = Env::new("rate-shared", &["a", "b", "c"]);
    let rp = crate::token_rate::path_for(&e.list);
    e.warm(T0, limited);
    let r = crate::token_rate::load(&rp);
    assert_eq!((r.until, r.by.as_str(), r.count), (T0 + HOUR, "warm", 1));
    // 풀리자마자 또 막힘 — 2시간
    assert!(e.warm(T0 + HOUR, limited).is_some());
    assert_eq!(crate::token_rate::load(&rp).until, T0 + 3 * HOUR);
    assert_eq!(e.warm(T0 + 3 * HOUR - 1, ok), None);
    assert_eq!(calls().len(), 2);
    // 받으면 풀린다
    assert!(e.warm(T0 + 3 * HOUR, ok).is_some());
    assert_eq!(crate::token_rate::load(&rp).until, 0);
}

#[test]
fn 다른_길이_막혀_둔_쉬기도_지키고_키체인도_안_읽는다() {
    let mut e = Env::new("rate-other", &["a", "b", "c"]);
    let r = crate::token_rate::Rate { until: T0 + 3 * HOUR, at: T0, count: 1, by: "keep".into(), ..Default::default() };
    crate::token_rate::save(&crate::token_rate::path_for(&e.list), &r);
    *e.store.locked.borrow_mut() = true; // 키체인을 읽으면 오류가 난다
    for k in 0..9 {
        assert_eq!(run(&e.store, &e.live, &e.list, T0 + k * GAP_MS, never, &mut |_: &str| {}).unwrap(), None);
    }
    *e.store.locked.borrow_mut() = false;
    assert!(e.warm(T0 + 3 * HOUR, ok).is_some());
}

#[test]
fn 인터넷이_안_되면_그_칸만_쉬고_다음_차례엔_다른_칸() {
    let mut e = Env::new("net", &["a", "b", "c"]);
    assert_eq!(e.warm(T0, network), Some("a".into()));
    assert_eq!(e.warm(T0 + GAP_MS, ok), Some("b".into()));
    assert_eq!(e.warm(T0 + 2 * GAP_MS, ok), None); // a 는 1시간 쉼
    assert_eq!(e.warm(T0 + HOUR, ok), Some("a".into()));
}

#[test]
fn 갱신_토큰이_죽은_칸은_다시_안_보내고_다시_담으면_풀린다() {
    let mut e = Env::new("dead", &["a", "b", "c"]);
    assert_eq!(e.warm(T0, dead), Some("a".into()));
    assert_eq!(e.warm(T0 + GAP_MS, ok), Some("b".into()));
    for k in 2..10 {
        assert_eq!(e.warm(T0 + k * GAP_MS, ok), None, "죽은 칸을 또 보냈다");
    }
    assert_eq!(calls(), vec!["r-tok-a", "r-tok-b"]);
    assert_eq!(dead_ids(&e.pool()), vec!["a".to_string()]);
    // 사람이 그 계정으로 다시 로그인해 담았다 — 칸 값이 바뀌어 다시 후보
    e.put_slot("a", "tok-a2", T0 + 11 * GAP_MS);
    assert_eq!(e.warm(T0 + 11 * GAP_MS, ok), Some("a".into()));
    assert!(dead_ids(&e.pool()).is_empty());
}

#[test]
fn 키체인이_잠겼으면_조용히_넘어간다() {
    let mut e = Env::new("locked", &["a", "b"]);
    *e.store.locked.borrow_mut() = true;
    let r = run(&e.store, &e.live, &e.list, T0, ok, &mut |_: &str| {});
    assert!(r.is_err());
    *e.store.locked.borrow_mut() = false;
    assert!(calls().is_empty());
    assert_eq!(e.warm(T0, ok), Some("a".into()));
}

#[test]
fn 데우기_상태는_목록_파일에_토큰_없이() {
    let mut e = Env::new("file", &["a", "b"]);
    e.warm(T0, dead);
    let text = std::fs::read_to_string(&e.list).unwrap();
    assert!(text.contains("\"warm\""), "{text}");
    for bad in ["tok-", "r-tok", "accessToken", "refreshToken"] {
        assert!(!text.contains(bad), "{bad} 가 목록 파일에: {text}");
    }
    // 데우기를 한 번도 안 했으면 칸이 안 생긴다(옛 파일 모양 그대로)
    let e2 = Env::new("file-none", &["a", "b"]);
    assert!(!std::fs::read_to_string(&e2.list).unwrap().contains("warm"));
}
