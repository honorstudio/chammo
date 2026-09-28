//! 명령 하나를 pty 로 띄우고, 출력은 Channel 로 웹뷰에 흘리고, 입력·크기 변경을 받는다.
//! spike(2026-09-25)에서 6창 동시 지연 p95 31ms 로 검증한 구조 그대로.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
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
#[tauri::command]
pub fn pty_open(
    state: State<Ptys>,
    command: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel,
) -> Result<u32, String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.args(["-lc", &command]);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if let Some(dir) = cwd.or_else(|| std::env::var("HOME").ok()) {
        cmd.cwd(dir);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;

    // pty 마다 읽기 스레드 하나 — 한 창이 출력을 쏟아도 다른 창이 안 밀린다
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
    });

    state.map.lock().unwrap().insert(id, Pty { master: pair.master, writer, child });
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<Ptys>, id: u32, data: String) -> Result<(), String> {
    let mut map = state.map.lock().unwrap();
    let p = map.get_mut(&id).ok_or(crate::i18n::tr("없는 pty", "No such pty"))?;
    #[cfg(debug_assertions)]
    log_write(id, &data);
    p.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
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
    if let Some(mut p) = state.map.lock().unwrap().remove(&id) {
        let _ = p.child.kill();
    }
}
