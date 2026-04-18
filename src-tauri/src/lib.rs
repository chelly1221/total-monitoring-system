use std::path::PathBuf;
use tauri::Manager;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

struct ManagedProcesses {
    server: Option<Child>,
    worker: Option<Child>,
}

struct AppState {
    processes: Mutex<ManagedProcesses>,
}

fn get_resource_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .expect("failed to resolve resource dir")
        .join("resources")
}

fn get_node_path() -> String {
    "node".to_string()
}

fn spawn_server(resource_dir: &PathBuf) -> Result<Child, String> {
    let server_script = resource_dir.join("standalone").join("server.js");

    Command::new(get_node_path())
        .arg(&server_script)
        .env("PORT", "7777")
        .env("HOSTNAME", "127.0.0.1")
        .current_dir(resource_dir.join("standalone"))
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start server: {}", e))
}

fn spawn_worker(resource_dir: &PathBuf) -> Result<Child, String> {
    let worker_script = resource_dir.join("worker").join("index.js");

    Command::new(get_node_path())
        .arg(&worker_script)
        .current_dir(resource_dir)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start worker: {}", e))
}

async fn kill_processes(state: &AppState) {
    let mut procs = state.processes.lock().await;
    if let Some(ref mut child) = procs.server {
        let _ = child.kill().await;
    }
    if let Some(ref mut child) = procs.worker {
        let _ = child.kill().await;
    }
    procs.server = None;
    procs.worker = None;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            processes: Mutex::new(ManagedProcesses {
                server: None,
                worker: None,
            }),
        })
        .setup(|app| {
            let handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let resource_dir = get_resource_dir(&handle);

                let server = spawn_server(&resource_dir);
                let worker = spawn_worker(&resource_dir);

                let state = handle.state::<AppState>();
                let mut procs = state.processes.lock().await;

                match server {
                    Ok(child) => procs.server = Some(child),
                    Err(e) => eprintln!("Server start error: {}", e),
                }
                match worker {
                    Ok(child) => procs.worker = Some(child),
                    Err(e) => eprintln!("Worker start error: {}", e),
                }

                drop(procs);

                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.eval("window.location.reload()");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let handle = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<AppState>();
                    kill_processes(&state).await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
