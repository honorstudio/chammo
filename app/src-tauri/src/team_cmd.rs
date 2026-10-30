//! scripts/team — 참모가 팀 메신저를 쓴다(만들기·초대·들어오기·멤버·말 보내기·받은 말 읽기).
//! HQ 스크립트는 app.jsonl 에 {action:"team", id, arg} 한 줄을 쓰고, 앱이 대신 해서 <데이터>/team.txt 에 답한다(scripts/peer 와 같은 길).
//! 이 길로 보내는 말은 늘 origin agent — 사람 말(human)은 메인 창 명령 team_human_say 만(HumanProof)
use crate::accounts_store::Store;
use crate::team_relay::{self as relay, Http};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

pub struct TeamReq {
    pub id: String,
    pub verb: String,
    pub arg: Value,
}

pub fn request(line: &str) -> Option<TeamReq> {
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("action")?.as_str()? != "team" {
        return None;
    }
    let id = v.get("id")?.as_str()?;
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    let verb = v["arg"]["verb"].as_str()?;
    // use·leave·kick·role 은 answer 에 있었는데 여기 빠져 앱이 버렸다(QA 5). leave·kick·role 은 answer 가 --yes(사용자 말) 없이는 안 한다
    matches!(verb, "status" | "create" | "invite" | "join" | "members" | "use" | "leave" | "kick" | "role" | "say" | "inbox" | "deliver-to" | "forget" | "logout" | "login" | "devices" | "device-rename" | "device-remove" | "self-say" | "rooms" | "room-new" | "room-set" | "room-leave" | "room-say" | "room-read" | "locker-ls" | "locker-put" | "locker-get" | "locker-rm").then(|| TeamReq { id: id.into(), verb: verb.into(), arg: v["arg"].clone() })
}

/// 망·소켓 — 시험에선 가짜
pub trait Wire {
    fn http(&self) -> &dyn Http;
    /// 연결 스레드에 보내기 — 이 길은 사람 표가 없다(늘 agent). by = 보낸 참모 별명(봉투 안, 비면 칸 없음)
    fn send_agent(&self, dir: &Path, room: &str, cid: &str, body: &str, by: &str) -> Result<u64, String>;
    /// 팀이 생기면 연결을 띄운다
    fn started(&self, dir: &Path);
    /// 이 기기에서 팀을 잊으면 연결을 끈다
    fn stopped(&self);
    /// 로그인 때 여는 시스템 브라우저
    fn opener(&self) -> &dyn crate::team_account::Opener;
}

/// scripts/team 이 비밀(말 본문·초대 코드)을 넘기는 자리 — <데이터>/team-in/<id>.json(600). app.jsonl 엔 id 만 남는다
pub const HANDOFF_DIR: &str = "team-in";

/// arg.in 이 있으면 건네기 파일을 읽어 arg 에 합치고 지운다. 이름은 영문·숫자만(폴더 밖으로 못 나가게)
fn with_handoff(dir: &Path, arg: &Value) -> Result<Value, String> {
    // 앱이 꺼져 있어 아무도 안 읽은 옛 건네기 파일은 한 시간 뒤 치운다
    if let Ok(rd) = std::fs::read_dir(dir.join(HANDOFF_DIR)) {
        for e in rd.flatten() {
            if e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|a| a.as_secs() > 3600) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let Some(id) = arg.get("in").and_then(Value::as_str) else { return Ok(arg.clone()) };
    if id.is_empty() || id.len() > 40 || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err("bad handoff id".into());
    }
    let f = dir.join(HANDOFF_DIR).join(format!("{id}.json"));
    let text = std::fs::read_to_string(&f).map_err(|_| "건네기 파일이 없어(이미 읽었거나 지워짐)".to_string())?;
    let _ = std::fs::remove_file(&f);
    let extra: Value = serde_json::from_str(&text).map_err(|_| "건네기 파일이 JSON 이 아니야".to_string())?;
    let mut out = arg.clone();
    for k in ["text", "code"] {
        if let Some(v) = extra.get(k).and_then(Value::as_str) {
            out[k] = json!(v);
        }
    }
    Ok(out)
}

