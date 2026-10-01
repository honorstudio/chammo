//! 리더 — 디자인 큐레이션(HTML)·PDF·마크다운·그림·영상을 탭으로 본다(사용자 2026-09-28).
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
    PathBuf::from(crate::platform::home())
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
    let p = PathBuf::from(crate::platform::url_to_fs(&percent_decode(url_path)));
    let real = crate::platform::clean_path(p.canonicalize().ok()?);
    real.starts_with(crate::platform::clean_path(home.canonicalize().ok()?)).then_some(real)
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
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("tif" | "tiff") => "image/tiff",
        Some("heic" | "heif") => "image/heic",
        Some("mp3") => "audio/mpeg",
        Some("m4a" | "aac") => "audio/mp4",
        Some("wav") => "audio/wav",
        Some("ogg" | "oga") => "audio/ogg",
        Some("flac") => "audio/flac",
        Some("aif" | "aiff") => "audio/aiff",
        Some("caf") => "audio/x-caf",
        _ => "text/plain; charset=utf-8",
    }
}

/// Range 머리("bytes=a-b", "bytes=a-", "bytes=-n") → 포함 구간 (시작, 끝). 파일 밖이거나 모양이 다르면 None
pub fn range_of(header: &str, len: usize) -> Option<(usize, usize)> {
    let (a, b) = header.trim().strip_prefix("bytes=")?.split(',').next()?.split_once('-')?;
    let last = len.checked_sub(1)?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => (len.saturating_sub(n.parse().ok()?), last),
        (a, "") => (a.parse().ok()?, last),
        (a, b) => (a.parse().ok()?, b.parse::<usize>().ok()?.min(last)),
    };
    (start <= end && start <= last).then_some((start, end))
}

/// 파일 내용 → 응답. 영상은 WebKit 이 Range 로 조각씩 달라고 해서 206 으로 그 조각만 준다(2026-09-29 리더 영상 재생)
pub fn respond(body: &[u8], mime: &str, range: Option<&str>) -> Response<Vec<u8>> {
    let base = || Response::builder().header("Content-Type", mime).header("Cache-Control", "no-store").header("Accept-Ranges", "bytes");
    match range {
        None => base().body(body.to_vec()).unwrap(),
        Some(h) => match range_of(h, body.len()) {
            Some((a, b)) => base().status(206).header("Content-Range", format!("bytes {a}-{b}/{}", body.len())).body(body[a..=b].to_vec()).unwrap(),
            None => base().status(416).header("Content-Range", format!("bytes */{}", body.len())).body(Vec::new()).unwrap(),
        },
    }
}

