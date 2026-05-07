use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

const DEFAULT_USER: &str = "default";
const DEFAULT_IMAGE_DIR: &str = "images/logo";

/// Coin catalog from CoinMarketCap, embedded at compile time.
/// Each coin's `id` (catalogId) is the SOLE unique identifier for coins across
/// the entire app. Symbol is NOT unique (921+ duplicates). All indexing,
/// caching, and lookups must use catalogId — never symbol alone.
const SEEDED_COIN_CATALOG_JSON: &str = include_str!("../../frontend/coinbase/cmc.json");

/// Value written to the "appId" field in every database file.
const APP_ID: &str = "coinman-portfolio";
/// Encryption version: AES-256-GCM + Argon2id.
const ENC_V1: u64 = 1;

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
    #[serde(default)]
    pub window_state: Option<WindowState>,
}

impl Default for DbData {
    fn default() -> Self {
        Self {
            portfolios: Vec::new(),
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
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoinCatalogConfig {
    pub image_dir: String,
    pub coins: Vec<Value>,
}

#[derive(Debug, Deserialize)]
struct CoinCatalogSource {
    #[serde(default, rename = "imageDir")]
    image_dir: Option<String>,
    #[serde(default)]
    coins: Vec<Value>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbFileInfo {
    pub name: String,
    pub modified_ms: u64,
    pub coin_count: usize,
    pub encrypted: bool,
    pub encrypted_version: u64,
}

// ─── Encryption ───────────────────────────────────────────────────────────────

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

/// Encrypt a JSON string and return a base64-encoded ciphertext (salt + nonce + ciphertext).
fn encrypt_to_b64(json: &str, password: &str) -> Result<String, String> {
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

    Ok(BASE64.encode(&payload))
}

/// Decrypt a base64-encoded ciphertext (salt + nonce + ciphertext) and return the JSON string.
fn decrypt_from_b64(b64: &str, password: &str) -> Result<String, String> {
    let payload = BASE64
        .decode(b64.trim())
        .map_err(|e| format!("Base64 decode error: {e}"))?;

    if payload.len() < SALT_LEN + NONCE_LEN + 16 {
        return Err("Corrupted encrypted data".to_string());
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

// ─── File format ──────────────────────────────────────────────────────────────

/// Build the on-disk JSON payload for the new file format.
///
/// Plain:
/// ```json
/// { "appId": "coinman-portfolio", "encrypted": 0, "encryptedData": null,
///   "portfolios": [...], "activePortfolioId": ... }
/// ```
///
/// Encrypted (v1):
/// ```json
/// { "appId": "coinman-portfolio", "encrypted": 1, "encryptedData": "<base64>" }
/// ```
fn build_db_file(data: DbData, password: Option<&str>) -> Result<Vec<u8>, String> {
    let mut root = Map::new();
    root.insert("appId".to_string(), Value::String(APP_ID.to_string()));

    if let Some(pw) = password {
        let inner_json = serialize_inner_data(&data)?;
        let b64 = encrypt_to_b64(&inner_json, pw)?;
        root.insert("encrypted".to_string(), Value::from(ENC_V1));
        root.insert("encryptedData".to_string(), Value::String(b64));
    } else {
        root.insert("encrypted".to_string(), Value::from(0u64));
        root.insert("encryptedData".to_string(), Value::Null);
        root.insert("portfolios".to_string(), Value::Array(data.portfolios));
        if let Some(ws) = data.window_state {
            if let Ok(v) = serde_json::to_value(ws) {
                root.insert("windowState".to_string(), v);
            }
        }
    }

    serde_json::to_string_pretty(&Value::Object(root))
        .map(|j| format!("{j}\n").into_bytes())
        .map_err(|e| format!("Cannot encode database JSON: {e}"))
}

/// Serialize the inner portfolio data (used as the plaintext before encryption).
fn serialize_inner_data(data: &DbData) -> Result<String, String> {
    let mut inner = Map::new();
    inner.insert(
        "portfolios".to_string(),
        Value::Array(data.portfolios.clone()),
    );
    if let Some(ws) = &data.window_state {
        if let Ok(v) = serde_json::to_value(ws) {
            inner.insert("windowState".to_string(), v);
        }
    }
    serde_json::to_string_pretty(&Value::Object(inner))
        .map_err(|e| format!("Cannot encode inner JSON: {e}"))
}

// ─── Public API ───────────────────────────────────────────────────────────────

pub fn sanitize_user(value: Option<String>) -> String {
    let raw = value.unwrap_or_else(|| DEFAULT_USER.to_string());
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return DEFAULT_USER.to_string();
    }

    // Block path traversal and OS-unsafe characters; allow Unicode letters,
    // digits, spaces, underscores, hyphens, and dots (but not leading dots).
    let has_unsafe = trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || trimmed.starts_with('.')
        || trimmed == ".."
        || trimmed.contains("..");

    if has_unsafe {
        return DEFAULT_USER.to_string();
    }

    // Every character must be a Unicode letter/digit, space, underscore,
    // hyphen, or dot — reject control characters and other special chars.
    if trimmed
        .chars()
        .all(|c| c.is_alphanumeric() || c == ' ' || c == '_' || c == '-' || c == '.')
    {
        trimmed.to_string()
    } else {
        DEFAULT_USER.to_string()
    }
}

pub fn load_bootstrap<R: Runtime>(
    app: &AppHandle<R>,
    debug_mode: bool,
) -> Result<BootstrapConfig, String> {
    Ok(BootstrapConfig {
        user: DEFAULT_USER.to_string(),
        coinbase: load_coin_catalog()?,
        debug_mode,
        app_version: app.package_info().version.to_string(),
    })
}

/// Load DB from disk.
///
/// Returns:
/// - `Err("DB_ENCRYPTED")` — file is encrypted and no password provided
/// - `Err("WRONG_PASSWORD")` — password is incorrect
/// - `Err("UNKNOWN_FORMAT")` — file is not a recognized CoinMan database
pub fn load_db<R: Runtime>(
    app: &AppHandle<R>,
    user: &str,
    password: Option<&str>,
) -> Result<DbData, String> {
    let path = resolve_db_file_path(app, user)?;
    if !path.is_file() {
        return Ok(DbData::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format_file_error("read", &path, e))?;

    if raw.trim().is_empty() {
        return Ok(DbData::default());
    }

    let root: Value = serde_json::from_str(&raw)
        .map_err(|_| "UNKNOWN_FORMAT".to_string())?;

    let obj = match &root {
        Value::Object(obj) => obj,
        _ => return Err("UNKNOWN_FORMAT".to_string()),
    };

    if obj.get("appId").and_then(|v| v.as_str()) != Some(APP_ID) {
        return Err("UNKNOWN_FORMAT".to_string());
    }

    let enc = obj.get("encrypted").and_then(|v| v.as_u64()).unwrap_or(0);
    match enc {
        0 => Ok(normalize_db_value(root)),
        ENC_V1 => {
            let pw = password.ok_or_else(|| "DB_ENCRYPTED".to_string())?;
            let b64 = obj
                .get("encryptedData")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Corrupted: missing encryptedData".to_string())?;
            let inner_json = decrypt_from_b64(b64, pw)?;
            let inner: Value = serde_json::from_str(&inner_json)
                .map_err(|_| "Corrupted encrypted data".to_string())?;
            Ok(normalize_db_value(inner))
        }
        v => Err(format!("UNSUPPORTED_ENCRYPTION:{v}")),
    }
}

/// Save DB to disk in the new JSON format.
/// If a password is provided, `encryptedData` is written; otherwise the file is plain.
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

    // Always store portfolios sorted by id so the file has a stable, predictable order.
    // Display order is kept separately in settings-cache.json (portfolioOrder).
    data.portfolios.sort_by(|a, b| {
        match (a.get("id").and_then(|v| v.as_i64()), b.get("id").and_then(|v| v.as_i64())) {
            (Some(x), Some(y)) => x.cmp(&y),
            _ => {
                let sa = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let sb = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
                sa.cmp(sb)
            }
        }
    });

    let path = resolve_db_file_path(app, user)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format_file_error("create directory", parent, e))?;
    }

    let payload = build_db_file(data, password)?;
    fs::write(&path, payload).map_err(|e| format_file_error("write", &path, e))
}

pub fn clear_db<R: Runtime>(
    app: &AppHandle<R>,
    user: &str,
    password: Option<&str>,
) -> Result<(), String> {
    let window_state = load_db(app, user, password)
        .ok()
        .and_then(|d| d.window_state);
    let mut data = DbData::default();
    data.window_state = window_state;
    save_db(app, user, data, password)
}

/// Returns true if the DB file is encrypted (new or legacy format).
pub fn check_db_encrypted<R: Runtime>(app: &AppHandle<R>, user: &str) -> Result<bool, String> {
    let path = resolve_db_file_path(app, user)?;
    if !path.is_file() {
        return Ok(false);
    }
    Ok(get_encryption_version(&path) > 0)
}

/// Encrypt an existing plain-text DB file with the given password.
pub fn encrypt_db_file<R: Runtime>(
    app: &AppHandle<R>,
    user: &str,
    password: &str,
) -> Result<(), String> {
    // load_db returns Err("DB_ENCRYPTED") if already encrypted — propagate as-is.
    let data = load_db(app, user, None)?;
    let path = resolve_db_file_path(app, user)?;
    let payload = build_db_file(data, Some(password))?;
    fs::write(&path, payload).map_err(|e| format_file_error("write", &path, e))
}

/// Decrypt an encrypted DB file back to plain JSON.
pub fn decrypt_db_file<R: Runtime>(
    app: &AppHandle<R>,
    user: &str,
    password: &str,
) -> Result<(), String> {
    // load_db returns Err("WRONG_PASSWORD") if wrong password — propagate as-is.
    let data = load_db(app, user, Some(password))?;
    let path = resolve_db_file_path(app, user)?;
    let payload = build_db_file(data, None)?;
    fs::write(&path, payload).map_err(|e| format_file_error("write", &path, e))
}

/// Re-encrypt a DB file with a new password.
pub fn change_db_password<R: Runtime>(
    app: &AppHandle<R>,
    user: &str,
    current_password: &str,
    new_password: &str,
) -> Result<(), String> {
    let data = load_db(app, user, Some(current_password))?;
    let path = resolve_db_file_path(app, user)?;
    let payload = build_db_file(data, Some(new_password))?;
    fs::write(&path, payload).map_err(|e| format_file_error("write", &path, e))
}

pub fn copy_db_file<R: Runtime>(app: &AppHandle<R>, src_user: &str, dst_user: &str) -> Result<(), String> {
    let src_path = resolve_db_file_path(app, src_user)?;
    let dst_path = resolve_db_file_path(app, dst_user)?;

    if !src_path.is_file() {
        return Err(format!("Source database '{}' not found", src_user));
    }
    if dst_path.is_file() {
        return Err("DATABASE_EXISTS".to_string());
    }

    if let Some(parent) = dst_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format_file_error("create directory", parent, e))?;
    }

    fs::copy(&src_path, &dst_path)
        .map(|_| ())
        .map_err(|e| format!("Cannot copy database: {e}"))
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
            let enc_ver = get_encryption_version(&path);
            let encrypted = enc_ver > 0;
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
                encrypted_version: enc_ver,
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
        let mut obj = match coin {
            Value::Object(o) => o,
            _ => continue,
        };

        // Normalize symbol — skip coins without one
        let symbol = obj.get("symbol")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_uppercase();
        if symbol.is_empty() {
            continue;
        }
        obj.insert("symbol".to_string(), Value::String(symbol.clone()));

        // Normalize id to string
        let id_str = match obj.get("id") {
            Some(Value::String(s)) => s.trim().to_string(),
            Some(Value::Number(n)) => n.to_string(),
            _ => String::new(),
        };
        let id_clean = if id_str.chars().all(|c| c.is_ascii_digit()) { id_str } else { String::new() };
        obj.insert("id".to_string(), Value::String(id_clean));

        // Normalize name
        let name = obj.get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        obj.insert("name".to_string(), Value::String(
            if name.is_empty() { symbol } else { name },
        ));

        coins.push(Value::Object(obj));
    }

    Ok(CoinCatalogConfig { image_dir, coins })
}

fn normalize_db_value(value: Value) -> DbData {
    let mut object = match value {
        Value::Object(obj) => obj,
        _ => return DbData::default(),
    };
    let portfolios = match object.remove("portfolios") {
        Some(Value::Array(portfolios)) => portfolios,
        _ => Vec::new(),
    };
    let window_state = object
        .remove("windowState")
        .and_then(|v| serde_json::from_value(v).ok());
    DbData { portfolios, window_state }
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

fn get_encryption_version(path: &Path) -> u64 {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return 0,
    };
    if let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(&raw) {
        if obj.get("appId").and_then(|v| v.as_str()) == Some(APP_ID) {
            return obj.get("encrypted").and_then(|v| v.as_u64()).unwrap_or(0);
        }
    }
    0
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
