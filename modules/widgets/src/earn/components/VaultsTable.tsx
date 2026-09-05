import React from 'react';
import { YearnVault } from '../types';
import { SUPPORTED_CHAINS } from '../yearnApi';

interface VaultsTableProps {
  vaults: YearnVault[];
  isLoading: boolean;
  sortField: 'apy' | 'tvl' | 'name';
  sortDirection: 'asc' | 'desc';
  onSort: (field: 'apy' | 'tvl' | 'name') => void;
  onSelectVault: (vault: YearnVault) => void;
  isWalletConnected: boolean;
}

function formatUSD(num: number): string {
  if (!num || isNaN(num)) return '$0';
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}

export const VaultsTable: React.FC<VaultsTableProps> = ({
  vaults,
  isLoading,
  sortField,
  sortDirection,
  onSort,
  onSelectVault,
  isWalletConnected,
}) => {
  const getSortIcon = (field: 'apy' | 'tvl' | 'name') => {
    if (sortField !== field) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const getChain = (chainId: number) => {
    return SUPPORTED_CHAINS.find((c) => c.id === chainId) || SUPPORTED_CHAINS[0];
  };

  if (isLoading) {
    return (
      <div className="yearn-table-wrap">
        <div className="yearn-state-message">
          <div className="yearn-spinner" />
          <div>Loading Yearn Vaults...</div>
        </div>
      </div>
    );
  }

  if (vaults.length === 0) {
    return (
      <div className="yearn-table-wrap">
        <div className="yearn-state-message">
          <div>No vaults match your search or filter.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="yearn-table-wrap">
      <table className="yearn-table">
        <thead>
          <tr>
            <th className="sortable" onClick={() => onSort('name')}>
              Asset {getSortIcon('name')}
            </th>
            <th>Network</th>
            <th className="sortable" onClick={() => onSort('apy')}>
              Net APY {getSortIcon('apy')}
            </th>
            <th className="sortable" onClick={() => onSort('tvl')}>
              TVL {getSortIcon('tvl')}
            </th>
            {isWalletConnected && <th>My Deposited</th>}
            <th style={{ textAlign: 'right' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {vaults.map((vault) => {
            const chain = getChain(vault.chainID);
            const apy = vault.apr.netAPR
              ? `${(vault.apr.netAPR * 100).toFixed(2)}%`
              : '0.00%';

            const userDeposited = vault.userVaultBalance?.formattedAssets
              ? `${Number(vault.userVaultBalance.formattedAssets).toFixed(4)} ${vault.token.symbol}`
              : '—';

            return (
              <tr
                key={`${vault.chainID}-${vault.address}`}
                className="vault-row"
                onClick={() => onSelectVault(vault)}
              >
                {/* Asset */}
                <td>
                  <div className="yearn-asset-cell">
                    <div className="yearn-asset-icon-wrap">
                      <img
                        className="yearn-asset-icon"
                        src={vault.icon || vault.token.icon}
                        alt={vault.token.symbol}
                        onError={(e) => {
                          (e.target as any).src =
                            'https://cdn.jsdelivr.net/gh/yearn/tokenassets@main/tokens/1/0x0000000000000000000000000000000000000000/logo-128.png';
                        }}
                      />
                      <img
                        className="yearn-chain-badge"
                        src={chain.icon}
                        alt={chain.shortName}
                        title={chain.name}
                      />
                    </div>
                    <div className="yearn-asset-meta">
                      <span className="yearn-asset-name">{vault.name}</span>
                      <span className="yearn-asset-version">
                        {vault.token.symbol} • {vault.version || 'v3'}
                      </span>
                    </div>
                  </div>
                </td>

                {/* Network */}
                <td>
                  <span
                    style={{
                      fontSize: 12,
                      padding: '3px 8px',
                      background: '#191b26',
                      borderRadius: 12,
                      border: '1px solid #232738',
                      color: '#94a3b8',
                    }}
                  >
                    {chain.name}
                  </span>
                </td>

                {/* APY */}
                <td>
                  <span className="yearn-apy-val">{apy}</span>
                </td>

                {/* TVL */}
                <td>
                  <span className="yearn-tvl-val">{formatUSD(vault.tvl.tvl)}</span>
                </td>

                {/* My Deposited */}
                {isWalletConnected && (
                  <td>
                    <span style={{ fontSize: 13, color: '#e2e8f0' }}>{userDeposited}</span>
                  </td>
                )}

                {/* Action */}
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="yearn-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectVault(vault);
                    }}
                  >
                    Deposit
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
