use crate::state::{alarm_state, now_ms, AppState, PingResult};
use serde_json::json;
use std::net::Ipv4Addr;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use windows::Win32::NetworkManagement::IpHelper::{
    IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY,
};

pub fn ping(address: &str, timeout_ms: u32) -> Option<u32> {
    let ip = address.parse::<Ipv4Addr>().ok()?;
    // Aligned storage includes the echo reply, payload and the documented extra 8 bytes.
    let mut reply = [0u64; 128];
    let payload = *b"TMS ping monitor";
    unsafe {
        let handle = IcmpCreateFile().ok()?;
        let count = IcmpSendEcho(
            handle,
            u32::from_ne_bytes(ip.octets()),
            payload.as_ptr().cast(),
            payload.len() as u16,
            None,
            reply.as_mut_ptr().cast(),
            std::mem::size_of_val(&reply) as u32,
            timeout_ms,
        );
        let result = &*(reply.as_ptr() as *const ICMP_ECHO_REPLY);
        let rtt = (count > 0 && result.Status == 0).then_some(result.RoundTripTime);
        let _ = IcmpCloseHandle(handle);
        rtt
    }
}

async fn probe(address: String, timeout_ms: u32) -> Option<u32> {
    let ip = match address.parse::<Ipv4Addr>() {
        Ok(ip) => ip,
        Err(_) => tokio::time::timeout(
            Duration::from_millis(u64::from(timeout_ms)),
            tokio::net::lookup_host((address.as_str(), 0)),
        )
        .await
        .ok()?
        .ok()?
        .find_map(|s| match s.ip() {
            std::net::IpAddr::V4(ip) => Some(ip),
            _ => None,
        })?,
    };
    tokio::task::spawn_blocking(move || ping(&ip.to_string(), timeout_ms))
        .await
        .ok()
        .flatten()
}

pub fn record(
    previous: Option<&PingResult>,
    index: usize,
    target: &crate::settings::Target,
    rtt: Option<u32>,
    threshold: u32,
) -> PingResult {
    let failures = if rtt.is_some() {
        0
    } else {
        previous.map_or(1, |p| p.consecutive_failures.saturating_add(1))
    };
    let status = if rtt.is_some() {
        "성공"
    } else if failures >= threshold {
        "장애"
    } else {
        "확인 중"
    };
    let mut history = previous.map(|p| p.history.clone()).unwrap_or_default();
    history.push(rtt);
    if history.len() > 60 {
        history.remove(0);
    }
    PingResult {
        index,
        name: target.name.clone(),
        address: target.address.clone(),
        status: status.into(),
        timestamp: String::new(),
        at: now_ms(),
        rtt_ms: rtt,
        sent: previous.map_or(1, |p| p.sent + 1),
        lost: previous.map_or(0, |p| p.lost) + u64::from(rtt.is_none()),
        consecutive_failures: failures,
        history,
    }
}

