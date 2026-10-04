//! 하니터 — 하네스(스킬·훅·MCP·플러그인·CLAUDE.md)를 보고·끄고 켜고·되돌리는 화면(2026-10-01 사용자 "하니터 가보자").
//! 엔진은 vendor/harnitor-core 그대로, 여기는 하니터 앱(src-tauri/main.rs)의 명령을 harnitor_* 로 옮긴 것 +
//! 화면(harnitor://) 내보내기 + ~/.claude 감시. 화면은 iframe 이라 Tauri 를 직접 못 부른다 —
//! 페이지 맨 앞에 심은 다리가 window.__TAURI__ 를 흉내 내 postMessage 로 부모(참모)에 넘기고, 부모가 harnitor_<명령> 을 부른다.
//! 하니터의 "클로드 붙여 최적화"(ai_*)·청사진·작업대는 옮기지 않았다 — 참모가 대신한다(docs/plans/2026-10-02-harnitor-in-chammo.md)
use harnitor_core::i18n::Lang;
use harnitor_core::model::{Session, Usage};
use harnitor_core::write::{self, Plan};
use harnitor_core::{Scan, ScanOptions};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::http::{Request, Response};
use tauri::{Manager, Runtime};

/// 하니터 화면 원본(하니터 CLI 템플릿 그대로) — 데이터 자리에 다리를 끼워 내보낸다
const UI: &str = include_str!("../vendor/harnitor-ui/index.html");
const SLOT: &str = "/*__HARNITOR_DATA__*/";

/// 다리 — 화면 스크립트가 `window.__TAURI__` 를 읽기 전(같은 스크립트 맨 앞)에 돈다.
/// invoke → 부모에 {harnitor:'invoke'}, 부모 답 {harnitor:'reply'}·이벤트 {harnitor:'event'} 를 받아 넘긴다.
/// 색은 부모가 참모 테마 토큰 값을 {harnitor:'theme', vars} 로 넘기면 :root 변수에 덮는다(밝은·어두운 바뀌면 다시 온다).
/// 언어는 참모 설정을 따른다(하니터 EN 버튼·청사진 탭은 감춘다 — 청사진은 AI 와 한 벌이라 이번 범위 밖)
/// 고른 프로젝트·항목(하니터 cur·sel)은 0.7초마다 보고 바뀌면 부모에 {harnitor:'view'} — 참모가 지금 보는 화면을 알고(viewNow), 탭에 돌아오면 부모가
/// {harnitor:'restore'} 로 돌려준다. 되살릴 땐 변수를 직접 바꾸지 않고 하니터 자기 버튼을 누른다(그래야 옆 칸·진단이 같이 바뀐다). cur·sel 은 let 이라 선언 전엔 못 읽어 try 로
/// 두 번째 열기(quick — 앱이 켜진 뒤 한 번 훑어 기억이 있을 때)는 첫 화면 그림(최소 1.65초)을 떼고, 스캔 답(0.7초)이 와서
/// 다 그린 뒤에 보인다 — 그 사이 빈 뼈대가 번쩍이지 않게 감춰 두고, 답이 안 오면 4초 뒤 그냥 보인다(2026-10-02 사용자)
const BRIDGE: &str = r#"(function(){
var n=0,wait={},subs={};
var quick=__QUICK__;
var show=function(){document.documentElement.style.visibility=''};
var want=null,lastV='';
function restore(){if(!want)return;var b=want.path&&document.querySelector('#pjList .pj[data-path="'+CSS.escape(want.path)+'"]');if(!b)return;
 if(b.getAttribute('aria-current')!=='true')b.click();
 if(want.item){var c=document.querySelector('.chip[data-id="'+CSS.escape(want.item)+'"]');if(c&&!c.classList.contains('on'))c.click();}want=null;}
