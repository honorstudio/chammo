//! 리더 — 디자인 큐레이션(HTML)·PDF·마크다운·그림을 탭으로 본다(사용자 2026-09-28).
//! 탭이 사는 곳(surface) = 메인 창 작업 패널 왼쪽의 리더 패널("dock") + 크롬처럼 떼어 낸 창("reader-N").
//! 탭 목록은 여기(Store) 한 곳에서 들고, 바뀌면 그 창에 window.__reader() 신호만 준다 — 창은 reader_state 로 다시 읽는다.
//! ① hodoc://localhost/<절대 경로> 로 파일을 준다 — 홈 폴더 안만, 상대 경로(시안의 body/*.js)도 그대로 풀린다
//! ② 참모가 scripts/show 로 <데이터 폴더>/show.jsonl 에 한 줄 쓰면 리더 패널을 열고 탭으로 연다
//! ③ 탭을 창 밖에 놓으면 그 자리에 새 창, 리더 패널·다른 리더 창 위에 놓으면 그리로 옮긴다

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use crate::i18n::tr;
use tauri::http::{Request, Response};
use tauri::{Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub const DOCK: &str = "dock";

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
pub struct Surface {
    pub tabs: Vec<String>,
    pub active: Option<String>,
}

/// 탭이 사는 곳들. dock 은 늘 있다
#[derive(Default, Debug)]
pub struct Store {
    pub surfaces: BTreeMap<String, Surface>,
}

impl Store {
    pub fn get(&self, sid: &str) -> Surface {
        self.surfaces.get(sid).cloned().unwrap_or_default()
    }
    fn at(&mut self, sid: &str) -> &mut Surface {
        self.surfaces.entry(sid.to_string()).or_default()
    }
    /// 새 파일은 뒤에 붙이고 마지막 것을 본다. 이미 열린 건 그 탭으로
    pub fn add(&mut self, sid: &str, paths: &[String]) {
        let s = self.at(sid);
        for p in paths {
            if !s.tabs.contains(p) {
                s.tabs.push(p.clone());
            }
        }
        if let Some(last) = paths.last() {
            s.active = Some(last.clone());
        }
    }
    /// 탭 닫기 — 보던 탭이면 오른쪽(없으면 왼쪽). 그 곳이 비었으면 true
    pub fn close(&mut self, sid: &str, path: &str) -> bool {
        let s = self.at(sid);
        let Some(i) = s.tabs.iter().position(|p| p == path) else { return s.tabs.is_empty() };
        s.tabs.remove(i);
        if s.active.as_deref() == Some(path) {
            s.active = s.tabs.get(i).or_else(|| i.checked_sub(1).and_then(|j| s.tabs.get(j))).cloned();
        }
        s.tabs.is_empty()
    }
    pub fn activate(&mut self, sid: &str, path: &str) {
        let s = self.at(sid);
        if s.tabs.iter().any(|p| p == path) {
            s.active = Some(path.to_string());
        }
    }
    /// Ctrl+Tab(1)·Ctrl+Shift+Tab(-1) — 끝에서 처음으로 돈다
    pub fn cycle(&mut self, sid: &str, dir: i32) {
        let s = self.at(sid);
        let n = s.tabs.len() as i32;
        if n == 0 {
            return;
        }
        let i = s.active.as_ref().and_then(|a| s.tabs.iter().position(|p| p == a)).unwrap_or(0) as i32;
        s.active = Some(s.tabs[((i + dir).rem_euclid(n)) as usize].clone());
    }
    /// 탭 옮기기 — 같은 곳이면 순서만(index = 넣을 자리), 다른 곳이면 거기 index(없으면 끝)에 넣고 그걸 본다.
    /// 떠난 곳이 비었으면 그 곳 id 를 돌려준다(떼어 낸 창이면 닫는다)
    pub fn move_tab(&mut self, from: &str, path: &str, to: &str, index: Option<usize>) -> Option<String> {
        if !self.get(from).tabs.iter().any(|p| p == path) {
            return None;
        }
        if from == to {
            let s = self.at(from);
            let i = s.tabs.iter().position(|p| p == path).unwrap();
            let t = s.tabs.remove(i);
            let at = index.map(|j| if j > i { j - 1 } else { j }).unwrap_or(s.tabs.len()).min(s.tabs.len());
            s.tabs.insert(at, t);
            s.active = Some(path.to_string());
            return None;
        }
        let emptied = self.close(from, path);
        let s = self.at(to);
        s.tabs.retain(|p| p != path);
        let at = index.unwrap_or(s.tabs.len()).min(s.tabs.len());
        s.tabs.insert(at, path.to_string());
        s.active = Some(path.to_string());
        (emptied && from != DOCK).then(|| from.to_string())
    }
}

static STORE: Mutex<Option<Store>> = Mutex::new(None);
/// 메인 창 안 리더 패널 자리(웹뷰 좌표 x, y, w, h). 닫혀 있으면 None
static DOCK_RECT: Mutex<Option<[f64; 4]>> = Mutex::new(None);
static NEXT_WIN: Mutex<u32> = Mutex::new(1);

fn with_store<T>(f: impl FnOnce(&mut Store) -> T) -> T {
    let mut g = STORE.lock().unwrap();
    let st = g.get_or_insert_with(|| {
        let mut st = Store::default();
        let dock = std::fs::read_to_string(crate::config::data_file("reader.json")).ok().and_then(|t| serde_json::from_str::<Surface>(&t).ok()).unwrap_or_default();
        st.surfaces.insert(DOCK.into(), dock);
        st
    });
    f(st)
}

/// 바뀐 곳에 신호. dock 이면 저장도(떼어 낸 창은 앱을 끄면 사라진다 — 크롬처럼)
fn changed<R: Runtime>(app: &tauri::AppHandle<R>, sid: &str) {
    if sid == DOCK {
        let dock = with_store(|s| s.get(DOCK));
        let _ = std::fs::write(crate::config::data_file("reader.json"), serde_json::to_string(&dock).unwrap_or_default());
    }
    let label = if sid == DOCK { "main" } else { sid };
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.eval("window.__reader && window.__reader()");
    }
}