fn fail(e: impl Into<String>) -> Value {
    json!({ "ok": false, "error": e.into() })
}

/// 글 목록 칸 — 배열이나 쉼표로 나눈 글
fn list(v: &Value) -> Vec<String> {
    match v {
        Value::Array(a) => a.iter().filter_map(Value::as_str).map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect(),
        Value::String(x) => x.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect(),
        _ => Vec::new(),
    }
}

fn cid_ok(c: &str) -> bool {
    !c.is_empty() && c.len() <= 64 && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// 내 기기 하나 — id 그대로나 이름(하나만 맞을 때)
fn my_device(dir: &Path, key: &str) -> Result<String, String> {
    let st = relay::load_state(dir);
    if st.account.is_none() {
        return Err("로그인 전이야".into());
    }
    if let Some(d) = st.my_devices.iter().find(|d| d.id == key) {
        return Ok(d.id.clone());
    }
    let hits: Vec<&relay::DeviceName> = st.my_devices.iter().filter(|d| d.name == key).collect();
    match hits.as_slice() {
        [d] => Ok(d.id.clone()),
        [] => Err(format!("그런 기기가 없어 — scripts/team devices 로 이름·id 를 봐")),
        _ => Err("같은 이름 기기가 여럿이야 — id 로".into()),
    }
}

/// 사람 이름 더하기(scripts/team) — 프로필 이름(팀마다 봉해 둔 보관함 목록에서, 망 안 씀)과 받은 말 이름표.
/// 참모가 사용자가 부르는 프로필 이름을 몰랐고, 팀에서 나간 사람과의 옛 DM 은 명부에 없어 '?' 였다(10-28 아이맥 참모)
#[derive(Default)]
pub(crate) struct Aka {
    /// 멤버 id → 프로필 이름
    pub profile: BTreeMap<String, String>,
    /// 멤버 id → 그 사람이 보낸 마지막 말의 이름표(명부에 없는 사람만 쓴다)
    pub seen: BTreeMap<String, String>,
}

impl Aka {
    pub(crate) fn load(dir: &Path, kc: &dyn Store, st: &relay::TeamState) -> Aka {
        Aka { profile: st.teams.iter().flat_map(|t| crate::team_profile::cached_names(dir, kc, &t.id)).collect(), seen: seen_names(dir) }
    }
    fn label(&self, account: &str, member: &str) -> String {
        use crate::team_relay_inbox::safe_name as clean;
        relay::label(&clean(account), self.profile.get(member).map(|p| clean(p)).as_deref())
    }
}

/// 받은 말 기록에서 멤버 id → 마지막 이름표(내가 보낸 줄·내 기기끼리 말은 빼고)
pub(crate) fn seen_names(dir: &Path) -> BTreeMap<String, String> {
    let text = std::fs::read_to_string(dir.join(crate::team_relay_inbox::INBOX_FILE)).unwrap_or_default();
    text.lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| !matches!(v["note"].as_str(), Some("sent" | "mine")) && v["kind"] != "self")
        .filter_map(|v| Some((v["member"].as_str()?.to_string(), v["person"].as_str()?.trim().to_string())))
        .filter(|(m, p)| !m.is_empty() && !p.is_empty())
        .collect()
}

/// 화면·폰에 나가는 상태 — 서버가 준 이름(팀·사람·기기)은 남의 글이라 받은 말 이름표와 같은 거름(제어 글자·[ ] < > 빼기, 이름표 흉내는 ?).
/// 이 이름들이 넘기기 이름표·참모 입력칸까지 간다(보안 검토 10-23: 팀 이름의 \r 이 참모 입력칸에서 Enter 가 됐다)
pub(crate) fn view(st: &relay::TeamState) -> Value {
    view_with(st, &Aka::default())
}

