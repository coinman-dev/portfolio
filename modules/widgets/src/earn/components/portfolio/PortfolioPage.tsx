import React from 'react';
import { YearnVault } from '../../types';
import { PortfolioHoldings as PortfolioHoldingsData } from '../../hooks/usePortfolioHoldings';
import { PortfolioTabId, PortfolioTabs } from './PortfolioTabs';
import { PortfolioHistoryChart } from './PortfolioHistoryChart';
import { PortfolioMetrics } from './PortfolioMetrics';
import { PortfolioHoldings } from './PortfolioHoldings';
import { PortfolioActivity } from './PortfolioActivity';
import { EmptySectionCard } from './EmptySectionCard';
import { useT } from '../../i18n';

interface PortfolioPageProps {
  holdings: PortfolioHoldingsData;
  vaults: YearnVault[];
  walletAddress?: string;
  isConnected: boolean;
  activeTab: PortfolioTabId;
  onSelectTab: (tab: PortfolioTabId) => void;
  onSelectVault: (vault: YearnVault) => void;
  onExploreVaults: () => void;
  onConnectWallet: () => void;
}

export const PortfolioPage: React.FC<PortfolioPageProps> = ({
  holdings,
  vaults,
  walletAddress,
  isConnected,
  activeTab,
  onSelectTab,
  onSelectVault,
  onExploreVaults,
  onConnectWallet,
}) => {
  const t = useT();
  const renderTab = () => {
    if (activeTab === 'activity') {
      return (
        <section className="y-pf-section">
          {isConnected && walletAddress ? (
            <PortfolioActivity address={walletAddress} vaults={vaults} onSelectVault={onSelectVault} />
          ) : (
            <EmptySectionCard
              title={t('Connect a wallet to view activity')}
              description={t('Review your recent Yearn transactions.')}
              ctaLabel={t('Connect wallet')}
              onCta={onConnectWallet}
            />
          )}
        </section>
      );
    }

    if (activeTab === 'claim-rewards') {
      return (
        <section className="y-pf-section">
          <div>
            <h2 className="y-pf-section__heading">{t('Claim rewards')}</h2>
            <p className="y-pf-section__subheading">
              {t('Claim all of your staking and Merkle rewards across Yearn.')}
            </p>
          </div>
          <EmptySectionCard
            title={isConnected ? t('No rewards to claim') : t('Connect a wallet to claim rewards')}
            description={
              isConnected
                ? t('Staking and Merkle rewards will show up here once available.')
                : t('We will surface any claimable rewards once connected.')
            }
            ctaLabel={isConnected ? t('Explore Vaults') : t('Connect wallet')}
            onCta={isConnected ? onExploreVaults : onConnectWallet}
          />
        </section>
      );
    }

    if (!isConnected || !walletAddress) {
      return (
        <section className="y-pf-section">
          <EmptySectionCard
            title={t('Connect a wallet to view your portfolio.')}
            ctaLabel={t('Connect wallet')}
            onCta={onConnectWallet}
            secondaryCtaLabel={t('Explore Vaults')}
            onSecondaryCta={onExploreVaults}
          />
        </section>
      );
    }

    return (
      <div className="y-pf-overview">
        <div className="y-pf-summary">
          <PortfolioHistoryChart
            address={walletAddress}
            vaults={vaults}
            liveTotalUsd={holdings.isLoading ? 0 : holdings.totalUsd}
          />
          <PortfolioMetrics
            address={walletAddress}
            positions={holdings.positions}
            totalUsd={holdings.totalUsd}
            isLoading={holdings.isLoading}
          />
        </div>
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
      <h1 className="y-pf__title">{t('Portfolio')}</h1>
      <div className="y-pf__tabs-wrap">
        <PortfolioTabs activeTab={activeTab} onSelectTab={onSelectTab} />
      </div>
      <div className="y-pf__content">{renderTab()}</div>
    </div>
  );
};
