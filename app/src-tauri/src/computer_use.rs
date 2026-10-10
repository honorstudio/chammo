//! Claude Code 내장 MCP 'computer-use'(맥 화면 조종) — `claude mcp list` 엔 안 나오고, ~/.claude.json 의
//! projects.<경로>.enabledMcpServers 에 이름이 있을 때만 켜진다(옵트인, Claude Code 2.1.289 실측).
//! 기능 '화면 조종 모든 프로젝트'(features.computerUse)를 켜면 앱이 아는 프로젝트(devRoot 아래·따로 둔 것·HQ·예약)에 넣어 준다.
//! 프로젝트에서 따로 끈 건 다시 켜지 않게 한 번 넣어 본 칸은 <데이터>/computer-use-seen.json 에 남긴다(2026-10-05 사용자 "모든 세션 전체 다 항상 활성화")

pub const NAME: &str = "computer-use";

use serde_json::{json, Value};

fn parse(text: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if v.is_object() { Ok(v) } else { Err("not an object".into()) }
}

fn dump(v: &Value) -> Result<String, String> {
    Ok(serde_json::to_string_pretty(v).map_err(|e| e.to_string())? + "\n")
}

/// Claude Code 가 새 프로젝트에 쓰는 기본 칸 — 칸이 있으면 Claude 는 기본값을 안 섞고 그대로 쓰니 반쪽 칸을 만들지 않는다
pub(crate) fn new_project() -> Value {
    json!({"allowedTools": [], "mcpContextUris": [], "mcpServers": {}, "enabledMcpjsonServers": [], "disabledMcpjsonServers": [],
        "hasTrustDialogAccepted": false, "hasClaudeMdExternalIncludesApproved": false, "hasClaudeMdExternalIncludesWarningShown": false})
}

/// 그 프로젝트 목록에 넣거나 뺀다 — 바뀌었으면 true
fn put(v: &mut Value, key: &str, on: bool) -> Result<bool, String> {
    let projects = v.as_object_mut().ok_or("not an object")?.entry("projects").or_insert_with(|| json!({}));
    let projects = projects.as_object_mut().ok_or("projects")?;
    if !on && !projects.contains_key(key) {
        return Ok(false);
    }
    let p = projects.entry(key).or_insert_with(new_project).as_object_mut().ok_or("project")?;
    let list = p.entry("enabledMcpServers").or_insert_with(|| json!([]));
    if !list.is_array() {
        *list = json!([]);
    }
    let arr = list.as_array_mut().ok_or("enabledMcpServers")?;
    let has = arr.iter().any(|x| x.as_str() == Some(NAME));
    if on == has {
        return Ok(false);
    }
    if on { arr.push(NAME.into()) } else { arr.retain(|x| x.as_str() != Some(NAME)) }
    Ok(true)
}

/// 한 프로젝트에서 켜기·끄기 — ~/.claude.json 글을 받아 고친 글을 돌려준다. 안 바뀌면 받은 글 그대로
pub fn set_enabled(text: &str, key: &str, on: bool) -> Result<String, String> {
    let mut v = parse(text)?;
    if put(&mut v, key, on)? { dump(&v) } else { Ok(text.to_string()) }
}

/// 아직 안 본 칸(seen 밖)에만 넣는다 — 고친 글(안 바뀌면 None)과 새 seen
pub fn enable_new(text: &str, keys: &[String], seen: &[String]) -> Result<(Option<String>, Vec<String>), String> {
    let mut v = parse(text)?;
    let mut out = seen.to_vec();
    let mut changed = false;
    for k in keys {
        if out.contains(k) {
            continue;
        }
        changed |= put(&mut v, k, true)?;
        out.push(k.clone());
    }
    Ok((if changed { Some(dump(&v)?) } else { None }, out))
}

/// 모든 프로젝트 칸에서 뺀다(안 바뀌면 None)
pub fn disable_all(text: &str) -> Result<Option<String>, String> {
    let mut v = parse(text)?;
    let keys: Vec<String> = v["projects"].as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default();
    let mut changed = false;
    for k in &keys {
        changed |= put(&mut v, k, false)?;
    }
    Ok(if changed { Some(dump(&v)?) } else { None })
}

