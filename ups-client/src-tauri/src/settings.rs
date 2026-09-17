use crate::ups::{self, Limit};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

pub const DISCOVERY_PORT: u16 = 7792;
pub const SETTINGS_FILE: &str = "ups-settings.json";
pub const UNIT_COUNT: usize = 2;

/// One UPS card: where to poll it, where to forward its readings and the alarm limits.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Unit {
    pub ip: String,
    pub community: String,
    /// Poll period in seconds (the original "갱신 간격").
    pub interval_sec: u64,
    /// Forward readings to the TMS server (set by server provisioning or by hand).
    pub server_enabled: bool,
    pub server_ip: String,
    pub server_port: u16,
    /// Custom WAV path; empty plays the built-in UPS#1 / UPS#2 sound.
    pub sound_file: String,
    pub muted: bool,
    pub limits: BTreeMap<String, Limit>,
}

impl Default for Unit {
    fn default() -> Self {
        Self {
            ip: String::new(),
            community: "public".into(),
            interval_sec: 5,
            server_enabled: false,
            server_ip: String::new(),
            server_port: 0,
            sound_file: String::new(),
            muted: false,
            limits: BTreeMap::new(),
        }
    }
}

impl Unit {
    /// First-run values = the 제1레이더 PC's original settings.json / ups2_settings.json
    /// (UPS at 192.168.0.99/.98, 통합감시 서버 192.168.1.160 ports 1991/1990, 5 s polls).
    pub fn defaults(unit: u8) -> Self {
        Self {
            ip: if unit == 1 { "192.168.0.99".into() } else { "192.168.0.98".into() },
            server_enabled: true,
            server_ip: "192.168.1.160".into(),
            server_port: if unit == 1 { 1991 } else { 1990 },
            limits: ups::default_limits(unit),
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub id: String,
    pub name: String,
    pub units: Vec<Unit>,
    pub sound_enabled: bool,
    pub autostart: bool,
    pub auto_monitor: bool,
    /// TMS web port (provisioned as `httpPort`); kept for parity with the other clients.
    pub server_http_port: u16,
    /// Default PC 음소거 자동 해제 duration offered by the popup (minutes).
    pub unmute_minutes: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: String::new(),
            units: vec![Unit::defaults(1), Unit::defaults(2)],
            sound_enabled: true,
            autostart: true,
            auto_monitor: true,
            server_http_port: 7777,
            unmute_minutes: 10,
        }
    }
}

