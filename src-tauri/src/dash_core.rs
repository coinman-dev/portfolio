//! Exchange → Connect wallet → Dash Core: the local Dash Core node as a wallet.
//!
//! Best Rate sends Maya / THORChain DASH deposits from it: the transaction
//! with the OP_RETURN memo is built, signed and broadcast through the node's
//! JSON-RPC. The user points at the Dash Core folder once; the RPC login is
//! read from `dash.conf` (rpcuser / rpcpassword) or the `.cookie` file at
//! every call and never leaves this side, nor goes to the diagnostic log.
//! Only the methods the deposit needs pass (no key export, no settings).

use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;
use tauri::{AppHandle, Runtime};

use crate::settings;

/// Mainnet RPC port; Maya and THORChain take mainnet DASH only.
const DEFAULT_PORT: u16 = 9998;

/// The RPC methods the frontend may call; wallet methods go to `/wallet/<name>`.
const ALLOWED: &[&str] = &[
    "getblockchaininfo",
    "getnetworkinfo",
    "listwallets",
    "getwalletinfo",
    "getbalances",
    "listunspent",
    "createrawtransaction",
    "decoderawtransaction",
    "signrawtransactionwithwallet",
    "testmempoolaccept",
    "sendrawtransaction",
    "walletpassphrase",
    "walletlock",
];

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .no_proxy()
        .build()
        .unwrap_or_default()
});

/// Where the program and its data were found inside the chosen folder.
struct Layout {
    exe: Option<PathBuf>,
    datadir: Option<PathBuf>,
}

/// The user may pick the program folder, the data folder or one holding both
/// (as a portable install does). The data folder is the one with `blocks`
/// or `dash.conf`; when the program folder has neither, Dash-Qt's default
/// `%APPDATA%\DashCore` is tried.
fn layout(dir: &Path) -> Layout {
    let exe = ["dash-qt.exe", "dashd.exe", "dash-qt", "dashd"]
        .iter()
        .map(|name| dir.join(name))
        .find(|p| p.is_file());
    let is_data = |p: &Path| p.join("blocks").is_dir() || p.join("dash.conf").is_file();
    let datadir = if is_data(dir) {
        Some(dir.to_path_buf())
    } else {
        std::env::var_os("APPDATA")
            .map(|a| PathBuf::from(a).join("DashCore"))
            .filter(|p| is_data(p))
    };
    Layout { exe, datadir }
}

/// `dash.conf` values for mainnet: lines before any section and in `[main]`.
fn read_conf(datadir: &Path) -> Option<Vec<(String, String)>> {
    let text = fs::read_to_string(datadir.join("dash.conf")).ok()?;
    let mut section = String::new();
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].trim().to_string();
            continue;
        }
        if !(section.is_empty() || section == "main") {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            out.push((k.trim().to_string(), v.trim().to_string()));
        }
    }
    Some(out)
}

fn conf_get<'a>(conf: &'a [(String, String)], key: &str) -> Option<&'a str> {
    // The last value wins, as in Dash Core.
    conf.iter()
        .rev()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

/// The RPC endpoint and the Basic-auth login.
struct Rpc {
    url: String,
    user: String,
    password: String,
}

fn rpc_for(datadir: &Path) -> Result<Rpc, String> {
    let conf = read_conf(datadir).unwrap_or_default();
    let port = conf_get(&conf, "rpcport")
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{port}");
    if let (Some(user), Some(password)) =
        (conf_get(&conf, "rpcuser"), conf_get(&conf, "rpcpassword"))
    {
        if !user.is_empty() && !password.is_empty() {
            return Ok(Rpc {
                url,
                user: user.into(),
                password: password.into(),
            });
        }
    }
    // Without a password in dash.conf the running node writes a one-time cookie.
    let cookie = fs::read_to_string(datadir.join(".cookie"))
        .map_err(|_| "no RPC login: dash.conf has no rpcuser/rpcpassword and there is no .cookie file (is Dash Core running with server=1?)".to_string())?;
    let (user, password) = cookie
        .trim()
        .split_once(':')
        .ok_or_else(|| "the .cookie file is damaged".to_string())?;
    Ok(Rpc {
        url,
        user: user.into(),
        password: password.into(),
    })
}

