//! 쓰기 안전장치 명세 (ADR-0004).
//!
//! **하나라도 깨지면 쓰기를 열면 안 된다.** 이 파일이 그 계약이다.
//! 모든 테스트는 픽스처 사본에서만 돈다 — 실제 `~/.claude`는 절대 건드리지 않는다.
// 참모 사본: 픽스처가 심볼릭 링크를 유닉스로 만든다 — 윈도우에선 이 테스트 묶음을 뺀다(vendor/HARNITOR.md)
#![cfg(unix)]

mod common;

use harnitor_core::write::Plan;
use harnitor_core::write::{
    apply, plan_disable_skill, plan_toggle_hook, plan_toggle_mcp, plan_toggle_plugin, undo, Change,
};
use harnitor_core::{scan, scan_with, ScanOptions};

/// 기본은 실행하지 않는다. 계획을 세우는 것만으로 파일이 바뀌면 안 된다.
#[test]
fn planning_alone_changes_nothing() {
    let f = common::load();
    let s = scan(&f.home);
    let plan = plan_disable_skill(&s, "alpha", None).expect("계획 실패");

    assert!(!plan.changes.is_empty(), "계획이 비었다");
    assert!(
        f.home.join(".claude/skills/alpha/SKILL.md").exists(),
        "계획만 세웠는데 파일이 사라졌다"
    );
    // 무엇이 바뀔지 사람이 읽을 수 있어야 한다
    assert!(
        plan.summary.contains("alpha"),
        "요약에 대상이 없다: {}",
        plan.summary
    );
}

/// 실행하면 원본이 먼저 백업된다. 백업 없이 바꾸는 경로는 존재하면 안 된다.
#[test]
fn applying_backs_up_first_then_moves() {
    let f = common::load();
    let s = scan(&f.home);
    let plan = plan_disable_skill(&s, "alpha", None).unwrap();
    let done = apply(&f.home, &plan).expect("실행 실패");

    assert!(done.backup_dir.exists(), "백업 디렉토리가 없다");
    assert!(
        done.backup_dir.join("manifest.json").is_file(),
        "되돌리기용 매니페스트가 없다"
    );

    // 스킬은 skills/ 밖으로 나갔다
    assert!(
        !f.home.join(".claude/skills/alpha").exists(),
        "스킬이 그대로 있다"
    );
    assert!(
        f.home
            .join(".claude/.harnitor/disabled/skills/alpha/SKILL.md")
            .is_file(),
        "옮긴 자리에 없다 — 내용이 사라졌다면 최악이다"
    );

    // 다시 스캔하면 스킬 목록에서 빠진다
    let after = scan(&f.home);
    assert!(
        !after.global.skills.iter().any(|k| k.name == "alpha"),
        "여전히 스킬로 잡힌다"
    );
}

/// 되돌리기가 실패하면 쓰기를 닫아야 한다(ADR-0004 재검토 조건).
/// 그러니 이 테스트가 이 파일에서 가장 중요하다.
#[test]
fn undo_restores_exactly() {
    let f = common::load();
    let before = std::fs::read_to_string(f.home.join(".claude/skills/alpha/SKILL.md")).unwrap();

    let s = scan(&f.home);
    let plan = plan_disable_skill(&s, "alpha", None).unwrap();
    apply(&f.home, &plan).unwrap();
    undo(&f.home).expect("되돌리기 실패");

    let after = std::fs::read_to_string(f.home.join(".claude/skills/alpha/SKILL.md"))
        .expect("되돌렸는데 파일이 없다");
    assert_eq!(before, after, "내용이 달라졌다");
    assert!(
        !f.home
            .join(".claude/.harnitor/disabled/skills/alpha")
            .exists(),
        "옮긴 자리가 남아 있다 — 두 곳에 존재하면 다음 스캔이 헷갈린다"
    );
}

