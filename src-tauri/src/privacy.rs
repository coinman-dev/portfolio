//! Privacy → Tor network.
//!
//! CoinMan does not ship Tor. It uses one the user already runs: Tor Browser
//! (SOCKS port 9150 while it is open) or the standalone Tor service from the
//! Tor Expert Bundle (9050), or a SOCKS5 address typed by hand (another port,
//! another machine on the home network).
//!
//! With Tor switched on, everything the app sends goes through that proxy:
//! the main webview, the CoW Swap and Jumper views and the Rust HTTP clients.
//! A webview's proxy can only be set when it is created, so the choice is read
//! once at start-up and a change takes effect after a restart. When Tor is on
//! but does not answer, requests fail; nothing falls back to a direct
//! connection. Only Dash Core's RPC on 127.0.0.1 stays local.
//!
//! macOS needs macOS 14 for a webview proxy (and a Tauri feature that does
//! not build for older targets), so the option is unavailable there for now.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Runtime};

use crate::settings;

/// Tor Browser's SOCKS port while it runs.
pub const TOR_BROWSER: (&str, u16) = ("127.0.0.1", 9150);
/// The Tor service's (Expert Bundle, system package) default SOCKS port.
pub const TOR_SERVICE: (&str, u16) = ("127.0.0.1", 9050);

const PROBE_TIMEOUT: Duration = Duration::from_millis(400);
const CHECK_URL: &str = "https://check.torproject.org/api/ip";

/// Stored in data/settings.json under "privacy".
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrivacySettings {
    #[serde(default)]
    pub tor_enabled: bool,
    /// true: use `address` instead of looking for Tor on 9150 / 9050.
    #[serde(default)]
    pub manual: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
}

/// The proxy this process runs with, fixed at start-up.
#[derive(Debug, Clone, PartialEq)]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
    /// "tor-browser", "tor-service" or "manual".
    pub source: &'static str,
    /// Auto mode found nothing at start-up; Tor Browser's port is used so
    /// that nothing goes out directly.
    pub missing: bool,
}

impl Endpoint {
    pub fn address(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }
}

static ACTIVE: OnceLock<Option<Endpoint>> = OnceLock::new();
static STARTUP: OnceLock<PrivacySettings> = OnceLock::new();
static RESTART: AtomicBool = AtomicBool::new(false);

pub const fn platform_supported() -> bool {
    cfg!(any(windows, target_os = "linux"))
}

/// Reads the saved choice and fixes this process's proxy. Call once, before
/// any webview or HTTP client is created.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    let saved = settings::load_global(app).privacy.unwrap_or_default();
    let endpoint = if saved.tor_enabled && platform_supported() {
        Some(resolve(&saved))
    } else {
        if saved.tor_enabled {
            log::warn!("Tor is switched on in the settings but not supported on this platform");
        }
        None
    };
    match &endpoint {
        Some(e) if e.missing => log::warn!(
            "Tor is on but neither Tor Browser (9150) nor the Tor service (9050) answers; using {} so nothing leaves directly",
            e.address()
        ),
        Some(e) => log::info!("Tor is on: all traffic goes through {} ({})", e.address(), e.source),
        None => log::info!("Tor is off"),
    }
    let _ = STARTUP.set(saved);
    let _ = ACTIVE.set(endpoint);
}

fn resolve(saved: &PrivacySettings) -> Endpoint {
    if saved.manual {
        if let Some((host, port)) = saved.address.as_deref().and_then(|a| parse_address(a).ok()) {
            return Endpoint { host, port, source: "manual", missing: false };
        }
        log::warn!("The saved Tor address is not valid; looking for Tor on the usual ports");
    }
    for ((host, port), source) in [(TOR_BROWSER, "tor-browser"), (TOR_SERVICE, "tor-service")] {
        if port_open(host, port) {
            return Endpoint { host: host.to_string(), port, source, missing: false };
        }
    }
    Endpoint {
        host: TOR_BROWSER.0.to_string(),
        port: TOR_BROWSER.1,
        source: "tor-browser",
        missing: true,
    }
}

/// The proxy every connection of this process goes through, if any.
pub fn active() -> Option<&'static Endpoint> {
    ACTIVE.get().and_then(|e| e.as_ref())
}

