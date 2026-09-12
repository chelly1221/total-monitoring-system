//! TMS SoundSense: WASAPI loopback sound detection + auto-unmute + LAN discovery client.

mod audio;
mod discovery;
mod firewall;
mod mute;
mod netinfo;
mod sender;
mod settings;
mod state;

use mute::MuteCmd;
use settings::Settings;
use state::{AppState, Shared, Snapshot};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Diagnostics::Debug::MessageBeep;
use windows::Win32::UI::WindowsAndMessaging::{
    FlashWindowEx, FLASHWINFO, FLASHW_ALL, FLASHW_TIMERNOFG, MB_OK,
};

const MAIN_WINDOW: &str = "main";
const TRAY_ID: &str = "main";

/// Tauri-managed context shared by commands and background tasks.
pub struct Ctx {
    state: AppState,
    mute_tx: Mutex<mpsc::Sender<MuteCmd>>,
    /// Increments per identify so an older timer never hides the window of a newer one.
    identify_gen: AtomicU64,
    /// Whether the window was hidden before the current identify sequence started.
    identify_restore_hide: AtomicBool,
}

impl Ctx {
    fn send_mute(&self, cmd: MuteCmd) {
        if let Ok(tx) = self.mute_tx.lock() {
            let _ = tx.send(cmd);
        }
    }
}

fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW)
}

pub fn show_window(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn apply_autostart(app: &AppHandle, enabled: bool) {
    let launcher = app.autolaunch();
    let currently = launcher.is_enabled().unwrap_or(false);
    if enabled == currently {
        return;
    }
    let r = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    if let Err(e) = r {
        log::warn!(
            "autostart {} failed: {e}",
            if enabled { "enable" } else { "disable" }
        );
    }
}

/// Persist + apply a new settings object (from the UI or a server `config`), then notify the UI.
pub fn apply_settings(app: &AppHandle, new: Settings) -> Result<Settings, String> {
    let ctx = app.state::<Ctx>();
    let state = &ctx.state;
    let old = {
        let mut g = state.lock();
        std::mem::replace(&mut g.settings, new.clone())
    };
    let persist = settings::save(&new).map_err(|e| format!("설정 저장 실패: {e}"));

    if old.discovery_port != new.discovery_port {
        let _ = state.port_tx.send(new.discovery_port);
        let port = new.discovery_port;
        std::thread::spawn(move || firewall::ensure_rule(port));
    }
    if old.autostart != new.autostart {
        apply_autostart(app, new.autostart);
    }
    if old.unmute_minutes != new.unmute_minutes {
        ctx.send_mute(MuteCmd::ResetCountdown);
    }
    // Target / payload / interval may have changed: send right away.
    state.sender_notify.notify_one();
    let _ = app.emit("settings-changed", &new);
    persist.map(|_| new)
}

/// React to a server `identify`: surface the window, flash the taskbar, beep, and let the
/// UI show its banner for `sec` seconds; afterwards re-hide the window if it was hidden.
pub fn identify(app: &AppHandle, sec: u64) {
    let ctx = app.state::<Ctx>();
    let Some(w) = main_window(app) else { return };
    let was_visible = w.is_visible().unwrap_or(true);
    if !was_visible {
        ctx.identify_restore_hide.store(true, Ordering::SeqCst);
    }
    let generation = ctx.identify_gen.fetch_add(1, Ordering::SeqCst) + 1;

    show_window(app);
    if let Ok(hwnd) = w.hwnd() {
        // Re-wrap so this compiles even if tauri's `windows` crate version drifts from ours.
        let hwnd = HWND(hwnd.0);
        let info = FLASHWINFO {
            cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
            hwnd,
            dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG,
            uCount: 0,
            dwTimeout: 0,
        };
        // SAFETY: FLASHWINFO is fully initialised and hwnd is a live window handle.
        unsafe {
            let _ = FlashWindowEx(&info);
            let _ = MessageBeep(MB_OK);
        }
    }
    let _ = app.emit("identify", serde_json::json!({ "sec": sec }));

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(sec)).await;
        let ctx = app2.state::<Ctx>();
        if ctx.identify_gen.load(Ordering::SeqCst) != generation {
            return; // a newer identify took over
        }
        let name_dialog_open = ctx.state.lock().settings.name.trim().is_empty();
        if ctx.identify_restore_hide.swap(false, Ordering::SeqCst) && !name_dialog_open {
            if let Some(w) = main_window(&app2) {
                let _ = w.hide();
            }
        }
    });
}

