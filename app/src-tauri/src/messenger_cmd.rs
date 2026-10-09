//! 메신저 스레드와 설정 명령 — 롱폴링 스레드(밖으로만 묻는다, 문을 안 연다)가 받은 묶음을 브리지 스레드에 넘기고,
//! 브리지가 처리를 끝낸 offset 을 돌려받은 뒤에야 다음 묶음을 묻는다(앱이 죽어도 처리 안 한 글을 '받았다'고 안 넘긴다).
//! 설정 화면 명령은 메인 창에서만(짝짓기 코드 = 이 맥 조종 열쇠라)
use crate::accounts_store::Secret;
use crate::direct::Pick;
use crate::messenger::Orch;
use crate::messenger_run::{self as run, Bridge, Env, Shared};
use crate::messenger_tg::{base_from_env, token_ok, Api, TgErr, POLL_SECS};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// ── 맥 쪽 일(진짜) ──────────────────────────────────────────

pub struct MacEnv;

impl Env for MacEnv {
    fn orchs(&self) -> Result<Vec<Orch>, String> {
        let out = crate::platform::run_capped(crate::platform::command(crate::claude::claude_bin()).args(["agents", "--json"]), Duration::from_secs(10)).map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err("claude agents".into());
        }
        let hq = crate::config::hq_dir(&crate::config::home(), &crate::config::current(), |k| std::env::var(k).ok());
        Ok(run::orchs_from(&String::from_utf8_lossy(&out.stdout), &hq, &crate::config::assistant_name()))
    }
    fn type_to(&self, o: &Orch, text: &str) -> Result<(), String> {
        // 메신저에서 보냈다는 표시 — 훅(scripts/voice-hint)이 읽어 참모에게 '사용자는 지금 텔레그램'을 알린다. 글 내용은 안 남긴다
        let at = now_ms();
        let _ = crate::mobile_pair::write_private(&crate::config::data_file("messenger-sent.json"), &serde_json::json!({ "id": o.id, "at": at, "channel": "telegram" }).to_string());
        crate::claude::type_text_tagged(&o.id, text, "messenger-send")
    }
    fn answer(&self, card: &str, pick: &Pick, by: &str) -> Result<(), String> {
        crate::direct::answer(card, pick, by)
    }
    fn direct_log(&self) -> String {
        crate::direct::direct_log()
    }
    fn shown(&self, card: &str) {
        let _ = crate::direct::mark_shown(card, "telegram");
    }
    fn transcript(&self, session: &str) -> Option<PathBuf> {
        crate::claude::transcript_path(session)
    }
    fn session_now(&self, id: &str) -> Option<String> {
        run::session_in_live(&std::fs::read_to_string(crate::config::data_file("live.json")).ok()?, id)
    }
    fn assistant(&self) -> String {
        crate::config::assistant_name()
    }
    fn dirs(&self) -> (String, String) {
        (crate::config::data_dir().to_string_lossy().into_owned(), crate::config::home())
    }
}

// ── 스레드 ──────────────────────────────────────────────────

pub struct Running {
    stop: Arc<AtomicBool>,
    threads: Vec<std::thread::JoinHandle<()>>,
}

impl Running {
    pub fn stop_join(self) {
        self.stop.store(true, Ordering::SeqCst);
        for t in self.threads {
            let _ = t.join();
        }
    }
}

