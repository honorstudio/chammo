//! HQ 폴더 만들기 — 비서 세션이 도는 폴더에 템플릿(app/hq-template)을 복사한다.
//! 템플릿 파일은 빌드 때 실행 파일 안에 넣는다(include_str!) — 설치한 앱에 원본 폴더가 없어서.
//! 이미 있는 파일은 건드리지 않는다(사용자가 고친 CLAUDE.md 를 덮지 않게). 덮어쓰기는 부탁할 때만
use serde::Serialize;
use std::path::Path;

pub struct TemplateFile {
    pub path: &'static str,
    pub body: &'static str,
    /// scripts/* 는 실행 권한(0o755)
    pub exec: bool,
}

/// 템플릿에 파일을 더하면 여기에도 한 줄 — 빠뜨리면 테스트(템플릿_폴더와_목록이_같다)가 잡는다
pub const TEMPLATE: &[TemplateFile] = &[
    TemplateFile { path: "CLAUDE.md", body: include_str!("../../hq-template/CLAUDE.md"), exec: false },
    TemplateFile { path: "CHAMMO.md", body: include_str!("../../hq-template/CHAMMO.md"), exec: false },
    // 한글 절반 — CHAMMO.md 끝의 @CHAMMO.ko.md 로 이어 읽는다. 개인 HQ(이 저장소 CLAUDE.md)는 이 파일만 import 해서 영문을 안 싣는다
    TemplateFile { path: "CHAMMO.ko.md", body: include_str!("../../hq-template/CHAMMO.ko.md"), exec: false },
    TemplateFile { path: ".claude/settings.json", body: include_str!("../../hq-template/.claude/settings.json"), exec: false },
    TemplateFile { path: "scripts/task", body: include_str!("../../hq-template/scripts/task"), exec: true },
    TemplateFile { path: "scripts/say", body: include_str!("../../hq-template/scripts/say"), exec: true },
    TemplateFile { path: "scripts/show", body: include_str!("../../hq-template/scripts/show"), exec: true },
    TemplateFile { path: "scripts/direct", body: include_str!("../../hq-template/scripts/direct"), exec: true },
    TemplateFile { path: "scripts/app", body: include_str!("../../hq-template/scripts/app"), exec: true },
    TemplateFile { path: "scripts/voice-hint", body: include_str!("../../hq-template/scripts/voice-hint"), exec: true },
    TemplateFile { path: "scripts/orch-roster", body: include_str!("../../hq-template/scripts/orch-roster"), exec: true },
    TemplateFile { path: "scripts/new-project", body: include_str!("../../hq-template/scripts/new-project"), exec: true },
    TemplateFile { path: "scripts/statusline", body: include_str!("../../hq-template/scripts/statusline"), exec: true },
    TemplateFile { path: "scripts/routine", body: include_str!("../../hq-template/scripts/routine"), exec: true },
    TemplateFile { path: "scripts/choice", body: include_str!("../../hq-template/scripts/choice"), exec: true },
    TemplateFile { path: "scripts/skill-hint", body: include_str!("../../hq-template/scripts/skill-hint"), exec: true },
    // scripts/task 가 import 하는 모듈(교훈 → 프로젝트 스킬) — 직접 실행하지 않는다
    TemplateFile { path: "scripts/lesson_skill.py", body: include_str!("../../hq-template/scripts/lesson_skill.py"), exec: false },
    TemplateFile { path: ".claude/skills/hq-browser/SKILL.md", body: include_str!("../../hq-template/.claude/skills/hq-browser/SKILL.md"), exec: false },
    TemplateFile { path: ".claude/skills/hq-folders/SKILL.md", body: include_str!("../../hq-template/.claude/skills/hq-folders/SKILL.md"), exec: false },
    TemplateFile { path: ".claude/skills/hq-routine/SKILL.md", body: include_str!("../../hq-template/.claude/skills/hq-routine/SKILL.md"), exec: false },
    TemplateFile { path: ".claude/skills/hq-app/SKILL.md", body: include_str!("../../hq-template/.claude/skills/hq-app/SKILL.md"), exec: false },
    TemplateFile { path: ".claude/skills/hq-login/SKILL.md", body: include_str!("../../hq-template/.claude/skills/hq-login/SKILL.md"), exec: false },
];

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HqReport {
    /// 새로 쓴 파일(덮어쓴 것 포함)
    pub written: Vec<String>,
    /// 이미 있어서 그대로 둔 파일
    pub kept: Vec<String>,
}

