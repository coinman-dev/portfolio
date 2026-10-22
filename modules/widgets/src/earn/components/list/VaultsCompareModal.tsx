import React from 'react';
import { YearnVault } from '../../types';
import { formatFeePercent, formatPercent, formatUSDFull } from '../../format';
import { getVaultKey, PRODUCT_KIND_LABELS, deriveListKind } from '../../vaultMeta';
import { getChain } from '../../yearnApi';
import { openExternal } from '../../openExternal';
import { Close, ExternalLink } from '../ui/icons';
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape';
import { TokenIcon } from '../TokenIcon';
import { RiskScoreTag } from '../shared/RiskScoreTag';
import { ApyValue } from './ApyCell';
import { getActiveStrategies } from './VaultRowExpanded';
import { useT } from '../../i18n';

interface VaultsCompareModalProps {
  isOpen: boolean;
  vaults: YearnVault[];
  onClose: () => void;
  onRemove: (key: string) => void;
}

interface CompareRowProps {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
}

const CompareRow: React.FC<CompareRowProps> = ({ label, sublabel, children }) => (
  <div className="y-compare-row">
    <div className="y-compare-row__labels">
      <span className="y-compare-row__label">{label}</span>
      {sublabel && <span className="y-compare-row__sublabel">{sublabel}</span>}
    </div>
    <div className="y-compare-row__value">{children}</div>
  </div>
);

const CompareCard: React.FC<{ vault: YearnVault; onRemove: (key: string) => void }> = ({
  vault,
  onRemove,
}) => {
  const t = useT();
  const chain = getChain(vault.chainID);
  const key = getVaultKey(vault);
  const strategies = getActiveStrategies(vault);
  const riskLevel = vault.info?.riskLevel ?? -1;
  const clampedRisk = Math.min(Math.max(riskLevel, 0), 5);
  const productLabel = PRODUCT_KIND_LABELS[deriveListKind(vault)];

  return (
    <div className="y-compare-card">
      <div className="y-compare-card__head">
        <button
          type="button"
          className="y-compare-card__remove"
          aria-label={t('Remove {name} from comparison', { name: vault.name })}
          onClick={() => onRemove(key)}
        >
          <Close size={16} />
        </button>
        <button
          type="button"
          className="y-compare-card__identity"
          aria-label={t('Open {name} vault in a new tab', { name: vault.name })}
          onClick={() => openExternal(`https://yearn.fi/vaults/${vault.chainID}/${vault.address}`)}
        >
          <span className="y-compare-card__identity-main">
            <TokenIcon
              src={vault.token?.icon}
              symbol={vault.token?.symbol || vault.symbol}
              size={36}
            />
            <span className="y-compare-card__identity-text">
              <span className="y-compare-card__name">{vault.name}</span>
              <span className="y-compare-card__chain">
                {chain.icon && <img src={chain.icon} alt="" width={14} height={14} />}
                <span>{chain.name}</span>
              </span>
            </span>
          </span>
          <ExternalLink size={16} className="y-compare-card__linkout" />
        </button>
      </div>

      <div className="y-compare-card__body">
        <CompareRow label={t('Est. APY')} sublabel={t('Forward net APR')}>
          <ApyValue vault={vault} align="left" />
        </CompareRow>
        <CompareRow label={t('Historical APY')} sublabel={t('Average realized')}>
          {formatPercent((vault.apr?.netAPR ?? 0) * 100)}
        </CompareRow>
        <CompareRow label={t('TVL')} sublabel={t('Total value locked')}>
          <span className="y-compare-row__strong">{formatUSDFull(vault.tvl?.tvl)}</span>
        </CompareRow>
        <CompareRow label={t('Fees')} sublabel={t('Mgmt / Perf')}>
          <div className="y-compare-fees">
            <span>
              <span className="y-compare-fees__label">{t('Management:')}</span>{' '}
              <span>{formatFeePercent(vault.apr?.fees?.management)}</span>
            </span>
            <span>
              <span className="y-compare-fees__label">{t('Performance:')}</span>{' '}
              <span>{formatFeePercent(vault.apr?.fees?.performance)}</span>
            </span>
          </div>
        </CompareRow>
        <CompareRow label={t('Risk')} sublabel={t('Security score')}>
          <div className="y-compare-risk">
            <RiskScoreTag riskLevel={riskLevel} />
            <span className="y-compare-row__sublabel">
              {t('Level {level} / 5', { level: clampedRisk })}
            </span>
          </div>
        </CompareRow>
        <CompareRow label={t('Type')} sublabel={t('Vault structure')}>
          <div className="y-compare-type">
            <span className="y-compare-type__main">{t(productLabel)}</span>
            <span className="y-compare-row__sublabel">{vault.kind ? t(vault.kind) : ''}</span>
          </div>
        </CompareRow>

        <div className="y-compare-card__strategies">
          <div className="y-compare-row__labels">
            <span className="y-compare-row__label">{t('Strategies')}</span>
            <span className="y-compare-row__sublabel">{t('Underlying positions')}</span>
          </div>
          {strategies.length === 0 ? (
            <span className="y-compare-card__dash">-</span>
          ) : (
            <div className="y-compare-card__strategy-list">
              {strategies.map((strategy) => {
                const debtRatio = strategy.details?.debtRatio;
                return (
                  <div className="y-compare-card__strategy" key={strategy.address}>
                    <span className="y-compare-card__strategy-name">{strategy.name}</span>
                    {debtRatio ? (
                      <span className="y-compare-row__sublabel">
                        {formatPercent(debtRatio / 100)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const VaultsCompareModal: React.FC<VaultsCompareModalProps> = ({
  isOpen,
  vaults,
  onClose,
  onRemove,
}) => {
  const t = useT();
  useCloseOnEscape(isOpen, onClose);

  if (!isOpen) return null;
  const canCompare = vaults.length >= 2;

  return (
    <div
      className="y-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="y-compare-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('Compare vaults')}
      >
        <div className="y-compare-modal__head">
          <div>
            <h2 className="y-compare-modal__title">{t('Compare vaults')}</h2>
            <p className="y-compare-modal__subtitle">{t('Review key metrics side-by-side.')}</p>
          </div>
          <button
            type="button"
            className="y-compare-modal__close"
            aria-label={t('Close comparison')}
            onClick={onClose}
          >
            <Close size={16} />
          </button>
        </div>

        <div className="y-compare-modal__scroll">
          {canCompare ? (
            <div className="y-compare-modal__grid" data-count={vaults.length}>
              {vaults.map((vault) => (
                <CompareCard key={getVaultKey(vault)} vault={vault} onRemove={onRemove} />
              ))}
            </div>
          ) : (
            <div className="y-compare-modal__empty">
              <p>{t('Select at least two vaults to compare.')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