/// 멈춤 깃발을 보며 조금씩 잔다
fn nap(stop: &AtomicBool, secs: u64) {
    for _ in 0..secs {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}

/// 거절·망 실패 → (화면 글, 쉴 초, 그만둘까)
pub fn on_error(e: &TgErr, backoff: u64) -> (String, u64, bool) {
    let tr = crate::i18n::tr;
    match e {
        TgErr::Api { code: 401 | 404, .. } => (tr("토큰이 맞지 않아요 — BotFather 에서 토큰을 다시 복사해 넣어 주세요", "The token is not valid — copy it again from BotFather").into(), 0, true),
        TgErr::Api { code: 409, .. } => (tr("다른 곳(다른 Chammo·웹훅)에서 이 봇을 받고 있어요 — 한 곳에서만 켜 주세요", "Another place (another Chammo or a webhook) is reading this bot — keep it on in one place only").into(), 30, false),
        TgErr::Api { code: 429, retry_after, .. } => (tr("텔레그램이 잠시 쉬래요", "Telegram asked to slow down").into(), retry_after.unwrap_or(5).clamp(1, 60), false),
        _ => (tr("텔레그램에 못 닿아요 — 인터넷을 확인해 주세요", "Can't reach Telegram — check the internet").into(), backoff, false),
    }
}

/// 두 스레드를 띄운다 — 시험은 가짜 서버 주소·가짜 Env 로
pub fn spawn_loops<E: Env + Send + 'static>(sh: Arc<Shared>, base: String, token: Secret, env: E) -> Running {
    let stop = Arc::new(AtomicBool::new(false));
    // (묶음, 켤 때 쌓여 있던 것인가)
    let (tx, rx) = mpsc::channel::<(Vec<Value>, bool)>();
    let (ack_tx, ack_rx) = mpsc::channel::<i64>();
    sh.set_status(|s| {
        s.running = true;
        s.error = None;
    });
    let poll = {
        let (sh, stop, api) = (sh.clone(), stop.clone(), Api::new(base.clone(), token.clone()));
        std::thread::spawn(move || {
            let mut offset = sh.state().offset;
            let mut backoff = 2;
            // 켜자마자는 기다림 없이(timeout 0) 쌓여 있던 것부터 비운다 — 그 묶음의 버튼은 꺼져 있던 동안 누른 것(브리지 handle_backlog)
            let mut backlog = true;
            while !stop.load(Ordering::SeqCst) {
                let asked = std::time::Instant::now();
                match api.get_updates(offset, if backlog { 0 } else { POLL_SECS }) {
                    Ok(list) => {
                        backoff = 2;
                        let was_backlog = backlog;
                        if list.len() < run::BATCH_FULL {
                            backlog = false; // 다 비웠다 — 다음부터 롱폴링
                        }
                        // 빈 답이 바로 오면(롱폴링을 안 하는 서버) 쉬지 않고 묻게 된다 — 1초는 쉰다
                        if list.is_empty() && !was_backlog && asked.elapsed() < Duration::from_secs(1) {
                            nap(&stop, 1);
                        }
                        sh.set_status(|s| {
                            s.error = None;
                            s.last_ok = now_ms();
                        });
                        if list.is_empty() {
                            continue;
                        }
                        if tx.send((list, was_backlog)).is_err() {
                            break;
                        }
                        match ack_rx.recv() {
                            Ok(o) => offset = o,
                            Err(_) => break,
                        }
                    }
                    Err(e) => {
                        let (msg, wait, quit) = on_error(&e, backoff);
                        run::log(&format!("받기 실패 {}", e.code()));
                        sh.set_status(|s| s.error = Some(msg));
                        if quit {
                            stop.store(true, Ordering::SeqCst);
                            break;
                        }
                        backoff = (backoff * 2).min(60);
                        nap(&stop, wait);
                    }
                }
            }
            sh.set_status(|s| s.running = false);
        })
    };
    let bridge = {
        let (sh, stop) = (sh.clone(), stop.clone());
        std::thread::spawn(move || {
            let mut b = Bridge::new(Api::new(base, token), env, sh, now_ms());
            while !stop.load(Ordering::SeqCst) {
                match rx.recv_timeout(Duration::from_secs(2)) {
                    Ok((batch, backlog)) => {
                        let next = if backlog { b.handle_backlog(&batch, now_ms()) } else { b.handle_batch(&batch, now_ms()) };
                        let _ = ack_tx.send(next);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
                b.tick(now_ms());
            }
        })
    };
    Running { stop, threads: vec![poll, bridge] }
}

static SHARED: OnceLock<Arc<Shared>> = OnceLock::new();
static RUN: Mutex<Option<Running>> = Mutex::new(None);
/// 켜기·끄기·토큰 바꾸기는 한 번에 하나 — 둘이 겹치면 먼저 띄운 스레드가 RUN 에서 덮여 '끄기'로 안 꺼졌다(2026-10-08 리뷰 M1)
static LIFE: Mutex<()> = Mutex::new(());

fn life() -> std::sync::MutexGuard<'static, ()> {
    LIFE.lock().unwrap_or_else(|e| e.into_inner())
}
/// 토큰이 있나(키체인을 화면 새로 고칠 때마다 안 읽게)
static HAS_TOKEN: AtomicBool = AtomicBool::new(false);

pub fn shared() -> Arc<Shared> {
    SHARED.get_or_init(|| Arc::new(Shared::open(crate::config::data_dir()))).clone()
}

/// LIFE 를 쥔 채로만 부른다
fn stop(_life: &std::sync::MutexGuard<'static, ()>) {
    let r = RUN.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(r) = r {
        r.stop_join();
    }
}

/// 다시 띄우기 — 옛 스레드가 끝난 뒤에(같은 토큰으로 둘이 받으면 409). LIFE 를 쥔 채로만 부른다
fn restart(life: &std::sync::MutexGuard<'static, ()>, token: Secret) {
    stop(life);
    let base = base_from_env(std::env::var("CHAMMO_TELEGRAM_API").ok().as_deref());
    let r = spawn_loops(shared(), base, token, MacEnv);
    *RUN.lock().unwrap_or_else(|e| e.into_inner()) = Some(r);
}

fn running() -> bool {
    RUN.lock().unwrap_or_else(|e| e.into_inner()).is_some() && shared().status.lock().unwrap_or_else(|e| e.into_inner()).running
}

/// 앱이 뜰 때 — 켜 둔 상태고 토큰이 있으면(키체인 읽기는 따로 도는 스레드에서)
pub fn boot() {
    std::thread::spawn(|| {
        let life = life();
        let sh = shared();
        let token = run::token_get(&sh.dir);
        HAS_TOKEN.store(token.is_some(), Ordering::SeqCst);
        let st = sh.state(); // 자물쇠 안에서 다시 본다 — 그사이 사용자가 끄기를 눌렀을 수 있다
        match (st.on, token) {
            (true, Some(t)) => restart(&life, t),
            (true, None) if st.bot.is_some() => sh.set_status(|s| s.error = Some(crate::i18n::tr("키체인에서 봇 토큰을 못 읽었어요 — 토큰을 다시 넣어 주세요", "Couldn't read the bot token from the keychain — add it again").into())),
            _ => {}
        }
    });
}

/// 앱이 꺼질 때 — 깃발만(롱폴링이 끝나길 기다리지 않는다)
pub fn shutdown() {
    if let Some(r) = RUN.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        r.stop.store(true, Ordering::SeqCst);
    }
}

