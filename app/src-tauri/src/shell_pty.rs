//! 그냥 셸 탭 — Claude 세션이 아닌 사용자 로그인 셸(맥 `$SHELL -l`, 윈도우 PowerShell)을 pty 로 연다(11-17 사용자 "iTerm 계속 열어서 쓰는 중").
//! 띄우기·읽기·쓰기·크기·닫기는 세션 칸(pty.rs)과 같은 길 — 여기는 명령·환경 만들기와 '돌던 프로그램이 있나'만.
//! 환경은 앱 프로세스 것을 물려주지 않는다: 로그인(login(1))처럼 몇 개만 남기고 셸이 프로필(/etc/zprofile·~/.zprofile·~/.zshrc)로 PATH 를 다시 짠다.
//! 앱을 껐다 켜면 셸 탭은 사라진다(되살리지 않는다).
use crate::pty::{self, Ptys};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

/// 앱 env 에서 셸로 넘기는 것 — 나머지(앱이 쓰는 CHAMMO_*·TAURI_*·__CFBundle… 등)는 버린다.
/// SSH_AUTH_SOCK 은 launchd 가 준 ssh-agent 라 꼭 남긴다. CHAMMO_HOME 은 시험판이 시험 데이터 폴더 밖(진짜 앱)으로 새지 않게 남긴다
#[cfg(unix)]
const KEEP: &[&str] = &["HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "SSH_AUTH_SOCK", "__CF_USER_TEXT_ENCODING", "LANG", "CHAMMO_HOME"];

/// 로그인이 주는 기본 PATH — 셸 프로필(path_helper·brew shellenv)이 그 위에 쌓는다
#[cfg(unix)]
const BASE_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

/// 앱 env → 셸 env. GUI 로 뜬 앱은 LANG 이 비어 있을 때가 많다 — 없으면 UTF-8 로(안 주면 zsh 가 한글을 <0080> 처럼 깨뜨린다)
#[cfg(unix)]
pub(crate) fn shell_env(app: impl IntoIterator<Item = (String, String)>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = app.into_iter().filter(|(k, _)| KEEP.contains(&k.as_str()) || k.starts_with("LC_")).collect();
    if !out.iter().any(|(k, v)| k == "LANG" && !v.is_empty()) {
        out.retain(|(k, _)| k != "LANG");
        out.push(("LANG".into(), "en_US.UTF-8".into()));
    }
    out.push(("PATH".into(), BASE_PATH.into()));
    out.push(("TERM_PROGRAM".into(), "Chammo".into()));
    out
}

/// 쓸 셸 — $SHELL, 없으면 zsh
#[cfg(unix)]
fn shell_path(env_shell: Option<String>) -> String {
    env_shell.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "/bin/zsh".into())
}

/// 로그인 셸 명령 — `-l` 이라 프로필을 읽는다. argv0 는 그대로(zsh 는 -l 로 로그인 셸이 된다)
#[cfg(unix)]
pub(crate) fn login_shell(shell: &str, env: Vec<(String, String)>) -> portable_pty::CommandBuilder {
    let mut cmd = portable_pty::CommandBuilder::new(shell);
    cmd.arg("-l");
    cmd.env_clear();
    for (k, v) in env {
        cmd.env(k, v);
    }
    cmd
}

/// 윈도우: PowerShell(로고 줄 없이). 윈도우 앱 env 는 로그인 때 레지스트리에서 받은 그대로라 물려준다
#[cfg(windows)]
pub(crate) fn login_shell_win() -> portable_pty::CommandBuilder {
    let mut cmd = portable_pty::CommandBuilder::new("powershell.exe");
    cmd.arg("-NoLogo");
    cmd
}

fn default_command() -> portable_pty::CommandBuilder {
    #[cfg(unix)]
    {
        login_shell(&shell_path(std::env::var("SHELL").ok()), shell_env(std::env::vars()))
    }
    #[cfg(windows)]
    {
        login_shell_win()
    }
}

