//! Privacy → Tor: CoinMan's own Tor.
//!
//! The Tor Expert Bundle from dist.torproject.org is a plain `tor` executable
//! with its libraries and GeoIP files; no service and no administrator rights.
//! It is downloaded on request, checked against the Tor Browser Developers
//! signing key that ships with CoinMan, and unpacked into `data/tor/`. While Tor
//! is on, CoinMan starts it with a SOCKS port of its own and stops it on exit;
//! Tor also stops by itself when CoinMan is gone (`__OwningControllerProcess`).
//! Its state (guard nodes, consensus) stays in `data/tor/state` between runs.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use pgp::composed::{Deserializable, DetachedSignature, SignedPublicKey};
use pgp::types::KeyDetails;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Runtime};

use crate::settings;

const DIST: &str = "https://dist.torproject.org/torbrowser/";
/// Tor Browser Developers (signing key), as published by the Tor Project.
const SIGNING_KEY: &str = include_str!("../keys/tor-browser-developers.asc");
const SIGNING_FINGERPRINT: &str = "ef6e286dda85ea2a4ba7de684e2c6e8793298290";
/// SOCKS port of CoinMan's own Tor; Tor Browser has 9150, the service 9050.
pub const PORT: u16 = 9350;
const PROGRESS_EVENT: &str = "tor-install-progress";

static CHILD: Mutex<Option<Child>> = Mutex::new(None);
static BOOTSTRAP: AtomicU8 = AtomicU8::new(0);
static LAST_LINE: Mutex<String> = Mutex::new(String::new());
static INSTALLING: AtomicBool = AtomicBool::new(false);

/// Clears INSTALLING however `install` ends.
struct InstallGuard;

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::Release);
    }
}

/// The bundle name for this system, if the Tor Project builds one.
fn platform() -> Option<&'static str> {
    if cfg!(all(windows, target_arch = "x86_64")) {
        Some("windows-x86_64")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("linux-x86_64")
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Some("linux-aarch64")
    } else {
        None
    }
}

pub fn supported() -> bool {
    platform().is_some() && crate::privacy::platform_supported()
}

fn root<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    settings::data_dir(app).join("tor")
}

fn exe(root: &Path) -> PathBuf {
    root.join("tor").join(if cfg!(windows) { "tor.exe" } else { "tor" })
}

pub fn installed_version<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let root = root(app);
    if !exe(&root).is_file() {
        return None;
    }
    std::fs::read_to_string(root.join("version.txt"))
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn running() -> bool {
    let mut guard = CHILD.lock().unwrap_or_else(|p| p.into_inner());
    match guard.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(None) => true,
            _ => {
                *guard = None;
                false
            }
        },
        None => false,
    }
}

pub fn bootstrap() -> u8 {
    BOOTSTRAP.load(Ordering::Relaxed)
}

pub fn status<R: Runtime>(app: &AppHandle<R>) -> Value {
    json!({
        "supported": supported(),
        "installed": installed_version(app).is_some(),
        "version": installed_version(app),
        "running": running(),
        "bootstrap": bootstrap(),
        "lastLine": LAST_LINE.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        "port": PORT,
    })
}

// ─── Running ────────────────────────────────────────────────────────────────

/// Starts the installed Tor on 127.0.0.1:PORT (no-op while it runs).
pub fn start<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    start_in(&root(app))
}

fn start_in(root: &Path) -> Result<(), String> {
    if running() {
        return Ok(());
    }
    let exe = exe(root);
    if !exe.is_file() {
        return Err("CoinMan's Tor is not installed".into());
    }
    let state = root.join("state");
    std::fs::create_dir_all(&state).map_err(|e| format!("Cannot create {}: {e}", state.display()))?;
    // An empty torrc, so no torrc of a Tor installed elsewhere is picked up.
    let torrc = root.join("torrc");
    if !torrc.is_file() {
        std::fs::write(&torrc, b"").map_err(|e| e.to_string())?;
    }

    let mut cmd = Command::new(&exe);
    cmd.arg("-f")
        .arg(&torrc)
        .arg("--defaults-torrc")
        .arg(&torrc)
        .arg("--SocksPort")
        .arg(format!("127.0.0.1:{PORT}"))
        .arg("--DataDirectory")
        .arg(&state)
        .arg("--GeoIPFile")
        .arg(root.join("data").join("geoip"))
        .arg("--GeoIPv6File")
        .arg(root.join("data").join("geoip6"))
        .arg("--AvoidDiskWrites")
        .arg("1")
        .arg("--Log")
        .arg("notice stdout")
        .arg("--__OwningControllerProcess")
        .arg(std::process::id().to_string())
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(target_os = "linux")]
    cmd.env("LD_LIBRARY_PATH", root.join("tor"));

    BOOTSTRAP.store(0, Ordering::Relaxed);
    let mut child = cmd.spawn().map_err(|e| format!("Cannot start {}: {e}", exe.display()))?;
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || read_log(stdout));
    }
    log::info!("[tor] started CoinMan's Tor (pid {}) on 127.0.0.1:{PORT}", child.id());
    *CHILD.lock().unwrap_or_else(|p| p.into_inner()) = Some(child);
    Ok(())
}

