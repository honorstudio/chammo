//! 스캔 결과 자료구조.
//!
//! 여기 정의된 타입은 **관측 결과이자 청사진의 뼈대**다(CLAUDE.md 참조).
//! 화면용으로만 쓰이는 필드를 넣지 않는다 — v2에서 이 구조를 그대로 저장·재적용한다.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 스캔 옵션.
#[derive(Debug, Clone, Default)]
pub struct ScanOptions {
    /// 파일 본문까지 읽을지. 리포트용이며 JSON 출력은 기본 미포함이다
    /// (실측: 본문 전체가 약 1MB).
    ///
    /// **`CLAUDE.local.md`는 이 옵션과 무관하게 절대 읽지 않는다** —
    /// 계정·키를 담으라고 만든 파일이고 리포트는 공유될 수 있다.
    pub load_bodies: bool,
    /// 사용 이력 집계를 건너뛴다.
    ///
    /// 대화기록은 실측 1.5GB / 695파일이라 이 한 단계가 스캔 시간의 대부분을 차지한다
    /// (2.4초 중 약 2초). 스킬을 껐다고 **과거 호출 기록이 바뀌지는 않으므로**,
    /// 토글 직후 화면을 새로 그릴 때는 이미 가진 값을 그대로 쓰면 된다.
    pub skip_usage: bool,
    /// 이미 아는 호출 기록. `skip_usage` 로 훑기는 건너뛰되 **진단은 이 값으로 낸다**.
    ///
    /// 없으면 진단이 "한 번도 안 불린 스킬"을 전부로 센다 — 훑지 않았을 뿐인데
    /// 안 쓴다고 말하는 셈이라, 화면을 새로 그릴 때마다 숫자가 부풀었다
    /// (실측: 65개·8,820토큰 → 81개·12,746토큰).
    pub known_usage: Option<Vec<Usage>>,
    /// 진단 문구를 어느 말로 낼지. 스캔 옵션에 두는 이유는 **문장을 만드는 자리가
    /// 여기**이기 때문이다 — 나중에 번역하려면 숫자가 박힌 문장을 되짚어야 한다.
    pub lang: crate::i18n::Lang,
    /// 누적 호출 기록 자리(`~/.claude/.harnitor/usage-history.json`). `None` 이면 읽지도 쓰지도 않는다 —
    /// 라이브러리 기본은 읽기만이고, 쓰는 건 CLI·앱이 정한다.
    pub usage_history: Option<PathBuf>,
}

/// 스코프. 로드 순서이자 우선순위 순서다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    /// `~/.claude` — 먼저 깔리는 바닥
    Global,
    /// 프로젝트 폴더 — 그 위에 얹힌다
    Project,
}

/// 하네스를 이루는 항목의 종류. 세로 로드 순서와 같은 차례다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Hook,
    Doc,
    Skill,
    Mcp,
    Knowledge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    /// frontmatter의 description. 멀티라인(`>`)도 한 줄로 합쳐 담는다.
    pub description: String,
    pub path: PathBuf,
    /// `references/*.md` 개수. 스킬에 딸린 참고문서.
    pub reference_count: usize,
    /// 이 폴더 자체가 심볼릭 링크인가
    pub is_symlink: bool,
    /// description이 매 세션 시스템 프롬프트에서 차지하는 대략적 토큰
    pub description_tokens: usize,
    /// `SKILL.md` 본문 전체. 설명 한 줄로는 그 스킬이 뭘 하는지 알 수 없다.
    /// 크기가 커서(실측 글로벌만 449KB) 요청할 때만 담는다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

/// `SKILL.md` 없이 `references/`만 있는 폴더.
/// 스킬이 아니라 **다른 스코프의 스킬이 여기에 쌓아둔 지식**이다.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Knowledge {
    pub name: String,
    pub path: PathBuf,
    pub entries: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub name: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    /// 어느 파일에서 선언됐나 (`.mcp.json` / `~/.claude.json`)
    pub declared_in: String,
    /// Claude Code 가 **이 선언을 어디서 읽는가.**
    ///
    /// 불리언이면 안 되는 이유가 실측으로 나왔다 — 자리가 셋인데 운명이 다르다.
    pub loaded: Loaded,
}

