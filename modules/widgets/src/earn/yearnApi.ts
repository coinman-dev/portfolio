import { YearnVault, SupportedChain, YearnStrategy } from './types';
import {
  VAULT_ICON_OVERRIDES,
  YBOLD_STAKING_ADDRESS,
  YBOLD_VAULT_ADDRESS,
  YDAEMON_BASE_URL,
  YVUSD_LOCKED_ADDRESS,
  YVUSD_UNLOCKED_ADDRESS,
} from './constants';

const chainLogo = (id: number) => `https://token-assets-one.vercel.app/api/chains/${id}/logo-128.png`;

/** Order matches the chain segment on yearn.fi: Ethereum, Katana, Base, OP Mainnet.
 *  Arbitrum and Polygon are still fetched — the portfolio scan needs them —
 *  but they are excluded from the selector and from the vaults list. */
export const SUPPORTED_CHAINS: SupportedChain[] = [
  {
    id: 1,
    name: 'Ethereum',
    shortName: 'eth',
    icon: chainLogo(1),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://etherscan.io',
    visibleInSelector: true,
  },
  {
    id: 747474,
    name: 'Katana',
    shortName: 'katana',
    icon: chainLogo(747474),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://katanascan.com',
    visibleInSelector: true,
  },
  {
    id: 8453,
    name: 'Base',
    shortName: 'base',
    icon: chainLogo(8453),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://basescan.org',
    visibleInSelector: true,
  },
  {
    id: 10,
    name: 'OP Mainnet',
    shortName: 'opt',
    icon: chainLogo(10),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://optimistic.etherscan.io',
    visibleInSelector: true,
  },
  {
    id: 42161,
    name: 'Arbitrum',
    shortName: 'arb',
    icon: chainLogo(42161),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://arbiscan.io',
    visibleInSelector: false,
  },
  {
    id: 137,
    name: 'Polygon',
    shortName: 'pol',
    icon: chainLogo(137),
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    blockExplorer: 'https://polygonscan.com',
    visibleInSelector: false,
  },
];

export const SELECTABLE_CHAINS = SUPPORTED_CHAINS.filter((c) => c.visibleInSelector);

/** yearn.fi's "All Chains" covers only the four chains in its selector, so the
 *  vaults list is scoped to those. Arbitrum and Polygon stay in the fetched
 *  data set: the portfolio scan still finds positions held there. */
export function isSelectableChain(chainId: number): boolean {
  return SELECTABLE_CHAINS.some((chain) => chain.id === chainId);
}

export function getChain(chainId: number): SupportedChain {
  return SUPPORTED_CHAINS.find((c) => c.id === chainId) || SUPPORTED_CHAINS[0];
}

const YBOLD_VAULT = YBOLD_VAULT_ADDRESS.toLowerCase();
const YBOLD_STAKING = YBOLD_STAKING_ADDRESS.toLowerCase();
const YVUSD_UNLOCKED = YVUSD_UNLOCKED_ADDRESS.toLowerCase();
const YVUSD_LOCKED = YVUSD_LOCKED_ADDRESS.toLowerCase();

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

function numberOrNull(value: any): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

interface MapContext {
  stakedYBold?: any;
  lockedYvUsd?: any;
}

/**
 * Display name rule used by yearn.fi: drop the Curve/Aerodrome/Velodrome
 * prefix, turn "… Factory yVault" into "… LP" and strip a bare " yVault".
 */
function formatVaultDisplayName(rawName: string): string {
  const baseName = rawName.replace(/^(curve|aerodrome|velodrome)\s+/i, '');
  if (baseName.includes(' Factory yVault')) {
    return baseName.replace(' Factory yVault', ' LP');
  }
  if (baseName.includes(' yVault')) {
    return baseName.replace(' yVault', '');
  }
  return baseName;
}

