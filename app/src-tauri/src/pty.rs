//! 명령 하나를 pty 로 띄우고, 출력은 Channel 로 웹뷰에 흘리고, 입력·크기 변경을 받는다.
//! spike(2026-09-25)에서 6창 동시 지연 p95 31ms 로 검증한 구조 그대로.

use portable_pty::{native_pty_system, Child, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
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
    /// 연 때 — 막 연 보기는 입력칸이 보여야 키를 받는다(takes_keys)
    opened: std::time::Instant,
    /// 마지막으로 화면(출력)이 온 때(유닉스 ms, 0 = 아직) — 죽은 보기(dead_view) 가리기
    last_out: Arc<AtomicU64>,
}

/// 유닉스 ms
fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// 죽은 보기를 가르는 조용한 시간 — 넉넉히 5분. UserPromptSubmit 훅이 도는 동안 TUI 는 화면을 안 그린다(11-10 실측 '1/2 · 10s' 에서 멈춤,
/// 훅이 18~21초 걸린 날도 있었다) — 짧게 잡으면 산 보기를 죽었다고 보고 새로 붙어 또 넣어 두 번 간다. 실제 죽은 보기는 81~90분이었다
const DEAD_QUIET_MS: u64 = 300_000;

/// 채팅이 친 말이 기록에 안 들어왔을 때 — 그 보기가 죽었나. 치기 전 5분 넘게 조용했고(last_out < started - DEAD_QUIET_MS) 친 뒤로도 출력이 0 이면 죽은 것:
/// 살아 있는 TUI 는 친 글자를 바로 그리고(쉬는 중), 일하는 중엔 스피너를 늘 그린다. 2026-11-10 00:00·00:10 개발 담당 — 보기가 81~90분째
/// 출력 0(quiet=4878448)인데 앱은 그 보기에 쳐서 말이 기록 어디에도 없이 사라졌다(사용자 '다시 보내기 눌러 보니 CLI 에 아예 안 들어가 있네').
/// 사용자가 본 그 터미널(Perambulating… PostToolUse hook 1m 35s)도 90분 전 화면에 얼어 있던 것 — 세션은 그때 쉬고 있었다
pub(crate) fn dead_view(last_out: u64, started: u64) -> bool {
    dead_view_on(last_out, started, cfg!(windows))
}

/// 윈도우 죽은 보기 기준 — 70초. 공개 이슈 #18·#25(윈도우 시험 PC 실측): 말이 사라진 칸은 치기 전 75~346초 조용했고 친 뒤 출력 0 이었는데
/// 5분 기준이라 대부분 산 보기로 봤다. 산 보기는 104초 조용했어도 친 글자를 바로 그려 이 판정에 안 걸렸다(친 뒤 출력 = 산 것).
/// 조용한 시간 기준은 '훅이 도는 동안 멈춘 TUI' 만 막으면 된다 — Claude Code 훅 기본 시간 제한 60초보다 길게.
/// 맥은 화면 확인(seen)까지 있고 죽은 보기도 80분대였어서 5분 그대로
const WIN_DEAD_QUIET_MS: u64 = 70_000;

pub(crate) fn dead_view_on(last_out: u64, started: u64, win: bool) -> bool {
    last_out.saturating_add(if win { WIN_DEAD_QUIET_MS } else { DEAD_QUIET_MS }) < started
}

