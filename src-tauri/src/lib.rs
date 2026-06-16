use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::process::{Child, Command};
use tokio::sync::watch;

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

#[derive(Clone, Copy, PartialEq)]
enum ProcKind {
    Server,
    Worker,
}

impl ProcKind {
    fn name(self) -> &'static str {
        match self {
            ProcKind::Server => "server",
            ProcKind::Worker => "worker",
        }
    }
}

// Event payload pushed to the WebView so the UI can show an "ingestion down" banner.
#[derive(Clone, serde::Serialize)]
struct ProcessStatus {
    kind: String,   // "server" | "worker"
    status: String, // "running" | "down"
}

struct AppState {
    // Broadcast channel: set to true once on shutdown to stop supervisors + kill children.
    shutdown_tx: watch::Sender<bool>,
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

/// Open (append) a log file for a child process under <data_dir>/logs/.
/// Checked at each (re)spawn and app launch: if the file is already over 5 MB it is
/// first rotated to <name>.1.log. Rotation is NOT continuous — a single very long
/// uninterrupted run can exceed 5 MB until the next respawn/launch.
/// Without this, CREATE_NO_WINDOW means all child stdout/stderr is lost in production.
fn open_log_file(data_dir: &PathBuf, name: &str) -> Option<std::fs::File> {
    let log_dir = data_dir.join("logs");
    std::fs::create_dir_all(&log_dir).ok()?;
    let path = log_dir.join(format!("{}.log", name));
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 5 * 1024 * 1024 {
            let _ = std::fs::rename(&path, log_dir.join(format!("{}.1.log", name)));
        }
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()
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

/// Attach a log file to a command's stdout+stderr (best effort).
fn attach_log(cmd: &mut Command, log: Option<std::fs::File>) {
    if let Some(file) = log {
        match file.try_clone() {
            Ok(err_clone) => {
                cmd.stdout(Stdio::from(file)).stderr(Stdio::from(err_clone));
            }
            Err(_) => {
                cmd.stdout(Stdio::from(file));
            }
        }
    }
}

fn spawn_server(resource_dir: &PathBuf, database_url: &str, log: Option<std::fs::File>) -> Result<Child, String> {
    let server_script = resource_dir.join("standalone").join("server.js");

    let mut cmd = Command::new("node");
    cmd.arg(&server_script)
        .env("PORT", "7777")
        .env("HOSTNAME", "0.0.0.0")
        .env("DATABASE_URL", database_url)
        .current_dir(resource_dir.join("standalone"))
        .kill_on_drop(true);
    attach_log(&mut cmd, log);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
        .map_err(|e| format!("Failed to start server: {}", e))
}

fn spawn_worker(resource_dir: &PathBuf, database_url: &str, log: Option<std::fs::File>) -> Result<Child, String> {
    let worker_script = resource_dir.join("worker").join("index.js");

    let mut cmd = Command::new("node");
    cmd.arg(&worker_script)
        .env("DATABASE_URL", database_url)
        .current_dir(resource_dir)
        .kill_on_drop(true);
    attach_log(&mut cmd, log);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
        .map_err(|e| format!("Failed to start worker: {}", e))
}

fn emit_status(handle: &tauri::AppHandle, kind: ProcKind, status: &str) {
    let _ = handle.emit(
        "process-status",
        ProcessStatus { kind: kind.name().to_string(), status: status.to_string() },
    );
}

/// Backoff (seconds) before respawning after a crash: 1,1,2,4,8,16,30(cap).
fn backoff_secs(restart_count: u32) -> u64 {
    match restart_count {
        0 | 1 => 1,
        n => (1u64 << (n - 1).min(5)).min(30),
    }
}

#[cfg(windows)]
fn assign_to_job(handle: &tauri::AppHandle, kind: ProcKind, pid: Option<u32>) {
    let Some(pid) = pid else { return };
    let state = handle.state::<AppState>();
    // Copy the raw job handle out under the lock, then release the guard (and the
    // State borrow) before the FFI call so neither outlives `state`.
    let job_raw = match state.job.lock() {
        Ok(slot) => slot.as_ref().map(|j| j.raw()),
        Err(_) => None,
    };
    if let Some(raw) = job_raw {
        match winjob::assign_pid(raw, pid) {
            Ok(_) => eprintln!("[tms] {} (pid {}) assigned to job", kind.name(), pid),
            Err(e) => eprintln!("[tms] {} job-assign failed: {}", kind.name(), e),
        }
    }
}

/// Supervise a child process: (re)spawn on unexpected exit with capped backoff and a
/// crash-loop guard, assign each instance to the Job Object, redirect its output to a
/// log file, and emit running/down status to the UI. Stops cleanly on shutdown.
async fn supervise(
    handle: tauri::AppHandle,
    kind: ProcKind,
    resource_dir: PathBuf,
    database_url: String,
    data_dir: PathBuf,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut restart_count: u32 = 0;

    loop {
        if *shutdown.borrow() {
            break;
        }

        let log = open_log_file(&data_dir, kind.name());
        let spawn_res = match kind {
            ProcKind::Server => spawn_server(&resource_dir, &database_url, log),
            ProcKind::Worker => spawn_worker(&resource_dir, &database_url, log),
        };

        let mut child = match spawn_res {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[tms] {} spawn failed: {}", kind.name(), e);
                emit_status(&handle, kind, "down");
                restart_count = restart_count.saturating_add(1);
                let secs = backoff_secs(restart_count);
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(secs)) => {}
                    _ = shutdown.changed() => {}
                }
                continue;
            }
        };

