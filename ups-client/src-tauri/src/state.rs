use crate::settings::{self, Settings, UNIT_COUNT};
use crate::ups::{self, Level};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub const MAX_LOG_LINES: usize = 500;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub at: u64,
    pub message: String,
    /// `warn` for threshold/status faults, `info` for recoveries and notes.
    pub level: &'static str,
}

/// Live readings of one UPS card, refreshed every poll.
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UnitState {
    /// Formatted values in parameter order (label -> "374 V" / "정상" / "No Data").
    pub data: Vec<(String, String)>,
    /// Threshold level per label (only labels that ever left the normal range).
    pub levels: BTreeMap<String, Level>,
    pub logs: Vec<LogEntry>,
    /// Consecutive polls whose status looked abnormal.
    pub abnormal_count: u32,
    pub alarm_active: bool,
    /// Poll transport state: true once the UPS answered at least once since (re)start.
    pub reachable: Option<bool>,
    pub poll_status: String,
    pub last_poll_at: Option<u64>,
    pub send_status: String,
    pub last_sent_at: Option<u64>,
    #[serde(skip)]
    pub prev_status: BTreeMap<String, String>,
    #[serde(skip)]
    pub last_alarm_sound: Option<Instant>,
}

pub struct Inner {
    pub settings: Settings,
    pub running: bool,
    /// Bumped when a unit's polling settings change so the loop drops stale results.
    pub generation: u64,
    pub units: Vec<UnitState>,
    pub discovery_status: String,
    pub config_revision: u64,
    /// A server-initiated file transfer is downloading or running.
    pub transfer_busy: bool,
    /// Progress / outcome of the latest transfer for the UI ("" when idle).
    pub transfer_status: String,
    /// Windows endpoint mute state and the auto-unmute countdown.
    pub pc_mute: crate::pcmute::PcMute,
}

#[derive(Clone)]
pub struct AppState {
    pub inner: Arc<Mutex<Inner>>,
    pub dir: PathBuf,
    pub started: Instant,
}

impl AppState {
    pub fn new(settings: Settings, dir: PathBuf) -> Self {
        let running = settings.auto_monitor;
        let units = (0..UNIT_COUNT)
            .map(|_| UnitState { poll_status: "대기 중".into(), send_status: "서버 미연결".into(), ..Default::default() })
            .collect();
        Self {
            inner: Arc::new(Mutex::new(Inner {
                settings,
                running,
                generation: 0,
                units,
                discovery_status: "자동 연결 준비 중".into(),
                config_revision: 0,
                transfer_busy: false,
                transfer_status: String::new(),
                pc_mute: Default::default(),
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
        json!({
            "settings": g.settings,
            "running": g.running,
            "units": g.units,
            "discoveryStatus": g.discovery_status,
            "configRevision": g.config_revision,
            "transferStatus": g.transfer_status,
            "pcMuted": g.pc_mute.muted,
            "unmuteRemainingSec": g.pc_mute.remaining_sec(),
            "uptimeSec": self.started.elapsed().as_secs(),
            "host": hostname::get().unwrap_or_default().to_string_lossy(),
            "version": env!("CARGO_PKG_VERSION"),
            "params": {
                "1": ups::UPS1_PARAMS.iter().map(|p| json!({"label": p.label, "limit": p.limit})).collect::<Vec<_>>(),
                "2": ups::UPS2_PARAMS.iter().map(|p| json!({"label": p.label, "limit": p.limit})).collect::<Vec<_>>(),
            },
        })
    }

    /// Persist a settings change. Polling settings of a unit (address, community, period)
    /// restart that unit's loop; server binding and limits apply on the next poll.
    pub fn apply(&self, patch: Value, provision: bool) -> Result<Settings, String> {
        let mut g = self.lock();
        let next = if provision { g.settings.provision(&patch)? } else { g.settings.patch(patch)? };
        settings::write_json(&self.dir.join(settings::SETTINGS_FILE), &next)?;
        let restart = g
            .settings
            .units
            .iter()
            .zip(&next.units)
            .any(|(a, b)| a.ip != b.ip || a.community != b.community || a.interval_sec != b.interval_sec);
        if restart {
            g.generation += 1;
        }
        let Inner { settings, units, config_revision, .. } = &mut *g;
        for (i, unit) in units.iter_mut().enumerate() {
            let (old, new) = (&settings.units[i], &next.units[i]);
            if old.server_enabled != new.server_enabled || old.server_ip != new.server_ip || old.server_port != new.server_port {
                unit.last_sent_at = None;
                unit.send_status = if new.server_enabled { "전송 대기".into() } else { "서버 미연결".into() };
            }
        }
        *settings = next.clone();
        *config_revision += 1;
        Ok(next)
    }

    #[cfg(test)]
    pub fn push_log(&self, unit: usize, level: &'static str, message: String) {
        let mut g = self.lock();
        push_log(&mut g.units[unit], level, message);
    }
}

pub fn push_log(unit: &mut UnitState, level: &'static str, message: String) {
    unit.logs.push(LogEntry { at: now_ms(), message, level });
    if unit.logs.len() > MAX_LOG_LINES {
        let drop = unit.logs.len() - MAX_LOG_LINES;
        unit.logs.drain(..drop);
    }
}

/// Alarm summary for the server: `Some(true)` when any unit is alarming, `Some(false)` when
/// every unit has answered and is healthy, `None` while stopped or before the first reply.
pub fn alarm_state(g: &Inner) -> Option<bool> {
    if !g.running {
        return None;
    }
    if g.units.iter().any(|u| u.alarm_active) {
        return Some(true);
    }
    if g.units.iter().all(|u| u.reachable == Some(true)) {
        Some(false)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_are_capped_and_alarm_summary_follows_units() {
        let state = AppState::new(Settings::default(), std::env::temp_dir());
        for i in 0..(MAX_LOG_LINES + 20) {
            state.push_log(0, "info", format!("line {i}"));
        }
        let mut g = state.lock();
        assert_eq!(g.units[0].logs.len(), MAX_LOG_LINES);
        assert_eq!(g.units[0].logs[0].message, "line 20");
        assert_eq!(alarm_state(&g), None, "nothing measured yet");
        g.units[0].reachable = Some(true);
        g.units[1].reachable = Some(true);
        assert_eq!(alarm_state(&g), Some(false));
        g.units[1].alarm_active = true;
        assert_eq!(alarm_state(&g), Some(true));
        g.running = false;
        assert_eq!(alarm_state(&g), None);
    }
}