/// view + 사람 이름표(label: '프로필 이름(계정 이름)')·DM 상대 이름(with — 명부에 없으면 받은 말 이름표, left) — scripts/team 이 보여 준다.
/// name 은 계정 이름 그대로(화면이 쓴다)
pub(crate) fn view_with(st: &relay::TeamState, aka: &Aka) -> Value {
    use crate::team_relay_inbox::safe_name as clean;
    let opt = |s: &str| if s.trim().is_empty() { String::new() } else { clean(s) };
    let dm_with = |peer: &str| match st.member_name(peer) {
        Some(n) => (aka.label(n, peer), false),
        None => (aka.seen.get(peer).map(|n| clean(n)).unwrap_or_else(|| "?".into()), true),
    };
    json!({
        "joined": st.joined(), "team": opt(&st.team_name), "teamId": st.team_id, "me": opt(&st.display_name), "device": opt(&st.device_name), "role": st.role,
        "server": st.server, "deliverTo": st.deliver_to,
        "account": st.account.as_ref().map(|a| json!({ "email": a.email, "name": opt(&a.name) })),
        "devices": st.my_devices.iter().map(|d| json!({ "id": d.id, "name": clean(&d.name), "current": d.current, "kind": d.kind, "status": d.status, "lastSeen": d.last_seen, "reqCity": opt(&d.req_city), "reqCountry": opt(&d.req_country), "pendingSince": d.pending_since, "approvedBy": d.approved_by })).collect::<Vec<_>>(),
        "pending": st.pending, "pendingAutoAt": st.pending_auto_at, "revoked": st.revoked,
        "teams": st.teams.iter().map(|t| json!({ "id": t.id, "name": opt(&t.name), "role": t.role, "me": opt(&t.display_name), "current": t.id == st.team_id })).collect::<Vec<_>>(),
        "members": st.members.iter().map(|m| json!({ "id": m.id, "name": clean(&m.display_name), "label": aka.label(&m.display_name, &m.id), "role": m.role, "perms": m.perms, "me": m.id == st.member_id, "devices": m.devices.iter().map(|d| json!({ "id": d.id, "name": clean(&d.name) })).collect::<Vec<_>>() })).collect::<Vec<_>>(),
        "rooms": st.rooms.iter().map(|r| {
            let (with, left) = match r.kind.as_str() { "self" => ("self".to_string(), false), "group" => (clean(&r.name), false), _ => dm_with(&r.peer) };
            json!({ "id": r.id, "kind": r.kind, "peer": r.peer, "team": r.team, "with": with, "left": left, "members": r.members, "me": crate::team_reads::my_member(st, &r.id) })
        }).collect::<Vec<_>>(),
    })
}

/// 받은 말 끝 n 줄(남의 글 — 참모는 보여 주기만). 세션에 넘길 때와 같은 거름을 지난 글만 — 막은 말(forged)은 본문 없이,
/// 제어 글자(ESC 등)·채움 글자는 빼고 줄머리 [ < 엔 › (보안 검토 1-B)
pub fn inbox_tail(dir: &Path, n: usize) -> Vec<Value> {
    use crate::peer_link::{body_lines, clean_name, forged, MAX_SAY};
    let text = std::fs::read_to_string(dir.join(crate::team_relay_inbox::INBOX_FILE)).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    // 같은 (방, seq) 가 다시 적혔으면(받아들인 뒤 다시 연 말 — e2e_retry) 처음 자리에 마지막 내용으로
    let mut rows: Vec<Value> = vec![];
    let mut at: std::collections::HashMap<(String, u64), usize> = Default::default();
    for v in lines[lines.len().saturating_sub(n)..].iter().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        let key = v["seq"].as_u64().filter(|_| v["note"] != "sent").map(|s| (v["room"].as_str().unwrap_or("").to_string(), s));
        match key.as_ref().and_then(|k| at.get(k).copied()) {
            Some(i) => rows[i] = v,
            None => {
                if let Some(k) = key {
                    at.insert(k, rows.len());
                }
                rows.push(v);
            }
        }
    }
    rows.into_iter()
        .map(|mut v| {
            let raw = v["body"].as_str().unwrap_or("").to_string();
            let blocked = v["note"] == "forged" || forged(&raw);
            let body = if blocked { String::new() } else { body_lines(&raw.chars().take(MAX_SAY).collect::<String>()).map(|l| l.join("\n")).unwrap_or_default() };
            v["body"] = json!(body);
            if blocked {
                v["note"] = json!("forged");
            }
            v["person"] = json!(clean_name(v["person"].as_str().unwrap_or("")));
            v["deviceName"] = json!(clean_name(v["deviceName"].as_str().unwrap_or("")));
            v
        })
        .collect()
}

