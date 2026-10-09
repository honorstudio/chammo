//! 진단 v2 명세 — 늘 실리는 양·헛경고·낡음·충돌·겹침·사용 기록.
//!
//! 공용 픽스처(`fixtures/home`)를 건드리지 않고 **테스트마다 하네스를 코드로 짓는다.**
//! 공용 픽스처에 줄 하나를 더하면 다른 테스트의 개수 단언이 줄줄이 흔들린다.
// 참모 사본: 픽스처가 심볼릭 링크를 유닉스로 만든다 — 윈도우에선 이 테스트 묶음을 뺀다(vendor/HARNITOR.md)
#![cfg(unix)]

use harnitor_core::{estimate_tokens, scan_with, BudgetKind, Scan, ScanOptions, Severity};
use std::fs;
use std::path::PathBuf;

/// 임시 홈에 하네스를 짓는 작은 도구.
struct H {
    _dir: tempfile::TempDir,
    home: PathBuf,
    projects: Vec<PathBuf>,
    extra: serde_json::Value,
}

impl H {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        // macOS 의 /var → /private/var 같은 링크를 풀어 둔다 — 경로 비교가 흔들리지 않게
        let home = dir.path().canonicalize().unwrap().join("home");
        fs::create_dir_all(home.join(".claude")).unwrap();
        let h = H {
            _dir: dir,
            home,
            projects: vec![],
            extra: serde_json::Value::Null,
        };
        h.save_registry();
        h
    }
    fn put(&self, rel: &str, text: &str) -> PathBuf {
        let p = self.home.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, text).unwrap();
        p
    }
    fn skill(&self, dir: &str, name: &str, desc: &str, body: &str) -> PathBuf {
        self.put(
            &format!("{dir}/{name}/SKILL.md"),
            &format!("---\nname: {name}\ndescription: {desc}\n---\n{body}"),
        )
    }
    /// 프로젝트 폴더를 만들고 `~/.claude.json` 에 등록한다.
    fn project(&mut self, rel: &str) -> PathBuf {
        let p = self.home.join(rel);
        fs::create_dir_all(&p).unwrap();
        self.projects.push(p.clone());
        self.save_registry();
        p
    }
    /// `~/.claude.json` 에 더할 것 — 사용자 MCP(`mcpServers`)나 프로젝트별 로컬 설정.
    /// 프로젝트 칸은 경로 열쇠로 덮어쓴다.
    fn claude_json(&mut self, extra: serde_json::Value) {
        self.extra = extra;
        self.save_registry();
    }
    fn save_registry(&self) {
        let mut v = serde_json::json!({ "projects": {} });
        for p in &self.projects {
            v["projects"][p.display().to_string()] = serde_json::json!({});
        }
        for (k, val) in self.extra.as_object().into_iter().flatten() {
            if k == "projects" {
                for (pk, pv) in val.as_object().unwrap() {
                    v["projects"][pk] = pv.clone();
                }
            } else {
                v[k] = val.clone();
            }
        }
        fs::write(self.home.join(".claude.json"), v.to_string()).unwrap();
    }
    fn scan(&self) -> Scan {
        scan_with(
            &self.home,
            &ScanOptions {
                lang: harnitor_core::i18n::Lang::Ko,
                ..Default::default()
            },
        )
    }
}

fn rules(s: &Scan) -> Vec<&str> {
    s.diagnoses.iter().map(|d| d.rule.as_str()).collect()
}

// ───────────────────────────── 1. 늘 실리는 양

