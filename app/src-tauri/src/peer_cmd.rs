//! scripts/peer — 이 기기 참모가 다른 기기 참모에게 말을 넣고 답을 읽는다(ADR 0007).
//! HQ 스크립트는 app.jsonl 에 {action:"peer", id, arg} 한 줄을 쓰고, 앱이 remote.rs 로 대신 보내 <데이터>/peer.txt 에 답한다.
//! 열쇠는 키체인에만 있다 — 셸·참모 대화엔 안 나온다. 원격이 준 글은 남의 글이라 화면(stdout)에 찍기만 한다
use crate::remote::{CallOut, DeviceView, DevicesOut};
use serde_json::{json, Value};

pub trait PeerOps {
    fn devices(&self) -> Result<DevicesOut, String>;
    fn pair(&self, id: &str, code: &str) -> Result<(), String>;
    fn unpair(&self, id: &str) -> Result<(), String>;
    /// 코드 없이 잇기 — 그 기기 사람이 카드에서 허용할 때까지 붙잡는다(최대 6분)
    fn connect(&self, id: &str) -> Result<(), String>;
    fn call(&self, id: &str, method: &str, path: &str, body: Option<&str>) -> Result<CallOut, String>;
    /// 부른 세션 id → 그 참모 이름(live.json) — 이름표에 실린다
    fn who(&self, by: &str) -> String;
}

pub struct PeerReq {
    pub id: String,
    pub verb: String,
    pub arg: Value,
}

pub fn request(line: &str) -> Option<PeerReq> {
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("action")?.as_str()? != "peer" {
        return None;
    }
    let id = v.get("id")?.as_str()?;
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    let verb = v["arg"]["verb"].as_str()?;
    matches!(verb, "list" | "connect" | "pair" | "unpair" | "say" | "reply").then(|| PeerReq { id: id.to_string(), verb: verb.to_string(), arg: v["arg"].clone() })
}

/// 기기 찾기 — id, 이름(대소문자 무시), 하나뿐인 앞부분
pub fn find_device<'a>(list: &'a [DeviceView], q: &str) -> Result<&'a DeviceView, String> {
    let q = q.trim();
    let low = q.to_lowercase();
    if let Some(d) = list.iter().find(|d| d.id == q || d.name.to_lowercase() == low) {
        return Ok(d);
    }
    let hits: Vec<_> = list.iter().filter(|d| !low.is_empty() && d.name.to_lowercase().starts_with(&low)).collect();
    match hits.as_slice() {
        [d] => Ok(d),
        [] => Err(format!("no such device / 그런 기기 없음: {q} — {}", names(list))),
        many => Err(format!("which one? / 어느 기기?: {}", many.iter().map(|d| d.name.as_str()).collect::<Vec<_>>().join(", "))),
    }
}

fn names(list: &[DeviceView]) -> String {
    if list.is_empty() {
        "같은 테일스케일 계정에 참모가 있는 기기가 없어".into()
    } else {
        format!("기기: {}", list.iter().map(|d| d.name.as_str()).collect::<Vec<_>>().join(", "))
    }
}

