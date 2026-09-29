//! Exchange → Approvals: HyperSync queries go out from here.
//!
//! HyperSync (envio.dev) reads a wallet's whole approval history in one
//! request, but it answers without CORS headers, so the webview cannot call
//! it itself. The query is built by the frontend; this side only adds the
//! user's key, sends it to the network's HyperSync host and hands back the
//! answer. The key never goes to the diagnostic log.

use serde_json::Value;
use std::sync::LazyLock;
use std::time::Duration;

/// Networks Approvals scans (the wallet's EVM networks).
const CHAINS: &[u64] = &[
    1, 10, 56, 100, 130, 137, 146, 324, 5000, 8453, 42161, 43114, 59144, 81457, 534352, 747474,
];

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .unwrap_or_default()
});

/// Envio keys are UUID-like; anything else is a paste mistake.
fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 200
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[tauri::command]
pub async fn approvals_hypersync(chain_id: u64, token: String, query: Value) -> Result<Value, String> {
    if !CHAINS.contains(&chain_id) {
        return Err(format!("network {chain_id} is not scanned by Approvals"));
    }
    let key = token.trim();
    if !valid_key(key) {
        return Err("the HyperSync key looks wrong — paste it again in settings".into());
    }
    let resp = CLIENT
        .post(format!("https://{chain_id}.hypersync.xyz/query"))
        .bearer_auth(key)
        .json(&query)
        .send()
        .await
        .map_err(|e| format!("HyperSync unreachable: {e}"))?;
    let status = resp.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("HyperSync refused the key — check it in settings".into());
    }
    if status.as_u16() == 429 {
        return Err("HyperSync rate limit — try again in a minute".into());
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "HyperSync error {}: {}",
            status.as_u16(),
            text.chars().take(160).collect::<String>()
        ));
    }
    resp.json::<Value>()
        .await
        .map_err(|e| format!("HyperSync answer unreadable: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_key_shaped_strings() {
        assert!(valid_key("3f1c2d4e-5a6b-7c8d-9e0f-112233445566"));
        assert!(!valid_key(""));
        assert!(!valid_key("key with spaces"));
        assert!(!valid_key("abc\r\nX-Injected: 1"));
        assert!(!valid_key(&"a".repeat(201)));
    }

    #[test]
    fn scans_only_wallet_networks() {
        assert!(CHAINS.contains(&56));
        assert!(!CHAINS.contains(&999_999));
    }
}