setInterval(function(){try{var p=cur||null,s=sel||'';var v=JSON.stringify([p&&p.path,s]);if(v!==lastV){lastV=v;parent.postMessage({harnitor:'view',project:p?p.name:'',path:p?p.path:'',item:s},'*');}}catch(x){}},700);
if(quick){var sp=document.getElementById('splash');if(sp)sp.remove();document.documentElement.style.visibility='hidden';setTimeout(show,4000);}
addEventListener('message',function(e){
 if(e.source!==parent)return;var d=e.data||{};
 if(d.harnitor==='reply'&&wait[d.id]){var w=wait[d.id];delete wait[d.id];d.ok?w[0](d.value):w[1](d.error);if(quick&&w[2]==='scan')setTimeout(show,0);if(w[2]==='scan')setTimeout(restore,30);}
 else if(d.harnitor==='event'){(subs[d.name]||[]).forEach(function(f){try{f({payload:d.payload})}catch(x){}});}
 else if(d.harnitor==='restore'){want={path:String(d.path||''),item:String(d.item||'')};setTimeout(restore,0);}
 else if(d.harnitor==='theme'&&d.vars){var r=document.documentElement.style;Object.keys(d.vars).forEach(function(k){if(/^--[a-z0-9-]+$/.test(k)&&typeof d.vars[k]==='string')r.setProperty(k,d.vars[k]);});}
});
window.__TAURI__={core:{invoke:function(cmd,args){return new Promise(function(ok,no){var id=++n;wait[id]=[ok,no,cmd];parent.postMessage({harnitor:'invoke',id:id,cmd:cmd,args:args||{}},'*');});}},
 event:{listen:function(name,f){(subs[name]=subs[name]||[]).push(f);return Promise.resolve(function(){});}}};
try{localStorage.setItem('harnitor-lang','__LANG__')}catch(e){}
var st=document.createElement('style');st.textContent='__STYLE__';document.head.appendChild(st);
addEventListener('keydown',function(e){if(e.key==='Escape'&&!e.defaultPrevented&&!document.querySelector('.modalback,#pal:not([hidden]),#ctx:not([hidden])'))parent.postMessage({harnitor:'esc'},'*');});
parent.postMessage({harnitor:'ready'},'*');
})();"#;

/// 참모 안에서만 덧씌우는 모양 — EN 버튼·청사진 탭 감추기, 왼쪽 색 띠 없애기(사용자가 제일 싫어하는 AI 슬롭 — 전체 테두리·옅은 면으로)
const STYLE: &str = "#tabBp,#bLang{display:none!important}\
.dcard,.d{border-left-width:1px!important}\
.dcard.problem,.d.problem{border-color:color-mix(in srgb,var(--alert) 50%,var(--line))!important}\
.dcard.cost,.d.cost{border-color:color-mix(in srgb,var(--copper) 50%,var(--line))!important}\
.dpick{border-left:0!important;padding-left:0!important}\
.note{border-left:0!important;border-radius:5px!important}\
.grow.in{box-shadow:none!important}\
.pj.flag{box-shadow:inset 0 0 0 1px var(--alert)!important}";

/// 다리를 끼운 화면. 언어는 ko·en 만(그 밖은 ko). quick = 두 번째 열기(첫 화면 그림 없이)
pub fn page(lang: &str, quick: bool) -> String {
    let l = if lang == "en" { "en" } else { "ko" };
    let bridge = BRIDGE.replace("__LANG__", l).replace("__STYLE__", STYLE).replace("__QUICK__", if quick { "true" } else { "false" });
    UI.replacen(SLOT, &bridge, 1)
}

/// harnitor:// 요청 — 어느 주소든 화면 하나(자원은 전부 페이지 안에 있다)
pub fn serve<R: Runtime>(_ctx: tauri::UriSchemeContext<'_, R>, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    Response::builder()
        .header("Content-Type", "text/html; charset=utf-8")
        .body(page(&crate::config::current().language, USAGE.get().is_some_and(|c| c.get(&home()).is_some())).into_bytes())
        .unwrap()
}

