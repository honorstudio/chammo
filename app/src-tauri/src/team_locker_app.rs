//! 팀 보관함·대화 파일을 이 기기에서 쓰는 길 — team_locker(암호·흐름)에 진짜 중계(curl)·종단 암호 사람들(e2e_state)·보관함 폴더를 잇는다.
//! 화면 명령(team_locker_cmd)·scripts/team locker·채팅 붙이기(team-rooms)·프로필 사진(team-settings)이 이것만 부른다
use crate::accounts_store::Store;
use crate::team_locker::{self as core, FileRef, Me, Net, People, RemoteFile, Usage};
use crate::team_relay::{self as relay, Http, TeamState};
use crate::team_relay_keys::{new_nonce, DeviceKeys};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 진짜 중계 — JSON 은 team_relay::call, 조각은 curl 로 빈 본문 서명(ADR 0009 결정 7)
pub struct RelayNet<'a> {
    pub http: &'a dyn Http,
    pub server: String,
    pub device: String,
    pub keys: &'a DeviceKeys,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl RelayNet<'_> {
    /// 조각 요청 서명 — 빈 본문으로(ADR 0009 결정 7). (주소, 머리)
    fn signed(&self, method: &str, path: &str) -> Result<(String, Vec<(String, String)>), String> {
        let server = relay::server_ok(&self.server).ok_or("team.json 의 서버 주소가 https 가 아니야")?;
        if relay::slow_left(&self.keys.public(), std::time::Instant::now()).is_some() {
            return Err(relay::SLOW_DOWN.into());
        }
        // 조각 요청도 서버 nonce 칸을 쓴다 — 세기만(사람이 올리고 받는 파일이라 막지 않는다)
        let ts = now_ms();
        relay::spend(&self.keys.public(), ts, true);
        let s = self.keys.sign_request(method, path, b"", ts, &new_nonce()?);
        let h = vec![("X-Chammo-Ts".to_string(), s.ts), ("X-Chammo-Nonce".to_string(), s.nonce), ("X-Chammo-Sig".to_string(), s.sig), ("X-Chammo-Device".to_string(), self.device.clone())];
        Ok((format!("{server}{path}"), h))
    }

    /// curl 인자 — 머리는 600 임시 파일(서명이 ps 에 안 보이게), 조각은 5분까지
    fn curl_with(&self, url: &str, method: &str, h: &[(String, String)]) -> Result<(String, Vec<String>, PathBuf, String), String> {
        let url = url.to_string();
        let (prog, mut args, hfile) = relay::curl_call(&std::env::temp_dir(), method, &url, h, false)?;
        if let Some(i) = args.iter().position(|a| a == "--max-time") {
            args[i + 1] = "300".into();
        }
        args.pop(); // 주소는 뒤에 다시
        Ok((prog, args, hfile, url))
    }
}

struct Gone(PathBuf);
impl Drop for Gone {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn code_of(out: &std::process::Output) -> Result<u16, String> {
    let text = String::from_utf8_lossy(&out.stdout);
    match text.rsplit('\n').next().unwrap_or("").trim().parse::<u16>() {
        Ok(0) | Err(_) => Err(format!("중계 서버에 못 닿았어요: {}", String::from_utf8_lossy(&out.stderr).trim())),
        Ok(c) => Ok(c),
    }
}

// ── 목록 같이 쓰기(10-28 23:07~23:12 실측: 이 맥 앱이 GET /locker 를 4분 반에 579번 — 보관함·팀 홈·글·팀 참모·프로필판·폰이
//    저마다 목록을 망으로 받았다). 받은 목록을 20초 기억해 같이 쓴다 — 받은 뒤 소켓이 더 새 판을 알리면 바로 새로.
//    이 기기가 보관함을 바꾸면(GET 아닌 요청) 그 팀 기억을 버린다 ──

/// (받은 때, 목록, 받을 때 소켓이 알려 둔 판) — 알린 판보다 옛 목록이 와도(판이 안 맞는 채로) 그 알림 때문에 2초마다 다시 받지 않게
static LISTED: Mutex<BTreeMap<String, (std::time::Instant, core::Listing, u64)>> = Mutex::new(BTreeMap::new());
const LIST_QUIET: std::time::Duration = std::time::Duration::from_secs(20);

fn listing(dir: &Path, net: &RelayNet, team: &str, now: std::time::Instant) -> Result<core::Listing, String> {
    let key = format!("{}|{team}", dir.display());
    if let Some((at, l, knew)) = LISTED.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        let age = now.saturating_duration_since(*at);
        // 받은 뒤 새 알림이 왔으면 바로 새로(다른 화면이 바뀜을 놓치지 않게)
        if age < LIST_QUIET && told(team) <= l.rev.max(*knew) {
            return Ok(l.clone());
        }
    }
    let knew = told(team);
    let l = core::fetch_list(net, team)?;
    LISTED.lock().unwrap_or_else(|e| e.into_inner()).insert(key, (now, l.clone(), knew));
    Ok(l)
}

/// 이 기기가 그 팀 보관함을 바꿨다 — 다음 목록은 새로
fn forget_listing(path: &str) {
    let Some(team) = path.strip_prefix("/v0/teams/").and_then(|r| r.split('/').next()) else { return };
    let end = format!("|{team}");
    LISTED.lock().unwrap_or_else(|e| e.into_inner()).retain(|k, _| !k.ends_with(&end));
}

impl Net for RelayNet<'_> {
    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
        if method != "GET" {
            forget_listing(path);
        }
        relay::call(self.http, &self.server, self.keys, Some(&self.device), method, path, body)
    }

    fn put(&self, path: &str, bytes: &[u8]) -> Result<u16, String> {
        use std::io::Write;
        let began = std::time::Instant::now();
        let (url, h) = self.signed("PUT", path)?;
        if let Some(r) = relay::pooled_send("PUT", &url, &h, bytes, "application/octet-stream", std::time::Duration::from_secs(300)) {
            let (c, _) = r?;
            relay::trace("PUT", path, began, c, bytes.len());
            return Ok(c);
        }
        let (prog, mut args, hfile, url) = self.curl_with(&url, "PUT", &h)?;
        let _g = Gone(hfile);
        args.extend(["-H".into(), "Content-Type: application/octet-stream".into(), "--data-binary".into(), "@-".into(), "-o".into(), "/dev/null".into(), url]);
        let mut c = crate::platform::command(&prog);
        c.args(&args).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
        let mut child = c.spawn().map_err(|e| format!("curl 을 못 띄웠어요: {e}"))?;
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        // 큰 조각은 다른 스레드에서 밀어 넣는다 — curl 출력이 차서 서로 기다리지 않게
        let data = bytes.to_vec();
        let w = std::thread::spawn(move || stdin.write_all(&data));
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let _ = w.join();
        relay::trace("PUT", path, began, code_of(&out).unwrap_or(0), bytes.len());
        code_of(&out)
    }

    fn get(&self, path: &str) -> Result<(u16, Vec<u8>), String> {
        let began = std::time::Instant::now();
        let (url, h) = self.signed("GET", path)?;
        if let Some(r) = relay::pooled_send("GET", &url, &h, b"", "", std::time::Duration::from_secs(300)) {
            let (c, got) = r?;
            relay::trace("GET", path, began, c, got.len());
            return Ok((c, got));
        }
        let (prog, mut args, hfile, url) = self.curl_with(&url, "GET", &h)?;
        let _g = Gone(hfile);
        let tmp = std::env::temp_dir().join(format!("chammo-part-{}", crate::tools::tmp_tag()));
        let _t = Gone(tmp.clone());
        args.extend(["-o".into(), tmp.to_string_lossy().into_owned(), url]);
        let out = crate::platform::command(&prog).args(&args).output().map_err(|e| format!("curl 을 못 띄웠어요: {e}"))?;
        let c = code_of(&out)?;
        let got = std::fs::read(&tmp).unwrap_or_default();
        relay::trace("GET", path, began, c, got.len());
        Ok((c, got))
    }
}

