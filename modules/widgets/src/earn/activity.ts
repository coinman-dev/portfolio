/** Activity row wording and numbers, ported from yearn.fi's
 *  `pages/portfolio/activity.helpers.ts` and `PortfolioActivitySection`. */

import { ActivityAction, ActivityEntry } from './holdingsApi';
import { KongVaultIndex, kongVaultKey } from './kongApi';
import { shortenAddress } from './format';
import { SUPPORTED_CHAINS } from './yearnApi';
import { SupportedChain, YearnVault } from './types';

export const ACTIVITY_TYPES: { id: ActivityAction; label: string }[] = [
  { id: 'deposit', label: 'Deposit' },
  { id: 'withdraw', label: 'Withdraw' },
  { id: 'stake', label: 'Stake' },
  { id: 'unstake', label: 'Unstake' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'swap', label: 'Swap' },
];

export type ActivityIconKind = 'deposit' | 'withdraw' | 'stake' | 'unstake' | 'transfer' | 'reward';

/** Activity can reach chains the vaults list does not offer (old Fantom vaults…). */
export function findChain(chainId: number): SupportedChain | undefined {
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId);
}

export const chainName = (chainId: number) => findChain(chainId)?.name ?? `Chain ${chainId}`;

const hasInputToken = (entry: ActivityEntry) =>
  Boolean(entry.inputTokenAddress && entry.inputTokenAmount);
const hasOutputToken = (entry: ActivityEntry) =>
  Boolean(entry.outputTokenAddress && entry.outputTokenAmount);

/** The server marks a zap by filling in the token that went in or came out. */
export function isZapEntry(entry: ActivityEntry): boolean {
  return entry.action !== 'swap' && (hasInputToken(entry) || hasOutputToken(entry));
}

const isRewardClaim = (entry: ActivityEntry) => entry.displayType === 'reward_claim';

export function activityTitle(entry: ActivityEntry): string {
  if (isRewardClaim(entry)) return 'Reward Claim';
  if (entry.action === 'transfer') {
    if (hasInputToken(entry) && hasOutputToken(entry)) return 'Zap';
    return entry.transferDirection === 'in' ? 'Transfer in' : 'Transfer out';
  }
  return ACTIVITY_TYPES.find((type) => type.id === entry.action)?.label ?? entry.action;
}

export function activityIconKind(entry: ActivityEntry): ActivityIconKind {
  if (isRewardClaim(entry)) return 'reward';
  if (entry.action === 'transfer' || entry.action === 'swap') return 'transfer';
  return entry.action;
}

export interface ActivityLabels {
  /** "DAI-1 yVault", "Staked yBOLD" — Kong's name for the vault family. */
  vaultName: string;
  /** "yvDAI-1", "ysyBOLD" — the shares the entry moved. */
  shareSymbol: string;
  /** Deposit asset of the vault family; drives the row's token logo. */
  iconAddress: string;
}

export function activityLabels(entry: ActivityEntry, kong?: KongVaultIndex): ActivityLabels {
  const family = kong?.[kongVaultKey(entry.chainId, entry.familyVaultAddress)];
  const own = kong?.[kongVaultKey(entry.chainId, entry.vaultAddress)];
  return {
    vaultName:
      family?.name || own?.name || entry.assetSymbol || shortenAddress(entry.vaultAddress),
    shareSymbol: own?.symbol || family?.symbol || '',
    iconAddress: (family?.assetAddress || entry.familyVaultAddress || entry.vaultAddress).toLowerCase(),
  };
}

export const tokenLogoUrl = (chainId: number, address: string) =>
  `https://cdn.jsdelivr.net/gh/yearn/tokenassets@main/tokens/${chainId}/${address}/logo-32.png`;

/** The row of our own vaults list an entry belongs to, for in-app navigation.
 *  st-yBOLD and locked yvUSD are merged into their parent rows there. */
export function findListedVault(entry: ActivityEntry, vaults: YearnVault[]): YearnVault | undefined {
  const targets = new Set([entry.familyVaultAddress, entry.vaultAddress].map((a) => a.toLowerCase()));
  return vaults.find(
    (vault) =>
      vault.chainID === entry.chainId &&
      [vault.address, vault.dataAddress, vault.lockedTwin?.address]
        .filter((address): address is string => Boolean(address))
        .some((address) => targets.has(address.toLowerCase()))
  );
}

/**
 * yearn.fi's `formatActivityFixedValue`: at most four digits including the
 * suffix — `48.6K`, `99.0K`, `500K`, `1.23M`, `999.8`, `5,000`.
 */
export function formatActivityAmount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Unknown';
  const abs = Math.abs(value);
  const withSuffix = (scaled: number, suffix: string) => {
    const digits = Math.floor(Math.log10(scaled)) + 1;
    return `${scaled.toFixed(Math.max(0, 3 - digits))}${suffix}`;
  };
  if (abs >= 1e9) return withSuffix(abs / 1e9, 'B');
  if (abs >= 1e6) return withSuffix(abs / 1e6, 'M');
  if (abs >= 1e4) return withSuffix(abs / 1e3, 'K');
  if (abs >= 1000) return Math.round(abs).toLocaleString('en-US');
  if (abs === 0) return '0';
  const digits = abs < 1 ? 1 : Math.floor(Math.log10(abs)) + 1;
  return abs.toFixed(Math.min(3, 4 - digits));
}

