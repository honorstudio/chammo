//! 모바일 서버의 파일 길 — 폰이 읽을 수 있는 파일은 서버가 계산한 집합 안의 것뿐이다(임의 경로 읽기 없음).
//! 집합 = ① 최근 보여 준 파일(scripts/show 기록 꼬리 — 대시보드 파일 카드와 같은 출처) ② 예약 지침서(<데이터>/routines/<이름>/ROUTINE.md)
//! ③ 비서 HQ 의 docs/starter.md. 요청 경로는 그 집합의 글자와 똑같아야 하고, 경로의 어느 단계도 링크가 아니어야 한다 — 심볼릭 링크·../ 거절.
//! 그림 붙이기는 그림 형식만(앞 바이트로 확인), 10MB, 앱의 save_attach 로 <데이터>/attach 에 저장
use std::path::{Path, PathBuf};

/// 글 파일 상한 — 폰에서 읽을 문서
pub const MAX_TEXT_FILE: u64 = 1024 * 1024;
/// 그림·PDF 상한(원본). 썸네일은 맥이 줄여서 준다
pub const MAX_BIN_FILE: u64 = 10 * 1024 * 1024;
/// 붙이는 파일 상한(그림 포함)
pub const MAX_ATTACH: usize = 20 * 1024 * 1024;

/// 읽어도 되는 경로 집합(순수) — 같은 경로는 한 번
pub fn allowed_files(show_log: &str, routines_json: &str, data_dir: &Path, hq_dir: &str) -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    for line in show_log.lines() {
        if let Some(p) = serde_json::from_str::<serde_json::Value>(line).ok().and_then(|r| r["path"].as_str().map(str::to_string)) {
            v.push(p);
        }
    }
    if let Ok(serde_json::Value::Array(rs)) = serde_json::from_str::<serde_json::Value>(routines_json) {
        for r in rs {
            // 이름이 경로 조각이면(../ 등) 넣지 않는다 — 루틴 이름은 스크립트가 영숫자·-·_ 로 만든다
            if let Some(n) = r["name"].as_str().filter(|n| !n.is_empty() && n.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')) {
                v.push(data_dir.join("routines").join(n).join("ROUTINE.md").to_string_lossy().into_owned());
            }
        }
    }
    if !hq_dir.is_empty() {
        v.push(Path::new(hq_dir).join("docs/starter.md").to_string_lossy().into_owned());
        // 폰이 묻는 모양(/api/env hqDir 는 fwd + '/docs/starter.md') — 윈도우 join 은 역슬래시라 글자 비교에서 늘 403 이었다(2026-10-05). 맥은 위와 같아 아래서 하나로
        v.push(format!("{}/docs/starter.md", crate::config::fwd(hq_dir).trim_end_matches('/')));
    }
    let mut seen = std::collections::HashSet::new();
    v.retain(|p| seen.insert(p.clone()));
    v
}

#[derive(Debug, PartialEq)]
pub enum Kind {
    Image(&'static str),
    /// HEIC 는 사파리 밖에선 못 그리니 썸네일·원본 다 JPEG 로 바꿔 준다
    Heic,
    Pdf,
    /// 오피스 문서(pptx·docx·xlsx·키노트·페이지스·넘버스) — 지금은 QuickLook 썸네일만, 열기는 나중(전략 표 8번)
    Office,
    /// 영상(mp4·mov·m4v) — 지금은 QuickLook 썸네일만, 재생은 Range 를 붙인 뒤(전략 표 8번)
    Video,
    /// 나머지는 전부 글로 — html·svg 도(같은 출처에서 스크립트가 돌면 열쇠 쿠키로 /api 를 부를 수 있다)
    Text,
}

pub fn kind_of(p: &Path) -> Kind {
    match p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("png") => Kind::Image("image/png"),
        Some("jpg" | "jpeg") => Kind::Image("image/jpeg"),
        Some("gif") => Kind::Image("image/gif"),
        Some("webp") => Kind::Image("image/webp"),
        Some("heic" | "heif") => Kind::Heic,
        Some("pdf") => Kind::Pdf,
        Some("pptx" | "ppt" | "key" | "docx" | "doc" | "pages" | "xlsx" | "xls" | "numbers") => Kind::Office,
        Some("mp4" | "mov" | "m4v") => Kind::Video,
        _ => Kind::Text,
    }
}

