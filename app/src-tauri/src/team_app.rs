//! 팀 앱 엔진의 순수한 부분(chammo-relay ADR 0011, 첫 앱 = 팀 캘린더) — 기록 봉하기·서명 글·칸 합치기·열쇠 고르기.
//! 망·파일은 team_app_store 가 맡는다. 서버는 봉한 ct·서명·판 번호만 알고, 내용 합치기는 여기서 칸마다 3방향으로
use crate::e2e_chain::{sha_b64, verify_sig};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const APP_CAL: &str = "calendar";
/// 기록 안 '최근 고친 사람' 상한
pub const EDITS_MAX: usize = 20;
/// 고친 칸 셈에서 빼는 칸 — 기록 장부·만든 사람·모르는 칸 보관
const META: [&str; 3] = ["edits", "made", "x"];

/// 앱마다 갈라 쓰는 기록 열쇠 — 보관함 appkey 줄의 파일 열쇠 k 에서
pub fn item_key(k: &[u8; 32], team: &str, app: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    hkdf::Hkdf::<sha2::Sha256>::new(None, k).expand(format!("chammo-app/1\n{team}\n{app}").as_bytes(), &mut out).expect("32바이트는 늘 된다");
    out
}

fn aad(team: &str, app: &str, id: &str) -> Vec<u8> {
    format!("chammo-app-item/1\n{team}\n{app}\n{id}").into_bytes()
}

/// 봉하기 — base64url(nonce 12 ‖ AES-256-GCM)
pub fn seal(ik: &[u8; 32], team: &str, app: &str, id: &str, pt: &[u8]) -> String {
    let mut n = [0u8; 12];
    getrandom::fill(&mut n).expect("난수");
    let ct = Aes256Gcm::new(ik.into()).encrypt(Nonce::from_slice(&n), Payload { msg: pt, aad: &aad(team, app, id) }).expect("봉하기");
    let mut out = n.to_vec();
    out.extend(ct);
    B64.encode(out)
}

pub fn open(ik: &[u8; 32], team: &str, app: &str, id: &str, ct: &str) -> Result<Vec<u8>, String> {
    let b = B64.decode(ct).map_err(|_| "기록 모양이 틀렸어")?;
    if b.len() < 12 + 16 {
        return Err("기록이 너무 짧아".into());
    }
    Aes256Gcm::new(ik.into()).decrypt(Nonce::from_slice(&b[..12]), Payload { msg: &b[12..], aad: &aad(team, app, id) }).map_err(|_| "기록을 못 열었어".into())
}