/// 이 기기 열쇠·상태
fn ctx(dir: &Path, kc: &dyn Store) -> Result<(TeamState, DeviceKeys), String> {
    let st = relay::load_state(dir);
    if st.account.is_none() || !st.registered() {
        return Err("Chammo 계정에 로그인한 기기에서만 팀 보관함을 써요".into());
    }
    let k = relay::device_keys(kc, &st)?;
    Ok((st, k))
}

fn team_of(st: &TeamState, team: &str) -> Result<(String, String), String> {
    let t = st.team(team)?;
    Ok((t.id.clone(), t.name.clone()))
}

fn people(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, team: &str) -> Result<(People, Vec<String>), String> {
    let p = crate::e2e_state::locker_people(dir, kc, http, st, team)?;
    Ok((People { recipients: p.recipients, signers: p.signers, names: p.names }, p.skipped))
}

/// 올리는 중 — 화면이 진행 막대를 그린다(id = 서버에 줄이 생기기 전이라 로컬 번호)
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Upload {
    pub local: String,
    pub team: String,
    pub room: String,
    pub name: String,
    pub done: u64,
    pub total: u64,
    pub error: String,
    /// file 사람 파일 · profile·avatar·post 앱 안쪽 줄 — 화면엔 file 만(uploads)
    pub kind: String,
}

static UPLOADS: Mutex<Vec<Upload>> = Mutex::new(Vec::new());

/// 화면에 그릴 올리는 중 줄 — 사람이 올린 파일만(프로필·사진·팀 홈 글은 앱 안쪽 일이라 안 보인다, 10-28 'profile.json 112B' 카드)
pub fn uploads(team: &str) -> Vec<Upload> {
    UPLOADS.lock().unwrap_or_else(|e| e.into_inner()).iter().filter(|u| u.team == team && u.kind == "file").cloned().collect()
}

fn set_upload(local: &str, f: impl FnOnce(&mut Upload)) {
    if let Some(u) = UPLOADS.lock().unwrap_or_else(|e| e.into_inner()).iter_mut().find(|u| u.local == local) {
        f(u);
    }
}

/// 실패한 올리기 줄 치우기(화면 닫기 단추)
pub fn dismiss(local: &str) {
    UPLOADS.lock().unwrap_or_else(|e| e.into_inner()).retain(|u| u.local != local || u.error.is_empty() && u.done < u.total);
}

/// 파일 하나 올리기 — room 이 비면 팀 보관함(명부 사람 기기), 아니면 대화 파일(그 방 사람 기기). kind = file | avatar | profile
pub fn put_file(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, room: &str, kind: &str, path: &Path) -> Result<FileRef, String> {
    put_file_in(dir, kc, http, team, room, kind, "", path)
}

/// 팀 보관함 폴더에 올리기
#[allow(clippy::too_many_arguments)]
pub fn put_file_in(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, room: &str, kind: &str, folder: &str, path: &Path) -> Result<FileRef, String> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("파일 이름이 없어")?;
    put_file_as(dir, kc, http, team, room, kind, folder, path, &name)
}

/// 올리기 — 팀 보관함에 보일 이름을 따로(수정본 '<이름> (수정).<확장자>', 파일은 풀어 둔 자리 그대로)
#[allow(clippy::too_many_arguments)]
pub fn put_file_as(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, room: &str, kind: &str, folder: &str, path: &Path, name: &str) -> Result<FileRef, String> {
    let (st, k) = ctx(dir, kc)?;
    let (team, _) = team_of(&st, team)?;
    let name = name.to_string();
    if !path.is_file() {
        return Err(format!("파일이 아니야(폴더는 아직 못 올려): {name}"));
    }
    let local = format!("u-{}", crate::tools::tmp_tag());
    UPLOADS.lock().unwrap_or_else(|e| e.into_inner()).push(Upload { local: local.clone(), team: team.clone(), room: room.into(), name: name.clone(), kind: kind.into(), ..Default::default() });
    let res = (|| {
        let to = if room.is_empty() { people(dir, kc, http, &st, &team)?.0.recipients } else { crate::e2e_state::room_recipients(dir, kc, http, room)? };
        let net = RelayNet { http, server: st.server.clone(), device: st.device_id.clone(), keys: &k };
        core::upload(&net, &Me { keys: &k, device: &st.device_id }, &to, &team, room, kind, folder, path, &name, &mut |d, t| set_upload(&local, |u| (u.done, u.total) = (d, t)))
    })();
    match &res {
        Ok(_) => UPLOADS.lock().unwrap_or_else(|e| e.into_inner()).retain(|u| u.local != local),
        Err(e) => set_upload(&local, |u| u.error = e.clone()),
    }
    res
}