fn close_window<R: Runtime>(app: &tauri::AppHandle<R>, sid: &str) {
    with_store(|s| s.surfaces.remove(sid));
    if let Some(w) = app.get_webview_window(sid) {
        let _ = w.destroy();
    }
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// %XX 풀기(UTF-8). 잘못된 건 그대로 둔다
pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 주소의 경로 → 실제 파일. 홈 폴더 밖(../ 로 빠져나가는 것 포함)이면 None
pub fn safe_path(url_path: &str, home: &Path) -> Option<PathBuf> {
    let p = PathBuf::from(percent_decode(url_path));
    let real = p.canonicalize().ok()?;
    real.starts_with(home.canonicalize().ok()?).then_some(real)
}

pub fn mime_of(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("pdf") => "application/pdf",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        _ => "text/plain; charset=utf-8",
    }
}

/// hodoc:// 요청 처리
pub fn serve<R: Runtime>(_ctx: tauri::UriSchemeContext<'_, R>, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let not_found = || Response::builder().status(404).header("Content-Type", "text/plain; charset=utf-8").body(tr("없는 파일이거나 홈 폴더 밖이야", "File not found or outside the home folder").as_bytes().to_vec()).unwrap();
    let Some(path) = safe_path(req.uri().path(), &home()) else { return not_found() };
    match std::fs::read(&path) {
        Ok(body) => Response::builder().header("Content-Type", mime_of(&path)).header("Cache-Control", "no-store").body(body).unwrap(),
        Err(_) => not_found(),
    }
}

/// 리더 패널에 탭으로 연다 — 메인 창을 앞으로, 패널이 닫혀 있으면 연다
pub fn open<R: Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    let ok: Vec<String> = paths.into_iter().filter_map(|p| safe_path(&p, &home())).map(|p| p.to_string_lossy().into_owned()).collect();
    if ok.is_empty() {
        return;
    }
    with_store(|s| s.add(DOCK, &ok));
    changed(app, DOCK);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.eval("window.__readerShow && window.__readerShow()");
    }
}

#[tauri::command]
pub fn reader_state(surface: String) -> Surface {
    with_store(|s| s.get(&surface))
}

