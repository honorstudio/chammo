//! 폰 푸시(웹 푸시, 2026-10-03 사용자 "시간 많으니까 부탁해") — 홈 화면에 붙인 폰 웹앱(iOS 16.4+)이 구독하면,
//! 앱이 맥 알림을 보낼 때(claude::notify — domain/notify 정책·'참모 창 보고 있으면 안 보냄'을 이미 거친 것) 같이 보낸다.
//! - VAPID 키(ES256)는 <데이터>/push-vapid.json(600), 구독은 <데이터>/push-subs.json(600) — 기기(mobile_pair) 별로, 끊긴 기기엔 안 보낸다
//! - 몸통은 RFC 8291(aes128gcm)로 암호화 — 푸시 서버(애플 등)는 못 읽는다. 문구는 제목 + 짧은 한 줄만
//! - 보내기는 맥의 curl(https) — TLS 크레이트를 더하지 않는다. 구독 주소는 알려진 푸시 서버 https 만(엉뚱한 곳으로 안 나가게)
use aes_gcm::aead::Aead;
use aes_gcm::{Aes128Gcm, KeyInit, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as URL;
use base64::Engine;
use hkdf::Hkdf;
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::{PublicKey, SecretKey};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::path::Path;
use std::sync::Mutex;

/// VAPID 연락처 — 애플은 sub 가 없거나 이상하면 거절한다
const SUB: &str = "https://github.com/honorstudio/chammo";
/// 레코드 크기(RFC 8188) — 한 레코드에 다 들어간다
const RS: u32 = 4096;
/// 몸통 한 줄 글자 상한
const LINE_MAX: usize = 60;

fn rand<const N: usize>() -> Result<[u8; N], String> {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).map_err(|e| e.to_string())?;
    Ok(b)
}

// ── VAPID ────────────────────────────────────────────────────

pub struct Vapid {
    key: SigningKey,
}

impl Vapid {
    pub fn generate() -> Result<Vapid, String> {
        loop {
            if let Ok(key) = SigningKey::from_slice(&rand::<32>()?) {
                return Ok(Vapid { key });
            }
        }
    }
    /// 공개 키(비압축 65바이트) base64url — 폰이 pushManager.subscribe 의 applicationServerKey 로 쓴다
    pub fn public_b64(&self) -> String {
        URL.encode(self.key.verifying_key().to_encoded_point(false).as_bytes())
    }
    pub fn to_json(&self) -> String {
        serde_json::json!({ "d": URL.encode(self.key.to_bytes()), "public": self.public_b64() }).to_string()
    }
    pub fn from_json(s: &str) -> Option<Vapid> {
        let v: serde_json::Value = serde_json::from_str(s).ok()?;
        let d = URL.decode(v["d"].as_str()?).ok()?;
        Some(Vapid { key: SigningKey::from_slice(&d).ok()? })
    }
    /// 푸시 서버에 내는 JWT(ES256) — aud = 구독 주소의 출처, exp = 만료(초)
    pub fn jwt(&self, aud: &str, exp: u64) -> Result<String, String> {
        let head = URL.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
        let claims = URL.encode(serde_json::json!({ "aud": aud, "exp": exp, "sub": SUB }).to_string());
        let msg = format!("{head}.{claims}");
        let sig: Signature = self.key.sign(msg.as_bytes());
        Ok(format!("{msg}.{}", URL.encode(sig.to_bytes())))
    }
}

// ── 암호화(RFC 8291 aes128gcm) ───────────────────────────────

