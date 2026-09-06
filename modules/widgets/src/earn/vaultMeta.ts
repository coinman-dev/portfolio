/** Vault classification and copy, ported 1:1 from yearn.fi.
 *
 * Sources: the site's own chunks (`deriveListKind`, `deriveAssetCategory`,
 * `getChainDescription`, `getCategoryDescription`, `getProductTypeDescription`,
 * `getKindDescription`, `formatFeeStructureLabel`) — the wording below is the
 * verbatim copy shown on yearn.fi.
 */

import { YearnVault } from './types';
import { getChain } from './yearnApi';

export type ListKind = 'allocator' | 'strategy' | 'factory' | 'legacy';
export type ProductType = 'v3' | 'lp';
export type AssetCategory = 'Stablecoin' | 'Volatile';
export type Aggressiveness = 'Conservative' | 'Moderate' | 'Aggressive';

const STABLE_SYMBOLS = new Set([
  'USDC', 'USDT', 'DAI', 'DUSD', 'FRAX', 'LUSD', 'TUSD', 'USDE', 'SUSDE', 'GHO',
  'CRVUSD', 'USD0', 'PYUSD', 'USDP', 'SDAI', 'AUSD', 'BOLD',
]);

/** Vaults the site force-classifies as allocators. */
const ALLOCATOR_OVERRIDES = new Set(['1:0x27b5739e22ad9033bcbf192059122d163b60349d']);

const CHAIN_DESCRIPTIONS: Record<number, string> = {
  1: 'Ethereum mainnet is the heart of the Ethereum ecosystem. Good liquidity and security, but transaction fees can be higher.',
  10: 'Optimism is the coordination layer of the "SuperChain". It is an optimistic rollup on Ethereum with lower fees and fast confirmations.',
  137: 'Polygon is a PoS sidechain to Ethereum with low fees and fast blocks.',
  42161: 'Arbitrum is an optimistic rollup on Ethereum with low fees and high throughput.',
  8453: "Base is an Coinbase's Ethereum L2 built on the OP Stack with low fees and fast confirmations.",
  747474: 'Katana is a DeFi focused zk-rollup chain with an innovative liquidity flywheel, low fees, and fast confirmations.',
};

const CHAIN_WEBSITES: Record<number, string> = {
  1: 'https://ethereum.org',
  10: 'https://www.optimism.io/',
  137: 'https://polygon.technology/',
  42161: 'https://offchainlabs.com/#arbitrum-one',
  8453: 'https://base.org/',
  747474: 'https://katana.network',
};

export const RETIRED_TAG_DESCRIPTION = 'Deposits are disabled; withdrawals remain available.';
export const MIGRATABLE_TAG_DESCRIPTION = 'A retired vault with a migration path available to a newer vault.';
export const HIDDEN_TAG_DESCRIPTION = 'Hidden from the default list. Enable hidden vaults to view.';
export const NOT_YEARN_TAG_DESCRIPTION = 'This vault is not managed by Yearn. Review the issuer and risks carefully.';
export const FEE_CHIP_DESCRIPTION = 'Filter vaults with this same management and performance fee structure.';

export const NO_DESCRIPTION_TEXT =
  "Sorry, we don't have a description for this vault right now. To learn more about how Yearn Vaults work, check out our docs, or if you want to learn more about this vault, head to our discord or telegram and ask.";

export function getChainDescription(chainId: number): string {
  return CHAIN_DESCRIPTIONS[chainId] || `${getChain(chainId).name} network.`;
}

export function getChainWebsite(chainId: number): string | null {
  return CHAIN_WEBSITES[chainId] || null;
}

export function getCategoryDescription(category?: string | null): string | null {
  if (!category) return null;
  const key = category.toLowerCase();
  if (key === 'stablecoin') {
    return 'This vault holds a USD-pegged or USD-targeted asset designed to maintain its price.';
  }
  if (key === 'volatile') {
    return 'This vault holds an asset whose price fluctuates due to market-driven events.';
  }
  return `${category} asset category.`;
}

export function getProductTypeDescription(listKind: ListKind): string {
  if (listKind === 'legacy') {
    return 'These vaults use a Legacy Yearn vault architecture. They were previously called "v2 Vaults").';
  }
  if (listKind === 'factory') {
    return 'LP token vaults auto-compound fees and incentives from liquidity positions. They were previously called "v2 Factory Vaults".';
  }
  return 'Single-asset vaults accept one token and allocate it across strategies. They were previously called "v3 Vaults".';
}

export function getKindDescription(kind?: 'multi' | 'single', label?: string): string {
  if (kind === 'multi') return 'Allocator vaults route deposits across multiple strategies.';
  if (kind === 'single') {
    return 'Strategy vaults contain a single active strategy and are allocated to by Allocator vaults.';
  }
  return label ? `${label} vault classification from Yearn.` : 'Vault strategy classification from Yearn.';
}

export const PRODUCT_KIND_LABELS: Record<ListKind, string> = {
  allocator: 'Allocator',
  strategy: 'Strategy',
  factory: 'Factory',
  legacy: 'Legacy',
};

export function deriveListKind(vault: YearnVault): ListKind {
  const key = `${vault.chainID}:${vault.address.toLowerCase()}`;
  if (ALLOCATOR_OVERRIDES.has(key)) return 'allocator';

  const version = String(vault.version || '');
  const isV3 = version.startsWith('3') || version.startsWith('~3');
  const kind = vault.kind || '';
  if (isV3) return kind === 'Multi Strategy' ? 'allocator' : 'strategy';

  const name = String(vault.rawName || vault.name || '').toLowerCase();
  if (name.includes('factory')) return 'factory';
  if (String(vault.type || '') === 'Automated Yearn Vault') return 'factory';
  return 'legacy';
}

