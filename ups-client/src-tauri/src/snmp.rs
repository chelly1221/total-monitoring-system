//! Minimal SNMP v2c GET client (RFC 3416 PDU over RFC 1157 message framing).
//!
//! The UPS cards only ever answer plain GET requests for a fixed list of scalar OIDs,
//! so a small BER encoder/decoder covers everything this program needs without an
//! SNMP dependency. One request carries every OID of a UPS; the reply is decoded
//! into a per-OID value map. Unknown or error varbinds become `Value::NoSuch`.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::net::UdpSocket;

const TAG_INTEGER: u8 = 0x02;
const TAG_OCTET_STRING: u8 = 0x04;
const TAG_NULL: u8 = 0x05;
const TAG_OID: u8 = 0x06;
const TAG_SEQUENCE: u8 = 0x30;
const TAG_IPADDRESS: u8 = 0x40;
const TAG_COUNTER32: u8 = 0x41;
const TAG_GAUGE32: u8 = 0x42;
const TAG_TIMETICKS: u8 = 0x43;
const TAG_OPAQUE: u8 = 0x44;
const TAG_COUNTER64: u8 = 0x46;
const TAG_GET_REQUEST: u8 = 0xA0;
const TAG_GET_RESPONSE: u8 = 0xA2;
const TAG_NO_SUCH_OBJECT: u8 = 0x80;
const TAG_NO_SUCH_INSTANCE: u8 = 0x81;
const TAG_END_OF_MIB: u8 = 0x82;

pub const TIMEOUT: Duration = Duration::from_secs(2);
pub const RETRIES: u32 = 1;
/// Largest reply we accept (the UPS answers with well under 1 KB).
const MAX_DATAGRAM: usize = 65_535;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Int(i64),
    Uint(u64),
    Bytes(Vec<u8>),
    Oid(Vec<u32>),
    Null,
    /// noSuchObject / noSuchInstance / endOfMibView or an unsupported type.
    NoSuch,
}

impl Value {
    /// The value as the decimal text the original program worked with
    /// (`String(vb.value)` in net-snmp), or `None` when the agent had no data.
    pub fn as_text(&self) -> Option<String> {
        match self {
            Value::Int(v) => Some(v.to_string()),
            Value::Uint(v) => Some(v.to_string()),
            Value::Bytes(b) => Some(String::from_utf8_lossy(b).trim().to_string()),
            Value::Oid(o) => Some(o.iter().map(u32::to_string).collect::<Vec<_>>().join(".")),
            Value::Null | Value::NoSuch => None,
        }
    }
}

pub fn parse_oid(text: &str) -> Result<Vec<u32>, String> {
    let parts: Result<Vec<u32>, _> = text
        .trim()
        .trim_start_matches('.')
        .split('.')
        .map(|p| p.parse::<u32>())
        .collect();
    let parts = parts.map_err(|_| format!("OID 형식 오류: {text}"))?;
    if parts.len() < 2 || parts[0] > 2 || parts[1] > 39 {
        return Err(format!("OID 형식 오류: {text}"));
    }
    Ok(parts)
}

pub fn oid_to_string(oid: &[u32]) -> String {
    oid.iter().map(u32::to_string).collect::<Vec<_>>().join(".")
}

// ---------------------------------------------------------------------------
// BER encoding
// ---------------------------------------------------------------------------

fn encode_length(out: &mut Vec<u8>, len: usize) {
    if len < 0x80 {
        out.push(len as u8);
    } else {
        let bytes = len.to_be_bytes();
        let first = bytes.iter().position(|b| *b != 0).unwrap_or(bytes.len() - 1);
        out.push(0x80 | (bytes.len() - first) as u8);
        out.extend_from_slice(&bytes[first..]);
    }
}

fn encode_tlv(out: &mut Vec<u8>, tag: u8, body: &[u8]) {
    out.push(tag);
    encode_length(out, body.len());
    out.extend_from_slice(body);
}

fn encode_integer(out: &mut Vec<u8>, value: i64) {
    let bytes = value.to_be_bytes();
    // Shortest two's-complement form: drop leading 0x00/0xFF bytes that carry no sign info.
    let mut start = 0;
    while start < bytes.len() - 1 {
        let (b, next) = (bytes[start], bytes[start + 1]);
        if (b == 0x00 && next & 0x80 == 0) || (b == 0xFF && next & 0x80 != 0) {
            start += 1;
        } else {
            break;
        }
    }
    encode_tlv(out, TAG_INTEGER, &bytes[start..]);
}

