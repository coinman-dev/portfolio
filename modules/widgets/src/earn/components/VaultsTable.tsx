import React from 'react';
import { YearnVault } from '../types';
import { getChain } from '../yearnApi';
import { TokenIcon } from './TokenIcon';

interface VaultsTableProps {
  vaults: YearnVault[];
  isLoading: boolean;
  onSelectVault: (vault: YearnVault) => void;
  isWalletConnected: boolean;
  sortField: 'apy' | 'tvl' | 'name';
  sortDirection: 'asc' | 'desc';
  onSort: (field: 'apy' | 'tvl' | 'name') => void;
}

export const VaultsTable: React.FC<VaultsTableProps> = ({
  vaults,
  isLoading,
  onSelectVault,
  isWalletConnected,
  sortField,
  sortDirection,
  onSort,
}) => {
  const formatUSD = (val: number) => {
    if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(2)}k`;
    return `$${val.toFixed(2)}`;
  };

  const getSortIcon = (field: 'apy' | 'tvl' | 'name') => {
    if (sortField !== field) return <span className="sort-hint">↕</span>;
    return <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  if (isLoading) {
    return (
      <div className="yearn-table-wrap">
        <div className="yearn-table-loading">
          <div className="yearn-spinner"></div>
          <span>Loading live vaults from yDaemon...</span>
        </div>
      </div>
    );
  }

  if (vaults.length === 0) {
    return (
      <div className="yearn-table-wrap">
        <div className="yearn-table-empty">
          <p>No vaults found matching your filter criteria.</p>
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
                      <TokenIcon
                        src={vault.icon}
                        tokenIcon={vault.token.icon}
                        symbol={vault.token.symbol}
                        chainId={vault.chainID}
                        tokenAddress={vault.token.address}
                        size={36}
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
                  <span className="yearn-chain-pill">
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
