import React, { useState } from 'react';
import { ActivityEntry } from '../../holdingsApi';
import { YearnVault } from '../../types';
import {
  ActivityIconKind,
  ActivityLabels,
  activityAmountDetails,
  activityAmounts,
  activityIconKind,
  activityTitle,
  chainName,
  findChain,
  formatActivityAmount,
  formatActivityDate,
  formatActivityDateTime,
  isZapEntry,
  tokenLogoUrl,
} from '../../activity';
import { openExternal } from '../../openExternal';
import { TokenIcon } from '../TokenIcon';
import {
  Check,
  ChevronDown,
  CoinsIcon,
  Copy,
  DepositIcon,
  Lock,
  TransferIcon,
  Unlock,
  WithdrawIcon,
} from '../ui/icons';

export type ActivityChip = 'vault' | 'chain' | 'date' | 'zap';

const ICONS: Record<ActivityIconKind, React.FC<{ size?: number }>> = {
  deposit: DepositIcon,
  withdraw: WithdrawIcon,
  stake: Lock,
  unstake: Unlock,
  transfer: TransferIcon,
  reward: CoinsIcon,
};

export const ActivityIcon: React.FC<{ entry: ActivityEntry; size?: number }> = ({
  entry,
  size = 20,
}) => {
  const Icon = ICONS[activityIconKind(entry)];
  const chain = findChain(entry.chainId);
  return (
    <span className="y-act-icon">
      <Icon size={size} />
      {chain && <img className="y-act-icon__chain" src={chain.icon} alt="" loading="lazy" />}
    </span>
  );
};

export const ActivityAmounts: React.FC<{ entry: ActivityEntry; labels: ActivityLabels }> = ({
  entry,
  labels,
}) => (
  <div className="y-act-amounts">
    <TokenIcon
      src={tokenLogoUrl(entry.chainId, labels.iconAddress)}
      symbol={labels.shareSymbol || entry.assetSymbol || ''}
      chainId={entry.chainId}
      tokenAddress={labels.iconAddress}
      size={24}
    />
    <div className="y-act-amounts__lines">
      {activityAmounts(entry, labels.shareSymbol).map((line, index) => (
        <div className="y-act-amounts__line" key={index}>
          <span className="y-act-amounts__value">
            {line.sign}
            {formatActivityAmount(line.value)}
          </span>
          <span className="y-act-amounts__symbol">{line.symbol}</span>
        </div>
      ))}
    </div>
  </div>
);

/** `0x123456...abcdef` */
export const shortTxHash = (hash: string) => `${hash.slice(0, 8)}...${hash.slice(-6)}`;

export function openTransaction(entry: ActivityEntry): void {
  const explorer = findChain(entry.chainId)?.blockExplorer;
  if (explorer) openExternal(`${explorer}/tx/${entry.txHash}`);
}

interface ActivityRowProps {
  entry: ActivityEntry;
  labels: ActivityLabels;
  /** The row in our vaults list this entry belongs to, if any. */
  listedVault?: YearnVault;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectVault?: (vault: YearnVault) => void;
  /** Chips double as filters on the Activity tab. */
  activeChips?: Partial<Record<ActivityChip, boolean>>;
  onChip?: (chip: ActivityChip) => void;
}

export const ActivityRow: React.FC<ActivityRowProps> = ({
  entry,
  labels,
  listedVault,
  isExpanded,
  onToggle,
  onSelectVault,
  activeChips = {},
  onChip,
}) => {
  const [copied, setCopied] = useState(false);
  const chain = findChain(entry.chainId);

  const chip = (id: ActivityChip, content: React.ReactNode, title?: string) => (
    <button
      type="button"
      className={`y-act-chip${activeChips[id] ? ' is-active' : ''}`}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onChip?.(id);
      }}
      disabled={!onChip}
    >
      {content}
    </button>
  );

  const copyHash = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(entry.txHash);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the hash stays selectable.
    }
  };

  return (
    <div className={`y-act-row${isExpanded ? ' is-expanded' : ''}`}>
      <div
        className="y-act-row__main"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="y-act-row__lead">
          <ActivityIcon entry={entry} />
          <div className="y-act-row__text">
            <span className="y-act-row__title">{activityTitle(entry)}</span>
            <div className="y-act-row__chips">
              {chip('vault', labels.vaultName)}
              {chip('chain', chainName(entry.chainId))}
              {chip('date', formatActivityDate(entry.timestamp), formatActivityDateTime(entry.timestamp))}
              {entry.status !== 'ok' && <span className="y-act-chip is-static">Limited metadata</span>}
              {isZapEntry(entry) && chip('zap', <>⚡ Zap</>)}
            </div>
          </div>
        </div>
        <ActivityAmounts entry={entry} labels={labels} />
        <span className="y-act-row__toggle" aria-hidden="true">
          <ChevronDown size={16} />
        </span>
      </div>

      {isExpanded && (
        <dl className="y-act-details">
          {activityAmountDetails(entry, labels).map((row) => (
            <div className="y-act-details__row" key={row.label}>
              <dt>{row.label}:</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
          <div className="y-act-details__row">
            <dt>Confirmed on:</dt>
            <dd>{formatActivityDateTime(entry.timestamp)}</dd>
          </div>
          <div className="y-act-details__row">
            <dt>Vault name:</dt>
            <dd>
              {listedVault && onSelectVault ? (
                <button
                  type="button"
                  className="y-act-link"
                  onClick={() => onSelectVault(listedVault)}
                >
                  {labels.vaultName}
                </button>
              ) : (
                labels.vaultName
              )}
            </dd>
          </div>
          <div className="y-act-details__row">
            <dt>Chain name:</dt>
            <dd className="y-act-details__chain">
              {chain && <img className="y-chain-icon" src={chain.icon} alt="" loading="lazy" />}
              {chainName(entry.chainId)}
            </dd>
          </div>
          <div className="y-act-details__row">
            <dt>Transaction hash:</dt>
            <dd className="y-act-details__hash">
              {chain ? (
                <button
                  type="button"
                  className="y-act-link y-act-mono"
                  onClick={() => openTransaction(entry)}
                >
                  {shortTxHash(entry.txHash)}
                </button>
              ) : (
                <span className="y-act-mono">{shortTxHash(entry.txHash)}</span>
              )}
              <button
                type="button"
                className="y-act-copy"
                aria-label="Copy transaction hash"
                onClick={copyHash}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
};
