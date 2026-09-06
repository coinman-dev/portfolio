# CoinMan Exchange & Earn Module

В данном каталоге находятся исходные коды виджетов обмена (DEX/Bridge) и страницы Earn для десктопного приложения CoinMan.

## Структура
- `widgets/` — Единый модуль сборки всех виджетов:
  - `src/wallet/wallet.ts` — Универсальный слой подключения кошелька **OneKey HD** через **WalletConnect** (Reown Cloud) и Wagmi (EIP-1193). Сети: Ethereum, Arbitrum, Optimism, Polygon, BSC, Base, Avalanche, **Katana**.
  - `src/LiFiApp.tsx` — Модуль cross-chain обмена и мостов на базе **LI.FI Widget** (`@lifi/widget`).
  - `src/cowswap.ts` — Модуль DEX-обмена на базе **CoW Protocol** (`@cowprotocol/widget-lib`).
  - `src/earn/` — Страница **Earn • Yearn Finance**, перенесённая 1:1 с `yearn.fi` (тёмная тема `soft-dark`). См. ниже.
  - `src/index.tsx` — Единая точка экспорта для фронтенда (`CoinmanExchangeLiFi`, `CoinmanExchangeCowSwap`, `CoinmanWallet`, `mountYearn`).
  - Сборка: `npm run build` компилирует автономный бандл в `../../frontend/modules/modules.bundle.{js,css}` и синхронизирует копию в `../../frontend/exchange/`.

## Модуль Earn (`widgets/src/earn/`)

Реализация страницы Yearn Finance: список vaults, детальная страница vault и portfolio.
План и журнал реализации — `.ai/yearn-1to1-redesign-plan.md` и `.ai/yearn-1to1-progress.md`.

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
│                         # useVaultStrategies, usePortfolioHoldings (мультиколл-скан балансов)
├── components/
│   ├── shell/            # TopNav (+ мобильное меню), Breadcrumbs, PageContainer, ConnectWalletButton
│   ├── ui/               # icons.tsx
│   ├── list/             # фильтр-бар, заголовок, строки, раскрытие, Compare, модалки
│   ├── detail/           # шапка, KPI, sticky-табы, графики, Vault Info, Strategies, Risk, More Info
│   ├── charts/           # VaultChart, AllocationDonut (recharts)
│   ├── widget/           # Deposit/Withdraw/My Info, AmountInput, InfoPopover
│   ├── portfolio/        # PortfolioPage, PortfolioTabs, PortfolioMetrics, PortfolioHoldings, EmptySectionCard
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

Визуальная сверка с сайтом — через dev-харнесс `frontend/__earn-harness.html` и Playwright-скрипты
в `.ai/yearn-research/impl-scripts/` (методика описана в `.ai/yearn-1to1-progress.md`).

## Сохранение состояния
Сессии кошельков и пользовательские настройки сохраняются в общем файле `settings-cache.json` через Tauri IPC (`save_exchange_settings` / `load_exchange_settings`), что обеспечивает их сохранность при перезапуске программы. Настройки Earn (`vaultsList`, `portfolioTab`) приходят через `initialSettings` / `onSettingsChange` при монтировании модуля.
