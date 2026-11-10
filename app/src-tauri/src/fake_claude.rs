//! 시험용 가짜 Claude 입력칸 — 그림 경로 붙여넣기를 읽는 동안의 2.1.318 실측 모양을 흉내 낸다(2026-11-05 send-stuck).
//! 그림 읽기는 앱이 첫 키를 넣는 순간 시작한다(만들 때가 아니라). 붙여넣은 뒤 `frozen` 동안은 화면이 안 바뀌고 받은 키는 쌓였다가 한꺼번에 들어가며, `Pasting…` 이 보이는 동안 들어온 Enter 는 버린다
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
    /// 앞 Enter 몇 개를 버린다 — 바쁜 TUI 가 Enter 를 놓친 흉내(2026-11-09 chat-send-stuck)
    swallow: usize,
    /// 보낸 말을 대화 기록처럼 한 줄씩(type user) 적는 파일
    jsonl: Option<std::path::PathBuf>,
    /// 화면 사본이 입력칸 글을 못 본다(엉킨·늦은 사본 — 사용자 참모 업데이트 저녁 내내 seen=false)
    blind: bool,
    /// 그림 읽기가 걸린 칸 — 첫 키가 들어오는 순간 시계를 건다(paste_start). 만들 때 걸면 병렬 시험에서 스레드가 늦을 때
    /// 키보다 읽기가 먼저 끝나 칩이 글 앞에 붙었다(11-05·11-10 흔들림 — 같은 판 세 번 중 한 번)
    armed: bool,
}

/// 보낸 말을 기록 파일에 한 줄 — 진짜 기록과 같은 모양(type user · message.content 글)
fn record(path: &Option<std::path::PathBuf>, text: &str) {
    use std::io::Write;
    if let Some(p) = path {
        let line = serde_json::json!({"type": "user", "message": {"role": "user", "content": text}});
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p).unwrap();
        writeln!(f, "{line}").unwrap();
    }
}