pub fn answer(req: &TeamReq, dir: &Path, kc: &dyn Store, w: &dyn Wire) -> Value {
    let arg = match with_handoff(dir, &req.arg) {
        Ok(a) => a,
        Err(e) => return fail(e),
    };
    let s = |k: &str| arg[k].as_str().unwrap_or("").trim().to_string();
    // 참모가 보는 사람 이름 — 프로필 이름(계정 이름), 나간 사람과의 DM 은 받은 말 이름표
    let shown = |st: &relay::TeamState| view_with(st, &Aka::load(dir, kc, st));
    // 보낸 참모 별명 — scripts/team 이 넘긴 세션 id(CLAUDE_CODE_SESSION_ID)로 앱이 찾는다(스크립트가 적은 이름은 안 믿는다)
    let by = if matches!(req.verb.as_str(), "say" | "room-say" | "self-say") && !s("session").is_empty() {
        let hq = crate::config::hq_dir(&crate::config::home(), &crate::config::current(), |k| std::env::var(k).ok());
        crate::claude::agents_json().map(|j| sender_label(&j, &hq, &s("session"))).unwrap_or_default()
    } else {
        String::new()
    };
    let r = match req.verb.as_str() {
        "status" => Ok(shown(&relay::load_state(dir))),
        "create" => relay::create(dir, kc, w.http(), &s("server"), &s("team"), &s("me"), &s("device")).map(|st| {
            // 만들자마자 멤버(나) — 안 받으면 다음 이름 받기(5분)까지 화면 목록이 비었다(10-23 실측)
            let st = relay::refresh_members(dir, kc, w.http(), "").unwrap_or(st);
            w.started(dir);
            shown(&st)
        }),
        "join" => relay::join(dir, kc, w.http(), &s("server"), &s("code"), &s("me"), &s("device")).map(|st| {
            // 들어오자마자 누가 있는지 — 실패해도 들어온 건 들어온 것
            let st = relay::refresh_members(dir, kc, w.http(), "").unwrap_or(st);
            w.started(dir);
            shown(&st)
        }),
        // team = 팀 이름·id(비면 지금 팀) — 팀이 여럿일 때만 필요하다
        "invite" => relay::invite(dir, kc, w.http(), &s("team")).map(|i| json!({ "code": i.code, "expiresAt": i.expires_at, "link": i.link })),
        "members" => relay::refresh_members(dir, kc, w.http(), &s("team")).map(|st| shown(&st)),
        "use" => relay::use_team(dir, &s("team")).map(|st| shown(&st)),
        // 나가기·빼기·팀장 바꾸기는 사용자 말이 있을 때만(--yes, 안내문) — 되돌리려면 새 초대·다른 팀장이 필요하다
        "leave" | "kick" | "role" if arg["yes"] != true => Err("나가기·빼기·팀장 바꾸기는 사용자에게 먼저 묻고 --yes 로".into()),
        "leave" => relay::leave(dir, kc, w.http(), &s("team")).map(|st| shown(&st)),
        "kick" => relay::remove_member(dir, kc, w.http(), &s("team"), &s("who")).map(|st| shown(&st)),
        // 팀장 넘기기·권한 올리기는 앱 화면의 사람 입력에서만(relay ADR 0014 P8 — 참모 말은 사람 말이 아니다). 참모 길은 팀원으로 내리기만
        "role" => {
            if s("role") == "owner" {
                Err("팀장 넘기기는 앱 팀 설정 화면에서만 해요".into())
            } else {
                relay::set_role(dir, kc, w.http(), &s("team"), &s("who"), &s("role")).map(|st| shown(&st))
            }
        }
        "say" => {
            let (to, text, cid) = (s("to"), arg["text"].as_str().unwrap_or("").to_string(), s("cid"));
            if !cid_ok(&cid) {
                return fail("bad cid");
            }
            if text.trim().is_empty() {
                return fail("빈 말");
            }
            relay::open_dm(dir, kc, w.http(), &s("team"), &to).and_then(|room| {
                w.started(dir);
                w.send_agent(dir, &room.id, &cid, &text, &by).map(|seq| json!({ "room": room.id, "seq": seq, "cid": cid }))
            })
        }
        // 구글 로그인 — 사람 브라우저가 열리고 그 사람이 마칠 때까지(최대 10분) 기다린다
        "login" => crate::team_account::login_with(dir, kc, w.http(), w.opener(), &s("server"), &s("device"), crate::team_account::LOGIN_WAIT).map(|st| {
            w.started(dir);
            shown(&st)
        }),
        "devices" => crate::team_account::refresh_me(dir, kc, w.http()).map(|st| shown(&st)),
        // 내 기기 이름 바꾸기·빼기 — 사용자가 말했을 때만(안내문). 이 기기 빼기는 logout 으로, 새 기기 허용은 사람이 앱에서만(ADR 0014)
        "device-rename" => my_device(dir, &s("device")).and_then(|id| crate::team_account::rename_device(dir, kc, w.http(), &id, &s("name"))).map(|st| shown(&st)),
        "device-remove" if arg["yes"] != true => Err("기기 빼기는 사용자에게 먼저 묻고 --yes 로".into()),
        "device-remove" => match my_device(dir, &s("device")) {
            Ok(id) if id == relay::load_state(dir).device_id => Err("이 기기는 scripts/team logout --yes 로(사용자가 말했을 때만)".into()),
            // 허용 대기 기기를 빼는 건 '거절'이다 — 사람만 카드에서(ADR 0014, 리뷰 2)
            Ok(id) if relay::load_state(dir).my_devices.iter().any(|d| d.id == id && d.pending()) => Err("허용 대기 기기는 사람이 카드에서 허용·거절해 — 여기선 못 빼".into()),
            Ok(id) => crate::team_account::revoke_device_agent(dir, kc, w.http(), &id).map(|st| shown(&st)),
            Err(e) => Err(e),
        },
        "self-say" => {
            let (text, cid) = (arg["text"].as_str().unwrap_or("").to_string(), s("cid"));
            if !cid_ok(&cid) {
                return fail("bad cid");
            }
            if text.trim().is_empty() {
                return fail("빈 말");
            }
            relay::self_room(dir, kc, w.http()).and_then(|room| {
                w.started(dir);
                w.send_agent(dir, &room, &cid, &text, &by).map(|seq| json!({ "room": room, "seq": seq, "cid": cid }))
            })
        }
        // 팀 보관함(chammo-relay ADR 0009) — 참모 길은 보기·올리기·받기·휴지통까지. 영구 지우기는 사람이 화면 확인 창에서만
        "locker-ls" => crate::team_locker_app::list(dir, kc, w.http(), &s("team")).map(|v| json!(v)),
        "locker-put" => {
            let paths: Vec<std::path::PathBuf> = arg["paths"].as_array().map(|a| a.iter().filter_map(|p| p.as_str()).map(std::path::PathBuf::from).filter(|p| p.is_absolute()).collect()).unwrap_or_default();
            if paths.is_empty() || paths.len() > 50 {
                return fail("파일은 한 번에 1~50개");
            }
            // 사람이 시킨 올리기·받기는 사람 몫으로(relay::as_human) — 배경 몫이 차거나 쉬는 중이면 큰 파일이 조각 중간에 끊겼다(0.4.5 리뷰 2). 보기·휴지통은 배경 그대로
            relay::as_human(|| paths.iter().map(|p| crate::team_locker_app::put_file_in(dir, kc, w.http(), &s("team"), "", "file", &s("folder"), p)).collect::<Result<Vec<_>, _>>().map(|f| json!({ "files": f })))
        }
        "locker-get" => relay::as_human(|| {
            crate::team_locker_app::list(dir, kc, w.http(), &s("team")).and_then(|v| crate::team_locker_app::resolve(&v, &s("file"))).and_then(|id| {
                let to = s("to");
                let t = std::time::Instant::now(); // 받기만 잰 ms — 목록에서 연 파일은 다시 안 받아 짧다(10-26)
                let p = if to.is_empty() { crate::team_locker_app::fetch(dir, kc, w.http(), &s("team"), &id) } else { crate::team_locker_app::fetch_to(dir, kc, w.http(), &s("team"), &id, Path::new(&to)) }?;
                Ok(json!({ "path": p, "ms": t.elapsed().as_millis() as u64 }))
            })
        }),
        "locker-rm" => crate::team_locker_app::list(dir, kc, w.http(), &s("team"))
            .and_then(|v| crate::team_locker_app::resolve(&v, &s("file")))
            .and_then(|id| crate::team_locker_app::act(dir, kc, w.http(), &s("team"), &id, "trash").map(|_| json!({ "trashed": id }))),
        // 단톡방(chammo-relay team-rooms) — 사람은 이름이나 멤버 id(그 팀 안), 방은 이름이나 방 id
        "rooms" => relay::sync_rooms(dir, kc, w.http()).map(|st| crate::team_rooms::view(&st, &Aka::load(dir, kc, &st).profile)),
        "room-new" => crate::team_rooms::create_room(dir, kc, w.http(), &s("team"), &s("name"), &list(&arg["with"])).map(|r| {
            w.started(dir);
            json!({ "room": r.id, "name": r.name })
        }),
        "room-set" => {
            let name = arg["name"].as_str().map(str::trim).filter(|n| !n.is_empty());
            crate::team_rooms::update_room(dir, kc, w.http(), &s("room"), name, &list(&arg["add"]), &list(&arg["remove"])).map(|st| crate::team_rooms::view(&st, &Aka::load(dir, kc, &st).profile))
        }
        "room-leave" if arg["yes"] != true => Err("팀챗 나가기는 사용자에게 먼저 묻고 --yes 로".into()),
        "room-leave" => crate::team_rooms::leave_room(dir, kc, w.http(), &s("room")).map(|st| crate::team_rooms::view(&st, &Aka::load(dir, kc, &st).profile)),
        "room-say" => {
            let (text, cid) = (arg["text"].as_str().unwrap_or("").to_string(), s("cid"));
            if !cid_ok(&cid) {
                return fail("bad cid");
            }
            if text.trim().is_empty() {
                return fail("빈 말");
            }
            let st = relay::load_state(dir);
            crate::team_rooms::find_room(&st, &s("room")).map(|r| r.id.clone()).and_then(|room| {
                w.started(dir);
                w.send_agent(dir, &room, &cid, &text, &by).map(|seq| json!({ "room": room, "seq": seq, "cid": cid }))
            })
        }
        "room-read" => {
            let st = relay::load_state(dir);
            crate::team_rooms::find_room(&st, &s("room")).map(|r| r.id.clone()).map(|room| {
                let n = arg["n"].as_u64().unwrap_or(20).min(200) as usize;
                let mut items: Vec<Value> = inbox_tail(dir, 2000).into_iter().filter(|v| v["room"] == room.as_str()).collect();
                let cut = items.len().saturating_sub(n);
                json!({ "room": room, "items": items.split_off(cut) })
            })
        }
        "inbox" => Ok(json!({ "items": inbox_tail(dir, arg["n"].as_u64().unwrap_or(20).min(200) as usize) })),
        "deliver-to" => relay::mutate(dir, |st| st.deliver_to = s("name")).map(|st| shown(&st)),
        // 이 기기 로그아웃 — 사용자가 말했을 때만 --yes(안내문). 허용 대기·확인 중·기기 목록 403 이어도 된다(10-26 사용자 "로그아웃도 없고").
        // 참모 길이라 사슬 고리는 안 쓴다(R6) — 서버 끊기만, 남들은 끊긴 기기를 목록에서 뺀다
        "logout" if arg["yes"] != true => Err("로그아웃은 사용자에게 먼저 묻고 --yes 로".into()),
        // 사슬에 든 기기는 사람만 — 프롬프트 주입으로 마지막 사슬 기기를 빼면 걸려 있던 탈취자 대기 기기가 허용된다(10-26 공격 리뷰, R6)
        "logout" if crate::e2e_team::in_chain(dir, &relay::load_state(dir)) => Err("이 기기는 내 기기 사슬에 든 기기라 사람이 설정 > 계정에서 로그아웃해야 해".into()),
        "logout" => {
            w.stopped();
            crate::team_account::logout_with(dir, kc, w.http(), false).map(|_| json!({ "loggedOut": true }))
        }
        // 이 기기에서만 잊는다(서버의 팀·기기 행은 그대로 — 시험 정리는 서버 쪽 스크립트로)
        "forget" => {
            w.stopped();
            relay::forget_local(dir, kc).map(|t| json!({ "forgot": t }))
        }
        _ => Err("unknown verb".into()),
    };
    match r {
        Ok(mut v) => {
            v["ok"] = json!(true);
            v
        }
        Err(e) => fail(e),
    }
}

