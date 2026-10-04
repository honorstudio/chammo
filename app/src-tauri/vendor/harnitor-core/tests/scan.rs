//! 스캐너 명세.
//!
//! 각 테스트는 **실제 하네스에서 이미 걸린 함정**을 하나씩 고정한다.
//! 주석의 "실측"은 2026-08-27 개발자의 하네스를 스캔해 확인된 수치다.
// 참모 사본: 픽스처가 심볼릭 링크를 유닉스로 만든다 — 윈도우에선 이 테스트 묶음을 뺀다(vendor/HARNITOR.md)
#![cfg(unix)]

mod common;

use harnitor_core::{resolve, scan, scan_with, EdgeKind, Loaded, ScanOptions, Scope};

/// 홈 디렉토리가 `~/.claude.json`의 projects에 등록돼 있어도 프로젝트가 아니다.
/// 홈 = 글로벌이므로, 프로젝트로 세면 글로벌 스킬이 통째로 중복 계산된다.
/// 실측: 이 함정 때문에 로컬 스킬이 128개로 부풀었고, 제외하니 76개였다.
#[test]
fn home_is_not_a_project() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(
        !s.projects.iter().any(|p| p.path == f.home),
        "홈이 프로젝트 목록에 들어갔다: {:?}",
        s.projects.iter().map(|p| &p.path).collect::<Vec<_>>()
    );
}

/// 대소문자만 다른 경로는 macOS에서 같은 폴더지만 Claude Code는 별개로 취급한다.
/// 하나로 합치되, **갈렸다는 사실 자체는 버리지 않고 보고한다**.
/// 실측: `Desktop/dev/project-b-platform`과 `desktop/dev/project-b-platform`.
#[test]
fn case_insensitive_duplicate_is_merged_and_reported() {
    let f = common::load();
    let s = scan(&f.home);
    let a: Vec<_> = s.projects.iter().filter(|p| p.name == "proj-a").collect();
    assert_eq!(a.len(), 1, "대소문자 중복이 두 프로젝트로 남았다");
    assert!(
        !a[0].duplicate_paths.is_empty(),
        "중복 경로를 합치기만 하고 보고하지 않았다"
    );
}

/// 등록돼 있지만 폴더가 사라진 프로젝트는 스캔 대상이 아니다.
/// 실측: 101개 등록 중 72개가 이 상태였다.
#[test]
fn vanished_project_is_skipped() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(!s.projects.iter().any(|p| p.name == "vanished"));
}

/// `SKILL.md`가 없으면 스킬이 아니다. `references/`만 있는 폴더는
/// 다른 스코프의 스킬이 여기에 쌓아둔 **지식**이다.
/// 실측: `troubleshooting/` 5곳, 21건. 스킬로 세면 71 → 76개로 부푼다.
#[test]
fn folder_without_skill_md_is_knowledge_not_skill() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(
        !s.global.skills.iter().any(|k| k.name == "gamma"),
        "SKILL.md 없는 폴더를 스킬로 셌다"
    );
    let k = s
        .global
        .knowledge
        .iter()
        .find(|k| k.name == "gamma")
        .expect("지식 폴더로 잡히지 않았다");
    assert_eq!(k.entries, 1);
}

/// frontmatter의 `description: >` 멀티라인이 잘리면 안 된다.
/// 정규식 파서가 여기서 무너져 멀쩡한 스킬 12개를 "설명 없음"으로 오탐했다.
/// **진단 도구의 오탐은 도구 전체의 신뢰를 깎는다.**
#[test]
fn multiline_description_is_parsed_whole() {
    let f = common::load();
    let s = scan(&f.home);
    let beta = s
        .global
        .skills
        .iter()
        .find(|k| k.name == "beta")
        .expect("beta 없음");
    assert!(beta.description.contains("여러 줄"), "첫 줄이 없다");
    assert!(
        beta.description.contains("세 번째 줄"),
        "마지막 줄이 잘렸다"
    );
    assert!(
        !beta.description.contains("allowed-tools"),
        "다음 키까지 먹었다"
    );
}

/// 대상이 사라진 심볼릭 링크는 조용히 남아 있다. 살아있는 것과 구분해 보고한다.
/// 실측: `example-lore/data`, `project-b/copy-skills` 2개가 방치돼 있었다.
#[test]
fn broken_symlink_is_reported_alongside_live_one() {
    let f = common::load();
    let s = scan(&f.home);
    let broken = s
        .global
        .links
        .iter()
        .find(|l| l.path.ends_with("broken-skill"))
        .expect("깨진 링크를 못 찾았다");
    assert!(!broken.alive);
    let live = s
        .global
        .links
        .iter()
        .find(|l| l.path.ends_with("linked-skill"))
        .expect("살아있는 링크를 못 찾았다");
    assert!(live.alive);
}

/// 파싱 안 되는 JSON이 전체 스캔을 죽이면 안 된다.
/// 하네스는 **원래 깨져 있는 상태를 보러 가는 도구**다(CLAUDE.md 절대원칙 9).
#[test]
fn broken_json_does_not_abort_the_scan() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(
        s.projects.iter().any(|p| p.name == "proj-a"),
        "깨진 프로젝트 때문에 멀쩡한 프로젝트까지 못 읽었다"
    );
    assert!(
        s.failures.iter().any(|x| x.path.ends_with(".mcp.json")),
        "읽기 실패를 조용히 삼켰다 — 실패는 결과에 담겨야 한다"
    );
}