#[derive(Debug, PartialEq)]
pub enum Pick {
    Ok(PathBuf),
    /// 집합 밖·링크·../ — 403
    Forbidden,
    NotFound,
}

/// 폰에 내보내도 되는 파일인가 — 거부 목록이 아니라 허용 목록(2026-10-02 보안 리뷰: 거부 목록은 accounts.json·.mcp.json·.npmrc 등을 못 걸렀다).
/// 하위 세션은 확인 없이 돌아 무엇이든 scripts/show 할 수 있으니 이게 마지막 벽이다
/// - 확장자: md·txt·html·png·jpg·jpeg·gif·webp·heic·pdf 만
/// - 점으로 시작하는 경로 성분(~/.claude·~/.config·~/.ssh …)이 하나라도 있으면 거절 — 프로젝트 안 .shots·.claude/worktrees 만 예외
/// - 데이터 폴더 안은 routines/<이름>/ROUTINE.md 만, HQ 는 docs/starter.md 를 예외로(둘 다 폰 화면이 쓴다)
/// - 이름에 secret·key·token·credential·password·infra 가 들거나 *.local.md 면 거절
/// 파일 길 규칙에 필요한 자리 — 데이터 폴더·HQ·홈
pub struct Rules {
    pub data_dir: PathBuf,
    pub hq_dir: String,
    pub home: PathBuf,
}

/// 점 성분 예외 — 프로젝트 안 '.shots'(캡처·리포트)와 '.claude/worktrees'(가지별 시안). 홈 바로 아래 ~/.claude 는 아니다(2026-10-02 참모-2 결정 ②)
fn dot_ok(p: &Path, home: &Path) -> bool {
    let cs: Vec<_> = p.components().collect();
    cs.iter().enumerate().all(|(i, c)| {
        let n = c.as_os_str().to_string_lossy();
        if !n.starts_with('.') {
            return true;
        }
        if n == ".shots" {
            return true;
        }
        let parent: PathBuf = cs[..i].iter().collect();
        n == ".claude" && cs.get(i + 1).is_some_and(|x| x.as_os_str() == "worktrees") && parent != home
    })
}

pub fn shareable(p: &Path, r: &Rules) -> bool {
    let (data_dir, hq_dir) = (r.data_dir.as_path(), r.hq_dir.as_str());
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_ascii_lowercase();
    let ext_ok = matches!(p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(), Some("md" | "txt" | "html" | "json" | "csv" | "tsv" | "log" | "yaml" | "yml" | "toml" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "py" | "rs" | "sh" | "swift" | "kt" | "css" | "sql" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "heic" | "pdf" | "pptx" | "ppt" | "key" | "docx" | "doc" | "pages" | "xlsx" | "xls" | "numbers" | "mp4" | "mov" | "m4v"));
    // 코드·설정 글(json 등)을 열면서 서비스 계정·SSH 키 이름도 막는다(2026-10-03). 글 속 키는 secret_in 이 따로 본다
    let word_bad = ["secret", "key", "token", "credential", "password", "infra", "service-account", "service_account", "adminsdk", "google-services", "googleservice", "id_rsa", "id_ed25519", "settings", "accounts"].iter().any(|w| name.contains(w))
        || name.ends_with(".local.md")
        || name.starts_with(".env");
    if !ext_ok || word_bad {
        return false;
    }
    let routine = p.strip_prefix(data_dir.join("routines")).ok().is_some_and(|r| {
        let c: Vec<_> = r.components().collect();
        c.len() == 2 && c[1].as_os_str() == "ROUTINE.md" && !c[0].as_os_str().to_string_lossy().starts_with('.')
    });
    let starter = !hq_dir.is_empty() && p == Path::new(hq_dir).join("docs/starter.md");
    if routine || starter || phone_attach(p, data_dir) {
        return true;
    }
    if p.starts_with(data_dir) {
        return false;
    }
    dot_ok(p, &r.home)
}

