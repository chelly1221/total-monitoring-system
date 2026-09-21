//! Keep the client area flush with every native window edge on Windows 10 and 11.

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE};

pub fn configure(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    // Tao retains side/bottom non-client insets for undecorated shadows. Disabling
    // only DWMWA_BORDER_COLOR cannot remove these on Windows 10 (unsupported API).
    // Keep shadow=false in tauri.conf.json too, so the first frame is borderless.
    window.set_shadow(false)?;
    let Ok(hwnd) = window.hwnd() else {
        // Native handle access can be deferred during WebView startup. The
        // cross-version frame policy is already set by the window configuration.
        log::debug!("optional DWM border color deferred for {}", window.label());
        return Ok(());
    };
    let hwnd = HWND(hwnd.0);
    let color = DWMWA_COLOR_NONE;
    // SAFETY: hwnd belongs to this live window; color remains valid for the call.
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &color as *const u32 as *const _,
            std::mem::size_of::<u32>() as u32,
        )
    };
    if let Err(error) = result {
        // Windows 10 has no border-color attribute. Shadow-free framing is the
        // cross-version fix; this Windows 11 attribute is only additional protection.
        log::debug!("optional DWM border color unavailable for {}: {error}", window.label());
    }
    log::info!("native frame and shadow disabled for {}", window.label());
    Ok(())
}