/// 세션 하나가 시작할 때 **무조건** 읽는 것의 합. 층마다 따로 세고 합이 맞아야 한다.
#[test]
fn budget_counts_every_always_loaded_layer() {
    let mut h = H::new();
    let global_md = "# 전역\n규칙 하나.\n@~/.claude/extra.md\n";
    h.put(".claude/CLAUDE.md", global_md);
    h.put(".claude/extra.md", "가져온 규칙이 여기 있다.\n");
    h.skill(".claude/skills", "alpha", "알파를 열 때", "본문");
    h.put(
        ".claude/settings.json",
        r#"{"hooks":{"UserPromptSubmit":[{"matcher":"","hooks":[{"type":"command","command":"bash ~/.claude/hooks/nudge.sh"}]}]}}"#,
    );
    let p = h.project("dev/app");
    h.put("dev/app/CLAUDE.md", "# 앱\n앱 규칙.\n");
    h.put("dev/app/.claude/CLAUDE.md", "숨은 자리의 지침.\n");
    h.put(
        "dev/app/CLAUDE.local.md",
        "비밀번호: sk-FAKE-NEVER-READ-0000\n",
    );
    // 메모리 목록은 앞 200줄만 실린다
    let mem: String = (0..250).map(|i| format!("- 기억 {i}\n")).collect();
    let enc: String = p
        .display()
        .to_string()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    h.put(&format!(".claude/projects/{enc}/memory/MEMORY.md"), &mem);
    h.skill("dev/app/.claude/skills", "local", "로컬 스킬", "본문");

    let s = h.scan();
    let b = s
        .budgets
        .iter()
        .find(|b| b.project.as_deref() == Some(p.as_path()))
        .expect("프로젝트 몫의 예산이 없다");

    let has = |k: BudgetKind| b.parts.iter().any(|x| x.kind == k);
    assert!(has(BudgetKind::Instructions), "CLAUDE.md 층을 안 셌다");
    assert!(has(BudgetKind::Import), "@ 로 가져온 파일을 안 셌다");
    assert!(has(BudgetKind::Memory), "메모리 목록을 안 셌다");
    assert!(has(BudgetKind::SkillDescriptions), "스킬 설명을 안 셌다");
    assert_eq!(
        b.parts
            .iter()
            .filter(|x| x.kind == BudgetKind::Instructions)
            .count(),
        4,
        "전역·프로젝트·.claude/·local 넷이어야 한다: {:?}",
        b.parts
    );
    let sum: usize = b.parts.iter().map(|x| x.tokens).sum();
    assert_eq!(b.total_tokens, sum, "합계가 내역의 합과 다르다");
    assert!(
        b.parts.windows(2).all(|w| w[0].tokens >= w[1].tokens),
        "큰 순으로 정렬돼 있지 않다"
    );
    let memo = b
        .parts
        .iter()
        .find(|x| x.kind == BudgetKind::Memory)
        .unwrap();
    let first200: String = mem.lines().take(200).map(|l| format!("{l}\n")).collect();
    assert_eq!(memo.tokens, estimate_tokens(&first200), "200줄 넘게 셌다");
    assert_eq!(
        b.prompt_hooks,
        vec!["bash ~/.claude/hooks/nudge.sh".to_string()]
    );

    // local 은 크기로만 어림하고 **내용은 결과 어디에도 없다**
    let local = b
        .parts
        .iter()
        .find(|x| {
            x.path
                .as_ref()
                .is_some_and(|q| q.ends_with("CLAUDE.local.md"))
        })
        .unwrap();
    assert!(local.estimated_from_size);
    let json = serde_json::to_string(&s).unwrap();
    assert!(
        !json.contains("NEVER-READ"),
        "CLAUDE.local.md 내용이 새어 나갔다"
    );
}

/// 프로젝트가 같은 이름의 스킬을 가지면 전역 것은 가려져 실리지 않는다.
#[test]
fn budget_does_not_double_count_shadowed_skill() {
    let mut h = H::new();
    let long = "아주 긴 설명이다 ".repeat(20);
    h.skill(".claude/skills", "same", &long, "x");
    let p = h.project("dev/app");
    h.skill("dev/app/.claude/skills", "same", "짧다", "x");
    let s = h.scan();
    let b = s
        .budgets
        .iter()
        .find(|b| b.project.as_deref() == Some(p.as_path()))
        .unwrap();
    let skills: usize = b
        .parts
        .iter()
        .filter(|x| x.kind == BudgetKind::SkillDescriptions)
        .map(|x| x.tokens)
        .sum();
    assert_eq!(skills, estimate_tokens("짧다"), "가려진 전역 스킬까지 셌다");
}

/// 긴 섹션은 "부를 때만 읽혀도 되는 후보"로 짚는다 — 어느 파일 몇 번째 줄인지와 함께.
#[test]
fn budget_points_at_long_sections() {
    let h = H::new();
    let long = "이 절차는 길다 ".repeat(120);
    h.put(
        ".claude/CLAUDE.md",
        &format!("# 전역\n짧은 규칙.\n\n## 긴 절차\n{long}\n\n## 짧은 것\n한 줄.\n"),
    );
    let s = h.scan();
    let b = s.budgets.iter().find(|b| b.project.is_none()).unwrap();
    let hint = b.hints.first().expect("긴 섹션을 못 짚었다");
    assert_eq!(hint.heading, "긴 절차");
    assert_eq!(hint.line, 4);
    assert!(b.hints.iter().all(|x| x.heading != "짧은 것"));
}

// ───────────────────────────── 2. 헛경고 줄이기

/// 다른 프로젝트의 `.mcp.json` 에만 있는 서버를 부르면 **실패가 아니라 "그 프로젝트에서만"** 이다.
#[test]
fn server_declared_in_some_project_is_a_note_not_a_problem() {
    let mut h = H::new();
    h.skill(
        ".claude/skills",
        "caller",
        "부른다",
        "도구 `mcp__projonly__run` 을 부른다.",
    );
    h.project("dev/app");
    h.put(
        "dev/app/.mcp.json",
        r#"{"mcpServers":{"projonly":{"command":"x"}}}"#,
    );
    let s = h.scan();
    let r = rules(&s);
    assert!(r.contains(&"mcp.scoped_server_called"), "{r:?}");
    assert!(
        !r.contains(&"mcp.missing_server_called"),
        "헛경고가 남았다: {r:?}"
    );
    let d = s
        .diagnoses
        .iter()
        .find(|d| d.rule == "mcp.scoped_server_called")
        .unwrap();
    assert_eq!(d.severity, Severity::Note);
}

/// 로컬 스코프(`~/.claude.json` 의 `projects[경로].mcpServers`)도 선언 자리다.
#[test]
fn local_scope_server_is_found_too() {
    let mut h = H::new();
    h.skill(".claude/skills", "caller", "부른다", "`mcp__localsrv__go`");
    let p = h.project("dev/app");
    h.claude_json(serde_json::json!({ "projects": {
        p.display().to_string(): { "mcpServers": { "localsrv": { "command": "x" } } }
    }}));
    let r = rules(&h.scan()).join(",");
    assert!(
        r.contains("mcp.scoped_server_called") && !r.contains("missing_server"),
        "{r}"
    );
}

