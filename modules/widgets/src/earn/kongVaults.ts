/**
 * The vaults list, read the way yearn.fi reads it: from Kong's vault list
 * (`/api/rest/list/vaults`), with the site's catalog filter and selectors
 * (`pages/vaults/domain/kongVaultSelectors.ts`, `normalizeVault.ts`).
 *
 * Kong has no asset price, strategies, descriptions or staking source, so
 * yDaemon's copy of the same vault fills those in when it has one.
 */

import { YearnVault, YearnStrategy } from './types';
import {
  VAULT_ICON_OVERRIDES,
  YBOLD_STAKING_ADDRESS,
  YBOLD_VAULT_ADDRESS,
  YVUSD_LOCKED_ADDRESS,
  YVUSD_UNLOCKED_ADDRESS,
} from './constants';

type Num = number | null | undefined;

export interface KongListVault {
  chainId: number;
  address: string;
  name?: string;
  symbol?: string;
  apiVersion?: string;
  decimals?: number;
  asset?: { address?: string; name?: string; symbol?: string; decimals?: number };
  tvl?: Num;
  performance?: {
    oracle?: { apr?: Num; netAPR?: Num; apy?: Num; netAPY?: Num } | null;
    historical?: { net?: Num; weeklyNet?: Num; monthlyNet?: Num; inceptionNet?: Num } | null;
    estimated?: {
      apr?: Num;
      apy?: Num;
      type?: string;
      components?: Record<string, Num>;
    } | null;
  };
  fees?: { managementFee?: Num; performanceFee?: Num };
  category?: string;
  type?: string;
  kind?: string;
  isRetired?: boolean;
  isHidden?: boolean;
  isBoosted?: boolean;
  isHighlighted?: boolean;
  inclusion?: { isYearn?: boolean };
  riskLevel?: Num;
  migration?: boolean | { available?: boolean; target?: string; contract?: string };
  origin?: string;
  staking?: { address?: string | null; available?: boolean };
  pricePerShare?: number | string;
}

/** yearn.fi's catalog filter. */
export const isYearnCatalogVault = (vault: KongListVault) =>
  vault.origin === 'yearn' && vault.inclusion?.isYearn !== false;

const KATANA_CHAIN_ID = 747474;
const lower = (value?: string | null) => (value || '').toLowerCase();
const YBOLD = lower(YBOLD_VAULT_ADDRESS);
const YBOLD_STAKING = lower(YBOLD_STAKING_ADDRESS);
const YVUSD_UNLOCKED = lower(YVUSD_UNLOCKED_ADDRESS);
const YVUSD_LOCKED = lower(YVUSD_LOCKED_ADDRESS);

