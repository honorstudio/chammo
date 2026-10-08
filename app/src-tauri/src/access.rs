//! 프로젝트 폴더(devRoot)를 앱이 정말 읽을 수 있나.
//! 맥은 앱을 새로 깔거나 이름을 바꾸면 '데스크탑 폴더'·'전체 디스크 접근' 승인이 풀릴 수 있다 — 그러면 devRoot 읽기가
//! Operation not permitted 이고 `claude --bg` 는 'An unknown error occurred (Unexpected)' 로만 실패해 원인이 안 보였다(2026-10-06 이슈 #1).
//! 그래서 첫 실행에만 묻지 않고 켤 때마다·주기적으로 실제로 읽어 본다. 맥 권한 창이 떠 있으면 읽기가 답을 기다리며 멈추니
//! 몇 초만 기다리고 '대기'로 둔다(2026-10-05 아이맥 QA: 설치 끝 정리가 그 창 답을 기다리며 멈췄다)
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum State {
    Ok,
    /// 맥 개인정보 보호(TCC)가 막음 — EPERM. 시스템 설정에서 켜야 한다
    Denied,
    /// 파일 권한(chmod)이 막음 — EACCES
    NoPerm,
    /// 폴더가 없음
    Missing,
    /// 읽기가 몇 초 안에 안 끝남 — 보통 맥 권한 창이 답을 기다리는 중
    Pending,
    Error,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Access {
    pub state: State,
    /// 읽어 본 폴더(펼친 경로). 안 읽었으면 빈 칸
    pub dir: String,
    /// 맥 보호 폴더(데스크탑·문서·다운로드) 아래 — 안내 문구를 고른다
    pub protected: bool,
    /// 오류 원문(Error 일 때)
    pub detail: String,
}

/// 읽기 오류 → 상태. EPERM(1)과 EACCES(13)는 Rust 에선 둘 다 PermissionDenied 라 번호로 가른다
pub fn classify(e: &std::io::Error) -> State {
    #[cfg(unix)]
    match e.raw_os_error() {
        Some(1) => return State::Denied,
        Some(13) => return State::NoPerm,
        _ => {}
    }
    match e.kind() {
        std::io::ErrorKind::NotFound => State::Missing,
        std::io::ErrorKind::PermissionDenied => State::NoPerm,
        _ => State::Error,
    }
}

/// 맥이 앱마다 따로 허락받게 하는 폴더(데스크탑·문서·다운로드) 안인가
pub fn protected(dir: &str, home: &str) -> bool {
    if cfg!(windows) || home.is_empty() {
        return false;
    }
    let d = dir.trim_end_matches('/');
    ["Desktop", "Documents", "Downloads"].iter().any(|f| {
        let p = format!("{}/{f}", home.trim_end_matches('/'));
        d == p || d.starts_with(&format!("{p}/"))
    })
}

/// 지금 읽는 중인 폴더 — 권한 창 답을 기다리며 멈춘 읽기가 있으면 또 띄우지 않는다(멈춘 스레드가 쌓이지 않게)
static INFLIGHT: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn inflight(dir: &str, on: bool) -> bool {
    let mut g = INFLIGHT.lock().unwrap_or_else(|e| e.into_inner());
    let set = g.get_or_insert_with(HashSet::new);
    if on { set.insert(dir.to_string()) } else { set.remove(dir) }
}

/// read 를 뒤에서 돌리고 wait 까지만 기다린다. 같은 폴더 읽기가 아직 안 끝났으면 바로 Pending
pub fn probe_with(dir: &str, wait: Duration, read: impl FnOnce() -> std::io::Result<()> + Send + 'static) -> (State, String) {
    if !inflight(dir, true) {
        return (State::Pending, String::new());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let key = dir.to_string();
    std::thread::spawn(move || {
        let r = read();
        inflight(&key, false);
        let _ = tx.send(r);
    });
    match rx.recv_timeout(wait) {
        Ok(Ok(())) => (State::Ok, String::new()),
        Ok(Err(e)) => (classify(&e), e.to_string()),
        Err(_) => (State::Pending, String::new()),
    }
}

/// 폴더를 실제로 열어 본다(목록 읽기 = 맥이 권한을 따지는 그 자리)
pub fn probe(dir: &str, home: &str) -> Access {
    let d = dir.to_string();
    let (state, detail) = probe_with(dir, Duration::from_secs(3), move || std::fs::read_dir(&d).map(|_| ()));
    Access { state, dir: dir.to_string(), protected: protected(dir, home), detail }
}

/// 앱이 띄운 `claude --bg` 가 실패했을 때 — 'Unexpected' 처럼 이유가 없는 오류면 그 폴더를 읽어 보고, 맥이 막은 거면 이유를 붙인다
pub fn explain_spawn_error(err: &str, cwd: &str) -> String {
    if !err.contains("Unexpected") {
        return err.to_string();
    }
    match probe(cwd, &crate::config::home()).state {
        State::Denied => format!("{err}\n{}", crate::i18n::tr(
            "맥이 이 폴더 접근을 막고 있어요 — 시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한에서 Chammo 를 켜고 앱을 다시 켜 주세요.",
            "macOS is blocking access to this folder — turn on Chammo in System Settings → Privacy & Security → Full Disk Access, then reopen the app.")),
        State::NoPerm => format!("{err}\n{}", crate::i18n::tr("이 폴더를 읽을 권한이 없어요(파일 권한).", "No permission to read this folder (file permissions).")),
        _ => err.to_string(),
    }
}

/// 프로젝트 폴더 읽기 점검 — dir 를 주면 그 폴더(마법사가 고르는 중인 값), 안 주면 저장된 devRoot.
/// 저장된 devRoot 는 설정을 마친 뒤에만 읽는다(마법사 전에 데스크탑을 건드리면 권한 창이 뜬다). 잘 읽히면 그 아래 프로젝트 믿음도 챙긴다(trust.rs)
#[tauri::command]
pub async fn project_access(dir: Option<String>) -> Access {
    tauri::async_runtime::spawn_blocking(move || {
        let home = crate::config::home();
        let c = crate::config::current();
        let saved = dir.is_none();
        if saved && !c.setup_done {
            return Access { state: State::Ok, dir: String::new(), protected: false, detail: String::new() };
        }
        let d = crate::config::expand(&home, dir.as_deref().unwrap_or(&c.dev_root));
        let a = probe(&d, &home);
        if saved && a.state == State::Ok {
            crate::trust::sweep(&d);
        }
        a
    })
    .await
    .unwrap_or(Access { state: State::Error, dir: String::new(), protected: false, detail: "join".into() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Error, ErrorKind};

    #[cfg(unix)]
    #[test]
    fn 맥이_막은_것과_파일_권한을_가른다() {
        assert_eq!(classify(&Error::from_raw_os_error(1)), State::Denied); // Operation not permitted — 이슈 #1 그대로
        assert_eq!(classify(&Error::from_raw_os_error(13)), State::NoPerm); // Permission denied (chmod)
        assert_eq!(classify(&Error::from_raw_os_error(2)), State::Missing);
        assert_eq!(classify(&Error::from(ErrorKind::Other)), State::Error);
    }

    #[test]
    fn 보호_폴더() {
        let h = "/Users/me";
        assert_eq!(protected("/Users/me/Desktop/dev", h), cfg!(not(windows)));
        assert_eq!(protected("/Users/me/Desktop", h), cfg!(not(windows)));
        assert_eq!(protected("/Users/me/Documents/x/", h), cfg!(not(windows)));
        assert!(!protected("/Users/me/Desktopper/dev", h)); // 이름만 비슷한 폴더
        assert!(!protected("/Users/me/Developer", h));
        assert!(!protected("/Users/me/Desktop/dev", ""));
    }

    #[cfg(unix)]
    #[test]
    fn 실제_폴더_읽기() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("chammo-access-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("ok")).unwrap();
        std::fs::create_dir_all(d.join("locked")).unwrap();
        std::fs::set_permissions(d.join("locked"), std::fs::Permissions::from_mode(0o000)).unwrap();
        let s = |p: &str| probe(&d.join(p).to_string_lossy(), "/nowhere").state;
        assert_eq!(s("ok"), State::Ok);
        assert_eq!(s("none"), State::Missing);
        // root 는 chmod 를 무시한다 — CI 가 root 면 건너뛴다
        if unsafe { libc::geteuid() } != 0 {
            assert_eq!(s("locked"), State::NoPerm);
        }
        std::fs::set_permissions(d.join("locked"), std::fs::Permissions::from_mode(0o755)).unwrap();
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 권한_창_답을_기다리는_읽기는_대기로_두고_또_띄우지_않는다() {
        let (go, wait) = std::sync::mpsc::channel::<()>();
        let dir = format!("/pending-{}", std::process::id());
        let (st, _) = probe_with(&dir, Duration::from_millis(100), move || { let _ = wait.recv(); Ok(()) });
        assert_eq!(st, State::Pending);
        // 멈춘 읽기가 남아 있는 동안엔 새 읽기를 안 띄운다(띄웠다면 이 읽기는 바로 Ok)
        let (st2, _) = probe_with(&dir, Duration::from_millis(100), || Ok(()));
        assert_eq!(st2, State::Pending);
        go.send(()).unwrap();
        // 끝나면 다음 읽기는 다시 돈다
        let mut st3 = State::Pending;
        for _ in 0..50 {
            st3 = probe_with(&dir, Duration::from_millis(100), || Ok(())).0;
            if st3 == State::Ok { break; }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(st3, State::Ok);
    }

    #[test]
    fn 이유_없는_실패만_폴더를_읽어_본다() {
        assert_eq!(explain_spawn_error("Workspace not trusted", "/nope"), "Workspace not trusted");
        // 폴더가 멀쩡하면 원문 그대로
        let tmp = std::env::temp_dir();
        let e = "error: An unknown error occurred (Unexpected)";
        assert_eq!(explain_spawn_error(e, &tmp.to_string_lossy()), e);
    }
}
