//! 폰에서 누른 팀 보관함 영상(11-04 사용자 920MB mp4) — 맥이 뒤에서 받아 데이터 폴더(team-locker-peek, 600)에 풀고, 다 되면 그 자리를
//! 영상 검토 길(mobile_http /api/team-media → media 표·video_prep 저용량)로 넘긴다. 받기는 데스크톱 열기와 같은 team_down 'open' 줄이라
//! 진행·멈추기가 같이 보이고, 같은 판을 이미 풀어 뒀으면 team_locker_app 의 받은 자리 기억으로 바로 끝난다. 폰은 1초마다 poll 로 본다
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    /// 받는 중 — total 0 = 아직 모름(목록 받는 중·데스크톱이 먼저 받는 중)
    Going { done: u64, total: u64 },
    Ready(PathBuf),
    /// why = team_down::why_kind(net·disk·gone·stopped·other) — 폰이 까닭 한 줄로
    Failed { why: String, error: String },
}

/// 뒤에서 돌릴 받기 — 다 받은 자리
pub type Work = Box<dyn FnOnce() -> Result<PathBuf, String> + Send>;

enum Job {
    Going,
    Ready(PathBuf),
    Failed(String, String),
}

static JOBS: Mutex<BTreeMap<(String, String), Job>> = Mutex::new(BTreeMap::new());

fn jobs() -> std::sync::MutexGuard<'static, BTreeMap<(String, String), Job>> {
    JOBS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 지금 상태 — 처음이면(또는 실패를 알린 뒤·풀어 둔 파일이 청소로 지워졌으면) start 로 받기를 만들어 spawn 으로 뒤에 돌린다.
/// start 가 Err 면(영상 아님 등) 기록 없이 그 까닭. 실패는 한 번 알리고 지운다 — 다시 누르면 처음부터
pub fn poll(team: &str, id: &str, start: impl FnOnce() -> Result<Work, String>, spawn: impl FnOnce(Box<dyn FnOnce() + Send>)) -> Result<Step, String> {
    let key = (team.to_string(), id.to_string());
    {
        let mut m = jobs();
        match m.get(&key) {
            Some(Job::Going) => return Ok(progress(team, id)),
            Some(Job::Ready(p)) if p.is_file() => return Ok(Step::Ready(p.clone())),
            Some(Job::Failed(why, error)) => {
                let s = Step::Failed { why: why.clone(), error: error.clone() };
                m.remove(&key);
                return Ok(s);
            }
            _ => {}
        }
        // 다 받은 기록이 쌓이지 않게 — 받는 중은 남긴다
        if m.len() > 64 {
            m.retain(|_, j| matches!(j, Job::Going));
        }
        // 자리부터 잡고 잠금을 푼다 — start 는 목록을 받으러 망을 탈 수 있다(그동안 다른 부름은 '받는 중')
        m.insert(key.clone(), Job::Going);
    }
    let work = match start() {
        Ok(w) => w,
        Err(e) => {
            jobs().remove(&key);
            return Err(e);
        }
    };
    {
        spawn(Box::new(move || {
            let job = match work() {
                Ok(p) => Job::Ready(p),
                Err(e) => Job::Failed(crate::team_down::why_kind(&e, e.contains("받기를 멈췄어요")).into(), e),
            };
            jobs().insert(key, job);
        }));
    }
    // 바로 돌린 경우(시험)도 있어 한 번 더 본다 — 실패는 다음 부름이 알린다
    Ok(match jobs().get(&(team.to_string(), id.to_string())) {
        Some(Job::Ready(p)) => Step::Ready(p.clone()),
        _ => progress(team, id),
    })
}

/// 받는 중 진행 — team_down 의 그 파일 'open' 줄(데스크톱이 먼저 받는 중이어도 같은 줄)
fn progress(team: &str, id: &str) -> Step {
    crate::team_down::list(team)
        .into_iter()
        .find(|d| d.id == id && d.mode == "open" && d.state == "going")
        .map_or(Step::Going { done: 0, total: 0 }, |d| Step::Going { done: d.done, total: d.total })
}

/// 같은 파일을 누가(데스크톱 열기) 이미 받는 중인가 — track 은 겹쳐 받기를 거절해서, 뒤 받기는 이게 풀릴 때까지 기다렸다 받는다(그땐 받은 자리 기억으로 바로)
pub fn busy(team: &str, id: &str) -> bool {
    crate::team_down::list(team).iter().any(|d| d.id == id && d.mode == "open" && d.state == "going")
}

#[cfg(test)]
#[path = "team_media_tests.rs"]
mod tests;
