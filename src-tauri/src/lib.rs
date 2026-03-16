mod settings;
mod storage;

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
struct StorageLock(Mutex<()>);

/// Stores the current session password in memory (never written to disk).
#[derive(Default)]
struct SessionPassword(Mutex<Option<String>>);

#[derive(Clone)]
struct RuntimePaths {
    webview_data_dir: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadResponse {
    ok: bool,
    user: String,
    data: storage::DbData,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteResponse {
    ok: bool,
    user: String,
    saved_at: u64,
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
fn bootstrap_app(app: tauri::AppHandle) -> Result<storage::BootstrapConfig, String> {
    let debug_mode = std::env::args()
        .any(|a| a == "--debug" || a == "-debug" || a == "/debug");
    storage::load_bootstrap(&app, debug_mode)
}

/// Load portfolios from disk.
/// - If `password` is provided → use it and store in session on success.
/// - If not provided → try session password, then try without password.
/// - If file is encrypted and no password available → returns Err("DB_ENCRYPTED").
/// - If password is wrong → returns Err("WRONG_PASSWORD").
/// - If file is plain and loaded without a password → clears session password.
#[tauri::command]
fn load_portfolios(
    app: tauri::AppHandle,
    lock: tauri::State<'_, StorageLock>,
    session: tauri::State<'_, SessionPassword>,
    user: Option<String>,
    password: Option<String>,
) -> Result<LoadResponse, String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Storage lock is poisoned".to_string())?;
    let user = storage::sanitize_user(user);

    // Resolve effective password: explicit > session
    let session_pw = session
        .0
        .lock()
        .ok()
        .and_then(|g| g.clone());
    let effective_pw = password.clone().or(session_pw);

    let data = storage::load_db(&app, &user, effective_pw.as_deref())?;

    // Update session password
    if let Ok(mut sess) = session.0.lock() {
        if let Some(ref pw) = password {
            // Explicit password used and load succeeded → store in session
            *sess = Some(pw.clone());
        } else if effective_pw.is_none() {
            // Loaded plain file without any password → clear session
            *sess = None;
        }
        // else: used existing session password → keep it
    }

    Ok(LoadResponse {
        ok: true,
        user,
        data,
    })
}

#[tauri::command]
fn save_portfolios(
    app: tauri::AppHandle,
    lock: tauri::State<'_, StorageLock>,
    session: tauri::State<'_, SessionPassword>,
    user: Option<String>,
    data: storage::DbData,
) -> Result<WriteResponse, String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Storage lock is poisoned".to_string())?;
    let user = storage::sanitize_user(user);
    let pw = session.0.lock().ok().and_then(|g| g.clone());
    storage::save_db(&app, &user, data, pw.as_deref())?;
    Ok(WriteResponse {
        ok: true,
        user,
        saved_at: now_unix_ms(),
    })
}

#[tauri::command]
fn clear_portfolios(
    app: tauri::AppHandle,
    lock: tauri::State<'_, StorageLock>,
    session: tauri::State<'_, SessionPassword>,
    user: Option<String>,
) -> Result<WriteResponse, String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Storage lock is poisoned".to_string())?;
    let user = storage::sanitize_user(user);
    let pw = session.0.lock().ok().and_then(|g| g.clone());
    storage::clear_db(&app, &user, pw.as_deref())?;
    Ok(WriteResponse {
        ok: true,
        user,
        saved_at: now_unix_ms(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListDatabasesResponse {
    files: Vec<storage::DbFileInfo>,
    db_dir: String,
}

#[tauri::command]
fn list_databases(app: tauri::AppHandle) -> Result<ListDatabasesResponse, String> {
    let files = storage::list_db_files(&app)?;
    let db_dir = storage::get_db_dir_str(&app);
    Ok(ListDatabasesResponse { files, db_dir })
}

/// Check whether the given user's DB file is encrypted.
#[tauri::command]
fn check_db_encrypted(
    app: tauri::AppHandle,
    user: Option<String>,
) -> Result<bool, String> {
    let user = storage::sanitize_user(user);
    storage::check_db_encrypted(&app, &user)
}

/// Encrypt an existing plain-text DB file with the given password.
/// Stores the password in the session on success.
#[tauri::command]
fn encrypt_database(
    app: tauri::AppHandle,
    lock: tauri::State<'_, StorageLock>,
    session: tauri::State<'_, SessionPassword>,
    user: Option<String>,
    password: String,
) -> Result<(), String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Storage lock is poisoned".to_string())?;
    let user = storage::sanitize_user(user);
    storage::encrypt_db_file(&app, &user, &password)?;
    if let Ok(mut sess) = session.0.lock() {
        *sess = Some(password);
    }
    Ok(())
}

/// Decrypt an encrypted DB file back to plain JSON. Clears session password.
#[tauri::command]
fn decrypt_database(
    app: tauri::AppHandle,
    lock: tauri::State<'_, StorageLock>,
    session: tauri::State<'_, SessionPassword>,
    user: Option<String>,
    password: String,
) -> Result<(), String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Storage lock is poisoned".to_string())?;
    let user = storage::sanitize_user(user);
    storage::decrypt_db_file(&app, &user, &password)?;
    if let Ok(mut sess) = session.0.lock() {
        *sess = None;
    }
    Ok(())
}

/// Re-encrypt a DB file with a new password. Updates session password.
#[tauri::command]
fn change_database_password(
    app: tauri::AppHandle,
    lock: tauri::State<'_, StorageLock>,
    session: tauri::State<'_, SessionPassword>,
    user: Option<String>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Storage lock is poisoned".to_string())?;
    let user = storage::sanitize_user(user);
    storage::change_db_password(&app, &user, &current_password, &new_password)?;
    if let Ok(mut sess) = session.0.lock() {
        *sess = Some(new_password);
    }
    Ok(())
}

#[tauri::command]
fn load_app_settings(app: tauri::AppHandle, user: Option<String>) -> settings::AppSettingsForUser {
    let user = storage::sanitize_user(user);
    settings::load_for_user(&app, &user)
}

#[tauri::command]
fn save_market_cache(app: tauri::AppHandle, user: Option<String>, cache: serde_json::Value, saved_at: u64) {
    let user = storage::sanitize_user(user);
    settings::update_market_cache(&app, &user, cache, saved_at);
}

#[tauri::command]
fn save_active_portfolio(app: tauri::AppHandle, user: Option<String>, id: serde_json::Value) {
    let user = storage::sanitize_user(user);
    settings::update_active_portfolio_id(&app, &user, id);
}

#[tauri::command]
fn save_column_widths(app: tauri::AppHandle, widths: serde_json::Value) {
    settings::update_column_widths(&app, widths);
}

#[tauri::command]
fn save_show_cur_price(app: tauri::AppHandle, show: bool) {
    settings::update_show_cur_price(&app, show);
}

#[tauri::command]
fn save_portfolio_order(app: tauri::AppHandle, user: Option<String>, order: Vec<serde_json::Value>) {
    let user = storage::sanitize_user(user);
    settings::update_portfolio_order(&app, &user, order);
}

#[tauri::command]
fn debug_log(message: String) {
    log::info!("{}", message);
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn open_url(url: String) {
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd").args(["/c", "start", &url]).spawn().ok();
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&url).spawn().ok();
}

#[tauri::command]
fn copy_database(
    app: tauri::AppHandle,
    lock: tauri::State<'_, StorageLock>,
    source_user: Option<String>,
    target_user: String,
) -> Result<(), String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Storage lock is poisoned".to_string())?;
    let src_user = storage::sanitize_user(source_user);
    let dst_user = storage::sanitize_user(Some(target_user.clone()));
    // If sanitize changed the name the input was invalid (path traversal, bad chars, etc.)
    if dst_user != target_user.trim() {
        return Err("INVALID_NAME".to_string());
    }
    storage::copy_db_file(&app, &src_user, &dst_user)
}

#[tauri::command]
async fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = mpsc::channel();
    
