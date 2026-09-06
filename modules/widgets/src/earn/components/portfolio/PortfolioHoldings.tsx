import React, { useCallback, useMemo, useState } from 'react';
import { YearnVault } from '../../types';
import { getHeadlineAPY, getVaultKey } from '../../vaultMeta';
import { PortfolioPosition } from '../../hooks/usePortfolioHoldings';
import { SortDir, SortKey, VaultsListHead } from '../list/VaultsListHead';
import { VaultsListRow } from '../list/VaultsListRow';
import { EmptySectionCard } from './EmptySectionCard';

interface PortfolioHoldingsProps {
  positions: PortfolioPosition[];
  holdings: Record<string, number>;
  isLoading: boolean;
  onSelectVault: (vault: YearnVault) => void;
  onExploreVaults: () => void;
}

const noop = () => {};

function sortValue(position: PortfolioPosition, key: SortKey): number {
  switch (key) {
    case 'estAPY':
      return getHeadlineAPY(position.vault);
    case 'tvl':
      return position.vault.tvl?.tvl ?? 0;
    default:
      return position.usdValue;
  }
}

export const PortfolioHoldings: React.FC<PortfolioHoldingsProps> = ({
  positions,
  holdings,
  isLoading,
  onSelectVault,
  onExploreVaults,
}) => {
  const [sortBy, setSortBy] = useState<SortKey>('deposited');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const handleToggleExpanded = useCallback((key: string, next: boolean) => {
    setExpanded((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(key);
      else copy.delete(key);
      return copy;
    });
  }, []);

  const sorted = useMemo(() => {
    if (!sortDir) return positions;
    const factor = sortDir === 'asc' ? 1 : -1;
    return [...positions].sort(
      (a, b) => factor * (sortValue(a, sortBy) - sortValue(b, sortBy))
    );
  }, [positions, sortBy, sortDir]);

  if (isLoading) {
    return (
      <div className="y-pf-loading">
        <span className="y-pf-loading__spinner" aria-hidden="true" />
        <span>Searching for portfolio balances...</span>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <EmptySectionCard
        title="No portfolio positions yet"
        description="Deposit into a Yearn vault to see it here."
        ctaLabel="Explore Vaults"
        onCta={onExploreVaults}
      />
    );
  }

  return (
    <section className="y-pf-section">
      <h2 className="y-pf-section__title">Vaults</h2>
      <div className="y-vaults-view">
        <VaultsListHead
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={(key, dir) => {
            setSortBy(key);
            setSortDir(dir);
          }}
          showHoldings
          vaultLabel="Vault Name"
          holdingsLabel="Your Holdings"
        />
        <div className="y-vaults-list">
          {sorted.map((position) => {
            const key = getVaultKey(position.vault);
            return (
              <VaultsListRow
                key={key}
                vault={position.vault}
                isExpanded={expanded.has(key)}
                onToggleExpanded={handleToggleExpanded}
                onSelectVault={onSelectVault}
                activeChains={[]}
                activeCategories={[]}
                activeProductType="all"
                activeFeeStructureKey={null}
                onToggleChain={noop}
                onToggleCategory={noop}
                onToggleProductType={noop}
                onToggleFeeStructure={noop}
                compareMode={false}
                isCompared={false}
                onToggleCompare={noop}
                showHoldings
                holdingsValue={holdings[key] || 0}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
};
