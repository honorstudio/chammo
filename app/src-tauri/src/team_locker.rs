//! 팀 보관함·대화 파일 — chammo-relay ADR 0009. 파일을 이 기기에서 암호화해 중계(R2)에 올리고, 팀원 기기에서 내려 연다.
//! - 파일마다 무작위 열쇠 k. 본문은 8MiB 조각마다 AES-256-GCM(nonce = 0⁴‖조각 번호, AAD 에 팀·방·파일·번호·마지막 표시 — 순서 바꾸기·잘라 내기 막기)
//! - 이름·평문 크기·시각(meta)도 k 로 봉한다 — 서버는 암호문 크기·조각 수·누가·언제만 안다
//! - k 는 받는 기기마다 HPKE 봉투(서버 locker_keys). 받는 기기 = 팀 보관함이면 명부의 사람 사슬, 대화 파일이면 그 방 사람(메시지 봉투와 같은 목록)
//! - 올린 기기가 [팀·방·파일·kh·크기·조각 수·H(meta)] 에 서명 — 받는 쪽은 그 기기가 믿는 사슬에 든(든 적 있는) 기기인지, 푼 k 가 kh 와 같은지 본다
//! - 나중에 든 사람·기기 몫은 열 수 있는 기기가 봉투를 더한다(share_keys) — kh 대조가 있어 서명이 따로 필요 없다
use crate::e2e_chain::{sha_b64, verify_sig};
use crate::e2e_envelope::Recipient;
use crate::e2e_hpke;
use crate::team_relay_keys::DeviceKeys;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const CHUNK: usize = 8 * 1024 * 1024;
/// 조각 하나의 암호문 = 평문 8MiB + 태그 16
pub const PART: u64 = CHUNK as u64 + 16;

/// 채팅 메시지 봉투 안쪽(Inner.files)에 싣는 파일 참조 — 열쇠는 안 싣는다(서버 봉투로 받는다)
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileRef {
    pub id: String,
    pub team: String,
    pub room: String,
    pub name: String,
    /// 평문 바이트
    pub size: u64,
}

/// 봉한 이름·크기·시각
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Meta {
    pub name: String,
    pub size: u64,
    pub at: u64,
    /// 팀 보관함 폴더 경로('계약/10월', 빈 글 = 맨 위) — 이름과 같이 봉한다. 옛 앱(0.4.3)은 한 단계만 썼다 — 그 폴더는 그대로 맨 위 폴더
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub folder: String,
    /// 빈 폴더 표시 줄(0바이트, 이름 없음) — 폴더 이름이 서버에 안 보이게 봉한 meta 안에만. 보통 파일은 안 싣는다(옛 앱과 같은 모양)
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dir: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct KeyEnv {
    pub d: String,
    pub enc: String,
    pub w: String,
}

// ── 암호 핵심(네트워크 없음) ──

/// 평문 길이 → (조각 수, 암호문 크기). 빈 파일도 조각 하나(태그만)
pub fn shape(plain: u64) -> (u64, u64) {
    let parts = plain.div_ceil(CHUNK as u64).max(1);
    (parts, plain + 16 * parts)
}

fn rand<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("OS 난수");
    b
}

pub fn key_hash(k: &[u8]) -> String {
    sha_b64(&[b"chammo-locker-key/1", k])
}

fn chunk_nonce(i: u64) -> [u8; 12] {
    let mut n = [0u8; 12];
    n[4..].copy_from_slice(&i.to_be_bytes());
    n
}

fn chunk_aad(team: &str, room: &str, id: &str, i: u64, last: bool) -> Vec<u8> {
    format!("chammo-locker-chunk/1\n{team}\n{room}\n{id}\n{i}\n{}", u8::from(last)).into_bytes()
}

