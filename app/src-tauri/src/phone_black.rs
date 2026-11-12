//! 폰 요청 블랙박스·일꾼 칸 — 맥이 무거울 때 폰이 '대화를 못 받아 왔어요'를 띄워도 맥 기록(notify.log)엔 허브 끊김만 남아 원인을 못 봤다(11-07 사용자).
//! 실패·503·느림(2초 넘음)만 모아 30초에 한 줄로 남긴다 — 줄이 폭주하지 않게, 경로는 물음표 앞까지만(파일 경로를 안 남긴다).
//! 일꾼은 길 둘로 나눈다 — 가벼운 길(상태 받기) 여덟, 무거운 길(파일·보관함·다른 컴퓨터 기다리기) 다섯. 정한 수를 넘으면 바로 503 이 아니라 차례를 기다린다:
//! 폰은 깨어날 때 열댓 개를 한꺼번에 불러서, 바로 503 을 주면 /api/usage·shows·load 같은 가벼운 요청까지 실패로 돌아갔다(11-07 기록 15:47·17:11).
use std::collections::BTreeMap;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

/// 가벼운 길이 같이 도는 수
pub const MAX_WORKERS: usize = 8;
/// 무거운 길이 같이 도는 수 — 칸이 따로라 파일이 몰려도 상태 받기 자리는 그대로다
pub const MAX_HEAVY: usize = 5;
/// 길마다 차례를 기다릴 수 있는 수 — 넘으면 503(폰이 다시 받는다)
pub const MAX_WAIT: usize = 32;
/// 차례를 기다리는 최대 — 폰이 포기하기(20초) 전에 돌려준다. 포기한 요청이 뒤늦게 돌지 않게
pub const WAIT_MAX: Duration = Duration::from_secs(15);
pub const SLOW_MS: u64 = 2000;
const EVERY: Duration = Duration::from_secs(30);

/// 경로만 — 물음표 뒤(파일 경로·since 표)는 남기지 않는다. 숫자·긴 번호는 뭉갠다
pub fn route(path: &str) -> String {
    let p = path.split('?').next().unwrap_or("");
    p.split('/').map(|s| if s.len() > 20 || (!s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())) { ":id" } else { s }).collect::<Vec<_>>().join("/")
}

/// 무거운 길인가 — 디스크를 훑거나 큰 몸을 나르거나 다른 컴퓨터 답을 기다리는 것(/api/peer-cards 5.3초, 11-07). 모르는 길은 가벼운 쪽으로 친다
pub fn heavy(path: &str) -> bool {
    let p = path.split('?').next().unwrap_or("");
    const HEAVY: &[&str] = &["/api/file", "/api/attach", "/api/team-locker", "/api/team-file", "/api/team-media", "/api/team-dl", "/api/locker", "/api/peer-", "/api/dl", "/api/media", "/api/html", "/api/browser-frame"];
    HEAVY.iter().any(|h| p.starts_with(h))
}

/// 길 하나 — 정한 수만 돌고 나머지는 일꾼 스레드에서 차례를 기다린다
pub struct Lane {
    run: usize,
    state: Mutex<(usize, usize)>, // (도는 수, 기다리는 수 포함 전체)
    freed: Condvar,
}

/// 차례 — 놓이면(패닉해도) 칸이 돌아온다. 안 돌아오면 다시 붙을 때까지 그 칸이 영영 찬다
pub struct Turn<'a>(&'a Lane);

impl Drop for Turn<'_> {
    fn drop(&mut self) {
        let mut g = self.0.state.lock().unwrap_or_else(|e| e.into_inner());
        g.0 -= 1;
        g.1 -= 1;
        self.0.freed.notify_one();
    }
}

impl Lane {
    fn new(run: usize) -> Self {
        Lane { run, state: Mutex::new((0, 0)), freed: Condvar::new() }
    }

    /// 줄에 설 수 있나 — 받는 스레드(소켓)에서. false 면 503
    pub fn join(&self) -> bool {
        let mut g = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if g.1 >= self.run + MAX_WAIT {
            return false;
        }
        g.1 += 1;
        true
    }

