//! 지구본(fn) 키로 말하기 — 앱이 앞에 있든 창이 닫혀 있든, fn 을 누르는 즉시
//! 마지막으로 누른 세션 창의 터미널에 스페이스를 계속 흘려 Claude Code 음성 입력(스페이스 길게 누르기)을 켠다.
//! 떼면 스페이스를 멈춘다 → Claude 가 녹음을 끝내고, 설정 voice.autoSubmit 이 켜져 있으면 바로 보낸다.
//! 누르는 순간 읽어 주던 음성은 멈춘다 — 안 그러면 스피커 소리가 같이 녹음된다(2026-09-29 사용자).
//! pty 에 바이트로 쓰는 스페이스는 Claude 입장에서 진짜 키 반복과 같다(keyrepeat.rs: 120ms 안쪽 5개면 누르고 있음).
//! 시스템 설정 "🌐 키를 누르면 → 아무것도 안 함" 이어야 macOS 받아쓰기·이모지 창과 안 겹친다

use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 이만큼 누르고 있어야 말하기로 본다 — 0 = 누르는 즉시(2026-09-29 사용자 "그냥 즉시로"). 처음엔 1초였다
pub const HOLD_MS: u64 = 0;
/// Claude 는 스페이스가 이만큼 이어져야 녹음을 켜고, 켤 때 앞서 들어간 스페이스를 지운다.
/// 그 전에 떼면(fn+화살표처럼 잠깐 누름) 스페이스가 입력칸에 남는다 → 보낸 만큼 지운다
pub const WARM: u32 = 5;
/// 스페이스 간격 — Claude 는 120ms 안쪽으로 이어져야 누르고 있다고 본다
pub const GAP_MS: u64 = 50;
/// 뗌을 놓쳐도(권한이 도중에 빠짐 등) 스페이스가 끝없이 흐르지 않게 — 이만큼 지나면 스스로 멈춘다
pub const MAX_MS: u64 = 120_000;

#[derive(Debug, PartialEq, Eq)]
pub enum Act {
    None,
    /// 말하기 시작 — 읽어 주기를 멈추고 첫 스페이스
    Start,
    Space,
    /// 뗐다 — 스페이스를 멈춘다(Claude 가 녹음을 끝낸다). 녹음이 켜지기 전이면 남은 스페이스 수(지울 것)
    Stop(u32),
}

/// 시각(ms)만 받는 순수한 판정 — 스레드·타이머 없이 시험한다
#[derive(Default)]
pub struct Ptt {
    down_at: Option<u64>,
    /// 누르는 중 다른 키가 와서 취소됨 — 뗄 때까지 다시 시작하지 않는다
    cancelled: bool,
    talking: bool,
    last_space: u64,
    sent: u32,
}

impl Ptt {
    pub fn key(&mut self, down: bool, now: u64) -> Act {
        if down {
            if self.down_at.is_none() {
                self.down_at = Some(now);
            }
            return Act::None;
        }
        self.down_at = None;
        self.cancelled = false;
        if self.talking {
            self.talking = false;
            return Act::Stop(self.leftover());
        }
        Act::None
    }

    /// 녹음이 켜지기 전에 멈췄으면 입력칸에 남은 스페이스 수
    fn leftover(&self) -> u32 {
        if self.sent < WARM { self.sent } else { 0 }
    }

    /// 누르는 중 다른 키가 눌렸다(fn+화살표·fn+E 등) — 녹음이 켜지기 전이면 말하려던 게 아니니 취소하고 보낸 스페이스를 지운다.
    /// 이미 녹음 중이면 그대로 둔다(말하다 다른 키를 건드린 것)
    pub fn other_key(&mut self) -> Act {
        if self.down_at.is_none() || self.cancelled || (self.talking && self.sent >= WARM) {
            return Act::None;
        }
        self.cancelled = true;
        if self.talking {
            self.talking = false;
            return Act::Stop(self.leftover());
        }
        Act::None
    }

    pub fn tick(&mut self, now: u64) -> Act {
        let Some(t) = self.down_at else { return Act::None };
        if self.cancelled {
            return Act::None;
        }
        if !self.talking {
            if now.saturating_sub(t) >= HOLD_MS {
                self.talking = true;
                self.last_space = now;
                self.sent = 1;
                return Act::Start;
            }
            return Act::None;
        }
        if now.saturating_sub(t) >= MAX_MS {
            self.down_at = None;
            self.talking = false;
            return Act::Stop(self.leftover());
        }
        if now.saturating_sub(self.last_space) >= GAP_MS {
            self.last_space = now;
            self.sent += 1;
            return Act::Space;
        }
        Act::None
    }

