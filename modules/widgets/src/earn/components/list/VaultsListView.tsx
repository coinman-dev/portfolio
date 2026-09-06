import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { YearnVault } from '../../types';
import {
  Aggressiveness,
  deriveAggressiveness,
  deriveAssetCategory,
  deriveListKind,
  getFeeStructureKey,
  getProductTypeInfo,
  getVaultKey,
  ProductType,
} from '../../vaultMeta';
import { isSelectableChain } from '../../yearnApi';
import { VaultsFiltersBar } from './VaultsFiltersBar';
import { countActiveFilters, DEFAULT_FILTERS, VaultFilters, VaultsFiltersModal } from './VaultsFiltersModal';
import { VaultsListHead, SortDir, SortKey } from './VaultsListHead';
import { VaultsListRow } from './VaultsListRow';
import { VaultsListEmpty } from './VaultsListEmpty';
import { VaultsListSkeleton } from './VaultsListSkeleton';
import { CompareBar } from './CompareBar';
import { VaultsCompareModal } from './VaultsCompareModal';
import { VaultsPagination } from './VaultsPagination';

export interface VaultsListState {
  productType: ProductType | 'all';
  chains: number[];
  categories: string[];
  feeStructureKey: string | null;
  search: string;
  sortBy: SortKey;
  sortDir: SortDir;
  filters: VaultFilters;
}

/** CoinMan-specific: yearn.fi virtualises the whole list, we page it. */
export const VAULTS_PER_PAGE = 50;

export const DEFAULT_LIST_STATE: VaultsListState = {
  productType: 'all',
  chains: [],
  categories: [],
  feeStructureKey: null,
  search: '',
  sortBy: 'tvl',
  sortDir: 'desc',
  filters: DEFAULT_FILTERS,
};

