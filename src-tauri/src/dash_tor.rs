//! Privacy → Tor for Dash Core.
//!
//! While Tor is on in CoinMan, the saved Dash Core's `dash.conf` gets a block
//! that sends its peer-to-peer traffic through the same Tor (`proxy=`) and
//! stops it accepting direct incoming connections (`listen=0`). The block is
//! removed when CoinMan exits, and on the next start if CoinMan was killed.
//!
//! Dash Core, like Bitcoin Core, takes the FIRST value of a setting from its
//! config file, so the block goes at the very top. It reads `dash.conf` only
//! when it starts: a Dash-Qt that is already running picks the change up after
//! a restart (the Dash Core window shows whether it really uses the proxy).
//! A masternode needs incoming connections, so a config with a masternode key
//! is left alone. The user's own lines are never touched; the first time
//! CoinMan edits the file it keeps a copy as `dash.conf.coinman-backup`.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

const BEGIN: &str = "# >>> CoinMan: Tor — added while CoinMan runs, removed when it exits >>>";
const END: &str = "# <<< CoinMan: Tor <<<";
/// Inside the block when CoinMan had to create dash.conf: it is deleted again.
const CREATED: &str = "# (CoinMan created this file)";

/// Removes CoinMan's block. Returns the rest and whether CoinMan created the file.
fn strip(text: &str) -> (String, bool) {
    let mut out = Vec::new();
    let mut inside = false;
    let mut created = false;
    for line in text.split_inclusive('\n') {
        let bare = line.trim_end_matches(['\r', '\n']);
        if bare == BEGIN {
            inside = true;
        } else if bare == END && inside {
            inside = false;
        } else if inside {
            created |= bare == CREATED;
        } else {
            out.push(line);
        }
    }
    (out.concat(), created)
}

/// The config with CoinMan's block on top (proxy = `host:port`) or without it.
fn rewrite(text: Option<&str>, proxy: Option<&str>) -> Option<String> {
    let (rest, created) = match text {
        Some(t) => {
            let (rest, created) = strip(t);
            (rest, created)
        }
        None => (String::new(), true),
    };
    let Some(proxy) = proxy else {
        // Nothing of the user's left in a file CoinMan made: no file at all.
        return if created && rest.trim().is_empty() { None } else { Some(rest) };
    };
    let eol = if rest.contains("\r\n") { "\r\n" } else { "\n" };
    let mut block = vec![BEGIN.to_string()];
    if created {
        block.push(CREATED.to_string());
    }
    block.push(format!("proxy={proxy}"));
    block.push("listen=0".to_string());
    block.push(END.to_string());
    Some(format!("{}{eol}{rest}", block.join(eol)))
}

fn is_masternode(text: &str) -> bool {
    text.lines().any(|l| {
        let l = l.split('#').next().unwrap_or("").trim();
        l.starts_with("masternodeblsprivkey") || l.starts_with("masternode=1")
    })
}

fn conf_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = crate::dash_core::saved_dir(app)?;
    crate::dash_core::data_dir(&dir).map(|d| d.join("dash.conf"))
}

/// Puts the Tor block into the saved Dash Core's dash.conf (`proxy = Some`) or takes it out (`None`).
pub fn sync<R: Runtime>(app: &AppHandle<R>, proxy: Option<&str>) {
    if let Some(path) = conf_path(app) {
        apply(&path, proxy);
    }
}

pub fn apply(path: &Path, proxy: Option<&str>) {
    let current = fs::read_to_string(path).ok();
    if current.is_none() && proxy.is_none() {
        return;
    }
    let proxy = match (proxy, current.as_deref()) {
        (Some(_), Some(text)) if is_masternode(&strip(text).0) => {
            log::warn!("[dash-tor] {} belongs to a masternode; not routed through Tor", path.display());
            None
        }
        (p, _) => p,
    };
    let next = rewrite(current.as_deref(), proxy);
    if next.as_deref() == current.as_deref() {
        return;
    }
    // The user's own config, kept once before CoinMan first edits it.
    if let Some(text) = &current {
        let backup = path.with_file_name("dash.conf.coinman-backup");
        let (original, _) = strip(text);
        if !backup.exists() && !original.trim().is_empty() {
            let _ = fs::write(&backup, original);
        }
    }
    let result = match &next {
        Some(text) => fs::write(path, text),
        None => fs::remove_file(path),
    };
    match result {
        Ok(()) => log::info!(
            "[dash-tor] {}: {}",
            path.display(),
            match proxy {
                Some(p) => format!("Dash Core goes through Tor at {p} from its next start"),
                None => "Tor lines removed".to_string(),
            }
        ),
        Err(e) => log::warn!("[dash-tor] cannot update {}: {e}", path.display()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const USER: &str = "server=1\nrpcuser=u\nproxy=10.0.0.1:1080\n[test]\nrpcport=1\n";

    #[test]
    fn adds_on_top_and_removes_exactly() {
        let on = rewrite(Some(USER), Some("127.0.0.1:9350")).unwrap();
        assert!(on.starts_with(BEGIN));
        // On top: Dash Core takes the first value of a setting.
        assert!(on.find("proxy=127.0.0.1:9350").unwrap() < on.find("proxy=10.0.0.1:1080").unwrap());
        assert!(on.contains("listen=0"));
        assert!(on.ends_with(USER));
        // Again with another port: one block, the new port.
        let again = rewrite(Some(&on), Some("127.0.0.1:9150")).unwrap();
        assert_eq!(again.matches(BEGIN).count(), 1);
        assert!(again.contains("proxy=127.0.0.1:9150") && !again.contains("9350"));
        assert_eq!(rewrite(Some(&again), None).unwrap(), USER);
    }

    #[test]
    fn keeps_crlf_lines() {
        let user = USER.replace('\n', "\r\n");
        let on = rewrite(Some(&user), Some("127.0.0.1:9350")).unwrap();
        assert!(on.contains("listen=0\r\n") && !on.replace("\r\n", "").contains('\n'));
        assert_eq!(rewrite(Some(&on), None).unwrap(), user);
    }

    #[test]
    fn a_file_coinman_made_goes_away() {
        let on = rewrite(None, Some("127.0.0.1:9350")).unwrap();
        assert!(on.contains(CREATED));
        assert_eq!(rewrite(Some(&on), None), None);
        // ...unless the user wrote into it meanwhile.
        let edited = format!("{on}server=1\n");
        assert_eq!(rewrite(Some(&edited), None).as_deref(), Some("server=1\n"));
    }

    #[test]
    fn leaves_a_masternode_alone() {
        let dir = std::env::temp_dir().join(format!("coinman-dashtor-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("dash.conf");
        fs::write(&path, "masternodeblsprivkey=abc\n").unwrap();
        apply(&path, Some("127.0.0.1:9350"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "masternodeblsprivkey=abc\n");

        fs::write(&path, USER).unwrap();
        apply(&path, Some("127.0.0.1:9350"));
        assert!(fs::read_to_string(&path).unwrap().starts_with(BEGIN));
        assert_eq!(fs::read_to_string(dir.join("dash.conf.coinman-backup")).unwrap(), USER);
        apply(&path, None);
        assert_eq!(fs::read_to_string(&path).unwrap(), USER);
        let _ = fs::remove_dir_all(&dir);
    }
}
