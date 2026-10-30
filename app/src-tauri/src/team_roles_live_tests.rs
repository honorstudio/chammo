// 팀 권한 손 시험(relay ADR 0014) — 로컬 중계(wrangler dev, 로컬 D1 0016, TEAM_ROLES=1)와 가짜 구글로 시험 HQ 세 개.
// 돌리기(켬): CHAMMO_E2E_LIVE=http://localhost:8797 CHAMMO_MOCK_GOOGLE=http://127.0.0.1:8791 cargo test team_owners::live::켬 -- --ignored --nocapture
// 돌리기(끔): 중계를 TEAM_ROLES 없이 다시 띄우고 … cargo test team_owners::live::끔 -- --ignored --nocapture
use crate::accounts_store::fake::Fake;
use crate::e2e_flow::{self, live, Status};
use crate::team_relay::{self as relay, Curl};
use std::path::PathBuf;

fn chained(tag: &str, server: &str, sub: &str, name: &str) -> (PathBuf, Fake) {
    let (d, k) = live::login(tag, server, sub, name);
    e2e_flow::start_chain(&d, &k, &Curl).unwrap();
    assert_eq!(e2e_flow::ensure(&d, &k, &Curl).unwrap(), Status::InChain);
    (d, k)
}

fn team(d: &PathBuf) -> String {
    relay::load_state(d).team_id
}

/// 이 기기가 검증한 명부(새로 받음) — 그 사람의 (역할, 권한)
fn seen(d: &PathBuf, k: &Fake, member: &str) -> (String, Vec<String>) {
    let st = relay::load_state(d);
    let r = crate::e2e_state::roster_of(d, k, &Curl, &st, &st.team_id).unwrap();
    let m = &r.members[member];
    (m.role.clone(), m.perms.clone())
}

fn id_of(d: &PathBuf, name: &str) -> String {
    relay::load_state(d).members.iter().find(|m| m.display_name == name).map(|m| m.id.clone()).expect(name)
}

/// 하늘(팀장)·민아·철수 한 팀
fn three(server: &str, run: u64) -> [(PathBuf, Fake); 3] {
    let o = chained("ro", server, &format!("roles-o-{run}"), "하늘");
    let a = chained("ra", server, &format!("roles-a-{run}"), "민아");
    let c = chained("rc", server, &format!("roles-c-{run}"), "철수");
    relay::create(&o.0, &o.1, &Curl, "", &format!("권한팀 {run}"), "하늘", "mac").unwrap();
    for (x, n) in [(&a, "민아"), (&c, "철수")] {
        let inv = relay::invite(&o.0, &o.1, &Curl, "").unwrap();
        relay::join(&x.0, &x.1, &Curl, "", &inv.link, n, "mac").unwrap();
    }
    for x in [&o, &a, &c] {
        relay::refresh_members(&x.0, &x.1, &Curl, "").unwrap();
    }
    [o, a, c]
}

