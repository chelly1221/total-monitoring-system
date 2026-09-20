use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs::{self, File, OpenOptions}, io::{Read, Write, Seek, SeekFrom, Cursor}, path::{Path, PathBuf}, process::Command, sync::atomic::{AtomicBool, Ordering}};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

static INSTALLING: AtomicBool = AtomicBool::new(false);
const CHANNELS: [&str; 8] = ["dht1", "dht2", "dht3", "dht4", "door1", "door2", "door3", "door4"];
const CLIENT: &str = include_str!("../../pi-client/tms_sensor.py");

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Disk { number: u32, name: String, size: u64, unique_id: String, serial: Option<String>, bus: String }

fn powershell(script: &str) -> Result<std::process::Output, String> {
    let mut command = Command::new("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let result = command.output().map_err(|e| e.to_string())?;
    if !result.status.success() { return Err(String::from_utf8_lossy(&result.stderr).into_owned()); }
    Ok(result)
}

fn disks() -> Result<Vec<Disk>, String> {
    let result = powershell(include_str!("pi_disks.ps1"))?;
    serde_json::from_slice(&result.stdout).map_err(|e| format!("카드 목록 해석 실패: {e}"))
}

#[tauri::command]
pub async fn pi_disks() -> Result<Vec<Disk>, String> { tauri::async_runtime::spawn_blocking(disks).await.map_err(|e| e.to_string())? }

fn image_path(app: &tauri::AppHandle, model: &str) -> Result<PathBuf, String> {
    if !["pi34", "pi5"].contains(&model) { return Err("라즈베리파이 모델을 선택하세요".into()); }
    let file = format!("tms-{model}.img.xz");
    let bundled = crate::get_resource_dir(app).join("pi-images").join(&file);
    if bundled.is_file() { return Ok(bundled); }
    #[cfg(debug_assertions)] {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../downloads").join(file);
        if dev.is_file() { return Ok(dev); }
    }
    Err("폐쇄망용 이미지가 서버에 없습니다. 이미지를 포함하여 서버를 다시 빌드하세요".into())
}

#[tauri::command]
pub async fn pi_images(app: tauri::AppHandle) -> Value {
    json!([{"model":"pi34", "available": image_path(&app, "pi34").is_ok()}, {"model":"pi5", "available":image_path(&app,"pi5").is_ok()}])
}

fn validate_config(config: &Value) -> Result<(), String> {
    let name = config["name"].as_str().ok_or("장비 이름이 필요합니다")?;
    if name.trim().is_empty() || name.chars().count() > 32 || name.chars().any(char::is_control) { return Err("장비 이름은 1~32자여야 합니다".into()); }
    let channels = config["channels"].as_array().ok_or("채널을 선택하세요")?;
    let mut seen = std::collections::HashSet::new();
    if channels.is_empty() || channels.len() > 8 { return Err("채널을 1개 이상 선택하세요".into()); }
    for c in channels {
        let c = c.as_str().ok_or("잘못된 채널입니다")?;
        if !CHANNELS.contains(&c) || !seen.insert(c) { return Err("잘못되거나 중복된 채널입니다".into()); }
    }
    match config["network"]["mode"].as_str() {
        Some("dhcp") => (),
        Some("static") => {
            let address = config["network"]["address"].as_str().ok_or("고정 IP/접두 길이를 입력하세요")?;
            let (ip, prefix) = address.split_once('/').ok_or("예: 192.168.1.50/24")?;
            let ip: std::net::Ipv4Addr = ip.parse().map_err(|_| "잘못된 IP 주소입니다")?;
            let prefix: u32 = prefix.parse().map_err(|_| "잘못된 접두 길이입니다")?;
            if !(1..=30).contains(&prefix) || ip.is_loopback() || ip.is_multicast() || ip.is_unspecified() { return Err("유효한 LAN IP/접두 길이를 입력하세요".into()); }
            let mask = u32::MAX << (32-prefix);
            let host = u32::from(ip) & !mask;
            if host == 0 || host == !mask { return Err("네트워크/브로드캐스트 주소는 사용할 수 없습니다".into()); }
            if let Some(gateway) = config["network"]["gateway"].as_str().filter(|s| !s.is_empty()) {
                let gw: std::net::Ipv4Addr = gateway.parse().map_err(|_| "잘못된 게이트웨이입니다")?;
                if u32::from(gw) & mask != u32::from(ip) & mask { return Err("게이트웨이는 같은 서브넷이어야 합니다".into()); }
            }
        },
        _ => return Err("네트워크 방식을 선택하세요".into()),
    }
    Ok(())
}

