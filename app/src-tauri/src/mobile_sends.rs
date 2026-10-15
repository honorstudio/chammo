// 폰이 보낸 글 기록(클라이언트 id = cid) — 같은 cid 는 한 번만 치고, 뒤에서 친 결과를 send-status 로 알린다.
// 예전엔 메모리에 10분만 둬서 앱이 다시 켜지거나 10분이 지나면 잊었다 — 폰이 다시 보내기를 누르면 같은 말을 또 쳤다
// (2026-10-10 사용자 '다시보내기 누르다 무한증식', 2026-10-11 아침까지 남은 '못 받았어요'). 이제 데이터 폴더 파일에 하루 남긴다. 글 내용은 안 남긴다
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SendState {
    Typing,
    Done,
    Failed(String),
    /// 치는 중에 앱이 꺼졌다 — 쳤는지 모른다(send-status 'unknown', 같은 cid 를 다시 받으면 친다)
    Lost,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Rec {
    at: u64,
    state: SendState,
}

/// 기록을 두는 시간·개수 — 폰 보낼 함이 말을 들고 있는 시간(20시간)보다 길게, 파일은 수십 KB 안
const KEEP_MS: u64 = 24 * 3_600_000;
const MAX: usize = 500;

/// path 없음(Default) = 메모리만(시험·파일을 못 쓰는 때)
#[derive(Default)]
pub struct Sends {
    path: Option<PathBuf>,
    map: Mutex<HashMap<String, Rec>>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Sends {
    /// 앱이 켜질 때 — 치는 중이던 것은 '모름'(Lost)으로, 하루 지난 것은 버린다. 파일이 없거나 깨졌으면 빈 기록
    pub fn load(path: PathBuf) -> Self {
        let mut map: HashMap<String, Rec> = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        for r in map.values_mut() {
            if r.state == SendState::Typing {
                r.state = SendState::Lost;
            }
        }
        prune(&mut map, now_ms());
        Sends { path: Some(path), map: Mutex::new(map) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Rec>> {
        self.map.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn save(&self, map: &HashMap<String, Rec>) {
        let Some(p) = &self.path else { return };
        if let Ok(t) = serde_json::to_string(map) {
            // 못 쓰면 이번 실행 동안 메모리로만 기억한다
            let _ = crate::mobile_pair::write_private(p, &t);
        }
    }

    /// 치기 시작 — 이미 치는 중이거나 쳤으면 false(다시 안 친다). 실패·모름이면 다시 받는다
    pub fn begin(&self, cid: &str) -> bool {
        self.begin_at(cid, now_ms())
    }
    fn begin_at(&self, cid: &str, now: u64) -> bool {
        let mut m = self.lock();
        if matches!(m.get(cid), Some(r) if now.saturating_sub(r.at) < KEEP_MS && matches!(r.state, SendState::Typing | SendState::Done)) {
            return false;
        }
        m.insert(cid.to_string(), Rec { at: now, state: SendState::Typing });
        prune(&mut m, now);
        self.save(&m);
        true
    }

    /// 친 결과
    pub fn finish(&self, cid: &str, state: SendState) {
        let (mut m, now) = (self.lock(), now_ms());
        m.insert(cid.to_string(), Rec { at: now, state });
        prune(&mut m, now);
        self.save(&m);
    }

    pub fn state(&self, cid: &str) -> Option<SendState> {
        self.lock().get(cid).map(|r| r.state.clone())
    }
}

/// 하루 지난 것을 버리고, 넘치면 오래된 것부터
fn prune(m: &mut HashMap<String, Rec>, now: u64) {
    m.retain(|_, r| now.saturating_sub(r.at) < KEEP_MS);
    if m.len() > MAX {
        let mut ats: Vec<u64> = m.values().map(|r| r.at).collect();
        ats.sort_unstable_by(|a, b| b.cmp(a));
        let cut = ats[MAX - 1];
        m.retain(|_, r| r.at >= cut);
        // 같은 시각이 겹쳐 아직 넘치면 아무거나 덜어 낸다
        while m.len() > MAX {
            let k = m.keys().next().cloned().unwrap_or_default();
            m.remove(&k);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 넘치면_오래된_것부터_버리고_파일도_상한까지만() {
        let d = std::env::temp_dir().join(format!("chammo-sends-cap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let s = Sends::load(d.join("mobile-sends.json"));
        let t0 = now_ms() - 3_600_000;
        for i in 0..(MAX + 100) {
            assert!(s.begin_at(&format!("c-{i}"), t0 + i as u64));
        }
        let saved: HashMap<String, Rec> = serde_json::from_str(&std::fs::read_to_string(d.join("mobile-sends.json")).unwrap()).unwrap();
        assert_eq!(saved.len(), MAX);
        assert!(saved.contains_key(&format!("c-{}", MAX + 99)) && !saved.contains_key("c-0"), "새것을 남긴다");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 깨진_파일이나_없는_파일은_빈_기록() {
        let d = std::env::temp_dir().join(format!("chammo-sends-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("a.json"), "{깨진").unwrap();
        assert_eq!(Sends::load(d.join("a.json")).state("x"), None);
        assert_eq!(Sends::load(d.join("없음.json")).state("x"), None);
        // 메모리만(Default)은 파일을 안 쓴다
        let m = Sends::default();
        assert!(m.begin("c-1"));
        assert!(!m.begin("c-1"));
        let _ = std::fs::remove_dir_all(&d);
    }
}
