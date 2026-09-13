//! Npcap is optional and loaded only from the Windows system directory.
//! No bundled driver, Node runtime or native Node addon is required.
use crate::state::AppState;
use libloading::Library;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::ffi::{c_char, c_int, c_uchar, c_void, CStr, CString};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[repr(C)]
struct Device {
    next: *mut Device,
    name: *mut c_char,
    description: *mut c_char,
    addresses: *mut Address,
    flags: u32,
}
#[repr(C)]
struct Address {
    next: *mut Address,
    addr: *mut u8,
    netmask: *mut u8,
    broadaddr: *mut u8,
    dstaddr: *mut u8,
}
#[repr(C)]
struct Header {
    sec: i32,
    usec: i32,
    caplen: u32,
    len: u32,
}

type Find = unsafe extern "C" fn(*mut *mut Device, *mut c_char) -> c_int;
type Free = unsafe extern "C" fn(*mut Device);
type Open = unsafe extern "C" fn(*const c_char, c_int, c_int, c_int, *mut c_char) -> *mut c_void;
type Close = unsafe extern "C" fn(*mut c_void);
type Next = unsafe extern "C" fn(*mut c_void, *mut *const Header, *mut *const c_uchar) -> c_int;
type Nonblock = unsafe extern "C" fn(*mut c_void, c_int, *mut c_char) -> c_int;
type Datalink = unsafe extern "C" fn(*mut c_void) -> c_int;

struct Api {
    _lib: Library,
    find: Find,
    free: Free,
    open: Open,
    close: Close,
    next: Next,
    nonblock: Nonblock,
    datalink: Datalink,
}

impl Api {
    fn load() -> Result<Self, String> {
        let path = std::path::PathBuf::from(
            std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
        )
        .join("System32/Npcap/wpcap.dll");
        unsafe {
            let lib: Library =
                libloading::os::windows::Library::load_with_flags(path, 0x100 | 0x1000)
                    .map_err(|_| "Npcap 미설치 · ping 감시는 사용할 수 있습니다".to_string())?
                    .into();
            Ok(Self {
                find: *lib.get(b"pcap_findalldevs\0").map_err(|e| e.to_string())?,
                free: *lib.get(b"pcap_freealldevs\0").map_err(|e| e.to_string())?,
                open: *lib.get(b"pcap_open_live\0").map_err(|e| e.to_string())?,
                close: *lib.get(b"pcap_close\0").map_err(|e| e.to_string())?,
                next: *lib.get(b"pcap_next_ex\0").map_err(|e| e.to_string())?,
                nonblock: *lib.get(b"pcap_setnonblock\0").map_err(|e| e.to_string())?,
                datalink: *lib.get(b"pcap_datalink\0").map_err(|e| e.to_string())?,
                _lib: lib,
            })
        }
    }
    fn devices(&self) -> Result<Vec<Value>, String> {
        let mut head = std::ptr::null_mut();
        let mut error = [0i8; 256];
        let mut out = vec![];
        unsafe {
            if (self.find)(&mut head, error.as_mut_ptr()) != 0 {
                return Err(CStr::from_ptr(error.as_ptr())
                    .to_string_lossy()
                    .into_owned());
            }
            let mut current = head;
            while !current.is_null() {
                let dev = &*current;
                let mut addresses = vec![];
                let mut addr = dev.addresses;
                while !addr.is_null() {
                    let p = (*addr).addr;
                    if !p.is_null() && std::ptr::read_unaligned(p as *const u16) == 2 {
                        addresses.push(format!(
                            "{}.{}.{}.{}",
                            *p.add(4),
                            *p.add(5),
                            *p.add(6),
                            *p.add(7)
                        ));
                    }
                    addr = (*addr).next;
                }
                if !dev.name.is_null() && !addresses.is_empty() {
                    let description = if dev.description.is_null() {
                        String::new()
                    } else {
                        CStr::from_ptr(dev.description)
                            .to_string_lossy()
                            .into_owned()
                    };
                    out.push(json!({"name":CStr::from_ptr(dev.name).to_string_lossy(),"description":description,"addresses":addresses}));
                }
                current = dev.next;
            }
            (self.free)(head);
        }
        Ok(out)
    }
}

pub fn interfaces() -> Result<Value, String> {
    Api::load()?.devices().map(|v| json!(v))
}

#[derive(Debug)]
struct Packet {
    src: String,
    dst: String,
    len: usize,
    protocol: &'static str,
    cats: Vec<(u8, usize)>,
}

