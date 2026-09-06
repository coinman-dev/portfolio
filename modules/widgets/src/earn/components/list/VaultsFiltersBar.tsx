import React, { useEffect, useRef, useState } from 'react';
import { SELECTABLE_CHAINS } from '../../yearnApi';
import { ProductType } from '../../vaultMeta';
import { ChevronDown, Search as SearchIcon, Sliders, Compare, Close } from '../ui/icons';
import { YearnMark } from '../../assets/YearnLogo';

interface VaultsFiltersBarProps {
  productType: ProductType | 'all';
  onProductTypeChange: (value: ProductType | 'all') => void;
  chains: number[];
  onToggleChain: (chainId: number) => void;
  onAllChains: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  activeFiltersCount: number;
  onOpenFilters: () => void;
  compareMode: boolean;
  onToggleCompareMode: () => void;
}

const PRODUCT_TABS: { id: ProductType | 'all'; label: string }[] = [
  { id: 'all', label: 'All Vaults' },
  { id: 'v3', label: 'Single Asset' },
  { id: 'lp', label: 'LP Token' },
];

export const VaultsFiltersBar: React.FC<VaultsFiltersBarProps> = ({
  productType,
  onProductTypeChange,
  chains,
  onToggleChain,
  onAllChains,
  search,
  onSearchChange,
  activeFiltersCount,
  onOpenFilters,
  compareMode,
  onToggleCompareMode,
}) => {
  const allChainsActive = chains.length === 0 || chains.length === SELECTABLE_CHAINS.length;
  const [isChainMenuOpen, setChainMenuOpen] = useState(false);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const chainMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isChainMenuOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (chainMenuRef.current && !chainMenuRef.current.contains(event.target as Node)) {
        setChainMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isChainMenuOpen]);

  // The chain filter is single-select, so there is at most one to describe.
  const selectedChain = SELECTABLE_CHAINS.find((chain) => chains.includes(chain.id));
  const chainSummary = allChainsActive || !selectedChain ? 'All Chains' : selectedChain.name;

  return (
    <div className="y-filters-bar">
      <div className="y-segmented" role="group" aria-label="Vault type">
        {PRODUCT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`y-segmented__item${productType === tab.id ? ' is-active' : ''}`}
            aria-pressed={productType === tab.id}
            onClick={() => onProductTypeChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="y-filters-bar__chains">
        <div className="y-segmented" role="group" aria-label="Chains">
          <button
            type="button"
            className={`y-segmented__item${allChainsActive ? ' is-active' : ''}`}
            aria-pressed={allChainsActive}
            onClick={onAllChains}
          >
            <YearnMark size={16} />
            All Chains
          </button>
          {SELECTABLE_CHAINS.map((chain) => {
            const isActive = chains.includes(chain.id);
            return (
              <button
                key={chain.id}
                type="button"
                className={`y-segmented__item y-segmented__item--icon${isActive ? ' is-active' : ''}`}
                aria-pressed={isActive}
                aria-label={chain.name}
                title={chain.name}
                onClick={() => onToggleChain(chain.id)}
              >
                <img className="y-chain-icon" src={chain.icon} alt="" loading="lazy" />
                {/* The selected chain reveals its name, as on yearn.fi. */}
                <span className="y-segmented__item-label">{chain.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Below `md` yearn.fi swaps the chain strip for a full-width listbox. */}
      <div className="y-chain-select" ref={chainMenuRef}>
        <button
          type="button"
          className="y-chain-select__btn"
          aria-haspopup="listbox"
          aria-expanded={isChainMenuOpen}
          onClick={() => setChainMenuOpen((prev) => !prev)}
        >
          <span className="y-chain-select__value">
            {allChainsActive ? (
              <YearnMark size={20} />
            ) : (
              <img className="y-chain-icon" src={selectedChain?.icon} alt="" loading="lazy" />
            )}
            <span>{chainSummary}</span>
          </span>
          <ChevronDown size={16} />
        </button>
        {isChainMenuOpen && (
          <div className="y-chain-select__menu" role="listbox">
            <button
              type="button"
              role="option"
              aria-selected={allChainsActive}
              className={`y-chain-select__option${allChainsActive ? ' is-active' : ''}`}
              onClick={() => {
                onAllChains();
                setChainMenuOpen(false);
              }}
            >
              <YearnMark size={20} />
              All Chains
            </button>
            {SELECTABLE_CHAINS.map((chain) => (
              <button
                key={chain.id}
                type="button"
                role="option"
                aria-selected={chains.includes(chain.id)}
                className={`y-chain-select__option${chains.includes(chain.id) ? ' is-active' : ''}`}
                onClick={() => {
                  onToggleChain(chain.id);
                  setChainMenuOpen(false);
                }}
              >
                <img className="y-chain-icon" src={chain.icon} alt="" loading="lazy" />
                {chain.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="y-filters-bar__actions">
        <button
          type="button"
          className={`y-bar-btn y-bar-btn--filters${activeFiltersCount > 0 ? ' is-active' : ''}`}
          aria-label="Open filters"
          data-active={activeFiltersCount > 0}
          onClick={onOpenFilters}
        >
          <Sliders size={16} className="y-bar-btn__icon" />
          <span className="y-bar-btn__label">Filters</span>
          <span className="y-bar-btn__label-mobile">Filter Vaults</span>
          {activeFiltersCount > 0 && <span className="y-filters-badge">{activeFiltersCount}</span>}
        </button>

        <button
          type="button"
          className={`y-bar-btn y-bar-btn--wide${compareMode ? ' is-active' : ''}`}
          aria-label="Compare vaults"
          aria-pressed={compareMode}
          onClick={onToggleCompareMode}
        >
          <Compare size={16} />
          <span className="y-bar-btn__label">Compare</span>
        </button>

        <button
          type="button"
          className="y-bar-btn y-bar-btn--search-toggle"
          aria-label="Search vaults"
          aria-expanded={isSearchOpen}
          onClick={() => setSearchOpen((prev) => !prev)}
        >
          <SearchIcon size={16} />
        </button>

        <div className={`y-search${isSearchOpen ? ' is-open' : ''}`}>
          <input
            className="y-search__input"
            type="text"
            placeholder="Find a Vault"
            value={search}
            aria-label="Find a Vault"
            onChange={(event) => onSearchChange(event.target.value)}
          />
          {search && (
            <button
              type="button"
              className="y-search__clear"
              aria-label="Clear search"
              onClick={() => onSearchChange('')}
            >
              <Close size={12} />
            </button>
          )}
          <span className="y-search__icon" aria-hidden="true">
            <SearchIcon size={16} />
          </span>
        </div>
      </div>
    </div>
  );
};