pub fn seal_chunk(k: &[u8; 32], team: &str, room: &str, id: &str, i: u64, last: bool, pt: &[u8]) -> Vec<u8> {
    Aes256Gcm::new(k.into()).encrypt(Nonce::from_slice(&chunk_nonce(i)), Payload { msg: pt, aad: &chunk_aad(team, room, id, i, last) }).expect("AES-GCM")
}

pub fn open_chunk(k: &[u8; 32], team: &str, room: &str, id: &str, i: u64, last: bool, ct: &[u8]) -> Result<Vec<u8>, String> {
    Aes256Gcm::new(k.into()).decrypt(Nonce::from_slice(&chunk_nonce(i)), Payload { msg: ct, aad: &chunk_aad(team, room, id, i, last) }).map_err(|_| format!("{i}번째 조각이 안 열려 — 바뀌었거나 순서가 틀렸어"))
}

fn meta_aad(team: &str, room: &str, id: &str) -> Vec<u8> {
    format!("chammo-locker-meta/1\n{team}\n{room}\n{id}").into_bytes()
}

pub fn seal_meta(k: &[u8; 32], team: &str, room: &str, id: &str, m: &Meta) -> (String, String) {
    let iv = rand::<12>();
    let pt = serde_json::to_vec(m).expect("meta JSON");
    let ct = Aes256Gcm::new(k.into()).encrypt(Nonce::from_slice(&iv), Payload { msg: &pt, aad: &meta_aad(team, room, id) }).expect("AES-GCM");
    (B64.encode(iv), B64.encode(ct))
}

pub fn open_meta(k: &[u8; 32], team: &str, room: &str, id: &str, iv: &str, ct: &str) -> Result<Meta, String> {
    let iv = B64.decode(iv).ok().filter(|v| v.len() == 12).ok_or("이름 봉인 모양이 틀렸어")?;
    let ct = B64.decode(ct).map_err(|_| "이름 봉인 모양이 틀렸어")?;
    let pt = Aes256Gcm::new(k.into()).decrypt(Nonce::from_slice(&iv), Payload { msg: &ct, aad: &meta_aad(team, room, id) }).map_err(|_| "이름이 안 열려")?;
    serde_json::from_slice(&pt).map_err(|_| "이름 모양이 틀렸어".into())
}

fn key_info(team: &str, room: &str, id: &str, device: &str) -> Vec<u8> {
    format!("chammo-locker/1\n{team}\n{room}\n{id}\n{device}").into_bytes()
}

pub fn seal_keys(k: &[u8; 32], team: &str, room: &str, id: &str, to: &[Recipient]) -> Result<Vec<KeyEnv>, String> {
    to.iter()
        .map(|r| {
            let pk = B64.decode(&r.e2e).map_err(|_| "받는 열쇠 모양이 틀렸어")?;
            let (enc, w) = e2e_hpke::seal(&pk, &key_info(team, room, id, &r.device), b"", k).map_err(|_| "받는 열쇠 모양이 틀렸어")?;
            Ok(KeyEnv { d: r.device.clone(), enc: B64.encode(enc), w: B64.encode(w) })
        })
        .collect()
}

pub fn open_key(keys: &DeviceKeys, me: &str, team: &str, room: &str, id: &str, enc: &str, w: &str, kh: &str) -> Result<[u8; 32], String> {
    let dec = |s: &str| B64.decode(s).map_err(|_| "봉투 모양이 틀렸어".to_string());
    let k = e2e_hpke::open(&keys.e2e_secret(), &dec(enc)?, &key_info(team, room, id, me), b"", &dec(w)?).map_err(|_| "내 몫 봉투가 안 열려")?;
    let k: [u8; 32] = k.try_into().map_err(|_| "열쇠 길이가 틀렸어")?;
    if key_hash(&k) != kh {
        return Err("열쇠가 올린 사람이 서명한 것과 달라".into());
    }
    Ok(k)
}

fn meta_hash(iv: &str, ct: &str) -> String {
    sha_b64(&[iv.as_bytes(), b".", ct.as_bytes()])
}

