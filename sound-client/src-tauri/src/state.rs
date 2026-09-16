//! Shared runtime state and the snapshot pushed to the UI.

use crate::settings::{Settings, Target};
use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{watch, Notify};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct Inner {
    pub settings: Settings,
    pub sound: bool,
    pub peak: f32,
    pub muted: bool,
    pub unmute_deadline: Option<Instant>,
    pub last_sent_ms: Option<u64>,
    pub send_count: u64,
    pub audio_status: String,
    pub discovery_status: String,
    pub host: String,
    /// A server-initiated file transfer is downloading or running.
    pub transfer_busy: bool,
    /// Progress / outcome of the latest transfer for the status tab ("" when idle).
    pub transfer_status: String,
}

pub struct Shared {
    inner: Mutex<Inner>,
    pub started: Instant,
    /// Wakes the UDP sender so a state/target change is transmitted immediately.
    pub sender_notify: Notify,
    /// Discovery port; the responder rebinds when it changes.
    pub port_tx: watch::Sender<u16>,
    pub port_rx: watch::Receiver<u16>,
}

pub type AppState = Arc<Shared>;

impl Shared {
    pub fn new(settings: Settings) -> AppState {
        let (port_tx, port_rx) = watch::channel(settings.discovery_port);
        let host = hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_default();
        Arc::new(Shared {
            inner: Mutex::new(Inner {
                settings,
                sound: false,
                peak: 0.0,
                muted: false,
                unmute_deadline: None,
                last_sent_ms: None,
                send_count: 0,
                audio_status: "초기화 중".into(),
                discovery_status: "초기화 중".into(),
                host,
                transfer_busy: false,
                transfer_status: String::new(),
            }),
            started: Instant::now(),
            sender_notify: Notify::new(),
            port_tx,
            port_rx,
        })
    }

    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        // A poisoned lock only means a panicked holder; the data is still plain values.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn settings(&self) -> Settings {
        self.lock().settings.clone()
    }

    pub fn uptime_sec(&self) -> u64 {
        self.started.elapsed().as_secs()
    }

    pub fn snapshot(&self) -> Snapshot {
        let g = self.lock();
        Snapshot {
            sound: g.sound,
            peak: g.peak,
            muted: g.muted,
            unmute_remaining_sec: g
                .unmute_deadline
                .map(|d| d.saturating_duration_since(Instant::now()).as_secs()),
            target: g.settings.target.clone(),
            last_sent_ms: g.last_sent_ms,
            send_count: g.send_count,
            name: g.settings.name.clone(),
            host: g.host.clone(),
            local_ip: local_ip_for(g.settings.target.as_ref()),
            id: g.settings.id.clone(),
            version: VERSION.to_string(),
            uptime_sec: self.uptime_sec(),
            audio_status: g.audio_status.clone(),
            discovery_status: g.discovery_status.clone(),
            unmute_minutes: g.settings.unmute_minutes,
            transfer_status: g.transfer_status.clone(),
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub sound: bool,
    pub peak: f32,
    pub muted: bool,
    pub unmute_remaining_sec: Option<u64>,
    pub target: Option<Target>,
    pub last_sent_ms: Option<u64>,
    pub send_count: u64,
    pub name: String,
    pub host: String,
    pub local_ip: String,
    pub id: String,
    pub version: String,
    pub uptime_sec: u64,
    pub audio_status: String,
    pub discovery_status: String,
    pub unmute_minutes: u32,
    pub transfer_status: String,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Local IPv4 the OS would use to reach `remote` (UDP connect trick, no packets sent).
pub fn local_ip_toward(remote: IpAddr) -> Option<IpAddr> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect((remote, 9)).ok()?;
    sock.local_addr().ok().map(|a| a.ip())
}

/// Best-effort "this PC's IP" for the UI: route toward the server target, else a public address.
pub fn local_ip_for(target: Option<&Target>) -> String {
    let remote = target
        .and_then(|t| t.ip.parse::<IpAddr>().ok())
        .unwrap_or(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)));
    local_ip_toward(remote)
        .filter(|ip| !ip.is_unspecified())
        .map(|ip| ip.to_string())
        .unwrap_or_default()
}

/// MAC of the interface owning `ip`, falling back to the first real adapter. "" if unknown.
pub fn mac_for_local_ip(ip: Option<IpAddr>) -> String {
    let by_ip = match ip {
        Some(IpAddr::V4(v4)) if !v4.is_loopback() => crate::netinfo::mac_by_ipv4(v4),
        _ => None,
    };
    by_ip.or_else(crate::netinfo::first_mac).unwrap_or_default()
}
