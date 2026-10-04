//! 브라우저 자동화 설치의 받기 — curl(맥·윈도우 10+ 기본, 새 크레이트 없음)로 https 만, 받는 동안 진행, 실패하면 반쪽 파일 없이 사람 말 이유.
//! 망이 끊긴 채 매달리지 않게 1KB/초 아래로 60초면 끊는다. 디스크가 모자라면 시작 전에 막는다
use std::path::{Path, PathBuf};

pub const MB: u64 = 1024 * 1024;

/// curl 종료 코드 → 사람이 읽을 이유
pub fn curl_reason(code: Option<i32>, stderr: &str) -> String {
    use crate::i18n::tr;
    let s = match code {
        Some(5 | 6 | 7) => tr("인터넷에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.", "Cannot reach the internet. Check the connection and try again."),
        Some(28) => tr("연결이 너무 느리거나 멈췄어요. 다시 시도해 주세요.", "The connection was too slow or stalled. Please try again."),
        Some(18 | 56 | 92) => tr("받는 도중 연결이 끊겼어요. 다시 시도해 주세요.", "The connection dropped while downloading. Please try again."),
        Some(23) => tr("받은 파일을 쓰지 못했어요 — 디스크 공간을 확인해 주세요.", "Could not write the download — check free disk space."),
        Some(35 | 51 | 58 | 60) => tr("보안 연결(HTTPS) 확인에 실패했어요.", "The secure (HTTPS) connection could not be verified."),
        Some(22) => tr("받을 파일을 찾지 못했어요(서버 오류).", "The download was not found (server error)."),
        _ => "",
    };
    if s.is_empty() {
        format!("curl {}: {}", code.map_or("?".into(), |c| c.to_string()), stderr.trim())
    } else {
        s.to_string()
    }
}

/// HEAD 응답들(리디렉트 포함) 중 마지막 content-length
pub fn last_length(head: &str) -> Option<u64> {
    head.lines().filter_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.trim().eq_ignore_ascii_case("content-length").then(|| v.trim().parse().ok()).flatten()
    }).last()
}

/// 남은 디스크가 모자라면 이유
pub fn disk_short(free: Option<u64>, need: u64) -> Option<String> {
    let free = free?;
    (free < need).then(|| {
        let gb = |b: u64| format!("{:.1}GB", b as f64 / (1024.0 * MB as f64));
        format!("{} ({} / {})", crate::i18n::tr("디스크 공간이 모자라요", "Not enough disk space"), gb(free), gb(need))
    })
}

#[cfg(unix)]
pub fn free_bytes(p: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(p.as_os_str().as_bytes()).ok()?;
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    (unsafe { libc::statvfs(c.as_ptr(), &mut s) } == 0).then(|| s.f_bavail as u64 * s.f_frsize as u64)
}
#[cfg(windows)]
pub fn free_bytes(_p: &Path) -> Option<u64> {
    None // 모르면 막지 않는다 — 모자라면 curl 이 23(쓰기 실패)으로 알려 준다
}

/// 맥·윈도우 기본 도구(curl·tar·powershell) — 윈도우는 System32 에서 바로(PATH 에 다른 curl 이 먼저 있어도)
pub fn sys_tool(name: &str) -> PathBuf {
    if cfg!(windows) {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        return PathBuf::from(root).join("System32").join(format!("{name}.exe"));
    }
    PathBuf::from(format!("/usr/bin/{name}"))
}

pub fn curl_args(url: &str, out: &Path) -> Vec<std::ffi::OsString> {
    let mut a: Vec<std::ffi::OsString> = [
        "-fsSL", "--proto", "=https", "--proto-redir", "=https", "--retry", "2", "--retry-delay", "2", "--connect-timeout", "20",
        // 1KB/초 아래로 60초면 끊는다 — 망이 끊긴 채 매달리지 않게
        "--speed-limit", "1024", "--speed-time", "60", "-o",
    ]
    .iter()
    .map(Into::into)
    .collect();
    a.push(out.into());
    a.push(url.into());
    a
}

