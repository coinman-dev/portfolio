import React, { useMemo, useState } from 'react';
import { YearnVault } from '../../types';
import { formatUSDFull } from '../../format';
import { VaultAboutSection } from '../shared/VaultAboutSection';
import { AllocationDonut, ALLOCATION_COLORS } from '../charts/AllocationDonut';
import { VaultChart } from '../charts/VaultChart';
import { ChartKind, useVaultChart } from '../../hooks/useVaultChart';

type ExpandedView = 'strategies' | 'apy' | 'performance' | 'tvl';

const TABS: { id: ExpandedView; label: string }[] = [
  { id: 'strategies', label: 'Strategies' },
  { id: 'apy', label: 'APY' },
  { id: 'performance', label: 'Performance' },
  { id: 'tvl', label: 'TVL' },
];

interface VaultRowExpandedProps {
  vault: YearnVault;
  onNavigateToVault: () => void;
}

/** Active strategies sorted by debt ratio, as yearn.fi does. */
export function getActiveStrategies(vault: YearnVault) {
  return (vault.strategies || [])
    .filter((strategy) => {
      if (strategy.status === 'not_active') return false;
      const debtRatio = strategy.details?.debtRatio || 0;
      const totalDebt = strategy.details?.totalDebt;
      return debtRatio > 0 && !!totalDebt && totalDebt !== '0';
    })
    .sort((a, b) => (b.details?.debtRatio || 0) - (a.details?.debtRatio || 0));
}

export const VaultRowExpanded: React.FC<VaultRowExpandedProps> = ({ vault, onNavigateToVault }) => {
  const [view, setView] = useState<ExpandedView>('strategies');
  const chartKind: ChartKind = view === 'performance' ? 'performance' : view === 'tvl' ? 'tvl' : 'apy';
  const chart = useVaultChart(view === 'strategies' ? null : vault, chartKind, 'all');

  const strategies = useMemo(() => getActiveStrategies(vault), [vault]);
  const decimals = vault.token?.decimals ?? 18;
  const price = vault.tvl?.price || 1;

  const slices = strategies.map((strategy) => ({
    name: strategy.name,
    value: (strategy.details?.debtRatio || 0) / 100,
  }));

  const strategyValue = (totalDebt?: string): number => {
    if (!totalDebt) return 0;
    const raw = Number(totalDebt);
    if (!Number.isFinite(raw)) return 0;
    return (raw / 10 ** decimals) * price;
  };

  return (
    <div className="y-row__expanded">
      <div className="y-row__expanded-left">
        <VaultAboutSection vault={vault} showKind={false} />
      </div>

      <div className="y-row__expanded-right">
        <div className="y-expanded-selector">
          <div className="y-expanded-selector__tabs">
            <div className="y-expanded-selector__group">
              {TABS.slice(0, 2).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`y-expanded-selector__tab${view === tab.id ? ' is-active' : ''}`}
                  onClick={() => setView(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="y-expanded-selector__group">
              {TABS.slice(2).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`y-expanded-selector__tab${view === tab.id ? ' is-active' : ''}`}
                  onClick={() => setView(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="y-expanded-selector__cta" onClick={onNavigateToVault}>
            Go to Vault
          </button>
        </div>

        <div className="y-expanded-panel">
          {view === 'strategies' ? (
            strategies.length ? (
              <div className="y-allocation">
                <div className="y-allocation__legend">
                  {strategies.map((strategy, index) => (
                    <div className="y-allocation__item" key={strategy.address}>
                      <span
                        className="y-allocation__dot"
                        style={{
                          background: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
                        }}
                      />
                      <span>
                        <span className="y-allocation__name">{strategy.name}</span>
                        <br />
                        <span className="y-allocation__amount">
                          {formatUSDFull(strategyValue(strategy.details?.totalDebt))}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                <AllocationDonut data={slices} />
              </div>
            ) : (
              <div className="y-expanded-empty">No active strategies.</div>
            )
          ) : (
            <VaultChart
              points={chart.points}
              kind={chartKind}
              hasLocked={chart.hasLocked}
              isLoading={chart.isLoading}
              height={230}
            />
          )}
        </div>
      </div>
    </div>
  );
};