/** First finite number, else 0 — the site's `pickNumber`. */
function pickNumber(...values: Num[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function optionalNumber(value: Num): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Kong fees are basis points; the rest of the app works in ratios. */
const normalizeFee = (value: Num) => (!value || Number.isNaN(value) ? 0 : value > 1 ? value / 10000 : value);

/**
 * Display name rule used by yearn.fi: drop the Curve/Aerodrome/Velodrome
 * prefix, turn "… Factory yVault" into "… LP" and strip a bare " yVault".
 */
export function formatVaultDisplayName(rawName: string): string {
  const baseName = rawName.replace(/^(curve|aerodrome|velodrome)\s+/i, '');
  if (baseName.includes(' Factory yVault')) return baseName.replace(' Factory yVault', ' LP');
  if (baseName.includes(' yVault')) return baseName.replace(' yVault', '');
  return baseName;
}

function normalizeCategory(category?: string): string {
  const value = (category || '').trim();
  if (!value) return 'General';
  if (value.toLowerCase() === 'auto') return 'Volatile';
  return value;
}

/** Kong serialises price per share as a JSON number; keep it as an integer string. */
function integerString(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return BigInt(typeof value === 'number' ? Math.round(value) : value).toString();
  } catch {
    return undefined;
  }
}

/** yearn.fi `getVaultAPR` for a list item (no snapshot). */
function forwardNetAPR(vault: KongListVault): number {
  const { oracle, estimated, historical } = vault.performance || {};
  if (lower(vault.address) === YBOLD || lower(vault.address) === YBOLD_STAKING) {
    return pickNumber(oracle?.netAPY);
  }
  // yvUSD's rates come from its snapshot on yearn.fi, which reads the
  // estimate before the oracle (the oracle misses the locker bonus).
  const addr = lower(vault.address);
  if (addr === YVUSD_UNLOCKED || addr === YVUSD_LOCKED) {
    return pickNumber(estimated?.apy, estimated?.apr, oracle?.netAPY, oracle?.apy, oracle?.netAPR, historical?.net);
  }
  if (vault.chainId === KATANA_CHAIN_ID) {
    return pickNumber(
      estimated?.apy,
      estimated?.apr,
      oracle?.netAPY,
      oracle?.apy,
      oracle?.netAPR,
      historical?.net
    );
  }
  return pickNumber(oracle?.netAPY, oracle?.apy, oracle?.netAPR, estimated?.apy, historical?.net);
}

function mapStrategies(raw: any): YearnStrategy[] | undefined {
  if (!Array.isArray(raw?.strategies)) return undefined;
  return raw.strategies.map((s: any) => ({
    address: s?.address || '',
    name: s?.name || 'Strategy',
    status: s?.status,
    netAPR: s?.netAPR === undefined || s?.netAPR === null ? null : Number(s.netAPR),
    details: s?.details
      ? {
          totalDebt: s.details.totalDebt,
          totalLoss: s.details.totalLoss,
          totalGain: s.details.totalGain,
          performanceFee: s.details.performanceFee,
          lastReport: s.details.lastReport,
          debtRatio: s.details.debtRatio,
        }
      : undefined,
  }));
}

/** As yearn.fi's `mergeYBoldVault`: the yBOLD row carries st-yBOLD's yield. */
function mergeYBold(base: KongListVault, staked: KongListVault): KongListVault {
  return {
    ...base,
    staking: { address: staked.address, available: true },
    performance: {
      ...(base.performance || {}),
      historical: staked.performance?.historical ?? null,
      estimated: staked.performance?.estimated ?? null,
      oracle: staked.performance?.oracle ?? null,
    },
    fees: {
      managementFee: base.fees?.managementFee ?? 0,
      performanceFee: staked.fees?.performanceFee ?? base.fees?.performanceFee ?? 0,
    },
  };
}

export interface KongMapContext {
  /** yDaemon's copy of each vault, keyed `${chainId}:${lowercase address}`. */
  ydaemon: Map<string, any>;
  stakedYBold?: KongListVault;
  lockedYvUsd?: KongListVault;
}

export function mapKongVault(source: KongListVault, ctx: KongMapContext): YearnVault {
  const addr = lower(source.address);
  const isYBold = addr === YBOLD && ctx.stakedYBold;
  const kong = isYBold ? mergeYBold(source, ctx.stakedYBold as KongListVault) : source;
  const yd = ctx.ydaemon.get(`${kong.chainId}:${addr}`);
  const { oracle, estimated, historical } = kong.performance || {};
  const components = estimated?.components || {};

  const asset = kong.asset || {};
  const tokenDecimals = asset.decimals || yd?.token?.decimals || kong.decimals || 18;
  const tokenIcon =
    yd?.token?.icon ||
    `https://token-assets-one.vercel.app/api/tokens/${kong.chainId}/${lower(asset.address)}/logo-128.png`;

  let lockedTwin: YearnVault['lockedTwin'];
  if (addr === YVUSD_UNLOCKED && ctx.lockedYvUsd) {
    const locked = ctx.lockedYvUsd;
    lockedTwin = {
      address: locked.address,
      netAPR: forwardNetAPR(locked),
      monthAgo: pickNumber(locked.performance?.historical?.monthlyNet),
      pricePerShare: integerString(locked.pricePerShare),
      tvl: pickNumber(locked.tvl),
    };
  }

  const stakingAddress = isYBold ? YBOLD_STAKING_ADDRESS : kong.staking?.address;
  const migration = typeof kong.migration === 'object' && kong.migration ? kong.migration : undefined;
  const rawName = kong.name || yd?.name || 'Yearn Vault';

  return {
    address: kong.address,
    type: kong.type || yd?.type || 'Yearn Vault',
    kind: kong.kind || yd?.kind || 'Single Strategy',
    symbol: kong.symbol || yd?.symbol || 'yVault',
    displaySymbol: yd?.displaySymbol || kong.symbol,
    name: addr === YVUSD_UNLOCKED ? 'yvUSD' : formatVaultDisplayName(rawName),
    rawName,
    displayName: yd?.displayName || rawName,
    icon: VAULT_ICON_OVERRIDES[addr] || tokenIcon,
    version: kong.apiVersion || yd?.version || '3.0.0',
    category: normalizeCategory(kong.category),
    chainID: kong.chainId,
    decimals: kong.decimals || yd?.decimals || tokenDecimals,
    description: yd?.description,
    endorsed: Boolean(yd?.endorsed ?? true),
    boosted: Boolean(kong.isBoosted),
    emergency_shutdown: Boolean(yd?.emergency_shutdown),
    featuringScore: yd?.featuringScore === undefined ? undefined : Number(yd.featuringScore),
    pricePerShare: yd?.pricePerShare ?? integerString(kong.pricePerShare),
    token: {
      address: asset.address || yd?.token?.address,
      name: asset.name || yd?.token?.name || asset.symbol || 'Token',
      symbol: asset.symbol || yd?.token?.symbol || 'TOKEN',
      decimals: tokenDecimals,
      icon: tokenIcon,
      description: yd?.token?.description,
    },
    tvl: {
      totalAssets: yd?.tvl?.totalAssets,
      tvl: pickNumber(kong.tvl),
      // Kong's list carries no asset price; the portfolio values positions with it.
      price: Number(yd?.tvl?.price || 0),
    },
    apr: {
      type: estimated?.type || (typeof oracle?.apy === 'number' ? 'oracle' : 'unknown'),
      netAPR: pickNumber(historical?.net),
      fees: {
        performance: normalizeFee(kong.fees?.performanceFee),
        management: normalizeFee(kong.fees?.managementFee),
      },
      points: {
        weekAgo: pickNumber(historical?.weeklyNet),
        monthAgo: pickNumber(historical?.monthlyNet),
        inception: pickNumber(historical?.inceptionNet),
      },
      pricePerShare: yd?.apr?.pricePerShare,
      extra: {
        stakingRewardsAPR: 0,
        gammaRewardAPR: 0,
        katanaAppRewardsAPR: optionalNumber(components.katanaAppRewardsAPR),
        katanaBonusAPY: optionalNumber(components.katanaBonusAPY),
        steerPointsPerDollar: optionalNumber(components.steerPointsPerDollar),
        fixedRateKatanaRewards: optionalNumber(
          components.fixedRateKatanaRewards ?? components.FixedRateKatanaRewards
        ),
      },
      forwardAPR: {
        type: isYBold
          ? 'oracle'
          : typeof oracle?.apy === 'number'
            ? 'oracle'
            : estimated?.type ?? '',
        netAPR: forwardNetAPR(kong),
        composite: { boost: optionalNumber(components.boost) ?? null },
      },
    },
    strategies: mapStrategies(yd),
    staking: stakingAddress
      ? {
          address: stakingAddress,
          available: isYBold ? true : Boolean(kong.staking?.available),
          // Kong's list leaves out the source; it decides how to unstake.
          source: isYBold ? 'yBOLD' : yd?.staking?.source || '',
          rewards: yd?.staking?.rewards,
        }
      : undefined,
    info: {
      riskLevel: typeof kong.riskLevel === 'number' ? kong.riskLevel : yd?.info?.riskLevel,
      isRetired: Boolean(kong.isRetired),
      isHidden: Boolean(kong.isHidden),
      isBoosted: Boolean(kong.isBoosted),
      isHighlighted: Boolean(kong.isHighlighted),
    },
    details: {
      isRetired: Boolean(kong.isRetired),
      isHidden: Boolean(kong.isHidden),
      category: kong.category,
    },
    migration: migration?.available
      ? { available: true, target: migration.target, contract: migration.contract }
      : undefined,
    lockedTwin,
    dataAddress: isYBold ? YBOLD_STAKING_ADDRESS : undefined,
  };
}

/** Rows yearn.fi folds into another row instead of listing on their own. */
export const isMergedAlias = (vault: { address: string }) => {
  const addr = lower(vault.address);
  return addr === YBOLD_STAKING || addr === YVUSD_LOCKED;
};

export const isYBoldProductAddress = (address: string) => {
  const addr = lower(address);
  return addr === YBOLD || addr === YBOLD_STAKING;
};

export const KATANA_CHAIN = KATANA_CHAIN_ID;
