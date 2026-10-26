//! 새 기기 허용 카드·폰 숫자 확인 카드(ADR 0014) — 결정 대기함 link 카드의 두 갈래.
//! 답은 사람 길(데스크톱 메인 창·짝지은 폰)로만(direct::link_pick). 허용·거절은 카드 답 한 곳에서만 서버로 간다 —
//! 참모·scripts/team·appctl 엔 허용 길이 없다(시험으로 고정). 다른 기기에서 먼저 처리되면 목록을 다시 받아 카드를 닫는다
use crate::team_relay::{self as relay, DeviceName};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub const DEVICE_SUB: &str = "device";
pub const PHONE_LINK_SUB: &str = "phone-link";
/// 대기 기기는 이만큼 지나면 서버가 저절로 허용한다 — 카드도 그때까지
const AUTO_MS: u64 = 24 * 3600 * 1000;

fn clean(s: &str, n: usize) -> String {
    crate::team_relay_inbox::safe_name(&s.chars().filter(|c| !c.is_control()).take(n).collect::<String>())
}

fn kind_word(k: &str) -> &'static str {
    match k {
        "phone" => crate::i18n::tr("폰", "Phone"),
        "mac" => crate::i18n::tr("맥", "Mac"),
        "win" => crate::i18n::tr("윈도우", "Windows"),
        _ => crate::i18n::tr("기기", "Device"),
    }
}

/// 새 기기 허용 카드 줄 — 이름·도시는 서버가 준 남의 글이라 거른다
pub fn device_row(id: &str, d: &DeviceName, ts: &str) -> Value {
    let name = clean(&d.name, 64);
    let place = [clean(&d.req_city, 40), clean(&d.req_country, 40)].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", ");
    let since = d.pending_since.unwrap_or(0);
    let when = if since > 0 { crate::direct::iso_of_ms(since) } else { ts.to_string() };
    let kind = kind_word(&d.kind);
    json!({
        "ts": ts, "type": "ask", "id": id, "from": crate::direct::LINK_FROM, "cwd": "", "kind": crate::direct::LINK_KIND, "sub": DEVICE_SUB, "dev": d.id,
        "q": crate::i18n::tr(&format!("새 기기가 내 Chammo 계정에 로그인했어요 — {kind} {name}, 허용할까요?"), &format!("A new device signed in to your Chammo account — {kind} {name}. Allow it?")),
        "detail": crate::i18n::tr(&format!("{} · 내가 로그인한 게 아니면 거절", if place.is_empty() { "어디서인지 모름".to_string() } else { place.clone() }), &format!("{} · Decline if it wasn't you", if place.is_empty() { "Unknown place".to_string() } else { place })),
        "what": crate::i18n::tr("새 기기 허용", "Allow new device"),
        "yes": crate::i18n::tr("허용", "Allow"), "no": crate::i18n::tr("거절", "Decline"), "options": [],
        "at": when,
        "until": crate::direct::iso_of_ms(if since > 0 { since.saturating_add(AUTO_MS) } else { 0 }),
    })
}

