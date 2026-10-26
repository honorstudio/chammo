//! 계정 바꿔 끼우기가 돌던 세션을 안 끊게 — 2026-10-13 19:14 자동 전환 때 세션 여럿이
//! "Could not refresh your login because another Claude Code process is refreshing it" 로 멈췄다.
//!
//! 원인(Claude Code 2.1.296 을 읽어 확인): 칸에 보관한 토큰은 보관한 뒤 몇 시간이 지나 대개 만료돼 있다(사용량도 그래서 'expired').
//! 그대로 끼우면 돌던 세션이 다 같이 키체인이 바뀐 걸 보고, 만료된 토큰을 갱신하러 Claude Code 갱신 잠금(<설정 폴더>/.oauth_refresh.lock)에 몰린다.
//! 잠금을 못 잡은 세션은 1~2초씩 다섯 번 다시 해 보고, 그동안 잠금이 7.5초 넘게 안 움직이면 토큰이 만료된 세션은 그 오류로 턴을 끝낸다(부하가 높을수록 잘 난다).
//! 그래서 ① 끼울 칸 토큰이 곧 만료면 끼우기 전에 앱이 그 칸만 갱신한다 — 아무 세션도 안 쓰는 칸이라 엇갈릴 데가 없다
//! ② 바꿔 끼우는 동안엔 Claude Code 와 같은 잠금을 잡는다 — 세션이 지금 계정을 갱신하는 도중에 바꾸면 Claude Code 는 새 토큰을 버리고(키체인 값이
//!    바뀐 걸 보고 안 쓴다) 우리는 이미 써 버린 갱신 토큰을 칸에 보관하게 된다
use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

/// 끼울 칸 토큰을 미리 갱신하는 길 — 칸의 claudeAiOauth 를 받아 갱신된 claudeAiOauth 를 준다. 실제는 refresh(curl), 시험은 가짜
pub type Refresher = fn(&Value) -> Result<Value, String>;

/// 토큰(claudeAiOauth)의 주인 계정(accountUuid) — 모르면 None(망이 안 됨 등). 실제는 owner(curl), 시험은 가짜
pub type Owner = fn(&Value) -> Option<String>;

/// Claude Code 가 계정 정보를 묻는 주소 — 칸에 토큰을 넣기 전에 그 토큰이 정말 그 칸 계정 것인지 본다(2026-10-21 리뷰 ⑤-2)
pub const PROFILE_URL: &str = "https://api.anthropic.com/api/oauth/profile";

