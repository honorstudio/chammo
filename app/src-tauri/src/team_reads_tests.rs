use super::*;
use crate::team_relay::{Room, TeamEntry, TeamState};
use std::time::{Duration, Instant};

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-team-reads-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn 합치기는_앞으로만_바뀐_게_있을_때만_참() {
    let d = dir("merge");
    assert!(merge(&d, "r1", &[("m1".into(), 3), ("m2".into(), 1)]));
    assert!(!merge(&d, "r1", &[("m1".into(), 2), ("m2".into(), 1)]), "작거나 같은 값은 그대로");
    assert!(merge(&d, "r1", &[("m2".into(), 5)]));
    assert!(!merge(&d, "", &[("m1".into(), 9)]), "방 없음");
    assert!(!merge(&d, "r2", &[(String::new(), 9)]), "멤버 없음(내 기기끼리 방)");
    let all = load(&d);
    assert_eq!(all["r1"]["m1"], 3);
    assert_eq!(all["r1"]["m2"], 5);
    assert!(all.get("r2").is_none());
}

#[test]
fn 서버_틀에서_읽음_뽑기() {
    let ready = serde_json::json!({ "t": "ready", "upto": 4, "reads": { "m1": 2, "m2": 4, "bad": "x", "neg": -1 } });
    let mut got = from_ready(&ready);
    got.sort();
    assert_eq!(got, vec![("m1".to_string(), 2), ("m2".to_string(), 4)]);
    assert!(from_ready(&serde_json::json!({ "t": "ready" })).is_empty(), "옛 중계는 reads 가 없다");
    let one = serde_json::json!({ "t": "read", "room": "r1", "member": "m2", "seq": 7 });
    assert_eq!(from_read(&one), Some(("m2".to_string(), 7)));
    assert_eq!(from_read(&serde_json::json!({ "t": "read", "member": "", "seq": 7 })), None);
}

#[test]
fn 내_멤버는_그_방_팀의_멤버() {
    let st = TeamState {
        member_id: "m-cur".into(),
        teams: vec![TeamEntry { id: "t2".into(), member_id: "m-t2".into(), ..Default::default() }],
        rooms: vec![
            Room { id: "r1".into(), kind: "dm".into(), team: "t2".into(), ..Default::default() },
            Room { id: "r2".into(), kind: "dm".into(), team: "t9".into(), ..Default::default() },
            Room { id: "s".into(), kind: "self".into(), ..Default::default() },
        ],
        ..Default::default()
    };
    assert_eq!(my_member(&st, "r1"), "m-t2");
    assert_eq!(my_member(&st, "r2"), "m-cur", "팀 칸이 없으면 지금 팀 멤버");
    assert_eq!(my_member(&st, "s"), "", "내 기기끼리 방은 읽음 없음");
    assert_eq!(my_member(&st, "모름"), "");
}

#[test]
fn 보내기는_방마다_1초에_한_번_가장_큰_seq_만() {
    let t0 = Instant::now();
    let mut o = Outbox::default();
    o.want("r1", 3);
    o.want("r1", 5);
    o.want("r1", 4);
    o.want("r2", 1);
    let mut first = o.due(t0, EVERY);
    first.sort();
    assert_eq!(first, vec![("r1".to_string(), 5), ("r2".to_string(), 1)]);
    for (r, s) in &first {
        o.sent(r, *s, t0);
    }
    o.want("r1", 6);
    assert!(o.due(t0 + Duration::from_millis(300), EVERY).is_empty(), "1초 안엔 묶어 둔다");
    assert_eq!(o.due(t0 + EVERY, EVERY), vec![("r1".to_string(), 6)]);
    o.sent("r1", 6, t0 + EVERY);
    o.want("r1", 6);
    assert!(o.due(t0 + EVERY * 5, EVERY).is_empty(), "이미 보낸 것보다 안 크면 안 보낸다");
}
