# Solving problems and FAQ

## Prices do not load

Look at **Market data** in the status bar. If it reports an error:

- check the internet connection;
- CoinGecko limits how often prices can be requested; wait a minute;
- with CoinMarketCap, check the key (**Settings → Fetch prices from
  CoinMarketCap**). If the key does not work, the program uses CoinGecko.

A coin without a price is counted at its buy price.

## I forgot the database password

The database cannot be decrypted without it — there is no recovery. Restore
a backup copy of the `data/base` folder, if you have one.

## The program does not start on Linux

Install WebKitGTK: `sudo apt install libwebkit2gtk-4.1-0`. Start the program
from a terminal to see the error message.

## Windows or macOS refuses to start the program

The program is not signed. Windows: **More info → Run anyway**. macOS:
right-click the program → **Open**.

## A second copy does not open

Only one copy runs at a time; starting it again brings the open window to the
front. If the window is not visible, look for it on the taskbar.

## Yearn vaults keep loading

The vault list comes from Yearn's servers (Kong and yDaemon). If one of them
does not answer, the list stays on the loading placeholders. Try again later;
yearn.fi in the browser will usually be affected too.

## Best Rate shows no routes

- Check the amount: very small amounts are refused by many services because
  of fees, very large ones may exceed the pools.
- Open **No route from N services** at the bottom — each service says why it
  has nothing.
- Look at **Over your N% fee limit** under the routes, and at the list of
  services in **⚙**: unticked services are not asked.

## The Deposit button is inactive

Type the receiving address first: the deposit memo must contain the address
the coins are paid to.

## Where are my wallet keys?

In your wallet. CoinMan keeps only WalletConnect sessions
(`data/wallets.json`) and asks the wallet to sign; each transaction is
confirmed in the wallet.

## How do I move to another computer?

Copy the program folder together with `data`. Saved WalletConnect sessions may
have to be reconnected on the new computer.

## Where do I report a problem?

On GitHub: [github.com/coinman-dev/portfolio/issues](https://github.com/coinman-dev/portfolio/issues).
Turn on **Debug mode**, repeat the problem and attach the log — after
removing addresses and anything else private from it.