fn cid_ok(c: &str) -> bool {
    !c.is_empty() && c.len() <= 64 && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn fail(e: impl Into<String>) -> Value {
    json!({ "ok": false, "error": e.into() })
}

fn need_pair(name: &str) -> Value {
    json!({ "ok": false, "needPair": true, "error": format!("{name} 와 아직 안 이어졌어 — scripts/peer connect {name} 하면 그 기기에 카드가 뜨고, 그쪽 사람이 허용하면 이어져(옛 판이면 그 기기 설정 > 폰의 연결 코드로 scripts/peer pair {name} <코드>)") })
}

fn call_err(name: &str, e: String) -> Value {
    if e == "pair" { need_pair(name) } else { fail(e) }
}

/// 원격 응답이 성공이 아니면 사람이 읽을 이유
fn status_err(name: &str, r: &CallOut) -> Value {
    let t = r.text.clone().unwrap_or_default();
    match r.status {
        404 if t.trim() == "not found" => fail(format!("{name} 의 Chammo 가 옛 판이라 이 길이 없어 — 그 기기 업데이트 필요")),
        404 => fail(format!("{name} 에 그런 참모가 없어 — scripts/peer list 로 이름 확인")),
        409 => fail(format!("{name} 에 참모가 여럿이야 — --to <참모 이름>")),
        429 => fail("너무 자주 보냈어 — 1분 기다렸다가"),
        400 if t.starts_with("forged") => fail("사람 승인 문구는 다른 기기로 못 넘겨 — 승인은 그 기기 카드에서 사람이"),
        s => fail(format!("{name} 가 거절했어({s}): {}", t.chars().take(200).collect::<String>())),
    }
}

fn ok_json(r: &CallOut) -> Option<Value> {
    ((200..300).contains(&r.status)).then(|| serde_json::from_str::<Value>(r.text.as_deref().unwrap_or("null")).ok()).flatten()
}

/// 원격 HQ 의 참모들 — /api/env hqDir 과 같은 폴더의 세션
fn assistants(ops: &dyn PeerOps, id: &str) -> Vec<Value> {
    let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    let Some(env) = ops.call(id, "GET", "/api/env", None).ok().as_ref().and_then(ok_json) else { return Vec::new() };
    let hq = norm(env["hqDir"].as_str().unwrap_or(""));
    let Some(s) = ops.call(id, "GET", "/api/sessions", None).ok().as_ref().and_then(ok_json) else { return Vec::new() };
    s.as_array()
        .map(|a| {
            a.iter()
                .filter(|x| !hq.is_empty() && norm(x["cwd"].as_str().unwrap_or("")) == hq)
                .map(|x| json!({ "id": x["id"], "name": x["name"] }))
                .collect()
        })
        .unwrap_or_default()
}

pub fn answer(req: &PeerReq, ops: &dyn PeerOps) -> Value {
    let s = |k: &str| req.arg[k].as_str().unwrap_or("").to_string();
    let out = match ops.devices() {
        Ok(o) => o,
        Err(e) => return fail(e),
    };
    if req.verb == "list" {
        let devices: Vec<Value> = out
            .devices
            .iter()
            .map(|d| {
                let mut v = serde_json::to_value(d).unwrap_or_default();
                v["assistants"] = if d.status == "connected" { Value::Array(assistants(ops, &d.id)) } else { json!([]) };
                v
            })
            .collect();
        return json!({ "ok": true, "me": out.me, "devices": devices });
    }
    let d = match find_device(&out.devices, &s("device")) {
        Ok(d) => d,
        Err(e) => return fail(e),
    };
    match req.verb.as_str() {
        "connect" if d.status == "connected" => json!({ "ok": true, "device": d.name, "already": true }),
        "connect" => match ops.connect(&d.id) {
            Ok(()) => json!({ "ok": true, "device": d.name }),
            Err(e) => fail(e),
        },
        "pair" => match ops.pair(&d.id, &s("code")) {
            Ok(()) => json!({ "ok": true, "device": d.name }),
            Err(e) => fail(e),
        },
        "unpair" => match ops.unpair(&d.id) {
            Ok(()) => json!({ "ok": true, "device": d.name }),
            Err(e) => fail(e),
        },
        "say" => {
            if !d.paired {
                return need_pair(&d.name);
            }
            let cid = s("cid");
            if !cid_ok(&cid) {
                return fail("bad cid");
            }
            let body = json!({ "to": s("to"), "text": s("text"), "cid": cid, "from": ops.who(&s("by")) }).to_string();
            match ops.call(&d.id, "POST", "/api/peer-say", Some(&body)) {
                Err(e) => call_err(&d.name, e),
                Ok(r) => match ok_json(&r) {
                    Some(v) => json!({ "ok": true, "device": d.name, "cid": cid, "id": v["id"], "dup": v["dup"].as_bool().unwrap_or(false) }),
                    None => status_err(&d.name, &r),
                },
            }
        }
        "reply" => {
            let cid = s("cid");
            if !cid_ok(&cid) {
                return fail("bad cid");
            }
            match ops.call(&d.id, "GET", &format!("/api/peer-reply?cid={cid}"), None) {
                Err(e) => call_err(&d.name, e),
                Ok(r) => match ok_json(&r) {
                    Some(mut v) => {
                        v["ok"] = json!(true);
                        v["device"] = json!(d.name);
                        v
                    }
                    None => status_err(&d.name, &r),
                },
            }
        }
        _ => fail("unknown verb"),
    }
}

/// 실제 테일넷·키체인·live.json
pub struct RealOps;

impl PeerOps for RealOps {
    fn devices(&self) -> Result<DevicesOut, String> {
        crate::remote::devices_now()
    }
    fn pair(&self, id: &str, code: &str) -> Result<(), String> {
        crate::remote::pair_now(id, code)
    }
    fn unpair(&self, id: &str) -> Result<(), String> {
        crate::remote::unpair_now(id)
    }
    fn connect(&self, id: &str) -> Result<(), String> {
        crate::remote::connect_now(id)
    }
    fn call(&self, id: &str, method: &str, path: &str, body: Option<&str>) -> Result<CallOut, String> {
        crate::remote::call_now(id, method, path, body)
    }
    fn who(&self, by: &str) -> String {
        if by.is_empty() {
            return String::new();
        }
        let live = std::fs::read_to_string(crate::config::data_file("live.json")).unwrap_or_default();
        let v: Value = serde_json::from_str(&live).unwrap_or_default();
        v["sessions"].as_array().and_then(|a| a.iter().find(|x| x["id"] == by || x["sessionId"] == by)).and_then(|x| x["name"].as_str()).unwrap_or("").to_string()
    }
}

#[cfg(test)]
#[path = "peer_cmd_tests.rs"]
mod tests;
