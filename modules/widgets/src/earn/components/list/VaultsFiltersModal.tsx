import React, { useEffect, useMemo, useState } from 'react';
import { Aggressiveness } from '../../vaultMeta';
import { Close, ChevronDown } from '../ui/icons';
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape';
import { useT } from '../../i18n';

export interface VaultFilters {
  assets: string[];
  minTvl: number;
  categories: string[];
  aggressiveness: Aggressiveness[];
  showSingleAssetStrategies: boolean;
  showLegacy: boolean;
}

export const DEFAULT_MIN_TVL = 50_000;

export const DEFAULT_FILTERS: VaultFilters = {
  assets: [],
  minTvl: DEFAULT_MIN_TVL,
  categories: [],
  aggressiveness: [],
  showSingleAssetStrategies: false,
  showLegacy: false,
};

export function countActiveFilters(filters: VaultFilters): number {
  let count = 0;
  count += filters.assets.length;
  if (filters.minTvl !== DEFAULT_MIN_TVL) count += 1;
  count += filters.categories.length;
  count += filters.aggressiveness.length;
  if (filters.showSingleAssetStrategies) count += 1;
  if (filters.showLegacy) count += 1;
  return count;
}

const CATEGORY_OPTIONS = ['Stablecoin', 'Volatile'];
const AGGRESSIVENESS_OPTIONS: Aggressiveness[] = ['Conservative', 'Moderate', 'Aggressive'];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

interface VaultsFiltersModalProps {
  isOpen: boolean;
  filters: VaultFilters;
  assetOptions: string[];
  onClose: () => void;
  onSave: (filters: VaultFilters) => void;
}

export const VaultsFiltersModal: React.FC<VaultsFiltersModalProps> = ({
  isOpen,
  filters,
  assetOptions,
  onClose,
  onSave,
}) => {
  const t = useT();
  const [draft, setDraft] = useState<VaultFilters>(filters);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');

  useEffect(() => {
    if (isOpen) {
      setDraft(filters);
      setAssetsOpen(false);
      setAssetSearch('');
    }
  }, [isOpen, filters]);

  useCloseOnEscape(isOpen, onClose);

  const visibleAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    if (!query) return assetOptions;
    return assetOptions.filter((asset) => asset.toLowerCase().includes(query));
  }, [assetOptions, assetSearch]);

  if (!isOpen) return null;

  const assetButtonLabel = draft.assets.length
    ? t('Filter by assets ({count})', { count: draft.assets.length })
    : t('Filter by assets');

  return (
    <div
      className="y-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="y-filters-modal" role="dialog" aria-modal="true" aria-label={t('Filters')}>
        <div className="y-filters-modal__head">
          <h2 className="y-filters-modal__title">{t('Filters')}</h2>
          <button
            type="button"
            className="y-filters-modal__close"
            aria-label={t('Close filters')}
            onClick={onClose}
          >
            <Close size={14} />
          </button>
        </div>

        <div className="y-filters-modal__body">
          <div>
            <p className="y-filters-modal__label">{t('Underlying Asset')}</p>
            <button
              type="button"
              className={`y-filters-modal__select${assetsOpen ? ' is-open' : ''}`}
              onClick={() => setAssetsOpen((prev) => !prev)}
            >
              <span>{assetButtonLabel}</span>
              <ChevronDown size={16} />
            </button>
            {assetsOpen && (
              <div className="y-filters-modal__assets">
                <input
                  className="y-filters-modal__input"
                  type="text"
                  placeholder={t('Search assets')}
                  aria-label={t('Search assets')}
                  value={assetSearch}
                  onChange={(event) => setAssetSearch(event.target.value)}
                />
                {visibleAssets.map((asset) => (
                  <label className="y-check-row" key={asset}>
                    <span className="y-check-row__title">{asset}</span>
                    <input
                      type="checkbox"
                      checked={draft.assets.includes(asset)}
                      onChange={() =>
                        setDraft((prev) => ({ ...prev, assets: toggle(prev.assets, asset) }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="y-filters-modal__label">{t('Minimum TVL')}</p>
            <div className="y-filters-modal__tvl">
              <span>$</span>
              <input
                type="number"
                min={0}
                step={1}
                aria-label={t('Minimum TVL')}
                value={draft.minTvl}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, minTvl: Number(event.target.value) || 0 }))
                }
              />
            </div>
          </div>

          <div>
            <p className="y-filters-modal__label">{t('Asset Category')}</p>
            <div className="y-check-stack">
              {CATEGORY_OPTIONS.map((category) => (
                <label className="y-check-row" key={category}>
                  <span className="y-check-row__title">{t(category)}</span>
                  <input
                    type="checkbox"
                    checked={draft.categories.includes(category)}
                    onChange={() =>
                      setDraft((prev) => ({
                        ...prev,
                        categories: toggle(prev.categories, category),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="y-filters-modal__label">{t('Vault Aggressiveness')}</p>
            <div className="y-check-stack">
              {AGGRESSIVENESS_OPTIONS.map((option) => (
                <label className="y-check-row" key={option}>
                  <span className="y-check-row__title">{t(option)}</span>
                  <input
                    type="checkbox"
                    checked={draft.aggressiveness.includes(option)}
                    onChange={() =>
                      setDraft((prev) => ({
                        ...prev,
                        aggressiveness: toggle(prev.aggressiveness, option),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </div>

          <details className="y-filters-modal__advanced">
            <summary>{t('Advanced')}</summary>
            <span className="y-filters-modal__advanced-note">
              {' '}
              {'\u26A0\uFE0F'}{' '}
              {t('It is not recommended to deposit to strategies or legacy vaults.')}
            </span>
            <div className="y-check-stack" style={{ marginTop: 16 }}>
              <label className="y-check-row">
                <span className="y-check-row__text">
                  <span className="y-check-row__title">{t('Show single asset strategies')}</span>
                  <span className="y-check-row__desc">
                    {t(
                      'Checking this will show the underlying strategies used in Single Asset Vaults in the list.'
                    )}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={draft.showSingleAssetStrategies}
                  onChange={() =>
                    setDraft((prev) => ({
                      ...prev,
                      showSingleAssetStrategies: !prev.showSingleAssetStrategies,
                    }))
                  }
                />
              </label>
              <label className="y-check-row">
                <span className="y-check-row__text">
                  <span className="y-check-row__title">{t('Show legacy vaults')}</span>
                  <span className="y-check-row__desc">
                    {t('Includes legacy vaults in the list.')}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={draft.showLegacy}
                  onChange={() => setDraft((prev) => ({ ...prev, showLegacy: !prev.showLegacy }))}
                />
              </label>
            </div>
          </details>
        </div>

        <div className="y-filters-modal__footer">
          <button
            type="button"
            className="y-btn y-btn--ghost y-btn--pill"
            onClick={() => setDraft(DEFAULT_FILTERS)}
          >
            {t('Clear')}
          </button>
          <button
            type="button"
            className="y-btn y-btn--light y-btn--pill"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            {t('Save')}
          </button>
        </div>
      </div>
    </div>
  );
};
