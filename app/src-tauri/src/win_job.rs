//! 윈도우 프로세스 묶음(Job Object) — 시간 초과로 끊을 때 손자까지 같이. 윈도우는 부모를 끝내도 자식이 안 끝나서
//! claude.cmd(→ node)를 끊을 때마다 node 가 남았다(2026-11-01 윈도우 시험 PC: cmd 를 끝낸 뒤에도 ping·conhost 가 살아 있음).
//! std 만 쓴다 — 윈도우 시험 PC 에서 이 파일을 작은 프로브로 묶어 돌려 보려고(win_bin.rs 와 같은 까닭, lesson-windows).
//! 끝날 때 묶음째 끄기(KILL_ON_JOB_CLOSE)는 안 건다 — 정상으로 끝난 명령이 띄워 둔 것(세션 등)은 그대로 둔다. 끊는 건 kill() 때만

#[cfg(windows)]
pub struct Tree(*mut std::ffi::c_void);

// SAFETY: 커널 핸들 값이라 스레드 사이를 옮겨도 된다
#[cfg(windows)]
unsafe impl Send for Tree {}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn CreateJobObjectW(attrs: *mut std::ffi::c_void, name: *const u16) -> *mut std::ffi::c_void;
    fn AssignProcessToJobObject(job: *mut std::ffi::c_void, process: *mut std::ffi::c_void) -> i32;
    fn TerminateJobObject(job: *mut std::ffi::c_void, code: u32) -> i32;
    fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
}

#[cfg(windows)]
impl Tree {
    /// 막 띄운 자식을 새 묶음에 넣는다 — 그 뒤 자식이 띄우는 손자도 같은 묶음에 든다. 못 넣으면 None(부르는 쪽은 직계만 끊는다)
    pub fn adopt(child: &std::process::Child) -> Option<Tree> {
        use std::os::windows::io::AsRawHandle;
        // SAFETY: 이름·보안 없는 새 묶음, 자식 핸들은 child 가 살아 있는 동안 유효
        unsafe {
            let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            if AssignProcessToJobObject(job, child.as_raw_handle() as *mut _) == 0 {
                CloseHandle(job);
                return None;
            }
            Some(Tree(job))
        }
    }

    /// 묶음에 든 프로세스를 다 끝낸다(자식·손자)
    pub fn kill(&self) {
        // SAFETY: self.0 은 adopt 가 만든 살아 있는 묶음 핸들
        unsafe {
            TerminateJobObject(self.0, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for Tree {
    fn drop(&mut self) {
        // SAFETY: 한 번만 닫는다(Drop)
        unsafe {
            CloseHandle(self.0);
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    // 윈도우 프로브로 돈다(맥 cargo test 엔 안 묶인다). 프로브는 이 파일만 묶어 crate::platform::command 가 없다 — 시험 프로세스라 창은 상관없다
    use std::process::Command as Cmd;

    #[test]
    fn 묶음째_끊으면_손자도_끝난다() {
        let mut c = Cmd::new("cmd").args(["/c", "ping -n 60 127.0.0.1 >nul"]).spawn().unwrap();
        let tree = super::Tree::adopt(&c).expect("묶음에 넣기");
        std::thread::sleep(std::time::Duration::from_secs(2));
        tree.kill();
        let _ = c.wait();
        std::thread::sleep(std::time::Duration::from_millis(500));
        let out = Cmd::new("tasklist").args(["/FI", "IMAGENAME eq PING.EXE", "/NH"]).output().unwrap();
        assert!(!String::from_utf8_lossy(&out.stdout).to_ascii_uppercase().contains("PING.EXE"), "손자 ping 이 남았다");
    }
}