        let pid = child.id();
        eprintln!("[tms] {} started (pid {:?})", kind.name(), pid);
        #[cfg(windows)]
        assign_to_job(&handle, kind, pid);
        emit_status(&handle, kind, "running");

        let started = Instant::now();

        tokio::select! {
            status = child.wait() => {
                if *shutdown.borrow() {
                    break;
                }
                eprintln!("[tms] {} exited unexpectedly: {:?}", kind.name(), status);
                emit_status(&handle, kind, "down");
                // A child that ran healthily for a while is not a crash loop — reset.
                if started.elapsed() > Duration::from_secs(60) {
                    restart_count = 0;
                }
                restart_count = restart_count.saturating_add(1);
                let secs = backoff_secs(restart_count);
                eprintln!("[tms] respawning {} in {}s (restart #{})", kind.name(), secs, restart_count);
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(secs)) => {}
                    _ = shutdown.changed() => {}
                }
            }
            _ = shutdown.changed() => {
                eprintln!("[tms] {} shutting down", kind.name());
                let _ = child.kill().await;
                break;
            }
        }
    }
}

#[tauri::command]
async fn open_sub_window(app: tauri::AppHandle, label: String, title: String, path: String) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(&label) {
        // Restore if minimized / hidden, then bring to front and focus.
        let _ = existing.unminimize();
        let _ = existing.show();
        existing.set_focus().map_err(|e| e.to_string())?;
        // The window was already open — flash a locator overlay on it so the user can
        // spot which window/monitor it is. The event is broadcast (Tauri's JS listen is
        // a catch-all, so target scoping is unreliable); the payload carries the target
        // window label and each overlay shows itself only if it matches its own label.
        let _ = app.emit("window-highlight", (label.clone(), title.clone()));
        return Ok(());
    }

    let url = format!("http://localhost:7777{}", path);
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url.parse().unwrap()))
        .title(&title)
        .inner_size(1920.0, 1080.0)
        // No native title bar — the in-app header acts as the title bar (drag region +
        // close button), matching the main window (decorations: false in tauri.conf.json).
        .decorations(false)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (shutdown_tx, _shutdown_rx) = watch::channel(false);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![open_sub_window])
        .manage(AppState {
            shutdown_tx,
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

                // Launch supervised server + worker. Each task respawns its child on
                // unexpected exit and stops when the shutdown signal fires.
                let state = handle.state::<AppState>();
                let rx_server = state.shutdown_tx.subscribe();
                let rx_worker = state.shutdown_tx.subscribe();

                tauri::async_runtime::spawn(supervise(
                    handle.clone(),
                    ProcKind::Server,
                    resource_dir.clone(),
                    database_url.clone(),
                    data_dir.clone(),
                    rx_server,
                ));
                tauri::async_runtime::spawn(supervise(
                    handle.clone(),
                    ProcKind::Worker,
                    resource_dir,
                    database_url,
                    data_dir,
                    rx_worker,
                ));

                tokio::time::sleep(Duration::from_secs(3)).await;

                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.eval("window.location.reload()");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    let app = window.app_handle();
                    // Closing the main window tears down the whole app: close every other
                    // window (UPS/온습도 sub-windows) so none linger behind a dead server.
                    for (label, w) in app.webview_windows() {
                        if label != "main" {
                            let _ = w.close();
                        }
                    }
                    // Signal supervisors to stop and kill their children. On Windows the
                    // Job Object also force-kills everything when the parent process exits.
                    let state = app.state::<AppState>();
                    let _ = state.shutdown_tx.send(true);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
