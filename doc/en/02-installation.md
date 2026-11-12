# Installation

Download the file for your system from
[GitHub Releases](https://github.com/coinman-dev/portfolio/releases).
Versions with `-beta` in the name are test releases: back up your database
before updating (see [Files, folders and logs](13-files-and-logs.md)).

| System | File |
|---|---|
| Windows 10/11 x64 | `coinman-portfolio-windows-x64.zip` |
| Linux x64 (Ubuntu 22.04 and newer) | `coinman-portfolio-linux-x64.tar.gz` |
| macOS, Intel | `coinman-portfolio-macos-x86_64.dmg` |
| macOS, Apple Silicon (M1 and newer) | `coinman-portfolio-macos-aarch64.dmg` |

## Windows

1. Unpack the zip into a folder you can write to, for example
   `D:\CoinMan`. Not into `C:\Program Files`: the program keeps its data
   next to `coinman-portfolio.exe`.
2. Start `coinman-portfolio.exe`.

The program is not signed. If Windows SmartScreen says "Windows protected
your PC", click **More info → Run anyway**.

## Linux

1. Install WebKitGTK if it is not there yet:
   `sudo apt install libwebkit2gtk-4.1-0`.
2. Unpack the archive into a folder you can write to:
   `tar -xzf coinman-portfolio-linux-x64.tar.gz -C ~/CoinMan`.
3. Start `~/CoinMan/coinman-portfolio`.

The program works in X11 and Wayland sessions.

## macOS

Open the `.dmg` and drag the application to **Applications** or any other
folder. The program is not signed: on the first start, right-click it and
choose **Open**, then confirm.

## Only one copy at a time

Only one copy of the program runs at a time. Starting it again brings the
open window to the front.

## Updating

Once a week, a few seconds after start, the program checks GitHub for a new
version. When there is one, **Update available** appears on the right of the
status bar; click it to open the release page.

To update, replace the executable (`coinman-portfolio.exe` or
`coinman-portfolio`) with the new one and keep the `data` folder next to it.

## Removing

Close the program and delete its folder. All data — databases, settings,
saved wallets, histories and logs — is inside this folder (`data` and
`Logs`), so nothing is left behind.