/// 하니터가 읽고 고치는 홈. HARNITOR_HOME 이 있으면 그쪽(시험 앱에서 가짜 하네스로 돌릴 때)
pub fn home() -> PathBuf {
    home_from(std::env::var("HARNITOR_HOME").ok(), crate::platform::home())
}

fn home_from(env: Option<String>, home: String) -> PathBuf {
    PathBuf::from(env.filter(|v| !v.trim().is_empty()).unwrap_or(home))
}

/// 첫 전체 스캔에서 센 스킬 호출 기록 — 빠른 스캔·진단이 이걸 근거로 "안 쓰는 스킬"을 센다.
/// 실제 하네스로 전체 스캔이 8.7초(대화 기록 훑기가 대부분), 빠른 스캔 0.5초라
/// 앱이 켜져 있는 동안 두 번째 열기·글 보고부터는 빠른 스캔 + 이 기록(2026-10-01 사용자 (b)). 앱을 다시 켜면 새로 센다.
/// 홈을 같이 적는다 — HARNITOR_HOME(시험 하네스)이 바뀌면 남의 기록이 된다
#[derive(Default)]
pub struct UsageCache(Mutex<Option<(PathBuf, Vec<Usage>)>>);

impl UsageCache {
    pub fn get(&self, home: &Path) -> Option<Vec<Usage>> {
        let g = self.0.lock().ok()?;
        g.as_ref().filter(|(h, _)| h == home).map(|(_, u)| u.clone())
    }
    pub fn remember(&self, home: &Path, usage: &[Usage]) {
        if let Ok(mut g) = self.0.lock() {
            *g = Some((home.to_path_buf(), usage.to_vec()));
        }
    }
}

static USAGE: OnceLock<UsageCache> = OnceLock::new();

/// 기억이 있으면 빠른 스캔, 없으면 전체 스캔하고 기억한다
fn scan_once(home: &Path, lang: Lang) -> Scan {
    let cache = USAGE.get_or_init(UsageCache::default);
    if let Some(k) = cache.get(home) {
        return full(home, lang, Some(k));
    }
    let s = full(home, lang, None);
    cache.remember(home, &s.usage);
    s
}

/// 무거운 일은 메인(=화면) 스레드 밖에서 — 전체 스캔이 2초대라 안 그러면 창이 언다(하니터 실측)
async fn off_thread<T: Send + 'static>(job: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| e.to_string())
}

/// 계획 세우기용 가벼운 스캔 — 본문·호출 기록 안 읽음
fn light(home: &Path, lang: Lang) -> Scan {
    harnitor_core::scan_with(home, &ScanOptions { load_bodies: false, skip_usage: true, lang, ..Default::default() })
}

fn full(home: &Path, lang: Lang, known: Option<Vec<Usage>>) -> Scan {
    let fast = known.is_some();
    // 사용 기록은 하니터 자리(~/.claude/.harnitor/usage-history.json)에 쌓는다 — 대화 기록은 30일이면 지워져 "0회"가 거짓이 된다.
    // 빠른 스캔은 훑지 않으니 기록 시작일만 읽는다(엔진이 skip_usage 면 쓰지 않는다)
    harnitor_core::scan_with(home, &ScanOptions { load_bodies: true, skip_usage: fast, known_usage: known, usage_history: Some(harnitor_core::usage::history_path(home)), lang })
}

/// 끄고 켜기 계획 — 무엇을(what) 어떻게. 계획만 세우고 파일은 안 건드린다(적용은 apply)
pub enum Toggle {
    Skill { name: String, enabled: bool },
    Mcp { project: String, name: String, enabled: bool },
    Hook { event: String, command: String, enabled: bool },
    Plugin { name: String, enabled: bool },
}

