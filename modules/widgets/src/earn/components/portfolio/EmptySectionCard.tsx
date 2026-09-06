import React from 'react';

interface EmptySectionCardProps {
  title: string;
  description?: string;
  ctaLabel: string;
  onCta: () => void;
  secondaryCtaLabel?: string;
  onSecondaryCta?: () => void;
}

/** The bordered "connect a wallet" panel yearn.fi shows on every portfolio tab. */
export const EmptySectionCard: React.FC<EmptySectionCardProps> = ({
  title,
  description,
  ctaLabel,
  onCta,
  secondaryCtaLabel,
  onSecondaryCta,
}) => (
  <div className="y-pf-empty">
    <div className="y-pf-empty__inner">
      <p className="y-pf-empty__title">{title}</p>
      {description && <p className="y-pf-empty__desc">{description}</p>}
      <div className="y-pf-empty__actions">
        <button type="button" className="y-btn y-btn--light" onClick={onCta}>
          {ctaLabel}
        </button>
        {secondaryCtaLabel && onSecondaryCta && (
          <button type="button" className="y-btn y-pf-empty__secondary" onClick={onSecondaryCta}>
            {secondaryCtaLabel}
          </button>
        )}
      </div>
    </div>
  </div>
);
