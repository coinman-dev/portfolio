export const RU_DETAIL: Record<string, string> = {
  // Sections & tabs
  Performance: 'Доходность',
  'Vault Info': 'О хранилище',
  Strategies: 'Стратегии',
  Risk: 'Риск',
  'More Info': 'Подробнее',
  'Vault sections': 'Разделы хранилища',
  'Vault actions': 'Действия с хранилищем',
  Deposit: 'Депозит',
  Withdraw: 'Вывод',
  'My Info': 'Моя позиция',
  Migrate: 'Миграция',
  'Your Deposits': 'Ваши депозиты',
  'Scroll to top': 'Наверх',

  // KPI header
  'Est. APY': 'Ожид. APY',
  '30 Day APY': 'APY за 30 дн.',
  '30-Day APY': 'APY за 30 дн.',
  TVL: 'TVL',
  'Forward-looking net APY after fees, based on the current strategy allocation.':
    'Прогнозируемый чистый APY после комиссий на основе текущего распределения стратегий.',
  'Realised net APY over the last 30 days.': 'Фактический чистый APY за последние 30 дней.',
  'Total value locked in this vault, in USD.':
    'Общая заблокированная стоимость в этом хранилище в USD.',
  'View {name} on the block explorer': 'Открыть {name} в обозревателе блоков',

  // Charts
  'Historical APY': 'Исторический APY',
  'Performance ($1)': 'Доходность ($1)',
  'Chart metric': 'Метрика графика',
  'Chart timeframe': 'Период графика',
  '30D': '30Д',
  '90D': '90Д',
  '1Y': '1Г',
  ALL: 'ВСЕ',
  'Chart unavailable': 'График недоступен',
  'Unable to render chart data right now.': 'Сейчас не удалось отобразить данные графика.',
  Unlocked: 'Разблокировано',
  Locked: 'Заблокировано',
  'allocation %': 'доля %',

  // Strategies
  Strategy: 'Стратегия',
  'Allocation %': 'Доля %',
  Amount: 'Сумма',
  APY: 'APY',
  'Sort by {label}': 'Сортировать по: {label}',
  Unallocated: 'Не распределено',
  'Show Unallocated Strategies': 'Показать неактивные стратегии',
  'Hide Unallocated Strategies': 'Скрыть неактивные стратегии',
  Address: 'Адрес',
  'Last report': 'Последний отчёт',
  'Performance fee': 'Комиссия за результат',

  // Risk
  'Overall Risk Score': 'Общая оценка риска',
  "This reflects the vault's security, with 1 being most secure and 5 least secure, based on strategy complexity, loss exposure, and external dependencies.":
    'Отражает уровень безопасности хранилища (1 — наиболее безопасно, 5 — наименее безопасно) с учётом сложности стратегий, риска потерь и внешних зависимостей.',
  "This risk score determines what strategies can be added to this vault. Only strategies with overall risk score values equal or lower to the vault risk score are allowed. The strategy risk scores are calculated based on multiple factors including the strategy's complexity, exposure to potential losses, and reliance on external protocols. A score of 1 represents the highest security, while 5 indicates the lowest.":
    'Эта оценка риска определяет, какие стратегии могут быть добавлены в хранилище. Допускаются только стратегии с общей оценкой риска не выше оценки хранилища. Оценка рассчитывается на основе сложности стратегии, подверженности возможным потерям и зависимости от внешних протоколов. Оценка 1 означает наивысшую безопасность, а 5 — наименьшую.',

  // More Info & About
  'Vault Contract Address': 'Адрес контракта хранилища',
  'Unlocked Vault Contract Address': 'Адрес контракта разблокированного хранилища',
  'Locked Vault Contract Address': 'Адрес контракта заблокированного хранилища',
  'Token Contract Address': 'Адрес контракта токена',
  'Staking Contract Address': 'Адрес контракта стейкинга',
  'Price Per Share': 'Цена доли (PPS)',
  'Unlocked Price Per Share': 'Цена разблокированной доли',
  'Locked Price Per Share': 'Цена заблокированной доли',
  'Deployed on': 'Развёрнуто',
  'User Documentation': 'Документация пользователя',
  'Developer Documentation': 'Документация разработчика',
  'View Documentation': 'Открыть документацию',
  'Powerglove Analytics Page': 'Аналитика Powerglove',
  'View Page': 'Открыть страницу',
  '{symbol} API': 'API {symbol}',
  'Vault Snapshot Data': 'Снимок данных хранилища',
  'View API Data': 'Открыть данные API',
  'View {label} on the block explorer': 'Открыть {label} в обозревателе блоков',
  'View on block explorer': 'Открыть в обозревателе блоков',
  'Copy {label}': 'Скопировать {label}',

  // VaultAboutSection
  'Additional Features': 'Дополнительные функции',
  'Locked APY': 'Заблокированный APY',
  'Unlocked APY': 'Разблокированный APY',
  'Locked:': 'Заблокировано:',
  'Unlocked:': 'Разблокировано:',
  'Shares require a {days}-day cooldown before withdrawal.':
    'Перед выводом долей требуется период ожидания {days} дн.',
  'Shares can be withdrawn without a cooldown.': 'Доли можно вывести без периода ожидания.',
  Addresses: 'Адреса',
  Chain: 'Сеть',
  'Learn more about {chain} at': 'Подробнее о сети {chain}:',
  'Asset Type': 'Тип актива',
  'Not specified': 'Не указан',
  'No asset category provided.': 'Категория актива не указана.',
  'Vault Type': 'Тип хранилища',
  Fees: 'Комиссии',
  'Management Fee': 'Комиссия за управление',
  'Performance Fee': 'Комиссия за результат',
  'Management fees': 'Комиссия за управление',
  'are claimed from earned yield, pro-rated and up to the stated percentage of principal.':
    'удерживается из заработанного дохода пропорционально времени и не превышает указанного процента от основного капитала.',
  'Performance fees': 'Комиссия за результат',
  'are claimed from earned yield, up to the stated percentage of yield earned.':
    'удерживается из заработанного дохода в пределах указанного процента от полученной прибыли.',
  "Sorry, we don't have a description for this vault right now. To learn more about how Yearn Vaults work, check out our docs, or if you want to learn more about this vault, head to our discord or telegram and ask.":
    'Описание для этого хранилища пока отсутствует. Чтобы узнать больше о работе хранилищ Yearn, загляните в документацию или задайте вопрос в нашем Discord или Telegram.',

  // Vault meta / chips / descriptions
  General: 'Общее',
  Stablecoin: 'Стейблкоин',
  Volatile: 'Волатильный',
  Conservative: 'Консервативный',
  Moderate: 'Умеренный',
  Aggressive: 'Агрессивный',
  'Single Asset': 'Один актив',
  'LP Token': 'LP-токен',
  Legacy: 'Legacy',
  Allocator: 'Аллокатор',
  Factory: 'Фабрика',
  'Single Asset | Allocator': 'Один актив | Аллокатор',
  'Single Asset | Strategy': 'Один актив | Стратегия',
  'LP Token | Factory': 'LP-токен | Фабрика',
  'LP Token | Legacy': 'LP-токен | Legacy',
  'Legacy | Legacy': 'Legacy | Legacy',
  'Show single asset vaults': 'Показать хранилища одного актива',
  'Legacy vault': 'Устаревшее хранилище (Legacy)',
  'Show LP token vaults': 'Показать хранилища LP-токенов',
  'Ethereum mainnet is the heart of the Ethereum ecosystem. Good liquidity and security, but transaction fees can be higher.':
    'Основная сеть Ethereum — центр экосистемы Ethereum. Высокая ликвидность и безопасность, но комиссии за транзакции могут быть выше.',
  'Optimism is the coordination layer of the "SuperChain". It is an optimistic rollup on Ethereum with lower fees and fast confirmations.':
    'Optimism — координационный уровень «SuperChain». Оптимистичный роллап на Ethereum с низкими комиссиями и быстрыми подтверждениями.',
  'Polygon is a PoS sidechain to Ethereum with low fees and fast blocks.':
    'Polygon — PoS-сайдчейн к Ethereum с низкими комиссиями и быстрыми блоками.',
  'Arbitrum is an optimistic rollup on Ethereum with low fees and high throughput.':
    'Arbitrum — оптимистичный роллап на Ethereum с низкими комиссиями и высокой пропускной способностью.',
  "Base is an Coinbase's Ethereum L2 built on the OP Stack with low fees and fast confirmations.":
    'Base — сеть второго уровня Ethereum от Coinbase на базе OP Stack с низкими комиссиями и быстрыми подтверждениями.',
  'Katana is a DeFi focused zk-rollup chain with an innovative liquidity flywheel, low fees, and fast confirmations.':
    'Katana — zk-роллап для DeFi с инновационным механизмом ликвидности, низкими комиссиями и быстрыми подтверждениями.',
  'This vault holds a USD-pegged or USD-targeted asset designed to maintain its price.':
    'Хранилище содержит актив, привязанный к USD и предназначенный для сохранения стабильной цены.',
  'This vault holds an asset whose price fluctuates due to market-driven events.':
    'Хранилище содержит актив, цена которого изменяется под влиянием рынка.',
  'These vaults use a Legacy Yearn vault architecture. They were previously called "v2 Vaults").':
    'Эти хранилища используют архитектуру Yearn прошлых версий (ранее назывались «хранилища v2»).',
  'LP token vaults auto-compound fees and incentives from liquidity positions. They were previously called "v2 Factory Vaults".':
    'Хранилища LP-токенов автоматически реинвестируют комиссии и вознаграждения позиций ликвидности (ранее назывались «фабричные хранилища v2»).',
  'Single-asset vaults accept one token and allocate it across strategies. They were previously called "v3 Vaults".':
    'Хранилища одного актива принимают один токен и распределяют его между стратегиями (ранее назывались «хранилища v3»).',
  'Allocator vaults route deposits across multiple strategies.':
    'Хранилища-аллокаторы распределяют депозиты между несколькими стратегиями.',
  'Strategy vaults contain a single active strategy and are allocated to by Allocator vaults.':
    'Стратегические хранилища содержат одну активную стратегию и получают ликвидность от хранилищ-аллокаторов.',
  'Vault strategy classification from Yearn.': 'Классификация стратегии хранилища от Yearn.',
  'Deposits are disabled; withdrawals remain available.':
    'Депозиты отключены; вывод средств по-прежнему доступен.',
  'A retired vault with a migration path available to a newer vault.':
    'Устаревшее хранилище с возможностью миграции в более новое хранилище.',
  'Hidden from the default list. Enable hidden vaults to view.':
    'Скрыто из основного списка. Включите показ скрытых хранилищ для просмотра.',
  'This vault is not managed by Yearn. Review the issuer and risks carefully.':
    'Это хранилище не управляется Yearn. Внимательно изучите эмитента и риски.',
  'Filter vaults with this same management and performance fee structure.':
    'Отфильтровать хранилища с такой же структурой комиссий за управление и результат.',
};