/// 보낸 참모 별명 — 세션 id(앞 8자)가 HQ 참모면 '참모 · 회사 비서' 의 뒤(없으면 이름), 아니면 빈 글.
/// 봉투 확인(Extra::check)이 BY_MAX 글자 넘으면 말을 통째로 거절해서 여기서 자른다
pub fn sender_label(sessions_json: &str, hq: &str, session: &str) -> String {
    let id: String = session.chars().take(8).collect();
    if id.len() < 8 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return String::new();
    }
    crate::peer_link::target(sessions_json, hq, &id).map(|id| crate::team_ui::handoff_name(sessions_json, &id).chars().take(crate::e2e_envelope::BY_MAX).collect()).unwrap_or_default()
}

/// 실제 curl·연결 스레드
pub struct RealWire;

impl Wire for RealWire {
    fn http(&self) -> &dyn Http {
        &relay::Curl
    }
    fn send_agent(&self, dir: &Path, room: &str, cid: &str, body: &str, by: &str) -> Result<u64, String> {
        crate::team_relay_ws::send_with(dir, room, cid, body, None, crate::e2e_envelope::Extra { by: by.into(), ..Default::default() })
    }
    fn started(&self, dir: &Path) {
        crate::team_relay_ws::ensure(dir);
    }
    fn stopped(&self) {
        crate::team_relay_ws::stop();
    }
    fn opener(&self) -> &dyn crate::team_account::Opener {
        &crate::team_account::SystemBrowser
    }
}