    #[cfg(test)]
    pub fn talking(&self) -> bool {
        self.talking
    }

    pub fn pressed(&self) -> bool {
        self.down_at.is_some()
    }
}

/// 말할 곳 = 마지막으로 클릭·입력한 세션 창의 pty (프론트가 ptt_target 으로 알린다)
static TARGET: Mutex<Option<u32>> = Mutex::new(None);
/// Some(눌림/뗌) = 말하기 키, None = 누르는 중 다른 키
static TX: Mutex<Option<Sender<Option<bool>>>> = Mutex::new(None);

#[tauri::command]
pub fn ptt_target(id: Option<u32>) {
    *TARGET.lock().unwrap_or_else(|e| e.into_inner()) = id;
}

/// 창이 닫혀 pty 가 없어지면 — 없는 곳에 쓰지 않게
pub fn forget(id: u32) {
    let mut t = TARGET.lock().unwrap_or_else(|e| e.into_inner());
    if *t == Some(id) {
        *t = None;
    }
}

/// 말하기가 끝난 창을 화면에 알린다 — 채팅 판이 받아 적은 글이 안 보내지고 남았는지 보고 대신 Enter 를 친다.
/// Claude 의 voice.autoSubmit 이 가끔 안 보냈다(참모가 일하는 중일 때 등, 2026-09-30 사용자)
static WATCH: Mutex<Option<tauri::ipc::Channel<u32>>> = Mutex::new(None);

#[tauri::command]
pub fn ptt_watch(on_stop: tauri::ipc::Channel<u32>) {
    *WATCH.lock().unwrap_or_else(|e| e.into_inner()) = Some(on_stop);
}

fn announce_stop(id: u32) {
    if let Some(ch) = WATCH.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        let _ = ch.send(id);
    }
}

fn target() -> Option<u32> {
    *TARGET.lock().unwrap_or_else(|e| e.into_inner())
}

/// 말하기 키 눌림·뗌 — 키 감시(keys_mac)가 부른다
pub fn fn_key(down: bool) {
    if let Some(tx) = TX.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        let _ = tx.send(Some(down));
    }
}

/// 다른 키가 눌렸다 — 말하기 키를 누르는 중이면 조합(fn+화살표 등)으로 보고 취소한다
pub fn other_key() {
    if let Some(tx) = TX.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        let _ = tx.send(None);
    }
}

