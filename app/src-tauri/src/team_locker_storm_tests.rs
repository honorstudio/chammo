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
    /// 목록에 같이 나갈 파일(못 믿는 기기가 올린 것·봉투가 모자란 것)
    extra: RefCell<Vec<Value>>,
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
        let w = World { d, kc, r, team, file, extra: RefCell::new(vec![]), rev: RefCell::new(0) };
        w.set_rev(1);
        w
    }

    /// 누가 보관함을 바꿨다 — 서버 판이 오르고 소켓이 알린다
    fn set_rev(&self, rev: u64) {
        *self.rev.borrow_mut() = rev;
        let path = format!("/v0/teams/{}/locker", self.team);
        let mut a = self.r.always.borrow_mut();
        a.retain(|(_, p, _, _)| *p != path);
        let files: Vec<Value> = std::iter::once(self.file.clone()).chain(self.extra.borrow().iter().cloned()).collect();
        a.push(("GET".into(), path, 200, json!({ "rev": rev, "usage": { "used": 5, "reserved": 0, "seats": 2, "limit": 10 }, "files": files }).to_string()));
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
fn 물러서는_중에도_폰이_옛_판이면_같다고_안_한다() {
    // 10-27 리뷰 — phone_same 이 !changed_at 이라 물러서는 동안(changed_at = false) 알린 판이 폰 본 판보다 새로워도 {same:true}
    let w = World::new("phone-backoff", true);
    let now = Instant::now();
    nudge(&w.team, 5);
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, now).map(|_| ()).unwrap_err();
    let later = now + Duration::from_secs(30);
    assert!(crate::team_locker_app::backing_off(&w.team, later));
    assert!(!crate::team_profile::phone_same(&w.team, 3), "폰 본 판(3) < 알린 판(5) — 그대로라고 하면 안 된다");
    assert!(crate::team_profile::phone_same(&w.team, 5), "본 판 = 알린 판이면 그대로");
    assert!(crate::team_profile::phone_same(&w.team, 6), "본 판이 더 새로우면(맥 재시작 뒤 알린 판이 다시 쌓일 때) 그대로");
}

#[test]
fn 팀이_바뀌면_사람_목록을_새로_받는다() {
    let w = World::new("tc", false);
    let now = Instant::now();
    let logs = |w: &World| w.by_path().get("GET /v0/teams/:t/log").copied().unwrap_or(0);
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, now).unwrap();
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, now + Duration::from_secs(300)).unwrap();
    assert_eq!(logs(&w), 1, "5분 안엔 캐시");
    forget_people(&w.team); // 소켓 team_changed
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, now + Duration::from_secs(301)).unwrap();
    assert_eq!(logs(&w), 2, "팀이 바뀌면 바로 새로");
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, now + Duration::from_secs(301 + 600)).unwrap();
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

#[test]
fn 목록_기억이_없을_때_썸네일_열기가_여럿이어도_목록은_한_번() {
    // 10-26 실측(fix/team-latency3) — 앱을 막 켜면 봉해 둔 마지막 목록이 바로 떠서 카드 썸네일(peek)이 목록 기억 없이 먼저 불린다.
    // 썸네일마다 크기 보려고 목록 한 번 + 열려고 또 한 번이라 사진 셋 = 목록 여섯(요청 14개, 운영 약 7초)이었다
    let w = World::new("thumbs", false);
    forget(&w.team);
    forget_people(&w.team);
    let id = w.file["id"].as_str().unwrap().to_string();
    let lists = |w: &World| w.by_path().get("GET /v0/teams/:t/locker").copied().unwrap_or(0);
    for _ in 0..3 {
        let (_, _, _, f, o) = find(&w.d, &w.kc, &w.r, &w.team, &id).unwrap();
        assert_eq!((f.id.as_str(), o.meta.name.as_str()), (id.as_str(), "견적서.pdf"));
    }
    assert_eq!(lists(&w), 1, "목록은 한 번 받아 기억 {:?}", w.by_path());
    // 크기 확인도 같은 길로 — 미리보기가 목록을 따로 안 받는다(조각 받기는 curl 이라 가짜 중계로는 끝까지 못 돌린다)
    let src = include_str!("team_locker_app.rs");
    let peek_src = src.split("pub fn peek(").nth(1).unwrap().split("\n}\n").next().unwrap();
    assert!(!peek_src.contains("fetch_list"), "peek 은 find(기억 채우기)로 크기를 본다");
    // 누가 바꿔서 판이 오르면 기억은 버리고 한 번 새로
    w.bump();
    find(&w.d, &w.kc, &w.r, &w.team, &id).unwrap();
    find(&w.d, &w.kc, &w.r, &w.team, &id).unwrap();
    assert_eq!(lists(&w), 2, "새 판엔 한 번만 새로 {:?}", w.by_path());
    // 없는 파일은 예전처럼 '없어'
    assert!(find(&w.d, &w.kc, &w.r, &w.team, "nooooooooooooooooooo").unwrap_err().contains("없어"));
}

