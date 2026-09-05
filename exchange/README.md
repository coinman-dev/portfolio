# CoinMan Exchange Module

В данном каталоге находятся исходные коды виджетов обмена (DEX/Bridge) для десктопного приложения CoinMan.

## Структура
- `widgets/` — Единый модуль сборки всех виджетов обмена и моста кошельков:
  - `src/wallet.ts` — Универсальный слой подключения кошелька **OneKey HD** через **WalletConnect** (Reown Cloud) и Wagmi (EIP-1193).
  - `src/LiFiApp.tsx` — Модуль cross-chain обмена и мостов на базе **LI.FI Widget** (`@lifi/widget`).
  - `src/cowswap.ts` — Модуль DEX-обмена на базе **CoW Protocol** (`@cowprotocol/widget-lib`).
  - `src/index.tsx` — Единая точка экспорта для фронтенда (`CoinmanExchangeLiFi`, `CoinmanExchangeCowSwap`, `CoinmanWallet`).
  - Сборка: `npm run build` компилирует автономный бандл в `../../frontend/exchange/exchange-lifi.bundle.js`.

## Сохранение состояния
Сессии кошельков и пользовательские настройки сохраняются в общем файле `settings-cache.json` через Tauri IPC (`save_exchange_settings` / `load_exchange_settings`), что обеспечивает их сохранность при перезапуске программы.
