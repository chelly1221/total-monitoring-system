//! Watches the default render endpoint's mute state (polling `IAudioEndpointVolume`).
//!
//! Flow (mirrors the original UnmuteTimer app): when the PC becomes muted a small
//! popup near the tray asks how long to wait; the countdown starts only after the
//! operator picks a duration. When it expires (or 지금 해제 is pressed) the endpoint
//! is unmuted and the master volume set to 100%. Unmuting by hand cancels everything.

use crate::state::AppState;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

pub enum MuteCmd {
    /// Unmute immediately and set the volume to 100%.
    UnmuteNow,
    /// Operator picked a duration in the popup or the 음소거 tab.
    StartCountdown(u32),
    /// Stop a running countdown; the PC stays muted.
    CancelCountdown,
}

const POLL: Duration = Duration::from_millis(500);
const REACQUIRE: Duration = Duration::from_secs(10);

fn acquire() -> windows::core::Result<IAudioEndpointVolume> {
    // SAFETY: plain COM calls on a thread that called CoInitializeEx.
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
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

/// Spawn the mute watcher thread. Commands arrive over `rx`; the popup is driven via `app`.
pub fn spawn(app: AppHandle, state: AppState, rx: Receiver<MuteCmd>) {
    let _ = std::thread::Builder::new()
        .name("mute-watch".into())
        .spawn(move || {
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
                            // Keep a stale endpoint if we had one; retry on the next tick.
                            acquired_at = Instant::now() - REACQUIRE + Duration::from_secs(3);
                        }
                    }
                }
                let Some(ep) = endpoint.as_ref() else {
                    continue;
                };

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
                let (expired, show_popup, hide_popup) = {
                    let mut g = state.lock();
                    let was_muted = g.muted;
                    g.muted = muted;
                    let mut show_popup = false;
                    let mut hide_popup = false;
                    if muted {
                        if let Some(m) = start {
                            g.unmute_deadline = Some(now + Duration::from_secs(u64::from(m) * 60));
                            prompted = true;
                            hide_popup = true;
                        }
                        if cancel {
                            g.unmute_deadline = None;
                            hide_popup = true;
                        }
                        if !was_muted {
                            prompted = false;
                        }
                        if !prompted && g.unmute_deadline.is_none() && !force_unmute {
                            prompted = true;
                            show_popup = true;
                        }
                        (
                            matches!(g.unmute_deadline, Some(d) if d <= now),
                            show_popup,
                            hide_popup,
                        )
                    } else {
                        // Unmuted by hand, by us, or never muted: nothing pending.
                        if g.unmute_deadline.take().is_some() || was_muted {
                            hide_popup = true;
                        }
                        prompted = false;
                        (false, false, hide_popup)
                    }
                };

                if show_popup {
                    crate::show_mute_popup(&app);
                } else if hide_popup {
                    crate::hide_mute_popup(&app);
                }

                if (expired || force_unmute) && muted {
                    match do_unmute(ep) {
                        Ok(()) => {
                            log::info!(
                                "auto-unmute applied (expired={expired}, forced={force_unmute})"
                            );
                            let mut g = state.lock();
                            g.muted = false;
                            g.unmute_deadline = None;
                            prompted = false;
                            drop(g);
                            crate::hide_mute_popup(&app);
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
