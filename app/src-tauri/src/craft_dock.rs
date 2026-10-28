//! Craft 독(2026-10-17 사용자, 시안 v5) — 스페이스 탭 줄 홈·보관함 옆에 떠 있는 Craft 앱마다 그 앱 아이콘 하나(글자 없이, 이름은 title).
//! 모서리 점 = 지금 상태(사람 개입 중 · 참모가 다루는 중 · 저장 안 됨). 탭 X = 탭만 닫고 아이콘은 남김(숨김) — 10분 안 다시 안 열면 저장 후 끄기.
//! 아이콘 누르기 = 다시 보기, 오른쪽 클릭 = 따로 창·끄기(저장 후)·최근 문서 셋. 떠 있는 앱이 없으면 아이콘도 없다
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;

/// 숨긴 뒤 이만큼 다시 안 열면 저장 후 끈다(B3)
pub const HIDE_CLOSE_SECS: u64 = 600;
/// 참모가 마지막 명령을 보낸 지 이 안이면 '참모 중' 점
const AGENT_RECENT_SECS: u64 = 20;

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DockItem {
    pub app: String,
    pub name: String,
    /// 앱 아이콘 PNG(data URL) — 못 구하면 빈 칸(웹이 이름 첫 글자 동그라미로)
    pub icon: String,
    /// "human"(사람 개입 중) · "agent"(참모가 다루는 중) · "dirty"(저장 안 됨) · ""(조용함)
    pub dot: String,
    /// 탭을 닫아 숨긴 상태(아이콘만 남음)
    pub hidden: bool,
    /// 최근 문서 셋(오른쪽 클릭 메뉴)
    pub recent: Vec<String>,
    /// 이 인스턴스를 띄운 세션 id — 같은 앱이 여럿이면 웹이 그 세션 별명을 이름표에(빈 글 = 사람이 연 것)
    pub by: String,
}

/// 점 하나 — 사람 개입이 가장 앞, 그다음 참모가 지금 다루는 중, 그다음 저장 안 됨
pub fn dot_kind(takeover: bool, since_last_secs: Option<u64>, dirty: bool) -> &'static str {
    if takeover {
        "human"
    } else if since_last_secs.is_some_and(|s| s <= AGENT_RECENT_SECS) {
        "agent"
    } else if dirty {
        "dirty"
    } else {
        ""
    }
}

/// 숨긴 지 오래됐나 — 끌 때인가
pub fn should_close(hidden_secs: u64) -> bool {
    hidden_secs >= HIDE_CLOSE_SECS
}

/// 숨긴 앱을 지금 끌까 — 숨긴 지 10분 + 참모가 마지막으로 다룬 지(상태 파일 시각, 없으면 None)도 10분 + 사람 조작 중 아님.
/// 칸을 다른 참모·인스턴스로 옮기면 숨김이 되는데, 그 앱을 쓰던 세션이 일하는 중에도 꺼졌다(2026-10-21 주인 가르기)
pub fn due_close(hidden_secs: u64, idle_secs: Option<u64>, takeover: bool) -> bool {
    should_close(hidden_secs) && idle_secs.is_none_or(should_close) && !takeover
}

static HIDDEN: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

fn hidden<T>(f: impl FnOnce(&mut HashMap<String, Instant>) -> T) -> T {
    let mut g = HIDDEN.lock().unwrap();
    f(g.get_or_insert_with(HashMap::new))
}

pub fn is_hidden(app: &str) -> bool {
    hidden(|m| m.contains_key(app))
}

pub fn unhide(app: &str) {
    hidden(|m| m.remove(app));
}

/// 앱 아이콘 → PNG data URL. <데이터>/craft-native/icons/<앱>.png 에 한 번 만들어 둔다(sips 로 icns → 64px PNG)
/// 아이콘 크기 — 레티나에서 64점 칸(서랍)도 선명하게(10/19 64px 로 만들어 흐렸다)
pub const ICON_PX: &str = "256";

/// 아이콘 캐시 파일 이름 — 앱 번들 이름 + Info.plist 수정 시각(앱이 바뀌면 새로). scripts/craft icon_cache_name 과 같은 규칙(서랍·독이 같은 파일)
pub fn icon_cache_name(app: &str, bundle: &Path, mtime: u64) -> String {
    let stem = bundle.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut base = String::new();
    for c in stem.chars() {
        if c.is_ascii_alphanumeric() {
            base.push(c);
        } else if !base.ends_with('_') {
            base.push('_');
        }
    }
    format!("{app}-{}-{mtime}.png", base.trim_matches('_'))
}

