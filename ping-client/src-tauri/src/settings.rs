use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

pub const DISCOVERY_PORT: u16 = 7791;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub id: String,
    pub name: String,
    pub targets: Vec<Target>,
    pub ping_interval: u64,
    pub timeout_ms: u32,
    pub failure_threshold: u32,
    pub udp_enabled: bool,
    pub udp_ip: String,
    pub udp_port: String,
    pub udp_message: String,
    pub udp_no_failure_message: String,
    pub interval_ms: u64,
    pub sound_enabled: bool,
    pub sound_file: String,
    pub mute_state: bool,
    pub autostart: bool,
    pub auto_monitor: bool,
    pub capture_devices: Vec<CaptureDevice>,
    pub topology: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Target {
    pub name: String,
    pub address: String,
    pub enabled: bool,
    #[serde(default = "default_type", rename = "type")]
    pub kind: String,
}
fn default_type() -> String {
    "pc".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CaptureDevice {
    pub name: String,
    pub enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: String::new(),
            targets: vec![],
            ping_interval: 1,
            timeout_ms: 1000,
            failure_threshold: 1,
            udp_enabled: false,
            udp_ip: String::new(),
            udp_port: "6100".into(),
            udp_message: "PING_FAIL".into(),
            udp_no_failure_message: "PING_OK".into(),
            interval_ms: 5000,
            sound_enabled: true,
            sound_file: String::new(),
            mute_state: false,
            autostart: true,
            auto_monitor: true,
            capture_devices: vec![],
            topology: Value::Null,
        }
    }
}

pub fn valid_address(address: &str) -> bool {
    if address.is_empty() || address.len() > 253 {
        return false;
    }
    if address.parse::<std::net::Ipv4Addr>().is_ok() {
        return true;
    }
    if address.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return false;
    }
    address.split('.').all(|part| {
        !part.is_empty()
            && part.len() <= 63
            && !part.starts_with('-')
            && !part.ends_with('-')
            && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    })
}

impl Settings {
    pub fn backup(&self) -> Value {
        let mut value = serde_json::to_value(self).expect("settings serialize");
        value.as_object_mut().unwrap().remove("id");
        json!({"format":"tms-ping-monitor", "version":1, "settings":value})
    }

    pub fn import_patch(value: Value) -> Result<Value, String> {
        if value.get("format").is_some() {
            if value["format"] != "tms-ping-monitor" || value["version"] != 1 {
                return Err("지원하지 않는 설정 파일 형식입니다".into());
            }
            let patch = value["settings"].clone();
            if !patch.is_object() || !patch["targets"].is_array() {
                return Err("감시 대상이 포함된 설정 파일을 선택하세요".into());
            }
            return Ok(patch);
        }
        // Legacy imports preserve this PC's identity and server binding.
        let mut patch = value;
        if !patch["targets"].is_array() {
            return Err("감시 대상이 포함된 설정 파일을 선택하세요".into());
        }
        patch
            .as_object_mut()
            .ok_or("설정 형식이 올바르지 않습니다")?
            .retain(|k, _| {
                [
                    "targets",
                    "ping_interval",
                    "topology",
                    "sound_enabled",
                    "sound_file",
                    "capture_devices",
                ]
                .contains(&k.as_str())
            });
        Ok(patch)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.name.chars().count() > 64 {
            return Err("장비명은 64자 이내로 입력하세요".into());
        }
        if self.targets.len() > 20 {
            return Err("감시 대상은 최대 20개입니다".into());
        }
        let mut seen = std::collections::HashSet::new();
        for t in &self.targets {
            if t.name.trim().is_empty()
                || t.name.chars().count() > 100
                || !valid_address(&t.address)
            {
                return Err(format!(
                    "감시 대상 이름 또는 주소가 올바르지 않습니다: {}",
                    t.address
                ));
            }
            if !seen.insert(t.address.to_lowercase()) {
                return Err("감시 대상 주소가 중복됩니다".into());
            }
        }
        if !(1..=3600).contains(&self.ping_interval)
            || !(100..=10000).contains(&self.timeout_ms)
            || !(1..=10).contains(&self.failure_threshold)
        {
            return Err("주기·응답 대기·연속 실패 횟수를 확인하세요".into());
        }
        if !(1000..=60000).contains(&self.interval_ms) {
            return Err("하트비트는 1~60초 범위입니다".into());
        }
        if self.udp_enabled
            && (self.udp_ip.parse::<std::net::Ipv4Addr>().is_err()
                || self.udp_port.parse::<u16>().unwrap_or(0) == 0)
        {
            return Err("서버 IP 또는 포트를 확인하세요".into());
        }
        if self.udp_message.is_empty()
            || self.udp_no_failure_message.is_empty()
            || self.udp_message == self.udp_no_failure_message
            || self.udp_message.len() > 200
            || self.udp_no_failure_message.len() > 200
        {
            return Err("정상·장애 전송 문자열은 서로 다르게 1~200바이트로 입력하세요".into());
        }
        if self.capture_devices.len() > 32
            || self.capture_devices.iter().any(|d| d.name.len() > 512)
        {
            return Err("캡처 어댑터 설정이 너무 큽니다".into());
        }
        if !self.topology.is_null() {
            let valid = self.topology.is_object()
                && self
                    .topology
                    .get("devices")
                    .and_then(Value::as_array)
                    .is_some_and(|x| x.len() <= 100)
                && self
                    .topology
                    .get("connections")
                    .and_then(Value::as_array)
                    .is_some_and(|x| x.len() <= 500);
            if !valid || self.topology.to_string().len() > 200_000 {
                return Err("토폴로지 형식 또는 크기가 올바르지 않습니다".into());
            }
        }
        Ok(())
    }