/// 화면 한 줄
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Item {
    pub id: String,
    pub name: String,
    /// 평문 바이트(못 연 파일은 0)
    pub size: u64,
    /// 암호문 바이트(사용량)
    pub cipher: u64,
    pub at: u64,
    pub state: String,
    pub kind: String,
    pub room: String,
    /// 팀 보관함 폴더(봉한 meta 안, 빈 글 = 맨 위)
    pub folder: String,
    pub by: String,
    /// 올린 멤버 id(프로필 사진 멤버별 최신 고르기)
    pub by_member: String,
    pub mine: bool,
    /// 못 열면 이유(빈 글 = 열 수 있음)
    pub why: String,
    pub deleted_at: Option<u64>,
    /// 빈 폴더 표시 줄 — 화면은 줄로 안 그리고 폴더 칩으로만
    pub dir: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct View {
    pub rev: u64,
    pub usage: Usage,
    pub items: Vec<Item>,
    /// 받는 목록에서 뺀 사람(보안 번호 바뀜 등)
    pub skipped: Vec<String>,
    /// 이번에 더한 봉투 수
    pub shared: usize,
    /// 단계별 ms(keys·list·people·open·share) — 여는 속도 재기(10-26)
    pub timing: BTreeMap<String, u64>,
    /// 기기에 봉해 둔 마지막 목록에서 꺼냈다(새로 받는 중)
    pub cached: bool,
}

/// 목록 — 열 수 있는 건 이름까지 풀고, 열 수 있는 파일은 나중에 든 사람·기기 몫 봉투를 더한다(scripts/team locker ls)
pub fn list(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<View, String> {
    list_at(dir, kc, http, team, std::time::Instant::now())
}

/// list — now 를 받아서(시험이 시계를 돌린다)
pub(crate) fn list_at(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, now: std::time::Instant) -> Result<View, String> {
    let (mut v, job) = list_split_at(dir, kc, http, team, now)?;
    let t = std::time::Instant::now();
    v.shared = job.run_at(dir, kc, http, now);
    v.timing.insert("share".into(), t.elapsed().as_millis() as u64);
    Ok(v)
}

/// 나중에 든 사람 몫 봉투 더하기 — 목록을 보여 준 뒤 뒤에서(방마다 받는 사람 셈이 중계를 여러 번 부른다)
#[must_use = "버리면 나중에 든 사람이 그 파일을 못 연다 — spawn() 으로 뒤 스레드에"]
pub struct ShareJob {
    team: String,
    opened: Vec<(RemoteFile, core::Opened)>,
}

impl ShareJob {
    /// 뒤 스레드로(진짜 데이터 폴더·열쇠·중계) — 화면·폰 명령이 목록을 먼저 돌려준 뒤
    pub fn spawn(self) {
        if !self.opened.is_empty() {
            std::thread::spawn(move || self.run(crate::config::data_dir(), &crate::team_relay_keys::store(), &crate::team_relay::Curl));
        }
    }

    pub fn run(self, dir: &Path, kc: &dyn Store, http: &dyn Http) -> usize {
        self.run_at(dir, kc, http, std::time::Instant::now())
    }

    pub(crate) fn run_at(self, dir: &Path, kc: &dyn Store, http: &dyn Http, now: std::time::Instant) -> usize {
        if self.opened.is_empty() {
            return 0;
        }
        let Ok((st, k)) = ctx(dir, kc) else { return 0 };
        let pairs: Vec<_> = self.opened.iter().map(|(f, o)| (f, o)).collect();
        // 먼저 캐시한 사람 목록으로 모자란 봉투가 있나만 본다 — 없으면 중계를 안 부른다(10-26 사고: 목록마다 명부·사슬을 새로 받았다)
        let Ok((cached, _)) = people_cached(dir, kc, http, &st, &self.team, false, now) else { return 0 };
        let room_cached = |room: &str| room_people(dir, kc, http, &self.team, room, false, now);
        if !core::missing_any(&pairs, &cached.recipients, &room_cached) {
            return 0;
        }
        // 더할 땐 받는 사람을 새로 — 캐시로 하면 그새 빠진 사람 기기에도 열쇠를 더해 줄 수 있다(뒤 스레드라 느려도 된다)
        let Ok((p, _)) = people_cached(dir, kc, http, &st, &self.team, true, now) else { return 0 };
        let net = RelayNet { http, server: st.server.clone(), device: st.device_id.clone(), keys: &k };
        // 방마다 이번 일에서 한 번만 새로(같은 방 파일이 여럿이어도)
        let fetched = RefCell::new(std::collections::BTreeSet::new());
        let want_room = |room: &str| room_people(dir, kc, http, &self.team, room, fetched.borrow_mut().insert(room.to_string()), now);
        core::share_keys(&net, &self.team, &pairs, &p.recipients, &want_room)
    }
}

/// 목록만(봉투 더하기는 ShareJob 으로 따로) — 화면 명령은 이걸 부르고 job 은 뒤 스레드로. 다 풀면 기기 봉한 마지막 목록도 새로
pub fn list_split(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<(View, ShareJob), String> {
    list_split_at(dir, kc, http, team, std::time::Instant::now())
}

/// list_split — now 를 받아서(시험이 시계를 돌린다)
pub(crate) fn list_split_at(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, now: std::time::Instant) -> Result<(View, ShareJob), String> {
    let t = std::time::Instant::now();
    let (st, k) = ctx(dir, kc)?;
    let (team, _) = team_of(&st, team)?;
    let timing = BTreeMap::from([("keys".to_string(), t.elapsed().as_millis() as u64)]);
    if let Some(e) = failing(&team, now) {
        return Err(e);
    }
    let r = list_split_net(dir, kc, http, &st, &k, &team, now, timing);
    match &r {
        Ok(_) => {
            FAILS.lock().unwrap_or_else(|e| e.into_inner()).remove(&team);
        }
        Err(e) => {
            let mut f = FAILS.lock().unwrap_or_else(|e| e.into_inner());
            let n = f.get(&team).map_or(0, |x| x.fails) + 1;
            f.insert(team.clone(), Fail { until: now + fail_wait(n), told: told(&team), fails: n, why: e.clone() });
        }
    }
    r
}

#[allow(clippy::too_many_arguments)]
fn list_split_net(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, k: &DeviceKeys, team: &str, now: std::time::Instant, mut timing: BTreeMap<String, u64>) -> Result<(View, ShareJob), String> {
    let team = team.to_string();
    let mut t = std::time::Instant::now();
    let mut lap = |name: &str, timing: &mut BTreeMap<String, u64>| {
        timing.insert(name.to_string(), t.elapsed().as_millis() as u64);
        t = std::time::Instant::now();
    };
    let net = RelayNet { http, server: st.server.clone(), device: st.device_id.clone(), keys: k };
    let l = listing(dir, &net, &team, now)?;
    lap("list", &mut timing);
    let me = Me { keys: k, device: &st.device_id };
    let (mut p, mut skipped) = people_cached(dir, kc, http, &st, &team, false, now)?;
    lap("people", &mut timing);
    let mut res: Vec<_> = l.files.iter().map(|f| core::open_file(&me, &p, &team, f)).collect();
    // 모르는 서명 기기(새 사람·새 기기)가 보이면 사람 목록을 새로 받아 한 번 더
    if res.iter().any(|o| o.as_ref().is_err_and(|e| stale_people(e))) {
        (p, skipped) = people_cached(dir, kc, http, &st, &team, true, now)?;
        res = l.files.iter().map(|f| core::open_file(&me, &p, &team, f)).collect();
        lap("people_again", &mut timing);
    }
    let mut items = vec![];
    let mut opened = vec![];
    for (f, o) in l.files.into_iter().zip(res) {
        let (name, size, at, folder, why) = match &o {
            Ok(o) if o.meta.dir => (String::new(), 0, o.meta.at, core::safe_path(&o.meta.folder), String::new()),
            Ok(o) => (core::safe_file_name(&o.meta.name), o.meta.size, o.meta.at, core::safe_path(&o.meta.folder), String::new()),
            Err(e) => (String::new(), 0, f.created_at, String::new(), e.clone()),
        };
        let dir_mark = o.as_ref().is_ok_and(|o| o.meta.dir);
        items.push(Item {
            id: f.id.clone(),
            name,
            size,
            cipher: f.size,
            at,
            state: f.state.clone(),
            kind: if f.kind.is_empty() { "file".into() } else { f.kind.clone() },
            room: f.room.clone().unwrap_or_default(),
            folder,
            by: p.names.get(&f.by.member).cloned().unwrap_or_default(),
            by_member: f.by.member.clone(),
            mine: f.by.device == st.device_id,
            why,
            deleted_at: f.deleted_at,
            dir: dir_mark,
        });
        if let Ok(o) = o {
            opened.push((f, o));
        }
    }
    lap("open", &mut timing);
    seen_rev(&team, l.rev);
    remember(&team, l.rev, &opened);
    let v = View { rev: l.rev, usage: l.usage, items, skipped, shared: 0, timing, cached: false };
    save_view(dir, k, &team, &v);
    Ok((v, ShareJob { team, opened }))
}

// ── 사람 목록 캐시 — 사슬·명부 검증이 중계를 사람 수만큼 부른다(목록·썸네일·열기마다). 10분 다시 쓰고, 그 전에라도
//    팀이 바뀌었으면(소켓 team_changed — 합류·나감·빼기)·사람이 보안 번호를 받아들였으면 지우고, 모르는 서명 기기가 보이면 바로 새로.
//    10분은 놓친 사슬 바뀜(그 사람이 새 기기를 들임 — 서버가 team_changed 를 안 민다) 대비 ──

static PEOPLE: Mutex<BTreeMap<String, (std::time::Instant, People, Vec<String>)>> = Mutex::new(BTreeMap::new());
/// (팀, 방) → 대화 파일 받는 기기 — 사람 목록과 같이 묵고 같이 지운다
#[allow(clippy::type_complexity)]
static ROOMS: Mutex<BTreeMap<(String, String), (std::time::Instant, Vec<crate::e2e_envelope::Recipient>)>> = Mutex::new(BTreeMap::new());

pub(crate) fn people_fresh(age: std::time::Duration) -> bool {
    age < std::time::Duration::from_secs(10 * 60)
}

/// 팀이 바뀜(소켓 team_changed)·보안 번호 받아들이기 — 사람 목록·방 받는 기기·실패 물러서기를 지운다(빈 팀 = 전부)
pub fn forget_people(team: &str) {
    let all = team.is_empty();
    PEOPLE.lock().unwrap_or_else(|e| e.into_inner()).retain(|t, _| !all && t != team);
    ROOMS.lock().unwrap_or_else(|e| e.into_inner()).retain(|(t, _), _| !all && t != team);
    FAILS.lock().unwrap_or_else(|e| e.into_inner()).retain(|t, _| !all && t != team);
}

/// 대화 파일 받는 기기 — fresh 가 아니면 캐시(사람 목록과 같은 수명). 못 셈하면 빈 목록(그 방 파일은 이번엔 안 더한다)
fn room_people(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, room: &str, fresh: bool, now: std::time::Instant) -> Vec<crate::e2e_envelope::Recipient> {
    let key = (team.to_string(), room.to_string());
    if !fresh {
        if let Some((at, v)) = ROOMS.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
            if people_fresh(now.saturating_duration_since(*at)) {
                return v.clone();
            }
        }
    }
    match crate::e2e_state::room_recipients(dir, kc, http, room) {
        Ok(v) => {
            ROOMS.lock().unwrap_or_else(|e| e.into_inner()).insert(key, (now, v.clone()));
            v
        }
        Err(_) => Vec::new(),
    }
}

// ── 목록 실패 물러서기 — 화면 셋(보관함 2초·프로필판 3초·팀 홈 3초, 창마다)이 실패한 목록을 쉬지 않고 다시 받지 않게.
//    실패하면 1분·2분·4분… 15분까지 중계를 안 부르고 같은 이유를 돌려준다. 그새 새 판이 알려지면 한 번은 다시 ──

struct Fail {
    until: std::time::Instant,
    /// 실패할 때 알려진 판 — 더 새 판이 오면 기다리지 않고 한 번 다시
    told: u64,
    fails: u32,
    why: String,
}

static FAILS: Mutex<BTreeMap<String, Fail>> = Mutex::new(BTreeMap::new());

pub(crate) fn fail_wait(fails: u32) -> std::time::Duration {
    std::time::Duration::from_secs((60u64 << fails.saturating_sub(1).min(4)).min(15 * 60))
}

/// 지금 물러서는 중이면 그 이유
fn failing(team: &str, now: std::time::Instant) -> Option<String> {
    let f = FAILS.lock().unwrap_or_else(|e| e.into_inner());
    let x = f.get(team)?;
    (now < x.until && told(team) <= x.told).then(|| x.why.clone())
}

/// 사람 목록이 묵어서 못 연 것 — 올린·이름 붙인 기기를 모른다
pub(crate) fn stale_people(why: &str) -> bool {
    why.contains("기기를 믿을 수 없어")
}

fn people_cached(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, team: &str, fresh: bool, now: std::time::Instant) -> Result<(People, Vec<String>), String> {
    if !fresh {
        if let Some((at, p, s)) = PEOPLE.lock().unwrap_or_else(|e| e.into_inner()).get(team) {
            if people_fresh(now.saturating_duration_since(*at)) {
                return Ok((p.clone(), s.clone()));
            }
        }
    }
    let (p, s) = people(dir, kc, http, st, team)?;
    PEOPLE.lock().unwrap_or_else(|e| e.into_inner()).insert(team.to_string(), (now, p.clone(), s.clone()));
    Ok((p, s))
}

// ── 마지막 목록 — 기기 열쇠로 봉해 데이터 폴더에(열자마자 보여 주고 뒤에서 새로, 10-26 사용자 "바로 떠 있어야") ──

pub(crate) fn view_cache_path(dir: &Path, tid: &str) -> PathBuf {
    dir.join("team-locker-views").join(format!("{tid}.bin"))
}

/// 봉해 두기 — 실패해도 목록은 그대로(다음에 다시)
pub(crate) fn save_view(dir: &Path, k: &DeviceKeys, tid: &str, v: &View) {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    if tid.is_empty() || !tid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return;
    }
    let Ok(pt) = serde_json::to_vec(&View { timing: BTreeMap::new(), ..v.clone() }) else { return };
    let mut nonce = [0u8; 12];
    if getrandom::fill(&mut nonce).is_err() {
        return;
    }
    let key = k.local_key("team-locker-view/1");
    let Ok(ct) = aes_gcm::Aes256Gcm::new((&key).into()).encrypt(aes_gcm::Nonce::from_slice(&nonce), Payload { msg: &pt, aad: tid.as_bytes() }) else { return };
    let p = view_cache_path(dir, tid);
    let _ = std::fs::create_dir_all(p.parent().unwrap_or(dir));
    let tmp = p.with_extension(format!("tmp-{}", crate::tools::tmp_tag()));
    let mut buf = nonce.to_vec();
    buf.extend(ct);
    #[cfg(unix)]
    let w = {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&tmp).and_then(|mut f| f.write_all(&buf))
    };
    #[cfg(not(unix))]
    let w = std::fs::write(&tmp, &buf);
    if w.is_ok() && std::fs::rename(&tmp, &p).is_ok() {
        return;
    }
    let _ = std::fs::remove_file(&tmp);
}

