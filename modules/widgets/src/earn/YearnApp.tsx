import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EarnMountOptions, YearnVault } from './types';
import { fetchYearnVaults, fetchAllChainsVaults, SUPPORTED_CHAINS } from './yearnApi';
import { VaultsTable } from './components/VaultsTable';
import { NetworkSelector } from './components/NetworkSelector';
import { DepositModal } from './components/DepositModal';
import { fetchUserVaultBalance } from './yearnContracts';
import { wagmiConfig, subscribeWalletStatus, getWalletStatus, WalletStatus } from '../wallet/wallet';
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
  const [activeTab, setActiveTab] = useState<'all' | 'my-deposits'>('all');
  const [sortField, setSortField] = useState<'apy' | 'tvl' | 'name'>('tvl');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const [vaults, setVaults] = useState<YearnVault[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedVault, setSelectedVault] = useState<YearnVault | null>(null);

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

  // Load user positions if wallet is connected
  const refreshUserPositions = useCallback(async () => {
    if (!walletStatus.isConnected || !walletStatus.address || vaults.length === 0) {
      return;
    }

    const updated = await Promise.all(
      vaults.slice(0, 30).map(async (v) => {
        try {
          const res = await fetchUserVaultBalance(
            v.chainID,
            v.address,
            walletStatus.address!,
            v.token.decimals || 18
          );
          if (res.shares > 0n) {
            return {
              ...v,
              userVaultBalance: {
                raw: res.shares,
                formatted: res.formattedShares,
                assetsUnderlying: res.underlyingAssets,
                formattedAssets: res.formattedAssets,
                usdValue: Number(res.formattedAssets) * (v.tvl.price || 1),
              },
            };
          }
        } catch {}
        return v;
      })
    );

    // Merge updated positions back into list
    setVaults((prev) => {
      const map = new Map(updated.map((u) => [`${u.chainID}-${u.address}`, u]));
      return prev.map((item) => map.get(`${item.chainID}-${item.address}`) || item);
    });
  }, [walletStatus, vaults.length]);

  useEffect(() => {
    if (walletStatus.isConnected && walletStatus.address) {
      refreshUserPositions();
    }
  }, [walletStatus.isConnected, walletStatus.address]);

  // Handle Chain change
  const handleSelectChain = (chainId: number | 'all') => {
    setSelectedChainId(chainId);
    if (onSettingsChange) {
      onSettingsChange({ selectedChainId: chainId });
    }
  };

  // Sorting
  const handleSort = (field: 'apy' | 'tvl' | 'name') => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Filtered & sorted vaults
  const filteredVaults = useMemo(() => {
    return vaults
      .filter((v) => {
        if (activeTab === 'my-deposits') {
          return (v.userVaultBalance?.raw || 0n) > 0n;
        }
        return true;
      })
      .filter((v) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        return (
          v.name.toLowerCase().includes(q) ||
          v.token.symbol.toLowerCase().includes(q) ||
          v.symbol.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortField === 'apy') {
          cmp = (a.apr.netAPR || 0) - (b.apr.netAPR || 0);
        } else if (sortField === 'tvl') {
          cmp = (a.tvl.tvl || 0) - (b.tvl.tvl || 0);
        } else {
          cmp = a.name.localeCompare(b.name);
        }
        return sortDirection === 'asc' ? cmp : -cmp;
      });
  }, [vaults, activeTab, searchQuery, sortField, sortDirection]);

  // Aggregated Stats
  const totalTVL = useMemo(() => {
    return vaults.reduce((acc, v) => acc + (v.tvl.tvl || 0), 0);
  }, [vaults]);

  const maxAPY = useMemo(() => {
    return vaults.reduce((acc, v) => Math.max(acc, v.apr.netAPR || 0), 0);
  }, [vaults]);

  const totalUserDeposits = useMemo(() => {
    return vaults.reduce((acc, v) => acc + (v.userVaultBalance?.usdValue || 0), 0);
  }, [vaults]);

  return (
    <div className="yearn-dashboard-wrapper">
      {/* Header */}
      <div className="yearn-header">
        <div className="yearn-brand-row">
          <div className="yearn-brand">
            <div className="yearn-logo-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L2 7L12 12L22 7L12 2Z"
                  stroke="#ffffff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M2 17L12 22L22 17"
                  stroke="#ffffff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M2 12L12 17L22 12"
                  stroke="#ffffff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h2 className="yearn-title">Yearn Finance Vaults</h2>
              <p className="yearn-subtitle">
                DeFi yield optimization & auto-compounding on yVaults V3
              </p>
            </div>
          </div>

          <button
            type="button"
            className="yearn-action-btn btn-outline"
            onClick={loadVaults}
            title="Refresh Vault Data"
          >
            ↻ Refresh
          </button>
        </div>

        {/* Stats Bar */}
        <div className="yearn-stats-bar">
          <div className="yearn-stat-card">
            <span className="yearn-stat-label">Total Value Locked</span>
            <span className="yearn-stat-value">
              ${(totalTVL / 1e6).toFixed(1)}M
            </span>
          </div>

          <div className="yearn-stat-card">
            <span className="yearn-stat-label">Highest Available APY</span>
            <span className="yearn-stat-value highlight-green">
              {(maxAPY * 100).toFixed(2)}%
            </span>
          </div>

          <div className="yearn-stat-card">
            <span className="yearn-stat-label">Active Vaults</span>
            <span className="yearn-stat-value">{vaults.length}</span>
          </div>

          <div className="yearn-stat-card">
            <span className="yearn-stat-label">Your Deposited Balance</span>
            <span className="yearn-stat-value">
              {walletStatus.isConnected
                ? `$${totalUserDeposits.toFixed(2)}`
                : 'Connect Wallet'}
            </span>
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="yearn-controls">
        {/* Network Selector */}
        <NetworkSelector
          selectedChainId={selectedChainId}
          onSelectChain={handleSelectChain}
        />

        {/* Filter & Search Row */}
        <div className="yearn-filter-row">
          <div className="yearn-search-input-wrap">
            <span className="yearn-search-icon">🔍</span>
            <input
              type="text"
              className="yearn-search-input"
              placeholder="Search by token or vault name (e.g. USDC, ETH)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="yearn-tab-buttons">
            <button
              type="button"
              className={`yearn-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              All Vaults ({vaults.length})
            </button>
            <button
              type="button"
              className={`yearn-tab-btn ${activeTab === 'my-deposits' ? 'active' : ''}`}
              onClick={() => setActiveTab('my-deposits')}
            >
              My Deposits
            </button>
          </div>
        </div>
      </div>

      {/* Vaults Table */}
      <VaultsTable
        vaults={filteredVaults}
        isLoading={isLoading}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        onSelectVault={(v) => setSelectedVault(v)}
        isWalletConnected={walletStatus.isConnected}
      />

      {/* Deposit / Withdraw Modal */}
      {selectedVault && (
        <DepositModal
          vault={selectedVault}
          walletAddress={walletStatus.address}
          walletChainId={walletStatus.chainId}
          onClose={() => setSelectedVault(null)}
          onSuccess={() => {
            refreshUserPositions();
          }}
        />
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