fn read_log(stdout: impl Read) {
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        // "Nov 27 19:20:01.000 [notice] Bootstrapped 45% (requesting_descriptors): ..."
        let text = line.split_once("] ").map(|(_, t)| t).unwrap_or(&line).to_string();
        if let Some(rest) = text.strip_prefix("Bootstrapped ") {
            if let Some(pct) = rest.split('%').next().and_then(|n| n.trim().parse::<u8>().ok()) {
                BOOTSTRAP.store(pct.min(100), Ordering::Relaxed);
            }
            log::info!("[tor] {text}");
        } else if line.contains("[warn]") || line.contains("[err]") {
            log::warn!("[tor] {text}");
        } else {
            log::debug!("[tor] {text}");
        }
        *LAST_LINE.lock().unwrap_or_else(|p| p.into_inner()) = text;
    }
}

pub fn stop() {
    let child = CHILD.lock().unwrap_or_else(|p| p.into_inner()).take();
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
        log::info!("[tor] stopped CoinMan's Tor");
    }
    BOOTSTRAP.store(0, Ordering::Relaxed);
}

// ─── Installing ─────────────────────────────────────────────────────────────

/// Newest stable release in the Tor Browser distribution folder (16.0.3, not 16.0a14).
fn latest_from_listing(html: &str) -> Option<String> {
    let mut best: Option<(Vec<u32>, String)> = None;
    for part in html.split("href=\"").skip(1) {
        let Some(name) = part.split('"').next().and_then(|n| n.strip_suffix('/')) else {
            continue;
        };
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_digit() || c == '.') {
            continue;
        }
        let Ok(nums) = name.split('.').map(str::parse::<u32>).collect::<Result<Vec<_>, _>>() else {
            continue;
        };
        if best.as_ref().is_none_or(|(b, _)| nums > *b) {
            best = Some((nums, name.to_string()));
        }
    }
    best.map(|(_, name)| name)
}

fn client() -> Result<reqwest::Client, String> {
    // Through Tor when it is already in use (e.g. Tor Browser), directly otherwise.
    crate::privacy::client_builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(15 * 60))
        .build()
        .map_err(|e| e.to_string())
}

pub async fn latest_version() -> Result<String, String> {
    let html = client()?
        .get(DIST)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Cannot reach dist.torproject.org: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    latest_from_listing(&html).ok_or_else(|| "No Tor release found on dist.torproject.org".into())
}

