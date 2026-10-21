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
            read(&wide(&target(service, account)))
        }

        /// 같은 이름이 있으면 덮어쓴다(CredWriteW). 되읽어서 같아야 쓴 것이다
        fn set(&self, service: &str, account: &str, secret: &Secret) -> Result<(), StoreError> {
            let mut name = wide(&target(service, account));
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

        fn remove(&self, service: &str, account: &str) -> Result<(), StoreError> {
            let name = wide(&target(service, account));
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 칸_이름은_서비스와_노드_ID() {
        assert_eq!(target("Chammo remote peer", "nEXAMPLE1CNTRL"), "Chammo remote peer/nEXAMPLE1CNTRL");
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
