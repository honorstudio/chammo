//! 윈도우에서 claude 찾기·출력 읽기의 바닥 — 크레이트 안 다른 모듈을 안 쓴다(std·windows-sys 만).
//! 윈도우 시험 PC 에서 같은 파일을 작은 프로브로 묶어 돌려 보려고 따로 둔다(lesson-windows: 윈도우 대상 cargo test 는 안 묶인다)

/// npm 바로가기가 부르는 파일이 진짜 실행 파일인가 — 윈도우 .exe 는 앞 두 글자 MZ 까지(npm 이 설치 스크립트를 못 돌리면 bin\claude.exe 가 500바이트 글 파일로 남는다).
/// 후보 자체엔 쓰지 않는다 — WindowsApps 의 winget.exe·python.exe 같은 실행 별칭은 0바이트 재분석 지점이라 열어 읽으면 없는 것으로 보인다
pub fn target_ok(p: &str) -> bool {
    let path = std::path::Path::new(p);
    if !path.is_file() {
        return false;
    }
    if !cfg!(windows) || !p.to_ascii_lowercase().ends_with(".exe") {
        return true;
    }
    use std::io::Read;
    let mut head = [0u8; 2];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut head)).is_ok() && &head == b"MZ"
}

/// 후보 하나를 써도 되나 — 파일이 있고, npm 바로가기(.cmd)면 그게 부르는 파일도 있어야 한다.
/// npm 판 claude 는 바로가기가 bin\claude.exe 를 부르는데 그게 빠지면 cmd 가 'not recognized' 로 끝나 앱이 로그인 풀림으로 잘못 봤다(2026-10-31 사용자 PC)
pub fn bin_ok(p: &str, exists: impl Fn(&str) -> bool, target_ok: impl Fn(&str) -> bool, read: impl Fn(&str) -> Option<String>) -> bool {
    if !exists(p) {
        return false;
    }
    if !p.to_ascii_lowercase().ends_with(".cmd") {
        return true;
    }
    let dir = p.rsplit_once(['\\', '/']).map(|(d, _)| d).unwrap_or("");
    read(p).map_or(true, |text| shim_targets(&text, dir).iter().all(|t| target_ok(t)))
}

/// npm 바로가기 글에서 "%dp0%\…"·"%~dp0…" 로 부르는 파일들(node.exe 는 빼고 — 없으면 PATH 의 node 를 쓴다) → dir 기준 절대 경로
pub fn shim_targets(text: &str, dir: &str) -> Vec<String> {
    let mut out = Vec::new();
    for part in text.split('"').skip(1).step_by(2) {
        let Some(rest) = part.strip_prefix("%dp0%").or_else(|| part.strip_prefix("%~dp0")) else { continue };
        let rest = rest.trim_start_matches(['\\', '/']);
        if rest.is_empty() || rest.to_ascii_lowercase().ends_with("node.exe") {
            continue;
        }
        let t = format!("{}\\{rest}", dir.trim_end_matches(['\\', '/']));
        if !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

/// 외부 명령 출력 글 — UTF-8 이 아니면 윈도우는 OEM 코드 페이지(한글 윈도우 949)로 읽는다.
/// cmd 의 오류("…은(는) 내부 또는 외부 명령…")가 CP949 라 그대로 읽으면 띠에 '��(��) ����'로 깨졌다(2026-10-31 사용자 PC)
pub fn out_text(b: &[u8]) -> String {
    match std::str::from_utf8(b) {
        Ok(s) => return s.to_string(),
        // 끝에서 글자가 덜 온 것뿐(시간 제한으로 받은 데까지) — UTF-8 글이다, 코드 페이지로 다시 읽지 않는다
        Err(e) if e.error_len().is_none() => return String::from_utf8_lossy(b).into_owned(),
        Err(_) => {}
    }
    #[cfg(windows)]
    if let Some(s) = oem_text(b) {
        return s;
    }
    String::from_utf8_lossy(b).into_owned()
}

#[cfg(windows)]
fn oem_text(b: &[u8]) -> Option<String> {
    use windows_sys::Win32::Globalization::{MultiByteToWideChar, CP_OEMCP};
    let len = i32::try_from(b.len()).ok()?;
    // SAFETY: b 는 len 바이트, 첫 부름은 길이만 재고 둘째는 그 길이의 버퍼에 쓴다
    let n = unsafe { MultiByteToWideChar(CP_OEMCP, 0, b.as_ptr(), len, std::ptr::null_mut(), 0) };
    if n <= 0 {
        return None;
    }
    let mut w = vec![0u16; n as usize];
    let m = unsafe { MultiByteToWideChar(CP_OEMCP, 0, b.as_ptr(), len, w.as_mut_ptr(), n) };
    (m > 0).then(|| String::from_utf16_lossy(&w[..m as usize]))
}