#[test]
#[ignore]
fn 켬() {
    let Some(server) = live::base() else { return eprintln!("CHAMMO_E2E_LIVE 없음 — 건너뜀") };
    let [(od, ok), (ad, ak), (cd, ck)] = three(&server, live::now());
    let (t, ma, mc, mo) = (team(&od), id_of(&od, "민아"), id_of(&od, "철수"), id_of(&ad, "하늘"));

    // ① 팀장이 민아 칩 켜기 → 민아·철수 기기 명부에 반영, 끄면 빠짐
    relay::set_perms(&od, &ok, &Curl, "", "민아", &["invite".into(), "kick".into()]).unwrap();
    assert_eq!(seen(&ad, &ak, &ma), ("member".into(), vec!["invite".into(), "kick".into()]));
    assert_eq!(seen(&cd, &ck, &ma).1, vec!["invite", "kick"]);
    eprintln!("① 켜기 → 민아·철수 명부 [invite, kick] · 화면 목록 role={:?}", relay::refresh_members(&cd, &ck, &Curl, "").unwrap().members.iter().find(|m| m.id == ma).map(|m| (m.role.clone(), m.perms.clone())));
    relay::set_perms(&od, &ok, &Curl, "", "민아", &["invite".into()]).unwrap();
    assert_eq!(seen(&cd, &ck, &ma).1, vec!["invite"]);
    eprintln!("① 끄기(kick) → 철수 명부 [invite]");

    // ② 권한 없는 일 — 꾸미기(이름·홈 판)·글 고정은 막힌다, 있는 일(초대)은 된다
    let rename = crate::team_manage::rename(&ad, &ak, &Curl, "", "바꿈");
    let home = crate::team_home_store::save_home(&ad, &ak, &Curl, &t, Default::default());
    let pin = crate::team_post::pin(&ad, &ak, &Curl, &t, "");
    let inv = relay::invite(&ad, &ak, &Curl, "");
    eprintln!("② 민아(invite) — 이름 {:?} · 홈 꾸미기 {:?} · 글 고정 {:?} · 초대 {}", rename.as_ref().err(), home.as_ref().err(), pin.as_ref().err(), inv.is_ok());
    assert!(rename.is_err() && home.is_err() && pin.is_err() && inv.is_ok());

    // ③ 철수를 전체 권한으로 → 철수가 민아 칩을 바꾸고, 전체 칩은 못 준다
    relay::set_perms(&od, &ok, &Curl, "", "철수", &["all".into()]).unwrap();
    relay::set_perms(&cd, &ck, &Curl, "", "민아", &["posts".into()]).unwrap();
    assert_eq!(seen(&od, &ok, &ma).1, vec!["posts"]);
    let all = relay::set_perms(&cd, &ck, &Curl, "", "민아", &["all".into()]);
    let peer = relay::set_perms(&cd, &ck, &Curl, "", "하늘", &[]);
    eprintln!("③ 철수(전체 권한) — 민아 [posts] 됨 · 민아에게 전체 {:?} · 팀장 내리기 {:?}", all.as_ref().err(), peer.as_ref().err());
    assert!(all.is_err() && peer.is_err());
    // 이제 민아(posts)는 글 고정이 된다(명부 1분 캐시를 거쳐도 — 새로 받은 명부로)
    crate::e2e_state::recv_forget(&ad);
    eprintln!("③ 민아(posts) 글 고정 풀기 {:?}", crate::team_post::pin(&ad, &ak, &Curl, &t, "").err());

    // ④ 팀장 넘기기 → 민아가 팀장, 하늘은 전체 권한
    relay::transfer_owner(&od, &ok, &Curl, "", "민아").unwrap();
    assert_eq!(seen(&cd, &ck, &ma).0, "owner");
    assert_eq!(seen(&cd, &ck, &mo), ("member".into(), vec!["all".to_string()]));
    let st = relay::refresh_members(&od, &ok, &Curl, "").unwrap();
    eprintln!("④ 넘기기 → 철수 명부: 민아 owner · 하늘 member+[all] · 하늘 화면 내 역할 {:?}", st.team(&t).map(|x| x.role.clone()));
    let _ = mc;
}

#[test]
#[ignore]
fn 끔() {
    let Some(server) = live::base() else { return eprintln!("CHAMMO_E2E_LIVE 없음 — 건너뜀") };
    let [(od, ok), _, _] = three(&server, live::now());
    let e = relay::set_perms(&od, &ok, &Curl, "", "민아", &["invite".into()]).unwrap_err();
    eprintln!("⑤ 스위치 꺼진 중계 — 칩 누르면: {e}");
    relay::transfer_owner(&od, &ok, &Curl, "", "민아").unwrap();
    let st = relay::refresh_members(&od, &ok, &Curl, "").unwrap();
    eprintln!("⑤ 꺼진 중계 넘기기 → 예전 팀장 올리기: {:?}", st.members.iter().map(|m| (m.display_name.clone(), m.role.clone())).collect::<Vec<_>>());
}