/// 폰 숫자 확인 카드 줄 — 숫자는 큰 글씨(code), 질문은 '같을 때만'을 앞세운다.
/// pending_place = 그 폰이 아직 허용 대기면 로그인한 곳 — 이 카드가 계정 허용도 하니 '새 기기'를 맨 앞에(리뷰 2차 중)
pub fn phone_link_row(id: &str, name: &str, sas: u32, until_ms: u64, pending_place: Option<&str>, ts: &str) -> Value {
    let name = clean(name, 64);
    let new = pending_place.map(|p| { let p = clean(p, 80); if p.is_empty() { crate::i18n::tr("어디서인지 모름", "Unknown place").to_string() } else { p } });
    let q: String = match &new {
        Some(p) => crate::i18n::tr(&format!("새 기기(허용 대기) · {p} — {name} 이 이 계정에 들어와 이 컴퓨터 화면을 열려고 해요. 폰 숫자와 같을 때만 허용"), &format!("New device (waiting) · {p} — {name} wants to join this account and open this computer. Allow only if the phone shows the same number")).to_string(),
        None => crate::i18n::tr(&format!("{name} 이 이 컴퓨터 화면을 열려고 해요 — 폰에 보이는 숫자와 같을 때만 허용"), &format!("{name} wants to open this computer — allow only if the phone shows the same number")).to_string(),
    };
    json!({
        "ts": ts, "type": "ask", "id": id, "from": crate::direct::LINK_FROM, "cwd": "", "kind": crate::direct::LINK_KIND, "sub": PHONE_LINK_SUB,
        "q": q,
        "code": crate::device_link::sas_text(sas),
        "detail": crate::i18n::tr("숫자가 다르면 거절 — 누군가 가운데 끼어든 거예요", "Different number? Decline — someone is in the middle"),
        "what": if new.is_some() { crate::i18n::tr("새 기기 허용 + 폰 화면 열기", "Allow new device + open this computer") } else { crate::i18n::tr("폰 화면 열기 허용", "Allow phone to open this computer") },
        "yes": crate::i18n::tr("허용", "Allow"), "no": crate::i18n::tr("거절", "Decline"), "options": [],
        "until": crate::direct::iso_of_ms(until_ms),
    })
}

pub struct Plan {
    /// 카드를 새로 띄울 기기
    pub open: Vec<DeviceName>,
    /// 닫을 카드 id(다른 곳에서 처리됨)
    pub close: Vec<String>,
}

/// 아직 답하지 않은 기기 카드들(기기 id → 카드 id)
fn open_cards(log: &str) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for r in log.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        let id = r["id"].as_str().unwrap_or_default().to_string();
        match r["type"].as_str() {
            Some("ask") if r["sub"] == DEVICE_SUB => {
                if let Some(d) = r["dev"].as_str() {
                    m.insert(d.to_string(), id);
                }
            }
            Some("answer" | "done" | "cancel") => m.retain(|_, c| *c != id),
            _ => {}
        }
    }
    m
}

/// 목록과 기록을 맞춘다 — 대기 기기마다 카드 하나, 대기가 아닌(허용·거절·삭제) 기기의 열린 카드는 닫기. 나 자신·내가 대기 중이면 안 띄운다
pub fn plan(log: &str, devices: &[DeviceName], me_pending: bool) -> Plan {
    let cards = open_cards(log);
    let open = if me_pending { Vec::new() } else { devices.iter().filter(|d| d.pending() && !d.current && !cards.contains_key(&d.id)).cloned().collect() };
    let mut close: Vec<String> = cards.iter().filter(|(dev, _)| !devices.iter().any(|d| &d.id == *dev && d.pending())).map(|(_, c)| c.clone()).collect();
    close.sort();
    Plan { open, close }
}

/// 기록을 목록에 맞춘다 — 상태 파일·카드 기록만(망 안 씀)
pub fn sync(dir: &Path) {
    let st = relay::load_state(dir);
    if st.account.is_none() {
        return;
    }
    // 이번에 앱이 띄우지 않은 열린 기기 카드(지난 실행·지어 쓴 줄)는 닫는다 — 아래 계획이 새로 띄운다
    for (_, c) in open_cards(&crate::direct::direct_log()) {
        if !issued(&c) {
            crate::direct::close_link(&c, crate::i18n::tr("새 카드로 다시 띄워요", "Shown again as a new card"));
        }
    }
    let log = crate::direct::direct_log();
    let p = plan(&log, &st.my_devices, st.pending);
    for d in &p.open {
        if let Ok(id) = crate::mobile_pair::random_hex(4) {
            if crate::direct::append_row(&device_row(&id, d, &crate::direct::chrono_now())).is_ok() {
                remember(&id);
            }
        }
    }
    // 허용하고 4자리를 띄운 카드는 새 기기에 넣을 때까지 둔다(R7 A, 10분)
    let kept: Vec<String> = open_cards(&log).into_iter().filter(|(dev, _)| crate::e2e_cmd::code_alive(dev)).map(|(_, c)| c).collect();
    for c in p.close.iter().filter(|c| !kept.contains(c)) {
        crate::direct::close_link(c, crate::i18n::tr("다른 기기에서 처리했어요", "Handled on another device"));
    }
}

