import React, { useState } from 'react';
import { BrToken } from './types';
import { RankedRoute } from './search';
import { formatAmount, formatDuration, formatPct, formatUSD } from './format';

const BADGE_LABELS = {
  recommended: 'Recommended',
  best: 'Most received',
  'zero-fee': '0% fee',
} as const;

const RELIABILITY_TITLES = {
  3: 'Proven: long record and heavy volume',
  2: 'Established, but newer or thinner liquidity',
  1: 'Little known — check before large amounts',
} as const;

interface RouteCardProps {
  route: RankedRoute;
  toToken: BrToken;
  /** Net USD of the top route, for the "−$x vs best" line. */
  bestNetUSD?: number;
  onOpenSite: (url: string) => void;
  /** Why this route cannot be signed here; null when it can. Undefined hides the button. */
  swapBlocker?: string | null;
  onSwap?: () => void;
}

export const RouteCard: React.FC<RouteCardProps> = ({
  route,
  toToken,
  bestNetUSD,
  onOpenSite,
  swapBlocker,
  onSwap,
}) => {
  const [open, setOpen] = useState(false);
  const behind = bestNetUSD != null ? bestNetUSD - route.netUSD : 0;
  const classes = [
    'br-route',
    route.badges.includes('recommended') ? 'is-recommended' : '',
    route.estimateOnly ? 'is-estimate' : '',
    route.suspicious ? 'is-suspicious' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <div className="br-route__head">
        <div className="br-route__badges">
          {route.badges.map((badge) => (
            <span key={badge} className={`br-badge br-badge--${badge}`}>
              {BADGE_LABELS[badge]}
            </span>
          ))}
          {route.estimateOnly && <span className="br-badge br-badge--estimate">Estimate · site only</span>}
          {route.suspicious && <span className="br-badge br-badge--bad">Too good to be true</span>}
          {route.heavyLoss && <span className="br-badge br-badge--bad">Loses over 3%</span>}
        </div>
        <span className="br-route__rel" title={RELIABILITY_TITLES[route.reliability]}>
          {'●'.repeat(route.reliability)}
          <span className="br-route__rel-off">{'●'.repeat(3 - route.reliability)}</span>
        </span>
      </div>

      <div className="br-route__main">
        <div>
          <div className="br-route__amount">
            {formatAmount(route.toAmount, toToken.decimals)} <span>{toToken.symbol}</span>
          </div>
          <div className="br-muted">
            {formatUSD(route.toUSD)} · <strong>{route.providerName}</strong> via {route.via}
          </div>
        </div>
        <div className="br-route__actions">
          {swapBlocker !== undefined && (
            <button
              type="button"
              className="br-btn br-btn--primary"
              disabled={swapBlocker !== null}
              title={swapBlocker ?? 'Review and sign this route from your wallet'}
              onClick={onSwap}
            >
              Swap
            </button>
          )}
          <button type="button" className="br-btn br-btn--ghost" onClick={() => onOpenSite(route.site.url)}>
            {route.site.name} ↗
          </button>
        </div>
      </div>

      <div className="br-route__facts">
        <span title="What arrives, minus gas and fees paid on top">
          Net <strong>{formatUSD(route.netUSD)}</strong>
          {behind > 0.005 && <em className="br-behind"> −{formatUSD(behind)}</em>}
        </span>
        <span title={route.serviceFeeNote}>
          Service fee <strong>{formatPct(route.serviceFeePct)}</strong>
          {route.serviceFeeNote && <em className="br-muted">*</em>}
        </span>
        <span title={route.gasGuessed ? 'Not quoted by the service; typical gas on this chain' : undefined}>
          Gas <strong>{route.gasGuessed ? '~' : ''}{formatUSD(route.gasUSD ?? 0)}</strong>
        </span>
        {route.extraUSD > 0 && (
          <span>
            Extra <strong>{formatUSD(route.extraUSD)}</strong>
          </span>
        )}
        <span>
          Time <strong>{formatDuration(route.durationSec)}</strong>
        </span>
        <button type="button" className="br-link" onClick={() => setOpen(!open)}>
          {open ? 'Less' : 'Details'}
        </button>
      </div>

      {open && (
        <div className="br-route__details">
          {route.toAmountMin != null && (
            <div>
              Minimum received: {formatAmount(route.toAmountMin, toToken.decimals)} {toToken.symbol}
            </div>
          )}
          {route.fees.map((fee, i) => (
            <div key={i}>
              {fee.label}: {formatUSD(fee.usd)} {fee.included ? '(already deducted)' : '(paid on top)'}
            </div>
          ))}
          {route.serviceFeeNote && <div>* Service fee {route.serviceFeeNote}.</div>}
          {route.note && <div>{route.note}</div>}
          <div>Reliability: {RELIABILITY_TITLES[route.reliability]}.</div>
        </div>
      )}
    </div>
  );
};
