use super::*;

/// 실측(2026-10-06, claude 2.1.290 `auth login` pty 출력) 모양 그대로 — state·challenge 값만 가짜
const REAL: &str = "Opening browser to sign in\u{2026}\r\nIf the browser didn't open, visit: \x1b]8;;https://claude.com/cai/oauth/authorize?code=true&client_id=c1&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&code_challenge=CH&state=ST\x07\x1b[94mhttps://claude.com/cai/oauth/authorize?code=true&client_id=c1&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&code_challenge=CH&state=ST\x1b[39m\x1b]8;;\x07\r\nPaste code here if prompted > ";

#[test]
fn 키체인_고친_시각() {
    let attrs = "keychain: \"/Users/me/Library/Keychains/login.keychain-db\"\nattributes:\n    \"acct\"<blob>=\"me\"\n    \"mdat\"<timedate>=0x32303236313030353230343334345A00  \"20261005204344Z\\000\"\n    \"svce\"<blob>=\"Claude Code-credentials\"\n";
    // 2026-10-05 20:43:44 UTC
    assert_eq!(parse_mdat(attrs), Some(1_791_233_024_000));
    assert_eq!(parse_mdat("    \"mdat\"<timedate>=0x00  \"19700101000000Z\\000\""), Some(0));
    assert_eq!(parse_mdat("\"mdat\"<timedate>=<NULL>"), None);
    assert_eq!(parse_mdat("    \"mdat\"<timedate>=0x00  \"20261345204344Z\\000\""), None); // 13월
    assert_eq!(parse_mdat(""), None);
}

#[test]
fn 날짜_계산은_윤년도() {
    assert_eq!(days_from_civil(1970, 1, 1), 0);
    assert_eq!(days_from_civil(2000, 3, 1), 11_017);
    assert_eq!(days_from_civil(2024, 2, 29) + 1, days_from_civil(2024, 3, 1));
}

#[test]
fn 꾸밈_지우기_osc8_은_주소가_한_번만_글로() {
    let t = strip_ansi(REAL);
    assert!(t.contains("visit: https://claude.com/cai/oauth/authorize?code=true"));
    assert_eq!(t.matches("https://").count(), 1);
    assert!(t.ends_with("Paste code here if prompted > "));
    assert_eq!(strip_ansi("\x1b[1;31m빨강\x1b[0m"), "빨강");
    assert_eq!(strip_ansi("a\x1b]0;title\x1b\\b"), "ab"); // ESC \ 로 끝나는 OSC
}

#[test]
fn 로그인_주소_뽑기() {
    let u = parse_url(REAL).unwrap();
    assert!(u.starts_with("https://claude.com/cai/oauth/authorize?code=true&client_id=c1"));
    assert!(u.ends_with("&state=ST"));
    assert!(u.contains("redirect_uri=https%3A%2F%2Fplatform.claude.com"));
    assert_eq!(parse_url("Opening browser to sign in…"), None); // 아직 안 나옴
    // 보이는 글이 터미널 폭에서 줄바꿈돼도 OSC 8 링크 대상은 통째 — 그쪽을 먼저 쓴다
    let wrapped = "visit: \x1b]8;;https://claude.com/cai/oauth/authorize?code=true&state=LONG\x07https://claude.com/cai/oau\r\nth/authorize?code=true&state=LONG\x1b]8;;\x07\r\nPaste";
    assert_eq!(parse_url(wrapped).as_deref(), Some("https://claude.com/cai/oauth/authorize?code=true&state=LONG"));
    // 링크 대상이 남의 호스트면 안 준다
    assert_eq!(parse_url("visit: \x1b]8;;https://evil.example/x\x07https://claude.com/x\x1b]8;;\x07"), None);
    // 알려진 로그인 호스트가 아니면 안 준다
    assert_eq!(parse_url("visit: https://evil.example/oauth"), None);
    assert_eq!(parse_url("visit: https://claude.com.evil.example/x"), None);
    assert_eq!(parse_url("visit: http://claude.com/x"), None);
    assert_eq!(parse_url("visit: https://platform.claude.com/oauth/x"), Some("https://platform.claude.com/oauth/x".into()));
}

#[test]
fn 코드는_한_줄_코드_글자만() {
    assert!(code_ok("AbC123-_.~#xyz+/="));
    assert!(!code_ok(""));
    assert!(!code_ok("abc\rdef"));
    assert!(!code_ok("abc\ndef"));
    assert!(!code_ok("abc def"));
    assert!(!code_ok("abc;rm -rf"));
    assert!(!code_ok("\x03"));
    assert!(!code_ok(&"a".repeat(513)));
    assert!(code_ok(&"a".repeat(512)));
}

#[test]
fn 로그인_명령_한_줄() {
    assert_eq!(login_line("/Users/me/.local/bin/claude", false), "BROWSER=/usr/bin/true exec '/Users/me/.local/bin/claude' auth login");
    assert_eq!(login_line("/a/it's/claude", false), "BROWSER=/usr/bin/true exec '/a/it'\\''s/claude' auth login");
    assert_eq!(login_line("C:\\Users\\Me\\.local\\bin\\claude.exe", true), "\"C:\\Users\\Me\\.local\\bin\\claude.exe\" auth login");
}

