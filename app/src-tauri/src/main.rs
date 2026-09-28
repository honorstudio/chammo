//! honor-orchestrator — 프로젝트별 Claude Code 세션을 띄우고·보고·지시하는 macOS 앱.
//! Rust 쪽은 두 가지만 한다: pty 로 `claude attach` 를 띄워 웹뷰로 흘리기(pty.rs),
//! 맥에 깔린 `claude` 를 찾아 부르기(claude.rs). 판단·파싱은 프론트 domain 에 있다.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appctl;
mod claude;
mod config;
mod hq;
mod i18n;
mod reader;
#[cfg(target_os = "macos")]
mod keys_mac;
mod debug;
mod drop;
#[cfg(target_os = "macos")]
mod keyrepeat;
mod load;
mod memo;
#[cfg(target_os = "macos")]
mod notify_mac;
mod project;
mod browser;
mod routines;
mod pty;
mod review;
mod setup;
mod tama;
mod theme;
mod tts;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::Manager;
use std::path::Path;

/// 앱 메뉴(과 앱 전체 키 감시)의 동작을 창으로 넘긴다. 떼어 낸 리더 창을 보고 있으면 탭 키(⌘W·Ctrl+Tab)는 그 창으로,
/// 나머지는 메인 창 웹뷰의 window.__menu('<id>') 로 (권한 파일 없이 되는 eval)
pub fn route_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    if matches!(id, "close_pane" | "reader_next" | "reader_prev" | "reader_close") {
        if let Some((_, w)) = app.webview_windows().into_iter().find(|(l, w)| l.starts_with("reader-") && w.is_focused().unwrap_or(false)) {
            let _ = w.eval(format!("window.__readerKey && window.__readerKey({})", serde_json::to_string(id).unwrap_or_default()));
            return;
        }
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.eval(format!("window.__menu && window.__menu({})", serde_json::to_string(id).unwrap_or_default()));
    }
}

