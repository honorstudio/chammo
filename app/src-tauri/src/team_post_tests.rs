use super::*;
use crate::team_locker_app::Item;

fn item(id: &str, member: &str, at: u64) -> Item {
    Item { id: id.into(), kind: "post".into(), name: "post.json".into(), by_member: member.into(), at, state: "live".into(), ..Default::default() }
}
fn post(title: &str, origin: &str, created: u64, at: u64) -> Doc {
    Doc { t: "post".into(), title: title.into(), body: format!("{title} 본문"), origin: origin.into(), created, at }
}
fn pin(target: &str, at: u64) -> Doc {
    Doc { t: "pin".into(), origin: target.into(), at, ..Default::default() }
}

#[test]
fn 글은_고르고_자른다() {
    let d = decode(format!(r#"{{"t":"post","title":"  10월\n마감  ","body":"{}","origin":"../x","created":5,"at":6}}"#, "가".repeat(BODY_MAX + 10)).as_bytes()).unwrap();
    assert_eq!(d.title, "10월 마감", "제목은 한 줄");
    assert_eq!(d.body.chars().count(), BODY_MAX);
    assert_eq!(d.origin, "", "파일 id 모양이 아니면 버린다");
    let long = decode(format!(r#"{{"t":"post","title":"{}"}}"#, "나".repeat(TITLE_MAX + 5)).as_bytes()).unwrap();
    assert_eq!(long.title.chars().count(), TITLE_MAX);
    assert_eq!(decode(br#"{"t":"spam"}"#).unwrap().t, "", "모르는 종류는 빈 글 — 접을 때 버린다");
    assert!(decode(b"not json").is_err());
}

#[test]
fn 글마다_가장_새_판_글쓴이는_첫_판_올린_사람() {
    let a1 = item("aaaaaaaaaaaaaaaa1", "m1", 10);
    let a2 = item("aaaaaaaaaaaaaaaa2", "m1", 20); // m1 이 고친 판
    let a3 = item("aaaaaaaaaaaaaaaa3", "m2", 30); // m2 가 같은 글 id 로 끼어든 판 — 버린다
    let b1 = item("bbbbbbbbbbbbbbbb1", "m2", 15);
    let es = vec![
        (&a1, post("처음", "", 10, 10)),
        (&a2, post("고침", "aaaaaaaaaaaaaaaa1", 10, 20)),
        (&a3, post("가로채기", "aaaaaaaaaaaaaaaa1", 10, 30)),
        (&b1, post("둘째 글", "", 15, 15)),
    ];
    let (ps, pinned) = fold(&es, &[], "m1");
    assert_eq!(pinned, "");
    assert_eq!(ps.len(), 2);
    assert_eq!(ps[0].id, "bbbbbbbbbbbbbbbb1", "새로 쓴 글이 위");
    assert_eq!(ps[1].title, "고침");
    assert_eq!(ps[1].by, "m1");
    assert_eq!(ps[1].file, "aaaaaaaaaaaaaaaa2");
    assert_eq!(ps[1].edited, 20);
    assert!(ps[1].mine && !ps[0].mine);
}

#[test]
fn 첫_판이_없으면_그_글은_없다_휴지통_못_연_것도() {
    let v2 = item("aaaaaaaaaaaaaaaa2", "m1", 20);
    let mut gone = item("cccccccccccccccc1", "m1", 5);
    gone.state = "trash".into();
    let mut locked = item("dddddddddddddddd1", "m1", 5);
    locked.why = "열쇠 아직 없음".into();
    let es = vec![(&v2, post("고침", "aaaaaaaaaaaaaaaa1", 10, 20)), (&gone, post("지움", "", 5, 5)), (&locked, post("잠김", "", 5, 5))];
    assert!(fold(&es, &[], "m1").0.is_empty());
}

#[test]
fn 고정은_팀장이_올린_가장_새_고정_기록만_있는_글이어야() {
    let a = item("aaaaaaaaaaaaaaaa1", "m1", 10);
    let p1 = item("pppppppppppppppp1", "boss", 11);
    let p2 = item("pppppppppppppppp2", "m1", 30); // 팀원이 올린 고정 — 무시
    let p3 = item("pppppppppppppppp3", "boss", 12);
    let es = vec![(&a, post("공지", "", 10, 10)), (&p1, pin("zzzzzzzzzzzzzzzz9", 11)), (&p2, pin("", 30)), (&p3, pin("aaaaaaaaaaaaaaaa1", 12))];
    assert_eq!(fold(&es, &["boss".to_string()], "m1").1, "aaaaaaaaaaaaaaaa1");
    let unpin = item("pppppppppppppppp4", "boss", 40);
    let es2 = [es, vec![(&unpin, pin("", 40))]].concat();
    assert_eq!(fold(&es2, &["boss".to_string()], "m1").1, "", "빈 고정 = 풀기");
    let es3 = vec![(&p1, pin("zzzzzzzzzzzzzzzz9", 11))];
    assert_eq!(fold(&es3, &["boss".to_string()], "m1").1, "", "없는 글을 가리키면 고정 없음");
}

#[test]
fn 고친_뒤_치울_판은_첫_판과_새_판을_뺀_내_판() {
    let es = vec![item("aaaaaaaaaaaaaaaa1", "me", 1), item("aaaaaaaaaaaaaaaa2", "me", 2), item("aaaaaaaaaaaaaaaa3", "me", 3), item("bbbbbbbbbbbbbbbb1", "me", 4)];
    let docs = [post("a", "", 1, 1), post("a", "aaaaaaaaaaaaaaaa1", 1, 2), post("a", "aaaaaaaaaaaaaaaa1", 1, 3), post("b", "", 4, 4)];
    let pairs: Vec<(&Item, Doc)> = es.iter().zip(docs.iter().cloned()).collect();
    assert_eq!(old_versions(&pairs, "me", "aaaaaaaaaaaaaaaa1", "aaaaaaaaaaaaaaaa3"), vec!["aaaaaaaaaaaaaaaa2"]);
}

#[test]
fn 글_전체는_첫_판과_고친_판() {
    let es = vec![item("aaaaaaaaaaaaaaaa1", "me", 1), item("aaaaaaaaaaaaaaaa2", "me", 2), item("bbbbbbbbbbbbbbbb1", "me", 4)];
    let docs = [post("a", "", 1, 1), post("a", "aaaaaaaaaaaaaaaa1", 1, 2), post("b", "", 4, 4)];
    let pairs: Vec<(&Item, Doc)> = es.iter().zip(docs.iter().cloned()).collect();
    let mut all = versions_of(&pairs, "aaaaaaaaaaaaaaaa1");
    all.sort();
    assert_eq!(all, vec!["aaaaaaaaaaaaaaaa1", "aaaaaaaaaaaaaaaa2"]);
}