/// HTML 끝에 한 줄 — 프레임 안에서 누른 Esc 를 앱(부모 창)에 넘긴다. 프레임은 다른 출처라 앱이 키를 못 듣는다
/// (채팅 뷰 미리보기 모달이 Esc 로 안 닫혔다 — 2026-09-30 사용자)
/// 앱이 보낸 확대 비율({hodocZoom})로 문서 자체를 zoom — 바깥에서 늘리면 흐려졌다(2026-09-30 사용자)
const ESC_BRIDGE: &str = "<script>addEventListener('keydown',function(e){if(e.key==='Escape'&&parent!==window)parent.postMessage({hodoc:'esc'},'*')},true);addEventListener('message',function(e){var z=e.data&&e.data.hodocZoom;if(typeof z==='number'&&z>0)document.documentElement.style.zoom=String(z);var q=e.data&&e.data.hodocFind;if(typeof q==='string'&&q)hodocFlash(q);var pg=e.data&&e.data.hodocPage;if(typeof pg==='number'&&pg>0&&!(q&&q.length))hodocPageGo(pg)});function hodocPageGo(n){var ps=document.querySelectorAll('div.slide, .page, section.slide, .sheet');var el=ps[Math.min(n,ps.length)-1];if(!el)return;el.scrollIntoView({block:'start',behavior:'smooth'});hodocRing(function(){return el.getBoundingClientRect()},500)}function hodocRing(c0,wait){var my=window.__hodocN=(window.__hodocN||0)+1;document.querySelectorAll('.hodoc-ring').forEach(function(x){x.remove()});setTimeout(function(){if(window.__hodocN!==my)return;var st=document.getElementById('hodoc-st');if(!st){st=document.createElement('style');st.id='hodoc-st';st.textContent='::highlight(hodoc-flash){background:#ffd24d;color:#1a1a1a}.hodoc-ring{position:absolute;z-index:2147483647;pointer-events:none;border-radius:10px;box-shadow:0 0 0 2px #f0a020;animation:hodoc-ring 1.1s ease-out 3 forwards}@keyframes hodoc-ring{0%{box-shadow:0 0 0 2px #f0a020,0 0 0 0 rgba(240,160,32,.55)}70%{box-shadow:0 0 0 2px #f0a020,0 0 0 14px rgba(240,160,32,0)}100%{box-shadow:0 0 0 2px rgba(240,160,32,.6)}}';document.head.appendChild(st)}var c=typeof c0==='function'?c0():c0,d=document.createElement('div');d.className='hodoc-ring';d.style.cssText='left:'+(c.left+scrollX-6)+'px;top:'+(c.top+scrollY-4)+'px;width:'+(c.width+12)+'px;height:'+(c.height+8)+'px';document.body.appendChild(d);setTimeout(function(){d.remove();if(window.__hodocN===my&&window.CSS&&CSS.highlights)CSS.highlights.delete('hodoc-flash')},6000)},wait)}function hodocFlash(q){var w=document.createTreeWalker(document.body,4),ns=[],s='';for(var n=w.nextNode();n;n=w.nextNode()){ns.push([n,s.length]);s+=n.nodeValue}var l=s.toLowerCase(),k=q.toLowerCase().trim(),i=l.indexOf(k);if(i<0&&k.length>20){k=k.slice(0,20);i=l.indexOf(k)}if(i<0)return;function at(p){for(var j=ns.length-1;j>=0;j--)if(ns[j][1]<=p)return[ns[j][0],p-ns[j][1]]}var a=at(i),b=at(i+k.length),r=document.createRange();r.setStart(a[0],a[1]);r.setEnd(b[0],Math.min(b[1],b[0].nodeValue.length));var el=a[0].parentElement;el.scrollIntoView({block:'center',behavior:'smooth'});if(window.Highlight&&CSS.highlights)CSS.highlights.set('hodoc-flash',new Highlight(r));hodocRing(function(){return r.getBoundingClientRect()},450)}</script>";
pub fn with_esc_bridge(body: &[u8]) -> Vec<u8> {
    let mut out = body.to_vec();
    out.extend_from_slice(ESC_BRIDGE.as_bytes());
    out
}

