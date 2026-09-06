import React from 'react';
import { ChevronDown } from '../ui/icons';

export type SortKey = 'featuring' | 'estAPY' | 'tvl' | 'deposited';
export type SortDir = 'asc' | 'desc' | '';

interface VaultsListHeadProps {
  sortBy: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey, dir: SortDir) => void;
  /** The Holdings column only exists while a wallet is connected. */
  showHoldings?: boolean;
  /** Portfolio reuses this head with the site's wider column labels. */
  vaultLabel?: string;
  holdingsLabel?: string;
}

/** yearn.fi cycles desc → asc → unsorted for columns that allow it. */
export function getNextSortDirection(
  activeSortBy: SortKey,
  activeSortDir: SortDir,
  nextSortBy: SortKey,
  allowUnsorted = false
): SortDir {
  if (activeSortBy !== nextSortBy) return 'desc';
  if (activeSortDir === 'desc') return 'asc';
  if (activeSortDir === 'asc' && allowUnsorted) return '';
  return 'desc';
}

export const VaultsListHead: React.FC<VaultsListHeadProps> = ({
  sortBy,
  sortDir,
  onSort,
  showHoldings = false,
  vaultLabel = 'Vault',
  holdingsLabel = 'Holdings',
}) => {
  const renderButton = (key: SortKey, label: string, span: number) => {
    const isActive = sortBy === key && sortDir !== '';
    return (
      <button
        type="button"
        className={`y-list-head__btn y-span-${span}${isActive ? ' is-active' : ''}`}
        datatype="number"
        aria-label={`Sort by ${label}`}
        onClick={() => onSort(key, getNextSortDirection(sortBy, sortDir, key, true))}
      >
        <p className="yearn--table-head-label">{label}</p>
        <span className="y-list-head__sort-wrap">
          <ChevronDown
            size={16}
            className={`y-list-head__sort${isActive && sortDir === 'asc' ? ' is-asc' : ''}`}
          />
        </span>
      </button>
    );
  };

  return (
    <div className="y-list-head">
      <div className="y-list-head__left">
        <button type="button" className="y-list-head__btn" disabled>
          <p className="yearn--table-head-label">{vaultLabel}</p>
        </button>
      </div>
      <div className="y-list-head__right">
        {renderButton('estAPY', 'Est. APY', showHoldings ? 4 : 6)}
        {renderButton('tvl', 'TVL', showHoldings ? 4 : 5)}
        {showHoldings ? renderButton('deposited', holdingsLabel, 4) : <div className="y-span-1" />}
      </div>
    </div>
  );
};