/// 폰이 올린 첨부 — <데이터>/attach/<숫자>-phone.<보기 되는 확장자>, 서버가 지은 이름 꼴만(save_attach("phone.<ext>")).
/// 보낸 말풍선 썸네일용이라 보여 준 목록에 없어도 된다. 데스크톱이 붙인 그림(시각-원래이름)·하위 폴더는 아니다
pub fn phone_attach(p: &Path, data_dir: &Path) -> bool {
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let Some((ms, ext)) = name.split_once("-phone.") else { return false };
    // 경로 중간 ./ · // 는 components 가 접어서 점 검사에 안 걸린다 — 글자 그대로 정규형일 때만
    p.as_os_str() == p.components().collect::<PathBuf>().as_os_str()
        && p.parent() == Some(data_dir.join("attach").as_path())
        && !ms.is_empty()
        && ms.bytes().all(|b| b.is_ascii_digit())
        && matches!(ext, "png" | "jpg" | "jpeg" | "gif" | "webp" | "pdf" | "md" | "txt")
}

/// 요청 경로가 집합 안(또는 폰이 올린 첨부)이고, 어느 단계도 링크가 아니며 ../ 가 없나
pub fn pick(requested: &str, allowed: &[String], rules: &Rules) -> Pick {
    let listed = allowed.iter().any(|a| a == requested) || phone_attach(Path::new(requested), &rules.data_dir);
    if !Path::new(requested).is_absolute() || !listed {
        return Pick::Forbidden;
    }
    match plain_path(Path::new(requested)) {
        Plain::Link => Pick::Forbidden,
        Plain::Missing => Pick::NotFound,
        Plain::Ok if !shareable(Path::new(requested), rules) => Pick::Forbidden,
        Plain::Ok if Path::new(requested).is_file() => Pick::Ok(PathBuf::from(requested)),
        Plain::Ok => Pick::NotFound,
    }
}

/// 닫힌 워크트리 안을 가리키던 경로 → 본 폴더의 같은 파일(2026-10-04 — 일이 끝나 워크트리를 닫으면 띄운 파일이 "not found" 였다).
/// '<저장소>/.claude/worktrees/<이름>/<나머지>' 이고 그 경로가 없을 때만: ① <저장소>/<나머지>(머지된 문서)
/// ② 나머지가 .shots/ 로 시작하면 <저장소>/.shots/wt-<이름>/<.shots 뒤>(참모가 닫을 때 옮겨 둔 캡처).
/// 글자 그대로 정규형(.. · . · // 없음)·홈 안·저장소가 홈 자체 아님·<저장소>/.git 있음·찾은 자리의 어느 단계도 링크 아님일 때만 푼다.
/// 여기는 '어디로 옮겼나'만 — 폰에선 풀린 경로도 pick(허용 집합·shareable·링크)을 그대로 지난다
pub fn moved_from_worktree(p: &Path, home: &Path) -> Option<PathBuf> {
    use std::path::Component;
    let cs: Vec<Component> = p.components().collect();
    let canonical = p.as_os_str() == cs.iter().collect::<PathBuf>().as_os_str();
    if !p.is_absolute() || !canonical || cs.iter().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return None;
    }
    if std::fs::symlink_metadata(p).is_ok() {
        return None;
    }
    let i = cs.windows(2).position(|w| w[0].as_os_str() == ".claude" && w[1].as_os_str() == "worktrees")?;
    let repo: PathBuf = cs[..i].iter().collect();
    let name = cs.get(i + 2)?.as_os_str().to_str()?;
    let rest: PathBuf = cs.get(i + 3..)?.iter().collect();
    if rest.as_os_str().is_empty() || name.starts_with('.') || repo == home || !repo.starts_with(home) || std::fs::symlink_metadata(repo.join(".git")).is_err() {
        return None;
    }
    let mut cand = vec![repo.join(&rest)];
    if let Some(after) = rest.strip_prefix(".shots").ok().filter(|a| !a.as_os_str().is_empty()) {
        cand.push(repo.join(".shots").join(format!("wt-{name}")).join(after));
    }
    cand.into_iter().find(|c| plain_path(c) == Plain::Ok && c.is_file())
}