#[test]
fn 알린_판보다_옛_목록을_받아도_방금_받은_목록으로_찾는다() {
    // 10-27 리뷰 — 소켓이 알린 판(9) > 서버가 준 목록 판(1)이면 기억(recall)이 None 이라 같은 find 가 목록을 한 번 더 받았다
    let w = World::new("stale-list", false);
    forget(&w.team);
    forget_people(&w.team);
    nudge(&w.team, 9);
    let id = w.file["id"].as_str().unwrap().to_string();
    let lists = |w: &World| w.by_path().get("GET /v0/teams/:t/locker").copied().unwrap_or(0);
    let (_, _, _, f, o) = find(&w.d, &w.kc, &w.r, &w.team, &id).unwrap();
    assert_eq!((f.id.as_str(), o.meta.name.as_str()), (id.as_str(), "견적서.pdf"));
    assert_eq!(lists(&w), 1, "목록 한 번으로 찾는다 {:?}", w.by_path());
    assert!(find(&w.d, &w.kc, &w.r, &w.team, "nooooooooooooooooooo").unwrap_err().contains("없어"), "없는 파일은 그대로 '없어'");
}

/// 가짜 중계가 지금 주는 명부·사슬로 만든 팀 머리(진짜 중계 GET /heads 와 같은 모양)
fn heads_now(w: &World) -> Value {
    let body = |path: &str| -> Value { serde_json::from_str(&w.r.always.borrow().iter().find(|(m, p, _, _)| m == "GET" && p == path).unwrap().3).unwrap() };
    let log: Vec<TLink> = serde_json::from_value(body(&format!("/v0/teams/{}/log", w.team))["links"].clone()).unwrap();
    let last = log.last().unwrap();
    let ch = |acc: &str| {
        let l: Vec<Link> = serde_json::from_value(body(&format!("/v0/accounts/{acc}/chain"))["links"].clone()).unwrap();
        let x = l.last().unwrap();
        json!({ "seq": x.seq, "hash": crate::e2e_chain::link_hash(&x.body, &x.sig) })
    };
    json!({ "log": { "seq": last.seq, "hash": team_hash(last) }, "chains": { "a1": ch("a1"), "a2": ch("a2") } })
}

