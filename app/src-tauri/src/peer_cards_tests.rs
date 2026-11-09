use super::*;
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// 실측 축소판(1/5) — 꺼진 테일넷 기기는 SOCKS 가 5.0초 뒤 실패(11-08 실측). 켜진 기기 한 번 묻기는 넉넉히 300ms(병렬·차례 차이가 부하에 안 묻히게)
const OFF: Duration = Duration::from_millis(1000);
const ON: Duration = Duration::from_millis(300);
/// 폰·데스크톱이 묻는 주기
const POLL: Duration = Duration::from_secs(4);

fn paired_of(ids: &[&str]) -> Vec<(String, String)> {
    ids.iter().map(|s| (s.to_string(), format!("참모 · {s}"))).collect()
}

fn paired() -> Vec<(String, String)> {
    paired_of(&["nA", "nOFF", "nB"])
}

fn slow(id: &str) -> Result<Got, String> {
    if id == "nOFF" {
        std::thread::sleep(OFF);
        return Err("그 기기에 닿지 않아요".into());
    }
    std::thread::sleep(ON * 2); // /api/direct + /api/sessions
    Ok(Got { log: format!("{id}-log"), sessions: Some(format!("[\"{id}\"]")) })
}

fn row<'a>(v: &'a serde_json::Value, id: &str) -> Option<&'a serde_json::Value> {
    v.as_array()?.iter().find(|r| r["dev"] == id)
}

fn ids(v: &serde_json::Value) -> Vec<String> {
    v.as_array().unwrap().iter().map(|r| r["dev"].as_str().unwrap().to_string()).collect()
}

/// 손으로 넘기는 시계 — 쉬기·10분 같은 긴 시간을 기다리지 않고 잰다
struct Clock(Mutex<Instant>);
impl Clock {
    fn new() -> Self {
        Clock(Mutex::new(Instant::now()))
    }
    fn now(&self) -> Instant {
        *self.0.lock().unwrap()
    }
    fn add(&self, d: Duration) {
        *self.0.lock().unwrap() += d;
    }
}

/// 기기마다 몇 번 물었나 + 지금 켜진 기기(나머지는 실패)
struct Fake {
    calls: Mutex<Vec<String>>,
    on: Mutex<Vec<String>>,
}
impl Fake {
    fn new(on: &[&str]) -> Self {
        Fake { calls: Mutex::new(vec![]), on: Mutex::new(on.iter().map(|s| s.to_string()).collect()) }
    }
    fn fetch(&self, id: &str) -> Result<Got, String> {
        self.calls.lock().unwrap().push(id.to_string());
        if self.on.lock().unwrap().iter().any(|x| x == id) {
            Ok(Got { log: format!("{id}-log"), sessions: Some("[]".into()) })
        } else {
            Err("안 닿음".into())
        }
    }
    fn count(&self, id: &str) -> usize {
        self.calls.lock().unwrap().iter().filter(|x| *x == id).count()
    }
    fn set_on(&self, on: &[&str]) {
        *self.on.lock().unwrap() = on.iter().map(|s| s.to_string()).collect();
    }
}

/// 앱처럼 — look 이 돌리라면 그 자리에서(시험은 동기로) 한 바퀴
fn poll(h: &Hub, p: &[(String, String)], f: &Fake, c: &Clock) -> serde_json::Value {
    let (v, go) = h.look(p, c.now());
    if go {
        h.refresh(p, &|id| f.fetch(id), &|| c.now());
    }
    v
}

