//! 브라우저 자동화 '딸깍' 설치 — 설정의 '설치' 하나로 없는 것만 차례로: Node → 크롬 베타 → 도구 부품 → 시험 열기(사용자 2026-10-05).
//! 관리자 암호 없이, 사람이 누른 뒤에만 받는다. 받은 건 쓰기 전에 검증(browser_node·browser_chrome). 진행은 STATE 를 화면이 0.5초마다 읽는다
use crate::browser_chrome as bc;
use crate::browser_get::{self as bg, MB};
use crate::browser_node::{self as bn, NodeChoice};
use crate::browser_parts as bp;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Step {
    Node,
    Chrome,
    Parts,
    Check,
}

impl Step {
    /// (화면 열쇠, 전체 막대 몫, 시작 전 남아 있어야 할 디스크) — 크롬이 가장 크다(279MB 받아 730MB)
    fn spec(self) -> (&'static str, u32, u64) {
        match self {
            Step::Node => ("node", 15, 400 * MB),
            Step::Chrome => ("chrome", 55, 1600 * MB),
            Step::Parts => ("parts", 20, 300 * MB),
            Step::Check => ("check", 10, 0),
        }
    }
}

/// 지금 있는 것
#[derive(Debug, Default, Clone, Copy)]
pub struct Have {
    pub node: bool,
    pub chrome_beta: bool,
    pub parts: bool,
    pub checked: bool,
}

/// 없는 것만. 하나라도 받았거나 시험을 안 했으면 마지막에 시험 열기
pub fn plan(h: Have) -> Vec<Step> {
    let have = [(h.node, Step::Node), (h.chrome_beta, Step::Chrome), (h.parts, Step::Parts)];
    let mut v: Vec<Step> = have.into_iter().filter(|(ok, _)| !ok).map(|(_, s)| s).collect();
    if !v.is_empty() || !h.checked {
        v.push(Step::Check);
    }
    v
}

/// 전체 진행(0~100) — i 번째 단계가 frac 만큼. frac 을 모르면 None(막대가 흐른다)
pub fn overall(steps: &[Step], i: usize, frac: Option<f64>) -> Option<u8> {
    let total: u32 = steps.iter().map(|s| s.spec().1).sum();
    let done: u32 = steps[..i.min(steps.len())].iter().map(|s| s.spec().1).sum();
    let frac = frac?.clamp(0.0, 1.0);
    let cur = steps.get(i).map_or(0.0, |s| s.spec().1 as f64 * frac);
    Some(((done as f64 + cur) * 100.0 / total.max(1) as f64).round() as u8)
}

/// 시스템 node(PATH·brew 자리) — (경로, 판, 큰 판). 셸 임시 경로(fnm)면 실제 경로로, brew 버전 폴더면 opt 로
pub fn system_node(data: &Path) -> Option<(String, String, u32)> {
    let home = crate::config::home();
    let p = crate::setup::pick_bin("node", &home, &std::env::var("PATH").unwrap_or_default(), |p| Path::new(p).is_file())?;
    // 우리 링크·우리 node 는 시스템 것이 아니다
    if Path::new(&p).starts_with(data.join("tools")) {
        return None;
    }
    let p = if bn::ephemeral(&p) {
        let real = std::fs::canonicalize(&p).ok()?.to_string_lossy().into_owned();
        bn::stable_node(&real, |q| Path::new(q).exists())
    } else {
        bn::stable_node(&p, |q| Path::new(q).exists())
    };
    let (v, m) = bn::version_of(Path::new(&p))?;
    Some((p, v, m))
}

/// 우리 node 가 제대로 도나
fn ours_ok(data: &Path) -> Option<String> {
    bn::version_of(&bn::our_node(data, cfg!(windows))).and_then(|(v, m)| (m >= crate::browser::MIN_NODE).then_some(v))
}