/// 파일 서명 — 이름(meta)은 안 넣는다(이름 서명이 따로, 이름을 바꿔도 이 서명은 그대로)
pub fn file_sig_text(team: &str, room: &str, id: &str, by: &str, kh: &str, size: u64, parts: u64) -> String {
    format!("chammo-locker/1\n{team}\n{room}\n{id}\n{by}\n{kh}\n{size}\n{parts}")
}

pub fn meta_sig_text(team: &str, room: &str, id: &str, by: &str, kh: &str, iv: &str, ct: &str) -> String {
    format!("chammo-locker-meta/1\n{team}\n{room}\n{id}\n{by}\n{kh}\n{}", meta_hash(iv, ct))
}

/// 팀원이 봉한 이름 → 파일 이름으로 쓸 글(경로 글자·제어 글자·앞 점 빼고 120자)
pub fn safe_file_name(name: &str) -> String {
    crate::locker_fs::safe_name(name, "파일")
}

/// 한 단계 이름(빗금은 -) — 팀 이름 폴더 같은 것. 팀 보관함 폴더 경로는 safe_path. '대화 파일'은 화면이 따로 쓰는 이름이라 못 쓴다
pub fn safe_folder(name: &str) -> String {
    let t = name.trim();
    if t.is_empty() {
        return String::new();
    }
    let f = crate::locker_fs::safe_name(t, "");
    if f == CHAT_FOLDER { format!("{f} 2") } else { f }
}

/// 폴더 경로 글자 상한 — 봉한 meta 암호문이 중계 상한(base64 4096자) 안에 들게(한글 3바이트 × 400 + 이름 120자)
pub const FOLDER_MAX: usize = 400;

/// 폴더 경로 — 빗금으로 나눈 칸마다 이름 규칙(경로 글자·앞 점 빼기), 빈 칸은 빠진다. 빈 글 = 맨 위.
/// 맨 위 첫 칸만 '대화 파일'을 피한다(내려받기 폴더에서 대화 파일 자리와 겹치지 않게)
pub fn safe_path(path: &str) -> String {
    let parts: Vec<String> = path.split('/').map(|p| crate::locker_fs::safe_name(p.trim(), "")).filter(|p| !p.is_empty()).collect();
    parts
        .into_iter()
        .enumerate()
        .map(|(i, p)| if i == 0 && p == CHAT_FOLDER { format!("{p} 2") } else { p })
        .collect::<Vec<_>>()
        .join("/")
}

/// 다듬은 경로가 상한 안인가
pub fn path_ok(path: &str) -> Result<(), String> {
    if path.chars().count() > FOLDER_MAX {
        return Err(format!("폴더 경로가 너무 길어 — {FOLDER_MAX}자 안으로"));
    }
    Ok(())
}

/// 위 폴더 — 'a/b/c' → 'a/b', 'a' → 맨 위
pub fn parent_of(path: &str) -> &str {
    path.rsplit_once('/').map(|(p, _)| p).unwrap_or("")
}

/// path 가 folder 이거나 그 안인가(맨 위는 폴더가 아니다)
pub fn under(path: &str, folder: &str) -> bool {
    !folder.is_empty() && (path == folder || path.strip_prefix(folder).is_some_and(|r| r.starts_with('/')))
}

/// 대화 파일 묶음 이름(화면·내려받기 폴더)
pub const CHAT_FOLDER: &str = "대화 파일";

// ── 서버 목록 ──

#[derive(Deserialize, Clone, Debug, Default)]
pub struct EncW {
    pub enc: String,
    pub w: String,
}

#[derive(Deserialize, Clone, Debug, Default)]
pub struct MetaCt {
    pub iv: String,
    pub ct: String,
}