/// Accepts `host:port`, `[v6]:port` and the same with a `socks5://` or
/// `socks5h://` prefix. Hosts are names or IP literals, nothing else.
pub fn parse_address(input: &str) -> Result<(String, u16), String> {
    let s = input.trim();
    let s = s
        .strip_prefix("socks5h://")
        .or_else(|| s.strip_prefix("socks5://"))
        .unwrap_or(s)
        .trim_end_matches('/');
    let (host, port) = if let Some(rest) = s.strip_prefix('[') {
        let (h, p) = rest.split_once("]:").ok_or("Use the form host:port, e.g. 192.168.1.10:9050")?;
        h.parse::<std::net::Ipv6Addr>().map_err(|_| "Not a valid IPv6 address")?;
        (h.to_string(), p)
    } else {
        let (h, p) = s.rsplit_once(':').ok_or("Use the form host:port, e.g. 192.168.1.10:9050")?;
        let valid = !h.is_empty()
            && h.len() <= 253
            && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
            && !h.starts_with(['.', '-']);
        if !valid {
            return Err("The host may contain only letters, digits, dots and hyphens".into());
        }
        (h.to_ascii_lowercase(), p)
    };
    let port = port
        .parse::<u16>()
        .ok()
        .filter(|p| *p > 0)
        .ok_or("The port must be a number from 1 to 65535")?;
    Ok((host, port))
}

fn port_open(host: &str, port: u16) -> bool {
    let addrs: Vec<SocketAddr> = match (host, port).to_socket_addrs() {
        Ok(a) => a.collect(),
        Err(_) => return false,
    };
    addrs
        .iter()
        .any(|addr| TcpStream::connect_timeout(addr, PROBE_TIMEOUT).is_ok())
}

/// reqwest builder with this process's proxy. `socks5h`: names are resolved
/// by Tor, so no DNS query leaves the machine.
pub fn client_builder() -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder();
    match active() {
        Some(e) => match reqwest::Proxy::all(format!("socks5h://{}", e.address())) {
            Ok(proxy) => builder.proxy(proxy),
            // Unreachable with a validated address; a dead proxy still beats a direct line.
            Err(err) => {
                log::error!("Cannot set the Tor proxy: {err}");
                builder.proxy(reqwest::Proxy::all("socks5h://127.0.0.1:9").expect("static proxy URL"))
            }
        },
        None => builder,
    }
}

/// Proxy for the webviews (Linux). The main window, CoW Swap and Jumper get the same one.
pub fn webview_proxy_url() -> Option<tauri::Url> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    active().and_then(|e| format!("socks5://{}", e.address()).parse().ok())
}

/// WebView2 command line (Windows). It replaces wry's defaults, so they are
/// repeated here. All webviews share one browser process, so they must get the
/// very same string. Besides the proxy, host names are never resolved locally
/// (DNS prefetch would otherwise leak them) and WebRTC may not bypass the proxy.
pub fn webview2_args() -> Option<String> {
    if !cfg!(windows) {
        return None;
    }
    let e = active()?;
    let mut exclude = vec!["localhost".to_string(), "*.localhost".to_string(), "127.0.0.1".to_string()];
    if !exclude.contains(&e.host) {
        exclude.push(e.host.clone());
    }
    let exclude = exclude.iter().map(|h| format!("EXCLUDE {h}")).collect::<Vec<_>>().join(" , ");
    Some(format!(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
         --proxy-server=socks5://{} \
         --host-resolver-rules=\"MAP * ~NOTFOUND , {exclude}\" \
         --force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        e.address()
    ))
}

/// Restart requested from the Privacy window; `run` acts on it after the event loop ends.
pub fn restart_requested() -> bool {
    RESTART.load(Ordering::Relaxed)
}

// ─── Commands ───────────────────────────────────────────────────────────────

/// Async so the port probes run off the main (UI) thread.
#[tauri::command]
pub async fn privacy_status(app: AppHandle) -> Value {
    let saved = settings::load_global(&app).privacy.unwrap_or_default();
    let startup = STARTUP.get().cloned().unwrap_or_default();
    let active = active().map(|e| {
        json!({ "address": e.address(), "source": e.source, "missing": e.missing })
    });
    json!({
        "platformSupported": platform_supported(),
        "saved": saved,
        "active": active,
        "startup": startup,
        // The saved choice differs from what this process runs with.
        "restartNeeded": saved != startup,
        "detected": {
            "torBrowser": port_open(TOR_BROWSER.0, TOR_BROWSER.1),
            "torService": port_open(TOR_SERVICE.0, TOR_SERVICE.1),
        },
    })
}