/// 이름이 겹치면 프로젝트 스코프가 이긴다 — MCP도 스킬도.
/// 다만 **겹치지 않는 글로벌 항목은 그대로 살아남는다**(통째로 대체가 아니다).
#[test]
fn project_scope_wins_on_name_collision() {
    let f = common::load();
    let s = scan(&f.home);
    let p = s
        .projects
        .iter()
        .find(|p| p.name == "proj-a")
        .expect("proj-a 없음");
    let r = resolve(&s, p);

    let pw: Vec<_> = r
        .mcp
        .iter()
        .filter(|(_, m)| m.name == "playwright")
        .collect();
    assert_eq!(pw.len(), 1, "MCP가 합쳐졌다 — 대체돼야 한다");
    assert_eq!(pw[0].0, Scope::Project);
    assert_eq!(pw[0].1.command.as_deref(), Some("isolated-browser"));

    let alpha: Vec<_> = r.skills.iter().filter(|(_, k)| k.name == "alpha").collect();
    assert_eq!(alpha.len(), 1, "같은 이름 스킬이 둘 다 살아남았다");
    assert_eq!(alpha[0].0, Scope::Project);

    // 겹치지 않는 글로벌 스킬은 그대로 내려온다
    assert!(r
        .skills
        .iter()
        .any(|(sc, k)| k.name == "beta" && *sc == Scope::Global));
}

/// frontmatter의 `description` 값 안에 `: `가 들어가면 엄격한 YAML 파서는 거부한다.
/// 그런데 **실제 스킬들이 그렇게 쓰여 있고 Claude Code는 읽는다**(실측: legal-analysis, lore-keeper).
/// 스캐너가 실제보다 엄격하면 멀쩡한 스킬을 "설명 없음"으로 오탐한다 — 신뢰를 깎는 쪽이다.
/// 그래서 **관대하게 복구하되, 규격을 벗어났다는 사실은 보고한다**.
#[test]
fn lenient_frontmatter_recovers_and_reports() {
    let f = common::load();
    let s = scan(&f.home);
    let d = s
        .global
        .skills
        .iter()
        .find(|k| k.name == "delta")
        .expect("delta 없음");
    assert!(
        d.description.contains("법률 문서를 검토한다"),
        "설명을 못 읽었다"
    );
    assert!(d.description.contains("검토해줘"), "콜론 뒤가 잘렸다");
    assert!(
        s.failures.iter().any(|x| x.path.starts_with(&d.path)),
        "관대하게 읽었으면서 규격 위반을 조용히 삼켰다"
    );
}

/// frontmatter가 없는 스킬은 자동 발동이 안 된다. 스킬로는 잡되 보고한다.
#[test]
fn skill_without_frontmatter_is_reported() {
    let f = common::load();
    let s = scan(&f.home);
    let e = s
        .global
        .skills
        .iter()
        .find(|k| k.name == "epsilon")
        .expect("epsilon 없음");
    assert!(e.description.is_empty());
    assert!(
        s.failures.iter().any(|x| x.path.starts_with(&e.path)),
        "frontmatter 없음을 보고하지 않았다"
    );
}

/// 심볼릭 링크는 스킬 폴더 바로 아래에만 있는 게 아니다.
/// 실측: `~/.claude/skills/example-lore/data`가 한 단계 안쪽에서 깨져 있었다.
#[test]
fn symlink_inside_skill_folder_is_found() {
    let f = common::load();
    let s = scan(&f.home);
    let nested = s
        .global
        .links
        .iter()
        .find(|l| l.path.ends_with("alpha/data"))
        .expect("스킬 폴더 안쪽 심링크를 놓쳤다");
    assert!(!nested.alive);
}

/// 훅은 사람이 부르지 않아도 도는 유일한 계층이다.
/// 훅 스크립트가 스킬 이름을 언급하면 그게 "환기" 관계다.
/// 실측: `dev-trigger-prompt.sh` 하나가 스킬 8개를 환기한다.
#[test]
fn hook_to_skill_edge_is_extracted() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(
        s.edges.iter().any(|e| e.kind == EdgeKind::HookTriggers
            && e.from.ends_with("trigger.sh")
            && e.to == "alpha"),
        "훅 → 스킬 엣지를 못 찾았다"
    );
}

/// 이름 검색이 부분 문자열에 걸리면 안 된다.
/// `alphabet`이 `alpha` 참조로 잡히면 그래프 전체가 거짓말이 된다.
#[test]
fn substring_does_not_create_a_false_edge() {
    let f = common::load();
    let s = scan(&f.home);
    let refs: Vec<_> = s
        .edges
        .iter()
        .filter(|e| e.kind == EdgeKind::SkillRefers && e.from == "beta" && e.to == "alpha")
        .collect();
    assert_eq!(
        refs.len(),
        1,
        "같은 참조가 중복 계산되거나 부분 문자열에 걸렸다"
    );
}

/// 스킬이 어디에도 선언되지 않은 MCP 서버를 부르면 실행 시 실패한다.
/// 실측: 9건(`supabase` 3건 등). 선언된 것과 구분해 잡는다.
#[test]
fn missing_mcp_call_is_distinguished_from_declared_one() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(
        s.edges
            .iter()
            .any(|e| e.kind == EdgeKind::CallsMcp && e.from == "alpha" && e.to == "playwright"),
        "선언된 MCP 호출을 못 찾았다"
    );
    assert!(
        s.edges.iter().any(|e| e.kind == EdgeKind::CallsMissingMcp
            && e.from == "beta"
            && e.to == "ghostserver"),
        "선언 안 된 MCP 호출을 못 찾았다"
    );
}