/// 고른 node — (경로, 판, 어디 것). 없으면 None
pub fn chosen_node(data: &Path) -> Option<(PathBuf, String, &'static str)> {
    let sys = system_node(data);
    let ours = ours_ok(data);
    let npm = |p: &str| bn::npm_cli(Path::new(p), cfg!(windows), |q| std::fs::canonicalize(q).ok()).is_some();
    match bn::choose(sys.as_ref().map(|(p, _, m)| (p.clone(), *m, npm(p))), ours.is_some()) {
        NodeChoice::System(p) => Some((PathBuf::from(p), sys.map(|s| s.1).unwrap_or_default(), "system")),
        NodeChoice::Ours => Some((bn::our_node(data, cfg!(windows)), ours.unwrap_or_default(), "ours")),
        NodeChoice::Download => None,
    }
}

/// <데이터>/tools/bin/node 링크를 고른 node 로(맥) — 앱을 켤 때·설치 끝에. 도구를 안 깐 사용자에겐 안 만든다
#[cfg(unix)]
pub fn ensure_link(data: &Path) {
    if !crate::browser::tool_dir(data).join("bin").is_dir() {
        return;
    }
    let target = match chosen_node(data) {
        Some((_, _, "ours")) => PathBuf::from("../node/bin/node"),
        Some((p, _, _)) => p,
        None => return,
    };
    let _ = crate::browser_fix::point_link(&crate::browser_fix::node_link(data), &target);
}
#[cfg(windows)]
pub fn ensure_link(_data: &Path) {}

pub fn have(data: &Path) -> Have {
    let home = crate::config::home();
    Have {
        node: chosen_node(data).is_some(),
        chrome_beta: bc::beta_installed(cfg!(windows), &home, |k| std::env::var(k).ok(), |p| p.exists()).is_some(),
        parts: crate::browser::installed(data),
        checked: bp::checked_mark(data).is_file(),
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SetupState {
    pub running: bool,
    /// 지금 단계(node·chrome·parts·check)
    pub step: Option<String>,
    /// 전체 진행 0~100. 크기를 모르는 동안 None(막대가 흐른다)
    pub pct: Option<u8>,
    /// 단계 글 한 줄
    pub text: String,
    /// 실패 이유 — 화면은 이유 + 다시 시도
    pub error: Option<String>,
    /// 끝났는데 남은 것 한 줄(맥 권한 창 답 대기 등) — 설치 완료는 막지 않는다
    pub note: Option<String>,
    pub done: bool,
}

static STATE: Mutex<Option<SetupState>> = Mutex::new(None);
static RUNNING: AtomicBool = AtomicBool::new(false);

fn set(f: impl FnOnce(&mut SetupState)) {
    let mut g = STATE.lock().unwrap();
    let s = g.get_or_insert_with(SetupState::default);
    f(s);
}

fn mb(b: u64) -> String {
    format!("{}MB", b / MB)
}

/// 단계 하나 — 진행은 set 으로
fn run_step(step: Step, data: &Path, work: &Path, at: &dyn Fn(Option<f64>, String)) -> Result<(), String> {
    use crate::i18n::tr;
    let win = cfg!(windows);
    if let Some(e) = bg::disk_short(bg::free_bytes(data), step.spec().2) {
        return Err(e);
    }
    let bar = |label: &'static str| move |got: u64, total: Option<u64>| at(total.filter(|t| *t > 0).map(|t| got as f64 / t as f64), match total {
        Some(t) => format!("{label} ({}/{})", mb(got), mb(t)),
        None => format!("{label} ({})", mb(got)),
    });
    match step {
        Step::Node => {
            let (file, sha) = bn::node_pin(win, std::env::consts::ARCH).ok_or(tr("이 기계용 Node 판이 없어요", "No Node build for this machine"))?;
            let a = work.join(file);
            bg::download(&bn::node_url(file), &a, &bar(tr("Node.js 받는 중", "Downloading Node.js")))?;
            at(None, tr("Node.js 푸는 중", "Unpacking Node.js").into());
            bn::install_archive(&a, sha, &data.join("tools"), win)?;
            let _ = std::fs::remove_file(&a);
            match bn::version_of(&bn::our_node(data, win)) {
                Some((v, _)) if v == bn::NODE_VERSION => Ok(()),
                other => Err(format!("{} ({other:?})", tr("받은 Node 가 실행되지 않아요", "The downloaded Node does not run"))),
            }
        }
        Step::Chrome if win => {
            let setup = work.join("ChromeBetaSetup.exe");
            bg::download(bc::BETA_WIN, &setup, &bar(tr("크롬 베타 받는 중", "Downloading Chrome Beta")))?;
            let home = crate::config::home();
            let r = bc::install_beta_win(&setup, &|| bc::beta_installed(true, &home, |k| std::env::var(k).ok(), |p| p.exists()).is_some(), &|t| at(None, t.into()));
            let _ = std::fs::remove_file(&setup);
            r
        }
        Step::Chrome => {
            let dmg = work.join("googlechromebeta.dmg");
            bg::download(bc::BETA_DMG, &dmg, &bar(tr("크롬 베타 받는 중", "Downloading Chrome Beta")))?;
            let home = crate::config::home();
            let dest = bc::app_dest(bc::writable(Path::new("/Applications")), &home);
            let r = bc::install_beta_mac(&dmg, work, &dest, &|t| at(None, t.into()));
            let _ = std::fs::remove_file(&dmg);
            r.map(|_| ())
        }
        Step::Parts => {
            at(None, tr("도구 부품 받는 중", "Downloading the tool parts").into());
            let (node, _, _) = chosen_node(data).ok_or(tr("Node.js 가 없어요", "Node.js is not installed"))?;
            let dir = crate::browser::export(data).map_err(|e| e.to_string())?;
            bp::npm_ci(&node, &dir)
        }
        Step::Check => {
            at(None, tr("시험으로 한 번 열어 보는 중", "Opening a test page").into());
            let (node, _, _) = chosen_node(data).ok_or(tr("Node.js 가 없어요", "Node.js is not installed"))?;
            bp::run_check(&node, data).map(|_| ())
        }
    }
}

