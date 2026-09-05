import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EarnMountOptions, YearnVault } from './types';
import { fetchYearnVaults, fetchAllChainsVaults } from './yearnApi';
import { VaultsTable } from './components/VaultsTable';
import { NetworkSelector } from './components/NetworkSelector';
import { VaultDetail } from './components/VaultDetail';
import { PortfolioView } from './components/PortfolioView';
import { wagmiConfig, subscribeWalletStatus, getWalletStatus, WalletStatus, connectWallet } from '../wallet/wallet';
import './yearnStyles.css';

const queryClient = new QueryClient();

export const YearnDashboard: React.FC<EarnMountOptions> = ({
  initialSettings,
  onSettingsChange,
}) => {
  const [selectedChainId, setSelectedChainId] = useState<number | 'all'>(
    initialSettings?.selectedChainId || 'all'
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeView, setActiveView] = useState<'vaults' | 'portfolio' | 'vault-detail'>('vaults');
  const [selectedVault, setSelectedVault] = useState<YearnVault | null>(null);
  const [sortField, setSortField] = useState<'apy' | 'tvl' | 'name'>('tvl');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [vaults, setVaults] = useState<YearnVault[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [walletStatus, setWalletStatus] = useState<WalletStatus>(getWalletStatus());

  // Subscribe to wallet changes
  useEffect(() => {
    const unsub = subscribeWalletStatus((status) => {
      setWalletStatus(status);
    });
    return () => unsub();
  }, []);

  // Fetch vaults when selected network changes
  const loadVaults = useCallback(async () => {
    setIsLoading(true);
    try {
      let data: YearnVault[] = [];
      if (selectedChainId === 'all') {
        data = await fetchAllChainsVaults();
      } else {
        data = await fetchYearnVaults(selectedChainId);
      }
      setVaults(data);
    } catch (err) {
      console.error('[YearnDashboard] Error fetching vaults:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedChainId]);

  useEffect(() => {
    loadVaults();
  }, [loadVaults]);

  // Reset page when filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedChainId, searchQuery, sortField, sortDirection]);

  // Handle wallet connect
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

  // Filter & sort vaults (Default: TVL descending)
  const filteredVaults = useMemo(() => {
    let result = [...vaults];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.symbol.toLowerCase().includes(q) ||
          (v.displayName && v.displayName.toLowerCase().includes(q)) ||
          (v.displaySymbol && v.displaySymbol.toLowerCase().includes(q)) ||
          v.token.symbol.toLowerCase().includes(q) ||
          v.token.name.toLowerCase().includes(q) ||
          v.address.toLowerCase().includes(q) ||
          (v.category && v.category.toLowerCase().includes(q))
      );
    }

    result.sort((a, b) => {
      let valA: number | string = 0;
      let valB: number | string = 0;

      if (sortField === 'apy') {
        valA = a.apr.netAPR || 0;
        valB = b.apr.netAPR || 0;
      } else if (sortField === 'tvl') {
        valA = a.tvl?.tvl || 0;
        valB = b.tvl?.tvl || 0;
      } else if (sortField === 'name') {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [vaults, searchQuery, sortField, sortDirection]);

  // Pagination (100 vaults per page)
  const pageSize = 100;
  const totalVaults = filteredVaults.length;
  const totalPages = Math.ceil(totalVaults / pageSize) || 1;
  const paginatedVaults = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredVaults.slice(startIndex, startIndex + pageSize);
  }, [filteredVaults, currentPage, pageSize]);

  // Aggregate stats
  const totalTVL = useMemo(() => {
    return vaults.reduce((acc, v) => acc + (v.tvl.tvl || 0), 0);
  }, [vaults]);

  const maxAPY = useMemo(() => {
    return vaults.reduce((max, v) => Math.max(max, v.apr.netAPR || 0), 0);
  }, [vaults]);

  const handleSort = (field: 'apy' | 'tvl' | 'name') => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleSelectChain = (id: number | 'all') => {
    setSelectedChainId(id);
    if (onSettingsChange) {
      onSettingsChange({ selectedChainId: id });
    }
  };

  const handleOpenVaultDetail = (vault: YearnVault) => {
    setSelectedVault(vault);
    setActiveView('vault-detail');
  };

  return (
    <div className="yearn-dashboard-wrapper">
      {/* Top Header & Navigation */}
      <div className="yearn-header">
        <div className="yearn-brand-row">
          <div className="yearn-brand">
            <div className="yearn-logo-icon">
              <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="15" fill="#006ae3" />
                <path
                  d="M9 10L16 17L23 10M16 17V24"
                  stroke="#ffffff"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h2 className="yearn-title">Yearn Finance</h2>
              <p className="yearn-subtitle">DeFi yield optimization & auto-compounding on yVaults</p>
            </div>
          </div>

          {/* Primary Top View Tabs: Vaults & Portfolio */}
          <div className="yearn-top-nav-tabs">
            <button
              className={`yearn-nav-tab ${activeView === 'vaults' || activeView === 'vault-detail' ? 'active' : ''}`}
              onClick={() => {
                setActiveView('vaults');
                setSelectedVault(null);
              }}
            >
              Vaults
            </button>
            <button
              className={`yearn-nav-tab ${activeView === 'portfolio' ? 'active' : ''}`}
              onClick={() => {
                setActiveView('portfolio');
                setSelectedVault(null);
              }}
            >
              Portfolio
            </button>
            <button className="yearn-refresh-btn" onClick={loadVaults} title="Refresh Vaults">
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Global Stat Cards (shown when in vaults view) */}
        {activeView === 'vaults' && (
          <div className="yearn-stats-grid">
            <div className="yearn-stat-card">
              <span className="yearn-stat-title">Total Value Locked</span>
              <span className="yearn-stat-value">
                ${(totalTVL / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M
              </span>
            </div>
            <div className="yearn-stat-card">
              <span className="yearn-stat-title">Highest Available APY</span>
              <span className="yearn-stat-value text-green">
                {(maxAPY * 100).toFixed(2)}%
              </span>
            </div>
            <div className="yearn-stat-card">
              <span className="yearn-stat-title">Active Vaults</span>
              <span className="yearn-stat-value">{vaults.length}</span>
            </div>
            <div className="yearn-stat-card">
              <span className="yearn-stat-title">Wallet Status</span>
              <span className="yearn-stat-value" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {walletStatus.isConnected ? (
                  <span className="text-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    ● Connected ({walletStatus.shortAddress})
                  </span>
                ) : (
                  <span style={{ color: '#94a3b8', cursor: 'pointer', textDecoration: 'underline' }} onClick={handleConnectWallet}>
                    Connect Wallet
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* VIEW: Vault Detail Page */}
      {activeView === 'vault-detail' && selectedVault && (
        <VaultDetail
          vault={selectedVault}
          walletAddress={walletStatus.address}
          walletChainId={walletStatus.chainId}
          onBack={() => {
            setActiveView('vaults');
            setSelectedVault(null);
          }}
          onConnectWallet={handleConnectWallet}
        />
      )}

      {/* VIEW: User Portfolio Page */}
      {activeView === 'portfolio' && (
        <PortfolioView
          vaults={vaults}
          walletAddress={walletStatus.address}
          onSelectVault={handleOpenVaultDetail}
          onExploreVaults={() => {
            setActiveView('vaults');
            setSelectedVault(null);
          }}
          onConnectWallet={handleConnectWallet}
        />
      )}

      {/* VIEW: Vaults Explorer / Table Page */}
      {activeView === 'vaults' && (
        <>
          {/* Controls Bar: Network Pills & Search Input */}
          <div className="yearn-controls-bar">
            <NetworkSelector
              selectedChainId={selectedChainId}
              onSelectChain={handleSelectChain}
            />

            <div className="yearn-search-box">
              <span className="yearn-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search by token or vault name (e.g. USDC, ETH, WETH, BOLD)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="yearn-search-input"
              />
              {searchQuery && (
                <button className="yearn-search-clear" onClick={() => setSearchQuery('')}>
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Vaults Table with Pagination */}
          <VaultsTable
            vaults={paginatedVaults}
            totalVaults={totalVaults}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            isLoading={isLoading}
            onSelectVault={handleOpenVaultDetail}
            isWalletConnected={walletStatus.isConnected}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
          />
        </>
      )}
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
