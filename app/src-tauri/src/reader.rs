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

/// hodoc 이 내줄 파일 — 홈 안 파일, 그리고 데이터 폴더가 홈 밖이어도 avatars/ 안 그림(프사)
pub fn served_path(url_path: &str, home: &Path, avatars: &Path) -> Option<PathBuf> {
    safe_path(url_path, home).or_else(|| {
        let p = safe_path(url_path, avatars)?; // 링크·../ 를 푼 진짜 자리가 avatars 안
        mime_of(&p).starts_with("image/").then_some(p)
    })
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

/// 파일 내용 → 응답(통째). 조각 요청(Range)은 part_response 가 파일에서 그 조각만 읽는다
pub fn respond(body: &[u8], mime: &str) -> Response<Vec<u8>> {
    Response::builder().header("Content-Type", mime).header("Cache-Control", "no-store").header("Accept-Ranges", "bytes").body(body.to_vec()).unwrap()
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

/// 시안(HTML)은 앱과 다른 불투명 출처에서 돈다(2026-10-06, 폰 html_page 와 같은 원칙) — 같은 출처(hodoc://localhost)를 주면
/// 시안 스크립트가 fetch('hodoc://localhost/<홈 아무 파일>')로 비밀 파일을 읽고 밖으로 보낼 수 있었다(실측: 시험 비밀 파일 200).
/// iframe 이 allow-same-origin 을 달아도 이 머리글의 sandbox 가 이긴다. 스크립트·확인 창(confirm)은 돌고, 옆 파일(그림·css·js)과
/// 웹 글꼴·라이브러리는 불리되, 밖으로 보내기(fetch·XHR·폼)·팝업·위 창 옮기기는 막는다
pub const DOC_CSP: &str = "sandbox allow-scripts allow-modals; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' hodoc: http://hodoc.localhost https:; style-src 'unsafe-inline' hodoc: http://hodoc.localhost https:; img-src hodoc: http://hodoc.localhost https: data: blob:; font-src hodoc: http://hodoc.localhost https: data:; media-src hodoc: http://hodoc.localhost https: data: blob:; frame-src hodoc: http://hodoc.localhost; connect-src 'none'; form-action 'none'; base-uri 'none'";

/// 불투명 출처에선 localStorage·sessionStorage 가 예외를 던진다 — 시안 스크립트보다 먼저 메모리 저장소를 끼운다.
/// 이 칸(iframe) 안 새로 고침(검토 틀 '초기화')에도 남게 window.name 에 이어 쓴다. 칸을 새로 열면 비고, 표시는 앱이 cur-state 로 받아
/// curation/ 파일에 적었다가 restore 로 되돌린다(HtmlFrame)
pub const MEM_STORAGE: &str = r#"<script>(function(){var K='__chammoMem:',all={};try{if(window.name.indexOf(K)===0)all=JSON.parse(window.name.slice(K.length))||{}}catch(e){all={}}
function save(){try{window.name=K+JSON.stringify(all)}catch(e){}}
function mk(n){var m=all[n]&&typeof all[n]==='object'?all[n]:(all[n]={}),h=Object.prototype.hasOwnProperty,s={getItem:function(k){k=String(k);return h.call(m,k)?m[k]:null},setItem:function(k,v){m[String(k)]=String(v);save()},removeItem:function(k){delete m[String(k)];save()},clear:function(){for(var k in m)if(h.call(m,k))delete m[k];save()},key:function(i){var ks=Object.keys(m);return i>=0&&i<ks.length?ks[i]:null}};Object.defineProperty(s,'length',{get:function(){return Object.keys(m).length}});return s}
[['localStorage','local'],['sessionStorage','session']].forEach(function(p){try{window[p[0]].length}catch(e){try{Object.defineProperty(window,p[0],{value:mk(p[1]),configurable:true})}catch(_){}}})})()</script>"#;

/// `<name ...>` 여는 태그 끝 다음 자리 — `<head` 로 `<header>` 를 잡지 않게 이름 뒤 글자를 본다. 바이트로 봐서 UTF-8 이 아닌 시안도 안 깨진다
pub(crate) fn tag_end(low: &[u8], name: &str) -> Option<usize> {
    let open = format!("<{name}");
    let open = open.as_bytes();
    let mut from = 0;
    while let Some(i) = low.get(from..)?.windows(open.len()).position(|w| w == open).map(|i| from + i) {
        let after = i + open.len();
        if low.get(after).is_some_and(|c| *c == b'>' || *c == b'/' || c.is_ascii_whitespace()) {
            return low[after..].iter().position(|c| *c == b'>').map(|j| after + j + 1);
        }
        from = after;
    }
    None
}

/// HTML 에 앱 몫을 끼운다 — 앞(<head> 바로 뒤, 없으면 <html>·doctype 뒤, 다 없으면 맨 앞)에 메모리 저장소, 끝에 Esc·확대 다리
fn with_doc_shims(body: &[u8]) -> Vec<u8> {
    let low = body.to_ascii_lowercase();
    let at = tag_end(&low, "head").or_else(|| tag_end(&low, "html")).or_else(|| tag_end(&low, "!doctype")).unwrap_or(0);
    let mut out = Vec::with_capacity(body.len() + MEM_STORAGE.len() + ESC_BRIDGE.len());
    out.extend_from_slice(&body[..at]);
    out.extend_from_slice(MEM_STORAGE.as_bytes());
    out.extend_from_slice(&with_esc_bridge(&body[at..]));
    out
}

