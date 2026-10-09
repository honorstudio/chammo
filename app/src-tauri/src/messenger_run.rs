//! 메신저 브리지 — 받은 텔레그램 글을 판단(messenger.rs)대로 처리하고, 참모 회신·새 카드를 내보낸다.
//! 맥 쪽 일(참모 목록·입력칸에 치기·카드 답·대화 기록)은 Env 뒤에 둬서 시험은 가짜 Env + 가짜 텔레그램 서버로 돈다.
//! 스레드·설정 명령은 messenger_cmd.rs
use crate::accounts_store::{Secret, Store};
use crate::direct::Pick;
use crate::messenger::{self as m, Act, Gate, Orch, State};
use crate::messenger_text as mt;
use crate::messenger_tg::{Api, TgErr};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const FILE: &str = "messenger.json";
/// 텔레그램에서 말한 뒤 참모 회신을 보내 주는 시간
const WATCH_MS: u64 = 6 * 3600 * 1000;
/// 이보다 오래된 카드는 메신저로 안 보낸다(켤 때 옛 카드가 쏟아지지 않게)
const CARD_MAX_AGE_MS: u64 = 24 * 3600 * 1000;
/// 대화 기록 한 번에 읽는 상한
const READ_MAX: u64 = 512 * 1024;
/// 키체인 칸 서비스 이름 — 계정 = 데이터 폴더별(시험 폴더는 다른 칸)
pub const SERVICE: &str = "Chammo Telegram bot";

// ── 상태 파일·토큰 ──────────────────────────────────────────

