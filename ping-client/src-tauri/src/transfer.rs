//! Server-initiated file transfer and optional install (`transfer` command).
//! Same contract and behaviour as the SoundSense client (docs/sound-client-protocol.md).
//!
//! The server stages a file and points us at it over HTTP. We pull it into the
//! `received` folder in the data directory, verify the SHA-256 the server
//! announced, optionally run it with its window shown (elevated, e.g. the V3 engine setup) and
//! post progress reports back to the server. One transfer runs at a time.

use crate::state::AppState;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

/// Newest received files kept on disk (older ones are deleted before a new download).
const KEEP_RECEIVED_FILES: usize = 3;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const REPORT_INTERVAL: Duration = Duration::from_millis(1000);
/// How long the "완료" / "실패" chip stays on the status tab.
const STATUS_LINGER: Duration = Duration::from_secs(120);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransferRequest {
    pub job: String,
    pub url: String,
    pub report: String,
    pub name: String,
    pub size: u64,
    pub sha256: String,
    pub run: bool,
    pub elevate: bool,
}

fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

fn valid_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && name != "."
        && name != ".."
        && !name.starts_with('.')
        && !name.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
}

fn valid_http_url(url: &str) -> bool {
    url.len() <= 512 && url.starts_with("http://") && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

impl TransferRequest {
    /// Validate a `transfer` datagram. Every field the client acts on is checked here
    /// so a malformed or hostile datagram is rejected before anything touches disk.
    pub fn parse(msg: &Value) -> Result<Self, String> {
        let text = |key: &str| -> Result<String, String> {
            msg.get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .ok_or_else(|| format!("invalid {key}"))
        };
        let job = text("job")?;
        if job.len() > 64 || !job.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err("invalid job".into());
        }
        let url = text("url")?;
        let report = text("report")?;
        if !valid_http_url(&url) || !valid_http_url(&report) {
            return Err("invalid url".into());
        }
        let name = text("name")?;
        if !valid_file_name(&name) {
            return Err("invalid name".into());
        }
        let size = msg
            .get("size")
            .and_then(Value::as_u64)
            .filter(|s| *s > 0 && *s <= MAX_FILE_BYTES)
            .ok_or_else(|| "invalid size".to_string())?;
        let sha256 = text("sha256")?.to_ascii_lowercase();
        if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("invalid sha256".into());
        }
        let run = msg.get("run").and_then(Value::as_bool).unwrap_or(false);
        let elevate = msg.get("elevate").and_then(Value::as_bool).unwrap_or(true);
        if run && !matches!(extension_of(&name).as_str(), "exe" | "msi") {
            return Err("only exe/msi files can be run".into());
        }
        Ok(Self { job, url, report, name, size, sha256, run, elevate })
    }
}

/// Where received files go: `received/` in the data directory (exe folder or APPDATA).
pub fn received_dir(state: &AppState) -> PathBuf {
    state.dir.join("received")
}

fn set_status(state: &AppState, text: impl Into<String>) {
    let text = text.into();
    let mut g = state.lock();
    if g.transfer_status != text {
        log::info!("transfer: {text}");
        g.transfer_status = text;
    }
}

/// Accept a validated request: mark the client busy and run the transfer in the background.
/// Errors here become a negative `ack`; everything later is reported over HTTP.
pub fn start(app: &AppHandle, state: &AppState, req: TransferRequest) -> Result<(), String> {
    {
        let mut g = state.lock();
        if g.transfer_busy {
            return Err("이미 다른 파일을 받는 중입니다".into());
        }
        g.transfer_busy = true;
        g.transfer_status = format!("{} 수신 준비 중", req.name);
    }
    log::info!("transfer accepted: job {} file {} ({} bytes, run={})", req.job, req.name, req.size, req.run);
    let state = state.clone();
    let _ = app;
    tauri::async_runtime::spawn(async move {
        let reporter = Reporter::new(&state, &req);
        let outcome = run_transfer(&state, &req, &reporter).await;
        match outcome {
            Ok(exit_code) => {
                let message = match exit_code {
                    Some(code) if code == 0 => format!("{} 설치(실행) 완료", req.name),
                    Some(code) => format!("{} 실행 종료 (코드 {code})", req.name),
                    None => format!("{} 수신 완료", req.name),
                };
                set_status(&state, message.clone());
                reporter.send("done", req.size, req.size, &message, exit_code).await;
            }
            Err(e) => {
                log::warn!("transfer {} failed: {e}", req.job);
                set_status(&state, format!("{} 실패: {e}", req.name));
                reporter.send("error", 0, req.size, &e, None).await;
            }
        }
        state.lock().transfer_busy = false;
        tokio::time::sleep(STATUS_LINGER).await;
        let mut g = state.lock();
        if !g.transfer_busy {
            g.transfer_status.clear();
        }
    });
    Ok(())
}

