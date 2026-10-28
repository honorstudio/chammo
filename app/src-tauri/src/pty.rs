//! 명령 하나를 pty 로 띄우고, 출력은 Channel 로 웹뷰에 흘리고, 입력·크기 변경을 받는다.
//! spike(2026-09-25)에서 6창 동시 지연 p95 31ms 로 검증한 구조 그대로.

use portable_pty::{native_pty_system, Child, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

type SharedWriter = Arc<Mutex<Box<dyn Write + Send>>>;

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: SharedWriter,
    child: Box<dyn Child + Send + Sync>,
    /// 연 웹뷰(창 이름) — 그 창이 다시 읽히면(location.reload) 그 창 것만 닫는다
    owner: String,
}

/// 열린 터미널 보기 하나 — 어느 세션에 붙었나·쓰기·지금까지 받은 눈에 보이는 글자 수(Visible)
struct OpenView {
    pty: u32,
    session: String,
    writer: SharedWriter,
    visible: Arc<AtomicUsize>,
    /// 읽기가 끝났다(attach 가 끝남) — 더는 안 고른다
    gone: Arc<AtomicBool>,
    /// 쫓겨남 문구(KICKED)를 봤나 — 문구 뒤 글자 수·때. 문구 뒤에도 화면이 계속 오거나 attach 가 안 끝나면 붙어 있는 보기
    kick: Arc<Kick>,
    /// 그 보기의 claude attach 프로세스 — 진짜 쫓겨나면 문구 0.5초 뒤 끝난다(윈도우 실측, EOF 는 40초 넘게 안 온다)
    pid: Option<u32>,
    /// 이 보기 화면을 Rust 도 그려 둔다(vt100) — 윈도우는 열린 보기로 칠 때 입력칸에 사람 글이 있나 보려고(②-1),
    /// 맥은 채팅 탭이 친 글이 입력칸에 다 보이면 바로 Enter 하려고(2026-10-28 chat-speed)
    screen: Option<Arc<Mutex<vt100::Parser>>>,
}

/// 열린 터미널 보기가 어느 세션에 붙어 있나 — 윈도우는 claude attach 가 세션당 한 창만 붙게 해서,
/// 키를 넣으려고 새로 붙으면 터미널 보기가 "Session opened in another window" 로 쫓겨났다(2026-10-01). 열린 것에 바로 쓴다
static OPEN: Mutex<Vec<OpenView>> = Mutex::new(Vec::new());

/// 눈에 보이는 글자가 이만큼은 와야 세션에 붙은 보기로 친다 — 붙은 claude 화면은 입력칸 테두리만으로 수백 바이트다.
/// 윈도우 가짜 콘솔이 첫 "커서 어디?"(ESC[6n)에 답을 못 받으면 자식을 영영 안 띄우는데, 그런 보기에 쓰면
/// 오류 없이 들어가고 세션엔 안 닿았다(2026-10-05 윈도우 QA, 폰에서 보낸 글이 사라짐). 바이트로 세면 답을 받은 콘솔의
/// 빈 화면 지우기(ESC[K 줄들, 2KB 가까이)만으로 넘어서 attach 가 바로 죽은 보기도 붙은 걸로 보인다 — 글자만 센다
const VIEW_READY_VISIBLE: usize = 200;

/// 같은 세션에 다른 창이 붙으면 앞 창 claude attach 가 찍고 끝나는 말(공백 뺀 글자) — 윈도우는 세션당 한 창(2026-10-09 윈도우 실기기 실측)
const KICKED: &[u8] = b"Sessionopenedinanotherwindow";
/// 쫓겨남 문구 뒤에 이만큼 글자가 더 그려지면 쫓겨난 게 아니다 — 세션이 그 문구를 찍거나(이 저장소를 grep) 화면에 보이기만 한 것.
/// 진짜 쫓겨난 attach 는 문구를 찍고 끝난다. 예전엔 문구만 봐도 영영 쫓겨남이라 다음 전달이 새로 붙어 진짜로 그 칸을 쫓아냈다(2026-10-21 리뷰 ①-7)
const KICK_REVIVE: usize = 200;
/// 쫓겨남 문구 뒤 이만큼 지나도 attach 가 살아 있으면 쫓겨난 게 아니다(문구를 찍고 쉬는 세션 — 글자 규칙으론 못 가른다, 2026-10-22 코드 리뷰)
const KICK_GRACE: std::time::Duration = std::time::Duration::from_secs(3);

/// 쫓겨남 문구 표시 — chars: 0 = 못 봄, n = 본 뒤 n-1 글자가 더 그려짐. at = 본 때
#[derive(Default)]
struct Kick {
    chars: AtomicUsize,
    at: Mutex<Option<std::time::Instant>>,
}

/// 터미널 출력에서 이스케이프(CSI·OSC 등)와 공백·제어 문자를 뺀 바이트 수 — 조각 경계에 걸친 이스케이프도 이어서 건너뛴다
#[derive(Default)]
struct Visible {
    st: u8, // 0 글자, 1 ESC 뒤, 2 CSI 안, 3 OSC 등 문자열 안, 4 문자열 안 ESC 뒤
    /// 마지막 글자들(KICKED 길이까지) — 쫓겨남 문구가 색 코드·조각 경계에 걸쳐도 알아보게
    tail: Vec<u8>,
}

impl Visible {
    #[cfg(test)]
    fn count(&mut self, b: &[u8]) -> usize {
        self.scan(b).0
    }

    /// (눈에 보이는 글자 수, 쫓겨남 문구가 이 조각에서 끝났나)
    fn scan(&mut self, b: &[u8]) -> (usize, bool) {
        let mut n = 0;
        let mut kicked = false;
        for &c in b {
            self.st = match (self.st, c) {
                (_, 0x1b) if self.st != 3 && self.st != 4 => 1,
                (0, c) => {
                    if c > b' ' && c != 0x7f {
                        n += 1;
                        if self.tail.len() == KICKED.len() {
                            self.tail.remove(0);
                        }
                        self.tail.push(c);
                        kicked |= self.tail == KICKED;
                    }
                    0
                }
                (1, b'[') => 2,
                (1, b']' | b'P' | b'_' | b'^' | b'X') => 3,
                (1, _) => 0,
                (2, 0x40..=0x7e) => 0,
                (2, _) => 2,
                (3, 0x07) => 0,
                (3, 0x1b) | (4, 0x1b) => 4,
                (3, _) => 3,
                (4, b'\\') => 0,
                (4, _) => 3,
                (_, _) => 0,
            };
        }
        (n, kicked)
    }
}

