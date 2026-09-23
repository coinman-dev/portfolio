//! Session-only webview profile.
//!
//! The main webview runs in private mode, so cookies, local storage, IndexedDB
//! and the HTTP cache live in memory and vanish with the process. WebKitGTK
//! needs nothing on disk for that. WebView2 still insists on a user data folder
//! for its own bookkeeping (Local State, crash reports, component data), so on
//! Windows every process gets a fresh folder under %TEMP% that is deleted on
//! exit. Folders left by a crash or a forced kill are swept on the next start.
//!
//! Anything that must survive a restart belongs in `data/` next to the
//! executable, never in the webview profile.

use std::fs;
use std::io;
use std::path::PathBuf;

/// Clears profile folders older builds left behind and, on Windows, creates
/// the folder for this process. Returns the folder to hand to the webview.
pub fn prepare() -> io::Result<Option<PathBuf>> {
    remove_legacy();
    #[cfg(windows)]
    let dir = Some(windows::create(&std::env::temp_dir())?);
    #[cfg(not(windows))]
    let dir = None;
    Ok(dir)
}

/// Deletes this process's profile folder. Call once the webview is gone.
pub fn remove() {
    #[cfg(windows)]
    windows::remove();
}

/// Earlier builds kept the profile for good in `coinman-portfolio/webview-data`
/// under the per-user data folder. With LOCALAPPDATA set but empty that path
/// turned relative and the folder landed next to the executable.
fn remove_legacy() {
    let mut roots: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        roots.extend(non_empty_env("LOCALAPPDATA"));
        roots.extend(
            std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf())),
        );
    }
    #[cfg(not(windows))]
    roots.extend(
        non_empty_env("XDG_DATA_HOME")
            .or_else(|| non_empty_env("HOME").map(|home| home.join(".local").join("share"))),
    );

    for root in roots {
        let app_dir = root.join("coinman-portfolio");
        let _ = fs::remove_dir_all(app_dir.join("webview-data"));
        // Only succeeds when nothing else lives there.
        let _ = fs::remove_dir(&app_dir);
    }
    let _ = fs::remove_dir_all(std::env::temp_dir().join("coinman-portfolio-webview-data"));
}

fn non_empty_env(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

#[cfg(windows)]
mod windows {
    use std::fs::{self, File, OpenOptions};
    use std::io::{self, ErrorKind};
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::thread;
    use std::time::Duration;

    const DIR_PREFIX: &str = "coinman-portfolio-webview-";

    /// Held open without sharing for the owner's lifetime, so it cannot be
    /// deleted while the owner runs. That is how the sweep tells a live
    /// profile from an abandoned one.
    const LOCK_FILE: &str = "owner.lock";

    struct Profile {
        dir: PathBuf,
        lock: File,
    }

    static CURRENT: Mutex<Option<Profile>> = Mutex::new(None);

    pub fn create(root: &Path) -> io::Result<PathBuf> {
        sweep(root);
        let dir = root.join(format!("{DIR_PREFIX}{}", std::process::id()));
        fs::create_dir_all(&dir)?;
        let lock = hold_lock(&dir)?;
        *CURRENT.lock().unwrap() = Some(Profile {
            dir: dir.clone(),
            lock,
        });
        Ok(dir)
    }

    pub fn remove() {
        let Some(profile) = CURRENT.lock().unwrap().take() else {
            return;
        };
        drop(profile.lock);
        // WebView2's helper processes let go of their files a moment after the
        // window closes. Whatever is still held gets swept on the next start.
        for delay_ms in [0_u64, 100, 250, 500, 1000, 2000] {
            thread::sleep(Duration::from_millis(delay_ms));
            match fs::remove_dir_all(&profile.dir) {
                Ok(()) => return,
                Err(err) if err.kind() == ErrorKind::NotFound => return,
                Err(_) => {}
            }
        }
    }

    fn hold_lock(dir: &Path) -> io::Result<File> {
        OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .share_mode(0)
            .open(dir.join(LOCK_FILE))
    }

    /// Deletes profile folders whose owner is no longer running.
    fn sweep(root: &Path) {
        let Ok(entries) = fs::read_dir(root) else {
            return;
        };
        for entry in entries.flatten() {
            if !entry.file_name().to_string_lossy().starts_with(DIR_PREFIX) {
                continue;
            }
            let dir = entry.path();
            match fs::remove_file(dir.join(LOCK_FILE)) {
                Ok(()) => {}
                Err(err) if err.kind() == ErrorKind::NotFound => {}
                // Sharing violation: the owner is still running.
                Err(_) => continue,
            }
            let _ = fs::remove_dir_all(&dir);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn scratch(name: &str) -> PathBuf {
            let root = std::env::temp_dir()
                .join(format!("coinman-webview-test-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(&root).unwrap();
            root
        }

        #[test]
        fn sweep_keeps_live_profiles_only() {
            let root = scratch("sweep");
            let live = root.join(format!("{DIR_PREFIX}1"));
            let dead = root.join(format!("{DIR_PREFIX}2"));
            fs::create_dir_all(live.join("EBWebView")).unwrap();
            fs::create_dir_all(dead.join("EBWebView")).unwrap();
            let held = hold_lock(&live).unwrap();
            fs::write(dead.join(LOCK_FILE), b"").unwrap();

            sweep(&root);

            assert!(live.join("EBWebView").is_dir());
            assert!(!dead.exists());
            drop(held);
            let _ = fs::remove_dir_all(&root);
        }

        #[test]
        fn remove_deletes_the_profile() {
            let root = scratch("remove");
            let dir = create(&root).unwrap();
            fs::create_dir_all(dir.join("EBWebView").join("Default")).unwrap();
            fs::write(dir.join("EBWebView").join("Local State"), b"{}").unwrap();

            remove();

            assert!(!dir.exists());
            let _ = fs::remove_dir_all(&root);
        }
    }
}