// ── 메인 창 명령 ─────────────────────────────────────────────

/// 팀 상태(화면용) — 메인 창만
#[tauri::command]
pub fn team_status(window: tauri::WebviewWindow) -> Result<Value, String> {
    main_only(&window)?;
    Ok(view(&relay::load_state(crate::config::data_dir())))
}

fn main_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if w.label() == "main" { Ok(()) } else { Err("main window only".into()) }
}

/// 계정 일(사람이 누른 것)을 뒤 스레드에서 — 실제 키체인·curl, 끝나면 화면용 상태
async fn account_job(f: impl FnOnce(&Path, &dyn Store, &dyn Http) -> Result<(), String> + Send + 'static) -> Result<Value, String> {
    relay::human_job(move |dir, kc, h| {
        f(dir, kc, h)?;
        Ok(view(&relay::load_state(dir)))
    })
    .await
}

/// 설정 > Chammo 계정: 구글 로그인(사람 브라우저, 최대 10분). server 는 처음 기기만(팀·로그인한 적 있으면 그 서버)
#[tauri::command]
pub async fn team_login(window: tauri::WebviewWindow, server: String, device: String) -> Result<Value, String> {
    main_only(&window)?;
    let device = if device.trim().is_empty() { crate::team_account::default_device_name() } else { device };
    account_job(move |d, kc, h| {
        crate::team_account::login_with(d, kc, h, &crate::team_account::SystemBrowser, &server, &device, crate::team_account::LOGIN_WAIT)?;
        crate::team_relay_ws::ensure(d);
        Ok(())
    })
    .await
}