/// claude.ai 커넥터와 켜진 플러그인의 MCP 는 어디서나 뜬다 — 진단거리가 아니다.
#[test]
fn connectors_and_plugin_servers_are_declared() {
    let h = H::new();
    h.skill(
        ".claude/skills",
        "mailer",
        "보낸다",
        "`mcp__claude_ai_Gmail__create_draft` 와 `mcp__plugin_vend_srv__ping`",
    );
    let install = h.home.join(".claude/plugins/cache/vend");
    h.put(
        ".claude/plugins/cache/vend/.mcp.json",
        r#"{"mcpServers":{"srv":{"command":"x"}}}"#,
    );
    h.put(
        ".claude/plugins/installed_plugins.json",
        &serde_json::json!({
            "plugins": { "vend@market": [ { "installPath": install.display().to_string() } ] }
        })
        .to_string(),
    );
    h.put(
        ".claude/settings.json",
        r#"{"enabledPlugins":{"vend@market":true}}"#,
    );
    let s = h.scan();
    let mcp: Vec<_> = s
        .diagnoses
        .iter()
        .filter(|d| d.rule.starts_with("mcp."))
        .map(|d| d.rule.clone())
        .collect();
    assert!(mcp.is_empty(), "커넥터·플러그인 MCP 를 경고했다: {mcp:?}");
}

/// 코드 블록·표 안에만 나오는 이름은 예시일 가능성이 크다 — 빨갛게 띄우지 않는다.
#[test]
fn names_only_in_code_blocks_or_tables_are_examples() {
    let h = H::new();
    h.skill(".claude/skills", "manage-mcp", "MCP 관리", 
        "예시:\n```\nmcp__xxx__do\n```\n\n| 서버 | 도구 |\n|---|---|\n| stripe | mcp__stripe__pay |\n");
    let s = h.scan();
    let r = rules(&s);
    assert!(
        !r.contains(&"mcp.missing_server_called"),
        "예시를 실패로 셌다: {r:?}"
    );
    let d = s
        .diagnoses
        .iter()
        .find(|d| d.rule == "mcp.example_only")
        .expect("예시로도 안 남겼다");
    assert_eq!(d.severity, Severity::Note);
    assert_eq!(d.evidence.len(), 2);
}

/// 지킴이 — 본문에서 진짜로 부르는데 어디에도 없으면 여전히 문제다.
#[test]
fn prose_call_to_nowhere_is_still_a_problem() {
    let h = H::new();
    h.skill(
        ".claude/skills",
        "caller",
        "부른다",
        "이 도구를 부른다: mcp__ghost__run",
    );
    assert!(rules(&h.scan()).contains(&"mcp.missing_server_called"));
}

// ───────────────────────────── 3. 낡음

fn diag<'a>(s: &'a Scan, rule: &str) -> Option<&'a harnitor_core::Diagnosis> {
    s.diagnoses.iter().find(|d| d.rule == rule)
}

/// 늘 읽히는 칸이 없는 파일을 가리키면 문제다 — 어느 줄인지와 함께.
#[test]
fn always_on_doc_pointing_at_missing_path_is_a_problem() {
    let mut h = H::new();
    let p = h.project("dev/app");
    h.put("dev/app/docs/here.md", "있다");
    h.put(
        "dev/app/CLAUDE.md",
        "# 앱\n먼저 `docs/here.md` 를 읽는다.\n그다음 `docs/gone.md` 를 본다.\n",
    );
    let s = h.scan();
    let d = diag(&s, "stale.always_on").expect("낡은 경로를 못 잡았다");
    assert_eq!(d.severity, Severity::Problem);
    assert_eq!(d.project.as_deref(), Some(p.as_path()));
    assert_eq!(d.evidence.len(), 1, "{:?}", d.evidence);
    assert!(d.evidence[0].contains("CLAUDE.md:3") && d.evidence[0].contains("docs/gone.md"));
}

/// 스킬이 옮겨진 파일을 가리키면 비용(부를 때만 해롭다). 하위 폴더 기준으로 적은 경로는
/// 프로젝트 안 어딘가에 그 꼬리로 있으면 산 것으로 본다.
#[test]
fn skill_pointing_at_moved_file_is_a_cost() {
    let mut h = H::new();
    h.project("dev/app");
    h.put("dev/app/app/terms.tsx", "x");
    h.put("dev/app/app/(tabs)/home.tsx", "x");
    h.skill(
        "dev/app/.claude/skills",
        "verify-legal",
        "약관 점검",
        "약관은 `profile/terms.tsx` 에 있다. 홈은 `(tabs)/home.tsx`.\n",
    );
    let s = h.scan();
    let d = diag(&s, "stale.skill").expect("옮겨진 파일을 못 잡았다");
    assert_eq!(d.severity, Severity::Cost);
    assert_eq!(d.evidence.len(), 1, "{:?}", d.evidence);
    assert!(d.evidence[0].contains("profile/terms.tsx"));
    assert_eq!(d.targets, vec!["verify-legal".to_string()]);
}