// ── 설정 명령 ───────────────────────────────────────────────

/// 화면에 보일 계정 — 이름은 아무나 바꿀 수 있어 @이름·숫자 id 를 같이
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub name: String,
    pub username: Option<String>,
    pub id: i64,
}

impl From<crate::messenger::User> for Account {
    fn from(u: crate::messenger::User) -> Self {
        Account { name: u.name, username: u.username, id: u.id }
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MessengerStatus {
    pub has_token: bool,
    pub bot: Option<String>,
    pub on: bool,
    /// 짝지은 텔레그램 계정
    pub user: Option<Account>,
    /// 짝짓기 코드를 낸 계정 — 맥에서 확인을 기다린다
    pub pending: Option<Account>,
    pub running: bool,
    pub error: Option<String>,
    /// 짝짓기 코드가 살아 있다
    pub waiting: bool,
    /// 토큰을 키체인이 아니라 데이터 폴더 파일에 둔다(윈도우)
    pub token_file: bool,
}

fn status() -> MessengerStatus {
    let sh = shared();
    let st = sh.state();
    let rs = sh.status.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let waiting = sh.gate.lock().unwrap_or_else(|e| e.into_inner()).waiting(now_ms());
    MessengerStatus {
        has_token: HAS_TOKEN.load(Ordering::SeqCst),
        bot: st.bot,
        on: st.on,
        user: st.user.map(Account::from),
        pending: st.pending.map(Account::from),
        running: running(),
        error: rs.error,
        waiting,
        token_file: run::token_in_file(),
    }
}

fn main_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if w.label() == "main" { Ok(()) } else { Err("main window only".into()) }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn messenger_status(window: tauri::WebviewWindow) -> Result<MessengerStatus, String> {
    main_only(&window)?;
    Ok(status())
}

/// 봇 토큰 확인 — getMe 로 봇인지·이름, 다른 서비스가 웹훅으로 쓰는 봇이면 거절(웹훅을 내리면 그 서비스가 멈추고 그쪽 글을 우리가 받는다, 리뷰 M4)
pub fn check_bot(api: &Api) -> Result<String, String> {
    let tr = crate::i18n::tr;
    let me = api.get_me().map_err(|e| match e {
        TgErr::Api { code: 401 | 404, .. } => tr("텔레그램이 이 토큰을 모른대요 — 다시 복사해 주세요", "Telegram doesn't know this token — copy it again").to_string(),
        e => format!("{} ({})", tr("텔레그램에 못 닿았어요", "Couldn't reach Telegram"), e.code()),
    })?;
    let name = me["username"].as_str().filter(|_| me["is_bot"] == true).filter(|n| !n.is_empty() && n.len() <= 64 && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')).ok_or_else(|| tr("봇 토큰이 아니에요", "Not a bot token").to_string())?;
    match api.webhook_url() {
        Ok(u) if !u.is_empty() => Err(tr("이 봇은 다른 곳(웹훅)에서 쓰고 있어요 — BotFather 에서 Chammo 전용 새 봇을 만들어 주세요", "This bot is in use elsewhere (webhook) — create a new bot just for Chammo in BotFather").into()),
        Ok(_) => Ok(name.to_string()),
        Err(e) => Err(format!("{} ({})", tr("텔레그램에 못 닿았어요", "Couldn't reach Telegram"), e.code())),
    }
}

/// 토큰 넣기 — 모양 → check_bot → 옛 브리지 멈춤 → 키체인 → 켜기. 봇이 바뀌면 짝·카드 기억을 비운다
#[tauri::command]
pub async fn messenger_set_token(window: tauri::WebviewWindow, token: String) -> Result<MessengerStatus, String> {
    main_only(&window)?;
    blocking(move || {
        let tr = crate::i18n::tr;
        let t = token.trim().to_string();
        if !token_ok(&t) {
            return Err(tr("토큰 모양이 아니에요 — BotFather 가 준 123456789:AA… 전체를 붙여 넣어 주세요", "That doesn't look like a bot token — paste the whole 123456789:AA… from BotFather").into());
        }
        let secret = Secret::new(t);
        let name = check_bot(&Api::from_env(secret.clone()))?;
        let life = life();
        stop(&life); // 옛 봇 브리지를 먼저 멈춘다 — 상태를 비운 뒤 옛 브리지가 옛 offset·짝을 써 넣지 않게
        let sh = shared();
        run::token_set(&sh.dir, &secret)?;
        HAS_TOKEN.store(true, Ordering::SeqCst);
        sh.update(|s| {
            if s.bot.as_deref() != Some(name.as_str()) {
                *s = crate::messenger::State::default();
            }
            s.bot = Some(name.clone());
            s.on = true;
        });
        run::log("토큰 넣음");
        restart(&life, secret);
        Ok(status())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairLink {
    pub link: String,
    pub qr_svg: Option<String>,
    pub expires: u64,
}

/// 짝짓기 딥링크(10분·한 번) — 받는 스레드가 꺼져 있으면 켠다
#[tauri::command]
pub async fn messenger_pair_new(window: tauri::WebviewWindow) -> Result<PairLink, String> {
    main_only(&window)?;
    blocking(|| {
        let sh = shared();
        let bot = sh.state().bot.ok_or_else(|| crate::i18n::tr("먼저 봇 토큰을 넣어 주세요", "Add the bot token first").to_string())?;
        let life = life();
        if !running() {
            let t = run::token_get(&sh.dir).ok_or_else(|| crate::i18n::tr("키체인에서 토큰을 못 읽었어요 — 다시 넣어 주세요", "Couldn't read the token from the keychain — add it again").to_string())?;
            sh.update(|s| s.on = true);
            restart(&life, t);
        }
        drop(life);
        sh.update(|s| s.pending = None); // 새 코드 = 지난 대기 계정은 버린다
        let now = now_ms();
        let code = sh.gate.lock().unwrap_or_else(|e| e.into_inner()).issue(now)?;
        let link = format!("https://t.me/{bot}?start={code}");
        Ok(PairLink { qr_svg: crate::mobile::qr_svg(&link), link, expires: now + crate::messenger::CODE_TTL_MS })
    })
    .await
}

#[tauri::command]
pub fn messenger_pair_cancel(window: tauri::WebviewWindow) -> Result<(), String> {
    main_only(&window)?;
    shared().gate.lock().unwrap_or_else(|e| e.into_inner()).cancel();
    Ok(())
}

/// 맥에서 '이 계정이 맞아요' — 대기 계정을 짝으로(옛 짝은 끊고 알린다)
#[tauri::command]
pub async fn messenger_confirm(window: tauri::WebviewWindow) -> Result<MessengerStatus, String> {
    main_only(&window)?;
    blocking(|| {
        let sh = shared();
        let t = run::token_get(&sh.dir).ok_or_else(|| crate::i18n::tr("키체인에서 토큰을 못 읽었어요 — 다시 넣어 주세요", "Couldn't read the token from the keychain — add it again").to_string())?;
        run::confirm(&sh, &Api::from_env(t))?;
        Ok(status())
    })
    .await
}

/// 대기 계정 거절 — 짝은 그대로
#[tauri::command]
pub fn messenger_reject(window: tauri::WebviewWindow) -> Result<MessengerStatus, String> {
    main_only(&window)?;
    shared().update(|s| s.pending = None);
    run::log("대기 계정 거절(맥)");
    Ok(status())
}

/// 짝 끊기 — 그 계정에 한 줄 알리고 뺀다
#[tauri::command]
pub async fn messenger_unpair(window: tauri::WebviewWindow) -> Result<MessengerStatus, String> {
    main_only(&window)?;
    blocking(|| {
        let sh = shared();
        if let (Some(u), Some(t)) = (sh.state().user, run::token_get(&sh.dir)) {
            let _ = Api::from_env(t).send(u.id, crate::i18n::tr("맥에서 연결을 끊었어요", "Disconnected from the Mac"), None);
        }
        sh.gate.lock().unwrap_or_else(|e| e.into_inner()).cancel();
        sh.update(|s| {
            s.user = None;
            s.pending = None;
        });
        run::log("짝 끊음(설정)");
        Ok(status())
    })
    .await
}

#[tauri::command]
pub async fn messenger_set_on(window: tauri::WebviewWindow, on: bool) -> Result<MessengerStatus, String> {
    main_only(&window)?;
    blocking(move || {
        let sh = shared();
        let life = life();
        sh.update(|s| s.on = on);
        if !on {
            stop(&life);
            return Ok(status());
        }
        let t = run::token_get(&sh.dir).ok_or_else(|| crate::i18n::tr("키체인에서 토큰을 못 읽었어요 — 다시 넣어 주세요", "Couldn't read the token from the keychain — add it again").to_string())?;
        restart(&life, t);
        Ok(status())
    })
    .await
}

/// 토큰까지 지우기 — 키체인 칸·상태 파일을 비운다(봇은 BotFather 에 그대로)
#[tauri::command]
pub async fn messenger_forget(window: tauri::WebviewWindow) -> Result<MessengerStatus, String> {
    main_only(&window)?;
    blocking(|| {
        let life = life();
        stop(&life);
        let sh = shared();
        run::token_remove(&sh.dir)?;
        HAS_TOKEN.store(false, Ordering::SeqCst);
        sh.gate.lock().unwrap_or_else(|e| e.into_inner()).cancel();
        sh.update(|s| *s = crate::messenger::State::default());
        sh.set_status(|s| s.error = None);
        run::log("토큰 지움");
        Ok(status())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messenger_run::tests::{fake_tg, FakeMac, TOKEN};

    #[test]
    fn 스레드_둘이_받고_처리하고_offset_을_넘긴다() {
        let (base, tg) = fake_tg();
        let dir = std::env::temp_dir().join(format!("chammo-msgr-loop-{}", crate::mobile_pair::random_hex(4).unwrap()));
        std::fs::create_dir_all(&dir).unwrap();
        let sh = Arc::new(Shared::open(&dir));
        sh.update(|s| s.user = Some(crate::messenger::User { id: 7001, name: "길동".into(), at: 0, username: None }));
        let date = now_ms() / 1000 + 5;
        tg.lock().unwrap().updates = vec![serde_json::json!({ "update_id": 40, "message": { "date": date, "chat": { "id": 7001, "type": "private" }, "from": { "id": 7001 }, "text": "/참모" } })];
        let mac = FakeMac { orchs: vec![Orch { id: "aaaaaaaa".into(), session: "s".into(), name: "참모".into() }], ..Default::default() };
        let r = spawn_loops(sh.clone(), base, Secret::new(TOKEN), mac);
        let until = std::time::Instant::now() + Duration::from_secs(10);
        while sh.state().offset != 41 && std::time::Instant::now() < until {
            std::thread::sleep(Duration::from_millis(100));
        }
        assert_eq!(sh.state().offset, 41);
        // 다음 getUpdates 는 offset 41 로(받은 걸 확인) — 같은 글을 두 번 처리하지 않는다
        let until = std::time::Instant::now() + Duration::from_secs(10);
        while !tg.lock().unwrap().calls.iter().any(|(m, b)| m == "getUpdates" && b["offset"] == 41) && std::time::Instant::now() < until {
            std::thread::sleep(Duration::from_millis(100));
        }
        let calls = tg.lock().unwrap().calls.clone();
        assert!(calls.iter().any(|(m, b)| m == "sendMessage" && b["text"].as_str().unwrap_or("").contains("참모 1명")));
        assert_eq!(calls.iter().filter(|(m, b)| m == "sendMessage" && b["text"].as_str().unwrap_or("").contains("참모 1명")).count(), 1);
        r.stop_join();
        assert!(!sh.status.lock().unwrap().running);
    }

    #[test]
    fn 켤_때_쌓여_있던_버튼은_반영_안_하고_그_뒤_버튼은_반영() {
        let (base, tg) = fake_tg();
        let dir = std::env::temp_dir().join(format!("chammo-msgr-backlog-{}", crate::mobile_pair::random_hex(4).unwrap()));
        std::fs::create_dir_all(&dir).unwrap();
        let sh = Arc::new(Shared::open(&dir));
        sh.update(|s| {
            s.user = Some(crate::messenger::User { id: 7001, name: "길동".into(), at: 0, username: None });
            s.remember_card("aaaa0002");
        });
        let btn = |id: i64| serde_json::json!({ "update_id": id, "callback_query": { "id": format!("cb{id}"), "from": { "id": 7001 }, "message": { "message_id": 77, "chat": { "id": 7001 } }, "data": "c:aaaa0002:y" } });
        tg.lock().unwrap().updates = vec![btn(50)]; // 앱이 꺼져 있던 동안 누름
        let ts = chrono_like_now();
        let mac = FakeMac { log: Mutex::new(format!("{}\n", serde_json::json!({ "ts": ts, "type": "ask", "id": "aaaa0002", "from": "c1c2c3c4", "kind": "other", "q": "진행할까?", "yes": "승인", "no": "거절" }))), ..Default::default() };
        let r = spawn_loops(sh.clone(), base, Secret::new(TOKEN), mac);
        let wait = |f: &dyn Fn() -> bool| {
            let until = std::time::Instant::now() + Duration::from_secs(10);
            while !f() && std::time::Instant::now() < until {
                std::thread::sleep(Duration::from_millis(50));
            }
            f()
        };
        assert!(wait(&|| sh.state().offset == 51));
        let calls = tg.lock().unwrap().calls.clone();
        assert_eq!(calls.iter().find(|(m, _)| m == "getUpdates").unwrap().1["timeout"], 0, "켤 때는 쌓인 것부터 기다림 없이 비운다");
        assert!(calls.iter().any(|(m, b)| m == "answerCallbackQuery" && b["text"].as_str().unwrap_or("").contains("다시 눌러")));
        assert!(!calls.iter().any(|(m, _)| m == "editMessageReplyMarkup"), "쌓여 있던 버튼으로 카드를 닫지 않는다");
        // 켠 뒤 누른 버튼 → 카드 답(카드 닫기)
        tg.lock().unwrap().updates.push(btn(51));
        assert!(wait(&|| tg.lock().unwrap().calls.iter().any(|(m, _)| m == "editMessageReplyMarkup")));
        r.stop_join();
    }

    /// 지금 시각 ISO(UTC) — 카드가 24시간 안이어야 버튼이 산다
    fn chrono_like_now() -> String {
        let s = now_ms() / 1000;
        let (d, t) = ((s / 86_400) as i64, s % 86_400);
        // civil_from_days(Howard Hinnant)
        let z = d + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = yoe + era * 400 + i64::from(m <= 2);
        format!("{y:04}-{m:02}-{day:02}T{:02}:{:02}:{:02}Z", t / 3600, t / 60 % 60, t % 60)
    }

    #[test]
    fn 웹훅이_걸린_봇은_거절() {
        let (base, tg) = fake_tg();
        let api = Api::new(base, Secret::new(TOKEN));
        assert_eq!(check_bot(&api).unwrap(), "chammo_test_bot");
        tg.lock().unwrap().webhook = Some("https://shop.example.com/tg".into());
        assert!(check_bot(&api).unwrap_err().contains("웹훅"));
        assert!(!tg.lock().unwrap().calls.iter().any(|(m, _)| m == "deleteWebhook"), "남의 웹훅은 안 내린다");
    }

    #[test]
    fn 토큰_틀림은_멈추고_409는_기다린다() {
        let tok = TgErr::Api { code: 401, desc: String::new(), retry_after: None };
        assert!(on_error(&tok, 2).2);
        let busy = TgErr::Api { code: 409, desc: String::new(), retry_after: None };
        assert_eq!((on_error(&busy, 2).1, on_error(&busy, 2).2), (30, false));
        let slow = TgErr::Api { code: 429, desc: String::new(), retry_after: Some(500) };
        assert_eq!(on_error(&slow, 2).1, 60);
        assert_eq!(on_error(&TgErr::Net("x".into()), 16).1, 16);
    }
}
