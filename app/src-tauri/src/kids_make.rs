//! 바로 만들기(1단계 다섯째 조각, 사용자 11-17 "밤에 만들어 둘게로 미루지 말고 바로") — 말 앞단(도구 없는 아이 세션)이 답 끝에
//! `[만들기 <종류> <이름>: <할 일>]`·`[고치기 <이름>: <할 일>]` 표시를 내면, 앱이 그 자리에서 가까운 틀을 works/<이름>/index.html 로
//! 깔고(첫 화면) 만들기 세션(같은 막힘 인자, 그 폴더)이 그 뼈대를 고쳐 키운다. 패드는 파일이 바뀔 때마다 다시 그린다.
//! 작품 내주기는 인터넷 0 — CSP(default-src 'none'·connect-src 'none') 머리를 붙이고, 아이 집 안 그림만 data: 로 넣는다.
//! 캐릭터 그림(선생님 보관함 '캐릭터/')은 아이 집 chars/ 로 읽기 전용 복사 — 개인용이라 공개·팀으로 안 나간다
use base64::Engine as _;
use std::path::{Path, PathBuf};

const GAME: &str = include_str!("../kids/templates/game.html");
const ANIM: &str = include_str!("../kids/templates/anim.html");
const CARD: &str = include_str!("../kids/templates/card.html");
/// 만들기 세션 모델 — 만들기는 품질(말 앞단이 Haiku 로 먼저 답한다)
const MAKER_MODEL: &str = "sonnet";

#[derive(Debug, Clone, PartialEq)]
pub struct Order {
    /// Some = 새로 만들기(game·anim·card), None = 고치기
    pub kind: Option<String>,
    pub name: String,
    pub task: String,
}

fn slug(s: &str) -> String {
    let t: String = s.trim().to_ascii_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '/' }).collect();
    // 경로 글자는 나눔으로 보고 마지막 조각만(../../x → x)
    t.split('/').filter(|p| !p.is_empty() && p.chars().any(|c| c.is_ascii_alphanumeric())).last().unwrap_or("").trim_matches('-').chars().take(40).collect()
}

/// 답 글 → (소리·말풍선에 쓸 글, 만들기 표시들). 표시는 줄 어디에 있어도 뺀다
pub fn parse_orders(text: &str) -> (String, Vec<Order>) {
    let mut out = String::new();
    let mut orders = vec![];
    let mut rest = text;
    while let Some(i) = rest.find('[') {
        let Some(j) = rest[i..].find(']') else { break };
        let inner = &rest[i + 1..i + j];
        let parsed = (|| {
            let (head, task) = inner.split_once(':')?;
            let mut w = head.split_whitespace();
            let verb = w.next()?;
            let (kind, name) = match verb {
                "만들기" => {
                    let a = w.next()?;
                    let b = w.next();
                    let (k, n) = match b { Some(n) => (a, n), None => ("game", a) };
                    (Some(if matches!(k, "game" | "anim" | "card") { k.to_string() } else { "game".into() }), n)
                }
                "고치기" => (None, w.next()?),
                _ => return None,
            };
            let name = slug(name);
            (!name.is_empty()).then(|| Order { kind, name, task: task.trim().chars().take(300).collect() })
        })();
        match parsed {
            Some(o) => {
                out.push_str(&rest[..i]);
                orders.push(o);
            }
            None => out.push_str(&rest[..=i + j]),
        }
        rest = &rest[i + j + 1..];
    }
    out.push_str(rest);
    let said = out.lines().map(str::trim_end).filter(|l| !l.trim().is_empty()).collect::<Vec<_>>().join("\n").trim().to_string();
    (said, orders)
}

/// 틀 + 제목(할 일 앞부분)
fn template(kind: &str, task: &str) -> String {
    let t = match kind { "anim" => ANIM, "card" => CARD, _ => GAME };
    let title: String = task.chars().take(24).collect();
    let key = if kind == "card" { "\"message\":\"" } else { "\"title\":\"" };
    // CFG 안 첫 제목 값만 바꾼다(JSON 글 안이라 따옴표·역빗금은 뺀다)
    let safe: String = title.chars().filter(|c| !matches!(c, '"' | '\\' | '<' | '>')).collect();
    match t.find(key) {
        Some(i) => {
            let s = i + key.len();
            let e = t[s..].find('"').map(|x| s + x).unwrap_or(s);
            format!("{}{safe}{}", &t[..s], &t[e..])
        }
        None => t.to_string(),
    }
}

