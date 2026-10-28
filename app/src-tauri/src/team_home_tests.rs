use super::*;
use crate::team_locker_app::Item;

fn item(id: &str, member: &str, name: &str) -> Item {
    Item { id: id.into(), kind: "post".into(), name: name.into(), by_member: member.into(), at: 1, state: "live".into(), ..Default::default() }
}
fn blk(id: &str, k: &str, w: &str) -> Block {
    Block { id: id.into(), k: k.into(), w: w.into(), mode: String::new() }
}
fn home(at: u64, blocks: Vec<Block>) -> Home {
    Home { t: "home".into(), blocks, at, ..Default::default() }
}
fn content(origin: &str, at: u64, note: &str) -> Content {
    Content { t: "homeblk".into(), origin: origin.into(), note: Note { title: note.into(), body: String::new() }, at, ..Default::default() }
}

#[test]
fn 판은_고르고_자른다() {
    let many: Vec<String> = (0..BLOCKS_MAX + 5).map(|i| format!(r#"{{"id":"b{i}","k":"links","w":"half"}}"#)).collect();
    let raw = format!(
        r#"{{"t":"home","color":99,"blurb":"  패키지·브랜드\n디자인  ","cover":"../x","at":7,"spy":1,"blocks":[
            {{"id":"p1","k":"pin","w":"wide"}},
            {{"id":"p1","k":"posts","w":"full"}},
            {{"id":"m1","k":"mode","w":"half","mode":"board"}},
            {{"id":"m2","k":"links","w":"half","mode":"board"}},
            {{"id":"m3","k":"mode","w":"full","mode":".light"}},
            {{"id":"x1","k":"script","w":"full"}},
            {{"id":"../bad","k":"goals","w":"half"}},
            {}
        ]}}"#,
        many.join(",")
    );
    let h = decode_home(raw.as_bytes()).unwrap();
    assert_eq!(h.t, "home");
    assert_eq!(h.color, 0, "팀 색은 정한 개수 안에서만");
    assert_eq!(h.blurb, "패키지·브랜드 디자인", "소개는 한 줄");
    assert_eq!(h.cover, "", "파일 id 모양이 아니면 버린다");
    let ks: Vec<(&str, &str, &str)> = h.blocks.iter().take(5).map(|b| (b.id.as_str(), b.k.as_str(), b.w.as_str())).collect();
    assert_eq!(ks, vec![("p1", "pin", "full"), ("m1", "mode", "half"), ("m2", "links", "half"), ("m3", "mode", "full"), ("b0", "links", "half")], "모르는 폭은 블록 기본, 겹친 id·모르는 종류·이상한 id 는 버린다");
    assert_eq!(h.blocks[3].mode, "", "모드 이름이 이상하면 빈 모드 칸(고르라는 자리)");
    assert_eq!(h.blocks[1].mode, "board");
    assert_eq!(h.blocks[2].mode, "", "모드 이름은 모드 블록에만");
    assert_eq!(h.blocks.len(), BLOCKS_MAX, "블록 수 한도");
    assert_eq!(decode_home(br#"{"t":"post"}"#).unwrap().t, "", "홈 판이 아니면 빈 판");
    assert!(decode_home(b"nope").is_err());
}

#[test]
fn 블록_내용은_고르고_자른다() {
    let links: Vec<String> = (0..LINKS_MAX + 3).map(|i| format!(r#"{{"name":"링크{i}","url":"https://a.example/{i}"}}"#)).collect();
    let raw = format!(
        r#"{{"t":"homeblk","origin":"b1","at":3,"links":[
            {{"name":"나쁜","url":"javascript:alert(1)"}},
            {{"name":"파일","url":"file:///etc/passwd"}},
            {{"name":"  견적표 \n","url":" http://x.example/a "}},
            {}
        ],
        "note":{{"title":"워크숍\n사진","body":"{}"}},
        "goals":[{{"name":"봄 패키지","done":12,"total":9}},{{"name":"빈 칸","done":0,"total":0}},{{"name":"","done":1,"total":2}}]}}"#,
        links.join(","),
        "가".repeat(NOTE_MAX + 9)
    );
    let c = decode_content(raw.as_bytes()).unwrap();
    assert_eq!(c.origin, "b1");
    assert_eq!(c.links[0], Link { name: "견적표".into(), url: "http://x.example/a".into() }, "http·https 만, 이름은 한 줄");
    assert_eq!(c.links.len(), LINKS_MAX);
    assert!(c.links.iter().all(|l| l.url.starts_with("http")));
    assert_eq!(c.note.title, "워크숍 사진");
    assert_eq!(c.note.body.chars().count(), NOTE_MAX);
    assert_eq!(c.goals, vec![Goal { name: "봄 패키지".into(), done: 9, total: 9 }], "끝낸 칸은 전체를 못 넘고, 칸 0·이름 없음은 버린다");
    assert_eq!(decode_content(br#"{"t":"homeblk","origin":"a b"}"#).unwrap().origin, "", "블록 id 모양이 아니면 빈 글 — 접을 때 버린다");
}

#[test]
fn 판은_팀장이_올린_가장_새_것() {
    let a = item("aaaaaaaaaaaaaaaa1", "boss", "home.json");
    let b = item("aaaaaaaaaaaaaaaa2", "boss", "home.json");
    let c = item("aaaaaaaaaaaaaaaa3", "m2", "home.json"); // 팀원이 올린 판 — 버린다
    let mut gone = item("aaaaaaaaaaaaaaaa4", "boss", "home.json");
    gone.state = "trash".into();
    let es = vec![
        (&a, home(10, vec![blk("b1", "pin", "full")])),
        (&b, home(20, vec![blk("b2", "posts", "full")])),
        (&c, home(30, vec![blk("b3", "links", "half")])),
        (&gone, home(40, vec![])),
    ];
    let (h, by, file) = fold_home(&es, &["boss".to_string()]).unwrap();
    assert_eq!(h.blocks[0].id, "b2");
    assert_eq!((by.as_str(), file.as_str()), ("boss", "aaaaaaaaaaaaaaaa2"));
    assert!(fold_home(&es, &["nobody".to_string()]).is_none(), "팀장 판이 없으면 판 없음(템플릿 화면)");
    // 같은 시각이면 파일 id 큰 쪽 — 기기마다 같은 판을 고른다
    let d = item("aaaaaaaaaaaaaaaa9", "boss", "home.json");
    let es2 = vec![(&a, home(10, vec![blk("x", "pin", "full")])), (&d, home(10, vec![blk("y", "pin", "full")]))];
    assert_eq!(fold_home(&es2, &["boss".to_string()]).unwrap().0.blocks[0].id, "y");
}

#[test]
fn 내용은_블록마다_가장_새_판_누구나() {
    let i1 = item("cccccccccccccccc1", "m1", "homeblk.json");
    let i2 = item("cccccccccccccccc2", "m2", "homeblk.json");
    let i3 = item("cccccccccccccccc3", "m3", "homeblk.json");
    let es = vec![(&i1, content("b1", 10, "처음")), (&i2, content("b1", 20, "고침")), (&i3, content("old", 30, "판에 없는 블록"))];
    let m = fold_content(&es, &["b1".to_string(), "b2".to_string()]);
    assert_eq!(m.len(), 1);
    assert_eq!(m["b1"].note.title, "고침");
    assert_eq!(m["b1"].by, "m2");
}

#[test]
fn 치울_내_옛_판() {
    let a = item("aaaaaaaaaaaaaaaa1", "boss", "home.json");
    let b = item("aaaaaaaaaaaaaaaa2", "boss", "home.json");
    let other = item("aaaaaaaaaaaaaaaa3", "boss2", "home.json");
    let homes = vec![(&a, home(1, vec![])), (&b, home(2, vec![])), (&other, home(3, vec![]))];
    assert_eq!(old_homes(&homes, "boss", "aaaaaaaaaaaaaaaa2"), vec!["aaaaaaaaaaaaaaaa1"], "새 판·남의 판은 남긴다");
    let c1 = item("cccccccccccccccc1", "m1", "homeblk.json");
    let c2 = item("cccccccccccccccc2", "m1", "homeblk.json");
    let c3 = item("cccccccccccccccc3", "m1", "homeblk.json");
    let cs = vec![(&c1, content("b1", 1, "a")), (&c2, content("b2", 2, "b")), (&c3, content("b1", 3, "c"))];
    assert_eq!(old_contents(&cs, "m1", "b1", "cccccccccccccccc3"), vec!["cccccccccccccccc1"]);
}

#[test]
fn 옛_글판은_홈_판을_글로_안_본다() {
    // 옛 앱 team_post::decode 가 홈 판을 빈 종류로 접는다 — 글 목록에 안 섞인다
    let raw = serde_json::to_vec(&home(5, vec![blk("b1", "pin", "full")])).unwrap();
    assert_eq!(crate::team_post::decode(&raw).unwrap().t, "");
    let raw = serde_json::to_vec(&content("b1", 5, "x")).unwrap();
    assert_eq!(crate::team_post::decode(&raw).unwrap().t, "");
}

#[test]
fn 내용은_판에_있는_글_블록에만() {
    let h = home(1, vec![blk("l1", "links", "half"), blk("p1", "pin", "full"), blk("g1", "goals", "half")]);
    assert!(content_block(Some(&h), "l1").is_ok());
    assert!(content_block(Some(&h), "g1").is_ok());
    assert!(content_block(Some(&h), "p1").is_err(), "고정 공지는 내용을 따로 안 받는다");
    assert!(content_block(Some(&h), "zz").is_err(), "판에 없는 블록");
    assert!(content_block(None, "l1").is_err(), "판이 없으면");
}

#[test]
fn 커버는_팀장이_올린_team_cover_그림만() {
    let mut ok = item("dddddddddddddddd1", "boss", "team-cover.webp");
    ok.kind = "avatar".into();
    let mut photo = item("dddddddddddddddd2", "boss", "photo.webp");
    photo.kind = "avatar".into();
    let mut by_member = item("dddddddddddddddd3", "m2", "team-cover.png");
    by_member.kind = "avatar".into();
    let items = vec![ok, photo, by_member];
    let owners = ["boss".to_string()];
    assert!(cover_ok(&items, &owners, "dddddddddddddddd1"));
    assert!(!cover_ok(&items, &owners, "dddddddddddddddd2"), "프로필 사진은 커버가 아니다");
    assert!(!cover_ok(&items, &owners, "dddddddddddddddd3"), "팀원이 올린 그림");
    assert!(!cover_ok(&items, &owners, "eeeeeeeeeeeeeeee1"), "없는 파일");
}
