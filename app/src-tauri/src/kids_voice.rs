//! 키즈 목소리(1단계 넷째 조각, 계획서 D) — 패드 녹음 → 맥 받아쓰기(whisper.cpp 서버, 모델 띄워 둠) → 아이 세션 →
//! 답을 문장마다 F1 Supertonic 귀엽게 0.85배로 만들어(목소리 서버, 띄워 둠) 패드가 차례로 받아 튼다.
//! - 받아쓰기 모델: <데이터>/stt/whisper/ggml-small-q5_1.bin(11-17 실측: 띄워 둔 small 0.25~0.67초·4문장 다 맞음, turbo 는 1.3~3.2초)
//! - 소리 조각: <데이터>/kids/_voice/<참모>/<cid>/NN.wav + state.json(ready·done) — 패드가 /api/kids/voice 로 하나씩
//! - 미리 만든 말 20개: <데이터>/kids/_voice/pre/NN.wav(한 번 만들어 둠, 패드가 처음에 다 받아 0초에 튼다)
use serde::{Deserialize, Serialize};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const VOICE_PY: &str = include_str!("../kids/voice.py");
/// 미리 만든 말 — 손 대는 순간 1번, 손 뗀 순간 2·3번(번갈아). 순서를 바꾸면 패드(ui/kids/kidsVoice PRE)도
pub const PHRASES: [&str; 25] = [
    "음~?", "알겠어!", "좋아!", "만드는 중이야.", "거의 다 됐어!", "다 만들었어!", "우와, 멋지다!", "다시 말해 줄래?", "이렇게 할까?", "더 크게 해 볼까?",
    "색을 바꿔 볼까?", "몇 마리로 할까?", "방에 걸어 둘게!", "오늘은 여기까지 하자.", "잘 자, 내일 또 만들자.", "그건 엄마랑 얘기해 볼까?", "아빠한테 그림 넣어 달라고 하자.",
    "새 재료가 생겼어!", "톡 눌러서 말해 줘.", "하나, 둘, 셋!",
    // 21~25 추임새(11-18) — 아이가 말을 이어 갈 것 같을 때 한 번만, 대답으로 세지 않고 기록에도 안 남긴다
    "응~", "음음", "그래서?", "응응", "그다음엔?",
];
/// 답을 기다리는 가장 긴 시간 — 그 뒤 새 답은 소리로 안 읽는다(글 말풍선엔 뜬다)
const WATCH_MS: u64 = 90_000;

// ───────── 소리로 읽을 글 ─────────

fn is_emoji(c: char) -> bool {
    matches!(c as u32, 0x1F000..=0x1FAFF | 0x2600..=0x27BF | 0xFE0F | 0x200D | 0x2B00..=0x2BFF)
}

/// 아이에게 가면 안 되는 해설 — 이름표(`[아이 말 · …]`·`[앱 · …]`·kid#)와 아이를 3인칭으로 말하는 설명("아이가 '안녕'이라고 했어요").
/// 해설이 든 줄은 통째로 빼고(11-18 실사용: 첫 줄 해설 + 둘째 줄 진짜 답), 줄을 다 빼면 아무것도 안 남을 땐 그 문장만 뺀다. 만들기 표시는 건드리지 않는다
fn meta_tag(s: &str) -> bool {
    s.contains("kid#") || s.contains("[아이 말") || s.contains("[앱 ·") || s.contains("[보호자") || s.contains("키즈 화면")
}

/// 해설 줄인가(이름표 또는 아이를 3인칭으로 말함) — 흘려 읽기(kids_api)도 줄마다 이걸로 거른다
pub fn is_meta_line(s: &str) -> bool {
    meta_tag(s) || ["아이가 ", "아이는 ", "아이에게 ", "아이 말", "아이의 말"].iter().any(|w| s.contains(w))
}

