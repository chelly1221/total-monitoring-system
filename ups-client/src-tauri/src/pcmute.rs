//! PC 음소거 자동 해제: watches the default render endpoint's mute state (polling
//! `IAudioEndpointVolume`), the same feature as in TMS SoundSense (`sound-client/src-tauri/src/mute.rs`).
//!
//! When the PC becomes muted a small popup near the tray asks how long to wait; the
//! countdown starts only after the operator picks a duration. When it expires (or 지금 해제
//! is pressed) the endpoint is unmuted and the master volume set to 100%. Unmuting by
//! hand cancels everything. While a countdown runs the tray / taskbar icon shows the
//! remaining time. Identical copies live in `ping-client` and `ups-client`; edit both.

use crate::state::AppState;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Wry};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

pub const MUTE_WINDOW: &str = "mute";
pub const TRAY_ID: &str = "main";
const POPUP_MARGIN: i32 = 12;
/// Height of the Windows 11 volume / quick-settings flyout that pops up at the bottom-right
/// when the operator mutes from the taskbar. The popup is placed above that band so the
/// flyout never covers it.
const TASKBAR_FLYOUT_CLEARANCE: i32 = 700;
const POLL: Duration = Duration::from_millis(500);
const REACQUIRE: Duration = Duration::from_secs(10);

pub enum MuteCmd {
    /// Unmute immediately and set the volume to 100%.
    UnmuteNow,
    /// Operator picked a duration in the popup or the settings dialog.
    StartCountdown(u32),
    /// Stop a running countdown; the PC stays muted.
    CancelCountdown,
}

/// Mute-watch state kept inside the app state (`Inner`).
#[derive(Default)]
pub struct PcMute {
    pub muted: bool,
    pub unmute_deadline: Option<Instant>,
}

impl PcMute {
    pub fn remaining_sec(&self) -> Option<u64> {
        if !self.muted {
            return None;
        }
        self.unmute_deadline.map(|d| d.saturating_duration_since(Instant::now()).as_secs())
    }
}

/// Command channel and tray menu entries, managed by Tauri.
pub struct MuteCtx {
    tx: Mutex<Sender<MuteCmd>>,
    pub tray_items: Mutex<Option<(MenuItem<Wry>, MenuItem<Wry>)>>,
}

impl MuteCtx {
    pub fn new() -> (Self, Receiver<MuteCmd>) {
        let (tx, rx) = mpsc::channel();
        (Self { tx: Mutex::new(tx), tray_items: Mutex::new(None) }, rx)
    }
    pub fn send(&self, cmd: MuteCmd) {
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(cmd);
        }
    }
}

pub fn valid_minutes(minutes: u32) -> bool {
    (1..=24 * 60).contains(&minutes)
}

fn acquire() -> windows::core::Result<IAudioEndpointVolume> {
    // SAFETY: plain COM calls on a thread that called CoInitializeEx.
    unsafe {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
    }
}

fn do_unmute(ep: &IAudioEndpointVolume) -> windows::core::Result<()> {
    // SAFETY: valid interface pointer; null event context is allowed.
    unsafe {
        ep.SetMute(false, std::ptr::null())?;
        ep.SetMasterVolumeLevelScalar(1.0, std::ptr::null())
    }
}

fn mute_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(MUTE_WINDOW)
}

/// Show the mute-duration popup on the right edge of the primary work area, above the
/// band where the taskbar volume flyout appears, so muting from the taskbar never hides it.
pub fn show_popup(app: &AppHandle) {
    let Some(w) = mute_window(app) else {
        log::warn!("mute popup window missing");
        return;
    };
    if let (Ok(Some(monitor)), Ok(size)) = (w.primary_monitor(), w.outer_size()) {
        let area = monitor.work_area();
        let x = area.position.x + area.size.width as i32 - size.width as i32 - POPUP_MARGIN;
        let bottom = area.position.y + area.size.height as i32;
        let y = (bottom - TASKBAR_FLYOUT_CLEARANCE - size.height as i32).max(area.position.y + POPUP_MARGIN);
        let _ = w.set_position(PhysicalPosition::new(x.max(0), y.max(0)));
    }
    let _ = w.show();
    let _ = w.set_focus();
    let _ = app.emit("mute-popup", true);
}