    let mut builder = app.dialog().file().add_filter("JSON", &["json"]);
    if let Some(db_dir) = storage::get_db_dir_path(&app) {
        builder = builder.set_directory(db_dir);
    }
    
    builder.pick_file(move |file| {
        let _ = tx.send(file);
    });
    
    let file = rx.recv().map_err(|e| e.to_string())?;
    Ok(file.map(|f| f.to_string()))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ─── App setup ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let webview_data_dir = prepare_webview_data_dir();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StorageLock::default())
        .manage(SessionPassword::default())
        .manage(RuntimePaths {
            webview_data_dir: webview_data_dir.clone(),
        })
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            bootstrap_app,
            load_portfolios,
            save_portfolios,
            clear_portfolios,
            list_databases,
            check_db_encrypted,
            encrypt_database,
            decrypt_database,
            change_database_password,
            load_app_settings,
            save_market_cache,
            save_active_portfolio,
            save_column_widths,
            save_show_cur_price,
            debug_log,
            exit_app,
            open_url,
            open_file_dialog,
            copy_database,
            save_portfolio_order
        ])
        .setup(|app| {
            let debug_mode = std::env::args()
                .any(|a| a == "--debug" || a == "-debug" || a == "/debug");
            if debug_mode {
                let log_dir = std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                    .unwrap_or_else(|| std::path::PathBuf::from("."));
                app.handle().plugin(
                    tauri_plugin_log::Builder::new()
                        .target(tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::Folder {
                                path: log_dir,
                                file_name: Some("portfolio.debug.log".to_string()),
                            },
                        ))
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
                log::info!("=== CoinMan Portfolio started ===");
            }
            create_main_window(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    let exit_code = app.run_return(|_, _| {});
    cleanup_webview_data_dir(&webview_data_dir);
    if exit_code != 0 {
        std::process::exit(exit_code);
    }
}

fn create_main_window<R: tauri::Runtime>(app: &mut tauri::App<R>) -> tauri::Result<()> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }

    let mut width = 1220.0;
    let mut height = 700.0;
    let mut position = None;

    // Prefer settings.json for window state (works even when DB is encrypted).
    // Fall back to DB window_state for backward compatibility with older installs.
    let app_settings = settings::load_global(app.handle());
    if let Some(ws) = app_settings.window_state {
        width = ws.width;
        height = ws.height;
        position = Some((ws.x, ws.y));
    } else if let Ok(db) = storage::load_db(app.handle(), "default", None) {
        if let Some(ws) = db.window_state {
            width = ws.width;
            height = ws.height;
            position = Some((ws.x, ws.y));
        }
    }

    let runtime_paths = app.state::<RuntimePaths>();
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("CoinMan Portfolio")
        .inner_size(width, height)
        .min_inner_size(1220.0, 700.0)
        .resizable(true)
        .fullscreen(false)
        .data_directory(runtime_paths.webview_data_dir.clone());

    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }

    let window = builder.build()?;

    let w = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            let app_handle = w.app_handle();
            let mut win_state = settings::WinState {
                width: 1220.0,
                height: 700.0,
                x: 0.0,
                y: 0.0,
            };

            if let Ok(size) = w.inner_size() {
                if let Ok(scale_factor) = w.scale_factor() {
                    let logical_size = size.to_logical::<f64>(scale_factor);
                    win_state.width = logical_size.width;
                    win_state.height = logical_size.height;
                }
            }
            if let Ok(pos) = w.outer_position() {
                if let Ok(scale_factor) = w.scale_factor() {
                    let logical_pos = pos.to_logical::<f64>(scale_factor);
                    win_state.x = logical_pos.x;
                    win_state.y = logical_pos.y;
                }
            }

            settings::update_window_state(app_handle, win_state);
        }
    });

    Ok(())
}

fn prepare_webview_data_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "coinman-portfolio-ebwebview-{}",
        std::process::id()
    ));
    if dir.is_dir() {
        let _ = fs::remove_dir_all(&dir);
    }
    let _ = fs::create_dir_all(&dir);
    dir
}

fn cleanup_webview_data_dir(path: &Path) {
    for delay_ms in [0_u64, 100, 250, 500, 1000] {
        if delay_ms > 0 {
            thread::sleep(Duration::from_millis(delay_ms));
        }

        match fs::remove_dir_all(path) {
            Ok(_) => return,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) => continue,
        }
    }
}
