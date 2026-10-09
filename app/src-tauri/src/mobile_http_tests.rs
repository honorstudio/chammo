use super::*;
use std::sync::{Arc, Mutex};

/// 짝지은 시험 기기의 토큰
const KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
/// 기기 쿠키 이름(포트 들어감)
const CK: &str = "chammo_m_47123";
const HOST: &str = "100.100.10.1:47123";
const HQ: &str = "/Users/me/hq";
const SID: &str = "f00d0002-0000-4000-8000-004027383810";

#[derive(Default)]
struct Fake {
    calls: Mutex<Vec<String>>,
    /// show.jsonl 꼬리로 돌려줄 글
    show: String,
    data: PathBuf,
    /// 작업 기록 크기(큰 응답 시험) · 세션 목록이 걸리는 시간(느린 맥 쪽 일 시험)
    big: usize,
    slow: Duration,
    /// 비서 세션(aaaa0001)의 (state, status) — 비우면 일하는 중("working", "busy"). 멈춤 시험
    hq: Option<(&'static str, &'static str)>,
    /// 글 치기가 실패한다(attach 못 붙음)
    send_fail: bool,
    /// 예약 목록 스크립트가 실패한다
    routines_fail: bool,
    /// 계정 바꾸기가 이 오류 이름으로 실패한다(키체인 잠김 등)
    account_fail: Option<&'static str>,
    /// 꺼져 있던 '참모-3 · 나스'(OFF)가 그사이 다른 길(데스크톱 ▷ 등)로 이미 켜졌다
    revived: bool,
    /// 작업 기록(tasks.jsonl) 원문 — 비우면 "{}"
    task_log: String,
}

impl Fake {
    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
    fn log(&self, s: String) {
        self.calls.lock().unwrap().push(s);
    }
}

