//! honor-orchestrator — 프로젝트별 Claude Code 세션을 띄우고·보고·지시하는 macOS 앱.
//! Rust 쪽은 두 가지만 한다: pty 로 `claude attach` 를 띄워 웹뷰로 흘리기(pty.rs),
//! 맥에 깔린 `claude` 를 찾아 부르기(claude.rs). 판단·파싱은 프론트 domain 에 있다.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod access;
mod appctl;
mod away;
mod offmain;
mod orch_bubble;
#[cfg(test)]
mod offmain_scan;
mod audio_out;
mod avatar;
mod claude;
mod deep_link;
mod claude_src;
mod accounts;
mod accounts_cmd;
mod accounts_file;
mod accounts_refresh;
mod accounts_store;
mod accounts_usage;
mod accounts_warm;
mod claude_defaults;
mod daemon_env;
mod computer_use;
mod browser_attach;
mod browser_foreign;
mod config;
mod craft_basics;
mod craft_dock;
mod tidy_git;
mod dock_quit;
mod craft_input;
mod accessory;
mod browser_pane;
mod win_desk;
#[cfg(windows)]
mod browser_pane_win;
#[cfg(windows)]
mod win_jpeg;
mod craft_mirror;
mod craft_screen;
mod craft_window;
mod harnitor;
mod hq;
mod hq_browser;
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
mod login_keep;
mod memo;
mod messenger;
mod messenger_text;
mod messenger_tg;
mod messenger_run;
mod messenger_cmd;
mod mobile;
mod locker;
mod locker_fs;
mod locker_link;
mod locker_trash;
mod mobile_files;
mod mobile_http;
mod mobile_pair;
mod mobile_sends;
mod mobile_wake;
mod phone_gacha;
mod peer_ask;
mod peer_cmd;
mod peer_human;
mod peer_link;
mod team_account;
mod chammo_here;
mod team_cmd;
mod team_locker;
mod team_locker_app;
mod team_locker_cmd;
mod team_revise;
mod team_profile;
mod team_profile_cmd;
mod team_app;
mod team_app_cmd;
mod team_app_store;
mod team_home;
mod team_home_cmd;
mod team_home_store;
mod team_owners;
mod team_post;
mod team_post_cmd;
mod team_phone_up;
mod team_manage;
mod team_relay;
mod team_helper;
mod team_agent;
mod team_agent_store;
mod team_agent_cmd;
mod team_relay_inbox;
mod team_relay_keys;
mod phone_tunnel;
// 종단 암호 봉투 열쇠 감싸기(chammo-relay ADR 0007) — 단계 B 에서 봉투가 쓴다
#[allow(dead_code)]
mod e2e_hpke;
#[allow(dead_code)]
mod e2e_chain;
#[allow(dead_code)]
mod e2e_roster;
#[allow(dead_code)]
mod e2e_envelope;
#[allow(dead_code)]
mod e2e_state;
#[allow(dead_code)]
mod e2e_flow;
#[allow(dead_code)]
mod e2e_team;
mod e2e_cmd;
mod e2e_safety;
mod e2e_cards;
mod e2e_handover;
mod e2e_retry;
mod phone_relay_core;
mod phone_relay;
mod device_link;
mod device_cards;
mod team_relay_ws;
mod team_reads;
mod team_rooms;
#[cfg(test)]
mod team_test_util;
mod team_ui;
mod shown_share;
mod team_alert;
mod team_window;
#[cfg(test)]
mod test_ports;
mod phone_voice;
mod remote;
mod remote_net;
mod drafts;
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
// 다른 기기 참모 짝 열쇠 — 윈도우 자격 증명 관리자(맥은 키체인)
#[cfg_attr(not(windows), allow(dead_code))]
mod wincred;
mod win_recycle;
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
mod quit;
mod review;
mod setup;
mod win_path;
mod win_bin;
mod sheet;
mod sheet_book;
mod sheet_cmd;
mod sheet_layout_ops;
mod sheet_patch;
mod sheet_ref;
mod sheet_style;
mod sheet_style_write;
mod sheet_sheets;
mod sheet_struct;
mod sheet_xml;
mod slash;
mod tama;
mod token_rate;
mod tools;
mod tools_mcp;
mod tools_plugins;
mod theme;
mod origin;
mod tts;
mod modes;
mod modes_host;
mod modes_light;
mod updater;
mod usage_counts;
mod usage_ping;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::Manager;

