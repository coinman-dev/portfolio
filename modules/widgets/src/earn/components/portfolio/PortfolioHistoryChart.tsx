import React, { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { YearnVault } from '../../types';
import { ChartPeriod } from '../../hooks/useVaultChart';
import { useBalanceHistory, useProtocolReturnHistory } from '../../hooks/usePortfolioHistory';
import {
  BalanceDenomination,
  BalancePoint,
  HoldingsTimeframe,
  ProtocolReturnHistory,
} from '../../holdingsApi';
import { formatAxisDate, formatTooltipDate, formatUSDCents, shortenAddress } from '../../format';
import { ChartDropdown, ChartDropdownOption } from '../charts/ChartDropdown';
import { CHART_PERIODS, formatTick, pickTicks } from '../charts/VaultChart';

/** Port of yearn.fi's `PortfolioHistoryChart` + `PortfolioVaultGrowthChart`. */

type ChartTab = 'balance' | 'growth' | 'annualized' | 'vaults';
type ValueType = 'usd' | 'eth' | 'index' | 'position';
type Unit = 'usd' | 'eth' | 'percent' | 'index';

const CHART_TABS: { id: ChartTab; label: string }[] = [
  { id: 'balance', label: 'Balance' },
  { id: 'growth', label: 'Growth' },
  { id: 'annualized', label: 'Annualized %' },
  { id: 'vaults', label: 'Vault Performance' },
];

const VALUE_OPTIONS: Record<ChartTab, ChartDropdownOption<ValueType>[]> = {
  balance: [
    { id: 'usd', label: 'USD' },
    { id: 'eth', label: 'ETH' },
  ],
  growth: [
    { id: 'index', label: 'Index' },
    { id: 'usd', label: 'USD' },
    { id: 'eth', label: 'ETH' },
  ],
  annualized: [],
  vaults: [
    { id: 'position', label: 'Position' },
    { id: 'index', label: 'Index' },
  ],
};

/** yearn.fi keeps the last N daily points rather than cutting by date. */
const TIMEFRAME_POINTS: Record<ChartPeriod, number> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
  all: Number.MAX_SAFE_INTEGER,
};

const LINE_COLOR = '#2578ff';
const SERIES_COLORS = ['#46a2ff', '#94adf2', '#7bb3a8', '#e1a23b', '#b67ae5'];
const MAX_VAULT_SERIES = 5;
const CHART_HEIGHT = 260;

interface Row {
  time: number;
  /** `MM/DD/YY` — categorical X key, as on the vault charts. */
  date: string;
  [series: string]: number | string | null;
}

interface Series {
  key: string;
  name: string;
  color: string;
}

interface ChartModel {
  rows: Row[];
  series: Series[];
  unit: Unit;
  /** Growth and returns carry a `+` sign in tooltips. */
  signed: boolean;
  /** Y axis starts here: 0, or 100 for growth indices. */
  floor: number;
}

/** API days are UTC calendar days; noon keeps them on the same local date. */
function makeRow(isoDay: string): Row {
  const [year, month, day] = isoDay.split('-').map(Number);
  const time = Date.UTC(year, month - 1, day, 12);
  return { time, date: formatAxisDate(time) };
}

const isoDayOf = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

const takeLast = <T,>(items: T[], count: number) =>
  items.length > count ? items.slice(items.length - count) : items;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function singleSeries(
  points: { date: string; value: number | null }[],
  unit: Unit,
  signed: boolean,
  floor = 0
): ChartModel {
  const rows = points.map((point) => ({ ...makeRow(point.date), value: point.value }));
  return { rows, series: [{ key: 'value', name: '', color: LINE_COLOR }], unit, signed, floor };
}

function balanceModel(
  history: BalancePoint[],
  denomination: BalanceDenomination,
  liveTotalUsd: number,
  limit: number
): ChartModel {
  const points = history.map((point) => ({ date: point.date, value: point.value }));
  // yearn.fi puts today's live wallet total on top of the settled days.
  if (denomination === 'usd' && points.length > 0 && liveTotalUsd > 0) {
    const today = new Date().toISOString().slice(0, 10);
    if (points[points.length - 1].date === today) points.pop();
    points.push({ date: today, value: liveTotalUsd });
  }
  return singleSeries(takeLast(points, limit), denomination, false);
}