/// IPv4 address or host name, optionally followed by `:port` (the SNMP port, default 161).
pub fn valid_host(address: &str) -> bool {
    let address = match address.rsplit_once(':') {
        Some((host, port)) => {
            if port.parse::<u16>().map(|p| p == 0).unwrap_or(true) {
                return false;
            }
            host
        }
        None => address,
    };
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
    pub fn unit(&self, unit: u8) -> &Unit {
        &self.units[(unit as usize).saturating_sub(1).min(UNIT_COUNT - 1)]
    }

    pub fn backup(&self) -> Value {
        let mut value = serde_json::to_value(self).expect("settings serialize");
        value.as_object_mut().unwrap().remove("id");
        json!({"format":"tms-ups-monitor", "version":1, "settings":value})
    }

    /// Turn a chosen JSON file into a settings patch. Accepts this program's own backup
    /// (everything but the PC identity) and the original snmpups `settings.json` /
    /// `ups2_settings.json` (SNMP, server and limits of that one unit).
    pub fn import_patch(&self, value: Value) -> Result<Value, String> {
        if value.get("format").is_some() {
            if value["format"] != "tms-ups-monitor" || value["version"] != 1 {
                return Err("지원하지 않는 설정 파일 형식입니다".into());
            }
            let patch = value["settings"].clone();
            if !patch.is_object() || !patch["units"].is_array() {
                return Err("UPS 설정이 포함된 설정 파일을 선택하세요".into());
            }
            return Ok(patch);
        }
        let object = value.as_object().ok_or("설정 형식이 올바르지 않습니다")?;
        let (unit, prefix) = if object.contains_key("ups2_ip") {
            (2u8, "ups2_")
        } else if object.contains_key("ups_ip") {
            (1u8, "")
        } else {
            return Err("UPS 설정이 포함된 설정 파일을 선택하세요".into());
        };
        let legacy = legacy_unit(object, unit, prefix, self.unit(unit));
        let mut units: Vec<Value> = self.units.iter().map(|u| serde_json::to_value(u).unwrap()).collect();
        units[(unit - 1) as usize] = serde_json::to_value(legacy).map_err(|e| e.to_string())?;
        Ok(json!({"units": units}))
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.name.chars().count() > 64 {
            return Err("장비명은 64자 이내로 입력하세요".into());
        }
        if self.units.len() != UNIT_COUNT {
            return Err("UPS 설정은 두 대분이어야 합니다".into());
        }
        for (i, u) in self.units.iter().enumerate() {
            let label = format!("UPS#{}", i + 1);
            if !valid_host(&u.ip) {
                return Err(format!("{label} SNMP 주소를 확인하세요"));
            }
            if u.community.is_empty() || u.community.len() > 64 {
                return Err(format!("{label} Community를 확인하세요"));
            }
            if !(1..=3600).contains(&u.interval_sec) {
                return Err(format!("{label} 갱신 간격은 1~3600초 범위입니다"));
            }
            if u.server_enabled
                && (u.server_ip.parse::<std::net::Ipv4Addr>().is_err() || u.server_port == 0)
            {
                return Err(format!("{label} 서버 IP 또는 포트를 확인하세요"));
            }
            if u.sound_file.len() > 512 {
                return Err(format!("{label} 경보음 경로가 너무 깁니다"));
            }
            let defaults = ups::default_limits(i as u8 + 1);
            if u.limits.len() > 64 {
                return Err(format!("{label} 임계값 항목이 너무 많습니다"));
            }
            for (key, limit) in &u.limits {
                if !defaults.contains_key(key) {
                    return Err(format!("{label} 알 수 없는 임계값 항목: {key}"));
                }
                if !limit.min.is_finite() || !limit.max.is_finite() || limit.min > limit.max {
                    return Err(format!("{label} 임계값 최소·최대를 확인하세요 ({key})"));
                }
            }
        }
        if self.server_http_port == 0 {
            return Err("서버 웹 포트가 올바르지 않습니다".into());
        }
        if !crate::pcmute::valid_minutes(self.unmute_minutes) {
            return Err("음소거 해제 시간은 1분~24시간 범위입니다".into());
        }
        Ok(())
    }

    /// Apply a partial update from the UI. `units` may be a full two-element array or an
    /// object keyed by unit number (`{"1": {...}}`) whose fields are merged into that unit.
    pub fn patch(&self, patch: Value) -> Result<Self, String> {
        let object = patch.as_object().ok_or("설정 형식이 올바르지 않습니다")?;
        let mut value = serde_json::to_value(self).map_err(|e| e.to_string())?;
        for (key, val) in object {
            if key == "id" || value.get(key).is_none() {
                continue;
            }
            if key == "units" {
                if let Some(per_unit) = val.as_object() {
                    for (unit_key, unit_patch) in per_unit {
                        let index = unit_key.parse::<usize>().ok().filter(|n| (1..=UNIT_COUNT).contains(n)).ok_or("UPS 번호가 올바르지 않습니다")? - 1;
                        let target = value["units"][index].as_object_mut().ok_or("설정 형식 오류")?;
                        let fields = unit_patch.as_object().ok_or("UPS 설정 형식이 올바르지 않습니다")?;
                        for (f, v) in fields {
                            if target.contains_key(f) {
                                target.insert(f.clone(), v.clone());
                            }
                        }
                    }
                    continue;
                }
            }
            value[key] = val.clone();
        }
        let next: Self = serde_json::from_value(value).map_err(|e| format!("설정 형식 오류: {e}"))?;
        next.validate()?;
        Ok(next)
    }

    /// Server `config` command: bind one UPS unit to a server data port (or unbind it).
    pub fn provision(&self, msg: &Value) -> Result<Self, String> {
        let unit = msg
            .get("unit")
            .and_then(Value::as_u64)
            .filter(|u| (1..=UNIT_COUNT as u64).contains(u))
            .ok_or("UPS 번호(unit)가 없습니다")?;
        let target = msg.get("target").ok_or("서버 주소가 없습니다")?;
        let mut unit_patch = json!({});
        if target.is_null() {
            unit_patch["server_enabled"] = json!(false);
        } else {
            let ip = target.get("ip").and_then(Value::as_str).ok_or("서버 IP 오류")?;
            let port = target
                .get("port")
                .and_then(Value::as_u64)
                .filter(|p| (1..=65535).contains(p))
                .ok_or("서버 포트 오류")?;
            unit_patch["server_enabled"] = json!(true);
            unit_patch["server_ip"] = json!(ip);
            unit_patch["server_port"] = json!(port);
        }
        if let Some(ms) = msg.get("intervalMs").and_then(Value::as_u64) {
            // The server's heartbeat wish maps onto the poll period (readings go out per poll).
            unit_patch["interval_sec"] = json!((ms / 1000).clamp(1, 3600));
        }
        let mut patch = json!({"units": {unit.to_string(): unit_patch}});
        if let Some(v) = msg.get("httpPort") {
            patch["server_http_port"] = v.clone();
        }
        if let Some(v) = msg.get("name") {
            patch["name"] = v.clone();
        }
        self.patch(patch)
    }
}

