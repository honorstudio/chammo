//! 폰 → 팀 보관함 올리기 조각 모으기(10-28 사용자 "폰에서도 팀 보관함에 파일 추가"). 폰 서버 몸통은 한 번에 PART(4MiB)까지라
//! 폰이 파일을 조각으로 차례대로 보내고 이 맥이 데이터 폴더(phone-team-up/<올림 id>)에 이어 붙인다. 마지막 조각이 오면 그 파일을
//! 데스크톱 끌어 넣기와 같은 길(team_locker_app::put_file_as — 이 기기에서 암호화해 중계에)로 올리고 지운다
use std::io::Write;
use std::path::{Path, PathBuf};

/// 조각 하나 — 마지막 조각만 이보다 작다. 중계 터널 한 요청(phone_relay_core MAX_REQ)·LTE 쓰기 마감 안쪽
pub const PART: usize = 4 * 1024 * 1024;
/// 폰에서 올리는 파일 하나 상한 — 넘으면 폰이 '데스크톱에서 올려 줘' 한 줄
pub const MAX_TOTAL: u64 = 1024 * 1024 * 1024;
/// 끝내지 못한 조각 파일(폰이 꺼짐·끊김)은 하루 뒤 지운다
const STALE: std::time::Duration = std::time::Duration::from_secs(24 * 3600);

pub fn root(data: &Path) -> PathBuf {
    data.join("phone-team-up")
}

