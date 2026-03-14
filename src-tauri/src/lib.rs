mod storage;

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
struct StorageLock(Mutex<()>);

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

#[tauri::command]
fn bootstrap_app(app: tauri::AppHandle) -> Result<storage::BootstrapConfig, String> {
    let debug_mode = std::env::args()
        .any(|a| a == "--debug" || a == "-debug" || a == "/debug");
    storage::load_bootstrap(&app, debug_mode)
}

#[tauri::command]
fn load_portfolios(
    app: tauri::AppHandle,
    lock: tauri::State<'_, StorageLock>,
    user: Option<String>,
) -> Result<LoadResponse, String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Storage lock is poisoned".to_string())?;
    let user = storage::sanitize_user(user);
    let data = storage::load_db(&app, &user)?;
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
    user: Option<String>,
    data: storage::DbData,
) -> Result<WriteResponse, String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Storage lock is poisoned".to_string())?;
    let user = storage::sanitize_user(user);
    storage::save_db(&app, &user, data)?;
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
    user: Option<String>,
) -> Result<WriteResponse, String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Storage lock is poisoned".to_string())?;
    let user = storage::sanitize_user(user);
    storage::clear_db(&app, &user)?;
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

#[tauri::command]
fn debug_log(message: String) {
    log::info!("{}", message);
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app.dialog().file().add_filter("JSON", &["json"]);
    if let Some(db_dir) = storage::get_db_dir_path(&app) {
        builder = builder.set_directory(db_dir);
    }
    let file = builder.blocking_pick_file();
    Ok(file.map(|f| f.to_string()))
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let webview_data_dir = prepare_webview_data_dir();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StorageLock::default())
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
            debug_log,
            exit_app,
            open_file_dialog
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

    if let Ok(db) = storage::load_db(app.handle(), "default") {
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
            let mut state = storage::WindowState {
                width: 1220.0,
                height: 700.0,
                x: 0.0,
                y: 0.0,
            };

            if let Ok(size) = w.inner_size() {
                if let Ok(scale_factor) = w.scale_factor() {
                    let logical_size = size.to_logical::<f64>(scale_factor);
                    state.width = logical_size.width;
                    state.height = logical_size.height;
                }
            }
            if let Ok(pos) = w.outer_position() {
                if let Ok(scale_factor) = w.scale_factor() {
                    let logical_pos = pos.to_logical::<f64>(scale_factor);
                    state.x = logical_pos.x;
                    state.y = logical_pos.y;
                }
            }

            if let Ok(mut db) = storage::load_db(app_handle, "default") {
                db.window_state = Some(state);
                let _ = storage::save_db(app_handle, "default", db);
            }
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