/// 서버에서 계정·내 기기 다시 받기
#[tauri::command]
pub async fn team_account_refresh(window: tauri::WebviewWindow) -> Result<Value, String> {
    main_only(&window)?;
    account_job(|d, kc, h| crate::team_account::refresh_me(d, kc, h).map(|_| ())).await
}

#[tauri::command]
pub async fn team_device_rename(window: tauri::WebviewWindow, id: String, name: String) -> Result<Value, String> {
    main_only(&window)?;
    account_job(move |d, kc, h| crate::team_account::rename_device(d, kc, h, &id, &name).map(|_| ())).await
}

#[tauri::command]
pub async fn team_device_revoke(window: tauri::WebviewWindow, id: String) -> Result<Value, String> {
    main_only(&window)?;
    account_job(move |d, kc, h| crate::team_account::revoke_device(d, kc, h, &id).map(|_| ())).await
}

#[tauri::command]
pub async fn team_logout(window: tauri::WebviewWindow) -> Result<Value, String> {
    main_only(&window)?;
    account_job(|d, kc, h| crate::team_account::logout(d, kc, h)).await
}

/// 이 컴퓨터의 Chammo 데이터 폴더별 로그인 계정(기기 관리 '이 컴퓨터의 다른 Chammo') — 홈 폴더를 읽어서 뒤 일꾼에서
#[tauri::command]
pub async fn chammo_here() -> Result<Vec<crate::chammo_here::HereAccount>, String> {
    tauri::async_runtime::spawn_blocking(crate::chammo_here::here).await.map_err(|e| e.to_string())
}

