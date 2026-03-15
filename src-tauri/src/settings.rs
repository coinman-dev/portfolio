use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::fs;
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WinState {
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub window_state: Option<WinState>,
    #[serde(default)]
    pub market_cache: Option<Value>,
    #[serde(default)]
    pub market_cache_saved_at: Option<u64>,
    #[serde(default)]
    pub active_portfolio_id: Option<Value>,
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> AppSettings {
    let path = settings_path(app);
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(_) => return AppSettings::default(),
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

pub fn update_window_state<R: Runtime>(app: &AppHandle<R>, state: WinState) {
    let mut settings = load(app);
    settings.window_state = Some(state);
    save(app, &settings);
}

pub fn update_market_cache<R: Runtime>(app: &AppHandle<R>, cache: Value, saved_at: u64) {
    let mut settings = load(app);
    settings.market_cache = Some(cache);
    settings.market_cache_saved_at = Some(saved_at);
    save(app, &settings);
}

pub fn update_active_portfolio_id<R: Runtime>(app: &AppHandle<R>, id: Value) {
    let mut settings = load(app);
    settings.active_portfolio_id = Some(id);
    save(app, &settings);
}

fn save<R: Runtime>(app: &AppHandle<R>, settings: &AppSettings) {
    let path = settings_path(app);
    if let Ok(json) = serde_json::to_vec_pretty(settings) {
        let _ = fs::write(&path, json);
    }
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    base_dir(app).join("settings.json")
}

fn base_dir<R: Runtime>(_app: &AppHandle<R>) -> PathBuf {
    if let Some(exe_dir) = current_exe_dir() {
        return exe_dir;
    }
    project_root()
}

fn current_exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
}

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .to_path_buf()
}
