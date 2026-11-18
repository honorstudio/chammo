// 오류 보고(ADR 0033) 시험 — 칸 모양, 버리기, 쌓기·보내기, 스위치, 실제 꼴 오류에서 개인 값 0
use super::*;
use crate::usage_ping::{Gate, PUBLIC_ID, PUBLIC_NAME};

fn tmp(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-crash-{name}-{}", crate::tools::tmp_tag()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn gate() -> Gate {
    Gate { on: true, identifier: PUBLIC_ID.into(), product: PUBLIC_NAME.into(), debug: false, real_data: true, setup_done: true, test: false }
}

fn base() -> Base<'static> {
    Base { version: "0.5.0", ch: "release", default_server: true }
}

fn panic_at(loc: &str) -> Report {
    Report { kind: "panic".into(), loc: Some(loc.into()), form: Some("other".into()), n: 1, ..Default::default() }
}

#[test]
fn 위치_칸_모양() {
    for ok in ["src/team_relay.rs:502:9", "src/a/b.rs:1:2", "tokio@1.40.0", "serde_json@1.0.128", "std", "other"] {
        assert!(valid_loc(ok), "{ok}");
    }
    for bad in [
        "/Users/kimminji/Desktop/dev/x/src/main.rs:1:1",
        "~/.cargo/registry/src/index.crates.io-6f17/tokio-1.40.0/src/x.rs:3:4",
        "src/거래처/x.rs:1:1",
        "src/../../Users/kim.rs:1:1",
        "src/x.rs:1:1\nkimminji",
        "src/x.rs:1:1 ",
        "src/x.rs:1",
        "src/x.rs:1:1:1",
        "C:\\Users\\kim\\src\\x.rs:1:1",
        "src/X.rs:1:1",
        "src//x.rs:1:1",
        "src/.rs:1:1",
        "northwind-app@1.0",
        "Northwind@1.0.0",
        "kim@northwind.co.kr",
        "",
    ] {
        assert!(!valid_loc(bad), "{bad:?}");
    }
}

#[test]
fn 프레임_칸_모양() {
    for ok in ["index-AbC123.js:12:345", "vendor.es-9f_x.js:1:2"] {
        assert!(valid_frame(ok), "{ok}");
    }
    for bad in ["../Users/kim/a.js:1:1", ".env.js:1:1", "a.js:1", "a.js:1:1\n", "거래처.js:1:1", "a b.js:1:1", "a.js:x:1", "a.ts:1:1", ""] {
        assert!(!valid_frame(bad), "{bad:?}");
    }
}

#[test]
fn 위치를_칸으로() {
    assert_eq!(loc_of("src/team_relay.rs", 502, 9), "src/team_relay.rs:502:9");
    assert_eq!(loc_of("~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-1.40.0/src/runtime/x.rs", 3, 4), "tokio@1.40.0");
    assert_eq!(loc_of("C:\\Users\\김민지\\.cargo\\registry\\src\\index.crates.io-1949cf8c6b5b557f\\serde_json-1.0.128\\src\\de.rs", 1, 1), "serde_json@1.0.128");
    assert_eq!(loc_of("/rustc/90b35a6239c3d8bdabc530a6a0816f7ff89a0aaf/library/core/src/str/mod.rs", 1, 1), "std");
    // remap 이 빠진 빌드 — 절대 경로는 통째로 버린다
    assert_eq!(loc_of("/Users/kimminji/Desktop/dev/northwind-app/src/main.rs", 1, 1), "other");
    assert_eq!(loc_of("C:\\Users\\kim\\Desktop\\dev\\거래처A\\src\\main.rs", 1, 1), "other");
    // 크레이트 이름 자리에 이상한 것 — 판 모양이 아니면 버린다
    assert_eq!(loc_of("~/.cargo/registry/src/idx/northwind-app-secret/src/x.rs", 1, 1), "other");
}

