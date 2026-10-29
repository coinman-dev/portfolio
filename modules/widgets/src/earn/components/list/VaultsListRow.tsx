import React, { useState } from 'react';
import { YearnVault } from '../../types';
import { getChain } from '../../yearnApi';
import { formatTVL, formatUSD } from '../../format';
import {
  deriveAssetCategory,
  formatFeeDetailLabel,
  getCategoryDescription,
  getChainDescription,
  getFeeStructureKey,
  getProductTypeInfo,
  getProductTypeDescription,
  deriveListKind,
  getVaultKey,
  FEE_CHIP_DESCRIPTION,
  RETIRED_TAG_DESCRIPTION,
  ProductType,
} from '../../vaultMeta';
import { VaultAvatar } from './VaultAvatar';
import { VaultsListChip } from './VaultsListChip';
import { ApyCell } from './ApyCell';
import { VaultRowExpanded } from './VaultRowExpanded';
import { ChevronDown, Check } from '../ui/icons';
import { useT } from '../../i18n';

interface VaultsListRowProps {
  vault: YearnVault;
  isExpanded: boolean;
  onToggleExpanded: (key: string, next: boolean) => void;
  onSelectVault: (vault: YearnVault) => void;
  activeChains: number[];
  activeCategories: string[];
  activeProductType: ProductType | 'all';
  activeFeeStructureKey: string | null;
  onToggleChain: (chainId: number) => void;
  onToggleCategory: (category: string) => void;
  onToggleProductType: (productType: ProductType) => void;
  onToggleFeeStructure: (key: string) => void;
  compareMode: boolean;
  isCompared: boolean;
  onToggleCompare: (vault: YearnVault) => void;
  showHoldings?: boolean;
  holdingsValue?: number;
}