#[test]
fn 팀_머리가_캐시와_같으면_사슬과_명부를_다시_안_받는다() {
    // 10-26 실측(fix/team-latency3) — 올리기·보내기마다 내 사슬·명부·사람마다 사슬을 차례로 받았다(3명 팀 4요청). 머리 한 번이면 된다
    let w = World::new("heads", false);
    let path = format!("/v0/teams/{}/heads", w.team);
    w.r.always("GET", &path, 200, &heads_now(&w).to_string());
    let now = Instant::now();
    let st = relay::load_state(&w.d);
    people_cached(&w.d, &w.kc, &w.r, &st, &w.team, true, now).unwrap(); // 처음 — 철수 사슬·명부는 캐시에 없어 받는다
    let first = w.by_path();
    people_cached(&w.d, &w.kc, &w.r, &st, &w.team, true, now).unwrap();
    let second = w.by_path();
    let diff = |k: &str| second.get(k).copied().unwrap_or(0) - first.get(k).copied().unwrap_or(0);
    assert_eq!((diff("GET /v0/teams/:t/heads"), diff("GET /v0/accounts/a1/chain"), diff("GET /v0/accounts/a2/chain"), diff("GET /v0/teams/:t/log")), (0, 0, 0, 0), "30초 안엔 받은 머리로 — 요청 없음 {second:?}");
    // 30초가 지났다(기억 버림) — 머리 하나로 끝
    crate::e2e_state::forget_heads(&w.team);
    people_cached(&w.d, &w.kc, &w.r, &st, &w.team, true, now).unwrap();
    let again = w.by_path();
    let diff = |k: &str| again.get(k).copied().unwrap_or(0) - second.get(k).copied().unwrap_or(0);
    assert_eq!((diff("GET /v0/teams/:t/heads"), diff("GET /v0/accounts/a1/chain"), diff("GET /v0/accounts/a2/chain"), diff("GET /v0/teams/:t/log")), (1, 0, 0, 0), "머리 하나로 끝 {again:?}");
    let second = again;
    // 철수가 기기를 들였다(머리가 다르다) — 철수 사슬만 새로
    let mut h = heads_now(&w);
    h["chains"]["a2"]["seq"] = json!(1);
    w.r.always.borrow_mut().retain(|(_, p, _, _)| *p != path);
    w.r.always("GET", &path, 200, &h.to_string());
    // 배경은 받은 머리를 30초 기억한다 — 지난 기억을 버리고(30초 뒤처럼) 다시
    crate::e2e_state::forget_heads(&w.team);
    people_cached(&w.d, &w.kc, &w.r, &st, &w.team, true, now).unwrap();
    let third = w.by_path();
    assert_eq!(third["GET /v0/accounts/a2/chain"] - second["GET /v0/accounts/a2/chain"], 1, "바뀐 사람 사슬은 새로 {third:?}");
    assert_eq!(third.get("GET /v0/accounts/a1/chain"), second.get("GET /v0/accounts/a1/chain"), "안 바뀐 내 사슬은 그대로");
}

#[test]
fn 머리_길이_없는_옛_중계에선_예전처럼_받고_404_는_한_번만() {
    let w = World::new("noheads", false);
    let now = Instant::now();
    let st = relay::load_state(&w.d);
    let a = people_cached(&w.d, &w.kc, &w.r, &st, &w.team, true, now).unwrap();
    let b = people_cached(&w.d, &w.kc, &w.r, &st, &w.team, true, now).unwrap();
    assert_eq!(a.0.recipients.len(), b.0.recipients.len());
    let m = w.by_path();
    assert_eq!(m.get("GET /v0/teams/:t/heads").copied().unwrap_or(0), 1, "옛 중계라는 답은 기억 {m:?}");
    // 예전 길 그대로 — 처음엔 명부 검증용으로 한 번(캐시 없음) + 받는 사람 셈으로 한 번, 두 번째엔 받는 사람 셈으로 한 번
    assert_eq!((m["GET /v0/accounts/a2/chain"], m["GET /v0/teams/:t/log"]), (3, 2), "머리가 없으면 예전처럼 늘 새로 {m:?}");
}

#[test]
fn 화면이_본_판과_견주면_다른_화면이_목록을_받아도_바뀜을_놓치지_않는다() {
    let w = World::new("since", false);
    let now = Instant::now();
    let (v, _) = list_split_at(&w.d, &w.kc, &w.r, &w.team, now).unwrap();
    let mine = v.rev;
    assert!(!changed_since_at(&w.team, mine, now), "본 판 그대로면 안 받는다");
    w.bump();
    // 다른 화면(팀 홈·대화 파일 보기)이 먼저 목록을 받아 마지막 판이 올라간다
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, now);
    assert!(!changed_at(&w.team, now), "마지막 목록 판으로 보면 이 화면은 놓친다(옛 길)");
    assert!(changed_since_at(&w.team, mine, now), "자기가 본 판과 견주면 안 놓친다");
    forget_people(&w.team);
}

