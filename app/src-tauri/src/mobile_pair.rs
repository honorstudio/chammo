//! 모바일 짝짓기 — 마스터 열쇠는 폰으로 나가지 않는다(2026-10-02 보안 리뷰 7·8).
//! QR 에는 10분 지나면 죽는 한 번짜리 짝짓기 코드만 담고, 그걸 낸 기기에 기기별 토큰을 준다.
//! 데이터 폴더(mobile-devices.json, 600)에는 토큰의 해시만 — 기기 이름·만든 때·마지막 접속과 함께. 설정에서 기기별로 끊는다.
//! 같은 폰은 증명으로만 알아본다(2026-10-05, docs/research/2026-10-05-phone-device-identity.md) — 같은 저장 공간의 옛 열쇠를 내밀면
//! 그 줄의 열쇠를 바꿔 끼우고, 홈 화면 앱은 코드를 낸 기기 아래로 묶는다. 증명이 없으면 새 줄 — 대신 상한·30일 정리로 끝없이 늘지 않게
use crate::mobile_http::ct_eq;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// 짝짓기 코드 수명
pub const PAIR_TTL: Duration = Duration::from_secs(10 * 60);
/// 기기 줄 상한 — 넘으면 가장 오래 안 쓴 줄부터 뺀다(폰 넷 × 사파리·홈 화면 앱)
pub const MAX_DEVICES: usize = 8;
/// 이만큼 안 쓴 줄은 정리한다
const IDLE_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000;
/// 예전엔 홈 화면 앱을 이름 끝에 붙여 적었다 — 읽을 때 칸(home)으로 나눈다
const HOME_SUFFIX: &str = " 홈 화면 앱";
/// 마지막 접속을 파일에 적는 간격(요청마다 쓰지 않게)
const SEEN_FLUSH: Duration = Duration::from_secs(60);
const FILE: &str = "mobile-devices.json";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Device {
    id: String,
    name: String,
    /// sha256(토큰) 16진 — 토큰 원문은 어디에도 안 남는다
    hash: String,
    created: u64,
    #[serde(default)]
    last_seen: Option<u64>,
    /// 홈 화면 앱 칸(사파리 탭과 저장 공간이 따로라 한 폰에 열쇠가 둘)
    #[serde(default)]
    home: bool,
    /// 같은 폰 묶음 — 없으면 자기 id. 홈 화면 앱은 코드를 낸 기기의 묶음을 따른다
    #[serde(default, skip_serializing_if = "Option::is_none")]
    group: Option<String>,
    /// 열쇠를 마지막으로 내준 때(바꿔 끼우면 갱신) — 없으면 created
    #[serde(default, skip_serializing_if = "Option::is_none")]
    paired: Option<u64>,
}

impl Device {
    fn group_id(&self) -> &str {
        self.group.as_deref().unwrap_or(&self.id)
    }
    fn used(&self) -> u64 {
        self.last_seen.unwrap_or(self.created)
    }
}

/// 설정 화면에 보일 것(해시 없이)
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub id: String,
    pub name: String,
    pub created: u64,
    pub last_seen: Option<u64>,
    pub home: bool,
    pub group: String,
    pub paired: u64,
}

/// 짝짓기 요청 — prev = 이 저장 공간에 남아 있던 옛 열쇠(있으면)
pub struct Pairing<'a> {
    pub name: &'a str,
    pub home: bool,
    pub prev: Option<&'a str>,
}

/// 정리로 빠진 줄 — notify.log 에 이유와 함께 남긴다
#[derive(Debug)]
pub(crate) struct Removed {
    pub id: String,
    pub name: String,
    pub reason: String,
}

/// 정리 — 미래 시각(시계가 거꾸로 감)은 지금으로 당기고, 30일 안 쓴 줄과 상한을 넘은 줄(가장 오래 안 쓴 것부터)을 뺀다. keep 은 방금 쓴 줄
pub(crate) fn prune(list: &mut Vec<Device>, now: u64, keep: Option<&str>) -> Vec<Removed> {
    for d in list.iter_mut() {
        if d.last_seen.is_some_and(|t| t > now) {
            d.last_seen = Some(now);
        }
        d.created = d.created.min(now);
        d.paired = d.paired.map(|t| t.min(now));
    }
    let kept = |d: &Device| keep == Some(d.id.as_str());
    let mut gone = Vec::new();
    list.retain(|d| {
        let idle = !kept(d) && now.saturating_sub(d.used()) > IDLE_TTL_MS;
        if idle {
            gone.push(Removed { id: d.id.clone(), name: d.name.clone(), reason: "30일 넘게 안 씀".into() });
        }
        !idle
    });
    while list.len() > MAX_DEVICES {
        let Some(i) = list.iter().enumerate().filter(|(_, d)| !kept(d)).min_by_key(|(_, d)| d.used()).map(|(i, _)| i) else { break };
        let d = list.remove(i);
        gone.push(Removed { id: d.id, name: d.name, reason: format!("상한 {MAX_DEVICES}줄 넘어 가장 오래 안 쓴 것") });
    }
    gone
}