/// show 기록을 읽을 때 사라진 경로 손보기 — 워크트리에서 옮겨 간 파일은 path 를 새 자리로, 어디서도 못 찾으면 "gone": true(목록이 뺀다).
/// 있는 줄·웹 주소·깨진 줄은 글자 그대로. 폰(/api/shows·허용 집합)과 데스크톱 스페이스가 다 이걸 거친 기록을 읽는다
pub fn resolve_show_log(log: &str, home: &Path) -> String {
    let mut out = String::with_capacity(log.len());
    for line in log.split_inclusive('\n') {
        let body = line.trim_end_matches('\n');
        let fixed = serde_json::from_str::<serde_json::Value>(body).ok().and_then(|mut v| {
            let p = PathBuf::from(v.get("path")?.as_str()?);
            if !p.is_absolute() || std::fs::symlink_metadata(&p).is_ok() {
                return None;
            }
            match moved_from_worktree(&p, home) {
                Some(n) => v["path"] = n.to_string_lossy().into_owned().into(),
                None => v["gone"] = true.into(),
            }
            Some(v.to_string())
        });
        out.push_str(fixed.as_deref().unwrap_or(body));
        if line.ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

#[derive(Debug, PartialEq)]
enum Plain {
    Ok,
    /// 어느 단계가 심볼릭 링크이거나 .. · . 가 있다
    Link,
    Missing,
}

/// 경로의 모든 단계(맨 위부터 파일까지)가 링크가 아니고 .. 가 없나 — canonicalize 글자 비교는 맥이 한글 이름을 NFD 로
/// 돌려줘 NFC 요청과 달라 멀쩡한 파일을 거절했다(2026-10-02). 단계마다 lstat 은 정규화와 상관없이 찾는다
fn plain_path(p: &Path) -> Plain {
    use std::path::Component;
    if p.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return Plain::Link;
    }
    let mut cur = PathBuf::new();
    for c in p.components() {
        cur.push(c);
        if matches!(c, Component::RootDir | Component::Prefix(_)) {
            continue;
        }
        match std::fs::symlink_metadata(&cur) {
            Ok(m) if m.file_type().is_symlink() => return Plain::Link,
            Ok(_) => {}
            Err(_) => return Plain::Missing,
        }
    }
    Plain::Ok
}

/// 썸네일로 줄일 원본 상한 — 큰 사진도 줄여서는 준다
pub const MAX_THUMB_SRC: u64 = 40 * 1024 * 1024;

/// 고른(pick) 뒤 읽기 — 그 사이 경로를 링크로 바꿔치기하면 거절한다. 끝 성분은 O_NOFOLLOW 로 열고,
/// 연 뒤 경로의 모든 단계가 링크가 아니며 그 경로의 (dev, ino) 가 연 fd 와 같을 때만 읽는다. max 넘으면 거절
pub fn read_verified(requested: &str, max: u64) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let (f, len) = open_verified(requested)?;
    if len > max {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "too large"));
    }
    let mut buf = Vec::with_capacity(len as usize);
    f.take(max + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > max {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "too large"));
    }
    Ok(buf)
}

/// 영상 한 조각 — read_verified 와 같은 확인(링크·바꿔치기) 뒤 start..=end 만. 돌려주는 건 (조각, 파일 전체 크기)
pub fn read_range_verified(requested: &str, start: u64, end: u64) -> std::io::Result<(Vec<u8>, u64)> {
    use std::io::{Read, Seek, SeekFrom};
    let (mut f, len) = open_verified(requested)?;
    if start > end || end >= len {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "bad range"));
    }
    f.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity((end - start + 1) as usize);
    f.take(end - start + 1).read_to_end(&mut buf)?;
    Ok((buf, len))
}

