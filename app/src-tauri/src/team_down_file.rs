//! 받기의 파일 쪽 — 임시 이름에 조각을 차례로 쓰고 끝에 sync. 실패·멈추기면 임시 파일을 지운다.
//! std 만 쓴다 — 윈도우 시험 PC 프로브가 이 파일을 #[path] 로 그대로 묶어 백신·한글 경로에서 실측한다(11-01 fix/win-download)
use std::io::Write;
use std::path::Path;

/// next(i) = i번째 조각 평문, progress(받은, 전체) — 둘 중 하나가 Err 면 거기서 멈추고 tmp 를 지운다
pub fn write_parts(tmp: &Path, parts: u64, size: u64, next: &mut dyn FnMut(u64) -> Result<Vec<u8>, String>, progress: &mut dyn FnMut(u64, u64) -> Result<(), String>) -> Result<(), String> {
    let res = (|| -> Result<(), String> {
        let mut out = std::fs::File::create(tmp).map_err(|e| e.to_string())?;
        let mut done = 0u64;
        progress(0, size)?;
        for i in 0..parts {
            let pt = next(i)?;
            out.write_all(&pt).map_err(|e| e.to_string())?;
            done += pt.len() as u64;
            progress(done, size)?;
        }
        if done != size {
            return Err("받은 크기가 서명과 달라".into());
        }
        out.sync_all().map_err(|e| e.to_string())
    })();
    if res.is_err() {
        let _ = std::fs::remove_file(tmp); // 파일 손잡이는 위 닫힘에서 이미 놓았다(윈도우는 열린 파일을 못 지운다)
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(n: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("down-file-{n}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn 조각을_차례로_쓰고_크기가_틀리거나_멈추면_임시_파일이_없다() {
        let d = dir("a");
        let tmp = d.join(".chammo-down-x");
        write_parts(&tmp, 2, 6, &mut |i| Ok(vec![i as u8; 3]), &mut |_, _| Ok(())).unwrap();
        assert_eq!(std::fs::read(&tmp).unwrap(), vec![0, 0, 0, 1, 1, 1]);
        std::fs::remove_file(&tmp).unwrap();
        assert!(write_parts(&tmp, 2, 7, &mut |_| Ok(vec![0; 3]), &mut |_, _| Ok(())).is_err());
        assert!(!tmp.exists(), "크기가 틀리면 지운다");
        assert_eq!(write_parts(&tmp, 3, 9, &mut |_| Ok(vec![0; 3]), &mut |d, _| if d >= 3 { Err("멈춤".into()) } else { Ok(()) }), Err("멈춤".into()));
        assert!(!tmp.exists(), "멈추면 지운다");
        assert!(write_parts(&tmp, 3, 9, &mut |i| if i == 1 { Err("망".into()) } else { Ok(vec![0; 3]) }, &mut |_, _| Ok(())).is_err());
        assert!(!tmp.exists(), "조각 받기가 실패해도 지운다");
    }
}