    pub fn patch(&self, patch: Value) -> Result<Self, String> {
        let object = patch.as_object().ok_or("설정 형식이 올바르지 않습니다")?;
        let mut value = serde_json::to_value(self).map_err(|e| e.to_string())?;
        for (key, val) in object {
            if key != "id" && value.get(key).is_some() {
                value[key] = val.clone();
            }
        }
        if object.contains_key("targets") && !object.contains_key("topology") {
            let addresses: Vec<String> = value["targets"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|t| t["address"].as_str().unwrap_or_default().to_lowercase())
                .collect();
            if let Some(devices) = value
                .get_mut("topology")
                .and_then(|t| t.get_mut("devices"))
                .and_then(Value::as_array_mut)
            {
                for device in devices {
                    if let Some(old_index) = device["target_index"].as_u64() {
                        let address = self
                            .targets
                            .get(old_index as usize)
                            .map(|t| t.address.to_lowercase());
                        device["target_index"] = address
                            .and_then(|a| addresses.iter().position(|v| v == &a))
                            .map_or(Value::Null, |i| json!(i));
                    }
                }
            }
        }
        let next: Self =
            serde_json::from_value(value).map_err(|e| format!("설정 형식 오류: {e}"))?;
        next.validate()?;
        Ok(next)
    }

    pub fn provision(&self, msg: &Value) -> Result<Self, String> {
        let target = msg.get("target").ok_or("서버 주소가 없습니다")?;
        let mut patch = json!({});
        if target.is_null() {
            patch["udp_enabled"] = json!(false);
        } else {
            let ip = target
                .get("ip")
                .and_then(Value::as_str)
                .ok_or("서버 IP 오류")?;
            let port = target
                .get("port")
                .and_then(Value::as_u64)
                .filter(|p| (1..=65535).contains(p))
                .ok_or("서버 포트 오류")?;
            patch["udp_enabled"] = json!(true);
            patch["udp_ip"] = json!(ip);
            patch["udp_port"] = json!(port.to_string());
        }
        for (wire, local) in [
            ("on", "udp_message"),
            ("off", "udp_no_failure_message"),
            ("intervalMs", "interval_ms"),
            ("name", "name"),
        ] {
            if let Some(v) = msg.get(wire) {
                patch[local] = v.clone();
            }
        }
        self.patch(patch)
    }
}

pub fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("TMS_PING_DATA_DIR") {
        return PathBuf::from(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let probe = dir.join(format!(".ping-write-{}", std::process::id()));
            if std::fs::write(&probe, b"").is_ok() {
                let _ = std::fs::remove_file(probe);
                return dir.to_owned();
            }
        }
    }
    PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default()).join("tms-ping-monitor")
}

