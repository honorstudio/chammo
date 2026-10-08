//! 같은 앱이 여러 벌 — 같은 번들 id 의 앱이 응용 프로그램 폴더에 둘 이상 깔렸거나, 나 말고 또 떠 있거나, 디스크 이미지(dmg)에서 바로 켰나.
//! 이슈 #1(2026-10-06): Chammo.app + Chammo 2.app + dmg 실행이 섞여 옛 0.1.4 가 몰래 같이 떠 있었고, 새로 깔고 이름을 바꾸며 맥 권한 승인도 풀렸다.
//! 알리기만 한다 — 다른 쪽을 끄거나 지우는 건 사람이 한다(자동으로 죽이지 않는다). 맥만, .app 으로 돌 때만(개발판은 CHAMMO_COPIES_CHECK=1 일 때)
use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Copy {
    pub path: String,
    pub version: String,
    /// 떠 있으면 프로세스 번호
    pub pid: Option<u32>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Copies {
    /// 나 말고 떠 있는 같은 앱
    pub running: Vec<Copy>,
    /// 나 말고 깔린 같은 앱(응용 프로그램 폴더)
    pub installed: Vec<Copy>,
    /// 나를 디스크 이미지(/Volumes/…)에서 바로 켰다
    pub from_dmg: bool,
}

/// 번들 정보 — (번들 id, 버전, 실행 파일 이름)
#[derive(Clone, Debug, PartialEq)]
pub struct Info {
    pub id: String,
    pub version: String,
    pub exe: String,
}

/// 실행 파일 경로(뒤에 인자가 붙어도 된다) → 그 .app 경로. ".../X 2.app/Contents/MacOS/X --y" → ".../X 2.app"
pub fn bundle_of(cmd: &str) -> Option<String> {
    let i = cmd.find(".app/Contents/MacOS/")?;
    Some(cmd[..i + 4].to_string())
}

/// `ps -axo pid=,command=` → (번호, 명령줄)
pub fn parse_ps(out: &str) -> Vec<(u32, String)> {
    out.lines()
        .filter_map(|l| {
            let l = l.trim_start();
            let (pid, rest) = l.split_once(char::is_whitespace)?;
            Some((pid.parse().ok()?, rest.trim_start().to_string()))
        })
        .collect()
}

/// XML Info.plist 에서 <key>k</key><string>v</string>
pub fn plist_string(text: &str, key: &str) -> Option<String> {
    let k = format!("<key>{key}</key>");
    let rest = &text[text.find(&k)? + k.len()..];
    let rest = rest.trim_start().strip_prefix("<string>")?;
    Some(rest[..rest.find("</string>")?].trim().to_string())
}

/// 명령줄이 그 번들의 본 앱인가 — 번들 안 다른 도구·헬퍼, 예약 깨우기 실행기(--routine-tick, launchd 가 1분마다 잠깐 띄움)는 안 센다
fn is_main(cmd: &str, bundle: &str, exe: &str) -> bool {
    let main = format!("{bundle}/Contents/MacOS/{exe}");
    cmd == main || cmd.strip_prefix(&main).is_some_and(|r| r.starts_with(' ') && !r.trim_start().starts_with(crate::routines::TICK_FLAG))
}

/// 판단 몸통 — 읽기는 넘겨받는다(테스트). me = 나의 번들 경로(개발판이면 None), apps = 응용 프로그램 폴더에 있는 .app 경로들
pub fn find(id: &str, me: Option<&str>, my_pid: u32, ps: &str, apps: &[String], read: impl Fn(&str) -> Option<Info>) -> Copies {
    let mut out = Copies { from_dmg: me.is_some_and(|m| m.starts_with("/Volumes/")), ..Default::default() };
    let mut cache: Vec<(String, Option<Info>)> = Vec::new();
    let mut info = |b: &str| -> Option<Info> {
        if let Some((_, i)) = cache.iter().find(|(k, _)| k == b) {
            return i.clone();
        }
        let i = read(b);
        cache.push((b.to_string(), i.clone()));
        i
    };
    for (pid, cmd) in parse_ps(ps) {
        if pid == my_pid {
            continue;
        }
        let Some(b) = bundle_of(&cmd) else { continue };
        let Some(i) = info(&b).filter(|i| i.id == id) else { continue };
        if is_main(&cmd, &b, &i.exe) {
            out.running.push(Copy { path: b, version: i.version, pid: Some(pid) });
        }
    }
    for a in apps {
        if me == Some(a.as_str()) {
            continue;
        }
        if let Some(i) = info(a).filter(|i| i.id == id) {
            out.installed.push(Copy { path: a.clone(), version: i.version, pid: None });
        }
    }
    out
}

/// Info.plist 읽기 — 글(XML)이 아니면 plutil 로 바꿔 읽는다
fn read_info(bundle: &str) -> Option<Info> {
    let p = format!("{bundle}/Contents/Info.plist");
    let raw = std::fs::read(&p).ok()?;
    let text = if raw.starts_with(b"bplist") {
        let o = crate::platform::command("/usr/bin/plutil").args(["-convert", "xml1", "-o", "-", &p]).output().ok()?;
        String::from_utf8_lossy(&o.stdout).into_owned()
    } else {
        String::from_utf8_lossy(&raw).into_owned()
    };
    Some(Info {
        id: plist_string(&text, "CFBundleIdentifier")?,
        version: plist_string(&text, "CFBundleShortVersionString").unwrap_or_default(),
        exe: plist_string(&text, "CFBundleExecutable").unwrap_or_default(),
    })
}

/// /Applications·~/Applications 바로 아래 .app 들(+ 그 안 폴더 한 단계 — 'Chammo 옛것/Chammo.app' 같은 것)
fn app_dirs(home: &str) -> Vec<String> {
    let mut out = Vec::new();
    for root in ["/Applications".to_string(), format!("{home}/Applications")] {
        let Ok(rd) = std::fs::read_dir(&root) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let s = p.to_string_lossy().into_owned();
            if s.ends_with(".app") {
                out.push(s);
            } else if p.is_dir() && !s.ends_with(".localized") {
                if let Ok(sub) = std::fs::read_dir(&p) {
                    out.extend(sub.flatten().map(|e| e.path().to_string_lossy().into_owned()).filter(|s| s.ends_with(".app")));
                }
            }
        }
    }
    out
}