/// 봉해 둔 마지막 목록 — 없거나 다른 기기 열쇠·깨진 파일이면 None
pub(crate) fn read_view(dir: &Path, k: &DeviceKeys, tid: &str) -> Option<View> {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    let buf = std::fs::read(view_cache_path(dir, tid)).ok()?;
    if buf.len() < 13 {
        return None;
    }
    let key = k.local_key("team-locker-view/1");
    let pt = aes_gcm::Aes256Gcm::new((&key).into()).decrypt(aes_gcm::Nonce::from_slice(&buf[..12]), Payload { msg: &buf[12..], aad: tid.as_bytes() }).ok()?;
    serde_json::from_slice(&pt).ok()
}

/// 열자마자 — 봉해 둔 마지막 목록(망 안 씀). 없으면 None
pub fn cached(dir: &Path, kc: &dyn Store, team: &str) -> Option<View> {
    let (st, k) = ctx(dir, kc).ok()?;
    let (tid, _) = team_of(&st, team).ok()?;
    read_view(dir, &k, &tid).map(|v| View { cached: true, ..v })
}

// ── 목록에서 연 파일 기억 — 열기·썸네일이 목록(0.6초)·사람 목록(60초 지나면 2초)을 다시 받지 않게(10-26 사용자 "누르면 바로") ──
// 서명·봉투는 목록 받을 때 이미 확인했다. 소켓이 새 판을 알렸거나 10분 지났으면 안 쓰고 새로 받는다

