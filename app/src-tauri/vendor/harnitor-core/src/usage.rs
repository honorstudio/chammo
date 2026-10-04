//! 스킬이 실제로 몇 번 호출됐나 — 대화 기록에서 집계한다.
//!
//! 대상은 `~/.claude/projects/**/*.jsonl`이고 실측 기준 **1.5GB / 225파일**이다.
//! 그래서 라인마다 JSON을 파싱하지 않는다. 필요한 건 두 값뿐이라
//! 문자열로 훑고, 그마저도 후보 라인에서만 한다.

use crate::model::Usage;
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// `"키":"값"` 꼴에서 값만 꺼낸다. 이스케이프된 따옴표는 값의 끝이 아니다.
fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("\"{key}\":\"");
    let start = line.find(&pat)? + pat.len();
    let rest = &line[start..];
    let mut end = 0;
    let bytes = rest.as_bytes();
    while end < bytes.len() {
        match bytes[end] {
            b'\\' => end += 2,
            b'"' => return Some(&rest[..end]),
            _ => end += 1,
        }
    }
    None
}

struct Tally {
    count: usize,
    last: Option<String>,
}

/// 한 세션 파일에서 스킬 호출을 센다. 그 파일의 **첫 기록 시각**을 돌려준다 —
/// 남아 있는 기록이 언제부터인지(= "0회"가 무슨 기간의 0인지) 알려면 필요하다.
fn tally_file(path: &Path, out: &mut BTreeMap<String, Tally>) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut first: Option<String> = None;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if first.is_none() {
            first = field(&line, "timestamp").map(str::to_string);
        }
        // 값싼 사전 검사 — 대부분의 라인은 여기서 걸러진다
        if !line.contains("\"skill\"") {
            continue;
        }
        // 도구 호출인 것만 센다. 사람이 대화에 그 문자열을 적은 경우를 제외하기 위해서다.
        if !line.contains("\"Skill\"") {
            continue;
        }
        let Some(name) = field(&line, "skill") else {
            continue;
        };
        if name.is_empty() || name.len() > 80 {
            continue;
        }
        let ts = field(&line, "timestamp").map(str::to_string);
        let e = out.entry(name.to_string()).or_insert(Tally {
            count: 0,
            last: None,
        });
        e.count += 1;
        if let Some(t) = ts {
            if e.last.as_ref().is_none_or(|prev| *prev < t) {
                e.last = Some(t);
            }
        }
    }
    first
}

/// `known`은 지금 하네스에 실재하는 스킬 이름. 여기 없으면 지워진 스킬로 표시한다.
/// 기록에 남은 이름이 하네스의 스킬과 맞는지 본다.
///
/// 플러그인 스킬은 `플러그인:스킬` 꼴로 기록된다(`document-skills:xlsx`).
/// 이름 그대로 비교하면 멀쩡한 스킬이 "파일에 없음"으로 잡힌다.
pub(crate) fn is_known(name: &str, known: &[String]) -> bool {
    if known.iter().any(|k| k == name) {
        return true;
    }
    match name.split_once(':') {
        Some((_, skill)) => known.iter().any(|k| k == skill),
        None => false,
    }
}

pub fn collect(home: &Path, known: &[String]) -> Vec<Usage> {
    collect_with_since(home, known).0
}

/// 호출 집계와 함께, 남아 있는 기록 중 **가장 이른 날짜**(`YYYY-MM-DD`)를 낸다.
pub fn collect_with_since(home: &Path, known: &[String]) -> (Vec<Usage>, Option<String>) {
    let root = home.join(".claude/projects");
    let mut tally: BTreeMap<String, Tally> = BTreeMap::new();
    let mut since: Option<String> = None;

    for e in walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        if e.file_type().is_file() && e.path().extension().is_some_and(|x| x == "jsonl") {
            if let Some(t) = tally_file(e.path(), &mut tally) {
                let day: String = t.chars().take(10).collect();
                if since.as_ref().is_none_or(|s| day < *s) {
                    since = Some(day);
                }
            }
        }
    }

    let mut out: Vec<Usage> = tally
        .into_iter()
        .map(|(skill, t)| Usage {
            not_in_files: !is_known(&skill, known),
            skill,
            count: t.count,
            last_used: t.last,
        })
        .collect();
    sort(&mut out);
    (out, since)
}

/// 많이 쓴 것부터
fn sort(v: &mut [Usage]) {
    v.sort_by(|a, b| b.count.cmp(&a.count).then(a.skill.cmp(&b.skill)));
}

/// 누적 호출 기록 — `~/.claude/.harnitor/usage-history.json`.
///
/// 대화 기록은 30일이 지나면 지워져서, 그것만 세면 "0회"는 "최근 30일 0회"일 뿐이다.
/// 스캔할 때마다 스킬별 **최댓값·최신 날짜**를 여기 쌓아 두면 다음부터는 "기록 시작 이후 0회"가 된다.
/// 하네스 파일이 아니라 하니터 자기 자리라(쓰기 원칙 3의 백업 대상이 아니다) 그냥 덮어쓴다.
#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct History {
    /// 기록이 시작된 날(`YYYY-MM-DD`). 남은 대화 기록 중 가장 이른 날과 이전 값 중 이른 쪽
    pub since: Option<String>,
    pub skills: BTreeMap<String, HistoryRec>,
}

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct HistoryRec {
    pub count: usize,
    pub last_used: Option<String>,
}

/// 누적 기록의 기본 자리. 하니터 자기 폴더다(`~/.claude/backups/` 는 Claude Code 자리라 안 쓴다).
pub fn history_path(home: &Path) -> std::path::PathBuf {
    home.join(".claude/.harnitor/usage-history.json")
}

/// 읽기만. 없거나 깨졌으면 빈 기록이다 — 기록이 망가졌다고 스캔이 멈출 이유는 없다(원칙 9).
pub fn load_history(path: &Path) -> History {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// 이번 집계를 누적 기록에 합치고 저장한 뒤, **합친 결과**를 돌려준다.
/// 이번에 안 보인 스킬도 기록에 있으면 남는다 — 그게 이 기록의 쓸모다.
pub fn remember(
    path: &Path,
    now: Vec<Usage>,
    since: Option<String>,
    known: &[String],
) -> (Vec<Usage>, Option<String>) {
    let mut h = load_history(path);
    for u in &now {
        let r = h.skills.entry(u.skill.clone()).or_default();
        r.count = r.count.max(u.count);
        if u.last_used > r.last_used {
            r.last_used = u.last_used.clone();
        }
    }
    h.since = match (h.since.take(), since) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(&h) {
        let _ = std::fs::write(path, text);
    }
    let mut out: Vec<Usage> = h
        .skills
        .iter()
        .map(|(skill, r)| Usage {
            not_in_files: !is_known(skill, known),
            skill: skill.clone(),
            count: r.count,
            last_used: r.last_used.clone(),
        })
        .collect();
    sort(&mut out);
    (out, h.since)
}

/// 테스트에서 이름 매칭 규칙만 직접 확인하기 위한 통로.
pub fn is_known_for_test(name: &str, known: &[String]) -> bool {
    is_known(name, known)
}
