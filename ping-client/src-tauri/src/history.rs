use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

pub const MAX_BYTES: u64 = 5_000_000_000;
const SEGMENT_BYTES: u64 = 1_000_000;
const SCAN_BYTES: u64 = 16_000_000;
pub const RECENT_LIMIT: usize = 100;

#[derive(Clone)]
struct Segment {
    id: u64,
    bytes: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Cursor {
    segment: u64,
    offset: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub entries: Vec<Value>,
    pub next_cursor: Option<Cursor>,
    pub bytes_used: u64,
    pub max_bytes: u64,
}

pub struct HistoryStore {
    dir: PathBuf,
    segments: Vec<Segment>,
    bytes: u64,
    max_bytes: u64,
    segment_bytes: u64,
    next_id: u64,
}

pub struct Query {
    dir: PathBuf,
    segments: Vec<Segment>,
    bytes: u64,
    max_bytes: u64,
}

fn log_error(e: impl std::fmt::Display) -> String {
    format!("로그 파일 처리 실패: {e}")
}
fn segment_path(dir: &Path, id: u64) -> PathBuf {
    dir.join(format!("{id:020}.jsonl"))
}

impl HistoryStore {
    pub fn open(data_dir: &Path) -> Result<Self, String> {
        Self::with_limits(data_dir, MAX_BYTES, SEGMENT_BYTES)
    }

    fn with_limits(data_dir: &Path, max_bytes: u64, segment_bytes: u64) -> Result<Self, String> {
        let dir = data_dir.join("ping-history");
        fs::create_dir_all(&dir).map_err(log_error)?;
        // Migrate the previous JSON array once, with an atomic segment replacement.
        let legacy = data_dir.join("ping-history.json");
        if legacy.exists() {
            let migrated = segment_path(&dir, 0);
            if !migrated.exists() {
                if fs::metadata(&legacy).map_err(log_error)?.len() > 1_000_000 {
                    return Err("이전 로그 파일의 크기가 너무 큽니다".into());
                }
                let raw = fs::read(&legacy).map_err(log_error)?;
                let entries: Vec<Value> = serde_json::from_slice(&raw).map_err(log_error)?;
                let mut data = Vec::new();
                for entry in entries {
                    serde_json::to_writer(&mut data, &entry).map_err(log_error)?;
                    data.push(b'\n');
                }
                let temp = dir.join("legacy.tmp");
                fs::write(&temp, data).map_err(log_error)?;
                fs::rename(temp, migrated).map_err(log_error)?;
            }
            fs::remove_file(legacy).map_err(log_error)?;
        }
        let mut segments = Vec::new();
        for entry in fs::read_dir(&dir).map_err(log_error)? {
            let entry = entry.map_err(log_error)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.len() != 26
                || !name.ends_with(".jsonl")
                || !name.as_bytes()[..20].iter().all(|b| b.is_ascii_digit())
            {
                continue;
            }
            let metadata = entry.metadata().map_err(log_error)?;
            if metadata.is_file() {
                segments.push(Segment {
                    id: name[..20].parse().map_err(log_error)?,
                    bytes: metadata.len(),
                });
            }
        }
        segments.sort_by_key(|s| s.id);
        // A power interruption can leave one incomplete line in the newest segment.
        if let Some(last) = segments.last_mut() {
            let path = segment_path(&dir, last.id);
            let mut file = OpenOptions::new()
                .read(true)
                .write(true)
                .open(path)
                .map_err(log_error)?;
            if last.bytes > 0 {
                let tail_len = last.bytes.min(1_000_000);
                file.seek(SeekFrom::Start(last.bytes - tail_len))
                    .map_err(log_error)?;
                let mut tail = Vec::new();
                file.read_to_end(&mut tail).map_err(log_error)?;
                let complete = tail
                    .iter()
                    .rposition(|b| *b == b'\n')
                    .map_or(0, |i| last.bytes - tail_len + i as u64 + 1);
                if complete != last.bytes {
                    file.set_len(complete).map_err(log_error)?;
                    last.bytes = complete;
                }
            }
        }
        let next_id = segments
            .last()
            .map_or(1, |s| s.id + 1)
            .max(crate::state::now_ms());
        let bytes = segments.iter().map(|s| s.bytes).sum();
        let mut store = Self {
            dir,
            segments,
            bytes,
            max_bytes,
            segment_bytes,
            next_id,
        };
        store.make_room(0)?;
        Ok(store)
    }