// ── 목록 같이 쓰기(10-28 23:07~23:12 실측: 이 맥 앱 GET /locker 4분 반에 579번) ──

fn lists(w: &World) -> usize {
    w.by_path().get("GET /v0/teams/:t/locker").copied().unwrap_or(0)
}

#[test]
fn 화면_다섯이_같은_때_목록을_불러도_망으론_한_번() {
    let w = World::new("share-list", false);
    let base = Instant::now();
    for _ in 0..5 {
        let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, base);
    }
    assert_eq!(lists(&w), 1, "{:?}", w.by_path());
    // 소켓이 새 판을 알리면 한 번 새로
    w.bump();
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, base + Duration::from_secs(3));
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, base + Duration::from_secs(3));
    assert_eq!(lists(&w), 2);
}

#[test]
fn 알린_판이_목록_판보다_앞서_안_맞아도_20초에_한_번만_받는다() {
    let w = World::new("stuck-rev", false);
    let base = Instant::now();
    nudge(&w.team, 99); // 서버 목록은 판 1 — 끝내 안 맞는다
    for t in 0..=120u64 {
        let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, base + Duration::from_secs(t));
    }
    let n = lists(&w);
    assert!(n <= 7, "2분에 목록 {n}번(1초마다 부름) {:?}", w.by_path());
}

#[test]
fn 내가_보관함을_바꾸면_다음_목록은_바로_새로() {
    let w = World::new("write-forget", false);
    let base = Instant::now();
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, base);
    forget_listing(&format!("/v0/teams/{}/locker/files/x/trash", w.team));
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, base);
    assert_eq!(lists(&w), 2);
}

// ── 팀 앱 열쇠(0.4.5 리뷰 7 — 캘린더 sync·쓰기마다 보관함 전체 목록 + 사람 목록을 받았다) ──

#[test]
fn 팀_앱_열쇠는_기억해_두고_보관함_목록을_매번_안_받는다() {
    let w = World::new("appkeys", false);
    forget(&w.team);
    forget_people(&w.team);
    let base = Instant::now();
    // 캘린더 sync 넷(30초 간격) — 사이에 다른 사람이 보관함에 파일을 올림(앱 열쇠와 상관없음)
    for i in 0..4u64 {
        if i == 2 {
            w.bump();
        }
        let _ = app_keys_at(&w.d, &w.kc, &w.r, &w.team, false, base + Duration::from_secs(30 * i)).unwrap();
    }
    eprintln!("팀 앱 열쇠 넷: 요청 {}번 {:?}", w.count(), w.by_path());
    assert_eq!(lists(&w), 1, "목록은 처음 한 번 {:?}", w.by_path());
    // 팀이 바뀌면(소켓 team_changed → forget_people) 새로, 쓸 열쇠를 못 고르면(fresh) 새로
    forget_people(&w.team);
    let _ = app_keys_at(&w.d, &w.kc, &w.r, &w.team, false, base + Duration::from_secs(150)).unwrap();
    assert_eq!(lists(&w), 2, "팀이 바뀌면 새로 {:?}", w.by_path());
    let _ = app_keys_at(&w.d, &w.kc, &w.r, &w.team, true, base + Duration::from_secs(180)).unwrap();
    assert_eq!(lists(&w), 3, "fresh 면 새로 {:?}", w.by_path());
    // 10분 지나면 새로
    let _ = app_keys_at(&w.d, &w.kc, &w.r, &w.team, false, base + Duration::from_secs(180 + 11 * 60)).unwrap();
    assert_eq!(lists(&w), 4, "10분 지나면 새로 {:?}", w.by_path());
    forget_people(&w.team);
}