/// 앱 메뉴. 기본 메뉴의 "윈도우 닫기(⌘W)"를 뺐다 — ⌘W 는 앱이 "보고 있는 창의 세션 끄기"로 쓴다.
/// 편집 메뉴는 남긴다(없으면 웹뷰에서 ⌘C·⌘V 가 안 먹는다). 글자는 설정 언어로, 꺼 둔 기능(사무실·다마고치·리뷰)의 항목은 뺀다.
/// 설정을 저장하면 rebuild_menu 로 다시 만든다
fn build_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    use i18n::tr;
    let f = config::current().features;
    let app_menu = SubmenuBuilder::new(app, "Chammo")
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .separator()
        // 설정·첫 실행 화면(ui/Setup.tsx) — macOS 관례 ⌘,
        .item(&MenuItem::with_id(app, "settings", tr("설정…", "Settings…"), true, Some("CmdOrCtrl+,"))?)
        // 첫 사용 안내 다시 보기(ui/Tour.tsx)
        .item(&MenuItem::with_id(app, "tour", tr("둘러보기", "Tour"), true, Some("CmdOrCtrl+/"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .separator()
        // ⌘Q = 창을 숨기고 독에서도 뺀다(세션·알림은 그대로). 진짜로 끄면 세션(데몬)이 Chammo 식구로 남아 독에 "백그라운드에서 중단"이
        // 붙어 있었다(아이맥 lsappinfo: exited-with-subordinates). 세션까지 다 끄는 건 ⌥⌘Q(묻고 끔, ui/QuitDialog) — 사용자 2026-09-28
        .item(&MenuItem::with_id(app, "app_quit", tr("Chammo 닫기 (세션은 계속)", "Close Chammo (sessions keep running)"), true, Some("CmdOrCtrl+Q"))?)
        .item(&MenuItem::with_id(app, "app_quit_all", tr("완전히 종료 — 세션도 끄기…", "Quit Completely — Stop Sessions…"), true, Some("CmdOrCtrl+Alt+Q"))?)
        .build()?;
    let edit = SubmenuBuilder::new(app, tr("편집", "Edit"))
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;
    // 앱 기능 메뉴 — 항목 id 는 프론트 domain/shortcuts.ts menuAction 과 짝. 단축키가 메뉴에 표시된다
    let item = |id: &str, label: &str, key: Option<&str>| MenuItem::with_id(app, id, label, true, key);
    let mut view = SubmenuBuilder::new(app, tr("보기", "View"))
        .item(&item("goto_orch", &config::assistant_name(), Some("CmdOrCtrl+1"))?)
        .item(&item("goto_all", tr("전체 보기", "All sessions"), Some("CmdOrCtrl+2"))?);
    if f.review {
        view = view.item(&item("goto_review", tr("리뷰", "Review"), Some("CmdOrCtrl+3"))?);
    }
    if f.office {
        view = view.item(&item("goto_office", tr("사무실", "Office"), Some("CmdOrCtrl+4"))?);
    }
    if f.tama {
        view = view.item(&item("goto_tama", tr("다마고치 · 도감", "Tamagotchi · Collection"), None)?);
    }
    let view = view
        .separator()
        .item(&item("sidebar", tr("사이드바 보이기·숨기기", "Show/Hide Sidebar"), Some("CmdOrCtrl+B"))?)
        .item(&item("tasks", tr("작업 패널 보이기·숨기기", "Show/Hide Task Panel"), Some("CmdOrCtrl+J"))?)
        .item(&item("search", tr("프로젝트 검색", "Search Projects"), Some("CmdOrCtrl+K"))?)
        .separator()
        .item(&item("font_up", tr("글자 크게", "Larger Text"), Some("CmdOrCtrl+="))?)
        .item(&item("font_down", tr("글자 작게", "Smaller Text"), Some("CmdOrCtrl+-"))?)
        .item(&item("font_reset", tr("글자 원래 크기", "Actual Size"), Some("CmdOrCtrl+0"))?)
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
        .item(&item("new_session", &new_label, Some("CmdOrCtrl+T"))?)
        .item(&item("close_pane", tr("보고 있는 세션 끄기", "Stop Focused Session"), Some("CmdOrCtrl+W"))?)
        .item(&item("pane_max", tr("보고 있는 창 크게 / 되돌리기", "Maximize / Restore Focused Pane"), Some("CmdOrCtrl+Enter"))?)
        .separator()
        .item(&item("memo", tr("메모 (보고 있는 창의 프로젝트)", "Notes (focused project)"), Some("CmdOrCtrl+M"))?)
        .build()?;
    // 리더 — 탭 닫기는 ⌘W(세션 끄기와 같은 키, 리더를 보고 있으면 탭을 닫는다). 떼어 낸 리더 창에서도 같은 키
    let reader_menu = SubmenuBuilder::new(app, tr("리더", "Reader"))
        .item(&item("reader_toggle", tr("리더 패널 보이기·숨기기", "Show/Hide Reader"), Some("CmdOrCtrl+E"))?)
        .item(&item("reader_full", tr("리더 크게·작게", "Expand/Shrink Reader"), Some("CmdOrCtrl+Shift+E"))?)
        .separator()
        .item(&item("reader_next", tr("다음 탭", "Next Tab"), Some("Ctrl+Tab"))?)
        .item(&item("reader_prev", tr("이전 탭", "Previous Tab"), Some("Ctrl+Shift+Tab"))?)
        .item(&item("reader_close", tr("탭 닫기 (리더를 보고 있을 때 ⌘W)", "Close Tab (⌘W while viewing the reader)"), None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, tr("윈도우", "Window"))
        // 최소화(⌘M)는 뺐다 — ⌘M 은 메모. 최소화는 창의 노란 버튼으로
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let menu = Menu::with_items(app, &[&app_menu, &edit, &view, &session, &reader_menu])?;
    if f.tama {
        let tama_menu = SubmenuBuilder::new(app, tr("다마고치", "Tamagotchi"))
            .item(&item("widget_toggle", tr("위젯 보이기·숨기기", "Show/Hide Widget"), None)?)
            .item(&item("open_dex", tr("도감 · 보관함 열기", "Open Collection"), None)?)
            .build()?;
        menu.append(&tama_menu)?;
    }
    menu.append(&window)?;
    Ok(menu)
}

/// ⌘Q — 창을 다 숨기고 독에서 뺀다. 앱은 뒤에서 살아 있어 세션 알림·음성은 그대로, 다시 열면 Reopen 이 되살린다
fn to_background<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    for (_, w) in app.webview_windows() {
        let _ = w.hide();
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
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

fn main() {
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
            // 기본 항목(가리기·종료 등)은 macOS 가 알아서 한다 — 우리 항목만 넘긴다(안 그러면 '가리기' 뒤에 창이 다시 뜬다)
            const OURS: &[&str] = &["goto_orch", "goto_all", "goto_review", "goto_office", "reader_toggle", "reader_full", "reader_next", "reader_prev", "reader_close", "goto_tama", "open_dex", "sidebar", "tasks", "search", "font_up", "font_down", "font_reset", "new_session", "close_pane", "pane_max", "widget_toggle", "memo", "settings", "tour", "app_quit_all"];
            if !OURS.contains(&id.as_str()) {
                return;
            }
            route_menu(app, &id);
        })
        .setup(|app| {
            tama::place(app);
            #[cfg(target_os = "macos")]
            notify_mac::init(app.handle());
            // 참모 scripts/new-project 가 쓸 프로젝트 하네스 템플릿
            let _ = project::export_templates(config::data_dir());
            // 사용량·세션별 대화 % 를 남기는 상태줄 — 새 HQ(주인 옛 폴더 말고)는 켤 때마다 설정에 박아 둔다(이미 깐 HQ 도 따라오게)
            let _ = hq::export_statusline(config::data_dir());
            // 루틴 스크립트 — launchd 와 앱 버튼이 부른다
            let _ = routines::export(config::data_dir());
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
            reader::watch(app.handle());
            // 참모 scripts/app — 앱을 대신 조작(음성·기능·화면)
            appctl::watch(app.handle());
            #[cfg(target_os = "macos")]
            keys_mac::install(app.handle());
            Ok(())
        })
        .register_uri_scheme_protocol("hodoc", reader::serve)
        .manage(pty::Ptys::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            claude::app_env,
            config::read_config,
            config::write_config,
            config::reload_config,
            load::load_sample,
            load::load_env,
            load::load_kill,
            load::load_save,
            hq::create_hq,
            hq::folder_status,
            hq::make_dir,
            setup::check_env,
            setup::claude_trusted,
            setup::pick_folder,
            tama::tama_more,
            project::harness_project,
            browser::browser_status,
            browser::browser_install_command,
            routines::routines_list,
            routines::routine_do,
            reader::first_existing,
            notify_mac::notify_status,
            notify_mac::notify_request,
            notify_mac::notify_open_settings,
            setup::tts_test,
            rebuild_menu,
            app_exit,
            app_background,
            claude::list_sessions,
            claude::spawn_session,
            claude::adopt_session,
            claude::new_session,
            claude::stop_session,
            claude::read_tasks,
            claude::read_transcript_tails,
            claude::project_scan,
            claude::notify,
            claude::speak,
            claude::list_sessions_all,
            claude::resume_session,
            claude::daemon_started_at,
            claude::read_live_snap,
            claude::write_live_snap,
            claude::read_say,
            claude::write_voice_mode,
            claude::read_usage,
            claude::today_commits,
            claude::commit_log,
            claude::ci_runs,
            memo::read_memos,
            memo::append_memo,
            memo::write_memo,
            tama::read_tama,
            tama::read_gacha,
            tama::write_gacha,
            tama::write_tama,
            tama::tama_drag,
            tama::tama_widget,
            tama::tama_request,
            tama::set_badge,
            claude::open_target,
            claude::read_ctx,
            claude::send_to_session,
            claude::session_screen,
            claude::send_keys,
            claude::log_auto_allow,
            claude::read_auto_allow,
            claude::ime_debug_mode,
            claude::ime_log,
            tts::supertonic_status,
            tts::supertonic_install,
            tts::native_voices,
            tts::tts_warm,
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
            reader::reader_close,
            reader::reader_activate,
            reader::reader_cycle,
            reader::reader_move,
            reader::reader_dock_rect,
            reader::reader_drop,
            reader::reader_open,
            reader::read_doc_text,
        ])
        // ⌘W(창 닫기)로 앱이 통째로 꺼지지 않게 — 창만 숨기고, Dock 아이콘을 누르면 다시 보인다. 완전히 끄는 건 ⌘Q
        .on_window_event(|window, event| match event {
            // 떼어 낸 리더 창은 진짜로 닫는다(탭도 같이 — 크롬처럼)
            tauri::WindowEvent::CloseRequested { .. } if window.label().starts_with("reader-") => reader::forget(window.label()),
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
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
