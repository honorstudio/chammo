use super::*;
use crate::remote::{CallOut, DeviceView, DevicesOut};
use std::cell::RefCell;

fn dev(id: &str, name: &str, status: &'static str) -> DeviceView {
    DeviceView { id: id.into(), name: name.into(), os: "macOS".into(), status, paired: status != "pair", old: false, link: true, version: Some("0.3.2".into()), last_ok: None, paused: None }
}

#[derive(Default)]
struct Ops {
    calls: RefCell<Vec<String>>,
    /// (method path) → (status, 본문) — 없으면 404
    answers: Vec<(&'static str, u16, &'static str)>,
    /// call 이 이 오류로 실패(열쇠 끊김 "pair" 등)
    fail: Option<&'static str>,
    /// 이 기기에 테일스케일이 안 깔림(remote::NO_TAILSCALE)
    no_ts: bool,
    /// 목록 끝에 더할 줄
    more: Vec<DeviceView>,
}

impl PeerOps for Ops {
    fn devices(&self) -> Result<DevicesOut, String> {
        if self.no_ts {
            return Err(crate::remote::NO_TAILSCALE.into());
        }
        let mut devices = vec![dev("nA", "office-imac", "connected"), dev("nB", "office-pc", "pair"), dev("nC", "office-mini", "offline")];
        devices.extend(self.more.iter().cloned());
        Ok(DevicesOut { me: "laptop".into(), devices })
    }
    fn pair(&self, id: &str, code: &str) -> Result<(), String> {
        self.calls.borrow_mut().push(format!("pair {id} {code}"));
        Ok(())
    }
    fn unpair(&self, id: &str) -> Result<(), String> {
        self.calls.borrow_mut().push(format!("unpair {id}"));
        Ok(())
    }
    fn connect(&self, id: &str, note: &dyn Fn(&str)) -> Result<(), String> {
        self.calls.borrow_mut().push(format!("connect {id}"));
        note("mail-failed:os error 49");
        if id == "nC" { Err("그 기기에서 거절했어요".into()) } else { Ok(()) }
    }
    fn call(&self, id: &str, method: &str, path: &str, body: Option<&str>) -> Result<CallOut, String> {
        self.calls.borrow_mut().push(format!("{id} {method} {path} {}", body.unwrap_or("")));
        if let Some(e) = self.fail {
            return Err(e.into());
        }
        let key = format!("{method} {}", path.split('?').next().unwrap_or(path));
        Ok(match self.answers.iter().find(|(k, _, _)| *k == key) {
            Some((_, s, t)) => CallOut { status: *s, text: Some((*t).into()), b64: None },
            None => CallOut { status: 404, text: Some("not found".into()), b64: None },
        })
    }
    fn note(&self, rid: &str, text: &str) {
        self.calls.borrow_mut().push(format!("note {rid} {text}"));
    }
    fn who(&self, by: &str) -> String {
        if by == "sess-1" { "참모-2 · 영상".into() } else { String::new() }
    }
}

fn line(arg: serde_json::Value) -> String {
    serde_json::json!({ "action": "peer", "id": "r1", "arg": arg }).to_string()
}

#[test]
fn 요청줄은_peer_만_id_가_깨끗해야() {
    assert!(request(&line(serde_json::json!({ "verb": "list" }))).is_some());
    assert!(request(&serde_json::json!({ "action": "mode", "id": "r1", "arg": { "verb": "list" } }).to_string()).is_none());
    assert!(request(&serde_json::json!({ "action": "peer", "id": "r 1", "arg": { "verb": "list" } }).to_string()).is_none());
    assert!(request(&line(serde_json::json!({ "verb": "rm -rf" }))).is_none());
}

