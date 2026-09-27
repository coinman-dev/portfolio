//! Connected wallets, kept in `data/wallets.json`.
//!
//! The webview is private and forgets everything on exit, so the WalletConnect
//! sessions (one isolated key-value namespace per wallet) and the list of
//! wallets are stored here instead. The file is a flat string map owned by the
//! frontend; this side only loads it and applies batched changes.
//!
//! It holds session keys, so its contents never go to the diagnostic log.

use serde_json::{Map, Value};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};

use crate::settings;

/// Serializes read-modify-write cycles; commands run on several threads.
static LOCK: Mutex<()> = Mutex::new(());

pub fn load<R: Runtime>(app: &AppHandle<R>) -> Map<String, Value> {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    read(&path(app))
}

/// Applies `items`: a string value sets the key, `null` removes it.
pub fn save_items<R: Runtime>(app: &AppHandle<R>, items: Map<String, Value>) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = path(app);
    let mut store = read(&path);
    apply(&mut store, items);
    write(&path, &store)
}

fn path<R: Runtime>(app: &AppHandle<R>) -> std::path::PathBuf {
    settings::data_dir(app).join("wallets.json")
}

fn apply(store: &mut Map<String, Value>, items: Map<String, Value>) {
    for (key, value) in items {
        match value {
            Value::String(_) => {
                store.insert(key, value);
            }
            _ => {
                store.remove(&key);
            }
        }
    }
}

fn read(path: &Path) -> Map<String, Value> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Map::new(),
        Err(e) => {
            log::error!("Cannot read {}: {e}", path.display());
            return Map::new();
        }
    };
    serde_json::from_slice(&bytes).unwrap_or_else(|e| {
        log::error!(
            "{} is not valid JSON, wallets start empty: {e}",
            path.display()
        );
        Map::new()
    })
}

/// Written to a temporary file and renamed over the old one, so a crash
/// mid-write cannot leave a truncated file and lose every session.
fn write(path: &Path, store: &Map<String, Value>) -> Result<(), String> {
    let fail = |action: &str, e: &dyn std::fmt::Display| {
        let msg = format!("Cannot {action} {}: {e}", path.display());
        log::error!("{msg}");
        msg
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| fail("create the folder for", &e))?;
    }
    let json = serde_json::to_vec_pretty(store).map_err(|e| fail("serialize", &e))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| fail("write", &e))?;
    fs::rename(&tmp, path).map_err(|e| fail("replace", &e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sets_and_removes_keys() {
        let mut store = Map::new();
        store.insert("keep".into(), json!("1"));
        store.insert("drop".into(), json!("2"));
        let items = json!({ "drop": null, "new": "3" });
        apply(&mut store, items.as_object().unwrap().clone());
        assert_eq!(Value::Object(store), json!({ "keep": "1", "new": "3" }));
    }

    #[test]
    fn round_trips_through_the_file() {
        let dir = std::env::temp_dir().join(format!("coinman-wallets-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("data").join("wallets.json");

        assert!(read(&path).is_empty());
        let mut store = Map::new();
        store.insert("wc:abc:session".into(), json!("{\"topic\":\"t\"}"));
        write(&path, &store).unwrap();
        assert_eq!(read(&path), store);
        assert!(!path.with_extension("json.tmp").exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
