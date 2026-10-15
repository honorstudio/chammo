//! 폰에서 음성 모드 소리 틀기 (2026-10-11 사용자 — "폰 앱을 보고 있을 땐 소리가 폰에서, 안 보면 맥에서").
//!
//! 흐름: 폰이 앱 앞에 떠 있는 동안(음성 모드 켜짐) 1.5초마다 하트비트(/api/voice-beat)를 보낸다 — 보고 있음·오디오 준비됨(ready)·지난 소리의 시작/끝/실패.
//! 맥은 소리를 읽을 때(claude::run_speech) 최근 WATCH 안에 ready 하트비트가 있으면 wav 만 만들어 여기 offer 하고, 폰이 하트비트 답으로 받아 틀면(start) 끝(end)까지 기다린다.
//! 폰이 못 틀면(fail)·START_WAIT 안에 시작 안 하면·하트비트가 끊기면 같은 wav 를 맥에서 튼다 — 소리가 사라지는 일은 없게(iOS 홈 화면 앱은 사람이 한 번 누르기 전엔 못 튼다).
//! 시간은 now 로 받아 시험한다. 전역 상태는 맨 아래 얇은 겉옷뿐.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 하트비트가 이 안에 있으면 '폰을 보는 중' (하트비트 간격 1.5초의 5배쯤 — LTE 에서 한두 번 늦어도 안 흔들리게)
pub const WATCH: Duration = Duration::from_secs(8);
/// offer 한 뒤 폰이 시작했다고 안 알리면 맥으로
pub const START_WAIT: Duration = Duration::from_secs(6);
/// 폰이 끝났다고 안 알려도(화면이 잠겨 앱이 멈춤 등) 소리 길이 + 이만큼 뒤엔 다음 말로
pub const END_SLACK: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Pending,
    Started,
    Ended,
    Failed,
}

#[derive(Clone, Debug)]
struct Item {
    id: u64,
    path: PathBuf,
    dur: Duration,
    status: Status,
    offered: Instant,
    started: Option<Instant>,
    /// 말하는 참모 세션 짧은 id·소리 크기 곡선(25ms RMS 0~255) — 폰 입력칸 참모 단추가 그 프사로 바뀌고 소리대로 빛난다
    who: Option<String>,
    env: Option<Vec<u8>>,
}