impl Backend for Fake {
    fn direct_log(&self) -> String {
        self.log("direct_log".into());
        "LOG".into()
    }
    fn direct_answer(&self, id: &str, pick: &crate::direct::Pick) -> Result<(), String> {
        self.log(format!("direct_answer {id} {pick:?}"));
        Ok(())
    }
    fn env(&self) -> serde_json::Value {
        serde_json::json!({ "assistantName": "참모" })
    }
    fn sessions(&self) -> Result<String, String> {
        if !self.slow.is_zero() {
            std::thread::sleep(self.slow);
        }
        Ok(format!(
            r#"[{{"id":"aaaa0001","cwd":"{HQ}","name":"참모-1","state":"{}","status":"{}"}},{{"id":"bbbb0002","cwd":"/Users/me/dev/shop","name":"shop","state":"working","status":"busy"}}]"#,
            self.hq.unwrap_or(("working", "busy")).0,
            self.hq.unwrap_or(("working", "busy")).1
        ))
        .map(|j| if self.revived { j.replacen('[', &format!(r#"[{{"id":"aaaa0002","sessionId":"{OFF}","cwd":"{HQ}","name":"참모-3 · 나스","state":"working","status":"busy"}},"#), 1) } else { j })
    }
    fn hq_dir(&self) -> String {
        HQ.into()
    }
    fn transcript(&self, session_id: &str, from: Option<u64>) -> serde_json::Value {
        self.log(format!("transcript {session_id} {from:?}"));
        serde_json::json!({ "text": "", "next": 0, "reset": true })
    }
    fn transcript_before(&self, session_id: &str, before: u64) -> serde_json::Value {
        self.log(format!("before {session_id} {before}"));
        serde_json::json!({ "text": "", "start": 0 })
    }
    fn tasks(&self) -> String {
        if self.big > 0 { "x".repeat(self.big) } else if !self.task_log.is_empty() { self.task_log.clone() } else { "{}\n".into() }
    }
    fn append_task(&self, line: &str) -> Result<(), String> {
        self.log(format!("append_task {line}"));
        Ok(())
    }
    fn routines(&self) -> Result<String, String> {
        if self.routines_fail { Err("python3: No such file or directory".into()) } else { Ok(r#"[{"name":"daily-check"}]"#.into()) }
    }
    fn usage(&self) -> String {
        "{}".into()
    }
    fn send(&self, id: &str, text: &str) -> Result<(), String> {
        self.log(format!("send {id} {text}"));
        if self.send_fail { Err("attach failed".into()) } else { Ok(()) }
    }
    fn stop(&self, id: &str) -> Result<String, String> {
        self.log(format!("stop {id}"));
        Ok(String::new())
    }
    fn save_curation(&self, path: &str, text: &str, store: &str) -> Result<(), String> {
        self.log(format!("curation {path} {text} {store}"));
        Ok(())
    }
    fn read_curation_state(&self, path: &str) -> String {
        self.log(format!("curation-state {path}"));
        r#"{"marks":{"a":"pick"}}"#.into()
    }
    fn doc_html(&self, path: &Path) -> Option<String> {
        self.log(format!("doc_html {}", path.extension()?.to_string_lossy()));
        Some("<p>워드 글</p>".into())
    }
    fn open_on_mac(&self, path: &str) -> Result<(), String> {
        self.log(format!("open {path}"));
        Ok(())
    }
    fn diag(&self, line: &str) {
        self.log(format!("diag {line}"));
    }
    fn remove(&self, id: &str) -> Result<String, String> {
        self.log(format!("remove {id}"));
        Ok(String::new())
    }
    fn rename(&self, id: &str, nick: &str) -> Result<(), String> {
        self.log(format!("rename {id} {nick}"));
        Ok(())
    }
    fn interrupt(&self, id: &str) -> Result<(), String> {
        self.log(format!("interrupt {id}"));
        Ok(())
    }
    fn routine(&self, name: &str, action: &str) -> Result<String, String> {
        self.log(format!("routine {name} {action}"));
        Ok(String::new())
    }
    fn asset(&self, path: &str) -> Option<(Vec<u8>, String)> {
        self.log(format!("asset {path}"));
        (path == "mobile.html" || path == "assets/app-1.js" || path == "sw.js" || path == "manifest.webmanifest").then(|| (b"x".to_vec(), "text/html".into()))
    }
    fn show_log(&self) -> String {
        self.show.clone()
    }
    fn data_dir(&self) -> PathBuf {
        // 안 정했으면 임시 폴더 — 빈 경로면 쓰는 길(새 참모 맡은 일 등)이 cargo test 폴더에 파일을 남긴다
        if self.data.as_os_str().is_empty() {
            return std::env::temp_dir().join(format!("chammo-mhttp-default-{}", std::process::id()));
        }
        self.data.clone()
    }
    fn ctx_files(&self) -> Vec<String> {
        vec![format!(r#"{{"sessionId":"{SID}","used":73,"ts":1}}"#), "깨진".into()]
    }
    fn attach(&self, ext: &str, bytes: &[u8]) -> Result<String, String> {
        self.log(format!("attach {ext} {}", bytes.len()));
        Ok(format!("/data/attach/1-phone.{ext}"))
    }
    fn avatars(&self) -> serde_json::Value {
        serde_json::json!([{ "key": "참모-2", "avatar": { "kind": "preset", "shape": "blob", "eyes": "pill", "color": "#2f74e0" }, "v": 1 }])
    }
    fn avatar_image(&self, key: &str) -> Option<(Vec<u8>, &'static str)> {
        self.log(format!("avatar_image {key}"));
        (key == "참모-3").then(|| (b"\x89PNG\r\n\x1a\n".to_vec(), "image/png"))
    }
    fn ql_thumb(&self, path: &Path, size: u32) -> Option<Vec<u8>> {
        self.log(format!("ql {} {size}", path.extension()?.to_string_lossy()));
        Some(b"\xFF\xD8\xFFql".to_vec())
    }
    fn jpeg(&self, path: &Path, max: Option<u32>) -> Option<Vec<u8>> {
        self.log(format!("jpeg {} {max:?}", path.file_name()?.to_string_lossy()));
        Some(b"\xFF\xD8\xFFjpeg".to_vec())
    }
    fn sessions_all(&self) -> Result<String, String> {
        let off = if self.revived { "working" } else { "stopped" };
        Ok(format!(
            r#"[{{"id":"aaaa0001","cwd":"{HQ}","name":"참모-1","state":"working"}},
               {{"id":"aaaa0002","sessionId":"{OFF}","cwd":"{HQ}","name":"참모-3 · 나스","state":"{off}"}},
               {{"id":"bbbb0003","sessionId":"{SID}","cwd":"/Users/me/dev/shop","name":"shop","state":"stopped"}}]"#
        ))
    }
    fn resume(&self, cwd: &str, session_id: &str, id: &str) -> Result<String, String> {
        self.log(format!("resume {cwd} {session_id} {id}"));
        Ok("respawned".into())
    }
    fn spawn(&self, cwd: &str, name: &str) -> Result<String, String> {
        self.log(format!("spawn {cwd} {name}"));
        Ok("backgrounded · cccc0001".into())
    }
    fn tails(&self, ids: &[String]) -> serde_json::Value {
        self.log(format!("tails {}", ids.join(",")));
        serde_json::json!({})
    }
    fn browser_lives(&self) -> serde_json::Value {
        serde_json::json!([{ "profile": "shop-m", "sessionPid": 4242, "url": "https://a.test", "title": "A", "tabs": [], "tool": "click", "toolAt": 1, "busy": true, "ts": 1 }])
    }
    fn push_key(&self) -> Result<String, String> {
        Ok("BPUB".into())
    }
    fn browser_takeover(&self, profile: &str, session_pid: i32, on: bool) -> Result<(), String> {
        self.log(format!("take {profile} {session_pid} {on}"));
        Ok(())
    }
    fn browser_input(&self, profile: &str, session_pid: i32, events: Vec<crate::agent_input::InputEv>) -> Result<(), String> {
        self.log(format!("input {profile} {session_pid} {}", events.len()));
        Ok(())
    }
    fn browser_retry(&self, profile: &str) {
        self.log(format!("retry {profile}"));
    }
    fn push_subscribe(&self, device: &str, endpoint: &str, p256dh: &str, auth: &str) -> Result<(), String> {
        self.log(format!("sub {device} {endpoint} {p256dh} {auth}"));
        Ok(())
    }
    fn push_unsubscribe(&self, device: &str, endpoint: &str) -> Result<(), String> {
        self.log(format!("unsub {device} {endpoint}"));
        Ok(())
    }
    fn accounts(&self) -> Result<serde_json::Value, String> {
        self.log("accounts".into());
        Ok(serde_json::json!({ "accounts": [{ "id": "a1", "name": "큰 것", "plan": "Max 20x" }], "active": "a1", "auto": { "on": true, "slots": {} } }))
    }
    fn account_switch(&self, id: &str) -> Result<serde_json::Value, String> {
        self.log(format!("account_switch {id}"));
        match self.account_fail {
            Some(e) => Err(e.into()),
            None => Ok(serde_json::json!({ "active": id })),
        }
    }
    fn account_auto(&self, on: bool) -> Result<serde_json::Value, String> {
        self.log(format!("account_auto {on}"));
        Ok(serde_json::json!({ "auto": { "on": on } }))
    }
    fn login_view(&self) -> serde_json::Value {
        self.log("login_view".into());
        serde_json::json!({ "need": { "since": 1, "sessions": ["imac"], "machine": false }, "flow": { "state": "idle" } })
    }
    fn login_start(&self) -> Result<serde_json::Value, String> {
        self.log("login_start".into());
        Ok(serde_json::json!({ "state": "waiting", "url": "https://claude.com/cai/oauth/authorize?code=true" }))
    }
    fn login_code(&self, code: &str) -> Result<serde_json::Value, String> {
        // 코드 값은 기록하지 않는다 — 길이만
        self.log(format!("login_code {}", code.len()));
        Ok(serde_json::json!({ "state": "checking" }))
    }
    fn login_cancel(&self) {
        self.log("login_cancel".into());
    }
    fn browser_frame(&self, profile: &str, since: u64) -> Vec<u8> {
        self.log(format!("frame {profile} {since}"));
        let mut v = 7u64.to_le_bytes().to_vec();
        v.extend_from_slice(b"\xFF\xD8jpeg");
        v
    }
}

/// HQ 폴더에서 꺼진 참모 대화
const OFF: &str = "22222222-2222-4222-8222-222222222222";

const TS: &str = "mac.tail1.ts.net";

fn gate() -> Gate {
    Gate {
        devices: std::sync::Arc::new(crate::mobile_pair::Devices::with_token(KEY, "시험 폰")),
        hosts: vec![HOST.into(), "127.0.0.1:47123".into(), TS.into()],
        origins: vec![format!("http://{HOST}"), "http://127.0.0.1:47123".into(), format!("https://{TS}")],
        stops: Default::default(),
        sends: Default::default(),
        tickets: Default::default(),
    }
}

fn get(path: &str) -> Req {
    let (p, q) = path.split_once('?').unwrap_or((path, ""));
    Req { method: "GET".into(), path: p.into(), query: q.into(), headers: vec![("host".into(), HOST.into())], body: vec![] }
}

/// 이름은 옛것 그대로 — 이제는 기기 토큰을 Bearer 로 붙인다(R1)
fn with_cookie(mut r: Req) -> Req {
    r.headers.push(("authorization".into(), format!("Bearer {KEY}")));
    r
}

fn post(path: &str, body: &str) -> Req {
    Req {
        method: "POST".into(),
        path: path.into(),
        query: String::new(),
        headers: vec![
            ("host".into(), HOST.into()),
            ("origin".into(), format!("http://{HOST}")),
            ("content-type".into(), "application/json".into()),
            ("authorization".into(), format!("Bearer {KEY}")),
        ],
        body: body.as_bytes().to_vec(),
    }
}

fn set(mut r: Req, name: &str, value: Option<&str>) -> Req {
    r.headers.retain(|(k, _)| k != name);
    if let Some(v) = value {
        r.headers.push((name.into(), v.into()));
    }
    r
}

fn run(r: Req) -> (u16, Fake, Resp) {
    run_with(r, Fake::default())
}

fn run_with(r: Req, f: Fake) -> (u16, Fake, Resp) {
    let resp = handle(&r, &gate(), &f);
    (resp.status, f, resp)
}

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-mhttp-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::canonicalize(d).unwrap()
}

fn enc(p: &str) -> String {
    percent_encoding::utf8_percent_encode(p, percent_encoding::NON_ALPHANUMERIC).to_string()
}

fn ctype(r: &Resp) -> String {
    r.headers.iter().find(|(k, _)| *k == "Content-Type").map(|(_, v)| v.clone()).unwrap_or_default()
}

#[test]
fn 파일은_허용_집합_안만() {
    let d = tmp("file");
    let doc = d.join("기획 문서.md");
    std::fs::write(&doc, "# 제목").unwrap();
    let html = d.join("v1.html");
    std::fs::write(&html, "<script>fetch('/api/send')</script>").unwrap();
    let png = d.join("a.png");
    std::fs::write(&png, b"\x89PNG\r\n\x1a\n").unwrap();
    let secret = d.join("secret.txt");
    std::fs::write(&secret, "no").unwrap();
    std::fs::create_dir_all(d.join("data/routines/daily-check")).unwrap();
    std::fs::write(d.join("data/routines/daily-check/ROUTINE.md"), "지침").unwrap();
    let show: String = [&doc, &html, &png].iter().map(|p| format!("{{\"path\":\"{}\"}}\n", p.display())).collect();
    let fake = || Fake { show: show.clone(), data: d.join("data"), ..Default::default() };
    let file = |p: &Path, extra: &str| with_cookie(get(&format!("/api/file?path={}{extra}", enc(&p.to_string_lossy()))));

    let (s, _, r) = run_with(file(&doc, ""), fake());
    assert_eq!((s, r.body.as_slice()), (200, "# 제목".as_bytes()));
    // html 은 글로만, 스크립트 금지 CSP
    let (s, _, r) = run_with(file(&html, ""), fake());
    assert_eq!(s, 200);
    assert!(ctype(&r).starts_with("text/plain"));
    assert!(r.headers.iter().any(|(k, v)| *k == "Content-Security-Policy" && v.starts_with("sandbox")));
    // 그림 원본·썸네일
    let (_, _, r) = run_with(file(&png, ""), fake());
    assert_eq!(ctype(&r), "image/png");
    let (_, f, r) = run_with(file(&png, "&thumb=1"), fake());
    assert_eq!(ctype(&r), "image/jpeg");
    // 원본 경로가 아니라 확인된 fd 에서 읽은 바이트의 600 임시 사본을 줄인다(S9)
    let calls = f.calls();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].starts_with("jpeg chammo-mobile-src-") && calls[0].ends_with(".png Some(480)"), "{calls:?}");
    // 예약 지침서
    assert_eq!(run_with(file(&d.join("data/routines/daily-check/ROUTINE.md"), ""), fake()).0, 200);
    // 집합 밖·../·인코딩 깨짐·경로 없음·열쇠 없음
    assert_eq!(run_with(file(&secret, ""), fake()).0, 403);
    let dotted = format!("{}/data/routines/../../secret.txt", d.display());
    assert_eq!(run_with(with_cookie(get(&format!("/api/file?path={}", enc(&dotted)))), fake()).0, 403);
    assert_eq!(run_with(with_cookie(get("/api/file?path=%2Fetc%2Fpasswd")), fake()).0, 403);
    assert_eq!(run_with(with_cookie(get("/api/file?path=%FF%FE")), fake()).0, 400);
    assert_eq!(run_with(with_cookie(get("/api/file")), fake()).0, 400);
    assert_eq!(run_with(get(&format!("/api/file?path={}", enc(&doc.to_string_lossy()))), fake()).0, 401);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 닫힌_워크트리에서_띄운_파일은_본_폴더_자리로_열린다() {
    let d = tmp("wt-closed");
    let repo = d.join("proj");
    std::fs::create_dir_all(repo.join(".git")).unwrap();
    std::fs::create_dir_all(repo.join("docs")).unwrap();
    std::fs::write(repo.join("docs/v1.html"), "<p>v1</p>").unwrap();
    std::fs::write(repo.join("CLAUDE.local.md"), "계정").unwrap();
    let wt = repo.join(".claude/worktrees/mobile-design");
    let raw: String = [wt.join("docs/v1.html"), wt.join("docs/gone.md"), wt.join("CLAUDE.local.md")]
        .iter()
        .map(|p| format!("{{\"ts\":\"1\",\"path\":\"{}\",\"from\":\"o\"}}\n", p.display()))
        .collect();
    // 진짜 앱은 read_show_log 가 이 풀기를 거친 기록을 Backend::show_log 로 준다
    let show = mobile_files::resolve_show_log(&raw, &d);
    let fake = || Fake { show: show.clone(), data: d.join("data"), ..Default::default() };
    let file = |p: &Path| with_cookie(get(&format!("/api/file?path={}", enc(&p.to_string_lossy()))));
    // 목록엔 본 폴더 자리, 못 찾은 건 gone
    let (_, _, r) = run_with(with_cookie(get("/api/shows")), fake());
    let list = String::from_utf8_lossy(&r.body).into_owned();
    assert!(list.contains(&format!("\"path\":\"{}\"", repo.join("docs/v1.html").display())), "{list}");
    assert!(list.contains("\"gone\":true"), "{list}");
    let (s, _, r) = run_with(file(&repo.join("docs/v1.html")), fake());
    assert_eq!((s, r.body.as_slice()), (200, "<p>v1</p>".as_bytes()));
    // 사라진 옛 자리·못 찾은 파일은 404(폰이 '지워졌어요'), 풀려도 민감 파일은 403
    assert_eq!(run_with(file(&wt.join("docs/gone.md")), fake()).0, 404);
    assert_eq!(run_with(file(&repo.join("CLAUDE.local.md")), fake()).0, 403);
    // 풀린 경로를 몰래 다른 파일로 — 집합에 없으니 403
    assert_eq!(run_with(file(&repo.join(".git/config")), fake()).0, 403);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 폰이_올린_첨부는_보여_준_기록_없이_api_file_로_보인다() {
    let d = tmp("phone-attach");
    std::fs::create_dir_all(d.join("data/attach")).unwrap();
    let mine = d.join("data/attach/1790949356271-phone.png");
    std::fs::write(&mine, b"\x89PNG\r\n\x1a\nxx").unwrap();
    let desk = d.join("data/attach/1790949356271-image.png");
    std::fs::write(&desk, b"\x89PNG\r\n\x1a\nxx").unwrap();
    let fake = || Fake { data: d.join("data"), ..Default::default() };
    let file = |p: &Path| with_cookie(get(&format!("/api/file?path={}", enc(&p.to_string_lossy()))));
    let (s, _, r) = run_with(file(&mine), fake());
    assert_eq!((s, ctype(&r)), (200, "image/png".to_string()));
    // 데스크톱이 붙인 그림은 보여 준 기록에 있어야 — 이름 꼴만으로는 안 연다
    assert_eq!(run_with(file(&desk), fake()).0, 403);
    // 열쇠 없으면 그대로 401
    assert_eq!(run_with(get(&format!("/api/file?path={}", enc(&mine.to_string_lossy()))), fake()).0, 401);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 큰_글_파일은_413() {
    let d = tmp("big");
    let big = d.join("big.md");
    std::fs::write(&big, vec![b'a'; (mobile_files::MAX_TEXT_FILE + 1) as usize]).unwrap();
    let f = Fake { show: format!("{{\"path\":\"{}\"}}", big.display()), data: d.join("data"), ..Default::default() };
    assert_eq!(run_with(with_cookie(get(&format!("/api/file?path={}", enc(&big.to_string_lossy())))), f).0, 413);
    let _ = std::fs::remove_dir_all(&d);
}

fn attach_req(body: &[u8], ct: &str) -> Req {
    let mut r = set(post("/api/attach", ""), "content-type", Some(ct));
    r.body = body.to_vec();
    r
}

fn attach_named(body: &[u8], ct: &str, name: &str) -> Req {
    let mut r = attach_req(body, ct);
    r.query = format!("name={}", enc(name));
    r
}

#[test]
fn 붙이기는_허용_형식만_이름은_서버가() {
    let (s, f, r) = run(attach_req(b"\x89PNG\r\n\x1a\nrest", "image/png"));
    assert_eq!(s, 200);
    assert_eq!(f.calls(), vec!["attach png 12"]);
    assert!(String::from_utf8_lossy(&r.body).contains("/data/attach/1-phone.png"));
    // 파일: pdf·글·zip — 저장 확장자는 서버가 정하고 원래 이름은 안 쓴다
    let (s, f, _) = run(attach_named(b"%PDF-1.7\n", "application/pdf", "../../보고서.pdf"));
    assert_eq!((s, f.calls()), (200, vec!["attach pdf 9".to_string()]));
    let (s, f, _) = run(attach_named("메모".as_bytes(), "text/plain", "note.txt"));
    assert_eq!((s, f.calls()), (200, vec!["attach txt 6".to_string()]));
    // 형식이 안 맞으면 415 — 이름표만 그림인 html, 글이라 우기는 스크립트, 실행 파일
    assert_eq!(run(attach_req(b"<html><script>", "image/png")).0, 415);
    assert_eq!(run(attach_named(b"#!/bin/sh\n", "text/plain", "note.txt")).0, 415);
    assert_eq!(run(attach_named(b"\xcf\xfa\xed\xfe\x07", "application/octet-stream", "a.txt")).0, 415);
    assert_eq!(run(attach_named(b"echo", "text/plain", "run.command")).0, 415);
    // 허용 목록 밖 MIME(form 종류 포함)은 머리에서 403
    for ct in ["text/html", "application/x-www-form-urlencoded", "multipart/form-data", "application/x-sh"] {
        assert_eq!(run(attach_req(b"\x89PNG\r\n\x1a\n", ct)).0, 403, "{ct}");
    }
    // 다른 출처 · 열쇠 없음
    assert_eq!(run(set(attach_req(b"\x89PNG\r\n\x1a\n", "image/png"), "origin", Some("http://evil.com"))).0, 403);
    assert_eq!(run(set(attach_req(b"\x89PNG\r\n\x1a\n", "image/png"), "authorization", None)).0, 401);
}

#[test]
fn 붙이기만_20mb_나머지는_64kb() {
    let head = |path: &str, len: usize| format!("POST {path} HTTP/1.1\r\nContent-Length: {len}\r\n\r\n");
    assert_eq!(parse(head("/api/send", 64 * 1024 + 1).as_bytes()).unwrap_err().status, 413);
    assert_eq!(parse(head("/api/attach", mobile_files::MAX_ATTACH + 1).as_bytes()).unwrap_err().status, 413);
    // 20MB 이하는 머리에서 거절하지 않는다(몸이 모자라 400 = 길이 검사는 통과)
    assert_eq!(parse(head("/api/attach", 1024 * 1024).as_bytes()).unwrap_err().status, 400);
}

#[test]
fn 세션_목록에_컨텍스트() {
    let out = with_ctx(&format!(r#"[{{"id":"aaaa0001","sessionId":"{SID}"}},{{"id":"bbbb0002"}}]"#), &[format!(r#"{{"sessionId":"{SID}","used":73}}"#)]);
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v[0]["ctx"]["used"], 73);
    assert!(v[1].get("ctx").is_none());
    assert_eq!(with_ctx("not json", &[]), "not json");
    let (_, _, r) = run(with_cookie(get("/api/sessions")));
    assert!(String::from_utf8_lossy(&r.body).starts_with('['));
}

#[test]
fn 열쇠_없거나_틀리면_401() {
    assert_eq!(run(get("/api/sessions")).0, 401);
    let wrong = set(get("/api/sessions"), "authorization", Some(&format!("Bearer {}", "f".repeat(64))));
    assert_eq!(run(wrong).0, 401);
    // 길이가 다른 열쇠·빈 열쇠·앞부분만 맞는 열쇠
    for k in ["", "0123", &KEY[..63], &format!("{KEY}0")] {
        assert_eq!(run(set(get("/api/sessions"), "authorization", Some(&format!("Bearer {k}")))).0, 401, "{k}");
    }
    // 주소에 열쇠를 붙여도 API 는 Bearer 만 본다
    assert_eq!(run(get(&format!("/api/sessions?k={KEY}"))).0, 401);
    // 열쇠 없는 쓰기도 401 (출처가 맞아도)
    assert_eq!(run(set(post("/api/send", r#"{"id":"aaaa0001","text":"hi"}"#), "authorization", None)).0, 401);
}

#[test]
fn bearer_로_통과() {
    assert_eq!(run(with_cookie(get("/api/sessions"))).0, 200);
    assert_eq!(run(set(get("/api/env"), "authorization", Some(&format!("Bearer {KEY}")))).0, 200);
}

#[test]
fn 이상한_host_거절() {
    for h in [None, Some("evil.com"), Some("evil.com:47123"), Some("100.100.10.1:1"), Some("192.168.0.5:47123"), Some("localhost:47123")] {
        let r = set(with_cookie(get("/api/sessions")), "host", h);
        assert_eq!(run(r).0, 403, "{h:?}");
        // 화면 파일도 같은 문지기
        assert_eq!(run(set(get("/"), "host", h)).0, 403, "{h:?}");
    }
    assert_eq!(run(set(with_cookie(get("/api/sessions")), "host", Some("127.0.0.1:47123"))).0, 200);
}

#[test]
fn origin_다르거나_없는_post_거절() {
    let ok = r#"{"id":"aaaa0001","text":"hi"}"#;
    for o in [None, Some("http://evil.com"), Some("null"), Some("https://100.100.10.1:47123"), Some("http://100.100.10.1:47123.evil.com"), Some("http://mac.tail1.ts.net"), Some("https://mac.tail1.ts.net.evil.com")] {
        let (s, f, _) = run(set(post("/api/send", ok), "origin", o));
        assert_eq!(s, 403, "{o:?}");
        assert!(f.calls().is_empty(), "{o:?}");
    }
    // form 으로 보낼 수 있는 종류(text/plain·form)는 거절 — JSON 만
    for ct in [None, Some("text/plain"), Some("application/x-www-form-urlencoded"), Some("multipart/form-data")] {
        assert_eq!(run(set(post("/api/send", ok), "content-type", ct)).0, 403, "{ct:?}");
    }
    assert_eq!(run(post("/api/routine", r#"{"name":"daily-check","action":"run"}"#)).0, 200);
    // 테일스케일 HTTPS 출처는 https 로만
    let r = set(set(post("/api/routine", r#"{"name":"daily-check","action":"run"}"#), "host", Some(TS)), "origin", Some("https://mac.tail1.ts.net"));
    assert_eq!(run(r).0, 200);
}

#[test]
fn 허용_목록_밖은_404_405() {
    for p in ["/api/pty", "/api/accounts_switch", "/api/shell", "/api/read_file", "/api/config", "/api/", "/api/sessions/../config", "/etc/passwd", "/../../etc/passwd"] {
        assert_eq!(run(with_cookie(get(p))).0, 404, "{p}");
    }
    assert_eq!(run(with_cookie(set(get("/api/send"), "x", None))).0, 405);
    let mut del = with_cookie(get("/api/sessions"));
    del.method = "DELETE".into();
    assert_eq!(run(del).0, 405);
    let mut opt = with_cookie(get("/api/send"));
    opt.method = "OPTIONS".into();
    let (s, _, r) = run(opt);
    assert_eq!(s, 405);
    assert!(r.headers.iter().all(|(k, _)| !k.to_ascii_lowercase().starts_with("access-control")));
}

#[test]
fn 화면_파일은_정해_둔_이름만() {
    assert_eq!(run(get("/")).0, 200);
    assert_eq!(run(get("/assets/app-1.js")).0, 200);
    for p in ["/assets/../mobile.html", "/assets/%2e%2e/x", "/assets/.env", "/assets/a/b.js", "/assets/", "/mobile.html", "/index.html/../x", "/src-tauri/Cargo.toml", "/assets/..%2f..%2fetc"] {
        let (s, f, _) = run(get(p));
        assert_eq!(s, 404, "{p}");
        assert!(f.calls().iter().all(|c| c == "asset mobile.html" || !c.contains("..")), "{p}");
    }
    // 폰 푸시용 서비스 워커·홈 화면 앱 manifest 는 맨 위에서(서비스 워커 범위가 / 여야 한다)
    let (s, f, _) = run(get("/sw.js"));
    assert_eq!((s, f.calls()), (200, vec!["asset sw.js".to_string()]));
    assert_eq!(run(get("/manifest.webmanifest")).0, 200);
    assert_eq!(run(get("/sw2.js")).0, 404);
    // assets 아래 이상한 이름은 Backend 에 묻지도 않는다
    let (_, f, _) = run(get("/assets/..%2f..%2fetc"));
    assert!(f.calls().is_empty());
}

#[test]
fn 대화_기록은_세션_id_로만() {
    let (s, f, _) = run(with_cookie(get(&format!("/api/transcript?id={SID}&from=10"))));
    assert_eq!(s, 200);
    assert_eq!(f.calls(), vec![format!("transcript {SID} Some(10)")]);
    for id in [
        "../../.ssh/id_rsa",
        "..%2f..%2fx",
        "F00D0002-0000-4000-8000-004027383810",
        "f00d0002-0000-4000-8000-00402738381",
        "f00d0002-0000-4000-8000-004027383810/../x",
        "f00d0002",
        "/Users/me/.claude/projects/x/f00d0002-0000-4000-8000-004027383810.jsonl",
        "",
    ] {
        let (s, f, _) = run(with_cookie(get(&format!("/api/transcript?id={id}"))));
        assert_eq!(s, 400, "{id}");
        assert!(f.calls().is_empty(), "{id}");
    }
    // 경로를 따로 넘기는 칸은 없다 — path= 를 붙여도 무시하고 id 만 본다
    let (_, f, _) = run(with_cookie(get(&format!("/api/transcript?id={SID}&path=/etc/passwd"))));
    assert_eq!(f.calls(), vec![format!("transcript {SID} None")]);
    assert_eq!(run(with_cookie(get(&format!("/api/transcript?id={SID}&from=-1")))).0, 400);
}

#[test]
fn 보내기는_비서_세션에만() {
    let (s, f, _) = run(post("/api/send", r#"{"id":"aaaa0001","text":"안녕"}"#));
    assert_eq!(s, 202, "받자마자 202, 치기는 뒤에서");
    assert_eq!(f.calls(), vec!["send aaaa0001 안녕"]);
    // 하위 세션·없는 세션·이상한 id·빈 글·너무 긴 글·모르는 칸
    for (b, code) in [
        (r#"{"id":"bbbb0002","text":"hi"}"#.to_string(), 403),
        (r#"{"id":"cccc0003","text":"hi"}"#.to_string(), 404),
        (r#"{"id":"aaaa0001; rm -rf /","text":"hi"}"#.to_string(), 400),
        (r#"{"id":"aaaa0001","text":"   "}"#.to_string(), 400),
        (format!(r#"{{"id":"aaaa0001","text":"{}"}}"#, "가".repeat(8001)), 400),
        (r#"{"id":"aaaa0001","text":"hi","cwd":"/"}"#.to_string(), 400),
        ("not json".to_string(), 400),
    ] {
        let (s, f, _) = run(post("/api/send", &b));
        assert_eq!(s, code, "{b:.60}");
        assert!(f.calls().is_empty(), "{b:.60}");
    }
}

#[test]
fn 멈춤은_일하는_비서_세션에만_esc_한_번() {
    let ok = r#"{"id":"aaaa0001"}"#;
    let (s, f, _) = run(post("/api/interrupt", ok));
    assert_eq!(s, 200);
    assert_eq!(f.calls(), vec!["interrupt aaaa0001"]);
    // 하위 세션·없는 세션·이상한 id·모르는 칸·JSON 아님
    for (b, code) in [
        (r#"{"id":"bbbb0002"}"#, 403),
        (r#"{"id":"cccc0003"}"#, 404),
        (r#"{"id":"aaaa0001; rm -rf /"}"#, 400),
        (r#"{"id":"aaaa0001","keys":"\u001b\u001b"}"#, 400),
        (r#"{"session":"aaaa0001"}"#, 400),
        ("not json", 400),
    ] {
        let (s, f, _) = run(post("/api/interrupt", b));
        assert_eq!(s, code, "{b}");
        assert!(f.calls().is_empty(), "{b}");
    }
    // 쉬는 세션엔 안 보낸다 — 쉴 때 Esc 는 Claude 되감기 메뉴를 연다. 앱(domain/session)과 같은 판단:
    // status 가 진짜 상태(state working + status idle = 입력 기다림), state done 이면 끝남
    for hq in [("working", "idle"), ("done", "busy"), ("done", "idle"), ("blocked", "idle")] {
        let (s, f, _) = run_with(post("/api/interrupt", ok), Fake { hq: Some(hq), ..Default::default() });
        assert_eq!((s, f.calls().len()), (409, 0), "{hq:?}");
    }
    // 열쇠·출처·JSON·방법
    assert_eq!(run(set(post("/api/interrupt", ok), "authorization", None)).0, 401);
    assert_eq!(run(set(post("/api/interrupt", ok), "origin", None)).0, 403);
    assert_eq!(run(set(post("/api/interrupt", ok), "origin", Some("http://evil.example"))).0, 403);
    assert_eq!(run(set(post("/api/interrupt", ok), "content-type", Some("text/plain"))).0, 403);
    assert_eq!(run(with_cookie(get("/api/interrupt"))).0, 405);
}

#[test]
fn json_쓰기_길은_머리_문지기도_통과한다() {
    // 머리 문지기(head_check)에 길 목록이 따로 있다 — handle 에만 길을 더하면 실제 서버에선 404(2026-10-03 /api/interrupt)
    let g = gate();
    for (path, body) in [("/api/send", r#"{"id":"aaaa0001","text":"hi"}"#), ("/api/routine", r#"{"name":"daily","action":"run"}"#), ("/api/interrupt", r#"{"id":"aaaa0001"}"#)] {
        assert!(head_check(&post(path, body), &g).is_none(), "{path}");
        assert_eq!(head_check(&set(post(path, body), "authorization", None), &g).map(|r| r.status), Some(401), "{path}");
    }
}

#[test]
fn 멈춤_연타는_2초에_한_번() {
    let g = gate();
    let f = Fake::default();
    let ok = r#"{"id":"aaaa0001"}"#;
    assert_eq!(handle(&post("/api/interrupt", ok), &g, &f).status, 200);
    assert_eq!(handle(&post("/api/interrupt", ok), &g, &f).status, 429);
    assert_eq!(f.calls(), vec!["interrupt aaaa0001"]);
    // 2초가 지나면 다시
    g.stops.lock().unwrap().insert("aaaa0001".into(), std::time::Instant::now() - std::time::Duration::from_secs(3));
    assert_eq!(handle(&post("/api/interrupt", ok), &g, &f).status, 200);
    assert_eq!(f.calls().len(), 2);
}

#[test]
fn 예약은_정해진_모양만() {
    let (s, f, _) = run(post("/api/routine", r#"{"name":"daily-check","action":"pause"}"#));
    assert_eq!(s, 200);
    assert_eq!(f.calls(), vec!["routine daily-check pause"]);
    for b in [
        r#"{"name":"daily-check","action":"remove"}"#,
        r#"{"name":"daily-check","action":"new"}"#,
        r#"{"name":"../x","action":"run"}"#,
        r#"{"name":"a b","action":"run"}"#,
    ] {
        assert_eq!(run(post("/api/routine", b)).0, 400, "{b}");
    }
    assert_eq!(run(post("/api/routine", r#"{"name":"other","action":"run"}"#)).0, 404);
}

#[test]
fn 모양_검사() {
    assert!(ct_eq(b"abc", b"abc"));
    assert!(!ct_eq(b"abc", b"abd"));
    assert!(!ct_eq(b"abc", b"abcd"));
    assert!(is_session_uuid(SID));
    assert!(!is_session_uuid("../x"));
    assert!(is_short_id("f00d0002"));
    assert!(!is_short_id("f00d000F"));
}

// ── 소켓 단위 ──

fn parse(raw: &[u8]) -> Result<Req, Resp> {
    read_req(&mut std::io::Cursor::new(raw.to_vec()))
}

#[test]
fn 요청_읽기() {
    let r = parse(b"POST /api/send?x=1 HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\nCOOKIE: c=1\r\n\r\nhello").unwrap();
    assert_eq!((r.method.as_str(), r.path.as_str(), r.query.as_str()), ("POST", "/api/send", "x=1"));
    assert_eq!(r.header("cookie"), Some("c=1"));
    assert_eq!(r.body, b"hello");
}

#[test]
fn 큰_요청_덩어리_전송_깨진_요청_거절() {
    let big_head = format!("GET / HTTP/1.1\r\nX: {}\r\n\r\n", "a".repeat(20_000));
    assert_eq!(parse(big_head.as_bytes()).unwrap_err().status, 431);
    assert_eq!(parse(b"POST / HTTP/1.1\r\nContent-Length: 999999\r\n\r\n").unwrap_err().status, 413);
    assert_eq!(parse(b"POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap_err().status, 501);
    assert_eq!(parse(b"POST / HTTP/1.1\r\nContent-Length: -1\r\n\r\n").unwrap_err().status, 400);
    assert_eq!(parse(b"GARBAGE\r\n\r\n").unwrap_err().status, 400);
    assert_eq!(parse(b"GET / HTTP/1.1\r\nHost: a\r\n").unwrap_err().status, 400);
    assert_eq!(parse(b"POST / HTTP/1.1\r\nContent-Length: 10\r\n\r\nabc").unwrap_err().status, 400);
}

#[test]
fn 응답엔_cors_헤더가_없고_캐시_금지() {
    let mut out = Vec::new();
    write_resp(&mut out, &Resp::text(200, "x"), false, std::time::Instant::now() + Duration::from_secs(5)).unwrap();
    let s = String::from_utf8(out).unwrap().to_ascii_lowercase();
    assert!(!s.contains("access-control"));
    assert!(s.contains("cache-control: no-store") && s.contains("connection: close") && s.contains("referrer-policy: no-referrer"));
}

#[test]
fn 보내는_글의_제어_문자는_뺀다() {
    // ESC(화살표·키 흉내)·Ctrl+C·Ctrl+D·DEL·CR·C1 — TUI 에 키로 들어가면 안 된다. 줄바꿈·탭은 둔다
    let (s, f, _) = run(post("/api/send", r#"{"id":"aaaa0001","text":"가\u001b[B나\u0003다\u0004\u007f\r\u0085라\n마\t바"}"#));
    assert_eq!(s, 202, "받자마자 202, 치기는 뒤에서");
    assert_eq!(f.calls(), vec!["send aaaa0001 가[B나다라\n마\t바"]);
    // 제어 문자만이면 빈 글
    assert_eq!(run(post("/api/send", r#"{"id":"aaaa0001","text":"\u001b\u0003"}"#)).0, 400);
}

#[test]
fn 보여_준_기록은_열쇠로만() {
    let f = || Fake { show: "{\"path\":\"/u/a.png\",\"from\":\"aaaa0001\"}\n".into(), data: "/nonexistent-data".into(), ..Default::default() };
    assert_eq!(run_with(get("/api/shows"), f()).0, 401);
    let (s, _, r) = run_with(with_cookie(get("/api/shows")), f());
    assert_eq!(s, 200);
    assert!(String::from_utf8_lossy(&r.body).contains("/u/a.png"));
}

#[test]
fn s10_선택지_답_길은_없다() {
    let (s, f, _) = run(post("/api/choice", r#"{"id":"bbbb0002","picks":[1]}"#));
    assert_eq!(s, 404);
    assert!(f.calls().is_empty());
}

/// 머리만 주고 몸통을 더 읽으려 하면 패닉하는 읽기 — "몸통을 안 읽고 거절했나"를 잰다
struct HeadOnly(std::io::Cursor<Vec<u8>>);
impl Read for HeadOnly {
    fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
        let n = self.0.read(b)?;
        if n == 0 { panic!("몸통까지 읽으려 했다") }
        Ok(n)
    }
}
impl TimedRead for HeadOnly {
    fn set_timeout(&mut self, _: Duration) {}
}

fn head_only(head: &str) -> HeadOnly {
    HeadOnly(std::io::Cursor::new(head.as_bytes().to_vec()))
}

#[test]
fn s5_머리_검사를_통과해야_몸통을_읽는다() {
    let g = gate();
    let far = std::time::Instant::now() + Duration::from_secs(5);
    let big = mobile_files::MAX_ATTACH - 1;
    // 이상한 Host → 403, 열쇠 없음 → 401, 모르는 길 → 404, 남의 출처 → 403 — 전부 몸통 전에
    let cases = [
        (format!("POST /api/attach HTTP/1.1\r\nHost: evil.com\r\nContent-Length: {big}\r\n\r\n"), 403),
        (format!("POST /api/attach HTTP/1.1\r\nHost: {HOST}\r\nOrigin: http://{HOST}\r\nContent-Type: image/png\r\nContent-Length: {big}\r\n\r\n"), 401),
        (format!("POST /api/nope HTTP/1.1\r\nHost: {HOST}\r\nAuthorization: Bearer {KEY}\r\nContent-Length: 100\r\n\r\n"), 404),
        (format!("POST /api/attach HTTP/1.1\r\nHost: {HOST}\r\nAuthorization: Bearer {KEY}\r\nOrigin: http://evil.com\r\nContent-Type: image/png\r\nContent-Length: {big}\r\n\r\n"), 403),
        (format!("POST /api/send HTTP/1.1\r\nHost: {HOST}\r\nAuthorization: Bearer {KEY}\r\nOrigin: http://{HOST}\r\nContent-Type: text/plain\r\nContent-Length: 50\r\n\r\n"), 403),
    ];
    for (head, code) in cases {
        let r = read_req_checked(&mut head_only(&head), far, |req| head_check(req, &g)).unwrap_err();
        assert_eq!(r.status, code, "{head:.60}");
    }
}

#[test]
fn s5_요청_하나_전체_마감() {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    let t = std::thread::spawn(move || {
        let mut c = std::net::TcpStream::connect(addr).unwrap();
        // 한 글자씩 0.3초마다 — 한 번 읽기 시간(10초)은 안 넘지만 끝나지 않는 머리
        let _ = c.write_all(b"GET / HTTP/1.1\r\nX: ");
        let mut out = String::new();
        c.set_read_timeout(Some(Duration::from_millis(300))).unwrap();
        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_secs(6) {
            if c.write_all(b"a").is_err() { break }
            let mut b = [0u8; 256];
            if let Ok(n) = c.read(&mut b) { if n > 0 { out.push_str(&String::from_utf8_lossy(&b[..n])); break } }
        }
        (out, start.elapsed())
    });
    let (s, _) = l.accept().unwrap();
    serve_conn_within(s, Arc::new(gate()), Arc::new(Fake::default()), Duration::from_secs(1));
    let (out, took) = t.join().unwrap();
    assert!(out.starts_with("HTTP/1.1 408"), "{out:?}");
    assert!(took < Duration::from_secs(4), "{took:?}");
}

#[test]
fn s3_funnel_로_온_요청은_거절() {
    // tailscale funnel 은 인터넷에서 온 요청에 Tailscale-Funnel-Request 를 붙인다 — 나중에 누가 funnel 을 켜도 문지기가 막는다
    let r = set(with_cookie(get("/api/sessions")), "tailscale-funnel-request", Some("?1"));
    assert_eq!(run(r).0, 403);
    let r = set(get("/"), "tailscale-funnel-request", Some("?1"));
    assert_eq!(run(r).0, 403);
}

#[test]
fn s8_주소의_마스터_열쇠로는_쿠키를_안_준다() {
    let (s, _, r) = run(get(&format!("/?k={KEY}")));
    assert!(r.headers.iter().all(|(k, _)| *k != "Set-Cookie"), "status {s}");
    // 포트 없는 옛 쿠키 이름은 안 받는다
    let old = set(get("/api/sessions"), "cookie", Some(&format!("chammo_m={KEY}")));
    assert_eq!(run(old).0, 401);
}

#[test]
fn s7_끊은_기기는_바로_401() {
    let g = gate();
    let f = Fake::default();
    assert_eq!(handle(&with_cookie(get("/api/env")), &g, &f).status, 200);
    let id = g.devices.list()[0].id.clone();
    g.devices.remove(&id).unwrap();
    assert_eq!(handle(&with_cookie(get("/api/env")), &g, &f).status, 401);
}

#[test]
fn r3_느리게_읽는_클라이언트는_쓰기_마감에_끊긴다() {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    let client = std::thread::spawn(move || {
        let mut c = std::net::TcpStream::connect(addr).unwrap();
        c.write_all(format!("GET /api/tasks HTTP/1.1\r\nHost: {HOST}\r\nAuthorization: Bearer {KEY}\r\n\r\n").as_bytes()).unwrap();
        std::thread::sleep(Duration::from_secs(6)); // 안 읽고 버틴다
        c
    });
    let (s, _) = l.accept().unwrap();
    let t0 = std::time::Instant::now();
    serve_conn_within(s, Arc::new(gate()), Arc::new(Fake { big: 8 * 1024 * 1024, ..Default::default() }), Duration::from_secs(1));
    assert!(t0.elapsed() < Duration::from_secs(4), "쓰기에서 자리를 오래 잡았다: {:?}", t0.elapsed());
    drop(client.join());
}

#[test]
fn r3_느려도_계속_읽는_클라이언트는_큰_응답을_끝까지_받는다() {
    // 느린 LTE 로 큰 시안을 받는 폰 — 진척이 있으면 읽기 마감의 두 배(여기 2초)를 넘어도 끊지 않는다
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    let client = std::thread::spawn(move || {
        let mut c = std::net::TcpStream::connect(addr).unwrap();
        c.write_all(format!("GET /api/tasks HTTP/1.1\r\nHost: {HOST}\r\nAuthorization: Bearer {KEY}\r\n\r\n").as_bytes()).unwrap();
        let (mut got, mut buf) = (0usize, vec![0u8; 64 * 1024]);
        loop {
            match c.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => got += n,
            }
            std::thread::sleep(Duration::from_millis(60)); // 초당 1MB 쯤
        }
        got
    });
    let (s, _) = l.accept().unwrap();
    let t0 = std::time::Instant::now();
    serve_conn_within(s, Arc::new(gate()), Arc::new(Fake { big: 4 * 1024 * 1024, ..Default::default() }), Duration::from_secs(1));
    let got = client.join().unwrap();
    assert!(t0.elapsed() > Duration::from_secs(2), "시험이 느리게 읽지 않았다: {:?}", t0.elapsed());
    assert!(got > 4 * 1024 * 1024, "중간에 끊겼다: {got} 바이트, {:?}", t0.elapsed());
}

#[test]
fn r3_오래_걸리는_맥_쪽_일은_504_로_끊는다() {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    let client = std::thread::spawn(move || {
        let mut c = std::net::TcpStream::connect(addr).unwrap();
        c.write_all(format!("GET /api/sessions HTTP/1.1\r\nHost: {HOST}\r\nAuthorization: Bearer {KEY}\r\n\r\n").as_bytes()).unwrap();
        let mut out = String::new();
        let _ = c.read_to_string(&mut out);
        out
    });
    let (s, _) = l.accept().unwrap();
    let t0 = std::time::Instant::now();
    serve_conn_within(s, Arc::new(gate()), Arc::new(Fake { slow: Duration::from_secs(5), ..Default::default() }), Duration::from_secs(1));
    assert!(t0.elapsed() < Duration::from_secs(3), "{:?}", t0.elapsed());
    assert!(client.join().unwrap().starts_with("HTTP/1.1 504"));
}

fn bearer(r: Req) -> Req {
    set(r, "authorization", Some(&format!("Bearer {KEY}")))
}

#[test]
fn r1_쿠키로는_통과하지_않는다_bearer_만() {
    // 쿠키는 포트를 안 가려 같은 호스트 다른 포트 서버(vite·Metro)가 받는다 — 인증에 안 쓴다
    assert_eq!(run(set(get("/api/env"), "cookie", Some(&format!("{CK}={KEY}")))).0, 401);
    assert_eq!(run(bearer(get("/api/env"))).0, 200);
}

fn pair_post(code: &str) -> Req {
    let mut r = set(post("/api/pair", ""), "authorization", None);
    r.body = format!(r#"{{"code":"{code}"}}"#).into_bytes();
    r
}

#[test]
fn r1_짝짓기는_post_api_pair_가_토큰을_json_으로_주고_쿠키는_없다() {
    let g = gate();
    let f = Fake::default();
    let code = g.devices.new_code(std::time::SystemTime::now()).unwrap();
    // 페이지를 여는 GET 은 코드를 쓰지 않고 껍데기만 — 쿠키 없음
    let page = handle(&get(&format!("/?pair={code}")), &g, &f);
    assert_eq!(page.status, 200);
    assert!(page.headers.iter().all(|(k, _)| *k != "Set-Cookie"));
    // 페이지가 같은 출처 JSON 으로 코드를 내면 토큰
    let r = handle(&set(pair_post(&code), "user-agent", Some("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")), &g, &f);
    assert_eq!(r.status, 200);
    assert!(r.headers.iter().all(|(k, _)| *k != "Set-Cookie"));
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    let tok = v["token"].as_str().unwrap().to_string();
    assert_eq!(tok.len(), 64);
    assert_eq!(handle(&set(get("/api/env"), "authorization", Some(&format!("Bearer {tok}"))), &g, &f).status, 200);
    // 같은 코드 두 번째 401, 남의 출처·form 종류 403(머리 검사에서도)
    assert_eq!(handle(&pair_post(&code), &g, &f).status, 401);
    let c2 = g.devices.new_code(std::time::SystemTime::now()).unwrap();
    assert_eq!(handle(&set(pair_post(&c2), "origin", Some("http://evil.com")), &g, &f).status, 403);
    assert_eq!(head_check(&set(pair_post(&c2), "content-type", Some("text/plain")), &g).map(|r| r.status), Some(403));
    // 짝짓기 길은 열쇠 없이 머리 검사를 지난다(코드가 열쇠)
    assert!(head_check(&pair_post(&c2), &g).is_none());
}

/// 놓인 때를 적는 자리 가드 — 실제 서버의 ConnSlot 대신
struct DropAt(Arc<Mutex<Option<std::time::Instant>>>);
impl Drop for DropAt {
    fn drop(&mut self) {
        *self.0.lock().unwrap() = Some(std::time::Instant::now());
    }
}

#[test]
fn m2_504_뒤에도_자리는_처리가_끝날_때_돌려준다() {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    let client = std::thread::spawn(move || {
        let mut c = std::net::TcpStream::connect(addr).unwrap();
        c.write_all(format!("GET /api/sessions HTTP/1.1\r\nHost: {HOST}\r\nAuthorization: Bearer {KEY}\r\n\r\n").as_bytes()).unwrap();
        let mut out = String::new();
        let _ = c.read_to_string(&mut out);
        (out, std::time::Instant::now())
    });
    let (s, _) = l.accept().unwrap();
    let t0 = std::time::Instant::now();
    let at = Arc::new(Mutex::new(None));
    serve_conn_guarded(s, Arc::new(gate()), Arc::new(Fake { slow: Duration::from_secs(3), ..Default::default() }), Duration::from_secs(1), DropAt(at.clone()));
    let (out, got) = client.join().unwrap();
    assert!(out.starts_with("HTTP/1.1 504"));
    assert!(got - t0 < Duration::from_millis(2600), "504 는 바로");
    // 처리(3초)가 끝나기 전엔 자리를 안 놓는다
    std::thread::sleep(Duration::from_millis(1500));
    let dropped = at.lock().unwrap().expect("처리가 끝나면 놓는다");
    assert!(dropped - t0 >= Duration::from_millis(2900), "504 순간에 놓았다: {:?}", dropped - t0);
}

#[test]
fn m4_프사_목록과_그림은_bearer_로만_키로만() {
    assert_eq!(run(get("/api/avatars")).0, 401);
    let (s, _, r) = run(with_cookie(get("/api/avatars")));
    assert_eq!(s, 200);
    assert!(String::from_utf8_lossy(&r.body).contains("참모-2"));
    // 그림: 키로만 찾는다 — 경로는 서버가 키로 만든다
    assert_eq!(run(get(&format!("/api/avatar-image?key={}", enc("참모-3")))).0, 401);
    let (s, f, r) = run(with_cookie(get(&format!("/api/avatar-image?key={}", enc("참모-3")))));
    assert_eq!((s, ctype(&r)), (200, "image/png".to_string()));
    assert_eq!(f.calls(), vec!["avatar_image 참모-3".to_string()]);
    assert!(r.headers.iter().any(|(k, v)| *k == "Content-Security-Policy" && v.starts_with("sandbox")));
    // 없는 키 404, 이상한 키(경로·점·예약 이름·빈 것·앞뒤 공백)는 묻지도 않고 400
    assert_eq!(run(with_cookie(get(&format!("/api/avatar-image?key={}", enc("참모-9"))))).0, 404);
    for k in ["../avatars/x", "a/b", "a.png", "..", "", "CON", " 참모-3", "참모-3\u{0}"] {
        let (s, f, _) = run(with_cookie(get(&format!("/api/avatar-image?key={}", enc(k)))));
        assert_eq!(s, 400, "{k:?}");
        assert!(f.calls().is_empty(), "{k:?}");
    }
    assert_eq!(run(with_cookie(get("/api/avatar-image"))).0, 400);
    assert_eq!(run(with_cookie(get("/api/avatar-image?key=%FF"))).0, 400);
}

#[test]
fn 폰에서_보낸_글은_표시를_남긴다() {
    // 참모가 '사용자가 지금 폰에서 보냄'을 알 수 있게 — 보내기 직전에 <데이터>/mobile-sent.json (2026-10-03 사용자)
    let data = tmp("sent");
    let f = Fake { data: data.clone(), ..Fake::default() };
    let (s, _, _) = run_with(post("/api/send", r#"{"id":"aaaa0001","text":"집이야"}"#), f);
    assert_eq!(s, 202, "받자마자 202, 치기는 뒤에서");
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(data.join("mobile-sent.json")).unwrap()).unwrap();
    assert_eq!(v["id"], "aaaa0001");
    assert!(v["at"].as_u64().unwrap() > 1_700_000_000_000);
    // 글 내용은 남기지 않는다
    assert!(!std::fs::read_to_string(data.join("mobile-sent.json")).unwrap().contains("집이야"));
    // 거절된 보내기(하위 세션)는 표시도 없다
    let data2 = tmp("sent2");
    let f2 = Fake { data: data2.clone(), ..Fake::default() };
    assert_eq!(run_with(post("/api/send", r#"{"id":"bbbb0002","text":"hi"}"#), f2).0, 403);
    assert!(!data2.join("mobile-sent.json").exists());
}

#[test]
fn 꺼진_참모_목록은_hq_것만() {
    let (code, _, r) = run(with_cookie(get("/api/stopped")));
    assert_eq!(code, 200);
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(v.as_array().unwrap().iter().map(|x| x["id"].as_str().unwrap()).collect::<Vec<_>>(), vec!["aaaa0002"]);
    assert_eq!(run(get("/api/stopped")).0, 401);
}

#[test]
fn 되살리기는_hq_의_꺼진_참모만() {
    let ok = format!(r#"{{"sessionId":"{OFF}"}}"#);
    let (code, f, _) = run(post("/api/respawn", &ok));
    assert_eq!(code, 200);
    assert_eq!(f.calls(), vec![format!("resume {HQ} {OFF} aaaa0002")]);
    // 프로젝트 세션은 폰에서 못 켠다 — 하위 세션은 참모가 다룬다
    assert_eq!(run(post("/api/respawn", &format!(r#"{{"sessionId":"{SID}"}}"#))).0, 404);
    assert_eq!(run(post("/api/respawn", r#"{"sessionId":"../../etc"}"#)).0, 400);
    assert_eq!(run(set(post("/api/respawn", &ok), "origin", Some("http://evil.com"))).0, 403);
    assert_eq!(run(set(post("/api/respawn", &ok), "content-type", Some("text/plain"))).0, 403);
}

#[test]
fn 이미_켜진_참모_되살리기는_다시_켜지_않고_켜져_있다고_답한다() {
    // 2026-10-05 21:21 폰: 맥에서 이미 켜진 참모-4 를 낡은 목록에서 눌러 404 "no such stopped assistant" 가 시트에 남았다.
    // 켜져 있으면 오류가 아니다 — 켜기(respawn = 재시작)는 부르지 않고 already 로 답해 폰이 그 참모로 옮긴다
    let f = Fake { revived: true, ..Fake::default() };
    let (code, f, r) = run_with(post("/api/respawn", &format!(r#"{{"sessionId":"{OFF}"}}"#)), f);
    assert_eq!(code, 200);
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(v["already"], true);
    assert!(f.calls().iter().all(|c| !c.starts_with("resume")), "켜진 세션을 respawn 하면 하던 일이 끊긴다: {:?}", f.calls());
    // 목록 어디에도 없는 대화(지워짐)는 그대로 404 — 폰이 목록을 새로 고친다
    assert_eq!(run(post("/api/respawn", r#"{"sessionId":"33333333-3333-4333-8333-333333333333"}"#)).0, 404);
}

#[test]
fn 되살리기_연타는_한_번만() {
    let g = gate();
    let f = Fake::default();
    let ok = format!(r#"{{"sessionId":"{OFF}"}}"#);
    assert_eq!(handle(&post("/api/respawn", &ok), &g, &f).status, 200);
    assert_eq!(handle(&post("/api/respawn", &ok), &g, &f).status, 429);
    assert_eq!(f.calls().len(), 1);
}

#[test]
fn 새_참모는_서버가_이름을_짓는다() {
    let (code, f, r) = run(post("/api/spawn", r#"{"nick":"  디자인  "}"#));
    assert_eq!(code, 200);
    // 살아 있는 참모-1·꺼진 참모-3 다음 번호 + 별명, 폴더는 HQ 고정
    assert_eq!(f.calls(), vec![format!("spawn {HQ} 참모-4 · 디자인")]);
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(v["name"], "참모-4 · 디자인");
    assert_eq!(run(post("/api/spawn", r#"{"nick":"나스"}"#)).0, 409, "이미 있는 별명");
    assert_eq!(run(post("/api/spawn", r#"{"nick":" "}"#)).0, 400);
    assert_eq!(run(post("/api/spawn", r#"{"nick":"a","cwd":"/"}"#)).0, 400, "폴더는 못 정한다");
    let g = gate();
    let f = Fake::default();
    assert_eq!(handle(&post("/api/spawn", r#"{"nick":"하나"}"#), &g, &f).status, 200);
    assert_eq!(handle(&post("/api/spawn", r#"{"nick":"둘"}"#), &g, &f).status, 429, "연달아 만들기는 10초에 하나");
}

#[test]
fn 꼬리_읽기는_세션_번호만_몇_개까지() {
    let (code, f, _) = run(with_cookie(get(&format!("/api/tails?ids={OFF},{SID}"))));
    assert_eq!(code, 200);
    assert_eq!(f.calls(), vec![format!("tails {OFF},{SID}")]);
    assert_eq!(run(with_cookie(get("/api/tails?ids=../x"))).0, 400);
    let many = vec![OFF; 13].join(",");
    assert_eq!(run(with_cookie(get(&format!("/api/tails?ids={many}")))).0, 400);
}

#[test]
fn 깨우기_길도_머리_문지기를_통과한다() {
    let g = gate();
    for (path, body) in [("/api/respawn", format!(r#"{{"sessionId":"{OFF}"}}"#)), ("/api/spawn", r#"{"nick":"x"}"#.to_string())] {
        assert!(head_check(&post(path, &body), &g).is_none(), "{path}");
        assert_eq!(head_check(&set(post(path, &body), "authorization", None), &g).map(|r| r.status), Some(401), "{path}");
    }
}

#[test]
fn 세션_브라우저_목록은_보기에_필요한_것만() {
    let (code, _, r) = run(with_cookie(get("/api/browsers")));
    assert_eq!(code, 200);
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(v[0]["profile"], "shop-m");
    assert_eq!(run(get("/api/browsers")).0, 401);
}

#[test]
fn 세션_브라우저_화면은_떠_있는_프로필만() {
    let (code, f, r) = run(with_cookie(get("/api/browser-frame?profile=shop-m&since=3")));
    assert_eq!(code, 200);
    assert_eq!(f.calls(), vec!["frame shop-m 3"]);
    assert_eq!(&r.body[..8], &7u64.to_le_bytes());
    assert_eq!(run(with_cookie(get("/api/browser-frame?profile=other"))).0, 404, "떠 있지 않은 프로필");
    assert_eq!(run(with_cookie(get("/api/browser-frame?profile=../x"))).0, 400);
    assert_eq!(run(with_cookie(get("/api/browser-frame?profile=shop-m&since=x"))).0, 400);
    assert_eq!(run(get("/api/browser-frame?profile=shop-m")).0, 401);
}

#[test]
fn 푸시_구독은_그_기기에_묶이고_알려진_푸시_서버만() {
    let g = gate();
    let dev = g.devices.list()[0].id.clone();
    let ok = r#"{"endpoint":"https://web.push.apple.com/QGFb","expirationTime":null,"keys":{"p256dh":"BCVxsr7N_eNg","auth":"BTBZMqHH6r4T"}}"#;
    let f = Fake::default();
    assert_eq!(handle(&post("/api/push-subscribe", ok), &g, &f).status, 200);
    assert_eq!(f.calls(), vec![format!("sub {dev} https://web.push.apple.com/QGFb BCVxsr7N_eNg BTBZMqHH6r4T")]);
    // 맥 안·사설망으로 curl 이 나가게 하는 주소는 거절
    for bad in ["https://127.0.0.1/x", "http://web.push.apple.com/x", "https://evil.com/x"] {
        let b = ok.replace("https://web.push.apple.com/QGFb", bad);
        assert_eq!(run(post("/api/push-subscribe", &b)).0, 400, "{bad}");
    }
    assert_eq!(run(post("/api/push-subscribe", r#"{"endpoint":"https://web.push.apple.com/x"}"#)).0, 400, "keys 없음");
    assert_eq!(run(post("/api/push-subscribe", &ok.replace("BTBZMqHH6r4T", "a b"))).0, 400);
    assert_eq!(run(set(post("/api/push-subscribe", ok), "origin", Some("http://evil.com"))).0, 403);
    assert_eq!(run(set(post("/api/push-subscribe", ok), "authorization", None)).0, 401);
    assert!(head_check(&post("/api/push-subscribe", ok), &g).is_none());
    assert!(head_check(&post("/api/push-unsubscribe", ok), &g).is_none());
}

#[test]
fn 푸시_해제는_그_기기_것만() {
    let g = gate();
    let dev = g.devices.list()[0].id.clone();
    let f = Fake::default();
    assert_eq!(handle(&post("/api/push-unsubscribe", r#"{"endpoint":"https://web.push.apple.com/QGFb"}"#), &g, &f).status, 200);
    assert_eq!(f.calls(), vec![format!("unsub {dev} https://web.push.apple.com/QGFb")]);
    let (code, _, r) = run(with_cookie(get("/api/push-key")));
    assert_eq!(code, 200);
    assert_eq!(serde_json::from_slice::<serde_json::Value>(&r.body).unwrap()["key"], "BPUB");
}

#[test]
fn 홈_화면_앱_연결_코드는_열쇠_있는_기기만_만든다() {
    let g = gate();
    let f = Fake::default();
    let r = handle(&post("/api/pair-code", "{}"), &g, &f);
    assert_eq!(r.status, 200);
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    let code = v["code"].as_str().unwrap().to_string();
    assert_eq!(code.len(), 32);
    assert!(v["expires"].as_u64().unwrap() > 0);
    // 그 코드로 홈 화면 앱이 짝짓는다 — 한 번만, 홈 화면 앱 칸으로
    let mut p = pair_post(&code);
    p.body = format!(r#"{{"code":"{code}","home":true}}"#).into_bytes();
    p.headers.push(("user-agent".into(), "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)".into()));
    assert_eq!(handle(&p, &g, &f).status, 200);
    assert!(g.devices.list().iter().any(|d| d.name == "iPhone" && d.home), "{:?}", g.devices.list());
    assert_eq!(handle(&p, &g, &f).status, 401, "한 번만");
    // 열쇠 없이·남의 출처·JSON 아님은 거절
    assert_eq!(run(set(post("/api/pair-code", "{}"), "authorization", None)).0, 401);
    assert_eq!(run(set(post("/api/pair-code", "{}"), "origin", Some("http://evil.com"))).0, 403);
    assert_eq!(head_check(&set(post("/api/pair-code", "{}"), "authorization", None), &g).map(|r| r.status), Some(401));
    assert!(head_check(&post("/api/pair-code", "{}"), &g).is_none());
}

#[test]
fn 같은_사파리가_옛_열쇠를_내밀고_다시_짝지으면_줄이_안_는다() {
    let g = gate();
    let f = Fake::default();
    let ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)";
    let pair_body = |body: String| {
        let mut p = set(pair_post(""), "user-agent", Some(ua));
        p.body = body.into_bytes();
        let r = handle(&p, &g, &f);
        assert_eq!(r.status, 200);
        serde_json::from_slice::<serde_json::Value>(&r.body).unwrap()["token"].as_str().unwrap().to_string()
    };
    let c1 = g.devices.new_code(std::time::SystemTime::now()).unwrap();
    let t1 = pair_body(format!(r#"{{"code":"{c1}"}}"#));
    let before = g.devices.list().len();
    let c2 = g.devices.new_code(std::time::SystemTime::now()).unwrap();
    let t2 = pair_body(format!(r#"{{"code":"{c2}","prev":"{t1}"}}"#));
    assert_eq!(g.devices.list().len(), before, "줄이 늘었다");
    let env = |t: &str| handle(&set(get("/api/env"), "authorization", Some(&format!("Bearer {t}"))), &g, &f).status;
    assert_eq!(env(&t1), 401, "옛 열쇠는 죽는다");
    assert_eq!(env(&t2), 200);
    // 옛 열쇠가 틀린 모양이어도(길이·문자) 짝짓기는 되고 남의 줄은 안 건드린다
    let c3 = g.devices.new_code(std::time::SystemTime::now()).unwrap();
    let _ = pair_body(format!(r#"{{"code":"{c3}","prev":"{}"}}"#, "z".repeat(64)));
    assert_eq!(env(&t2), 200);
    assert_eq!(env(KEY), 200);
}

#[test]
fn 홈_화면_앱_연결_코드로_붙은_앱은_코드_낸_폰_아래로() {
    let g = gate();
    let f = Fake::default();
    let ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)";
    // 사파리가 먼저 QR 로 짝짓는다
    let c = g.devices.new_code(std::time::SystemTime::now()).unwrap();
    let r = handle(&set(set(pair_post(&c), "user-agent", Some(ua)), "content-type", Some("application/json")), &g, &f);
    let safari = serde_json::from_slice::<serde_json::Value>(&r.body).unwrap()["token"].as_str().unwrap().to_string();
    // 그 사파리 열쇠로 홈 화면 앱 코드를 받는다
    let r = handle(&set(post("/api/pair-code", "{}"), "authorization", Some(&format!("Bearer {safari}"))), &g, &f);
    let code = serde_json::from_slice::<serde_json::Value>(&r.body).unwrap()["code"].as_str().unwrap().to_string();
    let mut p = set(pair_post(&code), "user-agent", Some(ua));
    p.body = format!(r#"{{"code":"{code}","home":true}}"#).into_bytes();
    assert_eq!(handle(&p, &g, &f).status, 200);
    let l = g.devices.list();
    let iphone: Vec<_> = l.iter().filter(|d| d.name == "iPhone").collect();
    assert_eq!(iphone.len(), 2);
    assert_eq!(iphone[0].group, iphone[1].group, "같은 폰으로 묶여야 한다: {l:?}");
}

#[test]
fn 홈_화면_앱_연결_코드는_10초에_한_번_새_코드면_옛_코드는_죽는다() {
    let g = gate();
    let f = Fake::default();
    let first = handle(&post("/api/pair-code", "{}"), &g, &f);
    assert_eq!(first.status, 200);
    assert_eq!(handle(&post("/api/pair-code", "{}"), &g, &f).status, 429);
    let old: serde_json::Value = serde_json::from_slice(&first.body).unwrap();
    // 맥 설정에서 새 QR 을 만들면 폰이 받은 코드는 죽는다(코드는 한 번에 하나)
    let _ = g.devices.new_code(std::time::SystemTime::now()).unwrap();
    assert_eq!(handle(&pair_post(old["code"].as_str().unwrap()), &g, &f).status, 401);
}

#[test]
fn 보내기는_받자마자_202_치기는_뒤에서() {
    let g = gate();
    let f = Fake::default();
    let r = handle(&post("/api/send", r#"{"id":"aaaa0001","text":"긴 지시","cid":"m-1"}"#), &g, &f);
    assert_eq!(r.status, 202);
    assert_eq!(f.calls(), vec!["send aaaa0001 긴 지시"]);
    let s = handle(&with_cookie(get("/api/send-status?cid=m-1")), &g, &f);
    assert_eq!(serde_json::from_slice::<serde_json::Value>(&s.body).unwrap()["state"], "done");
}

#[test]
fn 같은_클라이언트_id_는_한_번만_친다() {
    // 폰이 응답을 못 받고(Load failed) 다시 보내도 글이 두 번 들어가지 않게(2026-10-03 참모-2 에 두 번 들어감)
    let g = gate();
    let f = Fake::default();
    let b = r#"{"id":"aaaa0001","text":"한 번만","cid":"m-2"}"#;
    assert_eq!(handle(&post("/api/send", b), &g, &f).status, 202);
    let r = handle(&post("/api/send", b), &g, &f);
    assert_eq!(r.status, 200);
    assert_eq!(serde_json::from_slice::<serde_json::Value>(&r.body).unwrap()["dup"], true);
    assert_eq!(f.calls().len(), 1);
    // 클라이언트 id 가 없는 옛 폰도 그대로 보낸다
    assert_eq!(handle(&post("/api/send", r#"{"id":"aaaa0001","text":"옛 폰"}"#), &g, &f).status, 202);
    assert_eq!(handle(&post("/api/send", r#"{"id":"aaaa0001","text":"x","cid":"a b"}"#), &g, &f).status, 400);
}

#[test]
fn 치기가_실패하면_상태로_알리고_같은_id_로_다시_보낼_수_있다() {
    let g = gate();
    let f = Fake { send_fail: true, ..Fake::default() };
    let b = r#"{"id":"aaaa0001","text":"실패","cid":"m-3"}"#;
    assert_eq!(handle(&post("/api/send", b), &g, &f).status, 202);
    let s: serde_json::Value = serde_json::from_slice(&handle(&with_cookie(get("/api/send-status?cid=m-3")), &g, &f).body).unwrap();
    assert_eq!(s["state"], "failed");
    assert!(s["error"].as_str().unwrap().contains("attach"));
    assert_eq!(handle(&post("/api/send", b), &g, &f).status, 202, "실패한 id 는 다시 받는다");
    assert_eq!(f.calls().len(), 2);
    let u: serde_json::Value = serde_json::from_slice(&handle(&with_cookie(get("/api/send-status?cid=zz")), &g, &f).body).unwrap();
    assert_eq!(u["state"], "unknown");
    assert_eq!(handle(&with_cookie(get("/api/send-status?cid=a%20b")), &g, &f).status, 400);
    assert_eq!(run(get("/api/send-status?cid=m-3")).0, 401);
}

#[test]
fn 큰_몸통은_읽기_마감을_크기만큼_늘린다() {
    let t = std::time::Instant::now();
    assert_eq!(body_deadline(t, 0), t);
    assert_eq!(body_deadline(t, 64_000), t + Duration::from_secs(1));
    // 10MB 그림 — 느린 LTE(초당 64KB)로도 끝나게, 상한 3분
    assert_eq!(body_deadline(t, 10 * 1024 * 1024), t + Duration::from_secs(164));
    assert_eq!(body_deadline(t, 100 * 1024 * 1024), t + Duration::from_secs(180));
}

#[test]
fn 앞_대화_거슬러_읽기는_세션_번호와_자리만() {
    let (code, f, _) = run(with_cookie(get(&format!("/api/transcript?id={SID}&before=4096"))));
    assert_eq!(code, 200);
    assert_eq!(f.calls(), vec![format!("before {SID} 4096")]);
    assert_eq!(run(with_cookie(get(&format!("/api/transcript?id={SID}&before=x")))).0, 400);
    assert_eq!(run(with_cookie(get("/api/transcript?id=../x&before=1"))).0, 400);
}

#[test]
fn 예약_목록을_못_읽으면_빈_목록이_아니라_이유를_준다() {
    // 스크립트가 실패해도 [] 를 줘서 폰엔 '예약 없음'처럼 보였다(2026-10-03 사용자 "아무것도 안 보이는 건 오늘 할 게 없다는 거야?")
    let f = Fake { routines_fail: true, ..Fake::default() };
    let (code, _, r) = run_with(with_cookie(get("/api/routines")), f);
    assert_eq!(code, 502);
    assert!(String::from_utf8_lossy(&r.body).contains("No such file"), "{}", String::from_utf8_lossy(&r.body));
    let (code, _, r) = run(with_cookie(get("/api/routines")));
    assert_eq!((code, String::from_utf8_lossy(&r.body).into_owned()), (200, r#"[{"name":"daily-check"}]"#.to_string()));
}

#[test]
fn 폰_그림_보기용과_썸네일_크기_quicklook() {
    let d = tmp("view");
    let small = d.join("v1.png");
    let mut b = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    b.extend_from_slice(&1800u32.to_be_bytes());
    b.extend_from_slice(&1500u32.to_be_bytes());
    std::fs::write(&small, &b).unwrap();
    let wide = d.join("full.png");
    let mut w = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    w.extend_from_slice(&4032u32.to_be_bytes());
    w.extend_from_slice(&9000u32.to_be_bytes());
    std::fs::write(&wide, &w).unwrap();
    let pdf = d.join("doc.pdf");
    std::fs::write(&pdf, b"%PDF-1.4").unwrap();
    let deck = d.join("deck.pptx");
    std::fs::write(&deck, b"PK").unwrap();
    let show: String = [&small, &wide, &pdf, &deck].iter().map(|p| format!("{{\"path\":\"{}\"}}\n", p.display())).collect();
    let fake = || Fake { show: show.clone(), data: d.join("data"), ..Default::default() };
    let file = |p: &Path, extra: &str| with_cookie(get(&format!("/api/file?path={}{extra}", enc(&p.to_string_lossy()))));
    let hdr = |r: &Resp, k: &str| r.headers.iter().find(|(n, _)| *n == k).map(|(_, v)| v.clone());

    // 보기용 — v1.png(1800×1500·작음)는 원본 그대로 + 원본 크기 머리
    let (s, f, r) = run_with(file(&small, "&view=1"), fake());
    assert_eq!((s, ctype(&r).as_str()), (200, "image/png"));
    assert!(f.calls().is_empty());
    assert_eq!(hdr(&r, "X-Image-Size").as_deref(), Some("1800x1500"));
    // 긴 변 2560 넘으면 JPEG 2560 으로
    let (_, f, r) = run_with(file(&wide, "&view=1"), fake());
    assert_eq!(ctype(&r), "image/jpeg");
    assert!(f.calls()[0].ends_with(".png Some(2560)"), "{:?}", f.calls());
    assert_eq!(hdr(&r, "X-Image-Size").as_deref(), Some("4032x9000"));
    // 썸네일 크기(360·720)
    let (_, f, _) = run_with(file(&small, "&thumb=1&size=720"), fake());
    assert!(f.calls()[0].ends_with(".png Some(720)"), "{:?}", f.calls());
    // PDF·오피스 썸네일은 QuickLook
    let (s, f, r) = run_with(file(&pdf, "&thumb=1&size=360"), fake());
    assert_eq!((s, ctype(&r).as_str(), f.calls()), (200, "image/jpeg", vec!["ql pdf 360".to_string()]));
    let (s, f, _) = run_with(file(&deck, "&thumb=1"), fake());
    assert_eq!((s, f.calls()), (200, vec!["ql pptx 480".to_string()]));
    // 오피스·영상 원본은 아직 안 연다(전략 표 8번) — 썸네일만
    assert_eq!(run_with(file(&deck, ""), fake()).0, 403);
}

#[test]
fn 참모_재우기는_hq_참모만_10초에_한_번() {
    // 사용자 "세션 깨우는 건 있는데 재우는 게 없다"(2026-10-03)
    let g = gate();
    let f = Fake::default();
    assert_eq!(handle(&post("/api/stop", r#"{"id":"aaaa0001"}"#), &g, &f).status, 200);
    assert_eq!(f.calls(), vec!["stop aaaa0001"]);
    assert_eq!(handle(&post("/api/stop", r#"{"id":"aaaa0001"}"#), &g, &f).status, 429, "연타");
    // 하위 세션은 폰에서 못 끈다(참모가 starter 갱신 뒤에 끈다) · 없는 세션 · 이상한 id
    assert_eq!(run(post("/api/stop", r#"{"id":"bbbb0002"}"#)).0, 404);
    assert_eq!(run(post("/api/stop", r#"{"id":"cccc0003"}"#)).0, 404);
    assert_eq!(run(post("/api/stop", r#"{"id":"../x"}"#)).0, 400);
    assert_eq!(run(set(post("/api/stop", r#"{"id":"aaaa0001"}"#), "origin", Some("http://evil.com"))).0, 403);
    assert!(head_check(&post("/api/stop", r#"{"id":"aaaa0001"}"#), &g).is_none());
    assert_eq!(head_check(&set(post("/api/stop", r#"{"id":"aaaa0001"}"#), "authorization", None), &g).map(|r| r.status), Some(401));
}

#[test]
fn 폰_보여준_목록은_내보낼_파일과_웹_주소만() {
    let d = tmp("shows");
    let ok = d.join("a.md");
    std::fs::write(&ok, "# a").unwrap();
    let show = format!(
        "{{\"path\":\"{}\",\"at\":{{\"find\":\"제목\"}}}}\n{{\"path\":\"/u/project-b/CLAUDE.local.md\",\"at\":{{\"find\":\"비번 1234\"}}}}\n{{\"path\":\"https://example.com/x\"}}\n{{\"path\":\"/u/.mcp.json\"}}\n{{\"path\":\"/u/infra.md\"}}\n깨진\n",
        ok.display()
    );
    let (s, _, r) = run_with(with_cookie(get("/api/shows")), Fake { show, data: d.join("data"), ..Default::default() });
    let body = String::from_utf8(r.body).unwrap();
    assert_eq!(s, 200);
    assert!(body.contains("a.md") && body.contains("제목") && body.contains("https://example.com/x"), "{body}");
    assert!(!body.contains("CLAUDE.local") && !body.contains("1234") && !body.contains(".mcp.json") && !body.contains("infra") && !body.contains("깨진"), "{body}");
}

#[test]
fn 폰_글_파일_비밀은_403_md_속_그림은_doc_으로() {
    let d = tmp("mdimg");
    std::fs::create_dir_all(d.join("shots")).unwrap();
    let doc = d.join("plan.md");
    std::fs::write(&doc, "# 계획\n![첫](shots/a.png)\n").unwrap();
    let pic = d.join("shots/a.png");
    std::fs::write(&pic, b"\x89PNG\r\n\x1a\n").unwrap();
    let other = d.join("shots/b.png");
    std::fs::write(&other, b"\x89PNG\r\n\x1a\n").unwrap();
    let leak = d.join("conf.ts");
    std::fs::write(&leak, "export const k = 'sk-proj-abcdefghijklmnopqrstuvwxyz012345';").unwrap();
    let code = d.join("app.ts");
    std::fs::write(&code, "export const a = 1;").unwrap();
    let show: String = [&doc, &leak, &code].iter().map(|p| format!("{{\"path\":\"{}\"}}\n", p.display())).collect();
    let fake = || Fake { show: show.clone(), data: d.join("data"), ..Default::default() };
    let file = |q: String| with_cookie(get(&format!("/api/file?{q}")));
    let e = |p: &Path| enc(&p.to_string_lossy());
    assert_eq!(run_with(file(format!("path={}", e(&code))), fake()).0, 200);
    assert_eq!(run_with(file(format!("path={}", e(&leak))), fake()).2.status, 403, "글 속 비밀");
    // 문서가 가리킨 그림은 doc 을 붙이면 열린다, 안 가리킨 그림·목록 밖 문서는 403
    assert_eq!(run_with(file(format!("path={}", e(&pic))), fake()).0, 403);
    let (s, _, r) = run_with(file(format!("path={}&doc={}&thumb=1", e(&pic), e(&doc))), fake());
    assert_eq!(s, 200, "{:?}", String::from_utf8_lossy(&r.body));
    assert_eq!(run_with(file(format!("path={}&doc={}", e(&other), e(&doc))), fake()).0, 403);
    assert_eq!(run_with(file(format!("path={}&doc={}", e(&pic), e(&d.join("nope.md")))), fake()).0, 403);
}

#[test]
fn 폰_html_시안은_표_주소로_스크립트만_허용() {
    // 전략 표 6번 — 폰 화면 CSP 를 srcdoc 이 물려받아 큐레이션 껍데기 스크립트가 안 돌았다(2026-10-03)
    let d = tmp("htmlt");
    let page = d.join("v1.html");
    std::fs::write(&page, "<!doctype html><html><head><title>시안</title></head><body><script>1</script></body></html>").unwrap();
    let leak = d.join("x.html");
    std::fs::write(&leak, "<script>const k='sk-proj-abcdefghijklmnopqrstuvwxyz012345'</script>").unwrap();
    let md = d.join("a.md");
    std::fs::write(&md, "# a").unwrap();
    let show: String = [&page, &leak, &md].iter().map(|p| format!("{{\"path\":\"{}\"}}\n", p.display())).collect();
    let g = gate();
    let f = Fake { show, data: d.join("data"), ..Default::default() };
    let ticket = |p: &Path| handle(&post("/api/html-ticket", &serde_json::json!({ "path": p.to_string_lossy() }).to_string()), &g, &f);
    let r = ticket(&page);
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let url = serde_json::from_slice::<serde_json::Value>(&r.body).unwrap()["url"].as_str().unwrap().to_string();
    assert!(url.starts_with("/api/html?t="), "{url}");
    // iframe 은 열쇠를 못 실으니 표만으로 — 응답은 sandbox allow-scripts(같은 출처 아님), 같은 출처 틀에만, 앞에 대체 저장소·크기 알림
    let h = handle(&get(&url), &g, &f);
    assert_eq!(h.status, 200);
    let hv = |k: &str| h.headers.iter().find(|(n, _)| *n == k).map(|(_, v)| v.clone()).unwrap_or_default();
    assert!(hv("Content-Security-Policy").starts_with("sandbox allow-scripts;"), "{}", hv("Content-Security-Policy"));
    assert!(!hv("Content-Security-Policy").contains("allow-same-origin"));
    assert!(hv("Content-Security-Policy").contains("connect-src 'none'"));
    assert_eq!(hv("X-Frame-Options"), "SAMEORIGIN");
    let body = String::from_utf8(h.body.clone()).unwrap();
    assert!(body.contains("<title>시안</title>") && body.contains("html-size") && body.find("html-size") < body.find("<title>"), "앞에 넣는다");
    // 다시 읽기(껍데기 reset 의 새로 고침)도 10분 안엔 된다
    assert_eq!(handle(&get(&url), &g, &f).status, 200);
    // 틀린 표·비밀 든 시안·md·목록 밖
    assert_eq!(handle(&get("/api/html?t=00112233445566778899aabbccddeeff"), &g, &f).status, 403);
    assert_eq!(ticket(&leak).status, 403);
    assert_eq!(ticket(&md).status, 400);
    assert_eq!(ticket(&d.join("nope.html")).status, 403);
    // 표 받기는 열쇠·같은 출처
    assert_eq!(handle(&set(post("/api/html-ticket", "{}"), "authorization", None), &g, &f).status, 401);
    assert!(head_check(&post("/api/html-ticket", "{}"), &g).is_none());
}

#[test]
fn 그림_박힌_큰_html_시안도_표_주소로_연다() {
    // 1MB 넘는 시안(그림을 data: 로 박은 것 — dev 에 2~8MB 가 20개 넘음)이 '폰에서 열 수 없는 시안'으로 막혔다(2026-10-04)
    let d = tmp("htmlbig");
    let page = d.join("big.html");
    let pic = "A".repeat(3 * 1024 * 1024);
    std::fs::write(&page, format!("<!doctype html><html><head><title>큰 시안</title></head><body><img src=\"data:image/png;base64,{pic}\"></body></html>")).unwrap();
    let huge = d.join("huge.html");
    std::fs::write(&huge, vec![b'a'; (MAX_HTML_FILE + 1) as usize]).unwrap();
    let show: String = [&page, &huge].iter().map(|p| format!("{{\"path\":\"{}\"}}\n", p.display())).collect();
    let g = gate();
    let f = Fake { show, data: d.join("data"), ..Default::default() };
    let ticket = |p: &Path| handle(&post("/api/html-ticket", &serde_json::json!({ "path": p.to_string_lossy() }).to_string()), &g, &f);
    let r = ticket(&page);
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let url = serde_json::from_slice::<serde_json::Value>(&r.body).unwrap()["url"].as_str().unwrap().to_string();
    let h = handle(&get(&url), &g, &f);
    assert_eq!(h.status, 200, "{}", String::from_utf8_lossy(&h.body));
    assert!(h.body.len() > 3 * 1024 * 1024 && String::from_utf8_lossy(&h.body).contains("html-size"));
    // 상한(10MB)을 넘으면 '못 열어요'가 아니라 크다고
    let r = ticket(&huge);
    assert_eq!((r.status, String::from_utf8_lossy(&r.body).to_string()), (413, "file too large".to_string()));
    let _ = std::fs::remove_dir_all(&d);
}

/// 실측 — 진짜 큰 시안을 표 주소로, 느린 LTE 처럼(초당 HTML_PROBE_KBPS, 기본 128KB) 읽어 끝까지 오나·비밀 검사 시간.
/// HTML_SECRET_PROBE=<html 경로> cargo test … -- --ignored --exact mobile_http::tests::실측_큰_시안_느린_lte로_끝까지 --nocapture
#[test]
#[ignore]
fn 실측_큰_시안_느린_lte로_끝까지() {
    let p = std::env::var("HTML_SECRET_PROBE").unwrap();
    let kbps: u64 = std::env::var("HTML_PROBE_KBPS").ok().and_then(|v| v.parse().ok()).unwrap_or(128);
    let b = std::fs::read(&p).unwrap();
    let t = std::time::Instant::now();
    let hit = mobile_files::secret_in(&b);
    eprintln!("secret_in {} bytes → {hit} in {:?}", b.len(), t.elapsed());
    let g = Arc::new(gate());
    let f = Arc::new(Fake { show: format!("{{\"path\":\"{p}\"}}\n"), data: tmp("probe").join("data"), ..Default::default() });
    let r = handle(&post("/api/html-ticket", &serde_json::json!({ "path": p }).to_string()), &g, &*f);
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let url = serde_json::from_slice::<serde_json::Value>(&r.body).unwrap()["url"].as_str().unwrap().to_string();
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    let client = std::thread::spawn(move || {
        let mut c = std::net::TcpStream::connect(addr).unwrap();
        c.write_all(format!("GET {url} HTTP/1.1\r\nHost: {HOST}\r\n\r\n").as_bytes()).unwrap();
        let (mut out, mut buf) = (Vec::new(), vec![0u8; 16 * 1024]);
        let t0 = std::time::Instant::now();
        loop {
            match c.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => out.extend_from_slice(&buf[..n]),
            }
            // 받은 양이 속도를 앞서면 쉰다
            let due = Duration::from_millis(out.len() as u64 * 1000 / (kbps * 1024));
            if let Some(w) = due.checked_sub(t0.elapsed()) { std::thread::sleep(w) }
        }
        (out, t0.elapsed())
    });
    let (s, _) = l.accept().unwrap();
    serve_conn_within(s, g, f, REQ_DEADLINE);
    let (out, took) = client.join().unwrap();
    let head_end = out.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
    let head = String::from_utf8_lossy(&out[..head_end]).to_string();
    let want: usize = head.lines().find_map(|l| l.strip_prefix("Content-Length: ")).unwrap().trim().parse().unwrap();
    eprintln!("{} · 몸 {}/{} 바이트 · {:?} (초당 {kbps}KB, 옛 마감 {:?})", head.lines().next().unwrap(), out.len() - head_end, want, took, REQ_DEADLINE * 2);
    assert!(head.starts_with("HTTP/1.1 200") && out.len() - head_end == want);
}

#[test]
fn 큰_응답은_쓰기_마감을_크기만큼_늘린다() {
    let t = std::time::Instant::now();
    let lim = Duration::from_secs(15);
    // 작은 응답은 그대로(읽기 마감의 두 배) — 조금씩 읽는 손님이 오래 못 잡게
    assert_eq!(write_deadline(t, lim, 0), t + lim * 2);
    assert_eq!(write_deadline(t, lim, 1024 * 1024), t + lim * 2);
    // 8MB 시안 — 느린 LTE(초당 64KB)로 131초, 상한 3분
    assert_eq!(write_deadline(t, lim, 8 * 1024 * 1024), t + Duration::from_secs(132));
    assert_eq!(write_deadline(t, lim, 100 * 1024 * 1024), t + Duration::from_secs(180));
}

#[test]
fn 폰_큐레이션_표시는_맥_curation_에_남긴다() {
    let d = tmp("cur");
    let page = d.join("v1.html");
    std::fs::write(&page, "<html></html>").unwrap();
    let show = format!("{{\"path\":\"{}\"}}\n", page.display());
    let fake = || Fake { show: show.clone(), data: d.join("data"), ..Default::default() };
    let body = serde_json::json!({ "path": page.to_string_lossy(), "text": "## 결과", "store": { "marks": { "a": "pick" } } }).to_string();
    let (s, f, _) = run_with(post("/api/curation", &body), fake());
    assert_eq!(s, 200);
    assert_eq!(f.calls(), vec![format!("curation {} ## 결과 {{\"marks\":{{\"a\":\"pick\"}}}}", page.display())]);
    let (s, f, r) = run_with(with_cookie(get(&format!("/api/curation-state?path={}", enc(&page.to_string_lossy())))), fake());
    assert_eq!((s, String::from_utf8(r.body).unwrap().as_str()), (200, r#"{"marks":{"a":"pick"}}"#));
    assert_eq!(f.calls().len(), 1);
    // 목록 밖 시안은 못 적는다
    let other = serde_json::json!({ "path": d.join("x.html").to_string_lossy(), "text": "x", "store": {} }).to_string();
    assert_eq!(run_with(post("/api/curation", &other), fake()).0, 403);
}

#[test]
fn 자기_csp_를_단_응답엔_공통_csp_를_겹쳐_달지_않는다() {
    let mut r = Resp::text(200, "x");
    r.headers.push(("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'".into()));
    r.headers.push(("X-Frame-Options", "SAMEORIGIN".into()));
    let mut out: Vec<u8> = Vec::new();
    write_resp(&mut out, &r, false, std::time::Instant::now() + Duration::from_secs(5)).unwrap();
    let t = String::from_utf8(out).unwrap();
    assert_eq!(t.matches("Content-Security-Policy").count(), 1, "{t}");
    assert_eq!(t.matches("X-Frame-Options").count(), 1, "{t}");
    // 보통 응답은 공통 머리 그대로
    let mut out: Vec<u8> = Vec::new();
    write_resp(&mut out, &Resp::text(200, "x"), false, std::time::Instant::now() + Duration::from_secs(5)).unwrap();
    let t = String::from_utf8(out).unwrap();
    assert!(t.contains("X-Frame-Options: DENY") && t.contains("frame-ancestors 'none'"));
}

#[test]
fn 폰_영상은_표_주소로_range_206() {
    // 전략 표 8번 — <video> 는 열쇠를 못 실어서 표 주소로, 큰 영상은 Range 로 나눠서
    let d = tmp("media");
    let v = d.join("clip.mp4");
    std::fs::write(&v, (0..3000u32).map(|i| (i % 256) as u8).collect::<Vec<_>>()).unwrap();
    let page = d.join("a.html");
    std::fs::write(&page, "<html></html>").unwrap();
    let show: String = [&v, &page].iter().map(|p| format!("{{\"path\":\"{}\"}}\n", p.display())).collect();
    let g = gate();
    let f = Fake { show, data: d.join("data"), ..Default::default() };
    let r = handle(&post("/api/media-ticket", &serde_json::json!({ "path": v.to_string_lossy() }).to_string()), &g, &f);
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let j: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(j["size"], 3000);
    let url = j["url"].as_str().unwrap().to_string();
    assert!(url.starts_with("/api/media?t="));
    let hv = |r: &Resp, k: &str| r.headers.iter().find(|(n, _)| *n == k).map(|(_, v)| v.clone()).unwrap_or_default();
    let ranged = |h: &str| handle(&set(get(&url), "range", Some(h)), &g, &f);
    let r = ranged("bytes=0-1");
    assert_eq!((r.status, r.body.as_slice()), (206, &[0u8, 1][..]));
    assert_eq!(hv(&r, "Content-Range"), "bytes 0-1/3000");
    assert_eq!(hv(&r, "Accept-Ranges"), "bytes");
    assert_eq!(ctype(&r), "video/mp4");
    assert_eq!(ranged("bytes=2990-").body.len(), 10);
    let r = ranged("bytes=5000-");
    assert_eq!((r.status, hv(&r, "Content-Range").as_str()), (416, "bytes */3000"));
    // 표가 틀리면·html 표로 영상은·영상 아닌 것에 영상 표는
    assert_eq!(handle(&get("/api/media?t=00112233445566778899aabbccddeeff"), &g, &f).status, 403);
    let h = handle(&post("/api/html-ticket", &serde_json::json!({ "path": page.to_string_lossy() }).to_string()), &g, &f);
    let hu = serde_json::from_slice::<serde_json::Value>(&h.body).unwrap()["url"].as_str().unwrap().replace("/api/html", "/api/media");
    assert_eq!(handle(&get(&hu), &g, &f).status, 403);
    assert_eq!(handle(&post("/api/media-ticket", &serde_json::json!({ "path": page.to_string_lossy() }).to_string()), &g, &f).status, 400);
    assert!(head_check(&post("/api/media-ticket", "{}"), &g).is_none());
}

#[test]
fn 폰_오피스_docx_는_글로_나머지는_맥에서_열기() {
    let d = tmp("office");
    let doc = d.join("기획.docx");
    std::fs::write(&doc, b"PK").unwrap();
    let deck = d.join("발표.pptx");
    std::fs::write(&deck, b"PK").unwrap();
    let show: String = [&doc, &deck].iter().map(|p| format!("{{\"path\":\"{}\"}}\n", p.display())).collect();
    let fake = || Fake { show: show.clone(), data: d.join("data"), ..Default::default() };
    let file = |p: &Path, extra: &str| with_cookie(get(&format!("/api/file?path={}{extra}", enc(&p.to_string_lossy()))));
    let (s, f, r) = run_with(file(&doc, "&as=html"), fake());
    assert_eq!((s, String::from_utf8(r.body).unwrap().as_str()), (200, "<p>워드 글</p>"));
    assert_eq!(f.calls(), vec!["doc_html docx"]);
    assert_eq!(run_with(file(&deck, "&as=html"), fake()).0, 403, "pptx 는 글로 못 바꾼다");
    // 큰 첫 장(1600)
    let (s, f, _) = run_with(file(&deck, "&thumb=1&size=1600"), fake());
    assert_eq!((s, f.calls()), (200, vec!["ql pptx 1600".to_string()]));
    // 맥에서 열기 — 보여 준 것만, 3초에 한 번
    let g = gate();
    let f = fake();
    let body = serde_json::json!({ "path": deck.to_string_lossy() }).to_string();
    assert_eq!(handle(&post("/api/open-mac", &body), &g, &f).status, 200);
    assert_eq!(handle(&post("/api/open-mac", &body), &g, &f).status, 429);
    assert_eq!(f.calls(), vec![format!("open {}", deck.display())]);
    assert_eq!(handle(&post("/api/open-mac", &serde_json::json!({ "path": d.join("x.pptx").to_string_lossy() }).to_string()), &g, &f).status, 403);
    assert!(head_check(&post("/api/open-mac", "{}"), &g).is_none());
}

#[test]
fn 폰_맥에서_열기는_문서_종류만_스크립트는_안_연다() {
    // 맥에서 열기는 맥 기본 앱으로 연다 — 코드·스크립트·html 은 열기만으로 실행되거나 브라우저 스크립트가 돈다(2026-10-03 참모 리뷰)
    let d = tmp("openmac");
    let files: Vec<std::path::PathBuf> = ["a.sh", "b.html", "c.js", "d.py", "e.pdf", "f.xlsx"].iter().map(|n| d.join(n)).collect();
    for p in &files { std::fs::write(p, b"x").unwrap(); }
    let show: String = files.iter().map(|p| format!("{{\"path\":\"{}\"}}\n", p.display())).collect();
    for (p, want) in files.iter().zip([403, 403, 403, 403, 200, 200]) {
        let g = gate();
        let f = Fake { show: show.clone(), data: d.join("data"), ..Default::default() };
        let body = serde_json::json!({ "path": p.to_string_lossy() }).to_string();
        assert_eq!(handle(&post("/api/open-mac", &body), &g, &f).status, want, "{}", p.display());
    }
}

#[test]
fn 직접_답하기_카드_읽기와_답하기는_기기_토큰과_같은_출처만() {
    // 읽기 — 토큰 없으면 401
    assert_eq!(run(get("/api/direct")).0, 401);
    let (s, f, r) = run(with_cookie(get("/api/direct")));
    assert_eq!((s, String::from_utf8_lossy(&r.body).to_string()), (200, "LOG".to_string()));
    assert_eq!(f.calls(), vec!["direct_log".to_string()]);
    // 답하기 — 몸통 받는 길(head_check)에도 있어야 진짜 서버에서 404 가 안 난다
    assert!(head_check(&post("/api/direct-answer", ""), &gate()).is_none(), "토큰·출처 맞으면 통과");
    let ok = r#"{"id":"ab12cd34","pick":{"pick":"yes"}}"#;
    let (s, f, _) = run(post("/api/direct-answer", ok));
    assert_eq!(s, 200);
    assert_eq!(f.calls(), vec!["direct_answer ab12cd34 Yes".to_string()]);
    // 다른 출처·토큰 없음·이상한 id·이상한 고르기는 거절(답 안 함)
    for (r, want) in [
        (set(post("/api/direct-answer", ok), "origin", Some("http://evil.com")), 403),
        (set(post("/api/direct-answer", ok), "authorization", None), 401),
        (post("/api/direct-answer", r#"{"id":"../x","pick":{"pick":"yes"}}"#), 400),
        (post("/api/direct-answer", r#"{"id":"ab12cd34","pick":{"pick":"rm"}}"#), 400),
    ] {
        let (s, f, _) = run(r);
        assert_eq!(s, want);
        assert!(f.calls().iter().all(|c| !c.starts_with("direct_answer")));
    }
    assert_eq!(run(with_cookie(get("/api/direct-answer"))).0, 405);
}

#[test]
fn 참모_제거는_hq_참모만_켜진_것도_꺼진_것도() {
    // 사용자 "우→좌 스와이프로 재울지 제거할지"(2026-10-03). claude rm 은 목록에서만 빼고 대화 기록 파일은 남는다(실측)
    let g = gate();
    let f = Fake::default();
    // 켜진 참모(aaaa0001) — 끄고 지우는 건 remove(stop+rm) 한 번
    assert_eq!(handle(&post("/api/remove", r#"{"id":"aaaa0001"}"#), &g, &f).status, 200);
    assert_eq!(handle(&post("/api/remove", r#"{"id":"aaaa0001"}"#), &g, &f).status, 429, "연타");
    // 꺼진 참모(aaaa0002)도
    assert_eq!(handle(&post("/api/remove", r#"{"id":"aaaa0002"}"#), &g, &f).status, 200);
    assert_eq!(f.calls(), vec!["remove aaaa0001", "remove aaaa0002"]);
    // 하위 세션(켜진 bbbb0002·꺼진 bbbb0003)·없는 것은 404, 이상한 id 400, 남의 출처 403
    for id in ["bbbb0002", "bbbb0003", "cccc0009"] {
        assert_eq!(run(post("/api/remove", &format!(r#"{{"id":"{id}"}}"#))).0, 404, "{id}");
    }
    assert_eq!(run(post("/api/remove", r#"{"id":"../x"}"#)).0, 400);
    assert_eq!(run(set(post("/api/remove", r#"{"id":"aaaa0001"}"#), "origin", Some("http://evil.com"))).0, 403);
    assert!(head_check(&post("/api/remove", r#"{"id":"aaaa0001"}"#), &g).is_none());
}

#[test]
fn 참모_고정은_데이터_폴더에_기기_상관없이() {
    // 사용자 "반대로 밀면 고정 어때? 항상 위"(2026-10-03) — 대화 id(재웠다 깨워도 같다)로, 고정한 순서대로
    let d = tmp("pins");
    let g = gate();
    let f = Fake { data: d.clone(), ..Default::default() };
    let a = "11111111-2222-4333-8444-555555555555";
    let b = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    let pins = |f: &Fake| String::from_utf8(handle(&with_cookie(get("/api/pins")), &g, f).body).unwrap();
    assert_eq!(pins(&f), "[]");
    let pin = |id: &str, on: bool| handle(&post("/api/pin", &serde_json::json!({ "sessionId": id, "on": on }).to_string()), &g, &f).status;
    assert_eq!(pin(b, true), 200);
    assert_eq!(pin(a, true), 200);
    assert_eq!(pin(b, true), 200, "이미 고정이면 그대로(자리 안 바뀜)");
    assert_eq!(pins(&f), format!(r#"["{b}","{a}"]"#));
    assert_eq!(pin(b, false), 200);
    assert_eq!(pins(&f), format!(r#"["{a}"]"#));
    // 파일은 0600
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(std::fs::metadata(d.join("orch-pins.json")).unwrap().permissions().mode() & 0o777, 0o600);
    // 이상한 id·남의 출처·열쇠 없음
    assert_eq!(pin("../x", true), 400);
    assert_eq!(handle(&set(post("/api/pin", &serde_json::json!({ "sessionId": a, "on": true }).to_string()), "origin", Some("http://evil.com")), &g, &f).status, 403);
    assert_eq!(handle(&get("/api/pins"), &g, &f).status, 401);
    assert!(head_check(&post("/api/pin", "{}"), &g).is_none());
    // 깨진 파일이면 덮어쓰지 않는다
    std::fs::write(d.join("orch-pins.json"), "[깨짐").unwrap();
    assert_eq!(pin(b, true), 502);
    assert_eq!(std::fs::read_to_string(d.join("orch-pins.json")).unwrap(), "[깨짐");
}

#[test]
fn 참모_이름_바꾸기는_hq_참모만_별명만() {
    // 사용자 "폰에서도 이름 바꾸기"(2026-10-04) — 앞의 참모-N 은 못 바꾼다(SendMessage 주소·색이 이름 번호), 별명만 맥 앱에 넘긴다
    let g = gate();
    let f = Fake::default();
    let r = |body: &str| handle(&post("/api/rename", body), &g, &f).status;
    assert_eq!(r(r#"{"id":"aaaa0001","nick":"  디자인   담당 "}"#), 202);
    assert_eq!(r(r#"{"id":"aaaa0001","nick":""}"#), 202, "빈 별명 = 설정 이름으로 되돌림");
    assert_eq!(f.calls(), vec!["rename aaaa0001 디자인 담당", "rename aaaa0001 "]);
    // 너무 긴 별명은 24자로, 줄바꿈·제어 글자는 빈칸
    assert_eq!(r(&format!(r#"{{"id":"aaaa0001","nick":"{}"}}"#, "가".repeat(40))), 202);
    assert_eq!(f.calls()[2], format!("rename aaaa0001 {}", "가".repeat(24)));
    assert_eq!(r(r#"{"id":"aaaa0001","nick":"a\nb\u0000c"}"#), 202);
    assert_eq!(f.calls()[3], "rename aaaa0001 a b c");
    // 하위 세션·없는 세션 404, 이상한 id 400, 별명 구분자(' · ')는 빼서 번호 칸을 못 건드린다
    assert_eq!(r(r#"{"id":"bbbb0002","nick":"x"}"#), 404);
    assert_eq!(r(r#"{"id":"../x","nick":"x"}"#), 400);
    assert_eq!(r(r#"{"id":"aaaa0001","nick":"참모-9 · 가짜"}"#), 202);
    assert_eq!(f.calls()[4], "rename aaaa0001 참모-9 가짜");
    assert_eq!(handle(&set(post("/api/rename", r#"{"id":"aaaa0001","nick":"x"}"#), "origin", Some("http://evil.com")), &g, &f).status, 403);
    assert!(head_check(&post("/api/rename", r#"{"id":"aaaa0001","nick":"x"}"#), &g).is_none());
}

#[test]
fn 참모_맡은_일은_hq_참모만_열쇠는_맥이_이름에서() {
    // 2026-10-04 사용자 "업무 담당 vs 그냥 이름" — 폰 길게 누르기 메뉴에서 맡은 일 한 줄. 열쇠는 폰이 주는 이름이 아니라 그 세션의 기본 이름
    let d = tmp("roles");
    let g = gate();
    let f = Fake { data: d.clone(), ..Default::default() };
    let roles = |f: &Fake| String::from_utf8(handle(&with_cookie(get("/api/roles")), &g, f).body).unwrap();
    assert_eq!(roles(&f), "{}");
    let set_role = |body: &str| handle(&post("/api/role", body), &g, &f).status;
    assert_eq!(set_role(r#"{"id":"aaaa0001","role":"  쇼핑몰\n개발  "}"#), 200);
    let v: serde_json::Value = serde_json::from_str(&roles(&f)).unwrap();
    assert_eq!(v["참모-1"]["role"], "쇼핑몰 개발");
    // 비우면 지움
    assert_eq!(set_role(r#"{"id":"aaaa0001","role":""}"#), 200);
    assert_eq!(roles(&f), "{}");
    // 하위 세션·없는 세션 404, 이상한 id 400, 남의 출처 403, 열쇠 없음 401, 머리 문지기 통과
    assert_eq!(set_role(r#"{"id":"bbbb0002","role":"x"}"#), 404);
    assert_eq!(set_role(r#"{"id":"cccc0009","role":"x"}"#), 404);
    assert_eq!(set_role(r#"{"id":"../x","role":"x"}"#), 400);
    assert_eq!(handle(&set(post("/api/role", r#"{"id":"aaaa0001","role":"x"}"#), "origin", Some("http://evil.com")), &g, &f).status, 403);
    assert_eq!(handle(&get("/api/roles"), &g, &f).status, 401);
    assert!(head_check(&post("/api/role", r#"{"id":"aaaa0001","role":"x"}"#), &g).is_none());
    // 0600, 깨진 파일은 덮지 않는다
    assert_eq!(set_role(r#"{"id":"aaaa0001","role":"y"}"#), 200);
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(std::fs::metadata(d.join("orch-roles.json")).unwrap().permissions().mode() & 0o777, 0o600);
    std::fs::write(d.join("orch-roles.json"), "{깨짐").unwrap();
    assert_eq!(set_role(r#"{"id":"aaaa0001","role":"z"}"#), 502);
    assert_eq!(std::fs::read_to_string(d.join("orch-roles.json")).unwrap(), "{깨짐");
}

#[test]
fn 새_참모는_맡은_일을_늘_덮어_쓴다() {
    // 꺼진 참모를 지우면 다음 새 참모가 같은 번호를 받는다 — 옛 맡은 일이 붙지 않게, 비워 만들어도 지운다(2026-10-04 QA ⑥)
    let d = tmp("spawn-role");
    std::fs::write(d.join("orch-roles.json"), r#"{"참모-4":{"role":"옛 일","at":1}}"#).unwrap();
    let f = Fake { data: d.clone(), ..Default::default() };
    assert_eq!(handle(&post("/api/spawn", r#"{"nick":"디자인"}"#), &gate(), &f).status, 200);
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join("orch-roles.json")).unwrap()).unwrap();
    assert_eq!(v["참모-4"]["role"], "", "옛 맡은 일은 지워지고");
    assert!(v["참모-4"]["born"].as_u64().is_some(), "태어난 때가 남는다(옛 기록을 안 세게)");
    let f = Fake { data: d.clone(), ..Default::default() };
    assert_eq!(handle(&post("/api/spawn", r#"{"nick":"디자인","role":"시안 그리기"}"#), &gate(), &f).status, 200);
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join("orch-roles.json")).unwrap()).unwrap();
    assert_eq!(v["참모-4"]["role"], "시안 그리기");
    // 파일이 깨져 있어도 참모는 띄운다
    std::fs::write(d.join("orch-roles.json"), "{깨짐").unwrap();
    let f = Fake { data: d.clone(), ..Default::default() };
    assert_eq!(handle(&post("/api/spawn", r#"{"nick":"디자인"}"#), &gate(), &f).status, 200);
    assert_eq!(std::fs::read_to_string(d.join("orch-roles.json")).unwrap(), "{깨짐");
}

#[test]
fn 폰_html_시안_앞에_글자_키움_막기를_head_맨_앞에_넣는다() {
    // 2026-10-04 아이폰이 줄여 보인 덱의 글자만 키워(text autosizing) 줄끼리 겹쳤다 — 원본은 안 고치고 내줄 때 넣는다
    let at = |html: &str, s: &str| inject_shim(html).find(s);
    let out = inject_shim("<!doctype html><html><HEAD lang=ko><meta charset=utf-8><title>t</title></HEAD><body>x</body></html>");
    assert!(out.starts_with(&format!("<!doctype html><html><HEAD lang=ko>{HTML_HEAD}<script>")), "{out}");
    assert!(HTML_HEAD.starts_with("<style>html{-webkit-text-size-adjust:100%;text-size-adjust:100%}") && HTML_HEAD.ends_with("</style>"));
    // 손가락으론 고르기 창 버튼 44px·메모 16px(작으면 아이폰이 확대) — 마우스 화면엔 안 건다
    assert!(HTML_HEAD.contains("@media (pointer:coarse){.cur-pick button{min-width:44px;min-height:44px}html .cur-pick input{height:44px;font-size:16px}}"));
    // 넣는 글엔 바깥으로 나가는 것(url·import·스크립트)이 없다 — CSP default-src 'none' 아래서 그대로 돈다
    assert!(!HTML_HEAD.contains("url(") && !HTML_HEAD.contains("@import") && !HTML_HEAD.contains("<script"));
    // 옛 검토 시안: 안쪽 가로 스크롤 덱(.decks) 폭까지 알린다(상한 4000)
    assert!(HTML_SHIM.contains("querySelectorAll('.decks')") && HTML_SHIM.contains("Math.min(4000,"));
    assert!(out.find("html-size") < out.find("<meta charset"), "저장소 대체가 시안 스크립트보다 먼저");
    // 시안이 직접 정한 값이 있으면 그게 이긴다(같은 세기, 뒤에 온 것)
    let own = "<html><head><style>html{-webkit-text-size-adjust:none}</style></head></html>";
    assert!(at(own, "text-size-adjust:100%") < at(own, "text-size-adjust:none"));
    // <head> 없이 <header> 만 있으면 그 안에 끼우지 않는다 — <html> 뒤로
    let out = inject_shim("<!DOCTYPE html>\n<html lang=\"ko\"><body><header>머리</header></body></html>");
    assert!(out.starts_with("<!DOCTYPE html>\n<html lang=\"ko\"><style>"), "{out}");
    assert!(out.contains("<header>머리</header>"));
    // <html> 도 없으면 doctype 뒤 — doctype 앞에 무엇이 오면 쿼크 모드가 된다
    let out = inject_shim("<!doctype html><body><p>a</p></body>");
    assert!(out.starts_with("<!doctype html><style>"), "{out}");
    // 조각이면 맨 앞, 빈 글도 깨지지 않는다
    assert!(inject_shim("<p>조각</p>").starts_with("<style>") && inject_shim("<p>조각</p>").ends_with("<p>조각</p>"));
    assert!(inject_shim("").starts_with("<style>"));
    // 끝나지 않은 <head 는 맨 앞으로(자르지 않는다)
    assert!(inject_shim("<head").ends_with("<head"));
    // 앞에 주석·BOM 이 있어도 doctype 뒤
    let out = inject_shim("\u{feff}<!-- 만든 날 --><!doctype html><div>a</div>");
    assert!(out.starts_with("\u{feff}<!-- 만든 날 --><!doctype html><style>"), "{out}");
    // 큰 시안(1MB 상한 꼭 맞게)도 원본 그대로 + 넣은 것
    let big = format!("<html><head></head><body>{}</body></html>", "가".repeat(340_000));
    let out = inject_shim(&big);
    assert_eq!(out.len(), big.len() + HTML_HEAD.len() + HTML_SHIM.len());
    assert!(out.ends_with(&big["<html><head>".len()..]));
}

#[test]
fn 계정_보기는_열쇠가_있어야_하고_쓰기는_같은_출처_json_만() {
    // 보기
    assert_eq!(run(get("/api/accounts")).0, 401);
    let (st, f, r) = run(with_cookie(get("/api/accounts")));
    assert_eq!((st, f.calls()), (200, vec!["accounts".to_string()]));
    assert!(String::from_utf8_lossy(&r.body).contains("큰 것"));
    // 바꾸기·자동 — 열쇠·출처·JSON·방법
    for (path, body) in [("/api/account-switch", r#"{"id":"a2"}"#), ("/api/account-auto", r#"{"on":false}"#)] {
        assert_eq!(run(set(post(path, body), "authorization", None)).0, 401, "{path}");
        assert_eq!(run(set(post(path, body), "origin", None)).0, 403, "{path}");
        assert_eq!(run(set(post(path, body), "origin", Some("http://evil.example"))).0, 403, "{path}");
        assert_eq!(run(set(post(path, body), "content-type", Some("text/plain"))).0, 403, "{path}");
        assert_eq!(run(with_cookie(get(path))).0, 405, "{path}");
        // 머리 문지기에도 길이 있다(없으면 실제 서버만 404)
        let g = gate();
        assert!(head_check(&post(path, body), &g).is_none(), "{path}");
        assert_eq!(head_check(&set(post(path, body), "authorization", None), &g).map(|r| r.status), Some(401), "{path}");
        assert_eq!(head_check(&set(post(path, body), "origin", Some("http://evil.example")), &g).map(|r| r.status), Some(403), "{path}");
        // 거절된 요청은 맥 쪽 일을 안 부른다
        let (_, f, _) = run(set(post(path, body), "origin", None));
        assert!(f.calls().is_empty(), "{path}");
    }
    assert_eq!(run(with_cookie(set(get("/api/accounts"), "host", Some("evil.example:47123")))).0, 403);
    assert_eq!(run(post("/api/accounts", "{}")).0, 405);
}

#[test]
fn 계정_바꾸기는_칸_id_모양만_받고_연타는_막는다() {
    let g = gate();
    let f = Fake::default();
    let sw = |id: &str| handle(&post("/api/account-switch", &serde_json::json!({ "id": id }).to_string()), &g, &f).status;
    for bad in ["", "../x", "a b", "a\nb", &"a".repeat(65), "backup-first", "backup-last"] {
        assert_eq!(sw(bad), 400, "{bad:?}");
    }
    assert_eq!(handle(&post("/api/account-switch", r#"{"id":"a1","x":1}"#), &g, &f).status, 400);
    assert_eq!(handle(&post("/api/account-switch", r#"{"id":5}"#), &g, &f).status, 400);
    assert!(f.calls().is_empty());
    assert_eq!(sw("a1700000000000"), 200);
    // 바꾸는 중 또 누름(다른 탭·두 번 탭) — 같은 문지기 안에서 몇 초에 한 번. 다른 칸이어도
    assert_eq!(sw("a2"), 429);
    assert_eq!(f.calls(), vec!["account_switch a1700000000000".to_string()]);
}

#[test]
fn 계정_바꾸기_실패는_이유_이름을_그대로_돌려준다() {
    let (st, _, r) = run_with(post("/api/account-switch", r#"{"id":"a2"}"#), Fake { account_fail: Some("locked"), ..Default::default() });
    assert_eq!((st, String::from_utf8_lossy(&r.body).to_string()), (502, "locked".to_string()));
}

#[test]
fn 자동_전환_토글은_불리언만() {
    let g = gate();
    let f = Fake::default();
    assert_eq!(handle(&post("/api/account-auto", r#"{"on":"yes"}"#), &g, &f).status, 400);
    assert_eq!(handle(&post("/api/account-auto", r#"{}"#), &g, &f).status, 400);
    assert_eq!(handle(&post("/api/account-auto", r#"{"on":false}"#), &g, &f).status, 200);
    assert_eq!(handle(&post("/api/account-auto", r#"{"on":true}"#), &g, &f).status, 200);
    assert_eq!(f.calls(), vec!["account_auto false".to_string(), "account_auto true".to_string()]);
}

#[test]
fn 맥_부하는_읽기만_load_json_과_자리() {
    // 사용자 "모바일에서 PC 부하도 볼 수 있어야 할 듯"(2026-10-05) — 앱이 적는 load.json + scripts/slot 자리 파일, 쓰기 길 아님
    let d = tmp("load");
    std::fs::create_dir_all(d.join("slots")).unwrap();
    std::fs::write(d.join("load.json"), r#"{"at":"2026-10-05T14:20:32.538Z","cores":10,"load1":138.32,"level":"high","sessions":[{"name":"헬로노트","project":"hello-docs","cpu":87,"mem":"2.2GB","top":[]}]}"#).unwrap();
    std::fs::write(d.join("slots/build.json"), r#"{"owner":"hello-docs","ts":1791209233.7,"extra":"x"}"#).unwrap();
    std::fs::write(d.join("slots/ios.json"), "{깨짐").unwrap();
    let g = gate();
    let f = Fake { data: d.clone(), ..Default::default() };
    let r = handle(&with_cookie(get("/api/load")), &g, &f);
    assert_eq!(r.status, 200);
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(v["load"]["load1"], serde_json::json!(138.32));
    assert_eq!(v["load"]["sessions"][0]["project"], "hello-docs");
    assert_eq!(v["slots"]["build"], serde_json::json!({ "owner": "hello-docs", "ts": 1791209233.7 }), "자리 파일은 주인·시각만");
    assert_eq!(v["slots"]["ios"], serde_json::Value::Null, "깨진 자리 파일은 비어 있음으로");
    assert_eq!(v["slots"]["galaxy"], serde_json::Value::Null);
    assert_eq!(v["ttl"], serde_json::json!({ "build": 2700, "ios": 3600, "galaxy": 1800 }));
    assert!(v["now"].as_u64().unwrap() > 1_700_000_000);
    // load.json 이 없으면 load 는 null(앱이 아직 안 잼)
    std::fs::remove_file(d.join("load.json")).unwrap();
    let v: serde_json::Value = serde_json::from_slice(&handle(&with_cookie(get("/api/load")), &g, &f).body).unwrap();
    assert_eq!(v["load"], serde_json::Value::Null);
    // 열쇠 없음·쓰기 시도·몸통 달린 요청
    assert_eq!(handle(&get("/api/load"), &g, &f).status, 401);
    assert_eq!(handle(&with_cookie(post("/api/load", "{}")), &g, &f).status, 405);
    assert_eq!(head_check(&post("/api/load", "{}"), &g).map(|r| r.status), Some(404), "쓰기 길 목록에 없다");
}

#[test]
fn 로그인_보기는_열쇠가_있어야_하고_쓰기는_같은_출처_json_만() {
    assert_eq!(run(get("/api/login")).0, 401);
    let (st, f, r) = run(with_cookie(get("/api/login")));
    assert_eq!((st, f.calls()), (200, vec!["login_view".to_string()]));
    assert!(String::from_utf8_lossy(&r.body).contains("imac"));
    assert_eq!(run(post("/api/login", "{}")).0, 405);
    for (path, body) in [("/api/login-start", "{}"), ("/api/login-code", r#"{"code":"abc#def"}"#), ("/api/login-cancel", "{}")] {
        assert_eq!(run(set(post(path, body), "authorization", None)).0, 401, "{path}");
        assert_eq!(run(set(post(path, body), "origin", None)).0, 403, "{path}");
        assert_eq!(run(set(post(path, body), "origin", Some("http://evil.example"))).0, 403, "{path}");
        assert_eq!(run(set(post(path, body), "content-type", Some("text/plain"))).0, 403, "{path}");
        assert_eq!(run(with_cookie(get(path))).0, 405, "{path}");
        let g = gate();
        assert!(head_check(&post(path, body), &g).is_none(), "{path}");
        assert_eq!(head_check(&set(post(path, body), "authorization", None), &g).map(|r| r.status), Some(401), "{path}");
        let (_, f, _) = run(set(post(path, body), "origin", None));
        assert!(f.calls().is_empty(), "{path}");
        assert_eq!(run(post(path, body)).0, 200, "{path}");
    }
}

#[test]
fn 로그인_코드는_한_줄_코드_모양만_받고_기록엔_값이_없다() {
    let g = gate();
    let f = Fake::default();
    let code = |c: &str| handle(&post("/api/login-code", &serde_json::json!({ "code": c }).to_string()), &g, &f).status;
    for bad in ["", "a\rb", "a\nb", "a b", "a;b", &"a".repeat(513)] {
        assert_eq!(code(bad), 400, "{bad:?}");
    }
    assert_eq!(handle(&post("/api/login-code", r#"{"code":"abc","x":1}"#), &g, &f).status, 400);
    assert_eq!(handle(&post("/api/login-code", r#"{"code":5}"#), &g, &f).status, 400);
    assert!(f.calls().is_empty());
    assert_eq!(code("Ab-9_x#st"), 200);
    assert_eq!(f.calls(), vec!["login_code 9".to_string()]);
}

#[test]
fn 로그인_시작은_연타를_막는다() {
    let g = gate();
    let f = Fake::default();
    assert_eq!(handle(&post("/api/login-start", "{}"), &g, &f).status, 200);
    assert_eq!(handle(&post("/api/login-start", "{}"), &g, &f).status, 429);
    assert_eq!(f.calls(), vec!["login_start".to_string()]);
}

#[test]
fn 세션_브라우저_개입은_떠_있는_브라우저에만_같은_출처로() {
    let ok = r#"{"profile":"shop-m","sessionPid":4242,"on":true}"#;
    let (code, f, _) = run(post("/api/browser-takeover", ok));
    assert_eq!(code, 200);
    assert_eq!(f.calls(), vec!["take shop-m 4242 true"]);
    let (_, f, _) = run(post("/api/browser-takeover", r#"{"profile":"shop-m","sessionPid":4242,"on":false}"#));
    assert_eq!(f.calls(), vec!["take shop-m 4242 false"]);
    assert_eq!(run(post("/api/browser-takeover", r#"{"profile":"other","sessionPid":4242,"on":true}"#)).0, 404);
    assert_eq!(run(post("/api/browser-takeover", r#"{"profile":"shop-m","sessionPid":1,"on":true}"#)).0, 404, "다른 세션 브라우저");
    assert_eq!(run(post("/api/browser-takeover", r#"{"profile":"../x","sessionPid":4242,"on":true}"#)).0, 400);
    assert_eq!(run(set(post("/api/browser-takeover", ok), "origin", Some("http://evil.com"))).0, 403);
    assert_eq!(run(set(post("/api/browser-takeover", ok), "authorization", None)).0, 401);
    assert_eq!(run(with_cookie(get("/api/browser-takeover"))).0, 405);
    assert!(head_check(&post("/api/browser-takeover", ok), &gate()).is_none(), "몸통 받는 길 목록에");
}

#[test]
fn 세션_브라우저_다시_시도는_떠_있는_브라우저에만_같은_출처로() {
    // 폰 브라우저 보기에서 화면을 못 받을 때 다시 시도(2026-10-09, 맥 모달의 다시 시도와 같은 agent_retry)
    let ok = r#"{"profile":"shop-m","sessionPid":4242}"#;
    let (code, f, _) = run(post("/api/browser-retry", ok));
    assert_eq!(code, 200);
    assert_eq!(f.calls(), vec!["retry shop-m"]);
    assert_eq!(run(post("/api/browser-retry", r#"{"profile":"shop-m","sessionPid":1}"#)).0, 404, "다른 세션 브라우저");
    assert_eq!(run(post("/api/browser-retry", r#"{"profile":"../x","sessionPid":4242}"#)).0, 400);
    assert_eq!(run(set(post("/api/browser-retry", ok), "origin", Some("http://evil.com"))).0, 403);
    assert_eq!(run(set(post("/api/browser-retry", ok), "authorization", None)).0, 401);
    assert_eq!(run(with_cookie(get("/api/browser-retry"))).0, 405);
    assert!(head_check(&post("/api/browser-retry", ok), &gate()).is_none(), "몸통 받는 길 목록에");
}

#[test]
fn 세션_브라우저_입력은_모양을_거르고_수를_막는다() {
    let ev = r#"{"kind":"mouse","type":"mousePressed","x":0.5,"y":0.5,"button":"left"}"#;
    let body = format!(r#"{{"profile":"shop-m","sessionPid":4242,"events":[{ev},{{"kind":"text","text":"안녕"}}]}}"#);
    let (code, f, _) = run(post("/api/browser-input", &body));
    assert_eq!(code, 200);
    assert_eq!(f.calls(), vec!["input shop-m 4242 2"]);
    let many = format!(r#"{{"profile":"shop-m","sessionPid":4242,"events":[{}]}}"#, vec![ev; 51].join(","));
    assert_eq!(run(post("/api/browser-input", &many)).0, 400, "한 번에 50개까지");
    assert_eq!(run(post("/api/browser-input", r#"{"profile":"shop-m","sessionPid":4242,"events":[{"kind":"evil"}]}"#)).0, 400);
    assert_eq!(run(post("/api/browser-input", r#"{"profile":"shop-m","sessionPid":9,"events":[]}"#)).0, 404);
    assert_eq!(run(set(post("/api/browser-input", &body), "origin", Some("http://evil.com"))).0, 403);
    assert!(head_check(&post("/api/browser-input", &body), &gate()).is_none());
}

#[test]
fn md1_hello_는_열쇠_없이_앱_표시만_준다() {
    // 다른 기기 참모가 '여기 참모가 있나·버전이 맞나'를 묻는다 — 이름·경로·세션 같은 건 하나도 안 준다
    let (st, f, r) = run(set(get("/api/hello"), "authorization", None));
    assert_eq!(st, 200);
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(v["app"], "chammo");
    assert_eq!(v["proto"], PROTO);
    assert!(v["version"].as_str().is_some_and(|s| !s.is_empty()));
    assert!(v["os"].as_str().is_some());
    let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
    assert_eq!(keys.len(), 4, "{keys:?}");
    assert!(f.calls().is_empty(), "맥 쪽 일은 안 부른다");
    // 문지기(Host·funnel)는 그대로, POST 는 안 받는다
    assert_eq!(run(set(get("/api/hello"), "host", Some("evil.com:47123"))).0, 403);
    assert_eq!(run(set(get("/api/hello"), "tailscale-funnel-request", Some("?1"))).0, 403);
    assert_eq!(run(post("/api/hello", "{}")).0, 405);
}

#[test]
fn md1_다른_참모_짝짓기는_peer_줄로_이름은_몸통에서() {
    let g = gate();
    let f = Fake::default();
    let code = g.devices.new_code(std::time::SystemTime::now()).unwrap();
    let mut r = set(pair_post(&code), "user-agent", Some("Chammo/0.2.6 (peer)"));
    r.body = format!(r#"{{"code":"{code}","peer":true,"name":"참모 · my-mac"}}"#).into_bytes();
    let resp = handle(&r, &g, &f);
    assert_eq!(resp.status, 200);
    let tok = serde_json::from_slice::<serde_json::Value>(&resp.body).unwrap()["token"].as_str().unwrap().to_string();
    let id = g.devices.check(&tok, std::time::SystemTime::now()).unwrap();
    let d = g.devices.list().into_iter().find(|d| d.id == id).unwrap();
    assert!(d.peer);
    assert_eq!(d.name, "참모 · my-mac");
    // 폰은 몸통 이름을 못 쓴다(이름은 UA 에서) — peer 가 아니면 name 은 무시
    let c2 = g.devices.new_code(std::time::SystemTime::now()).unwrap();
    let mut r2 = set(pair_post(&c2), "user-agent", Some("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"));
    r2.body = format!(r#"{{"code":"{c2}","name":"가짜 이름"}}"#).into_bytes();
    let t2 = serde_json::from_slice::<serde_json::Value>(&handle(&r2, &g, &f).body).unwrap()["token"].as_str().unwrap().to_string();
    let id2 = g.devices.check(&t2, std::time::SystemTime::now()).unwrap();
    assert_eq!(g.devices.list().into_iter().find(|d| d.id == id2).unwrap().name, "iPhone");
}

#[test]
fn 결정_답은_물음이_마지막일_때만_한_줄() {
    // 2026-10-06 사용자 폰: 결정 대기함 카드에 ㄱㄱ 를 보냈는데 폰이 answer 를 안 남겨 카드가 안 빠졌고 같은 답을 세 번 보냈다
    let log = [
        r#"{"ts":"2026-10-06T07:00:00Z","type":"send","task":"1006-1600-ab12","target":"shop"}"#,
        r#"{"ts":"2026-10-06T07:01:00Z","type":"ask","task":"1006-1600-ab12","note":"배포할까?","to":"aaaa0001"}"#,
        r#"{"ts":"2026-10-06T07:02:00Z","type":"send","task":"1006-1600-cd34","target":"shop"}"#,
        r#"{"ts":"2026-10-06T07:03:00Z","type":"ask","task":"1006-1600-cd34","note":"머지?"}"#,
        r#"{"ts":"2026-10-06T07:04:00Z","type":"answer","task":"1006-1600-cd34","note":"해"}"#,
        r#"{"ts":"2026-10-06T07:05:00Z","type":"ask","task":"report-fix","note":"보낼까?"}"#,
        r#"{"ts":"2026-10-06T07:06:00Z","type":"send","task":"report-fix","target":"ops"}"#,
        "깨진 줄",
    ]
    .join("\n");
    let g = gate();
    let f = Fake { task_log: log, ..Default::default() };
    let ans = |body: &str| handle(&post("/api/task-answer", body), &g, &f).status;
    let rows = |f: &Fake| f.calls().iter().filter_map(|c| c.strip_prefix("append_task ").map(|l| serde_json::from_str::<serde_json::Value>(l).unwrap())).collect::<Vec<_>>();
    // 몸통 받는 길(head_check)에도 있어야 진짜 서버에서 404 가 안 난다
    assert!(head_check(&post("/api/task-answer", "{}"), &g).is_none());
    // 이상한 id·빈 답·너무 긴 답은 거절 — 기록 안 함
    assert_eq!(ans(r#"{"task":"../x","note":"응"}"#), 400);
    assert_eq!(ans(r#"{"task":"a b","note":"응"}"#), 400);
    assert_eq!(ans(&serde_json::json!({ "task": "x".repeat(41), "note": "응" }).to_string()), 400);
    assert_eq!(ans(r#"{"task":"1006-1600-ab12","note":"  "}"#), 400);
    assert_eq!(ans(&serde_json::json!({ "task": "1006-1600-ab12", "note": "가".repeat(8_001) }).to_string()), 400);
    assert!(rows(&f).is_empty());
    // 물음이 마지막(send 는 건너뜀)이면 answer 한 줄 — 답 글은 다듬고 제어 문자는 뺀다, by 폰
    assert_eq!(ans(r#"{"task":"1006-1600-ab12","note":" ㄱ\u001bㄱ "}"#), 200);
    let r = rows(&f);
    assert_eq!(r.len(), 1);
    assert_eq!((r[0]["type"].as_str(), r[0]["task"].as_str(), r[0]["note"].as_str(), r[0]["by"].as_str()), (Some("answer"), Some("1006-1600-ab12"), Some("ㄱㄱ"), Some("phone")));
    assert!(r[0]["ts"].as_str().is_some_and(|t| t.len() == 20 && t.ends_with('Z')), "{}", r[0]["ts"]);
    // 같은 일에 곧바로 또 — 429(맥 기록이 아직 안 바뀐 사이 두 번 붙지 않게)
    assert_eq!(ans(r#"{"task":"1006-1600-ab12","note":"ㄱㄱ"}"#), 429);
    // 이미 답한 일·없는 일 — 409, 안 붙임
    assert_eq!(ans(r#"{"task":"1006-1600-cd34","note":"해"}"#), 409);
    assert_eq!(ans(r#"{"task":"1006-1600-ffff","note":"해"}"#), 409);
    // 옛 모양 id 도 물음이 마지막이면 된다(send 뒤에 와도 마지막 '물음'으로 본다 — 앱 waitingList 와 같이)
    assert_eq!(ans(r#"{"task":"report-fix","note":"보내"}"#), 200);
    assert_eq!(rows(&f).len(), 2);
    // 응답이 끊겨 폰이 다시 누름 — 2분 안에 폰이 같은 답을 남겼으면 새 줄 없이 200(폰이 그때 글을 보낸다). 다른 답·데스크톱 답·오래된 답은 409
    let now = crate::direct::chrono_now();
    let replay = [
        format!(r#"{{"ts":"{now}","type":"ask","task":"1006-1700-aa01","note":"배포?"}}"#),
        format!(r#"{{"ts":"{now}","type":"answer","task":"1006-1700-aa01","note":"ㄱㄱ","by":"phone"}}"#),
        format!(r#"{{"ts":"{now}","type":"ask","task":"1006-1700-aa02","note":"배포?"}}"#),
        format!(r#"{{"ts":"{now}","type":"answer","task":"1006-1700-aa02","note":"ㄱㄱ"}}"#),
        r#"{"ts":"2026-10-06T07:00:00Z","type":"ask","task":"1006-1700-aa03","note":"배포?"}"#.to_string(),
        r#"{"ts":"2026-10-06T07:00:01Z","type":"answer","task":"1006-1700-aa03","note":"ㄱㄱ","by":"phone"}"#.to_string(),
    ]
    .join("\n");
    let f2 = Fake { task_log: replay, ..Default::default() };
    let g2 = gate();
    let ans2 = |body: &str| handle(&post("/api/task-answer", body), &g2, &f2);
    let r = ans2(r#"{"task":"1006-1700-aa01","note":"ㄱㄱ"}"#);
    assert_eq!((r.status, String::from_utf8_lossy(&r.body).contains(r#""again":true"#)), (200, true));
    assert_eq!(ans2(r#"{"task":"1006-1700-aa01","note":"아니"}"#).status, 429, "같은 일 5초 문지기가 먼저");
    assert_eq!(ans2(r#"{"task":"1006-1700-aa02","note":"ㄱㄱ"}"#).status, 409, "데스크톱이 답한 것");
    assert_eq!(ans2(r#"{"task":"1006-1700-aa03","note":"ㄱㄱ"}"#).status, 409, "오래된 폰 답");
    assert!(rows(&f2).is_empty());
    // 남의 출처·열쇠 없음·GET
    assert_eq!(handle(&set(post("/api/task-answer", r#"{"task":"1006-1600-ab12","note":"x"}"#), "origin", Some("http://evil.com")), &g, &f).status, 403);
    assert_eq!(handle(&set(post("/api/task-answer", r#"{"task":"1006-1600-ab12","note":"x"}"#), "authorization", None), &g, &f).status, 401);
    assert_eq!(handle(&with_cookie(get("/api/task-answer")), &g, &f).status, 405);
    assert_eq!(rows(&f).len(), 2);
}

#[test]
fn 폰_진단_한줄은_키값_낱말만_10초에_한번() {
    let g = gate();
    let f = Fake::default();
    let ok = r#"{"kind":"vp-ghost","line":"ev=focusout vvH=590 innerH=590 tallH=932 typing=0 ios=26.0.1"}"#;
    assert!(head_check(&post("/api/diag", ok), &g).is_none(), "head_check 몸통 받는 길 목록에 있어야 진짜 서버도 받는다");
    assert_eq!(handle(&post("/api/diag", ok), &g, &f).status, 200);
    assert_eq!(handle(&post("/api/diag", ok), &g, &f).status, 429, "연타는 10초에 한 번");
    assert_eq!(f.calls(), vec!["diag vp-ghost ev=focusout vvH=590 innerH=590 tallH=932 typing=0 ios=26.0.1 dev=test"], "어느 폰인지 기기 id 앞 4자");
    // 글 내용·띄어쓰기 낀 값·이상한 종류는 통째로 거절(기록에 아무것도 안 남는다)
    let g = gate();
    let f = Fake::default();
    for bad in [
        r#"{"kind":"vp-ghost","line":"ev=비밀 글"}"#,
        r#"{"kind":"vp-ghost","line":"note=hello world"}"#,
        r#"{"kind":"vp-ghost","line":"just text"}"#,
        r#"{"kind":"vp ghost","line":"ev=x"}"#,
        r#"{"kind":"vp-ghost","line":""}"#,
        r#"{"kind":"vp-ghost","line":"ev=x","extra":1}"#,
    ] {
        assert_eq!(handle(&post("/api/diag", bad), &g, &f).status, 400, "{bad}");
    }
    let long = (0..40).map(|i| format!("k{}=1", "a".repeat(i % 5 + 1))).collect::<Vec<_>>().join(" ");
    assert_eq!(handle(&post("/api/diag", &serde_json::json!({ "kind": "vp-ghost", "line": long }).to_string()), &g, &f).status, 400, "30칸 넘으면 거절");
    assert!(f.calls().is_empty());
    // 문지기 — 다른 출처·열쇠 없음·GET
    assert_eq!(handle(&set(post("/api/diag", ok), "origin", Some("http://evil.com")), &g, &f).status, 403);
    assert_eq!(handle(&set(post("/api/diag", ok), "authorization", None), &g, &f).status, 401);
    assert_eq!(handle(&with_cookie(get("/api/diag")), &g, &f).status, 405);
    assert!(f.calls().is_empty());
}

/// 작업 기록 이어 받기 — 폰이 5초마다 꼬리 512KB 를 통째로 다시 받던 것(2026-10-08 fix/debt-perf). from = 지난번 next
fn tasks_get(f: &Fake, q: &str) -> (u16, serde_json::Value) {
    let r = handle(&with_cookie(get(&format!("/api/tasks?{q}"))), &gate(), f);
    let body = String::from_utf8_lossy(&r.body).into_owned();
    let Some((meta, text)) = body.split_once('\n') else { return (r.status, serde_json::Value::Null) };
    let mut v: serde_json::Value = serde_json::from_str(meta).unwrap_or_default();
    v["text"] = text.into();
    (r.status, v)
}

#[test]
fn t1_작업_기록은_바뀐_줄만_이어_받는다() {
    let d = tmp("tasks-tail");
    let log = d.join("tasks.jsonl");
    std::fs::write(&log, "{\"a\":1}\n{\"b\":2}\n").unwrap();
    let f = Fake { data: d.clone(), ..Default::default() };
    let (s, v) = tasks_get(&f, "from=0");
    assert_eq!((s, v["text"].as_str(), v["next"].as_u64(), v["reset"].as_bool()), (200, Some("{\"a\":1}\n{\"b\":2}\n"), Some(16), Some(false)));
    // 안 바뀌었으면 빈 글
    let (_, v) = tasks_get(&f, "from=16");
    assert_eq!((v["text"].as_str(), v["next"].as_u64()), (Some(""), Some(16)));
    // 새 줄 + 쓰는 중인 줄 — 온전한 줄만, 다음 자리는 그 줄 끝
    std::fs::OpenOptions::new().append(true).open(&log).unwrap().write_all(b"{\"c\":3}\n{\"d\"").unwrap();
    let (_, v) = tasks_get(&f, "from=16");
    assert_eq!((v["text"].as_str(), v["next"].as_u64(), v["reset"].as_bool()), (Some("{\"c\":3}\n"), Some(24), Some(false)));
    // 파일이 줄었으면(자리가 안 맞음) 처음부터 다시
    let (_, v) = tasks_get(&f, "from=9999");
    assert_eq!((v["reset"].as_bool(), v["next"].as_u64()), (Some(true), Some(24)));
    assert!(v["text"].as_str().unwrap().starts_with("{\"a\":1}\n"));
    assert_eq!(tasks_get(&f, "from=x").0, 400);
    // 옛 폰 화면(캐시된 페이지)은 from 없이 — 예전처럼 글 그대로
    let r = handle(&with_cookie(get("/api/tasks")), &gate(), &f);
    assert_eq!((r.status, String::from_utf8_lossy(&r.body).into_owned()), (200, "{}\n".to_string()));
}

#[test]
fn t2_큰_작업_기록은_꼬리_512kb_만_그리고_파일이_없으면_빈_것() {
    let d = tmp("tasks-big");
    let line = format!("{{\"x\":\"{}\"}}\n", "가".repeat(100));
    let n = 600 * 1024 / line.len() + 1;
    std::fs::write(d.join("tasks.jsonl"), line.repeat(n)).unwrap();
    let f = Fake { data: d.clone(), ..Default::default() };
    // from=0 이라도 512KB 넘게 뒤처졌으면 꼬리만(처음 받기와 같다)
    let (_, v) = tasks_get(&f, "from=0");
    let t = v["text"].as_str().unwrap();
    assert!(t.len() <= 512 * 1024 && t.len() > 500 * 1024, "{}", t.len());
    assert!(t.starts_with("{\"x\"") && v["reset"] == true);
    assert_eq!(v["next"].as_u64(), Some((line.len() * n) as u64));
    let f = Fake { data: tmp("tasks-none"), ..Default::default() };
    let (s, v) = tasks_get(&f, "from=0");
    assert_eq!((s, v["text"].as_str(), v["next"].as_u64()), (200, Some(""), Some(0)));
}

/// 실측(읽기만): TASKS_SRC=<tasks.jsonl 복사본> cargo test tasks_bytes_measure -- --ignored --nocapture
/// 진짜 TCP 로 응답 전체(머리+몸통) 바이트 — 처음 받기·안 바뀐 5초·한 줄(332B) 붙은 5초
#[test]
#[ignore]
fn tasks_bytes_measure() {
    let src = std::env::var("TASKS_SRC").expect("TASKS_SRC");
    let d = tmp("tasks-measure");
    std::fs::copy(&src, d.join("tasks.jsonl")).unwrap();
    let be: Arc<dyn Backend> = Arc::new(Fake { data: d.clone(), task_log: std::fs::read_to_string(&src).unwrap(), ..Default::default() });
    let g = Arc::new(gate());
    let fetch = |path: &str| -> (usize, Vec<u8>) {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        let p = path.to_string();
        let c = std::thread::spawn(move || {
            let mut c = std::net::TcpStream::connect(addr).unwrap();
            c.write_all(format!("GET {p} HTTP/1.1\r\nHost: {HOST}\r\nAuthorization: Bearer {KEY}\r\n\r\n").as_bytes()).unwrap();
            let mut all = Vec::new();
            c.read_to_end(&mut all).unwrap();
            all
        });
        let (s, _) = l.accept().unwrap();
        serve_conn_within(s, g.clone(), be.clone(), Duration::from_secs(5));
        let all = c.join().unwrap();
        let body = all.windows(4).position(|w| w == b"\r\n\r\n").map(|i| all[i + 4..].to_vec()).unwrap_or_default();
        (all.len(), body)
    };
    let next = |b: &[u8]| b.split(|&c| c == b'\n').next().and_then(|m| serde_json::from_slice::<serde_json::Value>(m).ok()).and_then(|v| v["next"].as_u64());
    let (old, _) = fetch("/api/tasks");
    let (first, b) = fetch("/api/tasks?from=0");
    let n = next(&b).unwrap_or(0);
    let (same, _) = fetch(&format!("/api/tasks?from={n}"));
    let line = format!("{{\"ts\": \"2026-10-08T10:48:43+00:00\", \"type\": \"send\", \"task\": \"0101-0000-abcd\", \"title\": \"{}\"}}\n", "가".repeat(90));
    std::fs::OpenOptions::new().append(true).open(d.join("tasks.jsonl")).unwrap().write_all(line.as_bytes()).unwrap();
    let (one, _) = fetch(&format!("/api/tasks?from={n}"));
    println!("MEASURE old_full={old} first={first} unchanged={same} one_line({})={one}", line.len());
}

fn shows_get(f: &Fake, q: &str) -> (u16, serde_json::Value) {
    let r = handle(&with_cookie(get(&format!("/api/shows?{q}"))), &gate(), f);
    let body = String::from_utf8_lossy(&r.body).into_owned();
    let Some((meta, text)) = body.split_once('\n') else { return (r.status, serde_json::Value::Null) };
    let mut v: serde_json::Value = serde_json::from_str(meta).unwrap_or_default();
    v["text"] = text.into();
    (r.status, v)
}

#[test]
fn t2_보여_준_기록은_안_바뀌면_글_없이() {
    let show = |s: &str| Fake { show: s.into(), data: "/nonexistent-data".into(), ..Default::default() };
    let one = "{\"path\":\"https://example.com/a\",\"from\":\"aaaa0001\"}\n";
    // 처음(빈 since) — 꼬리표 + 거른 기록 통째
    let (s, v) = shows_get(&show(one), "since=");
    assert_eq!((s, v["same"].as_bool(), v["text"].as_str()), (200, Some(false), Some(one)));
    let tag = v["tag"].as_str().unwrap().to_string();
    assert!(!tag.is_empty());
    // 그대로면 글 없이 같은 꼬리표
    let (s, v) = shows_get(&show(one), &format!("since={tag}"));
    assert_eq!((s, v["same"].as_bool(), v["text"].as_str(), v["tag"].as_str()), (200, Some(true), Some(""), Some(tag.as_str())));
    // 한 줄 늘면 새 꼬리표 + 통째
    let two = format!("{one}{{\"path\":\"https://example.com/b\",\"from\":\"aaaa0001\"}}\n");
    let (_, v) = shows_get(&show(&two), &format!("since={tag}"));
    assert_eq!((v["same"].as_bool(), v["text"].as_str()), (Some(false), Some(two.as_str())));
    assert_ne!(v["tag"].as_str(), Some(tag.as_str()));
    // 폰에 못 내는 줄만 늘었으면 거른 글이 같아서 그대로
    let (_, v) = shows_get(&show(&format!("{one}{{\"path\":\"/u/.mcp.json\"}}\n")), &format!("since={tag}"));
    assert_eq!(v["same"].as_bool(), Some(true));
    // since 없이(옛 폰 화면) — 예전처럼 기록 글만
    let (s, _, r) = run_with(with_cookie(get("/api/shows")), show(one));
    assert_eq!((s, String::from_utf8_lossy(&r.body).into_owned()), (200, one.to_string()));
}

/// 실측(읽기만): SHOWS_SRC=<show.jsonl 복사본> cargo test shows_bytes_measure -- --ignored --nocapture
/// 몸통 바이트 — 옛 길(통째)·처음 받기·안 바뀐 5초
#[test]
#[ignore]
fn shows_bytes_measure() {
    let src = std::fs::read_to_string(std::env::var("SHOWS_SRC").expect("SHOWS_SRC")).unwrap();
    let h = std::path::PathBuf::from(crate::platform::home());
    let show = crate::mobile_files::resolve_show_log(&crate::reader::fair_tail(&src, 64 * 1024), &std::fs::canonicalize(&h).unwrap_or(h));
    let f = Fake { show, data: tmp("shows-measure"), ..Default::default() };
    let body = |q: &str| handle(&with_cookie(get(&format!("/api/shows{q}"))), &gate(), &f).body;
    let old = body("");
    let first = body("?since=");
    let (_, v) = shows_get(&f, "since=");
    let same = body(&format!("?since={}", v["tag"].as_str().unwrap()));
    println!("MEASURE old_full={} first={} unchanged={}", old.len(), first.len(), same.len());
}

#[test]
fn t3_세션_목록도_안_바뀌면_글_없이() {
    let get_q = |q: &str| {
        let r = handle(&with_cookie(get(&format!("/api/sessions{q}"))), &gate(), &Fake::default());
        (r.status, String::from_utf8_lossy(&r.body).into_owned())
    };
    // since 없이 — 옛 화면·다른 기기 참모(remote)는 JSON 그대로
    let (s, raw) = get_q("");
    assert_eq!(s, 200);
    assert!(raw.starts_with('['), "{raw}");
    let (_, first) = get_q("?since=");
    let (meta, text) = first.split_once('\n').unwrap();
    let m: serde_json::Value = serde_json::from_str(meta).unwrap();
    assert_eq!((m["same"].as_bool(), text), (Some(false), raw.as_str()));
    let (_, again) = get_q(&format!("?since={}", m["tag"].as_str().unwrap()));
    assert_eq!(again, format!("{}\n", serde_json::json!({ "tag": m["tag"], "same": true })));
}

#[test]
fn p1_폰_프로필_쓰기는_켜진_참모만_데스크톱과_같은_검사로() {
    // 2026-10-05 폰 프로필 창은 이름만 — 모양·색·목소리도 폰에서(2026-10-09). 열쇠는 폰이 주는 게 아니라 그 세션의 기본 이름
    let d = tmp("avatar-write");
    let g = gate();
    let f = Fake { data: d.clone(), ..Default::default() };
    let put = |body: &str| handle(&post("/api/avatar", body), &g, &f);
    let r = put(r##"{"id":"aaaa0001","avatar":{"kind":"preset","shape":"star","eyes":"dark","color":"#1f9a62","voice":"F2"}}"##);
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!((v["key"].as_str(), v["avatar"]["shape"].as_str(), v["avatar"]["voice"].as_str()), (Some("참모-1"), Some("star"), Some("F2")));
    let saved: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join("avatars/참모-1.json")).unwrap()).unwrap();
    assert_eq!((saved["color"].as_str(), saved["eyes"].as_str()), (Some("#1f9a62"), Some("dark")));
    // 데스크톱(avatar::check)과 같은 검사 — 없는 목소리·이상한 색은 400, 그림은 폰에서 못 올린다(있던 그림이 없으면 400)
    assert_eq!(put(r#"{"id":"aaaa0001","avatar":{"kind":"preset","shape":"star","eyes":"dark","color":null,"voice":"X9"}}"#).status, 400);
    assert_eq!(put(r#"{"id":"aaaa0001","avatar":{"kind":"preset","shape":"star","eyes":"dark","color":"red"}}"#).status, 400);
    assert_eq!(put(r#"{"id":"aaaa0001","avatar":{"kind":"image","crop":{"zoom":1,"x":0,"y":0}}}"#).status, 400);
    // 그림 프사면 목소리·자르기만 바꾼다(있던 그림 그대로)
    std::fs::write(d.join("avatars/참모-1.png"), b"\x89PNG\r\n\x1a\nxx").unwrap();
    let r = put(r#"{"id":"aaaa0001","avatar":{"kind":"image","file":"../../x","crop":{"zoom":1.5,"x":0,"y":0},"voice":"M3"}}"#);
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!((v["avatar"]["file"].as_str(), v["avatar"]["voice"].as_str()), (Some("참모-1.png"), Some("M3")));
    // 처음대로 — avatar null 이면 지운다
    assert_eq!(put(r#"{"id":"aaaa0001","avatar":null}"#).status, 200);
    assert!(!d.join("avatars/참모-1.json").exists() && !d.join("avatars/참모-1.png").exists());
    // 하위 세션·없는 세션 404, 이상한 id·모르는 칸 400, 남의 출처 403, 열쇠 없음 401, GET 405, 머리 문지기 통과
    let ok = r#"{"id":"aaaa0001","avatar":{"kind":"preset","shape":"star","eyes":"dark"}}"#;
    assert_eq!(put(r#"{"id":"bbbb0002","avatar":{"kind":"preset","shape":"star","eyes":"dark"}}"#).status, 404);
    assert_eq!(put(r#"{"id":"cccc0009","avatar":{"kind":"preset","shape":"star","eyes":"dark"}}"#).status, 404);
    assert_eq!(put(r#"{"id":"../x","avatar":null}"#).status, 400);
    assert_eq!(put(r#"{"id":"aaaa0001","avatar":null,"key":"남의-키"}"#).status, 400);
    assert_eq!(handle(&set(post("/api/avatar", ok), "origin", Some("http://evil.com")), &g, &f).status, 403);
    assert_eq!(handle(&set(post("/api/avatar", ok), "authorization", None), &g, &f).status, 401);
    assert_eq!(handle(&with_cookie(get("/api/avatar")), &g, &f).status, 405);
    assert!(head_check(&post("/api/avatar", ok), &g).is_none());
}