/// Range 머리 → (처음, 끝) 바이트(끝 포함). 머리가 없으면 앞부터. 한 번에 cap 까지만(사파리는 이어서 다시 묻는다).
/// 여러 조각·이상한 꼴·파일 밖이면 None(416)
pub fn parse_range(h: Option<&str>, total: u64, cap: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    let (start, end) = match h {
        None => (0, total - 1),
        Some(h) => {
            let spec = h.trim().strip_prefix("bytes=")?;
            if spec.contains(',') {
                return None;
            }
            let (a, b) = spec.split_once('-')?;
            match (a.trim(), b.trim()) {
                ("", n) => {
                    let n: u64 = n.parse().ok().filter(|&n| n > 0)?;
                    (total.saturating_sub(n), total - 1)
                }
                (a, "") => (a.parse().ok()?, total - 1),
                (a, b) => {
                    let (a, b): (u64, u64) = (a.parse().ok()?, b.parse().ok()?);
                    if b < a {
                        return None;
                    }
                    (a, b.min(total - 1))
                }
            }
        }
    };
    if start >= total {
        return None;
    }
    Some((start, end.min(start + cap - 1)))
}

/// 확인된 파일 열기 — 링크 따라가지 않고(O_NOFOLLOW), 연 뒤에 그 경로가 지금도 같은 파일인지. (파일, 크기)
pub fn open_verified(requested: &str) -> std::io::Result<(std::fs::File, u64)> {
    let bad = |m: &str| std::io::Error::new(std::io::ErrorKind::PermissionDenied, m.to_string());
    let mut o = std::fs::OpenOptions::new();
    o.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.custom_flags(libc::O_NOFOLLOW);
    }
    let f = o.open(requested)?;
    let fm = f.metadata()?;
    if !fm.is_file() {
        return Err(bad("not a file"));
    }
    // 연 뒤에 다시 — 어느 단계도 링크가 아니고, 그 경로가 지금도 연 파일(같은 dev·ino)이어야
    if plain_path(Path::new(requested)) != Plain::Ok {
        return Err(bad("path changed"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let pm = std::fs::metadata(requested)?;
        if (fm.dev(), fm.ino()) != (pm.dev(), pm.ino()) {
            return Err(bad("file swapped"));
        }
    }
    Ok((f, fm.len()))
}

/// 붙이는 그림 — 앞 바이트로 형식을 본다(Content-Type 은 믿지 않는다). 돌려주는 건 저장할 확장자
pub fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.len() > 12 && &bytes[4..8] == b"ftyp" && matches!(&bytes[8..12], b"heic" | b"heix" | b"mif1" | b"msf1" | b"hevc") {
        Some("heic")
    } else {
        None
    }
}

/// 임시 파일을 처음부터 600 으로(남이 못 읽게)
pub fn write_private_tmp(p: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    o.open(p)?.write_all(bytes)
}

