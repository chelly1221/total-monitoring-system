use crate::settings::{self, Settings};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub index: usize,
    pub name: String,
    pub address: String,
    pub status: String,
    pub timestamp: String,
    pub at: u64,
    pub rtt_ms: Option<u32>,
    pub sent: u64,
    pub lost: u64,
    pub consecutive_failures: u32,
    pub history: Vec<Option<u32>>,
}

pub struct Inner {
    pub settings: Settings,
    pub running: bool,
    pub generation: u64,
    pub results: BTreeMap<usize, PingResult>,
    pub logs: Vec<Value>,
    pub discovery_status: String,
    pub send_status: String,
    pub capture_status: String,
    pub last_sent_at: Option<u64>,
    pub last_payload: Option<String>,
    pub config_revision: u64,
}

#[derive(Clone)]
pub struct AppState {
    pub inner: Arc<Mutex<Inner>>,
    pub dir: PathBuf,
    pub started: Instant,
}

impl AppState {
    pub fn new(settings: Settings, dir: PathBuf) -> Self {
        let logs: Vec<Value> = std::fs::read_to_string(dir.join("ping-history.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<Value>>(&raw).ok())
            .unwrap_or_default()
            .into_iter()
            .rev()
            .take(100)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        let running = settings.auto_monitor && settings.targets.iter().any(|t| t.enabled);
        Self {
            inner: Arc::new(Mutex::new(Inner {
                settings,
                running,
                generation: 0,
                results: BTreeMap::new(),
                logs,
                discovery_status: "자동 연결 준비 중".into(),
                send_status: "서버 미연결".into(),
                capture_status: "캡처 대기".into(),
                last_sent_at: None,
                last_payload: None,
                config_revision: 0,
            })),
            dir,
            started: Instant::now(),
        }
    }
    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn snapshot(&self) -> Value {
        let g = self.lock();
        json!({"settings": g.settings, "running": g.running, "results": g.results.values().collect::<Vec<_>>(),
            "logs": g.logs, "discoveryStatus": g.discovery_status, "sendStatus": g.send_status,
            "captureStatus": g.capture_status, "lastSentAt": g.last_sent_at,
            "configRevision": g.config_revision, "uptimeSec": self.started.elapsed().as_secs(),
            "host": hostname::get().unwrap_or_default().to_string_lossy(), "version": env!("CARGO_PKG_VERSION")})
    }
    pub fn apply(&self, patch: Value, provision: bool) -> Result<Settings, String> {
        let mut g = self.lock();
        let next = if provision {
            g.settings.provision(&patch)?
        } else {
            g.settings.patch(patch)?
        };
        settings::write_json(&self.dir.join("ping-settings.json"), &next)?;
        let old = &g.settings;
        let restart = serde_json::to_value(&old.targets).ok()
            != serde_json::to_value(&next.targets).ok()
            || old.ping_interval != next.ping_interval
            || old.timeout_ms != next.timeout_ms
            || old.failure_threshold != next.failure_threshold
            || serde_json::to_value(&old.capture_devices).ok()
                != serde_json::to_value(&next.capture_devices).ok();
        if restart {
            g.generation += 1;
            g.results.clear();
        }
        g.last_payload = None;
        g.settings = next.clone();
        g.config_revision += 1;
        Ok(next)
    }
}

/// Silence while stopped or awaiting first measurements lets TMS mark the client offline.
pub fn alarm_state(g: &Inner) -> Option<bool> {
    if !g.running {
        return None;
    }
    let active: Vec<_> = g
        .settings
        .targets
        .iter()
        .enumerate()
        .filter(|(_, t)| t.enabled)
        .collect();
    if active.is_empty() {
        return None;
    }
    if active
        .iter()
        .any(|(i, _)| g.results.get(i).is_some_and(|r| r.status == "장애"))
    {
        return Some(true);
    }
    if active
        .iter()
        .all(|(i, _)| g.results.get(i).is_some_and(|r| r.status == "성공"))
    {
        Some(false)
    } else {
        None
    }
}