#[test]
fn 꺼진_기기가_섞여도_폰_요청은_기다리지_않는다() {
    static HUB: Hub = Hub::new();
    let p = paired();
    let mut worst = Duration::ZERO;
    let mut look = || {
        let t = Instant::now();
        let r = HUB.look(&p, Instant::now());
        worst = worst.max(t.elapsed());
        r
    };
    // 처음 — 아직 아무것도 없다. 기다리지 않고 빈 목록, 한 바퀴는 뒤에서
    let (v, go) = look();
    assert_eq!(v, serde_json::json!([]));
    assert!(go);
    let p2 = p.clone();
    let bg = std::thread::spawn(move || HUB.refresh(&p2, &slow, &Instant::now));
    // 도는 동안 또 물어도 기다리지 않고, 바퀴를 하나 더 열지 않는다
    std::thread::sleep(Duration::from_millis(50));
    let (_, again) = look();
    assert!(!again, "도는 바퀴가 있으면 새로 안 연다");
    bg.join().unwrap();
    let (v, _) = look();
    eprintln!("폰 요청 가장 느린 한 번: {:?} (옛 길은 같은 조건에서 1,265ms)", worst);
    assert!(worst < Duration::from_millis(50), "폰 요청이 {worst:?} 기다렸다 — 꺼진 기기 시간초과를 물고 있다");
    assert_eq!(ids(&v), ["nA", "nOFF", "nB"], "짝지은 순서대로, 꺼진 기기도 줄은 남는다");
    assert_eq!(row(&v, "nA").unwrap()["log"], "nA-log");
    assert!(row(&v, "nA").unwrap().get("off").is_none());
    assert_eq!(row(&v, "nOFF").unwrap()["off"], true);
    assert_eq!(row(&v, "nOFF").unwrap()["log"], "");
    assert_eq!(row(&v, "nOFF").unwrap()["sessions"], "[]");
}

#[test]
fn 한_바퀴는_기기들을_병렬로_묻는다() {
    let h = Hub::new();
    assert!(h.look(&paired(), Instant::now()).1);
    let t = Instant::now();
    h.refresh(&paired(), &slow, &Instant::now);
    let took = t.elapsed();
    eprintln!("한 바퀴: {took:?} (차례로면 {:?})", OFF + ON * 4);
    // 차례로 = 1000 + 600 + 600 = 2200ms, 병렬 = 가장 느린 기기 1000ms
    assert!(took >= OFF && took < OFF + ON * 2, "한 바퀴 {took:?} — 병렬이 아니다");
}

