//! 파일 읽기·파싱 헬퍼.
//!
//! 모든 함수는 **실패해도 panic하지 않고** `Result`를 돌려준다.
//! 호출부가 실패를 `Failure`로 모아 담고 스캔을 계속하기 위해서다.

use std::path::Path;

pub type Parsed<T> = Result<T, String>;

pub fn read(path: &Path) -> Parsed<String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn json(path: &Path) -> Parsed<serde_json::Value> {
    let text = read(path)?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// frontmatter를 읽은 결과.
///
/// Claude Code는 frontmatter를 **관대하게** 읽는다. 실제 스킬 중에는
/// `description` 값 안에 `: `가 들어가 엄격한 YAML 파서가 거부하는 것들이 있는데
/// (실측: `legal-analysis`, `lore-keeper`), Claude Code에서는 정상 동작한다.
///
/// 스캐너가 실제보다 엄격하면 멀쩡한 스킬을 "설명 없음"으로 오탐한다.
/// 그래서 **진짜 파서를 먼저 시도하고, 실패하면 관대하게 복구하되 그 사실을 보고**한다.
/// 조용히 복구하면 규격을 벗어난 파일이 영영 안 고쳐진다.
pub enum FrontMatter {
    /// YAML 스펙을 지킨다
    Strict(serde_yaml_ng::Value),
    /// 스펙을 벗어났지만 복구했다. 사유를 함께 담는다.
    Lenient(std::collections::BTreeMap<String, String>, String),
    /// `---` 블록이 아예 없다
    Missing,
}

impl FrontMatter {
    pub fn get(&self, key: &str) -> Option<String> {
        match self {
            Self::Strict(v) => yaml_str(v, key),
            Self::Lenient(m, _) => m.get(key).cloned(),
            Self::Missing => None,
        }
    }
    /// 사용자에게 알려야 할 규격 문제. 정상이면 `None`.
    ///
    /// **문장이 아니라 (종류, 원문) 을 돌려준다.** 문장은 스캔 언어에 따라 달라지고,
    /// 파서가 준 원문(`mapping values are not allowed…`)은 번역하면 검색이 안 된다.
    pub fn warning(&self) -> Option<(crate::model::FailureKind, String)> {
        use crate::model::FailureKind as K;
        match self {
            Self::Strict(_) => None,
            Self::Lenient(_, why) => Some((K::LooseFrontmatter, why.clone())),
            Self::Missing => Some((K::NoFrontmatter, String::new())),
        }
    }
}

/// `---`로 감싼 frontmatter를 읽는다.
pub fn frontmatter(text: &str) -> FrontMatter {
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return FrontMatter::Missing;
    };
    let Some(end) = rest.find("\n---") else {
        return FrontMatter::Missing;
    };
    let block = &rest[..end];

    match serde_yaml_ng::from_str::<serde_yaml_ng::Value>(block) {
        Ok(v) if v.is_mapping() => FrontMatter::Strict(v),
        // 이 자리의 사유는 **파서 원문과 같은 칸**에 들어간다(아래 Err 갈래를 보라).
        // 원문은 영어이므로 우리가 채우는 것도 영어여야 한 줄 안에서 말이 섞이지 않는다.
        Ok(_) => FrontMatter::Lenient(lenient(block), "not a YAML mapping".into()),
        Err(e) => {
            let why = e.to_string();
            let why = why.split(" at line").next().unwrap_or(&why).to_string();
            FrontMatter::Lenient(lenient(block), why)
        }
    }
}

/// YAML 파서가 거부한 블록에서 `키: 값`을 최대한 건져낸다.
///
/// 들여쓰기된 줄은 앞 키의 값에 이어 붙인다(멀티라인 스칼라 흉내).
/// 정규식을 쓰지 않는 이유는 원칙 4와 같다 — 눈에 안 보이는 곳에서 조용히 틀린다.
fn lenient(block: &str) -> std::collections::BTreeMap<String, String> {
    let mut out = std::collections::BTreeMap::new();
    let mut key: Option<String> = None;
    let mut buf = String::new();

    for line in block.lines() {
        let is_new_key = !line.starts_with(char::is_whitespace)
            && line.find(':').is_some_and(|i| {
                line[..i]
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
            });

        if is_new_key {
            if let Some(k) = key.take() {
                out.insert(k, buf.trim().to_string());
            }
            let i = line.find(':').unwrap();
            key = Some(line[..i].trim().to_string());
            buf = line[i + 1..]
                .trim()
                .trim_matches('>')
                .trim_matches('|')
                .trim()
                .to_string();
        } else if key.is_some() {
            let t = line.trim();
            if !t.is_empty() {
                if !buf.is_empty() {
                    buf.push(' ');
                }
                buf.push_str(t);
            }
        }
    }
    if let Some(k) = key {
        out.insert(k, buf.trim().to_string());
    }
    out
}

/// YAML 매핑에서 문자열 값을 꺼낸다. 멀티라인 스칼라는 파서가 이미 한 줄로 접어 놨다.
pub fn yaml_str(v: &serde_yaml_ng::Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().map(|s| s.trim().to_string())
}

/// `references/*.md` 개수. 폴더가 없으면 0.
pub fn count_references(dir: &Path) -> usize {
    let refs = dir.join("references");
    let Ok(entries) = std::fs::read_dir(&refs) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
        .count()
}
