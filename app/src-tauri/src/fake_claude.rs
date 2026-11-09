//! 시험용 가짜 Claude 입력칸 — 그림 경로 붙여넣기를 읽는 동안의 2.1.318 실측 모양을 흉내 낸다(2026-11-05 send-stuck).
//! 붙여넣은 뒤 `frozen` 동안은 화면이 안 바뀌고 받은 키는 쌓였다가 한꺼번에 들어가며, `Pasting…` 이 보이는 동안 들어온 Enter 는 버린다
//! (defer 면 버리지 않고 붙여넣기가 끝날 때 보낸다 — 실측에서 4번 중 2번은 이쪽이었다). 끝나면 칩이 글 뒤에 붙는다.
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub struct Fake {
    pub screen: Arc<Mutex<vt100::Parser>>,
    st: Arc<Mutex<St>>,
    /// 가짜 칸은 하나씩 — 붙여넣기 시계가 만들 때 도는데 앞 시험이 입력 차례(typing_turn)를 쥐고 있으면 읽기가 다 끝난 뒤에 쳐서 칩이 글 앞에 붙었다(전체 실행에서 가끔)
    _one_at_a_time: std::sync::MutexGuard<'static, ()>,
}

static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

struct St {
    input: String,
    pending: Vec<u8>,
    paste_start: Option<Instant>,
    frozen: Duration,
    pasting: Duration,
    defer: bool,
    deferred: bool,
    sent: Vec<String>,
    enters: usize,
}

/// 시각을 흘려 화면을 다시 그린다
fn tick(st: &Arc<Mutex<St>>, screen: &Arc<Mutex<vt100::Parser>>) {
    let mut s = st.lock().unwrap();
    let age = s.paste_start.map(|t| t.elapsed());
    if age.is_some_and(|a| a < s.frozen) {
        return; // 멈춤 — 화면도 안 바뀐다
    }
    let pasting = age.is_some_and(|a| a < s.pasting);
    let keys = std::mem::take(&mut s.pending);
    for k in String::from_utf8_lossy(&keys).chars() {
        if k == '\r' {
            s.enters += 1;
            if pasting {
                s.deferred |= s.defer; // 버리거나(실측 2/4) 끝날 때 보낸다
            } else {
                let t = std::mem::take(&mut s.input);
                if !t.trim().is_empty() {
                    s.sent.push(t);
                }
            }
        } else {
            s.input.push(k);
        }
    }
    if age.is_some_and(|a| a >= s.pasting) {
        s.paste_start = None;
        s.input.push_str("[Image #1] [Image #2]");
        if std::mem::take(&mut s.deferred) {
            let t = std::mem::take(&mut s.input);
            s.sent.push(t);
        }
    }
    let foot = if pasting { "  Pasting…" } else { "  main · Opus" };
    let text = format!("\x1b[2J\x1b[H⏺ 앞 답\r\n\r\n{}\r\n❯ {}\r\n{}\r\n{foot}", "─".repeat(60), s.input, "─".repeat(60));
    screen.lock().unwrap().process(text.as_bytes());
}

impl Fake {
    /// paste 가 Some((멈춤, 읽는 시간)) 이면 지금 막 그림을 붙여넣은 칸
    pub fn new(paste: Option<(Duration, Duration)>, defer: bool) -> Fake {
        let st = St { input: String::new(), pending: Vec::new(), paste_start: None, frozen: paste.map_or(Duration::ZERO, |p| p.0), pasting: paste.map_or(Duration::ZERO, |p| p.1), defer, deferred: false, sent: Vec::new(), enters: 0 };
        let turn = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
        let f = Fake { screen: Arc::new(Mutex::new(vt100::Parser::new(12, 60, 0))), st: Arc::new(Mutex::new(st)), _one_at_a_time: turn };
        f.tick(); // 붙여넣기 앞 화면 — 멈춘 동안엔 이 화면 그대로
        f.st.lock().unwrap().paste_start = paste.map(|_| Instant::now());
        f
    }

    /// 시각을 흘려 화면을 다시 그린다 — 쓰는 쪽이 화면을 보기 전에 부르게 render 스레드로
    pub fn tick(&self) {
        tick(&self.st, &self.screen);
    }

    /// 앱이 쓰는 쪽 — 받은 키는 다음 tick 에 들어간다. 5ms 마다 tick 하는 스레드도 같이 돈다
    pub fn writer(&self) -> Arc<Mutex<Box<dyn std::io::Write + Send>>> {
        struct W(Arc<Mutex<St>>);
        impl std::io::Write for W {
            fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().pending.extend_from_slice(b);
                Ok(b.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let (st, screen) = (self.st.clone(), self.screen.clone());
        std::thread::spawn(move || {
            while Arc::strong_count(&st) > 1 {
                tick(&st, &screen);
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        Arc::new(Mutex::new(Box::new(W(self.st.clone()))))
    }

    /// 보내진 말들 · 받은 Enter 수
    pub fn sent(&self) -> (Vec<String>, usize) {
        let t = Instant::now(); // 그림 읽기가 끝난 뒤의 결과로(미뤘다 보내는 말은 그때 간다)
        while self.st.lock().unwrap().paste_start.is_some() && t.elapsed() < Duration::from_secs(5) {
            self.tick();
            std::thread::sleep(Duration::from_millis(10));
        }
        std::thread::sleep(Duration::from_millis(30));
        self.tick();
        let s = self.st.lock().unwrap();
        (s.sent.clone(), s.enters)
    }
}
