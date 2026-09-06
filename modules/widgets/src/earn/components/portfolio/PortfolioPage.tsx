import React from 'react';
import { YearnVault } from '../../types';
import { PortfolioHoldings as PortfolioHoldingsData } from '../../hooks/usePortfolioHoldings';
import { EmptySectionCard } from './EmptySectionCard';
import { PortfolioHoldings } from './PortfolioHoldings';
import { PortfolioMetrics } from './PortfolioMetrics';
import { PortfolioTabId, PortfolioTabs } from './PortfolioTabs';

interface PortfolioPageProps {
  holdings: PortfolioHoldingsData;
  isConnected: boolean;
  activeTab: PortfolioTabId;
  onSelectTab: (tab: PortfolioTabId) => void;
  onSelectVault: (vault: YearnVault) => void;
  onExploreVaults: () => void;
  onConnectWallet: () => void;
}

export const PortfolioPage: React.FC<PortfolioPageProps> = ({
  holdings,
  isConnected,
  activeTab,
  onSelectTab,
  onSelectVault,
  onExploreVaults,
  onConnectWallet,
}) => {
  const renderTab = () => {
    if (activeTab === 'activity') {
      return (
        <section className="y-pf-section">
          <EmptySectionCard
            title={isConnected ? 'Activity is coming soon' : 'Connect a wallet to view activity'}
            description="Review your recent Yearn transactions."
            ctaLabel={isConnected ? 'Explore Vaults' : 'Connect wallet'}
            onCta={isConnected ? onExploreVaults : onConnectWallet}
          />
        </section>
      );
    }

    if (activeTab === 'claim-rewards') {
      return (
        <section className="y-pf-section">
          <div>
            <h2 className="y-pf-section__heading">Claim rewards</h2>
            <p className="y-pf-section__subheading">
              Claim all of your staking and Merkle rewards across Yearn.
            </p>
          </div>
          <EmptySectionCard
            title={isConnected ? 'No rewards to claim' : 'Connect a wallet to claim rewards'}
            description={
              isConnected
                ? 'Staking and Merkle rewards will show up here once available.'
                : 'We will surface any claimable rewards once connected.'
            }
            ctaLabel={isConnected ? 'Explore Vaults' : 'Connect wallet'}
            onCta={isConnected ? onExploreVaults : onConnectWallet}
          />
        </section>
      );
    }

    if (!isConnected) {
      return (
        <section className="y-pf-section">
          <EmptySectionCard
            title="Connect a wallet to view your portfolio."
            ctaLabel="Connect wallet"
            onCta={onConnectWallet}
            secondaryCtaLabel="Explore Vaults"
            onSecondaryCta={onExploreVaults}
          />
        </section>
      );
    }

    return (
      <div className="y-pf-overview">
        <PortfolioMetrics
          positions={holdings.positions}
          totalUsd={holdings.totalUsd}
          isLoading={holdings.isLoading}
        />
        <PortfolioHoldings
          positions={holdings.positions}
          holdings={holdings.holdings}
          isLoading={holdings.isLoading}
          onSelectVault={onSelectVault}
          onExploreVaults={onExploreVaults}
        />
      </div>
    );
  };

  return (
    <div className="y-pf">
      <h1 className="y-pf__title">Portfolio</h1>
      <div className="y-pf__tabs-wrap">
        <PortfolioTabs activeTab={activeTab} onSelectTab={onSelectTab} />
      </div>
      <div className="y-pf__content">{renderTab()}</div>
    </div>
  );
};
