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
    // 읽음(chammo-relay ADR 0012) — 방 → 멤버 → seq. 화면이 말마다 안 읽은 사람 수·내 안 읽음(같은 계정 다른 기기에서 읽은 것)을 센다
    json!({ "view": team_cmd::view(&crate::team_relay::load_state(dir)), "items": items, "safety": crate::e2e_safety::view(dir), "held": crate::e2e_safety::held(dir), "reads": crate::team_reads::load(dir) })
}

/// 사람이 이 방을 seq 까지 봤다 — 이 기기에 바로 적고(창·폰이 바로 맞게) 중계에 올리게 연결 스레드에 맡긴다.
/// 화면은 사람이 보고 있을 때만(창 포커스·화면 보임) 부른다 — 메인 창·메신저 창·폰 /api/team-read
pub fn mark_read(dir: &Path, room: &str, seq: u64) -> Result<(), String> {
    let me = crate::team_reads::my_member(&crate::team_relay::load_state(dir), room);
    if me.is_empty() || seq == 0 {
        return Err("모르는 방".into());
    }
    if crate::team_reads::merge(dir, room, &[(me, seq)]) {
        crate::team_alert::poke_state();
    }
    crate::team_relay_ws::read(room, seq);
    Ok(())
}

#[tauri::command]
pub fn team_mark_read(window: tauri::WebviewWindow, room: String, seq: u64) -> Result<(), String> {
    ui_only(&window)?;
    mark_read(crate::config::data_dir(), &room, seq)
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

/// 대화 입력칸 ⌘V — 클립보드의 파인더 파일(복사한 파일 주소)·그림(스크린샷 복사)을 붙일 경로로(10-28 사용자 "붙여넣기 하면 안 들어감").
/// 웹뷰는 파일 주소를 안 넘기고 그림도 못 넘길 때가 있어 맥 클립보드를 직접 읽는다. 그림은 데이터 폴더 team-paste 에 name.png 로 둔다. 글만 있으면 빈 목록
#[tauri::command]
pub async fn team_clip_files(window: tauri::WebviewWindow, name: String) -> Result<Vec<String>, String> {
    ui_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || clip_files(&crate::config::data_file(PASTE_DIR), None, &name)).await.map_err(|e| e.to_string())?
}

/// 붙여넣은 그림 자리(데이터 폴더) — 붙일 때마다 새 칸, 하루 지난 칸은 지운다(올린 뒤엔 팀 보관함에 봉해져 있다)
const PASTE_DIR: &str = "team-paste";

/// 붙인 그림 이름(화면이 지은 것) — 경로·제어 글자는 '-', 80자, 비면 기본
pub(crate) fn paste_stem(name: &str) -> String {
    let s: String = name.trim().chars().map(|c| if c == '/' || c == '\\' || c == ':' || c.is_control() { '-' } else { c }).take(80).collect();
    let s = s.trim_end_matches('-').to_string();
    if s.trim_matches('.').trim().is_empty() { crate::i18n::tr("붙여넣은 그림", "Pasted image").to_string() } else { s }
}

/// 읽기 스크립트 출력 — F<탭>파일 경로 여러 줄, 또는 I<탭>그림 경로 한 줄. 절대 경로만
pub(crate) fn parse_clip(out: &str) -> (Vec<String>, Option<String>) {
    let mut files = vec![];
    let mut image = None;
    for l in out.lines() {
        match l.split_once('\t') {
            Some(("F", p)) if p.starts_with('/') => files.push(p.to_string()),
            Some(("I", p)) if p.starts_with('/') => image = Some(p.to_string()),
            _ => {}
        }
    }
    (files, image)
}

/// 파일 주소가 있으면 그것(폴더는 뺀다, 한글은 NFC 로 모아 — 파인더는 풀어 쓴 꼴(NFD)로 줘서 윈도우 팀원에겐 자모가 흩어져 보인다),
/// 없으면 그림 한 장(png·jpeg·tiff 순, tiff 는 png 로)
#[cfg(target_os = "macos")]
const CLIP_JS: &str = r#"function run(a){ObjC.import('AppKit');const pb=a[1]?$.NSPasteboard.pasteboardWithName(a[1]):$.NSPasteboard.generalPasteboard;
const u=pb.readObjectsForClassesOptions($([$.NSURL]),$({NSPasteboardURLReadingFileURLsOnlyKey:true}));const o=[];
if(u&&u.count>0){for(let i=0;i<u.count;i++)o.push('F\t'+u.objectAtIndex(i).path.precomposedStringWithCanonicalMapping.js);return o.join('\n');}
for(const [t,e] of [['public.png','png'],['public.jpeg','jpg'],['public.tiff','tiff']]){const d=pb.dataForType(t);
if(d&&!d.isNil()&&d.length>0){const f=a[0]+'.'+e;d.writeToFileAtomically(f,true);return 'I\t'+f;}}return '';}"#;