/// hodoc 응답 — HTML 은 샌드박스·끼움, 글꼴은 불투명 출처 시안이 읽게 CORS 를 연다(글·JSON 같은 건 안 연다)
pub fn doc_response(body: Vec<u8>, mime: &str) -> Response<Vec<u8>> {
    let r = if mime.starts_with("text/html") { respond(&with_doc_shims(&body), mime) } else { respond(&body, mime) };
    doc_headers(r, mime)
}

fn doc_headers(mut r: Response<Vec<u8>>, mime: &str) -> Response<Vec<u8>> {
    let h = r.headers_mut();
    if mime.starts_with("text/html") {
        h.insert("Content-Security-Policy", tauri::http::HeaderValue::from_static(DOC_CSP));
    } else if mime.starts_with("font/") {
        h.insert("Access-Control-Allow-Origin", tauri::http::HeaderValue::from_static("*"));
    }
    r
}

/// 조각 요청 한 번에 읽는 상한 — bytes=0- 처럼 끝이 열린 요청도 이만큼만(WebKit 은 이어서 다시 묻는다). 맥 안이라 폰(1MB)보다 크게
const READER_CHUNK: u64 = 8 * 1024 * 1024;

/// Range 요청 — 파일 전체를 읽지 않고 seek 로 그 조각만(1GB 넘는 녹화도 조각마다 통째로 읽던 것, 2026-09-29 검증 에이전트)
fn part_response(path: &Path, mime: &str, range: &str) -> std::io::Result<Response<Vec<u8>>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path)?;
    let total = f.metadata()?.len();
    let base = || Response::builder().header("Content-Type", mime).header("Cache-Control", "no-store").header("Accept-Ranges", "bytes");
    let Some((a, b)) = crate::mobile_files::parse_range(Some(range), total, READER_CHUNK) else {
        return Ok(doc_headers(base().status(416).header("Content-Range", format!("bytes */{total}")).body(Vec::new()).unwrap(), mime));
    };
    f.seek(SeekFrom::Start(a))?;
    let mut buf = Vec::with_capacity((b - a + 1) as usize);
    f.take(b - a + 1).read_to_end(&mut buf)?;
    if buf.is_empty() {
        return Ok(doc_headers(base().status(416).header("Content-Range", format!("bytes */{total}")).body(Vec::new()).unwrap(), mime));
    }
    let b = a + buf.len() as u64 - 1; // 그사이 파일이 줄었으면 읽은 만큼만
    Ok(doc_headers(base().status(206).header("Content-Range", format!("bytes {a}-{b}/{total}")).body(buf).unwrap(), mime))
}

/// hodoc:// 요청 처리
pub fn serve<R: Runtime>(_ctx: tauri::UriSchemeContext<'_, R>, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let not_found = || Response::builder().status(404).header("Content-Type", "text/plain; charset=utf-8").body(tr("없는 파일이거나 홈 폴더 밖이야", "File not found or outside the home folder").as_bytes().to_vec()).unwrap();
    let Some(path) = served_path(req.uri().path(), &home(), &crate::config::data_file("avatars")) else { return not_found() };
    if let Some(range) = req.headers().get("range").and_then(|v| v.to_str().ok()) {
        return part_response(&path, mime_of(&path), range).unwrap_or_else(|_| not_found());
    }
    match std::fs::read(&path) {
        Ok(body) => doc_response(body, mime_of(&path)),
        Err(_) => not_found(),
    }
}

/// 리더 패널에 탭으로 연다 — 메인 창을 앞으로, 패널이 닫혀 있으면 연다
pub fn open<R: Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    // http(s) 주소는 그대로(주소 미리보기 — webpage.rs), 파일은 홈 폴더 안만
    let ok: Vec<String> = paths.into_iter()
        .filter_map(|p| if crate::webpage::parse_web_url(&p).is_some() { Some(p) } else { safe_path(&p, &home()).map(|p| p.to_string_lossy().into_owned()) })
        .collect();
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
    read_utf8(&p)
}

/// 글이 UTF-8 이 아니다(밖에서 EUC-KR 등으로 저장) — 앞쪽(docSync)이 이 글로 알아보고 '못 읽음' 띠를 띄운다
pub const NOT_UTF8: &str = "NOT_UTF8";

fn read_utf8(p: &Path) -> Result<String, String> {
    std::fs::read_to_string(p).map_err(|e| if e.kind() == std::io::ErrorKind::InvalidData { NOT_UTF8.into() } else { e.to_string() })
}

/// 편집기가 알던 판과 지금 파일이 달라 저장하지 않았다 — 앞쪽(SpaceEditor)이 이 글로 알아보고 바깥 판을 합친다
pub const CHANGED_OUTSIDE: &str = "CHANGED_OUTSIDE";

/// 파일 도장(바뀐 시각 나노초:크기) — 열어 둔 문서를 밖이 고쳤나 가볍게 본다(글을 통째로 읽지 않게). 없으면 None
pub fn stamp_of(p: &Path) -> Option<String> {
    let m = std::fs::metadata(p).ok()?;
    let t = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
    Some(format!("{t}:{}", m.len()))
}