pub fn plan_at(home: &Path, what: Toggle, lang: Lang) -> Result<Plan, String> {
    let r = match what {
        Toggle::Skill { name, enabled: true } => write::plan_enable_skill(home, &name, lang),
        Toggle::Skill { name, enabled: false } => write::plan_disable_skill(&light(home, lang), &name, None),
        Toggle::Mcp { project, name, enabled } => write::plan_toggle_mcp(&light(home, lang), Path::new(&project), &name, enabled),
        Toggle::Hook { event, command, enabled } => write::plan_toggle_hook(&light(home, lang), &event, &command, enabled),
        Toggle::Plugin { name, enabled } => write::plan_toggle_plugin(&light(home, lang), &name, enabled),
    };
    r.map_err(|e| e.to_string())
}

pub fn apply_at(home: &Path, plan: &Plan) -> Result<String, String> {
    write::apply(home, plan).map(|a| format!("{} ({}: {})", a.summary, crate::i18n::tr("백업", "backup"), a.backup_dir.display())).map_err(|e| e.to_string())
}

/// 이름 목록을 한 줄로 — 길면 앞 30개 + "외 N"
fn names<'a>(it: impl Iterator<Item = &'a str>, ko: bool) -> String {
    let all: Vec<&str> = it.collect();
    let mut out = all.iter().take(30).copied().collect::<Vec<_>>().join(", ");
    if all.len() > 30 {
        let n = all.len() - 30;
        out.push_str(&if ko { format!(" … 외 {n}") } else { format!(" … and {n} more") });
    }
    if out.is_empty() { "-".into() } else { out }
}

/// 오케스트레이터가 읽는 글 보고(scripts/app harness) — 개수·꺼 둔 것·이름·진단. 고치는 길(화면)과 "사용자 확인 뒤" 를 끝에 붙인다.
/// project 를 주면 그 프로젝트 칸과 그 프로젝트에 걸리는 진단만(글로벌 진단은 늘 포함)
pub fn report_at(home: &Path, lang: Lang, project: Option<&str>) -> String {
    let ko = lang.is_ko();
    let t = |k: &str, e: &str| if ko { k.to_string() } else { e.to_string() };
    let n = |v: usize, k: &str, e: &str| if ko { format!("{k} {v}개") } else { format!("{v} {e}(s)") };
    let off = |v: usize| if v == 0 { String::new() } else if ko { format!(" (꺼 둔 것 {v})") } else { format!(" ({v} off)") };
    let s = scan_once(home, lang);
    let g = &s.global;
    let short = |p: &Path| crate::config::tilde(&home.to_string_lossy(), &p.to_string_lossy());
    let mut out = vec![
        format!("{} — {}", t("하네스", "Harness"), short(&home.join(".claude"))),
        format!(
            "{}: {}{} · {} · {}{} · {}",
            t("글로벌", "Global"),
            n(g.skills.len(), "스킬", "skill"),
            off(g.disabled_skills.len()),
            n(g.mcp.len(), "MCP", "MCP server"),
            n(g.hooks.len(), "훅", "hook"),
            off(g.disabled_hooks.len()),
            n(g.plugins.len(), "플러그인", "plugin"),
        ),
        format!("  {}: {}", t("스킬", "Skills"), names(g.skills.iter().map(|x| x.name.as_str()), ko)),
        format!("  MCP: {}", names(g.mcp.iter().map(|x| x.name.as_str()), ko)),
        format!("  {}: {}", t("플러그인", "Plugins"), names(g.plugins.iter().map(|p| if p.enabled { p.name.as_str() } else { "" }).filter(|x| !x.is_empty()), ko)),
    ];
    let mut scope: Option<&harnitor_core::Project> = None;
    if let Some(want) = project.map(str::trim).filter(|w| !w.is_empty()) {
        scope = s.projects.iter().find(|p| p.name.eq_ignore_ascii_case(want) || p.path == Path::new(want));
        match scope {
            Some(p) => {
                out.push(format!("{} {} ({}): {} · {} · {}", t("프로젝트", "Project"), p.name, short(&p.path), n(p.skills.len(), "스킬", "skill"), n(p.mcp.len(), "MCP", "MCP server"), n(p.hooks.len(), "훅", "hook")));
                out.push(format!("  MCP: {}", names(p.mcp.iter().map(|x| x.name.as_str()), ko)));
                if !p.disabled_mcp.is_empty() {
                    out.push(format!("  {}: {}", t("이 프로젝트에서 꺼 둔 MCP", "MCP turned off here"), names(p.disabled_mcp.iter().map(String::as_str), ko)));
                }
            }
            None => out.push(t(&format!("프로젝트 {want} 를 못 찾았어 — 이름이나 경로로"), &format!("Project {want} not found — use its name or path"))),
        }
    }
    // 진단은 엔진 글 보고 — 늘 실리는 양(내역·부를 때만 읽혀도 되는 긴 섹션) → 문제·비용·상태 묶음, 근거 5개, 고치는 길(하니터 진단 v2)
    out.push(String::new());
    out.push(harnitor_core::report::harness_text(&s, scope.map(|p| p.path.as_path()), lang));
    out.push(String::new());
    out.push(t(
        "보기·끄고 켜기·되돌리기는 하니터 화면에서(scripts/app open harnitor). 끄거나 지우는 건 사용자 확인 뒤에 — 바꾼 건 새로 켜는 세션부터 먹는다",
        "View, toggle and undo in the Harnitor screen (scripts/app open harnitor). Turn things off or remove them only after the user confirms — changes apply to newly started sessions",
    ));
    out.join("\n")
}