/// 남은 받기 찌꺼기 — 반쪽 파일·붙은 채 남은 DMG(앱이 도중에 꺼졌을 때)
fn clean_work(work: &Path) {
    if let Ok(rd) = std::fs::read_dir(work) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().starts_with("mnt-") {
                bc::detach(&e.path());
            }
        }
    }
    let _ = std::fs::remove_dir_all(work);
}

/// 설치 한 바퀴 — 없는 것만 차례로. 하나라도 실패하면 거기서 멈추고 이유를 남긴다(받은 것은 그대로 — 다시 시도하면 남은 것만)
pub fn run(data: &Path) -> Result<(), String> {
    let work = data.join("tools/.download");
    clean_work(&work);
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(bp::checked_mark(data));
    let steps = plan(have(data));
    let mut result = Ok(());
    for (i, step) in steps.iter().enumerate() {
        set(|s| {
            s.step = Some(step.spec().0.into());
            s.pct = overall(&steps, i, Some(0.0));
        });
        let at = |frac: Option<f64>, text: String| set(|s| {
            s.pct = overall(&steps, i, frac);
            s.text = text;
        });
        if let Err(e) = run_step(*step, data, &work, &at) {
            result = Err(e);
            break;
        }
        // 노드가 생기면 바로 링크 — 부품·시험이 실패해도 .mcp.json 이 쓸 node 는 맞게
        if *step == Step::Node {
            ensure_link(data);
        }
    }
    let _ = std::fs::remove_dir_all(&work);
    if result.is_ok() {
        ensure_link(data);
        // 낡은 .mcp.json 고치기는 프로젝트 폴더를 읽는다 — 그 폴더가 맥 보호 폴더(데스크탑 등)면 권한 창 답을 기다리며 멈춰
        // '시험으로 한 번 열어 보는 중'에서 안 끝났다(2026-10-05 아이맥 QA). 설치는 끝난 것 — 정리는 뒤에서 잇고 이유를 한 줄
        let d = data.to_path_buf();
        if !within(std::time::Duration::from_secs(5), move || { crate::browser_fix::fix_all(&d); }) {
            set(|s| s.note = Some(crate::i18n::tr("프로젝트 폴더 정리는 맥 권한 창 답을 기다리며 뒤에서 이어서 해요", "Tidying project folders continues in the background while macOS waits for your permission answer").into()));
        }
    }
    result
}

