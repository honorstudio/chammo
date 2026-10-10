//! honor-orchestrator — 프로젝트별 Claude Code 세션을 띄우고·보고·지시하는 macOS 앱.
//! Rust 쪽은 두 가지만 한다: pty 로 `claude attach` 를 띄워 웹뷰로 흘리기(pty.rs),
//! 맥에 깔린 `claude` 를 찾아 부르기(claude.rs). 판단·파싱은 프론트 domain 에 있다.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod access;
mod appctl;
mod audio_out;
mod avatar;
mod claude;
mod accounts;
mod accounts_cmd;
mod accounts_store;
mod accounts_usage;
mod claude_defaults;
mod computer_use;
mod browser_attach;
mod browser_foreign;
mod config;
mod harnitor;
mod hq;
mod i18n;
mod reader;
#[cfg(target_os = "macos")]
mod keys_mac;
mod ptt;
mod debug;
mod drop;
#[cfg(target_os = "macos")]
mod keyrepeat;
mod lessons;
mod lid;
mod load;
mod login;
mod memo;
mod messenger;
mod messenger_text;
mod messenger_tg;
mod messenger_run;
mod messenger_cmd;
mod mobile;
mod mobile_files;
mod mobile_http;
mod mobile_pair;
mod mobile_wake;
mod remote;
mod remote_net;
mod orch_pins;
mod orch_roles;
mod push;
#[cfg(target_os = "macos")]
mod notify_mac;
// 맥 밖에선 같은 이름으로 "알림 없음"(윈도우 토스트는 다음 단계)
#[cfg(not(target_os = "macos"))]
#[path = "notify_other.rs"]
mod notify_mac;
mod platform;
mod agent_browser;
mod chrome_popup;
mod agent_input;
mod takeover;
mod takeover_note;
mod direct;
mod vdisplay;
mod webpage;
mod project;
mod trust;
mod copies;
mod browser;
mod browser_chrome;
mod browser_fix;
mod browser_get;
mod browser_node;
mod browser_parts;
mod browser_setup;
mod routines;
mod pty;
mod review;
mod setup;
mod slash;
mod tama;
mod tools;
mod tools_mcp;
mod tools_plugins;
mod theme;
mod origin;
mod tts;
mod modes;
mod modes_host;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::Manager;
use std::path::Path;

/// 앱 메뉴(과 앱 전체 키 감시)의 동작을 창으로 넘긴다. 떼어 낸 리더 창을 보고 있으면 탭 키(⌘W·Ctrl+Tab)는 그 창으로,
/// 나머지는 메인 창 웹뷰의 window.__menu('<id>') 로 (권한 파일 없이 되는 eval)
pub fn route_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    // ⌘A·⌘+ ⌘- ⌘0 도 — 떼어 낸 리더 창에선 그 문서만(사용자 2026-09-29)
    if matches!(id, "close_pane" | "reader_next" | "reader_prev" | "reader_close" | "select_all" | "font_up" | "font_down" | "font_reset") {
        if let Some((_, w)) = app.webview_windows().into_iter().find(|(l, w)| l.starts_with("reader-") && w.is_focused().unwrap_or(false)) {
            let _ = w.eval(format!("window.__readerKey && window.__readerKey({})", serde_json::to_string(id).unwrap_or_default()));
            return;
        }
    }
    if let Some(w) = app.get_webview_window("main") {
        // ⌘A 는 보고 있는 창 안의 일 — 다른 창(도감 등)에서 눌렀으면 메인 창을 끌어오지 않는다
        if id == "select_all" && !w.is_focused().unwrap_or(false) {
            return;
        }
        let _ = w.show();
        let _ = w.eval(format!("window.__menu && window.__menu({})", serde_json::to_string(id).unwrap_or_default()));
    }
}

/// 메뉴에 쓰는 앱 이름 — 공개판 Chammo, 개인 빌드 Chammo Dev(tauri.private.json productName)
fn quit_label(en: bool, name: &str) -> String {
    if en { format!("Close {name} (sessions keep running)") } else { format!("{name} 닫기 (세션은 계속)") }
}

fn about_label(en: bool, name: &str) -> String {
    if en { format!("About {name}") } else { format!("{name} 정보") }
}

/// 'Chammo 정보' 창에 넣을 이름·버전. 윈도우 muda 는 이게 있어야 창을 띄운다(None 이면 무반응)
fn about_metadata(name: &str, version: &str) -> tauri::menu::AboutMetadata<'static> {
    tauri::menu::AboutMetadata { name: Some(name.to_string()), version: Some(version.to_string()), ..Default::default() }
}