fn icon_of(data_dir: &Path, app: &str, exe_dir: Option<&str>) -> String {
    use base64::Engine;
    let Some(bundle) = exe_dir.map(Path::new).and_then(|p| p.parent()).and_then(|p| p.parent()) else { return String::new() };
    let plist = bundle.join("Contents").join("Info.plist");
    let mtime = std::fs::metadata(&plist).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let cache = data_dir.join("craft-native").join("icons").join(icon_cache_name(app, bundle, mtime));
    if !cache.exists() {
        let icon = crate::platform::command("/usr/libexec/PlistBuddy").args(["-c", "Print CFBundleIconFile"]).arg(&plist).output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
        if icon.is_empty() {
            return String::new();
        }
        let file = if icon.ends_with(".icns") { icon } else { format!("{icon}.icns") };
        let src = bundle.join("Contents").join("Resources").join(file);
        if let Some(d) = cache.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let ok = crate::platform::command("sips").args(["-s", "format", "png", "-Z", ICON_PX]).arg(&src).arg("--out").arg(&cache).output().is_ok_and(|o| o.status.success());
        if !ok {
            return String::new();
        }
    }
    std::fs::read(&cache).map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b))).unwrap_or_default()
}

/// 떠 있는 Craft 앱 — 독에 보일 것
pub fn items(data_dir: &Path) -> Vec<DockItem> {
    crate::craft_screen::running(data_dir, crate::platform::pid_alive)
        .into_iter()
        .map(|key| {
            let app = key.as_str();
            let base = crate::craft_window::base(app).unwrap_or(app);
            let info = crate::craft_window::read_info(data_dir, app);
            let n = data_dir.join("craft-native");
            let st: serde_json::Value = std::fs::read_to_string(n.join(format!("{app}.json"))).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
            let since = std::fs::metadata(n.join(format!("{app}.status.json"))).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|d| d.as_secs());
            // 막 띄웠을 때 상태 파일은 '마지막 일' 없이 생긴다 — 그건 참모 중이 아니다
            let since = if info.last.is_empty() { None } else { since };
            DockItem {
                app: app.to_string(),
                name: info.name.clone(),
                icon: icon_of(data_dir, base, st["exe"].as_str()),
                dot: dot_kind(info.takeover, since, info.dirty).to_string(),
                hidden: is_hidden(app),
                recent: recent(data_dir, base),
                by: info.by,
            }
        })
        .collect()
}

