//! 팀 파일 수정본(10-28 사용자 1안) — 팀에서 연 파일(풀어 둔 자리 team-locker-peek)을 사람이 고쳐 저장했나를 받은 때 내용 지문과 견줘 알고,
//! 사람이 '팀 보관함에 수정본 올리기'를 누를 때만 원본 폴더에 수정본 이름(화면 domain/teamRevise)으로 올린다. 자동 업로드는 없다(팀 모두에게 바로 보인다).
//! 안 올린 수정본은 풀어 둔 자리 청소(3일)에서 빼고, 같은 원본을 다시 열어도 덮지 않는다
use crate::team_locker_app::VIEW_DIR;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// 받은 그대로의 지문 — 경로 → (크기, sha256, 그때 고친 시각 ms). 풀어 둔 자리 밖(청소가 안 지우는 데이터 폴더 바로 아래)
const FRESH: &str = "team-locker-fresh.json";

type Fresh = BTreeMap<String, (u64, String, u64)>;

/// 고친 시각(ms) — 같으면 지문을 다시 안 낸다(화면이 3초마다 물어도 큰 영상을 매번 안 읽게)
fn mtime_ms(m: &std::fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn load(dir: &Path) -> Fresh {
    std::fs::read_to_string(dir.join(FRESH)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(dir: &Path, m: &Fresh) {
    let _ = crate::accounts::write_atomic(&dir.join(FRESH), &serde_json::to_string(m).unwrap_or_default());
}

/// 조각으로 읽어 지문(큰 영상을 통째로 메모리에 안 올린다)
fn digest(p: &Path) -> Option<(u64, String)> {
    use std::io::Read;
    let mut f = std::fs::File::open(p).ok()?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    let mut n = 0u64;
    loop {
        let k = f.read(&mut buf).ok()?;
        if k == 0 {
            break;
        }
        n += k as u64;
        h.update(&buf[..k]);
    }
    Some((n, h.finalize().iter().map(|b| format!("{b:02x}")).collect()))
}

/// 지문 열쇠 — 진짜 경로(데이터 폴더가 링크를 거쳐도 같은 열쇠)
fn key_of(p: &Path) -> String {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()).to_string_lossy().into_owned()
}

/// 받은 그대로(내려받은 직후·수정본을 올린 직후) — 지금 내용을 지문으로. 없는 파일은 지운다
pub fn record(dir: &Path, p: &Path) {
    let mut m = load(dir);
    let key = key_of(p);
    match (digest(p), std::fs::metadata(p)) {
        (Some((n, h)), Ok(md)) => m.insert(key, (n, h, mtime_ms(&md))),
        _ => m.remove(&key),
    };
    // 지워진 자리를 가리키는 옛 줄은 이참에 뺀다
    m.retain(|k, _| Path::new(k).exists());
    save(dir, &m);
}

/// 받은 뒤 고쳤나 — 지문이 없으면(옛 판에 받은 것) 모른다 = 안 고친 것으로
pub fn edited(dir: &Path, p: &Path) -> bool {
    let key = key_of(p);
    let mut all = load(dir);
    let Some(was) = all.get(&key).cloned() else { return false };
    let Ok(md) = std::fs::metadata(p) else { return false };
    if md.len() != was.0 {
        return true;
    }
    let t = mtime_ms(&md);
    if t == was.2 {
        return false;
    }
    match digest(p) {
        Some((_, h)) if h != was.1 => true,
        // 내용은 그대로(다시 열기 touch 등) — 시각만 새로 적어 다음엔 지문을 안 낸다
        Some(_) => {
            all.insert(key, (was.0, was.1, t));
            save(dir, &all);
            false
        }
        None => false,
    }
}

/// 풀어 둔 자리 안 파일 — (팀 id, 진짜 경로). 밖이면 오류
pub fn in_peek(dir: &Path, p: &Path) -> Result<(String, PathBuf), String> {
    let root = std::fs::canonicalize(dir.join(VIEW_DIR)).map_err(|_| "풀어 둔 팀 파일이 아니야".to_string())?;
    let real = std::fs::canonicalize(p).map_err(|_| "그 파일이 없어".to_string())?;
    let rel = real.strip_prefix(&root).map_err(|_| "풀어 둔 팀 파일이 아니야".to_string())?;
    let tid = rel.components().next().map(|c| c.as_os_str().to_string_lossy().into_owned()).unwrap_or_default();
    if tid.is_empty() || !real.is_file() {
        return Err("풀어 둔 팀 파일이 아니야".into());
    }
    Ok((tid, real))
}

/// 그 풀어 둔 파일의 원본 id — 내려받기 기억(team-locker-cache.json, 열쇠 '<id>:<at>:<폴더>' → 경로)을 거꾸로
pub fn source_id(cache: &BTreeMap<String, String>, p: &Path) -> Option<String> {
    cache.iter().filter(|(_, v)| Path::new(v) == p).filter_map(|(k, _)| k.split(':').next()).map(str::to_string).next()
}

/// 수정본 이름 — 경로 글자·줄바꿈 없이 1~200자
pub fn name_ok(name: &str) -> bool {
    let n = name.trim();
    !n.is_empty() && n == name && n.chars().count() <= 200 && !n.contains(['/', '\\', '\n', '\r', '\0']) && n != "." && n != ".."
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-revise-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(VIEW_DIR).join("t1").join("로고")).unwrap();
        d
    }

    #[test]
    fn 받은_그대로면_안_고친_것_저장하면_고친_것() {
        let d = tmp("edit");
        let f = d.join(VIEW_DIR).join("t1").join("로고").join("a.ai");
        std::fs::write(&f, b"one").unwrap();
        assert!(!edited(&d, &f), "지문 없음 = 모른다 = 안 고친 것");
        record(&d, &f);
        assert!(!edited(&d, &f));
        let bump = |p: &Path, s: u64| std::fs::File::options().write(true).open(p).unwrap().set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(s)).unwrap();
        bump(&f, 5);
        assert!(!edited(&d, &f), "시각만 바뀌고(다시 열기) 내용이 같으면 아니다");
        std::fs::write(&f, b"two").unwrap();
        bump(&f, 10);
        assert!(edited(&d, &f), "같은 크기여도 내용이 다르면");
        std::fs::write(&f, b"three!").unwrap();
        assert!(edited(&d, &f), "크기가 다르면");
        record(&d, &f);
        assert!(!edited(&d, &f), "올린 뒤 다시 지문 — 단추가 내려간다");
    }

    #[test]
    fn 안_올린_수정본은_청소에서_남긴다() {
        let d = tmp("sweep");
        let dirf = d.join(VIEW_DIR).join("t1").join("로고");
        let (a, b) = (dirf.join("a.ai"), dirf.join("b.ai"));
        for f in [&a, &b] {
            std::fs::write(f, b"one").unwrap();
            record(&d, f);
        }
        std::fs::write(&a, b"edited").unwrap();
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(4 * 24 * 3600);
        let n = crate::team_locker_app::sweep_but(&d.join(VIEW_DIR), crate::team_locker_app::VIEW_KEEP, later, &|p| edited(&d, p));
        assert_eq!(n, 1, "안 고친 b 만 지운다");
        assert!(a.exists() && !b.exists());
    }

    #[test]
    fn 풀어_둔_자리_밖은_안_받는다() {
        let d = tmp("peek");
        let f = d.join(VIEW_DIR).join("t1").join("로고").join("a.ai");
        std::fs::write(&f, b"x").unwrap();
        assert_eq!(in_peek(&d, &f).unwrap().0, "t1");
        let out = d.join("밖.ai");
        std::fs::write(&out, b"x").unwrap();
        assert!(in_peek(&d, &out).is_err());
        assert!(in_peek(&d, &d.join(VIEW_DIR).join("t1").join("..").join("..").join("밖.ai")).is_err(), "../ 로 빠져나가도");
        assert!(in_peek(&d, &d.join(VIEW_DIR).join("t1")).is_err(), "폴더는 아니다");
    }

    #[test]
    fn 내려받기_기억을_거꾸로_원본_id() {
        let mut c = BTreeMap::new();
        c.insert("f-9:123:/d/team-locker-peek/t1".to_string(), "/d/team-locker-peek/t1/로고/a.ai".to_string());
        c.insert("f-2:5:/u/Documents".to_string(), "/u/Documents/a.ai".to_string());
        assert_eq!(source_id(&c, Path::new("/d/team-locker-peek/t1/로고/a.ai")).as_deref(), Some("f-9"));
        assert_eq!(source_id(&c, Path::new("/d/team-locker-peek/t1/b.ai")), None);
    }

    #[test]
    fn 수정본_이름은_한_자리_이름만() {
        assert!(name_ok("팀 로고 (수정).ai"));
        assert!(name_ok("README (수정)"));
        for bad in ["", " a.ai", "a/b.ai", "..", "a\nb", &"가".repeat(201)] {
            assert!(!name_ok(bad), "{bad:?}");
        }
    }
}
