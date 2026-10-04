//! 운영체제마다 다른 것 — 맥(유닉스)이 원래 동작, 윈도우는 같은 이름으로 대신한다(윈도우판 1단계, 2026-09-30).
//! 부르는 쪽은 cfg 를 몰라도 되게 여기서만 가른다
use std::path::Path;
use std::process::{Child, Command};

/// 그 프로세스가 아직 살아 있나(보내지 않고 존재만 확인). 끝났는데 부모가 안 거둔 좀비는 죽은 것 —
/// kill -0 은 좀비에도 성공해서 '앱으로 가져오기'가 좀비가 끝나길 10초 기다리다 실패했다(2026-10-05 아이맥 QA)
#[cfg(unix)]
pub fn pid_alive(pid: i32) -> bool {
    let exists = unsafe { libc::kill(pid, 0) == 0 };
    exists && !zombie(pid)
}
/// 맥: proc_pidinfo 는 좀비면 실패해서(ESRCH) ps 처럼 sysctl(KERN_PROC_PID) 의 kinfo_proc.kp_proc.p_stat 을 본다.
/// libc 크레이트에 kinfo_proc 이 없어 크기(648)·자리(36)를 박는다 — arm64·x86_64 같음, 크기가 다르면 좀비 아님으로
#[cfg(target_os = "macos")]
fn zombie(pid: i32) -> bool {
    const SIZE: usize = 648;
    const P_STAT: usize = 36;
    let mut buf = [0u8; SIZE];
    let mut len = SIZE;
    let mut mib = [libc::CTL_KERN, libc::KERN_PROC, libc::KERN_PROC_PID, pid];
    let r = unsafe { libc::sysctl(mib.as_mut_ptr(), 4, buf.as_mut_ptr() as *mut libc::c_void, &mut len, std::ptr::null_mut(), 0) };
    r == 0 && len == SIZE && buf[P_STAT] as u32 == libc::SZOMB
}
#[cfg(all(unix, not(target_os = "macos")))]
fn zombie(pid: i32) -> bool {
    // /proc/<pid>/stat 의 세 번째 칸(이름 괄호 뒤)이 Z
    std::fs::read_to_string(format!("/proc/{pid}/stat")).ok().and_then(|s| s.rsplit_once(')').map(|(_, r)| r.trim_start().starts_with('Z'))).unwrap_or(false)
}
#[cfg(windows)]
pub fn pid_alive(pid: i32) -> bool {
    Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"]).output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(&format!("\"{pid}\""))).unwrap_or(false)
}

/// 띄우고 기다리지 않는다 — 끝나면 뒤에서 거둬 좀비(<defunct>)가 안 남게. pid 를 돌려준다
pub fn spawn_reaped(cmd: &mut Command) -> std::io::Result<u32> {
    let mut child = cmd.spawn()?;
    let pid = child.id();
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(pid)
}

/// 끝내 달라고 부탁한다(맥 SIGTERM, 윈도우 taskkill — 강제 아님)
#[cfg(unix)]
pub fn terminate(pid: i32) {
    unsafe { libc::kill(pid, libc::SIGTERM) };
}
#[cfg(windows)]
pub fn terminate(pid: i32) {
    let _ = Command::new("taskkill").args(["/PID", &pid.to_string()]).status();
}

/// 자식까지 한 묶음으로 띄운다 — 나중에 묶음째 멈추려고(음성 읽기)
#[cfg(unix)]
pub fn spawn_group(cmd: &mut Command) -> std::io::Result<Child> {
    use std::os::unix::process::CommandExt;
    cmd.process_group(0).spawn()
}
#[cfg(windows)]
pub fn spawn_group(cmd: &mut Command) -> std::io::Result<Child> {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000).spawn() // CREATE_NO_WINDOW — 읽을 때마다 파워셸 창이 번쩍였다
}

/// 파워셸 -EncodedCommand 값(UTF-16LE → base64). 읽을 글자에 따옴표가 있어도 명령줄이 안 깨진다
pub fn encode_ps(script: &str) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            out.push(if i <= c.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}
#[cfg(test)]
pub fn decode_ps(b64: &str) -> String {
    const T: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let vals: Vec<u32> = b64.bytes().filter(|&b| b != b'=').map(|b| T.find(b as char).unwrap() as u32).collect();
    let mut bytes = Vec::new();
    for c in vals.chunks(4) {
        let n = c.iter().enumerate().fold(0, |n, (i, v)| n | v << (18 - 6 * i));
        for i in 0..c.len() - 1 {
            bytes.push((n >> (16 - 8 * i) & 255) as u8);
        }
    }
    let units: Vec<u16> = bytes.chunks(2).map(|p| u16::from_le_bytes([p[0], p[1]])).collect();
    String::from_utf16(&units).unwrap()
}