/// Checks a detached signature against the bundled Tor Browser Developers key:
/// the signing subkey must be bound to that very primary key.
fn verify_signature(data: &[u8], armored_sig: &str) -> Result<(), String> {
    let (key, _) = SignedPublicKey::from_string(SIGNING_KEY).map_err(|e| format!("Signing key: {e}"))?;
    if hex(key.primary_key.fingerprint().as_bytes()) != SIGNING_FINGERPRINT {
        return Err("The bundled signing key is not the Tor Browser Developers key".into());
    }
    let (sig, _) = DetachedSignature::from_string(armored_sig).map_err(|e| format!("Signature: {e}"))?;
    let issuers: Vec<String> = sig
        .signature
        .issuer_fingerprint()
        .iter()
        .map(|f| hex(f.as_bytes()))
        .collect();
    let issuer_ids: Vec<String> = sig.signature.issuer_key_id().iter().map(|k| hex(k.as_ref())).collect();
    let matches = |fp: &str| issuers.iter().any(|i| i == fp) || issuer_ids.iter().any(|id| fp.ends_with(id.as_str()));

    if matches(SIGNING_FINGERPRINT) && sig.verify(&key.primary_key, data).is_ok() {
        return Ok(());
    }
    for sub in &key.public_subkeys {
        let fp = hex(sub.key.fingerprint().as_bytes());
        if !matches(&fp) {
            continue;
        }
        sub.verify_bindings(&key.primary_key)
            .map_err(|e| format!("The signing subkey is not bound to the Tor Browser Developers key: {e}"))?;
        return sig
            .verify(&sub.key, data)
            .map_err(|e| format!("The signature does not match the download: {e}"));
    }
    Err("Signed with a key CoinMan does not know; update CoinMan or install Tor yourself".into())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Unpacks tor/ (without pluggable transports) and the GeoIP files into `dest`.
fn extract(archive: &[u8], dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("Cannot create {}: {e}", dest.display()))?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(archive));
    let mut found_exe = false;
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let name = path.to_string_lossy().replace('\\', "/");
        let wanted = (name.starts_with("tor/") && !name.starts_with("tor/pluggable_transports"))
            || name == "data/geoip"
            || name == "data/geoip6";
        if !wanted || !entry.header().entry_type().is_file() {
            continue;
        }
        if name == "tor/tor" || name == "tor/tor.exe" {
            found_exe = true;
        }
        // unpack_in refuses paths that would leave `dest`.
        let ok = entry.unpack_in(dest).map_err(|e| format!("Cannot unpack {name}: {e}"))?;
        if !ok {
            return Err(format!("Refused a suspicious path in the archive: {name}"));
        }
    }
    if !found_exe {
        return Err("The archive has no tor executable".into());
    }
    Ok(())
}

fn progress<R: Runtime>(app: &AppHandle<R>, stage: &str, percent: Option<u8>) {
    let _ = app.emit(PROGRESS_EVENT, json!({ "stage": stage, "percent": percent }));
}

async fn download<R: Runtime>(app: &AppHandle<R>, client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let mut resp = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Download failed: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let mut data = Vec::with_capacity(total as usize);
    let mut last = u8::MAX;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Download failed: {e}"))? {
        data.extend_from_slice(&chunk);
        if let Some(pct) = (data.len() as u64 * 100).checked_div(total) {
            let pct = pct.min(100) as u8;
            if pct != last {
                last = pct;
                progress(app, "download", Some(pct));
            }
        }
    }
    Ok(data)
}

/// Downloads, checks and installs the newest Tor; replaces an older one.
pub async fn install<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    if INSTALLING.swap(true, Ordering::AcqRel) {
        return Err("Tor is already being installed".into());
    }
    let _busy = InstallGuard;
    let plat = platform().ok_or("The Tor Project has no Tor build for this system")?;
    progress(app, "version", None);
    let version = latest_version().await?;
    let file = format!("tor-expert-bundle-{plat}-{version}.tar.gz");
    let url = format!("{DIST}{version}/{file}");
    log::info!("[tor] installing {file}");

    let client = client()?;
    let archive = download(app, &client, &url).await?;
    let sig = client
        .get(format!("{url}.asc"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Cannot download the signature: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    progress(app, "verify", None);
    verify_signature(&archive, &sig)?;
    log::info!("[tor] signature of {file} is valid");

    progress(app, "unpack", None);
    let root = root(app);
    let staging = root.join("new");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    if let Err(e) = extract(&archive, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }

    // A running Tor holds its files; it is restarted on the new ones.
    let was_running = running();
    if was_running {
        stop();
    }
    for dir in ["tor", "data"] {
        let target = root.join(dir);
        let _ = std::fs::remove_dir_all(&target);
        std::fs::rename(staging.join(dir), &target).map_err(|e| format!("Cannot install {dir}/: {e}"))?;
    }
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::write(root.join("version.txt"), &version).map_err(|e| e.to_string())?;
    log::info!("[tor] installed Tor {version} into {}", root.display());
    if was_running {
        start(app)?;
    }
    progress(app, "done", Some(100));
    Ok(version)
}

pub fn remove<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if crate::privacy::active().is_some_and(|e| e.source == "built-in") {
        return Err("CoinMan's Tor is in use. Turn Tor off first (or choose another Tor), then remove it.".into());
    }
    stop();
    let root = root(app);
    std::fs::remove_dir_all(&root).or_else(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            Ok(())
        } else {
            Err(format!("Cannot remove {}: {e}", root.display()))
        }
    })?;
    log::info!("[tor] removed CoinMan's Tor");
    Ok(())
}

