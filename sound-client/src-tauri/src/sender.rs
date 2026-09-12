//! Data path: sends the plain UTF-8 `on` / `off` payload to the provisioned target on
//! every state change and every `intervalMs` as a heartbeat.

use crate::state::{now_ms, AppState};
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::net::UdpSocket;

pub async fn run(state: AppState) {
    let sock = loop {
        match UdpSocket::bind("0.0.0.0:0").await {
            Ok(s) => break s,
            Err(e) => {
                log::warn!("sender socket bind failed: {e}");
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        }
    };

    loop {
        let (target, payload, interval_ms) = {
            let g = state.lock();
            let payload = if g.sound {
                g.settings.on.clone()
            } else {
                g.settings.off.clone()
            };
            (g.settings.target.clone(), payload, g.settings.interval_ms)
        };

        if let Some(t) = target {
            match t.ip.parse::<IpAddr>() {
                Ok(ip) => {
                    let addr = SocketAddr::new(ip, t.port);
                    match sock.send_to(payload.as_bytes(), addr).await {
                        Ok(_) => {
                            let mut g = state.lock();
                            g.last_sent_ms = Some(now_ms());
                            g.send_count += 1;
                        }
                        Err(e) => log::warn!("send to {addr} failed: {e}"),
                    }
                }
                Err(_) => log::warn!("invalid target ip: {}", t.ip),
            }
        }

        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(interval_ms.max(200))) => {}
            _ = state.sender_notify.notified() => {}
        }
    }
}