/// 전역 지침은 `~/` 와 절대 경로만 본다 — 상대 경로는 어느 프로젝트 기준인지 모른다.
#[test]
fn global_doc_checks_home_paths_only() {
    let h = H::new();
    h.put(".claude/hooks/real.sh", "echo");
    h.put(
        ".claude/CLAUDE.md",
        "훅 `~/.claude/hooks/real.sh` 와 `~/.claude/hooks/nope.sh`.\n계획은 `docs/plans/` 에.\n",
    );
    let s = h.scan();
    let d = diag(&s, "stale.always_on").expect("~/ 경로를 못 잡았다");
    assert_eq!(d.project, None);
    assert_eq!(d.evidence.len(), 1, "{:?}", d.evidence);
    assert!(d.evidence[0].contains("nope.sh"));
}

/// 자리표시자·글롭·코드 블록 안은 경로 주장이 아니다.
#[test]
fn placeholders_globs_and_code_blocks_are_not_claims() {
    let mut h = H::new();
    h.project("dev/app");
    h.put("dev/app/CLAUDE.md",
        "`src/<name>.ts` · `src/*.ts` · `src/{a,b}.ts` · `~/.claude/projects/<경로>/memory`\n```\ncat src/missing.ts\n`src/also-missing.ts`\n```\n");
    let s = h.scan();
    assert!(diag(&s, "stale.always_on").is_none(), "{:?}", s.diagnoses);
}

/// 전역 스킬은 자기 폴더 안(`references/`·`scripts/`)을 가리킬 때만 본다.
#[test]
fn global_skill_checks_its_own_folder() {
    let h = H::new();
    h.put(".claude/skills/kb/scripts/run.py", "x");
    h.skill(".claude/skills", "kb", "지식",
        "`scripts/run.py` 를 돌리고 `references/gone.md` 를 읽는다. 프로젝트의 `docs/decisions/` 에 남긴다.\n");
    let s = h.scan();
    let d = diag(&s, "stale.skill").expect("스킬 폴더 안 낡은 경로를 못 잡았다");
    assert_eq!(d.evidence.len(), 1, "{:?}", d.evidence);
    assert!(d.evidence[0].contains("references/gone.md"));
}

/// 실제 하네스에서 나온 오탐 모음 — 하나라도 잡히면 진단을 못 믿게 된다.
#[test]
fn real_world_false_positives_stay_quiet() {
    let mut h = H::new();
    h.put(".claude/skills/other/scripts/law.sh", "x");
    h.skill(".claude/skills", "other", "다른 스킬", "x");
    let p = h.project("dev/app");
    h.put("dev/app/docs/decisions/0001-first.md", "x");
    h.put("dev/app/tests/scan.rs", "x");
    h.put("dev/app/components/ui/button.tsx", "x");
    h.put("dev/sibling/CLAUDE.md", "x");
    let _ = p;
    h.put(
        "dev/app/CLAUDE.md",
        &[
            "줄번호가 여럿: `tests/scan.rs:26,93`",       // 줄번호 꼬리
            "다른 기계: `~/apps/prod` 와 `~/w-remote/x`", // 이 맥에 없는 홈 최상위
            "별칭: `~/components/ui/button`",             // TS 경로 별칭
            "예시: `logs/YYYY-MM-DD.md` · `pages/foo.tsx` · `games/xxx-3h/` · `p/group_00~29.md`",
            "ADR: `docs/decisions/0001`",                  // 접두어
            "다른 스킬: `other` 스킬의 `scripts/law.sh`",  // 같은 줄에 이름이 나온 스킬
            "개념: `references/` 를 쌓는다",               // 한 마디짜리 폴더 이름
            "옆 프로젝트: `sibling/CLAUDE.md`",            // 형제 폴더
            "괄호: `~/bin/tool(-mcp`, `~/bin/tool(-mcp)`", // 선택 꼬리 표기
            "산출물: `logs/worker.log` · `assets/node_modules`", // 돌려야 생기는 것
        ]
        .join("\n"),
    );
    // 전역 쪽 — 스킬 이름으로 시작하는 경로·줄임 표기·그 스킬이 다루는 프로젝트 이야기
    h.put(".claude/skills/other/references/a.md", "x");
    h.put(
        ".claude/CLAUDE.md",
        &[
            "`other` 의 `other/references/a.md`",
            "`other` 스킬 `other/a` 참고",
            "`other` 스킬이 프로젝트의 `docs/decisions/` 에 쓴다",
        ]
        .join("\n"),
    );
    h.skill(
        ".claude/skills",
        "self-ref",
        "자기",
        "`self-ref` 는 `.github/workflows/` 를 만든다\n",
    );
    let s = h.scan();
    let ev: Vec<_> = s
        .diagnoses
        .iter()
        .filter(|d| d.rule.starts_with("stale."))
        .flat_map(|d| d.evidence.clone())
        .collect();
    assert!(ev.is_empty(), "오탐: {ev:#?}");
}

