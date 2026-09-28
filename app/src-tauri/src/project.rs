//! 프로젝트 하네스 — 프로젝트 폴더에 CLAUDE.md + docs/starter.md + docs/roadmap.md + docs/decisions/ 를 깐다.
//! 세션이 시작할 때 starter 를 읽고 끝날 때 갱신하는 구조라, 폴더마다 이게 있어야 세션이 길을 잃지 않는다(사용자 2026-09-28).
//! **있는 파일은 절대 덮어쓰지 않는다** — 이미 자기 방식으로 세팅한 사람의 프로젝트는 그대로 두고 빈 자리만 채운다.
//! 참모의 scripts/new-project 도 같은 템플릿을 쓰도록 앱이 켤 때 <데이터>/templates/project 에 풀어 둔다.
use serde::Serialize;
use std::path::Path;

/// (프로젝트 안 경로, 영어, 한국어). gitignore 는 템플릿 폴더에선 점 없이 둔다(숨김 파일로 빠지지 않게)
pub const FILES: &[(&str, &str, &str)] = &[
    ("CLAUDE.md", include_str!("../../project-template/en/CLAUDE.md"), include_str!("../../project-template/ko/CLAUDE.md")),
    ("docs/starter.md", include_str!("../../project-template/en/docs/starter.md"), include_str!("../../project-template/ko/docs/starter.md")),
    ("docs/roadmap.md", include_str!("../../project-template/en/docs/roadmap.md"), include_str!("../../project-template/ko/docs/roadmap.md")),
    ("docs/decisions/README.md", include_str!("../../project-template/en/docs/decisions/README.md"), include_str!("../../project-template/ko/docs/decisions/README.md")),
    (".gitignore", include_str!("../../project-template/en/gitignore"), include_str!("../../project-template/ko/gitignore")),
];

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub written: Vec<String>,
    pub kept: Vec<String>,
}

/// 폴더 이름으로 쓸 수 있나 — 영문 소문자·숫자로 시작, 소문자·숫자·-_. 만, 64자 이하(한글 폴더는 NAS·git 에서 깨진다)
#[cfg_attr(not(test), allow(dead_code))] // 이름 규칙은 scripts/new-project 가 쓴다 — 여기선 같은 규칙을 테스트로 묶어 둔다
pub fn valid_name(name: &str) -> bool {
    let mut cs = name.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
}

fn fill(body: &str, name: &str, summary: &str, date: &str) -> String {
    body.replace("{{name}}", name).replace("{{summary}}", summary).replace("{{date}}", date)
}

/// 빈 자리만 채운다. ko = 한국어 템플릿
pub fn install(dir: &Path, ko: bool, name: &str, summary: &str, date: &str) -> std::io::Result<Report> {
    let mut r = Report::default();
    std::fs::create_dir_all(dir)?;
    for (path, en, kr) in FILES {
        let dest = dir.join(path);
        if dest.exists() {
            r.kept.push((*path).into());
            continue;
        }
        if let Some(p) = dest.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(&dest, fill(if ko { kr } else { en }, name, summary, date))?;
        r.written.push((*path).into());
    }
    Ok(r)
}

/// 참모 스크립트(scripts/new-project)가 쓸 템플릿을 <데이터>/templates/project/{en,ko} 에 푼다 — 앱이 켤 때마다(앱 것이라 덮어씀)
pub fn export_templates(data: &Path) -> std::io::Result<()> {
    for (path, en, ko) in FILES {
        let file = if *path == ".gitignore" { "gitignore" } else { path };
        for (lang, body) in [("en", en), ("ko", ko)] {
            let dest = data.join("templates/project").join(lang).join(file);
            if let Some(p) = dest.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::write(dest, body)?;
        }
    }
    Ok(())
}

fn today() -> String {
    let out = std::process::Command::new("date").arg("+%Y-%m-%d").output();
    out.ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()
}

/// 프로젝트 화면의 "하네스 깔기" — 빈 자리만 채운다. 설명은 사용자가 나중에 고친다
#[tauri::command]
pub fn harness_project(dir: String) -> Result<Report, String> {
    let dir = crate::config::expand(&crate::config::home(), &dir);
    let path = Path::new(&dir);
    if !path.is_dir() {
        return Err(crate::i18n::tr("폴더가 없어요", "Folder not found").into());
    }
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let summary = crate::i18n::tr("(이 프로젝트가 무엇인지 한두 줄로 적어 주세요)", "(Describe this project in a line or two)");
    install(path, !crate::i18n::is_en(), &name, summary, &today()).map_err(|e| e.to_string())
}