/// Asks check.torproject.org through `address` (or the active proxy) whether
/// the request came from Tor. It never goes out directly.
#[tauri::command]
pub async fn privacy_check(address: Option<String>) -> Result<Value, String> {
    let target = match address.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        Some(a) => {
            let (host, port) = parse_address(a)?;
            Endpoint { host, port, source: "manual", missing: false }.address()
        }
        None => active().map(|e| e.address()).ok_or("Tor is not in use")?,
    };
    let proxy = reqwest::Proxy::all(format!("socks5h://{target}")).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(Duration::from_secs(40))
        .build()
        .map_err(|e| e.to_string())?;
    let body: Value = client
        .get(CHECK_URL)
        .send()
        .await
        .map_err(|e| format!("No answer through {target}: {}", short_error(&e)))?
        .json()
        .await
        .map_err(|e| format!("Unexpected answer from check.torproject.org: {e}"))?;
    Ok(json!({
        "address": target,
        "isTor": body.get("IsTor").and_then(Value::as_bool).unwrap_or(false),
        "ip": body.get("IP").and_then(Value::as_str).unwrap_or(""),
    }))
}

fn short_error(err: &reqwest::Error) -> String {
    let mut text = err.to_string();
    let mut source = std::error::Error::source(err);
    while let Some(inner) = source {
        text = inner.to_string();
        source = inner.source();
    }
    text
}

#[tauri::command]
pub async fn privacy_save(
    app: AppHandle,
    tor_enabled: bool,
    manual: bool,
    address: Option<String>,
) -> Result<Value, String> {
    if tor_enabled && !platform_supported() {
        return Err("Tor is not available on this system yet".into());
    }
    let address = match address.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        Some(a) => {
            let (host, port) = parse_address(a)?;
            Some(Endpoint { host, port, source: "manual", missing: false }.address())
        }
        None => None,
    };
    if manual && address.is_none() {
        return Err("Enter the proxy address as host:port".into());
    }
    let next = PrivacySettings { tor_enabled, manual, address };
    settings::update_privacy(&app, &next);
    log::info!(
        "Privacy saved: Tor {}{}",
        if tor_enabled { "on" } else { "off" },
        if manual { " (manual address)" } else { "" }
    );
    Ok(privacy_status(app).await)
}

#[tauri::command]
pub fn privacy_restart(app: AppHandle) {
    log::info!("Restart requested to apply the Tor setting");
    RESTART.store(true, Ordering::Relaxed);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_addresses() {
        assert_eq!(parse_address("127.0.0.1:9050").unwrap(), ("127.0.0.1".into(), 9050));
        assert_eq!(parse_address(" socks5h://Tor.LAN:9150/ ").unwrap(), ("tor.lan".into(), 9150));
        assert_eq!(parse_address("[::1]:9050").unwrap(), ("::1".into(), 9050));
        assert!(parse_address("127.0.0.1").is_err());
        assert!(parse_address("127.0.0.1:0").is_err());
        assert!(parse_address("127.0.0.1:70000").is_err());
        assert!(parse_address("evil host:9050").is_err());
        assert!(parse_address("a\"b:9050").is_err());
        assert!(parse_address("http://x:1").is_err());
        assert!(parse_address("[nope]:9050").is_err());
    }

    /// Needs a SOCKS5 proxy: `PRIVACY_TEST_PROXY=127.0.0.1:9050 cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn checks_through_a_live_proxy() {
        let address = std::env::var("PRIVACY_TEST_PROXY").expect("PRIVACY_TEST_PROXY");
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let result = rt.block_on(privacy_check(Some(address))).expect("check");
        println!("{result}");
        assert!(result["ip"].as_str().is_some_and(|ip| !ip.is_empty()));
    }

    #[test]
    fn formats_ipv6() {
        let e = Endpoint { host: "::1".into(), port: 9050, source: "manual", missing: false };
        assert_eq!(e.address(), "[::1]:9050");
    }
}