/// Posts progress to the server's report URL, at most once per REPORT_INTERVAL while
/// downloading. Failures are logged only: the server treats silence as a stall.
struct Reporter {
    http: reqwest::Client,
    url: String,
    id: String,
    last: std::sync::Mutex<Option<Instant>>,
}

impl Reporter {
    fn new(state: &AppState, req: &TransferRequest) -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
            url: req.report.clone(),
            id: state.lock().settings.id.clone(),
            last: std::sync::Mutex::new(None),
        }
    }

    async fn send(&self, phase: &str, received: u64, total: u64, message: &str, exit_code: Option<i32>) {
        let body = json!({
            "id": self.id,
            "phase": phase,
            "received": received,
            "total": total,
            "message": message,
            "exitCode": exit_code,
        });
        let result = self
            .http
            .post(&self.url)
            .timeout(Duration::from_secs(5))
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .await;
        match result {
            Ok(resp) if resp.status().is_success() => {}
            Ok(resp) => log::warn!("transfer report {phase} rejected: {}", resp.status()),
            Err(e) => log::warn!("transfer report {phase} failed: {e}"),
        }
        if let Ok(mut last) = self.last.lock() {
            *last = Some(Instant::now());
        }
    }

    /// Download progress, rate limited.
    async fn progress(&self, received: u64, total: u64, force: bool) {
        let due = match self.last.lock() {
            Ok(last) => force || last.map(|t| t.elapsed() >= REPORT_INTERVAL).unwrap_or(true),
            Err(_) => true,
        };
        if due {
            self.send("downloading", received, total, "", None).await;
        }
    }
}

fn prune_received(dir: &Path, keep_name: &str) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|e| e.path().is_file())
        .filter(|e| e.file_name().to_string_lossy() != keep_name)
        .map(|e| {
            let modified = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
            (modified, e.path())
        })
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in files.into_iter().skip(KEEP_RECEIVED_FILES.saturating_sub(1)) {
        if let Err(e) = std::fs::remove_file(&path) {
            log::debug!("could not remove old received file {}: {e}", path.display());
        }
    }
}

/// Download, verify and (optionally) run. Returns the exit code when the file was run.
async fn run_transfer(state: &AppState, req: &TransferRequest, reporter: &Reporter) -> Result<Option<i32>, String> {
    let dir = received_dir(state);
    std::fs::create_dir_all(&dir).map_err(|e| format!("수신 폴더를 만들 수 없습니다: {e}"))?;
    prune_received(&dir, &req.name);
    let final_path = dir.join(&req.name);
    let part_path = dir.join(format!("{}.part", req.name));

    reporter.progress(0, req.size, true).await;
    set_status(state, format!("{} 받는 중 0%", req.name));
    let result = download(state, req, reporter, &part_path).await;
    if let Err(e) = result {
        let _ = std::fs::remove_file(&part_path);
        return Err(e);
    }

    reporter.send("verifying", req.size, req.size, "", None).await;
    let _ = std::fs::remove_file(&final_path);
    std::fs::rename(&part_path, &final_path).map_err(|e| format!("파일을 저장하지 못했습니다: {e}"))?;
    log::info!("transfer {}: saved {}", req.job, final_path.display());

    if !req.run {
        return Ok(None);
    }
    set_status(state, format!("{} 실행 중", req.name));
    reporter
        .send("running", req.size, req.size, "설치 프로그램을 실행했습니다. 완료될 때까지 기다리는 중입니다.", None)
        .await;
    let path = final_path.clone();
    let elevate = req.elevate;
    let code = tauri::async_runtime::spawn_blocking(move || run_file(&path, elevate))
        .await
        .map_err(|e| format!("실행 작업이 중단되었습니다: {e}"))??;
    log::info!("transfer {}: {} exited with {code}", req.job, req.name);
    Ok(Some(code))
}

async fn download(state: &AppState, req: &TransferRequest, reporter: &Reporter, dest: &Path) -> Result<(), String> {
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP 클라이언트 오류: {e}"))?;
    let mut resp = http
        .get(&req.url)
        .send()
        .await
        .map_err(|e| format!("서버에 연결하지 못했습니다: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("서버가 파일을 주지 않았습니다 (HTTP {})", resp.status().as_u16()));
    }
    if let Some(len) = resp.content_length() {
        if len != req.size {
            return Err(format!("파일 크기가 다릅니다 (서버 {len}, 예고 {})", req.size));
        }
    }
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("파일을 만들 수 없습니다: {e}"))?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut last_pct: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("수신 중 연결이 끊겼습니다: {e}"))? {
        received += chunk.len() as u64;
        if received > req.size {
            return Err("예고된 크기보다 많은 데이터를 받았습니다".into());
        }
        file.write_all(&chunk).await.map_err(|e| format!("디스크 쓰기 실패: {e}"))?;
        hasher.update(&chunk);
        let pct = received * 100 / req.size;
        if pct != last_pct {
            last_pct = pct;
            set_status(state, format!("{} 받는 중 {pct}%", req.name));
        }
        reporter.progress(received, req.size, false).await;
    }
    file.flush().await.map_err(|e| format!("디스크 쓰기 실패: {e}"))?;
    drop(file);
    if received != req.size {
        return Err(format!("파일이 중간에 끊겼습니다 ({received} / {} 바이트)", req.size));
    }
    let digest = format!("{:x}", hasher.finalize());
    if digest != req.sha256 {
        return Err("파일 검증(SHA-256)에 실패했습니다".into());
    }
    reporter.progress(received, req.size, true).await;
    Ok(())
}

