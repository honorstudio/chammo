//! 보안 번호 카드(시안 docs/design-drafts/e2e-safety v1) — 결정 대기함 link 카드의 셋째 갈래(sub safety).
//! 상대 보안 번호가 바뀌었거나(다시 시작) 기기 목록이 갈리면 카드 하나. 답(받아들이기·막아 두기)은 사람 길(direct::link_pick — 데스크톱 메인 창·짝지은 폰)로만,
//! 참모·scripts/team·appctl 엔 길이 없다(device_cards_tests 의 길 시험). 받아들이면 그 사람 때문에 멈춘 말을 보낸다
use crate::e2e_safety::{self, Person};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;

pub const SAFETY_SUB: &str = "safety";

fn clean(s: &str, n: usize) -> String {
    crate::team_relay_inbox::safe_name(&s.chars().filter(|c| !c.is_control()).take(n).collect::<String>())
}

/// 카드 줄 — 이름·팀 이름은 남의 글이라 거른다. code = 보안 번호(번호 비교에서 보여 준다)
pub fn safety_row(id: &str, p: &Person, team_name: &str, ts: &str) -> Value {
    let (name, team) = (clean(&p.name, 64), clean(team_name, 64));
    let forked = p.state == "forked";
    json!({
        "ts": ts, "type": "ask", "id": id, "from": crate::direct::LINK_FROM, "cwd": "", "kind": crate::direct::LINK_KIND, "sub": SAFETY_SUB, "acct": p.account,
        "safety": if forked { "forked" } else { "changed" },
        "q": if forked { crate::i18n::tr(&format!("{name}의 기기 목록이 다르게 보여요"), &format!("{name}'s device list looks different")).to_string() } else { crate::i18n::tr(&format!("{name}의 보안 번호가 바뀌었어요"), &format!("{name}'s safety number changed")).to_string() },
        "detail": if forked { crate::i18n::tr(&format!("{team} 팀 · 서버가 사람마다 다른 목록을 줄 때 생겨요"), &format!("{team} · happens when the server shows people different lists")).to_string() } else { crate::i18n::tr(&format!("{team} 팀 · {name}가 기기를 다 잃고 새로 시작했을 때 바뀌어요"), &format!("{team} · changes when {name} lost all devices and started over")).to_string() },
        "what": crate::i18n::tr("보안 번호", "Safety number"),
        "who": name, "code": p.number,
        // 번호를 셈한 사슬 — 받아들일 때 그대로여야(6차 리뷰), 갈림은 다시 받은 뒤에만
        "identity": p.identity, "head": p.head, "refetched": p.refetched,
        "yes": crate::i18n::tr("받아들이기", "Accept"), "no": crate::i18n::tr("막아 두기", "Keep blocked"), "options": [],
    })
}

/// 열린 카드 하나 — id 와 그 카드가 띄운 사슬(신원·머리·다시 받음)
struct Open {
    id: String,
    shown: (String, String, bool),
}

/// 아직 답하지 않은 보안 번호 카드(계정 → 카드)
fn open_cards(log: &str) -> HashMap<String, Open> {
    let mut m: HashMap<String, Open> = HashMap::new();
    for r in log.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        let id = r["id"].as_str().unwrap_or_default().to_string();
        match r["type"].as_str() {
            Some("ask") if r["sub"] == SAFETY_SUB => {
                if let Some(a) = r["acct"].as_str() {
                    let s = |k: &str| r[k].as_str().unwrap_or("").to_string();
                    m.insert(a.to_string(), Open { id, shown: (s("identity"), s("head"), r["refetched"] == true) });
                }
            }
            Some("answer" | "done" | "cancel") => m.retain(|_, c| c.id != id),
            _ => {}
        }
    }
    m
}

/// 그 사람의 열린 카드 id — 대화 화면 '확인'이 같은 카드 답 문으로 가게
pub fn card_of(log: &str, account: &str) -> Option<String> {
    open_cards(log).remove(account).map(|o| o.id)
}

pub struct Plan {
    pub open: Vec<Person>,
    pub close: Vec<String>,
}

fn needs_card(p: &Person) -> bool {
    matches!(p.state.as_str(), "changed" | "forked") && !p.blocked
}

