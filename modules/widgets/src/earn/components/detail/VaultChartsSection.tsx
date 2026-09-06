import React, { useState } from 'react';
import { YearnVault } from '../../types';
import { ChartKind, ChartPeriod, useVaultChart } from '../../hooks/useVaultChart';
import { VaultChart } from '../charts/VaultChart';
import { ChevronDown } from '../ui/icons';

const CHART_TABS: { id: ChartKind; label: string }[] = [
  { id: 'apy', label: '30-Day APY' },
  { id: 'performance', label: 'Performance' },
  { id: 'tvl', label: 'TVL' },
];

const PERIODS: { id: ChartPeriod; label: string }[] = [
  { id: '30d', label: '30D' },
  { id: '90d', label: '90D' },
  { id: '1y', label: '1Y' },
  { id: 'all', label: 'ALL' },
];

interface VaultChartsSectionProps {
  vault: YearnVault;
  sectionRef?: React.Ref<HTMLElement>;
}

export const VaultChartsSection: React.FC<VaultChartsSectionProps> = ({ vault, sectionRef }) => {
  const [kind, setKind] = useState<ChartKind>('apy');
  // yvUSD only has a few months of history, so the site opens it on 90D.
  const [period, setPeriod] = useState<ChartPeriod>(vault.lockedTwin ? '90d' : '1y');
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const chart = useVaultChart(vault, kind, period);

  return (
    <section className="y-vd-card y-vd-card--chart" id="performance" ref={sectionRef}>
      <div className="y-vd-chart__bar">
        <div className="y-vd-chart__tabs" role="tablist" aria-label="Chart metric">
          {CHART_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={kind === tab.id}
              className={`y-vd-chart__tab${kind === tab.id ? ' is-active' : ''}`}
              onClick={() => setKind(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="y-vd-chart__period">
          <button
            type="button"
            className="y-vd-chart__period-btn"
            aria-label="Chart timeframe"
            aria-expanded={isPeriodOpen}
            onClick={() => setIsPeriodOpen((open) => !open)}
          >
            {PERIODS.find((item) => item.id === period)?.label}
            <ChevronDown size={16} />
          </button>
          {isPeriodOpen && (
            <>
              <div className="y-vd-chart__period-backdrop" onClick={() => setIsPeriodOpen(false)} />
              <ul className="y-vd-chart__period-menu" role="listbox">
                {PERIODS.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={period === item.id}
                      className={`y-vd-chart__period-item${period === item.id ? ' is-active' : ''}`}
                      onClick={() => {
                        setPeriod(item.id);
                        setIsPeriodOpen(false);
                      }}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <VaultChart
        points={chart.points}
        kind={kind}
        hasLocked={chart.hasLocked}
        period={period}
        isLoading={chart.isLoading}
        height={230}
      />
    </section>
  );
};