#[tauri::command]
pub async fn app_copies(app: tauri::AppHandle) -> Copies {
    let id = app.config().identifier.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !cfg!(target_os = "macos") {
            return Copies::default();
        }
        let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        let me = bundle_of(&exe);
        if me.is_none() && std::env::var("CHAMMO_COPIES_CHECK").as_deref() != Ok("1") {
            return Copies::default(); // 개발판(tauri dev) — 다른 세션 개발판·진짜 앱과 섞어 보지 않는다
        }
        let ps = crate::platform::command("/bin/ps").args(["-axo", "pid=,command="]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
        find(&id, me.as_deref(), std::process::id(), &ps, &app_dirs(&crate::config::home()), read_info)
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "app.chammo.desktop";

    fn read(b: &str) -> Option<Info> {
        let v = |id: &str, ver: &str| Some(Info { id: id.into(), version: ver.into(), exe: "Chammo".into() });
        match b {
            "/Applications/Chammo.app" => v(ID, "0.2.4"),
            "/Applications/Chammo 2.app" => v(ID, "0.1.4"),
            "/Volumes/Chammo/Chammo.app" => v(ID, "0.2.4"),
            "/Applications/honor-orchestrator.app" => v("com.honorstudio.honor-orchestrator", "0.2.5"),
            _ => None,
        }
    }

    #[test]
    fn 번들_경로_뽑기() {
        assert_eq!(bundle_of("/Applications/Chammo 2.app/Contents/MacOS/Chammo --x").as_deref(), Some("/Applications/Chammo 2.app"));
        assert_eq!(bundle_of("/usr/bin/ssh host"), None);
    }

    #[test]
    fn ps_줄_읽기() {
        let out = "  123 /Applications/Chammo 2.app/Contents/MacOS/Chammo\n 45 /bin/zsh -l\nbad line\n";
        assert_eq!(parse_ps(out), vec![(123, "/Applications/Chammo 2.app/Contents/MacOS/Chammo".into()), (45, "/bin/zsh -l".into())]);
    }

    #[test]
    fn plist_값() {
        let t = "<dict>\n\t<key>CFBundleIdentifier</key>\n\t<string>app.chammo.desktop</string>\n\t<key>CFBundleShortVersionString</key><string>0.2.4</string></dict>";
        assert_eq!(plist_string(t, "CFBundleIdentifier").as_deref(), Some(ID));
        assert_eq!(plist_string(t, "CFBundleShortVersionString").as_deref(), Some("0.2.4"));
        assert_eq!(plist_string(t, "CFBundleExecutable"), None);
    }

    #[test]
    fn 이슈_1_그대로_두_벌_실행과_두_벌_설치() {
        let ps = " 10 /Applications/Chammo.app/Contents/MacOS/Chammo\n 20 /Applications/Chammo 2.app/Contents/MacOS/Chammo\n 30 /Applications/honor-orchestrator.app/Contents/MacOS/honor-orchestrator\n";
        let apps = vec!["/Applications/Chammo.app".into(), "/Applications/Chammo 2.app".into(), "/Applications/honor-orchestrator.app".into()];
        let c = find(ID, Some("/Applications/Chammo.app"), 10, ps, &apps, read);
        assert_eq!(c.running, vec![Copy { path: "/Applications/Chammo 2.app".into(), version: "0.1.4".into(), pid: Some(20) }]);
        assert_eq!(c.installed, vec![Copy { path: "/Applications/Chammo 2.app".into(), version: "0.1.4".into(), pid: None }]);
        assert!(!c.from_dmg);
    }

    #[test]
    fn 혼자면_아무것도_없다_번들_id_가_다른_앱은_남이다() {
        let ps = " 10 /Applications/Chammo.app/Contents/MacOS/Chammo\n 30 /Applications/honor-orchestrator.app/Contents/MacOS/honor-orchestrator\n";
        let apps = vec!["/Applications/Chammo.app".into(), "/Applications/honor-orchestrator.app".into()];
        assert_eq!(find(ID, Some("/Applications/Chammo.app"), 10, ps, &apps, read), Copies::default());
    }

    #[test]
    fn 예약_깨우기_실행은_두_번째_앱이_아니다() {
        // launchd 가 1분마다 앱 실행 파일을 --routine-tick 으로 잠깐 띄운다 — 창 없는 실행기라 세면 거짓 알림
        let ps = " 10 /Applications/Chammo.app/Contents/MacOS/Chammo\n 11 /Applications/Chammo.app/Contents/MacOS/Chammo --routine-tick\n";
        assert_eq!(find(ID, Some("/Applications/Chammo.app"), 10, ps, &[], read), Copies::default());
    }

    #[test]
    fn dmg_에서_켠_것과_같은_번들의_두_번째_실행() {
        let ps = " 10 /Volumes/Chammo/Chammo.app/Contents/MacOS/Chammo\n 11 /Volumes/Chammo/Chammo.app/Contents/MacOS/Chammo -psn_0\n 12 /Volumes/Chammo/Chammo.app/Contents/MacOS/chammo-vdisplay\n";
        let c = find(ID, Some("/Volumes/Chammo/Chammo.app"), 10, ps, &["/Applications/Chammo.app".into()], read);
        assert!(c.from_dmg);
        // 같은 번들 두 번째 실행(open -n)은 세고, 번들 안 도구(chammo-vdisplay)는 안 센다
        assert_eq!(c.running.iter().map(|r| r.pid).collect::<Vec<_>>(), vec![Some(11)]);
        assert_eq!(c.installed.len(), 1);
    }
}