/// MCP 서버는 `.mcp.json`뿐 아니라 `~/.claude.json` 최상위 `mcpServers`(user 스코프)에도 선언된다.
/// 한쪽만 읽으면 멀쩡히 선언된 서버를 "선언 안 됨"으로 오탐한다.
/// 실측: `pixellab`·`mobile`·`peekaboo`·`magnific` 4개가 이쪽에만 있었다.
#[test]
fn user_scope_mcp_servers_are_read() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(
        s.global.mcp.iter().any(|m| m.name == "userserver"),
        "~/.claude.json의 mcpServers를 놓쳤다: {:?}",
        s.global.mcp.iter().map(|m| &m.name).collect::<Vec<_>>()
    );
    assert!(
        !s.edges
            .iter()
            .any(|e| e.kind == EdgeKind::CallsMissingMcp && e.to == "userserver"),
        "선언된 서버를 '선언 안 됨'으로 오탐했다"
    );
}

/// MCP 선언 자리는 셋이고 **운명이 다르다.** 불리언 하나로는 담기지 않는다.
///
/// ```text
/// ~/.claude.json  mcpServers   모든 세션이 읽는다        Always
/// ~/.claude/.mcp.json          어느 세션도 안 읽는다      Never
/// ~/.mcp.json                  홈에서 열 때만 읽힌다      HomeOnly
/// ```
///
/// 실측: 사용자가 "평소엔 이게 깔려 있다"고 알던 fallback 이 `~/.claude/` 가 아니라
/// **홈 루트 `~/.mcp.json`** 에 있었다. 스캔 대상에 없어서 그 자리를 통째로 놓치고 있었고,
/// 그래서 "글로벌에 없다"는 화면의 말이 사실과 어긋났다.
#[test]
fn home_root_mcp_json_is_scanned() {
    let f = common::load();
    let s = scan(&f.home);
    let m = s
        .global
        .mcp
        .iter()
        .find(|m| m.name == "homefallback")
        .unwrap_or_else(|| {
            panic!(
                "~/.mcp.json 을 안 읽었다: {:?}",
                s.global.mcp.iter().map(|m| &m.name).collect::<Vec<_>>()
            )
        });
    assert_eq!(
        m.loaded,
        Loaded::HomeOnly,
        "홈 루트 선언을 다른 자리와 같은 상태로 담았다"
    );
    assert!(
        m.declared_in.contains("~/.mcp.json"),
        "어느 파일에서 왔는지가 안 남았다: {}",
        m.declared_in
    );
}

/// **"안 읽힌다"와 "홈에서만 읽힌다"를 한 진단에 섞지 않는다.**
///
/// 섞으면 고칠 자리가 흐려진다 — `~/.claude/.mcp.json` 은 옮겨야 하고,
/// `~/.mcp.json` 은 (의도한 fallback 이라면) 그대로 둬도 된다. 원인이 하나로 보여야
/// 무엇을 할지 안다(2026-08-28 결정과 같은 이유).
#[test]
fn home_only_mcp_is_not_counted_as_unread() {
    let f = common::load();
    let s = scan(&f.home);
    let unread = s
        .diagnoses
        .iter()
        .find(|d| d.rule == "mcp.declared_where_nobody_reads");
    if let Some(d) = unread {
        assert!(
            !d.evidence.iter().any(|e| e.contains("homefallback")),
            "홈에서만 읽히는 선언을 '아무도 안 읽는다'에 섞었다: {:?}",
            d.evidence
        );
    }
}

/// **홈에서만 읽히는 선언은 어휘가 아니다.**
///
/// 스킬은 아무 폴더에서나 돈다. 홈에서만 뜨는 서버를 "선언됐다"고 치면
/// 프로젝트에서 실패할 호출을 괜찮다고 말하게 된다 — 안 읽히는 선언을 어휘에서
/// 뺐던 것과 같은 이유다(그때 미선언 호출이 10건에서 18건으로 드러났다).
#[test]
fn home_only_mcp_does_not_vouch_for_a_call() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(
        s.edges.iter().any(|e| e.kind == EdgeKind::CallsMissingMcp
            && e.from == "delta"
            && e.to == "homefallback"),
        "홈에서만 읽히는 서버를 선언으로 쳐서 호출을 괜찮다고 판정했다"
    );
}

/// 스킬이 MCP를 부르는 건 `SKILL.md`에만 쓰여 있지 않다. `references/`에도 있다.
/// 실측: `manage-mcp`의 MCP 호출 대부분이 references에 있었다.
#[test]
fn mcp_calls_in_references_are_found() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(
        s.edges
            .iter()
            .any(|e| e.kind == EdgeKind::CallsMcp && e.from == "alpha" && e.to == "userserver"),
        "references/ 안의 MCP 호출을 놓쳤다"
    );
}

/// 스킬 호출 횟수는 대화 기록(`~/.claude/projects/**/*.jsonl`)에서 집계한다.
/// 실측: 이 집계로 arkcli 24개가 호출 0회임을 확인했다.
#[test]
fn skill_usage_is_counted_from_session_logs() {
    let f = common::load();
    let s = scan(&f.home);
    let alpha = s
        .usage
        .iter()
        .find(|u| u.skill == "alpha")
        .expect("alpha 사용 기록 없음");
    assert_eq!(alpha.count, 2);
    assert_eq!(
        alpha.last_used.as_deref(),
        Some("2026-08-02T11:00:00Z"),
        "마지막 사용일이 최신이 아니다"
    );
    let delta = s
        .usage
        .iter()
        .find(|u| u.skill == "delta")
        .expect("delta 사용 기록 없음");
    assert_eq!(delta.count, 1, "여러 세션 파일을 합산하지 못했다");
}