function growthModel(history: ProtocolReturnHistory, valueType: ValueType, limit: number): ChartModel {
  const points = takeLast(history.dataPoints, limit);
  if (valueType === 'index') {
    const base = points.find((point) => isNumber(point.growthIndex) && point.growthIndex !== 0)
      ?.growthIndex as number | undefined;
    return singleSeries(
      points.map((point) => ({
        date: point.date,
        value: base && isNumber(point.growthIndex) ? (point.growthIndex / base) * 100 : null,
      })),
      'index',
      false,
      100
    );
  }
  const read = (point: (typeof points)[number]) =>
    valueType === 'eth' ? point.growthWeightEth : point.growthWeightUsd;
  const first = points.map(read).find(isNumber) ?? 0;
  return singleSeries(
    points.map((point) => {
      const value = read(point);
      return { date: point.date, value: isNumber(value) ? value - first : null };
    }),
    valueType === 'eth' ? 'eth' : 'usd',
    true
  );
}

function annualizedModel(history: ProtocolReturnHistory, limit: number): ChartModel {
  return singleSeries(
    takeLast(history.dataPoints, limit).map((point) => ({
      date: point.date,
      value: point.annualizedProtocolReturnPct,
    })),
    'percent',
    true
  );
}

/** yBOLD and its staking vault are separate on the server; tell them apart. */
function vaultLabel(vaults: YearnVault[], chainId: number, address: string, symbol: string | null) {
  const addr = address.toLowerCase();
  for (const vault of vaults) {
    if (vault.chainID !== chainId) continue;
    if (vault.address.toLowerCase() === addr) return vault.name;
    if (vault.dataAddress?.toLowerCase() === addr) return `${vault.name} (staked)`;
  }
  return symbol || shortenAddress(address);
}

function vaultsModel(
  history: ProtocolReturnHistory,
  vaults: YearnVault[],
  valueType: ValueType,
  limit: number
): ChartModel {
  const days = takeLast(history.dataPoints, limit).map((point) => point.date);
  const rows = days.map(makeRow);
  const isIndex = valueType === 'index';

  const ranked = history.familySeries
    .map((family) => {
      const byDay = new Map(family.dataPoints.map((point) => [isoDayOf(point.timestamp), point]));
      let base: number | null = null;
      let carried: number | null = null;
      const values = days.map((day) => {
        const point = byDay.get(day);
        const raw = isIndex ? point?.growthIndex : point?.growthWeightUsd;
        if (isIndex) {
          if (base === null && isNumber(raw) && raw !== 0) base = raw;
          return base !== null && isNumber(raw) ? (raw / base) * 100 : null;
        }
        // Position mode carries the last known value across gaps.
        if (isNumber(raw)) {
          if (base === null) base = raw;
          carried = raw - base;
        }
        return carried;
      });
      const known = values.filter(isNumber);
      const score = known.length ? known[known.length - 1] - known[0] : 0;
      return { family, values, score };
    })
    .filter((entry) => Math.abs(entry.score) > 1e-6)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_VAULT_SERIES);

  const series: Series[] = ranked.map(({ family }, index) => ({
    key: `s${index}`,
    name: vaultLabel(vaults, family.chainId, family.vaultAddress, family.symbol),
    color: SERIES_COLORS[index % SERIES_COLORS.length],
  }));
  ranked.forEach(({ values }, index) => {
    values.forEach((value, day) => {
      rows[day][`s${index}`] = value;
    });
  });

  return {
    rows: series.length ? rows : [],
    series,
    unit: isIndex ? 'index' : 'usd',
    signed: !isIndex,
    floor: isIndex ? 100 : 0,
  };
}

/** Smallest of 1, 2, 2.5, 5, 10 × 10^k that is at least `raw`. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const multiple of [1, 2, 2.5, 5, 10]) {
    if (multiple * magnitude >= raw) return multiple * magnitude;
  }
  return 10 * magnitude;
}

/** yearn.fi's `buildNonNegativeEvenTicks`: five even ticks from the floor with
 *  5% headroom. Anything below the floor falls back to Recharts' auto domain. */