// ── 배경 몫 근본(10-30 23:51 사용자 '팀 일정을 못 불러왔어요 — 잠시 쉬래요'). 진단 줄: 10분에 GET /heads 185·149, POST …/keys 154, GET /locker 48 ──

/// 목록에 파일 한 줄 더 — by 기기가 봉해 올린 것, to 기기 몫 봉투, have = 서버가 가졌다는 기기
fn sealed(w: &World, by: &DeviceKeys, by_dev: &str, by_member: &str, to_extra: Vec<Recipient>, have: &[&str]) -> Value {
    let k = relay::device_keys(&w.kc, &relay::load_state(&w.d)).unwrap();
    let src = w.d.join("메모.txt");
    std::fs::write(&src, b"memo").unwrap();
    let mut to = vec![Recipient { device: "d1".into(), e2e: k.e2e_public() }];
    to.extend(to_extra);
    let cap = Capture::default();
    core::upload(&cap, &Me { keys: by, device: by_dev }, &to, &w.team, "", "file", "", &src, "메모.txt", &mut |_, _| {}).unwrap();
    let b = cap.0.into_inner();
    let mine = b["keys"].as_array().unwrap().iter().find(|x| x["d"] == "d1").unwrap().clone();
    json!({ "id": b["id"], "room": null, "kind": "file", "state": "live", "size": b["size"], "parts": b["parts"], "kh": b["kh"], "sig": b["sig"],
        "meta": b["meta"], "metaBy": by_dev, "metaSig": b["metaSig"], "by": { "member": by_member, "device": by_dev }, "createdAt": 2, "updatedAt": 2,
        "key": { "enc": mine["enc"], "w": mine["w"] }, "have": have })
}

/// 사용자 맥 모양 — 진짜 중계처럼 /heads 가 있고, 소켓이 알린 판이 목록 판보다 앞서 화면 셋이 2~3초마다 목록을 다시 부른다
fn busy_world(tag: &str) -> World {
    let w = World::new(tag, false);
    w.r.always("GET", &format!("/v0/teams/{}/heads", w.team), 200, &heads_now(&w).to_string());
    w
}

fn heads(w: &World) -> usize {
    w.by_path().get("GET /v0/teams/:t/heads").copied().unwrap_or(0)
}

fn posts(w: &World) -> usize {
    w.by_path().iter().filter(|(k, _)| k.starts_with("POST ") && k.ends_with("/keys")).map(|(_, n)| n).sum()
}

#[test]
fn 못_믿는_기기가_올린_파일이_있어도_목록마다_사람_목록을_새로_안_받는다() {
    // 나간 사람·모르는 기기(x9)가 올린 파일 — 사람 목록을 새로 받아도 끝내 못 연다. 예전엔 목록을 부를 때마다(2~3초) 새로 받아 /heads 가 3초마다
    let w = busy_world("stranger");
    let x9 = DeviceKeys::from_seeds([7; 32], [107; 32]);
    w.extra.borrow_mut().push(sealed(&w, &x9, "x9", "m3", vec![Recipient { device: "x9".into(), e2e: x9.e2e_public() }], &["d1", "x9"]));
    w.set_rev(1);
    nudge(&w.team, 99);
    let n = run(&w, 600, 0);
    eprintln!("못 믿는 파일 10분: {n}번 {:?}", w.by_path());
    assert!(heads(&w) <= 3, "10분에 /heads {}번 {:?}", heads(&w), w.by_path());
    assert!(n < 50, "아무것도 안 하는 10분에 배경 {n}번 {:?}", w.by_path());
    // 파일 하나 열기(find)가 다른 못 믿는 파일 기억을 지우지 않는다
    let id = w.file["id"].as_str().unwrap().to_string();
    forget(&w.team);
    let h = heads(&w);
    find(&w.d, &w.kc, &w.r, &w.team, &id).unwrap();
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, Instant::now());
    assert_eq!(heads(&w), h, "기억한 못 믿는 파일이라 사람 목록을 또 안 받는다 {:?}", w.by_path());
    // 팀이 바뀌면(team_changed) 다시 한 번은 새로 — 그새 그 사람을 믿게 됐을 수 있다
    let before = heads(&w);
    forget_people(&w.team);
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, Instant::now() + Duration::from_secs(700));
    assert!(heads(&w) > before, "팀이 바뀌면 사람을 새로 {:?}", w.by_path());
}

