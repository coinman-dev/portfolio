import React from 'react';

export interface Crumb {
  label: string;
  onClick?: () => void;
}

export const Breadcrumbs: React.FC<{ items: Crumb[] }> = ({ items }) => (
  <nav className="y-breadcrumbs" aria-label="Breadcrumb">
    {items.map((crumb, index) => {
      const isLast = index === items.length - 1;
      return (
        <React.Fragment key={`${crumb.label}-${index}`}>
          {index > 0 && (
            <span className="y-breadcrumbs__sep" aria-hidden="true">
              &gt;
            </span>
          )}
          {isLast || !crumb.onClick ? (
            <span className="y-breadcrumbs__item is-current" aria-current="page">
              {crumb.label}
            </span>
          ) : (
            <button type="button" className="y-breadcrumbs__item" onClick={crumb.onClick}>
              {crumb.label}
            </button>
          )}
        </React.Fragment>
      );
    })}
  </nav>
);
