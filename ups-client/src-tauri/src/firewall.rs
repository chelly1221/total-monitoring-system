//! Registers the inbound UDP firewall rule for the discovery port via `netsh`,
//! elevating once through PowerShell `Start-Process -Verb RunAs` when it is missing.

use std::os::windows::process::CommandExt;
use std::process::Command;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const RULE_NAME: &str = "TMS UPS Monitor Discovery";

/// True when a rule with our name exists and mentions `port` on a "LocalPort" style line.
fn rule_exists(port: u16) -> bool {
    let out = Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "show",
            "rule",
            &format!("name={RULE_NAME}"),
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let Ok(out) = out else { return false };
    if !out.status.success() {
        return false;
    }
    // Labels are localized (e.g. Korean) so only match the value part of "<label>: <port>".
    let text = String::from_utf8_lossy(&out.stdout);
    let port_str = port.to_string();
    text.lines().any(|line| {
        line.rsplit_once(':')
            .map(|(_, v)| v.trim() == port_str)
            .unwrap_or(false)
    })
}

/// Ensure the inbound UDP rule for `port` exists. Blocks while the UAC prompt is open.
pub fn ensure_rule(port: u16) {
    if rule_exists(port) {
        log::info!("firewall rule present for UDP {port}");
        return;
    }
    log::info!("adding firewall rule '{RULE_NAME}' for UDP {port} (elevation prompt)");
    let netsh_args = format!(
        "advfirewall firewall add rule name=\"{RULE_NAME}\" dir=in action=allow protocol=UDP localport={port}"
    );
    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Start-Process netsh -ArgumentList '{netsh_args}' -Verb RunAs -WindowStyle Hidden -Wait"
            ),
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
    match status {
        Ok(s) if s.success() => log::info!("firewall rule added"),
        Ok(_) => log::warn!("firewall rule skipped (user declined elevation)"),
        Err(e) => log::warn!("firewall rule error: {e}"),
    }
}
