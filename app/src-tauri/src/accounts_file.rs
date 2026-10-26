//! 윈도우 Claude Code 로그인 칸 — 키체인이 아니라 `<설정 폴더>/.credentials.json` 파일이다(2026-10-26 윈도우 시험 PC 2.1.292 실측:
//! `C:\Users\<계정>\.claude\.credentials.json` 에 claudeAiOauth + mcpOAuth, 맥 키체인 값과 같은 모양).
//! 계정 칸(accounts.rs)은 로그인 칸을 Store 하나로 보니, 그 서비스 이름만 이 파일로 돌리고 나머지(칸에 보관하는 토큰·백업 칸)는 안쪽 저장소
//! (윈도우 = 자격 증명 관리자 wincred)로 넘긴다. 값은 화면·로그·오류 글에 안 나온다(오류는 종류만).
//! 쓰기 = 옆 임시 파일에 다 쓰고 이름 바꿔 끼우기 + 바로 전 내용을 `.credentials.json.chammo-backup` 한 벌로(되돌릴 손잡이, 같은 폴더·같은 권한).
//! 윈도우는 남이 열어 둔 파일을 못 바꿔 끼울 때가 있어(Claude Code 세션이 읽는 순간 — 교훈) 잠깐씩 다시 한다
use crate::accounts_store::{Secret, Store, StoreError};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub struct FileLive<S> {
    /// 이 서비스 이름(Claude Code 로그인 칸)만 파일로
    pub service: String,
    pub file: PathBuf,
    /// 그 밖의 칸
    pub inner: S,
    /// 시험판 — 안쪽 칸 서비스 이름 뒤에 붙여 진짜 앱의 칸과 섞이지 않게(CHAMMO_ACCOUNT_SLOT_TAG)
    pub tag: Option<String>,
}

const BACKUP_SUFFIX: &str = ".chammo-backup";
const TRIES: u32 = 20;

fn fail(what: &str, e: &std::io::Error) -> StoreError {
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => StoreError::Denied,
        k => StoreError::Failed(format!("로그인 파일 {what} 실패({k:?})")),
    }
}

/// 바로 옆 이름 — 같은 폴더라야 이름 바꾸기가 한 번에 된다
fn sibling(file: &Path, suffix: &str) -> PathBuf {
    let mut n = file.file_name().unwrap_or_default().to_os_string();
    n.push(suffix);
    file.with_file_name(n)
}