/// 지금 하네스에 없는 스킬이 기록에 남아 있을 수 있다(지웠거나 이름이 바뀐 것).
/// 이것도 정보다 — 버리지 않고 표시한다.
#[test]
fn usage_of_removed_skill_is_flagged_not_dropped() {
    let f = common::load();
    let s = scan(&f.home);
    let d = s
        .usage
        .iter()
        .find(|u| u.skill == "deleted-skill")
        .expect("삭제된 스킬 기록을 버렸다");
    assert!(d.not_in_files);
    let alpha = s.usage.iter().find(|u| u.skill == "alpha").unwrap();
    assert!(!alpha.not_in_files);
}

/// 한 번도 호출되지 않은 스킬은 기록에 없다. 그 사실 자체가 결과에 드러나야 한다.
#[test]
fn never_called_skill_has_no_usage_entry() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(s.global.skills.iter().any(|k| k.name == "beta"));
    assert!(
        !s.usage.iter().any(|u| u.skill == "beta"),
        "호출한 적 없는 스킬에 기록이 생겼다"
    );
}

/// 플러그인이 데려온 스킬도 하네스의 일부다. 활성/비활성을 구분해 잡는다.
/// 실측: 플러그인 SKILL.md가 401개 있고, 그중 활성 플러그인 것만 실제로 로드된다.
#[test]
fn enabled_plugin_skills_are_collected() {
    let f = common::load();
    let s = scan(&f.home);
    let p = s
        .global
        .plugins
        .iter()
        .find(|p| p.name.starts_with("vendorpack"))
        .expect("플러그인을 못 찾았다");
    assert!(p.enabled);
    assert!(
        p.skills.iter().any(|k| k.name == "zeta"),
        "플러그인 스킬을 못 읽었다"
    );
    let off = s
        .global
        .plugins
        .iter()
        .find(|p| p.name.starts_with("disabledpack"));
    assert!(
        off.is_some_and(|p| !p.enabled),
        "비활성 플러그인을 활성으로 봤다"
    );
}

/// 플러그인 스킬은 `플러그인:스킬` 꼴로 기록된다(실측: `document-skills:xlsx`).
/// 이름 그대로 비교하면 멀쩡한 스킬이 "파일에 없음"으로 잡힌다.
#[test]
fn plugin_qualified_skill_name_matches() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(
        s.global
            .plugins
            .iter()
            .any(|p| p.skills.iter().any(|k| k.name == "zeta")),
        "플러그인 스킬 zeta가 없다"
    );
    // 기록이 `vendorpack:zeta`로 남아도 파일에 있는 것으로 봐야 한다
    let known: Vec<String> = vec!["zeta".into()];
    assert!(harnitor_core::usage::is_known_for_test(
        "vendorpack:zeta",
        &known
    ));
    assert!(!harnitor_core::usage::is_known_for_test(
        "nowhere:missing",
        &known
    ));
}

/// 하네스 파일에는 API 키가 평문으로 들어 있다(실측: `.mcp.json`의 context7 키).
/// 스캔 결과는 화면·JSON·로그로 나가므로 **원문이 절대 실려서는 안 된다**
/// (CLAUDE.md 절대원칙 2).
#[test]
fn secrets_never_appear_in_scan_output() {
    let f = common::load();
    let s = scan(&f.home);
    let dump = serde_json::to_string(&s).expect("직렬화 실패");

    assert!(
        !dump.contains("sk-FAKE-0123456789abcdefghij"),
        "인자에 담긴 키가 그대로 나갔다"
    );
    assert!(
        !dump.contains("FAKE-tok-abcdefghij0123456789"),
        "URL 쿼리의 토큰이 그대로 나갔다"
    );

    // 가렸다는 사실은 보여야 한다 — 값이 사라지면 "원래 없는 것"과 구분이 안 된다
    let m = s
        .global
        .mcp
        .iter()
        .find(|m| m.name == "secretful")
        .expect("서버가 없다");
    assert!(
        m.args.iter().any(|a| a.contains("…")),
        "가린 자리를 표시하지 않았다"
    );
    assert!(
        m.args.iter().any(|a| a == "--api-key"),
        "키 이름까지 지웠다 — 무엇이 있었는지는 남겨야 한다"
    );
}

/// 시크릿 마스킹은 **한 군데라도 새면 의미가 없다**(절대원칙 2).
/// 아래는 전부 코드리뷰에서 실제로 새는 것이 확인된 형태다.
#[test]
fn secrets_leak_through_no_shape() {
    use harnitor_core::secret::{mask_args, mask_url};

    // 쿼리 파라미터가 둘 이상이면 첫 '='에서 잘려 통과하던 자리
    let a = mask_args(&[
        "npx".into(),
        "https://h/mcp?project_ref=abc&api_key=SUPERSECRETVALUE123".into(),
    ]);
    assert!(
        !a.join(" ").contains("SUPERSECRETVALUE123"),
        "멀티 파라미터 URL이 샌다: {a:?}"
    );
    assert!(
        a.join(" ").contains("project_ref=abc"),
        "비밀이 아닌 값까지 가렸다: {a:?}"
    );

    // 경로에 토큰이 박힌 형태
    let u = mask_url("https://h/sse/TOKENabcdefghij123456");
    assert!(
        !u.contains("TOKENabcdefghij123456"),
        "경로형 토큰이 샌다: {u}"
    );

    // 반대 방향 — 비밀이 아닌 것을 가리면 멀쩡한 설정이 감춰진 것처럼 보인다
    let b = mask_args(&[
        "keyring-helper".into(),
        "--transport".into(),
        "stdio".into(),
    ]);
    assert_eq!(
        b,
        vec!["keyring-helper", "--transport", "stdio"],
        "이름에 key가 들었다고 다음 인자를 가렸다"
    );

    // 진짜 비밀은 여전히 가려야 한다
    let c = mask_args(&["--api-key".into(), "sk-REAL-abcdefghijklmn".into()]);
    assert!(
        !c.join(" ").contains("sk-REAL-abcdefghijklmn"),
        "진짜 키를 안 가렸다: {c:?}"
    );
    assert!(c[0] == "--api-key", "키 이름까지 지웠다");
}