/// dir 에 템플릿을 푼다. overwrite 가 false 면 있는 파일은 그대로
pub fn install(dir: &Path, overwrite: bool) -> std::io::Result<HqReport> {
    let mut report = HqReport::default();
    std::fs::create_dir_all(dir)?;
    for f in TEMPLATE {
        let dest = dir.join(f.path);
        if dest.exists() && !overwrite {
            report.kept.push(f.path.into());
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&dest, body_for(f))?;
        #[cfg(unix)]
        if f.exec {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))?;
        }
        report.written.push(f.path.into());
    }
    Ok(report)
}

/// 깔 글 — 윈도우면 안내문(CHAMMO.md)의 맥 단축키 표기(⌘J)를 윈도우 키로. 참모가 그대로 읽고 말한다
fn body_for(f: &TemplateFile) -> String {
    if cfg!(windows) && (f.path.starts_with("CHAMMO") || f.path.starts_with(".claude/skills/hq-")) { crate::platform::win_keys(f.body) } else { f.body.to_string() }
}

/// HQ 세션의 도구가 앱과 같은 데이터 폴더를 쓰게 .claude/settings.json 의 env.CHAMMO_HOME 에 적는다.
/// 세션은 daemon 이 띄워서 앱의 환경변수를 못 받는다 — 안 적으면 scripts/task 가 기본 자리(~/.chammo)에 써서
/// 데이터 폴더를 옮긴 사람의 작업 패널이 비고, 옛 폴더가 있는 맥에선 엉뚱한 기록에 섞인다(데모 촬영 준비 중 발견)
pub fn pin_data_dir(dir: &Path, data_dir: &str) -> std::io::Result<()> {
    let path = dir.join(".claude/settings.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|_| "{}".into());
    let mut v: serde_json::Value = serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({}));
    if !v.is_object() {
        v = serde_json::json!({});
    }
    let before = v.clone();
    if !v["env"].is_object() {
        v["env"] = serde_json::json!({});
    }
    // / 로만 — 윈도우는 홈(C:\Users\me) + "/.chammo" 가 섞여 도구 출력에도 그대로 보였다(파이썬·bash 둘 다 / 를 받는다)
    v["env"]["CHAMMO_HOME"] = serde_json::Value::String(data_dir.replace('\\', "/"));
    // 파이썬 도구(scripts/*)가 UTF-8 로 읽고 쓰고 출력하게 — 윈도우 파이썬 기본은 cp949 라 한글이 깨진다(맥은 원래 UTF-8)
    v["env"]["PYTHONUTF8"] = serde_json::Value::String("1".into());
    // 상태줄 — 상단 바 5시간·주간 사용량과 세션별 대화 %를 남기는 앱 스크립트(사용자 원래 상태줄은 그 안에서 그대로 돈다).
    // 예전엔 주인 개인 상태줄 스크립트만 이 파일을 써서 새 사용자에겐 사용량이 영영 안 떴다(아이맥 실측)
    // 명령은 bash 가 읽는다 — 윈도우 경로의 \ 는 이스케이프로 먹히니 / 로만(C:/Users/…, Git Bash 가 알아듣는다)
    v["statusLine"] = serde_json::json!({ "type": "command", "command": statusline_path(Path::new(data_dir)).to_string_lossy().replace('\\', "/") });
    // 참모는 사용자에게 선택지 창(AskUserQuestion)을 띄우지 않는다 — 채팅 뷰엔 안 보여 터미널로 가야 했고,
    // 쉬운 건 스스로 정하고 중요한 것만 답 끝에 글로 묻는 게 참모 일이다(2026-10-01 사용자). 막으면 도구가 아예 빠진다(우회 모드에서도)
    if !v["permissions"].is_object() {
        v["permissions"] = serde_json::json!({});
    }
    if !v["permissions"]["deny"].is_array() {
        v["permissions"]["deny"] = serde_json::json!([]);
    }
    let deny = v["permissions"]["deny"].as_array_mut().expect("방금 배열로 맞췄다");
    if !deny.iter().any(|x| x == "AskUserQuestion") {
        deny.push(serde_json::Value::String("AskUserQuestion".into()));
    }
    if v == before {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(&v).unwrap_or_default() + "\n")
}