pub fn strip_meta(text: &str) -> String {
    let tag = meta_tag;
    let narr = is_meta_line;
    let drop_tags = |s: &str| -> String {
        let mut out = String::new();
        let mut rest = s;
        while let Some(i) = rest.find('[') {
            let Some(j) = rest[i..].find(']') else { break };
            let inner = &rest[i..i + j + 1];
            out.push_str(&rest[..i]);
            if !tag(inner) {
                out.push_str(inner);
            }
            rest = &rest[i + j + 1..];
        }
        out.push_str(rest);
        out.trim().to_string()
    };
    let lines: Vec<&str> = text.lines().collect();
    let kept: Vec<&str> = lines.iter().copied().filter(|l| !narr(l) || l.trim_start().starts_with("[만들기") || l.trim_start().starts_with("[고치기")).collect();
    if kept.iter().any(|l| !l.trim().is_empty()) && kept.len() < lines.len() {
        return kept.join("\n").trim().to_string();
    }
    // 한 줄에 붙어 왔다 — 문장마다(이름표는 떼고 본다)
    let mut out: Vec<String> = vec![];
    for l in lines {
        if l.trim_start().starts_with("[만들기") || l.trim_start().starts_with("[고치기") {
            out.push(l.to_string());
            continue;
        }
        let mut keep = vec![];
        for s in split_marks(l) {
            let had_tag = s.contains('[') && tag(&s);
            let s2 = drop_tags(&s);
            if s2.is_empty() || narr(&s2) || (had_tag && s2.starts_with("에서")) {
                continue;
            }
            keep.push(s2);
        }
        if !keep.is_empty() {
            out.push(keep.join(" "));
        }
    }
    out.join("\n").trim().to_string()
}

/// 소리로 읽을 글 — 이모지·마크다운 굵게·`코드`를 빼고, 파일 이름·경로가 든 문장은 통째로 뺀다(아이에게 읽어 줄 말이 아니다)
pub fn clean_say(text: &str) -> String {
    let t: String = text.chars().filter(|c| !is_emoji(*c)).collect::<String>().replace("**", "").replace('*', "");
    let mut out = vec![];
    for s in split_marks(&t) {
        let pathy = s.contains('`') || s.contains("works/") || s.split_whitespace().any(|w| w.contains('/') || w.trim_end_matches(|c: char| !c.is_ascii_alphanumeric()).rsplit_once('.').is_some_and(|(a, b)| !a.is_empty() && (2..=5).contains(&b.len()) && b.chars().all(|c| c.is_ascii_alphabetic())));
        if !pathy && !s.trim().is_empty() {
            out.push(s.trim().to_string());
        }
    }
    out.join(" ")
}

