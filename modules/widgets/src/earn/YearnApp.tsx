import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EarnMountOptions, YearnVault } from './types';
import { fetchAllChainsVaults } from './yearnApi';
import { VaultsListView, VaultsListState, DEFAULT_LIST_STATE } from './components/list/VaultsListView';
import { DEFAULT_FILTERS } from './components/list/VaultsFiltersModal';
import { VaultDetailPage } from './components/detail/VaultDetailPage';
import { PortfolioPage } from './components/portfolio/PortfolioPage';
import { PortfolioTabId } from './components/portfolio/PortfolioTabs';
import { usePortfolioHoldings } from './hooks/usePortfolioHoldings';
import { wagmiConfig, subscribeWalletStatus, getWalletStatus, WalletStatus, connectWallet } from '../wallet/wallet';
import { TopNav } from './components/shell/TopNav';
import { Crumb } from './components/shell/Breadcrumbs';
import { PageContainer } from './components/shell/PageContainer';
import './styles/index.css';

const queryClient = new QueryClient();

function restoreListState(settings?: Record<string, any>): VaultsListState {
  const saved = settings?.vaultsList;
  if (!saved || typeof saved !== 'object') return DEFAULT_LIST_STATE;
  return {
    ...DEFAULT_LIST_STATE,
    ...saved,
    chains: Array.isArray(saved.chains) ? saved.chains : [],
    categories: Array.isArray(saved.categories) ? saved.categories : [],
    filters: { ...DEFAULT_FILTERS, ...(saved.filters || {}) },
    search: '',
  };
}

export const YearnDashboard: React.FC<EarnMountOptions> = ({
  initialSettings,
  onSettingsChange,
}) => {
  const [listState, setListState] = useState<VaultsListState>(() =>
    restoreListState(initialSettings)
  );
  const [activeView, setActiveView] = useState<'vaults' | 'portfolio' | 'vault-detail'>('vaults');
  const [portfolioTab, setPortfolioTab] = useState<PortfolioTabId>(
    () => (initialSettings?.portfolioTab as PortfolioTabId) || 'positions'
  );
  const [selectedVault, setSelectedVault] = useState<YearnVault | null>(null);

  const [vaults, setVaults] = useState<YearnVault[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [walletStatus, setWalletStatus] = useState<WalletStatus>(getWalletStatus());

  useEffect(() => {
    const unsub = subscribeWalletStatus((status) => setWalletStatus(status));
    return () => unsub();
  }, []);

  const loadVaults = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setVaults(await fetchAllChainsVaults());
    } catch (err) {
      console.error('[YearnDashboard] Error fetching vaults:', err);
      setError('Unable to load vaults right now. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVaults();
  }, [loadVaults]);

  const holdings = usePortfolioHoldings(vaults, walletStatus.address);

  const handleListStateChange = useCallback(
    (next: VaultsListState) => {
      setListState(next);
      onSettingsChange?.({
        vaultsList: {
          productType: next.productType,
          chains: next.chains,
          categories: next.categories,
          feeStructureKey: next.feeStructureKey,
          sortBy: next.sortBy,
          sortDir: next.sortDir,
          filters: next.filters,
        },
      });
    },
    [onSettingsChange]
  );

  const handlePortfolioTab = useCallback(
    (tab: PortfolioTabId) => {
      setPortfolioTab(tab);
      onSettingsChange?.({ portfolioTab: tab });
    },
    [onSettingsChange]
  );

  const handleConnectWallet = async () => {
    try {
      if (typeof (window as any).CoinmanWallet?.connect === 'function') {
        await (window as any).CoinmanWallet.connect();
      } else {
        await connectWallet();
      }
    } catch (err) {
      console.error('[YearnDashboard] Error connecting wallet:', err);
    }
  };

  const handleOpenVaultDetail = (vault: YearnVault) => {
    setSelectedVault(vault);
    setActiveView('vault-detail');
  };

  const breadcrumbs: Crumb[] = useMemo(() => {
    const goToVaults = () => {
      setActiveView('vaults');
      setSelectedVault(null);
    };
    if (activeView === 'vault-detail' && selectedVault) {
      return [{ label: 'Vaults', onClick: goToVaults }, { label: selectedVault.name }];
    }
    if (activeView === 'portfolio') {
      return [{ label: 'Vaults', onClick: goToVaults }, { label: 'Portfolio' }];
    }
    // On the list itself the crumb would only point at the page you are on.
    return [];
  }, [activeView, selectedVault]);

  return (
    <div className="yearn-root y-shell">
      <TopNav
        activeView={activeView}
        onNavigate={(view) => {
          setActiveView(view);
          setSelectedVault(null);
        }}
        breadcrumbs={breadcrumbs}
      />

      <PageContainer className="y-page">
        {activeView === 'vault-detail' && selectedVault && (
          <VaultDetailPage
            vault={selectedVault}
            walletAddress={walletStatus.address}
            walletChainId={walletStatus.chainId}
            onConnectWallet={handleConnectWallet}
          />
        )}

        {activeView === 'portfolio' && (
          <PortfolioPage
            holdings={holdings}
            isConnected={walletStatus.isConnected}
            activeTab={portfolioTab}
            onSelectTab={handlePortfolioTab}
            onSelectVault={handleOpenVaultDetail}
            onExploreVaults={() => {
              setActiveView('vaults');
              setSelectedVault(null);
            }}
            onConnectWallet={handleConnectWallet}
          />
        )}

        {activeView === 'vaults' && (
          <VaultsListView
            vaults={vaults}
            isLoading={isLoading}
            error={error}
            state={listState}
            onStateChange={handleListStateChange}
            onSelectVault={handleOpenVaultDetail}
            holdings={holdings.holdings}
            showHoldings={walletStatus.isConnected}
          />
        )}
      </PageContainer>
    </div>
  );
};

export const YearnApp: React.FC<EarnMountOptions> = (props) => {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <YearnDashboard {...props} />
      </QueryClientProvider>
    </WagmiProvider>
  );
};
