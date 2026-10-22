export const RU_LIST: Record<string, string> = {
  // Filters bar
  'Vault type': 'Тип хранилища',
  'All Vaults': 'Все хранилища',
  'Single Asset': 'Один актив',
  'LP Token': 'LP-токен',
  Chains: 'Сети',
  'All Chains': 'Все сети',
  'Open filters': 'Открыть фильтры',
  Filters: 'Фильтры',
  'Filter Vaults': 'Фильтры',
  'Compare vaults': 'Сравнить хранилища',
  Compare: 'Сравнить',
  'Search vaults': 'Поиск хранилищ',
  'Find a Vault': 'Найти хранилище',
  'Clear search': 'Очистить поиск',

  // Filters modal
  'Close filters': 'Закрыть фильтры',
  'Underlying Asset': 'Базовый актив',
  'Filter by assets': 'Фильтр по активам',
  'Filter by assets ({count})': 'Фильтр по активам ({count})',
  'Search assets': 'Поиск активов',
  'Minimum TVL': 'Минимальный TVL',
  'Asset Category': 'Категория актива',
  'Vault Aggressiveness': 'Профиль риска хранилища',
  Advanced: 'Расширенные',
  'It is not recommended to deposit to strategies or legacy vaults.':
    'Не рекомендуется вносить средства напрямую в стратегии или устаревшие (Legacy) хранилища.',
  'Show single asset strategies': 'Показать стратегии одного актива',
  'Checking this will show the underlying strategies used in Single Asset Vaults in the list.':
    'Показывает в списке отдельные базовые стратегии, используемые в хранилищах одного актива.',
  'Show legacy vaults': 'Показать устаревшие хранилища (Legacy)',
  'Includes legacy vaults in the list.': 'Включает в список устаревшие хранилища прошлых версий.',
  Clear: 'Сбросить',
  Save: 'Сохранить',

  // Table head & rows
  Vault: 'Хранилище',
  'Est. APY': 'Ожид. APY',
  'Est. APY:': 'Ожид. APY:',
  TVL: 'TVL',
  'TVL:': 'TVL:',
  Holdings: 'Депозит',
  'Holdings:': 'Депозит:',
  'Collapse row': 'Свернуть строку',
  'Expand row': 'Развернуть строку',
  'Add {name} to comparison': 'Добавить {name} к сравнению',
  'Remove {name} from comparison': 'Убрать {name} из сравнения',
  'Filter by {item}': 'Фильтр: {item}',
  'Fees: {mgmt} | {perf}': 'Комиссии: {mgmt} | {perf}',
  'Filter by {mgmt} management fee and {perf} performance fee':
    'Фильтр по комиссии за управление {mgmt} и комиссии за результат {perf}',
  Retired: 'Закрыто',

  // APY breakdown
  NEW: 'НОВОЕ',
  'Show yvUSD APY breakdown': 'Показать разбивку APY yvUSD',
  'Show {name} APY breakdown': 'Показать разбивку APY {name}',
  'Est. Native APY': 'Ожид. базовый APY',
  'App Rewards APR': 'APR наград приложения',
  'Total APY': 'Итоговый APY',
  'This Vault is receiving KAT incentives.': 'Это хранилище получает вознаграждения в KAT.',
  Boost: 'Буст',

  // Expanded row
  'Go to Vault': 'Перейти к хранилищу',
  'No active strategies.': 'Нет активных стратегий.',

  // Empty & error states & search suggestions
  'Fetching Vaults:': 'Загрузка хранилищ:',
  'No vaults found': 'Хранилища не найдены',
  'The vault "{query}" does not exist': 'Хранилище «{query}» не найдено',
  'No vaults found that match your filters.': 'Нет хранилищ, соответствующих выбранным фильтрам.',
  'Search all vaults': 'Показать все хранилища',
  'Something went wrong': 'Что-то пошло не так',
  'Still looking for "{query}"?': 'Ищете «{query}»?',
  'Show additional matching vaults hidden by filters.':
    'Показать дополнительные подходящие хранилища, скрытые фильтрами.',
  'Show low-tvl vaults (+{delta})': 'Показать хранилища с низким TVL (+{delta})',
  'Show single asset strategies (+{delta})': 'Показать стратегии одного актива (+{delta})',
  'Show low-tvl vaults and show single asset strategies (+{delta})':
    'Показать хранилища с низким TVL и стратегии одного актива (+{delta})',

  // Compare bar & modal
  'Selected 1 vault. Select one more to compare':
    'Выбрано 1 хранилище. Выберите ещё одно для сравнения',
  'Selected {count} vault_one': 'Выбрано {count} хранилище',
  'Selected {count} vaults_few': 'Выбрано {count} хранилища',
  'Selected {count} vaults_many': 'Выбрано {count} хранилищ',
  'Compare ({count})': 'Сравнить ({count})',
  'Review key metrics side-by-side.': 'Сравните ключевые показатели хранилищ рядом.',
  'Close comparison': 'Закрыть сравнение',
  'Select at least two vaults to compare.': 'Выберите минимум два хранилища для сравнения.',
  'Open {name} vault in a new tab': 'Открыть хранилище {name} в новой вкладке',
  'Forward net APR': 'Прогнозируемый чистый APR',
  'Average realized': 'Средний фактический',
  'Total value locked': 'Общая заблокированная стоимость',
  'Mgmt / Perf': 'Упр. / Рез.',
  'Management:': 'Управление:',
  'Performance:': 'Результат:',
  'Security score': 'Оценка безопасности',
  'Level {level} / 5': 'Уровень {level} / 5',
  Type: 'Тип',
  'Vault structure': 'Структура хранилища',
  'Multi Strategy': 'Мультистратегия',
  'Single Strategy': 'Одна стратегия',
  'Underlying positions': 'Базовые позиции',

  // Pagination
  'Vault list pages': 'Страницы списка хранилищ',
  'Showing {first}-{last} of {total} vault_one':
    'Показаны {first}–{last} из {total} хранилища',
  'Showing {first}-{last} of {total} vaults_few':
    'Показаны {first}–{last} из {total} хранилищ',
  'Showing {first}-{last} of {total} vaults_many':
    'Показаны {first}–{last} из {total} хранилищ',
  'Previous page': 'Предыдущая страница',
  'Next page': 'Следующая страница',
  'Page {page}': 'Страница {page}',
};