interface VaultsListViewProps {
  vaults: YearnVault[];
  isLoading: boolean;
  error?: string | null;
  state: VaultsListState;
  onStateChange: (next: VaultsListState) => void;
  onSelectVault: (vault: YearnVault) => void;
  holdings?: Record<string, number>;
  showHoldings?: boolean;
}

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** Does this vault survive the filter bar, the Filters modal and the search box? */
function matchesListState(vault: YearnVault, state: VaultsListState): boolean {
  const { productType, chains, categories, feeStructureKey, search, filters } = state;
  const listKind = deriveListKind(vault);
  const info = getProductTypeInfo(vault);

  if (!isSelectableChain(vault.chainID)) return false;
  if (!filters.showLegacy && info.isLegacy) return false;
  if (!filters.showSingleAssetStrategies && listKind === 'strategy') return false;
  if (vault.info?.isHidden) return false;

  if (productType !== 'all' && info.productType !== productType) return false;
  if (chains.length && !chains.includes(vault.chainID)) return false;

  if (categories.length) {
    const derived = deriveAssetCategory(vault);
    if (!categories.includes(vault.category) && !categories.includes(derived)) return false;
  }

  if (feeStructureKey && getFeeStructureKey(vault.apr?.fees) !== feeStructureKey) return false;

  if (filters.assets.length && !filters.assets.includes(vault.token?.symbol || '')) return false;

  if (filters.minTvl > 0 && (vault.tvl?.tvl || 0) < filters.minTvl) return false;

  if (filters.categories.length && !filters.categories.includes(deriveAssetCategory(vault))) {
    return false;
  }

  if (filters.aggressiveness.length) {
    const level = deriveAggressiveness(vault) as Aggressiveness | null;
    if (!level || !filters.aggressiveness.includes(level)) return false;
  }

  const query = search.trim().toLowerCase();
  if (query) {
    const haystack = [vault.name, vault.symbol, vault.address]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  return true;
}

interface Relaxation {
  label: string;
  isActive: (filters: VaultFilters) => boolean;
  apply: (filters: VaultFilters) => VaultFilters;
}

/** Filters the search footer can offer to loosen, in the order the site lists
 *  them. Legacy vaults are deliberately not offered — yearn.fi keeps that
 *  switch out of the footer. */
const RELAXATIONS: Relaxation[] = [
  {
    label: 'low-tvl vaults',
    isActive: (filters) => filters.minTvl > 0,
    apply: (filters) => ({ ...filters, minTvl: 0 }),
  },
  {
    label: 'single asset strategies',
    isActive: (filters) => !filters.showSingleAssetStrategies,
    apply: (filters) => ({ ...filters, showSingleAssetStrategies: true }),
  },
];

function sortValue(vault: YearnVault, key: SortKey, holdings: Record<string, number>): number {
  switch (key) {
    case 'estAPY':
      return vault.apr?.forwardAPR?.netAPR ?? vault.apr?.netAPR ?? 0;
    case 'tvl':
      return vault.tvl?.tvl ?? 0;
    case 'deposited':
      return holdings[getVaultKey(vault)] ?? 0;
    default:
      return vault.featuringScore ?? 0;
  }
}

/**
 * Default ("featuring") order: highlighted vaults first, then TVL descending —
 * this reproduces the order yearn.fi's backend returns.
 */
function compareFeatured(a: YearnVault, b: YearnVault): number {
  const scoreDelta = (b.featuringScore ?? 0) - (a.featuringScore ?? 0);
  if (scoreDelta !== 0) return scoreDelta;
  return (b.tvl?.tvl ?? 0) - (a.tvl?.tvl ?? 0);
}

export const VaultsListView: React.FC<VaultsListViewProps> = ({
  vaults,
  isLoading,
  error,
  state,
  onStateChange,
  onSelectVault,
  holdings = {},
  showHoldings = false,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareKeys, setCompareKeys] = useState<string[]>([]);
  const [isCompareOpen, setCompareOpen] = useState(false);
  const [isFiltersOpen, setFiltersOpen] = useState(false);

  const patch = useCallback(
    (next: Partial<VaultsListState>) => onStateChange({ ...state, ...next }),
    [onStateChange, state]
  );

  useEffect(() => {
    if (!compareMode) {
      setCompareKeys([]);
      setCompareOpen(false);
    }
  }, [compareMode]);

  const assetOptions = useMemo(() => {
    const set = new Set<string>();
    for (const vault of vaults) {
      if (!isSelectableChain(vault.chainID)) continue;
      const symbol = vault.token?.symbol;
      if (symbol) set.add(symbol);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [vaults]);

  const filtered = useMemo(
    () => vaults.filter((vault) => matchesListState(vault, state)),
    [vaults, state]
  );

  /**
   * yearn.fi's "Still looking for X?" footer: when a search hides matches
   * behind the default filters, it offers to relax exactly the filters that
   * would bring more of them back, annotated with how many that is.
   */
  const searchSuggestions = useMemo(() => {
    if (!state.search.trim()) return [];

    const active = RELAXATIONS.filter((relaxation) => relaxation.isActive(state.filters));
    if (active.length === 0) return [];

    const suggestions: { label: string; filters: VaultFilters }[] = [];
    const seenDeltas = new Set<number>();

    // Every combination of the restricting filters, best pay-off first.
    const combos: Relaxation[][] = [];
    for (let mask = 1; mask < 1 << active.length; mask++) {
      combos.push(active.filter((_, index) => mask & (1 << index)));
    }

    const scored = combos
      .map((combo) => {
        const filters = combo.reduce((acc, relaxation) => relaxation.apply(acc), state.filters);
        const count = vaults.filter((vault) =>
          matchesListState(vault, { ...state, filters })
        ).length;
        return { combo, filters, delta: count - filtered.length };
      })
      .filter((entry) => entry.delta > 0)
      .sort((a, b) => b.delta - a.delta || a.combo.length - b.combo.length);

    for (const entry of scored) {
      // Two combos that reveal the same vaults are the same offer to the user.
      if (seenDeltas.has(entry.delta)) continue;
      seenDeltas.add(entry.delta);
      suggestions.push({
        label: `Show ${entry.combo.map((r) => r.label).join(' and show ')} (+${entry.delta})`,
        filters: entry.filters,
      });
      if (suggestions.length === 3) break;
    }

    return suggestions;
  }, [vaults, state, filtered.length]);

  const sorted = useMemo(() => {
    if (state.sortBy === 'featuring' || !state.sortDir) {
      return [...filtered].sort(compareFeatured);
    }
    const factor = state.sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort(
      (a, b) =>
        factor * (sortValue(a, state.sortBy, holdings) - sortValue(b, state.sortBy, holdings))
    );
  }, [filtered, state.sortBy, state.sortDir, holdings]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / VAULTS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);

  // Any change to the result set puts the reader back on the first page.
  useEffect(() => {
    setPage(1);
  }, [state]);

  const pageVaults = useMemo(
    () => sorted.slice((currentPage - 1) * VAULTS_PER_PAGE, currentPage * VAULTS_PER_PAGE),
    [sorted, currentPage]
  );

  /** Paging keeps the reader at the top of the list, not where they left off. */
  const handlePageChange = useCallback((next: number) => {
    setPage(next);
    listRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  const compareVaults = useMemo(
    () => sorted.filter((vault) => compareKeys.includes(getVaultKey(vault))),
    [sorted, compareKeys]
  );

  const handleToggleExpanded = useCallback((key: string, next: boolean) => {
    setExpanded((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(key);
      else copy.delete(key);
      return copy;
    });
  }, []);

  const handleToggleCompare = useCallback((vault: YearnVault) => {
    const key = getVaultKey(vault);
    setCompareKeys((prev) =>
      prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]
    );
  }, []);

  const handleAllChains = useCallback(() => patch({ chains: [] }), [patch]);

  /** Chains behave like radio buttons on yearn.fi, not checkboxes. */
  const handleSelectChain = useCallback(
    (chainId: number) =>
      patch({ chains: state.chains.length === 1 && state.chains[0] === chainId ? [] : [chainId] }),
    [patch, state.chains]
  );

  const activeFiltersCount = countActiveFilters(state.filters);

  return (
    <div className="y-vaults-view">
      <VaultsFiltersBar
        productType={state.productType}
        onProductTypeChange={(productType) => patch({ productType })}
        chains={state.chains}
        onToggleChain={handleSelectChain}
        onAllChains={handleAllChains}
        search={state.search}
        onSearchChange={(search) => patch({ search })}
        activeFiltersCount={activeFiltersCount}
        onOpenFilters={() => setFiltersOpen(true)}
        compareMode={compareMode}
        onToggleCompareMode={() => setCompareMode((prev) => !prev)}
      />

      <div ref={listRef} className="y-vaults-view__anchor" />

      <VaultsListHead
        sortBy={state.sortBy}
        sortDir={state.sortDir}
        onSort={(sortBy, sortDir) => patch({ sortBy, sortDir })}
        showHoldings={showHoldings}
      />

      {isLoading ? (
        <VaultsListSkeleton />
      ) : error ? (
        <div className="y-list-frame-end">
          <div className="y-list-empty">
            <b>Something went wrong</b>
            <p>{error}</p>
          </div>
        </div>
      ) : sorted.length === 0 && searchSuggestions.length === 0 ? (
        <div className="y-list-frame-end">
          <VaultsListEmpty
            currentSearch={state.search}
            isLoading={false}
            onReset={() => onStateChange(DEFAULT_LIST_STATE)}
          />
        </div>
      ) : (
        <div className="y-vaults-list">
          {pageVaults.map((vault) => {
            const key = getVaultKey(vault);
            return (
              <VaultsListRow
                key={key}
                vault={vault}
                isExpanded={expanded.has(key)}
                onToggleExpanded={handleToggleExpanded}
                onSelectVault={onSelectVault}
                activeChains={state.chains}
                activeCategories={state.categories}
                activeProductType={state.productType}
                activeFeeStructureKey={state.feeStructureKey}
                onToggleChain={handleSelectChain}
                onToggleCategory={(category) =>
                  patch({ categories: toggleValue(state.categories, category) })
                }
                onToggleProductType={(productType) =>
                  patch({ productType: state.productType === productType ? 'all' : productType })
                }
                onToggleFeeStructure={(feeKey) =>
                  patch({ feeStructureKey: state.feeStructureKey === feeKey ? null : feeKey })
                }
                compareMode={compareMode}
                isCompared={compareKeys.includes(key)}
                onToggleCompare={handleToggleCompare}
                showHoldings={showHoldings}
                holdingsValue={holdings[key] || 0}
              />
            );
          })}

          {totalPages > 1 && (
            <VaultsPagination
              currentPage={currentPage}
              totalPages={totalPages}
              total={sorted.length}
              onPageChange={handlePageChange}
            />
          )}

          {searchSuggestions.length > 0 && (
            <div className="y-list-more">
              <div className="y-list-more__text">
                <b>{`Still looking for "${state.search.trim()}"?`}</b>
                <p>Show additional matching vaults hidden by filters.</p>
              </div>
              <div className="y-list-more__actions">
                {searchSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    type="button"
                    className="y-btn y-btn--ghost y-btn--small"
                    onClick={() => patch({ filters: suggestion.filters })}
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {compareMode && !isCompareOpen && (
        <CompareBar
          count={compareKeys.length}
          onClear={() => setCompareKeys([])}
          onCompare={() => setCompareOpen(true)}
        />
      )}

      <VaultsCompareModal
        isOpen={isCompareOpen}
        vaults={compareVaults}
        onClose={() => setCompareOpen(false)}
        onRemove={(key) => setCompareKeys((prev) => prev.filter((entry) => entry !== key))}
      />

      <VaultsFiltersModal
        isOpen={isFiltersOpen}
        filters={state.filters}
        assetOptions={assetOptions}
        onClose={() => setFiltersOpen(false)}
        onSave={(filters) => patch({ filters })}
      />
    </div>
  );
};
