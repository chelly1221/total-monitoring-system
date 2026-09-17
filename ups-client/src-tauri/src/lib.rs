mod badge;
mod discovery;
mod firewall;
mod monitor;
mod netinfo;
mod pcmute;
mod settings;
mod snmp;
mod state;
mod transfer;
mod ups;

use serde_json::{json, Value};
use state::AppState;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;
use windows::core::PCWSTR;
use windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_FILENAME, SND_MEMORY, SND_NODEFAULT};

const APP_TITLE: &str = "2026 1레이더 UPS";

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn identify(app: &AppHandle, sec: u64) {
    show(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.request_user_attention(Some(tauri::UserAttentionType::Critical));
    }
    let _ = app.emit("identify", sec);
    unsafe {
        let _ = windows::Win32::System::Diagnostics::Debug::MessageBeep(
            windows::Win32::UI::WindowsAndMessaging::MB_OK,
        );
    }
}

/// Play a unit's alarm sound: the custom WAV when set, else the built-in UPS#1 / UPS#2 clip.
pub fn play_sound(path: &str, unit: u8) -> Result<(), String> {
    static UPS1: &[u8] = include_bytes!("../../assets/UPS1.wav");
    static UPS2: &[u8] = include_bytes!("../../assets/UPS2.wav");
    let ok = unsafe {
        if path.is_empty() {
            let clip = if unit == 2 { UPS2 } else { UPS1 };
            PlaySoundW(PCWSTR(clip.as_ptr().cast()), None, SND_ASYNC | SND_MEMORY | SND_NODEFAULT)
        } else {
            if !path.to_lowercase().ends_with(".wav") || !std::path::Path::new(path).is_file() {
                return Err("WAV 파일을 찾을 수 없습니다".into());
            }
            let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
            PlaySoundW(PCWSTR(wide.as_ptr()), None, SND_ASYNC | SND_FILENAME | SND_NODEFAULT)
        }
    };
    if ok.as_bool() {
        Ok(())
    } else {
        Err("경보음 재생 실패".into())
    }
}

fn stop_sound() {
    unsafe {
        let _ = PlaySoundW(None, None, Default::default());
    }
}

#[tauri::command]
fn snapshot(state: tauri::State<AppState>) -> Value {
    state.snapshot()
}

#[tauri::command]
async fn save_settings(app: AppHandle, patch: Value) -> Result<settings::Settings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let old = state.lock().settings.autostart;
        let next = state.apply(patch, false)?;
        if old != next.autostart && std::env::var_os("TMS_UPS_TEST_MODE").is_none() {
            let result = if next.autostart { app.autolaunch().enable() } else { app.autolaunch().disable() };
            if let Err(e) = result {
                let _ = state.apply(json!({"autostart": old}), false);
                return Err(format!("Windows 자동 시작 설정 실패: {e}"));
            }
        }
        if !next.sound_enabled || next.units.iter().all(|u| u.muted) {
            stop_sound();
        }
        let _ = app.emit("snapshot", state.snapshot());
        Ok(next)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn set_running(app: AppHandle, state: tauri::State<AppState>, running: bool) -> Result<(), String> {
    {
        let mut g = state.lock();
        if g.running != running {
            g.running = running;
            g.generation += 1;
        }
    }
    if !running {
        stop_sound();
    }
    let _ = app.emit("snapshot", state.snapshot());
    Ok(())
}

#[tauri::command]
fn clear_logs(app: AppHandle, state: tauri::State<AppState>, unit: u8) -> Result<(), String> {
    let index = (unit as usize).checked_sub(1).filter(|i| *i < settings::UNIT_COUNT).ok_or("UPS 번호가 올바르지 않습니다")?;
    state.lock().units[index].logs.clear();
    let _ = app.emit("snapshot", state.snapshot());
    Ok(())
}