/// 지금 도는 세션(하니터 세션 칸). ps·lsof 로 찾는데 윈도우엔 둘 다 없다 — 빈 목록(참모 사이드바가 세션을 이미 보여 준다)
pub fn sessions_at(home: &Path) -> Vec<Session> {
    if cfg!(windows) {
        return vec![];
    }
    harnitor_core::session::scan_sessions(home)
}

#[tauri::command]
pub async fn harnitor_scan(app: tauri::AppHandle, lang: String) -> Result<Scan, String> {
    watch(&app);
    off_thread(move || scan_once(&home(), Lang::parse(&lang))).await
}

#[tauri::command]
pub async fn harnitor_scan_fast(lang: String) -> Result<Scan, String> {
    off_thread(move || {
        let h = home();
        let seen = USAGE.get().and_then(|c| c.get(&h)).unwrap_or_default();
        full(&h, Lang::parse(&lang), Some(seen))
    })
    .await
}

#[tauri::command]
pub async fn harnitor_peek_undo() -> Result<Option<write::UndoPeek>, String> {
    off_thread(|| write::peek_undo(&home()).map_err(|e| e.to_string())).await?
}

#[tauri::command]
pub async fn harnitor_plan_disable(name: String, lang: String) -> Result<Plan, String> {
    off_thread(move || plan_at(&home(), Toggle::Skill { name, enabled: false }, Lang::parse(&lang))).await?
}

#[tauri::command]
pub async fn harnitor_plan_enable(name: String, lang: String) -> Result<Plan, String> {
    off_thread(move || plan_at(&home(), Toggle::Skill { name, enabled: true }, Lang::parse(&lang))).await?
}

#[tauri::command]
pub async fn harnitor_plan_toggle_mcp(project: String, name: String, enabled: bool, lang: String) -> Result<Plan, String> {
    off_thread(move || plan_at(&home(), Toggle::Mcp { project, name, enabled }, Lang::parse(&lang))).await?
}

#[tauri::command]
pub async fn harnitor_plan_toggle_hook(event: String, command: String, enabled: bool, lang: String) -> Result<Plan, String> {
    off_thread(move || plan_at(&home(), Toggle::Hook { event, command, enabled }, Lang::parse(&lang))).await?
}

