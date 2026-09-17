mod capture;
mod discovery;
mod firewall;
mod history;
mod monitor;
mod netinfo;
mod npcap;
mod report;
mod settings;
mod state;
mod transfer;

use serde_json::{json, Value};
use state::AppState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;
use windows::core::PCWSTR;
use windows::Win32::Media::Audio::{
    PlaySoundW, SND_ASYNC, SND_FILENAME, SND_MEMORY, SND_NODEFAULT,
};

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

pub fn play_sound(path: &str) -> Result<(), String> {
    let ok = unsafe {
        if path.is_empty() {
            static SOUND: &[u8] = include_bytes!("../../assets/failed.wav");
            PlaySoundW(
                PCWSTR(SOUND.as_ptr().cast()),
                None,
                SND_ASYNC | SND_MEMORY | SND_NODEFAULT,
            )
        } else {
            if !path.to_lowercase().ends_with(".wav") || !std::path::Path::new(path).is_file() {
                return Err("WAV 파일을 찾을 수 없습니다".into());
            }
            let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
            PlaySoundW(
                PCWSTR(wide.as_ptr()),
                None,
                SND_ASYNC | SND_FILENAME | SND_NODEFAULT,
            )
        }
    };
    if ok.as_bool() {
        Ok(())
    } else {
        Err("경보음 재생 실패".into())
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
        if old != next.autostart && std::env::var_os("TMS_PING_TEST_MODE").is_none() {
            let result = if next.autostart {
                app.autolaunch().enable()
            } else {
                app.autolaunch().disable()
            };
            if let Err(e) = result {
                let _ = state.apply(json!({"autostart":old}), false);
                return Err(format!("Windows 자동 시작 설정 실패: {e}"));
            }
        }
        if next.mute_state || !next.sound_enabled {
            unsafe {
                let _ = PlaySoundW(None, None, Default::default());
            }
        }
        Ok(next)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn set_running(state: tauri::State<AppState>, running: bool) -> Result<(), String> {
    let mut g = state.lock();
    if running && !g.settings.targets.iter().any(|t| t.enabled) {
        return Err("활성 감시 대상을 먼저 등록하세요".into());
    }
    if g.running != running {
        g.running = running;
        g.generation += 1;
        g.results.clear();
        g.last_payload = None;
    }
    if !running {
        unsafe {
            let _ = PlaySoundW(None, None, Default::default());
        }
    }
    Ok(())
}

#[tauri::command]
async fn clear_logs(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut g = state.lock();
        state
            .history
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear()?;
        g.logs.clear();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn query_logs(
    state: tauri::State<'_, AppState>,
    cursor: Option<history::Cursor>,
    search: String,
    status: String,
) -> Result<history::Page, String> {
    if search.len() > 512 {
        return Err("검색어가 너무 깁니다".into());
    }
    let query = state
        .history
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .query();
    tauri::async_runtime::spawn_blocking(move || query.page(cursor, &search, &status, 100))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn browse_sound(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("WAV 경보음", &["wav"])
            .blocking_pick_file()
            .map(|p| p.to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn test_sound(path: String) -> Result<(), String> {
    play_sound(&path)
}

#[tauri::command]
async fn import_settings(app: AppHandle) -> Result<Option<settings::Settings>, String> {
    let dialog_app = app.clone();
    let patch = tauri::async_runtime::spawn_blocking(move || -> Result<Option<Value>, String> {
        let Some(file) = dialog_app
            .dialog()
            .file()
            .add_filter("감시 설정", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 1_000_000 {
            return Err("설정 파일은 1MB 이하만 가져올 수 있습니다".into());
        }
        let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let value: Value =
            serde_json::from_str(raw.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())?;
        settings::Settings::import_patch(value).map(Some)
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
            .add_filter("감시 설정", &["json"])
            .set_file_name("ping-monitor-settings.json")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let backup = app
            .state::<AppState>()
            .lock()
            .settings
            .patch(patch)?
            .backup();
        settings::write_json(&path, &backup)?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// True when the portable zip's Npcap installer sits next to the exe (and Npcap is missing).
#[tauri::command]
fn npcap_installer_available() -> bool {
    !npcap::installed() && npcap::installer_path().is_some()
}

/// Run the bundled Npcap installer (elevated, interactive) and report whether Npcap is now present.
#[tauri::command]
async fn install_npcap() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(npcap::install)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn capture_interfaces() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(capture::interfaces)
        .await
        .map_err(|e| e.to_string())?
}

pub fn run() {
    env_logger::init();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let runtime = dir.join("webview2");
            if !cfg!(debug_assertions) || runtime.exists() {
                std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &runtime);
                if tauri::webview_version().is_err() {
                    unsafe {
                        windows::Win32::UI::WindowsAndMessaging::MessageBoxW(None,
                        windows::core::w!("실행 파일 옆의 webview2 폴더가 없거나 손상되었습니다.\n\n설치 마법사를 다시 실행해 복구하세요. 포터블 버전은 ZIP을 통째로 풀어 실행 파일과 webview2 폴더를 같은 위치에 두세요."),
                        windows::core::w!("네트워크 ping 감시"), windows::Win32::UI::WindowsAndMessaging::MB_ICONERROR);
                    }
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
            query_logs,
            browse_sound,
            test_sound,
            import_settings,
            export_settings,
            capture_interfaces,
            npcap_installer_available,
            install_npcap
        ])
        .setup(move |app| {
            // Single-instance plugins initialize before storage, avoiding concurrent migration.
            let dir = settings::data_dir();
            let settings = settings::load(&dir).map_err(std::io::Error::other)?;
            let state = AppState::new(settings, dir).map_err(std::io::Error::other)?;
            app.manage(state.clone());
            let open =
                MenuItem::with_id(app, "open", "네트워크 ping 감시 열기", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("네트워크 ping 감시")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            let handle = app.handle().clone();
            if std::env::var_os("TMS_PING_TEST_MODE").is_none() {
                let autostart = if state.lock().settings.autostart {
                    handle.autolaunch().enable()
                } else {
                    handle.autolaunch().disable()
                };
                if let Err(e) = autostart {
                    log::error!("autostart: {e}");
                }
                std::thread::spawn(|| {
                    firewall::ensure_rule(settings::DISCOVERY_PORT);
                    // Portable zip: offer the bundled Npcap installer once the firewall step is done.
                    npcap::offer_at_startup();
                });
            }
            tauri::async_runtime::spawn(discovery::run(handle.clone(), state.clone()));
            tauri::async_runtime::spawn(monitor::run(handle.clone(), state.clone()));
            tauri::async_runtime::spawn(monitor::heartbeat(handle.clone(), state.clone()));
            tauri::async_runtime::spawn(report::run(state.clone()));
            let capture_state = state.clone();
            std::thread::spawn(move || capture::run(handle, capture_state));
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
        let message: Vec<u16> = format!("네트워크 ping 감시 실행 실패: {e}")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        unsafe {
            windows::Win32::UI::WindowsAndMessaging::MessageBoxW(
                None,
                PCWSTR(message.as_ptr()),
                windows::core::w!("네트워크 ping 감시"),
                windows::Win32::UI::WindowsAndMessaging::MB_ICONERROR,
            );
        }
    }
}