/// 플러그인은 파일을 옮기지 않는다. `enabledPlugins` 한 줄만 바꾼다.
#[test]
fn plugin_toggle_edits_settings_only() {
    let f = common::load();
    let s = scan(&f.home);
    let plan = plan_toggle_plugin(&s, "vendorpack@somemarket", false).unwrap();

    assert!(
        plan.changes
            .iter()
            .all(|c| matches!(c, Change::EditJson { .. })),
        "플러그인을 끄는데 파일을 옮기려 한다"
    );
    apply(&f.home, &plan).unwrap();

    let after = scan(&f.home);
    let p = after
        .global
        .plugins
        .iter()
        .find(|p| p.name.starts_with("vendorpack"))
        .unwrap();
    assert!(!p.enabled, "설정이 안 바뀌었다");
    assert!(
        f.home
            .join(".claude/plugins/cache/vendorpack/skills/zeta/SKILL.md")
            .exists(),
        "플러그인 파일을 건드렸다 — 껐다 켰다만 해야 한다"
    );
}

/// 심볼릭 링크인 스킬을 옮길 때 **대상을 따라가 복사하면 안 된다**.
/// 링크는 링크로 옮겨야 원본이 남고 되돌리기가 성립한다.
#[test]
fn moving_a_symlinked_skill_keeps_it_a_symlink() {
    let f = common::load();
    let link = f.home.join(".claude/skills/linked-skill");
    assert!(link.is_symlink(), "픽스처 전제가 깨졌다");
    let target = std::fs::read_link(&link).unwrap();

    let s = scan(&f.home);
    let plan = plan_disable_skill(&s, "linked-skill", None).unwrap();
    apply(&f.home, &plan).unwrap();

    let moved = f
        .home
        .join(".claude/.harnitor/disabled/skills/linked-skill");
    assert!(moved.is_symlink(), "링크가 실체로 복사됐다");
    assert_eq!(
        std::fs::read_link(&moved).unwrap(),
        target,
        "링크 대상이 바뀌었다"
    );

    undo(&f.home).unwrap();
    assert!(link.is_symlink(), "되돌렸는데 링크가 아니다");
}

/// 없는 것을 끄려 하면 조용히 성공하면 안 된다.
#[test]
fn disabling_unknown_skill_is_an_error() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(plan_disable_skill(&s, "존재하지-않는-스킬", None).is_err());
}

/// 끈 스킬이 화면에서 사라지면 **다시 켤 방법이 없다.**
/// 목록에서 빼는 게 아니라 "꺼짐" 상태로 남겨야 한다(절대원칙 1과 같은 이유).
#[test]
fn disabled_skills_stay_visible() {
    let f = common::load();
    let s = scan(&f.home);
    let plan = plan_disable_skill(&s, "alpha", None).unwrap();
    apply(&f.home, &plan).unwrap();

    let after = scan(&f.home);
    assert!(
        !after.global.skills.iter().any(|k| k.name == "alpha"),
        "여전히 켜진 것으로 잡힌다"
    );
    let off = after
        .global
        .disabled_skills
        .iter()
        .find(|k| k.name == "alpha")
        .expect("꺼진 스킬 목록에 없다 — 화면에서 되살릴 수가 없다");
    assert!(
        !off.description.is_empty(),
        "꺼졌다고 설명까지 잃으면 무엇이었는지 알 수 없다"
    );
}

/// 토글 뒤 화면을 새로 그릴 때 **과거 호출 기록까지 다시 셀 이유가 없다.**
/// 실측: 대화기록 1.5GB/695파일을 훑느라 스캔이 2.4초 걸리고, 그동안 화면이 멈춘 것처럼 보였다.
#[test]
fn skipping_usage_avoids_the_expensive_pass() {
    let f = common::load();
    let full = scan_with(
        &f.home,
        &ScanOptions {
            load_bodies: false,
            skip_usage: false,
            ..Default::default()
        },
    );
    assert!(!full.usage.is_empty(), "픽스처 전제가 깨졌다");

    let fast = scan_with(
        &f.home,
        &ScanOptions {
            load_bodies: false,
            skip_usage: true,
            ..Default::default()
        },
    );
    assert!(fast.usage.is_empty(), "생략했는데 집계했다");
    // 나머지는 그대로여야 한다 — 빠른 경로가 다른 결과를 내면 화면이 깜빡인다
    assert_eq!(fast.global.skills.len(), full.global.skills.len());
    assert_eq!(fast.projects.len(), full.projects.len());
    assert_eq!(fast.diagnoses.len(), full.diagnoses.len());
}