/// 만들기·고치기 시작 — 새 작품이면 틀을 바로 깔아 첫 화면을 띄운다(true). 이미 있으면 그대로(false)
pub fn start_in(k: &Path, o: &Order) -> Result<bool, String> {
    let dir = k.join("works").join(crate::avatar::safe_key(&o.name)?);
    let f = dir.join("index.html");
    if f.exists() {
        return Ok(false);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".index.{}", crate::tools::tmp_tag()));
    std::fs::write(&tmp, template(o.kind.as_deref().unwrap_or("game"), &o.task)).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(".title"), o.task.chars().take(40).collect::<String>()).map_err(|e| e.to_string())?;
    Ok(true)
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct Work {
    pub name: String,
    pub title: String,
    pub mtime: u64,
}

fn mtime_ms(p: &Path) -> u64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 작품들 — 최근에 바뀐 것부터
pub fn works_in(k: &Path) -> Vec<Work> {
    let mut v: Vec<Work> = std::fs::read_dir(k.join("works"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let f = e.path().join("index.html");
            f.exists().then(|| Work { title: std::fs::read_to_string(e.path().join(".title")).unwrap_or_else(|_| name.clone()).trim().to_string(), mtime: mtime_ms(&f), name })
        })
        .collect();
    v.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    v
}

fn is_pic(p: &Path) -> Option<&'static str> {
    match p.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// 캐릭터 이름들(chars/ 그림 파일 이름)
pub fn char_names(k: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(k.join("chars")).into_iter().flatten().flatten().filter(|e| is_pic(&e.path()).is_some()).filter_map(|e| e.path().file_stem()?.to_str().map(str::to_string)).collect();
    v.sort();
    v
}

/// 말 앞단에 붙이는 앱 줄 — 지금 작품(이름·제목)과 캐릭터 이름(그림 파일은 안 보여 준다)
pub fn context_line(k: &Path) -> String {
    let w: Vec<String> = works_in(k).iter().take(8).map(|w| format!("{}({})", w.name, w.title)).collect();
    let c = char_names(k);
    let mut parts = vec![];
    parts.push(format!("작품: {}", if w.is_empty() { "없음".into() } else { w.join(", ") }));
    if !c.is_empty() {
        parts.push(format!("캐릭터: {}", c.join(", ")));
    }
    format!("[앱 · {}]", parts.join(" · "))
}

const CSP: &str = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'\">";

/// 패드에 내줄 작품 HTML — 맨 앞에 CSP(인터넷 0), src="…" 그림은 아이 집 안이면 data: 로 넣고 아니면 비운다
pub fn serve_work(k: &Path, name: &str) -> Result<String, String> {
    let name = crate::avatar::safe_key(name)?;
    let dir = k.join("works").join(&name);
    let html = std::fs::read_to_string(dir.join("index.html")).map_err(|e| e.to_string())?;
    let home = std::fs::canonicalize(k).map_err(|e| e.to_string())?;
    let mut out = String::with_capacity(html.len() + 512);
    let mut rest = html.as_str();
    while let Some(i) = rest.find("src=\"") {
        out.push_str(&rest[..i + 5]);
        rest = &rest[i + 5..];
        let Some(j) = rest.find('"') else { break };
        let url = &rest[..j];
        if !url.starts_with("data:") {
            let local = (!url.contains(':') && !url.starts_with('/'))
                .then(|| std::fs::canonicalize(dir.join(url)).ok())
                .flatten()
                .filter(|p| p.starts_with(&home))
                .and_then(|p| is_pic(&p).map(|m| (p, m)))
                .and_then(|(p, m)| std::fs::read(&p).ok().filter(|b| b.len() <= 5_000_000).map(|b| format!("data:{m};base64,{}", base64::engine::general_purpose::STANDARD.encode(b))));
            out.push_str(&local.unwrap_or_default());
        } else {
            out.push_str(url);
        }
        rest = &rest[j..];
    }
    out.push_str(rest);
    // CSP 는 <head> 바로 뒤(없으면 맨 앞) — 문서 어떤 스크립트보다 먼저
    Ok(match out.find("<head>") {
        Some(h) => format!("{}{CSP}{}", &out[..h + 6], &out[h + 6..]),
        None => format!("{CSP}{out}"),
    })
}

