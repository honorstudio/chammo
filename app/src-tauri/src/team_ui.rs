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
    // 보안 번호 사람 상태(대화 위 알림·멤버 '확인됨')·멈춘 말(받아들이면 보낸다) — 시안 e2e-safety v1
    json!({ "view": team_cmd::view(&crate::team_relay::load_state(dir)), "items": items, "safety": crate::e2e_safety::view(dir), "held": crate::e2e_safety::held(dir) })
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

// ── 팀 설정(메신저 머리 톱니·팀 아이콘 메뉴) — scripts/team 에는 없는 길(나가기·빼기는 사람이 화면에서만) ──

fn kc_job<T: Send + 'static>(f: impl FnOnce(&Path, &dyn crate::accounts_store::Store, &dyn crate::team_relay::Http) -> Result<T, String> + Send + 'static) -> impl FnOnce(&Path) -> Result<T, String> {
    move |d| f(d, &crate::team_relay_keys::store(), &crate::team_relay::Curl)
}

async fn manage<T: Send + 'static>(f: impl FnOnce(&Path) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(crate::config::data_dir())).await.map_err(|e| e.to_string())?
}

/// 팀 이름 바꾸기(팀장) — team = 팀 id(빈 글 = 지금 팀)
#[tauri::command]
pub async fn team_ui_rename(window: tauri::WebviewWindow, team: String, name: String) -> Result<Value, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| crate::team_manage::rename(d, kc, h, &team, &name).map(|st| team_cmd::view(&st)))).await
}

/// 안 쓴 초대 목록(팀장)
#[tauri::command]
pub async fn team_ui_invites(window: tauri::WebviewWindow, team: String) -> Result<Vec<crate::team_manage::OpenInvite>, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| crate::team_manage::invites(d, kc, h, &team))).await
}

/// 안 쓴 초대 전부 막기(팀장) — 막은 개수
#[tauri::command]
pub async fn team_ui_revoke_invites(window: tauri::WebviewWindow, team: String) -> Result<u64, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| crate::team_manage::revoke_invites(d, kc, h, &team))).await
}

/// 팀 나가기 — 화면이 '정말 나가기' 확인을 받은 뒤에만 부른다(scripts/team leave 와 같은 team_relay::leave)
#[tauri::command]
pub async fn team_ui_leave(window: tauri::WebviewWindow, team: String) -> Result<Value, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| crate::team_relay::leave(d, kc, h, &team).map(|st| team_cmd::view(&st)))).await
}

/// 지금 팀 바꾸기 — 띠·메신저 창 팀 아이콘 메뉴(QA 6). scripts/team use 와 같은 team_relay::use_team
#[tauri::command]
pub async fn team_ui_use(window: tauri::WebviewWindow, team: String) -> Result<Value, String> {
    ui_only(&window)?;
    manage(move |d| crate::team_relay::use_team(d, &team).map(|st| team_cmd::view(&st))).await
}

/// 팀 지우기(팀장) — 화면이 '정말 지우기' 확인을 받은 뒤에만 부른다. 되돌릴 수 없어 scripts/team·참모 길엔 없다
#[tauri::command]
pub async fn team_ui_delete(window: tauri::WebviewWindow, team: String) -> Result<Value, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| crate::team_relay::delete_team(d, kc, h, &team).map(|st| team_cmd::view(&st)))).await
}

/// 팀장으로 바꾸기(팀장) — team_relay::set_role
#[tauri::command]
pub async fn team_ui_make_owner(window: tauri::WebviewWindow, team: String, member: String) -> Result<Value, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| crate::team_relay::set_role(d, kc, h, &team, &member, "owner").map(|st| team_cmd::view(&st)))).await
}

/// 팀원 빼기(팀장) — 화면이 확인을 받은 뒤에만(team_relay::remove_member)
#[tauri::command]
pub async fn team_ui_remove(window: tauri::WebviewWindow, team: String, member: String) -> Result<Value, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| crate::team_relay::remove_member(d, kc, h, &team, &member).map(|st| team_cmd::view(&st)))).await
}

/// 단톡방 만들기 — 나 + 고른 사람(멤버 id). 만들면 연결 스레드가 바로 그 방에 붙는다
#[tauri::command]
pub async fn team_ui_room_new(window: tauri::WebviewWindow, team: String, name: String, people: Vec<String>) -> Result<Value, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| {
        let r = crate::team_rooms::create_room(d, kc, h, &team, &name, &people)?;
        crate::team_relay_ws::ensure(d);
        Ok(json!({ "room": r.id, "name": r.name }))
    }))
    .await
}

