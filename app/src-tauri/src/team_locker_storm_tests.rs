//! 요청 수 상한 — 화면이 실패한 목록을 쉬지 않고 다시 받지 않게(실패하면 물러선다).
//! 화면 셋(보관함 2초·프로필판 3초·팀 홈 3초 — ui/team/TeamLocker·useProfiles·TeamHome)과 방 찾기를 가짜 시계로 돌리고
//! 가짜 중계(FakeRelay)가 받은 요청을 센다
use super::*;
use crate::accounts_store::fake::Fake;
use crate::e2e_chain::Link;
use crate::e2e_envelope::Recipient;
use crate::e2e_roster::{team_hash, TLink};
use crate::team_relay::{mutate, Account, Room, TeamEntry};
use crate::team_test_util::FakeRelay;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use std::time::{Duration, Instant};

fn chain_link(acc: &str, k: &DeviceKeys, id: &str) -> Link {
    let body = json!({ "v": 1, "account": acc, "seq": 0, "prev": "", "by": id, "kind": "genesis", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{body}")), body }
}

fn tl(team: &str, by: &DeviceKeys, by_id: &str, seq: u64, prev: &str, f: Value) -> TLink {
    let mut b = json!({ "v": 1, "team": team, "seq": seq, "prev": prev, "by": by_id });
    b.as_object_mut().unwrap().extend(f.as_object().unwrap().clone());
    let body = b.to_string();
    TLink { seq, sig: by.sign(&format!("chammo-team/1\n{body}")), body, sig2: None }
}

/// 나(m1, a1, 기기 d1) 팀장 · 철수(m2, a2, 기기 p1)
fn roster(team: &str, mine: &DeviceKeys, peer: &DeviceKeys) -> Vec<TLink> {
    let t = tl(team, mine, "d1", 0, "", json!({ "kind": "team", "name": "샘플팀", "member": "m1", "account": "a1", "displayName": "사용자" }));
    let code = SigningKey::from_bytes(&crate::e2e_roster::invite_seed("C"));
    let pk = B64.encode(code.verifying_key().as_bytes());
    let i = tl(team, mine, "d1", 1, &team_hash(&t), json!({ "kind": "invite", "invPub": pk, "role": "member", "expires": 1 }));
    let mut j = tl(team, peer, "p1", 2, &team_hash(&i), json!({ "kind": "join", "invPub": pk, "member": "m2", "account": "a2", "displayName": "철수" }));
    j.sig2 = Some(B64.encode(code.sign(format!("chammo-team/1\n{}", j.body).as_bytes()).to_bytes()));
    vec![t, i, j]
}

/// 올리기를 받아 적기만 하는 중계 — 목록에 넣을 파일 한 줄을 만든다
#[derive(Default)]
struct Capture(RefCell<Value>);
impl core::Net for Capture {
    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
        if method == "POST" && path.ends_with("/locker/files") {
            *self.0.borrow_mut() = body.cloned().unwrap_or(Value::Null);
            return Ok((201, json!({})));
        }
        Ok((200, json!({ "ok": true })))
    }
    fn put(&self, _: &str, _: &[u8]) -> Result<u16, String> {
        Ok(200)
    }
    fn get(&self, _: &str) -> Result<(u16, Vec<u8>), String> {
        Ok((404, vec![]))
    }
}

struct World {
    d: PathBuf,
    kc: Fake,
    r: FakeRelay,
    team: String,
    file: Value,
    rev: RefCell<u64>,
}

impl World {
    /// broken = 철수 사슬이 명부의 철수 기기(p1)를 안 담는다 — 명부 검증이 늘 실패(QA 판처럼 목록이 한 번도 안 열림)
    fn new(tag: &str, broken: bool) -> World {
        let d = std::env::temp_dir().join(format!("chammo-storm-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let team = format!("ts-{tag}");
        let kc = Fake::default();
        let r = FakeRelay::default();
        let (k, acct) = crate::team_relay_keys::create(&kc).unwrap();
        r.devices.borrow_mut().push(("d1".into(), k.public()));
        mutate(&d, |s| {
            s.server = "https://relay.test".into();
            s.key_account = acct;
            s.device_id = "d1".into();
            s.account = Some(Account { id: "a1".into(), ..Default::default() });
            s.rooms = vec![Room { id: "rs".into(), kind: "self".into(), ..Default::default() }];
            s.put_team(TeamEntry { id: team.clone(), name: "샘플팀".into(), member_id: "m1".into(), role: "owner".into(), ..Default::default() });
        })
        .unwrap();
        crate::e2e_state::seed_self(&d, &kc);
        let mine = crate::e2e_state::load(&d).chains["a1"].clone();
        let peer = DeviceKeys::from_seeds([3; 32], [103; 32]);
        let peer_chain = if broken { chain_link("a2", &DeviceKeys::from_seeds([9; 32], [109; 32]), "p9") } else { chain_link("a2", &peer, "p1") };
        r.always("GET", "/v0/accounts/a1/chain", 200, &json!({ "links": mine }).to_string());
        r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [peer_chain] }).to_string());
        r.always("GET", &format!("/v0/teams/{team}/log"), 200, &json!({ "links": roster(&team, &k, &peer) }).to_string());
        r.always("GET", "/v0/me/rooms", 200, &json!({ "rooms": [{ "roomId": "rs", "kind": "self" }] }).to_string());
        r.always("GET", "/v0/me", 200, &json!({ "account": { "id": "a1" }, "device": { "name": "mac" } }).to_string());
        r.always("GET", "/v0/me/devices", 200, &json!({ "devices": [{ "id": "d1", "current": true, "createdAt": 1 }] }).to_string());
        // 내가 올린 파일 하나(나·철수 기기 몫 열쇠 둘 다 있음)
        let src = d.join("견적서.pdf");
        std::fs::write(&src, b"hello").unwrap();
        let to = vec![Recipient { device: "d1".into(), e2e: k.e2e_public() }, Recipient { device: "p1".into(), e2e: peer.e2e_public() }];
        let cap = Capture::default();
        core::upload(&cap, &Me { keys: &k, device: "d1" }, &to, &team, "", "file", "", &src, "견적서.pdf", &mut |_, _| {}).unwrap();
        let b = cap.0.into_inner();
        let mine_key = b["keys"].as_array().unwrap().iter().find(|x| x["d"] == "d1").unwrap().clone();
        let file = json!({ "id": b["id"], "room": null, "kind": "file", "state": "live", "size": b["size"], "parts": b["parts"], "kh": b["kh"], "sig": b["sig"],
            "meta": b["meta"], "metaBy": "d1", "metaSig": b["metaSig"], "by": { "member": "m1", "device": "d1" }, "createdAt": 1, "updatedAt": 1,
            "key": { "enc": mine_key["enc"], "w": mine_key["w"] }, "have": ["d1", "p1"] });
        let w = World { d, kc, r, team, file, rev: RefCell::new(0) };
        w.set_rev(1);
        w
    }

    /// 누가 보관함을 바꿨다 — 서버 판이 오르고 소켓이 알린다
    fn set_rev(&self, rev: u64) {
        *self.rev.borrow_mut() = rev;
        let path = format!("/v0/teams/{}/locker", self.team);
        let mut a = self.r.always.borrow_mut();
        a.retain(|(_, p, _, _)| *p != path);
        a.push(("GET".into(), path, 200, json!({ "rev": rev, "usage": { "used": 5, "reserved": 0, "seats": 2, "limit": 10 }, "files": [self.file] }).to_string()));
    }

    fn bump(&self) {
        let rev = *self.rev.borrow() + 1;
        self.set_rev(rev);
        nudge(&self.team, rev);
    }

    fn count(&self) -> usize {
        self.r.seen.borrow().len()
    }

    fn by_path(&self) -> BTreeMap<String, usize> {
        let mut m = BTreeMap::new();
        for (meth, p, _, _) in self.r.seen.borrow().iter() {
            let k = format!("{meth} {}", p.replace(&self.team, ":t"));
            *m.entry(k).or_insert(0) += 1;
        }
        m
    }
}