struct Memo {
    at: std::time::Instant,
    rev: u64,
    files: BTreeMap<String, (RemoteFile, core::Opened)>,
}

static MEMO: Mutex<BTreeMap<String, Memo>> = Mutex::new(BTreeMap::new());

pub(crate) fn memo_fresh(age: std::time::Duration) -> bool {
    age < std::time::Duration::from_secs(10 * 60)
}

pub(crate) fn remember(team: &str, rev: u64, opened: &[(RemoteFile, core::Opened)]) {
    let files = opened.iter().map(|(f, o)| (f.id.clone(), (f.clone(), o.clone()))).collect();
    MEMO.lock().unwrap_or_else(|e| e.into_inner()).insert(team.to_string(), Memo { at: std::time::Instant::now(), rev, files });
}

pub(crate) fn recall(team: &str, id: &str) -> Option<(RemoteFile, core::Opened)> {
    let m = MEMO.lock().unwrap_or_else(|e| e.into_inner());
    let e = m.get(team)?;
    if !memo_fresh(e.at.elapsed()) || told(team) > e.rev {
        return None;
    }
    e.files.get(id).cloned()
}

/// 내가 고쳤으면(이름·폴더·휴지통) — 소켓 알림보다 먼저 다시 열 수 있다
pub(crate) fn forget(team: &str) {
    MEMO.lock().unwrap_or_else(|e| e.into_inner()).remove(team);
}

/// 기억 채우기 차례 — 팀마다 하나(썸네일 여럿이 같이 불러도 목록 받기는 한 번, 나머지는 기다렸다 기억을 쓴다)
static FILL: Mutex<BTreeMap<String, std::sync::Arc<Mutex<()>>>> = Mutex::new(BTreeMap::new());

/// 목록 기억이 없거나 묵었으면 목록을 한 번 받아 열 수 있는 것을 다 열어 기억한다(10-26 실측: 앱 켠 뒤 썸네일마다 목록을 두 번씩 받았다).
/// 돌려주는 건 id 파일 — 방금 받은 목록에서 바로 찾는다(받은 판이 알린 판보다 옛것이면 기억은 묵은 걸로 쳐서 recall 이 None 이라, 그걸 믿으면 목록을 또 받았다)
fn fill_memo(dir: &Path, kc: &dyn Store, http: &dyn Http, st: &TeamState, k: &DeviceKeys, team: &str, id: &str) -> Result<Option<(RemoteFile, core::Opened)>, String> {
    let gate = FILL.lock().unwrap_or_else(|e| e.into_inner()).entry(team.to_string()).or_default().clone();
    let _g = gate.lock().unwrap_or_else(|e| e.into_inner());
    if memo_ok(team) {
        return Ok(recall(team, id));
    }
    let net = RelayNet { http, server: st.server.clone(), device: st.device_id.clone(), keys: k };
    let l = core::fetch_list(&net, team)?;
    let me = Me { keys: k, device: &st.device_id };
    let now = std::time::Instant::now();
    let mut p = people_cached(dir, kc, http, st, team, false, now)?.0;
    let mut res: Vec<_> = l.files.iter().map(|f| core::open_file(&me, &p, team, f)).collect();
    if res.iter().any(|o| o.as_ref().is_err_and(|e| stale_people(e))) {
        p = people_cached(dir, kc, http, st, team, true, now)?.0;
        res = l.files.iter().map(|f| core::open_file(&me, &p, team, f)).collect();
    }
    let opened: Vec<_> = l.files.into_iter().zip(res).filter_map(|(f, o)| o.ok().map(|o| (f, o))).collect();
    remember(team, l.rev, &opened);
    Ok(opened.into_iter().find(|(f, _)| f.id == id))
}

fn memo_ok(team: &str) -> bool {
    MEMO.lock().unwrap_or_else(|e| e.into_inner()).get(team).is_some_and(|e| memo_fresh(e.at.elapsed()) && told(team) <= e.rev)
}

fn find(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str) -> Result<(TeamState, DeviceKeys, String, RemoteFile, core::Opened), String> {
    let (st, k) = ctx(dir, kc)?;
    let (team, _) = team_of(&st, team)?;
    if let Some((f, o)) = recall(&team, id) {
        return Ok((st, k, team, f, o));
    }
    if let Some((f, o)) = fill_memo(dir, kc, http, &st, &k, &team, id)? {
        return Ok((st, k, team, f, o));
    }
    // 기억에 없다 = 목록에 없거나 못 여는 파일 — 그 이유를 말하려고 예전 길로 한 번 더
    let net = RelayNet { http, server: st.server.clone(), device: st.device_id.clone(), keys: &k };
    let f = core::fetch_list(&net, &team)?.files.into_iter().find(|f| f.id == id).ok_or("그 파일이 없어(지워졌거나 볼 수 없는 방)")?;
    let me = Me { keys: &k, device: &st.device_id };
    let o = match core::open_file(&me, &people_cached(dir, kc, http, &st, &team, false, std::time::Instant::now())?.0, &team, &f) {
        Err(e) if stale_people(&e) => core::open_file(&me, &people_cached(dir, kc, http, &st, &team, true, std::time::Instant::now())?.0, &team, &f)?,
        o => o?,
    };
    Ok((st, k, team, f, o))
}

pub(crate) const CACHE: &str = "team-locker-cache.json";

/// 이 기기가 올린 파일인가(수정본 새 판 — 옛 판을 휴지통으로 보낼 때 남의 것을 건드리지 않게)
pub fn mine(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str) -> Result<bool, String> {
    let (st, _, _, f, _) = find(dir, kc, http, team, id)?;
    Ok(f.by.device == st.device_id)
}

/// 내려받기 — 팀 폴더(~/Documents/Chammo/<팀>, 대화 파일은 그 안 '대화 파일')에. 이미 받은 같은 파일은 그대로 쓴다('이 기기에 저장'·scripts/team locker get)
pub fn fetch(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str) -> Result<PathBuf, String> {
    let st = relay::load_state(dir);
    let (tid, name) = team_of(&st, team)?;
    let root = crate::locker_fs::app_ctx().root;
    let folder = crate::locker_fs::owner_dir(&root, &format!("team-{tid}"), &name)?;
    fetch_to(dir, kc, http, &tid, id, &folder)
}

