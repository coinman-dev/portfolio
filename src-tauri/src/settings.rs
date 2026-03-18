use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
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

/// Per-user settings stored inside the "users" map in settings.json.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    #[serde(default)]
    pub active_portfolio_id: Option<Value>,
    #[serde(default)]
    pub portfolio_order: Option<Vec<Value>>,
    #[serde(default)]
    pub market_cache: Option<Value>,
    #[serde(default)]
    pub market_cache_saved_at: Option<u64>,
}

/// The on-disk settings.json structure.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Global: window geometry, shared across all databases.
    #[serde(default)]
    pub window_state: Option<WinState>,
    /// Global: UI preference, shared across all databases.
    #[serde(default)]
    pub show_cur_price: Option<bool>,
    #[serde(default)]
    pub is_collapsed: Option<bool>,
    /// Global: column widths, shared across all databases.
    #[serde(default)]
    pub column_widths: Option<Value>,
    /// Per-user (per-database) settings keyed by database filename stem.
    #[serde(default)]
    pub users: HashMap<String, UserSettings>,
}

/// Flat view returned to the frontend: global fields merged with the
/// per-user fields for the requested database user.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsForUser {
    pub window_state: Option<WinState>,
    pub show_cur_price: Option<bool>,
    pub is_collapsed: Option<bool>,
    pub column_widths: Option<Value>,
    pub active_portfolio_id: Option<Value>,
    pub portfolio_order: Option<Vec<Value>>,
    pub market_cache: Option<Value>,
    pub market_cache_saved_at: Option<u64>,
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Load only the global (non-user-specific) settings.
pub fn load_global<R: Runtime>(app: &AppHandle<R>) -> AppSettings {
    load(app)
}

/// Return merged global + per-user settings for the given database user.
pub fn load_for_user<R: Runtime>(app: &AppHandle<R>, user: &str) -> AppSettingsForUser {
    let settings = load(app);
    let u = settings.users.get(user).cloned().unwrap_or_default();
    AppSettingsForUser {
        window_state: settings.window_state,
        show_cur_price: settings.show_cur_price,
        is_collapsed: settings.is_collapsed,
        column_widths: settings.column_widths,
        active_portfolio_id: u.active_portfolio_id,
        portfolio_order: u.portfolio_order,
        market_cache: u.market_cache,
        market_cache_saved_at: u.market_cache_saved_at,
    }
}

pub fn update_window_state<R: Runtime>(app: &AppHandle<R>, state: WinState) {
    let mut settings = load(app);
    settings.window_state = Some(state);
    save(app, &settings);
}

pub fn update_market_cache<R: Runtime>(app: &AppHandle<R>, user: &str, cache: Value, saved_at: u64) {
    let mut settings = load(app);
    let entry = settings.users.entry(user.to_string()).or_default();
    entry.market_cache = Some(cache);
    entry.market_cache_saved_at = Some(saved_at);
    save(app, &settings);
}

pub fn update_active_portfolio_id<R: Runtime>(app: &AppHandle<R>, user: &str, id: Value) {
    let mut settings = load(app);
    settings.users.entry(user.to_string()).or_default().active_portfolio_id = Some(id);
    save(app, &settings);
}

pub fn update_column_widths<R: Runtime>(app: &AppHandle<R>, widths: Value) {
    let mut settings = load(app);
    settings.column_widths = Some(widths);
    save(app, &settings);
}

pub fn update_show_cur_price<R: Runtime>(app: &AppHandle<R>, show: bool) {
    let mut settings = load(app);
    settings.show_cur_price = Some(show);
    save(app, &settings);
}

pub fn update_is_collapsed<R: Runtime>(app: &AppHandle<R>, collapsed: bool) {
    let mut settings = load(app);
    settings.is_collapsed = Some(collapsed);
    save(app, &settings);
}

pub fn update_portfolio_order<R: Runtime>(app: &AppHandle<R>, user: &str, order: Vec<Value>) {
    let mut settings = load(app);
    settings.users.entry(user.to_string()).or_default().portfolio_order = Some(order);
    save(app, &settings);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

fn load<R: Runtime>(app: &AppHandle<R>) -> AppSettings {
    let path = settings_path(app);
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(_) => return AppSettings::default(),
    };

    let mut settings: AppSettings = serde_json::from_slice(&bytes).unwrap_or_default();

    // One-time migration: if the file was written in the old flat format
    // (per-user fields at the top level), move them into the "default" user slot.
    if settings.users.is_empty() {
        if let Ok(raw) = serde_json::from_slice::<Value>(&bytes) {
            let mut u = UserSettings::default();
            let mut found = false;

            if let Some(v) = raw.get("activePortfolioId") {
                u.active_portfolio_id = Some(v.clone());
                found = true;
            }
            if let Some(arr) = raw.get("portfolioOrder").and_then(|v| v.as_array()) {
                u.portfolio_order = Some(arr.clone());
                found = true;
            }
            if let Some(v) = raw.get("marketCache") {
                u.market_cache = Some(v.clone());
                found = true;
            }
            if let Some(ts) = raw.get("marketCacheSavedAt").and_then(|v| v.as_u64()) {
                u.market_cache_saved_at = Some(ts);
                found = true;
            }

            if found {
                settings.users.insert("default".to_string(), u);
            }
        }
    }

    settings
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
