//! 종단 암호 기기 흐름 — chammo-relay ADR 0007, 계획 2026-10-24 e2e-multiteam §2.5.
//! - 로그인 때 받는 열쇠·묶기 서명·봉인 cP 를 같이 올린다(nP 는 이 기기 e2e.json 에만)
//! - ensure: 받는 열쇠를 안 올린 옛 기기는 올리고, 계정에 사슬이 없으면 NeedStart — 사슬 시작(genesis)은 사람이 '첫 기기' 단추를 눌렀을 때만(start_chain, R8)
//! - 새 기기 쪽(my_number): 사슬 기기가 낸 nM 을 받은 뒤에만 nP 를 열고 6자리를 셈한다
//! - 허용 기기 쪽(card_open → card_number → approve_with_number): 사람이 카드를 열 때 nM 을 내고, 사람이 넣은 6자리가 맞을 때만 add 고리
//!   + 4자리 K 를 화면에 띄우고 확인 봉투(새 기기 받는 열쇠로 봉함)를 맡긴다
//! - 새 기기 쪽(confirm_code): 사람이 넣은 K 로 확인 봉투가 맞아야 내 계정 사슬에 처음 핀을 꽂는다(R7 — 숫자 확인은 허용 기기 쪽만 되니까)
//!   카드 열기·허용은 사람 손 길(화면 명령)에서만 부른다 — scripts/team·참모 길엔 없다(ADR 0014 과 같은 선)
use crate::accounts_store::Store;
use crate::e2e_chain::{self, approve_commit, approve_sas, link_hash, sha_b64, Link};
use crate::e2e_state::{self, Trust};
use crate::team_relay::{self as relay, DeviceName, Http};
use crate::team_relay_keys::DeviceKeys;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use serde_json::{json, Value};
use std::path::Path;

fn rand16() -> [u8; 16] {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("OS 난수");
    b
}

fn raw(s: &str) -> Result<Vec<u8>, String> {
    B64.decode(s).map_err(|_| "열쇠 모양이 틀렸어".to_string())
}

/// 새 nP 를 뽑아 이 기기에 적고 봉인 cP 를 돌려준다
fn fresh_commit(dir: &Path, k: &DeviceKeys) -> Result<String, String> {
    let n_p = rand16();
    e2e_state::mutate(dir, |s| {
        s.my_np = B64.encode(n_p);
        s.my_nm.clear();
        s.my_revealed = false;
        s.my_sas = Default::default();
        // confirm_failed 는 안 지운다 — 4자리가 틀린 흐름은 '숫자 다시'로 못 풀고 다시 로그인부터(R7)
    })?;
    Ok(approve_commit(&raw(&k.public())?, &raw(&k.e2e_public())?, &n_p))
}

/// 로그인 끝(finish)에 같이 싣는 칸
pub fn login_fields(dir: &Path, k: &DeviceKeys) -> Result<Value, String> {
    // 새 로그인 = 새 허용 흐름 — 지난 흐름(4자리 틀림 등)을 지운다
    e2e_state::reset_self(dir, None)?;
    Ok(json!({ "e2ePub": k.e2e_public(), "e2eSig": k.e2e_key_sig(), "approveCommit": fresh_commit(dir, k)? }))
}

#[derive(Debug, PartialEq)]
pub enum Status {
    /// 로그인 전
    Off,
    /// 사슬에 들었다 — 봉투로 주고받는다
    InChain,
    /// 사슬 밖 — 다른 내 기기에서 숫자 확인을 기다린다
    Waiting,
    /// 사슬엔 들었다 — 다른 기기에 뜬 4자리를 넣어야 내 사슬을 믿는다(R7)
    NeedCode,
    /// 계정에 사슬이 없다 — 사람이 '이 기기가 첫 기기'를 눌러야 시작한다(R8)
    NeedStart,
    /// 사슬 밖인데 안 끊긴 사슬 기기가 하나도 없다 — 허용해 줄 기기가 없으니 사람이 '이 기기로 다시 시작'을 눌러야 한다(계정 되찾기 갈래 ①)
    NeedReset,
    /// 24시간 auto 허용 기기인데 사슬 기기가 하나도 없다 — 다시 시작은 서버가 막으니(숨은 탈취자 기기) 로그아웃 뒤 다시 로그인(10-26)
    NeedRelogin,
}

fn post(dir: &Path, kc: &dyn Store, http: &dyn Http, path: &str, body: Value) -> Result<(u16, Value), String> {
    let st = relay::load_state(dir);
    let k = relay::device_keys(kc, &st)?;
    relay::call(http, &st.server, &k, Some(&st.device_id), "POST", path, Some(&body))
}