fn asterix(bytes: &[u8]) -> Vec<(u8, usize)> {
    const CATS: &[u8] = &[
        1, 2, 4, 8, 10, 11, 19, 20, 21, 23, 30, 34, 48, 62, 63, 65, 240, 247,
    ];
    let mut cats = vec![];
    let mut pos = 0;
    while pos + 3 <= bytes.len() {
        let len = u16::from_be_bytes([bytes[pos + 1], bytes[pos + 2]]) as usize;
        if len < 3 || pos + len > bytes.len() || !CATS.contains(&bytes[pos]) {
            return vec![];
        }
        cats.push((bytes[pos], len));
        pos += len;
    }
    if pos == bytes.len() {
        cats
    } else {
        vec![]
    }
}

fn decode(bytes: &[u8]) -> Option<Packet> {
    if bytes.len() < 14 {
        return None;
    }
    let mut offset = 14;
    let mut ether_type = u16::from_be_bytes([bytes[12], bytes[13]]);
    while ether_type == 0x8100 || ether_type == 0x88a8 {
        if bytes.len() < offset + 4 {
            return None;
        }
        ether_type = u16::from_be_bytes([bytes[offset + 2], bytes[offset + 3]]);
        offset += 4;
    }
    if ether_type != 0x0800 || bytes.len() < offset + 20 {
        return None;
    }
    let ip = &bytes[offset..];
    let header_len = usize::from(ip[0] & 15) * 4;
    let len = u16::from_be_bytes([ip[2], ip[3]]) as usize;
    if ip[0] >> 4 != 4 || header_len < 20 || len < header_len || ip.len() < len {
        return None;
    }
    let addr = |i| format!("{}.{}.{}.{}", ip[i], ip[i + 1], ip[i + 2], ip[i + 3]);
    let protocol = match ip[9] {
        1 => "ICMP",
        6 => "TCP",
        17 => "UDP",
        _ => "기타",
    };
    let mut cats = vec![];
    // Fragmented UDP is not a complete ASTERIX payload.
    if ip[9] == 17 && u16::from_be_bytes([ip[6], ip[7]]) & 0x3fff == 0 && len >= header_len + 8 {
        let udp_len = u16::from_be_bytes([ip[header_len + 4], ip[header_len + 5]]) as usize;
        if udp_len >= 8 && header_len + udp_len <= len {
            cats = asterix(&ip[header_len + 8..header_len + udp_len]);
        }
    }
    Some(Packet {
        src: addr(12),
        dst: addr(16),
        len,
        protocol,
        cats,
    })
}

#[derive(Default)]
struct Stats {
    flows: BTreeMap<String, Value>,
    asterix: BTreeMap<String, Value>,
    bytes: u64,
    packets: u64,
}

impl Stats {
    fn add(&mut self, p: Packet) {
        self.bytes += p.len as u64;
        self.packets += 1;
        let key = format!("{}>{}", p.src, p.dst);
        if self.flows.len() < 2000 || self.flows.contains_key(&key) {
            let flow = self.flows.entry(key.clone()).or_insert_with(
                || json!({"src":p.src,"dst":p.dst,"bytes":0,"packets":0,"protocols":{}}),
            );
            flow["bytes"] = json!(flow["bytes"].as_u64().unwrap_or(0) + p.len as u64);
            flow["packets"] = json!(flow["packets"].as_u64().unwrap_or(0) + 1);
            flow["protocols"][p.protocol] =
                json!(flow["protocols"][p.protocol].as_u64().unwrap_or(0) + 1);
        }
        if !p.cats.is_empty() && (self.asterix.len() < 500 || self.asterix.contains_key(&key)) {
            let flow = self
                .asterix
                .entry(key)
                .or_insert_with(|| json!({"src":p.src,"dst":p.dst,"cats":{},"totalBytes":0}));
            for (cat, len) in p.cats {
                let cat = cat.to_string();
                let bytes = flow["cats"][&cat]["bytes"].as_u64().unwrap_or(0) + len as u64;
                let count = flow["cats"][&cat]["count"].as_u64().unwrap_or(0) + 1;
                flow["cats"][&cat] = json!({"bytes":bytes,"count":count});
                flow["totalBytes"] = json!(flow["totalBytes"].as_u64().unwrap_or(0) + len as u64);
            }
        }
    }
}