/// hodoc:// 요청 처리
pub fn serve<R: Runtime>(_ctx: tauri::UriSchemeContext<'_, R>, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let not_found = || Response::builder().status(404).header("Content-Type", "text/plain; charset=utf-8").body(tr("없는 파일이거나 홈 폴더 밖이야", "File not found or outside the home folder").as_bytes().to_vec()).unwrap();
    let Some(path) = safe_path(req.uri().path(), &home()) else { return not_found() };
    let range = req.headers().get("range").and_then(|v| v.to_str().ok());
    match std::fs::read(&path) {
        Ok(body) => {
            let mime = mime_of(&path);
            if mime.starts_with("text/html") && range.is_none() { respond(&with_esc_bridge(&body), mime, None) } else { respond(&body, mime, range) }
        }
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

/// ⌘A — 리더 HTML·PDF 문서 프레임 안만 전체 선택. 프레임은 다른 출처라 웹에서 못 건드려서,
/// 웹뷰의 기본 전체 선택(selectAll:)을 부른다 — 포커스가 있는 프레임 안에서만 돈다(사용자 2026-09-29)
#[tauri::command]
pub fn reader_select_all(webview: tauri::Webview) {
    #[cfg(target_os = "macos")]
    let _ = webview.with_webview(|wv| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let wk = wv.inner() as *mut AnyObject;
        if !wk.is_null() {
            let none: *mut AnyObject = std::ptr::null_mut();
            let _: () = msg_send![wk, selectAll: none];
        }
    });
    #[cfg(not(target_os = "macos"))]
    let _ = webview;
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

/// 스페이스(리더 편집)에서 고친 md 저장 — 홈 안 이미 있는 md·txt 만, 임시 파일에 쓰고 바꿔 끼운다(쓰다 멈춰도 원본이 안 깨지게)
#[tauri::command]
pub fn write_doc_text(path: String, text: String) -> Result<(), String> {
    let p = safe_path(&path, &home()).ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    if !editable(&p) {
        return Err(tr("마크다운·글 파일만 고칠 수 있어", "Only Markdown and text files can be edited").into());
    }
    keep_history(&p);
    let tmp = p.with_extension("chammo-tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// 고치기 전 판을 앱 데이터 폴더/history/<파일>/ 에 남긴다(파일마다 최근 50개) — 편집기에서 한 번에 지워진 게 저장돼
/// 페이지가 날아간 적이 있다(2026-09-30 사용자). 같은 분 안에서는 한 번만(타자마다 쌓이지 않게)
fn keep_history(p: &Path) {
    let Ok(old) = std::fs::read(p) else { return };
    let key: String = p.to_string_lossy().chars().map(|c| if c.is_alphanumeric() || c == '.' || c == '-' { c } else { '_' }).collect();
    let dir = crate::config::data_file("history").join(key);
    if std::fs::create_dir_all(&dir).is_err() { return; }
    let minute = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() / 60).unwrap_or(0);
    let file = dir.join(format!("{minute}.md"));
    if !file.exists() { let _ = std::fs::write(&file, old); }
    if let Ok(rd) = std::fs::read_dir(&dir) {
        let mut v: Vec<_> = rd.flatten().map(|e| e.path()).collect();
        v.sort();
        let extra = v.len().saturating_sub(50);
        for x in v.into_iter().take(extra) { let _ = std::fs::remove_file(x); }
    }
}

/// 폴더 안 md 파일(바로 아래만) + 하위 폴더 이름들 안 md — 채팅 뷰 메뉴의 프로젝트 문서(docs/, docs/decisions/)·내 페이지. 홈 안만, 이름 순
#[tauri::command]
pub fn list_md(dir: String, subs: Vec<String>) -> Vec<String> {
    let Some(base) = safe_path(&dir, &home()) else { return Vec::new() };
    let mut out = Vec::new();
    for d in std::iter::once(base.clone()).chain(subs.iter().map(|s| base.join(s))) {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        let mut v: Vec<String> = rd.flatten().map(|e| e.path()).filter(|p| p.is_file() && p.extension().is_some_and(|x| x.eq_ignore_ascii_case("md"))).map(|p| p.to_string_lossy().into_owned()).collect();
        v.sort();
        out.extend(v);
    }
    out
}

/// 폴더 한 칸(프로젝트 파일 나무) — 숨김·무거운 폴더(.git·node_modules·target 등)는 뺀다. 폴더 먼저, 이름 순. 홈 안만
#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub dir: bool,
}

pub fn skip_entry(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "target" | "target.noindex" | "dist" | "build" | "Pods" | "__pycache__" | "DerivedData")
}

#[tauri::command]
pub fn list_dir(dir: String) -> Vec<DirEntry> {
    let Some(base) = safe_path(&dir, &home()) else { return Vec::new() };
    let Ok(rd) = std::fs::read_dir(&base) else { return Vec::new() };
    let mut v: Vec<DirEntry> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if skip_entry(&name) { return None; }
            let path = e.path();
            Some(DirEntry { dir: path.is_dir(), path: path.to_string_lossy().into_owned(), name })
        })
        .collect();
    v.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    v.truncate(500);
    v
}

/// 워드·파워포인트 미리보기는 맥 도구(textutil·QuickLook)로 만든다 — 윈도우엔 없어 "파일을 찾을 수 없습니다" 가 떴다
fn mac_only_preview() -> String {
    tr("이 문서는 맥에서만 미리 볼 수 있어요 — 기본 앱으로 열어 주세요", "This document previews on macOS only — open it in its default app").into()
}