/// 다 쓴 뒤 이름 바꿔 끼우기 — 바꿔 끼우기가 막히면(남이 열어 둠) 잠깐씩 다시, 끝내 안 되면 임시 파일(값이 든)을 지우고 실패
pub fn write_atomic(file: &Path, content: &str, wait: Duration) -> Result<(), StoreError> {
    let target = if file.is_symlink() { std::fs::canonicalize(file).map_err(|e| fail("경로", &e))? } else { file.to_path_buf() };
    if let Some(d) = target.parent() {
        std::fs::create_dir_all(d).map_err(|e| fail("폴더", &e))?;
    }
    let tmp = sibling(&target, &format!(".chammo-{}", crate::tools::tmp_tag()));
    let wrote = (|| {
        std::fs::write(&tmp, content)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok::<(), std::io::Error>(())
    })();
    if let Err(e) = wrote {
        let _ = std::fs::remove_file(&tmp);
        return Err(fail("쓰기", &e));
    }
    let mut last = None;
    for i in 0..TRIES {
        if i > 0 {
            std::thread::sleep(wait);
        }
        match std::fs::rename(&tmp, &target) {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
    }
    let _ = std::fs::remove_file(&tmp);
    Err(fail("바꿔 끼우기", &last.expect("한 번은 돌았다")))
}

impl<S> FileLive<S> {
    pub fn backup_path(&self) -> PathBuf {
        sibling(&self.file, BACKUP_SUFFIX)
    }

    fn slot_service(&self, service: &str) -> String {
        match self.tag.as_deref().filter(|t| !t.is_empty()) {
            Some(t) => format!("{service} ({t})"),
            None => service.to_string(),
        }
    }

    fn read(&self) -> Result<Option<Secret>, StoreError> {
        match std::fs::read_to_string(&self.file) {
            Ok(t) => Ok(Some(Secret::new(t))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(fail("읽기", &e)),
        }
    }

    /// 바로 전 내용을 백업 한 벌로 — 지금 파일이 없거나 새 값과 같으면 안 쓴다
    fn backup(&self, next: Option<&Secret>) -> Result<(), StoreError> {
        match self.read()? {
            Some(now) if Some(&now) != next => write_atomic(&self.backup_path(), now.expose(), Duration::from_millis(100)),
            _ => Ok(()),
        }
    }
}

/// 계정 이름(account)은 안 본다 — 로그인 파일은 하나뿐
impl<S: Store> Store for FileLive<S> {
    fn get(&self, service: &str, account: &str) -> Result<Option<Secret>, StoreError> {
        if service == self.service {
            return self.read();
        }
        self.inner.get(&self.slot_service(service), account)
    }

    fn set(&self, service: &str, account: &str, secret: &Secret) -> Result<(), StoreError> {
        if service != self.service {
            return self.inner.set(&self.slot_service(service), account, secret);
        }
        self.backup(Some(secret))?;
        write_atomic(&self.file, secret.expose(), Duration::from_millis(100))?;
        // 되읽어서 같아야 쓴 것이다
        match self.read()? {
            Some(back) if back == *secret => Ok(()),
            _ => Err(StoreError::Failed("로그인 파일에 쓴 값이 되읽히지 않아요".into())),
        }
    }

    fn remove(&self, service: &str, account: &str) -> Result<(), StoreError> {
        if service != self.service {
            return self.inner.remove(&self.slot_service(service), account);
        }
        self.backup(None)?;
        match std::fs::remove_file(&self.file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(fail("지우기", &e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts_store::fake::Fake;

    const LIVE: &str = "Claude Code-credentials";

    struct Dir(PathBuf);
    impl Dir {
        fn new(tag: &str) -> Self {
            let d = std::env::temp_dir().join(format!("chammo-accfile-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&d);
            std::fs::create_dir_all(&d).unwrap();
            Dir(d)
        }
        fn store(&self, tag: Option<&str>) -> FileLive<Fake> {
            FileLive { service: LIVE.into(), file: self.0.join(".credentials.json"), inner: Fake::default(), tag: tag.map(String::from) }
        }
        /// 폴더에 남은 파일 이름들(임시 파일이 안 남았나)
        fn names(&self) -> Vec<String> {
            let mut v: Vec<String> = std::fs::read_dir(&self.0).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
            v.sort();
            v
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn cred(tag: &str) -> Secret {
        Secret::new(format!("{{\"claudeAiOauth\":{{\"accessToken\":\"{tag}\"}},\"mcpOAuth\":{{\"pad\":\"{}\"}}}}", "x".repeat(11 * 1024)))
    }

    #[test]
    fn 로그인_칸은_파일에서_읽는다_없으면_none() {
        let d = Dir::new("read");
        let s = d.store(None);
        assert_eq!(s.get(LIVE, "아무 이름"), Ok(None));
        std::fs::write(&s.file, cred("A").expose()).unwrap();
        // 계정 이름은 안 본다 — 파일 하나뿐
        assert_eq!(s.get(LIVE, ""), Ok(Some(cred("A"))));
        assert_eq!(s.get(LIVE, "me"), Ok(Some(cred("A"))));
        // 다른 서비스는 파일이 아니라 안쪽 저장소
        assert_eq!(s.get("Chammo account", "a1"), Ok(None));
    }

    #[test]
    fn 쓰기는_바꿔_끼우기_전_내용을_백업_한_벌로() {
        let d = Dir::new("write");
        let s = d.store(None);
        // 처음(파일 없음) — 백업할 게 없다
        s.set(LIVE, "", &cred("A")).unwrap();
        assert_eq!(std::fs::read_to_string(&s.file).unwrap(), cred("A").expose());
        assert!(!s.backup_path().exists());
        s.set(LIVE, "", &cred("B")).unwrap();
        assert_eq!(std::fs::read_to_string(&s.file).unwrap(), cred("B").expose());
        assert_eq!(std::fs::read_to_string(s.backup_path()).unwrap(), cred("A").expose(), "바로 전 것");
        s.set(LIVE, "", &cred("C")).unwrap();
        assert_eq!(std::fs::read_to_string(s.backup_path()).unwrap(), cred("B").expose(), "한 벌만 — 매번 바로 전 것");
        // 같은 값을 다시 써도 백업이 같은 값으로 덮이지 않는다(되돌릴 손잡이를 잃지 않게)
        s.set(LIVE, "", &cred("C")).unwrap();
        assert_eq!(std::fs::read_to_string(s.backup_path()).unwrap(), cred("B").expose());
        // 임시 파일이 안 남는다
        assert_eq!(d.names(), [".credentials.json", ".credentials.json.chammo-backup"]);
    }

    #[cfg(unix)]
    #[test]
    fn 파일과_백업은_나만_읽기() {
        use std::os::unix::fs::PermissionsExt;
        let d = Dir::new("perm");
        let s = d.store(None);
        s.set(LIVE, "", &cred("A")).unwrap();
        s.set(LIVE, "", &cred("B")).unwrap();
        for p in [s.file.clone(), s.backup_path()] {
            assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600, "{p:?}");
        }
    }

    #[test]
    fn 지우기도_백업_뒤에_없으면_그냥_됨() {
        let d = Dir::new("rm");
        let s = d.store(None);
        s.remove(LIVE, "").unwrap();
        s.set(LIVE, "", &cred("A")).unwrap();
        s.remove(LIVE, "").unwrap();
        assert_eq!(s.get(LIVE, ""), Ok(None));
        assert_eq!(std::fs::read_to_string(s.backup_path()).unwrap(), cred("A").expose());
    }

    #[test]
    fn 칸은_안쪽_저장소로_시험판은_이름표를_붙여() {
        let d = Dir::new("slots");
        let s = d.store(None);
        s.set("Chammo account", "a1", &cred("S")).unwrap();
        assert_eq!(s.inner.val("Chammo account", "a1").as_deref(), Some(cred("S").expose()));
        assert!(!s.file.exists(), "칸 값은 로그인 파일에 안 간다");
        let t = d.store(Some("test"));
        t.set("Chammo account", "backup-first", &cred("T")).unwrap();
        assert_eq!(t.inner.val("Chammo account (test)", "backup-first").as_deref(), Some(cred("T").expose()));
        assert_eq!(t.inner.val("Chammo account", "backup-first"), None, "진짜 앱 칸과 안 섞인다");
        assert_eq!(t.get("Chammo account", "backup-first"), Ok(Some(cred("T"))));
        t.remove("Chammo account", "backup-first").unwrap();
        assert_eq!(t.get("Chammo account", "backup-first"), Ok(None));
    }

    #[test]
    fn 바꿔_끼우기가_끝내_막히면_임시_파일을_안_남긴다() {
        let d = Dir::new("blocked");
        // 대상 자리에 폴더가 있으면 이름 바꾸기가 늘 실패한다(남이 쥐고 있는 파일 흉내)
        let target = d.0.join(".credentials.json");
        std::fs::create_dir_all(target.join("x")).unwrap();
        let r = write_atomic(&target, cred("A").expose(), Duration::from_millis(1));
        assert!(matches!(r, Err(StoreError::Failed(_)) | Err(StoreError::Denied)), "{r:?}");
        assert_eq!(d.names(), [".credentials.json"], "값이 든 임시 파일이 남았다");
        // 오류 글에 값이 없다
        assert!(!format!("{r:?}").contains("accessToken"));
    }

    #[test]
    fn 계정_바꿔_끼우기_한_바퀴가_파일로_된다() {
        // accounts.rs 의 실제 길(담기 → 바꾸기 → 백업 되돌리기)을 파일 칸으로
        use crate::accounts::{self, Live};
        let d = Dir::new("swap");
        let s = d.store(None);
        let json = d.0.join(".claude.json");
        let list = d.0.join("accounts.json");
        let live = Live { service: LIVE.into(), account: String::new(), claude_json: json.clone(), claude_dir: None, refresh: |o| Ok(o.clone()), owner: |_| None };
        let oa = serde_json::json!({ "accountUuid": "u1", "organizationUuid": "o1", "emailAddress": "a@x.com" });
        let ob = serde_json::json!({ "accountUuid": "u2", "organizationUuid": "o2", "emailAddress": "b@x.com" });
        let blob = |t: &str| Secret::new(format!("{{\"claudeAiOauth\":{{\"accessToken\":\"{t}\",\"expiresAt\":9999999999999}},\"mcpOAuth\":{{\"keep\":1}}}}"));
        // A 로그인 → 담기
        std::fs::write(&s.file, blob("A").expose()).unwrap();
        std::fs::write(&json, serde_json::json!({ "oauthAccount": oa, "other": 1 }).to_string()).unwrap();
        let (_, a, _) = accounts::capture(&s, &live, &list, None, "a1").unwrap();
        // B 로그인 → 담기
        std::fs::write(&s.file, blob("B").expose()).unwrap();
        std::fs::write(&json, serde_json::json!({ "oauthAccount": ob, "other": 1 }).to_string()).unwrap();
        let (_, b, _) = accounts::capture(&s, &live, &list, None, "b1").unwrap();
        // A 로 바꾸기 — 파일엔 A 토큰 + MCP 로그인 그대로, 표시도 A
        accounts::switch(&s, &live, &list, &a).unwrap();
        let now: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&s.file).unwrap()).unwrap();
        assert_eq!(now["claudeAiOauth"]["accessToken"], "A");
        assert_eq!(now["mcpOAuth"]["keep"], 1);
        assert_eq!(accounts::read_oauth(&json), Some(oa.clone()));
        // 파일 백업 = 바꾸기 전(B)
        let bak: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(s.backup_path()).unwrap()).unwrap();
        assert_eq!(bak["claudeAiOauth"]["accessToken"], "B");
        // 다시 B 로, 그리고 처음 백업으로 되돌리기
        accounts::switch(&s, &live, &list, &b).unwrap();
        assert_eq!(accounts::read_oauth(&json), Some(ob));
        accounts::restore(&s, &live, &list, accounts::BACKUP_LAST).unwrap();
        let now: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&s.file).unwrap()).unwrap();
        assert_eq!(now["claudeAiOauth"]["accessToken"], "A");
        assert_eq!(accounts::read_oauth(&json), Some(oa));
    }
}
