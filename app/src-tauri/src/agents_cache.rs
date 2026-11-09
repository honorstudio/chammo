//! `claude agents --json` 아껴 부르기 — 한 번에 CPU 1.2초(자격 증명 읽는 security 하나 포함)라 2.5초마다 새로 부르면 코어 하나의 40%를 썼다(11-07 실측).
//! 목록의 출처는 세션 파일(<claude>/sessions/<pid>.json)과 일 상태(<claude>/jobs/<id>/state.json)다 — 이 내용과 pid 생사가 그대로면 출력도 그대로니
//! 지문이 같으면 안 부른다. 지문을 못 재면(옛 CLI·폴더 없음) 예전처럼 ttl 만 본다.
//! 모르는 출처가 생겨도 max_age 안에 한 번은 새로 부른다(CLI 가 바뀌어 지문이 놓쳐도 영영 묵지는 않게).
//! 누가 부르는 중이면 옛 목록을 바로 준다 — 맥이 무거우면 CLI 가 10초를 넘겨, 잠금에 줄 선 폰 첫 요청이 시간 초과로 '대화를 못 받아 왔어요'가 됐다(11-07 사용자).
//! 옛 목록이 없을 때(막 켰을 때·비운 직후)만 기다렸다 같은 결과를 받는다.
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

/// 지문이 같아도 이만큼 지나면 새로 — 지문이 놓친 변화의 최악 지연
pub const MAX_AGE: Duration = Duration::from_secs(60);
/// `--all`(꺼진 세션까지, 337KB) 은 더 늦게 — 사람이 부른 새로 고침·세션 띄움은 forget 으로 바로
pub const MAX_AGE_ALL: Duration = Duration::from_secs(300);
/// CLI 가 실패해도 이만큼 안 된 목록이면 그걸 준다 — 무거울 때 10초 제한에 걸린 것을 '세션이 없다'·오류로 내지 않는다
pub const STALE_OK: Duration = Duration::from_secs(300);

struct Cached {
    at: Instant,
    tag: Option<u64>,
    json: String,
}

#[derive(Default)]
struct Slot {
    cached: Option<Cached>,
    busy: bool,
    /// forget 마다 하나씩 — 비우기 전에 시작한 호출의 답은 담지 않는다(누른 뒤 확인이 누르기 전 모습을 받지 않게)
    gen: u64,
}

pub struct Cell {
    slot: Mutex<Option<Slot>>,
    done: Condvar,
}

impl Cell {
    pub const fn new() -> Self {
        Cell { slot: Mutex::new(None), done: Condvar::new() }
    }

    /// 잠금 — 앞사람이 패닉했어도 값은 멀쩡하니 그대로 쓴다
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Slot>> {
        self.slot.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// 옛 목록 없이 앞사람 답을 기다리는 최대 — CLI 제한(10초) + 여유
const WAIT_MAX: Duration = Duration::from_secs(15);

/// Claude Code 설정 폴더 — CLAUDE_CONFIG_DIR 가 있으면 그것
pub fn claude_dir() -> PathBuf {
    std::env::var("CLAUDE_CONFIG_DIR").ok().filter(|d| !d.trim().is_empty()).map(PathBuf::from).unwrap_or_else(|| Path::new(&crate::config::home()).join(".claude"))
}

fn stamp(p: &Path) -> Option<(u128, u64)> {
    let m = std::fs::metadata(p).ok()?;
    let t = m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    Some((t, m.len()))
}

/// 세션 파일에서 목록 답과 상관없이 자주 바뀌는 칸 — 시각만 고친 쓰기로 지문이 바뀌지 않게(바쁜 세션은 몇 초마다 고친다)
const VOLATILE: &[&str] = &["updatedAt", "statusUpdatedAt", "nameSince", "bridgeSessionId"];

/// 세션 목록 지문 — 세션 파일 내용(자주 바뀌는 칸 빼고)·pid 생사·일 상태(state 칸). sessions 폴더가 없으면 None(이 길을 안 쓴다).
/// 시각으로 뜨면 바쁜 세션 때문에 지문이 표본의 절반에서 바뀌었다(11-07 표본 227: 지문 117·출력 9) — 내용으로 뜨고 같은 실측으로 놓침 0 을 확인했다
pub fn fingerprint(dir: &Path, alive: impl Fn(i32) -> bool) -> Option<u64> {
    let mut names: Vec<_> = std::fs::read_dir(dir.join("sessions")).ok()?.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
    names.sort();
    let mut h = DefaultHasher::new();
    for p in &names {
        p.file_name().hash(&mut h);
        // 내용은 작다(1KB). 쓰는 도중이라 못 읽으면 다음 번에 달라진다
        let Some(serde_json::Value::Object(v)) = std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()) else {
            "unread".hash(&mut h);
            continue;
        };
        let mut keys: Vec<_> = v.keys().filter(|k| !VOLATILE.contains(&k.as_str())).collect();
        keys.sort();
        for k in keys {
            k.hash(&mut h);
            v[k].to_string().hash(&mut h);
        }
        if let Some(pid) = v.get("pid").and_then(|x| x.as_i64()) {
            alive(pid as i32).hash(&mut h);
        }
        if let Some(job) = v.get("jobId").and_then(|x| x.as_str()) {
            job_state(&dir.join("jobs").join(job).join("state.json")).hash(&mut h);
        }
    }
    Some(h.finish())
}

/// 일 상태 칸 — 파일은 13KB 까지 크고 바쁜 세션은 자주 고치지만(토큰·할 일) 목록에 나오는 건 이 칸뿐.
/// 파일 시각이 같으면 안 읽는다(세션 수만큼 3초마다 도는 길)
fn job_state(p: &Path) -> Option<String> {
    use std::collections::HashMap;
    type Seen = HashMap<PathBuf, ((u128, u64), Option<String>)>;
    static SEEN: Mutex<Option<Seen>> = Mutex::new(None);
    let st = stamp(p)?;
    let mut g = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    let m = g.get_or_insert_with(HashMap::new);
    if let Some((s, v)) = m.get(p) {
        if *s == st {
            return v.clone();
        }
    }
    let v = std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()).and_then(|j| j["state"].as_str().map(str::to_string));
    if m.len() > 256 {
        m.clear();
    }
    m.insert(p.to_path_buf(), (st, v.clone()));
    v
}