pub async fn run(app: AppHandle, state: AppState) {
    loop {
        let (settings, generation, running) = {
            let g = state.lock();
            (g.settings.clone(), g.generation, g.running)
        };
        if !running {
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        }
        let start = Instant::now();
        let mut tasks = tokio::task::JoinSet::new();
        for (index, target) in settings
            .targets
            .iter()
            .enumerate()
            .filter(|(_, t)| t.enabled)
        {
            let target = target.clone();
            let timeout = settings.timeout_ms;
            tasks.spawn(async move {
                let rtt = probe(target.address.clone(), timeout).await;
                (index, target, rtt)
            });
        }
        while let Some(result) = tasks.join_next().await {
            let Ok((index, target, rtt)) = result else {
                continue;
            };
            let mut g = state.lock();
            if !g.running || g.generation != generation {
                continue;
            }
            let previous = g.results.get(&index);
            let result = record(previous, index, &target, rtt, settings.failure_threshold);
            let was_failed = previous.is_some_and(|p| {
                p.status == "장애" || p.consecutive_failures >= settings.failure_threshold
            });
            let transition = if result.status == "장애" && !was_failed {
                Some("장애 발생")
            } else if result.status == "성공" && was_failed {
                Some("정상 복구")
            } else {
                None
            };
            if let Some(status) = transition {
                let event = json!({"at": result.at, "name": result.name, "address": result.address, "status": status, "rttMs": result.rtt_ms, "sent": result.sent, "lost": result.lost, "consecutiveFailures": result.consecutive_failures, "timeoutMs": settings.timeout_ms, "failureThreshold": settings.failure_threshold});
                g.logs.push(event.clone());
                if g.logs.len() > crate::history::RECENT_LIMIT {
                    g.logs.remove(0);
                }
                if let Err(e) = state
                    .history
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .append(&event)
                {
                    g.send_status = e;
                }
                let _ = app.emit("failure-log", event);
            }
            let _ = app.emit("ping-result", &result);
            g.results.insert(index, result);
        }
        while start.elapsed() < Duration::from_secs(settings.ping_interval) {
            if {
                let g = state.lock();
                !g.running || g.generation != generation
            } {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

pub async fn heartbeat(app: AppHandle, state: AppState) {
    let mut last_alarm = Instant::now() - Duration::from_secs(5);
    loop {
        // Send while holding the state lock so stop/config cannot race a stale datagram.
        {
            let mut g = state.lock();
            let fault = alarm_state(&g);
            if let Some(fault) = fault {
                if fault
                    && g.settings.sound_enabled
                    && !g.settings.mute_state
                    && last_alarm.elapsed().as_secs() >= 3
                {
                    if let Err(e) = crate::play_sound(&g.settings.sound_file) {
                        g.send_status = e;
                    }
                    last_alarm = Instant::now();
                }
                if g.settings.udp_enabled {
                    let payload = if fault {
                        &g.settings.udp_message
                    } else {
                        &g.settings.udp_no_failure_message
                    }
                    .clone();
                    if g.last_payload.as_ref() != Some(&payload)
                        || now_ms().saturating_sub(g.last_sent_at.unwrap_or(0))
                            >= g.settings.interval_ms
                    {
                        let result = std::net::UdpSocket::bind("0.0.0.0:0").and_then(|s| {
                            s.set_write_timeout(Some(Duration::from_millis(100)))?;
                            s.send_to(
                                payload.as_bytes(),
                                format!("{}:{}", g.settings.udp_ip, g.settings.udp_port),
                            )
                        });
                        match result {
                            Ok(_) => {
                                g.last_sent_at = Some(now_ms());
                                g.last_payload = Some(payload);
                                g.send_status = "상태 전송 중".into();
                            }
                            Err(e) => g.send_status = format!("UDP 전송 실패: {e}"),
                        }
                    }
                } else {
                    g.send_status = "서버 미연결 · 자동 탐지 대기".into();
                }
            } else {
                g.last_payload = None;
                g.send_status = if g.running {
                    "첫 응답 대기 · 정상 전송 보류"
                } else {
                    "감시 정지 · 상태 전송 중단"
                }
                .into();
            }
        }
        let _ = app.emit("snapshot", state.snapshot());
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_loopback_icmp_and_failure_threshold() {
        assert!(ping("127.0.0.1", 1000).is_some());
        let t = crate::settings::Target {
            name: "test".into(),
            address: "127.0.0.1".into(),
            enabled: true,
            kind: "pc".into(),
        };
        let a = record(None, 0, &t, None, 2);
        assert_eq!(a.status, "확인 중");
        let b = record(Some(&a), 0, &t, None, 2);
        assert_eq!(b.status, "장애");
        let c = record(Some(&b), 0, &t, Some(1), 2);
        assert_eq!(c.status, "성공");
        assert_eq!((c.sent, c.lost), (3, 2));
    }
    #[test]
    fn stopped_or_unmeasured_never_reports_healthy() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let state = AppState::new(crate::settings::Settings::default(), dir.clone()).unwrap();
        assert_eq!(alarm_state(&state.lock()), None);
        let mut g = state.lock();
        g.running = true;
        assert_eq!(alarm_state(&g), None);
        g.settings.targets.push(crate::settings::Target {
            name: "test".into(),
            address: "127.0.0.1".into(),
            enabled: true,
            kind: "pc".into(),
        });
        assert_eq!(alarm_state(&g), None);
        let r = record(None, 0, &g.settings.targets[0], Some(1), 1);
        g.results.insert(0, r);
        assert_eq!(alarm_state(&g), Some(false));
        g.running = false;
        assert_eq!(alarm_state(&g), None);
        drop(g);
        drop(state);
        std::fs::remove_dir(dir.join("ping-history")).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