/// 앱 메뉴. 기본 메뉴의 "윈도우 닫기(⌘W)"를 뺐다 — ⌘W 는 앱이 "보고 있는 창의 세션 끄기"로 쓴다.
/// 편집 메뉴는 남긴다(없으면 웹뷰에서 ⌘C·⌘V 가 안 먹는다). 글자는 설정 언어로, 꺼 둔 기능(사무실·다마고치·리뷰)의 항목은 뺀다.
/// 설정을 저장하면 rebuild_menu 로 다시 만든다
fn build_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    use i18n::tr;
    let f = config::current().features;
    let name = &app.package_info().name;
    let app_menu = SubmenuBuilder::new(app, name)
        // 윈도우는 기본 글자가 영어(About·Maximize)라 이름을 붙이고, 창에 띄울 이름·버전도 넘긴다. 맥은 시스템 글자·정보 창 그대로
        .item(&PredefinedMenuItem::about(
            app,
            (!cfg!(target_os = "macos")).then(|| about_label(i18n::is_en(), name)).as_deref(),
            (!cfg!(target_os = "macos")).then(|| about_metadata(name, &app.package_info().version.to_string())),
        )?)
        .separator()
        // 설정·첫 실행 화면(ui/Setup.tsx) — macOS 관례 ⌘,
        .item(&MenuItem::with_id(app, "settings", tr("설정…", "Settings…"), true, Some(&*platform::accel("CmdOrCtrl+,")))?)
        // 하니터 — 스킬·훅·MCP·플러그인 보기·끄고 켜기(탑바 버튼과 같다)
        .item(&MenuItem::with_id(app, "harnitor", tr("하니터 — 하네스 보기…", "Harnitor — Your Harness…"), true, None::<&str>)?)
        // 첫 사용 안내 다시 보기(ui/Tour.tsx)
        .item(&MenuItem::with_id(app, "tour", tr("둘러보기", "Tour"), true, Some(&*platform::accel("CmdOrCtrl+/")))?)
        .separator();
    // 가리기·다른 앱 가리기는 macOS 에만 있다
    #[cfg(target_os = "macos")]
    let app_menu = app_menu
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .separator();
    let app_menu = app_menu
        // ⌘Q = 창을 숨기고 독에서도 뺀다(세션·알림은 그대로). 진짜로 끄면 세션(데몬)이 Chammo 식구로 남아 독에 "백그라운드에서 중단"이
        // 붙어 있었다(아이맥 lsappinfo: exited-with-subordinates). 세션까지 다 끄는 건 ⌥⌘Q(묻고 끔, ui/QuitDialog) — 사용자 2026-09-28
        .item(&MenuItem::with_id(app, "app_quit", quit_label(i18n::is_en(), name), true, Some(&*platform::accel("CmdOrCtrl+Q")))?)
        .item(&MenuItem::with_id(app, "app_quit_all", tr("완전히 종료 — 세션도 끄기…", "Quit Completely — Stop Sessions…"), true, Some(&*platform::accel("CmdOrCtrl+Alt+Q")))?)
        .build()?;
    let edit = SubmenuBuilder::new(app, tr("편집", "Edit"));
    // 윈도우는 기본 편집 항목을 안 단다 — 메뉴 단축키가 Ctrl+C·V·Z 를 가로채 터미널에서 Ctrl+C 로 못 멈췄다.
    // 웹뷰(WebView2)는 메뉴 없이도 복사·붙여넣기가 된다(맥은 메뉴가 있어야 ⌘C·⌘V 가 먹는다)
    #[cfg(target_os = "macos")]
    let edit = edit
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?);
    let edit = edit
        // 기본 전체 선택은 앱 화면 전체를 잡는다 → 앱이 보고 있는 곳(터미널 창·리더 문서·입력칸)만 고른다(사용자 2026-09-29)
        .item(&MenuItem::with_id(app, "select_all", tr("전체 선택", "Select All"), true, Some(&*platform::accel("CmdOrCtrl+A")))?)
        .build()?;
    // 앱 기능 메뉴 — 항목 id 는 프론트 domain/shortcuts.ts menuAction 과 짝. 단축키가 메뉴에 표시된다
    let item = |id: &str, label: &str, key: Option<&str>| MenuItem::with_id(app, id, label, true, key);
    let mut view = SubmenuBuilder::new(app, tr("보기", "View"))
        .item(&item("goto_orch", &config::assistant_name(), Some(&*platform::accel("Alt+CmdOrCtrl+1")))?)
        .item(&item("goto_all", tr("전체 보기", "All sessions"), Some(&*platform::accel("Alt+CmdOrCtrl+2")))?);
    if f.review {
        view = view.item(&item("goto_review", tr("리뷰", "Review"), Some(&*platform::accel("Alt+CmdOrCtrl+3")))?);
    }
    if f.office {
        view = view.item(&item("goto_office", tr("사무실", "Office"), Some(&*platform::accel("Alt+CmdOrCtrl+4")))?);
    }
    if f.tama {
        view = view.item(&item("goto_tama", tr("다마고치 · 도감", "Tamagotchi · Collection"), None)?);
    }
    let view = view
        .separator()
        .item(&item("sidebar", tr("사이드바 보이기·숨기기", "Show/Hide Sidebar"), Some(&*platform::accel("CmdOrCtrl+B")))?)
        .item(&item("tasks", tr("작업 패널 보이기·숨기기", "Show/Hide Task Panel"), Some(&*platform::accel("CmdOrCtrl+J")))?)
        .item(&item("search", tr("프로젝트 검색", "Search Projects"), Some(&*platform::accel("CmdOrCtrl+K")))?)
        .separator()
        .item(&item("font_up", tr("글자 크게", "Larger Text"), Some(&*platform::accel("CmdOrCtrl+=")))?)
        .item(&item("font_down", tr("글자 작게", "Smaller Text"), Some(&*platform::accel("CmdOrCtrl+-")))?)
        .item(&item("font_reset", tr("글자 원래 크기", "Actual Size"), Some(&*platform::accel("CmdOrCtrl+0")))?)
        .separator()
        .item(&Submenu::with_items(app, tr("화면 모드", "Appearance"), true, &[
            &CheckMenuItem::with_id(app, "theme_system", tr("시스템 따라감", "Follow System"), true, theme::saved().is_none(), None::<&str>)?,
            &CheckMenuItem::with_id(app, "theme_light", tr("라이트", "Light"), true, theme::saved() == Some(tauri::Theme::Light), None::<&str>)?,
            &CheckMenuItem::with_id(app, "theme_dark", tr("다크", "Dark"), true, theme::saved() == Some(tauri::Theme::Dark), None::<&str>)?,
        ])?)
        .build()?;
    let new_label = if i18n::is_en() {
        format!("New Session (this project · {})", config::assistant_name())
    } else {
        format!("새 세션 (보고 있는 프로젝트 · {})", config::assistant_name())
    };
    let session = SubmenuBuilder::new(app, tr("세션", "Session"))
        .item(&item("new_session", &new_label, Some(&*platform::accel("CmdOrCtrl+T")))?)
        .item(&item("close_pane", tr("보고 있는 세션 끄기", "Stop Focused Session"), Some(&*platform::accel("CmdOrCtrl+W")))?)
        .item(&item("pane_max", tr("보고 있는 창 크게 / 되돌리기", "Maximize / Restore Focused Pane"), Some(&*platform::accel("CmdOrCtrl+`")))?)
        .separator()
        .item(&item("memo", tr("메모 (보고 있는 창의 프로젝트)", "Notes (focused project)"), Some(&*platform::accel("CmdOrCtrl+M")))?)
        .build()?;
    // 리더 — 탭 닫기는 ⌘W(세션 끄기와 같은 키, 리더를 보고 있으면 탭을 닫는다). 떼어 낸 리더 창에서도 같은 키
    let reader_menu = SubmenuBuilder::new(app, tr("리더", "Reader"))
        .item(&item("reader_toggle", tr("리더 패널 보이기·숨기기", "Show/Hide Reader"), Some(&*platform::accel("CmdOrCtrl+E")))?)
        .item(&item("reader_full", tr("리더 크게·작게", "Expand/Shrink Reader"), Some(&*platform::accel("CmdOrCtrl+Shift+E")))?)
        .separator()
        .item(&item("reader_next", tr("다음 탭", "Next Tab"), Some("Ctrl+Tab"))?)
        .item(&item("reader_prev", tr("이전 탭", "Previous Tab"), Some("Ctrl+Shift+Tab"))?)
        .item(&item("reader_close", &tr("탭 닫기 (리더를 보고 있을 때 ⌘W)", "Close Tab (⌘W while viewing the reader)").replace("⌘W", &platform::win_accel_label("⌘W")), None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, tr("윈도우", "Window"))
        // 최소화(⌘M)는 뺐다 — ⌘M 은 메모. 최소화는 창의 노란 버튼으로
        .item(&PredefinedMenuItem::maximize(app, (!cfg!(target_os = "macos")).then_some(tr("최대화", "Maximize")))?);
    #[cfg(target_os = "macos")]
    let window = window.item(&PredefinedMenuItem::fullscreen(app, None)?); // 전체 화면 항목은 macOS 에만 있다
    let window = window.build()?;
    let menu = Menu::with_items(app, &[&app_menu, &edit, &view, &session, &reader_menu])?;
    if f.tama {
        let tama_menu = SubmenuBuilder::new(app, tr("다마고치", "Tamagotchi"))
            .item(&item("widget_toggle", tr("위젯 보이기·숨기기", "Show/Hide Widget"), None)?)
            .item(&item("open_dex", tr("도감 · 보관함 열기", "Open Collection"), None)?)
            .build()?;
        menu.append(&tama_menu)?;
    }
    // 모드 — 리더(·다마고치) 뒤, 윈도우 앞(참모 모드, docs/research/2026-10-05-chammo-mod.md)
    if let Some(m) = modes_host::menu(app)? {
        menu.append(&m)?;
    }
    menu.append(&window)?;
    Ok(menu)
}

