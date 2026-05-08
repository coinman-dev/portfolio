# CoinMan Portfolio Tracker

A simple desktop application for tracking and managing your cryptocurrency portfolio. All data is stored **locally on your hard drive** — no cloud, no servers, no registration required.

[![Release](https://img.shields.io/github/v/release/coinman-dev/portfolio.svg?include_prereleases)](https://github.com/coinman-dev/portfolio/releases)
[![Build Status](https://img.shields.io/github/actions/workflow/status/coinman-dev/portfolio/build-release.yml?branch=main)](https://github.com/coinman-dev/portfolio/actions)
[![Rust Version](https://img.shields.io/badge/rust-1.95.0%2B-orange.svg)](#)
[![Tauri Version](https://img.shields.io/badge/tauri-2.11.1-blue.svg)](https://tauri.app/)
[![Downloads](https://img.shields.io/github/downloads/coinman-dev/portfolio/total.svg)](https://github.com/coinman-dev/portfolio/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?longCache=true)](LICENSE)

---

## Why CoinMan?

Most portfolio tracking services store your data on their servers, where third parties can potentially access it. CoinMan Portfolio Tracker works differently: all information about your coins, transactions, and amounts stays exclusively on your machine in a plain JSON file.

- **Privacy first** — nobody knows what you hold
- **No registration** — no account, no email, no phone number
- **Works offline** — prices are fetched on demand, not required
- **Open source** — verify exactly what the app does

---

## Features

- Multiple independent portfolios within a single database file
- Add coins with buy price, amount, date, and notes
- Record sells and track realized profit/loss
- Automatic current price fetching via [CoinGecko API](https://www.coingecko.com/) or [CoinMarketCap API](https://coinmarketcap.com/) (configurable)
- P&L display and price change in %
- Switch between multiple database files at runtime
- **AES-256-GCM database encryption** with Argon2id key derivation
- Optional "Current Price" column (toggle in Settings)
- Status bar: loaded database name + market data status
- Debug logging to file (launch with `--debug` flag)
- Window size and position saved between launches

---

## Supported Platforms

| Platform | Status |
|----------|--------|
| Windows 10/11 | ✅ Supported |
| Linux (Ubuntu 22.04+) | ✅ Supported |
| macOS | ✅ Supported |

---

## Screenshots

![CoinMan Portfolio Tracker — Current tab](docs/screenshots/screenshot1.png)

![CoinMan Portfolio Tracker — Sold tab](docs/screenshots/screenshot2.png)

---

## Building from Source

The only host requirement is **Rust** ([install via rustup](https://rustup.rs/)). The build scripts under `scripts/` take care of everything else — system packages, the Windows cross-compile toolchain, Tauri CLI — and prompt before installing anything (default **Y**).

> Both scripts run on Debian/Ubuntu-based hosts: Linux directly, or Windows via WSL.

### Linux portable binary

```bash
git clone https://github.com/coinman-dev/portfolio.git
cd portfolio
bash scripts/build-linux-local.sh
```

Output: `target/release/coinman-portfolio`

> To run on another Ubuntu machine, the package `libwebkit2gtk-4.1-0` must be present on the target system.

### Windows portable `.exe` (cross-compiled from Linux/WSL)

```bash
git clone https://github.com/coinman-dev/portfolio.git
cd portfolio
bash scripts/build-windows-local.sh
```

Output: `target/x86_64-pc-windows-msvc/release/coinman-portfolio.exe`

The script uses [`cargo-xwin`](https://github.com/rust-cross/cargo-xwin), which fetches Microsoft's MSVC SDK on demand (MIT-licensed) — no Windows VM or Visual Studio install required.

### What the scripts do

- Verify prerequisites and offer to install anything missing (`apt`, `rustup target add`, `cargo install`).
- Stamp the binary version from the latest `v*` git tag plus the short HEAD SHA — e.g. `0.7.2-beta-37c3484` — so the version shown in the desktop UI uniquely identifies the build.
- Accept a specific tag as an argument: `bash scripts/build-linux-local.sh v0.7.0-beta`.
- Restore the working tree after the build via a `trap`, even on failure or Ctrl+C.

### Development mode

For hot-reload dev iteration:

```bash
cd portfolio
cargo tauri dev
```

Run the relevant build script once beforehand — it installs the same system packages and Tauri CLI that `cargo tauri dev` needs.

---

## Database File

By default, data is saved to `database/default.json` next to the executable. You can create multiple database files and switch between them via **File → Open database file**.

---

## Price Source

By default, CoinMan fetches live prices from the **CoinGecko API** (no API key required).

Optionally, you can switch to **CoinMarketCap** as the price source:

1. Go to **Settings → Price Source → CoinMarketCap**
2. Enter your CMC API key (free tier available at [coinmarketcap.com](https://coinmarketcap.com/api/))
3. The key is validated immediately — if valid, CMC becomes the active price source
4. The status bar shows `from CMC` or `from CG` to indicate which source was last used

If the CMC API key fails or is revoked, the app automatically falls back to CoinGecko.

---

## Database Encryption

CoinMan Portfolio Tracker supports **AES-256-GCM** encryption for database files, with keys derived via **Argon2id** (memory-hard key derivation). Your data is protected with modern, battle-tested cryptography.

### How it works

- Go to **File → Encrypt database** to set a password for the current database file
- The encrypted file is stored in-place — the same `.json` path, but the contents are encrypted
- On next launch (or when switching to an encrypted database), you will be prompted for the password
- Without the correct password, the file cannot be read or decrypted

### Key details

| Property | Value |
|----------|-------|
| Cipher | AES-256-GCM |
| Key derivation | Argon2id |
| KDF parameters | m=65536 (64 MB), t=2 iterations, p=1 |
| Salt | 16 bytes, randomly generated per file |
| Nonce | 12 bytes, randomly generated per encryption |

### Password management

- **Change password** — File → Change database password (re-encrypts with a new key)
- **Remove encryption** — File → Decrypt database (restores to plain JSON)
- The password is never stored anywhere — it is held in memory only for the current session

> **Important:** If you forget your password, there is no recovery option. Keep your password safe.

---

## Tech Stack

- [Tauri v2](https://tauri.app/) (2.11.x) — desktop app framework (Rust + WebView)
- Rust (MSRV 1.95.0) — backend, data storage, system calls
- Vanilla JavaScript / HTML / CSS — UI (no frameworks, no npm, no Node.js)
- Python 3 — used only by maintainer-side scripts under `scripts/catalog/` for coin catalog updates (not needed to run or build the app)
- [CoinGecko API](https://www.coingecko.com/) — live coin prices (default)
- [CoinMarketCap API](https://coinmarketcap.com/) — live coin prices (optional, requires API key)
- [CoinMarketCap](https://coinmarketcap.com/) — coin catalog & logos

---

## Built with AI

This project was developed with the help of AI tools:
- [ChatGPT](https://chat.openai.com/)
- [Google Gemini](https://gemini.google.com/)
- [Claude (Anthropic)](https://claude.ai/)

---

## Disclaimer

CoinMan Portfolio Tracker is provided **for informational purposes only**. It is not financial, investment, or trading advice. The authors are not responsible for any financial decisions made based on data displayed by this application. Use at your own risk.

---

## Data Attribution

Market price data is provided by the [CoinGecko API](https://www.coingecko.com/) (default) or the [CoinMarketCap API](https://coinmarketcap.com/) (optional). CoinMan Portfolio Tracker is not affiliated with or endorsed by CoinGecko or CoinMarketCap.

Coin catalog data (names, symbols, IDs) and coin logos are provided by [CoinMarketCap](https://coinmarketcap.com/). CoinMan Portfolio Tracker is not affiliated with or endorsed by CoinMarketCap.

---

## License

This project is licensed under the [MIT License](LICENSE).
