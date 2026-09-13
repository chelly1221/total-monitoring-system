#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    tms_ping_monitor_lib::run();
}
