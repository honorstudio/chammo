use super::*;
use crate::team_app::{item_key, seal, sig_text, By, APP_CAL};
use serde_json::json;
use std::path::PathBuf;

const K: [u8; 32] = [9u8; 32];

fn dk() -> DeviceKeys {
    DeviceKeys::from_seeds([3u8; 32], [4u8; 32])
}

fn row(team: &str, id: &str, rev: u64, data: &Value) -> Remote {
    row_del(team, id, rev, data, false)
}

fn row_del(team: &str, id: &str, rev: u64, data: &Value, del: bool) -> Remote {
    let ct = seal(&item_key(&K, team, APP_CAL), team, APP_CAL, id, &serde_json::to_vec(data).unwrap());
    let sig = dk().sign(&sig_text(team, APP_CAL, id, 0, "key1", &ct, del));
    Remote { id: id.into(), rev, base: 0, key: "key1".into(), ct, sig, by: By { member: "m1".into(), device: "d1".into() }, at: 5, del, deleted_at: del.then_some(6) }
}

fn ks() -> BTreeMap<String, [u8; 32]> {
    BTreeMap::from([("key1".to_string(), K)])
}
fn sg() -> BTreeMap<String, String> {
    BTreeMap::from([("d1".to_string(), dk().public())])
}

#[test]
fn 더_새_판만_반영하고_못_연_줄은_열쇠가_오면_다시() {
    let mut b = Book::default();
    assert!(b.apply("t1", APP_CAL, vec![row("t1", "ev1", 3, &json!({"title": "a"}))], &ks(), &sg()));
    assert!(!b.apply("t1", APP_CAL, vec![row("t1", "ev1", 2, &json!({"title": "옛"}))], &ks(), &sg()), "옛 판은 무시");
    assert_eq!(b.items["ev1"].1.data["title"], "a");
    assert_eq!(b.rev, 0, "줄 판으로 커서를 안 올린다 — 커서는 sync 응답의 서버 판만(리뷰 1)");
    // 열쇠 없이 온 줄 — why 가 붙고, 같은 판이라도 열쇠가 오면 다시 연다
    assert!(b.apply("t1", APP_CAL, vec![row("t1", "ev2", 4, &json!({"title": "b"}))], &BTreeMap::new(), &sg()));
    assert!(b.items["ev2"].1.why.contains("열쇠"));
    assert!(b.apply("t1", APP_CAL, vec![row("t1", "ev2", 4, &json!({"title": "b"}))], &ks(), &sg()));
    assert_eq!(b.items["ev2"].1.data["title"], "b");
    assert!(b.items["ev2"].1.why.is_empty());
}

#[test]
fn 소켓_기록째는_바로_반영되고_번호가_오른다_기록째가_아니면_sync_표시() {
    let d = Path::new("/tmp/team-app-push");
    let key = key(d, "t-push", APP_CAL);
    LIVE.lock().unwrap().insert(key.clone(), Live { book: Book::default(), ver: 1, keys: ks(), signers: sg() });
    let r = row("t-push", "ev1", 7, &json!({"title": "주간회의"}));
    push(d, &json!({ "t": "app", "team": "t-push", "app": APP_CAL, "items": [r] }));
    let v1 = ver(d, "t-push", APP_CAL);
    assert!(v1 > 1);
    assert_eq!(LIVE.lock().unwrap()[&key].book.items["ev1"].1.data["title"], "주간회의");
    assert!(!stale(d, "t-push", APP_CAL));
    push(d, &json!({ "t": "app", "team": "t-push", "app": APP_CAL, "items": [{ "id": "ev9", "rev": 9 }] }));
    assert!(stale(d, "t-push", APP_CAL), "{{id,rev}} 만 온 큰 기록은 sync 가 받게");
    assert!(ver(d, "t-push", APP_CAL) > v1);
    // 모르는 팀(이 기기가 아직 안 연 팀)은 무시
    push(d, &json!({ "t": "app", "team": "nope", "app": APP_CAL, "items": [] }));
    assert_eq!(ver(d, "nope", APP_CAL), 0);
}

#[test]
fn 기기_봉한_캐시는_같은_기기만_연다() {
    let dir = std::env::temp_dir().join(format!("team-app-cache-{}", crate::tools::tmp_tag()));
    let mut b = Book::default();
    b.apply("t1", APP_CAL, vec![row("t1", "ev1", 3, &json!({"title": "a"}))], &ks(), &sg());
    b.rev = 3;
    save_cache(&dir, &dk(), "t1", APP_CAL, &b);
    let got = read_cache(&dir, &dk(), "t1", APP_CAL).expect("같은 기기는 연다");
    assert_eq!(got.items["ev1"].1.data["title"], "a");
    assert_eq!(got.rev, 3);
    assert!(read_cache(&dir, &DeviceKeys::from_seeds([8u8; 32], [8u8; 32]), "t1", APP_CAL).is_none(), "다른 기기 열쇠로는 못 연다");
    assert!(read_cache(&dir, &dk(), "t2", APP_CAL).is_none(), "팀이 다르면 없다");
    save_cache(&dir, &dk(), "../x", APP_CAL, &b);
    assert!(!dir.join("x-calendar.bin").exists(), "이상한 팀 id 는 안 쓴다");
    let raw = std::fs::read(cache_path(&dir, "t1", APP_CAL)).unwrap();
    assert!(!String::from_utf8_lossy(&raw).contains("title"), "평문이 파일에 안 남는다");
    let _ = std::fs::remove_dir_all(dir);
}