// ---------------------------------------------------------------- commands

#[tauri::command]
fn get_state(ctx: tauri::State<'_, Ctx>) -> Snapshot {
    ctx.state.snapshot()
}

#[tauri::command]
fn get_settings(ctx: tauri::State<'_, Ctx>) -> Settings {
    ctx.state.settings()
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    ctx: tauri::State<'_, Ctx>,
    settings: Settings,
) -> Result<Settings, String> {
    let mut s = settings;
    s.id = ctx.state.lock().settings.id.clone();
    s.name = s.name.trim().to_string();
    if s.name.is_empty() {
        return Err("장비명을 입력하세요".into());
    }
    s.on = s.on.trim().to_string();
    s.off = s.off.trim().to_string();
    s.token = s.token.trim().to_string();
    if let Some(t) = s.target.as_mut() {
        t.ip = t.ip.trim().to_string();
    }
    s.validate()?;
    apply_settings(&app, s)
}

#[tauri::command]
fn set_unmute_minutes(
    app: AppHandle,
    ctx: tauri::State<'_, Ctx>,
    minutes: u32,
) -> Result<(), String> {
    let mut s = ctx.state.settings();
    s.unmute_minutes = minutes;
    s.validate()?;
    apply_settings(&app, s).map(|_| ())
}

#[tauri::command]
fn unmute_now(ctx: tauri::State<'_, Ctx>) {
    ctx.send_mute(MuteCmd::UnmuteNow);
}

// ---------------------------------------------------------------- app

fn format_remaining(sec: u64) -> String {
    let h = sec / 3600;
    let m = (sec % 3600) / 60;
    let s = sec % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

/// Pushes a `state` event to the UI twice a second and keeps the tray tooltip current.
async fn state_loop(app: AppHandle, state: AppState) {
    let mut ticker = tokio::time::interval(Duration::from_millis(500));
    let mut last_tooltip = String::new();
    loop {
        ticker.tick().await;
        let snap = state.snapshot();
        let _ = app.emit("state", &snap);

        let mut tooltip = format!(
            "TMS SoundSense - {}",
            if snap.sound {
                "소리 감지됨"
            } else {
                "무음"
            }
        );
        if snap.muted {
            match snap.unmute_remaining_sec {
                Some(r) => {
                    tooltip.push_str(&format!("\n뮤트 자동해제까지 {}", format_remaining(r)))
                }
                None => tooltip.push_str("\n뮤트 상태"),
            }
        }
        if tooltip != last_tooltip {
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                let _ = tray.set_tooltip(Some(&tooltip));
            }
            last_tooltip = tooltip;
        }
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("TMS SoundSense")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let open = matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } | TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            );
            if open {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init();

    let settings = settings::load();
    log::info!(
        "TMS SoundSense {} starting; settings at {}",
        state::VERSION,
        settings::settings_path().display()
    );
    let state = Shared::new(settings.clone());
    let (mute_tx, mute_rx) = mpsc::channel::<MuteCmd>();
    let ctx = Ctx {
        state: state.clone(),
        mute_tx: Mutex::new(mute_tx),
        identify_gen: AtomicU64::new(0),
        identify_restore_hide: AtomicBool::new(false),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch just brings the existing window to the front.
            show_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(ctx)
        .invoke_handler(tauri::generate_handler![
            get_state,
            get_settings,
            save_settings,
            set_unmute_minutes,
            unmute_now
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            apply_autostart(&handle, settings.autostart);
            build_tray(app)?;

            if let Some(w) = main_window(&handle) {
                let w2 = w.clone();
                w.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        // Closing hides to the tray; 종료 in the tray menu really quits.
                        api.prevent_close();
                        let _ = w2.hide();
                    }
                });
            }
            if settings.name.trim().is_empty() {
                // First run: the UI shows the mandatory 장비명 dialog.
                show_window(&handle);
            }

            let port = settings.discovery_port;
            std::thread::spawn(move || firewall::ensure_rule(port));

            let meter = audio::PeakMeter::new();
            audio::spawn(meter.clone(), state.clone());
            tauri::async_runtime::spawn(audio::detector_loop(meter, state.clone()));
            mute::spawn(state.clone(), mute_rx);
            tauri::async_runtime::spawn(sender::run(state.clone()));
            tauri::async_runtime::spawn(discovery::run(handle.clone(), state.clone()));
            tauri::async_runtime::spawn(state_loop(handle, state.clone()));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                // Keep running in the tray unless an explicit app.exit() asked to quit.
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