/// 시작 폴더 — 있는 폴더면 그대로, 없으면 홈(지운 프로젝트 폴더로 열면 셸이 못 뜬다)
pub(crate) fn start_dir(cwd: Option<String>) -> Option<String> {
    cwd.filter(|d| std::path::Path::new(d).is_dir()).or_else(|| Some(crate::platform::home()).filter(|h| !h.is_empty()))
}

/// 셸 탭 열기 — 출력은 세션 칸과 같이 Channel 로(빈 조각 = 셸이 끝남)
#[tauri::command]
pub fn shell_open(webview: tauri::Webview, state: State<Ptys>, cwd: Option<String>, cols: u16, rows: u16, on_data: Channel) -> Result<u32, String> {
    let (master, writer, child) = pty::spawn_cmd(default_command(), start_dir(cwd), cols, rows, move |b| on_data.send(InvokeResponseBody::Raw(b.to_vec())).is_ok())
        .inspect_err(|_| crate::usage_counts::record_crash("pty"))?;
    Ok(pty::insert_plain(&state, master, writer, child, webview.label()))
}

/// 셸 위에서 돌고 있는 프로그램 이름(없으면 None) — 탭을 닫기 전에 한 번 묻는다. 앞 묶음이 셸 자신이면 쉬는 중
#[tauri::command]
pub async fn shell_busy(state: State<'_, Ptys>, id: u32) -> Result<Option<String>, String> {
    let Some((fg, child)) = pty::fg_and_child(&state, id) else { return Ok(None) };
    Ok(busy_name(fg, child, prog_name))
}

pub(crate) fn busy_name(fg: Option<i32>, child: Option<u32>, name: impl Fn(i32) -> Option<String>) -> Option<String> {
    let fg = fg.filter(|&g| g > 0)?;
    if child.is_some_and(|c| c as i32 == fg) {
        return None;
    }
    Some(name(fg).unwrap_or_default())
}