/// 문장 끝(.!?…·줄바꿈)에서 나눈다 — 끝 표시는 그 문장에 붙인 채
fn split_marks(t: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let cs: Vec<char> = t.chars().collect();
    for (i, &c) in cs.iter().enumerate() {
        if c == '\n' {
            out.push(std::mem::take(&mut cur));
            continue;
        }
        cur.push(c);
        // 'a.html'·'1.5' 처럼 점 뒤에 글자·숫자가 바로 붙으면 문장 끝이 아니다
        let glued = c == '.' && cs.get(i + 1).is_some_and(|n| n.is_ascii_alphanumeric());
        if matches!(c, '.' | '!' | '?' | '…' | '。') && !glued {
            out.push(std::mem::take(&mut cur));
        }
    }
    out.push(cur);
    out.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

/// 흘려 읽기 덩어리 — 문장마다, 아주 짧은 조각(6자 밑)은 다음 문장과 붙이고, 40자 넘으면 쉼표에서 나눈다(첫 소리를 빨리)
pub fn sentences(text: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    let mut carry = String::new();
    for s in split_marks(text) {
        let s = if carry.is_empty() { s } else { format!("{} {s}", std::mem::take(&mut carry)) };
        if s.chars().count() < 6 {
            carry = s;
            continue;
        }
        if s.chars().count() > 40 {
            if let Some(i) = s.find(", ").or_else(|| s.find(',')) {
                let (a, b) = s.split_at(i + 1);
                out.push(a.trim().to_string());
                out.push(b.trim().to_string());
                continue;
            }
        }
        out.push(s);
    }
    if !carry.is_empty() {
        out.push(carry);
    }
    out
}

// ───────── 받아쓰기(whisper.cpp 서버) ─────────

/// multipart/form-data 몸 — whisper-server /inference 에 file + 칸들
pub fn multipart(wav: &[u8], fields: &[(&str, &str)]) -> (String, Vec<u8>) {
    let bd = format!("chammo{}", crate::mobile_pair::random_hex(8).unwrap_or_else(|_| "b0undary".into()));
    let mut b = Vec::with_capacity(wav.len() + 512);
    b.extend_from_slice(format!("--{bd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes());
    b.extend_from_slice(wav);
    b.extend_from_slice(b"\r\n");
    for (k, v) in fields {
        b.extend_from_slice(format!("--{bd}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n").as_bytes());
    }
    b.extend_from_slice(format!("--{bd}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={bd}"), b)
}

/// whisper-server 답 → 받아쓴 글. 빈 소리 표시([BLANK_AUDIO]·(음악) 같은 괄호)는 말이 아니다
pub fn heard_text(json: &str) -> String {
    let t = serde_json::from_str::<serde_json::Value>(json).ok().and_then(|v| v["text"].as_str().map(str::to_string)).unwrap_or_default();
    let t = t.trim();
    if t.is_empty() || (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')')) {
        return String::new();
    }
    t.to_string()
}

fn stt_model() -> PathBuf {
    crate::config::data_dir().join("stt/whisper/ggml-small-q5_1.bin")
}

fn whisper_bin() -> Option<PathBuf> {
    ["/opt/homebrew/bin/whisper-server", "/usr/local/bin/whisper-server"].iter().map(PathBuf::from).find(|p| p.exists())
}

/// 받아쓰기를 쓸 수 있나(whisper-server 와 모델이 깔렸나)
pub(crate) fn stt_ready() -> bool {
    whisper_bin().is_some() && stt_model().exists()
}

/// (지킴이 셸, 포트) — 셸이 whisper-server 를 띄우고 stdin 이 닫히면(앱이 꺼지면) 끈다. 앱 밖에 서버가 남지 않게
static STT: Mutex<Option<(std::process::Child, std::process::ChildStdin, u16)>> = Mutex::new(None);
const STT_GUARD: &str = "\"$@\" & p=$!; cat >/dev/null; kill $p 2>/dev/null";

fn free_port() -> Result<u16, String> {
    std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).map_err(|e| e.to_string())
}

/// 받아쓰기 서버 — 떠 있으면 그 포트, 아니면 띄우고 포트가 열릴 때까지(최대 30초)
fn stt_port() -> Result<u16, String> {
    let mut g = STT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((c, _, p)) = g.as_mut() {
        if c.try_wait().ok().flatten().is_none() {
            return Ok(*p);
        }
    }
    let bin = whisper_bin().ok_or("whisper-server 가 없어(brew install whisper-cpp)")?;
    let port = free_port()?;
    let mut child = crate::platform::command("/bin/sh")
        .args(["-c", STT_GUARD, "sh"])
        .arg(bin)
        .args(["-m", &stt_model().to_string_lossy(), "-l", "ko", "--host", "127.0.0.1", "--port", &port.to_string(), "-t", "4", "-nt"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdin = child.stdin.take().ok_or("stdin")?;
    *g = Some((child, stdin, port));
    for _ in 0..300 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Err("받아쓰기 서버가 안 떴어".into())
}

/// 16kHz 모노 wav → 받아쓴 글
pub(crate) fn transcribe(wav: &[u8]) -> Result<String, String> {
    let port = stt_port()?;
    let (ct, body) = multipart(wav, &[("response_format", "json"), ("language", "ko")]);
    Ok(heard_text(&post_local(port, "/inference", &ct, &body)?))
}

/// 127.0.0.1 HTTP/1.1 POST — 답 몸(글). 로컬 받아쓰기 서버뿐이라 TLS·라이브러리 없이(reqwest 는 rustls 공급자를 따로 깔아야 한다)
fn post_local(port: u16, path: &str, ct: &str, body: &[u8]) -> Result<String, String> {
    use std::io::Read;
    let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    s.set_read_timeout(Some(std::time::Duration::from_secs(20))).map_err(|e| e.to_string())?;
    let head = format!("POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: {ct}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    s.write_all(head.as_bytes()).and_then(|_| s.write_all(body)).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    s.read_to_end(&mut out).map_err(|e| e.to_string())?;
    let t = String::from_utf8_lossy(&out);
    let (head, body) = t.split_once("\r\n\r\n").ok_or("받아쓰기 서버 답이 이상해")?;
    if !head.starts_with("HTTP/1.1 200") && !head.starts_with("HTTP/1.0 200") {
        return Err(head.lines().next().unwrap_or("").to_string());
    }
    Ok(body.to_string())
}

// ───────── 목소리 서버(Supertonic, voice.py) ─────────

struct Tts {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    out: std::io::BufReader<std::process::ChildStdout>,
}
static TTS: Mutex<Option<Tts>> = Mutex::new(None);

fn supertonic() -> PathBuf {
    crate::config::data_dir().join("tts/supertonic")
}

/// 목소리를 쓸 수 있나(앱 설정에서 Supertonic 을 받아 뒀나)
pub(crate) fn tts_ready() -> bool {
    supertonic().join("ready").exists()
}

fn voice_dir() -> PathBuf {
    crate::config::data_dir().join("kids/_voice")
}

/// 목소리 서버에 한 줄 묻기 — 한 번에 하나(줄 순서가 섞이지 않게). 죽었으면 다시 띄운다
fn tts_call(req: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut g = TTS.lock().unwrap_or_else(|e| e.into_inner());
    if g.as_mut().is_none_or(|t| t.child.try_wait().ok().flatten().is_some()) {
        if !tts_ready() {
            return Err("Supertonic 이 안 깔렸어(설정 > 음성)".into());
        }
        let d = voice_dir();
        std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
        let py = d.join("voice.py");
        std::fs::write(&py, VOICE_PY).map_err(|e| e.to_string())?;
        let s = supertonic();
        let mut child = crate::platform::command(s.join("venv/bin/python"))
            .arg(&py)
            .arg(s.join("model"))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        let stdin = child.stdin.take().ok_or("stdin")?;
        let mut out = std::io::BufReader::new(child.stdout.take().ok_or("stdout")?);
        let mut first = String::new();
        out.read_line(&mut first).map_err(|e| e.to_string())?; // {"ready":true} — 모델 띄우기·첫 합성까지
        if !first.contains("ready") {
            let _ = child.kill();
            return Err(format!("목소리 서버가 안 떴어: {}", first.trim()));
        }
        *g = Some(Tts { child, stdin, out });
    }
    let t = g.as_mut().unwrap();
    writeln!(t.stdin, "{req}").and_then(|_| t.stdin.flush()).map_err(|e| e.to_string())?;
    let mut line = String::new();
    t.out.read_line(&mut line).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&line).map_err(|_| format!("목소리 서버 답이 이상해: {}", line.trim()))?;
    if v["ok"] == true { Ok(v) } else { Err(v["err"].as_str().unwrap_or("실패").to_string()) }
}

fn pre_same(d: &Path) -> bool {
    std::fs::read_to_string(d.join("index.json")).ok().and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok()).is_some_and(|v| v == PHRASES)
}

static PRE_GEN: Mutex<()> = Mutex::new(());

/// 만들기는 한 번만 — 기다린 요청은 잠금 안에서 다시 보고 이미 됐으면 그냥 돌아간다
/// (11-18 진짜 맥: 패드가 20개를 한꺼번에 받자 기다리던 요청마다 20개를 처음부터 다시 만들어 목소리 서버·중계 일꾼을 몇 분씩 잡았다)
pub(crate) fn pre_dir_with(d: &Path, make: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    if pre_same(d) {
        return Ok(());
    }
    let _g = PRE_GEN.lock().unwrap_or_else(|e| e.into_inner());
    if pre_same(d) {
        return Ok(());
    }
    make()
}

/// 미리 만든 말 폴더 — 없거나 목록이 바뀌었으면 만든다(약 14초, 한 번)
pub(crate) fn pre_dir() -> Result<PathBuf, String> {
    let d = voice_dir().join("pre");
    pre_dir_with(&d, || tts_call(serde_json::json!({ "op": "pre", "dir": d, "phrases": PHRASES })).map(|_| ()))?;
    Ok(d)
}

/// 패드가 받는 한 마디 — 기다리지 않는다. 아직 없으면 None(패드는 그 말만 빼고 나중에 다시 받는다) + 뒤에서 한 번 만들기
pub(crate) fn pre_clip(i: usize) -> Option<Vec<u8>> {
    pre_clip_in(&voice_dir().join("pre"), i, warm_pre)
}

pub(crate) fn pre_clip_in(d: &Path, i: usize, kick: impl FnOnce()) -> Option<Vec<u8>> {
    if !(1..=PHRASES.len()).contains(&i) {
        return None;
    }
    if !pre_same(d) {
        kick();
        return None;
    }
    std::fs::read(d.join(format!("{i:02}.wav"))).ok()
}

/// 뒤에서 미리 만든 말 만들기 — 이미 하고 있으면 또 띄우지 않는다
static PRE_BG: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
fn warm_pre() {
    if PRE_BG.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        if tts_ready() {
            let _ = pre_dir();
        }
        PRE_BG.store(false, std::sync::atomic::Ordering::SeqCst);
    });
}

