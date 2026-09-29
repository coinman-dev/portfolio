/** yearn.fi portfolio history: `/api/holdings/history` (balance) and
 *  `/api/holdings/protocol-return/history` (growth, annualized return, per-vault
 *  growth). Shapes follow the site's `pages/portfolio/types/api.ts`. */

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
 * surfaces as a network error. Worth retrying, unlike an HTTP error status.
 */
export class HoldingsNetworkError extends Error {}

async function getJson(path: string, params: Record<string, string>): Promise<any | null> {
  const query = new URLSearchParams({ ...params, fetchType: 'seq' });
  let res: Response;
  try {
    res = await fetch(`${YEARN_HOLDINGS_API}/${path}?${query}`);
  } catch (err) {
    throw new HoldingsNetworkError(err instanceof Error ? err.message : String(err));
  }
  // "No holdings found for address": the wallet never held a Yearn vault.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
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
