//! 파일 썸네일 캐시 — 데스크톱 카드(ql_thumb)·폰(/api/file?thumb·/api/team-file-thumb)이 같이 쓴다(2026-11-01).
//! 전엔 데스크톱은 1600px PNG 를 지우지 않고 쌓았고(369개·162MB), 폰은 캐시 없이 요청마다 sips·qlmanage 를 다시 돌렸다.
//! - 이름 = 원본 경로·수정 시각·크기·px 해시 → 원본이 바뀌면 다른 이름이라 묵은 그림을 안 준다(신선도 문제 없음)
//! - 못 만든 것도 기억(<이름>.fail) — hwpx 처럼 20초 헛도는 파일을 열 때마다 다시 안 돌린다. 원본이 바뀌면 새로 해 본다
//! - 만들기는 앱 전체에서 동시에 MAX_MAKERS 개 — qlmanage 하나가 ~95MB 라 카드 20장이 한꺼번에 뜨면 20개가 동시에 떴다
//! - 폴더가 CAP 을 넘으면 오래 안 쓴 것부터 지운다(앱 켤 때·새로 PRUNE_EVERY 장 쓸 때마다). 쓸 때(hit)는 수정 시각을 당겨 LRU 로
//! 미리 만들기·감시는 없다 — 화면에 뜬 카드가 부를 때만 만든다(가만히 있을 땐 CPU·디스크 0)
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};

pub const CAP: u64 = 200 * 1024 * 1024;
pub const MAX_MAKERS: usize = 2;
const PRUNE_EVERY: u64 = 64;

/// 데이터 폴더 아래 썸네일 자리
pub fn dir() -> PathBuf {
    crate::config::data_file("thumbs")
}

/// 캐시 이름(확장자 없이) — 원본을 못 읽으면 None(그땐 캐시 없이 만든다)
pub fn key(src: &Path, px: u32) -> Option<String> {
    let m = std::fs::metadata(src).ok()?;
    let t = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
    let mut h: u64 = 0xcbf29ce484222325;
    for b in src.to_string_lossy().as_bytes().iter().chain(format!("\0{t}\0{}\0{px}", m.len()).as_bytes()) {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    Some(format!("{h:016x}-{px}"))
}

pub enum Hit {
    /// 만들어 둔 그림
    Ready(PathBuf),
    /// 전에 못 만들었다(원본 그대로면 또 안 해 본다)
    Failed,
    /// 없다 — 여기에 만들어 넣으면 된다
    Miss(PathBuf),
}

/// 찾기 — 있으면 수정 시각을 지금으로 당긴다(오래 안 쓴 것부터 지우게)
pub fn look(dir: &Path, key: &str, ext: &str) -> Hit {
    let p = dir.join(format!("{key}.{ext}"));
    if p.metadata().is_ok_and(|m| m.len() > 0) {
        let _ = std::fs::File::options().append(true).open(&p).and_then(|f| f.set_modified(std::time::SystemTime::now()));
        return Hit::Ready(p);
    }
    if dir.join(format!("{key}.fail")).exists() {
        return Hit::Failed;
    }
    Hit::Miss(p)
}

/// 못 만든 걸 기억
pub fn mark_failed(dir: &Path, key: &str) {
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(dir.join(format!("{key}.fail")), b"");
}

/// 만든 바이트를 넣는다(임시 이름 → 제자리, 같은 걸 동시에 만들어도 반쯤 쓴 그림이 안 보이게)
pub fn put(dir: &Path, key: &str, ext: &str, bytes: &[u8]) -> Option<PathBuf> {
    std::fs::create_dir_all(dir).ok()?;
    let tmp = dir.join(format!(".{key}-{}-{}.part.{ext}", std::process::id(), TMP_N.fetch_add(1, Ordering::Relaxed)));
    let out = dir.join(format!("{key}.{ext}"));
    std::fs::write(&tmp, bytes).ok()?;
    std::fs::rename(&tmp, &out).ok()?;
    wrote(dir);
    Some(out)
}

/// 새로 쓴 걸 세어 PRUNE_EVERY 장마다 지우기 — 다른 길(파일째 옮긴 그림)도 부른다
pub fn wrote(dir: &Path) {
    static WROTE: AtomicU64 = AtomicU64::new(0);
    if WROTE.fetch_add(1, Ordering::Relaxed) % PRUNE_EVERY == PRUNE_EVERY - 1 {
        prune(dir, CAP);
    }
}

/// 폴더가 cap 을 넘으면 오래 안 쓴(수정 시각이 오랜) 것부터 지운다. .fail 표시는 크기가 0 이라 셈엔 없고, 하루 지난 것만 같이 지운다
/// (지운 바이트)
pub fn prune(dir: &Path, cap: u64) -> u64 {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    let day = std::time::SystemTime::now() - std::time::Duration::from_secs(24 * 3600);
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = Vec::new();
    for e in rd.flatten() {
        let Ok(m) = e.metadata() else { continue };
        if !m.is_file() {
            continue;
        }
        let t = m.modified().unwrap_or(std::time::UNIX_EPOCH);
        let p = e.path();
        // 반쯤 쓰다 남은 .part(앱이 죽은 자리)·하루 지난 실패 표시는 그냥 지운다
        let name = e.file_name().to_string_lossy().into_owned();
        if (name.contains(".part.") || name.ends_with(".fail")) && t < day {
            let _ = std::fs::remove_file(&p);
            continue;
        }
        files.push((t, m.len(), p));
    }
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    if total <= cap {
        return 0;
    }
    files.sort_by_key(|f| f.0);
    let mut gone = 0;
    for (_, len, p) in files {
        if total <= cap {
            break;
        }
        if std::fs::remove_file(&p).is_ok() {
            total -= len;
            gone += len;
        }
    }
    gone
}

/// 앱 켤 때 한 번 — 상한 맞추기 + 옛 썸네일 폴더(<데이터>/ql, 1600 PNG 를 안 지우고 쌓던 자리) 지우기
pub fn startup_tidy() {
    std::thread::spawn(|| {
        let _ = std::fs::remove_dir_all(crate::config::data_file("ql"));
        prune(&dir(), CAP);
    });
}

/// 동시에 만드는 수 문 — 앱 전체에서 MAX_MAKERS 개. 그 밖은 차례를 기다린다
pub struct Gate {
    busy: Mutex<usize>,
    free: Condvar,
    max: usize,
}

impl Gate {
    pub const fn new(max: usize) -> Self {
        Gate { busy: Mutex::new(0), free: Condvar::new(), max }
    }
    pub fn run<T>(&self, f: impl FnOnce() -> T) -> T {
        {
            let mut n = self.busy.lock().unwrap_or_else(|e| e.into_inner());
            while *n >= self.max {
                n = self.free.wait(n).unwrap_or_else(|e| e.into_inner());
            }
            *n += 1;
        }
        // f 가 패닉해도 자리를 돌려준다
        struct Back<'a>(&'a Gate);
        impl Drop for Back<'_> {
            fn drop(&mut self) {
                *self.0.busy.lock().unwrap_or_else(|e| e.into_inner()) -= 1;
                self.0.free.notify_one();
            }
        }
        let _back = Back(self);
        f()
    }
}