/// 화면 셋 + 방 찾기 + 기기 카드(device_cards — /me·/me/devices)를 secs 초 동안. bump_every 초마다 보관함이 바뀐다(0 = 안 바뀜). 돌려주는 건 요청 수
fn run(w: &World, secs: u64, bump_every: u64) -> usize {
    let base = Instant::now();
    let start = w.count();
    let (d, kc, r, team) = (&w.d, &w.kc, &w.r, w.team.as_str());
    // 여는 순간 — 셋 다 한 번씩 읽는다
    let mut prof_rev = 0u64;
    let mut home_rev = 0u64;
    let lk = |now| {
        if let Ok((_, job)) = list_split_at(d, kc, r, team, now) {
            job.run_at(d, kc, r, now);
        }
    };
    lk(base);
    if let Ok((v, _)) = list_split_at(d, kc, r, team, base) {
        prof_rev = v.rev;
    }
    if let Ok(v) = list_at(d, kc, r, team, base) {
        home_rev = v.rev;
    }
    let mut last_discover: Option<Instant> = None;
    let mut last_cards: Option<Instant> = None;
    for t in 1..=secs {
        let now = base + Duration::from_secs(t);
        if bump_every > 0 && t % bump_every == 0 {
            w.bump();
        }
        // 보관함 화면 — 2초마다 바뀜을 보고 목록(+ 뒤 스레드 봉투 더하기)
        if t % 2 == 0 && changed_at(team, now) {
            lk(now);
        }
        // 프로필판 — 3초마다, 본 판보다 새 판이 알려졌으면
        if t % 3 == 0 && crate::team_profile::changed_at(team, prof_rev, now) {
            if let Ok((v, _)) = list_split_at(d, kc, r, team, now) {
                prof_rev = v.rev;
            }
        }
        // 팀 홈 글판 — 3초마다(team_post::read 는 list = 목록 + 봉투 더하기)
        if t % 3 == 1 && crate::team_profile::changed_at(team, home_rev, now) {
            if let Ok(v) = list_at(d, kc, r, team, now) {
                home_rev = v.rev;
            }
        }
        // 방 찾기(GET /v0/me/rooms) — 내 기기끼리 방 소켓이 붙어 있다
        if last_discover.is_none_or(|l| now.duration_since(l) >= crate::team_relay_ws::discover_every(true)) {
            last_discover = Some(now);
            let _ = crate::team_relay::sync_rooms(d, kc, r);
        }
        // 기기 카드(허용 카드 맞추기) — 평소, 소켓이 붙어 있다
        if last_cards.is_none_or(|l| now.duration_since(l) >= crate::device_cards::poll_every(false, false, true)) {
            last_cards = Some(now);
            let _ = crate::team_account::refresh_me(d, kc, r);
        }
    }
    w.count() - start
}

