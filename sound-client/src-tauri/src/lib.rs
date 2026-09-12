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
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::image::Image;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WindowEvent, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Diagnostics::Debug::MessageBeep;
use windows::Win32::UI::WindowsAndMessaging::{
    FlashWindowEx, FLASHWINFO, FLASHW_ALL, FLASHW_TIMERNOFG, MB_OK,
};

const MAIN_WINDOW: &str = "main";
const MUTE_WINDOW: &str = "mute";
const TRAY_ID: &str = "main";
const POPUP_MARGIN: i32 = 12;

/// Which icon the tray and taskbar show. Sound wins over mute: an alarm is what matters.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum IconState {
    Normal,
    Muted,
    Sound,
}

impl IconState {
    fn of(snap: &Snapshot) -> Self {
        if snap.sound {
            IconState::Sound
        } else if snap.muted {
            IconState::Muted
        } else {
            IconState::Normal
        }
    }

    fn image(self) -> Result<Image<'static>, tauri::Error> {
        let bytes: &'static [u8] = match self {
            IconState::Normal => include_bytes!("../icons/src/state-normal-64.png"),
            IconState::Muted => include_bytes!("../icons/src/state-muted-64.png"),
            IconState::Sound => include_bytes!("../icons/src/state-sound-64.png"),
        };
        Image::from_bytes(bytes)
    }
}

/// Swap the tray icon and the main window (taskbar) icon to match the state.
fn apply_icon(app: &AppHandle, state: IconState) {
    match state.image() {
        Ok(img) => {
            match app.tray_by_id(TRAY_ID) {
                Some(tray) => {
                    if let Err(e) = tray.set_icon(Some(img.clone())) {
                        log::warn!("tray icon update failed: {e}");
                    }
                }
                None => log::warn!("tray icon not found; cannot update"),
            }
            if let Some(w) = main_window(app) {
                if let Err(e) = w.set_icon(img) {
                    log::warn!("window icon update failed: {e}");
                }
            }
            log::info!("icon -> {state:?}");
        }
        Err(e) => log::warn!("state icon decode failed: {e}"),
    }
}

/// Tauri-managed context shared by commands and background tasks.
pub struct Ctx {
    state: AppState,
    mute_tx: Mutex<mpsc::Sender<MuteCmd>>,
    /// Increments per identify so an older timer never hides the window of a newer one.
    identify_gen: AtomicU64,
    /// Whether the window was hidden before the current identify sequence started.
    identify_restore_hide: AtomicBool,
    /// Tray menu entries updated by the state loop (status line, 타이머 취소).
    tray_items: Mutex<Option<TrayItems>>,
}

struct TrayItems {
    status: MenuItem<Wry>,
    cancel: MenuItem<Wry>,
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

fn mute_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(MUTE_WINDOW)
}

/// Show the mute-duration popup docked at the bottom-right of the primary work area
/// (just above the taskbar / tray), like the original UnmuteTimer popup.
pub fn show_mute_popup(app: &AppHandle) {
    let Some(w) = mute_window(app) else {
        log::warn!("mute popup window missing");
        return;
    };
    match (w.primary_monitor(), w.outer_size()) {
        (Ok(Some(monitor)), Ok(size)) => {
            let area = monitor.work_area();
            let x = area.position.x + area.size.width as i32 - size.width as i32 - POPUP_MARGIN;
            let y = area.position.y + area.size.height as i32 - size.height as i32 - POPUP_MARGIN;
            if let Err(e) = w.set_position(PhysicalPosition::new(x.max(0), y.max(0))) {
                log::warn!("mute popup set_position failed: {e}");
            }
        }
        (m, s) => log::warn!("mute popup geometry unavailable: monitor={m:?} size={s:?}"),
    }
    if let Err(e) = w.show() {
        log::warn!("mute popup show failed: {e}");
    }
    if let Err(e) = w.set_focus() {
        log::warn!("mute popup focus failed: {e}");
    }
    log::info!("mute popup shown");
    let _ = app.emit("mute-popup", true);
}

pub fn hide_mute_popup(app: &AppHandle) {
    if let Some(w) = mute_window(app) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        }
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

/// Operator picked a duration (popup or 음소거 tab): start the countdown.
#[tauri::command]
fn mute_choose(app: AppHandle, ctx: tauri::State<'_, Ctx>, minutes: u32) -> Result<(), String> {
    if !(1..=24 * 60).contains(&minutes) {
        return Err("1분~24시간 사이로 선택하세요".into());
    }
    ctx.send_mute(MuteCmd::StartCountdown(minutes));
    hide_mute_popup(&app);
    Ok(())
}

/// Stop the countdown; the PC stays muted.
#[tauri::command]
fn mute_cancel(app: AppHandle, ctx: tauri::State<'_, Ctx>) {
    ctx.send_mute(MuteCmd::CancelCountdown);
    hide_mute_popup(&app);
}

/// 나중에: close the popup without starting a timer.
#[tauri::command]
fn mute_popup_dismiss(app: AppHandle) {
    hide_mute_popup(&app);
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
    let mut last_icon: Option<IconState> = None;
    loop {
        ticker.tick().await;
        let snap = state.snapshot();
        let _ = app.emit("state", &snap);

        let icon = IconState::of(&snap);
        if last_icon != Some(icon) {
            apply_icon(&app, icon);
            last_icon = Some(icon);
        }

        let mute_status = if snap.muted {
            match snap.unmute_remaining_sec {
                Some(r) => format!("음소거 해제까지 {}", format_remaining(r)),
                None => "음소거 감지됨".to_string(),
            }
        } else {
            "감시 중".to_string()
        };
        let tooltip = format!(
            "통합알람감시 음성탐지기 - {}\n{}",
            if snap.sound { "소리 감지됨" } else { "무음" },
            mute_status
        );
        if tooltip != last_tooltip {
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                let _ = tray.set_tooltip(Some(&tooltip));
            }
            if let Ok(items) = app.state::<Ctx>().tray_items.lock() {
                if let Some(items) = items.as_ref() {
                    let _ = items.status.set_text(&mute_status);
                    let _ = items
                        .cancel
                        .set_enabled(snap.muted && snap.unmute_remaining_sec.is_some());
                }
            }
            last_tooltip = tooltip;
        }
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "감시 중", false, None::<&str>)?;
    let cancel = MenuItem::with_id(app, "cancel-timer", "타이머 취소", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&status, &cancel, &sep1, &open, &sep2, &quit])?;
    if let Ok(mut slot) = app.state::<Ctx>().tray_items.lock() {
        *slot = Some(TrayItems { status, cancel });
    }
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("통합알람감시 음성탐지기")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "cancel-timer" => {
                app.state::<Ctx>().send_mute(MuteCmd::CancelCountdown);
                hide_mute_popup(app);
            }
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
        tray_items: Mutex::new(None),
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
            unmute_now,
            mute_choose,
            mute_cancel,
            mute_popup_dismiss
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
            if let Some(mw) = mute_window(&handle) {
                let mw2 = mw.clone();
                mw.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = mw2.hide();
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
            mute::spawn(handle.clone(), state.clone(), mute_rx);
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