pub static MAKERS: Gate = Gate::new(MAX_MAKERS);

/// 캐시를 거쳐 만들기 — 있으면 그 자리, 전에 실패면 None, 없으면 문(MAKERS)을 지나 make(넣을 자리)로 만든다.
/// make 는 그 자리에 파일을 쓰고 Ok, 못 하면 Err(실패로 기억). 원본 메타를 못 읽으면 캐시 없이 None
pub fn cached(dir: &Path, src: &Path, px: u32, ext: &str, make: impl FnOnce(&Path) -> Result<(), String>) -> Result<PathBuf, String> {
    let k = key(src, px).ok_or("원본을 못 읽었어")?;
    let out = match look(dir, &k, ext) {
        Hit::Ready(p) => return Ok(p),
        Hit::Failed => return Err("전에 미리보기를 못 만든 파일".into()),
        Hit::Miss(p) => p,
    };
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // 임시 자리에 만들고 다 되면 옮긴다 — 반쯤 쓴 그림을 다른 부름이 Ready 로 집지 않게. 확장자는 남긴다(변환기가 보고 형식을 고른다)
    let tmp = dir.join(format!(".{k}-{}-{}.part.{ext}", std::process::id(), TMP_N.fetch_add(1, Ordering::Relaxed)));
    let r = MAKERS.run(|| make(&tmp));
    let made = r.is_ok() && tmp.metadata().is_ok_and(|m| m.len() > 0) && std::fs::rename(&tmp, &out).is_ok();
    let _ = std::fs::remove_file(&tmp);
    if made {
        wrote(dir);
        return Ok(out);
    }
    mark_failed(dir, &k);
    Err(r.err().unwrap_or_else(|| "빈 그림".into()))
}

static TMP_N: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
#[path = "thumbs_tests.rs"]
mod tests;