/// 이 프로젝트에서 켜져 있나
pub fn enabled_in(cj: &Value, key: &str) -> bool {
    cj["projects"][key]["enabledMcpServers"].as_array().is_some_and(|a| a.iter().any(|x| x.as_str() == Some(NAME)))
}


// ───────── 파일 ─────────

/// 앱이 아는 세션 자리 — devRoot 아래·따로 둔 프로젝트·HQ·예약(routines/<이름>)
pub fn keys() -> Vec<String> {
    let c = crate::config::current();
    let home = crate::config::home();
    let mut dirs: Vec<std::path::PathBuf> = crate::project::dirs(&home, &c.dev_root, &c.extra_projects).into_iter().map(|(_, p)| p).collect();
    if !c.hq_dir.is_empty() {
        dirs.push(crate::config::expand(&home, &c.hq_dir).into());
    }
    if let Ok(rd) = std::fs::read_dir(crate::config::data_dir().join("routines")) {
        dirs.extend(rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()));
    }
    let mut out: Vec<String> = Vec::new();
    for d in dirs.into_iter().filter(|d| d.is_dir()) {
        let k = crate::tools::project_key(&d.to_string_lossy());
        if !out.contains(&k) {
            out.push(k);
        }
    }
    out
}

fn seen_file() -> std::path::PathBuf {
    crate::config::data_file("computer-use-seen.json")
}