/// 최근 문서 셋 — scripts/craft recent 와 같은 목록에서 그 앱 것, 지금 있는 파일만
pub fn recent(data_dir: &Path, app: &str) -> Vec<String> {
    let v: serde_json::Value = std::fs::read_to_string(data_dir.join("craft-native").join("recent.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    v["items"].as_array().into_iter().flatten().filter(|r| r["app"].as_str() == Some(app)).filter_map(|r| r["path"].as_str()).filter(|p| Path::new(p).exists()).take(3).map(str::to_string).collect()
}

#[tauri::command]
pub fn craft_dock() -> Vec<DockItem> {
    items(crate::config::data_dir())
}

#[tauri::command]
pub fn craft_recent(app: String) -> Vec<String> {
    recent(crate::config::data_dir(), crate::craft_window::base(&app).unwrap_or(&app))
}

/// 탭 X — 탭만 닫고(비추기는 탭이 내려가며 떨어진다) 아이콘은 남긴다. 따로 창이면 창도 닫는다. 10분 뒤 저장 후 끄기
#[tauri::command]
pub fn craft_hide<R: tauri::Runtime>(handle: tauri::AppHandle<R>, app: String) -> Result<(), String> {
    crate::craft_window::display_name(&app).ok_or("unknown app")?;
    hidden(|m| m.insert(app.clone(), Instant::now()));
    let _ = crate::craft_window::close(&handle, &app);
    crate::craft_window::tell_space(&handle, &app, "hidden");
    Ok(())
}

/// 스페이스에서 그 Craft 칸을 떠났다(다른 탭·홈으로) — 숨기기(10분 안 다시 안 보면 저장 후 끄기). 따로 창에 떠 있으면 그대로 둔다.
/// 2026-10-19 사용자: 스페이스의 Craft 글자 탭을 없앴다 — 탭 X 대신 옮기기가 숨기기
#[tauri::command]
pub fn craft_leave<R: tauri::Runtime>(handle: tauri::AppHandle<R>, app: String) -> Result<(), String> {
    use tauri::Manager;
    crate::craft_window::display_name(&app).ok_or("unknown app")?;
    if handle.get_webview_window(&crate::craft_window::label(&app)).is_some() {
        return Ok(());
    }
    hidden(|m| m.insert(app.clone(), Instant::now()));
    Ok(())
}

/// 그 Craft 칸에 들어왔다(아이콘·뒤로 가기 무엇이든) — 숨김을 푼다(보는 동안 10분 끄기가 돌지 않게)
#[tauri::command]
pub fn craft_enter(app: String) -> Result<(), String> {
    crate::craft_window::display_name(&app).ok_or("unknown app")?;
    unhide(&app);
    Ok(())
}

/// 아이콘 누르기 — 다시 보기(지금 보는 참모 탭 줄에 그 탭)
#[tauri::command]
pub fn craft_show<R: tauri::Runtime>(handle: tauri::AppHandle<R>, app: String) -> Result<String, String> {
    unhide(&app);
    crate::craft_window::show_in_space(&handle, &app, "")
}

/// 최근 문서 열기 — scripts/craft open <앱> --native <파일>(떠 있으면 그 앱에서 연다). async = 파이썬 판정을 메인 스레드 밖에서
#[tauri::command(async)]
pub fn craft_open_file<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: String, path: String) -> Result<(), String> {
    crate::craft_window::display_name(&app).ok_or("unknown app")?;
    crate::platform::need_python()?;
    unhide(&app);
    // 메신저 따로 창에서 눌렀으면 돌아오는 'open' 줄이 그 창 옆 따로 창으로(craft_window asker)
    crate::craft_window::ask_from(&app, window.label());
    crate::craft_window::craft_cmd().args(["open", &crate::craft_window::arg(&app), "--native", &path]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// 앱 서랍 줄(scripts/craft list --json) — 아이콘 자리를 PNG data URL 로 바꿔 웹에 그대로. 깨진 출력은 빈 목록이 아니라 오류로
pub fn drawer_from(json: &str) -> Result<Vec<serde_json::Value>, String> {
    use base64::Engine;
    let mut rows: Vec<serde_json::Value> = serde_json::from_str(json.trim()).map_err(|e| crate::i18n::tr(&format!("앱 목록을 못 읽었어요 — {e}"), &format!("Could not read the app list — {e}")).to_string())?;
    for r in rows.iter_mut() {
        let url = r["icon"].as_str().and_then(|p| std::fs::read(p).ok()).map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b))).unwrap_or_default();
        r["icon"] = serde_json::json!(url);
    }
    Ok(rows)
}

/// scripts/craft list 가 실패했을 때 웹에 줄 한 줄 — stderr 가 비면(종료 코드만) 빈 오류로 서랍이 자리표시에 멈췄다(10-28)
pub fn list_fail(stderr: &str, code: Option<i32>) -> String {
    let t = stderr.trim();
    if !t.is_empty() {
        return t.to_string();
    }
    let code = code.map_or_else(|| "signal".to_string(), |c| c.to_string());
    format!("scripts/craft list {} ({code})", crate::i18n::tr("실패", "failed"))
}

/// 서랍 목록 한도 — 네트워크 없이(fast)는 1초 안팎, 새 판 확인은 GitHub 를 기다린다(앱마다 최대 120초라 넘으면 끊고 한 줄 오류 + 다시 시도)
const LIST_FAST_SECS: u64 = 15;
const LIST_FULL_SECS: u64 = 60;

