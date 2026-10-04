fn main() {
    vdisplay_helper();
    tauri_build::build()
}

/// 가상 모니터 도우미(tools/chammo-vdisplay, Swift) — 맥이면 swiftc 로 빌드해 OUT_DIR 에(vdisplay.rs 가 include_bytes).
/// swiftc 가 없거나 실패하면 빈 파일 — 앱은 가상 모니터 없이(앱 가리기만) 돈다
fn vdisplay_helper() {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/chammo-vdisplay");
    println!("cargo:rerun-if-changed={}", src.display());
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("chammo-vdisplay");
    let mac = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos");
    let built = mac
        && std::process::Command::new("swiftc")
            .args(["-O", "-import-objc-header"])
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
