//! 받아들이기 전에 못 연 말·경고 붙은 말을 받아들인 뒤 다시 연다(계획 2026-10-26-e2e-recover §10, qa-team3 맥 실측 #3).
//! - 받은 말은 서버에 ack 해서 다시 오지 않는다 — 명부·사슬·확인 전 때문에 못 연 봉투와 경고(changed·fork)를 붙여 연 봉투만 원래 모양째 이 기기에 남긴다(600, 30일·300개)
//! - 다시 열기는 e2e_state::reopen — 서명·사슬·명부·시각을 처음부터 다시 본다(되넣기 거름만 건너뛴다: 이 기기가 직접 보관한 봉투라 서버가 끼울 수 없다)
//! - 바뀌면 같은 (방, seq) 로 새 줄을 붙인다(inbox_tail 이 같은 자리를 마지막 내용으로 보인다). 늦게 연 말은 참모에게 안 넘긴다(note late)
use crate::accounts_store::Store;
use crate::e2e_state::{self, Unwrapped};
use crate::team_relay::{self as relay, Http};
use crate::team_relay_inbox::{self as inbox, Action};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::sync::Mutex;

pub const FILE: &str = "e2e-retry.json";
pub const CAP: usize = 300;
const KEEP_MS: u64 = 30 * 24 * 3600_000;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Kept {
    /// 받은 틀 그대로(room·seq·from·origin·body)
    pub msg: Value,
    pub kept_at: u64,
    /// 지금 기록에 보이는 note(e2e-fail·e2e-changed …) — 같으면 다시 안 쓴다
    pub shown: String,
}

static LOCK: Mutex<()> = Mutex::new(());

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 명부·사슬이 맞춰지면 열릴 수 있는 실패 — 평문·시각·되넣기·모양·내 몫 아님·서명·열기 실패는 영영 못 연다
pub fn retryable(why: &str) -> bool {
    !matches!(why, "plain" | "too-old" | "future" | "replay" | "shape" | "NotForMe" | "Shape" | "Open" | "Sig" | "Key" | "late-by" | "late-not-mine")
}

/// 남겨 둘 만한가 — 다시 열 수 있는 실패, 받아들이면 경고가 떨어질 말
pub fn worth_keeping(opened: &Unwrapped) -> bool {
    match opened {
        Unwrapped::Failed(why) => retryable(why),
        Unwrapped::Opened { note, .. } => note == "changed" || note == "fork",
    }
}

pub fn load(dir: &Path) -> Vec<Kept> {
    std::fs::read_to_string(dir.join(FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(dir: &Path, list: &[Kept]) -> Result<(), String> {
    let p = dir.join(FILE);
    crate::accounts::write_atomic(&p, &serde_json::to_string(list).map_err(|e| e.to_string())?).map_err(|e| format!("{e:?}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn same(a: &Value, b: &Value) -> bool {
    a["room"] == b["room"] && a["seq"] == b["seq"]
}

/// 봉투를 남긴다 — shown = 지금 기록에 붙은 note. 같은 자리는 새로 덮고, 30일 지난 것·넘치는 오래된 것은 버린다
pub fn keep(dir: &Path, m: &Value, shown: &str) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let now = now_ms();
    let mut list = load(dir);
    list.retain(|k| k.kept_at.saturating_add(KEEP_MS) >= now && !same(&k.msg, m));
    list.push(Kept { msg: m.clone(), kept_at: now, shown: shown.into() });
    let over = list.len().saturating_sub(CAP);
    list.drain(..over);
    save(dir, &list)
}

/// 늦게 연 말의 기록 줄 — 참모에게 넘기지 않고 화면에만(받아들이기 전 말·건네받은 지난 말이 한꺼번에 참모 입력칸으로 쏟아지지 않게).
/// 같은 (방, seq) 로 붙으니 inbox_tail 이 그 자리를 마지막 내용으로 보인다. 건너뛸 말이면 None
pub fn late_record(st: &relay::TeamState, m: &Value, opened: &Unwrapped) -> Option<inbox::Record> {
    let (act, mut rec) = inbox::with_e2e(st, 0, m, opened);
    if act == Action::Skip {
        return None;
    }
    if matches!(rec.note.as_str(), "delivered" | "human" | "to-human") {
        rec.note = "late".into();
    }
    Some(rec)
}

/// 남긴 봉투를 다시 연다 — 바꿔 쓴 기록 줄 수. 사람이 보안 번호를 받아들인 뒤·앱이 뜰 때 부른다
pub fn retry(dir: &Path, kc: &dyn Store, http: &dyn Http) -> usize {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let st = relay::load_state(dir);
    let now = now_ms();
    let mut left = vec![];
    let mut wrote = 0;
    // 명부는 첫 말만 새로 받고 나머지는 그 명부로(말마다 받으면 300개가 그대로 요청 300개)
    e2e_state::recv_forget(dir);
    for k in load(dir).into_iter().filter(|k| k.kept_at.saturating_add(KEEP_MS) >= now) {
        let opened = e2e_state::reopen(dir, kc, http, &st, &k.msg);
        match &opened {
            Unwrapped::Opened { note, .. } => {
                let Some(rec) = late_record(&st, &k.msg, &opened) else { continue };
                if rec.note != k.shown && inbox::append(dir, &rec).is_ok() {
                    wrote += 1;
                }
                if !note.is_empty() {
                    left.push(Kept { shown: rec.note, ..k });
                }
            }
            Unwrapped::Failed(why) if retryable(why) => left.push(k),
            Unwrapped::Failed(_) => {}
        }
    }
    if let Err(e) = save(dir, &left) {
        eprintln!("[다시 열기] 보관 못 씀: {e}");
    }
    if wrote > 0 {
        crate::team_alert::poke_state();
    }
    wrote
}

#[cfg(test)]
#[path = "e2e_retry_tests.rs"]
mod tests;
