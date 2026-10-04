//! 마크다운을 줄 단위로 읽는 도구. 진단 여럿이 같은 걸 물어서 한 자리에 둔다.
//!
//! 파서를 들이지 않는 이유: 필요한 건 "이 줄이 코드 블록 안인가 · 표인가 · 제목인가"와
//! 백틱 조각뿐이고, 그건 줄 머리만 보면 정확히 갈린다. 설정 파일이 아니라 산문이라
//! 원칙 4(진짜 파서로)의 대상이 아니다.

/// 한 줄과 그 자리.
#[derive(Debug, Clone)]
pub struct Line<'a> {
    /// 1부터
    pub no: usize,
    pub text: &'a str,
    /// 코드 펜스(백틱 셋·물결 셋)로 감싼 블록 안
    pub in_code: bool,
}

impl Line<'_> {
    /// 표의 한 행(`| a | b |`)
    pub fn is_table(&self) -> bool {
        self.text.trim_start().starts_with('|')
    }
    /// 예시일 가능성이 큰 자리 — 코드 블록이나 표.
    pub fn is_example(&self) -> bool {
        self.in_code || self.is_table()
    }
    /// 제목이면 (수준, 제목)
    pub fn heading(&self) -> Option<(usize, &str)> {
        if self.in_code {
            return None;
        }
        let t = self.text.trim_start();
        let level = t.chars().take_while(|c| *c == '#').count();
        if level == 0 || level > 6 {
            return None;
        }
        let rest = &t[level..];
        rest.starts_with(' ').then(|| (level, rest.trim()))
    }
}

/// 코드 블록 여닫음을 따라가며 줄을 나눈다. 여는 줄·닫는 줄 자체도 `in_code` 다.
pub fn lines(text: &str) -> Vec<Line<'_>> {
    let mut out = vec![];
    let mut fence: Option<&str> = None;
    for (i, raw) in text.lines().enumerate() {
        let t = raw.trim_start();
        let mark = if t.starts_with("```") {
            Some("```")
        } else if t.starts_with("~~~") {
            Some("~~~")
        } else {
            None
        };
        match (fence, mark) {
            (None, Some(m)) => {
                fence = Some(m);
                out.push(Line {
                    no: i + 1,
                    text: raw,
                    in_code: true,
                });
            }
            (Some(f), Some(m)) if f == m => {
                fence = None;
                out.push(Line {
                    no: i + 1,
                    text: raw,
                    in_code: true,
                });
            }
            _ => out.push(Line {
                no: i + 1,
                text: raw,
                in_code: fence.is_some(),
            }),
        }
    }
    out
}

/// 한 줄의 백틱 조각들. 닫히지 않은 백틱은 버린다.
pub fn code_spans(line: &str) -> Vec<&str> {
    let mut out = vec![];
    let mut rest = line;
    while let Some(i) = rest.find('`') {
        let after = &rest[i..];
        let ticks = after.chars().take_while(|c| *c == '`').count();
        let body = &after[ticks..];
        let close = "`".repeat(ticks);
        let Some(j) = body.find(&close) else { break };
        let span = body[..j].trim();
        if !span.is_empty() {
            out.push(span);
        }
        rest = &body[j + ticks..];
    }
    out
}

/// 백틱 조각을 지운 줄. `@경로` 처럼 코드 안에서는 뜻이 없는 표기를 찾을 때 쓴다.
pub fn strip_code_spans(line: &str) -> String {
    let mut out = String::new();
    let mut rest = line;
    while let Some(i) = rest.find('`') {
        out.push_str(&rest[..i]);
        let after = &rest[i..];
        let ticks = after.chars().take_while(|c| *c == '`').count();
        let body = &after[ticks..];
        match body.find(&"`".repeat(ticks)) {
            Some(j) => rest = &body[j + ticks..],
            None => {
                rest = body;
            }
        }
    }
    out.push_str(rest);
    out
}

/// 섹션 하나 — 제목 줄부터 같은 수준 이상의 다음 제목 전까지.
#[derive(Debug, Clone)]
pub struct Section {
    pub line: usize,
    pub heading: String,
    pub body: String,
}

/// `##` 섹션들. `##` 가 하나도 없으면 `#` 로 내려간다 — 제목 하나짜리 파일에서
/// `#` 를 쓰면 파일 통째가 한 섹션이 되어 짚는 뜻이 없다.
pub fn sections(text: &str) -> Vec<Section> {
    let ls = lines(text);
    let level = if ls.iter().any(|l| l.heading().is_some_and(|(n, _)| n == 2)) {
        2
    } else {
        1
    };
    let mut out: Vec<Section> = vec![];
    let mut cur: Option<Section> = None;
    for l in &ls {
        if let Some((n, title)) = l.heading() {
            if n <= level {
                if let Some(s) = cur.take() {
                    out.push(s);
                }
                if n == level {
                    cur = Some(Section {
                        line: l.no,
                        heading: title.to_string(),
                        body: String::new(),
                    });
                }
                continue;
            }
        }
        if let Some(s) = cur.as_mut() {
            s.body.push_str(l.text);
            s.body.push('\n');
        }
    }
    out.extend(cur);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 코드_블록_안을_가른다() {
        let t = "a\n```sh\nmcp__x__y\n```\nb";
        let ls = lines(t);
        assert!(!ls[0].in_code && ls[2].in_code && !ls[4].in_code);
    }

    #[test]
    fn 백틱_조각을_뽑는다() {
        assert_eq!(
            code_spans("쓰지 마 `a/b.rs` 와 ``c`d``"),
            vec!["a/b.rs", "c`d"]
        );
        assert_eq!(strip_code_spans("x `@y` z"), "x  z");
    }

    #[test]
    fn 섹션은_둘째_수준으로_나눈다() {
        let s = sections("# T\n\n## A\na\n### a1\nx\n## B\nb\n");
        assert_eq!(s.len(), 2);
        assert_eq!((s[0].line, s[0].heading.as_str()), (3, "A"));
        assert!(s[0].body.contains("a1"), "하위 제목은 섹션 안에 남는다");
    }
}