/// 시각을 흘려 화면을 다시 그린다
fn tick(st: &Arc<Mutex<St>>, screen: &Arc<Mutex<vt100::Parser>>) {
    let mut s = st.lock().unwrap();
    let age = s.paste_start.map(|t| t.elapsed());
    if age.is_some_and(|a| a < s.frozen) {
        return; // 멈춤 — 화면도 안 바뀐다
    }
    let pasting = age.is_some_and(|a| a < s.pasting);
    // 포커스 들어옴·나감(ESC[I·ESC[O)은 글이 아니다 — 진짜 Claude 도 신호로 받고 입력칸엔 안 넣는다(pty::FOCUS_OUT)
    let keys = String::from_utf8_lossy(&std::mem::take(&mut s.pending)).replace("\x1b[O", "").replace("\x1b[I", "").into_bytes();
    for k in String::from_utf8_lossy(&keys).chars() {
        if k == '\x7f' {
            s.input.pop();
        } else if k == '\r' {
            s.enters += 1;
            if s.swallow > 0 {
                s.swallow -= 1;
            } else if pasting {
                s.deferred |= s.defer; // 버리거나(실측 2/4) 끝날 때 보낸다
            } else {
                let t = std::mem::take(&mut s.input);
                if !t.trim().is_empty() {
                    record(&s.jsonl, &t);
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
            record(&s.jsonl, &t);
            s.sent.push(t);
        }
    }
    let foot = if pasting { "  Pasting…" } else { "  main · Opus" };
    let shown = if s.blind { "" } else { s.input.as_str() };
    let text = format!("\x1b[2J\x1b[H⏺ 앞 답\r\n\r\n{}\r\n❯ {}\r\n{}\r\n{foot}", "─".repeat(60), shown, "─".repeat(60));
    screen.lock().unwrap().process(text.as_bytes());
}

impl Fake {
    /// paste 가 Some((멈춤, 읽는 시간)) 이면 지금 막 그림을 붙여넣은 칸
    pub fn new(paste: Option<(Duration, Duration)>, defer: bool) -> Fake {
        let st = St { input: String::new(), pending: Vec::new(), paste_start: None, frozen: paste.map_or(Duration::ZERO, |p| p.0), pasting: paste.map_or(Duration::ZERO, |p| p.1), defer, deferred: false, sent: Vec::new(), enters: 0, swallow: 0, jsonl: None, blind: false, armed: paste.is_some() };
        let turn = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
        let f = Fake { screen: Arc::new(Mutex::new(vt100::Parser::new(12, 60, 0))), st: Arc::new(Mutex::new(st)), _one_at_a_time: turn };
        f.tick(); // 붙여넣기 앞 화면 — 멈춘 동안엔 이 화면 그대로
        f
    }

    /// 보낸 말을 이 파일에 기록처럼 적는다
    pub fn with_jsonl(self, p: &std::path::Path) -> Fake {
        self.st.lock().unwrap().jsonl = Some(p.to_path_buf());
        self
    }

    /// 앞 Enter n 개를 버린다
    pub fn swallow_enters(self, n: usize) -> Fake {
        self.st.lock().unwrap().swallow = n;
        self
    }

    /// 화면 사본이 입력칸 글을 못 본다
    pub fn blind(self) -> Fake {
        self.st.lock().unwrap().blind = true;
        self.tick();
        self
    }

    /// 입력칸에 글이 남아 있는 칸(앞서 Enter 가 안 먹은 말)
    pub fn with_input(self, t: &str) -> Fake {
        self.st.lock().unwrap().input = t.to_string();
        self.tick();
        self
    }

    /// 지금 입력칸 글(화면이 아니라 진짜 칸)
    pub fn input(&self) -> String {
        self.st.lock().unwrap().input.clone()
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
                let mut s = self.0.lock().unwrap();
                if std::mem::take(&mut s.armed) {
                    s.paste_start = Some(Instant::now()); // 첫 키 = 그림 읽기 시작(시각이 아니라 신호)
                }
                s.pending.extend_from_slice(b);
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

/// 진짜 세션 E2E 용 — 클립보드에 '나중에 줄게' 그림(public.png)을 올리고, 달라는 요청이 오면 `hang` 동안 답하지 않다가 답 없이 끝나는 앱.
/// 2026-11-10 폰 보내기가 쉬는 세션에서 한 시간 넘게 멈춘 모양(Claude Code 가 포커스 들어옴 1초 뒤 클립보드를 동기로 봄 — pty::FOCUS_OUT).
/// 답 없이 끝나야 Claude 가 '그림 있음'으로 안 보고 30초 쉬기(clipboard-image-hint)를 안 걸어 다음 경우도 같은 조건이다.
/// 사용자 클립보드 그림·글은 저장했다가 끝날 때 되돌린다(맥 전용, swiftc 필요 — #[ignore] 시험만 쓴다)
pub struct LazyClip {
    child: std::process::Child,
    dir: std::path::PathBuf,
    pub asked: std::path::PathBuf,
}

impl LazyClip {
    pub fn hang(secs: u32) -> LazyClip {
        use crate::platform::command;
        let dir = std::env::temp_dir().join(format!("lazyclip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("lazyclip");
        if !bin.exists() {
            let src = dir.join("lazyclip.swift");
            std::fs::write(&src, LAZY_SWIFT).unwrap();
            assert!(command("swiftc").args(["-O", "-o"]).arg(&bin).arg(&src).status().unwrap().success(), "swiftc");
        }
        // 사용자 클립보드 — 그림이면 PNG, 아니면 글
        let saved = dir.join("saved.png");
        let _ = std::fs::remove_file(&saved);
        let _ = command("osascript")
            .args(["-e", &format!("set f to open for access POSIX file \"{}\" with write permission", saved.display()), "-e", "write (the clipboard as «class PNGf») to f", "-e", "close access f"])
            .output();
        let text = command("pbpaste").output().map(|o| o.stdout).unwrap_or_default();
        std::fs::write(dir.join("saved.txt"), text).unwrap();
        let asked = dir.join("asked.log");
        let _ = std::fs::remove_file(&asked);
        let child = command(&bin).arg(secs.to_string()).stderr(std::fs::File::create(&asked).unwrap()).spawn().unwrap();
        std::thread::sleep(Duration::from_millis(600)); // 클립보드에 올라갈 때까지
        LazyClip { child, dir, asked }
    }

    /// Claude 가 그림을 달라고 했나(주인에게 요청이 왔나)
    pub fn was_asked(&self) -> bool {
        std::fs::read_to_string(&self.asked).unwrap_or_default().contains("asked")
    }
}

impl Drop for LazyClip {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let png = self.dir.join("saved.png");
        if std::fs::metadata(&png).is_ok_and(|m| m.len() > 0) {
            let _ = crate::platform::command("osascript").args(["-e", &format!("set the clipboard to (read (POSIX file \"{}\") as «class PNGf»)", png.display())]).output();
        } else if let Ok(t) = std::fs::read(self.dir.join("saved.txt")) {
            use std::io::Write;
            if let Ok(mut c) = crate::platform::command("pbcopy").stdin(std::process::Stdio::piped()).spawn() {
                let _ = c.stdin.take().map(|mut s| s.write_all(&t));
                let _ = c.wait();
            }
        }
    }
}

const LAZY_SWIFT: &str = r#"import AppKit
let hang = UInt32(CommandLine.arguments[1]) ?? 10
class P: NSObject, NSPasteboardItemDataProvider {
    func pasteboard(_ pb: NSPasteboard?, item: NSPasteboardItem, provideDataForType type: NSPasteboard.PasteboardType) {
        FileHandle.standardError.write("asked\n".data(using: .utf8)!)
        sleep(hang)
        exit(0)
    }
    func pasteboardFinishedWithDataProvider(_ pasteboard: NSPasteboard) {}
}
let pb = NSPasteboard.general
pb.clearContents()
let item = NSPasteboardItem(); let p = P()
item.setDataProvider(p, forTypes: [.png])
pb.writeObjects([item])
RunLoop.main.run(until: Date().addingTimeInterval(Double(hang) + 60))
"#;
