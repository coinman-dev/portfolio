import React, { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { YearnVault } from '../../types';
import { PortfolioPosition } from '../../hooks/usePortfolioHoldings';
import { getChain } from '../../yearnApi';
import { formatAmount, formatAPY, formatDuration, formatUSD, formatUSDFull } from '../../format';
import { openExternal } from '../../openExternal';
import { Lock, Unlock, Wallet } from '../ui/icons';
import { useVaultActions, VaultVariant, WidgetMode } from '../../hooks/useVaultActions';
import { canStakeOnDeposit, isRetiredVault } from '../../vaultTx';
import { ZAP_SLIPPAGE_DEFAULT, ZAP_SLIPPAGE_PRESETS } from '../../constants';
import { ZapToken, useZapTokens } from '../../hooks/useZap';
import { TokenPicker } from './TokenPicker';
import { MigratePanel } from './MigratePanel';
import { getHeadlineAPY, RETIRED_TAG_DESCRIPTION } from '../../vaultMeta';
import { AmountInput } from './AmountInput';
import { InfoPopover } from './InfoPopover';
import { RecentTransactions } from './RecentTransactions';

type WalletTabId = 'balances' | 'transactions';

const WALLET_TABS: { id: WalletTabId; label: string }[] = [
  { id: 'balances', label: 'Balances' },
  { id: 'transactions', label: 'Transactions' },
];

export type WidgetTab = 'deposit' | 'withdraw' | 'info' | 'migrate';

interface SummaryRowProps {
  label: React.ReactNode;
  value: React.ReactNode;
}

const SummaryRow: React.FC<SummaryRowProps> = ({ label, value }) => (
  <div className="y-summary__row">
    <span className="y-summary__label">{label}</span>
    <span className="y-summary__value">{value}</span>
  </div>
);

interface VaultWidgetProps {
  vault: YearnVault;
  tab: WidgetTab;
  walletAddress?: string;
  walletChainId?: number;
  /** Portfolio-scan position; My Info shows it so merged contracts count. */
  position?: PortfolioPosition;
  onConnectWallet: () => void;
  /** "All activity": Portfolio → Activity. */
  onOpenActivity?: () => void;
  onBalancesChanged?: () => void;
  /** For the Migrate tab's destination link. */
  vaults?: YearnVault[];
  onSelectVault?: (vault: YearnVault) => void;
}

export const VaultWidget: React.FC<VaultWidgetProps> = ({
  vault,
  tab,
  walletAddress,
  walletChainId,
  position,
  onConnectWallet,
  onOpenActivity,
  onBalancesChanged,
  vaults = [],
  onSelectVault,
}) => {
  const [infoTab, setInfoTab] = useState<WalletTabId>('balances');
  const mode: WidgetMode = tab === 'withdraw' ? 'withdraw' : 'deposit';
  const hasLockedVariant = Boolean(vault.lockedTwin);
  const stakesOnDeposit = canStakeOnDeposit(vault);

  // yvUSD: deposits default to Locked, withdrawals to Unlocked, as on yearn.fi.
  // Yearn BOLD: deposits default to Staked ("Stake automatically" is on there).
  // Withdrawals follow whichever source holds shares until the user picks one.
  const [depositVariant, setDepositVariant] = useState<VaultVariant>(
    hasLockedVariant ? 'locked' : stakesOnDeposit ? 'staked' : 'unlocked'
  );
  const [withdrawVariant, setWithdrawVariant] = useState<VaultVariant>('unlocked');
  const [withdrawPicked, setWithdrawPicked] = useState(false);
  const variant = mode === 'withdraw' ? withdrawVariant : depositVariant;
  const setVariant = (next: VaultVariant) => {
    if (mode === 'withdraw') {
      setWithdrawVariant(next);
      setWithdrawPicked(true);
    } else {
      setDepositVariant(next);
    }
  };

  // Any-token deposits and withdrawals (Enso). The asset itself is null here:
  // it takes the direct routes.
  const { tokens: zapTokens } = useZapTokens(vault, mode, walletAddress);
  const [depositToken, setDepositToken] = useState<ZapToken | null>(null);
  const [withdrawToken, setWithdrawToken] = useState<ZapToken | null>(null);
  const [slippage, setSlippage] = useState(ZAP_SLIPPAGE_DEFAULT);
  useEffect(() => {
    setDepositToken(null);
    setWithdrawToken(null);
  }, [vault.chainID, vault.address]);
  // yvUSD's locked side and staked withdrawals have their own contracts.
  const canZap = variant !== 'locked' && !(mode === 'withdraw' && variant === 'staked');
  const selectedToken = mode === 'deposit' ? depositToken : withdrawToken;
  const zapToken = canZap && selectedToken && !selectedToken.isAsset ? selectedToken : null;
  const selectToken = (token: ZapToken) => {
    const next = token.isAsset ? null : token;
    if (mode === 'deposit') setDepositToken(next);
    else setWithdrawToken(next);
  };

  const actions = useVaultActions(
    vault,
    mode,
    walletAddress,
    walletChainId,
    variant,
    zapToken,
    slippage
  );

  const sourcesKey = actions.sources.join(',');
  useEffect(() => {
    if (hasLockedVariant || withdrawPicked) return;
    setWithdrawVariant(actions.sources[0] === 'staking' ? 'staked' : 'unlocked');
  }, [sourcesKey, hasLockedVariant, withdrawPicked]); // eslint-disable-line react-hooks/exhaustive-deps

  // A confirmed deposit or withdrawal changes the position the page and the
  // portfolio show, not just this widget's own balances.
  const txStage = actions.status.stage;
  useEffect(() => {
    if (txStage === 'success') onBalancesChanged?.();
  }, [txStage, onBalancesChanged]);

  const chain = getChain(vault.chainID);
  const decimals = vault.token.decimals || 18;
  const shareDecimalsValue = vault.decimals ?? decimals;
  const symbol = vault.token.symbol;
  const price = vault.tvl?.price || 0;
  const lockedVariant = variant === 'locked';

  // Unstaked yBOLD earns nothing — its yield accrues in st-yBOLD.
  const earnsYield = !(stakesOnDeposit && variant !== 'staked');
  const amountNumber = Number(formatUnits(actions.parsedAmount, actions.inputDecimals));
  const zap = actions.zap;
  const inputSymbol = mode === 'deposit' && zapToken ? zapToken.symbol : symbol;
  const apy = !earnsYield
    ? 0
    : hasLockedVariant && lockedVariant
      ? vault.lockedTwin?.netAPR
      : hasLockedVariant
        ? vault.apr.forwardAPR?.netAPR || vault.apr.netAPR
        : getHeadlineAPY(vault);

  const variantOptions: { id: VaultVariant; label: string; icon: React.ReactNode }[] = hasLockedVariant
    ? [
        { id: 'locked', label: 'Locked', icon: <Lock size={12} /> },
        { id: 'unlocked', label: 'Unlocked', icon: <Unlock size={12} /> },
      ]
    : (mode === 'deposit' && stakesOnDeposit) || (mode === 'withdraw' && actions.sources.length > 1)
      ? [
          { id: 'staked', label: 'Staked', icon: <Lock size={12} /> },
          { id: 'unlocked', label: 'Unstaked', icon: <Unlock size={12} /> },
        ]
      : [];

  if (tab === 'migrate') {
    return (
      <MigratePanel
        vault={vault}
        vaults={vaults}
        walletAddress={walletAddress}
        walletChainId={walletChainId}
        onConnectWallet={onConnectWallet}
        onSelectVault={onSelectVault}
        onBalancesChanged={onBalancesChanged}
      />
    );
  }

  if (tab === 'info') {
    // `actions` reads only the vault itself; the portfolio scan also counts
    // st-yBOLD, locked yvUSD and staking contracts.
    const vaultPosition = actions.position;
    const fallbackAssets = vaultPosition
      ? (vaultPosition.vaultShares * vaultPosition.pricePerShare) / 10n ** BigInt(shareDecimalsValue)
      : 0n;
    const depositedAssets = Number(
      formatUnits(position ? position.assets : fallbackAssets, decimals)
    );
    const shares = Number(
      formatUnits(position ? position.shares : vaultPosition?.vaultShares ?? 0n, shareDecimalsValue)
    );
    const walletAssets = Number(formatUnits(vaultPosition?.assetBalance ?? 0n, decimals));

    return (
      <div className="y-widget y-wallet">
        <div className="y-wallet__head">
          <h3 className="y-wallet__title">Wallet</h3>
          <div className="y-variant" role="tablist" aria-label="Wallet section">
            {WALLET_TABS.map((walletTab) => (
              <button
                key={walletTab.id}
                type="button"
                role="tab"
                aria-selected={infoTab === walletTab.id}
                className={`y-variant__btn${infoTab === walletTab.id ? ' is-active' : ''}`}
                onClick={() => setInfoTab(walletTab.id)}
              >
                {walletTab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="y-wallet__body">
          {!walletAddress ? (
            <div className="y-wallet__empty">
              <Wallet size={24} />
              <p>Connect a wallet to view balances and transactions.</p>
              <button type="button" className="y-btn y-btn--contrast" onClick={onConnectWallet}>
                Connect Wallet
              </button>
            </div>
          ) : infoTab === 'balances' ? (
            <>
              <section className="y-wallet__section">
                <h4 className="y-wallet__section-title">Your Vault balances</h4>
                <div className="y-wallet__rows">
                  <div className="y-wallet__row">
                    <span className="y-wallet__row-label">Deposited value</span>
                    <span className="y-wallet__row-value">
                      {`${formatAmount(depositedAssets)} ${symbol}`}
                      <span className="y-wallet__row-usd">{` (${formatUSD(depositedAssets * price)})`}</span>
                    </span>
                  </div>
                  <div className="y-wallet__row">
                    <span className="y-wallet__row-label">Deposited shares</span>
                    <span className="y-wallet__row-value">
                      {formatAmount(shares)}
                      <span className="y-wallet__row-usd">{` (${formatUSD(depositedAssets * price)})`}</span>
                    </span>
                  </div>
                </div>
              </section>

              <section className="y-wallet__section">
                <h4 className="y-wallet__section-title">Wallet balances</h4>
                <div className="y-wallet__rows">
                  <div className="y-wallet__row">
                    <span className="y-wallet__row-label">{`Available ${symbol}`}</span>
                    <span className="y-wallet__row-value">
                      {formatAmount(walletAssets)}
                      <span className="y-wallet__row-usd">{` (${formatUSD(walletAssets * price)})`}</span>
                    </span>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <RecentTransactions
              address={walletAddress}
              vault={vault}
              onOpenActivity={onOpenActivity}
            />
          )}
        </div>
      </div>
    );
  }

  const isDeposit = mode === 'deposit';
  const available = actions.available;
  const isBusy = actions.status.stage === 'approving' || actions.status.stage === 'executing';
  const { locked } = actions;
  const isRetired = isRetiredVault(vault);

  // A locked withdrawal is a cooldown cycle, not a single call: arm it, wait
  // out `cooldownDuration`, then redeem inside `withdrawalWindow`.
  const isLockedWithdraw = !isDeposit && hasLockedVariant && lockedVariant;
  const needsCooldown =
    isLockedWithdraw && (locked.phase === 'idle' || locked.phase === 'expired');
  const isCoolingDown = isLockedWithdraw && locked.phase === 'cooling';

  const step = actions.status.step;
  const stepSuffix = step && step.total > 1 ? ` (${step.index + 1}/${step.total})` : '';

  let buttonLabel = isDeposit ? 'Deposit' : 'Withdraw';
  if (needsCooldown) buttonLabel = locked.phase === 'expired' ? 'Restart Cooldown' : 'Start Cooldown';
  if (isCoolingDown) buttonLabel = `Cooldown ${formatDuration(locked.secondsLeft)}`;
  if (!walletAddress) buttonLabel = 'Connect Wallet';
  else if (actions.isWrongChain) buttonLabel = `Switch to ${chain.name}`;
  else if (actions.blockedReason && actions.parsedAmount > 0n) buttonLabel = actions.blockedReason;
  else if (zap && actions.parsedAmount > 0n && zap.minOut === null) buttonLabel = 'Fetching route…';
  if (isBusy) {
    buttonLabel = step
      ? `${step.label}…${stepSuffix}`
      : needsCooldown
        ? 'Starting cooldown…'
        : isDeposit
          ? 'Depositing…'
          : 'Withdrawing…';
  }

  const handleAction = () => {
    if (!walletAddress) return onConnectWallet();
    if (actions.isWrongChain) return void actions.switchToVaultChain();
    if (needsCooldown) return void actions.startCooldown();
    return void actions.execute();
  };

  const isDisabled =
    isBusy ||
    isCoolingDown ||
    (Boolean(walletAddress) &&
      !actions.isWrongChain &&
      !needsCooldown &&
      (actions.parsedAmount === 0n ||
        Boolean(actions.blockedReason) ||
        Boolean(zap && (zap.isQuoting || zap.minOut === null))));

  const sharesPreview = Number(
    formatUnits(actions.sharesPreview, zap && isDeposit ? zap.outDecimals : shareDecimalsValue)
  );
  const receiveAmount = actions.isMax
    ? Number(formatUnits(available, decimals))
    : amountNumber;
  const approval = actions.approval;
  // An Enso route guarantees only its minimum; show that, as yearn.fi does.
  const zapReceive = !zap
    ? null
    : zap.minOut === null
      ? zap.isQuoting
        ? 'Fetching route…'
        : '—'
      : `at least ${formatAmount(Number(formatUnits(zap.minOut, zap.outDecimals)))} ${zap.outSymbol}`;
  const showTokenPicker = canZap && zapTokens.length > 1;

  const zapRows = zap ? (
    <>
      <SummaryRow
        label={
          <InfoPopover label="Price impact" title="Price impact">
            <p>
              The zap swaps through Enso. Estimated impact is what the route is expected to cost;
              worst case is what it may cost at the minimum it guarantees.
            </p>
          </InfoPopover>
        }
        value={
          zap.estImpact === null
            ? '—'
            : `${zap.estImpact.toFixed(2)}% (worst ${(zap.worstImpact ?? zap.estImpact).toFixed(2)}%)`
        }
      />
      <SummaryRow
        label="Slippage tolerance"
        value={
          <span className="y-slippage">
            {ZAP_SLIPPAGE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`y-slippage__btn${slippage === preset ? ' is-active' : ''}`}
                disabled={isBusy}
                onClick={() => setSlippage(preset)}
              >
                {`${preset}%`}
              </button>
            ))}
          </span>
        }
      />
    </>
  ) : null;
  const hasUnstakedYBold =
    isDeposit && stakesOnDeposit && (actions.position?.vaultShares ?? 0n) > 0n;

  return (
    <div className="y-widget">
      <div className="y-widget__inner">
        <div className="y-widget__head">
          <h3 className="y-widget__title">{isDeposit ? 'Deposit' : 'Withdraw'}</h3>
          {variantOptions.length > 0 && (
            <div className="y-variant" role="group" aria-label="Vault share variant">
              {variantOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`y-variant__btn${variant === option.id ? ' is-active' : ''}`}
                  onClick={() => setVariant(option.id)}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {isRetired && !isDeposit && (
          <p className="y-widget__warning">{`This vault is retired. ${RETIRED_TAG_DESCRIPTION}`}</p>
        )}

        {hasUnstakedYBold && (
          <div className="y-widget__stake">
            <div>
              <p className="y-widget__stake-title">You have unstaked yBOLD.</p>
              <p
                className="y-widget__stake-text"
                title="In order to earn yield, BOLD needs to be deposited and staked into ysyBOLD. It always makes sense to stake yBOLD and there is no lockup or fee."
              >
                Click the button to the right to stake your yBOLD to earn yield.
              </p>
            </div>
            <button
              type="button"
              className="y-btn--contrast"
              disabled={isBusy || actions.isWrongChain}
              onClick={() => void actions.stakeShares()}
            >
              Stake
            </button>
          </div>
        )}

        <AmountInput
          vault={vault}
          symbol={inputSymbol}
          value={actions.amount}
          onChange={actions.setAmount}
          onPercent={actions.setPercent}
          disabled={!walletAddress || isBusy}
          usdValue={zapToken && isDeposit ? '' : formatUSD(amountNumber * price)}
          tokenPicker={
            isDeposit && showTokenPicker ? (
              <TokenPicker
                chainId={vault.chainID}
                tokens={zapTokens}
                selected={depositToken ?? zapTokens[0]}
                onSelect={selectToken}
                disabled={isBusy}
                ariaLabel="Deposit token"
              />
            ) : undefined
          }
          balanceLabel={
            walletAddress ? (
              <button
                type="button"
                className="y-amount__balance"
                onClick={() => actions.setPercent(100)}
              >
                {`Balance: ${formatAmount(
                  Number(formatUnits(available, isDeposit ? actions.inputDecimals : decimals))
                )} ${inputSymbol}`}
              </button>
            ) : (
              <button type="button" className="y-amount__balance" onClick={onConnectWallet}>
                Connect wallet
              </button>
            )
          }
        />

        {!isDeposit && showTokenPicker && (
          <div className="y-widget__receive">
            <span className="y-summary__label">Receive</span>
            <TokenPicker
              chainId={vault.chainID}
              tokens={zapTokens}
              selected={withdrawToken ?? zapTokens[0]}
              onSelect={selectToken}
              disabled={isBusy}
              ariaLabel="Withdrawal token"
            />
          </div>
        )}

        <div className="y-summary">
          {isDeposit ? (
            <>
              <SummaryRow
                label="You Will Deposit"
                value={`${formatAmount(amountNumber)} ${inputSymbol}`}
              />
              <SummaryRow
                label={
                  <InfoPopover label="You Will Receive" title="Vault Shares">
                    <p>
                      <b>What you'll receive</b>
                    </p>
                    <p>{`You're depositing ${symbol} into the vault. You'll receive ${vault.name}${
                      hasLockedVariant ? ` (${lockedVariant ? 'Locked' : 'Unlocked'})` : ''
                    }${variant === 'staked' ? ' (staked)' : ''} shares.`}</p>
                    <p>
                      <b>How vault shares work</b>
                    </p>
                    <p>
                      Vault shares represent your deposit. Their value grows automatically as the
                      vault earns yield — you don't need to do anything. When you withdraw, your
                      shares are exchanged back for the underlying asset plus any earnings.
                    </p>
                  </InfoPopover>
                }
                value={zapReceive ?? `${formatAmount(sharesPreview)} ${actions.sharesSymbol}`}
              />
              {!zap && (
              <SummaryRow
                label={
                  <InfoPopover label="Vault share value" title="Vault Share Value">
                    <p>
                      <b>What this value means</b>
                    </p>
                    <p>
                      {`This is the amount of ${vault.name} you could redeem immediately after depositing. It represents the value of the shares you will receive converted to the underlying asset.`}
                    </p>
                  </InfoPopover>
                }
                value={`${formatAmount(amountNumber)} ${vault.name} (${formatUSDFull(
                  amountNumber * price
                )})`}
              />
              )}
              <SummaryRow
                label={
                  <InfoPopover label="Est. Annual Return" title="Estimated Annual Return">
                    <p>
                      The estimated annual return is calculated based on the vault's historical
                      performance and current market conditions.
                    </p>
                    <p>
                      <b>Calculation factors:</b>
                    </p>
                    <p>{`Current APR: ${formatAPY(apy)}`}</p>
                    <p>{`Your deposit: ${formatAmount(amountNumber)} ${inputSymbol}`}</p>
                    <p>{`Expected annual yield: ${formatAmount(
                      amountNumber * (apy || 0)
                    )} ${inputSymbol}`}</p>
                    <p>
                      Please note that past performance does not guarantee future results. Actual
                      returns may vary based on market volatility and vault strategy adjustments.
                    </p>
                  </InfoPopover>
                }
                value={`${formatAmount(amountNumber * (apy || 0))} ${inputSymbol}`}
              />
              {approval && (
                <SummaryRow
                  label={
                    <InfoPopover label={`Existing Approval (${approval.spender})`} title="Manage approval">
                      <p>
                        <b>What is this?</b>
                      </p>
                      <p>
                        {`Token approval allows a smart contract to transfer your ${approval.symbol} up to a set limit. Deposits approve exactly the amount being deposited.`}
                      </p>
                    </InfoPopover>
                  }
                  value={`${formatAmount(
                    Number(formatUnits(approval.amount, approval.decimals))
                  )} ${approval.symbol}`}
                />
              )}
              {zapRows}
            </>
          ) : (
            <>
              <SummaryRow
                label={
                  <InfoPopover label="You will redeem" title="Vault Shares">
                    <p>
                      Vault shares represent your deposit. Redeeming exchanges them back for the
                      underlying asset plus any earnings.
                    </p>
                  </InfoPopover>
                }
                value={`${formatAmount(sharesPreview)} ${actions.sharesSymbol}`}
              />
              <SummaryRow
                label="You will receive"
                value={zapReceive ?? `${formatAmount(receiveAmount)} ${symbol}`}
              />
              {zapRows}
              {approval && (
                <SummaryRow
                  label={
                    <InfoPopover label={`Existing Approval (${approval.spender})`} title="Manage approval">
                      <p>
                        <b>What is this?</b>
                      </p>
                      <p>
                        {`This withdrawal routes through the ${approval.spender} contract, which needs approval to spend your ${approval.symbol}.`}
                      </p>
                    </InfoPopover>
                  }
                  value={`${formatAmount(
                    Number(formatUnits(approval.amount, approval.decimals))
                  )} ${approval.symbol}`}
                />
              )}
            </>
          )}
        </div>

        {isDeposit && !earnsYield && (
          <p className="y-widget__warning">
            Automatic staking is off. Unstaked yBOLD does not earn yield — its yield accrues to
            staked yBOLD.
          </p>
        )}

        {hasLockedVariant && lockedVariant && isDeposit && (
          <ul className="y-widget__notice">
            <li>{`${locked.cooldownDays} day cooldown`}</li>
            <li>{`${locked.windowDays} day withdrawal window`}</li>
            <li>Higher yield</li>
          </ul>
        )}

        {isLockedWithdraw && locked.phase !== 'none' && (
          <div className="y-widget__cooldown">
            <p className="y-widget__cooldown-text">
              {locked.phase === 'idle' &&
                `Locked shares need a ${locked.cooldownDays} day cooldown before they can be withdrawn.`}
              {locked.phase === 'cooling' &&
                `Cooldown ends in ${formatDuration(locked.secondsLeft)}, then you have ${
                  locked.windowDays
                } days to withdraw.`}
              {locked.phase === 'ready' &&
                `Ready to withdraw — ${formatDuration(locked.secondsLeft)} left in the window.`}
              {locked.phase === 'expired' &&
                'The withdrawal window closed. Start a new cooldown to withdraw.'}
            </p>
            {locked.cooldownShares > 0n && (
              <button
                type="button"
                className="y-widget__cooldown-cancel"
                disabled={isBusy}
                onClick={() => void actions.cancelCooldown()}
              >
                Cancel cooldown
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          className="y-btn y-btn--primary y-widget__cta"
          disabled={isDisabled}
          onClick={handleAction}
        >
          {buttonLabel}
        </button>

        {actions.status.stage === 'error' && actions.status.message && (
          <p className="y-widget__error">{actions.status.message}</p>
        )}
        {actions.status.stage === 'success' && (
          <button
            type="button"
            className="y-widget__success"
            onClick={() =>
              actions.status.txHash &&
              openExternal(`${chain.blockExplorer}/tx/${actions.status.txHash}`)
            }
          >
            Transaction confirmed ↗
          </button>
        )}
      </div>
    </div>
  );
};
