//! WASAPI loopback capture via cpal. A dedicated thread owns the stream and publishes
//! the peak amplitude seen since the last read; a tokio task turns that into the
//! sound / silence decision (threshold + silenceMs hold-off).

use crate::state::AppState;
use anyhow::Context;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Lock-free "max since last take" meter shared between the audio callback and the detector.
pub struct PeakMeter {
    bits: AtomicU32,
}

impl PeakMeter {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            bits: AtomicU32::new(0f32.to_bits()),
        })
    }

    pub fn push(&self, v: f32) {
        let mut cur = self.bits.load(Ordering::Relaxed);
        loop {
            if v <= f32::from_bits(cur) {
                return;
            }
            match self.bits.compare_exchange_weak(
                cur,
                v.to_bits(),
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return,
                Err(actual) => cur = actual,
            }
        }
    }

    pub fn take(&self) -> f32 {
        f32::from_bits(self.bits.swap(0f32.to_bits(), Ordering::Relaxed))
    }
}

fn set_status(state: &AppState, text: String) {
    let mut g = state.lock();
    if g.audio_status != text {
        log::info!("audio: {text}");
        g.audio_status = text;
    }
}

/// Spawn the capture thread. It rebuilds the stream on errors and when the default
/// output device changes (loopback follows the render endpoint).
pub fn spawn(meter: Arc<PeakMeter>, state: AppState) {
    let _ = std::thread::Builder::new()
        .name("audio-capture".into())
        .spawn(move || loop {
            match run_stream(&meter, &state) {
                Ok(()) => {
                    set_status(&state, "출력 장치 변경 감지, 다시 연결 중".into());
                    std::thread::sleep(Duration::from_millis(500));
                }
                Err(e) => {
                    set_status(&state, format!("오디오 캡처 실패: {e:#}"));
                    std::thread::sleep(Duration::from_secs(3));
                }
            }
        });
}

fn peak_i16(d: &[i16]) -> f32 {
    d.iter().fold(0i32, |m, &s| m.max((s as i32).abs())) as f32 / 32768.0
}

fn peak_i32(d: &[i32]) -> f32 {
    d.iter().fold(0i64, |m, &s| m.max((s as i64).abs())) as f32 / 2_147_483_648.0
}

fn peak_u16(d: &[u16]) -> f32 {
    d.iter().fold(0i32, |m, &s| m.max((s as i32 - 32768).abs())) as f32 / 32768.0
}

fn peak_f32(d: &[f32]) -> f32 {
    d.iter().fold(0f32, |m, &s| m.max(s.abs()))
}

/// Returns Ok(()) when the default device changed (caller rebuilds), Err on failure.
fn run_stream(meter: &Arc<PeakMeter>, state: &AppState) -> anyhow::Result<()> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .context("기본 출력 장치를 찾을 수 없습니다")?;
    let device_name = device.name().unwrap_or_else(|_| "?".into());
    // On Windows/WASAPI, opening an *input* stream on a render device is loopback capture
    // (cpal sets AUDCLNT_STREAMFLAGS_LOOPBACK itself). The capture format is the device's
    // shared-mode mix format, which cpal exposes through `default_output_config()`.
    let supported = device
        .default_output_config()
        .context("루프백 캡처 형식을 얻을 수 없습니다")?;
    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();

    let failed = Arc::new(AtomicBool::new(false));
    let err_flag = failed.clone();
    let err_cb = move |e: cpal::StreamError| {
        log::warn!("audio stream error: {e}");
        err_flag.store(true, Ordering::Relaxed);
    };

    let m = meter.clone();
    let stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config,
            move |d: &[f32], _: &cpal::InputCallbackInfo| m.push(peak_f32(d)),
            err_cb,
            None,
        )?,
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config,
            move |d: &[i16], _: &cpal::InputCallbackInfo| m.push(peak_i16(d)),
            err_cb,
            None,
        )?,
        cpal::SampleFormat::I32 => device.build_input_stream(
            &config,
            move |d: &[i32], _: &cpal::InputCallbackInfo| m.push(peak_i32(d)),
            err_cb,
            None,
        )?,
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config,
            move |d: &[u16], _: &cpal::InputCallbackInfo| m.push(peak_u16(d)),
            err_cb,
            None,
        )?,
        other => anyhow::bail!("지원하지 않는 샘플 형식: {other:?}"),
    };
    stream.play().context("스트림 시작 실패")?;
    set_status(state, format!("감시 중: {device_name}"));

    let mut last_check = Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(500));
        if failed.load(Ordering::Relaxed) {
            anyhow::bail!("오디오 스트림이 중단되었습니다");
        }
        if last_check.elapsed() >= Duration::from_secs(5) {
            last_check = Instant::now();
            let current = host.default_output_device().and_then(|d| d.name().ok());
            if current.as_deref() != Some(device_name.as_str()) {
                return Ok(());
            }
        }
    }
}

/// Turns raw peaks into the sound/silence state (100 ms resolution).
pub async fn detector_loop(meter: Arc<PeakMeter>, state: AppState) {
    let mut last_sound: Option<Instant> = None;
    let mut ticker = tokio::time::interval(Duration::from_millis(100));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticker.tick().await;
        let peak = meter.take();
        let (threshold, silence_ms) = {
            let g = state.lock();
            (g.settings.threshold, g.settings.silence_ms)
        };
        let now = Instant::now();
        if peak > threshold {
            last_sound = Some(now);
        }
        let sound = matches!(last_sound, Some(t) if now.duration_since(t) < Duration::from_millis(silence_ms));
        let changed = {
            let mut g = state.lock();
            g.peak = peak;
            if g.sound != sound {
                g.sound = sound;
                true
            } else {
                false
            }
        };
        if changed {
            log::info!("sound state -> {}", if sound { "on" } else { "off" });
            state.sender_notify.notify_one();
        }
    }
}
