//! UPS parameter tables and value rules carried over 1:1 from the original
//! 김포공항 제1레이더 UPS 감시 프로그램 (snmpups): RFC 1628 UPS-MIB OIDs, the display
//! scaling per parameter, status code maps, threshold checks and status-change logs.
//! Labels are the keys of the UDP `Data` object, so they must stay byte-identical.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const ABNORMAL_POLLS_BEFORE_ALARM: u32 = 5;
pub const NO_DATA: &str = "No Data";

/// One monitored parameter: display label, OID and (optional) threshold key.
#[derive(Clone, Copy, Debug)]
pub struct Param {
    pub label: &'static str,
    pub oid: &'static str,
    /// Key prefix of the min/max limits (`None` for status fields).
    pub limit: Option<&'static str>,
}

pub const UPS1_PARAMS: &[Param] = &[
    Param { label: "입력 전압 R (V)", oid: "1.3.6.1.2.1.33.1.3.3.1.3.1", limit: Some("input_voltage_R") },
    Param { label: "입력 전압 S (V)", oid: "1.3.6.1.2.1.33.1.3.3.1.3.2", limit: Some("input_voltage_S") },
    Param { label: "입력 전압 T (V)", oid: "1.3.6.1.2.1.33.1.3.3.1.3.3", limit: Some("input_voltage_T") },
    Param { label: "입력 전류 R (A)", oid: "1.3.6.1.2.1.33.1.3.3.1.4.1", limit: Some("input_current_R") },
    Param { label: "입력 전류 S (A)", oid: "1.3.6.1.2.1.33.1.3.3.1.4.2", limit: Some("input_current_S") },
    Param { label: "입력 전류 T (A)", oid: "1.3.6.1.2.1.33.1.3.3.1.4.3", limit: Some("input_current_T") },
    Param { label: "입력 전력 R (kW)", oid: "1.3.6.1.2.1.33.1.3.3.1.5.1", limit: Some("input_power_R") },
    Param { label: "입력 전력 S (kW)", oid: "1.3.6.1.2.1.33.1.3.3.1.5.2", limit: Some("input_power_S") },
    Param { label: "입력 전력 T (kW)", oid: "1.3.6.1.2.1.33.1.3.3.1.5.3", limit: Some("input_power_T") },
    Param { label: "입력 주파수 (Hz)", oid: "1.3.6.1.2.1.33.1.2.3.0", limit: Some("input_freq") },
    Param { label: "출력 상태", oid: "1.3.6.1.2.1.33.1.4.1.0", limit: None },
    Param { label: "출력 전압 R (V)", oid: "1.3.6.1.2.1.33.1.4.4.1.2.1", limit: Some("voltage_R") },
    Param { label: "출력 전압 S (V)", oid: "1.3.6.1.2.1.33.1.4.4.1.2.2", limit: Some("voltage_S") },
    Param { label: "출력 전압 T (V)", oid: "1.3.6.1.2.1.33.1.4.4.1.2.3", limit: Some("voltage_T") },
    Param { label: "출력 전류 R (A)", oid: "1.3.6.1.2.1.33.1.4.4.1.3.1", limit: Some("current_R") },
    Param { label: "출력 전류 S (A)", oid: "1.3.6.1.2.1.33.1.4.4.1.3.2", limit: Some("current_S") },
    Param { label: "출력 전류 T (A)", oid: "1.3.6.1.2.1.33.1.4.4.1.3.3", limit: Some("current_T") },
    Param { label: "출력 주파수(Hz)", oid: "1.3.6.1.2.1.33.1.4.2.0", limit: Some("frequency") },
    Param { label: "출력 R (%)", oid: "1.3.6.1.2.1.33.1.4.4.1.5.1", limit: Some("output_R") },
    Param { label: "출력 S (%)", oid: "1.3.6.1.2.1.33.1.4.4.1.5.2", limit: Some("output_S") },
    Param { label: "출력 T (%)", oid: "1.3.6.1.2.1.33.1.4.4.1.5.3", limit: Some("output_T") },
    Param { label: "배터리 상태", oid: "1.3.6.1.2.1.33.1.2.1.0", limit: None },
    Param { label: "배터리 전압(V)", oid: "1.3.6.1.2.1.33.1.2.5.0", limit: Some("voltage") },
    Param { label: "배터리 잔량(%)", oid: "1.3.6.1.2.1.33.1.2.4.0", limit: Some("battery") },
];