/// 설치된 목소리를 `say -v ?` 모양으로("이름 ko_KR # "). 윈도우 이름의 빈칸은 _ 로 — say -v 한 칸에 들어가게
#[cfg(target_os = "macos")]
pub fn native_voices() -> String {
    Command::new("say").args(["-v", "?"]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}
#[cfg(not(target_os = "macos"))]
pub fn native_voices() -> String {
    let script = "$ProgressPreference = 'SilentlyContinue'; Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $v = $_.VoiceInfo; ($v.Name -replace ' ', '_') + '  ' + ($v.Culture.Name -replace '-', '_') + '  # ' }";
    let mut c = Command::new("powershell");
    c.args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encode_ps(script)]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c.output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}

/// spawn_group 으로 띄운 묶음을 멈춘다
#[cfg(unix)]
pub fn stop_group(pid: u32) {
    let _ = Command::new("/bin/kill").args(["-TERM", &format!("-{pid}")]).status();
}
#[cfg(windows)]
pub fn stop_group(pid: u32) {
    let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).status();
}

/// 실행 권한 붙이기(윈도우는 권한 비트가 없어 할 일 없음)
#[cfg(unix)]
pub fn make_executable(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755));
}
#[cfg(windows)]
pub fn make_executable(_p: &Path) {}

/// 홈 폴더 — HOME, 없으면 윈도우의 USERPROFILE. 윈도우엔 보통 HOME 이 없어 데이터 폴더가 "/.chammo" 처럼 잘못 잡혔다(윈도우판 2단계)
pub fn home() -> String {
    home_from(std::env::var("HOME").ok(), std::env::var("USERPROFILE").ok())
}

fn home_from(home: Option<String>, profile: Option<String>) -> String {
    home.filter(|h| !h.trim().is_empty()).or(profile.filter(|p| !p.trim().is_empty())).unwrap_or_default()
}

/// 주소(hodoc://…)에서 꺼낸 경로 → 파일 경로. 윈도우 주소는 "/C:/Users/…" 로 와서 앞 "/" 를 뗀다
pub fn url_to_fs(p: &str) -> String {
    let b = p.as_bytes();
    if b.len() >= 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' { p[1..].to_string() } else { p.to_string() }
}

/// 윈도우 canonicalize 가 붙이는 \\?\ 를 뗀다(드라이브 경로만) — 화면·기록에 깨끗한 경로가 가게
pub fn clean_path(p: std::path::PathBuf) -> std::path::PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => std::path::PathBuf::from(rest),
        _ => p,
    }
}

/// 시스템 언어(ko_KR·ko-KR·en-US 모양) — 맥 AppleLocale, 윈도우 표시 언어(UICulture). 윈도우에선 맥 방법이 없어 늘 영어로 떴다(윈도우판 첫 실행)
#[cfg(target_os = "macos")]
pub fn system_locale() -> String {
    Command::new("defaults").args(["read", "-g", "AppleLocale"]).output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}
