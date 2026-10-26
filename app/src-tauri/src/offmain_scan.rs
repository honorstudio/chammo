//! 소스 검사 — 동기 `#[tauri::command]`(메인 스레드)가 파일 시스템을 건드리면 실패한다.
//! 명령에서 호출을 따라가며(crate 안 함수만, `a::b(`·같은 파일·`use crate::a::b`) 파일 함수 낱말(FS)을 찾는다.
//! 통과하려면 셋 중 하나: offmain::READ·WRITE 에 넣는다(다른 스레드) / 그 길의 함수가 MAIN_OK(데이터 폴더만 만짐 — 이유를 적는다).
//! 데이터 폴더(~/.honor-orchestrator·CHAMMO_HOME)는 맥 보호 폴더가 아니라 메인 스레드에서 열어도 권한 창이 안 뜬다.
//! 못 잡는 것: 메서드 호출(`x.foo()`)·트레이트·외부 크레이트 안(portable-pty 가 cwd 를 is_dir 로 보는 것 같은) — 그런 건 손으로 목록에.
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// 다른 스레드로 넘기는 자리 — 괄호 안은 메인 스레드가 아니다
const SPAWNS: &[&str] = &["thread::spawn(", "spawn_blocking(", "async_runtime::spawn(", ".spawn(move"];