/// 메뉴를 다시 만든다(모드 켜고 끔 → ✓·자리). 메뉴는 메인 스레드에서
pub fn refresh_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let h = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Ok(m) = build_menu(&h) {
            let _ = h.set_menu(m);
        }
    });
}

/// ⌘Q — 창을 다 숨기고 독에서 뺀다. 앱은 뒤에서 살아 있어 세션 알림·음성은 그대로, 다시 열면 Reopen 이 되살린다
/// 윈도우는 독이 없어 숨기면 되돌릴 길이 없다(보이지 않는 채 떠 있었다) → 그냥 끈다. 세션은 claude 데몬이 들고 있어 계속 돈다
fn to_background<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    #[cfg(not(target_os = "macos"))]
    app.exit(0);
    #[cfg(target_os = "macos")]
    {
        for (label, w) in app.webview_windows() {
            if webpage::hide_on_background(&label) {
                let _ = w.hide();
            }
        }
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
}

/// 앱 창(메인·다마고치·리더·미리보기) 중 하나라도 앞이면 true 를 우리 웹뷰(메인·다마고치)에 알린다.
/// 창을 옮기면 '앞 창 놓침 → 새 창 잡음' 두 번 오니 잠깐 false 였다 true 가 된다(멈춤 한 프레임, 보이는 차이 없음).
/// 미리보기 창은 남의 웹 페이지라 부르지 않는다
fn app_focus_changed<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let wins = app.webview_windows();
    let any = wins.values().any(|w| w.is_focused().unwrap_or(false));
    for label in ["main", "tama"] {
        if let Some(w) = wins.get(label) {
            let _ = w.eval(format!("window.__appFocus && window.__appFocus({any})"));
        }
    }
}

