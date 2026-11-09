//! 웹 화면 지킴이 — 창이 하얗게 굳어도 사람이 앱을 다시 켜지 않게. notify.log 'web-dead'·'web-back' 한 줄씩.
//! 2026-11-06 21:09 메인 창이 통째로 하얘졌다: WebKit 이 응답 없는 GPU 프로세스를 끄려 했지만 신호가 막혀(Could not signal service: Operation not permitted,
//! 30초 뒤 또 실패) 프로세스가 안 죽었고, 새 GPU 도 안 떠서 그리기만 끊겼다. WebContent 는 살아 있어 종료 이벤트가 안 온다. 페이지에 따라 JS 는 15초 뒤 다시 돌아 숨소리도 못 잡는다.
//! 재현(시스템 WebKit, kill -STOP): 그 GPU 를 직접 SIGKILL 하면 같은 WebContent 가 새 GPU 에 붙어 다시 그린다 — 다시 불러오기가 없어 입력칸·화면 상태를 안 잃는다.
//! 그래서 세 길: ① 버려진 GPU(번호가 바뀌었는데 살아 있음) 끝내기 ② 숨소리가 끊기면 GPU → 그래도면 WebContent 끝내기(reload 는 굳은 프로세스에 안 먹는다) ③ WebContent 가 죽으면 다시 불러오기
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, Runtime};

const TICK: Duration = Duration::from_secs(5);
/// 보이는 창이 이만큼 숨을 안 쉬면 GPU 부터
const SILENT: Duration = Duration::from_secs(20);
/// GPU 를 끝내고도 이만큼 조용하면 WebContent 를 끝낸다
const THEN_RESTART: Duration = Duration::from_secs(15);
/// WebKit 이 끈 GPU 는 보통 0.3초 안에 나간다 — 이만큼 지나도 살아 있으면 버려진 것
const GPU_GRACE: Duration = Duration::from_secs(10);
/// 감시 스레드가 이만큼 늦으면(잠자기·맥 과부하) 시계를 믿지 않는다
const JUMP: Duration = Duration::from_secs(15);
/// 맥이 이만큼 바쁘면 기다림을 두 배로 — 느린 걸 죽은 걸로 보지 않게
const BUSY_LOAD: f64 = 100.0;

#[derive(Debug, PartialEq)]
pub enum Act {
    Gpu(String),
    Restart(String),
}

struct Win {
    last: Instant,
    visible: bool,
    stage: u32,
    next: Option<Instant>,
}

#[derive(Default)]
pub struct Watch {
    wins: HashMap<String, Win>,
    last_tick: Option<Instant>,
}

impl Watch {
    /// 숨 한 번 — 되살리던 창이면 끊겼던 초를 돌려준다
    pub fn beat(&mut self, label: &str, visible: bool, now: Instant) -> Option<u64> {
        let w = self.wins.entry(label.to_string()).or_insert(Win { last: now, visible, stage: 0, next: None });
        let back = (w.stage > 0).then(|| now.duration_since(w.last).as_secs());
        *w = Win { last: now, visible, stage: 0, next: None };
        back
    }

    /// 창이 앞으로 왔다 — 가려져 있던 창이 숨을 안 쉬어도 몰랐으니 지금부터 기다린다. 숨 쉰 적 없는 창(바깥 주소)은 false
    pub fn focused(&mut self, label: &str, now: Instant) -> bool {
        let Some(w) = self.wins.get_mut(label) else { return false };
        if !w.visible {
            w.visible = true;
            w.last = now;
        }
        true
    }

    /// 다시 불러오는 중 — 뜰 시간을 준다. 되살리던 중이면 다음 차례가 이미 잡혀 있어 그대로(web-back 에 끊긴 시간이 제대로 찍히게)
    pub fn reloading(&mut self, label: &str, now: Instant) {
        if let Some(w) = self.wins.get_mut(label).filter(|w| w.stage == 0) {
            w.last = now;
        }
    }

    pub fn forget(&mut self, label: &str) {
        self.wins.remove(label);
    }