/// pid 의 실행 파일 이름(ps comm 끝 토막)
fn prog_name(pid: i32) -> Option<String> {
    let o = crate::platform::command("ps").args(["-o", "comm=", "-p", &pid.to_string()]).output().ok()?;
    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
    let base = s.rsplit('/').next().unwrap_or(&s).trim_start_matches('-').to_string();
    (!base.is_empty()).then_some(base)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::sync::{Arc, Mutex};
    #[cfg(unix)]
    use std::time::{Duration, Instant};

    #[cfg(unix)]
    fn vars(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }
    #[cfg(unix)]
    fn get<'a>(env: &'a [(String, String)], k: &str) -> Option<&'a str> {
        env.iter().find(|(x, _)| x == k).map(|(_, v)| v.as_str())
    }

    #[cfg(unix)]
    #[test]
    fn 앱_env_는_물려주지_않고_로그인에_필요한_것만() {
        let env = shell_env(vars(&[("HOME", "/Users/a"), ("USER", "a"), ("SSH_AUTH_SOCK", "/tmp/s"), ("PATH", "/app/only"), ("TAURI_ENV_X", "1"), ("RUST_LOG", "debug"), ("LC_CTYPE", "UTF-8"), ("LANG", "ko_KR.UTF-8")]));
        assert_eq!(get(&env, "HOME"), Some("/Users/a"));
        assert_eq!(get(&env, "SSH_AUTH_SOCK"), Some("/tmp/s"), "ssh-agent 는 남긴다");
        assert_eq!(get(&env, "LC_CTYPE"), Some("UTF-8"));
        assert_eq!(get(&env, "LANG"), Some("ko_KR.UTF-8"), "있던 LANG 은 그대로");
        assert_eq!(get(&env, "PATH"), Some(BASE_PATH), "PATH 는 앱 것이 아니라 로그인 기본값 — 프로필이 쌓는다");
        assert_eq!(get(&env, "TAURI_ENV_X"), None);
        assert_eq!(get(&env, "RUST_LOG"), None);
        assert_eq!(env.iter().filter(|(k, _)| k == "PATH").count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn LANG_이_없거나_비면_UTF8() {
        assert_eq!(get(&shell_env(vars(&[("HOME", "/h")])), "LANG"), Some("en_US.UTF-8"));
        let env = shell_env(vars(&[("LANG", "")]));
        assert_eq!(get(&env, "LANG"), Some("en_US.UTF-8"));
        assert_eq!(env.iter().filter(|(k, _)| k == "LANG").count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn 셸은_SHELL_없으면_zsh() {
        assert_eq!(shell_path(Some("/bin/bash".into())), "/bin/bash");
        assert_eq!(shell_path(None), "/bin/zsh");
        assert_eq!(shell_path(Some(" ".into())), "/bin/zsh");
    }

    #[test]
    fn 없는_폴더면_홈에서() {
        let home = crate::platform::home();
        assert_eq!(start_dir(Some("/no/such/dir/xyz".into())), Some(home.clone()));
        assert_eq!(start_dir(None), Some(home));
        let tmp = std::env::temp_dir().to_string_lossy().to_string();
        assert_eq!(start_dir(Some(tmp.clone())), Some(tmp));
    }

    #[test]
    fn 앞_묶음이_셸_자신이면_쉬는_중() {
        assert_eq!(busy_name(Some(100), Some(100), |_| Some("zsh".into())), None);
        assert_eq!(busy_name(Some(200), Some(100), |_| Some("vim".into())), Some("vim".into()));
        assert_eq!(busy_name(Some(200), Some(100), |_| None), Some(String::new()), "이름을 못 읽어도 돌고 있다");
        assert_eq!(busy_name(None, Some(100), |_| Some("x".into())), None, "모르면(윈도우) 안 묻는다");
    }

    /// 진짜 셸을 띄워 입력 → 출력, 크기 바꿈, 돌던 프로그램, 끝남(빈 조각)까지 — 시험 셸은 /bin/sh(사람 프로필을 안 읽게 -l 대신 그대로)
    #[cfg(unix)]
    struct Live {
        out: Arc<Mutex<Vec<u8>>>,
        ended: Arc<Mutex<bool>>,
        state: Ptys,
        id: u32,
    }

    #[cfg(unix)]
    impl Live {
        fn start(shell: &str, args: &[&str], cwd: Option<String>) -> Live {
            let mut cmd = portable_pty::CommandBuilder::new(shell);
            for a in args {
                cmd.arg(a);
            }
            cmd.env_clear();
            for (k, v) in shell_env(std::env::vars()) {
                cmd.env(k, v);
            }
            cmd.env("PS1", "$ ");
            let out = Arc::new(Mutex::new(Vec::new()));
            let ended = Arc::new(Mutex::new(false));
            let (o, e) = (out.clone(), ended.clone());
            let (master, writer, child) = pty::spawn_cmd(cmd, start_dir(cwd), 80, 24, move |b| {
                if b.is_empty() {
                    *e.lock().unwrap() = true;
                } else {
                    o.lock().unwrap().extend_from_slice(b);
                }
                true
            })
            .unwrap();
            let state = Ptys::default();
            let id = pty::insert_plain(&state, master, writer, child, "main");
            Live { out, ended, state, id }
        }
        fn text(&self) -> String {
            String::from_utf8_lossy(&self.out.lock().unwrap()).to_string()
        }
        fn send(&self, s: &str) {
            pty::write_to(&self.state, self.id, s);
        }
        fn wait(&self, what: &str, f: impl Fn(&Live) -> bool) {
            let until = Instant::now() + Duration::from_secs(8);
            while !f(self) {
                assert!(Instant::now() < until, "{what} 안 됨 — 받은 화면: {:?}", self.text());
                std::thread::sleep(Duration::from_millis(30));
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn 셸을_띄워_치면_답이_오고_한글도_그대로() {
        let tmp = std::env::temp_dir().canonicalize().unwrap().to_string_lossy().to_string();
        let l = Live::start("/bin/sh", &[], Some(tmp.clone()));
        l.send("echo \"ok-$((40+2))\"; pwd; echo 한글\r");
        l.wait("셸 답", |l| l.text().contains("ok-42"));
        l.wait("시작 폴더", |l| l.text().contains(&tmp));
        l.wait("한글 메아리", |l| l.text().matches("한글").count() >= 2);
        l.send("exit\r");
        l.wait("끝남(빈 조각)", |l| *l.ended.lock().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn 크기를_바꾸면_셸이_새_칸수를_본다() {
        let l = Live::start("/bin/sh", &[], None);
        l.send("stty size\r");
        l.wait("처음 크기", |l| l.text().contains("24 80"));
        // pty_resize 와 같은 길(master.resize) — 그 명령은 State 를 받아 여기선 같은 함수를 직접
        l.state_resize(132, 40);
        l.send("stty size\r");
        l.wait("새 크기", |l| l.text().contains("40 132"));
        l.send("exit\r");
        l.wait("끝남", |l| *l.ended.lock().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn 셸_위에서_돌면_그_이름을_닫기_전에_안다() {
        // 작업 제어가 켜진 셸(-i)이어야 돌리는 프로그램이 앞 묶음이 된다 — 사람 셸(zsh -l)은 늘 켜져 있다
        let l = Live::start("/bin/sh", &["-i"], None);
        l.send("echo ready\r");
        l.wait("셸 뜸", |l| l.text().contains("ready"));
        let (fg, child) = pty::fg_and_child(&l.state, l.id).unwrap();
        assert_eq!(busy_name(fg, child, prog_name), None, "쉬는 셸은 안 묻는다");
        l.send("sleep 30\r");
        let until = Instant::now() + Duration::from_secs(5);
        let mut got = None;
        while Instant::now() < until {
            let (fg, child) = pty::fg_and_child(&l.state, l.id).unwrap();
            got = busy_name(fg, child, prog_name);
            if got.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(got.as_deref(), Some("sleep"));
        l.send("\x03"); // ^C
        l.wait("다시 쉼", |l| {
            let (fg, child) = pty::fg_and_child(&l.state, l.id).unwrap();
            busy_name(fg, child, prog_name).is_none()
        });
        l.close();
    }

    #[cfg(unix)]
    #[test]
    fn 탭을_닫으면_셸이_끝난다() {
        let l = Live::start("/bin/sh", &[], None);
        l.send("echo up\r");
        l.wait("셸 뜸", |l| l.text().contains("up"));
        let pid = pty::fg_and_child(&l.state, l.id).unwrap().1.unwrap();
        l.close();
        let until = Instant::now() + Duration::from_secs(3);
        while crate::platform::pid_alive(pid as i32) && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!crate::platform::pid_alive(pid as i32), "닫았는데 셸이 남았다");
    }

    #[cfg(unix)]
    impl Live {
        fn state_resize(&self, cols: u16, rows: u16) {
            pty::resize_plain(&self.state, self.id, cols, rows).unwrap();
        }
        fn close(&self) {
            pty::close_plain(&self.state, self.id);
        }
    }

    #[cfg(unix)]
    #[test]
    fn 로그인_셸은_l_로_뜨고_앱_env_가_안_샌다() {
        let mut env = shell_env(vars(&[("HOME", "/h"), ("SECRET_APP_VAR", "x")]));
        env.push(("X".into(), "1".into()));
        let cmd = login_shell("/bin/zsh", env);
        let argv: Vec<String> = cmd.get_argv().iter().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(argv, ["/bin/zsh", "-l"]);
        assert!(cmd.get_env("SECRET_APP_VAR").is_none());
        assert!(cmd.get_env("RUST_LOG").is_none(), "env_clear — 앱 프로세스 env 가 안 들어간다");
        assert_eq!(cmd.get_env("PATH").map(|p| p.to_string_lossy().to_string()).as_deref(), Some(BASE_PATH));
    }
}