/// 웹뷰에서도 부를 수 있게(실측·나중 버튼용)
#[tauri::command]
fn app_background(app: tauri::AppHandle) {
    to_background(&app);
}

/// 종료 창에서 고른 뒤 — 진짜로 끈다
#[tauri::command]
fn app_exit(app: tauri::AppHandle) {
    app.exit(0);
}

/// 설정을 저장한 뒤 — 언어·비서 이름·기능 켜기가 메뉴에도 보이게
#[tauri::command]
fn rebuild_menu(app: tauri::AppHandle) -> Result<(), String> {
    let menu = build_menu(&app).map_err(|e| e.to_string())?;
    app.set_menu(menu).map(|_| ()).map_err(|e| e.to_string())
}

/// 주소 미리보기 웹뷰(바깥 페이지)는 앱 명령을 하나도 못 부른다 — Tauri ACL 이 원격 출처를 막지만 개발판 주소(localhost:1420)는
/// '로컬'로 쳐서 뚫린다. 웹뷰 이름으로 한 번 더(webpage.rs)
fn no_web_preview(handler: impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static) -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    move |invoke| {
        if webpage::blocked(invoke.message.webview_ref().label()) {
            invoke.resolver.reject("not allowed from the web preview");
            return true;
        }
        handler(invoke)
    }
}

/// 주소 미리보기 웹뷰가 hodoc://·harnitor:// 를 부르면
fn forbidden() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder().status(403).body(Vec::new()).unwrap_or_default()
}