/// 죽었다고 본 보기를 다시 안 고르게 — 윈도우 대신 넣기(claude::attach_do)는 열린 보기에 바로 쓴다. 표시 없이 attach 만 끄면
/// 끝남을 알아채기(0.3~0.5초) 전에 같은 죽은 보기를 또 골라 말이 사라졌다(공개 이슈 #18). 프론트는 'dead' 를 받아 칸을 다시 붙인다
fn retire_view(pty: u32) {
    if let Some(v) = OPEN.lock().unwrap().iter().find(|v| v.pty == pty) {
        v.gone.store(true, Ordering::Relaxed);
    }
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
    /// 화면 해석기에 흐린 글을 기울임으로 넣는다 — 추천 말을 입력칸 글로 안 읽게(claude::DimAsItalic)
    dim: crate::claude::DimAsItalic,
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
    if !b.is_empty() {
        v.last_out.store(now_ms(), Ordering::Relaxed);
    }
    note_chunk(counter, &v.visible, &v.gone, &v.kick, b);
    if let Some(p) = &v.screen {
        counter.dim.feed(&mut p.lock().unwrap_or_else(|e| e.into_inner()), b);
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

/// 열린 보기가 붙는 중(화면 200자 전)이면 다 붙을 때까지 이만큼은 기다린다 — 윈도우는 attach 가 붙기까지 20초 걸린 적도 있다
pub(crate) const VIEW_SETTLE: std::time::Duration = std::time::Duration::from_secs(25);

/// 윈도우: 세션에 키를 넣기 전 — 열린 보기가 아직 붙는 중이면 다 붙을 때까지 기다린다(그동안 attach_do 가 새로 붙으면 그 보기가 쫓겨난다).
/// 세션당 한 창이라 채팅 칸이 막 다시 붙는 순간 [앱] 줄·팀 말·답장이 끼면 채팅 칸이 쫓겨나 말이 다 안 갔다(2026-10-30 윈도우 시험 PC 재현 10/10)
pub(crate) fn settle_view(session: &str) {
    if cfg!(windows) {
        _ = wait_view(VIEW_SETTLE, std::time::Duration::from_millis(100), || keys_view(&OPEN.lock().unwrap(), session), || session_has_view(session));
    }
}

/// 키를 받을 수 있는 열린 보기 — 글자 수(ready_view)에 더해 화면이 입력을 받을 모양이어야(takes_keys)
fn keys_view(open: &[OpenView], session: &str) -> Option<()> {
    let v = open.iter().rev().find(|v| v.session == session && !dead(v) && v.visible.load(Ordering::Relaxed) >= VIEW_READY_VISIBLE)?;
    view_takes_keys(v).then_some(())
}

fn view_takes_keys(v: &OpenView) -> bool {
    match &v.screen {
        Some(p) => takes_keys(Some(p.lock().unwrap_or_else(|e| e.into_inner()).screen()), v.opened.elapsed()),
        None => takes_keys(None, v.opened.elapsed()),
    }
}

/// 이 칸(pty)이 지금 키를 받나 — 세션 보기가 아니면(설정·로그인 터미널) None
fn pty_takes_keys(open: &[OpenView], pty: u32) -> Option<bool> {
    open.iter().find(|v| v.pty == pty).map(view_takes_keys)
}

/// 윈도우: 채팅이 칸에 치기 전 — 막 (다시) 붙은 세션 보기면 키를 받을 때까지 기다린다. 앱은 화면이 오면 '붙음'으로 보고 바로 치는데
/// 그 순간 attach 는 아직 입력을 못 받아, 되찾자마자 친 말이 사라져 '전달 안 됨·다시 보내기'로 남았다(2026-10-30)
fn settle_pty(pty: u32) {
    if cfg!(windows) {
        _ = wait_view(VIEW_SETTLE, std::time::Duration::from_millis(100), || (pty_takes_keys(&OPEN.lock().unwrap(), pty) != Some(false)).then_some(()), || true);
    }
}

/// 이 보기가 지금 키를 받나 — 연 지 VIEW_FRESH 가 지났고, 입력칸이 보이거나 화면에 글자가 있으면(attach_new 의 attach_ready 와 같은 기준).
/// 200자만 보고 쓰면 attach 안내 줄(Attaching…)뿐이거나 막 열린 보기에 친 글이 사라진다. 화면을 안 그리는 보기는 글자 수로만
pub(crate) fn takes_keys(screen: Option<&vt100::Screen>, age: std::time::Duration) -> bool {
    screen.is_none_or(|s| age >= VIEW_FRESH && crate::claude::attach_ready(s, age))
}

/// 막 연 보기는 입력칸이 보여도 이만큼은 키를 안 넣는다 — 0.6~1초에 친 [앱] 줄이 사라졌다(2026-10-30 윈도우 시험 PC, 1.5초부터는 다 들어감)
pub(crate) const VIEW_FRESH: std::time::Duration = std::time::Duration::from_secs(3);

/// ready 가 값을 줄 때까지 tick 마다 — 열린 보기가 없으면(opening 거짓) 바로, max 를 넘기면 None(가짜 콘솔이 멈춘 보기)
pub(crate) fn wait_view<T>(max: std::time::Duration, tick: std::time::Duration, mut ready: impl FnMut() -> Option<T>, mut opening: impl FnMut() -> bool) -> Option<T> {
    let t = std::time::Instant::now();
    loop {
        if let Some(v) = ready() {
            return Some(v);
        }
        if !opening() || t.elapsed() >= max {
            return None;
        }
        std::thread::sleep(tick);
    }
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

/// 터미널 포커스 나감(ESC[O). Claude Code(2.1.319~)는 포커스가 꺼짐→켜짐이 되면 1초 뒤 클립보드에 그림이 있나를 동기로 본다
/// (clipboard-image-hint → Bun.Image.hasClipboardImage). 클립보드 그림을 '나중에 줄게'로 올린 앱이 답을 안 하면 그동안 세션이 통째로 멈춘다 —
/// 2026-11-10 폰으로 보낸 짧은 말이 쉬는 참모 세션 둘에서 한 시간 넘게 멈췄다가 그 앱이 답하자 한꺼번에 들어갔다. claude attach 는 붙을 때마다
/// 포커스 들어옴을 보내고(폰·스페이스 보내기·화면 읽기는 매번 새로 붙는다) 키를 넣어도 다시 켜진다 — 붙은 뒤와 앱이 넣는 키마다
/// 나감을 넣어 그 1초 타이머를 지운다(with_focus_out).
/// 첫 화면이 온 뒤에 넣는다 — 띄우자마자 넣은 바이트는 attach 가 raw 모드로 바꾸며 버린다(실측: 그때만 넣으면 그대로 멈춤).
/// 일하는 세션에 넣어도 하던 일은 안 멈춘다(실측). 윈도우는 안 넣는다 — 가짜 콘솔이 ESC 를 Esc 키로 넘기면 하던 일이 멈춘다
pub(crate) const FOCUS_OUT: &[u8] = b"\x1b[O";

pub(crate) fn calm_focus(w: &mut dyn Write) {
    if !cfg!(windows) {
        let _ = w.write_all(FOCUS_OUT);
    }
}

/// 앱이 넣는 키 뒤에 바로 포커스 나감 — 키도 포커스를 다시 켠다(실측: ESC[O 뒤 글을 치면 그 1초 뒤 다시 클립보드를 봄).
/// 한 번의 쓰기로 붙인다 — 따로 쓰면 ESC 가 떨어져 Esc 키(하던 일 멈춤)로 읽힐 수 있다. 끝이 ESC 인 조각(Esc 키 자체)엔 안 붙인다.
/// 앱이 치는 길(채팅 type_keys_seen·폰/스페이스 attach)만 — 사람이 터미널에 직접 치는 pty_write 는 그대로(붙여넣기 ESC[200~ 사이에 끼면 글이 깨진다)
pub(crate) fn with_focus_out(keys: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    if cfg!(windows) || keys.is_empty() || keys.ends_with(b"\x1b") {
        std::borrow::Cow::Borrowed(keys)
    } else {
        std::borrow::Cow::Owned([keys, FOCUS_OUT].concat())
    }
}

/// with_focus_out 를 모든 쓰기에 — 잠깐 붙는 길(claude::attach_new)이 치는 쪽에 감싸 준다
pub(crate) struct Unfocus<'a>(pub &'a mut dyn Write);

impl Write for Unfocus<'_> {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.write_all(&with_focus_out(b))?;
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

/// 터미널 보기용 — 첫 화면이 오면 나감을 넣고 0.3초 뒤 한 번 더(첫 조각이 raw 로 바뀌기 전 그림일 때). 5초 안에 화면이 안 오면 그만
fn calm_focus_when_drawn(w: SharedWriter, last_out: Arc<AtomicU64>) {
    if cfg!(windows) {
        return;
    }
    std::thread::spawn(move || {
        let t = std::time::Instant::now();
        while last_out.load(Ordering::Relaxed) == 0 {
            if t.elapsed() > std::time::Duration::from_secs(5) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        calm_focus(&mut **w.lock().unwrap());
        std::thread::sleep(std::time::Duration::from_millis(300));
        calm_focus(&mut **w.lock().unwrap());
    });
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
    let last_out = Arc::new(AtomicU64::new(0));
    let probe = OpenView { pty: 0, session: String::new(), writer: Arc::new(Mutex::new(Box::new(std::io::sink()))), visible: visible.clone(), gone: gone.clone(), kick: kick.clone(), pid: None, screen: screen.clone(), opened: std::time::Instant::now(), last_out: last_out.clone() };
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
        calm_focus_when_drawn(writer.clone(), last_out.clone());
        OPEN.lock().unwrap().push(OpenView { pty: id, session, writer: writer.clone(), visible, gone, kick, pid, screen, opened: std::time::Instant::now(), last_out });
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
/// 같은 자물쇠를 잡아 한 입력칸에 섞이지 않는다 — JS 가 setTimeout 으로 따로 치던 때는 같은 순간이면 섞였다(2026-10-06 fix/chat-ghost 남은 것).
/// Enter 를 넣는 말은 그 세션 대화 기록(jsonl)에 들어왔나까지 본다(send_land, 2026-11-09 chat-send-stuck). again = '다시 보내기' — 입력칸에 남은 그 말이면 Enter 만
#[tauri::command]
/// 돌려주는 'dead' = 그 칸 보기가 죽어 새로 붙어 넣었다 — 프론트가 칸을 다시 붙인다(PaneApi.reattach)
pub async fn pty_type(state: State<'_, Ptys>, id: u32, keys: Vec<String>, enter_ms: Option<u64>, again: Option<bool>) -> Result<String, String> {
    let writer = state.map.lock().unwrap().get(&id).map(|p| p.writer.clone()).ok_or(crate::i18n::tr("없는 pty", "No such pty"))?;
    let (screen, who, last_out, pid) = OPEN.lock().unwrap().iter().find(|v| v.pty == id).map(|v| (v.screen.clone(), v.session.clone(), Some(v.last_out.clone()), v.pid)).unwrap_or_default();
    #[cfg(debug_assertions)]
    log_write(id, &format!("{}{}", keys.concat(), if enter_ms.is_some() { "\r" } else { "" }));
    tauri::async_runtime::spawn_blocking(move || {
        settle_pty(id); // 자물쇠(type_keys_seen) 잡기 전에 — 기다리는 동안 다른 칸 치기를 막지 않게
        let chars: usize = keys.iter().map(|k| k.chars().count()).sum();
        // 기록 자리는 자물쇠 밖에서 찾고(목록 읽기), 끝 길이는 자물쇠를 잡은 뒤 잰다(type_keys_seen)
        let text = keys.concat();
        let land = (enter_ms.is_some() && !crate::claude::slash_command(&text)).then(|| crate::send_land::Landing::for_session(&who, &text)).flatten();
        let started = now_ms();
        let note = type_keys_seen(&writer, &keys, enter_ms, screen.as_ref(), land, again.unwrap_or(false))?;
        let outcome = note.as_ref().map_or("", type_outcome);
        // 이 길엔 로그가 없어 '전달 안 됨'을 못 가렸다(2026-11-05 개발 담당 18:13) — 글 없이 치기 결과만. seen=false 면 친 글이 입력칸에 한 번도 안 보인 것
        if let Some(n) = note {
            let landed = n.landed.map_or("-".to_string(), |l| l.to_string());
            crate::claude::log_out("chat-type", &format!("{who} chars={chars} seen={} left={} enters={} ms={} landed={landed} again={} land_enter={} retyped={}", n.seen, n.left, n.enters, n.ms, n.again, n.land_enter, n.retyped));
            // 기록에 안 들어왔고 이 보기가 죽었다 — 새로 붙어(폰·스페이스 길, 기록으로 확인) 한 번만 다시 넣고, 죽은 attach 를 끝내 보기가 다시 붙게(TerminalPane onEnded)
            let out = last_out.as_ref().map_or(u64::MAX, |l| l.load(Ordering::Relaxed));
            if n.landed == Some(false) && dead_view(out, started) {
                crate::claude::log_out("chat-dead-view", &format!("{who} quiet={}", started.saturating_sub(out)));
                retire_view(id);
                kill_view(pid);
                return crate::claude::type_text_tagged(&who, &text.replace("\x1b\r", "\n"), "chat-fallback").map(|_| "dead".to_string());
            }
        }
        Ok(outcome.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 채팅에 돌려줄 치기 결과 — 'inflight' = 친 글을 입력칸에서 봤고 Enter 뒤 빠졌는데 기록엔 아직. UserPromptSubmit 훅이 도는 동안이다:
/// 11-10~11-12 landed=false 31번이 전부 그 말의 훅이 6초를 넘긴 때였고 31번 다 늦게 들어갔다. 채팅은 이 말을 30초에 '전달 안 됨'으로 띄우지 않는다
/// (domain/chatQueue INFLIGHT_LOST_AFTER) — 띄우면 다시 보내기가 훅 뒤에 같은 말을 한 번 더 넣는다(11-13 시험 세션 재현 2번 들어감)
pub(crate) fn type_outcome(n: &TypeNote) -> &'static str {
    if n.landed == Some(false) && n.seen && !n.left {
        "inflight"
    } else {
        ""
    }
}

/// 죽은 보기의 claude attach 를 끝낸다 — 세션은 안 죽는다(attach 만 뗀다). 끝나면 채팅 칸이 '연결 끊김 → 다시 붙기'로 살아난다
fn kill_view(pid: Option<u32>) {
    // TERM 은 무시하고 KILL 은 커널에서 못 끝나기도 했다(11-10 85195 — 'E' 로 남음). 그래서 프론트가 EOF 를 안 기다리고 칸을 다시 붙인다
    #[cfg(unix)]
    if let Some(p) = pid {
        std::thread::spawn(move || {
            // SAFETY: 우리가 띄운 자식 claude attach 에 끝내기 신호만 보낸다
            unsafe { libc::kill(p as i32, libc::SIGTERM) };
            std::thread::sleep(std::time::Duration::from_millis(500));
            if crate::platform::pid_alive(p as i32) {
                unsafe { libc::kill(p as i32, libc::SIGKILL) };
            }
        });
    }
    // 윈도우 — 표시(retire_view)는 이미 했고 attach 만 끈다. 보기 pid 는 감싼 cmd.exe 라 나무째(/T) — 그 밑 claude attach 까지가 우리 것.
    // 세션은 안 죽는다. 못 꺼도 대신 넣기가 새로 붙으면 세션당 한 창이라 이 attach 는 쫓겨난다
    #[cfg(not(unix))]
    if let Some(p) = pid.filter(|p| *p > 0) {
        std::thread::spawn(move || {
            let _ = crate::platform::command("taskkill").args(["/PID", &p.to_string(), "/T", "/F"]).status();
        });
    }
}

pub(crate) fn type_keys(w: &SharedWriter, keys: &[String], enter_ms: Option<u64>) -> Result<(), String> {
    type_keys_seen(w, keys, enter_ms, None, None, false).map(|_| ())
}

/// 화면을 보며 보낸 치기의 결과 — 폰·스페이스 보내기와 같은 블랙박스(claude::SendNote: seen·left·enters·ms·paste…)
pub(crate) type TypeNote = crate::claude::SendNote;

/// type_keys + 그 칸 화면 — 보내기 확인은 폰·스페이스와 같은 claude::send_watched(그림 읽는 중이면 끝난 뒤 치고, 친 글이 보이면 바로 Enter,
/// 그 말이 입력칸에서 빠질 때까지 본다 — / 명령은 Enter 가 창에서 골라 버려서 한 번). 안 보이면(붙여넣은 글로 접힘·화면 없음) enter_ms.
/// 윈도우는 가짜 콘솔이 글을 늦게 넘겨 예전 그대로(화면 안 봄).
/// land 가 있으면 끝은 대화 기록으로 정한다(send_land::ensure_landed) — 안 들어왔으면 Enter 만 더, 그래도 안 되면 믿을 화면에서만 비우고 다시 친다.
/// 입력칸에 이미 이 말이 그대로 있으면(앞 Enter 가 안 먹음) 또 치지 않고 Enter 만 — 다시 보내기(again)는 그 말을 담기만 해도. 다시 보내기인데
/// 화면으로 입력칸을 못 보면(윈도우·엉킨 사본) Enter 먼저 넣고 기록에 들어오면 끝 — 남은 그 말에 같은 글을 겹쳐 쳤다(2026-11-09 사용자).
/// 끝내 안 빠져도 실패로 돌려주지 않는다 — 채팅이 말을 입력칸 칸으로 되살리면 나중에 들어간 말을 또 보낸다. 남은 말은 채팅이 '입력칸에 걸려 있어요'로
pub(crate) fn type_keys_seen(w: &SharedWriter, keys: &[String], enter_ms: Option<u64>, screen: Option<&Arc<Mutex<vt100::Parser>>>, land: Option<crate::send_land::Landing>, again: bool) -> Result<Option<TypeNote>, String> {
    use std::time::Duration;
    let started = std::time::Instant::now();
    let _turn = crate::claude::typing_turn();
    let land = land.map(crate::send_land::Landing::start);
    let tail = crate::claude::typed_echo(&keys.iter().map(|k| k.as_bytes().to_vec()).collect::<Vec<_>>());
    let look = screen.filter(|_| !cfg!(windows) && !tail.is_empty());
    let t = tail.as_str();
    let scr = |p: &Arc<Mutex<vt100::Parser>>| p.lock().unwrap_or_else(|e| e.into_inner()).screen().clone();
    let peek = look.map(|p| move || crate::claude::peek_typed(&scr(p), t));
    let peek = peek.as_ref().map(|f| f as &dyn Fn() -> (bool, bool, bool));
    let type_all = || -> std::io::Result<()> {
        for k in keys {
            w.lock().unwrap().write_all(&with_focus_out(k.as_bytes()))?;
            std::thread::sleep(Duration::from_millis(6));
        }
        Ok(())
    };
    let enter = || w.lock().unwrap().write_all(&with_focus_out(b"\r"));
    let Some(ms) = enter_ms else {
        // Enter 없이 치기만 — 그림을 읽는 중이면 끝난 뒤에(그 사이 친 글은 칩 앞에 낀다)
        if let Some(p) = peek {
            crate::claude::poll_until(crate::claude::PASTE_MAX, || !p().2);
        }
        type_all().map_err(|e| e.to_string())?;
        return Ok(None);
    };
    let mut note = TypeNote::default();
    let watch = !crate::claude::slash_command(&keys.concat());
    let landed = || land.as_ref().is_some_and(|l| l.landed());
    let present = look.is_some_and(|p| {
        let s = scr(p);
        if again { crate::claude::input_holds(&s, &tail) } else { crate::claude::input_is(&s, &tail) }
    });
    // 다시 보내기인데 그 말이 입력칸에 안 보인다 — 화면 사본이 엉켰거나 느려 못 볼 뿐 남아 있을 수 있으니 Enter 먼저(빈 칸 Enter 는 아무 일도 안 한다).
    // 입력칸에 다른 글이 보이면 안 한다 — 그 글이 나간다. 기록에 들어오면 끝, 아니면 그때 친다
    let other = look.is_some_and(|p| crate::claude::input_has_text(&scr(p)));
    if again && watch && land.is_some() && !present && !other {
        note.enters += 1;
        enter().map_err(|e| e.to_string())?;
        if crate::claude::poll_until(crate::send_land::AGAIN_WAIT, landed) {
            note.again = true;
            note.landed = Some(true);
            note.ms = started.elapsed().as_millis();
            return Ok(Some(note));
        }
    }
    note.again |= present;
    crate::claude::send_watched(&mut || if present { Ok(()) } else { type_all() }, &mut || enter(), peek, Duration::from_millis(ms), watch, &mut note).map_err(|e| e.to_string())?;
    if let Some(l) = land.as_ref().filter(|_| watch) {
        // 입력칸에 그 말이 보이면 지울 글자 수(줄 수만큼 더) — 화면을 못 보면 None
        let held = look.map(|p| {
            move || {
                let s = scr(p);
                crate::claude::input_holds(&s, t).then(|| crate::claude::input_lines(&s).map_or(0, |b| b.iter().map(|x| x.chars().count()).sum::<usize>() + b.len()))
            }
        });
        let trusted = note.seen;
        let ok = crate::send_land::ensure_landed(
            &|| l.landed(),
            crate::send_land::Keys { enter: &mut || enter(), clear: &mut |n| w.lock().unwrap().write_all(&with_focus_out("\x7f".repeat(n).as_bytes())), retype: &mut || type_all() },
            held.as_ref().map(|f| f as &dyn Fn() -> Option<usize>),
            trusted,
            crate::send_land::LAND_WAIT,
            &mut note,
        )
        .map_err(|e| e.to_string())?;
        note.landed = Some(ok);
        if ok {
            note.left = false;
        }
    }
    // Enter 를 받기 전에 다음 글이 붙지 않게 잠깐 더 쥔다(JS 로 칠 때 앞 Enter 와 다음 글 사이 0.15초 그대로)
    std::thread::sleep(Duration::from_millis(150));
    note.ms = started.elapsed().as_millis();
    Ok((peek.is_some() || note.landed.is_some()).then_some(note))
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
    use std::sync::{Arc, Mutex};

    #[test]
    fn 앱이_넣는_키_뒤엔_한_번의_쓰기로_포커스_나감() {
        use std::io::Write;
        assert_eq!(&*super::with_focus_out(b"ab"), b"ab\x1b[O");
        assert_eq!(&*super::with_focus_out(b"\r"), b"\r\x1b[O");
        assert_eq!(&*super::with_focus_out(b"\x1b"), b"\x1b", "Esc 키 자체엔 안 붙인다(ESC ESC [O 로 읽힌다)");
        assert_eq!(&*super::with_focus_out(b""), b"");
        // 감싼 쓰기 — 조각마다 한 번에(쓰기 호출 수 = 조각 수)
        struct Calls(Vec<Vec<u8>>);
        impl std::io::Write for Calls {
            fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
                self.0.push(b.to_vec());
                Ok(b.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut c = Calls(vec![]);
        let mut u = super::Unfocus(&mut c);
        u.write_all("ㄱㄱ".as_bytes()).unwrap();
        u.write_all(b"\x1b\r").unwrap();
        assert_eq!(c.0, vec![[&"ㄱㄱ".as_bytes()[..], super::FOCUS_OUT].concat(), b"\x1b\r\x1b[O".to_vec()]);
    }

    #[test]
    fn 포커스_나감은_첫_화면이_온_뒤에_넣는다() {
        // 띄우자마자 넣은 바이트는 claude attach 가 raw 모드로 바꾸며 버린다(2026-11-10 실측) — 화면이 오기 전엔 안 넣고, 오면 넣고 0.3초 뒤 한 번 더
        use std::sync::atomic::{AtomicU64, Ordering};
        struct Rec(Arc<Mutex<Vec<u8>>>);
        impl std::io::Write for Rec {
            fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(b);
                Ok(b.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let got = Arc::new(Mutex::new(Vec::new()));
        let w: super::SharedWriter = Arc::new(Mutex::new(Box::new(Rec(got.clone()))));
        let last_out = Arc::new(AtomicU64::new(0));
        super::calm_focus_when_drawn(w, last_out.clone());
        std::thread::sleep(std::time::Duration::from_millis(150));
        assert!(got.lock().unwrap().is_empty(), "화면이 오기 전엔 안 넣는다");
        last_out.store(super::now_ms(), Ordering::Relaxed);
        std::thread::sleep(std::time::Duration::from_millis(120));
        assert_eq!(*got.lock().unwrap(), super::FOCUS_OUT, "첫 화면이 오면 바로");
        std::thread::sleep(std::time::Duration::from_millis(400));
        assert_eq!(*got.lock().unwrap(), [super::FOCUS_OUT, super::FOCUS_OUT].concat(), "0.3초 뒤 한 번 더");
    }

    #[test]
    fn 붙는_중인_보기는_다_붙을_때까지_기다려_그_보기를_쓴다() {
        // 윈도우는 세션당 한 창 — 채팅 칸이 붙는 중(화면 200자 전)에 앱 전달이 새로 붙으면 채팅 칸이 쫓겨나 말이 다 안 갔다(2026-10-30)
        use std::cell::Cell;
        use std::time::Duration;
        let polls = Cell::new(0);
        let got = super::wait_view(Duration::from_secs(5), Duration::from_millis(1), || {
            polls.set(polls.get() + 1);
            (polls.get() >= 3).then_some(7)
        }, || true);
        assert_eq!(got, Some(7));
        assert_eq!(polls.get(), 3);
    }

    #[test]
    fn 열린_보기는_입력칸이_보여야_키를_받는다() {
        // 200자를 받아도 attach 안내 줄뿐이거나 막 열린 보기면 아직 입력을 안 받는다 — 그때 친 [앱] 줄이 조용히 사라졌다(2026-10-30 고친 판 첫 재측정 10/10)
        use std::time::Duration;
        let screen = |bytes: &str| {
            let mut p = vt100::Parser::new(40, 120, 0);
            p.process(bytes.as_bytes());
            p
        };
        let banner = screen("Attaching to session 1a2b3c4d (probe-a) — press ctrl+b d to detach\r\nWaiting for session to redraw…");
        assert!(!super::takes_keys(Some(banner.screen()), Duration::from_millis(300)));
        let boxed = screen("⏺ 안녕\r\n──────── s ─\r\n❯\u{a0}\r\n────────\r\n  main");
        // 입력칸이 그려져도 연 지 1초 안쪽엔 attach 가 아직 입력을 못 받았다(시험 PC 실측: 0.6~1초에 친 줄 10/10 사라짐, 1.5초부터 다 들어감)
        assert!(!super::takes_keys(Some(boxed.screen()), Duration::from_millis(900)));
        assert!(super::takes_keys(Some(boxed.screen()), super::VIEW_FRESH));
        // 오래 열려 있던 보기의 선택 창 — 입력칸이 없어도 바로(선택지 답 키가 1.5초씩 늦지 않게)
        let dialog = screen("Do you want to proceed?\r\n❯ 1. Yes\r\n  2. No");
        assert!(super::takes_keys(Some(dialog.screen()), Duration::from_secs(60)));
        assert!(super::takes_keys(None, Duration::ZERO), "화면을 안 그리는 보기는 예전처럼 글자 수로만");
    }

    #[test]
    fn 막_다시_붙은_칸에는_채팅도_바로_안_친다() {
        // 쫓겨난 칸을 되찾자마자(붙음) 친 채팅 말이 사라져 '전달 안 됨·다시 보내기'로 남았다(2026-10-30 시험판 3/3) — pty_type 도 같은 기준으로 기다린다
        use std::time::{Duration, Instant};
        let buf = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let mut fresh = view_for("s1", buf.clone(), true);
        fresh.pty = 7;
        fresh.screen.as_ref().unwrap().lock().unwrap().process("──── s ─\r\n❯\u{a0}\r\n────\r\n".as_bytes());
        assert_eq!(super::pty_takes_keys(std::slice::from_ref(&fresh), 7), Some(false), "연 지 얼마 안 됐으면 기다린다");
        fresh.opened = Instant::now().checked_sub(Duration::from_secs(5)).unwrap();
        assert_eq!(super::pty_takes_keys(std::slice::from_ref(&fresh), 7), Some(true));
        assert_eq!(super::pty_takes_keys(std::slice::from_ref(&fresh), 8), None, "세션 보기가 아닌 칸(설정·로그인 터미널)은 안 기다린다");
    }

    #[test]
    fn 열린_보기가_없으면_안_기다린다() {
        use std::time::{Duration, Instant};
        let t = Instant::now();
        assert_eq!(super::wait_view(Duration::from_secs(5), Duration::from_millis(50), || None::<u8>, || false), None);
        assert!(t.elapsed() < Duration::from_millis(40), "보기가 없으면 바로 새로 붙는다");
    }

    #[test]
    fn 끝내_안_붙는_보기는_놓고_새로_붙게_한다() {
        // 가짜 콘솔이 멈춘 보기(첫 ESC[6n 답 못 받음)는 영영 화면이 안 온다 — 한도까지만 기다린다
        use std::time::{Duration, Instant};
        let t = Instant::now();
        assert_eq!(super::wait_view(Duration::from_millis(30), Duration::from_millis(5), || None::<u8>, || true), None);
        assert!(t.elapsed() >= Duration::from_millis(30));
    }

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
            opened: std::time::Instant::now(),
            last_out: Default::default(),
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
            OPEN.lock().unwrap().push(OpenView { pty: id, session: format!("close-owned-{id}"), writer: writer.clone(), visible: Arc::new(AtomicUsize::new(0)), gone: Arc::new(AtomicBool::new(false)), kick: Default::default(), pid: None, screen: None, opened: std::time::Instant::now(), last_out: Default::default() });
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
        let tail = crate::claude::typed_echo(&keys.iter().map(|k| k.as_bytes().to_vec()).collect::<Vec<_>>());
        let wait_echo = |_: &[String], ms: u64, scr: Option<&std::sync::Arc<std::sync::Mutex<vt100::Parser>>>| {
            let peek = scr.map(|p| || crate::claude::peek_typed(p.lock().unwrap().screen(), &tail));
            crate::claude::wait_shown(peek.as_ref().map(|f| f as &dyn Fn() -> (bool, bool, bool)), Duration::from_millis(ms))
        };
        // 기다리기만 따로 잰다 — 치기 자물쇠(TYPE_LOCK)는 다른 시험이 쥐고 있을 수 있어 type_keys 로 재면 흔들린다
        let shown = painted("안녕 반가워\r\n  둘째 줄도 있어");
        let t = Instant::now();
        wait_echo(&keys, 400, Some(&shown));
        assert!(t.elapsed() < Duration::from_millis(100), "보이면 0.4초를 안 기다린다: {:?}", t.elapsed());
        // 아직 안 보이면(접힌 붙여넣기·칸이 늦음) 예전처럼 enter_ms 까지
        let t = Instant::now();
        wait_echo(&keys, 400, Some(&painted("[Pasted text #1 +1 lines]")));
        assert!(t.elapsed() >= Duration::from_millis(400), "{:?}", t.elapsed());
        // 화면 없는 칸은 예전 그대로
        let t = Instant::now();
        wait_echo(&keys, 200, None);
        assert!(t.elapsed() >= Duration::from_millis(200));
        // 치기는 글 다음 Enter
        super::type_keys_seen(&w, &keys, Some(1), None, None, false).unwrap();
        let raw = String::from_utf8(got.lock().unwrap().clone()).unwrap();
        assert!(raw.replace("\x1b[O", "").ends_with("둘째 줄도 있어\r"), "{raw:?}");
        // 앱이 넣는 키마다 포커스 나감이 붙는다(클립보드 멈춤 막기 — with_focus_out)
        assert!(cfg!(windows) || raw.ends_with("둘째 줄도 있어\x1b[O\r\x1b[O"), "{raw:?}");
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
        assert_eq!(String::from_utf8(got.lock().unwrap().clone()).unwrap().replace("\x1b[O", ""), format!("{}{}\r", "A".repeat(20), "B".repeat(10)));
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
        super::OpenView { pty, session: session.into(), writer: std::sync::Arc::new(std::sync::Mutex::new(w)), visible: std::sync::Arc::new(visible.into()), gone: Default::default(), kick: Default::default(), pid: None, screen: None, opened: std::time::Instant::now(), last_out: Default::default() }
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

    // 2026-11-05 send-stuck(2.1.318 실측): 그림 경로를 붙여넣으면 Claude 가 읽는 동안 화면이 0.8초 멈췄다가 `Pasting…` 을 띄우고,
    // 그 사이 친 글은 칩 앞에 끼며 Enter 는 버린다(일회용 세션 4번 중 2번) — 말이 입력칸에 남아 '입력칸에 걸려 있어요'
    fn send_to(f: &crate::fake_claude::Fake, text: &str) {
        let w = f.writer();
        super::type_keys_seen(&w, &[text.to_string()], Some(400), Some(&f.screen), None, false).unwrap();
    }

    #[test]
    fn 그림을_읽는_중_버려진_enter_는_끝난_뒤_다시_넣는다() {
        use std::time::Duration;
        let f = crate::fake_claude::Fake::new(Some((Duration::from_millis(300), Duration::from_millis(1200))), false);
        send_to(&f, "#img1 #img2 고양이 그림 하나");
        let (sent, _) = f.sent();
        assert_eq!(sent, vec!["#img1 #img2 고양이 그림 하나[Image #1] [Image #2]".to_string()], "한 번, 그림과 같이");
    }

    #[test]
    fn 그림을_읽은_뒤_스스로_보낸_말엔_enter_를_더_안_넣는다() {
        use std::time::Duration;
        // 실측 나머지 2/4 — Pasting 중 Enter 를 미뤘다 끝날 때 보냈다. 빈 칸에 Enter 를 또 넣으면 안 된다(두 번 가는 길을 막는 기준)
        let f = crate::fake_claude::Fake::new(Some((Duration::from_millis(300), Duration::from_millis(1200))), true);
        send_to(&f, "심볼 넣어줘");
        let (sent, enters) = f.sent();
        assert_eq!(sent.len(), 1, "한 번만: {sent:?}");
        assert_eq!(enters, 1, "그 말이 입력칸에서 빠졌으면 Enter 는 더 안 넣는다");
    }

    #[test]
    fn 붙여넣기_없는_보통_말은_enter_한_번() {
        let f = crate::fake_claude::Fake::new(None, false);
        send_to(&f, "ㄱㄱ");
        let (sent, enters) = f.sent();
        assert_eq!((sent, enters), (vec!["ㄱㄱ".to_string()], 1));
    }

    #[test]
    fn 친_글이_입력칸에_안_보이면_실패로_안_돌려주고_기록에_남긴다() {
        // 2026-11-05 개발 담당 18:13: 쉬는 세션에 친 말이 입력칸·기록 어디에도 없이 '전달 안 됨' — 키가 어디서 사라졌는지 로그가 없었다.
        // 실패로 돌려주면 채팅이 입력칸에 되살려 다시 보내게 되는데, 화면 사본이 엉킨 때면 이미 간 말이라 두 번 간다
        let parser = Arc::new(Mutex::new(vt100::Parser::new(10, 40, 0)));
        parser.lock().unwrap().process(format!("{}\r\n❯ \r\n{}\r\n", "─".repeat(40), "─".repeat(40)).as_bytes());
        let w: super::SharedWriter = Arc::new(Mutex::new(Box::new(std::io::sink())));
        let n = super::type_keys_seen(&w, &["사라지는 말".to_string()], Some(50), Some(&parser), None, false).unwrap().unwrap();
        assert_eq!((n.seen, n.left, n.enters), (false, false, 1), "Enter 는 한 번, 못 봤다고 남긴다");
    }

    // 2026-11-09 chat-send-stuck: 사용자 참모 업데이트 채팅이 저녁 내내 seen=false(화면 사본이 친 글을 못 봄) — Enter 한 번 넣고 '보냄'으로 끝나,
    // 그 Enter 가 안 먹으면 말이 입력칸에 남았고 '다시 보내기'가 같은 글을 또 쳐서 쌓였다. 이제 끝은 대화 기록(jsonl)으로 본다
    fn land_file(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("land-pty-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("s.jsonl");
        std::fs::write(&p, "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"앞 말\"}}\n").unwrap();
        p
    }

    fn send_land(f: &crate::fake_claude::Fake, text: &str, jsonl: Option<&std::path::Path>, again: bool) -> super::TypeNote {
        let w = f.writer();
        let land = jsonl.and_then(|p| crate::send_land::Landing::at(p.to_path_buf(), text));
        super::type_keys_seen(&w, &[text.to_string()], Some(100), Some(&f.screen), land, again).unwrap().unwrap_or_default()
    }

    #[test]
    fn 화면이_못_보는_칸에서_enter_가_안_먹으면_기록을_보고_enter_만_더() {
        // 고치기 전 길(기록을 안 봄): Enter 한 번 넣고 끝 — 말이 입력칸에 남는다
        let before = crate::fake_claude::Fake::new(None, false).blind().swallow_enters(1);
        let n = send_land(&before, "이거 좀 바꿔볼래", None, false);
        assert!(before.sent().0.is_empty(), "예전엔 사라졌다: {n:?}");
        assert_eq!(before.input(), "이거 좀 바꿔볼래", "입력칸에 남음");
        drop(before);
        let p = land_file("blind");
        let f = crate::fake_claude::Fake::new(None, false).blind().swallow_enters(1).with_jsonl(&p);
        let n = send_land(&f, "이거 좀 바꿔볼래", Some(&p), false);
        assert_eq!(f.sent().0, vec!["이거 좀 바꿔볼래".to_string()], "한 번 들어간다: {n:?}");
        assert_eq!((n.landed, n.land_enter, n.retyped), (Some(true), true, false), "같은 글은 또 안 친다: {n:?}");
    }

    #[test]
    fn 훅이_늦어_기록이_늦게_붙으면_inflight_로_알리고_또_치지_않는다() {
        // 11-13 시험 세션 실측: UserPromptSubmit 훅이 도는 동안 입력칸은 바로 비는데 기록 줄은 훅이 끝난 뒤(31초) 붙었다
        let p = land_file("hook");
        let f = crate::fake_claude::Fake::new(None, false).hook(std::time::Duration::from_secs(12)).with_jsonl(&p); // 확인 창(LAND_WAIT 두 번 = 6초)보다 넉넉히 — 바쁜 판에도
        let n = send_land(&f, "훅 도는 동안 보낸 말", Some(&p), false);
        assert_eq!((n.landed, n.seen, n.left, n.retyped), (Some(false), true, false, false), "{n:?}");
        assert_eq!(super::type_outcome(&n), "inflight");
        assert_eq!(f.sent().0, vec!["훅 도는 동안 보낸 말".to_string()], "한 번만 들어갔다: {n:?}");
        let t = std::time::Instant::now();
        let users = || std::fs::read_to_string(&p).unwrap().matches("훅 도는 동안 보낸 말").count();
        while users() == 0 && t.elapsed() < std::time::Duration::from_secs(15) {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert_eq!(users(), 1, "늦게라도 기록엔 한 번");
    }

    #[test]
    fn inflight_는_입력칸에서_빠진_걸_본_때만() {
        let n = |landed, seen, left| super::TypeNote { landed, seen, left, ..Default::default() };
        assert_eq!(super::type_outcome(&n(Some(false), true, false)), "inflight");
        assert_eq!(super::type_outcome(&n(Some(true), true, false)), "", "들어갔다");
        assert_eq!(super::type_outcome(&n(None, true, false)), "", "기록으로 못 가림");
        assert_eq!(super::type_outcome(&n(Some(false), false, false)), "", "친 글을 못 봤다 — 빠졌는지 모른다");
        assert_eq!(super::type_outcome(&n(Some(false), true, true)), "", "입력칸에 남았다");
    }

    #[test]
    fn enter_가_계속_안_먹으면_비우고_다시_친다_겹치지_않게() {
        // 보이는 칸 — send_watched 가 Enter 세 번, 기록 확인이 한 번 더 — 넷 다 버려지면 지우고 다시 쳐서 Enter
        let p = land_file("retype");
        let f = crate::fake_claude::Fake::new(None, false).swallow_enters(4).with_jsonl(&p);
        let n = send_land(&f, "#img1 .", Some(&p), false);
        assert_eq!(f.sent().0, vec!["#img1 .".to_string()], "겹치지 않고 한 번: {n:?}");
        assert!(n.retyped && n.landed == Some(true), "{n:?}");
    }

    #[test]
    fn 죽은_보기는_치기_전에도_뒤에도_조용한_칸() {
        // 2026-11-10 00:10 개발 담당: 보기가 90분째 출력 0 — 친 말이 사라졌다
        let t = 1_000_000_000u64;
        assert!(super::dead_view(t - 5_451_419, t), "90분 조용 + 친 뒤 출력 없음");
        assert!(!super::dead_view(t + 300, t), "친 뒤 글자가 그려졌다 = 산 보기");
        assert!(!super::dead_view(t - 5_000, t), "쉬는 세션 화면은 몇 초 가만할 수 있다");
        assert!(!super::dead_view(t - 60_000, t), "훅이 도는 동안 TUI 는 화면을 안 그린다 — 1분은 산 보기");
        assert!(!super::dead_view(u64::MAX, t), "보기를 못 찾으면 죽었다고 안 본다");
        assert!(super::dead_view(0, t), "붙은 뒤 화면이 한 번도 안 온 보기");
    }

    #[test]
    fn 윈도우_죽은_보기는_1분_남짓_조용해도_죽은_것() {
        // 공개 이슈 #18·#25 (윈도우 시험 PC 실측 기록): 안 간 말은 전부 landed=false, 치기 전 75~346초 조용했고 친 뒤 출력 0.
        // 5분 기준이라 마지막 한 건만 죽은 보기로 잡혔다. 산 보기는 104초 조용했어도 친 글을 그려 늘 걸리지 않았다(친 뒤 출력 = 산 것)
        let t = 1_000_000_000u64;
        for quiet in [75_496u64, 242_842, 295_431] {
            assert!(super::dead_view_on(t - quiet, t, true), "윈도우 {quiet}ms 조용 + 친 뒤 출력 없음 = 죽은 보기");
            assert!(!super::dead_view_on(t - quiet, t, false), "맥은 5분 그대로 — 훅·그림 읽기로 조용한 산 보기를 또 넣지 않게");
        }
        assert!(!super::dead_view_on(t - 60_000, t, true), "훅(기본 시간 제한 60초)이 도는 동안 멈춘 TUI 는 윈도우도 산 보기");
        assert!(!super::dead_view_on(t + 300, t, true), "친 뒤 글자가 그려졌다 = 산 보기");
        assert!(!super::dead_view_on(u64::MAX, t, true), "보기를 못 찾으면 죽었다고 안 본다");
    }

    #[test]
    fn 죽었다고_본_보기는_대신_넣을_때_다시_안_고른다() {
        // 공개 이슈 #18: 윈도우는 대신 넣기(attach_do)가 열린 보기에 바로 쓴다 — 죽은 보기를 끝내지 못해(kill_view 가 유닉스만) 같은 죽은 보기에
        // 또 써서 말이 사라졌다(실측 chat-dead-view 바로 뒤 chat-fallback landed=false, 다음 말에서야 다시 붙어 들어감)
        let id = 4_000_000_001u32;
        let session = "dead-view-retire-test".to_string();
        use std::sync::atomic::{AtomicBool, AtomicUsize};
        let visible = Arc::new(AtomicUsize::new(super::VIEW_READY_VISIBLE));
        super::OPEN.lock().unwrap().push(super::OpenView { pty: id, session: session.clone(), writer: Arc::new(Mutex::new(Box::new(std::io::sink()))), visible, gone: Arc::new(AtomicBool::new(false)), kick: Default::default(), pid: None, screen: None, opened: std::time::Instant::now(), last_out: Default::default() });
        assert!(super::session_writer(&session).is_some(), "죽기 전엔 고른다");
        super::retire_view(id);
        assert!(super::session_writer(&session).is_none(), "죽었다고 본 뒤엔 대신 넣기가 새로 붙어야 한다");
        assert!(!super::session_has_view(&session), "쫓아낼 창도 없는 셈");
        super::OPEN.lock().unwrap().retain(|v| v.pty != id);
    }

    #[test]
    fn 바로_들어가면_enter_는_한_번() {
        let p = land_file("plain");
        let f = crate::fake_claude::Fake::new(None, false).with_jsonl(&p);
        let n = send_land(&f, "ㄱㄱ", Some(&p), false);
        assert_eq!(f.sent(), (vec!["ㄱㄱ".to_string()], 1));
        assert_eq!((n.landed, n.land_enter, n.retyped), (Some(true), false, false), "{n:?}");
    }

    #[test]
    fn 다시_보내기는_입력칸에_남은_그_말에_겹쳐_치지_않는다() {
        // 보이는 칸: 남은 그 말이면 치지 않고 Enter 만
        let p = land_file("again-seen");
        let f = crate::fake_claude::Fake::new(None, false).with_input("#img1 .").with_jsonl(&p);
        let n = send_land(&f, "#img1 .", Some(&p), true);
        assert_eq!(f.sent().0, vec!["#img1 .".to_string()], "{n:?}");
        assert!(n.again, "{n:?}");
        drop(f);
        // 못 보는 칸: Enter 먼저 — 기록에 들어오면 끝
        let p = land_file("again-blind");
        let f = crate::fake_claude::Fake::new(None, false).with_input("#img1 .").blind().with_jsonl(&p);
        let n = send_land(&f, "#img1 .", Some(&p), true);
        assert_eq!(f.sent().0, vec!["#img1 .".to_string()], "'#img1 .#img1 .' 로 겹치면 안 된다: {n:?}");
        assert_eq!((n.again, n.landed), (true, Some(true)), "{n:?}");
        drop(f);
        // 못 보는 칸인데 입력칸이 비었으면 Enter 는 아무 일도 안 하고, 기록에 안 들어오니 그때 친다
        let p = land_file("again-empty");
        let f = crate::fake_claude::Fake::new(None, false).blind().with_jsonl(&p);
        let n = send_land(&f, "#img1 .", Some(&p), true);
        assert_eq!(f.sent().0, vec!["#img1 .".to_string()], "{n:?}");
    }

    #[test]
    fn 보통_보내기도_입력칸에_같은_말이_그대로면_또_치지_않는다() {
        let p = land_file("same");
        let f = crate::fake_claude::Fake::new(None, false).with_input("응").with_jsonl(&p);
        let n = send_land(&f, "응", Some(&p), false);
        assert_eq!(f.sent().0, vec!["응".to_string()], "'응응' 이 아니라: {n:?}");
    }

    /// 실측(일회용 세션 필요, 2026-11-05 send-stuck): 그림 경로를 붙여넣고 GAP ms 뒤 앱 길(type_keys_seen)로 말 — 표식(PT…)을 찍으니
    /// 기록에서 표식마다 user 줄 수를 센다. PASTETEST_ID=<짧은 id> PASTETEST_IMGS='/a.jpeg /b.jpeg' PASTETEST_N=6 PASTETEST_GAP=200
    /// cargo test --bin honor-orchestrator pty::tests::실측_그림_붙이고_바로_보내기 -- --ignored --exact --nocapture
    #[test]
    #[ignore]
    fn 실측_그림_붙이고_바로_보내기() {
        use std::io::Write;
        use std::time::{Duration, Instant};
        let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.into());
        let id = std::env::var("PASTETEST_ID").expect("PASTETEST_ID");
        let (imgs, n, gap) = (env("PASTETEST_IMGS", ""), env("PASTETEST_N", "4").parse::<u32>().unwrap(), env("PASTETEST_GAP", "200").parse::<u64>().unwrap());
        let parser = Arc::new(Mutex::new(vt100::Parser::new(40, 60, 0)));
        let p2 = parser.clone();
        let mut dim = crate::claude::DimAsItalic::default();
        let (_m, writer, mut child) = super::spawn_pty(&super::attach_line(&crate::claude::claude_bin(), &id, false), None, 60, 40, move |b| {
            dim.feed(&mut p2.lock().unwrap(), b);
            true
        })
        .unwrap();
        let w: super::SharedWriter = Arc::new(Mutex::new(writer));
        std::thread::sleep(Duration::from_secs(6));
        for i in 0..n {
            let mk = format!("PT{}{i}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() % 100000);
            w.lock().unwrap().write_all(format!("\x1b[200~{imgs} \x1b[201~").as_bytes()).unwrap();
            std::thread::sleep(Duration::from_millis(gap));
            let t = Instant::now();
            super::type_keys_seen(&w, &[format!("#img1 #img2 고양이 그림 하나 {mk} — 그림 색만 한 단어로")], Some(400), Some(&parser), None, false).unwrap();
            let left = crate::claude::input_holds(parser.lock().unwrap().screen(), &mk);
            eprintln!("MARK {mk} 치기 {:?} 남음 {left}", t.elapsed());
            std::thread::sleep(Duration::from_secs(20));
        }
        let _ = child.kill();
    }

    /// 실측(일회용 세션 필요, 2026-11-09 chat-send-stuck): 채팅 탭 길(type_keys_seen + 칸 화면) 그대로 여러 모양의 말을 보내고
    /// 화면·입력칸 읽기·블랙박스를 찍는다 — 기록(jsonl)에 들어갔나는 표식(CS…)으로 따로 센다.
    /// CHATSEND_ID=<짧은 id> CHATSEND_CASES='short,multi,long,img,file,busy' CHATSEND_IMG=<그림> CHATSEND_FILE=<파일> CHATSEND_COLS=100
    /// cargo test --bin honor-orchestrator pty::tests::실측_채팅_보내기 -- --ignored --exact --nocapture
    #[test]
    #[ignore]
    fn 실측_채팅_보내기() {
        use std::io::Write;
        use std::time::{Duration, Instant};
        let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.into());
        let id = std::env::var("CHATSEND_ID").expect("CHATSEND_ID");
        let (cols, rows) = (env("CHATSEND_COLS", "100").parse::<u16>().unwrap(), env("CHATSEND_ROWS", "40").parse::<u16>().unwrap());
        let parser = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, 0)));
        let p2 = parser.clone();
        let mut dim = crate::claude::DimAsItalic::default();
        let (_m, writer, mut child) = super::spawn_pty(&super::attach_line(&crate::claude::claude_bin(), &id, false), None, cols, rows, move |b| {
            dim.feed(&mut p2.lock().unwrap(), b);
            true
        })
        .unwrap();
        let w: super::SharedWriter = Arc::new(Mutex::new(writer));
        std::thread::sleep(Duration::from_secs(4));
        let dump = |tag: &str| {
            let s = parser.lock().unwrap().screen().clone();
            let body: Vec<String> = s.rows(0, cols).collect();
            let keep: Vec<&String> = body.iter().filter(|l| !l.trim().is_empty()).collect();
            if let Ok(d) = std::env::var("CHATSEND_DUMP") {
                let _ = std::fs::write(format!("{d}/{}.txt", tag.replace(' ', "_")), body.join("\n"));
            }
            eprintln!("--- {tag} 입력칸={:?}\n{}", crate::claude::input_lines(&s), keep.iter().rev().take(14).rev().map(|l| format!("|{l}")).collect::<Vec<_>>().join("\n"));
        };
        dump("붙은 뒤");
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() % 100000;
        let chunks = |t: &str| -> Vec<String> {
            let mut out = Vec::new();
            for (i, line) in t.split('\n').enumerate() {
                if i > 0 { out.push("\x1b\r".to_string()); }
                let cs: Vec<char> = line.chars().collect();
                for c in cs.chunks(200) { out.push(c.iter().collect()); }
            }
            out
        };
        let send = |label: &str, text: String| {
            let t = Instant::now();
            let n = super::type_keys_seen(&w, &chunks(&text), Some(400), Some(&parser), crate::send_land::Landing::for_session(&id, &text), false).unwrap();
            eprintln!("SEND {label} {:?} note={}", t.elapsed(), n.map_or("-".into(), |n| n.to_string()));
        };
        let paste = |path: &str| {
            w.lock().unwrap().write_all(format!("\x1b[200~\"{path}\" \x1b[201~").as_bytes()).unwrap();
        };
        for case in env("CHATSEND_CASES", "short").split(',') {
            let mk = format!("CS{stamp}{case}");
            match case {
                "short" => send(case, format!("{mk} .")),
                "dot" => send(case, ".".into()),
                // TUI 가 바쁜 동안(이벤트 루프 멈춤) 쳐진 글 + Enter — 세션 프로세스를 잠깐 세워 흉내 낸다(CHATSEND_PID, CHATSEND_STOP ms)
                "lag" | "lagmulti" => {
                    let pid = env("CHATSEND_PID", "");
                    let stop_ms: u64 = env("CHATSEND_STOP", "1500").parse().unwrap();
                    crate::platform::command("/bin/kill").args(["-STOP", &pid]).status().unwrap();
                    let t = if case == "lag" { format!("{mk} 바쁠 때 친 말") } else { format!("{mk} 첫 줄\n둘째 줄") };
                    let pid2 = pid.clone();
                    let resume = std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(stop_ms));
                        crate::platform::command("/bin/kill").args(["-CONT", &pid2]).status().unwrap();
                    });
                    send(case, t);
                    resume.join().unwrap();
                }
                "multi" => send(case, format!("{mk} 첫 줄\n둘째 줄\n셋째 줄")),
                "long" => send(case, format!("{mk} {}", "길게 쓴 말이야 ".repeat(60))),
                "img" => {
                    paste(&env("CHATSEND_IMG", ""));
                    std::thread::sleep(Duration::from_millis(400));
                    send(case, format!("#img1 {mk} 이 그림 한 단어로"));
                }
                "file" => {
                    paste(&env("CHATSEND_FILE", ""));
                    std::thread::sleep(Duration::from_millis(400));
                    send(case, format!("#file1 {mk} 이 파일 이름만"));
                }
                // 일하는 중에 그림 + 여러 줄 긴 말(11-09 회사 비서 캡처 모양) — 보낸 직후 화면을 덤프해 채팅 promptInput 에 넣어 본다
                "busyimg" => {
                    send("busyimg0", format!("{mk}0 1부터 150까지 숫자를 한 줄에 하나씩 써 줘(도구 없이)"));
                    std::thread::sleep(Duration::from_millis(2500));
                    paste(&env("CHATSEND_IMG", ""));
                    std::thread::sleep(Duration::from_millis(400));
                    send("busyimg1", format!("#img1 {mk}1 뭔가 이런 화면을 보여주는 느낌으로 업무를 해야도ㅅㄹ것 같거든?\n스페이스에서는 브라우저나 참모앱이 띄워져서 일을 하고 메모에 개인 기록도 해두고 참모랑 일하면서 참모가 막 오케스트레이션 하고 막 뭔말인지알지?"));
                    std::thread::sleep(Duration::from_millis(1200));
                    dump("busyimg 직후");
                }
                // 대기 말 빼기 실측 — 일하는 중 줄 선 말을 ↑ 로 입력칸에 꺼내 지우면 Claude 에 안 가나(11-09 사용자 'X 가 안 지워짐')
                "dropq" => {
                    let jsonl = env("CHATSEND_JSONL", "");
                    let count = |m: &str| std::fs::read_to_string(&jsonl).unwrap_or_default().lines().filter(|l| l.contains(m) && l.contains("\"type\":\"user\"")).count();
                    let ops = || std::fs::read_to_string(&jsonl).unwrap_or_default().lines().filter(|l| l.contains("queue-operation")).rev().take(4).map(|l| l.chars().take(140).collect::<String>()).collect::<Vec<_>>();
                    send("dropq0", format!("{mk}0 이번만 예외야: Bash 도구로 sleep 25 를 실행한 뒤 받음이라고 답해"));
                    std::thread::sleep(Duration::from_millis(6000));
                    send("dropq1", format!("{mk}1 빼낼 말"));
                    std::thread::sleep(Duration::from_millis(800));
                    dump("dropq 줄 섬");
                    w.lock().unwrap().write_all(b"\x1b[A").unwrap();
                    std::thread::sleep(Duration::from_millis(800));
                    dump("dropq 위 화살표 뒤");
                    eprintln!("OPS {:?}", ops());
                    let n = crate::claude::input_lines(parser.lock().unwrap().screen()).map_or(0, |b| b.concat().chars().count());
                    w.lock().unwrap().write_all("\x7f".repeat(n + 8).as_bytes()).unwrap();
                    std::thread::sleep(Duration::from_millis(800));
                    dump("dropq 지운 뒤");
                    std::thread::sleep(Duration::from_millis(25000));
                    eprintln!("DROPQ 빼낸 말 기록={} (0 이어야)", count(&format!("{mk}1")));
                    eprintln!("OPS {:?}", ops());
                }
                "busy" => {
                    send("busy0", format!("{mk}0 1부터 120까지 숫자를 한 줄에 하나씩 써 줘(도구 없이)"));
                    std::thread::sleep(Duration::from_millis(2500));
                    dump("일하는 중");
                    send("busy1", format!("{mk}1 ."));
                    std::thread::sleep(Duration::from_millis(1500));
                    send("busy2", format!("{mk}2 #img1 이거 좀 바꿔볼래"));
                }
                // 턴이 끝나는 순간 경합(chammo#18) — 짧게 답할 말을 보내고 d ms 뒤 다음 말. 기록에 몇 번 들어갔나 센다
                "race" | "raceimg" => {
                    let jsonl = env("CHATSEND_JSONL", "");
                    let count = |m: &str| std::fs::read_to_string(&jsonl).unwrap_or_default().lines().filter(|l| l.contains(m) && (l.contains("\"type\":\"user\"") || l.contains("enqueue"))).count();
                    for d in env("CHATSEND_DELAYS", "2000,2500,3000,3500,4000,4500,5000,6000").split(',') {
                        let d: u64 = d.parse().unwrap();
                        send("race-a", format!("{mk}a{d} 받음"));
                        std::thread::sleep(Duration::from_millis(d));
                        if case == "raceimg" {
                            paste(&env("CHATSEND_IMG", ""));
                            std::thread::sleep(Duration::from_millis(150));
                        }
                        send("race-b", format!("{mk}b{d} 응"));
                        std::thread::sleep(Duration::from_millis(9000));
                        let left = crate::claude::input_lines(parser.lock().unwrap().screen()).unwrap_or_default().concat();
                        eprintln!("RACE d={d} a={} b={} 입력칸={left:?}", count(&format!("{mk}a{d}")), count(&format!("{mk}b{d}")));
                        if !left.trim().is_empty() {
                            w.lock().unwrap().write_all(b"\r").unwrap();
                            std::thread::sleep(Duration::from_millis(6000));
                        }
                    }
                }
                _ => continue,
            }
            std::thread::sleep(Duration::from_millis(env("CHATSEND_GAP", "6000").parse().unwrap()));
            dump(&format!("{case} 뒤"));
        }
        let _ = child.kill();
    }

    /// E2E(진짜 세션 하나, 2026-11-13 stable-night): UserPromptSubmit 훅이 느린 세션 — 채팅 탭 길로 보내면 입력칸은 바로 비고 기록은 훅 뒤에 붙는다.
    /// 치기 결과가 'inflight'(채팅이 30초에 '전달 안 됨'을 안 띄움)이고, 기다리면 기록엔 한 번만 들어가야 한다.
    /// 일회용 세션: cd <팀 밖 신뢰 폴더> && claude --bg --dangerously-skip-permissions --model haiku --settings <UserPromptSubmit 에 sleep 40 훅> -n slow-hook "받음 한 단어로만 답해"
    /// E2E_HOOK_ID=<짧은 id> cargo test --bin honor-orchestrator pty::tests::e2e_느린_훅은_inflight_로_한_번 -- --ignored --exact --nocapture
    #[test]
    #[ignore]
    fn e2e_느린_훅은_inflight_로_한_번() {
        use std::time::{Duration, Instant};
        let id = std::env::var("E2E_HOOK_ID").expect("E2E_HOOK_ID");
        let parser = Arc::new(Mutex::new(vt100::Parser::new(40, 100, 0)));
        let p2 = parser.clone();
        let mut dim = crate::claude::DimAsItalic::default();
        let (_m, writer, mut child) = super::spawn_pty(&super::attach_line(&crate::claude::claude_bin(), &id, false), None, 100, 40, move |b| {
            dim.feed(&mut p2.lock().unwrap(), b);
            true
        })
        .unwrap();
        let w: super::SharedWriter = Arc::new(Mutex::new(writer));
        let t0 = Instant::now();
        while crate::claude::input_lines(parser.lock().unwrap().screen()).is_none() && t0.elapsed() < Duration::from_secs(15) {
            std::thread::sleep(Duration::from_millis(100));
        }
        let sid = crate::send_land::session_id_in(&crate::claude::agents_json().unwrap(), &id).expect("sessionId");
        let jsonl = crate::claude::transcript_path(&sid).expect("기록 파일");
        let mk = format!("HOOK{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() % 100000);
        let users = || std::fs::read_to_string(&jsonl).unwrap().lines().filter(|l| l.contains(&mk) && l.contains("\"type\":\"user\"")).count();
        let text = format!("{mk} 느린 훅 동안 보낸 말");
        let land = crate::send_land::Landing::for_session(&id, &text);
        assert!(land.is_some(), "기록 자리");
        let sent = Instant::now();
        let n = super::type_keys_seen(&w, &[text.clone()], Some(400), Some(&parser), land, false).unwrap().unwrap_or_default();
        eprintln!("SEND → {n} 결과={:?} {:?}", super::type_outcome(&n), sent.elapsed());
        assert_eq!(super::type_outcome(&n), "inflight", "{n:?}");
        while users() == 0 && sent.elapsed() < Duration::from_secs(150) {
            std::thread::sleep(Duration::from_millis(500));
        }
        eprintln!("기록에 붙음 {:?}", sent.elapsed());
        std::thread::sleep(Duration::from_secs(10));
        assert_eq!(users(), 1, "기록엔 한 번");
        let _ = child.kill();
    }

    /// E2E(진짜 세션 하나, 2026-11-09 chat-send-stuck · chammo#18): 채팅 탭 길(type_keys_seen + 칸 화면 + 기록 확인)로 보내고,
    /// 대화 기록(jsonl)에 그 말이 정확히 한 번·겹친 글 없이 들어갔나를 본다 — ① 보통 ② TUI 가 3초 멈춘 동안(느린 참모 흉내, SIGSTOP)
    /// ③ Enter 가 안 먹고 입력칸에 남은 말 + 다시 보내기 ④ 같은데 화면 사본 없이(윈도우·엉킨 사본) ⑤ 일하는 중(대기열).
    /// 일회용 세션: cd <팀 밖 신뢰 폴더> && claude --bg --dangerously-skip-permissions --model haiku -n e2e-send "어떤 말이 와도 '받음' 한 단어로만 답해"
    /// E2E_SEND_ID=<짧은 id> E2E_SEND_PID=<agents 의 pid> cargo test --bin honor-orchestrator pty::tests::e2e_보낸_말은_기록에_한_번 -- --ignored --exact --nocapture
    #[test]
    #[ignore]
    fn e2e_보낸_말은_기록에_한_번() {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::{Duration, Instant};
        let id = std::env::var("E2E_SEND_ID").expect("E2E_SEND_ID");
        let pid = std::env::var("E2E_SEND_PID").expect("E2E_SEND_PID");
        let (cols, rows) = (100u16, 40u16);
        let parser = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, 0)));
        let p2 = parser.clone();
        let mut dim = crate::claude::DimAsItalic::default();
        // E2E_LAZY_CLIP=1 — 보기가 붙는 동안 클립보드 그림 주인이 답을 안 한다(2026-11-10 멈춤 모양). ① 이 끝나면 놓는다
        let mut clip = std::env::var("E2E_LAZY_CLIP").ok().map(|_| crate::fake_claude::LazyClip::hang(15));
        let last_out = Arc::new(AtomicU64::new(0));
        let lo = last_out.clone();
        let (_m, writer, mut child) = super::spawn_pty(&super::attach_line(&crate::claude::claude_bin(), &id, false), None, cols, rows, move |b| {
            lo.store(super::now_ms(), Ordering::Relaxed);
            dim.feed(&mut p2.lock().unwrap(), b);
            true
        })
        .unwrap();
        let w: super::SharedWriter = Arc::new(Mutex::new(writer));
        super::calm_focus_when_drawn(w.clone(), last_out); // 앱 터미널 보기(pty_open)와 같이
        let t0 = Instant::now();
        while crate::claude::input_lines(parser.lock().unwrap().screen()).is_none() && t0.elapsed() < Duration::from_secs(15) {
            std::thread::sleep(Duration::from_millis(100));
        }
        let sid = crate::send_land::session_id_in(&crate::claude::agents_json().unwrap(), &id).expect("sessionId");
        let jsonl = crate::claude::transcript_path(&sid).expect("기록 파일");
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() % 100000;
        // 그 표식이 든 사람 말(user 글·대기열 enqueue)의 글들 — 대기열로 간 말은 enqueue 와 user 두 줄이라 사람 말 줄만 센다
        let users = |mk: &str| -> Vec<String> {
            std::fs::read_to_string(&jsonl).unwrap().lines().filter(|l| l.contains(mk)).filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok()).filter(|v| v["type"] == "user").map(|v| match &v["message"]["content"] {
                serde_json::Value::String(s) => s.clone(),
                c => c.as_array().into_iter().flatten().filter_map(|x| x["text"].as_str()).collect::<Vec<_>>().join("|"),
            }).collect()
        };
        let idle = || {
            let t = Instant::now();
            while t.elapsed() < Duration::from_secs(60) {
                crate::claude::forget_agents();
                let s = crate::claude::agents_json().unwrap_or_default();
                if serde_json::from_str::<serde_json::Value>(&s).ok().and_then(|v| v.as_array().cloned()).unwrap_or_default().iter().any(|a| a["id"] == id.as_str() && a["status"] == "idle") {
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        };
        let send = |text: &str, again: bool, screen: bool| -> super::TypeNote {
            // 목록 읽기(claude agents)가 바쁜 맥에서 한 번씩 실패한다 — 그땐 앱도 확인만 건너뛴다. 시험은 다시 묻는다
            let land = (0..5).find_map(|_| crate::send_land::Landing::for_session(&id, text).or_else(|| {
                crate::claude::forget_agents();
                std::thread::sleep(Duration::from_millis(500));
                None
            }));
            assert!(land.is_some(), "기록 자리를 찾아야 한다");
            let n = super::type_keys_seen(&w, &[text.to_string()], Some(400), screen.then_some(&parser), land, again).unwrap();
            let n = n.unwrap_or_default();
            eprintln!("SEND {text:?} again={again} screen={screen} → {n}");
            n
        };
        let check = |mk: &str, text: &str| {
            let t = Instant::now();
            while users(mk).is_empty() && t.elapsed() < Duration::from_secs(20) {
                std::thread::sleep(Duration::from_millis(200));
            }
            std::thread::sleep(Duration::from_secs(2));
            let got = users(mk);
            eprintln!("CHECK {mk} → {got:?}");
            assert_eq!(got.len(), 1, "{mk}: 정확히 한 번 — {got:?}");
            assert!(crate::send_land::land_norm(&got[0]).matches(&crate::send_land::land_norm(text)).count() == 1, "{mk}: 겹친 글 없이 — {got:?}");
        };
        // ① 보통
        idle();
        let mk = format!("E2E{stamp}a");
        let n = send(&format!("{mk} 보통 말"), false, true);
        assert_eq!(n.landed, Some(true));
        check(&mk, &format!("{mk} 보통 말"));
        if let Some(c) = clip.take() {
            assert!(!c.was_asked(), "보기가 붙어도 세션이 클립보드를 보지 않아야(포커스 나감)");
        }
        // ② TUI 가 3초 멈춘 동안 — 화면 사본은 친 글을 못 보지만 기록으로 끝을 안다(다시 치지 않는다)
        idle();
        let mk = format!("E2E{stamp}b");
        crate::platform::command("/bin/kill").args(["-STOP", &pid]).status().unwrap();
        let pid2 = pid.clone();
        let go = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(3000));
            crate::platform::command("/bin/kill").args(["-CONT", &pid2]).status().unwrap();
        });
        let n = send(&format!("{mk} 바쁠 때 친 말"), false, true);
        go.join().unwrap();
        assert!(!n.retyped, "느린 TUI 에 다시 치면 두 번 간다: {n:?}");
        check(&mk, &format!("{mk} 바쁠 때 친 말"));
        // ③ Enter 가 안 먹어 입력칸에 남은 말(Enter 없이 쳐 둠) → 다시 보내기
        idle();
        let mk = format!("E2E{stamp}c");
        let text = format!("{mk} 남은 말");
        super::type_keys_seen(&w, &[text.clone()], None, Some(&parser), None, false).unwrap();
        std::thread::sleep(Duration::from_millis(800));
        let n = send(&text, true, true);
        assert!(n.again, "남은 그 말이면 치지 않는다: {n:?}");
        check(&mk, &text);
        // ④ 같은데 화면 사본 없이 — Enter 먼저, 기록에 들어오면 끝
        idle();
        let mk = format!("E2E{stamp}d");
        let text = format!("{mk} 남은 말 화면 없이");
        super::type_keys_seen(&w, &[text.clone()], None, Some(&parser), None, false).unwrap();
        std::thread::sleep(Duration::from_millis(800));
        let n = send(&text, true, false);
        assert_eq!((n.again, n.landed), (true, Some(true)), "{n:?}");
        check(&mk, &text);
        // ⑤ 일하는 중 — 대기열(enqueue)로 들어가도 들어간 것
        idle();
        let mk = format!("E2E{stamp}e");
        send(&format!("{mk}0 1부터 60까지 숫자를 한 줄에 하나씩 써 줘(도구 없이)"), false, true);
        std::thread::sleep(Duration::from_millis(1500));
        let n = send(&format!("{mk}1 일하는 중에 보낸 말"), false, true);
        assert_eq!(n.landed, Some(true), "대기열도 들어간 것: {n:?}");
        check(&format!("{mk}1"), &format!("{mk}1 일하는 중에 보낸 말"));
        let _ = child.kill();
    }
}
