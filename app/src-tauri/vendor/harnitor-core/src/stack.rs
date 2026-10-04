//! 이 프로젝트가 **무엇으로 만들어졌나**. 파일이 말해준다.
//!
//! 청사진이 "이 프로젝트엔 이런 스킬이 있으면 좋겠다"에 답하려면 먼저
//! 그 프로젝트가 무엇인지 알아야 한다. 대화 기록에서 찾아보려 했지만
//! **신호가 안 나왔다** — 실측(2026-08-31): 사람이 친 말에서 제일 잦은 낱말이
//! "해당·오케이·누르면"이었고, 제일 많이 실행된 명령은 `cd`(558회)였다.
//!
//! 반면 **파일은 정직하다.** `Cargo.toml` 이 있으면 러스트고 `supabase/` 가 있으면
//! 그걸 쓴다. 실측에서 27개 중 16곳이 신호를 냈다.
//!
//! ## 여기서 하는 일은 힌트까지다
//!
//! 무엇을 만들지는 사람이 대화로 정한다. 이 모듈은 **재료만** 낸다 —
//! 그 기술을 다루는 스킬이 이미 있는지, 있는데 안 열리는지, 아예 없는지.

use crate::model::Skill;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// 기술 하나와 그것을 알아보는 자취.
struct Sign {
    tech: &'static str,
    /// 이 중 하나라도 있으면 그 기술을 쓴다고 본다.
    marks: &'static [&'static str],
    /// 스킬을 찾을 때 함께 볼 낱말. 스킬 이름이 기술 이름과 다를 수 있다.
    words: &'static [&'static str],
}

/// **파일 이름으로만 판단한다.** 본문을 열지 않는다 — 27개 프로젝트를 훑는 자리라
/// stat 한 번으로 끝나야 하고, `CLAUDE.local.md` 같은 걸 열 이유도 없다.
const SIGNS: &[Sign] = &[
    Sign {
        tech: "supabase",
        marks: &["supabase", "supabase/config.toml"],
        words: &["supabase"],
    },
    Sign {
        tech: "next.js",
        marks: &["next.config.js", "next.config.ts", "next.config.mjs"],
        words: &["next.js", "nextjs"],
    },
    Sign {
        tech: "expo",
        marks: &["app.json", "eas.json"],
        words: &["expo", "react native"],
    },
    Sign {
        tech: "rust",
        marks: &["Cargo.toml"],
        words: &["rust"],
    },
    Sign {
        tech: "tauri",
        marks: &["src-tauri", "tauri.conf.json"],
        words: &["tauri"],
    },
    Sign {
        tech: "playwright",
        marks: &["playwright.config.ts", "playwright.config.js", "e2e"],
        words: &["playwright"],
    },
    Sign {
        tech: "docker",
        marks: &["Dockerfile", "docker-compose.yml"],
        words: &["docker"],
    },
    Sign {
        tech: "github actions",
        marks: &[".github/workflows"],
        words: &["github actions"],
    },
    Sign {
        tech: "python",
        marks: &["pyproject.toml", "requirements.txt"],
        words: &["python"],
    },
    Sign {
        tech: "vercel",
        marks: &["vercel.json", ".vercel"],
        words: &["vercel"],
    },
    Sign {
        tech: "sentry",
        marks: &["sentry.client.config.ts", ".sentryclirc"],
        words: &["sentry"],
    },
];

/// 프로젝트가 쓰는 기술 하나와, 그걸 다루는 스킬이 지금 어떤 상태인지.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StackHint {
    pub tech: String,
    /// 그렇게 판단한 근거 파일. **왜 그런지 없이 제안하지 않는다**(절대원칙 6).
    pub evidence: String,
    /// 이 기술을 다루는 것으로 보이는 스킬들.
    pub skills: Vec<String>,
    /// 그중 아무도 부르지 않는 것. **있는데 안 열리는 스킬**이 여기 온다.
    pub unlinked: Vec<String>,
}

impl StackHint {
    /// 스킬이 아예 없나 — 만들 후보다.
    pub fn missing(&self) -> bool {
        self.skills.is_empty()
    }
}

/// 프로젝트가 쓰는 기술을 읽고, 그걸 다루는 스킬과 맞춰 본다.
///
/// `linked` 는 훅·지침이 실제로 부르는 스킬 이름들이다(열린 길).
pub fn hints(root: &Path, skills: &[Skill], linked: &[String]) -> Vec<StackHint> {
    let mut out = vec![];
    for s in SIGNS {
        let Some(found) = s.marks.iter().find(|m| root.join(m).exists()) else {
            continue;
        };
        let names: Vec<String> = skills
            .iter()
            .filter(|sk| mentions_tech(sk, s))
            .map(|sk| sk.name.clone())
            .collect();
        let unlinked = names
            .iter()
            .filter(|n| !linked.iter().any(|l| l == *n))
            .cloned()
            .collect();
        out.push(StackHint {
            tech: s.tech.into(),
            evidence: (*found).into(),
            skills: names,
            unlinked,
        });
    }
    out
}

