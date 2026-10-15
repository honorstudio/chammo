use super::*;
use crate::remote::{CallOut, DeviceView, DevicesOut};
use std::cell::RefCell;

fn dev(id: &str, name: &str, status: &'static str) -> DeviceView {
    DeviceView { id: id.into(), name: name.into(), os: "macOS".into(), status, paired: status != "pair", old: false, version: Some("0.3.2".into()), last_ok: None }
}

#[derive(Default)]
struct Ops {
    calls: RefCell<Vec<String>>,
    /// (method path) → (status, 본문) — 없으면 404
    answers: Vec<(&'static str, u16, &'static str)>,
    /// call 이 이 오류로 실패(열쇠 끊김 "pair" 등)
    fail: Option<&'static str>,
}

impl PeerOps for Ops {
    fn devices(&self) -> Result<DevicesOut, String> {
        Ok(DevicesOut { me: "laptop".into(), devices: vec![dev("nA", "office-imac", "connected"), dev("nB", "office-pc", "pair"), dev("nC", "office-mini", "offline")] })
    }
    fn pair(&self, id: &str, code: &str) -> Result<(), String> {
        self.calls.borrow_mut().push(format!("pair {id} {code}"));
        Ok(())
    }
    fn unpair(&self, id: &str) -> Result<(), String> {
        self.calls.borrow_mut().push(format!("unpair {id}"));
        Ok(())
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
            ("GET /api/env", 200, r#"{"hqDir":"/Users/x/hq","assistantName":"참모"}"#),
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