    fn make_room(&mut self, additional: u64) -> Result<(), String> {
        while self.bytes + additional > self.max_bytes {
            let Some(oldest) = self.segments.first() else {
                return Err("로그 저장 용량이 부족합니다".into());
            };
            fs::remove_file(segment_path(&self.dir, oldest.id)).map_err(log_error)?;
            self.bytes -= oldest.bytes;
            self.segments.remove(0);
        }
        Ok(())
    }

    pub fn append(&mut self, event: &Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(event).map_err(log_error)?;
        bytes.push(b'\n');
        let size = bytes.len() as u64;
        if size > self.max_bytes || size > self.segment_bytes {
            return Err("로그 한 건의 크기가 너무 큽니다".into());
        }
        self.make_room(size)?;
        if self
            .segments
            .last()
            .is_none_or(|s| s.bytes + size > self.segment_bytes)
        {
            let id = self.next_id;
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(segment_path(&self.dir, id))
                .map_err(log_error)?;
            self.next_id += 1;
            self.segments.push(Segment { id, bytes: 0 });
        }
        let segment = self.segments.last_mut().unwrap();
        let mut file = OpenOptions::new()
            .write(true)
            .open(segment_path(&self.dir, segment.id))
            .map_err(log_error)?;
        file.seek(SeekFrom::Start(segment.bytes))
            .map_err(log_error)?;
        if let Err(e) = file.write_all(&bytes).and_then(|_| file.sync_data()) {
            let _ = file.set_len(segment.bytes);
            return Err(log_error(e));
        }
        segment.bytes += size;
        self.bytes += size;
        Ok(())
    }

    pub fn query(&self) -> Query {
        Query {
            dir: self.dir.clone(),
            segments: self.segments.clone(),
            bytes: self.bytes,
            max_bytes: self.max_bytes,
        }
    }
    pub fn bytes_used(&self) -> u64 {
        self.bytes
    }

