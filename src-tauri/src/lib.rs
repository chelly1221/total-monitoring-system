use std::path::PathBuf;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct ManagedProcesses {
    server: Option<Child>,
    worker: Option<Child>,
}

struct AppState {
    processes: Mutex<ManagedProcesses>,
}

fn get_resource_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .resource_dir()
        .expect("failed to resolve resource dir")
        .join("resources");
    dunce::canonicalize(&dir).unwrap_or(dir)
}

fn get_data_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
    std::fs::create_dir_all(&dir).ok();
    dunce::canonicalize(&dir).unwrap_or(dir)
}

fn get_database_url(data_dir: &PathBuf) -> String {
    let db_path = data_dir.join("app.db");
    format!("file:{}", db_path.display())
}

fn init_database(resource_dir: &PathBuf, database_url: &str) -> Result<(), String> {
    let schema_path = resource_dir.join("prisma").join("schema.prisma");
    if !schema_path.exists() {
        return Err(format!("Prisma schema not found: {}", schema_path.display()));
    }

    let init_script = resource_dir.join("init-db.js");
    if !init_script.exists() {
        return Err(format!("init-db.js not found: {}", init_script.display()));
    }

    let mut cmd = std::process::Command::new("node");
    cmd.arg(&init_script)
        .arg(&schema_path)
        .env("DATABASE_URL", database_url)
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .current_dir(resource_dir);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let status = cmd
        .status()
        .map_err(|e| format!("Failed to run init-db: {}", e))?;

    if !status.success() {
        return Err("Database initialization failed".to_string());
    }

    Ok(())
}

fn spawn_server(resource_dir: &PathBuf, database_url: &str) -> Result<Child, String> {
    let server_script = resource_dir.join("standalone").join("server.js");

    let mut cmd = Command::new("node");
    cmd.arg(&server_script)
        .env("PORT", "7777")
        .env("HOSTNAME", "127.0.0.1")
        .env("DATABASE_URL", database_url)
        .current_dir(resource_dir.join("standalone"))
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
        .map_err(|e| format!("Failed to start server: {}", e))
}

fn spawn_worker(resource_dir: &PathBuf, database_url: &str) -> Result<Child, String> {
    let worker_script = resource_dir.join("worker").join("index.js");

    let mut cmd = Command::new("node");
    cmd.arg(&worker_script)
        .env("DATABASE_URL", database_url)
        .current_dir(resource_dir)
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
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

#[tauri::command]
async fn open_sub_window(app: tauri::AppHandle, label: String, title: String, path: String) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url = format!("http://localhost:7777{}", path);
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url.parse().unwrap()))
        .title(&title)
        .inner_size(1920.0, 1080.0)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![open_sub_window])
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
                let data_dir = get_data_dir(&handle);
                let database_url = get_database_url(&data_dir);

                eprintln!("[tms] Resource dir: {}", resource_dir.display());
                eprintln!("[tms] Data dir: {}", data_dir.display());
                eprintln!("[tms] Database URL: {}", database_url);

                match init_database(&resource_dir, &database_url) {
                    Ok(_) => eprintln!("[tms] Database initialized"),
                    Err(e) => eprintln!("[tms] Database init error: {}", e),
                }

                let server = spawn_server(&resource_dir, &database_url);
                let worker = spawn_worker(&resource_dir, &database_url);

                let state = handle.state::<AppState>();
                let mut procs = state.processes.lock().await;

                match server {
                    Ok(child) => {
                        eprintln!("[tms] Server started");
                        procs.server = Some(child);
                    }
                    Err(e) => eprintln!("[tms] Server start error: {}", e),
                }
                match worker {
                    Ok(child) => {
                        eprintln!("[tms] Worker started");
                        procs.worker = Some(child);
                    }
                    Err(e) => eprintln!("[tms] Worker start error: {}", e),
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
                if window.label() == "main" {
                    let handle = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let state = handle.state::<AppState>();
                        kill_processes(&state).await;
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