/// A wallet name goes into the URL path; it is percent-encoded byte by byte.
fn wallet_path(wallet: &str) -> String {
    let mut out = String::from("/wallet/");
    for b in wallet.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

async fn call(
    rpc: &Rpc,
    wallet: Option<&str>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let url = match wallet {
        Some(w) => format!("{}{}", rpc.url, wallet_path(w)),
        None => rpc.url.clone(),
    };
    let resp = CLIENT
        .post(url)
        .basic_auth(&rpc.user, Some(&rpc.password))
        .json(&json!({ "jsonrpc": "1.0", "id": "coinman", "method": method, "params": params }))
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                "Dash Core does not answer on its RPC port — start Dash-Qt (server=1 in dash.conf)"
                    .to_string()
            } else {
                format!("Dash Core RPC unreachable: {e}")
            }
        })?;
    let status = resp.status().as_u16();
    if status == 401 || status == 403 {
        return Err("Dash Core refused the RPC login from dash.conf / .cookie".into());
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Dash Core answered HTTP {status} without JSON: {e}"))?;
    if let Some(err) = body.get("error").filter(|e| !e.is_null()) {
        let code = err.get("code").and_then(Value::as_i64).unwrap_or(0);
        let message = err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("error");
        return Err(format!("Dash Core: {message} ({code})"));
    }
    Ok(body.get("result").cloned().unwrap_or(Value::Null))
}

fn saved_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    settings::load_dash_core(app)
        .get("dir")
        .and_then(Value::as_str)
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Check {
    ok: bool,
    /// A missing piece that blocks sending; `false` only informs.
    required: bool,
    label: String,
    hint: String,
}

fn check(ok: bool, required: bool, label: impl Into<String>, hint: impl Into<String>) -> Check {
    Check {
        ok,
        required,
        label: label.into(),
        hint: hint.into(),
    }
}