/// Claude Code는 `settings.local.json`을 함께 읽는다. 한쪽만 보면
/// 로컬에서 허용한 서버가 "권한 없음"으로, 로컬 훅은 아예 없는 것으로 잡힌다.
/// 실측: 이 맥의 글로벌 local settings에 mcp allow가 15개 더 있었다.
#[test]
fn local_settings_are_merged() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(
        s.global
            .allowed_mcp
            .iter()
            .any(|p| p.starts_with("mcp__localonly")),
        "settings.local.json의 권한을 놓쳤다: {:?}",
        s.global.allowed_mcp
    );
    assert!(
        s.global
            .hooks
            .iter()
            .any(|h| h.command.contains("local-hook.sh")),
        "settings.local.json의 훅을 놓쳤다"
    );
    assert!(
        s.global
            .denied_mcp
            .iter()
            .any(|p| p.starts_with("mcp__banned")),
        "permissions.deny를 통째로 무시했다"
    );
}

/// 스킬이 무엇을 하는지 알려면 설명 한 줄로는 부족하다 — 본문을 읽을 수 있어야 한다.
/// 다만 본문은 크므로 요청할 때만 담는다(`scan`은 메타데이터, `view`는 본문 포함).
#[test]
fn bodies_are_loaded_only_when_asked() {
    let f = common::load();
    let lean = scan(&f.home);
    let alpha = lean
        .global
        .skills
        .iter()
        .find(|s| s.name == "alpha")
        .unwrap();
    assert!(
        alpha.body.is_none(),
        "기본 스캔에 본문이 실렸다 — JSON이 불필요하게 커진다"
    );

    let full = scan_with(
        &f.home,
        &ScanOptions {
            load_bodies: true,
            skip_usage: false,
            ..Default::default()
        },
    );
    let alpha = full
        .global
        .skills
        .iter()
        .find(|s| s.name == "alpha")
        .unwrap();
    let body = alpha.body.as_deref().expect("본문을 안 읽었다");
    assert!(
        body.contains("mcp__playwright__browser_click"),
        "본문이 잘렸다"
    );
    assert!(
        full.global.claude_md_body.is_some(),
        "CLAUDE.md 본문을 안 읽었다"
    );
}

/// `CLAUDE.local.md`는 계정·키를 담으라고 만든 파일이고 gitignore된다.
/// **존재는 알리되 내용은 절대 싣지 않는다** — 리포트는 공유될 수 있다.
#[test]
fn local_instruction_body_is_never_loaded() {
    let f = common::load();
    let full = scan_with(
        &f.home,
        &ScanOptions {
            load_bodies: true,
            skip_usage: false,
            ..Default::default()
        },
    );
    let p = full.projects.iter().find(|p| p.name == "proj-a").unwrap();
    assert!(p.has_claude_local_md, "존재 자체를 놓쳤다");
    let dump = serde_json::to_string(&full).unwrap();
    assert!(
        !dump.contains("sk-FAKE-SHOULD-NEVER-BE-READ-9999"),
        "CLAUDE.local.md 내용이 결과에 실렸다"
    );
}

/// 화면에서 EN 을 눌렀는데 진단만 한국어로 남으면, 반쯤 번역된 화면이 되어
/// 아예 한국어인 것보다 나쁘다. **영어 출력에 한글이 한 글자라도 있으면 실패**한다.
///
/// 진단 문구는 앞으로도 늘어난다. 새 규칙을 한국어로만 쓰고 넘어가는 순간 이 테스트가 잡는다.
#[test]
fn english_diagnoses_contain_no_korean() {
    let f = common::load();
    let en = scan_with(
        &f.home,
        &ScanOptions {
            skip_usage: false,
            lang: harnitor_core::i18n::Lang::En,
            ..Default::default()
        },
    );
    assert!(
        !en.diagnoses.is_empty(),
        "픽스처가 진단을 하나도 안 냈다 — 이 테스트가 아무것도 검사하지 못한다"
    );

    let hangul = |s: &str| {
        s.chars().any(|c| {
            ('\u{AC00}'..='\u{D7A3}').contains(&c) || ('\u{3130}'..='\u{318F}').contains(&c)
        })
    };
    for d in &en.diagnoses {
        assert!(
            !hangul(&d.title),
            "[{}] 영어 제목에 한글이 있다: {}",
            d.rule,
            d.title
        );
        assert!(
            !hangul(&d.detail),
            "[{}] 영어 설명에 한글이 있다: {}",
            d.rule,
            d.detail
        );
        for e in &d.evidence {
            assert!(!hangul(e), "[{}] 영어 근거에 한글이 있다: {e}", d.rule);
        }
    }
}

/// 같은 하네스를 두 언어로 진단하면 **같은 규칙이 같은 개수만큼** 나와야 한다.
/// 문장만 다르지 판정은 언어와 무관하다 — 여기가 어긋나면 번역하다 조건을 건드린 것이다.
#[test]
fn both_languages_find_the_same_rules() {
    let f = common::load();
    let mk = |lang| {
        let s = scan_with(
            &f.home,
            &ScanOptions {
                skip_usage: false,
                lang,
                ..Default::default()
            },
        );
        s.diagnoses
            .iter()
            .map(|d| (d.rule.clone(), d.evidence.len()))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        mk(harnitor_core::i18n::Lang::Ko),
        mk(harnitor_core::i18n::Lang::En),
        "언어에 따라 진단 결과가 달라졌다"
    );
}

