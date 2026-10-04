//! Claude Code 하네스 스캐너.
//!
//! 설계 규칙은 프로젝트 `CLAUDE.md`에 있다. 특히:
//! - 정규식으로 설정을 읽지 않는다 (멀티라인 YAML을 놓친다)
//! - 홈 디렉토리는 프로젝트가 아니다
//! - `SKILL.md` 없는 폴더는 스킬이 아니라 지식이다
//! - 부분 실패로 전체가 죽지 않는다

pub mod ai;
pub mod blueprint;
pub mod budget;
pub mod conflict;
pub mod diagnose;
pub mod edges;
pub mod i18n;
pub mod md;
pub mod model;
pub mod overlap;
pub mod parse;
pub mod report;
pub mod secret;
pub mod session;
pub mod stack;
pub mod stale;
pub mod tree;
pub mod usage;
pub mod write;

pub use model::*;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// 스캔 도중 모은 읽기 실패. 실패는 버리지 않고 결과에 담는다.
#[derive(Default)]
struct Failures {
    list: Vec<Failure>,
    lang: crate::i18n::Lang,
}

impl Failures {
    fn new(lang: crate::i18n::Lang) -> Self {
        Self { list: vec![], lang }
    }

    /// 실패 한 건을 담는다. **종류와 원문을 함께** 남기고, 읽는 문장은 여기서 만든다.
    fn note(&mut self, path: &Path, kind: FailureKind, detail: impl Into<String>) {
        let detail = detail.into();
        self.list.push(Failure {
            path: path.to_path_buf(),
            reason: say(self.lang, kind, &detail),
            kind,
            detail,
        });
    }

    /// 실패를 기록하고 `None`을 돌려준다 — 호출부가 그냥 넘어갈 수 있게.
    fn ok<T>(&mut self, path: &Path, kind: FailureKind, r: parse::Parsed<T>) -> Option<T> {
        match r {
            Ok(v) => Some(v),
            Err(e) => {
                self.note(path, kind, e);
                None
            }
        }
    }
}

/// 실패 한 건을 사람이 읽는 한 줄로. 원문(`detail`)은 그대로 덧붙인다.
fn say(lang: crate::i18n::Lang, kind: FailureKind, detail: &str) -> String {
    use crate::i18n::pick;
    use FailureKind as K;
    match kind {
        K::Unreadable => pick(lang, &format!("읽을 수 없다: {detail}"), &format!("cannot read: {detail}")),
        K::BadJson => pick(lang, &format!("JSON이 깨졌다: {detail}"), &format!("broken JSON: {detail}")),
        K::LooseFrontmatter => pick(lang,
            &format!("frontmatter가 YAML 규격을 벗어났다({detail}) — 관대하게 읽었지만 다른 도구에서는 깨질 수 있다"),
            &format!("frontmatter is not strict YAML ({detail}) — read leniently here, but another tool may reject it")),
        K::NoFrontmatter => pick(lang,
            "frontmatter가 없다 — name·description이 없으면 자동 발동이 안 된다",
            "no frontmatter — without name and description it never triggers on its own"),
        K::EmptyDir => pick(lang,
            "SKILL.md도 references/도 없다 — 빈 스킬 폴더",
            "neither SKILL.md nor references/ — an empty skill folder"),
    }
}

/// 하네스 전체를 스캔한다.
///
/// `home`을 인자로 받는 이유는 **테스트 가능성** 때문이다.
/// `~`를 내부에서 확정하면 픽스처로 검증할 수 없고, 실제 `~/.claude`에 의존하는
/// 테스트는 머신마다 결과가 달라져 쓸 수 없다.
pub fn scan(home: &Path) -> Scan {
    scan_with(home, &ScanOptions::default())
}

