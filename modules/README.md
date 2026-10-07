# CoinMan Exchange & Earn Module

В данном каталоге находятся исходные коды виджетов обмена (DEX/Bridge) и страницы Earn для десктопного приложения CoinMan.

## Структура
- `widgets/` — Единый модуль сборки всех виджетов:
  - `src/wallet/` — Несколько сохранённых кошельков через **WalletConnect**, общий выбранный кошелёк для Exchange и Earn, отдельные подключения EVM, Tron и Solana. Список 16 EVM-сетей находится в `chains.ts`; отключённый кошелёк доступен для просмотра, для подписи требуется переподключение.
  - `src/exchange/LiFiApp.tsx` — Cross-chain обмен и мосты на базе **LI.FI Widget** (`@lifi/widget`), включая Tron; `lifiGuard.ts` проверяет транзакции перед подписью.
  - `src/exchange/cowswap.ts` — DEX-обмен на базе **CoW Protocol** (`@cowprotocol/widget-lib`) и панель ордеров.
  - `src/exchange/bestrate/` — Сравнение маршрутов семи сервисов, выполнение поддерживаемых обменов, отдельный получатель, настройки slippage и история обменов.
  - `src/exchange/jumperBridge.ts` — Связь встроенного `jumper.xyz` с выбранным кошельком; нативный webview реализован в `src-tauri/src/jumper.rs`.
  - `src/exchange/approvals/` — Поиск и отзыв разрешений токенов в 16 EVM-сетях, Tron и Solana. Для истории части EVM-сетей нужен ключ HyperSync.
  - `src/earn/` — Страница **Earn • Yearn Finance**, перенесённая 1:1 с `yearn.fi` (тёмная тема `soft-dark`). См. ниже.
  - `src/index.tsx` — Единая точка экспорта для фронтенда (`CoinmanExchangeLiFi`, `CoinmanExchangeCowSwap`, `CoinmanExchangeBestRate`, `CoinmanJumper`, `CoinmanApprovals`, `CoinmanWallet`, `CoinmanEarnYearn`).
  - Сборка: `npm run build` компилирует автономный бандл в `../../frontend/modules/modules.bundle.{js,css}` и синхронизирует копию в `../../frontend/exchange/`.

## Модуль Earn (`widgets/src/earn/`)

Реализация страницы Yearn Finance: список vaults, детальная страница vault и portfolio.
Также доступны история портфеля и операций, yvUSD unlocked/locked, стейкинг yBOLD, Enso zaps и миграция подходящих retired vaults.

```
earn/
├── YearnApp.tsx          # провайдеры (wagmi + react-query), роутинг vaults/detail/portfolio, shell
├── types.ts              # YearnVault и связанные типы
├── yearnApi.ts           # yDaemon: список vaults, сети, слияние yvUSD unlocked/locked, yBOLD staking
├── kongApi.ts            # Kong REST: timeseries (APY/TVL/PPS) + snapshot (inceptTime, risk)
├── yearnContracts.ts     # ERC-20/ERC-4626 + LockerZapper и LockedyvUSD (zap, cooldown)
├── constants.ts          # адреса yvUSD/yBOLD/zap, ссылки, меню навигации
├── format.ts             # форматирование чисел/дат по правилам yearn.fi
├── vaultMeta.ts          # категории, типы, бейджи, getHeadlineAPY/getMonthAgoAPY
├── openExternal.ts       # внешние ссылки через Tauri open_url
├── assets/               # логотип и wordmark Yearn
├── hooks/                # useVaultActions (depozit/withdraw/zap/cooldown), useVaultChart,
│                         # useVaultStrategies, usePortfolioHoldings, usePortfolioHistory, useActivity, useZap
├── components/
│   ├── shell/            # TopNav (+ мобильное меню), Breadcrumbs, PageContainer, ConnectWalletButton
│   ├── ui/               # icons.tsx
│   ├── list/             # фильтр-бар, заголовок, строки, раскрытие, Compare, модалки
│   ├── detail/           # шапка, KPI, sticky-табы, графики, Vault Info, Strategies, Risk, More Info
│   ├── charts/           # VaultChart, AllocationDonut (recharts)
│   ├── widget/           # Deposit/Withdraw/My Info, TokenPicker, MigratePanel, RecentTransactions
│   ├── portfolio/        # PortfolioPage, Holdings, PortfolioHistoryChart, PortfolioActivity
│   ├── activity/         # строки истории операций
│   ├── shared/           # VaultAboutSection, Markdown, RiskScoreTag
│   └── TokenIcon.tsx
└── styles/               # tokens, fonts, ui, shell, vault-list, vault-detail, charts, widget, portfolio
```

Все CSS-классы имеют префикс `.y-` и живут внутри `.yearn-root`, чтобы не конфликтовать со стилями
приложения и виджета Exchange. Брейкпоинты совпадают с сайтом: `md = 768px`, `lg = 1024px`, плюс
`1075px` для сворачивания кнопки Filters.

### Проверки после правок
```bash
cd modules/widgets && npx tsc --noEmit   # строгий TS: noUnusedLocals/Parameters
cd modules/widgets && npm run build      # обновляет frontend/modules/* и копию frontend/exchange/*
```

Перед первой проверкой установите зависимости: `cd modules/widgets && npm ci --legacy-peer-deps`.
Текущий lock-файл требует legacy-разрешения peer dependencies; без этого флага новый npm отклоняет установку.
Обновлённые бандлы в `frontend/modules/` и `frontend/exchange/` коммитятся вместе с исходниками.
Для визуальной проверки Earn доступен dev-харнесс `frontend/__earn-harness.html`.

## Сохранение состояния
Файлы находятся в `data/` рядом с исполняемым файлом:

- `settings.json` — настройки Exchange и Earn через `save_exchange_settings` / `load_exchange_settings` и `save_earn_settings` / `load_earn_settings`. Настройки Earn приходят через `initialSettings` / `onSettingsChange` при монтировании.
- `wallets.json` — список кошельков и WalletConnect-сессии через `load_wallet_store` / `save_wallet_store`; каждый кошелёк имеет отдельное пространство ключей.
- `exchange-history.json` и `revoke-history.json` — истории Best Rate и Approvals.
- `jumper-storage.json` — сохраняемые настройки Jumper.

Webview-профиль временный. Перечисленные файлы сохраняются между запусками и не шифруются паролем базы портфеля; `wallets.json` содержит ключи сессий и требует такого же бережного обращения, как другие приватные данные.