#[derive(Deserialize, Clone, Debug, Default)]
pub struct By {
    pub member: String,
    pub device: String,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteFile {
    pub id: String,
    pub room: Option<String>,
    /// file | avatar(프로필 사진·팀 아이콘 — 보관함 화면엔 안 그린다)
    pub kind: String,
    pub state: String,
    pub size: u64,
    pub parts: u64,
    pub kh: String,
    pub sig: String,
    pub meta: MetaCt,
    pub meta_by: String,
    pub meta_sig: String,
    pub by: By,
    pub created_at: u64,
    pub updated_at: u64,
    pub deleted_at: Option<u64>,
    pub key: Option<EncW>,
    pub have: Vec<String>,
}

#[derive(Deserialize, Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Usage {
    pub used: u64,
    pub reserved: u64,
    pub seats: u64,
    pub limit: u64,
}

/// 이 기기 쪽 사정 — 열쇠·기기 id·사람들(받는 기기·서명 기기·이름)
pub struct Me<'a> {
    pub keys: &'a DeviceKeys,
    pub device: &'a str,
}

/// 받는 기기·서명 기기·멤버 이름 — 진짜는 e2e_state(명부·사슬 검증), 시험은 손으로
#[derive(Default, Debug, Clone)]
pub struct People {
    /// 팀 보관함 파일 받는 기기
    pub recipients: Vec<Recipient>,
    /// 기기 id → Ed25519 서명 열쇠(믿는 사슬에 든 적 있는 기기)
    pub signers: BTreeMap<String, String>,
    /// 멤버 id → 이름
    pub names: BTreeMap<String, String>,
}

/// 서명·열쇠를 확인하고 연 파일
#[derive(Clone)]
pub struct Opened {
    pub k: [u8; 32],
    pub meta: Meta,
}

impl std::fmt::Debug for Opened {
    /// 열쇠는 안 찍는다
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Opened").field("meta", &self.meta).finish_non_exhaustive()
    }
}

/// 파일 하나 열기 — 올린 기기 파일 서명(방 포함) → 내 봉투 → kh → 이름 서명(올린·바꾼 기기)
pub fn open_file(me: &Me, p: &People, team: &str, f: &RemoteFile) -> Result<Opened, String> {
    let room = f.room.as_deref().unwrap_or("");
    let ed = p.signers.get(&f.by.device).ok_or("올린 기기를 믿을 수 없어(팀 명부·사슬 밖)")?;
    if !verify_sig(ed, &file_sig_text(team, room, &f.id, &f.by.device, &f.kh, f.size, f.parts), &f.sig) {
        return Err("올린 기기 서명이 틀렸어".into());
    }
    let ed2 = p.signers.get(&f.meta_by).ok_or("이름 붙인 기기를 믿을 수 없어")?;
    if !verify_sig(ed2, &meta_sig_text(team, room, &f.id, &f.meta_by, &f.kh, &f.meta.iv, &f.meta.ct), &f.meta_sig) {
        return Err("이름 서명이 틀렸어".into());
    }
    let key = f.key.as_ref().ok_or("이 기기 몫 열쇠가 아직 없어 — 다른 팀원 앱이 켜지면 채워져")?;
    let k = open_key(me.keys, me.device, team, room, &f.id, &key.enc, &key.w, &f.kh)?;
    let meta = open_meta(&k, team, room, &f.id, &f.meta.iv, &f.meta.ct)?;
    if shape(meta.size) != (f.parts, f.size) {
        return Err("크기가 서명과 달라".into());
    }
    Ok(Opened { k, meta })
}

// ── 서버와 주고받기 ──

/// 중계 길 — JSON 은 서명한 일반 요청, 조각은 빈 본문 서명(ADR 0009 결정 7)
pub trait Net {
    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String>;
    fn put(&self, path: &str, bytes: &[u8]) -> Result<u16, String>;
    fn get(&self, path: &str) -> Result<(u16, Vec<u8>), String>;
}

