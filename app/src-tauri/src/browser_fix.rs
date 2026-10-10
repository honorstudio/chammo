//! 낡은 .mcp.json 고치기 — 우리 래퍼(args[0] = <데이터>/tools/chammo-browser/bin/chammo-browser-mcp.js)를 띄우는 항목의 node(command)가
//! 없는 파일·Homebrew 버전 폴더(Cellar/…/26.8.1)·fnm 임시 경로면 앱이 고른 node 로 바꾼다(맥은 <데이터>/tools/bin/node 링크).
//! 0.2.3 까지 만든 프로젝트는 Cellar 경로가 박혀 brew upgrade 한 번에 브라우저가 안 떴다(roadmap ⑧). 잘 도는 경로는 안 건드린다.
//! 바꾸기 전 원본은 <데이터>/backups/mcp-json/ 에 — 프로젝트 폴더(git)엔 아무것도 더 남기지 않는다
use std::path::{Path, PathBuf};

/// .mcp.json 이 가리키는 node 링크(맥·리눅스)
pub fn node_link(data: &Path) -> PathBuf {
    data.join("tools/bin/node")
}

/// 임시 파일 꼬리 — pid 만으론 앱 켤 때·설치 끝의 정리가 동시에 돌면 같은 이름을 서로 지웠다(2026-10-05 부채 ⑧). 부를 때마다 다르게
fn tmp_tag() -> String {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    format!("{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

/// 링크를 target 으로(맥·리눅스). 임시 링크를 만든 뒤 바꿔치기 — 도중에 죽어도 반쪽 링크가 안 남는다
#[cfg(unix)]
pub fn point_link(link: &Path, target: &Path) -> std::io::Result<()> {
    if std::fs::read_link(link).ok().as_deref() == Some(target) {
        return Ok(());
    }
    let dir = link.parent().ok_or_else(|| std::io::Error::other("no parent"))?;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".node-link-{}", tmp_tag()));
    let _ = std::fs::remove_file(&tmp);
    std::os::unix::fs::symlink(target, &tmp)?;
    std::fs::rename(&tmp, link)
}

/// ${HOME}/…·${USERPROFILE}\… 를 풀어 비교한다(setup.js 가 그렇게 적는다)
pub fn expand_home(s: &str, home: &str) -> String {
    for v in ["${HOME}", "${USERPROFILE}"] {
        if let Some(rest) = s.strip_prefix(v) {
            return format!("{home}{rest}");
        }
    }
    s.to_string()
}

/// 홈 아래 경로는 ${HOME}/… (윈도우 ${USERPROFILE}\…) — setup.js homeVar 와 같은 규칙
pub fn home_var(p: &str, home: &str, win: bool) -> String {
    let h = home.trim_end_matches(['/', '\\']);
    if h.is_empty() || p.len() <= h.len() {
        return p.to_string();
    }
    let (head, rest) = p.split_at(h.len());
    let same = if win { head.eq_ignore_ascii_case(h) } else { head == h };
    let sep = if win { '\\' } else { '/' };
    if same && rest.starts_with(sep) {
        format!("{}{rest}", if win { "${USERPROFILE}" } else { "${HOME}" })
    } else {
        p.to_string()
    }
}

/// 같은 파일 경로인가 — 윈도우는 / 와 \ 를 섞어 쓰고 대소문자를 안 가린다
pub fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.replace('\\', "/").eq_ignore_ascii_case(&b.replace('\\', "/"))
    } else {
        a == b
    }
}

/// 곧 깨질(또는 이미 깨진) node 경로인가
pub fn fragile(cmd: &str, exists: impl Fn(&str) -> bool) -> bool {
    if !exists(cmd) || crate::browser_node::ephemeral(cmd) {
        return true;
    }
    // …/Cellar/<formula>/<판>/bin/node — 버전 없는 opt 경로로 바꿀 수 있으면 깨지기 쉬운 것
    crate::browser_node::stable_node(cmd, |_| true) != cmd
}