pub const UPS2_PARAMS: &[Param] = &[
    Param { label: "출력 상태", oid: "1.3.6.1.2.1.33.1.4.1.0", limit: None },
    Param { label: "입력 전압 (V)", oid: "1.3.6.1.2.1.33.1.3.3.1.3.1", limit: Some("ups2_input_voltage") },
    Param { label: "출력 전압 (V)", oid: "1.3.6.1.2.1.33.1.4.4.1.2.1", limit: Some("ups2_output_voltage") },
    Param { label: "입력 주파수 (Hz)", oid: "1.3.6.1.2.1.33.1.3.3.1.2.1", limit: Some("ups2_input_freq") },
    Param { label: "출력 주파수 (Hz)", oid: "1.3.6.1.2.1.33.1.4.2.0", limit: Some("ups2_output_freq") },
    Param { label: "배터리 상태", oid: "1.3.6.1.2.1.33.1.2.1.0", limit: None },
    Param { label: "배터리 전압 (V)", oid: "1.3.6.1.2.1.33.1.2.5.0", limit: Some("ups2_battery_voltage") },
    Param { label: "배터리 잔량 (%)", oid: "1.3.6.1.2.1.33.1.2.4.0", limit: Some("ups2_battery_capacity") },
    Param { label: "배터리 온도 (°C)", oid: "1.3.6.1.2.1.33.1.2.7.0", limit: Some("ups2_temp") },
];

pub fn params(ups: u8) -> &'static [Param] {
    if ups == 1 { UPS1_PARAMS } else { UPS2_PARAMS }
}

/// Default min/max per limit key: the values of the operating settings.json /
/// ups2_settings.json of the 제1레이더 PC (2026-09-18), which differ from the program
/// defaults for 배터리 전압 (UPS#1 500 V, UPS#2 290 V) and the UPS#2 voltages (450 V).
pub fn default_limits(ups: u8) -> BTreeMap<String, Limit> {
    let rows: &[(&str, f64, f64)] = if ups == 1 {
        &[
            ("input_voltage_R", 300.0, 700.0), ("input_voltage_S", 300.0, 700.0), ("input_voltage_T", 300.0, 700.0),
            ("input_current_R", 0.0, 50.0), ("input_current_S", 0.0, 50.0), ("input_current_T", 0.0, 50.0),
            ("input_power_R", 0.0, 100.0), ("input_power_S", 0.0, 100.0), ("input_power_T", 0.0, 100.0),
            ("input_freq", 50.0, 70.0),
            ("voltage_R", 200.0, 250.0), ("voltage_S", 200.0, 250.0), ("voltage_T", 200.0, 250.0),
            ("current_R", 0.0, 50.0), ("current_S", 0.0, 50.0), ("current_T", 0.0, 50.0),
            ("frequency", 50.0, 70.0),
            ("output_R", 0.0, 100.0), ("output_S", 0.0, 100.0), ("output_T", 0.0, 100.0),
            ("voltage", 200.0, 500.0), ("battery", 0.0, 100.0),
        ]
    } else {
        &[
            ("ups2_input_voltage", 180.0, 450.0), ("ups2_output_voltage", 180.0, 450.0),
            ("ups2_input_freq", 50.0, 70.0), ("ups2_output_freq", 50.0, 70.0),
            ("ups2_battery_voltage", 0.0, 290.0), ("ups2_battery_capacity", 0.0, 100.0),
            ("ups2_temp", 0.0, 60.0),
        ]
    };
    rows.iter().map(|(k, min, max)| (k.to_string(), Limit { min: *min, max: *max })).collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Limit {
    pub min: f64,
    pub max: f64,
}

pub fn battery_status(code: &str) -> Option<&'static str> {
    Some(match code {
        "1" => "알 수 없음",
        "2" => "정상",
        "3" => "배터리 부족",
        "4" => "배터리 소진",
        _ => return None,
    })
}

