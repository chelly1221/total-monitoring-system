//! Polling loop per UPS card: SNMP GET → format → limits/status logs → alarm counter →
//! UDP report to the TMS server, repeated every `interval_sec`. Mirrors the original
//! `pollUps` flow (snmpups `src/main/snmp.ts`) including the 5-poll alarm debounce.

use crate::state::{now_ms, push_log, AppState, UnitState};
use crate::ups::{self, Level, ABNORMAL_POLLS_BEFORE_ALARM, NO_DATA};
use serde_json::{json, Map, Value};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Repeat period of the alarm sound while a unit stays in alarm (original: 4 s).
const ALARM_REPEAT: Duration = Duration::from_secs(4);

/// One UPS unit's loop (`unit` is 1-based).
pub async fn run_unit(app: AppHandle, state: AppState, unit: u8) {
    let index = (unit - 1) as usize;
    let oids: Vec<Vec<u32>> = ups::params(unit).iter().map(|p| crate::snmp::parse_oid(p.oid).expect("static OID")).collect();
    let mut generation: Option<u64> = None;
    loop {
        let (running, gen, cfg) = {
            let g = state.lock();
            (g.running, g.generation, g.settings.unit(unit).clone())
        };
        if !running {
            {
                let mut g = state.lock();
                let u = &mut g.units[index];
                if u.poll_status != "감시 정지" {
                    u.poll_status = "감시 정지".into();
                    u.reachable = None;
                    u.abnormal_count = 0;
                    u.alarm_active = false;
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
            continue;
        }
        if generation != Some(gen) {
            // Address/period changed (or first start): forget stale readings and counters.
            generation = Some(gen);
            let mut g = state.lock();
            let u = &mut g.units[index];
            u.reachable = None;
            u.abnormal_count = 0;
            u.alarm_active = false;
            u.levels.clear();
            u.prev_status.clear();
            u.poll_status = format!("{} 조회 중", cfg.ip);
        }
        let start = Instant::now();
        let result = crate::snmp::get(&cfg.ip, &cfg.community, &oids).await;
        let (payload, current) = {
            let mut g = state.lock();
            if g.generation != gen || !g.running {
                continue;
            }
            // Server binding and limits may have been provisioned during the poll.
            let current = g.settings.unit(unit).clone();
            let u = &mut g.units[index];
            (apply_poll(u, unit, &current, result.as_ref().map_err(|e| e.as_str())), current)
        };
        if let Some(payload) = payload {
            send_report(&state, index, &current, &payload);
        }
        let _ = app.emit("snapshot", state.snapshot());
        // Sleep the configured period, waking early on stop or settings changes.
        let period = Duration::from_secs(cfg.interval_sec.max(1));
        while start.elapsed() < period {
            let (running, g2) = {
                let g = state.lock();
                (g.running, g.generation)
            };
            if !running || g2 != gen {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

/// Fold one poll result into the unit state. Returns the UDP payload to forward, if any.
pub fn apply_poll(u: &mut UnitState, unit: u8, cfg: &crate::settings::Unit, result: Result<&std::collections::HashMap<String, crate::snmp::Value>, &str>) -> Option<String> {
    let params = ups::params(unit);
    let mut data: Vec<(String, String)> = Vec::with_capacity(params.len());
    match result {
        Ok(map) => {
            for p in params {
                let raw = map.get(p.oid).and_then(|v| v.as_text());
                data.push((p.label.to_string(), ups::format_value(p.label, raw.as_deref(), unit)));
            }
            if u.reachable != Some(true) {
                push_log(u, "info", format!("✅ SNMP 응답 수신 ({})", cfg.ip));
            }
            u.reachable = Some(true);
            u.poll_status = format!("{} 수신 중", cfg.ip);
        }
        Err(e) => {
            for p in params {
                data.push((p.label.to_string(), NO_DATA.to_string()));
            }
            if u.reachable != Some(false) {
                push_log(u, "warn", format!("⚠️ SNMP 응답 없음 ({}): {e}", cfg.ip));
            }
            u.reachable = Some(false);
            u.poll_status = format!("{} 응답 없음", cfg.ip);
        }
    }
    u.last_poll_at = Some(now_ms());

    // Threshold checks (numeric parameters only; "No Data" is skipped like the original).
    for p in params.iter().filter(|p| p.limit.is_some()) {
        let Some((_, formatted)) = data.iter().find(|(l, _)| l == p.label) else { continue };
        let Some(value) = ups::numeric(formatted) else { continue };
        let limit = p.limit.and_then(|k| cfg.limits.get(k));
        let previous = u.levels.get(p.label).copied();
        let (level, log) = ups::check_limit(p.label, value, limit, previous);
        if let Some(level) = level {
            u.levels.insert(p.label.to_string(), level);
        }
        if let Some(message) = log {
            let is_warn = matches!(level, Some(Level::Low) | Some(Level::High));
            push_log(u, if is_warn { "warn" } else { "info" }, message);
        }
    }

    // Status change detection for 출력 상태 / 배터리 상태.
    for key in ["출력 상태", "배터리 상태"] {
        let current = data.iter().find(|(l, _)| l == key).map(|(_, v)| v.clone()).unwrap_or_else(|| NO_DATA.into());
        if u.prev_status.get(key) != Some(&current) {
            let good = ups::status_is_good(&current);
            push_log(u, if good { "info" } else { "warn" }, format!("{} {key}: {current}", if good { "✅" } else { "⚠️" }));
            u.prev_status.insert(key.to_string(), current);
        }
    }

    // Alarm after ABNORMAL_POLLS_BEFORE_ALARM consecutive abnormal polls.
    let output = data.iter().find(|(l, _)| l == "출력 상태").map(|(_, v)| v.as_str());
    let battery = data.iter().find(|(l, _)| l == "배터리 상태").map(|(_, v)| v.as_str());
    if ups::is_abnormal(output, battery) {
        u.abnormal_count = u.abnormal_count.saturating_add(1);
    } else {
        u.abnormal_count = 0;
    }
    let alarm = u.abnormal_count >= ABNORMAL_POLLS_BEFORE_ALARM;
    if alarm != u.alarm_active {
        push_log(u, if alarm { "warn" } else { "info" }, if alarm { "🔔 UPS 경보 발생".into() } else { "🔕 UPS 경보 해제".into() });
        u.alarm_active = alarm;
        u.last_alarm_sound = None;
    }
    u.data = data;

    // Same wire format as the original program: {"UPS": n, "Data": {label: formatted}}.
    let mut object = Map::new();
    for (label, value) in &u.data {
        object.insert(label.clone(), Value::String(value.clone()));
    }
    Some(json!({"UPS": unit, "Data": Value::Object(object)}).to_string())
}

fn send_report(state: &AppState, index: usize, cfg: &crate::settings::Unit, payload: &str) {
    if !cfg.server_enabled {
        let mut g = state.lock();
        g.units[index].send_status = "서버 미연결 · 자동 탐지 대기".into();
        return;
    }
    let result = std::net::UdpSocket::bind("0.0.0.0:0").and_then(|s| {
        s.set_write_timeout(Some(Duration::from_millis(100)))?;
        s.send_to(payload.as_bytes(), (cfg.server_ip.as_str(), cfg.server_port))
    });
    let mut g = state.lock();
    let u = &mut g.units[index];
    match result {
        Ok(_) => {
            u.last_sent_at = Some(now_ms());
            u.send_status = "데이터 전송 중".into();
        }
        Err(e) => u.send_status = format!("UDP 전송 실패: {e}"),
    }
}

/// Plays each alarming unit's sound every ALARM_REPEAT and pushes a snapshot once a second
/// so the clock, connection dots and transfer chip stay fresh between polls.
pub async fn alarm_loop(app: AppHandle, state: AppState) {
    let mut last_snapshot = Instant::now();
    loop {
        {
            let mut g = state.lock();
            let sound_enabled = g.settings.sound_enabled && g.running;
            let crate::state::Inner { settings, units, .. } = &mut *g;
            for (i, u) in units.iter_mut().enumerate() {
                let cfg = &settings.units[i];
                if !u.alarm_active || !sound_enabled || cfg.muted {
                    continue;
                }
                if u.last_alarm_sound.map(|t| t.elapsed() >= ALARM_REPEAT).unwrap_or(true) {
                    if let Err(e) = crate::play_sound(&cfg.sound_file, i as u8 + 1) {
                        u.send_status = e;
                    }
                    u.last_alarm_sound = Some(Instant::now());
                }
            }
        }
        if last_snapshot.elapsed() >= Duration::from_secs(1) {
            let _ = app.emit("snapshot", state.snapshot());
            last_snapshot = Instant::now();
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snmp::Value as SnmpValue;
    use std::collections::HashMap;

    fn reply(values: &[(&str, i64)]) -> HashMap<String, SnmpValue> {
        values.iter().map(|(oid, v)| (oid.to_string(), SnmpValue::Int(*v))).collect()
    }

    fn healthy_ups2() -> HashMap<String, SnmpValue> {
        reply(&[
            ("1.3.6.1.2.1.33.1.4.1.0", 3),
            ("1.3.6.1.2.1.33.1.3.3.1.3.1", 220),
            ("1.3.6.1.2.1.33.1.4.4.1.2.1", 221),
            ("1.3.6.1.2.1.33.1.3.3.1.2.1", 600),
            ("1.3.6.1.2.1.33.1.4.2.0", 600),
            ("1.3.6.1.2.1.33.1.2.1.0", 2),
            ("1.3.6.1.2.1.33.1.2.5.0", 1350),
            ("1.3.6.1.2.1.33.1.2.4.0", 100),
            ("1.3.6.1.2.1.33.1.2.7.0", 28),
        ])
    }

    #[test]
    fn poll_formats_logs_and_builds_the_udp_payload() {
        let cfg = crate::settings::Unit::defaults(2);
        let mut u = UnitState::default();
        let payload = apply_poll(&mut u, 2, &cfg, Ok(&healthy_ups2())).unwrap();
        let v: Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(v["UPS"], 2);
        assert_eq!(v["Data"]["출력 상태"], "정상");
        assert_eq!(v["Data"]["배터리 전압 (V)"], "13.50 V");
        assert_eq!(v["Data"]["입력 주파수 (Hz)"], "60.0 Hz");
        assert_eq!(v["Data"]["배터리 온도 (°C)"], "28°C");
        assert_eq!(u.data.len(), 9);
        assert_eq!(u.reachable, Some(true));
        assert!(!u.alarm_active);
        let messages: Vec<&str> = u.logs.iter().map(|l| l.message.as_str()).collect();
        assert!(messages.iter().any(|m| m.contains("SNMP 응답 수신")));
        assert!(messages.contains(&"✅ 출력 상태: 정상"));
        assert!(messages.contains(&"✅ 배터리 상태: 정상"));
        assert!(u.levels.is_empty(), "everything within range leaves no level marks");

        // Second identical poll logs nothing new.
        let before = u.logs.len();
        apply_poll(&mut u, 2, &cfg, Ok(&healthy_ups2()));
        assert_eq!(u.logs.len(), before);
    }

    #[test]
    fn thresholds_and_status_changes_are_reported_once() {
        let cfg = crate::settings::Unit::defaults(2);
        let mut u = UnitState::default();
        apply_poll(&mut u, 2, &cfg, Ok(&healthy_ups2()));
        let mut low = healthy_ups2();
        low.insert("1.3.6.1.2.1.33.1.3.3.1.3.1".into(), SnmpValue::Int(150));
        apply_poll(&mut u, 2, &cfg, Ok(&low));
        assert_eq!(u.levels["입력 전압 (V)"], Level::Low);
        assert!(u.logs.last().unwrap().message.contains("입력 전압 (V) 낮음 (150 < 180)"));
        let n = u.logs.len();
        apply_poll(&mut u, 2, &cfg, Ok(&low));
        assert_eq!(u.logs.len(), n, "no repeat while still low");
        apply_poll(&mut u, 2, &cfg, Ok(&healthy_ups2()));
        assert_eq!(u.levels["입력 전압 (V)"], Level::Normal);
        assert!(u.logs.last().unwrap().message.contains("입력 전압 (V) 정상: 220"));
    }

    #[test]
    fn alarm_needs_five_consecutive_abnormal_polls_and_clears() {
        let cfg = crate::settings::Unit::defaults(2);
        let mut u = UnitState::default();
        let mut on_battery = healthy_ups2();
        on_battery.insert("1.3.6.1.2.1.33.1.4.1.0".into(), SnmpValue::Int(5));
        for i in 1..=4 {
            apply_poll(&mut u, 2, &cfg, Ok(&on_battery));
            assert!(!u.alarm_active, "poll {i}");
        }
        apply_poll(&mut u, 2, &cfg, Ok(&on_battery));
        assert!(u.alarm_active);
        assert_eq!(u.data.iter().find(|(l, _)| l == "출력 상태").unwrap().1, "배터리");
        assert!(u.logs.iter().any(|l| l.message == "⚠️ 출력 상태: 배터리"));
        assert!(u.logs.last().unwrap().message.contains("경보 발생"));
        apply_poll(&mut u, 2, &cfg, Ok(&healthy_ups2()));
        assert!(!u.alarm_active);
        assert_eq!(u.abnormal_count, 0);
    }

    #[test]
    fn transport_errors_show_no_data_and_log_once() {
        let cfg = crate::settings::Unit::defaults(1);
        let mut u = UnitState::default();
        let payload = apply_poll(&mut u, 1, &cfg, Err("응답 시간 초과")).unwrap();
        assert!(payload.contains("\"No Data\""));
        assert_eq!(u.data.len(), 24);
        assert!(u.data.iter().all(|(_, v)| v == NO_DATA));
        assert_eq!(u.reachable, Some(false));
        assert!(u.logs.iter().any(|l| l.message.contains("SNMP 응답 없음")));
        // "No Data" statuses count as abnormal only through the status maps, which they miss.
        assert_eq!(u.abnormal_count, 0);
        let n = u.logs.len();
        apply_poll(&mut u, 1, &cfg, Err("응답 시간 초과"));
        assert_eq!(u.logs.len(), n);
    }
}
