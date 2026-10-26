//! 팀 설정 화면(메신저 머리 톱니·팀 아이콘 메뉴)이 더 쓰는 것 — 팀 이름 바꾸기·안 쓴 초대 보기/막기(팀장).
//! 나가기·빼기·팀장 바꾸기는 team_relay 의 leave·remove_member·set_role(팀 여러 개, scripts/team 과 같은 길)을 그대로 쓴다.
//! 서버 길: chammo-relay teams.ts(이름·초대)
use crate::accounts_store::Store;
use crate::team_relay::{call, device_keys, load_state, mutate_if, why, Http, TeamEntry, TeamState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

/// 안 쓴 초대 하나 — 코드 원문은 서버도 없다(해시 앞 12자로 구별)
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct OpenInvite {
    pub id: String,
    pub created_at: u64,
    pub expires_at: u64,
}

/// 고른 팀(빈 글 = 지금 팀)에 이 기기로 서명한 요청 하나
fn ask(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, method: &str, tail: &str, body: Option<&Value>) -> Result<(TeamState, TeamEntry, Value), String> {
    let st = load_state(dir);
    let t = st.team(team)?.clone();
    let k = device_keys(kc, &st)?;
    let (code, v) = call(http, &st.server, &k, Some(&st.device_id), method, &format!("/v0/teams/{}/{tail}", t.id), body)?;
    if code != 200 {
        return Err(why(code, &v));
    }
    Ok((st, t, v))
}

pub fn rename(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str, name: &str) -> Result<TeamState, String> {
    let name = crate::team_ui::name_ok(name).ok_or_else(|| crate::i18n::tr("팀 이름은 1~40자", "Team name: 1–40 characters").to_string())?;
    let (st, t, _) = ask(dir, kc, http, team, "POST", "name", Some(&json!({ "name": name })))?;
    mutate_if(dir, &st.device_id, |s| s.put_team(TeamEntry { name, ..t }))
}

pub fn invites(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<Vec<OpenInvite>, String> {
    let (_, _, v) = ask(dir, kc, http, team, "GET", "invites", None)?;
    Ok(serde_json::from_value(v["invites"].clone()).unwrap_or_default())
}

pub fn revoke_invites(dir: &Path, kc: &dyn Store, http: &dyn Http, team: &str) -> Result<u64, String> {
    let (_, _, v) = ask(dir, kc, http, team, "POST", "invites/revoke", Some(&json!({})))?;
    Ok(v["revoked"].as_u64().unwrap_or(0))
}

#[cfg(test)]
#[path = "team_manage_tests.rs"]
mod tests;