fn why(code: u16, v: &Value) -> String {
    match (code, v["error"].as_str().unwrap_or("")) {
        (413, "quota_exceeded") => "팀 보관함 자리가 모자라 — 좌석당 10GB 를 넘었어".into(),
        (413, "file_too_large") => "파일 하나는 10GB 까지야".into(),
        (400, "bad_keys") => "받는 사람 기기 목록이 서버와 안 맞아 — 잠시 뒤 다시".into(),
        (c, e) => crate::team_relay::why(c, &json!({ "error": e })),
    }
}

fn ok(code: u16, v: Value, want: u16) -> Result<Value, String> {
    if code == want { Ok(v) } else { Err(why(code, &v)) }
}

#[derive(Clone)]
pub struct Listing {
    pub rev: u64,
    pub usage: Usage,
    pub files: Vec<RemoteFile>,
}

pub fn fetch_list(net: &dyn Net, team: &str) -> Result<Listing, String> {
    let (c, v) = net.call("GET", &format!("/v0/teams/{team}/locker"), None)?;
    let v = ok(c, v, 200)?;
    Ok(Listing {
        rev: v["rev"].as_u64().unwrap_or(0),
        usage: serde_json::from_value(v["usage"].clone()).unwrap_or_default(),
        files: serde_json::from_value(v["files"].clone()).map_err(|e| format!("목록 모양이 틀렸어: {e}"))?,
    })
}

/// 올리기 — path 의 파일을 봉해 올린다. room 이 비면 팀 보관함, 아니면 그 방 대화 파일(to = 방 사람 기기). kind = file | avatar.
/// progress(보낸 평문 바이트, 전체). 중간에 실패하면 서버 줄을 치운다(abort)
#[allow(clippy::too_many_arguments)]
pub fn upload(net: &dyn Net, me: &Me, to: &[Recipient], team: &str, room: &str, kind: &str, folder: &str, path: &Path, name: &str, progress: &mut dyn FnMut(u64, u64)) -> Result<FileRef, String> {
    let mut file = std::fs::File::open(path).map_err(|e| format!("파일을 못 열었어: {e}"))?;
    let plain = file.metadata().map_err(|e| e.to_string())?.len();
    let folder = safe_path(folder);
    path_ok(&folder)?;
    let meta = Meta { name: safe_file_name(name), size: plain, at: now_ms(), folder, dir: false };
    send(net, me, to, team, room, kind, meta, &mut file, progress)
}

