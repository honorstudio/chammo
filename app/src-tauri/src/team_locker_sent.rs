//! 같은 파일 두 번 안 올리기(11-05 팀원 DM 에 같은 사진이 세 번 — 못 보내 다시 넣을 때마다 새로 올라갔다).
//! 같은 팀·방·폴더·이름에 내용이 같은 파일을 다시 올리면 앞서 올린 참조를 준다. 앱이 켜져 있는 동안 하루, 휴지통·폴더 지우기를 하면 그 팀 기억은 버린다.
//! 같은 파일이 동시에 들어오면(창 둘·폰 다시 보내기) 차례 자물쇠로 한쪽이 끝나길 기다렸다 기억을 받는다
use crate::team_locker::FileRef;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const KEEP: Duration = Duration::from_secs(24 * 3600);
/// 이 크기까지는 내용으로 지문(256MiB ≈ 0.5초), 그 위는 경로·크기·고친 시각
const HASH_MAX: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Key {
    team: String,
    room: String,
    folder: String,
    name: String,
    print: String,
}

impl Key {
    pub fn of(team: &str, room: &str, folder: &str, name: &str, path: &Path) -> Result<Key, String> {
        Ok(Key { team: team.into(), room: room.into(), folder: folder.into(), name: name.into(), print: print(path)? })
    }
}

fn print(path: &Path) -> Result<String, String> {
    let m = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if m.len() > HASH_MAX {
        let at = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
        let real = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        return Ok(format!("p:{}:{}:{at}", real.display(), m.len()));
    }
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let (mut h, mut buf) = (Sha256::new(), vec![0u8; 1 << 20]);
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("h:{}:{:x}", m.len(), h.finalize()))
}

static SENT: Mutex<BTreeMap<Key, (Instant, FileRef)>> = Mutex::new(BTreeMap::new());
static GATES: Mutex<BTreeMap<Key, Arc<Mutex<()>>>> = Mutex::new(BTreeMap::new());

/// 그 파일 차례 — 잡고 있는 동안 같은 파일의 다른 올리기는 기다린다
pub fn gate(k: &Key) -> Arc<Mutex<()>> {
    let mut g = GATES.lock().unwrap_or_else(|e| e.into_inner());
    g.retain(|_, a| Arc::strong_count(a) > 1); // 아무도 안 잡은 차례는 치운다
    g.entry(k.clone()).or_default().clone()
}

pub fn sent(k: &Key, now: Instant) -> Option<FileRef> {
    SENT.lock().unwrap_or_else(|e| e.into_inner()).get(k).filter(|(at, _)| now.saturating_duration_since(*at) < KEEP).map(|(_, r)| r.clone())
}

pub fn keep(k: Key, r: FileRef, now: Instant) {
    let mut m = SENT.lock().unwrap_or_else(|e| e.into_inner());
    m.retain(|_, (at, _)| now.saturating_duration_since(*at) < KEEP);
    m.insert(k, (now, r));
}

/// 휴지통·영구 지우기·폴더 옮기기·지우기 — 그 팀 기억을 버린다(지운 파일을 말에 다시 붙이지 않게)
pub fn forget_team(team: &str) {
    SENT.lock().unwrap_or_else(|e| e.into_inner()).retain(|k, _| k.team != team);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::team_locker::FileRef;
    use std::time::{Duration, Instant};

    fn tmp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("lk-sent-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn rf(id: &str) -> FileRef {
        FileRef { id: id.into(), team: "t".into(), room: "r".into(), name: "a.jpg".into(), size: 3 }
    }

    #[test]
    fn 내용이_같으면_경로가_달라도_같은_지문_내용이_다르면_다른_지문() {
        let d = tmp("print");
        std::fs::write(d.join("a.jpg"), b"abc").unwrap();
        std::fs::write(d.join("b.jpg"), b"abc").unwrap();
        std::fs::write(d.join("c.jpg"), b"abd").unwrap();
        let k = |f: &str| Key::of("t", "r", "", "a.jpg", &d.join(f)).unwrap();
        assert_eq!(k("a.jpg"), k("b.jpg"), "폰이 조각을 모은 임시 자리·다시 끌어 온 복사본도 같은 파일");
        assert_ne!(k("a.jpg"), k("c.jpg"));
        assert!(Key::of("t", "r", "", "a.jpg", &d.join("없음.jpg")).is_err());
    }

    #[test]
    fn 팀_방_폴더_이름이_다르면_다른_자리() {
        let d = tmp("place");
        let p = d.join("a.jpg");
        std::fs::write(&p, b"abc").unwrap();
        let base = Key::of("t", "r", "", "a.jpg", &p).unwrap();
        for other in [Key::of("t2", "r", "", "a.jpg", &p), Key::of("t", "r2", "", "a.jpg", &p), Key::of("t", "", "계약", "a.jpg", &p), Key::of("t", "r", "", "b.jpg", &p)] {
            assert_ne!(other.unwrap(), base);
        }
    }

    #[test]
    fn 기억은_하루_팀을_잊으면_그_팀만() {
        let d = tmp("keep");
        let p = d.join("a.jpg");
        std::fs::write(&p, b"keep").unwrap();
        let (k1, k2) = (Key::of("tk1", "r", "", "a.jpg", &p).unwrap(), Key::of("tk2", "r", "", "a.jpg", &p).unwrap());
        let now = Instant::now();
        keep(k1.clone(), rf("f1"), now);
        keep(k2.clone(), rf("f2"), now);
        assert_eq!(sent(&k1, now + Duration::from_secs(23 * 3600)).map(|r| r.id), Some("f1".into()));
        assert!(sent(&k1, now + Duration::from_secs(25 * 3600)).is_none());
        forget_team("tk1");
        assert!(sent(&k1, now).is_none());
        assert_eq!(sent(&k2, now).map(|r| r.id), Some("f2".into()));
    }

    #[test]
    fn 같은_파일이_동시에_들어오면_한쪽은_다른_쪽이_끝나길_기다린다() {
        let d = tmp("gate");
        let p = d.join("a.jpg");
        std::fs::write(&p, b"gate").unwrap();
        let k = Key::of("tg", "r", "", "a.jpg", &p).unwrap();
        let g = gate(&k);
        let held = g.lock().unwrap();
        let k2 = k.clone();
        let t = std::thread::spawn(move || {
            let g2 = gate(&k2);
            let _x = g2.lock().unwrap();
            sent(&k2, Instant::now()).map(|r| r.id)
        });
        std::thread::sleep(Duration::from_millis(100));
        keep(k, rf("first"), Instant::now()); // 먼저 온 쪽이 올리고 기억
        drop(held);
        assert_eq!(t.join().unwrap(), Some("first".into()), "뒤에 온 쪽은 기억을 받아 안 올린다");
    }
}