/// 되돌리기 전에 **무엇이 되돌려지는지** 보여줘야 한다.
/// 모르고 누르는 버튼은 안전장치가 아니다.
#[test]
fn undo_can_be_previewed_before_running() {
    let f = common::load();
    assert!(
        harnitor_core::write::peek_undo(&f.home).unwrap().is_none(),
        "되돌릴 게 없는데 뭔가 있다고 한다"
    );

    let s = scan(&f.home);
    let plan = plan_disable_skill(&s, "beta", None).unwrap();
    apply(&f.home, &plan).unwrap();

    let peek = harnitor_core::write::peek_undo(&f.home)
        .unwrap()
        .expect("되돌릴 것을 못 찾았다");
    assert!(
        peek.summary.contains("beta"),
        "무엇을 되돌리는지 안 알려준다: {}",
        peek.summary
    );
    assert_eq!(peek.change_count, 1);
}

/// MCP 끄기는 **선언 파일을 건드리지 않는다.** Claude Code 자신의 스위치
/// (`~/.claude.json` 의 `disabledMcpServers`)를 쓴다 — 실측에서 24개 프로젝트가
/// 이미 그 방식으로 서버를 꺼두고 있었다. `.mcp.json` 은 팀과 공유되는 자리라
/// 거기서 서버를 지우면 되돌리기가 남의 일이 된다.
#[test]
fn disabling_mcp_flips_the_registry_switch_not_the_declaration() {
    let f = common::load();
    let s = scan(&f.home);
    let proj = s
        .projects
        .iter()
        .find(|p| p.name == "proj-a")
        .expect("proj-a 가 없다");

    let plan = plan_toggle_mcp(&s, &proj.path, "projserver", false).expect("계획 실패");
    match &plan.changes[..] {
        [Change::EditJson { file, path, to }] => {
            assert!(
                file.ends_with(".claude.json"),
                "등록부가 아니라 다른 파일을 건드린다: {}",
                file.display()
            );
            assert_eq!(path[0], "projects");
            assert_eq!(path[2], "disabledMcpServers");
            let list = to.as_ref().unwrap().as_array().unwrap();
            assert!(
                list.iter().any(|x| x == "projserver"),
                "끄는데 목록에 안 들어갔다: {list:?}"
            );
        }
        other => panic!("변경이 EditJson 한 건이 아니다: {other:#?}"),
    }

    // 계획만으로는 아무것도 안 바뀐다
    let before = std::fs::read_to_string(f.home.join(".claude.json")).unwrap();
    apply(&f.home, &plan).expect("적용 실패");
    let after = std::fs::read_to_string(f.home.join(".claude.json")).unwrap();
    assert_ne!(before, after, "적용했는데 등록부가 그대로다");

    // 되돌리면 원래대로
    undo(&f.home).expect("되돌리기 실패");
    assert_eq!(
        std::fs::read_to_string(f.home.join(".claude.json")).unwrap(),
        before,
        "되돌렸는데 등록부가 원래대로가 아니다"
    );
}

/// 등록부의 키는 사용자가 그때 친 경로 그대로다. 우리 쪽 경로는 정규화돼 있어서
/// **대소문자만 다른 등록**(실측 1건)에서 그대로 비교하면 빗나간다.
#[test]
fn mcp_toggle_finds_the_registry_key_despite_case() {
    let f = common::load();
    let s = scan(&f.home);
    let proj = s.projects.iter().find(|p| p.name == "proj-a").unwrap();
    let plan = plan_toggle_mcp(&s, &proj.path, "projserver", false).expect("키를 못 찾았다");
    let Change::EditJson { path, .. } = &plan.changes[0] else {
        panic!("EditJson 이 아니다")
    };
    assert!(
        path[1].to_lowercase().ends_with("proj-a"),
        "엉뚱한 프로젝트 키를 골랐다: {}",
        path[1]
    );
}