/// Checks a folder (or the saved one): the files, the RPC settings, the
/// running node and its loaded wallets. `ready` means a deposit can be sent.
#[tauri::command]
pub async fn dash_core_inspect(app: AppHandle, dir: Option<String>) -> Result<Value, String> {
    let dir = match dir.filter(|d| !d.trim().is_empty()) {
        Some(d) => PathBuf::from(d.trim()),
        None => saved_dir(&app).ok_or_else(|| "no Dash Core folder chosen yet".to_string())?,
    };
    let mut checks = Vec::new();
    if !dir.is_dir() {
        checks.push(check(
            false,
            true,
            "Folder exists",
            format!("{} is not a folder", dir.display()),
        ));
        return Ok(json!({ "dir": dir, "checks": checks, "ready": false }));
    }
    let found = layout(&dir);
    checks.push(match &found.exe {
        Some(p) => check(true, false, "Dash Core program", p.display().to_string()),
        None => check(
            false,
            false,
            "Dash Core program",
            "no dash-qt.exe / dashd.exe here — fine if this is only the data folder",
        ),
    });
    let Some(datadir) = found.datadir else {
        checks.push(check(
            false,
            true,
            "Data folder",
            "no blocks folder or dash.conf here nor in %APPDATA%\\DashCore — choose the folder Dash-Qt keeps its data in (Settings → Options → Open Configuration File shows it)",
        ));
        return Ok(json!({ "dir": dir, "exe": found.exe, "checks": checks, "ready": false }));
    };
    checks.push(check(
        datadir.join("blocks").is_dir() && datadir.join("chainstate").is_dir(),
        true,
        "Data folder",
        datadir.display().to_string(),
    ));

    let conf = read_conf(&datadir);
    let has_conf = conf.is_some();
    let conf = conf.unwrap_or_default();
    checks.push(check(
        has_conf,
        false,
        "dash.conf",
        if has_conf {
            "found".to_string()
        } else {
            "not found — create it in the data folder with server=1".to_string()
        },
    ));
    let testnet = ["testnet", "regtest", "devnet"]
        .iter()
        .any(|k| conf_get(&conf, k).is_some_and(|v| v == "1"));
    if testnet {
        checks.push(check(
            false,
            true,
            "Network",
            "dash.conf selects a test network; deposits need mainnet",
        ));
    }
    let server = conf_get(&conf, "server") == Some("1");
    checks.push(check(
        server,
        true,
        "RPC server (server=1)",
        if server {
            "on".to_string()
        } else {
            "add the line server=1 to dash.conf and restart Dash-Qt".to_string()
        },
    ));
    let login = if conf_get(&conf, "rpcuser").is_some() && conf_get(&conf, "rpcpassword").is_some()
    {
        Some("rpcuser / rpcpassword in dash.conf")
    } else if datadir.join(".cookie").is_file() {
        Some(".cookie file of the running node")
    } else {
        None
    };
    checks.push(check(
        login.is_some(),
        true,
        "RPC login",
        login.map(str::to_string).unwrap_or_else(|| {
            "none yet: with server=1 the running node writes a .cookie file; or add rpcuser= and rpcpassword= to dash.conf".to_string()
        }),
    ));

    let mut node = Value::Null;
    let mut wallets = Vec::new();
    match rpc_for(&datadir) {
        Err(e) => checks.push(check(false, true, "Node answers", e)),
        Ok(rpc) => {
            match call(&rpc, None, "getblockchaininfo", json!([])).await {
                Err(e) => checks.push(check(
                    false,
                    true,
                    "Node answers",
                    if e.contains("(-28)") {
                        format!("{e} — the node is starting, try again in a minute")
                    } else {
                        e
                    },
                )),
                Ok(info) => {
                    let chain = info.get("chain").and_then(Value::as_str).unwrap_or("");
                    let progress = info
                        .get("verificationprogress")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0);
                    let ibd = info
                        .get("initialblockdownload")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let blocks = info.get("blocks").and_then(Value::as_u64).unwrap_or(0);
                    let headers = info.get("headers").and_then(Value::as_u64).unwrap_or(0);
                    let version = call(&rpc, None, "getnetworkinfo", json!([]))
                        .await
                        .ok()
                        .and_then(|n| {
                            n.get("subversion")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                        .unwrap_or_default();
                    checks.push(check(
                        true,
                        true,
                        "Node answers",
                        format!("{} {}", version.trim_matches('/'), chain)
                            .trim()
                            .to_string(),
                    ));
                    if chain != "main" {
                        checks.push(check(
                            false,
                            true,
                            "Network",
                            format!("the node runs on {chain}; deposits need mainnet"),
                        ));
                    }
                    let synced = !ibd && progress > 0.9999 && headers <= blocks + 2;
                    checks.push(check(
                    synced,
                    true,
                    "Synchronised",
                    if synced {
                        format!("block {blocks}")
                    } else {
                        format!("{:.2}% (block {blocks} of {headers}) — wait until Dash-Qt finishes", progress * 100.0)
                    },
                ));
                    node = json!({ "chain": chain, "blocks": blocks, "headers": headers, "progress": progress, "synced": synced,
                    "pruned": info.get("pruned").cloned().unwrap_or(Value::Bool(false)), "version": version });
                    match call(&rpc, None, "listwallets", json!([])).await {
                        Err(e) => checks.push(check(false, true, "Wallet loaded", e)),
                        Ok(list) => {
                            for name in list.as_array().cloned().unwrap_or_default() {
                                let name = name.as_str().unwrap_or("").to_string();
                                let info = call(&rpc, Some(&name), "getwalletinfo", json!([]))
                                    .await
                                    .unwrap_or(Value::Null);
                                let encrypted = info.get("unlocked_until").is_some();
                                wallets.push(json!({
                                "name": name,
                                "encrypted": encrypted,
                                "unlockedUntil": info.get("unlocked_until").cloned().unwrap_or(Value::Null),
                                "balance": info.get("balance").cloned().unwrap_or(Value::Null),
                                "privateKeysEnabled": info.get("private_keys_enabled").cloned().unwrap_or(Value::Bool(true)),
                            }));
                            }
                            // The wallets on disk, to name them when none is open.
                            let on_disk = if wallets.is_empty() {
                                call(&rpc, None, "listwalletdir", json!([]))
                                    .await
                                    .ok()
                                    .and_then(|d| d.get("wallets").and_then(Value::as_array).cloned())
                                    .unwrap_or_default()
                                    .iter()
                                    .filter_map(|w| w.get("name").and_then(Value::as_str))
                                    .map(|n| if n.is_empty() { "(default)".to_string() } else { n.to_string() })
                                    .collect::<Vec<_>>()
                            } else {
                                Vec::new()
                            };
                            checks.push(check(
                                !wallets.is_empty(),
                                true,
                                "Wallet loaded",
                                if wallets.is_empty() && !on_disk.is_empty() {
                                    format!(
                                        "no wallet is open — open one in Dash-Qt (File → Open Wallet): {}",
                                        on_disk.join(", ")
                                    )
                                } else if wallets.is_empty() {
                                    "no wallet is open in Dash-Qt (File → Open Wallet)".to_string()
                                } else {
                                    format!("{} open", wallets.len())
                                },
                            ));
                        }
                    }
                }
            }
        }
    }
    let ready = checks.iter().all(|c| c.ok || !c.required);
    Ok(
        json!({ "dir": dir, "datadir": datadir, "exe": found.exe, "checks": checks, "node": node, "wallets": wallets, "ready": ready }),
    )
}

/// The folder picker for "Choose folder…".
#[tauri::command]
pub async fn dash_core_pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    let mut builder = app.dialog().file().set_title("Dash Core folder");
    if let Some(dir) = saved_dir(&app).filter(|d| d.is_dir()) {
        builder = builder.set_directory(dir);
    }
    builder.pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    let folder = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(folder.map(|f| f.to_string()))
}

