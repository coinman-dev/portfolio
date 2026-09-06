import { useEffect, useState } from 'react';
import { YearnVault } from '../types';
import { fetchApyTimeseries, fetchPpsTimeseries, fetchTvlTimeseries } from '../kongApi';
import { formatAxisDate } from '../format';

export type ChartKind = 'apy' | 'performance' | 'tvl';
export type ChartPeriod = '30d' | '90d' | '1y' | 'all';

export interface ChartPoint {
  time: number;
  /** `MM/DD/YY` — used as the categorical X dataKey, matching yearn.fi. */
  date: string;
  unlocked: number | null;
  locked: number | null;
}

export interface VaultChartData {
  points: ChartPoint[];
  isLoading: boolean;
  hasLocked: boolean;
}

const DAY_MS = 86_400_000;

/** yearn.fi slices by point count, not by timestamp. */
const TIMEFRAME_LIMITS: Record<ChartPeriod, number> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
  all: Number.MAX_SAFE_INTEGER,
};

type Series = { time: number; value: number }[];

async function loadSeries(chainId: number, address: string, kind: ChartKind): Promise<Series> {
  if (kind === 'tvl') return fetchTvlTimeseries(chainId, address);
  if (kind === 'performance') return fetchPpsTimeseries(chainId, address);
  const series = await fetchApyTimeseries(chainId, address);
  const monthly = series.find((s) => s.component === 'monthlyNet');
  const weekly = series.find((s) => s.component === 'weeklyNet');
  // yearn.fi charts APY in percent units, which drives the Y axis tick steps.
  return ((monthly || weekly)?.points || []).map((point) => ({
    time: point.time,
    value: point.value * 100,
  }));
}

/**
 * yvUSD locked shares are denominated in unlocked yvUSD, so the locked vault's
 * value per share is the product of both price-per-share series.
 */
function composeLockedPps(locked: Series, unlocked: Series): Series {
  const unlockedByDay = indexByDay(unlocked);
  return locked
    .map((point) => {
      const day = Math.floor(point.time / DAY_MS) * DAY_MS;
      const base = unlockedByDay.get(day);
      if (!base || !point.value) return null;
      return { time: point.time, value: point.value * base };
    })
    .filter(Boolean) as Series;
}

/** 30-day APY derived from a price-per-share series, in percent. */
function deriveThirtyDayApy(series: Series): Series {
  return series
    .map((point, index) => {
      const previous = series[index - 30];
      if (!previous || previous.value <= 0) return null;
      const apr = ((point.value - previous.value) / previous.value) * (365 / 30);
      return { time: point.time, value: apr * 100 };
    })
    .filter(Boolean) as Series;
}

/** Loads the locked twin series, composing it with the unlocked one for yvUSD. */
async function loadLockedSeries(
  chainId: number,
  lockedAddress: string,
  unlocked: Series,
  kind: ChartKind
): Promise<Series> {
  if (kind === 'tvl') return fetchTvlTimeseries(chainId, lockedAddress);
  const lockedPps = composeLockedPps(await fetchPpsTimeseries(chainId, lockedAddress), unlocked);
  return kind === 'performance' ? lockedPps : deriveThirtyDayApy(lockedPps);
}

function indexByDay(series: { time: number; value: number }[]): Map<number, number> {
  const byDay = new Map<number, number>();
  for (const point of series) {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.value)) continue;
    byDay.set(Math.floor(point.time / DAY_MS) * DAY_MS, point.value);
  }
  return byDay;
}

/**
 * Builds a gap-free daily grid across both series, mirroring yearn.fi's
 * `fillMissingDailyData` so missing days render as breaks instead of shortcuts.
 */
function mergeSeries(
  unlocked: { time: number; value: number }[],
  locked: { time: number; value: number }[] | null
): ChartPoint[] {
  const unlockedByDay = indexByDay(unlocked);
  const lockedByDay = indexByDay(locked || []);
  const days = [...unlockedByDay.keys(), ...lockedByDay.keys()];
  if (!days.length) return [];

  const earliest = Math.min(...days);
  const latest = Math.max(...days);
  const count = Math.floor((latest - earliest) / DAY_MS) + 1;

  const points: ChartPoint[] = [];
  for (let i = 0; i < count; i++) {
    const time = earliest + i * DAY_MS;
    points.push({
      time,
      date: formatAxisDate(time),
      unlocked: unlockedByDay.get(time) ?? null,
      locked: lockedByDay.get(time) ?? null,
    });
  }
  return points;
}

/** Kong timeseries for a vault, merged with the yvUSD locked twin when present. */
export function useVaultChart(
  vault: YearnVault | null,
  kind: ChartKind,
  period: ChartPeriod = 'all'
): VaultChartData {
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const chainId = vault?.chainID;
  const address = vault?.dataAddress || vault?.address;
  const lockedAddress = vault?.lockedTwin?.address;

  useEffect(() => {
    let cancelled = false;
    if (!chainId || !address) {
      setPoints([]);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);
    loadSeries(chainId, address, kind)
      .then(async (main) => {
        if (!lockedAddress) return { main, locked: null as Series | null };
        // The locked APY/PPS series need the unlocked PPS as their base.
        const base = kind === 'performance' ? main : await fetchPpsTimeseries(chainId, address);
        return { main, locked: await loadLockedSeries(chainId, lockedAddress, base, kind) };
      })
      .then(({ main, locked }) => {
        if (cancelled) return;
        setPoints(mergeSeries(main, locked));
      })
      .catch(() => {
        if (!cancelled) setPoints([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chainId, address, lockedAddress, kind]);

  const limit = TIMEFRAME_LIMITS[period] ?? Number.MAX_SAFE_INTEGER;
  const filtered = limit >= points.length ? points : points.slice(-limit);

  return { points: filtered, isLoading, hasLocked: !!lockedAddress };
}
