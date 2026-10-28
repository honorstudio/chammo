fn main() {
    vdisplay_helper();
    accessory_dylib();
    craft_mirror();
    tauri_build::build()
}

/// Craft 맥 앱 비추기(tools/craft-mirror, Swift) — 맥이면 정적 라이브러리로 빌드해 링크하고 `craft_mirror` cfg 를 켠다.
/// 맥이 아니거나(윈도우 빌드) swiftc 가 실패하면 링크하지 않는다 — 앱은 비추기 없이 돈다(창은 뜨고 칸은 빈다).
/// 릴리스에선 조용히 빠지면 안 돼서 scripts/release-check 가 실행 파일에 craft_mirror_attach 가 들었는지 본다
fn craft_mirror() {
    println!("cargo:rustc-check-cfg=cfg(craft_mirror)");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let src = manifest_dir().join("../../tools/craft-mirror/mirror.swift");
    // 붙이기 층(attach.swift, 2026-10-21 시험) — 다른 앱 창을 칸 자리에. 앱 종류와 떼어 따로 둔다
    let attach = manifest_dir().join("../../tools/craft-mirror/attach.swift");
    // 세션 브라우저 비추기(browser.swift, 2026-10-27 인앱 브라우저 A) — 같은 정적 라이브러리에
    let browser = manifest_dir().join("../../tools/craft-mirror/browser.swift");
    println!("cargo:rerun-if-changed={}", src.display());
    println!("cargo:rerun-if-changed={}", attach.display());
    println!("cargo:rerun-if-changed={}", browser.display());
    // 원본이 없는 건 swiftc 문제가 아니라 소스를 덜 담은 것 — 조용히 빼지 않고 멈춘다(0.3.4 공개본에 tools/ 가 빠져 비추기 없는 앱이 나올 뻔)
    assert!(src.exists(), "tools/craft-mirror/mirror.swift is missing — the export must include tools/craft-mirror");
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let built = std::process::Command::new("swiftc")
        .args(["-O", "-emit-library", "-static", "-parse-as-library", "-module-name", "CraftMirror", "-o"])
        .arg(out.join("libcraftmirror.a"))
        .arg(&src)
        .arg(&attach)
        .arg(&browser)
        .status()
        .is_ok_and(|s| s.success());
    if !built {
        println!("cargo:warning=craft-mirror (Swift) did not build — Craft windows will not mirror the app");
        return;
    }
    let run = |cmd: &str, args: &[&str]| {
        std::process::Command::new(cmd).args(args).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    // Swift 런타임은 맥에 있다(/usr/lib/swift) — 링크할 때 찾을 자리만 알려 준다(SDK 의 tbd + 툴체인의 호환 라이브러리)
    if let Some(sdk) = run("xcrun", &["--show-sdk-path"]) {
        println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    }
    if let Some(swiftc) = run("xcrun", &["-f", "swiftc"]) {
        if let Some(tc) = std::path::Path::new(&swiftc).parent().and_then(|p| p.parent()) {
            println!("cargo:rustc-link-search=native={}", tc.join("lib/swift/macosx").display());
        }
    }
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=craftmirror");
    for f in ["ScreenCaptureKit", "CoreMedia", "CoreVideo", "QuartzCore", "AppKit"] {
        println!("cargo:rustc-link-lib=framework={f}");
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rustc-cfg=craft_mirror");
}

/// 가상 모니터 도우미(tools/chammo-vdisplay, Swift) — 맥이면 swiftc 로 빌드해 OUT_DIR 에(vdisplay.rs 가 include_bytes).
/// swiftc 가 없거나 실패하면 빈 파일 — 앱은 가상 모니터 없이(앱 가리기만) 돈다
fn vdisplay_helper() {
    let src = manifest_dir().join("../../tools/chammo-vdisplay");
    println!("cargo:rerun-if-changed={}", src.display());
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("chammo-vdisplay");
    let mac = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos");
    assert!(!mac || src.join("main.swift").exists(), "tools/chammo-vdisplay is missing — the export must include tools/chammo-vdisplay");
    // 최소 macOS 를 앱(arm64 11.0)에 맞춘다 — 안 주면 빌드한 맥 판(26)이 박혀 macOS 26 에만 있는 Swift 라이브러리
    // (libswift_DarwinFoundation2)를 꼭 불러서, 옛 macOS 에선 도우미가 dyld 에서 죽고 가짜 화면이 조용히 없었다(2026-10-26 PM 맥북)
    let arch = if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("x86_64") { "x86_64" } else { "arm64" };
    let built = mac
        && std::process::Command::new("swiftc")
            .args(["-O", "-target", &format!("{arch}-apple-macos11.0"), "-import-objc-header"])
            .arg(src.join("bridge.h"))
            .arg(src.join("place.swift"))
            .arg(src.join("main.swift"))
            .arg("-o")
            .arg(&out)
            .args(["-framework", "CoreGraphics"])
            .status()
            .is_ok_and(|s| s.success());
    if !built {
        let _ = std::fs::write(&out, []);
    }
}

/// 세션 크롬 Dock·⌘Tab 빼기 dylib(tools/chammo-browser/native/accessory.m) — 맥이면 clang 으로 OUT_DIR 에(accessory.rs 가 include_bytes).
/// 실패하면 빈 파일 — 앱은 그 파일을 안 풀고, 래퍼는 사본을 구글 서명 그대로 띄운다(Dock 에 보일 뿐)
fn accessory_dylib() {
    let src = manifest_dir().join("../../tools/chammo-browser/native/accessory.m");
    println!("cargo:rerun-if-changed={}", src.display());
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("chammo-accessory.dylib");
    let mac = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos");
    // 없으면 경고만 — 공유 CARGO_TARGET_DIR 에선 다른 워크트리가 이 빌드 스크립트를 재사용해 그 워크트리 소스엔 없는 이 파일로 패닉했다(10-27).
    // 공개본 누락은 scripts/release-check 가 실행 파일에 dylib 가 들었는지로 본다
    if mac && !src.exists() {
        println!("cargo:warning=tools/chammo-browser/native/accessory.m is missing — session Chrome will show in the Dock");
    }
    // 최소 macOS 를 앱(11.0)에 — vdisplay 도우미와 같은 까닭
    let arch = if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("x86_64") { "x86_64" } else { "arm64" };
    let built = mac
        && std::process::Command::new("clang")
            .args(["-dynamiclib", "-fobjc-arc", "-O2", "-target", &format!("{arch}-apple-macos11.0"), "-framework", "AppKit", "-o"])
            .arg(&out)
            .arg(&src)
            .status()
            .is_ok_and(|s| s.success());
    if !built {
        if mac {
            println!("cargo:warning=chammo-accessory.dylib did not build — session Chrome will show in the Dock");
        }
        let _ = std::fs::write(&out, []);
    }
}

/// 이 크레이트 자리 — 실행 때 값으로. env!() 는 빌드 스크립트를 컴파일할 때 박혀서, CARGO_TARGET_DIR 를 같이 쓰는 다른 워크트리가
/// 먼저 만든 빌드 스크립트를 재사용하면 그 워크트리의 Swift 소스를 컴파일했다(10/16 — 워크트리에 고친 mirror.swift 가 안 들어감)
fn manifest_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"))
}
