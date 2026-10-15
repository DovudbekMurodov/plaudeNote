fn main() {
    tauri_build::build();
    #[cfg(target_os = "macos")]
    link_compiler_rt();
}

/// ggml-metal guards newer Metal APIs with `@available(...)`, which clang lowers to
/// `__isPlatformVersionAtLeast` from its compiler-rt. rustc links with
/// `-nodefaultlibs`, so with a deployment target below the guarded versions
/// (we ship for macOS 13.3+) the release link fails unless we add it ourselves.
#[cfg(target_os = "macos")]
fn link_compiler_rt() {
    let out = std::process::Command::new("xcrun")
        .args(["clang", "-print-resource-dir"])
        .output();
    if let Ok(o) = out {
        if o.status.success() {
            let dir = String::from_utf8_lossy(&o.stdout).trim().to_string();
            println!("cargo:rustc-link-search=native={dir}/lib/darwin");
            println!("cargo:rustc-link-lib=static=clang_rt.osx");
        }
    }
}