    pub fn tick(&mut self, now: Instant, slack: u32) -> Vec<Act> {
        let jumped = self.last_tick.is_some_and(|t| now.duration_since(t) > JUMP);
        self.last_tick = Some(now);
        if jumped {
            for w in self.wins.values_mut() {
                *w = Win { last: now, visible: w.visible, stage: 0, next: None };
            }
            return Vec::new();
        }
        let mut acts = Vec::new();
        for (label, w) in self.wins.iter_mut().filter(|(_, w)| w.visible) {
            if w.stage == 0 {
                if now.duration_since(w.last) >= SILENT * slack {
                    w.stage = 1;
                    w.next = Some(now + THEN_RESTART * slack);
                    acts.push(Act::Gpu(label.clone()));
                }
            } else if w.next.is_some_and(|n| now >= n) {
                // 그래도 안 돌아오면 멈추지 않고 뜸을 늘려 가며 또(1·2·4분 … 10분까지)
                w.next = Some(now + Duration::from_secs(60u64 << (w.stage - 1).min(4)).min(Duration::from_secs(600)));
                w.stage += 1;
                acts.push(Act::Restart(label.clone()));
            }
        }
        acts
    }
}

/// 버려진 GPU 찾기 — 보던 번호가 바뀌었는데(0 이거나 새 번호) 옛 프로세스가 GPU_GRACE 넘게 살아 있으면 그 번호를 돌려준다
#[derive(Default)]
pub struct GpuWatch {
    known: Option<i32>,
    since: Option<Instant>,
}

impl GpuWatch {
    pub fn see(&mut self, id: i32, alive: impl Fn(i32) -> bool, now: Instant) -> Option<i32> {
        let current = (id > 0).then_some(id);
        let Some(old) = self.known else {
            self.known = current;
            return None;
        };
        if current == Some(old) {
            self.since = None;
            return None;
        }
        if !alive(old) {
            self.known = current;
            self.since = None;
            return None;
        }
        let since = *self.since.get_or_insert(now);
        if now.duration_since(since) < GPU_GRACE {
            return None;
        }
        self.known = current;
        self.since = None;
        Some(old)
    }
}

static WATCH: Mutex<Option<Watch>> = Mutex::new(None);

fn with<T>(f: impl FnOnce(&mut Watch) -> T) -> T {
    f(WATCH.lock().unwrap().get_or_insert_with(Watch::default))
}

/// 동기 명령은 메인 스레드에서 돈다 — 메인이 잠깐 막혀도 숨이 끊긴 걸로 안 보이게 async
#[tauri::command]
pub async fn web_beat<R: Runtime>(window: tauri::WebviewWindow<R>, visible: bool) {
    if let Some(after) = with(|m| m.beat(window.label(), visible, Instant::now())) {
        crate::claude::log_out("web-back", &format!("{} after {after}s", window.label()));
    }
}

pub fn on_focus<R: Runtime>(window: &tauri::Window<R>, on: bool) {
    if on && with(|m| m.focused(window.label(), Instant::now())) {
        if let Some(w) = window.app_handle().get_webview_window(window.label()) {
            let _ = w.eval("window.__webBeat&&window.__webBeat()");
        }
    }
}

pub fn forget(label: &str) {
    with(|m| m.forget(label));
}

/// WebContent 가 죽으면(메모리·SIGKILL) — 이 처리기를 달면 Tauri 기본 다시 읽기가 빠지니 여기서 한다
pub fn attach<R: Runtime>(b: tauri::Builder<R>) -> tauri::Builder<R> {
    #[cfg(target_os = "macos")]
    let b = b.on_web_content_process_terminate(|wv| {
        crate::claude::log_out("web-dead", &format!("{} web process gone, reload", wv.label()));
        with(|m| m.reloading(wv.label(), Instant::now()));
        let (app, wv) = (wv.app_handle().clone(), wv.clone());
        let _ = app.run_on_main_thread(move || {
            let _ = wv.reload();
        });
    });
    b
}

pub fn start<R: Runtime>(app: &tauri::AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut gpu = GpuWatch::default();
        loop {
            std::thread::sleep(TICK);
            tick(&app, &mut gpu);
        }
    });
}

