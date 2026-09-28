//! 화면 모드(시스템 따라감·라이트·다크). 창 모양(NSAppearance)을 바꾸면 웹뷰의 prefers-color-scheme 이 따라가서
//! CSS·터미널 색·다마고치 위젯이 전부 알아서 바뀐다. 고른 값은 <데이터 폴더>/theme 에 남긴다
use tauri::menu::MenuItemKind;
use tauri::{AppHandle, Manager, Theme};

fn path() -> std::path::PathBuf {
    crate::config::data_file("theme")
}

pub fn saved() -> Option<Theme> {
    match std::fs::read_to_string(path()).unwrap_or_default().trim() {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    }
}

fn set_all(app: &AppHandle, t: Option<Theme>) {
    for w in app.webview_windows().values() {
        let _ = w.set_theme(t);
    }
}

pub fn apply_saved(app: &AppHandle) {
    set_all(app, saved());
}

/// 메뉴에서 고름: mode = system | light | dark. 체크 표시도 하나만 켜지게 맞춘다
pub fn apply(app: &AppHandle, mode: &str) {
    let t = match mode {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    };
    let _ = std::fs::write(path(), if t.is_none() { "system" } else { mode });
    set_all(app, t);
    let Some(menu) = app.menu() else { return };
    for m in ["system", "light", "dark"] {
        if let Some(MenuItemKind::Check(c)) = menu.get(&format!("theme_{m}")).or_else(|| find_deep(&menu, &format!("theme_{m}"))) {
            let _ = c.set_checked(m == mode);
        }
    }
}

/// 하위 메뉴 안까지 찾아본다 (menu.get 은 맨 위 한 층만 본다)
fn find_deep<R: tauri::Runtime>(menu: &tauri::menu::Menu<R>, id: &str) -> Option<MenuItemKind<R>> {
    fn walk<R: tauri::Runtime>(items: Vec<MenuItemKind<R>>, id: &str) -> Option<MenuItemKind<R>> {
        for it in items {
            if it.id().0 == id {
                return Some(it);
            }
            if let MenuItemKind::Submenu(s) = &it {
                if let Some(found) = s.items().ok().and_then(|xs| walk(xs, id)) {
                    return Some(found);
                }
            }
        }
        None
    }
    walk(menu.items().ok()?, id)
}