/// 내려받기 — folder(대화 파일은 folder/대화 파일)에
pub fn fetch_to(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str, folder: &Path) -> Result<PathBuf, String> {
    let memo = ctx(dir, kc).ok().and_then(|(st, _)| team_of(&st, team).ok()).filter(|(tid, _)| recall(tid, id).is_some());
    match fetch_found(dir, kc, http, team, id, folder) {
        // 기억한 줄로 못 받았으면(그새 지워짐 등) 목록을 새로 받아 한 번 더 — 진짜 이유는 새 목록이 말한다
        Err(_) if memo.is_some() => {
            forget(&memo.map(|(t, _)| t).unwrap_or_default());
            fetch_found(dir, kc, http, team, id, folder)
        }
        r => r,
    }
}

fn fetch_found(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str, folder: &Path) -> Result<PathBuf, String> {
    let (st, k, team, f, o) = find(dir, kc, http, team, id)?;
    let mut cache: BTreeMap<String, String> = std::fs::read_to_string(dir.join(CACHE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let key = format!("{id}:{}:{}", o.meta.at, folder.display());
    if let Some(p) = cache.get(&key).map(PathBuf::from) {
        // 사람이 고쳐 둔 사본(아직 안 올린 수정본)은 그대로 — 다시 받으면 고친 게 안 보였다(team_revise, 10-28 사용자 1안)
        if std::fs::metadata(&p).is_ok_and(|m| m.is_file() && m.len() == o.meta.size) || (p.is_file() && crate::team_revise::edited(dir, &p)) {
            touch(&p); // 다시 쓴 평문은 새로 받은 것으로 — 청소(sweep)가 보던 파일을 지우지 않게
            return Ok(p);
        }
    }
    let to = if f.room.as_deref().is_some_and(|r| !r.is_empty()) { folder.join(core::CHAT_FOLDER) } else if o.meta.folder.is_empty() { folder.to_path_buf() } else { folder.join(core::safe_path(&o.meta.folder)) };
    let net = RelayNet { http, server: st.server.clone(), device: st.device_id.clone(), keys: &k };
    let at = core::download(&net, &team, &f, &o, &to, &mut |_, _| {})?;
    if at.starts_with(dir.join(VIEW_DIR)) {
        crate::team_revise::record(dir, &at); // 받은 그대로의 지문 — 사람이 고쳐 저장하면 '수정본 올리기'
    }
    // 지워진 자리를 가리키는 옛 줄은 이참에 뺀다
    cache.retain(|_, p| Path::new(p).exists());
    cache.insert(key, at.to_string_lossy().into_owned());
    let _ = crate::accounts::write_atomic(&dir.join(CACHE), &serde_json::to_string(&cache).unwrap_or_default());
    Ok(at)
}

// ── 풀어 둔 평문 자리 — 열기·미리보기·썸네일(10-26 사용자: 사용자 폴더에 평문이 흩어지지 않게) ──

/// 데이터 폴더 아래 자리 이름 — 화면 domain/teamLocker VIEW_DIR 와 같은 글
pub const VIEW_DIR: &str = "team-locker-peek";
/// 이만큼 안 쓴 평문은 지운다
pub const VIEW_KEEP: std::time::Duration = std::time::Duration::from_secs(3 * 24 * 3600);

/// 팀마다 풀어 둘 자리 — <데이터>/team-locker-peek/<팀 id>, 뿌리는 나만 여는 0700
pub fn view_dir(dir: &Path, tid: &str) -> Result<PathBuf, String> {
    if tid.is_empty() || !tid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("팀 id 모양이 틀렸어".into());
    }
    let root = dir.join(VIEW_DIR);
    std::fs::create_dir_all(root.join(tid)).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700));
    }
    Ok(root.join(tid))
}

/// 고친 시각을 지금으로
pub fn touch(p: &Path) {
    if let Ok(f) = std::fs::File::options().write(true).open(p) {
        let _ = f.set_modified(std::time::SystemTime::now());
    }
}

/// keep 보다 오래 안 쓴 파일을 지우고 빈 폴더를 치운다(뿌리는 남김). 지운 파일 수
pub fn sweep(root: &Path, keep: std::time::Duration, now: std::time::SystemTime) -> usize {
    sweep_but(root, keep, now, &|_| false)
}

/// sweep — stay(p) 인 파일은 오래돼도 남긴다(안 올린 수정본)
pub fn sweep_but(root: &Path, keep: std::time::Duration, now: std::time::SystemTime, stay: &dyn Fn(&Path) -> bool) -> usize {
    fn walk(d: &Path, cut: std::time::SystemTime, top: bool, stay: &dyn Fn(&Path) -> bool) -> usize {
        let Ok(rd) = std::fs::read_dir(d) else { return 0 };
        let mut n = 0;
        for e in rd.flatten() {
            let p = e.path();
            let Ok(m) = std::fs::symlink_metadata(&p) else { continue };
            if m.is_dir() {
                n += walk(&p, cut, false, stay);
            } else if m.modified().is_ok_and(|t| t < cut) && !stay(&p) && std::fs::remove_file(&p).is_ok() {
                n += 1;
            }
        }
        if !top {
            let _ = std::fs::remove_dir(d); // 비었을 때만 지워진다
        }
        n
    }
    walk(root, now.checked_sub(keep).unwrap_or(std::time::UNIX_EPOCH), true, stay)
}

static SWEPT: Mutex<Option<std::time::Instant>> = Mutex::new(None);

/// 한 시간에 한 번만 청소(썸네일마다 부르니까)
fn sweep_now(dir: &Path) {
    let mut last = SWEPT.lock().unwrap_or_else(|e| e.into_inner());
    if last.is_some_and(|t| t.elapsed() < std::time::Duration::from_secs(3600)) {
        return;
    }
    *last = Some(std::time::Instant::now());
    // 안 올린 수정본은 남긴다 — 3일 지나 사람이 고친 게 사라지지 않게(10-28 사용자 1안)
    sweep_but(&dir.join(VIEW_DIR), VIEW_KEEP, std::time::SystemTime::now(), &|p| crate::team_revise::edited(dir, p));
}

/// 열기 — 크기 제한 없이 풀어 둔 자리에(스페이스·기본 앱이 이 경로를 연다)
pub fn view(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str) -> Result<PathBuf, String> {
    let st = relay::load_state(dir);
    let (tid, _) = team_of(&st, team)?;
    sweep_now(dir);
    fetch_to(dir, kc, http, &tid, id, &view_dir(dir, &tid)?)
}

/// 미리보기·카드 썸네일 — 같은 자리에, 50MiB 까지
pub fn peek(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str) -> Result<PathBuf, String> {
    let st = relay::load_state(dir);
    let (tid, _) = team_of(&st, team)?;
    // 크기는 기억으로(없으면 find 가 목록을 한 번 받아 채운다 — 썸네일마다 목록을 따로 받지 않게)
    let size = match recall(&tid, id) {
        Some((f, _)) => f.size,
        None => find(dir, kc, http, &tid, id)?.3.size,
    };
    if size > 50 * 1024 * 1024 {
        return Err("미리보기는 50MB 까지 — 열기로 봐 줘".into());
    }
    sweep_now(dir);
    fetch_to(dir, kc, http, &tid, id, &view_dir(dir, &tid)?)
}