pub fn hide_popup(app: &AppHandle) {
    if let Some(w) = mute_window(app) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        }
    }
}

/// Spawn the mute watcher thread. Commands arrive over `rx`; the popup is driven via `app`.
pub fn spawn(app: AppHandle, state: AppState, rx: Receiver<MuteCmd>) {
    let _ = std::thread::Builder::new().name("mute-watch".into()).spawn(move || {
        // SAFETY: standard COM apartment init for this thread; S_FALSE (already init) is fine.
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if hr.is_err() {
            log::error!("CoInitializeEx failed: {hr:?}");
        }
        let mut endpoint: Option<IAudioEndpointVolume> = None;
        let mut acquired_at = Instant::now() - REACQUIRE;
        let mut disconnected = false;
        // True once the popup was shown for the current mute episode; cleared on unmute.
        let mut prompted = false;

        while !disconnected {
            let mut force_unmute = false;
            let mut start: Option<u32> = None;
            let mut cancel = false;
            match rx.recv_timeout(POLL) {
                Ok(MuteCmd::UnmuteNow) => force_unmute = true,
                Ok(MuteCmd::StartCountdown(m)) => start = Some(m),
                Ok(MuteCmd::CancelCountdown) => cancel = true,
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => disconnected = true,
            }

            if endpoint.is_none() || acquired_at.elapsed() >= REACQUIRE {
                match acquire() {
                    Ok(ep) => {
                        endpoint = Some(ep);
                        acquired_at = Instant::now();
                    }
                    Err(e) => {
                        if endpoint.is_none() {
                            log::warn!("audio endpoint unavailable: {e}");
                        }
                        acquired_at = Instant::now() - REACQUIRE + Duration::from_secs(3);
                    }
                }
            }
            let Some(ep) = endpoint.as_ref() else { continue };

            // SAFETY: valid interface pointer.
            let muted = match unsafe { ep.GetMute() } {
                Ok(b) => b.as_bool(),
                Err(e) => {
                    log::warn!("GetMute failed: {e}");
                    endpoint = None;
                    continue;
                }
            };

            let now = Instant::now();
            let (expired, show, hide) = {
                let mut g = state.lock();
                let pm = &mut g.pc_mute;
                let was_muted = pm.muted;
                pm.muted = muted;
                let mut show = false;
                let mut hide = false;
                if muted {
                    if let Some(m) = start {
                        pm.unmute_deadline = Some(now + Duration::from_secs(u64::from(m) * 60));
                        prompted = true;
                        hide = true;
                    }
                    if cancel {
                        pm.unmute_deadline = None;
                        hide = true;
                    }
                    if !was_muted {
                        prompted = false;
                    }
                    if !prompted && pm.unmute_deadline.is_none() && !force_unmute {
                        prompted = true;
                        show = true;
                    }
                    (matches!(pm.unmute_deadline, Some(d) if d <= now), show, hide)
                } else {
                    if pm.unmute_deadline.take().is_some() || was_muted {
                        hide = true;
                    }
                    prompted = false;
                    (false, false, hide)
                }
            };

            if show {
                show_popup(&app);
            } else if hide {
                hide_popup(&app);
            }

            if (expired || force_unmute) && muted {
                match do_unmute(ep) {
                    Ok(()) => {
                        log::info!("auto-unmute applied (expired={expired}, forced={force_unmute})");
                        let mut g = state.lock();
                        g.pc_mute.muted = false;
                        g.pc_mute.unmute_deadline = None;
                        prompted = false;
                        drop(g);
                        hide_popup(&app);
                    }
                    Err(e) => {
                        log::warn!("unmute failed: {e}");
                        endpoint = None;
                    }
                }
            } else if force_unmute {
                // Not muted: still honour the 100% volume request.
                if let Err(e) = do_unmute(ep) {
                    log::warn!("set volume failed: {e}");
                }
            }
        }
    });
}