fn tick<R: Runtime>(app: &tauri::AppHandle<R>, gpu: &mut GpuWatch) {
    let now = Instant::now();
    let slack = if load() > BUSY_LOAD { 2 } else { 1 };
    let any = app.get_webview_window("main").or_else(|| app.webview_windows().into_values().next());
    let gpu_id = any.as_ref().and_then(|w| process_id(w, true));
    if let Some(old) = gpu_id.filter(|id| *id >= 0).and_then(|id| gpu.see(id, is_gpu, now)) {
        crate::claude::log_out("web-dead", &format!("gpu {old} abandoned by WebKit, kill"));
        end(old);
    }
    let acts = with(|m| m.tick(now, slack));
    let mut gpu_done = false;
    for act in acts {
        match act {
            Act::Gpu(label) => {
                crate::claude::log_out("web-dead", &format!("{label} silent, kill gpu"));
                if !std::mem::replace(&mut gpu_done, true) {
                    if let Some(id) = gpu_id.filter(|id| *id > 0 && is_gpu(*id)) {
                        end(id);
                    }
                }
            }
            Act::Restart(label) => {
                let Some(w) = app.get_webview_window(&label) else { continue };
                // 사람이 개발자 도구에서 멈춰 둔 것일 수 있다
                if w.is_devtools_open() {
                    continue;
                }
                crate::claude::log_out("web-dead", &format!("{label} still silent, restart web process"));
                match process_id(&w, false).filter(|id| *id > 0) {
                    Some(pid) => end(pid), // 처리기가 다시 불러온다
                    None => {
                        let _ = w.reload();
                    }
                }
            }
        }
    }
}

fn load() -> f64 {
    #[cfg(unix)]
    {
        let mut l = [0f64; 1];
        if unsafe { libc::getloadavg(l.as_mut_ptr(), 1) } == 1 {
            return l[0];
        }
    }
    0.0
}

/// WKWebView 의 GPU·WebContent 프로세스 번호(WebKit 사설 API, 재현 때 확인) — 없는 판이면 -1, 메인 스레드가 2초 넘게 막히면 None
#[cfg(target_os = "macos")]
fn process_id<R: Runtime>(w: &tauri::WebviewWindow<R>, gpu: bool) -> Option<i32> {
    let (tx, rx) = std::sync::mpsc::channel();
    w.with_webview(move |wv| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let v = wv.inner() as *mut AnyObject;
        let sel = if gpu { objc2::sel!(_gpuProcessIdentifier) } else { objc2::sel!(_webProcessIdentifier) };
        let ok: bool = !v.is_null() && msg_send![v, respondsToSelector: sel];
        let id: i32 = match (ok, gpu) {
            (false, _) => -1,
            (true, true) => msg_send![v, _gpuProcessIdentifier],
            (true, false) => msg_send![v, _webProcessIdentifier],
        };
        let _ = tx.send(id);
    })
    .ok()?;
    rx.recv_timeout(Duration::from_secs(2)).ok()
}

#[cfg(not(target_os = "macos"))]
fn process_id<R: Runtime>(_: &tauri::WebviewWindow<R>, _: bool) -> Option<i32> {
    None
}

/// 번호가 다른 프로세스로 재사용됐을 수 있어 실행 파일 경로까지 본다
#[cfg(target_os = "macos")]
fn is_gpu(pid: i32) -> bool {
    let mut buf = vec![0u8; 4096];
    let n = unsafe { libc::proc_pidpath(pid, buf.as_mut_ptr() as *mut libc::c_void, buf.len() as u32) };
    n > 0 && String::from_utf8_lossy(&buf[..n as usize]).contains("com.apple.WebKit.GPU")
}

#[cfg(not(target_os = "macos"))]
fn is_gpu(_: i32) -> bool {
    false
}

#[cfg(unix)]
fn end(pid: i32) {
    unsafe { libc::kill(pid, libc::SIGKILL) };
}

#[cfg(not(unix))]
fn end(_: i32) {}

#[cfg(test)]
#[path = "web_watch_tests.rs"]
mod tests;