/// 진단 v2 남은 헛경고(2026-10-02) — 다른 기계 경로·돌려야 생기는 파일·예시 이름·다른 저장소 경로·"없는 게 정상"인 자리.
/// 같은 파일의 진짜 낡은 경로는 그대로 잡혀야 한다.
#[test]
fn v2_false_positives_stay_quiet_but_real_ones_stay() {
    let mut h = H::new();
    h.project("dev/app");
    h.project("dev/shopapp");
    h.put("dev/shopapp/src/di/container.ts", "x");
    h.project("dev/third"); // devRoot 처럼 프로젝트가 셋 이상 든 폴더만 저장소 자리
    h.project("Desktop/solo"); // 하나뿐 — `~/Desktop/…` 는 저장소가 아니다
    h.put("vol/로그/x", "x");
    h.project("vol/a");
    h.project("vol/b");
    h.project("vol/c"); // 한글 폴더 이름은 저장소 이름이 아니다(줄의 '로그' 낱말)
    h.put(
        "dev/app/CLAUDE.md",
        &[
            "다른 기계: 설정은 `~/Library/LaunchAgents/disabled/` 로, 앱은 `~/Applications/Shot.app`",
            "생기는 것: 오래된 메모를 `docs/starter-archive.md`로 이관",
            "생기는 것: 결과는 `out/report.md` 에 저장한다",
            "이름 바꾸기: `assets/node_modules` → `assets/modules`",
            "예: `news/병원/2026-06-08_주제.md`",
            "다른 저장소: SHOPAPP의 `di/container.ts` 와 ACME `docs/audits/a.md` (원본 `~/Desktop/dev/acme`)",
            "없앤 자리: `docs/plans/` 는 폐지됐다 — 다시 만들지 말 것",
            "없는 게 정상: `CLAUDE.local.md` 처럼 `docs/local.md` 가 없으면 만든다",
            "규약 자리: 사용자 에이전트는 `~/.claude/agents/`",
            "진짜 낡음: `docs/gone.md` 를 읽는다",
            // 실측(사용자 맥): 긴 줄 먼 곳의 '없으면', 한글 폴더 이름(로그)이 진짜를 지웠다 · 프로젝트 하나뿐인 폴더(Desktop)는 저장소 자리가 아니다
            "진짜 낡음 둘: 보안은 `docs/gone2.md` 가이드를 따른다 — 아주 긴 설명이 이어지고 또 이어져서 한참 뒤에야 나오는 말, 스테이징 키가 없으면 우회가 걸린다",
            "진짜 낡음 셋: 키는 평문이다(실측: `docs/gone3.md`에 키). 로그·에러리포트에도 남기지 않는다",
            "진짜 낡음 넷: `~/Desktop/gone4.pdf`",
        ]
        .join("\n"),
    );
    h.skill(
        "dev/app/.claude/skills",
        "design-engineer",
        "디자인",
        "If yes, write to `.design-engineer/system.md`.\nRead `.design-engineer/system.md` and apply.\n",
    );
    let s = h.scan();
    let ev: Vec<_> = s
        .diagnoses
        .iter()
        .filter(|d| d.rule.starts_with("stale."))
        .flat_map(|d| d.evidence.clone())
        .collect();
    let mut got: Vec<&str> = ev.iter().map(|e| e.rsplit(" → ").next().unwrap()).collect();
    got.sort();
    assert_eq!(got, vec!["docs/gone.md", "docs/gone2.md", "docs/gone3.md", "~/Desktop/gone4.pdf"], "헛경고·놓친 것: {ev:#?}");
}

// ───────────────────────────── 4. 충돌

const GLOBAL_BANS: &str = "# 전역\n\
- UI 에 아이콘 라이브러리(lucide-react 등) 금지. `from \"lucide-react\"` 가 보이면 자기검열\n\
- 환경변수는 대시보드에서만. CLI(`vercel env add`) 금지\n\
- 버튼은 텍스트만(\"저장\", \"취소\") — 이모지 금지\n\
- 비밀은 `{project}/CLAUDE.local.md` 에 둔다 — 커밋되는 파일엔 절대 금지\n";

/// 전역이 금지한 것을 프로젝트 스킬이 쓰라고 하면 충돌 의심이다.
#[test]
fn project_skill_using_globally_banned_thing_conflicts() {
    let mut h = H::new();
    h.put(".claude/CLAUDE.md", GLOBAL_BANS);
    let p = h.project("dev/app");
    h.skill(
        "dev/app/.claude/skills",
        "verify-consistency",
        "일관성",
        "추가 버튼엔 lucide Plus 아이콘을 사용한다.\n",
    );
    let s = h.scan();
    let d = diag(&s, "conflict.global_ban").expect("충돌을 못 잡았다");
    assert_eq!(d.severity, Severity::Problem);
    assert_eq!(d.project.as_deref(), Some(p.as_path()));
    assert!(
        d.evidence[0].contains("lucide") && d.evidence[0].contains("SKILL.md:5"),
        "{:?}",
        d.evidence
    );
    assert_eq!(d.targets, vec!["verify-consistency".to_string()]);
}

/// 같은 금지를 되풀이하는 줄은 충돌이 아니라 동의다.
#[test]
fn repeating_the_ban_is_not_a_conflict() {
    let mut h = H::new();
    h.put(".claude/CLAUDE.md", GLOBAL_BANS);
    h.project("dev/app");
    h.put("dev/app/CLAUDE.md", "`lucide-react` 는 쓰지 않는다.\n");
    let s = h.scan();
    assert!(
        !rules(&s).iter().any(|r| r.starts_with("conflict.")),
        "{:?}",
        rules(&s)
    );
}