/// 리더 문서 속 경로 ⌘클릭 — 후보 가운데 실제로 있는 첫 파일(홈 안만)
#[tauri::command]
pub fn first_existing(paths: Vec<String>) -> Option<String> {
    let home = home();
    paths.into_iter().find(|p| safe_path(p, &home).is_some_and(|q| q.is_file()))
}

#[tauri::command]
pub fn reader_open(app: tauri::AppHandle, paths: Vec<String>) {
    open(&app, paths);
}

/// 탭 닫기 — 떼어 낸 창이 비면 창도 닫는다
#[tauri::command]
pub fn reader_close(app: tauri::AppHandle, surface: String, path: String) {
    let empty = with_store(|s| s.close(&surface, &path));
    if empty && surface != DOCK {
        close_window(&app, &surface);
    } else {
        changed(&app, &surface);
    }
}

#[tauri::command]
pub fn reader_activate(app: tauri::AppHandle, surface: String, path: String) {
    with_store(|s| s.activate(&surface, &path));
    changed(&app, &surface);
}

#[tauri::command]
pub fn reader_cycle(app: tauri::AppHandle, surface: String, dir: i32) {
    with_store(|s| s.cycle(&surface, dir));
    changed(&app, &surface);
}

/// 같은 탭 줄 안에서 순서 바꾸기
#[tauri::command]
pub fn reader_move(app: tauri::AppHandle, surface: String, path: String, index: usize) {
    with_store(|s| s.move_tab(&surface, &path, &surface, Some(index)));
    changed(&app, &surface);
}

#[tauri::command]
pub fn reader_dock_rect(rect: Option<[f64; 4]>) {
    *DOCK_RECT.lock().unwrap() = rect;
}

/// 창 안쪽(웹뷰)의 화면 좌표(논리) — [x, y, w, h]
fn frame<R: Runtime>(w: &tauri::WebviewWindow<R>) -> Option<[f64; 4]> {
    let sf = w.scale_factor().ok()?;
    let p = w.inner_position().ok()?.to_logical::<f64>(sf);
    let z = w.inner_size().ok()?.to_logical::<f64>(sf);
    Some([p.x, p.y, z.width, z.height])
}
/// 지금 마우스 자리 — 화면 왼쪽 위 기준 포인트(창 위치와 같은 좌표). 웹뷰의 screenX/window.screenX 는
/// WKWebView 에서 0 이 나와 못 믿는다(2026-09-28 실측) — 놓는 순간 여기서 직접 읽는다
#[cfg(target_os = "macos")]
fn mouse() -> Option<(f64, f64)> {
    use std::ffi::c_void;
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *const c_void) -> *mut c_void;
        fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }
    unsafe {
        let e = CGEventCreate(std::ptr::null());
        if e.is_null() {
            return None;
        }
        let p = CGEventGetLocation(e);
        CFRelease(e);
        Some((p.x, p.y))
    }
}
#[cfg(not(target_os = "macos"))]
fn mouse() -> Option<(f64, f64)> {
    None
}

fn inside(r: [f64; 4], x: f64, y: f64) -> bool {
    x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]
}