/// 예전 템플릿이 통째로 CLAUDE.md 였던 HQ — 첫 줄로 알아본다(사용자가 안 고쳤으면 새 짧은 파일로 바꿔도 된다)
const OLD_TEMPLATE_HEAD: &str = "# Chammo HQ — chief-of-staff session";

/// 이미 깐 HQ 도 새 기능을 받게 — 앱이 켤 때마다. 앱 몫(CHAMMO.md·CHAMMO.ko.md·scripts/*·.claude/skills/hq-*)은 새로 쓰고,
/// 사용자 몫(CLAUDE.md)은 `@CHAMMO.md` 한 줄만 보장한다(옛 템플릿 그대로면 새 짧은 파일로). 아이맥 HQ 가 새 스크립트를 못 받았다
pub fn refresh(dir: &Path) -> std::io::Result<()> {
    for f in TEMPLATE {
        let app_owned = f.path.starts_with("CHAMMO") || f.path.starts_with("scripts/") || f.path.starts_with(".claude/skills/hq-");
        let dest = dir.join(f.path);
        if f.path == "CLAUDE.md" {
            let cur = std::fs::read_to_string(&dest).unwrap_or_default();
            if cur.is_empty() || cur.starts_with(OLD_TEMPLATE_HEAD) {
                std::fs::write(&dest, body_for(f))?;
            } else if !cur.contains("@CHAMMO.md") {
                std::fs::write(&dest, format!("{}\n\n@CHAMMO.md\n", cur.trim_end()))?;
            }
            continue;
        }
        if !app_owned && dest.exists() {
            continue; // settings.json 등은 pin_data_dir 가 필요한 키만 맞춘다
        }
        if let Some(p) = dest.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(&dest, body_for(f))?;
        #[cfg(unix)]
        if f.exec {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))?;
        }
    }
    Ok(())
}

/// 앱이 켤 때 데이터 폴더에 푸는 상태줄 스크립트 자리
pub fn statusline_path(data: &Path) -> std::path::PathBuf {
    data.join("tools/statusline")
}

