//! LAN discovery responder (Sound Client Discovery Protocol v1).
//! Binds UDP 0.0.0.0:<discoveryPort>, answers `probe` with `here`, and executes
//! `identify` / `config` commands replying with `ack`.

use crate::settings::Target;
use crate::state::{local_ip_toward, mac_for_local_ip, now_sec, AppState, VERSION};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use std::net::SocketAddr;
use std::time::Duration;
use tauri::AppHandle;
use tokio::net::UdpSocket;

const MAX_DATAGRAM: usize = 4096;
const TS_TOLERANCE_SEC: i64 = 60;

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
            let result = match verify(state, t, &nonce, &msg) {
                Err(e) => Err(e),
                Ok(()) => {
                    if t == "identify" {
                        handle_identify(app, &msg)
                    } else {
                        handle_config(app, state, &msg)
                    }
                }
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

/// Token rules: empty token accepts everything; otherwise require fresh `ts` and a valid `sig`.
fn verify(state: &AppState, t: &str, nonce: &str, msg: &Value) -> Result<(), String> {
    let token = state.lock().settings.token.clone();
    if token.is_empty() {
        return Ok(());
    }
    let ts = msg
        .get("ts")
        .and_then(Value::as_i64)
        .ok_or_else(|| "missing ts".to_string())?;
    if (now_sec() - ts).abs() > TS_TOLERANCE_SEC {
        return Err("stale timestamp".into());
    }
    let sig = msg
        .get("sig")
        .and_then(Value::as_str)
        .ok_or_else(|| "missing sig".to_string())?;
    let sig_bytes = hex::decode(sig).map_err(|_| "bad signature".to_string())?;
    let mut mac =
        Hmac::<Sha256>::new_from_slice(token.as_bytes()).map_err(|_| "bad token".to_string())?;
    mac.update(format!("{t}|{nonce}|{ts}").as_bytes());
    mac.verify_slice(&sig_bytes)
        .map_err(|_| "bad signature".to_string())
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
    let mut s = state.settings();

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
    crate::apply_settings(app, s).map(|_| ())
}