/// 탭 줄 밖에서 놓았다 — 놓은 자리는 지금 마우스(x·y 를 주면 그 화면 좌표, 검증용). 리더 패널 위면 패널로, 다른 리더 창 위면 그 창으로, 메인 창 위면 패널로,
/// 아무 창도 아니면 그 자리에 새 창. 자기 창 안(탭 줄 말고)이면 그대로 둔다
#[tauri::command]
pub async fn reader_drop(app: tauri::AppHandle, from: String, path: String, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    let (x, y) = match (x, y) {
        (Some(x), Some(y)) => (x, y),
        _ => mouse().ok_or(tr("마우스 위치를 못 읽음", "Could not read the mouse position"))?,
    };
    let main = app.get_webview_window("main");
    let main_frame = main.as_ref().and_then(frame);
    let dock = (*DOCK_RECT.lock().unwrap()).zip(main_frame).map(|(d, m)| [m[0] + d[0], m[1] + d[1], d[2], d[3]]);
    let mut target: Option<String> = None;
    if dock.is_some_and(|d| inside(d, x, y)) || (main_frame.is_some_and(|m| inside(m, x, y)) && main.as_ref().is_some_and(|w| w.is_visible().unwrap_or(false))) {
        target = Some(DOCK.into());
    } else {
        for (label, w) in app.webview_windows() {
            if label.starts_with("reader-") && w.is_visible().unwrap_or(false) && frame(&w).is_some_and(|f| inside(f, x, y)) {
                target = Some(label);
                break;
            }
        }
    }
    match target {
        Some(t) if t == from => Ok(()),
        Some(t) => {
            let emptied = with_store(|s| s.move_tab(&from, &path, &t, None));
            changed(&app, &t);
            if t == DOCK {
                if let Some(w) = &main {
                    let _ = w.eval("window.__readerShow && window.__readerShow()");
                    let _ = w.set_focus();
                }
            } else if let Some(w) = app.get_webview_window(&t) {
                let _ = w.set_focus();
            }
            match emptied {
                Some(e) => close_window(&app, &e),
                None => changed(&app, &from),
            }
            Ok(())
        }
        None => {
            // 떼어 낸 창에 탭이 하나뿐이면 새 창을 만들 것 없이 그 창을 옮기면 되지만, 단순하게 늘 새 창
            let label = {
                let mut n = NEXT_WIN.lock().unwrap();
                *n += 1;
                format!("reader-{}", *n)
            };
            let emptied = with_store(|s| s.move_tab(&from, &path, &label, None));
            WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("reader.html?s={label}").into()))
                .title(tr("리더", "Reader"))
                .inner_size(960.0, 760.0)
                .min_inner_size(480.0, 360.0)
                .position((x - 160.0).max(0.0), (y - 20.0).max(0.0))
                .build()
                .map_err(|e| e.to_string())?;
            match emptied {
                Some(e) => close_window(&app, &e),
                None => changed(&app, &from),
            }
            Ok(())
        }
    }
}

/// 떼어 낸 창에 파일을 끌어다 놓았다 — 그 창의 탭으로
pub fn add_to<R: Runtime>(app: &tauri::AppHandle<R>, sid: &str, paths: Vec<String>) {
    let ok: Vec<String> = paths.into_iter().filter_map(|p| safe_path(&p, &home())).map(|p| p.to_string_lossy().into_owned()).collect();
    with_store(|s| s.add(sid, &ok));
    changed(app, sid);
}

/// 떼어 낸 창을 빨간 버튼으로 닫았다 — 그 창의 탭도 닫는다(크롬처럼)
pub fn forget(label: &str) {
    with_store(|s| s.surfaces.remove(label));
}

/// 마크다운·글 파일 원문 (홈 폴더 안만)
#[tauri::command]
pub fn read_doc_text(path: String) -> Result<String, String> {
    let p = safe_path(&path, &home()).ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    std::fs::read_to_string(p).map_err(|e| e.to_string())
}

/// show.jsonl 새 줄 → 경로들. offset 부터 끝까지 읽고 다음 offset 을 돌려준다(파일이 줄었으면 처음부터)
pub fn new_paths(content: &str, offset: usize) -> (Vec<String>, usize) {
    let start = if offset > content.len() { 0 } else { offset };
    let paths = content[start..]
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter_map(|v| v.get("path").and_then(|p| p.as_str()).map(str::to_owned))
        .collect();
    (paths, content.len())
}

