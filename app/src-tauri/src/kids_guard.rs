//! 부모 잠금·하루 시간(1단계 여섯째 조각, 계획서 결정 3 — 사용자 11-17 숫자 네 자리 기본).
//! - 잠금: <데이터>/kids/lock.json { salt, hash = sha256(salt + 숫자), fails, until } — 숫자 원문은 어디에도 안 남는다.
//!   틀리면 3번째부터 30초·1분·2분·10분 쉬기(쉬는 동안엔 맞는 숫자도 안 받음), 맞으면 처음부터. 맥에서 다시 정하면 쉬기도 풀린다.
//!   잠금을 안 정했으면 아이 화면을 못 고르고(enter 409), 잠긴 패드는 어떤 숫자로도 못 나간다
//! - 하루 시간: <데이터>/kids/<참모>/usage.json { day(이 기기 날짜), used_ms, last, extra_min } — 아이 화면이 보이는 동안 30초마다 tick,
//!   빈틈(35초 넘음)은 안 센다. 하루 기본 20분(kids.json daily_min, 5~180), 부모가 그날만 더하기
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Lock {
    salt: String,
    hash: String,
    fails: u32,
    until: u64,
}

fn lock_file(data: &Path) -> PathBuf {
    data.join("kids").join("lock.json")
}