/// 보기 출력 한 조각 — 글자 수는 문턱까지만 쌓고, 쫓겨남 문구는 끝까지 본다. 빈 조각(읽기 끝 = attach 가 끝남)이면 끝난 보기로:
/// 안 그러면 respawn 등으로 attach 만 끝난 동안 그 죽은 보기를 session_writer 가 계속 골라, 쓴 글이 오류 없이 사라지고 'ok' 로 남았다(2026-10-21 리뷰)
fn note_chunk(counter: &mut Visible, seen: &AtomicUsize, gone: &AtomicBool, kick: &Kick, b: &[u8]) {
    if b.is_empty() {
        gone.store(true, Ordering::Relaxed);
        return;
    }
    let (n, kicked) = counter.scan(b);
    if seen.load(Ordering::Relaxed) < VIEW_READY_VISIBLE {
        seen.fetch_add(n, Ordering::Relaxed);
    }
    if kicked {
        kick.chars.store(1, Ordering::Relaxed);
        *kick.at.lock().unwrap_or_else(|e| e.into_inner()) = Some(std::time::Instant::now());
    } else if (1..=KICK_REVIVE).contains(&kick.chars.load(Ordering::Relaxed)) {
        kick.chars.fetch_add(n, Ordering::Relaxed);
    }
}

/// 이 보기는 끝났나 — 읽기가 끝났거나, 쫓겨남 문구 뒤로 화면이 안 온다
fn dead(v: &OpenView) -> bool {
    if v.gone.load(Ordering::Relaxed) {
        return true;
    }
    let k = v.kick.chars.load(Ordering::Relaxed);
    if k == 0 || k - 1 >= KICK_REVIVE {
        return false;
    }
    // 문구 뒤 KICK_GRACE 가 지났는데 attach 가 살아 있으면 오판(진짜 쫓겨나면 0.5초 안에 끝난다)
    let since = v.kick.at.lock().unwrap_or_else(|e| e.into_inner()).map(|t| t.elapsed());
    !(since.is_some_and(|d| d >= KICK_GRACE) && v.pid.is_some_and(|p| crate::platform::pid_alive(p as i32)))
}

/// 보기 출력 한 조각을 센다 — 윈도우면 Rust 쪽 화면(screen)에도 그린다
fn feed_view(v: &OpenView, counter: &mut Visible, b: &[u8]) {
    note_chunk(counter, &v.visible, &v.gone, &v.kick, b);
    if let Some(p) = &v.screen {
        p.lock().unwrap_or_else(|e| e.into_inner()).process(b);
    }
}

/// 열린 보기에 쓰기 — 자물쇠는 글을 치기 시작해서 Enter(\r)를 쓸 때까지만 쥐고, Enter 뒤 쉬기(700ms)·다음 글 전엔 놓는다.
/// 예전엔 닫개 내내 쥐어 메시지 하나마다 사람 키와 다른 칸 열기·크기 바꾸기까지 1~2초 굳었다(2026-10-21 리뷰 ①-1).
/// 조각마다 놓으면 치는 중·Enter 앞 0.4초에 사람 키가 끼어 앱 글과 한 말로 나갔다(2026-10-22 코드 리뷰) — 그래서 Enter 까지는 쥔다. screen = 그 보기 화면(윈도우)
pub(crate) fn write_view(w: &SharedWriter, screen: Option<&Arc<Mutex<vt100::Parser>>>, write: impl FnOnce(&mut dyn Write, Option<&vt100::Screen>) -> std::io::Result<()>) -> std::io::Result<()> {
    struct UntilEnter<'a> {
        w: &'a SharedWriter,
        held: Option<std::sync::MutexGuard<'a, Box<dyn Write + Send>>>,
    }
    impl Write for UntilEnter<'_> {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            let w = self.w;
            let g = self.held.get_or_insert_with(|| w.lock().unwrap_or_else(|e| e.into_inner()));
            let n = g.write(b)?;
            // Enter 까지 썼다 — 놓는다(글 안의 줄바꿈 Option+Enter = ESC CR 는 Enter 가 아니다)
            if b[..n].ends_with(b"\r") && !b[..n].ends_with(b"\x1b\r") {
                self.held = None;
            }
            Ok(n)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            match self.held.as_mut() {
                Some(g) => g.flush(),
                None => self.w.lock().unwrap_or_else(|e| e.into_inner()).flush(),
            }
        }
    }
    let snap = screen.map(|p| p.lock().unwrap_or_else(|e| e.into_inner()).screen().clone());
    write(&mut UntilEnter { w, held: None }, snap.as_ref())
}

/// 이 세션에 붙어 있는 터미널 보기의 쓰기(+윈도우면 그 화면) — 화면이 실제로 온 것 중 가장 최근 것. 없으면 None(새로 붙는다)
#[allow(clippy::type_complexity)]
pub(crate) fn session_writer(session: &str) -> Option<(SharedWriter, Option<Arc<Mutex<vt100::Parser>>>)> {
    ready_view(&OPEN.lock().unwrap(), session)
}

/// 이 세션에 열린 터미널 보기가 있나(화면이 왔든 아직이든) — 화면만 읽으려고 새로 붙으면 열린 보기가 쫓겨난다
pub(crate) fn session_has_view(session: &str) -> bool {
    has_view(&OPEN.lock().unwrap(), session)
}

/// 쫓겨난 보기는 없는 셈 — 새로 붙어도 쫓아낼 창이 없다
fn has_view(open: &[OpenView], session: &str) -> bool {
    open.iter().any(|v| v.session == session && !dead(v))
}

#[allow(clippy::type_complexity)]
fn ready_view(open: &[OpenView], session: &str) -> Option<(SharedWriter, Option<Arc<Mutex<vt100::Parser>>>)> {
    open.iter()
        .rev()
        .find(|v| v.session == session && !dead(v) && v.visible.load(Ordering::Relaxed) >= VIEW_READY_VISIBLE)
        .map(|v| (v.writer.clone(), v.screen.clone()))
}

#[derive(Default)]
pub struct Ptys {
    next: AtomicU32,
    map: Mutex<HashMap<u32, Pty>>,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

/// 로그인 셸(`$SHELL -lc`)로 감싸서 띄운다 — GUI 앱은 PATH 가 비어 있다.
/// `claude` 자체는 절대 경로로 넘어온다(claude.rs) — 셸의 PATH 는 옛 brew claude 를 먼저 잡기 때문.
/// 명령 하나를 pty 로 띄운다 — 터미널 보기(pty_open)와 세션에 붙어 키 누르기(claude::attach_do)가 이 한 길을 쓴다.
/// 키 누르기를 따로 짰더니 윈도우에서만 화면이 0바이트였고 입력이 안 닿았다(2026-09-30) — 되는 길을 그대로 나눠 쓴다.
/// on_data 가 false 를 돌려주면 읽기를 멈춘다
pub(crate) fn spawn_pty(
    command: &str,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    mut on_data: impl FnMut(&[u8]) -> bool + Send + 'static,
) -> Result<(Box<dyn MasterPty + Send>, Box<dyn Write + Send>, Box<dyn Child + Send + Sync>), String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let mut cmd = crate::platform::shell_command(command);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if let Some(dir) = cwd.or_else(|| Some(crate::platform::home()).filter(|h| !h.is_empty())) {
        cmd.cwd(dir);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // pty 마다 읽기 스레드 하나 — 한 창이 출력을 쏟아도 다른 창이 안 밀린다
    // 자식이 끝나면(읽기 끝) 빈 조각 하나로 알린다 — 터미널 보기가 붙은 세션이 respawn 되면 attach 만 끝나고 세션은 산다(2026-10-21, 프론트 TerminalPane 이 다시 붙는다)
    let sink = Arc::new(Mutex::new(Some(on_data)));
    let s = sink.clone();
    std::thread::spawn(move || pump(reader, &s));
    // 윈도우는 읽기 끝이 안 와서 자식 프로세스가 끝난 걸로 알린다
    #[cfg(windows)]
    if let Some(pid) = child.process_id() {
        std::thread::spawn(move || {
            watch_exit(|| crate::platform::pid_alive(pid as i32), std::time::Duration::from_millis(300), std::time::Duration::from_millis(500), move || finish(&sink));
        });
    }
    #[cfg(not(windows))]
    drop(sink);
    Ok((pair.master, writer, child))
}

/// 읽기 고리 — 받는 쪽이 끝났거나(끝남이 먼저 갔다) 그만 받겠다고 해도 읽기 끝(EOF)까지 비운다.
/// 안 비우면 윈도우 ConPTY 출력 파이프가 차서 master 놓기(ClosePseudoConsole)가 안 돌아온다(2026-10-22 QA 2차 검토)
fn pump<F: FnMut(&[u8]) -> bool>(mut reader: impl Read, sink: &Mutex<Option<F>>) {
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => return finish(sink),
            Ok(n) => {
                let mut g = sink.lock().unwrap_or_else(|e| e.into_inner());
                if g.as_mut().is_some_and(|f| !f(&buf[..n])) {
                    *g = None;
                }
            }
        }
    }
}

