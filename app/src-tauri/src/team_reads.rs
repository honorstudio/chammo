//! 읽음(카톡처럼, chammo-relay ADR 0012) — 방마다 사람(멤버 = 계정)별 '어디까지 읽었나' seq.
//! - 원본은 중계 방. 소켓 ready.reads·{t:"read"} 로 받은 값을 team-reads.json 에 앞으로만 합친다 → feed.reads 로 화면에
//! - 내가 읽은 것은 화면이 사람이 보고 있을 때만 team_mark_read 로 넘기고, 연결 스레드가 방마다 1초에 한 번까지 묶어 {t:"read"} 로 올린다
//! - 같은 계정 기기끼리는 같은 멤버라 한 기기에서 읽으면 다른 기기의 안 읽음 수도 사라진다
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const FILE: &str = "team-reads.json";
/// 방마다 읽음 올리기 간격 — 스크롤하며 새 말이 연달아 와도 한 번에(소켓 틀이라 서명 요청 한도는 안 먹지만 방 DO 쓰기를 아낀다)
pub const EVERY: Duration = Duration::from_secs(1);

/// 방 → 멤버 → seq
pub type Reads = HashMap<String, HashMap<String, u64>>;

static LOCK: Mutex<()> = Mutex::new(());

pub fn load(dir: &Path) -> Reads {
    std::fs::read_to_string(dir.join(FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// 앞으로만 합친다 — 하나라도 올랐으면 true(화면을 다시 읽게)
pub fn merge(dir: &Path, room: &str, got: &[(String, u64)]) -> bool {
    if room.is_empty() || room.len() > 80 {
        return false;
    }
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load(dir);
    let per = all.entry(room.to_string()).or_default();
    let mut up = false;
    for (m, s) in got {
        if m.is_empty() || m.len() > 80 || *s == 0 {
            continue;
        }
        let cur = per.entry(m.clone()).or_insert(0);
        if *s > *cur {
            *cur = *s;
            up = true;
        }
    }
    if up {
        if let Ok(t) = serde_json::to_string(&all) {
            let _ = crate::accounts::write_atomic(&dir.join(FILE), &t);
        }
    }
    up
}

/// ready.reads — 옛 중계는 칸이 없다(빈 목록)
pub fn from_ready(v: &Value) -> Vec<(String, u64)> {
    v["reads"].as_object().map(|o| o.iter().filter_map(|(m, s)| s.as_u64().filter(|s| *s > 0).map(|s| (m.clone(), s))).collect()).unwrap_or_default()
}

/// {t:"read", member, seq}
pub fn from_read(v: &Value) -> Option<(String, u64)> {
    let m = v["member"].as_str().filter(|m| !m.is_empty())?;
    Some((m.to_string(), v["seq"].as_u64().filter(|s| *s > 0)?))
}

/// 그 방 팀에서의 내 멤버 id — 내 기기끼리 방·모르는 방은 빈 글(읽음 없음)
pub fn my_member(st: &crate::team_relay::TeamState, room: &str) -> String {
    let Some(r) = st.rooms.iter().find(|r| r.id == room && r.kind != "self") else { return String::new() };
    st.teams.iter().find(|t| t.id == r.team).map(|t| t.member_id.clone()).unwrap_or_else(|| st.member_id.clone())
}

/// 연결 스레드의 읽음 보낼 줄 — 방마다 원하는 seq 와 보낸 seq·때
#[derive(Default)]
pub struct Outbox {
    want: HashMap<String, u64>,
    sent: HashMap<String, (u64, Instant)>,
}

impl Outbox {
    pub fn want(&mut self, room: &str, seq: u64) {
        let w = self.want.entry(room.to_string()).or_insert(0);
        *w = (*w).max(seq);
    }

    /// 지금 보낼 것 — 보낸 것보다 크고, 그 방에 마지막으로 보낸 지 every 가 지난 것
    pub fn due(&self, now: Instant, every: Duration) -> Vec<(String, u64)> {
        self.want
            .iter()
            .filter(|(r, w)| self.sent.get(*r).is_none_or(|(s, at)| **w > *s && now.duration_since(*at) >= every))
            .map(|(r, w)| (r.clone(), *w))
            .collect()
    }

    pub fn sent(&mut self, room: &str, seq: u64, now: Instant) {
        self.sent.insert(room.to_string(), (seq, now));
    }
}

#[cfg(test)]
#[path = "team_reads_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "team_reads_live_tests.rs"]
mod live;
