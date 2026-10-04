//! 계정 사용량을 계정 토큰으로 바로 묻는다 — Claude Code 의 /usage 와 같은 주소(GET {base}/api/oauth/usage).
//! 상태줄 값은 세션마다 쥔 토큰이 달라 어느 계정 것인지 추정해야 했고, 계정을 바꿔도 어느 세션이든 대화가 한 번 오가야 바뀌었다(2026-10-02).
//! 이건 칸마다 주인이 확실하다. 토큰은 키체인에서 꺼내 curl 의 stdin 헤더로만 넘긴다(명령줄 인자는 ps 에 보인다) — 화면·로그·파일엔 퍼센트·시각만.
//! 토큰이 만료됐으면 갱신(refresh)하지 않는다 — 갱신하면 토큰이 돌아가 세션 쪽과 엇갈릴 수 있다. 그 칸은 마지막 값을 그대로 둔다
use crate::accounts_store::Secret;
use serde::Serialize;
use std::io::Write;
use std::process::Stdio;

pub const DEFAULT_URL: &str = "https://api.anthropic.com/api/oauth/usage";

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Win {
    pub used: f64,
    /// ms
    pub resets_at: i64,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Got {
    /// "live" = 지금 로그인 칸, 아니면 보관 칸 id
    pub who: String,
    /// ok · expired(토큰 만료 — 안 물음) · noToken · rate(429) · auth(401·403) · fail
    pub status: String,
    pub five: Option<Win>,
    pub week: Option<Win>,
}

/// 로그인 덩어리(또는 칸 값)에서 계정 토큰과 만료 시각(ms)
pub fn token_of(s: &Secret) -> Option<(String, i64)> {
    let v: serde_json::Value = serde_json::from_str(s.expose()).ok()?;
    let o = v.get("claudeAiOauth")?;
    let t = o.get("accessToken")?.as_str()?.to_string();
    Some((t, o.get("expiresAt").and_then(|x| x.as_i64()).unwrap_or(0)))
}

/// curl 에 stdin 으로 넘길 헤더 — 토큰은 여기에만
pub fn header_text(token: &str) -> Option<String> {
    if token.is_empty() || token.contains(['\r', '\n']) {
        return None;
    }
    Some(format!("Authorization: Bearer {token}\nanthropic-beta: oauth-2025-04-20\nContent-Type: application/json\nUser-Agent: chammo\n"))
}

/// ISO 시각 → ms. "2026-10-02T13:19:59.636524+00:00" 같은 모양(Z 도). 표준 라이브러리로만 — 날짜 크레이트 안 들인다
pub fn iso_ms(s: &str) -> Option<i64> {
    let (date, rest) = s.split_once('T')?;
    let mut d = date.split('-').map(|x| x.parse::<i64>().ok());
    let (y, mo, da) = (d.next()??, d.next()??, d.next()??);
    let (time, off) = if let Some(t) = rest.strip_suffix('Z') {
        (t, 0)
    } else {
        let i = rest.rfind(['+', '-'])?;
        let (t, o) = rest.split_at(i);
        let sign = if o.starts_with('-') { -1 } else { 1 };
        let mut hm = o[1..].split(':').map(|x| x.parse::<i64>().ok());
        (t, sign * (hm.next()?? * 60 + hm.next().flatten().unwrap_or(0)))
    };
    let mut t = time.split(':');
    let (h, mi) = (t.next()?.parse::<i64>().ok()?, t.next()?.parse::<i64>().ok()?);
    let sec: f64 = t.next().unwrap_or("0").parse().ok()?;
    // 그레고리력 날짜 → 1970-01-01 부터 날 수(Howard Hinnant days_from_civil)
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let doy = (153 * (mo + if mo > 2 { -3 } else { 9 }) + 2) / 5 + da - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(((days * 86400 + h * 3600 + mi * 60 - off * 60) * 1000) as i64 + (sec * 1000.0).round() as i64)
}

/// 응답 → 5시간·주간
pub fn parse(body: &str) -> Option<(Option<Win>, Option<Win>)> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let one = |k: &str| -> Option<Win> {
        let o = v.get(k)?;
        Some(Win { used: o.get("utilization")?.as_f64()?, resets_at: iso_ms(o.get("resets_at")?.as_str()?)? })
    };
    Some((one("five_hour"), one("seven_day")))
}

/// curl 인자 — 토큰은 여기 없다(-H @- = 헤더를 stdin 에서)
pub fn curl_args(url: &str) -> Vec<String> {
    ["-sS", "--max-time", "8", "-H", "@-", "-w", "\n%{http_code}", url].map(String::from).to_vec()
}

