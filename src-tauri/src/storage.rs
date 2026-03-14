use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

const DEFAULT_USER: &str = "default";
const DEFAULT_IMAGE_DIR: &str = "images/logo";
const SEEDED_COIN_CATALOG_JSON: &str = include_str!("../../frontend/coinbase/cmc.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbData {
    pub portfolios: Vec<Value>,
    pub active_portfolio_id: Option<Value>,
    #[serde(default)]
    pub window_state: Option<WindowState>,
}

impl Default for DbData {
    fn default() -> Self {
        Self {
            portfolios: Vec::new(),
            active_portfolio_id: None,
            window_state: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapConfig {
    pub user: String,
    pub coinbase: CoinCatalogConfig,
    pub debug_mode: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoinCatalogConfig {
    pub image_dir: String,
    pub coins: Vec<CoinCatalogEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CoinCatalogEntry {
    pub id: String,
    pub name: String,
    pub symbol: String,
}

#[derive(Debug, Deserialize)]
struct CoinCatalogSource {
    #[serde(default, rename = "imageDir")]
    image_dir: Option<String>,
    #[serde(default)]
    coins: Vec<CoinCatalogSourceEntry>,
}

#[derive(Debug, Deserialize)]
struct CoinCatalogSourceEntry {
    #[serde(default)]
    id: Value,
    #[serde(default)]
    name: String,
    #[serde(default)]
    symbol: String,
}

pub fn sanitize_user(value: Option<String>) -> String {
    let raw = value.unwrap_or_else(|| DEFAULT_USER.to_string());
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return DEFAULT_USER.to_string();
    }

    if trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        trimmed.to_string()
    } else {
        DEFAULT_USER.to_string()
    }
}

pub fn load_bootstrap<R: Runtime>(_app: &AppHandle<R>, debug_mode: bool) -> Result<BootstrapConfig, String> {
    Ok(BootstrapConfig {
        user: DEFAULT_USER.to_string(),
        coinbase: load_coin_catalog()?,
        debug_mode,
    })
}

pub fn load_db<R: Runtime>(app: &AppHandle<R>, user: &str) -> Result<DbData, String> {
    let path = ensure_db_file(app, user)?;
    let raw = fs::read_to_string(&path).map_err(|e| format_file_error("read", &path, e))?;
    if raw.trim().is_empty() {
        return Ok(DbData::default());
    }

    let decoded = serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null);
    Ok(normalize_db_value(decoded))
}

pub fn save_db<R: Runtime>(app: &AppHandle<R>, user: &str, mut data: DbData) -> Result<(), String> {
    if data.window_state.is_none() {
        if let Ok(existing) = load_db(app, user) {
            data.window_state = existing.window_state;
        }
    }
    let path = resolve_db_file_path(app, user)?;
    let payload = serialize_db_data(normalize_db_data(data))?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format_file_error("create directory", parent, e))?;
    }

    fs::write(&path, payload).map_err(|e| format_file_error("write", &path, e))
}

pub fn clear_db<R: Runtime>(app: &AppHandle<R>, user: &str) -> Result<(), String> {
    save_db(app, user, DbData::default())
}

fn load_coin_catalog() -> Result<CoinCatalogConfig, String> {
    let mut image_dir = DEFAULT_IMAGE_DIR.to_string();
    let mut coins = Vec::new();

    let decoded = serde_json::from_str::<CoinCatalogSource>(SEEDED_COIN_CATALOG_JSON)
        .map_err(|e| format!("Invalid embedded coin catalog JSON: {e}"))?;

    if let Some(custom_dir) = decoded.image_dir {
        let trimmed = custom_dir.trim().trim_end_matches('/').to_string();
        if !trimmed.is_empty() {
            image_dir = trimmed;
        }
    }

    for coin in decoded.coins {
        let symbol = coin.symbol.trim().to_uppercase();
        if symbol.is_empty() {
            continue;
        }

        let mut id = match coin.id {
            Value::String(s) => s.trim().to_string(),
            Value::Number(n) => n.to_string(),
            _ => String::new(),
        };
        if !id.chars().all(|c| c.is_ascii_digit()) {
            id.clear();
        }

        let name = if coin.name.trim().is_empty() {
            symbol.clone()
        } else {
            coin.name.trim().to_string()
        };

        coins.push(CoinCatalogEntry { id, name, symbol });
    }

    Ok(CoinCatalogConfig { image_dir, coins })
}

fn normalize_db_value(value: Value) -> DbData {
    match value {
        Value::Array(portfolios) => normalize_db_data(DbData {
            portfolios,
            active_portfolio_id: None,
            window_state: None,
        }),
        Value::Object(mut object) => {
            let portfolios = match object.remove("portfolios") {
                Some(Value::Array(portfolios)) => portfolios,
                _ => Vec::new(),
            };
            let active_portfolio_id = sanitize_active_id(object.remove("activePortfolioId"));
            let window_state = object
                .remove("windowState")
                .and_then(|v| serde_json::from_value(v).ok());
            normalize_db_data(DbData {
                portfolios,
                active_portfolio_id,
                window_state,
            })
        }
        _ => DbData::default(),
    }
}