#[test]
fn panic_글은_꼴_이름만() {
    assert_eq!(form_of("index out of bounds: the len is 0 but the index is 3"), "index-oob");
    assert_eq!(form_of("called `Option::unwrap()` on a `None` value"), "unwrap-none");
    assert_eq!(form_of("called `Result::unwrap()` on an `Err` value: Os { code: 2, message: \"/Users/kimminji/x\" }"), "unwrap-err");
    assert_eq!(form_of("attempt to subtract with overflow"), "overflow");
    assert_eq!(form_of("already mutably borrowed: BorrowError"), "borrow");
    assert_eq!(form_of("byte index 3 is not a char boundary; it is inside '거' (bytes 2..5) of `거래처A 견적`"), "str-index");
    assert_eq!(form_of("거래처A 대표님께 보낼 견적 파일이 없음"), "other");
}

#[test]
fn 창_이름은_앞부분만() {
    assert_eq!(at_of("main"), "main");
    assert_eq!(at_of("team-northwind-app"), "team");
    assert_eq!(at_of("mode-거래처A달력"), "mode");
    assert_eq!(at_of("reader-3"), "reader");
    assert_eq!(at_of("bubble"), "bubble");
    assert_eq!(at_of("webpage"), "other");
    assert_eq!(at_of("other"), "other");
    assert_eq!(at_of(""), "other");
    assert_eq!(name_of("TypeError"), "TypeError");
    assert_eq!(name_of("NorthwindError"), "other");
}

#[test]
fn 스택에서_우리_번들_프레임만() {
    let webkit = "render@tauri://localhost/assets/index-AbC123.js:12:345\n\
                  blob:tauri://localhost/9f1c:1:1\n\
                  x@asset://localhost/%2FUsers%2Fkimminji%2Fmode.js:1:1\n\
                  y@https://northwind-app.vercel.app/assets/a.js:3:4\n\
                  @tauri://localhost/assets/vendor-Xy9.js:7:8";
    assert_eq!(frames_of(webkit), vec!["index-AbC123.js:12:345", "vendor-Xy9.js:7:8"]);
    let v8 = "TypeError: Cannot read properties of undefined (reading '거래처A')\n    at Chat (http://tauri.localhost/assets/index-AbC123.js:1:2)\n    at https://tauri.localhost/assets/x.js:3:4";
    assert_eq!(frames_of(v8), vec!["index-AbC123.js:1:2", "x.js:3:4"]);
    let many = (0..9).map(|i| format!("f@tauri://localhost/assets/a{i}.js:{i}:1")).collect::<Vec<_>>().join("\n");
    assert_eq!(frames_of(&many).len(), MAX_FRAMES);
    assert!(frames_of("tauri://localhost/assets/../../Users/kim/a.js:1:1").is_empty());
}

