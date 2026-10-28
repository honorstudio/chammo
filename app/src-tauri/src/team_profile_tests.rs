use super::*;
use crate::team_locker_app::Item;

fn item(id: &str, kind: &str, name: &str, member: &str, at: u64) -> Item {
    Item { id: id.into(), kind: kind.into(), name: name.into(), by_member: member.into(), at, state: "ready".into(), ..Default::default() }
}

#[test]
fn 프로필_글은_고르고_자른다() {
    let p = decode(r#"{"name":"  김민지  ","status":"dnd","note":"4시까지\n회의","photo":"AbCdEfGhIjKlMnOp","at":5}"#.as_bytes()).unwrap();
    assert_eq!(p.name, "김민지");
    assert_eq!(p.status, "dnd");
    assert_eq!(p.note, "4시까지 회의", "줄바꿈은 한 칸으로");
    assert_eq!(p.photo, "AbCdEfGhIjKlMnOp");
    let odd = decode(format!(r#"{{"status":"sleep","note":"{}","photo":"../x","name":"{}"}}"#, "가".repeat(60), "나".repeat(50)).as_bytes()).unwrap();
    assert_eq!(odd.status, "free", "모르는 상태는 대화 가능");
    assert_eq!(odd.note.chars().count(), NOTE_MAX);
    assert_eq!(odd.name.chars().count(), NAME_MAX);
    assert_eq!(odd.photo, "", "파일 id 모양이 아니면 버린다");
    assert!(decode(b"not json").is_err());
}

#[test]
fn 사람마다_가장_새_프로필만_못_연_것과_휴지통은_빼고() {
    let mut gone = item("p4", "profile", "profile.json", "m1", 9);
    gone.state = "trash".into();
    let mut locked = item("p5", "profile", "", "m2", 9);
    locked.why = "열쇠 아직 없음".into();
    let mut up = item("p6", "profile", "profile.json", "m1", 10);
    up.state = "uploading".into();
    let items = vec![item("p1", "profile", "profile.json", "m1", 3), item("p2", "profile", "profile.json", "m1", 7), item("p3", "profile", "profile.json", "m2", 1), gone, locked, up, item("f1", "file", "a.txt", "m1", 99)];
    let got = latest_profiles(&items);
    assert_eq!(got.get("m1").map(|i| i.id.as_str()), Some("p2"));
    assert_eq!(got.get("m2").map(|i| i.id.as_str()), Some("p3"));
    assert_eq!(got.len(), 2);
}

#[test]
fn 팀_아이콘은_팀장이_올린_가장_새_것만() {
    let items = vec![
        item("a1", "avatar", "team-icon.webp", "boss", 3),
        item("a2", "avatar", "team-icon.webp", "member", 9), // 팀원이 올린 건 무시
        item("a3", "avatar", "photo.webp", "boss", 10),      // 팀장 개인 사진
        item("a4", "avatar", "team-icon.png", "boss", 5),
    ];
    assert_eq!(team_icon(&items, &["boss".to_string()]).map(|i| i.id.as_str()), Some("a4"));
    assert!(team_icon(&items, &[]).is_none());
}

#[test]
fn 바꾼_뒤_치울_내_옛_파일() {
    let items = vec![
        item("p1", "profile", "profile.json", "me", 1),
        item("p2", "profile", "profile.json", "me", 2),
        item("a1", "avatar", "photo.webp", "me", 1),
        item("a2", "avatar", "photo.webp", "me", 2),
        item("t1", "avatar", "team-icon.webp", "me", 1),
        item("c1", "avatar", "team-cover.webp", "me", 1),
        item("x1", "profile", "profile.json", "other", 1),
    ];
    let mut old = stale(&items, "me", Slot::Profile, &["p2", "a2"]);
    old.sort();
    assert_eq!(old, vec!["p1"]);
    let mut photos = stale(&items, "me", Slot::Photo, &["a2"]);
    photos.sort();
    assert_eq!(photos, vec!["a1"], "팀 아이콘·커버는 사진 정리에서 안 지운다");
    assert_eq!(stale(&items, "me", Slot::TeamIcon, &[]), vec!["t1"]);
    assert_eq!(stale(&items, "me", Slot::TeamCover, &[]), vec!["c1"]);
    assert!(stale(&items, "me", Slot::TeamCover, &["c1"]).is_empty());
}

#[test]
fn 남의_이름으로는_못_바꾼다() {
    let others = vec!["박준호".to_string(), "서연".to_string()];
    assert!(name_ok("김민지", &others).is_ok());
    assert!(name_ok(" 박준호 ", &others).is_err());
    assert!(name_ok("서연", &others).is_err());
    assert!(name_ok("   ", &others).is_err());
}

#[test]
fn 그림은_webp_png_jpeg_만() {
    assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
    assert_eq!(image_mime(b"\x89PNG\r\n\x1a\n...."), Some("image/png"));
    assert_eq!(image_mime(b"\xff\xd8\xff\xe0...."), Some("image/jpeg"));
    assert_eq!(image_mime(b"<svg xmlns="), None, "svg 는 스크립트를 품을 수 있어 안 받는다");
    assert_eq!(image_mime(b""), None);
    let url = data_url(b"\x89PNG\r\n\x1a\nxx").unwrap();
    assert!(url.starts_with("data:image/png;base64,"));
}

#[test]
fn 방해_금지는_이_기기에_적어_두고_알림이_읽는다() {
    let d = std::env::temp_dir().join(format!("chammo-profile-dnd-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    assert!(!dnd(&d), "적은 게 없으면 울린다");
    remember_status(&d, "dnd");
    assert!(dnd(&d));
    remember_status(&d, "away");
    assert!(!dnd(&d), "자리 비움은 울린다");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 프로필판과_바꾸기는_봉투_더하기를_기다리지_않는다() {
    // 10-26 운영 실측 — list() 는 나중에 든 사람 몫 봉투 더하기(share)를 끝까지 기다려 목록마다 3.4~3.6초가 더 붙었다.
    // 얼굴·상태·팀 아이콘은 목록만 있으면 된다(봉투 더하기는 팀 보관함 화면이 뒤 스레드로 한다)
    let src = include_str!("team_profile.rs");
    let code = src.split("#[cfg(test)]").next().unwrap();
    assert!(!code.contains("locker::list("), "list_split 으로");
    assert!(code.matches("locker::list_split(").count() >= 3, "프로필판·바꾸기·팀 아이콘");
}

#[test]
fn 폰_같은_판_답은_알린_판을_알_때만() {
    // 맥을 다시 켜면 알린 판(메모리)이 0 — 폰이 들고 온 판으로 '그대로'만 답하면 폰이 옛 판에 갇힌다
    let team = "t-phone-same";
    assert!(!phone_same(team, 7), "알린 판을 모르면 한 번 새로 읽는다");
    crate::team_locker_app::nudge(team, 7);
    assert!(phone_same(team, 7), "본 판 = 알린 판이면 그대로");
    assert!(!phone_same(team, 0), "본 판이 없으면 늘 새로");
    crate::team_locker_app::nudge(team, 8);
    assert!(!phone_same(team, 7), "새 판이 알려졌으면 다시");
}

#[test]
fn 프로필_이름은_사람마다_가장_새_프로필에서_빈_이름·못_읽은_건_뺀다() {
    // 10-28 아이맥 참모: scripts/team 은 명부(계정) 이름만 알아서 사용자가 부르는 프로필 이름으로 사람을 못 찾았다
    let items = vec![item("p1", "profile", "profile.json", "m1", 3), item("p2", "profile", "profile.json", "m1", 7), item("p3", "profile", "profile.json", "m2", 1), item("p4", "profile", "profile.json", "m3", 1)];
    let body = |id: &str| match id {
        "p1" => Some(r#"{"name":"옛 이름"}"#.as_bytes().to_vec()),
        "p2" => Some(r#"{"name":" 도윤 "}"#.as_bytes().to_vec()),
        "p3" => Some(br#"{"name":""}"#.to_vec()),
        _ => None,
    };
    let got = names_from(&items, body);
    assert_eq!(got.get("m1").map(String::as_str), Some("도윤"), "가장 새 프로필, 다듬은 이름");
    assert!(!got.contains_key("m2"), "빈 이름 = 명부 이름 그대로");
    assert!(!got.contains_key("m3"), "아직 안 푼 프로필은 망 없이 건너뛴다");
}

#[test]
fn 캐시_프로필_이름은_망을_안_쓴다() {
    // scripts/team status 가 기다리지 않게 — 봉해 둔 목록과 이미 푼 프로필만
    let src = include_str!("team_profile.rs");
    let body = &src[src.find("pub fn cached_names(").unwrap()..];
    let body = &body[..body.find("\n}\n").unwrap()];
    assert!(body.contains("locker::cached("), "{body}");
    assert!(!body.contains("http") && !body.contains("bytes_of("), "{body}");
}
