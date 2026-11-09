//! 보관함 링크 목록(2026-11-06 사용자, 시안 locker-links v1 B) — 참모와 주고받은 주소. 참모 대화 기록(jsonl)에서 사람 말·참모 답 글 속
//! http(s) 주소를 뽑아 `<데이터>/locker-links/<참모 id>.jsonl` 에 쌓는다. 보여 준 주소(scripts/show)는 화면이 가진 기록에서 합친다.
//! 같은 주소 합치기는 아직 안 한다(roadmap 부채) — 오갈 때마다 따로. 계획 docs/plans/2026-11-06-locker-links.md
use std::io::{BufRead, Seek, Write};
use std::path::{Path, PathBuf};

/// 글 속 주소 하나 — label = 마크다운 [이름](주소) 의 이름
#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    pub url: String,
    pub label: Option<String>,
}

/// 주소에 들어갈 수 있는 글자(RFC 3986 + %). 한글·공백·따옴표·백틱·꺾쇠·대괄호에서 끊는다
fn url_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || "-._~:/?#@!$&()*+,;=%".contains(c)
}

/// 꼬리 문장부호·짝 없는 닫는 괄호를 떼어 낸다
fn trim_tail(mut u: &str) -> &str {
    loop {
        let Some(last) = u.chars().last() else { return u };
        let close_extra = last == ')' && u.matches(')').count() > u.matches('(').count();
        if ".,;:!?*".contains(last) || close_extra {
            u = &u[..u.len() - 1];
        } else {
            return u;
        }
    }
}

/// 주소꼴인가 — 이름 자리가 점 있는 이름·localhost·숫자 주소
fn host_ok(u: &str) -> bool {
    let rest = u.split_once("://").map(|(_, r)| r).unwrap_or("");
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.rsplit_once('@').map(|(_, h)| h).unwrap_or(host);
    let name = host.split(':').next().unwrap_or("");
    !name.is_empty() && (name == "localhost" || (name.contains('.') && !name.starts_with('.') && !name.ends_with('.')))
}

/// [이름](주소) 의 이름 — 주소가 `](` 바로 뒤에서 시작하면 같은 줄의 짝 `[` 까지
fn label_before(text: &str, at: usize) -> Option<String> {
    let head = text[..at].strip_suffix("](")?;
    let open = head.rfind('[')?;
    let raw = &head[open + 1..];
    if raw.contains(['\n', ']']) {
        return None;
    }
    let l = raw.trim().trim_matches(|c| c == '*' || c == '`' || c == '_').trim();
    (!l.is_empty() && l.chars().count() <= 120 && !l.starts_with("http://") && !l.starts_with("https://")).then(|| l.to_string())
}

/// 글 속 http(s) 주소 — 나온 차례, 같은 주소는 한 번(이름은 붙은 쪽)
pub fn urls_in(text: &str) -> Vec<Found> {
    let mut out: Vec<Found> = Vec::new();
    let mut i = 0;
    while let Some(off) = text[i..].find("http") {
        let at = i + off;
        i = at + 4;
        let s = &text[at..];
        if !(s.starts_with("https://") || s.starts_with("http://")) {
            continue;
        }
        if text[..at].chars().last().is_some_and(|c| c.is_ascii_alphanumeric()) {
            continue;
        }
        let end = s.char_indices().find(|&(_, c)| !url_char(c)).map(|(k, _)| k).unwrap_or(s.len());
        // 말줄임으로 잘린 주소(…)는 버린다 — 열면 엉뚱한 데로 간다
        if s[end..].starts_with('…') {
            i = at + end;
            continue;
        }
        let url = trim_tail(&s[..end]);
        i = at + end.max(4);
        if !host_ok(url) {
            continue;
        }
        let label = label_before(text, at);
        match out.iter_mut().find(|f| f.url == url) {
            Some(f) => {
                if f.label.is_none() {
                    f.label = label;
                }
            }
            None => out.push(Found { url: url.to_string(), label }),
        }
    }
    out
}

/// 누가 어떻게 — 사람이 보냄 · 참모 답 · 보관함에서 손으로 넣음
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum How {
    Said,
    Answer,
    Hand,
}

/// 기록 한 줄에서 찾은 것
#[derive(Debug)]
pub struct Hit {
    pub how: How,
    pub uuid: String,
    pub ts: String,
    pub found: Vec<Found>,
}

/// 사람 말이 아닌 줄 머리 — 앱이 넣은 줄·다른 기기·팀 이름표(CHAMMO 안내문의 이름표들)
const NOT_HUMAN: &[&str] = &["[앱]", "[다른 기기 참모", "[남의 참모", "[팀 사람 말", "[팀 참모", "[내 다른 기기 참모"];

