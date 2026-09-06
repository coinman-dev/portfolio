import React, { useState } from 'react';
import { YearnLogo } from '../../assets/YearnLogo';
import { SHOW_YEARN_BRAND } from '../../constants';
import { Menu, Sun } from '../ui/icons';
import { Breadcrumbs, Crumb } from './Breadcrumbs';

export interface TopNavProps {
  activeView: 'vaults' | 'vault-detail' | 'portfolio';
  onNavigate: (view: 'vaults' | 'portfolio') => void;
  /** Rendered next to the logo; empty on the vaults list, where the logo is the way back. */
  breadcrumbs: Crumb[];
}

export const TopNav: React.FC<TopNavProps> = ({ activeView, onNavigate, breadcrumbs }) => {
  const [isMobileOpen, setMobileOpen] = useState(false);

  const go = (view: 'vaults' | 'portfolio') => {
    onNavigate(view);
    setMobileOpen(false);
  };

  return (
  <div className="y-topnav-wrap">
    <div className="y-container">
      <header className="y-topnav">
        <div className="y-topnav__left">
          {SHOW_YEARN_BRAND && (
            <button
              type="button"
              className="y-topnav__logo"
              aria-label="Yearn"
              onClick={() => onNavigate('vaults')}
            >
              <YearnLogo />
            </button>
          )}
          {breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
        </div>

        <button
          type="button"
          className="y-topnav__burger"
          aria-label="Menu"
          aria-expanded={isMobileOpen}
          onClick={() => setMobileOpen((prev) => !prev)}
        >
          <Menu size={24} />
        </button>

        <div className="y-topnav__right">
          <div className="y-topnav__links">
            <button
              type="button"
              className={`y-topnav__link${activeView !== 'portfolio' ? ' is-active' : ''}`}
              onClick={() => onNavigate('vaults')}
            >
              Vaults
            </button>
            <button
              type="button"
              className={`y-topnav__link${activeView === 'portfolio' ? ' is-active' : ''}`}
              onClick={() => onNavigate('portfolio')}
            >
              Portfolio
            </button>
          </div>
          {/* The CoinMan Earn page is dark-only; the control mirrors yearn.fi's layout.
              Connecting a wallet happens through the app's own Wallet Connect menu,
              so yearn.fi's Connect wallet button is intentionally not reproduced. */}
          <span className="y-topnav__theme-btn" aria-hidden="true">
            <Sun size={20} />
          </span>
        </div>
      </header>

      {isMobileOpen && (
        <div className="y-topnav__mobile">
          <button
            type="button"
            className={`y-topnav__mobile-link${activeView !== 'portfolio' ? ' is-active' : ''}`}
            onClick={() => go('vaults')}
          >
            Vaults
          </button>
          <button
            type="button"
            className={`y-topnav__mobile-link${activeView === 'portfolio' ? ' is-active' : ''}`}
            onClick={() => go('portfolio')}
          >
            Portfolio
          </button>
        </div>
      )}
    </div>
  </div>
  );
};