fn expand<const N: usize>(h: &Hkdf<Sha256>, info: &[u8]) -> Result<[u8; N], String> {
    let mut out = [0u8; N];
    h.expand(info, &mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

/// 보내는 쪽 비밀 키·salt 를 받아 암호화(시험에서 RFC 벡터와 맞추려고 따로 둔다)
pub fn encrypt_with(plain: &[u8], ua_public: &[u8], auth: &[u8], as_private: &[u8], salt: [u8; 16]) -> Result<Vec<u8>, String> {
    if auth.len() != 16 {
        return Err("bad auth".into());
    }
    if plain.len() > RS as usize - 103 {
        return Err("too long".into());
    }
    let ua = PublicKey::from_sec1_bytes(ua_public).map_err(|_| "bad p256dh")?;
    let ua_raw = ua.to_encoded_point(false);
    let me = SecretKey::from_slice(as_private).map_err(|_| "bad key")?;
    let me_pub = me.public_key().to_encoded_point(false);
    let shared = p256::ecdh::diffie_hellman(me.to_nonzero_scalar(), ua.as_affine());
    let mut key_info = b"WebPush: info\0".to_vec();
    key_info.extend_from_slice(ua_raw.as_bytes());
    key_info.extend_from_slice(me_pub.as_bytes());
    let ikm: [u8; 32] = expand(&Hkdf::<Sha256>::new(Some(auth), shared.raw_secret_bytes()), &key_info)?;
    let prk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    let cek: [u8; 16] = expand(&prk, b"Content-Encoding: aes128gcm\0")?;
    let nonce: [u8; 12] = expand(&prk, b"Content-Encoding: nonce\0")?;
    let mut rec = plain.to_vec();
    rec.push(2); // 마지막 레코드 표시
    let ct = Aes128Gcm::new_from_slice(&cek).map_err(|e| e.to_string())?.encrypt(Nonce::from_slice(&nonce), rec.as_ref()).map_err(|e| e.to_string())?;
    let mut body = salt.to_vec();
    body.extend_from_slice(&RS.to_be_bytes());
    body.push(me_pub.as_bytes().len() as u8);
    body.extend_from_slice(me_pub.as_bytes());
    body.extend_from_slice(&ct);
    Ok(body)
}

/// 보낼 때마다 새 임시 키·salt
pub fn encrypt(plain: &[u8], ua_public: &[u8], auth: &[u8]) -> Result<Vec<u8>, String> {
    let me = SecretKey::random(&mut rand_core_compat::Os);
    encrypt_with(plain, ua_public, auth, &me.to_bytes(), rand::<16>()?)
}

/// p256 의 random 에 OS 난수(getrandom)를 물린다 — rand 크레이트를 따로 안 들인다
mod rand_core_compat {
    pub struct Os;
    impl p256::elliptic_curve::rand_core::RngCore for Os {
        fn next_u32(&mut self) -> u32 {
            u32::from_le_bytes(self.bytes())
        }
        fn next_u64(&mut self) -> u64 {
            u64::from_le_bytes(self.bytes())
        }
        fn fill_bytes(&mut self, dest: &mut [u8]) {
            getrandom::fill(dest).expect("OS 난수");
        }
        fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), p256::elliptic_curve::rand_core::Error> {
            self.fill_bytes(dest);
            Ok(())
        }
    }
    impl Os {
        fn bytes<const N: usize>(&mut self) -> [u8; N] {
            let mut b = [0u8; N];
            getrandom::fill(&mut b).expect("OS 난수");
            b
        }
    }
    impl p256::elliptic_curve::rand_core::CryptoRng for Os {}
}

// ── 구독 ────────────────────────────────────────────────────

/// 알려진 푸시 서버 https 만 — 사용자 정보·포트 없이. curl 이 엉뚱한 곳(맥 안·사설망)으로 나가지 않게
pub fn endpoint_ok(url: &str) -> bool {
    if url.len() > 1024 || url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return false;
    }
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase();
    if host.contains(['@', ':']) {
        return false;
    }
    host == "web.push.apple.com"
        || host.ends_with(".push.apple.com")
        || host == "fcm.googleapis.com"
        || host == "updates.push.services.mozilla.com"
        || host.ends_with(".notify.windows.com")
}

/// 구독 하나 — device = 짝지은 기기 id(mobile_pair). 그 기기를 끊으면 안 보낸다
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Sub {
    pub device: String,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub at: u64,
}

/// 같은 기기·같은 주소면 새 것으로 바꾼다
pub fn add_sub(list: &mut Vec<Sub>, s: Sub) {
    list.retain(|x| !(x.device == s.device && x.endpoint == s.endpoint));
    list.push(s);
}

/// 그 기기의 그 주소만 — 남의 기기 구독은 못 지운다
pub fn remove_sub(list: &mut Vec<Sub>, device: &str, endpoint: &str) {
    list.retain(|x| !(x.device == device && x.endpoint == endpoint));
}

/// 지금 짝지어 있는 기기의 구독만
pub fn live_subs(list: &[Sub], devices: &[String]) -> Vec<Sub> {
    list.iter().filter(|s| devices.contains(&s.device)).cloned().collect()
}

/// 푸시 서버가 '그 구독 없다'고 하면 지운다
pub fn gone(status: u16) -> bool {
    status == 404 || status == 410
}

/// 폰에 보일 것 — 제목 + 첫 줄 앞부분만(대화 내용·비밀은 최소로), 누르면 갈 곳(target = domain/notify noteTarget)
pub fn payload(title: &str, body: &str, target: &str) -> Vec<u8> {
    let line = body.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let line: String = if line.chars().count() > LINE_MAX { format!("{}…", line.chars().take(LINE_MAX).collect::<String>()) } else { line.to_string() };
    serde_json::json!({ "title": title.chars().take(80).collect::<String>(), "body": line, "target": target }).to_string().into_bytes()
}

// ── 맥 쪽 저장·보내기 ────────────────────────────────────────

static LOCK: Mutex<()> = Mutex::new(());

fn subs_path(dir: &Path) -> std::path::PathBuf {
    dir.join("push-subs.json")
}

