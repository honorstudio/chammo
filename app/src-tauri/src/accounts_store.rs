//! 계정 칸의 로그인 정보 저장소 — macOS 키체인(Security 프레임워크)과 테스트용 가짜.
//! 로그인 정보(토큰)는 결제·보안 급이다: 화면·로그·파일·오류 글 어디에도 찍지 않는다.
//! `security -i` 는 한 줄을 4,000자쯤에서 잘라 실제 로그인(11KB — MCP 로그인 포함)을 못 썼다(2026-10-02) → 프레임워크로 읽고 쓴다(길이 제한 없음, 프로세스 인자에 값 안 남음).
//! 단 Claude Code 로그인 칸(`Claude Code-credentials`)은 `/usr/bin/security` 로만 읽고 쓴다 — 그 칸은 security 명령이 만들어
//! 허용 목록에 security 가 들어 있다. 이 앱이 프레임워크로 직접 건드리면 허용 창이 떴고, '항상 허용'을 눌러도 연달아 또 떴다(2026-10-02 사용자).
//! 칸이 지워졌다 다시 만들어진 건 아니다(만든 시각 2026-09-12 그대로) — security 가 만든 칸의 'Apple 도구 전용' 표시(파티션 목록) 탓으로 본다
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

/// 로그인 정보 한 덩어리. Debug 로 찍어도 값은 안 나온다(실수로 로그에 남지 않게). Display 는 일부러 없다
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(s: impl Into<String>) -> Self {
        Secret(s.into())
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Secret(…{}자)", self.0.len())
    }
}

#[derive(Debug, PartialEq)]
pub enum StoreError {
    /// 키체인이 잠겼다(시험에선 창을 꺼 둬서 이걸로 끝난다)
    Locked,
    /// macOS 허용 창에서 거절했거나 창을 닫았다
    Denied,
    /// 그 밖의 실패 — 글에는 값이 절대 안 들어간다(오류 번호만)
    Failed(String),
}

pub trait Store {
    fn get(&self, service: &str, account: &str) -> Result<Option<Secret>, StoreError>;
    fn set(&self, service: &str, account: &str, secret: &Secret) -> Result<(), StoreError>;
    fn remove(&self, service: &str, account: &str) -> Result<(), StoreError>;
}

/// macOS 키체인.
/// - `path` 가 있으면 그 키체인 파일만 쓴다(시험 = 임시 키체인, 실제 로그인 키체인을 안 건드리게). 없으면 로그인(기본) 키체인
/// - `unlock` 이 있으면 쓰기 전에 그 비밀번호로 연다(시험 키체인)
/// - `quiet` 이면 macOS 창을 아예 못 띄운다 — 잠겼거나 허용이 필요하면 창 대신 오류로 끝난다(시험은 늘 quiet: 2026-10-02 사람 화면에 비밀번호 창이 떴다)
pub struct Keychain {
    pub path: Option<String>,
    pub unlock: Option<String>,
    pub quiet: bool,
    /// 이 서비스(Claude Code 로그인 칸)는 security 명령으로만
    pub cli_service: Option<String>,
}

const NOT_FOUND: i32 = -25300; // errSecItemNotFound

/// 프레임워크 오류 번호 → 우리 오류. 값은 안 담는다
pub fn map_code(code: i32) -> StoreError {
    match code {
        -128 | -25293 => StoreError::Denied,         // errSecUserCanceled · errSecAuthFailed
        -25308 => StoreError::Locked,                // errSecInteractionNotAllowed (quiet 인데 창이 필요했다)
        -25294 => StoreError::Failed("키체인 파일이 없어요".into()), // errSecNoSuchKeychain
        c => StoreError::Failed(format!("키체인 오류 {c}")),
    }
}

