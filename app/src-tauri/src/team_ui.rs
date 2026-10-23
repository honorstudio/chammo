//! 메신저 화면(메인 창·메신저 따로 창 team-*)이 부르는 명령 — 받은 말 읽기·팀 만들기/들어오기/초대.
//! 사람 말 보내기는 team_cmd::team_human_say(HumanProof) 하나 — 이 모듈은 읽기와 팀 일만.
//! 팀 일은 scripts/team 과 같은 길(team_cmd::answer)을 거쳐 거름·잠금이 한 벌이다
use crate::team_cmd::{self, TeamReq};
use serde_json::{json, Value};
use std::path::Path;

/// 메신저 따로 창 라벨 앞자리 — 우리 앱 페이지(messenger.html)만 뜨는 창
pub const WIN_PREFIX: &str = "team-";

/// 메신저 화면을 띄우는 창인가 — 메인 창 또는 메신저 따로 창
pub fn ui_window(label: &str) -> bool {
    label == "main" || label.starts_with(WIN_PREFIX)
}

fn ui_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if ui_window(w.label()) { Ok(()) } else { Err("messenger windows only".into()) }
}

/// 화면용 한 덩어리 — 팀 상태 + 팀 방 말 끝 n 줄(내 기기끼리 방은 메신저 화면에 안 그린다 — 설정 > Chammo 계정 쪽)
pub fn feed(dir: &Path, n: usize) -> Value {
    let items: Vec<Value> = team_cmd::inbox_tail(dir, n).into_iter().filter(|v| v["kind"] != "self").collect();
    json!({ "view": team_cmd::view(&crate::team_relay::load_state(dir)), "items": items })
}

/// 팀 이름·내 이름 — 앞뒤 공백 빼고 1~40자, 줄바꿈 없이
pub fn name_ok(s: &str) -> Option<String> {
    let t = s.trim();
    (!t.is_empty() && t.chars().count() <= 40 && !t.chars().any(char::is_control)).then(|| t.to_string())
}

/// 화면에서 만들기·들어오기 — 서버는 로그인한 그 서버(화면엔 서버 칸이 없다), 내 이름은 비면 계정 이름
pub fn team_arg(st: &crate::team_relay::TeamState, verb: &str, me: &str, extra: Value) -> Result<TeamReq, String> {
    if st.server.trim().is_empty() {
        return Err(crate::i18n::tr("먼저 설정 > Chammo 계정에서 로그인해 줘", "Sign in first in Settings > Chammo account").into());
    }
    let me = name_ok(me).or_else(|| st.account.as_ref().and_then(|a| name_ok(&a.name))).ok_or_else(|| crate::i18n::tr("내 이름이 비었어", "Your name is empty").to_string())?;
    let mut arg = json!({ "verb": verb, "server": st.server, "me": me, "device": if st.device_name.trim().is_empty() { crate::team_account::default_device_name() } else { st.device_name.clone() } });
    if let Some(o) = extra.as_object() {
        for (k, v) in o {
            arg[k] = v.clone();
        }
    }
    Ok(TeamReq { id: "ui".into(), verb: verb.into(), arg })
}

fn done(v: Value) -> Result<Value, String> {
    if v["ok"] == true { Ok(v) } else { Err(v["error"].as_str().unwrap_or("?").to_string()) }
}

/// 팀 일을 뒤 스레드에서 — 실제 키체인·curl·연결 스레드(scripts/team 과 같은 RealWire)
async fn job(f: impl FnOnce(&Path) -> Result<Value, String> + Send + 'static) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || f(crate::config::data_dir())).await.map_err(|e| e.to_string())?
}

fn run(dir: &Path, req: &TeamReq) -> Result<Value, String> {
    done(team_cmd::answer(req, dir, &crate::team_relay_keys::store(), &team_cmd::RealWire))
}

/// 팀 상태 + 받은 말 — 메인 창·메신저 창. 기록 파일 하나 읽기라 가볍다
#[tauri::command]
pub fn team_feed(window: tauri::WebviewWindow, n: Option<u32>) -> Result<Value, String> {
    ui_only(&window)?;
    Ok(feed(crate::config::data_dir(), n.unwrap_or(400).min(2000) as usize))
}

/// 팀 만들기(계정으로 로그인한 기기)
#[tauri::command]
pub async fn team_ui_create(window: tauri::WebviewWindow, team: String, me: String) -> Result<Value, String> {
    ui_only(&window)?;
    let team = name_ok(&team).ok_or("팀 이름은 1~40자")?;
    job(move |d| run(d, &team_arg(&crate::team_relay::load_state(d), "create", &me, json!({ "team": team }))?)).await
}

