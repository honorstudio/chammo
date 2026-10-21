//! 윈도우 휴지통(Recycle Bin) — 보관함 '휴지통으로'가 맥처럼 홈의 .Trash 숨은 폴더로 가서, 윈도우 사용자는 휴지통 아이콘에서 못 찾고
//! 비우기로도 안 지워져 쌓였다. 다른 드라이브(D:) 파일은 rename 이 드라이브를 못 넘어 실패했다(2026-10-21 리뷰 ⑦-18).
//! 보내기는 셸 휴지통(되돌릴 수 있게), 앱의 '되돌리기'는 휴지통 기록($I 파일)에서 원래 경로를 찾아 짝인 $R 을 제자리로 옮긴다
use std::path::Path;
#[cfg(windows)]
use std::path::PathBuf;

/// 기록(Moved.to)에 적는 표시 — 휴지통 안 실제 이름($R…)은 보낸 쪽이 모른다. 되돌리기는 from(원래 경로)으로 찾는다
pub const MARK: &str = "::recycle-bin::";

pub fn is_mark(p: &Path) -> bool {
    p.as_os_str() == MARK
}

/// $I 파일 → (지운 때 FILETIME, 원래 경로). 판 1(윈도우 7: 고정 260자)·판 2(윈도우 10: 길이 + 글)
pub fn parse_info(b: &[u8]) -> Option<(i64, String)> {
    let ver = i64::from_le_bytes(b.get(0..8)?.try_into().ok()?);
    let at = i64::from_le_bytes(b.get(16..24)?.try_into().ok()?);
    let units: Vec<u16> = match ver {
        1 => b.get(24..24 + 520)?.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect(),
        2 => {
            let n = u32::from_le_bytes(b.get(24..28)?.try_into().ok()?) as usize;
            b.get(28..28 + n.checked_mul(2)?)?.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect()
        }
        _ => return None,
    };
    let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
    let path = String::from_utf16(&units[..end]).ok()?;
    (!path.is_empty()).then_some((at, path))
}

/// 셸이 받는 모양 — `\\?\` 머리(canonicalize 가 붙인다)를 뗀다. SHFileOperationW 는 그 머리를 못 받아 연결 폴더 안 휴지통 보내기가 늘 실패했다(2026-10-22 코드 리뷰)
pub fn shell_path(p: &str) -> String {
    if let Some(unc) = p.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        p.strip_prefix(r"\\?\").unwrap_or(p).to_string()
    }
}

/// 휴지통 기록($I)의 원래 경로와 견줄 모양 — 셸 머리를 떼고 '/' 를 '\' 로, 대소문자 무시.
/// 보관함 기록은 rel 을 '/' 째 붙여 'C:\…\자료/메모.md' 가 와서 되돌리기가 늘 '휴지통에 없어'였다(2026-10-22 윈도우 QA 2차)
#[cfg_attr(not(windows), allow(dead_code))] // 되돌리기(윈도우)만 부른다
pub fn recycle_key(p: &str) -> String {
    shell_path(p).replace('/', "\\").to_lowercase()
}

/// 휴지통으로(셸, 되돌릴 수 있게·묻지 않고·창 없이). 휴지통에 못 넣는 것(휴지통 없는 드라이브·휴지통보다 큰 것)은 셸이 말없이 영구 삭제하므로
/// FOF_WANTNUKEWARNING 으로 그때만 사람에게 묻는다 — 아니라면 남는다(2026-10-22 코드 리뷰)
#[cfg(windows)]
pub fn recycle(p: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FOF_WANTNUKEWARNING, FO_DELETE, SHFILEOPSTRUCTW};
    let shown = PathBuf::from(shell_path(&p.to_string_lossy()));
    // pFrom 은 두 번 NUL 로 끝나는 목록
    let from: Vec<u16> = shown.as_os_str().encode_wide().chain([0, 0]).collect();
    let mut op = SHFILEOPSTRUCTW {
        hwnd: std::ptr::null_mut(),
        wFunc: FO_DELETE,
        pFrom: from.as_ptr(),
        pTo: std::ptr::null(),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT | FOF_WANTNUKEWARNING) as u16,
        fAnyOperationsAborted: 0,
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: std::ptr::null(),
    };
    // SAFETY: from 은 이 함수 끝까지 산다. 다른 포인터는 비워 둔다
    let rc = unsafe { SHFileOperationW(&mut op) };
    if rc != 0 || op.fAnyOperationsAborted != 0 {
        return Err(format!("휴지통으로 못 보냈어(코드 {rc}): {}", p.display()));
    }
    if p.exists() {
        return Err(format!("휴지통으로 못 보냈어: {}", p.display()));
    }
    Ok(())
}

