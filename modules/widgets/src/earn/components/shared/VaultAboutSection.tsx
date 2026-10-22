import React, { useState } from 'react';
import { YearnVault } from '../../types';
import { getChain } from '../../yearnApi';
import { formatAPY, shortenAddress } from '../../format';
import { openExternal } from '../../openExternal';
import { Markdown } from './Markdown';
import {
  deriveListKind,
  formatFeeDetailLabel,
  getCategoryDescription,
  getChainDescription,
  getChainWebsite,
  getKindDescription,
  getProductTypeDescription,
  getProductTypeInfo,
  getStrategyKind,
  getStrategyKindLabel,
  NO_DESCRIPTION_TEXT,
} from '../../vaultMeta';
import { ChevronDown, Copy, Check, ExternalLink, Lock, Unlock } from '../ui/icons';
import { YVUSD_COOLDOWN_DAYS } from '../../constants';
import { useT } from '../../i18n';
import { translateVaultDescription } from '../../i18n/descriptions';

interface AccordionProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  isOpenByDefault?: boolean;
  children: React.ReactNode;
}

const Accordion: React.FC<AccordionProps> = ({
  label,
  value,
  icon,
  isOpenByDefault = false,
  children,
}) => {
  const [open, setOpen] = useState(isOpenByDefault);
  return (
    <div className="y-acc">
      <button
        type="button"
        className="y-acc__summary"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <span className="y-sr-only">{`${label}:`}</span>
        <span className="y-acc__value">
          <span>{value}</span>
          {icon && <span className="y-acc__icon">{icon}</span>}
          <span className={`y-acc__chevron${open ? ' is-open' : ''}`}>
            <ChevronDown size={12} />
          </span>
        </span>
      </button>
      {open && <div className="y-acc__body">{children}</div>}
    </div>
  );
};

interface AddressRowProps {
  label: string;
  address: string;
  explorer: string;
}