#[test]
fn 빠른_기기_카드는_느린_기기를_기다리지_않고_바로_보인다() {
    let h = Hub::new();
    let p = paired();
    let (tx, rx) = mpsc::channel::<()>();
    let rx = Mutex::new(rx);
    let fetch = |id: &str| {
        if id == "nOFF" {
            let _ = rx.lock().unwrap().recv_timeout(Duration::from_secs(10)); // 시험이 풀 때까지 붙잡힌다
            return Err("안 닿음".to_string());
        }
        Ok(Got { log: format!("{id}-log"), sessions: Some("[]".into()) })
    };
    assert!(h.look(&p, Instant::now()).1);
    std::thread::scope(|s| {
        s.spawn(|| h.refresh(&p, &fetch, &Instant::now));
        let end = Instant::now() + Duration::from_secs(5);
        loop {
            let v = h.snapshot(&p, Instant::now());
            if row(&v, "nA").is_some() && row(&v, "nB").is_some() {
                assert!(row(&v, "nOFF").is_none(), "nOFF 는 아직 답이 없다");
                break;
            }
            assert!(Instant::now() < end, "빠른 기기 카드가 느린 기기 답을 기다렸다");
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(!h.look(&p, Instant::now()).1, "느린 기기가 남은 동안 새 바퀴는 안 연다");
        tx.send(()).unwrap();
    });
    assert_eq!(row(&h.snapshot(&p, Instant::now()), "nOFF").unwrap()["off"], true);
}

#[test]
fn 안_닿는_기기는_짧게_쉬었다_다시_묻는다() {
    let (h, c, f, p) = (Hub::new(), Clock::new(), Fake::new(&["nA"]), paired_of(&["nA", "nOFF"]));
    let mut seen = vec![];
    // 4초마다 묻는 폰 — 2분
    for _ in 0..30 {
        poll(&h, &p, &f, &c);
        seen.push(f.count("nOFF"));
        c.add(POLL);
    }
    assert_eq!(f.count("nA"), 30, "켜진 기기는 바퀴마다");
    // 실패 1→5초, 2→10, 3→20, 4~→30초 쉬기. 4초 걸음이라 0·8·20·40·72·104초에 묻는다
    let asked_at: Vec<usize> = (0..seen.len()).filter(|&i| i == 0 || seen[i] > seen[i - 1]).map(|i| i * 4).collect();
    assert_eq!(asked_at, [0, 8, 20, 40, 72, 104]);
}

#[test]
fn 꺼진_기기는_숨기지_않고_돌아오면_다시_보인다() {
    let (h, c, f, p) = (Hub::new(), Clock::new(), Fake::new(&[]), paired_of(&["nOFF"]));
    poll(&h, &p, &f, &c);
    // 10분 내내 꺼져 있어도 줄은 off 로 남고, 30초 넘게 안 묻는 일은 없다
    let mut last_ask = c.now();
    let mut n = f.count("nOFF");
    for _ in 0..150 {
        c.add(POLL);
        let v = poll(&h, &p, &f, &c);
        assert_eq!(row(&v, "nOFF").unwrap()["off"], true);
        if f.count("nOFF") > n {
            n = f.count("nOFF");
            last_ask = c.now();
        }
        assert!(c.now() - last_ask <= backoff(u32::MAX) + POLL, "꺼진 기기를 영영 안 묻는다");
    }
    // 돌아오면 쉬는 시간이 끝난 첫 바퀴에 — 30초 + 4초 걸음 안에 다시 보인다
    f.set_on(&["nOFF"]);
    let back = c.now();
    let seen_at = loop {
        c.add(POLL);
        poll(&h, &p, &f, &c);
        let v = h.snapshot(&p, c.now());
        if row(&v, "nOFF").unwrap().get("off").is_none() {
            assert_eq!(row(&v, "nOFF").unwrap()["log"], "nOFF-log");
            break c.now() - back;
        }
        assert!(c.now() - back < Duration::from_secs(60), "돌아온 기기가 안 보인다");
    };
    assert!(seen_at <= backoff(u32::MAX) + POLL, "돌아온 뒤 {seen_at:?} 만에 보였다");
}

#[test]
fn 끊긴_기기의_마지막_카드는_10분까지_off_로_같이() {
    let (h, c, f, p) = (Hub::new(), Clock::new(), Fake::new(&["nA"]), paired_of(&["nA"]));
    poll(&h, &p, &f, &c);
    c.add(POLL);
    f.set_on(&[]);
    poll(&h, &p, &f, &c);
    let v = h.snapshot(&p, c.now());
    assert_eq!(row(&v, "nA").unwrap()["off"], true);
    assert_eq!(row(&v, "nA").unwrap()["log"], "nA-log", "잠깐 끊겨도 카드가 깜빡 사라지지 않는다");
    c.add(KEEP_OFF - POLL - Duration::from_secs(1));
    assert_eq!(row(&h.snapshot(&p, c.now()), "nA").unwrap()["log"], "nA-log");
    c.add(Duration::from_secs(1));
    let v = h.snapshot(&p, c.now());
    assert_eq!((row(&v, "nA").unwrap()["log"].as_str(), row(&v, "nA").unwrap()["off"].as_bool()), (Some(""), Some(true)), "10분 넘으면 줄만");
}

#[test]
fn 세션_목록만_못_받으면_전_목록을_쓴다() {
    let h = Hub::new();
    let p = paired_of(&["nA"]);
    let c = Clock::new();
    let first = |_: &str| Ok(Got { log: "L1".into(), sessions: Some("[{\"id\":\"s1\"}]".into()) });
    assert!(h.look(&p, c.now()).1);
    h.refresh(&p, &first, &|| c.now());
    let no_sessions = |_: &str| Ok(Got { log: "L2".into(), sessions: None });
    c.add(POLL);
    assert!(h.look(&p, c.now()).1);
    h.refresh(&p, &no_sessions, &|| c.now());
    let v = h.snapshot(&p, c.now());
    // "[]" 로 비우면 그 기기 카드가 전부 '세션 꺼짐'으로 사라진다(remoteCards)
    assert_eq!((row(&v, "nA").unwrap()["log"].as_str(), row(&v, "nA").unwrap()["sessions"].as_str()), (Some("L2"), Some("[{\"id\":\"s1\"}]")));
    // 처음부터 세션 목록을 못 받았으면 빈 목록
    let h2 = Hub::new();
    assert!(h2.look(&p, c.now()).1);
    h2.refresh(&p, &no_sessions, &|| c.now());
    assert_eq!(row(&h2.snapshot(&p, c.now()), "nA").unwrap()["sessions"], "[]");
}

#[test]
fn 끊은_기기는_줄이_사라지고_새로_이은_기기는_다음_바퀴에() {
    let (h, c, f) = (Hub::new(), Clock::new(), Fake::new(&["nA", "nB", "nC"]));
    poll(&h, &paired_of(&["nA", "nB"]), &f, &c);
    assert_eq!(ids(&h.snapshot(&paired_of(&["nA", "nB"]), c.now())), ["nA", "nB"]);
    // 끊으면 다음 바퀴를 기다리지 않고 바로 빠진다
    assert_eq!(ids(&h.snapshot(&paired_of(&["nA"]), c.now())), ["nA"]);
    c.add(POLL);
    poll(&h, &paired_of(&["nA", "nC"]), &f, &c);
    assert_eq!(ids(&h.snapshot(&paired_of(&["nA", "nC"]), c.now())), ["nA", "nC"]);
    assert_eq!(h.devs.lock().unwrap().iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), ["nA", "nC"], "끊은 기기 상태는 잊는다");
    // 다시 이으면 쉬기·옛 카드 없이 처음부터
    c.add(POLL);
    poll(&h, &paired_of(&["nA", "nB"]), &f, &c);
    assert_eq!(f.count("nB"), 2);
}