#[test]
fn 기기는_id_이름_대소문자_앞부분으로_찾고_애매하면_후보() {
    let d = Ops::default().devices().unwrap().devices;
    assert_eq!(find_device(&d, "nA").unwrap().id, "nA");
    assert_eq!(find_device(&d, "Office-iMac").unwrap().id, "nA");
    assert_eq!(find_device(&d, "office-p").unwrap().id, "nB");
    let e = find_device(&d, "office").unwrap_err();
    assert!(e.contains("office-imac") && e.contains("office-pc"), "{e}");
    assert!(find_device(&d, "없음").is_err());
}

#[test]
fn 목록은_연결된_기기의_참모_이름까지() {
    let ops = Ops {
        answers: vec![
            ("GET /api/env", 200, r#"{"hqDir":"/Users/x/hq","assistantName":"참모","chammoAccounts":[{"folder":".chammo","current":true,"email":"me@example.com","name":"나"},{"folder":".chammo-qa","current":false,"email":"other@example.com","name":"남<b>"}]}"#),
            ("GET /api/sessions", 200, r#"[{"id":"aaaa0001","cwd":"/Users/x/hq","name":"참모-1 · 개발"},{"id":"bbbb0002","cwd":"/Users/x/dev/shop","name":"shop"}]"#),
        ],
        ..Default::default()
    };
    let v = answer(&request(&line(serde_json::json!({ "verb": "list" }))).unwrap(), &ops);
    assert_eq!(v["ok"], true);
    assert_eq!(v["me"], "laptop");
    let a = &v["devices"][0];
    assert_eq!((a["name"].as_str(), a["status"].as_str()), (Some("office-imac"), Some("connected")));
    assert_eq!(a["assistants"], serde_json::json!([{ "id": "aaaa0001", "name": "참모-1 · 개발" }]));
    // 그 기기 Chammo 가 어느 계정으로 로그인했나(시험판 데이터 폴더도 따로) — 남의 글이라 짧게·꺾쇠 빼고
    assert_eq!(a["accounts"], serde_json::json!([
        { "folder": ".chammo", "current": true, "email": "me@example.com", "name": "나" },
        { "folder": ".chammo-qa", "current": false, "email": "other@example.com", "name": "남b" }]));
    assert_eq!(ops.calls.borrow().iter().filter(|c| c.contains("/api/env")).count(), 1, "env 는 한 번만");
    // 짝 안 지은 기기·꺼진 기기엔 묻지 않는다
    assert!(ops.calls.borrow().iter().all(|c| c.starts_with("nA ")), "{:?}", ops.calls.borrow());
}

#[test]
fn 짝짓기_끊기는_찾은_기기_id_로() {
    let ops = Ops::default();
    let v = answer(&request(&line(serde_json::json!({ "verb": "pair", "device": "office-pc", "code": "0123456789abcdef0123456789abcdef" }))).unwrap(), &ops);
    assert_eq!(v["ok"], true, "{v}");
    let v = answer(&request(&line(serde_json::json!({ "verb": "unpair", "device": "office-imac" }))).unwrap(), &ops);
    assert_eq!(v["ok"], true);
    assert_eq!(*ops.calls.borrow(), vec!["pair nB 0123456789abcdef0123456789abcdef", "unpair nA"]);
}

#[test]
fn 말_넣기는_보낸_참모_이름을_실어_보낸다() {
    let ops = Ops { answers: vec![("POST /api/peer-say", 202, r#"{"ok":true,"queued":true,"id":"aaaa0001"}"#)], ..Default::default() };
    let v = answer(&request(&line(serde_json::json!({ "verb": "say", "device": "office-imac", "to": "개발", "text": "빌드 됐어?", "cid": "pc-1", "by": "sess-1" }))).unwrap(), &ops);
    assert_eq!((v["ok"].as_bool(), v["cid"].as_str(), v["id"].as_str()), (Some(true), Some("pc-1"), Some("aaaa0001")), "{v}");
    let c = ops.calls.borrow()[0].clone();
    let body: serde_json::Value = serde_json::from_str(c.trim_start_matches("nA POST /api/peer-say ")).unwrap();
    assert_eq!(body, serde_json::json!({ "to": "개발", "text": "빌드 됐어?", "cid": "pc-1", "from": "참모-2 · 영상" }));
}

#[test]
fn 말_넣기_실패는_이유로() {
    let say = |ops: &Ops| answer(&request(&line(serde_json::json!({ "verb": "say", "device": "office-imac", "text": "x", "cid": "pc-2" }))).unwrap(), ops);
    // 옛 판(길이 없음)
    let v = say(&Ops::default());
    assert_eq!(v["ok"], false);
    assert!(v["error"].as_str().unwrap().contains("업데이트"), "{v}");
    // 열쇠 끊김
    let v = say(&Ops { fail: Some("pair"), ..Default::default() });
    assert_eq!(v["needPair"], true, "{v}");
    // 상한
    let v = say(&Ops { answers: vec![("POST /api/peer-say", 429, "too many")], ..Default::default() });
    assert!(v["error"].as_str().unwrap().contains("1분"), "{v}");
    // 짝 안 지은 기기엔 보내지도 않는다
    let ops = Ops::default();
    let v = answer(&request(&line(serde_json::json!({ "verb": "say", "device": "office-pc", "text": "x", "cid": "pc-3" }))).unwrap(), &ops);
    assert_eq!(v["needPair"], true);
    assert!(ops.calls.borrow().is_empty());
}

#[test]
fn 답_읽기는_받는_쪽_답을_그대로() {
    let ops = Ops { answers: vec![("GET /api/peer-reply", 200, r#"{"state":"done","text":"됐어"}"#)], ..Default::default() };
    let v = answer(&request(&line(serde_json::json!({ "verb": "reply", "device": "office-imac", "cid": "pc-1" }))).unwrap(), &ops);
    assert_eq!((v["ok"].as_bool(), v["state"].as_str(), v["text"].as_str()), (Some(true), Some("done"), Some("됐어")));
    assert_eq!(ops.calls.borrow()[0], "nA GET /api/peer-reply?cid=pc-1 ");
}

#[test]
fn cid_는_깨끗한_글자만() {
    let ops = Ops::default();
    let v = answer(&request(&line(serde_json::json!({ "verb": "reply", "device": "office-imac", "cid": "a&b=c" }))).unwrap(), &ops);
    assert_eq!(v["ok"], false);
    assert!(ops.calls.borrow().is_empty());
}

#[test]
fn pe_연결은_그_기기에_허용을_묻고_이미_연결됐으면_안_묻는다() {
    let ops = Ops::default();
    let ask = |dev: &str| PeerReq { id: "r1".into(), verb: "connect".into(), arg: serde_json::json!({ "verb": "connect", "device": dev }) };
    let a = answer(&ask("office-pc"), &ops);
    assert_eq!((a["ok"].as_bool(), a["device"].as_str()), (Some(true), Some("office-pc")));
    let a = answer(&ask("office-imac"), &ops);
    assert_eq!((a["ok"].as_bool(), a["already"].as_bool()), (Some(true), Some(true)));
    let a = answer(&ask("office-mini"), &ops);
    assert_eq!(a["ok"], false);
    assert!(a["error"].as_str().unwrap().contains("거절"));
    assert_eq!(ops.calls.borrow().iter().filter(|c| c.starts_with("connect ")).collect::<Vec<_>>(), ["connect nB", "connect nC"]);
    assert!(request(&line(serde_json::json!({ "verb": "connect", "device": "x" }))).is_some());
}

#[test]
fn pe_열쇠가_없으면_코드_말고_연결로_안내() {
    let ops = Ops::default();
    let r = PeerReq { id: "r1".into(), verb: "say".into(), arg: serde_json::json!({ "verb": "say", "device": "office-pc", "text": "x", "cid": "c1" }) };
    let e = answer(&r, &ops)["error"].as_str().unwrap().to_string();
    assert!(e.contains("scripts/peer connect office-pc") && e.contains("허용"), "{e}");
}

// 11-01 사용자: 테일스케일 없이가 기본 — 안 깔린 기기에서 scripts/peer 는 테일스케일을 켜라 대신 중계 길(self-say)로 이어 준다
#[test]
fn 테일스케일이_없으면_self_say_로_안내하고_테일스케일을_권하지_않는다() {
    let ops = Ops { no_ts: true, ..Default::default() };
    for verb in ["list", "say"] {
        let v = answer(&request(&line(serde_json::json!({ "verb": verb, "device": "office-imac", "text": "hi" }))).unwrap(), &ops);
        let e = v["error"].as_str().unwrap_or("");
        assert_eq!(v["ok"], false, "{verb}");
        assert!(e.contains("scripts/team self-say"), "{verb}: {e}");
        assert!(!e.contains("켜") && !e.contains("install"), "{verb}: 테일스케일을 켜라·깔아라 하지 않는다: {e}");
    }
}

fn stale(id: &str, name: &str) -> DeviceView {
    DeviceView { paused: Some("unbound"), ..dev(id, name, "account") }
}

// 11-12 — 같은 이름의 옛 테일넷 짝(계정 안 묶임)과 새 중계 짝이 같이 있으면 이름으로 부를 때 묶인 쪽이 이긴다
#[test]
fn 같은_이름이_둘이면_계정이_묶인_쪽을_고른다() {
    let (old, relay) = (stale("nOLD", "Front-Desk"), dev("relay:hub-1", "front-desk", "connected"));
    for list in [vec![old.clone(), relay.clone()], vec![relay.clone(), old.clone()]] {
        assert_eq!(find_device(&list, "front-desk").unwrap().id, "relay:hub-1");
        assert_eq!(find_device(&list, "Front-Desk").unwrap().id, "relay:hub-1", "이름이 글자까지 같은 옛 줄보다 묶인 줄");
        assert_eq!(find_device(&list, "front").unwrap().id, "relay:hub-1", "앞부분도");
        assert_eq!(find_device(&list, "nOLD").unwrap().id, "nOLD", "id 로 부르면 그 줄");
    }
    // 둘 다 멀쩡하면 옛 규칙 그대로(앞 줄)
    let two = vec![dev("nX", "box", "connected"), dev("relay:x", "box", "connected")];
    assert_eq!(find_device(&two, "box").unwrap().id, "nX");
}

#[test]
fn 목록은_멈춘_이유를_사람_말로_싣는다() {
    let ops = Ops { more: vec![stale("nOLD", "front-desk")], ..Default::default() };
    let v = answer(&PeerReq { id: "r".into(), verb: "list".into(), arg: json!({}) }, &ops);
    let d = v["devices"].as_array().unwrap().iter().find(|d| d["id"] == "nOLD").unwrap();
    assert!(d["pausedWord"].as_str().unwrap_or("").contains("예전 방식"), "{d}");
}

// 11-12 저녁 — 메일이 안 나가도 scripts/peer connect 엔 '메일도 보내'만 보였다. 연결 중 알림을 그 부탁 번호로 바로 넘긴다
#[test]
fn ml_연결_중_메일_결과를_그_부탁에_바로_넘긴다() {
    let ops = Ops::default();
    let v = answer(&PeerReq { id: "rq1".into(), verb: "connect".into(), arg: json!({ "device": "office-pc" }) }, &ops);
    assert_eq!(v["ok"], true);
    let calls = ops.calls.borrow();
    let n = calls.iter().position(|c| c.starts_with("note ")).expect("알림");
    assert!(calls[n].starts_with("note rq1 "), "{}", calls[n]);
    assert!(calls[n].contains("메일") && calls[n].contains("os error 49"), "사람 말로 + 이유: {}", calls[n]);
}

#[test]
fn ml_메일_알림_사람_말() {
    assert!(mail_note_word("mail-sent").contains("10분"));
    let f = mail_note_word("mail-failed:os error 49");
    assert!(f.contains("못") && f.contains("os error 49") && f.contains("카드"), "{f}");
}

