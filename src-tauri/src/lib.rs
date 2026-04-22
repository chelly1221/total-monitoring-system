use std::path::PathBuf;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// On Windows, wrap all spawned children in a Job Object with KILL_ON_JOB_CLOSE.
// When the parent process exits — cleanly, via crash, or via Task Manager "End task" —
// the OS closes the last handle to the job, which forcibly terminates every process in it.
// This is stronger than tokio's kill_on_drop, which relies on normal Drop ordering.
#[cfg(windows)]
mod winjob {
    use std::ptr;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    pub struct JobHandle(HANDLE);
    // HANDLE is a raw pointer — safe to send between threads as we only use it via FFI.
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    impl JobHandle {
        pub fn raw(&self) -> HANDLE { self.0 }
    }

    impl Drop for JobHandle {
        fn drop(&mut self) {
            unsafe {
                if !self.0.is_null() {
                    CloseHandle(self.0);
                }
            }
        }
    }

    pub fn create_kill_on_close() -> Result<JobHandle, String> {
        unsafe {
            let h = CreateJobObjectW(ptr::null(), ptr::null());
            if h.is_null() {
                return Err("CreateJobObjectW failed".to_string());
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                h,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                CloseHandle(h);
                return Err("SetInformationJobObject failed".to_string());
            }
            Ok(JobHandle(h))
        }
    }

    pub fn assign_pid(job: HANDLE, pid: u32) -> Result<(), String> {
        unsafe {
            let h = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if h.is_null() {
                return Err(format!("OpenProcess(pid={}) failed", pid));
            }
            let ok = AssignProcessToJobObject(job, h);
            CloseHandle(h);
            if ok == 0 {
                return Err("AssignProcessToJobObject failed".to_string());
            }
            Ok(())
        }
    }
}

struct ManagedProcesses {
    server: Option<Child>,
    worker: Option<Child>,
}

struct AppState {
    processes: Mutex<ManagedProcesses>,
    #[cfg(windows)]
    job: std::sync::Mutex<Option<winjob::JobHandle>>,
}

#[cfg(windows)]
fn ensure_firewall_rules() {
    let rules = [
        ("TMS Web Server (7777)", "7777"),
        ("TMS WebSocket (7778)", "7778"),
    ];

    for (name, port) in &rules {
        let check = std::process::Command::new("netsh")
            .args(["advfirewall", "firewall", "show", "rule", &format!("name={}", name)])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let needs_add = match check {
            Ok(output) => !output.status.success(),
            Err(_) => true,
        };

        if needs_add {
            eprintln!("[tms] Adding firewall rule: {} (port {})", name, port);
            let mut cmd = std::process::Command::new("powershell");
            cmd.args([
                "-Command",
                &format!(
                    "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=\"{}\" dir=in action=allow protocol=TCP localport={}' -Verb RunAs -WindowStyle Hidden -Wait",
                    name, port
                ),
            ]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            match cmd.status() {
                Ok(s) if s.success() => eprintln!("[tms] Firewall rule added: {}", name),
                Ok(_) => eprintln!("[tms] Firewall rule skipped (user declined): {}", name),
                Err(e) => eprintln!("[tms] Firewall rule error: {}", e),
            }
        }
    }
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
        .env("HOSTNAME", "0.0.0.0")
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
            #[cfg(windows)]
            job: std::sync::Mutex::new(None),
        })
        .setup(|app| {
            let handle = app.handle().clone();

            #[cfg(windows)]
            ensure_firewall_rules();

            #[cfg(windows)]
            {
                match winjob::create_kill_on_close() {
                    Ok(j) => {
                        let state = app.state::<AppState>();
                        if let Ok(mut slot) = state.job.lock() {
                            *slot = Some(j);
                        }
                        eprintln!("[tms] Job Object created (KILL_ON_JOB_CLOSE)");
                    }
                    Err(e) => eprintln!("[tms] Job Object create failed: {} — cleanup relies on kill_on_drop only", e),
                }
            }

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

                #[cfg(windows)]
                {
                    if let Ok(slot) = state.job.lock() {
                        if let Some(job) = slot.as_ref() {
                            let handle_raw = job.raw();
                            let server_pid = procs.server.as_ref().and_then(|c| c.id());
                            let worker_pid = procs.worker.as_ref().and_then(|c| c.id());
                            if let Some(pid) = server_pid {
                                match winjob::assign_pid(handle_raw, pid) {
                                    Ok(_) => eprintln!("[tms] Server (pid {}) assigned to job", pid),
                                    Err(e) => eprintln!("[tms] Server job-assign failed: {}", e),
                                }
                            }
                            if let Some(pid) = worker_pid {
                                match winjob::assign_pid(handle_raw, pid) {
                                    Ok(_) => eprintln!("[tms] Worker (pid {}) assigned to job", pid),
                                    Err(e) => eprintln!("[tms] Worker job-assign failed: {}", e),
                                }
                            }
                        }
                    }
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
