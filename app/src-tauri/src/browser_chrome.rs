//! 크롬 베타 깔기 — 관리자 암호 없이, 구글 서명을 확인한 것만.
//! 맥: 유니버설 DMG → codesign(구글 팀 EQHXZ8M8AV + 베타 번들) + spctl(공증) → /Applications(쓸 수 있으면) 아니면 ~/Applications.
//! 윈도우: 구글 태그 설치기(needsadmin=false = 사용자 설치) → Authenticode(Google LLC) → /silent /install.
//! 세션 크롬이 사용자 크롬과 Dock·⌘Tab 에서 섞이지 않게 베타를 쓴다(2026-10-03) — Chrome for Testing·Chromium 은 받지 않는다
use std::path::{Path, PathBuf};

/// 맥 크롬 베타(유니버설). 옛 주소(…/mac/beta/…)는 v92 를 줬다(교훈)
pub const BETA_DMG: &str = "https://dl.google.com/chrome/mac/universal/beta/googlechromebeta.dmg";
/// 크롬 베타 서명 요구 — 구글 팀 + 베타 번들 이름. --strict 는 구글 DMG 자체가 'detritus' 로 실패해서 안 건다(2026-10-05 실측)
pub const BETA_REQ: &str = r#"anchor apple generic and identifier "com.google.Chrome.beta" and certificate leaf[subject.OU] = "EQHXZ8M8AV""#;
/// 윈도우 크롬 베타 — 구글 설치기에 태그(needsadmin=false = 사용자 설치, 관리자 창 없음)
pub const BETA_WIN: &str = "https://dl.google.com/tag/s/appguid%3D%7B8237E44A-0054-442C-B6B6-EA0509993955%7D%26iid%3D%7B00000000-0000-0000-0000-000000000000%7D%26lang%3Den%26browser%3D4%26usagestats%3D0%26appname%3DGoogle%2520Chrome%2520Beta%26needsadmin%3Dfalse/update2/installers/ChromeSetup.exe";
const BETA_APP: &str = "Google Chrome Beta.app";
/// 크롬 베타가 깔린 자리(없으면 None) — 맥 /Applications·~/Applications, 윈도우 LOCALAPPDATA·Program Files.
/// tools/chammo-browser/src/window.js chromeLaunch 와 같은 자리를 본다
pub fn beta_installed(win: bool, home: &str, env: impl Fn(&str) -> Option<String>, exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let cands: Vec<PathBuf> = if win {
        ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"]
            .iter()
            .filter_map(|k| env(k))
            .map(|r| PathBuf::from(format!(r"{}\Google\Chrome Beta\Application\chrome.exe", r.trim_end_matches(['\\', '/']))))
            .collect()
    } else {
        vec![Path::new("/Applications").join(BETA_APP), Path::new(home).join("Applications").join(BETA_APP)]
    };
    cands.into_iter().find(|p| exists(p))
}

/// 크롬 베타를 둘 폴더 — /Applications 에 쓸 수 있으면(관리자 계정) 거기, 아니면 ~/Applications(관리자 암호 없이)
pub fn app_dest(applications_writable: bool, home: &str) -> PathBuf {
    if applications_writable {
        PathBuf::from("/Applications")
    } else {
        Path::new(home).join("Applications")
    }
}

/// 진짜로 써 보고 지운다(권한 비트만 보면 ACL·SIP 를 놓친다)
pub fn writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".chammo-write-{}", std::process::id()));
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

/// 구글 서명·공증 확인(맥) — 둘 다 통과해야 쓴다
pub fn verify_beta_mac(app: &Path, deep: bool) -> Result<(), String> {
    let mut c = crate::platform::command("/usr/bin/codesign");
    c.arg("--verify");
    if deep {
        c.arg("--deep");
    }
    let out = crate::platform::run_capped(c.arg(format!("-R={BETA_REQ}")).arg(app), std::time::Duration::from_secs(180)).map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("{} ({})", crate::i18n::tr("받은 크롬의 서명이 구글 것이 아니에요", "The downloaded Chrome is not signed by Google"), String::from_utf8_lossy(&out.stderr).lines().next().unwrap_or("").trim()));
    }
    if deep {
        let sp = crate::platform::run_capped(crate::platform::command("/usr/sbin/spctl").args(["-a", "-t", "exec"]).arg(app), std::time::Duration::from_secs(120)).map_err(|e| e.to_string())?;
        if !sp.status.success() {
            return Err(format!("{} ({})", crate::i18n::tr("받은 크롬이 애플 공증 확인을 통과하지 못했어요", "The downloaded Chrome failed Apple's notarization check"), String::from_utf8_lossy(&sp.stderr).lines().next().unwrap_or("").trim()));
        }
    }
    Ok(())
}

