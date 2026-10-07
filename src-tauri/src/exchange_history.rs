//! Exchange's histories: swaps sent from Best Rate (`data/exchange-history.json`)
//! and revokes sent from Approvals (`data/revoke-history.json`).
//!
//! Each file is a JSON array of records, newest first. The frontend owns the
//! record format; this side only stores it: each save replaces the record
//! with the same `id` or puts a new one on top, and the list is capped so the
//! file cannot grow without bound.
//!
//! Records hold addresses and amounts, so they never go to the diagnostic log.

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};

use crate::settings;

/// Swaps sent from Best Rate.
pub const SWAPS: &str = "exchange-history.json";
/// Revokes sent from Approvals.
pub const REVOKES: &str = "revoke-history.json";

/// The most records kept per file; older ones fall off the end.
const MAX_RECORDS: usize = 500;

/// Serializes read-modify-write cycles; commands run on several threads.
static LOCK: Mutex<()> = Mutex::new(());

pub fn load<R: Runtime>(app: &AppHandle<R>, file: &str) -> Vec<Value> {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    read(&path(app, file))
}

/// Inserts `record`, or replaces the stored one with the same `id`.
pub fn save_record<R: Runtime>(app: &AppHandle<R>, file: &str, record: Value) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = path(app, file);
    let mut records = read(&path);
    upsert(&mut records, record)?;
    write(&path, &records)
}

fn path<R: Runtime>(app: &AppHandle<R>, file: &str) -> PathBuf {
    settings::data_dir(app).join(file)
}

fn upsert(records: &mut Vec<Value>, record: Value) -> Result<(), String> {
    let id = record
        .get("id")
        .and_then(Value::as_str)
        .ok_or("history record without an id")?
        .to_string();
    match records.iter().position(|r| r.get("id").and_then(Value::as_str) == Some(&id)) {
        Some(index) => records[index] = record,
        None => records.insert(0, record),
    }
    records.truncate(MAX_RECORDS);
    Ok(())
}

fn read(path: &Path) -> Vec<Value> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(e) => {
            log::error!("Cannot read {}: {e}", path.display());
            return Vec::new();
        }
    };
    serde_json::from_slice(&bytes).unwrap_or_else(|e| {
        log::error!("{} is not valid JSON, history starts empty: {e}", path.display());
        Vec::new()
    })
}

/// Written to a temporary file and renamed over the old one, so a crash
/// mid-write cannot leave a truncated file and lose the history.
fn write(path: &Path, records: &[Value]) -> Result<(), String> {
    let fail = |action: &str, e: &dyn std::fmt::Display| {
        let msg = format!("Cannot {action} {}: {e}", path.display());
        log::error!("{msg}");
        msg
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| fail("create the folder for", &e))?;
    }
    let json = serde_json::to_vec_pretty(records).map_err(|e| fail("serialize", &e))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| fail("write", &e))?;
    fs::rename(&tmp, path).map_err(|e| fail("replace", &e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn new_records_go_on_top_and_updates_replace() {
        let mut records = vec![json!({ "id": "a", "status": "done" })];
        upsert(&mut records, json!({ "id": "b", "status": "pending" })).unwrap();
        upsert(&mut records, json!({ "id": "a", "status": "refunded" })).unwrap();
        assert_eq!(
            Value::Array(records),
            json!([{ "id": "b", "status": "pending" }, { "id": "a", "status": "refunded" }])
        );
    }

    #[test]
    fn keeps_at_most_the_newest_records() {
        let mut records = Vec::new();
        for i in 0..MAX_RECORDS + 3 {
            upsert(&mut records, json!({ "id": i.to_string() })).unwrap();
        }
        assert_eq!(records.len(), MAX_RECORDS);
        assert_eq!(records[0]["id"], json!((MAX_RECORDS + 2).to_string()));
    }

    #[test]
    fn refuses_a_record_without_id() {
        assert!(upsert(&mut Vec::new(), json!({ "status": "done" })).is_err());
    }

    #[test]
    fn round_trips_through_the_file() {
        let dir = std::env::temp_dir().join(format!("coinman-history-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("data").join("exchange-history.json");

        assert!(read(&path).is_empty());
        let records = vec![json!({ "id": "x", "provider": "relay" })];
        write(&path, &records).unwrap();
        assert_eq!(read(&path), records);
        assert!(!path.with_extension("json.tmp").exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
