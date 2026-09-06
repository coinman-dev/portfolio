import { KONG_BASE_URL } from './constants';

export interface TimeseriesPoint {
  /** Unix milliseconds. */
  time: number;
  value: number;
}

export interface TimeseriesSeries {
  component: string;
  points: TimeseriesPoint[];
}

export interface KongRiskScore {
  review: number;
  comment: string;
  testing: number;
  complexity: number;
  riskExposure: number;
  centralizationRisk: number;
  externalProtocolTvl: number;
  protocolIntegration: number;
  externalProtocolType: number;
  externalProtocolAudit: number;
  externalProtocolLongevity: number;
  externalProtocolCentralisation: number;
}

export interface KongCompositionEntry {
  name?: string;
  status?: string;
  address?: string;
  strategy?: string;
  totalDebt?: string;
  currentDebt?: string;
  totalGain?: string;
  totalLoss?: string;
  debtRatio?: number;
  lastReport?: string | number;
  performanceFee?: string | number;
  latestReportApr?: number | null;
  performance?: {
    oracle?: { apr?: number | null; apy?: number | null; netAPY?: number | null };
    estimated?: { apr?: number | null; apy?: number | null; type?: string };
    historical?: { net?: number | null };
  };
}

export interface KongSnapshot {
  chainId: number;
  address: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  apiVersion?: string;
  /** Unix seconds of the vault deployment — the "Deployed on" row. */
  inceptTime?: number;
  inceptBlock?: number;
  pricePerShare?: string | number;
  totalAssets?: string | number;
  risk?: {
    riskLevel?: number;
    riskScore?: KongRiskScore;
  };
  fees?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  strategies?: string[];
  composition?: KongCompositionEntry[];
}

type CacheEntry<T> = { at: number; value: T };

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry<unknown>>();

async function cachedJson<T>(url: string): Promise<T | null> {
  const hit = cache.get(url) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const value = (await res.json()) as T;
    cache.set(url, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.error('[KongApi] request failed:', url, err);
    return null;
  }
}

interface RawPoint {
  time: number | string;
  component?: string;
  value: number | string;
}

function groupSeries(raw: RawPoint[] | null): TimeseriesSeries[] {
  if (!Array.isArray(raw)) return [];
  const grouped = new Map<string, TimeseriesPoint[]>();
  for (const row of raw) {
    const component = row.component || 'value';
    const time = Number(row.time) * 1000;
    const value = Number(row.value);
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    const list = grouped.get(component);
    if (list) list.push({ time, value });
    else grouped.set(component, [{ time, value }]);
  }
  return Array.from(grouped.entries()).map(([component, points]) => ({
    component,
    points: points.sort((a, b) => a.time - b.time),
  }));
}

function timeseriesUrl(
  kind: string,
  chainId: number,
  address: string,
  components: string[]
): string {
  const query = components.map((c) => `components=${encodeURIComponent(c)}`).join('&');
  const suffix = query ? `?${query}` : '';
  return `${KONG_BASE_URL}/api/rest/timeseries/${kind}/${chainId}/${address}${suffix}`;
}

/** Historical net APY. Components: `weeklyNet` (30-day chart), `monthlyNet`. */
export async function fetchApyTimeseries(
  chainId: number,
  address: string,
  components: string[] = ['weeklyNet', 'monthlyNet']
): Promise<TimeseriesSeries[]> {
  const raw = await cachedJson<RawPoint[]>(
    timeseriesUrl('apy-historical', chainId, address, components)
  );
  return groupSeries(raw);
}

/** Price per share, already humanized by Kong. */
export async function fetchPpsTimeseries(
  chainId: number,
  address: string
): Promise<TimeseriesPoint[]> {
  const raw = await cachedJson<RawPoint[]>(
    timeseriesUrl('pps', chainId, address, ['humanized'])
  );
  const series = groupSeries(raw);
  return series[0]?.points || [];
}

/** TVL in USD. */
export async function fetchTvlTimeseries(
  chainId: number,
  address: string
): Promise<TimeseriesPoint[]> {
  const raw = await cachedJson<RawPoint[]>(timeseriesUrl('tvl', chainId, address, []));
  const series = groupSeries(raw);
  return series[0]?.points || [];
}

/** Vault snapshot: deployment time, risk breakdown, live totals. */
export async function fetchVaultSnapshot(
  chainId: number,
  address: string
): Promise<KongSnapshot | null> {
  const raw = await cachedJson<KongSnapshot | KongSnapshot[]>(
    `${KONG_BASE_URL}/api/rest/snapshot/${chainId}/${address}`
  );
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] || null : raw;
}