#[test]
fn 칸이_하나라도_어긋나면_버린다() {
    assert!(valid(&panic_at("src/x.rs:1:1")));
    let mut r = panic_at("src/x.rs:1:1");
    r.name = Some("TypeError".into());
    assert!(!valid(&r), "panic 에 webview 칸");
    let mut r = panic_at("src/x.rs:1:1");
    r.form = Some("거래처".into());
    assert!(!valid(&r));
    let mut r = panic_at("src/x.rs:1:1");
    r.n = 0;
    assert!(!valid(&r));
    r.n = MAX_N + 1;
    assert!(!valid(&r));
    assert!(!valid(&Report { kind: "pty".into(), n: 1, ..Default::default() }));
    let w = webview_report("main", "TypeError", "a@tauri://localhost/assets/i.js:1:2");
    assert!(valid(&w));
    let mut w2 = w.clone();
    w2.loc = Some("src/x.rs:1:1".into());
    assert!(!valid(&w2));
    let mut w3 = w.clone();
    w3.frames.push("/Users/kim/a.js:1:1".into());
    assert!(!valid(&w3));

    let d = tmp("drop");
    assert!(!push(&d, w3, true), "틀린 보고는 쌓지 않는다");
    assert!(load(&d).r.is_empty());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 같은_오류는_묶고_상한을_지킨다() {
    let d = tmp("group");
    for _ in 0..3 {
        assert!(push(&d, panic_at("src/a.rs:1:1"), true));
    }
    let o = load(&d);
    assert_eq!(o.r.len(), 1);
    assert_eq!(count_in(&o), 3);
    for i in 0..(MAX_ENTRIES + 10) {
        push(&d, panic_at(&format!("src/a.rs:{}:1", i + 2)), true);
    }
    assert_eq!(load(&d).r.len(), MAX_ENTRIES, "서로 다른 오류는 상한까지만");
    let mut big = panic_at("src/a.rs:1:1");
    big.n = MAX_N;
    assert!(push(&d, big, true));
    assert_eq!(load(&d).r[&panic_at("src/a.rs:1:1").key()].n, MAX_N, "개수도 상한");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(d.join(OUTBOX)).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn panic_훅은_잠금을_기다리지_않는다() {
    let d = tmp("trylock");
    let g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    assert!(!push(&d, panic_at("src/a.rs:1:1"), false), "잠겨 있으면 그냥 놓친다(멈추지 않는다)");
    drop(g);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 스위치가_꺼졌거나_동의_전이면_안_쌓는다() {
    let after = "2026-12-18";
    assert!(open(&gate(), after));
    assert!(!open(&gate(), "2026-12-17"), "시행일 전");
    for g in [
        Gate { on: false, ..gate() },
        Gate { identifier: "app.chammo.dev".into(), ..gate() },
        Gate { setup_done: false, ..gate() },
        Gate { debug: true, ..gate() },
        Gate { real_data: false, ..gate() },
    ] {
        assert!(!open(&g, after), "{g:?}");
    }
}

#[test]
fn 꺼짐이면_보내는_것_0건이고_쌓인_것도_비운다() {
    let d = tmp("off");
    push(&d, panic_at("src/a.rs:1:1"), true);
    let mut calls = 0;
    let r = tick(&d, false, &base(), |_, _| {
        calls += 1;
        Ok(204)
    });
    assert_eq!(r, Outcome::Blocked);
    assert_eq!(calls, 0);
    assert!(!d.join(OUTBOX).exists());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 다른_중계를_쓰면_안_보낸다() {
    let d = tmp("server");
    push(&d, panic_at("src/a.rs:1:1"), true);
    let mut calls = 0;
    let r = tick(&d, true, &Base { default_server: false, ..base() }, |_, _| {
        calls += 1;
        Ok(204)
    });
    assert_eq!((r, calls), (Outcome::OtherServer, 0));
    assert_eq!(load(&d).r.len(), 1, "지우지도 않는다");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 오프라인이면_쌓아_두고_다음에_보낸다() {
    let d = tmp("offline");
    push(&d, panic_at("src/a.rs:1:1"), true);
    assert_eq!(tick(&d, true, &base(), |_, _| Err("no answer".into())), Outcome::Kept("no answer".into()));
    assert_eq!(tick(&d, true, &base(), |_, _| Ok(503)), Outcome::Kept("503".into()));
    assert_eq!(tick(&d, true, &base(), |_, _| Ok(429)), Outcome::Kept("429".into()));
    push(&d, panic_at("src/a.rs:1:1"), true);
    assert_eq!(count_in(&load(&d)), 2, "못 보낸 동안 같은 오류는 개수만");
    let mut seen = String::new();
    let r = tick(&d, true, &base(), |u, b| {
        assert_eq!(u, URL);
        seen = b.to_string();
        Ok(204)
    });
    assert_eq!(r, Outcome::Sent(204, 1));
    assert!(!d.join(OUTBOX).exists());
    let v: Value = serde_json::from_str(&seen).unwrap();
    assert!(valid_body(&v));
    assert_eq!(v["r"][0]["n"], 2);
    assert_eq!(tick(&d, true, &base(), |_, _| Ok(204)), Outcome::Empty);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 중계가_모양을_안_받으면_그_묶음은_버린다() {
    let d = tmp("reject");
    push(&d, panic_at("src/a.rs:1:1"), true);
    assert_eq!(tick(&d, true, &base(), |_, _| Ok(400)), Outcome::Sent(400, 1));
    assert!(load(&d).r.is_empty());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 보내는_사이_또_나면_그만큼_남긴다() {
    let d = tmp("race");
    push(&d, panic_at("src/a.rs:1:1"), true);
    let d2 = d.clone();
    let r = tick(&d, true, &base(), move |_, _| {
        push(&d2, panic_at("src/a.rs:1:1"), true);
        push(&d2, panic_at("src/a.rs:1:1"), true);
        Ok(204)
    });
    assert_eq!(r, Outcome::Sent(204, 1));
    assert_eq!(count_in(&load(&d)), 2);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 한_번에_스무_건씩() {
    let d = tmp("batch");
    for i in 0..25 {
        push(&d, panic_at(&format!("src/a.rs:{}:1", i + 1)), true);
    }
    let mut n = 0;
    tick(&d, true, &base(), |_, b| {
        n = serde_json::from_str::<Value>(b).unwrap()["r"].as_array().unwrap().len();
        Ok(204)
    });
    assert_eq!(n, BATCH);
    assert_eq!(load(&d).r.len(), 5);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 쌓인_파일에_섞인_틀린_보고는_보내기_전에_버린다() {
    let d = tmp("tamper");
    let mut o = Outbox::default();
    let good = panic_at("src/a.rs:1:1");
    o.r.insert(good.key(), good);
    o.r.insert("x".into(), Report { kind: "panic".into(), loc: Some("/Users/kimminji/x.rs:1:1".into()), form: Some("other".into()), n: 1, ..Default::default() });
    std::fs::write(d.join(OUTBOX), serde_json::to_string(&o).unwrap()).unwrap();
    let mut seen = String::new();
    tick(&d, true, &base(), |_, b| {
        seen = b.to_string();
        Ok(204)
    });
    assert!(!seen.contains("kimminji"));
    assert_eq!(serde_json::from_str::<Value>(&seen).unwrap()["r"].as_array().unwrap().len(), 1);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn 몸통_칸_목록이_고정이다() {
    let ok = body("0.5.0", "release", &[panic_at("src/a.rs:1:1")]);
    assert!(valid_body(&ok));
    let keys: Vec<&str> = ok.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(keys, BODY_KEYS);
    let mut extra = ok.clone();
    extra["id"] = json!("0123456789abcdef0123456789abcdef");
    assert!(!valid_body(&extra), "설치 번호 같은 칸이 붙으면 안 된다");
    let mut r_extra = ok.clone();
    r_extra["r"][0]["msg"] = json!("거래처A");
    assert!(!valid_body(&r_extra));
    assert!(!valid_body(&body("0.5.0-dev", "release", &[panic_at("src/a.rs:1:1")])));
    assert!(!valid_body(&body("0.5.0", "beta", &[panic_at("src/a.rs:1:1")])));
    assert!(!valid_body(&body("0.5.0", "release", &[])));
    let many: Vec<Report> = (0..BATCH + 1).map(|i| panic_at(&format!("src/a.rs:{}:1", i + 1))).collect();
    assert!(!valid_body(&body("0.5.0", "release", &many)));
}

/// 실제 꼴 오류 15개(+리뷰가 찾은 빈 모양) — 오류 글·스택·창 이름 어디에 개인 값이 있어도 쌓인 파일·보낼 몸통엔 0개
#[test]
fn 실제_꼴_오류에서_개인_값_0() {
    let cases = [
        "called `Result::unwrap()` on an `Err` value: Os { code: 2, kind: NotFound, message: \"No such file or directory\" } at /Users/kimminji/Desktop/dev/northwind-app/docs/starter.md",
        "failed to read /Users/kimminji/.chammo/sessions/northwind-app-2.json",
        "open /Users/kimminji/Desktop/dev/My Client 견적/계약서 최종.pdf failed",
        "Load failed: file:///Users/kimminji/Desktop/dev/northwind-app/index.html",
        "GET asset://localhost/%2FUsers%2Fkimminji%2FDesktop%2Fdev%2Fnorthwind-app%2Flogo.png 404",
        "Access is denied. (os error 5) C:\\Users\\김민지\\Desktop\\dev\\거래처A\\notes.md",
        "\\\\?\\C:\\Users\\kimminji\\AppData\\Roaming\\Chammo\\x.json",
        "account kimminji@northwind.co.kr not logged in",
        "session northwind-app-2 not found in team 거래처A",
        "auth failed token=sk-FAKE-0000000000000000000000000000",
        "bind failed on Kimminji-MacBook-Pro.local:7777",
        "parse error near '내일 거래처A 대표님께 견적 3,000만원 보내 줘'",
        "fetch https://northwind-app.vercel.app/admin failed from 192.168.0.12:7777 via kimminji-imac.tail1234.ts.net",
        "git: src/northwind-client/billing.ts: call 010-1234-5678 about 계좌 110-123-456789",
        "Dear Mr. Kimminji, the Northwind Corp invoice draft is attached",
    ];
    let personal = [
        "kimminji", "Kimminji", "northwind", "Northwind", "거래처", "김민지", "Users", "견적", "계약서", "Client", "starter", "notes", "sk-FAKE", "MacBook", "대표님",
        "logo", "010-1234", "192.168", "tail1234", "vercel", "Dear", "billing", "계좌", "invoice", "chammo/sessions",
    ];
    let d = tmp("leak");
    for (i, c) in cases.iter().enumerate() {
        // 오류 글이 panic 글로, 경로가 panic 위치로 들어온 경우
        push(&d, panic_report(&format!("/Users/kimminji/Desktop/dev/northwind-app/src/m{i}.rs"), 1, 1, c), true);
        push(&d, panic_report("src/team_relay.rs", i as u32 + 1, 9, c), true);
        // 화면 오류 — 오류 이름·스택·창 이름 모두에 개인 값
        let stack = format!("{c}\n  at {c} (tauri://localhost/assets/index-AbC123.js:{}:2)\n  at x (asset://localhost/%2FUsers%2Fkimminji%2Fa.js:1:1)", i + 1);
        push(&d, webview_report("mode-거래처A달력", c, &stack), true);
        push(&d, webview_report(&format!("team-{c}"), "TypeError", &stack), true);
    }
    let saved = std::fs::read_to_string(d.join(OUTBOX)).unwrap();
    let mut sent = Vec::new();
    while let Outcome::Sent(..) = tick(&d, true, &base(), |_, b| {
        sent.push(b.to_string());
        Ok(204)
    }) {}
    assert!(!sent.is_empty());
    for text in std::iter::once(&saved).chain(sent.iter()) {
        let hits: Vec<&str> = personal.iter().filter(|p| text.contains(*p)).copied().collect();
        assert!(hits.is_empty(), "개인 값 {hits:?} 가 남음: {text}");
    }
    for s in &sent {
        assert!(valid_body(&serde_json::from_str(s).unwrap()));
    }
    // 중계 로컬 시험(wrangler dev)에 같은 몸통을 그대로 보내 보려고 — CHAMMO_CRASH_DUMP=<파일> 일 때만 남긴다
    if let Ok(p) = std::env::var("CHAMMO_CRASH_DUMP") {
        let _ = std::fs::write(p, sent.join("\n") + "\n");
    }
    let _ = std::fs::remove_dir_all(&d);
}