    pub fn clear(&mut self) -> Result<(), String> {
        while let Some(segment) = self.segments.first() {
            fs::remove_file(segment_path(&self.dir, segment.id)).map_err(log_error)?;
            self.bytes -= segment.bytes;
            self.segments.remove(0);
        }
        Ok(())
    }
}

impl Query {
    // Snapshot file lengths and byte cursors keep pagination stable as new events arrive.
    // Each request reads at most 16 MB, outside the monitoring state lock.
    pub fn page(
        &self,
        cursor: Option<Cursor>,
        search: &str,
        status: &str,
        limit: usize,
    ) -> Result<Page, String> {
        let limit = limit.clamp(1, 100);
        let search = search.trim().to_lowercase();
        let mut entries = Vec::new();
        let mut scanned = 0;
        let mut next_cursor = None;
        for segment in self.segments.iter().rev() {
            if cursor.as_ref().is_some_and(|c| segment.id > c.segment) {
                continue;
            }
            let bound = cursor
                .as_ref()
                .filter(|c| c.segment == segment.id)
                .map_or(segment.bytes, |c| c.offset.min(segment.bytes));
            if bound == 0 {
                continue;
            }
            let file = match fs::File::open(segment_path(&self.dir, segment.id)) {
                Ok(file) => file,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(log_error(e)),
            };
            let mut data = Vec::new();
            file.take(bound).read_to_end(&mut data).map_err(log_error)?;
            scanned += data.len() as u64;
            let mut end = data.len();
            while end > 0 {
                let line_end = if data[end - 1] == b'\n' { end - 1 } else { end };
                let start = data[..line_end]
                    .iter()
                    .rposition(|b| *b == b'\n')
                    .map_or(0, |p| p + 1);
                if let Ok(entry) = serde_json::from_slice::<Value>(&data[start..line_end]) {
                    let matches = (status.is_empty() || entry["status"].as_str() == Some(status))
                        && (search.is_empty()
                            || format!(
                                "{} {}",
                                entry["name"].as_str().unwrap_or_default(),
                                entry["address"].as_str().unwrap_or_default()
                            )
                            .to_lowercase()
                            .contains(&search));
                    if matches {
                        entries.push(entry);
                    }
                }
                end = start;
                if entries.len() >= limit {
                    next_cursor = Some(Cursor {
                        segment: segment.id,
                        offset: end as u64,
                    });
                    break;
                }
            }
            if next_cursor.is_some() {
                break;
            }
            if scanned >= SCAN_BYTES {
                next_cursor = Some(Cursor {
                    segment: segment.id,
                    offset: 0,
                });
                break;
            }
        }
        if next_cursor
            .as_ref()
            .is_some_and(|c| c.offset == 0 && !self.segments.iter().any(|s| s.id < c.segment))
        {
            next_cursor = None;
        }
        Ok(Page {
            entries,
            next_cursor,
            bytes_used: self.bytes,
            max_bytes: self.max_bytes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn temp_dir() -> PathBuf {
        let p = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&p).unwrap();
        p
    }
    fn cleanup(dir: PathBuf) {
        let canonical = dir.canonicalize().unwrap();
        let root = std::env::temp_dir().canonicalize().unwrap();
        assert!(canonical.starts_with(&root) && canonical != root);
        fs::remove_dir_all(canonical).unwrap();
    }
    fn event(i: u64) -> Value {
        json!({"at":i,"name":"장비","address":"127.0.0.1","status":if i % 2 == 0 {"장애 발생"} else {"정상 복구"}})
    }
    #[test]
    fn retains_more_than_100_and_pages_without_duplicates_after_append() {
        let dir = temp_dir();
        let mut store = HistoryStore::with_limits(&dir, 100_000, 1000).unwrap();
        for i in 0..250 {
            store.append(&event(i)).unwrap();
        }
        let first = store.query().page(None, "", "", 100).unwrap();
        assert_eq!(first.entries[0]["at"], 249);
        store.append(&event(250)).unwrap();
        let second = store.query().page(first.next_cursor, "", "", 100).unwrap();
        assert_eq!(second.entries[0]["at"], 149);
        let third = store.query().page(second.next_cursor, "", "", 100).unwrap();
        assert_eq!(third.entries.len(), 50);
        assert!(third.next_cursor.is_none());
        let filtered = store.query().page(None, "127.0", "정상 복구", 100).unwrap();
        assert!(filtered.entries.iter().all(|e| e["status"] == "정상 복구"));
        drop(store);
        let reopened = HistoryStore::with_limits(&dir, 100_000, 1000).unwrap();
        assert_eq!(
            reopened.query().page(None, "", "", 100).unwrap().entries[0]["at"],
            250
        );
        cleanup(dir);
    }
    #[test]
    fn rotates_by_bytes_repairs_partial_write_and_clears() {
        let dir = temp_dir();
        let mut store = HistoryStore::with_limits(&dir, 2000, 500).unwrap();
        for i in 0..100 {
            store.append(&event(i)).unwrap();
            assert!(store.bytes_used() <= 2000);
        }
        let last = store.segments.last().unwrap().id;
        OpenOptions::new()
            .append(true)
            .open(segment_path(&store.dir, last))
            .unwrap()
            .write_all(b"{partial")
            .unwrap();
        drop(store);
        let mut store = HistoryStore::with_limits(&dir, 2000, 500).unwrap();
        let page = store.query().page(None, "", "", 100).unwrap();
        assert_eq!(page.entries[0]["at"], 99);
        assert!(page.entries.len() < 100);
        store.clear().unwrap();
        assert_eq!(store.bytes_used(), 0);
        assert!(store
            .query()
            .page(None, "", "", 100)
            .unwrap()
            .entries
            .is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn migrates_legacy_logs_once() {
        let dir = temp_dir();
        fs::write(
            dir.join("ping-history.json"),
            serde_json::to_vec(&vec![event(1), event(2)]).unwrap(),
        )
        .unwrap();
        drop(HistoryStore::open(&dir).unwrap());
        let store = HistoryStore::open(&dir).unwrap();
        assert_eq!(
            store.query().page(None, "", "", 100).unwrap().entries.len(),
            2
        );
        assert!(!dir.join("ping-history.json").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