/// 빈 폴더 만들기 — 0바이트 표시 줄 하나(봉한 meta 의 dir·folder). 서버엔 16바이트 암호문 줄로만 보인다
pub fn mkdir(net: &dyn Net, me: &Me, to: &[Recipient], team: &str, folder: &str) -> Result<FileRef, String> {
    let folder = safe_path(folder);
    path_ok(&folder)?;
    if folder.is_empty() {
        return Err("폴더 이름이 비었어".into());
    }
    let meta = Meta { name: String::new(), size: 0, at: now_ms(), folder, dir: true };
    send(net, me, to, team, "", "file", meta, &mut std::io::empty(), &mut |_, _| {})
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[allow(clippy::too_many_arguments)]
fn send(net: &dyn Net, me: &Me, to: &[Recipient], team: &str, room: &str, kind: &str, meta: Meta, file: &mut dyn Read, progress: &mut dyn FnMut(u64, u64)) -> Result<FileRef, String> {
    let plain = meta.size;
    if !to.iter().any(|r| r.device == me.device) {
        return Err("이 기기가 받는 목록에 없어 — 종단 암호 준비가 안 됐어".into());
    }
    let (parts, size) = shape(plain);
    let k = rand::<32>();
    let id = B64.encode(rand::<16>());
    let name = meta.name.clone();
    let (iv, ct) = seal_meta(&k, team, room, &id, &meta);
    let kh = key_hash(&k);
    let sig = me.keys.sign(&file_sig_text(team, room, &id, me.device, &kh, size, parts));
    let meta_sig = me.keys.sign(&meta_sig_text(team, room, &id, me.device, &kh, &iv, &ct));
    let keys = seal_keys(&k, team, room, &id, to)?;
    let mut body = json!({ "id": id, "size": size, "parts": parts, "kh": kh, "sig": sig, "metaSig": meta_sig, "meta": { "iv": iv, "ct": ct }, "keys": keys });
    if !room.is_empty() {
        body["room"] = json!(room);
    }
    if kind != "file" {
        body["kind"] = json!(kind);
    }
    let (c, v) = net.call("POST", &format!("/v0/teams/{team}/locker/files"), Some(&body))?;
    ok(c, v, 201)?;
    let base = format!("/v0/teams/{team}/locker/files/{id}");
    let sent = (|| -> Result<(), String> {
        let mut buf = vec![0u8; CHUNK.min(plain.max(1) as usize)];
        let mut done = 0u64;
        progress(0, plain);
        for i in 0..parts {
            let want = (plain - done).min(CHUNK as u64) as usize;
            file.read_exact(&mut buf[..want]).map_err(|e| format!("파일을 읽다 멈췄어(그새 바뀌었나?): {e}"))?;
            let c = net.put(&format!("{base}/parts/{i}"), &seal_chunk(&k, team, room, &id, i, i + 1 == parts, &buf[..want]))?;
            if c != 200 {
                return Err(why(c, &Value::Null));
            }
            done += want as u64;
            progress(done, plain);
        }
        let (c, v) = net.call("POST", &format!("{base}/done"), Some(&json!({})))?;
        ok(c, v, 200).map(|_| ())
    })();
    if let Err(e) = sent {
        let _ = net.call("POST", &format!("{base}/abort"), Some(&json!({})));
        return Err(e);
    }
    Ok(FileRef { id, team: team.into(), room: room.into(), name, size: plain })
}

/// 내려받기 — 조각마다 받아 열고 dest(임시 이름) 에 쓴 뒤 dir 안 겹치지 않는 이름으로 옮긴다
pub fn download(net: &dyn Net, team: &str, f: &RemoteFile, o: &Opened, dir: &Path, progress: &mut dyn FnMut(u64, u64)) -> Result<PathBuf, String> {
    let room = f.room.as_deref().unwrap_or("");
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".chammo-down-{}", B64.encode(rand::<6>())));
    let res = (|| -> Result<(), String> {
        let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut done = 0u64;
        progress(0, o.meta.size);
        for i in 0..f.parts {
            let (c, ct) = net.get(&format!("/v0/teams/{team}/locker/files/{}/parts/{i}", f.id))?;
            if c != 200 {
                return Err(why(c, &Value::Null));
            }
            let pt = open_chunk(&o.k, team, room, &f.id, i, i + 1 == f.parts, &ct)?;
            out.write_all(&pt).map_err(|e| e.to_string())?;
            done += pt.len() as u64;
            progress(done, o.meta.size);
        }
        if done != o.meta.size {
            return Err("받은 크기가 서명과 달라".into());
        }
        out.sync_all().map_err(|e| e.to_string())
    })();
    if let Err(e) = res {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    let at = crate::locker_fs::unique(dir, &safe_file_name(&o.meta.name), true);
    std::fs::rename(&tmp, &at).map_err(|e| e.to_string())?;
    Ok(at)
}

/// 봉투 더하기 — 내가 연 파일 중 받는 목록(want)에 있는데 서버에 봉투가 없는 기기 몫을 봉해 올린다
/// 이 파일에 아직 봉투가 없는 받을 기기 — 팀 보관함은 want_team, 대화 파일은 그 방 사람(want_room). skip(파일, 기기) = 이미 올렸거나 서버가 거절한 것
fn missing(f: &RemoteFile, want_team: &[Recipient], want_room: &dyn Fn(&str) -> Vec<Recipient>, skip: &dyn Fn(&RemoteFile, &str) -> bool) -> Vec<Recipient> {
    let room = f.room.as_deref().unwrap_or("");
    let want = if room.is_empty() { want_team.to_vec() } else { want_room(room) };
    let have: BTreeSet<&str> = f.have.iter().map(String::as_str).collect();
    want.into_iter().filter(|r| !have.contains(r.device.as_str()) && !skip(f, &r.device)).collect()
}

