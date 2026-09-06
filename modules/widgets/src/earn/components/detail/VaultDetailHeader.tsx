import React from 'react';
import { YearnVault } from '../../types';
import { getChain } from '../../yearnApi';
import { formatAPY, formatUSD } from '../../format';
import { openExternal } from '../../openExternal';
import { ExternalLink, Lock } from '../ui/icons';
import { VaultAvatar } from '../list/VaultAvatar';
import { VaultsListChip } from '../list/VaultsListChip';
import {
  deriveAssetCategory,
  getCategoryDescription,
  getChainDescription,
  getKindDescription,
  getProductTypeDescription,
  getProductTypeInfo,
  getStrategyKind,
  getStrategyKindLabel,
  deriveListKind,
} from '../../vaultMeta';

export type DetailSection = 'performance' | 'info' | 'strategies' | 'risk' | 'more';

export const DETAIL_SECTIONS: { id: DetailSection; label: string }[] = [
  { id: 'performance', label: 'Performance' },
  { id: 'info', label: 'Vault Info' },
  { id: 'strategies', label: 'Strategies' },
  { id: 'risk', label: 'Risk' },
  { id: 'more', label: 'More Info' },
];

const KPI_TOOLTIPS = {
  estApy: 'Forward-looking net APY after fees, based on the current strategy allocation.',
  monthApy: 'Realised net APY over the last 30 days.',
  tvl: 'Total value locked in this vault, in USD.',
};

interface KpiCellProps {
  label: string;
  value: string;
  tooltip: string;
  showLock?: boolean;
}

const KpiCell: React.FC<KpiCellProps> = ({ label, value, tooltip, showLock }) => (
  <div className="y-vd-kpi">
    <span className="y-vd-kpi__label" title={tooltip}>
      {label}
    </span>
    <span className="y-vd-kpi__value">
      {value}
      {showLock && <Lock size={16} className="y-vd-kpi__lock" />}
    </span>
  </div>
);

/**
 * Vault avatar + name + explorer link, and (when expanded) the vault's chips.
 * yearn.fi shows this above the KPI card at the top of the page and folds it
 * into the card's first cell once the header sticks.
 */
export const VaultIdentity: React.FC<{ vault: YearnVault; isCompact: boolean }> = ({
  vault,
  isCompact,
}) => {
  const chain = getChain(vault.chainID);
  const product = getProductTypeInfo(vault);
  const listKind = deriveListKind(vault);
  const kindLabel = getStrategyKindLabel(vault);
  const category = deriveAssetCategory(vault);

  return (
    <div className={`y-vd-identity${isCompact ? ' is-compact' : ''}`}>
      <div className="y-vd-identity__row">
        <VaultAvatar
          icon={vault.icon}
          tokenIcon={vault.token?.icon}
          symbol={vault.token?.symbol || vault.symbol}
          chainId={vault.chainID}
          tokenAddress={vault.token?.address}
          size={isCompact ? 32 : 40}
        />
        <h1 className="y-vd-header__name">{vault.name}</h1>
        <button
          type="button"
          className="y-vd-header__explorer"
          aria-label={`View ${vault.name} on the block explorer`}
          onClick={() => openExternal(`${chain.blockExplorer}/address/${vault.address}`)}
        >
          <ExternalLink size={16} />
        </button>
      </div>

      {!isCompact && (
        <div className="y-vd-header__chips">
          <VaultsListChip label={chain.name} title={getChainDescription(vault.chainID)} />
          <VaultsListChip
            label={category}
            title={getCategoryDescription(category) || undefined}
          />
          <VaultsListChip label={product.label} title={getProductTypeDescription(listKind)} />
          {kindLabel && (
            <VaultsListChip
              label={kindLabel}
              title={getKindDescription(getStrategyKind(vault), kindLabel)}
            />
          )}
        </div>
      )}
    </div>
  );
};

interface VaultDetailHeaderProps {
  vault: YearnVault;
  activeSection: DetailSection;
  onSelectSection: (section: DetailSection) => void;
  isCompact: boolean;
}

export const VaultDetailHeader: React.FC<VaultDetailHeaderProps> = ({
  vault,
  activeSection,
  onSelectSection,
  isCompact,
}) => {
  const hasLocked = Boolean(vault.lockedTwin);

  const estApy = hasLocked
    ? vault.lockedTwin?.netAPR
    : vault.apr.forwardAPR?.netAPR ?? vault.apr.netAPR;
  const monthApy = hasLocked
    ? vault.lockedTwin?.monthAgo ?? vault.apr.points?.monthAgo
    : vault.apr.points?.monthAgo;

  return (
    <div className={`y-vd-header${isCompact ? ' is-compact' : ''}`}>
      <div className="y-vd-header__top">
        {/* Expanded, the identity sits above this card; compact, it folds in here. */}
        {isCompact && (
          <div className="y-vd-header__identity">
            <VaultIdentity vault={vault} isCompact />
          </div>
        )}

        <div className="y-vd-kpis">
          <KpiCell
            label="Est. APY"
            value={formatAPY(estApy)}
            tooltip={KPI_TOOLTIPS.estApy}
            showLock={hasLocked}
          />
          <KpiCell
            label="30 Day APY"
            value={formatAPY(monthApy)}
            tooltip={KPI_TOOLTIPS.monthApy}
            showLock={hasLocked}
          />
          <KpiCell label="TVL" value={formatUSD(vault.tvl?.tvl)} tooltip={KPI_TOOLTIPS.tvl} />
        </div>
      </div>

      <nav className="y-vd-tabs" aria-label="Vault sections">
        {DETAIL_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`y-vd-tab${activeSection === section.id ? ' is-active' : ''}`}
            aria-current={activeSection === section.id}
            onClick={() => onSelectSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>
    </div>
  );
};