/// `--all` 지문 — 살아 있는 쪽 + 일 폴더 자체(일이 새로 생기거나 지워짐). 꺼진 세션의 상태는 꺼진 뒤 안 바뀐다
pub fn fingerprint_all(dir: &Path, alive: impl Fn(i32) -> bool) -> Option<u64> {
    let live = fingerprint(dir, alive)?;
    let mut h = DefaultHasher::new();
    live.hash(&mut h);
    stamp(&dir.join("jobs")).hash(&mut h);
    Some(h.finish())
}

/// ttl 안이면 그대로, 지났어도 max_age 안이고 지문이 같으면 그대로, 아니면 fetch — fetch 는 잠금 밖에서 돌고 동시에 하나만.
/// 지문은 부르기 **전에** 잰다 — 부르는 사이 바뀌면 다음 번에 달라져 다시 부른다. 실패는 안 담고, stale_ok 안의 옛 목록이 있으면 그걸 준다
pub fn shared(cell: &Cell, ttl: Duration, max_age: Duration, stale_ok: Duration, now: impl Fn() -> Instant, tag: impl FnOnce() -> Option<u64>, fetch: impl FnOnce() -> Result<String, String>) -> Result<String, String> {
    let mut g = cell.lock();
    let mut tag = Some(tag);
    let mut measured = None;
    let start_gen = loop {
        let s = g.get_or_insert_with(Slot::default);
        if let Some(old) = &s.cached {
            let age = now().saturating_duration_since(old.at);
            if age < ttl {
                return Ok(old.json.clone());
            }
            if age < max_age {
                // 지문은 파일 몇 개 — 잠금을 쥔 채 재도 짧다(먼저 잰 값은 이번 호출에서 다시 안 잰다)
                if let Some(f) = tag.take() {
                    measured = Some(f());
                }
                if measured.flatten().is_some() && measured.flatten() == old.tag {
                    return Ok(old.json.clone());
                }
            }
            if s.busy {
                return Ok(old.json.clone()); // 누가 부르는 중 — 끝나길 기다리지 않는다
            }
        } else if s.busy {
            // 옛 목록이 없다 — 앞사람 답을 같이 받는다. 앞사람이 끝내 안 알려도 영영 안 멈추게 시간을 둔다(CLI 제한 10초 + 여유)
            let (ng, timed) = cell.done.wait_timeout(g, WAIT_MAX).unwrap_or_else(|e| e.into_inner());
            g = ng;
            if timed.timed_out() {
                if let Some(s) = g.as_mut() {
                    s.busy = false;
                }
            }
            continue;
        }
        s.busy = true;
        break s.gen;
    };
    drop(g);
    // 부르다 패닉해도 '부르는 중'을 푼다 — 안 풀면 세션 목록이 앱 전체에서 멈춘다
    let guard = Release(cell);
    let t = match (measured, tag) {
        (Some(v), _) => v,
        (None, Some(f)) => f(),
        (None, None) => None,
    };
    let at = now();
    let out = fetch();
    let mut g = cell.lock();
    let s = g.get_or_insert_with(Slot::default);
    let answer = match out {
        Ok(json) => {
            if s.gen == start_gen {
                s.cached = Some(Cached { at, tag: t, json: json.clone() });
            }
            Ok(json)
        }
        Err(e) => match &s.cached {
            Some(old) if now().saturating_duration_since(old.at) < stale_ok => Ok(old.json.clone()),
            _ => Err(e),
        },
    };
    drop(g);
    drop(guard);
    answer
}