/// 끝남(빈 조각)을 한 번만 — 읽기 끝과 프로세스 끝이 둘 다 와도
fn finish<F: FnMut(&[u8]) -> bool>(sink: &Mutex<Option<F>>) {
    if let Some(mut f) = sink.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = f(&[]);
    }
}

/// 자식이 끝날 때까지 물었다가 end 를 한 번. 윈도우 ConPTY 는 자식이 끝나도 읽기 EOF 가 40초 넘게 안 와서
/// 첫 설정 '믿기'에서 No 를 고르면 claude 는 끝났는데 터미널이 질문 화면 그대로 멈추고 안내도 안 떴다(2026-10-22 윈도우 QA 2차).
/// settle = 끝난 뒤 남은 출력이 읽힐 틈
#[cfg_attr(not(windows), allow(dead_code))] // 윈도우만 부른다(맥은 읽기 끝이 온다)
pub(crate) fn watch_exit(alive: impl Fn() -> bool, tick: std::time::Duration, settle: std::time::Duration, end: impl FnOnce()) {
    while alive() {
        std::thread::sleep(tick);
    }
    std::thread::sleep(settle);
    end();
}

/// 명령에서 붙는 세션 id — `… attach <id>` 의 마지막 토막(윈도우: 열린 터미널 보기로 키를 넣으려고 세션을 찾는다)
pub(crate) fn session_of(command: &str) -> Option<String> {
    command.rsplit_once(" attach ").map(|(_, id)| id.trim().trim_matches('"').to_string()).filter(|id| !id.is_empty() && !id.contains(' '))
}

/// 세션 화면에 붙는 명령 한 줄 — 프론트 domain/termCommand.ts attachCommand 와 같다(맥 exec '…', 윈도우 "…")
pub(crate) fn attach_line(bin: &str, id: &str, win: bool) -> String {
    if win {
        format!("\"{bin}\" attach {id}")
    } else {
        format!("exec '{}' attach {id}", bin.replace('\'', "'\\''"))
    }
}

#[tauri::command]
pub fn pty_open(
    webview: tauri::Webview,
    state: State<Ptys>,
    command: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel,
) -> Result<u32, String> {
    let visible = Arc::new(AtomicUsize::new(0));
    let gone = Arc::new(AtomicBool::new(false));
    let kick: Arc<Kick> = Default::default();
    // 세션 보기는 화면을 Rust 도 그린다 — 윈도우는 열린 보기로 칠 때 입력칸을 보려고, 맥은 채팅 탭 Enter 를 글이 보이자마자 넣으려고
    let screen = session_of(&command).is_some().then(|| Arc::new(Mutex::new(vt100::Parser::new(rows, cols, 0))));
    let probe = OpenView { pty: 0, session: String::new(), writer: Arc::new(Mutex::new(Box::new(std::io::sink()))), visible: visible.clone(), gone: gone.clone(), kick: kick.clone(), pid: None, screen: screen.clone() };
    let mut counter = Visible::default();
    let (master, writer, child) = spawn_pty(&command, cwd, cols, rows, move |b| {
        feed_view(&probe, &mut counter, b);
        on_data.send(InvokeResponseBody::Raw(b.to_vec())).is_ok()
    })
    .inspect_err(|_| crate::usage_counts::record_crash("pty"))?; // 익명 사용 통계 — 종류 이름만
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    let writer: SharedWriter = Arc::new(Mutex::new(writer));
    if let Some(session) = session_of(&command) {
        let pid = child.process_id();
        OPEN.lock().unwrap().push(OpenView { pty: id, session, writer: writer.clone(), visible, gone, kick, pid, screen });
    }
    state.map.lock().unwrap().insert(id, Pty { master, writer, child, owner: webview.label().to_string() });
    Ok(id)
}

/// 앱 안에서 바로 쓰기 — 지구본 키 말하기(ptt)가 스페이스를 흘린다
pub fn write_to(state: &Ptys, id: u32, data: &str) {
    if let Some(p) = state.map.lock().unwrap().get_mut(&id) {
        let _ = p.writer.lock().unwrap().write_all(data.as_bytes());
    }
}

#[tauri::command]
pub fn pty_write(state: State<Ptys>, id: u32, data: String) -> Result<(), String> {
    // map 자물쇠는 쓰기를 꺼내고 바로 놓는다 — 쥔 채 쓰기 자물쇠를 기다리면 다른 칸 열기·크기 바꾸기·닫기까지 같이 섰다(①-1)
    let w = state.map.lock().unwrap().get(&id).map(|p| p.writer.clone()).ok_or(crate::i18n::tr("없는 pty", "No such pty"))?;
    #[cfg(debug_assertions)]
    log_write(id, &data);
    let r = w.lock().unwrap().write_all(data.as_bytes()).map_err(|e| e.to_string());
    r
}

/// 채팅이 창(pty)에 글을 친다 — 조각마다 6ms, enter_ms 가 있으면 그만큼 쉬고 Enter(뒤 0.15초까지 쥔다). 스페이스·카드 답장·폰(claude::attach_type_segs)과
/// 같은 자물쇠를 잡아 한 입력칸에 섞이지 않는다 — JS 가 setTimeout 으로 따로 치던 때는 같은 순간이면 섞였다(2026-10-06 fix/chat-ghost 남은 것)
#[tauri::command]
pub async fn pty_type(state: State<'_, Ptys>, id: u32, keys: Vec<String>, enter_ms: Option<u64>) -> Result<(), String> {
    let writer = state.map.lock().unwrap().get(&id).map(|p| p.writer.clone()).ok_or(crate::i18n::tr("없는 pty", "No such pty"))?;
    let screen = OPEN.lock().unwrap().iter().find(|v| v.pty == id).and_then(|v| v.screen.clone());
    #[cfg(debug_assertions)]
    log_write(id, &format!("{}{}", keys.concat(), if enter_ms.is_some() { "\r" } else { "" }));
    tauri::async_runtime::spawn_blocking(move || type_keys_seen(&writer, &keys, enter_ms, screen.as_ref())).await.map_err(|e| e.to_string())?
}

