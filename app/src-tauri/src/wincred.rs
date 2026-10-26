//! 윈도우 자격 증명 관리자(일반 자격 증명) — 다른 기기 참모 짝 열쇠(remote.rs)를 맥 키체인 칸 대신 여기에.
//! 값은 윈도우가 그 사용자 로그인으로 암호화해 둔다(DPAPI) — 파일·로그·오류 글엔 값이 안 나온다(오류 번호만).
//! 이 PC 에만(CRED_PERSIST_LOCAL_MACHINE — 로밍 프로필로 다른 PC 에 안 따라간다).
//! SSH(세션 0)처럼 로그인 비밀번호 없이 들어온 곳에선 못 읽고 못 쓴다(1312) — 앱은 화면 세션에서 돈다
use crate::accounts_store::StoreError;
#[cfg(windows)]
use crate::accounts_store::{Secret, Store};

/// 칸 이름 — 키체인 (서비스, 계정)을 한 줄로. 계정 = 기기의 테일스케일 노드 ID
pub fn target(service: &str, account: &str) -> String {
    format!("{service}/{account}")
}

/// 윈도우 오류 번호 → 우리 오류. 값은 안 담는다
pub fn map_err(code: u32) -> StoreError {
    match code {
        // ERROR_NO_SUCH_LOGON_SESSION — 로그인 세션의 열쇠가 없다(SSH 등)
        1312 => StoreError::Locked,
        // ERROR_ACCESS_DENIED
        5 => StoreError::Denied,
        n => StoreError::Failed(format!("자격 증명 관리자 오류 {n}")),
    }
}

/// 자격 증명 칸 하나에 들어가는 값 한도(CRED_MAX_CREDENTIAL_BLOB_SIZE = 5×512 바이트).
/// Claude 로그인 파일(.credentials.json)은 MCP 로그인이 붙으면 이걸 넘는다 — 넘으면 여러 칸에 나눠 둔다(10-26 2차 검증)
pub const BLOB_MAX: usize = 2560;
/// 나눠 둔 값의 머리 칸 표시 — 진짜 값은 JSON·base64 라 이 글로 시작하지 않는다
const SPLIT_MARK: &str = "\u{1}chammo-split:";

/// 값을 칸들로 — 한도 안이면 그대로 한 칸, 넘으면 머리 칸("표시+개수") + 조각 칸들(글자 경계에서 자름)
pub fn split_blob(v: &str) -> (String, Vec<String>) {
    if v.len() <= BLOB_MAX {
        return (v.to_string(), Vec::new());
    }
    let mut parts = Vec::new();
    let mut rest = v;
    while !rest.is_empty() {
        let mut cut = rest.len().min(BLOB_MAX);
        while !rest.is_char_boundary(cut) {
            cut -= 1;
        }
        parts.push(rest[..cut].to_string());
        rest = &rest[cut..];
    }
    (format!("{SPLIT_MARK}{}", parts.len()), parts)
}

/// 머리 칸이 나눠 둔 표시면 조각 개수
pub fn split_count(head: &str) -> Option<usize> {
    head.strip_prefix(SPLIT_MARK)?.parse().ok()
}

/// 조각 칸 이름
pub fn part_target(target: &str, i: usize) -> String {
    format!("{target}#{i}")
}

#[cfg(windows)]
pub struct WinCred;