#[test]
fn 폰_보기는_판단_파일과_흐름_상태() {
    let dir = std::env::temp_dir().join(format!("chammo-login-view-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    assert_eq!(phone_view(&dir)["need"], serde_json::Value::Null);
    std::fs::write(dir.join("login.json"), r#"{"need":{"since":1,"sessions":["imac"],"machine":false}}"#).unwrap();
    assert_eq!(phone_view(&dir)["need"]["need"]["sessions"][0], "imac");
    std::fs::write(dir.join("login.json"), "{깨짐").unwrap();
    assert_eq!(phone_view(&dir)["need"], serde_json::Value::Null);
    std::fs::write(dir.join("login.json"), "x".repeat(70 * 1024)).unwrap();
    assert_eq!(phone_view(&dir)["need"], serde_json::Value::Null);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 가짜 claude 로 폰 로그인 한 바퀴 — 주소 → 틀린 코드(실패) → 다시 → 맞는 코드(끝). 흐름은 앱에 하나라 한 테스트에서 차례로
#[cfg(unix)]
#[test]
fn 폰_로그인_흐름_가짜_claude() {
    use std::os::unix::fs::PermissionsExt;
    let dir = std::env::temp_dir().join(format!("chammo-login-flow-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let seen = dir.join("browser.txt");
    let fake = dir.join("claude");
    // 성공 글 뒤에도 claude 가 스스로 끝날 때까지 안 죽인다(oauthAccount 를 다 쓰게) — 끝에 남기는 표시로 확인
    let marker = dir.join("finished.txt");
    std::fs::write(
        &fake,
        format!(
            "#!/bin/sh\nprintf '%s' \"$BROWSER\" > '{}'\nif [ \"$1 $2\" = \"auth login\" ]; then\n  printf 'Opening browser to sign in\\r\\nIf the browser didn'\"'\"'t open, visit: \\033]8;;https://claude.com/cai/oauth/authorize?code=true&state=S1\\007\\033[94mhttps://claude.com/cai/oauth/authorize?code=true&state=S1\\033[39m\\033]8;;\\007\\r\\nPaste code here if prompted > '\n  read code\n  if [ \"$code\" = 'good-code#S1' ]; then echo 'Login successful'; sleep 1; touch '{marker}'; exit 0; fi\n  echo 'OAuth error: Invalid code'; exit 1\nfi\n",
            seen.display(),
            marker = marker.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let line = login_line(&fake.display().to_string(), false);
    let wait = |want: &str| {
        for _ in 0..100 {
            let st = flow_status();
            if st.state == want {
                return st;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        panic!("{want} 안 됨: {:?}", flow_status());
    };

    // 주소가 나오기 전엔 코드를 안 받는다
    assert_eq!(flow_status().state, "idle");
    assert_eq!(flow_code("good-code#S1").unwrap_err(), "no flow");
    flow_start(&line);
    let st = wait("waiting");
    assert_eq!(st.url.as_deref(), Some("https://claude.com/cai/oauth/authorize?code=true&state=S1"));
    assert_eq!(std::fs::read_to_string(&seen).unwrap(), "/usr/bin/true"); // 맥 화면에 브라우저를 안 띄운다
    // 두 번 눌러도 같은 흐름
    assert_eq!(flow_start(&line).url, st.url);
    // 줄바꿈 섞인 코드는 거절(pty 에 안 닿는다)
    assert_eq!(flow_code("bad\rcode").unwrap_err(), "bad code");
    // 틀린 코드 → 실패(code)
    flow_code("wrong-code").unwrap();
    let st = wait("failed");
    assert_eq!(st.error, Some("code"));
    assert_eq!(flow_code("good-code#S1").unwrap_err(), "not waiting");
    // 다시 시작 → 맞는 코드 → 끝
    flow_start(&line);
    wait("waiting");
    let st = flow_code("good-code#S1").unwrap();
    assert!(st.state == "checking" || st.state == "done");
    assert!(st.url.is_none()); // 코드를 넣은 뒤엔 주소도 안 보인다
    let st = flow_status();
    assert!(st.state == "checking" || st.state == "done", "{st:?}"); // 성공 글을 봐도 끝나기 전엔 확인 중
    wait("done");
    assert!(marker.is_file(), "claude 가 스스로 끝나기 전에 죽였다");
    // 그만두기
    flow_start(&line);
    wait("waiting");
    flow_cancel();
    assert_eq!(flow_status().state, "idle");
    let _ = std::fs::remove_dir_all(&dir);
}

/// 진짜 맥에서 읽기만 — `cargo test 진짜_로그인_상태 -- --ignored --nocapture`. 키체인 값·허용 창 없이 시각만
#[test]
#[ignore]
fn 진짜_로그인_상태() {
    let at = cred_at();
    let logged = crate::setup::auth_status(&crate::claude::claude_bin());
    eprintln!("credAt {at:?} · loggedIn {logged:?}");
    assert!(at.is_some());
}