/// 옵션을 주어 스캔한다. 본문 로딩 등 무거운 작업을 켤 때 쓴다.
pub fn scan_with(home: &Path, opts: &ScanOptions) -> Scan {
    let mut f = Failures::new(opts.lang);
    let claude = home.join(".claude");

    let global = scan_global(home, &claude, opts, &mut f);
    let projects = scan_projects(home, &claude, opts, &mut f);

    let mut scan = Scan {
        home: home.to_path_buf(),
        global,
        projects,
        edges: vec![],
        usage: vec![],
        diagnoses: vec![],
        failures: f.list,
        lang: opts.lang,
        budgets: vec![],
        usage_since: None,
    };
    scan.edges = edges::extract(&scan, home);

    let known: Vec<String> = scan
        .global
        .skills
        .iter()
        .map(|s| s.name.clone())
        .chain(
            scan.projects
                .iter()
                .flat_map(|p| p.skills.iter().map(|s| s.name.clone())),
        )
        .chain(
            scan.global
                .plugins
                .iter()
                .flat_map(|p| p.skills.iter().map(|s| s.name.clone())),
        )
        .collect();
    (scan.usage, scan.usage_since) = if opts.skip_usage {
        // 훑지 않는다고 해서 **모르는 것은 아니다.** 호출자가 아는 값을 주면 그걸 쓴다 —
        // 진단이 "안 쓰는 스킬"을 세는 근거가 여기이기 때문이다.
        let since = opts
            .usage_history
            .as_deref()
            .and_then(|p| usage::load_history(p).since);
        (opts.known_usage.clone().unwrap_or_default(), since)
    } else {
        let (now, since) = usage::collect_with_since(home, &known);
        match &opts.usage_history {
            Some(p) => usage::remember(p, now, since, &known),
            None => (now, since),
        }
    };
    scan.budgets = budget::compute(&scan, opts.lang);
    scan.diagnoses = diagnose::run(&scan, opts.lang);
    scan
}

