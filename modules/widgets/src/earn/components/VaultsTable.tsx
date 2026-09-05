import React from 'react';
import { YearnVault } from '../types';
import { getChain } from '../yearnApi';
import { TokenIcon } from './TokenIcon';

interface VaultsTableProps {
  vaults: YearnVault[];
  totalVaults: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  isLoading: boolean;
  onSelectVault: (vault: YearnVault) => void;
  isWalletConnected: boolean;
  sortField: 'apy' | 'tvl' | 'name';
  sortDirection: 'asc' | 'desc';
  onSort: (field: 'apy' | 'tvl' | 'name') => void;
}

export const VaultsTable: React.FC<VaultsTableProps> = ({
  vaults,
  totalVaults,
  currentPage,
  totalPages,
  onPageChange,
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
              Est. APY {getSortIcon('apy')}
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

            // Fees information: Fees: 0% | 10%
            const mgmtFee =
              vault.apr.fees?.management !== undefined
                ? `${(Number(vault.apr.fees.management) * 100).toFixed(0)}%`
                : '0%';
            const perfFee =
              vault.apr.fees?.performance !== undefined
                ? `${(Number(vault.apr.fees.performance) * 100).toFixed(0)}%`
                : '0%';
            const feesText = `Fees: ${mgmtFee} | ${perfFee}`;

            // Tags
            const isStable =
              vault.category?.toLowerCase().includes('stable') ||
              vault.token.symbol.toUpperCase().includes('USD') ||
              vault.token.symbol.toUpperCase().includes('DAI');
            const kindTag =
              vault.kind || (vault.name.includes('LP') ? 'LP Token' : 'Single Asset');

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
                      <div className="yearn-asset-title-row">
                        <span className="yearn-asset-name">{vault.name}</span>
                        <span className="yearn-asset-version">v{vault.version}</span>
                      </div>
                      <div className="yearn-asset-tags">
                        {isStable && <span className="yearn-tag">Stablecoin</span>}
                        {kindTag && <span className="yearn-tag">{kindTag}</span>}
                        <span className="yearn-tag fees-tag">{feesText}</span>
                      </div>
                    </div>
                  </div>
                </td>

                {/* Network */}
                <td>
                  <span className="yearn-chain-pill">{chain.name}</span>
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

      {/* Pagination Bar */}
      {totalPages > 1 && (
        <div className="yearn-pagination-bar">
          <div className="yearn-pagination-info">
            Showing {(currentPage - 1) * 100 + 1}–{Math.min(currentPage * 100, totalVaults)} of {totalVaults} vaults
          </div>
          <div className="yearn-pagination-controls">
            <button
              type="button"
              className="yearn-page-btn"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(currentPage - 1)}
            >
              ‹ Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
              .map((p, idx, arr) => {
                const prev = arr[idx - 1];
                return (
                  <React.Fragment key={p}>
                    {prev && p - prev > 1 && <span className="yearn-page-dots">...</span>}
                    <button
                      type="button"
                      className={`yearn-page-btn ${currentPage === p ? 'active' : ''}`}
                      onClick={() => onPageChange(p)}
                    >
                      {p}
                    </button>
                  </React.Fragment>
                );
              })}
            <button
              type="button"
              className="yearn-page-btn"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(currentPage + 1)}
            >
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
