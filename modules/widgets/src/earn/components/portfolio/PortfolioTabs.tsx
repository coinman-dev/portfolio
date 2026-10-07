import React from 'react';

export type PortfolioTabId = 'positions' | 'activity' | 'claim-rewards';

export const PORTFOLIO_TABS: { id: PortfolioTabId; label: string }[] = [
  { id: 'positions', label: 'Account Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'claim-rewards', label: 'Claim Rewards' },
];

interface PortfolioTabsProps {
  activeTab: PortfolioTabId;
  onSelectTab: (tab: PortfolioTabId) => void;
}

export const PortfolioTabs: React.FC<PortfolioTabsProps> = ({ activeTab, onSelectTab }) => (
  <div className="y-pf-tabs" role="tablist" aria-label="Portfolio sections">
    {PORTFOLIO_TABS.map((tab) => (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={activeTab === tab.id}
        className={`y-pf-tab${activeTab === tab.id ? ' is-active' : ''}`}
        onClick={() => onSelectTab(tab.id)}
      >
        <span>{tab.label}</span>
      </button>
    ))}
  </div>
);
