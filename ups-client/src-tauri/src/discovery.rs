use crate::settings::DISCOVERY_PORT;
use crate::state::{alarm_state, AppState};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::time::Duration;
use tauri::AppHandle;
use tokio::net::UdpSocket;

pub fn local_ip_toward(ip: std::net::IpAddr) -> std::net::Ipv4Addr {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .ok()
        .and_then(|s| {
            s.connect((ip, 9)).ok()?;
            match s.local_addr().ok()?.ip() {
                std::net::IpAddr::V4(ip) => Some(ip),
                _ => None,
            }
        })
        .unwrap_or(std::net::Ipv4Addr::UNSPECIFIED)
}

pub fn decode(data: &[u8]) -> Option<Value> {
    if data.len() > 1200 {
        return None;
    }
    let msg: Value = serde_json::from_slice(data).ok()?;
    if msg["v"] != 1
        || !msg["nonce"]
            .as_str()
            .is_some_and(|s| s.len() == 16 && s.bytes().all(|c| c.is_ascii_hexdigit()))
    {
        return None;
    }
    Some(msg)
}

pub async fn run(app: AppHandle, state: AppState) {
    loop {
        let socket = match UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)).await {
            Ok(s) => s,
            Err(e) => {
                state.lock().discovery_status = format!("자동 연결 포트 {DISCOVERY_PORT} 오류: {e}");
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
        };
        state.lock().discovery_status = format!("자동 탐지 대기 · UDP {DISCOVERY_PORT}");
        let mut buffer = [0u8; 1201];
        loop {
            let (n, source) = match socket.recv_from(&mut buffer).await {
                Ok(r) => r,
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    continue;
                }
            };
            let Some(msg) = decode(&buffer[..n]) else {
                continue;
            };
            let reply = match msg["t"].as_str() {
                Some("probe") => here(&state, &msg, source),
                Some("transfer") => {
                    // Validate and start the download in the background; the ack only says
                    // whether the request was accepted (progress goes back over HTTP).
                    let result = crate::transfer::TransferRequest::parse(&msg)
                        .and_then(|req| crate::transfer::start(&app, &state, req));
                    json!({"v":1,"t":"ack","nonce":msg["nonce"],"id":state_id(&state),"ok":result.is_ok(),"error":result.err().unwrap_or_default()})
                }
                Some("identify") | Some("config") => {
                    // Disk and window operations run outside the async I/O executor.
                    let command_app = app.clone();
                    let command_state = state.clone();
                    let command = msg.clone();
                    let result = tauri::async_runtime::spawn_blocking(move || {
                        if command["t"] == "identify" {
                            crate::identify(&command_app, command["sec"].as_u64().unwrap_or(5).clamp(1, 60));
                            Ok(())
                        } else {
                            command_state.apply(command, true).map(|_| ())
                        }
                    })
                    .await
                    .unwrap_or_else(|e| Err(e.to_string()));
                    if result.is_ok() {
                        let _ = tauri::Emitter::emit(&app, "snapshot", state.snapshot());
                    }
                    json!({"v":1,"t":"ack","nonce":msg["nonce"],"id":state_id(&state),"ok":result.is_ok(),"error":result.err().unwrap_or_default()})
                }
                _ => continue,
            };
            let bytes = reply.to_string();
            if bytes.len() <= 1200 {
                let _ = socket.send_to(bytes.as_bytes(), source).await;
            }
        }
    }
}

fn state_id(state: &AppState) -> String {
    state.lock().settings.id.clone()
}

/// `here` reply. Besides the common fields it lists both UPS units so the server can bind
/// each one to its own facility (`units[].unit`, `.target`, `.alarm`). `target` mirrors
/// unit 1 for readers of the base protocol.
fn here(state: &AppState, msg: &Value, source: SocketAddr) -> Value {
    let local = local_ip_toward(source.ip());
    let mac = crate::netinfo::mac_by_ipv4(local).unwrap_or_default();
    let g = state.lock();
    let unit_json = |i: usize| -> Value {
        let cfg = &g.settings.units[i];
        let live = &g.units[i];
        let target = if cfg.server_enabled { json!({"ip": cfg.server_ip, "port": cfg.server_port}) } else { Value::Null };
        let alarm = if !g.running { Value::Null } else if live.alarm_active { json!(true) } else if live.reachable == Some(true) { json!(false) } else { Value::Null };
        json!({"unit": i + 1, "target": target, "alarm": alarm, "reachable": live.reachable, "muted": cfg.muted, "ups": cfg.ip})
    };
    let units: Vec<Value> = (0..g.settings.units.len()).map(unit_json).collect();
    json!({"v":1,"t":"here","nonce":msg["nonce"],"kind":"ups","discoveryPort":DISCOVERY_PORT,
        "id":g.settings.id,"name":g.settings.name,"host":hostname::get().unwrap_or_default().to_string_lossy(),
        "ver":env!("CARGO_PKG_VERSION"),"mac":mac,"target":units[0]["target"].clone(),
        "muted":g.settings.units.iter().all(|u| u.muted),
        "sound":false,"alarm":alarm_state(&g),"running":g.running,"units":units,
        "uptimeSec":state.started.elapsed().as_secs()})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn datagrams_require_version_nonce_and_size() {
        assert!(decode(br#"{"v":1,"t":"probe","nonce":"0123456789abcdef"}"#).is_some());
        assert!(decode(br#"{"v":2,"t":"probe","nonce":"0123456789abcdef"}"#).is_none());
        assert!(decode(br#"{"v":1,"t":"probe","nonce":"bad"}"#).is_none());
        assert!(decode(&vec![b' '; 1201]).is_none());
    }

    #[test]
    fn here_reply_lists_both_units_and_stays_small() {
        let state = AppState::new(crate::settings::Settings::default(), std::env::temp_dir());
        state.apply(json!({"target": {"ip": "127.0.0.1", "port": 6102}, "unit": 2}), true).unwrap();
        let reply = here(&state, &json!({"nonce": "0123456789abcdef"}), "127.0.0.1:5000".parse().unwrap());
        assert_eq!(reply["kind"], "ups");
        assert_eq!(reply["discoveryPort"], 7792);
        assert_eq!(reply["units"].as_array().unwrap().len(), 2);
        assert_eq!(reply["target"]["port"], 1991, "target mirrors unit 1's default binding");
        assert_eq!(reply["units"][1]["target"]["port"], 6102);
        assert_eq!(reply["units"][0]["unit"], 1);
        assert!(reply["alarm"].is_null(), "nothing measured yet");
        assert!(reply.to_string().len() <= 1200);
        let _ = std::fs::remove_file(std::env::temp_dir().join(crate::settings::SETTINGS_FILE));
    }
}