function mapVault(v: any, chainId: number, ctx: MapContext = {}): YearnVault {
  const addr = String(v.address).toLowerCase();
  let netAPR = 0;
  let fees = v.apr?.fees;
  let dataAddress: string | undefined;
  let lockedTwin: YearnVault['lockedTwin'];

  if (addr === YBOLD_VAULT && ctx.stakedYBold) {
    // Yearn BOLD shows the staking contract's yield and fees.
    const stakedWeekAgo = Number(ctx.stakedYBold.apr?.points?.weekAgo || 0);
    const stakedNet = Number(ctx.stakedYBold.apr?.netAPR || 0);
    netAPR = stakedWeekAgo > 0 ? stakedWeekAgo : stakedNet > 0 ? stakedNet : 0.131;
    fees = {
      management: 0,
      performance:
        ctx.stakedYBold.apr?.fees?.performance !== undefined
          ? Number(ctx.stakedYBold.apr.fees.performance)
          : 0.1,
    };
    dataAddress = ctx.stakedYBold.address;
  } else if (addr === YVUSD_UNLOCKED && ctx.lockedYvUsd) {
    // yvUSD headline APY is the locked variant's APY.
    const lockedFwd = Number(ctx.lockedYvUsd.apr?.forwardAPR?.netAPR || 0);
    const lockedNet = Number(ctx.lockedYvUsd.apr?.netAPR || 0);
    netAPR = lockedFwd > 0 ? lockedFwd : lockedNet;
    lockedTwin = {
      address: ctx.lockedYvUsd.address,
      netAPR: netAPR || null,
      monthAgo: numberOrNull(ctx.lockedYvUsd.apr?.points?.monthAgo),
      pricePerShare: ctx.lockedYvUsd.pricePerShare,
      tvl: Number(ctx.lockedYvUsd.tvl?.tvl || 0),
    };
  } else {
    // Est. APY prefers forwardAPR when available, else the historical netAPR.
    const fwd = Number(v.apr?.forwardAPR?.netAPR || 0);
    const hist = Number(v.apr?.netAPR || 0);
    netAPR = fwd > 0 ? fwd : hist;
  }

  let computedName = v.name || v.displayName || 'Yearn Vault';
  let category = v.category || v.details?.category || 'General';
  const kind = v.kind || 'Single Strategy';

  computedName = formatVaultDisplayName(computedName);

  if (addr === YBOLD_VAULT) {
    computedName = 'Yearn BOLD';
    category = 'Stablecoin';
  } else if (addr === YVUSD_UNLOCKED) {
    computedName = 'yvUSD';
  }

  // Yearn shows the deposit asset icon as the primary vault icon, except for
  // the handful of vaults that ship their own artwork (see the override map).
  // `token.icon` always stays the deposit asset — the widget renders it next
  // to the deposit token's symbol.
  const tokenIcon = v.token?.icon || v.icon;
  const vaultIcon = VAULT_ICON_OVERRIDES[addr] || tokenIcon;

  return {
    address: v.address,
    type: v.type || 'Yearn Vault',
    kind,
    symbol: v.symbol || v.displaySymbol || 'yVault',
    displaySymbol: v.displaySymbol || v.symbol,
    name: computedName,
    rawName: v.name || v.displayName || computedName,
    displayName: v.displayName || v.name,
    icon: vaultIcon,
    version: v.version || '3.0.0',
    category,
    chainID: chainId,
    decimals: Number(v.decimals || v.token?.decimals || 18),
    description: v.description,
    endorsed: !!v.endorsed,
    boosted: !!v.boosted || !!v.info?.isBoosted,
    emergency_shutdown: !!v.emergency_shutdown,
    featuringScore:
      addr === YVUSD_UNLOCKED
        ? Math.max(numberOrNull(v.featuringScore) ?? 0, 9999)
        : numberOrNull(v.featuringScore) ?? undefined,
    pricePerShare: v.pricePerShare,
    token: {
      address: v.token.address,
      name: v.token.name || v.token.symbol || 'Token',
      symbol: v.token.symbol || 'TOKEN',
      decimals: v.token.decimals || 18,
      icon: tokenIcon,
      description: v.token.description,
    },
    tvl: {
      totalAssets: v.tvl?.totalAssets,
      tvl: Number(v.tvl?.tvl || 0),
      price: Number(v.tvl?.price || 1),
    },
    apr: {
      type: v.apr?.type,
      netAPR,
      fees,
      points: v.apr?.points
        ? {
            weekAgo: numberOrNull(v.apr.points.weekAgo),
            monthAgo: numberOrNull(v.apr.points.monthAgo),
            inception: numberOrNull(v.apr.points.inception),
          }
        : undefined,
      pricePerShare: v.apr?.pricePerShare
        ? {
            today: numberOrNull(v.apr.pricePerShare.today),
            weekAgo: numberOrNull(v.apr.pricePerShare.weekAgo),
            monthAgo: numberOrNull(v.apr.pricePerShare.monthAgo),
          }
        : undefined,
      extra: v.apr?.extra
        ? {
            stakingRewardsAPR: numberOrNull(v.apr.extra.stakingRewardsAPR),
            gammaRewardAPR: numberOrNull(v.apr.extra.gammaRewardAPR),
          }
        : undefined,
      forwardAPR: v.apr?.forwardAPR
        ? {
            type: v.apr.forwardAPR.type,
            netAPR: numberOrNull(v.apr.forwardAPR.netAPR),
            composite: v.apr.forwardAPR.composite,
          }
        : undefined,
    },
    strategies: mapStrategies(v),
    staking: v.staking,
    info: v.info,
    details: v.details,
    lockedTwin,
    dataAddress,
  };
}

