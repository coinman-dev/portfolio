//! Jumper Exchange settings that survive a restart, in `data/jumper-storage.json`.
//!
//! The embedded view is private, so jumper.xyz's local storage vanishes on
//! exit. Only the keys that hold settings come back: the LI.FI widget's
//! (route priority, gas, slippage, bridges and exchanges), Jumper's own store,
//! and wagmi's record of the last wallet so the CoinMan wallet reconnects.
//! WalletConnect sessions, analytics ids and everything else are left behind.

use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};

use crate::settings;

/// Larger than any settings blob; a page trying to store more is refused.
const MAX_BYTES: usize = 512 * 1024;

static LOCK: Mutex<()> = Mutex::new(());

/// Keys worth keeping. Must match `KEPT` in jumper_page.js.
pub fn is_kept(key: &str) -> bool {
    key.starts_with("jumper-")
        || key.ends_with("-widget-settings")
        || key == "wagmi.store"
        || key == "wagmi.recentConnectorId"
}

fn path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    settings::data_dir(app).join("jumper-storage.json")
}

fn keep_only(items: Map<String, Value>) -> Map<String, Value> {
    items
        .into_iter()
        .filter(|(key, value)| is_kept(key) && value.is_string())
        .collect()
}

fn read(path: &Path) -> Map<String, Value> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(keep_only).unwrap_or_default(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Map::new(),
        Err(e) => {
            log::error!("Cannot read {}: {e}", path.display());
            Map::new()
        }
    }
}

/// Replaces the stored settings with `items` (only the kept keys).
pub fn save<R: Runtime>(app: &AppHandle<R>, items: Map<String, Value>) -> Result<(), String> {
    let items = keep_only(items);
    let json = serde_json::to_vec(&items).map_err(|e| e.to_string())?;
    if json.len() > MAX_BYTES {
        return Err("settings too large".into());
    }
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    write(&path(app), &json)
}

/// Written to a temporary file and renamed over the old one.
fn write(path: &Path, json: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// A line for the page script: the saved settings, put back into local
/// storage before jumper.xyz's own code reads it.
pub fn bootstrap_script<R: Runtime>(app: &AppHandle<R>) -> String {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let saved = Value::Object(read(&path(app)));
    format!("window.__coinmanJumperSaved = {saved};\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_settings_and_drops_the_rest() {
        let items = json!({
            "jumper-advanced-widget-settings": "{\"state\":{\"slippage\":\"0.5\"}}",
            "li.fi-widget-settings": "{}",
            "jumper-store": "{}",
            "wagmi.store": "{}",
            "wagmi.recentConnectorId": "\"dev.coinman.wallet\"",
            "wc@2:client:0.3:session": "secret",
            "ph_phc_posthog": "id",
            "jumper-number": 5
        });
        let kept = keep_only(items.as_object().unwrap().clone());
        let mut keys: Vec<&str> = kept.keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "jumper-advanced-widget-settings",
                "jumper-store",
                "li.fi-widget-settings",
                "wagmi.recentConnectorId",
                "wagmi.store"
            ]
        );
    }

    #[test]
    fn round_trips_through_the_file() {
        let dir = std::env::temp_dir().join(format!("coinman-jumper-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("data").join("jumper-storage.json");
        assert!(read(&path).is_empty());
        let items = json!({ "jumper-store": "{\"a\":1}" });
        write(&path, &serde_json::to_vec(&items).unwrap()).unwrap();
        assert_eq!(Value::Object(read(&path)), items);
        let _ = fs::remove_dir_all(&dir);
    }
}