/// scripts/show 감시 — 0.7초마다 show.jsonl 끝을 본다. 앱이 켜지기 전 줄은 건너뛴다
pub fn watch<R: Runtime>(app: &tauri::AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let file = crate::config::data_file("show.jsonl");
        let mut offset = std::fs::read_to_string(&file).map(|s| s.len()).unwrap_or(0);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(700));
            let Ok(content) = std::fs::read_to_string(&file) else { continue };
            if content.len() == offset {
                continue;
            }
            let (paths, next) = new_paths(&content, offset);
            offset = next;
            if !paths.is_empty() {
                let a = app.clone();
                let _ = app.run_on_main_thread(move || open(&a, paths));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_korean_and_space() {
        assert_eq!(percent_decode("/Users/h/%EB%AC%B8%EC%84%9C%201/a%20b.pdf"), "/Users/h/문서 1/a b.pdf");
        assert_eq!(percent_decode("/a/100%"), "/a/100%");
    }

    #[test]
    fn only_inside_home() {
        let dir = std::env::temp_dir().join(format!("hodoc-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("home/docs")).unwrap();
        std::fs::write(dir.join("home/docs/a.md"), "# a").unwrap();
        std::fs::write(dir.join("secret.txt"), "x").unwrap();
        let home = dir.join("home");
        assert!(safe_path(&format!("{}/docs/a.md", home.display()), &home).is_some());
        assert!(safe_path(&format!("{}/docs/../../secret.txt", home.display()), &home).is_none());
        assert!(safe_path(&format!("{}/docs/없음.md", home.display()), &home).is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn mime_by_ext() {
        assert_eq!(mime_of(Path::new("/a/v3.HTML")), "text/html; charset=utf-8");
        assert_eq!(mime_of(Path::new("/a/x.pdf")), "application/pdf");
        assert_eq!(mime_of(Path::new("/a/Makefile")), "text/plain; charset=utf-8");
    }

    fn st(tabs: &[&str], active: &str) -> Store {
        let mut s = Store::default();
        s.surfaces.insert(DOCK.into(), Surface { tabs: tabs.iter().map(|t| t.to_string()).collect(), active: Some(active.into()) });
        s
    }
    fn tabs(s: &Store, sid: &str) -> Vec<String> {
        s.get(sid).tabs
    }

    #[test]
    fn add_close_cycle() {
        let mut s = st(&["/a", "/b"], "/a");
        s.add(DOCK, &["/c".into(), "/b".into()]);
        assert_eq!((tabs(&s, DOCK), s.get(DOCK).active), (vec!["/a".into(), "/b".into(), "/c".into()], Some("/b".into())));
        assert!(!s.close(DOCK, "/b"));
        assert_eq!(s.get(DOCK).active, Some("/c".into())); // 오른쪽
        assert!(!s.close(DOCK, "/c"));
        assert_eq!(s.get(DOCK).active, Some("/a".into())); // 오른쪽 없으면 왼쪽
        s.add(DOCK, &["/d".into()]);
        s.cycle(DOCK, 1);
        assert_eq!(s.get(DOCK).active, Some("/a".into())); // 끝 → 처음
        s.cycle(DOCK, -1);
        assert_eq!(s.get(DOCK).active, Some("/d".into()));
        assert!(!s.close(DOCK, "/a"));
        assert!(s.close(DOCK, "/d"));
    }

    #[test]
    fn reorder_in_same_strip() {
        let mut s = st(&["/a", "/b", "/c"], "/a");
        assert_eq!(s.move_tab(DOCK, "/a", DOCK, Some(3)), None);
        assert_eq!(tabs(&s, DOCK), vec!["/b".to_string(), "/c".into(), "/a".into()]);
        s.move_tab(DOCK, "/a", DOCK, Some(0));
        assert_eq!(tabs(&s, DOCK), vec!["/a".to_string(), "/b".into(), "/c".into()]);
        s.move_tab(DOCK, "/c", DOCK, Some(1));
        assert_eq!(tabs(&s, DOCK), vec!["/a".to_string(), "/c".into(), "/b".into()]);
    }

    #[test]
    fn move_between_and_empty_window() {
        let mut s = st(&["/a", "/b"], "/a");
        assert_eq!(s.move_tab(DOCK, "/b", "reader-2", None), None); // dock 은 비어도 안 닫는다
        assert_eq!(tabs(&s, "reader-2"), vec!["/b".to_string()]);
        assert_eq!(s.get("reader-2").active, Some("/b".into()));
        assert_eq!(s.move_tab("reader-2", "/b", DOCK, Some(0)), Some("reader-2".into())); // 빈 창은 닫게 알린다
        assert_eq!(tabs(&s, DOCK), vec!["/b".to_string(), "/a".into()]);
        assert_eq!(s.move_tab(DOCK, "/없음", "reader-3", None), None);
    }

    #[test]
    fn show_lines_after_offset() {
        let a = "{\"ts\":\"1\",\"path\":\"/a.md\"}\n";
        let all = format!("{a}깨진 줄\n{{\"ts\":\"2\",\"path\":\"/b.pdf\"}}\n");
        assert_eq!(new_paths(&all, a.len()), (vec!["/b.pdf".to_string()], all.len()));
        assert_eq!(new_paths(a, 999).0, vec!["/a.md".to_string()]); // 파일이 줄었으면 처음부터
    }
}
