import React, { useState, useEffect } from 'react';
import { YearnVault } from '../types';
import { getChain } from '../yearnApi';
import { TokenIcon } from './TokenIcon';
import { getUserVaultShares } from '../yearnContracts';

interface PortfolioViewProps {
  vaults: YearnVault[];
  walletAddress?: string;
  onSelectVault: (vault: YearnVault) => void;
  onExploreVaults: () => void;
  onConnectWallet: () => void;
}

interface UserPosition {
  vault: YearnVault;
  shares: bigint;
  assetsUnderlying: bigint;
  formattedAssets: string;
  usdValue: number;
}

export const PortfolioView: React.FC<PortfolioViewProps> = ({
  vaults,
  walletAddress,
  onSelectVault,
  onExploreVaults,
  onConnectWallet,
}) => {
  const [positions, setPositions] = useState<UserPosition[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!walletAddress || vaults.length === 0) {
      setPositions([]);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    const checkUserPositions = async () => {
      // Check popular / endorsed vaults first for user shares
      const userPositions: UserPosition[] = [];
      const topVaults = vaults.slice(0, 40);

      const checks = topVaults.map(async (vault) => {
        try {
          const res = await getUserVaultShares(vault.chainID, vault.address, walletAddress);
          if (res.shares > 0n && isMounted) {
            const tokenDecimals = vault.token.decimals || 18;
            const formattedAssets = (Number(res.assetsUnderlying) / 10 ** tokenDecimals).toFixed(4);
            const usdValue = Number(formattedAssets) * (vault.tvl.price || 1);
            userPositions.push({
              vault,
              shares: res.shares,
              assetsUnderlying: res.assetsUnderlying,
              formattedAssets,
              usdValue,
            });
          }
        } catch {
          // ignore error for vaults without balance
        }
      });

      await Promise.all(checks);
      if (isMounted) {
        setPositions(userPositions);
        setIsLoading(false);
      }
    };

    checkUserPositions();

    return () => {
      isMounted = false;
    };
  }, [walletAddress, vaults]);

  const totalDepositedUsd = positions.reduce((sum, p) => sum + p.usdValue, 0);
  const estimatedAnnualYield = positions.reduce((sum, p) => {
    const apy = p.vault.apr.netAPR || 0;
    return sum + p.usdValue * apy;
  }, 0);

  if (!walletAddress) {
    return (
      <div className="yearn-portfolio-empty-card">
        <div className="yearn-portfolio-empty-icon">🏦</div>
        <h2 className="yearn-portfolio-empty-title">Yearn Portfolio Tracker</h2>
        <p className="yearn-portfolio-empty-desc">
          Connect your Web3 or OneKey HD wallet to view all your active vaults, balances, and real-time yields across Ethereum, Arbitrum, Base, Optimism, and Polygon.
        </p>
        <button className="yearn-btn-primary" onClick={onConnectWallet} style={{ minWidth: 200 }}>
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="yearn-portfolio-wrapper">
      {/* Portfolio Top Metrics */}
      <div className="yearn-stats-grid">
        <div className="yearn-stat-card">
          <span className="yearn-stat-title">Total Deposited</span>
          <span className="yearn-stat-value text-accent">
            ${totalDepositedUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="yearn-stat-sub">Across all Yearn vaults</span>
        </div>

        <div className="yearn-stat-card">
          <span className="yearn-stat-title">Active Positions</span>
          <span className="yearn-stat-value">{positions.length}</span>
          <span className="yearn-stat-sub">{isLoading ? 'Scanning onchain...' : 'Vaults with balance'}</span>
        </div>

        <div className="yearn-stat-card">
          <span className="yearn-stat-title">Estimated 1Y Yield</span>
          <span className="yearn-stat-value text-green">
            +${estimatedAnnualYield.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="yearn-stat-sub">
            {totalDepositedUsd > 0
              ? `Avg ~${((estimatedAnnualYield / totalDepositedUsd) * 100).toFixed(2)}% APY`
              : 'Based on current rates'}
          </span>
        </div>
      </div>

      {/* Positions Table */}
      <div className="yearn-section-title-row">
        <h2 className="yearn-section-title">Your Active Positions</h2>
        {isLoading && <span className="yearn-loading-badge">Checking onchain balances...</span>}
      </div>

      {positions.length === 0 && !isLoading ? (
        <div className="yearn-portfolio-empty-card">
          <h3 className="yearn-portfolio-empty-title">No Active Deposits Found</h3>
          <p className="yearn-portfolio-empty-desc">
            You currently do not have deposits in Yearn vaults for this wallet address.
          </p>
          <button className="yearn-btn-primary" onClick={onExploreVaults} style={{ minWidth: 180 }}>
            Explore Vaults
          </button>
        </div>
      ) : (
        <div className="yearn-table-wrap">
          <table className="yearn-table">
            <thead>
              <tr>
                <th>Asset / Vault</th>
                <th>Network</th>
                <th>Net APY</th>
                <th>Your Balance</th>
                <th>Value (USD)</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {positions.map(({ vault, formattedAssets, usdValue }) => {
                const chain = getChain(vault.chainID);
                const apy = vault.apr.netAPR
                  ? `${(vault.apr.netAPR * 100).toFixed(2)}%`
                  : '0.00%';

                return (
                  <tr
                    key={`pos-${vault.chainID}-${vault.address}`}
                    className="vault-row"
                    onClick={() => onSelectVault(vault)}
                  >
                    <td>
                      <div className="yearn-asset-cell">
                        <div className="yearn-asset-icon-wrap">
                          <TokenIcon
                            src={vault.icon}
                            tokenIcon={vault.token.icon}
                            symbol={vault.token.symbol}
                            chainId={vault.chainID}
                            tokenAddress={vault.token.address}
                            size={34}
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
                          <span className="yearn-asset-version">v{vault.version}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="yearn-chain-pill">{chain.name}</span>
                    </td>
                    <td>
                      <span className="yearn-apy-badge text-green">{apy}</span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{formattedAssets}</span> {vault.token.symbol}
                    </td>
                    <td>
                      <span style={{ fontWeight: 600 }}>
                        ${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="yearn-btn-table-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectVault(vault);
                        }}
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