struct Release<'a>(&'a Cell);

impl Drop for Release<'_> {
    fn drop(&mut self) {
        if let Some(s) = self.0.lock().as_mut() {
            s.busy = false;
        }
        self.0.done.notify_all();
    }
}

/// 비운다 — 세션을 띄우거나 끈 뒤·사람이 새로 고침을 부른 때. 도는 중인 호출의 답은 안 담는다
pub fn forget(cell: &Cell) {
    let mut g = cell.lock();
    let s = g.get_or_insert_with(Slot::default);
    s.cached = None;
    s.gen += 1;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell as StdCell;
    use std::sync::Arc;

    const TTL: Duration = Duration::from_millis(2500);

    fn run(cell: &Cell, at: Instant, tag: Option<u64>, runs: &StdCell<u32>, v: &str) -> String {
        shared(cell, TTL, MAX_AGE, STALE_OK, || at, || tag, || { runs.set(runs.get() + 1); Ok(v.to_string()) }).unwrap()
    }

    #[test]
    fn 지문이_같으면_ttl_이_지나도_다시_안_부른다() {
        let (cell, runs, t0) = (Cell::new(), StdCell::new(0), Instant::now());
        assert_eq!(run(&cell, t0, Some(1), &runs, "a"), "a");
        for s in [3u64, 6, 9, 30, 59] {
            assert_eq!(run(&cell, t0 + Duration::from_secs(s), Some(1), &runs, "b"), "a", "{s}초");
        }
        assert_eq!(runs.get(), 1, "3초 폴링 20번에 CLI 는 한 번");
    }

    #[test]
    fn 지문이_바뀌면_바로_새로_부른다() {
        let (cell, runs, t0) = (Cell::new(), StdCell::new(0), Instant::now());
        run(&cell, t0, Some(1), &runs, "a");
        assert_eq!(run(&cell, t0 + Duration::from_secs(3), Some(2), &runs, "b"), "b");
        assert_eq!(runs.get(), 2);
    }

    #[test]
    fn 지문이_같아도_max_age_가_지나면_새로_부른다() {
        let (cell, runs, t0) = (Cell::new(), StdCell::new(0), Instant::now());
        run(&cell, t0, Some(1), &runs, "a");
        assert_eq!(run(&cell, t0 + MAX_AGE, Some(1), &runs, "b"), "b", "모르는 출처가 생겨도 이 안에 한 번은 새로");
    }

    #[test]
    fn 지문을_못_재면_ttl_대로_예전처럼() {
        let (cell, runs, t0) = (Cell::new(), StdCell::new(0), Instant::now());
        run(&cell, t0, None, &runs, "a");
        assert_eq!(run(&cell, t0 + Duration::from_secs(1), None, &runs, "b"), "a");
        assert_eq!(run(&cell, t0 + Duration::from_secs(3), None, &runs, "c"), "c", "None 끼리 같다고 치지 않는다");
    }

    #[test]
    fn 비우면_바로_새로_묻는다() {
        let (cell, runs, t0) = (Cell::new(), StdCell::new(0), Instant::now());
        run(&cell, t0, Some(1), &runs, "a");
        forget(&cell);
        assert_eq!(run(&cell, t0, Some(1), &runs, "b"), "b");
    }

    #[test]
    fn 실패해도_옛_목록이_있으면_그걸_주고_오래됐거나_없으면_오류() {
        let (cell, runs, t0) = (Cell::new(), StdCell::new(0), Instant::now());
        let fail = |c: &Cell, at: Instant| shared(c, TTL, MAX_AGE, STALE_OK, || at, || Some(9), || Err::<String, String>("시간 초과".into()));
        assert_eq!(fail(&cell, t0), Err("시간 초과".to_string()), "옛 목록이 없으면 오류 그대로");
        run(&cell, t0, Some(1), &runs, "a");
        assert_eq!(fail(&cell, t0 + Duration::from_secs(70)), Ok("a".to_string()), "무거워서 CLI 가 10초를 넘긴 때 — 세션이 사라진 걸로 안 보이게");
        assert_eq!(fail(&cell, t0 + STALE_OK + Duration::from_secs(1)), Err("시간 초과".to_string()), "오래되면 숨기지 않는다");
    }

    #[test]
    fn 누가_부르는_중이면_옛_목록을_바로_준다_폰_첫_요청이_줄_서지_않는다() {
        let cell = Arc::new(Cell::new());
        let t0 = Instant::now();
        let runs = StdCell::new(0);
        run(&cell, t0, Some(1), &runs, "옛");
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (go_tx, go_rx) = std::sync::mpsc::channel::<()>();
        let c2 = cell.clone();
        let later = t0 + Duration::from_secs(5);
        let h = std::thread::spawn(move || {
            shared(&c2, TTL, MAX_AGE, STALE_OK, || later, || Some(2), || {
                entered_tx.send(()).unwrap();
                go_rx.recv().unwrap(); // 무거운 맥의 CLI 흉내
                Ok("새".to_string())
            })
        });
        entered_rx.recv().unwrap();
        let started = Instant::now();
        let got = shared(&cell, TTL, MAX_AGE, STALE_OK, || later, || Some(2), || panic!("둘이 같이 부르면 안 된다"));
        assert_eq!(got, Ok("옛".to_string()));
        assert!(started.elapsed() < Duration::from_secs(1), "안 기다린다");
        go_tx.send(()).unwrap();
        assert_eq!(h.join().unwrap(), Ok("새".to_string()));
        assert_eq!(run(&cell, later, Some(2), &runs, "또"), "새", "끝나면 새 목록");
    }

    #[test]
    fn 옛_목록이_없으면_기다렸다_같은_답을_받는다() {
        let cell = Arc::new(Cell::new());
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (go_tx, go_rx) = std::sync::mpsc::channel::<()>();
        let t0 = Instant::now();
        let c2 = cell.clone();
        let h = std::thread::spawn(move || {
            shared(&c2, TTL, MAX_AGE, STALE_OK, || t0, || Some(1), || {
                entered_tx.send(()).unwrap();
                go_rx.recv().unwrap();
                Ok("답".to_string())
            })
        });
        entered_rx.recv().unwrap();
        let c3 = cell.clone();
        let waiter = std::thread::spawn(move || shared(&c3, TTL, MAX_AGE, STALE_OK, || t0, || Some(1), || panic!("둘이 같이 부르면 안 된다")));
        std::thread::sleep(Duration::from_millis(50));
        go_tx.send(()).unwrap();
        assert_eq!(h.join().unwrap(), Ok("답".to_string()));
        assert_eq!(waiter.join().unwrap(), Ok("답".to_string()));
    }

    #[test]
    fn 부르다_패닉해도_다음_호출이_안_막힌다() {
        let cell = Arc::new(Cell::new());
        let t0 = Instant::now();
        let c2 = cell.clone();
        let r = std::thread::spawn(move || shared(&c2, TTL, MAX_AGE, STALE_OK, || t0, || Some(1), || panic!("CLI 길에서 터짐"))).join();
        assert!(r.is_err());
        let runs = StdCell::new(0);
        assert_eq!(run(&cell, t0, Some(1), &runs, "다시"), "다시", "세션 목록이 앱 전체에서 멈추지 않는다");
    }

    #[test]
    fn 비우기_전에_시작한_호출의_답은_안_담는다_누른_뒤_확인이_옛_모습을_안_받게() {
        let cell = Arc::new(Cell::new());
        let t0 = Instant::now();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (go_tx, go_rx) = std::sync::mpsc::channel::<()>();
        let c2 = cell.clone();
        let h = std::thread::spawn(move || {
            shared(&c2, TTL, MAX_AGE, STALE_OK, || t0, || Some(1), || {
                entered_tx.send(()).unwrap();
                go_rx.recv().unwrap();
                Ok("누르기 전".to_string())
            })
        });
        entered_rx.recv().unwrap();
        forget(&cell); // 누름 — 지금 도는 호출은 누르기 전 모습일 수 있다
        go_tx.send(()).unwrap();
        h.join().unwrap().unwrap();
        let runs = StdCell::new(0);
        assert_eq!(run(&cell, t0, Some(1), &runs, "누른 뒤"), "누른 뒤", "새로 불렀다");
    }

    fn fake_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-agents-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("sessions")).unwrap();
        std::fs::create_dir_all(d.join("jobs/abc")).unwrap();
        d
    }

    fn touch_later(p: &Path, body: &str) {
        std::fs::write(p, body).unwrap();
        // 파일 시계가 거칠어도 달라지게 — 수정 시각을 직접 민다
        let t = std::fs::metadata(p).unwrap().modified().unwrap() + Duration::from_secs(5);
        std::fs::File::options().write(true).open(p).unwrap().set_modified(t).unwrap();
    }

    #[test]
    fn 지문은_목록에_나오는_값이_바뀔_때만_바뀐다() {
        let d = fake_dir();
        let s = d.join("sessions/7.json");
        std::fs::write(&s, r#"{"pid":7,"jobId":"abc","status":"idle","updatedAt":1,"statusUpdatedAt":1}"#).unwrap();
        std::fs::write(d.join("sessions/7.abc.key"), "secret").unwrap();
        std::fs::write(d.join("jobs/abc/state.json"), r#"{"state":"done","tokens":1}"#).unwrap();
        let a = fingerprint(&d, |_| true).unwrap();
        assert_eq!(fingerprint(&d, |_| true).unwrap(), a, "아무것도 안 바뀌면 그대로");
        std::fs::write(d.join("sessions/7.abc.key"), "other").unwrap();
        assert_eq!(fingerprint(&d, |_| true).unwrap(), a, ".key 는 안 본다");
        touch_later(&s, r#"{"statusUpdatedAt":9,"pid":7,"jobId":"abc","status":"idle","updatedAt":9}"#);
        assert_eq!(fingerprint(&d, |_| true).unwrap(), a, "시각 칸만 바뀌면 그대로 — 키 순서도 안 본다");
        touch_later(&d.join("jobs/abc/state.json"), r#"{"state":"done","tokens":999}"#);
        assert_eq!(fingerprint(&d, |_| true).unwrap(), a, "토큰만 늘면 그대로 — 바쁜 세션이 몇 초마다 고치는 파일");
        assert_ne!(fingerprint(&d, |_| false).unwrap(), a, "프로세스가 죽으면 바뀐다(파일이 남아 있어도)");
        touch_later(&d.join("jobs/abc/state.json"), r#"{"state":"working","tokens":999}"#);
        let b = fingerprint(&d, |_| true).unwrap();
        assert_ne!(b, a, "일 상태가 바뀌면 바뀐다");
        touch_later(&s, r#"{"pid":7,"jobId":"abc","status":"busy","updatedAt":9}"#);
        let c = fingerprint(&d, |_| true).unwrap();
        assert_ne!(c, b, "세션 상태가 바뀌면 바뀐다");
        touch_later(&s, r#"{"pid":7,"jobId":"abc","status":"busy","waitingFor":"permission prompt","updatedAt":9}"#);
        let e = fingerprint(&d, |_| true).unwrap();
        assert_ne!(e, c, "모르는 칸이 생겨도 바뀐다 — 빼는 칸만 정해 뒀다");
        std::fs::remove_file(&s).unwrap();
        assert_ne!(fingerprint(&d, |_| true).unwrap(), e, "세션이 없어지면 바뀐다");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 세션_폴더가_없으면_지문이_없다() {
        assert_eq!(fingerprint(Path::new("/없는/폴더"), |_| true), None);
    }

    #[test]
    fn 전체_목록_지문은_일이_늘면_바뀐다() {
        let d = fake_dir();
        let a = fingerprint_all(&d, |_| true).unwrap();
        std::fs::create_dir_all(d.join("jobs/new")).unwrap();
        let t = std::fs::metadata(d.join("jobs")).unwrap().modified().unwrap() + Duration::from_secs(5);
        let f = std::fs::File::open(d.join("jobs")).unwrap();
        // 폴더 시각을 못 미는 파일 시스템이면 시험을 건너뛴다 — 그땐 max_age 가 받친다
        if f.set_modified(t).is_ok() {
            assert_ne!(fingerprint_all(&d, |_| true).unwrap(), a);
        }
        let _ = std::fs::remove_dir_all(&d);
    }
}