export function deriveAssetCategory(vault: YearnVault): AssetCategory {
  const category = vault.category;
  if (category === 'Stablecoin' || category === 'Volatile') return category;

  const symbol = String(vault.token?.symbol || '').toUpperCase();
  if (STABLE_SYMBOLS.has(symbol)) return 'Stablecoin';

  const haystack = `${vault.name} ${vault.symbol} ${vault.token?.name} ${vault.token?.symbol}`.toUpperCase();
  for (const stable of STABLE_SYMBOLS) {
    if (haystack.includes(stable)) return 'Stablecoin';
  }
  return 'Volatile';
}

export function deriveAggressiveness(vault: YearnVault): Aggressiveness | null {
  const risk = vault.info?.riskLevel;
  if (typeof risk !== 'number') return null;
  if (risk <= 1) return 'Conservative';
  if (risk === 2) return 'Moderate';
  if (risk === 3) return 'Aggressive';
  return null;
}

export interface ProductTypeInfo {
  productType: ProductType;
  label: string;
  ariaLabel: string;
  isLegacy: boolean;
}

export function getProductTypeInfo(vault: YearnVault): ProductTypeInfo {
  const listKind = deriveListKind(vault);
  if (listKind === 'allocator' || listKind === 'strategy') {
    return {
      productType: 'v3',
      label: 'Single Asset',
      ariaLabel: 'Show single asset vaults',
      isLegacy: false,
    };
  }
  if (listKind === 'legacy') {
    return { productType: 'lp', label: 'Legacy', ariaLabel: 'Legacy vault', isLegacy: true };
  }
  return { productType: 'lp', label: 'LP Token', ariaLabel: 'Show LP token vaults', isLegacy: false };
}

/** `multi` / `single` — used for the Allocator / Strategy label. */
export function getStrategyKind(vault: YearnVault): 'multi' | 'single' | undefined {
  const kind = vault.kind;
  if (kind === 'Multi Strategy') return 'multi';
  if (kind === 'Single Strategy') return 'single';
  const listKind = deriveListKind(vault);
  if (listKind === 'allocator') return 'multi';
  if (listKind === 'strategy') return 'single';
  return undefined;
}

export function getStrategyKindLabel(vault: YearnVault): string | undefined {
  const kind = getStrategyKind(vault);
  if (kind === 'multi') return 'Allocator';
  if (kind === 'single') return 'Strategy';
  return vault.kind || undefined;
}

/** `Single Asset | Allocator`, `LP Token | Legacy` */
export function getVaultTypeLabel(vault: YearnVault, showKind = true): string {
  const { label } = getProductTypeInfo(vault);
  const kindLabel = showKind ? getStrategyKindLabel(vault) : undefined;
  return [label, kindLabel].filter(Boolean).join(' | ');
}

/** yearn.fi normalises fees to basis points before rendering them. */
function feeToBps(value?: number | null): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  return Math.max(0, Math.round(10000 * (value > 1 ? value / 10000 : value)));
}

function bpsToPercentLabel(bps: number): string {
  const percent = bps / 100;
  const rounded = Math.round(percent * 100) / 100;
  return `${rounded}%`;
}

export function getFeeStructureKey(fees?: { management?: number; performance?: number }): string {
  return `${feeToBps(fees?.management)}:${feeToBps(fees?.performance)}`;
}

/** `Fees: 0% | 10%` */
export function formatFeeStructureLabel(fees?: { management?: number; performance?: number }): string {
  return `Fees: ${bpsToPercentLabel(feeToBps(fees?.management))} | ${bpsToPercentLabel(
    feeToBps(fees?.performance)
  )}`;
}

export function formatFeeStructureAriaLabel(fees?: {
  management?: number;
  performance?: number;
}): string {
  return `Filter by ${bpsToPercentLabel(feeToBps(fees?.management))} management fee and ${bpsToPercentLabel(
    feeToBps(fees?.performance)
  )} performance fee`;
}

/** `0% Management Fee | 10% Performance Fee` */
export function formatFeeDetailLabel(fees?: {
  management?: number;
  performance?: number;
}): { management: string; performance: string } {
  return {
    management: bpsToPercentLabel(feeToBps(fees?.management)),
    performance: bpsToPercentLabel(feeToBps(fees?.performance)),
  };
}

export function getVaultKey(vault: YearnVault): string {
  return `${vault.chainID}_${vault.address.toLowerCase()}`;
}

/**
 * Est. APY as shown in the list, on the detail page and in portfolio metrics:
 * yvUSD reports its locked twin's rate, everything else prefers forward APR.
 */
export function getHeadlineAPY(vault: YearnVault): number {
  if (vault.lockedTwin) return vault.lockedTwin.netAPR ?? 0;
  return vault.apr?.forwardAPR?.netAPR || vault.apr?.netAPR || 0;
}

/** 30-day APY (`apr.points.monthAgo`), with the same yvUSD locked-twin rule. */
export function getMonthAgoAPY(vault: YearnVault): number | null {
  if (vault.lockedTwin) return vault.lockedTwin.monthAgo ?? null;
  const value = vault.apr?.points?.monthAgo;
  return value === undefined || value === null ? null : value;
}
