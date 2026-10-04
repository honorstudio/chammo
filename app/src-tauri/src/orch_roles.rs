//! 참모 맡은 일 — <데이터>/orch-roles.json(0600)에 { "참모-3": { "role": "…", "at": ms } }.
//! 열쇠 = 참모 기본 이름(별명 앞). 대화 id 는 /clear 때, 짧은 id 는 되살리기 복사본에서 바뀐다(2026-10-04 사용자 "업무 담당 vs 그냥 이름").
//! 폰(길게 누르기 메뉴)·데스크톱(이름 창)·이름표 훅(scripts/orch-roster)이 같은 파일을 쓴다. 판단·보이는 글은 화면 domain/orchRoles
use std::collections::BTreeMap;
use std::path::Path;

static ROLE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
const FILE: &str = "orch-roles.json";
pub const ROLE_MAX: usize = 80;
const MAX_ROLES: usize = 200;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct Role {
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub at: u64,
    /// 이 이름으로 새 참모를 띄운 때 — 꺼진 참모를 지워 번호가 다시 쓰이면 옛 참모의 작업 기록을 안 세려고(2026-10-04 리뷰)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub born: Option<u64>,
}

/// 맡은 일 다듬기 — 제어 글자·줄바꿈은 빈칸, 연속 공백은 한 칸, 80자. 비면 "" (= 지움). 화면 cleanRole 과 같은 규칙
pub fn clean_role(raw: &str) -> String {
    let t: String = raw.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    t.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(ROLE_MAX).collect::<String>().trim().to_string()
}

/// 참모 이름 → 기본 이름(" · " 앞)
pub fn base_of(name: &str) -> &str {
    name.split(" · ").next().unwrap_or(name).trim()
}

/// 열쇠로 쓸 수 있는 기본 이름 — 비지 않고, 짧고, 구분자·경로 글자·제어 글자 없음
fn key_ok(base: &str) -> bool {
    !base.is_empty() && base.chars().count() <= 40 && !base.chars().any(|c| c.is_control() || matches!(c, '·' | '/' | '\\'))
}

/// 읽기 — 글 전체가 깨졌으면 Err(덮어쓰지 않게), 칸 하나가 이상하면 그 칸만 건너뛴다(손으로 고친 파일 한 칸에 폰 새 참모가 막혔다)
pub fn read_roles(dir: &Path) -> Result<BTreeMap<String, Role>, String> {
    let t = match std::fs::read_to_string(dir.join(FILE)) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(e) => return Err(e.to_string()),
    };
    let v: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&t).map_err(|e| format!("{FILE} 을 못 읽어요: {e}"))?;
    Ok(v.into_iter().filter_map(|(k, x)| serde_json::from_value::<Role>(x).ok().map(|r| (k, r))).collect())
}

fn write_roles(dir: &Path, m: &BTreeMap<String, Role>) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".orch-roles.{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    crate::mobile_files::write_private_tmp(&tmp, serde_json::to_string(m).unwrap_or_default().as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(FILE)).map_err(|e| e.to_string())
}

/// 너무 많으면 가장 오래 안 고친 것부터(지금 고친 base 는 빼고)
fn cap(m: &mut BTreeMap<String, Role>, keep: &str) {
    while m.len() > MAX_ROLES {
        let Some(old) = m.iter().filter(|(k, _)| k.as_str() != keep).min_by_key(|(_, r)| r.at).map(|(k, _)| k.clone()) else { break };
        m.remove(&old);
    }
}

/// 새 참모를 띄울 때 — 맡은 일(비워도)과 태어난 때를 늘 새로 적는다. 옛 번호의 맡은 일·작업 기록이 새 참모에 붙지 않게
pub fn start_role(dir: &Path, base: &str, raw: &str, now_ms: u64) -> Result<BTreeMap<String, Role>, String> {
    let base = base_of(base);
    if !key_ok(base) {
        return Err("bad name".into());
    }
    let _g = ROLE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut m = read_roles(dir)?;
    m.insert(base.to_string(), Role { role: clean_role(raw), at: now_ms, born: Some(now_ms) });
    cap(&mut m, base);
    write_roles(dir, &m)?;
    Ok(m)
}

