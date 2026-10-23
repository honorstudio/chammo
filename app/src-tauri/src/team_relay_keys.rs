//! 팀 메신저 기기 열쇠(중계 서버 ADR 0002) — Ed25519(요청 서명) + X25519(종단 암호 봉투, 4단계에 쓴다).
//! - 비밀 열쇠는 이 기기 저장소(맥 키체인·윈도우 자격 증명 관리자)의 service `chammo-team` 칸에만. 칸 이름(account)은 공개 열쇠로 지어
//!   같은 맥의 두 데이터 폴더(시험 HQ 등)가 서로 다른 신원을 갖는다. 화면·로그·파일에는 공개 열쇠만
//! - 서명할 글 = `chammo-relay/v0\n{METHOD}\n{경로(쿼리 제외)}\n{ts}\n{nonce}\n{본문 SHA-256 base64url}` — 서버 src/auth.ts 와 한 글자도 같게
use crate::accounts_store::{Secret, Store, StoreError};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub const SERVICE: &str = "chammo-team";
const PREFIX: &str = "chammo-relay/v0";

pub struct DeviceKeys {
    sign: SigningKey,
    dh: StaticSecret,
}

/// 비밀 씨앗은 안 찍는다 — 실수로 로그에 남지 않게
impl std::fmt::Debug for DeviceKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "DeviceKeys({})", self.public())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Signed {
    pub ts: String,
    pub nonce: String,
    pub sig: String,
}

impl DeviceKeys {
    pub fn from_seeds(ed: [u8; 32], x: [u8; 32]) -> Self {
        DeviceKeys { sign: SigningKey::from_bytes(&ed), dh: StaticSecret::from(x) }
    }

    /// OS 난수로 새 열쇠 쌍 두 개
    pub fn generate() -> Result<Self, String> {
        let mut ed = [0u8; 32];
        let mut x = [0u8; 32];
        getrandom::fill(&mut ed).and_then(|_| getrandom::fill(&mut x)).map_err(|e| format!("난수 실패 {e}"))?;
        Ok(Self::from_seeds(ed, x))
    }

    /// 서버에 등록하는 Ed25519 공개 열쇠(32바이트 base64url)
    pub fn public(&self) -> String {
        B64.encode(self.sign.verifying_key().as_bytes())
    }

    /// 종단 암호 봉투용 X25519 공개 열쇠(4단계에 서버에 올린다)
    pub fn dh_public(&self) -> String {
        B64.encode(PublicKey::from(&self.dh).as_bytes())
    }

    /// 폰 터널 열쇠(ECDH P-256, ADR 0013) — 이 기기 X25519 씨앗에서 HKDF 로 끌어낸다(키체인 칸을 늘리지 않고, 로그아웃하면 같이 바뀐다)
    fn tunnel_secret(&self) -> p256::SecretKey {
        let h = hkdf::Hkdf::<Sha256>::new(Some(b"chammo-phone-tunnel/p256"), &self.dh.to_bytes());
        for i in 0u8.. {
            let mut seed = [0u8; 32];
            h.expand(&[b'k', i], &mut seed).expect("32");
            if let Some(k) = crate::phone_tunnel::secret_from_seed(&seed) {
                return k;
            }
        }
        unreachable!()
    }

    /// 폰 터널 공개 열쇠(65바이트 base64url) — QR 에 들어간다
    pub fn tunnel_public(&self) -> String {
        B64.encode(crate::phone_tunnel::public_of(&self.tunnel_secret()))
    }

    /// 폰 터널 합의 — 상대가 곡선 위 점이 아니면 None
    pub fn tunnel_agree(&self, their: &[u8]) -> Option<[u8; 32]> {
        crate::phone_tunnel::agree(&self.tunnel_secret(), their).ok()
    }

    pub fn sign(&self, text: &str) -> String {
        B64.encode(self.sign.sign(text.as_bytes()).to_bytes())
    }

    /// 요청 하나 서명 — path 에 쿼리가 붙어 있어도 서명할 글엔 경로만(서버는 url.pathname 으로 확인한다)
    pub fn sign_request(&self, method: &str, path: &str, body: &[u8], ts_ms: u64, nonce: &str) -> Signed {
        let path = path.split_once('?').map_or(path, |(p, _)| p);
        let ts = ts_ms.to_string();
        let sig = self.sign(&signing_text(method, path, &ts, nonce, body));
        Signed { ts, nonce: nonce.to_string(), sig }
    }