/// 속성 읽기(값 아님)만 security 명령으로 — 시간 제한
fn output(mut c: Command) -> Option<Output> {
    let mut child = c.spawn().ok()?;
    let end = Instant::now() + Duration::from_secs(20);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < end => std::thread::sleep(Duration::from_millis(30)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    child.wait_with_output().ok()
}

/// `-w` 는 보통 글 그대로 주지만, 글자가 아닌 바이트가 있으면 16진수로 준다
pub fn decode_w(out: &str) -> String {
    let s = out.strip_suffix('\n').unwrap_or(out);
    if !s.is_empty() && s.len() % 2 == 0 && !s.starts_with('{') && s.bytes().all(|b| b.is_ascii_hexdigit()) {
        if let Some(bytes) = (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect::<Option<Vec<u8>>>() {
            if let Ok(t) = String::from_utf8(bytes) {
                if t.trim_start().starts_with('{') {
                    return t;
                }
            }
        }
    }
    s.to_string()
}

pub fn hex(s: &str) -> String {
    s.bytes().map(|b| format!("{b:02x}")).collect()
}

/// 로그인 칸 쓰기 인자 — 값은 `-X` 16진수로 **인자에** 넣는다(Claude Code 가 큰 값을 쓸 때와 같은 방식).
/// `security -i` 의 stdin 은 한 줄 4,000자에서 잘려 11KB 로그인을 못 쓴다. 인자는 ARG_MAX(1MB)까지 된다.
/// 인자는 쓰는 동안 ps 에 보이지만, 이 칸은 허용 목록에 security 가 있어 같은 사용자 프로세스라면 언제든
/// `security find-generic-password -w` 로 창 없이 읽을 수 있다 — 인자로 넘긴다고 새로 열리는 공격면은 없다
pub fn add_args(service: &str, account: &str, secret: &Secret, path: Option<&str>) -> Vec<String> {
    let mut a: Vec<String> = ["add-generic-password", "-U", "-a", account, "-s", service, "-X"].map(String::from).to_vec();
    a.push(hex(secret.expose()));
    a.extend(path.map(String::from));
    a
}

/// security 명령 실행 — 시간 제한(넘으면 끄고 잠김으로)
fn run_cli(args: &[String], path: Option<&str>, keep_out: bool) -> Result<Output, StoreError> {
    let mut c = crate::platform::command("/usr/bin/security");
    c.args(args).args(path).stdin(Stdio::null()).stderr(Stdio::piped());
    c.stdout(if keep_out { Stdio::piped() } else { Stdio::null() });
    let mut child = c.spawn().map_err(|e| StoreError::Failed(e.to_string()))?;
    let end = Instant::now() + Duration::from_secs(90);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < end => std::thread::sleep(Duration::from_millis(30)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(StoreError::Locked);
            }
        }
    }
    child.wait_with_output().map_err(|e| StoreError::Failed(e.to_string()))
}

/// security 오류 — 값은 안 담는다(오류 글은 버리고 종료 코드만)
fn cli_fail(out: &Output) -> StoreError {
    let err = String::from_utf8_lossy(&out.stderr);
    match out.status.code() {
        Some(36) | Some(51) => StoreError::Locked,
        Some(128) => StoreError::Denied,
        _ if err.contains("User interaction is not allowed") => StoreError::Locked,
        c => StoreError::Failed(format!("security 종료 코드 {c:?}")),
    }
}

const CLI_NOT_FOUND: i32 = 44;

impl Keychain {
    pub fn via_cli(&self, service: &str) -> bool {
        self.cli_service.as_deref() == Some(service)
    }

    fn cli_get(&self, service: &str, account: &str) -> Result<Option<Secret>, StoreError> {
        let args = ["find-generic-password", "-s", service, "-a", account, "-w"].map(String::from);
        let out = run_cli(&args, self.path.as_deref(), true)?;
        match out.status.code() {
            Some(0) => Ok(Some(Secret(decode_w(&String::from_utf8_lossy(&out.stdout))))),
            Some(CLI_NOT_FOUND) => Ok(None),
            _ => Err(cli_fail(&out)),
        }
    }

    fn cli_set(&self, service: &str, account: &str, secret: &Secret) -> Result<(), StoreError> {
        let out = run_cli(&add_args(service, account, secret, None), self.path.as_deref(), false)?;
        // 되읽어서 같아야 쓴 것이다
        match self.cli_get(service, account)? {
            Some(back) if back == *secret => Ok(()),
            _ if !out.status.success() => Err(cli_fail(&out)),
            _ => Err(StoreError::Failed("로그인 칸에 쓴 값이 되읽히지 않아요".into())),
        }
    }

