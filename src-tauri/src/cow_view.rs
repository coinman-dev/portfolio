//! CoW Swap on Linux and macOS: swap.cow.fi in a native view over the
//! Exchange area, trading with the CoinMan wallet.
//!
//! On Windows the CoW widget is an iframe. WebKit (Linux, macOS) refuses that
//! iframe: swap.cow.fi sends `frame-ancestors *`, and `*` does not cover the
//! app's own `tauri://localhost` page. So here the site runs in a child webview
//! like Jumper does (see jumper.rs), placed and hidden by the page script
//! (`cow_show` / `cow_hide`). `cow_page.js` is injected before the site's code
//! and offers the CoinMan wallet (EIP-1193 + EIP-6963).
//!
//! The site's CSP (`connect-src *`, `upgrade-insecure-requests`) blocks fetches
//! to a custom scheme or to loopback, so the page reaches the app over Tauri's
//! IPC instead: the `cow-bridge` plugin's `rpc` and `state` commands, which
//! capabilities/cow-swap.json grants to https://swap.cow.fi in the "cowswap"
//! webview only. No other command is reachable from the site.
//!
//! Wallet calls travel page → `plugin:cow-bridge|rpc` → event to the main
//! webview → `cowViewBridge.ts` → WalletConnect → `cow_wallet_response` → page.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::plugin::TauriPlugin;
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Runtime, Url, WebviewUrl};

use crate::child_view::Bounds;
use crate::webview_profile;

pub const LABEL: &str = "cowswap";
const HOME: &str = "https://swap.cow.fi/#/1/swap";
/// A wallet call waits this long for the user to sign before it is dropped.
const CALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MAX_BODY: usize = 256 * 1024;

const PAGE_SCRIPT: &str = include_str!("cow_page.js");

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static PENDING: LazyLock<Mutex<HashMap<u64, Sender<Value>>>> = LazyLock::new(Default::default);
/// `{ accounts, chainId }` as last pushed by the main webview.
static WALLET_STATE: Mutex<Option<Value>> = Mutex::new(None);

fn is_cow(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some("swap.cow.fi")
}

/// Shows the CoW Swap view over `bounds`, creating it on first use; `url`, if
/// given, must be on swap.cow.fi and is opened in it.
fn show<R: Runtime>(app: &AppHandle<R>, bounds: Bounds, url: Option<String>) -> Result<(), String> {
    let target: Option<Url> = match url {
        Some(u) => {
            let parsed: Url = u.parse().map_err(|e| format!("bad address: {e}"))?;
            if !is_cow(&parsed) {
                return Err("only swap.cow.fi addresses open here".into());
            }
            Some(parsed)
        }
        None => None,
    };
    let position = LogicalPosition::new(bounds.x.max(0.0), bounds.y.max(0.0));
    let size = LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0));

    if let Some(webview) = app.get_webview(LABEL) {
        webview.set_position(position).map_err(|e| e.to_string())?;
        webview.set_size(size).map_err(|e| e.to_string())?;
        if let Some(url) = target {
            webview.navigate(url).map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "linux")]
        crate::child_view::place_linux(&webview, bounds);
        webview.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = app.get_window("main").ok_or("the main window is gone")?;
    let start = target.unwrap_or_else(|| HOME.parse().expect("valid home URL"));
    let mut builder = WebviewBuilder::new(LABEL, WebviewUrl::External(start))
        .background_color(tauri::utils::config::Color(18, 19, 24, 255))
        .initialization_script(PAGE_SCRIPT)
        .incognito(true)
        // Stay on swap.cow.fi; anything else opens in the system browser.
        .on_navigation(|url| {
            if is_cow(url) || url.scheme() == "about" {
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
    #[cfg(target_os = "linux")]
    crate::child_view::place_linux(&webview, bounds);
    log::info!("[cowswap] view created");
    Ok(())
}

fn rpc_error(code: i64, message: &str) -> Value {
    json!({ "error": { "code": code, "message": message } })
}

/// The `cow-bridge` plugin: what the CoW Swap page may call.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("cow-bridge")
        .invoke_handler(tauri::generate_handler![rpc, state])
        .build()
}

/// Calls from anything but the CoW Swap view on swap.cow.fi are refused (the
/// capability already limits them; this keeps it so if that file changes).
fn from_cow_view<R: Runtime>(webview: &tauri::Webview<R>) -> bool {
    webview.label() == LABEL && webview.url().map(|u| is_cow(&u)).unwrap_or(false)
}

/// `{ accounts, chainId }` of the CoinMan wallet.
#[tauri::command]
fn state<R: Runtime>(webview: tauri::Webview<R>) -> Value {
    if !from_cow_view(&webview) {
        return json!({ "accounts": [], "chainId": null });
    }
    WALLET_STATE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
        .unwrap_or_else(|| json!({ "accounts": [], "chainId": null }))
}

/// One EIP-1193 call, answered `{ result }` or `{ error }` once the main
/// webview (and the wallet, if it has to sign) has dealt with it.
#[tauri::command]
async fn rpc<R: Runtime>(app: AppHandle<R>, webview: tauri::Webview<R>, method: String, params: Option<Value>) -> Value {
    if !from_cow_view(&webview) {
        log::warn!("[cowswap] wallet call refused from webview {}", webview.label());
        return rpc_error(4100, "not allowed");
    }
    let params = params.unwrap_or_else(|| json!([]));
    if params.to_string().len() > MAX_BODY {
        return rpc_error(-32600, "request too large");
    }
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = channel();
    PENDING.lock().unwrap_or_else(|p| p.into_inner()).insert(id, tx);
    let payload = json!({ "id": id, "method": method, "params": params });
    if let Err(e) = app.emit_to(EventTarget::webview("main"), "cow-wallet-request", payload) {
        log::error!("[cowswap] cannot reach the main window: {e}");
        PENDING.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
        return rpc_error(4900, "CoinMan is not ready");
    }
    let answer = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(CALL_TIMEOUT)).await;
    PENDING.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
    match answer {
        Ok(Ok(response)) => response,
        _ => rpc_error(4001, "no answer from the wallet in time"),
    }
}

/// Hands the answer for wallet call `id` to the waiting `rpc`, if it still waits.
fn finish(id: u64, response: Value) {
    let waiting = PENDING.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
    if let Some(tx) = waiting {
        let _ = tx.send(response);
    }
}

#[tauri::command]
pub async fn cow_show(app: AppHandle, bounds: Bounds, url: Option<String>) -> Result<(), String> {
    show(&app, bounds, url)
}

#[tauri::command]
pub async fn cow_hide(app: AppHandle) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(webview) => webview.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// The main webview's answer to a wallet call: `{ result }` or `{ error }`.
#[tauri::command]
pub fn cow_wallet_response(id: u64, response: Value) {
    finish(id, response);
}

/// The main webview's wallet: `{ accounts, chainId }`, served at `/state`.
#[tauri::command]
pub fn cow_wallet_state(state: Value) {
    *WALLET_STATE.lock().unwrap_or_else(|p| p.into_inner()) = Some(state);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_cow_swap_addresses_count() {
        assert!(is_cow(&"https://swap.cow.fi/#/1/swap/WETH/COW".parse().unwrap()));
        assert!(!is_cow(&"https://swap.cow.fi.evil.com/".parse().unwrap()));
        assert!(!is_cow(&"http://swap.cow.fi/".parse().unwrap()));
        assert!(!is_cow(&"https://cow.fi/".parse().unwrap()));
    }
}
