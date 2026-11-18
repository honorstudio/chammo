//! 패드 키즈 화면 길(/api/kids/*, 셋째 조각) — 키즈 참모를 고른 패드(기기 줄)는 잠겨서 키즈 길 말고는 못 간다
use super::*;

fn kids_fake(tag: &str, on: bool) -> Fake {
    let d = std::env::temp_dir().join(format!("chammo-mhttp-kidspad-{tag}-{}-{}", std::process::id(), crate::mobile_pair::random_hex(4).unwrap()));
    crate::kids::set_in(&d, "참모-2", Some(crate::kids::KidsOrch { child: "서아".into(), age: 5, since: 1 })).unwrap();
    crate::kids_guard::set_pin_in(&d, "2580").unwrap(); // 부모 잠금(여섯째 조각) — 정해야 키즈 화면을 고를 수 있다
    Fake { data: d, kids: on, ..Default::default() }
}

/// 실제 서버처럼 머리 문지기(head_check)부터 — handle 만 부르면 문지기 길 목록에서 빠진 길(404)을 못 잡는다(11-18 진짜 아이패드 'Error not found')
fn real(r: &Req, g: &Gate, f: &Fake) -> Resp {
    head_check(r, g).unwrap_or_else(|| handle(r, g, f))
}

fn call(g: &Gate, f: &Fake, r: Req) -> (u16, serde_json::Value) {
    let resp = real(&r, g, f);
    (resp.status, serde_json::from_slice(&resp.body).unwrap_or(serde_json::Value::Null))
}