#[cfg(windows)]
pub fn system_locale() -> String {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000; // 콘솔 창이 번쩍 뜨지 않게
    Command::new("powershell").args(["-NoProfile", "-Command", "(Get-UICulture).Name"]).creation_flags(CREATE_NO_WINDOW).output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn system_locale() -> String {
    std::env::var("LANG").unwrap_or_default()
}

/// 터미널(pty)에서 돌릴 명령 — 맥은 로그인 셸(-lc, PATH·설정을 읽는다), 윈도우는 cmd /C(윈도우판 3단계)
#[cfg(unix)]
pub fn shell_command(command: &str) -> portable_pty::CommandBuilder {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = portable_pty::CommandBuilder::new(shell);
    cmd.args(["-lc", command]);
    cmd
}
/// 윈도우: 명령을 임시 .cmd 파일에 적어 cmd /C 로 그 파일을 돌린다. 명령을 인자로 넘기면 portable-pty 가
/// 안쪽 따옴표를 \" 로 바꾸는데 cmd 는 그걸 몰라 `cd /d "…"` 가 "구문이 잘못되었습니다"로 끝났다(윈도우 3단계)
#[cfg(windows)]
pub fn shell_command(command: &str) -> portable_pty::CommandBuilder {
    static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = std::env::temp_dir();
    if n == 0 {
        // 터미널을 닫으면(믿기 확인 뒤 설정 화면이 닫는다) 끝의 자기 삭제 줄까지 못 가 파일이 남는다 → 지난 실행 것을 치운다
        for e in std::fs::read_dir(&tmp).into_iter().flatten().flatten() {
            if stale_batch(&e.file_name().to_string_lossy(), std::process::id()) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let bat = tmp.join(format!("chammo-{}-{n}.cmd", std::process::id()));
    let mut cmd = portable_pty::CommandBuilder::new("cmd.exe");
    if std::fs::write(&bat, batch_script(command)).is_ok() {
        cmd.arg("/C");
        cmd.arg(&bat);
    } else {
        cmd.args(["/C", command]);
    }
    cmd
}

/// 메뉴 단축키 — 맥 표기(CmdOrCtrl+…)를 그대로 쓰고 윈도우만 바꾼다. 규칙은 프론트 domain/keys.ts 와 같다:
/// Ctrl+글자는 터미널(Claude) 몫이라 Ctrl+Shift+글자, 숫자·기호는 Ctrl, ⌘⇧E → Ctrl+Alt+E, ⌘/ → Ctrl+Shift+/
pub fn accel(mac: &str) -> String {
    accel_for(mac, cfg!(windows))
}
pub fn accel_for(mac: &str, win: bool) -> String {
    if win { win_accel(mac) } else { mac.to_string() }
}
pub fn win_accel(mac: &str) -> String {
    let parts: Vec<&str> = mac.split('+').collect();
    let (key, mods) = parts.split_last().map(|(k, m)| (*k, m.to_vec())).unwrap_or((mac, vec![]));
    if !mods.contains(&"CmdOrCtrl") {
        return mac.to_string();
    }
    let alt = mods.contains(&"Alt");
    let shift = mods.contains(&"Shift");
    let letter = key.len() == 1 && key.chars().all(|c| c.is_ascii_alphabetic());
    match () {
        _ if letter && shift && key.eq_ignore_ascii_case("e") => "Ctrl+Alt+E".into(),
        _ if letter && alt => format!("Ctrl+Alt+Shift+{}", key.to_ascii_uppercase()),
        _ if letter => format!("Ctrl+Shift+{}", key.to_ascii_uppercase()),
        _ if key == "/" => "Ctrl+Shift+/".into(),
        _ if alt => format!("Ctrl+Alt+{key}"),
        _ => format!("Ctrl+{key}"),
    }
}

/// 메뉴 글자 속 단축키 표기 — 맥은 그대로, 윈도우는 accel 규칙대로(⌘W → Ctrl+Shift+W)
pub fn win_accel_label(mac: &str) -> String {
    if !cfg!(windows) {
        return mac.to_string();
    }
    win_accel(&mac.replace('⌘', "CmdOrCtrl+"))
}

/// 클립보드에 글 넣기 — 맥 pbcopy, 윈도우 clip.exe(UTF-16LE 로 넘겨야 한글이 안 깨진다. BOM 은 붙이면 글자로 남는다). 윈도우엔 pbcopy 가 없어
/// 터미널 복사(드래그 OSC 52·Ctrl+C)가 전부 조용히 실패했다(윈도우판)
pub fn clipboard_write(text: &str) -> Result<(), String> {
    use std::io::Write;
    #[cfg(windows)]
    let (mut cmd, bytes) = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("clip.exe");
        c.creation_flags(0x0800_0000);
        (c, clip_bytes(text))
    };
    #[cfg(not(windows))]
    let (mut cmd, bytes) = {
        let mut c = Command::new("pbcopy");
        c.env("LANG", "en_US.UTF-8").env("LC_CTYPE", "UTF-8");
        (c, text.as_bytes().to_vec())
    };
    let mut child = cmd.stdin(std::process::Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    child.stdin.take().ok_or("클립보드 입력 없음")?.write_all(&bytes).map_err(|e| e.to_string())?;
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err(format!("클립보드 쓰기 실패: {status}")) }
}
#[cfg_attr(not(windows), allow(dead_code))]
fn clip_bytes(text: &str) -> Vec<u8> {
    text.encode_utf16().flat_map(|u| u.to_le_bytes()).collect()
}

/// 링크·파일을 기본 앱으로 연다 — 맥 open, 윈도우 url.dll(start 는 cmd 를 거쳐 주소 속 & 에서 끊긴다)
pub fn open_path(target: &str) -> std::io::Result<()> {
    #[cfg(windows)]
    let mut c = {
        let mut c = Command::new("rundll32.exe");
        c.args(["url.dll,FileProtocolHandler", target]);
        c
    };
    #[cfg(not(windows))]
    let mut c = {
        let mut c = Command::new("open");
        c.arg(target);
        c
    };
    spawn_reaped(&mut c).map(|_| ())
}

/// 크롬에서 열기 — 기본 브라우저 말고 깔린 구글 크롬(2026-10-02 사용자 "크롬에서 보기"). 크롬이 없으면 기본 브라우저.
/// 무엇으로 열었는지("chrome" | "default") 돌려준다. 윈도우는 chrome.exe 를 직접(cmd start 는 주소 속 & 에서 끊긴다)
pub fn open_in_chrome(url: &str) -> std::io::Result<String> {
    #[cfg(windows)]
    let ok = chrome_exe_candidates(|k| std::env::var(k).ok()).into_iter().find(|p| p.is_file())
        .is_some_and(|exe| command(exe).arg(url).spawn().is_ok());
    #[cfg(not(windows))]
    let ok = command("open").args(mac_chrome_args(url)).status().is_ok_and(|s| s.success());
    if ok {
        return Ok("chrome".into());
    }
    open_path(url).map(|_| "default".into())
}
/// 맥 — open -a "Google Chrome" <주소>. 크롬이 없으면 open 이 실패 코드로 끝난다
#[cfg_attr(windows, allow(dead_code))]
pub fn mac_chrome_args(url: &str) -> [&str; 3] {
    ["-a", "Google Chrome", url]
}
/// 윈도우 크롬이 깔리는 자리(전체 사용자 → 32비트 → 이 사용자)
#[cfg_attr(not(windows), allow(dead_code))]
pub fn chrome_exe_candidates(env: impl Fn(&str) -> Option<String>) -> Vec<std::path::PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"].iter()
        .filter_map(|k| env(k).filter(|v| !v.is_empty()))
        .map(|d| std::path::Path::new(&d).join("Google").join("Chrome").join("Application").join("chrome.exe"))
        .collect()
}

/// 윈도우 폴더 고르기 창(파워셸 FolderBrowserDialog). 고른 경로를 UTF-8 로 한 줄, 취소면 빈 줄
#[cfg_attr(not(windows), allow(dead_code))]
pub fn folder_dialog_script(prompt: &str, start: Option<&str>) -> String {
    let q = |s: &str| format!("'{}'", s.replace('\'', "''"));
    let start = start.map(|d| format!("$d.SelectedPath = {}; ", q(d))).unwrap_or_default();
    format!(
        "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; \
         $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = {}; $d.ShowNewFolderButton = $true; {start}\
         if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ $d.SelectedPath }}",
        q(prompt)
    )
}

/// 오늘 날짜(YYYY-MM-DD, 이 컴퓨터 시간대) — 윈도우엔 date 명령이 없다(cmd 안의 date 는 입력을 기다린다)
pub fn today() -> String {
    #[cfg(windows)]
    let out = {
        use std::os::windows::process::CommandExt;
        Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", "Get-Date -Format yyyy-MM-dd"]).creation_flags(0x0800_0000).output()
    };
    #[cfg(not(windows))]
    let out = Command::new("date").arg("+%Y-%m-%d").output();
    out.ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()
}

/// 글 속 맥 단축키 표기(⌘J·⌥⌘2·⌘⇧E·⌘Enter)를 윈도우 키로 — HQ 안내문(CHAMMO.md)을 윈도우에 깔 때.
/// 규칙은 프론트 domain/keys.ts keyLabel 과 같다
pub fn win_keys(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    let mut rest = text;
    while let Some(i) = rest.find('⌘') {
        let (before, after) = rest.split_at(i);
        let alt = before.ends_with('⌥');
        out.push_str(if alt { &before[..before.len() - '⌥'.len_utf8()] } else { before });
        let mut tail = &after['⌘'.len_utf8()..];
        let shift = tail.starts_with('⇧');
        if shift {
            tail = &tail['⇧'.len_utf8()..];
        }
        let (key, used): (String, usize) = if tail.starts_with("Enter") {
            ("Ctrl+Enter".into(), 5)
        } else {
            match tail.chars().next() {
                None => ("Ctrl".into(), 0),
                Some(c) if c.is_whitespace() => ("Ctrl".into(), 0),
                Some(c) => {
                    let n = c.len_utf8();
                    let k = if shift && c.eq_ignore_ascii_case(&'e') {
                        "Ctrl+Alt+E".to_string()
                    } else if c.is_ascii_alphabetic() {
                        format!("Ctrl+{}Shift+{}", if alt { "Alt+" } else { "" }, c.to_ascii_uppercase())
                    } else if c == '/' {
                        "Ctrl+Shift+/".into()
                    } else if c == '₩' {
                        "Ctrl+`".into()
                    } else {
                        format!("Ctrl+{}{}{c}", if alt { "Alt+" } else { "" }, if shift { "Shift+" } else { "" })
                    };
                    (k, n)
                }
            }
        };
        out.push_str(&key);
        rest = &tail[used..];
    }
    out.push_str(rest);
    out
}

/// 토스트를 누구 이름으로 띄울지 — 설치한 앱은 앱 식별자(설치 파일이 시작 메뉴에 등록한다),
/// 빌드 폴더에서 바로 돈 앱은 등록이 없어 식별자로 보내면 조용히 안 뜬다 → 파워셸 이름(Tauri 알림 플러그인과 같은 판단)
#[cfg_attr(not(windows), allow(dead_code))]
pub fn toast_app_id(exe_dir: &str, identifier: &str, powershell: &str) -> String {
    let d = exe_dir.replace('/', "\\").to_ascii_lowercase();
    if d.ends_with("\\target\\debug") || d.ends_with("\\target\\release") || d.contains("\\target\\x86_64-pc-windows-msvc\\") {
        powershell.into()
    } else {
        identifier.into()
    }
}

/// 시간 제한 있는 실행 — 넘으면 죽이고 TimedOut. 출력은 따로 읽는 스레드로(파이프가 차서 멈추지 않게).
/// 모바일 서버가 부르는 외부 명령(claude agents·tailscale·예약 스크립트)이 멈추면 연결 자리가 안 풀렸다(2026-10-02 보안 재검토)
pub fn run_capped(cmd: &mut Command, limit: std::time::Duration) -> std::io::Result<std::process::Output> {
    use std::io::Read;
    use std::process::Stdio;
    use std::sync::{Arc, Mutex};
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // 자기 프로세스 그룹으로 — 시간이 넘으면 손자까지 그룹째 죽인다(직계만 죽이면 손자가 남아 파이프를 쥐었다)
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn()?;
    // 출력은 버퍼에 이어 담는다 — 그룹을 벗어난 손자(데몬)가 파이프를 계속 쥐어도 기다림을 끊고 받은 데까지 돌려줄 수 있게
    let pipe = |r: Option<Box<dyn Read + Send>>| {
        let buf = Arc::new(Mutex::new(Vec::new()));
        let (b2, (tx, rx)) = (buf.clone(), std::sync::mpsc::channel::<()>());
        std::thread::spawn(move || {
            if let Some(mut r) = r {
                let mut chunk = [0u8; 8192];
                while let Ok(n) = r.read(&mut chunk) {
                    if n == 0 {
                        break;
                    }
                    b2.lock().unwrap().extend_from_slice(&chunk[..n]);
                }
            }
            let _ = tx.send(());
        });
        (buf, rx)
    };
    let (out, out_done) = pipe(child.stdout.take().map(|x| Box::new(x) as Box<dyn Read + Send>));
    let (err, err_done) = pipe(child.stderr.take().map(|x| Box::new(x) as Box<dyn Read + Send>));
    let until = std::time::Instant::now() + limit;
    let status = loop {
        if let Some(st) = child.try_wait()? {
            break st;
        }
        if std::time::Instant::now() >= until {
            #[cfg(unix)]
            unsafe {
                libc::killpg(child.id() as libc::pid_t, libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "command timed out"));
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    };
    // 끝났어도 파이프를 쥔 손자가 있으면 읽기가 안 끝난다 — 2초만 기다리고 받은 데까지
    let grace_end = std::time::Instant::now() + std::time::Duration::from_secs(2);
    for done in [&out_done, &err_done] {
        let _ = done.recv_timeout(grace_end.saturating_duration_since(std::time::Instant::now()));
    }
    let take = |b: &Arc<Mutex<Vec<u8>>>| std::mem::take(&mut *b.lock().unwrap());
    Ok(std::process::Output { status, stdout: take(&out), stderr: take(&err) })
}

/// 파이썬 도구(루틴 등)를 돌릴 명령 — 맥 /usr/bin/python3, 윈도우는 py -3 → python 중 도는 것
/// (윈도우 python3 는 스토어 대리 실행기라 종료 49로 죽는다). 윈도우는 UTF-8 로(cp949 면 한글이 깨진다)·창 없이
pub fn python() -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        static PY: std::sync::OnceLock<Vec<&'static str>> = std::sync::OnceLock::new();
        let argv = PY.get_or_init(|| {
            let works = |a: &[&str]| {
                Command::new(a[0]).args(&a[1..]).args(["-c", ""]).creation_flags(0x0800_0000).status().is_ok_and(|s| s.success())
            };
            if works(&["py", "-3"]) { vec!["py", "-3"] } else { vec!["python"] }
        });
        let mut c = Command::new(argv[0]);
        c.args(&argv[1..]).env("PYTHONUTF8", "1").creation_flags(0x0800_0000);
        c
    }
    #[cfg(not(windows))]
    Command::new("/usr/bin/python3")
}