/// MCP 선언이 **실제로 읽히는 범위.**
///
/// ```text
/// ~/.claude.json  mcpServers   모든 세션이 읽는다        Always
/// ~/.claude/.mcp.json          어느 세션도 안 읽는다      Never
/// ~/.mcp.json                  홈에서 열 때만 읽힌다      HomeOnly
/// ```
///
/// 셋을 하나로 접으면 화면이 같은 말을 하게 되고, 그러면 고칠 자리가 흐려진다.
/// `Never` 는 옮겨야 하고 `HomeOnly` 는 (의도한 fallback 이라면) 그대로 둬도 된다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Loaded {
    /// 모든 세션이 읽는다. `~/.claude.json` 의 `mcpServers` — 진짜 사용자 스코프다.
    Always,
    /// 어느 세션도 읽지 않는다. `~/.claude/.mcp.json` 이 여기다.
    ///
    /// `.mcp.json` 은 **프로젝트 스코프** 파일이라 그 폴더에서 세션을 열 때만 로드되는데,
    /// `~/.claude/` 에서 세션을 여는 일은 없다. 선언은 있는데 서버는 없는 셈이다.
    ///
    /// 실측(2026-08-28): 여기 7개가 선언돼 있었는데 세션에서 뜨는 것은 `playwright`
    /// 뿐이었고, 그것도 **프로젝트 `.mcp.json` 에 따로 있어서**였다. 선언해 뒀다고 도는 게 아니다.
    Never,
    /// **홈에서 세션을 열 때만** 읽힌다. 홈 루트의 `~/.mcp.json` 이 여기다.
    ///
    /// 같은 `.mcp.json` 인데 이쪽은 폴더가 홈이라, 홈에서 연 세션에는 프로젝트 스코프로
    /// 잡힌다. 다른 폴더에서는 없는 것과 같다.
    ///
    /// 실측(2026-09-05): 사용자가 "평소엔 이게 깔려 있다"고 알던 fallback 이 여기 있었다.
    /// `~/.claude/` 를 보고 있으면 영영 안 보이는 자리다.
    HomeOnly,
}