/// 워드·RTF 등을 HTML 로(macOS textutil) — 미리보기가 srcdoc 으로 그린다. 홈 안만
#[tauri::command]
pub async fn office_html(path: String) -> Result<String, String> {
    if !cfg!(target_os = "macos") {
        return Err(mac_only_preview());
    }
    let p = safe_path(&path, &home()).ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let out = crate::platform::command("/usr/bin/textutil").args(["-convert", "html", "-stdout"]).arg(&p).output().map_err(|e| e.to_string())?;
        if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).into_owned()); }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// PDF 원본 바이트 — 미리보기(pdf.js)가 페이지를 직접 그려 페이지로 가고 글을 반짝인다(짚어 보여 주기). 홈 안만
#[tauri::command]
pub fn read_doc_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let p = safe_path(&path, &home()).ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    std::fs::read(p).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// 미리보기 자리 — 경로마다 따로(같은 이름 다른 폴더가 안 섞이게)
fn page_doc_dir(base: &Path, src: &Path) -> PathBuf {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    src.hash(&mut h);
    base.join(format!("{:016x}", h.finish()))
}

/// QuickLook 이 만든 .qlpreview 폴더에서 보여 줄 본문 — Preview.html(슬라이드·표), 없으면 PDF
fn page_doc_main(names: &[String]) -> Option<String> {
    names.iter().find(|n| n.eq_ignore_ascii_case("Preview.html"))
        .or_else(|| names.iter().find(|n| n.to_lowercase().ends_with(".pdf")))
        .cloned()
}