/// 앱 메뉴(과 앱 전체 키 감시)의 동작을 창으로 넘긴다. 떼어 낸 리더 창을 보고 있으면 탭 키(⌘W 탭 닫기·Ctrl+Tab)는 그 창으로,
/// 나머지는 메인 창 웹뷰의 window.__menu('<id>') 로 (권한 파일 없이 되는 eval)
pub fn route_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    // ⌘A·⌘+ ⌘- ⌘0 도 — 떼어 낸 리더 창에선 그 문서만(사용자 2026-09-29)
    if matches!(id, "close_tab" | "reader_next" | "reader_prev" | "reader_close" | "select_all" | "font_up" | "font_down" | "font_reset") {
        if let Some((_, w)) = app.webview_windows().into_iter().find(|(l, w)| l.starts_with("reader-") && w.is_focused().unwrap_or(false)) {
            let _ = w.eval(format!("window.__readerKey && window.__readerKey({})", serde_json::to_string(id).unwrap_or_default()));
            return;
        }
    }
    // ⌘A 는 보고 있는 창 안의 일 — 다른 창(메신저 따로 창·모드 창)에서 눌렀으면 그 창에서 고르고 메인 창을 끌어오지 않는다
    if id == "select_all" {
        let wins = app.webview_windows();
        let focus: Vec<(&str, bool)> = wins.iter().map(|(l, w)| (l.as_str(), w.is_focused().unwrap_or(false))).collect();
        if let Some(other) = select_all_other(&focus).and_then(|l| wins.get(l)) {
            let _ = other.eval(OTHER_SELECT_ALL);
            return;
        }
        if !focus.contains(&("main", true)) {
            return;
        }
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        // ⌘` 홈을 메신저 따로 창 같은 다른 창에서 눌렀으면 메인 창을 앞으로 꺼내고 홈을 켜기만(돌아가기 아님) — 2026-10-25 사용자
        let id = if id == "home_toggle" && !w.is_focused().unwrap_or(false) {
            let _ = w.set_focus();
            "home_open"
        } else {
            id
        };
        let _ = w.eval(format!("window.__menu && window.__menu({})", serde_json::to_string(id).unwrap_or_default()));
    }
}

/// ⌘A 를 받을 메인 창 밖의 앞 창 — 메인 창(App.tsx)·리더 창(__readerKey)은 제 길이 있다
fn select_all_other<'a>(wins: &[(&'a str, bool)]) -> Option<&'a str> {
    wins.iter().find(|(l, focused)| *focused && *l != "main" && !l.starts_with("reader-")).map(|(l, _)| *l)
}

/// 그 창 화면이 __menu 를 달았으면 그걸로(메신저 창), 아니면 지금 칸이 글칸일 때만 그 칸 전체 선택(화면 전체를 잡지 않게)
const OTHER_SELECT_ALL: &str = "window.__menu ? window.__menu(\"select_all\") : (() => { const a = document.activeElement; if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) a.select(); else if (a && a.isContentEditable) document.execCommand('selectAll'); })()";

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

/// 앱 메뉴. 기본 메뉴의 "윈도우 닫기(⌘W)"를 뺐다 — ⌘W 는 앱이 "스페이스에서 열린 탭 닫기"로 쓴다(세션 끄기는 ⌘⇧W, 2026-10-12 사용자).
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
        // 오픈소스 라이선스 — Craft 앱(원작·저장소·라이선스, 앱 표에서 자동)과 Chammo 가 담아 가는 것(THIRD_PARTY_NOTICES). 앱 서랍 아래 줄 대신(2026-10-19 사용자 v8 B1)
        .item(&MenuItem::with_id(app, "licenses", tr("오픈소스 라이선스…", "Open-Source Licenses…"), true, None::<&str>)?)
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
        .item(&item("new_doc", tr("새 문서 (보고 있는 보관함 폴더)", "New Document (current locker folder)"), Some(&*platform::accel("CmdOrCtrl+T")))?)
        .item(&item("close_tab", tr("열린 탭 닫기", "Close Tab"), Some(&*platform::accel("CmdOrCtrl+W")))?)
        .separator()
        .item(&item("home_toggle", tr("홈 대시보드 / 보던 화면", "Home Dashboard / Back"), Some(&*platform::accel("CmdOrCtrl+`")))?)
        .item(&item("go_home", tr("홈 탭으로", "Go to Home Tab"), Some(&*platform::accel("CmdOrCtrl+Shift+H")))?)
        .item(&item("go_locker", tr("보관함 탭으로", "Go to Locker Tab"), Some(&*platform::accel("CmdOrCtrl+Shift+L")))?)
        .separator()
        .item(&item("new_session", &new_label, Some(&*platform::accel("CmdOrCtrl+Shift+T")))?)
        .item(&item("close_pane", tr("보고 있는 세션 끄기", "Stop Focused Session"), Some(&*platform::accel("CmdOrCtrl+Shift+W")))?)
        .item(&item("pane_max", tr("보고 있는 창 크게 / 되돌리기", "Maximize / Restore Focused Pane"), Some(&*platform::accel("CmdOrCtrl+Shift+`")))?)
        .separator()
        .item(&item("memo", tr("메모 (보고 있는 창의 프로젝트)", "Notes (focused project)"), Some(&*platform::accel("CmdOrCtrl+M")))?)
        .build()?;
    // 리더 — 탭 닫기는 ⌘W(스페이스 탭 닫기와 같은 키, 리더를 보고 있으면 리더 탭을 닫는다). 떼어 낸 리더 창에서도 같은 키
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
        wizard_menu(&h);
    });
}