/// 캐릭터 그림 상한 — 선생님 보관함 9개 시리즈 92장(11-18)이 다 들어가게
pub const CHAR_CAP: usize = 120;
const CHAR_MAX_BYTES: u64 = 5_000_000;

/// 내용이 정말 그림인가 — 확장자만 그림인 다른 파일(링크로 가리킨 글·실행 파일)은 안 가져간다
fn pic_bytes_ok(p: &Path, b: &[u8]) -> bool {
    match is_pic(p) {
        Some("image/png") => b.starts_with(&[0x89, b'P', b'N', b'G']),
        Some("image/jpeg") => b.starts_with(&[0xff, 0xd8, 0xff]),
        Some("image/gif") => b.starts_with(b"GIF8"),
        Some("image/webp") => b.len() > 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP",
        Some("image/svg+xml") => { let t = String::from_utf8_lossy(&b[..b.len().min(512)]); let t = t.trim_start(); t.starts_with("<svg") || t.starts_with("<?xml") }
        _ => false,
    }
}

/// 캐릭터 그림 고르기 — 맨 위 그림 + 한 단계 아래 폴더(링크면 따라가서, 보관함 밖이어도 그림만) 안 그림. 이름은 '<시리즈>-<캐릭터>'
/// (그림 이름이 이미 시리즈로 시작하면 그대로), 겹치면 -2·-3. 이름순으로 CHAR_CAP 장까지
pub fn char_sources(src: &Path) -> Vec<(String, PathBuf)> {
    let mut top: Vec<PathBuf> = std::fs::read_dir(src).into_iter().flatten().flatten().map(|e| e.path()).collect();
    top.sort();
    let mut picks: Vec<(String, PathBuf)> = vec![];
    let add = |stem: String, p: PathBuf, picks: &mut Vec<(String, PathBuf)>| {
        let base: String = stem.chars().filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':')).collect::<String>().trim().trim_start_matches('.').to_string();
        if base.is_empty() {
            return;
        }
        let mut name = base.clone();
        let mut n = 2;
        while picks.iter().any(|(x, _)| *x == name) {
            name = format!("{base}-{n}");
            n += 1;
        }
        picks.push((name, p));
    };
    for p in top {
        if picks.len() >= CHAR_CAP {
            break;
        }
        // is_dir·is_file 은 링크를 따라간다 — 시리즈 폴더가 다른 폴더(그림 묶음 출력)를 가리키는 링크다(11-18 0장 원인: 맨 위 파일만 봤다)
        if p.is_dir() {
            let series = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let mut inner: Vec<PathBuf> = std::fs::read_dir(&p).into_iter().flatten().flatten().map(|e| e.path()).filter(|q| q.is_file() && is_pic(q).is_some()).collect();
            inner.sort();
            for q in inner {
                if picks.len() >= CHAR_CAP {
                    break;
                }
                let stem = q.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                let name = if stem.starts_with(&format!("{series}-")) || stem == series { stem } else { format!("{series}-{stem}") };
                add(name, q, &mut picks);
            }
        } else if p.is_file() && is_pic(&p).is_some() {
            add(p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(), p, &mut picks);
        }
    }
    picks
}

/// 캐릭터 그림을 아이 집 chars/ 로(진짜 그림만, 장당 5MB, CHAR_CAP 장까지). 원본에서 빠진 건 지운다. 복사한 수
pub fn sync_chars_in(k: &Path, src: &Path) -> Result<usize, String> {
    let dst = k.join("chars");
    std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    let mut keep: Vec<std::ffi::OsString> = vec![];
    for (name, p) in char_sources(src) {
        let Some(ext) = p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()) else { continue };
        if std::fs::metadata(&p).map_or(true, |m| m.len() > CHAR_MAX_BYTES) {
            continue;
        }
        let file = format!("{name}.{ext}");
        let to = dst.join(&file);
        if !to.exists() || mtime_ms(&to) < mtime_ms(&p) {
            let Ok(b) = std::fs::read(&p) else { continue };
            if !pic_bytes_ok(&p, &b) {
                continue;
            }
            std::fs::write(&to, b).map_err(|e| e.to_string())?;
        }
        keep.push(file.into());
    }
    for e in std::fs::read_dir(&dst).map_err(|e| e.to_string())?.flatten() {
        if !keep.contains(&e.file_name()) {
            let _ = std::fs::remove_file(e.path());
        }
    }
    Ok(keep.len())
}

