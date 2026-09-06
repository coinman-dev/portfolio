import React, { useEffect, useState } from 'react';
import { YearnVault } from '../../types';
import { getChain } from '../../yearnApi';
import { formatLongDate, formatPPS, shortenAddress } from '../../format';
import { openExternal } from '../../openExternal';
import { LINKS } from '../../constants';
import { Check, Copy, ExternalLink } from '../ui/icons';
import { fetchVaultSnapshot } from '../../kongApi';
import { SectionCard } from './SectionCard';

interface AddressRowProps {
  label: string;
  address: string;
  explorer: string;
}

const AddressRow: React.FC<AddressRowProps> = ({ label, address, explorer }) => {
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isCopied) return;
    const timer = window.setTimeout(() => setIsCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [isCopied]);

  return (
    <div className="y-vd-info__row">
      <span className="y-vd-info__label">{label}</span>
      <span className="y-vd-info__value">
        <span className="y-vd-info__addr">{shortenAddress(address)}</span>
        <button
          type="button"
          aria-label={`View ${label.toLowerCase()} on the block explorer`}
          className="y-vd-info__icon"
          onClick={() => openExternal(`${explorer}/address/${address}`)}
        >
          <ExternalLink size={14} />
        </button>
        <button
          type="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          className="y-vd-info__icon"
          onClick={() => {
            void navigator.clipboard.writeText(address);
            setIsCopied(true);
          }}
        >
          {isCopied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </span>
    </div>
  );
};

interface LinkRowProps {
  label: string;
  cta: string;
  href: string;
}

const LinkRow: React.FC<LinkRowProps> = ({ label, cta, href }) => (
  <div className="y-vd-info__row">
    <span className="y-vd-info__label">{label}</span>
    <button type="button" className="y-vd-link" onClick={() => openExternal(href)}>
      {cta}
      <ExternalLink size={14} />
    </button>
  </div>
);

interface VaultMoreInfoSectionProps {
  vault: YearnVault;
  sectionRef?: React.Ref<HTMLElement>;
}

export const VaultMoreInfoSection: React.FC<VaultMoreInfoSectionProps> = ({
  vault,
  sectionRef,
}) => {
  const [deployedAt, setDeployedAt] = useState<number | null>(null);
  const chain = getChain(vault.chainID);
  const decimals = vault.decimals ?? vault.token?.decimals ?? 18;
  const hasLocked = Boolean(vault.lockedTwin);

  useEffect(() => {
    let cancelled = false;
    fetchVaultSnapshot(vault.chainID, vault.address)
      .then((snapshot) => {
        if (cancelled || !snapshot?.inceptTime) return;
        setDeployedAt(Number(snapshot.inceptTime) * 1000);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [vault.chainID, vault.address]);

  const pps = (raw?: string | null): string => {
    const value = Number(raw || 0);
    if (!Number.isFinite(value) || value === 0) return '—';
    return formatPPS(value / 10 ** decimals);
  };

  /** Locked yvUSD shares are priced in unlocked yvUSD, so both rates compound. */
  const lockedPps = (): string => {
    const locked = Number(vault.lockedTwin?.pricePerShare || 0) / 10 ** decimals;
    const unlocked = Number(vault.pricePerShare || 0) / 10 ** decimals;
    if (!locked || !unlocked) return '—';
    return formatPPS(locked * unlocked);
  };

  return (
    <SectionCard id="more" title="More Info" sectionRef={sectionRef} bodyClassName="y-vd-info">
      <AddressRow
        label={hasLocked ? 'Unlocked Vault Contract Address' : 'Vault Contract Address'}
        address={vault.address}
        explorer={chain.blockExplorer}
      />
      {hasLocked && vault.lockedTwin && (
        <AddressRow
          label="Locked Vault Contract Address"
          address={vault.lockedTwin.address}
          explorer={chain.blockExplorer}
        />
      )}
      <AddressRow
        label="Token Contract Address"
        address={vault.token.address}
        explorer={chain.blockExplorer}
      />
      {vault.staking?.address && vault.staking.available && (
        <AddressRow
          label="Staking Contract Address"
          address={vault.staking.address}
          explorer={chain.blockExplorer}
        />
      )}

      <div className="y-vd-info__row">
        <span className="y-vd-info__label">
          {hasLocked ? 'Unlocked Price Per Share' : 'Price Per Share'}
        </span>
        <span className="y-vd-info__value y-vd-info__addr">{pps(vault.pricePerShare)}</span>
      </div>
      {hasLocked && vault.lockedTwin && (
        <div className="y-vd-info__row">
          <span className="y-vd-info__label">Locked Price Per Share</span>
          <span className="y-vd-info__value y-vd-info__addr">
            {lockedPps()}
          </span>
        </div>
      )}

      {deployedAt !== null && (
        <div className="y-vd-info__row">
          <span className="y-vd-info__label">Deployed on</span>
          <span className="y-vd-info__value">{formatLongDate(deployedAt)}</span>
        </div>
      )}

      <LinkRow label="User Documentation" cta="View Documentation" href={LINKS.userDocs} />
      <LinkRow label="Developer Documentation" cta="View Documentation" href={LINKS.devDocs} />
      <LinkRow
        label="Powerglove Analytics Page"
        cta="View Page"
        href={LINKS.powerglove(vault.chainID, vault.address)}
      />
      <LinkRow
        label={`${vault.symbol} API`}
        cta="View API Data"
        href={LINKS.ydaemonVault(vault.chainID, vault.address)}
      />
      <LinkRow
        label="Vault Snapshot Data"
        cta="View API Data"
        href={LINKS.kongSnapshot(vault.chainID, vault.address)}
      />
    </SectionCard>
  );
};