/// 외부 프로그램 — 윈도우는 콘솔 창 없이(CREATE_NO_WINDOW). 릴리스판(창 없는 앱)에서 claude agents 를 부를 때마다
/// 검은 콘솔 창이 1~2초마다 번쩍였다(디버그판은 앱 자체 콘솔을 같이 써서 안 보였다). 앱의 모든 외부 호출은 이걸로
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

/// 지난 실행이 남긴 배치 파일인가(chammo-<다른 pid>-<n>.cmd)
#[cfg_attr(not(windows), allow(dead_code))]
pub fn stale_batch(name: &str, pid: u32) -> bool {
    let Some(rest) = name.strip_prefix("chammo-").and_then(|r| r.strip_suffix(".cmd")) else { return false };
    let Some((p, n)) = rest.split_once('-') else { return false };
    p.parse::<u32>().is_ok_and(|p| p != pid) && n.parse::<u32>().is_ok()
}

/// 배치 파일 내용 — UTF-8(chcp 65001, 한글 경로), 줄바꿈 CRLF, % 는 %% (배치에선 변수 표시), 끝나면 자기 파일을 지운다
#[cfg_attr(not(windows), allow(dead_code))]
pub fn batch_script(command: &str) -> String {
    let body = command.replace('%', "%%").replace("\r\n", "\n").replace('\n', "\r\n");
    format!("@echo off\r\nchcp 65001 >nul\r\n{body}\r\n(goto) 2>nul & del \"%~f0\"\r\n")
}