/// 기기 줄을 바꾸거나 지운 일은 notify.log 에 한 줄(지운 이유가 없으면 나중에 '왜 끊겼지'를 못 가린다). 시험에선 진짜 로그에 안 쓴다
fn log_device(text: &str) {
    #[cfg(not(test))]
    crate::claude::log_out("mobile-device", text);
    #[cfg(test)]
    let _ = text;
}

fn short(id: &str) -> &str {
    id.get(..4).unwrap_or(id)
}

fn log_removed(gone: &[Removed]) {
    for r in gone {
        log_device(&format!("정리 {} {} — {}", short(&r.id), r.name, r.reason));
    }
}

/// 해시가 같은 줄 — 모든 줄과 끝까지 비교(어느 칸에서 맞았는지 시간으로 새지 않게)
fn find_hash(list: &[Device], h: &str) -> Option<usize> {
    let mut at = None;
    for (i, d) in list.iter().enumerate() {
        if ct_eq(h.as_bytes(), d.hash.as_bytes()) {
            at = Some(i);
        }
    }
    at
}

struct Inner {
    list: Vec<Device>,
    /// 마지막으로 읽은 파일의 고친 시각 — 다른 앱이 바꿨으면 다시 읽는다
    mtime: Option<SystemTime>,
    /// (sha256(코드), 만료 시각, 낸 기기 id) — 지금 살아 있는 짝짓기 코드 하나. 맥 QR 은 낸 기기가 없다
    code: Option<(String, SystemTime, Option<String>)>,
    flushed: Instant,
}

pub struct Devices {
    path: Option<PathBuf>,
    inner: Mutex<Inner>,
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub(crate) fn random_hex(n: usize) -> std::io::Result<String> {
    let mut b = vec![0u8; n];
    getrandom::fill(&mut b).map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(hex(&b))
}

fn sha(s: &str) -> String {
    hex(&Sha256::digest(s.as_bytes()))
}

fn ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 600 으로 쓰고 바꿔 끼운다
pub(crate) fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    // 이름이 고유해야 두 앱이 동시에 써도 서로의 임시 파일을 안 밟는다
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tid = format!("{:?}", std::thread::current().id()).chars().filter(char::is_ascii_digit).collect::<String>();
    let tmp = path.with_extension(format!("json.{}.{tid}.{nanos}.tmp", std::process::id()));
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let mut f = o.open(&tmp)?;
    f.write_all(text.as_bytes())?;
    f.sync_all()?;
    std::fs::rename(&tmp, path)
}

/// User-Agent → 짧은 기기 이름
pub fn device_name(ua: &str) -> String {
    for (needle, name) in [("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"), ("Macintosh", "Mac"), ("Windows", "Windows")] {
        if ua.contains(needle) {
            return name.into();
        }
    }
    "기기".into()
}

impl Devices {
    /// 시험용 — 파일 없이
    #[cfg(test)]
    pub fn memory() -> Devices {
        Devices { path: None, inner: Mutex::new(Inner { list: Vec::new(), mtime: None, code: None, flushed: Instant::now() }) }
    }

    /// 시험용 — 이미 짝지은 기기 하나(토큰을 알고 있는)
    #[cfg(test)]
    pub fn with_token(token: &str, name: &str) -> Devices {
        let d = Devices::memory();
        d.inner.lock().unwrap().list.push(Device { id: "test0001".into(), name: name.into(), hash: sha(token), created: ms(SystemTime::now()), last_seen: None, home: false, group: None, paired: None });
        d
    }

    /// 시험용 — 다음 check 가 마지막 접속을 파일에 적게
    #[cfg(test)]
    pub fn backdate_flush(&self) {
        self.inner.lock().unwrap().flushed = Instant::now() - SEEN_FLUSH - Duration::from_secs(1);
    }

    /// <데이터 폴더>/mobile-devices.json — 없거나 깨졌으면 빈 목록. 같은 데이터 폴더를 두 앱(본판·개발판)이 같이 쓸 수 있다
    pub fn open(dir: &Path) -> Devices {
        let path = dir.join(FILE);
        let (list, mtime) = read_list(&path);
        let d = Devices { path: Some(path), inner: Mutex::new(Inner { list, mtime, code: None, flushed: Instant::now() }) };
        // 켤 때 한 번 정리 — 지울 게 있을 때만 쓴다
        let now = ms(SystemTime::now());
        let mut g = d.inner.lock().unwrap();
        if !prune(&mut g.list.clone(), now, None).is_empty() {
            let mut gone = Vec::new();
            if d.mutate(&mut g, |l| gone = prune(l, now, None)).is_ok() {
                log_removed(&gone);
            }
        }
        drop(g);
        d
    }