/// 스페이스 탭 내려받기 — 풀어 둔 자리 안 파일만 out(다운로드 폴더)에 겹치지 않는 이름으로 복사
pub fn copy_out(dir: &Path, src: &Path, out: &Path) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(dir.join(VIEW_DIR)).map_err(|_| "풀어 둔 팀 파일이 아니야".to_string())?;
    let real = std::fs::canonicalize(src).map_err(|_| "그 파일이 없어(오래돼서 지워졌으면 보관함에서 다시 열어 줘)".to_string())?;
    if !real.starts_with(&root) || !real.is_file() {
        return Err("풀어 둔 팀 파일이 아니야".into());
    }
    let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("파일 이름이 없어")?;
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let to = crate::locker_fs::unique(out, &name, true);
    std::fs::copy(&real, &to).map_err(|e| format!("못 복사했어: {e}"))?;
    Ok(to)
}

// ── 내 참모에게 — 팀 파일을 그 참모 보관함에 풀어 준다(10-26 사용자). 풀어 두기 자리(team-locker-peek)는 청소로 지워지니 참모가 고칠 파일은 보관함에 ──

/// 참모 보관함 안 팀 파일 자리 이름 — <참모>/팀 보관함/<팀>/<팀 폴더>/<파일>. 안내문(CHAMMO.md)이 이 모양을 보고 수정본을 그 팀 폴더로 돌려놓게 한다
pub const GIVE_DIR: &str = "팀 보관함";

/// 그 참모 보관함 안 이 팀 자리 — 팀 이름을 폴더 이름으로 못 쓰면(빔·점) 팀 id
pub fn give_dir(owner: &Path, team_name: &str, tid: &str) -> PathBuf {
    let t = core::safe_folder(team_name);
    owner.join(GIVE_DIR).join(if t.is_empty() { tid } else { &t })
}

/// 내 참모에게 — root(~/Documents/Chammo) 아래 그 참모 폴더의 팀 자리에 푼 경로. 같은 판을 또 주면 같은 파일(fetch_to 기억), 판이 바뀌면 '이름 2'로(참모가 고친 것을 안 덮는다).
/// 팀 폴더(team-…)는 참모가 아니다 — 거절
pub fn give(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str, root: &Path, orch: &str, name: &str) -> Result<PathBuf, String> {
    if orch.starts_with("team-") {
        return Err("참모 보관함에만 줄 수 있어".into());
    }
    let st = relay::load_state(dir);
    let (tid, tname) = team_of(&st, team)?;
    let owner = crate::locker_fs::owner_dir(root, orch, name)?;
    fetch_to(dir, kc, http, &tid, id, &give_dir(&owner, &tname, &tid))
}

/// 스페이스 팀 파일 탭의 '내 참모에게' — 풀어 둔 자리(team-locker-peek/<팀>/…) 안 파일만 그 참모 팀 자리(같은 팀 폴더)에 복사한 경로.
/// 같은 내용이 이미 있으면 그 파일, 참모가 고쳐 둔 같은 이름은 안 덮고 '이름 2'로
pub fn give_path(dir: &Path, src: &Path, root: &Path, orch: &str, name: &str) -> Result<PathBuf, String> {
    if orch.starts_with("team-") {
        return Err("참모 보관함에만 줄 수 있어".into());
    }
    let peek = std::fs::canonicalize(dir.join(VIEW_DIR)).map_err(|_| "풀어 둔 팀 파일이 아니야".to_string())?;
    let real = std::fs::canonicalize(src).map_err(|_| "그 파일이 없어(오래돼서 지워졌으면 보관함에서 다시 열어 줘)".to_string())?;
    let rel = real.strip_prefix(&peek).map_err(|_| "풀어 둔 팀 파일이 아니야".to_string())?.to_path_buf();
    if !real.is_file() {
        return Err("파일만 줄 수 있어".into());
    }
    let mut parts = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned());
    let tid = parts.next().unwrap_or_default();
    let st = relay::load_state(dir);
    let t = st.teams.iter().find(|t| t.id == tid).ok_or("이 기기 팀의 파일이 아니야")?;
    let owner = crate::locker_fs::owner_dir(root, orch, name)?;
    let rest: Vec<String> = parts.collect();
    let (file, sub) = rest.split_last().ok_or("파일 이름이 없어")?;
    let mut to = give_dir(&owner, &t.name, &tid);
    for s in sub {
        to = to.join(crate::locker_fs::safe_name(s, "_"));
    }
    std::fs::create_dir_all(&to).map_err(|e| e.to_string())?;
    let same = to.join(file);
    // 크기 먼저, 같을 때만 조각으로 비교(큰 영상을 통째로 메모리에 안 읽는다)
    if crate::locker_fs::same_content(&same, &real) {
        return Ok(same);
    }
    let at = crate::locker_fs::unique(&to, file, true);
    std::fs::copy(&real, &at).map_err(|e| format!("못 복사했어: {e}"))?;
    Ok(at)
}

// ── 폴더 — 칩(만들기·이름 바꾸기·지우기). 폴더 이름은 봉한 meta 안에만 ──

/// fresh = 사람 목록을 새로(받는 기기를 정할 때 — 새 폴더). 열기만 하면(폴더 이름·지우기) 60초 캐시, 모르는 서명 기기가 보이면 그때 새로
fn opened_all(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, fresh: bool) -> Result<(TeamState, DeviceKeys, String, Vec<(RemoteFile, core::Opened)>, People), String> {
    let (st, k) = ctx(dir, kc)?;
    let (team, _) = team_of(&st, team)?;
    let net = RelayNet { http, server: st.server.clone(), device: st.device_id.clone(), keys: &k };
    let files = core::fetch_list(&net, &team)?.files;
    let me = Me { keys: &k, device: &st.device_id };
    let (mut p, _) = people_cached(dir, kc, http, &st, &team, fresh, std::time::Instant::now())?;
    let mut res: Vec<_> = files.iter().map(|f| core::open_file(&me, &p, &team, f)).collect();
    if !fresh && res.iter().any(|o| o.as_ref().is_err_and(|e| stale_people(e))) {
        p = people_cached(dir, kc, http, &st, &team, true, std::time::Instant::now())?.0;
        res = files.iter().map(|f| core::open_file(&me, &p, &team, f)).collect();
    }
    let opened = files.into_iter().zip(res).filter_map(|(f, o)| o.ok().map(|o| (f, o))).collect();
    Ok((st, k, team, opened, p))
}