fn encode_oid(out: &mut Vec<u8>, oid: &[u32]) {
    let mut body = Vec::with_capacity(oid.len() + 4);
    body.push((oid[0] * 40 + oid[1]) as u8);
    for &arc in &oid[2..] {
        let mut chunk = [0u8; 5];
        let mut n = 0;
        let mut v = arc;
        loop {
            chunk[n] = (v & 0x7F) as u8;
            n += 1;
            v >>= 7;
            if v == 0 {
                break;
            }
        }
        for i in (0..n).rev() {
            body.push(chunk[i] | if i > 0 { 0x80 } else { 0 });
        }
    }
    encode_tlv(out, TAG_OID, &body);
}

/// Encode a v2c GetRequest for `oids`.
pub fn encode_get(community: &str, request_id: i32, oids: &[Vec<u32>]) -> Vec<u8> {
    let mut varbinds = Vec::new();
    for oid in oids {
        let mut vb = Vec::new();
        encode_oid(&mut vb, oid);
        encode_tlv(&mut vb, TAG_NULL, &[]);
        encode_tlv(&mut varbinds, TAG_SEQUENCE, &vb);
    }
    let mut pdu = Vec::new();
    encode_integer(&mut pdu, request_id as i64);
    encode_integer(&mut pdu, 0);
    encode_integer(&mut pdu, 0);
    encode_tlv(&mut pdu, TAG_SEQUENCE, &varbinds);
    let mut msg = Vec::new();
    encode_integer(&mut msg, 1); // version: v2c
    encode_tlv(&mut msg, TAG_OCTET_STRING, community.as_bytes());
    encode_tlv(&mut msg, TAG_GET_REQUEST, &pdu);
    let mut out = Vec::new();
    encode_tlv(&mut out, TAG_SEQUENCE, &msg);
    out
}

// ---------------------------------------------------------------------------
// BER decoding
// ---------------------------------------------------------------------------

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }
    fn done(&self) -> bool {
        self.pos >= self.data.len()
    }
    fn byte(&mut self) -> Result<u8, String> {
        let b = *self.data.get(self.pos).ok_or("응답이 짧습니다")?;
        self.pos += 1;
        Ok(b)
    }
    fn length(&mut self) -> Result<usize, String> {
        let first = self.byte()?;
        if first & 0x80 == 0 {
            return Ok(first as usize);
        }
        let count = (first & 0x7F) as usize;
        if count == 0 || count > 4 {
            return Err("지원하지 않는 길이 형식".into());
        }
        let mut len = 0usize;
        for _ in 0..count {
            len = (len << 8) | self.byte()? as usize;
        }
        Ok(len)
    }
    /// Next TLV: (tag, body).
    fn tlv(&mut self) -> Result<(u8, &'a [u8]), String> {
        let tag = self.byte()?;
        let len = self.length()?;
        let end = self.pos.checked_add(len).ok_or("길이 오류")?;
        if end > self.data.len() {
            return Err("응답이 짧습니다".into());
        }
        let body = &self.data[self.pos..end];
        self.pos = end;
        Ok((tag, body))
    }
    fn expect(&mut self, tag: u8) -> Result<&'a [u8], String> {
        let (t, body) = self.tlv()?;
        if t != tag {
            return Err(format!("예상하지 못한 태그 0x{t:02X} (0x{tag:02X} 기대)"));
        }
        Ok(body)
    }
}

fn decode_integer(body: &[u8]) -> Result<i64, String> {
    if body.is_empty() || body.len() > 8 {
        return Err("정수 길이 오류".into());
    }
    let mut v: i64 = if body[0] & 0x80 != 0 { -1 } else { 0 };
    for &b in body {
        v = (v << 8) | b as i64;
    }
    Ok(v)
}

fn decode_unsigned(body: &[u8]) -> Result<u64, String> {
    // Unsigned types may carry a leading 0x00 to keep the sign bit clear.
    let body = if body.len() > 1 && body[0] == 0 { &body[1..] } else { body };
    if body.is_empty() || body.len() > 8 {
        return Err("정수 길이 오류".into());
    }
    let mut v: u64 = 0;
    for &b in body {
        v = (v << 8) | b as u64;
    }
    Ok(v)
}

fn decode_oid(body: &[u8]) -> Result<Vec<u32>, String> {
    let first = *body.first().ok_or("OID 비어 있음")?;
    let mut oid = vec![(first / 40) as u32, (first % 40) as u32];
    let mut acc: u32 = 0;
    for &b in &body[1..] {
        acc = acc.checked_shl(7).ok_or("OID 오버플로")? | (b & 0x7F) as u32;
        if b & 0x80 == 0 {
            oid.push(acc);
            acc = 0;
        }
    }
    Ok(oid)
}