#[tauri::command]
pub async fn harnitor_plan_toggle_plugin(name: String, enabled: bool, lang: String) -> Result<Plan, String> {
    off_thread(move || plan_at(&home(), Toggle::Plugin { name, enabled }, Lang::parse(&lang))).await?
}

/// 계획을 실제로 — 백업(~/.claude/.harnitor/backups)이 먼저 생긴다
#[tauri::command]
pub async fn harnitor_apply_plan(plan: Plan) -> Result<String, String> {
    off_thread(move || apply_at(&home(), &plan)).await?
}

#[tauri::command]
pub async fn harnitor_undo() -> Result<String, String> {
    off_thread(|| write::undo(&home()).map_err(|e| e.to_string())).await?
}

/// 프로젝트 폴더 구조(구조 탭) — 부를 때만 읽는다. 깊이는 8까지
#[tauri::command]
pub async fn harnitor_folder_tree(path: String, depth: usize) -> Result<harnitor_core::tree::FolderNode, String> {
    off_thread(move || harnitor_core::tree::scan_tree(Path::new(&path), depth.min(8))).await
}

#[tauri::command]
pub async fn harnitor_sessions() -> Result<Vec<Session>, String> {
    off_thread(|| sessions_at(&home())).await
}

/// ~/.claude 의 스킬·훅·설정·지침이 바뀌면 화면을 다시 그리게(window.__harnitorChanged) — 손보면서 켜 두는 도구라 제품의 일부다.
/// 처음 화면을 열 때 한 번 띄우고 계속 둔다(조용할 땐 일이 없다). 몰아친 이벤트는 잦아든 뒤 한 번(하니터 실측: 바로 쏘면 SKILL.md 쓰기 전을 읽었다)
fn watch<R: Runtime>(app: &tauri::AppHandle<R>) {
    static ON: OnceLock<()> = OnceLock::new();
    if ON.set(()).is_err() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        use notify::{RecursiveMode, Watcher};
        let (tx, rx) = std::sync::mpsc::channel();
        let Ok(mut w) = notify::recommended_watcher(tx) else { return };
        let claude = home().join(".claude");
        // 대화 기록(projects/)은 계속 커져서 안 본다
        for sub in ["skills", "hooks", "settings.json", ".mcp.json", "CLAUDE.md", "plugins/installed_plugins.json"] {
            let p = claude.join(sub);
            if p.exists() {
                let _ = w.watch(&p, RecursiveMode::Recursive);
            }
        }
        let quiet = std::time::Duration::from_millis(250);
        let mut pending = false;
        loop {
            match rx.recv_timeout(quiet) {
                Ok(_) => pending = true,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) if pending => {
                    pending = false;
                    if let Some(m) = app.get_webview_window("main") {
                        let _ = m.eval("window.__harnitorChanged && window.__harnitorChanged()");
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 화면_원본에_데이터_자리가_딱_하나() {
        // 하니터 사본을 새로 들였는데 자리가 없어지면 다리가 안 붙어 빈 화면이 된다
        assert_eq!(UI.matches(SLOT).count(), 1);
        assert!(UI.contains("const TAURI = window.__TAURI__"));
    }

    #[test]
    fn 두_번째_열기는_첫_화면_그림을_건너뛴다() {
        // 2026-10-02 사용자 "첫 로드는 상관없는데 두 번째부터는 열리는 애니메이션 안 나와도" — 빠른 스캔(0.7초)인데 그림은 최소 1.65초였다
        assert!(page("ko", false).contains("var quick=false;"));
        let p = page("ko", true);
        assert!(p.contains("var quick=true;"));
        assert!(p.contains("getElementById('splash')"), "그림을 떼는 줄이 없다");
        assert!(p.contains("w[2]==='scan'"), "스캔 답이 오면 화면을 다시 보여야 한다");
    }

    #[test]
    fn 다리는_고른_것을_알리고_되살린다() {
        // 화면 감지(2026-10-02 사용자): 하니터에서 고른 프로젝트·항목을 부모에 알리고({harnitor:'view'}), 탭에 돌아오면 그 버튼을 다시 누른다({harnitor:'restore'})
        let p = page("ko", false);
        assert!(p.contains("harnitor:'view'"));
        assert!(p.contains("d.harnitor==='restore'"));
        assert!(p.contains("#pjList .pj[data-path="), "하니터 자기 버튼으로 되살린다(변수를 직접 바꾸면 화면이 안 따라온다)");
    }

    #[test]
    fn 다리는_tauri_를_읽기_전에_끼운다() {
        let p = page("ko", false);
        assert!(!p.contains(SLOT));
        let bridge = p.find("window.__TAURI__={core:").unwrap();
        assert!(bridge < p.find("const TAURI = window.__TAURI__").unwrap());
        assert!(p.contains("parent.postMessage({harnitor:'invoke'"));
        assert!(p.contains("localStorage.setItem('harnitor-lang','ko')"));
        assert!(p.contains("#tabBp,#bLang{display:none"));
        assert!(p.contains(".dcard,.d{border-left-width:1px!important}"), "왼쪽 색 띠를 못 지웠다");
        // 참모 색 — 변수 이름은 --소문자 만 받는다(아무 속성이나 못 넣게)
        assert!(p.contains("d.harnitor==='theme'") && p.contains("/^--[a-z0-9-]+$/"));
        assert!(!STYLE.contains('\''), "스타일에 따옴표가 들어가면 다리 문자열이 깨진다");
        // Esc 는 하니터가 먼저 쓴다(팔레트·메뉴·확인 창 닫기) — 안 쓴 Esc 만 패널을 닫는다
        assert!(p.contains("!e.defaultPrevented&&!document.querySelector('.modalback"));
    }

    fn used(skill: &str, count: usize) -> Usage {
        Usage { skill: skill.into(), count, last_used: None, not_in_files: false }
    }

    #[test]
    fn 호출_기록은_같은_홈일_때만_다시_쓴다() {
        // 첫 열기는 전체 스캔(실제 하네스 8.7초), 두 번째부터 빠른 스캔 + 첫 열기 때 센 기록(2026-10-01 사용자 (b))
        let c = UsageCache::default();
        let (a, b) = (Path::new("/h/a"), Path::new("/h/b"));
        assert!(c.get(a).is_none(), "처음엔 기억이 없다 — 전체 스캔");
        c.remember(a, &[used("x", 3)]);
        assert_eq!(c.get(a).unwrap()[0].count, 3);
        assert!(c.get(b).is_none(), "다른 홈(HARNITOR_HOME 시험)의 기록을 섞어 쓰면 안 쓰는 스킬 진단이 틀린다");
        c.remember(b, &[]);
        assert!(c.get(a).is_none() && c.get(b).is_some(), "마지막 홈 하나만 기억");
    }

    #[test]
    fn 언어는_ko_en_만() {
        assert!(page("en", false).contains("'harnitor-lang','en'"));
        assert!(page("ja", false).contains("'harnitor-lang','ko'"));
        assert!(page("');alert(1);//", false).contains("'harnitor-lang','ko'"));
    }

    #[test]
    fn 시험용_홈은_harnitor_home_이_먼저() {
        assert_eq!(home_from(Some("/tmp/fake".into()), "/Users/me".into()), PathBuf::from("/tmp/fake"));
        assert_eq!(home_from(Some("  ".into()), "/Users/me".into()), PathBuf::from("/Users/me"));
        assert_eq!(home_from(None, "/Users/me".into()), PathBuf::from("/Users/me"));
    }

    /// 가짜 홈 — 훅 하나가 걸린 settings.json
    fn fake_home(tag: &str) -> PathBuf {
        let h = std::env::temp_dir().join(format!("harnitor-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        std::fs::create_dir_all(h.join(".claude")).unwrap();
        std::fs::write(
            h.join(".claude/settings.json"),
            r#"{"model":"opus","hooks":{"UserPromptSubmit":[{"matcher":"","hooks":[{"type":"command","command":"bash ~/.claude/hooks/x.sh"}]}]}}"#,
        )
        .unwrap();
        h
    }

    #[test]
    fn 훅_끄기_적용_되돌리기_한_바퀴() {
        let h = fake_home("hook");
        let before = std::fs::read_to_string(h.join(".claude/settings.json")).unwrap();
        let plan = plan_at(&h, Toggle::Hook { event: "UserPromptSubmit".into(), command: "bash ~/.claude/hooks/x.sh".into(), enabled: false }, Lang::Ko).unwrap();
        // 계획만 세웠을 땐 그대로
        assert_eq!(std::fs::read_to_string(h.join(".claude/settings.json")).unwrap(), before);
        let msg = apply_at(&h, &plan).unwrap();
        assert!(msg.contains(".harnitor"), "백업 자리를 알려 줘야 한다: {msg}");
        let after = std::fs::read_to_string(h.join(".claude/settings.json")).unwrap();
        assert!(!after.contains("x.sh"), "훅이 안 빠졌다: {after}");
        assert!(after.contains("opus"), "다른 설정을 건드렸다");
        assert!(write::peek_undo(&h).unwrap().is_some());
        write::undo(&h).unwrap();
        let back: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(h.join(".claude/settings.json")).unwrap()).unwrap();
        assert_eq!(back, serde_json::from_str::<serde_json::Value>(&before).unwrap());
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn 없는_스킬_끄기는_오류로() {
        let h = fake_home("noskill");
        assert!(plan_at(&h, Toggle::Skill { name: "없는-스킬".into(), enabled: false }, Lang::Ko).is_err());
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn 글_보고는_개수_꺼둔_것_진단을_말한다() {
        let h = fake_home("report");
        std::fs::create_dir_all(h.join(".claude/skills/alpha")).unwrap();
        std::fs::write(h.join(".claude/skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: 알파 스킬\n---\n본문").unwrap();
        let t = report_at(&h, Lang::Ko, None);
        assert!(t.contains("스킬 1개"), "{t}");
        assert!(t.contains("훅 1개"), "{t}");
        // 진단은 엔진 글 보고(harness_text) — 늘 실리는 양이 맨 위, 진단은 문제→비용→상태, 고치는 길 붙음(하니터 진단 v2)
        assert!(t.contains("늘 실리는 양"), "{t}");
        assert!(t.contains("scripts/app open harnitor"), "고치는 길을 알려 줘야 한다: {t}");
        // 꺼 둔 훅은 꺼 둔 것으로 센다
        let plan = plan_at(&h, Toggle::Hook { event: "UserPromptSubmit".into(), command: "bash ~/.claude/hooks/x.sh".into(), enabled: false }, Lang::Ko).unwrap();
        apply_at(&h, &plan).unwrap();
        let t = report_at(&h, Lang::Ko, None);
        assert!(t.contains("훅 0개 (꺼 둔 것 1)"), "{t}");
        assert!(report_at(&h, Lang::En, None).contains("1 skill"));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn 없는_프로젝트를_물으면_그렇다고() {
        let h = fake_home("noproj");
        let t = report_at(&h, Lang::Ko, Some("없는것"));
        assert!(t.contains("없는것") && t.contains("못 찾았"), "{t}");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn 스캔은_가짜_홈의_훅을_본다() {
        let h = fake_home("scan");
        let s = full(&h, Lang::Ko, Some(vec![]));
        assert_eq!(s.home, h);
        assert!(serde_json::to_string(&s).unwrap().contains("x.sh"));
        let _ = std::fs::remove_dir_all(&h);
    }
}