/// git 이 준비됐나 — 맥은 Xcode 명령줄 도구(git 이 거기 들어 있다), 윈도우는 git --version 이 되나(윈도우 설정 2단계에서 막혔다)
#[cfg(target_os = "macos")]
pub fn git_ready() -> bool {
    Command::new("/usr/bin/xcode-select").arg("-p").output().is_ok_and(|o| o.status.success())
}
#[cfg(not(target_os = "macos"))]
pub fn git_ready() -> bool {
    let mut c = Command::new("git");
    c.arg("--version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // 콘솔 안 번쩍임
    }
    c.output().is_ok_and(|o| o.status.success())
}

#[cfg(test)]
mod tests {

    // 2026-10-05 아이맥 QA: 마법사 '믿기' pty 의 claude 가 좀비로 남았는데 kill -0 은 성공해서 '앱으로 가져오기'가 10초 기다리다 실패했다
    #[cfg(unix)]
    #[test]
    fn 좀비는_산_것으로_안_본다() {
        let mut child = super::command("/bin/sh").args(["-c", "exit 0"]).spawn().unwrap();
        let pid = child.id() as i32;
        std::thread::sleep(std::time::Duration::from_millis(400)); // 끝났지만 아직 안 거둠 = 좀비
        let zombie_alive = super::pid_alive(pid);
        let _ = child.wait();
        assert!(!zombie_alive, "끝나고 안 거둔 프로세스(좀비)를 살아 있다고 봤다");
        let mut live = super::command("/bin/sleep").arg("5").spawn().unwrap();
        assert!(super::pid_alive(live.id() as i32), "도는 프로세스는 살아 있다");
        let _ = live.kill();
        let _ = live.wait();
    }

