import React from 'react';
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
import { ChartKind, ChartPeriod, ChartPoint } from '../../hooks/useVaultChart';
import { formatUSDFull, formatTooltipDate } from '../../format';

interface VaultChartProps {
  points: ChartPoint[];
  kind: ChartKind;
  hasLocked: boolean;
  period?: ChartPeriod;
  height?: number;
  isLoading?: boolean;
}

const COLOR_UNLOCKED = '#2578ff';
const COLOR_LOCKED = '#46a2ff';

function formatValue(kind: ChartKind, value: number): string {
  if (kind === 'apy') return `${value.toFixed(2)}%`;
  if (kind === 'tvl') return formatUSDFull(value);
  return value.toFixed(4);
}

/** yearn.fi axis formatters — the zero tick is dropped so it never collides with the X axis. */
const PERFORMANCE_DOMAIN = ([dataMin, dataMax]: [number, number]): [number, number] => [
  Math.min(1, dataMin),
  dataMax,
];

function formatAxisValue(kind: ChartKind, value: number): string {
  if (!Number.isFinite(value) || value === 0) return '';
  if (kind === 'apy') return `${value.toFixed(1)}%`;
  if (kind === 'tvl') return `$${(value / 1_000_000).toFixed(1)}M`;
  return value.toFixed(2);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `07/26` for long ranges, `07/28/26` for 30d/90d — matches yearn.fi's tick formatters. */
function formatTick(date: string, isShort: boolean): string {
  const [month, day, year] = date.split('/');
  return isShort ? `${month}/${day}/${year}` : `${month}/${year}`;
}

/** One tick per month (long ranges) or per ISO week (short ranges). */
function pickTicks(points: ChartPoint[], isShort: boolean): string[] {
  const ticks: string[] = [];
  let lastKey = '';
  for (const point of points) {
    const d = new Date(point.time);
    let key: string;
    if (isShort) {
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      key = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
    } else {
      key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    }
    if (key !== lastKey) {
      ticks.push(point.date);
      lastKey = key;
    }
  }
  return ticks;
}

const ChartTooltip: React.FC<any> = ({ active, payload, label, kind }) => {
  if (!active || !payload?.length) return null;
  const time = payload[0]?.payload?.time;
  return (
    <div className="y-chart-tooltip">
      <p className="y-chart-tooltip__title">{formatTooltipDate(Number(time ?? label))}</p>
      {payload.map((entry: any) => (
        <p className="y-chart-tooltip__row" key={entry.dataKey}>
          <span className="y-chart-tooltip__swatch" style={{ background: entry.color }} />
          <span className="y-chart-tooltip__label">{entry.name}</span>
          <span className="y-chart-tooltip__value">{formatValue(kind, Number(entry.value))}</span>
        </p>
      ))}
    </div>
  );
};

/** Recharts config copied from yearn.fi's ChartPrimitives / YvUsdDualLineChart. */
export const VaultChart: React.FC<VaultChartProps> = ({
  points,
  kind,
  hasLocked,
  period = 'all',
  height = 230,
  isLoading = false,
}) => {
  if (isLoading) {
    return <div className="y-chart-loading" style={{ height }} />;
  }
  if (!points.length) {
    return (
      <div className="y-chart-empty" style={{ height }}>
        <p>Chart unavailable</p>
        <span>Unable to render chart data right now.</span>
      </div>
    );
  }

  const gradientId = `y-chart-gradient-${kind}`;
  const isShortTimeframe = period === '30d' || period === '90d';
  const ticks = pickTicks(points, isShortTimeframe);

  return (
    <div className="y-chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 20, right: 8, left: 0, bottom: 20 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLOR_UNLOCKED} stopOpacity={0.5} />
              <stop offset="95%" stopColor={COLOR_UNLOCKED} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--y-chart-grid)" />
          <XAxis
            dataKey="date"
            ticks={ticks}
            tickFormatter={(value) => formatTick(String(value), isShortTimeframe)}
            tick={{ fill: 'var(--y-chart-axis)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--y-chart-axis)' }}
            tickLine={{ stroke: 'var(--y-chart-axis)' }}
          />
          <YAxis
            mirror
            width={12}
            tick={{ fill: 'var(--y-chart-axis)', fontSize: 12, textAnchor: 'start', dx: 6 }}
            tickFormatter={(value) => formatAxisValue(kind, Number(value))}
            tickMargin={0}
            axisLine={{ stroke: 'var(--y-chart-axis)' }}
            tickLine={{ stroke: 'var(--y-chart-axis)' }}
            domain={kind === 'performance' ? PERFORMANCE_DOMAIN : [0, 'auto']}
          />
          <Tooltip content={<ChartTooltip kind={kind} />} cursor={{ stroke: 'var(--y-border)' }} />
          {!hasLocked && (
            <Area
              type="monotone"
              dataKey="unlocked"
              name="Historical APY"
              stroke="none"
              fill={`url(#${gradientId})`}
              fillOpacity={1}
              connectNulls
              tooltipType="none"
              isAnimationActive={false}
            />
          )}
          <Line
            type="monotone"
            dataKey="unlocked"
            name={hasLocked ? 'Unlocked' : 'Historical APY'}
            stroke={COLOR_UNLOCKED}
            strokeWidth={hasLocked ? 2 : 1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          {hasLocked && (
            <Line
              type="monotone"
              dataKey="locked"
              name="Locked"
              stroke={COLOR_LOCKED}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {hasLocked && (
        <div className="y-chart-legend">
          <span className="y-chart-legend__item">
            <span className="y-chart-legend__line" style={{ borderColor: COLOR_UNLOCKED }} />
            Unlocked
          </span>
          <span className="y-chart-legend__item">
            <span
              className="y-chart-legend__line is-dashed"
              style={{ borderColor: COLOR_LOCKED }}
            />
            Locked
          </span>
        </div>
      )}
    </div>
  );
};