/// 미리 띄워 두기 — 패드가 아이 화면을 열면(뒤에서): 받아쓰기·목소리 서버·미리 만든 말
pub(crate) fn warm() {
    std::thread::spawn(|| {
        if stt_ready() {
            let _ = stt_port();
        }
        if tts_ready() {
            let _ = pre_dir();
        }
    });
}

// ───────── 소리 조각 ─────────

#[derive(Serialize, Deserialize, Default)]
struct State {
    ready: usize,
    done: bool,
}

/// 한 번의 말(cid)에 대한 답 소리 조각들
pub struct Clips {
    dir: PathBuf,
}

impl Clips {
    pub fn new(root: &Path, cid: &str) -> Result<Clips, String> {
        if cid.is_empty() || cid.len() > 64 || !cid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err("bad cid".into());
        }
        let dir = root.join(cid);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(Clips { dir })
    }
    pub fn path(&self, n: usize) -> PathBuf {
        self.dir.join(format!("{n:02}.wav"))
    }
    pub fn mark(&self, ready: usize, done: bool) -> Result<(), String> {
        let tmp = self.dir.join(format!("state.json.{}", crate::tools::tmp_tag()));
        std::fs::write(&tmp, serde_json::to_string(&State { ready, done }).unwrap_or_default()).map_err(|e| e.to_string())?;
        std::fs::rename(tmp, self.dir.join("state.json")).map_err(|e| e.to_string())
    }
    pub fn state(&self) -> (usize, bool) {
        let s: State = std::fs::read_to_string(self.dir.join("state.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        (s.ready, s.done)
    }
}

fn clips_root(key: &str) -> Result<PathBuf, String> {
    Ok(voice_dir().join(crate::avatar::safe_key(key)?))
}

/// 패드가 받을 조각 — Some(wav) · Ok(None) = 아직 · Err = 더 없음(끝)
pub(crate) fn clip(key: &str, cid: &str, n: usize) -> Result<Option<Vec<u8>>, ()> {
    let Ok(c) = clips_root(key).and_then(|r| Clips::new(&r, cid)) else { return Err(()) };
    let (ready, done) = c.state();
    if n < ready {
        return std::fs::read(c.path(n)).map(Some).map_err(|_| ());
    }
    if done { Err(()) } else { Ok(None) }
}

/// 걸린 시간 기록(속도 실측) — <cid>/timing.json
#[derive(Serialize, Default, Clone)]
pub struct Timing {
    pub heard_ms: u64,
    pub sent_ms: u64,
    pub reply_ms: u64,
    pub first_clip_ms: u64,
    pub text: String,
    pub reply: String,
    /// 어느 앞단으로 갔나 — "api"(Claude API 바로) · "session"(Claude Code 세션), 실측이 몰래 바뀐 길을 재지 않게
    pub via: String,
}

/// 말이 이어질 것 같은 끝 — "-고/-는데/-서", "그리고", "어…" 로 끝나면 더 기다린다(계획서 D '말 시작·끝')
pub fn continues(text: &str) -> bool {
    let t = text.trim().trim_end_matches(['.', ',', '…', '~', ' ']);
    let last = t.split_whitespace().last().unwrap_or("");
    ["그리고", "그래서", "근데", "그러면", "어", "음", "저기", "있잖아"].contains(&last)
        || ["고", "는데", "은데", "인데", "서", "면", "구", "랑", "하고", "니까"].iter().any(|e| last.ends_with(e) && last.chars().count() > e.chars().count())
}

/// 미리 받아쓴 글(말 중간 쉼에서) — cid 마다 하나, 끝 판정 뒤 새 소리가 없으면 다시 안 받아쓴다
static PEEKED: Mutex<Option<(String, String)>> = Mutex::new(None);

/// 말 중간 쉼 — 지금까지 녹음을 받아써 두고 '더 말할 것 같나'를 돌려준다(아이 세션엔 안 보낸다)
pub(crate) fn peek(wav: &[u8], cid: &str) -> Result<(String, bool), String> {
    let text = transcribe(wav)?;
    *PEEKED.lock().unwrap_or_else(|e| e.into_inner()) = Some((cid.to_string(), text.clone()));
    let more = continues(&text);
    Ok((text, more))
}

/// 아이 말(녹음) 하나 — 받아쓰기(빈 녹음이면 미리 받아쓴 글) → 아이 세션 → 답 소리 조각을 뒤에서. 받아쓴 글을 돌려준다
pub(crate) fn hear(key: &str, wav: &[u8], cid: &str, send: impl Fn(&str, &str) -> Result<(), String>) -> Result<String, String> {
    let t0 = std::time::Instant::now();
    let cached = PEEKED.lock().unwrap_or_else(|e| e.into_inner()).take().filter(|(c, _)| c == cid).map(|(_, t)| t);
    let text = match (wav.is_empty(), cached) {
        (true, Some(t)) => t,
        (true, None) => return Err("녹음이 없어".into()),
        (false, _) => transcribe(wav)?,
    };
    if text.is_empty() {
        return Ok(String::new());
    }
    let mut tm = Timing { heard_ms: t0.elapsed().as_millis() as u64, text: text.clone(), ..Default::default() };
    let after = crate::notes::now_ms();
    // 빠른 길 — 기억한 세션 번호로 바로 친다(살아 있나 묻는 `claude agents` 가 0.5초씩 먹었다, 11-17 실측). 못 치면 그때 다시 띄우고 한 번 더
    let k = crate::kids::kid_ready_pub(key)?;
    let msg = format!("{}\n{}", crate::kids::compose_kid(cid, &text)?, crate::kids_make::context_line(&k)); // 지금 작품·캐릭터 이름(앱이 붙인 줄)
    // 말 앞단 '섞어서'(일곱째 조각) — 키가 있으면 Claude API 로 바로(첫 문장이 나오는 즉시 소리), 실패·늦으면 아래 세션 앞단으로
    let api = crate::kids_api::key().map(|api_key| {
        let body = crate::kids_api::body(&crate::kids_api::system_prompt(&k), &crate::kids_api::history(&k, after), &msg);
        crate::kids_api::open(crate::kids_api::BASE, &api_key, &body)
    });
    crate::kids::log_line(&k, after, "kid", &text, Some(cid))?;
    match api {
        Some(Ok(r)) => {
            tm.sent_ms = t0.elapsed().as_millis() as u64;
            tm.via = "api".into();
            let (key, cid) = (key.to_string(), cid.to_string());
            std::thread::spawn(move || speak_api(&key, &cid, r, t0, tm));
            return Ok(text);
        }
        Some(Err(e)) => crate::claude::log_out("kids", &format!("말 앞단 API 못 씀 → 세션 앞단: {e}")),
        None => {}
    }
    let sent = crate::kids_wire::read_session(&k).map(|s| s.id).ok_or_else(|| "세션 없음".to_string()).and_then(|id| send(&id, &msg));
    if sent.is_err() {
        let id = crate::kids_wire::ensure(&k, key).inspect_err(|e| crate::kids::kid_down(key, e))?;
        send(&id, &msg)?;
    }
    tm.sent_ms = t0.elapsed().as_millis() as u64;
    tm.via = "session".into();
    let (key, cid) = (key.to_string(), cid.to_string());
    std::thread::spawn(move || speak_replies(&key, &cid, after, t0, tm));
    Ok(text)
}

/// API 앞단 답 — 흘러 오는 대로 문장마다 소리 조각, 다 오면 표시를 빼서 기록·만들기(세션 길 kids_wire::sync_replies_with 와 같은 규칙)
fn speak_api(key: &str, cid: &str, r: reqwest::blocking::Response, t0: std::time::Instant, mut tm: Timing) {
    let Ok(c) = clips_root(key).and_then(|root| Clips::new(&root, cid)) else { return };
    let Ok(k) = crate::kids::kid_dir(crate::config::data_dir(), key) else { return };
    let gen = next_gen(key);
    let _ = c.mark(0, false);
    let mut n = 0usize;
    let res = crate::kids_api::stream(r, &mut |s: &str| {
        if current_gen(key) != gen {
            return false;
        }
        if tm.reply_ms == 0 {
            tm.reply_ms = t0.elapsed().as_millis() as u64;
        }
        if tts_call(serde_json::json!({ "op": "say", "text": s, "out": c.path(n) })).is_ok() {
            n += 1;
            let _ = c.mark(n, false);
            if tm.first_clip_ms == 0 {
                tm.first_clip_ms = t0.elapsed().as_millis() as u64;
                let _ = std::fs::write(c.dir.join("timing.json"), serde_json::to_string(&tm).unwrap_or_default());
            }
        }
        true
    });
    match res {
        Ok(full) => {
            let (said, orders) = crate::kids_make::parse_orders(&full);
            let said = crate::kids_voice::strip_meta(&said); // 세션 길과 같은 해설 거름
            tm.reply = said.clone();
            if !said.is_empty() {
                let _ = crate::kids::log_line(&k, crate::notes::now_ms(), "assistant", &said, None);
            }
            orders.into_iter().for_each(|o| crate::kids_make::order(key, o));
        }
        Err(e) => crate::claude::log_out("kids", &format!("말 앞단 API 끊김: {e}")),
    }
    let _ = std::fs::write(c.dir.join("timing.json"), serde_json::to_string(&tm).unwrap_or_default());
    let _ = c.mark(n, true);
}

/// 참모마다 지금 듣는 말 번호 — 새 말이 오면 앞 말의 읽기는 그만둔다(같은 답을 두 번 읽지 않게)
static GEN: Mutex<Option<std::collections::HashMap<String, u64>>> = Mutex::new(None);
fn next_gen(key: &str) -> u64 {
    let mut g = GEN.lock().unwrap_or_else(|e| e.into_inner());
    let m = g.get_or_insert_with(Default::default);
    let n = m.get(key).copied().unwrap_or(0) + 1;
    m.insert(key.to_string(), n);
    n
}
fn current_gen(key: &str) -> u64 {
    GEN.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(key).copied()).unwrap_or(0)
}

