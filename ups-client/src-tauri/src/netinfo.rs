//! Adapter lookup via `GetAdaptersAddresses`: MAC of the interface that owns a given
//! local IPv4 address (the one used to reply to the server), with a first-adapter fallback.

use std::net::Ipv4Addr;
use windows::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS};
use windows::Win32::NetworkManagement::IpHelper::{
    GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER,
    GAA_FLAG_SKIP_FRIENDLY_NAME, GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
};
use windows::Win32::Networking::WinSock::{AF_INET, AF_UNSPEC, SOCKADDR_IN};

struct Adapter {
    mac: Option<String>,
    ipv4: Vec<Ipv4Addr>,
}

fn format_mac(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn enumerate() -> Vec<Adapter> {
    let flags = GAA_FLAG_SKIP_ANYCAST
        | GAA_FLAG_SKIP_MULTICAST
        | GAA_FLAG_SKIP_DNS_SERVER
        | GAA_FLAG_SKIP_FRIENDLY_NAME;
    let mut size: u32 = 16 * 1024;
    let mut buf: Vec<u8> = Vec::new();
    // Grow the buffer until the table fits (the API reports the required size).
    for _ in 0..4 {
        buf.resize(size as usize, 0);
        // SAFETY: buffer is sized per `size`, pointer is properly aligned for the struct
        // because Vec<u8> allocations of this size are at least 8-byte aligned on Windows.
        let rc = unsafe {
            GetAdaptersAddresses(
                AF_UNSPEC.0 as u32,
                flags,
                None,
                Some(buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH),
                &mut size,
            )
        };
        if rc == ERROR_SUCCESS.0 {
            break;
        }
        if rc != ERROR_BUFFER_OVERFLOW.0 {
            return Vec::new();
        }
    }

    let mut out = Vec::new();
    let mut p = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
    // SAFETY: walking the linked list the API wrote into `buf`; all pointers point into it.
    unsafe {
        while !p.is_null() {
            let a = &*p;
            let mac_len = a.PhysicalAddressLength as usize;
            let mac = if mac_len == 6 {
                Some(format_mac(&a.PhysicalAddress[..6]))
            } else {
                None
            };
            let mut ipv4 = Vec::new();
            let mut u = a.FirstUnicastAddress;
            while !u.is_null() {
                let ua = &*u;
                let sa = ua.Address.lpSockaddr;
                if !sa.is_null() && (*sa).sa_family == AF_INET {
                    let sin = &*(sa as *const SOCKADDR_IN);
                    // S_addr is in network byte order; from_be on the raw u32 is wrong on LE,
                    // so go through the byte view instead.
                    let b = sin.sin_addr.S_un.S_un_b;
                    ipv4.push(Ipv4Addr::new(b.s_b1, b.s_b2, b.s_b3, b.s_b4));
                }
                u = ua.Next;
            }
            out.push(Adapter { mac, ipv4 });
            p = a.Next;
        }
    }
    out
}

/// MAC (`AA:BB:CC:DD:EE:FF`) of the adapter owning `ip`, if any.
pub fn mac_by_ipv4(ip: Ipv4Addr) -> Option<String> {
    enumerate()
        .into_iter()
        .find(|a| a.ipv4.contains(&ip))
        .and_then(|a| a.mac)
}
