//! Jumper Exchange: jumper.xyz inside the main window, trading with the
//! CoinMan wallet.
//!
//! The site refuses to be framed, so it is not an iframe: it runs in a child
//! webview laid over the Exchange area of the main window — the way a
//! wallet's built-in browser shows a dapp. The page script places, shows and
//! hides it (`jumper_show` / `jumper_hide`). `jumper_page.js` is injected
//! before the site's own code: it offers an EIP-1193 wallet, answers the
//! site's CMS calls locally and hides everything but the swap.
//!
//! Wallet calls travel page → `coinman-wallet` protocol (here) → event to the
//! main webview → safety check and WalletConnect there → `jumper_wallet_response`
//! → page. Only the "jumper" webview on https://jumper.xyz may use the
//! protocol; the site gets no Tauri IPC at all.
//!
//! Webviews are created from async commands only: on Windows, creating one
//! from a synchronous command deadlocks WebView2.

use serde_json::{json, Value};
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::http::{Request, Response, StatusCode};
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Runtime, UriSchemeContext,
    UriSchemeResponder, Url, WebviewUrl,
};

use crate::{jumper_storage, webview_profile};

pub const LABEL: &str = "jumper";
pub const PROTOCOL: &str = "coinman-wallet";
const ORIGIN: &str = "https://jumper.xyz";
const HOME: &str = "https://jumper.xyz/";
/// A wallet call waits this long for the user to sign before it is dropped.
const CALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MAX_BODY: usize = 256 * 1024;

const PAGE_SCRIPT: &str = include_str!("jumper_page.js");

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static PENDING: LazyLock<Mutex<HashMap<u64, UriSchemeResponder>>> = LazyLock::new(Default::default);
/// `{ accounts, chainId }` as last pushed by the main webview.
static WALLET_STATE: Mutex<Option<Value>> = Mutex::new(None);

fn is_jumper(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some("jumper.xyz")
}

/// Area of the main window the Jumper view covers, in CSS (logical) pixels.
#[derive(serde::Deserialize, Clone, Copy)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Shows the Jumper view over `bounds`, creating it on first use; `url`, if
/// given, must be on jumper.xyz and is opened in it.
fn show<R: Runtime>(app: &AppHandle<R>, bounds: Bounds, url: Option<String>) -> Result<(), String> {
    let target: Option<Url> = match url {
        Some(u) => {
            let parsed: Url = u.parse().map_err(|e| format!("bad address: {e}"))?;
            if !is_jumper(&parsed) {
                return Err("only jumper.xyz addresses open here".into());
            }
            Some(parsed)
        }
        None => None,
    };
    let position = LogicalPosition::new(bounds.x.max(0.0), bounds.y.max(0.0));
    let size = LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0));
    let zoom = fit_zoom(bounds.width);

    if let Some(webview) = app.get_webview(LABEL) {
        webview.set_position(position).map_err(|e| e.to_string())?;
        webview.set_size(size).map_err(|e| e.to_string())?;
        let _ = webview.set_zoom(zoom);
        if let Some(url) = target {
            webview.navigate(url).map_err(|e| e.to_string())?;
        }
        webview.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = app.get_window("main").ok_or("the main window is gone")?;
    let start = target.unwrap_or_else(|| HOME.parse().expect("valid home URL"));
    let mut builder = WebviewBuilder::new(LABEL, WebviewUrl::External(start))
        .background_color(tauri::utils::config::Color(18, 19, 24, 255))
        .initialization_script(format!("{}{PAGE_SCRIPT}", jumper_storage::bootstrap_script(app)))
        .use_https_scheme(true)
        .incognito(true)
        // Stay on jumper.xyz; anything else opens in the system browser.
        .on_navigation(|url| {
            if is_jumper(url) || url.scheme() == "about" {
                return true;
            }
            if url.scheme() == "https" {
                crate::open_url(url.to_string());
            }
            false
        })
        .on_new_window(|url, _features| {
            if url.scheme() == "https" {
                crate::open_url(url.to_string());
            }
            NewWindowResponse::Deny
        });
    if let Some(dir) = webview_profile::current_dir() {
        builder = builder.data_directory(dir);
    }
    let webview = window.add_child(builder, position, size).map_err(|e| e.to_string())?;
    let _ = webview.set_zoom(zoom);
    log::info!("[jumper] view created");
    Ok(())
}

/// Jumper keeps its Simple/Advanced switch and the advanced layout for pages
/// at least this wide (its `lg` breakpoint).
const DESKTOP_WIDTH: f64 = 1200.0;
/// Below this the text would get too small; the site shows its narrow layout.
const MIN_ZOOM: f64 = 0.7;

/// Zooms out just enough for the page to be `DESKTOP_WIDTH` wide in its own
/// CSS pixels, so a smaller Exchange area still gets the desktop layout.
fn fit_zoom(width: f64) -> f64 {
    if width >= DESKTOP_WIDTH {
        1.0
    } else {
        (width / DESKTOP_WIDTH).max(MIN_ZOOM)
    }
}

fn respond_json(responder: UriSchemeResponder, status: StatusCode, body: &Value) {
    let bytes = serde_json::to_vec(body).unwrap_or_default();
    let response = Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", ORIGIN)
        .header("Content-Type", "application/json")
        .header("Cache-Control", "no-store")
        .body(Cow::Owned(bytes))
        .unwrap_or_else(|_| Response::new(Cow::Borrowed(&[][..])));
    responder.respond(response);
}