fn read_seen() -> Vec<String> {
    std::fs::read_to_string(seen_file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_seen(v: &[String]) -> Result<(), String> {
    let f = seen_file();
    let tmp = f.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())
}

/// ~/.claude.json 고치기 — 처음 쓰기 전 백업, 나머지(다시 읽기·확인·세 번까지·앱 안 줄)는 tools::edit_json
pub(crate) fn edit(f: impl FnMut(&str) -> Result<Option<String>, String>, ok: impl Fn(&Value) -> bool) -> Result<bool, String> {
    let c = crate::tools::cfg();
    crate::tools::edit_json(&c.json, f, || crate::tools::backup(&c, None), ok)
}

/// 한 프로젝트에서 켜기·끄기(도구 화면 '이 프로젝트') — 본 칸으로 남겨 모든 프로젝트 켜기가 다시 켜지 않게
pub fn set_here(key: &str, on: bool) -> Result<(), String> {
    edit(|t| set_enabled(t, key, on).map(|n| (n != t).then_some(n)), |v| enabled_in(v, key) == on)?;
    let mut seen = read_seen();
    if !seen.iter().any(|k| k == key) {
        seen.push(key.to_string());
        write_seen(&seen)?;
    }
    Ok(())
}

/// 기능이 켜져 있으면 아직 안 본 프로젝트에 넣는다 — 앱 켤 때·설정 저장 때·1분마다(폴더 점검 옆)·앱이 세션 띄우기 직전
pub fn sweep() -> Result<usize, String> {
    if !crate::config::current().features.computer_use {
        return Ok(0);
    }
    let keys = keys();
    let seen = read_seen();
    let fresh: Vec<String> = keys.iter().filter(|k| !seen.contains(k)).cloned().collect();
    if fresh.is_empty() {
        return Ok(0);
    }
    edit(|t| enable_new(t, &keys, &seen).map(|(n, _)| n), |v| fresh.iter().all(|k| enabled_in(v, k)))?;
    write_seen(&[seen, fresh.clone()].concat())?;
    Ok(fresh.len())
}

/// sweep 하고 실패는 기록만 — 앱이 세션을 띄우기 직전(막 만든 폴더의 첫 세션도 화면 조종을 갖고 시작하게, Claude 는 켤 때 한 번 읽는다)·1분마다
pub fn sweep_logged() {
    if let Err(e) = sweep() {
        crate::claude::log_out("computer-use", &e);
    }
}

/// 기능을 바꿨다(설정 화면·도구 화면 '모든 프로젝트'·scripts/app feature) — 켜면 처음부터 다 넣고, 끄면 모든 프로젝트에서 뺀다
pub fn turned(on: bool) -> Result<usize, String> {
    write_seen(&[])?;
    if on {
        return sweep();
    }
    edit(disable_all, |v| v["projects"].as_object().is_none_or(|m| m.keys().all(|k| !enabled_in(v, k)))).map(|_| 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const BASE: &str = r#"{"numStartups":3,"projects":{"/p":{"allowedTools":["Bash"],"enabledMcpServers":["other"]},"/q":{"allowedTools":[]}},"zzz":1}"#;
    fn v(t: &str) -> Value { serde_json::from_str(t).unwrap() }

    #[test]
    fn 한_프로젝트_켜고_끄기는_enabled_목록에_넣고_뺀다() {
        let on = set_enabled(BASE, "/p", true).unwrap();
        assert_eq!(v(&on)["projects"]["/p"]["enabledMcpServers"], json!(["other", "computer-use"]));
        assert_eq!(v(&on)["projects"]["/p"]["allowedTools"], json!(["Bash"])); // 다른 칸은 그대로
        assert!(on.trim_end().trim_end_matches('}').trim_end().ends_with("\"zzz\": 1")); // 칸 순서 그대로
        assert_eq!(set_enabled(&on, "/p", true).unwrap(), on); // 두 번 켜도 한 번
        let off = set_enabled(&on, "/p", false).unwrap();
        assert_eq!(v(&off)["projects"]["/p"]["enabledMcpServers"], json!(["other"]));
        assert_eq!(set_enabled(BASE, "/q", false).unwrap(), BASE); // 없는 걸 끄면 그대로
        assert!(set_enabled("{깨짐", "/p", true).is_err());
    }

    #[test]
    fn 처음_보는_프로젝트는_claude_기본_칸과_함께_만든다() {
        // Claude 는 칸이 있으면 기본값을 안 섞고 그대로 쓴다 — 반쪽 칸이면 allowedTools 같은 게 비어 버린다
        let t = set_enabled(BASE, "/new", true).unwrap();
        let p = &v(&t)["projects"]["/new"];
        assert_eq!(p["enabledMcpServers"], json!(["computer-use"]));
        assert_eq!(p["allowedTools"], json!([]));
        assert_eq!(p["mcpServers"], json!({}));
        assert_eq!(p["hasTrustDialogAccepted"], json!(false));
    }

    #[test]
    fn 모든_프로젝트_켜기는_안_본_칸에만_넣고_본_칸은_남긴다() {
        let keys = vec!["/p".to_string(), "/q".to_string(), "/new".to_string()];
        // /q 는 전에 본 칸(사용자가 이 프로젝트에서 끔) — 다시 켜지 않는다
        let (t, seen) = enable_new(BASE, &keys, &["/q".to_string()]).unwrap();
        let t = t.unwrap();
        assert_eq!(v(&t)["projects"]["/p"]["enabledMcpServers"], json!(["other", "computer-use"]));
        assert!(v(&t)["projects"]["/q"].get("enabledMcpServers").is_none());
        assert_eq!(v(&t)["projects"]["/new"]["enabledMcpServers"], json!(["computer-use"]));
        assert_eq!(seen, vec!["/q", "/p", "/new"]);
        // 다 본 칸이면 안 고친다
        let (again, seen2) = enable_new(&t, &keys, &seen).unwrap();
        assert!(again.is_none());
        assert_eq!(seen2, seen);
        // 이미 켜진 칸은 글을 안 바꾸고 본 것으로만
        let (none, s) = enable_new(&t, &["/p".to_string()], &[]).unwrap();
        assert!(none.is_none());
        assert_eq!(s, vec!["/p"]);
    }

    #[test]
    fn 모든_프로젝트_끄기는_어디서든_뺀다() {
        let (t, _) = enable_new(BASE, &["/p".to_string(), "/q".to_string()], &[]).unwrap();
        let off = disable_all(&t.unwrap()).unwrap().unwrap();
        assert_eq!(v(&off)["projects"]["/p"]["enabledMcpServers"], json!(["other"]));
        assert_eq!(v(&off)["projects"]["/q"]["enabledMcpServers"], json!([]));
        assert!(disable_all(&off).unwrap().is_none());
    }

    #[test]
    fn 켜져_있나() {
        let t = set_enabled(BASE, "/p", true).unwrap();
        assert!(enabled_in(&v(&t), "/p"));
        assert!(!enabled_in(&v(&t), "/q"));
        assert!(!enabled_in(&v(&t), "/none"));
    }
}
