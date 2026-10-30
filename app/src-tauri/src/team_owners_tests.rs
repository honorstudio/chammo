use super::*;
use crate::accounts_store::fake::Fake;
use crate::e2e_chain::Link;
use crate::e2e_team::{after_create, after_invite, after_join};
use crate::team_relay::{mutate, Account, Member, TeamEntry};
use crate::team_test_util::FakeRelay;
use serde_json::{json, Value};
use std::path::PathBuf;

struct Dev {
    dir: PathBuf,
    kc: Fake,
    /// 이 기기 계정 사슬의 첫 고리 — 다른 기기가 GET /v0/accounts/:a/chain 으로 받아 가는 모양
    genesis: Link,
}

fn member(id: &str, role: &str) -> Member {
    Member { id: id.into(), display_name: id.into(), role: role.into(), perms: vec![], devices: vec![] }
}

/// 계정 acc 의 기기 id — 팀 t1 의 멤버 member. role·server_members 는 **서버가 이 기기에 주는 값**(여기서 거짓말을 시킨다)
fn device(tag: &str, id: &str, acc: &str, member_id: &str, role: &str, server_members: Vec<Member>, r: &FakeRelay) -> Dev {
    // 시험은 병렬이라 폴더 이름이 호출마다 달라야 한다(같은 tag 를 다른 시험이 써도 서로 안 덮어쓰게)
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!("chammo-owners-{tag}-{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    let kc = Fake::default();
    let (k, key_acct) = crate::team_relay_keys::create(&kc).unwrap();
    r.devices.borrow_mut().push((id.into(), k.public()));
    mutate(&d, |s| {
        s.server = "https://relay.test".into();
        s.key_account = key_acct;
        s.device_id = id.into();
        s.account = Some(Account { id: acc.into(), ..Default::default() });
        s.put_team(TeamEntry { id: "t1".into(), name: "샘플팀".into(), member_id: member_id.into(), role: role.into(), display_name: member_id.into(), members: server_members });
        s.select_current("t1");
    })
    .unwrap();
    let body = json!({ "v": 1, "account": acc, "seq": 0, "prev": "", "by": id, "kind": "genesis", "device": id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    let genesis = Link { seq: 0, sig: k.sign(&format!("chammo-chain/1\n{body}")), body };
    crate::e2e_state::seed_trusted(&d, acc, vec![genesis.clone()]);
    Dev { dir: d, kc, genesis }
}

fn posted(r: &FakeRelay) -> Vec<crate::e2e_roster::TLink> {
    r.seen.borrow().iter().filter(|(m, p, _, _)| m == "POST" && p == "/v0/teams/t1/log").map(|(_, _, _, b)| serde_json::from_value(serde_json::from_str::<Value>(b).unwrap()["link"].clone()).unwrap()).collect()
}

fn answer_log(r: &FakeRelay, links: &[crate::e2e_roster::TLink]) {
    r.answer("/v0/teams/t1/log", 200, &json!({ "links": links }).to_string());
}

/// 하늘(a1·기기 o1·m1)이 팀을 만들고 철수(a2·기기 c1·m2)가 초대로 들어온 진짜 서명 명부를 서버가 내주는 세상.
/// 두 기기의 서버 값(role·members)은 호출하는 쪽이 정한다 — 서명된 명부는 팀장 m1 하나, 팀원 m2 하나
fn world(server_for_owner: (&str, Vec<Member>), server_for_joiner: (&str, Vec<Member>)) -> (FakeRelay, Dev, Dev) {
    let r = FakeRelay::default();
    let od = device("owner", "o1", "a1", "m1", server_for_owner.0, server_for_owner.1, &r);
    let jd = device("joiner", "c1", "a2", "m2", server_for_joiner.0, server_for_joiner.1, &r);
    r.answer("/v0/teams/t1/log", 201, "{}");
    after_create(&od.dir, &od.kc, &r, "t1", "m1", "하늘", "샘플팀").unwrap();
    answer_log(&r, &posted(&r));
    r.answer("/v0/teams/t1/log", 201, "{}");
    after_invite(&od.dir, &od.kc, &r, "t1", "CODE-XYZ", 99).unwrap();
    answer_log(&r, &posted(&r));
    r.answer("/v0/teams/t1/log", 201, "{}");
    after_join(&jd.dir, &jd.kc, &r, "t1", "CODE-XYZ", "m2", "철수").unwrap();
    // 이제부터는 읽기만 — 명부와 두 계정 사슬을 몇 번이고 내준다
    r.always("GET", "/v0/teams/t1/log", 200, &json!({ "links": posted(&r) }).to_string());
    r.always("GET", "/v0/accounts/a1/chain", 200, &json!({ "links": [od.genesis.clone()] }).to_string());
    r.always("GET", "/v0/accounts/a2/chain", 200, &json!({ "links": [jd.genesis.clone()] }).to_string());
    (r, od, jd)
}

#[test]
fn 서버가_팀원을_팀장이라_해도_명부의_팀장만_팀장이다() {
    // 철수(m2)는 명부상 팀원인데 서버는 철수 기기에 "너도 팀장, 철수도 팀장"이라고 거짓말한다
    let lie = vec![member("m1", "owner"), member("m2", "owner")];
    let (r, _od, jd) = world(("owner", vec![]), ("owner", lie));
    assert_eq!(holders(&jd.dir, &jd.kc, &r, "t1", "all"), vec!["m1".to_string()], "철수는 서버가 팀장이라 해도 팀장이 아니다");
}

#[test]
fn 서버가_팀장을_팀원이라_해도_명부의_팀장은_팀장이다() {
    // 하늘(m1) 기기에 서버가 "너는 팀원, 철수가 팀장"이라고 거짓말한다 — 서명된 명부는 하늘 하나
    let lie = vec![member("m1", "member"), member("m2", "owner")];
    let (r, od, _jd) = world(("member", lie), ("member", vec![]));
    assert_eq!(holders(&od.dir, &od.kc, &r, "t1", "all"), vec!["m1".to_string()]);
}

#[test]
fn 명부를_못_받으면_아무도_팀장이_아니다() {
    // 서버가 명부를 안 내주고(500) 캐시도 없다 — 서버 목록이 철수를 팀장이라 해도 믿을 근거가 없으니 닫는다
    let r = FakeRelay::default();
    let jd = device("closed", "c1", "a2", "m2", "owner", vec![member("m2", "owner")], &r);
    r.always("GET", "/v0/teams/t1/log", 500, r#"{"error":"boom"}"#);
    assert_eq!(holders(&jd.dir, &jd.kc, &r, "t1", "all"), Vec::<String>::new());
}

#[test]
fn 팀장을_가르는_모듈은_서버_members_의_role_을_안_본다() {
    // 서버 GET members 의 role 로 팀장을 가르는 줄이 다시 생기면 막는다 — 팀장은 team_owners(서명된 명부)로만 센다(relay ADR 0014 R14).
    // 서버가 막는 길로 가는 팀 지우기·역할 바꾸기(team_relay)와 화면에 보이기만 하는 team_cmd 의 role 은 여기 대상이 아니다
    for (name, src) in [
        ("team_home_store", include_str!("team_home_store.rs")),
        ("team_post", include_str!("team_post.rs")),
        ("team_agent_store", include_str!("team_agent_store.rs")),
        ("team_profile", include_str!("team_profile.rs")),
        ("team_rooms", include_str!("team_rooms.rs")),
    ] {
        assert!(!src.contains("role == \"owner\"") && !src.contains("role != \"owner\""), "{name} 이 서버 role 로 팀장을 가른다");
    }
    // 항목마다 맞는 권한으로 거른다(relay ADR 0014 항목 표)
    for (name, src, item) in [
        ("team_home_store", include_str!("team_home_store.rs"), "\"look\")"),
        ("team_profile", include_str!("team_profile.rs"), "\"look\")"),
        ("team_post", include_str!("team_post.rs"), "\"posts\")"),
        ("team_agent_store", include_str!("team_agent_store.rs"), "\"agents\")"),
        ("team_rooms", include_str!("team_rooms.rs"), "holders(\"all\")"),
    ] {
        assert!(src.contains(item), "{name} 은 {item} 권한으로 거른다");
    }
}

#[test]
fn 명부를_잠깐_못_받으면_마지막으로_확인한_명부로_센다() {
    // 0.4.5 리뷰 3 — 일시 실패(망·5xx)를 '팀장 없음'으로 바꿔 홈·고정 글·팀 아이콘이 접히고 진짜 팀장의 편집 단추도 사라졌다
    let (r, od, _jd) = world(("owner", vec![]), ("member", vec![]));
    let st = crate::team_relay::load_state(&od.dir);
    // 한 번 확인해 둔 명부(디스크) — 1분 안 다시 쓰기 기록(RECV_AT)은 안 남기는 길로
    crate::e2e_state::roster_of(&od.dir, &od.kc, &r, &st, "t1").unwrap();
    for _ in 0..3 {
        r.answer("/v0/teams/t1/log", 503, r#"{"error":"unavailable"}"#);
    }
    assert_eq!(holders(&od.dir, &od.kc, &r, "t1", "all"), vec!["m1".to_string()], "확인 안 됨 ≠ 팀장 아님");
}
