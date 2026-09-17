use crate::settings::{self, Settings};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Notify;

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
    /// A server-initiated file transfer is downloading or running.
    pub transfer_busy: bool,
    /// Progress / outcome of the latest transfer for the UI ("" when idle).
    pub transfer_status: String,
    /// Failure / recovery events waiting to be posted to the server.
    pub report_queue: VecDeque<Value>,
    pub report_status: String,
    /// Windows endpoint mute state and the auto-unmute countdown.
    pub pc_mute: crate::pcmute::PcMute,
}

#[derive(Clone)]
pub struct AppState {
    pub inner: Arc<Mutex<Inner>>,
    pub dir: PathBuf,
    pub started: Instant,
    pub history: Arc<Mutex<crate::history::HistoryStore>>,
    /// Wakes the event reporter when something was queued.
    pub report_notify: Arc<Notify>,
}

impl AppState {
    pub fn new(settings: Settings, dir: PathBuf) -> Result<Self, String> {
        let history = crate::history::HistoryStore::open(&dir)?;
        let mut logs = history
            .query()
            .page(None, "", "", crate::history::RECENT_LIMIT)?
            .entries;
        logs.reverse();
        let running = settings.auto_monitor && settings.targets.iter().any(|t| t.enabled);
        Ok(Self {
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
                transfer_busy: false,
                transfer_status: String::new(),
                report_queue: VecDeque::new(),
                report_status: "서버 미연결 · 이력 공유 대기".into(),
                pc_mute: Default::default(),
            })),
            dir,
            started: Instant::now(),
            history: Arc::new(Mutex::new(history)),
            report_notify: Arc::new(Notify::new()),
        })
    }
    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn snapshot(&self) -> Value {
        let g = self.lock();
        json!({"settings": g.settings, "running": g.running, "results": g.results.values().collect::<Vec<_>>(),
            "logs": g.logs, "logBytes": self.history.lock().unwrap_or_else(|e| e.into_inner()).bytes_used(), "logMaxBytes": crate::history::MAX_BYTES, "discoveryStatus": g.discovery_status, "sendStatus": g.send_status,
            "captureStatus": g.capture_status, "lastSentAt": g.last_sent_at,
            "configRevision": g.config_revision, "uptimeSec": self.started.elapsed().as_secs(),
            "transferStatus": g.transfer_status, "reportStatus": g.report_status,
            "pcMuted": g.pc_mute.muted, "unmuteRemainingSec": g.pc_mute.remaining_sec(),
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