/// 이미 꺼져 있는 걸 또 끄면 목록에 두 번 들어가면 안 된다.
#[test]
fn disabling_twice_does_not_duplicate() {
    let f = common::load();
    let s = scan(&f.home);
    let proj = s.projects.iter().find(|p| p.name == "proj-a").unwrap();

    apply(
        &f.home,
        &plan_toggle_mcp(&s, &proj.path, "projserver", false).unwrap(),
    )
    .unwrap();
    let s2 = scan(&f.home);
    let plan = plan_toggle_mcp(&s2, &proj.path, "projserver", false).unwrap();
    let Change::EditJson { to, .. } = &plan.changes[0] else {
        panic!()
    };
    let list = to.as_ref().unwrap().as_array().unwrap();
    assert_eq!(
        list.iter().filter(|x| *x == "projserver").count(),
        1,
        "두 번 껐더니 목록에 두 번 들어갔다: {list:?}"
    );
}

/// 켜기는 목록에서 빼는 것이다. 끄고 켜면 원래 상태로 돌아와야 한다.
#[test]
fn enabling_removes_it_from_the_disabled_list() {
    let f = common::load();
    let s = scan(&f.home);
    let proj = s.projects.iter().find(|p| p.name == "proj-a").unwrap();

    apply(
        &f.home,
        &plan_toggle_mcp(&s, &proj.path, "projserver", false).unwrap(),
    )
    .unwrap();
    let s2 = scan(&f.home);
    apply(
        &f.home,
        &plan_toggle_mcp(&s2, &proj.path, "projserver", true).unwrap(),
    )
    .unwrap();

    let root: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(f.home.join(".claude.json")).unwrap())
            .unwrap();
    let any_disabled = root["projects"].as_object().unwrap().values().any(|p| {
        p.get("disabledMcpServers")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().any(|x| x == "projserver"))
            .unwrap_or(false)
    });
    assert!(!any_disabled, "켰는데 아직 꺼짐 목록에 남아 있다");
}

/// 훅에는 Claude Code 쪽 비활성 스위치가 없다. 그래서 **지우지 않고 옮긴다** —
/// `settings.json` 에서 떼되 `.harnitor/disabled/hooks.json` 에 원본을 남긴다.
/// 지워 버리면 켤 때 되살릴 것이 없다.
#[test]
fn disabling_a_hook_moves_it_to_the_stash() {
    let f = common::load();
    let s = scan(&f.home);
    let cmd = "bash ~/.claude/hooks/trigger.sh";

    let plan = plan_toggle_hook(&s, "UserPromptSubmit", cmd, false).expect("계획 실패");
    assert_eq!(
        plan.changes.len(),
        2,
        "settings 와 보관함 둘 다 바뀌어야 한다"
    );
    apply(&f.home, &plan).expect("적용 실패");

    let live: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(f.home.join(".claude/settings.json")).unwrap(),
    )
    .unwrap();
    assert!(
        !serde_json::to_string(&live["hooks"]["UserPromptSubmit"])
            .unwrap()
            .contains("trigger.sh"),
        "껐는데 settings 에 남아 있다"
    );

    let stash: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(f.home.join(".claude/.harnitor/disabled/hooks.json")).unwrap(),
    )
    .unwrap();
    assert!(
        serde_json::to_string(&stash["hooks"]["UserPromptSubmit"])
            .unwrap()
            .contains("trigger.sh"),
        "보관함에 원본이 없다 — 켤 때 되살릴 것이 없다"
    );
}

/// 껐다 켜면 `settings.json` 이 원래대로여야 한다. 되살린 뒤 보관함에도 남아 있으면
/// 다음에 또 켜지면서 훅이 두 벌이 된다.
#[test]
fn hook_round_trip_restores_settings_exactly() {
    let f = common::load();
    let before = std::fs::read_to_string(f.home.join(".claude/settings.json")).unwrap();
    let cmd = "bash ~/.claude/hooks/trigger.sh";

    let s = scan(&f.home);
    apply(
        &f.home,
        &plan_toggle_hook(&s, "UserPromptSubmit", cmd, false).unwrap(),
    )
    .unwrap();
    let s2 = scan(&f.home);
    apply(
        &f.home,
        &plan_toggle_hook(&s2, "UserPromptSubmit", cmd, true).unwrap(),
    )
    .unwrap();

    let after: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(f.home.join(".claude/settings.json")).unwrap(),
    )
    .unwrap();
    let orig: serde_json::Value = serde_json::from_str(&before).unwrap();
    assert_eq!(
        after["hooks"], orig["hooks"],
        "껐다 켰는데 훅 설정이 원래와 다르다"
    );

    let stash: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(f.home.join(".claude/.harnitor/disabled/hooks.json")).unwrap(),
    )
    .unwrap();
    assert!(
        !serde_json::to_string(&stash["hooks"]["UserPromptSubmit"])
            .unwrap()
            .contains("trigger.sh"),
        "켰는데 보관함에 그대로 남았다 — 또 켜면 훅이 두 벌이 된다"
    );
}