fn scan_global(home: &Path, claude: &Path, opts: &ScanOptions, f: &mut Failures) -> GlobalScope {
    let mut g = GlobalScope::default();

    let md = claude.join("CLAUDE.md");
    if md.is_file() {
        g.claude_md_bytes = std::fs::metadata(&md).map(|m| m.len()).unwrap_or(0);
        if opts.load_bodies {
            g.claude_md_body = std::fs::read_to_string(&md)
                .ok()
                .map(|t| secret::mask_text(&t));
        }
        g.claude_md = Some(md);
    }

    // settings.json — 훅 등록과 MCP 권한
    // Claude Code는 `settings.json`과 `settings.local.json`을 **함께** 읽는다.
    // 한쪽만 보면 로컬에서 허용한 서버가 "권한 없음"으로 잡히고 로컬 훅은 안 보인다.
    // 실측: 이 맥의 글로벌 local settings에만 mcp allow가 15개 더 있었다.
    let mut enabled_plugins: std::collections::BTreeMap<String, bool> = Default::default();
    for name in ["settings.json", "settings.local.json"] {
        let path = claude.join(name);
        if !path.exists() {
            continue;
        }
        let Some(v) = f.ok(&path, FailureKind::BadJson, parse::json(&path)) else {
            continue;
        };
        g.hooks.extend(read_hooks(&v));
        let (allow, deny) = read_mcp_permissions(&v);
        g.allowed_mcp.extend(allow);
        g.denied_mcp.extend(deny);
        if let Some(m) = v.get("enabledPlugins").and_then(|x| x.as_object()) {
            for (k, val) in m {
                enabled_plugins.insert(k.clone(), val.as_bool().unwrap_or(false));
            }
        }
    }
    g.allowed_mcp.sort();
    g.allowed_mcp.dedup();
    g.denied_mcp.sort();
    g.denied_mcp.dedup();

    let mcp_file = claude.join(".mcp.json");
    if mcp_file.exists() {
        if let Some(v) = f.ok(&mcp_file, FailureKind::BadJson, parse::json(&mcp_file)) {
            // ⚠️ `~/.claude/.mcp.json` 은 Claude Code 가 읽지 않는다 —
            // `.mcp.json` 은 프로젝트 스코프 파일이고, 여기 둔 건 아무 세션도 안 본다.
            // 그래도 목록에서 빼지는 않는다. 사용자가 선언해 둔 것이고,
            // **왜 안 도는지**를 알려주는 게 이 도구의 일이다(절대원칙 1).
            g.mcp = read_mcp(&v, "~/.claude/.mcp.json", Loaded::Never);
        }
    }

    // MCP는 **세 곳**에 선언된다. 한 곳만 읽으면 멀쩡한 서버를 "선언 안 됨"으로 오탐하고,
    // 반대로 안 읽히는 선언을 "있다"고 말하게 된다.
    //
    // 실측: `pixellab`·`mobile`·`peekaboo`·`magnific` 4개가 `~/.claude.json` 에만 있었고,
    // 홈 루트 `~/.mcp.json` 은 아예 스캔 대상이 아니어서 그 자리를 통째로 놓치고 있었다.
    let cj = home.join(".claude.json");
    if cj.exists() {
        if let Some(v) = f.ok(&cj, FailureKind::BadJson, parse::json(&cj)) {
            merge_mcp(&mut g.mcp, read_mcp(&v, "~/.claude.json", Loaded::Always));
        }
    }
    // 홈 루트의 `.mcp.json`. 이름이 같아도 `~/.claude/` 것과 운명이 다르다 —
    // 홈이 프로젝트로 등록돼 있어서 **홈에서 연 세션에서는 읽힌다.**
    let home_mcp = home.join(".mcp.json");
    if home_mcp.exists() {
        if let Some(v) = f.ok(&home_mcp, FailureKind::BadJson, parse::json(&home_mcp)) {
            merge_mcp(&mut g.mcp, read_mcp(&v, "~/.mcp.json", Loaded::HomeOnly));
        }
    }
    g.mcp.sort_by(|a, b| a.name.cmp(&b.name));

    g.plugins = scan_plugins(claude, &enabled_plugins, opts, f);

    if opts.load_bodies {
        for h in &mut g.hooks {
            if let Some(p) = edges::hook_script_path(&h.command, home) {
                h.body = std::fs::read_to_string(&p)
                    .ok()
                    .map(|t| secret::mask_text(&t));
            }
        }
    }

    // Harnitor가 꺼둔 것도 함께 읽는다. 안 보이면 되살릴 수가 없다.
    let (off, _, _) = scan_skill_dir(&claude.join(".harnitor/disabled/skills"), opts, f);
    g.disabled_skills = off;
    // 꺼둔 훅도 읽는다. 보관함을 `settings.json` 과 같은 모양으로 저장해 둔 덕에
    // 같은 파서를 그대로 쓴다.
    let stash = claude.join(".harnitor/disabled/hooks.json");
    if stash.is_file() {
        if let Some(v) = f.ok(&stash, FailureKind::BadJson, parse::json(&stash)) {
            g.disabled_hooks = read_hooks(&v);
        }
    }

    let (skills, knowledge, links) = scan_skill_dir(&claude.join("skills"), opts, f);
    g.skills = skills;
    g.knowledge = knowledge;
    g.links = links;
    g.links.extend(scan_links(&claude.join("hooks")));
    g
}