fn strip_reminders(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    let mut rest = t;
    while let Some(a) = rest.find("<system-reminder>") {
        out.push_str(&rest[..a]);
        match rest[a..].find("</system-reminder>") {
            Some(b) => rest = &rest[a + b + "</system-reminder>".len()..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// 기록 한 줄 — 사람 말(메타·도구 결과·감싼 줄·이름표 줄 빼고)과 참모 답 글 칸만. 깨진 줄·다른 줄은 None
pub fn in_line(line: &str) -> Option<Hit> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let msg = &v["message"]["content"];
    let texts: Vec<&str> = match msg {
        serde_json::Value::String(s) => vec![s.as_str()],
        serde_json::Value::Array(a) => a.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect(),
        _ => Vec::new(),
    };
    let how = match v["type"].as_str()? {
        "user" => {
            let tool = msg.as_array().is_some_and(|a| a.iter().any(|b| b["type"] == "tool_result"));
            // 압축 요약(isCompactSummary·기록에만 보이는 줄)은 예전 주소를 다시 끌고 온다 — 사람이 친 말이 아니다
            let summary = v["isCompactSummary"].as_bool() == Some(true) || v["isVisibleInTranscriptOnly"].as_bool() == Some(true);
            // 사람 말 = promptSource typed·queued(일하는 중 쌓아 둔 말). system 은 다른 참모 전언(peer)·작업 알림 — 머리 글자와 상관없이 뺀다(옛 판은 칸이 없어 머리 글자로)
            let system = v["promptSource"].as_str() == Some("system");
            if v["isMeta"].as_bool() == Some(true) || tool || summary || system {
                return None;
            }
            How::Said
        }
        "assistant" => How::Answer,
        _ => return None,
    };
    let mut found = Vec::new();
    for t in texts {
        let t = if how == How::Said { strip_reminders(t) } else { t.to_string() };
        let head = t.trim_start();
        if how == How::Said && (head.starts_with('<') || NOT_HUMAN.iter().any(|p| head.starts_with(p))) {
            continue;
        }
        for f in urls_in(&t) {
            if !found.iter().any(|g: &Found| g.url == f.url) {
                found.push(f);
            }
        }
    }
    Some(Hit { how, uuid: v["uuid"].as_str().unwrap_or("").to_string(), ts: v["timestamp"].as_str().unwrap_or("").to_string(), found })
}

// ── 저장: <데이터>/locker-links/<참모 id>.jsonl (add·hide·unhide 줄) + <참모 id>.pos.json (기록 파일마다 읽은 자리) ──

/// 링크 한 줄 — 화면(domain/lockerLinks LockerLink)이 받는 모양. by = 'me' 또는 참모 id
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Link {
    pub id: String,
    pub url: String,
    pub ts: String,
    pub by: String,
    pub how: How,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// 보이는 링크(최근 것 먼저) + 뺀 열쇠(보여 준 주소 줄 show:… 도 화면이 이걸로 거른다)
#[derive(Debug, Default, PartialEq, serde::Serialize)]
pub struct View {
    pub links: Vec<Link>,
    pub hidden: Vec<String>,
}

const DIR: &str = "locker-links";

/// 참모 id 는 파일 이름이 된다 — 글자를 거른다
fn store(data: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(format!("참모 id 가 이상해: {id}"));
    }
    Ok(data.join(DIR).join(format!("{id}.jsonl")))
}

fn append(path: &Path, lines: &[serde_json::Value]) -> Result<(), String> {
    if lines.is_empty() {
        return Ok(());
    }
    let mut buf = String::new();
    for l in lines {
        buf.push_str(&l.to_string());
        buf.push('\n');
    }
    std::fs::create_dir_all(path.parent().unwrap_or(Path::new("."))).map_err(|e| e.to_string())?;
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    f.write_all(buf.as_bytes()).map_err(|e| e.to_string())
}

fn add_line(l: &Link) -> serde_json::Value {
    let mut v = serde_json::to_value(l).unwrap_or_default();
    v["op"] = "add".into();
    v
}

/// 기록 줄 접기 — 같은 열쇠의 add 는 처음 것, hide·unhide 는 마지막 것
pub fn fold(text: &str) -> View {
    let mut links: Vec<Link> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut hidden: Vec<String> = Vec::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let Some(id) = v["id"].as_str().filter(|i| !i.is_empty()) else { continue };
        match v["op"].as_str() {
            Some("add") => {
                if seen.insert(id.to_string()) {
                    if let Ok(l) = serde_json::from_value::<Link>(v.clone()) {
                        links.push(l);
                    }
                }
            }
            Some("hide") if !hidden.iter().any(|h| h == id) => hidden.push(id.to_string()),
            Some("unhide") => hidden.retain(|h| h != id),
            _ => {}
        }
    }
    let gone: std::collections::HashSet<&str> = hidden.iter().map(String::as_str).collect();
    links.retain(|l| !gone.contains(l.id.as_str()));
    links.sort_by(|a, b| b.ts.cmp(&a.ts));
    View { links, hidden }
}

/// 그 참모 목록 — 아직 없으면 빈 목록
pub fn read(data: &Path, id: &str) -> Result<View, String> {
    match std::fs::read_to_string(store(data, id)?) {
        Ok(t) => Ok(fold(&t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(View::default()),
        Err(e) => Err(e.to_string()),
    }
}

/// 이만큼 읽을 때마다 쌓고 읽은 자리를 저장한다 — 처음 큰 기록(708MB, 부하 높을 때 4분 실측) 동안 목록이 차오르고, 중간에 꺼도 그 자리부터
const SAVE_EVERY: u64 = 64 << 20;

/// 대화 기록(transcript)을 읽은 자리부터 이어 읽어 찾은 주소를 쌓는다 — 덜 쓰인 끝 줄은 다음 차례, 기록이 짧아졌으면 처음부터
/// (줄 열쇠 = 기록 줄 uuid#순번이라 다시 읽어도 겹치지 않는다). 'http' 없는 줄은 JSON 도 안 푼다. 돌려주는 값 = 새로 쌓은 수
pub fn scan(data: &Path, id: &str, sid: &str, transcript: &Path) -> Result<usize, String> {
    scan_with(data, id, sid, transcript, SAVE_EVERY, &mut |_| {})
}

fn scan_with(data: &Path, id: &str, sid: &str, transcript: &Path, save_every: u64, saved: &mut dyn FnMut(u64)) -> Result<usize, String> {
    let path = store(data, id)?;
    let pos_path = data.join(DIR).join(format!("{id}.pos.json"));
    let mut pos: serde_json::Map<String, serde_json::Value> = std::fs::read_to_string(&pos_path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let len = std::fs::metadata(transcript).map_err(|e| e.to_string())?.len();
    let mut at = pos.get(sid).and_then(|v| v.as_u64()).unwrap_or(0);
    if at > len {
        at = 0;
    }
    if at == len {
        return Ok(0);
    }
    let mut f = std::fs::File::open(transcript).map_err(|e| e.to_string())?;
    f.seek(std::io::SeekFrom::Start(at)).map_err(|e| e.to_string())?;
    let mut r = std::io::BufReader::with_capacity(1 << 20, f);
    let mut line = Vec::new();
    let mut adds = Vec::new();
    let mut total = 0;
    let mut last_save = at;
    let mut save = |adds: &mut Vec<serde_json::Value>, at: u64| -> Result<(), String> {
        append(&path, adds)?;
        total += adds.len();
        adds.clear();
        pos.insert(sid.to_string(), at.into());
        let tmp = pos_path.with_extension("json.part");
        std::fs::create_dir_all(pos_path.parent().unwrap_or(Path::new("."))).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, serde_json::Value::Object(pos.clone()).to_string()).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &pos_path).map_err(|e| e.to_string())
    };
    loop {
        line.clear();
        let n = r.read_until(b'\n', &mut line).map_err(|e| e.to_string())?;
        if n == 0 || line.last() != Some(&b'\n') {
            break;
        }
        let here = at;
        at += n as u64;
        if line.windows(4).any(|w| w == b"http") {
            if let Some(h) = std::str::from_utf8(&line).ok().and_then(|s| in_line(s.trim_end())) {
                for (k, f) in h.found.into_iter().enumerate() {
                    let lid = if h.uuid.is_empty() { format!("{sid}@{here}#{k}") } else { format!("{}#{k}", h.uuid) };
                    let by = if h.how == How::Said { "me".to_string() } else { id.to_string() };
                    adds.push(add_line(&Link { id: lid, url: f.url, ts: h.ts.clone(), by, how: h.how, label: f.label }));
                }
            }
        }
        if at - last_save >= save_every {
            save(&mut adds, at)?;
            last_save = at;
            saved(at);
        }
    }
    save(&mut adds, at)?;
    Ok(total)
}

/// 손으로 넣는 주소 — 빈칸 없는 http(s) 주소 하나(주소 앞이 없으면 https://), 꼬리 문장부호는 뗀다. 화면 cleanLinkInput 과 같은 규칙
pub fn clean_input(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() || s.len() > 2048 || s.chars().any(char::is_whitespace) {
        return None;
    }
    let full = if s.contains("://") { s.to_string() } else { format!("https://{s}") };
    if !(full.starts_with("https://") || full.starts_with("http://")) {
        return None;
    }
    let f = urls_in(&full);
    (f.len() == 1 && full.starts_with(&f[0].url)).then(|| f[0].url.clone())
}

/// 보관함에서 직접 넣기 — 열쇠 me-<밀리초>(같은 밀리초면 -2, -3 …)
pub fn add_hand(data: &Path, id: &str, raw: &str) -> Result<Link, String> {
    let url = clean_input(raw).ok_or_else(|| "주소꼴이 아니야 — https:// 로 시작하는 주소 하나".to_string())?;
    let path = store(data, id)?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let had = std::fs::read_to_string(&path).unwrap_or_default();
    let mut lid = format!("me-{now}");
    let mut n = 1;
    while had.contains(&format!("\"id\":\"{lid}\"")) {
        n += 1;
        lid = format!("me-{now}-{n}");
    }
    let l = Link { id: lid, url, ts: crate::direct::iso_of_ms(now), by: "me".into(), how: How::Hand, label: None };
    append(&path, &[add_line(&l)])?;
    Ok(l)
}

/// 목록에서 빼기(hide) · 되돌리기(unhide) — 대화 기록은 그대로
pub fn set_hidden(data: &Path, id: &str, link_id: &str, hide: bool) -> Result<(), String> {
    if link_id.is_empty() || link_id.len() > 4096 || link_id.contains(['\n', '\r']) {
        return Err("링크 열쇠가 이상해".into());
    }
    append(&store(data, id)?, &[serde_json::json!({ "op": if hide { "hide" } else { "unhide" }, "id": link_id })])
}

// ── 앱·폰이 부르는 길 ──

static SCAN: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 이어 읽고 목록 — 다른 차례(데스크톱 5초 다시 읽기·폰)가 읽는 중이면 기다리지 않고 지금 목록(처음 큰 기록은 몇 초 걸린다)
pub fn refresh(data: &Path, id: &str, sid: Option<&str>, transcript: Option<&Path>) -> Result<View, String> {
    if let (Some(sid), Some(t)) = (sid, transcript) {
        if let Ok(_g) = SCAN.try_lock() {
            let _ = scan(data, id, sid, t);
        }
    }
    read(data, id)
}

/// 폰 길 — 이어 읽기는 뒤에서. 첫 큰 기록은 몇 초~몇 분이라 폰 서버 일꾼(중계는 수가 정해져 있다)을 붙들면 안 된다. 폰은 지금 목록을 바로 받고 다음 차례(10초)에 차오른다
pub fn scan_soon(data: PathBuf, id: String, sid: String, transcript: PathBuf) {
    std::thread::spawn(move || {
        if let Ok(_g) = SCAN.try_lock() {
            let _ = scan(&data, &id, &sid, &transcript);
        }
    });
}

/// 대화 기록 id 꼴 — 파일 이름(<id>.jsonl)과 읽은 자리 열쇠가 된다
pub fn sid_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// 그 참모의 대화 기록 id — `claude agents --json` 원문에서 id 가 같은 줄의 sessionId
pub fn sid_of(agents_json: &str, id: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(agents_json).ok()?;
    v.as_array()?.iter().find(|a| a["id"] == id)?["sessionId"].as_str().filter(|s| sid_ok(s)).map(str::to_string)
}

/// 보관함 링크 칸 — id = 참모 id(보관함 열쇠와 같다), session = 그 참모 대화 기록 id
#[tauri::command]
pub async fn locker_links(id: String, session: Option<String>) -> Result<View, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let sid = session.filter(|s| sid_ok(s));
        let tr = sid.as_deref().and_then(crate::claude::transcript_path);
        refresh(crate::config::data_dir(), &id, sid.as_deref(), tr.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 파일을 만지니 메인 스레드 밖에서(offmain_scan)
#[tauri::command]
pub async fn locker_link_add(id: String, url: String) -> Result<Link, String> {
    tauri::async_runtime::spawn_blocking(move || add_hand(crate::config::data_dir(), &id, &url)).await.map_err(|e| e.to_string())?
}

/// hide = true 빼기 · false 되돌리기
#[tauri::command]
pub async fn locker_link_hide(id: String, link: String, hide: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_hidden(crate::config::data_dir(), &id, &link, hide)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "locker_links_tests.rs"]
mod tests;
