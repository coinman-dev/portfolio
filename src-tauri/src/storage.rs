use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

const DEFAULT_USER: &str = "default";
const DEFAULT_IMAGE_DIR: &str = "images/logo";
const SEEDED_COIN_CATALOG_JSON: &str = include_str!("../../frontend/coinbase/cmc.json");

const ENC_MAGIC: &[u8] = b"COINMAN_ENC_V1\n";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

// ─── Data structures ──────────────────────────────────────────────────────────

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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbFileInfo {
    pub name: String,
    pub modified_ms: u64,
    pub coin_count: usize,
    pub encrypted: bool,
}

// ─── Encryption ───────────────────────────────────────────────────────────────

pub fn is_file_encrypted(bytes: &[u8]) -> bool {
    bytes.starts_with(ENC_MAGIC)
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(65536, 2, 1, Some(32))
        .map_err(|e| format!("Argon2 params error: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Key derivation failed: {e}"))?;
    Ok(key)
}

fn encrypt_json(json: &str, password: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let key_bytes = derive_key(password, &salt)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, json.as_bytes())
        .map_err(|e| format!("Encryption failed: {e}"))?;

    let mut payload = Vec::with_capacity(SALT_LEN + NONCE_LEN + ciphertext.len());
    payload.extend_from_slice(&salt);
    payload.extend_from_slice(&nonce_bytes);
    payload.extend(ciphertext);

    let encoded = BASE64.encode(&payload);
    let mut result = ENC_MAGIC.to_vec();
    result.extend_from_slice(encoded.as_bytes());
    result.push(b'\n');
    Ok(result)
}

fn decrypt_json(bytes: &[u8], password: &str) -> Result<String, String> {
    if !bytes.starts_with(ENC_MAGIC) {
        return Err("Not an encrypted file".to_string());
    }

    let encoded_bytes = &bytes[ENC_MAGIC.len()..];
    let encoded_str = std::str::from_utf8(encoded_bytes)
        .map_err(|e| format!("Encoding error: {e}"))?
        .trim_end();

    let payload = BASE64
        .decode(encoded_str)
        .map_err(|e| format!("Base64 decode error: {e}"))?;

    if payload.len() < SALT_LEN + NONCE_LEN + 16 {
        return Err("Corrupted encrypted file".to_string());
    }

    let salt = &payload[..SALT_LEN];
    let nonce_bytes = &payload[SALT_LEN..SALT_LEN + NONCE_LEN];
    let ciphertext = &payload[SALT_LEN + NONCE_LEN..];

    let key_bytes = derive_key(password, salt)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "WRONG_PASSWORD".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 decode error: {e}"))
}

// ─── Public API ───────────────────────────────────────────────────────────────

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

pub fn load_bootstrap<R: Runtime>(
    _app: &AppHandle<R>,
    debug_mode: bool,
) -> Result<BootstrapConfig, String> {
    Ok(BootstrapConfig {
        user: DEFAULT_USER.to_string(),
        coinbase: load_coin_catalog()?,
        debug_mode,
    })
}

/// Load DB from disk. If the file is encrypted and no password is provided,
/// returns Err("DB_ENCRYPTED"). If the password is wrong, returns Err("WRONG_PASSWORD").
pub fn load_db<R: Runtime>(
    app: &AppHandle<R>,
    user: &str,
    password: Option<&str>,
) -> Result<DbData, String> {
    let path = ensure_db_file(app, user)?;
    let bytes = fs::read(&path).map_err(|e| format_file_error("read", &path, e))?;

    if bytes.is_empty() {
        return Ok(DbData::default());
    }

    if is_file_encrypted(&bytes) {
        let pw = password.ok_or_else(|| "DB_ENCRYPTED".to_string())?;
        let json = decrypt_json(&bytes, pw)?;
        let decoded = serde_json::from_str::<Value>(&json).unwrap_or(Value::Null);
        return Ok(normalize_db_value(decoded));
    }

    let raw = String::from_utf8_lossy(&bytes);
    if raw.trim().is_empty() {
        return Ok(DbData::default());
    }
    let decoded = serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null);
    Ok(normalize_db_value(decoded))
}