#[test]
fn 키즈_참모를_고르면_그_패드는_키즈_길만() {
    let (g, f) = (gate(), kids_fake("lock", true));
    // 고르기 전엔 키즈 길(나·말·기록)이 없다
    assert_eq!(call(&g, &f, with_cookie(get("/api/kids/me"))).0, 403);
    // 키즈 참모가 아닌 참모는 못 고른다
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모"}"#)).0, 404);
    let (code, v) = call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#));
    assert_eq!(code, 200, "{v}");
    // 잠긴 뒤엔 보호자 화면·다른 참모·설정 길이 막힌다
    for p in ["/api/env", "/api/sessions", "/api/transcript?sessionId=x", "/api/avatars"] {
        assert_eq!(call(&g, &f, with_cookie(get(p))).0, 403, "{p}");
    }
    assert_eq!(call(&g, &f, post("/api/send", r#"{"id":"aaaa0001","text":"x"}"#)).0, 403);
    // 다른 참모로 다시 고르기도 안 된다
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 409);
    let (code, me) = call(&g, &f, with_cookie(get("/api/kids/me")));
    assert_eq!(code, 200);
    assert_eq!(me["key"], "참모-2");
    assert_eq!(me["on"], true);
    assert_eq!(me["child"], "서아");
    // 숨은 나가기(다음 조각 부모 잠금 전까지) — 풀리면 보호자 길이 다시 열린다
    assert_eq!(call(&g, &f, post("/api/kids/leave", r#"{"pin":"2580"}"#)).0, 200);
    assert_eq!(call(&g, &f, with_cookie(get("/api/env"))).0, 200);
    assert_eq!(call(&g, &f, with_cookie(get("/api/kids/me"))).0, 403);
}

#[test]
fn 아이_화면을_열면_아이_세션을_미리_켠다() {
    // 11-18 아침 점검: 아이 세션은 보호자가 키즈를 켤 때만 미리 켜져, 앱을 다시 켜거나 세션이 정리되면 아이 첫 말이 세션을 띄웠다 —
    // 첫 턴이 길면(실측 한 번 238초) 그동안 아이는 답을 못 듣는다. 아이 화면에 들어올 때·화면을 열 때 뒤에서 미리 켠다
    let (g, f) = (gate(), kids_fake("warm", true));
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    assert!(f.calls().contains(&"kid-start 참모-2".to_string()), "고르는 순간: {:?}", f.calls());
    let n = f.calls().len();
    assert_eq!(call(&g, &f, with_cookie(get("/api/kids/me"))).0, 200);
    assert!(f.calls()[n..].contains(&"kid-start 참모-2".to_string()), "화면을 열 때(앱을 다시 켠 뒤 패드가 다시 열어도)");
    // 보호자가 꺼 두었으면(잠든 화면) 켜지 않는다
    crate::kids::set_in(&f.data, "참모-2", None).unwrap();
    let n = f.calls().len();
    assert_eq!(call(&g, &f, with_cookie(get("/api/kids/me"))).0, 200);
    assert!(!f.calls()[n..].iter().any(|c| c.starts_with("kid-start")), "{:?}", f.calls());
}

#[test]
fn 설정_키즈_모드가_꺼져_있으면_못_고르고_잠긴_패드는_잠든_화면() {
    let (g, f) = (gate(), kids_fake("off", false));
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 404);
    let (g, f) = (gate(), kids_fake("sleep", true));
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    // 그 뒤 보호자가 키즈 참모를 껐다 — 패드는 여전히 잠긴 채 잠든 화면(on false), 말은 안 받는다
    crate::kids::set_in(&f.data, "참모-2", None).unwrap();
    let (code, me) = call(&g, &f, with_cookie(get("/api/kids/me")));
    assert_eq!((code, me["on"].clone()), (200, serde_json::Value::Bool(false)));
    assert_eq!(call(&g, &f, post("/api/kids/say", r#"{"text":"공룡","cid":"c1"}"#)).0, 409);
    assert_eq!(call(&g, &f, with_cookie(get("/api/env"))).0, 403, "잠금은 그대로");
}

#[test]
fn 설정_키즈_모드를_끄면_잠긴_패드도_잠든_화면과_나가기만() {
    // 0.4.16 공개판은 키즈를 뺀다(키즈 기본 끔) — 켰다 끈 사람의 잠긴 패드는 잠든 화면·숫자로 나가기만 남고 기록·작품·시간·패스키·목소리 길은 없다
    let (g, on) = (gate(), kids_fake("offpad", true));
    assert_eq!(call(&g, &on, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    let off = Fake { data: on.data.clone(), kids: false, ..Default::default() };
    let (code, me) = call(&g, &off, with_cookie(get("/api/kids/me")));
    assert_eq!((code, me["on"].clone()), (200, serde_json::Value::Bool(false)), "{me}");
    for p in ["/api/kids/log", "/api/kids/works", "/api/kids/work?name=dino", "/api/kids/voice?cid=c1&n=0", "/api/kids/pre?i=0"] {
        assert_eq!(call(&g, &off, with_cookie(get(p))).0, 404, "{p}");
    }
    for p in ["/api/kids/tick", "/api/kids/passkey/challenge", "/api/kids/say"] {
        assert_eq!(call(&g, &off, post(p, "{}")).0, 404, "{p}");
    }
    assert_eq!(call(&g, &off, with_cookie(get("/api/env"))).0, 403, "잠금은 그대로");
    assert_eq!(call(&g, &off, post("/api/kids/leave", r#"{"pin":"2580"}"#)).0, 200, "숫자로는 나간다");
    // 보호자 길도 없다
    assert_eq!(call(&g, &off, post("/api/kids-time", r#"{"key":"참모-2","addMin":10}"#)).0, 404);
    assert_eq!(call(&g, &off, with_cookie(get("/api/kids-work?key=참모-2&name=dino"))).0, 404);
}

#[test]
fn 아이_말은_그_참모_아이_세션으로_기록은_아이_말과_답만() {
    let (g, f) = (gate(), kids_fake("say", true));
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    assert_eq!(call(&g, &f, post("/api/kids/say", r#"{"text":" 공룡 그려 줘 ","cid":"c1"}"#)).0, 200);
    assert!(f.calls().contains(&"kids-say 참모-2 c1 공룡 그려 줘".to_string()), "{:?}", f.calls());
    assert_eq!(call(&g, &f, post("/api/kids/say", r#"{"text":"  ","cid":"c2"}"#)).0, 400);
    assert_eq!(call(&g, &f, post("/api/kids/say", r#"{"text":"x","cid":"../c"}"#)).0, 400);
    let (code, v) = call(&g, &f, with_cookie(get("/api/kids/log")));
    assert_eq!(code, 200);
    let who: Vec<_> = v.as_array().unwrap().iter().map(|r| r["who"].as_str().unwrap().to_string()).collect();
    assert_eq!(who, ["kid", "assistant"], "앱 줄·보호자 줄은 패드에 안 간다");
}

fn wav_post(path: &str, body: &[u8]) -> Req {
    let (p, q) = path.split_once('?').unwrap_or((path, ""));
    let mut r = post(p, "");
    r.query = q.into();
    r.headers.retain(|(k, _)| k != "content-type");
    r.headers.push(("content-type".into(), "audio/wav".into()));
    r.body = body.to_vec();
    r
}

fn tiny_wav() -> Vec<u8> {
    let mut w = b"RIFF\x24\0\0\0WAVEfmt ".to_vec();
    w.resize(48, 0);
    w
}

#[test]
fn 목소리_길_미리_받아쓰기_말_끝_조각_미리_만든_말() {
    let (g, f) = (gate(), kids_fake("voice", true));
    // 잠기기 전엔 없다
    assert_eq!(real(&wav_post("/api/kids/hear?cid=c1", &tiny_wav()), &g, &f).status, 403);
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    let (_, me) = call(&g, &f, with_cookie(get("/api/kids/me")));
    assert_eq!((me["voice"].clone(), me["voiceMode"].clone()), (serde_json::json!(true), serde_json::json!("tap")), "숨은 스위치 기본 tap");
    let r = real(&wav_post("/api/kids/peek?cid=c1", &tiny_wav()), &g, &f);
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap_or_else(|_| panic!("{} {}", r.status, String::from_utf8_lossy(&r.body)));
    assert_eq!((r.status, v["more"].clone()), (200, serde_json::json!(true)));
    // 빈 몸 = 미리 받아쓴 글로
    let r = real(&wav_post("/api/kids/hear?cid=c1", b""), &g, &f);
    assert_eq!(r.status, 200);
    assert!(f.calls().contains(&"kids-hear 참모-2 c1 0".to_string()), "{:?}", f.calls());
    // wav 가 아니면·cid 모양이 틀리면 거절
    assert_eq!(real(&wav_post("/api/kids/hear?cid=c1", b"not a wav at all, definitely not a wav file here"), &g, &f).status, 400);
    assert_eq!(real(&wav_post("/api/kids/hear?cid=../x", &tiny_wav()), &g, &f).status, 400);
    let mut j = wav_post("/api/kids/hear?cid=c1", &tiny_wav());
    j.headers.retain(|(k, _)| k != "content-type");
    j.headers.push(("content-type".into(), "application/json".into()));
    assert_eq!(real(&j, &g, &f).status, 403, "audio/wav 만 — 문지기가 먼저 막는다");
    // 남의 출처·출처 없음·열쇠 없음 — 녹음 길도 다른 쓰기 길과 같은 문
    for (k, v) in [("origin", Some("http://evil.example")), ("origin", None)] {
        assert_eq!(real(&set(wav_post("/api/kids/hear?cid=c1", &tiny_wav()), k, v), &g, &f).status, 403, "{v:?}");
    }
    assert_eq!(real(&set(wav_post("/api/kids/hear?cid=c1", &tiny_wav()), "authorization", None), &g, &f).status, 401);
    // 답 조각 — 있음 200 · 아직 204 · 끝 410
    assert_eq!(real(&with_cookie(get("/api/kids/voice?cid=c1&n=0")), &g, &f).status, 200);
    assert_eq!(real(&with_cookie(get("/api/kids/voice?cid=c1&n=1")), &g, &f).status, 204);
    assert_eq!(real(&with_cookie(get("/api/kids/voice?cid=c1&n=2")), &g, &f).status, 410);
    assert_eq!(real(&with_cookie(get("/api/kids/pre?i=1")), &g, &f).status, 200);
    assert_eq!(real(&with_cookie(get("/api/kids/pre?i=21")), &g, &f).status, 404);
}

#[test]
fn 부모_잠금_우회_경계() {
    // 잠금을 안 정했으면 아이 화면을 못 고른다
    let (g, f) = (gate(), kids_fake("nolock", true));
    std::fs::remove_file(f.data.join("kids/lock.json")).unwrap();
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 409);
    let (g, f) = (gate(), kids_fake("lock", true));
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    // 숫자 없이·모양이 틀린 숫자로 나가기 — 안 된다
    assert_eq!(call(&g, &f, post("/api/kids/leave", "{}")).0, 400);
    for bad in [r#"{"pin":""}"#, r#"{"pin":"25801"}"#, r#"{"pin":2580}"#] {
        assert!(matches!(call(&g, &f, post("/api/kids/leave", bad)).0, 400 | 403), "{bad}");
    }
    // 틀린 숫자 연타 — 세 번째부터 쉬기, 쉬는 동안엔 맞는 숫자도 429
    assert_eq!(call(&g, &f, post("/api/kids/leave", r#"{"pin":"0000"}"#)).0, 403);
    assert_eq!(call(&g, &f, post("/api/kids/leave", r#"{"pin":"0001"}"#)).0, 403);
    let (code, v) = call(&g, &f, post("/api/kids/leave", r#"{"pin":"0002"}"#));
    assert_eq!(code, 403);
    assert!(v["waitMs"].as_u64().unwrap_or(0) >= 30_000, "{v}");
    let (code, v) = call(&g, &f, post("/api/kids/leave", r#"{"pin":"2580"}"#));
    assert_eq!(code, 429, "{v}");
    // 잠긴 채 보호자 길·시간 늘리기·주소 직접 — 다 403
    for p in ["/api/env", "/api/sessions", "/api/html?t=x"] {
        assert!(matches!(call(&g, &f, with_cookie(get(p))).0, 403 | 404), "{p}");
    }
    assert_eq!(call(&g, &f, post("/api/kids-time", r#"{"key":"참모-2","addMin":10}"#)).0, 403, "아이 패드가 스스로 시간을 늘리지 못한다");
    // 새로고침(서버를 새로 읽어도) 잠금은 그대로 — 기억은 맥 쪽 파일
    let g2 = gate();
    assert_eq!(call(&g2, &f, with_cookie(get("/api/env"))).0, 403);
    // 맥에서 다시 정하면 쉬기가 풀리고 새 숫자로만 나간다
    crate::kids_guard::set_pin_in(&f.data, "1357").unwrap();
    assert_eq!(call(&g, &f, post("/api/kids/leave", r#"{"pin":"2580"}"#)).0, 403);
    assert_eq!(call(&g, &f, post("/api/kids/leave", r#"{"pin":"1357"}"#)).0, 200);
    assert_eq!(call(&g, &f, with_cookie(get("/api/env"))).0, 200);
}

#[test]
fn 패스키_등록은_숫자를_맞혀야_나가기는_서명으로() {
    use crate::kids_passkey::tests::{Fake as Key, ORIGIN, RP};
    let (g, f) = (gate(), kids_fake("passkey", true));
    // 잠기기 전엔 패스키 길도 없다
    assert_eq!(call(&g, &f, post("/api/kids/passkey/challenge", r#"{"purpose":"register","rp":"pad.example.com"}"#)).0, 403);
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    let (_, me) = call(&g, &f, with_cookie(get("/api/kids/me")));
    assert_eq!(me["passkey"], false);
    for bad in [r#"{"purpose":"x","rp":"pad.example.com"}"#, r#"{"purpose":"leave","rp":"192.168.0.2"}"#, r#"{"purpose":"leave","rp":""}"#] {
        assert_eq!(call(&g, &f, post("/api/kids/passkey/challenge", bad)).0, 400, "{bad}");
    }
    let challenge = |purpose: &str| call(&g, &f, post("/api/kids/passkey/challenge", &format!(r#"{{"purpose":"{purpose}","rp":"{RP}"}}"#))).1["challenge"].as_str().unwrap().to_string();
    let mut k = Key::new(11);
    // 숫자 없이·틀린 숫자로 등록 — 안 된다(틀리면 나가기와 같은 횟수)
    let reg = serde_json::to_value(k.register(&challenge("register"))).unwrap();
    assert_eq!(call(&g, &f, post("/api/kids/passkey/register", &serde_json::json!({ "reg": reg }).to_string())).0, 400);
    assert_eq!(call(&g, &f, post("/api/kids/passkey/register", &serde_json::json!({ "pin": "0000", "reg": reg }).to_string())).0, 403);
    let reg = serde_json::to_value(k.register(&challenge("register"))).unwrap();
    assert_eq!(call(&g, &f, post("/api/kids/passkey/register", &serde_json::json!({ "pin": "2580", "reg": reg }).to_string())).0, 200);
    assert_eq!(call(&g, &f, with_cookie(get("/api/env"))).0, 403, "등록만 하고 잠금은 그대로");
    let (_, me) = call(&g, &f, with_cookie(get("/api/kids/me")));
    assert_eq!(me["passkey"], true);
    // 엉뚱한 서명 — 403, 잠금 그대로
    let c = challenge("leave");
    let mut stranger = Key::new(12);
    let bad = serde_json::to_value(stranger.assert(&c, RP, ORIGIN, 0x05)).unwrap();
    assert_eq!(call(&g, &f, post("/api/kids/leave", &serde_json::json!({ "passkey": bad }).to_string())).0, 403);
    assert_eq!(call(&g, &f, post("/api/kids/leave", r#"{"passkey":{"id":"x"}}"#)).0, 400);
    // 등록한 열쇠 서명 — 풀린다
    let (code, v) = call(&g, &f, post("/api/kids/passkey/challenge", &format!(r#"{{"purpose":"leave","rp":"{RP}"}}"#)));
    assert_eq!((code, v["ids"].as_array().map(|a| a.len())), (200, Some(1)));
    let ok = serde_json::to_value(k.assert(v["challenge"].as_str().unwrap(), RP, ORIGIN, 0x05)).unwrap();
    assert_eq!(call(&g, &f, post("/api/kids/leave", &serde_json::json!({ "passkey": ok }).to_string())).0, 200);
    assert_eq!(call(&g, &f, with_cookie(get("/api/env"))).0, 200);
}

#[test]
fn 키즈_쓰기_길은_머리_문지기를_지나고_같은_문을_탄다() {
    // 11-18 진짜 아이패드: 문지기(head_check) 길 목록에 키즈 길이 없어 '아이 화면으로'가 404 not found 였다
    let g = gate();
    for (path, body) in [("/api/kids/enter", r#"{"key":"참모-2"}"#), ("/api/kids/say", r#"{"text":"공룡","cid":"c1"}"#), ("/api/kids/leave", r#"{"pin":"2580"}"#), ("/api/kids/tick", "{}"), ("/api/kids-time", r#"{"key":"참모-2","addMin":10}"#), ("/api/kids/future-path", "{}")] {
        assert!(head_check(&post(path, body), &g).is_none(), "{path}");
        assert_eq!(head_check(&set(post(path, body), "authorization", None), &g).map(|r| r.status), Some(401), "{path}");
        assert_eq!(head_check(&set(post(path, body), "origin", Some("http://evil.example")), &g).map(|r| r.status), Some(403), "{path}");
        assert_eq!(head_check(&set(post(path, body), "content-type", Some("text/plain")), &g).map(|r| r.status), Some(403), "{path} — 남의 페이지 form");
    }
    assert!(head_check(&wav_post("/api/kids/peek?cid=c1", &tiny_wav()), &g).is_none());
    // 키즈 아닌 모르는 길은 그대로 404, 비슷한 이름도
    for p in ["/api/kidsx", "/api/kids", "/api/kids-timex"] {
        assert_eq!(head_check(&post(p, "{}"), &g).map(|r| r.status), Some(404), "{p}");
    }
    // 모르는 키즈 길은 열쇠를 본 뒤 키즈 길이 404
    let f = kids_fake("unknown", true);
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    assert_eq!(call(&g, &f, post("/api/kids/future-path", "{}")).0, 404);
}

#[test]
fn 보호자_폰은_아이_기록과_오늘_작품을_본다_잠긴_패드는_못_본다() {
    // 아홉째 조각 — 사용자은 아이패드로 보호자 화면을 쓴다. 폰·패드 보호자 채팅에 아이 대화와 '오늘 만든 것' 줄
    let (g, f) = (gate(), kids_fake("today", true));
    let k = crate::kids::ensure_home(&f.data, "참모-2").unwrap();
    std::fs::create_dir_all(k.join("works/dino")).unwrap();
    std::fs::write(k.join("works/dino/index.html"), "<!doctype html><title>공룡 점프</title><body>공룡</body>").unwrap();
    let (code, v) = call(&g, &f, with_cookie(get("/api/kids-today?key=참모-2")));
    assert_eq!(code, 200, "{v}");
    assert_eq!(v["child"], "서아");
    let who: Vec<_> = v["rows"].as_array().unwrap().iter().map(|r| r["who"].as_str().unwrap().to_string()).collect();
    assert_eq!(who, ["app", "kid", "assistant"], "보호자 줄은 보호자 채팅에 이미 있어 뺀다");
    assert_eq!(v["works"][0]["name"], "dino");
    assert!(v["time"]["limitMs"].as_u64().is_some());
    // 작품 하나 — 맥이 인터넷 막는 머리를 붙인 글(패드와 같은 serve_work)
    let r = real(&with_cookie(get("/api/kids-work?key=참모-2&name=dino")), &g, &f);
    assert_eq!(r.status, 200);
    let h = String::from_utf8_lossy(&r.body);
    assert!(h.contains("Content-Security-Policy") && h.contains("공룡"), "{h}");
    assert_eq!(real(&with_cookie(get("/api/kids-work?key=참모-2&name=../x")), &g, &f).status, 404);
    // 키즈 참모가 아니면·꺼졌으면 없다
    assert_eq!(call(&g, &f, with_cookie(get("/api/kids-today?key=참모"))).0, 404);
    assert_eq!(call(&g, &f, post("/api/kids-today?key=참모-2", "{}")).0, 404, "읽기 길 — 쓰기는 문지기가 막는다");
    let off = kids_fake("today-off", false);
    assert_eq!(call(&g, &off, with_cookie(get("/api/kids-today?key=참모-2"))).0, 404);
    // 잠긴 패드(아이)는 보호자 길을 못 탄다
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    assert_eq!(call(&g, &f, with_cookie(get("/api/kids-today?key=참모-2"))).0, 403);
    assert_eq!(real(&with_cookie(get("/api/kids-work?key=참모-2&name=dino")), &g, &f).status, 403);
}

#[test]
fn 말_끝_판정_길_peek_은_판정을_주고_hear_는_판정_기록을_남긴다() {
    // 11-18 사용자 "아이가 더 말하려는 걸 감지하면 추임새, 아니면 말이 끝난 걸 수 있잖아" — 맥이 미리 받아쓴 글로 끝남·이어감·모름
    let (g, f) = (gate(), kids_fake("turn", true));
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    let (_, me) = call(&g, &f, with_cookie(get("/api/kids/me")));
    assert_eq!(me["turn"]["peekMs"], 450, "문턱은 kids.json turn(기본 450·900·3000)");
    assert_eq!(me["turn"]["moreMs"], 3000);
    let r = real(&wav_post("/api/kids/peek?cid=c1", &tiny_wav()), &g, &f);
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!((v["judge"].as_str(), v["more"].as_bool()), (Some("more"), Some(true)), "가짜 받아쓰기 '공룡이 점프하고' = 이어감 — {v}");
    // 판정 기록 — 숫자와 판정만(글 없음)
    assert_eq!(real(&wav_post("/api/kids/hear?cid=c1&j=more&p=470&r=1&w=3100", &tiny_wav()), &g, &f).status, 200);
    let k = crate::kids::kid_dir(&f.data, "참모-2").unwrap();
    let t = std::fs::read_to_string(k.join("turns.jsonl")).unwrap();
    let row: serde_json::Value = serde_json::from_str(t.lines().last().unwrap()).unwrap();
    assert_eq!((row["judge"].as_str(), row["pause_ms"].as_u64(), row["resumed"].as_bool(), row["waited_ms"].as_u64()), (Some("more"), Some(470), Some(true), Some(3100)));
    // kids.json 에서 문턱을 고치면 패드가 그 값으로
    let mut reg: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(f.data.join("kids/kids.json")).unwrap()).unwrap();
    reg["turn"] = serde_json::json!({ "unsureMs": 700 });
    std::fs::write(f.data.join("kids/kids.json"), reg.to_string()).unwrap();
    let (_, me) = call(&g, &f, with_cookie(get("/api/kids/me")));
    assert_eq!(me["turn"]["unsureMs"], 700);
}

#[test]
fn 패드_못_잡음_빈_받아쓰기도_기록하고_말_감지_문턱은_kids_json() {
    // 실사용 — 둘째 답 뒤 1분 동안 hear 가 0번이었는데 패드가 아무것도 안 남겨 이유(답 뒤 멈춤·작은 목소리·시작 소리)를 못 갈랐다
    let (g, f) = (gate(), kids_fake("turnlog", true));
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    let (_, me) = call(&g, &f, with_cookie(get("/api/kids/me")));
    assert_eq!(me["turn"]["speechLevel"], 0.02, "기본은 그대로, kids.json 에서 고친다");
    for (ev, code) in [("giveup", 200), ("empty", 200), ("hidden", 200), ("x<script>", 400)] {
        let b = serde_json::json!({ "cid": "c9", "ev": ev, "lv": 0.013, "fl": 0.002, "follow": true }).to_string();
        assert_eq!(call(&g, &f, post("/api/kids/turnlog", &b)).0, code, "{ev}");
    }
    let k = crate::kids::kid_dir(&f.data, "참모-2").unwrap();
    let rows: Vec<serde_json::Value> = std::fs::read_to_string(k.join("turns.jsonl")).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(rows.len(), 3);
    assert_eq!((rows[0]["event"].as_str(), rows[0]["max_level"].as_f64(), rows[0]["follow"].as_bool()), (Some("giveup"), Some(0.013), Some(true)));
    // hear 기록에도 그 말의 최대 소리
    assert_eq!(real(&wav_post("/api/kids/hear?cid=c1&j=end&p=470&r=0&w=900&lv=0.31&fl=0.004", &tiny_wav()), &g, &f).status, 200);
    let last: serde_json::Value = serde_json::from_str(std::fs::read_to_string(k.join("turns.jsonl")).unwrap().lines().last().unwrap()).unwrap();
    assert_eq!((last["event"].as_str(), last["max_level"].as_f64()), (Some("hear"), Some(0.31)));
    // 문턱을 kids.json 에서
    let mut reg: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(f.data.join("kids/kids.json")).unwrap()).unwrap();
    reg["turn"] = serde_json::json!({ "speechLevel": 0.008 });
    std::fs::write(f.data.join("kids/kids.json"), reg.to_string()).unwrap();
    let (_, me) = call(&g, &f, with_cookie(get("/api/kids/me")));
    assert_eq!(me["turn"]["speechLevel"], 0.008);
}

#[test]
fn 하루_시간_tick_과_보호자_더하기() {
    let (g, f) = (gate(), kids_fake("time", true));
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    let (code, u) = call(&g, &f, post("/api/kids/tick", "{}"));
    assert_eq!((code, u["limitMs"].clone()), (200, serde_json::json!(20 * 60_000)));
    let (_, me) = call(&g, &f, with_cookie(get("/api/kids/me")));
    assert_eq!(me["time"]["limitMs"], 20 * 60_000);
    // 보호자 기기(잠기지 않은 다른 줄)에서 오늘 10분 더 — 이 시험 gate 는 한 줄이라 먼저 나간다
    assert_eq!(call(&g, &f, post("/api/kids/leave", r#"{"pin":"2580"}"#)).0, 200);
    let (code, u) = call(&g, &f, post("/api/kids-time", r#"{"key":"참모-2","addMin":10}"#));
    assert_eq!((code, u["limitMs"].clone()), (200, serde_json::json!(30 * 60_000)));
    assert_eq!(call(&g, &f, post("/api/kids-time", r#"{"key":"참모","addMin":10}"#)).0, 404, "키즈 참모만");
    assert_eq!(call(&g, &f, post("/api/kids-time", r#"{"key":"참모-2","addMin":999}"#)).0, 400);
}

#[test]
fn 작품_목록과_작품은_잠긴_패드만_인터넷_막는_머리를_붙여() {
    let (g, f) = (gate(), kids_fake("works", true));
    assert_eq!(call(&g, &f, with_cookie(get("/api/kids/works"))).0, 403);
    assert_eq!(call(&g, &f, post("/api/kids/enter", r#"{"key":"참모-2"}"#)).0, 200);
    let k = crate::kids::ensure_home(&f.data, "참모-2").unwrap();
    crate::kids_make::start_in(&k, &crate::kids_make::Order { kind: Some("game".into()), name: "dino".into(), task: "공룡 점프".into() }).unwrap();
    let (code, v) = call(&g, &f, with_cookie(get("/api/kids/works")));
    assert_eq!((code, v[0]["name"].clone()), (200, serde_json::json!("dino")));
    let r = real(&with_cookie(get("/api/kids/work?name=dino")), &g, &f);
    let h = String::from_utf8_lossy(&r.body);
    assert_eq!(r.status, 200);
    assert!(h.contains("connect-src 'none'"));
    assert!(r.headers.iter().any(|(n, v)| *n == "Content-Type" && v.starts_with("text/plain")), "글로 내준다");
    assert_eq!(real(&with_cookie(get("/api/kids/work?name=../x")), &g, &f).status, 404);
}

// 끝에서 끝 — 패드 길(enter → say → log)로 진짜 아이 세션(claude --bg, 막힘 인자)에 말하고 답을 받는다.
// 보호자 채팅이 읽는 기록(kids_wire::recent_log 전부)을 $CHAMMO_HOME/e2e-rows.json 에 남겨 e2e/kids-chat 이 그대로 그린다.
//   H=$(mktemp -d)/home; mkdir -p $H; echo '{"features":{"kids":true}}' > $H/config.json
//   CHAMMO_HOME=$H cargo test kids_pad::real_pad_e2e -- --ignored --test-threads=1 --nocapture
#[test]
#[ignore]
fn real_pad_e2e() {
    let data = crate::config::data_dir().to_path_buf();
    assert!(std::env::var("CHAMMO_HOME").is_ok_and(|h| std::path::Path::new(&h) == data), "CHAMMO_HOME 임시 폴더로만");
    assert!(crate::config::current().features.kids, "config.json features.kids");
    let key = "참모-9";
    crate::kids::set_in(&data, key, Some(crate::kids::KidsOrch { child: "서아".into(), age: 5, since: 1 })).unwrap();
    let (g, f) = (gate(), Fake { data: data.clone(), kids: true, real_kids: true, ..Default::default() });
    let _ = std::fs::remove_file(data.join("kids/pads.json")); // 앞 판 잠금
    assert_eq!(call(&g, &f, post("/api/kids/enter", &format!(r#"{{"key":"{key}"}}"#))).0, 200);
    // 아이 세션 켜고 첫 답('준비됐어…')까지 — 뜨는 중에 친 글은 잃을 수 있다
    let k = crate::kids::kid_ready_pub(key).unwrap();
    let id = crate::kids_wire::ensure(&k, key).unwrap();
    let said = |rows: &[crate::kids_wire::Row]| rows.iter().filter(|r| r.who == "assistant").count();
    assert!((0..60).any(|_| { std::thread::sleep(std::time::Duration::from_secs(2)); said(&crate::kids_pad::log_blocking(key)) >= 1 }), "아이 세션 첫 답이 없다");
    let t0 = crate::notes::now_ms();
    let (code, _) = call(&g, &f, post("/api/kids/say", r#"{"text":"공룡 그려 줘","cid":"e2e1"}"#));
    assert_eq!(code, 200);
    let got = (0..60).find_map(|_| {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let (_, v) = call(&g, &f, with_cookie(get("/api/kids/log")));
        v.as_array().and_then(|a| a.iter().find(|r| r["who"] == "assistant" && r["ts"].as_u64().unwrap_or(0) > t0).cloned())
    });
    let all = crate::kids_wire::recent_log(&k, crate::notes::now_ms(), 2, 200);
    std::fs::write(data.join("e2e-rows.json"), serde_json::to_string_pretty(&all).unwrap()).unwrap();
    let _ = crate::platform::command(crate::claude::claude_bin()).args(["stop", &id]).output();
    let _ = crate::platform::command(crate::claude::claude_bin()).args(["rm", &id]).output();
    for r in &all {
        println!("  {} {}", r.who, r.text.chars().take(70).collect::<String>());
    }
    let got = got.expect("아이 말 뒤 답이 패드 기록에 없다");
    println!("패드 답: {}", got["text"]);
    assert!(all.iter().any(|r| r.who == "kid" && r.text == "공룡 그려 줘" && r.cid.as_deref() == Some("e2e1")), "보호자 기록에 아이 말");
    assert_eq!(call(&g, &f, with_cookie(get("/api/env"))).0, 403, "끝까지 잠긴 채");
}

// 속도 실측(넷째 조각 끝 기준 — 계획서 G 1단계): 손 뗌 → 첫 대답 소리 p90 2초 밑. 진짜 받아쓰기(whisper small)·아이 세션(Haiku)·목소리(Supertonic F1)로 20번.
// 손 뗌 → 첫 소리(미리 만든 말)는 패드가 미리 받아 둔 파일이라 네트워크를 안 탄다 — 여기선 미리 만든 말이 준비됐는지만 본다.
//   H=$(mktemp -d)/home; mkdir -p $H; echo '{"features":{"kids":true}}' > $H/config.json; ln -s ~/.honor-orchestrator/stt $H/stt; ln -s ~/.honor-orchestrator/tts $H/tts
//   KIDS_WAVS=<16kHz 모노 wav 폴더> CHAMMO_HOME=$H cargo test kids_pad::real_voice_speed -- --ignored --test-threads=1 --nocapture
#[test]
#[ignore]
fn real_voice_speed() {
    voice_speed("voice-speed.json", "session");
}

// 말 앞단 API 실측(일곱째 조각) — 설정 > 키즈 모드에 키를 넣은 뒤(키체인), real_voice_speed 와 같은 환경에 CHAMMO_KIDS_API_REAL=1 만 더한다.
// 키가 없으면 멈춘다(지어낸 키 금지). 결과는 $CHAMMO_HOME/api-speed.json — 첫 대답 소리 p90 2초 목표
#[test]
#[ignore]
fn real_api_speed() {
    assert!(crate::kids_api::key().is_some(), "키체인에 키가 없다 — 설정 > 키즈 모드 '빠른 대답'에 넣고 CHAMMO_KIDS_API_REAL=1 로");
    voice_speed("api-speed.json", "api");
}

/// want = 판마다 가야 할 앞단 — 다른 길로 간 판(API 실패 → 세션)이 있으면 실측이 아니다
fn voice_speed(out_name: &str, want: &str) {
    let data = crate::config::data_dir().to_path_buf();
    assert!(std::env::var("CHAMMO_HOME").is_ok_and(|h| std::path::Path::new(&h) == data), "CHAMMO_HOME 임시 폴더로만");
    let wavs: Vec<_> = {
        let mut v: Vec<_> = std::fs::read_dir(std::env::var("KIDS_WAVS").expect("KIDS_WAVS")).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "wav")).collect();
        v.sort();
        v
    };
    assert!(!wavs.is_empty());
    let key = "참모-9";
    crate::kids::set_in(&data, key, Some(crate::kids::KidsOrch { child: "서아".into(), age: 5, since: 1 })).unwrap();
    let (g, f) = (gate(), Fake { data: data.clone(), kids: true, real_kids: true, ..Default::default() });
    let _ = std::fs::remove_file(data.join("kids/pads.json"));
    assert_eq!(call(&g, &f, post("/api/kids/enter", &format!(r#"{{"key":"{key}"}}"#))).0, 200);
    let k = crate::kids::kid_ready_pub(key).unwrap();
    let id = crate::kids_wire::ensure(&k, key).unwrap();
    let t = std::time::Instant::now();
    assert!(crate::kids_voice::pre_dir().is_ok(), "미리 만든 말");
    println!("미리 만든 말 준비 {}ms", t.elapsed().as_millis());
    assert_eq!(real(&with_cookie(get("/api/kids/pre?i=2")), &g, &f).status, 200);
    let said = |rows: &[crate::kids_wire::Row]| rows.iter().filter(|r| r.who == "assistant").count();
    assert!((0..60).any(|_| { std::thread::sleep(std::time::Duration::from_secs(2)); said(&crate::kids_pad::log_blocking(key)) >= 1 }), "아이 세션 첫 답이 없다");
    let mut runs = vec![];
    let run = crate::notes::now_ms() % 1_000_000; // 판마다 새 cid — 같은 폴더의 지난 판 조각·시간 기록을 읽으면 안 된다
    for i in 0..20 {
        // 아이 세션이 앞 일(만들기)을 마치고 쉴 때 보낸다 — '첫 대답' 기준을 재려고(일하는 중엔 말이 그 턴 뒤로 줄 선다)
        for _ in 0..120 {
            crate::claude::forget_agents();
            if crate::claude::agents_json().is_ok_and(|j| !crate::mobile_http::session_busy(&j, &id)) { break; }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        let wav = std::fs::read(&wavs[i % wavs.len()]).unwrap();
        let cid = format!("sp{run}x{i}");
        let t0 = std::time::Instant::now();
        let r = real(&wav_post(&format!("/api/kids/hear?cid={cid}"), &wav), &g, &f);
        let heard = t0.elapsed().as_millis() as u64;
        assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
        let mut first = 0u64;
        for _ in 0..600 {
            match handle(&with_cookie(get(&format!("/api/kids/voice?cid={cid}&n=0"))), &g, &f).status {
                200 => { first = t0.elapsed().as_millis() as u64; break; }
                410 => break,
                _ => std::thread::sleep(std::time::Duration::from_millis(50)),
            }
        }
        // 다음 말 전에 이 답 읽기가 끝나기를(최대 20초)
        for _ in 0..200 {
            if handle(&with_cookie(get(&format!("/api/kids/voice?cid={cid}&n=99"))), &g, &f).status == 410 { break; }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let tm: serde_json::Value = std::fs::read_to_string(data.join(format!("kids/_voice/{key}/{cid}/timing.json"))).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let load = crate::platform::load1().unwrap_or(0.0);
        println!("{i:2} 받아쓰기 {:>5}ms · 보냄 {:>5} · 답 글 {:>5} · 첫 소리 조각 {:>5}ms · 부하 {load:.0} · {} · {:?} → {:?}", tm["heard_ms"], tm["sent_ms"], tm["reply_ms"], first, tm["via"].as_str().unwrap_or("?"), tm["text"].as_str().unwrap_or(""), tm["reply"].as_str().unwrap_or("").chars().take(30).collect::<String>());
        runs.push(serde_json::json!({ "i": i, "hear_ms": heard, "timing": tm, "first_clip_ms": first, "load": load }));
    }
    let _ = crate::platform::command(crate::claude::claude_bin()).args(["stop", &id]).output();
    let _ = crate::platform::command(crate::claude::claude_bin()).args(["rm", &id]).output();
    // 끝내 조각이 안 온 판(0)은 가장 느린 것으로
    let mut firsts: Vec<u64> = runs.iter().map(|r| r["first_clip_ms"].as_u64().filter(|v| *v > 0).unwrap_or(u64::MAX)).collect();
    firsts.sort();
    let p = |q: f64| firsts[((firsts.len() as f64 * q).ceil() as usize).saturating_sub(1).min(firsts.len() - 1)];
    println!("첫 대답 소리 p50 {}ms · p90 {}ms", p(0.5), p(0.9));
    std::fs::write(data.join(out_name), serde_json::to_string_pretty(&serde_json::json!({ "runs": runs, "p50": p(0.5), "p90": p(0.9) })).unwrap()).unwrap();
    let other = runs.iter().filter(|r| r["timing"]["via"] != want).count();
    assert_eq!(other, 0, "{other}판이 {want} 앞단이 아닌 길로 갔다 — 결과 {out_name} 을 실측으로 쓰지 않는다");
}

// 바로 만들기 실측(다섯째 조각): 말 앞단(도구 없음) + 만들기 세션으로 20번 — 손 뗌 → 첫 대답 소리(목표 p90 2초)·첫 화면(작품 목록에 새로 뜨거나 바뀜, 목표 p90 5초).
// 판마다 만들기 세션을 끈다(무거운 일 하나씩). 같은 경로·환경은 real_voice_speed 와 같고 KIDS_WAVS 는 만들기 부탁 녹음
#[test]
#[ignore]
fn real_make_speed() {
    let data = crate::config::data_dir().to_path_buf();
    assert!(std::env::var("CHAMMO_HOME").is_ok_and(|h| std::path::Path::new(&h) == data), "CHAMMO_HOME 임시 폴더로만");
    let mut wavs: Vec<_> = std::fs::read_dir(std::env::var("KIDS_WAVS").expect("KIDS_WAVS")).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "wav")).collect();
    wavs.sort();
    let key = "참모-9";
    crate::kids::set_in(&data, key, Some(crate::kids::KidsOrch { child: "서아".into(), age: 5, since: 1 })).unwrap();
    let (g, f) = (gate(), Fake { data: data.clone(), kids: true, real_kids: true, ..Default::default() });
    let _ = std::fs::remove_file(data.join("kids/pads.json"));
    assert_eq!(call(&g, &f, post("/api/kids/enter", &format!(r#"{{"key":"{key}"}}"#))).0, 200);
    let k = crate::kids::kid_ready_pub(key).unwrap();
    let _ = std::fs::remove_dir_all(k.join("works"));
    let _ = std::fs::remove_file(k.join("session.json")); // 말 앞단(도구 없음)으로 새로
    let id = crate::kids_wire::ensure(&k, key).unwrap();
    assert!(crate::kids_voice::pre_dir().is_ok());
    let said = |rows: &[crate::kids_wire::Row]| rows.iter().filter(|r| r.who == "assistant").count();
    assert!((0..60).any(|_| { std::thread::sleep(std::time::Duration::from_secs(2)); said(&crate::kids_pad::log_blocking(key)) >= 1 }), "아이 세션 첫 답이 없다");
    let run = crate::notes::now_ms() % 1_000_000;
    let mut runs = vec![];
    let works = |g: &Gate, f: &Fake| -> Vec<(String, u64)> {
        let (_, v) = call(g, f, with_cookie(get("/api/kids/works")));
        v.as_array().cloned().unwrap_or_default().iter().map(|w| (w["name"].as_str().unwrap_or("").to_string(), w["mtime"].as_u64().unwrap_or(0))).collect()
    };
    for i in 0..20 {
        for _ in 0..120 {
            crate::claude::forget_agents();
            if crate::claude::agents_json().is_ok_and(|j| !crate::mobile_http::session_busy(&j, &id)) { break; }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        let before = works(&g, &f);
        let wav = std::fs::read(&wavs[i % wavs.len()]).unwrap();
        let cid = format!("mk{run}x{i}");
        let t0 = std::time::Instant::now();
        assert_eq!(real(&wav_post(&format!("/api/kids/hear?cid={cid}"), &wav), &g, &f).status, 200);
        let (mut first_clip, mut first_screen, mut screen_name) = (0u64, 0u64, String::new());
        while t0.elapsed().as_secs() < 60 && (first_clip == 0 || first_screen == 0) {
            if first_clip == 0 && handle(&with_cookie(get(&format!("/api/kids/voice?cid={cid}&n=0"))), &g, &f).status == 200 {
                first_clip = t0.elapsed().as_millis() as u64;
            }
            if first_screen == 0 {
                if let Some((n, _)) = works(&g, &f).into_iter().find(|w| !before.contains(w)) {
                    first_screen = t0.elapsed().as_millis() as u64;
                    screen_name = n;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let tm: serde_json::Value = std::fs::read_to_string(data.join(format!("kids/_voice/{key}/{cid}/timing.json"))).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let load = crate::platform::load1().unwrap_or(0.0);
        println!("{i:2} 첫 대답 소리 {first_clip:>5}ms · 첫 화면 {first_screen:>5}ms({screen_name}) · 부하 {load:.0} · {:?} → {:?}", tm["text"].as_str().unwrap_or(""), tm["reply"].as_str().unwrap_or("").chars().take(30).collect::<String>());
        // 만들기 세션은 끈다 — 다음 판과 겹쳐 부하가 쌓이지 않게
        for w in std::fs::read_dir(k.join("works")).into_iter().flatten().flatten() {
            if let Ok(s) = std::fs::read_to_string(w.path().join(".session")) {
                let _ = crate::platform::command(crate::claude::claude_bin()).args(["stop", s.trim()]).output();
                let _ = crate::platform::command(crate::claude::claude_bin()).args(["rm", s.trim()]).output();
                let _ = std::fs::remove_file(w.path().join(".session"));
            }
        }
        runs.push(serde_json::json!({ "i": i, "first_clip_ms": first_clip, "first_screen_ms": first_screen, "work": screen_name, "timing": tm, "load": load }));
    }
    let _ = crate::platform::command(crate::claude::claude_bin()).args(["stop", &id]).output();
    let _ = crate::platform::command(crate::claude::claude_bin()).args(["rm", &id]).output();
    let pct = |key: &str| {
        let mut v: Vec<u64> = runs.iter().map(|r| r[key].as_u64().filter(|x| *x > 0).unwrap_or(u64::MAX)).collect();
        v.sort();
        let p = |q: f64| v[((v.len() as f64 * q).ceil() as usize).saturating_sub(1).min(v.len() - 1)];
        (p(0.5), p(0.9))
    };
    let (c50, c90) = pct("first_clip_ms");
    let (s50, s90) = pct("first_screen_ms");
    println!("첫 대답 소리 p50 {c50}ms · p90 {c90}ms / 첫 화면 p50 {s50}ms · p90 {s90}ms");
    std::fs::write(data.join("make-speed.json"), serde_json::to_string_pretty(&serde_json::json!({ "runs": runs, "clip": [c50, c90], "screen": [s50, s90] })).unwrap()).unwrap();
}

// 아침 점검(11-18 사용자 "아침에 바로 사용 가능해야") — 진짜 패드 길 그대로: 아이 세션을 미리 켜지 않고 enter → me → 미리 만든 말 → peek → hear(첫 말이 세션을 띄움)
// → 답 글 → 목소리 조각, 그리고 '공룡 그려 줘' 녹음 → 작품. CHAMMO_HOME 은 집 아래(진짜 사용자처럼 ~/.claude/CLAUDE.md 가 위쪽에 있게)
//   KIDS_WAVS=<01-hello.wav·02-dino.wav 폴더> CHAMMO_HOME=$HOME/chammo-e2e-xxx cargo test kids_pad::real_morning_path -- --ignored --test-threads=1 --nocapture
#[test]
#[ignore]
fn real_morning_path() {
    let data = crate::config::data_dir().to_path_buf();
    assert!(std::env::var("CHAMMO_HOME").is_ok_and(|h| std::path::Path::new(&h) == data), "CHAMMO_HOME 임시 폴더로만");
    let home = std::path::PathBuf::from(std::env::var("HOME").unwrap());
    assert!(data.starts_with(&home) && home.join(".claude/CLAUDE.md").is_file(), "진짜 사용자처럼 집 아래 + ~/.claude/CLAUDE.md");
    let wd = std::path::PathBuf::from(std::env::var("KIDS_WAVS").expect("KIDS_WAVS"));
    let (hello, dino) = (std::fs::read(wd.join("01-hello.wav")).unwrap(), std::fs::read(wd.join("02-dino.wav")).unwrap());
    let key = "참모-9";
    crate::kids::set_in(&data, key, Some(crate::kids::KidsOrch { child: "서아".into(), age: 5, since: 1 })).unwrap();
    crate::kids_guard::set_pin_in(&data, "2580").unwrap();
    let (g, f) = (gate(), Fake { data: data.clone(), kids: true, real_kids: true, ..Default::default() });
    let _ = std::fs::remove_file(data.join("kids/pads.json"));
    let t = std::time::Instant::now();
    let ms = |t: std::time::Instant| t.elapsed().as_millis();
    let mut steps: Vec<String> = vec![];
    let r = call(&g, &f, post("/api/kids/enter", &format!(r#"{{"key":"{key}"}}"#)));
    steps.push(format!("enter {} {}ms", r.0, ms(t)));
    assert_eq!(r.0, 200, "{:?}", r.1);
    let (code, me) = call(&g, &f, with_cookie(get("/api/kids/me")));
    steps.push(format!("me {code} voice={}", me["voice"]));
    assert_eq!(me["voice"], true, "받아쓰기·목소리가 준비 안 됨 — {me}");
    // 미리 만든 말 — 기다리지 않고 '아직'(404)이다가 뒤에서 만들어진다
    let tp = std::time::Instant::now();
    let pre_first = real(&with_cookie(get("/api/kids/pre?i=2")), &g, &f).status;
    let pre_ok = (0..240).any(|_| { std::thread::sleep(std::time::Duration::from_millis(500)); real(&with_cookie(get("/api/kids/pre?i=2")), &g, &f).status == 200 });
    steps.push(format!("pre 처음 {pre_first} → 준비 {} {}ms", pre_ok, ms(tp)));
    // 말 중간 쉼 — 미리 받아쓰기
    let tk = std::time::Instant::now();
    let pk = real(&wav_post("/api/kids/peek?cid=m1", &hello), &g, &f);
    steps.push(format!("peek {} {}ms {}", pk.status, ms(tk), String::from_utf8_lossy(&pk.body)));
    // 말 끝 — 첫 말이 아이 세션을 띄운다(미리 안 켬)
    let th = std::time::Instant::now();
    let hr = real(&wav_post("/api/kids/hear?cid=m1", &hello), &g, &f);
    steps.push(format!("hear {} {}ms {}", hr.status, ms(th), String::from_utf8_lossy(&hr.body)));
    let clip = (0..1200).find_map(|_| { std::thread::sleep(std::time::Duration::from_millis(100)); match real(&with_cookie(get("/api/kids/voice?cid=m1&n=0")), &g, &f).status { 200 => Some(true), 410 => Some(false), _ => None } });
    steps.push(format!("첫 목소리 조각 {:?} {}ms", clip, ms(th)));
    let said = |rows: &[crate::kids_wire::Row]| rows.iter().filter(|r| r.who == "assistant").map(|r| r.text.clone()).collect::<Vec<_>>();
    let reply = (0..60).find_map(|_| { let s = said(&crate::kids_pad::log_blocking(key)); if s.is_empty() { std::thread::sleep(std::time::Duration::from_secs(1)); None } else { Some(s) } });
    steps.push(format!("답 글 {:?} {}ms", reply.as_ref().map(|v| v.join(" / ").chars().take(60).collect::<String>()), ms(th)));
    // 만들기 — '공룡 그려 줘' 녹음 → 작품
    for _ in 0..200 { if real(&with_cookie(get("/api/kids/voice?cid=m1&n=99")), &g, &f).status == 410 { break; } std::thread::sleep(std::time::Duration::from_millis(100)); }
    let tm = std::time::Instant::now();
    let hr2 = real(&wav_post("/api/kids/hear?cid=m2", &dino), &g, &f);
    steps.push(format!("hear(공룡) {} {}", hr2.status, String::from_utf8_lossy(&hr2.body)));
    let work = (0..180).find_map(|_| { std::thread::sleep(std::time::Duration::from_secs(1)); let (_, v) = call(&g, &f, with_cookie(get("/api/kids/works"))); v.as_array().filter(|a| !a.is_empty()).map(|a| a[0]["name"].as_str().unwrap_or("").to_string()) });
    steps.push(format!("작품 {:?} {}ms", work, ms(tm)));
    let k = crate::kids::kid_dir(&data, key).unwrap();
    let id = crate::kids_wire::read_session(&k).map(|s| s.id);
    for l in &steps { println!("단계 {l}"); }
    for r in crate::kids_wire::recent_log(&k, crate::notes::now_ms(), 1, 50) { println!("  기록 {} {}", r.who, r.text.chars().take(70).collect::<String>()); }
    // 띄운 세션 정리(아이 세션·만들기 세션)
    if let Ok(j) = crate::claude::agents_json() {
        for a in serde_json::from_str::<serde_json::Value>(&j).ok().and_then(|v| v.as_array().cloned()).unwrap_or_default() {
            if a["cwd"].as_str().is_some_and(|c| std::path::Path::new(c).starts_with(&data)) {
                if let Some(sid) = a["id"].as_str().or(a["sessionId"].as_str()) {
                    let _ = crate::platform::command(crate::claude::claude_bin()).args(["stop", sid]).output();
                    let _ = crate::platform::command(crate::claude::claude_bin()).args(["rm", sid]).output();
                }
            }
        }
    }
    let _ = id;
    assert_eq!(hr.status, 200, "말 받기 실패");
    assert!(reply.is_some(), "아이 세션 답이 없다");
    assert_eq!(clip, Some(true), "목소리 조각이 없다");
    assert!(work.is_some(), "작품이 안 생겼다");
}


// 진짜 길 주고받기— 미리 켜진 아이 세션과 짧은 말 여럿('안녕'·'공룡'·'응'·'공룡 그려 줘')을 차례로.
// 매 번: 받아쓴 글 · 첫 소리 조각까지 · 답 글(이름표·해설 없어야). 빈 받아쓰기는 실패가 아니라 기록(패드는 다시 듣기)
//   KIDS_WAVS=<01~04.wav 폴더> CHAMMO_HOME=$HOME/chammo-e2e-xxx cargo test kids_pad::real_turns_short -- --ignored --test-threads=1 --nocapture
#[test]
#[ignore]
fn real_turns_short() {
    let data = crate::config::data_dir().to_path_buf();
    assert!(std::env::var("CHAMMO_HOME").is_ok_and(|h| std::path::Path::new(&h) == data), "CHAMMO_HOME 임시 폴더로만");
    let wd = std::path::PathBuf::from(std::env::var("KIDS_WAVS").expect("KIDS_WAVS"));
    let mut wavs: Vec<_> = std::fs::read_dir(&wd).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "wav")).collect();
    wavs.sort();
    let key = "참모-9";
    crate::kids::set_in(&data, key, Some(crate::kids::KidsOrch { child: "서아".into(), age: 5, since: 1 })).unwrap();
    crate::kids_guard::set_pin_in(&data, "2580").unwrap();
    let (g, f) = (gate(), Fake { data: data.clone(), kids: true, real_kids: true, ..Default::default() });
    let _ = std::fs::remove_file(data.join("kids/pads.json"));
    assert_eq!(call(&g, &f, post("/api/kids/enter", &format!(r#"{{"key":"{key}"}}"#))).0, 200);
    let k = crate::kids::kid_dir(&data, key).unwrap();
    // 미리 켜진 세션의 준비 답까지(아이가 화면을 보는 몇 초)
    let rows = || crate::kids_wire::recent_log(&k, crate::notes::now_ms(), 1, 400);
    assert!((0..60).any(|_| { std::thread::sleep(std::time::Duration::from_secs(1)); crate::kids_pad::log_blocking(key); rows().iter().any(|r| r.who == "ready") }), "준비 답이 없다");
    let mut lines = vec![];
    let mut replies = 0;
    let run = crate::notes::now_ms() % 1_000_000;
    for (i, w) in wavs.iter().enumerate() {
        let cid = format!("t{run}x{i}");
        let before = rows().iter().filter(|r| r.who == "assistant").count();
        let t = std::time::Instant::now();
        let hr = real(&wav_post(&format!("/api/kids/hear?cid={cid}&j=end&p=470&r=0&w=850&lv=0.2&fl=0.003"), &std::fs::read(w).unwrap()), &g, &f);
        let heard: serde_json::Value = serde_json::from_slice(&hr.body).unwrap_or_default();
        let text = heard["text"].as_str().unwrap_or("").to_string();
        if hr.status != 200 || text.is_empty() {
            lines.push(format!("{} hear {} 받아쓴 글 {:?} — 빈 받아쓰기(패드는 다시 듣기)", w.file_name().unwrap().to_string_lossy(), hr.status, text));
            continue;
        }
        let clip = (0..400).find_map(|_| { std::thread::sleep(std::time::Duration::from_millis(100)); match real(&with_cookie(get(&format!("/api/kids/voice?cid={cid}&n=0"))), &g, &f).status { 200 => Some(t.elapsed().as_millis()), 410 => Some(0), _ => None } });
        for _ in 0..300 { if real(&with_cookie(get(&format!("/api/kids/voice?cid={cid}&n=99"))), &g, &f).status == 410 { break; } std::thread::sleep(std::time::Duration::from_millis(100)); }
        crate::kids_pad::log_blocking(key);
        let all = rows();
        let new: Vec<_> = all.iter().filter(|r| r.who == "assistant").skip(before).map(|r| r.text.clone()).collect();
        replies += new.len().min(1);
        for r in &new {
            assert!(!crate::kids_voice::is_meta_line(r) && !r.contains('['), "해설·이름표가 아이에게: {r}");
        }
        lines.push(format!("{} 받아쓴 글 {:?} · 첫 소리 {:?}ms · 답 {:?}", w.file_name().unwrap().to_string_lossy(), text, clip, new.join(" / ").chars().take(50).collect::<String>()));
    }
    for l in &lines { println!("주고받기 {l}"); }
    let works = crate::kids_make::works_in(&k);
    println!("작품 {:?}", works.iter().map(|w| w.name.clone()).collect::<Vec<_>>());
    if let Ok(j) = crate::claude::agents_json() {
        for a in serde_json::from_str::<serde_json::Value>(&j).ok().and_then(|v| v.as_array().cloned()).unwrap_or_default() {
            if a["cwd"].as_str().is_some_and(|c| std::path::Path::new(c).starts_with(&data)) {
                if let Some(sid) = a["id"].as_str().or(a["sessionId"].as_str()) {
                    let _ = crate::platform::command(crate::claude::claude_bin()).args(["stop", sid]).output();
                    let _ = crate::platform::command(crate::claude::claude_bin()).args(["rm", sid]).output();
                }
            }
        }
    }
    assert!(replies >= 3, "세 번 넘게 주고받기 못 함: {lines:?}");
}
