//! 팀 파일 받기 진행 — 대화 파일 말풍선·팀 보관함 카드가 막대(받은 MB / 전체)·멈추기·다 받음·실패 이유를 그린다(11-01 사용자 시안 승인).
//! 받기 명령(team_locker_save·team_locker_open)이 track 으로 감싸고, 화면은 team_down_list 로 읽는다. 메모리에만 있다(앱을 끄면 사라진다)
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Down {
    pub team: String,
    pub id: String,
    /// save = 내 폴더에 저장 · open = 눌러서 열기(다 받으면 목록에서 빠진다)
    pub mode: String,
    pub done: u64,
    pub total: u64,
    /// going | done | failed
    pub state: String,
    /// 실패 종류 — net | disk | gone | stopped | other (화면이 이유 한 줄로)
    pub why: String,
    pub error: String,
    /// 다 받은 자리(폴더에서 보기·열기)
    pub path: String,
    #[serde(skip)]
    stop: Arc<AtomicBool>,
}

static DOWNS: Mutex<Vec<Down>> = Mutex::new(Vec::new());

fn downs() -> std::sync::MutexGuard<'static, Vec<Down>> {
    DOWNS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 실패 글 → 종류
pub fn why_kind(err: &str, stopped: bool) -> &'static str {
    let e = err.to_lowercase();
    if stopped {
        "stopped"
    } else if e.contains("os error 28") || e.contains("os error 112") || e.contains("no space") || e.contains("disk full") {
        "disk"
    } else if err.contains("그 파일이 없어") {
        "gone"
    } else if err.contains("중계 서버에 못 닿았어요") || err.contains("중계 서버 답을 못 읽었어요") || e.contains("timed out") || e.contains("timeout") {
        "net"
    } else {
        "other"
    }
}

/// 받기 하나를 기록하며 돌린다 — run 은 조각마다 tick(받은, 전체)을 부르고, 멈추기를 눌렀으면 tick 이 Err 를 돌려 받기를 끊는다.
/// 같은 파일·같은 길(mode)을 받는 중이면 겹쳐 받지 않고 바로 Err
pub fn track(team: &str, id: &str, mode: &str, run: impl FnOnce(&mut dyn FnMut(u64, u64) -> Result<(), String>) -> Result<PathBuf, String>) -> Result<PathBuf, String> {
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut l = downs();
        if l.iter().any(|d| d.team == team && d.id == id && d.mode == mode && d.state == "going") {
            return Err("이미 받는 중이에요".into());
        }
        l.retain(|d| !(d.team == team && d.id == id && d.mode == mode));
        l.push(Down { team: team.into(), id: id.into(), mode: mode.into(), done: 0, total: 0, state: "going".into(), why: String::new(), error: String::new(), path: String::new(), stop: stop.clone() });
    }
    let same = |d: &Down| d.team == team && d.id == id && d.mode == mode;
    let mut tick = |done: u64, total: u64| -> Result<(), String> {
        if stop.load(Ordering::SeqCst) {
            return Err("받기를 멈췄어요".into());
        }
        if let Some(d) = downs().iter_mut().find(|d| same(d)) {
            d.done = done;
            d.total = total;
        }
        Ok(())
    };
    let r = run(&mut tick);
    let stopped = stop.load(Ordering::SeqCst);
    let mut l = downs();
    match &r {
        Ok(_) if mode == "open" => l.retain(|d| !same(d)),
        Ok(p) => {
            if let Some(d) = l.iter_mut().find(|d| same(d)) {
                if d.total == 0 {
                    d.total = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0); // 이미 받아 둔 파일 — 진행 없이 끝났다
                }
                d.done = d.total;
                d.state = "done".into();
                d.path = p.to_string_lossy().into_owned();
            }
        }
        Err(e) => {
            if let Some(d) = l.iter_mut().find(|d| same(d)) {
                d.state = "failed".into();
                d.why = why_kind(e, stopped).into();
                d.error = e.clone();
            }
        }
    }
    r
}

/// 멈추기 — 받는 중인 그 파일(모든 길). 멈출 게 있었나
pub fn stop(team: &str, id: &str) -> bool {
    let l = downs();
    let mut hit = false;
    for d in l.iter().filter(|d| d.team == team && d.id == id && d.state == "going") {
        d.stop.store(true, Ordering::SeqCst);
        hit = true;
    }
    hit
}

/// 그 팀의 받기 줄(받는 중·다 받음·실패). 빈 팀이면 모두(대화 칸엔 다른 팀 방 파일도 있다)
pub fn list(team: &str) -> Vec<Down> {
    downs().iter().filter(|d| team.is_empty() || d.team == team).cloned().collect()
}

/// 다 받은 '내 폴더에 저장' 자리 — 열기·폴더에서 보기는 화면이 준 경로가 아니라 이 기록으로만(그새 지워졌으면 None)
pub fn saved(team: &str, id: &str) -> Option<PathBuf> {
    let p = downs().iter().find(|d| d.team == team && d.id == id && d.mode == "save" && d.state == "done").map(|d| PathBuf::from(&d.path))?;
    p.is_file().then_some(p)
}

/// 다 받음·실패 줄 치우기(받는 중은 그대로)
pub fn dismiss(team: &str, id: &str) {
    downs().retain(|d| !(d.team == team && d.id == id && d.state != "going"));
}

#[cfg(test)]
#[path = "team_down_tests.rs"]
mod tests;