/// 아이 세션 새 답을 100ms 마다 보고, 나오는 대로 문장마다 소리 조각을 만든다(첫 소리 = 첫 문장 합성).
/// 읽은 뒤 6초 새 답이 없거나, 새 말이 오거나, 90초가 지나면 끝(done)
fn speak_replies(key: &str, cid: &str, after: u64, t0: std::time::Instant, mut tm: Timing) {
    let Ok(c) = clips_root(key).and_then(|r| Clips::new(&r, cid)) else { return };
    let Ok(k) = crate::kids::kid_dir(crate::config::data_dir(), key) else { return };
    let gen = next_gen(key);
    let _ = c.mark(0, false); // 같은 cid 로 다시 들어와도 옛 조각을 '준비됨'으로 내주지 않게
    let mut spoken = 0u64; // 읽은 답의 마지막 시각
    let mut n = 0usize;
    let mut quiet_from: Option<std::time::Instant> = None;
    let end = std::time::Instant::now() + std::time::Duration::from_millis(WATCH_MS);
    while std::time::Instant::now() < end && current_gen(key) == gen && quiet_from.is_none_or(|q| q.elapsed().as_millis() < 6000) {
        crate::kids_wire::sync(&k);
        let rows = crate::kids_wire::recent_log(&k, crate::notes::now_ms(), 1, 50);
        let fresh: Vec<_> = rows.into_iter().filter(|r| r.who == "assistant" && r.ts > after.max(spoken)).collect();
        for r in fresh {
            spoken = spoken.max(r.ts);
            if tm.reply_ms == 0 {
                tm.reply_ms = t0.elapsed().as_millis() as u64;
                tm.reply = r.text.clone();
            }
            quiet_from = Some(std::time::Instant::now());
            for s in sentences(&clean_say(&r.text)) {
                if current_gen(key) != gen {
                    break; // 새 말이 왔다 — 남은 문장은 버린다(목소리 서버를 새 답에 비켜 준다)
                }
                if tts_call(serde_json::json!({ "op": "say", "text": s, "out": c.path(n) })).is_ok() {
                    n += 1;
                    let _ = c.mark(n, false);
                    if tm.first_clip_ms == 0 {
                        tm.first_clip_ms = t0.elapsed().as_millis() as u64;
                        let _ = std::fs::write(c.dir.join("timing.json"), serde_json::to_string(&tm).unwrap_or_default());
                    }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let _ = c.mark(n, true);
}

#[cfg(test)]
#[path = "kids_voice_tests.rs"]
mod tests;
