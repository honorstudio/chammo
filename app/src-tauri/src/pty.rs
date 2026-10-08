//! 명령 하나를 pty 로 띄우고, 출력은 Channel 로 웹뷰에 흘리고, 입력·크기 변경을 받는다.
//! spike(2026-09-25)에서 6창 동시 지연 p95 31ms 로 검증한 구조 그대로.

use portable_pty::{native_pty_system, Child, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

type SharedWriter = Arc<Mutex<Box<dyn Write + Send>>>;

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: SharedWriter,
    child: Box<dyn Child + Send + Sync>,
}

/// 열린 터미널 보기 하나 — 어느 세션에 붙었나·쓰기·지금까지 받은 눈에 보이는 글자 수(Visible)
struct OpenView {
    pty: u32,
    session: String,
    writer: SharedWriter,
    visible: Arc<AtomicUsize>,
}

/// 열린 터미널 보기가 어느 세션에 붙어 있나 — 윈도우는 claude attach 가 세션당 한 창만 붙게 해서,
/// 키를 넣으려고 새로 붙으면 터미널 보기가 "Session opened in another window" 로 쫓겨났다(2026-10-01). 열린 것에 바로 쓴다
static OPEN: Mutex<Vec<OpenView>> = Mutex::new(Vec::new());

/// 눈에 보이는 글자가 이만큼은 와야 세션에 붙은 보기로 친다 — 붙은 claude 화면은 입력칸 테두리만으로 수백 바이트다.
/// 윈도우 가짜 콘솔이 첫 "커서 어디?"(ESC[6n)에 답을 못 받으면 자식을 영영 안 띄우는데, 그런 보기에 쓰면
/// 오류 없이 들어가고 세션엔 안 닿았다(2026-10-05 윈도우 QA, 폰에서 보낸 글이 사라짐). 바이트로 세면 답을 받은 콘솔의
/// 빈 화면 지우기(ESC[K 줄들, 2KB 가까이)만으로 넘어서 attach 가 바로 죽은 보기도 붙은 걸로 보인다 — 글자만 센다
const VIEW_READY_VISIBLE: usize = 200;

/// 터미널 출력에서 이스케이프(CSI·OSC 등)와 공백·제어 문자를 뺀 바이트 수 — 조각 경계에 걸친 이스케이프도 이어서 건너뛴다
#[derive(Default)]
struct Visible {
    st: u8, // 0 글자, 1 ESC 뒤, 2 CSI 안, 3 OSC 등 문자열 안, 4 문자열 안 ESC 뒤
}

impl Visible {
    fn count(&mut self, b: &[u8]) -> usize {
        let mut n = 0;
        for &c in b {
            self.st = match (self.st, c) {
                (_, 0x1b) if self.st != 3 && self.st != 4 => 1,
                (0, c) => {
                    n += usize::from(c > b' ' && c != 0x7f);
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
        n
    }
}

/// 이 세션에 붙어 있는 터미널 보기의 쓰기 — 화면이 실제로 온 것 중 가장 최근 것. 없으면 None(새로 붙는다)
pub(crate) fn session_writer(session: &str) -> Option<SharedWriter> {
    ready_view(&OPEN.lock().unwrap(), session)
}

/// 이 세션에 열린 터미널 보기가 있나(화면이 왔든 아직이든) — 화면만 읽으려고 새로 붙으면 열린 보기가 쫓겨난다
pub(crate) fn session_has_view(session: &str) -> bool {
    OPEN.lock().unwrap().iter().any(|v| v.session == session)
}

fn ready_view(open: &[OpenView], session: &str) -> Option<SharedWriter> {
    open.iter().rev().find(|v| v.session == session && v.visible.load(Ordering::Relaxed) >= VIEW_READY_VISIBLE).map(|v| v.writer.clone())
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
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if !on_data(&buf[..n]) {
                        break;
                    }
                }
            }
        }
    });
    Ok((pair.master, writer, child))
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
    state: State<Ptys>,
    command: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel,
) -> Result<u32, String> {
    let visible = Arc::new(AtomicUsize::new(0));
    let seen = visible.clone();
    let mut counter = Visible::default();
    let (master, writer, child) = spawn_pty(&command, cwd, cols, rows, move |b| {
        // 문턱만 넘으면 되니 넘은 뒤엔 안 센다
        if seen.load(Ordering::Relaxed) < VIEW_READY_VISIBLE {
            seen.fetch_add(counter.count(b), Ordering::Relaxed);
        }
        on_data.send(InvokeResponseBody::Raw(b.to_vec())).is_ok()
    })?;
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    let writer: SharedWriter = Arc::new(Mutex::new(writer));
    if let Some(session) = session_of(&command) {
        OPEN.lock().unwrap().push(OpenView { pty: id, session, writer: writer.clone(), visible });
    }
    state.map.lock().unwrap().insert(id, Pty { master, writer, child });
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
    let mut map = state.map.lock().unwrap();
    let p = map.get_mut(&id).ok_or(crate::i18n::tr("없는 pty", "No such pty"))?;
    #[cfg(debug_assertions)]
    log_write(id, &data);
    let r = p.writer.lock().unwrap().write_all(data.as_bytes()).map_err(|e| e.to_string());
    r
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
    let map = state.map.lock().unwrap();
    let p = map.get(&id).ok_or(crate::i18n::tr("없는 pty", "No such pty"))?;
    p.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

/// attach 클라이언트만 끊는다 — 세션 자체는 백그라운드에서 계속 돈다
#[tauri::command]
pub fn pty_close(state: State<Ptys>, id: u32) {
    crate::ptt::forget(id);
    OPEN.lock().unwrap().retain(|v| v.pty != id);
    if let Some(p) = state.map.lock().unwrap().remove(&id) {
        reap(p.child);
    }
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
    use super::{attach_line, session_of};

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
        super::OpenView { pty, session: session.into(), writer: std::sync::Arc::new(std::sync::Mutex::new(w)), visible: std::sync::Arc::new(visible.into()) }
    }

    fn picked(open: &[super::OpenView], session: &str) -> Option<u32> {
        let w = super::ready_view(open, session)?;
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