impl Loaded {
    /// 어느 폴더에서든 읽히나. **어휘에 넣어도 되는지**가 이 값으로 갈린다.
    pub fn everywhere(self) -> bool {
        self == Loaded::Always
    }
    /// 같은 이름이 여러 자리에 있을 때 **누가 이기나.** 큰 쪽이 이긴다 —
    /// 안 읽히는 선언이 먼저 들어왔다고 그게 진실이 되지는 않는다.
    pub fn rank(self) -> u8 {
        match self {
            Loaded::Always => 2,
            Loaded::HomeOnly => 1,
            Loaded::Never => 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hook {
    pub event: String,
    pub matcher: String,
    pub command: String,
    /// 훅 스크립트 본문. 훅이 실제로 무엇을 하는지는 이걸 봐야 안다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub path: PathBuf,
    pub target: PathBuf,
    /// 대상이 실제로 존재하는가. `false`면 깨진 링크다.
    pub alive: bool,
}

/// 읽지 못한 것. **스캔을 중단시키지 않고 여기 담는다**(CLAUDE.md 절대원칙 9).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Failure {
    pub path: PathBuf,
    /// 무엇이 틀렸나. **문장이 아니라 종류다** — 문장은 언어에 따라 바뀌지만
    /// 판정은 안 바뀐다. 진단은 이걸 보고 자기 말로 옮긴다.
    pub kind: FailureKind,
    /// 파서·OS가 준 원문. 대개 영어이고 번역하지 않는다 —
    /// `mapping values are not allowed in this context` 같은 건 옮기면 검색이 안 된다.
    pub detail: String,
    /// 사람이 읽는 한 줄. 스캔 언어로 만든다.
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GlobalScope {
    pub claude_md: Option<PathBuf>,
    pub claude_md_bytes: u64,
    /// 전역 지침 본문. `load_bodies`일 때만 담긴다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_md_body: Option<String>,
    pub hooks: Vec<Hook>,
    pub skills: Vec<Skill>,
    pub knowledge: Vec<Knowledge>,
    pub mcp: Vec<McpServer>,
    pub links: Vec<Link>,
    /// `settings.json`의 `permissions.allow` 중 `mcp__` 항목
    pub allowed_mcp: Vec<String>,
    /// Harnitor가 꺼둔 스킬. **목록에서 없애지 않고 상태로 남긴다** —
    /// 화면에서 사라지면 다시 켤 방법이 없다(절대원칙 1과 같은 이유).
    pub disabled_skills: Vec<Skill>,
    /// Harnitor 로 꺼둔 훅. **목록에서 사라지면 다시 켤 방법이 없다**(절대원칙 1).
    pub disabled_hooks: Vec<Hook>,
    /// `permissions.deny`의 MCP 항목. 허용만 보고 거부를 놓치면
    /// 막아둔 서버가 멀쩡한 것처럼 보인다.
    pub denied_mcp: Vec<String>,
    pub plugins: Vec<Plugin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub path: PathBuf,
    pub is_git: bool,
    pub has_claude_md: bool,
    pub has_claude_local_md: bool,
    pub skills: Vec<Skill>,
    pub knowledge: Vec<Knowledge>,
    pub mcp: Vec<McpServer>,
    pub hooks: Vec<Hook>,
    pub links: Vec<Link>,
    /// 대소문자만 다른 중복 등록 경로. macOS는 같은 폴더로 보지만
    /// Claude Code는 별개 프로젝트로 취급해 세션이 갈린다.
    pub duplicate_paths: Vec<PathBuf>,
    /// 마지막 커밋 시각(epoch 초). git 저장소가 아니거나 읽지 못하면 `None`.
    ///
    /// **`git log` 를 돌리지 않는다.** 브랜치 ref 파일의 mtime 이 커밋 시각과 정확히 같고
    /// (실측 3곳 전부 일치), 그건 프로세스 하나 안 띄우고 stat 한 번이면 읽힌다.
    /// 프로젝트가 27개면 그 차이가 그대로 스캔 시간이 된다.
    pub last_commit: Option<u64>,
    /// 이 프로젝트에서 **꺼둔** MCP 서버 이름. 선언은 남아 있고 호출만 막힌 상태다.
    ///
    /// 끄기는 프로젝트 단위라 서버가 아니라 프로젝트가 이 목록을 가진다.
    /// 안 읽으면 꺼둔 서버도 켜진 것처럼 보인다 — 실측에서 24개 프로젝트가
    /// 이미 뭔가를 꺼두고 있었는데 화면은 전부 살아 있다고 말하고 있었다.
    pub disabled_mcp: Vec<String>,
}

/// 지금 돌고 있는 Claude Code 세션 하나.
///
/// 스캔 결과(`Scan`)에 넣지 않고 따로 둔다 — 하네스 구조는 파일을 고칠 때만 바뀌지만
/// 세션은 초 단위로 바뀐다. 같이 묶으면 세션 하나 보려고 1.5GB를 다시 훑게 된다.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub pid: u32,
    /// 이 세션이 켜진 폴더. `lsof` 가 막히면 None 이다 — 그래도 세션 수는 센다.
    pub cwd: Option<PathBuf>,
    /// cwd 의 마지막 이름. 스캔된 프로젝트와 맞춰 보는 열쇠다.
    pub project: Option<String>,
    /// 프로세스가 산 시간(초).
    pub uptime_secs: u64,
    /// 이 폴더의 세션 기록이 마지막으로 쓰인 시각(epoch 초).
    pub last_active: Option<u64>,
    /// 그때로부터 지난 시간(초). 작을수록 지금 뭔가 하고 있다는 뜻이다.
    pub idle_secs: Option<u64>,
    /// 세션 기록 파일 이름에서 딴 id.
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Scan {
    pub home: PathBuf,
    pub global: GlobalScope,
    pub projects: Vec<Project>,
    pub edges: Vec<Edge>,
    pub usage: Vec<Usage>,
    pub diagnoses: Vec<Diagnosis>,
    pub failures: Vec<Failure>,
    /// 세션이 시작할 때 **무조건** 실리는 것의 합. 전역 하나(`project: None`)와 프로젝트마다 하나.
    #[serde(default)]
    pub budgets: Vec<Budget>,
    /// 호출 기록이 언제부터 있나(`YYYY-MM-DD`). "0회"는 이 날 이후 0회라는 뜻이다.
    #[serde(default)]
    pub usage_since: Option<String>,
    /// 이 결과의 문장들이 어느 말로 쓰였나. 계획 요약도 같은 말을 써야 해서 남긴다 —
    /// 진단은 한국어인데 미리보기 모달만 영어면 그게 더 어색하다.
    pub lang: crate::i18n::Lang,
}

/// 얼마나 심각한가. 색이 아니라 **성격**을 나눈다 —
/// "연결 안 됨"은 문제가 아니라 상태이므로 경고가 아니다(절대원칙 1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// 실제로 깨져 있거나 실행하면 실패한다
    Problem,
    /// 손해가 쌓이고 있다 (안 쓰는데 비용을 낸다 등)
    Cost,
    /// 알아둘 만한 상태. 문제라는 뜻이 아니다
    Note,
}

/// 진단 한 건. **근거 없이 내지 않는다** — 어느 파일이 무엇과 어긋났는지를 함께 낸다.
/// 스캔 중 걸린 것의 종류.
///
/// 하네스는 **원래 깨져 있는 상태를 보러 가는 도구**라(절대원칙 9) 실패는 예외가 아니라 자료다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// 파일을 열지 못했다 (권한·깨진 링크)
    Unreadable,
    /// JSON 이 깨졌다
    BadJson,
    /// frontmatter 가 엄격한 YAML 은 아니지만 복구해서 읽었다
    LooseFrontmatter,
    /// frontmatter 블록 자체가 없다
    NoFrontmatter,
    /// 스킬도 지식도 아닌 빈 폴더
    EmptyDir,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnosis {
    pub severity: Severity,
    /// 규칙 식별자. UI가 이걸로 묶거나 숨긴다
    pub rule: String,
    pub title: String,
    pub detail: String,
    /// 근거가 되는 경로·이름들. **사람이 읽는 문장이다** — 규칙마다 모양이 다르다.
    pub evidence: Vec<String>,
    /// 어느 프로젝트의 이야기인가. **글로벌 설정 이야기면 `None`** 이고, 그건 어느
    /// 프로젝트를 보고 있든 늘 해당된다.
    ///
    /// 이게 없으면 project-b 를 보는 화면에 project-a 의 문제가 섞여 뜬다(실측: 선언 안 된
    /// MCP 호출 10건 중 1건, 깨진 링크 2건 중 1건이 특정 프로젝트 것이었다).
    pub project: Option<PathBuf>,
    /// 이 진단이 가리키는 항목의 **이름**. 화면이 그걸 찾아 짚어 주는 데 쓴다.
    ///
    /// `evidence` 와 따로 두는 이유는, 근거 문장이 규칙마다 모양이 달라서다
    /// (`"a → b"`, `"이름 (12토큰)"`, `"경로: 사유"`). 화면이 그걸 되짚어 파싱하면
    /// 규칙 문구를 고칠 때마다 조용히 깨진다. 읽는 것과 짚는 것을 갈라 둔다.
    pub targets: Vec<String>,
    /// 사람이 직접 실행할 수 있는 명령. v1은 쓰지 않으므로 제안만 한다(ADR-0003)
    pub suggestion: Option<String>,
    /// 고치는 길. 규칙마다 정해져 있고 화면과 글 보고가 같은 값을 읽는다.
    #[serde(default)]
    pub fix: FixPath,
}

/// 진단을 **어떻게** 푸나. 에이전트가 보고 바로 움직일 수 있게 셋으로 가른다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FixPath {
    /// 하니터 토글로 된다(끄기·보관함)
    Toggle,
    /// 파일을 고쳐야 한다(경로·선언·문장)
    EditFile,
    /// 사람이 정해야 한다(어느 쪽이 맞나, 지워도 되나)
    Ask,
    /// 고칠 게 아니라 알아둘 상태
    #[default]
    None,
}

/// 설치된 플러그인. 스킬이 딸려 들어오는 주요 경로다.
///
/// **하네스는 사용자가 넣지 않아도 부푼다**(CLAUDE.md 절대원칙 7).
/// 플러그인 하나가 스킬 수십 개를 데려오고, 그 설명은 매 세션 컨텍스트를 먹는다.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plugin {
    pub name: String,
    pub install_path: PathBuf,
    pub enabled: bool,
    pub skills: Vec<Skill>,
    /// 플러그인이 데려온 MCP 서버 이름. 도구 이름은 `mcp__plugin_<플러그인>_<서버>__…` 꼴이 된다.
    #[serde(default)]
    pub mcp: Vec<String>,
}