/// 판정 스레드 — write 는 pty 에 쓰는 함수, hush 는 읽어 주기 멈춤
pub fn start(write: impl Fn(u32, &str) + Send + 'static, hush: impl Fn() + Send + 'static) {
    let (tx, rx) = channel::<Option<bool>>();
    *TX.lock().unwrap_or_else(|e| e.into_inner()) = Some(tx);
    std::thread::spawn(move || {
        let t0 = Instant::now();
        let ms = || t0.elapsed().as_millis() as u64;
        let mut p = Ptt::default();
        // 말하기를 시작한 창 — 누르는 사이 다른 창을 눌러도 처음 창에만 쓴다
        let mut to: Option<u32> = None;
        loop {
            // 누르고 있지 않을 땐 이벤트만 기다린다(쉬는 동안 CPU 0)
            let wait = if p.pressed() { 10 } else { 1000 };
            match rx.recv_timeout(Duration::from_millis(wait)) {
                Ok(msg) => {
                    let act = match msg { Some(down) => p.key(down, ms()), None => p.other_key() };
                    if let Act::Stop(n) = act {
                        let id = to.take();
                        erase(&write, id, n);
                        if let (Some(id), 0) = (id, n) {
                            announce_stop(id); // 녹음이 켜졌다 끝남 — 받아 적은 글이 곧 들어온다
                        }
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            match p.tick(ms()) {
                Act::Start => {
                    hush();
                    to = target();
                    if let Some(id) = to {
                        write(id, " ");
                    }
                }
                Act::Stop(n) => erase(&write, to.take(), n),
                Act::Space => {
                    if let Some(id) = to {
                        write(id, " ");
                    }
                }
                _ => {}
            }
        }
    });
}

fn erase(write: &impl Fn(u32, &str), to: Option<u32>, n: u32) {
    if let (Some(id), true) = (to, n > 0) {
        write(id, &"\x7f".repeat(n as usize));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 누르는_중에_다른_키면_취소하고_보낸_스페이스를_지운다() {
        // fn+화살표·fn+E 처럼 같이 누른 키 — 말하려던 게 아니다(0.2.0 검증 "지구본 키가 다른 조합과 겹친다")
        let mut p = Ptt::default();
        p.key(true, 0);
        assert_eq!(p.tick(0), Act::Start);
        assert_eq!(p.tick(60), Act::Space);
        assert_eq!(p.other_key(), Act::Stop(2));
        assert!(!p.talking());
        // 떼기 전까지는 계속 눌러도 다시 시작하지 않는다
        assert_eq!(p.tick(500), Act::None);
        assert_eq!(p.key(false, 600), Act::None);
        // 떼고 다시 누르면 다시 말하기
        p.key(true, 700);
        assert_eq!(p.tick(700), Act::Start);
    }

    #[test]
    fn 녹음이_켜진_뒤엔_다른_키가_와도_이어간다() {
        let mut p = Ptt::default();
        p.key(true, 0);
        p.tick(0);
        for t in (50..=400).step_by(50) { p.tick(t); }
        assert_eq!(p.other_key(), Act::None);
        assert!(p.talking());
    }

    #[test]
    fn 안_누를_땐_다른_키는_상관없다() {
        let mut p = Ptt::default();
        assert_eq!(p.other_key(), Act::None);
    }

    #[test]
    fn 누르는_즉시_시작한다() {
        let mut p = Ptt::default();
        assert_eq!(p.key(true, 0), Act::None);
        assert_eq!(p.tick(0), Act::Start);
        assert!(p.talking());
    }

    #[test]
    fn 누르는_동안_간격마다_스페이스() {
        let mut p = Ptt::default();
        p.key(true, 0);
        assert_eq!(p.tick(0), Act::Start);
        assert_eq!(p.tick(20), Act::None);
        assert_eq!(p.tick(50), Act::Space);
        assert_eq!(p.tick(99), Act::None);
        assert_eq!(p.tick(100), Act::Space);
    }

    #[test]
    fn 녹음이_켜지기_전에_떼면_남은_스페이스를_지운다() {
        let mut p = Ptt::default();
        p.key(true, 0);
        p.tick(0); // 1개
        p.tick(50); // 2개
        assert_eq!(p.key(false, 80), Act::Stop(2));
    }

    #[test]
    fn 녹음이_켜진_뒤_떼면_지울_게_없다() {
        let mut p = Ptt::default();
        p.key(true, 0);
        for t in (0..=1000).step_by(50) {
            p.tick(t);
        }
        assert_eq!(p.key(false, 1020), Act::Stop(0));
    }

    #[test]
    fn 떼고_다시_누르면_새로_센다() {
        let mut p = Ptt::default();
        p.key(true, 0);
        for t in (0..=1000).step_by(50) {
            p.tick(t);
        }
        p.key(false, 1020);
        assert_eq!(p.tick(1100), Act::None);
        p.key(true, 2000);
        assert_eq!(p.tick(2000), Act::Start);
        assert_eq!(p.key(false, 2010), Act::Stop(1));
    }

    #[test]
    fn 눌린_채로_또_눌림이_와도_시작_시각은_처음_것() {
        let mut p = Ptt::default();
        p.key(true, 0);
        for t in (0..=1000).step_by(50) {
            p.tick(t);
        }
        p.key(true, 800); // 다른 수식키가 바뀌어도 flagsChanged 가 또 온다
        assert_eq!(p.tick(MAX_MS), Act::Stop(0));
    }

    #[test]
    fn 뗌을_놓쳐도_이분_뒤엔_스스로_멈춘다() {
        let mut p = Ptt::default();
        p.key(true, 0);
        for t in (0..=1000).step_by(50) {
            p.tick(t);
        }
        assert_eq!(p.tick(MAX_MS - 1), Act::Space);
        assert_eq!(p.tick(MAX_MS), Act::Stop(0));
        assert_eq!(p.tick(MAX_MS + 100), Act::None);
    }

    #[test]
    fn 창이_닫히면_말할_곳을_잊는다() {
        ptt_target(Some(7));
        forget(8);
        assert_eq!(target(), Some(7));
        forget(7);
        assert_eq!(target(), None);
    }
}