function evenTicks(model: ChartModel): number[] | undefined {
  const values = model.rows.flatMap((row) => model.series.map((s) => row[s.key])).filter(isNumber);
  if (!values.length || values.some((value) => value < model.floor)) return undefined;
  const max = Math.max(...values);
  const step = niceStep(((max - model.floor) * 1.05) / 4 || Math.abs(model.floor) * 0.01 || 1);
  return [0, 1, 2, 3, 4].map((i) => Number((model.floor + i * step).toPrecision(12)));
}

function compact(value: number, digits: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(digits);
}

function formatAxisValue(unit: Unit, value: number): string {
  const abs = Math.abs(value);
  if (unit === 'usd') return `${value < 0 ? '-' : ''}$${compact(abs, 0)}`;
  if (unit === 'eth') return abs >= 1_000 ? compact(value, 1) : value.toFixed(abs >= 10 ? 0 : 2);
  if (unit === 'percent') return `${value.toFixed(abs >= 1_000 ? 0 : abs >= 10 ? 1 : 2)}%`;
  return value.toFixed(1);
}

function formatTooltipValue(unit: Unit, value: number, signed: boolean): string {
  const sign = signed && value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (unit === 'usd') return `${sign}${formatUSDCents(abs)}`;
  if (unit === 'eth') return `${sign}${abs.toFixed(4)} ETH`;
  if (unit === 'percent') return `${sign}${abs.toFixed(2)}%`;
  return value.toFixed(2);
}

const HistoryTooltip: React.FC<any> = ({ active, payload, model }) => {
  if (!active || !payload?.length) return null;
  const { unit, signed } = model as ChartModel;
  return (
    <div className="y-chart-tooltip">
      <p className="y-chart-tooltip__title">
        {formatTooltipDate(Number(payload[0]?.payload?.time)).toUpperCase()}
      </p>
      {payload
        .filter((entry: any) => isNumber(entry.value))
        .map((entry: any) => (
          <p className="y-chart-tooltip__row" key={entry.dataKey}>
            <span className="y-chart-tooltip__swatch" style={{ background: entry.color }} />
            {entry.name && <span className="y-chart-tooltip__label">{entry.name}</span>}
            <span className="y-chart-tooltip__value">
              {formatTooltipValue(unit, Number(entry.value), signed)}
            </span>
          </p>
        ))}
    </div>
  );
};

interface PortfolioHistoryChartProps {
  address: string;
  vaults: YearnVault[];
  /** Live wallet total, drawn as today's Balance point. */
  liveTotalUsd: number;
}