impl Plugin {
    /// `@마켓` 을 뗀 이름 — 도구 이름에 들어가는 쪽이다.
    pub fn short_name(&self) -> &str {
        self.name.split('@').next().unwrap_or(&self.name)
    }
}

/// 스킬이 실제로 몇 번 호출됐나.
///
/// **"0회"를 "안 쓴다"로 단정하지 않는다** — 기록이 정리된 옛 세션은 안 잡히고,
/// 최근 만든 스킬은 당연히 0이며, 가끔 쓰는 게 정상인 스킬도 있다.
/// 숫자는 보여주되 판정은 사람이 한다(CLAUDE.md 절대원칙 8).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub skill: String,
    pub count: usize,
    /// 마지막으로 호출된 시각(기록에 있는 것 기준)
    pub last_used: Option<String>,
    /// 하네스 파일 어디에도 그 이름의 스킬이 없다.
    ///
    /// 지운 스킬일 수도 있지만 **Claude Code 내장 스킬**일 수도 있다
    /// (실측: `artifact-design`·`loop`·`dataviz`는 파일로 존재하지 않는다).
    /// 그래서 "지워졌다"고 단정하지 않는다.
    pub not_in_files: bool,
}

/// 무엇이 무엇을 부르는가. 계층 위에 곡선으로 그려지는 그 관계다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    /// 훅이 스킬을 환기한다 — 사람이 부르지 않아도 도는 유일한 경로
    HookTriggers,
    /// 지침(CLAUDE.md)이 스킬을 지시한다
    DocDirects,
    /// 스킬이 다른 스킬을 참조한다
    SkillRefers,
    /// 스킬이 MCP 도구를 호출한다
    CallsMcp,
    /// 스킬이 **어디에도 선언되지 않은** MCP를 호출한다. 실행하면 실패한다
    CallsMissingMcp,
    /// 스킬이 같은 이름의 지식 폴더에 쌓는다
    SkillWritesKnowledge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub kind: EdgeKind,
    pub from: String,
    pub from_scope: Scope,
    pub to: String,
    pub to_scope: Scope,
    /// 어느 프로젝트 맥락에서 만들어진 엣지인가. 글로벌끼리면 `None`.
    ///
    /// **이름만으로는 못 가른다.** 실측에서 `verify-tests` 가 프로젝트 세 곳에,
    /// `troubleshooting` 은 글로벌과 프로젝트 양쪽에 있었다. 이 값이 없으면
    /// A 프로젝트를 보는 화면에 B 프로젝트의 연결선이 섞여 그려진다.
    /// 이름이 아니라 **경로**인 것도 같은 이유다 — 대소문자만 다른 중복 등록이 실제로 있다.
    pub project: Option<PathBuf>,
    /// MCP 호출이 **코드 블록·표 안에서만** 나왔다. MCP 를 설명하는 스킬이 예시로 적은
    /// 이름(`xxx`·`stripe`)이 빨간 경고로 뜨던 자리라, 판정을 낮추는 근거로 쓴다.
    #[serde(default)]
    pub example: bool,
}