const AddressRow: React.FC<AddressRowProps> = ({ label, address, explorer }) => {
  const t = useT();
  const labelText = t(label);
  const [copied, setCopied] = useState(false);
  return (
    <div className="y-addr-row">
      <p className="y-addr-row__label">{labelText}</p>
      <div className="y-addr-row__value">
        <button
          type="button"
          className="y-addr-row__link"
          aria-label={t('View on block explorer')}
          onClick={(event) => {
            event.stopPropagation();
            openExternal(`${explorer}/address/${address}`);
          }}
        >
          {shortenAddress(address, 6, 4)}
          <ExternalLink size={12} />
        </button>
        <button
          type="button"
          className="y-addr-row__copy"
          aria-label={t('Copy {label}', { label: labelText.toLowerCase() })}
          onClick={(event) => {
            event.stopPropagation();
            void navigator.clipboard?.writeText(address);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
};

interface VaultAboutSectionProps {
  vault: YearnVault;
  /** yearn.fi hides the "Allocator"/"Strategy" suffix in the vault list. */
  showKind?: boolean;
}

/** Left column of the expanded row / vault detail - 1:1 with yearn.fi's VaultAboutSection. */
export const VaultAboutSection: React.FC<VaultAboutSectionProps> = ({ vault, showKind = true }) => {
  const t = useT();
  const chain = getChain(vault.chainID);
  const chainWebsite = getChainWebsite(vault.chainID);
  const listKind = deriveListKind(vault);
  const strategyKind = getStrategyKind(vault);
  const strategyKindLabel = showKind ? getStrategyKindLabel(vault) : undefined;
  const productInfo = getProductTypeInfo(vault);
  const vaultTypeText = [t(productInfo.label), strategyKindLabel ? t(strategyKindLabel) : undefined]
    .filter(Boolean)
    .join(' | ');
  const fees = formatFeeDetailLabel(vault.apr.fees);
  const unlockedApy = vault.apr.forwardAPR?.netAPR || vault.apr.netAPR;
  const rawDescription = vault.description || vault.token?.description;
  const descriptionText = rawDescription
    ? translateVaultDescription(rawDescription, vault.token?.symbol || vault.symbol)
    : '';

  const addresses: { label: string; address: string }[] = vault.lockedTwin
    ? [
        { label: 'Unlocked Vault Contract Address', address: vault.address },
        { label: 'Locked Vault Contract Address', address: vault.lockedTwin.address },
        { label: 'Token Contract Address', address: vault.token.address },
      ]
    : [
        { label: 'Vault Contract Address', address: vault.address },
        { label: 'Token Contract Address', address: vault.token.address },
      ];

  if (vault.staking?.address && vault.staking.available) {
    addresses.push({ label: 'Staking Contract Address', address: vault.staking.address });
  }

  return (
    <div className="y-about">
      <div className="y-about__description">
        {descriptionText ? <Markdown content={descriptionText} /> : t(NO_DESCRIPTION_TEXT)}
      </div>

      <div className="y-about__list">
        {vault.lockedTwin && (
          <Accordion
            label={t('Additional Features')}
            value={t('Additional Features')}
            isOpenByDefault
          >
            <div className="y-about__features">
              <div className="y-kv">
                <span className="y-kv__label">
                  <Lock size={12} />
                  {t('Locked APY')}
                </span>
                <span className="y-kv__value">{formatAPY(vault.lockedTwin.netAPR)}</span>
              </div>
              <div className="y-kv">
                <span className="y-kv__label">
                  <Unlock size={12} />
                  {t('Unlocked APY')}
                </span>
                <span className="y-kv__value">{formatAPY(unlockedApy)}</span>
              </div>
              <div className="y-about__notes">
                <p>
                  <b>{t('Locked:')}</b>{' '}
                  {t('Shares require a {days}-day cooldown before withdrawal.', {
                    days: YVUSD_COOLDOWN_DAYS,
                  })}
                </p>
                <p>
                  <b>{t('Unlocked:')}</b> {t('Shares can be withdrawn without a cooldown.')}
                </p>
              </div>
            </div>
          </Accordion>
        )}

        <Accordion label={t('Addresses')} value={t('Addresses')}>
          <div className="y-about__addresses">
            {addresses.map((item) => (
              <AddressRow
                key={`${item.label}-${item.address}`}
                label={item.label}
                address={item.address}
                explorer={chain.blockExplorer}
              />
            ))}
          </div>
        </Accordion>

        <Accordion
          label={t('Chain')}
          value={chain.name}
          icon={<img src={chain.icon} alt="" width={16} height={16} />}
        >
          <p>
            {t(getChainDescription(vault.chainID))}
            {chainWebsite ? (
              <>
                {' '}
                {t('Learn more about {chain} at', { chain: chain.name })}{' '}
                <button
                  type="button"
                  className="y-about__link"
                  onClick={(event) => {
                    event.stopPropagation();
                    openExternal(chainWebsite);
                  }}
                >
                  {chainWebsite}
                  <ExternalLink size={12} />
                </button>
              </>
            ) : null}
          </p>
        </Accordion>

        <Accordion
          label={t('Asset Type')}
          value={vault.category ? t(vault.category) : t('Not specified')}
        >
          <p>{t(getCategoryDescription(vault.category) || 'No asset category provided.')}</p>
        </Accordion>

        <Accordion label={t('Vault Type')} value={vaultTypeText}>
          <div className="y-about__stack">
            <p>{t(getProductTypeDescription(listKind))}</p>
            {strategyKindLabel && (
              <p>{t(getKindDescription(strategyKind, strategyKindLabel))}</p>
            )}
          </div>
        </Accordion>

        <Accordion
          label={t('Fees')}
          value={
            <>
              <b>{fees.management}</b> {t('Management Fee')} | <b>{fees.performance}</b>{' '}
              {t('Performance Fee')}
            </>
          }
        >
          <div className="y-about__stack">
            <p>
              <b>{t('Management fees')}</b>{' '}
              {t(
                'are claimed from earned yield, pro-rated and up to the stated percentage of principal.'
              )}
            </p>
            <p>
              <b>{t('Performance fees')}</b>{' '}
              {t('are claimed from earned yield, up to the stated percentage of yield earned.')}
            </p>
          </div>
        </Accordion>
      </div>
    </div>
  );
};