/// 윈도우는 메뉴줄이 창 안에 있어 첫 설정 마법사 중에도 세션·다마고치·모드 메뉴가 보이고 눌렸다(2026-10-22 윈도우 QA 31) —
/// 설정을 마치기 전엔 메인 창 메뉴줄을 숨긴다. 맥 메뉴는 화면 위 앱 메뉴라 그대로(설정·끝내기가 거기 있다)
fn wizard_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    #[cfg(not(target_os = "macos"))]
    if let Some(w) = app.get_webview_window("main") {
        let _ = if config::current().setup_done { w.show_menu() } else { w.hide_menu() };
    }
    #[cfg(target_os = "macos")]
    let _ = app;
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

/// 종료 창에서 고른 뒤 — 진짜로 끈다(정리가 걸려도 quit::EXIT_WAIT 뒤엔 끝난다)
#[tauri::command]
fn app_exit(app: tauri::AppHandle) {
    // 독 종료를 미뤄 둔 중이면(종료 창이 저장을 보였다) 그 끄기를 마저 — 아니면 ⌥⌘Q 종료 창
    if dock_quit::finish(&app, 0, "dock quit — dialog done") {
        return;
    }
    quit::exit_now(&app, "quit dialog");
}

/// 화면 기록 허용이 있나(보기만) — 첫 실행 안내·설정 줄. 맥 밖은 늘 true
#[tauri::command]
fn screen_trusted() -> bool {
    #[cfg(target_os = "macos")]
    return keys_mac::screen_trusted();
    #[cfg(not(target_os = "macos"))]
    true
}

/// 사람이 '설정 열기'·'권한 열기'를 눌렀을 때만 — 권한을 한 번 요청해 맥 목록에 Chammo 를 올린다(설정 화면은 웹이 이어서 연다). 켤 때·자동으로는 안 부른다
#[tauri::command]
fn ask_permission(kind: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    match kind.as_str() {
        "ax" => keys_mac::ask_ax(),
        "screen" => keys_mac::ask_screen(),
        _ => return Err("unknown permission".into()),
    }
    #[cfg(not(target_os = "macos"))]
    let _ = kind;
    Ok(())
}

/// 손쉬운 사용 허용이 있나(묻지 않고 보기만) — 첫 실행 안내·설정 > 기능 줄, 개입 카드가 1초마다 본다. 맥 밖은 늘 true
#[tauri::command]
fn ax_trusted() -> bool {
    #[cfg(target_os = "macos")]
    return keys_mac::ax_trusted();
    #[cfg(not(target_os = "macos"))]
    true
}

/// 종료 창이 떴다 — Rust 가 기다리던 '웹 굳음' 대비 종료를 거둔다
#[tauri::command]
fn app_quit_shown() {
    quit::shown();
}