/// 구독 목록 — 파일이 없으면 빈 목록, 있는데 못 읽으면(깨짐·쓰는 중) 오류: 그 위에 덮어쓰면 남의 구독까지 날아간다(2026-10-03)
fn load_subs(dir: &Path) -> Result<Vec<Sub>, String> {
    match std::fs::read_to_string(subs_path(dir)) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| format!("push-subs.json 을 못 읽어요: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn read_subs(dir: &Path) -> Vec<Sub> {
    std::fs::read_to_string(subs_path(dir)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_subs(dir: &Path, list: &[Sub]) -> Result<(), String> {
    crate::mobile_pair::write_private(&subs_path(dir), &serde_json::to_string(list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// 그 데이터 폴더의 VAPID 키 — 없으면 만든다(600)
pub fn vapid(dir: &Path) -> Result<Vapid, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let p = dir.join("push-vapid.json");
    if let Some(v) = std::fs::read_to_string(&p).ok().as_deref().and_then(Vapid::from_json) {
        return Ok(v);
    }
    let v = Vapid::generate()?;
    crate::mobile_pair::write_private(&p, &v.to_json()).map_err(|e| e.to_string())?;
    Ok(v)
}

/// 구독 기록 한 줄 — 시험에선 안 쓴다(시험은 데이터 폴더를 따로 안 줘서 진짜 notify.log 에 남았다)
fn sub_log(line: &str) {
    #[cfg(not(test))]
    crate::claude::log_out("push-sub", line);
    #[cfg(test)]
    let _ = line;
}

/// 넣기·빼기는 기기별로만, 기록(notify.log 'push-sub')을 남긴다 — 구독이 사라졌을 때 누가 뺐는지 알 수 있게(2026-10-03)
pub fn subscribe(dir: &Path, s: Sub) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut list = load_subs(dir)?;
    let line = format!("add {} {} (전체 {})", s.device, origin(&s.endpoint), list.len() + usize::from(!list.iter().any(|x| x.device == s.device && x.endpoint == s.endpoint)));
    add_sub(&mut list, s);
    write_subs(dir, &list)?;
    sub_log(&line);
    Ok(())
}

pub fn unsubscribe(dir: &Path, device: &str, endpoint: &str) -> Result<(), String> {
    unsubscribe_why(dir, device, endpoint, "폰이 끔")
}

fn unsubscribe_why(dir: &Path, device: &str, endpoint: &str, why: &str) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut list = load_subs(dir)?;
    let before = list.len();
    remove_sub(&mut list, device, endpoint);
    if list.len() == before {
        return Ok(()); // 없는 것 — 파일을 다시 안 쓴다
    }
    write_subs(dir, &list)?;
    sub_log(&format!("remove {device} {} — {why} (남은 {})", origin(endpoint), list.len()));
    Ok(())
}

/// 구독 주소의 출처(aud) — https://<host>
fn origin(endpoint: &str) -> String {
    let rest = endpoint.trim_start_matches("https://");
    format!("https://{}", rest.split('/').next().unwrap_or(""))
}

/// 한 구독에 보내기 — curl 로 POST, 응답 코드를 돌려준다
fn post(v: &Vapid, s: &Sub, body: &[u8]) -> Result<u16, String> {
    use std::io::Write;
    if !endpoint_ok(&s.endpoint) {
        return Err("bad endpoint".into());
    }
    let ua = URL.decode(&s.p256dh).map_err(|_| "bad p256dh")?;
    let auth = URL.decode(&s.auth).map_err(|_| "bad auth")?;
    let enc = encrypt(body, &ua, &auth)?;
    let exp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) + 12 * 3600;
    let jwt = v.jwt(&origin(&s.endpoint), exp)?;
    let mut child = crate::platform::command("curl")
        .args(["-sS", "-o", if cfg!(windows) { "NUL" } else { "/dev/null" }, "-w", "%{http_code}", "--max-time", "10", "--proto", "=https", "-X", "POST"])
        .args(["-H", &format!("Authorization: vapid t={jwt}, k={}", v.public_b64())])
        .args(["-H", "Content-Encoding: aes128gcm", "-H", "Content-Type: application/octet-stream", "-H", "TTL: 3600", "-H", "Urgency: high"])
        .args(["--data-binary", "@-", &s.endpoint])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    child.stdin.take().ok_or("no stdin")?.write_all(&enc).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    String::from_utf8_lossy(&out.stdout).trim().parse::<u16>().map_err(|_| "no status".to_string())
}

/// 앱 알림이 나갈 때 — 모바일을 켜 뒀고 진짜 데이터 폴더일 때만, 지금 짝지은 기기의 구독마다(따로 도는 스레드에서)
pub fn send_all(title: &str, body: &str, target: &str) {
    let dir = crate::config::data_dir().to_path_buf();
    if !crate::mobile::push_allowed(&dir) {
        return;
    }
    let devices: Vec<String> = crate::mobile_pair::Devices::open(&dir).list().into_iter().map(|d| d.id).collect();
    let subs = live_subs(&read_subs(&dir), &devices);
    if subs.is_empty() {
        return;
    }
    let msg = payload(title, body, target);
    std::thread::spawn(move || {
        let Ok(v) = vapid(&dir) else { return };
        for s in subs {
            match post(&v, &s, &msg) {
                Ok(code) if gone(code) => {
                    let _ = unsubscribe_why(&dir, &s.device, &s.endpoint, &format!("푸시 서버 {code}"));
                }
                Ok(code) if !(200..300).contains(&code) => crate::claude::log_out("push", &format!("{code} {}", origin(&s.endpoint))),
                Err(e) => crate::claude::log_out("push", &e),
                _ => {}
            }
        }
    });
}

#[cfg(test)]
#[path = "push_tests.rs"]
mod tests;