/// 바뀜·갈림이고 막아 두지 않은 사람마다 카드 하나. 받아들여 졌거나(ok) 막아 둔 사람의 열린 카드는 닫기.
/// 카드가 띄운 사슬이 지금과 다르면(견주는 사이 또 바뀜·다시 받음) 닫고 새 번호로 다시 띄운다(6차 리뷰)
pub fn plan(log: &str, people: &[Person]) -> Plan {
    let cards = open_cards(log);
    let same = |p: &Person, o: &Open| o.shown == (p.identity.clone(), p.head.clone(), p.refetched);
    let open = people.iter().filter(|p| needs_card(p) && cards.get(&p.account).is_none_or(|o| !same(p, o))).cloned().collect();
    let mut close: Vec<String> = cards.iter().filter(|(a, o)| !people.iter().any(|p| &p.account == *a && needs_card(p) && same(p, o))).map(|(_, o)| o.id.clone()).collect();
    close.sort();
    Plan { open, close }
}

/// 기록을 사람 상태에 맞춘다 — 상태 파일·카드 기록만(망 안 씀). device_cards 바퀴가 같이 돈다
pub fn sync(dir: &Path) {
    let st = crate::team_relay::load_state(dir);
    let Some(me) = st.account.as_ref().map(|a| a.id.clone()) else { return };
    for (_, c) in open_cards(&crate::direct::direct_log()) {
        if !issued(&c.id) {
            crate::direct::close_link(&c.id, crate::i18n::tr("새 카드로 다시 띄워요", "Shown again as a new card"));
        }
    }
    let people = e2e_safety::people(dir, &me);
    let p = plan(&crate::direct::direct_log(), &people);
    // 닫기 먼저 — 같은 사람의 새 카드(새 번호)가 옛 카드와 겹치지 않게
    for c in &p.close {
        crate::direct::close_link(c, crate::i18n::tr("번호가 바뀌어 새 카드로 띄워요", "Number changed — shown as a new card"));
    }
    for x in &p.open {
        let team = st.teams.iter().find(|t| t.id == x.team).map(|t| t.name.clone()).unwrap_or_default();
        if let Ok(id) = crate::mobile_pair::random_hex(4) {
            if crate::direct::append_row(&safety_row(&id, x, &team, &crate::direct::chrono_now())).is_ok() {
                remember(&id);
            }
        }
    }
}

/// 이번에 앱이 띄운 카드 id — 기록 파일에 누가 줄을 지어 써도 그 카드로는 받아들이지 못하게(device_cards 와 같은 선)
static ISSUED: std::sync::LazyLock<std::sync::Mutex<std::collections::HashSet<String>>> = std::sync::LazyLock::new(Default::default);

pub(crate) fn remember(id: &str) {
    ISSUED.lock().unwrap_or_else(|e| e.into_inner()).insert(id.to_string());
}
fn issued(id: &str) -> bool {
    ISSUED.lock().unwrap_or_else(|e| e.into_inner()).contains(id)
}

/// 사람이 카드에서 누른 받아들이기·막아 두기(direct::answer 에서만). 받아들이면 그 사람 때문에 멈춘 말을 보낸다 — 사람이 쳤던 말은 사람 말 그대로
pub fn decide(ask: &Value, yes: bool) -> Result<(), String> {
    if ask["from"] != crate::direct::LINK_FROM || !issued(ask["id"].as_str().unwrap_or_default()) {
        return Err(crate::i18n::tr("이 카드는 지난 것이라 다시 띄울게요 — 잠시 뒤 새 카드에서 눌러 주세요", "This card is stale — a new one will appear shortly").into());
    }
    let acct = ask["acct"].as_str().filter(|a| !a.is_empty()).ok_or("no account")?;
    let dir = crate::config::data_dir();
    if !yes {
        return e2e_safety::block(dir, acct);
    }
    let s = |k: &str| ask[k].as_str().unwrap_or("").to_string();
    let held = match e2e_safety::accept(dir, acct, &s("identity"), &s("head")) {
        Ok(h) => h,
        Err(e) => {
            // 견주는 사이 사슬이 또 바뀌었다 — 이 카드는 닫고 새 번호로 다시 띄운다
            if e == e2e_safety::NEW_CARD {
                sync(dir);
            }
            return Err(e);
        }
    };
    let mut back = vec![];
    for h in held {
        let proof = h.human.then(crate::team_relay_ws::HumanProof::accepted);
        if let Err(e) = crate::team_relay_ws::send(dir, &h.room, &h.cid, &h.body, proof) {
            eprintln!("[보안 번호] 멈춘 말 다시 보내기 실패: {e}");
            back.push(h);
        }
    }
    // 못 보낸 말은 목록으로 되돌린다(6차 리뷰)
    e2e_safety::put_back(dir, back)?;
    // 받아들이기 전에 못 연·경고 붙은 말을 다시 연다(e2e_retry — 서명부터 다시)
    crate::e2e_retry::retry(dir, &crate::team_relay_keys::store(), &crate::team_relay::Curl);
    Ok(())
}

#[cfg(test)]
#[path = "e2e_cards_tests.rs"]
mod tests;