/// 이번에 앱이 띄운 기기 카드 id — 기록 파일에 누가 줄을 지어 써도 그 카드로는 허용 못 하게(리뷰 2차 하②)
static ISSUED: std::sync::LazyLock<std::sync::Mutex<std::collections::HashSet<String>>> = std::sync::LazyLock::new(Default::default);

pub(crate) fn remember(id: &str) {
    ISSUED.lock().unwrap_or_else(|e| e.into_inner()).insert(id.to_string());
}
fn issued(id: &str) -> bool {
    ISSUED.lock().unwrap_or_else(|e| e.into_inner()).contains(id)
}

/// 사람이 카드에서 누른 허용·거절 → 서버(이 기기 열쇠 서명). 다른 기기에서 먼저 눌렀으면(409) 그대로 성공.
/// 앱이 이번에 띄운 카드(@link)만 — 그 밖은 '다시 띄울게요'(앱을 다시 켜면 옛 카드는 닫고 새로 띄운다)
pub fn decide(ask: &Value, yes: bool) -> Result<(), String> {
    if ask["from"] != crate::direct::LINK_FROM || !issued(ask["id"].as_str().unwrap_or_default()) {
        return Err(crate::i18n::tr("이 카드는 지난 것이라 다시 띄울게요 — 잠시 뒤 새 카드에서 눌러 주세요", "This card is stale — a new one will appear shortly").into());
    }
    let dev = ask["dev"].as_str().ok_or("no device")?;
    let dir = crate::config::data_dir();
    crate::team_account::decide_device(dir, &crate::team_relay_keys::store(), &relay::Curl, dev, yes).map(|_| ())
}

static NUDGE: AtomicBool = AtomicBool::new(false);

/// 방 소켓에 기기 알림(device_pending·device_resolved)이 왔다 — 다음 바퀴를 당긴다
pub fn nudge() {
    NUDGE.store(true, Ordering::SeqCst);
}

/// 다시 볼 주기 — 허용 대기·4자리 단계 전(확인 중)엔 5초(QA 8: 4자리 화면이 방 소켓 5분 주기에서만 떠 늦었다), 평소 1분.
/// 내 기기끼리 방 소켓이 붙어 있으면(live) 기기 알림이 바로 오니 5분 — 놓친 알림 대비만(중계 요청을 아끼려고)
pub fn poll_every(pending: bool, checking: bool, live: bool) -> Duration {
    Duration::from_secs(if pending || checking { 5 } else if live { 300 } else { 60 })
}

/// 앱이 뜰 때 한 번 — 로그인돼 있으면 1분마다(알림이 오면 바로) 목록을 받아 카드를 맞춘다. 대기 중인 이 기기는 허용됐는지 본다
pub fn boot() {
    std::thread::spawn(|| {
        let dir = crate::config::data_dir().to_path_buf();
        let mut since = Duration::MAX;
        loop {
            std::thread::sleep(Duration::from_secs(2));
            since = since.saturating_add(Duration::from_secs(2));
            let st = relay::load_state(&dir);
            let checking = crate::e2e_flow::self_step(&dir) == "checking";
            let due = NUDGE.swap(false, Ordering::SeqCst) || since >= poll_every(st.pending, checking, crate::team_relay_ws::self_live());
            if !due || st.account.is_none() || !st.registered() || st.revoked {
                continue;
            }
            since = Duration::ZERO;
            if crate::team_account::refresh_me(&dir, &crate::team_relay_keys::store(), &relay::Curl).is_ok() {
                sync(&dir);
                // 허용된 뒤 확인 중이면 바로 종단 암호 준비 — 4자리·첫 기기 화면이 몇 초 안에 뜨게(QA 8)
                if !relay::load_state(&dir).pending && crate::e2e_flow::self_step(&dir) == "checking" {
                    let _ = crate::e2e_flow::ensure(&dir, &crate::team_relay_keys::store(), &relay::Curl);
                }
            }
            // 보안 번호 카드(e2e_cards) — 망 없이 상태 파일만 본다
            crate::e2e_cards::sync(&dir);
        }
    });
}

#[cfg(test)]
#[path = "device_cards_tests.rs"]
mod tests;
