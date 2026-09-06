import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatUnits, maxUint256 } from 'viem';
import { switchChain } from '@wagmi/core';
import { YearnVault } from '../types';
import { wagmiConfig } from '../../wallet/wallet';
import { YVUSD_COOLDOWN_DAYS, YVUSD_WITHDRAW_WINDOW_DAYS, YVUSD_ZAP_ADDRESS } from '../constants';
import {
  approveToken,
  cancelLockedCooldown,
  depositToVault,
  fetchLockedCooldown,
  fetchLockedSchedule,
  getTokenAllowance,
  getTokenBalance,
  getUserVaultShares,
  previewZapOut,
  redeemFromVault,
  startLockedCooldown,
  zapIntoLocked,
  zapOutOfLocked,
} from '../yearnContracts';

export type ActionStage = 'idle' | 'approving' | 'executing' | 'success' | 'error';

export interface ActionStatus {
  stage: ActionStage;
  message?: string;
  txHash?: string;
}

export type WidgetMode = 'deposit' | 'withdraw';

/** yvUSD ships an unlocked ERC-4626 vault and a locked one reached through a zapper. */
export type VaultVariant = 'unlocked' | 'locked';

/**
 * Where a locked position sits in the withdrawal cycle.
 * `none` — nothing deposited into the locked vault.
 * `idle` — locked shares held, no cooldown armed.
 * `cooling` / `ready` / `expired` — mirror `LockedyvUSD.availableWithdrawLimit`.
 */
export type LockedPhase = 'none' | 'idle' | 'cooling' | 'ready' | 'expired';

export interface LockedState {
  isLocked: boolean;
  phase: LockedPhase;
  cooldownEnd: number;
  windowEnd: number;
  cooldownShares: bigint;
  /** Base-asset value of the shares currently under cooldown. */
  cooldownAssets: bigint;
  cooldownDays: number;
  windowDays: number;
  /** Seconds until the current phase ends (cooldown expiry, or window close). */
  secondsLeft: number;
}

export interface VaultActions {
  amount: string;
  setAmount: (value: string) => void;
  parsedAmount: bigint;
  tokenBalance: bigint;
  vaultShares: bigint;
  underlyingBalance: bigint;
  /** Spendable balance for the active mode, in the deposit asset. */
  available: bigint;
  /** Shares the entered amount maps to — what a withdrawal would actually burn. */
  redeemShares: bigint;
  allowance: bigint;
  isLoadingBalances: boolean;
  needsApproval: boolean;
  isWrongChain: boolean;
  status: ActionStatus;
  locked: LockedState;
  resetStatus: () => void;
  setPercent: (percent: number) => void;
  approve: () => Promise<void>;
  execute: () => Promise<void>;
  startCooldown: () => Promise<void>;
  cancelCooldown: () => Promise<void>;
  switchToVaultChain: () => Promise<void>;
  refreshBalances: () => Promise<void>;
}

const DAY_SECONDS = 86400;

const IDLE_LOCKED_STATE: LockedState = {
  isLocked: false,
  phase: 'none',
  cooldownEnd: 0,
  windowEnd: 0,
  cooldownShares: 0n,
  cooldownAssets: 0n,
  cooldownDays: YVUSD_COOLDOWN_DAYS,
  windowDays: YVUSD_WITHDRAW_WINDOW_DAYS,
  secondsLeft: 0,
};

function parseAmount(value: string, decimals: number): bigint {
  if (!value || !/^\d*\.?\d+$/.test(value) || value === '0' || /^0\.0*$/.test(value)) return 0n;
  try {
    const [intPart = '0', fracRaw = ''] = value.trim().split('.');
    const fracPart = fracRaw.slice(0, decimals).padEnd(decimals, '0');
    return BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(fracPart || '0');
  } catch {
    return 0n;
  }
}