/// 열어 둔 문서의 도장 — 지워졌거나 이름이 바뀌었으면 오류
#[tauri::command]
pub fn doc_stamp(path: String) -> Result<String, String> {
    let p = safe_path(&path, &home()).ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    stamp_of(&p).ok_or_else(|| tr("파일을 못 읽었어", "Could not read the file").into())
}

/// 알던 판(expected)이 지금 파일과 같을 때만 쓴다 — 다르면 CHANGED_OUTSIDE(밖에서 고친 줄을 덮지 않게, 2026-10-04 QA D1).
/// 없는 파일은 다시 만들지 않는다(지워졌거나 이름이 바뀐 것). 임시 파일에 쓰고 바꿔 끼운다(쓰다 멈춰도 원본이 안 깨지게)
fn write_checked(p: &Path, text: &str, expected: Option<&str>, keep: impl Fn(&Path)) -> Result<String, String> {
    let now = std::fs::read(p).map_err(|e| e.to_string())?;
    if expected.is_some_and(|x| x.as_bytes() != now.as_slice()) {
        return Err(CHANGED_OUTSIDE.into());
    }
    keep(p);
    let tmp = p.with_extension("chammo-tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, p).map_err(|e| e.to_string())?;
    stamp_of(p).ok_or_else(|| tr("파일을 못 읽었어", "Could not read the file").into())
}

/// 스페이스(리더 편집)에서 고친 md 저장 — 홈 안 이미 있는 md·txt 만. expected = 편집기가 마지막으로 본 파일 글(없으면 확인 없이).
/// 돌려주는 값 = 쓴 뒤 파일 도장
#[tauri::command]
pub fn write_doc_text(path: String, text: String, expected: Option<String>) -> Result<String, String> {
    let p = safe_path(&path, &home()).ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    if !editable(&p) {
        return Err(tr("마크다운·글 파일만 고칠 수 있어", "Only Markdown and text files can be edited").into());
    }
    write_checked(&p, &text, expected.as_deref(), keep_history)
}

/// 충돌에서 진 판을 history 에 남긴다 — tag "outside" = '내 판으로 저장' 으로 덮일 바깥 판(초까지 이름에 — 덮기 전 판 남기기는
/// 분마다 첫 판 하나라 같은 분에 앞서 저장했으면 바깥 판이 빠졌다, 2026-10-04 실측), 그 밖 = 내 판(바깥 판 불러오기·파일이 없어져 못 씀)
#[tauri::command]
pub fn keep_doc_version(path: String, text: String, tag: Option<String>) -> Result<(), String> {
    // 파일이 지워졌거나 이름이 바뀐 뒤에도 남겨야 한다 — 그땐 폴더로 홈 안인지 보고 이름을 붙인다
    let p = safe_path(&path, &home())
        .or_else(|| {
            let q = Path::new(&path);
            Some(safe_path(q.parent()?.to_str()?, &home())?.join(q.file_name()?))
        })
        .ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    let dir = history_dir(&p).ok_or(tr("history 폴더를 못 만들었어", "Could not create the history folder"))?;
    // 분마다 한 장(같은 분이면 새 판으로 덮는다 — 파일이 없는 동안 칠 때마다 쌓이지 않게). 이름은 keep_history 와 같은 분 단위로 시작해
    // 오래된 것부터 지우는 정렬(이름 순)에서 제자리에 선다
    std::fs::write(dir.join(history_name(tag.as_deref(), std::time::SystemTime::now())), text).map_err(|e| e.to_string())?;
    trim_history(&dir);
    Ok(())
}

/// 진 판 이름 — 바깥 판은 초까지(하나도 빠지지 않게), 내 판은 분마다 한 장(파일이 없는 동안 칠 때마다 쌓이지 않게)
fn history_name(tag: Option<&str>, at: std::time::SystemTime) -> String {
    let secs = at.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    match tag {
        Some("outside") => format!("{}-outside-{:02}.md", secs / 60, secs % 60),
        _ => format!("{}-mine.md", secs / 60),
    }
}

fn now_minute() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() / 60).unwrap_or(0)
}

/// 파일마다 최근 50개만
fn trim_history(dir: &Path) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        let mut v: Vec<_> = rd.flatten().map(|e| e.path()).collect();
        v.sort();
        let extra = v.len().saturating_sub(50);
        for x in v.into_iter().take(extra) { let _ = std::fs::remove_file(x); }
    }
}

fn history_dir(p: &Path) -> Option<PathBuf> {
    let key: String = p.to_string_lossy().chars().map(|c| if c.is_alphanumeric() || c == '.' || c == '-' { c } else { '_' }).collect();
    let dir = crate::config::data_file("history").join(key);
    std::fs::create_dir_all(&dir).ok().map(|_| dir)
}