/// 화면을 다시 그릴 때는 1.5GB 대화기록을 또 훑지 않는다(`skip_usage`). 그런데 그때
/// **진단까지 호출 기록을 잃으면 "안 쓰는 스킬"이 전부로 부푼다** — 훑지 않았을 뿐인데
/// 안 쓴다고 말하는 셈이다. 실측에서 65개·8,820토큰이 81개·12,746토큰으로 뛰었다.
#[test]
fn skipping_usage_does_not_inflate_the_unused_diagnosis() {
    let f = common::load();
    let full = scan_with(&f.home, &ScanOptions::default());
    let unused = |s: &harnitor_core::Scan| {
        s.diagnoses
            .iter()
            .find(|d| d.rule == "skill.never_called")
            .map(|d| d.evidence.len())
    };

    // 아는 값을 넘기면 다시 훑지 않아도 진단이 같아야 한다
    let reused = scan_with(
        &f.home,
        &ScanOptions {
            skip_usage: true,
            known_usage: Some(full.usage.clone()),
            ..Default::default()
        },
    );
    assert_eq!(
        unused(&reused),
        unused(&full),
        "아는 호출 기록을 넘겼는데 진단이 달라졌다"
    );
    assert_eq!(
        reused.usage.len(),
        full.usage.len(),
        "넘긴 호출 기록이 결과에 안 실렸다"
    );

    // 아무것도 안 넘기면 부푼다 — 그게 이 옵션이 있는 이유다
    let blind = scan_with(
        &f.home,
        &ScanOptions {
            skip_usage: true,
            ..Default::default()
        },
    );
    assert!(
        unused(&blind) >= unused(&full),
        "기록 없이 스캔했는데 오히려 덜 잡혔다 — 픽스처에 쓰인 스킬이 없다는 뜻이라 이 테스트가 무의미하다"
    );
}

/// 같은 이름의 스킬이 여러 곳에 있으면 **이름만으로는 못 가른다.**
/// 실측에서 `verify-tests` 가 프로젝트 세 곳에, `troubleshooting` 은 글로벌과
/// 프로젝트 양쪽에 있었다. 엣지에 주인이 없으면 A 프로젝트 화면에 B 의 연결선이 섞인다.
#[test]
fn edges_carry_the_project_they_belong_to() {
    let f = common::load();
    let scan = scan_with(&f.home, &ScanOptions::default());

    // 픽스처는 alpha 를 글로벌과 proj-a 양쪽에 두고, 두 프로젝트 지침이 모두 부른다
    let doc_to_alpha: Vec<&harnitor_core::Edge> = scan
        .edges
        .iter()
        .filter(|e| e.from == "CLAUDE.md" && e.to == "alpha")
        .collect();
    assert!(
        doc_to_alpha.len() >= 2,
        "지침 → alpha 엣지가 둘 미만이다 — 프로젝트 CLAUDE.md 를 안 읽고 있다: {doc_to_alpha:#?}"
    );

    // 경로는 스캐너가 정규화한다(macOS 는 /var 가 /private/var 심링크다) —
    // 여기서 통째로 비교하면 그 차이에 걸린다. 끝 이름으로 가른다.
    let owned = |name: &str| {
        doc_to_alpha
            .iter()
            .filter(|e| e.project.as_deref().and_then(|p| p.file_name()) == Some(name.as_ref()))
            .count()
    };
    assert_eq!(owned("proj-a"), 1, "proj-a 지침이 부른 alpha 엣지가 없다");
    assert_eq!(owned("proj-b"), 1, "proj-b 지침이 부른 alpha 엣지가 없다");

    // proj-a 는 자기 alpha 를, proj-b 는 없으므로 전역 alpha 를 가리킨다
    let scope_of = |name: &str| {
        doc_to_alpha
            .iter()
            .find(|e| e.project.as_deref().and_then(|p| p.file_name()) == Some(name.as_ref()))
            .map(|e| e.to_scope)
    };
    assert_eq!(scope_of("proj-a"), Some(harnitor_core::Scope::Project));
    assert_eq!(scope_of("proj-b"), Some(harnitor_core::Scope::Global));
}

/// 글로벌끼리 이어진 엣지에는 주인이 없다. 있으면 프로젝트 화면에서 걸러져 사라진다.
#[test]
fn global_only_edges_have_no_owner() {
    let f = common::load();
    let scan = scan_with(&f.home, &ScanOptions::default());
    for e in &scan.edges {
        if e.from_scope == harnitor_core::Scope::Global
            && e.to_scope == harnitor_core::Scope::Global
            && e.project.is_some()
        {
            // 프로젝트 안에서 전역 스킬을 부른 경우는 정상이다 — from 이 프로젝트 것인지로 가른다
            assert!(
                e.from == "CLAUDE.md"
                    || scan
                        .projects
                        .iter()
                        .any(|p| p.skills.iter().any(|s| s.name == e.from)
                            || p.hooks.iter().any(|h| h.command.contains(&e.from))),
                "글로벌끼리인데 주인이 붙었다: {e:#?}"
            );
        }
    }
}