/// 올림 id — 폰이 지은 것(영문 소문자·숫자·-, 8~40자)만. 경로 조각이 된다
pub fn up_id_ok(up: &str) -> bool {
    (8..=40).contains(&up.len()) && up.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

/// 붙이기·마무리는 한 번에 하나 — 답을 잃은 폰이 같은 조각을 겹쳐 보내도 두 번 붙거나 두 번 마무리하지 않게
static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 마무리 표시(다 붙은 바이트 수) — 마지막 조각이 한 번 끝나면 남는다. id 엔 '.' 이 없어 조각 파일과 안 겹친다. 하루 뒤 sweep 이 지운다
fn fin_path(root: &Path, up: &str) -> PathBuf {
    root.join(format!("{up}.fin"))
}

/// 조각 하나 붙이기 — part 번째(0부터)는 앞 조각들이 다 붙은 자리에만. 같은 조각을 다시 보내면(답을 못 받은 폰) 그대로 받는다.
/// 이미 마무리한 올림이면(마지막 조각 답을 잃은 폰) 아무것도 안 붙이고 앞 결과를 준다.
/// 마지막이 아닌 조각은 꼭 PART 크기. 돌려주는 건 지금까지 붙은 바이트 수
pub fn add_part(root: &Path, up: &str, part: u32, last: bool, bytes: &[u8]) -> Result<u64, String> {
    if !up_id_ok(up) {
        return Err("bad upload id".into());
    }
    if bytes.len() > PART || (!last && bytes.len() != PART) || (last && bytes.is_empty() && part > 0) {
        return Err("bad part size".into());
    }
    let at = part as u64 * PART as u64;
    if at + bytes.len() as u64 > MAX_TOTAL {
        return Err("too large".into());
    }
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Ok(t) = std::fs::read_to_string(fin_path(root, up)) {
        return Ok(t.trim().parse().unwrap_or(0));
    }
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    if part == 0 {
        sweep(root, std::time::SystemTime::now());
    }
    let p = root.join(up);
    let have = std::fs::metadata(&p).map_or(0, |m| m.len());
    if have == at + bytes.len() as u64 && (!bytes.is_empty() || p.is_file()) {
        return Ok(have); // 같은 조각 다시 — 이미 붙었다
    }
    if have != at {
        return Err(format!("out of order: have {have}, part starts at {at}"));
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&p).map_err(|e| e.to_string())?;
    f.write_all(bytes).map_err(|e| e.to_string())?;
    Ok(at + bytes.len() as u64)
}

/// 다 모인 파일을 한 번만 넘긴다 — 마무리 표시를 남기고 `<id>.send` 로 옮겨 그 자리를 준다(올리고 나면 부르는 쪽이 지운다).
/// 이미 마무리했거나 파일이 없으면 None — 다시 온 마지막 조각이 또 올리지 않게
pub fn take_done(root: &Path, up: &str) -> Option<PathBuf> {
    if !up_id_ok(up) {
        return None;
    }
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let p = root.join(up);
    let have = std::fs::metadata(&p).ok().filter(|m| m.is_file())?.len();
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(fin_path(root, up)).ok()?;
    f.write_all(have.to_string().as_bytes()).ok()?;
    let send = root.join(format!("{up}.send"));
    std::fs::rename(&p, &send).ok()?;
    Some(send)
}

fn sweep(root: &Path, now: std::time::SystemTime) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let old = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| now.duration_since(t).ok()).is_some_and(|d| d > STALE);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("phone-team-up-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn 조각을_차례로_붙이고_같은_조각을_다시_보내도_한_번만() {
        let r = tmp("order");
        let a = vec![1u8; PART];
        assert_eq!(add_part(&r, "up-0001abcd", 0, false, &a), Ok(PART as u64));
        assert_eq!(add_part(&r, "up-0001abcd", 0, false, &a), Ok(PART as u64), "답을 못 받아 다시 보낸 조각");
        assert_eq!(add_part(&r, "up-0001abcd", 1, true, b"tail"), Ok(PART as u64 + 4));
        assert_eq!(std::fs::metadata(take_done(&r, "up-0001abcd").unwrap()).unwrap().len(), PART as u64 + 4);
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn 건너뛴_조각_모자란_조각_큰_조각_나쁜_id_는_거절() {
        let r = tmp("bad");
        assert!(add_part(&r, "up-0002abcd", 1, true, b"x").unwrap_err().contains("out of order"));
        assert_eq!(add_part(&r, "up-0002abcd", 0, false, b"short"), Err("bad part size".into()), "마지막이 아니면 꼭 PART");
        assert_eq!(add_part(&r, "up-0002abcd", 0, true, &vec![0u8; PART + 1]), Err("bad part size".into()));
        for bad in ["../etc", "UP-0002ABCD", "short", &"a".repeat(41), "up/0002abcd"] {
            assert_eq!(add_part(&r, bad, 0, true, b"x"), Err("bad upload id".into()), "{bad}");
        }
        let last = (MAX_TOTAL / PART as u64) as u32;
        assert_eq!(add_part(&r, "up-0003abcd", last, true, b"x"), Err("too large".into()));
        assert!(take_done(&r, "../x").is_none());
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn 마지막_조각을_다시_보내도_한_번만_마무리하고_앞_결과를_준다() {
        // 0.4.4 리뷰 — 폰이 마지막 조각 답을 잃고(LTE) 다시 보내면 맥이 두 번 올리거나 'out of order' 거짓 실패를 냈다
        let r = tmp("again");
        let a = vec![2u8; PART];
        add_part(&r, "up-0005abcd", 0, false, &a).unwrap();
        assert_eq!(add_part(&r, "up-0005abcd", 1, true, b"tail"), Ok(PART as u64 + 4));
        let sent = take_done(&r, "up-0005abcd").unwrap();
        // 올리기 스레드가 아직 도는 중에 다시 옴 — 또 넘기지 않는다
        assert_eq!(add_part(&r, "up-0005abcd", 1, true, b"tail"), Ok(PART as u64 + 4), "다시 온 마지막 조각 — 앞 결과");
        assert!(take_done(&r, "up-0005abcd").is_none(), "두 번 올리지 않는다");
        let _ = std::fs::remove_file(sent); // 올리기 스레드가 다 올리고 지움
        assert_eq!(add_part(&r, "up-0005abcd", 1, true, b"tail"), Ok(PART as u64 + 4), "지운 뒤에 와도 앞 결과");
        assert!(take_done(&r, "up-0005abcd").is_none(), "다시 올릴 파일을 만들지 않는다");
        // 한 조각짜리 파일도 — 지운 뒤 다시 오면 새로 만들어 또 올렸다
        add_part(&r, "up-0006abcd", 0, true, b"one").unwrap();
        let _ = std::fs::remove_file(take_done(&r, "up-0006abcd").unwrap());
        assert_eq!(add_part(&r, "up-0006abcd", 0, true, b"one"), Ok(3));
        assert!(take_done(&r, "up-0006abcd").is_none());
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn 빈_파일은_조각_0_하나로_된다() {
        let r = tmp("empty");
        assert_eq!(add_part(&r, "up-0004abcd", 0, true, b""), Ok(0));
        assert!(take_done(&r, "up-0004abcd").is_some());
        let _ = std::fs::remove_dir_all(&r);
    }
}
