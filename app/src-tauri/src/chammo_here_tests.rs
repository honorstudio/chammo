use super::*;
use crate::team_relay::{mutate, Account};

fn home(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-here-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn login(dir: &Path, email: &str, name: &str) {
    std::fs::create_dir_all(dir).unwrap();
    mutate(dir, |s| s.account = Some(Account { id: "a".into(), email: email.into(), name: name.into() })).unwrap();
}

#[test]
fn 이_컴퓨터의_chammo_데이터_폴더마다_로그인한_계정을_모은다() {
    // 10-26: 시험판(다른 데이터 폴더)이 남의 계정에 붙어 있었는데 본판 화면·다른 기기 어디에도 안 보였다
    let h = home("scan");
    login(&h.join(".chammo"), "me@example.com", "나");
    login(&h.join(".chammo-team3"), "other@example.com", "남");
    std::fs::create_dir_all(h.join(".chammo-empty")).unwrap(); // 로그인 안 한 시험 폴더 — 안 보인다
    login(&h.join(".config"), "x@example.com", "x"); // Chammo 폴더가 아니다
    let got = scan(&h, &h.join(".chammo"));
    assert_eq!(got.len(), 2, "{got:?}");
    assert_eq!((got[0].folder.as_str(), got[0].current, got[0].email.as_str()), (".chammo", true, "me@example.com"));
    assert_eq!((got[1].folder.as_str(), got[1].current, got[1].email.as_str(), got[1].name.as_str()), (".chammo-team3", false, "other@example.com", "남"));
}

#[test]
fn 지금_앱은_로그인_안_했어도_한_줄로_남고_홈_밖_데이터_폴더도_본다() {
    let h = home("cur");
    let elsewhere = home("cur-elsewhere");
    login(&h.join(".honor-orchestrator"), "me@example.com", "나");
    let got = scan(&h, &elsewhere);
    assert_eq!(got[0].current, true);
    assert_eq!(got[0].email, "", "로그인 안 함 = 빈 이메일 — 화면이 '로그인 안 됨'으로");
    assert!(got.iter().any(|a| a.folder == ".honor-orchestrator" && !a.current));
    // json 에는 폴더 이름·계정만 — 기기 id·열쇠 칸은 없다
    let v = serde_json::to_value(&got[1]).unwrap();
    assert_eq!(v.as_object().unwrap().keys().cloned().collect::<Vec<_>>(), ["folder", "current", "email", "name"]);
}