/** Wallet reads/writes for the deposit-withdraw widget, kept out of the presentation layer. */
export function useVaultActions(
  vault: YearnVault,
  mode: WidgetMode,
  walletAddress?: string,
  walletChainId?: number,
  variant: VaultVariant = 'unlocked'
): VaultActions {
  const [amount, setAmount] = useState('');
  const [allowance, setAllowance] = useState(0n);
  const [tokenBalance, setTokenBalance] = useState(0n);
  const [vaultShares, setVaultShares] = useState(0n);
  const [underlyingBalance, setUnderlyingBalance] = useState(0n);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [status, setStatus] = useState<ActionStatus>({ stage: 'idle' });
  const [locked, setLocked] = useState<LockedState>(IDLE_LOCKED_STATE);
  const [schedule, setSchedule] = useState<{ cooldownDays: number; windowDays: number }>({
    cooldownDays: YVUSD_COOLDOWN_DAYS,
    windowDays: YVUSD_WITHDRAW_WINDOW_DAYS,
  });

  const decimals = vault.token.decimals || 18;
  const isWrongChain = Boolean(walletAddress && walletChainId && walletChainId !== vault.chainID);

  const lockedAddress = vault.lockedTwin?.address;
  const isLocked = variant === 'locked' && Boolean(lockedAddress);

  /** Contract holding the user's shares for the active variant. */
  const sharesAddress = isLocked && lockedAddress ? lockedAddress : vault.address;
  /** Contract that must be approved before the active action can run. */
  const spender = isLocked ? YVUSD_ZAP_ADDRESS : vault.address;
  /** Token being approved: the deposit asset going in, the shares coming out. */
  const approvalToken = mode === 'deposit' ? vault.token.address : sharesAddress;

  // The cooldown schedule is public state, so the info box stays accurate
  // even before a wallet connects.
  useEffect(() => {
    if (!lockedAddress) return;
    let cancelled = false;
    void fetchLockedSchedule(vault.chainID, lockedAddress).then((result) => {
      if (cancelled || !result) return;
      setSchedule({
        cooldownDays: Math.round(result.cooldownDuration / DAY_SECONDS),
        windowDays: Math.round(result.withdrawalWindow / DAY_SECONDS),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [vault.chainID, lockedAddress]);

  const refreshBalances = useCallback(async () => {
    if (!walletAddress) {
      setTokenBalance(0n);
      setVaultShares(0n);
      setUnderlyingBalance(0n);
      setAllowance(0n);
      setLocked(IDLE_LOCKED_STATE);
      return;
    }

    setIsLoadingBalances(true);
    try {
      const [balance, allowanceValue, shares] = await Promise.all([
        getTokenBalance(vault.chainID, vault.token.address, walletAddress),
        getTokenAllowance(vault.chainID, approvalToken, walletAddress, spender),
        getUserVaultShares(vault.chainID, sharesAddress, walletAddress),
      ]);
      setTokenBalance(balance);
      setAllowance(allowanceValue);
      setVaultShares(shares.shares);

      if (!isLocked || !lockedAddress) {
        setUnderlyingBalance(shares.assetsUnderlying);
        setLocked(IDLE_LOCKED_STATE);
        return;
      }

      // Locked shares wrap yvUSD shares, so their base-asset value only comes
      // from the zapper's preview, not from the locked vault's convertToAssets.
      const [assets, cooldown] = await Promise.all([
        previewZapOut(vault.chainID, YVUSD_ZAP_ADDRESS, shares.shares),
        fetchLockedCooldown(vault.chainID, lockedAddress, walletAddress),
      ]);
      setUnderlyingBalance(assets);

      const now = Math.floor(Date.now() / 1000);
      let phase: LockedPhase = shares.shares > 0n ? 'idle' : 'none';
      let secondsLeft = 0;
      if (cooldown.shares > 0n) {
        if (now < cooldown.cooldownEnd) {
          phase = 'cooling';
          secondsLeft = cooldown.cooldownEnd - now;
        } else if (now <= cooldown.windowEnd) {
          phase = 'ready';
          secondsLeft = cooldown.windowEnd - now;
        } else {
          phase = 'expired';
        }
      }

      const cooldownAssets =
        cooldown.shares > 0n
          ? await previewZapOut(vault.chainID, YVUSD_ZAP_ADDRESS, cooldown.shares)
          : 0n;

      setLocked({
        isLocked: true,
        phase,
        cooldownEnd: cooldown.cooldownEnd,
        windowEnd: cooldown.windowEnd,
        cooldownShares: cooldown.shares,
        cooldownAssets,
        // `cooldownDays`/`windowDays` come from the shared schedule below.
        cooldownDays: YVUSD_COOLDOWN_DAYS,
        windowDays: YVUSD_WITHDRAW_WINDOW_DAYS,
        secondsLeft,
      });
    } catch (err) {
      console.warn('[useVaultActions] Error loading balances:', err);
    } finally {
      setIsLoadingBalances(false);
    }
  }, [
    vault.chainID,
    vault.token.address,
    walletAddress,
    approvalToken,
    spender,
    sharesAddress,
    isLocked,
    lockedAddress,
  ]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  // The amount is denominated in the deposit asset in both directions.
  const parsedAmount = parseAmount(amount, decimals);

  const available = useMemo(() => {
    if (mode === 'deposit') return tokenBalance;
    if (isLocked && locked.phase === 'ready') return locked.cooldownAssets;
    return underlyingBalance;
  }, [mode, tokenBalance, underlyingBalance, isLocked, locked.phase, locked.cooldownAssets]);

  /** Shares matching `parsedAmount`, proportional to the position's asset value. */
  const sharesForAmount = useCallback(
    (assets: bigint, shares: bigint) => {
      if (shares === 0n) return 0n;
      if (assets === 0n || parsedAmount >= assets) return shares;
      return (shares * parsedAmount) / assets;
    },
    [parsedAmount]
  );

  const redeemShares = useMemo(
    () =>
      isLocked
        ? sharesForAmount(locked.cooldownAssets, locked.cooldownShares)
        : sharesForAmount(underlyingBalance, vaultShares),
    [isLocked, locked.cooldownAssets, locked.cooldownShares, underlyingBalance, vaultShares, sharesForAmount]
  );

  const needsApproval = useMemo(() => {
    if (parsedAmount === 0n) return false;
    if (mode === 'deposit') return allowance < parsedAmount;
    // Only the zapper spends shares; a plain ERC-4626 redeem burns the owner's own.
    if (!isLocked || locked.phase !== 'ready') return false;
    return allowance < redeemShares;
  }, [parsedAmount, mode, allowance, isLocked, locked.phase, redeemShares]);

  const resetStatus = useCallback(() => setStatus({ stage: 'idle' }), []);

  const setPercent = useCallback(
    (percent: number) => {
      if (available === 0n) return;
      const portion = percent >= 100 ? available : (available * BigInt(percent)) / 100n;
      setAmount(formatUnits(portion, decimals));
    },
    [available, decimals]
  );

  const switchToVaultChain = useCallback(async () => {
    try {
      await switchChain(wagmiConfig, { chainId: vault.chainID as any });
    } catch (err) {
      console.error('[useVaultActions] Switch network error:', err);
    }
  }, [vault.chainID]);

  const fail = useCallback((err: any, fallback: string) => {
    console.error('[useVaultActions]', fallback, err);
    setStatus({ stage: 'error', message: err?.message?.slice(0, 140) || fallback });
  }, []);

  const approve = useCallback(async () => {
    if (!walletAddress) return;
    try {
      setStatus({ stage: 'approving' });
      await approveToken(vault.chainID, approvalToken, spender, maxUint256);
      setAllowance(maxUint256);
      setStatus({ stage: 'idle' });
    } catch (err: any) {
      fail(err, 'Approval transaction was rejected or failed.');
    }
  }, [vault.chainID, approvalToken, spender, walletAddress, fail]);

  const startCooldown = useCallback(async () => {
    if (!walletAddress || !lockedAddress) return;
    // With no amount typed, arm the cooldown for the whole locked position.
    const shares =
      parsedAmount === 0n ? vaultShares : sharesForAmount(underlyingBalance, vaultShares);
    if (shares === 0n) return;
    try {
      setStatus({ stage: 'executing' });
      const hash = await startLockedCooldown(vault.chainID, lockedAddress, shares);
      setStatus({ stage: 'success', txHash: hash });
      void refreshBalances();
    } catch (err: any) {
      fail(err, 'Could not start the cooldown.');
    }
  }, [
    walletAddress,
    lockedAddress,
    parsedAmount,
    sharesForAmount,
    underlyingBalance,
    vaultShares,
    vault.chainID,
    refreshBalances,
    fail,
  ]);

  const cancelCooldown = useCallback(async () => {
    if (!walletAddress || !lockedAddress) return;
    try {
      setStatus({ stage: 'executing' });
      const hash = await cancelLockedCooldown(vault.chainID, lockedAddress);
      setStatus({ stage: 'success', txHash: hash });
      void refreshBalances();
    } catch (err: any) {
      fail(err, 'Could not cancel the cooldown.');
    }
  }, [walletAddress, lockedAddress, vault.chainID, refreshBalances, fail]);

  const execute = useCallback(async () => {
    if (!walletAddress || parsedAmount === 0n) return;
    if (isWrongChain) {
      await switchToVaultChain();
      return;
    }

    try {
      setStatus({ stage: 'executing' });
      let hash: string;

      if (mode === 'deposit') {
        hash = isLocked
          ? await zapIntoLocked(vault.chainID, YVUSD_ZAP_ADDRESS, parsedAmount, walletAddress)
          : await depositToVault(vault.chainID, vault.address, parsedAmount, walletAddress);
      } else if (redeemShares === 0n) {
        setStatus({ stage: 'idle' });
        return;
      } else if (isLocked) {
        hash = await zapOutOfLocked(vault.chainID, YVUSD_ZAP_ADDRESS, redeemShares, walletAddress);
      } else {
        hash = await redeemFromVault(vault.chainID, vault.address, redeemShares, walletAddress);
      }

      setStatus({ stage: 'success', txHash: hash });
      setAmount('');
      void refreshBalances();
    } catch (err: any) {
      fail(err, 'Transaction was rejected or failed.');
    }
  }, [
    walletAddress,
    parsedAmount,
    isWrongChain,
    switchToVaultChain,
    mode,
    isLocked,
    vault.chainID,
    vault.address,
    redeemShares,
    refreshBalances,
    fail,
  ]);

  return {
    amount,
    setAmount,
    parsedAmount,
    tokenBalance,
    vaultShares,
    underlyingBalance,
    available,
    redeemShares,
    allowance,
    isLoadingBalances,
    needsApproval,
    isWrongChain,
    status,
    locked: { ...locked, ...schedule },
    resetStatus,
    setPercent,
    approve,
    execute,
    startCooldown,
    cancelCooldown,
    switchToVaultChain,
    refreshBalances,
  };
}
