import React, { useState } from 'react';
import { YearnVault } from '../../types';
import { ChartKind, ChartPeriod, useVaultChart } from '../../hooks/useVaultChart';
import { ChartDropdown } from '../charts/ChartDropdown';
import { CHART_PERIODS, VaultChart } from '../charts/VaultChart';
import { useT } from '../../i18n';

const CHART_TABS: { id: ChartKind; label: string }[] = [
  { id: 'apy', label: '30-Day APY' },
  { id: 'performance', label: 'Performance' },
  { id: 'tvl', label: 'TVL' },
];

interface VaultChartsSectionProps {
  vault: YearnVault;
  sectionRef?: React.Ref<HTMLElement>;
}

export const VaultChartsSection: React.FC<VaultChartsSectionProps> = ({ vault, sectionRef }) => {
  const t = useT();
  const [kind, setKind] = useState<ChartKind>('apy');
  // yvUSD only has a few months of history, so the site opens it on 90D.
  const [period, setPeriod] = useState<ChartPeriod>(vault.lockedTwin ? '90d' : '1y');
  const chart = useVaultChart(vault, kind, period);

  return (
    <section className="y-vd-card y-vd-card--chart" id="performance" ref={sectionRef}>
      <div className="y-vd-chart__bar">
        <div className="y-vd-chart__tabs" role="tablist" aria-label={t('Chart metric')}>
          {CHART_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={kind === tab.id}
              className={`y-vd-chart__tab${kind === tab.id ? ' is-active' : ''}`}
              onClick={() => setKind(tab.id)}
            >
              {t(tab.label)}
            </button>
          ))}
        </div>

        <ChartDropdown
          value={period}
          options={CHART_PERIODS}
          onChange={setPeriod}
          ariaLabel={t('Chart timeframe')}
        />
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