/// 폰에서 붙일 수 있는 파일인가 → 저장할 확장자(이름은 서버가 짓는다). 허용 목록: 그림(png·jpg·gif·webp·heic) · pdf · zip · txt·md·csv·json.
/// - 실행 파일(Mach-O·ELF·Windows)·셰뱅(#!) 스크립트는 이름이 무엇이든 거절
/// - 그림은 앞 바이트가 정한다 / pdf·zip 은 이름 확장자 + 앞 바이트 / 글은 이름 확장자 + 글 MIME + UTF-8·NUL 없음
/// - 이름은 확장자 힌트로만(마지막 확장자 하나) — 경로·겹친 확장자는 저장 이름에 안 쓴다
pub fn attach_kind(bytes: &[u8], mime: &str, name: &str) -> Option<&'static str> {
    const EXEC: [&[u8]; 8] = [b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\x7fELF", b"MZ", b"#!"];
    if EXEC.iter().any(|m| bytes.starts_with(m)) {
        return None;
    }
    if let Some(ext) = image_ext(bytes) {
        return Some(ext);
    }
    let file = name.rsplit(['/', '\\']).next().unwrap_or("");
    let ext = file.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let mime = mime.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    match ext.as_str() {
        "pdf" if bytes.starts_with(b"%PDF-") => Some("pdf"),
        "zip" if (bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06"))
            && matches!(mime.as_str(), "application/zip" | "application/x-zip-compressed" | "application/octet-stream" | "") => Some("zip"),
        "txt" | "md" | "csv" | "json"
            if matches!(mime.as_str(), "text/plain" | "text/markdown" | "text/x-markdown" | "text/csv" | "application/json" | "application/octet-stream" | "")
                && !bytes.contains(&0)
                && std::str::from_utf8(bytes).is_ok() =>
        {
            Some(match ext.as_str() { "txt" => "txt", "md" => "md", "csv" => "csv", _ => "json" })
        }
        _ => None,
    }
}

/// 참모 프사 그림 — 경로는 키로만 만든다(<프사 폴더>/<키>.<png|jpg|gif|webp>). 키 검사·링크 거절(read_verified)·5MB·
/// 확장자와 앞 바이트가 같아야(SVG 등은 못 들어온다)
pub fn avatar_image_in(dir: &Path, key: &str) -> Option<(Vec<u8>, &'static str)> {
    if crate::avatar::safe_key(key).ok()? != key {
        return None;
    }
    for (ext, mime) in [("png", "image/png"), ("jpg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp")] {
        let p = dir.join(format!("{key}.{ext}"));
        if !p.exists() {
            continue;
        }
        let bytes = read_verified(&p.to_string_lossy(), crate::avatar::MAX_IMAGE as u64).ok()?;
        return (crate::avatar::sniff(&bytes) == Some(ext)).then_some((bytes, mime));
    }
    None
}

/// 맥 내장 sips 로 줄이기·JPEG 로 바꾸기(새 크레이트 없이). max = 긴 변(px), None 이면 크기 그대로 형식만
/// 그림 크기(가로, 세로) — 파일 앞 바이트로(PNG IHDR·JPEG SOF·GIF·WebP VP8/VP8L/VP8X). 모르면 None
pub fn image_dims(b: &[u8]) -> Option<(u32, u32)> {
    let be16 = |i: usize| b.get(i..i + 2).map(|x| u16::from_be_bytes([x[0], x[1]]) as u32);
    let le16 = |i: usize| b.get(i..i + 2).map(|x| u16::from_le_bytes([x[0], x[1]]) as u32);
    let le24 = |i: usize| b.get(i..i + 3).map(|x| x[0] as u32 | (x[1] as u32) << 8 | (x[2] as u32) << 16);
    if b.starts_with(b"\x89PNG\r\n\x1a\n") && b.get(12..16) == Some(b"IHDR") {
        let w = u32::from_be_bytes(b.get(16..20)?.try_into().ok()?);
        let h = u32::from_be_bytes(b.get(20..24)?.try_into().ok()?);
        return Some((w, h));
    }
    if b.starts_with(b"GIF8") {
        return Some((le16(6)?, le16(8)?));
    }
    if b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP") {
        return match b.get(12..16)? {
            b"VP8X" => Some((le24(24)? + 1, le24(27)? + 1)),
            b"VP8 " => Some((le16(26)? & 0x3FFF, le16(28)? & 0x3FFF)),
            b"VP8L" => {
                let v = u32::from_le_bytes(b.get(21..25)?.try_into().ok()?);
                Some(((v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1))
            }
            _ => None,
        };
    }
    if b.starts_with(&[0xFF, 0xD8]) {
        let mut i = 2;
        while i + 4 <= b.len() {
            if b[i] != 0xFF {
                return None;
            }
            let m = b[i + 1];
            let len = be16(i + 2)? as usize;
            // SOF0~SOF15(DHT C4·JPG C8·DAC CC 빼고)
            if (0xC0..=0xCF).contains(&m) && !matches!(m, 0xC4 | 0xC8 | 0xCC) {
                return Some((be16(i + 7)?, be16(i + 5)?));
            }
            i += 2 + len;
        }
    }
    None
}

/// 보기용으로 줄일까 — 긴 변 2560 넘거나 1.5MB 넘으면 JPEG 2560(HEIC 는 늘), 아니면 원본(None). GIF·그림 아닌 건 그대로.
/// 긴 캡처는 따로 — 짧은 변 1440·16MP 까지(돌려주는 값은 sips -Z 긴 변)
pub fn view_plan(kind: &Kind, len: u64, dims: Option<(u32, u32)>) -> Option<u32> {
    const SIDE: u32 = 2560;
    match kind {
        Kind::Heic => Some(SIDE),
        Kind::Image("image/gif") => None,
        Kind::Image(_) => match dims {
            // 긴 캡처(긴 변이 2.5배 넘게) — 짧은 변 1440·화소 16MP 까지만 줄인다(긴 변 2560 이면 세로 캡처 글씨가 뭉갰다, 전략 표 7번)
            Some((w, h)) if w.max(h) as f64 / w.min(h).max(1) as f64 > 2.5 => {
                let (long, short) = (w.max(h) as f64, w.min(h) as f64);
                let by_short = if short > 1440.0 { long * 1440.0 / short } else { long };
                let by_pixels = (16_000_000.0 * long / short).sqrt();
                let target = by_short.min(by_pixels).min(long).floor() as u32;
                (target < w.max(h) || len > 1_500_000).then_some(target)
            }
            _ => (len > 1_500_000 || dims.is_none_or(|(w, h)| w.max(h) > SIDE)).then_some(SIDE),
        },
        _ => None,
    }
}

/// 썸네일 긴 변 — 작은 카드 360·큰 카드 720(2배 화면), 그 밖은 예전 480
pub fn thumb_size(p: Option<&str>) -> u32 {
    match p {
        Some("360") => 360,
        Some("720") => 720,
        // 오피스 첫 장 크게 보기(폰 OfficeSheet)
        Some("1600") => 1600,
        _ => 480,
    }
}

/// 썸네일을 QuickLook 으로 — PDF·HTML 시안·오피스·영상(그림은 sips, 글은 폰이 앞부분을 글로)
pub fn wants_quicklook(p: &Path) -> bool {
    matches!(p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(), Some("pdf" | "html" | "htm"))
        || matches!(kind_of(p), Kind::Office | Kind::Video)
}

/// QuickLook 첫 장(qlmanage -t) → JPEG(긴 변 size). 오래 걸리면(영상 등) 20초에 끊는다
pub fn ql_jpeg(src: &Path, size: u32) -> Option<Vec<u8>> {
    let dir = std::env::temp_dir().join(format!("chammo-mobile-ql-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
    std::fs::create_dir_all(&dir).ok()?;
    let mut c = crate::platform::command("/usr/bin/qlmanage");
    c.args(["-t", "-s", &size.to_string(), "-o"]).arg(&dir).arg(src);
    let _ = crate::platform::run_capped(&mut c, std::time::Duration::from_secs(20));
    let png = dir.join(format!("{}.png", src.file_name()?.to_string_lossy()));
    let out = png.exists().then(|| sips_jpeg(&png, Some(size))).flatten();
    let _ = std::fs::remove_dir_all(&dir);
    out
}

pub fn sips_jpeg(src: &Path, max: Option<u32>) -> Option<Vec<u8>> {
    let out = std::env::temp_dir().join(format!("chammo-mobile-{}-{}.jpg", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
    let mut c = crate::platform::command("/usr/bin/sips");
    if let Some(m) = max {
        c.arg("-Z").arg(m.to_string());
    }
    // 품질 85 — 보기용(2560)이 흐리지 않게, 썸네일도 같은 값
    let ok = c.args(["-s", "format", "jpeg", "-s", "formatOptions", "85"]).arg(src).arg("--out").arg(&out).output().is_ok_and(|o| o.status.success());
    let bytes = ok.then(|| std::fs::read(&out).ok()).flatten();
    let _ = std::fs::remove_file(&out);
    bytes
}

/// 워드(docx·doc)를 html 로 — 맥 textutil. 폰은 거른 뒤 글로 읽는다(전략 표 8번). 20초에 끊는다
pub fn doc_html(src: &Path) -> Option<String> {
    let mut c = crate::platform::command("/usr/bin/textutil");
    c.args(["-convert", "html", "-stdout"]).arg(src);
    let o = crate::platform::run_capped(&mut c, std::time::Duration::from_secs(20)).ok()?;
    o.status.success().then(|| String::from_utf8_lossy(&o.stdout).into_owned())
}

#[cfg(test)]
#[path = "mobile_files_tests.rs"]
mod tests;

/// 글 속에 비밀이 보이나 — 개인 키·API 키(sk-·ghp_·xoxb-·AKIA·sb_secret_)·서비스 계정 JSON·긴 JWT(supabase service_role 등).
/// 코드·설정 글을 폰에 열면서 이름만으론 못 거르는 것(2026-10-03). 앞 글자가 영숫자면 단어 중간이라 안 본다(task-… 등)
pub fn secret_in(bytes: &[u8]) -> bool {
    let t = String::from_utf8_lossy(bytes);
    if t.contains("PRIVATE KEY-----") || t.contains("\"private_key\"") {
        return true;
    }
    let tok = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-';
    let starts_at = |i: usize| i == 0 || !t[..i].chars().next_back().is_some_and(|c| c.is_ascii_alphanumeric());
    let run_after = |i: usize, f: &dyn Fn(char) -> bool| t[i..].chars().take_while(|&c| f(c)).count();
    for (pre, min) in [("sk-", 20), ("ghp_", 30), ("github_pat_", 20), ("glpat-", 20), ("xoxb-", 10), ("xoxp-", 10), ("xoxa-", 10), ("sb_secret_", 16)] {
        for (i, _) in t.match_indices(pre) {
            if starts_at(i) && run_after(i + pre.len(), &tok) >= min {
                return true;
            }
        }
    }
    for (i, _) in t.match_indices("AKIA") {
        if starts_at(i) && run_after(i + 4, &|c: char| c.is_ascii_uppercase() || c.is_ascii_digit()) >= 16 {
            return true;
        }
    }
    // JWT — eyJ 로 시작해 점 둘, 80자 넘게
    for (i, _) in t.match_indices("eyJ") {
        let n = run_after(i, &|c: char| tok(c) || c == '.');
        if starts_at(i) && n >= 80 && t[i..i + n].matches('.').count() >= 2 {
            return true;
        }
    }
    false
}

/// md 문서가 가리킨 그림(상대 경로만) — ![..](경로 "제목") 와 <img src="경로">. 웹 주소·절대 경로·data: 는 뺀다.
/// 폰 문서 보기에서 속 그림을 그 문서 덕에 열어 준다(보여 준 목록에 없어도) — 문서가 가리킨 것만
pub fn md_images(md: &str, doc: &Path) -> Vec<PathBuf> {
    let mut raw: Vec<&str> = Vec::new();
    let mut rest = md;
    while let Some(i) = rest.find("![") {
        rest = &rest[i + 2..];
        let Some(close) = rest.find("](") else { break };
        let tail = &rest[close + 2..];
        if let Some(end) = tail.find(')') {
            raw.push(tail[..end].split_whitespace().next().unwrap_or("").trim_matches(|c| c == '<' || c == '>'));
        }
    }
    let mut rest = md;
    while let Some(i) = rest.find("<img") {
        rest = &rest[i + 4..];
        let Some(j) = rest.find("src=") else { break };
        let v = &rest[j + 4..];
        let q = v.chars().next().unwrap_or(' ');
        if q == '"' || q == '\'' {
            if let Some(end) = v[1..].find(q) {
                raw.push(&v[1..1 + end]);
            }
        }
    }
    let Some(base) = doc.parent() else { return Vec::new() };
    let mut out = Vec::new();
    for r in raw {
        if r.is_empty() || r.contains("://") || r.starts_with('/') || r.starts_with("data:") || r.starts_with('#') || r.starts_with('~') {
            continue;
        }
        let Ok(dec) = percent_encoding::percent_decode_str(r).decode_utf8() else { continue };
        let mut p = base.to_path_buf();
        for c in Path::new(dec.as_ref()).components() {
            match c {
                std::path::Component::ParentDir => { p.pop(); }
                std::path::Component::Normal(n) => p.push(n),
                _ => {}
            }
        }
        if matches!(kind_of(&p), Kind::Image(_) | Kind::Heic) && !out.contains(&p) {
            out.push(p);
        }
    }
    out
}