/// 상태줄 스크립트를 <데이터>/tools/statusline 에 푼다(앱 것이라 덮어씀, 실행 권한)
pub fn export_statusline(data: &Path) -> std::io::Result<()> {
    let dest = statusline_path(data);
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(&dest, include_str!("../../hq-template/scripts/statusline"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderStatus {
    pub exists: bool,
    /// HQ 로 쓸 준비가 됐나 — CLAUDE.md 와 scripts/task 가 있으면
    pub hq_ready: bool,
}

pub fn folder_status_of(dir: &Path) -> FolderStatus {
    FolderStatus { exists: dir.is_dir(), hq_ready: dir.join("CLAUDE.md").is_file() && dir.join("scripts/task").is_file() }
}

/// 설정 화면: HQ 만들기. dir 은 `~/…` 모양이어도 된다
#[tauri::command]
pub fn create_hq(dir: String, overwrite: Option<bool>) -> Result<HqReport, String> {
    let dir = crate::config::expand(&crate::config::home(), &dir);
    if dir.trim().is_empty() {
        return Err(crate::i18n::tr("HQ 폴더를 먼저 적어 주세요", "Please enter an HQ folder first").into());
    }
    let report = install(Path::new(&dir), overwrite.unwrap_or(false)).map_err(|e| e.to_string())?;
    pin_data_dir(Path::new(&dir), &crate::config::data_dir().to_string_lossy()).map_err(|e| e.to_string())?;
    Ok(report)
}

/// 설정 화면: 폴더가 있나, HQ 준비가 됐나
#[tauri::command]
pub fn folder_status(dir: String) -> FolderStatus {
    let dir = crate::config::expand(&crate::config::home(), &dir);
    if dir.trim().is_empty() {
        return FolderStatus { exists: false, hq_ready: false };
    }
    folder_status_of(Path::new(&dir))
}

/// 설정 화면: 프로젝트 폴더 만들기(`mkdir -p`)
#[tauri::command]
pub fn make_dir(dir: String) -> Result<(), String> {
    let dir = crate::config::expand(&crate::config::home(), &dir);
    if dir.trim().is_empty() {
        return Err(crate::i18n::tr("폴더 경로가 비어 있어요", "The folder path is empty").into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-hq-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn 이미_깐_hq_도_새_안내문과_스크립트를_받는다() {
        let d = temp("refresh");
        std::fs::create_dir_all(d.join("scripts")).unwrap();
        std::fs::write(d.join("CLAUDE.md"), "# Chammo HQ — chief-of-staff session\n옛 내용").unwrap();
        std::fs::write(d.join("scripts/task"), "옛 스크립트").unwrap();
        std::fs::write(d.join("CHAMMO.ko.md"), "옛 한글 안내").unwrap();
        std::fs::create_dir_all(d.join(".claude/skills/hq-login")).unwrap();
        std::fs::write(d.join(".claude/skills/hq-login/SKILL.md"), "옛 스킬").unwrap();
        refresh(&d).unwrap();
        let claude = std::fs::read_to_string(d.join("CLAUDE.md")).unwrap();
        assert!(claude.contains("@CHAMMO.md") && !claude.contains("옛 내용"));
        assert!(std::fs::read_to_string(d.join("CHAMMO.md")).unwrap().contains("@CHAMMO.ko.md"));
        // 한글 절반은 따로 — 앱 몫이라 켤 때마다 새로 쓴다(개인 HQ 가 이 파일만 import 한다)
        assert!(std::fs::read_to_string(d.join("CHAMMO.ko.md")).unwrap().starts_with("# Chammo HQ — 참모 세션"));
        assert!(d.join("scripts/routine").is_file());
        // 상황별 안내는 HQ 스킬 — 앱 몫이라 켤 때마다 새로 쓴다(늘 실리는 안내문을 줄이려고 뺐다)
        assert!(std::fs::read_to_string(d.join(".claude/skills/hq-login/SKILL.md")).unwrap().starts_with("---\nname: hq-login"));
        for n in ["hq-browser", "hq-folders", "hq-routine", "hq-app"] {
            assert!(d.join(format!(".claude/skills/{n}/SKILL.md")).is_file(), "{n}");
        }
        assert_ne!(std::fs::read_to_string(d.join("scripts/task")).unwrap(), "옛 스크립트");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 사용자가_고친_claude_md_는_한_줄만_더한다() {
        let d = temp("mine");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("CLAUDE.md"), "# 내 HQ\n내 규칙").unwrap();
        refresh(&d).unwrap();
        refresh(&d).unwrap(); // 두 번 해도 한 줄
        let claude = std::fs::read_to_string(d.join("CLAUDE.md")).unwrap();
        assert!(claude.starts_with("# 내 HQ\n내 규칙"));
        assert_eq!(claude.matches("@CHAMMO.md").count(), 1);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn hq_설정에_데이터_폴더를_적는다() {
        let d = temp("env");
        install(&d, false).unwrap();
        pin_data_dir(&d, "/Users/me/demo-data").unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join(".claude/settings.json")).unwrap()).unwrap();
        assert_eq!(v["env"]["CHAMMO_HOME"], "/Users/me/demo-data");
        assert_eq!(v["statusLine"]["command"], "/Users/me/demo-data/tools/statusline");
        // 원래 있던 훅은 그대로
        assert!(v["hooks"]["UserPromptSubmit"].is_array());
        // 파이썬 도구가 UTF-8 로 읽고 쓰게 — 윈도우 기본(cp949)이면 한글 출력·JSON 이 깨진다. 맥은 원래 UTF-8
        assert_eq!(v["env"]["PYTHONUTF8"], "1");
        // 두 번 불러도 같다
        pin_data_dir(&d, "/Users/me/demo-data").unwrap();
        let again: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join(".claude/settings.json")).unwrap()).unwrap();
        assert_eq!(again, v);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn hq_세션은_선택지_창_도구를_못_쓴다() {
        // 참모가 사용자에게 선택지 창(AskUserQuestion)을 띄우면 채팅 뷰에선 안 보여 터미널로 가야 했다(2026-10-01 윈도우 참모들).
        // 막으면 도구가 아예 빠지고 참모는 답 끝에 글로 묻는다 — 우회 모드에서도 막힌다(실측)
        let d = temp("deny-ask");
        install(&d, false).unwrap();
        // 이미 깐 HQ(옛 설정, 사용자가 넣은 deny 가 있을 수도)
        std::fs::write(d.join(".claude/settings.json"), r#"{"permissions":{"deny":["Bash(rm -rf /)"]}}"#).unwrap();
        pin_data_dir(&d, "/Users/me/demo-data").unwrap();
        pin_data_dir(&d, "/Users/me/demo-data").unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join(".claude/settings.json")).unwrap()).unwrap();
        let deny: Vec<&str> = v["permissions"]["deny"].as_array().unwrap().iter().filter_map(|x| x.as_str()).collect();
        assert_eq!(deny, vec!["Bash(rm -rf /)", "AskUserQuestion"]); // 사용자 것은 그대로, 두 번 불러도 한 번만
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 윈도우_상태줄_경로는_슬래시로() {
        // bash 가 C:\Users\me/.chammo\tools 의 \U·\t 를 먹어 경로가 깨졌다 — / 로만 적는다
        let d = temp("env-win");
        install(&d, false).unwrap();
        pin_data_dir(&d, r"C:\Users\me/.chammo").unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join(".claude/settings.json")).unwrap()).unwrap();
        assert_eq!(v["statusLine"]["command"], "C:/Users/me/.chammo/tools/statusline");
        assert_eq!(v["env"]["CHAMMO_HOME"], "C:/Users/me/.chammo");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 템플릿을_풀고_스크립트는_실행_권한() {
        use std::os::unix::fs::PermissionsExt;
        let d = temp("fresh");
        let r = install(&d.join("hq"), false).unwrap();
        assert_eq!(r.written.len(), TEMPLATE.len());
        assert!(r.kept.is_empty());
        for f in TEMPLATE {
            let p = d.join("hq").join(f.path);
            assert_eq!(std::fs::read_to_string(&p).unwrap(), f.body, "{}", f.path);
            let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
            if f.exec {
                assert_eq!(mode, 0o755, "{}", f.path);
            }
        }
        assert!(folder_status_of(&d.join("hq")).hq_ready);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 있는_파일은_덮지_않는다_부탁하면_덮는다() {
        let d = temp("keep");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("CLAUDE.md"), "내가 고친 것").unwrap();
        let r = install(&d, false).unwrap();
        assert_eq!(r.kept, vec!["CLAUDE.md".to_string()]);
        assert_eq!(std::fs::read_to_string(d.join("CLAUDE.md")).unwrap(), "내가 고친 것");
        let r = install(&d, true).unwrap();
        assert!(r.kept.is_empty());
        assert_ne!(std::fs::read_to_string(d.join("CLAUDE.md")).unwrap(), "내가 고친 것");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 없는_폴더는_준비_안_됨() {
        let s = folder_status_of(Path::new("/없는/폴더"));
        assert_eq!(s, FolderStatus { exists: false, hq_ready: false });
    }

    #[test]
    fn 템플릿_폴더와_목록이_같다() {
        fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    // 파이썬 캐시는 스크립트를 불러 보면 생긴다 — 템플릿이 아니다
                    if p.file_name().is_some_and(|n| n == "__pycache__") { continue }
                    walk(root, &p, out);
                } else if p.file_name().is_some_and(|n| n != ".DS_Store") {
                    out.push(p.strip_prefix(root).unwrap().to_string_lossy().into_owned());
                }
            }
        }
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../hq-template");
        let mut on_disk = Vec::new();
        walk(&root, &root, &mut on_disk);
        on_disk.sort();
        let mut listed: Vec<String> = TEMPLATE.iter().map(|f| f.path.to_string()).collect();
        listed.sort();
        assert_eq!(on_disk, listed);
    }
}