/// 더할 봉투가 하나라도 있나 — 중계를 안 부르고 본다(받는 사람을 새로 받을지 정할 때)
pub fn missing_any(opened: &[(&RemoteFile, &Opened)], want_team: &[Recipient], want_room: &dyn Fn(&str) -> Vec<Recipient>, skip: &dyn Fn(&RemoteFile, &str) -> bool) -> bool {
    opened.iter().any(|(f, _)| !missing(f, want_team, want_room, skip).is_empty())
}

/// 봉투 더하기 결과 — 서버는 봉투 묶음에 받는 기기로 안 치는 기기(나간 사람·끊긴 기기·폰)가 하나라도 있으면 통째로 400 이라,
/// 여럿 묶음이 400 이면 기기 하나씩 다시 올려 거절된 기기를 가린다(10-30 진단: 거절된 묶음을 목록마다 다시 올려 10분 154번)
#[derive(Debug, Default)]
pub struct Shared {
    pub added: usize,
    /// 서버가 받은 (파일, 기기)
    pub sent: Vec<(String, String)>,
    /// 서버가 받는 기기로 안 친 (방, 기기) — 400 bad_keys 를 혼자 받았다
    pub bad_devices: Vec<(String, String)>,
    /// 그 파일엔 못 더한 (파일, 기기) — 없거나 못 보는 파일(403·404 등)
    pub bad_files: Vec<(String, String)>,
    /// 쉬라는 답(429)·망 실패로 멈췄다 — 기억하지 않고 다음에 다시
    pub stopped: bool,
}

pub fn share_keys(net: &dyn Net, team: &str, opened: &[(&RemoteFile, &Opened)], want_team: &[Recipient], want_room: &dyn Fn(&str) -> Vec<Recipient>, skip: &dyn Fn(&RemoteFile, &str) -> bool, max_posts: usize) -> Shared {
    let mut out = Shared::default();
    let mut posts = 0;
    for (f, o) in opened {
        let room = f.room.as_deref().unwrap_or("");
        let gone = |d: &str, out: &Shared| out.bad_devices.iter().any(|(r, x)| r == room && x == d);
        let missing: Vec<_> = missing(f, want_team, want_room, skip).into_iter().filter(|r| !gone(&r.device, &out)).collect();
        if missing.is_empty() {
            continue;
        }
        // 묶음 한 번, 400 이면 기기 하나씩
        let mut tries = vec![missing.clone()];
        while let Some(batch) = tries.pop() {
            let batch: Vec<_> = batch.into_iter().filter(|r| !gone(&r.device, &out)).collect();
            if batch.is_empty() {
                continue;
            }
            if posts >= max_posts {
                out.stopped = true;
                return out;
            }
            let Ok(keys) = seal_keys(&o.k, team, room, &f.id, &batch) else { break };
            posts += 1;
            match net.call("POST", &format!("/v0/teams/{team}/locker/files/{}/keys", f.id), Some(&json!({ "keys": keys }))) {
                Ok((200, _)) => {
                    out.added += keys.len();
                    out.sent.extend(batch.iter().map(|r| (f.id.clone(), r.device.clone())));
                }
                Ok((400, _)) if batch.len() > 1 => tries.extend(batch.into_iter().rev().map(|r| vec![r])),
                Ok((400, _)) => out.bad_devices.extend(batch.into_iter().map(|r| (room.to_string(), r.device))),
                Ok((429, _)) | Err(_) => {
                    out.stopped = true;
                    return out;
                }
                Ok(_) => out.bad_files.extend(batch.into_iter().map(|r| (f.id.clone(), r.device))),
            }
        }
    }
    out
}