/// Map the original flat snmpups settings file onto one unit, keeping unknown limits at
/// their current values.
fn legacy_unit(object: &Map<String, Value>, unit: u8, prefix: &str, current: &Unit) -> Unit {
    let text = |k: &str| object.get(&format!("{prefix}{k}")).and_then(Value::as_str).map(str::to_string);
    let num = |k: &str| object.get(&format!("{prefix}{k}")).and_then(Value::as_f64);
    let mut next = current.clone();
    if let Some(ip) = text("ip").or_else(|| text("ups_ip")) {
        next.ip = ip;
    }
    if let Some(c) = text("community") {
        next.community = c;
    }
    if let Some(ip) = text("server_ip") {
        next.server_enabled = ip.parse::<std::net::Ipv4Addr>().is_ok();
        next.server_ip = ip;
    }
    if let Some(p) = num("server_port") {
        next.server_port = p as u16;
    }
    if let Some(i) = num("interval") {
        next.interval_sec = (i as u64).clamp(1, 3600);
    }
    if let Some(s) = text("alarm_sound") {
        next.sound_file = if s.contains('\\') || s.contains('/') { s } else { String::new() };
    }
    let mut limits = ups::default_limits(unit);
    for (key, limit) in limits.iter_mut() {
        if let Some(v) = object.get(&format!("{key}_min")).and_then(Value::as_f64) {
            limit.min = v;
        }
        if let Some(v) = object.get(&format!("{key}_max")).and_then(Value::as_f64) {
            limit.max = v;
        }
    }
    next.limits = limits;
    next
}

pub fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("TMS_UPS_DATA_DIR") {
        return PathBuf::from(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let probe = dir.join(format!(".ups-write-{}", std::process::id()));
            if std::fs::write(&probe, b"").is_ok() {
                let _ = std::fs::remove_file(probe);
                return dir.to_owned();
            }
        }
    }
    PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default()).join("tms-ups-monitor")
}

