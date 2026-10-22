import { getLang } from './index';

/**
 * Translates dynamic Yearn vault / strategy / token descriptions returned by
 * yDaemon & Kong APIs into Russian when the UI language is 'ru'.
 *
 * Also interpolates `{{token}}` with the vault's underlying token symbol.
 */
export function translateVaultDescription(raw: string, tokenSymbol?: string): string {
  if (!raw) return '';
  const symbol = tokenSymbol || 'token';
  const withToken = raw.replace(/\{\{\s*token\s*\}\}/gi, symbol);
  if (getLang() !== 'ru') return withToken;

  const trimmed = withToken.trim();
  if (EXACT_DESCRIPTIONS_RU[trimmed]) {
    return EXACT_DESCRIPTIONS_RU[trimmed];
  }
  const rawTrimmed = raw.trim();
  if (EXACT_DESCRIPTIONS_RU[rawTrimmed]) {
    return EXACT_DESCRIPTIONS_RU[rawTrimmed].replace(/\{\{\s*token\s*\}\}/gi, symbol);
  }

  let out = withToken;
  for (const [pattern, replacement] of DESCRIPTION_PATTERNS_RU) {
    out = out.replace(pattern, replacement as any);
  }
  return out;
}

const EXACT_DESCRIPTIONS_RU: Record<string, string> = {
  "yBOLD is Yearn's BOLD tokenized Stability pool product. It is designed to tokenize the different benefits of a BOLD-in-Stability-Pool position in a simple, user-friendly way.":
    "yBOLD — токенизированный продукт пула стабильности (Stability Pool) для BOLD от Yearn. Он позволяет получать все преимущества позиции BOLD в пуле стабильности в простом и удобном виде.",

  "sUSDaf is Yearn's USDaf tokenized Stability pool product built for Asymmetry's USDaf. It is designed to tokenize the benefits of a USDaf-in-Stability-Pool position in a simple, user-friendly way, auto-compounding and auto-harvesting so you get the best yield on your USDaf in one click.":
    "sUSDaf — токенизированный продукт пула стабильности от Yearn для USDaf (Asymmetry). Позволяет получать все преимущества позиции USDaf в пуле стабильности с автоматическим сбором и реинвестированием наград в один клик.",

  "USD denominated, cross-chain, cross asset vault. Optionally lock shares to earn a higher yield by allowing the vault to take on longer duration positions.":
    "Мультисетевое мультиактивное хранилище, номинированное в USD. Доли можно опционально заблокировать для получения повышенной доходности за счёт более долгосрочных позиций хранилища.",

  "Liquid Locker Compounder Vaults are special vaults that auto-allocate deposited funds to liquid lockers to maximize dYFI rewards.":
    "Хранилища-компаундеры ликвидных локеров автоматически распределяют внесённые средства в ликвидные локеры для максимизации вознаграждений в dYFI.",

  "Deposit your yCRV into Yearn's auto-compounding vault and start earning the maximum APY immediately. The vault will handle staking, claiming and swapping rewards, and reinvesting your yCRV for you. For more details about yCRV, check out Yearn's [docs](https://docs.yearn.fi/getting-started/products/ylockers/ycrv/overview).":
    "Внесите yCRV в хранилище Yearn с автореинвестированием и сразу начните получать максимальный APY. Хранилище автоматически выполняет стейкинг, сбор и обмен наград, а также реинвестирование yCRV. Подробнее об yCRV — в [документации Yearn](https://docs.yearn.fi/getting-started/products/ylockers/ycrv/overview).",

  "Deposit your yYB (Yearn's Yield Basis liquid locker token) and start earning the maximum APY immediately. The vault will handle staking, claiming and swapping weekly rewards, and reinvesting your yYB for you. For more details about yYB, check out Yearn's [docs](https://docs.yearn.fi/getting-started/products/ylockers/yyb/overview) or our yYB [app](https://yyb.yearn.fi/).":
    "Внесите yYB (токен ликвидного локера Yield Basis от Yearn) и сразу начните получать максимальный APY. Хранилище автоматически выполняет стейкинг, сбор и обмен еженедельных наград, а также реинвестирование yYB. Подробнее об yYB — в [документации Yearn](https://docs.yearn.fi/getting-started/products/ylockers/yyb/overview) или в [приложении yYB](https://yyb.yearn.fi/).",

  "Deposits USDS into Sky's Rewards Token Module and auto-compounds the SKY Rewards into more USDS.":
    "Вносит USDS в модуль вознаграждений Sky и автоматически реинвестирует награды SKY в дополнительные USDS.",

  "Invests the USDS into Sky's Rewards Token Module and auto-compounds the SKY Rewards into more USDS.":
    "Инвестирует USDS в модуль вознаграждений Sky и автоматически реинвестирует награды SKY в дополнительные USDS.",

  "Invests the USDS into the Sky Savings Rate.":
    "Инвестирует USDS в сберегательную ставку Sky (Sky Savings Rate).",

  "Invests the DAI through Sky into USDS and farms yearn's USDS vault for yield.":
    "Конвертирует DAI через Sky в USDS и размещает их в хранилище USDS от Yearn для получения дохода.",

  "Invests the USDC through MakerDAO's Peg Stability Module (PSM) and Sky into USDS and farms yearn's USDS vault for yield.":
    "Конвертирует USDC через модуль стабильности привязки (PSM) MakerDAO и Sky в USDS и размещает их в хранилище USDS от Yearn для получения дохода.",

  "Invests the USDC through MakerDAO's Peg Stability Module (PSM) into sDAI to benefit from the Dai Savings Rate.":
    "Конвертирует USDC через модуль стабильности привязки (PSM) MakerDAO в sDAI для получения дохода по ставке сбережений Dai (DSR).",

  "Lends WETH to Across Protocol and auto-compounds the ACX rewards into more WETH.":
    "Предоставляет WETH в пул ликвидности протокола Across и автоматически реинвестирует награды ACX в дополнительные WETH.",

  "Supplies the juiced Yearn vault token to the corresponding staking contract to auto sell and compound any rewards. <br/><br/>Visit [https://juiced.yearn.fi/](https://juiced.yearn.fi/) to learn more.":
    "Размещает токен хранилища Juiced Yearn в соответствующем контракте стейкинга для автоматической продажи и реинвестирования наград. <br/><br/>Подробнее на [https://juiced.yearn.fi/](https://juiced.yearn.fi/).",

  "This is an LP Token Vault on Ethereum that accepts BOLDUSDC LP tokens from Curve and autocompounds the fees, incentives, and emissions, optimizing for best yield across Yearn and Convex's veCRV boosts. The LP position contains Liquity's BOLD stablecoin and Circle's USDC stablecoin. For more details, check out Liquity's [website](https://www.liquity.org/).":
    "Хранилище LP-токенов в сети Ethereum, которое принимает LP-токены BOLDUSDC с Curve и автоматически реинвестирует комиссии, вознаграждения и эмиссию, оптимизируя доходность за счёт бустов veCRV от Yearn и Convex. LP-позиция состоит из стейблкоина BOLD от Liquity и USDC от Circle. Подробнее — на [сайте Liquity](https://www.liquity.org/).",

  "This multi-strategy USDC vault allocates to Silo markets on Ethereum that accept LRTs (Liquid Restaking Tokens) and their derivatives as collateral. For more information on the markets either check out the vaults tab or see Silo's [website](https://app.silo.finance).":
    "Это мультистратегическое хранилище USDC распределяет ликвидность по рынкам Silo в сети Ethereum, которые принимают токены ликвидного рестейкинга (LRT) и их деривативы в качестве залога. Подробнее о рынках — во вкладке хранилищ или на [сайте Silo](https://app.silo.finance).",

  "This vault invests into [Pendle PT Markets](https://app.pendle.finance/trade/markets) and automatically rolls them gas-free into the next maturity upon expiry. <br/><br/>Read the [Pendle Docs](https://docs.pendle.finance/) to learn about the associated risks. Withdrawals may result in a loss depending on withdrawal size and current market conditions.":
    "Это хранилище инвестирует в [рынки Pendle PT](https://app.pendle.finance/trade/markets) и по истечении срока автоматически без затрат на газ перекладывает средства в следующий срок погашения. <br/><br/>Ознакомьтесь с [документацией Pendle](https://docs.pendle.finance/), чтобы узнать о сопутствующих рисках. Вывод средств может привести к убытку в зависимости от размера вывода и текущих рыночных условий.",

  "True Yield Dollar (TYD) is Trueo's yield-bearing USDC vault that holds the collateral for Trueo's prediction markets. TYD lets Trueo users earn yield on their open predictions, reducing the opportunity cost of holding them until maturity.\n\nThis vault is designed to earn returns through low-risk strategies, aiming to outperform or match the Aave USDC lending rate on Base.":
    "True Yield Dollar (TYD) — доходное хранилище USDC от Trueo, в котором хранится обеспечение для рынков предсказаний Trueo. TYD позволяет пользователям Trueo получать доход по открытым позициям до момента их расчёта.\n\nХранилище использует низкорисковые стратегии с целью обеспечить доходность на уровне или выше ставки кредитования USDC на Aave в сети Base.",

  "{{token}} is swapped for a corresponding staking derivative to earn the staking rewards.":
    "{{token}} обменивается на соответствующий дериватив ликвидного стейкинга для получения вознаграждений за стейкинг.",
};

