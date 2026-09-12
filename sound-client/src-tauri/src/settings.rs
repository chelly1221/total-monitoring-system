//! Portable settings persistence: `soundsense-settings.json` next to the exe,
//! falling back to `%APPDATA%/tms-soundsense/` when the exe directory is read-only.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const SETTINGS_FILE: &str = "soundsense-settings.json";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Target {
    pub ip: String,
    pub port: u16,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub id: String,
    pub name: String,
    pub target: Option<Target>,
    pub on: String,
    pub off: String,
    pub interval_ms: u64,
    pub threshold: f32,
    pub silence_ms: u64,
    pub discovery_port: u16,
    pub token: String,
    pub unmute_minutes: u32,
    pub autostart: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            target: None,
            on: "SOUND".into(),
            off: "SILENCE".into(),
            interval_ms: 5000,
            threshold: 0.01,
            silence_ms: 3000,
            discovery_port: 7790,
            token: String::new(),
            unmute_minutes: 10,
            autostart: true,
        }
    }
}

impl Settings {
    /// Validate user/server supplied values; returns a Korean message on failure.
    pub fn validate(&self) -> Result<(), String> {
        if self.on.is_empty() || self.off.is_empty() {
            return Err("전송 문자열(on/off)은 비울 수 없습니다".into());
        }
        if self.on.len() > 200 || self.off.len() > 200 {
            return Err("전송 문자열이 너무 깁니다".into());
        }
        if self.interval_ms < 200 {
            return Err("하트비트 주기는 200ms 이상이어야 합니다".into());
        }
        if !(self.threshold > 0.0 && self.threshold <= 1.0) {
            return Err("감지 임계값은 0보다 크고 1 이하이어야 합니다".into());
        }
        if self.discovery_port == 0 {
            return Err("탐지 포트가 올바르지 않습니다".into());
        }
        if self.unmute_minutes == 0 {
            return Err("자동 음소거 해제 시간이 올바르지 않습니다".into());
        }
        if let Some(t) = &self.target {
            if t.ip.parse::<std::net::Ipv4Addr>().is_err() {
                return Err("서버 IP가 올바르지 않습니다".into());
            }
            if t.port == 0 {
                return Err("서버 포트가 올바르지 않습니다".into());
            }
        }
        Ok(())
    }
}

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
}

fn dir_is_writable(dir: &Path) -> bool {
    let probe = dir.join(".soundsense-write-test");
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn appdata_dir() -> Option<PathBuf> {
    let base = std::env::var_os("APPDATA")?;
    let dir = PathBuf::from(base).join("tms-soundsense");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Resolve where the settings file lives. Prefers the exe directory (portable mode).
pub fn settings_path() -> PathBuf {
    if let Some(dir) = exe_dir() {
        let candidate = dir.join(SETTINGS_FILE);
        // An existing file next to the exe always wins, even if the dir became read-only.
        if candidate.exists() || dir_is_writable(&dir) {
            return candidate;
        }
    }
    if let Some(dir) = appdata_dir() {
        return dir.join(SETTINGS_FILE);
    }
    PathBuf::from(SETTINGS_FILE)
}

/// Load settings, generating the stable client id on first run and persisting it.
pub fn load() -> Settings {
    let path = settings_path();
    let mut settings = std::fs::read_to_string(&path)
        .ok()
        // Notepad saves UTF-8 with a BOM; serde_json rejects it, so strip it first.
        .and_then(|s| serde_json::from_str::<Settings>(s.trim_start_matches('﻿')).ok())
        .unwrap_or_default();
    let mut dirty = false;
    if uuid::Uuid::parse_str(&settings.id).is_err() {
        settings.id = uuid::Uuid::new_v4().to_string();
        dirty = true;
    }
    if settings.validate().is_err() {
        // Repair obviously broken fields instead of refusing to start.
        let d = Settings::default();
        if settings.interval_ms < 200 {
            settings.interval_ms = d.interval_ms;
        }
        if !(settings.threshold > 0.0 && settings.threshold <= 1.0) {
            settings.threshold = d.threshold;
        }
        if settings.discovery_port == 0 {
            settings.discovery_port = d.discovery_port;
        }
        if settings.unmute_minutes == 0 {
            settings.unmute_minutes = d.unmute_minutes;
        }
        if settings.on.is_empty() || settings.on.len() > 200 {
            settings.on = d.on;
        }
        if settings.off.is_empty() || settings.off.len() > 200 {
            settings.off = d.off;
        }
        if settings.validate().is_err() {
            settings.target = None;
        }
        dirty = true;
    }
    if dirty {
        if let Err(e) = save(&settings) {
            log::warn!("failed to persist initial settings: {e}");
        }
    }
    settings
}

pub fn save(settings: &Settings) -> anyhow::Result<()> {
    let path = settings_path();
    let json = serde_json::to_string_pretty(settings)?;
    // Write to a temp file then rename so a crash never leaves a truncated file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    std::fs::rename(&tmp, &path)?;
    Ok(())
}