pub fn format_remaining(sec: u64) -> String {
    let h = sec / 3600;
    let m = (sec % 3600) / 60;
    let s = sec % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

/// Status line for the tray menu and tooltip.
pub fn status_text(pm: &PcMute) -> String {
    if pm.muted {
        match pm.remaining_sec() {
            Some(r) => format!("PC 음소거 · 해제까지 {}", format_remaining(r)),
            None => "PC 음소거 감지됨".to_string(),
        }
    } else {
        "PC 소리 켜짐".to_string()
    }
}

/// Keeps the tray icon (countdown badge), tooltip and menu status current, twice a second.
pub async fn tray_loop(app: AppHandle, state: AppState, base_png: &'static [u8], title: &'static str) {
    let mut ticker = tokio::time::interval(Duration::from_millis(500));
    let mut last_label: Option<Option<String>> = None;
    let mut last_status = String::new();
    loop {
        ticker.tick().await;
        let (remaining, status) = {
            let g = state.lock();
            (g.pc_mute.remaining_sec(), status_text(&g.pc_mute))
        };
        let label = remaining.map(crate::badge::countdown_label);
        if last_label.as_ref() != Some(&label) {
            let image = match remaining {
                Some(sec) => {
                    let rgb = if crate::badge::is_final_minute(sec) { [255, 196, 0] } else { [255, 255, 255] };
                    crate::badge::render(base_png, &crate::badge::countdown_label(sec), rgb)
                }
                None => Image::from_bytes(base_png),
            };
            match image {
                Ok(img) => {
                    if let Some(tray) = app.tray_by_id(TRAY_ID) {
                        let _ = tray.set_icon(Some(img.clone()));
                    }
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_icon(img);
                    }
                }
                Err(e) => log::warn!("tray icon render failed: {e}"),
            }
            last_label = Some(label);
        }
        if status != last_status {
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                let _ = tray.set_tooltip(Some(&format!("{title}\n{status}")));
            }
            if let Ok(items) = app.state::<MuteCtx>().tray_items.lock() {
                if let Some((status_item, cancel_item)) = items.as_ref() {
                    let _ = status_item.set_text(&status);
                    let _ = cancel_item.set_enabled(remaining.is_some());
                }
            }
            last_status = status;
        }
    }
}

#[tauri::command]
pub fn unmute_now(ctx: tauri::State<'_, MuteCtx>) {
    ctx.send(MuteCmd::UnmuteNow);
}

/// Operator picked a duration (popup or settings dialog): start the countdown.
#[tauri::command]
pub fn mute_choose(app: AppHandle, ctx: tauri::State<'_, MuteCtx>, minutes: u32) -> Result<(), String> {
    if !valid_minutes(minutes) {
        return Err("1분~24시간 사이로 선택하세요".into());
    }
    ctx.send(MuteCmd::StartCountdown(minutes));
    hide_popup(&app);
    Ok(())
}

/// Stop the countdown; the PC stays muted.
#[tauri::command]
pub fn mute_cancel(app: AppHandle, ctx: tauri::State<'_, MuteCtx>) {
    ctx.send(MuteCmd::CancelCountdown);
    hide_popup(&app);
}

/// 나중에: close the popup without starting a timer.
#[tauri::command]
pub fn mute_popup_dismiss(app: AppHandle) {
    hide_popup(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remaining_and_status_follow_the_deadline() {
        let mut pm = PcMute::default();
        assert_eq!(pm.remaining_sec(), None);
        assert_eq!(status_text(&pm), "PC 소리 켜짐");
        pm.muted = true;
        assert_eq!(status_text(&pm), "PC 음소거 감지됨");
        pm.unmute_deadline = Some(Instant::now() + Duration::from_secs(125));
        let r = pm.remaining_sec().unwrap();
        assert!((120..=125).contains(&r));
        assert!(status_text(&pm).starts_with("PC 음소거 · 해제까지 02:0"));
        pm.unmute_deadline = Some(Instant::now() - Duration::from_secs(5));
        assert_eq!(pm.remaining_sec(), Some(0));
        assert_eq!(format_remaining(3725), "1:02:05");
        assert_eq!(format_remaining(59), "00:59");
        assert!(valid_minutes(1) && valid_minutes(1440) && !valid_minutes(0) && !valid_minutes(1441));
    }
}
