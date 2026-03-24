mod settings;
mod storage;

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

// ─── Default window dimensions (logical pixels) ─────────────────────────────
const DEFAULT_WINDOW_WIDTH: f64 = 1220.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 700.0;

#[derive(Default)]
struct StorageLock(Mutex<()>);

/// Stores the current session password in memory (never written to disk).
#[derive(Default)]
struct SessionPassword(Mutex<Option<String>>);

/// Tracks the decoration size offset on Linux where inner_size() includes
/// window decorations, causing the window to grow on each launch cycle.
struct WindowSizeCalibration {
    intended: Mutex<(f64, f64)>,
    offset: Mutex<(f64, f64)>,
    calibrated: AtomicBool,
    /// Mismatch ratio between content scale (Xft.dpi) and window scale factor.
    /// Used on X11 to compensate for the window being sized in physical pixels
    /// while WebKitGTK scales content independently via DPI.
    dpi_mismatch: Mutex<f64>,
}

impl Default for WindowSizeCalibration {
    fn default() -> Self {
        Self {
            intended: Mutex::new((0.0, 0.0)),
            offset: Mutex::new((0.0, 0.0)),
            calibrated: AtomicBool::new(false),
            dpi_mismatch: Mutex::new(1.0),
        }
    }
}

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
fn save_auto_align_columns(app: tauri::AppHandle, align: bool) {
    settings::update_auto_align_columns(&app, align);
}

#[tauri::command]
fn save_show_table_footer(app: tauri::AppHandle, show: bool) {
    settings::update_show_table_footer(&app, show);
}

#[tauri::command]
fn save_is_collapsed(app: tauri::AppHandle, collapsed: bool) {
    settings::update_is_collapsed(&app, collapsed);
}

#[tauri::command]
fn save_portfolio_order(app: tauri::AppHandle, user: Option<String>, order: Vec<serde_json::Value>) {
    let user = storage::sanitize_user(user);
    settings::update_portfolio_order(&app, &user, order);
}

#[tauri::command]
fn save_last_update_check(app: tauri::AppHandle, timestamp: u64) {
    settings::update_last_update_check(&app, timestamp);
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
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        extern "system" {
            fn ShellExecuteW(
                hwnd: *mut std::ffi::c_void,
                operation: *const u16,
                file: *const u16,
                params: *const u16,
                dir: *const u16,
                show: i32,
            ) -> *mut std::ffi::c_void;
        }
        let open: Vec<u16> = OsStr::new("open").encode_wide().chain(Some(0)).collect();
        let wide: Vec<u16> = OsStr::new(&url).encode_wide().chain(Some(0)).collect();
        unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                open.as_ptr(),
                wide.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1, // SW_SHOWNORMAL
            );
        }
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&url).spawn().ok();
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
        .manage(WindowSizeCalibration::default())
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
            save_auto_align_columns,
            save_show_table_footer,
            save_is_collapsed,
            debug_log,
            exit_app,
            open_url,
            open_file_dialog,
            copy_database,
            save_portfolio_order,
            save_last_update_check
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
                log::info!("=== CoinMan Portfolio Tracker started ===");
            }
            create_main_window(app, debug_mode)?;
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

/// On X11, detect the effective DPI scale that WebKitGTK uses for content.
/// WebKitGTK reads Xft.dpi from X resources (set by KDE, GNOME, etc.) and
/// scales the page accordingly, even when the window system reports sf = 1.0.
/// Returns the scale factor (e.g. 1.25 for 120 dpi, 1.5 for 144 dpi).
#[cfg(target_os = "linux")]
fn detect_x11_dpi_scale() -> f64 {
    // 1. Xft.dpi from X resources (most common on KDE/GNOME + X11)
    if let Ok(output) = std::process::Command::new("xrdb").args(["-query"]).output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if let Some(rest) = line.strip_prefix("Xft.dpi:") {
                if let Ok(dpi) = rest.trim().parse::<f64>() {
                    if dpi > 96.0 {
                        return dpi / 96.0;
                    }
                }
            }
        }
    }
    // 2. GDK_DPI_SCALE (fractional, set by some desktop environments)
    if let Ok(val) = std::env::var("GDK_DPI_SCALE") {
        if let Ok(s) = val.parse::<f64>() {
            if s > 1.0 {
                return s;
            }
        }
    }
    // 3. GDK_SCALE (integer, older method)
    if let Ok(val) = std::env::var("GDK_SCALE") {
        if let Ok(s) = val.parse::<f64>() {
            if s > 1.0 {
                return s;
            }
        }
    }
    1.0
}