/// 토큰으로 주인 계정을 묻는다 — 토큰은 curl 의 stdin 헤더로만(accounts_usage 와 같게). 4초, 실패·모르는 모양이면 None
pub fn owner(o: &Value) -> Option<String> {
    let token = o.get("accessToken")?.as_str().filter(|t| !t.is_empty())?;
    let h = crate::accounts_usage::header_text(token)?;
    let mut c = crate::platform::command(crate::platform::curl());
    c.args(["-sS", "--max-time", "4", "-H", "@-", "-w", "\n%{http_code}", PROFILE_URL]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = c.spawn().ok()?;
    if let Some(mut si) = child.stdin.take() {
        let _ = si.write_all(h.as_bytes());
    }
    let out = child.wait_with_output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let (body, code) = text.rsplit_once('\n')?;
    (code.trim() == "200").then_some(())?;
    profile_owner(body)
}

/// 계정 정보 응답 → accountUuid
pub fn profile_owner(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    v["account"]["uuid"].as_str().filter(|u| !u.is_empty()).map(str::to_string)
}

/// Claude Code 와 같은 주소·앱 id(2.1.296 의 TOKEN_URL·CLIENT_ID)
pub const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
pub const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
/// 토큰 주소에 보내는 User-Agent — 이 앱 이름과 판, 저장소 주소. curl 기본 UA 로 보내면 토큰 주소가 429 로 거절한다
pub fn user_agent() -> String {
    format!("Chammo/{} (+https://github.com/honorstudio/chammo)", env!("CARGO_PKG_VERSION"))
}

/// 이만큼 안 남았으면 끼우기 전에 갱신한다 — Claude Code 는 5분 남으면 갱신하러 간다
pub const MARGIN_MS: i64 = 30 * 60_000;

/// Claude Code 갱신 잠금 이름 — 새 판은 설정 폴더 안 이것과 옛 이름(<설정 폴더 실제 경로>.lock)을 둘 다 잡는다
pub const LOCK_NAME: &str = ".oauth_refresh.lock";
/// 이보다 오래 안 움직인 잠금은 주인이 죽은 것 — Claude Code(proper-lockfile stale 60초)와 같다
const STALE: Duration = Duration::from_secs(60);
/// 쥐고 있는 동안 이만큼마다 잠금 시각을 고친다 — 기다리는 세션이 '주인이 살아 있다'로 보게(Claude Code 는 5초마다)
const TOUCH: Duration = Duration::from_secs(2);
#[cfg(not(test))]
const WAIT: Duration = Duration::from_secs(20);
#[cfg(test)]
const WAIT: Duration = Duration::from_millis(300);

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

// ── 미리 갱신 ─────────────────────────────────────────

/// 갱신해야 하나 — 만료 시각을 모르면(옛 칸) 안 건드린다(Claude Code 도 시각이 없으면 안 만료로 본다). 갱신 토큰이 없으면 못 한다
pub fn needs(o: &Value, now: i64) -> bool {
    let has_refresh = o.get("refreshToken").and_then(Value::as_str).is_some_and(|r| !r.is_empty());
    has_refresh && o.get("expiresAt").and_then(Value::as_i64).is_some_and(|e| e - now < MARGIN_MS)
}

/// 보낼 몸통 — 갱신 토큰은 여기에만(명령줄 인자엔 안 둔다)
pub fn body(o: &Value) -> Option<String> {
    let rt = o.get("refreshToken").and_then(Value::as_str).filter(|r| !r.is_empty())?;
    let client = o.get("clientId").and_then(Value::as_str).filter(|c| !c.is_empty()).unwrap_or(CLIENT_ID);
    let mut b = serde_json::json!({ "grant_type": "refresh_token", "refresh_token": rt, "client_id": client });
    let scopes: Vec<&str> = o.get("scopes").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    if !scopes.is_empty() {
        b["scope"] = scopes.join(" ").into();
    }
    Some(b.to_string())
}

/// 응답을 칸 값에 — 새 토큰·만료 시각만 바꾸고 나머지(요금제·clientId 등)는 그대로. 갱신 토큰이 안 왔으면 쓰던 것(Claude Code 와 같다)
pub fn apply(old: &Value, resp: &Value, now: i64) -> Option<Value> {
    let at = resp.get("access_token")?.as_str().filter(|t| !t.is_empty())?;
    // 만료 시간이 없거나 모양이 달라도 새 토큰은 받는다 — 서버가 갱신 토큰을 이미 돌렸으면 버리는 순간 그 칸이 죽는다(⑤-3). 모르면 1시간으로 보고 일찍 다시 갱신
    let secs = resp.get("expires_in").and_then(Value::as_i64).unwrap_or(3600);
    let mut n = old.clone();
    n["accessToken"] = at.into();
    n["expiresAt"] = (now + secs * 1000).into();
    if let Some(rt) = resp.get("refresh_token").and_then(Value::as_str).filter(|r| !r.is_empty()) {
        n["refreshToken"] = rt.into();
    }
    if let Some(s) = resp.get("refresh_token_expires_in").and_then(Value::as_i64) {
        n["refreshTokenExpiresAt"] = (now + s * 1000).into();
    }
    if let Some(sc) = resp.get("scope").and_then(Value::as_str) {
        n["scopes"] = sc.split_whitespace().collect::<Vec<_>>().into();
    }
    Some(n)
}

/// 실제 갱신 — curl(맥 기본·윈도우 System32)로, 몸통은 stdin 으로. 오류 글에 토큰은 안 넣는다. 시험 앱은 CHAMMO_ACCOUNT_TOKEN_URL 로 가짜 주소
pub fn refresh(o: &Value) -> Result<Value, String> {
    let b = body(o).ok_or("noRefreshToken")?;
    let url = std::env::var("CHAMMO_ACCOUNT_TOKEN_URL").ok().filter(|u| !u.is_empty()).unwrap_or_else(|| TOKEN_URL.into());
    let mut c = crate::platform::command(crate::platform::curl());
    let ua = format!("User-Agent: {}", user_agent());
    // 끝 줄 = 상태 코드 + 탭 + Retry-After 머리(curl 7.84+ %header, 맥 기본 8.x) — 429 면 언제 다시 할지
    c.args(["-sS", "--max-time", "20", "-X", "POST", "-H", "Content-Type: application/json", "-H", "Accept: application/json", "-H", &ua, "--data-binary", "@-", "-w", "\n%{http_code}\t%header{retry-after}", &url])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = c.spawn().map_err(|_| "curl".to_string())?;
    if let Some(mut si) = child.stdin.take() {
        let _ = si.write_all(b.as_bytes());
    }
    let out = child.wait_with_output().map_err(|_| "curl".to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let (resp, tail) = text.rsplit_once('\n').unwrap_or(("", ""));
    let (code, retry) = tail.split_once('\t').unwrap_or((tail, ""));
    outcome(code, retry)?;
    serde_json::from_str::<Value>(resp).ok().and_then(|r| apply(o, &r, now_ms())).ok_or_else(|| "badReply".into())
}

/// 상태 코드 → 오류 이름(200 은 Ok). 429 는 rate — Anthropic 쪽이 이 맥 요청을 잠깐 막은 것(가짜 갱신 토큰으로도 429, 2026-10-15)이라
/// 계정 문제가 아니다. Retry-After 가 초면 rate:<초>(날짜 꼴은 버린다)
pub fn outcome(code: &str, retry: &str) -> Result<(), String> {
    match code.trim() {
        "200" => Ok(()),
        // 갱신 토큰이 죽었다(로그아웃·다른 곳에서 다시 로그인) — 다시 담아야 한다
        "400" | "401" | "403" => Err("dead".into()),
        "429" => Err(retry.trim().parse::<u64>().map(|s| format!("rate:{s}")).unwrap_or_else(|_| "rate".into())),
        "" | "000" => Err("network".into()),
        c => Err(format!("http{c}")),
    }
}

// ── Claude Code 갱신 잠금 ─────────────────────────────

/// (새 잠금, 옛 잠금) — 옛 것은 설정 폴더 실제 경로 뒤에 ".lock" 을 붙인 형제
pub fn lock_paths(dir: &Path) -> (PathBuf, PathBuf) {
    let real = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    let mut legacy = real.into_os_string();
    legacy.push(".lock");
    (dir.join(LOCK_NAME), PathBuf::from(legacy))
}

fn stale(p: &Path) -> bool {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > STALE)
}

/// 잠금 하나 잡기 — proper-lockfile 와 같은 방식(폴더 만들기). 오래 안 움직인 잠금은 넘겨받는다
fn take(p: &Path) -> std::io::Result<bool> {
    match std::fs::create_dir(p) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            if !stale(p) {
                return Ok(false);
            }
            let _ = std::fs::remove_dir(p);
            Ok(std::fs::create_dir(p).is_ok())
        }
        Err(e) => Err(e),
    }
}