/// 설정을 저장한 뒤 — 언어·비서 이름·기능 켜기가 메뉴에도 보이게
#[tauri::command]
fn rebuild_menu(app: tauri::AppHandle) -> Result<(), String> {
    let menu = build_menu(&app).map_err(|e| e.to_string())?;
    app.set_menu(menu).map(|_| ()).map_err(|e| e.to_string())?;
    wizard_menu(&app); // 마법사를 마치면 앱이 저장 뒤 이걸 불러 메뉴줄이 다시 보인다
    Ok(())
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
    // 파일 한도 256(launchd 기본)을 올린다 — 앱·예약 tick·띄우는 claude 가 다 물려받는다(10-04 Too many open files)
    platform::raise_nofile();
    // launchd 의 예약 깨우기 — 창·트레이·단일 실행 잠금보다 먼저 갈라서 끝낸다(안 그러면 1분마다 앱이 뜬다)
    if std::env::args().nth(1).as_deref() == Some(routines::TICK_FLAG) {
        std::process::exit(routines::tick_main());
    }
    // 익명 사용 통계 — 앱이 죽은(panic) 횟수만 센다. 문구·위치는 안 담고, 원래 처리(기록·종료)는 그대로
    let before = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        crate::usage_counts::record_crash("panic");
        before(info);
    }));
    // 창이 키를 받기 전에 — 길게 누르기가 악센트 창이 아니라 반복이 되게(Claude 음성 입력 스페이스 누르기)
    #[cfg(target_os = "macos")]
    keyrepeat::disable_press_and_hold();
    // 스레드가 생기기 전에 — 세션(→ MCP)이 터미널과 같은 PATH 를 물려받게
    claude::adopt_user_path();
    // 띄운 쪽 Claude 세션 표시를 안 물려받게 — 사람이 연 Craft 의 주인이 그 세션으로 잡혔다(2026-10-20)
    craft_window::drop_session_env();
    let ctx = tauri::generate_context!();
    // 자동 업데이트 — 공개판만(개인 앱은 엔드포인트를 비워 둠, updater.rs)
    let builder = tauri::Builder::default();
    // 윈도우: chammo:// 를 누르거나 앱을 또 켜면 새 프로세스가 뜬다 — 떠 있는 앱으로 넘기고 끈다(맨 먼저 등록, ADR 0015)
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        if argv.iter().any(|a| deep_link::invite_from_url(a).is_some()) {
            deep_link::handle(app, argv);
        } else if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }));
    updater::attach(builder, &ctx)
        .plugin(tauri_plugin_deep_link::init())
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
            // 완전히 종료 — 웹이 종료 창을 못 띄우면(굳음) 4초 뒤 앱만 끈다(quit.rs). 창은 아래 route_menu 가 부탁한다
            if id == "app_quit_all" {
                quit::ask_or_exit(app);
            }
            if id.starts_with("mode_") && modes_host::on_menu(app, &id) {
                return;
            }
            // 기본 항목(가리기·종료 등)은 macOS 가 알아서 한다 — 우리 항목만 넘긴다(안 그러면 '가리기' 뒤에 창이 다시 뜬다)
            const OURS: &[&str] = &["licenses", "goto_orch", "goto_all", "goto_review", "goto_office", "reader_toggle", "reader_full", "reader_next", "reader_prev", "reader_close", "goto_tama", "open_dex", "sidebar", "tasks", "search", "font_up", "font_down", "font_reset", "new_session", "close_pane", "close_tab", "new_doc", "go_home", "go_locker", "pane_max", "home_toggle", "widget_toggle", "memo", "settings", "harnitor", "tour", "app_quit_all", "select_all"];
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
            wizard_menu(app.handle());
            // 팀 초대 딥링크(chammo://join) — 꺼져 있다 켜진 거면 켠 주소, 떠 있으면 이벤트로(ADR 0015)
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                // 윈도우는 설치판이 등록하지만 옮긴 exe·개발판도 받게 사용자 레지스트리(HKCU)에 다시 적는다
                #[cfg(windows)]
                let _ = app.deep_link().register_all();
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    deep_link::handle(app.handle(), urls.into_iter().map(|u| u.to_string()));
                }
                let h = app.handle().clone();
                app.deep_link().on_open_url(move |e| deep_link::handle(&h, e.urls().into_iter().map(|u| u.to_string())));
            }
            // 파일 감시는 맨 먼저 — 아래 템플릿 쓰기가 윈도우에선 11초쯤 걸려 그 사이 들어온 요청(scripts/app·choice)이 건너뛰어졌다
            reader::watch(app.handle());
            // 화면 조종을 모든 프로젝트에 켜 뒀으면 그사이 생긴 프로젝트에 넣는다(~/.claude.json, 바뀔 때만 백업·쓰기)
            std::thread::spawn(computer_use::sweep_logged);
            // 있던 프로젝트에 붙여 둔 참모 브라우저(local scope)를 떠 있던 claude 가 지웠으면 다시(GitHub #2)
            std::thread::spawn(|| { browser_attach::reassert(); });
            // 세션 크롬 가리기 지킴이(세션 브라우저 앱에서 보기) + 크롬 자체 창(패스키) 보기 — 앱이 떠 있을 때만 가려진다
            agent_browser::watch_hidden();
            // 세션 크롬 Dock·⌘Tab 빼기 dylib 를 데이터 폴더에 — 래퍼가 있으면 사본을 재서명하고 넣는다
            std::thread::spawn(accessory::install);
            // 가상 모니터 — 세션 크롬을 눈에 안 보이는 화면에. 켤 때는 안 띄우고 세션 크롬이 뜰 때만(want), 2분 비면 내린다
            vdisplay::watch_idle();
            craft_mirror::debug_event_watch(app.handle());
            craft_window::restore_on_start(app.handle());
            craft_screen::watch_idle();
            craft_dock::watch_hidden();
            craft_screen::watch_scale(app.handle());
            quit::watch_sigterm(app.handle());
            dock_quit::install(app.handle());
            orch_bubble::watch(app.handle());
            // 참모 scripts/app — 앱을 대신 조작(음성·기능·화면)
            appctl::watch(app.handle());
            // 팀 메신저 — 팀이 있으면 방 연결 스레드(받은 말 → 내 참모)
            team_relay_ws::ensure(config::data_dir());
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
            team_alert::init(app.handle());
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
            // 세션은 claude 데몬 env 를 물려받는다 — 시험이 띄운 데몬이어도 진짜 세션이 앱 폴더를 쓰게 사용자 설정에 고정, 래퍼·scripts 용 산 앱 표식
            daemon_env::write_mark(config::data_dir());
            std::thread::spawn(daemon_env::pin_user_settings);
            // 루틴 스크립트 — launchd 와 앱 버튼이 부른다
            let _ = routines::export(config::data_dir());
            // 예약 깨우기를 이 앱 실행 파일 하나로(옛 예약별 python 항목은 내린다) — launchctl 이 느릴 수 있어 뒤에서
            #[cfg(target_os = "macos")]
            std::thread::spawn(routines::install);
            // 모바일(폰 → 테일스케일) — 켜 둔 상태면 연다. 기본 꺼짐
            mobile::boot(app.handle());
            // 테일스케일 없는 폰 — 중계 허브에 붙어 있기(ADR 0013)
            phone_relay::boot(app.handle());
            device_cards::boot();
            messenger_cmd::boot();
            // 쉬는 계정 칸 토큰을 만료 전에 하나씩 새로 받아 둔다 — 바꾸는 순간 토큰 주소를 안 부르게(2026-10-15 429 로 바꾸기가 막힘)
            accounts_cmd::warm_start();
            // 지금 로그인을 만료 전에 미리·끈질기게 갱신한다(ADR 0008) — 토큰 주소가 막혀도 세션이 안 멈추게. 계정 풀과 상관없이 돈다
            accounts_cmd::keep_start();
            // 기본 참모 앱 다섯 — 첫 설정 뒤 뒤에서 한 번(craft_basics.rs)
            craft_basics::start();
            // 익명 사용 신호 — 공개판·진짜 데이터 폴더·설정 켬일 때만 하루 한 번(usage_ping.rs)
            usage_ping::start(app.config().identifier.clone(), app.package_info().name.clone(), app.package_info().version.to_string());
            hq::refresh_app_hq();
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
        .invoke_handler(no_web_preview(offmain::dispatch(tauri::generate_handler![
            remote::remote_devices,
            remote::remote_pair,
            remote::remote_unpair,
            remote::remote_connect,
            remote::remote_connect_cancel,
            remote::remote_call,
            remote::remote_human_say,
            remote::remote_logout_ask,
            team_cmd::team_status,
            team_cmd::team_human_say,
            team_ui::team_ui_room_new,
            team_ui::team_ui_room_set,
            team_ui::team_ui_room_leave,
            team_ui::team_ui_all_room,
            team_ui::team_ui_room_info,
            team_ui::team_ui_room_delete,
            team_ui::team_pick_files,
            team_ui::team_clip_files,
            team_ui::drag_out,
            shown_share::drag_native,
            team_ui::drag_hover,
            team_ui::drag_out_team,
            team_ui::drag_back,
            e2e_cmd::e2e_self_number, e2e_cmd::e2e_renew, e2e_cmd::e2e_card_open, e2e_cmd::e2e_card_claim, e2e_cmd::e2e_card_ready, e2e_cmd::e2e_card_approve, e2e_cmd::e2e_self_code, e2e_cmd::e2e_card_op, e2e_cmd::e2e_self_step, e2e_cmd::e2e_start_chain, e2e_cmd::e2e_reset_chain, e2e_cmd::e2e_recover_code, e2e_cmd::e2e_recover_cancel, e2e_cmd::e2e_recover_finish, e2e_cmd::e2e_recover_state, e2e_cmd::e2e_recover_open, e2e_cmd::e2e_safety_people, e2e_cmd::e2e_safety_verify, e2e_cmd::e2e_safety_unblock, e2e_cmd::e2e_safety_block, e2e_cmd::e2e_safety_refetch,
            usage_counts::usage_bump,
            team_ui::team_feed,
            team_ui::team_mark_read,
            team_ui::team_ui_create,
            team_ui::team_ui_join,
            team_ui::team_ui_invite,
            deep_link::team_take_invite,
            team_ui::team_clip_invite,
            team_ui::team_ui_rename,
            team_ui::team_ui_invites,
            team_ui::team_ui_revoke_invites,
            team_ui::team_ui_leave,
            team_ui::team_ui_delete,
            team_ui::team_ui_use,
            team_ui::team_ui_remove,
            team_ui::team_ui_transfer,
            team_ui::team_ui_set_perms,
            team_ui::team_handoff,
            team_profile_cmd::team_profiles,
            team_profile_cmd::team_profile_changed,
            team_profile_cmd::team_profile_set,
            team_profile_cmd::team_icon_set,
            team_post_cmd::team_posts,
            team_app_cmd::team_cal_cached,
            team_app_cmd::team_cal,
            team_app_cmd::team_cal_poll,
            team_app_cmd::team_cal_put,
            team_home_cmd::team_home,
            team_home_cmd::team_home_save,
            team_home_cmd::team_home_content,
            team_home_cmd::team_home_cover,
            team_post_cmd::team_post_write,
            team_post_cmd::team_post_pin,
            team_post_cmd::team_post_remove,
            team_agent_cmd::team_agents,
            team_agent_cmd::team_agents_cached,
            team_agent_cmd::team_agent_save,
            team_agent_cmd::team_agent_remove,
            team_agent_cmd::team_agent_confirm,
            team_agent_cmd::team_agent_usage,
            team_agent_cmd::team_agent_try,
            team_locker_cmd::team_locker_list,
            team_locker_cmd::team_locker_put,
            team_locker_cmd::team_locker_poll,
            team_locker_cmd::team_locker_dismiss,
            team_locker_cmd::team_locker_open,
            team_locker_cmd::team_locker_give,
            team_locker_cmd::team_locker_give_folder,
            orch_bubble::orch_bubble_main,
            orch_bubble::bubble_screens,
            orch_bubble::bubble_place,
            orch_bubble::bubble_reveal,
            orch_bubble::bubble_wanted,
            orch_bubble::bubble_face,
            orch_bubble::bubble_drag,
            orch_bubble::bubble_send,
            orch_bubble::bubble_hot,
            orch_bubble::bubble_keys,
            orch_bubble::bubble_screen,
            orch_bubble::bubble_appctl,
            team_locker_cmd::team_peek_give,
            team_locker_cmd::team_peek_state,
            team_locker_cmd::team_peek_revise,
            team_locker_cmd::team_locker_cached,
            team_locker_cmd::team_locker_download,
            team_locker_cmd::team_locker_mkdir,
            team_locker_cmd::team_locker_folder,
            team_locker_cmd::team_locker_save,
            team_locker_cmd::team_locker_peek,
            team_locker_cmd::team_locker_pick,
            team_locker_cmd::team_locker_rename,
            team_locker_cmd::team_locker_act,
            team_locker_cmd::team_file_attach,
            team_locker_cmd::team_file_open,
            team_locker_cmd::team_file_save,
            team_alert::team_viewing,
            team_alert::team_alert_get,
            team_alert::team_alert_set,
            team_alert::team_sound_try,
            team_window::team_window_open,
            team_window::team_window_close,
            team_window::team_window_state,
            team_cmd::team_login,
            team_cmd::team_account_refresh,
            team_cmd::team_device_rename,
            team_cmd::team_device_revoke,
            team_cmd::team_logout,
            team_cmd::chammo_here,
            team_cmd::team_account_delete,
            remote::remote_saved,
            mobile::mobile_device_locker,
            remote::remote_direct_answer,
            remote::remote_cards,
            agent_browser::agent_lives,
            agent_browser::agent_retry,
            agent_browser::agent_frame,
            agent_browser::agent_tabs,
            agent_browser::agent_pin,
            agent_browser::agent_focus,
            agent_browser::agent_peek,
            agent_browser::agent_hide,
            agent_browser::agent_signed,
            browser_pane::browser_pane_place,
            browser_pane::browser_pane_still,
            browser_pane::browser_pane_detach,
            browser_pane::browser_pane_input,
            agent_browser::agent_close_browser,
            hq_browser::hq_browser_open,
            hq_browser::hq_browser_profile,
            agent_browser::agent_close_tab,
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
            pty::pty_close_mine,
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
            accounts_cmd::login_keep_state,
            login::login_save,
            login::login_terms_retry,
            hq::create_hq,
            hq::folder_status,
            hq::make_dir,
            setup::check_env,
            claude_src::claude_source,
            setup::app_version,
            updater::app_update_check,
            updater::app_update_install,
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
            daemon_env::daemon_env_check,
            browser_attach::project_browser,
            browser_attach::project_browser_attach,
            browser_setup::browser_setup_state,
            routines::routines_list,
            routines::routine_do,
            mobile::mobile_status,
            mobile::mobile_set,
            mobile::mobile_pair_new,
            mobile::phone_entry_qr,
            messenger_cmd::messenger_status,
            messenger::set_orch_legacy,
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
            notify_mac::notify_withdraw,
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
            app_quit_shown,
            ax_trusted,
            screen_trusted,
            ask_permission,
            app_background,
            claude::list_sessions,
            claude::spawn_session,
            claude::adopt_session,
            claude::new_session,
            claude::stop_session,
            claude::remove_session,
            claude::app_stopped_recently,
            claude::daemon_stopped_recently,
            claude::read_tasks_since,
            claude::read_transcript_tails,
            claude::read_transcript,
            claude::read_session_tasks,
            claude::send_text_to_session,
            reader::write_doc_text,
            sheet_book::read_sheet_book,
            sheet_patch::write_sheet,
            sheet_cmd::sheet_open,
            sheet_cmd::sheet_play_done,
            sheet_cmd::sheet_play_ack,
            reader::doc_stamp,
            reader::keep_doc_version,
            reader::list_md,
            reader::list_dir,
            reader::list_md_deep,
            reader::save_attach,
            reader::save_curation,
            reader::save_curation_state,
            drafts::drafts_read,
            drafts::drafts_write,
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
            locker::locker_peek,
            locker_fs::locker_migrate,
            locker_fs::locker_tree,
            locker_fs::locker_put,
            locker_fs::locker_alias,
            locker_fs::locker_new_doc,
            locker_fs::locker_mkdir,
            locker_fs::locker_rename_at,
            locker_fs::locker_move_to,
            locker_trash::locker_trash,
            locker_trash::locker_trash_many,
            locker_trash::locker_trash_empty_out,
            locker_trash::locker_trash_plan,
            locker_trash::locker_trash_last,
            locker_trash::locker_trash_undo,
            locker_fs::locker_versions,
            locker_fs::locker_restore,
            locker_fs::locker_give,
            locker_fs::locker_back,
            locker_fs::locker_choose,
            locker_fs::locker_reveal,
            locker_fs::locker_find,
            locker_fs::locker_relink,
            locker_fs::locker_fetch,
            locker_link::locker_connect,
            locker_link::locker_connect_choose,
            locker_link::locker_disconnect,
            locker_link::locker_reconnect_choose,
            locker_link::locker_recent_shots,
            reader::space_log_append,
            reader::save_asset,
            reader::copy_asset,
            reader::read_show_log,
            claude::project_scan,
            tidy_git::tidy_git,
            claude::notify,
            claude::main_watched,
            away::user_idle,
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
            tama::write_office,
            phone_gacha::gacha_phone_reply,
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
            claude_defaults::bypass_consent,
            claude_defaults::bypass_consent_accept,
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
            debug::perf_ping,
            debug::perf_alerts,
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
            modes_host::mode_manage,
            modes_host::mode_card,
            modes_host::mode_remove,
            modes_host::mode_restore,
            modes_host::mode_restore_builtin,
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
            craft_window::craft_win_info,
            craft_window::craft_win_act,
            craft_window::craft_win_takeover,
            craft_window::craft_space_place,
            craft_window::craft_space_still,
            craft_window::craft_pane_shot,
            craft_screen::craft_quit_start,
            craft_screen::craft_quit_left,
            craft_window::craft_space_detach,
            craft_window::craft_move,
            craft_dock::craft_dock,
            craft_dock::craft_recent,
            craft_dock::craft_hide,
            craft_dock::craft_leave,
            craft_dock::craft_enter,
            craft_dock::craft_show,
            craft_dock::craft_open_file,
            craft_dock::craft_apps,
            craft_dock::craft_launch,
            craft_dock::craft_install,
            craft_dock::craft_remove,
        ])))
        // ⌘W(창 닫기)로 앱이 통째로 꺼지지 않게 — 창만 숨기고, Dock 아이콘을 누르면 다시 보인다. 완전히 끄는 건 ⌘Q
        .on_window_event(|window, event| match event {
            // 떼어 낸 리더 창은 진짜로 닫는다(탭도 같이 — 크롬처럼)
            tauri::WindowEvent::CloseRequested { .. } if window.label().starts_with("reader-") => reader::forget(window.label()),
            // 모드 따로 창을 닫으면 그 모드를 끈다(호스트도)
            tauri::WindowEvent::CloseRequested { .. } if modes_host::is_mode_window(window.label()) => modes_host::window_closed(window.app_handle(), window.label()),
            // Craft 따로 창은 진짜로 닫는다 — 비추기만 떼고 앱은 그대로(앱을 끄는 건 머리줄 닫기·scripts/craft close)
            tauri::WindowEvent::CloseRequested { .. } if craft_window::is_craft_window(window.label()) => craft_window::window_closed(window),
            // 주소 미리보기 창(⌘W 등)은 진짜로 닫고 상태를 비운다
            tauri::WindowEvent::CloseRequested { .. } if window.label() == webpage::LABEL => webpage::forget(),
            // 메신저 따로 창은 진짜로 닫는다 = 메인 창에 붙이기(마지막 자리는 기억)
            tauri::WindowEvent::CloseRequested { .. } if team_window::is_team_window(window.label()) => team_window::closed(window),
            // 미리보기 창이 붙은 창이 움직이면 따라간다(맥은 자식 창이 저절로 따라오지만 윈도우는 아니다)
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                if team_window::is_team_window(window.label()) {
                    team_window::moved(window);
                }
                // 세션 브라우저 칸(윈도우는 앱 창이 소유한 떠 있는 창)도 따라간다
                #[cfg(windows)]
                if window.label() == "main" {
                    browser_pane_win::follow();
                }
                if window.label() == orch_bubble::LABEL {
                    orch_bubble::moved(window.app_handle());
                }
                webpage::parent_moved(window)
            }
            // 앱 창 중 하나라도 앞인지 → 메인·다마고치 웹뷰의 window.__appFocus(ui/attention) — 안 보면 참모 프사를 멈춘다(2026-10-04 mac-perf).
            // 메인 웹뷰 blur 만 보면 앱 안 리더 창으로 옮겨도 '맨 앞 아님'이 된다
            tauri::WindowEvent::Focused(_) => app_focus_changed(window.app_handle()),
            // 맥은 창만 숨긴다(독에서 다시 연다). 윈도우는 숨기면 못 찾으니 메인 창을 닫으면 앱을 끈다(세션은 계속)
            tauri::WindowEvent::CloseRequested { api, .. } if cfg!(target_os = "macos") => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::CloseRequested { .. } if window.label() == "main" => window.app_handle().exit(0),
            // 파일 끌어다 놓기 → 그 창 웹뷰의 window.__drop — 메인 창(ui/fileDrop.ts)·메신저 따로 창(ui/team/teamDrop.ts, 메인만 넘겨서 따로 창엔 안 붙었다 10-26)
            tauri::WindowEvent::DragDrop(e) if window.label() == "main" || window.label() == orch_bubble::LABEL || team_window::is_team_window(window.label()) => drop::forward(window, e),
            // 리더 창에 파일을 놓으면 탭으로 연다
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) if window.label().starts_with("reader-") => {
                reader::add_to(window.app_handle(), window.label(), paths.iter().map(|p| p.to_string_lossy().into_owned()).collect())
            }
            _ => {}
        })
        .build(ctx)
        .expect("tauri 실행 실패")
        .run(|app, event| {
            // 앱이 꺼질 때 말하던 음성도 같이 끈다 — 앱을 바꿔 넣어도 옛 앱이 띄운 음성이 계속 돌았다(2026-09-28)
            if let tauri::RunEvent::Exit = event {
                // 가상 모니터를 지우기 전에 세션 크롬을 가린다 — 안 그러면 어느 화면도 아닌 곳에 남거나 사용자 화면으로 튈 수 있다
                // 단계마다 0.3초 넘게 걸리면 notify.log 에 — 끌 때 무엇이 붙잡는지 실사용 앱에서 보려고(2026-10-19 독 종료 QA)
                let step = |name: &str, f: &dyn Fn()| {
                    let t = std::time::Instant::now();
                    f();
                    let ms = t.elapsed().as_millis();
                    if ms >= 300 {
                        claude::log_out("quit", &format!("exit step {name} {ms}ms"));
                    }
                };
                step("hide browsers", &agent_browser::hide_all);
                step("agents screen", &vdisplay::stop);
                step("craft save", &craft_screen::close_apps_on_exit);
                step("craft screen", &craft_screen::stop);
                step("voice", &claude::stop_speaking);
                // 모드 호스트를 남기지 않는다
                step("modes", &modes_host::shutdown);
                // 모바일 서버·테일스케일 serve 정리
                step("mobile", &mobile::shutdown);
                step("messenger", &messenger_cmd::shutdown);
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

    // 2026-10-29 사용자: 메신저 따로 창(team-all) 입력칸에서 ⌘A 가 안 먹었다 — 전체 선택은 앱이 만든 메뉴 항목(⌘A)이라 키를 메뉴가 먼저 먹는데
    // route_menu 가 메인 창이 앞이 아니면 버렸다(⌘C·⌘V·⌘X·⌘Z 는 맥 기본 항목이라 앞 창에 그대로 갔다)
    #[test]
    fn 전체_선택은_보고_있는_따로_창으로() {
        assert_eq!(super::select_all_other(&[("main", false), ("team-all", true)]), Some("team-all"));
        assert_eq!(super::select_all_other(&[("main", false), ("mode-board", true)]), Some("mode-board"));
        // 메인 창이 앞이면 메인 길(App.tsx __menu), 리더 창은 그 앞 길(__readerKey), 아무 창도 앞이 아니면 아무것도
        assert_eq!(super::select_all_other(&[("main", true), ("team-all", false)]), None);
        assert_eq!(super::select_all_other(&[("main", false), ("reader-1", true)]), None);
        assert_eq!(super::select_all_other(&[("main", false), ("team-all", false)]), None);
        // 그 창 화면이 __menu 를 달았으면 그걸로(메신저 창 = 앱과 같은 selectAllHere), 없으면 글칸만 전체 선택
        assert!(super::OTHER_SELECT_ALL.starts_with("window.__menu ? window.__menu(\"select_all\")"));
        assert!(super::OTHER_SELECT_ALL.contains(".select()") && super::OTHER_SELECT_ALL.contains("execCommand('selectAll')"));
    }

    // 윈도우 muda 는 About(Some(메타데이터)) 일 때만 창을 띄운다 — None 이면 'Chammo 정보'가 무반응이었다(0.2.5 윈도우 QA)
    #[test]
    fn 정보_메타데이터에_이름과_버전이_있다() {
        let m = super::about_metadata("Chammo", "0.2.5");
        assert_eq!(m.name.as_deref(), Some("Chammo"));
        assert_eq!(m.version.as_deref(), Some("0.2.5"));
    }
}