/// 고칠 게 있으면 새 글(2칸 들여쓰기 + 줄바꿈), 없거나 JSON 이 깨졌으면 None(남의 파일은 안 건드린다)
pub fn fix_text(raw: &str, wrapper: &str, desired: &str, home: &str, exists: impl Fn(&str) -> bool) -> Option<String> {
    let mut v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let servers = v.get_mut("mcpServers")?.as_object_mut()?;
    let mut changed = false;
    for (_, s) in servers.iter_mut() {
        let ours = s.pointer("/args/0").and_then(|a| a.as_str()).is_some_and(|a| same_path(&expand_home(a, home), wrapper));
        let Some(cmd) = s.get("command").and_then(|c| c.as_str()).map(|c| expand_home(c, home)) else { continue };
        if ours && fragile(&cmd, &exists) && cmd != expand_home(desired, home) {
            s["command"] = serde_json::Value::String(desired.to_string());
            changed = true;
        }
    }
    changed.then(|| serde_json::to_string_pretty(&v).unwrap_or_default() + "\n")
}

/// 앱이 고른 node 를 .mcp.json 에 적을 모양으로 — 맥은 링크, 윈도우는 고른 node. 그게 실제로 돌 때만
fn desired_command(data: &Path, home: &str) -> Option<String> {
    let win = cfg!(windows);
    let p = if win { crate::browser_setup::chosen_node(data)?.0 } else { node_link(data) };
    std::fs::metadata(&p).ok()?; // 링크가 가리키는 게 있어야
    // 윈도우는 ${USERPROFILE} 풀기를 실측 못 해 절대 경로 그대로(setup.js homeVar 와 같게)
    Some(if win { p.to_string_lossy().into_owned() } else { home_var(&p.to_string_lossy(), home, false) })
}

/// 프로젝트 폴더들(dev 아래 + 따로 둔 것 + HQ)
fn folders() -> Vec<PathBuf> {
    folders_of(&crate::config::home(), &crate::config::current(), |k| std::env::var(k).ok())
}

/// 마법사를 마치기 전(setup_done 아님)엔 HQ 만 — 저장 안 된 기본 devRoot 가 보호 폴더면 읽기가 권한 창 답을 기다리며 멈췄다
fn folders_of(home: &str, c: &crate::config::Config, env: impl Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = if c.setup_done {
        crate::project::dirs(home, &c.dev_root, &c.extra_projects).into_iter().map(|(_, p)| p).collect()
    } else {
        Vec::new()
    };
    v.push(PathBuf::from(crate::config::hq_dir(home, c, env)));
    v
}

/// 고친 파일 수. 앱을 켤 때(도구를 깐 사용자만)·설치 끝에. 고쳤으면 앱 기록(notify.log)에 폴더 이름과 원본 자리 한 줄 —
/// 예전엔 조용히 고쳐 git 저장소에 수정 표시만 남고 이유를 몰랐다(roadmap 브라우저 '딸깍' 설치 ⑨)
pub fn fix_all(data: &Path) -> usize {
    let home = crate::config::home();
    let Some(desired) = desired_command(data, &home) else { return 0 };
    let wrapper = crate::browser::tool_dir(data).join("bin").join("chammo-browser-mcp.js").to_string_lossy().into_owned();
    let backups = data.join("backups/mcp-json");
    let fixed = fix_in(&folders(), &wrapper, &desired, &home, &backups);
    if let Some(line) = fixed_line(&fixed, &backups) {
        crate::claude::log_out("mcp-fix", &line);
    }
    fixed.len()
}

/// 기록 한 줄 — 고친 게 없으면 None
pub fn fixed_line(fixed: &[String], backups: &Path) -> Option<String> {
    (!fixed.is_empty()).then(|| format!("fixed chammo-browser node path in {} .mcp.json ({}) — originals in {}", fixed.len(), fixed.join(", "), backups.display()))
}

