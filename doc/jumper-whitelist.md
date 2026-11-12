# Белый список Jumper Exchange

Встроенный `jumper.xyz` подписывает транзакции и сообщения только для контрактов из этого списка
(`modules/widgets/src/exchange/jumperGuard.ts`). Каждый адрес подтверждён официальным источником
протокола. Адрес, который не нашёлся в официальных источниках, блокируется.

Проверено 2026-10-21.

## Как искался список

Jumper получает маршруты не от публичного `li.quest`, а от своего бэкенда
`https://api.jumper.xyz/pipeline/v1` (переменная `NEXT_PUBLIC_LIFI_BACKEND_URL` в коде сайта). Кроме
маршрутов LI.FI он добавляет собственные шаги (`type: "jumper"`): Uniswap, CoW Swap, Velora Delta,
LI.FI Composer.

1. `POST /advanced/routes` с `options.executionType: "all"`, `integrator: "jumper.exchange"` во всех
   16 сетях кошелька CoinMan: USDC→нативная монета $10, нативная→USDC $5k, USDC→WETH $500k,
   USDC в другую сеть $50k. Из ответов собраны `estimate.approvalAddress`, `typedData`
   (домен, `primaryType`, `spender`).
2. `POST /advanced/stepTransaction` по одному шагу на пару «сеть + инструмент» для шагов вне LI.FI:
   адрес и селектор транзакции, домен подписываемого ордера.
3. Каждый адрес сверен с источниками ниже.

Сети: 1 Ethereum, 10 Optimism, 56 BSC, 100 Gnosis, 130 Unichain, 137 Polygon, 146 Sonic, 324 zkSync,
5000 Mantle, 8453 Base, 42161 Arbitrum, 43114 Avalanche, 59144 Linea, 81457 Blast, 534352 Scroll,
747474 Katana.

## Разрешено

### LI.FI — обычные маршруты (1inch, OKX, Kyber, Sushi, Across, Relay, Mayan, Stargate, NEAR и др.)

Проверка — `lifiGuard.ts`: транзакции в Diamond, вызовы `callDiamondWith*` у Permit2Proxy, approve на
Diamond и Permit2, подпись Permit2/EIP-2612 только для Permit2Proxy.

| Контракт | Адрес | Сети |
|---|---|---|
| LiFiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | 1 10 56 100 137 146 5000 8453 42161 43114 534352 |
| LiFiDiamond | `0x864b314D4C5a0399368609581d3E8933a63b9232` | 130 |
| LiFiDiamond | `0x341e94069f53234fE6DabeF707aD424830525715` | 324 |
| LiFiDiamond | `0xDE1E598b81620773454588B85D6b5D4eEC32573e` | 59144 |
| LiFiDiamond | `0xC59fe32C9549e3E8B5dCcdAbC45BD287Bd5bA2bc` | 747474 |
| Permit2Proxy | `0x89c6340B1a1f4b25D36cd8B063D49045caF3f818` | 1 10 56 100 137 146 8453 42161 43114 534352 |
| Permit2Proxy | `0x1BCd304fDAd1d1D66529159b1Bc8D13C9158D586` | 130 |
| Permit2Proxy | `0x2ec2c4C3dc212C990d1bc2b48b0392A3951D926E` | 324 |
| Permit2Proxy | `0xBDfF0c1C8B0b779581C4aC3bA1F29667C366C56e` | 5000 |
| Permit2Proxy | `0xE5A89411c7Ef1502123d84ec1F9Da9D8574F4293` | 59144 |
| Permit2Proxy | `0x628d684D57c73A5D8cA77F455Fdf2CC8Bd503c16` | 747474 |

Источники:
- https://github.com/lifinance/contracts/tree/main/deployments — `<сеть>.json`, поля `LiFiDiamond`, `Permit2Proxy`
- https://li.quest/v1/chains — поля `diamondAddress`, `permit2`, `permit2Proxy`

На Blast у LI.FI деплоя нет.

### Uniswap Permit2

| Адрес | Сети |
|---|---|
| `0x000000000022D473030F116dDEE9F6B43aC78BA3` | все, кроме zkSync |
| `0x0000000000225e31D15943971F47aD3022F714Fa` | 324 |

Источники:
- https://github.com/Uniswap/contracts/blob/main/deployments/1.md — раздел Permit2
- https://github.com/Uniswap/docs/blob/main/content/protocols/v3/deployments/v3-zksync-deployments.mdx

### Uniswap UniversalRouter V2.1.2 — шаг `uniswap`

Транзакция и получатель Permit2 `PermitSingle`.

| Адрес | Сети |
|---|---|
| `0x23617e59A5925b2A4Bf75d73ff6711cD0b29De85` | 1 |
| `0xC09255D86DB563cBc11C2fCf4a0C512e160111B4` | 10 |
| `0xDc264714F68d84CF29BC605589405E78bDBE7C9f` | 56 137 59144 |
| `0xD1b797D92d87B688193A2B976eFc8D577D204343` | 130 |
| `0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40` | 8453 |
| `0x2d01411773c8C24805306E89A41F7855C3c4Fe65` | 42161 |
| `0x661E93cca42AfacB172121EF892830cA3b70F08d` | 43114 |
| `0x28731BCC616B5f51dD52CF2e4dF0E78dD1136C06` (UniversalRouter zkSync) | 324 |