/// 파워포인트·워드·엑셀·키노트 → macOS QuickLook 미리보기(슬라이드마다 나뉜 HTML, 글자 그대로) — 슬라이드 번호·글로 짚어 보여 주려고(2026-09-30 사용자).
/// 모든 맥에 있다(LibreOffice 는 안 깔려 있을 수 있다). 앱 데이터 폴더/page-doc 에 두고 원본보다 새면 다시 안 만든다. 본문 파일 경로를 돌려준다
#[tauri::command]
pub async fn page_doc(path: String) -> Result<String, String> {
    if !cfg!(target_os = "macos") {
        return Err(mac_only_preview());
    }
    let p = safe_path(&path, &home()).ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = page_doc_dir(&crate::config::data_file("page-doc"), &p);
        let find = || -> Option<PathBuf> {
            let q = std::fs::read_dir(&dir).ok()?.flatten().map(|e| e.path()).find(|x| x.extension().is_some_and(|e| e == "qlpreview"))?;
            let names: Vec<String> = std::fs::read_dir(&q).ok()?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
            Some(q.join(page_doc_main(&names)?))
        };
        let newer = |a: &Path| matches!((a.metadata().and_then(|m| m.modified()), p.metadata().and_then(|m| m.modified())), (Ok(x), Ok(y)) if x >= y);
        if let Some(m) = find() { if newer(&m) { return Ok(m.to_string_lossy().into_owned()); } }
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let out = crate::platform::command("/usr/bin/qlmanage").args(["-p", "-o"]).arg(&dir).arg(&p).output().map_err(|e| e.to_string())?;
        find().map(|m| m.to_string_lossy().into_owned()).ok_or_else(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 엑셀·키노트·PSD 같은 건 QuickLook 이 그린 첫 장 그림(PNG) — 앱 데이터 폴더/ql 에 두고 경로를 돌려준다(hodoc 으로 보인다)
#[tauri::command]
pub async fn ql_thumb(path: String) -> Result<String, String> {
    if !cfg!(target_os = "macos") {
        return Err(mac_only_preview());
    }
    let p = safe_path(&path, &home()).ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = crate::config::data_file("ql");
        let _ = std::fs::create_dir_all(&dir);
        // 원본보다 새 그림이 이미 있으면 그대로(앱을 다시 켤 때마다 qlmanage 를 돌리지 않게)
        let done = dir.join(format!("{}.png", p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
        let newer = |a: &std::path::Path, b: &std::path::Path| matches!((a.metadata().and_then(|m| m.modified()), b.metadata().and_then(|m| m.modified())), (Ok(x), Ok(y)) if x >= y);
        if newer(&done, &p) { return Ok(done.to_string_lossy().into_owned()); }
        let out = crate::platform::command("/usr/bin/qlmanage").args(["-t", "-s", "1600", "-o"]).arg(&dir).arg(&p).output().map_err(|e| e.to_string())?;
        let png = dir.join(format!("{}.png", p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
        if png.exists() { Ok(png.to_string_lossy().into_owned()) } else { Err(String::from_utf8_lossy(&out.stdout).trim().to_string()) }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 시안 검토 파일 이름 — <폴더>-<시안>.<ext>(폴더가 없으면 <시안>.<ext>)
fn curation_name(path: &str, ext: &str) -> String {
    let p = std::path::Path::new(path);
    let stem = p.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "curation".into());
    let parent = p.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if parent.is_empty() { format!("{stem}.{ext}") } else { format!("{parent}-{stem}.{ext}") }
}

/// 시안 검토(큐레이션) 결과 — 앱 데이터 폴더/curation/<시안 이름>.md. 사용자가 표시할 때마다 앱이 적어 두고, 참모는 보내기 전에도 여기서 읽는다
#[tauri::command]
pub fn save_curation(path: String, text: String) -> Result<String, String> {
    let dir = crate::config::data_file("curation");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join(curation_name(&path, "md"));
    std::fs::write(&out, format!("<!-- 시안: {path} -->\n{text}\n")).map_err(|e| e.to_string())?;
    Ok(out.to_string_lossy().into_owned())
}

/// 시안 표시 상태(표시·메모·덱 메모) — 시안의 브라우저 저장소는 앱을 다시 켜면 비어서 표시가 날아갔다(2026-09-30).
/// 앱이 파일로도 적어 두고, 빈 채로 열리면 되돌려 준다
#[tauri::command]
pub fn save_curation_state(path: String, json: String) -> Result<(), String> {
    let dir = crate::config::data_file("curation");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(curation_name(&path, "state.json")), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_curation_state(path: String) -> String {
    std::fs::read_to_string(crate::config::data_file("curation").join(curation_name(&path, "state.json"))).unwrap_or_default()
}

/// 폴더 안 md 전부(하위 폴더까지, 깊이 4) — 내 페이지 나무. 경로 순
#[tauri::command]
pub fn list_md_deep(dir: String) -> Vec<String> {
    fn walk(d: &Path, depth: u8, out: &mut Vec<String>) {
        if depth > 4 { return; }
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if skip_entry(&name) { continue; }
            if p.is_dir() { walk(&p, depth + 1, out); } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("md")) { out.push(p.to_string_lossy().into_owned()); }
        }
    }
    let Some(base) = safe_path(&dir, &home()) else { return Vec::new() };
    let mut out = Vec::new();
    walk(&base, 0, &mut out);
    out.sort();
    out
}

/// 내 페이지 폴더(앱 데이터 폴더/pages) — 없으면 만든다
#[tauri::command]
pub fn pages_dir() -> String {
    let d = crate::config::data_file("pages");
    let _ = std::fs::create_dir_all(&d);
    d.to_string_lossy().into_owned()
}

/// 새 페이지 파일 이름 — 제목에서 파일에 못 쓰는 글자를 빼고, 겹치면 " 2", " 3"
pub fn page_file_name(title: &str, exists: impl Fn(&str) -> bool) -> String {
    let clean: String = title.trim().chars().map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '-' } else { c }).collect();
    let base = if clean.trim().is_empty() { tr("새 페이지", "Untitled").to_string() } else { clean.trim().to_string() };
    let mut name = format!("{base}.md");
    let mut n = 2;
    while exists(&name) {
        name = format!("{base} {n}.md");
        n += 1;
    }
    name
}

/// 내 페이지에 새 md — "# 제목" 한 줄로 만들고 경로를 돌려준다. parent 를 주면 그 페이지의 하위 페이지
/// (노션처럼 — 부모 파일 옆 같은 이름 폴더 안, 2026-09-30 사용자)
#[tauri::command]
pub fn new_page(title: String, parent: Option<String>) -> Result<String, String> {
    let d = match parent.as_deref().and_then(|p| safe_path(p, &home())) {
        Some(pp) => pp.with_extension(""),
        None => std::path::PathBuf::from(pages_dir()),
    };
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let name = page_file_name(&title, |n| d.join(n).exists());
    let p = d.join(name);
    let head = if title.trim().is_empty() { tr("새 페이지", "Untitled").to_string() } else { title.trim().to_string() };
    std::fs::write(&p, format!("# {head}\n\n")).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().into_owned())
}

/// 휴지통 자리 — 같은 이름이 있으면 "이름 2.md"·"이름 3" 처럼 번호를 붙인다(덮어쓰지 않는다)
fn trash_dest(trash: &Path, name: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let first = trash.join(name);
    if !exists(&first) {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (2..).map(|n| trash.join(format!("{stem} {n}{ext}"))).find(|p| !exists(p)).unwrap()
}

/// 내 페이지 지우기 — 영구 삭제가 아니라 맥 휴지통(~/.Trash)으로 옮긴다. 하위 페이지 폴더(같은 이름)도 같이.
/// 내 페이지 폴더 안만(2026-09-30 사용자 "페이지 삭제가 안 되네")
#[tauri::command]
pub fn trash_page(path: String) -> Result<(), String> {
    let p = safe_path(&path, &home()).ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    let pages = std::fs::canonicalize(pages_dir()).map_err(|e| e.to_string())?;
    if !p.starts_with(&pages) || p == pages {
        return Err(tr("내 페이지만 지울 수 있어", "Only pages can be removed here").into());
    }
    let trash = home().join(".Trash");
    let mv = |from: &Path| -> Result<(), String> {
        let name = from.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        std::fs::rename(from, trash_dest(&trash, &name, |x| x.exists())).map_err(|e| e.to_string())
    };
    let sub = p.with_extension("");
    mv(&p)?;
    if sub.is_dir() {
        mv(&sub)?;
    }
    Ok(())
}

/// scripts/show 기록 꼬리(최근 64KB) — 채팅 뷰 스페이스가 세션마다 보여 준 파일을 모은다. 파싱은 domain/spaceNav
#[tauri::command]
pub fn read_show_log() -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(crate::config::data_file("show.jsonl")) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(64 * 1024)));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

/// 스페이스 편집기에 넣은 그림 — 문서 옆 assets/ 에 저장하고 문서 기준 상대 경로를 돌려준다(md 에 그대로 적힌다)
#[tauri::command]
pub fn save_asset(doc_path: String, name: String, bytes: Vec<u8>) -> Result<String, String> {
    let doc = safe_path(&doc_path, &home()).ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    let dir = doc.parent().ok_or("no parent")?.join("assets");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = asset_name(&name, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    std::fs::write(dir.join(&file), bytes).map_err(|e| e.to_string())?;
    Ok(format!("assets/{file}"))
}

/// 경로 없는 그림(채팅에 붙인 그림 등)을 앱 데이터 폴더/attach 에 파일로 — "채팅에 붙이기"가 경로로 넘기게(2026-09-30 사용자)
#[tauri::command]
pub fn save_attach(name: String, bytes: Vec<u8>) -> Result<String, String> {
    let dir = crate::config::data_file("attach");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = asset_name(&name, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    let p = dir.join(file);
    std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().into_owned())
}

/// 저장 이름 — 시각-원래이름, 경로·이상한 글자는 뺀다(겹치지 않게 시각을 앞에)
pub fn asset_name(name: &str, ms: u128) -> String {
    let base: String = Path::new(name).file_name().and_then(|n| n.to_str()).unwrap_or("image.png")
        .chars().map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' }).collect();
    format!("{ms}-{}", if base.trim_matches('.').is_empty() { "image.png".into() } else { base })
}

pub fn editable(p: &Path) -> bool {
    matches!(p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("md" | "markdown" | "txt"))
}

/// 스페이스 고친 기록 — <데이터 폴더>/space-log.jsonl 에 한 줄(참모가 읽는다). 줄은 프론트가 만든 JSON
#[tauri::command]
pub fn space_log_append(line: String) -> Result<(), String> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(crate::config::data_file("space-log.jsonl")).map_err(|e| e.to_string())?;
    writeln!(f, "{}", line.replace('\n', " ")).map_err(|e| e.to_string())
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

/// 지금 채팅 뷰인가 — 채팅 뷰면 scripts/show 를 리더로 안 열고 스페이스(프론트)가 모달·문서로 띄운다.
/// 파일(view.json)에도 적어 scripts/show 가 "스페이스에 띄움"이라고 알맞게 말하게 한다(2026-09-30 사용자 "리더로 열려고 하네")
static CHAT_VIEW: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub fn set_view_mode(chat: bool) {
    CHAT_VIEW.store(chat, std::sync::atomic::Ordering::Relaxed);
    let _ = std::fs::write(crate::config::data_file("view.json"), format!("{{\"view\":\"{}\"}}", if chat { "chat" } else { "terminal" }));
}

/// scripts/show 감시 — 0.7초마다 show.jsonl 끝을 본다. 앱이 켜지기 전 줄은 건너뛴다
pub fn watch<R: Runtime>(app: &tauri::AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let file = crate::config::data_file("show.jsonl");
        // 바이트로 읽어 깨진 글자는 바꿔 넣는다 — read_to_string 은 UTF-8 이 아닌 바이트가 하나라도 있으면 매번 실패해 감시가 영영 멈춘다
        let read = |f: &std::path::Path| std::fs::read(f).map(|b| String::from_utf8_lossy(&b).into_owned());
        let mut offset = read(&file).map(|s| s.len()).unwrap_or(0);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(700));
            let Ok(content) = read(&file) else { continue };
            if content.len() == offset {
                continue;
            }
            let (paths, next) = new_paths(&content, offset);
            offset = next;
            if !paths.is_empty() {
                let a = app.clone();
                if CHAT_VIEW.load(std::sync::atomic::Ordering::Relaxed) {
                    // 채팅 뷰: 스페이스가 띄운다 — 창만 앞으로
                    let _ = app.run_on_main_thread(move || if let Some(w) = a.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); });
                } else {
                    let _ = app.run_on_main_thread(move || open(&a, paths));
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn tree_skips_hidden_and_heavy() {
        assert!(super::skip_entry(".git") && super::skip_entry("node_modules") && super::skip_entry("target"));
        assert!(!super::skip_entry("docs") && !super::skip_entry("src"));
    }
    #[test]
    fn page_names_are_safe_and_unique() {
        assert_eq!(super::page_file_name("이번 주 생각", |_| false), "이번 주 생각.md");
        assert_eq!(super::page_file_name("a/b:c", |_| false), "a-b-c.md");
        assert_eq!(super::page_file_name("메모", |n| n == "메모.md" || n == "메모 2.md"), "메모 3.md");
    }
    #[test]
    fn esc_bridge_appended_to_html() {
        let out = String::from_utf8(super::with_esc_bridge(b"<html><body>hi</body></html>")).unwrap();
        assert!(out.starts_with("<html><body>hi</body></html>"));
        assert!(out.contains("postMessage({hodoc:'esc'}"));
        assert!(out.contains("hodocZoom"));
    }
    #[test]
    fn 그림_저장_이름은_시각_원래이름_경로는_뺀다() {
        assert_eq!(super::asset_name("스크린샷 1.png", 42), "42-스크린샷_1.png");
        assert_eq!(super::asset_name("../../etc/passwd", 7), "7-passwd");
        assert_eq!(super::asset_name("", 7), "7-image.png");
    }

    #[test]
    fn 고칠_수_있는_건_md_txt_만() {
        assert!(super::editable(std::path::Path::new("/h/a.md")));
        assert!(super::editable(std::path::Path::new("/h/a.TXT")));
        assert!(!super::editable(std::path::Path::new("/h/a.html")));
        assert!(!super::editable(std::path::Path::new("/h/a")));
    }

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
        assert_eq!(mime_of(Path::new("/a/v1.MP4")), "video/mp4");
        assert_eq!(mime_of(Path::new("/a/v1.mov")), "video/quicktime");
        assert_eq!(mime_of(Path::new("/a/v1.webm")), "video/webm");
    }

    // 영상은 WebKit 이 Range 로 조각씩 달라고 한다 — 206 으로 그 조각만 줘야 재생·탐색이 된다
    #[test]
    fn byte_range() {
        assert_eq!(range_of("bytes=0-1", 100), Some((0, 1)));
        assert_eq!(range_of("bytes=10-", 100), Some((10, 99)));
        assert_eq!(range_of("bytes=90-200", 100), Some((90, 99)));
        assert_eq!(range_of("bytes=-10", 100), Some((90, 99)));
        assert_eq!(range_of("bytes=100-", 100), None);
        assert_eq!(range_of("bytes=5-2", 100), None);
        assert_eq!(range_of("items=0-1", 100), None);
        assert_eq!(range_of("bytes=0-1", 0), None);
    }

    #[test]
    fn trash_names_dont_overwrite() {
        // 휴지통에 같은 이름이 있으면 번호를 붙인다(덮어쓰지 않는다)
        let t = Path::new("/T");
        assert_eq!(trash_dest(t, "새 페이지.md", |_| false), Path::new("/T/새 페이지.md"));
        assert_eq!(trash_dest(t, "새 페이지.md", |p| p == Path::new("/T/새 페이지.md")), Path::new("/T/새 페이지 2.md"));
        assert_eq!(trash_dest(t, "새 페이지", |p| p == Path::new("/T/새 페이지") || p == Path::new("/T/새 페이지 2")), Path::new("/T/새 페이지 3"));
    }

    #[test]
    fn curation_file_names() {
        assert_eq!(curation_name("/h/docs/design-drafts/space/v12.html", "md"), "space-v12.md");
        assert_eq!(curation_name("/h/docs/design-drafts/space/v12.html", "state.json"), "space-v12.state.json");
        assert_eq!(curation_name("v1.html", "md"), "v1.md");
    }

    #[test]
    fn page_doc_paths() {
        // 같은 이름의 다른 폴더 파일은 다른 자리, 같은 파일은 늘 같은 자리
        let d = Path::new("/c");
        assert_ne!(page_doc_dir(d, Path::new("/h/a/발표.pptx")), page_doc_dir(d, Path::new("/h/b/발표.pptx")));
        assert_eq!(page_doc_dir(d, Path::new("/h/a/발표.pptx")), page_doc_dir(d, Path::new("/h/a/발표.pptx")));
        // 본문은 Preview.html, 없으면 PDF
        let v = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(page_doc_main(&v(&["Attachment1.png", "Preview.html", "Attachment2.pdf"])).as_deref(), Some("Preview.html"));
        assert_eq!(page_doc_main(&v(&["Preview.pdf", "PreviewProperties.plist"])).as_deref(), Some("Preview.pdf"));
        assert!(page_doc_main(&v(&["PreviewProperties.plist"])).is_none());
    }

    #[test]
    fn serve_range_206() {
        let body: Vec<u8> = (0..100u8).collect();
        let r = respond(&body, "video/mp4", Some("bytes=10-19"));
        assert_eq!(r.status(), 206);
        assert_eq!(r.headers()["Content-Range"], "bytes 10-19/100");
        assert_eq!(r.body().as_slice(), &body[10..20]);
        let full = respond(&body, "video/mp4", None);
        assert_eq!((full.status().as_u16(), full.body().len()), (200, 100));
        assert_eq!(full.headers()["Accept-Ranges"], "bytes");
        assert_eq!(respond(&body, "video/mp4", Some("bytes=200-")).status(), 416);
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
