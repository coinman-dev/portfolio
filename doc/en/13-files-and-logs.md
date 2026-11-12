# Files, folders and logs

The program keeps everything next to its executable. There is nothing in the
system registry or in the user's home folder.

| Path | Contents |
|---|---|
| `data/base/*.json` | Portfolio databases; `default.json` opens by default |
| `data/settings.json` | Program and module settings, including the CoinMarketCap and NEAR Intents API keys |
| `data/cache.json` | Cached prices and the coin catalog |
| `data/wallets.json` | Saved wallets and WalletConnect sessions, including session keys |
| `data/exchange-history.json` | Best Rate swaps and deposits |
| `data/revoke-history.json` | Approval revokes |
| `data/jumper-storage.json` | Jumper preferences |
| `Logs/coinman-YYYY-MM-DD.log` | Daily logs, when Debug mode is on |

The browser storage of the window (cookies, local storage) is temporary and
is deleted when the program is closed normally. What has to survive a
restart is kept in the files above.

## Backups

To back up, close the program and copy the `data` folder. To move to another
computer, copy the program together with the `data` folder.

Only the portfolio database can be encrypted (see
[Database files and encryption](05-databases-and-encryption.md)). The other
files are stored as they are — `wallets.json` and `settings.json` in
particular should not be shared.

## Logs

Logs are off by default. Turn them on with **Settings → Debug mode (write
log files)**; **Settings → Open logs folder** opens the folder.

Starting the program with `--debug` turns on logs and the developer tools
(right click → Inspect) for that run only:

```
coinman-portfolio --debug
```

Logs help find the cause of a problem. They may contain wallet addresses and
transaction details; look through a log before you send it to anyone.