const DESCRIPTION_PATTERNS_RU: Array<[RegExp, string | ((...args: any[]) => string)]> = [
  // Multi strategy <TOKEN> vault.
  [
    /Multi strategy ([^\s.<]+(?:\.e)?) vault\./gi,
    'Мультистратегическое хранилище $1.',
  ],
  // Single strategy <TOKEN> vault.
  [
    /Single strategy ([^\s.<]+(?:\.e)?) vault\./gi,
    'Одностратегическое хранилище $1.',
  ],
  // Multi strategy vaults are (wait for it) vaults that contain multiple strategies...
  [
    /Multi strategy vaults are \(wait for it\) vaults that contain multiple strategies\.\s*Multi strategy vaults give the vault creator flexibility to balance risk and opportunity across multiple different strategies\.?/gi,
    'Мультистратегические хранилища содержат сразу несколько стратегий. Это даёт управляющему хранилищем гибкость для балансировки рисков и доходности между различными стратегиями.',
  ],
  // 'Horizon' vaults...
  [
    /'Horizon' vaults are the next generation of Yearn vaults focused on generating higher yields\.\s*They will use strategies deploying into less proven but potentially higher yielding protocols than the standard vaults\.\s*These strategies may have a higher likely?hood of becoming temporarily illiquid or even producing losses, but are expected to earn more yield than others\.?/gi,
    'Хранилища «Horizon» — новое поколение хранилищ Yearn, ориентированное на повышенную доходность. Они используют стратегии в менее проверенных, но потенциально более доходных протоколах, чем стандартные хранилища. Такие стратегии могут иметь более высокую вероятность временной неликвидности или убытков, но рассчитаны на получение более высокой доходности.',
  ],
  // Vaults labeled with the category of -2...
  [
    /Vaults labeled with the category of -2 will use strategies deploying into less proven but potentially higher yielding protocols than the standard vaults\.\s*These strategies may have a higher likely?hood of becoming temporarily illiquid or even producing losses, but are expected to earn more yield than others\.?/gi,
    'Хранилища с категорией «-2» используют стратегии в менее проверенных, но потенциально более доходных протоколах, чем стандартные хранилища. Такие стратегии могут иметь более высокую вероятность временной неликвидности или убытков, но рассчитаны на получение более высокой доходности.',
  ],
  // Flex <TOKEN> is an allocator vault...
  [
    /Flex ([^\s]+) is an allocator vault managed by the Yearn Curation team\.\s*It lends ([^\s]+) across several Flex markets, with the Vaults team setting each market's allocation and caps\.\s*information about Flex and its Markets can be found at (https?:\/\/[^\s.]+)\.?/gi,
    'Flex $1 — хранилище-аллокатор под управлением команды кураторов Yearn. Оно размещает $2 на нескольких рынках Flex, для каждого из которых команда хранилищ устанавливает долю и лимиты. Подробнее о Flex и его рынках: $3.',
  ],
  // Supplies <TOKEN> to the Yearn-managed Meta Morpho vault on Katana...
  [
    /Supplies ([^\s]+) to the Yearn-managed Meta Morpho vault on Katana, earning the underlying yield and auto-compounding all reward tokens except KAT, which can be claimed at (https?:\/\/[^\s]+)\./gi,
    'Поставляет $1 в управляемое Yearn хранилище Meta Morpho в сети Katana, получая базовую доходность и автоматически реинвестируя все токены наград, кроме KAT (награды KAT можно забрать на $2).',
  ],
  // Supplies <TOKEN> to the Meta Morpho vault managed by Yearn...
  [
    /Supplies ([^\s]+) to the Meta Morpho vault managed by Yearn, earning the underlying yield and auto-compounding all reward tokens\./gi,
    'Поставляет $1 в управляемое Yearn хранилище Meta Morpho, получая базовую доходность и автоматически реинвестируя все токены вознаграждений.',
  ],
  // Supplies <TOKEN> to the corresponding [Meta Morpho](...) vault...
  [
    /Supplies ([^\s]+) to the corresponding \[Meta Morpho\]\(([^)]+)\) vault earning the underlying yield and auto-compounding all reward tokens\./gi,
    'Поставляет $1 в соответствующее хранилище [Meta Morpho]($2), получая базовую доходность и автоматически реинвестируя все токены вознаграждений.',
  ],
  // Supplies <TOKEN> to [Aave V3](...)
  [
    /Supplies ([^\s]+) to \[Aave V3\]\(([^)]+)\) to generate interest and earn any applicable rewards\.\s*Earned tokens are harvested, sold for more ([^\s]+) which is deposited back into the strategy\./gi,
    'Поставляет $1 в протокол [Aave V3]($2) для начисления процентов и получения вознаграждений. Заработанные токены собираются, обмениваются на $3 и реинвестируются обратно в стратегию.',
  ],
  // Supplies <TOKEN> on [Compound Finance](...) to generate interest and earn COMP...
  [
    /Supplies ([^\s]+) on \[Compound Finance\]\(([^)]+)\) to generate interest and earn COMP\.\s*Earned tokens are harvested, sold for more ([^\s]+) which is deposited back into the strategy\./gi,
    'Поставляет $1 в протокол [Compound Finance]($2) для начисления процентов и получения наград COMP. Заработанные токены собираются, обмениваются на $3 и реинвестируются обратно в стратегию.',
  ],
  // Supplies <TOKEN> to [Compound Finance](...) to use as collateral to borrow USDC.e...
  [
    /Supplies ([^\s]+) to \[Compound Finance\]\(([^)]+)\) to use as collateral to borrow ([^\s]+) which it deposits back in to earn COMP\.\s*Earned tokens are harvested, sold for more ([^\s]+) which is deposited back into the strategy\./gi,
    'Поставляет $1 в [Compound Finance]($2) в качестве залога для займа $3 с повторным размещением для заработка COMP. Заработанные токены собираются, обмениваются на $4 и реинвестируются обратно в стратегию.',
  ],
  // Supplies <TOKEN> to [Moonwell](...)
  [
    /Supplies ([^\s]+) to \[Moonwell\]\(([^)]+)\) to use as collateral to borrow another asset which is deposited into a vault yielding more than the borrow rate\.\s*The strategy earns the supply rate of ([^\s]+) and the spread between the borrow and deposit APY of its borrow token\./gi,
    'Поставляет $1 в [Moonwell]($2) в качестве залога для займа другого актива, который размещается в хранилище с доходностью выше ставки заимствования. Стратегия зарабатывает процент на депозит $3 и разницу (спред) между ставками депозита и займа.',
  ],
  // Supplies <TOKEN> to [Spark Finance](...)
  [
    /Supplies ([^\s]+) to \[Spark Finance\]\(([^)]+)\) to generate interest\./gi,
    'Поставляет $1 в протокол [Spark Finance]($2) для получения процентного дохода.',
  ],
  // Supplies <TOKEN> to multiple [Ajna](...)
  [
    /Supplies ([^\s]+) to multiple \[Ajna\]\(([^)]+)\) isolated lending pools to generate interest\.\s*<br\/><br\/>DISCLAIMER: This Vault deposits into Ajna, a new protocol\.\s*The strategies are not 100% liquid\.\s*There may be times when you cannot withdraw all of your funds\.\s*Proceed with caution\.\s*<br\/><br\/>ALPHA: This vault may also be Juiced with extra rewards\.\s*Visit \[([^\]]+)\]\(([^)]+)\) to learn more\./gi,
    'Поставляет $1 в несколько изолированных кредитных пулов [Ajna]($2) для получения процентов. <br/><br/>ВНИМАНИЕ: Это хранилище размещает средства в протоколе Ajna. Стратегии не обладают 100% мгновенной ликвидностью — возможны периоды, когда вывести все средства сразу нельзя. Будьте осторожны. <br/><br/>ALPHA: Хранилище также может получать дополнительные награды Juiced. Подробнее на [$3]($4).',
  ],
  // Supplies <TOKEN> to the corresponding [Stargate](...)
  [
    /Supplies ([^\s]+) to the corresponding \[Stargate\]\(([^)]+)\) pool and stakes the LP token to earn STG\.\s*Earned tokens are harvested, sold for more ([^\s]+) which is deposited back into the strategy\./gi,
    'Поставляет $1 в соответствующий пул [Stargate]($2) и размещает LP-токен в стейкинге для заработка STG. Заработанные токены собираются, обмениваются на $3 и реинвестируются обратно в стратегию.',
  ],
  // Supplies <TOKEN> to the corresponding [Sturdy](...)
  [
    /Supplies ([^\s]+) to the corresponding \[Sturdy\]\(([^)]+)\) aggregator earning the underlying yield and compounding the rewards\.?/gi,
    'Поставляет $1 в соответствующий агрегатор [Sturdy]($2), получая базовую доходность и автоматически реинвестируя награды.',
  ],
  // This vault uses <COLLATERAL> as collateral on Morpho markets to borrow <BORROW>. It then deposits that <ASSET> into Yearn's <VAULT> vault to earn yield there.
  [
    /This vault uses ([^\s]+) as collateral on Morpho markets to borrow ([^\s.]+)\.\s*It then deposits that ([^\s]+) into Yearn's ([^\s]+) vault to earn yield there\.?/gi,
    'Это хранилище использует $1 в качестве залога на рынках Morpho для заимствования $2, после чего размещает $3 в хранилище $4 от Yearn для получения дохода.',
  ],
  // Curve Llama Lend deposit LP
  [
    /This token represents a Curve Llama Lend deposit LP\.\s*Holders earn interest from users borrowing their supplied crvUSD against the specified collateral, and can also deposit the LP to Curve's gauges to earn CRV emissions\.\s*This Llama Lend market accepts (.+?) as collateral\./gi,
    (_m, collateral: string) => {
      const colRu = collateral
        .replace(/\[Ethena's\]\(([^)]+)\)\s*staked USDe \(sUSDe\)/i, 'стейкинговый USDe (sUSDe) от [Ethena]($1)')
        .replace(/\[Ethena's\]\(([^)]+)\)\s*USDe/i, 'USDe от [Ethena]($1)')
        .replace(/\[Threshold Network's\]\(([^)]+)\)\s*tBTC/i, 'tBTC от [Threshold Network]($1)');
      return `Этот токен представляет собой LP-позицию депозита на рынке Curve Llama Lend. Держатели получают проценты от заёмщиков crvUSD под указанный залог, а также могут размещать LP-токены в пулах (gauges) Curve для получения эмиссии CRV. В качестве залога на этом рынке Llama Lend принимается ${colRu}.`;
    },
  ],
  // Curve liquidity pool
  [
    /This token represents a Curve liquidity pool\.\s*Holders earn fees from users trading in the pool, and can also deposit the LP to Curve's gauges to earn CRV emissions\.\s*This pool contains (.+)/gi,
    (_m, tail: string) => {
      let tailRu = tail
        .replace(/For more details about yCRV, check out Yearn's \[docs\]\(([^)]+)\)\./gi, 'Подробнее об yCRV — в [документации Yearn]($1).')
        .replace(/For more details about yYB, check out Yearn's docs\./gi, 'Подробнее об yYB — в документации Yearn.')
        .replace(/For more details, check out Resupply's \[website\]\(([^)]+)\)\./gi, 'Подробнее — на [сайте Resupply]($1).')
        .replace(/For more details, check out YieldNest's \[website\]\(([^)]+)\)\./gi, 'Подробнее — на [сайте YieldNest]($1).')
        .replace(/For more details, check out Reserve's \[website\]\(([^)]+)\)\./gi, 'Подробнее — на [сайте Reserve]($1).')
        .replace(
          /two different Reserve RTokens, dgnETH and ETH\+\.\s*These RTokens are 100% backed by a diversified set of underlying collateral tokens, all pegged to ETH\./gi,
          'два RToken от Reserve: dgnETH и ETH+. Эти RToken на 100% обеспечены диверсифицированной корзиной залоговых токенов, привязанных к ETH.'
        )
        .replace(/ and /g, ' и ');
      return `Этот токен представляет собой пул ликвидности Curve. Держатели получают торговые комиссии пула, а также могут размещать LP-токены в пулах (gauges) Curve для получения эмиссии CRV. В состав пула входят: ${tailRu}`;
    },
  ],
  // Gamma LP tokens
  [
    /\[Click here\]\(([^)]+)\) to get your ([^\s]+) Gamma LP tokens\.\s*<br\/><br\/>Stakes ([^\s]+) on \[Gamma\.xyz\]\(([^)]+)\)\.\s*Earned reward tokens are harvested, sold for more ([^\s]+) which is deposited back into the strategy\./gi,
    '[Нажмите здесь]($1), чтобы получить LP-токены Gamma $2. <br/><br/>Размещает $3 в стейкинге на [Gamma.xyz]($4). Заработанные токены наград собираются, обмениваются на $5 и реинвестируются обратно в стратегию.',
  ],
  // Pendle LP tokens on Penpie
  [
    /\[Click here\]\(([^)]+)\) to get your Pendle LP tokens\.\s*<br\/><br\/>Stakes your Pendle LP tokens on \[Penpie\]\(([^)]+)\)\.\s*Earned reward tokens are harvested, sold for more LP tokens and deposited back into the strategy\./gi,
    '[Нажмите здесь]($1), чтобы получить LP-токены Pendle. <br/><br/>Размещает ваши LP-токены Pendle в стейкинге на [Penpie]($2). Заработанные токены наград собираются, обмениваются на дополнительные LP-токены и реинвестируются обратно в стратегию.',
  ],
];