/// 앱 서랍 — 13개 앱(처음엔 아이콘·새 판을 받느라 10초 남짓, 그다음은 바로). refresh = 새 판 다시 확인.
/// 스크립트 기다리기는 막는 일이라 비동기 일꾼 밖(spawn_blocking)에서 시간 한도로 — 일꾼을 쥐고 기다리면 다른 명령이 밀렸다
#[tauri::command]
pub async fn craft_apps(refresh: bool, fast: Option<bool>) -> Result<Vec<serde_json::Value>, String> {
    let mut args = vec!["list", "--json"];
    if refresh {
        args.push("--refresh");
    }
    // fast = 네트워크 없이(깔린 앱·로컬 DMG·받아 둔 것만) — 서랍이 먼저 그리고 받아야 하는 칸만 자리표시(v8 A2)
    let fast = fast == Some(true);
    if fast {
        args.push("--fast");
    }
    let limit = std::time::Duration::from_secs(if fast { LIST_FAST_SECS } else { LIST_FULL_SECS });
    tauri::async_runtime::spawn_blocking(move || {
        // 윈도우에 파이썬이 없으면 scripts/craft 를 못 돌린다 — 오류 원문(대리 실행기 안내·os error) 대신 웹이 설치 안내로 바꿀 표시
        crate::platform::need_python()?;
        let out = crate::platform::run_capped(crate::craft_window::craft_cmd().args(&args), limit).map_err(|e| match e.kind() {
            std::io::ErrorKind::TimedOut => crate::i18n::tr(&format!("앱 목록이 {}초 넘게 안 와서 멈췄어요", limit.as_secs()), &format!("The app list took over {}s — stopped", limit.as_secs())).to_string(),
            _ => e.to_string(),
        })?;
        if !out.status.success() {
            return Err(list_fail(&String::from_utf8_lossy(&out.stderr), out.status.code()));
        }
        drawer_from(&String::from_utf8_lossy(&out.stdout))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 서랍에서 앱 누르기 — 깔린 앱은 열고, 안 깐 앱은 처음 한 번 설치(체크섬·번들 id·애플 공증) 뒤 연다. 열리면 독 규칙대로 탭 줄에 붙는다
#[tauri::command(async)]
pub fn craft_launch(app: String, key: Option<String>) -> Result<(), String> {
    crate::craft_window::display_name(&app).ok_or("unknown app")?;
    // 대리 실행기는 띄우기엔 성공하고 바로 죽어서 오류 없이 '여는 중'만 3분 남았다 — 띄우기 전에 가른다.
    // 파이썬이 없으면 판정이 프로세스·reg 를 띄워서 메인 스레드에서 돌면 화면이 굳는다 — command(async)
    crate::platform::need_python()?;
    unhide(key.as_deref().unwrap_or(&app));
    crate::craft_window::craft_cmd().args(launch_args(&app, key.as_deref())).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// 서랍 열기 인자 — key(그 앱의 빈 자리 인스턴스, 웹이 고른다)가 있으면 그 인스턴스만(첫 번째는 '-1'), 없거나 다른 앱이면 앱째.
/// 앱째면 scripts/craft 가 떠 있는 첫 인스턴스를 다시 보여 줘서 남의 참모 앱을 가져왔다(2026-10-21 주인 가르기)
pub fn launch_args(app: &str, key: Option<&str>) -> Vec<String> {
    let one = key.filter(|k| crate::craft_window::base(k) == Some(app)).map(crate::craft_window::arg);
    vec!["open".into(), one.unwrap_or_else(|| app.to_string()), "--native".into()]
}

/// 서랍 '받기' — 안 깐 앱을 깔기만 한다(scripts/craft install: open --native 와 같은 체크섬·번들 id·공증). 띄우지 않는다 —
/// 여는 건 사람이 깔린 칸을 다시 누를 때(2026-10-28 사용자 "참모앱 설치하면 일단 자동으로 띄워주는 거 없어야함")
#[tauri::command(async)]
pub fn craft_install(app: String) -> Result<String, String> {
    crate::craft_window::display_name(&app).ok_or("unknown app")?;
    crate::platform::need_python()?;
    let out = crate::craft_window::craft_cmd().args(install_args(&app)).output().map_err(|e| e.to_string())?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string();
    if out.status.success() { Ok(text) } else { Err(text) }
}

/// 받기 인자 — 앱째(인스턴스 키여도 앱으로), open 이 아니라 install
pub fn install_args(app: &str) -> Vec<String> {
    vec!["install".into(), crate::craft_window::base(app).unwrap_or(app).to_string()]
}

/// 서랍에서 지우기 — scripts/craft remove(우리가 깐 것만 휴지통으로). 떠 있으면 저장하고 끄고 칸도 닫은 뒤. 웹이 먼저 한 번 묻는다
#[tauri::command]
pub async fn craft_remove<R: tauri::Runtime>(handle: tauri::AppHandle<R>, app: String) -> Result<String, String> {
    crate::craft_window::display_name(&app).ok_or("unknown app")?;
    let base = crate::craft_window::base(&app).ok_or("unknown app")?;
    // 같은 앱이 세션마다 떠 있으면 다 — 지우기는 앱째라
    for key in crate::craft_screen::running(crate::config::data_dir(), crate::platform::pid_alive) {
        if crate::craft_window::base(&key) == Some(base) {
            let _ = crate::craft_window::craft_cmd().args(["close", &crate::craft_window::arg(&key)]).output();
            let _ = crate::craft_window::close(&handle, &key);
        }
    }
    let out = crate::craft_window::craft_cmd().args(["remove", base]).output().map_err(|e| e.to_string())?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string();
    if out.status.success() { Ok(text) } else { Err(text) }
}

/// 30초마다 — 숨긴 지 10분 지난 앱은 저장 후 끈다(scripts/craft close). 다시 연 앱·이미 꺼진 앱은 목록에서 뺀다
pub fn watch_hidden() {
    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        let due: Vec<String> = hidden(|m| m.iter().filter(|(_, t)| should_close(t.elapsed().as_secs())).map(|(a, _)| a.clone()).collect());
        for app in due {
            let d = crate::config::data_dir();
            let info = crate::craft_window::read_info(d, &app);
            // 참모가 마지막으로 다룬 때 — run/do 가 상태 파일 lease 를(읽기 명령도), 편집이 .status.json 을 고친다. 둘 중 최근 것
            let age = |f: String| std::fs::metadata(d.join("craft-native").join(f)).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|x| x.as_secs());
            let idle = [age(format!("{app}.json")), age(format!("{app}.status.json"))].into_iter().flatten().min();
            if !due_close(HIDE_CLOSE_SECS, idle, info.takeover) {
                continue; // 숨긴 채로 두고 참모 일이 멎으면 다시 본다
            }
            unhide(&app);
            let alive = info.pid.is_some_and(crate::platform::pid_alive);
            if alive {
                let _ = crate::craft_window::craft_cmd().args(["close", &crate::craft_window::arg(&app)]).spawn();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 점은_사람_개입이_먼저_그다음_참모_그다음_저장_안_됨() {
        assert_eq!(dot_kind(true, Some(1), true), "human");
        assert_eq!(dot_kind(false, Some(5), true), "agent");
        assert_eq!(dot_kind(false, Some(120), true), "dirty");
        assert_eq!(dot_kind(false, None, false), "");
    }

    #[test]
    fn 숨긴_지_10분이면_끈다() {
        assert!(!should_close(599));
        assert!(should_close(600));
    }

    #[test]
    fn 숨겨도_참모가_10분_안에_다뤘으면_안_끈다() {
        // 2026-10-21 주인 가르기 — 다른 참모·인스턴스로 칸을 옮기면 숨김이 되는데, 그 앱을 쓰던 세션이 일하는 중에도 10분 뒤 꺼졌다
        assert!(due_close(600, None, false), "참모 일 기록이 없으면 그대로 끈다");
        assert!(due_close(900, Some(600), false));
        assert!(!due_close(900, Some(30), false), "방금 참모가 다뤘다");
        assert!(!due_close(599, None, false));
        assert!(!due_close(900, None, true), "사람이 조작 중");
    }

    #[test]
    fn 서랍_받기는_깔기만_띄우지_않는다() {
        assert_eq!(install_args("gridcraft"), vec!["install", "gridcraft"]);
        assert_eq!(install_args("gridcraft-2"), vec!["install", "gridcraft"], "인스턴스 키여도 앱째");
        assert!(!install_args("photocraft").contains(&"open".to_string()));
    }

    #[test]
    fn 서랍_열기는_빈_자리_인스턴스로() {
        assert_eq!(launch_args("gridcraft", None), vec!["open", "gridcraft", "--native"]);
        assert_eq!(launch_args("gridcraft", Some("gridcraft")), vec!["open", "gridcraft-1", "--native"], "첫 번째는 -1 로 그 인스턴스만");
        assert_eq!(launch_args("gridcraft", Some("gridcraft-3")), vec!["open", "gridcraft-3", "--native"]);
        assert_eq!(launch_args("gridcraft", Some("photocraft-2")), vec!["open", "gridcraft", "--native"], "다른 앱 키는 버린다");
        assert_eq!(launch_args("gridcraft", Some("gridcraft-9")), vec!["open", "gridcraft", "--native"]);
    }

    #[test]
    fn 최근_문서는_그_앱_것_셋까지_있는_파일만() {
        let d = std::env::temp_dir().join(format!("craft-dock-{}", std::process::id()));
        let n = d.join("craft-native");
        std::fs::create_dir_all(&n).unwrap();
        let f = |x: &str| d.join(x).to_string_lossy().into_owned();
        for x in ["a.psd", "b.psd", "c.psd", "d.psd", "g.xlsx"] {
            std::fs::write(d.join(x), "").unwrap();
        }
        let items: Vec<_> = [("photocraft", f("a.psd")), ("gridcraft", f("g.xlsx")), ("photocraft", f("gone.psd")), ("photocraft", f("b.psd")), ("photocraft", f("c.psd")), ("photocraft", f("d.psd"))]
            .iter()
            .map(|(a, p)| serde_json::json!({"app": a, "path": p}))
            .collect();
        std::fs::write(n.join("recent.json"), serde_json::json!({ "items": items }).to_string()).unwrap();
        assert_eq!(recent(&d, "photocraft"), vec![f("a.psd"), f("b.psd"), f("c.psd")]);
        assert_eq!(recent(&d, "gridcraft"), vec![f("g.xlsx")]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 아이콘_캐시_이름은_scripts_craft_와_같은_규칙() {
        // 10/19 서랍 아이콘이 흐렸다 — 독(64px)과 서랍(128px)이 같은 파일 icons/<앱>.png 를 같이 써서 먼저 만든 64px 이 서랍에도 갔다
        assert_eq!(icon_cache_name("vectorcraft", Path::new("/Applications/Chammo Vector.app"), 1_700_000_000), "vectorcraft-Chammo_Vector-1700000000.png");
        assert_ne!(icon_cache_name("vectorcraft", Path::new("/Applications/VectorCraft.app"), 1), icon_cache_name("vectorcraft", Path::new("/Applications/Chammo Vector.app"), 1));
        assert_eq!(ICON_PX, "256");
    }

    #[test]
    fn 서랍_줄의_아이콘은_data_url_로() {
        let d = std::env::temp_dir().join(format!("craft-drawer-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let png = d.join("g.png");
        std::fs::write(&png, b"PNG").unwrap();
        let json = serde_json::json!([{"app": "gridcraft", "icon": png}, {"app": "cadcraft", "icon": null}]).to_string();
        let rows = drawer_from(&json).unwrap();
        assert_eq!(rows[0]["icon"], "data:image/png;base64,UE5H");
        assert_eq!(rows[1]["icon"], "", "못 구한 아이콘은 빈 칸 — 웹이 첫 글자 판으로");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 서랍_목록을_못_읽으면_빈_목록_대신_한_줄_오류() {
        // 깨진 출력을 빈 목록으로 넘기면 서랍이 칸 하나 없이 '깔린 것'만 남았다 — 오류로(웹이 한 줄 + 다시 시도)
        assert!(drawer_from("not json").is_err());
        assert!(drawer_from("").is_err());
        assert!(drawer_from("[]").unwrap().is_empty());
        // 종료 코드만 있고 stderr 가 비면 웹이 빈 오류를 받아 자리표시에 멈췄다(10-28) — 늘 글이 있게
        assert_eq!(list_fail("boom\n", Some(1)), "boom");
        let e = list_fail("  ", Some(3));
        assert!(e.contains("scripts/craft list") && e.contains('3'), "{e}");
        assert!(!list_fail("", None).is_empty());
    }

    #[test]
    fn 숨김은_다시_보면_풀린다() {
        hidden(|m| m.insert("lightcraft".into(), Instant::now()));
        assert!(is_hidden("lightcraft"));
        unhide("lightcraft");
        assert!(!is_hidden("lightcraft"));
    }
}
