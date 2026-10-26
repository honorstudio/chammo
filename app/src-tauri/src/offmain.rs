//! 사용자 폴더를 건드리는 동기 명령을 메인 스레드 밖에서 돌린다.
//! 동기 `#[tauri::command]` 는 메인 스레드에서 돈다 — 데스크톱·문서·다운로드(맥 TCC)·느린 NAS 를 여는 순간 권한 창이 사람 답을
//! 기다리며 그 열기를 붙잡으면 IPC·화면·appctl 이 다 섰다(10-25 QA 두 번: 슬래시 목록, 보관함 locker_migrate → ~/Desktop/스크린샷).
//! 명령 코드는 그대로 두고 invoke 를 받는 자리(메인 스레드)에서 이름으로 갈라 보낸다:
//! - READ  = 읽기 — 블로킹 풀(spawn_blocking)에서 같이. 하나가 권한 창에 붙잡혀도 나머지·tokio 일꾼은 안 막힌다
//! - WRITE = 쓰기(+순서가 중요한 것) — 쓰기 전용 스레드 하나에서 받은 순서대로. 넣는 건 메인 스레드라 IPC 순서 = 실행 순서
//!   (메인 스레드가 지켜 주던 '같은 문서 쓰기 둘·보관함 고치기 둘' 순서를 그대로 지킨다)
//! 데이터 폴더(~/.honor-orchestrator·CHAMMO_HOME)만 만지는 명령은 메인 스레드 그대로 — 시험이 목록을 지킨다.
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};

/// 사용자 경로를 읽는 동기 명령 — 블로킹 풀
pub const READ: &[&str] = &[
    // reader — 데스크톱·문서·devRoot 문서 읽기
    "first_existing", "read_doc_text", "doc_stamp", "list_md", "list_dir", "read_doc_bytes", "list_md_deep", "read_show_log", "moved_paths",
    "reader_open",
    // hq·project·도구·교훈
    "folder_status", "harness_project", "memory_files_for",
    // 보관함(~/Documents/Chammo) 읽기
    "locker_peek", "locker_tree", "locker_versions", "locker_find", "locker_recent_shots", "locker_reveal",
    // ~/.claude·~/.claude.json(링크면 어디로든)
    "accounts_view", "daemon_started_at", "claude_defaults_snapshot", "bypass_consent", "daemon_env_check",
    // 화면이 넘긴 아무 경로·설정에 적힌 경로
    "open_target", "sheet_open", "tts_warm", "agent_drop_files", "read_memos",
    // portable-pty 가 부르는 스레드에서 cwd(devRoot 프로젝트)를 is_dir 로 본다
    "pty_open",
    // 모드 목록 — 사용자가 더한 모드 폴더(scripts/app mode add)를 stat·읽기
    "mode_list", "mode_state", "rebuild_menu",
    // Craft 독 — 앱 번들(devRoot 에 빌드한 판일 수 있다) Info.plist stat, 최근 파일(사용자 문서) exists
    "craft_dock", "craft_recent",
];

/// 사용자 경로에 쓰거나 순서가 중요한 동기 명령 — 쓰기 전용 스레드 하나
pub const WRITE: &[&str] = &[
    // 스페이스 문서·그림(홈 안 아무 폴더)
    "write_doc_text", "keep_doc_version", "save_asset", "copy_asset",
    // 보관함 고치기
    "locker_migrate", "locker_put", "locker_mkdir", "locker_rename_at", "locker_move_to", "locker_alias", "locker_new_doc",
    "locker_restore", "locker_give", "locker_back", "locker_relink", "locker_connect", "locker_disconnect",
    "locker_trash_last", "locker_trash_undo",
    // hq 만들기·폴더 만들기·프로젝트 CLAUDE.local.md 교훈 빼기
    "create_hq", "make_dir", "unmirror_lesson",
    // ~/.claude/settings.json·설정에 적힌 메모 폴더
    "claude_defaults_restore", "bypass_consent_accept", "append_memo", "write_memo",
    // live.json 쓰기 전에 팀 뿌리(devRoot read_dir)를 훑는다
    "write_live_snap",
    // 보는 칸 수 +1/-1 — 순서가 바뀌면 숫자가 틀린다, 깨울 땐 더한 모드 폴더 stat
    "mode_seen",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lane {
    Main,
    Read,
    Write,
}

pub fn lane(cmd: &str) -> Lane {
    if WRITE.contains(&cmd) {
        Lane::Write
    } else if READ.contains(&cmd) {
        Lane::Read
    } else {
        Lane::Main
    }
}

type Job = Box<dyn FnOnce() + Send + 'static>;

/// 쓰기 전용 스레드 — 처음 쓸 때 띄운다. 일 하나가 패닉해도 다음 일은 돈다(그 invoke 만 답을 못 받는다)
fn writer() -> &'static Mutex<mpsc::Sender<Job>> {
    static W: OnceLock<Mutex<mpsc::Sender<Job>>> = OnceLock::new();
    W.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("chammo-fs-write".into())
            .spawn(move || {
                for job in rx {
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
                }
            })
            .expect("fs write thread");
        Mutex::new(tx)
    })
}