pub(crate) fn type_keys(w: &SharedWriter, keys: &[String], enter_ms: Option<u64>) -> Result<(), String> {
    type_keys_seen(w, keys, enter_ms, None)
}

/// 친 글 끝이 그 칸 입력칸에 보일 때까지(최대 ms) — 화면이 없거나 윈도우면 ms 그대로
fn wait_echo(keys: &[String], ms: u64, screen: Option<&Arc<Mutex<vt100::Parser>>>) {
    use std::time::Duration;
    let tail = crate::claude::typed_echo(&keys.iter().map(|k| k.as_bytes().to_vec()).collect::<Vec<_>>());
    match screen.filter(|_| !cfg!(windows) && !tail.is_empty()) {
        Some(p) => _ = crate::claude::poll_until(Duration::from_millis(ms), || crate::claude::input_shows(p.lock().unwrap_or_else(|e| e.into_inner()).screen(), &tail)),
        None => std::thread::sleep(Duration::from_millis(ms)),
    }
}

/// type_keys + 그 칸 화면 — 맥은 친 글 끝이 입력칸에 보이면 enter_ms 를 다 안 기다리고 바로 Enter(실측: 보이기까지 0~14ms, 고정 0.4초였다).
/// 안 보이면(붙여넣은 글로 접힘·화면 없음) 예전처럼 enter_ms. 윈도우는 가짜 콘솔이 글을 늦게 넘겨 예전 그대로
pub(crate) fn type_keys_seen(w: &SharedWriter, keys: &[String], enter_ms: Option<u64>, screen: Option<&Arc<Mutex<vt100::Parser>>>) -> Result<(), String> {
    use std::time::Duration;
    let _turn = crate::claude::typing_turn();
    for k in keys {
        w.lock().unwrap().write_all(k.as_bytes()).map_err(|e| e.to_string())?;
        std::thread::sleep(Duration::from_millis(6));
    }
    if let Some(ms) = enter_ms {
        wait_echo(keys, ms, screen);
        w.lock().unwrap().write_all(b"\r").map_err(|e| e.to_string())?;
        // Enter 를 받기 전에 다음 글이 붙지 않게 잠깐 더 쥔다(JS 로 칠 때 앞 Enter 와 다음 글 사이 0.15초 그대로)
        std::thread::sleep(Duration::from_millis(150));
    }
    Ok(())
}

/// dev 검증용 — HONOR_ORCH_PTY_LOG=<파일> 이면 pty 로 보낸 글자를 한 줄씩(ms 시각·이스케이프) 남긴다. 디버그 빌드에만 있다
#[cfg(debug_assertions)]
fn log_write(id: u32, data: &str) {
    use std::io::Write as _;
    let Ok(path) = std::env::var("HONOR_ORCH_PTY_LOG") else { return };
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let _ = writeln!(f, "{ms}\t{id}\t{}", data.escape_debug());
    }
}

#[tauri::command]
pub fn pty_resize(state: State<Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    if let Some(v) = OPEN.lock().unwrap().iter().find(|v| v.pty == id) {
        if let Some(p) = &v.screen {
            p.lock().unwrap_or_else(|e| e.into_inner()).set_size(rows, cols);
        }
    }
    let map = state.map.lock().unwrap();
    let p = map.get(&id).ok_or(crate::i18n::tr("없는 pty", "No such pty"))?;
    p.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

/// attach 클라이언트만 끊는다 — 세션 자체는 백그라운드에서 계속 돈다
#[tauri::command]
pub fn pty_close(state: State<Ptys>, id: u32) {
    crate::ptt::forget(id);
    OPEN.lock().unwrap().retain(|v| v.pty != id);
    let gone = state.map.lock().unwrap().remove(&id);
    if let Some(p) = gone {
        close_pty(p);
    }
}

/// 그 창이 연 pty 를 다 닫는다 — 창이 처음부터 다시 읽히면(설정 저장의 location.reload) React 정리가 안 돌아
/// 칸 수만큼 claude attach 자식·읽기 스레드·OPEN 줄이 앱이 꺼질 때까지 남았다(2026-10-21 리뷰 ①-9). 닫은 수
pub(crate) fn close_owned(state: &Ptys, owner: &str) -> usize {
    let gone: Vec<(u32, Pty)> = {
        let mut map = state.map.lock().unwrap();
        let ids: Vec<u32> = map.iter().filter(|(_, p)| p.owner == owner).map(|(id, _)| *id).collect();
        ids.into_iter().filter_map(|id| map.remove(&id).map(|p| (id, p))).collect()
    };
    OPEN.lock().unwrap().retain(|v| !gone.iter().any(|(id, _)| *id == v.pty));
    let n = gone.len();
    for (id, p) in gone {
        crate::ptt::forget(id);
        close_pty(p);
    }
    n
}

/// 창이 뜰 때(그림 그리기 전) 한 번 — 이 창이 지난번에 열어 둔 pty 를 닫는다. 처음 뜬 창이면 0
#[tauri::command]
pub fn pty_close_mine(webview: tauri::Webview, state: State<Ptys>) -> usize {
    close_owned(&state, webview.label())
}

/// 칸 하나를 닫는다 — 자식을 끝내고, master(가짜 콘솔)는 뒤에서 놓는다
fn close_pty(p: Pty) {
    let Pty { master, child, .. } = p;
    reap(child);
    drop_later(master);
}

/// 뒤 스레드에서 놓는다. 윈도우 ConPTY 는 master 를 놓을 때(ClosePseudoConsole) 남은 출력을 다 비울 때까지 멈추는데,
/// 읽기 스레드는 그 출력을 웹뷰로 보내려고 메인 스레드를 기다린다 — 동기 명령(pty_close 등, 메인 스레드)에서 놓으면 서로 붙잡아
/// 앱이 '응답 없음'으로 굳었다(2026-10-22 윈도우 QA 2차: 터미널 뷰 → 채팅 뷰로 칸이 닫힐 때)
pub(crate) fn drop_later<T: Send + 'static>(t: T) {
    std::thread::spawn(move || drop(t));
}

/// 자식을 끝내고 거둔다. portable-pty kill 은 SIGHUP 뒤 0.25초 안에 안 끝나면 SIGKILL 만 하고 거두지 않아
/// 좀비가 남았다 — pid 가 남으니 claude agents 가 마법사 '믿기' claude 를 산 세션으로 보여 줬다(2026-10-05 아이맥 QA).
/// wait 는 SIGKILL 뒤라 곧 돌아오지만 부르는 쪽(IPC·attach)을 붙잡지 않게 뒤에서
pub(crate) fn reap(mut child: Box<dyn Child + Send + Sync>) {
    let _ = child.kill();
    std::thread::spawn(move || {
        let _ = child.wait();
    });
}