/// 쓰라는 말 없이 이름만 나오면 옅게(Note) — 낱말 맞추기라 오탐이 섞인다.
#[test]
fn bare_mention_is_only_a_note() {
    let h = H::new();
    h.put(".claude/CLAUDE.md", GLOBAL_BANS);
    h.skill(
        ".claude/skills",
        "deploy",
        "배포",
        "```\nvercel env add KEY production\n```\n",
    );
    let s = h.scan();
    assert!(diag(&s, "conflict.global_ban").is_none());
    let d = diag(&s, "conflict.global_ban_mention").expect("언급도 안 남겼다");
    assert_eq!(d.severity, Severity::Note);
}

/// 금지 줄 안의 한국어 따옴표(허용 예시 "저장")·자리표시자 경로는 금지어가 아니다.
#[test]
fn korean_quotes_and_placeholders_are_not_banned_terms() {
    let mut h = H::new();
    h.put(".claude/CLAUDE.md", GLOBAL_BANS);
    h.project("dev/app");
    h.put(
        "dev/app/CLAUDE.md",
        "저장 버튼을 사용한다.\n계정은 CLAUDE.local.md 에 넣는다.\n",
    );
    let s = h.scan();
    assert!(
        !rules(&s).iter().any(|r| r.starts_with("conflict.")),
        "{:?}",
        s.diagnoses
    );
}

/// 금지 줄 끝의 "— `x` 스킬" 같은 포인터·다른 절의 낱말은 금지어가 아니다(실제 하네스 오탐).
#[test]
fn pointers_and_other_clauses_are_not_banned() {
    let h = H::new();
    h.put(
        ".claude/CLAUDE.md",
        "- 로그인 `IP보안` 절대 켜지 않는다 — 아이디만 친다 — `browser-kit` 스킬\n\
         - 팀이면 `Agent` 로 여럿 띄운다. 하나로 대충 하지 않는다\n",
    );
    h.skill(
        ".claude/skills",
        "browser-kit",
        "브라우저",
        "`browser-kit` 를 사용한다.\n",
    );
    h.skill(".claude/skills", "team", "팀", "`Agent` 도구를 사용한다.\n");
    let s = h.scan();
    let c: Vec<_> = s
        .diagnoses
        .iter()
        .filter(|d| d.rule.starts_with("conflict"))
        .collect();
    assert!(c.is_empty(), "{c:?}");
}

// ───────────────────────────── 5. 겹침

const RULE: &str = "커밋은 한 가지 이유로 되돌릴 수 있는 단위로 쪼개고 삼백 줄을 넘기지 않는다";

/// 같은 규칙이 전역과 프로젝트 CLAUDE.md 양쪽에 있으면 두 번 실리고, 언젠가 하나만 고쳐진다.
#[test]
fn same_rule_in_two_instruction_layers_is_a_cost() {
    let mut h = H::new();
    h.put(
        ".claude/CLAUDE.md",
        &format!("# 전역\n- {RULE}.\n짧은 줄\n"),
    );
    let p = h.project("dev/app");
    // 공백·기호만 다르다
    h.put(
        "dev/app/CLAUDE.md",
        &format!("# 앱\n\n**{}**!\n짧은 줄\n", RULE.replace(' ', "  ")),
    );
    let s = h.scan();
    let d = diag(&s, "dup.instructions").expect("겹침을 못 잡았다");
    assert_eq!(d.severity, Severity::Cost);
    assert_eq!(d.project.as_deref(), Some(p.as_path()));
    assert_eq!(d.evidence.len(), 1, "짧은 줄까지 셌다: {:?}", d.evidence);
    assert!(d.evidence[0].contains("CLAUDE.md:2") && d.evidence[0].contains("CLAUDE.md:3"));
}

/// 80% 넘게 같으면 겹침이다 — 한 낱말 고친 사본.
#[test]
fn near_duplicate_counts() {
    let mut h = H::new();
    h.put(".claude/CLAUDE.md", &format!("{RULE}\n"));
    h.project("dev/app");
    h.put(
        "dev/app/CLAUDE.md",
        &format!("{}\n", RULE.replace("삼백", "사백")),
    );
    assert!(diag(&h.scan(), "dup.instructions").is_some());
}

/// 메모리 파일이 CLAUDE.md 와 같은 말을 하면 규칙으로 올라간 것 — 메모리는 지울 차례다.
#[test]
fn memory_repeating_instructions_is_a_cost() {
    let mut h = H::new();
    let p = h.project("dev/app");
    h.put("dev/app/CLAUDE.md", &format!("{RULE}\n"));
    let enc: String = p
        .display()
        .to_string()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    h.put(
        &format!(".claude/projects/{enc}/memory/commit-size.md"),
        &format!("---\nname: commit-size\n---\n{RULE}\n"),
    );
    let s = h.scan();
    let d = diag(&s, "dup.memory").expect("메모리 겹침을 못 잡았다");
    assert!(
        d.evidence[0].contains("commit-size.md:4"),
        "{:?}",
        d.evidence
    );
}

