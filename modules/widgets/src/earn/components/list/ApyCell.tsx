import React, { useState } from 'react';
import { YearnVault } from '../../types';
import { formatAPY } from '../../format';
import { Lock, Unlock } from '../ui/icons';
import { YVUSD_COOLDOWN_DAYS } from '../../constants';
import { getHeadlineAPY, isNewVaultAPY } from '../../vaultMeta';

const KATANA_CHAIN_ID = 747474;

interface ApyCellProps {
  vault: YearnVault;
  /** Number of 12-column grid units this cell spans. */
  span: number;
  interactiveHoverProps?: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
}

interface BreakdownRow {
  label: string;
  value: string;
  icon?: React.ReactNode;
}

interface Breakdown {
  rows: BreakdownRow[];
  notes?: { term: string; text: string }[];
  ariaLabel: string;
}

function buildBreakdown(vault: YearnVault): Breakdown | null {
  if (vault.lockedTwin) {
    const unlocked = vault.apr.forwardAPR?.netAPR || vault.apr.netAPR || 0;
    return {
      ariaLabel: 'Show yvUSD APY breakdown',
      rows: [
        { label: 'Locked APY', value: formatAPY(vault.lockedTwin.netAPR), icon: <Lock size={12} /> },
        { label: 'Unlocked APY', value: formatAPY(unlocked), icon: <Unlock size={12} /> },
      ],
      notes: [
        {
          term: 'Locked:',
          text: `Shares require a ${YVUSD_COOLDOWN_DAYS}-day cooldown before withdrawal.`,
        },
        { term: 'Unlocked:', text: 'Shares can be withdrawn without a cooldown.' },
      ],
    };
  }

  // Katana: native yield plus KAT app rewards (yearn.fi's "Katana Est. APY breakdown").
  const appRewards = vault.chainID === KATANA_CHAIN_ID ? vault.apr.extra?.katanaAppRewardsAPR : undefined;
  if (appRewards !== undefined && appRewards > 0) {
    const native = vault.apr.forwardAPR?.netAPR || 0;
    return {
      ariaLabel: `Show ${vault.name} APY breakdown`,
      rows: [
        { label: 'Est. Native APY', value: formatAPY(native) },
        { label: 'App Rewards APR', value: formatAPY(appRewards) },
        { label: 'Total APY', value: formatAPY(getHeadlineAPY(vault)) },
      ],
      notes: [{ term: 'KAT:', text: 'This Vault is receiving KAT incentives.' }],
    };
  }

  const boost = vault.chainID === 1 ? vault.apr.forwardAPR?.composite?.boost || 0 : 0;
  if (boost > 0) {
    return {
      ariaLabel: `Show ${vault.name} APY breakdown`,
      rows: [{ label: 'Boost', value: `${boost.toFixed(2)}x` }],
    };
  }

  return null;
}

/** Est. APY value with dotted underline + `*` whenever a breakdown exists. */
export const ApyValue: React.FC<{ vault: YearnVault; align?: 'left' | 'right' }> = ({
  vault,
  align = 'right',
}) => {
  const [open, setOpen] = useState(false);
  const breakdown = buildBreakdown(vault);
  const headline = isNewVaultAPY(vault)
    ? 'NEW'
    : `${vault.info?.isBoosted ? '⚡️ ' : ''}${formatAPY(getHeadlineAPY(vault))}`;

  if (!breakdown) {
    return <b className="y-row__value">{headline}</b>;
  }

  return (
    <span
      className={`y-apy${align === 'left' ? ' y-apy--left' : ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={breakdown.ariaLabel}
        className="y-apy__underline"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setOpen((prev) => !prev);
        }}
      >
        <b className="y-row__value">{headline}</b>
        <span aria-hidden="true" className="y-apy__star">
          *
        </span>
      </button>
      {open && (
        <div className="y-apy-tooltip" role="tooltip">
          {breakdown.rows.map((row) => (
            <div className="y-apy-tooltip__row" key={row.label}>
              <span>
                {row.icon}
                {row.label}
              </span>
              <b>{row.value}</b>
            </div>
          ))}
          {breakdown.notes && (
            <div className="y-apy-tooltip__notes">
              {breakdown.notes.map((note) => (
                <p key={note.term}>
                  <b>{note.term}</b> {note.text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
};

/** Grid cell wrapper for the vaults list. The label only shows below `md`,
 *  where the list head is hidden and each row carries its own captions. */
export const ApyCell: React.FC<ApyCellProps> = ({ vault, span, interactiveHoverProps }) => (
  <div className={`y-row__cell y-span-${span}`} datatype="number" {...interactiveHoverProps}>
    <span className="y-row__cell-label">Est. APY:</span>
    <ApyValue vault={vault} />
  </div>
);