pub fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("설정 저장 실패: {e}"))?;
    let from: Vec<u16> = tmp.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
    let to: Vec<u16> = path.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
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
    let path = dir.join(SETTINGS_FILE);
    let settings = match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let mut s: Settings = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
                .map_err(|e| format!("저장된 설정을 읽을 수 없습니다: {e}"))?;
            // Fill limits a hand-edited file left out so every parameter keeps a range.
            for (i, u) in s.units.iter_mut().enumerate() {
                for (k, v) in ups::default_limits(i as u8 + 1) {
                    u.limits.entry(k).or_insert(v);
                }
            }
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
    fn hosts_accept_an_optional_snmp_port() {
        for ok in ["192.168.0.99", "ups-1.local", "127.0.0.1:1161", "UPS1:161"] {
            assert!(valid_host(ok), "{ok}");
        }
        for bad in ["", "127.0.0.1:0", "127.0.0.1:99999", "127.0.0.1:", "bad host", "256.1.1.1", ":161"] {
            assert!(!valid_host(bad), "{bad}");
        }
    }

    #[test]
    fn defaults_cover_every_limit_and_validate() {
        let s = Settings::default();
        s.validate().unwrap();
        assert_eq!(s.units[0].server_port, 1991);
        assert_eq!(s.units[1].server_port, 1990);
        assert!(s.units.iter().all(|u| u.server_enabled && u.server_ip == "192.168.1.160" && u.interval_sec == 5));
        assert_eq!(s.units[0].limits["voltage"], Limit { min: 200.0, max: 500.0 });
        assert_eq!(s.units[1].limits["ups2_input_voltage"], Limit { min: 180.0, max: 450.0 });
        assert_eq!(s.units[1].limits["ups2_battery_voltage"], Limit { min: 0.0, max: 290.0 });
        assert_eq!(s.units[0].limits.len(), 22);
        assert_eq!(s.units[1].limits.len(), 7);
    }

    #[test]
    fn per_unit_patch_merges_fields_and_rejects_bad_values() {
        let s = Settings::default();
        let next = s.patch(json!({"units": {"2": {"ip": "10.0.0.5", "interval_sec": 10}}})).unwrap();
        assert_eq!(next.units[1].ip, "10.0.0.5");
        assert_eq!(next.units[1].interval_sec, 10);
        assert_eq!(next.units[0].ip, "192.168.0.99");
        assert_eq!(next.units[1].community, "public");
        assert!(s.patch(json!({"units": {"3": {"ip": "10.0.0.5"}}})).is_err());
        assert!(s.patch(json!({"units": {"1": {"ip": "bad host!"}}})).is_err());
        assert!(s.patch(json!({"units": {"1": {"interval_sec": 0}}})).is_err());
        assert!(s.patch(json!({"units": {"1": {"limits": {"nope": {"min": 0, "max": 1}}}}})).is_err());
        assert!(s.patch(json!({"units": {"1": {"limits": {"battery": {"min": 5, "max": 1}}}}})).is_err());
        assert!(s.patch(json!({"units": {"1": {"server_enabled": true, "server_ip": "x"}}})).is_err());
        assert_eq!(s.patch(json!({"id": "replace"})).unwrap().id, s.id);
        let full = s.patch(json!({"units": serde_json::to_value(&s.units).unwrap()})).unwrap();
        assert_eq!(full.units, s.units);
    }

    #[test]
    fn provisioning_binds_one_unit_and_keeps_the_other() {
        let s = Settings::default();
        let next = s
            .provision(&json!({"target": {"ip": "127.0.0.1", "port": 6101}, "unit": 2, "intervalMs": 5000, "httpPort": 7778, "name": "1레이더 UPS PC"}))
            .unwrap();
        assert_eq!(next.id, s.id);
        assert!(next.units[1].server_enabled);
        assert_eq!(next.units[1].server_port, 6101);
        assert_eq!(next.units[1].interval_sec, 5);
        assert_eq!(next.units[0], s.units[0], "the other unit keeps its default binding");
        assert_eq!(next.server_http_port, 7778);
        assert_eq!(next.name, "1레이더 UPS PC");
        let off = next.provision(&json!({"target": null, "unit": 2})).unwrap();
        assert!(!off.units[1].server_enabled);
        for msg in [
            json!({"target": {"ip": "127.0.0.1", "port": 6101}}),
            json!({"target": {"ip": "127.0.0.1", "port": 6101}, "unit": 3}),
            json!({"target": {"ip": "bad", "port": 1}, "unit": 1}),
            json!({"target": {"ip": "127.0.0.1", "port": 0}, "unit": 1}),
            json!({"unit": 1}),
        ] {
            assert!(s.provision(&msg).is_err(), "{msg}");
        }
    }

    #[test]
    fn imports_own_backup_and_legacy_snmpups_files() {
        let source = Settings::default()
            .patch(json!({"name": "UPS PC", "autostart": false, "units": {"1": {"ip": "10.1.1.1"}}}))
            .unwrap();
        let target = Settings::default();
        let restored = target.patch(target.import_patch(source.backup()).unwrap()).unwrap();
        assert_eq!(restored.id, target.id);
        assert_eq!(restored.name, "UPS PC");
        assert_eq!(restored.units[0].ip, "10.1.1.1");
        assert!(!restored.autostart);

        let legacy1 = json!({"ups_ip": "192.168.0.50", "community": "private", "server_ip": "192.168.1.160",
            "server_port": 1991, "interval": 7, "alarm_sound": "alarm.wav", "input_voltage_R_min": 310, "battery_max": 90});
        let imported = target.patch(target.import_patch(legacy1).unwrap()).unwrap();
        assert_eq!(imported.units[0].ip, "192.168.0.50");
        assert_eq!(imported.units[0].community, "private");
        assert!(imported.units[0].server_enabled);
        assert_eq!(imported.units[0].interval_sec, 7);
        assert_eq!(imported.units[0].sound_file, "");
        assert_eq!(imported.units[0].limits["input_voltage_R"], Limit { min: 310.0, max: 700.0 });
        assert_eq!(imported.units[0].limits["battery"], Limit { min: 0.0, max: 90.0 });
        assert_eq!(imported.units[1], target.units[1]);

        let legacy2 = json!({"ups2_ip": "192.168.0.51", "ups2_community": "public", "ups2_server_ip": "", "ups2_server_port": 1990,
            "ups2_interval": 5, "ups2_alarm_sound": "C:\\sounds\\ups2.wav", "ups2_temp_max": 55});
        let imported = target.patch(target.import_patch(legacy2).unwrap()).unwrap();
        assert_eq!(imported.units[1].ip, "192.168.0.51");
        assert!(!imported.units[1].server_enabled);
        assert_eq!(imported.units[1].sound_file, "C:\\sounds\\ups2.wav");
        assert_eq!(imported.units[1].limits["ups2_temp"].max, 55.0);
        assert!(target.import_patch(json!({"random": true})).is_err());
        assert!(target.import_patch(json!({"format": "tms-ups-monitor", "version": 99})).is_err());
    }

    #[test]
    fn atomic_save_can_replace_existing_file() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let file = dir.join("settings.json");
        write_json(&file, &json!({"n": 1})).unwrap();
        write_json(&file, &json!({"n": 2})).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&std::fs::read_to_string(&file).unwrap()).unwrap()["n"], 2);
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded.units.len(), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