#[cfg(windows)]
mod imp {
    use super::*;
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
    use windows_sys::Win32::Security::Credentials::{CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn read(name: &[u16]) -> Result<Option<Secret>, StoreError> {
        let mut p: *mut CREDENTIALW = std::ptr::null_mut();
        if unsafe { CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut p) } == 0 {
            let e = unsafe { GetLastError() };
            return if e == ERROR_NOT_FOUND { Ok(None) } else { Err(map_err(e)) };
        }
        let c = unsafe { &*p };
        let bytes = if c.CredentialBlob.is_null() { Vec::new() } else { unsafe { std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize) }.to_vec() };
        unsafe { CredFree(p as *const _) };
        String::from_utf8(bytes).map(|s| Some(Secret::new(s))).map_err(|_| StoreError::Failed("자격 증명 값이 글이 아니에요".into()))
    }

    impl Store for WinCred {
        fn get(&self, service: &str, account: &str) -> Result<Option<Secret>, StoreError> {
            let t = target(service, account);
            let Some(head) = read(&wide(&t))? else { return Ok(None) };
            let Some(n) = split_count(head.expose()) else { return Ok(Some(head)) };
            let mut all = String::new();
            for i in 0..n {
                match read(&wide(&part_target(&t, i)))? {
                    Some(p) => all.push_str(p.expose()),
                    None => return Err(StoreError::Failed("자격 증명 조각이 빠졌어요".into())),
                }
            }
            Ok(Some(Secret::new(all)))
        }

        /// 같은 이름이 있으면 덮어쓴다(CredWriteW). 되읽어서 같아야 쓴 것이다
        fn set(&self, service: &str, account: &str, secret: &Secret) -> Result<(), StoreError> {
            let t = target(service, account);
            // 전에 나눠 둔 조각부터 치운다(더 짧아졌을 때 남지 않게)
            if let Some(old) = read(&wide(&t))? {
                if let Some(n) = split_count(old.expose()) {
                    for i in 0..n {
                        delete(&part_target(&t, i))?;
                    }
                }
            }
            let (head, parts) = split_blob(secret.expose());
            for (i, p) in parts.iter().enumerate() {
                write(&part_target(&t, i), &Secret::new(p.clone()))?;
            }
            write(&t, &Secret::new(head))?;
            match self.get(service, account)? {
                Some(back) if back == *secret => Ok(()),
                _ => Err(StoreError::Failed("자격 증명 관리자에 쓴 값이 되읽히지 않아요".into())),
            }
        }

        fn remove(&self, service: &str, account: &str) -> Result<(), StoreError> {
            let t = target(service, account);
            if let Some(old) = read(&wide(&t))? {
                if let Some(n) = split_count(old.expose()) {
                    for i in 0..n {
                        delete(&part_target(&t, i))?;
                    }
                }
            }
            delete(&t)
        }
    }

    /// 칸 하나 쓰기(한도 안 값만 온다)
    fn write(t: &str, secret: &Secret) -> Result<(), StoreError> {
        let mut name = wide(t);
        let blob = secret.expose().as_bytes();
        let cred = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: name.as_mut_ptr(),
            CredentialBlobSize: blob.len() as u32,
            // 쓰기 함수는 읽기만 한다
            CredentialBlob: blob.as_ptr() as *mut u8,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        if unsafe { CredWriteW(&cred, 0) } == 0 {
            return Err(map_err(unsafe { GetLastError() }));
        }
        match read(&name)? {
            Some(back) if back == *secret => Ok(()),
            _ => Err(StoreError::Failed("자격 증명 관리자에 쓴 값이 되읽히지 않아요".into())),
        }
    }

    /// 칸 하나 지우기 — 없으면 그대로 성공
    fn delete(t: &str) -> Result<(), StoreError> {
        let name = wide(t);
        if unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0 {
            let e = unsafe { GetLastError() };
            if e != ERROR_NOT_FOUND {
                return Err(map_err(e));
            }
        }
        match read(&name)? {
            None => Ok(()),
            Some(_) => Err(StoreError::Failed("자격 증명 칸이 안 지워져요".into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 칸_이름은_서비스와_노드_ID() {
        assert_eq!(target("Chammo remote peer", "nEXAMPLE1CNTRL"), "Chammo remote peer/nEXAMPLE1CNTRL");
    }

    #[test]
    fn 한도_안_값은_한_칸_넘으면_나눠_둔다() {
        let (h, p) = split_blob("짧은 값");
        assert_eq!((h.as_str(), p.len()), ("짧은 값", 0));
        let big = format!("{{\"mcpOAuth\":\"{}한글\"}}", "a".repeat(BLOB_MAX * 2));
        let (h, p) = split_blob(&big);
        assert_eq!(split_count(&h), Some(p.len()));
        assert!(p.len() >= 3 && p.iter().all(|x| x.len() <= BLOB_MAX));
        assert_eq!(p.concat(), big);
        assert_eq!(split_count("{\"claudeAiOauth\":1}"), None);
        assert_eq!(part_target("Chammo account/slot", 2), "Chammo account/slot#2");
    }

    #[test]
    fn 오류에는_번호만() {
        assert_eq!(map_err(1312), StoreError::Locked);
        assert_eq!(map_err(5), StoreError::Denied);
        assert_eq!(map_err(87), StoreError::Failed("자격 증명 관리자 오류 87".into()));
    }

    /// 진짜 자격 증명 관리자 한 바퀴 — 윈도우 화면 세션에서만(SSH 세션 0 은 1312): `<시험 exe> wincred --ignored`
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn 실측_쓰고_읽고_덮고_지운다() {
        let (svc, acct) = (format!("Chammo test {}", std::process::id()), "nTEST");
        let s = WinCred;
        assert_eq!(s.get(&svc, acct), Ok(None), "없는 칸은 None");
        s.set(&svc, acct, &Secret::new("a".repeat(64))).unwrap();
        assert_eq!(s.get(&svc, acct).unwrap().unwrap().expose(), "a".repeat(64));
        s.set(&svc, acct, &Secret::new("b".repeat(64))).unwrap();
        assert_eq!(s.get(&svc, acct).unwrap().unwrap().expose(), "b".repeat(64), "같은 이름은 덮어쓴다");
        assert_eq!(s.get(&svc, "nOTHER"), Ok(None), "다른 기기 칸은 따로");
        s.remove(&svc, acct).unwrap();
        assert_eq!(s.get(&svc, acct), Ok(None));
        s.remove(&svc, acct).unwrap();
    }
}
