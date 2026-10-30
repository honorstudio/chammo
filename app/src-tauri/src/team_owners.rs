//! 팀장·매니저 권한 판정 — 서명된 팀 명부로만 (chammo-relay ADR 0014 R14, 2026-10-29).
//! 홈 판·고정 공지·팀 아이콘·커버·팀 참모 정의를 **남이 올린 것**으로 받아들이는 기준, 방 지우기 단추, 내가 팀장 일을 할 수 있나는
//! 서버 GET members 의 role(D1 값 — 표시용)이 아니라 여기서 낸 팀장 목록으로만 센다. 털린 서버가 role 한 칸을 바꿔 가짜 팀장을 만들지 못하게.
//! 명부를 새로 못 받으면(망·5xx·429 — '확인 안 됨') 마지막으로 확인해 둔 명부(디스크, 다시 검증)로 센다 — '팀장 아님'과 가른다(0.4.5 리뷰 3).
//! 확인해 둔 명부도 없거나 못 믿으면 빈 목록 — 아무도 팀장이 아니다(닫는 쪽).
use crate::accounts_store::Store;
use crate::team_relay::{self, Http};
use std::path::Path;

/// 그 항목(look·posts·agents·files·invite·kick, "all" = 팀장·전체 권한)을 할 수 있는 확인된 사람(멤버 id) — relay ADR 0014.
/// 명부는 1분 안에 받은 것을 다시 쓴다. 새로 못 받으면 마지막으로 확인한 명부, 그것도 없으면 빈 목록
pub fn holders(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, item: &str) -> Vec<String> {
    let st = team_relay::load_state(dir);
    if st.team(team).is_err() {
        return vec![];
    }
    crate::e2e_state::roster_recv(dir, kc, http, &st, team, false)
        .or_else(|_| crate::e2e_state::roster_cached(dir, kc, http, &st, team))
        .map(|r| r.holders(item))
        .unwrap_or_default()
}

/// 내(이 기기의 멤버)가 owners 안에 있나 — 멤버 id 가 비면(팀에 안 든 기기) 아니다
pub fn has(owners: &[String], member_id: &str) -> bool {
    !member_id.is_empty() && owners.iter().any(|o| o == member_id)
}

#[cfg(test)]
#[path = "team_owners_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "team_roles_live_tests.rs"]
mod live;