    /// 차례가 올 때까지 — 일꾼 스레드에서. max 안에 안 오면 줄에서 빠지고 None(503)
    pub fn wait_turn(&self, max: Duration) -> Option<Turn<'_>> {
        let g = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let (mut g, waited) = self.freed.wait_timeout_while(g, max, |s| s.0 >= self.run).unwrap_or_else(|e| e.into_inner());
        if waited.timed_out() {
            g.1 -= 1;
            return None;
        }
        g.0 += 1;
        Some(Turn(self))
    }

    fn now(&self) -> (usize, usize) {
        *self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// 지금 도는 수·기다리는 수
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Counts {
    pub light: usize,
    pub heavy: usize,
    pub waiting: usize,
}

/// 가벼운 길·무거운 길 — 칸을 따로 세서 무거운 길이 가벼운 길 몫을 못 먹는다
pub struct Lanes {
    light: Lane,
    heavy: Lane,
}

impl Default for Lanes {
    fn default() -> Self {
        Lanes { light: Lane::new(MAX_WORKERS), heavy: Lane::new(MAX_HEAVY) }
    }
}

impl Lanes {
    pub fn of(&self, path: &str) -> &Lane {
        if heavy(path) { &self.heavy } else { &self.light }
    }

    pub fn counts(&self) -> Counts {
        let ((l, lt), (h, ht)) = (self.light.now(), self.heavy.now());
        Counts { light: l, heavy: h, waiting: lt - l + ht - h }
    }
}

#[derive(Default)]
struct Row {
    n: u32,
    max_ms: u64,
    status: u16,
}

#[derive(Default)]
pub struct Black {
    slow: BTreeMap<String, Row>,
    full: BTreeMap<String, u32>,
    peak: Counts,
    last: Option<Instant>,
}

impl Black {
    /// 끝난 요청 — 실패(5xx)나 느린 것만 모은다
    pub fn done(&mut self, route: String, status: u16, ms: u64) {
        if status < 500 && ms < SLOW_MS {
            return;
        }
        let r = self.slow.entry(route).or_default();
        r.n += 1;
        r.max_ms = r.max_ms.max(ms);
        if status >= 500 {
            r.status = status;
        }
    }

    /// 줄이 넘치거나 오래 기다려 503 으로 돌려보낸 요청
    pub fn refused(&mut self, route: String) {
        *self.full.entry(route).or_default() += 1;
    }

    pub fn saw(&mut self, c: Counts) {
        self.peak = Counts { light: self.peak.light.max(c.light), heavy: self.peak.heavy.max(c.heavy), waiting: self.peak.waiting.max(c.waiting) };
    }

    /// 모인 게 있고 지난 줄에서 30초가 지났으면 한 줄 — 없으면 None. 첫 일은 바로 남긴다(끊기기 전 마지막 소식일 수 있다)
    pub fn take_line(&mut self, now: Instant) -> Option<String> {
        if self.slow.is_empty() && self.full.is_empty() {
            return None;
        }
        if self.last.is_some_and(|t| now.saturating_duration_since(t) < EVERY) {
            return None;
        }
        self.last = Some(now);
        let mut parts: Vec<String> = std::mem::take(&mut self.slow)
            .into_iter()
            .map(|(p, r)| {
                let st = if r.status > 0 { format!(" {}", r.status) } else { String::new() };
                format!("{p}{st} ×{} 최대 {}ms", r.n, r.max_ms)
            })
            .collect();
        let full = std::mem::take(&mut self.full);
        if !full.is_empty() {
            let total: u32 = full.values().sum();
            let by: Vec<String> = full.into_iter().map(|(p, n)| format!("{p} ×{n}")).collect();
            parts.push(format!("일꾼 꽉 참 503 ×{total}({})", by.join(", ")));
        }
        let p = std::mem::take(&mut self.peak);
        Some(format!("폰 요청 — {} · 일꾼 최대 가벼운 {}/{MAX_WORKERS}·무거운 {}/{MAX_HEAVY}·줄 {}", parts.join("; "), p.light, p.heavy, p.waiting))
    }
}

static BLACK: Mutex<Option<Black>> = Mutex::new(None);

/// 전역 기록에 넣고, 낼 때가 됐으면 notify.log 에 한 줄
pub fn with(f: impl FnOnce(&mut Black)) {
    let line = {
        let mut g = BLACK.lock().unwrap_or_else(|e| e.into_inner());
        let b = g.get_or_insert_with(Black::default);
        f(b);
        b.take_line(Instant::now())
    };
    if let Some(l) = line {
        crate::claude::log_out("phone-relay", &l);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 경로는_물음표_앞까지만_번호는_뭉갠다() {
        assert_eq!(route("/api/file?path=/Users/me/비밀.pdf"), "/api/file");
        assert_eq!(route("/api/sessions?since=abc"), "/api/sessions");
        assert_eq!(route("/api/team/12345/x"), "/api/team/:id/x");
        assert_eq!(route("/api/team/0123456789abcdef0123456789/x"), "/api/team/:id/x");
    }

    #[test]
    fn 무거운_길을_가른다() {
        assert!(heavy("/api/file?path=x"));
        assert!(heavy("/api/team-locker-put"));
        assert!(heavy("/api/team-dl"), "팀 파일 받기 — 맥이 목록을 받을 수 있다(11-12)");
        assert!(heavy("/api/peer-cards"), "다른 컴퓨터 답을 기다리는 길 — 5.3초를 가벼운 칸에서 쥐고 있었다");
        assert!(heavy("/api/peer-get?dev=a"));
        assert!(!heavy("/api/sessions?since=a"));
        assert!(!heavy("/api/env"));
        assert!(!heavy("/api/tails"));
        assert!(!heavy("/index.html"), "화면 껍데기는 첫 화면 몫 — 바로 돈다");
    }

    /// n 개가 한꺼번에 와도 다 끝나나, 같이 돈 수의 최대
    fn storm(lanes: &std::sync::Arc<Lanes>, path: &'static str, n: usize) -> usize {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        let (now, peak, done) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
        let mut hs = vec![];
        for _ in 0..n {
            assert!(lanes.of(path).join(), "{path}: 줄에 선다 — 몰려도 503 이 아니다");
            let (lanes, now, peak, done) = (lanes.clone(), now.clone(), peak.clone(), done.clone());
            hs.push(std::thread::spawn(move || {
                let _turn = lanes.of(path).wait_turn(WAIT_MAX).expect("차례가 온다");
                let c = now.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(c, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(10));
                now.fetch_sub(1, Ordering::SeqCst);
                done.fetch_add(1, Ordering::SeqCst);
            }));
        }
        for h in hs {
            h.join().unwrap();
        }
        assert_eq!(done.load(Ordering::SeqCst), n, "다 끝난다");
        peak.load(Ordering::SeqCst)
    }

    #[test]
    fn 폰이_깨어나_가벼운_요청이_몰려도_503_없이_여덟씩_돈다() {
        // 11-07 15:47·17:11 — 열댓 개가 한꺼번에 와 /api/usage·shows·load 가 503 으로 돌아갔다
        let lanes = std::sync::Arc::new(Lanes::default());
        assert!(storm(&lanes, "/api/usage", 20) <= MAX_WORKERS);
    }

    #[test]
    fn 무거운_길은_다섯_개씩만_돌고_나머지는_503_없이_차례를_기다린다() {
        let lanes = std::sync::Arc::new(Lanes::default());
        assert!(storm(&lanes, "/api/file", 20) <= MAX_HEAVY);
    }

    #[test]
    fn 무거운_길이_꽉_차도_가벼운_칸은_여덟_그대로다() {
        let lanes = Lanes::default();
        let mut held = vec![];
        for _ in 0..MAX_HEAVY {
            assert!(lanes.of("/api/file").join());
            held.push(lanes.of("/api/file").wait_turn(WAIT_MAX).unwrap());
        }
        for _ in 0..MAX_WORKERS {
            assert!(lanes.of("/api/env").join());
            held.push(lanes.of("/api/env").wait_turn(Duration::from_millis(10)).expect("무거운 길이 찼어도 바로 돈다"));
        }
        assert_eq!(lanes.counts(), Counts { light: MAX_WORKERS, heavy: MAX_HEAVY, waiting: 0 });
    }

    #[test]
    fn 줄이_너무_길면_503() {
        let lanes = Lanes::default();
        let lane = lanes.of("/api/file");
        for _ in 0..(MAX_HEAVY + MAX_WAIT) {
            assert!(lane.join());
        }
        assert!(!lane.join());
        drop(lane.wait_turn(WAIT_MAX));
        assert!(lane.join(), "하나 끝나면 다시 선다");
    }

    #[test]
    fn 차례가_너무_늦으면_줄에서_빠져_503_이고_자리는_돌아온다() {
        let lanes = Lanes::default();
        let lane = lanes.of("/api/env");
        let mut held = vec![];
        for _ in 0..MAX_WORKERS {
            assert!(lane.join());
            held.push(lane.wait_turn(WAIT_MAX).unwrap());
        }
        assert!(lane.join());
        assert_eq!(lanes.counts().waiting, 1);
        assert!(lane.wait_turn(Duration::from_millis(10)).is_none(), "칸이 안 비면 포기");
        assert_eq!(lanes.counts(), Counts { light: MAX_WORKERS, heavy: 0, waiting: 0 }, "줄에서 빠졌다");
        drop(held);
        assert_eq!(lanes.counts(), Counts::default());
    }

    #[test]
    fn 돌다_패닉해도_칸이_돌아온다() {
        let lanes = std::sync::Arc::new(Lanes::default());
        let l2 = lanes.clone();
        let r = std::thread::spawn(move || {
            assert!(l2.of("/api/env").join());
            let _turn = l2.of("/api/env").wait_turn(WAIT_MAX).unwrap();
            panic!("처리 중 터짐");
        })
        .join();
        assert!(r.is_err());
        assert_eq!(lanes.counts(), Counts::default());
    }

    #[test]
    fn 빠르고_성공한_요청은_안_남는다() {
        let mut b = Black::default();
        b.done("/api/env".into(), 200, 300);
        b.done("/api/x".into(), 404, 100);
        assert_eq!(b.take_line(Instant::now()), None);
    }

    #[test]
    fn 느림_실패_꽉참을_한_줄로_묶고_30초에_한_번만() {
        let mut b = Black::default();
        let t0 = Instant::now();
        b.saw(Counts { light: 8, heavy: 1, waiting: 0 });
        b.saw(Counts { light: 3, heavy: 2, waiting: 7 });
        b.done("/api/sessions".into(), 200, 5200);
        b.done("/api/sessions".into(), 200, 3100);
        b.done("/api/file".into(), 502, 100);
        b.refused("/api/thumb".into());
        b.refused("/api/thumb".into());
        b.refused("/api/env".into());
        let l = b.take_line(t0).unwrap();
        assert!(l.contains("/api/sessions ×2 최대 5200ms"), "{l}");
        assert!(l.contains("/api/file 502 ×1"), "{l}");
        assert!(l.contains("일꾼 꽉 참 503 ×3(/api/env ×1, /api/thumb ×2)"), "{l}");
        assert!(l.contains("일꾼 최대 가벼운 8/8·무거운 2/5·줄 7"), "길마다 따로 — 합을 8 로 나눠 9/8 이 찍혔다: {l}");
        b.done("/api/sessions".into(), 200, 9000);
        assert_eq!(b.take_line(t0 + Duration::from_secs(10)), None, "30초 안엔 안 낸다 — 폭주 금지");
        let l2 = b.take_line(t0 + Duration::from_secs(31)).unwrap();
        assert!(l2.contains("/api/sessions ×1 최대 9000ms"), "모아 둔 걸 다음 줄에: {l2}");
        assert_eq!(b.take_line(t0 + Duration::from_secs(70)), None, "새 일이 없으면 줄도 없다");
    }
}
