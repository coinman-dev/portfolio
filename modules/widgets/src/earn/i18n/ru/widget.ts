export const RU_WIDGET: Record<string, string> = {
  // Amount input & info popover
  Amount: 'Сумма',
  Max: 'Макс.',
  'Amount in {symbol}': 'Сумма в {symbol}',
  Close: 'Закрыть',
  'Got it': 'Понятно',

  // Recent transactions & My Info wallet
  Wallet: 'Кошелёк',
  'Wallet section': 'Раздел кошелька',
  Balances: 'Балансы',
  Transactions: 'Транзакции',
  'Connect a wallet to view balances and transactions.':
    'Подключите кошелёк для просмотра балансов и транзакций.',
  'Connect Wallet': 'Подключить кошелёк',
  'Your Vault balances': 'Баланс в хранилище',
  'Deposited value': 'Внесённая сумма',
  'Deposited shares': 'Внесённые доли',
  'Wallet balances': 'Баланс кошелька',
  'Available {symbol}': 'Доступно {symbol}',
  'Recent transactions': 'Недавние транзакции',
  'All activity': 'Вся активность',
  'Loading transactions...': 'Загрузка транзакций...',
  'No recent transactions.': 'Недавних транзакций нет.',
  Success: 'Успешно',

  // Variants & modes
  'Vault share variant': 'Вариант долей хранилища',
  Staked: 'В стейкинге',
  Unstaked: 'Без стейкинга',
  'Deposit token': 'Токен для депозита',
  'Withdrawal token': 'Токен для вывода',
  Receive: 'Получить',
  'Balance: {amount} {symbol}': 'Баланс: {amount} {symbol}',

  // Summary & popovers
  'You Will Deposit': 'Вы вносите',
  'You Will Receive': 'Вы получите',
  'Vault Shares': 'Доли хранилища',
  "What you'll receive": 'Что вы получите',
  "You're depositing {symbol} into the vault. You'll receive {vault} shares.":
    'Вы вносите {symbol} в хранилище и получите доли {vault}.',
  'How vault shares work': 'Как работают доли хранилища',
  "Vault shares represent your deposit. Their value grows automatically as the vault earns yield - you don't need to do anything. When you withdraw, your shares are exchanged back for the underlying asset plus any earnings.":
    'Доли хранилища отражают ваш депозит. Их стоимость автоматически растёт по мере накопления дохода хранилищем — вам ничего не нужно делать. При выводе средств доли обмениваются обратно на базовый актив вместе с накопленной прибылью.',
  'Vault share value': 'Стоимость долей хранилища',
  'Vault Share Value': 'Стоимость долей хранилища',
  'What this value means': 'Что означает это значение',
  'This is the amount of {vault} you could redeem immediately after depositing. It represents the value of the shares you will receive converted to the underlying asset.':
    'Это количество {vault}, которое можно сразу получить обратно после депозита. Отражает стоимость получаемых долей в пересчёте на базовый актив.',
  'Estimated Annual Return': 'Ожидаемый годовой доход',
  "The estimated annual return is calculated based on the vault's historical performance and current market conditions.":
    'Ожидаемый годовой доход рассчитывается на основе исторической доходности хранилища и текущих рыночных условий.',
  'Calculation factors:': 'Параметры расчёта:',
  'Current APR: {apr}': 'Текущий APR: {apr}',
  'Your deposit: {amount} {symbol}': 'Ваш депозит: {amount} {symbol}',
  'Expected annual yield: {amount} {symbol}': 'Ожидаемый годовой доход: {amount} {symbol}',
  'Please note that past performance does not guarantee future results. Actual returns may vary based on market volatility and vault strategy adjustments.':
    'Обратите внимание: доходность в прошлом не гарантирует доходности в будущем. Фактический доход может меняться в зависимости от волатильности рынка и работы стратегий.',
  'Existing Approval ({spender})': 'Действующее разрешение ({spender})',
  'Manage approval': 'Управление разрешением',
  'What is this?': 'Что это такое?',
  'Token approval allows a smart contract to transfer your {symbol} up to a set limit. Deposits approve exactly the amount being deposited.':
    'Разрешение (Approve) позволяет смарт-контракту списывать ваш токен {symbol} в пределах заданного лимита. При депозите запрашивается разрешение ровно на вносимую сумму.',
  'This withdrawal routes through the {spender} contract, which needs approval to spend your {symbol}.':
    'Этот вывод проходит через контракт {spender}, которому требуется разрешение на использование ваших токенов {symbol}.',
  'You will redeem': 'Вы погасите',
  'Vault shares represent your deposit. Redeeming exchanges them back for the underlying asset plus any earnings.':
    'Доли хранилища отражают ваш депозит. При погашении они обмениваются обратно на базовый актив вместе с накопленным доходом.',
  'You will receive': 'Вы получите',

  // Zap
  'Price impact': 'Влияние на цену',
  'The zap swaps through Enso. Estimated impact is what the route is expected to cost; worst case is what it may cost at the minimum it guarantees.':
    'Обмен через Zap выполняется маршрутизатором Enso. Ожидаемое влияние — расчётная стоимость маршрута; худший случай — стоимость при минимально гарантированном выходе.',
  '{est}% (worst {worst}%)': '{est}% (макс. {worst}%)',
  'Slippage tolerance': 'Допустимое проскальзывание',
  'at least {amount} {symbol}': 'не менее {amount} {symbol}',
  'Fetching route...': 'Поиск маршрута...',
  'Unable to estimate zap price impact.': 'Не удалось оценить влияние Zap на цену.',
  'No protected slippage remains after the estimated {est}% price impact.':
    'После ожидаемого влияния на цену ({est}%) не остаётся запаса проскальзывания.',
  'Price impact is too high ({worst}%).': 'Слишком высокое влияние на цену ({worst}%).',
  'Worst-case route impact is {worst}%, above your {tol}% slippage.':
    'Максимальное влияние маршрута ({worst}%) превышает выбранное проскальзывание ({tol}%).',
  'Could not reach the zap service: {error}': 'Не удалось связаться с сервисом Zap: {error}',
  'No route available ({status}).': 'Маршрут недоступен ({status}).',
  'This approval address is not a known Enso router address.':
    'Адрес разрешения не является известным роутером Enso.',
  'The route runs on another chain.': 'Маршрут выполняется в другой сети.',
  'Unsupported route type.': 'Неподдерживаемый тип маршрута.',
  'Cross-chain routes are not supported.': 'Межсетевые маршруты не поддерживаются.',

  // Warnings, staking, cooldown
  'This vault is retired.': 'Это хранилище закрыто для новых депозитов.',
  'You have unstaked yBOLD.': 'У вас есть yBOLD вне стейкинга.',
  'In order to earn yield, BOLD needs to be deposited and staked into ysyBOLD. It always makes sense to stake yBOLD and there is no lockup or fee.':
    'Чтобы получать доход, BOLD нужно внести и отправить в стейкинг ysyBOLD. Стейкинг yBOLD не имеет блокировки или комиссий.',
  'Click the button to the right to stake your yBOLD to earn yield.':
    'Нажмите кнопку справа, чтобы отправить yBOLD в стейкинг и получать доход.',
  'Automatic staking is off. Unstaked yBOLD does not earn yield - its yield accrues to staked yBOLD.':
    'Автоматический стейкинг выключен. yBOLD без стейкинга не приносит доход — весь доход начисляется на yBOLD в стейкинге.',
  '{days} day cooldown': 'Ожидание вывода: {days} дн.',
  '{days} day withdrawal window': 'Окно для вывода: {days} дн.',
  'Higher yield': 'Повышенная доходность',
  'Locked shares need a {days} day cooldown before they can be withdrawn.':
    'Для вывода заблокированных долей необходимо запустить ожидание на {days} дн.',
  'Cooldown ends in {time}, then you have {days} days to withdraw.':
    'Ожидание завершится через {time}, после чего у вас будет {days} дн. на вывод.',
  'Ready to withdraw - {time} left in the window.':
    'Готово к выводу — до конца окна осталось {time}.',
  'The withdrawal window closed. Start a new cooldown to withdraw.':
    'Окно вывода закрылось. Запустите новое ожидание для вывода средств.',
  'Cancel cooldown': 'Отменить ожидание',
  'Start Cooldown': 'Начать ожидание',
  'Restart Cooldown': 'Перезапустить ожидание',
  'Cooldown {time}': 'Ожидание {time}',
  'Starting cooldown...': 'Запуск ожидания...',

  // Actions & steps
  'Reconnect wallet to sign': 'Переподключите кошелёк для подписи',
  'Switch to {chain}': 'Переключить сеть на {chain}',
  'Depositing...': 'Внесение депозита...',
  'Withdrawing...': 'Вывод средств...',
  'Reset {symbol} approval': 'Сброс разрешения {symbol}',
  'Approve {symbol}': 'Разрешить {symbol}',
  'Deposit and stake': 'Депозит и стейкинг',
  'Transaction confirmed': 'Транзакция подтверждена',
  'Deposits are disabled for this vault.': 'Депозиты для этого хранилища отключены.',
  'Insufficient balance': 'Недостаточный баланс',
  'This vault is not accepting deposits right now.':
    'Сейчас это хранилище не принимает депозиты.',
  'Amount exceeds the vault deposit limit.': 'Сумма превышает лимит депозитов хранилища.',
  'This vault has no staking contract.': 'У этого хранилища нет контракта стейкинга.',
  'Could not stake the vault shares.': 'Не удалось отправить доли хранилища в стейкинг.',
  'Could not start the cooldown.': 'Не удалось запустить период ожидания.',
  'Could not cancel the cooldown.': 'Не удалось отменить период ожидания.',
  'Transaction was rejected or failed.': 'Транзакция отклонена или завершилась ошибкой.',

  // Migrate panel
  'This vault is retired. Please withdraw or migrate your funds.':
    'Это хранилище устарело. Пожалуйста, выведите или мигрируйте свои средства.',
  'Your Balance': 'Ваш баланс',
  Destination: 'Новое хранилище',
  'Loading...': 'Загрузка...',
  'Approve & Migrate': 'Разрешить и мигрировать',
  'Migrate All': 'Мигрировать всё',
  'Migration not available': 'Миграция недоступна',
  'Nothing to migrate': 'Нет средств для миграции',
  'Migration failed.': 'Ошибка миграции.',
  'Migration successful! Your funds have been migrated to the new vault.':
    'Миграция выполнена! Ваши средства переведены в новое хранилище.',
};