/// 새 폴더 — 이미 있는 폴더면 그대로. 사람 확인은 한 번(예전엔 두 번 차례로 불러 운영에서 약 7초, 10-26 사용자 298.png)
pub fn mkdir(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, folder: &str) -> Result<(), String> {
    let (st, k, team, opened, p) = opened_all(dir, kc, http, team, true)?;
    let want = core::safe_path(folder);
    // 이미 있다 = 그 폴더 표시 줄이 있다. 파일로만 생긴 폴더(올리기·옛 앱)엔 표시 줄을 하나 남긴다 — 화면이 마지막 파일을 꺼내기 전에 불러
    // 빈 폴더가 사라지지 않게 한다(파인더처럼)
    if opened.iter().any(|(f, o)| f.state == "live" && f.room.as_deref().unwrap_or("").is_empty() && o.meta.dir && o.meta.folder == want) {
        return Ok(());
    }
    let net = RelayNet { http, server: st.server.clone(), device: st.device_id.clone(), keys: &k };
    core::mkdir(&net, &Me { keys: &k, device: &st.device_id }, &p.recipients, &team, &want).map(|_| ())
}

/// 폴더 이름 바꾸기(to = Some) · 지우기(to = None, 안의 파일은 휴지통으로). 옮긴 수
pub fn folder(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, from: &str, to: Option<&str>) -> Result<usize, String> {
    let (st, k, team, opened, _) = opened_all(dir, kc, http, team, false)?;
    forget(&team);
    let net = RelayNet { http, server: st.server.clone(), device: st.device_id.clone(), keys: &k };
    let pairs: Vec<_> = opened.iter().map(|(f, o)| (f, o)).collect();
    match to {
        Some(to) => core::rename_folder(&net, &Me { keys: &k, device: &st.device_id }, &team, &pairs, from, to),
        None => core::remove_folder(&net, &team, &pairs, from),
    }
}

/// 평문 바이트로 받기(프로필 사진 같은 작은 것) — 16MiB 까지
pub fn get_bytes(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str) -> Result<Vec<u8>, String> {
    let (st, k, team, f, o) = find(dir, kc, http, team, id)?;
    if o.meta.size > 16 * 1024 * 1024 {
        return Err("너무 커서 바이트로는 못 받아 — fetch 로".into());
    }
    let net = RelayNet { http, server: st.server.clone(), device: st.device_id.clone(), keys: &k };
    let mut out = Vec::with_capacity(o.meta.size as usize);
    for i in 0..f.parts {
        let (c, ct) = net.get(&format!("/v0/teams/{team}/locker/files/{}/parts/{i}", f.id))?;
        if c != 200 {
            return Err(relay::why(c, &Value::Null));
        }
        out.extend(core::open_chunk(&o.k, &team, f.room.as_deref().unwrap_or(""), &f.id, i, i + 1 == f.parts, &ct)?);
    }
    Ok(out)
}

/// 이름 바꾸기·폴더 옮기기(None 이면 그대로)
pub fn rename(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str, name: Option<&str>, folder: Option<&str>) -> Result<(), String> {
    let (st, k, team, f, o) = find(dir, kc, http, team, id)?;
    forget(&team);
    let net = RelayNet { http, server: st.server.clone(), device: st.device_id.clone(), keys: &k };
    core::rename(&net, &Me { keys: &k, device: &st.device_id }, &team, &f, &o, name, folder)
}

/// 휴지통·되살리기·영구 지우기 — 여는 열쇠는 필요 없다
pub fn act(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, id: &str, verb: &str) -> Result<(), String> {
    let (st, k) = ctx(dir, kc)?;
    let (team, _) = team_of(&st, team)?;
    forget(&team);
    let net = RelayNet { http, server: st.server.clone(), device: st.device_id.clone(), keys: &k };
    core::act(&net, &team, id, verb)
}

// ── 바뀜 알림 — 방 소켓 {t:"locker", team, rev} → 화면이 2초마다 보는 판 번호 ──

static REVS: Mutex<BTreeMap<String, (u64, u64)>> = Mutex::new(BTreeMap::new());

/// 서버가 알린 판(소켓) — 화면은 changed() 로 본다
pub fn nudge(team: &str, rev: u64) {
    if !team.is_empty() {
        REVS.lock().unwrap_or_else(|e| e.into_inner()).entry(team.into()).or_default().0 = rev.max(1);
    }
}

fn seen_rev(team: &str, rev: u64) {
    let mut m = REVS.lock().unwrap_or_else(|e| e.into_inner());
    let e = m.entry(team.into()).or_default();
    e.1 = rev;
    e.0 = e.0.max(rev);
}

/// 소켓이 알린 가장 새 판 — 다른 화면(팀 프로필)이 따로 본 판과 견준다
pub fn told(team: &str) -> u64 {
    REVS.lock().unwrap_or_else(|e| e.into_inner()).get(team).map_or(0, |(told, _)| *told)
}

/// 화면이 마지막으로 받은 판보다 새 판이 알려졌나
pub fn changed(team: &str) -> bool {
    changed_at(team, std::time::Instant::now())
}

/// 물러서는 중이면 false — 화면이 2초마다 실패한 목록을 다시 부르지 않게(기다림이 끝나면 다시 true)
pub(crate) fn changed_at(team: &str, now: std::time::Instant) -> bool {
    REVS.lock().unwrap_or_else(|e| e.into_inner()).get(team).is_some_and(|(told, seen)| told > seen) && failing(team, now).is_none()
}

/// 그 화면이 본 판(seen)보다 새 판이 알려졌나 — 물러서는 중이면 false(changed_at 과 같은 까닭)
pub fn changed_since(team: &str, seen: u64) -> bool {
    changed_since_at(team, seen, std::time::Instant::now())
}

pub(crate) fn changed_since_at(team: &str, seen: u64, now: std::time::Instant) -> bool {
    told(team) > seen && failing(team, now).is_none()
}

/// 목록이 물러서는 중인가(프로필판·팀 홈 바뀜 확인이 같이 본다)
pub(crate) fn backing_off(team: &str, now: std::time::Instant) -> bool {
    failing(team, now).is_some()
}

/// 참모 길(scripts/team locker get·rm) — id 그대로, 아니면 보이는 파일 중 이름이 꼭 맞는 하나(폴더/이름도 된다)
pub fn resolve(v: &View, q: &str) -> Result<String, String> {
    let q = q.trim();
    if let Some(i) = v.items.iter().find(|i| i.id == q) {
        return Ok(i.id.clone());
    }
    let hits: Vec<&Item> = v.items.iter().filter(|i| i.kind == "file" && !i.dir && i.state == "live" && !i.name.is_empty() && (i.name == q || (!i.folder.is_empty() && format!("{}/{}", i.folder, i.name) == q))).collect();
    match hits.as_slice() {
        [one] => Ok(one.id.clone()),
        [] => Err(format!("팀 보관함에 '{q}' 이(가) 없어 — scripts/team locker ls 로 이름·id 를 봐")),
        many => Err(format!("'{q}' 이(가) {}개야 — id 로 골라: {}", many.len(), many.iter().map(|i| i.id.as_str()).collect::<Vec<_>>().join(", "))),
    }
}

pub fn view_json(v: &View) -> Value {
    json!(v)
}

#[cfg(test)]
#[path = "team_locker_app_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "team_locker_live_tests.rs"]
mod live;

#[cfg(test)]
#[path = "team_locker_storm_tests.rs"]
mod storm;