/// 주석·글자(문자열·문자)를 빈칸으로 — 줄 수는 그대로
pub(crate) fn strip(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let blank = |out: &mut Vec<u8>, seg: &[u8]| out.extend(seg.iter().map(|&c| if c == b'\n' { b'\n' } else { b' ' }));
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if b[i..].starts_with(b"//") {
            let j = b[i..].iter().position(|&x| x == b'\n').map_or(b.len(), |p| i + p);
            blank(&mut out, &b[i..j]);
            i = j;
        } else if b[i..].starts_with(b"/*") {
            let j = find(b, i + 2, b"*/").map_or(b.len(), |p| p + 2);
            blank(&mut out, &b[i..j]);
            i = j;
        } else if (c == b'r' || (c == b'b' && b.get(i + 1) == Some(&b'r'))) && !prev_ident(b, i) && raw_start(b, i).is_some() {
            let (open, hashes) = raw_start(b, i).unwrap();
            let mut end = vec![b'"'];
            end.extend(std::iter::repeat(b'#').take(hashes));
            let j = find(b, open, &end).map_or(b.len(), |p| p + end.len());
            out.extend_from_slice(b"\"\"");
            blank(&mut out, &b[(i + 2).min(j)..j]);
            i = j;
        } else if c == b'"' {
            let mut j = i + 1;
            while j < b.len() && b[j] != b'"' {
                j += if b[j] == b'\\' { 2 } else { 1 };
            }
            let j = (j + 1).min(b.len());
            out.extend_from_slice(b"\"\"");
            blank(&mut out, &b[(i + 2).min(j)..j]);
            i = j;
        } else if c == b'\'' {
            // 문자 'x'·'\n'·'\u{..}' 만 — 수명('a)은 그대로
            let j = if b.get(i + 1) == Some(&b'\\') {
                b[i + 2..].iter().position(|&x| x == b'\'').map(|p| i + 2 + p + 1)
            } else {
                let ch = std::str::from_utf8(&b[i + 1..(i + 5).min(b.len())]).ok().or_else(|| std::str::from_utf8(&b[i + 1..(i + 4).min(b.len())]).ok())
                    .or_else(|| std::str::from_utf8(&b[i + 1..(i + 3).min(b.len())]).ok()).or_else(|| std::str::from_utf8(&b[i + 1..(i + 2).min(b.len())]).ok());
                ch.and_then(|t| t.chars().next()).and_then(|ch| (b.get(i + 1 + ch.len_utf8()) == Some(&b'\'')).then_some(i + 2 + ch.len_utf8()))
            };
            match j {
                Some(j) => {
                    out.push(b'\'');
                    blank(&mut out, &b[i + 1..j]);
                    i = j;
                }
                None => {
                    out.push(c);
                    i += 1;
                }
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn prev_ident(b: &[u8], i: usize) -> bool {
    i > 0 && (b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_')
}

/// r"…"·r#"…"#·br"…" 시작이면 (따옴표 다음 자리, # 개수)
fn raw_start(b: &[u8], i: usize) -> Option<(usize, usize)> {
    let mut j = i + if b[i] == b'b' { 2 } else { 1 };
    let mut h = 0;
    while b.get(j) == Some(&b'#') {
        h += 1;
        j += 1;
    }
    (b.get(j) == Some(&b'"')).then_some((j + 1, h))
}

fn find(b: &[u8], from: usize, pat: &[u8]) -> Option<usize> {
    (from..b.len().saturating_sub(pat.len() - 1)).find(|&k| b[k..].starts_with(pat))
}

/// 여는 괄호 자리(open)에서 짝 맞는 닫는 괄호 자리
fn close_of(b: &[u8], open: usize) -> usize {
    let (o, c) = (b[open], if b[open] == b'(' { b')' } else { b'}' });
    let mut d = 0;
    for (k, &x) in b.iter().enumerate().skip(open) {
        if x == o {
            d += 1;
        } else if x == c {
            d -= 1;
            if d == 0 {
                return k;
            }
        }
    }
    b.len() - 1
}

/// #[cfg(test)] 붙은 것(시험 모듈·시험 전용 함수)을 뺀다
fn cut_tests(s: String) -> String {
    let mut s = s;
    while let Some(i) = s.find("#[cfg(test)]") {
        let b = s.as_bytes();
        let after = i + "#[cfg(test)]".len();
        let brace = find(b, after, b"{");
        let semi = find(b, after, b";");
        let end = match (brace, semi) {
            (Some(o), Some(sc)) if sc < o => sc + 1,
            (Some(o), _) => close_of(b, o) + 1,
            (None, Some(sc)) => sc + 1,
            (None, None) => s.len(),
        };
        s.replace_range(i..end, "");
    }
    s
}

/// 다른 스레드로 넘기는 괄호 안을 지운다
fn cut_spawns(body: &str) -> String {
    let mut s = body.to_string();
    for t in SPAWNS {
        while let Some(i) = s.find(t) {
            let b = s.as_bytes();
            let Some(open) = find(b, i, b"(") else { break };
            let end = close_of(b, open);
            s.replace_range(i..=end, " ");
        }
    }
    s
}

fn is_ident(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

/// `fn 이름` 들과 본문
fn fns_of(s: &str) -> Vec<(usize, String, String)> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(p) = find(b, i, b"fn ") {
        i = p + 3;
        if prev_ident(b, p) {
            continue;
        }
        let mut j = i;
        while j < b.len() && b[j] == b' ' {
            j += 1;
        }
        let st = j;
        while j < b.len() && is_ident(b[j]) {
            j += 1;
        }
        if j == st {
            continue;
        }
        let name = s[st..j].to_string();
        // 매개변수 괄호 → 본문 { 또는 ; (트레이트 선언)
        let Some(par) = find(b, j, b"(") else { break };
        if s[j..par].contains(['{', ';']) {
            continue;
        }
        let pe = close_of(b, par);
        let mut k = pe + 1;
        while k < b.len() && b[k] != b'{' && b[k] != b';' {
            k += 1;
        }
        if k >= b.len() || b[k] == b';' {
            continue;
        }
        let e = close_of(b, k);
        out.push((p, name, s[k..=e].to_string()));
    }
    out
}

fn uses_of(s: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut rest = s;
    while let Some(p) = rest.find("use crate::") {
        let tail = &rest[p + "use crate::".len()..];
        let end = tail.find(';').unwrap_or(tail.len());
        let u: String = tail[..end].chars().filter(|c| !c.is_whitespace()).collect();
        let items: Vec<String> = match u.split_once('{') {
            Some((base, list)) => list.trim_end_matches('}').split(',').filter(|x| !x.is_empty()).map(|x| format!("{base}{x}")).collect(),
            None => vec![u],
        };
        for it in items {
            let parts: Vec<&str> = it.split("::").collect();
            if parts.len() >= 2 {
                out.insert(parts[parts.len() - 1].to_string(), parts[0].to_string());
            }
        }
        rest = &tail[end..];
    }
    out
}

/// 본문 안 호출 `a::b::f(`·`f(`(메서드 `.f(`·매크로 `f!(`·정의 `fn f(` 는 뺀다) → (경로 앞부분, 이름)
fn calls(body: &str) -> Vec<(String, String)> {
    let b = body.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if !is_ident(b[i]) || (i > 0 && (is_ident(b[i - 1]) || b[i - 1] == b'.')) || (i > 0 && b[i - 1] == b':' && i > 1 && b[i - 2] == b':') {
            i += 1;
            continue;
        }
        // 경로 a::b::c 읽기
        let st = i;
        let mut j = i;
        loop {
            while j < b.len() && is_ident(b[j]) {
                j += 1;
            }
            if b[j..].starts_with(b"::") && b.get(j + 2).is_some_and(|&c| is_ident(c)) {
                j += 2;
            } else {
                break;
            }
        }
        let path = &body[st..j];
        let mut k = j;
        if b[k..].starts_with(b"::<") {
            let mut d = 0;
            while k < b.len() {
                if b[k] == b'<' { d += 1 } else if b[k] == b'>' { d -= 1; if d == 0 { k += 1; break; } }
                k += 1;
            }
        }
        while k < b.len() && b[k] == b' ' {
            k += 1;
        }
        let def = st >= 3 && &body[st.saturating_sub(3)..st] == "fn ";
        if b.get(k) == Some(&b'(') && !def {
            let (q, n) = path.rsplit_once("::").map_or(("", path), |(q, n)| (q, n));
            out.push((q.to_string(), n.to_string()));
        }
        i = j.max(i + 1);
    }
    out
}

/// 파일 시스템에 닿는 낱말(주석·글자를 지운 소스에서)
const FS: &[&str] = &[
    "fs::", "File::open", "File::create", "OpenOptions", ".exists()", ".is_file()", ".is_dir()", ".metadata()", "symlink_metadata",
    "read_dir", "canonicalize", "read_link", "try_exists", "is_symlink", "trash::", ".spawn_command(",
];

/// 데이터 폴더만 만지는 함수 — 여기서 더 안 들어간다. 사용자 경로를 받을 수 있는 범용 함수(write_atomic 같은)는 넣지 말고 부르는 쪽을 넣는다
const MAIN_OK: &[&str] = &[
    // 데이터 폴더 자체·config.json(처음 켤 때 한 번 devRoot 후보 is_dir — setup 이 UI 전에 먼저 불러 기억해 둔다)
    "config::data_dir", "config::data_file", "config::current", "config::write_file",
    // 기록 줄(notify.log·task-events.jsonl 등 <데이터>/…)
    "claude::log_out", "claude::append_task_event", "debug::append_capped", "debug::debug_dump",
    "claude::ime_debug_mode", "claude::ime_log", "claude::log_auto_allow", "claude::read_auto_allow", "claude::read_ctx",
    "claude::read_live_snap", "claude::read_say", "claude::read_usage", "claude::read_usage_at", "claude::write_view", "claude::write_voice_mode",
    "pty::log_write", "usage_counts::load", "usage_counts::save",
    // <데이터>/… 상태 파일
    "avatar::read_all_in", "avatar::save_in", "avatar::delete_in", "lessons::read_lessons", "lessons::write_lessons", "load::load_save",
    "login::login_save", "login_keep::load_keep", "review::write_review_state", "remote::load", "tts::supertonic_status",
    "tama::read_tama", "tama::write_tama", "tama::read_gacha", "tama::write_gacha", "tama::write_office", "tama::read_space_log",
    "orch_pins::read_order", "orch_pins::read_pins", "orch_pins::set_pin", "orch_pins::write_order", "orch_roles::read_roles", "orch_roles::write_roles",
    "reader::with_store", "reader::changed", "reader::read_curation_state", "reader::save_curation", "reader::save_curation_state",
    "reader::save_attach", "reader::set_view_mode", "reader::space_log_append",
    "direct::append", "direct::direct_log", "direct::direct_shown", "appctl::put_answers",
    "team_alert::load", "team_alert::save", "team_window::load", "team_window::save", "team_cmd::inbox_tail", "team_relay::load_state", "e2e_state::load",
    "mobile::devices", "mobile::explicit_off", "mobile::saved_on", "mobile_pair::read_list", "push::keep_last", "push::read_subs",
    // 브라우저 개입 기록 <데이터>/browser/live
    "agent_browser::read_live", "agent_browser::agent_ask_done", "takeover::read_file", "takeover::start", "takeover::ask_dialog", "takeover::hand_back_why",
    // Craft 상태 <데이터>/craft-native
    "craft_window::read_info", "craft_window::craft_space_still", "craft_screen::start_closing",
    // 크롬 앱 자리(/Applications) 확인 — 보호 폴더 아님
    "platform::open_in_chrome",
];

struct Src {
    /// 모듈 → 주석 지운 소스
    files: BTreeMap<String, String>,
    /// (모듈, 함수) → 본문들
    defs: HashMap<(String, String), Vec<String>>,
    /// 모듈 → use crate::m::f 로 들여온 f → m
    uses: HashMap<String, HashMap<String, String>>,
}

fn load() -> Src {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
    let mut files = BTreeMap::new();
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.extension().is_some_and(|x| x == "rs") {
            let m = p.file_stem().unwrap().to_string_lossy().into_owned();
            files.insert(m, cut_tests(strip(&std::fs::read_to_string(&p).unwrap())));
        }
    }
    let mut defs: HashMap<(String, String), Vec<String>> = HashMap::new();
    let mut uses = HashMap::new();
    for (m, s) in &files {
        for (_, name, body) in fns_of(s) {
            defs.entry((m.clone(), name)).or_default().push(body);
        }
        uses.insert(m.clone(), uses_of(s));
    }
    Src { files, defs, uses }
}

impl Src {
    fn resolve(&self, m: &str, q: &str, n: &str) -> Option<(String, String)> {
        let mut parts: Vec<&str> = q.split("::").filter(|x| !x.is_empty()).collect();
        if parts.first() == Some(&"crate") {
            parts.remove(0);
        }
        let key = |m: &str| (m.to_string(), n.to_string());
        let found = |k: (String, String)| self.defs.contains_key(&k).then_some(k);
        match parts.first() {
            None => found(key(m)).or_else(|| self.uses.get(m).and_then(|u| u.get(n)).and_then(|mm| found(key(mm)))),
            Some(&"Self") | Some(&"self") => found(key(m)),
            Some(&"super") => found(key("main")),
            Some(first) if self.files.contains_key(*first) => found(key(first)),
            _ => None,
        }
    }

    /// 명령에서 파일 낱말까지 가는 길(MAIN_OK 에서 멈춤) — 없으면 None
    fn fs_path(&self, m: &str, name: &str, body: &str) -> Option<String> {
        let ok: BTreeSet<&str> = MAIN_OK.iter().copied().collect();
        if ok.contains(format!("{m}::{name}").as_str()) {
            return None;
        }
        let mut seen = BTreeSet::new();
        let mut stack = vec![((m.to_string(), name.to_string()), body.to_string(), Vec::<String>::new())];
        while let Some(((mm, _), b, path)) = stack.pop() {
            let b = cut_spawns(&b);
            if let Some(t) = FS.iter().find(|t| b.contains(**t)) {
                let at = if path.is_empty() { "(본문)".to_string() } else { path.join(" > ") };
                return Some(format!("{at} : {t}"));
            }
            for (q, n) in calls(&b) {
                let Some(k) = self.resolve(&mm, &q, &n) else { continue };
                let full = format!("{}::{}", k.0, k.1);
                if ok.contains(full.as_str()) || !seen.insert(k.clone()) {
                    continue;
                }
                for bb in &self.defs[&k] {
                    let mut p = path.clone();
                    p.push(full.clone());
                    stack.push((k.clone(), bb.clone(), p));
                }
            }
        }
        None
    }
}

/// 명령 하나: (모듈, 이름, 동기인가, 본문)
fn commands(src: &Src) -> Vec<(String, String, bool, String)> {
    let mut out = Vec::new();
    for (m, s) in &src.files {
        let fns = fns_of(s);
        let mut at = 0;
        while let Some(p) = s[at..].find("#[tauri::command").map(|p| p + at) {
            at = p + 1;
            let attr_end = p + s[p..].find(']').unwrap() + 1;
            let attr = &s[p..attr_end];
            // 속성 바로 뒤(다른 속성·빈칸만 지나) 오는 fn
            let (fp, name, body) = fns.iter().find(|(fp, _, _)| *fp > p).cloned().unwrap_or_else(|| panic!("{m}: 명령 속성 뒤에 fn 없음"));
            let between = &s[attr_end..fp];
            let cleaned: String = between.split("#[").enumerate().map(|(i, x)| if i == 0 { x.to_string() } else { x.split_once(']').map_or(String::new(), |(_, r)| r.to_string()) }).collect();
            let words: Vec<&str> = cleaned.split_whitespace().collect();
            assert!(words.iter().all(|w| matches!(*w, "pub" | "async" | "unsafe") || w.starts_with("pub(")), "{m}::{name}: 명령 속성과 fn 사이에 다른 것 {words:?}");
            let sync = attr == "#[tauri::command]" && !words.contains(&"async");
            out.push((m.clone(), name, sync, body));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::offmain::{READ, WRITE};

    #[test]
    fn 글자_지우기는_줄_수를_지키고_수명은_남긴다() {
        let s = "let a = \"fs::x // y\"; // fs::read\nfn f<'a>(c: char) { r#\"File::open\"#; '}' }\n/* read_dir */";
        let t = strip(s);
        assert_eq!(t.lines().count(), s.lines().count());
        assert!(!t.contains("fs::") && !t.contains("File::open") && !t.contains("read_dir"), "{t}");
        assert!(t.contains("<'a>") && t.matches('{').count() == t.matches('}').count(), "{t}");
    }

    #[test]
    fn 호출_찾기는_메서드·매크로·정의를_뺀다() {
        let c = calls("{ crate::a::b(x); c(1); x.d(); e!(); fn g() {} Vec::<u8>::new(); h::<u8>(); }");
        let names: Vec<String> = c.iter().map(|(q, n)| format!("{q}|{n}")).collect();
        assert!(names.contains(&"crate::a|b".to_string()) && names.contains(&"|c".to_string()) && names.contains(&"|h".to_string()));
        assert!(!names.iter().any(|n| n.ends_with("|d") || n.ends_with("|e") || n.ends_with("|g")), "{names:?}");
    }

    #[test]
    fn fn_찾기는_본문과_트레이트_선언을_가린다() {
        let s = strip("trait T { fn a(&self); }\npub fn b<R: X>(x: u8) -> Result<(), String> { if x > 0 { c() } else { Ok(()) } }\nfn c() {}");
        let f: Vec<String> = fns_of(&s).into_iter().map(|(_, n, body)| format!("{n}:{}", body.len() > 2)).collect();
        assert_eq!(f, ["b:true", "c:false"]);
    }

    #[test]
    fn use_crate_로_들여온_이름의_모듈() {
        let u = uses_of("use crate::locker_fs::{migrate_all, Ctx};\nuse crate::config::data_dir;\nuse std::fs;");
        assert_eq!(u.get("migrate_all").map(String::as_str), Some("locker_fs"));
        assert_eq!(u.get("data_dir").map(String::as_str), Some("config"));
        assert!(!u.contains_key("fs"));
    }

    #[test]
    fn 시험_코드와_다른_스레드로_넘긴_괄호는_뺀다() {
        let s = cut_tests("fn a() {}\n#[cfg(test)]\nuse x::y;\n#[cfg(test)]\nmod tests { fn b() { std::fs::read(1); } }\nfn c() {}".into());
        assert!(!s.contains("fs::") && s.contains("fn a") && s.contains("fn c"), "{s}");
        let b = cut_spawns("{ std::thread::spawn(move || { std::fs::read_dir(p) }); x(); tauri::async_runtime::spawn_blocking(|| f(g(1))); }");
        assert!(!b.contains("read_dir") && !b.contains("f(g") && b.contains("x()"), "{b}");
    }

    /// 동기 명령(메인 스레드)이 파일 시스템을 건드리면 실패 — 맥 권한 창·느린 NAS 에 앱 전체가 굳는다(10-25 QA 두 번)
    #[test]
    fn 동기_명령은_메인_스레드에서_사용자_파일을_건드리지_않는다() {
        let src = load();
        let cmds = commands(&src);
        assert!(cmds.len() > 300, "명령을 너무 적게 찾음: {}", cmds.len());
        let attrs: usize = src.files.values().map(|s| s.matches("#[tauri::command").count()).sum();
        assert_eq!(cmds.len(), attrs, "명령 속성과 찾은 fn 수가 다르다");
        let mut bad = Vec::new();
        for (m, name, sync, body) in &cmds {
            if !*sync || READ.contains(&name.as_str()) || WRITE.contains(&name.as_str()) {
                continue;
            }
            if let Some(why) = src.fs_path(m, name, body) {
                bad.push(format!("{m}::{name} — {why}"));
            }
        }
        assert!(
            bad.is_empty(),
            "메인 스레드(동기 명령)에서 파일을 건드린다 — 사용자 경로면 offmain READ(읽기)·WRITE(쓰기) 에, 데이터 폴더만이면 그 함수를 offmain_scan MAIN_OK 에(이유 주석):\n{}",
            bad.join("\n")
        );
    }

    /// 검사가 진짜 사고 길을 잡는가 — 목록에서 빼면 걸려야 할 것들(QA 가 sample 로 본 locker_migrate → shots_only → read_dir 등)
    #[test]
    fn 검사는_목록에서_빠진_사고_길을_잡는다() {
        let src = load();
        let cmds = commands(&src);
        for (n, via) in [
            ("locker_migrate", "locker_fs::migrate_all"),
            ("write_live_snap", "(본문)"),
            ("mode_list", "modes"),
            ("open_target", "(본문)"),
            ("write_doc_text", "(본문)"),
            ("locker_tree", "locker_fs::tree_at"),
        ] {
            let (m, _, _, body) = cmds.iter().find(|c| c.1 == n).unwrap_or_else(|| panic!("{n} 없음"));
            let why = src.fs_path(m, n, body).unwrap_or_else(|| panic!("{n} 을 못 잡음 — 목록에서 빠지면 조용히 메인 스레드로 돈다"));
            assert!(why.contains(via), "{n}: {why}");
        }
    }

    /// READ·WRITE 이름은 진짜 등록된 동기 명령이어야 — 오타면 조용히 메인 스레드에서 돈다
    #[test]
    fn 갈래_목록은_등록된_동기_명령만() {
        let src = load();
        let cmds = commands(&src);
        let main = &src.files["main"];
        let handler = &main[main.find("generate_handler![").unwrap()..];
        let handler = &handler[..handler.find(']').unwrap()];
        let mut seen = BTreeSet::new();
        for n in READ.iter().chain(WRITE) {
            assert!(seen.insert(*n), "{n} 이 READ·WRITE 에 두 번");
            let c = cmds.iter().find(|(_, name, _, _)| name == n).unwrap_or_else(|| panic!("{n} 명령 없음"));
            assert!(c.2, "{n} 은 동기 명령이 아니다 — async 는 이미 메인 밖이라 목록에서 뺀다");
            let listed = handler.split([',', '\n']).map(str::trim).any(|x| x == *n || x.ends_with(&format!("::{n}")));
            assert!(listed, "{n} 이 generate_handler 에 없음");
        }
    }

    /// MAIN_OK 에 없어진 함수가 남아 있으면 — 이름이 바뀌어 검사가 조용히 빗나간다
    #[test]
    fn 데이터_폴더_허용_목록은_있는_함수만() {
        let src = load();
        for e in MAIN_OK {
            let (m, n) = e.split_once("::").unwrap();
            assert!(src.defs.contains_key(&(m.to_string(), n.to_string())), "MAIN_OK {e} 없음");
        }
    }
}