/// 계정 지우기 — confirm 은 사람이 친 계정 이메일 그대로
#[tauri::command]
pub async fn team_account_delete(window: tauri::WebviewWindow, confirm: String) -> Result<Value, String> {
    main_only(&window)?;
    account_job(move |d, kc, h| crate::team_account::delete_account(d, kc, h, &confirm)).await
}

/// 사람이 메인 창 입력칸에서 팀 사람에게 친 말 — 받는 쪽엔 '팀 사람 말'로 간다.
/// 프런트는 진짜(isTrusted) 키·클릭 뒤 1.5초 안에서만 부른다(remoteChat sendAllowed 와 같은 문). 메신저 따로 창(team-*)도 같은 문
/// room 을 주면 그 방(단톡방·아는 DM 방, chammo-relay team-rooms)에, 없으면 to 사람과의 DM 에
#[tauri::command]
/// react·files = 반응 달기·떼기, 팀 보관함에 올린 파일 참조(chammo-relay team-rooms v2) — 사람이 누른 것이라 같은 사람 문
#[allow(clippy::too_many_arguments)]
pub async fn team_human_say(window: tauri::WebviewWindow, to: String, text: String, cid: String, room: Option<String>, react: Option<crate::e2e_envelope::React>, files: Option<Vec<Value>>, re: Option<u64>) -> Result<Value, String> {
    let proof = crate::team_relay_ws::HumanProof::ui_window(&window)?;
    // re = 이어 묻기(이은 팀 참모 답 seq, ADR 0017)
    let extra = crate::e2e_envelope::Extra { react, files: files.unwrap_or_default(), re: re.unwrap_or(0), ..Default::default() };
    extra.check()?;
    let empty = text.trim().is_empty() && extra.react.is_none() && extra.files.is_empty();
    if !cid_ok(&cid) || empty {
        return Err("bad cid or empty".into());
    }
    // 처음 DM(방 열기)도 사람이 친 말의 일부 — 배경 몫에 안 막힌다
    relay::human_job(move |dir, kc, h| {
        let room = match room.filter(|r| !r.is_empty()) {
            Some(r) if relay::load_state(dir).rooms.iter().any(|x| x.id == r && x.kind != "self") => r,
            Some(_) => return Err("모르는 방".to_string()),
            None => relay::open_dm(dir, kc, h, "", &to)?.id,
        };
        crate::team_relay_ws::send_with(dir, &room, &cid, &text, Some(proof), extra).map(|seq| json!({ "room": room, "seq": seq }))
    })
    .await
}

#[cfg(test)]
#[path = "team_cmd_tests.rs"]
mod tests;