export const VaultsListRow: React.FC<VaultsListRowProps> = ({
  vault,
  isExpanded,
  onToggleExpanded,
  onSelectVault,
  activeChains,
  activeCategories,
  activeProductType,
  activeFeeStructureKey,
  onToggleChain,
  onToggleCategory,
  onToggleProductType,
  onToggleFeeStructure,
  compareMode,
  isCompared,
  onToggleCompare,
  showHoldings = false,
  holdingsValue = 0,
}) => {
  const t = useT();
  const chain = getChain(vault.chainID);
  const vaultKey = getVaultKey(vault);
  const productInfo = getProductTypeInfo(vault);
  const derivedCategory = deriveAssetCategory(vault);
  const showDerivedCategory = productInfo.productType === 'lp' && derivedCategory !== vault.category;
  const feeKey = getFeeStructureKey(vault.apr.fees);
  const feeDetail = formatFeeDetailLabel(vault.apr.fees);
  const tvl = vault.tvl?.tvl || 0;
  const apySpan = showHoldings ? 4 : 6;
  const tvlSpan = showHoldings ? 4 : 5;

  const [interactiveHovers, setInteractiveHovers] = useState(0);
  const isHoveringInteractive = interactiveHovers > 0;

  // yearn.fi suppresses the row hover wash while the pointer sits on a
  // nested control (compare checkbox, chips, APY tooltip triggers).
  const interactiveHoverProps = {
    onMouseEnter: () => setInteractiveHovers((count) => count + 1),
    onMouseLeave: () => setInteractiveHovers((count) => Math.max(0, count - 1)),
  };

  const handleActivate = () => {
    if (compareMode) {
      onToggleCompare(vault);
      return;
    }
    onSelectVault(vault);
  };

  return (
    <div className="y-row">
      <button
        type="button"
        aria-label={isExpanded ? t('Collapse row') : t('Expand row')}
        aria-expanded={isExpanded}
        data-tour="vaults-row-expand"
        className={`y-row__chevron${isExpanded ? ' is-open' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggleExpanded(vaultKey, !isExpanded);
        }}
      >
        <ChevronDown size={16} />
      </button>

      <div
        className="y-row__link"
        role="button"
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleActivate();
          }
        }}
      >
        <div className={`y-row__hover${isHoveringInteractive ? ' is-suppressed' : ''}`} />
        {isExpanded && (
          <div className={`y-row__fade${isHoveringInteractive ? ' is-suppressed' : ''}`} />
        )}

        <div className="y-row__main">
          <div className="y-row__identity">
            {compareMode && (
              <span
                role="checkbox"
                aria-checked={isCompared}
                aria-label={
                  isCompared
                    ? t('Remove {name} from comparison', { name: vault.name })
                    : t('Add {name} to comparison', { name: vault.name })
                }
                tabIndex={0}
                className={`y-row__compare${isCompared ? ' is-checked' : ''}`}
                {...interactiveHoverProps}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCompare(vault);
                }}
              >
                {isCompared && <Check size={12} />}
              </span>
            )}

            <VaultAvatar
              icon={vault.icon}
              tokenIcon={vault.token?.icon}
              symbol={vault.token?.symbol || vault.symbol}
              chainId={vault.chainID}
              tokenAddress={vault.token?.address}
              size={40}
            />

            <div className="y-row__text">
              <strong title={vault.name} className="y-row__name">
                {vault.name}
              </strong>
              <div className="y-row__chips" {...interactiveHoverProps}>
                <VaultsListChip
                  className="y-chip--md-only"
                  label={chain.name}
                  isActive={activeChains.includes(vault.chainID)}
                  title={t(getChainDescription(vault.chainID))}
                  ariaLabel={t('Filter by {item}', { item: chain.name })}
                  onClick={() => onToggleChain(vault.chainID)}
                />
                {vault.category && (
                  <VaultsListChip
                    label={t(vault.category)}
                    isActive={activeCategories.includes(vault.category)}
                    title={
                      getCategoryDescription(vault.category)
                        ? t(getCategoryDescription(vault.category)!)
                        : undefined
                    }
                    ariaLabel={t('Filter by {item}', { item: t(vault.category) })}
                    onClick={() => onToggleCategory(vault.category)}
                  />
                )}
                {showDerivedCategory && (
                  <VaultsListChip
                    label={t(derivedCategory)}
                    isActive={activeCategories.includes(derivedCategory)}
                    title={
                      getCategoryDescription(derivedCategory)
                        ? t(getCategoryDescription(derivedCategory)!)
                        : undefined
                    }
                    ariaLabel={t('Filter by {item}', { item: t(derivedCategory) })}
                    onClick={() => onToggleCategory(derivedCategory)}
                  />
                )}
                <VaultsListChip
                  label={t(productInfo.label)}
                  isActive={activeProductType === productInfo.productType}
                  title={t(getProductTypeDescription(deriveListKind(vault)))}
                  ariaLabel={t(productInfo.ariaLabel)}
                  onClick={() => onToggleProductType(productInfo.productType)}
                />
                {vault.apr.fees && (
                  <VaultsListChip
                    className="y-chip--md-only"
                    label={t('Fees: {mgmt} | {perf}', {
                      mgmt: feeDetail.management,
                      perf: feeDetail.performance,
                    })}
                    isActive={activeFeeStructureKey === feeKey}
                    title={t(FEE_CHIP_DESCRIPTION)}
                    ariaLabel={t('Filter by {mgmt} management fee and {perf} performance fee', {
                      mgmt: feeDetail.management,
                      perf: feeDetail.performance,
                    })}
                    onClick={() => onToggleFeeStructure(feeKey)}
                  />
                )}
                {(vault.info?.isRetired || vault.details?.isRetired) && (
                  <VaultsListChip label={t('Retired')} title={t(RETIRED_TAG_DESCRIPTION)} />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="y-row__data">
          <ApyCell vault={vault} span={apySpan} interactiveHoverProps={interactiveHoverProps} />
          <div className={`y-row__cell y-span-${tvlSpan}`} datatype="number">
            <span className="y-row__cell-label">{t('TVL:')}</span>
            <p className="y-row__value">{formatTVL(tvl)}</p>
          </div>
          {showHoldings ? (
            <div className="y-row__cell y-span-4" datatype="number">
              <span className="y-row__cell-label">{t('Holdings:')}</span>
              <p className={`y-row__value${holdingsValue > 0 ? '' : ' is-muted'}`}>
                {holdingsValue > 0 ? formatUSD(holdingsValue) : '-'}
              </p>
            </div>
          ) : (
            <div className="y-span-1" />
          )}
        </div>
      </div>

      {isExpanded && (
        <VaultRowExpanded vault={vault} onNavigateToVault={() => onSelectVault(vault)} />
      )}
    </div>
  );
};