/// 같은 스크립트가 여러 이벤트에 걸릴 수 있다. 하나를 끄려다 다른 이벤트의 것까지
/// 떼면 안 되므로 이벤트가 다르면 못 찾아야 한다.
#[test]
fn hook_toggle_does_not_reach_into_another_event() {
    let f = common::load();
    let s = scan(&f.home);
    let r = plan_toggle_hook(&s, "SessionStart", "bash ~/.claude/hooks/trigger.sh", false);
    assert!(r.is_err(), "다른 이벤트에서 훅을 찾아냈다");
}

/// 꺼둔 훅이 스캔 결과에 남아야 화면에서 다시 켤 수 있다.
/// **목록에서 사라지면 되살릴 길이 없다**(절대원칙 1 — 스킬 끄기와 같은 계약).
#[test]
fn disabled_hooks_stay_visible() {
    let f = common::load();
    let s = scan(&f.home);
    let cmd = "bash ~/.claude/hooks/trigger.sh";
    apply(
        &f.home,
        &plan_toggle_hook(&s, "UserPromptSubmit", cmd, false).unwrap(),
    )
    .unwrap();

    let after = scan(&f.home);
    assert!(
        !after.global.hooks.iter().any(|h| h.command == cmd),
        "껐는데 산 훅 목록에 남아 있다"
    );
    assert!(
        after.global.disabled_hooks.iter().any(|h| h.command == cmd),
        "꺼둔 훅이 결과에서 사라졌다 — 화면에서 다시 켤 방법이 없다"
    );
    assert_eq!(
        after
            .global
            .disabled_hooks
            .iter()
            .find(|h| h.command == cmd)
            .map(|h| h.event.as_str()),
        Some("UserPromptSubmit"),
        "어느 이벤트에서 껐는지를 잃으면 되살릴 자리를 모른다"
    );
}

/// 설정 파일이 우리가 기대한 모양이 아닐 수 있다. **하네스는 원래 깨져 있는 걸 보러 가는
/// 도구다**(절대원칙 9) — 최상위가 객체가 아닌 JSON 을 만나도 패닉하지 않고 거절해야 한다.
#[test]
fn editing_a_non_object_json_is_refused_not_panicked() {
    let f = common::load();
    let broken = f.home.join(".claude/weird.json");
    std::fs::write(&broken, "[1, 2, 3]").unwrap();

    let plan = Plan {
        summary: "말이 안 되는 자리에 쓰기".into(),
        token_delta: 0,
        changes: vec![Change::EditJson {
            file: broken.clone(),
            path: vec!["hooks".into(), "SessionStart".into()],
            to: Some(serde_json::json!([])),
        }],
    };
    let r = apply(&f.home, &plan);
    assert!(r.is_err(), "배열 최상위에 썼는데 성공했다고 한다");
    assert_eq!(
        std::fs::read_to_string(&broken).unwrap(),
        "[1, 2, 3]",
        "거절했는데 파일이 바뀌었다"
    );
}

