//! 명령 하나를 pty 로 띄우고, 출력은 Channel 로 웹뷰에 흘리고, 입력·크기 변경을 받는다.
//! spike(2026-09-25)에서 6창 동시 지연 p95 31ms 로 검증한 구조 그대로.

use portable_pty::{native_pty_system, Child, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

type SharedWriter = std::sync::Arc<Mutex<Box<dyn Write + Send>>>;

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: SharedWriter,
    child: Box<dyn Child + Send + Sync>,
}

/// 열린 터미널 보기가 어느 세션에 붙어 있나(pty id, 세션 id, 쓰기) — 윈도우는 claude attach 가 세션당 한 창만 붙게 해서,
/// 키를 넣으려고 새로 붙으면 터미널 보기가 "Session opened in another window" 로 쫓겨났다(2026-10-01). 열린 것에 바로 쓴다
static OPEN: Mutex<Vec<(u32, String, SharedWriter)>> = Mutex::new(Vec::new());

/// 이 세션에 붙어 있는 터미널 보기의 쓰기(가장 최근 것). 없으면 None
pub(crate) fn session_writer(session: &str) -> Option<SharedWriter> {
    OPEN.lock().unwrap().iter().rev().find(|(_, s, _)| s == session).map(|(_, _, w)| w.clone())
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
    let (master, writer, child) = spawn_pty(&command, cwd, cols, rows, move |b| on_data.send(InvokeResponseBody::Raw(b.to_vec())).is_ok())?;
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    let writer: SharedWriter = std::sync::Arc::new(Mutex::new(writer));
    if let Some(session) = session_of(&command) {
        OPEN.lock().unwrap().push((id, session, writer.clone()));
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
    OPEN.lock().unwrap().retain(|(pid, _, _)| *pid != id);
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