fn main() {
    // launchd 의 예약 깨우기 — 창·트레이·단일 실행 잠금보다 먼저 갈라서 끝낸다(안 그러면 1분마다 앱이 뜬다)
    if std::env::args().nth(1).as_deref() == Some(routines::TICK_FLAG) {
        std::process::exit(routines::tick_main());
    }
    // 창이 키를 받기 전에 — 길게 누르기가 악센트 창이 아니라 반복이 되게(Claude 음성 입력 스페이스 누르기)
    #[cfg(target_os = "macos")]
    keyrepeat::disable_press_and_hold();
    // 스레드가 생기기 전에 — 세션(→ MCP)이 터미널과 같은 PATH 를 물려받게
    claude::adopt_user_path();
    tauri::Builder::default()
        .menu(|app| build_menu(app))
        // 앱 기능 메뉴를 누르면 메인 창 웹뷰의 window.__menu('<id>') 로 넘긴다 (권한 파일 없이 되는 eval)
        .on_menu_event(|app, e| {
            let id = e.id().0.clone();
            if let Some(mode) = id.strip_prefix("theme_") {
                theme::apply(app, mode);
                return;
            }
            if id == "app_quit" {
                to_background(app);
                return;
            }
            if id.starts_with("mode_") && modes_host::on_menu(app, &id) {
                return;
            }
            // 기본 항목(가리기·종료 등)은 macOS 가 알아서 한다 — 우리 항목만 넘긴다(안 그러면 '가리기' 뒤에 창이 다시 뜬다)
            const OURS: &[&str] = &["goto_orch", "goto_all", "goto_review", "goto_office", "reader_toggle", "reader_full", "reader_next", "reader_prev", "reader_close", "goto_tama", "open_dex", "sidebar", "tasks", "search", "font_up", "font_down", "font_reset", "new_session", "close_pane", "pane_max", "widget_toggle", "memo", "settings", "harnitor", "tour", "app_quit_all", "select_all"];
            if !OURS.contains(&id.as_str()) {
                return;
            }
            route_menu(app, &id);
        })
        // 메인·다마고치 페이지가 (다시) 뜨면 덮개 상태를 다시 알린다(앞서 알린 값은 새 페이지에 없다)
        .on_page_load(|wv, p| {
            if matches!(p.event(), tauri::webview::PageLoadEvent::Finished) {
                lid::on_page_load(wv);
            }
        })
        .setup(|app| {
            // 파일 감시는 맨 먼저 — 아래 템플릿 쓰기가 윈도우에선 11초쯤 걸려 그 사이 들어온 요청(scripts/app·choice)이 건너뛰어졌다
            reader::watch(app.handle());
            // 화면 조종을 모든 프로젝트에 켜 뒀으면 그사이 생긴 프로젝트에 넣는다(~/.claude.json, 바뀔 때만 백업·쓰기)
            std::thread::spawn(computer_use::sweep_logged);
            // 있던 프로젝트에 붙여 둔 참모 브라우저(local scope)를 떠 있던 claude 가 지웠으면 다시(GitHub #2)
            std::thread::spawn(|| { browser_attach::reassert(); });
            // 세션 크롬 가리기 지킴이(세션 브라우저 앱에서 보기) — 앱이 떠 있을 때만 가려진다
            agent_browser::watch_hidden();
            agent_browser::watch_popups();
            // 가상 모니터 — 세션 크롬을 눈에 안 보이는 화면에(안 되는 맥이면 조용히 안 함)
            vdisplay::start();
            // 참모 scripts/app — 앱을 대신 조작(음성·기능·화면)
            appctl::watch(app.handle());
            // 켜 두었던 참모 모드를 다시(호스트는 뒤에서)
            modes_host::boot(app.handle());
            // 덮개 닫힘 → 바로 프사·말하는 빛·오피스 멈춤(ui/attention). 3초마다 읽고 바뀔 때만 알림, 맥만
            lid::start(app.handle());
            // 창 제목도 앱 이름으로 — 설정 파일 제목(Chammo)은 공개판 것이라 개인 빌드(Chammo Dev)와 섞여 보였다
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_title(&app.package_info().name);
            }
            tama::place(app);
            debug::place_dev_window(app.handle()); // 개발판은 작업 화면 말고 옆 화면에
            notify_mac::init(app.handle()); // 윈도우는 notify_other(토스트)
            // 참모 scripts/new-project 가 쓸 프로젝트 하네스 템플릿
            let _ = project::export_templates(config::data_dir());
            // 사용량·세션별 대화 % 를 남기는 상태줄 — 새 HQ(주인 옛 폴더 말고)는 켤 때마다 설정에 박아 둔다(이미 깐 HQ 도 따라오게)
            let _ = hq::export_statusline(config::data_dir());
            // 기존 프로젝트에도 그 상태줄을(사용자 것은 안 덮음, 진짜 데이터 폴더만) — 프로젝트마다 git 을 부르니 뒤에서
            std::thread::spawn(|| {
                let n = hq::attach_statusline_all(config::data_dir());
                if n > 0 {
                    claude::log_out("statusline", &format!("attached to {n} project(s)"));
                }
                let n = browser_attach::follow_worktrees_all(config::data_dir());
                if n > 0 {
                    claude::log_out("browser-attach", &format!("worktree approval to {n} folder(s)"));
                }
            });
            // 브라우저 자동화를 깐 사용자면 도구 코드를 이번 앱 것으로(설치 버튼 때만 풀면 앱을 올려도 옛 래퍼가 돈다)
            let _ = browser::refresh(config::data_dir());
            // node 링크를 고른 node 로·낡은 .mcp.json(brew 버전 폴더 등) 고치기 — node --version 을 부르니 뒤에서
            std::thread::spawn(|| {
                let data = config::data_dir();
                if browser::tool_dir(data).join("bin").is_dir() {
                    browser_setup::ensure_link(data);
                    browser_fix::fix_all(data);
                }
            });
            // 루틴 스크립트 — launchd 와 앱 버튼이 부른다
            let _ = routines::export(config::data_dir());
            // 예약 깨우기를 이 앱 실행 파일 하나로(옛 예약별 python 항목은 내린다) — launchctl 이 느릴 수 있어 뒤에서
            #[cfg(target_os = "macos")]
            std::thread::spawn(routines::install);
            // 모바일(폰 → 테일스케일) — 켜 둔 상태면 연다. 기본 꺼짐
            mobile::boot(app.handle());
            messenger_cmd::boot();
            if !config::data_dir().ends_with(".honor-orchestrator") {
                let hq_dir = config::hq_dir(&config::home(), &config::current(), |k| std::env::var(k).ok());
                if Path::new(&hq_dir).join("scripts/task").is_file() {
                    let _ = hq::refresh(Path::new(&hq_dir));
                    let _ = hq::pin_data_dir(Path::new(&hq_dir), &config::data_dir().to_string_lossy());
                }
            }
            #[cfg(debug_assertions)]
            drop::fake_from_env(app.handle());
            debug::eval_from_env(app.handle());
            theme::apply_saved(app.handle());
            #[cfg(target_os = "macos")]
            keys_mac::install(app.handle());
            #[cfg(target_os = "macos")]
            {
                // 지구본 키 말하기 — 스페이스는 pty 에 바로, 누르는 순간 읽어 주기는 멈춘다
                let h = app.handle().clone();
                ptt::start(
                    move |id, d| {
                        use tauri::Manager;
                        pty::write_to(&h.state::<pty::Ptys>(), id, d)
                    },
                    claude::stop_speaking,
                );
                keys_mac::install_talk_watch();
                let c = config::current();
                keys_mac::apply_talk(&c.talk_key, c.talk_anywhere);
            }
            Ok(())
        })
        // 홈 폴더 파일을 내주는 프로토콜은 모든 웹뷰에 붙는다 — 주소 미리보기(바깥 페이지) 웹뷰에선 거절(webpage.rs)
        .register_uri_scheme_protocol("hodoc", |ctx, req| if webpage::blocked(ctx.webview_label()) { forbidden() } else { reader::serve(ctx, req) })
        // 하니터 화면(다리 끼운 것) — iframe 이 연다
        .register_uri_scheme_protocol("harnitor", |ctx, req| if webpage::blocked(ctx.webview_label()) { forbidden() } else { harnitor::serve(ctx, req) })
        // 참모 모드 Client 방(모드 화면 모듈만 도는 빈 페이지) — 별도 출처 + CSP sandbox(modes.rs FRAME_CSP)
        .register_uri_scheme_protocol("modeframe", |ctx, req| if webpage::blocked(ctx.webview_label()) { forbidden() } else { modes::frame_response(req.uri().path()) })
        .manage(pty::Ptys::default())
        .invoke_handler(no_web_preview(tauri::generate_handler![
            remote::remote_devices,
            remote::remote_pair,
            remote::remote_unpair,
            remote::remote_call,
            agent_browser::agent_lives,
            agent_browser::agent_retry,
            agent_browser::agent_frame,
            agent_browser::agent_tabs,
            agent_browser::agent_pin,
            agent_browser::agent_focus,
            agent_browser::agent_peek,
            agent_browser::agent_hide,
            agent_browser::agent_input,
            agent_browser::agent_takeover,
            agent_browser::agent_handback,
            agent_browser::agent_dialog,
            agent_browser::agent_ask_done, direct::direct_log, direct::direct_answer, direct::direct_shown, agent_browser::agent_drop_files, agent_browser::agent_choose_files,
            webpage::web_open,
            webpage::web_bounds,
            webpage::web_go,
            webpage::web_nav,
            webpage::web_state,
            webpage::web_visible,
            webpage::web_close,
            webpage::open_in_chrome,
            pty::pty_open,
            pty::pty_write,
            pty::pty_type,
            pty::pty_resize,
            pty::pty_close,
            ptt::ptt_target,
            ptt::ptt_watch,
            ptt::ptt_live,
            claude::app_env,
            config::read_config,
            config::write_config,
            config::reload_config,
            load::load_sample,
            load::load_env,
            load::load_kill,
            load::load_save,
            login::login_probe,
            login::login_save,
            hq::create_hq,
            hq::folder_status,
            hq::make_dir,
            setup::check_env,
            setup::app_version,
            debug::pick_log,
            debug::space_trace,
            slash::slash_commands,
            slash::spawn_lines,
            slash::subagent_tails,
            tools::tools_conf,
            tools::tools_mcp_status,
            tools::tools_plugins,
            tools::tools_plugin_cost,
            tools::tools_mcp_set,
            tools::tools_plugin_set,
            tools::tools_respawn,
            tools::tools_mcp_add,
            tools::tools_mcp_remove,
            tools::tools_mcp_login,
            tools::tools_markets,
            tools::tools_market,
            tools::tools_available,
            tools::tools_plugin_install,
            tools_plugins::memory_files_for,
            setup::claude_trusted,
            access::project_access,
            copies::app_copies,
            setup::pick_folder,
            project::harness_project,
            browser::browser_status,
            browser_setup::browser_setup_start,
            agent_browser::agent_dialog_wrapper,
            agent_browser::agent_permission,
            agent_browser::agent_fedcm,
            browser_foreign::foreign_browsers,
            browser_attach::project_browser,
            browser_attach::project_browser_attach,
            browser_setup::browser_setup_state,
            routines::routines_list,
            routines::routine_do,
            mobile::mobile_status,
            mobile::mobile_set,
            mobile::mobile_pair_new,
            messenger_cmd::messenger_status,
            messenger_cmd::messenger_set_token,
            messenger_cmd::messenger_pair_new,
            messenger_cmd::messenger_pair_cancel,
            messenger_cmd::messenger_unpair,
            messenger_cmd::messenger_confirm,
            messenger_cmd::messenger_reject,
            messenger_cmd::messenger_set_on,
            messenger_cmd::messenger_forget,
            mobile::mobile_device_remove,
            mobile::mobile_devices_clear,
            reader::first_existing,
            notify_mac::notify_status,
            notify_mac::notify_request,
            notify_mac::notify_open_settings,
            setup::tts_test,
            harnitor::harnitor_scan,
            harnitor::harnitor_scan_fast,
            harnitor::harnitor_peek_undo,
            harnitor::harnitor_plan_disable,
            harnitor::harnitor_plan_enable,
            harnitor::harnitor_plan_toggle_mcp,
            harnitor::harnitor_plan_toggle_hook,
            harnitor::harnitor_plan_toggle_plugin,
            harnitor::harnitor_apply_plan,
            harnitor::harnitor_undo,
            harnitor::harnitor_folder_tree,
            harnitor::harnitor_sessions,
            rebuild_menu,
            app_exit,
            app_background,
            claude::list_sessions,
            claude::spawn_session,
            claude::adopt_session,
            claude::new_session,
            claude::stop_session,
            claude::remove_session,
            claude::read_tasks,
            claude::read_transcript_tails,
            claude::read_transcript,
            claude::read_session_tasks,
            claude::send_text_to_session,
            reader::write_doc_text,
            reader::doc_stamp,
            reader::keep_doc_version,
            reader::list_md,
            reader::list_dir,
            reader::list_md_deep,
            reader::save_attach,
            reader::save_curation,
            reader::trash_page,
            reader::save_curation_state,
            orch_pins::read_orch_pins,
            orch_pins::set_orch_pin,
            orch_pins::read_orch_order,
            orch_pins::set_orch_order,
            orch_roles::read_orch_roles,
            orch_roles::set_orch_role,
            reader::read_curation_state,
            reader::set_view_mode,
            reader::office_html,
            reader::page_doc,
            reader::read_doc_bytes,
            reader::ql_thumb,
            reader::pages_dir,
            reader::new_page,
            reader::space_log_append,
            reader::save_asset,
            reader::copy_asset,
            reader::read_show_log,
            claude::project_scan,
            claude::notify,
            claude::main_watched,
            claude::speak,
            claude::speak_now_state,
            claude::speak_preview,
            claude::speak_preview_state,
            claude::speak_preview_stop,
            claude::list_sessions_all,
            claude::resume_session,
            claude::daemon_started_at,
            claude::read_live_snap,
            claude::write_live_snap,
            claude::read_say,
            claude::write_view,
            claude::write_voice_mode,
            claude::read_usage,
            claude::today_commits,
            claude::commit_log,
            claude::ci_runs,
            lessons::read_lessons,
            lessons::write_lessons,
            lessons::unmirror_lesson,
            avatar::avatars_read,
            avatar::avatar_save,
            avatar::avatar_delete,
            memo::read_memos,
            memo::append_memo,
            memo::write_memo,
            tama::read_tama,
            tama::read_gacha,
            tama::write_gacha,
            tama::write_tama,
            tama::tama_drag,
            tama::human_turns,
            tama::read_space_log,
            tama::tama_widget,
            tama::tama_request,
            tama::set_badge,
            claude::open_target,
            claude::read_ctx,
            claude::send_to_session,
            claude::session_screen,
            claude::send_keys,
            accounts_cmd::accounts_view,
            accounts_cmd::accounts_capture,
            accounts_cmd::accounts_switch,
            accounts_cmd::accounts_rename,
            accounts_cmd::accounts_reorder,
            accounts_cmd::accounts_remove,
            accounts_cmd::accounts_restore,
            accounts_cmd::accounts_auto_patch,
            accounts_cmd::accounts_usage,
            claude::read_usage_at,
            claude_defaults::claude_defaults_snapshot,
            claude_defaults::claude_defaults_restore,
            claude::log_auto_allow,
            claude::read_auto_allow,
            claude::ime_debug_mode,
            claude::ime_log,
            tts::supertonic_status,
            tts::supertonic_install,
            tts::native_voices,
            tts::tts_warm,
            origin::session_origins,
            claude::append_task_event,
            claude::clipboard_write,
            review::repo_map,
            review::pr_search,
            review::pr_views,
            review::pr_diff,
            review::pr_merge,
            review::pr_revert,
            review::write_review_state,
            debug::debug_dump,
            reader::reader_state,
            reader::reader_select_all,
            reader::reader_close,
            reader::reader_activate,
            reader::reader_cycle,
            reader::reader_move,
            reader::reader_dock_rect,
            reader::reader_drop,
            reader::reader_open,
            reader::read_doc_text,
            reader::moved_paths,
            modes_host::mode_list,
            modes_host::mode_open,
            modes_host::mode_close,
            modes_host::mode_restart,
            modes_host::mode_state,
            modes_host::mode_render,
            modes_host::mode_act,
            modes_host::mode_seen,
            modes_host::mode_top,
            modes_host::mode_client_module,
            modes_host::mode_client_act,
            modes_host::mode_client_message,
            modes_host::mode_client_fault,
        ]))
        // ⌘W(창 닫기)로 앱이 통째로 꺼지지 않게 — 창만 숨기고, Dock 아이콘을 누르면 다시 보인다. 완전히 끄는 건 ⌘Q
        .on_window_event(|window, event| match event {
            // 떼어 낸 리더 창은 진짜로 닫는다(탭도 같이 — 크롬처럼)
            tauri::WindowEvent::CloseRequested { .. } if window.label().starts_with("reader-") => reader::forget(window.label()),
            // 모드 따로 창을 닫으면 그 모드를 끈다(호스트도)
            tauri::WindowEvent::CloseRequested { .. } if modes_host::is_mode_window(window.label()) => modes_host::window_closed(window.app_handle(), window.label()),
            // 주소 미리보기 창(⌘W 등)은 진짜로 닫고 상태를 비운다
            tauri::WindowEvent::CloseRequested { .. } if window.label() == webpage::LABEL => webpage::forget(),
            // 미리보기 창이 붙은 창이 움직이면 따라간다(맥은 자식 창이 저절로 따라오지만 윈도우는 아니다)
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => webpage::parent_moved(window),
            // 앱 창 중 하나라도 앞인지 → 메인·다마고치 웹뷰의 window.__appFocus(ui/attention) — 안 보면 참모 프사를 멈춘다(2026-10-04 mac-perf).
            // 메인 웹뷰 blur 만 보면 앱 안 리더 창으로 옮겨도 '맨 앞 아님'이 된다
            tauri::WindowEvent::Focused(_) => app_focus_changed(window.app_handle()),
            // 맥은 창만 숨긴다(독에서 다시 연다). 윈도우는 숨기면 못 찾으니 메인 창을 닫으면 앱을 끈다(세션은 계속)
            tauri::WindowEvent::CloseRequested { api, .. } if cfg!(target_os = "macos") => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::CloseRequested { .. } if window.label() == "main" => window.app_handle().exit(0),
            // 파일 끌어다 놓기 → 메인 창 웹뷰의 window.__drop(ui/fileDrop.ts)
            tauri::WindowEvent::DragDrop(e) if window.label() == "main" => drop::forward(window, e),
            // 리더 창에 파일을 놓으면 탭으로 연다
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) if window.label().starts_with("reader-") => {
                reader::add_to(window.app_handle(), window.label(), paths.iter().map(|p| p.to_string_lossy().into_owned()).collect())
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("tauri 실행 실패")
        .run(|app, event| {
            // 앱이 꺼질 때 말하던 음성도 같이 끈다 — 앱을 바꿔 넣어도 옛 앱이 띄운 음성이 계속 돌았다(2026-09-28)
            if let tauri::RunEvent::Exit = event {
                // 가상 모니터를 지우기 전에 세션 크롬을 가린다 — 안 그러면 어느 화면도 아닌 곳에 남거나 사용자 화면으로 튈 수 있다
                agent_browser::hide_all();
                vdisplay::stop();
                claude::stop_speaking();
                // 모드 호스트를 남기지 않는다
                modes_host::shutdown();
                // 모바일 서버·테일스케일 serve 정리
                mobile::shutdown();
                messenger_cmd::shutdown();
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                // ⌘Q 로 독에서 뺐다가 다시 열면(스포트라이트·런치패드·Dock) 독 아이콘을 되살린다
                #[cfg(target_os = "macos")]
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
}

#[cfg(test)]
mod conf_tests {
    // 2026-10-05 아이맥 QA 막힘 2: 앱을 다시 켠 뒤 가운데 '새 참모 만들기'를 두 번 눌러도 무반응 — 웹 쪽(덮개·다시 그림)은 멀쩡했고,
    // wry 는 acceptFirstMouse 기본값 false 라 비활성 창의 첫 클릭을 창 앞으로 가져오기에만 쓰고 버린다.
    // 첫 실행엔 권한 창·알림이 포커스를 자꾸 가져가 누를 때마다 '첫 클릭'이 됐다 — 메인 창은 첫 클릭도 받는다
    #[test]
    fn 메인_창은_비활성일_때_첫_클릭도_받는다() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = conf["app"]["windows"].as_array().unwrap().iter().find(|w| w["label"] == "main").unwrap();
        assert_eq!(main["acceptFirstMouse"], true);
    }

    // 개인 빌드(Chammo Dev)와 공개판(Chammo)이 같은 맥에 있어 메뉴 글자도 제 이름을 쓴다(2026-10-06 사용자)
    #[test]
    fn 메뉴_글자는_앱_이름을_따른다() {
        assert_eq!(super::quit_label(false, "Chammo Dev"), "Chammo Dev 닫기 (세션은 계속)");
        assert_eq!(super::quit_label(true, "Chammo"), "Close Chammo (sessions keep running)");
        assert_eq!(super::about_label(false, "Chammo Dev"), "Chammo Dev 정보");
        assert_eq!(super::about_label(true, "Chammo"), "About Chammo");
    }

    // 윈도우 muda 는 About(Some(메타데이터)) 일 때만 창을 띄운다 — None 이면 'Chammo 정보'가 무반응이었다(0.2.5 윈도우 QA)
    #[test]
    fn 정보_메타데이터에_이름과_버전이_있다() {
        let m = super::about_metadata("Chammo", "0.2.5");
        assert_eq!(m.name.as_deref(), Some("Chammo"));
        assert_eq!(m.version.as_deref(), Some("0.2.5"));
    }
}