/// 갈래대로 보낸다 — Main 은 부른 스레드에서 바로, 나머지는 넣고 바로 돌아온다
pub fn send(lane: Lane, job: Job) {
    match lane {
        Lane::Main => job(),
        Lane::Read => {
            tauri::async_runtime::spawn_blocking(job);
        }
        Lane::Write => {
            let _ = writer().lock().unwrap_or_else(|e| e.into_inner()).send(job);
        }
    }
}

/// invoke_handler 감싸기 — READ·WRITE 이름이면 다른 스레드로 넘기고 메인 스레드는 바로 돌아온다
pub fn dispatch(
    handler: impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    let handler = Arc::new(handler);
    move |invoke| match lane(invoke.message.command()) {
        Lane::Main => handler(invoke),
        l => {
            let h = handler.clone();
            send(l, Box::new(move || {
                h(invoke);
            }));
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::time::{Duration, Instant};

    /// 열면 쓰는 쪽이 올 때까지 막히는 파일(FIFO) — 맥 권한 창에 붙잡힌 열기 흉내(slash.rs 시험과 같은 수)
    fn fifo(p: &Path) {
        let c = std::ffi::CString::new(p.to_string_lossy().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0);
    }

    /// 사람이 권한 창에 답한 셈 — 쓰는 쪽으로 열고 닫으면 막혀 있던 읽기가 빈 글을 받고 풀린다.
    /// 막지 않는 열기를 일이 끝났다고 할 때까지 되풀이 — 한 번만 열면 그 사이 다른 프로세스(Spotlight 등)가 같은 FIFO 를
    /// 먼저 열어 짝을 가로채거나 일이 아직 open 에 닿기 전이면 진짜 읽기가 영영 남는다(전체 시험에서 한 번 굳음)
    fn release_until(p: &Path, rx: &mpsc::Receiver<&'static str>, want: &'static str) {
        use std::os::unix::fs::OpenOptionsExt;
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(10) {
            drop(std::fs::OpenOptions::new().write(true).custom_flags(libc::O_NONBLOCK).open(p));
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(got) => {
                    assert_eq!(got, want);
                    return;
                }
                Err(_) => continue,
            }
        }
        panic!("{want} 이 안 끝남");
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-offmain-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn wait_for(rx: &mpsc::Receiver<&'static str>, what: &str) -> &'static str {
        rx.recv_timeout(Duration::from_secs(10)).unwrap_or_else(|_| panic!("{what} 이 안 끝남"))
    }

    #[test]
    fn 이름으로_갈래를_고른다() {
        assert_eq!(lane("locker_migrate"), Lane::Write);
        assert_eq!(lane("locker_tree"), Lane::Read);
        assert_eq!(lane("read_config"), Lane::Main);
        assert!(READ.iter().all(|n| !WRITE.contains(n)), "READ·WRITE 에 같은 이름");
    }

    /// 10-25 QA 가 sample 로 본 길 — 보관함을 열면 locker_migrate 가 사용자 폴더 열기에서 붙잡혔다.
    /// 쓰기 갈래로 보내면 부른 쪽(메인 스레드)은 바로 돌아오고, 뒤에 넣은 쓰기는 순서대로 기다리고, 읽기는 그동안 따로 돈다
    #[test]
    fn 보관함_옮기기가_권한_창에_붙잡혀도_메인은_안_막히고_쓰기는_순서대로() {
        let t = tmp("migrate");
        let (home, data, root) = (t.join("home"), t.join("data"), t.join("root"));
        for d in [&home, &data, &root] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(data.join(crate::locker_fs::OPENED_MARK), "").unwrap();
        let pipe = data.join("locker.jsonl");
        fifo(&pipe);
        let (tx, rx) = mpsc::channel::<&'static str>();

        let at = Instant::now();
        let (h, d, r, tx1) = (home.clone(), data.clone(), root.clone(), tx.clone());
        send(lane("locker_migrate"), Box::new(move || {
            tx1.send("started").unwrap();
            let ctx = crate::locker_fs::Ctx { home: &h, data: &d, root: &r, settled: &[] };
            let _ = crate::locker_fs::migrate_all(&ctx, &[], None);
            tx1.send("migrate").unwrap();
        }));
        let tx2 = tx.clone();
        send(lane("locker_put"), Box::new(move || tx2.send("put").unwrap()));
        assert!(at.elapsed() < Duration::from_millis(200), "보내는 쪽이 막혔다: {:?}", at.elapsed());

        // 읽기는 쓰기 스레드가 붙잡힌 동안에도 돈다
        assert_eq!(wait_for(&rx, "옮기기 시작"), "started");
        let tx3 = tx.clone();
        send(lane("locker_tree"), Box::new(move || tx3.send("tree").unwrap()));
        assert_eq!(wait_for(&rx, "읽기"), "tree");
        // 옮기기는 진짜로 붙잡혀 있고, 뒤의 쓰기는 앞질러 가지 않는다
        assert!(rx.recv_timeout(Duration::from_millis(400)).is_err(), "FIFO 가 안 막았다 — 시험이 아무것도 안 잰다");

        release_until(&pipe, &rx, "migrate");
        assert_eq!(wait_for(&rx, "뒤 쓰기"), "put");
        let _ = std::fs::remove_dir_all(&t);
    }

    /// 하니터 스캔도 설정 파일 열기에서 붙잡힐 수 있다 — 읽기 갈래(블로킹 풀)면 부른 쪽은 바로 돌아오고 다른 읽기도 같이 돈다
    #[test]
    fn 하니터_스캔이_붙잡혀도_부른_쪽과_다른_읽기는_안_막힌다() {
        let home = tmp("harnitor");
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        let pipe = home.join(".claude/settings.json");
        fifo(&pipe);
        let (tx, rx) = mpsc::channel::<&'static str>();

        let at = Instant::now();
        let (h, tx1) = (home.clone(), tx.clone());
        send(Lane::Read, Box::new(move || {
            tx1.send("started").unwrap();
            let _ = harnitor_core::scan_with(&h, &harnitor_core::ScanOptions { skip_usage: true, ..Default::default() });
            tx1.send("scan").unwrap();
        }));
        assert!(at.elapsed() < Duration::from_millis(200), "보내는 쪽이 막혔다: {:?}", at.elapsed());
        assert_eq!(wait_for(&rx, "스캔 시작"), "started");
        let tx2 = tx.clone();
        send(Lane::Read, Box::new(move || tx2.send("other").unwrap()));
        assert_eq!(wait_for(&rx, "다른 읽기"), "other");
        assert!(rx.recv_timeout(Duration::from_millis(400)).is_err(), "FIFO 가 안 막았다 — 시험이 아무것도 안 잰다");

        release_until(&pipe, &rx, "scan");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// 쓰기 일 하나가 패닉해도 쓰기 스레드는 산다 — 안 그러면 그 뒤 쓰기가 영영 답을 못 받는다
    #[test]
    fn 쓰기_일이_패닉해도_다음_쓰기는_돈다() {
        let (tx, rx) = mpsc::channel::<&'static str>();
        send(Lane::Write, Box::new(|| panic!("시험 패닉")));
        send(Lane::Write, Box::new(move || tx.send("next").unwrap()));
        assert_eq!(wait_for(&rx, "다음 쓰기"), "next");
    }
}
