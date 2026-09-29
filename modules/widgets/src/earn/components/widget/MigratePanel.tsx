import React, { useCallback, useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { readContracts, switchChain } from '@wagmi/core';
import { wagmiConfig } from '../../../wallet/wallet';
import { YearnVault } from '../../types';
import { fetchVaultSnapshot } from '../../kongApi';
import { getChain } from '../../yearnApi';
import { formatAmount, formatUSD, shortenAddress } from '../../format';
import { openExternal } from '../../openExternal';
import {
  ERC20_TX_ABI,
  PlanProgress,
  migrationSpender,
  planMigration,
  runPlan,
  shareDecimals,
} from '../../vaultTx';

interface MigratePanelProps {
  vault: YearnVault;
  vaults: YearnVault[];
  walletAddress?: string;
  walletChainId?: number;
  onConnectWallet: () => void;
  onSelectVault?: (vault: YearnVault) => void;
  onBalancesChanged?: () => void;
}

type Stage = 'idle' | 'running' | 'success' | 'error';

/** yearn.fi's Migrate tab: move every unstaked share of a retired vault into
 *  its successor through the migrator Kong names. */
export const MigratePanel: React.FC<MigratePanelProps> = ({
  vault,
  vaults,
  walletAddress,
  walletChainId,
  onConnectWallet,
  onSelectVault,
  onBalancesChanged,
}) => {
  const [route, setRoute] = useState<{ target: string; contract?: string } | null>(null);
  const [shares, setShares] = useState(0n);
  const [allowance, setAllowance] = useState(0n);
  const [stage, setStage] = useState<Stage>('idle');
  const [step, setStep] = useState<PlanProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | undefined>();

  const chain = getChain(vault.chainID);
  const decimals = shareDecimals(vault);
  const isWrongChain = Boolean(walletAddress && walletChainId && walletChainId !== vault.chainID);

  useEffect(() => {
    let cancelled = false;
    setRoute(vault.migration?.target ? { target: vault.migration.target, contract: vault.migration.contract } : null);
    void fetchVaultSnapshot(vault.chainID, vault.address).then((snapshot) => {
      const migration = snapshot?.meta?.migration;
      if (!cancelled && migration?.available && migration.target) {
        setRoute({ target: migration.target, contract: migration.contract });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [vault]);

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setShares(0n);
      setAllowance(0n);
      return;
    }
    const owner = walletAddress as `0x${string}`;
    const vaultAddress = vault.address as `0x${string}`;
    const reads = await readContracts(wagmiConfig, {
      allowFailure: true,
      contracts: [
        { chainId: vault.chainID, address: vaultAddress, abi: ERC20_TX_ABI, functionName: 'balanceOf', args: [owner] },
        {
          chainId: vault.chainID,
          address: vaultAddress,
          abi: ERC20_TX_ABI,
          functionName: 'allowance',
          args: [owner, migrationSpender(route?.contract)],
        },
      ] as any,
    });
    const read = (index: number) => (reads[index]?.status === 'success' ? (reads[index].result as bigint) : 0n);
    setShares(read(0));
    setAllowance(read(1));
  }, [walletAddress, vault, route?.contract]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const targetVault = route
    ? vaults.find((item) => item.chainID === vault.chainID && item.address.toLowerCase() === route.target.toLowerCase())
    : undefined;
  const pricePerShare = vault.pricePerShare ? BigInt(vault.pricePerShare) : 10n ** BigInt(decimals);
  const assets = Number(formatUnits((shares * pricePerShare) / 10n ** BigInt(decimals), vault.token.decimals || 18));
  const needsApproval = allowance < shares;

  const migrate = async () => {
    if (!walletAddress) return onConnectWallet();
    if (isWrongChain) {
      await switchChain(wagmiConfig, { chainId: vault.chainID as any }).catch(() => undefined);
      return;
    }
    if (!route || shares === 0n) return;
    setStage('running');
    setMessage(null);
    try {
      const hash = await runPlan(
        planMigration(vault, route.target, route.contract, shares, allowance, walletAddress),
        walletAddress,
        setStep
      );
      setTxHash(hash);
      setStage('success');
      setStep(null);
      onBalancesChanged?.();
      void refresh();
    } catch (err: any) {
      setStage('error');
      setStep(null);
      setMessage((err?.shortMessage || err?.message || 'Migration failed.').slice(0, 200));
    }
  };

  let label = needsApproval ? 'Approve & Migrate' : 'Migrate All';
  if (!walletAddress) label = 'Connect Wallet';
  else if (isWrongChain) label = `Switch to ${chain.name}`;
  else if (!route) label = 'Migration not available';
  else if (shares === 0n) label = 'Nothing to migrate';
  if (stage === 'running' && step) {
    label = `${step.label}…${step.total > 1 ? ` (${step.index + 1}/${step.total})` : ''}`;
  }
  const disabled =
    stage === 'running' || (Boolean(walletAddress) && !isWrongChain && (!route || shares === 0n));

  return (
    <div className="y-widget">
      <div className="y-widget__inner y-migrate">
        <div className="y-widget__head">
          <h3 className="y-widget__title">Migrate</h3>
        </div>
        <p className="y-widget__warning">This vault is retired. Please withdraw or migrate your funds.</p>

        <div className="y-migrate__card">
          <span className="y-migrate__label">Your Balance</span>
          <span className="y-migrate__value">
            {`${formatAmount(Number(formatUnits(shares, decimals)))} ${vault.symbol}`}
          </span>
          <span className="y-migrate__label">
            {`${formatAmount(assets)} ${vault.token.symbol} (${formatUSD(assets * (vault.tvl?.price || 0))})`}
          </span>
        </div>

        <div className="y-migrate__card">
          <span className="y-migrate__label">Destination</span>
          {route ? (
            targetVault && onSelectVault ? (
              <button type="button" className="y-migrate__target" onClick={() => onSelectVault(targetVault)}>
                {`${targetVault.name} (${targetVault.symbol})`}
              </button>
            ) : (
              <span className="y-migrate__value">{targetVault ? targetVault.name : shortenAddress(route.target)}</span>
            )
          ) : (
            <span className="y-migrate__label">Loading…</span>
          )}
          {route && <span className="y-migrate__label">{shortenAddress(route.target)}</span>}
        </div>

        <button type="button" className="y-btn y-btn--primary y-widget__cta" disabled={disabled} onClick={() => void migrate()}>
          {label}
        </button>

        {stage === 'error' && message && <p className="y-widget__error">{message}</p>}
        {stage === 'success' && (
          <button
            type="button"
            className="y-widget__success"
            onClick={() => txHash && openExternal(`${chain.blockExplorer}/tx/${txHash}`)}
          >
            Migration successful! Your funds have been migrated to the new vault. ↗
          </button>
        )}
      </div>
    </div>
  );
};