pub fn output_status(code: &str) -> Option<&'static str> {
    Some(match code {
        "1" => "기타",
        "2" => "없음",
        "3" => "정상",
        "4" => "바이패스",
        "5" => "배터리",
        "6" => "부스터",
        "7" => "리듀서",
        _ => return None,
    })
}

/// Format a raw SNMP integer string for display, with the exact scaling rules of the
/// original `format_snmp_value` (see the rule list in the snmpups README).
pub fn format_value(label: &str, raw: Option<&str>, ups: u8) -> String {
    let Some(raw) = raw else { return NO_DATA.into() };
    if raw == NO_DATA {
        return NO_DATA.into();
    }
    if label == "출력 상태" || label == "출력상태" {
        return output_status(raw).map(str::to_string).unwrap_or_else(|| format!("알 수 없음 ({raw})"));
    }
    if label == "배터리 상태" || label == "배터리상태" {
        return battery_status(raw).map(str::to_string).unwrap_or_else(|| format!("알 수 없음 ({raw})"));
    }
    if label.contains("°C") {
        return format!("{raw}°C");
    }
    let Ok(parsed) = raw.trim().parse::<f64>() else { return NO_DATA.into() };
    if !parsed.is_finite() {
        return NO_DATA.into();
    }
    if label == "배터리 전압 (V)" && ups == 2 {
        return format!("{:.2} V", parsed / 100.0);
    }
    if label.contains("Hz") {
        if label == "입력 주파수 (Hz)" && ups == 1 {
            return format!("{:.0} Hz", parsed);
        }
        return format!("{:.1} Hz", parsed / 10.0);
    }
    if label.contains("kW") {
        return format!("{:.1} kW", parsed / 1000.0);
    }
    if label.contains('V') {
        if label.contains("출력 전압") || label.contains("입력 전압") {
            return format!("{:.0} V", parsed);
        }
        return format!("{:.0} V", parsed / 10.0);
    }
    if label.contains("(A)") {
        return format!("{:.1} A", parsed / 10.0);
    }
    if label.contains('%') {
        return format!("{:.1} %", parsed);
    }
    raw.to_string()
}

/// Numeric part of a formatted value ("374 V" -> 374), as the threshold check reads it.
pub fn numeric(formatted: &str) -> Option<f64> {
    let head = formatted.split(' ').next()?;
    let head = head.trim_end_matches("°C");
    head.parse::<f64>().ok().filter(|v| v.is_finite())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Low,
    High,
    Normal,
}

/// Compare a value with its limits. Returns the new level and a log line when the level
/// changed in a way the original program reported (low/high on entry, normal on recovery).
pub fn check_limit(
    label: &str,
    value: f64,
    limit: Option<&Limit>,
    previous: Option<Level>,
) -> (Option<Level>, Option<String>) {
    let Some(limit) = limit else { return (previous, None) };
    if value < limit.min {
        if previous != Some(Level::Low) {
            return (Some(Level::Low), Some(format!("⚠️ {label} 낮음 ({} < {})", trim(value), trim(limit.min))));
        }
    } else if value > limit.max {
        if previous != Some(Level::High) {
            return (Some(Level::High), Some(format!("⚠️ {label} 높음 ({} > {})", trim(value), trim(limit.max))));
        }
    } else if matches!(previous, Some(Level::Low) | Some(Level::High)) {
        return (Some(Level::Normal), Some(format!("✅ {label} 정상: {}", trim(value))));
    }
    (previous, None)
}

fn trim(v: f64) -> String {
    if v.fract() == 0.0 { format!("{v:.0}") } else { v.to_string() }
}

pub const ABNORMAL_OUTPUT: &[&str] = &["배터리", "바이패스", "부스터", "리듀서", "기타", "없음"];
pub const ABNORMAL_BATTERY: &[&str] = &["배터리 부족", "배터리 소진", "알 수 없음"];

/// True when either status text reads as a fault (the original alarm rule).
pub fn is_abnormal(output: Option<&str>, battery: Option<&str>) -> bool {
    output.is_some_and(|s| ABNORMAL_OUTPUT.iter().any(|a| s.contains(a)))
        || battery.is_some_and(|s| ABNORMAL_BATTERY.iter().any(|a| s.contains(a)))
}