#[test]
fn 목록이_늘_실패해도_1분에_중계를_17번_넘게_안_부른다() {
    let w = World::new("fail", true);
    nudge(&w.team, 1); // 누가 올렸다 — 화면이 본 판(0)보다 새 판
    let n = run(&w, 60, 0);
    eprintln!("실패 1분: {n}번 {:?}", w.by_path());
    // 한 번 시도 = 보관함 1 + 명부 1 + 사슬 4(캐시로 한 번, 새로 한 번) — 0초·60초 두 번 + 방 찾기 1 + 기기 카드 2
    assert!(n <= 17, "실패한 목록을 화면마다 2~3초마다 다시 받았다: 1분 {n}번 {:?}", w.by_path());
}

#[test]
fn 목록이_늘_실패하는_한_시간도_상한() {
    let w = World::new("fail1h", true);
    nudge(&w.team, 1);
    let n = run(&w, 3600, 0);
    eprintln!("실패 1시간: {n}번 {:?}", w.by_path());
    assert!(n <= 110, "실패 한 시간에 {n}번 {:?}", w.by_path());
}

#[test]
fn 실패_뒤엔_1분부터_두_배씩_15분까지_물러서고_새_판이_오면_한_번은_다시() {
    assert_eq!(fail_wait(1), Duration::from_secs(60));
    assert_eq!(fail_wait(2), Duration::from_secs(120));
    assert_eq!(fail_wait(4), Duration::from_secs(480));
    assert_eq!(fail_wait(5), Duration::from_secs(900));
    assert_eq!(fail_wait(40), Duration::from_secs(900));
    let w = World::new("backoff", true);
    let now = Instant::now();
    nudge(&w.team, 1);
    assert!(changed_at(&w.team, now));
    let e = list_split_at(&w.d, &w.kc, &w.r, &w.team, now).map(|_| ()).unwrap_err();
    let n = w.count();
    assert!(!changed_at(&w.team, now + Duration::from_secs(30)), "물러서는 동안은 화면에 바뀜을 안 알린다");
    assert!(!crate::team_profile::changed_at(&w.team, 0, now + Duration::from_secs(30)), "프로필판·팀 홈도");
    assert_eq!(list_split_at(&w.d, &w.kc, &w.r, &w.team, now + Duration::from_secs(30)).map(|_| ()).unwrap_err(), e, "같은 이유를 그대로");
    assert_eq!(w.count(), n, "물러서는 동안 중계를 안 부른다");
    assert!(changed_at(&w.team, now + Duration::from_secs(61)), "기다림이 끝나면 다시");
    w.bump(); // 새 판이 왔다 — 기다리지 않고 한 번
    assert!(changed_at(&w.team, now + Duration::from_secs(31)));
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, now + Duration::from_secs(31));
    assert!(w.count() > n);
    forget_people(&w.team);
    assert!(changed_at(&w.team, now + Duration::from_secs(32)), "team_changed·받아들이기가 물러서기도 지운다");
}

