//! Watches the default render endpoint's mute state (polling `IAudioEndpointVolume`)
//! and auto-unmutes (mute off + master volume 100%) after the configured countdown.

use crate::state::AppState;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

pub enum MuteCmd {
    /// Unmute immediately and set the volume to 100%.
    UnmuteNow,
    /// The configured duration changed: restart the countdown if one is running.
    ResetCountdown,
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

/// Spawn the mute watcher thread. Commands arrive over `rx`.
pub fn spawn(state: AppState, rx: Receiver<MuteCmd>) {
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

            while !disconnected {
                let mut force_unmute = false;
                let mut reset = false;
                match rx.recv_timeout(POLL) {
                    Ok(MuteCmd::UnmuteNow) => force_unmute = true,
                    Ok(MuteCmd::ResetCountdown) => reset = true,
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
                let expired = {
                    let mut g = state.lock();
                    g.muted = muted;
                    if muted {
                        let dur = Duration::from_secs(u64::from(g.settings.unmute_minutes) * 60);
                        if g.unmute_deadline.is_none() || reset {
                            g.unmute_deadline = Some(now + dur);
                        }
                        matches!(g.unmute_deadline, Some(d) if d <= now)
                    } else {
                        g.unmute_deadline = None;
                        false
                    }
                };

                if (expired || force_unmute) && muted {
                    match do_unmute(ep) {
                        Ok(()) => {
                            log::info!(
                                "auto-unmute applied (expired={expired}, forced={force_unmute})"
                            );
                            let mut g = state.lock();
                            g.muted = false;
                            g.unmute_deadline = None;
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