fn create_main_window<R: tauri::Runtime>(app: &mut tauri::App<R>, debug_mode: bool) -> tauri::Result<()> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }

    let mut width = DEFAULT_WINDOW_WIDTH;
    let mut height = DEFAULT_WINDOW_HEIGHT;
    let mut position = None;

    // Prefer settings-cache.json for window state (works even when DB is encrypted).
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
        .title("CoinMan Portfolio Tracker")
        .inner_size(width, height)
        .min_inner_size(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
        .resizable(true)
        .fullscreen(false)
        .data_directory(runtime_paths.webview_data_dir.clone());

    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    } else {
        builder = builder.center();
    }

    // Store the intended size so we can compute the decoration offset later.
    {
        let cal = app.state::<WindowSizeCalibration>();
        *cal.intended.lock().unwrap() = (width, height);
    }

    let window = builder.build()?;

    if debug_mode {
        window.open_devtools();
    }

    // On Linux X11, the window manager may report scale_factor = 1.0 while
    // WebKitGTK independently reads Xft.dpi and scales content (e.g. 120 dpi
    // → 1.25x).  This mismatch makes the window too small for the scaled
    // content.  Detect the real DPI scale and enlarge the window to compensate.
    // Wayland handles scaling at the compositor level and doesn't need this.
    #[cfg(target_os = "linux")]
    {
        let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok();
        if !is_wayland {
            let dpi_scale = detect_x11_dpi_scale();
            let win_sf = window.scale_factor().unwrap_or(1.0);
            let mismatch = dpi_scale / win_sf;
            if mismatch > 1.01 {
                // Store mismatch for the save path (CloseRequested).
                {
                    let cal = app.state::<WindowSizeCalibration>();
                    *cal.dpi_mismatch.lock().unwrap() = mismatch;
                }
                let scaled_w = width * mismatch;
                let scaled_h = height * mismatch;
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: scaled_w,
                    height: scaled_h,
                }));
                let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
                    width: DEFAULT_WINDOW_WIDTH * mismatch,
                    height: DEFAULT_WINDOW_HEIGHT * mismatch,
                })));
                // Update intended to match the scaled size for correct
                // decoration-offset calibration on the first Resized event.
                let cal = app.state::<WindowSizeCalibration>();
                *cal.intended.lock().unwrap() = (scaled_w, scaled_h);
            }
        }
    }

    let w = window.clone();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::Resized(phys_size) => {
                let app_handle = w.app_handle();
                let cal = app_handle.state::<WindowSizeCalibration>();
                // On the first Resized event (initial window show), compute the
                // decoration offset = reported_logical - intended.  On Linux some
                // WMs include decorations in inner_size(), which inflates the
                // value.  We subtract this offset when saving on close.
                if !cal.calibrated.swap(true, Ordering::Relaxed) {
                    if let Ok(sf) = w.scale_factor() {
                        let logical = phys_size.to_logical::<f64>(sf);
                        let intended = *cal.intended.lock().unwrap();
                        let ow = (logical.width - intended.0).max(0.0);
                        let oh = (logical.height - intended.1).max(0.0);
                        *cal.offset.lock().unwrap() = (ow, oh);
                    }
                }
            }
            tauri::WindowEvent::CloseRequested { .. } => {
                let app_handle = w.app_handle();
                let cal = app_handle.state::<WindowSizeCalibration>();
                let (ow, oh) = *cal.offset.lock().unwrap();

                // Try to preserve previous x and y in case outer_position fails (e.g. on Wayland)
                let (prev_x, prev_y) = settings::load_global(&app_handle)
                    .window_state
                    .map(|ws| (ws.x, ws.y))
                    .unwrap_or((0.0, 0.0));

                let mut win_state = settings::WinState {
                    width: DEFAULT_WINDOW_WIDTH,
                    height: DEFAULT_WINDOW_HEIGHT,
                    x: prev_x,
                    y: prev_y,
                };

                let dpi_mm = *cal.dpi_mismatch.lock().unwrap();
                if let Ok(size) = w.inner_size() {
                    if let Ok(scale_factor) = w.scale_factor() {
                        let logical_size = size.to_logical::<f64>(scale_factor);
                        // Divide by dpi_mismatch to convert back to "app-logical"
                        // coordinates (the size before X11 DPI compensation).
                        win_state.width = ((logical_size.width - ow) / dpi_mm).max(DEFAULT_WINDOW_WIDTH);
                        win_state.height = ((logical_size.height - oh) / dpi_mm).max(DEFAULT_WINDOW_HEIGHT);
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
            _ => {}
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