/// 전역과 프로젝트에 같은 이름의 스킬 — 동기화 스크립트가 있으면 일부러 복사한 사본(Note).
#[test]
fn same_name_skill_is_a_cost_unless_synced() {
    let mut h = H::new();
    h.skill(".claude/skills", "ad-check", "광고 점검", "본문 같다\n");
    h.project("dev/app");
    h.skill(
        "dev/app/.claude/skills",
        "ad-check",
        "광고 점검",
        "본문 같다\n",
    );
    let s = h.scan();
    let d = diag(&s, "dup.skill").expect("같은 이름 스킬을 못 잡았다");
    assert_eq!(d.severity, Severity::Cost);
    assert_eq!(d.targets, vec!["ad-check".to_string()]);

    h.put(
        "dev/app/scripts/sync-skills.sh",
        "rsync -a ~/.claude/skills/ad-check/ .claude/skills/ad-check/\n",
    );
    let s = h.scan();
    assert!(diag(&s, "dup.skill").is_none());
    let d = diag(&s, "dup.skill_synced").expect("동기화 사본으로 안 봤다");
    assert_eq!(d.severity, Severity::Note);
}

/// 겹친 줄의 **내용은 근거에 싣지 않는다** — 메모리·지침엔 키가 평문으로 있다(원칙 2).
/// 실측: 미리보기 40자에 REST API 키 앞부분이 그대로 찍혔다.
#[test]
fn overlap_evidence_never_carries_line_content() {
    let mut h = H::new();
    let line = "카카오 REST API 키는 sk-FAKE-0123456789abcdef0123 이다 잊지 말 것";
    h.put(".claude/CLAUDE.md", &format!("{line}\n"));
    h.project("dev/app");
    h.put("dev/app/CLAUDE.md", &format!("{line}\n"));
    let s = h.scan();
    let d = diag(&s, "dup.instructions").expect("겹침을 못 잡았다");
    let json = serde_json::to_string(&s).unwrap();
    assert!(
        !json.contains("0123456789abcdef"),
        "키가 새어 나갔다: {:?}",
        d.evidence
    );
}

// ───────────────────────────── 6. 사용 기록 30일 너머

/// 스킬 호출 한 줄(대화 기록 jsonl 꼴).
fn call(skill: &str, ts: &str) -> String {
    format!(
        r#"{{"type":"assistant","timestamp":"{ts}","message":{{"content":[{{"type":"tool_use","name":"Skill","input":{{"skill":"{skill}"}}}}]}}}}"#
    )
}

fn scan_recording(h: &H, history: &std::path::Path) -> Scan {
    scan_with(
        &h.home,
        &ScanOptions {
            lang: harnitor_core::i18n::Lang::Ko,
            usage_history: Some(history.to_path_buf()),
            ..Default::default()
        },
    )
}

/// 대화 기록은 30일이면 지워진다. 누적해 두면 지워진 뒤에도 "썼다"가 남는다.
#[test]
fn usage_survives_log_deletion() {
    let h = H::new();
    h.skill(".claude/skills", "alpha", "알파", "x");
    h.skill(".claude/skills", "beta", "베타", "x");
    let hist = h.home.join(".claude/.harnitor/usage-history.json");
    let old = h.put(
        ".claude/projects/-p/old.jsonl",
        &format!(
            "{}\n{}\n",
            call("alpha", "2026-08-01T00:00:00Z"),
            call("alpha", "2026-08-02T00:00:00Z")
        ),
    );
    let s = scan_recording(&h, &hist);
    assert!(hist.is_file(), "기록을 남기지 않았다");
    assert_eq!(s.usage_since.as_deref(), Some("2026-08-01"));

    // 30일이 지나 옛 기록이 지워지고 새 기록만 남았다
    fs::remove_file(old).unwrap();
    h.put(
        ".claude/projects/-p/new.jsonl",
        &format!("{}\n", call("beta", "2026-09-20T00:00:00Z")),
    );
    let s = scan_recording(&h, &hist);
    let alpha = s
        .usage
        .iter()
        .find(|u| u.skill == "alpha")
        .expect("지워진 기록을 잊었다");
    assert_eq!(alpha.count, 2);
    assert_eq!(alpha.last_used.as_deref(), Some("2026-08-02T00:00:00Z"));
    assert!(s.usage.iter().any(|u| u.skill == "beta"));
    assert_eq!(
        s.usage_since.as_deref(),
        Some("2026-08-01"),
        "기록 시작일이 밀렸다"
    );
    assert!(
        !s.diagnoses.iter().any(|d| d.rule == "skill.never_called"),
        "누적된 호출을 무시했다: {:?}",
        s.diagnoses
            .iter()
            .find(|d| d.rule == "skill.never_called")
            .map(|d| &d.evidence)
    );
}

/// 기록 자리를 주지 않으면 아무것도 쓰지 않는다 — 라이브러리 기본은 읽기만이다.
#[test]
fn library_default_writes_nothing() {
    let h = H::new();
    h.skill(".claude/skills", "alpha", "알파", "x");
    h.put(
        ".claude/projects/-p/a.jsonl",
        &format!("{}\n", call("alpha", "2026-08-01T00:00:00Z")),
    );
    h.scan();
    assert!(!h.home.join(".claude/.harnitor").exists());
}

