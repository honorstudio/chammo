// org_policy 시험 — 관리 설정 자리·first-wins·doctor 줄·세션 첫 권한 모드(ADR 0023)
use super::*;
use serde_json::json;

fn tmp(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-orgpol-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn srcs(dir: &std::path::Path) -> Sources {
    Sources { file_dir: dir.join("ClaudeCode"), plists: vec![dir.join("mp.plist")], remote: dir.join("remote-settings.json") }
}

#[test]
fn 정책이_하나도_없으면_막힘_없음() {
    let d = tmp("none");
    let p = judge(&read_sources(&srcs(&d), |_| None), None);
    assert_eq!(p["source"], "none");
    assert_eq!(p["bypass"], "allowed");
    assert_eq!(p["auto"], "allowed");
}

#[test]
fn 파일과_drop_in_을_읽는다() {
    let d = tmp("file");
    std::fs::create_dir_all(d.join("ClaudeCode/managed-settings.d")).unwrap();
    std::fs::write(d.join("ClaudeCode/managed-settings.json"), r#"{"permissions":{"disableAutoMode":"disable"}}"#).unwrap();
    std::fs::write(d.join("ClaudeCode/managed-settings.d/10-x.json"), r#"{"permissions":{"disableBypassPermissionsMode":"disable"},"allowManagedHooksOnly":true}"#).unwrap();
    std::fs::write(d.join("ClaudeCode/managed-settings.d/.hidden.json"), "{깨짐").unwrap();
    let p = judge(&read_sources(&srcs(&d), |_| None), None);
    assert_eq!((p["source"].as_str(), p["bypass"].as_str(), p["auto"].as_str(), p["hooks"].as_str()), (Some("file"), Some("blocked"), Some("blocked"), Some("managedOnly")));
}

#[test]
fn 서버_관리가_있으면_그게_이긴다_캐시는_settings_안에_있어도_된다() {
    let d = tmp("remote");
    std::fs::create_dir_all(d.join("ClaudeCode")).unwrap();
    std::fs::write(d.join("ClaudeCode/managed-settings.json"), r#"{"allowManagedHooksOnly":true}"#).unwrap();
    std::fs::write(d.join("remote-settings.json"), r#"{"settings":{"permissions":{"disableBypassPermissionsMode":"disable"}}}"#).unwrap();
    let p = judge(&read_sources(&srcs(&d), |_| None), None);
    assert_eq!(p["source"], "remote");
    assert_eq!(p["bypass"], "blocked");
    // first-wins — 파일의 훅 잠금은 안 읽힌다
    assert_eq!(p["hooks"], "ours");
}

#[test]
fn plist_은_바꿔_읽은_것으로_파일보다_먼저() {
    let d = tmp("plist");
    std::fs::write(d.join("mp.plist"), "x").unwrap();
    let conv = |_: &std::path::Path| Some(json!({"permissions": {"disableBypassPermissionsMode": "disable"}}));
    let p = judge(&read_sources(&srcs(&d), conv), None);
    assert_eq!((p["source"].as_str(), p["bypass"].as_str()), (Some("plist"), Some("blocked")));
}

#[test]
fn 정책_키가_아닌_것만_있는_곳은_이긴_곳이_아니다() {
    let d = tmp("nonpolicy");
    std::fs::write(d.join("remote-settings.json"), r#"{"managedSourcesBehavior":"first-wins"}"#).unwrap();
    std::fs::create_dir_all(d.join("ClaudeCode")).unwrap();
    std::fs::write(d.join("ClaudeCode/managed-settings.json"), r#"{"permissions":{"disableBypassPermissionsMode":"disable"}}"#).unwrap();
    assert_eq!(judge(&read_sources(&srcs(&d), |_| None), None)["source"], "file");
}

#[test]
fn doctor_줄로_서버_정책을_알고_캐시를_못_읽으면_모름() {
    let max = "Managed settings (remote): not fetched — requires an Enterprise or Team subscription\nOrganization policy: not applicable to Pro and Max accounts\n";
    assert_eq!(doctor_remote(max).as_deref(), Some("not fetched — requires an Enterprise or Team subscription"));
    assert!(!remote_active(doctor_remote(max).as_deref()));
    let team = "Managed settings (remote): loaded 4 settings from your organization\n";
    assert!(remote_active(doctor_remote(team).as_deref()));
    let p = judge(&[], Some(team));
    assert_eq!((p["source"].as_str(), p["bypass"].as_str()), (Some("remote"), Some("unknown")));
    assert_eq!(judge(&[], Some(max))["bypass"], "allowed");
    assert!(doctor_remote("아무 말").is_none());
}

#[test]
fn 세션_기록_첫_권한_모드() {
    let head = "{\"type\":\"summary\"}\n{\"type\":\"permission-mode\",\"permissionMode\":\"auto\",\"sessionId\":\"s\"}\n{\"type\":\"permission-mode\",\"permissionMode\":\"default\"}\n";
    assert_eq!(startup_mode(head).as_deref(), Some("auto"));
    assert_eq!(startup_mode("{\"type\":\"user\"}\n깨진 줄").as_deref(), None);
}