/// 휴지통에서 원래 자리로 — 그 경로로 지운 것 중 가장 최근 것. 원래 자리에 뭔가 있으면 안 덮는다
#[cfg(windows)]
pub fn restore(orig: &Path) -> Result<(), String> {
    use std::path::Component;
    if orig.exists() {
        return Err(format!("원래 자리에 이미 있어: {}", orig.display()));
    }
    let Some(Component::Prefix(pre)) = orig.components().next() else { return Err("드라이브를 모르는 경로".into()) };
    let bin = PathBuf::from(format!("{}\\$Recycle.Bin", pre.as_os_str().to_string_lossy()));
    let want = recycle_key(&orig.to_string_lossy());
    let mut best: Option<(i64, PathBuf)> = None;
    for sid in std::fs::read_dir(&bin).map_err(|e| e.to_string())?.flatten() {
        let Ok(rd) = std::fs::read_dir(sid.path()) else { continue }; // 남의 계정 칸은 못 읽는다
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.starts_with("$I") {
                continue;
            }
            let Some((at, path)) = std::fs::read(e.path()).ok().and_then(|b| parse_info(&b)) else { continue };
            if recycle_key(&path) == want &&best.as_ref().is_none_or(|(t, _)| at > *t) {
                best = Some((at, e.path()));
            }
        }
    }
    let (_, info) = best.ok_or_else(|| format!("휴지통에 없어: {}", orig.display()))?;
    let name = info.file_name().map(|n| n.to_string_lossy().replacen("$I", "$R", 1)).unwrap_or_default();
    let data = info.with_file_name(name);
    std::fs::rename(&data, orig).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&info);
    Ok(())
}

#[cfg(not(windows))]
pub fn restore(orig: &Path) -> Result<(), String> {
    Err(format!("휴지통에 없어: {}", orig.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(s: &str) -> Vec<u8> {
        s.encode_utf16().chain([0]).flat_map(|u| u.to_le_bytes()).collect()
    }

    #[test]
    fn 휴지통_기록에서_원래_경로와_때를_읽는다() {
        let path = r"C:\Users\Me\Documents\Chammo\참모\자료\메모.md";
        // 판 2(윈도우 10) — 머리 8 · 크기 8 · 때 8 · 글자 수 4 · 글
        let mut v2 = 2i64.to_le_bytes().to_vec();
        v2.extend(1234i64.to_le_bytes());
        v2.extend(133_000_000_000_000_000i64.to_le_bytes());
        v2.extend(((path.encode_utf16().count() + 1) as u32).to_le_bytes());
        v2.extend(utf16(path));
        assert_eq!(parse_info(&v2), Some((133_000_000_000_000_000, path.to_string())));
        // 판 1(윈도우 7) — 260자 고정 칸
        let mut v1 = 1i64.to_le_bytes().to_vec();
        v1.extend(9i64.to_le_bytes());
        v1.extend(77i64.to_le_bytes());
        let mut p = utf16(path);
        p.resize(520, 0);
        v1.extend(p);
        assert_eq!(parse_info(&v1), Some((77, path.to_string())));
        assert_eq!(parse_info(b"short"), None);
        assert_eq!(parse_info(&[9u8; 600]), None, "모르는 판");
    }

    #[test]
    fn 셸에는_긴_경로_머리를_떼고_넘긴다() {
        assert_eq!(shell_path(r"\\?\C:\Users\Me\a.md"), r"C:\Users\Me\a.md");
        assert_eq!(shell_path(r"\\?\UNC\nas\share\a.md"), r"\\nas\share\a.md");
        assert_eq!(shell_path(r"C:\Users\Me\a.md"), r"C:\Users\Me\a.md");
    }

    #[test]
    fn 되돌리기는_섞인_구분자_경로도_휴지통_기록과_같게_본다() {
        // 보관함 기록 from 은 rel 을 '/' 째 붙여 왔고 $I 기록은 '\' 다(2026-10-22 윈도우 QA 2차 — '휴지통에 없어')
        let from = r"C:\Users\Me\chammo-test\locker\참모\자료/되돌리기 시험.md";
        let info = r"C:\Users\Me\chammo-test\locker\참모\자료\되돌리기 시험.md";
        assert_eq!(recycle_key(from), recycle_key(info));
        assert_eq!(recycle_key(r"\\?\C:\Users\Me\A.md"), recycle_key(r"c:\users\me\a.md"));
        assert_ne!(recycle_key(r"C:\Users\Me\a.md"), recycle_key(r"C:\Users\Me\b.md"));
    }

    #[test]
    fn 기록_표시는_경로로_안_헷갈린다() {
        assert!(is_mark(Path::new(MARK)));
        assert!(!is_mark(Path::new(r"C:\Users\Me\.Trash\a.md")));
    }
}