/// 맡은 일 적기 — 비우면 지운다. 돌려주는 건 바뀐 전체. 못 읽는 파일은 덮어쓰지 않는다
pub fn set_role(dir: &Path, base: &str, raw: &str, now_ms: u64) -> Result<BTreeMap<String, Role>, String> {
    let base = base_of(base);
    if !key_ok(base) {
        return Err("bad name".into());
    }
    let _g = ROLE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut m = read_roles(dir)?;
    let role = clean_role(raw);
    let born = m.get(base).and_then(|r| r.born);
    if m.get(base).is_some_and(|r| r.role == role) || (role.is_empty() && !m.contains_key(base)) {
        return Ok(m);
    }
    if role.is_empty() && born.is_none() {
        m.remove(base);
    } else {
        // 비워도 태어난 때는 남긴다 — 지우면 옛 번호의 기록을 다시 센다
        m.insert(base.to_string(), Role { role, at: now_ms, born });
    }
    cap(&mut m, base);
    write_roles(dir, &m)?;
    Ok(m)
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 데스크톱 — 맡은 일 전체(기본 이름별). 없거나 못 읽으면 빈 것
#[tauri::command]
pub fn read_orch_roles() -> BTreeMap<String, Role> {
    read_roles(crate::config::data_dir()).unwrap_or_default()
}

/// 데스크톱 — 맡은 일 적기·지우기(name = 참모 이름, 별명이 붙어 있어도 기본 이름으로). fresh = 새 참모를 띄울 때(start_role — 옛 번호의 것을 덮고 태어난 때를 적는다)
#[tauri::command]
pub fn set_orch_role(name: String, role: String, fresh: Option<bool>) -> Result<BTreeMap<String, Role>, String> {
    if fresh == Some(true) {
        return start_role(crate::config::data_dir(), &name, &role, now_ms());
    }
    set_role(crate::config::data_dir(), &name, &role, now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-roles-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn 다듬기_한_줄_80자() {
        assert_eq!(clean_role("  쇼핑몰\n개발\t 담당 "), "쇼핑몰 개발 담당");
        assert_eq!(clean_role(" \n "), "");
        assert_eq!(clean_role(&"가".repeat(100)).chars().count(), ROLE_MAX);
        assert_eq!(clean_role("a\u{0}b"), "a b");
    }

    #[test]
    fn 기본_이름으로_적고_비우면_지운다() {
        let d = tmp("set");
        let m = set_role(&d, "참모-3 · 뽀삐", "쇼핑몰 개발", 1).unwrap();
        assert_eq!(m.get("참모-3").map(|r| r.role.as_str()), Some("쇼핑몰 개발"));
        assert_eq!(read_roles(&d).unwrap(), m);
        // 같은 글이면 시각도 그대로
        assert_eq!(set_role(&d, "참모-3", "쇼핑몰  개발", 9).unwrap()["참모-3"].at, 1);
        assert!(set_role(&d, "참모-3", "  ", 2).unwrap().is_empty());
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(d.join(FILE)).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn 이상한_이름은_거절_깨진_파일은_덮지_않는다() {
        let d = tmp("bad");
        assert!(set_role(&d, "", "x", 1).is_err());
        assert!(set_role(&d, "../x", "x", 1).is_err());
        assert!(set_role(&d, "a\nb", "x", 1).is_err());
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(FILE), "{깨짐").unwrap();
        assert!(set_role(&d, "참모-2", "x", 1).is_err());
        assert_eq!(std::fs::read_to_string(d.join(FILE)).unwrap(), "{깨짐");
    }

    #[test]
    fn 칸_하나가_이상해도_나머지는_읽는다() {
        let d = tmp("lenient");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(FILE), r#"{"참모-2":{"role":"손으로 고침"},"참모-3":"글자만","참모-4":{"role":"예약","at":5}}"#).unwrap();
        let m = read_roles(&d).unwrap();
        assert_eq!(m.get("참모-2").map(|r| (r.role.as_str(), r.at)), Some(("손으로 고침", 0)));
        assert!(!m.contains_key("참모-3"));
        assert_eq!(m.len(), 2);
        // 고쳐 쓰면 이상한 칸은 빠진다
        set_role(&d, "참모-4", "예약·반복", 6).unwrap();
        assert!(!std::fs::read_to_string(d.join(FILE)).unwrap().contains("글자만"));
    }

    #[test]
    fn 새_참모는_태어난_때를_남기고_비워도_지우지_않는다() {
        let d = tmp("born");
        set_role(&d, "참모-4", "옛 일", 1).unwrap();
        let m = start_role(&d, "참모-4 · 디자인", "", 100).unwrap();
        assert_eq!(m["참모-4"], Role { role: String::new(), at: 100, born: Some(100) });
        // 그 뒤 맡은 일을 적었다 지워도 태어난 때는 남는다
        assert_eq!(set_role(&d, "참모-4", "시안", 200).unwrap()["참모-4"].born, Some(100));
        assert_eq!(set_role(&d, "참모-4", "", 300).unwrap()["참모-4"], Role { role: String::new(), at: 300, born: Some(100) });
        // 태어난 때가 없는 칸은 비우면 지운다
        set_role(&d, "참모-5", "x", 1).unwrap();
        assert!(!set_role(&d, "참모-5", "", 2).unwrap().contains_key("참모-5"));
        assert!(start_role(&d, "../x", "", 1).is_err());
    }

    #[test]
    fn 너무_많으면_오래된_것부터() {
        let d = tmp("cap");
        for i in 0..MAX_ROLES {
            set_role(&d, &format!("참모-{i}"), "일", i as u64 + 10).unwrap();
        }
        let m = set_role(&d, "참모-new", "새 일", 1_000).unwrap();
        assert_eq!(m.len(), MAX_ROLES);
        assert!(!m.contains_key("참모-0") && m.contains_key("참모-new"));
    }
}