/// 쓴 기기가 서명하는 글 — base(고치기 전 판)·열쇠 줄·ct 해시·지움까지 묶는다(서버가 옛 판을 새 것처럼 못 끼운다)
pub fn sig_text(team: &str, app: &str, id: &str, base: u64, key: &str, ct: &str, del: bool) -> String {
    format!("chammo-app/1\n{team}\n{app}\n{id}\n{base}\n{key}\n{}\n{}", sha_b64(&[ct.as_bytes()]), u8::from(del))
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct By {
    pub member: String,
    pub device: String,
}

/// 서버 줄 하나(chammo-relay src/apps.ts out())
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Remote {
    pub id: String,
    pub rev: u64,
    pub base: u64,
    pub key: String,
    pub ct: String,
    pub sig: String,
    pub by: By,
    pub at: u64,
    pub del: bool,
    pub deleted_at: Option<u64>,
}

/// 서명(사슬 기기) → 열쇠 → 열기 → JSON 객체
pub fn open_remote(r: &Remote, team: &str, app: &str, keys: &BTreeMap<String, [u8; 32]>, signers: &BTreeMap<String, String>) -> Result<Value, String> {
    let ed = signers.get(&r.by.device).ok_or("쓴 기기를 믿을 수 없어(팀 명부·사슬 밖)")?;
    if !verify_sig(ed, &sig_text(team, app, &r.id, r.base, &r.key, &r.ct, r.del), &r.sig) {
        return Err("쓴 기기 서명이 틀렸어".into());
    }
    let k = keys.get(&r.key).ok_or("이 기록 열쇠가 아직 없어 — 다른 팀원 앱이 켜지면 채워져")?;
    let pt = open(&item_key(k, team, app), team, app, &r.id, &r.ct)?;
    let v: Value = serde_json::from_slice(&pt).map_err(|_| "기록 안이 JSON 이 아니야")?;
    if !v.is_object() {
        return Err("기록 안이 객체가 아니야".into());
    }
    Ok(v)
}

/// 앱 열쇠 줄(보관함 kind appkey) — have = 봉투가 붙은 기기
#[derive(Clone, Debug, Default)]
pub struct KeyRow {
    pub id: String,
    pub have: Vec<String>,
    pub created_at: u64,
}

/// 쓸 열쇠 — 봉투 받은 기기가 다 지금 팀 받는 기기인 것 중 가장 새 것. 빠진 사람·끊긴 기기가 든 열쇠로는 안 쓴다(새로 든 기기는 봉투 더하기가 채운다)
pub fn pick_key(rows: &[KeyRow], recipients: &BTreeSet<String>) -> Option<String> {
    rows.iter().filter(|r| !r.have.is_empty() && r.have.iter().all(|d| recipients.contains(d))).max_by_key(|r| (r.created_at, r.id.clone())).map(|r| r.id.clone())
}

/// 내가 하려는 일
#[derive(Clone, Debug, PartialEq)]
pub enum Op {
    Put(Value),
    Del,
}

/// 서버의 지금 기록(풀어 둔 것)
#[derive(Clone, Debug, PartialEq)]
pub struct Now {
    pub data: Value,
    pub del: bool,
    pub by: String,
}

/// 합친 결과 — lost = 남의 고침을 덮은 칸('*' = 남이 방금 고친 일정을 지움), by = 그 사람
#[derive(Clone, Debug, PartialEq)]
pub enum Merge {
    Write { data: Value, del: bool, lost: Vec<String>, by: String },
    /// 남이 지운 일정 — 고침으로 몰래 되살리지 않는다(화면이 '다시 살리기'를 보여 준다)
    Gone { by: String },
}

fn obj(v: &Value) -> Map<String, Value> {
    v.as_object().cloned().unwrap_or_default()
}

/// 칸마다 3방향 합치기 — 같은 칸을 둘 다 고쳤으면 나중에 들어가는 내 쪽이 이긴다(서버 도착 차례). restore = 지운 일정 다시 살리기
pub fn merge(base: Option<&Value>, mine: &Op, now: &Now, restore: bool) -> Merge {
    let by = now.by.clone();
    match mine {
        Op::Del => {
            let touched = base.is_some_and(|b| strip(b) != strip(&now.data));
            Merge::Write { data: now.data.clone(), del: true, lost: if touched && !now.del { vec!["*".into()] } else { vec![] }, by }
        }
        Op::Put(m) => {
            if now.del && !restore {
                return Merge::Gone { by };
            }
            let (b, m, t) = (base.map(obj).unwrap_or_default(), obj(m), obj(&now.data));
            let mut out = Map::new();
            let mut lost = vec![];
            let keys: BTreeSet<&String> = b.keys().chain(m.keys()).chain(t.keys()).collect();
            for k in keys {
                let (bv, mv, tv) = (b.get(k), m.get(k), t.get(k));
                let pick = if META.contains(&k.as_str()) {
                    tv.or(mv)
                } else if mv == bv {
                    tv
                } else if tv == bv || tv == mv {
                    mv
                } else {
                    lost.push(k.clone());
                    mv
                };
                if let Some(v) = pick {
                    out.insert(k.clone(), v.clone());
                }
            }
            Merge::Write { data: Value::Object(out), del: false, lost, by }
        }
    }
}

/// 기록 장부를 뺀 내용 — '고쳤나' 견주기용
fn strip(v: &Value) -> Map<String, Value> {
    let mut m = obj(v);
    for k in META {
        m.remove(k);
    }
    m
}

/// 쓰기 전 도장 — 새 기록이면 made, 아니면 고친 칸을 edits 끝에(20번까지)
pub fn stamp(data: &mut Value, before: Option<&Value>, me: &str, now: u64) {
    let Some(m) = data.as_object_mut() else { return };
    match before {
        None => {
            m.insert("made".into(), json!({ "by": me, "at": now }));
            m.entry("edits").or_insert(json!([]));
        }
        Some(b) => {
            let (old, new) = (strip(b), strip(&Value::Object(m.clone())));
            let f: Vec<&String> = old.keys().chain(new.keys()).collect::<BTreeSet<_>>().into_iter().filter(|k| old.get(*k) != new.get(*k)).collect();
            if f.is_empty() {
                return;
            }
            let mut edits = m.get("edits").and_then(Value::as_array).cloned().unwrap_or_default();
            edits.push(json!({ "by": me, "at": now, "f": f }));
            let skip = edits.len().saturating_sub(EDITS_MAX);
            m.insert("edits".into(), Value::Array(edits.into_iter().skip(skip).collect()));
        }
    }
}

#[cfg(test)]
#[path = "team_app_tests.rs"]
mod tests;