/** Expanded panel: full precision, up to six decimals. */
export function formatActivityExact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Unknown';
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/** `Sep 29, 2026` */
export function formatActivityDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** `Sep 29, 2026, 1:05 PM` */
export function formatActivityDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface AmountLine {
  sign: '+' | '-' | '';
  value: number | null;
  symbol: string;
}

interface Flows {
  deposited: number | null;
  depositedSymbol: string;
  received: number | null;
  receivedSymbol: string;
  shares: number | null;
}

function flows(entry: ActivityEntry): Flows {
  return {
    deposited: entry.inputTokenAmountFormatted ?? entry.assetAmountFormatted,
    depositedSymbol: entry.inputTokenSymbol ?? entry.assetSymbol ?? '',
    received: entry.outputTokenAmountFormatted ?? entry.assetAmountFormatted,
    receivedSymbol: entry.outputTokenSymbol ?? entry.assetSymbol ?? '',
    shares: entry.shareAmountFormatted,
  };
}

const isStakeZap = (entry: ActivityEntry) => entry.action === 'stake' && hasInputToken(entry);

/** What went out (first) and what came in, as shown on the right of a row. */
export function activityAmounts(entry: ActivityEntry, shareSymbol: string): AmountLine[] {
  const f = flows(entry);
  switch (entry.action) {
    case 'withdraw':
    case 'unstake':
      return [
        { sign: '-', value: f.shares, symbol: shareSymbol },
        { sign: '+', value: f.received, symbol: f.receivedSymbol },
      ];
    case 'transfer': {
      const incoming = isRewardClaim(entry) || entry.transferDirection !== 'out';
      return [{ sign: incoming ? '+' : '-', value: f.shares, symbol: shareSymbol }];
    }
    default:
      if (isStakeZap(entry)) {
        return [{ sign: '', value: entry.inputTokenAmountFormatted, symbol: entry.inputTokenSymbol ?? '' }];
      }
      return [
        { sign: '-', value: f.deposited, symbol: f.depositedSymbol },
        { sign: '+', value: f.shares, symbol: shareSymbol },
      ];
  }
}

export interface DetailRow {
  label: string;
  value: string;
}

/** The amount rows of the expanded panel; labels are rendered uppercase. */
export function activityAmountDetails(entry: ActivityEntry, labels: ActivityLabels): DetailRow[] {
  const f = flows(entry);
  const exact = (value: number | null, symbol: string) =>
    `${formatActivityExact(value)} ${symbol}`.trim();
  const shares = exact(f.shares, labels.shareSymbol);

  switch (entry.action) {
    case 'withdraw':
    case 'unstake':
      return [
        { label: 'Vault shares redeemed', value: shares },
        {
          label: entry.outputTokenSymbol ? 'Token received' : 'Asset received',
          value: exact(f.received, f.receivedSymbol),
        },
      ];
    case 'swap':
      return [
        { label: 'Vault shares sent', value: exact(f.deposited, f.depositedSymbol) },
        { label: 'Vault shares received', value: shares },
      ];
    case 'transfer': {
      const rows: DetailRow[] = [
        {
          label: isRewardClaim(entry)
            ? 'Reward claimed'
            : entry.transferDirection === 'out'
              ? 'Vault shares sent'
              : 'Vault shares received',
          value: shares,
        },
      ];
      if (hasInputToken(entry)) {
        rows.push({
          label: 'Token zapped',
          value: exact(entry.inputTokenAmountFormatted, entry.inputTokenSymbol ?? ''),
        });
      }
      if (hasOutputToken(entry)) {
        rows.push({
          label: 'Zapped to',
          value: exact(entry.outputTokenAmountFormatted, entry.outputTokenSymbol ?? ''),
        });
      }
      return rows;
    }
    default:
      if (isStakeZap(entry)) {
        return [
          {
            label: 'Token staked',
            value: exact(entry.inputTokenAmountFormatted, entry.inputTokenSymbol ?? ''),
          },
          { label: 'Staked in', value: labels.vaultName },
        ];
      }
      return [
        {
          label: isZapEntry(entry) ? 'Token zapped' : 'Token deposited',
          value: exact(f.deposited, f.depositedSymbol),
        },
        { label: 'Vault shares received', value: shares },
      ];
  }
}

/** yearn.fi's `doesActivityEntryMatchSearch`: case-insensitive substring over
 *  names, symbols, raw and formatted amounts, the date and the tx hash. */
export function activityMatchesSearch(
  entry: ActivityEntry,
  labels: ActivityLabels,
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    labels.vaultName,
    chainName(entry.chainId),
    activityTitle(entry),
    formatActivityDate(entry.timestamp),
    entry.assetSymbol,
    entry.inputTokenSymbol,
    entry.outputTokenSymbol,
    entry.assetAmount,
    entry.inputTokenAmount,
    entry.outputTokenAmount,
    entry.shareAmount,
    entry.assetAmountFormatted,
    entry.inputTokenAmountFormatted,
    entry.outputTokenAmountFormatted,
    entry.shareAmountFormatted,
    entry.txHash,
  ];
  return haystack.some(
    (value) => value !== null && value !== undefined && String(value).toLowerCase().includes(needle)
  );
}