pub fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("설정 저장 실패: {e}"))?;
    let from: Vec<u16> = tmp
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let to: Vec<u16> = path
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|e| format!("파일 교체 실패: {e}"))
}

pub fn load(dir: &Path) -> Result<Settings, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join("ping-settings.json");
    let settings = match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let s: Settings = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
                .map_err(|e| format!("저장된 설정을 읽을 수 없습니다: {e}"))?;
            s.validate()?;
            s
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
        Err(e) => return Err(e.to_string()),
    };
    write_json(&path, &settings)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_round_trip_preserves_local_identity_and_preferences() {
        let source = Settings::default()
            .patch(json!({"name":"감시 PC", "autostart":false, "timeout_ms":2400}))
            .unwrap();
        let target = Settings::default();
        assert!(target.autostart);
        let restored = target
            .patch(Settings::import_patch(source.backup()).unwrap())
            .unwrap();
        assert_eq!(restored.id, target.id);
        assert_eq!(restored.name, source.name);
        assert_eq!(restored.timeout_ms, 2400);
        assert!(!restored.autostart);
        assert!(Settings::import_patch(json!({"random":true})).is_err());
        assert!(Settings::import_patch(json!({"format":"tms-ping-monitor","version":99})).is_err());
        let legacy =
            Settings::import_patch(json!({"targets":[],"udp_ip":"10.0.0.1","autostart":false}))
                .unwrap();
        assert!(legacy.get("udp_ip").is_none());
        assert!(target.patch(legacy).unwrap().autostart);
    }
    #[test]
    fn reject_unsafe_addresses_and_duplicate_targets() {
        for address in ["-t", "127.0.0.1 & whoami", "256.1.1.1", "", "foo..bar"] {
            assert!(!valid_address(address));
        }
        for address in ["127.0.0.1", "radar-1.local", "RADAR1"] {
            assert!(valid_address(address));
        }
        let s = Settings::default();
        assert!(s.patch(json!({"targets":[{"name":"a","address":"RADAR1","enabled":true},{"name":"b","address":"radar1","enabled":true}]})).is_err());
        assert!(s
            .patch(json!({"targets":[{"name":"a","address":"127.0.0.1","enabled":true}]}))
            .is_ok());
    }
    #[test]
    fn target_edits_preserve_topology_bindings_by_address() {
        let s = Settings::default().patch(json!({"targets":[{"name":"a","address":"10.0.0.1","enabled":true},{"name":"b","address":"10.0.0.2","enabled":true}],"topology":{"devices":[{"id":"b","target_index":1}],"connections":[]}})).unwrap();
        let next = s
            .patch(json!({"targets":[{"name":"b","address":"10.0.0.2","enabled":true}]}))
            .unwrap();
        assert_eq!(next.topology["devices"][0]["target_index"], 0);
    }
    #[test]
    fn provisioning_preserves_identity_targets_and_rejects_invalid_data() {
        let s = Settings::default();
        let next = s.provision(&json!({"target":{"ip":"127.0.0.1","port":6101},"on":"FAIL","off":"OK","intervalMs":5000})).unwrap();
        assert_eq!(next.id, s.id);
        assert!(next.udp_enabled);
        assert_eq!(next.udp_port, "6101");
        for msg in [
            json!({}),
            json!({"target":{"ip":"bad","port":1}}),
            json!({"target":{"ip":"127.0.0.1","port":0}}),
            json!({"target":null,"on":""}),
        ] {
            assert!(s.provision(&msg).is_err());
        }
        assert!(!next.provision(&json!({"target":null})).unwrap().udp_enabled);
        assert_eq!(s.patch(json!({"id":"replace"})).unwrap().id, s.id);
    }
    #[test]
    fn atomic_save_can_replace_existing_file() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let file = dir.join("settings.json");
        write_json(&file, &json!({"n":1})).unwrap();
        write_json(&file, &json!({"n":2})).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&std::fs::read_to_string(&file).unwrap()).unwrap()["n"],
            2
        );
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
