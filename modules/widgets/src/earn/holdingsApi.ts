/** yearn.fi holdings API: `/api/holdings/history` (balance),
 *  `/api/holdings/protocol-return/history` (growth, annualized return, per-vault
 *  growth) and `/api/holdings/activity` (transactions). Shapes follow the site's
 *  `pages/portfolio/types/api.ts`. */

import { YEARN_HOLDINGS_API } from './constants';

/** The API knows only these two; 30D/90D/1Y are cut from `1y` client-side. */
export type HoldingsTimeframe = '1y' | 'all';
export type BalanceDenomination = 'usd' | 'eth';
export type GrowthDisplay = 'usd' | 'eth' | 'index';

/** One settled UTC day, valued at 23:59:59. */
export interface BalancePoint {
  date: string;
  value: number;
}

export interface ProtocolReturnPoint {
  date: string;
  timestamp: number;
  growthWeightUsd: number;
  growthWeightEth: number | null;
  protocolReturnPct: number | null;
  annualizedProtocolReturnPct: number | null;
  growthIndex: number | null;
}

export interface VaultGrowthSeries {
  chainId: number;
  vaultAddress: string;
  symbol: string | null;
  dataPoints: { timestamp: number; growthWeightUsd: number | null; growthIndex: number | null }[];
}

export interface ProtocolReturnHistory {
  recommendedGrowthDisplay: GrowthDisplay;
  dataPoints: ProtocolReturnPoint[];
  familySeries: VaultGrowthSeries[];
}

/**
 * The request never got an HTTP response the webview could read. That covers
 * Vercel's 60s timeout on large wallets: its 504 carries no CORS headers, so it
 * surfaces as a network error.
 */
export class HoldingsNetworkError extends Error {}

export class HoldingsHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Network failures, rate limiting and server errors are transient; other 4xx are not. */
export function isRetryableHoldingsError(error: unknown): boolean {
  if (error instanceof HoldingsNetworkError) return true;
  return error instanceof HoldingsHttpError && (error.status === 429 || error.status >= 500);
}

async function getJson(
  path: string,
  params: Record<string, string>,
  extra: Record<string, string> = { fetchType: 'seq' }
): Promise<any | null> {
  const query = new URLSearchParams({ ...params, ...extra });
  let res: Response;
  try {
    res = await fetch(`${YEARN_HOLDINGS_API}/${path}?${query}`);
  } catch (err) {
    throw new HoldingsNetworkError(err instanceof Error ? err.message : String(err));
  }
  // "No holdings found for address": the wallet never held a Yearn vault.
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new HoldingsHttpError(res.status, body?.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchBalanceHistory(
  address: string,
  denomination: BalanceDenomination,
  timeframe: HoldingsTimeframe
): Promise<BalancePoint[]> {
  const body = await getJson('history', { address, denomination, timeframe });
  return Array.isArray(body?.dataPoints) ? body.dataPoints : [];
}

export type ActivityAction = 'deposit' | 'withdraw' | 'stake' | 'unstake' | 'transfer' | 'swap';

export interface ActivityEntry {
  chainId: number;
  txHash: string;
  /** Unix seconds. */
  timestamp: number;
  action: ActivityAction;
  displayType?: 'reward_claim' | 'zap' | null;
  transferDirection: 'in' | 'out' | null;
  /** Lowercase. */
  vaultAddress: string;
  /** Lowercase; a staking wrapper's underlying vault, else `vaultAddress`. */
  familyVaultAddress: string;
  assetSymbol: string | null;
  assetAmount: string;
  assetAmountFormatted: number | null;
  inputTokenAddress: string | null;
  inputTokenSymbol: string | null;
  inputTokenAmount: string | null;
  inputTokenAmountFormatted: number | null;
  outputTokenAddress: string | null;
  outputTokenSymbol: string | null;
  outputTokenAmount: string | null;
  outputTokenAmountFormatted: number | null;
  shareAmount: string;
  shareAmountFormatted: number | null;
  status: 'ok' | 'missing_metadata';
}

/** Server-side filters. The API takes a single `type`; vault and text search
 *  do not exist there and are applied by the caller. */
export interface ActivityFilters {
  type?: ActivityAction;
  chainId?: number;
  /** Unix seconds, inclusive. */
  startTimestamp?: number;
  endTimestamp?: number;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  nextOffset: number | null;
}

/** Newest first. Pages are offset-based; `nextOffset` is null on the last one. */
export async function fetchActivityPage(
  address: string,
  filters: ActivityFilters,
  offset: number,
  limit: number
): Promise<ActivityPage> {
  const params: Record<string, string> = {
    address,
    limit: String(limit),
    offset: String(offset),
    type: filters.type ?? 'all',
    version: 'all',
  };
  if (filters.chainId) params.chainId = String(filters.chainId);
  if (filters.startTimestamp !== undefined) params.startTimestamp = String(filters.startTimestamp);
  if (filters.endTimestamp !== undefined) params.endTimestamp = String(filters.endTimestamp);

  const body = await getJson('activity', params, {});
  const nextOffset = body?.pageInfo?.hasMore ? (body.pageInfo.nextOffset ?? null) : null;
  return { entries: Array.isArray(body?.entries) ? body.entries : [], nextOffset };
}

/** Chains the wallet has any Yearn activity on — feeds the chain filter. */
export async function fetchActivityChainIds(address: string): Promise<number[]> {
  const body = await getJson('activity-facets', { address, version: 'all' }, {});
  const ids = body?.facets?.chainIds;
  return Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : [];
}

export async function fetchProtocolReturnHistory(
  address: string,
  timeframe: HoldingsTimeframe
): Promise<ProtocolReturnHistory> {
  const body = await getJson('protocol-return/history', { address, timeframe });
  return {
    recommendedGrowthDisplay: body?.summary?.recommendedGrowthDisplay ?? 'usd',
    dataPoints: Array.isArray(body?.dataPoints) ? body.dataPoints : [],
    familySeries: Array.isArray(body?.familySeries) ? body.familySeries : [],
  };
}