/// `{dir}` remembered for the next launches; `null` forgets Dash Core.
#[tauri::command]
pub fn dash_core_save(app: AppHandle, dir: Option<String>) {
    let value = match dir.filter(|d| !d.trim().is_empty()) {
        Some(d) => json!({ "dir": d.trim() }),
        None => Value::Null,
    };
    settings::update_dash_core(&app, value);
}

#[tauri::command]
pub fn dash_core_saved(app: AppHandle) -> Value {
    settings::load_dash_core(&app)
}

/// One allow-listed RPC call to the saved node; `wallet` selects a loaded wallet.
#[tauri::command]
pub async fn dash_core_rpc(
    app: AppHandle,
    method: String,
    params: Value,
    wallet: Option<String>,
) -> Result<Value, String> {
    if !ALLOWED.contains(&method.as_str()) {
        return Err(format!("{method} is not used by CoinMan"));
    }
    let dir = saved_dir(&app).ok_or_else(|| {
        "Dash Core is not connected (Exchange → Connect wallet → Dash Core)".to_string()
    })?;
    let datadir = layout(&dir)
        .datadir
        .ok_or_else(|| "the Dash Core data folder is gone — choose it again".to_string())?;
    let rpc = rpc_for(&datadir)?;
    let params = if params.is_array() { params } else { json!([]) };
    // The passphrase must not reach the diagnostic log.
    if method != "walletpassphrase" {
        log::info!(
            "[DASHCORE] {method}{}",
            wallet
                .as_deref()
                .map(|w| format!(" ({w})"))
                .unwrap_or_default()
        );
    }
    call(&rpc, wallet.as_deref(), &method, params).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conf_sections_and_comments() {
        let dir = std::env::temp_dir().join(format!("coinman-dashconf-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("dash.conf"),
            "server=1\nrpcuser=u # comment\nrpcpassword=p\n#rpcport=1\n[test]\nrpcport=19998\n[main]\nrpcport=9999\n",
        )
        .unwrap();
        let conf = read_conf(&dir).unwrap();
        assert_eq!(conf_get(&conf, "rpcuser"), Some("u"));
        assert_eq!(conf_get(&conf, "rpcport"), Some("9999"));
        let rpc = rpc_for(&dir).unwrap();
        assert_eq!(rpc.url, "http://127.0.0.1:9999");
        assert_eq!(rpc.password, "p");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn wallet_names_are_encoded() {
        assert_eq!(wallet_path("Wallet-3"), "/wallet/Wallet-3");
        assert_eq!(wallet_path("my wallet/x"), "/wallet/my%20wallet%2Fx");
        assert_eq!(wallet_path(""), "/wallet/");
    }
}