#[test]
fn 팀이_바뀌면_사람_목록을_새로_받는다() {
    let w = World::new("tc", false);
    let now = Instant::now();
    let logs = |w: &World| w.by_path().get("GET /v0/teams/:t/log").copied().unwrap_or(0);
    list_split_at(&w.d, &w.kc, &w.r, &w.team, now).unwrap();
    list_split_at(&w.d, &w.kc, &w.r, &w.team, now + Duration::from_secs(300)).unwrap();
    assert_eq!(logs(&w), 1, "5분 안엔 캐시");
    forget_people(&w.team); // 소켓 team_changed
    list_split_at(&w.d, &w.kc, &w.r, &w.team, now + Duration::from_secs(301)).unwrap();
    assert_eq!(logs(&w), 2, "팀이 바뀌면 바로 새로");
    list_split_at(&w.d, &w.kc, &w.r, &w.team, now + Duration::from_secs(301 + 600)).unwrap();
    assert_eq!(logs(&w), 3, "10분 지나면 새로(놓친 사슬 바뀜 대비)");
}

#[test]
fn 봉투가_다_있으면_사람_목록을_새로_안_받고_모자라면_새로_받아_더한다() {
    let w = World::new("share", false);
    let now = Instant::now();
    let (_, job) = list_split_at(&w.d, &w.kc, &w.r, &w.team, now).unwrap();
    let n = w.count();
    assert_eq!(job.run_at(&w.d, &w.kc, &w.r, now), 0);
    assert_eq!(w.count(), n, "다 가진 파일이면 중계를 안 부른다");
    // 철수 몫 봉투가 없는 파일 — 새로 받은 사람 목록으로 더한다
    let mut f: RemoteFile = serde_json::from_value(w.file.clone()).unwrap();
    f.have = vec!["d1".into()];
    let (st, k) = ctx(&w.d, &w.kc).unwrap();
    let (p, _) = people_cached(&w.d, &w.kc, &w.r, &st, &w.team, false, now).unwrap();
    let o = core::open_file(&Me { keys: &k, device: "d1" }, &p, &w.team, &f).unwrap();
    w.r.always("POST", "/keys", 200, "{}");
    let job = ShareJob { team: w.team.clone(), opened: vec![(f, o)] };
    assert_eq!(job.run_at(&w.d, &w.kc, &w.r, now), 1, "철수 기기(p1) 몫 하나");
    let after = w.by_path();
    assert_eq!(after.get("GET /v0/teams/:t/log"), Some(&2), "더하기 전에 명부를 새로 {after:?}");
}

#[test]
fn 쉬라는_429_를_받으면_그_시간_동안_아무_요청도_안_보낸다() {
    let w = World::new("slow", false);
    let (st, k) = ctx(&w.d, &w.kc).unwrap();
    w.r.answer("/v0/me/rooms", 429, r#"{"error":"slow_down"}"#);
    let e = relay::sync_rooms(&w.d, &w.kc, &w.r).unwrap_err();
    assert_eq!(e, relay::SLOW_DOWN, "401 같은 서명 실패로 안 본다");
    let n = w.count();
    assert!(relay::sync_rooms(&w.d, &w.kc, &w.r).is_err());
    assert!(list_split_at(&w.d, &w.kc, &w.r, &w.team, Instant::now()).is_err());
    assert_eq!(w.count(), n, "쉬는 동안 서버에 안 닿는다");
    let left = relay::slow_left(&k.public(), Instant::now()).unwrap();
    assert!(left > Duration::from_secs(55) && left <= Duration::from_secs(60), "Retry-After 60초 {left:?}");
    // 몸통에 retryAfter 가 있으면 그만큼 — 지난 시각으로 적어 쉬기를 끝낸다
    relay::slow_down(&k.public(), &json!({ "retryAfter": 5 }), Instant::now() - Duration::from_secs(10));
    assert!(relay::slow_left(&k.public(), Instant::now()).is_none());
    relay::sync_rooms(&w.d, &w.kc, &w.r).unwrap();
    assert_eq!(w.count(), n + 1, "끝나면 다시 보낸다");
    let _ = st;
}

#[test]
fn 평소_한_시간_요청_수_상한() {
    let w = World::new("idle", false);
    let n = run(&w, 3600, 0);
    eprintln!("평소(안 바뀜) 1시간: {n}번 {:?}", w.by_path());
    // 방 찾기 12 + 기기 카드 24(/me·/me/devices 5분마다) + 여는 순간 목록 셋·사람 목록 한 번 — 한 시간 60번(1분에 1번) 아래
    assert!(n <= 60, "아무것도 안 바뀌는 한 시간에 {n}번 {:?}", w.by_path());
}

#[test]
fn 보관함이_10분마다_바뀌는_한_시간_요청_수_상한() {
    let w = World::new("busy", false);
    let n = run(&w, 3600, 600);
    eprintln!("10분마다 바뀜 1시간: {n}번 {:?}", w.by_path());
    // 바뀔 때마다 화면 셋이 목록을 한 번씩(3) + 사람 목록 다시 확인은 10분에 한 번(명부 1 + 사슬 2) + 방 찾기 12 + 기기 카드 24
    assert!(n <= 90, "10분마다 바뀌는 한 시간에 {n}번 {:?}", w.by_path());
}