/// 고치기 전 판을 앱 데이터 폴더/history/<파일>/ 에 남긴다(파일마다 최근 50개) — 편집기에서 한 번에 지워진 게 저장돼
/// 페이지가 날아간 적이 있다(2026-09-30 사용자). 같은 분 안에서는 한 번만(타자마다 쌓이지 않게)
fn keep_history(p: &Path) {
    let Ok(old) = std::fs::read(p) else { return };
    let Some(dir) = history_dir(p) else { return };
    let file = dir.join(format!("{}.md", now_minute()));
    if !file.exists() { let _ = std::fs::write(&file, old); }
    trim_history(&dir);
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
/// 썸네일 폴더 — 원본 전체 경로마다 따로(<ql>/<경로 FNV-1a 해시>). 파일 이름으로만 두면 다른 폴더의
/// 같은 이름(v2.html 등)이 서로의 썸네일을 받아 갔다(2026-10-02 사용자: 대시보드 카드와 연 파일이 다름)
fn ql_dir(base: &std::path::Path, p: &std::path::Path) -> std::path::PathBuf {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in p.to_string_lossy().as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    base.join(format!("{h:016x}"))
}

#[tauri::command]
pub async fn ql_thumb(path: String) -> Result<String, String> {
    if !cfg!(target_os = "macos") {
        return Err(mac_only_preview());
    }
    let p = safe_path(&path, &home()).ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = ql_dir(&crate::config::data_file("ql"), &p);
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

/// scripts/show 기록 꼬리(최근 1MB 를 세션별로 공평하게 64KB — fair_tail) — 채팅 뷰 스페이스가 세션마다 보여 준 파일을 모은다. 파싱은 domain/spaceNav.
/// 닫힌 워크트리 안 경로는 본 폴더 자리로 풀고, 못 찾은 줄엔 gone 을 단다(mobile_files::resolve_show_log — 폰도 이 함수로 읽는다)
#[tauri::command]
pub fn read_show_log() -> String {
    let h = home();
    crate::mobile_files::resolve_show_log(&read_show_tail(), &std::fs::canonicalize(&h).unwrap_or(h))
}

/// 스페이스 고정 문서 중 닫힌 워크트리에서 옮겨 간 것 (옛 경로 → 새 경로) — show 기록과 같은 풀기(mobile_files::moved_from_worktree)
#[tauri::command]
pub fn moved_paths(paths: Vec<String>) -> std::collections::BTreeMap<String, String> {
    let h = home();
    crate::mobile_files::moved_map(&paths, &std::fs::canonicalize(&h).unwrap_or(h))
}

/// 기록에서 넘길 양 — 폰은 바뀌었을 때만 통째로 받는다(/api/shows?since=, 2026-10-09), 늘리면 그때 LTE 로 그만큼 더 받는다
const SHOW_KEEP: usize = 64 * 1024;
/// 공평 나누기로 훑는 양 — 조용한 참모의 옛 줄을 여기까지 거슬러 찾는다
const SHOW_SCAN: u64 = 1024 * 1024;

/// 기록 꼬리를 보여 준 세션(from)별로 공평하게 keep 바이트 안에 — 적게 보여 준 세션은 다 남기고, 많이 띄운 세션만 옛것부터 깎는다(가장 작은 몫을 가장 크게).
/// 그냥 끝 64KB 만 읽었더니 하위 세션이 그림을 잔뜩 띄우면 참모의 옛 카드가 밀려 사라졌다(2026-10-08 채팅 파일 카드 남은 것 ①). 줄 순서는 그대로, from 없는 옛 줄은 한 묶음
pub fn fair_tail(log: &str, keep: usize) -> String {
    if log.len() <= keep {
        return log.to_string();
    }
    let lines: Vec<&str> = log.split_inclusive('\n').collect();
    let from_of = |l: &str| serde_json::from_str::<serde_json::Value>(l).ok().and_then(|v| v["from"].as_str().map(str::to_string)).unwrap_or_default();
    let froms: Vec<String> = lines.iter().map(|l| from_of(l)).collect();
    let mut size: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for (l, f) in lines.iter().zip(&froms) {
        *size.entry(f.as_str()).or_default() += l.len();
    }
    // 몫 — 작은 묶음부터 다 주고, 남은 양을 큰 묶음들이 똑같이 나눈다
    let mut sizes: Vec<usize> = size.values().copied().collect();
    sizes.sort_unstable();
    let (mut left, mut cap) = (keep, usize::MAX);
    for (i, s) in sizes.iter().enumerate() {
        let share = left / (sizes.len() - i);
        if *s > share {
            cap = share;
            break;
        }
        left -= s;
    }
    // 묶음마다 끝에서부터 몫만큼 — 줄 하나라도 몫을 넘으면 거기서 멈춘다(이어진 꼬리만)
    let mut used: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    let mut full: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut take = vec![false; lines.len()];
    for i in (0..lines.len()).rev() {
        let f = froms[i].as_str();
        if full.contains(f) {
            continue;
        }
        let u = used.entry(f).or_default();
        if *u + lines[i].len() > cap {
            full.insert(f);
            continue;
        }
        *u += lines[i].len();
        take[i] = true;
    }
    lines.iter().zip(take).filter(|(_, t)| *t).map(|(l, _)| *l).collect()
}

fn read_show_tail() -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(crate::config::data_file("show.jsonl")) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let from = len.saturating_sub(SHOW_SCAN);
    let _ = f.seek(SeekFrom::Start(from));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    // 중간부터 읽었으면 잘린 첫 줄은 버린다
    let text = if from > 0 { text.split_once('\n').map(|(_, r)| r).unwrap_or("") } else { &text };
    fair_tail(text, SHOW_KEEP)
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

/// 스페이스 문서 편집기에 파인더에서 끌어다 놓은 파일(그림·영상·PDF 등) — 문서 옆 assets/ 로 복사하고 md 에 넣을 상대 경로를 돌려준다.
/// 앱 창이 파일 끌기를 먼저 가로채서 편집기(BlockNote)가 못 받았다(2026-10-01 사용자)
#[tauri::command]
pub fn copy_asset(doc_path: String, src: String) -> Result<String, String> {
    let doc = safe_path(&doc_path, &home()).ok_or(tr("홈 폴더 밖이거나 없는 파일", "Outside the home folder or file not found"))?;
    copy_asset_into(&doc, Path::new(&src), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0))
}

/// 파일 하나 복사(폴더는 거절) — 이름은 asset_name(시각-원래이름)
pub fn copy_asset_into(doc: &Path, src: &Path, ms: u128) -> Result<String, String> {
    if !src.is_file() {
        return Err(tr("파일이 아니에요", "Not a file").into());
    }
    let dir = doc.parent().ok_or("no parent")?.join("assets");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = asset_name(&src.file_name().and_then(|n| n.to_str()).unwrap_or("image.png"), ms);
    std::fs::copy(src, dir.join(&file)).map_err(|e| e.to_string())?;
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
mod ql_dir_tests {
    #[test]
    fn 이름이_같아도_경로가_다르면_썸네일_폴더가_다르다() {
        let base = std::path::Path::new("/d/ql");
        let a = super::ql_dir(base, std::path::Path::new("/h/a/avatar/v2.html"));
        let b = super::ql_dir(base, std::path::Path::new("/h/b/oms-first-mail/v2.html"));
        assert_ne!(a, b);
        assert_eq!(a, super::ql_dir(base, std::path::Path::new("/h/a/avatar/v2.html")));
        assert!(a.starts_with(base));
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn 데이터_폴더가_홈_밖이어도_프사_그림만은_hodoc_으로_준다() {
        // $CHAMMO_HOME 이 홈 밖이면 그림 프사가 기본 도형으로 떨어졌다(2026-10-02 남은 것 ①). 연 건 avatars/ 안 그림뿐
        let root = std::env::temp_dir().join(format!("hodoc-avatar-{}", std::process::id()));
        let (home, data) = (root.join("home"), root.join("data"));
        let av = data.join("avatars");
        std::fs::create_dir_all(&av).unwrap();
        std::fs::create_dir_all(&home).unwrap();
        for (f, b) in [(av.join("참모.png"), "png"), (av.join("참모.json"), "{}"), (data.join("config.json"), "{}"), (home.join("a.md"), "# a")] {
            std::fs::write(f, b).unwrap();
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(data.join("config.json"), av.join("몰래.png")).unwrap();
        let url = |p: &std::path::Path| p.to_string_lossy().into_owned();
        let got = |p: &std::path::Path| super::served_path(&url(p), &home, &av).is_some();
        assert!(got(&av.join("참모.png")), "홈 밖 데이터 폴더의 프사 그림");
        assert!(got(&home.join("a.md")), "홈 안 파일은 그대로");
        assert!(!got(&av.join("참모.json")), "avatars 안이라도 그림만");
        assert!(!got(&data.join("config.json")), "데이터 폴더 나머지는 막는다");
        assert!(!got(&av.join("../config.json")), "../ 로 빠져나가기");
        #[cfg(unix)]
        assert!(!got(&av.join("몰래.png")), "그림 이름의 링크로 빠져나가기");
        let _ = std::fs::remove_dir_all(&root);
    }

    fn show_line(from: &str, n: usize) -> String {
        format!("{{\"ts\": \"2026-10-0{}T01:00:00+00:00\", \"path\": \"/Users/me/p/{from}-{n:04}.png\", \"from\": \"{from}\"}}\n", 1 + n % 8)
    }

    #[test]
    fn 기록_꼬리는_참모별로_공평하게_나눠_조용한_참모_카드가_안_밀려난다() {
        // 참모 a 가 일찍 보여 준 파일 3개 → 뒤에 하위 세션 b 가 그림을 잔뜩(꼬리 크기의 몇 배) 띄웠다.
        // 예전엔 꼬리 64KB 만 읽어 a 의 카드가 밀려 사라졌다(2026-10-08 남은 것 ①)
        let mut log = String::new();
        for n in 0..3 { log += &show_line("aaaa0002", n); }
        for n in 0..2000 { log += &show_line("bbbb0009", n); }
        log += &show_line("aaaa0002", 3);
        let keep = 16 * 1024;
        let out = super::fair_tail(&log, keep);
        assert!(out.len() <= keep, "{}", out.len());
        for n in 0..4 { assert!(out.contains(&format!("aaaa0002-{n:04}")), "a 의 {n} 번째가 빠졌다"); }
        // 많이 띄운 쪽은 최근 것을 남기고 옛것부터 깎는다, 순서는 그대로
        assert!(out.contains("bbbb0009-1999") && !out.contains("bbbb0009-0000"));
        let b: Vec<usize> = out.lines().filter_map(|l| l.split("bbbb0009-").nth(1)).map(|t| t[..4].parse().unwrap()).collect();
        assert!(b.windows(2).all(|w| w[0] + 1 == w[1]), "b 는 뒤쪽 이어진 꼬리만");
        assert!(out.find("aaaa0002-0002").unwrap() < out.find("bbbb0009-1999").unwrap() && out.ends_with(&show_line("aaaa0002", 3)));
    }

    /// 실측 — 1MB 기록(세션 40개) 공평 나누기 시간(폰 /api/file 마다 허용 목록을 다시 읽는다). cargo test … -- --ignored --exact reader::tests::실측_공평_나누기_시간 --nocapture
    #[test]
    #[ignore]
    fn 실측_공평_나누기_시간() {
        let mut log = String::new();
        let mut n = 0;
        while log.len() < 1024 * 1024 { log += &show_line(&format!("cafe{:04}", n % 40), n); n += 1; }
        let t = std::time::Instant::now();
        let out = super::fair_tail(&log, 64 * 1024);
        eprintln!("fair_tail {} 줄 {} 바이트 → {} 바이트 in {:?}", n, log.len(), out.len(), t.elapsed());
        // SHOW_PROBE=<show.jsonl 복사본> — 세션별로 남는 줄 수: 끝 64KB 와 비교
        let Ok(p) = std::env::var("SHOW_PROBE") else { return };
        let real = std::fs::read_to_string(p).unwrap();
        let count = |t: &str| {
            let mut m = std::collections::BTreeMap::<String, usize>::new();
            for l in t.lines() {
                let f = serde_json::from_str::<serde_json::Value>(l).ok().and_then(|v| v["from"].as_str().map(str::to_string)).unwrap_or("-".into());
                *m.entry(f).or_default() += 1;
            }
            m
        };
        let cut = real.len().saturating_sub(64 * 1024);
        let plain = real[cut..].split_once('\n').map(|(_, r)| r).unwrap_or("");
        let (all, a, b) = (count(&real), count(plain), count(&super::fair_tail(&real, 64 * 1024)));
        for (k, v) in &all {
            eprintln!("{k}: 전체 {v} · 끝 64KB {} · 공평 {}", a.get(k).unwrap_or(&0), b.get(k).unwrap_or(&0));
        }
    }

    #[test]
    fn 기록이_꼬리보다_작으면_그대로_큰_쪽끼리는_고르게() {
        let small: String = (0..5).map(|n| show_line("aaaa0002", n)).collect();
        assert_eq!(super::fair_tail(&small, 64 * 1024), small);
        // 둘 다 크면 반씩쯤 — 한쪽이 다 차지하지 않는다
        let mut log = String::new();
        for n in 0..500 { log += &show_line("aaaa0002", n); log += &show_line("bbbb0009", n); }
        let out = super::fair_tail(&log, 8 * 1024);
        let (a, b) = (out.matches("aaaa0002-").count(), out.matches("bbbb0009-").count());
        assert!(a > 0 && b > 0 && a.abs_diff(b) <= 1, "{a} {b}");
        // from 없는 옛 줄도 한 묶음으로
        let mut old = show_line("aaaa0002", 1);
        for n in 0..300 { old += &format!("{{\"ts\": \"2026-09-27T16:13:24+00:00\", \"path\": \"/x/{n}.md\"}}\n"); }
        assert!(super::fair_tail(&old, 2048).contains("aaaa0002-0001"));
    }

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
    fn 시안_html_은_불투명_출처_샌드박스로_낸다() {
        let r = super::doc_response(b"<!doctype html><html><head><title>t</title><script>localStorage.x=1</script></head><body>hi</body></html>".to_vec(), "text/html; charset=utf-8");
        let csp = r.headers()["Content-Security-Policy"].to_str().unwrap();
        // 같은 출처를 주지 않는다 — 앱 출처·hodoc 의 홈 파일 읽기(fetch)에 못 닿게, 밖으로 보내기도 막는다
        assert!(csp.starts_with("sandbox allow-scripts allow-modals;"), "{csp}");
        assert!(!csp.contains("allow-same-origin") && !csp.contains("allow-popups") && !csp.contains("allow-top-navigation"), "{csp}");
        assert!(csp.contains("connect-src 'none'") && csp.contains("form-action 'none'"), "{csp}");
        // 옆 파일(그림·스크립트·css)과 웹 글꼴은 그대로 불린다
        assert!(csp.contains("img-src hodoc: http://hodoc.localhost https: data: blob:"), "{csp}");
        assert!(csp.contains("frame-src hodoc: http://hodoc.localhost"), "{csp}");
        let body = String::from_utf8(r.body().clone()).unwrap();
        let shim = body.find("__chammoMem").expect("메모리 저장소");
        assert!(body.find("<head>").unwrap() < shim && shim < body.find("<title>").unwrap(), "head 바로 뒤, 시안 스크립트보다 먼저");
        assert!(body.ends_with("</script>") && body.contains("postMessage({hodoc:'esc'}"), "Esc·확대 다리는 그대로 끝에");
    }
    #[test]
    fn head_없는_html_도_맨_앞쪽에_끼운다() {
        let r = super::doc_response(b"<p>bare</p><script>1</script>".to_vec(), "text/html; charset=utf-8");
        let body = String::from_utf8(r.body().clone()).unwrap();
        assert!(body.starts_with("<script>") && body.find("__chammoMem").unwrap() < body.find("<p>bare").unwrap());
    }
    #[test]
    fn html_아닌_파일은_그대로_글꼴만_다른_출처에_연다() {
        let png = super::doc_response(vec![1, 2, 3], "image/png");
        assert!(png.headers().get("Content-Security-Policy").is_none() && png.headers().get("Access-Control-Allow-Origin").is_none());
        assert_eq!(png.body().as_slice(), &[1, 2, 3]);
        // 불투명 출처 시안이 옆 글꼴(@font-face)을 읽으려면 CORS 가 필요하다 — 글꼴만(글·JSON 은 안 연다)
        assert_eq!(super::doc_response(vec![0], "font/woff2").headers()["Access-Control-Allow-Origin"], "*");
        assert!(super::doc_response(vec![0], "text/plain; charset=utf-8").headers().get("Access-Control-Allow-Origin").is_none());
        assert!(super::doc_response(vec![0], "application/json; charset=utf-8").headers().get("Access-Control-Allow-Origin").is_none());
    }
    #[test]
    fn 메모리_저장소는_window_name_에_이어_쓴다() {
        // 시안이 스스로 새로 고침(초기화)해도 이 칸 안에선 표시가 남고, 지운 건 지운 채로 — 칸(iframe)을 새로 만들면 앱이 파일로 되돌린다
        assert!(super::MEM_STORAGE.contains("window.name") && super::MEM_STORAGE.contains("sessionStorage") && super::MEM_STORAGE.contains("localStorage"));
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
    fn 끌어다_놓은_파일은_문서_옆_assets_로_복사() {
        let root = std::env::temp_dir().join(format!("chammo-asset-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("pages")).unwrap();
        let doc = root.join("pages/메모.md");
        std::fs::write(&doc, "# 메모").unwrap();
        let src = root.join("스크린샷 1.PNG");
        std::fs::write(&src, b"png-bytes").unwrap();
        let rel = super::copy_asset_into(&doc, &src, 42).unwrap();
        assert_eq!(rel, "assets/42-스크린샷_1.PNG");
        assert_eq!(std::fs::read(root.join("pages").join(&rel)).unwrap(), b"png-bytes");
        // 영상·PDF 같은 다른 파일도 복사, 폴더·없는 파일은 거절
        std::fs::write(root.join("보고서.pdf"), b"pdf").unwrap();
        assert_eq!(super::copy_asset_into(&doc, &root.join("보고서.pdf"), 2).unwrap(), "assets/2-보고서.pdf");
        assert!(super::copy_asset_into(&doc, &root.join("pages"), 1).is_err());
        assert!(super::copy_asset_into(&doc, &root.join("없음.png"), 1).is_err());
        let _ = std::fs::remove_dir_all(&root);
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
    fn 조각_요청은_파일에서_그_조각만_읽는다() {
        // 1GB 넘는 녹화도 조각마다 통째로 읽지 않게(2026-09-29 검증 에이전트) — bytes=0- 도 한 번에 READER_CHUNK 까지만
        let d = std::env::temp_dir().join(format!("chammo-reader-part-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("v.mp4");
        let total = super::READER_CHUNK as usize + 10;
        let body: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
        std::fs::write(&f, &body).unwrap();
        let r = super::part_response(&f, "video/mp4", "bytes=10-19").unwrap();
        assert_eq!((r.status().as_u16(), r.body().as_slice()), (206, &body[10..20]));
        assert_eq!(r.headers()["Content-Range"], format!("bytes 10-19/{total}"));
        let open = super::part_response(&f, "video/mp4", "bytes=0-").unwrap();
        assert_eq!((open.status().as_u16(), open.body().len()), (206, super::READER_CHUNK as usize));
        assert_eq!(open.headers()["Content-Range"], format!("bytes 0-{}/{total}", super::READER_CHUNK - 1));
        let tail = super::part_response(&f, "video/mp4", "bytes=-4").unwrap();
        assert_eq!(tail.body().as_slice(), &body[total - 4..]);
        let bad = super::part_response(&f, "video/mp4", "bytes=999999999-").unwrap();
        assert_eq!((bad.status().as_u16(), bad.headers()["Content-Range"].to_str().unwrap().to_string()), (416, format!("bytes */{total}")));
        // html 조각도 샌드박스
        std::fs::write(d.join("a.html"), "<html><script>1</script></html>").unwrap();
        let h = super::part_response(&d.join("a.html"), "text/html; charset=utf-8", "bytes=0-5").unwrap();
        assert!(h.headers()["Content-Security-Policy"].to_str().unwrap().starts_with("sandbox allow-scripts"));
        assert!(super::part_response(&d.join("없음.mp4"), "video/mp4", "bytes=0-1").is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// 실측: READER_BIG=<큰 파일> cargo test reader::tests::range_measure -- --exact --ignored --nocapture
    /// 가운데 1MB 조각 한 번 — 옛 길(파일 통째 읽고 자르기)과 새 길(seek)
    #[test]
    #[ignore]
    fn range_measure() {
        let p = std::path::PathBuf::from(std::env::var("READER_BIG").expect("READER_BIG"));
        let total = std::fs::metadata(&p).unwrap().len();
        let (a, b) = (total / 2, total / 2 + 1024 * 1024 - 1);
        let t = std::time::Instant::now();
        let old = std::fs::read(&p).unwrap()[a as usize..=b as usize].to_vec();
        let old_ms = t.elapsed().as_millis();
        let t = std::time::Instant::now();
        let new = super::part_response(&p, "video/mp4", &format!("bytes={a}-{b}")).unwrap();
        let new_ms = t.elapsed().as_millis();
        assert_eq!(new.body(), &old);
        println!("MEASURE total={total} old_read_all={old_ms}ms new_seek={new_ms}ms chunk={}", new.body().len());
    }

    #[test]
    fn 통째_응답은_조각을_받는다고_알린다() {
        let full = respond(&[1, 2, 3], "video/mp4");
        assert_eq!((full.status().as_u16(), full.body().len()), (200, 3));
        assert_eq!(full.headers()["Accept-Ranges"], "bytes");
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

    // 열어 둔 문서를 밖(참모·세션)이 고친 뒤 편집기가 저장하면 밖에서 고친 줄이 말없이 사라졌다(2026-10-04 QA D1)
    fn doc_dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-doc-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn 재현_밖에서_고친_파일은_편집기가_알던_판이_아니면_덮지_않는다() {
        let d = doc_dir("cas");
        let p = d.join("메모.md");
        std::fs::write(&p, "# 장보기\n\n우유\n").unwrap();
        // 참모가 끝에 한 줄
        std::fs::write(&p, "# 장보기\n\n우유\n\n사과\n").unwrap();
        let kept = std::cell::RefCell::new(0);
        let r = super::write_checked(&p, "# 장보기 메모\n\n우유\n", Some("# 장보기\n\n우유\n"), |_| *kept.borrow_mut() += 1);
        assert_eq!(r, Err(super::CHANGED_OUTSIDE.to_string()));
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "# 장보기\n\n우유\n\n사과\n", "바깥 줄이 그대로");
        assert_eq!(*kept.borrow(), 0, "안 쓰면 이전 판도 안 남긴다");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 알던_판이_맞으면_쓰고_새_도장을_준다() {
        let d = doc_dir("ok");
        let p = d.join("a.md");
        std::fs::write(&p, "옛 글\n").unwrap();
        let kept = std::cell::RefCell::new(0);
        let stamp = super::write_checked(&p, "새 글\n", Some("옛 글\n"), |_| *kept.borrow_mut() += 1).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "새 글\n");
        assert_eq!(*kept.borrow(), 1, "덮기 전 판은 history 로");
        assert_eq!(Some(stamp), super::stamp_of(&p));
        assert!(!d.join("a.chammo-tmp").exists());
        // 알던 판을 안 주면(옛 부르는 쪽) 예전처럼 쓴다
        assert!(super::write_checked(&p, "또\n", None, |_| {}).is_ok());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 재현_utf8_이_아닌_글은_not_utf8_로_알려_띠를_띄운다() {
        // 밖에서 EUC-KR 로 저장하면 읽기가 그냥 실패해 편집기가 띠 없이 저장만 멈췄다
        let d = doc_dir("enc");
        let p = d.join("메모.md");
        std::fs::write(&p, [0xb8u8, 0xde, 0xb8, 0xf0, b'\n']).unwrap(); // '메모' EUC-KR
        assert_eq!(super::read_utf8(&p), Err(super::NOT_UTF8.to_string()));
        std::fs::write(&p, "메모\n").unwrap();
        assert_eq!(super::read_utf8(&p).as_deref(), Ok("메모\n"));
        assert!(super::read_utf8(&d.join("없음.md")).is_err_and(|e| e != super::NOT_UTF8));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 지워지거나_이름이_바뀐_파일은_다시_만들지_않는다() {
        let d = doc_dir("gone");
        let p = d.join("없어짐.md");
        assert!(super::write_checked(&p, "글\n", Some("글\n"), |_| {}).is_err());
        assert!(!p.exists());
        assert_eq!(super::stamp_of(&p), None);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 도장은_내용이_바뀌면_달라진다() {
        let d = doc_dir("stamp");
        let p = d.join("b.md");
        std::fs::write(&p, "하나\n").unwrap();
        let a = super::stamp_of(&p).unwrap();
        std::fs::write(&p, "하나 둘\n").unwrap();
        assert_ne!(super::stamp_of(&p).unwrap(), a);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn history_는_최근_50개_내_판도_같은_줄에서() {
        let d = doc_dir("hist");
        for m in 100..160u32 { std::fs::write(d.join(format!("{m}.md")), "").unwrap(); }
        std::fs::write(d.join("159-mine.md"), "내 판").unwrap();
        std::fs::write(d.join("99-mine.md"), "아주 옛 내 판").unwrap(); // 분 번호 자리수가 달라도 이름 순 = 문자 순 — 지금 분 번호(8자리)에선 같은 자리
        super::trim_history(&d);
        let mut left: Vec<String> = std::fs::read_dir(&d).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left.len(), 50);
        assert!(left.contains(&"159-mine.md".to_string()), "가장 새 내 판은 남는다");
        assert!(!left.contains(&"100.md".to_string()), "가장 옛 것부터 지운다");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 진_판_이름은_바깥_판은_초까지_내_판은_분마다() {
        let t = std::time::UNIX_EPOCH + std::time::Duration::from_secs(29_850_823 * 60 + 7);
        assert_eq!(super::history_name(Some("outside"), t), "29850823-outside-07.md");
        assert_eq!(super::history_name(None, t), "29850823-mine.md");
        assert_eq!(super::history_name(Some("../x"), t), "29850823-mine.md", "모르는 표시는 이름에 안 넣는다");
    }
}