#[test]
fn 남의_새_기기가_올린_파일을_묵은_팀_머리로_못_믿는다고_굳히지_않는다() {
    // 10-31 리뷰: 배경 heads 는 30초 기억 — 모르는 서명 기기를 보고 사람 목록을 새로 받을 때 묵은 머리를 쓰면 철수의 새 기기(p2)를 못 보고,
    // 그 파일이 '못 믿는 파일'로 굳어 사람 목록 수명(10분) 동안 안 열린다. 남의 사슬이 늘어도 중계는 team_changed 를 안 보낸다
    let w = busy_world("newdev");
    forget(&w.team);
    forget_people(&w.team);
    let base = Instant::now();
    let _ = list_split_at(&w.d, &w.kc, &w.r, &w.team, base).unwrap(); // 철수 사슬(p1)·팀 머리를 기억
    let peer = DeviceKeys::from_seeds([3; 32], [103; 32]);
    let p2 = DeviceKeys::from_seeds([4; 32], [104; 32]);
    let g = chain_link("a2", &peer, "p1");
    let body = json!({ "v": 1, "account": "a2", "seq": 1, "prev": crate::e2e_chain::link_hash(&g.body, &g.sig), "by": "p1", "kind": "add", "device": "p2", "edPub": p2.public(), "e2ePub": p2.e2e_public(), "selfSig": p2.e2e_key_sig() }).to_string();
    let add = Link { seq: 1, sig: peer.sign(&format!("chammo-chain/1\n{body}")), body };
    {
        let mut a = w.r.always.borrow_mut();
        a.retain(|(_, p, _, _)| p != "/v0/accounts/a2/chain");
        a.push(("GET".into(), "/v0/accounts/a2/chain".into(), 200, json!({ "links": [g, add] }).to_string()));
    }
    let hp = format!("/v0/teams/{}/heads", w.team);
    let h = heads_now(&w).to_string();
    w.r.always.borrow_mut().retain(|(_, p, _, _)| *p != hp);
    w.r.always("GET", &hp, 200, &h);
    w.extra.borrow_mut().push(sealed(&w, &p2, "p2", "m2", vec![Recipient { device: "p2".into(), e2e: p2.e2e_public() }], &["d1", "p2"]));
    w.bump();
    let (v, _) = list_split_at(&w.d, &w.kc, &w.r, &w.team, base + Duration::from_secs(5)).unwrap();
    assert!(v.items.iter().all(|i| i.why.is_empty()), "철수 새 기기 파일도 열린다 {:?}", v.items.iter().map(|i| (&i.by, &i.why)).collect::<Vec<_>>());
    forget(&w.team);
    forget_people(&w.team);
}