fn normalize_db_data(mut data: DbData) -> DbData {
    data.active_portfolio_id = sanitize_active_id(data.active_portfolio_id);
    if data.active_portfolio_id.is_none() {
        data.active_portfolio_id = first_portfolio_id(&data.portfolios);
    }
    data
}

fn sanitize_active_id(value: Option<Value>) -> Option<Value> {
    match value {
        Some(Value::Null) | None => None,
        Some(Value::Bool(v)) => Some(Value::Bool(v)),
        Some(Value::Number(v)) => Some(Value::Number(v)),
        Some(Value::String(v)) => Some(Value::String(v)),
        _ => None,
    }
}

fn first_portfolio_id(portfolios: &[Value]) -> Option<Value> {
    portfolios.iter().find_map(|portfolio| match portfolio {
        Value::Object(object) => sanitize_active_id(object.get("id").cloned()),
        _ => None,
    })
}

fn serialize_db_data(data: DbData) -> Result<String, String> {
    let mut root = Map::new();
    root.insert("portfolios".to_string(), Value::Array(data.portfolios));
    root.insert(
        "activePortfolioId".to_string(),
        data.active_portfolio_id.unwrap_or(Value::Null),
    );
    if let Some(window_state) = data.window_state {
        if let Ok(value) = serde_json::to_value(window_state) {
            root.insert("windowState".to_string(), value);
        }
    }

    serde_json::to_string_pretty(&Value::Object(root))
        .map(|json| format!("{json}\n"))
        .map_err(|e| format!("Cannot encode database JSON: {e}"))
}

fn ensure_db_file<R: Runtime>(app: &AppHandle<R>, user: &str) -> Result<PathBuf, String> {
    let path = resolve_db_file_path(app, user)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format_file_error("create directory", parent, e))?;
    }

    if !path.is_file() {
        let payload = empty_db_payload()?;
        fs::write(&path, payload).map_err(|e| format_file_error("write", &path, e))?;
    }

    Ok(path)
}

fn resolve_db_file_path<R: Runtime>(app: &AppHandle<R>, user: &str) -> Result<PathBuf, String> {
    let base_dir = database_dir(app)?;
    Ok(base_dir.join(format!("{user}.json")))
}

fn database_dir<R: Runtime>(_app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(exe_dir) = current_exe_dir() {
        return Ok(exe_dir.join("database"));
    }

    Ok(project_root().join("database"))
}

fn current_exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
}

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .to_path_buf()
}

fn format_file_error(action: &str, path: &Path, error: std::io::Error) -> String {
    format!("Cannot {action} `{}`: {error}", path.display())
}

fn empty_db_payload() -> Result<String, String> {
    serialize_db_data(DbData::default())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbFileInfo {
    pub name: String,
    pub modified_ms: u64,
    pub coin_count: usize,
}

pub fn get_db_dir_str<R: Runtime>(app: &AppHandle<R>) -> String {
    match database_dir(app) {
        Ok(path) => path.to_string_lossy().into_owned(),
        Err(e) => format!("(error: {e})"),
    }
}

pub fn get_db_dir_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    database_dir(app).ok()
}

pub fn list_db_files<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<DbFileInfo>, String> {
    use std::time::UNIX_EPOCH;

    let db_dir = database_dir(app)?;
    if !db_dir.is_dir() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&db_dir)
        .map_err(|e| format!("Cannot read database directory: {e}"))?;

    let mut files: Vec<DbFileInfo> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                return None;
            }
            let name = path.file_stem()?.to_str()?.to_string();
            let modified_ms = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let coin_count = count_coins_in_file(&path);
            Some(DbFileInfo { name, modified_ms, coin_count })
        })
        .collect();

    files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(files)
}

fn count_coins_in_file(path: &Path) -> usize {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return 0,
    };
    let value: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return 0,
    };
    let portfolios = match &value {
        Value::Object(obj) => match obj.get("portfolios") {
            Some(Value::Array(arr)) => arr.clone(),
            _ => return 0,
        },
        Value::Array(arr) => arr.clone(),
        _ => return 0,
    };
    let mut symbols = std::collections::HashSet::new();
    for p in &portfolios {
        if let Value::Object(obj) = p {
            if let Some(Value::Array(transactions)) = obj.get("transactions") {
                for tx in transactions {
                    if let Value::Object(tx_obj) = tx {
                        if let Some(Value::String(sym)) = tx_obj.get("symbol") {
                            if !sym.is_empty() {
                                symbols.insert(sym.to_uppercase());
                            }
                        }
                    }
                }
            }
        }
    }
    symbols.len()
}