/// 단톡방 이름·사람 바꾸기 — name 이 비면 그대로
#[tauri::command]
pub async fn team_ui_room_set(window: tauri::WebviewWindow, room: String, name: String, add: Vec<String>, remove: Vec<String>) -> Result<Value, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| {
        let n = name.trim().to_string();
        crate::team_rooms::update_room(d, kc, h, &room, (!n.is_empty()).then_some(n.as_str()), &add, &remove).map(|st| team_cmd::view(&st))
    }))
    .await
}

/// '전체' 팀챗 — 없을 때만(team_rooms::ensure_all_room). 화면이 팀장 기기에서 부른다
#[tauri::command]
pub async fn team_ui_all_room(window: tauri::WebviewWindow, team: String, name: String, people: Vec<String>) -> Result<Value, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| {
        let made = crate::team_rooms::ensure_all_room(d, kc, h, &team, &name, &people)?;
        if made.is_some() {
            crate::team_relay_ws::ensure(d);
        }
        Ok(json!({ "made": made.is_some(), "room": made }))
    }))
    .await
}

/// 단톡방 만든 사람·지울 수 있나 — 우클릭 메뉴를 열 때
#[tauri::command]
pub async fn team_ui_room_info(window: tauri::WebviewWindow, room: String) -> Result<Value, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| crate::team_rooms::room_info(d, kc, h, &room))).await
}

/// 단톡방 지우기(만든 사람·팀장) — 모두에게서 사라진다. 화면이 '지우기' 글자 확인을 받은 뒤에만, scripts/team·참모 길엔 없다
#[tauri::command]
pub async fn team_ui_room_delete(window: tauri::WebviewWindow, room: String) -> Result<Value, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| crate::team_rooms::delete_room(d, kc, h, &room).map(|st| team_cmd::view(&st)))).await
}

/// 단톡방 나가기 — 화면이 확인을 받은 뒤에만
#[tauri::command]
pub async fn team_ui_room_leave(window: tauri::WebviewWindow, room: String) -> Result<Value, String> {
    ui_only(&window)?;
    manage(kc_job(move |d, kc, h| crate::team_rooms::leave_room(d, kc, h, &room).map(|st| team_cmd::view(&st)))).await
}

/// 대화에 붙일 파일 고르기 — 앱 창에 붙는 시트(NSOpenPanel, 보관함·세션 브라우저와 같은 창). 취소면 빈 목록
#[tauri::command]
pub async fn team_pick_files(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Vec<String>, String> {
    ui_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || crate::agent_browser::choose_files(&app, true, crate::i18n::tr("대화에 붙일 파일", "Files to attach"))).await.map_err(|e| e.to_string())?
}

/// 클립보드에 받은 초대 링크가 있으면 그 링크만 — 사람이 '초대받았어요'를 누를 때. 클립보드 원문은 화면에 안 넘긴다
/// (웹뷰 navigator.clipboard.readText 는 맥에서 '붙여넣기' 말풍선을 한 번 더 누르게 한다)
#[tauri::command]
pub async fn team_clip_invite(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    ui_only(&window)?;
    Ok(tauri::async_runtime::spawn_blocking(|| clipboard_text().and_then(|t| crate::team_relay::invite_in_text(&t))).await.ok().flatten())
}

#[cfg(target_os = "macos")]
fn clipboard_text() -> Option<String> {
    let o = crate::platform::command("/usr/bin/pbpaste").output().ok()?;
    o.status.success().then(|| String::from_utf8_lossy(&o.stdout[..o.stdout.len().min(16_000)]).into_owned())
}

#[cfg(windows)]
fn clipboard_text() -> Option<String> {
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard};
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    const CF_UNICODETEXT: u32 = 13;
    // SAFETY: 열면 늘 닫는다. 잠근 메모리는 0 글자까지(최대 16,000자)만 읽고 바로 푼다
    unsafe {
        if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 || OpenClipboard(std::ptr::null_mut()) == 0 {
            return None;
        }
        let h = GetClipboardData(CF_UNICODETEXT);
        let mut out = None;
        if !h.is_null() {
            let p = GlobalLock(h) as *const u16;
            if !p.is_null() {
                let mut n = 0;
                while n < 16_000 && *p.add(n) != 0 {
                    n += 1;
                }
                out = Some(String::from_utf16_lossy(std::slice::from_raw_parts(p, n)));
                GlobalUnlock(h);
            }
        }
        CloseClipboard();
        out
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn clipboard_text() -> Option<String> {
    None
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