/// `skills/` 한 폴더를 훑어 스킬 / 지식 / 심볼릭 링크로 갈라 담는다.
///
/// 가르는 기준은 **`SKILL.md`의 존재 여부** 하나다. 없으면 스킬이 아니다 —
/// 다른 스코프의 스킬이 여기에 쌓아둔 지식일 뿐이라 스킬 수에 세면 부풀어 오른다.
fn scan_skill_dir(
    dir: &Path,
    opts: &ScanOptions,
    f: &mut Failures,
) -> (Vec<Skill>, Vec<Knowledge>, Vec<Link>) {
    let (mut skills, mut knowledge, mut links) = (vec![], vec![], vec![]);
    let Ok(entries) = std::fs::read_dir(dir) else {
        return (skills, knowledge, links);
    };

    for e in entries.flatten() {
        let path = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let is_symlink = path.is_symlink();
        if is_symlink {
            links.push(make_link(&path));
        }
        // 깨진 링크는 여기서 끝난다. 링크로만 기록하고 내용은 못 읽는다.
        if !path.is_dir() {
            continue;
        }

        // 스킬 폴더 '안'의 심볼릭 링크도 놓치지 않는다.
        // 실측: `~/.claude/skills/example-lore/data`가 한 단계 안쪽에서 깨져 있었다.
        links.extend(scan_links_deep(&path, 2));

        let skill_md = path.join("SKILL.md");
        if skill_md.is_file() {
            let mut description = String::new();
            let mut body = None;
            match parse::read(&skill_md) {
                Ok(text) => {
                    if opts.load_bodies {
                        body = Some(secret::mask_text(&text));
                    }
                    let fm = parse::frontmatter(&text);
                    description = fm.get("description").unwrap_or_default();
                    // 관대하게 복구했더라도 규격 문제는 보고한다 — 조용히 넘기면 영영 안 고쳐진다.
                    if let Some((kind, why)) = fm.warning() {
                        f.note(&skill_md, kind, why);
                    }
                }
                Err(e) => f.note(&skill_md, FailureKind::Unreadable, e),
            }
            skills.push(Skill {
                description_tokens: estimate_tokens(&description),
                body,
                name,
                description,
                reference_count: parse::count_references(&path),
                path,
                is_symlink,
            });
        } else {
            let entries = parse::count_references(&path);
            if entries > 0 {
                knowledge.push(Knowledge {
                    name,
                    path,
                    entries,
                });
            } else {
                f.note(&path, FailureKind::EmptyDir, "");
            }
        }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    knowledge.sort_by(|a, b| a.name.cmp(&b.name));
    links.sort_by(|a, b| a.path.cmp(&b.path));
    (skills, knowledge, links)
}

/// 한 폴더 아래 `depth` 단계까지 내려가며 심볼릭 링크를 모은다.
/// 링크를 **따라가지는 않는다** — 깨진 링크를 깨진 채로 봐야 하기 때문이다.
/// 설치된 플러그인과 그것이 데려온 스킬을 모은다.
///
/// **활성 여부를 반드시 함께 담는다.** 비활성 플러그인의 스킬은 로드되지 않으므로
/// 컨텍스트를 먹지 않는데, 구분 없이 세면 "왜 이렇게 많지"라는 잘못된 결론이 나온다.
fn scan_plugins(
    claude: &Path,
    enabled: &std::collections::BTreeMap<String, bool>,
    opts: &ScanOptions,
    f: &mut Failures,
) -> Vec<Plugin> {
    let file = claude.join("plugins/installed_plugins.json");
    if !file.exists() {
        return vec![];
    }
    let Some(v) = f.ok(&file, FailureKind::BadJson, parse::json(&file)) else {
        return vec![];
    };
    let Some(map) = v.get("plugins").and_then(|p| p.as_object()) else {
        return vec![];
    };

    let mut out = vec![];
    for (name, installs) in map {
        for inst in installs.as_array().into_iter().flatten() {
            let Some(path) = inst.get("installPath").and_then(|p| p.as_str()) else {
                continue;
            };
            let path = PathBuf::from(path);
            let (skills, _, _) = scan_skill_dir(&path.join("skills"), opts, f);
            let mcp = plugin_mcp(&path);
            out.push(Plugin {
                mcp,
                enabled: enabled.get(name).copied().unwrap_or(false),
                name: name.clone(),
                install_path: path,
                skills,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// 플러그인이 선언한 MCP 서버 이름. 자리가 둘이다 — 폴더의 `.mcp.json` 과
/// `.claude-plugin/plugin.json` 의 `mcpServers`. 못 읽으면 조용히 빈 목록이다:
/// 플러그인 내부 파일이 깨진 건 사용자가 고칠 자리가 아니다.
fn plugin_mcp(install: &Path) -> Vec<String> {
    let mut out: Vec<String> = [
        install.join(".mcp.json"),
        install.join(".claude-plugin/plugin.json"),
    ]
    .iter()
    .filter_map(|p| parse::json(p).ok())
    .filter_map(|v| {
        v.get("mcpServers")
            .and_then(|m| m.as_object())
            .map(|m| m.keys().cloned().collect::<Vec<_>>())
    })
    .flatten()
    .collect();
    out.sort();
    out.dedup();
    out
}

fn scan_links_deep(dir: &Path, depth: usize) -> Vec<Link> {
    walkdir::WalkDir::new(dir)
        .max_depth(depth)
        .min_depth(1)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.path_is_symlink())
        .map(|e| make_link(e.path()))
        .collect()
}

fn scan_links(dir: &Path) -> Vec<Link> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return vec![];
    };
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_symlink())
        .map(|p| make_link(&p))
        .collect()
}

fn make_link(path: &Path) -> Link {
    let target = std::fs::read_link(path).unwrap_or_default();
    Link {
        alive: path.exists(), // 심링크를 따라간 결과가 존재하는가
        target,
        path: path.to_path_buf(),
    }
}

/// `permissions.allow` / `permissions.deny`에서 MCP 항목만 추린다.
/// **거부를 놓치면 막아둔 서버가 멀쩡한 것처럼 보인다.**
fn read_mcp_permissions(v: &serde_json::Value) -> (Vec<String>, Vec<String>) {
    let pick = |key: &str| -> Vec<String> {
        v.get("permissions")
            .and_then(|p| p.get(key))
            .and_then(|a| a.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str())
                    .filter(|s| s.starts_with("mcp__"))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    };
    (pick("allow"), pick("deny"))
}

fn read_hooks(v: &serde_json::Value) -> Vec<Hook> {
    let Some(map) = v.get("hooks").and_then(|h| h.as_object()) else {
        return vec![];
    };
    let mut out = vec![];
    for (event, blocks) in map {
        for b in blocks.as_array().into_iter().flatten() {
            let matcher = b.get("matcher").and_then(|m| m.as_str()).unwrap_or("");
            for h in b
                .get("hooks")
                .and_then(|x| x.as_array())
                .into_iter()
                .flatten()
            {
                if let Some(cmd) = h.get("command").and_then(|c| c.as_str()) {
                    out.push(Hook {
                        event: event.clone(),
                        // 빈 matcher 는 **빈 채로** 둔다. "전체" 라고 채워 넣으면
                        // 데이터에 한국어가 박혀 영어 화면에서도 그대로 나온다 —
                        // 사실(빈 값)은 여기, 그 사실을 뭐라고 부를지는 화면이 정한다.
                        matcher: matcher.to_string(),
                        command: cmd.to_string(),
                        body: None,
                    });
                }
            }
        }
    }
    out
}

/// 같은 이름이 여러 자리에 있으면 **더 넓게 읽히는 쪽이 이긴다.**
///
/// 안 읽히는 선언이 먼저 들어왔다고 그게 진실이 되지는 않는다 —
/// 실측에서 `playwright` 가 딱 이 경우였다(`~/.claude/.mcp.json` 과 `~/.claude.json` 양쪽).
fn merge_mcp(into: &mut Vec<McpServer>, incoming: Vec<McpServer>) {
    for m in incoming {
        match into.iter_mut().find(|x| x.name == m.name) {
            Some(prev) if prev.loaded.rank() < m.loaded.rank() => *prev = m,
            Some(_) => {}
            None => into.push(m),
        }
    }
}

fn read_mcp(v: &serde_json::Value, declared_in: &str, loaded: Loaded) -> Vec<McpServer> {
    let Some(map) = v.get("mcpServers").and_then(|m| m.as_object()) else {
        return vec![];
    };
    let mut out: Vec<_> = map
        .iter()
        .map(|(name, s)| McpServer {
            name: name.clone(),
            command: s
                .get("command")
                .and_then(|c| c.as_str())
                .map(str::to_string),
            url: s.get("url").and_then(|c| c.as_str()).map(secret::mask_url),
            args: secret::mask_args(
                &s.get("args")
                    .and_then(|a| a.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(str::to_string))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default(),
            ),
            declared_in: declared_in.to_string(),
            loaded,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// 프로젝트를 찾아 각각을 스캔한다.
///
/// 함정 셋을 여기서 막는다:
/// 1. **홈은 프로젝트가 아니다** — 홈이 등록돼 있으면 글로벌 스킬이 통째로 중복 계산된다
/// 2. **폴더가 사라진 등록은 건너뛴다** — 실측 101개 중 72개가 이 상태였다
/// 3. **대소문자만 다른 경로는 합친다** — 같은 폴더인데 세션이 갈리므로, 합치되 보고한다
fn scan_projects(home: &Path, claude: &Path, opts: &ScanOptions, f: &mut Failures) -> Vec<Project> {
    let cj = home.join(".claude.json");
    let Some(v) = cj
        .exists()
        .then(|| f.ok(&cj, FailureKind::BadJson, parse::json(&cj)))
        .flatten()
    else {
        return vec![];
    };
    let Some(map) = v.get("projects").and_then(|p| p.as_object()) else {
        return vec![];
    };

    let home_key = norm(home);
    // 대소문자 정규화 키로 묶는다. 첫 경로가 대표, 나머지는 duplicate_paths.
    let mut groups: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    for raw in map.keys() {
        let path = PathBuf::from(raw);
        if norm(&path) == home_key {
            continue; // ① 홈 제외
        }
        if !path.is_dir() {
            continue; // ② 사라진 폴더 제외
        }
        groups.entry(norm(&path)).or_default().push(path); // ③ 대소문자 병합
    }

    let mut projects: Vec<Project> = groups
        .into_values()
        .map(|mut paths| {
            paths.sort();
            let path = paths.remove(0);
            let mut p = scan_project(&path, opts, f);
            p.duplicate_paths = paths;
            p
        })
        .collect();

    // 글로벌 스코프에도 프로젝트별 MCP가 선언될 수 있다(`~/.claude.json`의 projects[path].mcpServers)
    for p in &mut projects {
        // 대표 경로뿐 아니라 대소문자만 다른 중복 등록도 함께 본다 —
        // 갈라진 등록은 각자 자기 설정을 들고 있고, 어느 쪽으로 세션을 열든 사용자에겐 같은 폴더다.
        let keys: Vec<String> = std::iter::once(&p.path)
            .chain(p.duplicate_paths.iter())
            .filter_map(|x| x.to_str().map(str::to_string))
            .collect();
        for key in keys {
            let Some(entry) = map.get(&key) else { continue };
            // local 스코프가 project 스코프를 이기지만, 같은 서버를 두 번 담지는 않는다
            for m in read_mcp(entry, "~/.claude.json", Loaded::Always) {
                if !p.mcp.iter().any(|x| x.name == m.name) {
                    p.mcp.push(m);
                }
            }
            // 꺼둔 서버. **안 읽으면 꺼진 것도 켜진 것처럼 보인다** —
            // 실측에서 24개 프로젝트가 뭔가를 꺼두고 있었는데 화면은 전부 살아 있다고 했다.
            if let Some(off) = entry.get("disabledMcpServers").and_then(|v| v.as_array()) {
                for name in off.iter().filter_map(|x| x.as_str()) {
                    if !p.disabled_mcp.iter().any(|x| x == name) {
                        p.disabled_mcp.push(name.to_string());
                    }
                }
            }
        }
        p.disabled_mcp.sort();
    }
    let _ = claude;
    projects
}

/// 마지막 커밋 시각. **`git log` 를 부르지 않는다** — 브랜치 ref 파일의 mtime 이
/// 커밋 시각과 같고(실측), stat 한 번이면 읽힌다.
///
/// 세 갈래를 순서대로 본다:
/// 1. `.git/HEAD` 가 가리키는 ref 파일 (보통 `refs/heads/<브랜치>`)
/// 2. ref 파일이 없으면(packed-refs 로 눌렸거나 갓 만든 저장소) `.git/HEAD` 자체
/// 3. detached HEAD 면 `.git/HEAD` 가 커밋 해시를 담고 있고, 그 mtime 이 체크아웃 시각이다
fn last_commit(project: &Path) -> Option<u64> {
    let git = project.join(".git");
    if !git.exists() {
        return None;
    }
    let mtime = |p: &Path| -> Option<u64> {
        std::fs::metadata(p)
            .ok()?
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_secs())
    };
    let head = git.join("HEAD");
    let refname = std::fs::read_to_string(&head)
        .ok()
        .and_then(|t| t.trim().strip_prefix("ref: ").map(str::to_string));
    match refname {
        Some(r) => mtime(&git.join(&r)).or_else(|| mtime(&head)),
        None => mtime(&head),
    }
}

/// description이 시스템 프롬프트에서 차지하는 토큰을 대략 잰다.
///
/// 정확한 토크나이저를 붙이지 않는 이유는, 이 값이 **비교와 규모 감각**에 쓰이기
/// 때문이다. 한글은 글자당 약 0.9토큰, 그 외는 약 0.28토큰으로 어림한다.
pub fn estimate_tokens(text: &str) -> usize {
    let (mut ko, mut other) = (0usize, 0usize);
    for c in text.chars() {
        if ('\u{AC00}'..='\u{D7A3}').contains(&c) {
            ko += 1;
        } else {
            other += 1;
        }
    }
    (ko as f64 * 0.9 + other as f64 * 0.28) as usize
}

fn norm(p: &Path) -> String {
    p.to_string_lossy().to_lowercase()
}

fn scan_project(path: &Path, opts: &ScanOptions, f: &mut Failures) -> Project {
    let dot = path.join(".claude");
    let (skills, knowledge, mut links) = scan_skill_dir(&dot.join("skills"), opts, f);

    let mut mcp = vec![];
    let mcp_file = path.join(".mcp.json");
    if mcp_file.exists() {
        if let Some(v) = f.ok(&mcp_file, FailureKind::BadJson, parse::json(&mcp_file)) {
            // 프로젝트 폴더의 `.mcp.json` 은 제자리다 — 그 프로젝트에서는 늘 로드된다.
            mcp = read_mcp(&v, ".mcp.json", Loaded::Always);
        }
    }

    let mut hooks = vec![];
    for name in ["settings.json", "settings.local.json"] {
        let path = dot.join(name);
        if !path.exists() {
            continue;
        }
        if let Some(v) = f.ok(&path, FailureKind::BadJson, parse::json(&path)) {
            hooks.extend(read_hooks(&v));
        }
    }

    links.extend(scan_links(&dot));

    Project {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        is_git: path.join(".git").exists(),
        has_claude_md: path.join("CLAUDE.md").is_file(),
        has_claude_local_md: path.join("CLAUDE.local.md").is_file(),
        skills,
        knowledge,
        mcp,
        hooks,
        links,
        duplicate_paths: vec![],
        last_commit: last_commit(path),
        disabled_mcp: vec![],
        path: path.to_path_buf(),
    }
}

/// 한 프로젝트 기준으로 스코프를 합성한다.
///
/// 규칙이 종류마다 다르다:
/// - 지침·훅 = 누적 (둘 다 로드)
/// - 스킬 = 이름이 겹치면 프로젝트 우선
/// - MCP = **같은 이름만** 프로젝트가 이긴다. 이름이 다르면 양쪽 다 살아남는다
pub fn resolve(scan: &Scan, project: &Project) -> Resolved {
    let mut duplicates = vec![];

    let mut skills: Vec<(Scope, Skill)> = project
        .skills
        .iter()
        .map(|s| (Scope::Project, s.clone()))
        .collect();
    for g in &scan.global.skills {
        if project.skills.iter().any(|p| p.name == g.name) {
            duplicates.push((Kind::Skill, g.name.clone()));
        } else {
            skills.push((Scope::Global, g.clone()));
        }
    }

    let mut mcp: Vec<(Scope, McpServer)> = project
        .mcp
        .iter()
        .map(|m| (Scope::Project, m.clone()))
        .collect();
    for g in &scan.global.mcp {
        if project.mcp.iter().any(|p| p.name == g.name) {
            duplicates.push((Kind::Mcp, g.name.clone()));
        } else {
            mcp.push((Scope::Global, g.clone()));
        }
    }

    Resolved {
        skills,
        mcp,
        duplicates,
    }
}