/// 초대 링크로 들어오기
#[tauri::command]
pub async fn team_ui_join(window: tauri::WebviewWindow, invite: String, me: String) -> Result<Value, String> {
    ui_only(&window)?;
    let code = invite.trim().to_string();
    if code.is_empty() || code.len() > 400 {
        return Err("초대 링크가 비었거나 너무 길어".into());
    }
    job(move |d| {
        let st = crate::team_relay::load_state(d);
        // 링크 안 서버를 쓴다 — 로그인 안 한 기기는 서버가 없으니 링크가 서버를 준다
        let mut req = match team_arg(&st, "join", &me, json!({ "code": code })) {
            Ok(r) => r,
            Err(_) if crate::team_relay::parse_invite(&code).0.is_some() => {
                let me = name_ok(&me).ok_or("내 이름이 비었어")?;
                TeamReq { id: "ui".into(), verb: "join".into(), arg: json!({ "verb": "join", "server": "", "me": me, "device": crate::team_account::default_device_name(), "code": code }) }
            }
            Err(e) => return Err(e),
        };
        req.arg["server"] = json!(if st.server.is_empty() { String::new() } else { st.server.clone() });
        run(d, &req)
    })
    .await
}

/// 초대 링크 만들기(팀장 기기만 — 서버가 가른다)
#[tauri::command]
pub async fn team_ui_invite(window: tauri::WebviewWindow) -> Result<Value, String> {
    ui_only(&window)?;
    job(|d| run(d, &TeamReq { id: "ui".into(), verb: "invite".into(), arg: json!({ "verb": "invite" }) })).await
}

/// 폰 팀 시트(초대 링크·팀 만들기) — 데스크톱 화면과 같은 길(scripts/team answer)
pub fn phone_job(verb: &str, extra: Value) -> Result<Value, String> {
    let dir = crate::config::data_dir();
    let req = if verb == "invite" { TeamReq { id: "ui".into(), verb: "invite".into(), arg: json!({ "verb": "invite" }) } } else { team_arg(&crate::team_relay::load_state(dir), verb, "", extra)? };
    run(dir, &req)
}

/// 넘길 내 참모 이름 — 세션 목록에서 id 의 이름(별명 " · " 앞까지가 번호, 뒤가 별명이면 별명)
pub fn handoff_name(sessions_json: &str, id: &str) -> String {
    let v: Value = serde_json::from_str(sessions_json).unwrap_or(Value::Null);
    let name = v.as_array().and_then(|a| a.iter().find(|x| x["id"] == id)).and_then(|x| x["name"].as_str()).unwrap_or("").to_string();
    name.split_once(" · ").map(|(_, nick)| nick.to_string()).filter(|n| !n.is_empty()).unwrap_or(name)
}

/// 넘기기 글 거름 — 참모 입력칸은 터미널이라 CR 은 Enter·ESC 는 제어열. 줄 나눔 글자는 줄바꿈으로, 그 밖의 제어·보이지 않는 글자는 뺀다(줄바꿈·탭만).
/// 화면(domain/teamChat handoffText)도 같은 거름을 하지만 Rust 가 다시 본다 — 세 길(메인 창·따로 창·폰)이 다 이걸 지난다(보안 검토 10-23)
pub fn handoff_clean(text: &str) -> Result<String, String> {
    use crate::peer_link::{invisible, line_break};
    let t: String = text.replace("\r\n", "\n").chars().map(|c| if c == '\r' || line_break(c) { '\n' } else { c }).filter(|c| (!c.is_control() || *c == '\n' || *c == '\t') && !invisible(*c)).collect();
    if t.trim().is_empty() || t.chars().count() > 8000 {
        return Err("빈 글이거나 너무 길어".into());
    }
    Ok(t)
}

/// 넘기기 — 받는 참모(to = 세션 id, 비면 받은 팀 말을 받는 그 참모)를 HQ 참모에서 찾아, 거른 글을 본문 없는 기록 길(team-handoff)로 친다.
/// 이름을 돌려준다(dry = 이름만)
pub fn handoff_send(to: &str, text: &str, dry: bool) -> Result<String, String> {
    let text = if dry { String::new() } else { handoff_clean(text)? };
    let st = crate::team_relay::load_state(crate::config::data_dir());
    let sessions = crate::claude::agents_json()?;
    let hq = crate::config::hq_dir(&crate::config::home(), &crate::config::current(), |k| std::env::var(k).ok());
    let id = if to.trim().is_empty() {
        crate::team_relay_inbox::assistant(&st, &sessions, &hq, &crate::config::assistant_name()).ok_or("넘길 참모 세션이 없어")?
    } else {
        // 고른 참모도 HQ 참모만(아무 세션에나 치지 않게)
        crate::peer_link::target(&sessions, &hq, to.trim()).map_err(|_| "그 참모 세션이 없어".to_string())?
    };
    if !dry {
        crate::claude::type_text_tagged(&id, &text, "team-handoff")?;
    }
    Ok(handoff_name(&sessions, &id))
}

/// '내 참모에게 넘기기'(메인 창 = 고른 참모 to, 따로 창 = 받은 팀 말을 받는 그 참모 — team.json deliverTo, 비면 설정 참모 이름).
/// dry = 이름만(창이 단추 글자를 그린다). 넘기는 글은 화면이 지은 것(domain/teamChat handoffText — 내 말 먼저, 남의 말은 › 로)
#[tauri::command]
pub async fn team_handoff(window: tauri::WebviewWindow, text: String, dry: bool, to: Option<String>) -> Result<String, String> {
    ui_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || handoff_send(to.as_deref().unwrap_or(""), &text, dry)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "team_ui_tests.rs"]
mod tests;