fn read_lock(data: &Path) -> Lock {
    std::fs::read_to_string(lock_file(data)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_lock(data: &Path, l: &Lock) -> Result<(), String> {
    let f = lock_file(data);
    std::fs::create_dir_all(f.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = f.with_file_name(format!("lock.json.{}", crate::tools::tmp_tag()));
    std::fs::write(&tmp, serde_json::to_string(l).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())
}

fn hash(salt: &str, pin: &str) -> String {
    let mut h = Sha256::new();
    h.update(salt.as_bytes());
    h.update(pin.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn pin_ok(pin: &str) -> bool {
    pin.len() == 4 && pin.bytes().all(|b| b.is_ascii_digit())
}

/// 잠금을 정했나
pub fn lock_set_in(data: &Path) -> bool {
    !read_lock(data).hash.is_empty()
}

/// 잠금 숫자 정하기·다시 정하기(맥) — 쉬기도 풀린다
pub fn set_pin_in(data: &Path, pin: &str) -> Result<(), String> {
    if !pin_ok(pin) {
        return Err(crate::i18n::tr("숫자 네 자리로 정해 줘", "Use four digits").into());
    }
    let salt = crate::mobile_pair::random_hex(16).map_err(|e| e.to_string())?;
    write_lock(data, &Lock { hash: hash(&salt, pin), salt, fails: 0, until: 0 })
}

#[derive(Debug, PartialEq)]
pub enum PinErr {
    /// 잠금을 안 정했다
    NoLock,
    /// 쉬는 중 — 남은 ms
    Wait { wait_ms: u64 },
    /// 틀림 — 이제부터 쉴 ms(0 = 바로 다시)
    Wrong { wait_ms: u64 },
}

fn backoff(fails: u32) -> u64 {
    match fails {
        0..=2 => 0,
        3 => 30_000,
        4 => 60_000,
        5 => 120_000,
        _ => 600_000,
    }
}

/// 숫자 확인 — 틀린 횟수·쉬기를 적는다
pub fn check_pin_in(data: &Path, pin: &str, now: u64) -> Result<(), PinErr> {
    let mut l = read_lock(data);
    if l.hash.is_empty() {
        return Err(PinErr::NoLock);
    }
    if now < l.until {
        return Err(PinErr::Wait { wait_ms: l.until - now });
    }
    // 같은 길이 비교(시간 차로 맞춰 보기 막기) — 4자리라 맞혀 보기 막는 건 쉬기가 한다
    let got = hash(&l.salt, pin);
    if pin_ok(pin) && got.len() == l.hash.len() && got.bytes().zip(l.hash.bytes()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0 {
        l.fails = 0;
        l.until = 0;
        let _ = write_lock(data, &l);
        return Ok(());
    }
    l.fails += 1;
    let w = backoff(l.fails);
    l.until = now + w;
    let _ = write_lock(data, &l);
    Err(PinErr::Wrong { wait_ms: w })
}

// ───────── 하루 시간 ─────────

pub const DAILY_DEFAULT: u32 = 20;
const GAP_MS: u64 = 35_000;

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct UseRec {
    day: String,
    used_ms: u64,
    last: u64,
    extra_min: u32,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub used_ms: u64,
    pub limit_ms: u64,
    pub left_ms: u64,
}

fn use_file(data: &Path, key: &str) -> Option<PathBuf> {
    crate::kids::kid_dir(data, key).ok().map(|k| k.join("usage.json"))
}

fn day_of(now: u64, off_ms: i64) -> String {
    crate::kids::ymd_of((now as i64 + off_ms).max(0) as u64)
}

fn read_use(data: &Path, key: &str, now: u64, off: i64) -> UseRec {
    let r: UseRec = use_file(data, key).and_then(|f| std::fs::read_to_string(f).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let day = day_of(now, off);
    if r.day == day { r } else { UseRec { day, ..Default::default() } }
}

fn write_use(data: &Path, key: &str, r: &UseRec) -> Result<(), String> {
    let f = use_file(data, key).ok_or("bad key")?;
    std::fs::create_dir_all(f.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = f.with_file_name(format!("usage.json.{}", crate::tools::tmp_tag()));
    std::fs::write(&tmp, serde_json::to_string(r).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())
}

fn daily_min(data: &Path) -> u32 {
    crate::kids::read_in(data).daily_min.unwrap_or(DAILY_DEFAULT)
}

fn usage_of(data: &Path, r: &UseRec) -> Usage {
    let limit = u64::from(daily_min(data) + r.extra_min) * 60_000;
    Usage { used_ms: r.used_ms, limit_ms: limit, left_ms: limit.saturating_sub(r.used_ms) }
}

/// 오늘 쓴 시간(읽기만)
pub fn usage_in(data: &Path, key: &str, now: u64, off: i64) -> Usage {
    usage_of(data, &read_use(data, key, now, off))
}

/// 아이 화면이 보이는 동안 30초마다 — 앞 tick 에서 35초 안이면 그만큼 더한다
pub fn tick_in(data: &Path, key: &str, now: u64, off: i64) -> Usage {
    let mut r = read_use(data, key, now, off);
    if r.last > 0 && now > r.last && now - r.last <= GAP_MS {
        r.used_ms += now - r.last;
    }
    r.last = now;
    let _ = write_use(data, key, &r);
    usage_of(data, &r)
}

/// 부모 — 오늘만 n분 더(맥 프로필·폰 메뉴)
pub fn add_today_in(data: &Path, key: &str, min: u32, now: u64, off: i64) -> Result<Usage, String> {
    let mut r = read_use(data, key, now, off);
    r.extra_min = (r.extra_min + min).min(240);
    write_use(data, key, &r)?;
    Ok(usage_of(data, &r))
}

/// 부모 — 하루 기본 시간(5~180분, 맥 설정)
pub fn set_daily_in(data: &Path, min: u32) -> Result<(), String> {
    if !(5..=180).contains(&min) {
        return Err("5~180".into());
    }
    crate::kids::set_daily(data, min)
}

/// 이 기기 시간대(ms) — 날짜는 이 기기 기준으로 바뀐다(UTC 면 한국 아침 9시에 바뀐다)
pub fn local_off() -> i64 {
    #[cfg(unix)]
    unsafe {
        let now = libc::time(std::ptr::null_mut());
        let mut tm: libc::tm = std::mem::zeroed();
        if !libc::localtime_r(&now, &mut tm).is_null() {
            return tm.tm_gmtoff * 1000;
        }
    }
    0
}

#[cfg(test)]
#[path = "kids_guard_tests.rs"]
mod tests;
