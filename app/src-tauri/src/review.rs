//! 리뷰·머지 — gh 로 dev 아래 저장소의 열린 PR·오늘 머지된 PR 을 읽고, 머지·되돌리기(revert PR 만들기)를 한다.
//! 파싱·판정(사용자 확인 조건)은 프론트 domain/review*.ts. 여기는 명령만 부르고 원문을 돌려준다.
//! gh 는 한 번에 0.6~1초라 전부 spawn_blocking — 화면 스레드를 안 막는다(실측: 검색 둘 + 상세 8개 병렬 ≈ 2.6초)

use crate::claude::{gh_bin, git};
use serde::Deserialize;
use std::process::Command;

fn gh(args: &[&str]) -> Result<String, String> {
    let o = Command::new(gh_bin()).args(args).output().map_err(|e| if crate::i18n::is_en() { format!("Failed to run gh: {e}") } else { format!("gh 실행 실패: {e}") })?;
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&o.stderr).trim().to_string())
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// 머지·되돌리기는 되돌리기 어려운 일이라 <데이터 폴더>/review.log 에 남긴다(무엇을 언제 눌렀나)
fn log(kind: &str, text: &str) {
    use std::io::Write;
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(crate::config::data_file("review.log")) {
        let _ = writeln!(f, "{ts}\t{kind}\t{}", text.replace('\n', " "));
    }
}

/// dev 아래 git 폴더마다 `폴더\t origin url`. GitHub 저장소 고르기는 domain/reviewSource parseRepoMap
#[tauri::command]
pub async fn repo_map(dev_root: String) -> Result<String, String> {
    blocking(move || {
        Ok(crate::project::dirs_now(&dev_root)
            .into_iter()
            .filter(|(_, d)| d.join(".git").exists())
            .map(|(name, d)| format!("{name}\t{}", git(&d, &["remote", "get-url", "origin"])))
            .collect::<Vec<_>>()
            .join("\n"))
    })
    .await
}

/// 내가 만든 PR 검색 — merged_since 가 없으면 열린 것, 있으면 그 시각(ISO) 뒤에 머지된 것. 저장소 하나씩 부르지 않고 검색 한 번
#[tauri::command]
pub async fn pr_search(merged_since: Option<String>) -> Result<String, String> {
    blocking(move || match merged_since {
        None => gh(&["search", "prs", "--author", "@me", "--state", "open", "--limit", "100", "--json", "repository,number,updatedAt"]),
        Some(since) => gh(&[
            "search", "prs", "--author", "@me", "--merged", "--merged-at", &format!(">={since}"), "--limit", "100",
            "--json", "repository,number,title,closedAt,url,id",
        ]),
    })
    .await
}

#[derive(Deserialize)]
pub struct PrRef {
    repo: String,
    number: u64,
}

const VIEW_FIELDS: &str = "number,id,title,body,url,headRefName,baseRefName,createdAt,updatedAt,isDraft,mergeable,additions,deletions,files,statusCheckRollup,commits";

/// PR 상세 여러 건 — 동시에(스레드). 못 읽은 건 빈 문자열(프론트가 건너뛴다)
#[tauri::command]
pub async fn pr_views(items: Vec<PrRef>) -> Result<Vec<String>, String> {
    blocking(move || {
        let handles: Vec<_> = items
            .into_iter()
            .map(|p| std::thread::spawn(move || gh(&["pr", "view", &p.number.to_string(), "-R", &p.repo, "--json", VIEW_FIELDS]).unwrap_or_default()))
            .collect();
        Ok(handles.into_iter().map(|h| h.join().unwrap_or_default()).collect())
    })
    .await
}

/// PR diff 원문. 아주 큰 PR 은 앞 2MB 까지만(화면은 파일당 400줄만 그린다)
#[tauri::command]
pub async fn pr_diff(repo: String, number: u64) -> Result<String, String> {
    blocking(move || {
        let mut d = gh(&["pr", "diff", &number.to_string(), "-R", &repo])?;
        if d.len() > 2_000_000 {
            let mut cut = 2_000_000;
            while !d.is_char_boundary(cut) {
                cut -= 1;
            }
            d.truncate(cut);
        }
        Ok(d)
    })
    .await
}

/// 머지 — 저장소들이 쓰는 방식(스쿼시, 제목 끝 (#번호))대로. 브랜치는 안 지운다(세션 worktree 가 쓰고 있을 수 있다)
#[tauri::command]
pub async fn pr_merge(repo: String, number: u64) -> Result<String, String> {
    blocking(move || {
        let r = gh(&["pr", "merge", &number.to_string(), "-R", &repo, "--squash"]);
        log("merge", &format!("{repo}#{number} {}", r.as_ref().map(|_| "ok".to_string()).unwrap_or_else(|e| e.clone())));
        r
    })
    .await
}

/// 되돌리기 = revert PR 을 만들기만 한다(머지 안 함). GitHub 서버가 만들어서 로컬 git 을 안 건드린다.
/// gh 2.78 엔 `pr revert` 가 없어 GraphQL revertPullRequest. 돌려주는 건 {"number","url"} JSON
#[tauri::command]
pub async fn pr_revert(id: String, title: String, body: String) -> Result<String, String> {
    blocking(move || {
        let q = "mutation($id:ID!,$title:String!,$body:String!){revertPullRequest(input:{pullRequestId:$id,title:$title,body:$body}){revertPullRequest{number url}}}";
        let r = gh(&[
            "api", "graphql", "-f", &format!("query={q}"), "-f", &format!("id={id}"), "-f", &format!("title={title}"), "-f", &format!("body={body}"),
            "-q", ".data.revertPullRequest.revertPullRequest",
        ]);
        log("revert", &format!("{id} {title} → {}", r.as_ref().map(|s| s.trim().to_string()).unwrap_or_else(|e| e.clone())));
        r
    })
    .await
}

/// 열린 PR 과 걸린 조건을 <데이터 폴더>/review.json 에 — 비서가 머지하기 전에 읽는다(판정을 한 곳에만 두려고).
/// 다 쓰고 이름을 바꿔서, 읽는 쪽이 반쯤 쓴 파일을 보지 않게
#[tauri::command]
pub fn write_review_state(json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| if crate::i18n::is_en() { format!("Not JSON: {e}") } else { format!("JSON 아님: {e}") })?;
    let tmp = crate::config::data_file("review.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, crate::config::data_file("review.json")).map_err(|e| e.to_string())
}