/// Launch the received file through ShellExecuteEx with its normal window shown (verb
/// `runas` when elevated so a `requireAdministrator` installer such as the V3 engine setup
/// gets its UAC prompt) and wait for it to exit. msi files go through msiexec.
fn run_file(path: &Path, elevate: bool) -> Result<i32, String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED};
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let is_msi = extension_of(&path.to_string_lossy()) == "msi";
    let (file, params) = if is_msi {
        ("msiexec.exe".to_string(), format!("/i \"{}\"", path.display()))
    } else {
        (path.display().to_string(), String::new())
    };
    let directory = path.parent().map(|p| p.display().to_string()).unwrap_or_default();
    let verb = HSTRING::from(if elevate { "runas" } else { "open" });
    let file_w = HSTRING::from(file.as_str());
    let params_w = HSTRING::from(params.as_str());
    let dir_w = HSTRING::from(directory.as_str());

    // SAFETY: plain Win32 calls with fully initialised structs; the HSTRINGs outlive the call.
    unsafe {
        let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
            lpVerb: PCWSTR(verb.as_ptr()),
            lpFile: PCWSTR(file_w.as_ptr()),
            lpParameters: PCWSTR(params_w.as_ptr()),
            lpDirectory: PCWSTR(dir_w.as_ptr()),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        let launched = ShellExecuteExW(&mut info);
        let result = match launched {
            Ok(()) => {
                let process = info.hProcess;
                if process.is_invalid() {
                    Err("실행 프로세스 핸들을 얻지 못했습니다".to_string())
                } else {
                    WaitForSingleObject(process, INFINITE);
                    let mut code: u32 = 0;
                    let r = GetExitCodeProcess(process, &mut code)
                        .map(|_| code as i32)
                        .map_err(|e| format!("종료 코드를 읽지 못했습니다: {e}"));
                    let _ = CloseHandle(process);
                    r
                }
            }
            Err(e) if e.code() == ERROR_CANCELLED.to_hresult() => {
                Err("시설 PC에서 관리자 권한 요청이 취소되었습니다".to_string())
            }
            Err(e) => Err(format!("실행하지 못했습니다: {e}")),
        };
        if com.is_ok() {
            CoUninitialize();
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Value {
        json!({
            "job": "abc123",
            "url": "http://192.168.0.10:7777/api/transfers/files/0123456789abcdef",
            "report": "http://192.168.0.10:7777/api/transfers/abc123/report",
            "name": "ahnlabengine_setup260819.exe",
            "size": 303182776,
            "sha256": "A".repeat(64),
            "run": true,
            "elevate": true
        })
    }

    #[test]
    fn parses_a_full_install_request() {
        let req = TransferRequest::parse(&base()).unwrap();
        assert_eq!(req.name, "ahnlabengine_setup260819.exe");
        assert_eq!(req.size, 303182776);
        assert_eq!(req.sha256, "a".repeat(64));
        assert!(req.run && req.elevate);
    }

    #[test]
    fn defaults_apply_for_a_plain_file_transfer() {
        let mut msg = base();
        msg["name"] = json!("notice.pdf");
        msg.as_object_mut().unwrap().remove("run");
        msg.as_object_mut().unwrap().remove("elevate");
        let req = TransferRequest::parse(&msg).unwrap();
        assert!(!req.run);
        assert!(req.elevate);
    }

    #[test]
    fn rejects_unsafe_or_incomplete_requests() {
        let mutate = |f: &dyn Fn(&mut Value)| {
            let mut m = base();
            f(&mut m);
            m
        };
        let cases = [
            mutate(&|m| { m["name"] = json!("..\\evil.exe"); }),
            mutate(&|m| { m["name"] = json!("C:/x.exe"); }),
            mutate(&|m| { m["name"] = json!(".hidden.exe"); }),
            mutate(&|m| { m["url"] = json!("https://example.com/file"); }),
            mutate(&|m| { m["url"] = json!("file:///C:/x"); }),
            mutate(&|m| { m["size"] = json!(0); }),
            mutate(&|m| { m["sha256"] = json!("zz"); }),
            mutate(&|m| { m["name"] = json!("readme.txt"); m["run"] = json!(true); }),
            mutate(&|m| { m.as_object_mut().unwrap().remove("report"); }),
            mutate(&|m| { m["job"] = json!("../x"); }),
        ];
        for case in cases {
            assert!(TransferRequest::parse(&case).is_err(), "should reject {case}");
        }
    }
}
