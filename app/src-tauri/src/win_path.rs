//! 윈도우 PATH 다시 읽기 — 앱이 켜진 뒤 winget 으로 git 을 깔면 레지스트리 PATH 만 바뀌고 앱 프로세스 PATH 엔 없다.
//! 첫 설정 '이 PC 점검'에서 git 이 계속 ✕ 로 남아 다음으로 못 갔다(2026-10-21 새 윈도우 PC — winget 은 "이미 설치·업그레이드 없음").
//! 판단(글 → 값)은 순수 함수로 두고 맥에서 시험한다. 레지스트리는 reg query 로(platform::command — 콘솔 창 없이)
#![cfg_attr(not(windows), allow(dead_code))]

/// 시스템·사용자 PATH 가 사는 곳
pub const MACHINE_ENV: &str = r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment";
pub const USER_ENV: &str = r"HKCU\Environment";
/// Git for Windows 가 남기는 설치 자리(InstallPath)
pub const GIT_FOR_WINDOWS: &str = r"HKLM\SOFTWARE\GitForWindows";

/// `reg query <키> /v <이름>` 출력에서 값 — "    Path    REG_EXPAND_SZ    C:\a;%USERPROFILE%\b" (값 안 공백은 그대로)
pub fn parse_reg_value(out: &str, name: &str) -> Option<String> {
    for line in out.lines() {
        let t = line.trim_start();
        let Some((n, rest)) = t.split_once(char::is_whitespace) else { continue };
        if !n.eq_ignore_ascii_case(name) {
            continue;
        }
        let rest = rest.trim_start();
        let Some((ty, val)) = rest.split_once(char::is_whitespace) else { continue };
        if ty.starts_with("REG_") {
            return Some(val.trim().to_string());
        }
    }
    None
}

/// %NAME% 풀기 — 모르는 이름은 그대로(REG_EXPAND_SZ 의 %USERPROFILE% 등)
pub fn expand_vars(s: &str, get: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('%') {
            Some(j) if j > 0 => match get(&after[..j]) {
                Some(v) => { out.push_str(&v); rest = &after[j + 1..]; }
                None => { out.push('%'); rest = after; }
            },
            _ => { out.push('%'); rest = after; }
        }
    }
    out.push_str(rest);
    out
}

fn norm(d: &str) -> String {
    d.trim().trim_end_matches(['\\', '/']).to_lowercase()
}

/// 지금 PATH 뒤에 없던 자리만 붙인다(대소문자·끝 \ 무시). 붙일 게 없으면 None — 앱이 넣은 앞자리는 그대로 둔다
pub fn merge_path(current: &str, extra: &[String]) -> Option<String> {
    let mut parts: Vec<String> = current.split(';').filter(|d| !d.trim().is_empty()).map(str::to_string).collect();
    let mut seen: Vec<String> = parts.iter().map(|d| norm(d)).collect();
    let mut added = false;
    for d in extra.iter().flat_map(|e| e.split(';')).filter(|d| !d.trim().is_empty()) {
        let k = norm(d);
        if !seen.contains(&k) {
            seen.push(k);
            parts.push(d.trim().to_string());
            added = true;
        }
    }
    added.then(|| parts.join(";"))
}

/// git.exe 가 흔히 사는 곳 — GitForWindows 설치 기록이 먼저, 그다음 기본 설치·사용자 설치 자리
pub fn git_spots(install_path: Option<&str>, get: impl Fn(&str) -> Option<String>) -> Vec<String> {
    let mut v: Vec<String> = install_path.filter(|p| !p.trim().is_empty()).map(|p| format!(r"{}\cmd\git.exe", p.trim().trim_end_matches('\\'))).into_iter().collect();
    for (var, sub) in [("ProgramFiles", r"Git\cmd\git.exe"), ("ProgramW6432", r"Git\cmd\git.exe"), ("ProgramFiles(x86)", r"Git\cmd\git.exe"), ("LOCALAPPDATA", r"Programs\Git\cmd\git.exe")] {
        if let Some(base) = get(var).filter(|b| !b.is_empty()) {
            let p = format!(r"{}\{sub}", base.trim_end_matches('\\'));
            if !v.contains(&p) {
                v.push(p);
            }
        }
    }
    v
}

/// git.exe 자리 → PATH 앞에 붙인 새 PATH(이미 있으면 None)
pub fn with_dir_first(current: &str, exe: &str) -> Option<String> {
    let dir = exe.rsplit_once('\\').map(|(d, _)| d)?;
    if current.split(';').any(|d| norm(d) == norm(dir)) {
        return None;
    }
    Some(if current.is_empty() { dir.to_string() } else { format!("{dir};{current}") })
}

/// 다시 찾기 차례인가 — 지난번에서 5초 지났으면 true 로 시각을 남긴다
pub fn due(now: std::time::Instant) -> bool {
    static LAST: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
    let mut g = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if g.is_some_and(|t| now.saturating_duration_since(t) < std::time::Duration::from_secs(5)) {
        return false;
    }
    *g = Some(now);
    true
}

#[cfg(windows)]
fn reg_value(key: &str, name: &str) -> Option<String> {
    let o = crate::setup::run_for("reg", &["query", key, "/v", name], 5)?;
    parse_reg_value(&String::from_utf8_lossy(&o.stdout), name)
}

/// 레지스트리 PATH(시스템·사용자)를 다시 읽어 앱 PATH 뒤에 없던 자리를 붙인다 — 점검·다시 확인마다(setup::check)
#[cfg(windows)]
pub fn refresh() {
    let env = |k: &str| std::env::var(k).ok();
    let extra: Vec<String> = [MACHINE_ENV, USER_ENV].iter().filter_map(|k| reg_value(k, "Path")).map(|p| expand_vars(&p, env)).collect();
    if let Some(p) = merge_path(&std::env::var("PATH").unwrap_or_default(), &extra) {
        std::env::set_var("PATH", p);
    }
}

