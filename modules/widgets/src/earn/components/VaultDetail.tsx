import React, { useState, useEffect, useCallback } from 'react';
import { formatUnits, maxUint256 } from 'viem';
import { YearnVault } from '../types';
import { getChain } from '../yearnApi';
import { TokenIcon } from './TokenIcon';
import {
  getTokenBalance,
  getTokenAllowance,
  getUserVaultShares,
  approveToken,
  depositToVault,
  redeemFromVault,
} from '../yearnContracts';
import { switchChain } from '@wagmi/core';
import { wagmiConfig } from '../../wallet/wallet';

interface VaultDetailProps {
  vault: YearnVault;
  walletAddress?: string;
  walletChainId?: number;
  onBack: () => void;
  onConnectWallet: () => void;
}

export const VaultDetail: React.FC<VaultDetailProps> = ({
  vault,
  walletAddress,
  walletChainId,
  onBack,
  onConnectWallet,
}) => {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState<string>('');
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);
  const [vaultShares, setVaultShares] = useState<bigint>(0n);
  const [underlyingBalance, setUnderlyingBalance] = useState<bigint>(0n);
  const [isLoadingBalances, setIsLoadingBalances] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [statusState, setStatusState] = useState<{
    stage: 'idle' | 'approving' | 'executing' | 'success' | 'error';
    message?: string;
    txHash?: string;
  }>({ stage: 'idle' });

  const chain = getChain(vault.chainID);
  const isWrongChain = Boolean(walletAddress && walletChainId && walletChainId !== vault.chainID);

  // Fetch balances and allowance
  const refreshBalances = useCallback(async () => {
    if (!walletAddress) {
      setTokenBalance(0n);
      setVaultShares(0n);
      setUnderlyingBalance(0n);
      setAllowance(0n);
      return;
    }

    setIsLoadingBalances(true);
    try {
      const [tokBal, allowVal, vShares] = await Promise.all([
        getTokenBalance(vault.chainID, vault.token.address, walletAddress),
        getTokenAllowance(vault.chainID, vault.token.address, walletAddress, vault.address),
        getUserVaultShares(vault.chainID, vault.address, walletAddress),
      ]);

      setTokenBalance(tokBal);
      setAllowance(allowVal);
      setVaultShares(vShares.shares);
      setUnderlyingBalance(vShares.assetsUnderlying);
    } catch (err) {
      console.warn('[VaultDetail] Error loading balances:', err);
    } finally {
      setIsLoadingBalances(false);
    }
  }, [vault, walletAddress]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  // Copy address to clipboard
  const handleCopyAddress = () => {
    navigator.clipboard.writeText(vault.address);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Switch network if on wrong chain
  const handleSwitchNetwork = async () => {
    try {
      await switchChain(wagmiConfig, { chainId: vault.chainID as any });
    } catch (err) {
      console.error('[VaultDetail] Switch network error:', err);
    }
  };

  // Convert input string to BigInt
  const parsedAmount = (() => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return 0n;
    try {
      const decimals = vault.token.decimals || 18;
      const clean = amount.trim();
      const parts = clean.split('.');
      const intPart = parts[0] || '0';
      const fracPart = (parts[1] || '').slice(0, decimals).padEnd(decimals, '0');
      return BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(fracPart);
    } catch {
      return 0n;
    }
  })();

  const needsApproval = activeTab === 'deposit' && allowance < parsedAmount && parsedAmount > 0n;

  // Percentage quick buttons
  const handlePercent = (pct: number) => {
    const raw = activeTab === 'deposit' ? tokenBalance : underlyingBalance;
    if (raw === 0n) return;

    if (pct === 100) {
      setAmount(formatUnits(raw, vault.token.decimals));
    } else {
      const portion = (raw * BigInt(pct)) / 100n;
      setAmount(formatUnits(portion, vault.token.decimals));
    }
  };

  // Handle Approve
  const handleApprove = async () => {
    if (!walletAddress) return;
    try {
      setStatusState({
        stage: 'approving',
        message: 'Please confirm token approval on your OneKey HD / Wallet...',
      });
      await approveToken(vault.chainID, vault.token.address, vault.address, maxUint256);
      setAllowance(maxUint256);
      setStatusState({
        stage: 'idle',
        message: 'Approval confirmed! You can now deposit into the vault.',
      });
    } catch (err: any) {
      console.error('[VaultDetail] Approval error:', err);
      setStatusState({
        stage: 'error',
        message: err?.message?.slice(0, 120) || 'Approval transaction was rejected or failed.',
      });
    }
  };

  // Handle Deposit / Withdraw
  const handleExecute = async () => {
    if (!walletAddress || parsedAmount === 0n) return;

    if (isWrongChain) {
      await handleSwitchNetwork();
    }

    try {
      if (activeTab === 'deposit') {
        setStatusState({
          stage: 'executing',
          message: 'Please confirm deposit on your OneKey HD / Wallet...',
        });
        const hash = await depositToVault(vault.chainID, vault.address, parsedAmount, walletAddress);
        setStatusState({
          stage: 'success',
          message: `Successfully deposited ${amount} ${vault.token.symbol}!`,
          txHash: hash,
        });
        setAmount('');
        refreshBalances();
      } else {
        setStatusState({
          stage: 'executing',
          message: 'Please confirm withdrawal on your OneKey HD / Wallet...',
        });
        let sharesToRedeem = vaultShares;
        if (underlyingBalance > 0n && parsedAmount < underlyingBalance) {
          sharesToRedeem = (vaultShares * parsedAmount) / underlyingBalance;
        }
        const hash = await redeemFromVault(vault.chainID, vault.address, sharesToRedeem, walletAddress);
        setStatusState({
          stage: 'success',
          message: `Successfully withdrawn ${amount} ${vault.token.symbol}!`,
          txHash: hash,
        });
        setAmount('');
        refreshBalances();
      }
    } catch (err: any) {
      console.error('[VaultDetail] Execution error:', err);
      setStatusState({
        stage: 'error',
        message: err?.message?.slice(0, 140) || 'Transaction was rejected or failed.',
      });
    }
  };

  const netApyDisplay = vault.apr.netAPR
    ? `${(vault.apr.netAPR * 100).toFixed(2)}%`
    : '0.00%';

  const currentAvailableBalance = activeTab === 'deposit'
    ? formatUnits(tokenBalance, vault.token.decimals)
    : formatUnits(underlyingBalance, vault.token.decimals);

  const estimatedUsd = parsedAmount > 0n && vault.tvl.price
    ? `$${(Number(formatUnits(parsedAmount, vault.token.decimals)) * vault.tvl.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '$0.00';

  return (
    <div className="yearn-vault-detail-wrap">
      {/* Breadcrumb & Top Bar */}
      <div className="yearn-detail-topbar">
        <button className="yearn-back-btn" onClick={onBack}>
          ← Back to Vaults
        </button>
        <div className="yearn-detail-network-pill">
          <img src={chain.icon} alt={chain.name} className="yearn-chain-icon-sm" />
          <span>{chain.name}</span>
        </div>
      </div>

      {/* Hero Header */}
      <div className="yearn-detail-hero">
        <div className="yearn-detail-hero-left">
          <div className="yearn-detail-icon-wrap">
            <TokenIcon
              src={vault.icon}
              tokenIcon={vault.token.icon}
              symbol={vault.token.symbol}
              chainId={vault.chainID}
              tokenAddress={vault.token.address}
              size={52}
            />
            <img src={chain.icon} alt={chain.name} className="yearn-chain-badge-lg" />
          </div>
          <div className="yearn-detail-title-block">
            <h1 className="yearn-detail-title">{vault.name}</h1>
            <div className="yearn-detail-subtitle">
              <span className="yearn-detail-symbol">{vault.symbol}</span>
              <span className="yearn-detail-version">v{vault.version}</span>
              <span className="yearn-detail-contract" onClick={handleCopyAddress} title="Click to copy contract address">
                {vault.address.slice(0, 6)}...{vault.address.slice(-4)}
                <span className="yearn-copy-hint">{isCopied ? '✓ Copied' : '⧉'}</span>
              </span>
              <a
                href={`${chain.blockExplorer}/address/${vault.address}`}
                target="_blank"
                rel="noreferrer"
                className="yearn-explorer-link"
              >
                Explorer ↗
              </a>
            </div>
          </div>
        </div>

        {/* Quick Highlights */}
        <div className="yearn-detail-hero-stats">
          <div className="yearn-hero-stat-card">
            <div className="yearn-stat-label">Net APY</div>
            <div className="yearn-stat-val text-green">{netApyDisplay}</div>
          </div>
          <div className="yearn-hero-stat-card">
            <div className="yearn-stat-label">TVL</div>
            <div className="yearn-stat-val">${(vault.tvl.tvl / 1_000_000).toFixed(2)}M</div>
          </div>
          <div className="yearn-hero-stat-card">
            <div className="yearn-stat-label">Token Price</div>
            <div className="yearn-stat-val">${(vault.tvl.price || 1).toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* Main 2-Column Content */}
      <div className="yearn-detail-content-grid">
        {/* Left Column: Info, Strategy, APY Breakdown */}
        <div className="yearn-detail-left-col">
          {/* Strategy / Overview */}
          <div className="yearn-card yearn-info-card">
            <h3 className="yearn-card-title">About this Vault</h3>
            <p className="yearn-info-desc">
              {vault.token.description ||
                `${vault.name} optimizes yield on ${vault.token.name} (${vault.token.symbol}) via automated Yearn V3 strategies across decentralized finance protocols.`}
            </p>
            <div className="yearn-props-table">
              <div className="yearn-prop-row">
                <span className="yearn-prop-key">Underlying Token</span>
                <span className="yearn-prop-val">{vault.token.name} ({vault.token.symbol})</span>
              </div>
              <div className="yearn-prop-row">
                <span className="yearn-prop-key">Token Decimals</span>
                <span className="yearn-prop-val">{vault.token.decimals}</span>
              </div>
              <div className="yearn-prop-row">
                <span className="yearn-prop-key">Vault Type</span>
                <span className="yearn-prop-val">{vault.type}</span>
              </div>
              <div className="yearn-prop-row">
                <span className="yearn-prop-key">Category</span>
                <span className="yearn-prop-val">{vault.category}</span>
              </div>
              <div className="yearn-prop-row">
                <span className="yearn-prop-key">Chain ID</span>
                <span className="yearn-prop-val">{vault.chainID} ({chain.name})</span>
              </div>
            </div>
          </div>

          {/* APY Breakdown */}
          <div className="yearn-card yearn-info-card">
            <h3 className="yearn-card-title">Yield Performance</h3>
            <div className="yearn-props-table">
              <div className="yearn-prop-row">
                <span className="yearn-prop-key">Estimated Net APY</span>
                <span className="yearn-prop-val text-green" style={{ fontWeight: 700 }}>
                  {netApyDisplay}
                </span>
              </div>
              {vault.apr.fees?.management !== undefined && (
                <div className="yearn-prop-row">
                  <span className="yearn-prop-key">Management Fee</span>
                  <span className="yearn-prop-val">
                    {(Number(vault.apr.fees.management) * 100).toFixed(2)}%
                  </span>
                </div>
              )}
              {vault.apr.fees?.performance !== undefined && (
                <div className="yearn-prop-row">
                  <span className="yearn-prop-key">Performance Fee</span>
                  <span className="yearn-prop-val">
                    {(Number(vault.apr.fees.performance) * 100).toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Deposit / Withdraw Form */}
        <div className="yearn-detail-right-col">
          <div className="yearn-card yearn-action-card">
            <div className="yearn-action-tabs">
              <button
                className={`yearn-action-tab ${activeTab === 'deposit' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('deposit');
                  setAmount('');
                  setStatusState({ stage: 'idle' });
                }}
              >
                Deposit
              </button>
              <button
                className={`yearn-action-tab ${activeTab === 'withdraw' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('withdraw');
                  setAmount('');
                  setStatusState({ stage: 'idle' });
                }}
              >
                Withdraw
              </button>
            </div>

            <div className="yearn-action-body">
              {/* Wrong network banner */}
              {isWrongChain && (
                <div className="yearn-network-warning-banner">
                  <span>Your wallet is connected to a different network.</span>
                  <button className="yearn-btn-sm-switch" onClick={handleSwitchNetwork}>
                    Switch to {chain.name}
                  </button>
                </div>
              )}

              {/* Amount input & Balance */}
              <div className="yearn-input-header">
                <span className="yearn-input-label">Amount</span>
                <span className="yearn-input-balance">
                  {activeTab === 'deposit' ? 'Wallet' : 'Deposited'}:{' '}
                  <strong>{isLoadingBalances ? '...' : Number(currentAvailableBalance).toFixed(4)}</strong>{' '}
                  {vault.token.symbol}
                </span>
              </div>

              <div className="yearn-amount-input-box">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => {
                    const val = e.target.value.replace(/,/g, '.');
                    if (/^\d*\.?\d*$/.test(val)) {
                      setAmount(val);
                      setStatusState({ stage: 'idle' });
                    }
                  }}
                  className="yearn-amount-input"
                  disabled={!walletAddress || statusState.stage === 'approving' || statusState.stage === 'executing'}
                />
                <div className="yearn-amount-token-badge">
                  <TokenIcon
                    src={vault.icon}
                    tokenIcon={vault.token.icon}
                    symbol={vault.token.symbol}
                    chainId={vault.chainID}
                    tokenAddress={vault.token.address}
                    size={22}
                  />
                  <span>{vault.token.symbol}</span>
                </div>
              </div>

              {/* USD estimate and quick percent buttons */}
              <div className="yearn-input-footer">
                <span className="yearn-usd-estimate">≈ {estimatedUsd}</span>
                <div className="yearn-percent-pills">
                  <button onClick={() => handlePercent(25)}>25%</button>
                  <button onClick={() => handlePercent(50)}>50%</button>
                  <button onClick={() => handlePercent(75)}>75%</button>
                  <button onClick={() => handlePercent(100)}>MAX</button>
                </div>
              </div>

              {/* Status Message */}
              {statusState.message && (
                <div
                  className={`yearn-status-box ${
                    statusState.stage === 'error'
                      ? 'error'
                      : statusState.stage === 'success'
                      ? 'success'
                      : 'info'
                  }`}
                >
                  <p>{statusState.message}</p>
                  {statusState.txHash && (
                    <a
                      href={`${chain.blockExplorer}/tx/${statusState.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="yearn-tx-link"
                    >
                      View transaction on Explorer ↗
                    </a>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="yearn-action-buttons-wrap">
                {!walletAddress ? (
                  <button className="yearn-btn-primary full-width" onClick={onConnectWallet}>
                    Connect Wallet
                  </button>
                ) : needsApproval ? (
                  <button
                    className="yearn-btn-primary full-width"
                    onClick={handleApprove}
                    disabled={statusState.stage === 'approving'}
                  >
                    {statusState.stage === 'approving' ? 'Approving Token...' : `Approve ${vault.token.symbol}`}
                  </button>
                ) : (
                  <button
                    className="yearn-btn-primary full-width"
                    onClick={handleExecute}
                    disabled={
                      parsedAmount === 0n ||
                      statusState.stage === 'executing' ||
                      (activeTab === 'deposit' && parsedAmount > tokenBalance) ||
                      (activeTab === 'withdraw' && parsedAmount > underlyingBalance)
                    }
                  >
                    {statusState.stage === 'executing'
                      ? 'Processing on Blockchain...'
                      : activeTab === 'deposit'
                      ? (parsedAmount > tokenBalance ? 'Insufficient Balance' : 'Deposit')
                      : (parsedAmount > underlyingBalance ? 'Insufficient Deposited Balance' : 'Withdraw')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