    /// 파일이 바뀌었으면(다른 앱이 짝짓기·끊기) 다시 읽는다
    fn reload_if_changed(&self, g: &mut Inner) {
        let Some(p) = &self.path else { return };
        let m = std::fs::metadata(p).and_then(|m| m.modified()).ok();
        if m != g.mtime {
            let (list, mtime) = read_list(p);
            g.list = list;
            g.mtime = mtime;
        }
    }

    /// 바꾸기 — 잠금(flock)을 잡고 파일을 다시 읽어 그 위에 바꾼 뒤 쓴다(메모리 목록으로 통째 덮지 않는다)
    fn mutate(&self, g: &mut Inner, f: impl FnOnce(&mut Vec<Device>)) -> std::io::Result<()> {
        let Some(p) = &self.path else {
            f(&mut g.list);
            return Ok(());
        };
        let _lock = FileLock::take(&p.with_extension("lock"))?;
        let (mut list, _) = read_list(p);
        f(&mut list);
        write_private(p, &serde_json::to_string_pretty(&list).unwrap_or_else(|_| "[]".into()))?;
        g.mtime = std::fs::metadata(p).and_then(|m| m.modified()).ok();
        g.list = list;
        Ok(())
    }

    /// 새 짝짓기 코드(16진 32자, 맥 설정 QR) — 만들면 옛 코드는 죽는다
    pub fn new_code(&self, now: SystemTime) -> std::io::Result<String> {
        self.issue(None, now)
    }

    /// 이미 연결된 기기가 낸 코드(홈 화면 앱 연결) — 그 코드로 붙은 홈 화면 앱은 낸 기기 아래로 묶인다
    pub fn new_code_from(&self, issuer: &str, now: SystemTime) -> std::io::Result<String> {
        self.issue(Some(issuer.to_string()), now)
    }

    fn issue(&self, issuer: Option<String>, now: SystemTime) -> std::io::Result<String> {
        let code = random_hex(16)?;
        self.inner.lock().unwrap().code = Some((sha(&code), now + PAIR_TTL, issuer));
        Ok(code)
    }

    /// 시험용 — 옛 모양(새 브라우저 줄)
    #[cfg(test)]
    pub fn pair(&self, code: &str, name: &str, now: SystemTime) -> Option<String> {
        self.pair_with(code, &Pairing { name, home: false, prev: None }, now)
    }

    /// 코드가 살아 있으면 쓰고(한 번만) 기기 토큰(16진 64자)을 준다.
    /// 같은 폰으로 알아보면(옛 열쇠 증명·코드 낸 기기) 새 줄 대신 그 줄의 열쇠를 바꿔 끼운다 — 옛 열쇠는 그 순간 죽는다
    pub fn pair_with(&self, code: &str, p: &Pairing, now: SystemTime) -> Option<String> {
        if code.is_empty() {
            return None;
        }
        let mut g = self.inner.lock().unwrap();
        let (h, until, issuer) = g.code.clone()?;
        if !ct_eq(sha(code).as_bytes(), h.as_bytes()) || now > until {
            return None;
        }
        g.code = None;
        let token = random_hex(32).ok()?;
        let new_id = random_hex(8).ok()?;
        let at = ms(now);
        let name: String = p.name.chars().take(40).collect();
        let hash = sha(&token);
        let prev_hash = p.prev.filter(|t| t.len() == 64).map(sha);
        let mut swapped = None;
        let mut gone = Vec::new();
        self.mutate(&mut g, |l| {
            // ① 같은 저장 공간의 옛 열쇠 — 같은 칸이면 그 줄, 다른 칸(베껴 온 저장 공간)이면 같은 폰으로 묶기만
            let mut target = None;
            let mut group = None;
            if let Some(i) = prev_hash.as_deref().and_then(|ph| find_hash(l, ph)) {
                if l[i].home == p.home {
                    target = Some(i);
                } else {
                    group = Some(l[i].group_id().to_string());
                }
            }
            // ①' 홈 화면 앱 — 코드를 낸 브라우저와 이름(기종)이 같으면 그 폰. 홈 화면 앱이 낸 코드면 묶지 않는다(낸 앱 자신을 바꿔 끼우게 된다)
            if target.is_none() && group.is_none() && p.home {
                group = issuer.as_deref().and_then(|iid| l.iter().find(|d| d.id == iid && !d.home && d.name == name)).map(|d| d.group_id().to_string());
            }
            // 한 폰의 홈 화면 앱 칸은 하나 — 있으면 바꿔 끼운다(브라우저는 사파리·크롬 여럿일 수 있어 안 한다)
            if target.is_none() && p.home {
                target = group.as_deref().and_then(|gid| l.iter().position(|d| d.group_id() == gid && d.home));
            }
            let keep = match target {
                Some(i) => {
                    let d = &mut l[i];
                    d.hash = hash.clone();
                    d.name = name.clone();
                    d.paired = Some(at);
                    d.last_seen = Some(at);
                    swapped = Some(format!("열쇠 바꿔 끼움 {} {}{}", short(&d.id), d.name, if d.home { HOME_SUFFIX } else { "" }));
                    d.id.clone()
                }
                None => {
                    l.push(Device { id: new_id.clone(), name: name.clone(), hash: hash.clone(), created: at, last_seen: Some(at), home: p.home, group, paired: None });
                    new_id.clone()
                }
            };
            gone = prune(l, at, Some(&keep));
        })
        .ok()?;
        if let Some(s) = swapped {
            log_device(&s);
        }
        log_removed(&gone);
        Some(token)
    }