/// 폰이 알리는 지난 소리 소식
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AckKind {
    Start,
    End,
    Fail,
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Ack {
    pub id: u64,
    pub kind: AckKind,
}

/// 폰 하트비트 한 번 — hidden = 폰이 화면을 떠났다(바로 맥으로)
#[derive(Clone, Copy, Debug)]
pub struct Beat {
    pub ready: bool,
    pub hidden: bool,
    pub ack: Option<Ack>,
}

/// 하트비트 답 — item = 폰이 가져가 틀 소리(id·길이 ms), cancel = 멈춤 번호(바뀌면 폰이 틀던 걸 멈춘다),
/// who·env = 그 소리의 주인(참모 세션 짧은 id)·소리 크기 곡선(item 이 있을 때만)
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Reply {
    pub item: Option<(u64, u64)>,
    pub cancel: u64,
    pub who: Option<String>,
    pub env: Option<Vec<u8>>,
}

/// 곡선 한 칸 길이(ms) — claude.rs HOP_MS 와 같은 값
pub const HOP_MS: u64 = 25;

/// 하트비트 답 JSON — { item: { id, ms, who, hop, env } | null, cancel }
pub fn reply_json(r: &Reply) -> serde_json::Value {
    let item = r.item.map(|(id, ms)| serde_json::json!({ "id": id, "ms": ms, "who": r.who, "hop": HOP_MS, "env": r.env }));
    serde_json::json!({ "item": item, "cancel": r.cancel })
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Poll {
    /// 아직 폰이 시작 안 했다
    Waiting,
    /// 폰이 틀고 있다(끝 소식을 기다리는 중)
    Playing,
    /// 폰이 다 틀었다(또는 끝을 안 알려도 시간이 지났다)
    Done,
    /// 폰이 못 튼다 → 맥에서
    Fallback(&'static str),
}

#[derive(Default)]
pub struct State {
    beat: Option<Instant>,
    ready: bool,
    item: Option<Item>,
    cancel: u64,
}

impl State {
    /// 폰이 보고 있고 오디오가 준비됐다 — 이때만 소리를 폰으로 돌린다
    pub fn watching(&self, now: Instant) -> bool {
        self.ready && self.beat.is_some_and(|b| now.saturating_duration_since(b) <= WATCH)
    }

    pub fn beat(&mut self, now: Instant, b: Beat) -> Reply {
        if b.hidden {
            self.beat = None;
            self.ready = false;
        } else {
            self.beat = Some(now);
            self.ready = b.ready;
        }
        if let (Some(a), Some(it)) = (b.ack, self.item.as_mut()) {
            if a.id == it.id {
                match (a.kind, it.status) {
                    (AckKind::Start, Status::Pending) => {
                        it.status = Status::Started;
                        it.started = Some(now);
                    }
                    (AckKind::End, Status::Pending | Status::Started) => it.status = Status::Ended,
                    (AckKind::Fail, Status::Pending | Status::Started) => it.status = Status::Failed,
                    _ => {}
                }
            }
        }
        // 이미 시작했거나 끝난 소리는 다시 안 준다 — 폰이 같은 소리를 두 번 틀지 않게
        let it = self.item.as_ref().filter(|i| i.status == Status::Pending && self.ready);
        Reply {
            item: it.map(|i| (i.id, i.dur.as_millis() as u64)),
            cancel: self.cancel,
            who: it.and_then(|i| i.who.clone()),
            env: it.and_then(|i| i.env.clone()),
        }
    }

    /// 소리 파일을 폰에 내놓는다 — 한 번에 하나(맥 음성은 차례로 읽는다)
    pub fn offer(&mut self, now: Instant, id: u64, path: PathBuf, dur: Duration) {
        self.offer_with(now, id, path, dur, None, None);
    }
    /// who = 말하는 참모 세션 짧은 id, env = 소리 크기 곡선 — 하트비트 답에 같이 실린다
    pub fn offer_with(&mut self, now: Instant, id: u64, path: PathBuf, dur: Duration, who: Option<String>, env: Option<Vec<u8>>) {
        self.item = Some(Item { id, path, dur, status: Status::Pending, offered: now, started: None, who, env });
    }

    pub fn poll(&mut self, now: Instant, id: u64) -> Poll {
        let Some(it) = self.item.as_ref().filter(|i| i.id == id) else { return Poll::Fallback("거둬짐") };
        match it.status {
            Status::Ended => Poll::Done,
            Status::Failed => Poll::Fallback("폰이 못 틀었어요"),
            Status::Started => {
                let since = now.saturating_duration_since(it.started.unwrap_or(it.offered));
                if since > it.dur + END_SLACK { Poll::Done } else { Poll::Playing }
            }
            Status::Pending => {
                if now.saturating_duration_since(it.offered) > START_WAIT {
                    Poll::Fallback("폰이 시작을 안 알렸어요")
                } else if !self.watching(now) {
                    Poll::Fallback("폰이 화면을 떠났어요")
                } else {
                    Poll::Waiting
                }
            }
        }
    }

    /// 내놓은 소리를 거둔다(맥으로 돌릴 때·끝났을 때)
    pub fn withdraw(&mut self, id: u64) {
        if self.item.as_ref().is_some_and(|i| i.id == id) {
            self.item = None;
        }
    }

    /// 음성 멈춤 — 폰이 틀던 것도 멈추게 번호를 올린다
    pub fn cancel(&mut self) {
        self.item = None;
        self.cancel += 1;
    }

    /// 폰이 가져갈 수 있는 소리 파일 — 지금 내놓은(아직 안 끝난) 그 id 만
    pub fn audio_path(&self, id: u64) -> Option<PathBuf> {
        self.item.as_ref().filter(|i| i.id == id && matches!(i.status, Status::Pending | Status::Started)).map(|i| i.path.clone())
    }
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    let mut g = STATE.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(State::default))
}

pub fn beat(b: Beat) -> Reply {
    with(|s| s.beat(Instant::now(), b))
}
pub fn watching_now() -> bool {
    with(|s| s.watching(Instant::now()))
}
pub fn offer(id: u64, path: PathBuf, dur: Duration, who: Option<String>, env: Option<Vec<u8>>) {
    with(|s| s.offer_with(Instant::now(), id, path, dur, who, env));
}
pub fn poll(id: u64) -> Poll {
    with(|s| s.poll(Instant::now(), id))
}
pub fn withdraw(id: u64) {
    with(|s| s.withdraw(id));
}
pub fn cancel() {
    with(State::cancel);
}
pub fn audio_path(id: u64) -> Option<PathBuf> {
    with(|s| s.audio_path(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(ready: bool) -> Beat {
        Beat { ready, hidden: false, ack: None }
    }
    fn ack(id: u64, kind: AckKind) -> Beat {
        Beat { ready: true, hidden: false, ack: Some(Ack { id, kind }) }
    }
    fn at(t0: Instant, s: u64) -> Instant {
        t0 + Duration::from_secs(s)
    }

    #[test]
    fn 하트비트가_없으면_폰을_안_보는_것() {
        let t0 = Instant::now();
        let s = State::default();
        assert!(!s.watching(t0));
    }

    #[test]
    fn 최근_ready_하트비트가_있을_때만_보는_중() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.beat(t0, b(true));
        assert!(s.watching(at(t0, 3)));
        assert!(s.watching(at(t0, 8)));
        assert!(!s.watching(at(t0, 9)), "WATCH 지남");
        s.beat(at(t0, 10), b(false));
        assert!(!s.watching(at(t0, 10)), "오디오가 안 깨어 있으면 맥");
    }

    #[test]
    fn 화면을_떠나면_바로_맥으로() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.beat(t0, b(true));
        s.beat(at(t0, 1), Beat { ready: true, hidden: true, ack: None });
        assert!(!s.watching(at(t0, 1)));
    }

    #[test]
    fn 하트비트_답에_누가_말하는지와_소리_곡선이_실린다() {
        // 폰 입력칸 참모 단추가 말하는 참모 프사로 바뀌고 소리 크기대로 빛나게(2026-10-12 사용자 "어떤 참모가 말하는지 구분이 안 가")
        let t0 = Instant::now();
        let mut s = State::default();
        s.beat(t0, b(true));
        s.offer_with(t0, 7, "/x/7.wav".into(), Duration::from_millis(75), Some("aaaa0001".into()), Some(vec![0, 128, 255]));
        let r = s.beat(at(t0, 1), b(true));
        assert_eq!(r.item, Some((7, 75)));
        let v = reply_json(&r);
        assert_eq!(v["item"]["who"], "aaaa0001");
        assert_eq!(v["item"]["hop"], 25);
        assert_eq!(v["item"]["env"], serde_json::json!([0, 128, 255]));
        assert_eq!((v["item"]["id"].as_u64(), v["item"]["ms"].as_u64(), v["cancel"].as_u64()), (Some(7), Some(75), Some(0)));
    }

    #[test]
    fn 누가_말하는지_모르면_who_는_null_곡선도_null() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.beat(t0, b(true));
        s.offer(t0, 7, "/x/7.wav".into(), Duration::from_secs(2));
        let v = reply_json(&s.beat(at(t0, 1), b(true)));
        assert!(v["item"]["who"].is_null() && v["item"]["env"].is_null());
        assert!(reply_json(&Reply { item: None, cancel: 3, who: None, env: None })["item"].is_null());
    }

    #[test]
    fn 내놓은_소리는_폰이_시작하기_전까지만_하트비트_답에_실린다() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.beat(t0, b(true));
        s.offer(t0, 7, "/x/7.wav".into(), Duration::from_millis(2500));
        assert_eq!(s.beat(at(t0, 1), b(true)).item, Some((7, 2500)));
        assert_eq!(s.beat(at(t0, 1), ack(7, AckKind::Start)).item, None, "시작했으면 다시 안 준다");
    }

    #[test]
    fn 폰이_시작하고_끝을_알리면_끝() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.beat(t0, b(true));
        s.offer(t0, 7, "/x/7.wav".into(), Duration::from_secs(2));
        assert_eq!(s.poll(at(t0, 1), 7), Poll::Waiting);
        s.beat(at(t0, 1), ack(7, AckKind::Start));
        assert_eq!(s.poll(at(t0, 2), 7), Poll::Playing);
        s.beat(at(t0, 3), ack(7, AckKind::End));
        assert_eq!(s.poll(at(t0, 3), 7), Poll::Done);
    }

    #[test]
    fn 폰이_못_틀면_맥으로() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.beat(t0, b(true));
        s.offer(t0, 7, "/x/7.wav".into(), Duration::from_secs(2));
        s.beat(at(t0, 1), ack(7, AckKind::Fail));
        assert!(matches!(s.poll(at(t0, 1), 7), Poll::Fallback(_)));
    }

    #[test]
    fn 폰이_시작을_안_알리면_6초_뒤_맥으로() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.beat(t0, b(true));
        s.offer(t0, 7, "/x/7.wav".into(), Duration::from_secs(2));
        s.beat(at(t0, 5), b(true));
        assert_eq!(s.poll(at(t0, 5), 7), Poll::Waiting);
        s.beat(at(t0, 6), b(true));
        s.beat(at(t0, 7), b(true));
        assert!(matches!(s.poll(at(t0, 7), 7), Poll::Fallback(_)));
    }

    #[test]
    fn 기다리는_중_폰이_화면을_떠나면_바로_맥으로() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.beat(t0, b(true));
        s.offer(t0, 7, "/x/7.wav".into(), Duration::from_secs(2));
        s.beat(at(t0, 1), Beat { ready: true, hidden: true, ack: None });
        assert!(matches!(s.poll(at(t0, 1), 7), Poll::Fallback(_)));
    }

    #[test]
    fn 끝을_안_알려도_소리_길이_뒤엔_다음_말로() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.beat(t0, b(true));
        s.offer(t0, 7, "/x/7.wav".into(), Duration::from_secs(2));
        s.beat(at(t0, 1), ack(7, AckKind::Start));
        assert_eq!(s.poll(at(t0, 7), 7), Poll::Playing);
        assert_eq!(s.poll(at(t0, 9), 7), Poll::Done);
    }

    #[test]
    fn 남의_id_소식은_무시() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.beat(t0, b(true));
        s.offer(t0, 7, "/x/7.wav".into(), Duration::from_secs(2));
        s.beat(at(t0, 1), ack(6, AckKind::Start));
        assert_eq!(s.poll(at(t0, 1), 7), Poll::Waiting);
        assert_eq!(s.beat(at(t0, 1), b(true)).item, Some((7, 2000)), "7 은 아직 안 시작");
    }

    #[test]
    fn 음성을_멈추면_번호가_오르고_소리는_거둔다() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.beat(t0, b(true));
        s.offer(t0, 7, "/x/7.wav".into(), Duration::from_secs(2));
        let before = s.beat(at(t0, 1), b(true)).cancel;
        s.cancel();
        let r = s.beat(at(t0, 2), b(true));
        assert_eq!((r.item, r.cancel), (None, before + 1));
        assert!(s.audio_path(7).is_none());
    }

    #[test]
    fn 소리_파일은_내놓은_그_id_만_폰이_가져간다() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.offer(t0, 7, "/x/7.wav".into(), Duration::from_secs(2));
        assert_eq!(s.audio_path(7), Some(PathBuf::from("/x/7.wav")));
        assert_eq!(s.audio_path(8), None);
        s.beat(t0, ack(7, AckKind::End));
        assert_eq!(s.audio_path(7), None, "끝난 소리는 안 준다");
    }

    #[test]
    fn 오디오가_안_깨어_있으면_소리를_안_준다() {
        let t0 = Instant::now();
        let mut s = State::default();
        s.offer(t0, 7, "/x/7.wav".into(), Duration::from_secs(2));
        assert_eq!(s.beat(t0, b(false)).item, None);
    }
}
