//! LAN discovery responder (Sound Client Discovery Protocol v1).
//! Binds UDP 0.0.0.0:<discoveryPort>, answers `probe` with `here`, and executes
//! `identify` / `config` commands replying with `ack`.

use crate::settings::Target;
use crate::state::{local_ip_toward, mac_for_local_ip, AppState, VERSION};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::time::Duration;
use tauri::AppHandle;
use tokio::net::UdpSocket;

const MAX_DATAGRAM: usize = 4096;

fn set_status(state: &AppState, text: String) {
    let mut g = state.lock();
    if g.discovery_status != text {
        log::info!("discovery: {text}");
        g.discovery_status = text;
    }
}

pub async fn run(app: AppHandle, state: AppState) {
    let mut port_rx = state.port_rx.clone();
    loop {
        let port = *port_rx.borrow_and_update();
        let sock = match UdpSocket::bind(("0.0.0.0", port)).await {
            Ok(s) => s,
            Err(e) => {
                set_status(&state, format!("UDP {port} 바인드 실패: {e}"));
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                    _ = port_rx.changed() => {}
                }
                continue;
            }
        };
        set_status(&state, format!("UDP {port} 대기 중"));

        let mut buf = vec![0u8; MAX_DATAGRAM];
        loop {
            tokio::select! {
                r = sock.recv_from(&mut buf) => match r {
                    Ok((n, src)) => handle(&app, &state, &sock, &buf[..n], src).await,
                    Err(e) => {
                        // Windows reports ICMP port-unreachable as a recv error; just keep going.
                        log::debug!("discovery recv error: {e}");
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                },
                _ = port_rx.changed() => break, // rebind with the new port
            }
        }
    }
}

async fn handle(app: &AppHandle, state: &AppState, sock: &UdpSocket, data: &[u8], src: SocketAddr) {
    let Ok(msg) = serde_json::from_slice::<Value>(data) else {
        return;
    };
    if msg.get("v").and_then(Value::as_i64) != Some(1) {
        return;
    }
    let Some(t) = msg.get("t").and_then(Value::as_str) else {
        return;
    };
    let nonce = msg
        .get("nonce")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    match t {
        "probe" => {
            let reply = build_here(state, &nonce, src);
            send_json(sock, &reply, src).await;
        }
        "identify" | "config" => {
            let result = if t == "identify" {
                handle_identify(app, &msg)
            } else {
                handle_config(app, state, &msg)
            };
            let (ok, error) = match result {
                Ok(()) => (true, String::new()),
                Err(e) => {
                    log::warn!("{t} from {src} rejected: {e}");
                    (false, e)
                }
            };
            let ack = json!({
                "v": 1,
                "t": "ack",
                "nonce": nonce,
                "ok": ok,
                "id": state.lock().settings.id,
                "error": error,
            });
            send_json(sock, &ack, src).await;
        }
        _ => {}
    }
}

async fn send_json(sock: &UdpSocket, value: &Value, dst: SocketAddr) {
    let bytes = value.to_string();
    if let Err(e) = sock.send_to(bytes.as_bytes(), dst).await {
        log::warn!("reply to {dst} failed: {e}");
    }
}

fn build_here(state: &AppState, nonce: &str, src: SocketAddr) -> Value {
    let local_ip = local_ip_toward(src.ip());
    let mac = mac_for_local_ip(local_ip);
    let g = state.lock();
    json!({
        "v": 1,
        "t": "here",
        "nonce": nonce,
        "id": g.settings.id,
        "name": g.settings.name,
        "host": g.host,
        "ver": VERSION,
        "mac": mac,
        "target": g.settings.target,
        "muted": g.muted,
        "sound": g.sound,
        "uptimeSec": state.uptime_sec(),
    })
}

fn handle_identify(app: &AppHandle, msg: &Value) -> Result<(), String> {
    let sec = msg
        .get("sec")
        .and_then(Value::as_u64)
        .unwrap_or(5)
        .clamp(1, 300);
    crate::identify(app, sec);
    Ok(())
}

fn handle_config(app: &AppHandle, state: &AppState, msg: &Value) -> Result<(), String> {
    let settings = parse_config(state.settings(), msg)?;
    crate::apply_settings(app, settings).map(|_| ())
}

fn parse_config(
    mut s: crate::settings::Settings,
    msg: &Value,
) -> Result<crate::settings::Settings, String> {
    match msg.get("target") {
        None => return Err("missing target".into()),
        Some(Value::Null) => s.target = None,
        Some(v) => {
            let ip = v
                .get("ip")
                .and_then(Value::as_str)
                .filter(|ip| ip.parse::<std::net::Ipv4Addr>().is_ok())
                .ok_or_else(|| "invalid target.ip".to_string())?;
            let port = v
                .get("port")
                .and_then(Value::as_u64)
                .filter(|p| (1..=65535).contains(p))
                .ok_or_else(|| "invalid target.port".to_string())?;
            s.target = Some(Target {
                ip: ip.to_string(),
                port: port as u16,
            });
        }
    }
    if let Some(v) = msg.get("on") {
        s.on = v
            .as_str()
            .filter(|x| !x.is_empty())
            .ok_or_else(|| "invalid on".to_string())?
            .to_string();
    }
    if let Some(v) = msg.get("off") {
        s.off = v
            .as_str()
            .filter(|x| !x.is_empty())
            .ok_or_else(|| "invalid off".to_string())?
            .to_string();
    }
    if let Some(v) = msg.get("intervalMs") {
        s.interval_ms = v
            .as_u64()
            .filter(|x| *x >= 200)
            .ok_or_else(|| "invalid intervalMs".to_string())?;
    }
    if let Some(v) = msg.get("name") {
        let name = v.as_str().ok_or_else(|| "invalid name".to_string())?.trim();
        if !name.is_empty() {
            s.name = name.to_string();
        }
    }
    s.validate()?;
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;

    #[test]
    fn unsigned_config_updates_target_and_keeps_local_audio_settings() {
        let original = Settings {
            name: "old PC".into(),
            threshold: 0.025,
            ..Settings::default()
        };
        let msg = json!({"target":{"ip":"127.0.0.1","port":6100},"name":"new PC","on":"ON","off":"OFF","intervalMs":1000});
        let updated = parse_config(original, &msg).unwrap();
        assert_eq!(updated.target.unwrap().port, 6100);
        assert_eq!(updated.name, "new PC");
        assert_eq!(updated.on, "ON");
        assert_eq!(updated.off, "OFF");
        assert_eq!(updated.interval_ms, 1000);
        assert_eq!(updated.threshold, 0.025);
    }

    #[test]
    fn invalid_unsigned_payloads_are_still_rejected() {
        for msg in [
            json!({}),
            json!({"target":{"ip":"bad","port":6100}}),
            json!({"target":{"ip":"127.0.0.1","port":0}}),
            json!({"target":null,"on":""}),
        ] {
            assert!(parse_config(Settings::default(), &msg).is_err());
        }
        assert!(parse_config(Settings::default(), &json!({"target":null}))
            .unwrap()
            .target
            .is_none());
    }
}