// ── 0.4.5 리뷰(fix/review-cal) — 가짜 중계로 sync·write 를 끝까지 ──

/// 팀 tV 에 든 기기 d7(가짜 키체인) + 가짜 중계 + 앱 열쇠 기억(appkey 줄 key1 = K, 서명 기기 d1)
fn in_team(tag: &str) -> (PathBuf, crate::accounts_store::fake::Fake, crate::team_test_util::FakeRelay) {
    let d = std::env::temp_dir().join(format!("team-app-{tag}-{}", crate::tools::tmp_tag()));
    std::fs::create_dir_all(&d).unwrap();
    let kc = crate::accounts_store::fake::Fake::default();
    let (k, account) = crate::team_relay_keys::create(&kc).unwrap();
    relay::mutate(&d, |s| {
        s.server = "https://relay.test".into();
        s.key_account = account;
        s.device_id = "d7".into();
        s.account = Some(relay::Account { id: "a1".into(), email: "me@example.com".into(), name: "지수".into() });
        s.teams = vec![relay::TeamEntry { id: "tV".into(), name: "ACME".into(), member_id: "m1".into(), role: "owner".into(), ..Default::default() }];
        s.team_id = "tV".into();
    })
    .unwrap();
    let r = crate::team_test_util::FakeRelay::default();
    r.devices.borrow_mut().push(("d7".into(), k.public()));
    let file = crate::team_locker::RemoteFile { id: "key1".into(), kind: "appkey".into(), state: "live".into(), have: vec!["d7".into()], created_at: 1, ..Default::default() };
    let people = crate::team_locker::People {
        recipients: vec![crate::e2e_envelope::Recipient { device: "d7".into(), e2e: k.e2e_public() }],
        signers: BTreeMap::from([("d1".to_string(), dk().public()), ("d7".to_string(), k.public())]),
        names: BTreeMap::new(),
    };
    locker::seed_app_keys(&d, "tV", vec![(file, K)], people);
    (d, kc, r)
}

#[test]
fn 소켓_한_줄이_since_커서를_받지_않은_판_너머로_밀지_않는다() {
    // 리뷰 1 — 커서 5 에서 소켓으로 rev 7 한 줄이 오면 커서가 7 이 돼 rev 6 을 영영 못 받았다
    let (d, kc, r) = in_team("since");
    let k_ = key(&d, "tV", APP_CAL);
    let mut book = Book::default();
    book.apply("tV", APP_CAL, vec![row("tV", "ev5", 5, &json!({"title": "다섯"}))], &ks(), &sg());
    book.rev = 5;
    LIVE.lock().unwrap().insert(k_.clone(), Live { book, ver: 1, keys: ks(), signers: sg() });
    push(&d, &json!({ "t": "app", "team": "tV", "app": APP_CAL, "items": [row("tV", "ev7", 7, &json!({"title": "일곱"}))] }));
    assert_eq!(LIVE.lock().unwrap()[&k_].book.rev, 5, "소켓 줄은 커서를 안 민다");
    r.answer(&format!("/apps/{APP_CAL}/since/5"), 200, &json!({ "rev": 7, "full": false, "items": [row("tV", "ev6", 6, &json!({"title": "여섯"})), row("tV", "ev7", 7, &json!({"title": "일곱"}))] }).to_string());
    let (s, _) = sync(&d, &kc, &r, "tV", APP_CAL).unwrap();
    assert_eq!(s.rev, 7);
    assert!(s.items.iter().any(|i| i.id == "ev6" && i.data["title"] == "여섯"), "놓칠 뻔한 rev 6: {:?}", s.items.iter().map(|i| &i.id).collect::<Vec<_>>());
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn 고치다_남이_지운_걸_알면_그_삭제를_기록장에_반영한다() {
    // 리뷰 6 — 409 + 서버 쪽 삭제(Gone)면 '다시 살리기' 알림인데 화면엔 옛 snap(살아 있음)이 갔다
    let (d, kc, r) = in_team("gone");
    let k_ = key(&d, "tV", APP_CAL);
    let mut book = Book::default();
    book.apply("tV", APP_CAL, vec![row("tV", "ev1", 3, &json!({"title": "회의"}))], &ks(), &sg());
    book.rev = 3;
    LIVE.lock().unwrap().insert(k_.clone(), Live { book, ver: 1, keys: ks(), signers: sg() });
    let gone = row_del("tV", "ev1", 4, &json!({"title": "회의"}), true);
    r.answer(&format!("/apps/{APP_CAL}/items/ev1"), 409, &json!({ "error": "stale", "item": gone }).to_string());
    let w = write(&d, &kc, &r, "tV", APP_CAL, "ev1", 3, Some(json!({"title": "회의"})), Some(json!({"title": "회의 11시"})), false).unwrap();
    assert!(w.gone);
    let it = w.snap.items.iter().find(|i| i.id == "ev1").unwrap();
    assert!(it.del && it.rev == 4, "남이 지운 판으로 보인다: {it:?}");
    assert!(LIVE.lock().unwrap()[&k_].book.items["ev1"].1.del);
    let _ = std::fs::remove_dir_all(d);
}