/// "0회"는 "기록 시작 이후 0회"다 — 진단이 그 날짜를 말해야 한다.
#[test]
fn never_called_says_since_when() {
    let h = H::new();
    h.skill(".claude/skills", "alpha", "알파", "x");
    h.skill(".claude/skills", "idle", "놀고 있다", "x");
    h.put(
        ".claude/projects/-p/a.jsonl",
        &format!("{}\n", call("alpha", "2026-08-01T09:00:00Z")),
    );
    let s = scan_recording(&h, &h.home.join("hist.json"));
    let d = diag(&s, "skill.never_called").unwrap();
    assert!(d.title.contains("2026-08-01"), "{}", d.title);
}

// ───────────────────────────── 7. 글 보고

/// 오케스트레이터가 읽는 글 — 맨 위 늘 실리는 양, 그다음 Problem → Cost → Note, 각자 고치는 길.
#[test]
fn harness_report_reads_top_down() {
    let mut h = H::new();
    h.put(
        ".claude/CLAUDE.md",
        &format!("# 전역\n{}\n", "규칙 ".repeat(50)),
    );
    h.skill(".claude/skills", "idle", "놀고 있다", "x");
    let p = h.project("dev/app");
    h.put("dev/app/CLAUDE.md", "`docs/gone.md` 를 읽는다\n");
    let q = h.project("dev/other");
    h.put("dev/other/CLAUDE.md", "`docs/other-gone.md` 를 읽는다\n");
    let _ = q;
    let s = h.scan();
    let text =
        harnitor_core::report::harness_text(&s, Some(p.as_path()), harnitor_core::i18n::Lang::Ko);

    let first = text.lines().next().unwrap();
    assert!(
        first.starts_with("늘 실리는 양"),
        "맨 위가 예산이 아니다: {first}"
    );
    assert!(first.contains("토큰"));
    assert!(text.contains("docs/gone.md"));
    assert!(!text.contains("other-gone"), "다른 프로젝트 진단이 섞였다");
    let problem = text.find("[문제]").expect("문제 칸이 없다");
    let cost = text.find("[비용]").expect("비용 칸이 없다");
    assert!(problem < cost, "Problem 이 Cost 보다 뒤에 있다");
    assert!(text.contains("고치는 길:"), "고치는 길이 없다");
}

/// 근거는 다섯까지, 나머지는 개수로 접는다.
#[test]
fn harness_report_caps_evidence_at_five() {
    let mut h = H::new();
    let p = h.project("dev/app");
    let lines: String = (0..8).map(|i| format!("`docs/gone-{i}.md`\n")).collect();
    h.put("dev/app/CLAUDE.md", &lines);
    let s = h.scan();
    let text =
        harnitor_core::report::harness_text(&s, Some(p.as_path()), harnitor_core::i18n::Lang::Ko);
    assert_eq!(text.matches("docs/gone-").count(), 5, "{text}");
    assert!(text.contains("외 3건"));
}

/// 진단마다 고치는 길이 붙는다 — 화면과 글이 같은 판정을 쓴다.
#[test]
fn every_diagnosis_has_a_fix_path() {
    let mut h = H::new();
    let p = h.project("dev/app");
    h.put("dev/app/CLAUDE.md", "`docs/gone.md`\n");
    let _ = p;
    let s = h.scan();
    let d = diag(&s, "stale.always_on").unwrap();
    assert_eq!(d.fix, harnitor_core::FixPath::EditFile);
}

/// 권한 패턴이 도구마다 따로 있어도 서버 하나다. 그리고 프로젝트에 선언된 서버의 권한은
/// "서버가 없다"가 아니다(실제 하네스: `playwright` 가 다섯 번 세였다).
#[test]
fn permission_rule_counts_servers_once_and_sees_projects() {
    let mut h = H::new();
    h.put(
        ".claude/settings.json",
        r#"{"permissions":{"allow":["mcp__projsrv__a","mcp__projsrv__b","mcp__ghost__a","mcp__ghost__b"]}}"#,
    );
    h.project("dev/app");
    h.put(
        "dev/app/.mcp.json",
        r#"{"mcpServers":{"projsrv":{"command":"x"}}}"#,
    );
    let s = h.scan();
    let d = diag(&s, "mcp.permission_without_server").expect("유령 권한을 놓쳤다");
    assert_eq!(d.evidence, vec!["ghost".to_string()]);
}

/// "그 프로젝트에서만" 근거에 프로젝트가 수십 개면 셋만 적고 개수로 접는다.
#[test]
fn scoped_server_evidence_folds_long_place_lists() {
    let mut h = H::new();
    h.skill(
        ".claude/skills",
        "caller",
        "부른다",
        "`mcp__wide__run` 을 부른다",
    );
    for i in 0..6 {
        h.project(&format!("dev/p{i}"));
        h.put(
            &format!("dev/p{i}/.mcp.json"),
            r#"{"mcpServers":{"wide":{"command":"x"}}}"#,
        );
    }
    let s = h.scan();
    let d = diag(&s, "mcp.scoped_server_called").unwrap();
    assert!(d.evidence[0].contains("외 3곳"), "{:?}", d.evidence);
}