    fn to_secret(&self) -> Secret {
        Secret::new(serde_json::json!({ "v": 1, "ed": B64.encode(self.sign.to_bytes()), "x": B64.encode(self.dh.to_bytes()) }).to_string())
    }

    fn from_secret(s: &Secret) -> Option<Self> {
        let v: serde_json::Value = serde_json::from_str(s.expose()).ok()?;
        let seed = |k: &str| -> Option<[u8; 32]> { B64.decode(v[k].as_str()?).ok()?.try_into().ok() };
        Some(Self::from_seeds(seed("ed")?, seed("x")?))
    }
}

pub fn body_hash(body: &[u8]) -> String {
    B64.encode(Sha256::digest(body))
}

pub fn signing_text(method: &str, path: &str, ts: &str, nonce: &str, body: &[u8]) -> String {
    [PREFIX, method, path, ts, nonce, &body_hash(body)].join("\n")
}

/// 16바이트 난수 base64url(22자) — 서버 NONCE_RE ^[A-Za-z0-9_-]{16,64}$
pub fn new_nonce() -> Result<String, String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).map_err(|e| format!("난수 실패 {e}"))?;
    Ok(B64.encode(b))
}

/// 저장소 칸 이름 — 공개 열쇠로(비밀이 아니다)
pub fn account_of(public: &str) -> String {
    format!("dev-{public}")
}

/// 없으면 None. 칸은 있는데 못 읽는 값이면 오류 — 빈 것처럼 넘기면 새 열쇠로 덮어 등록된 신원을 잃는다
pub fn load(st: &dyn Store, account: &str) -> Result<Option<DeviceKeys>, String> {
    match st.get(SERVICE, account) {
        Ok(None) => Ok(None),
        Ok(Some(s)) => DeviceKeys::from_secret(&s).map(Some).ok_or_else(|| "팀 기기 열쇠 칸이 깨졌어요".to_string()),
        Err(e) => Err(store_word(&e)),
    }
}

/// 새 열쇠를 만들어 넣고 되읽어 같은지 본다 → (열쇠, 칸 이름)
pub fn create(st: &dyn Store) -> Result<(DeviceKeys, String), String> {
    let k = DeviceKeys::generate()?;
    let account = account_of(&k.public());
    st.set(SERVICE, &account, &k.to_secret()).map_err(|e| store_word(&e))?;
    match load(st, &account)? {
        Some(back) if back.public() == k.public() => Ok((k, account)),
        _ => Err("팀 기기 열쇠를 넣었는데 다시 읽히지 않아요".into()),
    }
}

pub fn remove(st: &dyn Store, account: &str) -> Result<(), String> {
    st.remove(SERVICE, account).map_err(|e| store_word(&e))
}

fn store_word(e: &StoreError) -> String {
    match e {
        StoreError::Locked => "키체인이 잠겨 있어요".into(),
        StoreError::Denied => "키체인 허용을 거절했어요".into(),
        StoreError::Failed(m) => m.clone(),
    }
}

/// 실제 저장소 — 맥 = 로그인 키체인(창 안 띄움), 윈도우 = 자격 증명 관리자.
/// 시험은 CHAMMO_TEAM_KEYCHAIN(키체인 파일)·_PASSWORD 로 로그인 키체인을 안 건드린다(메신저 토큰과 같은 방식)
#[cfg(not(windows))]
pub fn store() -> crate::accounts_store::Keychain {
    let path = std::env::var("CHAMMO_TEAM_KEYCHAIN").ok().filter(|s| !s.is_empty());
    let unlock = path.as_ref().and(std::env::var("CHAMMO_TEAM_KEYCHAIN_PASSWORD").ok());
    crate::accounts_store::Keychain { path, unlock, quiet: true, cli_service: None }
}

#[cfg(windows)]
pub fn store() -> crate::wincred::WinCred {
    crate::wincred::WinCred
}

#[cfg(test)]
#[path = "team_relay_keys_tests.rs"]
mod tests;