    /// 기기 토큰 확인 → 기기 id. 마지막 접속은 1분에 한 번만 파일에 적는다
    pub fn check(&self, token: &str, now: SystemTime) -> Option<String> {
        if token.len() != 64 {
            return None;
        }
        let h = sha(token);
        let mut g = self.inner.lock().unwrap();
        self.reload_if_changed(&mut g);
        let found = find_hash(&g.list, &h).map(|i| {
            let d = &mut g.list[i];
            d.last_seen = Some(ms(now));
            d.id.clone()
        });
        if let Some(id) = found.clone().filter(|_| g.flushed.elapsed() >= SEEN_FLUSH) {
            g.flushed = Instant::now();
            let at = ms(now);
            // 파일에 아직 있는 그 기기만 고친다 — 다른 앱이 끊었거나 열쇠를 바꿔 끼웠으면 되살리지 않는다(해시까지 같아야)
            let mut gone = Vec::new();
            let ok = self.mutate(&mut g, |l| {
                if let Some(d) = l.iter_mut().find(|d| d.id == id && ct_eq(d.hash.as_bytes(), h.as_bytes())) {
                    d.last_seen = Some(d.last_seen.unwrap_or(0).max(at));
                }
                gone = prune(l, at, Some(&id));
            });
            if ok.is_ok() {
                log_removed(&gone);
            }
        }
        found
    }

    pub fn list(&self) -> Vec<DeviceView> {
        let mut g = self.inner.lock().unwrap();
        self.reload_if_changed(&mut g);
        g.list.iter().map(|d| DeviceView { id: d.id.clone(), name: d.name.clone(), created: d.created, last_seen: d.last_seen, home: d.home, group: d.group.clone().unwrap_or_else(|| d.id.clone()), paired: d.paired.unwrap_or(d.created) }).collect()
    }

    /// 기기 끊기 — 묶음째(사파리·홈 화면 앱 둘 다). 묶음 id 는 그 묶음 첫 줄의 id 라 줄 id 로 불러도 된다
    pub fn remove(&self, id: &str) -> std::io::Result<()> {
        let mut g = self.inner.lock().unwrap();
        self.mutate(&mut g, |l| l.retain(|d| d.id != id && d.group_id() != id))
    }

    /// 모든 기기 끊기 + 살아 있는 코드도 죽인다
    pub fn clear(&self) -> std::io::Result<()> {
        let mut g = self.inner.lock().unwrap();
        g.code = None;
        self.mutate(&mut g, |l| l.clear())
    }
}

fn read_list(p: &Path) -> (Vec<Device>, Option<SystemTime>) {
    let mut list: Vec<Device> = std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    for d in list.iter_mut() {
        if let Some(base) = d.name.strip_suffix(HOME_SUFFIX) {
            d.name = base.to_string();
            d.home = true;
        }
    }
    (list, std::fs::metadata(p).and_then(|m| m.modified()).ok())
}

/// 데이터 폴더의 잠금 파일(flock) — 두 앱이 동시에 바꿔도 한 번에 하나씩. 놓는 건 파일이 닫힐 때(Drop)
struct FileLock(#[allow(dead_code)] std::fs::File);

impl FileLock {
    fn take(p: &Path) -> std::io::Result<FileLock> {
        let mut o = std::fs::OpenOptions::new();
        o.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            o.mode(0o600);
        }
        let f = o.open(p)?;
        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            if unsafe { libc::flock(f.as_raw_fd(), libc::LOCK_EX) } != 0 {
                return Err(std::io::Error::last_os_error());
            }
        }
        Ok(FileLock(f))
    }
}

#[cfg(test)]
#[path = "mobile_pair_tests.rs"]
mod tests;