/// 꺼둔 MCP 를 안 읽으면 **꺼진 것도 켜진 것처럼 보인다.**
/// 실측에서 24개 프로젝트가 이미 뭔가를 꺼두고 있었는데 화면은 전부 살아 있다고 했다.
#[test]
fn disabled_mcp_servers_are_visible_as_state() {
    let f = common::load();
    let s = scan(&f.home);
    let a = s.projects.iter().find(|p| p.name == "proj-a").unwrap();
    assert!(
        a.disabled_mcp.iter().any(|x| x == "ghostserver"),
        "꺼둔 서버를 못 읽었다: {:?}",
        a.disabled_mcp
    );
    // 끈다고 선언이 사라지지는 않는다 — 상태로 구분할 뿐 목록에서 빼지 않는다(절대원칙 1)
    let b = s.projects.iter().find(|p| p.name == "proj-b").unwrap();
    assert!(b.disabled_mcp.is_empty(), "안 끈 프로젝트에 꺼짐이 생겼다");
}

/// 진단이 **짚어 줄 대상**을 갖고 있어야 화면이 그걸 하이라이트할 수 있다.
/// 근거(`evidence`)는 규칙마다 모양이 다른 사람용 문장이라, 화면이 그걸 되짚어
/// 파싱하면 문구를 고칠 때마다 조용히 깨진다.
#[test]
fn every_diagnosis_points_at_something() {
    let f = common::load();
    let s = scan(&f.home);
    assert!(!s.diagnoses.is_empty(), "픽스처가 진단을 안 냈다");
    for x in &s.diagnoses {
        assert!(
            !x.targets.is_empty(),
            "[{}] 짚을 대상이 없다 — 눌러도 화면에서 아무것도 안 밝아진다",
            x.rule
        );
    }
}

/// 대상은 **화면에 뜨는 이름과 같은 말**이어야 한다. 경로나 `a → b` 같은 문장이
/// 섞여 들어오면 칩과 맞춰볼 수가 없다.
#[test]
fn diagnosis_targets_are_names_not_sentences() {
    let f = common::load();
    let s = scan(&f.home);
    // 화면이 아는 이름 전부
    let mut known: Vec<&str> = vec![];
    known.extend(s.global.skills.iter().map(|x| x.name.as_str()));
    known.extend(s.global.disabled_skills.iter().map(|x| x.name.as_str()));
    // 플러그인이 데려온 스킬도 화면에 칩으로 뜬다
    known.extend(
        s.global
            .plugins
            .iter()
            .filter(|p| p.enabled)
            .flat_map(|p| p.skills.iter().map(|x| x.name.as_str())),
    );
    known.extend(s.global.mcp.iter().map(|x| x.name.as_str()));
    known.extend(s.global.knowledge.iter().map(|x| x.name.as_str()));
    for p in &s.projects {
        known.push(p.name.as_str());
        known.extend(p.skills.iter().map(|x| x.name.as_str()));
        known.extend(p.mcp.iter().map(|x| x.name.as_str()));
        known.extend(p.knowledge.iter().map(|x| x.name.as_str()));
    }
    // 깨진 링크는 스킬로 스캔되지 않는다(SKILL.md 가 없으니). 그래도 **화면에는 떠야 한다** —
    // 죽은 참조는 숨길 것이 아니라 상태다(절대원칙 1).
    let link_names: Vec<String> = s
        .global
        .links
        .iter()
        .chain(s.projects.iter().flat_map(|p| p.links.iter()))
        .filter_map(|l| l.path.file_name().map(|n| n.to_string_lossy().into_owned()))
        .collect();
    known.extend(link_names.iter().map(|x| x.as_str()));

    for x in &s.diagnoses {
        for tgt in &x.targets {
            assert!(
                !tgt.contains('/') && !tgt.contains('→') && !tgt.contains(':'),
                "[{}] 대상에 문장이 섞였다: {tgt}",
                x.rule
            );
            // **선언 없이 이름만 있는 MCP** 세 갈래는 예외다 — 부르기만 하는 것,
            // 권한만 있는 것, 거부 목록에만 있는 것. 셋 다 실체가 없어서 이름이
            // 스캔 목록 어디에도 안 남는다.
            // 화면은 이 중 첫째만 "유령" 칩으로 그린다. 나머지 둘은 아직 안 그려서
            // 진단을 눌러도 밝아질 대상이 없다(roadmap 부채).
            if matches!(
                x.rule.as_str(),
                "mcp.missing_server_called" | "mcp.permission_without_server" | "mcp.denied"
            ) {
                continue;
            }
            assert!(
                known.contains(&tgt.as_str()),
                "[{}] 화면에 없는 이름을 짚는다: {tgt}",
                x.rule
            );
        }
    }
}

/// 진단은 **지금 보고 있는 프로젝트의 이야기**여야 한다.
/// 한 덩어리로 내면 A 프로젝트 화면에 B 의 문제가 섞여 뜬다
/// (실측: 선언 안 된 MCP 호출 10건 중 1건, 깨진 링크 2건 중 1건이 특정 프로젝트 것이었다).
#[test]
fn diagnoses_belong_to_a_project_or_to_the_global_scope() {
    let f = common::load();
    let s = scan(&f.home);

    // 프로젝트가 붙은 진단은 실제 프로젝트를 가리켜야 한다
    for x in s.diagnoses.iter().filter(|x| x.project.is_some()) {
        let p = x.project.as_deref().unwrap();
        assert!(
            s.projects.iter().any(|q| q.path == p),
            "[{}] 없는 프로젝트를 가리킨다: {}",
            x.rule,
            p.display()
        );
    }

    // 글로벌 설정 이야기는 어느 프로젝트를 보든 늘 해당된다 — 주인이 없어야 한다
    for rule in [
        "skill.never_called",
        "skill.unlinked",
        "mcp.denied",
        "mcp.permission_without_server",
        "mcp.server_without_permission",
    ] {
        for x in s.diagnoses.iter().filter(|x| x.rule == rule) {
            assert!(
                x.project.is_none(),
                "[{rule}] 글로벌 설정 이야기인데 프로젝트가 붙었다"
            );
        }
    }
}