/// https 만 받는다. 받는 동안 progress(받은 바이트, 전체). 끝나면 dest, 실패하면 반쪽 파일은 지운다
pub fn download(url: &str, dest: &Path, progress: &dyn Fn(u64, Option<u64>)) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("https only".into());
    }
    let part = PathBuf::from(format!("{}.part", dest.display()));
    let _ = std::fs::remove_file(&part);
    let total = crate::platform::run_capped(
        crate::platform::command(sys_tool("curl")).args(["-sSIL", "--proto", "=https", "--max-time", "15", url]),
        std::time::Duration::from_secs(20),
    )
    .ok()
    .and_then(|o| last_length(&String::from_utf8_lossy(&o.stdout)));
    let mut child = crate::platform::command(sys_tool("curl"))
        .args(curl_args(url, &part))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let status = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            break st;
        }
        progress(std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0), total);
        std::thread::sleep(std::time::Duration::from_millis(300));
    };
    if !status.success() {
        let mut err = String::new();
        if let Some(mut e) = child.stderr.take() {
            use std::io::Read;
            let _ = e.read_to_string(&mut err);
        }
        let _ = std::fs::remove_file(&part);
        return Err(curl_reason(status.code(), &err));
    }
    std::fs::rename(&part, dest).map_err(|e| e.to_string())
}

/// 글 끝에서 사람이 읽을 마지막 줄(npm 오류 등)
pub fn last_line(s: &str) -> String {
    s.lines().rev().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").chars().take(300).collect()
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curl_오류를_사람_말로_망_끊김_느림_디스크() {
        assert!(curl_reason(Some(6), "").contains("인터넷") || curl_reason(Some(6), "").contains("internet"));
        assert!(curl_reason(Some(28), "").contains("느리") || curl_reason(Some(28), "").contains("slow"));
        assert!(curl_reason(Some(56), "").contains("끊겼") || curl_reason(Some(56), "").contains("dropped"));
        assert!(curl_reason(Some(23), "").contains("디스크") || curl_reason(Some(23), "").contains("disk"));
        assert_eq!(curl_reason(Some(99), " weird \n"), "curl 99: weird");
    }

    #[test]
    fn 받기는_https_만_리디렉트도_https_멈추면_끊기() {
        let a: Vec<String> = curl_args("https://x/y", Path::new("/t/y.part")).iter().map(|s| s.to_string_lossy().into_owned()).collect();
        let pair = |k: &str| a.iter().position(|x| x == k).map(|i| a[i + 1].clone());
        assert_eq!(pair("--proto").as_deref(), Some("=https"));
        assert_eq!(pair("--proto-redir").as_deref(), Some("=https"));
        assert_eq!(pair("--speed-time").as_deref(), Some("60"));
        assert_eq!(a.last().unwrap(), "https://x/y");
        assert!(download("http://example.com/x", Path::new("/tmp/x"), &|_, _| {}).is_err());
    }

    #[test]
    fn 망이_끊기면_반쪽_파일_없이_이유() {
        // 아무도 안 듣는 포트 — 연결 거절(7)
        let d = std::env::temp_dir().join(format!("chammo-dl-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let dest = d.join("x.bin");
        let e = download("https://127.0.0.1:9/x.bin", &dest, &|_, _| {}).unwrap_err();
        assert!(e.contains("인터넷") || e.contains("internet") || e.contains("curl"), "{e}");
        assert!(!dest.exists());
        assert!(!d.join("x.bin.part").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 리디렉트_뒤_마지막_길이() {
        let head = "HTTP/2 302\r\ncontent-length: 0\r\nlocation: x\r\n\r\nHTTP/2 200\r\nContent-Length: 278894050\r\n\r\n";
        assert_eq!(last_length(head), Some(278894050));
        assert_eq!(last_length("HTTP/2 200\r\n"), None);
    }

    #[test]
    fn 디스크가_모자라면_이유_모르면_막지_않는다() {
        assert!(disk_short(Some(100 * MB), 1600 * MB).is_some());
        assert!(disk_short(Some(10_000 * MB), 1600 * MB).is_none());
        assert!(disk_short(None, 1600 * MB).is_none());
        #[cfg(unix)]
        assert!(free_bytes(&std::env::temp_dir()).is_some_and(|b| b > 0));
    }

    #[test]
    fn 마지막_줄() {
        assert_eq!(last_line("a\nnpm error code E404\n\n  "), "npm error code E404");
        assert_eq!(last_line(""), "");
    }

}