/// 이름 바꾸기·폴더 옮기기 — 같은 k 로 새 meta, 이 기기 서명. None 이면 그대로
pub fn rename(net: &dyn Net, me: &Me, team: &str, f: &RemoteFile, o: &Opened, new_name: Option<&str>, folder: Option<&str>) -> Result<(), String> {
    let room = f.room.as_deref().unwrap_or("");
    let name = new_name.map(safe_file_name).unwrap_or_else(|| o.meta.name.clone());
    let folder = folder.map(safe_path).unwrap_or_else(|| o.meta.folder.clone());
    path_ok(&folder)?;
    let (iv, ct) = seal_meta(&o.k, team, room, &f.id, &Meta { name, folder, ..o.meta.clone() });
    let sig = me.keys.sign(&meta_sig_text(team, room, &f.id, me.device, &f.kh, &iv, &ct));
    let (c, v) = net.call("POST", &format!("/v0/teams/{team}/locker/files/{}/meta", f.id), Some(&json!({ "meta": { "iv": iv, "ct": ct }, "metaSig": sig })))?;
    ok(c, v, 200).map(|_| ())
}

/// 폴더 안(팀 보관함·살아 있는 것, 안쪽 폴더까지) — 대화 파일·휴지통은 폴더가 아니다
fn in_folder<'a>(opened: &'a [(&'a RemoteFile, &'a Opened)], folder: &'a str) -> impl Iterator<Item = &'a (&'a RemoteFile, &'a Opened)> {
    opened.iter().filter(move |(f, o)| f.kind == "file" && f.state == "live" && f.room.as_deref().unwrap_or("").is_empty() && under(&o.meta.folder, folder))
}

/// 폴더 이름 바꾸기·옮기기 — to = 새 경로 전체('보관/계약'). 그 폴더와 안쪽 폴더의 파일·표시 줄 meta 를 새 경로로(이 기기 서명). 바꾼 수
pub fn rename_folder(net: &dyn Net, me: &Me, team: &str, opened: &[(&RemoteFile, &Opened)], from: &str, to: &str) -> Result<usize, String> {
    let to = safe_path(to);
    if from.is_empty() || to.is_empty() {
        return Err("폴더 이름이 비었어".into());
    }
    if under(&to, from) && to != from {
        return Err("폴더를 자기 안으로는 못 옮겨".into());
    }
    let mut n = 0;
    for (f, o) in in_folder(opened, from) {
        let moved = format!("{to}{}", &o.meta.folder[from.len()..]);
        path_ok(&moved)?;
        rename(net, me, team, f, o, None, Some(&moved))?;
        n += 1;
    }
    Ok(n)
}

/// 폴더 지우기 — 안의 파일·안쪽 폴더·표시 줄을 휴지통으로(30일 안 되살리기). 옮긴 수
pub fn remove_folder(net: &dyn Net, team: &str, opened: &[(&RemoteFile, &Opened)], folder: &str) -> Result<usize, String> {
    if folder.is_empty() {
        return Err("맨 위는 지울 수 없어".into());
    }
    let mut n = 0;
    for (f, _) in in_folder(opened, folder) {
        act(net, team, &f.id, "trash")?;
        n += 1;
    }
    Ok(n)
}

/// 휴지통·되살리기·영구 지우기
pub fn act(net: &dyn Net, team: &str, id: &str, verb: &str) -> Result<(), String> {
    if !matches!(verb, "trash" | "restore" | "purge") {
        return Err("모르는 일".into());
    }
    let (c, v) = net.call("POST", &format!("/v0/teams/{team}/locker/files/{id}/{verb}"), Some(&json!({})))?;
    ok(c, v, 200).map(|_| ())
}

#[cfg(test)]
#[path = "team_locker_tests.rs"]
mod tests;