/// Save DB to disk. If a password is provided, the file is encrypted.
pub fn save_db<R: Runtime>(
    app: &AppHandle<R>,
    user: &str,
    mut data: DbData,
    password: Option<&str>,
) -> Result<(), String> {
    if data.window_state.is_none() {
        if let Ok(existing) = load_db(app, user, password) {
            data.window_state = existing.window_state;
        }
    }
    let path = resolve_db_file_path(app, user)?;
    let json = serialize_db_data(normalize_db_data(data))?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format_file_error("create directory", parent, e))?;
    }

    let payload = if let Some(pw) = password {
        encrypt_json(&json, pw)?
    } else {
        json.into_bytes()
    };

    fs::write(&path, payload).map_err(|e| format_file_error("write", &path, e))
}

pub fn clear_db<R: Runtime>(
    app: &AppHandle<R>,
    user: &str,
    password: Option<&str>,
) -> Result<(), String> {
    // Preserve window state when clearing
    let window_state = load_db(app, user, password)
        .ok()
        .and_then(|d| d.window_state);
    let mut data = DbData::default();
    data.window_state = window_state;
    save_db(app, user, data, password)
}

/// Returns true if the DB file starts with the encryption magic header.
pub fn check_db_encrypted<R: Runtime>(app: &AppHandle<R>, user: &str) -> Result<bool, String> {
    let path = resolve_db_file_path(app, user)?;
    if !path.is_file() {
        return Ok(false);
    }
    let mut file =
        fs::File::open(&path).map_err(|e| format_file_error("open", &path, e))?;
    let mut buf = vec![0u8; ENC_MAGIC.len()];
    let n = file
        .read(&mut buf)
        .map_err(|e| format_file_error("read", &path, e))?;
    Ok(buf[..n].starts_with(ENC_MAGIC))
}

/// Encrypt an existing plain-text DB file with the given password.
pub fn encrypt_db_file<R: Runtime>(
    app: &AppHandle<R>,
    user: &str,
    password: &str,
) -> Result<(), String> {
    let path = ensure_db_file(app, user)?;
    let bytes = fs::read(&path).map_err(|e| format_file_error("read", &path, e))?;

    if is_file_encrypted(&bytes) {
        return Err("DB_ALREADY_ENCRYPTED".to_string());
    }

    let raw = String::from_utf8_lossy(&bytes);
    let encrypted = encrypt_json(&raw, password)?;
    fs::write(&path, encrypted).map_err(|e| format_file_error("write", &path, e))
}

/// Decrypt an encrypted DB file back to plain JSON.
pub fn decrypt_db_file<R: Runtime>(
    app: &AppHandle<R>,
    user: &str,
    password: &str,
) -> Result<(), String> {
    let path = ensure_db_file(app, user)?;
    let bytes = fs::read(&path).map_err(|e| format_file_error("read", &path, e))?;

    if !is_file_encrypted(&bytes) {
        return Err("DB_NOT_ENCRYPTED".to_string());
    }

    let json = decrypt_json(&bytes, password)?;
    fs::write(&path, json.as_bytes()).map_err(|e| format_file_error("write", &path, e))
}

/// Re-encrypt a DB file with a new password.
pub fn change_db_password<R: Runtime>(
    app: &AppHandle<R>,
    user: &str,
    current_password: &str,
    new_password: &str,
) -> Result<(), String> {
    let path = ensure_db_file(app, user)?;
    let bytes = fs::read(&path).map_err(|e| format_file_error("read", &path, e))?;

    if !is_file_encrypted(&bytes) {
        return Err("DB_NOT_ENCRYPTED".to_string());
    }

    let json = decrypt_json(&bytes, current_password)?;
    let re_encrypted = encrypt_json(&json, new_password)?;
    fs::write(&path, re_encrypted).map_err(|e| format_file_error("write", &path, e))
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

    let entries =
        fs::read_dir(&db_dir).map_err(|e| format!("Cannot read database directory: {e}"))?;

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
            let encrypted = is_path_encrypted(&path);
            let coin_count = if encrypted {
                0
            } else {
                count_coins_in_file(&path)
            };
            Some(DbFileInfo {
                name,
                modified_ms,
                coin_count,
                encrypted,
            })
        })
        .collect();

    files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(files)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

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

fn is_path_encrypted(path: &Path) -> bool {
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut buf = vec![0u8; ENC_MAGIC.len()];
    let n = match file.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return false,
    };
    buf[..n].starts_with(ENC_MAGIC)
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