/// board = 시험용 이름 붙은 클립보드(사람 클립보드를 안 건드린다), 없으면 일반 클립보드
#[cfg(target_os = "macos")]
pub(crate) fn clip_files(dir: &std::path::Path, board: Option<&str>, name: &str) -> Result<Vec<String>, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            if e.metadata().and_then(|m| m.modified()).is_ok_and(|t| now.duration_since(t).is_ok_and(|d| d.as_secs() > 86_400)) {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    let nanos = now.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let slot = dir.join(format!("{nanos}"));
    std::fs::create_dir_all(&slot).map_err(|e| e.to_string())?;
    let stem = slot.join(paste_stem(name));
    let out = crate::platform::command("/usr/bin/osascript").args(["-l", "JavaScript", "-e", CLIP_JS]).arg(&stem).arg(board.unwrap_or("")).output().map_err(|e| format!("클립보드를 못 읽었어: {e}"))?;
    if !out.status.success() {
        let _ = std::fs::remove_dir_all(&slot);
        return Err(format!("클립보드를 못 읽었어: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let (files, image) = parse_clip(&String::from_utf8_lossy(&out.stdout));
    if !files.is_empty() {
        let _ = std::fs::remove_dir_all(&slot);
        return Ok(files.into_iter().filter(|p| std::path::Path::new(p).is_file()).take(50).collect());
    }
    let Some(img) = image else {
        let _ = std::fs::remove_dir_all(&slot);
        return Ok(vec![]);
    };
    if !img.ends_with(".tiff") {
        return Ok(vec![img]);
    }
    let png = std::path::PathBuf::from(format!("{}.png", stem.display()));
    let ok = crate::platform::command("/usr/bin/sips").args(["-s", "format", "png"]).arg(&img).arg("--out").arg(&png).output().is_ok_and(|o| o.status.success());
    let _ = std::fs::remove_file(&img);
    if ok { Ok(vec![png.to_string_lossy().into_owned()]) } else { Err("붙인 그림을 png 로 못 바꿨어".into()) }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn clip_files(_dir: &std::path::Path, _board: Option<&str>, _name: &str) -> Result<Vec<String>, String> {
    Err(crate::i18n::tr("이 컴퓨터에선 아직 붙여넣기로 못 붙여요 — 끌어다 놓거나 + 로 붙여 줘", "Pasting files isn't supported here yet — drag them in or use +").into())
}

/// 창 밖에 놓은 참모 보관함 파일 — 그 화면 자리(x, y: 화면 논리 좌표)에 있는 다른 앱 창(메인·메신저 따로 창)이 그 자리에 놓은 것처럼 받게 한다.
/// 포인터 끌기는 시작한 창 밖으로 못 나가서 창 사이 끌기가 그냥 버려졌다(10-28 사용자). 넘긴 창이 있으면 true
#[tauri::command]
pub fn drag_out(app: tauri::AppHandle, window: tauri::WebviewWindow, paths: Vec<String>, x: f64, y: f64) -> Result<bool, String> {
    use tauri::Manager;
    ui_only(&window)?;
    if !drag_paths_ok(&paths) {
        return Err("파일은 절대 경로로 한 번에 1~50개".into());
    }
    let wins = ui_windows(&app);
    let hit = window_at(&wins, window.label(), x, y);
    // 놓은 창은 __dragIn 이 지나감 표를 지운다 — 다른 창에 남은 지나감만 끝낸다
    hover_move(&app, hit.as_ref().map(|h| h.0.as_str()));
    let Some((label, cx, cy)) = hit else { return Ok(false) };
    let Some(w) = app.get_webview_window(&label) else { return Ok(false) };
    let Some(rect) = wins.iter().find(|r| r.0 == label) else { return Ok(false) };
    let _ = w.set_focus();
    let mut at = at_payload(cx, cy, rect);
    at["paths"] = json!(paths);
    w.eval(format!("window.__dragIn && window.__dragIn({at})")).map_err(|e| e.to_string())?;
    Ok(true)
}

/// 창 밖에 놓은 팀 보관함 파일(id — 풀기 전엔 경로가 없다) — 그 화면 자리 다른 앱 창이 받는다(__dragInTeam: 참모 얼굴·채팅 칸이면 그 참모에게).
/// 메신저 따로 창 팀 파일을 메인 창 참모에게 끌어 주려 해도 '이 창 안에서만'이었다(10-28 사용자). 넘긴 창이 있으면 true
#[tauri::command]
pub fn drag_out_team(app: tauri::AppHandle, window: tauri::WebviewWindow, team: String, ids: Vec<String>, x: f64, y: f64) -> Result<bool, String> {
    use tauri::Manager;
    ui_only(&window)?;
    if !team_drag_ok(&team, &ids) {
        return Err("팀 파일은 한 번에 1~50개".into());
    }
    let wins = ui_windows(&app);
    let hit = window_at(&wins, window.label(), x, y);
    hover_move(&app, hit.as_ref().map(|h| h.0.as_str()));
    let Some((label, cx, cy)) = hit else { return Ok(false) };
    let (Some(w), Some(rect)) = (app.get_webview_window(&label), wins.iter().find(|r| r.0 == label)) else { return Ok(false) };
    let _ = w.set_focus();
    let mut at = at_payload(cx, cy, rect);
    at["team"] = json!(team);
    at["ids"] = json!(ids);
    at["from"] = json!(window.label());
    w.eval(format!("window.__dragInTeam && window.__dragInTeam({at})")).map_err(|e| e.to_string())?;
    Ok(true)
}

/// 받는 창이 못 받은 팀 파일 놓기 — 보낸 창(to) 팀 보관함에 한 줄(TeamLocker 가 note 로 받는다)
#[tauri::command]
pub fn drag_back(app: tauri::AppHandle, window: tauri::WebviewWindow, to: String, team: String, text: String) -> Result<(), String> {
    use tauri::Manager;
    ui_only(&window)?;
    if !ui_window(&to) || !team_drag_ok(&team, &["x".into()]) {
        return Err("bad target".into());
    }
    let Some(w) = app.get_webview_window(&to) else { return Ok(()) };
    let detail = json!({ "team": team, "ids": [], "note": back_note(&text) });
    w.eval(format!("window.dispatchEvent(new CustomEvent('team-locker-out', {{ detail: {detail} }}))")).map_err(|e| e.to_string())
}

/// 팀 id·파일 id 모양 — 글자·숫자·-_:. 와 한글(폴더 키 dir:견적), 줄바꿈·따옴표 없이 200자까지, 한 번에 1~50개
pub(crate) fn team_drag_ok(team: &str, ids: &[String]) -> bool {
    let ok = |s: &str| !s.is_empty() && s.chars().count() <= 200 && s.chars().all(|c| c.is_alphanumeric() || "-_:./ ".contains(c));
    ok(team) && !ids.is_empty() && ids.len() <= 50 && ids.iter().all(|i| ok(i))
}

/// 돌려보내는 한 줄 — 한 줄로, 200자까지
pub(crate) fn back_note(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(200).collect()
}

/// 끄는 동안 창 밖에 있는 커서(x, y: 화면 논리 좌표, 둘 다 없으면 끝) — 그 자리 다른 앱 창에 지나감(__dragHover)을 알려
/// 같은 창 끌기와 같은 점선·폴더 칩 빛을 띄운다. 놓기만 넘기고 지나감이 없어서 받는 창이 끝까지 조용했다(10-28 사용자). 그 자리 창이 있으면 true
#[tauri::command]
pub fn drag_hover(app: tauri::AppHandle, window: tauri::WebviewWindow, label: String, x: Option<f64>, y: Option<f64>, team: Option<bool>) -> Result<bool, String> {
    use tauri::Manager;
    ui_only(&window)?;
    let wins = match (x, y) {
        (Some(x), Some(y)) if x.is_finite() && y.is_finite() => ui_windows(&app),
        _ => vec![],
    };
    let hit = window_at(&wins, window.label(), x.unwrap_or(0.0), y.unwrap_or(0.0));
    hover_move(&app, hit.as_ref().map(|h| h.0.as_str()));
    let Some((to, cx, cy)) = hit else { return Ok(false) };
    let (Some(w), Some(rect)) = (app.get_webview_window(&to), wins.iter().find(|r| r.0 == to)) else { return Ok(false) };
    let mut at = at_payload(cx, cy, rect);
    at["label"] = json!(hover_label(&label));
    if team == Some(true) {
        at["team"] = json!(true); // 팀 파일 — 받는 창이 참모 자리만 빛낸다
    }
    w.eval(format!("window.__dragHover && window.__dragHover({at})")).map_err(|e| e.to_string())?;
    Ok(true)
}

/// 지금 지나감을 받고 있는 창 — 다른 창으로 옮기거나 빠지면 앞 창에 끝(__dragHover(null))을 알린다
static HOVER: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn hover_move(app: &tauri::AppHandle, now: Option<&str>) {
    use tauri::Manager;
    let prev = std::mem::replace(&mut *HOVER.lock().unwrap_or_else(|e| e.into_inner()), now.map(str::to_string));
    if let Some(w) = hover_leave(prev.as_deref(), now).and_then(|l| app.get_webview_window(&l)) {
        let _ = w.eval("window.__dragHover && window.__dragHover(null)");
    }
}

/// 앞에 지나감을 받던 창이 이제 아니면 그 창 이름
pub(crate) fn hover_leave(prev: Option<&str>, now: Option<&str>) -> Option<String> {
    prev.filter(|p| now != Some(*p)).map(str::to_string)
}

/// 지나감 이름표 — 한 줄, 80자까지(받는 창 표에 그대로 쓴다)
pub(crate) fn hover_label(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect()
}

/// 받는 창에 넘길 자리 — 창 틀 기준 (x, y) 와 틀 크기. 받는 창이 자기 안 크기와 견줘 제목줄·테두리를 뺀다(dragPath frameToClient).
/// macOS 26 은 inner_position 이 제목줄을 포함한 틀 자리라 그대로 쓰면 제목줄만큼 아래로 읽었다(10-28 아이맥 실측)
pub(crate) fn at_payload(cx: f64, cy: f64, rect: &(String, f64, f64, f64, f64)) -> Value {
    json!({ "x": cx, "y": cy, "fw": rect.3, "fh": rect.4 })
}

/// 보이는 앱 창(메인·메신저 따로 창)의 (이름, 틀 x, y, 폭, 높이) — 화면 논리 좌표. 틀(outer) 기준이어야 OS 판마다 '안' 의 뜻이 달라도 같다
fn ui_windows(app: &tauri::AppHandle) -> Vec<(String, f64, f64, f64, f64)> {
    use tauri::Manager;
    app.webview_windows()
        .into_iter()
        .filter(|(l, w)| ui_window(l) && w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .filter_map(|(l, w)| {
            let s = w.scale_factor().ok()?;
            let p = w.outer_position().ok()?;
            let z = w.outer_size().ok()?;
            let (x, y, wd, ht) = logical_rect((p.x, p.y), (z.width as i32, z.height as i32), s);
            Some((l, x, y, wd, ht))
        })
        .collect()
}

/// 창 물리 자리·크기를 그 창 배율로 나눈 논리 좌표(JS screenX 와 같은 단위) — 모니터마다 배율이 달라도 창마다 자기 배율로 나눈다
pub(crate) fn logical_rect(pos: (i32, i32), size: (i32, i32), scale: f64) -> (f64, f64, f64, f64) {
    let s = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    (pos.0 as f64 / s, pos.1 as f64 / s, size.0 as f64 / s, size.1 as f64 / s)
}

pub(crate) fn drag_paths_ok(paths: &[String]) -> bool {
    !paths.is_empty() && paths.len() <= 50 && paths.iter().all(|p| Path::new(p).is_absolute())
}

/// (창 이름, 틀 x, y, 폭, 높이) 중 보낸 창이 아닌 것 가운데 그 자리를 품은 첫 창과 그 창 틀 기준 좌표
pub(crate) fn window_at(wins: &[(String, f64, f64, f64, f64)], from: &str, x: f64, y: f64) -> Option<(String, f64, f64)> {
    wins.iter().find(|(l, wx, wy, w, h)| l != from && x >= *wx && y >= *wy && x < wx + w && y < wy + h).map(|(l, wx, wy, _, _)| (l.clone(), x - wx, y - wy))
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

/// 넘길 내 참모 이름 — 세션 목록에서 id 의 이름을 사람에게 보일 이름으로(별명, 없으면 번호 뺀 기본 이름 — orch_roles::shown_name)
pub fn handoff_name(sessions_json: &str, id: &str) -> String {
    let v: Value = serde_json::from_str(sessions_json).unwrap_or(Value::Null);
    let name = v.as_array().and_then(|a| a.iter().find(|x| x["id"] == id)).and_then(|x| x["name"].as_str()).unwrap_or("").to_string();
    if name.is_empty() { name } else { crate::orch_roles::shown_name(&name) }
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