#[tauri::command]
async fn browse_sound(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().add_filter("WAV 경보음", &["wav"]).blocking_pick_file().map(|p| p.to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn test_sound(path: String, unit: u8) -> Result<(), String> {
    play_sound(&path, unit)
}

#[tauri::command]
async fn import_settings(app: AppHandle) -> Result<Option<settings::Settings>, String> {
    let dialog_app = app.clone();
    let patch = tauri::async_runtime::spawn_blocking(move || -> Result<Option<Value>, String> {
        let Some(file) = dialog_app.dialog().file().add_filter("UPS 감시 설정", &["json"]).blocking_pick_file() else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 1_000_000 {
            return Err("설정 파일은 1MB 이하만 가져올 수 있습니다".into());
        }
        let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let value: Value = serde_json::from_str(raw.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())?;
        let current = dialog_app.state::<AppState>().lock().settings.clone();
        current.import_patch(value).map(Some)
    })
    .await
    .map_err(|e| e.to_string())??;
    match patch {
        Some(patch) => save_settings(app, patch).await.map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
async fn export_settings(app: AppHandle, patch: Value) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("UPS 감시 설정", &["json"])
            .set_file_name("ups-monitor-settings.json")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let backup = app.state::<AppState>().lock().settings.patch(patch)?.backup();
        settings::write_json(&path, &backup)?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn message_box(text: &str) {
    let message: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = APP_TITLE.encode_utf16().chain(Some(0)).collect();
    unsafe {
        windows::Win32::UI::WindowsAndMessaging::MessageBoxW(
            None,
            PCWSTR(message.as_ptr()),
            PCWSTR(title.as_ptr()),
            windows::Win32::UI::WindowsAndMessaging::MB_ICONERROR,
        );
    }
}

pub fn run() {
    env_logger::init();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let runtime = dir.join("webview2");
            if !cfg!(debug_assertions) || runtime.exists() {
                std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &runtime);
                if tauri::webview_version().is_err() {
                    message_box("실행 파일 옆의 webview2 폴더가 없거나 손상되었습니다.\n\n설치 마법사를 다시 실행해 복구하세요. 포터블 버전은 ZIP을 통째로 풀어 실행 파일과 webview2 폴더를 같은 위치에 두세요.");
                    return;
                }
            }
        }
    }
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            snapshot,
            save_settings,
            set_running,
            clear_logs,
            browse_sound,
            test_sound,
            import_settings,
            export_settings,
            pcmute::unmute_now,
            pcmute::mute_choose,
            pcmute::mute_cancel,
            pcmute::mute_popup_dismiss
        ])
        .setup(move |app| {
            let dir = settings::data_dir();
            let settings = settings::load(&dir).map_err(std::io::Error::other)?;
            let state = AppState::new(settings, dir);
            app.manage(state.clone());
            let (mute_ctx, mute_rx) = pcmute::MuteCtx::new();
            app.manage(mute_ctx);
            let status = MenuItem::with_id(app, "status", "PC 소리 켜짐", false, None::<&str>)?;
            let cancel = MenuItem::with_id(app, "cancel-timer", "음소거 타이머 취소", false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "2026 1레이더 UPS 열기", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status, &cancel, &PredefinedMenuItem::separator(app)?, &open, &PredefinedMenuItem::separator(app)?, &quit])?;
            if let Ok(mut slot) = app.state::<pcmute::MuteCtx>().tray_items.lock() {
                *slot = Some((status, cancel));
            }
            TrayIconBuilder::with_id(pcmute::TRAY_ID)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip(APP_TITLE)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show(app),
                    "cancel-timer" => {
                        app.state::<pcmute::MuteCtx>().send(pcmute::MuteCmd::CancelCountdown);
                        pcmute::hide_popup(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            let handle = app.handle().clone();
            if std::env::var_os("TMS_UPS_TEST_MODE").is_none() {
                let autostart = if state.lock().settings.autostart { handle.autolaunch().enable() } else { handle.autolaunch().disable() };
                if let Err(e) = autostart {
                    log::error!("autostart: {e}");
                }
                std::thread::spawn(|| firewall::ensure_rule(settings::DISCOVERY_PORT));
            }
            tauri::async_runtime::spawn(discovery::run(handle.clone(), state.clone()));
            for unit in 1..=settings::UNIT_COUNT as u8 {
                tauri::async_runtime::spawn(monitor::run_unit(handle.clone(), state.clone(), unit));
            }
            tauri::async_runtime::spawn(monitor::alarm_loop(handle.clone(), state.clone()));
            if let Some(mw) = app.get_webview_window(pcmute::MUTE_WINDOW) {
                let mw2 = mw.clone();
                mw.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = mw2.hide();
                    }
                });
            }
            pcmute::spawn(handle.clone(), state.clone(), mute_rx);
            static ICON: &[u8] = include_bytes!("../icons/128x128.png");
            tauri::async_runtime::spawn(pcmute::tray_loop(handle, state, ICON, APP_TITLE));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!());
    if let Err(e) = result {
        message_box(&format!("{APP_TITLE} 실행 실패: {e}"));
    }
}
