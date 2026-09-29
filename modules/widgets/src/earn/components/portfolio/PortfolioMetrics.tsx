import React from 'react';
import { formatAPY, formatUSDCents } from '../../format';
import { PortfolioPosition } from '../../hooks/usePortfolioHoldings';
import { useProtocolReturnHistory } from '../../hooks/usePortfolioHistory';
import { getHeadlineAPY, getMonthAgoAPY } from '../../vaultMeta';

interface PortfolioMetricsProps {
  address: string;
  positions: PortfolioPosition[];
  totalUsd: number;
  isLoading: boolean;
}

interface Metric {
  key: string;
  label: string;
  tooltip: string;
  value: string;
  isLoading: boolean;
}

/** Deposit-weighted average of a per-vault rate; null when no rate is known. */
function weightedRate(
  positions: PortfolioPosition[],
  totalUsd: number,
  rateOf: (position: PortfolioPosition) => number | null
): number | null {
  if (totalUsd <= 0) return null;
  let weighted = 0;
  let covered = 0;
  for (const position of positions) {
    const rate = rateOf(position);
    if (rate === null) continue;
    weighted += rate * position.usdValue;
    covered += position.usdValue;
  }
  return covered > 0 ? weighted / covered : null;
}

/** `+4.66%` — the site signs the all-time return. */
function formatSignedPercent(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(2)}%`;
}

export const PortfolioMetrics: React.FC<PortfolioMetricsProps> = ({
  address,
  positions,
  totalUsd,
  isLoading,
}) => {
  const currentAPY = weightedRate(positions, totalUsd, (p) => getHeadlineAPY(p.vault));
  const monthAPY = weightedRate(positions, totalUsd, (p) => getMonthAgoAPY(p.vault));
  const annualReturn = currentAPY === null ? null : totalUsd * currentAPY;

  // Cumulative since the first deposit, so the 1y history carries it too.
  const protocolReturn = useProtocolReturnHistory(address, '1y');
  const allTime = protocolReturn.data?.dataPoints
    .map((point) => point.annualizedProtocolReturnPct)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .at(-1);

  const metrics: Metric[] = [
    {
      key: 'total-balance',
      label: 'Total Vault Balance',
      tooltip: 'Total USD value of all your vault deposits.',
      value: formatUSDCents(totalUsd),
      isLoading,
    },
    {
      key: 'est-annual',
      label: 'Est. Annual Return',
      tooltip: 'Projects potential returns based on your blended current APY.',
      value: annualReturn === null ? '—' : formatUSDCents(annualReturn),
      isLoading,
    },
    {
      key: 'current-apy',
      label: 'Current APY',
      tooltip: 'Weighted by your total deposits across all Yearn vaults.',
      value: currentAPY === null ? '—' : formatAPY(currentAPY),
      isLoading,
    },
    {
      key: 'month-apy',
      label: '30-day APY',
      tooltip: 'Blended 30-day performance using your current positions.',
      value: monthAPY === null ? '—' : formatAPY(monthAPY),
      isLoading,
    },
    {
      key: 'all-time',
      label: 'All-Time Annualized Return',
      tooltip: 'Yield earned since your first deposit, annualized. Token price moves are excluded.',
      value: allTime === undefined ? '—' : formatSignedPercent(allTime),
      isLoading: protocolReturn.isLoading,
    },
  ];

  return (
    <div className="y-pf-metrics">
      {metrics.map((metric) => (
        <div className="y-pf-metric" key={metric.key}>
          <span className="y-pf-metric__label y-link-dots" title={metric.tooltip}>
            {metric.label}
          </span>
          <span className="y-pf-metric__value">
            {metric.isLoading ? <span className="y-skeleton y-pf-metric__skeleton" /> : metric.value}
          </span>
        </div>
      ))}
    </div>
  );
};