/// 프로젝트 폴더 목록 = devRoot 바로 아래 폴더들 + 설정에서 따로 추가한 폴더들(extraProjects).
/// (이름, 경로). 이름은 폴더 이름 — 사이드바·세션 판별이 이름으로 묶는다. 같은 경로가 두 번 나오면 한 번만,
/// 추가한 폴더가 없으면 건너뛴다. 걸러 내기(.git 여부 등)는 부르는 쪽 몫
pub fn dirs(home: &str, dev_root: &str, extras: &[String]) -> Vec<(String, std::path::PathBuf)> {
    let mut out: Vec<(String, std::path::PathBuf)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(crate::config::expand(home, dev_root)) {
        for e in rd.flatten() {
            if e.path().is_dir() {
                out.push((e.file_name().to_string_lossy().into_owned(), e.path()));
            }
        }
    }
    for x in extras {
        let p = std::path::PathBuf::from(crate::config::expand(home, x).trim_end_matches('/'));
        let Some(name) = p.file_name().map(|n| n.to_string_lossy().into_owned()) else { continue };
        if p.is_dir() && !out.iter().any(|(_, q)| q == &p) {
            out.push((name, p));
        }
    }
    out
}

/// 지금 설정 기준 프로젝트 폴더들 — Rust 커맨드(스캔·커밋·CI·저장소 목록)가 dev_root 인자와 함께 쓴다
pub fn dirs_now(dev_root: &str) -> Vec<(String, std::path::PathBuf)> {
    dirs(&crate::config::home(), dev_root, &crate::config::current().extra_projects)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-proj-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn 폴더_이름_규칙() {
        assert!(valid_name("acme-shop"));
        assert!(valid_name("todo_api.v2"));
        assert!(!valid_name("Acme")); // 대문자
        assert!(!valid_name("쇼핑몰")); // 한글
        assert!(!valid_name("-x")); // 기호로 시작
        assert!(!valid_name("a b"));
        assert!(!valid_name(""));
    }

    #[test]
    fn 빈_폴더엔_다_깔고_이름_설명_날짜를_채운다() {
        let d = temp("new");
        let r = install(&d, true, "acme-shop", "작은 쇼핑몰", "2026-09-28").unwrap();
        assert_eq!(r.written.len(), FILES.len());
        let claude = std::fs::read_to_string(d.join("CLAUDE.md")).unwrap();
        assert!(claude.starts_with("# acme-shop"));
        assert!(claude.contains("작은 쇼핑몰"));
        assert!(std::fs::read_to_string(d.join("docs/starter.md")).unwrap().contains("2026-09-28"));
        assert!(d.join(".gitignore").is_file());
        assert!(!std::fs::read_to_string(d.join("CLAUDE.md")).unwrap().contains("{{"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 있는_파일은_절대_안_덮는다() {
        let d = temp("keep");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("CLAUDE.md"), "# 내 규칙").unwrap();
        let r = install(&d, false, "x", "y", "z").unwrap();
        assert_eq!(std::fs::read_to_string(d.join("CLAUDE.md")).unwrap(), "# 내 규칙");
        assert!(r.kept.contains(&"CLAUDE.md".to_string()));
        assert!(r.written.contains(&"docs/starter.md".to_string()));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 영어_템플릿() {
        let d = temp("en");
        install(&d, false, "todo-api", "A tiny API", "2026-09-28").unwrap();
        assert!(std::fs::read_to_string(d.join("CLAUDE.md")).unwrap().contains("Start every session"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 스크립트용_템플릿을_데이터_폴더에_푼다() {
        let d = temp("export");
        export_templates(&d).unwrap();
        assert!(d.join("templates/project/ko/CLAUDE.md").is_file());
        assert!(d.join("templates/project/en/gitignore").is_file());
        assert!(d.join("templates/project/en/docs/decisions/README.md").is_file());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 프로젝트_폴더는_dev_아래와_따로_추가한_것() {
        let d = temp("dirs");
        std::fs::create_dir_all(d.join("dev/acme-shop")).unwrap();
        std::fs::create_dir_all(d.join("dev/todo-api")).unwrap();
        std::fs::write(d.join("dev/notes.txt"), "x").unwrap(); // 파일은 프로젝트가 아니다
        std::fs::create_dir_all(d.join("automation/blog-bot")).unwrap();
        let home = d.to_string_lossy().into_owned();
        let extras = vec!["~/automation/blog-bot/".to_string(), "~/dev/acme-shop".to_string(), "~/없는폴더".to_string()];
        let mut got: Vec<String> = dirs(&home, "~/dev", &extras).into_iter().map(|(n, _)| n).collect();
        got.sort();
        assert_eq!(got, ["acme-shop", "blog-bot", "todo-api"]); // 겹친 건 한 번, 없는 폴더는 빠진다
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn dev_폴더가_없어도_추가한_폴더는_나온다() {
        let d = temp("dirs2");
        std::fs::create_dir_all(d.join("work/blog")).unwrap();
        let home = d.to_string_lossy().into_owned();
        let got = dirs(&home, "~/없음", &["~/work/blog".into()]);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, "blog");
        assert_eq!(got[0].1, d.join("work/blog"));
        let _ = std::fs::remove_dir_all(&d);
    }
}
