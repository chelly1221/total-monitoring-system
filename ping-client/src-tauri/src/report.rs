//! Pushes failure / recovery events to the TMS server over HTTP so the server can show
//! which monitored target tripped a PING_FAIL alarm. Events queue locally and are
//! delivered in batches; a failed delivery is retried, and the recent backlog is
//! re-sent after every server (re)connection because the server dedupes.

use crate::state::AppState;
use serde_json::{json, Value};
use std::time::Duration;

const RETRY_AFTER: Duration = Duration::from_secs(15);
const MAX_QUEUE: usize = 500;
const MAX_BATCH: usize = 200;

/// Server endpoint for event reports, derived from the provisioned UDP target.
pub fn report_url(settings: &crate::settings::Settings) -> Option<String> {
    if !settings.udp_enabled || settings.udp_ip.parse::<std::net::Ipv4Addr>().is_err() {
        return None;
    }
    Some(format!("http://{}:{}/api/ping-events", settings.udp_ip, settings.server_http_port))
}

/// Queue one event (called by the monitor on every 장애 발생 / 정상 복구 transition).
pub fn enqueue(state: &AppState, event: Value) {
    {
        let mut g = state.lock();
        if g.report_queue.len() >= MAX_QUEUE {
            g.report_queue.pop_front();
        }
        g.report_queue.push_back(event);
    }
    state.report_notify.notify_one();
}

/// Queue the recent history so a server that just (re)connected gets the backlog.
fn enqueue_backlog(state: &AppState) {
    let mut g = state.lock();
    let logs: Vec<Value> = g.logs.iter().cloned().collect();
    for event in logs {
        if g.report_queue.len() >= MAX_QUEUE {
            break;
        }
        if !g.report_queue.iter().any(|queued| queued == &event) {
            g.report_queue.push_back(event);
        }
    }
}

pub async fn run(state: AppState) {
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default();
    let mut synced_revision: Option<u64> = None;
    let mut wait = RETRY_AFTER;
    loop {
        tokio::select! {
            _ = state.report_notify.notified() => {}
            _ = tokio::time::sleep(wait) => {}
        }
        wait = RETRY_AFTER;
        let (url, revision, id, name) = {
            let g = state.lock();
            (report_url(&g.settings), g.config_revision, g.settings.id.clone(), g.settings.name.clone())
        };
        let Some(url) = url else {
            state.lock().report_status = "서버 미연결 · 이력 공유 대기".into();
            synced_revision = None;
            continue;
        };
        // A new or changed server binding: re-send the backlog once.
        if synced_revision != Some(revision) {
            enqueue_backlog(&state);
            synced_revision = Some(revision);
        }
        let batch: Vec<Value> = {
            let g = state.lock();
            g.report_queue.iter().take(MAX_BATCH).cloned().collect()
        };
        if batch.is_empty() {
            continue;
        }
        let body = json!({
            "id": id,
            "name": name,
            "host": hostname::get().unwrap_or_default().to_string_lossy(),
            "events": batch,
        });
        let sent = batch.len();
        let result = http
            .post(&url)
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .await;
        match result {
            Ok(resp) if resp.status().is_success() => {
                let mut g = state.lock();
                for _ in 0..sent.min(g.report_queue.len()) {
                    g.report_queue.pop_front();
                }
                let remaining = g.report_queue.len();
                g.report_status = format!("서버에 장애 이력 {sent}건 공유됨");
                drop(g);
                if remaining > 0 {
                    state.report_notify.notify_one();
                }
            }
            Ok(resp) => {
                log::warn!("ping event report rejected: {}", resp.status());
                state.lock().report_status = format!("이력 공유 거부됨 (HTTP {})", resp.status().as_u16());
            }
            Err(e) => {
                log::warn!("ping event report failed: {e}");
                state.lock().report_status = "이력 공유 실패 · 15초 후 재시도".into();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;

    #[test]
    fn report_url_follows_the_provisioned_server() {
        let mut s = Settings::default();
        assert_eq!(report_url(&s), None);
        s.udp_enabled = true;
        s.udp_ip = "192.168.0.10".into();
        assert_eq!(report_url(&s).as_deref(), Some("http://192.168.0.10:7777/api/ping-events"));
        s.server_http_port = 8080;
        assert_eq!(report_url(&s).as_deref(), Some("http://192.168.0.10:8080/api/ping-events"));
        s.udp_ip = "bad".into();
        assert_eq!(report_url(&s), None);
    }
}