/// 붙인 DMG 는 무슨 일이 있어도 뗀다
struct Mounted(PathBuf);
impl Drop for Mounted {
    fn drop(&mut self) {
        detach(&self.0);
    }
}

/// DMG 떼기(앱이 도중에 꺼져 붙은 채 남은 것도)
pub fn detach(mnt: &Path) {
    let _ = crate::platform::run_capped(crate::platform::command("/usr/bin/hdiutil").args(["detach", "-force"]).arg(mnt), std::time::Duration::from_secs(60));
    let _ = std::fs::remove_dir(mnt);
}

/// DMG → 서명·공증 확인 → dest_dir 에 복사(임시 이름 → 바꿔치기). 이미 누가 깔았으면 그대로 둔다
pub fn install_beta_mac(dmg: &Path, work: &Path, dest_dir: &Path, say: &dyn Fn(&str)) -> Result<PathBuf, String> {
    let mnt = work.join(format!("mnt-{}", std::process::id()));
    std::fs::create_dir_all(&mnt).map_err(|e| e.to_string())?;
    let out = crate::platform::run_capped(
        crate::platform::command("/usr/bin/hdiutil").args(["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint"]).arg(&mnt).arg(dmg),
        std::time::Duration::from_secs(300),
    )
    .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let _ = std::fs::remove_dir(&mnt);
        return Err(format!("{} ({})", crate::i18n::tr("받은 크롬 디스크 이미지를 열지 못했어요", "Could not open the downloaded Chrome disk image"), String::from_utf8_lossy(&out.stderr).trim()));
    }
    let _guard = Mounted(mnt.clone());
    let src = mnt.join(BETA_APP);
    if !src.is_dir() {
        return Err("Google Chrome Beta.app not in the disk image".into());
    }
    say(crate::i18n::tr("크롬 베타 서명 확인하는 중", "Checking Chrome Beta's signature"));
    verify_beta_mac(&src, true)?;
    let fin = dest_dir.join(BETA_APP);
    if fin.exists() {
        return Ok(fin);
    }
    say(crate::i18n::tr("크롬 베타 옮기는 중", "Copying Chrome Beta"));
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    clean_parts(dest_dir, crate::platform::pid_alive);
    let part = dest_dir.join(format!(".{BETA_APP}.chammo-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&part);
    let cp = crate::platform::run_capped(crate::platform::command("/usr/bin/ditto").arg(&src).arg(&part), std::time::Duration::from_secs(600)).map_err(|e| e.to_string())?;
    let done = if !cp.status.success() {
        Err(format!("ditto: {}", String::from_utf8_lossy(&cp.stderr).trim()))
    } else {
        verify_beta_mac(&part, false).and_then(|_| std::fs::rename(&part, &fin).map_err(|e| e.to_string()))
    };
    if done.is_err() {
        let _ = std::fs::remove_dir_all(&part);
    }
    done.map(|_| fin)
}

/// 앱이 복사 도중 꺼져 남은 반쪽 복사본(.Google Chrome Beta.app.chammo-<pid>, 730MB 숨은 폴더) — 그 pid 가 죽었을 때만 지운다
pub fn clean_parts(dest_dir: &Path, alive: impl Fn(i32) -> bool) {
    let prefix = format!(".{BETA_APP}.chammo-");
    let Ok(rd) = std::fs::read_dir(dest_dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(pid) = name.strip_prefix(&prefix).and_then(|p| p.parse::<i32>().ok()) else { continue };
        if !alive(pid) {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

/// 윈도우 설치기 서명 — Authenticode 유효 + 서명자 Google LLC. 경로는 환경 변수로 넘긴다(스크립트에 글자로 안 끼운다)
pub const WIN_SIG_PS: &str = "$s = Get-AuthenticodeSignature -LiteralPath $env:CHAMMO_FILE; if ($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -match '(^|, )O=Google LLC(,|$)') { exit 0 } else { Write-Output $s.Status; exit 1 }";

#[cfg_attr(not(windows), allow(dead_code))]
pub fn install_beta_win(setup: &Path, poll: &dyn Fn() -> bool, say: &dyn Fn(&str)) -> Result<(), String> {
    say(crate::i18n::tr("크롬 베타 서명 확인하는 중", "Checking Chrome Beta's signature"));
    let ps = crate::platform::run_capped(
        crate::platform::command(crate::browser_get::sys_tool("WindowsPowerShell\\v1.0\\powershell")).args(["-NoProfile", "-NonInteractive", "-Command", WIN_SIG_PS]).env("CHAMMO_FILE", setup),
        std::time::Duration::from_secs(60),
    )
    .map_err(|e| e.to_string())?;
    if !ps.status.success() {
        return Err(format!("{} ({})", crate::i18n::tr("받은 크롬의 서명이 구글 것이 아니에요", "The downloaded Chrome is not signed by Google"), String::from_utf8_lossy(&ps.stdout).trim()));
    }
    say(crate::i18n::tr("크롬 베타 설치하는 중", "Installing Chrome Beta"));
    // 설치기가 나머지를 받아 깐다(사용자 설치라 관리자 창 없음). 끝난 뒤에도 파일이 늦게 보일 수 있어 2분까지 본다
    let _ = crate::platform::run_capped(crate::platform::command(setup).args(["/silent", "/install"]), std::time::Duration::from_secs(900));
    for _ in 0..120 {
        if poll() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    Err(crate::i18n::tr("크롬 베타 설치가 끝나지 않았어요. 다시 시도해 주세요.", "Chrome Beta did not finish installing. Please try again.").into())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 크롬_베타_자리_관리자_아니면_내_응용프로그램() {
        assert_eq!(app_dest(true, "/Users/u"), PathBuf::from("/Applications"));
        assert_eq!(app_dest(false, "/Users/u"), PathBuf::from("/Users/u/Applications"));
        let has = |set: &'static [&'static str]| move |p: &Path| set.iter().any(|s| Path::new(s) == p);
        assert_eq!(beta_installed(false, "/Users/u", |_| None, has(&["/Users/u/Applications/Google Chrome Beta.app"])), Some(PathBuf::from("/Users/u/Applications/Google Chrome Beta.app")));
        assert_eq!(beta_installed(false, "/Users/u", |_| None, has(&["/Applications/Google Chrome.app"])), None); // 일반 크롬은 베타가 아니다
        let env = |k: &str| (k == "LOCALAPPDATA").then(|| r"C:\Users\u\AppData\Local".to_string());
        assert_eq!(beta_installed(true, "", env, has(&[r"C:\Users\u\AppData\Local\Google\Chrome Beta\Application\chrome.exe"])).is_some(), true);
    }

    #[cfg(unix)]
    #[test]
    fn 쓰기_권한은_진짜로_써_본다() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("chammo-w-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        assert!(writable(&d));
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o555)).unwrap();
        assert!(!writable(&d)); // 관리자 아닌 계정의 /Applications 처럼
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 꺼져서_남은_반쪽_복사본만_치운다() {
        let d = std::env::temp_dir().join(format!("chammo-parts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        for n in [".Google Chrome Beta.app.chammo-111", ".Google Chrome Beta.app.chammo-222", "Google Chrome Beta.app", ".Google Chrome Beta.app.chammo-x", "Other.app"] {
            std::fs::create_dir_all(d.join(n)).unwrap();
        }
        clean_parts(&d, |pid| pid == 222); // 222 는 아직 복사 중
        let mut left: Vec<String> = std::fs::read_dir(&d).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, vec![".Google Chrome Beta.app.chammo-222", ".Google Chrome Beta.app.chammo-x", "Google Chrome Beta.app", "Other.app"]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn 윈도우_서명_확인은_경로를_스크립트에_안_끼운다() {
        assert!(WIN_SIG_PS.contains("$env:CHAMMO_FILE"));
        assert!(WIN_SIG_PS.contains("(^|, )O=Google LLC(,|$)")); // O=Google LLC Foo 같은 이름은 안 받는다
        assert!(BETA_WIN.contains("needsadmin%3Dfalse"));
        assert!(BETA_WIN.contains("8237E44A-0054-442C-B6B6-EA0509993955")); // 크롬 베타 appguid
        assert!(BETA_DMG.contains("/universal/beta/"));
    }

    /// 받아 둔 진짜 DMG 로 서명 확인·복사까지 — 손으로: CHAMMO_BETA_DMG=<dmg> cargo test 베타_dmg_진짜로 -- --ignored
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn 베타_dmg_진짜로() {
        let dmg = PathBuf::from(std::env::var("CHAMMO_BETA_DMG").expect("CHAMMO_BETA_DMG"));
        let d = std::env::temp_dir().join(format!("chammo-beta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("work")).unwrap();
        let app = install_beta_mac(&dmg, &d.join("work"), &d.join("Apps"), &|t| eprintln!("{t}")).unwrap();
        assert!(app.join("Contents/MacOS/Google Chrome Beta").is_file());
        verify_beta_mac(&app, false).unwrap();
        // 붙인 자리는 떼고 지웠다
        assert_eq!(std::fs::read_dir(d.join("work")).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&d);
    }
}