/// 등록부 키를 고를 때 **접미사 일치로 넘어가면 안 된다.**
/// `/elsewhere/Users/me/app` 이 `/Users/me/app` 으로 끝난다는 이유로 잡히면
/// 남의 프로젝트 설정을 바꾸게 된다.
#[test]
fn mcp_toggle_never_matches_a_merely_suffixed_key() {
    let f = common::load();
    let reg = f.home.join(".claude.json");
    let mut root: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&reg).unwrap()).unwrap();
    // 실제 proj-a 등록을 지우고, 접미사만 같은 엉뚱한 키를 남긴다
    let real = f.home.join("projects/proj-a").to_string_lossy().to_string();
    root["projects"].as_object_mut().unwrap().remove(&real);
    let decoy = format!("/elsewhere{real}");
    root["projects"][&decoy] = serde_json::json!({ "disabledMcpServers": [] });
    std::fs::write(&reg, serde_json::to_string_pretty(&root).unwrap()).unwrap();

    let s = scan(&f.home);
    let Some(proj) = s.projects.iter().find(|p| p.name == "proj-a") else {
        return; // 등록이 사라져 프로젝트로 안 잡히면 이 테스트는 의미가 없다
    };
    let r = plan_toggle_mcp(&s, &proj.path, "projserver", false);
    if let Ok(plan) = r {
        let Change::EditJson { path, .. } = &plan.changes[0] else {
            panic!()
        };
        assert_ne!(
            path[1], decoy,
            "접미사만 같은 남의 등록을 골랐다 — 엉뚱한 프로젝트 설정을 바꾼다"
        );
    }
}

/// 보관함을 사람이 손댔거나 깨졌을 수 있다. 그걸로 패닉하면 훅을 영영 못 켠다.
#[test]
fn a_broken_hook_stash_does_not_panic() {
    let f = common::load();
    let stash = f.home.join(".claude/.harnitor/disabled/hooks.json");
    std::fs::create_dir_all(stash.parent().unwrap()).unwrap();
    std::fs::write(&stash, "\"not an object\"").unwrap();

    let s = scan(&f.home);
    let cmd = "bash ~/.claude/hooks/trigger.sh";
    let plan = plan_toggle_hook(&s, "UserPromptSubmit", cmd, false).expect("계획을 못 세웠다");
    apply(&f.home, &plan).expect("적용 실패");

    let after: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&stash).unwrap()).unwrap();
    assert!(
        serde_json::to_string(&after["hooks"]["UserPromptSubmit"])
            .unwrap()
            .contains("trigger.sh"),
        "깨진 보관함을 만나 원본을 잃었다"
    );
}

/// 되돌리기는 **우리가 바꾼 자리만** 원래 값으로 돌린다.
/// `~/.claude.json` 은 Claude Code 가 쉬지 않고 쓰는 파일이다(팁 기록·새 프로젝트 믿음·MCP 승인).
/// 파일을 통째로 옛 사본으로 덮으면 그 사이 다른 세션이 쓴 것까지 같이 사라진다
/// (2026-10-02 참모 시험: 되돌리는 사이 다른 세션이 키 7개를 바꿔 두었다).
#[test]
fn undo_keeps_what_others_wrote_meanwhile() {
    let f = common::load();
    let reg = f.home.join(".claude.json");
    let s = scan(&f.home);
    let proj = s.projects.iter().find(|p| p.name == "proj-a").unwrap();
    let plan = plan_toggle_mcp(&s, &proj.path, "projserver", false).unwrap();
    let Change::EditJson { path, .. } = &plan.changes[0] else {
        panic!()
    };
    let key = path[1].clone();
    let orig: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&reg).unwrap()).unwrap();
    apply(&f.home, &plan).unwrap();

    // 다른 세션이 끼어든다 — 최상위 값 하나, 새 프로젝트 하나
    let mut root: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&reg).unwrap()).unwrap();
    root["numStartups"] = serde_json::json!(99);
    root["projects"]["/new/trusted"] = serde_json::json!({ "hasTrustDialogAccepted": true });
    std::fs::write(&reg, serde_json::to_string_pretty(&root).unwrap()).unwrap();

    undo(&f.home).expect("되돌리기 실패");
    let after: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&reg).unwrap()).unwrap();
    assert_eq!(
        after["projects"][&key]["disabledMcpServers"], orig["projects"][&key]["disabledMcpServers"],
        "우리가 끈 MCP 가 되돌아가지 않았다"
    );
    assert_eq!(after["numStartups"], 99, "다른 세션이 쓴 값이 지워졌다");
    assert_eq!(
        after["projects"]["/new/trusted"]["hasTrustDialogAccepted"], true,
        "그 사이 믿음 처리한 프로젝트가 사라졌다"
    );
}