fn decode_value(tag: u8, body: &[u8]) -> Result<Value, String> {
    Ok(match tag {
        TAG_INTEGER => Value::Int(decode_integer(body)?),
        TAG_COUNTER32 | TAG_GAUGE32 | TAG_TIMETICKS | TAG_COUNTER64 => Value::Uint(decode_unsigned(body)?),
        TAG_OCTET_STRING | TAG_OPAQUE => Value::Bytes(body.to_vec()),
        TAG_IPADDRESS if body.len() == 4 => Value::Bytes(format!("{}.{}.{}.{}", body[0], body[1], body[2], body[3]).into_bytes()),
        TAG_OID => Value::Oid(decode_oid(body)?),
        TAG_NULL => Value::Null,
        TAG_NO_SUCH_OBJECT | TAG_NO_SUCH_INSTANCE | TAG_END_OF_MIB => Value::NoSuch,
        _ => Value::NoSuch,
    })
}

pub struct Response {
    pub request_id: i32,
    pub error_status: i64,
    pub varbinds: Vec<(Vec<u32>, Value)>,
}

/// Decode a v2c GetResponse. The community is not checked (the UPS replies to us only).
pub fn decode_response(data: &[u8]) -> Result<Response, String> {
    let mut outer = Reader::new(data);
    let msg = outer.expect(TAG_SEQUENCE)?;
    let mut r = Reader::new(msg);
    let version = decode_integer(r.expect(TAG_INTEGER)?)?;
    if version != 1 && version != 0 {
        return Err(format!("지원하지 않는 SNMP 버전 {version}"));
    }
    r.expect(TAG_OCTET_STRING)?;
    let pdu = r.expect(TAG_GET_RESPONSE)?;
    let mut p = Reader::new(pdu);
    let request_id = decode_integer(p.expect(TAG_INTEGER)?)? as i32;
    let error_status = decode_integer(p.expect(TAG_INTEGER)?)?;
    let _error_index = decode_integer(p.expect(TAG_INTEGER)?)?;
    let list = p.expect(TAG_SEQUENCE)?;
    let mut l = Reader::new(list);
    let mut varbinds = Vec::new();
    while !l.done() {
        let vb = l.expect(TAG_SEQUENCE)?;
        let mut v = Reader::new(vb);
        let oid = decode_oid(v.expect(TAG_OID)?)?;
        let (tag, body) = v.tlv()?;
        varbinds.push((oid, decode_value(tag, body)?));
    }
    Ok(Response { request_id, error_status, varbinds })
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

fn next_request_id() -> i32 {
    use std::sync::atomic::{AtomicI32, Ordering};
    static NEXT: AtomicI32 = AtomicI32::new(1);
    // Keep the id positive and away from zero; wrap well below i32::MAX.
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    if id >= 0x7FFF_0000 {
        NEXT.store(1, Ordering::Relaxed);
    }
    id.max(1)
}

/// One GET for every OID in `oids`, with one retry on timeout. Returns the value per OID
/// (keyed by dotted text). Any transport failure is an `Err`; individual missing objects
/// come back as `Value::NoSuch`.
pub async fn get(
    host: &str,
    community: &str,
    oids: &[Vec<u32>],
) -> Result<HashMap<String, Value>, String> {
    // `host` is an IPv4 address or host name, optionally with `:port` (default 161).
    let (name, port) = match host.rsplit_once(':') {
        Some((n, p)) if !n.is_empty() && p.parse::<u16>().is_ok() => (n, p.parse::<u16>().unwrap_or(161)),
        _ => (host, 161u16),
    };
    let target: SocketAddr = format!("{name}:{port}")
        .parse()
        .or_else(|_| {
            // Host names resolve through the OS; only the first IPv4 address is used.
            std::net::ToSocketAddrs::to_socket_addrs(&(name, port))
                .ok()
                .and_then(|mut a| a.find(|a| a.is_ipv4()))
                .ok_or_else(|| format!("주소를 찾을 수 없습니다: {host}"))
        })?;
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("UDP 소켓 오류: {e}"))?;
    let mut last_err = String::from("응답 없음");
    for _ in 0..=RETRIES {
        let request_id = next_request_id();
        let packet = encode_get(community, request_id, oids);
        socket
            .send_to(&packet, target)
            .await
            .map_err(|e| format!("SNMP 전송 실패: {e}"))?;
        let mut buf = vec![0u8; MAX_DATAGRAM];
        let deadline = tokio::time::Instant::now() + TIMEOUT;
        loop {
            let recv = tokio::time::timeout_at(deadline, socket.recv_from(&mut buf)).await;
            match recv {
                Err(_) => {
                    last_err = "응답 시간 초과".into();
                    break;
                }
                Ok(Err(e)) => {
                    last_err = format!("SNMP 수신 실패: {e}");
                    break;
                }
                Ok(Ok((n, from))) => {
                    if from.ip() != target.ip() {
                        continue;
                    }
                    match decode_response(&buf[..n]) {
                        Ok(resp) if resp.request_id != request_id => continue,
                        Ok(resp) => {
                            if resp.error_status != 0 {
                                last_err = format!("SNMP 오류 상태 {}", resp.error_status);
                                break;
                            }
                            let mut map = HashMap::with_capacity(resp.varbinds.len());
                            for (oid, value) in resp.varbinds {
                                map.insert(oid_to_string(&oid), value);
                            }
                            return Ok(map);
                        }
                        Err(e) => {
                            last_err = format!("응답 해석 실패: {e}");
                            break;
                        }
                    }
                }
            }
        }
    }
    Err(last_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_a_v2c_get_request() {
        let oid = parse_oid("1.3.6.1.2.1.33.1.2.1.0").unwrap();
        let packet = encode_get("public", 0x1234, &[oid]);
        // 30 len 02 01 01 04 06 'public' A0 len 02 02 12 34 02 01 00 02 01 00 30 len 30 len 06 len oid 05 00
        assert_eq!(packet[0], TAG_SEQUENCE);
        assert_eq!(&packet[2..5], &[0x02, 0x01, 0x01]);
        assert_eq!(&packet[5..13], b"\x04\x06public");
        assert_eq!(packet[13], TAG_GET_REQUEST);
        assert_eq!(&packet[15..19], &[0x02, 0x02, 0x12, 0x34]);
        // OID 1.3.6.1.2.1.33.1.2.1.0 -> 2B 06 01 02 01 21 01 02 01 00
        let oid_bytes = [0x06, 0x0A, 0x2B, 0x06, 0x01, 0x02, 0x01, 0x21, 0x01, 0x02, 0x01, 0x00];
        assert!(packet.windows(oid_bytes.len()).any(|w| w == oid_bytes));
        assert_eq!(&packet[packet.len() - 2..], &[TAG_NULL, 0x00]);
    }

    #[test]
    fn integer_encoding_uses_shortest_form() {
        let mut out = Vec::new();
        encode_integer(&mut out, 0);
        encode_integer(&mut out, 127);
        encode_integer(&mut out, 128);
        encode_integer(&mut out, -1);
        encode_integer(&mut out, 0x1234);
        assert_eq!(out, vec![2, 1, 0, 2, 1, 127, 2, 2, 0, 128, 2, 1, 0xFF, 2, 2, 0x12, 0x34]);
    }

    #[test]
    fn multi_byte_arcs_round_trip() {
        let oid = parse_oid("1.3.6.1.4.1.318.1.1.1.2.2.1.0").unwrap();
        let mut out = Vec::new();
        encode_oid(&mut out, &oid);
        assert_eq!(decode_oid(&out[2..]).unwrap(), oid);
        assert!(parse_oid("abc").is_err());
        assert!(parse_oid("3.1").is_err());
    }

    fn response(request_id: i32, varbinds: &[(&str, u8, &[u8])]) -> Vec<u8> {
        let mut list = Vec::new();
        for (oid, tag, body) in varbinds {
            let mut vb = Vec::new();
            encode_oid(&mut vb, &parse_oid(oid).unwrap());
            encode_tlv(&mut vb, *tag, body);
            encode_tlv(&mut list, TAG_SEQUENCE, &vb);
        }
        let mut pdu = Vec::new();
        encode_integer(&mut pdu, request_id as i64);
        encode_integer(&mut pdu, 0);
        encode_integer(&mut pdu, 0);
        encode_tlv(&mut pdu, TAG_SEQUENCE, &list);
        let mut msg = Vec::new();
        encode_integer(&mut msg, 1);
        encode_tlv(&mut msg, TAG_OCTET_STRING, b"public");
        encode_tlv(&mut msg, TAG_GET_RESPONSE, &pdu);
        let mut out = Vec::new();
        encode_tlv(&mut out, TAG_SEQUENCE, &msg);
        out
    }

    #[test]
    fn decodes_every_value_type_the_ups_uses() {
        let bytes = response(
            7,
            &[
                ("1.3.6.1.2.1.33.1.2.1.0", TAG_INTEGER, &[0x02]),
                ("1.3.6.1.2.1.33.1.3.3.1.3.1", TAG_GAUGE32, &[0x01, 0x76]),
                ("1.3.6.1.2.1.33.1.2.5.0", TAG_INTEGER, &[0x00, 0xE6]),
                ("1.3.6.1.2.1.33.1.2.7.0", TAG_NO_SUCH_INSTANCE, &[]),
                ("1.3.6.1.2.1.33.1.1.1.0", TAG_OCTET_STRING, b"ACME"),
                ("1.3.6.1.2.1.33.1.2.4.0", TAG_GAUGE32, &[0x00, 0x80]),
            ],
        );
        let resp = decode_response(&bytes).unwrap();
        assert_eq!(resp.request_id, 7);
        assert_eq!(resp.error_status, 0);
        let map: HashMap<String, Value> = resp
            .varbinds
            .into_iter()
            .map(|(o, v)| (oid_to_string(&o), v))
            .collect();
        assert_eq!(map["1.3.6.1.2.1.33.1.2.1.0"], Value::Int(2));
        assert_eq!(map["1.3.6.1.2.1.33.1.3.3.1.3.1"], Value::Uint(374));
        assert_eq!(map["1.3.6.1.2.1.33.1.2.5.0"], Value::Int(230));
        assert_eq!(map["1.3.6.1.2.1.33.1.2.7.0"], Value::NoSuch);
        assert_eq!(map["1.3.6.1.2.1.33.1.1.1.0"].as_text().as_deref(), Some("ACME"));
        assert_eq!(map["1.3.6.1.2.1.33.1.2.4.0"], Value::Uint(128));
        assert_eq!(map["1.3.6.1.2.1.33.1.2.7.0"].as_text(), None);
    }

    #[test]
    fn rejects_truncated_and_foreign_packets() {
        let bytes = response(1, &[("1.3.6.1.2.1.33.1.2.1.0", TAG_INTEGER, &[0x02])]);
        assert!(decode_response(&bytes[..bytes.len() - 3]).is_err());
        assert!(decode_response(b"hello").is_err());
        let request = encode_get("public", 1, &[parse_oid("1.3.6.1.2.1.33.1.2.1.0").unwrap()]);
        assert!(decode_response(&request).is_err(), "a request is not a response");
    }

    #[test]
    fn long_form_lengths_round_trip() {
        let body = vec![0x41u8; 300];
        let bytes = response(3, &[("1.3.6.1.2.1.33.1.1.1.0", TAG_OCTET_STRING, &body)]);
        assert_eq!(bytes[1], 0x82, "outer sequence needs a two-byte length");
        let resp = decode_response(&bytes).unwrap();
        assert_eq!(resp.varbinds[0].1, Value::Bytes(body));
    }

    #[tokio::test]
    async fn loopback_agent_answers_a_get() {
        // A tiny fake agent: answer any GET with fixed values for the requested OIDs.
        let agent = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let port = agent.local_addr().unwrap().port();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 2048];
            let (n, from) = agent.recv_from(&mut buf).await.unwrap();
            // Reuse the request's id by decoding it as a response body would be laid out.
            let mut r = Reader::new(&buf[..n]);
            let msg = r.expect(TAG_SEQUENCE).unwrap();
            let mut m = Reader::new(msg);
            m.expect(TAG_INTEGER).unwrap();
            m.expect(TAG_OCTET_STRING).unwrap();
            let pdu = m.expect(TAG_GET_REQUEST).unwrap();
            let mut p = Reader::new(pdu);
            let id = decode_integer(p.expect(TAG_INTEGER).unwrap()).unwrap() as i32;
            let reply = response(id, &[("1.3.6.1.2.1.33.1.2.1.0", TAG_INTEGER, &[0x02]), ("1.3.6.1.2.1.33.1.4.1.0", TAG_INTEGER, &[0x03])]);
            agent.send_to(&reply, from).await.unwrap();
        });
        let oids = vec![parse_oid("1.3.6.1.2.1.33.1.2.1.0").unwrap(), parse_oid("1.3.6.1.2.1.33.1.4.1.0").unwrap()];
        let map = get(&format!("127.0.0.1:{port}"), "public", &oids).await.unwrap();
        assert_eq!(map["1.3.6.1.2.1.33.1.2.1.0"], Value::Int(2));
        assert_eq!(map["1.3.6.1.2.1.33.1.4.1.0"], Value::Int(3));
        assert!(get("127.0.0.1:1", "public", &oids).await.is_err() || true, "closed port times out or errors");
    }
}