pub fn load_state(dir: &Path) -> State {
    std::fs::read_to_string(dir.join(FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save_state(dir: &Path, st: &State) -> Result<(), String> {
    let text = serde_json::to_string_pretty(st).map_err(|e| e.to_string())?;
    crate::mobile_pair::write_private(&dir.join(FILE), &text).map_err(|e| e.to_string())
}

/// 키체인 칸 계정 — 데이터 폴더 경로의 해시 앞 16자(경로 자체는 안 남긴다)
pub fn account(dir: &Path) -> String {
    use sha2::{Digest, Sha256};
    let h = Sha256::digest(dir.to_string_lossy().as_bytes());
    format!("tg-{}", h.iter().take(8).map(|b| format!("{b:02x}")).collect::<String>())
}

/// 토큰 보관 자리 — 맥 = 키체인, 윈도우 = 데이터 폴더 600 파일(1단계, 설정에 밝힌다)
pub fn token_in_file() -> bool {
    !cfg!(target_os = "macos")
}

/// 창은 안 띄운다(quiet). 시험은 CHAMMO_MESSENGER_KEYCHAIN(키체인 파일)·_PASSWORD 로 로그인 키체인을 안 건드린다(계정 칸과 같은 방식)
fn keychain() -> crate::accounts_store::Keychain {
    let path = std::env::var("CHAMMO_MESSENGER_KEYCHAIN").ok().filter(|s| !s.is_empty());
    let unlock = path.as_ref().and(std::env::var("CHAMMO_MESSENGER_KEYCHAIN_PASSWORD").ok());
    crate::accounts_store::Keychain { path, unlock, quiet: true, cli_service: None }
}

fn token_file(dir: &Path) -> PathBuf {
    dir.join("messenger-token")
}

pub fn token_get(dir: &Path) -> Option<Secret> {
    if token_in_file() {
        return std::fs::read_to_string(token_file(dir)).ok().map(|t| Secret::new(t.trim()));
    }
    match keychain().get(SERVICE, &account(dir)) {
        Ok(t) => t,
        Err(e) => {
            log(&format!("토큰 읽기 실패 {e:?}")); // 오류 종류만(값은 StoreError 에 안 들어 있다)
            None
        }
    }
}

pub fn token_set(dir: &Path, t: &Secret) -> Result<(), String> {
    if token_in_file() {
        return crate::mobile_pair::write_private(&token_file(dir), t.expose()).map_err(|e| e.to_string());
    }
    keychain().set(SERVICE, &account(dir), t).map_err(|e| format!("{e:?}"))
}

pub fn token_remove(dir: &Path) -> Result<(), String> {
    if token_in_file() {
        return match std::fs::remove_file(token_file(dir)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    }
    keychain().remove(SERVICE, &account(dir)).map_err(|e| format!("{e:?}"))
}

// ── 같이 쓰는 것 ────────────────────────────────────────────

#[derive(Default, Clone, serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunStatus {
    pub running: bool,
    pub error: Option<String>,
    /// 마지막으로 텔레그램에 닿은 때(ms)
    pub last_ok: u64,
}

/// 브리지·설정 명령이 같이 쓰는 것 — 상태는 바꿀 때마다 파일에(600)
pub struct Shared {
    pub dir: PathBuf,
    pub state: Mutex<State>,
    pub gate: Mutex<Gate>,
    pub status: Mutex<RunStatus>,
}

impl Shared {
    pub fn open(dir: &Path) -> Shared {
        Shared { dir: dir.to_path_buf(), state: Mutex::new(load_state(dir)), gate: Mutex::new(Gate::default()), status: Mutex::new(RunStatus::default()) }
    }
    pub fn state(&self) -> State {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    /// 바꾸고 저장 — 파일 쓰기가 실패해도 메모리 값은 바뀐다(다음 저장 때 같이 쓴다)
    pub fn update(&self, f: impl FnOnce(&mut State)) -> State {
        let mut g = self.state.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut g);
        if let Err(e) = save_state(&self.dir, &g) {
            log(&format!("상태 저장 실패: {e}"));
        }
        g.clone()
    }
    pub fn set_status(&self, f: impl FnOnce(&mut RunStatus)) {
        f(&mut self.status.lock().unwrap_or_else(|e| e.into_inner()));
    }
}

/// notify.log 한 줄(글 내용은 절대 안 넣는다 — 종류·숫자만). 시험에선 진짜 로그에 안 쓴다
pub fn log(text: &str) {
    #[cfg(not(test))]
    crate::claude::log_out("messenger", text);
    #[cfg(test)]
    let _ = text;
}

// ── 맥 쪽 일 ────────────────────────────────────────────────

pub trait Env {
    /// 살아 있는 참모(HQ 폴더·참모 이름)
    fn orchs(&self) -> Result<Vec<Orch>, String>;
    /// 참모 입력칸에 친다(글은 로그에 안 남긴다)
    fn type_to(&self, o: &Orch, text: &str) -> Result<(), String>;
    fn answer(&self, card: &str, pick: &Pick, by: &str) -> Result<(), String>;
    fn direct_log(&self) -> String;
    fn shown(&self, card: &str);
    fn transcript(&self, session: &str) -> Option<PathBuf>;
    /// 짧은 번호의 지금 대화 id — 참모가 /clear 하면 짧은 번호는 그대로고 대화 id 만 바뀐다(2026-10-09 실측). 모르면 None
    fn session_now(&self, id: &str) -> Option<String>;
    fn assistant(&self) -> String;
    /// (데이터 폴더, 홈) — 가림 기준
    fn dirs(&self) -> (String, String);
}

/// 앱이 적는 live.json(sessions[].id·sessionId)에서 짧은 번호의 대화 id — 감시 중에 2초마다 읽어서 agents --json(느림) 대신
pub fn session_in_live(live_json: &str, id: &str) -> Option<String> {
    let v: Value = serde_json::from_str(live_json).ok()?;
    v["sessions"].as_array()?.iter().find(|s| s["id"].as_str() == Some(id))?["sessionId"].as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

/// claude agents --json → 참모(HQ 폴더에서 도는 참모 이름 세션)
pub fn orchs_from(json: &str, hq: &str, assistant: &str) -> Vec<Orch> {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
    let hq = norm(hq);
    let v: Value = serde_json::from_str(json).unwrap_or_default();
    v.as_array()
        .into_iter()
        .flatten()
        .filter(|a| !hq.is_empty() && norm(a["cwd"].as_str().unwrap_or("")) == hq)
        .filter(|a| m::is_orch_name(a["name"].as_str().unwrap_or(""), assistant))
        .filter_map(|a| {
            let id = a["id"].as_str().filter(|s| crate::mobile_http::is_short_id(s))?;
            Some(Orch { id: id.into(), session: a["sessionId"].as_str().unwrap_or("").into(), name: a["name"].as_str().unwrap_or("").into() })
        })
        .collect()
}

/// "2026-10-08T01:00:00Z"·"…+00:00" → ms(UTC 로 본다 — scripts/direct·앱 둘 다 UTC 로 쓴다)
pub fn iso_ms(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let n = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (n(0, 4)?, n(5, 7)?, n(8, 10)?, n(11, 13)?, n(14, 16)?, n(17, 19)?);
    // Howard Hinnant days_from_civil
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(((days * 86_400) + h * 3600 + mi * 60 + se) * 1000).ok()
}

// ── 브리지 ──────────────────────────────────────────────────

/// 텔레그램에서 말한 참모의 대화 기록 — 턴 끝 답을 보내 준다
struct Watch {
    orch: Orch,
    path: PathBuf,
    offset: u64,
    buf: String,
    until: u64,
}

pub struct Bridge<E: Env> {
    pub api: Api,
    pub env: E,
    pub sh: Arc<Shared>,
    started: u64,
    missed: u32,
    /// 켤 때 쌓여 있던 묶음에서 짝이 누른 버튼 수
    missed_buttons: u32,
    watches: Vec<Watch>,
    /// 감시를 만든 짝 — 짝이 바뀌면(새 계정 확인) 옛 감시를 버린다(옛 대화 회신이 새 계정으로 가지 않게)
    watch_uid: Option<i64>,
    log_len: usize,
}

pub const BATCH_FULL: usize = 100;

impl<E: Env> Bridge<E> {
    pub fn new(api: Api, env: E, sh: Arc<Shared>, started: u64) -> Self {
        Bridge { api, env, sh, started, missed: 0, missed_buttons: 0, watches: Vec::new(), watch_uid: None, log_len: 0 }
    }

    fn uid(&self) -> Option<i64> {
        self.sh.state().user.map(|u| u.id)
    }

    /// 우리 글(도움말·안내) — 가리지 않는다
    fn say(&self, text: &str) {
        if let Some(u) = self.uid() {
            say_to(&self.api, u, text);
        }
    }

    /// 참모·세션이 쓴 글 — 가려서 나눠 보낸다
    fn relay(&self, text: &str) {
        let (data, home) = self.env.dirs();
        self.say(&mt::redact(text, &data, &home));
    }

    /// 켤 때 쌓여 있던 묶음(앱이 꺼져 있던 동안 온 것) — 짝이 누른 버튼은 카드 답으로 안 치고 다시 누르라고 한다.
    /// 버튼 누름엔 시각이 없어(callback 에 date 없음) 몇 시간 전 누른 것도 켜자마자 답이 되던 것을 글(Late)과 같은 규칙으로
    pub fn handle_backlog(&mut self, ups: &[Value], now: u64) -> i64 {
        self.handle(ups, now, true)
    }

    /// getUpdates 한 묶음 → 다음 offset
    pub fn handle_batch(&mut self, ups: &[Value], now: u64) -> i64 {
        self.handle(ups, now, false)
    }

    fn handle(&mut self, ups: &[Value], now: u64, backlog: bool) -> i64 {
        let mut last = None;
        for u in ups {
            let inc = m::parse(u);
            last = Some(inc.update_id());
            let act = {
                let st = self.sh.state();
                let mut g = self.sh.gate.lock().unwrap_or_else(|e| e.into_inner());
                m::decide(&st, &mut g, &inc, self.started, now)
            };
            match act {
                // 짝의 버튼만 Button·ButtonIgnore 가 된다 — 돌기만 멈추고 카드 버튼은 그대로 둬서 다시 누를 수 있게
                Act::Button { cb, .. } | Act::ButtonIgnore { cb } if backlog => {
                    self.missed_buttons += 1;
                    self.api.answer_button(&cb, crate::i18n::tr("앱이 꺼져 있던 동안 누른 버튼이에요 — 카드에서 다시 눌러 주세요", "Pressed while the Mac app was off — press it again on the card"));
                }
                act => self.act(act, now),
            }
        }
        // offset 은 묶음 끝에 한 번(모르는 사람 글 100개에 파일을 100번 쓰지 않게) — 묶음 처리 뒤에야 다음 묶음을 묻는다
        if let Some(id) = last {
            self.sh.update(|s| s.offset = s.offset.max(id + 1));
        }
        if (self.missed > 0 || self.missed_buttons > 0) && ups.len() < BATCH_FULL {
            let (n, k) = (self.missed, self.missed_buttons);
            self.missed = 0;
            self.missed_buttons = 0;
            self.say(&missed_text(n, k, crate::i18n::is_en()));
        }
        self.sh.state().offset
    }

    fn act(&mut self, act: Act, now: u64) {
        match act {
            Act::Ignore => {}
            Act::Late => self.missed += 1,
            // 코드를 낸 계정은 '대기' — 맥 설정에서 '이 계정이 맞아요'를 눌러야 연결된다(코드가 새도 몰래 못 넘어가게)
            Act::Paired(u) => {
                let id = u.id;
                self.sh.update(|s| s.pending = Some(u));
                log("짝짓기 대기");
                say_to(&self.api, id, crate::i18n::tr("맥 앱 설정에서 '이 계정이 맞아요'를 누르면 연결돼요", "Press 'This is my account' in the Mac app settings to finish"));
            }
            Act::Reply(t) => self.say(&t),
            Act::Lock => {
                self.say(crate::i18n::tr("잠갔어요 — 맥 앱 설정에서 다시 연결해야 받을 수 있어요", "Locked — reconnect in the Mac app settings"));
                self.sh.gate.lock().unwrap_or_else(|e| e.into_inner()).cancel();
                self.sh.update(|s| {
                    s.user = None;
                    s.pending = None;
                });
                self.watches.clear();
                log("잠금(/잠금)");
            }
            Act::List => match self.env.orchs() {
                Ok(list) => {
                    let st = self.sh.state();
                    let cur = m::default_orch(&list, st.last_orch.as_deref(), &self.env.assistant()).cloned();
                    self.say(&m::list_text(&list, cur.as_ref()));
                }
                Err(_) => self.say(crate::i18n::tr("참모 목록을 못 읽었어요", "Could not read the assistant list")),
            },
            Act::Choose(key) => match self.env.orchs().ok().and_then(|l| m::find_orch(&l, &key).cloned()) {
                Some(o) => {
                    self.sh.update(|s| s.last_orch = Some(o.base().to_string()));
                    self.say(&format!("{}{}", crate::i18n::tr("이제 여기로 보내요: ", "Now sending to: "), o.name));
                }
                None => self.say(&unknown(&key)),
            },
            Act::Send { to, text } => self.send(to, &text, now),
            Act::Button { cb, msg, card, pick } => self.button(&cb, msg, &card, &pick),
            Act::ButtonIgnore { cb } => self.api.answer_button(&cb, ""),
        }
    }

    fn send(&mut self, to: Option<String>, text: &str, now: u64) {
        let list = match self.env.orchs() {
            Ok(l) => l,
            Err(_) => return self.say(crate::i18n::tr("참모 목록을 못 읽었어요 — 못 보냈어요", "Could not read the assistant list — not sent")),
        };
        let st = self.sh.state();
        let target = match &to {
            Some(k) => match m::find_orch(&list, k) {
                Some(o) => o.clone(),
                None => return self.say(&unknown(k)),
            },
            None => match m::default_orch(&list, st.last_orch.as_deref(), &self.env.assistant()) {
                Some(o) => o.clone(),
                None => return self.say(&m::list_text(&[], None)),
            },
        };
        self.sync_watch_uid();
        // 치기 전에 대화 기록 끝을 잡아 둔다 — 친 뒤 답을 놓치지 않게. 이미 보는 중이면 읽던 자리 그대로
        let path = self.env.transcript(&target.session);
        if let Some(p) = path.as_ref().filter(|_| !self.watches.iter().any(|w| w.orch.session == target.session)) {
            let offset = std::fs::metadata(p).map(|x| x.len()).unwrap_or(0);
            self.watches.push(Watch { orch: target.clone(), path: p.clone(), offset, buf: String::new(), until: 0 });
        }
        match self.env.type_to(&target, &m::typed(text)) {
            Ok(()) => {
                self.sh.update(|s| s.last_orch = Some(target.base().to_string()));
                if let Some(w) = self.watches.iter_mut().find(|w| w.orch.session == target.session) {
                    w.until = now + WATCH_MS;
                }
                if let Some(u) = self.uid() {
                    self.api.typing(u);
                }
            }
            Err(e) => {
                log(&format!("치기 실패({})", e.chars().take(60).collect::<String>()));
                self.watches.retain(|w| w.until != 0);
                self.say(crate::i18n::tr("못 보냈어요 — 참모가 꺼졌거나 바빠요. 잠시 뒤 다시 보내 주세요", "Not sent — the assistant is off or busy. Try again shortly"));
            }
        }
    }

    fn button(&mut self, cb: &str, msg: i64, card: &str, pick: &Pick) {
        let Some(uid) = self.uid() else { return };
        // 텔레그램으로 보낸 카드만 — id 만 맞춰 다른 카드에 답하지 못하게
        if !self.sh.state().cards.iter().any(|c| c == card) {
            self.api.answer_button(cb, crate::i18n::tr("이 카드는 앱·폰에서 답해 주세요", "Answer this card in the app or on the phone"));
            return;
        }
        let log_text = self.env.direct_log();
        let ask = match crate::direct::check(&log_text, card) {
            Ok(a) => a,
            Err(r) => {
                self.api.answer_button(cb, &crate::direct::refuse_text(r));
                self.api.close_card(uid, msg, "");
                return;
            }
        };
        // 버튼 글이 아니라 기록의 카드 종류로 다시 본다 — 결제·보내기·삭제·운영은 버튼으로 답하지 않는다
        if !m::buttons_ok(ask["kind"].as_str().unwrap_or("")) {
            self.api.answer_button(cb, crate::i18n::tr("이 카드는 앱·폰에서만 답할 수 있어요", "Answer this card in the app or on the phone"));
            self.api.close_card(uid, msg, "");
            log("버튼 거절(카드 종류)");
            return;
        }
        let label = match pick {
            Pick::Yes => ask["yes"].as_str().unwrap_or(""),
            Pick::No => ask["no"].as_str().unwrap_or(""),
            Pick::Option { option } => ask["options"].get(*option).and_then(Value::as_str).unwrap_or(""),
            Pick::Text { .. } => "",
        }
        .trim()
        .to_string();
        if label.is_empty() {
            self.api.answer_button(cb, crate::i18n::tr("없는 버튼이에요", "No such button")); // 위조한 y·n(그 카드에 없는 버튼)
            return;
        }
        match self.env.answer(card, pick, &format!("telegram:{uid}")) {
            Ok(()) => {
                self.api.answer_button(cb, crate::i18n::tr("보냈어요", "Sent"));
                self.api.close_card(uid, msg, &format!("{}{label}", crate::i18n::tr("답했어요 — ", "Answered — ")));
            }
            Err(e) => self.api.answer_button(cb, &e.chars().take(150).collect::<String>()),
        }
    }

    /// 참모 회신·새 카드 — 브리지 스레드가 2초마다
    /// 짝이 바뀌었으면 옛 감시를 버린다 → 지금 짝
    fn sync_watch_uid(&mut self) -> Option<i64> {
        let uid = self.uid();
        if uid != self.watch_uid {
            self.watches.clear();
            self.watch_uid = uid;
        }
        uid
    }

    pub fn tick(&mut self, now: u64) {
        if self.sync_watch_uid().is_none() {
            return;
        }
        self.replies(now);
        self.cards(now);
    }

    fn replies(&mut self, now: u64) {
        let mut out: Vec<String> = Vec::new();
        let env = &self.env;
        self.watches.retain_mut(|w| {
            if w.until != 0 && now > w.until {
                return false;
            }
            // 참모가 /clear 했으면 새 기록 처음부터 — 새 파일이 생기기 전엔 옛 기록을 계속 본다
            if let Some(sid) = env.session_now(&w.orch.id).filter(|s| *s != w.orch.session) {
                if let Some(p) = env.transcript(&sid).filter(|p| p.is_file()) {
                    log("회신 감시: 참모 대화가 바뀌어 새 기록으로");
                    w.orch.session = sid;
                    w.path = p;
                    w.offset = 0;
                    w.buf.clear();
                }
            }
            let Ok(meta) = std::fs::metadata(&w.path) else { return false };
            if meta.len() < w.offset {
                w.offset = meta.len(); // 기록이 새로 시작됐다 — 끝부터
                return true;
            }
            if meta.len() == w.offset {
                return true;
            }
            let chunk = read_from(&w.path, w.offset, READ_MAX);
            let s = mt::scan(&chunk, &mut w.buf);
            // 한 줄이 상한보다 길면(큰 도구 결과) 줄바꿈이 안 보여 영영 멈춘다 — 그 덩어리는 건너뛴다
            w.offset += if s.consumed == 0 && chunk.len() as u64 >= READ_MAX { READ_MAX } else { s.consumed as u64 };
            for r in s.replies {
                out.push(format!("{}:\n{r}", w.orch.base()));
            }
            !s.mac_prompt
        });
        for r in out {
            self.relay(&r);
        }
    }

    fn cards(&mut self, now: u64) {
        let text = self.env.direct_log();
        if text.len() == self.log_len {
            return;
        }
        self.log_len = text.len();
        let Some(uid) = self.uid() else { return };
        let seen = self.sh.state().cards;
        let (data, home) = self.env.dirs();
        for row in text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
            let Some(id) = row["id"].as_str().filter(|_| row["type"] == "ask").filter(|i| m::is_card_id(i)) else { continue };
            // 싼 거름부터 — check 는 기록 전체를 읽는다
            if seen.iter().any(|c| c == id) || row["ts"].as_str().and_then(iso_ms).is_none_or(|t| now.saturating_sub(t) > CARD_MAX_AGE_MS) {
                continue;
            }
            if crate::direct::check(&text, id).is_err() {
                continue;
            }
            let who = row["cwd"].as_str().and_then(|c| c.replace('\\', "/").trim_end_matches('/').rsplit('/').next().map(str::to_string)).filter(|s| !s.is_empty()).unwrap_or_else(|| row["from"].as_str().unwrap_or("").to_string());
            let (msg, kb) = mt::card_message(&row, &who);
            match self.api.send(uid, &mt::redact(&msg, &data, &home), kb.as_ref()) {
                Ok(_) | Err(TgErr::Api { .. }) => {
                    self.sh.update(|s| s.remember_card(id));
                    // '보임' 줄은 여기서 답할 수 있는 카드만 — 결제 등은 텔레그램에 떠도 앱·폰에 떠야 답할 수 있다(scripts/direct 가 '앱에 떴어'로 읽는다)
                    if m::buttons_ok(row["kind"].as_str().unwrap_or("")) {
                        self.env.shown(id);
                    }
                    log(&format!("카드 {} 보냄", row["kind"].as_str().unwrap_or("")));
                }
                Err(TgErr::Net(_)) => self.log_len = 0, // 다음에 다시
            }
        }
    }
}

/// 한 계정에 글(나눠서) — 우리 글이라 가리지 않는다
pub fn say_to(api: &Api, chat: i64, text: &str) {
    for part in mt::split(text) {
        if let Err(e) = api.send(chat, &part, None) {
            log(&format!("보내기 실패 {}", e.code()));
        }
    }
}

/// 맥에서 '이 계정이 맞아요' — 대기 계정을 짝으로. 옛 짝이 다른 계정이면 그쪽에 끊겼다고 알린다
pub fn confirm(sh: &Shared, api: &Api) -> Result<crate::messenger::User, String> {
    let st = sh.state();
    let new = st.pending.clone().ok_or_else(|| crate::i18n::tr("기다리는 계정이 없어요", "No account is waiting").to_string())?;
    sh.gate.lock().unwrap_or_else(|e| e.into_inner()).cancel();
    sh.update(|s| {
        s.user = Some(new.clone());
        s.pending = None;
    });
    log("짝 확정(맥)");
    if let Some(old) = st.user.filter(|o| o.id != new.id) {
        say_to(api, old.id, crate::i18n::tr("다른 계정이 연결돼서 이 연결은 끊겼어요", "Another account was linked — this link is closed"));
    }
    say_to(api, new.id, &format!("{}{}\n\n{}", crate::i18n::tr("연결됐어요 · ", "Connected · "), new.name, m::help()));
    Ok(new)
}

/// 꺼져 있던 동안 못 받은 것 한 줄 — n = 글, k = 누른 버튼
fn missed_text(n: u32, k: u32, en: bool) -> String {
    match (n, k, en) {
        (_, 0, false) => format!("그동안 {n}개 못 받았어요 — 맥 앱이 꺼져 있었어요. 필요하면 다시 보내 주세요"),
        (_, 0, true) => format!("{n} message(s) came in while the Mac app was off — they were not delivered. Send again if needed"),
        (0, _, false) => format!("그동안 누른 버튼 {k}개는 반영 안 했어요 — 맥 앱이 꺼져 있었어요. 카드에서 다시 눌러 주세요"),
        (0, _, true) => format!("{k} button press(es) while the Mac app was off were not applied — press again on the card"),
        (_, _, false) => format!("그동안 글 {n}개·버튼 {k}개를 못 받았어요 — 맥 앱이 꺼져 있었어요. 글은 다시 보내고 버튼은 카드에서 다시 눌러 주세요"),
        (_, _, true) => format!("{n} message(s) and {k} button press(es) came in while the Mac app was off — send again / press again on the card"),
    }
}

fn unknown(key: &str) -> String {
    let k: String = key.chars().take(30).collect();
    if crate::i18n::is_en() {
        format!("No assistant named {k} — /list shows them")
    } else {
        format!("{k} 참모가 없어요 — /참모 로 목록을 봐요")
    }
}

fn read_from(p: &Path, from: u64, max: u64) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(p) else { return String::new() };
    if f.seek(SeekFrom::Start(from)).is_err() {
        return String::new();
    }
    let mut buf = Vec::new();
    let _ = f.take(max).read_to_end(&mut buf);
    // 끝이 글자 중간에서 잘렸을 수 있다 — 마지막 줄바꿈까지만 쓰니 잘린 글자는 다음에 다시 읽는다
    String::from_utf8_lossy(&buf).into_owned()
}

#[cfg(test)]
#[path = "messenger_run_tests.rs"]
pub(crate) mod tests;