/// f 를 뒤에서 돌리고 limit 까지만 기다린다 — 끝났으면 true. 안 끝나면 f 는 뒤에서 계속 돈다
fn within(limit: std::time::Duration, f: impl FnOnce() + Send + 'static) -> bool {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        f();
        let _ = tx.send(());
    });
    rx.recv_timeout(limit).is_ok()
}

/// '설치' — 이미 도는 중이면 아무 일도 안 한다
#[tauri::command]
pub fn browser_setup_start() {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    set(|s| *s = SetupState { running: true, text: crate::i18n::tr("준비하는 중", "Getting ready").into(), ..Default::default() });
    std::thread::spawn(|| {
        // 패닉해도 '도는 중'에 갇히지 않게 실패로
        let r = std::panic::catch_unwind(|| run(crate::config::data_dir())).unwrap_or_else(|_| Err("internal error".into()));
        set(|s| {
            s.running = false;
            s.done = r.is_ok();
            s.error = r.err();
            if s.done {
                s.pct = Some(100);
                s.text = crate::i18n::tr("준비됐어요", "Ready").into();
            }
        });
        RUNNING.store(false, Ordering::SeqCst);
    });
}

#[tauri::command]
pub fn browser_setup_state() -> SetupState {
    STATE.lock().unwrap().clone().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    // 마지막 정리(.mcp.json 고치기)가 맥 권한 창 답을 기다리며 멈춰도 설치 끝 표시를 막지 않는다(2026-10-05 아이맥 QA)
    #[test]
    fn 마지막_정리가_멈춰도_시간_안에_돌아온다() {
        let t = std::time::Instant::now();
        assert!(!within(std::time::Duration::from_millis(200), || std::thread::sleep(std::time::Duration::from_secs(3))));
        assert!(t.elapsed() < std::time::Duration::from_secs(1), "멈춘 정리를 기다렸다");
        assert!(within(std::time::Duration::from_secs(2), || {}));
    }

    #[test]
    fn 없는_것만_하고_하나라도_했으면_시험_열기() {
        let all = Have { node: true, chrome_beta: true, parts: true, checked: true };
        assert_eq!(plan(all), vec![]); // 이미 다 됨 — 아무것도 안 받는다
        assert_eq!(plan(Have { checked: false, ..all }), vec![Step::Check]); // 옛 설치(시험 표시 없음)는 시험만
        assert_eq!(plan(Have { chrome_beta: false, ..all }), vec![Step::Chrome, Step::Check]);
        assert_eq!(plan(Have::default()), vec![Step::Node, Step::Chrome, Step::Parts, Step::Check]);
    }

    #[test]
    fn 전체_진행은_단계_몫으로() {
        let s = [Step::Node, Step::Chrome, Step::Parts, Step::Check];
        assert_eq!(overall(&s, 0, Some(0.0)), Some(0));
        assert_eq!(overall(&s, 1, Some(0.5)), Some(43)); // 15 + 27.5
        assert_eq!(overall(&s, 3, Some(1.0)), Some(100));
        assert_eq!(overall(&s, 2, None), None);
        assert_eq!(overall(&[Step::Check], 0, Some(2.0)), Some(100)); // 넘친 비율은 자른다
    }


    /// 이 맥에서 한 바퀴(시험 데이터 폴더) — 손으로: cargo test 한_바퀴_진짜로 -- --ignored --nocapture
    #[cfg(unix)]
    #[test]
    #[ignore]
    fn 한_바퀴_진짜로() {
        let d = std::env::temp_dir().join(format!("chammo-run-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        crate::browser::export(&d).unwrap();
        run(&d).unwrap();
        assert!(plan(have(&d)).is_empty(), "{:?}", have(&d));
        assert!(std::fs::metadata(crate::browser_fix::node_link(&d)).is_ok()); // 링크가 도는 node 를 가리킨다
        assert!(!d.join("tools/.download").exists());
        eprintln!("checked={} link={:?}", std::fs::read_to_string(crate::browser_parts::checked_mark(&d)).unwrap(), std::fs::read_link(crate::browser_fix::node_link(&d)).unwrap());
        let _ = std::fs::remove_dir_all(&d);
    }
}