/// 이 스킬이 그 기술을 다루나. **온전한 낱말로만 본다** —
/// 부분 일치를 허용하면 `ci` 가 `arkcli` 에 걸린다(실측에서 실제로 그랬다).
///
/// **이름에 있으면 그 기술의 스킬이고, 설명에만 있으면 스쳐 지나간 것일 수 있다.**
/// 실측: `cache-cleaner` 이 캐시 지우는 목록에 `cargo` 를 적어서 러스트 스킬로 잡혔고,
/// `arkcli-understand` 는 설명에 `workflow` 가 있어서 GitHub Actions 스킬이 됐다.
/// 그래서 설명만 걸린 경우에는 **기술 이름 자체**를 요구한다 — 곁다리 언급을 거른다.
fn mentions_tech(skill: &Skill, sign: &Sign) -> bool {
    let all = std::iter::once(&sign.tech).chain(sign.words.iter());
    if all.clone().any(|w| crate::edges::mentions(&skill.name, w)) {
        return true;
    }
    crate::edges::mentions(&skill.description, sign.tech)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn skill(name: &str, desc: &str) -> Skill {
        Skill {
            name: name.into(),
            description: desc.into(),
            path: PathBuf::from("/fake"),
            reference_count: 0,
            is_symlink: false,
            description_tokens: 10,
            body: None,
        }
    }

    #[test]
    fn 파일을_보고_무엇으로_만들었는지_안다() {
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("Cargo.toml"), "[package]").unwrap();
        std::fs::create_dir_all(t.path().join("src-tauri")).unwrap();

        let h = hints(t.path(), &[], &[]);
        let techs: Vec<&str> = h.iter().map(|x| x.tech.as_str()).collect();
        assert!(techs.contains(&"rust"), "{techs:?}");
        assert!(techs.contains(&"tauri"), "{techs:?}");
        assert!(!techs.contains(&"supabase"), "없는 걸 있다고 했다");
    }

    #[test]
    fn 근거_파일을_함께_낸다() {
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("Cargo.toml"), "").unwrap();
        let h = hints(t.path(), &[], &[]);
        assert_eq!(h[0].evidence, "Cargo.toml");
    }

    /// **부분 일치를 허용하면 `ci` 가 `arkcli` 에 걸린다** — 실측에서 실제로 그랬다.
    #[test]
    fn 낱말_일부만_같은_스킬은_안_걸린다() {
        let t = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(t.path().join(".github/workflows")).unwrap();
        let skills = vec![
            skill("arkcli-billing", "청구서를 본다"),
            skill("ci-doctor", "github actions 로그를 읽는다"),
        ];
        let h = hints(t.path(), &skills, &[]);
        let ga = h.iter().find(|x| x.tech == "github actions").unwrap();
        assert_eq!(
            ga.skills,
            vec!["ci-doctor"],
            "arkcli 가 걸렸다: {:?}",
            ga.skills
        );
    }

    /// **있는데 안 열리는 것**을 짚는다 — 길을 놓으면 되는 경우다.
    #[test]
    fn 스킬이_있어도_아무도_안_부르면_따로_짚는다() {
        let t = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(t.path().join("supabase")).unwrap();
        let skills = vec![
            skill("supabase-region-migration", "supabase 리전을 옮긴다"),
            skill("db-doctor", "supabase 스키마를 본다"),
        ];
        let h = hints(t.path(), &skills, &["db-doctor".into()]);
        let sb = &h[0];
        assert_eq!(sb.skills.len(), 2);
        assert_eq!(sb.unlinked, vec!["supabase-region-migration"]);
        assert!(!sb.missing());
    }

    /// 아예 없으면 **만들 후보**다.
    #[test]
    fn 다루는_스킬이_없으면_만들_후보다() {
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("Cargo.toml"), "").unwrap();
        let h = hints(t.path(), &[skill("code-review", "diff 를 본다")], &[]);
        assert!(h[0].missing());
        assert!(h[0].unlinked.is_empty());
    }

    /// 설명에 곁다리로 적힌 낱말은 그 기술의 스킬이 아니다.
    /// 실측: `cache-cleaner` 이 지울 캐시 목록에 cargo 를 적었을 뿐인데 러스트 스킬로 잡혔다.
    #[test]
    fn 설명에_스쳐_지나간_낱말은_안_걸린다() {
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("Cargo.toml"), "").unwrap();
        let skills = vec![
            skill("cache-cleaner", "npm·cargo·Xcode 캐시를 지워 용량을 확보한다"),
            skill("rust-review", "러스트 코드를 본다 — rust 관용구를 확인"),
        ];
        let h = hints(t.path(), &skills, &[]);
        assert_eq!(
            h[0].skills,
            vec!["rust-review"],
            "곁다리가 걸렸다: {:?}",
            h[0].skills
        );
    }

    #[test]
    fn 없는_폴더에는_아무_신호도_없다() {
        let t = tempfile::tempdir().unwrap();
        assert!(hints(&t.path().join("nope"), &[], &[]).is_empty());
    }
}