// ───────── 앱 쪽 ─────────

/// 만들기 세션에게 주는 첫 지시
fn maker_prompt(o: &Order) -> String {
    format!(
        "너는 아이 작품을 만드는 손이다. 이 폴더의 index.html 이 지금 화면에 떠 있는 뼈대다. 할 일: {}\n\
         - index.html 한 파일만 고친다. 먼저 10초 안에 눈에 띄는 것(제목·주인공·색)부터 Edit 로 바꿔 저장하고, 그다음 조금씩 Edit 로 고쳐 키운다 — 큰 덩어리를 한 번에 쓰지 않는다(저장할 때마다 아이 화면이 바뀐다).\n\
         - 인터넷·외부 주소·fetch 를 쓰지 않는다. 그림은 직접 그리거나 ../../chars/ 안 그림만 <img src=\"../../chars/이름.png\"> 로.\n\
         - 아이에게 말하지 않는다. 다 하면 '다 만들었어' 한 줄만.",
        o.task
    )
}

fn data() -> &'static Path {
    crate::config::data_dir()
}

/// 표시 하나 처리 — 틀을 깔고(새 작품) 그 작품의 만들기 세션에 맡긴다(살아 있으면 이어서, 없으면 새로)
pub(crate) fn order(key: &str, o: Order) {
    let Ok(k) = crate::kids::kid_dir(data(), key) else { return };
    let fresh = start_in(&k, &o).unwrap_or(false);
    let _ = crate::kids::log_line(&k, crate::notes::now_ms(), "app", &format!("{} {}: {}", if fresh { "만들기" } else { "고치기" }, o.name, o.task), None);
    let key = key.to_string();
    std::thread::spawn(move || {
        let Ok(name) = crate::avatar::safe_key(&o.name) else { return };
        let sess = k.join("works").join(&name).join(".session");
        let alive = std::fs::read_to_string(&sess).ok().map(|s| s.trim().to_string()).filter(|id| crate::kids_wire::alive(id));
        let res = match alive {
            Some(id) => tauri::async_runtime::block_on(crate::claude::send_text_to_session(id, format!("고칠 것: {}", o.task))),
            None => crate::kids::child_spawn(&k, &key, &name, &maker_prompt(&o), Some(MAKER_MODEL)).and_then(|(cwd, args)| {
                let cwd = cwd.to_string_lossy().into_owned();
                crate::trust::trust_own(&cwd);
                let out = crate::claude::spawn_plain(&cwd, &args)?;
                let id = crate::kids::bg_id(&out).ok_or_else(|| format!("세션 번호를 못 읽음: {out}"))?;
                std::fs::write(&sess, &id).map_err(|e| e.to_string())
            }),
        };
        if let Err(e) = res {
            crate::claude::log_out("kids", &format!("만들기 못 함 {name}: {e}"));
        }
    });
}

/// 선생님 보관함 '캐릭터/' — 그 참모 보관함 폴더(.chammo 에 참모 세션 번호)를 찾아 복사. 보관함을 연 적 없으면 안 건드린다(문서 폴더 권한 창)
pub(crate) fn sync_chars(key: &str) {
    let d = data();
    let home = crate::platform::home();
    let real = crate::config::is_real_data(&home, d);
    if real && !d.join(crate::locker_fs::OPENED_MARK).exists() {
        return;
    }
    let Ok(j) = crate::claude::agents_json_all() else { return };
    let hq = crate::config::hq_dir(&crate::config::home(), &crate::config::current(), |k| std::env::var(k).ok());
    let Some(id) = crate::kids_life::orch_id_in(&j, &hq, key) else { return };
    let root = crate::locker_fs::root_of(Path::new(&home), d, std::env::var("CHAMMO_LOCKER_ROOT").ok().as_deref(), real);
    let Some(owner) = std::fs::read_dir(&root).into_iter().flatten().flatten().map(|e| e.path()).find(|p| crate::locker_fs::id_of(p).as_deref() == Some(id.as_str())) else { return };
    let src = owner.join("캐릭터");
    if let (true, Ok(k)) = (src.is_dir(), crate::kids::kid_dir(d, key)) {
        let _ = sync_chars_in(&k, &src);
    }
}

#[cfg(test)]
#[path = "kids_make_tests.rs"]
mod tests;