/// 픽스처의 proj-a 에는 깨진 링크가 있다. 그 진단은 **proj-a 것**이어야 하고,
/// 글로벌 링크 진단과 섞이면 안 된다.
#[test]
fn a_projects_broken_link_is_reported_under_that_project() {
    let f = common::load();
    let s = scan(&f.home);
    let broken: Vec<&harnitor_core::Diagnosis> = s
        .diagnoses
        .iter()
        .filter(|x| x.rule == "link.broken")
        .collect();
    assert!(!broken.is_empty(), "깨진 링크 진단이 없다");

    // 글로벌 것과 프로젝트 것이 각각 자기 자리에 있다
    for x in &broken {
        for e in &x.evidence {
            match x.project.as_deref() {
                Some(p) => assert!(
                    e.starts_with(&p.display().to_string()),
                    "[{}] 프로젝트 진단인데 남의 경로가 섞였다: {e}",
                    x.rule
                ),
                None => assert!(
                    e.contains("/.claude/"),
                    "글로벌 진단인데 글로벌 경로가 아니다: {e}"
                ),
            }
        }
    }
}

/// `~/.claude/.mcp.json` 은 **아무도 읽지 않는다.** `.mcp.json` 은 프로젝트 스코프
/// 파일이라 프로젝트 폴더에 있을 때만 로드된다.
///
/// 실측(2026-08-28): 거기 7개가 선언돼 있었는데 세션에서 뜨는 건 `playwright` 뿐이었고,
/// 그것도 프로젝트 `.mcp.json` 에 따로 있어서였다. 나머지는 `/mcp` 에도 도구 목록에도 없었다.
/// **선언해 뒀다고 도는 게 아니다.**
#[test]
fn servers_declared_in_the_global_mcp_json_are_not_loaded() {
    let f = common::load();
    let s = scan(&f.home);

    let ctx = s
        .global
        .mcp
        .iter()
        .find(|m| m.name == "context7")
        .expect("context7 이 없다");
    assert_eq!(
        ctx.loaded,
        Loaded::Never,
        "아무도 안 읽는 자리인데 다르게 담았다"
    );

    // 사용자 스코프(`~/.claude.json`)에 있는 것은 실제로 로드된다
    let user = s
        .global
        .mcp
        .iter()
        .find(|m| m.name == "userserver")
        .expect("userserver 가 없다");
    assert_eq!(
        user.loaded,
        Loaded::Always,
        "사용자 스코프인데 로드 안 된다고 한다"
    );

    // 양쪽에 같은 이름이 있으면 읽히는 쪽이 이긴다
    let pw = s
        .global
        .mcp
        .iter()
        .find(|m| m.name == "playwright")
        .expect("playwright 가 없다");
    assert_eq!(
        pw.loaded,
        Loaded::Always,
        "읽히는 선언이 있는데 안 읽히는 쪽이 이겼다"
    );

    // 진단으로도 알려야 한다 — 사용자는 선언해 뒀으니 된 줄 안다
    let x = s
        .diagnoses
        .iter()
        .find(|x| x.rule == "mcp.declared_where_nobody_reads")
        .expect("아무도 안 읽는 선언을 진단하지 않는다");
    assert!(x.targets.contains(&"context7".to_string()));
    assert!(
        !x.targets.contains(&"playwright".to_string()),
        "다른 자리에 제대로 선언된 것까지 싸잡았다"
    );
}

/// 안 읽히는 선언은 **없는 것과 같다.** 그걸 부르는 스킬은 실제로 실패하므로
/// "선언돼 있으니 괜찮다"고 판정하면 안 된다.
#[test]
fn calling_an_unloaded_server_counts_as_missing() {
    let f = common::load();
    let s = scan(&f.home);
    let calls: Vec<&harnitor_core::Edge> = s.edges.iter().filter(|e| e.to == "context7").collect();
    for e in &calls {
        assert_eq!(
            e.kind,
            harnitor_core::EdgeKind::CallsMissingMcp,
            "안 읽히는 서버를 부르는데 성공할 호출로 셌다: {} → {}",
            e.from,
            e.to
        );
    }
}

/// 최근 활동 순으로 정렬하려면 마지막 커밋 시각이 필요하다.
/// **`git log` 를 부르지 않는다** — 브랜치 ref 파일의 mtime 이 커밋 시각과 같고,
/// 프로젝트가 27개면 프로세스를 27번 띄우는 것과 stat 27번은 다른 이야기다.
#[test]
fn a_git_project_carries_its_last_commit_time() {
    let f = common::load();
    let s = scan(&f.home);
    let git_ones: Vec<&harnitor_core::Project> = s.projects.iter().filter(|p| p.is_git).collect();
    assert!(!git_ones.is_empty(), "픽스처에 git 프로젝트가 없다");
    for p in &git_ones {
        assert!(
            p.last_commit.is_some(),
            "{} 는 git 인데 마지막 커밋 시각이 없다",
            p.name
        );
    }
    // git 이 아니면 없어야 한다 — 없는 값을 지어내면 정렬이 거짓말을 한다
    for p in s.projects.iter().filter(|p| !p.is_git) {
        assert!(
            p.last_commit.is_none(),
            "{} 는 git 이 아닌데 커밋 시각이 있다",
            p.name
        );
    }
}
