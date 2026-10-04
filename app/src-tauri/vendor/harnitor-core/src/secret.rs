//! 시크릿 가리기.
//!
//! 하네스 파일에는 API 키가 평문으로 들어 있다(실측: `~/.claude/.mcp.json`의 context7 키).
//! 스캔 결과는 화면·JSON·리포트로 나가므로 **원문이 실려서는 안 된다**.
//!
//! 두 방향으로 다 틀릴 수 있고 둘 다 나쁘다:
//! - **덜 가리면** 비밀이 샌다. 한 군데라도 새면 나머지를 가린 의미가 없다
//! - **더 가리면** 멀쩡한 설정이 감춰져, 사용자가 자기 하네스를 못 읽는다
//!
//! 그래서 "비밀처럼 보이는 낱말"만으로 판단하지 않고 **자리(flag인가, URL인가)** 를 함께 본다.

/// 이 낱말이 플래그 이름에 들어가면 그 값은 비밀로 본다.
const KEYWORDS: [&str; 6] = ["key", "token", "secret", "password", "passwd", "credential"];

/// `--api-key`처럼 값을 받는 플래그인가. 낱말만 보고 판단하지 않기 위한 조건이다.
/// (`keyring-helper`는 이름에 key가 들었지만 플래그가 아니다)
fn is_flag(s: &str) -> bool {
    s.starts_with('-')
}

fn looks_secretish(name: &str) -> bool {
    let lower = name.to_lowercase();
    KEYWORDS.iter().any(|k| lower.contains(k))
}

/// 값의 앞뒤 일부만 남기고 가운데를 가린다.
fn mask(value: &str) -> String {
    let n = value.chars().count();
    if n <= 8 {
        return "…".repeat(3);
    }
    let head: String = value.chars().take(4).collect();
    let tail: String = value.chars().skip(n - 2).collect();
    format!("{head}…{tail}")
}

/// 경로 한 조각이 토큰처럼 생겼는가.
/// 일반 경로(`mcp`, `api`, `v1`)는 짧고, 토큰은 길며 문자와 숫자가 섞인다.
fn looks_like_token(seg: &str) -> bool {
    seg.len() >= 20
        && seg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && seg.chars().any(|c| c.is_ascii_digit())
        && seg.chars().any(|c| c.is_ascii_alphabetic())
}

/// URL에서 비밀을 가린다. 쿼리 파라미터와 **경로에 박힌 토큰** 둘 다 본다.
pub fn mask_url(url: &str) -> String {
    let (base, query) = match url.split_once('?') {
        Some((b, q)) => (b, Some(q)),
        None => (url, None),
    };

    // 경로형 토큰: `https://host/sse/<토큰>`
    let base: String = base
        .split('/')
        .map(|seg| {
            if looks_like_token(seg) {
                mask(seg)
            } else {
                seg.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("/");

    let Some(query) = query else { return base };
    let masked: Vec<String> = query
        .split('&')
        .map(|pair| match pair.split_once('=') {
            Some((k, v)) if looks_secretish(k) && !v.is_empty() => format!("{k}={}", mask(v)),
            _ => pair.to_string(),
        })
        .collect();
    format!("{base}?{}", masked.join("&"))
}

/// 명령줄 인자에서 비밀을 가린다.
///
/// 세 가지 자리를 본다:
/// 1. 앞선 인자가 `--api-key` 같은 플래그였으면 이 인자가 값이다
/// 2. `--api-key=VALUE` 형태
/// 3. 인자 자체가 URL이면 URL 규칙으로 (쿼리 파라미터가 둘 이상이어도 새지 않게)
pub fn mask_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut mask_next = false;
    for a in args {
        if mask_next {
            out.push(mask(a));
            mask_next = false;
            continue;
        }
        if a.starts_with("http://") || a.starts_with("https://") {
            out.push(mask_url(a));
            continue;
        }
        match a.split_once('=') {
            Some((k, v)) if is_flag(k) && looks_secretish(k) && !v.is_empty() => {
                out.push(format!("{k}={}", mask(v)));
            }
            _ => {
                if is_flag(a) && looks_secretish(a) {
                    mask_next = true;
                }
                // 이름 자체는 남긴다 — 무엇이 설정돼 있었는지는 알아야 하니까
                out.push(a.clone());
            }
        }
    }
    out
}

/// 실제 서비스 키가 쓰는 접두어. 본문에 이런 토큰이 그대로 있으면 가린다.
const PREFIXES: [&str; 9] = [
    "sk-",
    "sk_",
    "ghp_",
    "gho_",
    "github_pat_",
    "AIza",
    "xoxb-",
    "xoxp-",
    "ctx7sk-",
];

/// 파일 **본문**에서 비밀을 가린다.
///
/// 인자·URL과 달리 본문은 자유 텍스트라 자리로 판단할 수 없다. 그래서 두 가지만 본다:
/// 1. 알려진 접두어로 시작하는 긴 토큰 (`sk-…`, `ghp_…`)
/// 2. `키: 값` / `키=값` 꼴에서 키가 비밀스러운 이름일 때의 값
///
/// 놓치는 게 있을 수 있다. 그래서 이건 **마지막 방어선이지 유일한 방어선이 아니다** —
/// `CLAUDE.local.md`처럼 비밀을 담으라고 만든 파일은 아예 읽지 않는다.
pub fn mask_text(text: &str) -> String {
    text.lines().map(mask_line).collect::<Vec<_>>().join("\n")
}

fn mask_line(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut token = String::new();
    let mut prev_key_is_secret = false;

    let flush = |token: &mut String, out: &mut String, secret_value: bool| {
        if token.is_empty() {
            return;
        }
        let looks_like_key = PREFIXES.iter().any(|p| token.starts_with(p)) && token.len() >= 12;
        if looks_like_key || (secret_value && token.len() >= 8) {
            out.push_str(&mask(token));
        } else {
            out.push_str(token);
        }
        token.clear();
    };

    for c in line.chars() {
        if c.is_whitespace() || matches!(c, '"' | '\'' | ',' | '(' | ')' | '[' | ']' | '`') {
            flush(&mut token, &mut out, prev_key_is_secret);
            prev_key_is_secret = false;
            out.push(c);
        } else if matches!(c, ':' | '=') {
            let is_secret_key = looks_secretish(&token);
            flush(&mut token, &mut out, false);
            out.push(c);
            prev_key_is_secret = is_secret_key;
        } else {
            token.push(c);
        }
    }
    flush(&mut token, &mut out, prev_key_is_secret);
    out
}