fn my_rows(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<Vec<DeviceName>, String> {
    let st = relay::load_state(dir);
    let k = relay::device_keys(kc, &st)?;
    let (code, v) = relay::call(http, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/devices", None)?;
    if code != 200 {
        return Err(relay::why(code, &v));
    }
    Ok(relay::device_rows(&v["devices"]))
}

/// 종단 암호 준비 — 받는 열쇠 올리기·사슬 시작. 몇 번 불러도 같다(방 찾기와 같이 돈다)
pub fn ensure(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<Status, String> {
    let st = relay::load_state(dir);
    let Some(acc) = st.account.as_ref().map(|a| a.id.clone()) else { return Ok(Status::Off) };
    if st.pending {
        return Ok(Status::Waiting);
    }
    let k = relay::device_keys(kc, &st)?;
    let rows = my_rows(dir, kc, http)?;
    let me = rows.iter().find(|d| d.current).cloned().ok_or("내 기기 줄이 없어")?;
    if me.e2e_pub.is_empty() {
        let (code, v) = post(dir, kc, http, "/v0/me/e2e", json!({ "e2ePub": k.e2e_public(), "e2eSig": k.e2e_key_sig() }))?;
        if code != 200 {
            return Err(relay::why(code, &v));
        }
    } else if me.e2e_pub != k.e2e_public() {
        return Err("서버에 적힌 이 기기 받는 열쇠가 이 기기 열쇠와 달라 — 다시 로그인해 줘".into());
    }
    let trust = e2e_state::chain_of(dir, kc, http, &st, &acc, true)?;
    // 허용해 줄 기기가 없다 — 서버 목록(끊긴 기기는 안 나온다)에 사슬 기기가 하나도 없고, 이 기기는 사람이 허용했거나 계정 첫 기기.
    // 24시간 auto 기기는 다시 시작을 못 한다(숨은 탈취자 기기가 먼저 신원을 가져가지 않게, 10-26 공격 리뷰) — 다시 로그인을 묻는다
    let in_mine = matches!(&trust, Trust::Ok(c) | Trust::Unconfirmed(c) if c.devices.contains_key(&st.device_id));
    let none_left = matches!(trust, Trust::Ok(_) | Trust::Unconfirmed(_)) && !in_mine && !rows.iter().any(|d| d.in_chain);
    let lost_all = none_left && me.approved_by != "auto";
    let relogin = none_left && me.approved_by == "auto";
    e2e_state::mutate(dir, |s| {
        s.no_chain = trust == Trust::NoChain;
        s.need_reset = lost_all;
        s.relogin = relogin;
        s.outside = false;
        s.ensured = true;
    })?;
    if lost_all {
        return Ok(Status::NeedReset);
    }
    if relogin {
        return Ok(Status::NeedRelogin);
    }
    let has_chain = matches!(&trust, Trust::Ok(_) | Trust::Unconfirmed(_));
    match trust {
        Trust::Ok(c) if c.devices.contains_key(&st.device_id) => return Ok(Status::InChain),
        Trust::Unconfirmed(c) if c.devices.contains_key(&st.device_id) => return Ok(Status::NeedCode),
        Trust::Changed(_) | Trust::Forked => return Err(e2e_state::MY_CHAIN_CHANGED.into()),
        // 사슬이 없는 계정 — 서버 말만 믿고 스스로 시작하지 않는다. 사람이 '첫 기기'를 누를 때까지(R8). 24시간 자동 허용 기기는 시작 못 한다
        Trust::NoChain if me.approved_by != "auto" => return Ok(Status::NeedStart),
        _ => {}
    }
    // 사슬 밖 — 봉인이 없으면 올려 두고 카드를 기다린다
    if me.approve_commit.is_empty() || e2e_state::load(dir).my_np.is_empty() {
        let (code, v) = post(dir, kc, http, "/v0/me/self/commit", json!({ "approveCommit": fresh_commit(dir, &k)? }))?;
        if code != 200 {
            return Err(relay::why(code, &v));
        }
    }
    // 허용된 사슬 밖 기기 — 사슬 기기 어디서든 '내 기기 확인' 카드가 뜨고, 이 기기는 숫자 대기 화면(10-26 어디서든 허용).
    // 사슬 없는 계정의 auto 기기는 첫 기기가 시작할 때까지 화면 없이 기다린다
    e2e_state::mutate(dir, |s| s.outside = has_chain)?;
    Ok(Status::Waiting)
}

/// 사람이 '이 기기가 첫 기기'를 눌렀다 — 계정 사슬을 시작한다(genesis, R8). 화면 명령(사람 손 길)에서만 부른다.
/// 서버가 '사슬 없음'이라고 거짓말해도 자기 열쇠만 든 사슬이라 남의 열쇠를 믿게 되진 않는다 — 사람이 '이미 쓰던 기기가 있으면 누르지 말기'를 보고 고른다
pub fn start_chain(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<(), String> {
    let st = relay::load_state(dir);
    let acc = st.account.as_ref().map(|a| a.id.clone()).ok_or("로그인 전이야")?;
    if st.pending {
        return Err("허용을 기다리는 기기는 시작할 수 없어".into());
    }
    let me = my_rows(dir, kc, http)?.into_iter().find(|d| d.current).ok_or("내 기기 줄이 없어")?;
    if me.approved_by == "auto" {
        return Err("24시간 자동 허용된 기기는 시작할 수 없어 — 다른 기기에서 허용받아 줘".into());
    }
    if !matches!(e2e_state::chain_of(dir, kc, http, &st, &acc, true)?, Trust::NoChain) {
        return Err("이 계정엔 이미 기기 사슬이 있어 — 쓰던 기기에서 허용받아 줘".into());
    }
    let k = relay::device_keys(kc, &st)?;
    let body = json!({ "v": 1, "account": acc, "seq": 0, "prev": "", "by": st.device_id, "kind": "genesis", "device": st.device_id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    let link = json!({ "body": body, "sig": k.sign(&format!("chammo-chain/1\n{body}")) });
    let (code, v) = post(dir, kc, http, "/v0/me/chain", json!({ "link": link }))?;
    if code != 201 {
        return Err(if code == 409 { "다른 기기가 먼저 시작했어 — 그 기기에서 허용받아 줘".into() } else { relay::why(code, &v) });
    }
    // 시작한 사슬을 받아 적는다(내가 시작한 사슬이라 바로 핀) — 안 적으면 팀 명부 고리를 안 쓴다(로컬 종단 시험 10-24)
    e2e_state::chain_of(dir, kc, http, &st, &acc, true)?;
    e2e_state::mutate(dir, |s| s.no_chain = false)
}

/// 사람이 '이 기기로 다시 시작'을 눌렀다 — 계정 되찾기 갈래 ①(계획 2026-10-26-e2e-recover). 화면 명령(사람 손 길)에서만 부른다.
/// 안 끊긴 사슬 기기가 하나도 없을 때만 — 새 신원이라 팀원에겐 보안 번호 바뀜이 뜬다(털린 서버가 '다 끊김'이라 속여도 거기서 막힌다)
pub fn reset_chain(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<(), String> {
    let st = relay::load_state(dir);
    let acc = st.account.as_ref().map(|a| a.id.clone()).ok_or("로그인 전이야")?;
    if st.pending {
        return Err("허용을 기다리는 기기는 다시 시작할 수 없어".into());
    }
    let rows = my_rows(dir, kc, http)?;
    let me = rows.iter().find(|d| d.current).ok_or("내 기기 줄이 없어")?;
    if me.approved_by == "auto" {
        return Err("24시간 자동 허용된 기기는 다시 시작할 수 없어 — 로그아웃 뒤 다시 로그인해 줘".into());
    }
    if rows.iter().any(|d| d.in_chain) {
        return Err("아직 쓰는 내 기기가 있어요 — 그 기기에서 허용받아 주세요".into());
    }
    let k = relay::device_keys(kc, &st)?;
    let (_, c) = fetch_chain(dir, kc, http, &acc)?;
    if c.devices.contains_key(&st.device_id) {
        return Err("이 기기는 이미 사슬에 들어 있어".into());
    }
    let seq = c.hashes.len() as u64;
    let body = json!({ "v": 1, "account": acc, "seq": seq, "prev": c.head(), "by": st.device_id, "kind": "reset", "device": st.device_id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    let link = json!({ "body": body, "sig": k.sign(&format!("chammo-chain/1\n{body}")) });
    let (code, v) = post(dir, kc, http, "/v0/me/chain", json!({ "link": link }))?;
    if code != 201 {
        return Err(if code == 409 && v["error"] == "stale_head" { "그새 기기 목록이 바뀌었어 — 다시 눌러 줘".into() } else { relay::why(code, &v) });
    }
    // 내가 서명한 reset 이라 바로 믿는다(e2e_state::chain_of — 신원 고리가 내 열쇠)
    e2e_state::chain_of(dir, kc, http, &st, &acc, true)?;
    e2e_state::mutate(dir, |s| s.need_reset = false)
}

// ── 계정 되찾기 갈래 ②(relay ADR 0007 R9) — 잃은 기기가 서버엔 살아 있을 때. 새 기기 8자리 → 사람이 웹에 손으로 → 48시간 → 여기서 마치기 ──

/// 혼동 글자 뺀 32자 8자리(relay recover.ts ALPHA) — 서버가 엉뚱한 글(주소 등)을 코드라고 줘도 화면에 안 띄운다
fn code_ok(c: &str) -> bool {
    c.len() == 8 && c.bytes().all(|b| b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(&b))
}

/// 새 기기 화면의 요청 코드 — (코드, 끝나는 때 ms). 화면 명령(사람 손 길)에서만
pub fn recover_code(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<(String, u64), String> {
    let (code, v) = post(dir, kc, http, "/v0/me/recover/code", json!({}))?;
    if code != 200 {
        return Err(if v["error"] == "recover_open" { crate::i18n::tr("이미 기다리는 다시 시작 요청이 있어요", "A restart request is already pending").into() } else { relay::why(code, &v) });
    }
    let c = v["code"].as_str().unwrap_or("");
    if !code_ok(c) {
        return Err("서버가 준 코드 모양이 틀렸어".into());
    }
    Ok((c.to_string(), v["expiresAt"].as_u64().unwrap_or(0)))
}

/// 기다리는 요청 취소 — 내 요청이면 내가 그만두기, 남의 요청이면 '내가 아니에요'(서버가 7일 새 요청을 막는다). 화면·카드 사람 손 길에서만
pub fn recover_cancel(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<(), String> {
    let (code, v) = post(dir, kc, http, "/v0/me/recover/cancel", json!({}))?;
    // 이미 끝났거나 다른 곳에서 취소됨(404·409) — 같은 결과
    if code != 200 && code != 404 && code != 409 {
        return Err(relay::why(code, &v));
    }
    let id = relay::load_state(dir).device_id;
    relay::mutate_if(dir, &id, |s| s.recover = None).map(|_| ())
}

/// 48시간이 찼다 — 사람이 '다시 시작 마치기'를 눌렀다. reset 고리를 이 기기가 서명해 서버 batch(옛 컴퓨터 끊기·허용·reset)에. 화면 명령에서만
pub fn recover_finish(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<(), String> {
    let st = relay::load_state(dir);
    let acc = st.account.as_ref().map(|a| a.id.clone()).ok_or("로그인 전이야")?;
    let r = st.recover.clone().filter(|r| r.mine).ok_or_else(|| crate::i18n::tr("기다리는 내 다시 시작 요청이 없어요", "No restart request from this device").to_string())?;
    if r.ready_at > now_ms() {
        return Err(crate::i18n::tr("아직 기다리는 중이에요", "Still waiting").into());
    }
    let k = relay::device_keys(kc, &st)?;
    let (_, c) = fetch_chain(dir, kc, http, &acc)?;
    let body = json!({ "v": 1, "account": acc, "seq": c.hashes.len() as u64, "prev": c.head(), "by": st.device_id, "kind": "reset", "device": st.device_id, "edPub": k.public(), "e2ePub": k.e2e_public() }).to_string();
    let link = json!({ "body": body, "sig": k.sign(&format!("chammo-chain/1\n{body}")) });
    let (code, v) = post(dir, kc, http, "/v0/me/recover/finish", json!({ "link": link }))?;
    if code != 200 {
        return Err(match (code, v["error"].as_str()) {
            (409, Some("stale_head")) => crate::i18n::tr("그새 기기 목록이 바뀌었어요 — 다시 눌러 주세요", "The device list just changed — press again").into(),
            (409, Some("no_request" | "not_waiting")) | (410, _) => crate::i18n::tr("요청이 취소됐거나 기한이 지났어요 — 처음부터 다시 해 주세요", "The request was cancelled or expired — start again").into(),
            _ => relay::why(code, &v),
        });
    }
    relay::mutate_if(dir, &st.device_id, |s| {
        s.pending = false;
        s.recover = None;
    })?;
    // 내가 서명한 reset 이라 바로 믿는다(e2e_state::chain_of — 신원 고리가 내 열쇠)
    e2e_state::chain_of(dir, kc, http, &st, &acc, true)?;
    e2e_state::mutate(dir, |s| {
        s.need_reset = false;
        s.outside = false;
    })
}

/// '숫자 다시' — 새 봉인(nM·nP 가 비워진다). 새 기기 화면 단추
pub fn renew(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<(), String> {
    let st = relay::load_state(dir);
    let k = relay::device_keys(kc, &st)?;
    let (code, v) = post(dir, kc, http, "/v0/me/self/commit", json!({ "approveCommit": fresh_commit(dir, &k)? }))?;
    if code == 200 { Ok(()) } else { Err(relay::why(code, &v)) }
}

/// 새 기기 쪽 — 사슬 기기가 카드를 열어 nM 이 왔으면 nP 를 열고 6자리. 아직이면 None
pub fn my_number(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<Option<u32>, String> {
    let st = relay::load_state(dir);
    let k = relay::device_keys(kc, &st)?;
    let acc = st.account.as_ref().map(|a| a.id.clone()).ok_or("로그인 전이야")?;
    let (code, v) = relay::call(http, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/self", None)?;
    if code != 200 {
        return Err(relay::why(code, &v));
    }
    let Some(n_m) = v["approveNonce"].as_str().filter(|s| !s.is_empty()) else { return Ok(None) };
    let store = e2e_state::load(dir);
    let n_p = store.my_np;
    if n_p.is_empty() {
        return Err("이 기기의 봉인 값이 없어 — '숫자 다시'를 눌러 줘".into());
    }
    // R4(ADR 0007) — nP 를 처음 보낸 그 nM 하나에만 숫자를 낸다. nM 은 보내기 '전에' 적는다:
    // 서버는 응답과 무관하게 본문에서 nP 를 보니, 실패(500)를 주고 nM 을 바꿔 갈아 맞추는 것을 막는다(2차 리뷰 치명 1)
    // R7 — 숫자에 넣을 내 계정 사슬(신원·머리)도 그때 한 번 받아 같이 적는다. 핀은 안 꽂는다(4자리 확인 뒤에)
    if store.my_nm.is_empty() {
        let c = fetch_chain(dir, kc, http, &acc)?.1;
        e2e_state::mutate(dir, |s| {
            s.my_nm = n_m.to_string();
            s.my_sas = e2e_state::SasSeen { identity: c.identity.clone(), head: c.head() };
        })?;
    } else if store.my_nm != n_m {
        return Err("숫자가 바뀌었어 — 이 기기에서 '숫자 다시'를 눌러 처음부터".into());
    }
    let sas = e2e_state::load(dir).my_sas;
    if !store.my_revealed {
        let (code, v) = post(dir, kc, http, "/v0/me/self/reveal", json!({ "nP": n_p }))?;
        // 이미 열었으면(409 revealed) 그대로. 실패면 같은 nM 으로만 다음에 다시
        if code != 200 && !(code == 409 && v["error"] == "revealed") {
            return Err(relay::why(code, &v));
        }
        e2e_state::mutate(dir, |s| s.my_revealed = true)?;
    }
    Ok(Some(approve_sas(&acc, &st.device_id, &raw(&k.public())?, &raw(&k.e2e_public())?, &raw(&n_p)?, &raw(n_m)?, &sas.identity, &sas.head)))
}

/// 로그인 화면 단계 — relogin(봉인 없이 대기·사슬 기기 0 인 auto 기기 — 다시 로그인) / outside(허용됐지만 사슬 밖 — 숫자 대기) / checking(계정은 있는데 내 계정 핀이 없고 ensure 전 — 화면이 정해질 때까지 다시 묻는다) / start(사슬 없는 계정, '첫 기기' 단추, R8) / need(허용됐고 4자리를 넣어야, R7) / failed(4자리가 틀려 처음부터) / ""(할 것 없음). 망 안 씀
pub fn self_step(dir: &Path) -> &'static str {
    let st = relay::load_state(dir);
    let Some(acc) = st.account.as_ref().map(|a| a.id.clone()) else { return "" };
    let s = e2e_state::load(dir);
    // 서버가 이 기기를 끊었거나 지웠다(4001·열쇠 확인 404) — 로그인돼 보여도 아무것도 안 되니 다시 로그인(10-28 윈도우)
    if st.revoked {
        return "relogin";
    }
    // 이 기기가 낸 다시 시작 요청 — 기다림·마치기(relay ADR 0007 R9). 숫자 대기보다 앞(잃은 기기는 숫자를 띄울 수 없다)
    if let Some(r) = st.recover.as_ref().filter(|r| r.mine && !s.pins.contains_key(&acc)) {
        return if r.ready_at <= now_ms() { "recover-ready" } else { "recover-wait" };
    }
    if s.confirm_failed {
        "failed"
    } else if !s.pins.contains_key(&acc) && ((st.pending && s.my_np.is_empty()) || (!st.pending && s.relogin)) {
        // 봉인(nP) 없이 대기 — 옛 판(0.4.1) 로그인은 받는 열쇠·봉인을 안 올렸고 대기 기기는 올릴 길도 없어 숫자가 영영 안 뜬다(10-26 아이맥),
        // 또는 사슬 기기가 하나도 없는 auto 기기(다시 시작 금지) → 다시 로그인
        "relogin"
    } else if !st.pending && s.no_chain && !s.pins.contains_key(&acc) {
        "start"
    } else if !st.pending && s.need_reset && !s.pins.contains_key(&acc) {
        "reset"
    } else if !st.pending && !s.ensured && !s.pins.contains_key(&acc) {
        "checking"
    } else if !st.pending && !s.my_sas.identity.is_empty() && !s.pins.contains_key(&acc) {
        "need"
    } else if !st.pending && s.outside && !s.pins.contains_key(&acc) {
        "outside"
    } else {
        ""
    }
}

/// 내 계정 사슬을 서버에서 받아 검증만(핀·캐시 없이)
fn fetch_chain(dir: &Path, kc: &dyn Store, http: &dyn Http, acc: &str) -> Result<(Vec<Link>, e2e_chain::Chain), String> {
    let st = relay::load_state(dir);
    let k = relay::device_keys(kc, &st)?;
    let (code, v) = relay::call(http, &st.server, &k, Some(&st.device_id), "GET", &format!("/v0/accounts/{acc}/chain"), None)?;
    if code != 200 {
        return Err(relay::why(code, &v));
    }
    let links: Vec<Link> = serde_json::from_value(v["links"].clone()).map_err(|e| e.to_string())?;
    if links.is_empty() {
        return Err("내 계정 사슬을 못 받았어 — 잠시 뒤 다시".into());
    }
    let c = e2e_chain::verify(acc, &links).map_err(|e| format!("내 계정 사슬이 틀렸어: {e:?}"))?;
    Ok((links, c))
}

const CONFIRM_INFO: &str = "chammo-approve-confirm/1";

/// 4자리 확인값 — 확인 봉투 안에만 있다(서버는 봉투를 못 열어 K 를 하나씩 맞춰 볼 수 없다)
fn confirm_mac(acc: &str, dev: &str, identity: &str, head: &str, k: &str, n_p: &[u8], n_m: &[u8]) -> String {
    sha_b64(&[format!("{CONFIRM_INFO}\n{acc}\n{dev}\n{identity}\n{head}\n{k}\n").as_bytes(), n_p, n_m])
}

/// 확인 봉투 — 새 기기 받는 열쇠로 HPKE. {신원·add 뒤 머리·확인값}
#[allow(clippy::too_many_arguments)]
pub(crate) fn seal_confirm(e2e_pub: &str, acc: &str, dev: &str, identity: &str, head: &str, k: &str, n_p: &str, n_m: &str) -> Result<String, String> {
    let pt = json!({ "identity": identity, "head": head, "mac": confirm_mac(acc, dev, identity, head, k, &raw(n_p)?, &raw(n_m)?) }).to_string();
    let (enc, ct) = crate::e2e_hpke::seal(&raw(e2e_pub)?, format!("{CONFIRM_INFO}\n{acc}\n{dev}").as_bytes(), b"", pt.as_bytes()).map_err(|e| format!("확인 봉투를 못 만들었어: {e:?}"))?;
    Ok(json!({ "v": 1, "enc": B64.encode(enc), "ct": B64.encode(ct) }).to_string())
}

/// 새 기기 쪽 — 사람이 넣은 4자리로 확인 봉투를 확인하고, 맞으면 그 머리까지의 내 계정 사슬에 처음 핀을 꽂는다(R7).
/// 틀리면 그 흐름은 끝(다시 로그인부터) — 서버가 봉투를 바꿔치기해도 사람이 넣는 K 를 모른다
pub fn confirm_code(dir: &Path, kc: &dyn Store, http: &dyn Http, typed: &str) -> Result<(), String> {
    const DONE: &str = "4자리 확인이 실패한 흐름이야 — 처음부터(로그아웃 뒤 다시 로그인) 해 줘";
    let st = relay::load_state(dir);
    let acc = st.account.as_ref().map(|a| a.id.clone()).ok_or("로그인 전이야")?;
    let store = e2e_state::load(dir);
    if store.confirm_failed {
        return Err(DONE.into());
    }
    let sas = store.my_sas.clone();
    if sas.identity.is_empty() {
        return Err("이 기기에서 숫자를 띄운 적이 없어 — 다시 로그인부터".into());
    }
    let k = relay::device_keys(kc, &st)?;
    let (code, v) = relay::call(http, &st.server, &k, Some(&st.device_id), "GET", "/v0/me/self", None)?;
    if code != 200 {
        return Err(relay::why(code, &v));
    }
    let Some(sealed) = v["approveConfirm"].as_str().filter(|s| !s.is_empty()) else { return Err("다른 기기에서 아직 허용 전이야".into()) };
    let digits: String = typed.chars().filter(|c| c.is_ascii_digit()).collect();
    let fail = || -> Result<(), String> {
        e2e_state::mutate(dir, |s| s.confirm_failed = true)?;
        Err("4자리가 달라요 — 안전하게 처음부터 다시 해요".into())
    };
    let opened = (|| {
        let o: Value = serde_json::from_str(sealed).ok()?;
        let dec = |f: &str| o[f].as_str().and_then(|x| B64.decode(x).ok());
        let pt = crate::e2e_hpke::open(&k.e2e_secret(), &dec("enc")?, format!("{CONFIRM_INFO}\n{acc}\n{}", st.device_id).as_bytes(), b"", &dec("ct")?).ok()?;
        serde_json::from_slice::<Value>(&pt).ok()
    })();
    let Some(p) = opened else { return fail() };
    let (identity, head) = (p["identity"].as_str().unwrap_or(""), p["head"].as_str().unwrap_or(""));
    let want = confirm_mac(&acc, &st.device_id, identity, head, &digits, &raw(&store.my_np)?, &raw(&store.my_nm)?);
    if digits.len() != 4 || identity != sas.identity || p["mac"].as_str() != Some(want.as_str()) {
        return fail();
    }
    // 확인한 머리까지 — 숫자를 띄운 그 머리 뒤에 내 열쇠 그대로 들어 있어야
    let (links, c) = fetch_chain(dir, kc, http, &acc)?;
    let at = |h: &str| c.hashes.iter().position(|x| x == h);
    let (Some(from), Some(to)) = (at(&sas.head), at(head)) else { return Err("서버 사슬이 확인한 것과 달라 — 서버를 의심해".into()) };
    let upto = e2e_chain::verify(&acc, &links[..=to]).map_err(|e| format!("{e:?}"))?;
    let me = upto.devices.get(&st.device_id);
    if c.identity != sas.identity || to <= from || me.is_none_or(|d| d.ed != k.public() || d.e2e != k.e2e_public()) {
        return Err("서버 사슬이 확인한 것과 달라 — 서버를 의심해".into());
    }
    e2e_state::pin_first(dir, &acc, links, identity, to as u64, head)?;
    e2e_state::mutate(dir, |s| {
        s.my_np.clear();
        s.my_sas = Default::default();
    })
}

/// 허용 기기 쪽 — 사람이 카드 숫자 칸을 눌렀다(e2e_cmd claim): 이 기기가 nM 을 뽑아 낸다(카드 하나에 하나, 다른 카드가 먼저면 busy)
pub fn card_open(dir: &Path, kc: &dyn Store, http: &dyn Http, target: &str) -> Result<(), String> {
    // nM 을 내기 전에 새 기기 봉인·열쇠를 적어 둔다 — 그 뒤 서버가 바꿔 보여 주면 숫자를 안 낸다(R4)
    let t = target_row(dir, kc, http, target)?;
    let store = e2e_state::load(dir);
    // 같은 카드(같은 봉인, 서버의 nM 이 내 것)면 그대로. 새 기기가 '숫자 다시'로 봉인을 바꿨으면(nM 비워짐) 새 nM 으로 다시 연다(2차 리뷰 중간 5)
    if let (Some(nm), Some(seen)) = (store.card_nm.get(target), store.card_seen.get(target)) {
        if seen.commit == t.approve_commit && !seen.head.is_empty() && (t.approve_nonce.is_empty() || &t.approve_nonce == nm) {
            return Ok(());
        }
    }
    if t.approve_commit.is_empty() || t.public_key.is_empty() || t.e2e_pub.is_empty() {
        return Err("새 기기가 아직 봉인을 안 올렸어 — 잠시 뒤 다시".into());
    }
    // 내 사슬 신원·머리도 지금 것으로 적는다 — 숫자에 들어간다(R7)
    let mine = my_trusted_chain(dir, kc, http)?;
    let seen = e2e_state::CardSeen { commit: t.approve_commit.clone(), ed: t.public_key.clone(), e2e: t.e2e_pub.clone(), identity: mine.identity.clone(), head: mine.head() };
    let n_m = B64.encode(rand16());
    let (code, v) = post(dir, kc, http, &format!("/v0/me/devices/{target}/nonce"), json!({ "nM": n_m }))?;
    match code {
        200 => e2e_state::mutate(dir, |s| {
            s.card_nm.insert(target.into(), n_m);
            s.card_seen.insert(target.into(), seen);
        }),
        409 if v["error"] == "busy" => Err("다른 기기에서 이 기기를 확인하고 있어요 — 그 기기 카드로 하거나, 새 기기에서 '숫자 다시'를 누른 뒤 여기 칸을 다시 눌러 주세요".into()),
        _ => Err(relay::why(code, &v)),
    }
}

/// 이 기기가 든, 핀이 ok 인 내 사슬(새로 받아) — 허용은 이 사슬로만
fn my_trusted_chain(dir: &Path, kc: &dyn Store, http: &dyn Http) -> Result<e2e_chain::Chain, String> {
    let st = relay::load_state(dir);
    let acc = st.account.as_ref().map(|a| a.id.clone()).ok_or("로그인 전이야")?;
    match e2e_state::chain_of(dir, kc, http, &st, &acc, true)? {
        Trust::Ok(c) if c.devices.contains_key(&st.device_id) => Ok(c),
        Trust::Changed(_) | Trust::Forked => Err(e2e_state::MY_CHAIN_CHANGED.into()),
        _ => Err("이 기기가 사슬 밖이라 허용할 수 없어".into()),
    }
}

fn target_row(dir: &Path, kc: &dyn Store, http: &dyn Http, target: &str) -> Result<DeviceName, String> {
    my_rows(dir, kc, http)?.into_iter().find(|d| d.id == target).ok_or_else(|| "그 기기가 목록에 없어".to_string())
}

/// 허용 기기 쪽 — 새 기기가 nP 를 열었으면 6자리. 서버가 준 nM 이 내가 낸 것과 다르면(다른 카드·바꿔치기) Err
pub fn card_number(dir: &Path, kc: &dyn Store, http: &dyn Http, target: &str) -> Result<Option<u32>, String> {
    let st = relay::load_state(dir);
    let acc = st.account.as_ref().map(|a| a.id.clone()).ok_or("로그인 전이야")?;
    let store = e2e_state::load(dir);
    let n_m = store.card_nm.get(target).cloned().ok_or("카드를 먼저 열어 줘")?;
    let seen = store.card_seen.get(target).cloned().ok_or("카드를 먼저 열어 줘")?;
    let t = target_row(dir, kc, http, target)?;
    if (t.approve_commit.as_str(), t.public_key.as_str(), t.e2e_pub.as_str()) != (seen.commit.as_str(), seen.ed.as_str(), seen.e2e.as_str()) {
        return Err("카드를 연 뒤 새 기기 열쇠·봉인이 바뀌었어 — 거절해 줘".into());
    }
    if t.approve_reveal.is_empty() {
        return Ok(None);
    }
    if t.approve_nonce != n_m {
        return Err("다른 카드가 이 기기를 확인하고 있어".into());
    }
    let (ed, e2e, n_p) = (raw(&t.public_key)?, raw(&t.e2e_pub)?, raw(&t.approve_reveal)?);
    if approve_commit(&ed, &e2e, &n_p) != t.approve_commit {
        return Err("새 기기 봉인과 연 값이 안 맞아 — 거절해 줘".into());
    }
    Ok(Some(approve_sas(&acc, target, &ed, &e2e, &n_p, &raw(&n_m)?, &seen.identity, &seen.head)))
}

/// 허용 기기 쪽 — 사람이 넣은 6자리가 맞으면 add 고리를 서명해 허용(대기 기기) 또는 믿어 주기(자동 허용된 사슬 밖 기기).
/// 돌려주는 4자리 K 를 화면에 띄운다 — 사람이 새 기기에 넣는다(R7)
pub fn approve_with_number(dir: &Path, kc: &dyn Store, http: &dyn Http, target: &str, typed: &str) -> Result<String, String> {
    let digits: String = typed.chars().filter(|c| c.is_ascii_digit()).collect();
    let want = card_number(dir, kc, http, target)?.ok_or("새 기기 화면에 아직 숫자가 안 떴어")?;
    if digits != format!("{want:06}") {
        return Err("숫자가 달라요 — 새 기기 화면을 다시 보세요. 내가 연 게 아니면 거절".into());
    }
    let st = relay::load_state(dir);
    let acc = st.account.as_ref().map(|a| a.id.clone()).ok_or("로그인 전이야")?;
    let c = my_trusted_chain(dir, kc, http)?;
    let store = e2e_state::load(dir);
    let (seen, n_m) = (store.card_seen.get(target).cloned().unwrap_or_default(), store.card_nm.get(target).cloned().unwrap_or_default());
    // 숫자에 넣은 내 사슬 그대로여야 — 그새 바뀌었으면 숫자가 그 사슬을 확인한 게 아니다
    if (c.identity.as_str(), c.head()) != (seen.identity.as_str(), seen.head.clone()) {
        e2e_state::mutate(dir, |s| {
            s.card_nm.remove(target);
            s.card_seen.remove(target);
        })?;
        return Err("카드를 연 뒤 내 기기 사슬이 바뀌었어 — 카드를 다시 열어 줘".into());
    }
    let t = target_row(dir, kc, http, target)?;
    // 확인 봉투의 nP 도 숫자를 셈한 그 봉인을 여는 값이어야
    if approve_commit(&raw(&seen.ed)?, &raw(&seen.e2e)?, &raw(&t.approve_reveal)?) != seen.commit {
        return Err("새 기기 봉인과 연 값이 안 맞아 — 거절해 줘".into());
    }
    let k = relay::device_keys(kc, &st)?;
    let body = json!({ "v": 1, "account": acc, "seq": c.hashes.len(), "prev": c.head(), "by": st.device_id, "at": now_ms(),
        "kind": "add", "device": target, "edPub": t.public_key, "e2ePub": t.e2e_pub, "selfSig": t.e2e_sig }).to_string();
    let sig = k.sign(&format!("chammo-chain/1\n{body}"));
    let head = link_hash(&body, &sig);
    let link = json!({ "body": body, "sig": sig });
    // 4자리 K — 화면에만. 확인 봉투는 숫자로 확인한 새 기기 받는 열쇠(seen.e2e)로 봉한다
    let mut b = [0u8; 2];
    getrandom::fill(&mut b).expect("OS 난수");
    let code4 = format!("{:04}", u16::from_be_bytes(b) % 10_000);
    let sealed = seal_confirm(&seen.e2e, &acc, target, &c.identity, &head, &code4, &t.approve_reveal, &n_m)?;
    let (cc, cv) = post(dir, kc, http, &format!("/v0/me/devices/{target}/confirm"), json!({ "confirm": sealed }))?;
    if cc != 200 {
        return Err(relay::why(cc, &cv));
    }
    let (code, v) = if t.pending() {
        post(dir, kc, http, &format!("/v0/me/devices/{target}/approve"), json!({ "link": link }))?
    } else {
        post(dir, kc, http, "/v0/me/chain", json!({ "link": link }))?
    };
    if code != 200 && code != 201 {
        return Err(relay::why(code, &v));
    }
    e2e_state::mutate(dir, |s| {
        s.card_nm.remove(target);
        s.card_seen.remove(target);
    })?;
    Ok(code4)
}

/// 기기를 끊기 전에 사슬에서도 뺀다(remove 고리) — 이 기기가 사슬에 있고 그 기기도 사슬에 있을 때만. 끊기는 서버 문이 막고, 이건 남들이 봉투에서 빼게
pub fn remove_link(dir: &Path, kc: &dyn Store, http: &dyn Http, target: &str) -> Result<(), String> {
    let st = relay::load_state(dir);
    if !crate::e2e_team::in_chain(dir, &st) {
        return Ok(());
    }
    let acc = st.account.as_ref().map(|a| a.id.clone()).unwrap_or_default();
    let c = match e2e_state::chain_of(dir, kc, http, &st, &acc, true)? {
        Trust::Ok(c) if c.devices.contains_key(&st.device_id) && c.devices.contains_key(target) => c,
        // R5 — 내 사슬이 바뀌었으면(공격 중) 고리는 못 쓰지만 서버 끊기는 막지 않는다. 경고만
        Trust::Changed(_) | Trust::Forked => {
            eprintln!("[기기] {}: 고리 없이 끊는다", e2e_state::MY_CHAIN_CHANGED);
            return Ok(());
        }
        _ => return Ok(()),
    };
    let k = relay::device_keys(kc, &st)?;
    let body = json!({ "v": 1, "account": acc, "seq": c.hashes.len(), "prev": c.head(), "by": st.device_id, "at": now_ms(), "kind": "remove", "device": target }).to_string();
    let link = json!({ "body": body, "sig": k.sign(&format!("chammo-chain/1\n{body}")) });
    let (code, v) = post(dir, kc, http, "/v0/me/chain", json!({ "link": link }))?;
    if code == 201 { Ok(()) } else { Err(relay::why(code, &v)) }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
#[path = "e2e_flow_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "e2e_live_tests.rs"]
pub(crate) mod live;
