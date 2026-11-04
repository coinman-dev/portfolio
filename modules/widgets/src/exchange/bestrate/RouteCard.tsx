import React, { useState } from 'react';
import { BrToken } from './types';
import { RankedRoute } from './search';
import { formatAmount, formatDuration, formatPct, formatUSD } from './format';
import { useT } from './i18n';

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
  /** Why a hand-sent deposit cannot be prepared; null when it can. Undefined hides the button. */
  depositBlocker?: string | null;
  onDeposit?: () => void;
}

export const RouteCard: React.FC<RouteCardProps> = ({
  route,
  toToken,
  bestNetUSD,
  onOpenSite,
  swapBlocker,
  onSwap,
  depositBlocker,
  onDeposit,
}) => {
  const t = useT();
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
              {t(BADGE_LABELS[badge])}
            </span>
          ))}
          {route.estimateOnly && <span className="br-badge br-badge--estimate">{t('Estimate · site only')}</span>}
          {route.suspicious && <span className="br-badge br-badge--bad">{t('Too good to be true')}</span>}
          {route.heavyLoss && <span className="br-badge br-badge--bad">{t('Loses over 3%')}</span>}
          {route.capacityWarning && (
            <span className="br-badge br-badge--bad" title={route.capacityWarning}>
              {t('Thin liquidity')}
              {route.capacityAvailable && ` (${t('available: {amount}', { amount: route.capacityAvailable })})`}
            </span>
          )}
        </div>
        <span className="br-route__rel" title={t(RELIABILITY_TITLES[route.reliability])}>
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
            {formatUSD(route.toUSD)} · <strong>{route.providerName}</strong> {t('via')} {route.via}
          </div>
        </div>
        <div className="br-route__actions">
          {swapBlocker !== undefined && (
            <button
              type="button"
              className="br-btn br-btn--primary"
              disabled={swapBlocker !== null}
              title={swapBlocker ?? t('Review and sign this route from your wallet')}
              onClick={onSwap}
            >
              {t('Swap')}
            </button>
          )}
          {depositBlocker !== undefined && (
            <button
              type="button"
              className="br-btn br-btn--primary"
              disabled={depositBlocker !== null}
              title={depositBlocker ?? t('Get the address and memo to send from your own wallet')}
              onClick={onDeposit}
            >
              {t('Deposit')}
            </button>
          )}
          <button
            type="button"
            className="br-btn br-btn--ghost"
            title={route.site.inApp ? t('Opens its tab here with this pair') : t('Opens the site in the browser')}
            onClick={() => onOpenSite(route.site.url)}
          >
            {route.site.name} {route.site.inApp ? '→' : '↗'}
          </button>
        </div>
      </div>

      <div className="br-route__facts">
        <span title={t('What arrives, minus gas and fees paid on top')}>
          {t('Net')} <strong>{formatUSD(route.netUSD)}</strong>
          {behind > 0.005 && <em className="br-behind"> −{formatUSD(behind)}</em>}
        </span>
        <span title={route.serviceFeeNote && t(route.serviceFeeNote)}>
          {t('Service fee')} <strong>{formatPct(route.serviceFeePct)}</strong>
          {route.serviceFeeNote && <em className="br-muted">*</em>}
        </span>
        <span title={route.gasGuessed ? t('Not quoted by the service; typical gas on this chain') : undefined}>
          {t('Gas')} <strong>{route.gasGuessed ? '~' : ''}{formatUSD(route.gasUSD ?? 0)}</strong>
        </span>
        {route.extraUSD > 0 && (
          <span>
            {t('Extra')} <strong>{formatUSD(route.extraUSD)}</strong>
          </span>
        )}
        <span>
          {t('Time')} <strong>{formatDuration(route.durationSec)}</strong>
        </span>
        <button type="button" className="br-link" onClick={() => setOpen(!open)}>
          {open ? t('Less') : t('Details')}
        </button>
      </div>

      {open && (
        <div className="br-route__details">
          {route.toAmountMin != null && (
            <div>
              {t('Minimum received: {amount} {symbol}', {
                amount: formatAmount(route.toAmountMin, toToken.decimals),
                symbol: toToken.symbol,
              })}
            </div>
          )}
          {route.fees.map((fee, i) => (
            <div key={i}>
              {t(fee.label)}: {formatUSD(fee.usd)} {fee.included ? t('(already deducted)') : t('(paid on top)')}
            </div>
          ))}
          {route.serviceFeeNote && <div>{t('* Service fee {note}.', { note: t(route.serviceFeeNote) })}</div>}
          {route.note && <div>{t(route.note)}</div>}
          {route.capacityWarning && <div className="br-warn">{route.capacityWarning}</div>}
          <div>{t('Reliability: {level}.', { level: t(RELIABILITY_TITLES[route.reliability]) })}</div>
        </div>
      )}
    </div>
  );
};

const COLLAPSED_ROWS = 2;

/** First route of each service, in rank order. */
function bestPerService(routes: RankedRoute[]): RankedRoute[] {
  const seen = new Set<string>();
  return routes.filter((route) => {
    if (seen.has(route.provider)) return false;
    seen.add(route.provider);
    return true;
  });
}

interface RouteSectionProps {
  title: string;
  hint: string;
  empty: string;
  routes: RankedRoute[];
  expanded: boolean;
  onToggle: () => void;
  renderCard: (route: RankedRoute) => React.ReactNode;
}

/** A titled list: its best two routes, from different services, until expanded to all. */
export const RouteSection: React.FC<RouteSectionProps> = ({
  title,
  hint,
  empty,
  routes,
  expanded,
  onToggle,
  renderCard,
}) => {
  const t = useT();
  const collapsed = bestPerService(routes).slice(0, COLLAPSED_ROWS);
  const shown = expanded ? routes : collapsed;
  const hidden = routes.length - collapsed.length;
  return (
    <section className="br-section">
      <div className="br-section__head">
        <h4>{title}</h4>
        <span className="br-muted">{hint}</span>
      </div>
      {routes.length === 0 ? (
        <div className="br-muted br-section__empty">{empty}</div>
      ) : (
        <div className="br-routes">{shown.map(renderCard)}</div>
      )}
      {hidden > 0 && (
        <button type="button" className="br-link br-section__more" onClick={onToggle}>
          {expanded ? t('Show less') : t('Show more ({count})', { count: hidden })}
        </button>
      )}
    </section>
  );
};
