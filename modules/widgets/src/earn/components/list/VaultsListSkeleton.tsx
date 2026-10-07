import React from 'react';

/** Loading placeholder row — 81px tall, matching yearn.fi. */
export const VaultsListRowSkeleton: React.FC = () => (
  <div className="y-row-skeleton" aria-hidden="true">
    <div className="y-row-skeleton__inner">
      <div className="y-row-skeleton__avatar" />
      <div className="y-row-skeleton__identity">
        <div className="y-row-skeleton__line y-row-skeleton__line--title" />
        <div className="y-row-skeleton__line y-row-skeleton__line--sub" />
      </div>
      <div className="y-row-skeleton__values">
        <div className="y-row-skeleton__line y-row-skeleton__value y-span-6" />
        <div className="y-row-skeleton__line y-row-skeleton__value y-span-5" />
        <div className="y-row-skeleton__chevron y-span-1" />
      </div>
    </div>
  </div>
);

export const VaultsListSkeleton: React.FC<{ rows?: number }> = ({ rows = 6 }) => (
  <div className="y-vaults-list">
    {Array.from({ length: rows }).map((_, index) => (
      <VaultsListRowSkeleton key={index} />
    ))}
  </div>
);
