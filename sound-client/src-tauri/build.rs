fn main() {
    tauri_build::build();
    // Tauri embeds the native manifest in application binaries, not examples.
    // The window regression runner also needs Common Controls v6 and native DPI.
    #[cfg(windows)]
    {
        println!("cargo:rustc-link-arg-examples=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-examples=/MANIFESTINPUT:{}/examples/window-frame.manifest", env!("CARGO_MANIFEST_DIR"));
        println!("cargo:rerun-if-changed=examples/window-frame.manifest");
    }
}