Источники:
- https://github.com/Uniswap/universal-router/tree/main/deploy-addresses — `<сеть>.json`, поле `UniversalRouterV2_1_2`
- zkSync: https://github.com/Uniswap/docs/blob/main/content/protocols/v3/deployments/v3-zksync-deployments.mdx

Uniswap просит `PermitSingle` на максимальную сумму сроком 30 дней. Такая подпись больше суммы
обмена, поэтому блокируется: при маршруте Uniswap выберите другой.

### CoW Protocol — шаг `cowswap`

Сети: 1 10 56 100 137 8453 42161 43114.

| Роль | Контракт | Адрес |
|---|---|---|
| approve, получатель EIP-2612 permit | GPv2VaultRelayer | `0xC92E8bdf79f0507f65a392b0ab4667716BFE0110` |
| подпись ордера (домен `Gnosis Protocol` v2) | GPv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` |
| транзакция при продаже нативной монеты | EthFlow | `0xba3cb449bd2b4adddbc894d8697f5170800eadec` |

Источники:
- https://github.com/cowprotocol/contracts/blob/main/networks.json
- https://github.com/cowprotocol/cow-sdk/blob/main/packages/config/src/chains/const/contracts.ts — `ETH_FLOW_ADDRESS`
- https://github.com/cowprotocol/docs/blob/main/docs/cow-protocol/reference/contracts/periphery/README.mdx

Ордер должен платить подключённому кошельку (`receiver` — кошелёк или нулевой адрес), срок — не больше
24 часов, `sellAmount + feeAmount` — не больше суммы обмена.

### Velora Delta (Portikus) — шаг `velora-delta`

Сети: 1 10 56 130 137 8453 42161.

| Роль | Адрес |
|---|---|
| approve, транзакция, получатель EIP-2612 permit, подпись ордера (домен `Portikus` 2.0.0) | `0x0000000000bbf5c5fd284e657f01bd000933c96d` |

Источники:
- https://api.velora.xyz/adapters/contracts?network=1 — поле `ParaswapDelta` (для других сетей — свой `network`);
  `Portikus` `0x0007005729e310000c6003402d8a0fb700da0c00` — деплоер адаптера
- https://api.paraswap.io/adapters/contracts?network=1 — то же
- https://github.com/VeloraDEX/paraswap-dex-lib — адрес в конфигурации
- Blockscout: верифицированный контракт `Adapter`, «PortikusV2, Laita Labs»

Ордер: `owner` и `beneficiary` — подключённый кошелёк, срок — не больше 24 часов, `srcAmount` — не больше
суммы обмена.

### FYND (Tycho) — шаг `fynd`

Approve на Permit2, получатель `PermitSingle` и транзакция.

| Адрес | Сети |
|---|---|
| `0x1644D2477f809cc2C71bCCFd6Dc9497E3F83210d` | 1 |
| `0x7f3D12BBaFb8955E51B3ab9588b34c8ad95BDA4e` | 56 |
| `0xCba5574597Ad00EA250Fd106DAB4Fc7461949635` | 130 |
| `0xbd4e6011F03355C2A377Fd9Af939322A7d0A1bC1` | 137 |
| `0xAbA5B53b03eAfaD1C5fc8BD5Fc765fC85Bb3de67` | 8453 |
| `0x924F147c50eA59f5180a26031A8b65B2aA1e81Cd` | 42161 |

Источники:
- https://github.com/propeller-heads/tycho/blob/main/crates/tycho-execution/config/router_addresses.json
- https://github.com/propeller-heads/tycho/blob/main/docs/for-solvers/execution/contract-addresses.md

## Заблокировано: не подтверждено

| Шаг | Адреса | Причина |
|---|---|---|
| `lifi-composer` («Composer») | транзакция: ProxyFactory `0xaceb3bb6c75488b5b806b9de4dcf78814465bdae`; approve: `0x2fe1d39837f47cd195f6df2f1499d37ea582c4e7` (кода нет) | В официальном https://github.com/lifinance/lifi-vm/blob/main/DEPLOYMENTS.md другие фабрики: `0x91157645e4e9AD252f5902C96e62036420076E96` (v1.1) и `0xe174D02351656a883f6626497C86684e849efB35` (v1.0). Эту создал другой деплоер (`0xbCcE61b2eabf7A7a1A5A17c17153B0A8Ba648Bd8`), у неё 99 транзакций. |

## Сумма обмена

Скрипт страницы (`src-tauri/src/jumper_page.js`) запоминает `fromAmount` маршрутов из ответов
`/advanced/routes`, `/advanced/stepTransaction` и `/quote` (через `fetch` и `XMLHttpRequest`) на 30 минут,
а также из незавершённых маршрутов виджета в `localStorage` (`*-widget-routes` — их исполняет и
«Try again»), и передаёт их с каждым вызовом кошелька. По ним:

- approve больше суммы обмена заменяется на approve ровно на сумму обмена — кошелёк покажет уже
  исправленную транзакцию;
- permit, `PermitSingle`, ордер CoW или Velora больше суммы обмена блокируются: чужую подпись изменить
  нельзя, сайт отправит исходное сообщение;
- если сумма обмена неизвестна, approve и подписи блокируются — обновите котировку.

## Повторная проверка

1. Повторить запросы из «Как искался список» (тот же `fromAddress`, без подписи).
2. Новый адрес — найти в официальном источнике протокола; не нашёлся — не добавлять.
3. Обновить таблицы здесь и в `jumperGuard.ts` / `lifiGuard.ts`.