#[cfg(test)]
mod tests {

    #[test]
    fn 받는_쪽이_끝나도_출력은_끝까지_비운다() {
        // 끝남(빈 조각)이 먼저 간 뒤에도 파이프를 안 비우면 윈도우 ConPTY 출력이 차서 master 놓기(ClosePseudoConsole)가 안 돌아온다(QA 2차 검토)
        use super::*;
        struct Count<'a>(&'a AtomicUsize, usize);
        impl std::io::Read for Count<'_> {
            fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
                if self.1 == 0 {
                    return Ok(0);
                }
                self.1 -= 1;
                self.0.fetch_add(1, Ordering::SeqCst);
                b[0] = b'x';
                Ok(1)
            }
        }
        let read = AtomicUsize::new(0);
        let got = Arc::new(AtomicUsize::new(0));
        let g = got.clone();
        // 두 조각 받고 그만 받겠다(false)는 쪽 — 그 뒤 조각은 버리되 끝까지 읽는다
        let sink = Mutex::new(Some(move |b: &[u8]| !b.is_empty() && g.fetch_add(1, Ordering::SeqCst) < 1));
        pump(Count(&read, 5), &sink);
        assert_eq!(read.load(Ordering::SeqCst), 5, "EOF 까지 다 읽었다");
        assert_eq!(got.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn 닫기는_부른_쪽을_안_붙잡는다() {
        // 윈도우 ConPTY 는 master 를 닫을 때 남은 출력을 다 비울 때까지 멈춰서, 동기 명령(메인 스레드)에서 닫으면 앱이 '응답 없음'(2026-10-22 윈도우 QA 2차)
        use std::sync::mpsc;
        use std::time::{Duration, Instant};
        struct Slow(mpsc::Receiver<()>, mpsc::Sender<()>);
        impl Drop for Slow {
            fn drop(&mut self) {
                let _ = self.0.recv_timeout(Duration::from_secs(5));
                let _ = self.1.send(());
            }
        }
        let (go, wait) = mpsc::channel();
        let (done_tx, done) = mpsc::channel();
        let t = Instant::now();
        super::drop_later(Slow(wait, done_tx));
        assert!(t.elapsed() < Duration::from_secs(1), "닫기를 기다리지 않고 바로 돌아온다");
        go.send(()).unwrap();
        done.recv_timeout(Duration::from_secs(5)).expect("뒤에서는 끝까지 닫는다");
    }

    #[test]
    fn 자식이_끝나면_끝남을_한_번_보낸다() {
        // 윈도우 ConPTY 는 자식이 끝나도 읽기 EOF 가 안 와 첫 설정 '믿기' No 뒤 터미널이 멈췄다(2026-10-22 윈도우 QA 2차)
        use super::*;
        use std::time::Duration;
        let left = AtomicUsize::new(3);
        let ends = Arc::new(AtomicUsize::new(0));
        let e = ends.clone();
        watch_exit(|| left.fetch_sub(1, Ordering::SeqCst) > 1, Duration::from_millis(1), Duration::ZERO, move || {
            e.fetch_add(1, Ordering::SeqCst);
        });
        assert_eq!(left.load(Ordering::SeqCst), 0, "끝날 때까지 물었다");
        assert_eq!(ends.load(Ordering::SeqCst), 1);
        // 읽기 끝(EOF)과 프로세스 끝이 둘 다 와도 빈 조각은 한 번
        let got = Arc::new(Mutex::new(Vec::<usize>::new()));
        let g = got.clone();
        let sink = Mutex::new(Some(move |b: &[u8]| {
            g.lock().unwrap().push(b.len());
            true
        }));
        finish(&sink);
        finish(&sink);
        assert_eq!(*got.lock().unwrap(), vec![0]);
    }

    #[test]
    fn 읽기가_끝난_보기는_고르지_않는다() {
        use super::*;
        let (seen, gone, kick) = (AtomicUsize::new(0), AtomicBool::new(false), Kick::default());
        let mut c = Visible::default();
        note_chunk(&mut c, &seen, &gone, &kick, "가".repeat(VIEW_READY_VISIBLE).as_bytes());
        assert!(!gone.load(Ordering::Relaxed));
        note_chunk(&mut c, &seen, &gone, &kick, b""); // attach 가 끝남
        assert!(gone.load(Ordering::Relaxed), "끝난 보기에 쓰면 글이 오류 없이 사라진다");
    }
    /// 시험용 보기 하나 — 쓰기는 Sink
    fn view_for(session: &str, buf: std::sync::Arc<std::sync::Mutex<Vec<u8>>>, screen: bool) -> super::OpenView {
        use super::*;
        OpenView {
            pty: 0,
            session: session.into(),
            writer: Arc::new(Mutex::new(Box::new(Sink(buf)))),
            visible: Arc::new(AtomicUsize::new(VIEW_READY_VISIBLE)),
            gone: Arc::new(AtomicBool::new(false)),
            kick: Default::default(),
            pid: None,
            screen: screen.then(|| Arc::new(Mutex::new(vt100::Parser::new(24, 80, 0)))),
        }
    }

    #[test]
    fn 쫓겨남_문구가_그려지기만_한_보기는_화면이_계속_오면_살아_있다() {
        // 세션이 pty.rs 를 grep 하다 그 문구를 찍기만 해도 보기를 영영 '쫓겨남'으로 쳐서, 다음 전달이 새로 붙어 진짜로 그 칸을 쫓아냈다(2026-10-21 리뷰 ①-7)
        use super::*;
        let v = view_for("s", Default::default(), false);
        let mut c = Visible::default();
        note_chunk(&mut c, &v.visible, &v.gone, &v.kick, b"const KICKED: &[u8] = b\"Session opened in another window\";\r\n");
        assert!(dead(&v), "문구 바로 뒤엔 쫓겨난 걸로 본다");
        note_chunk(&mut c, &v.visible, &v.gone, &v.kick, "가".repeat(KICK_REVIVE).as_bytes());
        assert!(!dead(&v), "그 뒤에도 화면이 계속 그려지면 붙어 있는 보기");
        // 진짜 쫓겨남 — 문구 뒤 끝(EOF)
        let w = view_for("s", Default::default(), false);
        note_chunk(&mut c, &w.visible, &w.gone, &w.kick, b"Session opened in another window");
        note_chunk(&mut c, &w.visible, &w.gone, &w.kick, b"");
        assert!(dead(&w));
        // 문구를 찍고 쉬는 세션 — 글자는 안 오지만 attach 가 3초 넘게 살아 있으면 붙어 있는 보기(2026-10-22 코드 리뷰)
        let mut idle = view_for("s", Default::default(), false);
        idle.pid = Some(std::process::id());
        note_chunk(&mut c, &idle.visible, &idle.gone, &idle.kick, b"Session opened in another window");
        assert!(dead(&idle), "문구 바로 뒤");
        *idle.kick.at.lock().unwrap() = Some(std::time::Instant::now() - KICK_GRACE);
        assert!(!dead(&idle), "3초 지나도 attach 가 살아 있다");
        // 진짜 쫓겨남 — attach 가 끝났다(윈도우는 EOF 가 안 와도)
        let mut ended = crate::platform::command("/usr/bin/true").spawn().unwrap();
        let gone_pid = ended.id();
        ended.wait().unwrap();
        idle.pid = Some(gone_pid);
        assert!(dead(&idle));
    }

    #[test]
    fn 열린_보기에_쓰는_동안_쉬는_사이엔_자물쇠를_놓는다() {
        // 쓰기 닫개가 sleep 하는 1~2초 내내 보기 쓰기 자물쇠를 쥐어 사람 키 입력(pty_write)이 메인 스레드에서 막혔다(2026-10-21 리뷰 ①-1).
        // 다만 Enter 까지는 쥔다 — 그 사이 사람 키가 끼면 앱 글과 한 말로 나갔다(2026-10-22 코드 리뷰)
        use super::*;
        use std::time::{Duration, Instant};
        let buf: Arc<Mutex<Vec<u8>>> = Default::default();
        let v = view_for("s", buf.clone(), false);
        let w = v.writer.clone();
        let t = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            let t0 = Instant::now();
            w.lock().unwrap().write_all(b"[human]").unwrap();
            t0.elapsed()
        });
        write_view(&v.writer, None, |w, _| {
            w.write_all(b"a")?;
            std::thread::sleep(Duration::from_millis(300)); // Enter 앞 쉬기 — 사람 키는 기다린다
            w.write_all(b"\r")?;
            std::thread::sleep(Duration::from_millis(700)); // Enter 뒤 쉬기 — 놓는다
            w.write_all(b"b")
        })
        .unwrap();
        let waited = t.join().unwrap();
        assert!(waited < Duration::from_millis(450), "Enter 뒤엔 사람 키가 바로 들어간다: {waited:?}");
        assert_eq!(buf.lock().unwrap().as_slice(), b"a\r[human]b", "앱 글과 사람 키가 한 말로 섞이지 않는다");
    }

    #[test]
    fn 열린_보기도_화면을_넘겨_입력칸_글을_치워_둘_수_있다() {
        // 윈도우 열린 보기 길은 화면이 None 이라 사람이 붙여 둔 글을 안 치워 두고 그 뒤에 앱 글을 붙여 같이 보냈다(2026-10-21 리뷰 ②-1)
        use super::*;
        let v = view_for("s", Default::default(), true);
        let mut c = Visible::default();
        let rule = "─".repeat(40);
        let painted = format!("{rule}\r\n❯ [Image #1] 붙여 둔 글\r\n{rule}\r\n");
        feed_view(&v, &mut c, painted.as_bytes());
        let saw = std::cell::Cell::new(false);
        write_view(&v.writer, v.screen.as_ref(), |_, screen| {
            saw.set(screen.is_some_and(crate::claude::input_has_text));
            Ok(())
        })
        .unwrap();
        assert!(saw.get());
    }

    #[test]
    fn 창을_다시_읽으면_그_창이_연_pty_만_닫는다() {
        // 설정 저장(location.reload)마다 칸 수만큼 claude attach 자식·읽기 스레드·OPEN 줄이 앱이 꺼질 때까지 남았다(2026-10-21 리뷰 ①-9)
        use super::*;
        let state = Ptys::default();
        let open = |id: u32, owner: &str| {
            let (master, writer, child) = spawn_pty("exec sleep 30", None, 80, 24, |_| true).unwrap();
            let writer: SharedWriter = Arc::new(Mutex::new(writer));
            OPEN.lock().unwrap().push(OpenView { pty: id, session: format!("close-owned-{id}"), writer: writer.clone(), visible: Arc::new(AtomicUsize::new(0)), gone: Arc::new(AtomicBool::new(false)), kick: Default::default(), pid: None, screen: None });
            let pid = child.process_id().unwrap() as i32;
            state.map.lock().unwrap().insert(id, Pty { master, writer, child, owner: owner.into() });
            pid
        };
        let (a, b, c) = (open(9101, "main"), open(9102, "main"), open(9103, "reader"));
        assert_eq!(close_owned(&state, "main"), 2);
        let ids: Vec<u32> = state.map.lock().unwrap().keys().copied().collect();
        assert_eq!(ids, vec![9103]);
        assert!(!OPEN.lock().unwrap().iter().any(|v| v.pty == 9101 || v.pty == 9102));
        let gone = |pid: i32| (0..50).any(|_| { std::thread::sleep(std::time::Duration::from_millis(40)); !crate::platform::pid_alive(pid) });
        assert!(gone(a) && gone(b), "닫은 pty 의 자식은 끝나야");
        assert!(crate::platform::pid_alive(c));
        assert_eq!(close_owned(&state, "reader"), 1);
    }
    use super::{attach_line, session_of};

    /// 받은 바이트를 모아 두는 가짜 pty 쓰기
    struct Sink(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);
    impl std::io::Write for Sink {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    // 실측(손으로, 진짜 세션 필요): 창(attach) 치기와 새로 붙어 치기(send_text_to_session 과 같은 길)를 같은 순간에 —
    // 대화 기록에 두 말이 따로 남나. LOCKTEST_ID=<세션 id> CHAMMO_HOME=<시험 폴더> cargo test --bin honor-orchestrator 실측_ -- --ignored
    #[test]
    #[ignore]
    fn 실측_창_치기와_새로_붙어_치기가_진짜_세션에서_따로_간다() {
        use std::time::Duration;
        let id = std::env::var("LOCKTEST_ID").expect("LOCKTEST_ID");
        let delay = std::env::var("LOCKTEST_CHAT_DELAY_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(900);
        let (master, writer, child) = super::spawn_pty(&super::attach_line(&crate::claude::claude_bin(), &id, false), None, 120, 40, |_| true).unwrap();
        let w: super::SharedWriter = std::sync::Arc::new(std::sync::Mutex::new(writer));
        std::thread::sleep(Duration::from_secs(3)); // 창이 붙는 동안
        let other = {
            let id = id.clone();
            let t0 = std::time::Instant::now();
            std::thread::spawn(move || {
                let r = crate::claude::type_text_tagged(&id, &format!("스페이스길 {}", "나".repeat(300)), "locktest");
                eprintln!("새로 붙어 치기 끝 {:?}", t0.elapsed());
                r
            })
        };
        std::thread::sleep(Duration::from_millis(delay)); // 새로 붙는 길이 붙어 치기 시작할 즈음
        let text: Vec<char> = format!("채팅길 {}", "가".repeat(600)).chars().collect();
        let keys: Vec<String> = text.chunks(200).map(|c| c.iter().collect()).collect();
        let t1 = std::time::Instant::now();
        super::type_keys(&w, &keys, Some(400)).unwrap();
        eprintln!("창 치기 {delay}ms 뒤 시작, {:?} 걸림", t1.elapsed());
        other.join().unwrap().unwrap();
        std::thread::sleep(Duration::from_secs(1));
        super::reap(child);
        drop(master);
    }

    // 2026-10-28 chat-speed: 채팅 탭 보내기도 고정 0.4초 대신 친 글이 그 칸 화면 입력칸에 보이면 바로 Enter
    #[cfg(not(windows))]
    #[test]
    fn 채팅_치기는_친_글이_화면에_보이면_바로_enter() {
        use std::time::{Duration, Instant};
        let got = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let w: super::SharedWriter = std::sync::Arc::new(std::sync::Mutex::new(Box::new(Sink(got.clone()))));
        let rule = "─".repeat(40);
        let painted = |input: &str| {
            let p = std::sync::Arc::new(std::sync::Mutex::new(vt100::Parser::new(24, 80, 0)));
            p.lock().unwrap().process(format!("⏺ 응\r\n{rule}\r\n❯\u{a0}{input}\r\n{rule}\r\n  main").as_bytes());
            p
        };
        let keys = vec!["안녕 반가워".to_string(), "\x1b\r".to_string(), "둘째 줄도 있어".to_string()];
        // 기다리기만 따로 잰다 — 치기 자물쇠(TYPE_LOCK)는 다른 시험이 쥐고 있을 수 있어 type_keys 로 재면 흔들린다
        let shown = painted("안녕 반가워\r\n  둘째 줄도 있어");
        let t = Instant::now();
        super::wait_echo(&keys, 400, Some(&shown));
        assert!(t.elapsed() < Duration::from_millis(100), "보이면 0.4초를 안 기다린다: {:?}", t.elapsed());
        // 아직 안 보이면(접힌 붙여넣기·칸이 늦음) 예전처럼 enter_ms 까지
        let t = Instant::now();
        super::wait_echo(&keys, 400, Some(&painted("[Pasted text #1 +1 lines]")));
        assert!(t.elapsed() >= Duration::from_millis(400), "{:?}", t.elapsed());
        // 화면 없는 칸은 예전 그대로
        let t = Instant::now();
        super::wait_echo(&keys, 200, None);
        assert!(t.elapsed() >= Duration::from_millis(200));
        // 치기는 글 다음 Enter
        super::type_keys_seen(&w, &keys, Some(400), Some(&shown)).unwrap();
        assert!(got.lock().unwrap().ends_with("둘째 줄도 있어\r".as_bytes()));
    }

    // fix/chat-ghost 남은 것 ①: 채팅 치기(JS)는 TYPE_LOCK 을 안 잡아 스페이스·카드 답장(send_text_to_session)과 같은 순간이면
    // 한 입력칸에 섞였다 — 다른 길이 치는 동안 채팅 치기는 기다렸다가 통째로 뒤에 간다
    #[test]
    fn 채팅_치기는_다른_치기_길과_안_섞인다() {
        use std::io::Write;
        use std::time::Duration;
        let got = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let w: super::SharedWriter = std::sync::Arc::new(std::sync::Mutex::new(Box::new(Sink(got.clone()))));
        let (held, wait) = std::sync::mpsc::channel();
        let other = {
            let w = w.clone();
            std::thread::spawn(move || {
                let _turn = crate::claude::typing_turn();
                held.send(()).unwrap();
                for _ in 0..20 {
                    w.lock().unwrap().write_all(b"A").unwrap();
                    std::thread::sleep(Duration::from_millis(3));
                }
            })
        };
        wait.recv().unwrap();
        super::type_keys(&w, &vec!["B".to_string(); 10], Some(5)).unwrap();
        other.join().unwrap();
        assert_eq!(String::from_utf8(got.lock().unwrap().clone()).unwrap(), format!("{}{}\r", "A".repeat(20), "B".repeat(10)));
    }

    #[cfg(unix)]
    fn stat_of(pid: u32) -> String {
        let o = crate::platform::command("/bin/ps").args(["-o", "stat=", "-p", &pid.to_string()]).output().unwrap();
        String::from_utf8_lossy(&o.stdout).trim().to_string()
    }

    // 2026-10-05 아이맥 QA: 마법사 '믿기' 터미널을 닫은 뒤 claude 가 <defunct> 로 남아 agents 가 HQ 세션을 산 걸로 봤다.
    // portable-pty kill 은 SIGHUP 뒤 0.25초 안에 안 끝나면 SIGKILL 만 하고 거두지 않는다 — 닫기는 끝까지 거둔다
    #[cfg(unix)]
    #[test]
    fn 닫으면_자식이_좀비로_안_남는다() {
        // HUP 를 무시하는 자식 = 끝내는 데 시간이 걸리는 claude 흉내(무시는 exec 뒤에도 이어진다)
        let (master, writer, child) = super::spawn_pty("trap '' HUP; exec /bin/sleep 30", None, 80, 24, |_| true).unwrap();
        let pid = child.process_id().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        super::reap(child);
        drop(writer);
        drop(master);
        let until = std::time::Instant::now() + std::time::Duration::from_secs(3);
        let mut st = stat_of(pid);
        while !st.is_empty() && std::time::Instant::now() < until {
            std::thread::sleep(std::time::Duration::from_millis(100));
            st = stat_of(pid);
        }
        assert!(st.is_empty(), "닫은 뒤에도 프로세스가 남았다(상태 {st})");
    }

    // 2026-10-21: 붙은 세션이 respawn 되면 attach 가 끝나는데 끝 글(ESC 7·8 붙음)을 못 알아봐 보기가 죽은 채 남았다 —
    // 자식이 끝나면 빈 조각 하나로 알린다(프론트 TerminalPane 이 다시 붙을지 본다)
    #[cfg(unix)]
    #[test]
    fn 자식이_끝나면_빈_조각_하나로_알린다() {
        let got = std::sync::Arc::new(std::sync::Mutex::new(Vec::<usize>::new()));
        let g = got.clone();
        let (master, writer, child) = super::spawn_pty("printf hi; exit 0", None, 80, 24, move |b| { g.lock().unwrap().push(b.len()); true }).unwrap();
        let until = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while !got.lock().unwrap().contains(&0) && std::time::Instant::now() < until {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let lens = got.lock().unwrap().clone();
        assert_eq!(lens.last(), Some(&0), "끝에 빈 조각 하나: {lens:?}");
        assert_eq!(lens.iter().filter(|&&n| n == 0).count(), 1, "빈 조각은 한 번만");
        super::reap(child);
        drop(writer);
        drop(master);
    }

    // 스스로 끝난 자식(사용자가 claude 를 /exit)도 닫을 때 거둔다
    #[cfg(unix)]
    #[test]
    fn 먼저_끝난_자식도_닫으면_거둔다() {
        let (master, writer, child) = super::spawn_pty("exit 0", None, 80, 24, |_| true).unwrap();
        let pid = child.process_id().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));
        super::reap(child);
        drop(writer);
        drop(master);
        std::thread::sleep(std::time::Duration::from_millis(500));
        assert!(stat_of(pid).is_empty(), "먼저 끝난 자식이 좀비로 남았다");
    }

    fn view(pty: u32, session: &str, visible: usize) -> super::OpenView {
        let w: Box<dyn std::io::Write + Send> = Box::new(Vec::<u8>::new());
        super::OpenView { pty, session: session.into(), writer: std::sync::Arc::new(std::sync::Mutex::new(w)), visible: std::sync::Arc::new(visible.into()), gone: Default::default(), kick: Default::default(), pid: None, screen: None }
    }

    fn kicked(v: super::OpenView) -> super::OpenView {
        v.gone.store(true, std::sync::atomic::Ordering::Relaxed);
        v
    }

    // 2026-10-09 윈도우 실기기: 같은 세션에 다른 창이 붙으면 앞 창 attach 는 "Session opened in another window" 를 찍고 끝난다 —
    // 그 보기는 화면이 왔던 보기라 계속 골라졌고, 거기 쓴 글은 오류 없이 허공으로 갔다(roadmap fix/win-send ②)
    #[test]
    fn 쫓겨난_보기에는_안_쓰고_새로_붙는다() {
        assert_eq!(picked(&[view(1, "s", 5_000), kicked(view(2, "s", 5_000))], "s"), Some(1));
        assert_eq!(picked(&[kicked(view(1, "s", 5_000))], "s"), None);
        assert!(!super::has_view(&[kicked(view(1, "s", 0))], "s"), "쫓겨난 보기만 있으면 새로 붙어 읽어도 된다");
        assert!(super::has_view(&[view(1, "s", 0)], "s"));
    }

    fn scan(chunks: &[&[u8]]) -> bool {
        let mut v = super::Visible::default();
        chunks.iter().fold(false, |k, c| v.scan(c).1 || k)
    }

    #[test]
    fn 쫓겨남_문구는_색과_조각_경계에_걸쳐도_알아본다() {
        assert!(scan(&[b"\x1b[2mSession opened in an", b"other window\x1b[0m\r\n"]));
        assert!(scan(&[b"Session opened in another window\r\nC:\\Windows\\system32>"]));
        assert!(!scan(&[b"\x1b[1m\xe2\x97\x8f Session opened\x1b[0m in this window\r\n"]));
        let screen = "\x1b[38;5;246m\u{276f}\x1b[0m 준비만 해 둬\r\n".repeat(40);
        assert!(!scan(&[screen.as_bytes()]));
    }

    fn picked(open: &[super::OpenView], session: &str) -> Option<u32> {
        let (w, _) = super::ready_view(open, session)?;
        open.iter().find(|v| std::sync::Arc::ptr_eq(&v.writer, &w)).map(|v| v.pty)
    }

    // 2026-10-05 윈도우 QA: 같은 세션 보기를 하나 더 열었는데 가짜 콘솔이 첫 커서 질문에서 멈췄다(글자 0) —
    // 가장 최근 것이라고 거기에 쓰면 'ok' 인데 세션엔 안 닿는다. 화면이 실제로 온 앞 보기에 쓴다
    #[test]
    fn 멈춘_새_보기는_건너뛰고_화면이_온_보기에_쓴다() {
        let open = [view(1, "aaaa1111", 4_000), view(3, "bbbb2222", 3_000), view(2, "aaaa1111", 0)];
        assert_eq!(picked(&open, "aaaa1111"), Some(1));
    }

    #[test]
    fn 화면이_온_보기가_여럿이면_가장_최근_것() {
        let open = [view(1, "s", 5_000), view(2, "s", 5_000)];
        assert_eq!(picked(&open, "s"), Some(2));
    }

    #[test]
    fn 화면이_온_보기가_없으면_새로_붙는다() {
        assert_eq!(picked(&[view(1, "s", 0), view(2, "s", super::VIEW_READY_VISIBLE - 1)], "s"), None);
        assert_eq!(picked(&[view(1, "other", 9_000)], "s"), None);
        assert_eq!(picked(&[], "s"), None);
    }

    #[test]
    fn 문턱_글자부터는_붙은_보기() {
        assert_eq!(picked(&[view(1, "s", super::VIEW_READY_VISIBLE)], "s"), Some(1));
    }

    fn visible(chunks: &[&[u8]]) -> usize {
        let mut v = super::Visible::default();
        chunks.iter().map(|c| v.count(c)).sum()
    }

    // 가짜 콘솔은 커서 답을 받자마자 빈 화면(ESC[K CR LF 줄들)·창 제목(OSC)을 2KB 가까이 그린다 — 그건 글자가 아니다
    #[test]
    fn 빈_화면_지우기와_창_제목은_글자로_안_센다() {
        let mut pre = b"\x1b[6n\x1b[m\x1b]0;C:\\Windows\\system32\\cmd.exe\x07\x1b[?25h\x1b[25l".to_vec();
        for _ in 0..360 { pre.extend_from_slice(b"\x1b[K\r\n"); }
        pre.extend_from_slice(b"\x1b[H");
        assert!(pre.len() > 1800);
        assert_eq!(visible(&[&pre]), 0);
    }

    #[test]
    fn 붙은_claude_화면은_글자로_센다() {
        let screen = "\x1b[38;5;246m❯\x1b[0m 준비만 해 둬 — 답은 \"준비됐어\" 한 줄로\r\n\x1b[1m● 준비됐어\x1b[0m\r\n".repeat(4);
        assert!(visible(&[screen.as_bytes()]) >= super::VIEW_READY_VISIBLE);
    }

    #[test]
    fn 붙기_실패_한_줄은_문턱에_못_미친다() {
        assert!(visible(&[b"\x1b[31mNo job matching aaaa1111\x1b[0m\r\n"]) < super::VIEW_READY_VISIBLE);
    }

    #[test]
    fn 조각_경계에_걸친_이스케이프도_건너뛴다() {
        // OSC 제목이 두 조각으로 갈리고, CSI 도 ESC 와 [ 사이에서 갈린다
        assert_eq!(visible(&[b"\x1b]0;C:\\Win", b"dows\\cmd.exe\x07\x1b", b"[2J"]), 0);
        // ST(ESC \)로 끝나는 OSC 뒤 글자는 센다
        assert_eq!(visible(&[b"\x1b]0;title\x1b\\", b"ab"]), 2);
    }

    #[test]
    fn 명령에서_붙는_세션을_읽는다() {
        assert_eq!(session_of(r#""C:\x\claude.exe" attach ab12"#).as_deref(), Some("ab12"));
        assert_eq!(session_of("exec '/h/claude' attach 9f3c"), Some("9f3c".into()));
        assert_eq!(session_of("/bin/zsh -l"), None);
    }

    #[test]
    fn 붙는_명령은_터미널_보기와_같은_모양() {
        // 프론트 domain/termCommand.ts attachCommand 와 같다
        assert_eq!(attach_line("/h/.local/bin/claude", "ab12", false), "exec '/h/.local/bin/claude' attach ab12");
        assert_eq!(attach_line("/it's/claude", "ab12", false), "exec '/it'\\''s/claude' attach ab12");
        assert_eq!(attach_line(r"C:\Users\me\claude.exe", "ab12", true), r#""C:\Users\me\claude.exe" attach ab12"#);
    }
}