fn rpc_error(code: i64, message: &str) -> Value {
    json!({ "error": { "code": code, "message": message } })
}

/// The `coinman-wallet` protocol: `/state` for account and network, `/rpc`
/// for wallet calls. Anything not from the Jumper window on jumper.xyz is refused.
pub fn handle<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    if request.method() == "OPTIONS" {
        let response = Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header("Access-Control-Allow-Origin", ORIGIN)
            .header("Access-Control-Allow-Methods", "GET, POST")
            .header("Access-Control-Allow-Headers", "content-type")
            .body(Cow::Borrowed(&[][..]))
            .unwrap_or_else(|_| Response::new(Cow::Borrowed(&[][..])));
        responder.respond(response);
        return;
    }
    let origin = request.headers().get("origin").and_then(|v| v.to_str().ok());
    if ctx.webview_label() != LABEL || origin != Some(ORIGIN) {
        log::warn!("[jumper] wallet protocol refused: webview {} origin {:?}", ctx.webview_label(), origin);
        respond_json(responder, StatusCode::FORBIDDEN, &rpc_error(4100, "not allowed"));
        return;
    }

    match request.uri().path() {
        "/state" => {
            let state = WALLET_STATE.lock().unwrap_or_else(|p| p.into_inner()).clone();
            respond_json(
                responder,
                StatusCode::OK,
                &state.unwrap_or_else(|| json!({ "accounts": [], "chainId": null })),
            );
        }
        "/storage" => {
            let saved = serde_json::from_slice::<Value>(request.body())
                .ok()
                .and_then(|v| v.as_object().cloned())
                .ok_or_else(|| "expected an object".to_string())
                .and_then(|items| jumper_storage::save(ctx.app_handle(), items));
            match saved {
                Ok(()) => respond_json(responder, StatusCode::OK, &json!({ "ok": true })),
                Err(e) => respond_json(responder, StatusCode::BAD_REQUEST, &rpc_error(-32602, &e)),
            }
        }
        "/rpc" => {
            let body = request.body();
            if body.len() > MAX_BODY {
                respond_json(responder, StatusCode::PAYLOAD_TOO_LARGE, &rpc_error(-32600, "request too large"));
                return;
            }
            let call: Value = match serde_json::from_slice(body) {
                Ok(v) => v,
                Err(_) => {
                    respond_json(responder, StatusCode::BAD_REQUEST, &rpc_error(-32700, "invalid JSON"));
                    return;
                }
            };
            let Some(method) = call.get("method").and_then(Value::as_str) else {
                respond_json(responder, StatusCode::BAD_REQUEST, &rpc_error(-32600, "missing method"));
                return;
            };
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let payload = json!({ "id": id, "method": method, "params": call.get("params").cloned().unwrap_or(json!([])) });
            PENDING.lock().unwrap_or_else(|p| p.into_inner()).insert(id, responder);
            if let Err(e) = ctx.app_handle().emit_to(EventTarget::webview("main"), "jumper-wallet-request", payload) {
                log::error!("[jumper] cannot reach the main window: {e}");
                finish(id, rpc_error(4900, "CoinMan is not ready"));
                return;
            }
            std::thread::spawn(move || {
                std::thread::sleep(CALL_TIMEOUT);
                finish(id, rpc_error(4001, "no answer from the wallet in time"));
            });
        }
        _ => respond_json(responder, StatusCode::NOT_FOUND, &rpc_error(-32601, "unknown path")),
    }
}

/// Sends the answer for wallet call `id` back to the page, if it still waits.
fn finish(id: u64, response: Value) {
    let responder = PENDING.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
    if let Some(responder) = responder {
        respond_json(responder, StatusCode::OK, &response);
    }
}

#[tauri::command]
pub async fn jumper_show(app: AppHandle, bounds: Bounds, url: Option<String>) -> Result<(), String> {
    show(&app, bounds, url)
}

#[tauri::command]
pub async fn jumper_hide(app: AppHandle) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(webview) => webview.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// The main webview's answer to a wallet call: `{ result }` or `{ error }`.
#[tauri::command]
pub fn jumper_wallet_response(id: u64, response: Value) {
    finish(id, response);
}

/// The main webview's wallet: `{ accounts, chainId }`, served at `/state`.
#[tauri::command]
pub fn jumper_wallet_state(state: Value) {
    *WALLET_STATE.lock().unwrap_or_else(|p| p.into_inner()) = Some(state);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zooms_out_only_below_the_desktop_width() {
        assert_eq!(fit_zoom(1400.0), 1.0);
        assert_eq!(fit_zoom(1200.0), 1.0);
        assert!((fit_zoom(1100.0) - 1100.0 / 1200.0).abs() < 1e-9);
        assert_eq!(fit_zoom(500.0), MIN_ZOOM);
    }

    #[test]
    fn only_jumper_addresses_count() {
        assert!(is_jumper(&"https://jumper.xyz/advanced?fromChain=1".parse().unwrap()));
        assert!(!is_jumper(&"https://jumper.xyz.evil.com/".parse().unwrap()));
        assert!(!is_jumper(&"http://jumper.xyz/".parse().unwrap()));
        assert!(!is_jumper(&"https://strapi.jumper.xyz/api".parse().unwrap()));
    }
}
