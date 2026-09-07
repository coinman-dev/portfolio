use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WinState {
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
}

/// Per-user settings stored inside the "users" map in data/settings.json.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    #[serde(default)]
    pub active_portfolio_id: Option<Value>,
    #[serde(default)]
    pub portfolio_order: Option<Vec<Value>>,
}

/// Per-user market data, kept in data/cache.json. It is disposable: deleting
/// the file only costs a re-fetch, which is why it does not live in settings.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserCache {
    #[serde(default)]
    pub market_cache: Option<Value>,
    #[serde(default)]
    pub market_cache_saved_at: Option<u64>,
}

/// The on-disk data/cache.json structure.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppCache {
    #[serde(default)]
    pub users: HashMap<String, UserCache>,
}

/// The on-disk data/settings.json structure.
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
    /// Global: whether to automatically align column widths
    #[serde(default)]
    pub auto_align_columns: Option<bool>,
    #[serde(default)]
    pub show_table_footer: Option<bool>,
    /// Global: column widths, shared across all databases.
    #[serde(default)]
    pub column_widths: Option<Value>,
    /// Global: timestamp (ms since epoch) of the last update check.
    #[serde(default)]
    pub last_update_check: Option<u64>,
    /// Global: CoinMarketCap API key for price fetching.
    #[serde(default)]
    pub cmc_api_key: Option<String>,
    /// Global: whether to use CMC instead of CoinGecko for prices.
    #[serde(default)]
    pub use_cmc: Option<bool>,
    /// Global: Exchange settings, connected wallets, session cache
    #[serde(default)]
    pub exchange: Option<Value>,
    /// Global: Earn settings, connected vaults, network filters
    #[serde(default)]
    pub earn: Option<Value>,
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
    pub auto_align_columns: Option<bool>,
    pub show_table_footer: Option<bool>,
    pub column_widths: Option<Value>,
    pub cmc_api_key: Option<String>,
    pub use_cmc: Option<bool>,
    pub exchange: Option<Value>,
    pub earn: Option<Value>,
    pub active_portfolio_id: Option<Value>,
    pub portfolio_order: Option<Vec<Value>>,
    pub market_cache: Option<Value>,
    pub market_cache_saved_at: Option<u64>,
    pub last_update_check: Option<u64>,
}

// ─── Public API ─────────────────────────────────────────────────────────────

/// Load only the global (non-user-specific) settings.
pub fn load_global<R: Runtime>(app: &AppHandle<R>) -> AppSettings {
    load(app)
}

/// Return merged global + per-user settings for the given database user.
pub fn load_for_user<R: Runtime>(app: &AppHandle<R>, user: &str) -> AppSettingsForUser {
    let settings = load(app);
    let u = settings.users.get(user).cloned().unwrap_or_default();
    let c = load_cache(app).users.get(user).cloned().unwrap_or_default();
    AppSettingsForUser {
        window_state: settings.window_state,
        show_cur_price: settings.show_cur_price,
        is_collapsed: settings.is_collapsed,
        auto_align_columns: settings.auto_align_columns,
        show_table_footer: settings.show_table_footer,
        column_widths: settings.column_widths,
        cmc_api_key: settings.cmc_api_key,
        use_cmc: settings.use_cmc,
        exchange: settings.exchange,
        earn: settings.earn,
        active_portfolio_id: u.active_portfolio_id,
        portfolio_order: u.portfolio_order,
        market_cache: c.market_cache,
        market_cache_saved_at: c.market_cache_saved_at,
        last_update_check: settings.last_update_check,
    }
}

pub fn update_window_state<R: Runtime>(app: &AppHandle<R>, state: WinState) {
    let mut settings = load(app);
    settings.window_state = Some(state);
    save(app, &settings);
}

pub fn update_market_cache<R: Runtime>(
    app: &AppHandle<R>,
    user: &str,
    cache: Value,
    saved_at: u64,
) {
    let mut store = load_cache(app);
    let entry = store.users.entry(user.to_string()).or_default();
    entry.market_cache = Some(cache);
    entry.market_cache_saved_at = Some(saved_at);
    save_cache(app, &store);
}