/**
 * Fetch all vaults for a specific chain using Yearn's yDaemon.
 */
export async function fetchYearnVaults(chainId: number): Promise<YearnVault[]> {
  try {
    const url = `${YDAEMON_BASE_URL}/${chainId}/vaults/all?limit=2500`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch Yearn vaults: ${res.statusText}`);
    }

    const rawVaults: any[] = await res.json();
    if (!Array.isArray(rawVaults)) {
      return [];
    }

    // Alias vaults that yearn.fi merges into a parent row.
    const ctx: MapContext = {
      stakedYBold: rawVaults.find((v) => v?.address && v.address.toLowerCase() === YBOLD_STAKING),
      lockedYvUsd: rawVaults.find((v) => v?.address && v.address.toLowerCase() === YVUSD_LOCKED),
    };

    return rawVaults
      .filter((v) => {
        if (!v || !v.address || !v.token) return false;
        const addr = v.address.toLowerCase();
        // Merged alias vaults are not listed separately.
        if (addr === YBOLD_STAKING) return false;
        if (addr === YVUSD_LOCKED) return false;
        // Retired vaults stay in the list (they render a "Retired" chip);
        // hidden vaults and the minimum-TVL floor are handled by the list filters.
        if (v.emergency_shutdown) return false;
        return true;
      })
      .map((v) => mapVault(v, chainId, ctx));
  } catch (err) {
    console.error(`[YearnApi] Error fetching vaults for chain ${chainId}:`, err);
    return [];
  }
}

/**
 * Fetch vaults across all supported chains concurrently.
 */
export async function fetchAllChainsVaults(): Promise<YearnVault[]> {
  const promises = SUPPORTED_CHAINS.map((c) => fetchYearnVaults(c.id));
  const results = await Promise.all(promises);
  return results.flat();
}

/** Single vault fetch — used by the detail page for fresh strategies/APR points. */
export async function fetchYearnVault(
  chainId: number,
  address: string
): Promise<YearnVault | null> {
  try {
    const res = await fetch(`${YDAEMON_BASE_URL}/${chainId}/vaults/${address}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const raw = await res.json();
    if (!raw || !raw.address || !raw.token) return null;

    const ctx: MapContext = {};
    const addr = String(raw.address).toLowerCase();
    if (addr === YBOLD_VAULT) {
      ctx.stakedYBold = await fetchRawVault(chainId, YBOLD_STAKING_ADDRESS);
    } else if (addr === YVUSD_UNLOCKED) {
      ctx.lockedYvUsd = await fetchRawVault(chainId, YVUSD_LOCKED_ADDRESS);
    }
    return mapVault(raw, chainId, ctx);
  } catch (err) {
    console.error('[YearnApi] Error fetching vault:', address, err);
    return null;
  }
}

async function fetchRawVault(chainId: number, address: string): Promise<any | null> {
  try {
    const res = await fetch(`${YDAEMON_BASE_URL}/${chainId}/vaults/${address}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
