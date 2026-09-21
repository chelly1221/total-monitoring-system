//! Native regression check without audio, discovery, autostart or firewall changes.
//! Run `cargo run --release --example window_frame_check` on Windows 10/11.
//! `-- --shadow-control` demonstrates the old three-sided non-client frame.

#[path = "../src/window_frame.rs"]
mod window_frame;

use tauri::{Manager, WebviewUrl};
use windows::core::HSTRING;
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetClientRect, GetWindowRect, SetWindowPos, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER,
};

fn check(window: &tauri::WebviewWindow, control: bool) -> anyhow::Result<()> {
    let title = HSTRING::from(format!("TMS frame check {} {}", std::process::id(), window.label()));
    // Inspect the actual OS window independently of the Tauri handle dispatcher.
    let hwnd = unsafe { FindWindowW(None, &title)? };
    for resize in [false, true] {
        let mut outer = RECT::default();
        let mut inner = RECT::default();
        // SAFETY: all calls target this test's live, hidden native window.
        unsafe {
            GetWindowRect(hwnd, &mut outer)?;
            if resize {
                SetWindowPos(
                    hwnd, None, 0, 0,
                    outer.right - outer.left + 40, outer.bottom - outer.top + 30,
                    SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOZORDER,
                )?;
                GetWindowRect(hwnd, &mut outer)?;
            }
            GetClientRect(hwnd, &mut inner)?;
        }
        let frame_x = outer.right - outer.left - (inner.right - inner.left);
        let frame_y = outer.bottom - outer.top - (inner.bottom - inner.top);
        println!("{} resized={resize} non-client extent={frame_x}x{frame_y} control={control}", window.label());
        if control {
            anyhow::ensure!(frame_x > 0 || frame_y > 0, "control did not reproduce the frame");
        } else {
            anyhow::ensure!(frame_x == 0 && frame_y == 0, "native frame remains");
        }
    }
    Ok(())
}

fn main() {
    let control = std::env::args().any(|arg| arg == "--shadow-control");
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut context = tauri::generate_context!();
    // Examples live one directory below the bundled application's runtime.
    context.config_mut().bundle.windows.webview_install_mode =
        tauri::utils::config::WebviewInstallMode::FixedRuntime { path: root.join("webview2") };
    context.config_mut().identifier = "kr.chelly.tms-soundsense.frame-check".into();
    for window in &mut context.config_mut().app.windows {
        assert!(!window.decorations && !window.shadow, "all shipped windows must disable native frames");
        window.shadow = control;
        window.title = format!("TMS frame check {} {}", std::process::id(), window.label);
        window.visible = false;
        window.url = WebviewUrl::External("about:blank".parse().unwrap());
        window.data_directory = Some(root.join("target/frame-check-webview"));
    }
    let app = tauri::Builder::default().build(context).expect("create frame-check windows");
    let started = std::sync::atomic::AtomicBool::new(false);
    app.run(move |app, event| {
        if matches!(event, tauri::RunEvent::Ready)
            && !started.swap(true, std::sync::atomic::Ordering::SeqCst) {
            let app = app.clone();
            std::thread::spawn(move || {
                // Query through the running event loop, after startup has returned.
                let windows = app.webview_windows();
                assert_eq!(windows.len(), 2);
                let result: anyhow::Result<()> = windows.values().try_for_each(|window| {
                    if !control { window_frame::configure(window)?; }
                    check(window, control)
                });
                if let Err(error) = &result { eprintln!("{error:#}"); }
                let code = if result.is_ok() { 0 } else { 1 };
                std::process::exit(code);
            });
        }
    });
}