#[test]
fn 묵지_않았으면_다시_묻지_않는다() {
    let (h, c, f, p) = (Hub::new(), Clock::new(), Fake::new(&["nA"]), paired_of(&["nA"]));
    poll(&h, &p, &f, &c);
    for _ in 0..5 {
        c.add(Duration::from_millis(500));
        poll(&h, &p, &f, &c);
    }
    assert_eq!(f.count("nA"), 1, "3초 안엔 한 번만(폰·데스크톱이 같이 물어도)");
    c.add(FRESH - Duration::from_millis(2500));
    poll(&h, &p, &f, &c);
    assert_eq!(f.count("nA"), 2);
}

#[test]
fn 폰_주기가_조금_당겨져도_바퀴를_건너뛰지_않는다() {
    let (h, c, f, p) = (Hub::new(), Clock::new(), Fake::new(&["nA"]), paired_of(&["nA"]));
    for _ in 0..10 {
        poll(&h, &p, &f, &c);
        c.add(POLL - Duration::from_millis(10));
    }
    assert_eq!(f.count("nA"), 10);
}

#[test]
fn 짝지은_기기가_없으면_빈_목록이고_망을_안_부른다() {
    let (h, c, f) = (Hub::new(), Clock::new(), Fake::new(&[]));
    assert_eq!(poll(&h, &[], &f, &c), serde_json::json!([]));
    assert!(f.calls.lock().unwrap().is_empty());
}

#[test]
fn 묻다가_패닉해도_다음_바퀴가_열린다() {
    let h = Hub::new();
    let p = paired_of(&["nA", "nBAD"]);
    let fetch = |id: &str| {
        if id == "nBAD" {
            panic!("망 코드 패닉");
        }
        Ok(Got { log: "ok".into(), sessions: None })
    };
    assert!(h.look(&p, Instant::now()).1);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| h.refresh(&p, &fetch, &Instant::now)));
    assert!(r.is_err());
    assert_eq!(row(&h.snapshot(&p, Instant::now()), "nA").unwrap()["log"], "ok", "다른 기기 답은 남는다");
    assert!(h.look(&p, Instant::now()).1, "바퀴 표시가 풀려 다음 요청이 다시 돈다");
}

#[test]
fn 쉬는_시간_표() {
    let s: Vec<u64> = [0, 1, 2, 3, 4, 50, u32::MAX].iter().map(|&n| backoff(n).as_secs()).collect();
    assert_eq!(s, [0, 5, 10, 20, 30, 30, 30]);
}

/// 실측 크기로 옛 길·새 길 — cargo test peer_cards_real -- --ignored --nocapture
#[test]
#[ignore]
fn peer_cards_real_scale() {
    // 꺼진 기기 5.0초(SOCKS 실측), 켜진 기기 한 번 묻기 70ms(블랙박스 5,284ms - 5,000ms 를 요청 4번으로 나눈 값)
    let fetch = |id: &str| {
        if id == "nOFF" {
            std::thread::sleep(Duration::from_millis(5000));
            return Err("off".to_string());
        }
        std::thread::sleep(Duration::from_millis(140));
        Ok(Got { log: String::new(), sessions: Some("[]".into()) })
    };
    let h = Hub::new();
    let p = paired();
    let t = Instant::now();
    let (_, go) = h.look(&p, Instant::now());
    let phone = t.elapsed();
    assert!(go);
    let t = Instant::now();
    h.refresh(&p, &fetch, &Instant::now);
    eprintln!("새 길 — 폰 요청 {phone:?}, 뒤에서 도는 한 바퀴 {:?}(옛 길은 이 바퀴를 폰이 기다렸다 — 차례로 5,280ms)", t.elapsed());
}