#[test]
fn 서버가_봉투를_거절하면_같은_파일_같은_기기에_다시_안_올린다() {
    // 철수 기기(p1) 몫 봉투가 없는 파일 — 서버는 p1 을 받는 기기로 안 쳐 준다(나간 사람·끊긴 기기·폰). 예전엔 목록마다 다시 올렸다(10분 154번)
    let w = busy_world("refused");
    let k = relay::device_keys(&w.kc, &relay::load_state(&w.d)).unwrap();
    for _ in 0..5 {
        w.extra.borrow_mut().push(sealed(&w, &k, "d1", "m1", vec![], &["d1"]));
    }
    w.set_rev(1);
    w.r.always("POST", "/keys", 400, r#"{"error":"bad_keys"}"#);
    nudge(&w.team, 99);
    let n = run(&w, 600, 0);
    eprintln!("봉투 거절 10분: {n}번 {:?}", w.by_path());
    assert!(posts(&w) <= 1, "같은 기기 봉투를 10분에 {}번 {:?}", posts(&w), w.by_path());
    assert!(heads(&w) <= 4, "10분에 /heads {}번 {:?}", heads(&w), w.by_path());
    assert!(lists(&w) <= 31, "거절된 POST 가 목록 기억을 지웠다: 목록 {}번 {:?}", lists(&w), w.by_path());
    assert!(n < 50, "아무것도 안 하는 10분에 배경 {n}번 {:?}", w.by_path());
}

#[test]
fn 봉투를_더하는_한_번에_올리는_수는_상한까지() {
    // 파일 50+ 에 새 기기 하나 — 한 번에 다 올리지 않고 상한만큼, 나머지는 다음 목록에서
    let w = busy_world("cap");
    let k = relay::device_keys(&w.kc, &relay::load_state(&w.d)).unwrap();
    for _ in 0..60 {
        w.extra.borrow_mut().push(sealed(&w, &k, "d1", "m1", vec![], &["d1"]));
    }
    w.set_rev(1);
    w.r.always("POST", "/keys", 200, "{}");
    let now = Instant::now();
    let (_, job) = list_split_at(&w.d, &w.kc, &w.r, &w.team, now).unwrap();
    let added = job.run_at(&w.d, &w.kc, &w.r, now);
    assert_eq!(posts(&w), MAX_SHARE_POSTS, "한 번에 {}번 {:?}", posts(&w), w.by_path());
    assert_eq!(added, MAX_SHARE_POSTS, "p1 몫 하나씩");
}

#[test]
fn 사람_동작이_서버_429_를_받으면_칸이_곧_넘어갈_때만_한_번_다시() {
    // 10-30 23:59 팀 홈 꾸미기 [완료] — 배경 폭주가 서버 칸(열쇠당 10분 300)까지 채워 사람 몫도 서버 429
    assert_eq!(relay::human_retry_wait(0), None, "칸 맨 앞 — 10분 기다릴 순 없다");
    assert_eq!(relay::human_retry_wait(relay::BUCKET_MS - 20_000), Some(Duration::from_millis(20_500)));
    assert_eq!(relay::human_retry_wait(relay::BUCKET_MS - 61_000), None);
    let w = World::new("human429", false);
    w.r.answer("/v0/me/rooms", 429, r#"{"error":"slow_down"}"#);
    w.r.answer("/v0/me/rooms", 429, r#"{"error":"slow_down"}"#);
    relay::RETRY_TS.with(|t| t.set(relay::BUCKET_MS - 5_000));
    let n = w.count();
    assert!(relay::as_human(|| relay::sync_rooms(&w.d, &w.kc, &w.r)).is_err(), "다시 해도 429 면 실패");
    assert_eq!(w.count(), n + 2, "한 번만 다시 {:?}", w.by_path());
    relay::RETRY_TS.with(|t| t.set(0));
    w.r.answer("/v0/me/rooms", 429, r#"{"error":"slow_down"}"#);
    let n = w.count();
    assert!(relay::as_human(|| relay::sync_rooms(&w.d, &w.kc, &w.r)).is_err());
    assert_eq!(w.count(), n + 1, "칸이 멀면 안 기다리고 바로 실패");
    // 배경은 다시 안 한다(쉬는 동안 아예 안 나간다)
    relay::RETRY_TS.with(|t| t.set(relay::BUCKET_MS - 5_000));
    let n = w.count();
    assert!(relay::sync_rooms(&w.d, &w.kc, &w.r).is_err());
    assert_eq!(w.count(), n, "배경은 쉬는 중");
    relay::RETRY_TS.with(|t| t.set(0));
}