    // 띄우고 기다리지 않는 길(say 미리 데우기·알림 osascript·open)도 끝나면 거둔다 — 개발판 마법사 한 바퀴에 좀비 3개(say 2·vdisplay 1)
    #[cfg(unix)]
    #[test]
    fn 띄우고_버리는_길도_좀비를_안_남긴다() {
        let pid = super::spawn_reaped(&mut super::command("/bin/sh").args(["-c", "exit 0"])).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(600));
        let o = super::command("/bin/ps").args(["-o", "stat=", "-p", &pid.to_string()]).output().unwrap();
        assert!(String::from_utf8_lossy(&o.stdout).trim().is_empty(), "끝난 자식이 좀비로 남았다");
    }

    #[test]
    fn 크롬_열기_인자() {
        assert_eq!(super::mac_chrome_args("http://localhost:3000/?a=1&b=2"), ["-a", "Google Chrome", "http://localhost:3000/?a=1&b=2"]);
        let env = |k: &str| match k { "ProgramFiles" => Some(r"C:\Program Files".to_string()), "LocalAppData" => Some(r"C:\Users\u\AppData\Local".into()), _ => None };
        let c = super::chrome_exe_candidates(env);
        assert_eq!(c.len(), 2);
        assert!(c[0].to_string_lossy().ends_with("chrome.exe") && c[0].to_string_lossy().contains("Program Files"));
        assert!(super::chrome_exe_candidates(|_| Some(String::new())).is_empty());
    }
    use super::*;

    #[test]
    fn 외부_프로그램은_platform_command_로만() {
        // 윈도우 릴리스판에서 claude agents 를 부를 때마다 검은 콘솔 창이 1~2초마다 번쩍였다 — 창 없이 띄우는 command() 로만 부른다
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name == "platform.rs" || !name.ends_with(".rs") {
                continue;
            }
            let text = std::fs::read_to_string(e.path()).unwrap();
            for (i, line) in text.lines().enumerate() {
                assert!(!line.contains("Command::new("), "{name}:{} — crate::platform::command() 를 쓴다", i + 1);
            }
        }
    }

    #[test]
    fn 윈도우_알림은_빌드_폴더에서_돌면_파워셸_이름으로() {
        let ps = "PS";
        assert_eq!(toast_app_id(r"C:\dev\chammo\app\src-tauri\target\debug", "com.chammo.app", ps), "PS");
        assert_eq!(toast_app_id(r"C:\dev\chammo\app\src-tauri\target\release", "com.chammo.app", ps), "PS");
        assert_eq!(toast_app_id(r"C:\Program Files\Chammo", "com.chammo.app", ps), "com.chammo.app");
        assert_eq!(toast_app_id(r"C:\Users\me\AppData\Local\Chammo", "com.chammo.app", ps), "com.chammo.app");
    }

    #[test]
    fn 글_속_맥_단축키를_윈도우_키로() {
        // 프론트 domain/keys.ts keyLabel 과 같은 규칙
        assert_eq!(win_keys("작업 패널(⌘J) · 리더(⌘E)"), "작업 패널(Ctrl+Shift+J) · 리더(Ctrl+Shift+E)");
        assert_eq!(win_keys("⌘1 you · ⌘Enter · ⌘, · ⌘/"), "Ctrl+1 you · Ctrl+Enter · Ctrl+, · Ctrl+Shift+/");
        assert_eq!(win_keys("⌥⌘2 전체 · ⌘⇧E · ⌥⌘Q"), "Ctrl+Alt+2 전체 · Ctrl+Alt+E · Ctrl+Alt+Shift+Q");
        assert_eq!(win_keys("⌘₩ 크게 · ⌘ 키"), "Ctrl+` 크게 · Ctrl 키");
        assert_eq!(win_keys("단축키 없음"), "단축키 없음");
    }

    #[test]
    fn 윈도우_폴더_고르기_창_스크립트() {
        let sc = folder_dialog_script("프로젝트 폴더를 골라 주세요", Some(r"C:\Users\it's"));
        assert!(sc.contains("[Console]::OutputEncoding = [Text.Encoding]::UTF8")); // 한글 폴더 이름이 안 깨지게
        assert!(sc.contains("$d.Description = '프로젝트 폴더를 골라 주세요'"));
        assert!(sc.contains(r"$d.SelectedPath = 'C:\Users\it''s'")); // 따옴표는 '' 로
        assert!(!folder_dialog_script("x", None).contains("SelectedPath ="));
    }

    #[test]
    fn 윈도우_클립보드는_utf16le_bom_없이() {
        // BOM 을 붙이면 clip.exe 가 그것까지 글자로 넣어 붙여넣은 글 맨 앞에 U+FEFF 가 남았다(윈도우 실측)
        assert_eq!(clip_bytes("A가"), vec![0x41, 0x00, 0x00, 0xAC]);
    }

    #[test]
    fn 윈도우_메뉴_단축키는_터미널_ctrl_글자를_피한다() {
        assert_eq!(win_accel("CmdOrCtrl+K"), "Ctrl+Shift+K");
        assert_eq!(win_accel("CmdOrCtrl+W"), "Ctrl+Shift+W");
        assert_eq!(win_accel("CmdOrCtrl+A"), "Ctrl+Shift+A");
        assert_eq!(win_accel("CmdOrCtrl+Shift+E"), "Ctrl+Alt+E");
        assert_eq!(win_accel("CmdOrCtrl+Q"), "Ctrl+Shift+Q");
        assert_eq!(win_accel("CmdOrCtrl+Alt+Q"), "Ctrl+Alt+Shift+Q");
        assert_eq!(win_accel("Alt+CmdOrCtrl+2"), "Ctrl+Alt+2");
        assert_eq!(win_accel("CmdOrCtrl+/"), "Ctrl+Shift+/");
        assert_eq!(win_accel("CmdOrCtrl+="), "Ctrl+=");
        assert_eq!(win_accel("CmdOrCtrl+`"), "Ctrl+`");
        assert_eq!(win_accel("CmdOrCtrl+,"), "Ctrl+,");
        assert_eq!(win_accel("CmdOrCtrl+0"), "Ctrl+0");
        assert_eq!(win_accel("Ctrl+Tab"), "Ctrl+Tab"); // ⌘ 가 없는 건 그대로
        assert_eq!(accel_for("CmdOrCtrl+K", false), "CmdOrCtrl+K"); // 맥은 그대로
    }

    #[test]
    fn 윈도우_터미널_명령은_배치_파일에_그대로() {
        let b = batch_script(r#"cd /d "C:\Users\A B\hq" && "C:\x\claude.exe""#);
        assert!(b.starts_with("@echo off\r\nchcp 65001 >nul\r\n"));
        // 따옴표를 \" 로 바꾸지 않고 그대로 — cmd 는 \" 를 모른다(윈도우 3단계 폴더 믿기 실패 원인)
        assert!(b.contains("\r\ncd /d \"C:\\Users\\A B\\hq\" && \"C:\\x\\claude.exe\"\r\n"));
        assert!(b.ends_with("(goto) 2>nul & del \"%~f0\"\r\n"));
        // 여러 줄이 와도 줄바꿈은 CRLF 로
        assert!(batch_script("a\nb").contains("\r\na\r\nb\r\n"));
        assert!(batch_script("echo 100%").contains("\r\necho 100%%\r\n"));
        assert!(stale_batch("chammo-1980-0.cmd", 2000));
        assert!(!stale_batch("chammo-2000-3.cmd", 2000)); // 지금 실행 것은 둔다
        assert!(!stale_batch("chammo-tts-warm.aiff", 2000));
        assert!(!stale_batch("chammo-x-1.cmd", 2000));
    }

    #[test]
    fn 윈도우_주소_경로는_앞_슬래시_떼기() {
        assert_eq!(url_to_fs("/C:/Users/a/x.md"), "C:/Users/a/x.md");
        assert_eq!(url_to_fs("/Users/a/x.md"), "/Users/a/x.md");
        assert_eq!(url_to_fs("/"), "/");
    }

    #[test]
    fn 윈도우_긴_경로_표시_떼기() {
        assert_eq!(clean_path(std::path::PathBuf::from(r"\\?\C:\Users\a")), std::path::PathBuf::from(r"C:\Users\a"));
        assert_eq!(clean_path(std::path::PathBuf::from("/Users/a")), std::path::PathBuf::from("/Users/a"));
        assert_eq!(clean_path(std::path::PathBuf::from(r"\\?\UNC\srv\x")), std::path::PathBuf::from(r"\\?\UNC\srv\x"));
    }

    #[test]
    fn 홈은_home_없으면_userprofile() {
        assert_eq!(home_from(Some("/Users/a".into()), Some(r"C:\Users\a".into())), "/Users/a");
        assert_eq!(home_from(None, Some(r"C:\Users\a".into())), r"C:\Users\a");
        assert_eq!(home_from(Some("  ".into()), Some(r"C:\Users\a".into())), r"C:\Users\a");
        assert_eq!(home_from(None, None), "");
    }
}
