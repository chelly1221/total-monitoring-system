fn main() {
    tauri_build::build();
    // Tauri links the Windows manifest into bins only. The isolated window
    // example also needs Common Controls v6 for WebView2 to start.
    #[cfg(windows)]
    println!(
        "cargo:rustc-link-arg-examples={}/resource.lib",
        std::env::var("OUT_DIR").unwrap()
    );
}