export const PortfolioHistoryChart: React.FC<PortfolioHistoryChartProps> = ({
  address,
  vaults,
  liveTotalUsd,
}) => {
  const [tab, setTab] = useState<ChartTab>('balance');
  const [timeframe, setTimeframe] = useState<ChartPeriod>('1y');
  const [chosen, setChosen] = useState<Partial<Record<ChartTab, ValueType>>>({});

  const fetchTimeframe: HoldingsTimeframe = timeframe === 'all' ? 'all' : '1y';
  const denomination = (chosen.balance ?? 'usd') as BalanceDenomination;
  const balance = useBalanceHistory(address, denomination, fetchTimeframe, tab === 'balance');
  const protocol = useProtocolReturnHistory(address, fetchTimeframe, tab !== 'balance');

  const hasEthGrowth = protocol.data?.dataPoints.some((p) => p.growthWeightEth !== null) ?? false;
  const recommended = protocol.data?.recommendedGrowthDisplay ?? 'usd';
  const defaults: Record<ChartTab, ValueType> = {
    balance: 'usd',
    growth: recommended === 'eth' && !hasEthGrowth ? 'index' : recommended,
    annualized: 'usd',
    vaults: 'index',
  };
  const valueType = chosen[tab] ?? defaults[tab];
  const valueOptions =
    tab === 'growth' && !hasEthGrowth
      ? VALUE_OPTIONS.growth.filter((option) => option.id !== 'eth')
      : VALUE_OPTIONS[tab];

  const query = tab === 'balance' ? balance : protocol;
  const limit = TIMEFRAME_POINTS[timeframe];

  const model = useMemo<ChartModel | null>(() => {
    if (tab === 'balance') {
      return balance.data ? balanceModel(balance.data, denomination, liveTotalUsd, limit) : null;
    }
    if (!protocol.data) return null;
    if (tab === 'growth') return growthModel(protocol.data, valueType, limit);
    if (tab === 'annualized') return annualizedModel(protocol.data, limit);
    return vaultsModel(protocol.data, vaults, valueType, limit);
  }, [tab, balance.data, protocol.data, denomination, liveTotalUsd, limit, valueType, vaults]);

  const renderBody = () => {
    if (query.isLoading) {
      return <div className="y-chart-loading" style={{ height: CHART_HEIGHT }} />;
    }
    if (query.isError) {
      return (
        <div className="y-chart-empty" style={{ height: CHART_HEIGHT }}>
          <p>Chart unavailable</p>
          <span>Unable to load your portfolio history right now.</span>
        </div>
      );
    }
    if (!model || model.rows.length === 0) {
      return (
        <div className="y-chart-empty" style={{ height: CHART_HEIGHT }}>
          <p>No history yet</p>
          <span>Once you have a deposit, your portfolio history will appear here.</span>
        </div>
      );
    }

    const isShort = timeframe === '30d';
    const ticks = evenTicks(model);
    const single = model.series.length === 1 && model.series[0].key === 'value';
    const gradientId = `y-pf-chart-gradient-${tab}`;

    return (
      <div className="y-chart" style={{ height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={model.rows} margin={{ top: 20, right: 8, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={LINE_COLOR} stopOpacity={0.5} />
                <stop offset="95%" stopColor={LINE_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--y-chart-grid)" />
            <XAxis
              dataKey="date"
              ticks={pickTicks(model.rows, isShort)}
              tickFormatter={(value) => formatTick(String(value), isShort)}
              tick={{ fill: 'var(--y-chart-axis)', fontSize: 12 }}
              axisLine={{ stroke: 'var(--y-chart-axis)' }}
              tickLine={{ stroke: 'var(--y-chart-axis)' }}
            />
            <YAxis
              mirror
              width={12}
              ticks={ticks}
              domain={ticks ? [ticks[0], ticks[ticks.length - 1]] : ['auto', 'auto']}
              tick={{ fill: 'var(--y-chart-axis)', fontSize: 12, textAnchor: 'start', dx: 6 }}
              tickFormatter={(value, index) =>
                (ticks && index === 0) || Number(value) === 0
                  ? ''
                  : formatAxisValue(model.unit, Number(value))
              }
              tickMargin={0}
              axisLine={{ stroke: 'var(--y-chart-axis)' }}
              tickLine={{ stroke: 'var(--y-chart-axis)' }}
            />
            <Tooltip content={<HistoryTooltip model={model} />} cursor={{ stroke: 'var(--y-border)' }} />
            {single && (
              <Area
                type="monotone"
                dataKey="value"
                stroke="none"
                fill={`url(#${gradientId})`}
                fillOpacity={1}
                connectNulls
                tooltipType="none"
                isAnimationActive={false}
              />
            )}
            {model.series.map((series) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.name}
                stroke={series.color}
                strokeWidth={2}
                strokeOpacity={single ? 1 : 0.9}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        {!single && (
          <div className="y-chart-legend">
            {model.series.map((series) => (
              <span className="y-chart-legend__item" key={series.key}>
                <span className="y-chart-legend__line" style={{ borderColor: series.color }} />
                {series.name}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="y-pf-chart">
      <div className="y-vd-chart__bar">
        <div className="y-vd-chart__tabs" role="tablist" aria-label="Portfolio chart">
          {CHART_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`y-vd-chart__tab${tab === item.id ? ' is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="y-pf-chart__controls">
          <ChartDropdown
            value={timeframe}
            options={CHART_PERIODS}
            onChange={setTimeframe}
            ariaLabel="Chart timeframe"
          />
          {valueOptions.length > 0 && (
            <ChartDropdown
              value={valueType}
              options={valueOptions}
              onChange={(next) => setChosen((prev) => ({ ...prev, [tab]: next }))}
              ariaLabel="Asset value type"
            />
          )}
        </div>
      </div>
      {renderBody()}
    </div>
  );
};
