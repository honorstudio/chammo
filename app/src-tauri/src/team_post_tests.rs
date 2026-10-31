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

#[test]
fn 팀_홈_글판은_봉투_더하기를_기다리지_않는다() {
    // 10-26 실측(fix/team-latency3) — 글판이 list() 라서 누가 새로 든 뒤 첫 팀 홈이 파일마다 봉투 더하기(11파일 = 요청 23개, 운영 약 10.7초)를 기다렸다.
    // 글판·쓰기·고정·지우기는 목록만, 봉투 더하기는 화면 명령이 뒤 스레드로(팀 보관함 화면과 같은 길)
    let src = include_str!("team_post.rs");
    let code = src.split("#[cfg(test)]").next().unwrap();
    assert!(!code.contains("locker::list("), "list_split 으로");
    assert!(code.contains("locker::list_split("));
    let cmd = include_str!("team_post_cmd.rs");
    assert!(cmd.contains("share.spawn()"), "글판 명령은 봉투 더하기를 뒤 스레드로(ShareJob::spawn)");
}

#[test]
fn 글판·쓰기·고정·지우기는_봉투_더하기_일을_버리지_않는다() {
    // 10-27 리뷰 — board() 가 board_split 의 ShareJob 을, 쓰기·고정·지우기가 read() 의 job 을 버려서
    // 폰(/api/team-posts)·글 쓰기만 쓰는 사람 쪽에선 나중에 든 사람이 옛 글을 영영 못 열었다
    let src = include_str!("team_post.rs");
    let code = src.split("#[cfg(test)]").next().unwrap();
    assert!(!code.contains(", _) = read("), "read() 의 job 을 버리지 않는다");
    assert!(!code.contains("|(b, _)| b"), "board_split 의 job 을 버리지 않는다");
    let cmd = include_str!("team_post_cmd.rs");
    assert!(cmd.matches(".spawn()").count() >= 4, "글판·쓰기·고정·지우기 명령 모두 뒤 스레드로");
    let mobile = include_str!("mobile.rs");
    let posts = mobile.split("fn team_posts(").nth(1).unwrap().split("\n    fn ").next().unwrap();
    assert!(posts.contains("board_split(") && posts.contains(".spawn()"), "폰 글판도 봉투 더하기를 뒤 스레드로");
    let post = mobile.split("fn team_post(").nth(1).unwrap().split("\n    fn ").next().unwrap();
    assert!(post.matches(".spawn()").count() >= 2, "폰 새 글·고정도");
}

#[test]
fn 못_받은_글이_많고_받아_둔_글이_있으면_받아_둔_것부터_그린다() {
    // 10-31: 글 30개를 다 받은 뒤에야 그렸다(운영 ≈ 8초). 받아 둔 글이 하나도 없으면(새 기기) 기다릴 수밖에 없다
    assert!(first_paint(10, 7), "받아 둔 10 · 못 받은 7 → 먼저 그림");
    assert!(!first_paint(10, 3), "못 받은 게 같이 받기 한 번(6) 안이면 기다려도 금방");
    assert!(!first_paint(0, 30), "새 기기 — 그릴 게 없다");
}

#[test]
fn 팀_홈_글은_한_번에_같이_받는다() {
    let code = include_str!("team_post.rs");
    let read = &code[code.find("fn read_first(").unwrap()..];
    let read = &read[..read.find("\n}\n").unwrap()];
    assert!(read.contains("bytes_many("), "글 본문을 하나씩(bytes_of) 차례로 받지 않는다");
}
