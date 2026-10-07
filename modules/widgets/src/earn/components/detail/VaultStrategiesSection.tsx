import React, { useMemo, useState } from 'react';
import { YearnVault } from '../../types';
import { getChain } from '../../yearnApi';
import { formatAPY, formatLongDate, formatPercent, formatUSD, shortenAddress } from '../../format';
import { openExternal } from '../../openExternal';
import { ChevronDown, ExternalLink } from '../ui/icons';
import { AllocationDonut, ALLOCATION_COLORS } from '../charts/AllocationDonut';
import { TokenIcon } from '../TokenIcon';
import { StrategyRow, useVaultStrategies } from '../../hooks/useVaultStrategies';
import { SectionCard } from './SectionCard';

type StrategySort = 'allocation' | 'amount' | 'apy';
type SortDirection = 'asc' | 'desc';

interface StrategyTableRowProps {
  row: StrategyRow;
  vault: YearnVault;
}

const StrategyTableRow: React.FC<StrategyTableRowProps> = ({ row, vault }) => {
  const [isOpen, setIsOpen] = useState(false);
  const chain = getChain(vault.chainID);

  return (
    <div className={`y-strat-row${isOpen ? ' is-open' : ''}`}>
      <button
        type="button"
        className="y-strat-row__head"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="y-strat-row__name">
          <span className="y-strat-row__dot-slot" aria-hidden="true">
            <span className={`y-strat-row__dot${row.status === 'active' ? ' is-active' : ''}`} />
          </span>
          <TokenIcon
            src={vault.token?.icon}
            tokenIcon={vault.token?.icon}
            symbol={vault.token?.symbol || vault.symbol}
            chainId={vault.chainID}
            tokenAddress={vault.token?.address}
            size={28}
          />
          <span className="y-strat-row__label">{row.name}</span>
        </span>
        <span className="y-strat-row__nums">
          <span className="y-strat-row__num">{formatPercent(row.allocation * 100)}</span>
          <span className="y-strat-row__num" title={formatUSD(row.amount)}>
            {formatUSD(row.amount)}
          </span>
          <span className="y-strat-row__num">{formatAPY(row.apy)}</span>
        </span>
        <ChevronDown size={16} className="y-strat-row__chevron" />
      </button>

      {isOpen && (
        <div className="y-strat-row__body">
          <div className="y-strat-row__kv">
            <span>Address</span>
            <button
              type="button"
              className="y-vd-link"
              onClick={() => openExternal(`${chain.blockExplorer}/address/${row.address}`)}
            >
              {shortenAddress(row.address)}
              <ExternalLink size={14} />
            </button>
          </div>
          {row.lastReport > 0 && (
            <div className="y-strat-row__kv">
              <span>Last report</span>
              <b>{formatLongDate(row.lastReport * 1000)}</b>
            </div>
          )}
          <div className="y-strat-row__kv">
            <span>Performance fee</span>
            <b>{formatPercent(row.performanceFee / 100)}</b>
          </div>
        </div>
      )}
    </div>
  );
};

interface VaultStrategiesSectionProps {
  vault: YearnVault;
  sectionRef?: React.Ref<HTMLElement>;
}

export const VaultStrategiesSection: React.FC<VaultStrategiesSectionProps> = ({
  vault,
  sectionRef,
}) => {
  const [sortBy, setSortBy] = useState<StrategySort>('allocation');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [showInactive, setShowInactive] = useState(false);
  const { strategies, unallocated, isLoading } = useVaultStrategies(vault);

  const sorted = useMemo(() => {
    const factor = direction === 'desc' ? -1 : 1;
    return [...strategies].sort((a, b) => {
      if (sortBy === 'amount') return factor * (a.amount - b.amount);
      if (sortBy === 'apy') return factor * ((a.apy ?? 0) - (b.apy ?? 0));
      return factor * (a.allocation - b.allocation);
    });
  }, [strategies, sortBy, direction]);

  const active = sorted.filter((row) => row.status === 'active');
  const inactive = sorted.filter((row) => row.status !== 'active');

  const slices = useMemo(() => {
    const base = active.map((row) => ({ name: row.name, value: row.allocation * 100 }));
    if (unallocated) base.push({ name: 'Unallocated', value: unallocated.allocation * 100 });
    return base;
  }, [active, unallocated]);

  const toggleSort = (next: StrategySort) => {
    if (sortBy !== next) {
      setSortBy(next);
      setDirection('desc');
      return;
    }
    setDirection((current) => (current === 'desc' ? 'asc' : 'desc'));
  };

  const sortButton = (id: StrategySort, label: string) => (
    <button
      type="button"
      className={`y-strat-head__sort${sortBy === id ? ' is-active' : ''}`}
      aria-label={`Sort by ${label}`}
      onClick={() => toggleSort(id)}
    >
      {label}
      <ChevronDown
        size={16}
        className={`y-strat-head__chevron${sortBy === id && direction === 'asc' ? ' is-asc' : ''}`}
      />
    </button>
  );

  if (!isLoading && !strategies.length) return null;

  return (
    <SectionCard id="strategies" title="Strategies" sectionRef={sectionRef} bodyClassName="y-strat">
      {slices.length > 0 && (
        <div className="y-strat__allocation">
          <AllocationDonut data={slices} size={150} />
          <ul className="y-strat__legend">
            {slices.map((slice, index) => (
              <li key={slice.name} className="y-strat__legend-item">
                <span
                  className="y-strat__legend-dot"
                  style={{ background: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }}
                />
                {slice.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="y-strat__table">
        <div className="y-strat-head">
          <span className="y-strat-head__label">Strategy</span>
          <span className="y-strat-head__sorts">
            {sortButton('allocation', 'Allocation %')}
            {sortButton('amount', 'Amount')}
            {sortButton('apy', 'APY')}
          </span>
          <span className="y-strat-head__spacer" />
        </div>
        {active.map((row) => (
          <StrategyTableRow key={row.address} row={row} vault={vault} />
        ))}
        {unallocated && (
          <div className="y-strat-row">
            <div className="y-strat-row__head y-strat-row__head--static">
              <span className="y-strat-row__name">
                <span className="y-strat-row__dot-slot" aria-hidden="true">
                  <span className="y-strat-row__dot" />
                </span>
                <span className="y-strat-row__label">Unallocated</span>
              </span>
              <span className="y-strat-row__nums">
                <span className="y-strat-row__num">
                  {formatPercent(unallocated.allocation * 100)}
                </span>
                <span className="y-strat-row__num">{formatUSD(unallocated.amount)}</span>
                <span className="y-strat-row__num">—</span>
              </span>
              <span />
            </div>
          </div>
        )}
      </div>

      {inactive.length > 0 && (
        <div className="y-strat__unallocated">
          <button
            type="button"
            className="y-strat__toggle"
            aria-expanded={showInactive}
            onClick={() => setShowInactive((open) => !open)}
          >
            <span>
              {`${showInactive ? 'Hide' : 'Show'} Unallocated Strategies`}
              <span className="y-strat__toggle-count">{` (${inactive.length})`}</span>
            </span>
            <ChevronDown
              size={16}
              className={`y-strat__toggle-chevron${showInactive ? ' is-open' : ''}`}
            />
          </button>
          {showInactive && (
            <div className="y-strat__table y-strat__table--inactive">
              {inactive.map((row) => (
                <StrategyTableRow key={row.address} row={row} vault={vault} />
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
};