pub fn customize_image(path: &Path, model: &str, config: &Value) -> Result<(), String> {
    validate_config(config)?;
    let mut image = OpenOptions::new().read(true).write(true).open(path).map_err(|e| e.to_string())?;
    let mut mbr = [0; 512];
    image.read_exact(&mut mbr).map_err(|e| e.to_string())?;
    if mbr[510..] != [0x55, 0xaa] || ![0x0b, 0x0c, 0x0e, 0x06].contains(&mbr[450]) { return Err("지원하는 FAT 부팅 이미지가 아닙니다".into()); }
    let start = u32::from_le_bytes(mbr[454..458].try_into().unwrap()) as u64 * 512;
    let size = u32::from_le_bytes(mbr[458..462].try_into().unwrap()) as u64 * 512;
    if start < 512 || !(1024*1024..=256*1024*1024).contains(&size) || start + size > image.metadata().map_err(|e| e.to_string())?.len() { return Err("부팅 파티션 크기가 올바르지 않습니다".into()); }
    image.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut bytes = vec![0; size as usize];
    image.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    let mut cursor = Cursor::new(bytes);
    {
        let filesystem = fatfs::FileSystem::new(&mut cursor, fatfs::FsOptions::new()).map_err(|e| e.to_string())?;
        let root = filesystem.root_dir();
        let mut marker = String::new();
        root.open_file("tms-image.json").map_err(|_| "폐쇄망용으로 준비되지 않은 OS 이미지입니다")?.read_to_string(&mut marker).map_err(|e| e.to_string())?;
        let marker: Value = serde_json::from_str(&marker).map_err(|e| e.to_string())?;
        if marker["format"] != "tms-offline-v1" || marker["model"] != model { return Err("선택한 모델과 OS 이미지가 다릅니다".into()); }
        let directory = root.create_dir("tms-sensor").map_err(|e| e.to_string())?;
        for (name, content) in [("config.json", serde_json::to_vec(config).unwrap()), ("tms_sensor.py", CLIENT.as_bytes().to_vec())] {
            let mut f = directory.create_file(name).map_err(|e| e.to_string())?;
            f.truncate().map_err(|e| e.to_string())?;
            f.write_all(&content).map_err(|e| e.to_string())?;
        }
        drop(directory); drop(root);
        filesystem.unmount().map_err(|e| e.to_string())?;
    }
    image.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    image.write_all(cursor.get_ref()).map_err(|e| e.to_string())?;
    image.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

fn ps_quote(value: &str) -> String { format!("'{}'", value.replace('\'', "''")) }

fn progress(app: &tauri::AppHandle, message: &str) { let _ = app.emit("pi-install-progress", json!({"phase":"preparing", "done":0,"total":0,"message":message})); }

#[tauri::command]
pub async fn pi_install(app: tauri::AppHandle, disk: Disk, model: String, config: Value) -> Result<bool, String> {
    validate_config(&config)?;
    if INSTALLING.swap(true, Ordering::SeqCst) { return Err("다른 SD 카드 설치가 진행 중입니다".into()); }
    struct Reset;
    impl Drop for Reset { fn drop(&mut self) { INSTALLING.store(false, Ordering::SeqCst); } }
    let _reset = Reset;
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        if !disks()?.contains(&disk) { return Err("카드가 변경되었습니다. 목록을 새로고침하세요".into()); }
        let source = image_path(&app, &model)?;
        let work = app.path().app_cache_dir().map_err(|e| e.to_string())?.join(format!("pi-install-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
        fs::create_dir_all(&work).map_err(|e| e.to_string())?;
        let result = (|| -> Result<bool, String> {
            progress(&app, "폐쇄망용 OS 이미지 무결성 확인 중");
            let checksum = fs::read_to_string(format!("{}.sha256", source.display())).map_err(|_| "OS 이미지 검증 파일이 없습니다")?;
            let expected = checksum.split_whitespace().next().ok_or("잘못된 이미지 검증 파일")?;
            let mut input = File::open(&source).map_err(|e| e.to_string())?;
            let mut hash = Sha256::new(); let mut buf = [0u8; 1024*1024];
            loop { let n = input.read(&mut buf).map_err(|e| e.to_string())?; if n == 0 { break; } hash.update(&buf[..n]); }
            if format!("{:x}", hash.finalize()) != expected { return Err("OS 이미지가 손상되었습니다".into()); }
            progress(&app, "OS 압축 해제 및 센서 설정 준비 중");
            let image = work.join("sensor.img");
            let mut decoder = xz2::read::XzDecoder::new(File::open(source).map_err(|e| e.to_string())?);
            let mut output = File::create(&image).map_err(|e| e.to_string())?;
            std::io::copy(&mut decoder, &mut output).map_err(|e| e.to_string())?;
            output.sync_all().map_err(|e| e.to_string())?; drop(output);
            customize_image(&image, &model, &config)?;
            if !disks()?.contains(&disk) { return Err("설치 준비 중 카드가 변경되었습니다".into()); }
            let confirmed = app.dialog().message(format!("디스크 {} · {}\n용량 {:.1} GB · 일련번호 {}\n\n이 디스크의 모든 데이터를 지우고 라즈베리파이 OS를 설치합니다.", disk.number, disk.name, disk.size as f64 / 1e9, disk.serial.as_deref().unwrap_or("없음")))
                .title("SD 카드 전체 삭제 확인").kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom("전체 삭제 후 설치".into(), "취소".into())).blocking_show();
            if !confirmed { return Ok(false); }
            fs::write(work.join("write.ps1"), format!("\u{feff}{}", include_str!("pi_write.ps1"))).map_err(|e| e.to_string())?;
            fs::write(work.join("job.json"), serde_json::to_vec(&json!({"disk":disk,"image":image})).unwrap()).map_err(|e| e.to_string())?;
            progress(&app, "Windows 관리자 권한 확인 대기 중");
            let script = work.join("write.ps1"); let job = work.join("job.json");
            let args = format!("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{}\" -JobPath \"{}\"", script.display(), job.display());
            let command = format!("$ErrorActionPreference='Stop'; $p=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList {} -PassThru -Wait; exit $p.ExitCode", ps_quote(&args));
            let mut child = Command::new("powershell.exe");
            child.args(["-NoProfile", "-NonInteractive", "-Command", &command]);
            #[cfg(windows)] { use std::os::windows::process::CommandExt; child.creation_flags(0x08000000); }
            let mut child = child.spawn().map_err(|e| e.to_string())?;
            loop {
                if let Ok(bytes) = fs::read(work.join("status.json")) {
                    if let Ok(status) = serde_json::from_slice::<Value>(&bytes) { let _ = app.emit("pi-install-progress", status); }
                }
                if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
                    let status: Value = fs::read(work.join("status.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
                    let _ = app.emit("pi-install-progress", &status);
                    if exit.success() && status["phase"] == "done" { return Ok(true); }
                    return Err(status["message"].as_str().unwrap_or("관리자 권한이 거부되었거나 설치를 시작하지 못했습니다").into());
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        })();
        // The staging directory was created here under the application cache; contains no user files.
        let _ = fs::remove_dir_all(&work);
        result
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_channels_and_network() {
        let mut c = json!({"name":"센서","channels":["dht1","door1"],"network":{"mode":"dhcp"}});
        assert!(validate_config(&c).is_ok());
        c["channels"] = json!(["dht1", "dht1"]); assert!(validate_config(&c).is_err());
        c["channels"] = json!(["door4"]);
        c["network"] = json!({"mode":"static","address":"192.168.1.10/24","gateway":"192.168.1.1"}); assert!(validate_config(&c).is_ok());
        c["network"]["address"] = json!("192.168.1.255/24"); assert!(validate_config(&c).is_err());
        c["network"]["address"] = json!("192.168.1.10/0"); assert!(validate_config(&c).is_err());
    }

    #[test]
    fn customizes_only_fat_partition_and_rejects_wrong_model() {
        let config = json!({"name":"시험 센서", "channels":["door1"], "network":{"mode":"dhcp"}});
        let mut partition = Cursor::new(vec![0; 4 * 1024 * 1024]);
        fatfs::format_volume(&mut partition, fatfs::FormatVolumeOptions::new()).unwrap();
        partition.set_position(0);
        {
            let filesystem = fatfs::FileSystem::new(&mut partition, fatfs::FsOptions::new()).unwrap();
            let root = filesystem.root_dir();
            root.create_file("tms-image.json").unwrap().write_all(br#"{"format":"tms-offline-v1","model":"pi34"}"#).unwrap();
            drop(root); filesystem.unmount().unwrap();
        }
        let path = std::env::temp_dir().join(format!("tms-pi-fat-test-{}.img", std::process::id()));
        let mut mbr = [0u8; 512];
        mbr[510..].copy_from_slice(&[0x55, 0xaa]); mbr[450] = 0x0c;
        mbr[454..458].copy_from_slice(&1u32.to_le_bytes());
        mbr[458..462].copy_from_slice(&8192u32.to_le_bytes());
        let mut image = File::create(&path).unwrap();
        image.write_all(&mbr).unwrap(); image.write_all(partition.get_ref()).unwrap(); image.write_all(b"LINUX-PARTITION-UNCHANGED").unwrap(); drop(image);
        assert!(customize_image(&path, "pi5", &config).is_err());
        customize_image(&path, "pi34", &config).unwrap();
        let data = fs::read(&path).unwrap();
        assert_eq!(&data[..512], &mbr);
        assert_eq!(&data[512+4*1024*1024..], b"LINUX-PARTITION-UNCHANGED");
        let fs = fatfs::FileSystem::new(Cursor::new(data[512..512+4*1024*1024].to_vec()), fatfs::FsOptions::new()).unwrap();
        let mut saved = String::new();
        fs.root_dir().open_file("tms-sensor/config.json").unwrap().read_to_string(&mut saved).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&saved).unwrap(), config);
        fs::remove_file(path).unwrap();
    }
}