fn touch(p: &Path) {
    // 윈도우는 폴더를 File::open 으로 못 연다 — 폴더 열기 표시(FILE_FLAG_BACKUP_SEMANTICS)와 속성 쓰기 권한(FILE_WRITE_ATTRIBUTES)으로
    #[cfg(windows)]
    let f = {
        use std::os::windows::fs::OpenOptionsExt;
        std::fs::OpenOptions::new().access_mode(0x0100).custom_flags(0x0200_0000).open(p)
    };
    #[cfg(not(windows))]
    let f = std::fs::File::open(p);
    if let Ok(f) = f {
        let _ = f.set_modified(SystemTime::now());
    }
}

/// 쥔 잠금 — 놓으면(drop) 시각 고치기를 멈추고 두 잠금을 지운다
pub struct Held {
    paths: Vec<PathBuf>,
    stop: Arc<AtomicBool>,
    toucher: Option<std::thread::JoinHandle<()>>,
}

impl Drop for Held {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.toucher.take() {
            let _ = t.join();
        }
        for p in self.paths.iter().rev() {
            let _ = std::fs::remove_dir(p);
        }
    }
}

pub enum LockError {
    /// 세션이 갱신하는 중 — 잠시 뒤 다시
    Busy,
    Io(String),
}

/// Claude Code 갱신 잠금 둘을 잡는다. 남이 쥐고 있으면 WAIT 동안 기다리고, 그래도면 Busy
pub fn hold(dir: &Path) -> Result<Held, LockError> {
    std::fs::create_dir_all(dir).map_err(|e| LockError::Io(e.to_string()))?;
    let (new, legacy) = lock_paths(dir);
    let until = std::time::Instant::now() + WAIT;
    loop {
        if take(&new).map_err(|e| LockError::Io(e.to_string()))? {
            match take(&legacy) {
                Ok(true) => break,
                Ok(false) => {
                    let _ = std::fs::remove_dir(&new);
                }
                Err(e) => {
                    let _ = std::fs::remove_dir(&new);
                    return Err(LockError::Io(e.to_string()));
                }
            }
        }
        if std::time::Instant::now() >= until {
            return Err(LockError::Busy);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let stop = Arc::new(AtomicBool::new(false));
    let (s, ps) = (stop.clone(), vec![new.clone(), legacy.clone()]);
    let toucher = std::thread::spawn(move || {
        let mut last = std::time::Instant::now();
        while !s.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(50));
            if last.elapsed() >= TOUCH {
                ps.iter().for_each(|p| touch(p));
                last = std::time::Instant::now();
            }
        }
    });
    Ok(Held { paths: vec![new, legacy], stop, toucher: Some(toucher) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 곧_만료면_갱신_시각을_모르면_안_건드린다() {
        let now = 1_000_000_000;
        let o = |exp: Option<i64>, rt: &str| {
            let mut v = json!({ "accessToken": "a", "refreshToken": rt });
            if let Some(e) = exp {
                v["expiresAt"] = e.into();
            }
            v
        };
        assert!(needs(&o(Some(now - 1), "r"), now));
        assert!(needs(&o(Some(now + 29 * 60_000), "r"), now));
        assert!(!needs(&o(Some(now + 3 * 3600_000), "r"), now));
        assert!(!needs(&o(None, "r"), now));
        assert!(!needs(&o(Some(now - 1), ""), now)); // 갱신 토큰이 없으면 못 한다
    }

    #[test]
    fn 몸통엔_갱신_토큰_앱_id_범위() {
        let b: Value = serde_json::from_str(&body(&json!({ "refreshToken": "rt-x", "scopes": ["user:a", "user:b"] })).unwrap()).unwrap();
        assert_eq!(b, json!({ "grant_type": "refresh_token", "refresh_token": "rt-x", "client_id": CLIENT_ID, "scope": "user:a user:b" }));
        // 칸에 앱 id 가 있으면 그것, 범위가 없으면 안 보낸다
        let b: Value = serde_json::from_str(&body(&json!({ "refreshToken": "rt-x", "clientId": "c-9" })).unwrap()).unwrap();
        assert_eq!(b, json!({ "grant_type": "refresh_token", "refresh_token": "rt-x", "client_id": "c-9" }));
        assert_eq!(body(&json!({ "accessToken": "a" })), None);
    }

    #[test]
    fn 응답은_토큰_시각만_바꾸고_나머지는_그대로() {
        let old = json!({ "accessToken": "a1", "refreshToken": "r1", "expiresAt": 5, "scopes": ["user:a"], "subscriptionType": "max", "rateLimitTier": "t" });
        let n = apply(&old, &json!({ "access_token": "a2", "refresh_token": "r2", "expires_in": 3600, "scope": "user:a user:b" }), 1_000).unwrap();
        assert_eq!(n, json!({ "accessToken": "a2", "refreshToken": "r2", "expiresAt": 3_601_000, "scopes": ["user:a", "user:b"], "subscriptionType": "max", "rateLimitTier": "t" }));
        // 갱신 토큰이 안 오면 쓰던 것
        let n = apply(&old, &json!({ "access_token": "a2", "expires_in": 60 }), 0).unwrap();
        assert_eq!((n["refreshToken"].as_str(), n["expiresAt"].as_i64()), (Some("r1"), Some(60_000)));
        // 모양이 틀리면 없음
        assert_eq!(apply(&old, &json!({ "error": "invalid_grant" }), 0), None);
        assert_eq!(apply(&old, &json!({ "access_token": "", "expires_in": 60 }), 0), None);
    }

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-cclock-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn 잠금_둘을_잡고_놓으면_지운다() {
        let d = tmp("hold").join(".claude");
        let (new, legacy) = lock_paths(&{ std::fs::create_dir_all(&d).unwrap(); d.clone() });
        assert!(legacy.to_string_lossy().ends_with(".claude.lock"));
        {
            let _h = hold(&d).ok().expect("잡힌다");
            assert!(new.is_dir() && legacy.is_dir());
            // 쥔 동안 남은 못 잡는다
            assert!(matches!(hold(&d), Err(LockError::Busy)));
        }
        assert!(!new.exists() && !legacy.exists());
        let _ = std::fs::remove_dir_all(d.parent().unwrap());
    }

    #[test]
    fn 쥔_동안_잠금_시각을_고친다() {
        let d = tmp("touch").join(".claude");
        std::fs::create_dir_all(&d).unwrap();
        let (new, _) = lock_paths(&d);
        let h = hold(&d).ok().unwrap();
        let t0 = std::fs::metadata(&new).unwrap().modified().unwrap();
        std::thread::sleep(TOUCH + Duration::from_millis(400));
        let t1 = std::fs::metadata(&new).unwrap().modified().unwrap();
        drop(h);
        assert!(t1 > t0, "기다리는 Claude Code 세션이 주인이 죽었다고 보지 않게 시각이 움직여야 한다");
        let _ = std::fs::remove_dir_all(d.parent().unwrap());
    }

    #[test]
    fn 남이_쥔_잠금은_기다리고_오래된_잠금은_넘겨받는다() {
        let d = tmp("stale").join(".claude");
        std::fs::create_dir_all(&d).unwrap();
        let (new, legacy) = lock_paths(&d);
        // 새 잠금을 세션이 쥐고 있다
        std::fs::create_dir(&new).unwrap();
        assert!(matches!(hold(&d), Err(LockError::Busy)));
        // 옛 잠금만 쥐고 있어도(옛 판 Claude Code) 기다린다 — 그새 잡았던 새 잠금은 돌려놓는다
        std::fs::remove_dir(&new).unwrap();
        std::fs::create_dir(&legacy).unwrap();
        assert!(matches!(hold(&d), Err(LockError::Busy)));
        assert!(!new.exists());
        // 2분 동안 안 움직인 잠금은 주인이 죽은 것
        let old = SystemTime::now() - Duration::from_secs(120);
        std::fs::File::open(&legacy).unwrap().set_modified(old).unwrap();
        let h = hold(&d).ok().expect("오래된 잠금은 넘겨받는다");
        drop(h);
        assert!(!legacy.exists());
        let _ = std::fs::remove_dir_all(d.parent().unwrap());
    }

    /// 가짜 토큰 주소를 env 로 주는 시험끼리 겹치지 않게
    static URL_ENV: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// 가짜 토큰 주소 — 받은 요청 수만큼 정해 둔 답(상태 줄·머리)을 하나씩. 실제 토큰 주소는 부르지 않는다
    fn fake_token_server(replies: Vec<&'static str>) -> String {
        use std::io::{Read, Write as _};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://127.0.0.1:{}/v1/oauth/token", l.local_addr().unwrap().port());
        std::thread::spawn(move || {
            for (mut s, head) in l.incoming().flatten().zip(replies) {
                let mut buf = [0u8; 4096];
                let _ = s.read(&mut buf);
                let body = r#"{"type":"error","error":{"type":"rate_limit_error","message":"Rate limited"}}"#;
                let _ = write!(s, "{head}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        url
    }

    #[test]
    fn 갱신이_429면_rate_와_쉴_초() {
        // 2026-10-15 17:0x 실제 — platform.claude.com 이 이 맥 IP 를 잠깐 막아(rate_limit_error) 'http429' 로 떴다. 계정 문제가 아니다
        let url = fake_token_server(vec!["HTTP/1.1 429 Too Many Requests\r\nRetry-After: 600", "HTTP/1.1 429 Too Many Requests", "HTTP/1.1 429 Too Many Requests\r\nRetry-After: Wed, 21 Oct 2026 07:28:00 GMT", "HTTP/1.1 503 Service Unavailable"]);
        let _g = URL_ENV.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("CHAMMO_ACCOUNT_TOKEN_URL", &url);
        let o = json!({ "accessToken": "a", "refreshToken": "r-가짜", "expiresAt": 0 });
        assert_eq!(refresh(&o), Err("rate:600".to_string()), "Retry-After 초를 같이");
        assert_eq!(refresh(&o), Err("rate".to_string()), "머리가 없으면 rate 만");
        assert_eq!(refresh(&o), Err("rate".to_string()), "날짜 꼴 Retry-After 는 버린다");
        assert_eq!(refresh(&o), Err("http503".to_string()), "다른 실패는 그대로");
        std::env::remove_var("CHAMMO_ACCOUNT_TOKEN_URL");
    }

    #[test]
    fn 토큰_주소엔_앱_ua_로_보낸다() {
        // curl 기본 UA 가 아니라 이 앱 UA·Accept 머리로 보낸다
        use std::io::{Read, Write as _};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://127.0.0.1:{}/v1/oauth/token", l.local_addr().unwrap().port());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            if let Some(mut s) = l.incoming().flatten().next() {
                let mut buf = [0u8; 8192];
                let n = s.read(&mut buf).unwrap_or(0);
                let _ = tx.send(String::from_utf8_lossy(&buf[..n]).to_lowercase());
                let _ = write!(s, "HTTP/1.1 400 Bad Request\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}");
            }
        });
        let _g = URL_ENV.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("CHAMMO_ACCOUNT_TOKEN_URL", &url);
        let got = refresh(&json!({ "accessToken": "a", "refreshToken": "r-가짜", "expiresAt": 0 }));
        std::env::remove_var("CHAMMO_ACCOUNT_TOKEN_URL");
        assert_eq!(got, Err("dead".to_string()));
        let head = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(head.contains(&format!("\r\nuser-agent: {}\r\n", user_agent().to_lowercase())), "{head}");
        assert!(head.contains("\r\naccept: application/json\r\n"), "{head}");
        assert!(!head.contains("user-agent: curl"), "{head}");
    }

    #[test]
    fn ua_는_이_앱_이름과_판() {
        assert_eq!(user_agent(), format!("Chammo/{} (+https://github.com/honorstudio/chammo)", env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn 갱신_답_꼬리_읽기() {
        assert_eq!(outcome("429", "600"), Err("rate:600".to_string()));
        assert_eq!(outcome("429", " 30 "), Err("rate:30".to_string()));
        assert_eq!(outcome("429", ""), Err("rate".to_string()));
        assert_eq!(outcome("429", "-5"), Err("rate".to_string()));
        assert_eq!(outcome("401", ""), Err("dead".to_string()));
        assert_eq!(outcome("000", ""), Err("network".to_string()));
        assert_eq!(outcome("502", ""), Err("http502".to_string()));
    }
}
