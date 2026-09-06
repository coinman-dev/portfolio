import React, { useState } from 'react';
import { formatUnits } from 'viem';
import { YearnVault } from '../../types';
import { getChain } from '../../yearnApi';
import { formatAmount, formatAPY, formatDuration, formatUSD, formatUSDFull } from '../../format';
import { openExternal } from '../../openExternal';
import { Lock, Unlock, Wallet } from '../ui/icons';
import { useVaultActions, WidgetMode } from '../../hooks/useVaultActions';
import { AmountInput } from './AmountInput';
import { InfoPopover } from './InfoPopover';

type WalletTabId = 'balances' | 'transactions';

const WALLET_TABS: { id: WalletTabId; label: string }[] = [
  { id: 'balances', label: 'Balances' },
  { id: 'transactions', label: 'Transactions' },
];

export type WidgetTab = 'deposit' | 'withdraw' | 'info';

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
  onConnectWallet: () => void;
}

export const VaultWidget: React.FC<VaultWidgetProps> = ({
  vault,
  tab,
  walletAddress,
  walletChainId,
  onConnectWallet,
}) => {
  // Deposits default to Locked; withdrawals default to Unlocked, as on yearn.fi.
  const [infoTab, setInfoTab] = useState<WalletTabId>('balances');
  const [depositLocked, setDepositLocked] = useState(true);
  const [withdrawLocked, setWithdrawLocked] = useState(false);
  const mode: WidgetMode = tab === 'withdraw' ? 'withdraw' : 'deposit';
  const lockedVariant = mode === 'withdraw' ? withdrawLocked : depositLocked;
  const setLockedVariant = mode === 'withdraw' ? setWithdrawLocked : setDepositLocked;
  const hasLockedVariant = Boolean(vault.lockedTwin);
  const actions = useVaultActions(
    vault,
    mode,
    walletAddress,
    walletChainId,
    hasLockedVariant && lockedVariant ? 'locked' : 'unlocked'
  );

  const chain = getChain(vault.chainID);
  const decimals = vault.token.decimals || 18;
  const symbol = vault.token.symbol;
  const price = vault.tvl?.price || 0;

  const amountNumber = Number(formatUnits(actions.parsedAmount, decimals));
  const apy = hasLockedVariant && lockedVariant
    ? vault.lockedTwin?.netAPR
    : vault.apr.forwardAPR?.netAPR ?? vault.apr.netAPR;

  // yvUSD locked deposits route through the Yearn Zap contract.
  const approvalLabel =
    hasLockedVariant && lockedVariant ? 'Existing Approval (Yearn Zap)' : 'Existing Approval (Vault)';

  const shareLabel = hasLockedVariant
    ? `${lockedVariant ? 'Locked' : 'Unlocked'} Vault Shares`
    : vault.symbol;

  if (tab === 'info') {
    const depositedAssets = Number(formatUnits(actions.underlyingBalance, decimals));
    const shares = Number(formatUnits(actions.vaultShares, vault.decimals ?? decimals));
    const walletAssets = Number(formatUnits(actions.tokenBalance, decimals));

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
            <section className="y-wallet__section">
              <h4 className="y-wallet__section-title">Recent transactions</h4>
              <p className="y-wallet__muted">No recent transactions.</p>
            </section>
          )}
        </div>
      </div>
    );
  }

  const isDeposit = mode === 'deposit';
  const available = actions.available;
  const isBusy = actions.status.stage === 'approving' || actions.status.stage === 'executing';
  const { locked } = actions;

  // A locked withdrawal is a cooldown cycle, not a single call: arm it, wait
  // out `cooldownDuration`, then redeem inside `withdrawalWindow`.
  const isLockedWithdraw = !isDeposit && hasLockedVariant && lockedVariant;
  const needsCooldown =
    isLockedWithdraw && (locked.phase === 'idle' || locked.phase === 'expired');
  const isCoolingDown = isLockedWithdraw && locked.phase === 'cooling';
  const approvalSymbol = isDeposit ? symbol : `${vault.symbol} shares`;

  let buttonLabel = isDeposit ? 'Deposit' : 'Withdraw';
  if (needsCooldown) buttonLabel = locked.phase === 'expired' ? 'Restart Cooldown' : 'Start Cooldown';
  if (isCoolingDown) buttonLabel = `Cooldown ${formatDuration(locked.secondsLeft)}`;
  if (!walletAddress) buttonLabel = 'Connect Wallet';
  else if (actions.isWrongChain) buttonLabel = `Switch to ${chain.name}`;
  else if (actions.needsApproval) buttonLabel = `Approve ${approvalSymbol}`;
  if (actions.status.stage === 'approving') buttonLabel = 'Approving…';
  if (actions.status.stage === 'executing') {
    buttonLabel = needsCooldown ? 'Starting cooldown…' : isDeposit ? 'Depositing…' : 'Withdrawing…';
  }

  const handleAction = () => {
    if (!walletAddress) return onConnectWallet();
    if (actions.isWrongChain) return void actions.switchToVaultChain();
    if (actions.needsApproval) return void actions.approve();
    if (needsCooldown) return void actions.startCooldown();
    return void actions.execute();
  };

  const isDisabled =
    isBusy ||
    isCoolingDown ||
    (Boolean(walletAddress) &&
      !actions.isWrongChain &&
      !actions.needsApproval &&
      (actions.parsedAmount === 0n || actions.parsedAmount > available));

  return (
    <div className="y-widget">
      <div className="y-widget__inner">
        <div className="y-widget__head">
          <h3 className="y-widget__title">{isDeposit ? 'Deposit' : 'Withdraw'}</h3>
          {hasLockedVariant && (
            <div className="y-variant" role="group" aria-label="Vault share variant">
              <button
                type="button"
                className={`y-variant__btn${lockedVariant ? ' is-active' : ''}`}
                onClick={() => setLockedVariant(true)}
              >
                <Lock size={12} />
                Locked
              </button>
              <button
                type="button"
                className={`y-variant__btn${!lockedVariant ? ' is-active' : ''}`}
                onClick={() => setLockedVariant(false)}
              >
                <Unlock size={12} />
                Unlocked
              </button>
            </div>
          )}
        </div>

        <AmountInput
          vault={vault}
          symbol={symbol}
          value={actions.amount}
          onChange={actions.setAmount}
          onPercent={actions.setPercent}
          disabled={!walletAddress || isBusy}
          usdValue={formatUSD(amountNumber * price)}
          balanceLabel={
            walletAddress ? (
              <button
                type="button"
                className="y-amount__balance"
                onClick={() => actions.setPercent(100)}
              >
                {`Balance: ${formatAmount(Number(formatUnits(available, decimals)))} ${symbol}`}
              </button>
            ) : (
              <button type="button" className="y-amount__balance" onClick={onConnectWallet}>
                Connect wallet
              </button>
            )
          }
        />

        <div className="y-summary">
          {isDeposit ? (
            <>
              <SummaryRow
                label="You Will Deposit"
                value={`${formatAmount(amountNumber)} ${symbol}`}
              />
              <SummaryRow
                label={
                  <InfoPopover label="You Will Receive" title="Vault Shares">
                    <p>
                      <b>What you'll receive</b>
                    </p>
                    <p>{`You're depositing ${symbol} into the vault. You'll receive ${vault.name}${
                      hasLockedVariant ? ` (${lockedVariant ? 'Locked' : 'Unlocked'})` : ''
                    } shares.`}</p>
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
                value={`${formatAmount(amountNumber)} ${shareLabel}`}
              />
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
                    <p>{`Your deposit: ${formatAmount(amountNumber)} ${symbol}`}</p>
                    <p>{`Expected annual yield: ${formatAmount(
                      amountNumber * (apy || 0)
                    )} ${symbol}`}</p>
                    <p>
                      Please note that past performance does not guarantee future results. Actual
                      returns may vary based on market volatility and vault strategy adjustments.
                    </p>
                  </InfoPopover>
                }
                value={`${formatAmount(amountNumber * (apy || 0))} ${symbol}`}
              />
              <SummaryRow
                label={
                  <InfoPopover label={approvalLabel} title="Manage approval">
                    <p>
                      <b>What is this?</b>
                    </p>
                    <p>
                      {`Token approval allows a smart contract to transfer your ${symbol} up to a set limit. This is required before depositing.`}
                    </p>
                  </InfoPopover>
                }
                value={`${formatAmount(
                  Number(formatUnits(actions.allowance, decimals))
                )} ${symbol}`}
              />
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
                value={`${formatAmount(
                  Number(formatUnits(actions.redeemShares, vault.decimals ?? decimals))
                )} ${hasLockedVariant ? shareLabel : 'Vault shares'}`}
              />
              <SummaryRow
                label="You will receive"
                value={`${formatAmount(amountNumber)} ${symbol}`}
              />
              {isLockedWithdraw && (
                <SummaryRow
                  label={
                    <InfoPopover label="Existing Approval (Yearn Zap)" title="Manage approval">
                      <p>
                        <b>What is this?</b>
                      </p>
                      <p>
                        Withdrawing a locked position routes through the Yearn Zap contract, which
                        needs approval to spend your locked vault shares.
                      </p>
                    </InfoPopover>
                  }
                  value={`${formatAmount(
                    Number(formatUnits(actions.allowance, vault.decimals ?? decimals))
                  )} ${vault.symbol}`}
                />
              )}
            </>
          )}
        </div>

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