pub fn update_active_portfolio_id<R: Runtime>(app: &AppHandle<R>, user: &str, id: Value) {
    let mut settings = load(app);
    settings
        .users
        .entry(user.to_string())
        .or_default()
        .active_portfolio_id = Some(id);
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

pub fn update_auto_align_columns<R: Runtime>(app: &AppHandle<R>, align: bool) {
    let mut settings = load(app);
    settings.auto_align_columns = Some(align);
    save(app, &settings);
}

pub fn update_show_table_footer<R: Runtime>(app: &AppHandle<R>, show: bool) {
    let mut settings = load(app);
    settings.show_table_footer = Some(show);
    save(app, &settings);
}

pub fn update_is_collapsed<R: Runtime>(app: &AppHandle<R>, collapsed: bool) {
    let mut settings = load(app);
    settings.is_collapsed = Some(collapsed);
    save(app, &settings);
}

pub fn update_cmc_api_key<R: Runtime>(app: &AppHandle<R>, key: String) {
    let mut settings = load(app);
    settings.cmc_api_key = if key.is_empty() { None } else { Some(key) };
    save(app, &settings);
}

pub fn update_use_cmc<R: Runtime>(app: &AppHandle<R>, use_cmc: bool) {
    let mut settings = load(app);
    settings.use_cmc = Some(use_cmc);
    save(app, &settings);
}

pub fn update_last_update_check<R: Runtime>(app: &AppHandle<R>, timestamp: u64) {
    let mut settings = load(app);
    settings.last_update_check = Some(timestamp);
    save(app, &settings);
}

pub fn update_portfolio_order<R: Runtime>(app: &AppHandle<R>, user: &str, order: Vec<Value>) {
    let mut settings = load(app);
    settings
        .users
        .entry(user.to_string())
        .or_default()
        .portfolio_order = Some(order);
    save(app, &settings);
}

pub fn load_exchange_settings<R: Runtime>(app: &AppHandle<R>) -> Value {
    let settings = load(app);
    settings.exchange.unwrap_or(Value::Null)
}

pub fn update_exchange_settings<R: Runtime>(app: &AppHandle<R>, exchange: Value) {
    let mut settings = load(app);
    settings.exchange = Some(exchange);
    save(app, &settings);
}

pub fn load_earn_settings<R: Runtime>(app: &AppHandle<R>) -> Value {
    let settings = load(app);
    settings.earn.unwrap_or(Value::Null)
}

pub fn update_earn_settings<R: Runtime>(app: &AppHandle<R>, earn: Value) {
    let mut settings = load(app);
    settings.earn = Some(earn);
    save(app, &settings);
}

// ─── Internal ───────────────────────────────────────────────────────────────

fn load<R: Runtime>(app: &AppHandle<R>) -> AppSettings {
    migrate_legacy_layout(app);

    let bytes = match fs::read(settings_path(app)) {
        Ok(b) => b,
        Err(_) => return AppSettings::default(),
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn save<R: Runtime>(app: &AppHandle<R>, settings: &AppSettings) {
    let path = settings_path(app);
    let _ = fs::create_dir_all(data_dir(app));
    if let Ok(json) = serde_json::to_vec_pretty(settings) {
        let _ = fs::write(&path, json);
    }
}

fn load_cache<R: Runtime>(app: &AppHandle<R>) -> AppCache {
    migrate_legacy_layout(app);

    let bytes = match fs::read(cache_path(app)) {
        Ok(b) => b,
        Err(_) => return AppCache::default(),
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn save_cache<R: Runtime>(app: &AppHandle<R>, cache: &AppCache) {
    let path = cache_path(app);
    let _ = fs::create_dir_all(data_dir(app));
    if let Ok(json) = serde_json::to_vec_pretty(cache) {
        let _ = fs::write(&path, json);
    }
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    data_dir(app).join("settings.json")
}

fn cache_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    data_dir(app).join("cache.json")
}

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    base_dir(app).join("data")
}

fn base_dir<R: Runtime>(_app: &AppHandle<R>) -> PathBuf {
    if let Some(exe_dir) = current_exe_dir() {
        return exe_dir;
    }
    project_root()
}

/// Moves the pre-0.7 `settings-cache.json` (settings and market cache in one
/// file next to the executable) into `data/settings.json` + `data/cache.json`.
///
/// Runs at most once per process and is a no-op once `data/settings.json`
/// exists. The legacy file is left in place: it is the user's only copy of
/// these settings, and this code must not be the thing that deletes it.
fn migrate_legacy_layout<R: Runtime>(app: &AppHandle<R>) {
    static DONE: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    DONE.get_or_init(|| migrate_legacy_layout_at(&base_dir(app)));
}

fn migrate_legacy_layout_at(base: &Path) {
    let data = base.join("data");
    let target = data.join("settings.json");
    if target.exists() {
        return;
    }

    let legacy = base.join("settings-cache.json");
    let bytes = match fs::read(&legacy) {
        Ok(b) => b,
        Err(_) => return,
    };

    let raw: Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => return,
    };

    let mut settings: AppSettings = serde_json::from_value(raw.clone()).unwrap_or_default();
    let mut cache = AppCache::default();

    // Per-user blocks used to carry the market cache alongside the settings.
    if let Some(users) = raw.get("users").and_then(|v| v.as_object()) {
        for (name, entry) in users {
            let user_cache = UserCache {
                market_cache: entry.get("marketCache").cloned(),
                market_cache_saved_at: entry.get("marketCacheSavedAt").and_then(|v| v.as_u64()),
            };
            if user_cache.market_cache.is_some() || user_cache.market_cache_saved_at.is_some() {
                cache.users.insert(name.clone(), user_cache);
            }
        }
    }

    // Even older format: per-user fields sat at the top level.
    if settings.users.is_empty() {
        let mut u = UserSettings::default();
        if let Some(v) = raw.get("activePortfolioId") {
            u.active_portfolio_id = Some(v.clone());
        }
        if let Some(arr) = raw.get("portfolioOrder").and_then(|v| v.as_array()) {
            u.portfolio_order = Some(arr.clone());
        }
        if u.active_portfolio_id.is_some() || u.portfolio_order.is_some() {
            settings.users.insert("default".to_string(), u);
        }

        let flat = UserCache {
            market_cache: raw.get("marketCache").cloned(),
            market_cache_saved_at: raw.get("marketCacheSavedAt").and_then(|v| v.as_u64()),
        };
        if flat.market_cache.is_some() || flat.market_cache_saved_at.is_some() {
            cache.users.insert("default".to_string(), flat);
        }
    }

    if fs::create_dir_all(&data).is_err() {
        return;
    }
    if let Ok(json) = serde_json::to_vec_pretty(&settings) {
        let _ = fs::write(&target, json);
    }
    if !cache.users.is_empty() {
        if let Ok(json) = serde_json::to_vec_pretty(&cache) {
            let _ = fs::write(data.join("cache.json"), json);
        }
    }
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

#[cfg(test)]
mod migration_tests {
    use super::*;
    use serde_json::json;

    /// The legacy single-file layout must split into data/settings.json and
    /// data/cache.json without losing anything.
    #[test]
    fn splits_legacy_settings_cache() {
        let dir = std::env::temp_dir().join(format!("coinman-mig-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let legacy = json!({
            "windowState": { "width": 1200.0, "height": 800.0, "x": 10.0, "y": 20.0 },
            "showCurPrice": true,
            "cmcApiKey": "secret-key",
            "exchange": { "slippage": 0.25 },
            "earn": { "portfolioTab": "activity" },
            "users": {
                "vova": {
                    "activePortfolioId": 3,
                    "portfolioOrder": [3, 1],
                    "marketCache": { "BTC": 79909 },
                    "marketCacheSavedAt": 1757000000000u64
                }
            }
        });
        fs::write(
            dir.join("settings-cache.json"),
            serde_json::to_vec_pretty(&legacy).unwrap(),
        )
        .unwrap();

        migrate_legacy_layout_at(&dir);

        let settings: AppSettings =
            serde_json::from_slice(&fs::read(dir.join("data/settings.json")).unwrap()).unwrap();
        assert_eq!(settings.cmc_api_key.as_deref(), Some("secret-key"));
        assert_eq!(settings.show_cur_price, Some(true));
        assert_eq!(settings.window_state.as_ref().map(|w| w.width), Some(1200.0));
        assert!(settings.exchange.is_some());
        assert!(settings.earn.is_some());
        let user = settings.users.get("vova").expect("user settings kept");
        assert_eq!(user.active_portfolio_id, Some(json!(3)));
        assert_eq!(user.portfolio_order, Some(vec![json!(3), json!(1)]));

        let cache: AppCache =
            serde_json::from_slice(&fs::read(dir.join("data/cache.json")).unwrap()).unwrap();
        let cached = cache.users.get("vova").expect("market cache moved");
        assert_eq!(cached.market_cache, Some(json!({ "BTC": 79909 })));
        assert_eq!(cached.market_cache_saved_at, Some(1757000000000));

        // The user's only copy of these settings must survive the move.
        assert!(dir.join("settings-cache.json").exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