/// PATH 에서 git 을 못 찾을 때 — 흔한 자리에 git.exe 가 있으면 그 폴더를 PATH 앞에 붙인다. 붙였으면 true
#[cfg(windows)]
pub fn adopt_git() -> bool {
    let env = |k: &str| std::env::var(k).ok();
    let install = reg_value(GIT_FOR_WINDOWS, "InstallPath");
    let Some(exe) = git_spots(install.as_deref(), env).into_iter().find(|p| std::path::Path::new(p).is_file()) else { return false };
    match with_dir_first(&std::env::var("PATH").unwrap_or_default(), &exe) {
        Some(p) => { std::env::set_var("PATH", p); true }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 윈도우 reg query 실제 꼴(영문·한글 윈도우 같음 — 머리줄은 키 경로)
    const MACHINE: &str = "\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment\r\n    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;C:\\Program Files\\Git\\cmd;C:\\Program Files\\nodejs\\\r\n\r\n";
    const USER: &str = "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;\r\n\r\n";

    fn env(k: &str) -> Option<String> {
        match k {
            "SystemRoot" => Some(r"C:\Windows".into()),
            "USERPROFILE" => Some(r"C:\Users\me".into()),
            "ProgramFiles" | "ProgramW6432" => Some(r"C:\Program Files".into()),
            "ProgramFiles(x86)" => Some(r"C:\Program Files (x86)".into()),
            "LOCALAPPDATA" => Some(r"C:\Users\me\AppData\Local".into()),
            _ => None,
        }
    }

    #[test]
    fn reg_출력에서_path_값_읽기() {
        assert_eq!(parse_reg_value(MACHINE, "Path").as_deref(), Some(r"%SystemRoot%\system32;C:\Program Files\Git\cmd;C:\Program Files\nodejs\"));
        assert_eq!(parse_reg_value(USER, "path").as_deref(), Some(r"%USERPROFILE%\AppData\Local\Microsoft\WindowsApps;"));
        assert_eq!(parse_reg_value("ERROR: The system was unable to find the specified registry key or value.\r\n", "Path"), None);
        assert_eq!(parse_reg_value("    InstallPath    REG_SZ    C:\\Program Files\\Git\r\n", "InstallPath").as_deref(), Some(r"C:\Program Files\Git"));
    }

    #[test]
    fn 환경_변수_풀기는_아는_것만() {
        assert_eq!(expand_vars(r"%SystemRoot%\system32;%NOPE%\x;50%", env), r"C:\Windows\system32;%NOPE%\x;50%");
        assert_eq!(expand_vars("%%", env), "%%");
    }

    #[test]
    fn 재현_앱_path_에_없고_레지스트리에만_있는_git_자리를_붙인다() {
        // 앱이 켜진 뒤 git 을 깔았다 — 앱 PATH 엔 Git\cmd 가 없고 레지스트리 시스템 PATH 에만 있다
        let app = r"C:\Windows\system32;C:\Users\me\.local\bin";
        let extra: Vec<String> = [MACHINE, USER].iter().filter_map(|o| parse_reg_value(o, "Path")).map(|p| expand_vars(&p, env)).collect();
        let p = merge_path(app, &extra).expect("붙일 게 있다");
        assert!(p.starts_with(app), "앱이 넣은 앞자리는 그대로: {p}");
        assert!(p.contains(r"C:\Program Files\Git\cmd"));
        assert!(p.contains(r"C:\Users\me\AppData\Local\Microsoft\WindowsApps"));
        assert_eq!(p.matches(r"C:\Windows\system32").count() + p.matches(r"c:\windows\system32").count(), 1, "이미 있는 자리는 또 안 붙인다");
        assert_eq!(merge_path(&p, &extra), None, "다시 읽어도 바뀐 게 없으면 안 바꾼다");
    }

    #[test]
    fn 다시_찾기는_5초에_한_번() {
        let t = std::time::Instant::now();
        assert!(due(t));
        assert!(!due(t + std::time::Duration::from_secs(1)), "저장소마다 부르는 git() 이 reg 를 줄줄이 띄우지 않게");
        assert!(due(t + std::time::Duration::from_secs(6)));
    }

    #[test]
    fn 레지스트리에도_없으면_흔한_자리를_찾아_앞에_붙인다() {
        let spots = git_spots(Some(r"D:\Tools\Git\"), env);
        assert_eq!(spots[0], r"D:\Tools\Git\cmd\git.exe", "GitForWindows 설치 기록이 먼저");
        assert!(spots.contains(&r"C:\Program Files\Git\cmd\git.exe".to_string()));
        assert!(spots.contains(&r"C:\Users\me\AppData\Local\Programs\Git\cmd\git.exe".to_string()));
        assert_eq!(spots.iter().filter(|s| s.as_str() == r"C:\Program Files\Git\cmd\git.exe").count(), 1, "ProgramFiles·ProgramW6432 가 같으면 한 번");
        assert_eq!(git_spots(None, |_| None), Vec::<String>::new());
        assert_eq!(with_dir_first(r"C:\Windows", r"C:\Program Files\Git\cmd\git.exe").as_deref(), Some(r"C:\Program Files\Git\cmd;C:\Windows"));
        assert_eq!(with_dir_first(r"c:\program files\git\cmd\;C:\Windows", r"C:\Program Files\Git\cmd\git.exe"), None);
    }
}