pub fn run(app: AppHandle, state: AppState) {
    loop {
        let (settings, generation, running) = {
            let g = state.lock();
            (g.settings.clone(), g.generation, g.running)
        };
        if !running || !settings.targets.iter().any(|t| t.enabled) {
            state.lock().capture_status = "캡처 대기".into();
            std::thread::sleep(Duration::from_millis(250));
            continue;
        }
        let api = match Api::load() {
            Ok(api) => api,
            Err(e) => {
                state.lock().capture_status = e;
                std::thread::sleep(Duration::from_secs(3));
                continue;
            }
        };
        let devices = match api.devices() {
            Ok(v) => v,
            Err(e) => {
                state.lock().capture_status = e;
                std::thread::sleep(Duration::from_secs(3));
                continue;
            }
        };
        let mut handles = vec![];
        let mut errors = vec![];
        for device in devices {
            let name = device["name"].as_str().unwrap_or_default();
            if !settings.capture_devices.is_empty()
                && !settings
                    .capture_devices
                    .iter()
                    .any(|d| d.enabled && d.name == name)
            {
                continue;
            }
            let Ok(name_c) = CString::new(name) else {
                continue;
            };
            let mut error = [0i8; 256];
            unsafe {
                let handle = (api.open)(name_c.as_ptr(), 65536, 1, 50, error.as_mut_ptr());
                if handle.is_null() {
                    errors.push(
                        CStr::from_ptr(error.as_ptr())
                            .to_string_lossy()
                            .into_owned(),
                    );
                    continue;
                }
                if (api.datalink)(handle) != 1 || (api.nonblock)(handle, 1, error.as_mut_ptr()) != 0
                {
                    errors.push("이더넷 캡처를 지원하지 않는 어댑터".into());
                    (api.close)(handle);
                    continue;
                }
                handles.push(handle);
            }
        }
        state.lock().capture_status = if errors.is_empty() {
            format!("캡처 어댑터 {}개", handles.len())
        } else {
            format!("캡처 {}개 · {}", handles.len(), errors.join(" / "))
        };
        let mut stats = Stats::default();
        let mut last = Instant::now();
        loop {
            if {
                let g = state.lock();
                !g.running || g.generation != generation
            } {
                break;
            }
            let mut failed = false;
            for &handle in &handles {
                for _ in 0..500 {
                    let mut header = std::ptr::null();
                    let mut data = std::ptr::null();
                    let rc = unsafe { (api.next)(handle, &mut header, &mut data) };
                    if rc < 0 {
                        state.lock().capture_status = "캡처 연결 중단 · 재연결 대기".into();
                        failed = true;
                        break;
                    }
                    if rc != 1 {
                        break;
                    }
                    unsafe {
                        if !header.is_null() && !data.is_null() && (*header).caplen <= 65536 {
                            if let Some(packet) =
                                decode(std::slice::from_raw_parts(data, (*header).caplen as usize))
                            {
                                stats.add(packet);
                            }
                        }
                    }
                }
            }
            if failed {
                break;
            }
            if last.elapsed() >= Duration::from_secs(1) {
                let _ = app.emit("internode-stats", stats.flows.values().collect::<Vec<_>>());
                let _ = app.emit("asterix-flows", stats.asterix.values().collect::<Vec<_>>());
                let _ = app.emit("traffic-summary", json!({"bytes":stats.bytes,"packets":stats.packets,"asterixFlows":stats.asterix.len()}));
                stats = Stats::default();
                last = Instant::now();
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        for handle in handles {
            unsafe {
                (api.close)(handle);
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn asterix_requires_complete_known_blocks() {
        assert_eq!(asterix(&[48, 0, 3, 21, 0, 3]), vec![(48, 3), (21, 3)]);
        for data in [&[48, 0, 4][..], &[48, 0, 2], &[255, 0, 3], &[48, 0, 3, 1]] {
            assert!(asterix(data).is_empty());
        }
    }
    #[test]
    fn ethernet_ipv4_udp_bounds_and_fragmentation() {
        let mut bytes = vec![0u8; 45];
        bytes[12..14].copy_from_slice(&[8, 0]);
        bytes[14] = 0x45;
        bytes[16..18].copy_from_slice(&[0, 31]);
        bytes[23] = 17;
        bytes[26..30].copy_from_slice(&[10, 0, 0, 1]);
        bytes[30..34].copy_from_slice(&[10, 0, 0, 2]);
        bytes[38..40].copy_from_slice(&[0, 11]);
        bytes[42..45].copy_from_slice(&[48, 0, 3]);
        let packet = decode(&bytes).unwrap();
        assert_eq!(packet.src, "10.0.0.1");
        assert_eq!(packet.cats, vec![(48, 3)]);
        for n in 0..bytes.len() {
            assert!(decode(&bytes[..n]).is_none());
        }
        bytes[20] = 0x20;
        assert!(decode(&bytes).unwrap().cats.is_empty());
    }
}
