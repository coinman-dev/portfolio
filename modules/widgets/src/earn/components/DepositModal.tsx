import React, { useState, useEffect, useMemo } from 'react';
import { YearnVault } from '../types';
import { SUPPORTED_CHAINS } from '../yearnApi';
import {
  fetchAllowance,
  approveToken,
  depositToVault,
  redeemFromVault,
  fetchUserTokenBalance,
  fetchUserVaultBalance,
} from '../yearnContracts';
import { parseUnits, formatUnits, maxUint256 } from 'viem';

interface DepositModalProps {
  vault: YearnVault;
  walletAddress?: string;
  walletChainId?: number;
  onClose: () => void;
  onSuccess?: () => void;
}

export const DepositModal: React.FC<DepositModalProps> = ({
  vault,
  walletAddress,
  walletChainId,
  onClose,
  onSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState<string>('');
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);
  const [vaultShares, setVaultShares] = useState<bigint>(0n);
  const [underlyingBalance, setUnderlyingBalance] = useState<bigint>(0n);
  const [statusState, setStatusState] = useState<{
    stage: 'idle' | 'approving' | 'executing' | 'success' | 'error';
    message?: string;
    txHash?: string;
  }>({ stage: 'idle' });

  const chain = useMemo(
    () => SUPPORTED_CHAINS.find((c) => c.id === vault.chainID) || SUPPORTED_CHAINS[0],
    [vault.chainID]
  );

  const decimals = vault.token.decimals || 18;

  // Load balances and allowance
  const refreshBalances = async () => {
    if (!walletAddress) return;
    try {
      const [tok, vlt, allow] = await Promise.all([
        fetchUserTokenBalance(vault.chainID, vault.token.address, walletAddress, decimals),
        fetchUserVaultBalance(vault.chainID, vault.address, walletAddress, decimals),
        fetchAllowance(vault.chainID, vault.token.address, walletAddress, vault.address),
      ]);
      setTokenBalance(tok.raw);
      setVaultShares(vlt.shares);
      setUnderlyingBalance(vlt.underlyingAssets);
      setAllowance(allow);
    } catch (err) {
      console.warn('[DepositModal] Error fetching balances:', err);
    }
  };

  useEffect(() => {
    refreshBalances();
  }, [vault, walletAddress]);

  const maxDepositFormatted = useMemo(() => formatUnits(tokenBalance, decimals), [tokenBalance, decimals]);
  const maxWithdrawFormatted = useMemo(() => formatUnits(underlyingBalance, decimals), [underlyingBalance, decimals]);

  const parsedAmount = useMemo(() => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return 0n;
    try {
      return parseUnits(amount, decimals);
    } catch {
      return 0n;
    }
  }, [amount, decimals]);

  const needsApproval = useMemo(() => {
    if (activeTab !== 'deposit') return false;
    if (parsedAmount === 0n) return false;
    return allowance < parsedAmount;
  }, [activeTab, parsedAmount, allowance]);

  const usdValue = useMemo(() => {
    const num = Number(amount || 0);
    const price = vault.tvl.price || 1;
    return (num * price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, [amount, vault.tvl.price]);

  const handlePercentage = (pct: number) => {
    const targetBalance = activeTab === 'deposit' ? tokenBalance : underlyingBalance;
    if (targetBalance === 0n) {
      setAmount('0');
      return;
    }
    if (pct === 100) {
      setAmount(activeTab === 'deposit' ? maxDepositFormatted : maxWithdrawFormatted);
      return;
    }
    const part = (targetBalance * BigInt(pct)) / 100n;
    setAmount(formatUnits(part, decimals));
  };

  const handleApprove = async () => {
    if (!walletAddress) return;
    try {
      setStatusState({
        stage: 'approving',
        message: 'Please confirm token approval on your OneKey HD / Wallet...',
      });
      const hash = await approveToken(vault.chainID, vault.token.address, vault.address, maxUint256);
      setAllowance(maxUint256);
      setStatusState({
        stage: 'idle',
        message: 'Approval confirmed! You can now deposit into the vault.',
      });
    } catch (err: any) {
      console.error('[DepositModal] Approval error:', err);
      setStatusState({
        stage: 'error',
        message: err?.message?.slice(0, 120) || 'Approval transaction was rejected or failed.',
      });
    }
  };

  const handleExecute = async () => {
    if (!walletAddress || parsedAmount === 0n) return;

    try {
      if (activeTab === 'deposit') {
        setStatusState({
          stage: 'executing',
          message: 'Please confirm deposit on your OneKey HD / Wallet...',
        });
        const hash = await depositToVault(vault.chainID, vault.address, parsedAmount, walletAddress);
        setStatusState({
          stage: 'success',
          message: `Successfully deposited into ${vault.name}!`,
          txHash: hash,
        });
        setAmount('');
        refreshBalances();
        if (onSuccess) onSuccess();
      } else {
        setStatusState({
          stage: 'executing',
          message: 'Please confirm withdrawal on your OneKey HD / Wallet...',
        });
        // Calculate shares to redeem proportionally
        let sharesToRedeem = vaultShares;
        if (underlyingBalance > 0n && parsedAmount < underlyingBalance) {
          sharesToRedeem = (vaultShares * parsedAmount) / underlyingBalance;
        }
        const hash = await redeemFromVault(vault.chainID, vault.address, sharesToRedeem, walletAddress);
        setStatusState({
          stage: 'success',
          message: `Successfully withdrawn from ${vault.name}!`,
          txHash: hash,
        });
        setAmount('');
        refreshBalances();
        if (onSuccess) onSuccess();
      }
    } catch (err: any) {
      console.error('[DepositModal] Execution error:', err);
      setStatusState({
        stage: 'error',
        message: err?.message?.slice(0, 140) || 'Transaction was rejected or failed.',
      });
    }
  };

  const apyDisplay = vault.apr.netAPR
    ? `${(vault.apr.netAPR * 100).toFixed(2)}%`
    : '0.00%';

  return (
    <div className="yearn-modal-overlay" onClick={onClose}>
      <div className="yearn-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="yearn-modal-header">
          <div className="yearn-modal-title">
            <img
              src={vault.icon || vault.token.icon}
              alt=""
              style={{ width: 26, height: 26, borderRadius: '50%' }}
              onError={(e) => { (e.target as any).src = 'https://cdn.jsdelivr.net/gh/yearn/tokenassets@main/tokens/1/0x0000000000000000000000000000000000000000/logo-128.png'; }}
            />
            <span>{vault.name}</span>
          </div>
          <button type="button" className="yearn-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="yearn-modal-body">
          {/* Tabs: Deposit / Withdraw */}
          <div className="yearn-modal-tabs">
            <button
              type="button"
              className={`yearn-modal-tab ${activeTab === 'deposit' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('deposit');
                setAmount('');
                setStatusState({ stage: 'idle' });
              }}
            >
              Deposit
            </button>
            <button
              type="button"
              className={`yearn-modal-tab ${activeTab === 'withdraw' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('withdraw');
                setAmount('');
                setStatusState({ stage: 'idle' });
              }}
            >
              Withdraw
            </button>
          </div>

          {/* Amount Input */}
          <div className="yearn-input-box">
            <div className="yearn-input-top-row">
              <span>{activeTab === 'deposit' ? 'You deposit' : 'You withdraw'}</span>
              <span>
                Available:{' '}
                {activeTab === 'deposit'
                  ? `${Number(maxDepositFormatted).toFixed(4)} ${vault.token.symbol}`
                  : `${Number(maxWithdrawFormatted).toFixed(4)} ${vault.token.symbol}`}
              </span>
            </div>

            <div className="yearn-input-middle-row">
              <input
                type="text"
                className="yearn-amount-input"
                placeholder="0.0"
                value={amount}
                onChange={(e) => {
                  const val = e.target.value.replace(',', '.');
                  if (/^\d*\.?\d*$/.test(val)) {
                    setAmount(val);
                  }
                }}
              />
              <span className="yearn-input-token-label">{vault.token.symbol}</span>
            </div>

            <div className="yearn-percentage-pills">
              <span style={{ fontSize: 11, color: '#64748b', marginRight: 'auto', alignSelf: 'center' }}>
                ≈ ${usdValue}
              </span>
              <button type="button" className="yearn-percent-pill" onClick={() => handlePercentage(25)}>
                25%
              </button>
              <button type="button" className="yearn-percent-pill" onClick={() => handlePercentage(50)}>
                50%
              </button>
              <button type="button" className="yearn-percent-pill" onClick={() => handlePercentage(75)}>
                75%
              </button>
              <button type="button" className="yearn-percent-pill" onClick={() => handlePercentage(100)}>
                MAX
              </button>
            </div>
          </div>

          {/* Vault Metadata Summary */}
          <div className="yearn-modal-meta">
            <div className="yearn-meta-row">
              <span>Network:</span>
              <span>{chain.name}</span>
            </div>
            <div className="yearn-meta-row">
              <span>Estimated APY:</span>
              <span style={{ color: '#22c55e', fontWeight: 700 }}>{apyDisplay}</span>
            </div>
            <div className="yearn-meta-row">
              <span>Vault Version:</span>
              <span>Yearn {vault.version || 'v3'}</span>
            </div>
          </div>

          {/* Action Buttons */}
          {!walletAddress ? (
            <button
              type="button"
              className="yearn-modal-action-btn"
              onClick={() => {
                if ((window as any).CoinmanWallet) {
                  (window as any).CoinmanWallet.connect();
                }
              }}
            >
              Connect Wallet to Continue
            </button>
          ) : needsApproval ? (
            <button
              type="button"
              className="yearn-modal-action-btn"
              disabled={statusState.stage === 'approving'}
              onClick={handleApprove}
            >
              {statusState.stage === 'approving' ? (
                <>
                  <span className="yearn-spinner" style={{ width: 14, height: 14, margin: 0 }} />
                  Approving {vault.token.symbol}...
                </>
              ) : (
                `Approve ${vault.token.symbol}`
              )}
            </button>
          ) : (
            <button
              type="button"
              className="yearn-modal-action-btn"
              disabled={
                parsedAmount === 0n ||
                statusState.stage === 'executing' ||
                (activeTab === 'deposit' && parsedAmount > tokenBalance) ||
                (activeTab === 'withdraw' && parsedAmount > underlyingBalance)
              }
              onClick={handleExecute}
            >
              {statusState.stage === 'executing' ? (
                <>
                  <span className="yearn-spinner" style={{ width: 14, height: 14, margin: 0 }} />
                  Confirming on OneKey HD...
                </>
              ) : activeTab === 'deposit' && parsedAmount > tokenBalance ? (
                'Insufficient Token Balance'
              ) : activeTab === 'withdraw' && parsedAmount > underlyingBalance ? (
                'Insufficient Vault Balance'
              ) : activeTab === 'deposit' ? (
                `Deposit ${vault.token.symbol}`
              ) : (
                `Withdraw ${vault.token.symbol}`
              )}
            </button>
          )}

          {/* Status feedback */}
          {statusState.message && (
            <div
              className={`yearn-modal-status ${
                statusState.stage === 'success' ? 'success' : statusState.stage === 'error' ? 'error' : ''
              }`}
            >
              {statusState.message}
              {statusState.txHash && (
                <div style={{ marginTop: 4 }}>
                  <a
                    href={`${chain.blockExplorer}/tx/${statusState.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#006ae3', textDecoration: 'underline' }}
                  >
                    View on {chain.name} Explorer ↗
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