pub fn status_is_good(value: &str) -> bool {
    value == "정상" || value == "온라인"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formatting_matches_the_original_rules() {
        assert_eq!(format_value("입력 전압 R (V)", Some("374"), 1), "374 V");
        assert_eq!(format_value("배터리 전압(V)", Some("2304"), 1), "230 V");
        assert_eq!(format_value("배터리 전압 (V)", Some("1234"), 2), "12.34 V");
        assert_eq!(format_value("입력 주파수 (Hz)", Some("60"), 1), "60 Hz");
        assert_eq!(format_value("입력 주파수 (Hz)", Some("599"), 2), "59.9 Hz");
        assert_eq!(format_value("출력 주파수(Hz)", Some("600"), 1), "60.0 Hz");
        assert_eq!(format_value("입력 전력 R (kW)", Some("12345"), 1), "12.3 kW");
        assert_eq!(format_value("입력 전류 R (A)", Some("123"), 1), "12.3 A");
        assert_eq!(format_value("출력 R (%)", Some("45"), 1), "45.0 %");
        assert_eq!(format_value("배터리 온도 (°C)", Some("31"), 2), "31°C");
        assert_eq!(format_value("출력 상태", Some("3"), 1), "정상");
        assert_eq!(format_value("출력 상태", Some("5"), 1), "배터리");
        assert_eq!(format_value("출력 상태", Some("9"), 1), "알 수 없음 (9)");
        assert_eq!(format_value("배터리 상태", Some("4"), 2), "배터리 소진");
        assert_eq!(format_value("입력 전압 R (V)", None, 1), NO_DATA);
        assert_eq!(format_value("입력 전압 R (V)", Some("abc"), 1), NO_DATA);
        assert_eq!(numeric("12.34 V"), Some(12.34));
        assert_eq!(numeric("31°C"), Some(31.0));
        assert_eq!(numeric(NO_DATA), None);
    }

    #[test]
    fn limits_log_only_on_level_changes() {
        let limit = Limit { min: 200.0, max: 250.0 };
        let (level, log) = check_limit("출력 전압 R (V)", 190.0, Some(&limit), None);
        assert_eq!(level, Some(Level::Low));
        assert_eq!(log.as_deref(), Some("⚠️ 출력 전압 R (V) 낮음 (190 < 200)"));
        let (level, log) = check_limit("출력 전압 R (V)", 185.0, Some(&limit), level);
        assert_eq!((level, log), (Some(Level::Low), None));
        let (level, log) = check_limit("출력 전압 R (V)", 260.0, Some(&limit), level);
        assert_eq!(level, Some(Level::High));
        assert!(log.unwrap().contains("높음 (260 > 250)"));
        let (level, log) = check_limit("출력 전압 R (V)", 230.0, Some(&limit), level);
        assert_eq!(level, Some(Level::Normal));
        assert_eq!(log.as_deref(), Some("✅ 출력 전압 R (V) 정상: 230"));
        let (level, log) = check_limit("출력 전압 R (V)", 231.0, Some(&limit), level);
        assert_eq!((level, log), (Some(Level::Normal), None));
        assert_eq!(check_limit("x", 1.0, None, None), (None, None));
    }

    #[test]
    fn alarm_rule_and_tables() {
        assert!(is_abnormal(Some("배터리"), Some("정상")));
        assert!(is_abnormal(Some("정상"), Some("배터리 부족")));
        // "알 수 없음" contains "없음", so an unknown output code counts as abnormal (as before).
        assert!(is_abnormal(Some("알 수 없음 (9)"), None));
        assert!(is_abnormal(None, Some("알 수 없음 (9)")));
        assert!(!is_abnormal(Some("정상"), Some("정상")));
        assert!(!is_abnormal(Some(NO_DATA), Some(NO_DATA)));
        assert_eq!(UPS1_PARAMS.len(), 24);
        assert_eq!(UPS2_PARAMS.len(), 9);
        for ups in [1u8, 2u8] {
            let limits = default_limits(ups);
            for p in params(ups) {
                crate::snmp::parse_oid(p.oid).unwrap();
                if let Some(key) = p.limit {
                    assert!(limits.contains_key(key), "{key} has defaults");
                }
            }
            assert_eq!(limits.len(), params(ups).iter().filter(|p| p.limit.is_some()).count());
        }
    }
}