    fn cli_remove(&self, service: &str, account: &str) -> Result<(), StoreError> {
        let args = ["delete-generic-password", "-s", service, "-a", account].map(String::from);
        let out = run_cli(&args, self.path.as_deref(), false)?;
        match out.status.code() {
            Some(0) | Some(CLI_NOT_FOUND) => Ok(()),
            _ => Err(cli_fail(&out)),
        }
    }

    /// 칸의 키체인 계정 이름(acct)만 — 값은 안 읽는다. Claude Code 칸은 맥 사용자 이름으로 만들어져 있다.
    /// 시험 키체인(path)에선 안 본다(잠긴 시험 키체인을 security 로 건드리면 창이 뜰 수 있다)
    pub fn account_of(&self, service: &str) -> Option<String> {
        if self.path.is_some() {
            return None;
        }
        let mut c = crate::platform::command("/usr/bin/security");
        c.args(["find-generic-password", "-s", service]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
        let out = output(c)?;
        if !out.status.success() {
            return None;
        }
        acct_attr(&String::from_utf8_lossy(&out.stdout))
    }
}

/// `security find-generic-password` 속성 출력에서 "acct"<blob>="…"
pub fn acct_attr(text: &str) -> Option<String> {
    let line = text.lines().find(|l| l.trim_start().starts_with("\"acct\"<blob>="))?;
    let v = line.split_once("<blob>=")?.1.trim();
    v.strip_prefix('"')?.strip_suffix('"').map(str::to_string)
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use security_framework::os::macos::keychain::{KeychainUserInteractionLock, SecKeychain};

    impl Keychain {
        /// 키체인을 열고(시험이면 잠금 풀기), quiet 면 창 금지 잠금을 같이 돌려준다 — 일이 끝날 때까지 쥐고 있는다
        fn open(&self) -> Result<(SecKeychain, Option<KeychainUserInteractionLock>), StoreError> {
            let quiet = if self.quiet { Some(SecKeychain::disable_user_interaction().map_err(|e| map_code(e.code()))?) } else { None };
            let mut kc = match &self.path {
                Some(p) => SecKeychain::open(p),
                None => SecKeychain::default(),
            }
            .map_err(|e| map_code(e.code()))?;
            if let Some(pw) = &self.unlock {
                kc.unlock(Some(pw)).map_err(|_| StoreError::Locked)?;
            }
            Ok((kc, quiet))
        }

        fn read(kc: &SecKeychain, service: &str, account: &str) -> Result<Option<Secret>, StoreError> {
            match kc.find_generic_password(service, account) {
                Ok((pw, _)) => String::from_utf8(pw.to_owned()).map(|s| Some(Secret(s))).map_err(|_| StoreError::Failed("글자가 아닌 값".into())),
                Err(e) if e.code() == NOT_FOUND => Ok(None),
                Err(e) => Err(map_code(e.code())),
            }
        }
    }

    impl Store for Keychain {
        fn get(&self, service: &str, account: &str) -> Result<Option<Secret>, StoreError> {
            let (kc, _quiet) = self.open()?; // 시험 키체인이면 여기서 잠금이 풀린다 — security 명령도 창 없이
            if self.via_cli(service) {
                return self.cli_get(service, account);
            }
            Keychain::read(&kc, service, account)
        }

        /// 있으면 그 자리에서 값만 바꾼다(남이 만든 칸의 허용 목록을 그대로 두려고 — 지우고 새로 만들면 Claude Code 가 못 읽는다)
        fn set(&self, service: &str, account: &str, secret: &Secret) -> Result<(), StoreError> {
            let (kc, _quiet) = self.open()?;
            if self.via_cli(service) {
                return self.cli_set(service, account, secret);
            }
            let bytes = secret.expose().as_bytes();
            match kc.find_generic_password(service, account) {
                Ok((_, mut item)) => item.set_password(bytes).map_err(|e| map_code(e.code()))?,
                Err(e) if e.code() == NOT_FOUND => kc.add_generic_password(service, account, bytes).map_err(|e| map_code(e.code()))?,
                Err(e) => return Err(map_code(e.code())),
            }
            // 되읽어서 같아야 쓴 것이다
            match Keychain::read(&kc, service, account)? {
                Some(back) if back == *secret => Ok(()),
                _ => Err(StoreError::Failed("키체인에 쓴 값이 되읽히지 않아요".into())),
            }
        }

        fn remove(&self, service: &str, account: &str) -> Result<(), StoreError> {
            let (kc, _quiet) = self.open()?;
            if self.via_cli(service) {
                return self.cli_remove(service, account);
            }
            match kc.find_generic_password(service, account) {
                Ok((_, item)) => item.delete(),
                Err(e) if e.code() == NOT_FOUND => return Ok(()),
                Err(e) => return Err(map_code(e.code())),
            }
            match Keychain::read(&kc, service, account)? {
                None => Ok(()),
                Some(_) => Err(StoreError::Failed("키체인 칸이 안 지워져요".into())),
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
impl Store for Keychain {
    fn get(&self, _: &str, _: &str) -> Result<Option<Secret>, StoreError> {
        Err(StoreError::Failed("macOnly".into()))
    }
    fn set(&self, _: &str, _: &str, _: &Secret) -> Result<(), StoreError> {
        Err(StoreError::Failed("macOnly".into()))
    }
    fn remove(&self, _: &str, _: &str) -> Result<(), StoreError> {
        Err(StoreError::Failed("macOnly".into()))
    }
}


/// 테스트용 가짜 저장소 — 잠김·쓰기 실패를 흉내 낸다
#[cfg(test)]
pub mod fake {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[derive(Default)]
    pub struct Fake {
        pub items: RefCell<HashMap<(String, String), Secret>>,
        pub locked: RefCell<bool>,
        /// 이 서비스에 쓰면 실패
        pub fail_set: RefCell<Option<String>>,
        /// 실패할 때 반쯤 쓴 값을 남긴다(실제 security -i 가 잘린 값으로 칸을 만들고 실패했다)
        pub partial: RefCell<bool>,
    }

    impl Fake {
        pub fn put(&self, service: &str, account: &str, v: &str) {
            self.items.borrow_mut().insert((service.into(), account.into()), Secret::new(v));
        }
        pub fn val(&self, service: &str, account: &str) -> Option<String> {
            self.items.borrow().get(&(service.into(), account.into())).map(|s| s.expose().to_string())
        }
    }

    impl Store for Fake {
        fn get(&self, service: &str, account: &str) -> Result<Option<Secret>, StoreError> {
            if *self.locked.borrow() {
                return Err(StoreError::Locked);
            }
            Ok(self.items.borrow().get(&(service.into(), account.into())).cloned())
        }
        fn set(&self, service: &str, account: &str, secret: &Secret) -> Result<(), StoreError> {
            if *self.locked.borrow() {
                return Err(StoreError::Locked);
            }
            if self.fail_set.borrow().as_deref() == Some(service) {
                if *self.partial.borrow() {
                    self.items.borrow_mut().insert((service.into(), account.into()), Secret::new(&secret.expose()[..secret.expose().len() / 2]));
                }
                return Err(StoreError::Failed("가짜 쓰기 실패".into()));
            }
            self.items.borrow_mut().insert((service.into(), account.into()), secret.clone());
            Ok(())
        }
        fn remove(&self, service: &str, account: &str) -> Result<(), StoreError> {
            if *self.locked.borrow() {
                return Err(StoreError::Locked);
            }
            self.items.borrow_mut().remove(&(service.into(), account.into()));
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::fake::Fake;

    /// 실제 크기 — Claude Code 로그인 칸은 MCP 로그인까지 담아 11KB 였다(2026-10-02)
    pub fn big(tag: &str, kb: usize) -> String {
        let pad = "x".repeat(kb * 1024);
        format!("{{\"claudeAiOauth\":{{\"accessToken\":\"{tag}\"}},\"mcpOAuth\":{{\"pad\":\"{pad}\"}}}}")
    }

    #[test]
    fn 값은_debug_에_안_찍힌다() {
        let s = Secret::new("{\"claudeAiOauth\":{\"accessToken\":\"sk-ant-oat-XYZ\"}}");
        let shown = format!("{s:?}");
        assert!(!shown.contains("sk-ant"), "{shown}");
        assert!(format!("{:?}", StoreError::Locked).len() < 20);
    }

    #[test]
    fn acct_속성_읽기() {
        let t = "keychain: \"/x\"\nattributes:\n    \"acct\"<blob>=\"honor\"\n    \"svce\"<blob>=\"Claude Code-credentials\"\n";
        assert_eq!(acct_attr(t).as_deref(), Some("honor"));
        assert_eq!(acct_attr("attributes:\n    \"acct\"<blob>=<NULL>\n"), None);
    }

    #[test]
    fn 로그인_칸_쓰기_인자는_16진수만() {
        let v = Secret::new(big("SECRET-TOKEN", 12));
        let args = add_args("Claude Code-credentials", "me", &v, None);
        assert_eq!(&args[..7], &["add-generic-password", "-U", "-a", "me", "-s", "Claude Code-credentials", "-X"].map(String::from));
        assert_eq!(args[7], hex(v.expose()));
        assert_eq!(args.len(), 8);
        assert!(!args.iter().any(|a| a.contains("SECRET")));
        // 인자 하나가 ARG_MAX(1MB)보다 한참 작다 — 실제 11KB 는 16진수 22KB
        assert!(args[7].len() < 100 * 1024);
        assert_eq!(add_args("s", "a", &Secret::new("{}"), Some("/tmp/k")).last().map(String::as_str), Some("/tmp/k"));
    }

    #[test]
    fn w_출력_풀기() {
        assert_eq!(decode_w("{\"a\":1}\n"), "{\"a\":1}");
        assert_eq!(decode_w(&format!("{}\n", hex("{\"a\":1}"))), "{\"a\":1}");
        assert_eq!(decode_w("abcd"), "abcd");
    }

    #[test]
    fn 로그인_칸만_security_명령으로() {
        let kc = Keychain { path: None, unlock: None, quiet: false, cli_service: Some("Claude Code-credentials".into()) };
        assert!(kc.via_cli("Claude Code-credentials"));
        assert!(!kc.via_cli("Chammo account"));
        assert!(!Keychain { cli_service: None, ..kc }.via_cli("Claude Code-credentials"));
    }

    #[test]
    fn 오류_번호() {
        assert_eq!(map_code(-128), StoreError::Denied);
        assert_eq!(map_code(-25293), StoreError::Denied);
        assert_eq!(map_code(-25308), StoreError::Locked);
        assert!(matches!(map_code(-1), StoreError::Failed(_)));
    }

    #[test]
    fn 가짜_저장소도_실제_크기를_그대로() {
        let f = Fake::default();
        for kb in [12, 20] {
            let v = Secret::new(big("A", kb));
            f.set("s", "a", &v).unwrap();
            assert_eq!(f.get("s", "a").unwrap(), Some(v));
        }
    }

    /// 임시 키체인 하나 — 검색 목록에 안 넣고, 자동 잠금 끄고, 끝나면(실패해도) 지운다
    #[cfg(target_os = "macos")]
    struct TempKeychain(std::path::PathBuf);

    #[cfg(target_os = "macos")]
    impl TempKeychain {
        fn new(tag: &str) -> Self {
            use security_framework::os::macos::keychain::{CreateOptions, KeychainSettings};
            let path = std::env::temp_dir().join(format!("chammo-acct-{tag}-{}.keychain-db", std::process::id()));
            let _ = std::fs::remove_file(&path);
            let mut kc = CreateOptions::new().password("test").create(&path).expect("임시 키체인을 못 만듦");
            kc.set_settings(&KeychainSettings::new()).expect("자동 잠금 끄기"); // 잠금 간격 없음·잠자기 잠금 없음
            TempKeychain(path)
        }
        fn store(&self) -> Keychain {
            Keychain { path: Some(self.0.to_string_lossy().into()), unlock: Some("test".into()), quiet: true, cli_service: Some("Chammo test live".into()) }
        }
    }

    #[cfg(target_os = "macos")]
    impl Drop for TempKeychain {
        fn drop(&mut self) {
            let _ = crate::platform::command("/usr/bin/security").arg("delete-keychain").arg(&self.0).stdin(Stdio::null()).status();
            let _ = std::fs::remove_file(&self.0);
        }
    }

    /// 진짜 키체인 — 기본 cargo test 에선 안 돈다(CHAMMO_KEYCHAIN_TEST=1 일 때만). 창은 못 띄운다(quiet)
    #[cfg(target_os = "macos")]
    #[test]
    fn 임시_키체인에_실제_크기_값을_쓰고_읽고_지운다() {
        if std::env::var("CHAMMO_KEYCHAIN_TEST").as_deref() != Ok("1") {
            return;
        }
        let t = TempKeychain::new("size");
        let kc = t.store();
        assert_eq!(kc.get("Chammo account", "t1"), Ok(None));
        for (i, kb) in [12usize, 20, 1].into_iter().enumerate() {
            let v = Secret::new(big(&format!("v{i}"), kb));
            kc.set("Chammo account", "t1", &v).unwrap();
            assert_eq!(kc.get("Chammo account", "t1").unwrap(), Some(v), "{kb}KB");
            eprintln!("임시 키체인 {kb}KB 쓰고 읽음");
        }
        kc.remove("Chammo account", "t1").unwrap();
        assert_eq!(kc.get("Chammo account", "t1"), Ok(None));
        kc.remove("Chammo account", "t1").unwrap(); // 없어도 괜찮다
        // 비밀번호가 틀리면 창 없이 잠김으로
        let wrong = Keychain { unlock: Some("틀림".into()), ..t.store() };
        assert_eq!(wrong.get("Chammo account", "t1"), Err(StoreError::Locked));
        // 검색 목록에 안 들어갔다
        let list = String::from_utf8_lossy(&crate::platform::command("/usr/bin/security").arg("list-keychains").output().unwrap().stdout).to_string();
        assert!(!list.contains("chammo-acct"), "{list}");
    }

    /// 로그인 칸 자리(security 명령 길) — 임시 키체인에서 실제 크기 값. CHAMMO_KEYCHAIN_TEST=1 일 때만
    #[cfg(target_os = "macos")]
    #[test]
    fn 임시_키체인_로그인_칸은_security_명령으로_실제_크기() {
        if std::env::var("CHAMMO_KEYCHAIN_TEST").as_deref() != Ok("1") {
            return;
        }
        let t = TempKeychain::new("cli");
        let kc = t.store();
        assert_eq!(kc.get("Chammo test live", "me"), Ok(None));
        for (i, kb) in [12usize, 20, 1].into_iter().enumerate() {
            let v = Secret::new(big(&format!("live{i}"), kb));
            kc.set("Chammo test live", "me", &v).unwrap();
            assert_eq!(kc.get("Chammo test live", "me").unwrap(), Some(v), "{kb}KB");
            eprintln!("로그인 칸(security 명령) {kb}KB 쓰고 읽음");
        }
        // 우리 칸은 그대로 프레임워크 길
        let s = Secret::new("{\"claudeAiOauth\":{\"accessToken\":\"x\"}}");
        kc.set("Chammo account", "a1", &s).unwrap();
        assert_eq!(kc.get("Chammo account", "a1").unwrap(), Some(s));
        kc.remove("Chammo test live", "me").unwrap();
        assert_eq!(kc.get("Chammo test live", "me"), Ok(None));
    }

    /// 실제 로그인 키체인 확인 — CHAMMO_KEYCHAIN_PROBE=1 일 때만. 가짜 서비스 이름에 12KB 가짜 값을 쓰고 읽고 지운다.
    /// quiet 로 돌린다 = 창이 필요했다면 창 대신 Locked 로 끝난다(우리가 만든 칸이면 창이 필요 없어야 한다)
    #[cfg(target_os = "macos")]
    #[test]
    fn 로그인_키체인_가짜_칸_한_바퀴() {
        if std::env::var("CHAMMO_KEYCHAIN_PROBE").as_deref() != Ok("1") {
            return;
        }
        let kc = Keychain { path: None, unlock: None, quiet: true, cli_service: None };
        let (s, a) = ("Chammo account probe", "probe");
        let v = Secret::new(big("probe", 12));
        let r = kc.set(s, a, &v);
        let back = kc.get(s, a);
        let gone = kc.remove(s, a);
        eprintln!("프로브 쓰기 {r:?} · 읽기 같음 {} · 지우기 {gone:?}", back.as_ref().ok().and_then(|b| b.as_ref()) == Some(&v));
        assert_eq!(r, Ok(()));
        assert_eq!(back, Ok(Some(v)));
        assert_eq!(gone, Ok(()));
        assert_eq!(kc.get(s, a), Ok(None));
    }
}