/// 우리가 바꾼 **바로 그 자리**를 그 사이 누가 또 바꿨으면 되돌리지 않는다 —
/// 덮으면 그 사람의 변경이 소리 없이 사라진다. 아무것도 건드리지 않고 거절하고, 백업은 남긴다.
#[test]
fn undo_refuses_when_the_same_slot_changed_meanwhile() {
    let f = common::load();
    let reg = f.home.join(".claude.json");
    let s = scan(&f.home);
    let proj = s.projects.iter().find(|p| p.name == "proj-a").unwrap();
    let plan = plan_toggle_mcp(&s, &proj.path, "projserver", false).unwrap();
    let Change::EditJson { path, .. } = &plan.changes[0] else {
        panic!()
    };
    let key = path[1].clone();
    apply(&f.home, &plan).unwrap();

    let mut root: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&reg).unwrap()).unwrap();
    root["projects"][&key]["disabledMcpServers"] =
        serde_json::json!(["ghostserver", "other", "projserver"]);
    let theirs = serde_json::to_string_pretty(&root).unwrap();
    std::fs::write(&reg, &theirs).unwrap();

    let r = undo(&f.home);
    assert!(r.is_err(), "같은 자리가 바뀌었는데 되돌렸다");
    assert_eq!(
        std::fs::read_to_string(&reg).unwrap(),
        theirs,
        "거절했는데 파일이 바뀌었다"
    );
    assert!(
        harnitor_core::write::peek_undo(&f.home).unwrap().is_some(),
        "거절했는데 백업이 사라졌다 — 다시 시도할 길이 없다"
    );
}

/// 훅 끄기는 settings.json 과 보관함 두 파일을 바꾼다. 그 사이 settings.json 의
/// 다른 자리가 바뀌어도 훅만 돌아오고 그 값은 남는다. 키 순서도 지킨다 —
/// 사람이 읽는 설정 파일이라 되돌릴 때마다 순서가 뒤섞이면 diff 가 엉망이 된다.
#[test]
fn hook_undo_keeps_other_settings_and_key_order() {
    let f = common::load();
    let file = f.home.join(".claude/settings.json");
    let cmd = "bash ~/.claude/hooks/trigger.sh";
    let orig: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    let s = scan(&f.home);
    apply(
        &f.home,
        &plan_toggle_hook(&s, "UserPromptSubmit", cmd, false).unwrap(),
    )
    .unwrap();

    let mut root: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    root["zzTheirs"] = serde_json::json!("dark");
    std::fs::write(&file, serde_json::to_string_pretty(&root).unwrap()).unwrap();
    let order: Vec<String> = root.as_object().unwrap().keys().cloned().collect();

    undo(&f.home).expect("되돌리기 실패");
    let after: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(after["hooks"], orig["hooks"], "훅이 원래대로 안 돌아왔다");
    assert_eq!(after["zzTheirs"], "dark", "그 사이 쓴 설정이 지워졌다");
    let got: Vec<String> = after.as_object().unwrap().keys().cloned().collect();
    assert_eq!(got, order, "키 순서가 뒤섞였다");
}

/// settings.json 을 dotfiles 저장소로 링크해 두는 사람이 있다. 고치고 되돌려도
/// **링크는 링크로** 남아야 한다 — 일반 파일로 갈아치우면 그 사람의 설정 저장소와 끊긴다.
/// 권한도 그대로 둔다(`~/.claude.json` 은 600).
#[cfg(unix)]
#[test]
fn writing_keeps_a_symlinked_settings_file_a_symlink() {
    use std::os::unix::fs::PermissionsExt;
    let f = common::load();
    let link = f.home.join(".claude/settings.json");
    let real = f.home.join("dotfiles/settings.json");
    std::fs::create_dir_all(real.parent().unwrap()).unwrap();
    std::fs::rename(&link, &real).unwrap();
    std::os::unix::fs::symlink(&real, &link).unwrap();
    std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o600)).unwrap();

    let s = scan(&f.home);
    let name = s.global.plugins[0].name.clone();
    apply(&f.home, &plan_toggle_plugin(&s, &name, false).unwrap()).unwrap();
    assert!(link.is_symlink(), "적용했더니 링크가 일반 파일이 됐다");
    undo(&f.home).unwrap();
    assert!(link.is_symlink(), "되돌렸더니 링크가 일반 파일이 됐다");
    let mode = std::fs::metadata(&real).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600, "권한이 바뀌었다");
}