// ─── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn tor_builtin_latest() -> Result<String, String> {
    latest_version().await
}

#[tauri::command]
pub async fn tor_builtin_install(app: AppHandle) -> Result<Value, String> {
    let result = install(&app).await;
    if let Err(e) = &result {
        log::warn!("[tor] install failed: {e}");
        progress(&app, "error", None);
    }
    result.map(|_| status(&app))
}

#[tauri::command]
pub async fn tor_builtin_remove(app: AppHandle) -> Result<Value, String> {
    remove(&app)?;
    Ok(status(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_newest_stable_release() {
        let html = r#"<a href="15.0.9/">15.0.9/</a> <a href="16.0.3/">16.0.3/</a>
            <a href="16.0a14/">16.0a14/</a> <a href="16.0.10/">x</a> <a href="../">..</a>"#;
        assert_eq!(latest_from_listing(html).as_deref(), Some("16.0.10"));
        assert_eq!(latest_from_listing("nothing"), None);
    }

    #[test]
    fn bundled_key_is_the_tor_browser_key() {
        let (key, _) = SignedPublicKey::from_string(SIGNING_KEY).unwrap();
        assert_eq!(hex(key.primary_key.fingerprint().as_bytes()), SIGNING_FINGERPRINT);
        // A Windows checkout may turn the key file into CRLF lines.
        let crlf = SIGNING_KEY.replace("\r\n", "\n").replace('\n', "\r\n");
        let (key, _) = SignedPublicKey::from_string(&crlf).unwrap();
        assert_eq!(hex(key.primary_key.fingerprint().as_bytes()), SIGNING_FINGERPRINT);
    }

    #[test]
    fn rejects_a_forged_signature() {
        let fake = "-----BEGIN PGP SIGNATURE-----\n\nnothing\n-----END PGP SIGNATURE-----\n";
        assert!(verify_signature(b"data", fake).is_err());
    }

    /// Unpacks the real bundle, runs it and asks check.torproject.org through it.
    #[test]
    #[ignore]
    fn runs_and_reaches_the_tor_network() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let dir = std::env::temp_dir().join(format!("coinman-tor-run-{}", std::process::id()));
        rt.block_on(async {
            let version = latest_version().await.unwrap();
            let url = format!("{DIST}{version}/tor-expert-bundle-{}-{version}.tar.gz", platform().unwrap());
            let data = reqwest::get(&url).await.unwrap().bytes().await.unwrap();
            extract(&data, &dir).unwrap();
        });
        start_in(&dir).unwrap();
        for _ in 0..180 {
            if bootstrap() == 100 {
                break;
            }
            std::thread::sleep(Duration::from_secs(1));
        }
        println!("bootstrap {}%, last: {}", bootstrap(), LAST_LINE.lock().unwrap());
        let result = rt.block_on(crate::privacy::privacy_check(Some(format!("127.0.0.1:{PORT}"))));
        stop();
        assert!(!running());
        let _ = std::fs::remove_dir_all(&dir);
        let result = result.unwrap();
        println!("{result}");
        assert_eq!(result["isTor"], true);
    }

    /// Downloads the real bundle: `cargo test -- --ignored tor_builtin`.
    #[test]
    #[ignore]
    fn verifies_and_unpacks_the_real_bundle() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let version = latest_version().await.unwrap();
            let url = format!("{DIST}{version}/tor-expert-bundle-{}-{version}.tar.gz", platform().unwrap());
            let c = reqwest::Client::new();
            let data = c.get(&url).send().await.unwrap().bytes().await.unwrap();
            let sig = c.get(format!("{url}.asc")).send().await.unwrap().text().await.unwrap();
            verify_signature(&data, &sig).expect("valid signature");
            let mut tampered = data.to_vec();
            tampered[1000] ^= 1;
            assert!(verify_signature(&tampered, &sig).is_err(), "tampered archive must fail");
            let dir = std::env::temp_dir().join(format!("coinman-tor-test-{}", std::process::id()));
            extract(&data, &dir).unwrap();
            assert!(exe(&dir).is_file());
            assert!(dir.join("data").join("geoip").is_file());
            assert!(!dir.join("tor").join("pluggable_transports").exists());
            println!("Tor {version} verified and unpacked into {}", dir.display());
            let _ = std::fs::remove_dir_all(&dir);
        });
    }
}