/// 고친 폴더 이름들
pub fn fix_in(folders: &[PathBuf], wrapper: &str, desired: &str, home: &str, backups: &Path) -> Vec<String> {
    let mut n = Vec::new();
    for f in folders {
        let p = f.join(".mcp.json");
        // 링크 파일이면 건드리지 않는다(바꿔치기가 링크를 보통 파일로 덮는다)
        if std::fs::symlink_metadata(&p).is_ok_and(|m| m.file_type().is_symlink()) {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&p) else { continue };
        let Some(new) = fix_text(&raw, wrapper, desired, home, |c| Path::new(c).exists()) else { continue };
        let name = f.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        // 원본을 먼저 남기고(못 남기면 안 고친다), 임시 파일에 쓴 뒤 바꿔치기
        // 다른 서버의 토큰이 같이 들어 있을 수 있어 나만 읽게(0600)
        let bk = backups.join(format!("{name}-{ts}.mcp.json"));
        if std::fs::create_dir_all(backups).is_err() || std::fs::write(&bk, &raw).is_err() {
            continue;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&bk, std::fs::Permissions::from_mode(0o600));
        }
        let tmp = f.join(format!(".mcp.json.{}.tmp", tmp_tag()));
        if std::fs::write(&tmp, new).is_ok() && std::fs::rename(&tmp, &p).is_ok() {
            n.push(name);
        } else {
            let _ = std::fs::remove_file(&tmp);
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-10-05 부채 ⑧: 앱 켤 때와 설치 끝의 ensure_link 가 동시에 돌면 같은 pid 임시 이름을 서로 지워 한쪽 rename 이 실패했다
    #[cfg(unix)]
    #[test]
    fn 링크_바꾸기를_여럿이_동시에_해도_다_된다() {
        let d = std::env::temp_dir().join(format!("chammo-link-race-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let link = d.join("bin/node");
        let fails: usize = std::thread::scope(|s| {
            let hs: Vec<_> = (0..8)
                .map(|t| {
                    let link = &link;
                    s.spawn(move || (0..200).filter(|i| point_link(link, Path::new(&format!("../node{}/bin/node", (t + i) % 3))).is_err()).count())
                })
                .collect();
            hs.into_iter().map(|h| h.join().unwrap()).sum()
        });
        assert_eq!(fails, 0, "동시에 바꾸다 실패한 수");
        assert!(std::fs::read_link(&link).is_ok());
        let left: Vec<_> = std::fs::read_dir(d.join("bin")).unwrap().flatten().map(|e| e.file_name()).filter(|n| n != "node").collect();
        assert!(left.is_empty(), "임시 링크가 남음: {left:?}");
        let _ = std::fs::remove_dir_all(&d);
    }

    fn cfg(dev: &str, done: bool) -> crate::config::Config {
        let mut c = crate::config::default_config("/h", Path::new("/h/.chammo"), "ko", |_| false);
        c.dev_root = dev.into();
        c.setup_done = done;
        c
    }

    // 2026-10-05 아이맥 QA: 마법사 4단계 브라우저 설치 끝의 fix_all 이 아직 저장 안 된 기본 devRoot(~/Desktop/dev)를
    // 읽다 데스크탑 권한 창 답을 기다리며 멈춰 '시험으로 한 번 열어 보는 중'에서 안 끝났다 — 마법사 중엔 devRoot 를 안 읽는다
    #[test]
    fn 마법사_중엔_프로젝트_폴더를_안_읽는다() {
        let d = std::env::temp_dir().join(format!("chammo-fixfold-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("acme")).unwrap();
        let dev = d.to_string_lossy().into_owned();
        let env = |_: &str| None;
        let wizard = folders_of("/h", &cfg(&dev, false), env);
        assert!(!wizard.iter().any(|p| p.starts_with(&d)), "마법사 중에 devRoot 를 읽었다: {wizard:?}");
        assert_eq!(wizard, vec![PathBuf::from("/h/.chammo/hq")]); // HQ 는 앱이 만든 곳이라 본다
        let after = folders_of("/h", &cfg(&dev, true), env);
        assert!(after.contains(&d.join("acme")), "설정을 마친 뒤엔 프로젝트를 본다: {after:?}");
        let _ = std::fs::remove_dir_all(&d);
    }

    const W: &str = "/Users/u/.chammo/tools/chammo-browser/bin/chammo-browser-mcp.js";
    const LINK: &str = "${HOME}/.chammo/tools/bin/node";

    fn entry(cmd: &str, wrapper: &str) -> String {
        format!(r#"{{"mcpServers":{{"playwright":{{"type":"stdio","command":"{cmd}","args":["{wrapper}","p"]}},"other":{{"type":"http","url":"https://x"}}}},"extra":1}}"#)
    }

    #[cfg(unix)]
    #[test]
    fn 링크는_바꿔치기로_다시_가리킨다() {
        let d = std::env::temp_dir().join(format!("chammo-link-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let link = node_link(&d);
        point_link(&link, Path::new("../node/bin/node")).unwrap();
        assert_eq!(std::fs::read_link(&link).unwrap(), PathBuf::from("../node/bin/node"));
        point_link(&link, Path::new("/opt/homebrew/opt/node/bin/node")).unwrap();
        assert_eq!(std::fs::read_link(&link).unwrap(), PathBuf::from("/opt/homebrew/opt/node/bin/node"));
        assert_eq!(std::fs::read_dir(link.parent().unwrap()).unwrap().count(), 1); // 임시 링크 안 남음
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 셀러_경로는_링크로_다른_서버와_키는_그대로() {
        let raw = entry("/opt/homebrew/Cellar/node/26.8.1/bin/node", W);
        let out = fix_text(&raw, W, LINK, "/Users/u", |_| true).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["mcpServers"]["playwright"]["command"], LINK);
        assert_eq!(v["mcpServers"]["playwright"]["args"][0], W);
        assert_eq!(v["mcpServers"]["other"]["url"], "https://x");
        assert_eq!(v["extra"], 1);
        assert!(out.ends_with("}\n") && out.contains("\n  \"mcpServers\""));
    }

    #[test]
    fn 없는_node_나_fnm_임시_경로도_고치고_잘_도는_경로는_안_건드린다() {
        assert!(fix_text(&entry("/gone/node", W), W, LINK, "/Users/u", |c| c != "/gone/node").is_some());
        assert!(fix_text(&entry("/Users/u/.local/state/fnm_multishells/1_2/bin/node", W), W, LINK, "/Users/u", |_| true).is_some());
        assert!(fix_text(&entry("/opt/homebrew/opt/node/bin/node", W), W, LINK, "/Users/u", |_| true).is_none());
        assert!(fix_text(&entry("/opt/homebrew/bin/node", W), W, LINK, "/Users/u", |_| true).is_none());
        // 이미 링크(${HOME} 모양)
        assert!(fix_text(&entry(LINK, "${HOME}/.chammo/tools/chammo-browser/bin/chammo-browser-mcp.js"), W, LINK, "/Users/u", |_| true).is_none());
    }

    #[test]
    fn 우리_래퍼가_아닌_항목_깨진_json_은_안_건드린다() {
        // 개인 local-browser-mcp·남의 래퍼
        assert!(fix_text(r#"{"mcpServers":{"playwright":{"command":"local-browser-mcp","args":["p"]}}}"#, W, LINK, "/Users/u", |_| false).is_none());
        assert!(fix_text(&entry("/gone/node", "/other/wrapper.js"), W, LINK, "/Users/u", |_| false).is_none());
        assert!(fix_text("{ broken", W, LINK, "/Users/u", |_| false).is_none());
        // ${HOME} 로 적힌 래퍼도 우리 것
        assert!(fix_text(&entry("/gone/node", "${HOME}/.chammo/tools/chammo-browser/bin/chammo-browser-mcp.js"), W, LINK, "/Users/u", |c| c != "/gone/node").is_some());
    }

    #[test]
    fn 홈_경로_모양() {
        assert_eq!(home_var("/Users/u/.chammo/tools/bin/node", "/Users/u", false), "${HOME}/.chammo/tools/bin/node");
        assert_eq!(home_var("/Users/uu/x", "/Users/u", false), "/Users/uu/x");
        assert_eq!(home_var(r"c:\users\U\.chammo\tools\node\node.exe", r"C:\Users\u", true), r"${USERPROFILE}\.chammo\tools\node\node.exe");
        assert_eq!(home_var(r"C:\Program Files\nodejs\node.exe", r"C:\Users\u", true), r"C:\Program Files\nodejs\node.exe");
        assert_eq!(expand_home("${HOME}/a", "/Users/u"), "/Users/u/a");
        assert_eq!(expand_home(r"${USERPROFILE}\a", r"C:\Users\u"), r"C:\Users\u\a");
    }

    #[test]
    fn 파일로_고치기_원본은_백업_폴더에_프로젝트엔_찌꺼기_없음() {
        let d = std::env::temp_dir().join(format!("chammo-fix-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let (a, b) = (d.join("proj-a"), d.join("proj-b"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        let raw = entry("/gone/Cellar/node/26.8.1/bin/node", W);
        std::fs::write(a.join(".mcp.json"), &raw).unwrap();
        std::fs::write(b.join(".mcp.json"), entry("/opt/homebrew/opt/node/bin/node", "/other.js")).unwrap();
        let bk = d.join("backups");
        let fixed = fix_in(&[a.clone(), b.clone(), d.join("missing")], W, LINK, "/Users/u", &bk);
        assert_eq!(fixed, vec!["proj-a".to_string()]);
        // 고친 것은 앱 기록 한 줄로(폴더 이름·원본 자리), 안 고쳤으면 안 남긴다
        let line = fixed_line(&fixed, &bk).unwrap();
        assert!(line.contains("1 .mcp.json (proj-a)") && line.contains("backups"), "{line}");
        assert_eq!(fixed_line(&[], &bk), None);
        assert!(std::fs::read_to_string(a.join(".mcp.json")).unwrap().contains(LINK));
        let saved: Vec<_> = std::fs::read_dir(&bk).unwrap().flatten().collect();
        assert_eq!(saved.len(), 1);
        #[cfg(unix)]
        assert_eq!(std::os::unix::fs::PermissionsExt::mode(&saved[0].metadata().unwrap().permissions()) & 0o777, 0o600);
        assert_eq!(std::fs::read_to_string(saved[0].path()).unwrap(), raw);
        assert_eq!(std::fs::read_dir(&a).unwrap().count(), 1); // .mcp.json 하나만(임시·백업 없음)
        // 두 번째는 고칠 게 없다
        assert!(fix_in(&[a.clone(), b], W, LINK, "/Users/u", &bk).is_empty());
        // .mcp.json 이 링크 파일이면 건너뛴다(덮으면 링크가 끊긴다)
        #[cfg(unix)]
        {
            let c = d.join("proj-c");
            std::fs::create_dir_all(&c).unwrap();
            std::fs::write(d.join("shared.json"), &raw).unwrap();
            std::os::unix::fs::symlink(d.join("shared.json"), c.join(".mcp.json")).unwrap();
            assert!(fix_in(&[c.clone()], W, LINK, "/Users/u", &bk).is_empty());
            assert!(std::fs::symlink_metadata(c.join(".mcp.json")).unwrap().file_type().is_symlink());
        }
        let _ = std::fs::remove_dir_all(&d);
    }
}