/// 한 프로젝트에서 실제로 유효한 하네스. 스코프 합성 결과다.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resolved {
    pub skills: Vec<(Scope, Skill)>,
    pub mcp: Vec<(Scope, McpServer)>,
    /// 이름이 양쪽 스코프에 있는 항목
    pub duplicates: Vec<(Kind, String)>,
}

/// 늘 실리는 양 — 세션 하나가 **부르지 않아도** 읽는 것의 합과 내역.
///
/// 스킬 설명 토큰만 보면 절반이다. 전역 CLAUDE.md 가 그보다 크고(실측 41KB),
/// 메모리 목록·`@` 로 가져온 파일도 같이 실린다. 대기 중에도 매 순간 판단에 끼어드는
/// 칸이라 **여기가 낡거나 부딪히면 늘 틀리게 움직인다** — 그래서 따로 잰다.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Budget {
    /// 어느 프로젝트에서 연 세션인가. `None` 은 프로젝트 지침이 없는 폴더(전역만)다.
    pub project: Option<PathBuf>,
    pub total_tokens: usize,
    /// 큰 순으로.
    pub parts: Vec<BudgetPart>,
    /// 매 지시마다 도는 `UserPromptSubmit` 훅 명령. 출력은 정적으로 못 재서 토큰에 안 넣는다.
    pub prompt_hooks: Vec<String>,
    /// 긴 섹션 — 부를 때만 읽혀도 되는 후보. 큰 순으로 다섯까지.
    pub hints: Vec<BudgetHint>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BudgetKind {
    /// CLAUDE.md 층(전역·프로젝트·`.claude/`·local)
    Instructions,
    /// CLAUDE.md 가 `@경로` 로 가져온 파일
    Import,
    /// 메모리 목록 `MEMORY.md` 앞 200줄
    Memory,
    /// 스킬 설명 묶음(전역 / 프로젝트 / 플러그인 하나)
    SkillDescriptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetPart {
    pub kind: BudgetKind,
    /// 사람이 읽는 이름(`~/.claude/CLAUDE.md`, `스킬 설명 · 전역 52개`)
    pub label: String,
    pub path: Option<PathBuf>,
    pub tokens: usize,
    /// 내용을 안 읽고 크기로 어림했다. `CLAUDE.local.md` 가 그렇다 — 키를 담는 자리다(절대원칙 2).
    pub estimated_from_size: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetHint {
    pub path: PathBuf,
    /// 제목 줄 번호(1부터)
    pub line: usize,
    pub heading: String,
    pub tokens: usize,
}