/// 한 번 묻기 — curl(macOS 기본)로. 토큰은 stdin 헤더로만
pub fn fetch(url: &str, token: &str) -> (String, Option<Win>, Option<Win>) {
    let Some(h) = header_text(token) else { return ("noToken".into(), None, None) };
    let mut c = crate::platform::command("/usr/bin/curl");
    c.args(curl_args(url)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    let Ok(mut child) = c.spawn() else { return ("fail".into(), None, None) };
    if let Some(mut si) = child.stdin.take() {
        let _ = si.write_all(h.as_bytes());
    }
    let Ok(out) = child.wait_with_output() else { return ("fail".into(), None, None) };
    let text = String::from_utf8_lossy(&out.stdout);
    let (body, code) = text.rsplit_once('\n').unwrap_or(("", ""));
    match code.trim() {
        "200" => match parse(body) {
            Some((f, w)) => ("ok".into(), f, w),
            None => ("fail".into(), None, None),
        },
        "429" => ("rate".into(), None, None),
        "401" | "403" => ("auth".into(), None, None),
        _ => ("fail".into(), None, None),
    }
}

/// 토큰이 있고 아직 안 만료됐으면 묻는다(만료 1분 전부터는 안 물음 — 갱신은 Claude Code 몫)
pub fn ask(who: &str, secret: Option<&Secret>, now_ms: i64, url: &str, fetch: impl Fn(&str, &str) -> (String, Option<Win>, Option<Win>)) -> Got {
    let got = |status: &str, five, week| Got { who: who.into(), status: status.into(), five, week };
    let Some((token, exp)) = secret.and_then(token_of) else { return got("noToken", None, None) };
    if exp != 0 && exp <= now_ms + 60_000 {
        return got("expired", None, None);
    }
    let (status, five, week) = fetch(url, &token);
    got(&status, five, week)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_시각() {
        assert_eq!(iso_ms("1970-01-01T00:00:00Z"), Some(0));
        // 실측 응답 모양 — 상태줄의 1790947200 초(22:20 KST)와 반올림해서 같다
        assert_eq!(iso_ms("2026-10-02T13:19:59.636524+00:00"), Some(1_790_947_199_637));
        assert_eq!(iso_ms("2026-10-08T06:59:59.636543+00:00").map(|x| (x as f64 / 60_000.0).round() as i64 * 60), Some(1_791_442_800));
        assert_eq!(iso_ms("2026-10-02T22:20:00+09:00"), Some(1_790_947_200_000));
        assert_eq!(iso_ms("2024-02-29T00:00:00Z"), Some(1_709_164_800_000));
        assert_eq!(iso_ms("깨짐"), None);
    }

    #[test]
    fn 응답_읽기() {
        let body = r#"{"five_hour":{"utilization":42.0,"resets_at":"2026-10-02T13:19:59.636524+00:00","limit_dollars":null},"seven_day":{"utilization":6.0,"resets_at":"2026-10-08T06:59:59.636543+00:00"},"seven_day_opus":null}"#;
        let (f, w) = parse(body).unwrap();
        assert_eq!(f.unwrap().used, 42.0);
        assert_eq!(w.unwrap().used, 6.0);
        assert_eq!(parse(r#"{"five_hour":null}"#), Some((None, None)));
        assert_eq!(parse("<html>"), None);
    }

    #[test]
    fn 토큰은_헤더_글에만_줄바꿈은_거절() {
        let h = header_text("tok-1").unwrap();
        assert!(h.starts_with("Authorization: Bearer tok-1\n"));
        assert!(header_text("a\nX-Evil: 1").is_none());
        assert!(header_text("").is_none());
    }

    #[test]
    fn 만료된_토큰은_묻지_않는다() {
        let s = |exp: i64| Secret::new(format!(r#"{{"claudeAiOauth":{{"accessToken":"t","expiresAt":{exp}}},"mcpOAuth":{{}}}}"#));
        let never = |_: &str, _: &str| -> (String, Option<Win>, Option<Win>) { panic!("물으면 안 된다") };
        assert_eq!(ask("a1", Some(&s(1_000)), 10_000, DEFAULT_URL, never).status, "expired");
        assert_eq!(ask("a1", Some(&s(70_000)), 10_000, DEFAULT_URL, never).status, "expired"); // 1분 안쪽
        assert_eq!(ask("a1", None, 10_000, DEFAULT_URL, never).status, "noToken");
        let ok = |_: &str, t: &str| -> (String, Option<Win>, Option<Win>) {
            assert_eq!(t, "t");
            ("ok".into(), Some(Win { used: 1.0, resets_at: 5 }), None)
        };
        let g = ask("live", Some(&s(10_000_000)), 10_000, DEFAULT_URL, ok);
        assert_eq!((g.who.as_str(), g.status.as_str(), g.five.map(|f| f.used)), ("live", "ok", Some(1.0)));
        // 결과에 토큰이 안 실린다
        assert!(!serde_json::to_string(&ask("live", Some(&s(10_000_000)), 10_000, DEFAULT_URL, ok)).unwrap().contains("\"t\""));
    }

    #[test]
    fn curl_인자엔_토큰이_없다() {
        let a = curl_args(DEFAULT_URL);
        assert!(a.contains(&"@-".to_string()));
        assert!(!a.iter().any(|x| x.contains("Bearer")));
    }
}

#[cfg(test)]
mod probe {
    /// 실제 확인 — CHAMMO_USAGE_PROBE=1 일 때만. 지금 로그인 칸을 security 로 읽기만 하고(쓰기 없음) 사용량 주소를 한 번 부른다. 퍼센트·상태만 찍는다
    #[cfg(target_os = "macos")]
    #[test]
    fn 지금_로그인_사용량_한_번() {
        if std::env::var("CHAMMO_USAGE_PROBE").as_deref() != Ok("1") {
            return;
        }
        use crate::accounts_store::{Keychain, Store};
        let kc = Keychain { path: None, unlock: None, quiet: true, cli_service: Some("Claude Code-credentials".into()) };
        let acct = kc.account_of("Claude Code-credentials").unwrap();
        let s = kc.get("Claude Code-credentials", &acct).unwrap();
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
        let g = super::ask("live", s.as_ref(), now, super::DEFAULT_URL, super::fetch);
        eprintln!("상태 {} · 5시간 {:?}% · 주간 {:?}%", g.status, g.five.as_ref().map(|f| f.used), g.week.as_ref().map(|w| w.used));
        assert_eq!(g.status, "ok");
    }
}
